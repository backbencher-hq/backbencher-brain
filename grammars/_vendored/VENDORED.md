# VENDORED external artifacts — provenance and how to run them

Files here were authored on this machine **outside** the repository, under
`$HOME/fixtures/`, and are cited by name from lane documentation in
this repo. They were moved in on 2026-10-01 so that the repository is the one
place the work lives, rather than a laptop-local path that stops existing the
moment the laptop does.

Nothing here was rewritten: every file is **byte-identical** to its original,
verified with `cmp` at the moment of the move (36 files, 0 mismatches).

## Why these and not others

The repository cites `$HOME/fixtures/…` from 45 `.md` files. Most of
those citations are **corpora** (`repositories/`, `hcl/`, `nim/…` clones) or
**tool installs** (`fixtures/bin/`) — all of which are meant to be re-fetched, and
none of which is work product. What follows is the subset that is genuinely
irreplaceable: measured patches, measurement outputs, probes and repro fixtures
that no other clone can produce.

## `nim/` — a measured, deliberately REJECTED fix

| file | was at | bytes |
|---|---|---|
| `0001-nim-dopragma.patch` | `fixtures/nim/out/` | 2,481 |
| `damage-census.txt` | `fixtures/nim/out/` | 5,785 |
| `damage-classes.txt` | `fixtures/nim/out/` | 789 |

The patch adds a `do_pragma_expression` production for Nim's `expr.#[ … ].#`. It
was written 2026-09-27 and **measured on 2026-09-28 against the whole pinned
corpus — 3,914 files — where it fixed 0 files and regressed 6.** So it is
**not applied**, and the wired wasm is deliberately upstream-only. The full
reasoning, including the likely cause (`#[` is consumed by the external scanner
as a block-comment extra, so a grammar-level production competes with the
scanner that owns it), is in `PIN.md` under "do-pragma: MEASURED, and the answer
is no".

**This is the single most important file in this directory.** It is the preserved
work of a failed experiment, kept because `PIN.md` promises it "for whoever takes
it on" — and a real fix has to reach the scanner, not only the grammar. Without
it, the next person repeats a 15-minute / 41 MB `tree-sitter generate` and
re-discovers the same regression.

`nim-dopragma.wasm` (5,914,156 B) is **deliberately not vendored.** It is a
build artefact of the rejected patch, and this repository gitignores
`grammars/tree-sitter-*/*.wasm` by policy. It can be rebuilt from the patch.

## `vbnet/` — the gate and the 27 repro cases

| file | was at | bytes |
|---|---|---|
| `grammar-gate.sh` | `fixtures/grammar-repro/` | 2,598 |
| `repro-cases/*.vb` (27) | `fixtures/grammar-repro/cases/` | 112 KB |

**The gate will not run from this repository as vendored.** It hardcodes
`$HOME/fixtures/bin`, `…/probes` and `…/validation`, and its build step
invokes a sibling `repair-loop.sh` that is not vendored. It is committed as the
documented instrument — its two halves (27 repro cases, then the corpus sweep) are
what the VB lane's "no 32 % regression" claim rests on, and the script is the
record of that claim — not as something to invoke from here. The 27 cases *are*
self-contained and readable, and several reproduce constructs the VB grammar is
known to get wrong.

## `script/m14/tmp/` — seven probes (in the repo's existing probe directory)

`boundary-truncate.ts`, `defect-census.ts`, `gate-compare.py`,
`grammar-bakeoff.ts`, `grammar-baseline.ts`, `vb-analyzer-e2e.ts`,
`vb-source.ts` — from `fixtures/probes/`, 46 KB total. These are the instruments
that produced the VB lane's numbers, and `reviews/vb/master-review.md` cites them
as the evidence for specific claims (the defect-class ranking, the end-to-end pass
through the production entry point, the bakeoff against other grammars). They are
placed beside the repository's other 2,065 tracked probes.

## Why `grammars/_vendored/` and not inside `grammars/tree-sitter-*/`

The pin gate's `measureVendored` walks a grammar's directory with `walkFiles`,
which does **not** honour `.gitignore`. The `vbnet` grammar directory currently
holds 30 MB of build artefacts — `src/parser.c` (26,199,618 B),
`src/tree_sitter/*.h` and a 4,073,046 B `tree-sitter-vbnet.wasm` — so anything
added inside it shows up as "vendored file added without a record", and
re-recording the digest to absorb them would enshrine 30 MB of build output in the
registry. `grammars/_vendored/` is outside every `tree-sitter-*` directory the
gate scans, so vendoring here costs the pin registry nothing and leaves the vb
lane's pre-existing artefact drift exactly as it was.
