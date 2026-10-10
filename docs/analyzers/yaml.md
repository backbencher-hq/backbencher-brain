# yaml — the verdict page

This is the yaml lane's **verdict page** for the Laptop-B ontology round: what the lane claims,
what the instruments say, and what is still open. The large lane-authored design document is
[real-yaml-analyzer.md](real-yaml-analyzer.md) — it is not duplicated here.

## 0. Round 3 — the must-be-zero column is ZERO

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

## 1. Coverage — declared, and closing
`script/m14/spec/yaml-completeness.json` carries the `coverage` block the board reads
(`yaml 6/8 from=spec coverage block`):

| | types |
|---|---|
| implemented (6) | `contains`, `uses`, `references`, `imports`, `extends`, `overrides` |
| excluded — `grammar-absence` (2) | `implements` (YAML-D10), `instantiates` (YAML-D11) |
| corpusUnexercised (2) | `calls` (fires only on the workflow-call fixture), `exports` (fires only on the schema-publication fixture) |

Invariant: `6 + 2 + 0 === 10 − 2`, and both exclusions are `grammar-absence` with a measured
node-type census behind them.

## 2. The residual — "n/n is not done"

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

