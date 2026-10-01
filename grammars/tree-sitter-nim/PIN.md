# tree-sitter-nim — grammar pin

This directory is the **source of record** for the Nim grammar the product
loads. `wasm/tree-sitter-nim.wasm` is a build of exactly these files, and
`script/m14/verify-grammar-pins.ts` proves that offline on every run.

## Upstream

| | |
| --- | --- |
| repository | `alaviss/tree-sitter-nim` |
| version | `0.6.2` (from `tree-sitter.json` → `metadata.version`) |
| revision | `ac72ba30d16edf0be021588a9301ede4accd6cf4` (2026-07-03) |
| license | MPL-2.0 (`LICENSE`) |
| author | alaviss (leorize) |
| upstream checkout | `$HOME/fixtures/nim/grammars/tree-sitter-nim-alaviss` |

## What is vendored, and why

| file | why |
| --- | --- |
| `grammar.js` | the grammar. 1,600 lines; the whole surface. |
| `scanner.c` | the **external scanner**. Nim's layout is not expressible as a context-free rule: the scanner owns `_layout_start` / `_layout_end` / `_inhibit_layout_end`, and the parser is wrong without it. This is the one file the wasm cannot be rebuilt without, and `.gitignore` names it explicitly (`!grammars/tree-sitter-nim/scanner.c`) for the same reason it does for `tree-sitter-cpp/src/scanner.c`. |
| `tree-sitter.json` | the grammar's declaration (name, scope, file-types, `injection-regex`). The tree-sitter CLI needs it to emit ABI 15. |
| `package.json` | the package identity the wasm is published under. |
| `LICENSE` | MPL-2.0 requires the license to travel with the source. |
| `README.md` | upstream's own description of the grammar. |
| `queries/highlights.scm` | upstream's highlight queries. The engine does not load them; kept so the vendored tree is the upstream tree. |
| `test/corpus/*.txt` | the grammar's own conformance suite — 72 cases in 6 files (`declarations`, `deviations`, `errors`, `expressions`, `extras`, `literals`, `statements`). These are upstream-authored expectations, not generated, and they are the evidence that the wired build is not merely *a* build of this source but a *working* one. |
| `src/grammar.json`, `src/node-types.json` | **generated**, and vendored on purpose: `verify-grammar-pins.ts`'s `sourceVsWasmFor` needs them to run its offline source↔wasm proof — every name the source declares must exist in the wired wasm, and every wasm-named type must be declared by the source. Without these two files the check reports "not applicable" and the lane has no such proof. `.gitignore` names both (`!grammars/tree-sitter-nim/src/{node-types,grammar}.json`). |

## What is NOT vendored, and why

| path | why |
| --- | --- |
| `src/parser.c` | 41 MB of generated tables. `tree-sitter generate` rebuilds it from `grammar.js` + `scanner.c`, so keeping it would be 41 MB of drift surface for nothing. |
| `src/tree_sitter/` | regenerated headers. |
| `src/parser.c` + wasm in the build tree | the wired bytes live at `wasm/tree-sitter-nim.wasm` and are pinned by sha256 in `validation/m14/grammar-pins.json`. |
| `bindings/`, `binding.gyp`, `Makefile`, `CMakeLists.txt`, `Cargo.toml`, `go.mod`, `pyproject.toml`, `setup.py`, `Package.swift`, `mise.toml`, `REUSE.toml`, `jsconfig.json` | native/package-manager bindings for platforms this product does not build for. |
| `samples/cps`, `samples/nim` | upstream's sample programs. They are not parser input for the product; the corpus under `$HOME/fixtures/repositories/nim` is. |

## Rebuild

```sh
# from a checkout of alaviss/tree-sitter-nim @ ac72ba3
cp scanner.c src/scanner.c        # SEE THE HAZARD BELOW — do not skip this
tree-sitter generate                                  # -> src/parser.c (41 MB)
tree-sitter test                                     # 72/72, upstream's own suite
tree-sitter build --wasm --docker -o tree-sitter-nim.wasm
cp tree-sitter-nim.wasm <repo>/wasm/tree-sitter-nim.wasm
cp tree-sitter-nim.wasm ~/.bb/wasm/tree-sitter-nim.wasm   # the data-dir mirror
```

### Rebuild hazard: the scanner is at the wrong path in this vendored tree

**Upstream keeps the external scanner at `src/scanner.c`. This vendored tree has
it at the tree root, and `tree-sitter generate` does not move it.** The externals
are declared in `grammar.js` (`externals: $ => [...]`), not in `tree-sitter.json`
— and neither upstream nor this copy declares `external-scanner` there — so
`generate` produces a `src/` with `parser.c` and an EMPTY `src/tree_sitter/`, and
silently no `src/scanner.c`.

The failure is quiet and severe. `tree-sitter test` then fails with

```
undefined symbol: tree_sitter_nim_external_scanner_create
```

and, if a build is forced anyway, the resulting wasm parses **no
indentation-sensitive Nim correctly** — the layout scanner is what owns
`_layout_start` / `_layout_end`, and without it a NIM file is a stream of
ERROR nodes. The wired wasm was built with the scanner present, which is why the
lane is green; the two-command sequence above was not sufficient to reproduce it,
and nobody would have noticed from the build's exit code.

`cp scanner.c src/scanner.c` is therefore a REQUIRED step, not a convenience. The
cleaner fix is to vendor the scanner where upstream has it, which changes this
tree's per-file digest and therefore the pin record — recorded here rather than
done silently, because the pin's file list is a shared instrument.

