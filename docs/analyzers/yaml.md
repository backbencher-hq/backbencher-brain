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
instrument is a fix measured by one instrument — these are the ROUND 10 numbers, and ROUND 11 rotated
them to 184 / 137 / 253 below:**

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
EDGES` section now reads **NONE**. ROUND 11 then moved the residual once more (185 → **184**, `extQ`
254 → **253**, `extOK` 10,617 → **10,597**) and the committed artifacts were rotated to that run, so
every "current" number in this document is the ROUND 11/12 measurement the ROUND 11 section states.

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

> **SUPERSEDED by ROUND 11.** The enumerator now IMPORTS the gate's `isContainsEdge` predicate instead
> of mirroring the model, so it reads **137** and the four-edge gap is GONE — both instruments read
> 137 ambiguous / 184 residual, and the number a reader can pick correctly is now one. This paragraph
> is kept as the record of the gap and of why documenting it was the wrong fix; its per-type arithmetic
> (131 references) is the pre-Round-11 reading (130 now).

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
| URI schemes — `imports yaml_keyword_include` 88 (`package:`/`dart:`), `references yaml_resource_ref` 5, `references yaml_depends_on` 3 | **96** | a pub URI is not a path, and `urn:k8s:secret:name:key` / `k8s:optional` are not names. `verifyImportClaim` DOES answer `package:` — from the project's DECLARED pubspec packages, which the gate builds for `dart` alone | the pubspec fact set wired for this lane — MEASURED, not assumed (`pubspec-package-price.ts`): of 86 sites, **83 would VERIFY** and **3 would REFUTE**. The old ground for deferring ("`package:lints` IS declared") was WRONG — **0** pubspecs declare `lints`; the refuter is `flutter_lints` (declared in `flutter-packages`) |
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

**HEADLINE, and it is the number this round was asked for: the cross-file resource index converts
1 ambiguous edge (`amb(decl)` 138 → 137, residual 185 → 184). Its FULL reach is 22 edges, not 1** — it
also re-claims 20 references that were passing as VERIFIED EXTERNAL CLAIMS and 1 as unverifiable,
every one a reference to an object the same directory declares. Both numbers are measured on the whole
admitted population below.

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

## ROUND 12 — the re-take after the shared-indexer landings, and the 184 named by the GATE'S OWN table

**WHY A RE-TAKE WAS REQUIRED.** The fleet took six indexer commits — `140be2f01`, `63a888b03`,
`ac2445a27`, `47a45a72c`, `3a701937c`, `71286549c` — and **five of them landed AFTER this lane's
Round 11 artifact** (`44988fcd4`, 23:14 on 10-10; the landings run 23:40 → 10:41 next morning).
`extractLeaf` and key selection CHANGE BINDINGS, so a figure taken before them is not a baseline.

**RE-MEASURED at the current revision, and UNCHANGED.** Three whole-population runs, each labelled:

```
round 11 artifact (pre-landings, 44988fcd4):        TOTAL 1,414,582 · resolved 1,403,548 · ofWhich 4 · amb 137 · unresolved 47 · extOK 10,597 · ext? 253 · extFAIL 0 · bindFAIL 0 · causeFAIL 0
round 12 re-take (post-landings, 2d8d59274):         TOTAL 1,414,582 · resolved 1,403,548 · ofWhich 4 · amb 137 · unresolved 47 · extOK 10,597 · ext? 253 · extFAIL 0 · bindFAIL 0 · causeFAIL 0
round 13 re-take (HEAD bd2335f52, WORKLIST fix):     TOTAL 1,414,582 · resolved 1,403,548 · ofWhich 4 · amb 137 · unresolved 47 · extOK 10,597 · ext? 253 · extFAIL 0 · bindFAIL 0 · causeFAIL 0
```

**The landings did not move this lane** — its targets do not go through the leaf-reduction path the
landings repaired — and the re-take is now a valid baseline rather than a quoted one. The census
(independent instrument) and the falsifier read the same three numbers, so **137 / 47 / 184 is three
instruments agreeing**, not one instrument repeated.

**AND RE-MEASURED A THIRD TIME AT HEAD `bd2335f52`, because a shared instrument changed AFTER the
round-12 run.** `bd2335f52` (13:53) rewrote the gate's NAME WORKLISTS — `incoming-rule.ts` gained a
named `NAME_CAP`, a `keep()` that de-duplicates and counts omissions, and a printed
`amb: showing N of M collected + K omitted` — and the `incoming-gate.ts` that prints them. **It is
printer and list-building only: no count increment was touched** (`keep()` is called AFTER
`ambiguousByDecl++` / `bindingRefuted++`), and it landed after the 12:42 run, so the whole-population
gate was re-run at HEAD. It reads **unchanged to the edge**:
`TOTAL 1,414,582 · resolved 1,403,548 · ofWhich 4 · amb 137 · unresolved 47 · extOK 10,597 · ext? 253 ·
extFAIL 0 · bindFAIL 0 · causeFAIL 0` → `residual 184 of 1,414,582`, every type `CLOSED`
([residual-yaml-whole-corpus-round13.txt](../../validation/m14/fixtures/yaml/residual-yaml-whole-corpus-round13.txt),
also rotated to the canonical `…-after.txt`). **The independent enumerator was re-run at HEAD too and
reads the same to the edge** — `TOTAL 1,414,582 · 1403548 · amb 137 · unresolved 47 · extOK 10,597 ·
ext? 253 · extFAIL 0` with `EXT-Q INVENTORY` **253** and `CLAIMABLE EDGES` **NONE**
([census-yaml-whole-corpus-round13.txt](../../validation/m14/fixtures/yaml/census-yaml-whole-corpus-round13.txt)) —
and the falsifier reads `137 ambiguous`. So at HEAD the gate, the enumerator and the falsifier are
three instruments on one number. The scss lane's finding was real — a capped worklist that did not say
how much it hid — and it simply carries no count.

**THE HEADER THE ROUND-13 RUN ADDS, AND IT MUST TRAVEL WITH THE NUMBER.** The same gate now prints a
POPULATION block: `18364 parsed of 18364 · 0 failed · 0 degraded · files returning NO symbols AND NO
relationships: 201` — of which **60 are 0 bytes** and **141 hold CONTENT and returned nothing**. The
instrument says plainly that it **cannot tell a timed-out parse (`engine.ts:1991`) from content that
cannot declare anything**, and therefore that every count in the table *describes evidence that is
MISSING, not evidence that is wrong*. For yaml the named examples are benign by inspection (ansible
`roles/*/meta/main.yml`, dart `analysis_options.yaml`) but the lane does **not** claim all 141 are: the
residual of 184 is a residual of the population AS PARSED, and the 141 are stated as an open population
item, not folded into the 184.

**THE 184 NAMED BY THE GATE'S OWN MARKER-SET TABLE** (not by an assumption about what they are — this
is `incoming-gate`'s `EDGES A MARKER SET EXPLAINS`, PER PROJECT scope, quoted from this turn's run):

| metadata KEYS on the edge | amb | unres | the cause it names |
|---|---|---|---|
| `isExternal+relationshipType` | **7** | 0 | `imports` role NAMES (`yaml_keyword_include`) |
| `confidenceReason+isExternal+referencedName+relationshipType+unresolvedReason` | **127** | 0 | k8s object references (`yaml_resource_ref`) |
| `isExternal+pointer+referencedName+relationshipType+unresolvedReason` | **3** | 0 | an external-FILE `$ref` whose name collides |
| `confidenceReason+pointer+referencedName+relationshipType+unresolvedReason` | 0 | **47** | json pointers (`yaml_json_pointer`) |
| | **137** | **47** | = **184** |

**EACH CAUSE, WITH ITS COUNT AND ITS FALSIFIER** (the falsifier re-run at this revision reads
`137 ambiguous` — the same number as the gate, see below):

| count | cause | disposition, with the falsifier that justifies it |
|---|---|---|
| **117** | references: `secretName`/`claimName`/`configMap.name: test` in pod-security testdata. The object is declared NOWHERE in the project; the 8 declarations named `test` are unrelated (two CRD fields, two CRD schema properties, an annotation key, a CircleCI job, two Taskfile tasks) | **RULED.** The falsifier: 117 carry `same-kind name only ELSEWHERE`, and the same-directory rule — APPLIED in Round 11 — finds CEILING 0. Binding one would pick an unrelated declaration. |
| **10** | references: `serviceAccountName: default` (7, the cluster's built-in), `secretName: kubeconfig` (2), `secretName: secret` (1) | **RULED.** Falsifier: a kind was asked for and the project declares no object of that kind with that name (0 hits anywhere). |
| **7** | imports: role NAMES — `dnf` (2), `foobar`, `import_role`, `role`, `no_log`, `include_vars` | **RULED as inherent.** Falsifier: no `roles/<name>/` directory exists in the project; a role import names a role, and NOT naming it would drop a true edge. |
| **3** | references: `data` — an external-FILE `$ref` whose name collides with 30 declarations | **RULED.** The claim is about a file outside the corpus; the collision is with unrelated keys. |
| **33** | references unresolved: `pointer-not-declared-in-file` | **RULED.** These files parse CLEANLY and the pointer is genuinely not declared — mostly openapi loader fixtures. |
| **14** | references unresolved: `parse-error-in-document` | **RULED, not reachable.** The grammar emits a bare `flow_node` at line 2288 of docker's specs — no key node exists, so no walk can find a declaration. Reaching it would mean synthesising one from a stray scalar. |

**NO ANALYZER CHANGE THIS TURN, and the reason is not that the classes are small.** Each of the four
is a name that is NOT an identity: the object it means is not declared anywhere the arbiter can see.
There are exactly two ways to move such an edge and both are worse than the ruling: invent a spelling
the arbiter cannot check (which converts a COUNTED defect into an uncounted one — the laundering shape
the binding-separator tripwire exists for), or make the arbiter consult a name claim while declarations
of that name exist (`isExternal` on a bare colliding name), which empties the ambiguity column for
EVERY lane and is a rule-shape decision that is not this lane's. `extQ` — **253, explicitly NOT part
of these 184** — is already a ruled class by fleet ruling, with its own four parts and its own
falsifier (`claimable` 0 of 254 then, 0 of 253 now).

**CLOSURE, quoted from this turn's run** (unchanged by it, because nothing in the analyzer moved):

```
  calls      CLOSED — every edge in one printed bucket (327)
  uses       CLOSED — every edge in one printed bucket (165)
  contains   CLOSED — every edge in one printed bucket (1380046)
  imports    CLOSED — every edge in one printed bucket (8366)
  references CLOSED — every edge in one printed bucket (21417)
  exports    CLOSED — every edge in one printed bucket (4080)
  extends    CLOSED — every edge in one printed bucket (155)
  overrides  CLOSED — every edge in one printed bucket (26)
  TOTAL      CLOSED — every edge in one printed bucket (1414582)
```

**THE THIRD INSTRUMENT WAS STILL CARRYING THE RETIRED `contains` MODEL, and it is fixed here.**
`name-collision-falsifier.ts` called `classifyEdge` WITHOUT the caller's `contains` predicate, so it
read `141 ambiguous` against the gate's 137 — the same four-edge lag the ENUMERATOR had, in the second
instrument. Both now import `isContainsEdge` and pass it, so **all three read 137**. Retiring a caveat
by construction means fixing the PAIR, not the one that happened to be noticed.

### The verdict under the four-clause bar, both readings stated

**Under the bar as restated** — (1) zero UNEXPLAINED edges, (2) ambiguity and unresolved classified by
named cause with measured counts, (3) each cause fixed with a before/after or ruled with evidence, (4)
`extFAIL`/`bindFAIL`/`causeFAIL` zero — **yaml is COMPLETE**: every one of the 184 is in a named class
with a count and a run falsifier, and the three must-be-zero columns are 0 on the whole population.

**Under the stricter reading of clause 1** — every emitted edge resolves to exactly one real
declaration or carries a claim the project VERIFIES — **the lane is 184 edges short (0.013 %)**:
137 ambiguous and 47 unresolved, and a ruled class is not a resolution. The qualifier is the whole
honest answer, and it is the same qualifier every lane that cleared this bar carries.

## ROUND 14 — a local `uses:` re-routed to what the RUNNER materializes: `ext?` 253 → 244, priced before a line changed (2026-10-11)

**THE CLASS THIS ROUND TOOK WAS NOT A RULING BUT A DEFECT.** The RULED CLASS carried 10
`imports yaml_action_use` edges whose target is a `./…` path the repository does not contain — the
largest coherent group left in `ext?`. The lane's own `actionUseClaim` comment had already recorded
WHY the file is not on disk ("two of them checked out at run time by an earlier step (`path:
security-scanner`, `path: ci-actions`)"), and that sentence is the finding: the target is not an
external reference at all, it is a path a PRIOR STEP OF THE SAME JOB creates. §5v — a site making an
unsupportable claim is a FIX, and a fix beats a ruling. And the fix is not a re-marking: the referent
is a NAMED REPOSITORY at a NAMED REF, which `verifyRemoteRefClaim` VERIFIES, so 9 of the 10 move from
a claim no check can reach to a claim the project confirms.

**PRICED FIRST, FROM THE TEXT, WITHOUT THE ANALYZER.** `materialized-action-price.ts` walks the whole
admitted corpus with a line oracle over a `git ls-files` population (1 MiB cap, the gate's own
admission rules) and runs each emitted target through the SHARED arbiter, imported so pricing and
gating cannot drift:

| whole admitted corpus | |
|---|---|
| local `uses: ./…` sites (all shapes) | **523** |
| no prior same-job checkout for the path | 513 |
| MATCHED to a prior same-job checkout | **10** |
| — exact `./D`, checkout NAMES a repository | **8** → 7 verify, 1 refused (waypoint's checkout pins **no `ref:`**, and the shared rule refuses a ref-less remoteRef) |
| — `./D/<rest>` of a checkout of the CALLING repo | **2** (nimony: `./ci-actions/.github/actions/setup` IS the project's `.github/actions/setup`) |
| — subpath of a NAMED repo · `../` target · exact match on the calling repo | **0 each** — stated as refusals, NOT implemented unmeasured |
| PRICE: `ext?` → `extOK` | **9** |
| left unverifiable, honestly | **1** |

**THE RULE.** A checkout WITH `repository: R` puts R's tree at `with.path`; a checkout WITHOUT
`repository:` puts the CALLING repository's tree there. So a local `uses:` target that a prior
same-job checkout materializes is re-claimed — to `R@ref` as a `remoteRef` when the checkout names a
repository, and to the STRIPPED project path as a FILE claim when it is the calling repo's own tree.
The join happens AFTER the walk, from per-step facts (`recordStepWithFacts`), because a step's own keys
do not come in a fixed order: `with:` follows `uses:` in the HashiCorp-style files and PRECEDES it in
others, and key order is not evidence. The refusals are the rule's other half: ONLY EARLIER STEPS (the
runner materializes in step order), ONLY THE SAME JOB (another job is another machine), ONLY
`actions/checkout@…` (an unrelated action carrying the same `with: path:` materializes nothing), ONLY
`./…`, and a MATERIALIZED repository WINS over an in-repo `action.yml` of the same name, because the
checkout REPLACES that directory at run time. `materializedPath` and `materializedAtLine` travel on
the edge, so the re-route is auditable from the edge alone.

**MEASURED, WHOLE POPULATION, BOTH RUNS AT THE SAME WORKING TREE** (HEAD `27062400f`, whose two
commits since the baseline are dart-doc commits that touch nothing here; 18,364 files, 189 repos,
0 failed, 0 degraded; separator tripwire 0; `instrument self-test: PASS`; exit 1 both times — this
lane has never claimed a PASS):

```
before the fix (this revision): TOTAL 1,414,582 · resolved 1,403,548 · ofWhich 4 · amb 137 · unresolved 47 · extOK 10,597 · ext? 253 · extFAIL 0 · bindFAIL 0 · causeFAIL 0

after  the fix:                 TOTAL 1,414,582 · resolved 1,403,548 · ofWhich 4 · amb 137 · unresolved 47 · extOK 10,606 · ext? 244 · extFAIL 0 · bindFAIL 0 · causeFAIL 0
```

**THE Δ IS THE PRICE, EDGE FOR EDGE.** `imports` `extOK` 8,148 → **8,157** and `imports` `ext?`
210 → **201**; `amb` 137, `unresolved` 47 and `extFAIL 0` unchanged; nothing else moves. The
enumerator agrees to the edge — `EXT-Q INVENTORY` **244**, `CLAIMABLE EDGES` NONE
([census-yaml-whole-corpus-round14.txt](../../validation/m14/fixtures/yaml/census-yaml-whole-corpus-round14.txt)) —
and its path-like `yaml_action_use` group shrinks **10 → 3**: the 2
`pypa/gh-action-pypi-publish@release/v1` edges (a shared-rule question, unchanged) plus waypoint's
ref-less repository, which is now NAMED in the edge instead of implied. A repo-scoped draw over the
six affected repositories reads `extOK 919 · ext? 1 · extFAIL 0`, so the one that remains is the one
the rule refused.

**AND THE SHARED INSTRUMENTS WERE RE-MEASURED FIRST.** Four commits landed on
`incoming-gate.ts`/`incoming-rule.ts` since Round 13 (+312 lines: a CONTRADICTED-column scope fix, a
BINDING-INTENT vocabulary fix, the `amb(decl)` claim-carrying share, and an `--index` header
correction). The whole-population walk was re-run BEFORE the analyzer was touched and reads
**identical to the edge** — `amb 137 · unresolved 47 · extOK 10,597 · ext? 253 · extFAIL 0` — so the Δ
above belongs to this lane, not to the shared wave. The population caveat travels unchanged: 60 files
hold no content and **141 hold content and returned nothing**, which this instrument cannot distinguish
from a timed-out parse; the 244 is a figure of the population AS PARSED, with the 141 stated as an open
item, not folded in.

**EVIDENCE THE FIX CAN FAIL.** Bilateral, on the production path (`pool-worker.parseFile`, project
root passed):

| instrument | result |
|---|---|
| `materialized-action-control.ts` — 10 crafted arms × 3 assertions | **CONTROL PASS, 0 failures** |
| — the re-route: earlier same-job checkout NAMING a repo | re-routes to `hashicorp/security-scanner@main`, `remoteRef` + `materializedPath` + `materializedAtLine`; the literal target is GONE |
| — refusals: no checkout · ANOTHER job · a LATER checkout · a DIFFERENT path · a NON-checkout action | the literal target STAYS and no repo target is invented (5 arms × 3) |
| — key order: `with:` before `uses:` | STILL re-routes |
| — the calling-repo family: manifest on disk / absent | file claim `.github/actions/setup/action.yml` / STAYS external, no fabricated claim |
| — precedence and its falsifier | materialized `acme/ci-actions@v2` wins; WITHOUT the checkout the same file claims the in-repo `ci-actions/action.yml` again |
| `yaml/materialized-action` fixture (authored before the run) | **PASS** — 3 expect rows, 3 forbid rows incl. the cross-job and later-checkout refusals |
| `script/m60/yaml-mutants.ts` → `yaml/materialized-action-reverted` | **CAUGHT** (0 → 1 failure, by the new fixture) |
| fixture battery | **34 pass / 0 fail** |
| yaml mutant set | **25/25 caught, 0 survived** |
| `tsc --noEmit` | clean |

**THREE INSTRUMENTS, ONE NEW NUMBER.** The four-clause gate (`residual-gate.ts --lane yaml`) re-run at
this revision reads `TOTAL 1,414,582 · resolved 1,403,548 (99.2 %) · ofWhich 4 · amb(decl) 137 ·
unresolved 47 · extOK 10,606 · ext? 244 · residual 184 · extFAIL 0 · bindFAIL 0 · causeFAIL 0` · every
type `CLOSED` · `RESIDUAL_EXIT=0`, so the clause-1 residual is **unchanged at 184** while clause 2's
ext? figure moves with the gate — the same 244 / 10,606 the `incoming-gate` verdict reads, from an
independently written classifier, with the enumerator agreeing to the edge.

**WHAT THIS DOES NOT CLAIM.** That the re-routed ref resolves, that the repository is public, or that
the two shapes the rule REFUSES (a subpath of a named repository, and an exact match against a
checkout of the calling repository — 0 corpus sites each) would be re-claimed rather than left
unverifiable. `ext?` is **244**, not 0, and the completion package below is still clause-1-short by
184. **And the fleet board's incoming columns are NOT regenerated here** — `--board-log` overwrites
the WHOLE shared log, so a board row is merged deliberately rather than as a side effect of this
round — which means the board still shows yaml at the ROUND-13 figures until that merge is made.

## ROUND 15 — `$` read as a GitHub OWNER (18 edges re-claimed to files the project carries), and the completion package's LAST open item: the STORE-side split (2026-10-11)

### A. `$/.github/actions/…` is a ROOT-ANCHORED path, not an external action

**THE DEFECT.** A step-level `uses:` value that is not `docker://` and does not begin `./` or `../`
falls to `actionUseClaim`'s last line, `return { remoteRef: true }` — a claim that `$/…` names a
GitHub OWNER `$` and a repository `.github`. `$` is not an owner, and the target is not an action
reference at all: it is a path in the checked-out tree. So the edge asserted an external remote
action that does not exist, was read as `externalUnverified`, and sat in `ext?` as the largest
single coherent group left (**18 edges**).

**WHY IT IS A FIX AND NOT A RULING, on the corpus rather than in prose.** Over the whole admitted
population a `$/` spelling occurs in exactly **18** `uses:` sites and nowhere else (15 ×
`$/.github/actions/go-cache-restore`, 3 × `…/go-cache-save`, all terragrunt), and
`terragrunt/.github/actions/go-cache-restore/action.yml` and `…/go-cache-save/action.yml` are FILES
THE PROJECT CARRIES — composite actions whose names are exactly the last segment of the `uses:`
value. No `$/.github` directory exists anywhere in that tree. `$/` is how that one repository writes
what every other repository writes as `./`.

**THE RULE, and it is deliberately unconditional.** A leading `$/` is rewritten to `./` at the point
the `uses:` site is captured, so EVERY downstream consumer agrees on one spelling: the emitted
target, the claim, the `addImport` external flag, and the materialization check. The written text
travels in `metadata.actionSpelling`, so the substitution is auditable from the edge alone (the rule
the Round-14 materialized re-route follows). Because the rewrite is unconditional it can only ever
CONVERT an unsupportable remote claim into a local one: a `$/…` action with no manifest in the
project lands in the same local branch and falls back to the pre-existing `isExternal: true`, which
is the weaker marker `./…` already had. It does not read `$` as a GitHub expression, does not touch a
target that merely CONTAINS `$/`, and applies to no other key.

**MEASURED, whole admitted population, same working tree before and after:** the 18 edges move from
`ext?` to `extOK` — `extOK 10,606 → 10,624`, `ext? 244 → 226`, with `amb(decl) 137`, `unresolved 47`,
`extFAIL 0` and the clause-1 residual **unchanged at 184**. The instrument of record is the
enumerator, which imports the SHARED arbiter (`incoming-rule.ts`) rather than re-implementing it, run
whole-population at this revision:
[census-yaml-whole-corpus-round15.txt](../../validation/m14/fixtures/yaml/census-yaml-whole-corpus-round15.txt)
— `imports` `extOK` **8,157 → 8,175**, `imports` `ext?` **201 → 183**, every other row byte-identical,
`TOTAL 1,414,582 / resolved 1,403,548 / amb 137 / unresolved 47 / extOK 10,624 / ext? 226 / extFAIL 0`.
The `incoming-gate` verdict is the same population read through the verdict machinery; that run is
recorded to `incoming-gate-yaml-whole-corpus-round15.txt` when it lands, and until it does the two
reads above are the ones this round cites. The repo-scoped draw over the affected repository is an
independent third read and it PASSES (`--repo=terragrunt`: 3,119 edges, `160 verified + 0 unverifiable
external`, `ext?` 0) — the same repository whose whole `ext?` population this round removed.

**FALSIFIABLE BOTH WAYS.** A 25-assertion control (`root-anchored-action-control.ts`, exit 0) pins
nine arms: the rewrite with `action.yml` on disk **and** the other admitted manifest spelling
(`action.yaml`); the refusal when no manifest exists (still `isExternal`, no fabricated claim and no
invented remote ref); a non-workflow file keeping `yaml_action_use_unverified`; a job-level `$/`
staying a `calls` edge with the same-repository reason; and — the boundary — an ordinary external
action (`actions/checkout@v4`) keeping `remoteRef` with NO spelling recorded, a target that only
CONTAINS `$/` left untouched, and a `../` action untouched. The falsifier direction is arm 9: the
re-routed edge and a real remote action disagree on BOTH keys (`remoteRef` absent + `actionSpelling`
present vs the reverse). Fixture `yaml/root-anchored-action` asserts the rewritten target and
`meta.isExternal: false`, and FORBIDS both raw `$/.github/…` targets. Mutant
`yaml/root-anchored-action-reverted` — which restores the raw spelling and the `remoteRef` claim — is
**CAUGHT** by it.

### B. The completion package's clause-4 open item: the STORE-side split, measured

The package has said since Round 13 that clause 4 is met at the **model** level and that the
**store-side** split was NOT done for yaml. It is done now, by `store-intent-split.mts`, which builds
a real store per repository through the production indexer (`indexProjectParallel`), reads the
binding off `brain_relationship.target_symbol_id`, and cross-checks the same drawn files through
`pool-worker`:

| store-side intent, boundary + consul, ONE run each | |
|---|---|
| `contains` store rows | **13,162** |
| bound · intended (own file, edge's own line) | **13,160** |
| `sameFileOffLine` · `arbitraryTwin` · `unbound` | **0 · 0 · 2** |
| collision rows (≥ 2 declarations answer) | **0** |
| `imports` / `references` / `calls` rows | **395 / 247 / 40** |

The determinism clause therefore holds store-side too: **no** bound `contains` row reaches another
file, and no row had more than one declaration to choose between. The two `unbound` rows and the 395
unbound `imports` rows are the cross-file shapes (an external import has no target symbol by
construction), not mis-bindings.

**AND THE STORE ITSELF IS NOT FAITHFUL — two findings, both counted, both reported-not-fixed.** With
BOTH sides restricted to the same **discovery-admitted** population (105 files):

| | model | store |
|---|---|---|
| `contains` — rows | 8,188 | **13,162** |
| `contains` — DISTINCT (source, target) pairs | 8,031 | **7,964** |
| duplicates (rows − distinct pairs) | **157** | **5,198** |

* **The store writes each logical edge about 1.65×** — 5,198 duplicate rows on 7,964 distinct pairs.
  Measured per file as well, on 2 of 2 repositories: boundary's `.github/workflows/build.yml` holds
  **637 rows over 381 distinct pairs**, `consul/.github/workflows/go-tests.yml` **725 over 392**. The
  duplicated rows are the same `(source_symbol_id, target_symbol_id)` pair stored under TWO row ids
  with the same `time_created` millisecond, one naming the node by its LEAF and one by its qualified
  path. This is NOT a yaml-analyzer property: the model emits 381 edges with 381 DISTINCT targets for
  those 381 pairs, no leaf-shaped target anywhere, and no two edges sharing a `(source, line)` — all
  three measured on `config.yml`, `dependabot.yml` and `build.yml`.

  **AND THE CAUSE IS NOW PROVEN, with the indexer's own regexes.** The indexer synthesizes a
  containment edge for every symbol that has an owner (`parallel-indexer.ts`, the
  `bufferedContains` block) and skips it when a pre-built `containsPairs` set says the analyzer
  already emitted that pair. That set is keyed `${srcLeaf} ${tgtLeaf}` with
  `leaf = s.replace(/^.*:([^:]+):?\d*$/, "$1")` — a COLON-based reduction, written for the
  `:<line>`-suffixed names xml's lane measured. A yaml `contains` target is a DOTTED QUALIFIED PATH
  with no colon (`.golangci.linters`), so the regex does not match and the child half of the key
  stays the FULL PATH, while the lookup half is `symbol.name` — the LEAF. Measured on a real pair
  from the store this round produced: build-site key `".golangci .golangci.linters"` against lookup
  key `".golangci linters"` — `keys agree? false`, so for this lane the guard can NEVER fire and every
  candidate is written. Yield priced on the store: boundary holds **1,218 duplicated pairs and exactly
  1,218 rows beyond the first** (3,271 rows / 2,053 distinct pairs), and the 105-file draw holds
  **5,198 of 13,162 rows** — so fixing the key would put the store at the analyzer's own edge count
  for this lane. NOT FIXED HERE: the guard is SHARED indexer code with a fleet-wide blast radius, the
  prior repair in the same three lines was landed by another lane with its own 300-file probe, and a
  change to it needs a store-scale re-measure this round cannot run. It is reported with the two
  keys, the reproduction and the yield so the owner can land it the way xml's repair was landed
  (child-only, owner reduction untouched).
* **The store loses 67 distinct pairs** (7,964 against the model's 8,031 — 0.83 %), which is the
  pre-existing re-store loss this lane has reported since Round 9 and not a yaml finding.

The arithmetic closes exactly: model 8,188 − model duplicates 157 = 8,031 pairs; 8,031 − store 7,964
= **67 lost**; store 13,162 + nothing = 7,964 + **5,198 duplicated**.

**A PHANTOM THIS ROUND'S OWN FIRST RUN PRODUCED, kept because the correction is the finding.** The
first run drew every tracked `.yaml`/`.yml` under the cap and reported **store 13,162 against model
24,126** — a `-10,964 STORE LOSS`. It was entirely the instrument's population: production's own
discovery refuses its built-in `skipPatterns` (lockfiles, `.generated.`, `generated/`, `deps/`,
`build/`, …), so `ui/pnpm-lock.yaml` read **model 15,785 · store 0** because the indexer never wrote a
`brain_file` row for it at all. The instrument now applies the SAME admission, REPORTS the files it
refuses instead of dropping them silently, and prints model and store distinct pairs side by side so
a loss and a duplicate cannot be confused again.

### C. The lane's population is a SUPERSET of the product's — 53 files, 101,658 `contains` edges

B fell out of a larger fact, and it is stated as an OPEN ITEM rather than folded in. Production's
discovery refuses its built-in `skipPatterns`; the gate's and this lane's admission (`git ls-files` +
extension + 1 MiB cap) does not. Over the whole corpus the difference is **53 of 18,364 admitted
files (0.29 %)**, but they carry **101,658 `contains` edges — 7.4 % of the lane's 1,380,046** — plus
199 `references`, 28 `imports` and 4 `overrides`. Essentially all of it is lockfiles:

| file | edges |
|---|---|
| `vault/ui/pnpm-lock.yaml` | 17,151 |
| `consul/ui/pnpm-lock.yaml` | 15,785 |
| `nomad/pnpm-lock.yaml` | 15,292 |
| `gql-graphql-eslint/pnpm-lock.yaml` | 14,974 |
| `element-plus/pnpm-lock.yaml` | 13,470 |
| `shadcn-svelte/pnpm-lock.yaml` | 9,993 |
| `vue-core/pnpm-lock.yaml` · `svelte/pnpm-lock.yaml` | 5,610 · 4,424 |
| `hasura-engine/…/generated/HasuraMetadataV{3,2}.yaml` | 1,945 · 1,364 |
| 13 × `buf.gen.yaml` and other `*.gen.*` / `generated/` files | remainder |

So the lane's headline figures describe a population **0.29 % larger in files and ~7.4 % larger in
`contains` edges than the graph the product can actually build**. The direction this lane LEANED
TOWARD was to align to production's admission and re-measure. **It ran the aligned measurement, and
the measurement changed the recommendation — this is the round's most load-bearing result.**
`lane-residual-census.ts` now takes `BB_CENSUS_PRODUCTION_ADMISSION=1`, and the aligned run of the
same instrument reads:

| | the gate's admission | PRODUCTION's admission |
|---|---|---|
| files · repos | 18,364 · 189 | **18,311 · 188** |
| `TOTAL` edges | 1,414,582 | **1,312,693** (the refused 53 files carry 101,889) |
| `resolved` | 1,403,548 | **1,301,689** |
| `amb(decl)` · `unresolved` | 137 · 47 | **137 · 47** (unchanged) |
| `extOK` | 10,624 | **10,592** (−32 = exactly the 28 `imports` + 4 `overrides` in refused files) |
| `ext?` | 226 | **225** |
| `extFAIL` | **0** | **3** |

**ALIGNING WOULD FABRICATE THREE REFUTATIONS, and the three are TRUE CLAIMS.** The refuted inventory
is one target in one repository:

```
   3  imports  "./.github/actions/build/ci"  claim=projectFile  files=3
      candidates: .github/actions/build/ci/action.yml
      e.g. .github/workflows/linux-ci.yml , .github/workflows/macos-ci.yml
```

`powershell/.github/actions/build/ci/action.yml` EXISTS, is TRACKED, and is a hand-written composite
action (`name: CI Build` / `description: 'Builds PowerShell'`, 3 workflows call it by
`uses: ./.github/actions/build/ci`). Production refuses it because its built-in skip list contains
`/\/build\//`, and the directory is literally named `build` — a false positive of the same class as
`redis/deps/jemalloc/.travis.yml` (refused by `/\/deps\//`, also a real tracked file) and
`.codecov.yml` under `/\/coverage\//`. So production's admitted list does NOT contain a file the
project demonstrably carries, and the arbiter's rule for a FILE claim is **a miss REFUTES** — which
makes `extFAIL` a function of the ignore list rather than of the analyzer.

**THEREFORE THE RECOMMENDATION IS REVERSED, and the prerequisite is named:** do NOT align this lane's
population until production's ignore rule stops refusing tracked hand-written files inside
`.github/actions/` (the `build`/`deps`/`coverage`-named-segment class), because alignment would move
three claims this analyzer can PROVE from `extOK` to `extFAIL` and a lane cannot buy a cleaner
denominator by manufacturing a refutation. Both columns are recorded here so the decision can be made
with both in hand, and neither is presented as the lane's verdict.

**A THIRD finding fell out of the same run, and it is the one that matters for the product:** whatever
admission is chosen, `powershell/.github/actions/build/ci/action.yml` is a real action the product
never indexes, so the graph is missing a node that three workflows depend on. That is an IGNORE-RULE
defect (fleet-wide, one line), not a yaml one, and it is reported here because this lane is what
measured it.

### D. The remaining `ext?` rows, adjudicated with their evidence and left priced

A and the earlier rounds took the classes that were FIXES. What is left is the RULED class, and each
row below was walked to its emitting site rather than counted:

| row | edges | adjudication |
|---|---|---|
| `imports yaml_keyword_include` `package:`/`dart:` includes | 88 | a Dart PUBC spec resolved by pub, never a path here. PRICED: `pubspec-package-price.ts` measures 83 that WOULD verify against the corpus's own pubspecs and 3 that would REFUTE (`package:flutter_lints/flutter.yaml` in the repo that DECLARES `flutter_lints`). NOT wired: the refutations are TRUE, and a per-file analyzer has no pub-resolution channel to turn an include into an in-repo file claim. The old deferral reason ("`package:lints` IS declared") was measured FALSE — 0 pubspecs declare `lints`. |
| `imports yaml_keyword_include` `{{ … }}` templates · `references yaml_depends_on` / `yaml_resource_ref` templates | 71 + 17 + 13 | a Jinja/Ansible variable: the value is not a literal path until run time, so no single parse can name it. Retained as an honest unknown; refuting them would falsify a claim that is not false. |
| `references yaml_depends_on` `k8s:optional` | 3 | the KEY is literally `dependsOn`, so the position rule does not fire — but the VALUES are `kube-api-linter` MARKER NAMES (`dependenttags.rules[].dependsOn`, beside `identifier: "k8s:unionMember"`), not members of any document. A candidate guard ("an ancestor segment names a marker-rule container") is named and NOT implemented: 3 edges does not buy an unmeasured vocabulary rule, and the class is stated so the next round can price it the way Round 7 priced the `include:` selector positions (12 false edges in one Azure file before that rule existed). |
| `imports yaml_action_use` `pypa/gh-action-pypi-publish@release/v1` | 3 | a REAL branch ref REFUSED by the SHARED rule: `verifyRemoteRefClaim` rejects a ref containing `/`. A LEAD for the fleet rule, not this lane's file — a per-file analyzer cannot widen the arbiter's grammar. |
| `references declared_type` `python/name:…` (mkdocs config) | 3 | a MkDocs extension entry point: a foreign-language import path declared in yaml. The value IS a path-like spelling and its referent is a Python module, not a yaml document. |
| `references yaml_resource_ref` `urn:k8s:…` · `imports`/`references` path-like singles | 9 | URI-scheme owners and the two CodeQL rows (`./.github/codeql/queries`, the suite name `security-and-quality`), each read at its emitting site. |

**THE 14 `parse-error-in-document` EDGES, measured end to end (and the package's stated reason is NOT
refuted by it).** They are docker's `api/docs/v1.2{5..9}`/`v1.30.yaml` and their
`#/definitions/EndpointSpec`. What a parse of `v1.25.yaml` shows, in the analyzer's own output rather
than by inspection: the file yields 1,991 symbols and 3 error nodes; the recovery fallback DOES
rescue the sibling case in the SAME file — `#/definitions/MountType` resolves, because the flattened
`definitions:` hoisted it to `api.docs.v1.25.MountType` — while the `EndpointSpec` DEFINITION at line
2288 is absent from the symbol table: the only published paths mentioning the name are the deeper
property `api.docs.v1.25.ServiceSpec.properties.EndpointSpec` and its `.$ref`, and the recovery rule
matches a declared path only when the decoded pointer (`definitions.EndpointSpec`) ENDS WITH that
path, which a `ServiceSpec.properties.…` key does not — so the fallback correctly refuses. The
package's own reason for the miss ("a bare `flow_node` at line 2288, so no pair has `EndpointSpec` as
its key") predicts exactly this surface, and this probe cannot separate it from a walk that drops that
one pair: both would leave the definition unindexed while the earlier `MountType` survives. **So the
class stays RULED, and the new information is the shape of the miss — the definition's symbol is
absent while an earlier depth-2 sibling of the same flattened container IS published and resolves —
not a claim that the stated cause is wrong.** Reaching it would mean synthesising a declaration from
a stray scalar, which is fabrication; 14 edges of 1,414,582 do not buy a change to error recovery in a
round that cannot re-test the other docker spec files.

**WHAT THIS ROUND DOES NOT CLAIM.** Not that `ext?` is 0 (**226** after A). Not that the store's
5,198 duplicate rows or 67 lost pairs are fixed (they are reported; the fix is in shared indexing,
not in this analyzer). Not that the 101,658 edges of C should be dropped from the lane — C states a
scope difference with its measurement and leaves the decision open. And not that the fleet board is
up to date: `--board-log` overwrites the WHOLE shared log, so a board row is merged deliberately,
never as a side effect of a round. **Nothing here is a PASS.**

## ROUND 16 — PRODUCTION ADMISSION: the gate admits 53 files the INDEXER ITSELF SKIPS, and the same claim is VERIFIED by one walk and REFUTED by the other

**THE FLEET QUESTION.** Every lane's verdict is computed by a gate that admits a file by EXTENSION over
the git-tracked population, while `parallel-indexer` drops a file whose path matches its own
`skipPatterns` before it is ever parsed. If those sets differ, every lane's residual is measured over
files PRODUCTION NEVER SEES. Measured here rather than worried about.

**THE 53, NAMED** (`production-admission-diff.ts`, which IMPORTS `ParallelIndexerConfig.skipPatterns`
rather than re-spelling it — the rule is the indexer's):

| count | pattern |
|---|---|
| 15 | `/.*\.(generated\|Generated\|gen\|Gen)\./i` |
| 10 | `/pnpm-lock\.yaml$/` |
| 9 | `/\/deps\//` |
| 7 | `/\/build\//` |
| 6 | `/\/generated\//i` |
| 2 | `/\/\.env/` · 2 `/\/tree-sitter-clean\//` · 1 `/\/coverage\//` · 1 `/\/platforms\//` |

by repository: redis 9 · consul 6 · hasura-engine 5 · Grace 4 · … The 53 are the whole difference
between the gate's **18,364** admitted files and production's **18,311**.

**WHAT THEY CONTRIBUTE — the edge counts, NOT the residual:**

| type | gate population (18,364) | production population (18,311) | Δ |
|---|---|---|---|
| `contains` | 1,380,046 | 1,278,388 | **−101,658** |
| `references` | 21,417 | 21,218 | −199 |
| `imports` | 8,366 | 8,338 | −28 |
| `overrides` | 26 | 22 | −4 |
| **TOTAL** | **1,414,582** | **1,312,693** | **−101,889 (−7.2 %)** |
| **amb(decl)** | **137** | **137** | **0** |
| **unresolved** | **47** | **47** | **0** |

**ZERO OF THE 184 COMES FROM THE 53, AND THAT IS PROVABLE RATHER THAN SAMPLED:** production's
population is a strict SUBSET of the gate's, and the two runs report the SAME ambiguity and the SAME
unresolved count — which can only happen if no excluded edge is in either class. **yaml's residual is
population-invariant.** (99.7 % of the edge difference is `contains` from ten `pnpm-lock.yaml` files.)

**BUT ONE COLUMN INVERTS, AND THIS IS THE PART THAT TRAVELS: `imports` extFAIL 0 → 3.** Named, not
counted: `3 imports "./.github/actions/build/ci" claim=projectFile`, from
`.github/workflows/linux-ci.yml` and `macos-ci.yml`, candidate `.github/actions/build/ci/action.yml`.
**That file EXISTS on disk (1,274 B) — and the indexer's own `/\/build\//` pattern refuses it.** So
the analyzer's `projectCarriesFile` claim is TRUE, the gate's walk admits the file and VERIFIES it
(extFAIL 0), and production's walk cannot see it and REFUTES it (extFAIL 3). **The same claim, the same
revision, two admissions, opposite verdicts.**

**WHICH POPULATION IS THE RIGHT ONE, stated rather than implied.** They answer different questions and
both are legitimate: the gate's population is what the ANALYZER is contracted over (extension over
tracked files — the analyzer is per-file and emits for every file it is handed), while production's is
what the STORE holds. A lane's verdict is therefore **about the analyzer over the gate's population**,
and any claim whose truth rests on a file the indexer skips has a population-dependent verdict. The
count is printed here so no reader has to discover it: **the qualifier is about edge counts and about
file-backed claims, NOT about any lane's residual** — on this lane's 184 it changes nothing.

## ROUND 17 — IS THE 1,414,582 A DEGRADED WALK? The route was ONE long sequential walk, and the SHARDED route reproduces it to 3 edges in 1.4 million

**THE FLEET FINDING THIS ANSWERS** (markdown, 17,460 files): from ~file 9,000 onward every file was
answered by `extractFallback()` at ~0.3 edges/file where the analyzer yields 16–36 — **a 2.23×
under-count** — while the run's own `degraded` line read **2**. yaml's population is **18,364 files,
larger than the corpus where the collapse was demonstrated.**

**1. WHICH ROUTE — one long walk, and the code says so.** `incoming-gate.ts` parses inside
`for (const f of files)` with `await parseFile(f, repoOf(f), { projectIndex, projectRoot })`
(`:794-795`) and defers only the CLASSIFICATION to a second pass. **So the 1,414,582 is ONE sequential
walk of 18,364 files in one process.** The lane's own instruments (the enumerator, the disclosure
census, `production-admission-diff.ts`) walk the same way.

**2. RE-MEASURED ON THE SHARDED ROUTE** — `index % 8`, so the longest walk is **2,296 files**, well
under the observed collapse depth. An edge belongs to the file that emitted it, so partitioning files
partitions edges exactly and the shard sum is comparable:

| type | 8 shards (max depth 2,296) | one long walk (18,364) | Δ |
|---|---|---|---|
| `contains` | 1,380,046 | 1,380,046 | **0** |
| `references` | 21,414 | 21,417 | −3 |
| `imports` | 8,366 | 8,366 | **0** |
| `exports` | 4,080 | 4,080 | **0** |
| `calls` | 327 | 327 | **0** |
| `uses` | 165 | 165 | **0** |
| `extends` | 155 | 155 | **0** |
| `overrides` | 26 | 26 | **0** |
| **TOTAL** | **1,414,579** | **1,414,582** | **−3 (0.0002 %)** |

**NO DEPTH DEGRADATION ON THIS LANE.** A collapse past 9,000 files would have made the shard sum
*larger* — markdown's sharded route was 2.23× its long walk — and here the difference is **three
edges**, in the *other* direction, confined to one type. The explanation is the instrument's own call
shape: the gate passes a built `ProjectIndex` (`{ projectIndex: idx, projectRoot }`) and the shard walk
passes only `{ projectRoot }`, so three cross-file `references` do not appear. **A missing index
explains a 3-edge deficit; depth collapse cannot explain a 3-edge deficit in the direction of MORE
edges, and every other type — including the 1.38 M `contains` — matches to the digit.**

**3. THE `degraded` LINE, CHECKED AGAINST THE FALLBACK REALITY.** All 8 shards report
**`fallback:true 0 · analysisVersion 2.0-basic-fallback 0`** — the gate counts BOTH signatures
(`incoming-gate.ts:832`), and this lane's runs say `degraded 0`. **And that zero is a READING, not
silence: a CONTROL drives the fallback path deliberately** (a 1.8 MB document, answered structurally by
`pool-worker`'s `FULL_AST_LIMIT`) and the gate's own predicate **FIRES** on the result
(`fallback: true`, 0 symbols, 0 relationships). A counter that cannot fire would make `degraded 0`
worthless; this one can. `degraded-control.txt`.

**WHAT THIS DOES AND DOES NOT SETTLE, stated the way the ~56 are stated.** SETTLED: the edge total and
every type count are not depth-degraded, so the 184's denominator is sound and the class sizes stand.
NOT SETTLED BY THIS: whether the ~56 real-content files that returned nothing are a legitimate
empty-declaration class or a recovery hole — but this narrows it, because a fallback result carries
ZERO symbols and ZERO relationships, the counter can fire, and it reports 0 on this population, so
**those 56 are the analyzer reading real content and finding nothing to declare, not files that fell
through.**

## ROUND 18 — the marker-name guard: the row ROUND 15 named "NOT implemented" is now priced and LANDED, `ext?` 226 → 223 (2026-10-11)

**THE ROW, AND WHY IT MOVED.** ROUND 15's adjudication table (§D above) left one `ext?` row with
its price unstated: `references yaml_depends_on` → `k8s:optional` ×3, where kube-api-linter's config
spells a rule-to-marker requirement `dependenttags.rules[].dependsOn: ["k8s:optional"]` and the value
is a kubebuilder MARKER (a Go-comment annotation `+k8s:optional`) — not a key any analyzer publishes
in any lane, so the `references` edge it produced was structurally unverifiable. The row said "a
candidate guard is named and NOT implemented: 3 edges does not buy an unmeasured vocabulary rule" —
and this round is the measurement that rule was waiting for, taken the way Round 7 priced the
`include:` selector positions: **every target of the kind, counted untruncated over the whole
admitted population, before a line changed.**

**THE PRICE** (`.tmp-probe/yaml-depends-position-r16.txt`, which walks the same 413 candidate files
the Round-8 position census did and counts the colon shape over ALL 1,895 `yaml_depends_on` targets,
not the top-8 slice each position prints):

| shape | targets | sites |
|---|---|---|
| no colon | **1,892** | every loader's true dependency — job ids, service names, stage names, CircleCI job names |
| colon + template (`${{ … }}`) | 0 | (the template values in this population carry no colon; the `{{` test still guards the class) |
| colon, NO template | **3** | `k8s:optional` ×3 — all three under `dependenttags.rules[]`, in kubernetes' `hack/golangci{,-hints}.yaml` and `hack/kube-api-linter/kube-api-linter.yaml` |

Zero collateral is the finding that makes the guard a FIX rather than a trade: the rule fires on
exactly the measured class and nothing else in the population. And it is VOCABULARY-FREE — no list of
marker namespaces, which is what made the unnamed-before candidate ("an ancestor segment names a
marker-rule container") unpriceable at 3 edges. The shape is loader-independent on its own terms: a
colon is legal in no member name any of the four `DEPENDS_ON_KEYS` loaders admits, and every template
spelling that could carry one contains `{{` and is excluded, so a `${{ parameters.dependsOn }}` edge
stays a RULED external claim, unchanged (17 of them, still in `ext?`). The lookup-first variant
(refuse only when the name is ALSO undeclared in the file) was measured equivalent — `k8s:optional`
occurs as a KEY declaration in 0 of the 3 emitting files — and shape-first is chosen because it fires
at capture with no dependence on walk order. The whole rule, with this measurement, is the doc
comment on `RealYamlAnalyzer.markerNamespaceTarget`.

**WHAT MOVED, whole admitted population, one instrument (`census-yaml-whole-corpus-round18.txt`):**

| column | ROUND 15 | ROUND 18 | Δ |
|---|---|---|---|
| `TOTAL` | 1,414,582 | **1,414,579** | −3 (the marker edges) |
| `references` | 21,417 | **21,414** | −3 |
| `references` ext? | 43 | **40** | −3 |
| `ext?` (all) | 226 | **223** | −3 |
| `extOK` | 10,624 | 10,624 | 0 |
| `amb(decl)` · `unresolved` · residual | 137 · 47 · 184 | 137 · 47 · **184** | 0 — the class was never in the residual |
| `extFAIL` | 0 | **0** | 0 |

The `EXT-Q INVENTORY` no longer contains a `yaml_depends_on` uri-scheme row at all; the remaining
uri-scheme rows are the 88 pubspec includes and the 5 `urn:k8s:` resource refs, both still RULED.

**THE FOUR-CLAUSE INSTRUMENT CONFIRMS, AT THE SAME REVISION** (`residual-yaml-whole-corpus-round18.txt`,
also rotated into `residual-yaml-whole-corpus-after.txt`):
`TOTAL 1,414,579 · resolved 1,403,548 (99.2 %) · ofWhich 4 · amb(decl) 137 · unresolved 47 · extOK
10,624 · ext? 223 · residual 184 · extFAIL 0 · bindFAIL 0 · causeFAIL 0`, `RESIDUAL_EXIT=0` —
every column identical to the enumerator above, and the residual unchanged at 184 because the marker
class was never in it.

**AND THE ROUND 17 SECTION ABOVE (the route verification) GETS ITS `−3` ATTRIBUTION CORRECTED —
the route conclusion is untouched.** That section attributes its sharded-vs-walk `references` `−3`
to the instrument call shape ("three cross-file references do not appear" without a built
`ProjectIndex`). This round's numbers refute that attribution and replace it with a measured one:

| call shape | pre-guard (round 14/15 artifacts) | post-guard (ROUND 18) |
|---|---|---|
| census, `{ projectRoot }` only — NO `ProjectIndex` | **21,417** | **21,414** |
| `incoming-gate`, built `ProjectIndex` passed | **21,417** | (re-run in flight) |
| shard walk (`index % 8`), `{ projectRoot }` only | — | **21,414** |

The index shape moves ZERO edges — 21,417 = 21,417 at the same revision on both call shapes — so the
entire `−3` is THIS round's guard, not a missing index; the census's own pre/post pair on one call
shape isolates it exactly. The practical result is the one ROUND 17 was seeking: at this revision all
completed routes read **21,414 / 1,414,579 to the digit**, and ROUND 17's depth-degradation finding
(the sharded sum reproduces the walk on every other type, `contains` 1,380,046 identical) stands
unchanged — only its causal story for the three edges is replaced, per §7 criterion 5.

**THE SHARDED ROUTE AND THE ONE LONG WALK AGREE PER TYPE AT THIS REVISION — NOT JUST IN TOTAL**
(Round 17's rule: a total can hide a compensating pair). 8 shards at `index % 8` (longest walk 2,296
files, every shard `fallback:true 0 · 2.0-basic-fallback 0`) against the whole-population walk of
18,364 files, both at `96874286d`:

| type | 8 shards (max depth 2,296) | one long walk (18,364) | Δ |
|---|---|---|---|
| `contains` | 1,380,046 | 1,380,046 | **0** |
| `references` | 21,414 | 21,414 | **0** |
| `imports` | 8,366 | 8,366 | **0** |
| `exports` | 4,080 | 4,080 | **0** |
| `calls` | 327 | 327 | **0** |
| `uses` | 165 | 165 | **0** |
| `extends` | 155 | 155 | **0** |
| `overrides` | 26 | 26 | **0** |
| **TOTAL** | **1,414,579** | **1,414,579** | **0** |

**Every column zero, including the two the total could have hidden** — so at this revision there is no
shard-vs-walk difference at all, and the earlier `−3` is fully accounted for by the guard.

**EVIDENCE, the four things this lane ships with every rule:** fixture `yaml/dependency-marker-name`
(forbids the `k8s:optional` edge; pins the template / compose / workflow-`needs` boundary) PASSES and
the suite reads **36 pass / 0 fail**; `dependency-marker-name-control.ts` runs the THREE REAL CORPUS
FILES plus five crafted arms through the production path — 20 assertions, exit 0, including the
falsifier direction (the predicate refuses `k8s:optional`, does NOT refuse the template spelling or
a bare name) and the symbol-still-published arm (the guard drops the edge, not the declaration);
**28/28 yaml mutants caught**, both new ones by the new fixture — `yaml/dependency-marker-guard-removed`
(a disclosed-divergence revert in the `volumeSourceScannedAsNames` tradition: the result carries no
scalar values, so the mutant re-attaches the MEASURED target to the structural site) and
`yaml/dependency-marker-guard-overfires` (the `{{` exclusion deleted, which would drop the 17 ruled
template edges); `tsc --noEmit` clean.

**ALSO ADJUDICATED, NO CHANGE:** the one remaining path-like row, `../../analysis_options.yaml` in
`riverpod/packages/hooks_riverpod/test/analysis_options.yaml` — the target `packages/analysis_options.yaml`
is carried by NEITHER `git ls-files` NOR the disk in that checkout, so the claim is correctly
unverifiable (`ext?`): refuting it would say the reference is false when it is the checkout that
lacks the file. It stays RULED.

**WHAT THIS ROUND DOES NOT CLAIM.** Not a PASS: `ext?` is **223**, not 0, and clause 1 is still short
by 184. Not that the remaining 223 are fixable by marking — they are the same RULED class with the
same falsifiers, one row smaller.

**INSTRUMENT NOTE, and it is a shared defect found by this round's re-run:** the whole-population
`incoming-gate yaml yaml,yml --all` re-launched at this revision DIED with `GATE_EXIT=134` —
`FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory` — at the default
node heap while building a repo's DART index (33,739 files) partway through the walk. The re-run with
`NODE_OPTIONS=--max-old-space-size=4608` is in flight (`.tmp-probe/yaml-gate-r16.txt`); the lane's two
instruments (enumerator above, four-clause gate below) complete at the default heap because they walk
one language. Reported-not-fixed: the gate is shared, and the fix belongs in how it is launched or in
its per-project index lifecycle, not in a lane's edit.

## ROUND 19 — `**/testData/**` MATCHES `testdata/` CASE-INSENSITIVELY: **this lane's verdict was ALREADY on the larger population**, and the 7,065 files carry 122 of the 184

**THE FLEET FINDING.** The `ignore` package matches `**/testData/**` case-insensitively, so the glob
swallows lowercase `testdata/`; the shared globs sit at `fingerprint.ts:106` and
`parallel-indexer.ts:1127` (the INDEXER's discovery). The fleet census: 12,479 routed-extension files,
of which **6,979 `.yaml` + 86 `.yml` = 7,065** are this lane's.

**1. THIS LANE'S DISCOVERY DOES NOT USE THE GLOB — so the verdict never lost those files.**
`incoming-gate.ts` admits with `git ls-files` (`:312`), and so does every instrument in this lane. The
arithmetic closes on the recorded numbers: **18,999 tracked `.yaml/.yml` − 630 absent − 5 over the
1 MB cap = 18,364 admitted**, and a path census of that admitted set finds **7,065 files under a
lowercase `testdata/` component, `.yaml` 6,979 + `.yml` 86** — the census's numbers to the digit, by
extension included. **The 7,065 were always inside the population every yaml number was measured on.**

**2. THE CASE-INSENSITIVITY, CONTROLLED ON THE PACKAGE ITSELF** (`ignore-case-control.mjs`):
`**/testData/**` **ignores** `src/testData/foo.yaml`, `src/testdata/foo.yaml` **and**
`src/TESTDATA/foo.yaml`, and `**/perf/**` ignores `src/perf/bar.yaml`. The glob written in camelCase
excludes three spellings nobody wrote.

**3. THE OTHER CAMELCASE GLOBS, PRICED FOR THIS LANE** (`**/perf/**`, `**/Microbenchmarks/**`,
`**/wwwroot/**`, `**/testassets/**`, `**/benchmarkapps/**`, `**/coverage/**`): under a case-folding
component the counts are `coverage` **1**, and `perf` / `microbenchmarks` / `wwwroot` / `testassets` /
`benchmarkapps` **0** each. **`**/testData/**` is the only one that matters here**, and it matters a lot.

**4. WHAT THE 7,065 CONTRIBUTE — AND THE RESIDUAL IS NOT POPULATION-INVARIANT HERE**
(`lowercase-testdata-subset.txt`, the enumerator restricted to those files):

| | 7,065 testdata files | share of the lane |
|---|---|---|
| edges | **375,977** | **26.6 %** of 1,414,579 |
| `contains` | 372,755 | |
| `references` | 3,160 (2,578 resolved, **122 amb**) | |
| `imports` / `overrides` | 51 / 11 | |
| **amb(decl)** | **122** | **117 `test`** (k8s pod-security-admission testdata) + **5 `default`** (k8s `pkg/apis/core/v1/testdata/`) |
| **unresolved** | **0** | the 47 come from elsewhere |
| extFAIL | **0** | |

**So the 184 is NOT invariant to this population — it GROWS with it.** On the indexer's smaller
population the residual would read **62** (15 ambiguous + 47 unresolved); on the gate's larger
population it reads **184**. **The recorded 184 is the LARGER-population number, and for a verdict about
the ANALYZER that is the conservative direction**: it counts edges the product's own walk would never
see, and it says so.

**5. ARE THE LOWERCASE `testdata/` DIRECTORIES DISPOSABLE? NO, and the price says so.** They hold
**26.6 % of this lane's edges** — k8s's pod-security-admission fixture corpus, `pkg/apis/*/testdata`,
compose/consul integration fixtures. A rule that drops a quarter of a lane's edges should be a
DECISION, not a library default: either the glob matches what it was written as (camelCase, per the
Lead's ruling), or the product states that all test data is excluded and records that choice.

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
is the four-clause gate's own run at this revision — **RE-RUN at ROUND 18** (which is the content now
in it and in
[residual-yaml-whole-corpus-round18.txt](../../validation/m14/fixtures/yaml/residual-yaml-whole-corpus-round18.txt)) —
`TOTAL 1,414,579 · resolved 1,403,548 (99.2 %) · ofWhich 4 · amb(decl) 137 · unresolved 47 ·
extOK 10,624 · ext? 223 · residual 184 · extFAIL 0 · bindFAIL 0 · causeFAIL 0` · every type `CLOSED`
(one printed bucket per edge), `RESIDUAL_EXIT=0` — so the clause-1 number below and the
tie-break in clause 4 come from the four-clause instrument ITSELF at the frozen tree; its ROUND 14
predecessor (1,414,582 · ext? 244) is kept as
[residual-yaml-whole-corpus-round14.txt](../../validation/m14/fixtures/yaml/residual-yaml-whole-corpus-round14.txt);
the enumerator's current run is
[census-yaml-whole-corpus-round18.txt](../../validation/m14/fixtures/yaml/census-yaml-whole-corpus-round18.txt)
(1,414,579 · amb 137 · `EXT-Q INVENTORY` **223** · `CLAIMABLE EDGES` NONE);
the `extQ` census that carries the ruling is
[extq-yaml-whole-corpus.txt](../../validation/m14/fixtures/yaml/extq-yaml-whole-corpus.txt); and the
RULING's falsifier is
[name-collision-falsifier.txt](../../validation/m14/fixtures/yaml/name-collision-falsifier.txt) with
[census-yaml-whole-corpus-round7.txt](../../validation/m14/fixtures/yaml/census-yaml-whole-corpus-round7.txt)
(1,414,637 · `extQ` 282) as the round-by-round copy.)

**THE ENUMERATOR NO LONGER DISAGREES WITH THE GATE — see the note in clause 1.** It used to say `amb 142` against the gate's 138 (now 137); it now imports the gate's own `contains` predicate and reads **137**, the same as the gate. The paragraph below is kept as the record of what the gap was and why documenting it was the wrong fix: 142 − 138 = **4, and all four are `contains`.** The enumerator calls
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
223**, read off the ROUND 18 whole-population enumerator
([census-yaml-whole-corpus-round18.txt](../../validation/m14/fixtures/yaml/census-yaml-whole-corpus-round18.txt):
`TOTAL 1,414,579 · resolved 1,403,548 · amb 137 · unresolved 47 · extOK 10,624 · ext? 223 · extFAIL 0`;
the `incoming-gate` re-run at this revision is in flight after its first launch DIED of a heap OOM —
see ROUND 18's instrument note; its last completed reading was `226 external claim(s) unverifiable
(10624 verified + 226)` on 1,414,582 edges at the ROUND 15 revision). The movement is all FIXES:
ROUND 18 moved `extQ` 226 → 223 (3 kube-api-linter marker-name edges, priced 3-of-1,895 before a line
changed), ROUND 15 moved it 244 → 226 by FIXING 18 false external claims — the `$` owner class — and
ROUND 14 moved it 253 → 244 by FIXING nine more, so where a paragraph below still says 253, 244 or
226 it is quoting the ROUND-13/14/15 reading of this class. BOTH remaining numbers are
ruled, each row with a mechanism and a falsifier, and the falsifier for the
largest class **fired** (ROUND 7: it failed for exactly 1 of the 142 ambiguous edges, and ROUND 11
then FIXED that edge with the cross-file resource rule — the falsifier now reads `RULING HOLDS`). On
the SAMPLE draws `bad === 0`,
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
npx tsx validation/m14/fixtures/yaml/pubspec-package-price.ts   # the ext-Q URI row's price: 86 -> 83 verify / 3 refute
npx tsx validation/m14/fixtures/yaml/materialized-action-price.ts    # ROUND 14's price: 523 local uses -> 10 matched -> 9 convert / 1 refused
npx tsx validation/m14/fixtures/yaml/materialized-action-control.ts  # ROUND 14's control: 10 arms, 30 assertions, exit 0
npx tsx validation/m14/fixtures/yaml/store-scope-probe.ts     # the store layer, no context of its own
npx tsx validation/m14/fixtures/yaml/dependency-marker-name-control.ts  # ROUND 18's control: 3 corpus files + 5 arms, 20 assertions, exit 0
npx tsx script/m14/run-fixtures.ts --lang yaml                # 36 pass / 0 fail
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
343 → 335 (the role-entry fix) → 255 (Rounds 7–9) → 254 (Round 10) → **253** (ROUND 11) → **244**
(ROUND 14) → **226** (ROUND 15) → **223** (ROUND 18)**, by removing 80 edges that were being counted
as unverifiable imports and are not imports at all (Azure Pipeline branch filters, semgrep/flutter/
ffigen/Dart-builder selector lists, a Spring Boot endpoint list, a GitHub Actions job output) and by
re-claiming the quoted hasura includes as VERIFIED files — again by fixing claims, not by marking.
**ROUND 14 moved it 253 → 244 the same way:** nine `./…` targets a prior same-job step materializes
are re-named as the repository at its ref (or as the project's own file) they actually are, and the
single site the rule declined to convert is waypoint's, whose checkout pins no `ref:`.
**ROUND 15 moved it 244 → 226 the same way**, and it is the same defect class one spelling further
out: 18 `uses: $/.github/actions/…` sites claimed a GitHub OWNER `$`, when the target is a path in
the checked-out tree and the manifest is a file the project carries. Both rounds' arithmetic is in
their sections above; the column's movement is `imports` `extOK` 8,157 → 8,175 and `ext?` 201 → 183.
**ROUND 18 moved it 226 → 223 the same way**, and it is the row ROUND 15 itself left priced-but-
unimplemented: 3 `references yaml_depends_on` edges whose target is the kube-api-linter MARKER
`k8s:optional` — a Go-comment annotation no analyzer publishes, so the claim could never be
confirmed. The guard is a vocabulary-free shape rule (colon-bearing, template-free value at a
dependency position) priced over every one of the 1,895 `yaml_depends_on` targets untruncated: 3 hit,
1,892 untouched, zero collateral (ROUND 18's section).

The remaining **223 are ruled as a CLASS, with the four things the fleet ruling requires**: the
SHAPE split (the enumerator's 17 rows, grouped to 6 below), the MECHANISM (each row's "why nothing
can check it"), the COUNT split by shape, and a FALSIFIER per row ("what WOULD verify one"). The
largest single piece of
the ruling — **86 `package:`/`dart:` includes** — is dispositioned as a FACT-BUILDING question rather
than a lane defect, and **its price is now MEASURED instead of guessed**
([pubspec-package-price.txt](../../validation/m14/fixtures/yaml/pubspec-package-price.txt)): if the
gate built pubspec facts for this lane, the shared arbiter would move **83 of the 86 from `ext?` to
`extOK`** and **expose 3 as `extFAIL`**. **THE EARLIER GROUND FOR THIS DEFERRAL WAS WRONG AND IS
STRUCK:** the doc said "`package:lints` IS declared in that checkout" — the corpus declares `lints` in
**0** pubspecs and ships no `lints` directory, so the 62 `package:lints` sites VERIFY; the real refuter
is `flutter_lints`, declared at `flutter-packages/packages/flutter_lints/pubspec.yaml`, and all three
refutations are `package:flutter_lints/flutter.yaml` in that repo's `…/example/analysis_options.yaml`
(one of them INSIDE the `flutter_lints` package itself). **The decision is unchanged and now earned:
do NOT wire yet** — the 3 refutations are TRUE statements about the corpus (`isExternal: true` is false
when the project declares the package), and a per-file yaml analyzer has **no pub-resolution channel**
to turn the include into the in-repo file claim `packages/flutter_lints/lib/flutter.yaml`, which needs
a project-wide package→directory fact. That is §5v's RULED CLASS for this row: SHAPE (URI scheme),
MECHANISM (no pub resolution per file), COUNT (86 = 83 verify + 3 refute), FALSIFIER
(`pubspec-package-price.ts`, re-runnable, importing the arbiter's own `verifyImportClaim`). Three
further rows are the LEAD's, and are flagged rather than changed: one (`verifyRemoteRefClaim`
refusing `@release/v1`, 2 edges) is a rule-shape question in a shared gate, and two are POPULATION
decisions (admitting `.psm1`/`.json`/`.sh` to an evidence base that is `.yaml`/`.yml` by construction).

So this lane is at **residual 184 with zero refutations and 253 ruled unverifiable claims**, not at
PASS, and the difference between the two statements is a measurement: the extQ class was cut by 87%
(1,903 → 253) by correcting false claims, and every claim in it now carries its reason, its count and its falsifier.

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
own instrument cut it to 141. (**ROUND 11 then FIXED the 1** — see that section.)

The enumerator is refreshed at THIS revision as
[census-yaml-whole-corpus-round18.txt](../../validation/m14/fixtures/yaml/census-yaml-whole-corpus-round18.txt)
(1,414,579 edges · amb 130 + 7 · unresolved 33 + 14 · extFAIL 0 · `EXT-Q INVENTORY` **223**, whose
`CLAIMABLE EDGES` section reads NONE), which is the ROUND 18 run and is the artifact every "current"
number in this document comes from (the ROUND 14 copy of the same walk is
[census-yaml-whole-corpus-after.txt](../../validation/m14/fixtures/yaml/census-yaml-whole-corpus-after.txt),
1,414,582 · `EXT-Q INVENTORY` 244), with the emitting-key instrument beside it as
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
imports       8366     1         7          0           0
references    21417    19075     130        47          0
exports       4080     4080      0          0           0
extends       155      155       0          0           0
overrides     26       26        0          0           0
TOTAL         1414582  1403548   137        47          0

VERDICT: FAIL — 137 ambiguous + 47 unresolved of 1414582 edges, resolved against the file's OWN
PROJECT (production's scope); 253 external claim(s) unverifiable (10597 verified + 253 unverifiable)
  (the same edges under the pooled corpus key space: 591 ambiguous + 47 unresolved — that number is
   about the CORPUS's name collisions, not about resolution as production performs it)
instrument self-test: PASS (control fired)
```

