# PROPOSAL — add `protobuf` to `completeness-inventory.ts` (`LANG_CONFIGS` + `GATED_LANGS`)

**For the Lead (owner of `script/m14/completeness-inventory.ts`). NOT applied by me.**
Measured 2026-10-17 with a mirrored copy of the gate carrying the entry below:
**6 of 8 sections PASS (A, B, C, D, G, H); E and F fail only because no baseline row exists for the lane.**
That is the expected INVENTORY-DONE state: E/F are the Lead's `differential-baseline.json` sweep and no
`--update-baseline` was run.

## 1 · READY-TO-PASTE `LANG_CONFIGS` ENTRY

```ts
  protobuf: {
    id: "protobuf",
    wasm: "tree-sitter-protobuf.wasm",
    classification: "protobuf-completeness.json",
    fixturesDir: "validation/m14/fixtures/protobuf",
    docs: ["docs/analyzers/protobuf.md"],
    differentialCheck: "differential-protobuf",
    perfKey: "pb-googleapis:protobuf",
    requiredKinds: ["contains", "exports", "imports", "overrides", "uses"],
    payloads: {
      imports: { key: "expectImports", pin: "protobuf/dotted-relative-sibling-package" },
      metadata: { key: "expectMetadata", pin: "protobuf/imports-and-editions" },
      symbolRanges: { key: "expectSymbolRanges", pin: "protobuf/absolute-and-scope-resolution" },
      relationshipCount: { key: "expectRelationshipCount", pin: "protobuf/declaration-lines" },
    },
    title: "protobuf schema wave (PB-REL rulings)",
  },
```

## 2 · `GATED_LANGS` ADDITION
Append `"protobuf"`.

## 3 · WHY EACH FIELD (measured, not guessed)
- **wasm** `tree-sitter-protobuf.wasm`: 132 node-type slots = **50 distinct named + 82 anonymous**; with the gate's
  implicit `ERROR`/`MISSING` its classified set is 52.
- **classification** — the spec was in the PRE-GATE schema (prose lists: `handled_verified` held KIND names,
  `internal_silent`/`gap` held sentences), so `loadSpec` read an EMPTY classification. Converted 2026-10-17 to the
  gate schema with every prose record preserved: handled 35 (analyzer-referenced, oracle-validated), silent 11,
  gap 2, decision 22; **section A: 0 unclassified, 0 stale.**
- **requiredKinds** — emitted over the 13 expectation-described sources = pinned = these FIVE kinds exactly:
  contains, exports, imports, overrides, uses. The forward and reverse checks both close.
- **payloads** — each key is a real non-empty array in a named expectation (pins above); `expectComplexity` /
  `expectParameters` do not exist in this lane's fixtures, so the payload matrix names what the lane actually pins.
- **perfKey `pb-googleapis:protobuf`** — the lane's corpus is `pb-googleapis` (the firing row says
  `[corpus=pb-googleapis WHOLE]`). **NO ROW EXISTS in differential-baseline.json yet** — this is the one thing the
  entry cannot supply: sections E/F fail until the Lead's central sweep records
  `counts["pb-googleapis:protobuf"]` (missing/unexplained + `perf.avgMsPerFile`). If the sweep names the row
  differently, the `perfKey` must match it.
- **docs** — `docs/analyzers/protobuf.md` exists; section G passes with the corrected head comment.

## 4 · THE `sourcePath` QUESTION — ANSWERED FROM THE INCOMING GATE, WHOLE POPULATION
`bun run script/m14/incoming-gate.ts protobuf proto 0` (128/128 admitted `.proto` files):
```
TOTAL 55,692 edges · 51,650 resolved · 2,205 collRes · 1,065 amb(decl) · 1 amb(kind) · 54 unresolved
      extOK 2,923 · ext? 0 · extFAIL 0
of those 2,923 verified: 1,926 by owner lookup in the key space, 997 against the project's own file list
```
**The lane does not emit a relationship type called `sourcePath`** — the taxonomy has no such edge; what it does is
attach a FILE claim (`fileClaimForTarget`, imported from `./file-claim`) to its path-shaped targets. **997 of the
2,923 verified claims are verified against the project's FILE LIST — that is the sourcePath claim working — and
`ext?` is 0: NOT ONE path-shaped target is unreachable.** The historical 581 unresolved module paths that forced
the claim kind into existence are closed by that channel.

## 5 · HEAD COMMENT CORRECTED (it was stale)
The lane already had a head comment, but its "Relationship types covered" line named `references`, `calls`,
`extends` and `implements`, which the analyzer does not use (`grep RelationshipType` = Imports×3, Exports×3,
Uses×2, Overrides×1, Contains×1) and which the spec rules grammar-absence. Rewritten to the five emitted kinds,
with the sourcePath measurement and the six required ceremony items; 19 lines; the section-G checker passes.
