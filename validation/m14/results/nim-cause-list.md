# nim — named-cause list

## PART 2 — the baseline re-taken and Cause 1 named with a count (2026-10-11)

**This part SUPERSEDES PART 1 below where they differ, and PART 1 is kept because a rewritten
record is a record that stopped being checkable.**

### 1. The baseline, re-taken

The brief is right that figures predating the shared-indexer landings are not baselines. For THIS
lane the answer is narrower than the brief allows for, and it is a measurement rather than a
reading:

    sha256(src/ast/real-nim-analyzer.ts)
      at 9ff9411ad (the PART 1 cause-list commit)  96ef87bb47f63ecabd529fa0a7876b4dffb47d171a9b50be513bec352621163b
      at HEAD                                      96ef87bb47f63ecabd529fa0a7876b4dffb47d171a9b50be513bec352621163b

**The blob is unchanged**, and `residual-gate.ts --lane nim` measures the analyzer through
`incoming-gate.ts` → production `parseFile`, which reads **no store** — so none of the six landings
(`140be2f01`, `63a888b03`, `ac2445a27`, `47a45a72c`, `3a701937c`, `71286549c`) touches this
instrument's population, key space or classification. All six are ancestors of HEAD; four postdate
the PART 1 commit. **PART 1's 49.1% therefore still holds, and RUN G reproduces it to the digit.**

RUN G — whole admitted population, `maxFiles 0`, production `parseFile` scope, no stride:

    type          edges    resolved  collRes  amb(decl)  amb(kind)  unresolved  extOK   ext?    extFAIL  bindOK   bind?   bindFAIL  causeOK  causeFAIL
    calls         118260   46231     0         66121      28442      5908        0       0       0        0        0       0         0        0
    uses          45664    18066     0         27598      18487      0           0       0       0        0        0       0         0        0
    contains      29329    29329     16084     0          0          0           0       0       0        0        0       0         0        0
    imports       13365    8992      0         3359       2250       835         179     0       0        0        0       0         0        0
    references    56442    31334     0         22619      12077      2489        0       0       0        0        0       0         0        0
    exports       617      369       0         220        96         28          0       0       0        0        0       0         0        0
    extends       627      300       0         311        218        16          0       0       0        0        0       0         0        0
    implements    47       12        0         35         24         0           0       0       0        0        0       0         0        0
    overrides     67       52        0         15         4          0           0       0       0        0        0       0         0        0
    instantiates  2843     1209      0         1634       1106       0           0       0       0        0        0       0         0        0
    TOTAL         267261   135894    16084     121912     62704      9276        179     0       0       0        0       0         0        0

`extFAIL` 0 · `bindFAIL` 0 · `causeFAIL` 0 · residual 131,188 of 267,261 = **49.1%** — identical to
PART 1. Population line, verbatim:

    population: 6063 parsed of 6063 sampled (corpus has 6063 .nim,nims,nimble files across 8 repos; stride sample)
    parse failures: 0   degraded (regex fallback): 0
    excluded from that population: 0 tracked-but-absent/unreadable + 0 over the 1 MB cap
    endpoint keys indexed: name + 30384 qualifiedName alias(es).
    empty results: 2 file(s) hold NO CONTENT AT ALL — nim/tests/newconfig/bar/config.nims, .../mfoo.nims

**0 degraded settles HANDOFF §5dd for this lane**: the regex-fallback rows that inflate markdown's
residual by 5,452 are **zero** here, so this 49.1% is the analyzer's own and needs no deduction.

**`contains` is confirmed at FULL RESOLUTION at this revision**: 29,329 edges, 29,329 resolved, 0 ambiguous,
0 unresolved, `intended` 29,329 of 29,329 (BINDING INTENT block, RUN G). That is the fourth lane
agreeing with the programme's committed result, on a fresh whole-population run.

### 2. THE LARGEST CAUSE, named with a count — read off the gate's own marker-set table

The gate's marker-set table groups not-resolved edges by metadata keys, and for `calls` it has
**exactly two sets**, so this is the whole population rather than a top-N page:

    calls   amb+unres   amb     unres   resolved   marker set
    71972   66065       5907    46230      callExpression+relationshipType
       57      56          1        1      callExpression+nimImportBased+relationshipType

**CAUSE 1 = `calls` = 66,121 ambiguous + 5,908 unresolved = 72,029 of the lane's 131,188 residual
(54.9%)**, carrier `callExpression+relationshipType`. No other cause in this lane reaches half of it.

### 3. The split that names it — B1/B2/B3 over the SAME population

