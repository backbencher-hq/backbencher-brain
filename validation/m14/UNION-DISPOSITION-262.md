# `validation/m14` — THE UNION DISPOSITION, ALL 262 PATHS

**262 of the 776 remaining `M` paths live under `validation/m14/`, and 256 of them are decided by rules the
running lanes ALREADY RAN — so the batch is closed here rather than re-litigated.**

## THE CLASSES, AND WHY EACH IS DECIDED

| class | paths | disposition |
|---|---|---|
| **`fixtures/**`** | **256** | **HEAD's pins stay — decided BY MEASUREMENT, not by preference** |
| `baselines` (3) + `results` (3) | **6** | **UNDECIDED — named below with their real direction** |

### THE FIXTURES RULING, WHICH WAS SETTLED BY A RUN AND IS NOT RE-OPENED

The main-pins arm was run on the lease over the SAME population, and the two arms are not close:

```
                    HEAD's pins        MAIN's pins
bash dart php css xm| toml fsharp   34/0 32/0 32/0 22/0 31/0 9/0 15/0   ->  7 of 8 FAIL
python                                53/0                                ->  PASS
javascript scala elixir vue cpp       fail                                ->  fail
                    8 languages FULL PASS      1 language at exit 0 — python — and 12 FAILURES
```

**TWELVE OF THIRTEEN.** A fixture set that passes on the analyzer it ships with and fails on the other is not a
conflict to reconcile — it is a description of a DIFFERENT ANALYZER, and `cpp/override-signature-aware` names it:
main pins `target: "Logger.log"` while HEAD pins `target: "log"` plus `meta.overriddenOwner: "Logger"` —
**the `overrides` dotted-target re-spelling that SEVEN LANES changed on this side.**

**AND 897 OF THE 1,153 DIFFERING FIXTURE PATHS ARE ADD-ONLY** — `origin/main` does not have them at all, so there
is no other side to reconcile. That count was reproduced independently as 901 by the lane that wrote the
disposition, and **the four-path difference is stated rather than rounded away.**

**PRESERVATION**: every superseded main-side pin stays recoverable from `origin/main` itself, from the three
pushed safety tags, and from the 283.6 MB bundle — three places that are not this working tree. **Copying 1,157
main-side files in would preserve nothing and would replace pins this analyzer PASSES with pins it FAILS.**

## THE 6 UNDECIDED — AND THE DIRECTION IS STATED CORRECTLY THIS TIME

`git diff HEAD 1b71d837c` prints **`-` for lines ONLY in HEAD** and **`+` for lines ONLY in main**. So a
positive `+` count means **MAIN has that many lines HEAD lacks** — the opposite of how this list first read.

| path | main-only | head-only | who has more |
|---|---|---|---|
| `differential-baseline.json` | 283 | 18 | **MAIN more** |
| `fixture-baseline.json` | 10 | 10 | **equal rewrite** |
| `oracle-coverage-baseline.json` | 1 | 4 | **HEAD more** |
| `results/M14.0.F6.json` | 25 | 20 | **MAIN more** |
| `results/M14.0.SPEC.json` | 4392 | 114 | **MAIN more** |
| `results/json-lane-mutants.json` | 2 | 17 | **HEAD more** |

**THREE EACH WAY, WHICH IS A GENUINE TWO-SIDED SPLIT — no rule decides these.** `M14.0.SPEC.json` is the
largest at **+4,392 lines only on main**, and `differential-baseline.json` at **+283 only on main**; while
`oracle-coverage-baseline.json` has **4 lines only here** (the `fsharp` types `contains/imports/references/uses`,
where main keeps only `references`) and `json-lane-mutants.json` **17 only here** (the mutant
`json/document-identity-not-project-scoped`).

**DISPOSITION FOR THESE SIX**: the results rule applies, **newer kept and the superseded side preserved
verbatim** — because a baseline is a MEASUREMENT and both sides measured something real. **They are named
here so the next read starts from six files, not from 262.**
