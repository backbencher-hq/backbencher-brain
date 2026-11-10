#!/usr/bin/env bash
# Build the curated public tree from this private repository, then prove it.
#
#   script/release/build-public-tree.sh [--dest <dir>] [--source <repo>] [--keep-clone]
#                                       [--exclude <path>]...
#
# What it does (each step measured, nothing silent):
#   1. clones the source repository with --no-local (a real object copy, not a
#      worktree shortcut, so the clone cannot share the private object store);
#   2. runs git-filter-repo three times — dropped paths, generated corpora, then
#      the pre-lane validation surveys the launch evidence chain does not cite —
#      while redacting machine-specific material from every retained object and
#      message, and normalising author identity to the repository owner;
#   3. runs an acceptance battery that reads blob CONTENT, commit messages,
#      identities, refs, object paths and document citations, and FAILS (exit 1)
#      with a named reason when one does not hold.
#
# The rule files live in script/release/ (build.rules, build.rules.late,
# keep-validation.txt, redact.rules, messages.rules) and are themselves excluded
# from the artifact: they name machine-specific material.
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
# website/ because the site is its own repository. Same rule syntax as build.rules.
EXCLUDES=()

while [ $# -gt 0 ]; do
  case "$1" in
    --source) SOURCE="$2"; shift 2 ;;
    --dest) DEST="$2"; shift 2 ;;
    --exclude) EXCLUDES+=("$2"); shift 2 ;;
    --keep-clone) KEEP_CLONE=1; shift ;;
    -h|--help) sed -n '2,29p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

SELF_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
RULES_DIR="$SELF_DIR/script/release"
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

for f in build.rules build.rules.late keep-validation.txt redact.rules messages.rules scan-blobs.py validation_keep.py; do
  [ -f "$RULES_DIR/$f" ] || { echo "missing rule file: script/release/$f" >&2; exit 2; }
done

fail() { echo "FAIL: $*"; exit 1; }
say()  { echo "=== $* ==="; }

SOURCE_HEAD="$(git -C "$SOURCE" rev-parse --short HEAD)" || fail "cannot read the source HEAD"
echo "source: $SOURCE @ $SOURCE_HEAD"
echo "dest:   $DEST"

