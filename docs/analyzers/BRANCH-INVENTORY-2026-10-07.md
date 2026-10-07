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
