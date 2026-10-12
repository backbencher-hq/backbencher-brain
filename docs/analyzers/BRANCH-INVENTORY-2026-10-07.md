# Branch inventory and lane recovery — 2026-10-07

Status: **authored record.** This is not machine-emitted evidence; it is the note that
says where the lane work went, what is on `origin/main` today, and how to get back
anything that is not. Numbers are quoted from the runs named beside them.

Audience: whoever deletes the 457 remote refs, or whoever picks up a lane that main
does not satisfy.

---

## 1. Why deleting branches loses nothing

Every remote ref that existed on 2026-10-07 is an ancestor of one annotated tag:

```
tag    archive/all-lanes-2026-10-07
object e352e4f4e6e6fe163ce3254b8b057dd7a8bbea66   (pushed)
peels  to 7fdbd1ad3f394a9bf785f3d7ec657644e0e35e47
```

The tag's commit was built with `git commit-tree origin/main^{tree} -p <tip>` over
**266 distinct remote tips** (457 refs total; the rest are names for the same commits,
the `origin/laptopA/*` mirrors included). Measured coverage, re-run at the time of
writing:

```
$ git for-each-ref --format='%(refname)' refs/remotes | while read -r r; do
    git merge-base --is-ancestor "$r" archive/all-lanes-2026-10-07 || echo "NOT COVERED $r"
  done | wc -l
0
```

So any branch's tree is recoverable without the branch:

```
git fetch --tags origin
git ls-tree -r archive/all-lanes-2026-10-07 -- src/ast/real-c-analyzer.ts
git show  archive/all-lanes-2026-10-07:src/ast/real-c-analyzer.ts > /tmp/c.ts
git log  --oneline archive/all-lanes-2026-10-07 -- src/ast/real-groovy-analyzer.ts
```

The pre-rewrite line of `main` is separately preserved as
`origin/backup/pre-rewrite-main-local` (`00a28e357`). The author rewrite that landed
before it was reconciled content-identically: `git diff 00a28e357 f07908bc6` and
`git diff 8f4cc6980 dd36e9a42` are both empty, so the rewrite moved metadata, not
code.

## 2. What main carries per lane, and what was measured against it

Main carries one whole-file analyzer revision per language (a compiler-verified union
of two or three revisions for eight of them). For every lane that has failing pins, the
whole-file alternatives were **run against that lane's own pins**: each candidate blob
was written to the analyzer path, the lane was run scoped (`--lang`, which writes no
evidence and cannot touch the baseline), and the passing/failing pin sets were compared
with the revision main carries. Candidates are the five newest distinct revisions of the
file; the lanes have 9–70 distinct revisions each, so the sweep is a scan of the newest
five, not of the whole population.

Decision rule applied: a candidate was landed only when it satisfied more pins **and
broke none** of the pins main satisfies. Two revisions passed that test.

| lane | analyzer on main came from | distinct revisions in refs | best tested alternative | pins passing | declared failures |
|---|---|---|---|---|---|
| c | analyzer/C_FIX3 | 58 | `723889099` (…42/46, 2026-10-07) | 42/46 | 4 |
| cpp | analyzer/CPP_FIX | 49 | `ebbc542eb` (…29/47, 2026-10-06) | 41/47 | 6 |
| csharp | analyzer/CORPUS_CS3 | 38 | `7acb65bec` (…23/24, 2026-10-03) | 20/24 | 4 |
| elixir | analyzer/ELIXIR_FIX3 | 31 | `56ca3c2fa` (…65/82, 2026-10-06) | 65/82 | 17 |
| go | analyzer/VERIFY_GO9 | 33 | `be8cd2e6a` (…28/31, 2026-10-04) | 29/31 | 2 |
| graphql | `139507928` (**landed 2026-10-07**: was 1/5) | 11 | `139507928` (…5/5, 2026-10-05) | 5/5 | 0 |
| groovy | analyzer/DERIV_EXPORTS_GROOVY3 | 47 | `9d00d7b6b` (…60/81, 2026-10-03) | 61/81 | 20 |
| html | union of analyzer/VERIFY_HTML6, analyzer/HTML_FIX2, analyzer/HTML3 | 14 | `a40d79ee6` (…13/18, 2026-10-05) | 17/18 | 1 |
| java | analyzer/ENDPOINT_RESOLVE_JAVA | 53 | `05d47b2f9` (…52/63, 2026-10-05) | 52/63 | 11 |
| kotlin | analyzer/DERIV_EXPORTS_KOT4 | 50 | `3caaea1c4` (…53/63, 2026-10-07) | 57/63 | 6 |
| lua | (no entry in the union ledger) | 27 | `2aeb9252c` (…10/13, 2026-10-06) | 10/13 | 3 |
| make | (no entry in the union ledger) | 9 | `3e4f100c0` (…8/10, 2026-09-30) | 8/10 | 2 |
| objc | analyzer/DERIV_EXPORTS_OBJC | 23 | `f7b04c525` (…15/16, 2026-10-04) | 11/16 | 5 |
| perl | analyzer/CORPUS_PERL3 | 28 | `9d3823d6d` (…20/22, 2026-10-03) | 14/22 | 8 |
| python | union of analyzer/PY_INSTRUMENTS, analyzer/VERIFY_PY10, analyzer/CORPUS_PY3 | 51 | `6601d45a9` (…23/35, 2026-10-07) | 25/35 | 10 |
| ruby | `5d5269a4f` (**landed 2026-10-07**: was 9/11) | 28 | `cfc50deca` (…10/11, 2026-10-06) | 10/11 | 1 |
| rust | analyzer/R7_AUDIT_FLEET | 34 | `8eb79989e` (…26/30, 2026-10-05) | 27/30 | 3 |
| scala | analyzer/DERIV_EXPORTS_SCALA4 | 67 | `5f7cf3cbd` (…66/76, 2026-10-07) | 71/76 | 5 |
| scss | (no entry in the union ledger) | 11 | `96805a8ac` (…11/13, 2026-10-05) | 12/13 | 1 |
| svelte | analyzer/VERIFY_SVELTE9 | 31 | `a377915f2` (…41/52, 2026-10-07) | 43/52 | 9 |
| swift | union of analyzer/DERIV_EXPORTS_SWIFT, analyzer/DERIV_EXPORTS_SWIFT3 | 28 | `4144e2b01` (…17/21, 2026-10-07) | 17/21 | 4 |
| typescript | union of analyzer/AMBIGUITY_SWEEP, analyzer/VERIFY_TS10, analyzer/TS_FIX2 | 70 | `b0415dba3` (…95/102, 2026-10-06) | 97/102 | 5 |
| vb | union of analyzer/GRAMMAR_FIX_VB | 16 | `351b846e5` (…1/4, 2026-10-07) | 1/4 | 3 |
| vue | union of analyzer/VERIFY_VUE8, analyzer/VUE_FIX | 22 | `5f95f4e6e` (…56/60, 2026-10-04) | 55/60 | 5 |

Reading the fourth column: for csharp, `7acb65bec` satisfies 23 pins to main's 20 — but
it breaks `public-type-exports`, a pin main satisfies, so it was not landed. The same
shape holds for objc (`f7b04c525`, +5 covered, −1 broken), perl (`9d3823d6d`, +7, −1),
scala, groovy, vue, java and the rest: **no tested alternative revision dominates what
main carries.** That is the justification for keeping main's choice, and it is a
measurement, not a preference.

The two revisions that did dominate:

* **graphql** `139507928` — `fix(m60): graphql an unnamed operation is published under…`
  Takes the lane from 1/5 to 5/5, breaking nothing. `npx tsc --noEmit` exit 0.
* **ruby** `5d5269a4f` — `fix(ruby): a factory base declares a superclass, and two name
  rules were wrong`. Takes the lane 9/11 → 10/11, breaking nothing; `tsc` exit 0. The
  newest revision of the same file, `cfc50deca` (2026-10-06, `wip(ruby): preserve
  uncommitted analyzer…`), scores identically on the pins, so nothing measurable is
  given up by taking the committed fix instead of the salvage blob; that blob stays on
  the archive tag.

## 3. The three pins the fold appears to break, and why they are superseded

The fold of 2026-10-07 (`78a95ab8c`) merged 18 lane revisions into nine analyzers under
a compiler gate. Measured per lane against that lane's pins, pre-fold vs folded:

| lane | pre-fold | folded | pins the fold fixed | pins the fold broke |
|---|---|---|---|---|
| c | 42/4 | 42/4 | — | — |
| groovy | 59/22 | 61/20 | empty-name-refusal, imports-dependency, receiver-not-a-name | imports-dependency-edge |
| java | 47/16 | 52/11 | exports-public-top-level-types, exports-top-level-types-only, import-flag-node-types, method-ref-receiver-names, module-info-directives, type-endpoint-base-names | module-exports-jpms |
| kotlin | 53/10 | 57/6 | anon-type-not-file-primary-type, ontology-imports-exports, ontology-root-package, override-property-949, top-level-property-owner | exports-visibility |
| python | 23/12 | 25/10 | dunder-all-expression-list, nameless-assignment-target-is-no-symbol | — |
| scala | 66/10 | 71/5 | aux-ctor-is-not-a-symbol, import-rename-clause, keyword-name-is-not-a-name, ontology-imports-exports, wildcard-is-not-a-name | — |
| svelte | 41/11 | 43/9 | namespace-component-tags, template-read-collapse | — |
| swift | 17/4 | 17/4 | — | — |
| vb | 1/3 | 1/3 | — | — |

Twenty pins gained, three lost. Each of the three losses is a *pin generation*
conflict, not a behavior loss — the lane has two pins demanding opposite spellings, and
the fold satisfies the newer one:

* groovy `imports-dependency-edge` requires `from: com.acme.dep` (the package) with
  `meta.relationshipType: single_type_import`; groovy `imports-dependency` requires
  `from: Importer` (the primary type) with `relationshipType: single_type` and forbids
  `target: java.util` and the alias-in-target form. The newer pin states why the source
  moved to the type. The fold satisfies the newer pin.
* java `module-exports-jpms` expects `exports` rows over JPMS packages;
  java `module-info-directives` (EXPORTS-JAVA2) rules the opposite in writing — "a JPMS
  package is not a symbol; an `exports` row naming a path-shaped target is DROPPED" and
  forbids `references -> java.logging`. Contradictory by construction.
* kotlin `exports-visibility` (DERIV_EXPORTS_KOT4) writes the file-level source as the
  placeholder `(file)`; kotlin `exports-file-identity` (KOTLIN4) requires the file's own
  base name (`exports-file-identity`) and forbids `root` — the R7 rule that a
  placeholder is not a name. The fold satisfies the KOTLIN4 spelling.

## 4. What main declares about its own fixture corpus

`script/m14/run-fixtures.ts` (full run, 48 lanes, 2026-10-07):

```
fixture-lane gate: 48 fixture director(ies), every one named in LANGS
summary: {"vb":{"pass":1,"fail":3}, … , "graphql":{"pass":5,"fail":0}, …}
fixture baseline gate: no regressions
136 fixture(s) FAIL — these are honest defect findings, not harness errors
```

1447 pins run; 136 fail. The corpus grew from 1238 pins to 1447 (+209) in this pass, and
the same run regenerated `validation/m14/fixture-baseline.json` through `--update-baseline`,
which is a **claim-level change and is stated as one**: three lanes were previously gated
(javascript 0, elixir 0, nim 0) and the other 45 had no recorded number. The file now
carries the measured count for all 48 lanes, so any lane that grows a failing pin trips
the gate. Nothing was silenced: 136 is larger than the 47 that failed before the lane
evidence landed, because 236 pin files (211 new, 25 replaced) from lanes main does not
satisfy are now on main and failing, where before they were not on main at all.

Per-lane declared failures:

```
vb 3, vue 5, svelte 9, typescript 6, java 11, groovy 20, kotlin 6, scala 5, c 4,
cpp 6, rust 3, python 10, go 2, csharp 4, swift 4, objc 5, lua 3, ruby 1, perl 8,
elixir 17, make 2, html 1, scss 1   (25 lanes with 0)
```

Failing pins are the acceptance tests of the analyzer generations main does not carry;
they were landed rather than left off main because the contract's rule is that silence
is guilt and a missing fixture counts as a failed one. Each one names, through its own
file, the revision it was authored against.

## 5. What is on main and what is not

Landed with this note (one commit, evidence regenerated by the harness):

* `validation/m14/fixtures/**` — 448 new files (211 expectation pins, 237 fixture
  sources, mutant scripts and probes) and 28 replaced files; plus the fixture-lane gate's
  demanded fix (`r` and `lua` added to the runner's `LANGS`, so 35 expectation files that
  nothing executed now run). New files per lane: elixir 42, python 36, svelte 31, java 30,
  kotlin 29, cpp 28, scala 26, typescript 23, csharp 19, perl 18, clojure 18, c 18,
  groovy 16, go 16, vue 14, objc 14, swift 13, html 13, rust 10, erlang 10,
  javascript 8, vb 7, haskell 6, ruby 3.
* `script/**`, `validation/m14/{instruments,probes,results}/**`, `docs/**`, `reviews/**`
  — 926 files (8.57 MB) plus 36 newer versions of files already tracked.
* the two analyzer revisions in §2, and `.tools/main-forward-guard.sh`.

Not on main, by policy, with the reason:

| not landed | size / count | why | recovery |
|---|---|---|---|
| `validation/m14/measurements/**`, `validation/m60|m12/results/**` | 190 files, 113 MB | bulk generated censuses; "generated data never in git" | archive tag |
| git-ignored paths under `script/m14/**` | 367 files | `.gitignore` names them | archive tag |
| root-level `tmp-*.ts` scratch | 88 files | scratch, not instruments | archive tag |
| `script/m14/js-ontology/results/census-svelte.json` | 1.16 MB | over the 256 KB ceiling | archive tag |
| `analyzer/GRAMMAR_FIX_VB`'s `src/ast/engine.ts` and `package.json` | — | that branch carries an older `engine.ts` (−244 lines, re-adds `@ts-nocheck`) and a `package.json` that drops `prepack` and the `verify:m27..m55` scripts; landing it would revert Laptop B's fixes | archive tag |

## 6. The 23 revisions the compiler gate would not take

