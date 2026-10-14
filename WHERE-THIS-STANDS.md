# WHERE THIS STANDS

Written 2026-10-14 at commit `e2b425272`, after a session that measured the fleet end to end
and found that several of the instruments the project had been steering by could not report
what they claimed to report. This file is the front door. It is deliberately short.

---

## 1 · WHAT IT IS

A static analysis fleet: ~48 language lanes, each an analyzer that emits edges
(`calls` · `uses` · `imports` · `references` · `extends` · `implements` · `instantiates` ·
`overrides` · `contains` · `exports`), plus the gates and arbiters that decide whether an
emitted edge is real.

The core question the whole programme exists to answer:

> **For every edge this analyzer emits, does it resolve to exactly one real declaration —
> or carry a claim the project itself verifies?**

## 2 · WHAT IT ACHIEVES

Whole-population measurement at HEAD, **20 lanes**, partition closing exactly
(every edge in a printed bucket):

```
OUTGOING (TABLE 1, per-project scope)
  edges      5,012,590
  resolved   2,733,647   54.5%
  residual   1,943,503   38.8%
            = amb(decl) 1,153,252 + unresolved 765,803 + bindFAIL 24,448
  partition 2,733,647 + 1,153,252 + 765,803 + 96,405 extOK + 119,407 ext? + 119,628 bindOK + 24,448 = 5,012,590  ✓

INCOMING (TABLE 2, pooled key space — a DIFFERENT question, never blended)
  edges      5,012,590
  resolved   2,589,334   51.7%
  residual   2,068,203   41.3%
```

**Excluding accounting artifacts that are *not* defects**
(`bound-and-intended` picks the resolver settles, plus same-file-`determinate` collisions
the count model over-reports):

```
  58.0% resolved (tight)  …  60.6% resolved (generous)
  residual 35.3%          …  32.8%
```

**Both figures are true and they answer different questions.** 54.5% is what the instruments
print. 58.0–60.6% is what the resolver actually failed to do. Do not quote one as the other.

**Two languages are effectively complete:** css residual **0.1%**, toml **0.0%**.
**Four more are near-complete:** protobuf 2.0% · markdown 3.6% · scss 4.2% · xml 4.4%.

## 3 · WHAT WAS BUILT AND WORKS

- **Six analyzer adoptions, `extFAIL` 0 at every step, not one pin bent:**
  namespace claims in `hcl` · `protobuf` · `zig` · `powershell`
  (~12,753 edges redeemed); source-path claims in `toml` · `protobuf`
  (581 edges verified, 0 refuted).
- **Eight refusals**, each on measurement, each of which moved the applicability procedure
  forward (julia · fsharp · bash · lua · r · yaml · nim-vacuous · dart).
- **A five-step applicability procedure**, every step added because a case got through
  without it: full population → root identity → declared-share → **property 1 before risk** →
  risk, then wire.
- **A fixture regression gate that now fires in both directions** (it had been silently dead
  for 48 languages): planted regression → `FIXTURE REGRESSION vue: 0 -> 3`, exit 4.
- **A residual gate that means what it says for all 48 lanes** — its lane→extension map now
  derives from the single source of truth, its `NaN%` guard exits 2 instead of printing a
  green zero, and its runner's stderr is forwarded so a corpus defeat cannot hide.

## 4 · WHERE IT STOPS, AND EXACTLY WHY

**The bar is "RESOLVED, NOT RULED"** — deliberately set high to stop the project declaring
victory by explaining problems away. Under that bar **no lane is finished, and none can be.**

```
~33-35% of all emitted edges are a REAL gap that does not shrink with better accounting.

  ambiguous class       275,143 = bare single-segment 273,259 (99.32%) + dotted 1,852 + path 32
  declaration-less      211,847 = bare 180,463 (85.2%) + dotted 26,861 + path 4,523

THE WALL: unqualified names. A name that resolves to nothing and a name that resolves to
the wrong file are INDISTINGUISHABLE FROM THE EDGE ALONE.
The missing input is import/scope information at the call site — which the corpus does not contain.
```

**This is not a bug and not a failure of effort. It is the information-theoretic limit of
static name resolution without a type/import model.** No further week, month, or year
changes it under the current approach.

**THE ACTUAL FAILURE, STATED PLAINLY:** the bar was set at RESOLVED, resolution is impossible
for a third of the edges, and **the bar was never renegotiated when the measurement showed
that.** That — not the wall — is why nothing is "done."

**Two further defects remain unfixed, and these ARE fixable — they are bugs, not limits:**

```
fsharp   bindFAIL 24,448   the analyzer claims a binding the project's own facts REFUTE (all on `calls`)
java     extFAIL      83   the analyzer claims a target is external and it isn't
causeFAIL                  0 in every lane read
```

**24,531 edges of provably-wrong output. Not fixed. This is unfinished work, and it is bounded.**

## 5 · WHAT WOULD FINISH IT

Clause 3 of the bar already contains a reachable version — *"each cause fixed over the SAME
population, **or ruled with a RUN FALSIFIER**"*. Under that reading, completion is:

1. **Fix the two clause-4 defects** (24,531 edges). Bounded, mechanical, and it is the only
   provably-wrong output in the fleet.
2. **Rule the bare-name class per lane with a run falsifier** — e.g. *"no declaration with
   this name exists anywhere in this project, demonstrated by a run that enumerates every
   declaration and shows zero matches."*
3. **State the result at both bars:** resolution as counted, and completion by ruling.

**That is classification and verification work — weeks, not years.** It is the shortest path
to "done" that exists, and it is inside the project's own specification.

## 6 · WHAT THE RECORD IS FOR

Every number in `validation/m14/verification/**` (260 documents) carries the instrument, the
population and the bound that produced it. The most useful entry points:

| file | what it holds |
|---|---|
| `DIRECTION-MATRIX.md` | 23 lanes × 10 types × 2 directions; what is measured, what is not |
| `INCOMING-FLEET.md` | the per-type matrices, both directions, 20 lanes |
| `RESOLUTION-TARGETS.md` | residual ranked by absolute loss, with the kind of each gap |
| `REAL-GAP-VS-ACCOUNTING.md` | the 54.5% vs 58.0–60.6% decomposition, and the bare-name bound |
| `FORCE-ABORT-FOOTPRINT.md` | the worker-kill deflation class and the per-lane hole table |
| `AMBIGUITY-AGGREGATOR-DEFECT.md` | the `sameFileOffLine` column that was structurally zero |
| `STATUS-AFTER-HANDOFF.md` | the running record, oldest to newest |

**Read the negatives as carefully as the positives.** They are the expensive part:
the eight refusals, the seven instrument defects, the `nothing known` entries — each one cost
measurement to establish and each one prevents someone repeating it.

---

**Measurements in this file are whole-population at `e2b425272` unless labelled otherwise.
Four lanes are NOT MEASURED in the incoming direction (yaml · dart · json · javascript),
holding roughly 5.19M edges between them — the single largest caveat on any fleet figure here.**