Toolchain used for the wired build: **tree-sitter-cli 0.25.1** (wasm via the
bundled docker path, `emscripten/emsdk:4.0.4`) and **web-tree-sitter 0.25.9**
as the runtime that loads it. The build is a plain upstream build — **no
patches to `grammar.js` or `scanner.c`** — which is why `patches` is empty in
the pin record. (Contrast `tree-sitter-fsharp`, whose wired wasm is a patched
rebuild; that lane's record names its two patch clauses.)

## do-pragma: MEASURED, and the answer is no

`expr.#[ … ].#` is the largest remaining parse gap (16 corpus files). A 56-line
patch adding a `do_pragma_expression` production was written on 2026-09-27 and
deliberately left unapplied, on the grounds that an unproven grammar patch wired
into a pin is worse than a recorded gap. On 2026-09-28 the machine finally had the
~2 GB `tree-sitter generate` needs for this 41 MB `parser.c`, so the question was
answered with a measurement rather than left open. It was rebuilt end to end:

| Gate | Result |
| --- | --- |
| `tree-sitter generate` | **succeeds** — 15 min, 41,894,420 B `parser.c` (the box needed 2.3 GB available) |
| `tree-sitter test` (upstream's 72-case suite) | **72/72 pass** |
| compiler matrix, 17 files | 0 error files / 0 error nodes — unchanged, no regression |
| **whole pinned corpus, 3,914 files** | **0 files FIXED, 6 files REGRESSED**, 3,908 unchanged |
| the 64 corpus files containing a do-pragma | 17 error files / 20 nodes -> **23 / 28** |
| a 400-file corpus sample | 8 error files -> **9** |

So the patch is not merely unproven: it is **strictly harmful as written**. It
fixes nothing and breaks six files, all of them macro-heavy
(`nimsuggest/tests/{t21185,tdot4,tno_deref,tsug_accquote,tuse_structure,twithin_macro}.nim`).
The likely cause is structural rather than typographical: the `#[` is consumed by
the EXTERNAL SCANNER as a block-comment extra, so a grammar-level production for
the same token competes with the scanner that owns it, and a `prec("suffix")`
rule cannot win that contest the way an ordinary production can.

**The patch stays unapplied and the wasm stays unwired.** The full patch is
preserved at `grammars/_vendored/nim/0001-nim-dopragma.patch` and the
rebuilt candidate wasm at a `nim-dopragma.wasm` (NOT vendored — 5.9 MB, and this repo gitignores grammars/*.wasm by policy; it rebuilds from the patch)
(5,914,156 B) for whoever takes it on — a real fix has to reach the SCANNER, not
only the grammar.

This is also the clearest vindication of the three-gate rebuild protocol: the
conformance suite passed 72/72 on a build that made the corpus worse, because
upstream's own suite contains no do-pragma case. Conformance proves the patch did
not break what upstream tests; only the corpus sweep caught what it did.

## Why this grammar and not another

All four published `tree-sitter-nim` grammars were cloned, generated, built and
measured on the same 17 files — every construct group in the official Nim
grammar (`doc/grammar.txt`), each one accepted by the real Nim 2.2.12 compiler
before its tree was read. One candidate per process, because every grammar
declares `name: "nim"` and web-tree-sitter keys loaded grammars by that name.

| candidate | rev | ids | named types | fields | matrix files clean | verdict |
| --- | --- | --- | --- | --- | --- | --- |
| **alaviss** | `ac72ba3` (2026-07-03) | 377 | 127 | 24 | **17/17** (0 ERROR, 0 MISSING) | **wired** |
| aMOPel | `4900b68` (2023-10-01) | — | — | — | — | **cannot be loaded** by web-tree-sitter 0.25.9: `bad export type for 'tree_sitter_nim_external_scanner_create': undefined` (the symbol is in its wasm; the export does not resolve under the pinned runtime) |
| haxscramper | `c29c404` (2021-01-17) | 232 | 114 | **0** | 0/17 — 283 ERROR, 7 MISSING | rejected: transcribes the ABNF tokens of `doc/grammar.txt` as node types (`IND`, `DED`, `OP0`…`OP9`, `INT_LIT`…) and emits **no fields at all**, so nothing in it is addressable by field and indentation-sensitive Nim does not parse |
| reo101 | `d68239f` (2022-03-06) | 3 | 1 | 0 | 0/17 — 38 ERROR | rejected: a 9-line stub (`source_file: $ => "hello"`, with a `// TODO: add the actual grammar rules`) |

`alaviss` declares 126 named types that no other candidate declares, and the
other direction is haxscramper's raw token vocabulary. It is also the only
candidate whose own conformance suite passes here: `tree-sitter test` on the
vendored `test/corpus` is **72/72 successful parses, 0 failures**, plus its two
highlight suites.

Reproduce: `fixtures/nim/grammar/ab-run.sh` (surface + matrix) and
`fixtures/nim/matrix/check-matrix.sh` (the compiler half).

## Known grammar limits (measured, not assumed)

The grammar's own `test/corpus/deviations.txt` documents three, and the
analyzer's doc records them as explicit unknowns rather than defects:

1. a comment inside a string literal is consumed as a comment;
2. a comment inside a generalized string is consumed as a comment;
3. `import x except y` is modelled, but the `except` list is an
   `expression_list`, so the analyzer reads it structurally.

One more was found by this lane and is recorded in
`docs/analyzers/real-nim-analyzer.md`: the grammar has no node for a `sink`
parameter modifier, so `proc f(a: sink seq[int])` parses as a one-argument
`call`. The analyzer unwraps it as a type modifier.
