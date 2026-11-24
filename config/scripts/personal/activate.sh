#!/usr/bin/env bash
set -euo pipefail
opt=${1:?expected installation directory}
version=${2:?expected version or --rollback}
current="$opt/orca-personal-current"
previous="$opt/orca-personal-previous"
if [[ $version == --rollback ]]; then
  candidate=$(realpath -e "$previous")
  version=${candidate##*/orca-}
else
  candidate="$opt/orca-$version"
fi
[[ $version =~ ^[0-9]+\.[0-9]+\.[0-9]+-personal\.g[[:xdigit:]]+$ ]]
[[ $(env -u ORCA_CLI_COMMAND "$candidate/resources/bin/orca-ide" --version) == "$version" ]] || {
  echo "Candidate CLI did not report $version." >&2
  exit 1
}
if [[ -L $current && $(readlink -f "$current") == "$candidate" ]]; then exit 0; fi
staging=$(mktemp -d "$opt/.orca-links-XXXXXXXX")
trap 'rm -rf -- "$staging"' EXIT
if [[ -L $current ]]; then
  ln -s "$(readlink -e "$current")" "$staging/previous"
  mv -Tf "$staging/previous" "$previous"
fi
ln -s "$candidate" "$staging/current"
mv -Tf "$staging/current" "$current"
