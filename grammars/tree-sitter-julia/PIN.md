# tree-sitter-julia — grammar pin

**Lane:** `julia` · **wired bytes:** `wasm/tree-sitter-julia.wasm`
**Provenance kind:** `local-rebuild-from-vendored-source`
**Base:** `tree-sitter/tree-sitter-julia` 0.23.1 (npm `tree-sitter-julia@0.23.1`)
**Re-measure with:** `bun run script/m12/julia-differential.ts [--wasm=<alt>]` ·
`bun run script/m60/julia-census.ts`
**Verify with:** `bun run script/m14/verify-grammar-pins.ts`

---

## Why this is a rebuild and not the published bytes

The npm tarball ships its own wasm and this lane started from it byte-for-byte —
`byte-identical-to-npm-tarball`, the strongest kind in the registry. That stopped being true:
the corpus differential found **185 files of valid Julia that the grammar could not parse**,
and four of the five named constructs are fixed by edits to `grammar.js`. The wired bytes are now
a rebuild of the vendored, patched source, and the pin has to describe *that*.

| build | bytes | sha256 (16) |
|---|---|---|
| WIRED `wasm/tree-sitter-julia.wasm` | 5,892,544 | `583519521e5136d8…` |
| REBUILD of this committed patched source | 5,892,547 | `201ac6b7e820d2b8…` |
| PRISTINE npm 0.23.1's own wasm | 6,223,352 | `e0f52c36eadf0299…` |

**The byte sha256s differ and they must**: a wasm build carries its emscripten version, compiler
flags and section order. Identity is therefore claimed on **surface and behaviour**, which is
what the gate measures, not on bytes. Measured: a rebuild of the committed source is
**behaviourally identical to WIRED on all 949 corpus files — 0 fixed, 0 broken, 949 unchanged.**

## The oracle, and why this lane has a real one

**Julia 1.11.3's own parser, reached through `Meta.parseall`.** It shares no code, no grammar,
no parse table and no data model with tree-sitter-julia. This is the first lane in this repo
where a second opinion is available from the *language itself* rather than from a hand-authored
truth file — and by this repo's own standard a hand-authored truth file is a **mirror**, which is
why the yaml lane reached for PyYAML and why objc's F5 oracle cannot referee a grammar change at
all.

**`Meta.parseall`, never `Meta.parse`, and the difference is not cosmetic.** Julia's `parse`
resolves operators in a single-expression scope and **rejects `a +% b`**; `parseall` accepts it,
because Julia accumulates operator definitions across a toplevel sequence. An oracle built on
`parse` reports the language's own wrapping-add operator as invalid. The same class of error as
objc's edge audit calling a block *parameter* an unresolved target — the instrument's model
reported as a fact about the product.

**A differential that goes green because its oracle is dead is the worst failure mode available
to one**, so the harness counts the oracle's own coverage and refuses to report a verdict without
it. The first version "agreed" on 949 files while the oracle had returned *nothing* — a
base64/hex mismatch in the transport — because a verdict of `parses: false` everywhere is
indistinguishable from a real sweep unless the coverage is counted.

## What the patches are, and what one of them cost

Four landed, one deliberately did not. Every count is measured against Julia 1.11.3 over 949
files (17 non-Julia IR dumps excluded by content, declared in the census artifact).

| | construct | files |
|---|---|---|
| **P2** | `∞` is a real unary operator (`∞(x)`, `x + ∞`) and was absent from `OPERATORS.unary` | 7 |
| **P3** | `const global x = 1` — the rule read `const` then an assignment, so `global` had nowhere to go | 10 |
| **P4** | `abstract type X; end` — the rule went from `type_head` straight to `end`, while `struct_definition` three rules below already had the optional body | 5 |
| **P5** | a function NAMED by an operator: `function ⊑ end` in `abstractlattice.jl` declares the abstract-lattice ordering relation | 46 |

**P1 (`+%` and `-%`) IS NOT LANDED**, with the whole measurement recorded beside its absence
because three attempts is three more data points than the next person needs to spend.