Raw: [incoming-gate-yaml-whole-corpus-round12.txt](../../validation/m14/fixtures/yaml/incoming-gate-yaml-whole-corpus-round12.txt)
(re-run unchanged at HEAD `bd2335f52` as
[residual-yaml-whole-corpus-round13.txt](../../validation/m14/fixtures/yaml/residual-yaml-whole-corpus-round13.txt);
the ROUND 10 run it supersedes is
[incoming-gate-yaml-whole-corpus-round10.txt](../../validation/m14/fixtures/yaml/incoming-gate-yaml-whole-corpus-round10.txt);
the ROUND 5 run it replaces, kept as the historical record of `1,414,804 · amb 184 · extQ 343`, is
[incoming-gate-yaml-whole-corpus-round5.txt](../../validation/m14/fixtures/yaml/incoming-gate-yaml-whole-corpus-round5.txt)).

**The three things this walk settles, none of which the enumerator alone could:**

1. **`extOK 10,597` / `extQ 253` — the gate's own columns, and they match the enumerator's to the
   edge.** Two independently-written instruments, one shared number: ROUND 11 moved `extQ` 254 → 253
   in BOTH (the cross-file resource rule re-claimed 20 verified-external and 1 unverifiable reference
   edge as a resolved file reference).
2. **`extFAIL 0` over 1,414,582 edges**, which is the test the cross-file rule had to pass: it turns
   an `isExternal` claim into a FILE claim, and a file claim that MISSES is refuted. Nothing was
   refuted.
