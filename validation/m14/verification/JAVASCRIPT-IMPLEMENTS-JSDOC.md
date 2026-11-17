# `implements` — the ruling is SUPERSEDED, and the label is EMITTED

**Author: Muhammad Ishaq Khan.**
**Reconstruction note:** the original of this file was deleted from the working tree by the 0.1.5
release cycle, and the commits that held it are unreachable (`git fsck` finds no object for them). It
is rewritten from the measurements, which are all reproducible from the commands named here.
**Lane:** `javascript` — `src/ast/real-javascript-analyzer.ts`, oracle in `script/m14/differential.ts`.
**Verdict:** the 2026-11 ruling was **correct about the clause** and **wrong about the language**.
JavaScript has no `implements` clause, but it states conformance in a **comment** — JSDoc
`@implements` — and real production code does exactly that. The label is emitted from that path, with
no grammar change. The grammar route was ALSO tested for the first time and is proven feasible; it is
deliberately not wired.

---

## Why the old verdict looked airtight

Six instruments, and every one measured the same thing: whether the **grammar** can carry an
`implements` clause.

| instrument | finding |
|---|---|
| (A1) the grammar's `node-types.json` | `tree-sitter-javascript@0.23.1` declares 118 named types; the only supertype-shaped names are `class_heritage` and `super`. No `implements_clause`. |
| (A2) the probe is shown to fire | the same scan over `tree-sitter-typescript` returns 183 named types **including** `implements_clause` — so A1 measured the grammar and was not failing to look. |
| (B/C) parse counts | 18 / 0 / 4,428 `class_heritage` clauses; the only anonymous token under one is `extends` at a 1:1 ratio; `implements` token **0**; multi-named-child clauses 0 / 0 / 97 and all 97 contain an ERROR. |
| (E) counterfactual | `class A implements B {}` parses to `(class_declaration name (ERROR …) body)` — no `class_heritage` at all. |
| (D) JSDoc `@implements` | **1 / 0 / 45 occurrences** ← the live lead the verdict did not follow |
| (F) resolvability | of the tags (D) found, 0 name a type declared as a symbol |

A–E are sound and are retained in the lane doc: they prove there is **no clause route**. The defect is
scope. Every instrument asked *"can the grammar carry this relationship?"*. None asked *"how does
JavaScript code state this relationship?"*. (D) had already counted the answer, and (F) closed it on a
resolvability argument that does not bear on whether the edge should be **emitted**.

## The evidence, from real production code

`svelte/packages/svelte/src/compiler/utils/compile_diagnostic.js`:

```js
/** @typedef {{ code: string; message: string; … }} ICompileDiagnostic */
/** @implements {ICompileDiagnostic} */
export class CompileDiagnostic {
```

A `.js` file, in a production compiler, declaring an interface with `@typedef` and stating that a class
implements it.

**On (F)'s objection.** (i) It is true of the JS analyzer's per-file symbol table and beside the point
for the edge: `extends` already publishes base names it cannot resolve in-file, and the store resolves
them later. (ii) It is narrower than it looks — `ICompileDiagnostic` sits in the same file, and the
lane's open `@typedef` gap is what keeps it out of the symbol table.

## What is emitted

| property | value |
|---|---|
| source | the class (declared name) |
| target | the interface name, resolved later by the store exactly as a base is |
| confidence | `1.0` |
| line | **the JSDoc line**, where the claim is written — not the class line |
| metadata | `{ viaJSDoc: true }` — a type-system claim is distinguishable from a language clause |

