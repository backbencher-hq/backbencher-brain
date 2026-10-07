# R7 audit — Rust, ripgrep, BEFORE any fix in this lane

Measured 2026-10-05 on branch `analyzer/R7_AUDIT_FLEET` at `9dc60acc0`.

- instrument: `script/incoming-rust/rust-r7-audit.ts` (`--repo=ripgrep`)
- entry: `parseFile` from `src/ast/pool-worker` — what the indexer calls, not `analyze()`
- population: **110 `.rs` files**, derived from `git ls-files` over
  `$HOME/fixtures/repositories/ripgrep` filtered by
  `detectLanguageFromPath`, 1,901,836 bytes. 0 parse failures. 5,150 symbols,
  0 empty symbol names, 0 empty/unknown symbol kinds.
- raw: `r7-ripgrep-before.json` (machine) / `r7-ripgrep-before.txt` (instrument's own report)

## Per-type edge counts

| type | edges | files | src placeholder | tgt placeholder | src empty | tgt empty | tgt absent |
|---|---|---|---|---|---|---|---|
| calls | 17083 | 96 | 426 | 71 | 0 | 0 | 4392 |
| uses | 3207 | 86 | 155 | 47 | 0 | 0 | 60 |
| contains | 3809 | 70 | 3 | 41 | 0 | 0 | 5 |
| imports | 610 | 97 | 503 | 69 | 0 | 0 | 96 |
| references | 2928 | 84 | 33 | 0 | 0 | 0 | 847 |
| exports | 140 | 39 | 140 | 0 | 0 | 0 | 0 |
| extends | 7 | 3 | 0 | 0 | 0 | 0 | 5 |
| implements | 252 | 44 | 2 | 0 | 0 | 0 | 71 |
| overrides | 1011 | 44 | 0 | 0 | 0 | 0 | 0 |
| instantiates | 613 | 52 | 18 | 0 | 0 | 0 | 0 |

29,660 edges, 59,320 endpoints. **1,280 source + 228 target = 1,508 endpoints
(2.5%) carry a literal on the instrument's placeholder list. 0 carry an empty
name.**

## The placeholder literals found, by name

| name | where | count | files |
|---|---|---|---|
| `global` | source of exports | 140 | 39 |
| `global` | source of imports | 503 | 97 |
| `global` | source of calls | 377 | 46 |
| `global` | source of uses | 144 | 22 |
| `default` | calls+uses+contains+references+instantiates, both ends | 181 | — |
| `super` | target of imports (a `use super::x` path prefix) | 36 | — |
| `crate` | target of imports (a `use crate::x` path prefix) | 33 | — |
| `None` | target of uses/contains | 42 | — |
| `none` | target of calls/uses/contains/references/instantiates | 23 | — |
| `root` | target of uses/contains/references/calls | 17 | — |
| `null` | source+target of uses/contains, target of calls | 4 | — |
| `anonymous_impl` | source of implements, target of contains | 5 | 1 (declared synthetic, R10) |

## The three findings that are real defects regardless of classification

1. **`exports` is 140/140 placeholder-sourced.** Every single `exports` edge this
   analyzer emits names `global` as its source (`real-rust-analyzer.ts:997`,
   `publishExport("global", …)`), and `imports` names `global` on 503 of 610 rows
   (`real-rust-analyzer.ts:905`). No other lane's graph can resolve an endpoint
   called `global`; `bb_graph`'s file-level reader filters on this column.
2. **`imports` targets that are Rust PATH KEYWORDS.** `use super::util;` splits to
   module `super` (36 edges) and `use crate::flags::Flag;` to `crate::flags`
   (33 edges). The two keywords are path roots, not names any declaration has, and
   a `use` of one segment (`use serde;`) publishes the crate name — so the same
   column carries a crate, a module path, and a keyword depending on the
   declaration's spelling.
3. **`default`/`None`/`none`/`root`/`null` are on the placeholder list but are NOT
   necessarily placeholders.** `Default::default()` is a real Rust trait method and
   `None` is a real `Option` variant; whether they are R7 violations is a question
   about whether the corpus DECLARES them, and the instrument as committed answered
   the placeholder question first. That ordering is a defect in the instrument, not
   a finding about Rust, and it is corrected in the follow-up commit.

## Resolution classes (the R7-adjacent measurement)

| class | source | target |
|---|---|---|
| `file:unique` — declared once in this file | 19024 | 7351 |
| `file:ambiguous` — declared 2+ times here | 8251 | 6750 |
| `repo:declared` — another file of the repo declares it | 0 | 8553 |
| `absent` — nothing in the repo declares it | 81 | 5476 |
| `modulePath` — a `::` path, an `imports` target by construction | 13 | 291 |
| `dotted:both` — `Owner.leaf`, both halves resolve | 1011 | 928 |
| `dotted:neither` — `Owner.leaf`, owner resolves nowhere | 0 | 83 |
| `placeholder` | 1280 | 228 |
| `empty` | 0 | 0 |

**0 source endpoints name something another file of the repo declares, and 0 are
empty.** The R7 story for Rust is entirely a source-endpoint story, and it is
entirely the literal `global`.