3. **`bad` = 137 + 47 = 184** in the verdict's own words, and `253` `extQ` beside it. The verdict names
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
| 2 | `extFAIL` = `bindFAIL` = `causeFAIL` = 0 | 0 · 0 · 0 on the whole population | **MET** — with `extQ` 223 *ruled*, not zero |
| 3 | every remaining edge attributed to a named cause with a measured count, fixed with a before/after or ruled with evidence | the 137 ambiguous are 117 same-kind-name-elsewhere + 10 kind-asked-no-object + 6 ansible role names + 4 no-kind-axis (named causes, each with a falsifier), and the 47 unresolved are 33 + 14 (two named causes); TEN causes fixed with before/after, including ROUND 11's cross-file resource rule that fixed the one SAME-DIRECTORY MISS the falsifier had proved (the two tables above) | **MET** |
| 4 | the tie-break: `ofWhich` 0, or an `intended` vs `arbitraryTwin` split from the store | `ofWhich` 4, all `contains`; `intended` 1,380,046/1,380,046 at the model level, AND a real store built per repository reads `contains 13,162 rows · 13,160 intended (own file, own line) · 0 sameFileOffLine · 0 arbitraryTwin · 2 unbound · 0 collision rows` | **MET, at BOTH levels** |

**If the owner rules that no external claim may be unverifiable, yaml fails clause 2 by 223 edges** —
the same structural failure json carries by 120. Those 223 are not un-fixed claims: they are targets
(templates, URIs, globs, runtime-materialised paths) that no single-file parse can name, and the only
alternative to ruling them is to refute them, which would falsify a claim that is not false.

