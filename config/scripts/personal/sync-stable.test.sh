#!/usr/bin/env bash
set -euo pipefail
sync=$(realpath "$(dirname "$0")/sync-stable.sh")
base=$(mktemp -d)
trap 'rm -rf -- "$base"' EXIT
export GIT_AUTHOR_NAME=test GIT_COMMITTER_NAME=test GIT_AUTHOR_EMAIL=test@example.invalid GIT_COMMITTER_EMAIL=test@example.invalid
git init -q -b main "$base/upstream"
cd "$base/upstream"
touch original
git add original
git commit -qm original
git tag v1.0.0
git clone -q . "$base/fork"
cd "$base/fork"
git remote rename origin upstream
git switch -qc personal/release
touch personal
git add personal
git commit -qm personal
cd "$base/upstream"
touch released
git add released
git commit -qm released
git tag v1.0.1
touch unreleased
git add unreleased
git commit -qm unreleased
git tag v1.0.2-rc.1
cd "$base/fork"
bash "$sync" v1.0.1
test -f personal && test -f released && test ! -e unreleased
git merge-base --is-ancestor v1.0.1 HEAD
before=$(git rev-parse HEAD)
bash "$sync" v1.0.1
test "$before" = "$(git rev-parse HEAD)"
if bash "$sync" v1.0.2-rc.1; then exit 1; fi
echo pending > personal
if bash "$sync" v1.0.1; then exit 1; fi
test "$(cat personal)" = pending
