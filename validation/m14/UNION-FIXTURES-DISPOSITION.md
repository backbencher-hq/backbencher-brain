# UNION — `validation/m14/fixtures/**` DISPOSITION (HEAD's pins kept, by measurement)

Batch: the `fixtures/**` portion of the 262 remaining modified paths in the `validation/m14` union.
RULING (settled by measurement, not re-litigated here): **HEAD's pins stay.** The Lead's lease ran the
main-pins arm: **main's pins FAIL 12 of 13 languages while HEAD's pass 8 fully** — a fixture that does not
pass the analyzer it ships with is a wrong fixture, so main's pins describe an analyzer this branch no
longer has.

## COUNTS, INDEPENDENTLY REPRODUCED HERE

`git diff --name-only HEAD origin/main -- validation/m14/fixtures` → **1,157 differing paths**, of which
**901 are ADD-ONLY** (absent from `origin/main`, so there is nothing on the other side to merge) and
**256 exist on both sides**. *The Lead's lease recorded 897 add-only / 256 both-sides; this run says 901 —
a 4-path difference, almost certainly a ref moved between the two runs, and it is stated rather than
rounded away.*

Top languages by differing paths: scss 120 · yaml 96 · xml 84 · dart 71 · fsharp 70 · python 69 · bash 60 ·
julia 59 · php 59 · zig 56 · css 33 · toml 28 · markdown 26 · protobuf 25 · r 25 · sql 25.

## DISPOSITION, PER PATH CLASS

* **901 add-only paths** — HEAD's version stands because there is no other side. Nothing lost: `origin/main`
  does not contain them.
* **256 both-sides paths** — HEAD's version stands **on the strength of the language-level measurement**
  above, not on a reading of the diff. The conflicting pairs are the same-edge spellings this branch's own
  fixes introduced (`overrides` dotted-target → leaf + `meta.overriddenOwner`; dart `part-of` specifier →
  the path it names; elixir `evidenceClass` `usage_contextual` → `structural`), so the loser is a PRE-FIX
  pin, not lost work.
* **PRESERVATION, and it is the reason "no work lost" still holds** — every superseded main-side pin remains
  recoverable from three independent places that are NOT this working tree: the `origin/main` ref itself,
  the three pushed safety tags (`safety/premerge-20261013-1222-{head-9467af086,main-1b71d837c,supervisor}`),
  and the full bundle `.tmp-merge/FULL-BACKUP-20261013-1229.bundle`. **Copying 1,157 main-side files into
  this tree would not preserve anything — it would replace pins this analyzer PASSES with pins it FAILS**,
  which is the opposite of a union.

## NAMED RESIDUALS — the small list that needs a human (five languages, both sides failing)

These fail on HEAD's pins AND on main's, so they are **this branch's own unfixed fixture failures**, not a
union conflict: **javascript 74 pass / 3 fail · scala 71 / 6 · elixir 67 / 15 · vue exit 4 · cpp exit 4**.
They are named here so they are not re-opened as union problems; each needs its owning lane.

## GATES, READ FROM `$?` AND NOT THROUGH A PIPE

* `npx tsc --noEmit -p tsconfig.json` → **exit 0**
* `npx tsc --noEmit -p tsconfig.scripts.json` → **exit 0** (the rule adopted this turn: the root config
  includes only `src/**/*.ts`, so the first command is never evidence about `script/`)

## EARNED / NOT EARNED

* **EARNED** — the counts above (independently reproduced, with the discrepancy stated), the disposition of
  both path classes, the preservation argument, and the five named both-side failures.
* **NOT EARNED** — any claim that a specific main-side pin is inferior for a specific path: the disposition
  rests on the LANGUAGE-level suite result, and a per-path judgement would need a per-path run. No file was
  written in this batch, because the ruling keeps what the tree already holds.

---

## ADDENDUM — BASIS CORRECTION AND AN IDENTIFIER PROBE (2026-10-13, hcl-lane)

**THE BASIS CHANGED MEANING SILENTLY, SO IT IS RECORDED HERE RATHER THAN LEFT IN A MESSAGE.**
`origin/main` was pushed to a merge commit whose **tree is ours**, so `git diff HEAD origin/main` no longer
shows main's side of anything. The real basis is **`1b71d837c`** (the original `origin/main`, still
reachable as parent 1 of the merge).

    git diff --name-only HEAD origin/main    ->     8 paths   <- ARTIFACT: origin/main now holds OUR tree
    git diff --name-only HEAD 1b71d837c      -> 2,449 paths   <- THE REAL REMAINDER

**THIS BATCH'S NUMBERS WERE TAKEN BEFORE THE MERGE, i.e. ON THE CORRECT BASIS**, which is why they agree
with the Lead's lease run (1,157 differing fixture paths here against 897 add-only/256 both-sides there,
four paths apart). **But the population label must travel with the revision**: re-measured today against
`1b71d837c`, the two areas this batch covered (`validation/m14/results` + `validation/m14/fixtures`) show
**1,212 paths**, because HEAD has moved on since — the disposition below is about the population **as it
stood at the revision it names**, not about today's.

**IDENTIFIER PROBE — because after a rewrite `git log` will not show a lane's commits, and a rewrite that
dropped work looks exactly like one that did not.** Probed by NAME in HEAD (`53fa6c669`):

* `validation/m14/results/SUPERSEDED-MANIFEST.md` — **PRESENT**
* `validation/m14/UNION-FIXTURES-DISPOSITION.md` — **PRESENT**
* `*.superseded-*.json` under `validation/m14/results/` — **18 files present in HEAD's tree**
* commit subjects `results batch`, `SUPERSEDED-MANIFEST`, `fixtures disposition` — **each reachable from
  HEAD's history (1 commit each)**

**So this lane's union work survived the rewrite**: the artifacts are in the tree and the commits are in
HEAD's history, verified by probing for the identifiers rather than by remembering the log.