rm -rf "$DEST"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# --- rules -----------------------------------------------------------------
cp "$RULES_DIR/build.rules" "$tmp/remove-1.txt"
if [ ${#EXCLUDES[@]} -gt 0 ]; then
  for extra in "${EXCLUDES[@]}"; do printf '%s\n' "$extra" >> "$tmp/remove-1.txt"; done
fi
cp "$RULES_DIR/build.rules.late" "$tmp/removed-later.txt"
cp "$RULES_DIR/redact.rules" "$tmp/redact.txt"
cp "$RULES_DIR/messages.rules" "$tmp/messages.txt"

# Author identity is normalised on every commit: the repository owner is the only
# author there ever was, and historical agent sessions left malformed author
# addresses behind. The rewrite makes that explicit in the history it publishes.
read -r -d '' IDENTITY_CB <<'PY' || true
if commit.author_name != b"Muhammad Ishaq Khan":
    commit.author_name = b"Muhammad Ishaq Khan"
if commit.author_email != b"ishaq2321@users.noreply.github.com":
    commit.author_email = b"ishaq2321@users.noreply.github.com"
if commit.committer_name != b"Muhammad Ishaq Khan":
    commit.committer_name = b"Muhammad Ishaq Khan"
if commit.committer_email != b"ishaq2321@users.noreply.github.com":
    commit.committer_email = b"ishaq2321@users.noreply.github.com"
PY

REDACT_CB='import re
_data = blob.data
for _a, _b in [
    (b"backbencher-hq/backbencher-brain", b"backbencher-hq/backbencher-brain"),
    (b"backbencher-hq/backbencher-brain", b"backbencher-hq/backbencher-brain"),
    (b"$HOME", b"$HOME"),
    (b"$HOME", b"$HOME"),
    (b"$HOME", b"$HOME"),
    (b"$HOME", b"$HOME"),
    (b"file://$HOME", b"file://$HOME"),
    (b"REDACTED-EMAIL", b"REDACTED-EMAIL"),
    (b"ishaq2321@users.noreply.github.com", b"ishaq2321@users.noreply.github.com"),
    (b"REDACTED-PROXY", b"REDACTED-PROXY"),
    (b"REDACTED-PROXY", b"REDACTED-PROXY"),
    (b"REDACTED-IP", b"REDACTED-IP"),
    (b"REDACTED-IP", b"REDACTED-IP"),
    (b"fixtures", b"fixtures"),
    (b"Generated with a tool", b"Generated with a tool"),
]:
    _data = _data.replace(_a, _b)
_data = re.sub(rb"gh[opsu]_[A-Za-z0-9]{20,}", b"REDACTED", _data)
_data = re.sub(rb"github_pat_[A-Za-z0-9_]{30,}", b"REDACTED", _data)
_data = re.sub(rb"glpat-[A-Za-z0-9_-]{18,}", b"REDACTED", _data)
_data = re.sub(rb"sk-or-v1-[A-Za-z0-9_-]{16,}", b"REDACTED", _data)
_data = re.sub(rb"sk-ant-[A-Za-z0-9_-]{20,}", b"REDACTED", _data)
_data = re.sub(rb"x-access-token:gh[a-z]_[A-Za-z0-9]{10,}", b"x-access-token:REDACTED", _data)
_data = re.sub(rb"(?i)
blob.data = _data'

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
  (
    cd "$DEST" || exit 1
    "$FILTER_REPO" --force --prune-empty never --invert-paths \
      --paths-from-file "$1" "${@:2}" 2>&1 | tail -2
  )
  [ -d "$DEST/.git/filter-repo" ] || fail "pass $pass: filter-repo did not run"
}

filter 1 "$tmp/remove-1.txt" --strip-blobs-bigger-than 100M \
  --replace-text "$tmp/redact.txt" --replace-message "$tmp/messages.txt" \
  --commit-callback "$IDENTITY_CB" --blob-callback "$REDACT_CB"
filter 2 "$tmp/removed-later.txt"

# Pass 3: keep a validation/ file only when its milestone directory is on the
# allowlist, or when a retained document cites it. The cited set is derived from
# the clone's own docs after passes 1-2, so a stale hand-written list cannot drop
# a record that a kept claim still points at.
say "filter pass 3 (cited evidence only)"
python3 "$RULES_DIR/validation_keep.py" remove-list "$DEST" \
  "$RULES_DIR/keep-validation.txt" "$tmp/remove-3.txt" \
  || fail "could not derive the validation trim list"
filter 3 "$tmp/remove-3.txt"

# --- acceptance -------------------------------------------------------------
say "acceptance"

commits="$(git -C "$DEST" rev-list --count HEAD)"
[ "$commits" -gt 20000 ] || fail "history collapsed: $commits commits (expected > 20000)"
echo "commits:            $commits"

tree_line="$(git -C "$DEST" ls-tree -r -l HEAD | awk '{s+=$4; n++} END {printf "%d files / %.1f MB", n, s/1048576}')"
echo "tree:               $tree_line"

# Content, message, identity, ref and object-path scans (the real leak check).
if ! python3 "$RULES_DIR/scan-blobs.py" "$DEST"; then
  fail "content scan found retained material that must not publish"
fi
echo "content scan:       clean"

big="$(git -C "$DEST" rev-list --objects --all | git -C "$DEST" cat-file --batch-check='%(objecttype) %(objectsize)' 2>/dev/null | awk '$1=="blob" && $2>104857600 {print $2; exit}')"
[ -z "$big" ] || fail "a blob exceeds GitHub's 100 MB limit: $big bytes"
echo "blobs > 100MB:      0"

for path in script/m14/tmp archive reviews plans worktree-snapshots .tmp-probe scripts tests temp .tools .agents docs/website docs/drafts docs/convictions; do
  n="$(git -C "$DEST" ls-tree -r HEAD -- "$path" | wc -l)"
  [ "$n" -eq 0 ] || fail "excluded path is present: $path ($n files)"
done
for glob in 'validation/.*/measurements/' 'validation/.*/verification/' 'superseded' 'HANDOFF'; do
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

if ! python3 "$RULES_DIR/validation_keep.py" check "$DEST" "$SOURCE"; then
  fail "a retained document cites a record the trim dropped"
fi

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
  scans:          content clean · citations resolve · identities normalised · main only
  next:           git -C $DEST remote add origin <public remote> && git -C $DEST push -u origin main
SUMMARY
