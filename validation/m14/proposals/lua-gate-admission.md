# PROPOSAL — add lua's `LANG_CONFIG` (ready to paste) and admit it to the gate

**From: lua lane owner. State: A/B/C/D/G/H verified green by construction; E/F need the Lead's sweep
(no `lua` row exists in `differential-baseline.json`). Lane memory:
`validation/m14/verification/LUA-STATE.md`.**

## THE SECTION PICTURE

```
A  pass*   48/48 named types in exactly one bucket (16 handled_verified + 32 internal_silent);
           verified by replicating the gate's own loadNamedNodeTypes+loadSpec logic        <- landed
B  pass*   emitted = pinned = 9 kinds: calls, uses, contains, imports, references, exports,
           extends, overrides, instantiates. `imports` was emitted (1 edge) and UNPINNED       <- landed
C  pass*   payload: complexity pinned by lua/loop-bindings expectComplexity (fileEquals 6)    <- landed
D  pass    3 tiers pinned: import_based, structural, usage_contextual                          <- already green
E  LEAD    no `counts["lua"]` row in differential-baseline.json; no `differential-lua` in F5
F  LEAD    no `avgMsPerFile` for a lua perfKey
G  pass    docs/analyzers/lua.md exists
H  pass    M14.CC1.json: 12 checks pass
```
`*` = verified by the section's own logic locally, because the inventory REFUSES an unknown language
(`error: unknown language lua`) until the config below exists — that is the chicken-and-egg the config
resolves. Paste the config, then `bun run script/m14/completeness-inventory.ts --lang lua` verifies A-D+G+H
directly; E/F read green once the sweep writes the row.

## WHAT WAS ACTUALLY WRONG (and fixed, all in lane scope)

1. **The 46KB spec was not a section-A classification.** `handled_verified` and `internal_silent` were
   EMPTY (0 + 0 rows), and the six `gap` and ten `design_decision` records carried PROSE in their
   `node_type` fields — `"(incoming resolution — sample reach)"`, `"function_call (callee shape)"`,
   `"(the three types the stride reports SILENT: implements"` — which the gate comma-splits into the
   classification, so 46 of 48 types sat in NO bucket. Fixed by re-cutting the buckets from the pinned
   wasm: **137 node-type slots → 54 named slots → 46 unique NAMED + 80 ANONYMOUS** keyword/punctuation
   tokens (not rows — the haskell false-drift class), + ERROR/MISSING = **48 classified: 16 handled, 32
   silent, 0 unclassified, 0 stale**. The gap/decision RECORDS are preserved intact; their `node_type`
   is cleared (a gap row's `node_type` means "this grammar TYPE is unhandled", and none is; the findings
   are role-level) with the original prose kept under `_original_node_type_field`.
2. **Section B was one pin short.** `imports` was the only emitted kind with no expectation row
   (measured: 9 kinds emitted over the 15 fixture sources — contains 119, uses 75, calls 51, exports 25,
   references 10, extends 5, overrides 3, instantiates 2, **imports 1**; 8 were pinned). Pinned in
   `lua/callee-shape` with `relationshipType: lua_require`, `evidenceClass: import_based`.
3. **Section C had no Matrix 1b pin.** The analyzer already publishes `metadata.cyclomaticComplexity`
   (`real-lua-analyzer.ts:2649` = 1 + if/for/while/repeat + `and`/`or`). `lua/loop-bindings` now pins
   `fileEquals 6` (four loops + one `or`), with the arithmetic in the comment.

Fixtures after: **15 pass / 0 fail** (17 sources, pins only — no analyzer edit was needed).

## READY TO PASTE — `script/m14/completeness-inventory.ts`, inside `LANG_CONFIGS`

```ts
  // LUA joins the SPEC gate (2026-10-17). The lane HAD a 46KB spec that was never a section-A
  // classification: handled_verified/internal_silent were empty and the gap/decision records' node_type
  // fields held prose (comma-split into the classification, classifying nothing), so 46 of 48 named
  // types sat in no bucket. The spec is re-cut: 137 wasm slots -> 54 named slots -> 46 unique NAMED +
  // 80 ANONYMOUS tokens (not rows) + ERROR/MISSING = 48, split 16 handled / 32 silent, 0 unclassified.
  // Section B needed one missing pin (`imports`, emitted once and pinned by nothing); section C needed
  // its Matrix 1b pin (the analyzer already publishes metadata.cyclomaticComplexity -- loop-bindings
  // pins fileEquals 6). Section D was already green (3 tiers).
  lua: {
    id: "lua",
    wasm: "tree-sitter-lua.wasm",
    classification: "lua-completeness.json",
    fixturesDir: "validation/m14/fixtures/lua",
    docs: ["docs/analyzers/lua.md"],
    // perfKey is SWEEP-OWNED: no lua key exists in differential-baseline.json and no differential-lua
    // check exists in M14.0.F5.json. The lane's census corpus is 120 repos / 3,250 tracked *.lua files
    // (script/m14/spec/lua-completeness.json corpus block). Rename this key if the sweep pins a
    // repo-qualified corpus; E and F read green only once that row exists.
    perfKey: "lua",
    // The NINE kinds the analyzer actually emits over the lane's own fixture sources (measured through
    // ASTEngine.parseFile), all now pinned by expectation files.
    requiredKinds: ["calls", "uses", "contains", "imports", "references", "exports", "extends", "overrides", "instantiates"],
    payloads: {
      complexity: { key: "expectComplexity", pin: "lua/loop-bindings (fileEquals 6 = 1 + four loop decision points + one `or`)" },
    },
    title: "lua pass (SPEC admission)",
  },
```

## AND THEN

`GATED_LANGS` — add `"lua"` after the row above is in and the scoped run reads A-D/G/H green.

**Verify:**
```
bun run script/m14/completeness-inventory.ts --lang lua    # expect A,B,C,D,G,H pass; E/F until the sweep
bun run script/m14/run-fixtures.ts --lang lua              # expect: 15 pass / 0 fail
```
