# PROPOSAL — add vb's `LANG_CONFIG` (ready to paste); ADMISSION IS CONDITIONAL ON THE FIXTURE SUITE

**From: vb lane owner. State: A/B/C/D/G/H ready by construction; E/F are the Lead's sweep; the fixture suite
is 2 pass / 3 fail at HEAD and that is the one thing standing between this lane and CONFORMANT.** Lane memory:
`validation/m14/verification/VB-STATE.md`.

## THE CONFIG — `script/m14/completeness-inventory.ts`, inside `LANG_CONFIGS`

```ts
  // VB joins the SPEC gate (2026-10-17). THE WASM IS VENDORED AND REPAIRED: wasm/tree-sitter-vbnet.wasm is
  // built from grammars/tree-sitter-vbnet (grammar-pins.json lanes.vb.vendored.state = "vendored"), so its
  // node-type universe is the PINNED VENDORED artifact and a drift question is answered from
  // validation/m14/grammar-pins.json, never from an upstream release.
  // Section A: 450 slots -> 166 unique NAMED + 283 ANONYMOUS + ERROR/MISSING = 168, split 146 handled /
  // 22 silent, 0 unclassified. Section B: all ten kinds emitted AND pinned. Section C: cyclomaticComplexity
  // is published; vb/loop-and-using-bindings pins fileEquals 3. Section D: 3 tiers already pinned.
  // THE LANE'S HEADER WAS ALREADY WRITTEN and satisfies all four section-G checks (author, docs path,
  // relationship kinds, co-edit list incl. the vendored grammar's PIN.md).
  vb: {
    id: "vb",
    wasm: "tree-sitter-vbnet.wasm",
    classification: "vb-completeness.json",
    fixturesDir: "validation/m14/fixtures/vb",
    docs: ["docs/analyzers/vb.md"],
    // perfKey is SWEEP-OWNED: no vb key exists in differential-baseline.json (188 keys) and no
    // differential-vb exists in M14.0.F5.json. Rename if the sweep pins a repo-qualified corpus.
    perfKey: "vb",
    requiredKinds: ["contains", "imports", "references", "calls", "uses", "extends", "implements",
                    "overrides", "instantiates", "exports"],
    payloads: {
      complexity: { key: "expectComplexity", pin: "vb/loop-and-using-bindings (fileEquals 3)" },
    },
    title: "vb pass (SPEC admission)",
  },
```

Then, after the E/F sweep and the fixture reconciliation below: `GATED_LANGS` += `"vb"`.

## WHY ADMISSION MUST WAIT — the fixture suite is 2 pass / 3 fail at HEAD

`bun run script/m14/run-fixtures.ts --lang vb` → `{"vb":{"pass":2,"fail":3}}`, failing
`edge-endpoint-integrity`, `member-read-and-construction`, `ontology-exports-instantiates-uses`.

**Cause, measured: the ANALYZER was repaired and committed 2026-10-17 18:05 (`analysisVersion "m60-vb-1"`) and
the EXPECTATIONS were not re-aligned** (they are 2026-10-08):
* the repaired analyzer emits `instantiates Trace -> StackFrame` with metadata
  `constructedType` / `constructsArray` / `constructionNode`, while the expectation asserts the OLD key
  `meta.qualifiedConstruction: false` — the edge is right, the pinned key was replaced;
* `metadata.vbGaps` expects `construction-without-readable-name: 1`; the repaired analyzer emits
  `tuple-type-has-no-single-name: 1` (the fix removed the old gap class and introduced a new one);
* `member-read-and-construction.vb` has **no expectation file at all**, so the runner fails it with
  "missing expectation file".

This is a **hand-off gap**, not a lane defect and not something to paper over by deleting rows: the
expectations must be reconciled against the repaired analyzer by whoever owns that repair (or by a follow-up
with the mutation logs `mutation-log-m60-vb2.md` / `mutation-log-m60-visual-basic.md` in hand). Section B only
reads KIND names from expectations, so 8/8 can be reached mechanically — **admission on 8/8 while three
fixtures are red is exactly the pin-vs-gate trap; the gate would certify a lane whose own evidence fails.**

## THE PIN IS STALE — your files, not touched

`validation/m14/grammar-pins.json` describes the PREVIOUS build of the vendored grammar:

```
wired sha256   pin c6182994…   · disk 4d8d8e0e…
wired bytes    pin 4,073,046   · disk 4,083,368
grammar.js     pin 74,567 B    · disk 76,000 B
surface        pin 449 ids / 165 namedUnique · disk 450 / 166
```
**The spec matches the wired wasm (145+21 = the current 166 named types, 0 stale), so the SPEC is current and
the PIN is stale** — a drift check reading the pin today would wrongly accuse the lane. Re-record the vb entry
after this pass and let `PIN.md` carry the patch that produced the rebuild.

## VERIFY ONCE THE CONFIG IS IN

```
bun run script/m14/completeness-inventory.ts --lang vb   # expect A,B,C,D,G,H pass; E/F until the sweep
bun run script/m14/run-fixtures.ts --lang vb             # currently 2/3 — the admission blocker
```
