# real-yaml-analyzer.md

## Language

- Analyzer file: `src/ast/real-yaml-analyzer.ts` (2,034 lines)
- Parser: `@tree-sitter-grammars/tree-sitter-yaml` 0.7.1, wasm `wasm/tree-sitter-yaml.wasm`,
  source vendored in-repo at `grammars/tree-sitter-yaml/` and pinned in
  `validation/m14/grammar-pins.json`
  (sha256 `e752dc21c3591df9b45692fe417d101f45d1828c28c44d79005f4066dc7e4e91`).
  0.7.1 is the **YAML 1.2 core schema** build; see *Unsupported* for what that means.
- Language detection: `.yaml` / `.yml` → `yaml` (`src/ast/language-detection.ts`)
- Wired in: `engine.ts getAnalyzer` → `RealYamlAnalyzer`

## Symbol contract

| Field | Supported? | How extracted (AST node/field) |
| --- | --- | --- |
| name | yes | `pair` key via `childForFieldName("key")`; scalars keep their written spelling (a key need not be an identifier) |
| kind | yes | mapping under a document → `class`; sequence item → `property`; document root → `module`; scalar at document root → `variable`/`constant` by value shape |
| qualified/container name | yes | `qualifiedName` from the ancestor path, with `[i]` for sequence position and `#n` for a duplicate key's n-th occurrence |
| ownerName / ownerKind | yes | enclosing mapping's qualified name and kind |
| range (start/end line + column) | yes | `startPosition`/`endPosition` of the pair's own span |
| parameters | n/a | YAML has no callable. Declared absent rather than pinned with a fabricated value — see design decision YAML-D5. |
| returnType / type | yes | `metadata.valueType` from the **1.2 core schema** resolver over the scalar node, closed vocabulary, `untyped` as the floor (never `unknown`) |
| documentation/comments | yes | `comment` is a stream-level sibling of `document`; attribution is **positional** — a comment immediately preceding a key at the same or shallower column documents that key, anything else is file-level |
| complexity metrics | yes | `complexity` = addressable-subtree size per symbol (the family definition), pinned by `payload-complexity` |
| syntax errors | yes | an `ERROR`/`MISSING` subtree is re-rooted under `#damaged@<line>` with stable per-child identity, pinned by `error-recovery-identity` |
| decorators/attributes | n/a | YAML has no attribute syntax; the analogue is a **tag**, which is emitted as a `declared_type` edge rather than a decorator, because a tag names a type and a decorator does not |

## Relationship ontology

| Relationship type | Emitted? | How resolved | Confidence model |
| --- | --- | --- | --- |
| calls | no | YAML has no invocation. Emitting one would mean reading a shell command out of a `run:` string, which is ecosystem knowledge, not the format. | — |
| extends | yes | **merge keys** (`<<`) and **aliases** (`*ref`) — this is YAML's inheritance. Cross-document aliases resolve at 0.5 and stay `resolved: false` with `unresolvedReason: anchor-defined-in-another-document`; an anchor in the same document resolves at 1.0 | `structural` when the anchor is declared in the same document, `inferred` + `cross-document-alias` when it is not |
| implements | no | no heritage clause in the format | — |
| instantiates | no | no constructor concept | — |
| uses | no | the ontology's read edge; YAML's reads are key references, carried as `contains` plus `references` | — |
| imports | yes | file includes: Ansible (`include_tasks`, `import_tasks`), Helm (`values`), Kubernetes, GitHub Actions | 0.8, `import_based`, `isExternal: true` — a named file is external by construction |
| exports | no | a YAML file exports nothing; its document root is the container | — |
| overrides | no | no method to override | — |
| references | yes | the largest surface, by `metadata.relationshipType`: `declared_type` (tags), `yaml_json_pointer` (`$ref` / `#/…`), `yaml_depends_on` (Compose sibling services), `yaml_resource_ref` (k8s), `yaml_action_use` (workflow `uses:`, shape-gated) | 0.8 resolved / 0.5 external-inferred; every edge carries `evidenceClass` and, when unresolved, a **reason** rather than a bare `false` |
| contains | yes | the key tree, the one relationship every YAML file has | 1.0, `structural` |
| depends | no | `depends_on` is a `references` edge with its own `relationshipType`, not the `depends` type, so it is distinguishable from a generic dependency | — |
| field_access | no | no expressions to evaluate | — |
| `yaml_merge` | yes (as `extends`) | merge key `<<` | see `extends` |
| `yaml_tag_include` | yes (as `imports`) | a `!include`-style tag naming a file | `import_based` |
| `yaml_keyword_include` | yes (as `imports`) | a file named by a KEYWORD rather than a tag — Ansible `include_tasks` / `import_tasks`, Helm `values`. Distinct from `yaml_tag_include` because the two are decided by different syntax: one is the key's value, the other is a tag on the value | `import_based`, `isExternal: true` |
| `yaml_action_use` | yes (as `imports`) | GitHub Actions `uses:`, emitted **only** in a file the shape index proved is a workflow | `import_based`, `isExternal: true` |
| `yaml_action_use_unverified` | yes (as `references`) | the same `uses:` value in a file that is **not** a workflow. It is not an import, because nothing established that a bare `uses:` in an arbitrary YAML file means an action reference; it is a `references` edge at 0.7 carrying `resolved: false` and `unresolvedReason: file-shape-is-not-a-github-workflow` | 0.7, `inferred`, explicitly unresolved WITH A REASON |

