#!/usr/bin/env bash
# Build the evidence archive for a release: the raw material behind the sealed
# records, published as one release asset (docs/EVIDENCE.md).
#
#   script/release/build-evidence-archive.sh [--out <dir>] [--rev <rev>] [--check]
#
# What goes in: every tracked file under validation/ that the public tree excludes
# (measurements, verification dumps, generated fixtures, logs, text dumps, images,
# video) plus the design evidence under docs/website/ that is not part of the site.
# What stays out: the sealed records (validation/**/results/**) and manifests — they
# live in the repository so a reader can check a claim against them directly, and they
# are much smaller than the raw material.
#
# Reproducibility is the point. `git archive` cannot do it here: its --mtime parsing in
# git 2.43 keeps the wall clock, and plain archive output carries the commit time, so the
# bytes would move whenever HEAD moves even with identical content. The builder therefore
# extracts the revision's files and re-creates the tar itself with a fixed epoch mtime,
# numeric owner, sorted entry order and the GNU format — so the archive hash is a
# function of its CONTENT only. `--check` rebuilds and compares against the committed
# checksum, exiting 1 on any difference.
set -uo pipefail

OUT_DIR=".tools"
REV="HEAD"
CHECK=0
while [ $# -gt 0 ]; do
  case "$1" in
    --out) OUT_DIR="$2"; shift 2 ;;
    --rev) REV="$2"; shift 2 ;;
    --check) CHECK=1; shift ;;
    -h|--help) sed -n '2,24p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

SELF_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$SELF_DIR" || exit 2
mkdir -p "$OUT_DIR"

VER="$(node -p 'require("./package.json").version')"
NAME="evidence-$VER.tar.zst"
OUT="$OUT_DIR/$NAME"
SUMS="$OUT.sha256"

command -v zstd >/dev/null || { echo "zstd not found" >&2; exit 2; }
REV_FULL="$(git rev-parse --short "$REV")" || exit 2

# The file list comes from the revision's tree, never the working tree: an archive of
# uncommitted edits would not describe the release.
LIST="$(mktemp)"; STAGE="$(mktemp -d)"; trap 'rm -f "$LIST"; rm -rf "$STAGE"' EXIT
git ls-tree -r --name-only "$REV" \
  | grep -E '^(validation/|docs/website/)' \
  | grep -E '/(measurements|verification|fixtures)/|\.(log|txt|png|jpg|jpeg|gif|webp|mp4|mov)$' \
  > "$LIST"
count="$(wc -l < "$LIST" | tr -d ' ')"
[ "$count" -gt 0 ] || { echo "FAIL: no raw-material files at $REV_FULL" >&2; exit 1; }

# Deterministic archive from committed content: extract, then re-tar with fixed
# metadata. The sort is byte-wise on the path so entry order never depends on the
# filesystem, the locale or the commit.
build() {
  local out="$1"
  rm -rf "$STAGE"/* 2>/dev/null
  git archive --format=tar "$REV" -- $(cat "$LIST") | tar -x -C "$STAGE" || return 1
  ( cd "$STAGE" && find . -mindepth 1 | sed 's|^\./||' | LC_ALL=C sort \
      | tar --format=gnu --mtime=@0 --owner=0 --group=0 --numeric-owner --no-recursion \
            -T - -cf - ) | zstd -3 -T0 -q -o "$out"
}

if [ "$CHECK" -eq 1 ]; then
  [ -f "$SUMS" ] || { echo "FAIL: no checksum file at $SUMS — build first" >&2; exit 1; }
  tmpdir="$(mktemp -d)"; trap 'rm -f "$LIST"; rm -rf "$STAGE" "$tmpdir"' EXIT
  tmp="$tmpdir/$NAME"
  build "$tmp" || { echo "FAIL: rebuild failed at $REV_FULL" >&2; exit 1; }
  want="$(awk 'NR==1{print $1}' "$SUMS")"
  got="$(sha256sum "$tmp" | awk '{print $1}')"
  pinned="$(awk -F': ' '/^# revision: /{print $2}' "$SUMS")"
  [ -n "$pinned" ] && echo "note: archive was built at ${pinned:0:8}; checking at $REV_FULL"
  if [ "$want" != "$got" ]; then
    echo "FAIL: archive content is not reproducible at $REV_FULL"
    echo "  committed: $want"
    echo "  rebuilt:   $got"
    exit 1
  fi
  echo "PASS: archive reproduces byte-identically ($want)"
  exit 0
fi

echo "revision: $REV_FULL · files: $count · version: $VER"
rm -f "$OUT" "$SUMS"
build "$OUT" || { echo "FAIL: could not build the archive at $REV_FULL" >&2; exit 1; }
sha256sum "$OUT" > "$SUMS"
printf '# revision: %s\n' "$(git rev-parse "$REV")" >> "$SUMS"
printf 'archive:  %s (%.1f MB, %s files)\nsha256:   %s\n' \
  "$OUT" "$(awk -v b="$(stat -c%s "$OUT")" 'BEGIN{print b/1048576}')" "$count" \
  "$(awk 'NR==1{print $1}' "$SUMS")"
