# THE TYPESCRIPT GRAMMAR PATCH — `part_of`, THE R2 RUNG

**Author: Muhammad Ishaq Khan.** This directory is the R2 remedy for the one type this lane could
not reach through the served grammar: **`part_of`**, the triple-slash reference directive.

## WHAT THE DEFECT WAS

`/// <reference path="…" />`, `/// <reference types="…" />` and `/// <reference lib="…" />` are
**real constructs**: TypeScript's own compiler reads them, and they change which files a program
contains. The served build (`8515404dceed38e1ed86aa34b09fcf3379fff1b4ff9dd3967bcd6d1eb5ac3d8f`,
385 node ids / 191 named types) lexes each of them as an **ordinary `comment`**, so the tree has no
node for the construct and no relation can be read from it. Contributes 0 `part_of` edges, while
the population contains **51 directives in 35 files** of 17,689.

## WHAT THE PATCH IS

**One rule and one program**, in the derived grammar
(`common/define-grammar.js`, which extends `tree-sitter-javascript`'s grammar):

* a `reference_directive` node that carries **`role`** (`path` · `types` · `lib`) and **`target`**
  (the quoted specifier) as **FIELDS**, so an analyzer reads STRUCTURE and never a comment's text;
* `program` admits it at statement level, beside the ordinary statements.

**THE PRECEDENCE IS LOAD-BEARING, NOT DECORATION.** The comment token `//` matches the first two
characters of `///`, and a comment is an *extra* — valid at every position — so without
`token(prec(20, '///'))` the comment wins the lexer and the directive disappears inside it. That is
the reason the first patch attempt (a single whole-line `token`) worked but produced a node with no
fields: it won the lexer, and then there was nothing structured to read.

The diff is [`reference-directive.patch`](reference-directive.patch).

## THE BUILD

```
8586372d50cbdc97dbcc1f8affe66028680a2fe8c9b1e608197587c3ac2c6ab3
tree-sitter-typescript-patched.wasm · 1,672,416 bytes
```

Built with the CLI at `tree-sitter 0.26.9`, and **the layout is the load-bearing part of the build
recipe**: `tree-sitter generate` and `tree-sitter build --wasm` want `grammar.js` at the build
directory's ROOT and the grammar's `common/` as a **SIBLING**, which is the npm package's own
layout. Building from the package root fails with `Failed to load grammar.js`; building from
`<pkg>/typescript/` with `<pkg>/common/` beside it works, because `src/scanner.c` includes
`../../common/scanner.h` and that path only resolves one level up. A previous report of this lane
called R2 "blocked by the toolchain" — **it was blocked by layout, and that was this lane's error.**

To rebuild:

```
cp -r node_modules/tree-sitter-typescript /tmp/r2 && cd /tmp/r2
patch -p0 < …/reference-directive.patch          # against common/define-grammar.js
cd typescript && tree-sitter generate && tree-sitter build --wasm
sha256sum tree-sitter-typescript.wasm            # must read 8586372d…
```

## THE PROOF — BEHAVIOURAL, NOT A NODE LIST

`script/m14/ts-partof-grammar-proof.ts` parses **one source string** with **both builds** and prints
what each makes of the same bytes. It exits 1 if any of its five named conditions fails, because a
proof that cannot fail is not a proof:

| build | sha256 | top-level nodes for 3 directives + 1 comment |
|---|---|---|
| SERVED | `8515404d…` | `comment`, `comment`, `comment`, `comment`, `lexical_declaration` |
| PATCHED | `8586372d…` | **`reference_directive` ×3**, `comment`, `lexical_declaration` |

Five conditions: the served build makes them comments; the patched build makes them nodes named
`reference_directive`; the patched build still makes an ORDINARY comment a comment (the patch does
not eat comments); the two builds are different bytes; the patched build is not the served build.
All five green.

## WHERE THIS RUNG STOPS, AND WHY THAT IS STATED RATHER THAN GLOSSED

⇒ **The patched build is NOT the wired grammar.** Production and the fixture suite both load
`wasm/tree-sitter-typescript.wasm`, which is still the served build. Wiring this patch is a
shared-asset decision — it changes every number this lane has ever published — so the lane has
**built and proven** the rung and is **asking** for the wiring rather than performing it.

The remaining steps, in order, and the lane will not claim `part_of` before all of them:

1. wire `8586372d…` as the typescript grammar asset;
2. measure **both builds over the whole admitted population and publish the per-label delta** — not
   only `part_of` 0 → 51, because a grammar swap that moves `calls` or `references` would invalidate
   the cell rather than extend it;
3. run the fixture suite on the patched build (the suite's own parser changes with the wiring);
4. only then does `extractReferenceDirectives` emit, and only then does `part_of` leave
   `grammarRemedyPending` and the lane read 14 of 14.

## WHY R1 AND R3 WERE NOT TAKEN FOR THIS TYPE

* **R1 — a published build whose inventory has the construct.** EXHAUSTED BY MEASUREMENT: all
  **8** published releases (0.20.1, 0.20.3, 0.20.4, 0.20.5, 0.21.1, 0.21.2, 0.23.0, 0.23.1) carry
  **0** reference-directive node types, and 0.23.1 is the newest. No bump can reach it.
* **R3 — an existing node type carries the relation.** REFUSED, and the reason is the lane's
  contract rather than the ladder: the only existing carrier is the `comment` node, and reading the
  directive out of a comment's TEXT is a text resolution, which this analyzer is forbidden by
  contract from doing. The patched node makes the relation a FIELD, which is the whole point.

⇒ `mixes_in`, by contrast, WAS taken at R3 and needed no grammar change at all: the heritage clause
already carries the shape (`class X extends Mixin(Base) {}` is a `call_expression` in the extends
position), so the relation was always in the tree and only the analyzer had to read it.
