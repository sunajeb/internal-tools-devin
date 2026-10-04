#!/usr/bin/env bash
set -euo pipefail
root="$(git rev-parse --show-toplevel)"
workspace="$(mktemp -d)"
trap 'rm -rf "$workspace"' EXIT
cd "$root"
git ls-files -co --exclude-standard -z | while IFS= read -r -d '' file; do
  [ -e "$file" ] && printf '%s\0' "$file"
done | rsync -a --from0 --files-from=- . "$workspace/"
cd "$workspace"
npm ci --no-audit --no-fund
npx tsx scripts/new-tool.ts generated-check
npm install --no-audit --no-fund
npx tsc -b
npx vitest run tools/generated-check
npx eslint tools/generated-check
echo "The generated tool compiles, passes its tests and passes lint."
