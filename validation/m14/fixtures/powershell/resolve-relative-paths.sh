#!/usr/bin/env bash
# POWERSHELL — DO THE RELEASED CLAIMS POINT AT FILES THAT EXIST?  The arbiter's own answer was
# "UNVERIFIABLE" on 30 of them, so the arbiter CANNOT settle whether those claims were true. This
# script settles it a different way: it RESOLVES each released path against the corpus and reports
# whether a file is actually there.
#
# ## WHY THIS QUESTION, AND WHY THE ARBITER CANNOT ANSWER IT
#
# The arm moved 33 rows. 30 of them lost an externality claim (externalUnverified -> unresolved) and
# 3 gained one (unresolved -> externalUnverified). The arbiter's census says of the 30: UNVERIFIED —
# "the claim is unreachable" — because a `$PSScriptRoot`-relative path is not a repo-relative path, so
# `pathTargetInProject` has nothing to compare it against. **So the arbiter cannot say whether those
# 30 claims were TRUE or FALSE, and a fix that discards a TRUE claim is a loss.**
#
# The question is answerable by RESOLUTION instead of by lookup: take the row's own source file,
# substitute its directory for `$PSScriptRoot`, fold the `..` segments, and ask the FILESYSTEM whether
# the file is there. A claim on a file that IS in the corpus was FALSE. A claim on a file that is NOT
# was TRUE, and the fix discarded a true claim.
#
# ## WHAT IT REPORTS
#
#   · each of the 33 changed rows, with the resolved path and EXISTS / MISSING;
#   · the totals, split by the direction of the movement;
#   · and the DRIVE-QUALIFIED rows separately, because a `TestDrive:` path is a POWERSHELL DRIVE
#     (Pester's virtual drive) and can name no project file at all.
#
# Usage:  bash validation/m14/fixtures/powershell/resolve-relative-paths.sh
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$ROOT"
RECON="validation/m14/fixtures/powershell/measurements/arms/reconcile-BEFORE-AFTER.json"
CORPUS="$PWD/.corpus"

if [ ! -f "$RECON" ]; then
  echo "no reconciliation at $RECON — run the arms first"
  exit 1
fi

python3 - "$RECON" "$CORPUS" <<'PY'
import json, os, re, sys

recon_path, corpus = sys.argv[1], sys.argv[2]
d = json.load(open(recon_path))
rows = d["outcomeChanged"]
SEP = "\x00"

def split(row):
    # a row is [key, count, beforeOutcome, afterOutcome], and the key is
    # `label SEP target SEP srcFile(with :line)`
    key, count, before, after = row[0], row[1], row[2], row[3]
    # the key is `label SEP target SEP srcFile SEP line` — FOUR parts, the line separate
    label, target, src, line = key.split(SEP)
    return label, target, src, before, after, count, line

def resolve(target, src):
    # the source file's path is the third key part; the line is the fourth
    file = src
    # a POWERSHELL DRIVE: `TestDrive:\...`, `C:\...` — a drive is not a directory in the corpus
    if re.match(r"^[A-Za-z][A-Za-z0-9]*:", target):
        return None, "DRIVE"
    if not target.startswith("$PSScriptRoot"):
        return None, "NOT-PSSCRIPTROOT"
    base = os.path.dirname(file)
    rel = target[len("$PSScriptRoot"):].lstrip("\\/")
    if rel.startswith("\\") or rel.startswith("/"):
        rel = rel[1:]
    return os.path.normpath(os.path.join(base, rel.replace("\\", "/"))), "RELATIVE"

print(f"the 33 changed rows, and whether the released claim pointed at a file that EXISTS")
print(f"corpus root: {corpus}\n")
tally = {}
rows_out = []
for row in rows:
    label, target, src, after = split(row)
    path, kind = resolve(target, src)
    if path is None:
        verdict = kind
    elif os.path.exists(path):
        verdict = "EXISTS"
    else:
        verdict = "MISSING"
    rows_out.append((label, target, src, before, after, verdict, path, line))
    key = (verdict, before, after)
    tally[key] = tally.get(key, 0) + 1

for label, target, src, before, after, verdict, path, line in rows_out:
    print(f"  {verdict:16s} {before:19s} -> {after:19s} {label:11s} {target}")
    if path:
        print(f"                   resolved: {path}")

print()
print("THE TALLY — by verdict AND by the direction of the movement")
for k, v in sorted(tally.items()):
    print(f"  {k[0]:16s} {k[1]:19s} -> {k[2]:19s} {v}")
def n(verdict, before):
    return sum(v for k, v in tally.items() if k[0] == verdict and k[1] == before)
exist = n("EXISTS", "externalUnverified")
missing = n("MISSING", "externalUnverified")
drive = n("DRIVE", "unresolved")
other = n("EXISTS", "unresolved") + n("MISSING", "unresolved")
print()
print(f"  THE CLAIM WAS RELEASED on {exist + missing + other} rows:")
print(f"    {exist} of them point at a file that EXISTS in the corpus -> the externality claim was")
print(f"        FALSE, and the fix is right to withdraw it;")
print(f"    {missing} point at a file that does NOT exist -> the claim was TRUE, and the fix")
print(f"        discarded a true claim (this is the cost, stated plainly);")
print(f"    {other} are neither shape.")
print(f"  THE CLAIM WAS GAINED on {drive} rows, and all {drive} are DRIVE-QUALIFIED (a PowerShell")
print(f"    drive, which can name no project file), so the claim is TRUE and the arbiter agrees.")
PY
