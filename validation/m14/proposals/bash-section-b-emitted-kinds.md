# PROPOSAL — `completeness-inventory.ts` section-B: `emittedKinds()` parses non-bash fixture files

**For the Lead (owner of `script/m14/completeness-inventory.ts`). NOT applied by me.**
Date: 2026-10-17 · lane: `bash` · evidence below is measured, not prose.

## THE FAILING CHECK
```
bash SECTION FAIL: section-b-relationship-kinds — EMITTED but absent from requiredKinds: instantiates
```

## WHY IT IS AN INSTRUMENT ARTIFACT, NOT A BASH EDGE
`emittedKinds(cfg)` (`script/m14/completeness-inventory.ts`) reads the lane's fixture DIRECTORY and parses every
file that is not `.json` with `ASTEngine.parseFile(path, src)`. `validation/m14/fixtures/bash/` contains:

```
100 non-JSON files = 34 `.sh`/`.bash` SOURCES + 65 `.ts`/`.mts` HELPER MODULES
```

`parseFile` detects the language from the file, so the 65 TypeScript helpers are parsed **as TypeScript**, and their
`new X()` rows are emitted as `instantiates` and attributed to `bash`.

Measured, reproducing the inventory's own loop (`.tmp-reach/bash-emitted.mts`):
```
ALL kinds from the whole dir:            calls contains exports imports instantiates overrides references uses
instantiates edges:                      43, from 34 file(s) — EVERY ONE the TypeScript helpers,
                                         e.g. ab-round12-array-and-bd11.ts [detected=typescript] -> ... => WSP
kinds from the .sh/.bash sources ALONE:  calls contains exports imports overrides references uses
instantiates from bash sources:          NO
bash analyzer source:                    zero occurrences of "instantiat" (case-insensitive)
bash spec ruling:                        instantiates = grammar-absence (0 of 280 node types is a
                                         construction-of-a-declared-type node; 0 corpus sites in 2,962 files)
```
The bash lane's own fixture **`bash/no-instantiation`** now pins the absence with a `forbidRelationships:
[{"type":"instantiates"}]` row over array literals, `declare -A`, a command named `new`, a factory function and
command substitution — it passes (bash fixtures 35/35).

## THE ONE-LINE FIX (Lead's file)
In `emittedKinds()`, skip files that are not the lane's own sources — the same rule the firing check already uses:

```ts
// current
const sources = fs.readdirSync(dir).filter((f) => {
  if (f.endsWith(".json")) return false
  try { return fs.statSync(path.join(dir, f)).isFile() } catch { return false }
})
// proposed
const { detectLanguageFromPath } = await import(path.join(ROOT, "src/ast/language-detection.ts"))
const sources = fs.readdirSync(dir).filter((f) => {
  if (f.endsWith(".json")) return false
  try { return fs.statSync(path.join(dir, f)).isFile() } catch { return false }
}).filter((f) => String(detectLanguageFromPath(f) ?? "") === cfg.id)
```
(For `bash`, `detectLanguageFromPath("x.sh") === "bash"` and `("x.ts") === "typescript"`; verified in the measurement
above — the `[detected=...]` column is that function's output.)

## THE ROW MUST *NOT* CHANGE
`requiredKinds` for bash correctly omits `instantiates`; adding it would pin a kind the language cannot produce and
the analyzer never emits. The spec's `grammar-absence` exclusion is right as written.
