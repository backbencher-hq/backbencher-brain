#!/usr/bin/env python3
"""
MUTANT HARNESS for the python `implements` rule.

Two properties this has and a shell loop does not:

  1. It VERIFIES each mutation actually changed the file before running the suite, and
     reports `NOT APPLIED` as a failure in its own right. Three mutants in the first pass
     of this work reported "0 failing fixtures" - and two of them had never been applied at
     all, because a shell single-quoted `python3 -c` does not interpret `\\n` and the
     multi-line pattern simply never matched. Reading "0 failing" as "mutant survived" is
     the wrong conclusion in the same way as reading it as "mutant caught": both are
     statements about a mutation that may not exist.

  2. It classifies the outcome. A mutant that fails a fixture is CAUGHT. One that passes is
     a SURVIVOR, and the honesty contract says a surviving mutant fails the suite rather
     than the mutant. One whose change is provably a no-op is EQUIVALENT and must be
     reported as such - an equivalent mutant is a fact about the code (a redundant guard),
     not a fact about the tests.

Usage:  python3 script/m14/python-implements-mutants.py [--verbose]
"""
import hashlib
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TARGET = ROOT / "src" / "ast" / "real-python-analyzer.ts"

MUTANTS = [
    {
        "id": "implements/branch-disabled",
        "what": "the whole `implements` route disabled - re-opens the GAP the workstream measured",
        "old": "          const ifaceKind = ctx.interfaceBindings ? this.interfaceBaseKind(arg, ctx.interfaceBindings) : null",
        "new": "          const ifaceKind: string | null = null",
        "expect": "CAUGHT",
    },
    {
        "id": "implements/double-label",
        "what": "an interface base emits BOTH implements and extends - one syntactic fact, two rows",
        "old": """          this.pushRel(ctx, className, baseLeaf, ifaceKind
            ? ASTEngine.RelationshipType.Implements
            : ASTEngine.RelationshipType.Extends, 1.0, {""",
        "new": """          this.pushRel(ctx, className, baseLeaf, ASTEngine.RelationshipType.Extends, 1.0, {
            /* MUTANT */
          })
          if (ifaceKind) this.pushRel(ctx, className, baseLeaf, ASTEngine.RelationshipType.Implements, 1.0, {""",
        "expect": "CAUGHT",
    },
    {
        "id": "implements/spelling-proof",
        "what": "the proof keys on the NAME instead of the binding - fabricates on every user class called ABC/Protocol",
        "old": """    const isDotted = base.type === "attribute"
    if (!isDotted) {""",
        "new": """    if (leaf === "ABC" || leaf === "ABCMeta" || leaf === "Protocol") return "abc"
    const isDotted = base.type === "attribute"
    if (!isDotted) {""",
        "expect": "CAUGHT",
    },
    {
        "id": "implements/bare-route-on-dotted",
        "what": "PY-26 reverted: the bare-name proof fires on a DOTTED base, so `vendor.Protocol` is relabelled as the stdlib's",
        "old": '    const isDotted = base.type === "attribute"',
        "new": '    const isDotted = false',
        "expect": "CAUGHT",
    },
    {
        "id": "implements/dotted-root-unproven",
        "what": "a dotted spelling proves itself with no root-import condition",
        "old": "      if (ib.importRoots.has(root)) {",
        "new": "      if (true) {",
        "expect": "CAUGHT",
    },
    {
        "id": "implements/register-no-proof",
        "what": "`.register(Y)` emits without a proven receiver - the 492-homonym fabrication",
        "old": "            if (kind) {",
        "new": "            if (true) {",
        "expect": "CAUGHT",
    },
    {
        "id": "implements/generic-accepted",
        "what": "typing.Generic treated as an interface - 291 base occurrences, a type-parameter marker",
        "old": '    const isDotted = base.type === "attribute"',
        "new": """    if (leaf === "Generic") return "typing"
    const isDotted = base.type === "attribute\"""",
        "expect": "CAUGHT",
    },
    {
        "id": "implements/alias-reads-bound-name",
        "what": "an aliased import tests the BOUND name instead of the IMPORTED one - `from abc import ABC as BaseABC` stops proving",
        "old": '          const importedLeaf = imported.slice(imported.lastIndexOf(".") + 1)',
        "new": "          const importedLeaf = bound",
        "expect": "CAUGHT",
    },
    {
        "id": "implements/typing-extensions-dropped",
        "what": "typing_extensions stops proving Protocol - pydantic writes it in 21 of its base lists",
        "old": '          } else if (mod === "typing" || mod === "typing_extensions") {',
        "new": '          } else if (mod === "typing") {',
        "expect": "CAUGHT",
    },
    {
        "id": "implements/collections-abc-narrowed",
        "what": "collections.abc bases stop proving - the stdlib interface catalogue, 24 proven bases in this corpus",
        "old": '          } else if (mod === "collections.abc") {',
        "new": '          } else if (mod === "__never__") {',
        "expect": "CAUGHT",
    },
    {
        "id": "implements/enum-signed-numeric",
        "what": "PY-27 reverted: a signed numeric enum value is not constant, so `unsafe = -1` publishes no member",
        "old": "          if (right && (signedNumeric || right.type === \"string\" || right.type === \"integer\" ||",
        "new": "          if (right && (false || right.type === \"string\" || right.type === \"integer\" ||",
        "expect": "CAUGHT",
    },
    {
        "id": "implements/r7-qualification-removed",
        "what": "the R7 endpoint qualification removed - the 7 placeholder-literal edges return",
        "old": "        this.pushRel(ctx, owner, qualifyReservedEndpoint(s.name, owner), ASTEngine.RelationshipType.Contains, 1.0, {}, s.range?.startLine)",
        "new": "        this.pushRel(ctx, owner, s.name, ASTEngine.RelationshipType.Contains, 1.0, {}, s.range?.startLine)",
        "expect": "CAUGHT",
    },
    {
        "id": "implements/r7-qualification-indiscriminate",
        "what": "the R7 endpoint qualification applied to EVERY member - the fabrication direction",
        "old": """function qualifyReservedEndpoint(name: string, owner: string): string {
  return RESERVED_ENDPOINT_NAMES.has(name) ? `${owner}.${name}` : name
}""",
        "new": """function qualifyReservedEndpoint(name: string, owner: string): string {
  return owner ? `${owner}.${name}` : name
}""",
        "expect": "CAUGHT",
    },
]


