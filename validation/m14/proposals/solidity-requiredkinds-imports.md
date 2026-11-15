# PROPOSAL (solidity) — add `imports` to the inventory row's `requiredKinds`; the lane emits it, pins it, and section B is the only section that fails

**From:** solidity lane owner · **date:** 2026-10-17 · **branch:** `analyzers/ontology-laptop-b`
**Touches:** `script/m14/completeness-inventory.ts` (Lead-owned — this lane may not edit it).
**Evidence:** `bun run script/m14/completeness-inventory.ts --lang solidity` (rc=1), the whole-population firing,
and the fixture pin landed with this proposal.

## THE ROW — THE ONLY FAILING SECTION

```
solidity SECTIONS:
  pass  section-a-structural          126 types, 98 handled, 21 silent, 0 gaps, 7 decisions
  FAIL  section-b-relationship-kinds  EMITTED but absent from requiredKinds: imports
  pass  section-c-payload-matrix      complexity
  pass  section-d-evidence-tiers      4 tier(s) pinned
  pass  section-e-differential        floor solidity:solidity: missing=2, unexplained=21 — expected 2/21 per SOL-SCOPE
  pass  section-f-perf-budget         solidity:solidity 5.3 ms/file
  pass  section-g-docs                docs/analyzers/solidity.md
  pass  section-h-cross-language      12 checks pass
```
**7 of 8.** This lane's E and F ALREADY PASS (the row carries its floor and its perf key), so **the one-line change
below is the whole distance to 8/8.**

## WHY THE KIND IS REAL — MEASURED, NOT ASSUMED

`imports` is emitted from `src/ast/real-solidity-analyzer.ts:2714`, one edge per import PATH
(`import {A, B} from "./X.sol"` is ONE file dependency, not one per imported name — a name would assert the
file dependency N times). The emission has its own history in the source comment: the type was **parsed,
labelled and never emitted** (`grep -c RelationshipType.Imports` was 0), so a file could import six modules
and the graph recorded no dependency on any of them — the dependency existed only as a `references` edge
carrying `import: true`, a claim about a NAME. The type was added to close that gap.

Whole-population firing — `npx tsx script/m14/firing-check.ts --files 1000000 --json solidity`:
```
421/421 files · 35,107 edges · 0 degraded · 0 parse failures · 10 of 10 types fired
calls 6,734 · uses 17,880 · contains 6,531 · IMPORTS 932 · references 1,452 · exports 534
extends 588 · implements 7 · overrides 423 · instantiates 26 · silent: NONE
```
The spec already classifies it: `script/m14/spec/solidity-completeness.json` →
`coverage.implemented` = all ten types including `imports`, measured over the whole 421-file population on
2026-10-14 (0 parse failures, 0 degraded). **The inventory row is the only place in the repository that did not
know.**

## THE FIX — one line, plus the pin that makes it honest

```ts
// script/m14/completeness-inventory.ts, solidity config (~:1016)
requiredKinds: ["calls", "extends", "implements", "instantiates", "uses", "references", "contains", "overrides", "exports", "imports"],
```
The forward check (required ⇒ pinned) stays green because **the fixture half is landed with this proposal**:
`validation/m14/fixtures/solidity/all-kinds-sol.expectation.json` now carries
- **three `imports` rows** — `all-kinds-sol.sol → ./IERC20.sol` (braced), `→ ./Utils.sol`
  (`meta.isNamespaceImport`), `→ ./Bare.sol` (bare form) — with the exact metadata the production probe shows;
- **a count pin `{type: "imports", equals: 3}`**, which is what distinguishes per-PATH from per-NAME emission
  (a per-name loop would emit 4 here);
- a **corrected `note`**: the fixture previously said *"`imports` has NO construct in Solidity and is modelled as
  an import-annotated `references` edge"* — that sentence is the pre-emission state and is now falsified by the
  analyzer. It is quoted in the corrected note rather than deleted, because the fixture was right when written
  and the type was added afterwards.
Suite after the pin: `{"solidity":{"pass":32,"fail":0}}`, `fixture baseline gate: no regressions`.

## WHAT I DID NOT DO

I did not edit `completeness-inventory.ts` (yours), and I did not add `imports` to the spec (it already names
it in `coverage.implemented`; the spec has no `requiredKinds` field — the inventory row is the contract).