All **nine** `metadata.relationshipType` families the lane can emit are listed above, which is
the sense in which the relationship surface is fully accounted: `declared_type`,
`yaml_json_pointer`, `yaml_depends_on`, `yaml_resource_ref`, `yaml_action_use`,
`yaml_action_use_unverified`, `yaml_tag_include`, `yaml_keyword_include`, `yaml_merge`. The
four that are deliberately **not** types — `calls`, `implements`, `instantiates`, `overrides` —
are ruled with reasons in the rows above, so the ontology table has no silent gaps: every cell
is either a described emission or a stated refusal.

Two consequences of the format are worth stating because they look like omissions:

- A **Kubernetes volume source is not a reference.** `volumes[].configMap: { defaultMode: 3 }`
  is configuration; the `3` names nothing. Reading a volume-source payload as a source of
  names was a measured defect (4 fabricated `literal` targets over 500 files), fixed by
  splitting one key set into three — ref wrappers (`configMapRef`, payload *is* a reference),
  volume sources (naming field is `name` / `secretName` / `claimName` per source, or scalar
  shorthand), and plain scalars (`serviceAccountName`).
- **Merge keys are not applied** on either side of the differential: PyYAML's
  `flatten_mapping` runs in the constructor, which `compose_all` never reaches.

## Relationship emission census — the whole surface, measured

The question "are any relationship types missing?" deserves a measured answer rather than a
read of the ontology table, so here it is over the **entire eight-corpus draw (1,274 files,
349,633 relationships)** and then over the **full 9,953-file corpus** for reachability.

**Types emitted: 3 of the 13 the family ontology defines.**

| type | count | carries line? | carries evidenceClass? |
|---|---|---|---|
| `contains` | 336,129 | yes | yes |
| `references` | 12,674 | yes | yes |
| `imports` | 830 | yes | yes |
| **total** | **349,633** | **349,633 / 349,633** | **349,633 / 349,633** |

**Imports carry a line too — and for one day they did not.** `imports` is a separate payload
from relationships, and the corpus census asserts it separately: **540 / 540 imports arrive with
a 1-based line**, an invariant added in 2026-09-28 because the number was previously 0 and
nothing measured it. Two independent causes, both found by running a *real* `!include` file
through `parseFile` instead of through the analyzer:

- `pool-worker.ts` read `range.startLine ?? line`, and **no analyzer in the tree writes
  `line` on an import** — typescript, go, ruby, python and yaml all write `line_number`
  (45 call sites, zero write `line`). So every import in **every** language reached the store
  with `line: 0`.
- yaml's own action-`uses:` site passed `undefined` for the node, so 329 of the lane's 540
  imports had no line even after the first fix. It now threads the line the pending list
  already carried.

The same investigation then found a second, quieter one in the same rows. Every import in
every language read `type: "named"` — the JS/TS idiom — because `pool-worker` derived the
field from import *syntax* and ignored the `importType` the analyzer had already declared.
So a **project** file dependency (`include_tasks: tasks.yml`) and an **external** tool
invocation (`uses: actions/checkout@v4`) were indistinguishable in the row the
file-dependency engine reads, while the relationships beside them always knew the difference.
All **540 / 540** corpus imports now carry this lane's own classification
(`github_action` / `yaml_keyword_include` / `yaml_tag_include`).

Wiring that assertion also caught a naming inconsistency **in this analyzer**: the import row
said `github_action` where its own relationship said `yaml_action_use` — one fact, two
vocabularies. The census asserts `row type == relationshipType`, failed on its first run, and
the two are now one name.