Each of these was offered to main as a whole file or as a member union and refused; the
first TypeScript diagnostic is recorded in `/tmp/onto-stop/gated-report.json` at the time
of the fold. Classes: `TS2304/TS2339/TS2663` (a folded member referenced a name or
`this`-member the union did not bring in — e.g. `analyzer/C_FIX` uses
`this.macroLinkageBody` at line 1634 while the declaration it belongs to does not exist
in main's file), `TS2451/TS2393` duplicate declarations, `TS2741/TS2740/TS2345` missing
properties and argument-type mismatches, `TS2367` no-overlap comparisons, `TS1117`
duplicate object keys. Two elixir revisions were refused for a *parse* error raised by
the member-union itself (`SYNTAX_ERR 2 :: ',' expected. @109`), which is a limitation of
the union method rather than a defect in those files: their pins are on main and failing,
so they are the target of the next fold attempt.

Two candidate classes were checked and rejected on the merits, not by the compiler:
`origin/lane/master-commit` (2026-10-02) predates main's analyzers for all 48 lanes, so
its pins for groovy and java fail against newer, better revisions; the `.wip(…)` and
`.rescue(agents)` blobs score no better than the committed revisions on the same pins.

## 7. The verification battery at `a06b19701`, and what still fails outside it

Run at the commit this note was pushed with:

| check | command | result |
|---|---|---|
| types | `npx tsc --noEmit -p tsconfig.json` | exit 0 |
| build | `npm run build` | exit 0 |
| fixtures | `bun run script/m14/run-fixtures.ts` | exit 0, 1447 pins, 136 declared failing, `fixture baseline gate: no regressions` |
| no regex in analyzers | `bash script/m14/no-regex-gate.sh` | exit 0 — 0 usages, 48 of 48 analyzers in scope, and the census agrees with HEAD (0 unclassified, 0 mislocated) |
| main is forward-only | `bash .tools/main-forward-guard.sh` | `guard: OK — remote main is an ancestor of local main` |

Two gates fail, and both were failing before this pass — every commit they name is an
ancestor of the previous `origin/main` (`667efc518`), verified with
`git merge-base --is-ancestor`:

* `script/m49/verify-evidence-identity.ts` — 19/21: four artifacts no producer claims
  (`M14.0.F10.powershell` from `0aad631e0`, `M14.0.JS-CENSUS` from `24c5f52a5`,
  `M14.0.SVELTE-CENSUS` from `77c4b9f09`, `M14.6.perl` from `8f5e77904`) and one producer
  whose artifact was never written (`M14.0.F5.fsharp`).
* `script/m49/verify-evidence-lineage.ts` — 95 passed, 5 failed: the same three orphan
  artifacts lack `regeneratedAt` and `regeneratedAtCommit`.

Both are left as they are on purpose. The missing fields belong to the producer scripts
that generate those artifacts, and adding them by hand would be exactly the hand-edited
result the contract forbids; the four orphans are four producers nobody has written
against a claim four lanes already publish.

One gate moved in the right direction and is worth naming: the no-regex gate reported
five in-scope usages before this pass (one real, four stale entries in a census last
regenerated on 2026-10-05) and reports zero now, because the landed ruby revision had
already replaced its `/\\/g` with a split/join and the last real one — kotlin's
`/\.kts$/i` file-name test, older than the fold — is a suffix test in `6deea761c`.

## 8. Content that existed only in this checkout

The archive tag in §1 covers every **remote** ref. It does not cover commits that were
never pushed, and there were 1331 of those: commits reachable from a local branch and
from no remote ref. 189 of them carry a tree the remote does not have, and across them
408 blob paths differ from main. That is a second population from the one §2 measures,
and it is the one a reader would miss — the earlier evidence pass enumerated remote refs,
so a file that lived only in a local branch was never even a candidate for landing.

What happened to the 408, by class:

| class | paths | what was done |
|---|---|---|
| lane-scoped (`script/**`, `validation/**`, `docs/analyzers/**`, `reviews/**`) | 284 | the newest version was landed — 117 of them were new to the tree, the rest the earlier pass had already written |
| analyzer revisions, `src/ast/**` | 51 | **not landed**: each is a behavior change, and these revisions are exactly the candidates §2 measured against their lane's pins. Landing one now would undo a measurement, not add work |
| the website redesign, `website/src/**` | 39 | **not landed**: an in-progress front-end on its own branch (`website/redesign-2026`), not lane work |
| generated censuses, `validation/m60\|m12/results/**` | 34 | **not landed** by the rule that generated data never enters git; the largest is `java-ontology-census-before.json` at 160 MB, with thirteen ~11 MB shards beside it |

One landing in that pass was caught and undone before it was committed: the newest
commit touching `package.json` among all refs is a lane commit from 2026-10-04, and
landing it would have dropped `prepack`, `verify:m27`, `verify:m28`, `verify:m55` and
five `*:surface` scripts from a file that is not lane-owned — the same class of revert
the union ledger flags for `analyzer/GRAMMAR_FIX_VB`'s `engine.ts`. A file's newest
commit is not evidence that its content is newer than main's when the branch it sits on
forked earlier; §2's pin measurement is the check for analyzer files, and this is the
lesson applied to everything else.

Also stated plainly, because it bounds the guarantee: after this pass the only content
in this checkout that is not on the remote and not on main is the three not-landed
classes above. Deleting the **local** branches would take those with it — generated
censuses (policy), the website branch (its own concern), and 51 analyzer-revision bodies
whose behavior §2 measured and rejected. Pushing them is a decision for the owner, not a
side effect of this pass: the censuses are 391 MB uncompressed.

## 9. Method notes that a later reader will want

* A source count is never evidence in this programme; the only valid instrument is
  `script/m14/firing-check-v2.mjs`, which runs the production path
  `getParser → parse → analyze`. Its `REPO` is hard-coded to this checkout.
* No regex in analyzers, censuses or oracles; `script/m14/no-regex-gate.sh` enforces it.
* `--lang` runs are deliberately incapable of writing evidence or the baseline (M49 G8
  guard) — every measurement in §2 and §3 was taken through that path, so none of them
  could have moved a claim artifact.
* The shell's `https_proxy`/`http_proxy` abort GitHub CONNECT while `git` still exits 0.
  Unset them (`unset https_proxy http_proxy HTTPS_PROXY HTTP_PROXY all_proxy ALL_PROXY`)
  for anything that talks to `origin`, and check the push landed rather than trusting the
  exit code. `.tools/main-forward-guard.sh` refuses a non-fast-forward push to `main`.

---

## 10. Second pass, 2026-10-07: the measurement at blob level, and what is left to decide

§8 enumerated local branches. This pass asks the same question of **every local ref
namespace** (heads, tags, `refs/original/**`, `refs/rescue`) against the **actual remote**
(`git ls-remote origin`: 461 refs, 270 distinct tips) rather than against the local mirror.
Three results, each re-runnable.

### 10.1 Nothing in this checkout is off `origin` except 16 generated files

```
local refs (all namespaces)          940
local-only commits                   931     (reachable from a local ref, from no remote ref)
  ... whose whole tree is absent     189     (the pre-rewrite `refs/original/**` lineage)
paths those 189 commits touch        534
  ... whose NEWEST revision is
      absent from origin              16
```

The 16 are `validation/m60/results/java-ontology-census-before.json` (159.9 MB),
`java-imports-exports-oracle.json` (18.8 MB) and the thirteen
`java-ontology-shards/s*.json` — **341.5 MB**, all of it generated census data, which the
programme's rule keeps out of git. Worked example for the `refs/original` class:
`refs/original/refs/heads/analyzer/ELIXIR4` differs from `origin/analyzer/ELIXIR4` by
exactly those 16 paths and nothing else, so the filter-branch backup lineage carries no
lane work that the remote lacks.

Read the other way: **of the 534 paths only local refs touch, 518 have their newest
revision already on `origin`.**

### 10.2 The archive tag covers every remote ref but `main` itself

Re-measured against `git ls-remote`, not the mirror — one uncovered ref in 461:

```
NOT COVERED refs/heads/main e2a7fc6c8
uncovered count: 1
```

The tag predates the 2026-10-07 landings, so `main` is not its ancestor. Nothing else
needs it: every other ref on the remote is an ancestor. That is the state a branch
deletion is judged against — deleting all 456 branches loses no commit, and (per 10.1)
no blob either.

### 10.3 What of the branch-side content main is behind: 139 paths, and their verdicts

For every path any pushed ref touches, the newest commit that touches it on the branch
side was compared with main's. **139 paths** are touched later on a branch than on main.
Comparing **blobs** rather than dates removes most of them:

| | paths | verdict |
|---|---|---|
| the branch-side commit carries the **same blob** main has | 80 | nothing to land — the commit is later, the content is identical |
| lane instruments, `script/**` | 45 | four are strict extensions — three landed, one refused by the compiler (below); 41 diverge |
| pins, `validation/m14/fixtures/**` | 6 | all measured, all refused (below) |
| generated measurements/results | 6 | not landed: generated data rule |
| other | 2 | `node_modules` from a replica snapshot; `M14.0.F6.json` (below) |

**Landed — three revisions that strictly extend what main has** (`git diff --numstat`
shows additions only, so nothing main carries can be lost):

| path | added | what it is |
|---|---|---|
| `script/m14/oracles/python-truth.ts` | +42 | exports `PYTHON_ORACLE_LABELS` so `script/m60/rel-type-coverage-gate.ts` can prefer them over the shared filter |
| `script/m14/spec/python-completeness.json` | +7 | verdict `PY-D8` — `implements` RULED, with the instruments and the counts behind it |
| `script/m14/spec/javascript-completeness.json` | +57 | verdicts `JSD33`, `JSD34` — two RULED records and their falsifiers |

The python oracle landing repairs a live import: `script/m14/python-truth.ts:37` asks for
`PYTHON_ORACLE_LABELS`, which main's copy of that oracle did not export. `npm run
typecheck:scripts` reads 717 errors before and 716 after — **0 new, 1 fixed**.

**Refused by the compiler gate.** `script/m14/clojure-truth.ts` (+150 lines, the CLJ-D64
`overrides` oracle) does not compile in main's tree: the new
`deriveClojureOverridesTruth` pushes `{ source, target }` where `TruthEdge` requires
`type` and `line` — `TS2345` at `clojure-truth.ts:2349:18`. It is the same class of
refusal as the 23 analyzer revisions in §6, and it stays on the archive tag.

**Refused by measurement — the six pins.** Each candidate breaks the pin it belongs to
against main's analyzer, so landing it would convert a PASS into a declared failure:

| pin | lane | candidate result |
|---|---|---|
| `csharp/callsite-lines-825` | csharp 24 pins | breaks itself |
| `csharp/payload-and-complexity` | csharp 24 pins | breaks itself |
| `html/scope-barriers-and-references` | html 18 pins | breaks itself |
| `vb/declaration-shapes` | vb 4 pins | breaks itself |
| `elixir/framework-forms` | elixir 82 pins | breaks itself |
| `elixir/import-only-forms` | elixir 82 pins | breaks itself |

**Refused by measurement — the three analyzer revisions.** `src/ast/*` had three paths
where a branch side is later than main: `real-lua-analyzer.ts`, `real-nim-analyzer.ts`,
`real-sql-analyzer.ts`. Every distinct revision of each file was written to the analyzer
path and run against its own lane scoped:

| lane | revisions in refs | main | best branch side | result |
|---|---|---|---|---|
| lua | 28 | 10/13 | newest six all 10/13 | equal; `797a38204` breaks `lua/override-shapes`, `c79a45b54` breaks that and `lua/extends-supertype` |
| nim | 20 | 13/13 | newest five all 13/13 | equal; `30b834201` breaks `nim/module-target` |
| sql | 23 | 17/17 | `e024f1a95` 17/17 | equal; `29d4facdf` breaks `sql/sqld17-unnamed-index`, four older revisions break 6–11 pins |

No revision dominates what main carries, so none was landed — the same rule §2 applied.

**Refused as stale, not as worse.** The large divergences all come from snapshot refs:
`1e88c7279` (`origin/archive/replica-java-lane-m48-recovery`), `335418a58`
(`origin/archive/replica-js-audit-m48-recovery`) and `01af32ff6`
(`origin/archive/stash-nim-2026-10-05`, a stash's index commit). They are later in date
and *older* in content — main's `script/m14/mutate-analyzer.ts` is 1,202,187 B against
the replica's 780,867 B, and `differential.ts` 1,343,015 B against 1,147,609 B. Landing
by commit date here would be a revert; this is the case §8 predicted in the abstract.

### 10.4 The website is not a gap, and §8's third row is withdrawn

`git diff main origin/website/redesign-2026 -- website` is empty: main carries the
redesign byte for byte. §8 listed the website as *not landed*; that was read off
path-presence on stale replica refs (`origin/archive/replica-*-m48-recovery`, where the
M41/M45 video hero still exists), not off content.

### 10.5 What is left, and it is two decisions for the owner

1. **Deleting the 456 remote branches — DONE, 2026-10-07.** `origin` is now `main` plus
   the four archive tags: 455 branches were deleted in five batches, all exit 0, no
   deletion refused. Before it ran, four things were checked and written down here:

   * every branch tip is an ancestor of `archive/all-lanes-2026-10-07` (§1);
   * **object closure, as sets, not counts.** Objects reachable from the 461 pre-deletion
     refs: 108,437. Objects reachable from what remains (`main` + 4 tags): 108,437.
     Symmetric difference **0 in both directions** — no commit, tree, or blob became
     unreachable;
   * the **names** were recorded first, because the tag's message names no branches:
     `docs/analyzers/REMOTE-REFS-2026-10-07.tsv` carries all 460 non-HEAD refs with tip
     SHA, date, subject, and tag coverage. Any deleted branch is recreatable exactly:
     `git push origin <sha>:refs/heads/<name>`;
   * `gh pr list --state open` returned `[]`, so no open pull request lost its head.

   Every branch-side revision that postdates main's was compared by content first: the 4
   that strictly extend main were landed or refused by the compiler, and the rest were
   measured and refused or identified as stale snapshots (10.3). This checkout still has
   the 455 `refs/remotes/origin/*` mirrors and every object, so the deletion is reversible
   locally as well as from the tag.
2. **The 341.5 MB of generated java census JSON** (10.1) — **checked, not assumed, and
   left local.** The 159.9 MB file self-describes: `{"tool":"script/m60/java-ontology-census.ts",
   "corpus":{...},"totals":{"ontologyEdges":637870},"rows":[...],"edges":[...]}`. The
   generators are on main — `script/m60/java-ontology-census.ts` for the merged census and
   the thirteen shards (its output path is a CLI argument, so `-before` is a run target,
   not a separate artifact), `script/m14/lanes/java-imports-exports-oracle.ts` for the
   oracle — and the delta they exist to produce is consumed by
   `script/m14/tmp/java/java-ontology-verdict.ts`, also on main. The lane's prose record
   `docs/analyzers/java-ontology-census.md` is on main too. So these sixteen are raw
   instrument output, regenerable, and their conclusions are on main: they stay in this
   checkout and out of git, per the generated-data rule.
3. **Not a decision, a count:** main still declares 136 failing fixtures across 23 lanes
   §4, and the elixir lane's 17 are the largest single group. That is the next fold.

Verification of the three landed files, at the commit this section is pushed with:
`bun run script/m14/run-fixtures.ts` exit 0 (1447 pins, 136 failing, `fixture baseline
gate: no regressions`), `bash script/m14/no-regex-gate.sh` exit 0 (0 usages),
`npx tsc --noEmit` exit 0, `npm run build` exit 0, `npm run typecheck:scripts` 716 errors
against a 717-error baseline with 0 new. That last gate **fails before this pass and
still fails** — it is listed so a later reader does not attribute it to these three files.

---

## 11. Third pass, 2026-10-07: the loss surface as objects, and the analyzer/doc answer

§10 measured commits and paths. This pass asks the question the owner actually asked —
*what would be lost* — and answers it with an instrument, not an argument:
`script/m14/preservation-audit.py` (re-runnable; `PRESERVATION_AUDIT_OUT=<path>` writes
the JSON behind these tables). Two questions, because a commit that touches a path later
than main is not content main lacks.

### 11.1 Reachability: what is here and nowhere else

```
non-commit objects reachable from all local refs (212 heads, 244 refs/original,
    1 refs/rescue, 26 tags, 2 remotes)                       96,470
non-commit objects reachable from origin (main + 4 archive tags) 96,165
only here                                                        305
  ... of which trees                                             285
  ... of which blobs                                              20  at 17 file paths
```

The 20 blobs are the whole answer to "what would vanish if this checkout did":

| blobs | paths | what they are |
|---|---|---|
| 19 | 16 | the java census dumps of §10.1 — 344.6 MB, which `e759f0322` ("untrack 326 MB of generated M60 census output — it blocked the push") and `6faf9bd52` removed from tracking on 2026-10-04 before the rewrite removed them from main's history |
| 1 | 1 | `src/ast/real-c-analyzer.ts` blob `91cefd0760` |

The 285 trees are the pre-rewrite lineage's own trees; every blob they reference is either
on origin or one of these 20, so they carry no content of their own. Packed, the 305
objects weigh **273.8 MB** — that number decides 11.6 item 1.

### 11.2 The one off-origin analyzer revision cannot lose anything

`91cefd0760` is `refs/rescue/PERL4/real-c-analyzer-wip` (commit `8eb6983a8`, 2026-10-04,
"rescue: real-c-analyzer.ts WIP recovered from an accidental stash pop"), +128/-17 over its
parent `8b11b3ea89`. It is the only non-census blob in the checkout that no origin ref can
produce, so it is worth the paragraph:

* its base blob `502a4cd47` **is** reachable from origin — checked, not assumed;
* of the 127 lines its commit added, **126 are present verbatim in main's
  `real-c-analyzer.ts` under its own numbering**, and the 127th is the same condition it
  re-wrapped across four lines;
* the substance is the C3 marker-class rule: `EXPORT_BOUNDARY_WORDS` (main line 230),
  `isExportMarker` (main line 240), applied at main line 3234 — and main carries the
  `#989` `linkageMarkerNames` work that this rescue predates.

So the rescue is a snapshot of a rule main holds, taken before main finished it. Nothing
is dropped by leaving it where it is.

### 11.3 Per-file accounting: every analyzer revision and every doc revision

Every blob revision of a path, across every local ref, against the object set origin can
produce:

| population | files | distinct revisions | off-origin |
|---|---|---|---|
| `src/ast/real-*-analyzer.ts` | 48 | 1,402 | **1** (11.2) |
| `docs/**` | 287 | 2,276 | **0** |

And the same population answered the landing way — is the newest revision of each path
the one main has? For every `src/ast/real-*-analyzer.ts` that appears at all, the answer is
yes: the newest revision **is** main's blob (11 paths, plus `taint-analyzer.ts` and the
`worktree-snapshots/**` copies). The only `src/**` paths where a branch side holds lines
main lacks are six files from the 2026-10-01 archive snapshot `640cb93c6`
(`tool-registry.ts`, `edit-engine.ts`, `visualization-engine.ts`,
`cross-language-migration-assistant.ts`, `dependency-graph-visualizer.ts`) and
`src/ast/pool-worker.ts` from `a31cfea84` — snapshot carriers, not lane revisions.

### 11.4 The paths whose newest revision is not main's newest commit

3,975 paths, in seven verdicts. "Branch side later" compares committer dates, so a
snapshot that merely has a later date is not thereby newer work:

| verdict | paths | branch side later | meaning |
|---|---|---|---|
| in-sync | 2,367 | — | the later commit carries the blob main has: nothing to land |
| absent-both | 510 | — | the newest commit touching the path deleted it, on both sides: renames |
| not-on-main | 942 | 873 | main never had the path; a ref has it. 840 are `script/**`\+`validation/m14/**` probes, dumps and `tmp/`, 66 are `wasm/wasm/**` from a snapshot, 98 are root-level dumps and logs |
| deleted-branch | 13 | 0 | main has it, the branch removed it: not a loss |
| superseded-stale | 10 | — | main's blob strictly contains the branch blob (`numstat` deletions 0 the other way) |
| **strict-extension** | **2** | 1 | the branch blob adds lines and drops none |
| diverged | 131 | 54 | both sides hold lines the other lacks |

The two strict extensions are the entire additive backlog: `script/m14/clojure-truth.ts`
(+150/-0, the CLJ-D64 `overrides` oracle §10.3 refused on a `TS2345`) and
`script/m14/tmp/scala-ovr-2side.ts` (+6/-0, inside `tmp/`). Of the 131 diverged, 77 are from
before main's last touch of the path; the 54 that are later are dominated by `tmp/` probes,
the six pins §10.3 already measured and refused, four `*.expectation.json` pins not yet
measured, three `script/m14/spec/*-completeness.json`, and the stale java replica
`1e88c7279` (`mutate-analyzer.ts`, `differential.ts`).

**The subset that is analyzer work, not probe debris**, named here so the next fold does
not have to re-derive it:

* **19 fixture pins main never had** — `clojure/{decl-name,exports,override,qualified-type}`,
  `cpp/{declared-type-references-917,imports-edge-917,qualified-alias-917}`,
  `csharp/{ctor-init-callee,error-baselist-heritage,preproc-baselist-heritage}`,
  `erlang/{evidence-class-er3,export-all-er4,export-all-negative-er4}`,
  `rust/{nested-group-import-paths,struct-variant-fields}`,
  `python/protocol-conformance`, `ruby/ontology-factory-and-names`,
  `c/exports-visibility-attribute-992`, `objc/ontology-imports-and-exports`. A pin is a
test: if main's analyzer already emits the construct it passes and strengthens the corpus;
if it does not, it fails and the baseline gate counts it, which is why each one has to be
run scoped before it lands. That is the next fold, and it is mechanical.
* **17 instruments main never had**, none of them under `tmp/`: rust 7
  (`rust-truth.ts`, `rust-oracle-census.mts`, `rust-oracle-audit.ts`,
  `rust-instantiates-probe.mts`, `rust-struct-variant-probe.mts`,
  `rust-import-path-probe.mts`, `rust-nested-group-probe.mts`), csharp 4
  (`csharp-ontology-verdicts.ts`, `csharp-corpus-kind-index.ts`,
  `csharp-overrides-labelling-probe.ts`, `csharp-preproc-baselist-probe.ts`), clojure 2
  (`clojure-ontology-truth.ts`, `clj-ontology-gate.ts`), typescript 3
  (`ts-callee-shape-probe.mts`, `ts-callee-unwrap-differential.mts`,
  `ts-lane-firing-check.mjs`), svelte 1 (`svelte-firing-census.ts`, which is 0 bytes on the
  remote — noted in §9's pass, still 0).
* **1 doc main never had**: `docs/analyzers/INCOMING-RUST-AUDIT.md` (7,404 B, `31cf5cf89`,
  2026-10-06). The two other docs §8 listed as unlanded are renames, not gaps: main's
  `real-julia-analyzer.md` says "renamed from `julia.md`, 2026-10-03" and
  `real-make-analyzer.md` names its own old `real-makefile-analyzer.md`; `DOC-TRUTH-EMISSIONS.md:95`
  records the second one's absence on purpose. One stale citation is left over from the
  julia rename — `docs/indexing/performance.md:54` cites `docs/analyzers/julia.md:166` —
  which is prose debt, not lost work.

### 11.5 Recovery, as commands, for anything above

```
# a path as of the archive tag, or as of any recorded branch tip (the TSV holds the SHA)
git show archive/all-lanes-2026-10-07:<path>
git show <sha-from-REMOTE-REFS-2026-10-07.tsv>:<path>
git ls-tree -r --name-only <sha> | grep '<name>'      # find where a path lived

# recreate a deleted branch under its own name
git push origin <sha>:refs/heads/<name>

# the one blob no origin ref can produce
git cat-file blob 91cefd0760 > /tmp/real-c-analyzer.rescue.ts

# the account behind this section, re-derived from scratch in ~10s
python3 script/m14/preservation-audit.py
PRESERVATION_AUDIT_OUT=/tmp/preservation.json python3 script/m14/preservation-audit.py
```

### 11.6 What is left, as decisions rather than tasks

1. **The 273.8 MB local-only lineage.** Everything in it is either reproducible (the
   censuses, from generators on main) or already in main in substance (the C rescue).
   Options, in the order this note recommends them: leave it local and out of git, since
   the programme's own commits removed it to unblock a push; or bundle it to a path
   outside the repository for a copy that survives this checkout; or push a preservation
   ref to `origin` (a 273.8 MB push of data main deliberately does not carry). This is the
   owner's call, not a side effect of any pass.
2. **The 19 pins and 17 instruments** of 11.4 — the concrete answer to "nothing left
   behind". Each pin is one scoped run; each passing pin is permanent coverage of a
   construct a lane measured. The instruments land behind
   `npm run typecheck:scripts`, which fails at 716 today.
3. **`script/m14/clojure-truth.ts`** — the last strict extension, refused only because
   main's `TruthEdge` requires `type` and `line` and the branch's `deriveClojureOverridesTruth`
   fills neither. Adapting it is a small, bounded edit, and it is the clojure lane's
   `overrides` oracle.
4. **The elixir lane's 17 declared failures** remain the largest single group (§10.5 item 3).

### 11.7 The first fold of 11.4's pin list, measured: clojure

The four clojure pins main never had were written into the tree from their own blobs
(`git cat-file blob <blob> > <path>`, blobs from the instrument's JSON) and the lane run
scoped. Nothing was landed on a guess:

| pin | measured against main's analyzer |
|---|---|
| `clojure/exports` | **PASS** — landed. It is CLJ-D62's record: the `exports` edge shape, the trailing-`::`/private rules, and CLJ-D62b, the defect the fixture found rather than the census (the `exports[]` list carries 929 private rows over 130 files). Main already emits the edge, so the pin is permanent coverage, not a new claim |
| `clojure/decl-name` | **FAIL** — 4 forbidden findings: main publishes `:-` and `"bad docstring"` as `function` symbols, and `contains` edges to both |
| `clojure/override` | **FAIL** — 1 forbidden edge: `overrides[clj.fixture.override->same-line-same-kind]` |
| `clojure/qualified-type` | **FAIL** — 7 expected symbols absent (`StampedNames`, `ErrorRecord`, `MyProtocolWithSchema`, `method1`, `method2`, `RecordSchema`) and the `implements`/`contains` edges that hang off them |

The three refusals are refused by measurement, exactly as §10.3 refused six pins: landing
one would turn clojure's `0` failing into a declared failure and trip the baseline gate.
Each names a defect main has today — two are the kind this programme treats as worst
(an edge to a keyword, an `overrides` edge to a name sharing a line with its own kind) and
one is a gap — so they are the clojure wave's work list, and the pins land with the fixes.

After landing `exports`: corpus 1448 pins, 136 declared failing, clojure 72 pass / 0 fail,
`fixture baseline gate: no regressions`.

Verification of this section's landed files is in §12.

### 11.8 The layer 11.1-11.4 cannot see: objects no ref and no reflog points at

§11.1–11.4 answer "what does a *ref* reach". A `git gc` also deletes something those
questions never look at: objects that no ref and no reflog points at. `preservation-audit.py
--dangling` now measures that layer, and the answer is not zero.

```
no ref and no reflog points at                     8,174 objects   (426.4 MB)
   commits 1,155   trees 3,569   blobs 3,450
per (blob, path) pair:
   path main does not have                        7,208   (snapshot dirs named by tree sha)
   diverged                                       1,043
   AHEAD of main's copy                             682   across 465 paths
   no tree survives                                 219
   subset of main, superseded                         3
```

**The 465 paths are not a landing queue, and 462 of them are one thing:** merge-conflict
artifacts. The filter is cheap — does the blob contain `<<<<<<<` — and it changes the
reading completely. Worked example: `src/ast/real-lua-analyzer.ts` reads as "ahead by 44
lines", and those 44 lines are `<<<<<<< HEAD`, `=======`, `>>>>>>> main` repeated with one
real line among them: a conflicted working tree captured by a snapshot, not a revision.

**Exactly three are clean, and all three compile on main's tree, so they are landed here:**

| path | what the dangling blob adds |
|---|---|
| `docs/MCP_CLI_INDEXER_GUIDE.md` | +5 rows: `bb index <dir> --changed`, `bb watch [dir]`, `bb watch --status`, `bb watch --stop`, and the freshness question that maps to the last of them |
| `src/intelligence/contracts.ts` | +2: `fileId?: string`, "M44.W1.1: brain_file id for read-repair mapping (quickAnswer sources)" |
| `src/intelligence/search/semantic-search.ts` | +2: the two call sites that thread it (`symbol.fileId`, `row.fileId`) |

Each is a strict extension of main's copy (`numstat` deletions 0 in both directions
checked), which is what makes them landable without a measurement: nothing main carries
can be lost by taking them.

**Insurance taken, because a plain `git gc` would have pruned all of this** once the
reflogs expired: `git config gc.pruneExpire never` in this checkout (local config only; undo
with `git config --unset gc.pruneExpire`). That is a guard on the *repository*, not a
claim about the content: 426 MB of this layer is stale snapshots and conflict states, and
pruning it stays a decision rather than a side effect.

Bound on the claim: the per-(blob, path) verdicts are an upper bound, because one blob can
sit at many snapshot paths and a verdict that depends on which path is picked is a verdict
about the picker. That is why the conflict-marker filter is applied to the 465 rather than
the count being read at face value, and why the three above were each read by hand before
landing.

## 12. Verification at the commit that lands §11

```
bun run script/m14/run-fixtures.ts          exit 0   (1447 pins, 136 failing,
                                                      fixture baseline gate: no regressions)
bash script/m14/no-regex-gate.sh            exit 0   (0 usages)
npx tsc --noEmit                            exit 0
npm run build                               exit 0
npm run typecheck:scripts                   716 errors, unchanged (the instrument added here
                                                      is Python and outside tsconfig.scripts)
```

§11.8's three recovered files were verified on the tree that carries them: `npx tsc --noEmit`
exit 0, `bun run script/m14/run-fixtures.ts` exit 0 (1448 pins, 136 failing, `fixture
baseline gate: no regressions`), `bash script/m14/no-regex-gate.sh` exit 0, `npm run build`
exit 0. No `.ts` file under `script/` changed, so `npm run typecheck:scripts` is untouched.

The suite was run over the tree this section describes, so the four provenance fields of
`validation/m14/results/M14.0.F3.json` name the parent commit and are re-emitted in the
second commit of the pair — the same two-step §10 landed with. The instrument itself is
Python in `script/m14/`, which `tsconfig.scripts.json` does not include, so it cannot move
the 716-error count in either direction; that is why the count is quoted rather than the
gate, which fails before this pass and still fails.


---

## 13. Postscript, 2026-10-10: the elixir fold happened — 17 declared failures → 0

§4 and §10.5 item 3 named one action: *"the elixir lane's 17 declared failures remain the largest
single group. That is the next fold."* It is done, and §10.5's own reasoning is why it was
possible: the three elixir revisions were refused on **mechanical** grounds (a member union that
`tsc` or the union tooling could not parse), never on a measurement. This section records the
outcome against that plan, not a new plan.

**What landed, and where it is recorded.** `docs/analyzers/real-elixir-analyzer.md` §14 carries the
whole record: the per-revision fix/break census measured with `script/m14/lane-analyzer-probe.mjs`
(EXPORTS2 fixes 8/breaks 6; ELIXIR4 fixes 7/breaks 8; ELIXIR fixes 5/breaks 9 — the union of the
three fixes every failing pin), the two reconciliations the corpus forced (the evidence-class
vocabulary, and five BEHAVIOUR claims where two generations of pins contradicted each other —
settled by counting which pins sit on passing rows, with each losing pin moved and the reason
written into its own `note`), the ten producers promoted from `analyzer/ELIXIR4`,
`analyzer/ELIXIR_EXPORTS2` and `analyzer/ELIXIR`, and the post-fold corpus audit.

**The lane, before and after** (this file's own §4 table row 68 said `analyzer/ELIXIR_FIX3`,
65/82, 17 failing):

| | before this fold | after |
| --- | --- | --- |
| elixir fixtures | 65 pass / 17 fail (67/15 on main at the start of the work) | **82 pass / 0 fail** |
| `imports` relationship | not published | 278 edges / 150 files |
| `overrides` relationship | not published | 154 edges / 22 files (two producers: `@impl`, `defoverridable`) |
| elixir mutants | 87/87 caught | 87/87 caught |

**Two instruments were wrong and are repaired in the same change** (§14.6): the emission audit's
`REL_TYPES` listed the CHANNEL name `brain_import` and not the relationship `imports`, which made
the audit count exactly one such row out of 278; and its `PLACEHOLDERS` set contained lower-case
`unknown`, which reported an R7 endpoint on a row the corpus pins as correct (EX-EX11b). Both are
the class of defect §9 warns about — an instrument that looks like evidence and cannot fail.

**What this section does NOT claim.** No branch is deleted or merged by this fold: the three
revisions stay exactly where they are, and this section names them as the SOURCE of the promoted
producers so a later reader can diff against them. The other 20 lanes' failures (§4) are untouched
— the remaining groups (groovy 20, python 10, java 10, svelte 10, …) are the next candidates, and
§6's rule applies to them unchanged: *more pins, and breaks none.*

---

## 14. Postscript, 2026-10-10 (second): the groovy fold happened — 20 declared failures → 0

§4 listed groovy as the largest group still standing after the elixir fold, and §13 named it the
next candidate. It is done. Unlike elixir, **no branch held this work**: the four groovy revisions
were probed with `script/m14/lane-analyzer-probe.mjs` and their UNION fixes 2 of the 20 fixtures,
so this was implementation, not promotion. The whole record is in
`docs/analyzers/real-groovy-analyzer.md` §15; this section states the outcome and the part that is
a decision rather than a fix.

**The lane, before and after** (this file's §4 row for groovy, 61 pass / 20 fail):

| | before this fold | after |
| --- | --- | --- |
| groovy fixtures | 61 pass / 20 fail | **81 pass / 0 fail** |
| declared-type `references` | qualified names only, all sourced at the enclosing type | bare + qualified, each sourced at the FIELD or the MEMBER that writes it |
| constructor symbol name | the literal `constructor` | the class name (`ownerName` = the class) |
| `exports` vocabulary | `groovy_exportable_unit` + `exportForm`, non-public types at 0.6 | `exported_type`/`exported_function` + `kind` + `dottedName` at 1.0, non-public types publish nothing |
| `imports` (file-level) | rewritten to the primary type, no `fileLevel` storage shape | sourced at the PACKAGE with `fileLevel: true` (the `bb_graph` dependency query's shape) |
| groovy mutants | 56 registered | **59/59 caught** (3 added: qualified-only, class-attribution, file-level-rewrite) |

**The part that is a decision.** Two analyzer comments called their own behaviour a settled ruling
and cited artifacts that do not re-run: constructors named `"constructor"` and every symbol anchored
at its first ANNOTATION, both on the authority of the M12 hand audit (`validation/m12/ground-truth/
groovy.json`), which `script/verify-m12-final-audit.ts` reads **only for existence**. The fixtures
say the opposite in as many words, in both directions, and the family has since moved: kotlin's pins
call the class-name rule "the java C3 family convention" and java's own constructor fixtures already
name constructors after their classes. So the fixtures won, the M12 rows are left standing as the
stale record they are, and §15.2/§15.4 record the arbitration rather than rewriting the audit.

**Two fixture pins were moved, each with its reason written into the fixture.** groovy/
`exports-publication-edge` (the pre-ruling "THE SET IS TYPES ONLY" reading) lost its `topLevelHelper`
forbid and its three type rows now carry the converged vocabulary, because the M49 JVM-closure
ruling in `reviews/jvm-closure-audit.md` — *"exports = importable units only (top-level types +
top-level functions)"*, owner-approved — withdrew the premise; groovy/`imports-dependency` lost the
0.9 type-sourced `imports` mention label, which cannot coexist with the later fixture's
`forbidRelationships: [{type: imports, source: Dep}]` and was redundant with the `references`
mention anyway. Both moves are recorded in the fixtures' own rationales.

**What this section does NOT claim.** No branch is deleted or merged. The corpus tables in the lane
doc are PRE-FOLD numbers and the section says so — the fold changes the `imports` row count, the
`references` target mix, the `exports` vocabulary and the constructor names, and a re-measurement
with `script/m60/groovy-ontology-census.ts` is owed before any of them is quoted as current. **The
same five laws are failing in java right now** — `java/ctor-delegation`, `java/ctor-value-injection`,
`java/declaration-lines-825`, `java/exported-types`, `java/import-dependency-edges` — with the
fixtures already written and the same stale rulings in `src/ast/real-java-analyzer.ts`; java is the
cheapest next fold in the tree, and kotlin (6 failures) and scala (5) follow it on the same axis.

## 15. Postscript, 2026-10-10 (third): the java fold happened — 10 declared failures → 0

§14's last sentence named java the cheapest next fold. It was, and it was also the first lane where
the defect was not a stale *ruling* but a duplicated *implementation*: the same wave had been merged
into `src/ast/real-java-analyzer.ts` twice, and in both copies the SECOND one was unreachable.

| | before | after |
| --- | --- | --- |
| lane fixtures | `java`: **53 pass / 10 fail** | **63 pass / 0 fail** |
| full suite | java's 10 failures + every other lane | **1369 pass / 88 fail** measured over all 50 lanes, with java's delta the only movement (the only regression lines are the baseline-recorded vue/svelte/html drift) |
| constructor symbols | literal `"constructor"` | the CLASS name (M37.21 C3 — three fixtures pin it and say why) |
| declaration lines | first ANNOTATION (M12 hand audit) | the NAME's line (M59/#825, the scala-first contract) |
| import dependency source | rewritten to the primary type, so the file-level row bound to a symbol | the PACKAGE, exempt from the rewrite (`fileLevel: true`) — the shape `bb_graph`'s per-file query needs |
| `exports` emissions per public type | **two** rows, same key, `exported_type` + `java_exportable_unit` | one, `java_exportable_unit` (+`kind`, `dottedName`, `isJavaExport`), 1.0 public / 0.6 package-private with `reasonCode` |
| `module-info.java` | **0 symbols, 0 `exports[]`, 0 `imports[]`** (the reachable arm emitted only `references`) | module + namespace symbols, `module_exports`, `module_requires`, both mentions, ImportInfo with `importType` |
| java mutants | 9 registered (I*, E*) | **17 dead · 2 equivalent · 2 survived** of 21 (7 added: J1–J7) |

**The new failure shape, and why it is worth a sentence of its own.** §11.4's pin list was built to
find revisions that exist here and nowhere else. A second, cheaper-to-hit version of the same loss
sits INSIDE one file: two `module_declaration` arms in one if/else chain, where the first `else if`
matches the node and the second — the one with the module symbol, the Namespace symbols, the
`exports` edges and the entire `imports[]` channel — becomes dead code that no gate reports, because
the live arm still emits *something* on every module-info file (the firing check counts the shape as
covered). The same file carried two `exports` emission sites with the same key and different
metadata. Neither showed up as a corpus anomaly; both showed up as fixtures failing against a
construct the analyzer "supports". The detector that generalizes is the *duplicate-key* test the
family already uses (`expectRelationshipCount`) plus reading a dead `else if` as a defect rather
than as documentation.

**Four fixture pins were moved, each with its authority written inside the fixture** (§5 of the lane
doc names all four): `exported-types` (label → the converged one, package-private forbids bounded at
1.0 with the JLS 6.6.1 reason), `import-label` (labels → `*_import`, source → the package, 1.0, plus
the stated JLS 7.5.3/7.5.4 label collapse), `module-info-directives` (the converged JPMS vocabulary
and the `requires static` tier; its `exports`-for-a-package forbid replaced by the retired label),
`module-exports-jpms` (its bare `references` forbid re-pointed, because the newer fixture beside it
requires that mention).

**What this section does NOT claim.** No branch is deleted or merged. The `module_exports` rows the
three JPMS fixtures require are still DROPPED by the store's path-shaped `exports` filter
(`parallel-indexer.ts:3965-3971`) until that filter learns `metadata.isModuleDirective` — recorded as
an open item in the lane doc, not worked around in a fixture. The lane's second corpus (`geb`) has no
checkout, so both-corpus gates still do not run for java. The corpus tables earlier in
`docs/analyzers/real-java-analyzer.md` are PRE-FOLD numbers and that file now says so where it
matters; the re-measurement with `script/m14/lanes/java-ontology-census.ts` has since been run
(2026-10-10, whole 3,275-file corpus: **10/10 types fired, 96,857 symbols, 734,864 relationships**,
`imports` 77,858, `exports` 3,253), and the pre/post attribution lives in that file's *Post-fold
corpus re-measurement*, measured by `script/m14/lanes/java-fold-ab.mts` against the analyzer blob
at HEAD.

**The same axis, cheapest first.** kotlin (6 failures) and scala (5) are the JVM siblings and share
the ctor-identity and line-anchoring rulings verbatim; typescript (6) and python (10) are the two
largest remaining single-lane counts; perl (8) and the csharp/swift/objc block (4/4/5) are behind
them. The vue (7), svelte (10) and html (4) counts are the baseline-recorded drift §14 already
flagged, in analyzers this fold does not touch — they are the only entries in the full suite that
move in the wrong direction, and they moved before this work started.

**CORRECTED by §16, and the correction is the interesting part:** that first sentence inferred the
axis from the SHAPE of the two lanes' declared failures, and it is false for both. kotlin's and
scala's failures are the `exports`/`imports` vocabulary (plus `context-parameters` and a wildcard
false positive); the two rulings were not what was failing in either lane. kotlin's ctor-identity
ruling already held, scala's did not, and what neither lane could see was a COLUMN.

## 16. Postscript, 2026-10-10 (fourth): the JVM siblings happened — and the prediction was wrong

§14 and §15 both closed by naming the next fold: *"kotlin (6 failures) and scala (5) are the JVM
siblings and share the ctor-identity and line-anchoring rulings verbatim."* That sentence was an
inference from the SHAPE of the two lanes' declared failures, and it is wrong in both directions —
not because the rulings are uninteresting, but because the failures were never about them. This
section records what the measurement said, including the part that contradicts the prediction.

| | kotlin | scala |
| --- | --- | --- |
| lane before | 57 pass / 6 fail | 71 pass / 5 fail |
| lane after | **58 pass / 6 fail** (one fixture ADDED) | **72 pass / 5 fail** (one added, four re-pinned) |
| the 6/5 failures | `exports`/`imports` vocabulary + `context-parameters` | `exports`/`imports` vocabulary + `qmark-declared-is-a-name` |
| were those the two rulings? | **no** | **no** |
| ctor identity (M37.21 C3) | already held: 1,978 ctor symbols, 1,852 distinct names, **0** the literal | NOT held: 2,442 ctor symbols, **1** distinct name, 2,442 the literal — the last JVM lane |
| name anchoring (M59/#825) | held, but **no failing pin** | half-held (lines right, the NODE was the modifier) |
| what the fold actually did | found a real defect by writing the pin (below) | renamed ctors, re-pinned four ratifying fixtures, fixed the anchor pick |
| mutants | `K1`, `K2`, `K3` all DEAD | `S1`, `S2`, `S5` DEAD · `S3`, `S4` EQUIVALENT |

**The measurement instruments** (both new, both in `script/m14/lanes/`):

- `jvm-rulings-ab.mts` — HEAD blob vs working tree, same engine, ONE parse per file, over a
  1,500-file slice of each corpus. It reports the two rulings directly (constructor-name
  distribution; anchors moved, split into line moves and column-only moves) rather than one
  aggregate delta, because a rename moves identities and a re-anchor moves ranges. Its first
  version called `run-fixtures.ts`'s cached shared Parser from 8 concurrent workers and produced 7
  kotlin files of `Incompatible language version 0` on ONE side of an IDENTICAL-content A/B; the
  identity control is what caught it, and the harness now refuses to let a run with differing
  totals on identical content pass unremarked.
- `jvm-rulings-mutants.mts` — the lane-local, fixture-based mutant runner for both rulings, with
  in-memory restore and a sha256 check before and after every mutant. Its first version read
  `execFileSync`'s return value only, so the four killed mutants were reported as `DIED-LOUDLY`
  with no output: `run-fixtures.ts` exits **4** when a lane's baseline gate sees a regression,
  which is exactly what a caught mutant produces, and `execFileSync` THROWS on a non-zero exit.

**kotlin: the pin found the defect, and it is the newest kind of finding in this inventory.**
`findNameNode` scanned only a declaration's DIRECT named children. A `property_declaration`'s
children are `binding_pattern_kind` (the `val`/`var` word — a NAMED node in tree-sitter-kotlin) and
`variable_declaration`, which holds the `simple_identifier` that is the name — so the scan found
nothing for every class-body property and the positional fallback anchored the symbol on the
`val` KEYWORD's column. java's declaration-name helper carries the same exception
(`field_declaration` → `variable_declarator`), so this is one rule implemented in four grammars and
missing its field case in one of them. Corpus attribution: **5,516 identities re-anchored (2 line
moves, 5,514 column-only), 0 renames, all ten relationship types identical, symbols/relationships
unchanged.** Both line moves were adjudicated by opening the files the harness now names for every
moved row: one is an ERROR-recovered identifier from the NEXT declaration (`<expr>` markup), the
other an explicit backing field anchored on its property's line.

**scala: four fixtures were ratifying the retired literal.** `aux-ctor-is-not-a-symbol`,
`enum-params`, `m60-contains-owner-model` and `m60-val-pattern-is-a-name` all pinned
`name: "constructor"` — so the lane's own fixtures kept the defect alive, for a wave, exactly as
groovy's had. Three of the moved `m60-contains-owner-model` rows were FORBIDS, where the retired
spelling would have gone inert and let a fabricated trait constructor through. The rename also
forced a push-order fix (the ctor was pushed before its class, so two bare-name harness lookups
were answered by the constructor once it shared the class's name — kotlin, java and groovy all push
the class first). That second fix is what `scala/generic-parameters-payload` failing was reporting:
the harness's `expectTypeParameters` and `expectSymbols` look a symbol up BY NAME, and with the
class and its constructor sharing one, the first match won. The pin was NOT weakened and the
harness was NOT changed — the analyzer's emission order was, which is the fix that makes the
bare-name lookup mean what it says. The anchor half moved 0 lines and 27
columns on 1,500 files, all of them `opaque type …` declarations in the dotty compiler's own
source, and its two halves were measured to be individually equivalent (`S3`, `S4` EQUIVALENT) and
jointly caught (`S5` DEAD).

**What this section does NOT claim.** No branch is deleted or merged. Neither lane's declared
failures were fixed — kotlin still fails 6, scala still fails 5, the same ones — and the docs say so
in their own *What this ... does NOT claim* sections. The corpus numbers are 1,500-file samples of
18,965 (scala) and 82,222 (kotlin) files, not whole-corpus runs. The `L8` relationship-row swap
between the two `localFunctionInExplicitBackingField.kt` files is invisible to a count-based diff
and is recorded as such rather than papered over.

## 17. Postscript, 2026-10-11 (fifth): BOTH JVM siblings folded — kotlin's 6 and scala's 5 are now 0

§16 closed by saying *"kotlin still fails 6, scala still fails 5, the same ones"*. Both counts are
now zero, and the section that said otherwise is superseded by measurement, not by optimism:

| | kotlin | scala |
| --- | --- | --- |
| entered | 58 pass / 6 fail | 72 pass / 5 fail |
| left | **64 / 0** | **77 / 0** |
| round | exports/imports module identity, the `context(...)` header, function-local declarations | exports/imports module identity, the clause's path-vs-name, the per-file `?` rule |
| mutants | `C1`, `L1`, `U1` added; master suite 36/36 caught | `S6`–`S11` added; full runner 15 dead · 2 equivalent · 0 survivors over 17 |

**kotlin** (`docs/analyzers/real-kotlin-analyzer.md`, *the exports/imports module identity, ruled and
closed*): a compilation unit has no module object, so its identity is the file's FIRST TOP-LEVEL
TYPE (`Pandora -> Published`), a file without one publishes no `exports` RELATIONSHIP at all (and
counts what it withheld in `metadata.exportsWithheldNoModuleIdentity`), and the package-sourced row
is kept beside the unit row because it is what this lane's `imports` rows join against. The
`context(...)` header is refused by its ENTIRE SUBTREE (the recovery inside it fabricates a call to
its own parameter), and a `val` inside an accessor body or a lambda is not a symbol at all.

**scala** (`docs/analyzers/real-scala-analyzer.md`, *exports/imports vocabulary + `qmark`, ruled and
closed*): the surface is published under TWO spellings from ONE predicate — the package path (what
an import site spells) and the `(file)` unit sentinel (what the family uses) — a top-level export
clause is sourced at the module identity rather than at the `(script)` statement sentinel, a clause
publishes the name it INTRODUCES and never the written path, a wildcard clause publishes a 0.7
scope row only when its qualifier is one NAME, and the `?`/`_` refusal is the per-file rule it was
documented to be (the literal ban in `push` had been shadowing the per-file test below it).

**The honest note for both.** The four `incoming-scala-*`-family fixtures and the kotlin fixtures
that were re-pinned moved from spellings the analyzers no longer emit (or never emitted on main —
`docs/LOST-ANALYZER-CENSUS.md` records that no branch satisfied the two `incoming-scala-*` ones).
Every re-pin carries its reason in a `rePinnedNote` or row `note`, and the mutants above are what
make the new spellings falsifiable. Neither round re-measured its lane's corpus tables; the counts
quoted here are fixture-level.

## 18. Postscript, 2026-10-11 (sixth): the fixture baseline was refreshed to measured truth, and the drift has a name

§16 closed with *"the only regression lines are the baseline-recorded vue/svelte/html drift"* and §17's
run printed them again. That is the failure mode a gate has: `bun run script/m14/run-fixtures.ts` was
RED on every full run with the same three lanes, and a gate that is red on every run stops being read —
which is how a genuinely new regression gets through. The baseline has been re-measured over the whole
tree and re-recorded, and the drift is now recorded BY NAME rather than as one number per lane.

**What the recorded numbers said, and what the tree measures.** Measured at HEAD over all 48 lanes
(**1460 pins: 1387 pass / 73 fail**); the *recorded* column is `validation/m14/fixture-baseline.json`
as of `31b6cd908`, the commit that last wrote it:

| lane | recorded at `31b6cd908` | measured at HEAD | why the row moved |
| --- | --- | --- | --- |
| groovy | 20 | **0** | §14's fold; the allowance outlived the work |
| elixir | 15 | **0** | §13's fold |
| java | 11 | **0** | §15's fold |
| cpp | 6 | **0** | the cpp fold |
| kotlin | 6 | **0** | §17's fold |
| scala | 5 | **0** | §17's fold |
| swift | 4 | **0** | the swift fold |
| vue | 5 | **7** | drifted up (below) |
| svelte | 9 | **10** | drifted up (below) |
| html | 1 | **4** | drifted up (below) |

The seven stale-high lanes are the *masking* half, and they were the worse half: the whole rule is
`current > base`, so a lane recording 20 while measuring 0 was gated against a number its own fold had
already retired, and **67 failures of allowance** sat in the file as free room for new failures — with
nothing able to report it, because an improvement is silent by construction (the count gate only ever
fires upward) and `--update-baseline` had not been re-run since the folds landed. 38 of the 48 lanes
needed no change; the ten above are the whole diff.

**The three drift lanes, bisected rather than attributed.** The recorded 5/9/1 were true measurements,
not a transcription: a detached worktree at `31b6cd908` (with `node_modules` symlinked) runs vue
**55/5**, svelte **43/9**, html **17/1** — the recorded row, and `fixture baseline gate: no regressions`.
Walking the lane-relevant commits forward, two move nothing — `b0eace73d` (2026-10-08, the svelte
"seven literals" pass) and `04b89f377` (2026-10-10, typescript's incoming round) both still measure
55/5 · 43/9 · 17/1 — and `4d1da43ed` (2026-10-11, *"resolve a bare row through the file's own import
statement, and keep the binding the store was dropping"*) measures **53/7 · 42/10 · 14/4**, which is
HEAD's row exactly, and HEAD's fixtures for these three lanes are byte-identical to `31b6cd908`'s. So
this is ONE commit moving THREE lanes, not three drifts: vue, svelte and html all consume the
javascript delegate, and that round changed the rows the delegate produces. The javascript lane
itself is green, so nothing in the round's own lane could see it.

**The six pins that moved, by name** — every one is a row the embedding lane no longer receives
(missing delegate output, not a changed label), which is the shape a delegate change produces:

| pin | the row it no longer finds |
| --- | --- |
| `vue/options-rename-identity` | `exports ActualName -> api`, `imports ActualName -> ./Child.vue:Child` |
| `vue/payload-pins` | `calls payload-pins -> ref` |
| `svelte/relationship-kind-catalog` | `imports` sourced at `relationship-kind-catalog` |
| `html/inline-embedded-code` | `imports -> /lib/helper.js:helper` (`embeddedLineOffset` 30), `calls -> renderBanner`, `uses -> SHIPPED` (offset 41) |
| `html/embedded-heritage` | `instantiates -> TrackedSeries`, `calls -> describe` |
| `html/embedded-origin-marks` | `imports -> /lib/mount.js:mount` (offset 45) |

**The gate now records names, because no number can.** Three defects in one artifact, all fixed here,
all three measured on this tree: (1) the count gate could not see a **swap** — fix one red, land
another, `7 -> 7` passes; (2) it could not report a stale-high row (§19 makes that a report on every
run rather than something only a re-measurement exposes); (3) it could not report a lane
missing from the file at all. `--update-baseline` now writes a companion
`validation/m14/fixture-baseline.failing.json` (48 lanes, the failing fixture STEMS per lane) from the
same run as the count, so the two artifacts cannot disagree about which fixtures are red, and the gate
reports a failing fixture the record does not name at the SAME exit code as a count increase. A
recorded fixture that now passes is printed as retirable and never fails the gate, so the ratchet stays
monotone in the improving direction. All three behaviours are exercised, not asserted: vue at a
temporarily-decremented baseline reports `FIXTURE REGRESSION vue: 6 -> 7 failures` and exits 4; a
same-count swap reports `FIXTURE REGRESSION vue/contract-call-local-shadow: failing fixture is not in
the recorded failing set` and exits 4 with the count untouched; the untouched tree reports `fixture
baseline gate: no regressions` and exits 0; and a scoped run still refuses `--update-baseline` (exit 5).

**The open item this section records rather than closes.** The six pins above are *recorded*, not
adjudicated: whether the javascript round's new binding shape makes them stale pins (and they should be
re-pinned with the new row spelled in the fixture) or whether the delegate is dropping rows the
embedding lanes are entitled to (and the javascript analyzer owes them back) is a decision no
re-measurement answers. Nothing forced it before this section: the F7 provenance gate
(`audit:fixture-provenance`) only obliges a fixture that is NEW or MODIFIED to pass, and these six files
are untouched, so they were in the one state that gate cannot see — a fixture the tree runs and the
commit that broke it never had to answer for. That is `docs/analyzers/BRANCH-INVENTORY-2026-10-07.md`
§11.4's defect class in miniature, and it is why the refreshing half and the naming half are the same
change.

**What this section does NOT claim.** No analyzer was changed and no fixture was re-pinned: the refresh
records what the tree measures, and every one of the 73 failing pins is still the honest finding it was.
The bisect was run on three lanes' pins in a detached worktree, not over the whole corpus, and it
attributes the three lanes' counts to `4d1da43ed`; it does not attribute any individual pin to a hunk
of that commit. The 73 is a working-tree measurement on a tree with uncommitted analyzer work in
cpp/elixir/groovy/java/kotlin/scala/swift — the seven lanes whose rows this refresh lowered — so the
lowered rows describe this tree, and re-running `--update-baseline` after those changes land is what
keeps them true.

## 19. Postscript, 2026-10-11 (seventh): the stale-high row is now REPORTED at the measurement, not only repairable

§18 re-measured the baseline and named the drift, but it left the *reporting* half of the finding open:
the surplus it retired was visible to nobody who did not choose to run `--update-baseline`. The gate's
own verdict line read a clean `fixture baseline gate: no regressions` while **67 failures' worth of
allowance** sat in the file — groovy recording 20 against a measured 0, elixir 15, java 11, cpp 6,
kotlin 6, scala 5, swift 4. Each of those slots was room for one NEW failure that the count gate
(`current > base` only, one-directional by construction) could not see. Re-measuring fixes a surplus; it
does nothing about the next one, so `script/m14/run-fixtures.ts` now says it out loud, every run, from
the measurement itself.

**What changed.** `allowanceDrift(base, currentFail)` — pure, so the selftest can drive it — compares
the record against the lanes *this run measured* and returns each lane's surplus (biggest first, lane
name as tie-break so the output is stable and diffable). `reportStaleHigh` prints it: one line per lane
with recorded / measured / retirable, the total failures' worth, and the two ways to act on it. It is
computed from the same `base` and the same `currentFail` the regression comparison reads, so the two
reports cannot describe different runs. The verdict line carries the total
(`... — but 1 lane(s) carry 3 failure(s)' worth of STALE-HIGH allowance`), which is the part that
matters: `no regressions` can no longer be read as "the record describes this tree". Measured lanes
only, deliberately — a lane the run did not run is not evidence about its allowance, so a scoped run
cannot report another lane's surplus and still cannot retire one (the scoped `--update-baseline` refusal
at exit 5 is unchanged). And `--update-baseline` now prints what the write RETIRES
(`fixture allowance retired by this write: 3 failure(s) across 1 lane(s) — groovy 3 -> 0`), so
re-measuring is a visible act in the log it produces rather than a silent rewrite.

**Report-only by default, and why that is not a hole.** `--strict-allowance` makes the surplus a failure
(exit 7, distinct from the regression exit 4) for whoever wants the ratchet enforced on the next run; it
is not wired into `npm run verify`. The default stays advisory for the same reason §18's failing-set
ratchet is monotone in the improving direction: if an improvement failed the gate, the gate would punish
exactly the work the milestone is asking for, and the first thing anyone does with a gate that fails on
good news is stop reading it. Precedent in this repo: `script/m60/analyzer-complexity-gate.ts` prints an
improvement and requires `--strict` to fail on it, for the same "the register must be re-emitted in the
same commit" rule.

**Exercised, not asserted** (all with `validation/m14/fixture-baseline.json` and its `.failing.json`
companion restored byte-exact afterwards, `md5sum -c` clean):

| control | state | result |
| --- | --- | --- |
| selftest | 6 decision cases (surplus ordering, at-baseline, regression, unnamed lane, unmeasured lane, tie-break) | `selftest: 6/6 allowance cases`, exit 0 — extended to 11 cases in §20, where the same line reads `6/6 allowance cases, 5/5 unrecorded-lane cases` |
| selftest can fail | predicate relaxed from `<` to `<=` | `4/6`, exit 1, naming the two cases that see it; file restored |
| stale-high, default | groovy recorded 3, measures 0 | report names `groovy: recorded 3, measured 0 — 3 retirable`; verdict carries the surplus; **exit 0** |
| stale-high, strict | same state, `--strict-allowance` | `FIXTURE ALLOWANCE STALE-HIGH under --strict-allowance`; **exit 7** |
| regression + stale-high together | groovy 3→0 and svelte 5→10 in one run | `FIXTURE REGRESSION svelte: 5 -> 10 failures` **exit 4**, with the groovy surplus still reported (the regression path neither suppresses nor absorbs it) |
| the write names what it retires | full run, `--update-baseline` | `fixture allowance retired by this write: 3 failure(s) across 1 lane(s) — groovy 3 -> 0`; svelte's 5→10 growth is not counted as retired; exit 0, and the write reproduced the committed truth **byte-for-byte** (both artifacts) |
| stale-high on the interface `npm run verify` runs | groovy recorded 3, **unscoped (all 48 lanes)** | report printed between the summary and the verdict, verdict carries the surplus, **exit 0**, and the run's 73 honest failures are unchanged beside it |
| clean tree | full run at the refreshed baseline | `fixture baseline gate: no regressions`, exit 0, 48 lanes / 1460 pins / 73 honest failures — no report, because there is no surplus |

`audit:script-typecheck` reports **3 errors in `script/m14/swift-uncovered-oracle.ts`** (TS2304 `Edge`,
a concurrent edit in another lane) and **zero** in `run-fixtures.ts`; that failure is not this change's
and was left alone. The retirement print is the one behaviour whose default path (a full
`--update-baseline`) rewrites the artifacts, which is why it was exercised on a deliberately-off record
and the record restored from a saved copy rather than left as written.

## 20. Postscript, 2026-10-11 (eighth): the same rule in the other direction — a FAILING lane the record does not name

§19 made an allowance recorded **too high** say so at the measurement. The other direction was still
silent, and it is the same defect in its purest form: not an allowance the lane no longer needs, but one
it never had. The count gate is `current > base`, and when `base[l] === undefined` that comparison is
inexpressible — no regression line (there is nothing to be greater than), no surplus line, and a verdict
line that still read a clean `fixture baseline gate: no regressions`. A lane in that state is gated by
**no number at all**, so there is not even a stale figure to re-measure. Worse, the failing-set gate
*said* it was covered: the parenthetical for a lane absent from `fixture-baseline.failing.json` read "the
count gate covers it", which is exactly false for a lane the count gate cannot name. The record carries
all 48 lanes and 73 failures today, so nothing is unreported right now — this fixes the latent half, the
one that fires when a lane is added to `LANGS` (every wave in this milestone adds lanes and fixtures) or
when a baseline is written before the lane exists.

**What changed.** `unrecordedLanes(base, measured)` — pure, driven by the selftest like its sibling —
returns the lanes that measure failures and have no row, most failures first, lane name as tie-break so
output is diffable. `reportUnrecorded` prints one line per lane (`perl: measured 8, recorded — nothing`),
the total, and why no count could have caught it. Both calls read the same `base` and the same
`currentFail` the regression rule reads, so the three reports cannot describe different runs. The verdict
line now carries every disagreement the gate can see in one sentence
(`... — but 1 lane(s) carry 3 failure(s)' worth of STALE-HIGH allowance; and 1 failing lane(s) have no row
in the record (8 failure(s))`), which is the property §19 established and this section extends:
`no regressions` cannot be read as "the record describes this tree". `--strict-allowance` now spans both
directions (exit 7, one message per direction, named lanes and counts). The failing-set parenthetical was
made true in all three states: nothing to record (lane measures no failure), IN NEITHER record (points at
the UNRECORDED row above it), count gate covers it (the lane has a row). The selftest grew from 6 to 11
cases, including one that pins the boundary: a recorded lane measuring **worse** than its row is a
regression and is NOT reported here, so the two rules cannot double-count it.

**Report-only by default, for the monotone reason once more.** Standing up a lane is building, not
regressing, so this may not be what turns a run red (exit 4 stays the regression exit); the surplus and
the unrecorded lane are both exit 7 under `--strict-allowance`, still not wired into `npm run verify`.
That is a deliberate asymmetry, not an oversight: the day a gate fails on the work the milestone asked
for is the day its readers stop reading it.

**Exercised** (record copies backed up and restored byte-exact; `md5sum -c` clean after every control):

| control | state | result |
| --- | --- | --- |
| selftest | 11 decision cases (6 allowance, 5 unrecorded) | `selftest: 6/6 allowance cases, 5/5 unrecorded-lane cases`, exit 0 |
| selftest can fail | predicate relaxed to `measured > 0` (a recorded lane counts as unrecorded) | `2/5` unrecorded cases, **exit 1**, naming the three that see it; file restored (`md5sum -c` OK) |
| unrecorded lane, default | `perl`'s row removed; scoped `--lang perl` (measures 8) | `fixture baseline UNRECORDED — 1 lane(s) ... (8 failure(s) no number can compare)`, `perl: measured 8, recorded — nothing`, verdict carries it; **exit 0** |
| unrecorded lane on the interface `npm run verify` runs | same state, **unscoped (all 48 lanes)** | report printed between the summary and the verdict, `perl: measured 8, recorded — nothing`, verdict carries it, **exit 0**, and the run's **73 honest failures are unchanged beside it** |
| unrecorded lane, strict | same state, `--strict-allowance` | `FIXTURE BASELINE UNRECORDED under --strict-allowance: 8 failure(s) in 1 lane(s) ... (lane(s): perl 8)`; **exit 7** |
| the parenthetical that was false | `perl` removed from **both** records, scoped run | `(fixture failing-set gate: lane perl is in NEITHER record and fails 8 fixture(s) — reported above as UNRECORDED; ...)` |
| unrecorded + regression in one run | `perl` unrecorded, `python` 5→10 | `FIXTURE REGRESSION python: 5 -> 10 failures` **exit 4**, with the perl row still reported beside it |
| surplus still fires through the rewritten strict block | `groovy` recorded 3, measures 0 | STALE-HIGH report + verdict, exit 0; `--strict-allowance` **exit 7** with the unchanged message |
| clean tree, the interface `npm run verify` runs | full run, record restored | `fixture-lane gate: 48 ... every one named in LANGS`, plain `fixture baseline gate: no regressions`, **exit 0**, 48 lanes / 1460 pins / 73 honest failures, and **no** STALE-HIGH or UNRECORDED line — because the record describes this tree |

`audit:script-typecheck` is **green again** (exit 0, 0 errors — the other lane fixed the `Edge` errors), so
`run-fixtures.ts`'s contribution is measured, not inferred.

**What this section does NOT claim.** No live lane is unrecorded today: 48 rows, 73 failures, and the
counts agree with `fixture-baseline.failing.json` lane by lane — so the new row is proven by construction
(a row removed on purpose) rather than by a defect in the tree, and its value is entirely about the next
lane that gets added. Two things are still only in stdout, not in the artifact: neither the surplus nor
the unrecorded lane is emitted into the `M14.0.F3` evidence, so a reader of
`validation/m14/results/M14.0.F3.json` sees `data.summary` and `data.details` with no trace of what the
record and the tree disagreed about (the differential gate already emits `data.baselineComparison` for
exactly this reason, and mirroring it here is the natural next step). And the full run rewrites that
artifact every time, so the copy in the tree now differs from the committed one by the wave fixes made
since it was committed — a side effect of running the gate, not part of this change.

## 21. Postscript, 2026-10-11 (ninth): the six moved pins adjudicated — a respelled delegate actor, not a stale pin

§18 recorded the six pins and deliberately did not decide them: stale pin to re-derive, or a real
regression the delegate owes back. **All six are one real regression, in three embedding seams, and no
fixture was changed to get them green.** The measurement that decides it is which rows the three lanes
publish *now* versus which rows their seams are documented to publish.

**What the delegate did.** `4d1da43ed` respelled the JavaScript lane's module-scope actor from the module
basename to the family sentinel `"(file)"` (`real-javascript-analyzer.ts`, `FILE_LEVEL_SOURCE`) — for that
lane's own measured reason, quoted in its own header: 6,694 attached rows carry a source that names a
symbol equal to its own file's basename, so a module-scope edge and a function-scope edge are spelled
identically and no store-side rule can separate them. That is a defensible change for the javascript lane,
whose own fixtures pin the new spelling.

**What the seams require.** Every embedding seam runs the delegate with THIS file's path —
`real-vue-analyzer.ts` and `real-svelte-analyzer.ts` pass `filePath`, `real-html-analyzer.ts` passes the
document's `moduleName` ("the delegate is handed the DOCUMENT's module name as its file path") — so every
module-scope row the delegate produces is a statement about the embedding artifact. `real-vue-analyzer.ts`
says in words what that obliges: *"The delegated rows arrive with the sub-analyzer's module name as their
source (it is the JS module identity), so the seam re-points them — otherwise the one Class symbol would be
unreachable and every script edge would dangle."* Its F8 sweep implements exactly that, matching
`rel.source === moduleName`. After the respelling, no row matches, and `"(file)"` names no symbol in a
`.vue`, `.svelte` or `.html` file — `(` and `)` cannot appear in an identifier at all — so the F8 comment's
predicted failure is what the three lanes were showing: dangling actors where the artifact's own symbol
was intended.

| pin | the row the lane lost | where its seam's obligation is written | verdict |
| --- | --- | --- | --- |
| `vue/options-rename-identity` | `exports ActualName -> api`, `imports ActualName -> ./Child.vue:Child` | F8's comment + its sweep, `real-vue-analyzer.ts` | **real regression** |
| `vue/payload-pins` | `calls payload-pins -> ref` | same sweep (the row is module-scope, the component is the module's identity) | **real regression** |
| `svelte/relationship-kind-catalog` | `imports`, sourced at the component | svelte runs the delegate with `filePath`, so the component symbol is the module identity | **real regression** |
| `html/inline-embedded-code` | `imports -> /lib/helper.js:helper` (offset 30), `calls -> renderBanner`, `uses -> SHIPPED` (offset 41) | the seam hands the delegate the document's module name; the document IS published as a symbol (`kind: module`) | **real regression** |
| `html/embedded-heritage` | `instantiates -> TrackedSeries`, `calls -> describe` | same | **real regression** |
| `html/embedded-origin-marks` | `imports -> /lib/mount.js:mount` (offset 45) | same | **real regression** |

**The fix, in the seams.** Each embedding analyzer now declares `DELEGATE_FILE_ACTOR = "(file)"` and
translates the actor in its delegate-relationship merge (`if (r.source === DELEGATE_FILE_ACTOR) r.source =
moduleName`), immediately before the row is pushed with its `sfcDelegated` / `htmlEmbedded` provenance. It
is TRANSLATION, not suppression: `metadata.fileLevel` and `metadata.scopeName` stay exactly as the delegate
wrote them, so the row is still marked module-scope and the delegate's module name is preserved; only the
actor is respelled as the artifact that owns it. In vue the translation happens at merge time and the
existing F8 sweep then applies the `name:` rename on top — translate first, rename second, so a renamed
component still ends up with the ONE identity F8 requires.

**Why not the other direction.** Re-deriving the pins was available and is the wrong answer twice over.
First, it would have replaced a row naming the component with a row naming a node that does not exist in
the file it came from, to make a green number out of a measured contract — the move this repo forbids by
name ("convert to passes during wave fixes, never by editing expectations to match buggy output"). Second,
reverting the sentinel was not available either: it is pinned by 12 javascript fixtures and 11 more across
graphql (3), kotlin (2), rust (2), scala (4) and zig (3), and its colliding-basename measurement is the
lane's own. The defect is neither side's declaration; it is the seam's missing translation, which is why
the fix is three lines in three files and zero fixture edits.

**Evidence, measured rather than argued.**

| evidence | before | after |
| --- | --- | --- |
| `vue/options-rename-identity` rows (real `ASTEngine.parseFile`) | `exports (file) -> api`, `imports (file) -> ./Child.vue:Child` | `exports ActualName -> api`, `imports ActualName -> ./Child.vue:Child` |
| `html/inline-embedded-code` rows | `imports (file) -> /lib/helper.js:helper` | `imports inline-embedded-code -> /lib/helper.js:helper L32`, `calls inline-embedded-code -> renderBanner L40`, each still `htmlEmbedded=true embeddedLang="js" embeddedLineOffset=30` |
| scoped run `--lang vue,svelte,html`, no flags | 53/7 · 42/10 · 14/4 | **55/5 · 43/9 · 17/1**, and the gate itself names all six: `fixture now passes, allowance retirable with --update-baseline` |
| full run `--update-baseline` (the ceremony) | record vue 7 · svelte 10 · html 4, 73 failures | `fixture allowance retired by this write: 6 failure(s) across 3 lane(s) — vue 7 -> 5, svelte 10 -> 9, html 4 -> 1`; 73 → **67** honest failures; exit 0 |
| the same numbers from a third source | §18's detached worktree at `31b6cd908` measured 55/5 · 43/9 · 17/1 independently | agrees exactly |
| `audit:fixture-provenance` (F7) | — | exit 0, "no fixture introduced or edited by this change fails" |
| `audit:fixture-coverage` (F6), `audit:script-typecheck`, `audit:cluster` (web e2e) | — | exit 0 · 27/27 · exit 0 (0 errors) · exit 0 |
| `audit:carrier-census` (html) | exit 1, 26 UNREVIEWED pairs | exit 1, **26 UNREVIEWED pairs with this change and with `HEAD`'s analyzer** (control run, file restored byte-exact) — pre-existing, not this change |

**What this does NOT claim.** The differential (F5) was not run: the corpora it draws from are absent on
this machine (`error: corpus repo missing: $HOME/fixtures/repositories/grails-core`), so the
three lanes' relationship sets are NOT compared here against their differential baselines by the one gate
that reads these rows other than the fixture lane. The six fixtures are untouched, so the F7 provenance
gate — which obliges a NEW or MODIFIED fixture to pass — would not have caught this either way: as §18
recorded, they were visible only in the fixture counts. And the obligation this section fixes is inherited
by any future embedder: the delegate is loaded by exactly these three seams today (`real-html-analyzer`
loads it lazily), so a fourth one that hands the delegate its own path inherits the same translation, and
nothing yet enforces that.

## 22. Postscript, 2026-10-12 (tenth): `html/idref-carriers` adjudicated — a superseded spelling, and the one row it was right about

§18 recorded the six moved pins and the lane doc recorded `idref-carriers` as *"RECORDED rather than
adjudicated: stale pin or a row the delegate owes back is open"*. §21 took the other three html pins green,
which left `html/idref-carriers` as the html lane's ONLY red pin (17/1) and the lane's whole recorded
allowance. It is now adjudicated, and the answer is both: eight of its nine rows were a **superseded
spelling** and one of them was a **real defect the analyzer owed back**.

**The pin could not have passed under any analyzer.** `html/idref-carriers` and `html/idref-references` pin
the SAME constructs under opposite labels — the first as `uses` with `meta.idrefCarrier`/`meta.idrefList`/
`meta.isIdrefReference`, the second as `references` with `meta.isIdref`/`meta.idrefKind` — and the overlap
is not incidental:

| construct | `idref-carriers` demands | `idref-references` demands |
| --- | --- | --- |
| `aria-labelledby` | `uses` + `idrefCarrier: "*@aria-labelledby"` | `references` + `idrefKind: "aria-labelledby"` |
| `aria-describedby` | `uses` + `idrefCarrier` | `references` + `idrefKind` |
| `td@headers` | `uses` + `idrefCarrier: "td@headers"` | `references` + `idrefKind: "table-header"` |
| `input@form` | `uses` + `idrefCarrier: "input@form"` | `references` + `idrefKind: "form-owner"` |
| `input@list` | `uses` + `idrefCarrier: "input@list"` | `references` + `idrefKind: "datalist"` |

Both files landed in the corpus import `1719ff6b3` and neither was ever reconciled; `idref-carriers` had been
red since the baseline revision `31b6cd908`, i.e. the design it specifies was never the analyzer's.

**The tiebreak is the ontology's own vocabulary, not either file's prose.** `uses` is this repository's
label for a FETCH or a NAVIGATION — every resource carrier, the form action, an observed hyperlink — while
`references` is the address-space naming class (css's `var()` read, scss's `$var`, rust's and typescript's
type references). An IDREF names a NODE in the same document; nothing is fetched and nothing is navigated
to. The analyzer implements `references` + `idrefKind`, `idref-references` argues that ruling in its own
header and pins it with 14 rows, and the two spellings are the same table under two names — the analyzer's
`kind` values (`table-header`, `form-owner`, `datalist`, `output-for`) map one-to-one onto `idref-carriers`'
`tag@attr` spellings. **The F5 oracle cannot arbitrate the label**: `deriveHtmlEdges` derives no IDREF rows
at all (measured — its only non-`contains` output on these documents is the label association and the
resource carriers), so the ontology meaning is the only third source there is.

**The one row it was right about — and the analyzer was wrong.** The `<label for>` association's SOURCE was
`frame.nearestNamed`, the nearest named ANCESTOR, in the only one of the four in-document reference emitters
that did not use the element itself (the resource carriers pass `currentId`, the IDREF class passes
`currentId` as `owner`, the fragment href passes its caller's `source`). The lane's own truth settles it:

| document (through `deriveHtmlEdges`) | oracle | analyzer, before | analyzer, after |
| --- | --- | --- | --- |
| `scope-barriers-and-references.html` (`lbl-later`, `lbl-above`, `lbl-twin`, each with an id) | `uses lbl-later -> declared-below` (and 2 more) | `uses app -> …` | `uses lbl-* -> …` |
| `idref-carriers.html` (`<label id="lbl" for="named-target">`) | `uses lbl -> named-target` | `uses app -> named-target` | `uses lbl -> named-target` |
| `identity-addressable.html` (`<label for="query">`, no id) | `uses search-form -> query` | `uses search-form -> query` | unchanged (the ancestor is the only actor available) |

The fixtures did not merely fail to catch it: `scope-barriers-and-references` PINNED it, in three rows, and
the file predates this wave. That is the shared-premise shape this section's siblings keep finding — the
pin and the analyzer agreed with each other and disagreed with the lane's own oracle. So the pins were
re-derived from the oracle FIRST (`app` → `lbl-later`/`lbl-above`/`lbl-twin`) and the analyzer was changed
second, which is the direction that makes the gate able to fail: after the re-pin the fixture asserted a
value the analyzer did not produce, and only the analyzer change turned it green.

**What survived the adjudication, and why.** `idrefList` is the one fact `idref-carriers` contributes that
`idref-references` does not carry, and it is a real consumer question — rows are one per token, so a
one-token LIST (`aria-labelledby="x"`) and a genuinely SINGLE-valued carrier (`form="outer"`) publish the
same single row. The flag is now set from the content model (ARIA 1.2 / the HTML Standard) rather than from
the corpus: `true` for `aria-labelledby`, `aria-describedby`, `aria-details`, `aria-controls`, `aria-owns`,
`aria-flowto`, `td`/`th` `headers` and `output for`; `false` — and therefore absent from the row — for
`aria-errormessage`, `aria-activedescendant`, `input@form` and `input@list`. The two single-valued
carriers are now pinned as NOT carrying it (`meta.idrefList: null`), so a rule that stamped the flag on
every carrier fails here rather than passing.

**Evidence, measured rather than argued.**

| evidence | before | after |
| --- | --- | --- |
| `html/idref-carriers` rows (real `ASTEngine.parseFile`) | `references panel -> title @28`, … (9 pins unmatched: the fixture asked for `uses`) | all 9 pins matched, including `uses lbl -> named-target @65` |
| `html/scope-barriers-and-references` rows | `uses app -> declared-below` etc. | `uses lbl-later/lbl-above/lbl-twin -> …`, equal to the oracle |
| analyzer vs `deriveHtmlEdges` on the three documents | 3 divergences (the label actors) | 0 divergences |
| `html` lane | 17/1 (18 pins) | **18/0** |
| full run `--update-baseline` (the ceremony) | record html 1, 67 honest failures | `fixture allowance retired by this write: 1 failure(s) across 1 lane(s) — html 1 -> 0`; html leaves the failing set; 67 → **66** |
| full run `--strict-allowance` | — | exit 0, plain `no regressions` (no stale-high surplus left in any lane) |
| `audit:fixture-provenance` (F7) | — | exit 0 — "no fixture introduced or edited by this change fails" (html 18/0 among the changed lanes) |
| `audit:fixture-coverage` (F6) · `audit:carrier-census` · `audit:cluster` (web e2e) · `npm run typecheck` | — | 27/27 · PASS · exit 0 · exit 0 (0 errors) |

**What this does NOT claim.** The differential (F5) still cannot be run here — its corpora are absent
(`corpus repo missing: …/fixtures/repositories/grails-core`) — so the html lane's IDREF rows are not
compared against a differential baseline by the one gate that reads them other than the fixture lane; that
gap is §21's, unchanged. The `references`-vs-`uses` call rests on the ontology's vocabulary and on one of
two mutually exclusive pins, not on an oracle: if `deriveHtmlEdges` ever grows an IDREF notion, this
adjudication should be re-derived from it rather than trusted. And the re-pin of `idref-carriers` IS a
fixture edit: it is justified because the fixture was internally unsatisfiable and because its unique
contribution (`idrefList`, the sweep controls, the frozen `documentMetrics`) was preserved rather than
dropped, but a reader who wants the other reading can reconstruct it from this table alone.

## 23. Postscript, 2026-10-12 (eleventh): the vue and svelte pins triaged — one root cause per cluster, and the pins that only moved shape

§22 took html to 18/0 and left vue (5) and svelte (9) as the largest remaining cluster, on the same
JS-delegate seam. This section does for them what §21 and §22 did for html: **measure each pin's rows
against the lane's own third source before believing anything about why it is red.** No analyzer was
changed and no pin was re-pinned by this section — it is the split the repair has to be built on.

**Method.** Scoped run (`--lang vue,svelte`, which writes no evidence and cannot touch the baseline) for
the exact problem strings; then the rows the lane really publishes, through `ASTEngine.parseFile` (the
runner's SFC entry, not `analyzer.analyze`); then the third source, which differs per pin and is named in
each row below: `src/lsp/evidence_tier.ts` (the tier policy), an in-code ruling (`real-vue-analyzer.ts`),
or a PASSING sibling fixture. One structural fact first, because it changes what a red pin means here:
main's svelte analyzer is ONE revision, and the lane's pin corpus is the **union of several revisions'
contracts** — §2 measured main at 43/52 with no tested alternative dominating. So a red pin does not mean
"main regressed"; it means "main does not carry the revision this pin was written against," and the
question is whether what it asserts is a **measured defect** or only a **shape**.

**vue — 5 pins, 2 root causes.**

| pin | the row measured | verdict | why |
| --- | --- | --- | --- |
| `contract-call-local-shadow` | `references LocalShadow -> shadowedKey @33 meta.isInjectContract` | **OWED** | a local `function inject` shadows Vue's, so no contract exists — and the fixture forbids the row. `real-vue-analyzer.ts:905` stamps the marker from `callee === "provide" ? isProvideContract : isInjectContract`, a NAME-ONLY test with no binding check. |
| `contract-call-name-shapes` | `references ContractShapes -> db @51`; `-> foreignKey @84` | **OWED** | same root cause, two more shapes: a DI DECORATOR `@inject("db")` and an `inject` imported from `vue-router`. Both are calls to something that is not Vue's `inject`, so the contract row is fabricated. |
| `heuristic-evidence-floor` | `uses peek -> value @0.6 isFieldAccess` stored `usage_contextual` | **OWED, but NOT lane-local** | `src/lsp/evidence_tier.ts`'s rule 2 declares the 0.7 floor ("below the floor the edge is a guess and MUST read `inferred`"), while `classifyTier` applies the floor only inside `STRUCTURAL_KINDS` (line 140) and maps `uses` to `usage_contextual` unconditionally (line 142). The pin is right about rule 2 and the disagreement is in the implementation — whose consumer is every lane's STORED class and the LSP tier badge. A policy decision, flagged rather than fixed. |
| `js-default-export-delegate-row` | no `exports` row for line 20 at all | **STALE** | `real-vue-analyzer.ts:577-604` (F19, 2026-10-04) drops every `exports` row whose target is the KEYWORD `default`, measured at 121/121 rows resolving at nothing in vue-element-admin, and the TS delegate has refused the row since M4. The fixture demands exactly that row, with `meta.isDefault`. |
| `ts-default-export` | no `exports` row for line 18 | **STALE** | the same F19 ruling, second spelling (`meta.sfcDefaultExport`). The SFC's component is still published as its own Class symbol; only the row whose only content was the word `default` is gone. |

**svelte — 9 pins, 8 owed and 1 that only moved shape.**

| pin | the row measured | verdict | why |
| --- | --- | --- | --- |
| `object-key-not-a-read` | `uses -> month @57 meta.templateReadSites [44,57]` | **OWED** | `month` is the KEY of a written property on both lines. The fixture's rationale measures the class (49 edges in 38 of 6,439 corpus files; the worst one RESOLVED to a `{#snippet}` name) and forbids it. Main's read walker (`collectIdentifiersFromText`) has no key notion at all. |
| `object-key-not-a-read` (2nd shape) | no `uses -> list` | **OWED** | the spread `[...list]` — the walker's receiver-only dot rule suppresses a name written after `.`, and `...` ends in one; the fixture's rationale records the corpus case (`array-literal-spread-deopt` published nothing for `foo`). |
| `render-tag-argument-reads` | 2 rows of 8 (`calls -> row`, `uses pick -> x`) | **OWED** | a whole read family is absent: none of `alpha`/`beta`/`gamma`/`pick`/`delta`/`obj` is published. |
| `pattern-reads` | 9 rows, none of the 7 expected names | **OWED** | the same shape as above for snippet/pattern binding positions — the population the lane's commit `2f9e5d22b` is titled for ("a binding PATTERN has read positions"). |
| `keyed-each-key-reads` | `uses -> rows`, `uses -> id` only | **OWED** | `{#key …}`'s head expression and a `sortKey` read are not published. |
| `declaration-tag-shadow` | `uses -> counter @44 sites[38,41,44]`; `uses -> doubler @46` (forbidden) | **OWED** | `{let counter = …}` on 41 and `{const doubler = …}` on 42 are template-locals that shadow the script's, so reads on 44/45/46 name the template, not the member — the fixture says only the ARGUMENTS publish. The declaration-TAG shadow is not registered. |
| `handler-param-shadow` | `uses -> evt @38`, `uses -> data @42` (both forbidden) | **OWED** | an arrow parameter and a DESTRUCTURED parameter do not shadow, so both publish endpoints that resolve to nothing. |
| `dynamic-target-sites` | `instantiates -> Widget @33`, `-> Panel @30`, no site map | **OWED** | the rows exist at the right targets and lines (last-site rule, 33 not 25) but `metadata.dynamicTargetLines` is missing — and the fixture's own comment calls it "the same additive shape the template-read map" has, i.e. the sibling mechanism IS implemented on one side and not the other. |
| `dedupe-template-read-record` | `uses -> count @26 conf 0.6 sfcDelegated`, no site record | **OWED (corrected, see below)** | the fixture wants the SUPPRESSED template site recorded on the delegate's surviving row (`isTemplateRead: true`, `templateReadLines: [29]`), and that mechanism does not exist: `isTemplateRead` occurs nowhere in `src/ast`, and the lane's `seenUses` dedupe (`real-svelte-analyzer.ts:1049`) still drops the losing row with nothing recorded — the exact 384-of-5,781 loss (6.6%) the fixture was written from. An earlier draft of this table filed it as a spelling; grepping the analyzer for the marker is what corrected it, and the correction is left visible because the two fixtures it sits between use the SAME `templateReadLines` key for two different roles (a site list on a template row, and the dropped-site record on a delegated one). |
| `multi-site-read-record` | `total @39 [37,38,39]`, `greeting @46 [45,46]`, `name @46 [45,46]` | **STALE (form only)** | the site SETS match the pin exactly; only the key name moved (`templateReadLines` -> `templateReadSites`), and its two single-site rows (`promise @41`, `snapped @48`) additionally pin a ONE-element array where the ratified design omits the key entirely. The fixture's own text asks for both readings — its comment says "`snapped` is read once, so it must NOT carry a list" while its expectation pins `templateReadLines: [48]` — which is a second reason the array's presence is a form question and not a fact question here. |

**What makes the metadata spelling a SHAPE and not a defect: a passing sibling pins it.**
`svelte/template-read-collapse` PASSES and pins `templateReadSites` + `templateReadSitesCollapsed` on a
three-read name, a two-read name and a single-read name whose `null` pin requires the key to be ABSENT.
That is the same test §22 used for the IDREF label — a green pin in the same lane that argues the design
— and it is why the 1 form pin above is repinnable while the 8 owed rows are not: re-spelling a pin to
match the analyzer is forbidden, re-spelling one to match a ratified GREEN sibling is not.

**The read RULES are not a spelling, and the revision history says so.** Compiled over the lane's own
commits: main's svelte blob (`e1614455b`, HEAD) contains **0** occurrences of `ternary`, while the two
revisions that closed these exact defects — `c1ac1a043` ("four measured `uses` defects closed, one lossy
projection recorded") and `2f9e5d22b` ("a binding PATTERN has read positions") — contain **15** each. The
ternary-aware key rule and the pattern read positions exist ONLY there, which is why main publishes an
object key as a read and loses whole read families, and why the fixture's own rationale is careful about
the character the rule has to be aware of (`? :` and `: ` are the same `:`).

**What this does NOT claim.** No repair is landed here, so the 14 pins are still red; the tier-floor pin is
referred to a policy decision rather than fixed, because its blast radius is every lane's stored
`evidenceClass` and the LSP badge, not svelte or vue; the lane's own oracle cannot arbitrate the two
read rules at all, because `script/m14/svelte-truth.ts` scans template text with the same naive walker
(`scanExpression(...).names`, one line per name, no key notion and no site map), so the evidence there is
the corpus measurements the fixtures carry rather than a third derivation; and `declaration-tag-shadow`'s
`counter` site list can only be re-derived AFTER its shadowing defect is fixed, since the wrong sites are
a consequence of the same missing shadow registration.

## 24. Postscript, 2026-10-12 (twelfth): the vue contract pins REPAIRED at the cause, and the svelte rules found on a branch

§23 measured the 14 red pins and split them into owed root causes and stale shapes. This section lands the
smallest owed one, and answers the largest one — the missing svelte read rules — with a MEASUREMENT rather
than a rewrite, because the rules turn out to exist.

### vue: the provide/inject NAME test is now a BINDING test (2 pins green, 1 mutant added)

F21, `src/ast/real-vue-analyzer.ts`. §23 filed `contract-call-local-shadow` and `contract-call-name-shapes`
as one root cause: the pass matched a call by its CALLEE TEXT alone, so `@inject("db")` (a DI decorator),
`import { inject } from 'vue-router'` (a foreign module's function under Vue's name) and a local
`function inject` that shadows the global each fabricated `references <Component> -> <key>`. The guard is
the binding question that name implies, in three ordered branches: a decorator is a syntactic position and
decides first; a name BOUND by an import is decided by its module (`vue`, `vue/…`, `@vue/…` keep
publishing, anything else suppresses); an UNBOUND name reaches the local-declaration test, where a
TOP-LEVEL declaration of the same name is the shadow. Unbound still publishes — that is what keeps the
guard from being a blanket suppression, and `contract-call-local-shadow`'s own positive row
(`provide('bareProvideKey', …)`) depends on it. A NESTED declaration deliberately does not count; it
shadows nothing in a sibling scope.

**The corpus says what the guard costs, and it is nothing.** Through the SFC seam over all 1,162 `.vue`
files of the restored draw (element-plus 1,009 / vue-element-admin 131 / vuejs 11 / vue-core 11), there are
96 provide/inject call sites and **all 96 are `import … from 'vue'` bindings** — zero local declarations,
zero foreign modules, zero unbound, zero decorators, zero member calls. So on the corpus this suppresses
nothing; the fixtures are the whole of its effect. The three shapes are what the corpus CANNOT show, which
is the point of the two fixtures.

**State after F21: vue 59 pass / 1 fail.** The remaining one is `heuristic-evidence-floor`, the tier-floor
pin §23 referred to `src/lsp/evidence_tier.ts` rule 2 — still referred, because its blast radius is every
lane's stored `evidenceClass` and the LSP badge, not this lane.

**Mutant:** `vue/inject-name-guard-revert` (`script/m14/mutate-analyzer.ts`), CAUGHT by
`vue/contract-call-name-shapes` (2 `db` forbid rows) and independently by `vue/contract-call-local-shadow`
(`shadowedKey`). It cannot revert the defect by duplicating what the guarded output holds — the defect is
the PRESENCE of rows that are now absent, so it re-derives them from the SOURCE the way the pre-fix pass
ran, skipping a key that already has a contract row so the revert adds only the suppressed rows. A
revert-by-result mutant would have SURVIVED here; that is the same failure mode `vue/computed-key-guard-drop`
records. All 56 vue mutants CAUGHT after the change (`BB_MUTANT_ONLY="vue/"`).

### svelte: the eight read-rule pins are a REVISION GAP, and `analyzer/SVELTE` is the revision

§23's svelte table filed 8 pins as owed read rules and named the lane commit that is titled for one of them
(`2f9e5d22b`, "a binding PATTERN has read positions"). That commit is on `analyzer/SVELTE` and is **not an
ancestor of main**: the branch tip is `c20ef0b4c` (2026-10-04 20:11), main's analyzer was re-shaped by the
fold `78a95ab8c` (2026-10-07 02:47), and the pin corpus arrived at `1719ff6b3` (2026-10-07 04:11) carrying
the BRANCH's contract. So the pins are not wrong about a hypothetical: every one of them is a contract some
revision actually met.

**Measured, two ways.** A whole-file swap (branch `src/ast/real-svelte-analyzer.ts` in place of main's,
fixtures unchanged) scores the SAME 44 pass / 8 fail as main — and a DIFFERENT eight. That is the finding:

| | pins |
| --- | --- |
| **the branch FIXES (7)** | `declaration-tag-shadow`, `dynamic-target-sites`, `handler-param-shadow`, `keyed-each-key-reads`, `object-key-not-a-read`, `pattern-reads`, `render-tag-argument-reads` |
| **the branch BREAKS (7)** | `bare-module-block`, `handler-literal-not-a-call`, `multi-site-read-record`, `namespace-component-tags`, `props-default-value-not-a-prop`, `relationship-kind-catalog`, `template-read-collapse` |
| **red under both (1)** | `dedupe-template-read-record` |

Neither revision dominates, so this is a PORT, not a merge — and the two obvious shortcuts are both wrong.
Taking the branch file wholesale would trade 7 green pins for 7 red ones. Re-pinning the 8 fixtures to
main's spelling would not repair them either: the rows are MISSING from main's output, not mislabelled
(`keyOf`/`sortKey`/`sortKey`'s key clause, the 7 `pattern-reads` names, `dynamicTargetLines`), and the two
forbid classes (`evt`/`data` handler params, `doubler` declaration tag, `month` object key) are real
fabrications main still publishes.

**The port map, which is small.** `comm` over the two files' private methods gives five branch-only
methods and three main-only ones, and the branch-only set is exactly the missing rules:
`collectBindingPattern` (a binding pattern's read positions, with `object_assignment_pattern` handled as the
default-value shape rather than as a binding), the key-clause read inside `collectEachExpression`
(`{#each rows as row (keyOf(row))}` — the branch's own comment records that main published `uses rows` and
nothing for `keyOf`), `withArrowParams` + `onHandlerLeaf` (the per-expression shadow set that makes `evt`
and a DESTRUCTURED `data` template-locals), `field`-side declaration-tag shadow registration, and
`eventCarrierName`/`lineField` for the dynamic-target site map. The three main-only methods
(`attributeValue`, `collectShadowNames`, `importLocalBindings`) are the newer work the port must not lose —
together with the uncommitted `(file)` actor translation in this working tree, which is what
`relationship-kind-catalog` pins.

**Two spelling decisions the port has to make, both already settled on main.** (1) The site map's key:
main emits `templateReadSites` (+ `templateReadSitesCollapsed`) and the branch emits `templateReadLines`;
`multi-site-read-record` and `template-read-collapse` — the only two fixtures that pin the map and PASS on
main — pin `templateReadSites`, so main's name is the ratified one and the 7 branch-fixed fixtures must be
RE-PINNED to it, along with the single-site convention (main omits the list entirely when there is one
site; `k`/`v`/`store`/`after` are pinned with a one-element list today). (2) `line_number` stays the LAST
collected site — `multi-site-read-record`'s own forbid row says moving it to the first "would be a
payload-baseline change, not a fix, and the migration is deliberately not taken" — and the pins agree with
it (`object-key-not-a-read` wants 66/54/57 for site lists ending at 66/54/57).

**One pin needs a mechanism, not a port.** `dedupe-template-read-record` is red under both revisions
because `isTemplateRead` occurs nowhere in `src/ast`: it wants the SUPPRESSED template site recorded on the
delegate's surviving row (`uses -> count @26 conf 0.6 sfcDelegated` + `isTemplateRead: true` +
the site list `[29]`), which is the 384-of-5,781 loss §23 measured. Naming the key `templateReadLines`
there and on a template row is why §23's correction note is left in place: the same key carries two roles.

**INSTRUMENT FLAW, recorded because it invalidated a census.** `script/m14/lane-analyzer-probe.mjs`
cannot see a branch analyzer for vue, svelte, html, toml or markdown: the runner's SFC path
(`script/m14/run-fixtures.ts:641-651`) calls `ASTEngine.parseFile`, which resolves the analyzer from THIS
tree's registry, and the injected override is used ONLY when it carries a `transform` — i.e. as a mutant.
The probe therefore measured main against main and reported `svelte: HEAD 44/8, BRANCH 44/8, FIXED BY BRANCH
(0)`, which reads as "no branch carries the work" and is what `docs/LOST-ANALYZER-CENSUS.md` concluded for
these lanes. The swap above is the measurement that probe was meant to make, and it says 7 of 8 instead.
For these five languages the probe needs the branch analyzer handed to the seam (an env-selected analyzer,
or a file-level diff like this one) before any "FIXED BY BRANCH (0)" line is believed. Recreate the
measurement with: `git worktree add --detach /tmp/wt/svelte analyzer/SVELTE`,
`ln -sfn "$PWD/node_modules" /tmp/wt/svelte/node_modules`, copy the one file over, `--lang svelte`, then
restore. The worktree is left in place at `/tmp/wt/svelte` for the port.

### svelte: the one pin the port does NOT need — `dynamicTargetLines` landed (F22), svelte 45/7

The port above is a walker merge; the eight pins are not all of that size, and the smallest one is not
even a port. `dynamic-target-sites` pins rows that already EXIST at the right target and the right (last)
line — what it pins is a second field, and main already has the mechanism it needs on the read side:
`thisTargets` was `Map<string, number>` beside a site map, exactly as the read walker was before its own
site map. So F22 adds the parallel `thisTargetSites` map (`src/ast/real-svelte-analyzer.ts`), records each
`this={X}` value's line into it, and emits `metadata.dynamicTargetLines` on the resolved `instantiates`
row. `line_number` keeps the LAST site, which the fixture pins in both directions (33 for `Widget`, and
forbid rows at 25/26/27 so a change to the first site cannot look like an improvement).

**One divergence is recorded rather than smoothed.** F22 emits the site set for a SINGLE site too
(`dynamicTargetLines: [30]` for the fixture's one-site `Panel`), because that is what this fixture pins —
while `multi-site-read-record` pins the read map's absence for a single site (`templateReadSites: null`).
The two conventions therefore disagree, and unifying them is a payload change on one fixture or the other
rather than a fix; the round that decides which shape a consumer should read owns it.

**Mutant:** `svelte/drop-dynamic-target-sites` — and it is deliberately not
`svelte/drop-dynamic-this-instantiates` next to it. That one deletes the EDGE, which every gate can see;
this one restores the pre-fix PAYLOAD exactly (the edge survives at the right target and line, and only the
site key disappears), which is the state the lane shipped. CAUGHT by `svelte/dynamic-target-sites`;
**all 32 svelte mutants CAUGHT** after the change (`BB_MUTANT_ONLY="svelte/"`), with the harness's own
baseline reading 7 failures — i.e. the current tree.

### svelte: the handler-param shadow landed too (F23), svelte 46/6 — and the FIRST svelte fixture re-pin

`handler-param-shadow` is the second family the swap showed the branch holding, and it is small for the
same reason: the ERRORS are fabricated rows, not missing ones. The walk published an event handler's own
arrow parameters as component members — `<button on:click={(evt) => { payload = evt }}>` emitted
`uses -> evt`, an endpoint that resolves to nothing in the file or the corpus — and a DESTRUCTURED
parameter is the same defect one shape further in (`({ data }) => { payload = data }` published `data`,
the script's own `let data = 3`). F23 adds `eventCarrierName`, `withArrowParams` and a pure-String
`arrowParams` (`src/ast/real-svelte-analyzer.ts`), and widens the shadow set **per expression** at
`collectExpressionIdentifiers`, only for the two spellings that bind a parameter. Per-expression is the
whole design: the set cannot leak into a sibling, which the fixture pins by reading `after` outside a
handler that binds `after` as a parameter. Corpus-measured at exactly **1** such edge in 6,439 files
(`packages/svelte/tests/compiler-errors/samples/store-template-expression-scope/main.svelte`), so the
fixtures are the evidence here and the corpus is not.

**The first svelte fixture re-pinned, and it is a FORM change.** `handler-param-shadow` had pinned the read
record under the pre-fold key (`meta.templateReadLines`). The four rows were renamed to the ratified
`templateReadSites`, and its two ONE-ELEMENT arrays (`store` [36], `after` [46]) became `null` — main
omits the map when there is one site, and `null` is this lane's spelling for that (`multi-site-read-record`
writes it the same way). **The assertions did not weaken**: those two rows still pin `line_number`, which
is the only site, and the multi-site rows (`payload` [38,42], `save` [40,44]) keep their full sets. The
fixture's own `authoredNote` records the rename, and with it §23's measured caveat that this harness's
generic `v === null` branch runs BEFORE the `meta.` branch, so `meta.x: null` matches on the other keys
alone and cannot assert a key's ABSENCE — a `null` here is a placeholder for a convention, not a negative
assertion. This is the re-pin §23 predicted would be part of the port; it is landing per-family rather
than in one sweep.

**Mutant:** `svelte/handler-param-not-shadowed` — re-derived from the SOURCE (the defect is the PRESENCE
of rows the fix removed), skipping a name that already has a `uses` row so it adds only the suppressed
endpoints. Its first revision SURVIVED: the value was sliced from the attribute NAME, so the mustache
brace put the arrow's `=>` one bracket deep and no parameter was found. That is recorded in the mutant
itself, because it is the failure mode a source-derived revert has. **All 33 svelte mutants CAUGHT**
after both new mutants (`BB_MUTANT_ONLY="svelte/"`, harness baseline 6 failures — the current tree).

### svelte: three more families, and the "walker merge" turns out to be three LOCAL rules (F24-F26), svelte 49/3

§24's port map called the remaining failures one walker merge. Three of them are not: they are local rules
at three existing sites, each landed below with its own mutant and its own measurement. What survives of
the merge claim is deliberately narrowed at the end of this section.

**F24 — a `{@render}` tag's ARGUMENTS are reads** (`src/ast/real-svelte-analyzer.ts`, the `render_tag`
branch). The branch published the CALLEE as a `calls` edge and read nothing else, so a snippet call's
inputs were invisible: `{@render row(alpha)}` emitted `calls -> row` and not one `uses`. The argument list
is now sliced off at the tag's first `(` and collected through the lane's ordinary text collector, at a
base line of the tag's row PLUS the newlines before the arguments — so the multiline form's identifiers
land on their own lines (41/42, not the tag's 40), which the fixture pins by forbidding the tag-line
spelling on both. Three boundaries are the fixture's own forbid rows and each is reused rather than
re-implemented: the CALLEE is excluded (it belongs to the `calls` edge), a member LEAF stays out
(`row(obj.eps)` reads `obj` — the collector's dot rule), and a SNIPPET PARAMETER stays out (`u`, the shadow
set). Mutant `svelte/render-tag-argument-reads-dropped`, caught by the fixture.

**F25 — the each KEY expression is a read** (`collectEachExpression`). The grammar keeps the key inside the
second fragment (`{#each rows as row (row.id)}` gives `row (row.id)`), so the whole fragment went through
the flat word collector with two measured consequences over the 699 keyed occurrences in 486 corpus files:
a FALSE SHADOW (every word of the key registered as a template-local, so `(todo.id)` silenced a member
named `id` for the whole block) and NO READ (`{#each rows as row (keyOf(row))}` published `uses rows` and
nothing for `keyOf`). The head is now the binding list and the parenthesised tail an EXPRESSION, on the
same S1 argument the collection is; the collector's dot rule keeps the ordinary `(row.id)` contributing
nothing, which the fixture forbids at line 49. Mutant `svelte/each-key-expression-not-read`, caught by the
fixture.

**F26 — a declaration tag BINDS** (`collectExpressionIdentifiers`). `{let counter = …}` / `{const doubler = …}`
(Svelte 5.36) were read as ordinary mustaches, so the declared name was published as a member READ of the
declaration that shadows it, and the shadow was never registered — which is why a LATER sibling using the
name still resolved to a member. `declarationTagSplit` requires a leading `let`/`const` with a WORD BOUNDARY
and a top-level `=` (so `{letter = 5}` is an assignment, not a tag, and `{constantly}` is untouched); the head
is registered into the walk's shadow set BY MUTATION, which is what carries it to the following siblings
exactly as the `{#each}` var list does, and the tail is an initialiser expression collected as reads. Mutant
`svelte/declaration-tag-not-bound`, caught by the fixture's `uses -> doubler` forbid row; the mutant's own
description records that it reproduces the fabrication half only, since a suppressed read is absent from the
output a result transform could restore.

**The second fixture re-pinned, same shape.** `declaration-tag-shadow` moved to the ratified
`templateReadSites` key, with its four one-element arrays ([38], [39], [45], [46]) becoming `null` for the
reason F23 records. `line_number` still pins each site, so nothing was relaxed.

**Mutants:** all four new ones CAUGHT, and **all 36 svelte mutants CAUGHT** (`BB_MUTANT_ONLY="svelte/"`,
harness baseline 3 failures — the current tree). Two of the four mutants survived their FIRST revision and
both are recorded inside themselves: `svelte/render-tag-argument-reads-dropped` counted brace depth from 0
instead of 1 for the tag's own brace, so the closing `}` drove it to -1 and no tag ever ended; and
`svelte/handler-param-not-shadowed` sliced the value from the attribute NAME, putting the arrow's `=>` one
bracket deep. That both were caught by their own fixtures only after those fixes is the mutation suite
doing its job on the mutants rather than on the analyzer.

### svelte: the walker-core rule WAS one rule, and the line-43 disagreement ADJUDICATED first (F27), svelte 50/2

§24 left two things open here: an object-key rule the branch holds, and a site-list disagreement at line 43
that I said should be measured before the rule was written, because otherwise the fix would land and the pin
would still redden for a reason nobody had adjudicated. **Measured first, and it settles the direction:**
line 43 of `object-key-not-a-read` is `<div class={{ foo: true, bar: false }}></div>`, so `foo` and `bar`
there are KEYS. The analyzer published ``foo`@[43,47,54,66]` and `bar`@[43,47,54]`, and the pin wants
`[47,54,66]` / `[47,54]` — i.e. the analyzer's extra site WAS the defect in its scope, the pinned lists
are the post-fix truth, and the whole family is ONE root cause. No pin was changed for that reason.

**F27 — the positional, ternary-aware object-key rule, plus the spread clause of the receiver rule**
(`collectIdentifiersFromText`). A word is a KEY iff the next non-space character is `:`, the innermost open
bracket is `{`, and no `?` is pending at that depth; a `:` that resolves a pending `?` is a ternary else
and leaves the word a read. The branch's own reasoning was adopted whole, including why it has to be
positional: `? :` and `: ` are the same character, and a COMPUTED key (`{ [k]: v }`) must stay reads
because its innermost bracket is `[`, not `{`. The receiver rule's other half came with it: a run of
EXACTLY one dot is a receiver, `?.` is still a receiver, and three dots is a SPREAD — which is a READ, so
`[...list]` publishes `list` again. The walk's `brackets`/`ternary` stacks are parallel to `stack` by
construction, and `(`/`[` are pushed only for this rule.

**Measured both directions on the fixture**: `foo` [47,54,66] and `bar` [47,54] now match the pin exactly,
`month` (a key on 44 and 57) is GONE — it was the fixture's forbid row — and `list`@60 appears, which is
the spread read. **Third fixture re-pinned, same shape** (`templateReadSites`, and this file's five
one-element arrays [50], [50], [60], [63] → `null`).

**Mutant:** `svelte/object-key-is-a-read` reverts BOTH halves, because they are one defect in one walker.
Its MEASURED catch set is recorded inside it and is deliberately wider than the fixture it was written for:
`svelte/object-key-not-a-read` plus `svelte/declaration-tag-shadow` and `svelte/template-attr-shapes`,
because its key scan follows `word:` inside any brace on a template line, which is coarser than the
innermost-bracket rule it reverts. That is written down because a mutant whose description claims a narrower
catch than it has is the same species of overstatement this registry exists to prevent.

**What this does NOT claim, narrowed again.** svelte is **50 pass / 2 fail**. `pattern-reads` is the last
walker piece — the branch's `collectBindingPattern`, with read positions (its commit `2f9e5d22b` is titled
for it) — and `dedupe-template-read-record` needs the `isTemplateRead` mechanism that exists nowhere in
`src/ast`. Both typechecks are clean (`tsc --noEmit` and `-p tsconfig.scripts.json`, the latter being the
only one that covers the mutant registry), and all **37 svelte mutants CAUGHT**. The branch swap was a
measurement, not an edit: main's analyzer was restored byte-for-byte from a copy taken before it, and the
differences from HEAD now are the pre-existing uncommitted 28-line `(file)` translation plus F21-F27.

## 25. Postscript, 2026-10-12 (thirteenth): the two svelte pins F28/F29 named, and the vue grammar pair the census named

§24 ended with svelte at **50 pass / 2 fail** and named both remaining pins precisely: `pattern-reads`
("the last walker piece — the branch's `collectBindingPattern`, with read positions") and
`dedupe-template-read-record` ("needs the `isTemplateRead` mechanism that exists nowhere in `src/ast`").
This section is that pair, plus the one item the vue lane's own completeness gate had been reporting
without a fixture behind it. **Both lanes are now green on fixtures: svelte 52 pass / 0 fail, vue 60 pass /
1 fail** (the single vue failure is `heuristic-evidence-floor`, still the referred `src/lsp/evidence_tier.ts`
policy question §23 filed and NOT a lane-local defect).

**F28 — the binding-pattern split (`src/ast/real-svelte-analyzer.ts`).** Every site that writes a pattern
(`{#each … as …}`, `{#await … then …}`, `{:catch …}`, `{#snippet name(…)}`, `{let …}` / `{@const …}` heads)
handed its text to `collectShadowNames`, which put EVERY word in the shadow set. Two failures came out of
one rule: a pattern's READ positions were never published, and a property NAME became a fabricated
template-local that silenced a real member read for the whole block. The replacement is
`collectBindingPattern`, a positional left-to-right pass that MUTATES the shadow set as it binds — which is
the whole design, because that is what makes the ordering rule hold: in `{ idx, [idx - 1]: last }` the
computed key's `idx` reads a template-local by the time it is scanned, so it publishes nothing, and a reader
that collected all reads before all bindings would ADD a false edge on the first entry of every such
pattern. The split itself is: computed key `[k]` reads `k`; a default `x = expr` binds `x` and reads
`expr`; a property name is neither; a value position binds, recursively; `...props` binds; a TypeScript
annotation (`c: number = 4`) is neither; a string default reads nothing. Supporting pure-String helpers
(`skipQuoted`, `matchingBracket`, `splitTopLevel`, `patternKeySplit`) came with it, and `patternKeySplit`
REPLACES the F25 `indexOf("(")` / `lastIndexOf(")")` split, which would have mis-cut a key clause on a
pattern carrying its own call default (`{ [k]: v = f() }`).

**F29 — the dropped template read is recorded, not lost (`recordDroppedTemplateRead`).** The graph dedupe
keys on `type|source|target` and keeps the FIRST row; the script delegate's rows are pushed in 3b and the
template pass runs in 3c, so a member read in BOTH script and template lost its template row with nothing
recorded. Measured at 384 of 5,781 template reads (6.6%) on the 3,085 corpus files where an independent
oracle's shadow model is provably equivalent to this analyzer's. The survivor now gains
`isTemplateRead: true` and `templateReadSites: [ … ]`; `line_number` and `confidence` are NOT moved, and
the graph contract (one edge per triple) is unchanged.

**A divergence recorded rather than smoothed, the same way §24 recorded `dynamicTargetLines`.** The
dropped-site list is written even for a SINGLE site, while the read map writes `templateReadSites` only for
MORE than one. The two are not inconsistent and the reason is `line_number`: on a template-read row it IS a
site, so a one-element list says nothing; on this survivor it is the SCRIPT's line, so the list is the only
place a single template site exists. A round that unifies the conventions would be changing a payload on
one of the two fixtures, not fixing a defect.

**Three fixtures were RE-PINNED, all in FORM and none by watching the analyzer.** `pattern-reads`,
`declaration-tag-shadow` and `dedupe-template-read-record` pinned the read record under the pre-fold key
`meta.templateReadLines`; the lane's ratified key is `meta.templateReadSites`, which is what the two
fixtures already green on main pin it with (`multi-site-read-record`, `template-read-collapse`). The
MULTI-site sets were kept whole (`labelKey` [73,102], `th` [78,88]) and the one-element arrays became
`line_number`-only rows, which is the read map's own convention. Nothing weakened: for a single site
`line_number` IS the site, and §23 already recorded that this harness's generic `v === null` branch runs
before its `meta.` branch, so a `null` could not have asserted a key's ABSENCE anyway. §24 set this rule —
"re-spelling a pin to match the analyzer is forbidden, re-spelling one to match a ratified GREEN sibling is
not" — and `dedupe-template-read-record`'s one-element list is the one case where the surviving convention
was decided by what the field has to mean instead, and it is argued in the fixture's own `authoredNote`.

**The vue half: the grammar's ERROR/MISSING pair is classified AND exercised.** `completeness-inventory.ts`
section A reports every node type a lane's spec leaves in no bucket, and the vue grammar's error-recovery
pair was in no bucket while svelte — which shares this seam's script machinery — had classified both. They
are HANDLED, and that is a measurement: `real-vue-analyzer.ts` walks `rootNode.hasError` and emits one
warning per `n.type === "ERROR" || n.isMissing` node at that node's OWN range. Classifying them exposed the
half that was missing: `verify-fixture-coverage.ts` (F6, no dead analyzer literal) demands a fixture that
EXERCISES each handled type, and no vue fixture source carried a markup-level parse error —
`script-error-offset` pins a SCRIPT-side error from the JavaScript sub-parser, which exercises neither vue
node. `vue/error-recovery` supplies both shapes (measured on the pinned grammar: `<div class= >` is an
ERROR at 29:13, an unclosed `<p` is a zero-width MISSING `>` at 30:5) and pins that the component's
identity and its script declarations SURVIVE a template that does not parse.

**Measured state after this round.** svelte **52 pass / 0 fail**, 39 mutants CAUGHT (two added:
`svelte/binding-pattern-reads-lost`, which deletes the pattern read positions from the SOURCE and is honest
that it reproduces the lost-read half only, since a suppression cannot be restored by a result transform on
the read side; and `svelte/dropped-template-read-not-recorded`, a result transform because the pre-fix
state IS the absence it removes), completeness sections A-H 8/8 on 76 types, coverage `handled=34
uncovered=0 ambiguous=0 deadLiterals=0`. vue **60 pass / 1 fail**, 39 types, sections A-H 8/8, coverage
`handled=22 fixtureTypes=29 uncovered=0`. Both lanes: provenance clean on the fixtures this round touched,
cross-language consistency verified (including vue/svelte builtin-set parity), analyzer-docs FULLY complete
on all eight sections, and both typechecks clean (`tsc --noEmit` and `-p tsconfig.scripts.json`, the latter
the only one that covers the mutant registry).

**The allowance ceremony was then taken, and its write verified twice.** `bun run
script/m14/run-fixtures.ts --update-baseline` (FULL suite, 50 lanes, exit 0) rewrote
`validation/m14/fixture-baseline.json` and `validation/m14/fixture-baseline.failing.json`, in its own
words retiring **13 failure(s) across 2 lane(s) — vue 5 -> 1, svelte 9 -> 0**. The diff is exactly that and
nothing else: every other lane's count byte-identical, vue's failing list narrowed from five names to
`heuristic-evidence-floor` alone, and svelte's list emptied (`[]`) — the nine pins §24 left red are gone
from the record because they now pass. **Reproducibility was measured, not assumed:** a FULL run
afterwards WITHOUT the flag prints `fixture baseline gate: no regressions` with no stale-high report and no
unrecorded-lane report (i.e. the record equals the measurement), and both artifacts are SHA-256 identical
to the ones the write left behind. A scoped run cannot do this — it refuses to write the baseline
precisely because the write would drop every lane it did not measure.

**What this does NOT claim.** The tier-floor pin remains the lane's one red row and remains REFERRED: its
consumer is every lane's stored `evidenceClass` and the LSP badge, so it is a policy decision, not a svelte
or vue defect. And no corpus-wide re-measurement of the `uses` family was run this round: the counts in the
lane docs are the 6,439-file census §23/§24 cite, and F28's own effect on the corpus (35 oracle-named
unpublished reads, 27 of them this class, at 81 pattern sites) is the measurement that justified the fix
rather than a post-fix re-census.

## 26. Instrument repair, 2026-10-12: a scoped completeness run could speak for the whole fleet

Found while doing §25's allowance ceremony, and recorded because it is the same class of defect this
directory's gates exist to refuse. `script/m14/completeness-inventory.ts` writes
`validation/m14/results/M14.0.SPEC.json`, whose `data.languages` is a REPO-WIDE claim — one row per gated
lane — and `--lang X` measures exactly one of them. Two defects, both measured:

1. **The scoped run wrote the canonical artifact.** Measured: after
   `bun run script/m14/completeness-inventory.ts --lang vue`, the artifact held **1** language (`vue`)
   while the committed one holds **21**. A smaller claim published under the same name, which is exactly
   what `verify-analyzer-docs.ts` refuses ("DEV-SCOPED run … the canonical …json was NOT touched") and what
   `mutate-analyzer.ts` refuses for M14.0.F4. The gate even knew it was scoped — it stores
   `__SCOPED_LANG` and prints `scoped run — M14.0.SPEC evidence is NOT written` beside a failing section
   list — so the banner and the write disagreed with each other.

2. **A full run could never refresh it.** `if (anyFailure) process.exit(1)` ran BEFORE `emitEvidence`, and
   **22 of the 26 gated lanes fail a section** today (perl's E/F await their canonical sweep), so the
   canonical artifact was unreachable by a full run: every attempt exited first. That is why the committed
   artifact recorded 21 languages from 2026-09-16 while the gate had grown to 26 — a stale snapshot, not a
   measurement. Measured directly: a full sweep completed all 26 lanes, printed every section failure, and
   exited **1** with `M14.0.SPEC.json` byte-untouched.

**The repair, both halves in one file.** A scoped run now prints the dev-scoped banner (which was already
there) AND does not write; the verdict is unchanged. The full run emits FIRST and exits 1 after, so the
exit code still fails the fleet while the artifact records what was measured — a lane that fails a section
can no longer make the artifact unrefreshable.

**Verified, both paths, with the artifact's hash as the witness.** Scoped FAILING lane
(`--lang make`, 5/8 sections): exit **1**, all eight `pass|FAIL section-…` rows printed (the shape
`verify-perl-wave.ts` parses), banner printed, artifact SHA-256 byte-identical. Scoped PASSING lanes
(`--lang svelte` 8/8, `--lang vue` 8/8): exit 0, banner printed, artifact byte-identical. `tsc --noEmit -p
tsconfig.scripts.json` clean (the ratchet's own command).

**The first cut of the repair was WRONG, and running it is what said so.** The edit made the early
`process.exit(1)` conditional on `!SCOPED_RUN` instead of REMOVING it, so an unscoped failing run still
exited before emitting — the second half of defect 2 was documented as fixed while the code still had it.
The full sweep proved it: 26 lanes reported, `M14.0.SPEC.json` mtime unchanged, exit 1. The early exit is
gone now and the same full sweep was re-run: **26 lanes measured, artifact WRITTEN (153,094 bytes,
`regeneratedAt` 2026-10-12T14:34:34Z), exit 1** — the verdict and the record disagree on purpose, which is
the whole point. Recorded rather than quietly corrected, because a repair claimed from source-reading and
never executed is exactly the class this document exists to catch.

**The defect CLASS was audited, not just the instance.** Every gate under `script/m14` that writes a
canonical `validation/m14/results/<ISSUE>.json` AND accepts a scope flag was checked for the same hole, by
reading its write site rather than its banner: `verify-fixture-coverage.ts` refuses (and even refuses
`--update-baseline` on a scoped run — its comment records that "a `--lang` run once replaced the canonical
artifact with a one-language file"), `verify-analyzer-hygiene.ts` refuses (its comment records that "the
canonical artifact was last written by an erlang-scoped run"), `verify-corpus-census.ts` refuses
("`#886`-class guard"), `verify-grammar-leaves.ts` writes a lane-scoped path by design, `differential.ts`
writes only its cold-pool cache, and `mutate-analyzer.ts` refuses to write M14.0.F4 from a
`BB_MUTANT_ONLY` run. **`completeness-inventory.ts` was the only one missing it** — the same failure three
sibling gates had already been repaired for and written down, which is the strongest argument that the
guard here belongs in the file rather than in a review note.

**The artifact was then refreshed by measurement, not by restoration.** The sweep wrote 26 languages
(the 5 newer gated lanes — `bash`, `hcl`, `make`, `perl`, `xml` — added; none removed), 286 checks of
which 45 are section rows that FAIL, and `data.languages.<lane>.sections` carries each failing section's
own detail string — so the record now says what is true of the tree rather than what was true on
2026-09-16. The lane this document is about reads **svelte 8/8 and vue 8/8** inside it. What this does NOT
claim: that the fleet is healthy (22 of 26 lanes are not), or that the older 21-lane snapshot was wrong
when it was written — it was a measurement of a smaller `GATED_LANES`, and the difference between the two
files is the five lanes that joined since, which is visible in the diff rather than inferred.

**One benchmark for whoever runs it again.** Two FOREGROUND attempts both completed the whole 26-lane loop
inside a 590 s window (one exited on the old early exit, the succeeding one emitted), while two BACKGROUND
attempts were reaped mid-run — the longer one still going after ~7 minutes (log last write 10:26:59 with
the last lane, `perl`, the slow end). So: it fits a single foreground call, and it does not survive being
backgrounded here. The write happens once, at the very end, so a killed run leaves the artifact untouched
rather than half-written — verified: three killed runs, artifact hash unchanged through all three.

## 27. Postscript, 2026-10-12 (fourteenth): the vue lane's largest dangling class, and the 441 edges
that were markup rather than an unresolved component

The question §25/§26 kept producing without answering: the vue lane publishes `instantiates` for every
template tag that is not in its builtin set, and on its 1,162-file draw (`vuejs`, `element-plus`,
`vue-element-admin`, `vue-core`) that type is **2,708 edges of which 2,533 — 93.5% — name a target nothing
publishes**. The instinct is to call all of them unresolved components (imported from a file outside the
draw, which many are). F30 measured instead of assuming, and **441 of them are not components at all**:
`<filter>` and the six SVG filter primitives, which are elements the SVG specification defines and which
the analyzer's builtin list did not contain.

**Why this was never caught.** `instantiates` had no oracle for "is this tag markup?" beyond the same
three lists the analyzers use (§CC1's #611 gate pins `HTML_BUILTIN_TAGS` for vue, `HTML_BUILTIN_TAGS` for
svelte, and the F5 oracle's `ORACLE_HTML_TAGS` to be identical), so the analyzers and the oracle AGREED
that `<feGaussianBlur>` was a component usage and the differential reported the lane clean — the
invisible-by-construction class this project keeps re-finding: two readings of the same spec cannot
disagree about a construct both forgot to check. The list itself was never wrong so much as short: it held
the SVG elements a chart or an icon uses (`svg`, `path`, `g`, `rect`, the gradient/pattern/mask group,
`clipPath`) and stopped before the paint-server module. **A filter chain is not an exotic shape** — it is
what every icon with a shadow, blur or saturate carries — and the corpus says so in numbers: 64 files,
seven distinct tag names, 61 to 64 edges each (`filter` 64, `feGaussianBlur` 64, `feFlood` 63,
`feColorMatrix` 63, `feOffset` 63, `feBlend` 63, `feComposite` 61).

**The measurement, and its own gate.** A counterfactual probe over the same 1,162 files that consults
neither side of the fix: a template-scoped census with the PRE-F30 list (comments stripped, so a
documented tag is not a usage site), asking production `parseFile` for the file's SYMBOLS only — F30
changed no symbol, it removed relationship edges, so the symbol side cannot make the measurement agree
with itself. A probe that cannot reproduce the known defect is not evidence, so the probe carries its own
check: it must re-derive **377**, the pre-fix count for the six primitives, by a different route. It does.
One honest difference inside that check, recorded rather than smoothed: the census counts raw `<feX` SITES
(747) and the analyzer publishes one edge per `(file, tag)`, which is where 377 comes from.

**The 441/377 split is the finding worth reading twice.** The type lost 441 edges and the UNRESOLVED
bucket lost only 377, because the other **64 — every `<filter>` on the draw — resolved against a symbol
published by a DIFFERENT file in the corpus**: markup wearing a real component's name, which is strictly
worse than a dangling edge, since nothing downstream can tell it from a usage of that symbol. Checked in
the other direction instead of assumed: **zero** of the 441 matched a symbol the SAME file declares, so the
fabrication was never local, and it is the cross-file name coincidence that hid it from the
unresolved-edge lens this project had been using.

**The fix is one vocabulary in three literals** — this lane measured on the corpus (the seven names above),
and the rest of SVG 2's element list plus the SVG 1.1 elements browsers still parse, added to the vue
analyzer, the svelte analyzer and the F5 oracle together, because the #611 gate makes any one-sided edit
fail. Two traps in that gate's own extraction were hit while writing the comment that documents the fix,
and both are recorded in the source beside it rather than only here, because the next writer will hit
them: the gate slices the literal to the FIRST closing-bracket-paren pair and treats every quoted string
in the slice as a tag, so (a) quoted PROSE in a comment registers as PHANTOM TAGS and fails parity over a
sentence, and (b) WRITING that pair inside the comment truncates the slice early, which made every new tag
vanish from one side only and read as "present in the oracle, missing from the vue analyzer". Both were
caught by running the gate, not by reading the code — the second one produced 40-odd parity failures and
the cause was a comment.

**Verification.** Fixtures: vue **60 pass / 1 fail** — unchanged, the 1 being the `heuristic-evidence-floor`
tier pin that is a referred policy decision, and F30 EXTENDS the existing `vue/modern-html-svg-builtin-tags`
fixture with the seven names plus `textPath`/`switch`/`foreignObject`/`animate`/`animateTransform` instead
of adding a fixture; svelte **53 pass / 0 fail**, +1 for the new twin `svelte/svg-filter-builtin-tags`,
which exists because set parity cannot see a call site that compares against the wrong thing. Mutants: the
existing `vue/reemit-filtered-kebab-tags` extended to re-emit the seven names — CAUGHT, new failure is
exactly the extended fixture — and one new `svelte/reemit-svg-filter-tags` (39 -> 40 svelte mutants),
CAUGHT, likewise. Gates: `verify-cross-language-consistency.ts` green (the three sets identical),
`verify-fixture-provenance.ts` green, both typechecks (`tsc --noEmit` and `-p tsconfig.scripts.json`)
clean. Differential, SCOPED and therefore writing no canonical artifact: `--lang vue --sample 400` reports
`element-plus:vue` 400 files **tree-truth 2,433 covered 2,433 (100%) MISSING=0, analyzer-edges 2,431,
unexplained=0** and `vue-element-admin:vue` 131 files **882 covered 882 (100%) MISSING=0**, its 9
unexplained edges being the known `extends`-with-no-oracle label. The analyzer on the same corpus moved
2,708 -> 2,267 instantiates and 2,533 -> 2,156 unresolved.

**The svelte half was measured rather than assumed, and its number is zero: 0 of the 6,436 `.svelte` files on
disk (`svelte` 4,561 + `shadcn-svelte` 1,878) contain a filter primitive or a `<filter>` element at all.**
That is the honest shape of a shared vocabulary: the vue lane carries the live measurement, the svelte lane
inherits the fix by the parity rule, and its obligation is behavioural (the twin fixture and its mutant)
rather than statistical. A lane with no draw for a construct can still be wrong about it — it just cannot be
measured wrong on a corpus, which is the distinction recorded here instead of a borrowed number.

**What this does NOT claim.** (1) The remaining **2,156 unresolved instantiates (95.1%) are untouched** —
that is a resolution question (components imported from outside the file that carries the edge), not a
fabrication one, and it is the next question rather than a solved one. (2) The wider SVG 2 / SVG 1.1 block
is a claim about the SPECIFICATION, not a corpus measurement: only 7 of the 62 names occur anywhere on the
draw, and the source labels the two blocks separately for exactly that reason. (3) The F5 and F4 canonical
artifacts were not rewritten in this pass — every differential run here was lane-scoped by design, which
is also why no coverage number above is presented as a milestone claim.
