# The `implements` clause in tree-sitter-javascript — measured feasibility

**Status: PROVEN FEASIBLE AND SAFE — NOT WIRED INTO THE ENGINE.** The patch, the built wasm and the
regression numbers are here so the decision is a choice rather than a guess. Nothing parses with this
wasm today.

## Why this exists

The `implements` label was ruled unexpressible for the JavaScript lane on the strength of six
instruments that all measured one thing: **whether the grammar can carry an `implements` clause**.
They were right that it cannot (upstream `class_heritage` is `seq('extends', $.expression)`, and
`class A implements B {}` parses to a `class_declaration` with an ERROR). But "the grammar cannot" and
"the lane cannot" are different claims, and this file tests the first one on its own terms, as the
repo's `grammars/` policy expects — the same policy under which `script/m14/ts-grammar-patch/` ships
a patched TypeScript grammar.

Result: **the grammar CAN be fixed**, with a five-line change and zero measured regression. Separately,
the label is already **emitted** from JSDoc `@implements` (see
`validation/m14/verification/JAVASCRIPT-IMPLEMENTS-JSDOC.md`), which needs no grammar change at all.

## The patch

`implements-clause.patch` — against `tree-sitter-javascript@0.23.1`'s `grammar.js`:

```js
class_heritage: $ => seq('extends', $.expression),

// PATCH (bb): an `implements` clause, the Flow/TS spelling JavaScript itself rejects.
implements_clause: $ => seq('implements', commaSep1($.expression)),
```

plus `optional($.implements_clause),` after `optional($.class_heritage),` in **both** `class` (the
expression form) and `class_declaration`. Adding it to both matters: patching only the declaration
would leave `const K = class implements I {}` an ERROR.

## How it was built

```
cp node_modules/tree-sitter-javascript/grammar.js  .
# apply implements-clause.patch
tree-sitter generate          # REGENERATES src/parser.c  <-- required
tree-sitter build --wasm      # -> tree-sitter-javascript-implements.wasm (394,091 bytes)
```

**`tree-sitter generate` is not optional, and this was measured the hard way.** The first attempt ran
only `tree-sitter build --wasm` on a patched `grammar.js` and produced a wasm of the SAME size as
upstream that behaved IDENTICALLY — because the build consumed the stale generated `src/parser.c`. The
patched grammar looked applied and was not. The tell is that `src/parser.c` does not mention
`implements_clause`; after `generate` it does, 86 times, and the wasm grows 363,688 → 394,091 bytes.

Toolchain present in this environment: `tree-sitter` CLI at `~/.bun/bin/tree-sitter` (no `emcc` on
PATH; the CLI's own wasm build path works). ABI note emitted by the CLI: no `tree-sitter.json`, so it
generated **ABI 14**.

## Parse shapes, upstream vs patched

| input | upstream | patched |
|---|---|---|
| `class A implements B {}` | **1 ERROR** — `(class_declaration name (ERROR (identifier) (identifier)) body)` | **0** — `(class_declaration name (implements_clause (identifier)) body)` |
| `class A extends B implements C {}` | **1 ERROR** — `implements C` left as an ERROR sibling of the heritage | **0** — `(class_heritage (identifier)) (implements_clause (identifier))` |
| `class A extends B, C {}` | 1 ERROR | **1 ERROR** (unchanged — this really is invalid) |
| `class A extends B {}` | 0 | 0 (unchanged) |
| `{ implements: 2 }; o.implements; const implementsIt = 1;` | 0 | **0 (unchanged)** — `implements` is still usable as a property name and an identifier prefix, because tree-sitter's lexer is contextual |

The last row is the one that mattered most: adding a keyword token is exactly how a grammar patch
breaks a language, and it does not break here.

## Does it change any real JavaScript parse? NO — measured

120 real `svelte` JavaScript files (tracked, `.js`/`.mjs`/`.cjs`, ≤512 KiB, even stride), parsed with
both wasms and compared as full tree strings:

| measurement | result |
|---|---|
| files parsed | 120 |
| **identical parse tree** | **120 / 120** |
| different parse tree | **0** |
| upstream ERROR nodes | files 0, total 0 |
| patched ERROR nodes | files 0, total 0 |

So on the drawn population the patch is a strict superset of the language: it accepts all of the old
language identically and adds one construct.

## The decision this is waiting on

The patch is safe and cheap, so the question is not engineering, it is product policy:

1. **What the patch adds is FLOW syntax.** `class A implements B {}` is valid in Flow-annotated `.js`
   files, and is a `SyntaxError` in ECMAScript. Wiring the patched wasm means bb's JavaScript parser
   accepts a dialect — every `.js` file in a Flow project would parse further than it does today.
2. **The measured population is ZERO.** No `class … implements` clause appears in any `.js` file of
   the seven corpora checked (svelte, lodash, bootstrap, proxicall, vault, consul, nomad):
   `git grep -lE 'class [A-Za-z_$][A-Za-z0-9_$]*[^{]*implements'` → 0 files each.
3. **The label is already emitted without it**, from JSDoc `@implements`, with a real population
   (svelte's `compile_diagnostic.js`) and a matching oracle.

**Recommendation: do not wire it yet.** The `implements` label does not need it, the Flow population
is zero on the corpora we measure, and wiring it changes the accepted language for every JavaScript
file in every project — a blast radius that deserves a deliberate decision and its own arm, not a side
effect of landing a label. If bb decides to support Flow, this patch is ready, measured and safe; the
work to wire it is a wasm-path change in `src/ast/engine.ts` plus a full re-run of the battery.

**The generalisable finding:** for `implements`, both routes were open. The lane had ruled on the
weaker one. That is the real defect — not that the grammar was missing a clause.
