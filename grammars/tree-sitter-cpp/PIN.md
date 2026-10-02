# tree-sitter-cpp — grammar pin

This directory is the **source of record** for the C++ grammar the product loads.
`wasm/tree-sitter-cpp.wasm` is a build of exactly these files, and
`script/m14/verify-grammar-pins.ts` re-measures that on every run (lane `cpp`,
14 lanes total).

**The wired bytes are not the published release.** They are a **local fork** of
0.23.4 with **four** in-repo patches, and this file is where the fork is written
down. Until this pin existed the analyzer's documentation said only
"Parser: `tree-sitter-cpp` 0.23.4 (npm, latest)", which is a version string that
cannot express a fork — and a reader who ran `npm pack tree-sitter-cpp@0.23.4`
and compared would have found a large difference with nothing to account for.

## Upstream

| | |
| --- | --- |
| repository | `tree-sitter/tree-sitter-cpp` |
| version | `0.23.4` (from `tree-sitter.json` → `metadata.version`) |
| license | MIT (`LICENSE`) |
| authors | Max Brunsfeld, Amaan Qureshi, John Drouhard |
| tarball measured against | `npm pack tree-sitter-cpp@0.23.4` |

## What is vendored, and what is not this lane's fault

| file | vs the 0.23.4 tarball | why |
| --- | --- | --- |
| `src/scanner.c` | **byte-identical** (`cf60387d`) | the external scanner. Carried unchanged from upstream. |
| `tree-sitter.json` | **byte-identical** (`ce25741b`) | the grammar's declaration. Note its `metadata.version` still reads `0.23.4` and therefore **understates** what is wired — see the fork section. |
| `package.json` | **byte-identical** (`bfde98d5`) | the package identity. |
| `LICENSE` | **byte-identical** (`2e0110e0`) | MIT requires the license to travel with the source. |
| `grammar.js` | **DIFFERS** — upstream `d0242291` → here `a5637b9c` | the four patches below, and nothing else. |
| `src/parser.c`, `src/grammar.json`, `src/node-types.json`, `src/tree_sitter/` | not vendored | **generated** from the *forked* `grammar.js`. See the note at the end — this lane's `source↔wasm` proof is `not applicable` for a specific reason, not the usual "41 MB" one. |
| `queries/`, `bindings/`, `binding.gyp`, `prebuilds/`, `README.md`, `CHANGELOG.md` | not vendored | editor queries (the engine loads none), native bindings, and upstream docs. The provenance and the decision live in the pin record and here. |

## The fork: four patches

### 1. Rebuildability — `require` path

```diff
-const C = require('tree-sitter-c/grammar');
+const C = require('../tree-sitter-c/grammar.js');
```

Upstream reads the C grammar through a `node_modules` entry, and `node_modules/`
is gitignored repo-wide — so that `require` made this grammar **unrebuildable from
a fresh checkout**. `tree-sitter-c` is vendored beside this directory, so the
dependency became a relative path. The same `parser.c` is generated, with no
install step and no machine-local symlink.

### 2. `macro_prefixed_type_specifier` — a bare identifier macro before a type

```js
macro_prefixed_type_specifier: $ => prec(-1, seq(
  alias($.identifier, $.macro_specifier),
  $._macro_decorated_type,
)),
_macro_decorated_type: $ => prec(-1, choice(
  $.struct_specifier, $.union_specifier, $.enum_specifier, $.class_specifier,
  $.sized_type_specifier, $.primitive_type, $.decltype,
)),
```

This is the C++ port of the C wave's rule, and **the narrowing is the whole
point**. The C rule uses the *full* `type_specifier`, and that breadth does not
port: in C++ `_scope_resolution` has an **optional** scope, so `A::B` reads as
either the qualified type `A::B` or macro `A` decorating the qualified type `::B`.
Ported verbatim, the new derivation demanded a conflict declaration, and
declaring it flipped runtime path selection in unrelated code —
`fmt::format_to(std::back_inserter(buf), …)` parsed as a **declaration of a
function named `::format_to`** in a file with zero ERROR nodes before and after.