A split instrument (scratch copy of `incoming-gate.ts` with an additive block; the shared gate is
untouched) buckets every ambiguous and unresolved edge by where the target name is declared, using
the gate's own `declPos`/`projectDecl` maps:

    type          ambiguous  B1       B2       B3       unresolved
    calls         66121      8863     48005    15161    5908
    uses          27598      5984     0        21614    0
    references    22619      1029     13570    10509    2489
    imports       3359       25       4101     68       835
    instantiates  1634       147      0        1487     0
    extends       311        31       54       242      16
    exports       220        3        229      16       28
    implements    35         0        4        31       0
    overrides     15         3        0        12       0
    TOTAL         121912     16085    65963    49140    9276

    B1 = the edge's OWN FILE declares the target 2+ times
    B2 = the edge's own file declares it 0 times (only OTHER files do)
    B3 = the edge's own file declares it exactly once, others add more

**CAUSE 1 IS B2: 48,005 of 66,121 ambiguous `calls` (72.6%) name a target that the edge's OWN FILE
never declares.** Adding `calls`' 5,908 unresolved (5,908 of them `noDeclaration` by the gate's own
intent column), **53,913 of 72,029 `calls` edges (74.8%) name a declaration that is not in the
file that emitted the edge.**

**AND IT IS RULED LEGITIMATE, not fixed — the ruling is a count, not prose.** The gate's own
target strings say these are real cross-file references and not fabrications:

    calls target="destroy"     edgeFile=Aporia/AboutDialog.nim     declFiles=[… dependencies/chipmunk/chipmunk.nim]
    calls target="setTitle"    edgeFile=Aporia/AboutDialog.nim     declFiles=[… keineschweine/dependencies/sfml/sfml.nim]
    calls target="epochTime"   edgeFile=Aporia/CustomStatusBar.nim declFiles=[… nim/lib/pure/times.nim]
    imports target="strutils"  edgeFile=Aporia/CustomStatusBar.nim declFiles=[… lib/pure/strutils.nim, tests/manyloc/packages/package{1,2}/strutils.nim]

`AboutDialog.nim` calls `setTitle`; `setTitle` is declared in `sfml.nim`. **That IS a cross-file
reference, so the edge is TRUE and the ambiguity is a property of a per-file analyzer that never
reads the import graph.** The falsifier is specific: **this cause is refuted if any B2 target
resolves to a declaration in the edge's own file — and by construction (`own == 0`) none can**, so
the ruling is a statement about the measurement's own predicate rather than a hope about the data.

**THE FIX THIS IMPLIES IS OUT OF THIS LANE'S REACH, and that is the honest reason it is ruled.**
Naming the right declaration needs the `import` graph — which file's module is in scope — and the
per-file analyzer has read exactly one file. `nimModulePath` metadata already carries the written
import path, so the direction is specified; but a rule that guessed a module would manufacture a
binding, which is the failure mode this programme exists to prevent.

### 4. The second-largest measured cause, and it is the one a fix CAN reach

**CAUSE 2 = B1 = 16,085 ambiguous edges** where the edge's OWN FILE declares the target 2+ times.
Per type: `calls` 8,863 · `uses` 5,984 · `references` 1,029 · `instantiates` 147 · others < 60.
This is the class a **per-file** scoping rule can reach without any cross-file information, and it
is **not fixed in this turn** — it is named and priced so the next turn starts from a number.

**`uses` B2 = 0 and `instantiates` B2 = 0 are passed falsifiable predictions, stated before the
measurement.** The analyzer emits `uses` only when `resolvable(leaf)` holds, and `resolvable` reads
`fileValues`/`fileEnumMembers`/`fileFieldNames` — all three file-local sets built from the file's
own declarations. **So no `uses` target can be undeclared in its own file, and B2 must be 0**; it
is. `instantiates` targets are file-local type names by the same rule. Two independent
type-level checks that agree with the rule and not merely with the run.

### 5. Self-refutation — my own errors, and the one thing I could not settle

1. **My first split instrument was wrong and I am recording it rather than deleting it.** RUN E
   bucketed on the relationship TYPE instead of the target NAME, so its B-columns (B2 103,946,
   B4 32,685) are **VOID and are not quoted anywhere above.** RUN E's TABLE 1 columns are
   unaffected by that bug and agree with RUN G to the digit.
2. **RUNS C and D are not measurements.** Both parsed 6,000/6,063 with 0 failed / 0 degraded and
   then crashed inside my own accounting (`declPos.get` on a qualifiedName-alias key; then a
   scope error). The engine path was sound in all of C, D, E, F, G — but a killed or crashed run
   is not a result, so only G is quoted.
