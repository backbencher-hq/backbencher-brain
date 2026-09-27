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

Two consequences of the format are worth stating because they look like omissions:

- A **Kubernetes volume source is not a reference.** `volumes[].configMap: { defaultMode: 3 }`
  is configuration; the `3` names nothing. Reading a volume-source payload as a source of
  names was a measured defect (4 fabricated `literal` targets over 500 files), fixed by
  splitting one key set into three — ref wrappers (`configMapRef`, payload *is* a reference),
  volume sources (naming field is `name` / `secretName` / `claimName` per source, or scalar
  shorthand), and plain scalars (`serviceAccountName`).
- **Merge keys are not applied** on either side of the differential: PyYAML's
  `flatten_mapping` runs in the constructor, which `compose_all` never reaches.

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
- **The grammar cannot lex a multi-line double-quoted scalar.** When it meets one, the
  `ERROR` it produces is 58 bytes wide and sits at the **document root**, so the whole
  file's containment is lost even though the file is valid YAML. Measured on
  `docker/api/docs/v1.25.yaml`–`v1.38.yaml` plus one Cloud Build file; attributed by an
  independent parser (PyYAML) reading those same files cleanly. **This is the grammar's
  defect, not the analyzer's**, and it is filed against tree-sitter-yaml under the M60 fork
  policy rather than worked around in this lane — a workaround here would hide an upstream
  bug from the one measurement that can see it.
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

From `validation/m12/results/yaml-complexity.json` (primary corpus, `--ext=.yaml,.yml`):

| Run | files | symbols | relationships | wall ms | userCpu ms/file | symbols/s | relationships/s | peak RSS | load1 | quiet |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| fixtures | 4 | 45 | 42 | 649.8 | 73.3 | — | — | 210.1 MB | 30.57 | **false** |
| kubernetes | 400 | 58,099 | 58,078 | 29,528.0 | 43.50 | 1,968 | 1,967 | 434.3 MB | 30.82 | **false** |
| ansible | 400 | 27,208 | 26,948 | 19,933.4 | 36.58 | 1,365 | 1,352 | 481.8 MB | 31.56 | **false** |

Declared budget: **no nested-loop scan over a symbol list; O(n) in nodes with O(1) edge
lookups.** Stated as a structural budget rather than a millisecond number on purpose: both
runs above were measured at load1 ≈ 31 (`quiet: false`), so per the artifact's own load rule
their wall/throughput figures are **advisory** and `userCpuMsPerFile` is the comparable
figure. A millisecond budget measured on a 6×-loaded box would be a claim about the box.

Hot-path audit — two O(n·m) scans were removed in this wave and replaced with walk-built
indexes, so the hot path is a single traversal plus O(1) map/set lookups:

- qualified-name resolution: a `Map` built during the walk, not a per-symbol rescan
- duplicate-key disambiguation: counted during the walk, not by scanning siblings per pair

No nesting guard was added, and that is a measured decision rather than an omission: over
299,478 corpus symbols the **maximum qualified-name length is 218 and the maximum depth is
20**, both far inside any recursion that matters, and a guard would be a bound nothing
reaches.

The pre/post comparison that motivated the rewrite: back-to-back under equal load, CPU per
file went 23.2 → 28.4 ms (**1.22×**) while the payload grew by 3.3% relationships and five
new relationship families. The cost is the extra payload, not a worse algorithm.

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