The shape of both defects is worth naming: **a count of imports looks perfectly healthy while
every row is wrong.** The census said `imports: 540` throughout, and 540 was true. Nothing
in the milestone read a *field* — only a quantity.

**Not emitted, and each ruled with a reason rather than left blank:** `calls`,
`implements`, `instantiates`, `overrides` (the format has no callable, no heritage clause,
no constructor and no method to override), plus `uses`, `exports`, `depends` and
`field_access`, whose YAML equivalents are carried as `contains` + `references` with a
`relationshipType` that distinguishes them.

**All nine `metadata.relationshipType` families, and whether each has real-corpus evidence:**

| family | type | full-corpus occurrences | first seen at |
|---|---|---|---|
| `declared_type` | references | 67 | `grails-core/…/application.yml:40` |
| `yaml_json_pointer` | references | 9,689 | `docker/api/docs/v1.25.yaml:214` |
| `yaml_resource_ref` | references | 3,250 | `ansible/…/test_no_log.yml:7` |
| `yaml_keyword_include` | imports | 1,172 | `grails-core/.github/workflows/gradle.yml:130` |
| `yaml_action_use` | imports | 735 | `grails-core/.github/workflows/codeanalysis.yml:36` |
| `yaml_depends_on` | references | 151 | `grails-core/.github/workflows/coverage.yml:102` |
| `yaml_merge` | extends | 11 | `ansible/lib/ansible/config/base.yml:1668` |
| `yaml_tag_include` | imports | 4 | `pyyaml-include/tests/data/0.yaml:1` |
| `yaml_action_use_unverified` | references | 2 | `gh-cli/.github/codeql/codeql-config.yml:18` |

**All nine have corpus evidence**, measured over the full **9,961-file** corpus with **no
sampling** by `script/m60/yaml-family-census.ts`, which reads its repo list from the census
rather than repeating it — a second copy of that list had already drifted and cheerfully
reported a family as absent from a corpus it had never opened.

Getting `yaml_tag_include` there took a ninth corpus and a correction to the tag set
itself. Measured over the first eight, **every one of the ten include-family spellings the
analyzer knew occurred zero times** — while the tags Ansible actually uses (`!vault` 30,
`!unsafe` 31) were not in the set at all. The set had been guessed, not derived. Checking the
libraries that define the construct showed `!include` is not an Ansible tag but a
third-party PyYAML extension, and that **pyyaml-include 2.x — the current release — spells
it `!inc`**, which the analyzer did not recognise. So there was a live recall gap *and* a
corpus that genuinely contains the construct: `pyyaml-include` (pinned `fc096668`), the
library that defines it, whose own test data is real `!include` YAML that PyYAML parses
cleanly. It is a small test-data repository and is **not** evidence about YAML's general
shape; it is here to make one construct corpus-backed, and it is declared as exactly that.

Note the two families a 250-per-repository draw can miss: `yaml_merge` and
`yaml_tag_include` both read as **0** in the 1,274-file draw and only the full-corpus scan
distinguishes "rare" from "never reached" — the first has 8 real occurrences, the second
genuinely has none. A sampled census would have reported both as absent and been wrong about
one of them.

## Supported constructs

Each with its fixture under `validation/m14/fixtures/yaml/` (27 fixtures, all green):

- block and flow mappings, block and flow sequences, nested to any depth
  (`sequences`, `flow-collections`)
- multi-document streams and per-document scoping (`anchor-document-scope`, and the
  `-negative` twin that catches over-eager binding)
- anchors and aliases, merge keys including merge-into-sequence (`merge-sequence`)
- tags in all four forms — `!!local`, `!custom`, `!<verbatim>`, `!handle!name` through a
  `%TAG` directive — as `declared_type` (`tag-declared-type`, `directive-tag-handle`)
- `%YAML` and `%TAG` directives into `metadata.yamlVersion` / `metadata.reservedDirectives`
- comments as docstrings, positionally attributed (`comment-attribution`)
- JSON Schema `$ref` and `#/…` JSON pointers, resolved and unresolved
  (`json-pointer-resolve`, `json-pointer-resolve-negative`)
- tags that name a file (`tag-file-include`, `-negative`)
- Docker Compose `depends_on` sibling services
- GitHub Actions `uses:`, gated on the file actually being a workflow
- Kubernetes resource refs, by all three shapes (wrapper / volume source / plain scalar)
- framework detection by **shape**, not by filename (`framework-shape`, `-negative`):
  Kubernetes, Helm, Ansible, GitHub Actions, Docker Compose, OpenAPI, Argo Workflows,
  CircleCI, Travis, Compose files