`A::B` was never a macro decoration, so the fix **removes the ambiguity rather
than arbitrating it**: restricting the decorated type to the **keyword-led**
specifiers makes the bad derivation ungrammatical, and since no identifier can
start any of them, no conflict declaration is needed at all.

`prec(-1)` because `primitive_type` and `sized_type_specifier` both begin with the
same tokens (`void signed` is derivable), so the two readings collide and the
generator must prefer one. Preferring the existing `sized_type_specifier` keeps
today's parse intact — the decoration is only ever read where nothing else
parses anyway.

### 3. `preproc_header_name` — a header as a preprocessor argument

So that `#if __has_include(<vector>)` parses. The rule is scoped to the
**argument position** deliberately: `<` cannot *begin* a preprocessor expression
(the unary operators are `! ~ - +`), so no competing `<` token exists there and
the header token wins purely on match length. Adding `<…>` anywhere in
`_preproc_expression` instead would read `< B && C >` as a header name and turn
every comparison into something else.

### 4. `macro_access_specifier` — a MACRO used as an access specifier

```js
prec(-1, seq(
  alias($.identifier, $.macro_access_specifier),
  ':',
)),
```

The M60 cpp review's third and largest R1 cause, and the only one that was a single
construct rather than a family. nlohmann writes an access specifier as a macro:

```cpp
JSON_PRIVATE_UNLESS_TESTED:            // single_include/nlohmann/json.hpp:26041
  using lexer = ::nlohmann::detail::lexer_base<basic_json>;
```

Legal C++, and at class scope a bare `NAME:` has no other reading at all — but
`access_specifier` is a keyword choice, so the grammar had no production for it. The
line became an `ERROR` node and **the ERROR swallowed the rest of the class body**.
That was the entire R1 loss for `basic_json`: the node ended at row 26,599 where the
source's own brace balance ends at 32,291.

A sibling of patch 2 in the same choice, with `prec(-1)` for patch 2's reason — a bare
`identifier` also begins a field declaration, so the generator must prefer one reading
and today's parses must stay intact. The mandatory `:` immediately after the name is
what keeps the rule from swallowing a real declaration: `MACRO x;` and `MACRO::member`
both need a token this rule does not consume.

| | 3 patches | 4 patches |
| --- | --- | --- |
| `nodeTypeCount` | 547 | **548** |
| named ids / unique | 259 / 209 | **260 / 210** |
| named types only here | +`macro_prefixed_type_specifier`, `macro_specifier`, `preproc_header_name` | + **`macro_access_specifier`** |
| `fieldCount` / `fieldSetDigest` | 50 / `891be791…` | **50 / `891be791…` (unchanged)** |
| `basic_json` body, single header | 200 members, ends 26,599 | **266 members, ends 27,550** |
| ERROR nodes, single header | 381 | **367** |

Across the 1,722-file six-repo corpus **exactly 6 parse trees change and all 6 contain a
macro access-specifier label** — 0 unexplained changes.

### The toolchain, because the bytes are not the release's

There is no `tree-sitter-cli` dependency here, only the `web-tree-sitter` runtime, so
the wasm was built with a CLI installed **outside** the repo. A 0.25.9 build of the
*unmodified* `grammar.js` does **not** reproduce the previously wired bytes
(3,516,632 vs 3,552,974) — which is exactly the situation the note at the end of this
file warns about. What makes the rebuild trustworthy anyway is that the **entire
recorded surface matches**, all ten fields including `idOrderDigest`, `typeSetDigest`
and `fieldSetDigest`, and the parse trees are identical on 220/220 files. That is the
perl lane's documented rule: *two builds of one source agree even when their bytes
differ*, so the source is pinned and every delta after the baseline build is
attributable to the grammar rather than to the compiler.

### Patch 4 was withheld once, and why that is part of its record

On first measurement patch 4 made the analyzer's output **worse** (110 `basic_json`
members against 160) and was not landed. Recovering the class let the parser reach a
later constructor and complete the shape by reading the **whole class as a return
type** — patch 2 admits a class in type position, so patch 4 activated that reading:

