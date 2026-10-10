# fsharp — lane verdict page

Lane: `fsharp` (engine language id `fsharp`, corpus extension `fs`). Owner: **fsharp lane**.
The analyzer's own long-form doc is [`real-fsharp-analyzer.md`](real-fsharp-analyzer.md), which is
read-only for this page's author; this page records **verdicts and their measurements**, not the
analyzer's design.

Corpus: the 26 git repositories under `$HOME/fixtures/repositories` that carry F#.
Whole-population runs: 10,138 git-tracked `.fs` files (arbiter arm, this page's split) and the
11,807-file corpus dump that carries `.fs`/`.fsi`/`.fsx`.

**Every figure below declares its population and its instrument**, because two instruments disagree
about this lane's totals and the disagreement is itself a finding (§1).

---

## 1. The baseline in the brief is the ARBITER's, and the residual gate reads differently

The lane brief carries `1,199,871 edges · 276,097 ambiguous · 370,867 unresolved · 53.9% residual`,
and reads it as *"unresolved exceeds ambiguous, so the dominant question is targets that name
nothing"*. Both halves of that need a correction, and both are measured:

| instrument | edges | resolved | amb(decl) | unresolved | residual |
|---|---:|---:|---:|---:|---:|
| `npx tsx script/m14/residual-gate.ts --lane fsharp` (whole admitted population, production scope) | **1,307,442** | 549,197 | **385,465** | **372,780** | **58.0%** |
| `bun validation/m14/fixtures/fsharp/fs-unresolved-split.mts 0`, REPLICA arm (the arbiter's own columns reproduced) | 1,199,871 | 552,907 | 276,097 | 370,867 | 53.9% |

Artifacts: `measurements/residual-gate-fsharp.txt`, `measurements/fs-unresolved-split-full.log`.

Two things follow, and neither is a rounding:

1. **The instrument matters more than the number here.** Same lane, same day: edges differ by
   **107,571** and `amb(decl)` by **109,368**. The residual gate admits a wider population than the
   arbiter's `.fs`-only arm. A lane figure quoted without its instrument is not comparable with the
   other arm, and this page quotes both rather than choosing the flattering one.
2. **The brief's premise is reversed at the current tree.** The brief has unresolved exceeding
   ambiguous (370,867 > 276,097). At the residual gate — the instrument the brief told this lane to
   start with — ambiguity exceeds unresolved (385,465 > 372,780), and ambiguity is the column that
   grew. So *"the dominant question is not collisions"* does not hold for the instrument named in
   the same brief.

`contains` is the one type this lane no longer has a question about, and that confirms the brief's
instrument note: after `fa2dc27e8` reclassified it by production's real resolver,
`contains` reads **208,677 edges, 208,668 resolved, 0 ambiguous, 9 unresolved — residual 0.0%**.

**NOT RUN, reported as such:** neither run was killed. Both completed (`GATE_EXIT=0`,
`SPLIT_EXIT=0`) under `.bb-heavy-v2.lock`; loads are recorded in the artifacts.

---

## 2. CAUSE #1 — the unresolved column is the EXTERNAL LIBRARY SURFACE, not broken edges

The residual gate's own marker-set grouping answers *what the edges share*; for the unresolved
column the answer is that they share a **target the edge's own project does not declare**. The
split below is the whole 370,867, bucketed by *whose* project declares the target's exact spelling,
measured against a key space built from every admitted file of every repository (121,369 distinct
names, 181,553 distinct qualified names).

| bucket | edges | share |
|---|---:|---:|
| **cross-project-exact** — the spelling is declared, but only in OTHER repositories | **201,618** | **54.4%** |
| in-corpus-owner — the target's OWNER segment is declared somewhere | 84,857 | 22.9% |
| nowhere-in-corpus — declared in no repository at all | 60,836 | 16.4% |
| in-corpus-leaf-only — only the final segment is declared | 14,507 | 3.9% |
| **same-project-exact** — the edge's OWN project declares the exact spelling | **9,049** | **2.4%** |

Artifact: `measurements/fs-unresolved-same-project-split.txt`.

**The top targets say what the mass is.** Cross-project-exact is led by `should` 14,390 · `Fact`
11,655 · `Some` 8,013 · `Test` 5,974 · `Extension` 5,733 · `not` 5,449 · `ignore` 4,613 ·
`shouldEqual` 4,080 · `Seq.map` 3,790 · `List.map` 3,694 · `equal` 2,561 · `Obsolete` 2,476, and
"nowhere-in-corpus" is led by `Theory` 3,061 · `InlineData` 1,996 · `System.Threading.Tasks` 1,424 ·
`Does.Contain` 595 · `shouldContainText` 525 · `Sealed` 482. These are **FSharp.Core, xUnit/FsUnit
and BCL names** — `should`, `Fact`, `Theory`, `InlineData` are test-framework vocabulary, not
project declarations.

**And they are "in corpus" at all only because the corpus contains the compiler.**
`fsharp` is 6,626 of the 11,807 dumped files: the repository that *is* the F# compiler ships
FSharp.Core's own sources and its own test-suite idioms, so `ignore`, `Some`, `Seq.map` and
`shouldEqual` are declared somewhere in the corpus. For Argu, Grace, Paket, Deedle or Fantomas,
they are **outside the project**, and production resolves per project.

**RULING: LEGITIMATE — instrument scope, not a defect.** An edge inside project P naming a
declaration P does not publish is *correctly* unresolved for that edge; the arbiter is
project-scoped by design, and the `in-corpus-*` buckets exist only because the corpus is a
26-project union rather than the project. **286,475 of 370,867 (77.3%)** are in the two
"declared somewhere else" buckets and **347,311 (93.7%)** name something the edge's own project
does not declare. This is the same shape as LUA-G6 in the lua lane, at 2.7× the share.

**No external marker is emitted for it, and the lane's own history is why.** `FS-P8` shipped an
`external` claim and was RETIRED (2026-10-09) after measuring the blanket rule at **28.0% verified /
72% refuted** — a single file cannot support a corpus-wide claim, and a bare identifier target has
no owner for the gate's owner-lookup, so the claim would land in `ext?` (unverified) and block a
pass without reducing the column (see `real-fsharp-analyzer.md` §19.3). This measurement does not
reopen that; it sizes the class the retirement left unclaimed.

**FALSIFIER, so this ruling can fail:** the bucketing rests on a membership test that must be able
to answer both ways, and the instrument asserts it before printing — a name the compiler repo really
declares IS in its set, a fabricated name is in NO set, and a BCL name carried only by the compiler
repo is NOT declared by `Argu`. All three hold (`CONTROL PASSES`, in the artifact). If a later run
shows `same-project-exact` growing far beyond 2.4%, this ruling is refuted and the external-surface
reading becomes the wrong one.

---

## 3. The actionable remainder, named for the next pass

**`same-project-exact` = 9,049 edges (2.4%)**: the edge's own project declares the target's exact
spelling and the edge still did not resolve. That is the only class here that can be worked on, and
it is small enough to finish.

By type: `calls` 5,615 · `uses` 1,619 · `references` 1,227 · `imports` 377 · `implements` 156 ·
`extends` 28 · `instantiates` 14 · `contains` 9 · `overrides` 2 · `exports` 2.
By the analyzer's own resolution class: `bare-external` 4,068 · `external-type` 1,034 ·
`external-type-or-module` 2,103 · `external-namespace` 754 · `receiver-value` 479 ·
`local-binding` 363 · `module-member` 120 · `call-chain-receiver` 121 · `base-member-external` 2 ·
`published-identity` 11.

Two shapes inside it are already visibly wrong and are not explained by scope, so they are the
first things a next pass should look at rather than the last:

- **`published-identity` 11** — REFUTED as a wrong identity; it is a SHARED-MACHINERY seam. See §4.
- **`local-binding` 363** — the class `real-fsharp-analyzer.md` §19.3 prices: the target IS a local
  of the callable, and the fix the lane named (the `localBinding` claim) requires the target
  spelling `<callable>#<binding>`, because `verifyBindingClaim` REFUTES a marked edge whose target
  carries no separator. That change lands in this lane's analyzer but its oracle
  (`script/m14/fsharp-truth-oracle.ts`) derives the bare spelling, so taking it here would convert
  this lane's own differential rows into MISSING-plus-fabrication until the oracle learns the same
  spelling. **Named, sized, and deliberately not taken in the pass that found it.**

---

## 4. `published-identity` 11 — the premise is REFUTED, and the defect is a SHARED-MACHINERY seam

The brief called these *"a member identity ending in the keyword `this` … visibly wrong regardless
of scope"* and asked for the one-line fix. **The identity is not wrong, and the fix is not in this
lane.** Both halves are measured.

**1. `member this` is legal F# and is declared in this corpus.** `JS.this` is not a mis-derived
identity — the source declares a member whose NAME is `this`:

```fsharp
(* core/src/stdlib/WebSharper.StdLib/JavaScript.fs:69-70 *)
    /// The JavaScript "this" value.
    [<Inline "this">]
    static member this = X<obj>
```

`fsharp/tests/service/data/SyntaxTree/Member/Member 02.fs:5` is the same shape (`[<B>] member this`).
A rule of the form "a member identity ending in `this` is wrong" would delete real members.
`As 03.fs` (`type T as this = class end`) is a different fact — there `this` is a SELF-IDENTIFIER, not
a member — and it is the one shape in the 11 that is arguably mis-minted.

**2. The defect is that the SYMBOL is dropped and the EDGE that names it is not.** Measured by
calling the analyzer directly against production on the same bytes:

| file | `analyze()` symbols | `parseFile` symbols | edges kept |
|---|---|---|---|
| `SyntaxTree/Type/As 03.fs` | `Module`, `this<Module>` | `Module` only | `contains Module -> Module.this`, `exports Module -> Module.this` |
| `SyntaxTree/Member/Member 02.fs` | `Module`, `T<Module>`, `P1<T>`, `this<T>` | one fewer | `contains Module.T -> T.this` |

`parseFile` filters every symbol through `keepSymbol` (`src/ast/pool-worker.ts:1099`), whose
`UNIVERSAL` set drops `"this"` and `"super"` **unconditionally**, with this comment at
`pool-worker.ts:545-548`:

> `// Reserved in essentially every language parsed here. Kept unconditionally`
> `// because no lane produced a legitimate declaration of any of them.`

**That comment now has a counterexample, and the same file records the procedure for one**
("REMOVED, each with a lane and a count" — `self`/`Self` were deleted for R/Python/Zig by exactly
this route). Relationships are not filtered by `keepSymbol` and cannot be: the filter is
symbol-shaped. So the symbol is dropped and the edge survives, naming nothing.

**3. The class is small, and it is measured rather than extrapolated.**
`probe-dangling-contains-targets.ts` walks a 2,000-file even stride of the 10,138-file `.fs`
population (4 workers, 0 degraded, 0 failed, load 12.67 at start) and tests the invariant the
analyzer's own `contains` pass states — *the target is always an identity THIS FILE minted* —
against what `parseFile` actually returned:

```
contains+exports edges seen: 49990
DANGLING: 4   (0.01%)      by target: T.this:3  FSharpMemberOrFunctionOrValue.this:1
```

Artifact: `measurements/dangling-contains-targets.txt`. The whole-population `published-identity`
bucket is 11 of 370,867, so the two readings agree on the size: this is a **correctness** defect,
not a volume one.

**4. WHY NO LANE-SIDE FIX IS TAKEN, and what the fix is.** Suppressing the edges in this analyzer
would delete a real member's containment from the graph and leave the symbol filtered anyway — the
member is lost either way, and the only choice left is whether the graph also carries an edge that
points at nothing. The defect belongs where the asymmetry is, in shared machinery
(`src/ast/pool-worker.ts`, outside this lane's write scope):

- **Fix A (preferred, one line):** drop `"this"`/`"super"` from `UNIVERSAL` and move them to the
  per-language `RESERVED` table for the languages that actually reserve them — the mechanism already
  exists (`RESERVED[lang]` at `pool-worker.ts:575-582`) and is documented as the route for this.
- **Fix B (invariant):** if a symbol is filtered, filter the relationships that name it too, so the
  graph can never carry an edge to a symbol the consumer did not receive.

**Fix B is now LANDED** (see §5). **Fix A (the `UNIVERSAL` set) is measured in §5.3 and left owed**
with the enumeration its own criterion asked for.

---

## 5. Fix B LANDED — the dropped-symbol invariant, and what it does NOT cover

`src/ast/pool-worker.ts` now drops, with a symbol, every relationship whose endpoint names an identity
that symbol had. The rule is one-directional: an edge goes only when an endpoint string equals an
identity this call dropped **and no kept symbol still publishes that identity**, so nothing is lost
for a symbol the consumer did receive.

**The first cut was INERT, and the reason is worth recording.** `keepSymbol` filters on the symbol's
`name` (`this`), while a containment edge names its published identity (`Module.this`, the symbol's
`metadata.fqn`). A drop-set keyed on `name` alone held `this`, the edge said `Module.this`, nothing
matched — and the probe reported "no change" on the very files the fix was written for. The set is now
built from every identity `ret.symbols` can publish (`name`, `qualifiedName`, `metadata.fqn`, and the
same derived `qualifiedName` expression, so the two cannot drift).

### 5.1 Controlled before/after, on the exact files

Everything else identical, `pool-worker.ts` restored from `HEAD` and hash-verified back
(`sha256 8a5c2e97…`); the count is `parseFile`'s own, because the invariant is about what the consumer
receives:

| file | edges naming a dropped identity, `HEAD` | with the fix |
|---|---:|---:|
| `fsharp/…/SyntaxTree/Type/As 03.fs` | **2** (`contains`, `exports` → `Module.this`) | **0** |
| `fsharp/…/SyntaxTree/Member/Member 02.fs` | **1** (`contains` → `T.this`) | **0** |

A first attempt at this measurement was WRONG and is recorded so the mistake is not repeated: it
compared a `.fs`-only 2,000-file draw (before) against a `.fs/.fsi/.fsx` 2,000-file draw (after) and
reported "4 → 0" as though the fix had done it. Re-running the SAME draw with the filter restored to
`HEAD` also read 0 — that draw simply did not contain the affected files. A before/after over two
different draws is not a before/after.

### 5.2 Fleet-wide verification, back-to-back, same draws

`probe-dangling-contains-targets.ts --langs fsharp,php,julia,lua,css --files 600`, run twice with only
`pool-worker.ts` changed between them (one unrelated css commit landed during the pair; css is
unchanged, so it confounds nothing):

| language | containment edges before → after | DANGLING before → after | delta |
|---|---|---:|---:|
| fsharp | 14,118 → 14,118 | 0 → 0 | 0 |
| php | 3,626 → 3,626 | 0 → 0 | 0 |
| **julia** | 5,176 → 5,175 | **681 → 680** | **−1** |
| **lua** | 10,937 → 10,934 | **618 → 615** | **−3** |
| css | 137,028 → 137,028 | 0 → 0 | 0 |
| TOTAL | | **1,299 → 1,295** | **−4** |

So the fix is **not** inert outside F#: it removes 1 julia edge and 3 lua edges — those lanes do mint
symbols the `UNIVERSAL` set drops, and their edges were dangling for the same reason. php and css are
untouched.

**AND THE REMAINING 1,295 ARE A DIFFERENT DEFECT, which is the larger finding.** Only 4 of the 1,299
were the dropped-symbol seam; the other **1,295 (julia 680, lua 615) name something that was never a
symbol identity at all** — `exports GLM -> coef`, `exports GLM -> coeftable`,
`exports global -> /tags/:tags`, `filetypes:78`, `cmd:77`, `root_markers:72`. No symbol was dropped for
those, because no such symbol ever existed to drop, so the invariant has nothing to remove. They are an
`exports`-contract violation (an exported name no published symbol answers), 324× the size of the seam
fixed here, and this pass deliberately did not widen the invariant to cover them — a mechanical drop
rule cannot repair an edge that was wrong at the moment it was minted. Routed to julia and lua.

### 5.3 Fix A is MEASURED and left owed — the criterion is satisfied, the coverage is not

`probe-universal-dropped-symbols.ts` reads `engine.parseFile`, which does NOT filter (`engine.ts:2102`
returns symbols verbatim), so the dropped set is observable without changing the code under test. Over
an even-stride 400-file draw of EIGHT languages (fsharp, php, julia, lua, css, clean, python, ruby —
3,200 files, ~184,000 symbols, 0 failed):

| language | symbols | symbols named `this`/`super`/synthetic |
|---|---:|---:|
| fsharp | 8,983 | **1** — `this`, kind `variable`, owner `FSharpMemberOrFunctionOrValue` |
| lua | 9,895 | **1** — `super`, kind `variable`, `luvit/tests/test-colors.lua` |
| php · julia · css · clean · python · ruby | 2,799 · 6,958 · 136,210 · 8,285 · 6,798 · 5,190 | 0 each |

**TWO hits in 3,200 files, and BOTH are legitimate declarations** — the F# `member this` of §4, and a
Lua `local super`. So for these eight languages the criterion's answer is: nothing needs `this`/`super`
kept in `UNIVERSAL`, and nothing needs them added to a per-language `RESERVED` either, because the only
symbols they name are real.

**Left owed, deliberately.** The fleet has ~23 lanes and this draw covers eight; the same enumeration
must be run for the rest before the `UNIVERSAL` set is edited, because a name removed there is
published in EVERY language at once. Recording the criterion and its partial answer is the whole point
of the exercise: the next pass inherits a measurement, not a guess. The invariant in §5 is worth more
than the handful of edges a name-set change would recover, and it is already landed.

### 5.4 Regression checks on shared machinery

- **Fixtures, five lanes, all green**: fsharp 15/0 · julia 5/0 · lua 13/0 · php 30/0 · css 22/0.
- **`npx tsc --noEmit`: exit 0, no errors.** The `real-php-analyzer.ts(2432,7)` error recorded earlier
  was fixed by the php lane in the meantime.

---

## 6. `local-binding` — the population is ≈35,559, not 363, and the class is CORRECT

§3 sized this class at **363 edges**. That number is real but it is a SUB-BUCKET: the
`same-project-exact` slice of the whole-population unresolved split. The population the binding claim
would actually re-spell is the analyzer's own `local-binding` classification, and that is **100×
larger**:

| measurement | count |
|---|---:|
| `calls` edges in a 400-file even-stride draw | 26,485 |
| of those, `metadata.targetResolution === "local-binding"` | **1,403** |
| scaled to the 10,138-file population | **≈ 35,559** |
| the whole-population `same-project-exact` slice of it (§3's number) | 363 |

Artifact: `measurements/local-binding-size.txt`. **The correction is mine to state**: I briefed 363,
and the change it authorises touches ~2.7% of every fsharp edge in the graph and changes what those
edges NAME. That is a consumer-visible identity change and deserves the larger number.

**The classification is CORRECT, spot-checked on its own examples** — this matters because a claim
that verifies by construction is only worth what its class is worth:

| edge | source check |
|---|---|
| `dataLoader -> asIndex` (Deedle `VirtualFrame.fs`) | `let asIndex (dt:DateTimeOffset) = …` at :1034, called at :1035 |
| `JsonTypeBuilder.getOrCreateType -> normalize` | `let rec normalize topLevel = …` at :163, called at :167/172/179/190 |
| `TrackingSource.LookupValue -> asLong` | `let asLong = match asLong with …` at :88, called at :93 |

Each names a genuine binding that has no symbol, which is exactly what the claim asserts.

**WHY THE CLAIM VERIFIES BY CONSTRUCTION, said out loud.** With the `<callable>#<binding>` spelling
the target names no declaration, so `classifyEdge`'s `decls > 0 → bindingRefuted` branch cannot fire,
and `verifyBindingClaim` sees the separator, so the claim verifies. The claim therefore checks *"is
this spelled as a binding?"*, not *"is it really one?"* — its value rests entirely on the class being
right, which is why the table above exists. That is the file's own design ("the separator is the
fix's whole mechanism… to make a spelling that lost it impossible to pass quietly"), not a loophole
invented here.

### 6.1 The differential baseline, and what it can see

`bun run script/m14/differential.ts --lang fsharp` — **MISSING=10, unexplained=69 (calls=68,
instantiates=1)** over 60 files / 3,136 analyzer edges, `hash=2143f8bdc90fe3f1`. Artifact:
`measurements/differential-before.txt`. The scoped run writes **no** shared artifact (`M14.0.F5 NOT
written`, and `M14.0.F5.fsharp.json` is untouched).

The sample is large enough to see the change: ~1,403 local-binding calls per 400 files is **≈ 210 at
60 files**, matching the 207 this lane's own doc recorded for the same shape. So a before/after with
MISSING and unexplained UNCHANGED is a real test, not a vacuous one.

### 6.2 What remains, and why it is not in this commit

The analyzer side is small: at the `calls` emission sites, a resolution of `local-binding` spells
`<source>#<binding>` and sets `metadata.localBinding = true`. The ORACLE side is the work — it must
derive the same spelling **independently from source** (its `emit("calls", owner, leaf, node)` writes
the bare leaf today, and a spelling taken from the analyzer's output would make the differential a
tautology). Landing the analyzer half alone would convert ~210 differential rows into
MISSING-plus-UNEXPLAINED, which is strictly worse than leaving them unnamed — the same conclusion §3
reached, now with the population measured and the class verified rather than assumed.

### 6.3 The staged plan's step 1 CANNOT be inert — the differential's own matcher says so

The approved order is: oracle first, as an *inert* step with MISSING and unexplained unchanged, as
proof the oracle derives the right spelling before any analyzer edge is re-spelled. **That
expectation is impossible**, and it is not an argument — `normTarget` is EXPORTED from
`script/m14/differential.ts`, so the two match predicates can be run against the real functions
(`measurements/binding-respell-matching.txt`, instrument
`probe-binding-respell-matching.ts`):

```
MISSING      rels.some(r => r.label === te.label && normTarget(r.target) === normTarget(te.target))    // :24217
unexplained  truth.some(te => te.label === r.label && (normTarget(te.target) === normTarget(r.target)
                                                        || te.target.includes(normTarget(r.target)))) // :24230
```

`lastSegment` splits on `::` and `.` only — **not** `#` — so `normTarget("dataLoader#asIndex")` is
`"dataLoader#asIndex"` while `normTarget("asIndex")` is `"asIndex"`. The two predicates then behave
oppositely:

| step | truth | analyzer | MISSING | unexplained |
|---|---|---|---|---|
| 1 — oracle re-spells, analyzer unchanged | `dataLoader#asIndex` | `asIndex` | **YES** | **no** |
| 2 — analyzer flips | `dataLoader#asIndex` | `dataLoader#asIndex` | no | no |

Step 1's `unexplained` cannot move because of the *asymmetry in the second predicate*: the analyzer
side also matches when the TRUTH target merely CONTAINS the analyzer's normalized target, and
`"dataLoader#asIndex".includes("asIndex")` is true. Step 1's `MISSING` cannot stay put because the
first predicate is an exact equality on the normalized target.

**So the corrected, falsifiable signature is:**

- **Step 1 (oracle only):** `MISSING = 10 + N`, `unexplained = 69` **unchanged**, where `N` is the
  number of truth rows the oracle re-spells in the 60-file sample. That `N` is itself the
  measurement — it is how much of the class the oracle independently finds.
- **Step 2 (analyzer flips):** `MISSING` returns to **10**, `unexplained` stays **69**.
- **A step-1 run reading MISSING UNCHANGED would mean the oracle's derivation is not firing at
  all** — a bug, not a pass. The original criterion would have read the correct behaviour as
  failure.

The CONTROL in the probe keeps that from being a constant: identical bare spellings on both sides
report "covered and explained", so the predicates can answer both ways.

---

## 7. Step 1 LANDED — the oracle derives the binding spelling (inert by construction? no: by measurement)

`script/m14/fsharp-truth-oracle.ts` now spells a `calls` target `<callable>#<binding>` when its own
walk finds the callee to be a LOCAL. The set is built by that walk from this file's own `let`s and is
deliberately not read from the analyzer: a spelling copied from the side it exists to check would make
the differential a tautology.

**The measured signature, against the corrected criterion:**

| | baseline | step 1 | expected |
|---|---:|---:|---|
| `MISSING` | 10 | **93** | `10 + N` |
| `unexplained` | 69 | **69** | unchanged |
| `analyzer-edges` | 3,136 | **3,136** | unchanged (no analyzer change) |
| sample hash | `2143f8bdc90fe3f1` | `2143f8bdc90fe3f1` | same draw |

**N is counted independently, not read off the delta.** `count-local-binding-truth.ts` re-derives the
oracle's truth over the harness's OWN 60 files (printed under `BB_F5_SHOW_FILES=1`, and the probe
refuses to run if the log's hash is not the harness's):

```
sample: 60 files listed, 60 parsed   (hash 2143f8bdc90fe3f1 verified in the log)
oracle truth edges on this sample: 5467      <- matches the differential's own tree-truth=5467
of which carry BINDING_SEP ('#'): 83   <= N
```

So `MISSING − 10 = 83 = N`. The derivation is FIRING — which, under the corrected criterion, is the
pass; under the original one it would have been read as failure.

Artifacts: `measurements/differential-step1.txt`, `differential-step1-files.txt`,
`local-binding-truth-count.txt`.

**THE TWO FACTS A FUTURE `#`-SPELLING LANE WILL HIT** (§6.3, and here because they belong where the
next reader is, not only in a thread):

1. **`lastSegment` does not split on `#`.** `normTarget("dataLoader#asIndex")` is
   `"dataLoader#asIndex"`, not `"asIndex"` — the normalizer splits on `::` and `.` only. Any lane
   that adopts a separator spelling changes its coverage arithmetic the moment it does.
2. **The `unexplained` predicate has a containment arm.** It matches when the TRUTH target merely
   *contains* the analyzer's normalized target, so `"dataLoader#asIndex".includes("asIndex")` keeps a
   bare analyzer edge explained. That asymmetry is why step 1 can move `MISSING` and cannot move
   `unexplained` — and it is also why an oracle-only mistake is visible on one side only.

**N = 83 against an analyzer class of ≈210 at this sample size** (from §6's 1,403-per-400-files
scaling) says the two rules already disagree by a factor of ~2.5 before step 2. Step 2 will therefore
NOT return `MISSING` to exactly 10, and that residue is the finding: the oracle's scope-derived rule
versus the analyzer's file-wide `localNames`. §8 records it.
