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

Verification of this section's landed files is in §12.

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

The suite was run over the tree this section describes, so the four provenance fields of
`validation/m14/results/M14.0.F3.json` name the parent commit and are re-emitted in the
second commit of the pair — the same two-step §10 landed with. The instrument itself is
Python in `script/m14/`, which `tsconfig.scripts.json` does not include, so it cannot move
the 716-error count in either direction; that is why the count is quoted rather than the
gate, which fails before this pass and still fails.
