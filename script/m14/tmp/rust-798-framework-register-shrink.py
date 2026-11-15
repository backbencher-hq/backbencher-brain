#!/usr/bin/env python3
"""Pay down rust's R8 violation in validation/m60/framework-surface-register.json.

The register is shrink-only: an entry may disappear only when the census no
longer finds the site, i.e. when the SOURCE no longer contains it. Rust's
registered set was:

  * `missing-contract-key [framework (published: detectedFrameworks,
    frameworkPatterns)]` — a VIOLATION. The analyzer published two of the
    contract's three keys, so every consumer reading `framework` fell through to
    the engine's `"unknown"` default. FIXED in this round: the key is declared
    in the metadata literal and valued after the walk (RUST_FRAMEWORK_PRIORITY,
    a deterministic primary pick over the lane's own markers). The site is gone
    from the source, so the entry must go.
  * two `dominated-trigger` REPORTS (not violations) at the declared-type push
    and the read-resolution guard. Both sites are STILL in the source — the
    census still finds them, so they stay registered with their standing note.
    They are not removed here: a report that is still live is not debt paid
    down, and removing it would blind the gate to the class.

Run: python3 script/m14/tmp/rust-798-framework-register-shrink.py
"""
import json
import pathlib
import datetime

ROOT = pathlib.Path(__file__).resolve().parents[3]
P = ROOT / "validation/m60/framework-surface-register.json"
reg = json.loads(P.read_text())

paydown = [e for e in reg["entries"] if e.get("lang") == "rust" and e.get("verdict") == "violation"]
assert len(paydown) == 1, f"expected exactly one rust violation entry, found {len(paydown)}"
assert paydown[0]["shape"] == "missing-contract-key", paydown[0]["shape"]
kept = [e for e in reg["entries"] if e.get("lang") == "rust" and e.get("verdict") != "violation"]
assert len(kept) == 2, f"expected the two rust reports to stay live, found {len(kept)}"

before_v = reg["counts"]["violations"]
oo_before = reg["counts"]["ooViolations"]

reg["entries"] = [e for e in reg["entries"] if not (e.get("lang") == "rust" and e.get("verdict") == "violation")]
after_v = sum(1 for e in reg["entries"] if e.get("verdict") == "violation")
oo_after = sum(1 for e in reg["entries"] if e.get("verdict") == "violation" and e.get("lang") in
               ["csharp", "dart", "objc", "php", "python", "ruby", "swift"])
assert after_v == before_v - 1, f"violations {before_v} -> {after_v}: rust owned exactly one violation"

reg["counts"] = {"entries": len(reg["entries"]), "violations": after_v, "ooViolations": oo_after}
reg["shrunkBy"].append({
    "at": datetime.date.today().isoformat(),
    "phase": "rust framework surface — the R8 contract key (#798)",
    "removed": [
        "real-rust-analyzer.ts missing-contract-key [framework (published: detectedFrameworks, frameworkPatterns)] x1",
    ],
    "reduced": [],
    "grew": [],
    "violationsBefore": before_v,
    "violationsAfter": after_v,
    "ooViolationsBefore": oo_before,
    "ooViolationsAfter": oo_after,
    "note": "Every removal here is a site the census no longer finds, which means the source no longer contains it. That is the only way a registered violation may disappear. This one is a PAID-DOWN violation, not a drift: rust now declares all three contract keys (`framework`, `detectedFrameworks`, `frameworkPatterns`) in its metadata literal and values the primary pick after the walk (RUST_FRAMEWORK_PRIORITY), and the A/B against HEAD's analyzer measured the change as metadata-only — 0 symbols added/removed and 0 relationships added/removed on both corpora (script/m14/tmp/rust-798-r7r8-ab.ts). What was NOT removed: the lane's two `dominated-trigger` REPORTS (the declared-type push and the read-resolution guard) — those sites are still in the source, so they stay registered, and the class stays visible to the gate. A report that is still live is not debt paid down.",
})
P.write_text(json.dumps(reg, indent=2) + "\n")
print(f"entries {reg['counts']['entries']}, violations {before_v} -> {after_v}, oo {oo_before} -> {oo_after}")
print(f"shrunkBy entries: {len(reg['shrunkBy'])}; rust entries left: {len([e for e in reg['entries'] if e['lang'] == 'rust'])}")
