# yaml — the verdict page

This is the yaml lane's **verdict page** for the Laptop-B ontology round: what the lane claims,
what the instruments say, and what is still open. The large lane-authored design document is
[real-yaml-analyzer.md](real-yaml-analyzer.md) — it is not duplicated here.

## ROUNDS 7–10 — the include-key POSITION defect, a step-level workflow call read as external, and a falsifier that FIRED on the ruling (2026-10-10)

Round 5 cut `extQ` by fixing claims. Rounds 7–9 asked the harder question of the residual and of the
whole edge population: **how much of what this lane emits is its own over-emission?** Every answer
below came from a whole-population measurement with the arbiter's own rule (`classifyEdge`) or from a
text oracle over the corpus, taken BEFORE any code was written, and four of the answers were defects
rather than rulings. The total movement: **222 edges that should never have been emitted**, every one
of them false and none of them a true edge dropped. The position census that found the largest class is
committed, so the next reader can count the question again rather than trust this prose.

### Defect 1 — an include-family tag was read as naming a TYPE

`functions: !include "s1/functions/functions.yaml"` is an import and nothing else, but the tag's short
name was written onto the symbol as `declaredType`, so every such site ALSO emitted a `references`
edge whose target was the literal string `include` — a name that collides with ordinary keys spelled
`include`. MEASURED: **10 edges, all AMBIGUOUS against 3 unrelated declarations** (hasura-engine's
`metadata/databases/databases.yaml` and siblings). An include tag names a FILE; it can never name a
type. `tagTypeName()` is now the single definition every `declared_type` site reads, and the test is
the tag's membership in the closed include set — not the presence of a readable path, because a tag
whose path the lane refuses still does not name a type.

### Defect 2 — a QUOTED include path was refused for containing a space

`tables: !include "s 3/tables/tables.yaml"` names `metadata/databases/s 3/tables/tables.yaml`, **which
the repository HAS**. The whitespace refusal (`looksLikePath`, and `isLiteralPathSpelling` behind it)
exists for ansible's UNQUOTED free-form convention (`include_tasks: file=x.yml`), and it applied to
quoted literals too. Quoting is the source's own evidence that the value is one string, so the refusal
is now conditional on the scalar NOT being quoted — and nothing else was relaxed (`key=`, templates,
globs, URI schemes and the `://` case are all still refused, and `projectCarriesFile` still gates the
claim, so a quoted path the project lacks cannot become a refutation). MEASURED on that one file:
`s 3/tables/tables.yaml` and `s 3/functions/functions.yaml` moved from a false `declared_type` edge to
a **VERIFIED file claim** (`importProjectFile`, checked against the project's own file list).

### Defect 3 — `include:` IS A GENERIC KEY, and five more formats use it as a SELECTOR LIST

`include` is in `FILE_IMPORT_KEYS` because ansible and pyyaml-include spell a file import that way. But
`include` is a GENERIC configuration key, and the corpus uses the same spelling for "the SET of things
this rule/target/builder selects" in six more formats. The first one found was Azure Pipelines:

```
trigger:
  branches:
    include: [main, feature/*, hotfix/*]      # branch name patterns, not dependencies
```

MEASURED on docker's vendored `sdk/azcore/ci.yml`: **12 false import edges in ONE file**
(`trigger.branches.include`, `trigger.paths.include`, `pr.branches.include`, `pr.paths.include`), of
which the globs went straight into `extQ` (`feature/*` …) and `main` went to AMBIGUOUS against 11
declarations in the docker project. That first guard was narrow (the parent plus the document's own
`trigger:`/`pr:` claim), and rather than generalise it by intuition a new instrument was written to
count the question — **[include-key-position-census.ts](../../validation/m14/fixtures/yaml/include-key-position-census.ts)**,
which reads the emitting key's own PATH off every `yaml_keyword_include` edge in the whole admitted
population (928 edges) and groups them by parent chain, shape and claim. It found five more:

| parent | format | MEASURED class |
|---|---|---|
| `paths` | semgrep rule paths, Azure path filter | 26 glob edges over 5 repos (`…/migrations/tasks/*.py`) |
| `sources`, `generate_for` | Dart `build_runner` (`targets.<t>.sources.include`, `builders.<b>.generate_for.include`) | 25 glob edges |
| `objc-interfaces`, `objc-protocols`, `enums` | ffigen Selector lists | 34 edges, **every one of them in `extOK`** — an Objective-C class or enum name (`NSCondition`, `NSURLRequestCachePolicy`) resolves to nothing, so a false edge read as a VERIFIED claim |
| `outputs` | GitHub Actions job output | 1 |
| `exposure` | Spring Boot `management.endpoints.web.exposure.include: 'env,health'` | 1 |

The guard is now **any ANCESTOR segment** of the key's own path, minus the DOCUMENT segment — and that
exclusion is not a detail: a per-file analyzer's document identity comes from the filename, so a file
named `paths.yaml` would have had every top-level `include:` in it suppressed, the exact defect the
older `matrix` guard already had to state. `branches` still additionally requires the document's own
pipeline claim, because `branches` is an ordinary word; the other members are selector containers in
every format that spells them.

**The controls can FAIL in both directions, and were shown failing.** New
[include-selector-control.ts](../../validation/m14/fixtures/yaml/include-selector-control.ts) — 12
assertions, six NEGATIVE (a real ansible `include_tasks`/`import_tasks` must still emit a VERIFIED file
claim, and it must still emit in a document named `paths.yaml`) and six POSITIVE (each measured
selector position must emit NOTHING). Falsifier runs: reverting the guard ⇒ **6 red, exit 3** (every
POSITIVE arm fires); making it over-reach by counting the document segment ⇒ **3 red, exit 3** (the
`paths.yaml` arm fires). Either failure mode is caught.

### Defect 4 — a step-level `uses:` of a workflow FILE was called external, and the `claimable`
column finally NAMED its edge instead of counting it

`steps[].uses: ./.github/workflows/test-failure-notification.yml` is GitHub's STEP-LEVEL
reusable-workflow call: the target is a file this project HAS (it declares `on: workflow_call`), and
`actionUseClaim` asked it for an action manifest — `<file>/action.yml`, which cannot exist inside a
file — so the edge fell back to `isExternal: true`. It is the Round-5 defect class (a false statement
that a file the project has is outside the population) in the one spelling that fix did not cover.

It was found by INSTRUMENT, not by reading. The enumerator's `EXT-Q INVENTORY` carries a `claimable`
column — "would a file claim on this target have been VERIFIED?" — and this round the column was made
to NAME each such edge (`CLAIMABLE EDGES`) instead of counting it, because a count is a lead and a
name is a ruling. It printed exactly ONE edge in the whole admitted population:

```
imports yaml_action_use claim=owner
   target   "./.github/workflows/test-failure-notification.yml"
   admitted candidate(s): .github/workflows/test-failure-notification.yml
   in       nomad/.github/workflows/test-scheduler-prop.yml
```

**The correction that came with it, and it is this document's own error.** Three revisions of this
package asserted the one claimable edge was `./.github/codeql/queries` — a guess read off the group's
3 printed samples, none of which was the claimable edge. The artifacts say otherwise, and always
did: the group that carried the flag at Round 5 AND at Round 9 is
`11 imports yaml_action_use shape=path-like claim=owner claimable=1`, whose samples are
`./security-scanner` (a path an earlier step CHECKS OUT at run time — ruled, precisely because no file
claim can name it). The attribution was wrong, is corrected here, and the edge it should have named is
the one above.

The fix is three lines in `actionUseClaim`, and both gates around it are the lane's existing rules:
the claim may fire only when the spelling is an ADMITTED spelling (`.yaml`/`.yml` — the arbiter's
evidence base is exactly those two extensions, so a claim about `notes.txt` could only ever be
REFUTED, never confirmed) AND `statSync` finds the candidate. Four arms in `include-claim-control.ts`
(§8), THREE of them negative: a carried workflow file claims the FILE and the arbiter verifies it; an
ABSENT one keeps `isExternal`; `./dir` still claims the action MANIFEST and never the directory; and a
carried NON-`.ya?ml` file claims nothing. **Falsifier run: reverting the three lines turns 4
assertions red and exits 3.**

MEASURED whole-population (`census-yaml-whole-corpus-after.txt`, rotated to this run): `extQ`
**255 → 254**, `extOK` **10,616 → 10,617**, edges and residual UNCHANGED — and the enumerator's
`CLAIMABLE EDGES` section now reads **NONE**:

```
(none — every ext-Q edge in this population is unverifiable by every spelling a file claim could use)
```

That sentence is the strongest form of the clause-2 ruling this lane can reach on its own: it is no
longer "the 254 are ruled", it is "no claim the project could have checked is left unclaimed."

**Both whole-population instruments were then re-run on the frozen tree, because a fix measured by one
instrument is a fix measured by one instrument:**

| instrument, whole admitted population | result |
|---|---|
| `incoming-gate.ts yaml yaml,yml 0` (18,364 of 18,364, 189 repos) | `FAIL — 138 ambiguous + 47 unresolved of 1414582 edges …; 254 external claim(s) unverifiable (10617 verified + 254)` · separator tripwire 0 · `instrument self-test: PASS` |
| `residual-gate.ts --lane yaml` (the four-clause gate, which spawns the walk above) | `TOTAL 1,414,582 · resolved 1,403,526 · ofWhich 4 · amb(decl) 138 · unresolved 47 · residual 185 · extFAIL 0 · bindFAIL 0 · causeFAIL 0` |
| `lane-residual-census.ts` (the enumerator) | `1,414,582 · amb 142 · unresolved 47 · extOK 10,617 · ext? 254 · extFAIL 0` · `CLAIMABLE EDGES` **NONE** |

The gate's `extOK 10,617` and `extQ 254` are the enumerator's columns to the edge; its `extFAIL 0` is
the test the Round 10 fix had to pass (a file claim that MISSES is refuted, and nothing was refuted);
and its `bad` is the 138 + 47 this package's verdict is written against.

**The relation TYPE is deliberately unchanged, and the ontology page already says why.**
`docs/analyzers/real-yaml-analyzer.md`'s `imports` row defines the type as "a **file** this file
pulls in: Ansible `include_tasks`, tag `!include`, and a step-level workflow `uses:`" — a step-level
call names a FILE, so it is an `imports` edge with `relationshipType: yaml_action_use`, and the only
thing wrong with it was the CLAIM. Promoting it to `calls` (the `yaml_workflow_call` spelling) would
be a second vocabulary for one fact and would move an edge between two census rows to make a
sentence read better; the lane's rule is that a fix changes the claim, not the ontology, unless a
measurement says the ontology is wrong.

### The falsifier that fired: the biggest ruled class FAILS on one edge

The largest remaining ambiguous class is a **bare relation-object name whose referent is not declared
in the edge's own file** — `secretName: test`, `serviceAccountName: default`, `include_role: name=dnf`.
The lane's proposed ruling was that the count model, which resolves BY NAME across the project, cannot
discriminate such a name from an ordinary key that shares its spelling.

**A falsifier was written BEFORE the ruling was recorded, and it refuted it.**
`validation/m14/fixtures/yaml/name-collision-falsifier.ts` reads the KIND off the REFERRING KEY
(`secretName`→Secret, `claimName`→PersistentVolumeClaim, `configMap`→ConfigMap,
`serviceAccountName`→ServiceAccount, `include_role`→a `roles/<name>/` directory) and then looks for a
declaration of that kind and name in **the project's own text** (a manifest with `kind: K` and a
`metadata:` block naming N) — a text oracle, so the instrument cannot inherit the defect it tests.
Kind-blind would have been wrong: `test` IS declared 8 times in kubernetes, as Pods, Deployments and
CRD examples, and none of them is the Secret a `secretName: test` asks for.

