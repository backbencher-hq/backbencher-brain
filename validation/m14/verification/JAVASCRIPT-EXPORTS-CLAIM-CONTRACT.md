# JavaScript — EXPORTS CLAIM CONTRACT

**Author: Muhammad Ishaq Khan.**
**REGENERATED 2026-11-13.** The original of this page was deleted from this working tree by the 0.1.5
release cycle and exists in **no git history** (`git log --all` finds no commit for it), so it cannot be
restored. This is rewritten from the code and the instruments as they stand now; every shape below was
read out of `src/ast/real-javascript-analyzer.ts` rather than recalled.

## What an export row is

`exports` edges are emitted for the module's export surface, one row per exported NAME, from three
families. The metadata says which family, so a consumer never has to infer it from the spelling:

| form | distinguishing metadata |
|---|---|
| ESM named / default / namespace | `declaredName`, `declaredKind` (`named` / `default`), `fileLevel` |
| re-export (`export … from`) | `isReExport: true`, `scopeName` (the source module) |
| CommonJS `module.exports` / `exports.name` | `viaCommonJs: true`, `cjsForm` (`object` / `deep`) |

## The two shapes that were nearly lost

**A `*` target names NO SYMBOL.** `require("m")` and `import("m")` load a module; they do not take a
member from it. Publishing `<module>:*` at confidence 1.0 states a certainty the file does not contain,
and for an ES5 corpus it is the WHOLE import class — so the `*` spelling is deliberate and carries a
lower confidence rather than pretending to be a member.

**A shorthand method is the dominant modern CJS export form**, and the grammar spells it
`method_definition`, not `pair`. Three branches that handled `pair`, `shorthand_property_identifier` and
`identifier` all missed it, so `module.exports = { run(){…}, plain: 1 }` exported only `plain`. The
`method_definition` branch now covers it.

## Verified

- `script/m14/javascript-vocabulary-census.ts` counts `exports` whole-population per corpus.
- The relationship witness gate asserts `exports` fires on a minimal `export const`.
- `svelte` differential: the `exports` label is inside the 100%-covered truth set with 0 unexplained.

## Bound

An export row's TARGET is the exported name as declared, not a resolved declaration. Resolution is the
store's job; the row carries what the file states.
