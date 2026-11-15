#!/usr/bin/env python3
"""POWERSHELL — DO THE RELEASED CLAIMS POINT AT FILES THAT EXIST?

The arbiter's own answer on the 30 released claims was UNVERIFIABLE ("the claim is
unreachable"), because a `$PSScriptRoot`-relative path is not a repo-relative path, so
`pathTargetInProject` has nothing to compare it against. So the arbiter cannot say whether
those claims were TRUE or FALSE — and a fix that discards a TRUE claim is a loss.

The question is answerable by RESOLUTION instead of by lookup: take the row's own source
file, substitute its directory for `$PSScriptRoot`, fold the `..` segments, and ask the
FILESYSTEM whether the file is there. A claim on a file that IS in the corpus was FALSE.

Usage:  python3 validation/m14/fixtures/powershell/resolve-relative-paths.py
"""
import json
import os
import re
import sys

RECON = "validation/m14/fixtures/powershell/measurements/arms/reconcile-BEFORE-AFTER.json"
SEP = chr(0)


def resolve(target: str, src: str):
    """The path a `$PSScriptRoot`-relative target names, or a verdict of why it names none."""
    # A POWERSHELL DRIVE (`TestDrive:\x.ps1`, `C:\x.ps1`) is a drive, not a directory in the
    # corpus, and it can name no project file at all.
    if re.match(r"^[A-Za-z][A-Za-z0-9]*:", target):
        return None, "DRIVE"
    if not target.startswith("$PSScriptRoot"):
        return None, "NOT-PSSCRIPTROOT"
    base = os.path.dirname(src)
    rel = target[len("$PSScriptRoot"):].replace("\\", "/")
    while rel.startswith("/"):
        rel = rel[1:]
    return os.path.normpath(os.path.join(base, rel)), "RELATIVE"


def main() -> int:
    if not os.path.isfile(RECON):
        print(f"no reconciliation at {RECON} — run the arms first")
        return 1
    with open(RECON, encoding="utf-8") as fh:
        rows = json.load(fh)["outcomeChanged"]

    print("the changed rows, and whether the released claim pointed at a file that EXISTS")
    print()
    tally = {}
    for row in rows:
        key, count, before, after = row[0], row[1], row[2], row[3]
        parts = key.split(SEP)
        label, target, src, line = parts[0], parts[1], parts[2], parts[3]
        path, kind = resolve(target, src)
        if path is None:
            verdict = kind
        elif os.path.exists(path):
            verdict = "EXISTS"
        else:
            verdict = "MISSING"
        print(f"  {verdict:16s} {before:19s} -> {after:19s} {label:11s} {target}")
        if path:
            print(f"                   {src}:{line}  ->  {path}")
        tally[(verdict, before, after)] = tally.get((verdict, before, after), 0) + 1

    print()
    print("THE TALLY — by verdict AND by the direction of the movement")
    for k in sorted(tally):
        print(f"  {k[0]:16s} {k[1]:19s} -> {k[2]:19s} {tally[k]}")

    def n(verdict, before):
        return sum(v for k, v in tally.items() if k[0] == verdict and k[1] == before)

    exist, missing = n("EXISTS", "externalUnverified"), n("MISSING", "externalUnverified")
    drive = n("DRIVE", "unresolved")
    other = n("EXISTS", "unresolved") + n("MISSING", "unresolved")
    print()
    print(f"  THE CLAIM WAS RELEASED on {exist + missing + other} rows:")
    print(f"    {exist} point at a file that EXISTS in the corpus -> the externality claim was")
    print(f"        FALSE, and the fix is right to withdraw it;")
    print(f"    {missing} point at a file that does NOT exist -> the claim was TRUE, and the fix")
    print(f"        discarded a true claim (this is the cost, stated plainly);")
    print(f"    {other} are neither shape.")
    print(f"  THE CLAIM WAS GAINED on {drive} rows, and all {drive} are DRIVE-QUALIFIED (a PowerShell")
    print(f"    drive, which can name no project file), so the claim is TRUE and the arbiter agrees.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
