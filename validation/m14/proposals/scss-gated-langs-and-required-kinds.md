# PROPOSAL — `scss` to CONFORMANT: two Lead-owned lines, and nothing of mine

**Author:** coverage-b (delegate lane run) · 2026-10-17 · scss ladder: **INVENTORY-DONE → GAPS-CLOSED** by this
work; CONFORMANT needs the two lines below. **I applied nothing to Lead-owned files.**

## WHAT THE LANE MEASURES NOW (after my repairs, all seen)

```
bun run script/m14/completeness-inventory.ts --lang scss
  pass  section-a-structural         86 types, 16 handled, 70 silent, 0 gaps, 0 decisions
  FAIL  section-b-relationship-kinds EMITTED but absent from requiredKinds: calls, exports, extends, overrides
  pass  section-c-payload-matrix     complexity, parameters
  pass  section-d-evidence-tiers     2 tier(s) pinned: structural, usage_contextual
  pass  section-e-differential       floor element-plus:scss: missing=56, unexplained=3 — expected 56/3 per SCSS-D1
  pass  section-f-perf-budget        element-plus:scss 21.691 ms/file
  pass  section-g-docs               docs/analyzers/scss.md
  pass  section-h-cross-language     12 checks pass
```

**7 of 8.** Section B's FORWARD half (every required kind pinned by a fixture) is now clean — it read `unpinned:
imports` before; the lane had never pinned the kind as a *relationship row* (its `expectImports` array is not what
section B reads). New fixture `scss/import-statement-emits-imports-edge` pins the `@import` edge the analyzer
already emits through the CSS delegate. Fixtures: **14 pass / 0 fail**.

Section B's REVERSE half is the only failure, and it is the contract ROW: the sweep runs the analyzer over the
lane's own fixture sources and sees `calls`, `exports`, `extends`, `overrides` — all four are real emissions, all
four are already pinned by existing fixtures (`calls` by `module-system-and-mixins`, `exports` by several,
`extends` by `control-flow-and-extend` / `placeholder-selectors-and-extend`, `overrides` by
`module-exports-and-global-overrides`). The row simply never named them.

## EDIT 1 (required for 8/8) — `script/m14/completeness-inventory.ts`, the `scss` config

```diff
-  requiredKinds: ["uses", "references", "contains", "imports"],
+  requiredKinds: ["uses", "references", "contains", "imports", "calls", "exports", "extends", "overrides"],
```

The gate's own remedy text is "add the kind, or record why the row omits it"; there is no reason to omit — each is
measured emitted and fixture-pinned. After this line the section reads
`8 relationship kinds pinned by scss fixtures; 8 emitted and all accounted for`.

## EDIT 2 (after EDIT 1) — the `GATED_LANGS` array in the same file

```diff
- const GATED_LANGS = ["bash", "java", "groovy", "kotlin", "scala", "typescript", "javascript", "vue", "svelte", "c", "cpp", "rust", "go", "zig", "csharp", ...]
+ const GATED_LANGS = ["bash", "java", "groovy", "kotlin", "scala", "typescript", "javascript", "vue", "svelte", "c", "cpp", "rust", "go", "zig", "csharp", "scss", ...]
```

## ONE FINDING THE SWEEP SHOULD ACT ON BEFORE PINNING CONFORMANT — the floor row is STALE

Section E passes because it reads the PINNED row (`element-plus:scss` missing 56 / unexplained 3). A live scoped
run on this tree measures **missing=124 / unexplained=14** over the same 149 files and the same 1614 truth rows:

```
bun run script/m14/differential.ts --repo element-plus --lang scss --sample 149
  [element-plus] scss: files=149 tree-truth=1614 covered=1490 (92.3%) MISSING=124 | analyzer-edges=418 unexplained=14 (3.3%)
```

covered fell from the pinned 1558 to 1490, so this predates my work — the row no longer describes the tree. It is
**not** mine to re-pin (`--update-baseline` rewrites the file whole; you said leave it to the central sweep), so it
is reported here: re-pin `element-plus:scss` in the sweep, or CONFORMANT will sit on a floor that no current run
produces. (The scoped differential probe writes no evidence — it prints "M14.0.F5 NOT written".)

## WHAT I CHANGED (my scope only)

* `script/m14/spec/scss-completeness.json` — **the spec was in an OLD shape and made the gate CRASH**: its
  `handled_verified.types`/`internal_silent.types` were dicts (a plain object is not iterable, so
  `new Set(spec.handled_verified?.types)` threw `TypeError` at `loadSpec`) and `design_decision` had no `decisions`
  array. Restructured to the contract every other consumer already types (`types: string[]`; annotations preserved
  under an `evidence` map; `decisions: []` because every one of the 86 named types is adjudicated in a bucket).
  This is what lets the gate run on scss at all — it could not be measured before.
* `validation/m14/fixtures/scss/import-statement-emits-imports-edge.{scss,expectation.json}` — the forward pin.
* `docs/analyzers/scss.md` — the `imports` row now states the measured split (see the companion
  proposal `scss-imports-use-forward.md`) and the fixture pin.
* `validation/m14/verification/SCSS-STATE.md` — the lane's memory.

**No analyzer change is needed for 8/8.** The `@use`/`@forward` imports emission is a separate, measured package
(`validation/m14/proposals/scss-imports-use-forward.md`) and it MUST NOT land before its oracle half.
