#!/usr/bin/env bash
set -euo pipefail
repo=$(git -C "$(dirname "$(realpath "$0")")" rev-parse --show-toplevel)
cd "$repo"
opt="$HOME/.local/opt"
cache="$HOME/.cache/orca-personal"
bin="$HOME/.local/bin"
mkdir -p "$opt" "$cache/build-home" "$bin"
exec 9>"$cache/update.lock"
flock -n 9 || { echo 'Another Orca Personal update is running.' >&2; exit 1; }
if [[ ${1:-} == --rollback ]]; then exec bash config/scripts/personal/activate.sh "$opt" --rollback; fi
[[ $# == 0 || ( $# == 1 && $1 == --push ) ]]
[[ $(uname -sm) == 'Linux x86_64' ]]
tag=$(gh api --hostname github.com repos/stablyai/orca/releases/latest --jq .tag_name)
bash config/scripts/personal/sync-stable.sh "$tag"
commit=$(git rev-parse HEAD)
version="${tag#v}-personal.g${commit:0:10}"
release="$opt/orca-$version"
asset="orca-ide_${tag#v}_amd64.deb"
package="$cache/orca-$version-linux-x64.tar.zst"
if [[ ! -d $release || ! -f $package ]]; then
  work=$(mktemp -d "$opt/.orca-build-XXXXXXXX")
  trap 'rm -rf -- "$work"' EXIT
  digest=$(gh api --hostname github.com "repos/stablyai/orca/releases/tags/$tag" --jq ".assets[] | select(.name == \"$asset\") | .digest")
  [[ $digest =~ ^sha256:[[:xdigit:]]{64}$ ]]
  verify() { printf '%s  %s\n' "${digest#sha256:}" "$1" | sha256sum -c --status; }
  if [[ ! -f "$cache/$asset" ]] || ! verify "$cache/$asset"; then
    gh release download "$tag" --repo github.com/stablyai/orca --pattern "$asset" --dir "$work"
    verify "$work/$asset"
    mv "$work/$asset" "$cache/$asset"
  fi
  dpkg-deb -x "$cache/$asset" "$work/deb"
  app="$work/deb/opt/Orca"
  cp "$work/deb/usr/share/icons/hicolor/256x256/apps/orca-ide.png" "$app/orca-personal.png"
  build="$cache/build"
  if [[ ! -e $build ]]; then git clone --local --single-branch -b personal/release "$repo" "$build"; fi
  [[ $(realpath "$(git -C "$build" remote get-url origin)") == "$repo" && -z $(git -C "$build" status --porcelain) ]] || {
    echo "Build checkout must be clean and cloned from $repo: $build" >&2; exit 1;
  }
  git -C "$build" fetch --tags origin personal/release
  git -C "$build" switch --detach "$commit"
  image=node:24-bookworm
  docker run --rm --user "$(id -u):$(id -g)" -v "$build:/src" -w /src \
    -v "$cache/build-home:/build-home" -v "$work:/stage" \
    -e HOME=/build-home -e PATH=/build-home/bin:/usr/local/bin:/usr/bin:/bin \
    -e CI=true -e npm_config_nodedir=/usr/local -e ORCA_BACKGROUND_LAUNCH=1 \
    "$image" sh -euc '
      mkdir -p /build-home/bin
      corepack enable --install-directory /build-home/bin pnpm
      pnpm install --frozen-lockfile
      pnpm -C mobile install --frozen-lockfile
      bash config/scripts/personal/sync-stable.test.sh
      bash config/scripts/personal/activate.test.sh
      pnpm exec vitest run --config config/vitest.config.ts config/scripts/personal/package.test.mjs src/main/updater/lifecycle/personal-linux-update.test.ts src/main/telemetry/consent.test.ts --maxWorkers=2
      pnpm run build:release:javascript
      node config/scripts/personal/package.cjs /src /stage/deb/opt/Orca/resources /stage/repack "$1" "$2"
    ' sh "$version" "$commit"
  tar --use-compress-program='zstd -T2 -3' -cf "$work/package.tar.zst" -C "$work/deb/opt" Orca
  mv "$work/package.tar.zst" "$package"
  if [[ ! -d $release ]]; then
    sandbox=/opt/google/chrome/chrome-sandbox
    if [[ -u $sandbox && $(stat -c %u "$sandbox") == 0 ]]; then ln -sfn "$sandbox" "$app/chrome-sandbox"; fi
    mv -T "$app" "$release"
  fi
fi
bash config/scripts/personal/activate.sh "$opt" "$version"
ln -sfn "$repo/config/scripts/personal/update.sh" "$bin/orca-personal-update"
ln -sfn "$opt/orca-personal-current/resources/bin/orca-ide" "$bin/orca-ide"
desktop="$HOME/.local/share/applications/orca-personal.desktop"
mkdir -p "$(dirname "$desktop")"
cat > "$desktop" <<ENTRY
[Desktop Entry]
Type=Application
Name=Orca (Personal)
Exec="$opt/orca-personal-current/orca-ide" %U
Icon=$opt/orca-personal-current/orca-personal.png
StartupWMClass=orca
Categories=Development;
MimeType=x-scheme-handler/orca;
Terminal=false
ENTRY
update-desktop-database "$(dirname "$desktop")"
if [[ ${1:-} == --push ]]; then git push origin HEAD:refs/heads/personal/release; fi
printf 'Installed %s. Open Orca (Personal), or restart it if already running.\nPackage: %s\n' "$version" "$package"
