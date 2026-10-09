# AGENT ROSTER — Laptop B, one agent per lane

**Created 2026-10-09** (the session that picked up `docs/analyzers/HANDOFF.md`). The teammate cap was
raised to **75**, so the handoff's §6 recommendation is finally affordable: **one permanently named
agent per lane**, rather than repurposing eight members across twenty-three languages.

**Why this is the shape**: a lane's context is the most expensive thing in this programme to rebuild.
An agent that owns exactly one analyzer accumulates its grammar quirks, its corpus holes, its own
refuted claims and its own instruments in ONE context that is never diluted by another lane's work.
When a defect turns up in `real-r-analyzer.ts` in two months, the Lead sends a message to `r-lane`,
not to "whoever was holding the R lane at the time".

**The roster is also the addressing scheme.** A request is addressed by LANE, never by history.

---

## How to address work

| to ask about… | send to |
|---|---|
| the R parser hang, R coverage, `degraded` counts | `r-lane` |
| markdown's inline-companion `uses` edges, coverage block | `markdown-lane` |
| anything in `src/ast/real-<lang>-analyzer.ts` | `<lang>-lane` |
| the board's row for a lane, a coverage block that will not close | the lane, with the board output |
| a SHARED instrument (`firing-check.mjs`, `incoming-gate.ts`, `language-board.ts`, `engine.ts`) | **the Lead** — lanes do not edit shared files unilaterally |

## The lanes

| lane | agent | task | first item |
|---|---|---|---|
| markdown | `markdown-lane` | task-1 | coverage block over the corrected `3 types fired` (was 1: instrument defect) |
| toml | `toml-lane` | task-2 | declared coverage over the committed whole-corpus construct census |
| hcl | `hcl-lane` | task-3 | evidence class for each of the five silent types |
| julia | `julia-lane` | task-4 | replace JUL-D1/JUL-D2 `unclassified` with measured classes |
| r | `r-lane` | task-5 | reproduce-or-refute the per-file parser hang, then coverage |
| clean | `clean-lane` | task-6 | `extends`: `grammar-absence` or `zero-sites`, by measurement |
| bash | — | — | queued |
| f# | — | — | queued |
| zig | — | — | queued |
| lua | — | — | queued |
| nim | — | — | queued |
| php | — | — | queued |
| powershell | — | — | queued |
| dart | — | — | queued |
| sql | — | — | queued |
| graphql | — | — | queued |
| protobuf | — | — | queued |
| json | — | — | queued |
| yaml | — | — | queued |
| css | — | — | queued |
| scss | — | — | queued |
| make | — | — | queued |
| xml | — | — | queued |

Rows read `—` for an unspawned lane ON PURPOSE: an empty cell is not a claim that the lane is fine.

## Session rules that bind every lane agent

1. **ONE SHARED CHECKOUT, disjoint write scopes.** Lanes work in
   `$HOME/mcp/backbencher-brain` — **not** in the per-lane worktrees under
   `$HOME/mcp/bb-lanes/`, which are frozen at `analyzer/<LANE>` and measured **1,140–2,476
   commits behind** `analyzers/ontology-laptop-b` on 2026-10-09, with **0 commits ahead**. A lane's
   isolation comes from a disjoint file set (its analyzer, its spec, its fixtures, its doc), which is
   what the "never let two agents share a checkout" rule was protecting — not from a second copy of
   the tree. The failure mode was two agents editing ONE file, and one agent per lane removes it.
2. **A lane writes only its own four paths.** Anything else needs the Lead's agreement first.
3. **Git**: `git add <exact paths> && git commit -q -F - -- <exact paths>`. A bare `git commit` is
   forbidden — it takes the whole shared index and has swept another agent's files twice already.
4. **Machine**: one 8-core laptop for every agent. `uptime` before a heavy run; 1-minute load above
   8 → do lighter work first. Corpus-scale runs take `( flock -w 600 9 || exit 9; <cmd> ) 9>.bb-heavy.lock`.
   A killed command is reported **KILLED**, never as a negative result.
5. **Every number** comes from an instrument on the production path. A source count is not evidence.
6. **Self-refutation with evidence is the most valued work.** Every finished lane in this programme
   has corrected at least one of its own numbers.

## Instruments, and the one that was wrong

`script/m14/firing-check.mjs` was corrected on 2026-10-09 (`f5dec55d3`). It had claimed since it was
written to run "the PRODUCTION path (getParser -> parseFile -> analyze)" while calling
`parser.parse` + `Cls().analyze` directly — so it never built the engine's `AnalyzeContext`.
Measured on the same 60 files, one process:

```
BARE  (the instrument, before)  contains:2070
PROD  (engine.parseFile)        contains:2070   uses:759   references:31
```

`uses` is the only edge type by which a markdown document declares where it points, and the
instrument could not see it — while its log is what the board reads. The instrument now carries a
**control** (a planted markdown link through `parseFile`) and exits 3 rather than print a table it
cannot trust. Any lane whose numbers predate that commit should re-run before quoting them.