- sensitive-value detection by key name **and** by value shape, with a negative twin
  (`secret-structural`, `secret-document`)
- error recovery with stable identity (`error-recovery-identity`)
- duplicate keys kept as distinct symbols (`duplicate-key-identity`)

## Unsupported / explicit-unknown constructs

- **A YAML 1.1 document is resolved with 1.2 rules.** The wired grammar is the 1.2 core
  schema build. A `%YAML 1.1` directive is *read* into `metadata.yamlVersion` and the file
  is then resolved as 1.2 — so `yes` is a string and `3` is an integer where a 1.1 reader
  would say otherwise. This is a fact about the pin, not a defect, and it is why the
  independent oracle compares the **key tree only**: scalar resolution differs *by design*
  between a 1.1 and a 1.2 schema. Recorded as design decision YAML-D6.
- **`timestamp_scalar` is in the grammar and unproducible from the wired core-schema
  build** (`grammars/tree-sitter-yaml/src/scanner.c:7-11`). Ruled `internal_silent` with
  the mechanism recorded (YAML-D6), not left silent.
- **The grammar cannot lex a multi-line double-quoted scalar, and the parse then STOPS.**
  Corrected 2026-09-28 by `script/m60/yaml-bucket-audit.ts`; an earlier version of this file
  said the trigger "produces a 58-byte ERROR at the document root". The 58-byte node is real
  but **nested** (v1.28: bytes 79,218–79,276, line 2453, depth 4). The truth is worse and
  simpler: **the root node itself is the `ERROR`**, and the resulting tree covers only
  **27.6–31.1%** of the file (measured over `docker/api/docs/v1.25.yaml`–`v1.38.yaml`:
  root ERROR spans 72,809–110,341 bytes). Between **69% and 72% of each file is never parsed
  at all**, which is why the analyzer publishes 1,991–2,637 key-tree paths where PyYAML finds
  7,249–9,001. Plus one Cloud Build file. **This is the grammar's defect, not the analyzer's**
  — attributed by an independent parser reading those same files cleanly, and by a path-level
  audit that explains **88,675 lost paths with 0 unexplained** — and it is filed against
  tree-sitter-yaml under the M60 fork policy rather than worked around here, because a
  workaround would hide an upstream bug from the one measurement that can see it.
- **Merge keys are not applied** (see above) and a merged mapping's inherited members are
  not re-emitted as the merger's children.
- **No callable, no expression, no `depends`/`uses`/`exports`/`overrides`** — the format
  has no such construct. Each is listed in the ontology above as `no` with the reason,
  rather than left as an empty cell that reads like an oversight.
- **`apiContractPath` is emitted by the analyzer (3,341 over the corpus) and reaches the
  store as 0.** `pool-worker.ts` reshapes every symbol into the row shape with no such key
  while `parallel-indexer.ts` binds it. Both numbers are measured at both boundaries in
  `validation/m12/results/yaml-corpus-errors.json` so no gate can pass on a field that
  never had a value. **Central-owner work; not a lane claim.** `metadata` is likewise
  narrowed to a CSS allowlist at the same seam, so every metadata claim in this file is an
  *analyzer-boundary* claim.

## Regex inventory

From `validation/m12/results/regex-census.json`: **0 entries for this analyzer.**

The lane was 0 from the start of this wave and is 0 now. Nothing is tolerated by an
implicit allowlist: the census enumerates analyzers, so a lane with no regexes has no rows
rather than a cleared row, and the grammar-pin gate's own re-run is what confirms the
analyzer file carries no dead analyzer literals.

## Complexity envelope

**The per-file average is the wrong instrument, and this lane proved it.** The M12 envelope
(`validation/m12/results/yaml-complexity.json`, 400 kubernetes files, `--ext=.yaml,.yml`)
reads **41.7 ms userCpu/file** at load1 25.8 — statistically indistinguishable from the
43.5 ms it read before the fix below. Nothing changed in that number, because those files
average 145 symbols each and the defect only fires on large ones. A corpus average cannot
see a per-file quadratic; that is what it is for.