```
function_definition[26010-27617]
  type:       macro_prefixed_type_specifier[26010-27550]   <- the entire class
  declarator: function_declarator[27554-27556]             <- a constructor
  body:       compound_statement[27557-27617]
```

It fabricated a function spanning 2,540 lines of class body and turned `basic_json`
from a `class` into a `variable`. It landed only after **both** of its dependencies
were fixed, and neither is defensible alone:

* the analyzer guard `returnTypeIsClassDefinition` — a class **definition** is never a
  return type, so a `function_definition` whose `type` field is a class specifier
  *with a body* is a recovery artifact. Gated by **D11**, which is corpus-based by
  necessity: the shape reproduces in no slice, not even the full 1,608-line span
  containing the class, the constructor and the glue, and appears only when the whole
  32,725-row amalgamation is parsed. D11 was proved to fail (10 without the guard, 0
  with it), and that control found 6 further sites this review had not —
  `TEST_CASE_TEMPLATE` in Catch2, the same shape in a second family.
* the engine's **1 MiB parse cap**, which had been cutting the 1.27 MB amalgamation at
  row 27,085 and silently dropping 4.84% of all corpus source bytes. It masked this
  entire effect: with the cap fixed, both files publish 110 members against 80.

## The fork is load-bearing, and that is measured

| | wired (fork) | published 0.23.4 |
| --- | --- | --- |
| wasm bytes | **3,520,521** | 3,434,931 |
| `nodeTypeCount` | 548 | 543 |
| named ids / unique | 260 / 210 | 256 / 206 |
| anon ids / unique | 288 / 286 | 287 / 285 |
| `fieldCount` | 50 | 50 |
| `fieldSetDigest` | `891be791…` | `891be791…` (**unchanged**) |
| named types only here | `macro_prefixed_type_specifier`, `macro_specifier`, `preproc_header_name`, `macro_access_specifier` | — |

Four named types added, **zero fields** — so the fork extends the vocabulary
without changing any field contract the analyzer reads.

Over this lane's own 28 C++ fixtures: **the fork parses 22 clean, upstream 20.**
The two files that separate them are `cpp/preproc-has-include.cpp` and
`cpp/macro-decorated-specifier.cpp` — the fixtures that were written *for* patches
2 and 3. Without the fork they do not parse at all.

On the `fmt` corpus the two agree on **47/47** files, so the fork neither helps
nor hurts ordinary library C++; everything it buys is on macro-heavy and
preprocessor-heavy code, which is exactly the code that used to produce ERROR
nodes.

Re-run any of it:

```bash
bun run script/cpp-review/grammar-provenance.ts \
  wasm/tree-sitter-cpp.wasm <tarball>/package/tree-sitter-cpp.wasm fmt nlohmann-json
```

## Why `source↔wasm` is "not applicable" here

The other vendored lanes prove the wired bytes are a build of the committed
source by comparing the source's generated `node-types.json` against the wasm's
materialised types. That proof **cannot** be made to pass for this lane without
hand-editing a generated file: the tarball's JSONs are upstream's and lack the
fork's three types, so the check would report a permanent three-type delta, and
the fork's own JSONs can only be produced by `tree-sitter generate` from the
forked `grammar.js`. A generated file that has to be hand-corrected for a proof
to pass is worse than a proof that honestly says it does not apply.

What pins this lane instead: the wired **sha256** and byte length, the full
**surface** (counts plus three digests, `fieldSetDigest` among them), and a
**per-file sha256 for all five vendored files** — so a change to the bytes, to the
grammar's surface, or to any vendored source file turns the gate red on the next
run.

## Rebuilding

```bash
# from the repository root, and NOT from this directory alone:
# grammar.js requires ../tree-sitter-c/grammar.js
tree-sitter generate --grammar-path grammars/tree-sitter-cpp/grammar.js
tree-sitter build --wasm --output wasm/tree-sitter-cpp.wasm grammars/tree-sitter-cpp
```

A rebuild that changes the surface digests without a change to `grammar.js` means
the toolchain moved, not the grammar — which is a fact worth recording, because
the whole pin rests on the bytes being attributable to this source.
