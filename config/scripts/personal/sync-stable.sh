#!/usr/bin/env bash
set -euo pipefail
tag=${1:?expected an upstream stable release tag}
[[ $tag =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "Expected a stable release tag: $tag" >&2; exit 1; }
[[ $(git branch --show-current) == personal/release && -z $(git status --porcelain) ]] || {
  echo 'Commit or stash pending changes on personal/release first.' >&2
  exit 1
}
git fetch --no-tags upstream "refs/tags/$tag:refs/tags/$tag"
if ! git merge --no-edit "$tag"; then
  if git rev-parse -q --verify MERGE_HEAD >/dev/null; then git merge --abort; fi
  exit 1
fi
