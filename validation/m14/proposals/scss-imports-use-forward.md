# PROPOSAL — the `@use` / `@forward` `imports` edge: BOTH halves, or neither

**Author:** coverage-b · 2026-10-17 · **Status: MEASURED, NOT LANDED.** The analyzer half is written, verified and
saved at `.tmp-scss-lane/analyzer-with-imports.ts`; it is deliberately NOT in the tree, because the oracle half is
Lead-owned and landing one half alone manufactures 556 unexplained rows.

## THE DEFECT (record ahead of code, the same shape javascript's lane found)

The lane's docs and spec both say `@use`/`@forward` emit an `imports` edge. They do not:

* `docs/analyzers/real-scss-analyzer.md`'s imports row said **EMITTED — 3,621 in 824 files**. That number is the
  CSS `@import` form, which reaches the analyzer through the CSS **delegate** and does emit. **`@use`/`@forward`
  emit nothing.**
* The spec's `use_statement` evidence said *"an `imports` edge plus an ImportInfo"* — the ImportInfo and the
  `namespace` symbol exist; **the relationship edge does not**.
* Measured: **0 `imports` edges over all 13 fixture sources**, and **0 over the 149-file element-plus sample**
  (element-plus is `@use`-only, so the whole sample publishes none).
* The differential's own evidence line proves the other end of it: with the analyzer half applied it reads
  `imports (556 comparable, 0 truth)` — **the oracle derives zero truth rows for imports on this corpus**, because
  `deriveScssEdges` seeds its walk with an EMPTY owner (`})(root, "", "")`) and its `push` drops empty-source rows:
  the `case "use_statement"/"forward_statement"` branch that would derive them exists and can never fire.

## WHY IT CANNOT LAND ALONE — measured, both runs on the same 149 files/1614 truth rows

```
WITHOUT the analyzer half (HEAD):  analyzer-edges=418  covered=1490  MISSING=124  unexplained=14  (3.3%)
WITH    the analyzer half:         analyzer-edges=974  covered=1490  MISSING=124  unexplained=570 (58.5%)
```

The delta is **+556 edges, all `imports`, all UNEXPLAINED** — `.tmp-scss-lane/diff-with-fix.txt` and
`diff-without-fix.txt`. Landing it alone takes the lane's unexplained count up 40×.

## PATCH A — the analyzer half (MY file, ready; `.tmp-scss-lane/analyzer-with-imports.ts`)

In `src/ast/real-scss-analyzer.ts`, `processModuleStatement`, after the `ctx.imports.push(...)`:

```ts
ctx.relationships.push({
  source: ctx.moduleName,
  target: module,                       // the SPECIFIER, stripped of quotes
  type: ASTEngine.RelationshipType.Imports,
  line_number: this.nodeToRange(node).startLine,
  confidence: 1.0,
  metadata: { isCssImport: true, isSassModuleImport: true, importSource: ctx.moduleName,
              importSpecifier: module, ...(namespace ? { sassNamespace: namespace } : {}) },
})
```

Verified: 6 edges over the 3 module-using fixtures — `sass:map` L1, `sass/list` L2, `src/list` L3,
`../utilities` L17, `../other` L55 — same shape the css sibling lane already emits for `@use`/`@forward`
(`real-css-analyzer.ts`: source = importing file, target = specifier, `metadata.isSassModuleImport`).

## PATCH B — the oracle half (LEAD-OWNED `script/m14/differential.ts`) — REQUIRED for A

`deriveScssEdges` must be told the module name so a module-level statement has a source. Two lines:

```diff
-export function deriveScssEdges(root: any): {...}[] {
+export function deriveScssEdges(root: any, moduleName: string): {...}[] {
...
-  })(root, "", "")
+  })(root, moduleName, "")
```

and at both scss call sites (`:22952`, `:22983`):

```diff
-        for (const e of deriveScssEdges(root)) {
+        for (const e of deriveScssEdges(root, scssModule)) {
```

`scssModule` is already the file's basename WITH extension at those sites (`relPath.split("/").pop()`), which is
exactly the analyzer's `ctx.moduleName` and exactly the convention the CSS oracle's `moduleName` uses — so the
derived row matches the emitted row on `from`, `target` and label.

## THEN, IN THE SAME SWEEP — re-pin the floor

After A+B the differential must be re-measured and `differential-baseline.json`'s `element-plus:scss` row
re-pinned with `--update-baseline` (Lead's sweep — I am not touching the file). Note the row is ALREADY stale
independently of this proposal: the live run measures **124 missing / 14 unexplained** against the pinned **56/3**
(see `scss-gated-langs-and-required-kinds.md`).

## WHAT I WILL DO WHEN YOU SAY GO

1. Re-apply Patch A + the fixture `use_statement` pin (the `@use`-form equality row) — 30 minutes, measured.
2. Hand you Patch B as a diff for the differential (or apply it if you move the file into my scope).
3. Re-run `--repo element-plus --lang scss --sample 149`, report the new missing/unexplained, and only then ask
   for the base re-pin.

**Do not land A alone.** The number it produces is a fabrication by the lane's own definition; 556 rows would be
published output no oracle accounts for.