`+%` and `-%` are Julia's wrapping add and subtract, defined in `base/bool.jl`, `base/char.jl`
and `base/promotion.jl` and used throughout Base for performance — **52 of the 185 defect
files.** Julia lexes an operator as a *maximal run of operator characters*, so `+%` is one
operator name, not `+` applied to `%`.

| case | 0.23.1 | in `times` | `token(prec(-1))` | `prec(1)` + assign `prec(2)` |
|---|---|---|---|---|
| `a +% b` | 1E | clean | 1E | 1E |
| `xu -%= (UInt64(52) << 52)` | clean | **1E** | clean | clean |

`-%` collides with `-=`, and `+%` collides with `+`; both collisions are **two characters**, so
precedence decides — and tree-sitter's lexer **stops at the first accepting state**, so a
wrapping token that outranks `+` by precedence is never read at all. Every precedence arrangement
that fixes `-%=` loses `+%`. Over the whole corpus: the `times` variant **fixed 24 and broke 3**;
the `prec(-1)` variant **fixed 9 and broke 1**. A patch that fixes 24 and breaks 3 is not a patch
to land.

A real fix needs a **lexer**-level change, not a precedence value: either an external scanner
emitting the operator run as one token — which is what Julia's own lexer does — or a grammar whose
single-char `+`/`-` are not themselves accepting in an expression. Both are structural and belong
in an upstream discussion, not in a vendored copy.

## The one regression the landed patches cause

`base/Enums.jl` goes from **0 ERROR nodes to 6**, at a one-line
`primitive type $(esc(typename)) <: Enum{…} end` inside a `Base.@__doc__(…)` macro call. It is
recorded rather than hidden, and it was not found by any minimal case: five minimal probes of
that shape — including the exact construct and the `$(esc(…))` form — all pass under the patched
build. It is a parse shift that only manifests at file scale, which is the argument for the
full-corpus A/B existing at all: **net +8 files, with this one named.**

## Known gap, and it is large

**177 files of valid Julia still carry ERROR nodes.** The four landed patches account for 9 of
the 185 the differential found. The rest is unclassified: `script/m60/julia-error-minimal.ts`
reports the *smallest* failing span per file, because the *first* error points at line 1 in 121
of 185 files and clustering on it produced 15 clusters of which 9 were the Julia licence header.

Two clusters that looked like defects and were **not**, found by probing rather than by reading:

- `->` as a type-annotation arrow (`x::T->f(x)`) — parses clean
- unnamed arguments `f(::Int, ::Int)` — parses clean

That is the standing lesson of this session, applied three times now: an instrument that is
confident and wrong is worse than no instrument, and the check that catches it is a minimal case
asked of the *product*, not a second guess about the instrument.

## What is vendored, and what is not

`grammar.js` (patched), `package.json`, `tree-sitter.json`, `LICENSE`, `README.md`, `queries/`,
`src/grammar.json` + `src/node-types.json` **regenerated from the patched `grammar.js`** by
`tree-sitter generate` (CLI 0.26.9), and `src/scanner.c` + `src/tree_sitter/*.h` byte-identical
to the tarball.

**`src/scanner.c` matters more here than for most lanes.** Julia's grammar has an external
scanner, so the pin's source↔wasm check has a component a grammar-only pin would miss. The
census reads the scanner's token names out of the vendored `scanner.c` and compares them against
what the tree actually produces.

`src/parser.c` is deliberately **not** vendored: `tree-sitter generate` rebuilds it from
`grammar.js`, and it is tens of megabytes. This differs from the hcl lane, which vendors it so it
can rebuild the wasm from the directory alone; the difference is recorded rather than accidental,
because the two lanes' central claims are different — this lane's is the oracle's verdict, hcl's
is the offline rebuild.

## The hazard this pin exists to retire

Julia began as a lane with **no analyzer, no pin, no fixtures and no registration**, and the
first measurement found 185 files of valid Julia the grammar could not read. Writing the analyzer
before that number existed would have meant debugging the analyzer for defects that were in the
grammar, and — the failure mode this repo has already paid for twice — writing a corpus claim
from a 7-file instrument while a 49-file crash was being counted as a clean parse.
