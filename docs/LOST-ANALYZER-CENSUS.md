# Lost-analyzer census — was C++ unique?

Measured 2026-10-10. HEAD moved three times during the session (`40f9c1c5d` →
`ccccd5aea` → `e462a3797`); every number below names the state it was read from.

The C++ repair raised a question it could not answer by itself. That lane's document,
47 fixture suites and nine lab scripts were on `main` while the analyzer they describe
was on a branch, six fixtures failed at HEAD, and `validation/m14/fixture-baseline.json`
had absorbed the failing state as `cpp: 6`. Two questions followed:

1. **How many other lanes have the same shape?**
2. **What makes that shape unable to land again?**

## 1. The population

- 48 lanes exist (`script/m14/run-fixtures.ts` → `LANGS`, `src/ast/real-*-analyzer.ts`).
- **All 48** have commits touching their analyzer that HEAD does not contain — 3 (`hcl`)
  to 60 (`python`), 1,100+ commits in total. The `analyzer/*` fleet is unmerged work by
  construction; "does a branch differ?" is therefore not a discriminator (it returned
  8,946 branch×lane pairs).
- Fixture state of the `ccccd5aea` working tree: **134 failing fixtures across 22 lanes**
  (`cpp` 0 after the repair; it was **41 pass / 6 fail** in the committed state, failing
  `contains-name-line-921`, `exports-marker-910`, `pure-virtual-abstract-919`,
  `pure-virtual-signature-910`, `specifier-qualified-name-962`, `unnamed-scope-919`).
