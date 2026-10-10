# AGENT ROSTER — Laptop B, one agent per lane

**Created 2026-10-09** (the session that picked up `docs/analyzers/HANDOFF.md`). The intent was the
handoff's §6 recommendation — **one permanently named agent per lane** rather than repurposing eight
members across twenty-three languages — so that a lane's context is never diluted by another lane's
work and a defect is addressed by LANE, never by "whoever was holding it".

**What actually happened, measured, because the plan and the machine disagreed.** The running Team is
capped at **8 members** and cannot be raised mid-session: the cap is the `agent-team` plugin's
`maxMembers`, pinned to `8` in `@deepseek-ai/dsh-experimental-agent-team-profile/cordis.patch.yml`,
and the roster is constructed once from it at plugin init (`TeamRoster(ctx, journal, lifecycle,
config.maxMembers)`). The `75` that was raised is `@deepseek-ai/dsh-subagent`'s
`maxActiveSubagents`, which is a **different pool** — subagents, not durable teammates.

So the programme runs **8 durable lane owners on rotation**, plus a subagent pool for
findings that need a dedicated owner but not a permanent one:

| | mechanism | cap | what it is for |
|---|---|---|---|
| lane owners | `spawn_teammate` | **8** | durable identity, messageable by lane across turns |
| task force | `subagent` | **75** | one bounded, high-risk job with a single verdict |

To raise the teammate cap: add a patch entry to `~/.dsh/profiles/web/cordis.patch.yml` targeting
`agent-team` with `config: { maxMembers: 75 }`, then restart `dsh web`. The restart is required —
a live Team's roster size is fixed at construction.

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
| toml | `toml-lane` | task-2 | declared coverage over the whole-corpus census; `references` fires 167 edges corpus-wide where the 120-file sample says SILENT |
| hcl | `hcl-lane` | task-3 | evidence class per silent type; found HCL-D1 FALSIFIED (rules `calls`/`overrides` inapplicable while the analyzer emits both) |
| julia | `julia-lane` | task-4 | replace JUL-D1/JUL-D2 `unclassified` with measured classes |
| r | `r-lane` | task-5 | DONE — [BB-HANG] refuted as a leaked timer; a dead `degraded` counter; `a7d2fb5e6` |
| clean | `clean-lane` | task-6 | `extends`: `grammar-absence` or `zero-sites`, by measurement |
| yaml | `yaml-lane` | task-9 | 107 external claims REFUTED once the whole 2,082-file population is measured |
| json | `json-lane` | task-10 | reconcile the declared 8/8 against the firing log's 1 type |
| — | subagent `eccce1b6` | task-11 | verify-or-retract the unattributed 882 / 32,359 shared-resolution claim |
| bash, f#, zig, lua, nim, php, powershell, dart, sql, graphql, protobuf, css, scss, make, xml | — | — | queued: spawned as slots free |

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
