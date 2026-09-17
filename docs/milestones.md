# Milestone registry — the R1 surface

> Rule R1 (validation/m60/ledger.json `standingRules`): **no new milestone for
> work that belongs to an existing one; findings become issues.** Enforced by
> `script/m60/verify-standing-rules.ts` (R1 live check): every OPEN GitHub
> milestone must appear in this registry. An undocumented milestone is invisible
> to governance — which is how the milestone count grew unbounded.
>
> Adding a milestone? Add a row AND its `docs/mNN/PLAN.md` in the same commit.

## Open milestones

| # | Milestone | Lens | Plan / docs | Status note |
|---|---|---|---|---|
| 11 | M11 Real-Repository Analyzer Correctness | 40+ language support & limitation truth | *(pre-plan-format)* | legacy scaffold; 6 legacy issues (#134–#139) remain open |
| 14 | M14 Analyzer Truth & Honesty | analyzer honesty (the analyzer's own oracle) | docs/m14/ | active |
| 37 | M37 Dual-Lens Analyzer Backfill | families against each other | docs/m37/ | active; #614 closure armed after M49/M60 fold |
| 41 | M41 Website Truth, SEO & Design | website truth | docs/m41/ | active |
| 45 | M45 Demo Media Truth | website demos | docs/m45/ | active |
| 49 | M49 Review-Intake & Gate-Hardening | external claims against the code | docs/m49/, reviews/onboarding.md | active; M60 fold target |
| 56 | M56 Website Completion — Surfaces, Sources, IA | website completion | *(no PLAN in repo — registered 2026-09-14 by the R1 sweep)* | open; issues #780–#787 |
| 58 | M58 Analyzer Lane Review — foreign-red gates (M57 convictions) | fix foreign-minted gate convictions in the analyzer lane | *(no PLAN in repo — registered 2026-09-14)* | open; #802 #803 #805 #811 |
| 59 | M59 Call-Site Truth | no relationship without a real line | docs/m59/ | active |
| 60 | M60 Family Truth Reconciliation | standing rules + payload seam; closes JVM/web remainder | docs/m60/PLAN.md | active; terminal milestone |
| 61 | M61 Verifier Truth — the machinery that watches the machinery | verifier honesty: evidence sealing, gate serialization, reproducibility, claim pins | *(no PLAN in repo — all 8 issues link `docs/m61/M61-MASTER-PLAN.md`, which does not exist; registered 2026-09-15 by the R1 sweep so the milestone stops being invisible to governance)* | open; issues #842–#849 |
| 62 | M62 Address Truth — nothing shows a position it does not know | the **consumption** half of M59's line contract: one address owner (real / legacy-0 / not-stored), labeled substitutes only, no surface shows a position it does not know | *(no PLAN in repo — the milestone description names `docs/m62/M62-MASTER-PLAN.md`, which **does not exist**; registered 2026-09-16 by the R1 sweep so the milestone stops being invisible to governance. Lane per its own description: `src/lsp`, `src/intelligence/graph`, `script/m62`, `validation/m62`, `docs/m62`, co-agent lanes read-only)* | open, created 2026-09-16 with 5 issues and no closed ones. **R1 note:** M59 makes the *stored* call-site line real; M62 governs what a *surface* may show of it. Whether that is one lens or a fold into M59 is an owner decision — recorded here rather than left invisible either way. Its plan file must land with its first commit, per the header rule. |

## Finished milestones left open on GitHub (tracker hygiene, not work)

M7, M8 and M39 have zero open issues and no plan of record; they are finished.
They stay listed here until someone with tracker rights closes them — closing a
milestone is a tracker action, not a code change, so this registry is the honest
record until then.

| # | Milestone | Evidence finished |
|---|---|---|
| 7 | M7 Write Tools | 0 open / 10 closed issues; no docs/m7 plan (pre-plan era) |
| 8 | M8 CLI, Cross-Lang, Ship | 0 open / 13 closed issues; pre-plan era |
| 39 | M39 | 0 open / all closed; no docs/m39, no repo references at all |

## Why this file exists

Three milestones (M14, M37, M49) each certified the JVM and Web families done
while findings stayed open — because each milestone measured its own artifact
and none measured payload truth across the emit→store→query→tool seam (the M60
plan's diagnosis, docs/m60/PLAN.md). R1 exists so that never compounds: work
belongs to an existing milestone (as an issue) unless a NEW dimension genuinely
needs one — and if one is minted, it is documented here in the same commit.
