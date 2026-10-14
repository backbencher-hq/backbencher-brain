# THE COMPACT — mission, state, and what is actually blocking

Written 2026-10-14. Supersedes nothing; it is the short version of everything.
**Read this first, then `WHERE-THIS-STANDS.md`, then `validation/m14/verification/STATUS-AFTER-HANDOFF.md`.**

---

## 1 · THE MISSION

Build a static analyzer fleet where **every edge an analyzer emits resolves to exactly one real
declaration — or carries a claim the project itself verifies** — across **every lane, every
relationship type, incoming and outgoing both.**

## 2 · THE SCOPE — AND IT WAS WRONG UNTIL TONIGHT

```
THE FLEET = src/ast/real-*-analyzer.ts = 48 LANES   (counted, not assumed)
RELATIONSHIP TYPES = calls · uses · imports · references · extends · implements ·
                     instantiates · overrides · contains · exports
DIRECTIONS = 2 — TABLE 1 (per-project scope) and TABLE 2 (pooled key space).
             THEY ARE DIFFERENT QUESTIONS AND MUST NEVER BE BLENDED.
```

**Every fleet figure in this record predates the scope correction.** "23 lanes × 10 types × 2
directions", "54.5% over 20 lanes", the direction matrix's 460 cells — **all are 23-of-48 or
20-of-48 subsets that did not say so.** The 23 came from `LANES_B`, a split of the fleet across
two laptops. **That split is retired. The scoping was arbitrary and is now 48.**

## 3 · WHAT IS DONE

```
20 LANES MEASURED WHOLE-POPULATION AT HEAD, partition closing exactly:
  OUT  edges 5,012,590 · resolved 2,733,647 (54.5%) · residual 1,943,503 (38.8%)
       = amb(decl) 1,153,252 + unresolved 765,803 + bindFAIL 24,448
       partition: 2,733,647+1,153,252+765,803+96,405+119,407+119,628+24,448 = 5,012,590 ✓
  IN   (TABLE 2, pooled) resolved 2,589,334 (51.7%) · residual 2,068,203 (41.3%)

EXCLUDING ACCOUNTING ARTIFACTS (bound-and-intended picks + same-file determinate collisions):
  58.0% resolved (tight) … 60.6% (generous)     residual 32.8–35.3%
  BOTH FIGURES ARE TRUE AND ANSWER DIFFERENT QUESTIONS. Never quote one as the other.

TWO LANES EFFECTIVELY COMPLETE: css 0.1% residual · toml 0.0%
NEAR-COMPLETE: protobuf 2.0% · markdown 3.6% · scss 4.2% · xml 4.4%

SIX ANALYZER ADOPTIONS, extFAIL 0 at every step, not one pin bent:
  namespace claims  — hcl · protobuf · zig · powershell   (~12,753 edges redeemed)
  source-path claims — toml · protobuf                    (581 verified, 0 refuted)
EIGHT MEASURED REFUSALS: julia · fsharp · bash · lua · r · yaml · nim-vacuous · dart
A FIVE-STEP APPLICABILITY PROCEDURE (each step added because a case got through without it):
  full population → ROOT IDENTITY → declared-share → PROPERTY 1 BEFORE RISK → risk, then wire
FOUR INSTRUMENTS REPAIRED FROM SILENT TO HONEST:
  fixture gate (dead for 48 languages) · residual gate (green zero over 13 unread lanes;
  `?? lang` fallback; NaN% guard) · stderr forwarding · the ambiguity aggregator's
  structurally-zero `sameFileOffLine` column
ONE CLAUSE-4 DEFECT DIAGNOSED AND FIXED: fsharp bindFAIL 24,448 = ONE SPELLING BUG
  (a literal `#` where BINDING_SEP = "\u0000" belongs). Fixtures 15 pass / 0 fail.
```

## 4 · WHAT IS NOT DONE

```
LANES FINISHED (all four clauses):  0 OF 23 · and the fleet is 48
JAVA extFAIL 83:                    mechanism read off the code, CENSUS OWED
fsharp AFTER MEASUREMENT:           THREE ATTEMPTS, THREE DEATHS (0-byte files, no result line)
                                    -> the spelling fix is fixture-verified but NOT fleet-verified
fsharp ORACLE:                      script/m14/fsharp-truth-oracle.ts:773 STILL carries the same
                                    wrong spelling -> differential is blind to all 24,448
BARE-NAME CLASS:                    measured, NOT ruled. ~99% of the cross-file half.
CLAUSES 2-3:                        unestablished for most lanes
FOUR LANES NOT MEASURED INCOMING:   yaml · dart · json (OOM) · javascript
                                    holding ~5.19M edges — MORE THAN THE 20 MEASURED
```

## 5 · THE WALL — WHY 100% IS NOT ACHIEVABLE AS STATED

```
REAL GAP ≈ 33–35% of all emitted edges. It does NOT shrink with better accounting.

  ambiguous class   275,143 = bare single-segment 273,259 (99.32%) + dotted 1,852 + path 32
  declaration-less  211,847 = bare 180,463 (85.2%) + dotted 26,861 + path 4,523

  => at most 1,884 edges of the ambiguous class are non-bare.

THE MISSING INPUT: import/scope information at the call site for unqualified names.
  A name that resolves to nothing and a name that resolves to the wrong file are
  INDISTINGUISHABLE FROM THE EDGE ALONE. This is the information-theoretic limit of static
  resolution without a type/import model. No further week, month, or year changes it.

WHAT WOULD MOVE IT: a signal the corpus does not contain. Its honest entry is `nothing known`.
REJECTED ALTERNATIVES, each priced by measurement: faking a predicate (yaml 184->833 ·
  protobuf reverted over 37 refutations · toml refused at RISK 100%/REDEEM 0 · hcl refused for
  29 false externalities) · a proximity rule (a measured FLOOR, 1.3–76.3% lane-dependent).