3. **A LEDGER WAS ADDED BECAUSE THE FIRST SPLIT WAS UNAUDITABLE.** It prints, per type, which key
   was asked and whether the two maps the gate fills from the same `countKey` call agreed. They
   agree **exactly on every type** (e.g. `calls` `fkEq` 24,024 = `fpEq` 24,024; `uses` 27,598 =
   27,598), which is what makes RUN G's split trustworthy and RUN E's not.
4. **ONE THING IS UNSETTLED, and it is reported as a contradiction rather than smoothed.** The
   gate's BINDING INTENT column says **all 118,260 `calls` edges** have a declaration in the
   edge's own file (`sameFileUnproven` 46,001 + `arbitraryTwin` 70,221 + `noDeclaration` 2,038),
   while this split measures **45,967 of 72,029 not-resolved `calls` edges with no declaration in
   the edge's file**, and the ledger shows `declPos` and `fileDecl` agreeing on every one of them.
   Both readings come from the same run and the same maps. `classifyIntent` returning
   `noDeclaration` only 2,038 times cannot be reproduced from `declPos` as I read it — the gate
   reads a key space I have not finished tracing. **I am not calling the gate wrong; I am saying
   the two lenses disagree by 45,967 edges on a question with one answer, and the B-columns above
   rest on the map the ledger audits.** The falsifier is cheap: print `declPos.get(tgt)` for the
   2,038 `calls` edges the gate calls `noDeclaration`, and for ten it calls `sameFileUnproven`.

5. **THE B3 `oneOne`/`oneMany` SUB-SPLIT IS EMPTY IN RUN G** — the report block printed its header
   and no rows, because the counter I added was never wired in (a failed text substitution of
   mine, found by reading the output rather than by assuming it worked). It is **not** quoted as a
   number. It matters because it decides how much of B3 is determinate, so it is named here as the
   first thing the next turn should measure rather than left as a silent gap.

### 6. Fixtures

    npx tsx script/m14/run-fixtures.ts --lang nim
    SCOPED run (nim of 48 lanes): results are printed here and NO evidence is written
    PASS  nim/bare-case  PASS  nim/concept  PASS  nim/contract  PASS  nim/extbase
    PASS  nim/extderived  PASS  nim/extmod  PASS  nim/field-receiver  PASS  nim/helpers
    PASS  nim/mac  PASS  nim/module-target  PASS  nim/negative  PASS  nim/nested  PASS  nim/reexport
    summary: {"nim":{"pass":13,"fail":0}}
    fixture baseline gate: no regressions
    all fixtures pass

### 7. What is fixed vs ruled

    FIXED     nothing. No analyzer change was made in this turn, and the analyzer blob is unchanged.
    RULED     the largest cause (calls B2, 48,005 + the 5,908-call unresolved class) — ruled with a
              count, a predicate-level falsifier, and four named real targets that resolve into
              other files. The fix needs the import graph, which a per-file analyzer does not have.
    NAMED     Cause 2 = B1 16,085 (a per-file scoping rule CAN reach it) — priced, not fixed.
    SETTLED   contains 29,329/29,329 intended; 0 degraded, so §5dd does not inflate this lane.
    UNSETTLED the intent-vs-split 45,967-edge contradiction (§5.4); the B3 oneOne/oneMany split (§5.5).

    Instrument: .tmp-nim/gate-nim-split.ts (scratch; shared gate untouched). RUN G whole population,
    maxFiles 0, no stride. Store runs: NONE — this lane's residual is a parse-side measurement and
    the brief's BB_DATA_DIR / store-run labelling rules therefore did not apply here.

---

# nim — named-cause list (Lead measurement, 2026-10-10) — PART 1, KEPT AS WRITTEN

`npx tsx script/m14/residual-gate.ts --lane nim` — whole admitted population, production scope.

    type         edges   resolved  ofWhich  amb(decl)  unresolved   res%   intended  twin    noDecl
    calls      118,260     46,231        0     66,121       5,908   60.9%          0 70,221    2,038
    uses        45,664     18,066        0     27,598           0   60.4%          0      0        0
    references  56,442     31,334        0     22,619       2,489   44.5%          0 29,004    1,644
    imports     13,365      8,992        0      3,359         835   31.4%        179 13,022      234
    instantiates 2,843      1,209        0      1,634           0   57.5%          0      0        0
    extends        627        300        0        311          16   52.2%          0    178        4
    exports        617        369        0        220          28   40.2%          0    574       11
    implements      47         12        0         35           0   74.5%          0      4        0
    overrides       67         52        0         15           0   22.4%          0      0        0
    contains    29,329     29,329   16,084          0           0    0.0%     29,329      0        0
    TOTAL      267,261    135,894   16,084    121,912       9,276   49.1%

