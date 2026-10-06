# The hover-coverage gate cannot fail on the defects it exists to catch

Written by lane 6, task 3. Gated by `script/m55/verify-hover-coverage-redteam.ts`
(evidence `validation/m55/results/HOV-REDTEAM.json`).

`script/m55/verify-hover-coverage.ts` arrived at this lane as 1331 lines of
brand-new, never-reviewed gate, committed with the message
`HOV-COVERAGE: VERIFIED (13/13 passed)`. It generates the gap table in
`docs/HOVER-KNOWLEDGE-AUDIT.md` — the document the whole hover-audit effort rests
on. A gate that has only ever been *observed* passing is a gate of unknown
strength, so this lane tried to break it.

## Why its own mutants were not enough

The gate's R5 section is called "mutants (the measurement must be
falsifiable)" and reports 12/12. Reading them: **not one of them plants a defect
in the hover and observes the gate go red.**

| its mutant | what it actually does |
| --- | --- |
| M1 | asserts a property of the table the gate just built |
| M2 | probes `deriveCallSiteAddress` directly with three literals |
| M3 | runs the card PARSER over a hand-written string |
| M4 | compares the oracle's row count to its own location count |
| M5, M5/MUTANT ×2 | mutate an **in-memory array** (`{...d, hoverOpensCallSite:false}`) and re-apply the predicate |

Five of the twelve are simulations over hand-built values. That can distinguish
"my predicate is right" from "my simulation is right" only if the simulation is
independently correct — which is exactly the assumption under test. A gate whose
mutants are simulations of its own logic cannot fail on its own logic being
wrong.

## What this lane did instead

`script/m55/verify-hover-coverage-redteam.ts` makes **the gate binary the
oracle**. For each defect: mutate the real source file, run
`npx tsx script/m55/verify-hover-coverage.ts` as a subprocess, require the
*expected named check* to appear among the failures, then restore the file
byte-for-byte and prove the restore.

No shared predicates, no re-derived fixture, no in-process simulation. If the
gate were decorative, the subprocess would exit 0 and this harness fails.

It also had to share the fixture: `verify-hover-coverage.ts` was one module, so
importing it re-ran the whole 22-second gate. Lines 75–712 were extracted
verbatim into `script/m55/hover-coverage-fixture.ts`
(commit `c65eee129`) so the gate and its red-team drive the same `seed()`,
the same `know()` and the same `rendered()`.

## The three defects, and what happened

The fixture is the audit's own: 8 pinned symbols, 29 stored rows.

### D1 — a relationship kind the index holds, DROPPED FROM THE HOVER. **NOT CAUGHT.**

```ts
// src/lsp/relations.ts, the ONE owner of the relation vocabulary
-export const DECLARATION_RELATIONSHIPS = new Set(["contains", "exports"])
+export const DECLARATION_RELATIONSHIPS = new Set(["contains", "exports", "uses"])
```

Every incoming `uses` row is now reclassified as a declaration containment and
vanishes from the usages list. The index still holds the rows. The audit's
central question — *does hover render what the index knows?* — now has a wrong
answer.

```
gate result: VERIFIED 13/13, exit 0
```

**Why.** M1 is `renderedUsageRowCount > usageSiteDistinctLocations` — the
**over-claim** direction. The gate has no **under-claim** check at all. A hover
that renders *nothing* can never exceed the denominator, so dropping a whole
relationship kind is invisible to it.

This is the most serious finding in the lane. The gate that measures coverage
cannot detect coverage falling.

### D2 — a count that disagrees with the rendered list. **NOT CAUGHT.**

```ts
// src/lsp/rich_hover.ts, the usages section header
-`**usages** — ${usage.length} stored reference…`
+`**usages** — ${usage.length + 1} stored reference…`
```

The header claims one more usage than the list beneath it contains. §13.4 names
this exactly: *"Counts equal what is rendered. Header totals count the groups
the surface actually renders. A number the eye cannot verify against the list is
a violation."*

```
gate result: VERIFIED 13/13, exit 0
```

**Why.** The gate reads two numbers and never relates them:

- the headline count, via `/(\d+) usage/` — which matches `hover.ts:386`'s
  `**add** — method, 2 usages` line, driven by `data.usageCount`;
- the list rows, via `/^\d+\. \[/`.