```

## 6 · THE TWO BARS — THE DECISION NOBODY HAS MADE

```
BAR A — "RESOLVED, NOT RULED"  (the bar as written, deliberately set high)
  => UNREACHABLE. Resolution is impossible for a third of the edges.

BAR B — clause 3's own language: "each cause fixed over the SAME population, OR RULED WITH
        A RUN FALSIFIER"
  => REACHABLE, and bounded:
     1. fix every clause-4 defect (24,531 known: fsharp 24,448 + java 83)
     2. rule the bare-name class per lane with a falsifier — e.g. "no declaration with this
        name exists anywhere in this project, demonstrated by a run enumerating every
        declaration and showing zero matches"
     3. state the result at BOTH bars
  => THAT IS THE SHORTEST PATH TO "DONE" AND IT IS INSIDE THE PROJECT'S OWN SPEC.

THE ACTUAL FAILURE OF THIS PROJECT, STATED PLAINLY: the bar was set at BAR A, resolution is
impossible for a third of the edges, and THE BAR WAS NEVER RENEGOTIATED when the measurement
showed it. That — not the wall — is why nothing is "done".
```

## 7 · THE SEVEN INSTRUMENT DEFECTS — THE EXPENSIVE KNOWLEDGE

Every one was a confident number over something the instrument could not read. **They are why
two years went into re-deriving instead of building. Do not repeat them.**

```
1  fixture gate       silently dead for 48 languages; read green
2  residual gate      printed an all-zero table at exit 0 for 13 lanes outside its extension map
                      (`[lang] ?? lang` used the LANE NAME as a file extension)
3  NaN% guard         divided by zero when edges === 0; printed NaN beside exit 0
4  discarded stderr   stdio ["ignore","pipe","ignore"] -> a gate-read lane could not report a
                      force-abort; fixed by "inherit" (the first fix was a NO-OP: the commit
                      message said "inherit" while the code said "pipe" — caught by PRINTING
                      THE LINE, not by any test)
5  board log          stale for 14 of 19 lanes; defaults to a 120-file stride and cannot
                      disclose its own population
6  sameFileOffLine    STRUCTURALLY ZERO — the aggregator matched a string the classifier
                      cannot emit. "0 in five of five" was one broken comparison printing zero
                      five times, quoted for weeks as a robust fleet shape.
7  worker boundary    parseFile runs in a worker; a hard per-file timeout KILLS it, so the
                      analyzer's logger never runs and markers are NEVER EMITTED. Blast radius
                      is the worker boundary, not aborts alone.
8  two-sides-sharing  fsharp's analyzer AND its oracle both spelled bindings `#`; the
                      differential could never flag it; only the arbiter used the real constant.
```

**THE STANDING RULES THAT CAME OUT OF THESE — non-negotiable:**
1. **Print the population before the claim.**
2. **A NOT-MEASURED cell must never look like a clean cell. `0/0/0` means what the instrument
   can see, nothing more.**
3. **Read claims off the CODE, not off a commit message or an edit's exit status.**
4. **`> file`, never `| tail`. Check for a RESULT LINE, not for bytes.** A cut run contributes
   NOTHING — not a zero, not a partial.
5. **An incomplete run's number is a LOWER BOUND, not a disagreement.**
6. **Never let silence — an empty grep included — become a result.**

## 8 · THE FIVE OUTCOMES (every screen lands in exactly one)

```
a result  ·  NOT RUN  ·  RAN-BUT-UNUSABLE  ·  RAN-FAITHFULLY-ON-DEFECTIVE-DATA  ·
a control that exonerates an instrument
```

## 9 · WHERE TO LOOK

| file | what it holds |
|---|---|
| `WHERE-THIS-STANDS.md` | the front door |
| `validation/m14/verification/REAL-GAP-VS-ACCOUNTING.md` | the 54.5 vs 58.0–60.6 decomposition and the bare-name bound |
| `validation/m14/verification/FLEET-48.md` | **the 48-lane enumeration (task-101)** |
| `validation/m14/verification/FLEET48-SLICE-{1,2,3,4}.md` | **the clause-4 sweep (task-102)** — which zeros are real |
| `validation/m14/verification/DIRECTION-MATRIX.md` | 23×10×2, and what is unmeasured |
| `validation/m14/verification/INCOMING-FLEET.md` | per-type matrices, both directions |
| `validation/m14/verification/RESOLUTION-TARGETS.md` | residual ranked by absolute loss, with the KIND |
| `validation/m14/verification/FORCE-ABORT-FOOTPRINT.md` | the worker-kill class and the per-lane hole table |
| `validation/m14/verification/AMBIGUITY-AGGREGATOR-DEFECT.md` | defect 6, with lines |
| `validation/m14/verification/CLAUSE-4-DEFECTS.md` | fsharp's spelling bug; java's 83 |
| `validation/m14/verification/STATUS-AFTER-HANDOFF.md` | the running record |

**THE NEGATIVES ARE THE EXPENSIVE PART.** The eight refusals, the eight instrument defects, the
`nothing known` entries — each cost measurement to establish and each prevents a repeat.

---

## 10 · WHAT "100% BOTH DIRECTIONS" WOULD ACTUALLY TAKE

**Not effort. A different input.** Either:
- **import/scope information at the call site** for unqualified names (not in the corpus), or
- **a type model** the analyzers do not have, or
- **accepting BAR B** — fix the defects, rule the bare-name class with falsifiers, and report
  completion at the bar the project itself wrote into clause 3.

**Everything else in the fleet IS finishable**, and the work that remains is enumerated above
with its size. **The wall is one class, measured, named, and bounded at ~33–35% of edges.**