Whole residual population (the 9 projects that carry ambiguous edges), **142 ambiguous edges:**

| count | falsifier verdict |
|---|---|
| **1** | **FALSIFIED, same directory** — `serviceAccountName: apiserver` in `staging/src/k8s.io/sample-apiserver/artifacts/example/deployment.yaml`, and `.../artifacts/example/sa.yaml` declares `kind: ServiceAccount`, `metadata.name: apiserver`. A REAL missed resolution: one manifest set, `kubectl apply -f <dir>` reads both. |
| 0 | FALSIFIED by a role directory (`roles/<name>/` exists in the project) |
| 117 | same-kind name exists ELSEWHERE in the project — a Secret named `test` in `hack/testdata/diff/`, which is **another manifest set, i.e. another cluster**, and not evidence of this referent |
| 24 | no same-kind referent at all — 6 ansible ROLE imports whose `roles/<name>/` the project does not have, 10 where a kind was asked for and no such object exists, 8 with no kind axis (duplicate-key `contains`, `$ref` targets) |

The ruling therefore **holds for 141 of 142 and FAILS for 1**, and the one is reported rather than
smoothed: resolving it needs a project-wide (or same-directory) resource index, which a per-file
analyzer has no channel for — it sees one file plus a `statSync`. That is an architecture item for the
Lead, not a spelling fix, and it is stated here with the exact file pair so it can be picked up.

### Rounds 7–9, before → after, on the same instrument

| | Round 6 | Round 7 | Round 9 |
|---|---|---|---|
| edges | 1,414,804 | 1,414,637 | **1,414,582** (−222 total) |
| residual (amb + unresolved) | 198 | **185** | **185** (131 references + 7 imports amb, 47 unresolved) |
| `references` amb | 141 | 131 | **131** (−10, defect 1) |
| `imports` amb | 10 | 7 | **7** (−3, the Azure `main`) |
| `imports` edges | 8,576 | 8,421 | **8,366** (−210) |
| `extOK` | 10,743 | 10,642 | **10,616** (net −127, of which 26 FALSE VERIFIED edges) |
| `extQ` | 335 | 282 | **255** (−80) |
| `extFAIL` · `bindFAIL` · `causeFAIL` | 0 · 0 · 0 | 0 · 0 · 0 | **0 · 0 · 0** |
| 200-file draw | `bad` 0, extQ 2 | `bad` 0, extQ 2 | `bad` 0, **extQ 2** (unchanged: `package:lints/recommended.yaml`, Helm `{{ .Release.Name }}-testconfig`) |