- The two structural screens that were tried first — "HEAD's fixtures are byte-identical
  to the branch's", "HEAD's doc is byte-identical to the branch's" — both misfire and were
  discarded. They flag 121 and 14 branch×lane pairs respectively, and *neither catches the
  one known true positive* (`analyzer/CPP`: only 74% of HEAD's cpp fixture files are
  byte-identical there, because HEAD's corpus is a third line). The question is
  functional, not structural.

## 2. The probe: is the work parked on a branch, or did it never land?

`script/m14/lane-analyzer-probe.mjs` uses the real harness in one process:

```
base  = runLang(lane)              -> this tree's analyzer, runner and fixtures
probe = runLang(lane, BranchCtor)  -> the same runner and fixtures, the branch's analyzer
```

The candidate ref per lane is the one holding the lane's **newest unmerged analyzer
commit** (the most favourable ref by date). Each branch analyzer was materialised in a
`git worktree` of that ref.

| lane | HEAD (pass/fail) | candidate ref's analyzer | fixed | broken |
|---|---|---|---|---|
| cpp (calibration) | 51/0 | `analyzer/DERIV_EXPORTS_CPP3` | 0 | **23** |
| cpp (calibration) | 51/0 | `analyzer/CPP` | 0 | **14** |
| c | 42/4 | `analyzer/C_FIX3` | 0 | 0 |
| csharp | 20/4 | `analyzer/CSHARP_MEASURE` | 0 | 4 |
| elixir | 67/15 | `analyzer/ELIXIR_FIX3` | 0 | 2 |
| groovy | 61/20 | `analyzer/DERIV_EXPORTS_GROOVY3` | **1** | 3 |
| objc | 11/5 | `analyzer/DERIV_EXPORTS_OBJC3` | 0 | 2 |
| perl | 14/8 | `analyzer/PERL_MEASURE` | 0 | 1 |
| python | 25/10 | `analyzer/PYTHON_MEASURE` | 0 | 6 |
| ruby | 10/1 | `analyzer/RUBY` | 0 | 0 |

**One fixture recovered across nine failing lanes** (`groovy/imports-dependency-edge`),
against **18 broken** in the same runs. The failing fixtures on HEAD are not parked
analyzer work: the branches are *older lines*, not newer ones. A lane's failures were
authored against behavior that no ref in this repository contains.

The cpp calibrations say something stronger about repairs: **neither parent passes.**
`analyzer/CPP` alone reads 37/14 against HEAD's fixtures and the older
`DERIV_EXPORTS_CPP3` line reads 28/23, while the merged analyzer reads 51/0. The repair
that worked was a three-way merge with 15 conflicts resolved rule-by-rule — so
"cherry-pick the lane branch" is *not* a valid recovery strategy for this defect class,
and a post-hoc sweep cannot be the safety net. The gate has to stand at merge time.

## 3. The gate

`script/m14/verify-fixture-provenance.ts` — wired as `audit:fixture-provenance` and into
`npm run verify` immediately after `audit:fixtures`.

**Rule: a fixture file that is new or modified relative to the base ref must PASS in the
commit that carries it.** Fixtures already in the base ref keep whatever allowance the
baseline declares for them, so the failures that are already committed (134 in the live
working tree, and a smaller declared count in `fixture-baseline.json` — the two disagree
on vue, svelte and html in this shared checkout) are not re-litigated here. The one exception is
declared, never silent: an expectation may carry
`"expectedToFail": "<why this fixture is ahead of the code>"` and is then reported as
declared rather than blocking — the same shape as
`verify-script-typecheck-baseline.ts`'s `--allow-increase <reason>`.

Verified:

| check | result |
|---|---|
| `--selftest` (5 decision cases incl. the declared exception) | **5/5** |
| run on the live tree (base `e462a3797`) | **exit 0** — 24 changed fixture files in cpp+javascript, all pass |
| end-to-end negative test (scratch failing fixture, removed in the same command) | **exit 1**, names both files; **exit 0** after removal; 0 files left |
| historical replay `--base 1719ff6b3^` at `1719ff6b3` | **exit 1** — 477 changed fixture files in 24 lanes, **208 violations**, cpp `41/6` with the same six names |
| `bun run audit:script-typecheck` | 0 errors (the ratchet's declared state is 0) |
| `npx tsx script/m61/verify-orphan-gates.ts` | runs; the new gate is inside the 420 **wired** (its own verdict is KNOWN-GAP on 53 pre-existing undeclared orphans, none of them this file) |

`1719ff6b3` ("put the lane pin corpus on main, and pick each lane's analyzer revision by
measuring it", 2026-10-07) is the commit that landed the corpus whose six cpp failures
this session repaired: 477 fixture files across 24 lanes, and `real-cpp-analyzer.ts` was
not among the files it touched. `4cf800a17` is the other half — a single-parent squash
that carried 25 lane documents and 23 analyzers, and **no cpp fixture at all**. The gate
blocks the corpus-landing commit and therefore the loss.

## 4. Limitations, stated rather than rounded

- **13 of the 22 failing lanes were not probed**: go, html, java, kotlin, lua, make,
  scala, scss, svelte, swift, typescript, vb, vue. An intermediate batch selected their
  candidate refs with a date lookup that accidentally ran over `--all`, which made every
  ref look equally recent; those worktrees were discarded rather than reported. The
  instrument is checked in, so the remaining lanes are one command each.
- **One ref per lane.** `python` alone has 60 unmerged analyzer commits across several
  refs; the probe tests the ref holding the newest one, not the union. A lane whose fix
  sits on a second-oldest ref would read here as "not recovered".
- The branch analyzer imports **its own tree's** `./engine` and helpers, so two engines
  are live in the probe process. The reading is evidence about the analyzer, not about
  the branch's full pipeline.
- The replay's 208 violations are what the gate *would* have said at that commit. It is
  not a claim that the milestone's corpus convention was careless — it is a claim that
  the convention records the failure count and not which fixtures are ahead of the code,
  and the cpp document then read as if the code had landed.
- A worktree was left at `/tmp/bbwt/replay-1719ff6b3` for the replay
  (`git worktree remove --force /tmp/bbwt/replay-1719ff6b3` removes it); the other five
  created for this census were removed.
