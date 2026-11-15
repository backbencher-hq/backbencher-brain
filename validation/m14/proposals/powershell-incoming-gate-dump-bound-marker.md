# PROPOSAL (powershell) — the incoming gate's `--dump` bound is NEVER PRINTED, so a truncated dump is indistinguishable from a whole one

**From:** powershell lane owner · **date:** 2026-10-20 · **branch:** `analyzers/ontology-laptop-b`
**Touches:** `script/m14/incoming-gate.ts` (Lead-owned) — this lane cannot edit it.
**Evidence:** this lane's own row-level reconciliation tool, and a direct reading of the gate.

## THE FINDING

`script/m14/incoming-gate.ts:158-162` — the gate's own header for `--dump`:

```
// So `--dump` prints the rows themselves -- one TSV line per NON-RESOLVED edge:
//   label · outcome · target · srcFile:line · claimKind
// Bounded by BB_DUMP_LIMIT (default 40) so a whole-corpus run cannot flood a report,
// and the bound is PRINTED when reached, so a short list is never mistaken for the set.
// Read-only: it changes no count, no tally and no exit code.
```

**The bound is NOT printed. Measured:** `BB_DUMP_LIMIT` occurs in the gate at exactly three places —


| line | what it is |
|---|---|
| 161 | the comment quoted above |
| 166 | `const BB_DUMP_LIMIT = Number(process.env.BB_DUMP_LIMIT ?? 40)` |
| 1965 | the guard `bbDumped < BB_DUMP_LIMIT` |

and there is **no `console.log` anywhere in the file that mentions the limit, the bound, or the dump
having been cut short**. So a dump cut at 40 rows and a dump holding every non-resolved row are
**byte-shaped the same way**, and a reader cannot tell them apart. The header's promise — "so a
short list is never mistaken for the set" — is not kept by the code.

**THIS IS NOT COSMETIC, AND THIS LANE NEEDED IT.** A row-level reconciliation of a whole-population
arm needs the dump to be WHOLE, and the gate offers no way to know that it is. The lane's
reconciliation tool therefore had to build its own completeness check from the gate's own output:

> the dump prints exactly the NON-RESOLVED rows (`pc.outcome !== "resolved"`), and the gate's TOTAL
> row prints `edges` and `resolved`, so **`dump rows == edges - resolved`** for a whole dump.

That check is sound, and it is implemented in
`validation/m14/fixtures/powershell/row-reconciliation.mts` (this lane's file) — but it is a
WORKAROUND for a promise the gate makes and does not keep, and the natural place for the answer is
the gate that has the number in hand.

## THE ASK — one print, in the place that knows

After the edge loop, print the bound when it was reached. The counter `bbDumped` is already in
scope at the `console.log` on `:1965`, and the TOTAL row is printed later by `printReport`, so the
marker lands in the same log as the rows it qualifies.

```ts
// THE BOUND, PRINTED WHEN IT IS REACHED. The header above says "the bound is PRINTED when
// reached, so a short list is never mistaken for the set" — and no such print existed, so a
// dump cut at BB_DUMP_LIMIT rows was indistinguishable from a whole one. ONE line, in the
// place that already knows the count, and the promise in the header is kept.
if (BB_DUMP && bbDumped >= BB_DUMP_LIMIT) {
  console.log(`DUMP\tBOUND\t${BB_DUMP_LIMIT}\t— the dump was CUT at ${bbDumped} row(s); this is NOT the whole set.`)
}
```

`BB_DUMP_LABEL` deserves the same care and already has it: the gate's own comment says "a filter
that is applied AFTER a bound is not a filter", and `BB_DUMP_LABEL` is applied before the bound —
so a labelled dump that hits the bound is a PARTIAL view of ONE label, and the marker above says so
for that case too.

## WHY THIS LANE DID NOT FIX IT

`script/m14/incoming-gate.ts` is the shared arbiter and the Lead's file. This lane has not edited it
and will not. The lane's own workaround is stated above, is implemented in the lane's own
reconciliation tool, and is cross-checked against the gate's own TOTAL row — so the lane's numbers
do not depend on the gate growing a print. The proposal is filed so the promise in the header and
the behaviour of the code agree.

## A SECOND, SMALLER THING IN THE SAME FILE, FOR THE SAME REASON

`BB_DUMP_LIMIT` defaults to 40 and the dump is the ONLY per-edge view the gate offers. A
whole-population lane therefore has to know the variable's name and raise it
(`BB_DUMP_LIMIT=100000000`) to get a whole set — and the variable is documented only in a comment
inside the gate, not in the gate's `--help` or in any lane-facing doc this lane could find. A one-line
mention in the gate's own usage text would save the next lane the archaeology. Not required for the
fix; recorded because the lane spent real time on it.