So the claim is made as a **scaling exponent**, which contention cannot touch: time is
`k · n^e`, load inflates `k`, and only `e` says whether the code is linear. Measured by
`script/m60/yaml-scaling-probe.ts` with the **minimum** of N interleaved passes and the
verdict taken from **paired per-doubling ratios** (1.0 = linear, 2.0 = quadratic) rather
than an absolute cost, because a longer run accumulates more descheduling and "per-key cost
rises with size" is precisely the artefact that bias manufactures.

| shape | exponent before | exponent after | worst per-doubling |
|---|---|---|---|
| wide (n sibling scalars) | 0.98 | 0.87 | 1.68 |
| nested2 (n object children) | **1.74** | 1.11 | 1.41 |
| anchorsOnly (n objects, no aliases) | **1.74** | 1.02 | 1.24 |
| aliasOne (n aliases → 1 anchor) | 0.97 | 0.84 | 1.01 |
| aliasDistinct (n anchors + n aliases) | **1.73** | 0.99 | 1.38 |
| mergeHeavy (n merge keys) | **1.56** | 1.11 | 1.22 |

**What the quadratic actually was — and it was not in this file.** Every shape containing
object-valued keys was ~1.9 per doubling; every flat shape was linear. A CPU profile put
**81% of all sampled time in `stringSplitFast`**, and the only caller was
`src/ast/pool-worker.ts:606`:

```ts
.map((s: any) => {
  let snippet = ""
  if (["function", "class", "method", "interface"].includes(s.kind)) {
    const lines = content.split("
")   // once PER SYMBOL
```

A file with n class-kind symbols split the whole source n times — O(n²) in file size, on the
**production path, for every language**. YAML exposed it rather than causing it: yaml
publishes a `class` symbol for every object-valued key, so a 4,096-key nested document
produced 4,096 class symbols and 4,096 whole-file splits. Hoisting the split out of the
`.map` (lazily, via `??=`, so a file with no such symbol still never pays for it) took a
4,096→8,192-key nested document from **5,777 ms → 1,941 ms** and **22,268 ms → 1,900 ms**:
doubling the input now costs the *same* time, and the 8,192-key case is **11.7× faster**.

Declared budget, restated as a structural property rather than a millisecond figure:
**O(n) in nodes with O(1) edge lookups, at any file size.** Two O(n·m) scans introduced by
the rewrite were replaced with walk-built indexes; this production-path quadratic was found
by a scaling probe and not by reading, because reading the analyzer would never have shown
it — the defect was 1,500 lines away in a shared file, in a `.map` callback.

No nesting guard was added, and that is measured rather than assumed: over 299k corpus
symbols the maximum qualified-name length is 218 and the maximum depth is 20, both far
inside any recursion that matters.

The rewrite's own before/after, back-to-back at equal load: 23.2 → 28.4 ms CPU/file (1.22×)
for 1.03× more relationships and five new payload families. The cost there is the extra
payload, not a worse algorithm.

## Differential ground truth

- Ground truth: **none hand-authored.** This lane's oracle is an independent implementation —
  PyYAML 6.0.1 `yaml.compose_all`, which shares no code, no algorithm and no data model with
  the tree-sitter side. That property is the point: the shared F5 sweep records that a truth
  file authored by the same hand as the analyzer is a **mirror**, not a differential, and
  eleven lanes' hand-authored truth files were rejected on exactly that ground.
  Only the key tree is compared (see *Unsupported* for why scalar resolution is excluded).
- Result: `validation/m14/results/yaml-f5-differential.json`
- Draw: 8 pinned corpora × 200 files = **1,004 files, 357,304 oracle paths**
- **Unexplained: 0.** Every disagreement is adjudicated into a declared bucket; anything a
  bucket cannot explain is reported as a defect.
- Split by grammar health: **989 grammar-clean files, 234,673/240,724 matched, 0
  unexplained**; 15 grammar-error files, 0 unexplained (all loss attributed to the grammar
  defect above, each proved by the oracle parsing the same file cleanly).
- Separately, the M12 per-analyzer differential against 87 hand-audited facts over 4 fixtures
  reads **precision 1.000 / recall 1.000, FP 0, FN 0, unknown 0**
  (`validation/m12/results/yaml-differential.json`).

**What the buckets are worth, because "0 unexplained" is only as strong as its excuses.**
Audited per bucket on 2026-09-28, and recorded in the artifact as `bucketIndependence`:

