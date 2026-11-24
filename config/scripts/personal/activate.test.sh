#!/usr/bin/env bash
set -euo pipefail
activate=$(realpath "$(dirname "$0")/activate.sh")
root=$(mktemp -d)
trap 'rm -rf -- "$root"' EXIT
for version in 1.0.0-personal.g1234abc 1.0.1-personal.gabcdef0; do
  path="$root/orca-$version"
  mkdir -p "$path/resources/bin"
  printf '#!/bin/sh\necho %s\n' "$version" > "$path/resources/bin/orca-ide"
  chmod +x "$path/resources/bin/orca-ide"
  bash "$activate" "$root" "$version"
  test "$(readlink -f "$root/orca-personal-current")" = "$path"
done
bash "$activate" "$root" --rollback
test "$(readlink -f "$root/orca-personal-current")" = "$root/orca-1.0.0-personal.g1234abc"
if bash "$activate" "$root" 1.0.2-personal.gbad; then exit 1; fi
test "$(readlink -f "$root/orca-personal-current")" = "$root/orca-1.0.0-personal.g1234abc"