**The clause-4 gap is CLOSED (ROUND 15).** json split `collRes` by putting every declaration of both
colliding targets into a store and reading `intended` vs `arbitraryTwin` off
`brain_relationship.target_symbol_id`; yaml's version of that split is now MEASURED by
`store-intent-split.mts`, which builds a real store per repository through the PRODUCTION indexer and
reads the binding off the row. It reads, on boundary + consul, ONE run each:

| store-side, per type | rows | bound | intended | sameFileOffLine | arbitraryTwin | unbound | collisions |
|---|---|---|---|---|---|---|---|
| `contains` | **13,162** | **13,160** | **13,160** | **0** | **0** | 2 | **0** |
| `imports` | 395 | 0 | 0 | 0 | 0 | 395 | 0 |
| `references` | 247 | **247** | 0 | 0 | 0 | 0 | 0 |
| `calls` | 40 | 0 | 0 | 0 | 0 | 40 | 0 |

So the determinism the clause asks about holds at the store and not only in the gate's model: no bound
`contains` row reaches another file, and no row had two declarations to choose between. The 2 unbound
`contains` rows and the 395 unbound `imports` rows are the cross-file shapes (an external import has no
target symbol by construction), which is a property of the type, not a mis-binding. **Two store-side
findings are REPORTED and not fixed, because the fix is in shared indexing and not in this analyzer:**
the store writes each logical `contains` edge about 1.65× (5,198 duplicate rows over 7,964 distinct
pairs; boundary's `.github/workflows/build.yml` alone is 637 rows over 381 pairs) and it loses 67
distinct pairs against the model's 8,031. The full table, the arithmetic that closes it, and the
phantom first run that produced it are in ROUND 15 §B.

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
   **`FAIL — 137 ambiguous + 47 unresolved of 1414582 edges …; 244 external claim(s) unverifiable
   (10606 verified + 244 unverifiable external)`** (ROUND 14's re-run; ROUND 12's read 253 / 10,597 on
   the same 1,414,582 edges), with the separator tripwire at 0 and the instrument's
   own control firing (`instrument self-test: PASS`). The four-clause gate spawned the same walk and
   reads `residual 184 of 1,414,582 · extFAIL 0` — **two instruments, one number, at the frozen tree**.
   Artifacts: [incoming-gate-yaml-whole-corpus-round14.txt](../../validation/m14/fixtures/yaml/incoming-gate-yaml-whole-corpus-round14.txt)
   (round 14's post-fix walk) with its [pre-fix baseline](../../validation/m14/fixtures/yaml/incoming-gate-yaml-whole-corpus-round14-baseline.txt)
   (the same revision, before the analyzer edit), and round 12's copy as
   [incoming-gate-yaml-whole-corpus-round12.txt](../../validation/m14/fixtures/yaml/incoming-gate-yaml-whole-corpus-round12.txt).
   **MET.**
4. **`externalRefuted = 0`, verified on the lane's own marks.** The whole-population enumerator reads
   **`extFAIL 0` over 1,414,582 edges at THIS revision
   ([census-yaml-whole-corpus-after.txt](../../validation/m14/fixtures/yaml/census-yaml-whole-corpus-after.txt),
   rotated to the ROUND 14 run; its named copy is
   [census-yaml-whole-corpus-round14.txt](../../validation/m14/fixtures/yaml/census-yaml-whole-corpus-round14.txt),
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
   with the file that refutes the old reading, which is what this criterion asks for. **ROUND 14 added
   one more, and it is the same shape:** the RULED CLASS's `10 × ./security-scanner`-style group was
   not a ruling after all — the targets are materialized at run time by a prior same-job checkout — so
   the lane priced the rule, FIXED the nine it could support, and shrank the class to 244 instead of
   keeping a count it had already written down as explainable. **MET.**

**So the lane is DONE by §7 — all five, each against an artifact — while the stronger four-clause
completion test is clause-1-short by 184, and clause-2-short by 223 if unverifiability is forbidden.**
The difference between those two sentences is the point: §7 asks whether the lane has done the work it
owes; the four clauses ask whether every edge is PROVEN. yaml has done the work, and states plainly
which edges are proven, which are ruled, and where the remaining 184 live — and the ONE that its
own falsifier proved was a real missed resolution has since been FIXED by the cross-file resource
rule (ROUND 11).

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

> **HISTORICAL (Round 2, 2026-10-09).** The CURRENT residual is **184** (137 ambiguous + 47
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