def digest() -> str:
    return hashlib.sha256(TARGET.read_bytes()).hexdigest()


def run_fixtures() -> tuple[int, list[str]]:
    proc = subprocess.run(
        ["bun", "script/m14/run-fixtures.ts", "--lang", "python"],
        cwd=ROOT, capture_output=True, text=True, timeout=1200,
    )
    fails = [l.split()[1] for l in proc.stdout.splitlines() if l.startswith("FAIL")]
    return len(fails), fails


def main() -> int:
    verbose = "--verbose" in sys.argv
    original = TARGET.read_text()
    base_digest = hashlib.sha256(original.encode()).hexdigest()

    n0, f0 = run_fixtures()
    print(f"control (unmutated): {n0} failing fixture(s) {f0}")
    if n0 != 0:
        print("CONTROL IS RED - the suite must be green before a mutant result means anything.")
        TARGET.write_text(original)
        return 2

    results = []
    for m in MUTANTS:
        if m["old"] not in original:
            results.append((m, "NOT APPLIED", [], "pattern absent from the source"))
            continue
        TARGET.write_text(original.replace(m["old"], m["new"], 1))
        if digest() == base_digest:
            TARGET.write_text(original)
            results.append((m, "NOT APPLIED", [], "replacement was a no-op"))
            continue
        try:
            n, fails = run_fixtures()
        finally:
            TARGET.write_text(original)
        verdict = "CAUGHT" if n > 0 else "SURVIVED"
        results.append((m, verdict, fails, ""))
        if verbose and n == 0:
            print(f"    {m['id']}: survived with 0 failures")

    print()
    print(f"{'mutant':44} {'verdict':12} caught by")
    print("-" * 110)
    bad = 0
    for m, verdict, fails, why in results:
        print(f"{m['id']:44} {verdict:12} {', '.join(fails) if fails else why}")
        if verdict != m["expect"]:
            bad += 1

    print()
    caught = sum(1 for _, v, _, _ in results if v == "CAUGHT")
    survived = sum(1 for _, v, _, _ in results if v == "SURVIVED")
    notapplied = sum(1 for _, v, _, _ in results if v == "NOT APPLIED")
    print(f"{caught} caught · {survived} survived · {notapplied} not applied · of {len(results)}")
    print()
    for m, verdict, _, why in results:
        print(f"  {verdict:12} {m['id']}")
        print(f"               {m['what']}")
        if why:
            print(f"               {why}")

    TARGET.write_text(original)
    print()
    print("ANALYZER RESTORED to the unmutated source" if digest() == base_digest else "RESTORE FAILED")
    # A surviving mutant fails the suite, not the mutant (docs/M14-HONESTY-CONTRACT.md 5.3).
    if survived or notapplied:
        print(f"SUITE FAILS: {survived} surviving, {notapplied} unapplied.")
        return 1
    print("every mutant was applied and caught.")
    return 0


if __name__ == "__main__":
    sys.exit(main())