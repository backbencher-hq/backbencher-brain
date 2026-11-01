# JAVASCRIPT PROPOSALS TO THE LEAD — three shared-file changes, each with its evidence

**Author: Muhammad Ishaq Khan · 2026-10-17 · lane `javascript` · branch `analyzers/ontology-laptop-b`.**
Everything below is OUTSIDE this lane's write scope (`script/m14/**`, shared `src/ast/*` store files). The
analyzer halves are shipped and verified; these are the halves that need the Lead. Each item names the exact
file and function, the measurement that makes it necessary, and the analyzer evidence it must pair with.

---

## 1 · `script/m14/differential.ts` — the javascript import/export oracle is STALE

**Why it is a proposal and not an edit:** `script/m14/differential.ts` is master-owned and the lane's brief
forbids edits there. The oracle and the analyzer must move in ONE merge, which is also what
`docs/analyzers/javascript.md` Open finding §5 has said since the re-export question was opened.

**What the analyzer emits now (shipped this iteration, fixtures green):**

| form | analyzer row |
|---|---|
| `import { draw as render } from "./lib.js"` | `imports` target `draw` (the DECLARED name), `metadata.declaredName=draw`, `metadata.module=./lib.js` |
| `import { draw } from "./lib.js"` | `imports` target `draw` |
| `import Def from "./lib.js"` | `imports` target `./lib.js:Def`, `metadata.declaredKind=default` |
| `import * as ns from "./lib.js"` | `imports` target `./lib.js:*` |
| `export { readFile as read } from "fs"` | `imports` target `fs:readFile` 1.0, `{isReExport, declaredName:readFile, exportedAs:read}` |
| `export { default as D } from "./m"` | `imports` target `./m:default`, `exportedAs:D` |
| `export * from "./m"` | `imports` target `./m:*` 0.6 `{isReExport, unresolved, starForm:"all"}` |
| `export * as ns from "./m"` | `imports` target `./m:*` 0.6 `{isReExport, unresolved, starForm:"namespace", namespaceName:ns}` |
| `export {} from "./m"` | `imports` target `./m:*` 0.6 `{isReExport, unresolved}` |
| every `exports` row | source `(file)` + `metadata.fileLevel`; named-default rows carry `metadata.localName` |

**What the oracle still derives** (`deriveJavaScriptImportEdges`, `script/m14/differential.ts:5277`):
`<module>:<local binding>` for every ESM specifier (line 5325/5337 onward) and `path:*` for all three
re-export forms (the function has no per-member re-export branch). So the differential reports, on any
corpus: every local named import (bare declared name vs colon local binding) and every named re-export
member (`path:member` vs `path:*`) as MISSING on the truth side / analyzer-only on the product side.

**The patch shape, four edits in that function:**
1. `named_imports` → emit the DECLARED name (`spec.childForFieldName("name")`), keeping the local binding
   for the `imports[]` record only.
2. default import → emit `${modPath}:${binding}` (the analyzer's module-qualified default form).
3. `export_statement` with a `source` and an `export_clause` → emit one `imports` row per `export_specifier`
   as `${modPath}:${declaredMember}` (unquoting a string-literal member), and `path:*` only for the star and
   empty-clause forms; add `starForm` discrimination using the named `namespace_export` child.
4. `exports` source: the differential matches label+target only (per this lane's own docs), so `(file)` vs
   `(module)` does not need a change — verify before assuming.
**Measurement to run both ways:** the differential's javascript draw (`--lang javascript --sample N`) with
the analyzer reverted to `.tmp-js-lane/analyzer-A.ts` vs the shipped file, quoting MISSING and
analyzer-only counts per label. The fixtures and the two-file production probe are already green.

---

## 2 · `src/ast/import-resolution.ts` + `src/ast/parallel-indexer.ts` — the settlement and binding passes are UNWIRED

**Measured, not inferred:** `grep -rn "resolveImportBoundTargets\|planBindingResolutions\|settleImportTargets" src/`
returns ONLY the definitions. `parallel-indexer.ts` imports four names from `import-resolution.ts`
(`resolveDottedTargets`, `resolveImportTargets`, `resolveNameTargets`, `resolveRankedBareNameTargets`) and
NONE from `binding-resolution.ts`, so JSD43 (shadowed parameters), JSD45/JSD46 (re-export chains and star
sources), JSD49–JSD51 (settlement determinism, `is_cross_file` closure) are DEAD CODE on this tree — the
same merge loss documented in `validation/m14/verification/JAVASCRIPT-STATE.md` §2.

**Evidence that the wiring is load-bearing, on one two-file project** (`.tmp-js-lane/settle-counterfactual.ts`,
which edits NO source file):
- analyzer emits, and the store keeps, `import { draw as render } → draw` and `Widget → Widget`; the default
  import `./lib.js:Def` resolves to `Main` through the WIRED `resolveImportTargets` (this is the one route
  that works today, and it works only with this iteration's exports `localName` + `(file)` changes).
- the aliased row `./lib.js:render`, when the analyzer spells the OLD local-binding target, is attached by
  the insert-time leaf ranking to the unrelated method `Widget.render` and the unwired settlement pass is the
  ONLY thing that corrects it: calling `settleImportTargets(raw, pid)` directly reads
  `{scanned:3, planned:3, corrected:3, unresolved:0}` and binds `Def→Main`, `Widget→Widget`, `draw→draw`.
- therefore, restoring the call (and the binding pass before it) is what turns JSD50's determinism claim from
  a spec entry into a property of the store. Its placement is already documented by JSD50: in
  `resolveRelationships`, after every pass that can move a target, before the cross-language normalization.

**Cross-lane blast radius:** every lane that emits `module:item` rows is in scope (typescript and python
share the colon convention; java/dart do not). JSD50 already records the fleet obligation: re-run each such
lane's store numbers. This is the Lead's call and cannot be taken from this lane.

---

## 3 · `script/m14/differential.ts` + `src/ast/real-javascript-analyzer.ts` — the callee name-shape guard

**State:** `validation/m14/fixtures/javascript/non-name-callee-refused` is the lane's only remaining fixture
failure and the behavior it pins is already written in the lost lineage:
`isNameShapedCallTarget` (ID_Start / ID_Continue by code point, a leading `#` admitted because `this.#x()` is a
REAL private-method call this lane publishes as a symbol). The current guard is a token-membership PROXY
(`length > 100 || "\n" || backtick || "${" || hasBraceEquals`) and lets `(fn)`, `(0, helper.other)`,
`(cond ? a : b)`, `define()`, `"text"` and `[]` through as if they were symbol names.

**Measured in the lost lineage's census** (`script/m14/js-ontology/js-callee-shape-census.ts`):
svelte 31,973 `calls` rows → 31 fail a name-shape test; ts 22,210 → 550; and **123 svelte + 124 ts rows are
`#private` targets that are CORRECT** — an alphanumeric filter would delete them, which is why the rule is a
name SHAPE and not a character whitelist.

**Why it needs the Lead:** the oracle in `script/m14/differential.ts` mirrors the analyzer's guard
character-for-character, so tightening one side alone turns every affected row into MISSING against a
recorded baseline of 0. The analyzer half is four lines plus the two helpers; the oracle half is the same
rule on its side. Ship them in one merge; the fixture then flips green and the differential stays clean.