`jsdocImplementsNames` parses the text (no regex, matching the lane's other JSDoc helpers):

| form | emitted |
|---|---|
| `@implements {IFoo}` | `IFoo` |
| `@implements IFoo` (no braces) | `IFoo` |
| `@implements {Iterable<string>}` | `Iterable` — a type ARGUMENT is not a name |
| `@implements {A\|B}` | both |
| `@implements {some.ns.IFoo}` | `IFoo` — leaf, the `extends ns.Base` convention |
| `@implements {Itself}` on `class Itself` | nothing — a class cannot implement itself |
| a class with no JSDoc | nothing |

### The bug the fix had in its own first version

Every braced form worked; the **bare** form `/** @implements IBase */` silently emitted **nothing**.
That branch takes the rest of the LINE, so the candidate was `IBase */` — the comment terminator —
which is not an identifier. A shape-dependent silent loss, caught only because the fixture pinned every
form separately. The cut is now explicit at the site.

## The oracle moved in the same change

With the analyzer change alone the harness correctly reported a fabrication:

```
svelte: analyzer-edges=2375 unexplained=1 (0%)  | unexplained-by-label: implements=1
```

`deriveJavaScriptImplements` was added to `script/m14/differential.ts` and wired into the truth
assembly; `javascript-label-oracle-agreement.ts` imports it too — `implements` was already in its
`COMPARED` list with an **empty truth side**, a latent hole. **The oracle is a deliberately separate
implementation** from the analyzer's parser: an oracle sharing that code cannot catch a bug in it. Two
implementations agreeing is evidence; one called twice is not.

## The grammar route — tested, proven, NOT wired

`script/m14/js-grammar-patch/` (README + `implements-clause.patch` + built wasm). The five-line patch
adds `implements_clause: $ => seq('implements', commaSep1($.expression))` and an
`optional($.implements_clause)` in **both** class shapes.

- **`tree-sitter generate` before `build --wasm` is mandatory.** The first attempt patched `grammar.js`
  and ran `build --wasm` alone: it produced a wasm of identical size that behaved identically, because
  the build consumed the stale generated `src/parser.c`. After `generate`, `src/parser.c` mentions
  `implements_clause` 86 times and the wasm grows 363,688 → 394,091 bytes.
- **Shapes:** `class A implements B {}` 1 ERROR → **0**; `class A extends B implements C {}` 1 → **0**;
  `class A extends B, C {}` still 1 ERROR (correct); `implements` as a property name and identifier
  prefix **unchanged at 0** — the lexer is contextual, so adding a keyword token does not break it.
- **Regression:** 120 real svelte JS files parsed with both wasms and compared as **full tree strings**
  — **120/120 identical, 0 different, 0 ERROR nodes either side.**

**Not wired, deliberately — a product decision, not an engineering one.** What the patch adds is
**Flow** syntax: valid in Flow `.js`, a `SyntaxError` in ECMAScript. The measured population of a
`class … implements` clause in `.js` is **zero across seven corpora**, the label is already emitted from
JSDoc, and wiring it would change the accepted language for every JavaScript file in every project.
If bb decides to support Flow, the patch is ready and measured; wiring is a wasm-path change in
`src/ast/engine.ts` plus a full battery re-run.

## Verification

| gate | result |
|---|---|
| fixture `javascript/jsdoc-implements` | **PASS** — 6 forms, 2 negatives |
| JS fixtures | **98 pass / 0 fail** |
| whole fleet fixtures | **50 lanes, 1,788 pass, 0 fail** |
| differential svelte | truth **2,184**, covered **100%**, MISSING **0**, **unexplained 0**, hash unchanged `1aa48514c0dab17a` |
| differential lodash | 12,597 / 100% / MISSING 0 / unexplained 0, hash unchanged |
| per-label agreement | `implements` truth **1** / analyzer **1** / covered **1** / FABRIC **0** |
| `tsc --noEmit` (src, scripts) | 0 / 0 errors |
| `audit:js-census`, `audit:doc-truth-emissions` | PASS / PASS |
| target-validity, source-attribution censuses | 0 invalid / 0 unattributed |

## Still open

**`@typedef` names are not published as symbols**, so `ICompileDiagnostic` is the target of an edge but
not a node the graph can land on — the same state `extends` has for an imported base. That is a
symbol-completeness gap with its own population and blast radius, named rather than folded in.

## The generalisable lesson

**"Not expressible" is a claim about a GRAMMAR; "not emitted" is a claim about an ANALYZER.** The
verdict merged them. The language had a second, comment-based channel the grammar instruments could not
see. The rule this lane keeps relearning applies to rulings as much as to code: *check the channel,
not just the node type.*