| bucket | paths | standing |
|---|---|---|
| `grammarLossProvenByOracle` | 121,796 | **path-level audit**, byte-level, no rule: 88,675 paths accounted, 0 unexplained |
| `grammarContainmentLoss` | 38,240 | **the weakest, and not independent evidence.** Excused by a referee (`treeKeyPaths`) that shares no code with the analyzer but was *converged on it* — extended at every disagreement (10,752 rows for ERROR-reached pairs, 55 for orphan sequence items, plus the `#N` policy), never to find a defect |
| `documentModule` | 1,099 | **verified sound**: `nodeType === "document"` matches `documentCount` exactly (28/28 across fixtures), and the analyzer sets it in exactly one place |
| `oracleUnparseable` | 70 | files PyYAML itself rejects, named per file |
| `duplicateKeySuffix`, `anchorConstant`, `mergeAliasExpansion` | 7 | stated policy differences between two parsers |

Nothing is charged to the analyzer: `analyzerDefect` and `analyzerVsTree` are both **0**.
But the honest reading of `grammarContainmentLoss` is "the analyzer's declared policies,
which the oracle's set cannot express" — the same category as the 7 policy rows — rather
than independent confirmation. A referee patched until it agrees perfectly is a model of the
analyzer, and 0/0 in both directions is what a fitted referee looks like.

## Corpus validation

- Corpus target: `validation/m12/corpus-manifest.json` → `kubernetes@dfd7b93a` (primary),
  with seven more candidates: `ansible@7ec731bf`, `helm@d31cd699`, `grails_core@a83f8748`,
  `docker@4359a27c`, `terraform@2e1710bf`, `openapi_spec@447c479c`, `gh_cli@9b031151a`
- Draw: 1,274 tracked files, 250 per repository, deterministic stride over each repository's
  sorted file list
- Through the **production entry** (`pool-worker.parseFile`): **275,689 symbols, 284,303
  relationships, 0 crashes, 0 duplicate identities, 284,303/284,303 relationships carrying a
  1-based line and an evidence class, 275,689/275,689 carrying complexity, 0 unknown
  sentinels** (`validation/m12/results/yaml-corpus-errors.json`)
- 52 of 1,274 files carry grammar errors. 38 are **unexpanded templates** (37 Go
  text/template, 1 Grails `@...@`) named per file with the mechanism rather than excluded by
  path pattern; `unexpectedErrors` is **empty**; 15 are the grammar defect above.
- The row this replaced measured **one** repository — grails-core, 274 files, the smallest of
  the eight holdings. The eight-repository draw is what found the volume-source defect, which
  is the argument for measuring a language's dialect range rather than its easiest sample.

## Evidence pointers

- Fixtures: `validation/m14/fixtures/yaml/` (27 fixtures + 27 expectations)
- Lane verification probe: `script/m14/tmp/yaml-verify-fixes.ts` (42/42)
- Mutants: `script/m60/yaml-mutants.ts` (15, all caught) via `script/m14/mutate-analyzer.ts`
- Independent oracle: `script/m14/tmp/yaml-f5-oracle.py`,
  `script/m14/tmp/yaml-f5-differential.ts`
- Differential: `validation/m12/results/yaml-differential.json` (M12) and
  `validation/m14/results/yaml-f5-differential.json` (independent oracle)
- Contract probe: `validation/m12/results/yaml-contract.json` (27/27)
- Corpus census: `validation/m12/results/yaml-corpus-errors.json`
- Complexity: `validation/m12/results/yaml-complexity.json`
- Completeness spec: `script/m14/spec/yaml-completeness.json` (163 node types classified,
  sections A–H 8/8)
- Target spelling: `validation/m60/results/yaml-target-spelling.json` (lane-scoped; **not**
  a shared R10 gate result — see the review for why the shared census cannot yet see this
  lane)
- M13 handoff probes: `script/m60/yaml-m13-codemask-probe.ts` (refutes the register's
  stale codeMask claim for this lane) and `script/m60/yaml-m13-occurrence-probe.ts`
  (finds the real one: `bb_edit refactor` is a silent no-op on every yaml symbol, because
  a mapping key is `flow_node > plain_scalar > string_scalar` and
  `isIdentifierNodeType` recognises none of them)
- Review: `reviews/yaml/master-review.md`, `reviews/yaml/research-and-plan.md`
- Docs: this file

## Issue

M14.7 / M60 / M49 #286. Closes the YAML analyzer wave: 24 measured defect classes, grammar
pinned and vendored, an independent oracle, 27 fixtures, 15 mutants, and an M14 completeness
pass. Two findings are filed against code this lane does not own and are recorded rather than
fixed: the `apiContractPath` worker-boundary loss, and the tree-sitter-yaml multi-line
double-quoted scalar defect.
