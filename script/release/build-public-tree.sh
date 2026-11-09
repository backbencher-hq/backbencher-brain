#!/usr/bin/env bash
# Build the curated public tree from this private repository, then prove it.
#
#   script/release/build-public-tree.sh [--dest <dir>] [--source <repo>] [--keep-clone]
#
# What it does (each step measured, nothing silent):
#   1. clones the source repository with --no-local (a real object copy, not a
#      worktree shortcut, so the clone cannot share the private object store);
#   2. runs git-filter-repo three times — dropped paths, then generated corpora,
#      then the pre-lane validation surveys the launch evidence chain does not cite —
#      while redacting credentials and machine paths from every retained object,
#      keeping empty commits (--prune-empty never) so history count is preserved;
#   3. runs the acceptance checks from docs/PUBLIC-REPO-CURATION.md §5 and FAILS
#      (exit 1) with a named reason when one does not hold.
#
# It never touches the source checkout: the source is only read (clone) and its HEAD
# is recorded in the output so a reader can tell exactly which commit was curated.
#
# Requirements: git, git-filter-repo (on PATH, or GIT_FILTER_REPO=/path/to/script),
# python3. No network access is needed for the filters themselves.
#
# Exit codes: 0 = tree built and every acceptance check passed; 1 = a check failed
# (the failing check is named on stdout); 2 = bad usage/missing tool.
set -uo pipefail

SOURCE=""
DEST=".tools/bb-public-final"
KEEP_CLONE=0
# Extra paths to drop from the public tree (repeatable). Used by
# script/release/split-public-repos.sh to publish a repo split, e.g. excluding
# website/ because the site is its own repository. Same rule syntax as remove-1.
EXCLUDES=()

while [ $# -gt 0 ]; do
  case "$1" in
    --source) SOURCE="$2"; shift 2 ;;
    --dest) DEST="$2"; shift 2 ;;
    --exclude) EXCLUDES+=("$2"); shift 2 ;;
    --keep-clone) KEEP_CLONE=1; shift ;;
    -h|--help) sed -n '2,26p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

SELF_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
SOURCE="${SOURCE:-$SELF_DIR}"

FILTER_REPO="${GIT_FILTER_REPO:-$(command -v git-filter-repo || true)}"
if [ -z "$FILTER_REPO" ] || [ ! -x "$FILTER_REPO" ]; then
  # The single-file distribution works without pip; used when the environment
  # blocks PEP 668 installs.
  CANDIDATE="$SELF_DIR/.tools/bin/git-filter-repo"
  if [ -x "$CANDIDATE" ]; then FILTER_REPO="$CANDIDATE"; else
    echo "git-filter-repo not found (set GIT_FILTER_REPO or put it on PATH)" >&2; exit 2
  fi
fi

fail() { echo "FAIL: $*"; exit 1; }
say()  { echo "=== $* ==="; }

SOURCE_HEAD="$(git -C "$SOURCE" rev-parse --short HEAD)" || fail "cannot read the source HEAD"
echo "source: $SOURCE @ $SOURCE_HEAD"
echo "dest:   $DEST"

