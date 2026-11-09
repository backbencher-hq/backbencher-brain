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
# live in the repository so a reader can check a claim against them directly.
#
# Reproducibility: `git archive` takes file contents and mtimes from the commit, and
# the file list is taken from the commit's own tree in git's stable order, so the same
# revision produces the same bytes. `--check` rebuilds and compares against the
# committed .sha256, and exits 1 on any difference.
set -uo pipefail

OUT_DIR=".tools"
REV="HEAD"
CHECK=0
while [ $# -gt 0 ]; do
  case "$1" in
    --out) OUT_DIR="$2"; shift 2 ;;
    --rev) REV="$2"; shift 2 ;;
    --check) CHECK=1; shift ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
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

# The file list is derived from the revision's tree, never from the working tree: an
# archive that included uncommitted edits would not describe the release.
LIST="$(mktemp)"; trap 'rm -f "$LIST"' EXIT
git ls-tree -r --name-only "$REV" \
  | grep -E '^(validation/|docs/website/)' \
  | grep -E '/(measurements|verification|fixtures)/|\.(log|txt|png|jpg|jpeg|gif|webp|mp4|mov)$' \
  > "$LIST"
count="$(wc -l < "$LIST" | tr -d ' ')"
[ "$count" -gt 0 ] || { echo "FAIL: no raw-material files at $REV_FULL" >&2; exit 1; }

echo "revision: $REV_FULL · files: $count · version: $VER"

if [ "$CHECK" -eq 1 ]; then
  [ -f "$SUMS" ] || { echo "FAIL: no committed checksum at $SUMS — build first" >&2; exit 1; }
  tmpdir="$(mktemp -d)"
  tmp="$tmpdir/$NAME"
  git archive --format=tar "$REV" -- $(cat "$LIST") | zstd -3 -T0 -q -o "$tmp" || {
    rm -rf "$tmpdir"; echo "FAIL: rebuild failed at $REV_FULL" >&2; exit 1
  }
  want="$(awk '{print $1}' "$SUMS")"
  got="$(sha256sum "$tmp" | awk '{print $1}')"
  rm -rf "$tmpdir"
  if [ "$want" != "$got" ]; then
    echo "FAIL: archive is not reproducible at $REV_FULL"; echo "  committed: $want"; echo "  rebuilt:   $got"; exit 1
  fi
  echo "PASS: archive reproduces byte-identically at $REV_FULL ($want)"
  exit 0
fi

rm -f "$OUT" "$SUMS"
git archive --format=tar "$REV" -- $(cat "$LIST") | zstd -3 -T0 -q -o "$OUT" || {
  echo "FAIL: could not build the archive at $REV_FULL" >&2; exit 1
}
sha256sum "$OUT" > "$SUMS"
printf 'archive:  %s (%.1f MB, %s files)\nsha256:   %s\n' \
  "$OUT" "$(awk -v b="$(stat -c%s "$OUT")" 'BEGIN{print b/1048576}')" "$count" \
  "$(awk '{print $1}' "$SUMS")"