**ROUND 10 appended the last FIXABLE edge** (Defect 4 above) and changed no edge count: `extQ` 255 →
**254**, `extOK` 10,616 → **10,617**, residual and edges unchanged, and the enumerator's `CLAIMABLE
EDGES` section now reads **NONE**. The committed artifact was rotated to that run, so every "current"
number in this document is the Round 10 measurement.

**The draw is re-run at this revision, with the arguments this document states, so the row is
reproducible rather than quoted:** `npx tsx script/m14/incoming-gate.ts yaml yaml 200` →
`TOTAL 6,593 · resolved 6,579 · amb 0 · unresolved 0 · extOK 12 · ext? 2 · extFAIL 0`, verdict
`FAIL — 2 external claim(s) name no identifier-shaped owner` — i.e. **`bad === 0` again, with the same
two ruled-shape claims** (`package:lints/recommended.yaml`, Helm `{{ .Release.Name }}-testconfig`).
A second, independent draw over BOTH admitted extensions
(`incoming-gate.ts yaml yaml,yml 200`) reads `TOTAL 19,806 · resolved 19,733 · amb 0 · unresolved 0 ·
extOK 59 · ext? 4 · extFAIL 0` — **`bad === 0`** with four ruled-shape claims, none of them new.

**These are NET numbers, and the direction inside them is the point.** Defect 2 also ADDED edges (the
quoted hasura includes were re-claimed as VERIFIED files, and an edge that did not exist before now
does), so the columns below are not all-removals; what they say is that the lane emits **222 fewer
edges**, every measured removal a false statement, and the evidence that no TRUE import went with them
is the control's six NEGATIVE arms plus the fixture battery (33/0) — and that 28 of the removed edges
had been sitting where no residual column would ever show them:

| column, Round 6 → Round 9 | net | what was in it |
|---|---|---|
| `extQ` | 335 → **255** (−80) | the selector globs and filters that were counted as unverifiable imports |
| `extOK` | 10,743 → **10,616** (−127) | of which **26 were FALSE VERIFIED edges** — ffigen's Objective-C class and enum names, each resolving to nothing and therefore reading as a confirmed external claim |
| ambiguous | 184 → **138** (−46) | 10 `declared_type` targets spelled `include`, the Azure `main`, and the ansible role names the Round 6 role-entry fix resolved |
| `imports` resolved | 4 → **1** (−3) | **2 of them were RESOLVED false edges** — the worst direction there is, because a resolved edge is never looked at again |

The lane has stated that direction before (`extQ`'s own Round-5 section: "a false import edge that
RESOLVES is worse than one that does not") and this round is its second confirmation. That the position
census was written BEFORE the guard is why any of them were found: the guard would otherwise have been
built from the one file that happened to be read.

*Two instruments, one row apart, and the row is worth naming.* The enumerator's TOTAL `amb` reads
**142** because it classifies every type with the same rule and does NOT pass the gate's
`containsLike` arm — `contains` carries 4 collision flags that the gate reports as `collRes` and
production BINDS (the analyzer writes the edge on the target symbol's own line, so
`resolveContainsTargetStmt`'s first two keys both match).

**So the two instruments differ by exactly 4 edges, and it is worth stating the arithmetic instead of
choosing a favourite.** `residual-gate` (the four-clause instrument) prints `contains` with `amb 0`
and the 4 in its own `ofWhich` column, so its residual is 131 + 7 + 47 = **185**; the enumerator folds
the same 4 into `amb`, so its per-type rows sum to 131 + 7 + 4 = **142** ambiguous and its TOTAL
column reads **189**. Both are correct statements about different questions — "edges the gate counts as
unresolved-by-declaration" vs "edges no unique declaration answers for" — and the difference is
those four duplicate-key `contains` edges, which the gate's `selfTest` pins
(`resolvedAmongCollision === 1` **and** `ambiguousByDecl === 0`). This document quotes the four-clause
instrument's 185 in the completion package and the enumerator's 142 where the falsifier ran, and says
which is which each time.

Fixture battery 33 pass / 0 fail; FOUR controls (`document-claim-control`, `workflow-needs-control`,
`include-claim-control`, `include-selector-control`) each exit 0, with falsifier runs recorded for the
new one in both directions (6 red / 3 red, both exit 3); **24 of 24 yaml mutants caught, 0 survived**;
`tsc --noEmit` clean.

Artifacts: [census-yaml-whole-corpus-round9.txt](../../validation/m14/fixtures/yaml/census-yaml-whole-corpus-round9.txt)
(the final whole-population run) and
[name-collision-falsifier.txt](../../validation/m14/fixtures/yaml/name-collision-falsifier.txt)
(the falsifier, re-runnable as `BB_ONLY_REPOS=kubernetes,ansible,... npx tsx
validation/m14/fixtures/yaml/name-collision-falsifier.ts`).

## ROUND 5 — `extQ` 1,903 → 343: 82% of it was a FALSE claim, not an uncheckable one (2026-10-10)

`externalUnverified` (`extQ`) is the one column between this lane and a formal PASS, and the fleet
ruling on it (`HANDOFF.md` §5v) asks for the split **by emitting site FIRST**, because "a site
making an unsupportable claim is a fix, and a fix beats a ruling". So the split was measured with the
arbiter's own rule before any code was written — whole admitted population, 18,364 `.yaml`/`.yml`,
189 repos, by two instruments that agree on the number — the lane's own enumerator
(`validation/m14/fixtures/yaml/lane-residual-census.ts`, whose `EXT-Q INVENTORY` prints each shape
with a `claimable` column; artifact
[census-yaml-whole-corpus-after.txt](../../validation/m14/fixtures/yaml/census-yaml-whole-corpus-after.txt))
and `validation/m14/fixtures/yaml/extq-census.ts`, which prints the `ext?`/`extOK`/`extFAIL` triples
by claim kind and shape together with the VERIFIED set — the control, since a change that broke the
verified set would otherwise look like progress (artifact
[extq-yaml-whole-corpus.txt](../../validation/m14/fixtures/yaml/extq-yaml-whole-corpus.txt)):

| shape (type · claim · target form) | edges, before | what it is |
|---|---|---|
| `references` · owner · relative-path | **681** | `$ref: "./Responses.OpenAPI.yaml#/400"` — a cross-document pointer to a sibling FILE |
| `references` · owner · owner-repo | **675** | `$ref: "Shared.Components.OpenAPI.yaml#/components/schemas/Instant"` — the same, without `./` |
| `calls` · owner · relative-path | **208** | `uses: ./.github/workflows/build.yml` — a local REUSABLE-WORKFLOW call |
| `imports` · owner · uri-scheme | 88 | `include: package:lints/recommended.yaml` — a pub URI |
| `imports` · owner · template | 72 | `'{{ service_type }}_cleanup.yml'` |
| `imports` · owner · glob | 63 | `*_test.go`, `releases/*` |
| `references` · owner · template | 31 | `${{ parameters.dependsOn }}` |
| 9 further shapes | 85 | dotted/short-suffix spellings, ansible's free-form `name=a public=no`, `urn:k8s:secret:…`, absolute paths, a `$`-prefixed target |
| **TOTAL** | **1,903** | |

**The first three rows are ONE defect, not three: the lane said `isExternal` about a file its own
project has.** The arbiter already refuses to believe an "external" claim about a path
(`pathLikeTarget`), which is why all 1,564 read `externalUnverified` rather than verifying — the
check was working and the claim was false. Two emission sites said it:

* the `$ref` site stated `isExternal: !pointer.startsWith("#/")`, so EVERY cross-file `$ref`
  claimed to be outside the population while `Grace/src/OpenAPI/Responses.OpenAPI.yaml` sits in the
  same directory as the file referring to it;
* the reusable-workflow branch was routed through `actionUseClaim`, which for a `./` target resolves
  an ACTION MANIFEST (`action.yml`) *inside* it — so `./.github/workflows/build.yml` was asked for
  `./.github/workflows/build.yml/action.yml`, which cannot exist, and fell back to `isExternal`.

Both now state the claim the project can CHECK — the file part of the pointer / the workflow path,
run through the same candidate builder and the same `statSync` evidence rule every other file claim
in this lane uses (`pointerClaim`, `workflowCallClaim`). The fragment is dropped: it addresses a
position INSIDE the file, and a claim has to be spelled as the thing it claims.

| | `extQ` | `extOK` | `extFAIL` |
|---|---|---|---|
| before | **1,903** | 9,208 | 0 |
| after | **343** | **10,701** | **0** |

The +1,493 and the −1,560 do not cancel, and the difference is forced by arithmetic rather than
argued: exactly **67 edges that were sitting in the VERIFIED column were false and are now gone**
(the third fix, below). `extFAIL` moving 0 → 0 is the non-regression that matters — a file claim
REFUTES on a miss, so a fix that claimed files it could not confirm would have shown up here.

**The draw that used to fail now fails on 2 edges, and both of them are in the ruled class.**
`incoming-gate.ts yaml yaml 200` — the same stride draw whose verdict read
`185 ambiguous + 47 unresolved …; 1903 external claims unverifiable` — now reads
`resolved 6579 · amb 0 · unresolved 0 · extOK 12 · ext? 2 · extFAIL 0`, and its verdict is
**`FAIL — 2 external claim(s) name no identifier-shaped owner`**: `bad === 0` for the first time, so
the only thing between this draw and a PASS is one `package:lints/recommended.yaml` include and one
Helm `{{ .Release.Name }}-testconfig` (identified by `.tmp-probe/yaml-unverified.mts 200`, which
reproduces the gate's draw exactly). The 60-file draw remains PASS.

The completion instrument barely moves, and that is the finding, not a disappointment:
`residual-gate --lane yaml` reads **residual 232 → 231 of 1,414,804** (references amb 142 → 141,
resolved 19,028 → 19,053). The residual gate counts an uncheckable claim as accounted-for, so it
could not see any of this — it was reading the lane as near-complete while 1,903 claims said
`isExternal` about files in the project. Two instruments, two questions; the extQ column is the one
that separates this lane from a PASS.

### The same measure found two FALSE dependency edges, one of them in the VERIFIED column

`DEPENDS_ON_KEYS` fires at ANY depth, while the sibling `uses:` site is gated by `isJobLevelPath`.
Every `yaml_depends_on` edge in the population grouped by the position it was emitted from
(`validation/m14/fixtures/yaml/dependency-position-census.ts`, 1,938 edges over the 413 files that
mention a dependency key at all):

| position | edges before → after | verdict |
|---|---|---|
| `jobs.<id>.needs` | 1,655 → 1,655 | TRUE — the fix that took `references` amb 879 → 142 |
| `services.<svc>.depends_on` | 74 → 80 | compose; the long form's KEYS are added and its `condition:` values removed |
| `steps[].with.needs` | **48 → 0** | **FALSE** — GitHub Actions admits an action INPUT named `needs` |
| Azure `stages[].dependsOn` / CircleCI `jobs[].requires` and the rest | 161 → 160 | TRUE — other loaders' own spellings |
| **total** | 1,938 → 1,895 · resolved 1,764 → 1,799 · unresolved 174 → 96 | |

1. **`steps[].with.needs` (48).** `- uses: r-lib/actions/setup-r-dependencies@v2` / `with: needs:` is
   an input. 46 of the 48 named `check`, `website`, `pr-document`, `coverage` — bare names nothing
   declares, so they read `externalVerified`, i.e. **a false edge that RESOLVES, in the verified
   column**. `isDependencyPosition` gates `needs` to `jobs.<id>` with the same predicate the `uses:`
   site uses.
2. **Compose's long form (31).** `depends_on:` with a mapping puts the dependency names in the
   KEYS and the dependency's own settings in the VALUES; `scalarValues` walks values, so it returned
   `service_healthy` (22), `service_started` (7) and `service_completed_successfully` (2) and
   DROPPED the dependencies. `dependencyTargets` takes the mapping's keys for a mapping value and
   falls through to `scalarValues` for a sequence, which ADDS the true edges while removing the
   false ones — reported in both directions rather than as a net.

### Controls — each one able to FAIL, and each shown failing

* `validation/m14/fixtures/yaml/document-claim-control.ts` — **29 assertions**, runs the production
  path over a built project and applies the arbiter's own `classifyEdge`. Pins: the file claim is
  made and VERIFIES; the OLD claim cannot verify the same target (the before/after arm); the
  fragment is not part of the candidate; an ABSENT sibling and a URL keep `isExternal`; the arbiter
  STILL refutes a file claim that misses; an in-document `$ref` neither gets a file claim nor loses
  its resolution; a local call never claims an action manifest; a remote call keeps the reference
  claim. **Falsifier run: reverting `pointerClaim` to the old unconditional `isExternal` turns 7
  assertions red and exits 3.**
* `validation/m14/fixtures/yaml/workflow-needs-control.ts` — now **14 assertions**, adding the
  position negative (`with.needs` names a job that EXISTS, so a missing position rule would produce
  a resolved false edge) and the long-form arms. **Falsifier run: removing the position gate turns 2
  assertions red and exits 3.** Both controls assert the positive claim BY SOURCE, not by target —
  the job's own `needs: [test]` and the input's `needs: test` carry the same string, and the first
  version of the check was written by target and failed for exactly that reason.

### The RULED CLASS — the 343 that remained at Round 5 (**254** after the Rounds 7–10 claim fixes), and
what would verify them

These are NOT removable by marking differently, and the reason is structural in each case:

| shape (the enumerator's rows, grouped) | edges | why nothing can check it | what WOULD verify one (falsifier) |
|---|---|---|---|
| templated targets — `imports yaml_keyword_include` 73, `references yaml_resource_ref` 14, `references yaml_depends_on` 17, `imports yaml_action_use` 18 | **122** | `'{{ service_type }}_cleanup.yml'`, `{{ item }}`, `${{ parameters.dependsOn }}`, `$/.github/actions/go-cache-restore`: the target is materialised at RUN time, so the thing that lands is a function of variables no single-file parse can see | a value the tree contains literally instead of a template |
| URI schemes — `imports yaml_keyword_include` 88 (`package:`/`dart:`), `references yaml_resource_ref` 5, `references yaml_depends_on` 3 | **96** | a pub URI is not a path, and `urn:k8s:secret:name:key` / `k8s:optional` are not names. `verifyImportClaim` DOES answer `package:` — from the project's DECLARED pubspec packages, which the gate builds for `dart` alone | the pubspec fact set wired for this lane, MEASURED first: `package:lints` IS declared in that checkout, so wiring it blind could turn verified claims into REFUTATIONS |
| globs — `imports yaml_keyword_include` | **63** | `*_test.go`, `releases/*`, `feature/*`: a glob names a SET, and no single candidate can be the thing it names | a spelling that names one file |
| path-like but NOT admitted — `imports yaml_keyword_include` 19, `dotted` 14, `imports yaml_action_use` 11, `references declared_type` 3, `references yaml_action_use_unverified` 1, `imports yaml_action_use` remoteRef 2 | **50** | `./security-scanner` and `./ci-actions/.github/actions/setup` are checked out by an earlier step; `build.psm1`, `global.json`, `tools/ci.psm1` and mkdocs' `python/name:material…` are real dependencies of a NON-yaml file; `pypa/gh-action-pypi-publish@release/v1` is a real reference the RULE refuses (below) | the file being in the checkout at run time, or in an admitted population that is not `.yaml`/`.yml` by construction |
| free-form / whitespace — `imports yaml_keyword_include` | **11** | `name=a public=no`, `file=x.yml`, ansible's free-form parameter lists: not a path, not a name | a spelling that is one of the two |
| `security-and-quality` (gh-cli codeql-config) | **1** | a CodeQL query-pack name, marked `remoteRef` by the fallback in `actionUseClaim`; it is neither a project path nor a pinned reference | a claim kind for query-pack names — the same "a site making an unsupportable claim" test as Round 5, at n=1 |

One row of the enumerator's own output was a FIX rather than a ruling, and it took a third instrument
change to name it (ROUND 10, Defect 4 above): the `claimable` column printed per GROUP with 3 samples,
the group carrying the flag prints `./security-scanner` — a path an earlier step CHECKS OUT at run
time, which is exactly why it is ruled — and the ONE claimable edge was
`./.github/workflows/test-failure-notification.yml`, a step-level reusable-workflow call that is a
file the project HAS. It is FIXED, and the section now reads **NONE**. **This document had attributed
that flag to `./.github/codeql/queries`, and that was wrong** — that target does not even end in
`.yaml`, so no file claim can be spelled for it; the directory it names holds `.ql`/`.md` only, which
is a POPULATION decision, not a spelling one. And **the `@release/v1` row is a RULE-SHAPE question,
not a lane one** — `verifyRemoteRefClaim` refuses a ref containing `/`, and `release/v1` is a legal git
branch; it is flagged with its exact 2 targets rather than changed here, because the rule is shared.

The falsifier column is the point of the table: each row names the observation that would move it,
so the ruling can be shown wrong instead of being trusted.

## ROUND 11 — the falsifier's one edge FIXED, after pricing the rule (2026-10-10)

The collision falsifier did not just fail — it named a defect, and a defect is not a ruling. So the
rule it implied was PRICED before it was applied, and the price is the falsifier's own output rather
than an argument:

| | measured |
|---|---|
| CEILING — ambiguous edges a same-directory, same-kind resolution can reach | **1** (`serviceAccountName: apiserver`) |
| CONTROL — of those, in a directory declaring that kind+name TWICE | **0** |
| CONTROL — more that a PROJECT-WIDE version of the rule would bind | **117**, every one refused (another manifest set is another cluster) |

Clean control, so the rule was applied: `resolveSameDirectoryResource` resolves a
`yaml_resource_ref` whose referring KEY maps to a kind against a SIBLING in the referring file's own
directory that declares `kind: <K>` and a top-level `metadata.name: <target>`, targeting that
sibling's DOCUMENT IDENTITY (the same shape the in-file path already produced). It refuses rather
than guesses: project root required, `.yaml`/`.yml` siblings only, and it returns null the moment a
SECOND sibling matches.

**What it reads, stated because it is a departure.** `analyze()` is synchronous and the only parser
accessor (`engine.getParser`) is async, so the sibling is read as TEXT and the two spellings are
matched. The read is a CANDIDATE FILTER, never an extraction: what it produces is a document
identity, and the ARBITER then has to resolve that name against the project's key space — a wrong
sibling makes the edge unresolved again, not wrong. The current file's own structure still comes
from the tree. If a synchronous parser accessor ever lands in `engine.ts` (a shared file, so not this
lane's to change), the read becomes a parse and nothing else moves.

**AND THE DEPARTURE WAS THEN MEASURED RATHER THAN DEFENDED.** The question a text read raises is
whether it produces the same CANDIDATE SET a parse would, and it is answerable with numbers over the
whole population ([same-directory-candidate-set-probe.ts](../../validation/m14/fixtures/yaml/same-directory-candidate-set-probe.ts)
— the analyzer's OWN filter on one side, a tree walk on the other):

| whole admitted corpus (18,364 files, 189 repos) | |
|---|---|
| kind-mapped resource-reference edges | **3,124** |
| candidate set identical (text == parse) | **3,124** (100 %) |
| TEXT MISSES a parse candidate (the safe direction) | **0** |
| TEXT FINDS an extra candidate (the unsafe direction) | **0** |
| unresolved same-directory-class edges for which a PARSE finds a candidate | **0** |

**VERDICT: the text read is INVISIBLE — a parse would find the same set, so a synchronous parser
accessor in `engine.ts` would buy nothing**, and the departure costs nothing. Both directions are
counted because only one of them is safe: a miss leaves an edge unresolved in a named class, while an
extra could bind an edge to a document no parse would produce.

ARTEFACTS, so the before and the after cannot be confused: the run that FAILED (1 falsified, CEILING 1)
is [name-collision-falsifier-priced-before.txt](../../validation/m14/fixtures/yaml/name-collision-falsifier-priced-before.txt);
the run at this revision is [name-collision-falsifier.txt](../../validation/m14/fixtures/yaml/name-collision-falsifier.txt)
(`RULING HOLDS`, CEILING 0).

**The reach is 22 edges, not 1 — and that is a CORRECTION to the price, not a bonus.** The falsifier
prices the AMBIGUOUS bucket, because that is where it was written to look. Measured over the whole
population, the rule also moved 20 edges that were passing as VERIFIED EXTERNAL CLAIMS ("this names
something outside the corpus") and 1 that was unverifiable — all of them references to an object the
same directory declares, so the old claim was simply false:

| references, whole population | before | after |
|---|---|---|
| resolved | 19,053 | **19,075** (+22) |
| amb(decl) | 131 | **130** |
| extOK (verified external claims) | 2,142 | **2,122** (−20) |
| ext? | 44 | **43** |
| **gate TOTAL** | resolved 1,403,526 · amb 138 · residual 185 | resolved **1,403,548** · amb **137** · residual **184** · every type **CLOSED** |

**The falsifier now reads `RULING HOLDS on this population` — 0 falsified, CEILING 0** — and the
control that makes the rule falsifiable in BOTH directions is
[same-directory-referent-control.ts](../../validation/m14/fixtures/yaml/same-directory-referent-control.ts),
10 assertions: the same-directory case RESOLVES to `a.sa`; a same-kind name in ANOTHER directory does
NOT bind (the 117's shape); a WRONG kind in the same directory does NOT bind; TWO matching siblings
REFUSE rather than pick; and an in-file declaration still resolves as it always did.

## COMPLETION PACKAGE — current revision

Whole admitted population: **1,414,582 edges · 18,364 files · 189 repos · 0 failed · 0 degraded.**

(Round 5 moved it from 1,414,847 and Rounds 7–10 to 1,414,582 — **−222 net false edges** and a
**1,903 → 254 `extQ`** — Azure Pipeline branch filters emitted as imports, five more selector-list
positions, the include-tag `declared_type` class, the false `with.needs` dependency class, and the
step-level workflow call: every round's arithmetic is in the ROUNDS 7–10 / ROUND 5 tables above,
including the **28 that had been reading as VERIFIED or RESOLVED** and the one Round 10 edge that was
reading as `extQ`.)

**WHICH ARTIFACT HOLDS WHICH REVISION — stated because this package got it wrong once (see ROUND 10):**
[residual-yaml-whole-corpus-after.txt](../../validation/m14/fixtures/yaml/residual-yaml-whole-corpus-after.txt)
is the four-clause gate's own **Round 10** run at this revision —
`TOTAL 1,414,582 · resolved 1,403,548 (99.2 %) · ofWhich 4 · amb(decl) 137 · unresolved 47 ·
residual 184 · extFAIL 0 · bindFAIL 0 · causeFAIL 0` · every type `CLOSED` (one printed bucket per edge) — so the clause-1 number below and the
tie-break in clause 4 now come from the four-clause instrument ITSELF at the frozen tree rather than
from a round-old copy; the enumerator's **Round 10** run (1,414,582 · amb 142 · `extQ` 254 ·
`CLAIMABLE EDGES` NONE) is
[census-yaml-whole-corpus-after.txt](../../validation/m14/fixtures/yaml/census-yaml-whole-corpus-after.txt);
the `extQ` census that carries the ruling is
[extq-yaml-whole-corpus.txt](../../validation/m14/fixtures/yaml/extq-yaml-whole-corpus.txt); and the
RULING's falsifier is
[name-collision-falsifier.txt](../../validation/m14/fixtures/yaml/name-collision-falsifier.txt) with
[census-yaml-whole-corpus-round7.txt](../../validation/m14/fixtures/yaml/census-yaml-whole-corpus-round7.txt)
(1,414,637 · `extQ` 282) as the round-by-round copy.)

**THE ENUMERATOR NO LONGER DISAGREES WITH THE GATE — see the note in clause 1.** It used to say `amb 142` against the gate's 138; it now imports the gate's own `contains` predicate and reads **137**, the same as the gate. The paragraph below is kept as the record of what the gap was and why documenting it was the wrong fix: 142 − 138 = **4, and all four are `contains`.** The enumerator calls
`incoming-rule.ts`'s `classifyEdge` DIRECTLY, so it is still counting `contains` by DECLARATION COUNT
(a name declared twice anywhere in the project reads ambiguous) — the model `fa2dc27e8` retired,
because production resolves `contains` with its own `WHERE s.project_id = ? AND s.name = ?` +
`ORDER BY (s.file_id = ?) DESC LIMIT 1` statement, which has no "N candidates" state at all and
binds 1,380,046 of 1,380,046 in this lane. The gate's 138 is the production model and is the number
the clauses use; the enumerator's extra 4 are its instrument's own lag, recorded here rather than
silently reconciled.

**THE ANSWER, up front.** Clause 1 **fails by 184** — 137 ambiguous + 47 unresolved, every one
attributed to a NAMED cause below, 0 refuted. Clauses 2, 3 and 4 are **met**. Two things stand
between this lane and a formal `incoming-gate` PASS: **`bad` = 184** (that residual) and **`extQ` =
254**, both read off the whole-population walk re-run at this revision (`FAIL — 138 ambiguous + 47
unresolved of 1414582 edges …; 254 external claim(s) unverifiable (10617 verified + 254)`), and BOTH
are ruled, each row with a mechanism and a falsifier, and the falsifier for the
largest class **fired** (ROUND 7: it fails for exactly 1 of the 142 ambiguous edges, and that edge is
named with the file pair that proves it). On the SAMPLE draws `bad === 0`,
so there only `extQ` stands in the way. §7's five "done" criteria are each checked at the end of this
package. Read together: **this is a done lane by §7 and a clause-1-short lane by the four-clause
completion test** — two measurements, neither of them a PASS.

```
npx tsx script/m14/residual-gate.ts --lane yaml          # the four-clause instrument, whole corpus
npx tsx validation/m14/fixtures/yaml/lane-residual-census.ts   # the enumerator the gate cannot be
npx tsx validation/m14/fixtures/yaml/extq-census.ts            # the ext?/extOK/extFAIL triples, and the VERIFIED set they are a control for
npx tsx validation/m14/fixtures/yaml/dependency-position-census.ts  # every `yaml_depends_on` by POSITION
npx tsx validation/m14/fixtures/yaml/include-claim-control.ts
npx tsx validation/m14/fixtures/yaml/include-selector-control.ts      # the include POSITION guard, both directions
npx tsx validation/m14/fixtures/yaml/include-key-position-census.ts   # every include edge by the KEY that emitted it
npx tsx validation/m14/fixtures/yaml/document-claim-control.ts
npx tsx validation/m14/fixtures/yaml/workflow-needs-control.ts
npx tsx validation/m14/fixtures/yaml/pointer-cause-control.ts
BB_ONLY_REPOS=kubernetes,ansible,docker,hasura-engine,gql-graphql-mesh,gql-sangria,mojo,yq,hledger \
  npx tsx validation/m14/fixtures/yaml/name-collision-falsifier.ts   # the RULED CLASS's falsifier
npx tsx validation/m14/fixtures/yaml/store-scope-probe.ts     # the store layer, no context of its own
npx tsx script/m14/run-fixtures.ts --lang yaml                # 33 pass / 0 fail
```

### Clause 1 — per-type residual, each non-zero type with its named cause

The table below is `residual-gate --lane yaml`'s **own table, verbatim, at this revision**
(`residual-yaml-whole-corpus-after.txt`), with the `ofWhich` column kept because it is the tie-break
clause 4 reads:

| type | edges | resolved | ofWhich | amb(decl) | unresolved | extFAIL | causeFAIL | residual |
|---|---|---|---|---|---|---|---|---|
| contains | 1,380,046 | 1,380,046 | 4 | 0 | 0 | 0 | 0 | 0.0 % |
| uses | 165 | 165 | 0 | 0 | 0 | 0 | 0 | 0.0 % |
| exports | 4,080 | 4,080 | 0 | 0 | 0 | 0 | 0 | 0.0 % |
| extends | 155 | 155 | 0 | 0 | 0 | 0 | 0 | 0.0 % |
| overrides | 26 | 26 | 0 | 0 | 0 | 0 | 0 | 0.0 % |
| calls | 327 | 0 | 0 | 0 | 0 | 0 | 0 | 0.0 % |
| imports | 8,366 | 1 | 0 | **7** | 0 | 0 | 0 | 0.1 % |
| references | 21,417 | **19,075** | 0 | **130** | **47** | 0 | 0 | 0.8 % |
| **TOTAL** | **1,414,582** | **1,403,548 (99.2 %)** | **4** | **137** | **47** | **0** | **0** | **184 (0.013 %)** |

**THE TWO INSTRUMENTS NOW AGREE EDGE FOR EDGE: 137 ambiguous, 47 unresolved, 184 residual on both.**
The four-edge gap this paragraph used to explain is GONE, and it was retired rather than documented:
the enumerator used to call `incoming-rule.ts`'s `classifyEdge` WITHOUT the caller's `contains`
predicate, so it classified a containment by DECLARATION COUNT — the model `fa2dc27e8` retired,
because production resolves a containment with its own `WHERE s.project_id = ? AND s.name = ?`
`ORDER BY (s.file_id = ?) DESC LIMIT 1` statement and has no "N candidates" state at all. It now
imports `isContainsEdge` and passes it, which is bash-lane's pattern: the counting rule is IMPORTED,
not mirrored, so the split is evidence about the GATE rather than about the probe. A reader can no
longer pick the wrong number because there is only one.

Every cause was fixed with a before/after on the same instrument. Raw artifacts beside each commit;
the two current ones are
[residual-yaml-whole-corpus-after.txt](../../validation/m14/fixtures/yaml/residual-yaml-whole-corpus-after.txt)
and [census-yaml-whole-corpus-after.txt](../../validation/m14/fixtures/yaml/census-yaml-whole-corpus-after.txt).

| cause | count before → after | commit |
|---|---|---|
| a FILE include carried an owner claim (`apt.yml` → owner `apt`) | extFAIL **107 → 18** | `c3a2d71d6` |
| the claim was made without evidence — a URI scheme, a glob, a runtime-materialised path | extFAIL **18 → 0** | `8ec00358b`, `e3fc6487f` |
| `scalarValues` recursed into a mapping (role names, `tasks_from`, booleans as imports) | imports amb **75 → 57** | `e3fc6487f` |
| `include:` under `matrix:` is a CI build-matrix directive, not an include | imports edges **10,152 → 8,576**, imports amb **57 → 43** | `a7f216929` |
| a `needs:` target was a bare job name, declared once per workflow FILE | references amb **879 → 142** | `e3fc6487f` |
| the pointer index could not survive ERROR recovery (the grammar flattens the tree) | unresolved **762 → 47** | `5b12b6306` |
| a role import targeted the bare role NAME, which is not a symbol anywhere | imports amb **43 → 10** (33 of 43 resolve on disk, 62.7 % of 209 role sites) | ROUND 6 |
| an include-family tag was read as naming a TYPE (`declared_type -> include`) | references amb **141 → 131** | ROUND 7 |
| a QUOTED include path was refused for containing a space | `extQ` **−10** on that repo (re-claimed as verified files) | ROUND 7 |
| Azure Pipelines' `branches`/`paths` `include:` lists emitted as imports | imports edges **8,576 → 8,421**, imports amb **10 → 7**, `extQ` **−38** | ROUND 7 |

The `matrix.include` one is worth its own line because of the direction it fixes: the removed edges
were not merely ambiguous — **1,090 of them were sitting in `extOK` as VERIFIED claims about files
that do not exist** (`x64`, `preview`, `win7`, `stable`, and bulma's `gem install sass`). A false
import edge that RESOLVES is worse than one that does not. `ext?` fell 750 → 299 on `imports`.

### Clause 2 — the must-be-zero columns, and the `extQ` RULED CLASS

`extFAIL = 0`, `bindFAIL = 0`, `causeFAIL = 0`, on the whole population.

Stated plainly so that "0" is not read as a formal PASS: `externalUnverified` is NOT zero. The
residual gate counts a claim the project cannot check as accounted-for; `incoming-gate` additionally
requires `externalUnverified = 0` for a PASS. **Round 5 moved that number 1,903 → 343 by fixing the
claims, not by marking differently** (the section above: 1,560 of the 1,903 were `isExternal` said
about a file the project HAS — 1,356 cross-file `$ref`s and 208 local reusable-workflow calls —
and 67 more were false dependency edges sitting in the VERIFIED column). **Round 7 moved it again,
343 → 335 (the role-entry fix) → 255 (Rounds 7–9) → **254** (Round 10)**, by removing 80 edges that were being counted
as unverifiable imports and are not imports at all (Azure Pipeline branch filters, semgrep/flutter/
ffigen/Dart-builder selector lists, a Spring Boot endpoint list, a GitHub Actions job output) and by
re-claiming the quoted hasura includes as VERIFIED files — again by fixing claims, not by marking.

The remaining **254 are ruled as a CLASS, with the four things the fleet ruling requires**: the
SHAPE split (the enumerator's 17 rows, grouped to 6 below), the MECHANISM (each row's "why nothing
can check it"), the COUNT split by shape, and a FALSIFIER per row ("what WOULD verify one"). The
largest single piece of
the ruling — **88 `package:`/`dart:` includes** — is dispositioned as a FACT-BUILDING question rather
than a lane defect, because `verifyImportClaim` already answers exactly that shape and the gate
builds the pubspec facts it needs for `dart` alone; wiring them for this lane without measuring would
risk turning verified claims into refutations (`package:lints` IS declared in that checkout). Three
further rows are the LEAD's, and are flagged rather than changed: one (`verifyRemoteRefClaim`
refusing `@release/v1`, 2 edges) is a rule-shape question in a shared gate, and two are POPULATION
decisions (admitting `.psm1`/`.json`/`.sh` to an evidence base that is `.yaml`/`.yml` by construction).

So this lane is at **residual 184 with zero refutations and 253 ruled unverifiable claims**, not at
PASS, and the difference between the two statements is a measurement: the extQ class was cut by 87%
(1,903 → 254) by correcting false claims, and every claim in it now carries its reason, its count and its falsifier.

### Clause 3 — every remaining edge attributed

**The 47 unresolved, split into RULED and merely unresolved.** Both are ruled, and the split is
produced by `parseHadError` rather than asserted:

| count | reason | ruling |
|---|---|---|
| 33 | `pointer-not-declared-in-file` | **RULED** — the documents parse CLEANLY and the pointer is genuinely not declared. Mostly openapi loader fixtures whose `$ref` names a definition the file does not carry. |
| 14 | `parse-error-in-document` | **RULED, and it is not reachable by the fallback.** See below. |

**The Lead's question, answered: the 14 are genuinely outside anything the analyzer can see.** At
line 2288 of `docker/api/docs/v1.25.yaml` the parser emits a bare **`flow_node`** — not a
`block_mapping_pair`. The recovery hoisted `definitions`' members to the top level, and in doing so
the KEY NODE for `EndpointSpec` does not exist anywhere in the tree: the walk finds no pair whose
key is `EndpointSpec`, so no declaration can be extracted however the fallback is written. The
fallback matches against the document's declared paths; a declaration that was never created has no
declared path, so it correctly REFUSES to bind (`ServiceSpec.properties.EndpointSpec`, line 2282, is
a different symbol — the `$ref`'s own site). Reaching it would mean synthesising a declaration from
a stray scalar node, which is fabrication. Signed: one key node per `$ref`, 14 edges, 14 versioned
spec files.

**The 137 ambiguous, by cause — and this is the table Round 7's falsifier rewrote, with the one edge it FALSIFIED since FIXED (ROUND 11).**

The falsifier is `validation/m14/fixtures/yaml/name-collision-falsifier.ts`, and it reads the KIND off
the REFERRING KEY and looks for that kind and name in the project's own text. It is what turns each
row below from an argument into a verdict:

| count | type | cause | disposition (falsifier verdict) |
|---|---|---|---|
| **0** | references | ~~`serviceAccountName: apiserver` …~~ | **FIXED in ROUND 11** — the falsified edge is now resolved: the rule was PRICED (CEILING 1, CONTROL 0, 117 refused), applied as `resolveSameDirectoryResource`, and the falsifier now reads `RULING HOLDS` with CEILING 0. The edge resolves to the sibling's document identity `staging.src.k8s.io.sample-apiserver.artifacts.example.sa`. |
| 117 | references | **k8s object references whose object the project does not declare.** `secretName: test`, `claimName: test`, `configMap.name: test` in pod-security testdata | **RULED.** The falsifier found a same-kind name only ELSEWHERE in the project (`hack/testdata/diff/secret.yaml`, a different manifest set — another cluster, not this referent), and no same-kind name in the referring directory. The 8 declarations named `test` are unrelated: CRD fields, CRD schema properties, an annotation key, a CircleCI job, Taskfile tasks. |
| 10 | references | `serviceAccountName: default` (7, the cluster's built-in ServiceAccount), `secretName: kubeconfig` (2), `secretName: secret` (1) | **RULED** — a kind was asked for and the project declares no object of it with that name (falsifier: 0 same-kind hits anywhere). |
| 6 | imports | **role NAMES the project does not have** — `dnf` (2), `import_role`, `role`, `no_log`, `include_vars`, in ansible integration tests that name keywords as roles | **RULED** — the falsifier checks `roles/<name>/` and finds no such directory; a role import names a role, and not naming it would drop a true edge. |
| 4 | references / imports | no kind axis at all: `data` (3, `$ref` targets) and `foobar` (1, `include:`) | **RULED** — the generic count model, not the kind question; every one is a bare name that collides with an ordinary key of the same spelling. |

**1 of 142 is a defect and 141 are ruled** — and the 1 is named with the file pair that proves it.
That is the whole value of writing the falsifier first: the lane proposed a ruling for 142 edges and its
own instrument cut it to 141.

The enumerator is refreshed at THIS revision as
[census-yaml-whole-corpus-after.txt](../../validation/m14/fixtures/yaml/census-yaml-whole-corpus-after.txt)
(1,414,582 edges · amb 131 + 7 · unresolved 33 + 14 · extFAIL 0 · `EXT-Q INVENTORY` **254**, whose
`CLAIMABLE EDGES` section reads NONE), which is ROUND 10's run and is the artifact every "current"
number in this document comes from, with the emitting-key instrument beside it as
[include-key-position-yaml-whole-corpus.txt](../../validation/m14/fixtures/yaml/include-key-position-yaml-whole-corpus.txt).
The per-round copies carry their OWN totals and are kept so a reader can see each step rather than a
final number: [round 7](../../validation/m14/fixtures/yaml/census-yaml-whole-corpus-round7.txt)
(1,414,637 · `extQ` 282) and
[round 9](../../validation/m14/fixtures/yaml/census-yaml-whole-corpus-round9.txt)
(1,414,582 · `extQ` 255), with this run's own name-preserving copy as
[census-yaml-whole-corpus-round10.txt](../../validation/m14/fixtures/yaml/census-yaml-whole-corpus-round10.txt).
All of them are re-runnable.

**An earlier revision of this paragraph cited the round-7 artifact for the round-9 totals**
(1,414,582 / 255), which a reader can check against the artifact and which is not what it says. The
numbers were right and the citation was wrong; it is corrected here, and the falsifier for every
quoted figure in this document is now the file it names.

`calls` (327): **all 327 are claims the project CONFIRMS** — 119 `remoteRef` (a pinned
`owner/repo/path@ref`, or a `docker://` image, verified by spelling) and **208 `projectFile`** (a
LOCAL reusable-workflow call, `uses: ./.github/workflows/build.yml`, verified against the project's
own file list). Round 5 moved the 208 from `ext?` to `extOK`: they were the second half of the
`isExternal`-about-a-file-the-project-HAS defect, and the `workflowCallClaim` fix is what makes them
check. Residual 0.0 %.

### The whole-population incoming scope — the two instruments agree to the edge

`incoming-gate.ts yaml yaml,yml 0` walked **every** admitted file at THIS revision
(`18,364 parsed of 18,364 sampled — corpus has 18,364 .yaml,yml files across 189 repos`, both
spellings admitted, 630 tracked-but-absent + 5 over the 1 MB cap excluded and stated), and its verdict
reproduces the residual gate's model number for number from an independently-written classifier:

```
separator tripwire: 0 published key(s) contain `\u0000` of 1414582 edges measured
                     (0 required: a declaration name carrying it would make a binding claim unfalsifiable)
TABLE 1 — PER PROJECT, the scope production resolves in (this is the verdict's)
type          edges    resolved  amb(decl)  unresolved  extFAIL
calls         327      0         0          0           0
uses          165      165       0          0           0
contains      1380046  1380046   0          0           0
imports       8366     1         8          0           0
references    21417    18701     585        47          0
exports       4080     4080      0          0           0
extends       155      155       0          0           0
overrides     26       26        0          0           0
TOTAL         1414582  1403174   593        47          0

VERDICT: FAIL — 138 ambiguous + 47 unresolved of 1414582 edges, resolved against the file's OWN
PROJECT (production's scope); 254 external claim(s) unverifiable (10617 verified + 254 unverifiable)
  (the same edges under the pooled corpus key space: 593 ambiguous + 47 unresolved — that number is
   about the CORPUS's name collisions, not about resolution as production performs it)
instrument self-test: PASS (control fired)
```

Raw: [incoming-gate-yaml-whole-corpus-round10.txt](../../validation/m14/fixtures/yaml/incoming-gate-yaml-whole-corpus-round10.txt)
(the ROUND 5 run it replaces, kept as the historical record of `1,414,804 · amb 184 · extQ 343`, is
[incoming-gate-yaml-whole-corpus-round5.txt](../../validation/m14/fixtures/yaml/incoming-gate-yaml-whole-corpus-round5.txt)).

**The three things this walk settles, none of which the enumerator alone could:**

1. **`extOK 10,617` / `extQ 254` — the gate's own columns, and they match the enumerator's to the
   edge.** Two independently-written instruments, one shared number: the Round 10 fix moved `extQ`
   255 → 254 in BOTH.
2. **`extFAIL 0` over 1,414,582 edges**, which is the test the Round 10 fix had to pass: it turns an
   `isExternal` claim into a FILE claim, and a file claim that MISSES is refuted. Nothing was refuted.
3. **`bad` = 138 + 47 = 185** in the verdict's own words, and `254` `extQ` beside it. The verdict names
   **TWO** reasons and both are ruled: the attributed residual of Clause 3 and the RULED CLASS above.
   **`bad === 0` AND `extQ === 0` would make this run a PASS**; the sample draws achieve the first and
   are stopped by the second, and the whole-population run is stopped by both. The gap is therefore the
   RULED CLASS twice over — stated as a number rather than a hope, and now measured on the whole
   population at the same revision as the fix rather than on a round-old tree.

### Clause 4 — the tie-break

Restated on the current revision: **`ofWhich` = 4**, all in `contains`, with **`intended` =
1,380,046 of 1,380,046** — every containment edge binds to a declaration in its OWN file on its own
line. Against the indexer's control arm of 37,318 wrong picks out of 49,729, this lane has four
candidates to lose. Every other type is `ofWhich` 0. For `imports`, `twin` 82 is a RISK and not
proven wrongness: a foreign declaration is what a cross-document import IS.

### The verdict, clause by clause

Mirroring `docs/analyzers/json.md`'s completion package, the answer is stated as the instrument would
grade it, not as the lane would prefer it:

| clause | what it asks | yaml | verdict |
|---|---|---|---|
| 1 | residual 0 for every applicable type | 184 of 1,414,582 (137 amb + 47 unresolved) | **FAILS by 184** — every edge attributed below |
| 2 | `extFAIL` = `bindFAIL` = `causeFAIL` = 0 | 0 · 0 · 0 on the whole population | **MET** — with `extQ` 254 *ruled*, not zero |
| 3 | every remaining edge attributed to a named cause with a measured count, fixed with a before/after or ruled with evidence | the 138 ambiguous are 117 same-kind-name-elsewhere + 7 ansible role names + 6 no-kind-axis + 4 duplicate-key `contains` + 1 SAME-DIRECTORY MISS + 3 `$ref`-to-nothing (named causes, each with a falsifier), and the 47 unresolved are 33 + 14 (two named causes); NINE causes fixed with before/after (the two tables above) | **MET** |
| 4 | the tie-break: `ofWhich` 0, or an `intended` vs `arbitraryTwin` split from the store | `ofWhich` 4, all `contains`; `intended` 1,380,046/1,380,046 at the model level | **MET at the model level; the store-side split is NOT done** |

**If the owner rules that no external claim may be unverifiable, yaml fails clause 2 by 254 edges** —
the same structural failure json carries by 120. Those 254 are not un-fixed claims: they are targets
(templates, URIs, globs, runtime-materialised paths) that no single-file parse can name, and the only
alternative to ruling them is to refute them, which would falsify a claim that is not false.

**The one clause-4 gap, named.** json split `collRes` by putting every declaration of both colliding
targets into a store and reading `intended` vs `arbitraryTwin` off `brain_relationship.target_symbol_id`.
For yaml that store-side split is **not yet done**: the four `ofWhich` edges are `contains` whose
`intended` reading (1,380,046/1,380,046) is the GATE's model of the own-file/own-line rule, and the
lane's own sample pass reads `intended 1510 · arbitraryTwin 0 · noDeclaration 0` (the gate's BINDING
INTENT table, whose own-file/own-line column is `store-binding-truth.mts`'s class — validated on hcl,
not on yaml). That is a "not yet measured on this lane" statement, not a "measured wrong" one, and it
is the single place this package falls short of json's.

**The tie-break is not where a lane hides.** A lane at residual 0 whose resolved edges were chosen by
`s.id` is NOT done (§5g clause 4). yaml is not at residual 0, so the clause cannot be waved: the four
`ofWhich` all sit in `contains`, the type for which the analyzer writes the edge ON the target
symbol's own line, where the store resolver's own first two keys (`file_id = edge file`,
`line_start = edge line`) both match and the intended row binds (`resolveContainsTargetStmt`).

### §7 — the five criteria, each checked

§7 defines a lane as DONE when all five hold. Each is checked here against its artifact, not asserted:

1. **`implemented/applicable` from the declared `coverage` block, every exclusion carrying an
   evidence class.** `script/m14/spec/yaml-completeness.json` declares `8 + 0 + 0 = 8 applicable =
   10 − 2`, both exclusions (`implements`, `instantiates`) `grammar-absence` with a 47-node inventory
   behind them, and the board row reads `8/8` `from=spec coverage block` with **no "coverage block
   does not close" note**. Re-run at this revision, the row reads: `yaml 5/10 calls implements exports
   overrides instantiates FAIL 954/762/1416614 18u 4 8/8 spec coverage block implements(G)
   instantiates(G) … STALE` — i.e. **`8/8` with `from=spec coverage block` and no coverage-block
   note**. The `FAIL 954/762/1416614` columns are the SHARED board log's incoming row for this lane
   (stale, and flagged so), and they are deliberately not refreshed here: `incoming-gate.ts
   --board-log --only yaml` OVERWRITES the whole log with one lane's three lines, which would destroy
   22 other lanes' rows. The lane's own whole-population numbers in this package come from the two
   instruments run directly instead. **MET.** (The block was corrected this round — criterion 5.)
2. **every silent type implemented or ruled by a grammar inventory or a whole-corpus zero-site
   count.** The board's SILENT for this lane is `calls implements exports overrides instantiates`.
   `implements`/`instantiates` are ruled by the 47-type grammar inventory (0 declaration nodes, 0
   construction nodes) AND a whole-corpus site count; `calls` (327), `exports` (4,080) and `overrides`
   (26) are **implemented and fire on the whole admitted population** — silent only on the board's
   narrower draw, which is the D14 sample-vs-population statement. **MET.**
3. **both incoming scopes measured, with the sample-budget share stated.** The 60-file stride draw is
   a **PASS** (1,512 edges, 2 verified + 0 unverifiable external, separator tripwire 0). The 200-file
   draw — 200 of 12,463 `.yaml`, a **1.6 % share** — reads **`bad === 0`** and FAILs only on the 2
   ruled-shape claims (`extOK 12 · ext? 2 · extFAIL 0`; **re-run at the Round 10 revision and
   reproduced to the edge**, with a second draw over BOTH extensions reading `bad === 0` on 4 ruled
   claims). The **whole-population** scope — 18,364 of
   18,364 `.yaml`/`.yml`, both spellings, 189 repos, **100 %** — is the `incoming-gate yaml yaml,yml 0`
   walk **re-run at this revision**, quoted verbatim in the section above and reading
   **`FAIL — 138 ambiguous + 47 unresolved of 1414582 edges …; 254 external claim(s) unverifiable
   (10617 verified + 254 unverifiable external)`**, with the separator tripwire at 0 and the instrument's
   own control firing (`instrument self-test: PASS`). The four-clause gate spawned the same walk and
   reads `residual 185 of 1,414,582 · extFAIL 0` — **two instruments, one number, at the frozen tree**.
   Artifact: [incoming-gate-yaml-whole-corpus-round10.txt](../../validation/m14/fixtures/yaml/incoming-gate-yaml-whole-corpus-round10.txt).
   **MET.**
4. **`externalRefuted = 0`, verified on the lane's own marks.** The whole-population enumerator reads
   **`extFAIL 0` over 1,414,582 edges at THIS revision
   ([census-yaml-whole-corpus-after.txt](../../validation/m14/fixtures/yaml/census-yaml-whole-corpus-after.txt),
   whose `REFUTED INVENTORY` reads `0 edges, 0 distinct target(s)`)** — that is the Round 10 run, and
   it is the artifact this criterion's number comes from (`extFAIL 0` also held at the Round 5 and
   Round 7 revisions, 1,414,804 / 1,414,637, so the 0 is not an artefact of one revision);
   `incoming-gate` reads `extFAIL 0` on both draws AND on the whole-population walk
   (`TOTAL … extFAIL 0` over all 18,364 files); and the lane's own `extq-census.ts` prints the
   VERIFIED set beside the triples, so the 0 is a control and not an absence. **The Round 10 fix was
   the one that could have moved this column** — it turns a claim from `isExternal` into a FILE claim,
   and a file claim that MISSES is refuted — so the whole-population `extFAIL 0` above is also the
   test of that change, not just a number reported beside it. **MET.**
5. **every ruling and guard has a falsifier, and the lane corrected any of its own numbers a later
   measurement contradicted.** The RULED CLASS table carries a "what WOULD verify one" column; each
   control has a **falsifier run** (revert `pointerClaim` ⇒ 7 red / exit 3; remove the position gate
   ⇒ 2 red / exit 3); and the `coverage` block's `_corpusUnexercised_retraction` is exactly this
   criterion — the ansible-only `calls 0 / exports 0` reading was CONTRADICTED by the whole
   population (327 / 4,080) and the block was corrected with the struck readings kept. **ROUND 10
   added two more instances of the same criterion, both against the artifacts:** this document had
   attributed the `claimable` flag to `./.github/codeql/queries` (the artifacts name a step-level
   reusable-workflow call — `./.github/workflows/test-failure-notification.yml` @ nomad:45 — and the
   flag's GROUP prints `./security-scanner`), and it had cited the round-7 census for the round-9
   totals (that artifact reads 1,414,637 / `extQ` 282, not 1,414,582 / 255). Both are corrected above
   with the file that refutes the old reading, which is what this criterion asks for. **MET.**

**So the lane is DONE by §7 — all five, each against an artifact — while the stronger four-clause
completion test is clause-1-short by 185, and clause-2-short by 254 if unverifiability is forbidden.**
The difference between those two sentences is the point: §7 asks whether the lane has done the work it
owes; the four clauses ask whether every edge is PROVEN. yaml has done the work, and states plainly
which edges are proven, which are ruled, and where the remaining 185 live — including the ONE that its
own falsifier proved is a real missed resolution rather than a ruling (ROUND 7).

### The §7 criterion-2 arbiter can now ADJUDICATE this lane — it previously REFUSED (2026-10-10)

`npx tsx script/m14/ontology-coverage-gate.ts yaml` is the fleet's criterion-2 instrument: it
certifies a lane's ABSENT types against a grammar inventory plus a measured key-space probe. Run
against yaml before this round it walked the whole corpus and then printed:

```
ontology coverage gate — no RULING SOURCE for yaml.
Refusing to report: with no ruling anywhere, every un-emitted type would be called
RULED-UNJUSTIFIED …  Neither RULED_BY_LANG.yaml nor script/m14/spec/yaml-completeness.json supplies one.
```

Two things were missing, and BOTH are lane-owned:

1. **The spec's rulings were invisible to the arbiter.** `rulingFor` reads
   `design_decision.decisions[].resolution` for a row whose `status` is `RULED`; yaml's YAML-D9..D12
   carried `decision` / `why` / `subject` and no `resolution`, so `rulingFor` found nothing for
   `implements` or `instantiates` — the two types un-emitted over the whole population. Fixed
   additively: **YAML-D10 and YAML-D11 now carry a `resolution`** that spells the type name and
   states the measurement.
2. **No space attestation.** yaml is a KEY-BEARING language — **18,368 distinct attribute keys over
   296,009 key sites** in a 3,671-file stride draw (and 3,845 distinct top-level keys) — so a
   vocabulary-based ruling is RULED-UNJUSTIFIED without the `attribute-keys` space. Fixed by a new
   [ruling-attestation.json](../../validation/m14/fixtures/yaml/ruling-attestation.json) pointing at
   [ontology-census.json](../../validation/m14/fixtures/yaml/ontology-census.json) (emitted by
   [ontology-census.ts](../../validation/m14/fixtures/yaml/ontology-census.ts)), which the gate
   VERIFIES pointer by pointer: `nodeTypes=36, blockTypes=4, attributeKeys=18368,
   implements.constructSites=0, instantiates.constructSites=0`.

**Result, and it is stated with its limit.** The mechanism is PROVEN on a complete walk: on the
ansible corpus (`2,082/2,082` files measured, `100.0 %`) `implements` and `instantiates` both read
**`RULED-SOUND`** — *attested over node-types, block-types, attribute-keys* — where before the run
refused outright. Over the WHOLE admitted population (`18354/18364 measured, 99.9 %`) the verdict is
`8/10 emitted · ruled-sound 0 · FALSIFIED 0 · ruled-without-justification 0 · **ruled-unknown 2**`:
the two grammar-absence types read `RULED-UNKNOWN — NOT CERTIFIED`, and the reason is a SHARED
defect, not this lane's. Ten files come back **DEGRADED** from the walk with `[BB-PARSE-ERR] … memory
access out of bounds` (the gate walks at `concurrency: 8`, `ontology-coverage-gate.ts:661`), which
makes the walk PARTIAL and the gate correctly refuses to certify ABSENCE over `18,354` of `18,364`.
The files are not the problem: parsed singly through the SAME production path they are all clean
(`apps.v1.DaemonSet.yaml` 1,312 symbols, `pubspec.yaml` 5, `02-gateway.yml` 151,
`.tmp-probe/yaml-single-parse.mts`), and the incoming gate parsed all 18,364 with 0 failures. So the
residual is a WASM/concurrency defect in the shared walk, reported-not-fixed here — it is the same
shape the css lane named: *an instrument cannot certify over a population it failed to parse.*

Artifacts: [ontology-gate-yaml-whole-corpus-round5.txt](../../validation/m14/fixtures/yaml/ontology-gate-yaml-whole-corpus-round5.txt)
(partial walk, `ruled-unknown 2`) and
[ontology-gate-yaml-ansible-complete.txt](../../validation/m14/fixtures/yaml/ontology-gate-yaml-ansible-complete.txt)
(complete walk, `ruled-sound 2`).

### Which layer each number came from

**Every number above is the GATE'S MODEL.** `incoming-gate.ts`, `residual-gate.ts`, the census and
every control pass `projectRoot` explicitly, so this lane's document scope, its
`<document>.jobs.<id>` targets and its file claims were always scoped in the measurements.

The STORE was a different key space for this lane until `a82e4134d`: `pool-worker.ts`'s
`contextFor(filePath)` supplied a context only when a project index existed for the extension, and
`indexCache` is null unless the worker was handed indexes (dart alone) — so production indexed yaml
with NO `projectRoot`. The store-side check is
[store-scope-probe.ts](../../validation/m14/fixtures/yaml/store-scope-probe.ts), which passes no
context of its own (a scope can only appear if the WORKER supplies a root):

```
store symbols 873 · qualified names 873 · carrying the file's own scope: 873
model names   873 · carrying the same scope:              873
names the model has and the store does not: 0
names the store has and the model does not: 0
VERDICT: store is SCOPED; layers AGREE name-for-name
```

So before that commit there were two key spaces for yaml and after it there is one — the numbers
above describe the model, and the store now publishes the same names, verified rather than assumed.

## 0. Round 4 — the error-recovered pointers resolve

| `residual-gate --lane yaml` | extFAIL | imports amb | references amb | unresolved | residual |
|---|---|---|---|---|---|
| end of round 2 | 18 | 63 | 142 | 762 | 1,734 |
| end of round 3 | 0 | 57 | 142 | 762 | 961 |
| **now** | **0** | **57** | **142** | **47** | **246** |

Whole admitted population, 1,416,423 edges, 18,364 files, 189 repos: **resolved 99.1 %**, extFAIL 0,
bindFAIL 0, causeFAIL 0, `ofWhich` 4 (all `contains`).

**The 762 → 47: `pointerPath` now survives ERROR recovery.** The grammar does not merely mis-key a
pointer on a malformed document — it **flattens the tree**. Measured on docker's
`api/docs/v1.25.yaml`: the root is an ERROR node whose 54 `block_mapping_pair` children include
`swagger:` at line 12 AND `MountType:` at line 186 — `definitions:` itself is gone and its members
were hoisted to the top level. So the walk indexes `/MountType` while the document's `$ref` says
`#/definitions/MountType`, and the declaration is published as `api.docs.v1.25.MountType`.
`resolvePointerOnRecoveredTree` binds such a `$ref` to the document's own declared path when — and
only when — the decoded pointer is a SUFFIX of it and the LONGEST match is unique; the binding is
marked `resolvedVia: document-shape-suffix` at confidence 0.95 rather than posing as an exact hit,
and it is consulted **only on a tree the grammar errored on**, so no clean-parse resolution can
move. On that file: 0 → 35 of 36 pointers resolved.

The 47 that remain, both named:

| count | reason | what it is |
|---|---|---|
| 33 | `pointer-not-declared-in-file` | files that DO parse cleanly — genuinely undeclared pointers, mostly openapi loader fixtures |
| 14 | `parse-error-in-document` | docker's 14 versioned specs, all `#/definitions/EndpointSpec`: the declaration sits at line 2288, INSIDE the error region, and is never extracted (`ServiceSpec.properties.EndpointSpec` at line 2282 is a different symbol). The fallback REFUSES rather than binding it — the no-fabrication arm the control pins |

That refusal is the point: a recovered binding that is not unique, or whose target this analyzer
never published, is left unresolved. An ambiguous `$ref` is not a resolved one.

## 0.1 Round 3 — the must-be-zero column is ZERO

| `residual-gate --lane yaml` | extFAIL | imports amb | references amb | unresolved | residual |
|---|---|---|---|---|---|
| end of round 2 | 18 | 63 | 142 | 762 | 1,734 |
| **now** | **0** | **57** | **142** | **762** | **961** |

Raw: [residual-yaml-whole-corpus-after.txt](../../validation/m14/fixtures/yaml/residual-yaml-whole-corpus-after.txt)
· [census-yaml-whole-corpus-after.txt](../../validation/m14/fixtures/yaml/census-yaml-whole-corpus-after.txt)
(1,416,423 edges, 18,364 files, 189 repos, 0 failed, 0 degraded). `ofWhich` — resolved edges whose
target had MORE THAN ONE declaration, so production's tie-break chose the row — is **4**, all in
`contains` (4 of 1,380,046, and `intended` is 1,380,046/1,380,046: every containment edge binds in
its OWN file). The indexer measures 37,318 of 49,729 such picks as wrong; this lane has four of
them to lose.

Three causes, in the Lead's order.

**1. The 18 → 0: a claim is made only where the analyzer has EVIDENCE for it.** The Lead's ruling,
now the same rule in json, toml and yaml. `verifyFileClaim` refuting a miss is pinned by the gate's
own control and was NOT weakened; what changed is which edges assert the claim. `projectCarriesFile`
(one `statSync`, mirroring json-lane exactly, including "an error that is not `ENOENT`/`ENOTDIR`
counts as present") gates every file claim, and a `uses: ./dir` now claims the action's MANIFEST
(`action.yml`/`action.yaml`) rather than the directory, which this lane's admitted `.yaml`/`.yml`
file list could never admit. The 95 verified edges keep verifying; the 18 that named paths the
project cannot be asked about — directories materialised at run time, a CodeQL query directory
holding only `.ql`, files ansible's tests deliberately omit — state `isExternal`, which on a
path-shaped target is `externalUnverified`.

**2. imports 75 → 57 ambiguous: `scalarValues` recursing into a mapping.** One
`- import_role: {name: role1, tasks_from: x.yml, allow_duplicates: true}` published the role name,
its sub-file and a BOOLEAN as three imports of this file. Attributed by the key on each edge's own
`line_number`: of 891 ansible include edges only 567 came from a key that names a file (149 from a
nested `name:`, 45 `tasks_from:`, 18 `role_name:`, 51 from `hosts:`/`public:`/`gather_facts:` …).
`fileImportTargets` now follows the key's meaning: a file key takes its scalar, or the `file:`
sub-key of a mapping (a mapping is NOT a list of files); a role key takes its `name:` or the scalar
shorthand. Corpus-wide imports went 10,343 → 10,152 edges. The 57 that remain are mostly role NAMES
(ansible test roles literally called `a`, `b`, `c`) colliding with property keys of the same name —
inherent to referencing a role by name, not over-emission.

**3. references 879 → 142 ambiguous: a `needs:` target now names the JOB.** `needs: [test]` names a
job declared once per WORKFLOW FILE, so the bare name has N declarations in the project and
production's `COUNT(*) = 1` bare-name rule can never bind it — 802 of the 879 measured. The lane
already publishes each job as `<document>.jobs.<id>`, so the edge now targets that, gated on the
document's own shape index (`resolveJobInDocument`), which leaves Compose `depends_on` and any name
that merely looks like a job untouched. The 142 that remain are a different shape — 117 of them are
ONE k8s testdata name (`test`, 8 declarations).

**Unresolved 762 = 729 + 33, both now truthfully reasoned.** 729 are docker's `api/docs/*.yaml`,
where the pinned grammar error-recovers and the pointer index is keyed by paths the document does
not have (round 2's finding). The 33 are `pointer-not-declared-in-file` in files that DO parse
cleanly — i.e. genuinely undeclared pointers, mostly openapi loader test fixtures. Because the
reason is now chosen by `parseHadError`, that split is a measurement rather than an assertion.

## 1. Coverage — declared, and CLOSED
`script/m14/spec/yaml-completeness.json` carries the `coverage` block the board reads
(`yaml 8/8 from=spec coverage block`, with **no** "coverage block does not close" note):

| | types |
|---|---|
| implemented (8) | `contains`, `uses`, `references`, `imports`, `extends`, `overrides`, `calls`, `exports` |
| excluded — `grammar-absence` (2) | `implements` (YAML-D10), `instantiates` (YAML-D11) |
| corpusUnexercised (0) | — |

Invariant: `8 + 0 + 0 === 10 − 2`, and both exclusions are `grammar-absence` with a measured
node-type census behind them.

**UPDATED 2026-10-10 (Round 5):** `calls` and `exports` moved here from `corpusUnexercised`. The
reading they stood on — `lane-census.ts` over ansible's 2,076 files: `calls 0 edges, 0 sites`,
`exports 0 sites` — is a SAMPLE statement that the WHOLE admitted population contradicts (`calls`
327, `exports` 4,080, both 0 ambiguous / 0 unresolved). The struck rows are kept in the spec's
`_corpusUnexercised_retraction` so a declaration that lost a row is seen to have lost only the false
ones, and the board went `6/8` → `8/8`.

## 2. The residual — "n/n is not done"

> **HISTORICAL (Round 2, 2026-10-09).** The CURRENT residual is **185** (138 ambiguous + 47
> unresolved, whole admitted population) — see the ROUND 7 section and the COMPLETION PACKAGE above.
> This section is kept as the record of the numbers it was written from; sections 3 and 4 below carry
> the named-cause work that took them down.

`npx tsx script/m14/residual-gate.ts --lane yaml` is the completion question: of every emitted
edge, which are not yet real. Whole admitted population, production scope.

| type | edges | resolved | amb(decl) | unresolved | extFAIL |
|---|---|---|---|---|---|
| contains | 1,380,046 | 1,380,042 | 4 | 0 | 0 |
| references | 21,472 | 17,576 | 879 | 762 | 1 |
| imports | 10,343 | 27 | 75 | 0 | 102 |
| calls / uses / exports / extends / overrides | 4,753 | 4,753 | 0 | 0 | 0 |

`contains` — 97 % of the lane's edges — is effectively exact. The whole residual is in two
types, and both are worked below with a measured cause.

## 3. `imports` — the refuted external claims (must-be-zero)

A refuted external claim is the one outcome that says the analyzer's own claim is false, so it is
the lane's only must-be-zero defect.

**Before this round: 107 refuted on the ansible population (2,082 files), every one an `imports`
target spelled as a file name** — `apt.yml`, `cleanup.yml`, `mode.yaml`, `embed.yml`, … The gate
took the owner `apt` off `apt.yml`, found a published declaration named `apt`, and counted the
claim REFUTED. Raw: [../../validation/m14/results/yaml-ansible-both-spellings.txt](../../validation/m14/results/yaml-ansible-both-spellings.txt).

Hypothesis split, measured rather than argued:

* **(a) the analyzer published a FILE reference as a bare NAME claim** — CONFIRMED, and it is this
  lane's defect. The `yaml_keyword_include` site hard-coded `isExternal: true` while the sibling
  tag-include site had carried the `projectFile` claim since it was written.
* **(b) the gate's owner extraction also read a filename's stem as an owner** — real, and the
  Lead's file; fixed in `5a611de4b`.

**The fix (this lane).** `keywordIncludeClaim` states the file claim when the target is spelled
as a `.yaml`/`.yml` path, and `isLiteralPathSpelling` refuses every spelling that is not a path.
The suffix restriction is not decoration: the arbiter's file list **is** this lane's admitted
population, so a claim about any other suffix could only ever be refuted by the claim itself.

Four refusals, each measured, each stopping the fix from *manufacturing* refutations:

| refusal | measured sites | why |
|---|---|---|
| templates `{{ }}` / `${ }` / whitespace | 11 | `'{{ service_type }}_cleanup.yml'` is not a path |
| `include_role` / `import_role` sub-keys | 10 | `tasks_from:` is relative to a ROLE directory |
| role-relative candidate added instead | 8 | a role's `handlers/main.yml` resolves a bare name in its `tasks/` |
| **URI schemes** (`package:`, `dart:`) | **85** | a Dart pub URI ends in `.yaml` but is not a path |
| **globs** (`*`, `?`) | **1** | a glob names a set, so no single candidate is the thing it names |

The last two were found only by a **whole-corpus** enumeration, after the first control passed:
`package:lints/recommended.yaml` (56 edges), `package:dart_flutter_team_lints/analysis_options.yaml`
(18), `package:lints/core.yaml` (5), `package:flutter_lints/flutter.yaml` (4),
`package:foo/foo_package_options.yaml` (1) are `include:` directives in Dart `analysis_options.yaml`
files, and `.vsts-ci/windows/*.yml` is an azure-pipelines path filter.

### The number, before and after

`residual-gate --lane yaml`, whole admitted population (1,416,614 edges), the same instrument both
times:

| | extFAIL | imports extFAIL | references extFAIL | total residual |
|---|---|---|---|---|
| baseline (committed raw) | **103** | 102 | 1 | 1,823 |
| after the URI + glob guards | **18** | 17 | 1 | 1,734 |

Raw: [residual-yaml-whole-corpus-baseline.txt](../../validation/m14/fixtures/yaml/residual-yaml-whole-corpus-baseline.txt)
and [residual-yaml-whole-corpus-after.txt](../../validation/m14/fixtures/yaml/residual-yaml-whole-corpus-after.txt).
`contains` reads 1,380,046 resolved / 0 ambiguous in the after run — that is the Lead's
`fa2dc27e8`, which stopped the gate asking a declaration-count question the resolver never asks;
no analyzer changed for it.

**The control that makes the fix checkable.** A claim kind cannot be checked by reading source, so
[include-claim-control.ts](../../validation/m14/fixtures/yaml/include-claim-control.ts) runs the
production path (`pool-worker.parseFile` with a project root) and applies the arbiter's own
`classifyEdge`. 20 assertions, all passing, and it is falsifiable in both directions:

* the same edge and key space show the OLD claim **not verifying** `apt.yml` while the file claim
  **verifies** it — so the file claim is the thing doing the work;
* an absent literal file (`missing.yml`) still **refutes** the claim — the fix did not turn
  refutation off;
* each of the four refusals keeps the pre-existing marker.

Output: [include-claim-control.txt](../../validation/m14/fixtures/yaml/include-claim-control.txt).

### Open on `imports` — the 18 that remain

The residual refutations are enumerated, not guessed, by `validation/m14/fixtures/yaml/lane-census.ts`-style census (whole
corpus, the arbiter's own rule). Each has a named reason, and **not one of them is removable by a
better spelling**:

| count | target | reason |
|---|---|---|
| 7 | `./security-scanner` | a HashiCorp workflow checks `hashicorp/security-scanner` out into `./security-scanner` **at run time** (`path: security-scanner`); the directory is genuinely not in the repository |
| 2 | `./ci-actions/.github/actions/setup` | the same shape in nimony's `ci.yml` (`path: ci-actions`, then `uses: ./ci-actions/.github/actions/setup`) |
| 1 | `./integration-release-action` | same shape |
| 1 | `./.github/codeql/queries` | gh-cli's `codeql-config.yml` lists `- uses: ./.github/codeql/queries`; the directory exists but holds `.ql`/`.md` only, and this lane's evidence base is the admitted `.yaml`/`.yml` population |
| 6 | `non-existent.yml`, `does-not-exist.yml`, `doesnt_matter.yml`, `handlers.yml`, `import_tasks.yml`, `testns.testcoll.default_collection_playbook.yml` | ansible's integration tests deliberately include files that are absent (they assert the include FAILS), plus a collection playbook installed at run time |
| 1 | `../../analysis_options.yaml` | riverpod's `packages/hooks_riverpod/test/analysis_options.yaml` resolves to `packages/analysis_options.yaml`, which that repository does not have |

These are **correct refutations of a claim whose truth the project cannot confirm** — a
runtime-materialised path, or a file the corpus deliberately lacks. The rule-shape question is the
Lead's: whether a file-claim miss on a path *outside the project's file space* should read
`externalRefuted` or `externalUnverified`. The gate's own control pins the miss→refute direction
(arms 4 and 5), so it was not changed here.

## 4. `references` — 879 ambiguous + 762 unresolved, split by cause

**Ambiguous (879 edges, 124 targets) — ONE mechanism.** 802 of the 879 edges (90 targets) sit on
GitHub Actions **job references**: `needs: [test]` targets a bare job name, and `test` is declared
once per **workflow file**, so a project has N declarations of it. Production's resolver fills a
bare name only when `COUNT(*) = 1` in that project, so the edge is ambiguous by construction. The
same shape carries the rest: CircleCI job names (`build_server`, `seed-db` — 77 edges), Hasura
`include`, and `default` with 561 declarations. **Reducible only by targeting something unique** —
the lane already computes a document-scoped identity, so the fix is a target change, not fewer
edges.

The 75 ambiguous `imports` are a different cause and are this lane's own over-reach:
`scalarValues` recurses into a mapping, so one `- import_role: {name: role1, tasks_from: x.yml}`
publishes the role's name, its sub-file and any boolean as imports of this file. Measured over the
whole corpus, 891 of the ansible lane's include edges split 567 file-naming keys against 263
non-file scalars (`name:` 149, `tasks_from:` 45, `role_name:` 18, `hosts:`/`public:`/`gather_facts:`
… 51). The ambiguous targets `"a"` (29 declarations), `"c"`, `"foo"`, `"include_role"` are that
over-reach, and it is open.

**Unresolved (762 edges) — ONE mechanism, and its stated reason was FALSE.** All 762 are
`references` with `unresolvedReason=pointer-not-declared-in-file` on the marker set
`confidenceReason+pointer+referencedName+relationshipType+unresolvedReason`, target shape
path-like (`#/definitions/MountType`, `#/definitions/ThrottleDevice`, …).

The pointer **is** declared in the file it is checked against. `docker/api/docs/v1.25.yaml` has
`definitions:` at line 131, `MountType:` at 186 and `$ref: "#/definitions/MountType"` at 214 and
311, and Python's YAML parser reads 51 definitions out of it. What fails is the **pinned grammar**:
a double-quoted scalar whose continuation line is under-indented makes tree-sitter recover, and the
root node of that file is an `ERROR` spanning lines 1–2293. The pointer index is built from the
recovered tree, so it is keyed by paths the document does not have.

Measured over docker's own population (198 `.yaml`/`.yml` files):

| | files | unresolved pointer edges |
|---|---|---|
| tree with an `ERROR` | 15 | **729** |
| clean tree | 183 | **0** |

So 729 of the corpus's 762 (96 %) are one cause: **an unparseable document, not a missing
declaration**. The fix in `resolvePointerReferences` names that cause truthfully
(`parse-error-in-document`) instead of asserting `pointer-not-declared-in-file`; the count does not
move, because the edge really is unresolved — the reason it gives is now true.
Control: [pointer-cause-control.ts](../../validation/m14/fixtures/yaml/pointer-cause-control.ts)
(pins both directions, and asserts through the engine's own parser that the malformed input still
produces an `ERROR`). The remaining 33 are not in docker and are open.

**Resolving those 729 rather than naming them needs the pointer index to survive error recovery**
— a change to how `pointerPath` is built under an `ERROR` node, not a spelling. Left open with the
measurement so it can be picked up deliberately.

