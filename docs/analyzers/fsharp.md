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

- **`published-identity` 11** — `contains JS.this`, `exports JS.this`, `exports Module.this`,
  `contains new T.this`, `contains T.this` (`core/src/stdlib/WebSharper.StdLib/JavaScript.fs`,
  `fsharp/tests/service/data/SyntaxTree/…`). A member identity whose final segment is the keyword
  `this` is not a name the project can declare, and the edge's own file is where the identity was
  built.
- **`local-binding` 363** — the class `real-fsharp-analyzer.md` §19.3 prices: the target IS a local
  of the callable, and the fix the lane named (the `localBinding` claim) requires the target
  spelling `<callable>#<binding>`, because `verifyBindingClaim` REFUTES a marked edge whose target
  carries no separator. That change lands in this lane's analyzer but its oracle
  (`script/m14/fsharp-truth-oracle.ts`, outside this lane's write scope) derives the bare spelling,
  so taking it here would convert this lane's own differential rows into MISSING-plus-fabrication
  until the oracle learns the same spelling. **Named, sized, and deliberately not taken.**
