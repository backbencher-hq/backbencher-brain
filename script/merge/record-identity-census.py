#!/usr/bin/env python3
"""Which of the merge's conflicted evidence records are ONE gate with two states,
and which are TWO DIFFERENT gates that happened to claim the same path?

The merge policy took origin/main's bytes for all 90 conflicted records, which is
right when both sides are the same gate at different generations — the fresher
content can be regenerated at the merged tree. It is NOT right when the two lines
independently assigned one evidence path to two different gates: then one gate's
record is destroyed by the merge, its own writer will overwrite the survivor the
next time it runs, and no amount of "regenerate at HEAD" can make both pass.

Identity is read from the record's own self-description — issueId, title,
claimLevel, check ids, schemaVersion — never from the path. For each conflicted
record this script prints which side held which identity, which side the ledger
took, and whether the losing side carried the M49 lineage fields (a lost
regeneration marker is the second-order cost of a collision: see M14.0.F7/F8).

Run: python3 script/merge/record-identity-census.py [--ledger <path>] [--out <json>]
"""

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_LEDGER = "reviews/merge/2026-09-25-main-into-recovery-re-earn-ledger.json"


def git(*args: str) -> str:
    return subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True).stdout.strip()


def show(rev: str, path: str):
    p = subprocess.run(["git", "show", f"{rev}:{path}"], cwd=ROOT, capture_output=True, text=True)
    if p.returncode != 0:
        return None
    try:
        return json.loads(p.stdout)
    except Exception:
        return None


def identity(d) -> dict:
    if d is None:
        return {"absent": True}
    # `checks` is a list in the gate-written records and a plain COUNT in some
    # older evidence files; both are identity, so both are kept as they are.
    checks = d.get("checks")
    if isinstance(checks, list):
        checks = [c.get("id") if isinstance(c, dict) else c for c in checks]
    return {
        "issueId": d.get("issueId"),
        "title": d.get("title"),
        "claimLevel": d.get("claimLevel"),
        "schemaVersion": d.get("schemaVersion"),
        "checks": checks,
    }


def classify(ia: dict, ib: dict) -> str:
    """ONE gate at two generations, or TWO gates that claimed one path?

    A gate's identity is its title, its issueId and the SET of its check ids. The
    check COUNT is not identity: a gate that grew three fixtures legitimately
    reports 13 where the other line reported 15 — that is the same gate, and
    treating it as a collision would drown the real ones (8 of the 10 raw
    mismatches in this merge are exactly that).
    """
    if ia.get("absent") or ib.get("absent"):
        return "same-gate"
    ta, tb = ia.get("title"), ib.get("title")
    if ta and tb and ta != tb:
        return "PATH COLLISION (two gates, one path)"
    ja, jb = ia.get("issueId"), ib.get("issueId")
    if ja and jb and ja != jb:
        return "PATH COLLISION (two gates, one path)"
    ca, cb = ia.get("checks"), ib.get("checks")
    if isinstance(ca, list) and isinstance(cb, list) and set(ca) != set(cb):
        return "PATH COLLISION (two gates, one path)"
    return "same-gate"


def checks_direction(ia: dict, ib: dict) -> str:
    ca, cb = ia.get("checks"), ib.get("checks")
    if isinstance(ca, list) and isinstance(cb, list):
        sa, sb = set(ca), set(cb)
        if sa == sb:
            return "equal"
        return "ours-more" if sa > sb else ("theirs-more" if sb > sa else "diverged")
    if isinstance(ca, int) and isinstance(cb, int):
        return "equal" if ca == cb else ("ours-more" if ca > cb else "theirs-more")
    return "n/a"


def main() -> int:
    ledger_path = ROOT / (
        sys.argv[sys.argv.index("--ledger") + 1] if "--ledger" in sys.argv else DEFAULT_LEDGER
    )
    out = ROOT / (sys.argv[sys.argv.index("--out") + 1]) if "--out" in sys.argv else None
    ledger = json.loads(ledger_path.read_text())
    parents = git("rev-list", "--parents", "-n", "1", "9cc08afd").split()
    ours, theirs = parents[1], parents[2]

    rows = []
    for r in ledger["records"]:
        path = r["path"]
        a, b = show(ours, path), show(theirs, path)
        ia, ib = identity(a), identity(b)
        same = classify(ia, ib) == "same-gate"
        rows.append(
            {
                "path": path,
                "conflictKind": r.get("conflictKind"),
                "resolvedTo": r.get("resolvedTo"),
                "verifier": r.get("verifier"),
                "classification": classify(ia, ib),
                "checksDirection": checks_direction(ia, ib),
                "ours": {**ia, "hasLineage": bool((a or {}).get("regeneratedAtCommit"))},
                "theirs": {**ib, "hasLineage": bool((b or {}).get("regeneratedAtCommit"))},
            }
        )

    collisions = [r for r in rows if r["classification"] != "same-gate"]
    lost_lineage = [
        r for r in rows
        if r["classification"] == "same-gate" and r["ours"]["hasLineage"] and not r["theirs"]["hasLineage"]
    ]
    out_doc = {
        "ledger": str(ledger_path.relative_to(ROOT)),
        "ours": ours,
        "theirs": theirs,
        "counts": {
            "records": len(rows),
            "sameGate": len(rows) - len(collisions),
            "pathCollisions": len(collisions),
            "sameGateLosingLineage": len(lost_lineage),
        },
        "collisions": collisions,
        "sameGateLosingLineage": lost_lineage,
        "all": rows,
    }
    for r in collisions:
        print(f"COLLISION {r['path']}")
        print(f"    ours   ({ours[:8]}): {r['ours'].get('issueId')} — {r['ours'].get('title')} | checks {r['ours'].get('checks')}")
        print(f"    theirs ({theirs[:8]}): {r['theirs'].get('issueId')} — {r['theirs'].get('title')} | checks {r['theirs'].get('checks')}")
        print(f"    merge took: {r['resolvedTo']} | lineage ours {r['ours'].get('hasLineage')} theirs {r['theirs'].get('hasLineage')}")
    for r in lost_lineage:
        print(f"LINEAGE LOST (same gate, ours carried the marker): {r['path']}")
    print(f"\n{len(rows)} records: {len(rows) - len(collisions)} same-gate, {len(collisions)} path collisions, "
          f"{len(lost_lineage)} same-gate records where our line alone carried lineage")
    if out:
        out.write_text(json.dumps(out_doc, indent=1) + "\n")
        print(f"written {out.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
