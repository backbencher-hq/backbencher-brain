#!/usr/bin/env bash
# Build nested scaling pools of REAL repository source files.
#
# The pool is a PREFIX of one deterministic ordering, so n25 ⊂ n50 ⊂ n100 ⊂ …
# and every tier indexes the same first-N files. That is what makes the curve
# comparable: tier N and tier M differ only by (M-N) more files.
#
# Ordering: `find` over src/ then script/ then ide/, in find order (no sort).
# Files are renamed to t%04d_<base> so the fixture directory's lexical order
# matches pool order. src/ comes first because the pre-existing n10…n200 tiers
# were built from it, and --verify asserts the pool prefix still matches those
# tiers by content.
#
# .perf-fixtures/ is untracked on purpose: these are copies of repo files, not
# new content, and four copies of the repo tree do not belong in git.
#
# Usage:
#   script/perf/make-pools.sh 800           # build tiers up to 800
#   script/perf/make-pools.sh 800 --verify  # …and assert n10…n200 unchanged
set -euo pipefail

export PATH="$HOME/.local/node/bin:$PATH"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="$REPO_ROOT/.perf-fixtures/bb-scale"
MAX="${1:-800}"
VERIFY="${2:-}"
FLAT="$OUT/_pool"

cd "$REPO_ROOT"

# Content digest of a directory, independent of its filename spelling: one
# "<sha256> <basename>" line per file, sorted, hashed. Filenames differ between
# the old t%03d tiers and this script's t%04d names; the BYTES and the basenames
# are what must match.
digest_dir() {
  local dir="$1" count="${2:-}"
  local list
  if [ -n "$count" ]; then
    list="$(mktemp)"
    local i=0
    while IFS= read -r f; do
      [ "$i" -lt "$count" ] || break
      printf '%s\t%s\n' "$(shasum -a 256 "$FLAT/$f" | cut -d' ' -f1)" "${f#*_}" >> "$list"
      i=$((i + 1))
    done < <(ls "$FLAT")
    sort "$list" | shasum -a 256 | cut -d' ' -f1
    rm -f "$list"
  else
    local list2
    list2="$(mktemp)"
    while IFS= read -r f; do
      printf '%s\t%s\n' "$(shasum -a 256 "$dir/$f" | cut -d' ' -f1)" "${f#*_}" >> "$list2"
    done < <(ls "$dir")
    sort "$list2" | shasum -a 256 | cut -d' ' -f1
    rm -f "$list2"
  fi
}

POOL_LIST="$(mktemp)"
trap 'rm -f "$POOL_LIST"' EXIT

# The pool order. src/ first (the analyzer-heavy core, and the source of the
# pre-existing tiers), then script/, then ide/ when present.
{
  find src -type f -name '*.ts'
  find script -type f -name '*.ts'
  find ide -type f -name '*.ts' 2>/dev/null || true
} > "$POOL_LIST"

POOL_SIZE="$(wc -l < "$POOL_LIST" | tr -d ' ')"
if [ "$POOL_SIZE" -lt "$MAX" ]; then
  echo "pool has $POOL_SIZE files, need $MAX" >&2
  exit 1
fi

# Materialise the full pool once as a flat directory of t%04d_<base> copies, so
# each tier is a cheap prefix-copy of the same bytes.
rm -rf "$FLAT"
mkdir -p "$FLAT"
i=0
while IFS= read -r f; do
  cp "$f" "$FLAT/$(printf 't%04d' "$i")_$(basename "$f")"
  i=$((i + 1))
done < "$POOL_LIST"
echo "pool: $POOL_SIZE files in $FLAT"

if [ "$VERIFY" = "--verify" ]; then
  for n in 10 25 50 100 200; do
    old="$OUT/n$n"
    if [ ! -d "$old" ]; then
      echo "verify: n$n absent — no baseline to compare, tier will be built from the pool" >&2
      continue
    fi
    old_count="$(ls "$old" | wc -l | tr -d ' ')"
    old_d="$(digest_dir "$old")"
    new_d="$(digest_dir "$FLAT" "$old_count")"
    if [ "$old_d" != "$new_d" ]; then
      echo "verify: n$n CONTENT DIFFERS from the pool prefix ($old_d vs $new_d)" >&2
      exit 1
    fi
    echo "verify: n$n ($old_count files) matches the pool prefix byte for byte"
  done
fi

# Emit each nested tier as a copy of the first N pool files.
for n in 10 25 50 100 200 400 800; do
  [ "$n" -le "$MAX" ] || continue
  dir="$OUT/n$n"
  rm -rf "$dir"
  mkdir -p "$dir"
  while IFS= read -r f; do cp "$FLAT/$f" "$dir/$f"; done < <(ls "$FLAT" | sed -n "1,${n}p")
  got="$(ls "$dir" | wc -l | tr -d ' ')"
  if [ "$got" -ne "$n" ]; then
    echo "tier n$n has $got files, expected $n" >&2
    exit 1
  fi
  echo "n$n: $got files"
done