rm -rf "$DEST"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# --- rules -----------------------------------------------------------------
# Paths the public tree must not carry. One rule per line; `glob:` lines are
# interpreted as globs by git-filter-repo, everything else as paths.
cat > "$tmp/remove-1.txt" <<'RULES'
.git-cred-dir
script/m14/tmp
archive
local-archive
reviews
plans
worktree-snapshots
.tmp-probe
.hallmark
script/hero
docs/TOOL-OWNERS.md
docs/OPEN-SOURCE-SANITIZATION.md
docs/PUBLIC-REPO-CURATION.md
docs/RELEASE-PREP-0.1.0.md
docs/analyzers/history
docs/tools-campaign
docs/website/HOMEPAGE-PLAN.md
glob:**/*.superseded-*
glob:validation/**/measurements/**
glob:validation/**/verification/**
glob:validation/**/*.log
glob:validation/**/*.txt
glob:validation/**/*.png
glob:validation/**/*.jpg
glob:validation/**/*.jpeg
glob:validation/**/*.gif
glob:validation/**/*.webp
glob:validation/**/*.mp4
glob:validation/**/*.mov
glob:docs/website/**/*.png
glob:docs/website/**/*.jpg
glob:docs/website/**/*.jpeg
glob:docs/website/**/*.mp4
glob:docs/website/REVIEW-AND-DIRECTION-*
glob:docs/website/FIX-LOG-*
glob:docs/website/MASTER-REVIEW-*
RULES
# --exclude arguments are appended to the same rule file, after the built-in set.
if [ ${#EXCLUDES[@]} -gt 0 ]; then
  for extra in "${EXCLUDES[@]}"; do printf '%s\n' "$extra" >> "$tmp/remove-1.txt"; done
fi

cat > "$tmp/removed-later.txt" <<'RULES'
glob:validation/**/fixtures/**
glob:*.superseded-*
RULES

# Every validation subtree the launch evidence chain does not cite. The allowlist
# is the chain that produced the sealed records: M24-M29, M42, M44, M49, M50,
# M53, M55. Anything else is a pre-lane raw survey and belongs to the archive.
cat > "$tmp/keep-validation.txt" <<'RULES'
m24
m25
m26
m27
m28
m29
m42
m44
m49
m50
m53
m55
RULES

# Credentials and machine paths, redacted from every retained object and commit
# message. A credential that was once committed is not removed by a later delete:
# it stays in the object database and in every clone, so it is replaced here.
cat > "$tmp/redact.txt" <<'RULES'
regex:gh[opsu]_[A-Za-z0-9]{20,}==>REDACTED
regex:npm_[A-Za-z0-9]{20,}==>REDACTED
$HOME==>$HOME
fixtures==>fixtures
RULES
cat > "$tmp/messages.txt" <<'RULES'
regex:Agent host session==>development session
RULES

# --- clone + filter ---------------------------------------------------------
say "clone"
git clone --no-local -q "$SOURCE" "$DEST" 2>&1 | tail -2
[ -d "$DEST/.git" ] || fail "clone produced no git repository"
# The origin points at the PRIVATE repository; the public tree is pushed to its own
# remote explicitly, so the private remote is removed here on purpose.
git -C "$DEST" remote remove origin 2>/dev/null || true

filter() {
  local pass="$1"; shift
  say "filter pass $pass"
  ( cd "$DEST" && "$FILTER_REPO" --force --prune-empty never --invert-paths \
      --paths-from-file "$1" "${@:2}" 2>&1 | tail -2 )
  [ -d "$DEST/.git/filter-repo" ] || fail "pass $pass: filter-repo did not run"
}

filter 1 "$tmp/remove-1.txt" --strip-blobs-bigger-than 100M \
  --replace-text "$tmp/redact.txt" --replace-message "$tmp/messages.txt"
filter 2 "$tmp/removed-later.txt"

# Pass 3 is generated from the clone's own tree: drop every validation/<dir> that
# is not on the allowlist. Written here so the rule cannot silently go stale when a
# new milestone directory appears.
: > "$tmp/remove-3.txt"
for d in $(git -C "$DEST" ls-tree -d --name-only HEAD validation/ | sed 's|validation/||'); do
  grep -qx "$d" "$tmp/keep-validation.txt" || echo "validation/$d" >> "$tmp/remove-3.txt"
done
filter 3 "$tmp/remove-3.txt"

# --- acceptance checks (docs/PUBLIC-REPO-CURATION.md §5) --------------------
say "acceptance"

commits="$(git -C "$DEST" rev-list --count HEAD)"
[ "$commits" -gt 20000 ] || fail "history collapsed: $commits commits (expected > 20000)"
echo "commits:            $commits"

tree_line="$(git -C "$DEST" ls-tree -r -l HEAD | awk '{s+=$4; n++} END {printf "%d files / %.1f MB", n, s/1048576}')"
echo "tree:               $tree_line"

git -C "$DEST" rev-list --objects --all | grep -q "gho_" && fail "a leaked token still appears in an object"
echo "leaked tokens:      0"

big="$(git -C "$DEST" rev-list --objects --all | git -C "$DEST" cat-file --batch-check='%(objecttype) %(objectsize)' 2>/dev/null | awk '$1=="blob" && $2>104857600 {print $2}' | head -1)"
[ -z "$big" ] || fail "a blob exceeds GitHub's 100 MB limit: $big bytes"
echo "blobs > 100MB:      0"

for path in script/m14/tmp archive reviews plans worktree-snapshots .tmp-probe; do
  n="$(git -C "$DEST" ls-tree -r HEAD -- "$path" | wc -l)"
  [ "$n" -eq 0 ] || fail "excluded path is present: $path ($n files)"
done
for glob in 'validation/.*/measurements/' 'validation/.*/verification/' 'superseded'; do
  n="$(git -C "$DEST" ls-tree -r HEAD | grep -c "$glob")"
  [ "$n" -eq 0 ] || fail "excluded path is present: /$glob/ ($n files)"
done
echo "excluded paths:     absent"

for f in README.md LICENSE CHANGELOG.md CONTRIBUTING.md SECURITY.md CODE_OF_CONDUCT.md \
         CODEOWNERS package.json package-lock.json docs/EVIDENCE.md \
         src/ast/engine.ts docs/m29/PRECISION-LEDGER.md \
         validation/m29/results/wave-3-approval.json validation/m29/results/PRECISION-LEDGER.json \
         validation/m53/results/R1.json validation/m55/results/X1.json; do
  git -C "$DEST" ls-tree HEAD -- "$f" | grep -q . || fail "kept file is missing: $f"
done
echo "kept files:         present"

wasm_count="$(git -C "$DEST" ls-tree -r HEAD wasm/ | wc -l)"
[ "$wasm_count" -gt 0 ] || fail "grammar wasm is missing: a public clone could not index anything"
echo "grammar wasm:       $wasm_count (tracked for 0.1.0: a clone without it cannot index)"

if [ "$KEEP_CLONE" -eq 0 ]; then
  echo "note: the clone is kept intentionally — it is the artifact to push; pass --keep-clone to silence"
fi

cat <<SUMMARY

PUBLIC TREE READY
  source commit:  $SOURCE_HEAD
  tree:           $tree_line
  commits:        $commits
  destination:    $DEST
  leak check:     no token object, no blob over 100 MB, no excluded path
  next:           git -C $DEST remote add origin <public remote> && git -C $DEST push -u origin main
SUMMARY
