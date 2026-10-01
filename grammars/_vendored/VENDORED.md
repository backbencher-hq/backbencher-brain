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
| `repair-loop.sh` | `fixtures/grammar-repro/` | 2,215 |
| `grammar-floor.json` | `fixtures/validation/` | 2,367 |
| `repro-cases/*.vb` (27) | `fixtures/grammar-repro/cases/` | 112 KB |

**These now run from the repository.** They did not when first vendored: all four
resolved paths from `$HOME/…`, so a clone could not execute them at
all. They now derive `ROOT` from their own location, and every remaining absolute
path is an `env`-overridable default (`BB_REPO`, `BB_VB_CORPUS`, `BB_VB_BIN`,
`BB_CORE_WASM`, `VB_WASM`, `OUT`, `BB_VB_CANDIDATE`, `BB_VB_BUILDLOG`).

Verified on 2026-10-01:

```
./grammar-gate.sh --no-build     → 1,185 files over 4 corpora, aggregate 90.89% clean
./repair-loop.sh  --no-build     → cases: 27 pass / 0 fail  (of 27)
```

**Read the gate's exit code before wiring it into anything — it is a RATCHET,
not a pass/fail check.** `gate-compare.py` returns:

| code | meaning |
|---|---|
| **0** | the corpus aggregate IMPROVED above the recorded floor |
| **1** | **GATE FAILED** — clean% fell below the floor, or crash files rose. This is the one that must break a build. |
| **2** | **NO MOVEMENT** — the corpus is exactly at the floor |

So running it on an unchanged tree gives **2**, not 0, and that is correct rather
than broken: the gate exists to judge a *repair attempt*, and "no movement" is the
verdict on a repair that did not reach the corpus. `deliberately exits 2` is also
the right answer for a CI job, because wiring "did not fail" into a pipeline
would silently accept a repair that changed nothing. Crash files are a floor of
their own and fail at any count above the recorded one, so a clean% improvement
can never buy a grammar that throws.

So the differential half — the one the VB lane's "no 32 % regression" claim
actually rests on — is executable here with **no prerequisites at all**, and the
27 repro cases run through the real analyzer.

**The build half needs one thing that is deliberately not vendored:** the
`tree-sitter` CLI, an 18.8 MB ELF binary. This repository installs tooling rather
than committing it. `--no-build` never needs it, and `repair-loop.sh` now
**refuses before touching anything** if the CLI is absent.

That last point is a fix to a real hazard, found by running the thing:

> `repair-loop.sh` does `rm -rf src` before generating, which is correct and must
> stay — removing it reintroduces #841, where a failed generate leaves the
> previous grammar in place and the build emits a wasm of the OLD grammar. But it
> makes the CLI a hard prerequisite, because once `src/` is gone a generate that
> cannot run is unrecoverable from inside the script. Running the build half here
> on a machine without the CLI **deleted `tree-sitter-vbnet/src/grammar.json` and
> `src/node-types.json` — two tracked pin files — and then failed with rc=127.**
> They were restored from git, and a `command -v tree-sitter` preflight now runs
> before the destructive step.

`grammar-floor.json` is tracked and is the recorded baseline the gate compares
against: 1,185 files, 90.89% clean, carrying the `grammarWasmSha256` it was taken
against. That hash still matches the wired `wasm/tree-sitter-vbnet.wasm`
(`c6182994f4353cdd`), so the floor describes the grammar that is wired right now.
`grammar-candidate.json` is what every run WRITES, so it is gitignored.

## `script/m14/tmp/` — seven probes (in the repo's existing probe directory)

`boundary-truncate.ts`, `defect-census.ts`, `gate-compare.py`,
`grammar-bakeoff.ts`, `grammar-baseline.ts`, `grammar-cases.ts`,
`vb-analyzer-e2e.ts`, `vb-source.ts` — from `fixtures/probes/`, 49 KB total. These are the instruments
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