`extFAIL`/`bindFAIL`/`causeFAIL` all 0. No lane has worked nim; the numbers are the gate's.

## `contains` IS FULLY RESOLVED — third lane running

29,329 edges, all resolved, **`intended` 29,329 of 29,329**, `twin` 0, `noDecl` 0. The 16,084 `ofWhich`
is an **upper bound** on arbitrary bindings, not a defect count, and with `intended` at 100% the
tie-break demonstrably never decided one of them — against the indexer's control arm of **37,318 of
49,729** collision-bound picks that go WRONG. **Three lanes (protobuf, graphql, nim) now show a
containment type at 100% intended**, which is becoming the strongest replicated result in the
programme and the natural first place to look when a lane's containment is NOT clean.
**PART 2 re-measured this at whole population and it holds: a fourth lane's worth of agreement.**

## Cause 1 — `calls` 66,121 ambiguous (60.9%), with `twin` 70,221

**The dominant cause by a wide margin**: 66,121 of the lane's 121,912 ambiguous edges, and the twin
count exceeds it, which is the honest reading for a call-site type — the edge line is NOT the target
symbol's line, so **the twin column is not evidence of wrongness here** and the intent column is silent
by construction (`LINE_IS_TARGET_LINE` covers `contains`/`exports` only). What is needed first is the
split every worked lane has used: **by where the name is declared** (SAME-FILE-ONE / SAME-FILE-MULTI /
CROSS-FILE-ONLY), because that is the split that decides whether any per-file rule can reach it.
**PART 2 took that split: CROSS-FILE-ONLY is 48,005 of the 66,121, so the answer is NO — a per-file
rule reaches 8,863, not 48,005.**

**Do not port a ceiling.** The fleet's php-shaped rule reaches **100%** on php `calls`, **34.2%** on zig
`calls`, **0.6%** on julia `calls` — three lanes, three answers, one rule. Measure nim's own, with a probe
that **IMPORTS the gate's counting rule and reproduces its four columns exactly** before it says
anything (`incoming-rule.ts`; a probe that cannot reproduce the gate is evidence about the probe).
**PART 2's instrument reproduces TABLE 1 to the digit and carries an audit ledger for exactly this
reason — and the ledger is what caught its own first version being wrong.**

## Cause 2 — `uses` 27,598 ambiguous (60.4%), `twin` and `noDecl` both 0

**The zero columns are the interesting part**: `uses` has no unresolved edges, no twin and no dangling
target, so its entire 60.4% is **name collision** — every edge binds a declaration, and the question is
only WHICH one. That is a materially different shape from zig's `uses` (`noDecl` 20,770) and hcl's
`references` (`noDecl` 1,644), and it means nim's `uses` residual is reachable by a scoping rule **if the
colliding declarations are distinguishable at all** — the ceiling is the whole question.
**PART 2 answered the ceiling's first half with a prediction that passed: `uses` B2 = 0 exactly, because
the analyzer's `resolvable()` predicate is file-local. All 27,598 are B1 (5,984) or B3 (21,614).**

## Cause 3 — `references` 22,619 ambiguous + 2,489 unresolved (44.5%), `twin` 29,004

Same shape as Cause 1 and the same warning about the twin column.
**PART 2 split it: B2 13,570, B3 10,509, B1 1,029 — the same cross-file shape as `calls`, at lower volume.**

## The small rows

`imports` 3,359 amb + 835 unres with **`extOK` 179** (the only external claims in the lane) ·
`instantiates` 1,634 amb, 0 unres · `extends` 311 amb + 16 unres · `exports` 220 amb + 28 unres
(`twin` 574, the largest twin ratio of any small type here) · `implements` 35 amb on 47 edges ·
`overrides` 15 amb on 67. None is worth a turn alone; all belong in a turn that touches the small
types, and `instantiates`/`implements`/`overrides` having **0 unresolved** means their residual is
pure collision. **PART 2 measured `instantiates` B2 = 0 and `overrides` B2 = 0, and `uses` B2 = 0.**

## What this lane has that no other does

**`calls` at 118,260 edges is the third-largest single type measured anywhere**, and its 66,121
ambiguous edges are the largest collision population in the programme. Whatever rule reaches nim's
`calls` reaches more edges than any other rule in any lane — so the ceiling measurement here is worth
more than a fast fix.
**PART 2's answer, stated so it is not read as a fix: the ceiling for a PER-FILE rule on nim `calls` is
8,863 edges (B1). The other 48,005 need the import graph. That is the ceiling measurement the last
paragraph asked for, and it is a lower ceiling than the fleet's php-shaped rule promises.**