And it never parses the usages **section** header
(`**usages** — N stored references`) at all, which is the number D2 corrupts.
The expected string `G8: the header count agrees with the list it headlines`
belongs to a *different* gate — `verify-hover.ts`'s G8, and only for the
zero-usage case.

### D3 — a fabricated evidence tier. **NOT CAUGHT** (and the first harness version "caught" it for the wrong reason).

```ts
// src/lsp/evidence_tier.ts, classifyTier — the ONE derivation rule
   if (REFERENCE_QUALIFIED_KINDS.has(t)) return "reference_qualified"
-  return "inferred"
+  return "structural"
```

A relationship kind the index never classifies now renders at **parser-fact
tier**. §12.3 and §14 rule 3 both forbid it.

The first working version of this harness judged a mutant "caught" if *any* new
check failed. D3 duly reported as caught — **by `R6/§3`, the warm-latency
check, which fired at p95 50.59 ms against a 50 ms budget.** Nothing about
latency has anything to do with evidence tiers.

That is worth recording as its own finding. A mutant caught by an unrelated
check is not caught; it is noise that happened to correlate. It is the §8.7
tautological oracle in a subtler costume than the one the contract names, and
the harness now requires the **named** check that owns the defect to fail. On
load average 9.5 the gate's latency check is flaky enough to manufacture false
catches on demand.

With that correction D3 is honestly reported as not caught: no check in the gate
compares a rendered tier against the tier the index stored.

## Verdict

```
HOV-REDTEAM RESULT: KNOWN-GAP — 10/12 passed
  - D1: …makes the EXPECTED check fail: expectedOne=<a check that does not exist> hit=NO
  - D2: …makes the EXPECTED check fail: expectedOne=<a check that does not exist> hit=NO
```

Three of the three planted defects — a silently dropped relationship kind, a
count that disagrees with its list, and a fabricated tier — are reported by the
gate as `VERIFIED (13/13 passed)`.

**The 13/13 in `docs/HOVER-KNOWLEDGE-AUDIT.md` is a true statement about 13
checks. It is not evidence that the gate would notice a lie.** Those are
different claims and only one of them is supported.

### What still works, and is worth keeping

- **H1** — a mutant that removes a required export **is** classified as a CRASH,
  and is explicitly *not* counted as a functional catch. This program's repeated
  lesson, implemented.
- **H2** — the positive control: the gate runs to a verdict on the clean tree
  and its failing set is recorded as the baseline.
- **H3** — all four mutations restored byte-for-byte; nothing left untracked
  under `validation/`; no scratch in the OS temp dir. The harness does not
  become the mutation-scratch leak it is hunting.
- The set-difference oracle: mutants are judged by which checks become **newly**
  failing, never by exit code, because on a loaded machine the gate's own §3
  latency check is legitimately red and an exit-code oracle would call every
  mutant "detected" for the wrong reason.

## The fix, if the owner wants the gate to be worth its 13/13

Three checks, each naming the defect class above. They are small, and two of them
need no new plumbing:

1. **Under-claim coverage.** For every pinned symbol, every kind in
   `distinctIncomingKinds` must appear in the rendered card **or** be named in a
   declared-absence line. Currently the gate records `kindsNamed` and never
   compares it to `incomingKinds`. Closes D1.
2. **Header/list agreement.** Parse the `**usages** — N stored references` header
   and assert `N === renderedUsageRowCount + rest`, where `rest` is the number the
   `+N more` line declares. Closes D2, and is §13.4 directly.
3. **Tier provenance.** For each rendered tier word, assert
   `isDeclaredTier(word)` and that the word appears on a row the index actually
   stored with that classification. Closes D3.

Not done in this lane, and said so rather than half-done: each needs a decision
about what "declared absence" means on the card for a kind the hover deliberately
does not verb (`contains`, `uses`, `references` — see
`docs/HOVER-GAP-VERIFICATION.md`), and writing the check before that decision
would bake an assumption into a gate.

## Numbers not in this document

- A mutation score for the gate. Three defects were planted; three were missed.
  That is not a percentage, it is three named holes.
- Whether the gate's *other* checks can fail. This harness tested three classes
  in files this lane owns. It says nothing about the checks in
  `verify-relations.ts`, `verify-signatures.ts`, or the M42 gates.
- Editor behaviour. Nothing here runs VS Code.
