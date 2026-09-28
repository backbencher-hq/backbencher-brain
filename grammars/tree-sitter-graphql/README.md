# tree-sitter-graphql — vendored, patched, and pinned

This directory is the **source of the wasm the product loads**:
`wasm/tree-sitter-graphql.wasm`. It is not a mirror of upstream; it is
upstream plus a measured patch, and the patch is a reviewable diff because
`grammar.js` is **generated** from `grammar.upstream.js` by `port.py`.

## Why the tree is shaped this way

| file | role |
|---|---|
| `grammar.upstream.js` | `github.com/bkegley/tree-sitter-graphql` @ `ee5ce96`, verbatim. The port always reads this, so `python3 port.py` is idempotent. |
| `port.py` | the patch, as code: the PascalCase rename and four FIX hunks, each anchored to upstream's exact text and each refusing to write a half-ported grammar. |
| `grammar.js` | the generated, patched grammar. **This is what `tree-sitter generate` reads.** |
| `src/node-types.json`, `src/grammar.json` | generated, and tracked ON PURPOSE: `script/m14/verify-grammar-pins.ts` uses the pair for its offline source↔wasm proof. |
| `src/parser.c` | generated, 283 KB, **not** tracked. `tree-sitter generate` rebuilds it. |
| `tree-sitter.json`, `package.json` | ABI 15 build config and npm metadata. `package.json` deliberately has no `"type"` field: the repository root is `"type": "module"`, and `grammar.js` is CommonJS `module.exports`, so without a local `package.json` the CLI cannot load it. |

## Divergence 1 — the rule names are PascalCase, and that is a contract

Upstream names its rules `snake_case` (`object_type_definition`). This
repository's rules are `PascalCase` (`ObjectTypeDefinition`), because:

- `src/ast/real-graphql-analyzer.ts` dispatches on `node.type === "ObjectTypeDefinition"`.
  Under upstream's spelling **every construct falls through the analyzer's
  default arm** and the file yields nothing.
- `script/m12/graphql-node-types-compare.ts`, the m12 shape-safety artifact, the
  m14/m60 language lanes and every stored symbol row assume the PascalCase
  spelling.
- The wasm this repository vendored **before** this work already exposed
  PascalCase names (built with an older tree-sitter CLI, which PascalCases rule
  names on the analyzer's behalf). The rename preserves that surface rather than
  breaking it.

The rename is a mechanical `snake_case → PascalCase` map over 71 rules, pinned
to the vendored wasm's own `language.nodeTypeForId` table, with `source_file`,
`comment` and `comma` held lower-case because that is what the previous wasm
exposed for them.

**Upstream's `main` is not a drop-in.** The A/B is in
`fixtures/graphql/out/extraction-ab.json`; the measured result of a
PascalCase-only port is that the analyzer's whole string-literal contract
becomes dead. That is why this is a *patched port* and not an upgrade.

## Divergence 2 — four specification constructs upstream rejects

Each FIX in `port.py` is anchored to a row in the 113-construct battery
(`fixtures/graphql/probe/grammar-gaps.mts`) and each was measured, not reasoned.

| # | construct | specification | what upstream's rule does | the patch |
|---|---|---|---|---|
| FIX 1 | `extend schema { query: Q mutation: M }`, and `extend schema @link(…)` with no body | §3.18 | one `root_operation_type_definition`, and the body is mandatory | `repeat1(...)` inside an optional body, with `prec.right` to resolve the `{` ambiguity (the same resolution every other `*_type_extension` in this grammar already uses) |
| FIX 2 | `extend scalar S` with no directive | §3.17 | `$.directives` is `repeat1`, so a directive is **mandatory** | `optional($.directives)` |
| FIX 3 | `{ f @a @b }` — two directives on one field selection | §3.3 | `optional($.directive)`, singular | `optional($.directives)` |
| FIX 4 | `\"` and `\\` in a `"…"` string; `\"""` in a `"""…"""` block string | §2.9.4 | the short string's regex forbids every backslash, and the block string has no accepting path for `\"""` | short string: `[^"\\\n]` or `\\` + any non-newline; block string: a quote is consumable only when it is not the closing delimiter, and a backslash always consumes the next character |

FIX 4 was measured twice. The first attempt wrote the short string's escape as
`\\[^\\\n]`, whose character class excludes the backslash **itself**, so `\"`,
`\/` and `\n` all parsed and `\\` did not — 4 of 7 escape probes green. The
second attempt uses `\\[^\n]`.

**Still a gap, deliberately not fixed:** the block-string rule accepts
`"""a\""""` as the block string `a"` followed by a stray quote. graphql-js agrees
(`BlockStringValue` is greedy to the last `"""`), so tightening it would make
this grammar disagree with the reference implementation. Recorded, not hidden.

## Regenerating the wasm

```sh
cd grammars/tree-sitter-graphql
python3 port.py                                   # upstream + the patch -> grammar.js
tree-sitter generate                              # -> src/{parser.c,grammar.json,node-types.json}
tree-sitter build --wasm -o ../../wasm/tree-sitter-graphql.wasm
```

`tree-sitter build --wasm` needs emscripten; with only docker present it uses
`emscripten/emsdk` through docker automatically. The CLI must be ≥ 0.25 for the
`tree-sitter.json`/ABI-15 path; the fixtures copy at
`$HOME/fixtures/node_modules/tree-sitter-cli` is 0.25.1.

**After regenerating, re-run every gate** — the wasm hash is pinned and the
extraction changes:

```sh
$HOME/fixtures/graphql/run-all.sh --corpus
cd $HOME/backbencher-brain && bun script/m14/verify-grammar-pins.ts --write
```

## What the patch bought, measured

47 real `.graphql` files across four repositories, the same analyzer under both
grammars (`fixtures/graphql/out/extraction-ab.json`):

| | previous wasm | wired wasm | delta |
|---|---|---|---|
| files with a grammar error | **12 / 47** | **4 / 47** | **−8** |
| grammar error nodes | **20** | **7** | **−13** |
| symbols | 8,743 | **8,747** | +4 |
| relationships | 16,861 | **16,937** | +76 |

Every delta is enumerated and adjudicated in `REVIEW.md` §E. The direction is
uniform, and the previous wasm's losses include a class of **phantom facts**: on
`neo4j-graphql/.../apollo-federation-subgraph-compatibility/schema.graphql` a
described `extend type User` degraded to ERROR, and the analyzer then published
`anonymous_operation_1566 → Int`, `→ ID`, `→ @external` and `→ @requires` —
four invented references — while losing five real `User` field symbols.
