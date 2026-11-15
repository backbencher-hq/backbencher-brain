# Laptop-B programme status — verified count and every lane's position

> **2026-10-12 END-OF-DAY ADDENDUM (Lead). THE TABLE BELOW IS STILL UNCHANGED: STILL 7 OF 23 VERIFIED.** *Today
> produced shared-machinery correctness, defect diagnoses, instruments and gates — **NOT lane closures.** Read the
> first addendum for the day's findings; this one is the state.*
>
> **LAPTOP A: 16 OF 23 MEASURED, ALL TOUGH, AND `LANES_A` NOW EXISTS** — *the list the other half never had; the gate
> could always measure these lanes, what was missing was the queue.* `cpp 74.9 · groovy 77.9 · perl 60.6 · c 39.9 ·
> javascript 84.5 · rust 78.5 · java 77.4 · python 76.9 · typescript 73.4 · csharp 65.7 · go 64.4 · swift 44.6 ·
> scala 38.6 · kotlin 23.9 · php 23.2` — **against Laptop B's 0.001–36.3%. THE RATES ARE NOT ALL THE SAME FRACTION**
> (some are `(amb+unres)/edges` from the gate's columns, some a resolved-per-edge read), which `LANES_A`'s own comment
> says. **Seven lanes remain unmeasured.**
>
> **TWELVE ROUTER EXTENSIONS FIXED, EVERY ONE FALSIFIER-TESTED**: `.mts` · `.cts` · `.graphqls` · `.sass` · `.jsonl` ·
> `.jsonlog` · `.sbt` · `.phpt` · `.ipp` · `.inl` · `.cu` · `.pod` — *found by four different lanes, one at a time.*
> **AND THE CLASS IS NOW GATED**, not merely measured: `script/m60/unrouted-extension-gate.ts` reports **`verdict PASS`,
> `exitCode 0`, `gateDisagreements 0`, `textBearingNewKeys 0`, `selfTestsOk True`** — *so the thirteenth arrives as a
> failing gate rather than as a lane's discovery.* **Its own limitation is named: it cannot see an extension no corpus
> here contains yet, and nine such siblings are listed.**
>
> **THE `overrides` TYPE NOW HAS FOUR DISTINGUISHABLE DEFECTS, AND THREE ARE FIXED OR SIZED:**
> **(1) the dotted `<owner>.<member>` target — A NAMING PROBLEM, fixed in SEVEN LANES** (javascript · python · java ·
> rust · groovy · cpp, with perl's verified branch re-spelled): *groovy 253 → 0 · cpp 86 → 0 · the four-lane arm
> `unresolved → 0` on all four — and the metadata carry (`overriddenOwner`) is IN, closing the gap the first arm left.*
> **(2) the clause-1 wiring gap — javascript's `first-parent-guess`, SIZED AT 1,255 FALSE EDGES on the whole population
> and fixed by ONE TOKEN, proven with a negative control** — *and shown to move nothing on `bootstrap` because the
> naming fix already removed the condition; **the A/B's arms were identical AND its control proved the pass ran**.*
> **(3) perl's `:1430` guess branch** — 1,271 rows, **the same clause-1 class under a second lane's reason code, named
> and NOT bundled.** **(4) `go`'s emission site existing while the lane measures 0 edges** — open.
>
> **AND `cpp`'s `resolved` DID NOT RISE, WHICH IS THE HONEST FORM OF A PARTIAL FIX**: dart-sdk's 1,701 edges land
> `ambDeclOnly 1,384 · ambBoth 317 · resolved 0` — *C++ member names repeat across classes, so the leaf is not unique;
> `unresolved` fell to zero, which is what a re-spelling can do, and **the uniqueness question is a second one nobody
> has claimed.***
>
> **WHAT TODAY DID *NOT* DO, SAID PLAINLY: NO LAPTOP-B LANE WAS BROUGHT THROUGH THE FOUR-CLAUSE BAR.** *The 7 are still
> 7, and **16 Laptop B lanes have not been through it.*** **The next phase's work is turning these diagnoses into lane
> closures, and the cheapest first step is the three-part `overrides` disposition: seven lanes fixed, one branch named,
> one emission site open.*
>
> **AND THE DAY'S LARGEST OUTPUT WAS CORRECTIONS — ELEVEN OF THEM, SEVEN THE LEAD'S OWN.** *A `.cts` headline of 3,118
> files that were 3 · four lanes that were three · python's residual printed from java's row · "go emits no overrides"
> read from a stride that measured 9 · a directory glob that swept a lane's artifacts · a filename from which a
> relationship was inferred · and a bound count read where an edge count was needed.* **Every surviving number in this
> file rests on one of those corrections, which is the only reason it is worth reading.**

> **2026-10-12 ADDENDUM — READ THIS FIRST. THE TABLE BELOW IS UNCHANGED; FOUR THINGS WERE LEARNED TODAY THAT
> QUALIFY IT, AND ONE LANE'S VERDICT WAS RESTATED.**
>
> **1 · THE UNROUTED-EXTENSION CLASS: THREE INSTANCES, ~200,000 RELATIONSHIPS. An extension the corpus carries
> that NOTHING routes is READ, answered with the fallback, and produces no symbols WHILE APPEARING IN THE
> POPULATION** — it leaves no row anywhere, which is why every earlier census missed it.
> `.mts` (`0fe665715`): **490 tracked files in THIS repository alone, 18,586 symbols, 54,485 relationships
> invisible** — *much of the m12/m14 gate suite among them.* · `.cts` (`6ed5d0508`): **3 admitted files.** ·
> `.graphqls` (`1150b2140`): **97 files, 83,371 symbols, 195,108 relationships.** **All three are one-entry
> router fixes; a FILE COUNT WOULD HAVE RANKED THEM THE WRONG WAY ROUND.** The fleet census is
> `script/m60/unrouted-extension-census.ts` (in flight); **the instances were found by LANES, not by it.**
>
> **2 · TWO SHARED-MACHINERY FIXES RESTORED 198,683 RELATIONSHIPS TO THE STORE.** `ignore`'s `ignorecase`
> default diverged from git, so `**/testData/**` swallowed lowercase `testdata/`: **12,479 routed-extension
> files fleet-wide, verified three ways, falsifier PASSED (22 repos admitted files where the count had been 0 by
> construction), and the store grew by exactly +155.** **The m14 GATES ARE UNAFFECTED** — they discover through
> `git ls-files` and never import `ignore` — **so NO VERIFIED POPULATION ON THE TABLE BELOW IS SHRUNK BY IT.**
>
> **3 · hcl'S BRANCH IS CLOSED AS A CORPUS ARTIFACT.** Its instrument merged 13 repositories into ONE scratch
> project, so same-named declarations collided across repos. **A single-repo control collapsed the defect class
> 45 → 1 and the fixture captures 480 → 0.** **The real defect — `MIN(id)` with no same-file tier — is worth 1
> ROW in boundary, not 45 in 13 repos.** *A real defect with a real size, and the size is the finding.*
> **Every hcl number in this repository's history carries the caveat.**
>
> **4 · scss REACHED A PURE GAIN.** Three blockers fixed with every acceptance met, then the mechanism was
> *correct and harmful* (+3,206 exports, +3,182 ambiguous), and **one guard —
> `if (sym.metadata?.scssImportedFrom) continue` — turned it into +1,603 edges and +1,603 resolved with ZERO
> added ambiguity.** `extOK` held at **6,841** in every arm; css control **0 of 6 columns.**
>
> **AND A CLAUSE-1 DEFECT WAS FOUND IN LAPTOP A, the first one in this programme**: javascript's `overrides`
> cross-file branch emits **`first-parent-guess` at confidence 0.5, `evidenceClass: inferred`, WITHOUT CHECKING
> THAT THE BASE DECLARES THE MEMBER** (`real-javascript-analyzer.ts:1540-1655`). Measured: `BaseComponent.dispose
> → Config.dispose`, and `Config` declares no `dispose`. **That is "every emitted edge is REAL" violated rather
> than a resolution failure** — and its whole-population audit is in flight.
>
> **AND FOUR RUN-SHAPE RULES ARE NOW IN `archive/docs-pre-consolidation/analyzers-HANDOFF.md`**, each measured: **a stride is a lower bound
> for a file-scoped quantity** (0.4% vs 46.8%) · **a sequential walk past ~9,000 files can be answered by
> `extractFallback` while `degraded` reads 2** (2.23× under) · **a lane's corpus may be a different population**
> from the gate's · **and a corpus may hold many projects where production holds one.** **Ask per NUMBER, not per
> instrument.** *Plus: a CENSUS OF THE FILESYSTEM IS NOT A CENSUS OF THE POPULATION, and the Lead learned that by
> quoting 3,118 `.cts` files where discovery admits 3.*
>
> **LAPTOP A: 5 OF 23 NOW MEASURED — rust 78.5% · java 77.4% · go 64.4% · typescript 73.4% · javascript 84.5%**
> residual on comparable 400-file probes, against Laptop B's 0.001–36.3%. **The `imports` colon is confirmed in
> THREE lanes (typescript · javascript · python — NOT java, which emits a bare `moduleName`) and its fix is
> authorized: bare item name, LOCAL specifiers only, with the external half byte-identical as the guard.**

Lead-authored, 2026-10-10. Every number below is from a committed instrument on the production path,
or from a lane's committed package. **This file exists because the recurring question is "how many are
truly done", and the honest answer is a number with its evidence attached.**

## RENAMED 2026-10-12: these are ACCOUNTED-FOR, NOT RESOLVED — and the programme owner asked the right question

**THIS HEADING USED TO READ "TRULY DONE: 7 of 23". IT WAS MISLEADING AND THE LEAD RENAMED IT.** The owner asked
*"how are these languages done if julia has 62 percent, bash has 53 thousands, xml has 9131, css has 260, and yaml has
184?"* — **and the answer is that they are NOT done in the sense that question means.** *What the seven have is a
**full account** of their residual: every remaining edge is named by class, counted, and ruled legitimate with a
falsifier that was RUN. **None of that is a resolution.***

> **THE COUNT FOR ANY RELEASE DECISION IS THIS ONE, AND IT IS NOT 7:**

    genuinely closed (residual 0)     1   json
    accounted-for but SHORT (ruled)     6   toml 13 · yaml 184 · css 260 · xml 9,131
                                             · bash 53,978 · julia 147,390
    measured, bar not started          16   Laptop A — 0 verified
    never measured                      7   Laptop A
    never examined by the bar          16   Laptop B

**AND THE OBJECTIVE'S OWN WORDS SETTLE IT**: *"No unknown, unexplained, ambiguous or wrong edges may remain."* **A
ruled class IS still ambiguous or unresolved** — *so under the objective as written, **6 of the 7 are short by exactly
their residual column, and only json qualifies.*** **"Accounted for" is a process milestone; "resolved" is the target,
and the two must never share a heading again.**

**THE LANES SAID THIS THEMSELVES, UNPROMPTED, AND IT IS WHY THE MISLABEL IS THE LEAD'S AND NOT THEIRS.** *yaml:
"a ruled class is not a resolution." bash: "ruling it does not make it a resolution, and saying so is the difference
between a ruled class and a laundered one."* **They drew the distinction; the Lead's heading erased it.**

## ACCOUNTED FOR: 7 of 23, each independently verified by the Lead

| lane | edges | residual | how it closed |
|---|---:|---:|---|
| **toml** | 25,531 | 13 | 13 ruled (cargo fixtures asserting a missing path); `ofWhich` 0; every `contains` edge `intended` |
| **css** | 487,844 | 260 | 180 ruled (CSS-D17, falsifiers **measured at ZERO**: `noAlt` 181/181 · CROSS-FILE-TWIN 0 · IN-FILE-MULTI 0 · DUP-EMISSION 0) + 80 declined by shape; **`ext?` 0**; `ofWhich` **0** per type |
| **json** | **5,588,516** | **0** | residual 0, `amb` 0, `unres` 0, all three refutation columns 0 from two populations; `collRes 2` **measured `intended`** on the store with a control proving the test can fail (duckdb 27,536/6); `extQ 120` ruled with the falsifier RUN |
| **xml** | 202,725 | 9,131 | clause **1 MET** with the whole 9,131 **ruled by class**: 7,582 `references` amb · 991 `extends` · 279 `calls` (all enumerated, **each having exactly ONE declaration of the callee in its own file**, falsifier checked at 0 of 279) · 265 `imports` unres (refutation-backed, a blanket claim would REFUTE 59 times) · 2 `overrides` · 12 `references` unres. Clauses **2/3/4 MET**; `extFAIL`/`bindFAIL`/`causeFAIL` **0** per type and in TOTAL |
| **yaml** | **1,414,582** | **184** | the 184 named from the **gate's own marker-set table** (137 amb + 47 unres, four classes summing exactly): 117 `references test` (object declared nowhere; same-directory rule APPLIED with ceiling 0) · 10 `default`/`kubeconfig`/`secret` · 7 `imports` role NAMES (no `roles/<name>/`) · 33 json pointers genuinely undeclared in clean-parsing files · 14 unreachable (bare `flow_node`, no key node) · 3 external-file `$ref` colliding by name. **All RULED with counts and falsifiers.** `extFAIL`/`bindFAIL`/`causeFAIL` **0**; **CLOSURE reports the lane CLOSED across all eight types and TOTAL 1,414,582**; `extQ 253` is a separate ruled class and **explicitly NOT part of the 184** |
| **bash** | 148,816 | **53,978** | clause **3 MET**: one class FIXED with a before/after over the SAME population (**residual 52.7% → 35.7%**, and it is a **RESOLUTION not a trade** — `uses` `noDecl` 6,534 → 6,534 and `uses` `unresolved` 7,922 → 7,922, both **unchanged**) and three ruled with **RUN** falsifiers: 989 **CONTRACT** (80 `targetLine` · 824 `targetResolution` · 85 `overridesLine` · **0 carry neither**) · 11,080 **runtime-order boundary** (best bounded rule measured at **189 = 1.7%**) · 5,070 **binding-refusals**. Clause **2 MET**: the 36,052 unresolved sum **EXACTLY** (16,396+10,690+7,922+520+520+3+1) with the **shell's own resolver** (`type -t`) as evidence. Clause **4 MET**: three FAIL columns 0 on both sides. **STRICT SHORTFALL 53,978 (36.3%)** = 17,139 amb + 36,052 unres + **787 unverified claims** — and **the strict figure uses the CLAUSE's arithmetic, not the instrument's**: the residual gate's `resid` omits `ext?`, so it reports 35.7% and **the clause and the instrument disagree by exactly the 787** |

| **julia** | 235,888 | **147,390 (62.5%)** | clause **4 MET**: `extFAIL`/`bindFAIL`/`causeFAIL` **0**, with **`bindFAIL` 0 on BOTH sides** of the binding change (the clause whose falsifier it armed) and the **separator tripwire quoted both sides 0 → 0**. Clause **3 MET**: four fixes each with a same-population before/after — `contains` **7,162 amb → 0** · `imports` **205 extFAIL → 0** at a **stated price of +111 residual** (3 unverifiable + **108 TRUE claims turned into open gaps**) · `references` 160 amb → resolved (leaf rule **refused** at 836 silent re-points) · local binding **875 bindOK** (`BINDING_SEP`, scope-keyed by function). **Strict shortfall = amb(decl) 86,066 + unresolved 61,324 = 147,390 EXACT**, and it is the WHOLE shortfall because **`ext? 0`** — julia carries **no unreachable-claim class**, so *the clause and the instrument AGREE on this lane's number* (unlike bash, where they differ by 787). Largest component **`calls` 81,541**, ruled: **owner-qualification ceiling 275 (0.6%)**, 82.9% of the ambiguity being *target declared in ANOTHER file only* — a **RESOLVER** property (the method table is one entry per (name, signature), so one generic function spans files), with a **reachable falsifier** (a project-scoped method-table pass in `parallel-indexer.resolveRelationships`). **`resolved` FELL by 169 and the package says why: those were FALSE LINKS, not resolutions** |
**Verification records:** `validation/m14/verification/{css,json,xml,yaml,bash}-completion-lead-verification.md`.

## THE QUALIFIER EVERY LANE ON THIS LIST CARRIES, IN THE LANE'S OWN WORDS

yaml-lane stated it unprompted, and it is the honest form for all five:

> under the bar as restated — zero UNEXPLAINED edges, named causes with measured counts, each fixed or ruled
> with evidence, three FAIL columns zero — **yaml is CLOSED**. Under the stricter reading of clause 1 —
> every emitted edge resolves to exactly one real declaration or carries a claim the project VERIFIES —
> **yaml is 184 edges short (0.013%)**, because **a ruled class is not a resolution**.

**That qualifier is the answer to "verified or VERIFIED", and it must travel with every one of the six:
CLOSED under the bar, and short by the residual in the table under the strict reading.** For yaml that is
184 of 1,414,582; for json 120; for toml 13; for css 260; for xml 9,131; for bash **53,978 (36.3%)**.

**AND ONE LANE'S STRICT FIGURE IS NOT THE INSTRUMENT'S, WHICH IS WHY THE NUMBER IS NAMED RATHER THAN
DERIVED.** The residual gate's `resid` sums only `amb + unres + extFAIL + bindFAIL + causeFAIL` and reports
bash at **35.7%**. But bash carries **787 edges in `ext?`** — *a claim no check can reach* — and clause 1
requires a claim **the project VERIFIES**, so those 787 are **SHORT**. bash took the clause's side and said
so in those words: *"ruling it does not make it a resolution, and saying so is the difference between a ruled
class and a laundered one."* **So bash's strict shortfall is 53,978, the clause and the instrument disagree
by exactly the 787, and the disagreement is stated rather than inherited.** A lane that moves its own number
in the unflattering direction is the only kind of disagreement that proves anything.

## RULING ASKED OF THE LEAD, AND THE ANSWER IS NO

yaml-lane named the only two moves that could "close" its 184 and refused both. The second needs a ruling
because it is fleet-wide, and it asked rather than assumed:

> *make the arbiter consult a NAME claim while declarations of that name exist — which empties the
> ambiguity column for EVERY lane — your rule to make, not mine.*

**RULED: NO. This is the §5l laundering vector in its purest form, and it must never be allowed.** A claim
is admissible only when the arbiter re-derives it through a layer the analyzer does not control; a claim
consulted *while declarations of that name exist* would make every ambiguous edge in the fleet resolve by
assertion, **uniformly, and in the direction that flatters** — the ambiguity column of all 23 lanes would
empty on the same day, and nothing would have become truer. It is refused on the same ground as julia's
10.7 free points, graphql's 28 never-read claim arms, and lua's M2 tautology.

**The first move is refused for a different and equally important reason**: inventing a spelling the arbiter
cannot check converts a **COUNTED** defect into an **uncounted** one. A counted 184 is worth more than an
uncounted zero, which is what the lane said and why the ruling stands with the count printed.

**AND A FIX WORTH NAMING, because it is the third instance of one pattern**: the lane's
`name-collision-falsifier.ts` was still on the **retired `contains` model** and read **141** ambiguous
against the gate's **137** — the same four-edge lag the enumerator had, in a *second* instrument, after the
first was fixed. All three now import `isContainsEdge` and agree on **137**. *Retiring a caveat by
construction means fixing the pair, not the one that was noticed.*

Verification records: `validation/m14/verification/{css,json,xml}-completion-lead-verification.md`.

**All four share one shape: every remaining edge is in a NAMED class whose falsifier was RUN.** That is the bar.

## WHAT "VERIFIED" DOES AND DOES NOT MEAN — read this before quoting the number above

The word above is **verified as fully ATTRIBUTED**, and that is **NOT the same as verified as fully RESOLVED**. The
four-clause bar permits a ruled class explicitly (*"each cause either fixed with a before/after or ruled
legitimate with evidence"*), and a ruled class is **EXPLAINED, not RESOLVED**. So the same four lanes, stated as
the absolute count of edges that do **not** resolve to exactly one declaration:

| lane | edges | **edges that do NOT resolve to a declaration** | share | what the remainder actually is |
|---|---:|---:|---:|---|
| **json** | 5,588,516 | **120** | 0.002% | carry an **unverifiable external claim** (`extQ`) — JSON Schema vocabulary URIs. No symbol table can key them, so the alternative to ruling them is a **FALSE refutation** |
| **toml** | 25,531 | **13** | 0.05% | cargo fixtures asserting a **missing path** — the declaration genuinely does not exist |
| **css** | 487,844 | **260** | 0.05% | 180 `references` amb (the **runtime cascade** — a custom property declared in 2–12 theme files, so the edge has no single static target) + 80 `imports` unres (declined **by shape**) |
| **xml** | 202,725 | **9,131** | **4.5%** | 7,582 `references` amb + 991 `extends` + 279 `calls` + 265 `imports` + 2 `overrides` + 12 `references` unres |

**So: `json` is the only one of the four at ZERO unresolved, and even it has 120 edges that neither resolve nor
verify. `xml` is verified with a 4.5% ruled remainder — the largest of the four by two orders of magnitude.**
**None of the four has "every edge resolving to exactly one declaration", and for css's cascade, json's
vocabulary URIs, toml's absent targets and xml's cross-tree name collisions, that is not achievable — which is
why the bar allows a ruled class and requires the ruling to carry its count and its falsifier.**

**The qualifiers travel with the verdict or the verdict is not reported.** xml's, in its own words: clause 4 is
**store-side on a labelled bounded draw** (libxslt 1,143 files, one run per arm; the whole-population store run
is **priced-but-unmeasured**, KILLED at ~65 min of event-loop stalls with the watchdog evidence preserved), while
**clauses 1–3 are whole-population.** Its whole-population run also prints `VERDICT: FAIL` — that is the gate's
own default bar (`amb + unres == 0`), **which xml never claimed**; the gate's default and a lane's package are
different claims, and reading one as the other is the error this section exists to prevent.

## THE §6.11 REACHABILITY AUDIT — WHAT IT DOES TO THESE FOUR VERDICTS (`075a00353`)

§6.11 says a zero is evidence only if the predicate could have returned non-zero. The audit applied it to
the four verified lanes. **No verdict is falsified — but none keeps its verdict unqualified, and one of
the zeros I quoted is unreachable.**

**xml — WEAKENED: its `calls` falsifier CANNOT FIRE.** `src/ast/real-xml-analyzer.ts:1795-1796` emits a
`calls` edge only when the stylesheet itself declares the callee, and the probe tested
`declarationsInOwnFile === 0` against a key space built from **those same declarations** — so the class is
empty **by construction**, and `calls-ruling.json`'s `{"1": 279}` is the emission rule read back. The
population that could have falsified it was **refused at emission** (`:1788`: 724 libxslt sites whose target
is not declared in the same file). The lane's own artifact already keeps the counter-evidence open: the
store binds **138 of 400 libxslt `calls` cross-file (34.5%)**. Per §6.11 the **"falsifier checked at 0 of
279" must be quoted UNREACHABLE, not CLEAN** — the row above quoted it without that disclosure.

**css — the conclusion SURVIVES; two of its four cited falsifiers are not what they are quoted as.**
* **`noAlt` 181/181 is NOT a second measurement.** `altSpelling` is computed only when `selfSites === 1`
  (`ambiguity-classify.ts:355-362`), so it is **vacuous for all 180 CROSS-FILE-ONLY edges** and `noAlt`
  increments unconditionally. "The arbiter's own alternative-spelling check agrees" therefore cites **one
  fact twice**. AND **no committed artifact contains 181** — the only committed run reads **231 and
  REFUSES** — and 181 is not the gate's 180. The provenance is mixed and is now stated as mixed.
* **`DUP-EMISSION 0` is arithmetic, not a measurement**: `countBy(selfSites, …)` over a population in which
  every ambiguous edge has `selfSites === 0`, so it is `countBy([])`. Capability UNTESTED.
* **`ext?` 0 is engineered**: the mark pass skips dotted targets (`:1371`), and the analyzer says why
  (`:1362-1366` — marking a dotted target "could turn an unattributed edge into an extFAIL, which must stay 0").
* **BUT the class is not empty as a whole**: CROSS-FILE-TWIN **fired 4** and IN-FILE-MULTI **fired 2** on
  constructed corpora, and `ofWhich 0` **fired 2**. Two of the four genuinely fire, which is why the
  residual-0 conclusion stands.

**json — the residual-0 headline does NOT depend on a zero, and its `extFAIL 0` is now shown REACHABLE
(fired 1).** But two things must stop being quoted as they are:
* **8 of 12 `bindFAIL`/`causeFAIL` cells across the four lanes are zeros over EMPTY populations** —
  `localBinding` and `baseBeyondRunScope` occur **0 times in all four analyzers**, so those columns cannot
  catch the defect class they exist for. §6.11's php shape, in the verified lanes.
* **The duckdb control I have quoted as proof the intent test can fail — 27,536 intended / 6
  arbitraryTwin — HAS NO COMMITTED ARTIFACT.** It is prose in three documents; `27536` appears in no file;
  re-running it is a real index (~18 min, recorded `indexMs` 171,565–1,096,622). It is **UNTESTED, not
  verified**, and any claim resting on it rests on prose. The 464/464 half DOES have an artifact.

**toml — the least weakened.** `contains` intended re-measured today at **25,033/25,033**; `extOK 318`
proves its `extFAIL 0` sits over a **real** population rather than an empty one (and yaml's 103 refutations
demonstrate the refuting branch is live); `ofWhich 0` **fired 1**.

**REACHABLE AND FIRED, on constructed corpora with unmodified instruments:** css CROSS-FILE-TWIN → 4,
css IN-FILE-MULTI → 2, css `ofWhich` → 2, toml `ofWhich` → 1, **xml `extFAIL` → 1** (which also falsifies
the analyzer's inline claim at `:1755-1760` that the mark "cannot manufacture an extFAIL"), json `extFAIL`
→ 1. **A class shown firing is worth more than a class reported empty, whichever way it fires.**

## THE OTHER 19, for scale — none of these is close

**yaml is the nearest at 184 of 1,414,582 (0.013%)**, with clauses 2/3/4 already met. Then the distance opens
sharply: **php 57.2% → 27.6% · julia 62.8% (clause 1 fails by 148,096) ·
lua 61.3% → 59.6% · r 53.4% · nim 49.1% · sql 36.6% · clean 51.0% · scss 19.3% · graphql 41.0% · protobuf
2,245 after adoption · markdown 5.5% but `ext?` 115,317 — the largest unverifiable-claim population in the
programme · hcl clause 1 fails by 4,034 · fsharp, whose gate exceeds a 40-minute budget · dart.**
*(bash has left this list and joined the six above; its row is in the table.)*

## BASH — 53.4% → 35.7%, A RESOLUTION AND NOT A TRADE (`a59e0053d`)

Same population both sides, whole declared `sh,bash,zsh`, 148,816 edges:

    BEFORE  resolved 69,585 · amb 42,392 · unresolved 36,052 · residual 52.7% · ofWhich 16,715 · extOK 787
    AFTER   resolved 94,838 · amb 17,139 · unresolved 36,052 · residual 35.7% · ofWhich 16,715 · extOK 787
    uses    BEFORE 25,819 / 33,959 / 7,922   AFTER 50,358 / 9,420 / 7,922
            resolved +25,253 · ambiguous -25,253 · UNRESOLVED 0 · noDecl 6,534 -> 6,534 UNCHANGED

**Ambiguity converted into RESOLUTION, not into a different failure** — and that distinction is the whole
result, because the lane's FIRST spelling produced the opposite: a residual falling 13.5 points while
`unresolved` ROSE 10,000 with `noDecl` rising by exactly the same 9,973. **A residual that falls while
another failure column rises is a trade, and the lane caught its own.**

**AND BOTH EARLIER SPELLINGS WERE WRONG IN THE SAME WAY, which is why their after-rows were identical.**
`pool-worker.ts:1175` publishes `qualifiedName` as `${scope}.${name}`. `::` matched nothing; `<file
scope>.<name>` matched only FILE-scope declarations — on `kubernetes/hack/lib/util.sh`: 168 respelled
targets, 102 answered, **66 NOT**, every one a declaration INSIDE a function where the worker's alias
carries the FUNCTION as owner (`kube::util::wait_for_url.times`). **`<OWNER>.<name>` — the worker's own
derived alias — answers 168 of 168.** The rule that reaches an existing declaration is the worker's
spelling, not an invented one.

## AND THE COLON-`contains` ITEM IS SETTLED, NOT LEFT UNSETTLED

bash-lane refused to call `419 rows over 288 distinct pairs` a defect because **one `calls` pair carried 50
rows and N sites are indistinguishable from N copies without a line on those rows.** The missing column was
**`line_number`** (`src/brain/schema-ddl.ts:119`). Grouping by `(source, target, type, LINE)` over one store
run (12 files · 624 symbols · 2,642 relationships): **419 rows with a `::` child · 419 distinct tuples · 0
same-line copies.** So `140be2f01` HELD for bash's colon-named children, and the "5 duplicate pairs" were
50 call sites. **A refusal that named its missing column got that column and closed the question** — which
is what a refusal is for.

**WHAT THE RULE DOES NOT REACH, named rather than implied**: the remaining 17,139 ambiguous are `calls`
7,305 · `uses` 9,420 · `overrides` 85 · `references` 30 · `imports` 30 — each either SAME-FILE-MULTI (the
file declares the name 2+ times; the lane already publishes `targetLine`/`targetResolution`, so it is a
CONSUMER question and not a spelling one) or CROSS-FILE-ONLY (6,178 edges over 445 targets, where the
binding is decided by SOURCING order at runtime). The 36,052 unresolved are the already-attributed
external/environment class.

## THE SIBLING-ROOT SHAPE IS MEASURED FLEET-WIDE, AND THE RULING STANDS ON THE MEASUREMENT (`b2dd15971`)

protobuf's 68-edge gap was a boundary with a price, and the price was **68 edges for a shared-interface
change plus a path set riding the serialized index into every worker and every indexed language.** I ruled
**do not build**, with a reachable falsifier: *if two or more other lanes show the shape in the thousands,
the trade flips.* **The falsifier's input now exists and it says the ruling stands.**

    lane        files (sample/pop)   path-shaped edges   root  ancestor   SIBLING     neither
    protobuf        847/847 (FULL)               1,574    286       707    68 (4.3%)     513
    graphql         1,145/1,911                    141      0        48     0 (0.0%)      93
    zig               491/3,844                  3,003      8     1,294     0 (0.0%)   1,701

**One lane, 68 times; two other lanes ZERO.** The shape is a property of one repository's layout, not of
the language, and the ruling is now a measurement rather than a preference.

**AND THE LANE FLAGGED ITS OWN ZERO AS AN ARTEFACT RATHER THAN PUBLISHING IT CLEAN.** The census implements
ONE resolution arithmetic (the path fold), so it is valid only for lanes that use it: **for toml and php it
reads "0 reached", and that zero is an ARTEFACT** — toml's claim is a MANIFEST inside the named directory
(`posix/Cargo.toml`) and php's substitutes `__DIR__`/`__FILE__`, neither arithmetic in the census. Their
rows are **EXCLUDED rather than counted as absence**, with the limitation written into the instrument's
header BEFORE its numbers. json is unmeasured (the bounded run hit its timeout) and the lane said so.
**§6.11 applied to its own instrument, unprompted, for the second time on this lane.**

**AND THE BUILDER'S CONDITION IS RECORDED WHERE A BUILDER WILL TRIP OVER IT** — in the JSON artifact and on
the lane page: **if it is ever built, the 3 ambiguous cases are REFUSED, not tie-broken.** 772 imports have
exactly one admitted suffix match and 3 have more than one (`movie.proto` → three vendored copies); picking
one re-introduces the arbitrary pick measured at **37,318 of 49,729** collision-bound selections going to
the WRONG symbol. A refusal in 0.4% of cases is cheap where a guess is not.

## JULIA'S 31,744 "NO CANDIDATE ANYWHERE" IS RULED — THE PARTITION CLOSES AND ITS §6.11 CONTROL FIRED (`aec5ac142`)

**THE CLASS IS NOT A HOLE. IT IS THE COMPLEMENT OF A WORKING LOOKUP**, and the partition closes exactly:

    31,744 =  8,779 LOCAL BINDING
            + 11,503 CALLED BY THE STDLIB REPO BUT NEVER DECLARED IN IT
            +  4,058 DOTTED INTO A NAMESPACE NOTHING DECLARES
            +  7,404 OTHER
    per type: calls 14,331 · references 10,295 · uses 4,865 · imports 1,497 · extends 439 · exports 317

**(1) LOCAL BINDING** — a call or read through a VALUE (parameter, loop, `let`, `catch`, destructuring).
Unresolvable in a name-keyed graph by construction, and the repo's standing negative contract says so
explicitly: a binding is not a declaration (no `Parameter` member in `SymbolKind`).
**(2) CALLED BY THE STDLIB BUT NEVER DECLARED IN IT** — Julia's `Core` builtins live in C and the
bootstrap, not in any `.jl` file the corpus holds: `throw` 1,397 · `isa` 875 · `getfield` 295 · plus base
types `Type` 1,376 · `AbstractString` 876 · `Vararg` 370. **(3) DOTTED INTO A NAMESPACE NOTHING DECLARES**
(`Core.svec`, `Meta.isexpr`). **(4) OTHER** — out-of-corpus dependencies and RELATIVE-IMPORT spellings
(`..Pkg`, `.Base`, `.Main.OffsetArrays`) whose target begins with a dot and can never be a key.

**§6.11 CONTROL, RUN RATHER THAN ASSERTED — and it FIRED**: the SAME lookup that produced these 31,744
**found a candidate for 30,929 OTHER edges in the same run** (stdlib-root 29,684 + other-root 1,143 +
tgt-elsewhere 102). **So the bucket cannot be a broken lookup**, and that is the case-that-would-have-made-
it-non-zero answered by evidence rather than by argument.

**AND IT FALSIFIED ITS OWN CLASS BEFORE ANYONE ELSE COULD**, because a probe that cannot see is the first
suspect: the top twelve nowhere names were grepped in the corpus's `base/` and `stdlib/` for every
declaration form (`abstract type`, `primitive type`, `struct`, `mutable struct`, `function`, `const`) —
**none is declared**, and the corpus's julia checkout has EXCISED stdlibs (`LinearAlgebra` 60,
`Statistics` 29, `SparseArrays` 16 are imports whose declaring repos are absent). **`StaticArrays` IS a
corpus repo and lands in a candidate bucket while `StaticArray` does not** — the natural in-corpus /
out-of-corpus pair, and the reason the class is a statement about the CORPUS rather than about the
language.

**REACHABLE FALSIFIER, as §6.11 requires**: the corpus root is a mutable directory that **GREW during this
session — 941 files at the lane's first census, 1,985 today** as package repos were cloned into it. Adding
the declaring project moves every name it declares out of `nowhere` with **no code change**. **WHAT WOULD
NOT MOVE IT**: any per-file key-shape rule.

**AND IT CORRECTED ITS OWN EARLIER NUMBER**: this is the measured bound on JUL-D13's surface — a surface
derived from `.jl` declarations **cannot list what C defines**, so JUL-D13's **29,684 claim candidates is a
LOWER bound** on the stdlib-root class.

**NEXT SLICE, PRICED AND NOT TAKEN**: cause (1) has a family fix — `BINDING_SEP` (`src/ast/types.ts:190`)
with `metadata.localBinding`, which php and dart both adopted — and a BINDING claim **is** falsifiable in
this gate (checked BEFORE the declaration count, so a target the project declares becomes `bindingRefuted`
in `bindFAIL`), unlike the external claim JUL-D8 refused. Ceiling **8,779 edges**; the SAME-FILE subset
must be measured before it is built, and the separator tripwire quoted before and after (it reads **0**
published keys carrying the separator today).

## hcl's `collRes 1,742` IS NAMED — AND IT READS SMALLER AS A RISK THAN AS A NUMBER (`cd0c5b1ba`)

The cross, on the same 600-file sample, `collRes` against that run's own BINDING INTENT columns:

    type        edges  resolved  collRes  share   intended  unproven  arbTwin  nothingAnywhere
    contains    4,338     4,338    1,742  40.2%      4,338         0        0                0
    all others  1,762       367        0     0%        983        79        1              699
    TOTAL       6,100     4,705    1,742  28.6%      5,321        79        1              699

**(a) ONE TYPE CARRIES IT — `contains`, and every other type is zero.** So it is not a lane-wide collision
risk but one type's characteristic, which is what `resolveContainsTargetStmt` predicts: a `contains` target
(`target._common` and friends) repeats across files **by construction**, so collisions are the type's
**norm** rather than an accident.

**(b) THE TIE-BREAK IS DETERMINATE FOR THE WHOLE CLASS, AND THAT IS THE FINDING.** The same run reads
`contains 4,338 edges → intended 4,338`: for EVERY contains edge a declaration in the edge's own file
answers **on the edge's own line**. A collision is determinate when the own file declares the name exactly
once, because both resolvers rank the file preference second in their `ORDER BY` while the contains
resolver ranks it **first** — so the indexer's 75% wrong-pick rate **does not apply here**, and the
genuinely arbitrary subset is **ZERO** (`arbitraryTwin 0`). **`collRes 28.6%` therefore reads far smaller
as a risk than as a number**, and it agrees with the store's post-landing `contains` other-file **0** on
23,328 rows — **the same fact measured two ways.**

**AND AN INSTRUMENT GAP WAS RECORDED RATHER THAN A NUMBER INVENTED**: the marker-set table cannot answer
"per marker set" for `collRes`, because it covers **NOT-RESOLVED** edges plus bindings, so a
collision-**RESOLVED** row has no row there at all. A per-marker `collRes` column is what the question
needs.

**AND THE LANE'S CLOSING OBSERVATION IS ABOUT EXPERIMENTAL DESIGN, NOT ABOUT HCL** — recorded because it
names the programme's biggest untested assumption: *"hcl's `arbitraryTwin` is 0, so this lane can no longer
test whether an arbitrary twin is really wrong."* Everything in the `ofWhich` / `collRes` / `twin` machinery
rests on the indexer's control arm measuring **37,318 of 49,729 collision-bound picks as WRONG** — and that
number justifies treating a twin as a risk. **But no population with non-zero twins has been tested per
row.** nim's `calls arbitraryTwin` is **70,223** (full population 118,262 calls edges) — the strongest test
available — with clean's `references 6,650` and css's `references 976` behind it. Assigned cross-lane, with
both outcomes stated in advance as results: **if twins are largely wrong the 37,318 figure generalises; if
they are largely right, then a large share of the fleet's `twin` columns are risk-shaped numbers that have
been read as defects.**

## CORRECTIONS TO THE TWO DART FIGURES THIS FILE AND MY BRIEFS CARRIED — BOTH WRONG

Recorded by dart-lane (`195c7f2b7`) against its own brief. **Both numbers in the row above and in my task
briefs were readings of the instrument BEFORE the `labels map brain_import -> imports` fix, and one of them
was wrong by a factor of 260.**

* **"`imports` resolved 0.0% across 1,815 edges"** — REFUTED by the same analyzer and the same instrument over
  two draws. 600-file stride: `imports` 1,830 edges · **11 resolved · 1,468 unresolved (80.2%)** · 351 extOK.
  **dart-http WHOLE repo (333 files): 1,303 edges · 612 resolved · 4 unresolved (0.31%)** · 687 extOK ·
  extFAIL 0. **A 260x move between draws, with no analyzer change.**
  **MECHANISM, and it is a POPULATION property rather than a defect:** `imports` publishes the target file's
  path, which IS the module's `qualifiedName`, and the gate indexes ONLY the files it parsed — so an import
  whose target file was not drawn **cannot resolve, by construction.** The 1,419 path-shaped unresolved are
  analyzer-computed paths outside the stride. **A stride cannot measure a file-scoped target**, which is the
  same reason a stride could not measure markdown's or yaml's.
* **"`overrides` 106,907 unresolved (16.3% of every dart edge)"** — the figure is from `LAPTOP-B-STATUS.md:674`
  (Round 3, **2026-10-07**). On the CURRENT instrument at 600 files, `overrides` reads **7,568 edges · 337
  resolved · 13 amb · 15 unresolved · 7,043 causeOK · causeFAIL 0** — i.e. **93% already carries the
  `baseBeyondRunScope` declared cause and the unresolved column is 15, not 106,907.**

**AND THE LESSON IS THE ONE THIS FILE EXISTS FOR: `LAPTOP-B-STATUS.md` §Round 3's `imports` figure is now
false in BOTH directions**, and it was quoted into a task brief by the Lead as a live defect. **A status
page is a claim about a revision, and a number in it ages the moment the instrument under it changes.**
Before a figure is quoted as a defect, the instrument that produced it must be the instrument on the
current revision — which is why the lane was asked to re-take rather than inherit, and why it could refuse.

**Fixture bar corrected too: the live number is 30 pass / 0 fail**, not 22 and not 28. 22 was true earlier,
28 was true an hour before, and the const-pattern fixture moved it to 30.

## CLAUSES MET, WORK REMAINING (6 lanes)

| lane | position |
|---|---|
| **yaml** | clause 1 fails by **185** (138 amb + 47 unres, **0 refuted**); clauses 2/3/4 **MET**; `ext?` 1,903 → **254** with `extOK` 9,208 → 10,617; a kept-open falsifier **FIRED** and was fixed (imports 51 amb → 0) |
| **xml** | clause **1 MET** · clause **2 MET** · clause **3 CLOSED** (the 12 refusals: 12/12 in no repository, **11/12 DECLARED IN CORPUS SOURCE** — claiming would be a false statement the gate certifies) · clause 4 in flight |
| **julia** | clauses **2/3/4 MET** (clause 2 closed across all ten types); clause 1 fails by **148,096**; was IN the colon-`contains` blast radius despite expectation |
| **php** | every unresolved in a ruled class; **defect-indicating classes EMPTY** (`builtin_unclaimed` 0, `owner_provable` 0); 59.4% single-repo grade declared; residual 57.2% |
| **bash** | dominant cause split with ceiling measured (**59.5%** by spelling, 85.4% with line); 3 contract edges closed; `projectFile` claim **DECLINED** at 44/787 (5.6%) |
| **hcl** | clause 1 fails by 4,034; lever priced 4,725; **12,054 no-candidate-anywhere** vs 1,407 twin; rename authorized, **not landed** pending the duplicate split |

## DIAGNOSED WITH COMMITTED CAUSE LISTS (11 lanes, no owner yet)

make · protobuf (imports 1,574; ceiling **1,061 carrying / 513 refuting**) · graphql (41.0%) ·
nim (49.1%) · markdown (**`ext?` 115,317 — the largest unverifiable-claim population in the programme**,
and the lowest residual at 5.5%) · clean (51.0%) · scss (19.3%) · sql (36.6%, **no `extQ` problem**) ·
r (53.4%, `calls` 31,024 unres = 82% of it) · lua (61.3%) · fsharp (gate exceeds a 40-minute budget —
needs the bounded/stride approach) · dart (13 commits of prior work; gate running)

## THE PROGRAMME'S LARGEST REPEATED CAUSE — one fix, seven lanes, 14,890 edges

    protobuf 1,574 · graphql 170 · clean 1,891 · scss 3,405 · r 1,871 · hcl 334 · lua 5,645

A module or package path is not a declaration. `require("mod")` / `import "x.proto"` / `library(pkg)`
are one shape. Priced on two lanes so far: **bash 5.6% (declined)** and **protobuf 67.4% ceiling /
18.2% floor (a genuine candidate)**. `toml-lane` is pricing all seven.

## AND `contains` IS FULLY RESOLVED IN EIGHT LANES

protobuf · graphql · nim · markdown · clean · scss · lua · css/xml/toml — every containment edge binding
own-file-on-own-line, against the indexer's control arm of **37,318 of 49,729** collision-bound picks that
go WRONG. Two large determinacy claims remain untested by a store-side intent split: markdown's
`ofWhich` 124,969 and lua's 41,592.

---

# UPDATE — 2026-10-10, later

## A FLEET-LEVEL DEFECT WAS FOUND AND FIXED SINCE THE MAP ABOVE

`pool-worker.ts` emits relationships from **`extractFallback()`** (regex extraction used when a parse
fails) carrying `metadata: { method: "regex" }` at `:372`, `:388`, `:414`, and the incoming gate
**counted them as the analyzer's edges**. markdown-lane found it by following `ontology-coverage-gate.ts`'s
`DEGRADED (regex fallback, not the analyzer)` discipline, and measured **5,452 of its 15,525 residual**
as fallback rows on a lane whose analyzer emits **neither** `calls` nor `instantiates`.

**Direction: it INFLATES the residual and DEFLATES every rate**, and the inflation is a property of **the
RUN** (how many files aborted under load), not of the language. **Every lane's residual in this programme
is therefore an UPPER BOUND until the block says otherwise.**

Fixed in `51b6282a1`: the rows are **counted, not removed** (so published figures stay reproducible), and
a **FALLBACK ROWS block** reports how much of each type's count is a different instrument's, with the
instruction to deduct it before comparing runs. It is a separate block and **not a column**, because
`residual-gate.ts` parses TABLE 1 **positionally**.

**Verification status, stated honestly**: the block is verified **not to false-positive** (a 120-file
bounded run on markdown printed nothing, correctly, as that sample had no aborts). It is **not yet
observed firing in a real run** — the code path is confirmed and markdown measured that such rows exist,
but the end-to-end print under load is **owed**.

## FIVE REFUSALS, ALL CORRECT — the behaviour this programme is built to reward

1. **bash** declined its `projectFile` claim: ceiling **44 of 787 (5.6%)**, plus the language fact that
   `./x` resolves against the runtime CWD, not the script's directory.
2. **hcl** did not land the authorized rename, because scoping a target requires scoping the **symbol**
   qname and that changes the public name of every exported symbol — *"rather than shipping a rename
   that changes every exported symbol's public name under the banner of 'only exports'."*
3. **hcl again**, after showing that a scoped qname **does not remove a match that existed; it removes the
   DUPLICATE that made the match ambiguous** — two fixes the programme had collapsed into one.
4. **julia** refused a stdlib claim that would have reported clause 1 **12.6 points better (62.8% → ~50.2%)
   while measuring nothing new**, because the `claimBasis` check does not exist.
5. **r-lane** refused a one-line heuristic that **matched the case in front of it**, because it cannot
   check existence and could re-point silently — *"a ruling wearing a fix's clothes."*

## THE DISTINCTIONS EARNED SINCE THE MAP

* **A low ceiling from a rule that GUESSES is a ruling; a low ceiling from a rule that reaches an EXISTING
  declaration is a fix. Size is not the test — whether the rule can be wrong is.**
* **A probe's summary is a claim about its own display** until one flagged case is checked against the
  thing itself. (Two instances: a split computed from a **top-15 listing**; an **exact-spelling**
  comparison that would have laundered **43 resolvable edges** into a ruled class.)
* **"Verifies by construction" is the tautology.** An absence claim is admissible only if the arbiter
  re-derives the absence through a layer the analyzer does not control, with a **reachable named
  falsifier** — protobuf's three vendoring repos.
* **Removing a duplicate is not making a declaration reachable.** Different fixes; a change that does one
  does nothing for the other.
* **A churn total cannot separate two mechanisms — read the artifact per arm.** `contains` churns on
  INSERT ORDER; `exports` on TABLE COMPLETENESS.
* **The biggest class is edges that name NOTHING anywhere — a CLAIM class, not a resolution one.**
  hcl: 1,407 twin vs **12,054 no-candidate**; zig: **52,852**, of which 87.6% dotted.
* **A summary that does not match its own columns** — six instances now, and the corrective **already
  existed** in `ontology-coverage-gate.ts:945-956`. Read that walk line before writing an instrument.

## AND THE SHARED `imports` CAUSE — eight lanes, 15,410 edges, one mechanism

    protobuf 1,574 · graphql 170 · clean 1,891 · scss 3,405 · r 1,871 · hcl 334 · lua 5,645 · fsharp 520

A module or package path is not a declaration. Priced so far: **bash 5.6% (declined)** ·
**protobuf 67.4% ceiling / 18.2% floor (a genuine candidate)** · **zig's file-shaped subset 99.1% as an
UPPER BOUND pending the restricted ceiling** (the arbiter's list is the lane's **admitted** population, so
non-`.zig` targets cannot be claimed however well the repo carries them).

## THE DECISION LANDED THIS ROUND

**protobuf gets an `INDEX_SPEC`** so its import-scope rule can accept a candidate **only when the project
declares it** — the route that makes the rule **reach an existing declaration** rather than guess. The
defect is **in the rule's inputs** (the walk builds the right candidate; a guard that assumes directory
mirrors package discards it, and that refusal is deliberate and correct given what it can see). Conditions
before landing: price what protobuf indexing adds to production, put the existence check **in** the guard,
and use the 43 as the falsifier with the 7 declared-nowhere as the **negative control**.

---

# OPEN HANDOVERS — pick these up first

## 1. THE SHARED RESOLVER FIX — the programme's biggest defect, and mine to land

**Four sightings, one mechanism: EAGER RESOLUTION AGAINST AN INCOMPLETE TABLE.**
* **xml's `calls` 138 violations** (`55712cff1`) — a type the analyzer emits only when the document
  declares the callee, so 138 is precisely what own-file preference should have prevented.
* **hcl's ~12,054 no-candidate-anywhere** vs 1,407 twin (`d78c272b9`).
* **the order/eager churn** — `contains` 113/0/117 under file-order reversal, `exports` 99 under
  eager-vs-deferred (`36e207bbb`, and `c269702f6` separated the two mechanisms from committed data).
* **hcl's 229** (`cbb783619`) — **the cleanest test population of the four.**

**THE 229, WITH ITS RE-RUNNABLE PREDICATE (both columns already exist in the probe):**
```
own-file:  EXISTS symbol x WHERE x.file_id = <edge's own file> AND (x.name = target OR x.qualified_name = target)
project:   COUNT  symbol x WHERE x.project_id = <project>   AND (x.name = target OR x.qualified_name = target)
the 229:   own-file EXISTS AND project COUNT = 1 AND (target unbound OR bound to another file)
```
Clean because it eliminates every alternative explanation: the declaration exists, is spelled **exactly**
as the target, is the **only** one with that spelling in the project, and the row **still bound elsewhere
or nowhere**. Test population: 229 rows, plus xml's 138 `calls` as the second.

**CONTROL**: `store-determinism.mts` — same files, sorted vs reversed vs eager.

## 2. hcl's RENAME — authorized, NOT landed, handover mechanical

**Pay it for the 2,079** (of 2,308 movable rows: `exports` 589/589 and `references` 606/606 are **100%
duplicates**; `contains` 860 duplicate / 229 unique). **NOT for the 229** — those need the resolver fix.

**THE COUPLED EDIT** — qname **plus** every self-path target (`contains`, `exports`, `extends`) must move
together, because a scoped target against an unscoped qname **binds nothing**.

**THE PRICED COST**: **269 fixture pins** (12 files, 162 target + 107 source), all unscoped, re-spelled in
the same change. Plus the consumer-visible consequence: this changes the **public qualified name of every
exported symbol**, so a consumer holding an old spelling will not match it — a deliberate trade for
determinacy, to go in the release note.

**THE FIVE-CONDITION FALSIFIER, fixed before the run so the run can fail**: (1) a type predicted to hold
loses rows — `references` below 17,670 bound or `contains` below 207,993; (2) `contains` moving OFF the own
file, a drop from its 96,273 own-file bindings; (3) `uses`/`imports` GAINING rows; (4) the 2,079 NOT
moving; and (5) **the 229 must NOT move** — if they do, the rename is doing something other than removing a
duplicate and its mechanism is refuted, which is a failure of the justification rather than a bonus.

Plus: the store pair over the same population (one labelled run each), and the monotonicity assertion as a
**SAFETY** property — `exports` never rode the tie-break.

## 3. THE RESTRICTED zig CLAIM CEILING — first thing for that lane

99.1% is an **upper bound**, not the ceiling: the arbiter's file list is the lane's **admitted** population
and zig admits `.zig` only, so `build.zig.zon`, `cimgui.c`, `freetype.c` **cannot be claimed** however well
the repo carries them. Restricted re-measurement **KILLED** (lock timeout, exit 9) — report as KILLED, not
as a result. Then: the std-surface disposition (28,180 edges — a claim needs a **checkable basis**; a
shipped std list is a mechanism the claimant does not control), then rule A priced in scratch against the
store.

## 4. THE FALLBACK ROWS OBSERVATION — still owed

`51b6282a1` reports them; verified **not to false-positive** on two bounded runs (100 and 120 files, one at
load 27.6). **Not yet observed firing end-to-end** — markdown's 9,057 aborts came from a 17,460-file
whole-population run, so the block needs **scale** to fire. When it does, markdown's residual should drop
by **5,452 with no analyzer change**.

## 5. toml's EIGHT-LANE `imports` CEILING

protobuf 1,574 · graphql 170 · clean 1,891 · scss 3,405 · r 1,871 · hcl 334 · lua 5,645 · fsharp 520 =
**15,410 edges, one mechanism**. Priced so far: bash 5.6% (declined) · protobuf 67.4% ceiling / 18.2% floor
(candidate) · zig 99.1% upper bound pending. **Do four lanes properly rather than eight badly.**

## AND THE ANSWER: IT WAS NEVER ONE MECHANISM — `19ff1de04`, EIGHT MEASUREMENTS, THREE GROUPS

**The single biggest correction to this programme's own framing.** The cause was carried as *"15,410 edges,
one mechanism"*, and the ceiling was then measured on all eight lanes — bounded stride, 60 files per repo
per lane, extensions from the gate's own `LANES_B`, every edge through `parseFile`:

    lane       rule            files (sample/pop)   imports   VERIFY        refute   residue   group
    graphql    path                520/1,911             53    50 (94.3%)        0         3   HIGH
    lua        lua-dotted          763/3,250          1,800 1,309 (72.7%)        0       491   HIGH
    scss       sass-partial        888/4,433            682   469 (68.8%)        0       213   HIGH
    protobuf   path                540/847              872   530 (60.8%)        0       342   HIGH
    clean      module-to-file      236/312            1,428   425 (29.8%)        0     1,003   MODERATE
    fsharp     path             1,428/11,807          7,149    35 (0.5%)       11     7,103   NEAR-ZERO
    r          path                873/2,184            787     3 (0.4%)       24       760   NEAR-ZERO
    hcl        path                708/9,329             84     0 (0.0%)        0        84   NEAR-ZERO

**0.0% → 94.3% across three groups, and the groups are three different things:**
* **HIGH — the file claim IS the fix**: graphql · lua · scss · protobuf. Each needs its own arithmetic
  against its own admitted list, cross-tabbed verify-vs-refute BEFORE emitting. The guard supplies the
  admitting; the lane supplies the spelling.
* **MODERATE — clean 29.8%**: its `Module:item` targets are exactly what a shared rule would mis-bind.
* **NEAR-ZERO — the claim buys NOTHING**: fsharp 0.5% · r 0.4% · hcl 0.0%, because **their `imports` are not
  project files at all** (fsharp's are module/directive names, r's are package names like `library(dplyr)`
  and non-source files, hcl's are registry/URL sources).

> *"Their residue is a boundary for a DIFFERENT cause, not a ceiling for this one."*

**So three lanes' `imports` cause is not yet NAMED, and a file claim there would be the inert change this
programme already refused once** — bash measured its own version at 44 of 787 and declined. Assigned: name
the actual cause on fsharp, r and hcl, with a count and a shape split each.

## AND ALL THREE ARE NOW NAMED — `558c9828f`, with a fourth correction to the fleet arithmetic

    fsharp  imports 7,149 · VERIFY 35 · refute 11 · RESIDUE 7,103 (99.4%)
            THE CAUSE: NAMESPACE/MODULE NAMES FROM `open` — 6,728 of 7,103 (94.7%)
              DOTTED_NAME 4,792 (System.IO 236 · NUnit.Framework 177 · System.Threading.Tasks 173)
              NAME        1,936 (System 703 · FsUnit 102 · Expecto 100 · Xunit 77 · FsCheck 70)
            rest: `#r` BINARY refs 251 (.dll) · real load targets 78 · dir-shaped 45 · URL 1
            refute 11: `_lib/Fornax.Core.dll` EXISTS and is NOT admitted — a claim would REFUTE

    r       imports   787 · VERIFY  3 · refute 24 · RESIDUE   760 (96.6%)
            THE CAUSE: PACKAGE NAMES FROM `library()`/`require()` — 757 of 760 (99.6%)
              cli 89 · withr 81 · utils 56 · rlang 41 · Rcpp 36 · stats 28
            refute 24: `.cpp` under inst/examples/… and inst/tinytest/cpp/ (Rcpp sourceCpp())

    hcl     imports    88 · VERIFY  0 · refute  0 · RESIDUE    88 (100%)
            THE CAUSE: MODULE SOURCES THAT NAME A DIRECTORY — 84 of 88 (95.5%)
              ./module 12 · ./child 7 · ../../account-map/modules/iam-role 6 · ./provision-nomad 3
            0 refute, and the reason is STRUCTURAL: a directory is not a file, so the file route has
            nothing to refute — and nothing to CLAIM, which is why the ceiling is 0.0% rather than "small"

**THE INSTRUMENT WAS WRONG FIRST AND THE LANE WAS RE-RUN**: it filed ANY dotted identifier as a path with an
extension, so `System.IO`, `NUnit.Framework` and `System.Threading.Tasks` became `PATH_OTHER_EXT` — **5,079
"paths" that are namespace names** — which would have reported fsharp's cause as *paths that are absent*
when it is *names that are not files at all*. **A file extension must now be KNOWN to count**; fsharp was
re-measured and r's 2 and hcl's 1 reclassify with nothing else moving.

**THREE RULINGS, NOT ONE** — fsharp's is a **NAME** cause (a file claim reaches at most **1.7%**, while the
index it already has carries qualified names, i.e. **the instrument that can REACH an existing
declaration**); r's is a **PACKAGE** cause, and **its 24 refutes are the evidence the file route must NOT be
widened**; hcl's names a **DIRECTORY**.

**AND hcl RULED ITS OWN, ON THE ROUTE RATHER THAN THE EDGES** (`4cbc4128b`): *"the 0.0% ceiling belongs to
the FILE route specifically, not to these directives generally, and quoting it as 'hcl's imports are 0%
claimable' would be the same error class as reading a `twin` column as a defect count."* **Ruled, not
taken** — it declined to build a second claim route in the shared machinery to move **88 edges across 9,329
files (0.9%)**, and recorded the cause with its count and its route **so that a lane building the directory
route for a larger population inherits these 88 first.**

**AND A FOURTH CORRECTION TO THE FLEET ARITHMETIC**: the old figure counted **hcl's 334 edges among the
file-claim lanes** — **it was counting DIRECTORY targets as FILE targets.** So the final form is **four
file-claim lanes, one shared-rule question, and three named non-file causes** — and hcl is one of the three,
not one of the four.

## THE `degraded` COUNTER IS A PROPERTY OF THE RUN, NOT OF THE CORPUS (`5d6f5ded6`) — AND THE FALSE NEGATIVE HAS A MEASURED INSTANCE

**This is fleet-level: every lane's POPULATION block prints `degraded (regex fallback)`, and every lane reads
it as a statement about its corpus.**

A lane's census reported **4 of 3,834 files falling back to `extractFallback`.** It named them, priced an
exclusion, and the Lead approved it. **Then it ran the SAME DRAW — same `sha256` over the sorted union —
partitioned into 8 shards and got ZERO fallbacks across all 3,834 files**, with all four parsing fine in
their shards. Both falsifier arms were named and neither fired: a single-process run reporting 0 fallbacks
would have pointed at the files; **any shard** reporting one would have falsified the sharding fix. **So the
fix was sharding, NOT the exclusion the Lead had approved.**

**AND THE MECHANISM WAS THEN CORRECTED BY THE LANE ITSELF.** Its first attribution was *cumulative WASM
state*; it then mapped both single-process runs' fallback files to their position in the draw order:

    run A: 1005, 1508, 2007, 3007   (26.2% … 78.5% through the draw)
    run B:  502,  507, 3006, 3003   (13.1% … 78.4% through the draw)

**The two sets share ZERO files and start as early as 13.1%.** So it is **not** accumulation and there is
**no position threshold** — the fallback set is a function of the **run's MEMORY CONDITIONS**. **A lane
refuting its own mechanism one turn after stating it, because a measurement contradicted it, is the pattern
this programme most needs.**

**THE FALSE NEGATIVE IS ALREADY DOCUMENTED AND HAS AN INSTANCE** — `incoming-gate.ts:660-672`: **markdown's
sequential census read `calls 0 · instantiates 0 · 0 degraded`** while the gate's own run logged **9,057
`Aborted()` wasm parse errors and silently retried**, and **5,452 of markdown's 15,525 residual were fallback
rows — on a lane whose analyzer emits NEITHER `calls` nor `instantiates`.** The discovering lane assigned
credit correctly: *"this lane did not discover the class; it re-measured it and can now state its mechanism
and its fix."*

**WHAT THIS MEANS FOR EVERY OTHER LANE, in the form that can be acted on:**
* **AT RISK**: a `degraded N` that understates its own run · **a `degraded 0` read as a clean corpus** (not a
  clean-corpus statement — a clean-RUN statement about one run shape) · any rate computed over a run **mixing
  two instruments**, which is how markdown came to carry rows of types its analyzer does not emit.
* **NOT AT RISK**: **the gate's own fallback-row block**, which reports fallback rows as a separate map
  precisely so TABLE 1 stays the ALL-IN figure. **A lane that quoted THAT block is safe; a lane that quoted a
  sequential census's `degraded` line is not.**
* **SIZE OF THE EXPOSURE**: the two lanes with the largest draws — fsharp **11,807** files and hcl **9,329** —
  are **3.1× and 2.4×** the 3,834-file draw that produced 4 fallbacks in *both* attempts.

**AND IT CARRIED A CAUTION INTO ITS OWN NEXT TASK**: any before/after built on a census **must have BOTH
arms in the SAME run shape** (both sharded, same shard boundaries), **or the pair measures the run rather
than the change** — which is the exact trap the `degraded` counter sets.

**NOT EARNED, and stated as such**: **no per-file threshold is measured** (480/process → 0 fallbacks and
3,834 → 4 bounds nothing in between; the cheap bound would be intermediate sizes), and the **memory
correlation is INFERRED, not measured** — real allocation at each fallback needs instrumentation inside the
shared parse loop. **Left unmeasured rather than inferred.**

## `MIN(sym.id)`: A RESOLVER WHOSE ANSWER DEPENDS ON ID ORDER IS NOT RESOLVING — IT IS SAMPLING (`5519785e6`)

**The most consequential technical finding of the session, and it is in SHARED machinery, not in a lane.**
r-lane was chasing **45** `references` edges whose own file declared the leaf the store bound elsewhere.
Three nested measurements had narrowed the defect class to those 45 and left the **mechanism** open. It is a
code fact:

**`references` DEFERS** — so `resolveTargetStmt`'s same-file tier never sees them and **the pass** resolves
them. The pass's **Strategy 3** (`parallel-indexer.ts:4836-4848`) is:

    SET target_symbol_id = (
        SELECT MIN(sym.id) FROM brain_symbol sym
        WHERE sym.name = SUBSTR(target_external, INSTR(target_external, '.') + 1)
          AND sym.project_id = '...')

**`MIN(sym.id)` AND NOTHING ELSE** — no same-file tier, no `is_declaration` tier, no language tier. And
`s.id` is `${fileId}:${name}:${line}` compared **AS TEXT**, so **the winner is decided by a FILE-ID HASH.**

**IT EXPLAINS ALL THREE OBSERVATIONS WITH NO NEW HYPOTHESIS**: `ownMinDecl = 0` and `boundDecl = 0` on every
one — **Strategy 3 never reads `is_declaration`**; the own file lost 45 times because **there is no same-file
preference to lose on**; and `var.instance_type` → `SUBSTR` → `instance_type` → `MIN(sym.id)` → **the tflint
test fixture wins on id order.**

> **THE 45 ARE NOT A TIE-BREAK THAT MIS-FIRED. THEY ARE A TIE-BREAK THAT IS ABSENT.**

**AND THE GENERAL RULE, which is why this is not an hcl note**: the route is *eager skipped → Strategy 1
misses → Strategy 2 misses → **Strategy 3 takes `MIN(id)`*** — so **every edge that reaches Strategy 3, in
every language, in the deferred pass, is bound by a file-id hash rather than by the corpus.** The Lead's own
third candidate had framed it from the other side (*"a key present in the text and unbound at execution is a
tie-break that never runs"*); here **it was never written into the strategy at all.**

**THE FIX — AUTHORIZED, and the determinism argument is why it is a strict improvement rather than a trade**:
replace `MIN(sym.id)` with `ORDER BY (same-file) DESC, sym.id LIMIT 1`. **The `sym.id` tail keeps the answer
independent of indexing order** — the property `MIN(id)` existed to protect — and the header's own objection
(*"`LIMIT 1` with no ORDER BY lets SQLite return any matching row"*) is **answered by giving `LIMIT 1` a
total, deterministic order.** **It does not trade determinism for correctness; it adds a preference to an
order that was already total.**

**AUTHORIZED WITH A BLAST-RADIUS MEASUREMENT FIRST** — Strategy 3 is shared code and decides a winner for
every deferred edge that reaches it, so the **fleet-wide** before/after is the evidence, not hcl's 45. The
pre-registered falsifier carries both scales: **the 45 → 0 · no other type's counts rise · `boundOtherFile`
must NOT fall** (the fix re-points, it must not unbind) · **each language's `boundOtherFile`/`boundSameFile`
must not fall.**

## AND THE FIXTURE CAPTURE IS 480, NOT 45 — WITH THE SAME-FILE COLUMN AS ITS OWN CONTROL

    references boundOtherFile into a TEST/FIXTURE   480 of 6,167   (7.8%)
    references boundSameFile  into a TEST/FIXTURE   351 of 8,449   (4.2%)

**The Lead's worry that it might be hundreds of thousands was WRONG, and this is the answer**: at 7.8% of the
population **it is a bounded, countable class** — and **10.7× the 45**, so it is bigger than the defect class
but not unbounded. **The 45 are a SUBSET of it.**

**AND THE CONTROL IS THE BEST REASONING IN THE MEASUREMENT**: same-file bindings into a test tree are
**legitimate** — a file may reference its own test tree — **so if the two rates were equal the finding would
be an artifact of fixture naming.** **7.8% other-file against 4.2% same-file (~1.9× elevation) is what a
key-space defect produces and what a boundary-respecting normaliser would NOT** — *"a key-space defect that
ignored file boundaries would not respect that ratio; a `MIN(id)` tie-break would."*

**AND WHAT IS NOT MEASURED IS STATED**: **whether all 480 share Strategy 3's mechanism is a HYPOTHESIS.** The
fix re-points the subset that does; **the rest need their own mechanism**, and **a fix that re-points 45 of
480 must not be reported as closing the 480.** The split is to be measured after the fix.

## THE `twin` CLAIM IS NARROWER THAN IT WAS — nim is INCONCLUSIVE-ON-INSTRUMENT (`c63da0837`)

**A correction that came from the lane's own pre-commitment rather than from a critic, and it narrows a
fleet-level claim.**

The twin question — *is an "arbitrary twin" really wrong?* — had been answered **STANDS** on nim at **0.0%
reachable**, and the fleet claim was stated as measured on **two languages and four repositories.** The lane
then found its `UNDECIDABLE` bucket counted **0** where the evidence said it must be non-zero (nim carries
**1,048 unbound imports of 2,021**), and reported that as an **instrument artifact** rather than as a clean
two-way result. It chose to re-anchor the bucket on the source **FILE** rather than the source symbol —
*"the unit should match the question"* — and **pre-registered the consequence before running**: *"if the
anchored bucket turns out large, the honest reading becomes INCONCLUSIVE-on-instrument rather than STANDS."*

**The Lead ran it** (the lane's turn is its job's lease, and two identical attempts had died at that boundary;
the instrument fix was secured first as `85bf30299`, thresholds quoted into the artifact before the run):

    type           twinExists  reachable  unreachable  undecidable
    calls                1172          0            0         1172
    references            361          0            0          361
    uses                  418          0            0          418
    imports                93          0            0           93
    instantiates           80          0            0           80
    extends                 4          0            0            4
    exports                 4          0            0            4
    TOTAL                2132          0            0         2132

**`twinReachable 0 · twinUnreachable 0 · twinUndecidable 2,132` — the share is 0/0, UNDEFINED.** So the
reading is **INCONCLUSIVE-ON-INSTRUMENT**, the branch the lane fixed before the number existed.

**AND THE BUCKET'S TWO VALUES ARE BOTH ARTIFACTS, IN OPPOSITE DIRECTIONS**: un-anchored **→ 0%** because an
unbound import row with no source symbol was dropped by an **INNER JOIN before it could be counted**;
file-anchored **→ 100%** because the predicate asks whether the source FILE has **any** unbound `imports` row
and **`sourceUnbound` is 2,018**, so it fires for essentially every row.

> **A BUCKET THAT READS 0% AND THEN 100% ON THE SAME QUESTION HAS NOT MEASURED THE TWINS. IT HAS MEASURED
> ITS OWN PREDICATE.**

**SO THE FLEET CLAIM IS**: **clean 32.1% → STANDS** (its anchored re-run was digit-for-digit unchanged, its
undecidable rows already anchored-source/unbound-target) · **nim → INCONCLUSIVE-ON-INSTRUMENT** · **and the
DIRECTION is therefore earned on ONE language, not two.** The earlier *"two languages and four repositories"*
statement **does not survive this run.**

**HELD**: `noCandidateAnywhere 0` and `scopedWouldMove 0` on nim — every own-file-silent row has a candidate
somewhere, and **no row had an own-file declaration the store passed over for the full spelling**; and
**`boundNeedsLeafReduction 5`** — nim binds twins by **full spelling**, not leaf reduction (against hcl's
12,014), **which is why it was the cleanest population AND why its undecidable rate is 100%.**

**THE NEXT MEASUREMENT, named**: the predicate must ask whether **the file the twin actually BOUND TO** could
be reached — a **per-row** reachability question, not a per-file one. **Until that exists, `twin` on nim is
undecided, and any lane quoting the earlier 0.0% is quoting the un-anchored artifact.**

## LEAD RULING: THE ANALYZER-OWNED FIX IS **REFUSED**, on its measured blast radius (`d1399909c`)

**The class is real; the route is refused.** zig's analyzer-owned class — edges whose target is declared by
the edge's own file's tree with no published symbol, **the only class on that lane that is a defect rather
than a property** — was priced, and then **the blast radius was measured BEFORE anything was written**, which
is what the Lead required:

    benefit   2,020 edges resolved (certain)      — or 4,327 at the ladder's most generous reading
    exposure  `len` is the target of 40,767 edges · `items` 11,092 · `end` 5,727 · `data` 5,230
              · `value` 4,268 — combined ≈67,000

**Even at the ladder's 4,327, the fix's benefit is ONE-FIFTEENTH of the single widest name it would publish.**
And the mechanism is stated: **publishing a symbol per container field puts those names into the symbol
table, where the resolver's same-file preference would then STEAL edges that bind elsewhere today.** *"It is a
trade, not a fix — tens of thousands of edges re-pointed to resolve 2,020."*

**AND THE UNRECONCILED 2× DOES NOT CHANGE THE RULING**: the lane's two instruments bracket the ladder at
**2,020 < 4,327 < 163,038** — **but a factor of two is invisible against a factor of fifteen.** The
reconciliation is owed **for the record** (an unresolved 2× is a defect in one of the instruments), and the
Lead's instruction is explicit that it must not reopen the fix.

**THE SECOND ROUTE IS PRICED, NOT WRITTEN**: **the trade exists because a BARE name is published.** The same
lane's own summary carries the evidence that a scoped route exists — **`boundQnameExact 9,902` and
`scopedAlreadyRight 12,457`** — so **publishing the declaration under a QUALIFIED key** (`<OWNER>.<name>`, the
shape this programme already uses) **could give the own-file edge its candidate WITHOUT entering the bare-name
key space that `len`'s 40,767 edges resolve against.** Ceiling to be priced first: **of the 2,020, how many a
qualified-key lookup reaches** — and if it is ~0, **the class is ruled unfixable without a model change.**

**AND THE REFUSAL IS RECORDED AS A REFUSAL, not as a dismissal**: the 2,020 stay **named, counted, and open**,
with the route recorded as refused-and-why — **the same disposition hcl reached on its 88 directory targets.**
A fix declined with its cost on the record is a result; a fix not mentioned is a hole.

## SUPERSEDED: THE PER-ROW PREDICATE RESTORES THE DIRECTION ON TWO LANGUAGES (`7d0713ea5`)

**The paragraph above recording nim as INCONCLUSIVE-ON-INSTRUMENT is HISTORICALLY CORRECT AND NO LONGER THE
STATE.** The lane's third predicate was built, pre-registered, and run by the Lead under its own lease — with
provenance verified **before** the run (instrument `sha256` matched the declared
`a6688e4f5f12189724b1545a9231f2b0fff53e83898a51dab37f8e021bb093e6` exactly, `53424dcfe` committed, tree clean
for that file):

    TWIN BUCKETS (pre-registered): REACHABLE 0 · UNREACHABLE 2,132 · UNDECIDABLE 0
    share = 0 / 2,132 = 0.0%      (NOT 0/0)

**0.0% ≤ 40% → "TWINS ARE WRONG" STANDS**, and because the share is **0/2,132** rather than **0/0**, the
pre-registered consequence follows: **the direction is earned on TWO languages** — nim **0.0%** and clean
**32.1%** — **rather than one.**

**THE THIRD PREDICATE SUCCEEDED AND THE PRE-REGISTRATION HAD SAID THERE WOULD BE NO FOURTH.** It did not need
one. The un-anchored predicate read **0%** because an INNER JOIN dropped the evidence; the file-anchored one
read **100%** because *"does this file have any unbound import"* is true for **2,018** rows; **this one is a
property of the specific row and the specific bound file** — and it produces a split with both sides populated.

**WITH THE LIMIT FIXED BEFORE THE RUN, which travels with the number**: REACHABLE requires a **BOUND** import
row whose target file **IS** the twin's bound declaration file — **the only case that is evidence rather than
possibility** — and that held **0 times**. UNREACHABLE is decidable from **name text**. **AND A NIM IMPORT
WRITTEN THROUGH A COMPUTED PATH MATCHES NOTHING AND LANDS IN UNREACHABLE**, so UNREACHABLE is an **upper**
bound on unreachability. **"0 of 2,132 twins bind to a file that a BOUND import reaches" is a strong decidable
fact; "all 2,132 are unreachable" is bounded in the direction that inflates UNREACHABLE. Both are true and
they are not the same statement.**

**AND THE RUN SETTLES NIM'S OTHER QUESTION**: `no candidate ANYWHERE 0` · **`NAME-SPACE LEVER PRICE 0`** (no
row where the edge's own file answers to the target while the store bound elsewhere or nowhere) · with
`scopedWouldMove 0` from the earlier run — **nim has NO ignored-own-declaration defect at all.** Its twins are
entirely **OTHER-FILE** bindings whose source cannot reach them, which is what the buckets now measure
directly. `boundNeedsLeafReduction 5` against hcl's **12,014** confirms why: **nim binds twins by FULL
SPELLING**, which is why it is the strongest population for this test — **and why its earlier 100% undecidable
reading was a property of that predicate rather than of the corpus.**

**AND TWO DEFECTS IN THE MEASURING INSTRUMENT WERE FOUND AND FIXED BEFORE ANY NUMBER WAS QUOTED.** The
refute column counted candidates carrying `.` segments that `foldProjectPath` folds away: **graphql 37 → 0,
scss 234 → 0, lua 12 → 0.** Those refutations were about **the probe's spelling, not the corpus** — and the
proof was independent: **the gate's own `extFAIL 0` on those lanes** said they were not real. **One
instrument falsifying another is the cleanest instance of this programme's own pattern.** The same defect
also **understated verify** (graphql 26 → 50, scss 366 → 469), so **a verify count from an unfolded
instrument is a LOWER BOUND** — stated in the artifact, in the direction that makes the numbers smaller.

**AND TWO REFUTE COLUMNS SURVIVE NORMALISATION AND ARE REAL**: r's **24** and fsharp's **11** name files
that **exist on disk and are NOT admitted** (r sources `.cpp`/`.h` from R code) — **precisely what the
guard's admitted-extension clause exists to refuse.** The guard is doing its job, measured rather than
asserted.

---

# UPDATE — the shared guard landed, and the check that caught the error that would have shipped

## LANDED: `src/ast/file-claim.ts` (`57aa3be79`)

Verified by the Lead before landing: `git apply --check` clean, self-test **15 pass / 0 fail** with every
clause carrying a case that would fail if the clause were dropped. It buys **3,921 verify / 0 refute**
across five lanes, priced before a single claim was emitted (4,386 files of 11,347, labelled stride sample;
protobuf 847 and clean 312 fully measured).

**The clause that took 392 refutations to 0 is INSIDE the guard**: the candidate must carry an extension
**the lane's own admitted list** holds. By shape alone, 392 edges would have refuted (zig 368, scss 24 —
`build.zig.zon` and `_all.sass`).

**ONE GUARD, THREE CANDIDATE RULES** — a shared arithmetic would have silently mis-bound clean, whose
targets are `Module:item` and not paths:
* **path fold** — protobuf, graphql, zig, json, toml, php
* **Sass partial/index spellings** — scss
* **module-to-file with the `:item` suffix stripped** (`<mod>.icl`/`<mod>.dcl`) — clean

**ADOPTION IS ASSIGNED AND NOT DONE**: `toml-lane` holds the four analyzers (protobuf, graphql, clean,
scss) plus its own two, one lane at a time with its own before/after. **First step it was given: re-run the
pricing with the REAL MODULE, not the probe that preceded it** — if the split moves, the module wins.

**Post-landing falsifier per lane**: re-price (VERIFY unchanged) → `extFAIL` stays 0 with `unresolved`
falling by about the ceiling → re-run the 15 controls. **A moving `extFAIL` means that lane's admitted list
is the first suspect.**

## THE NEW CHECK, now programme standard

> **FOR ANY CONTROL WHOSE KEY SPACE THE PROBER CONSTRUCTS, ASK WHERE THE KEY SPACE CAME FROM.** A control
> measures the instrument you built, not the one production runs.

`r-lane`'s `PROTO-D1` guard arm **passed every control it had armed** (delta 42, negative control clean,
prediction matched) and **still could not land**: the falsifier built the key space itself, adding
`s.qualifiedName` because the guard needed it. `project-index.ts:644/666/112` shows `symbolNames` holds
**bare** names and `nameResolver` is **node-only** — so `projectNames.has(candidate)` is false always, and
**in production the change binds ZERO.** *"The 42 is not wrong; its POPULATION is not production's."*

**Fifth instance of that lane's one error shape, and the FIRST that would have shipped.** The four earlier
ones were caught by checking a case against source; this one needed the question one level up.

## AND WHAT NOW EXPLAINS hcl's 229

    parallel-indexer.ts:1305  worker-pool batch  { skipResolution: true }   -> DEFERRED
    parallel-indexer.ts:1548  worker-pool chunk  { skipResolution: true }   -> DEFERRED
    parallel-indexer.ts:1323  final flush        { skipResolution: false }  -> EAGER
    + `contains` ALWAYS resolves eagerly.

**Production defers for the bulk, runs the eager select only on the final flush, and `contains` never
defers.** So `contains` resolves **at insert time, against a table still being built, by construction** —
which is exactly hcl's 229 (all `contains` rows bound away from a project-unique own-file declaration), and
it predicts the order-dependence lives mostly in `contains`: the arms showed **113/0/117 for `contains`** and
**0** for `references` and `exports` under file-order reversal.

**The two-arm run that tests it is the highest-value measurement left** — with the prediction fixed first:
`contains`-class violations should move under `BB_TEST_FORCE_EDGE_RESOLVE`, non-`contains` should not.

## THREE DEFECTS OWED BY THE LEAD, all now specified rather than described

1. **regex fallback rows** — caught and reported (`51b6282a1`); **firing not yet observed end-to-end**.
2. **the basic-parse population hole** — `engine.ts:1991` returns `symbols: [], relationships: []`, so a
   timed-out file contributes **NO EDGES**: it **deflates the population** and is invisible by construction.
   `degradedFiles` is already tracked by the gate (`:597`, `:728`, reported at `:1447`) — **the residual
   gate does not read it.** A residual column must state every instrument whose rows it contains **and every
   file that contributed none**.
3. **the shared resolver** — test populations isolated: hcl's **229** (predicate written out) and xml's
   **138**; control `store-determinism.mts`.

---

# UPDATE — the `contains` deferral is VERIFIED, and the ownership map the cap forced

## 1. `contains` ORDER-INDEPENDENCE IS MEASURED (r-lane, `78518a75c`)

The pair was taken with the discipline three incidents bought: `grep -c 'relType !== "contains"'` in
EACH worktree BEFORE measuring — `.wt-pre 893bfa7db` = **1** (clause present), `.wt-fix 71286549c` =
**0** (clause removed). `893bfa7db` is docs-only, so the two sides differ by the deferral and nothing
else.

    clause                    PRE     FIX    threshold   side
    contains A_vs_B (TARGET)  115  ->   0    <= 20       PASS, TO ZERO
    contains A_vs_C             4  -> 131    <= 10       FAIL
    bound A/B/C          9803/9803/9803 -> 9803/9803/9803   >= 9790   PASS, COMPLETENESS HELD

**`contains` no longer sees file order at all, and nothing was unbound.** The one failing clause is
**MIS-SPECIFIED rather than the fix**: it was written when `contains` resolved eagerly in ALL THREE
arms, so A and C were the same procedure and agreed. Post-fix, arm A defers and arm C forces the eager
select, so `A_vs_C` measures eager-against-deferred — **which is what the flag exists to show.** The 131
rows read `A (deferred) = the OWN FILE` against `C (forced eager) = ANOTHER FILE`: arm C reproduces the
pre-fix defect exactly.

**RE-SPECIFICATION AUTHORIZED WITH A CONDITION, because "`A_vs_C` large" is satisfied by a fix and by a
regression alike.** The new clause must add: **every diverging row shows arm A on the edge's OWN FILE
and arm C off it**, classified over all 131 rather than the four sampled. Without that it cannot fail.

**A PROGRAMME RULE WAS EARNED: a falsifier's meaning can be altered by the very change it tests.** When
it is: re-specify the falsifier, **RETAIN the pre-change result as the evidence for doing so**, and
**PRE-REGISTER the new floor** — because the two readings are "the fix broke something" and "the flag is
doing its job", and only the retained result separates them.

## 2. THE OWNERSHIP MAP — the teammate cap is 8, and this is what I did about it

**`spawn_teammate` refuses at 8 durable teammates.** The 75 figure is `maxActiveSubagents`, which
governs `subagent` and `workflow`, **NOT** the durable roster. **23 lanes therefore cannot each hold a
named durable owner**, and the mapping is recorded here rather than left to the names:

    r-lane        -> R               (own lane)
    json-lane     -> JSON + ZIG      (own lane + zig's claim/std-surface work)
    yaml-lane     -> YAML            (own lane; nearest to a fifth verified at 184)
    julia-lane    -> JULIA           (own lane, task-19)
    hcl-lane      -> HCL             (own lane)
    markdown-lane -> BASH            (REASSIGNED — markdown's coverage half was done)
    toml-lane     -> PROTOBUF        (REASSIGNED — toml verified; it priced protobuf's ceiling itself)
    clean-lane    -> SCSS            (REASSIGNED — clean done, xml verified)

    the other 15 lanes run as SUBAGENTS (addressable, up to 75 concurrent), not durable owners:
    dart · sql · make · lua · graphql · nim · php are in flight as this is written.

**The cost is real and stated rather than glossed: for those 15 lanes there is no persistent member to
message in a future session.** What survives is the record — every lane's state, causes, counts and
falsifiers live in `validation/m14/results/` and its own `docs/analyzers/<lane>.md`, which is what a
future session actually reads.

## 3. THE POPULATION DISCLOSURE IS NOW IN THE INSTRUMENT LANES RUN (`2536dde2c`)

`residual-gate.ts --lane` opened with `WHOLE admitted population, production scope` **unconditionally**,
while `incoming-gate.ts` already disclosed a stride sample, degraded rows, and files that returned
nothing. It now **reads** the run: the scope line changes for a sample, for a holed/degraded population,
and for an instrument that printed no population line at all (UNSTATED, not assumed clean), plus a
POPULATION block and the same fields in `--json`.

**AND A 0-BYTE FILE IS NOT A HOLE.** The same conflation was pre-existing in `incoming-gate.ts:1476`,
which announced "the population is INCOMPLETE" over `_library.dcl`, `_startup.dcl` and `_system.dcl` in
clean-stdlib — three files that are **0 bytes**, where the truth is the opposite: nothing was missed.
Both are fixed; the classifier lives ONCE in `script/m14/empty-result-kind.ts` with a 12-arm control
that imports the SHIPPED module and carries a regression pin on those three files.

**The first fix for that was ALSO wrong, and how it was wrong is the lesson**: it classified the files a
second time inside `residual-gate.ts`, and because the instrument prefixes each name with `HOLE  ` or
`empty `, the copy read `"empty /path"` as a PATH, failed to open it, and reported the three files as a
HOLE. **Two copies of one classifier, diverged on their first run.** The published measurement is
unchanged — clean still reads `WHOLE admitted population, production scope`, which it always was.

**The hole branch has NOT been observed firing end-to-end on a real run** (it needs an actual parse
timeout under load). Stated, not implied — the same debt the FALLBACK ROWS disclosure carries.
