# real-yaml-analyzer.md

## Language

- Analyzer file: `src/ast/real-yaml-analyzer.ts` (2,283 lines)
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

M60 ontology round. Every row carries a **verdict** and the **measurement** behind it,
because the six questions fail independently: a type the analyzer can construct is not a
type that fires, and a type that fires is not a type that is correctly labelled. All counts
are from production `parseFile` (`src/ast/pool-worker.ts`), never from `analyze()`.

| Relationship type | Verdict | What it means **in YAML** | Count / measurement (all through production `parseFile`) |
|---|---|---|---|
| `contains` | EMITTED | the key tree — the one relationship every YAML file has | 34,585 edges / 485 of 500 sampled files; both ends resolve 100.0%; 0.0% sub-1.0 |
| `references` | EMITTED | a key naming something else: `$ref` pointers, tag types, Compose `depends_on`, k8s resource refs | 570 edges / 14 files (stride draw); 9,725 / 49 files in the 63-file OpenAPI population; resolves 97.2% / 92.3%; 11.2% / 7.7% sub-1.0 |
| `imports` | EMITTED | a **file** this file pulls in: Ansible `include_tasks`, tag `!include`, and a step-level workflow `uses:` | 189 edges / 42 files (stride draw); 6,304 / 780 files in the 933-file workflow population; target resolves 3.7% / 0.1% — see *Resolved* |
| `extends` | EMITTED | the merge key `<<`: the one unambiguous inheritance construct YAML has | **104 edges / 16 files** over the whole 16-file merge-key population; 43 / 2 files in the workflow population; both ends resolve 100.0% |
| `uses` | EMITTED | a non-merge alias `*ref` reading an anchor | **86 edges / 10 files** in the merge-key population; 60 / 4 in the workflow population; both ends resolve 100.0% |
| `calls` | EMITTED (this round) | `jobs.<job>.uses` — a **reusable workflow** the job invokes | **196 edges / 92 files** over the whole 933-file `jobs:` population; 12 edges in the stride draw; source resolves 100.0%, target 0.0% (cross-file); 0.0% sub-1.0 |
| `exports` | EMITTED (this round) | a named schema definition a document **publishes** for other documents to `$ref` | **2,511 edges / 29 files** over the whole 63-file `openapi:`/`swagger:` population; 117 / 2 in the stride draw; **both ends resolve 100.0%**; 0.0% sub-1.0 |
| `overrides` | EMITTED (this round) | a duplicate mapping key — the later entry replaces the earlier | **20 duplicate-key pairs / 17 files** (parse-tree probe, whole corpus); 1 edge confirmed through `parseFile` in the stride draw, both ends resolve 100.0%, 100% sub-1.0 by design |
| `implements` | **RULED** | YAML has no interface-satisfaction construct | instrument **A** — 0 declaration nodes in a 47-type grammar inventory; see YAML-D10 |
| `instantiates` | **RULED** | YAML has no construction construct | instrument **A** — 0 construction nodes, 0 tags with construction semantics; see YAML-D11 |

**Why four separate draws.** A stride sample of 500 out of 16,371 files cannot see a
construct that occurs in 17 of them, and three of these types live at that frequency: merge
keys in 17 files, duplicate-key pairs in 17, job-level `uses:` in 92. Each was therefore
measured over its **whole population** rather than sampled, and the draw is stated per row so
a count is never quoted without the population it came from. The narrow draws are a *sampling*
filter on file text; the analyzer still decides what a `uses:` means, so a narrow draw cannot
flatter a count.

**Two independent instruments agree on `calls`.** The role-scoped parse-tree probe counted
**196 occurrences in 92 files**; production `parseFile` over the same population counted
**196 edges in 92 files**. That is the strongest form of agreement available here, and it is
worth naming what it is *not*: both walk the same grammar, so a grammar-level error in the
role test would be invisible to both. The claim being corroborated is "the analyzer's
position test and an independent count of the same positions agree", not "the role is right".
The role's correctness rests on the fixture pair instead —
`workflow-call-role` and `workflow-call-role-negative`.

The four types ruled out are ruled in `script/m14/spec/yaml-completeness.json` as
**YAML-D9 … YAML-D12**, each with its instrument, its probe, its measured count and the
condition that would overturn it. Two earlier decisions are marked `SUPERSEDED` because the
corpus overturned them — see *What this round overturned* below.

### The three types added this round, and why each is a GAP rather than a ruling

**`calls`.** The previous ruling (YAML-D1) read the grammar, found no call expression, and
declared the type inapplicable. That is the exact error the workstream document records for
the gate's first version: **invocation in a configuration language is a value in a reserved
position, and a grammar inventory cannot see it.** GitHub Actions writes invocation as data —
`jobs.<job>.uses: acme/infra/.github/workflows/deploy.yml@v3` — and that construct occurs
**196 times in 92 files**. Worse, the construct was not merely missing: every one of those
196 edges was being emitted as `imports`/`yaml_action_use`, i.e. labelled as an import of a
third-party action. The role is now read from the **path the analyzer built for the entry**
(`isJobLevelPath`), never from the value's characters, because `acme/infra/x.yml@v3` and
`actions/checkout@v4` both contain a `/` and only one of them names a workflow.

**`exports`.** A YAML file has no module system, so the first candidate was rejected on
measurement: `on.workflow_call.outputs.<name>` — the reusable-workflow output surface —
occurs **0 times in 16,371 files**.

**Scope of that rejection — read before reusing it.** The probe counted the *dotted*
spelling. GitHub Actions also writes the surface as a nested block:

```yaml
on:
  workflow_call:
    outputs:
      base_branch:
        description: 'The base branch'
        value: ${{ jobs.setup.outputs.base_branch }}
```

That form occurs in the corpus (e.g. `otp/.github/workflows/reusable-setup.yaml:26`,
`scala3/.github/workflows/build-msi.yml:15`,
`consul/.github/workflows/reusable-conditional-skip.yml:5` — 3 files), so the
rejection is of the dotted spelling only, not of reusable-workflow output
declaration as a construct. Nothing here emits an `exports` edge for it, and no
ruling claims the construct is absent. A future lane that wants it should probe
the nested block form.

The construct this lane does emit is schema publication:
`components.schemas.<Name>` (OpenAPI 3) and `definitions.<Name>` (Swagger 2 / JSON Schema
draft-4), defined once and reached from other documents as `$ref`. The corpus split:
**2,462** under `definitions`, **43** under `components.schemas`, **4** under
`components.links`, **2** under `components.securitySchemes`, **0** under the remaining
OpenAPI containers. This is the only type in the lane whose edges resolve at **both** ends by
construction rather than by luck, because the document and the definition are both symbols of
the file being analysed. The gate requires the document to declare `openapi:`/`swagger:` at
its top level, read from the shape index rather than from the text: a `definitions` key in a
file that never claims to be an API description is a bag of values, and publishing a bag of
values is a fabricated edge (`schema-publication-export-negative` pins this).

**`overrides`.** A duplicate mapping key is a replacement, and the analyzer was **already**
giving the two entries distinct identities — `root.child` and `root.child#2` — because one
shared id made every relationship endpoint ambiguous (YAML-D8, fixture
`duplicate-key-identity`). That disambiguation is the whole reason the edge is possible: an
edge needs two endpoints, and without it both endpoints would be the same path. The chain is
**last-wins**, not all-to-first: the third occurrence replaces the second, because that is
the entry the loader replaces. A mutant pins exactly that.

### `Resolved` — the one number that changed the reading of this lane

`imports` resolves its target on **3.7%** of its edges, and that is correct rather than
defective. An import target is a path in another file (`./.github/workflows/x.yml`,
`include_tasks: tasks/main.yml`) or an external coordinate
(`actions/checkout@v4`), and this analyzer is per-file, so neither end is a symbol here.
The lane reports it rather than hiding it: the edge carries `resolved: false` and a reason.
The three types added this round resolve at **100% / 100%** (`calls` and `overrides` resolve
because both endpoints are in-file paths; `exports` because both are in-file symbols), which
is why `exports` is the only type with no `unresolvedReason` vocabulary at all.

### `Confident` — the heuristic ratio

Across the 500-file stride draw: `contains` 0.0% sub-1.0 (34,585 edges, all
`structural`), `calls` 0.0%, `exports` 0.0%, `imports` 0.0%, `references` 11.2%,
`uses` 0.0%, and `overrides` **100%** — every one of them at confidence 0.8 with
`evidenceClass: inferred`. That last figure is deliberate and is the honest encoding of a
specific fact: the two entries of a duplicate key are a **parse fact**, while "the later one
replaces the earlier" is **loader behaviour**, not a grammar guarantee. YAML 1.2 leaves
duplicate mapping keys undefined, mainstream loaders take the last value, and GitHub Actions
rejects such a file outright. An edge claiming 1.0 there would be asserting a convention as
if the grammar had said it, so it says 0.8, carries the reason code
`duplicate-mapping-key-last-wins`, and is countable as a heuristic like any other.

### What this round overturned

| was | now | what changed it |
|---|---|---|
| YAML-D1: "No `calls`. YAML has no call expression." | `calls` EMITTED, 196 occurrences / 92 files | the grammar cannot see invocation expressed as data |
| YAML-D2: "No `implements`, no `overrides`, no `instantiates`." | `overrides` EMITTED, 20 pairs / 17 files; `implements` and `instantiates` re-ruled with instrument A | YAML-D2 asserted a whole group from the grammar; one member of it was measurable |

A third thing the round found is a **false positive accepted at handover**: the m60 ledger
(`script/m60/rel-type-coverage-gate.ts`) derives a lane's `emitted` set by scanning analyzer
source for the token `RelationshipType.<Member>`, and it is explicit that it over-reports
rather than misses. For yaml it credited `exports` from a single token at what is now line
1660 — a *defensive exclusion* in `attachQualifiedCalls`, `if (r.type === Contains || r.type
=== Exports) continue`, which is a comparison and not a construction. That token was the
only thing making `exports` look emitted, and the guard was unreachable until this round. The
superseded m14 arbiter (`script/m14/ontology-coverage-gate.ts`) derives `EMITTED` by
**observation** instead and is the sounder of the two. Reported, not edited — see §8 of the
lane report.

### What this round rejected as false positives

Two probes returned non-zero counts that are **not** evidence, and both are named here so
the next lane does not read them as support:

- **111 occurrences of `extends:` / `inherits:` keys in 92 files.** These are yamllint and
  Azure-pipeline configuration keys meaning "inherit this configuration", not type
  conformance. The probe matches the spelling; the role is a different thing. Counting them
  as `implements` would have been the workstream document's second false positive, in the
  same shape as the `class voice` telnet match it warns about.
- **15 distinct tag texts** (55× `!include`, 31× `!unsafe`, 26× `!vault`, 12× `!reset`,
  12× `!override`, 2× `!Sub`, 2× `!GetAtt`, 1× `!ENV`, plus 6 `!!` core-schema tags). A tag
  names the **type of a value**. `!!python/name:module.attr` names a Python attribute and
  `!!ruby/object:RI::ClassDescription` names a class; neither declares conformance to
  anything, so neither supports `implements` or `instantiates`.
- **Ansible's `!override` (12 occurrences in 1 file)** is a genuine override *directive*, but
  its target is a variable in another file, so there is no in-file endpoint to point at. It
  is counted and deliberately not emitted; the emitted `overrides` edges rest on duplicate
  mapping keys, where both endpoints are symbols of the file.

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

> **M60 note.** The three tables below are the **M14 wave** figures (1,274-file draw and a
> 9,961-file corpus). They are kept because they are the record of the import-line and
> two-vocabularies defects. For the **current** per-type counts, resolution rates and
> heuristic ratios see *Relationship ontology* above, which supersedes the "types emitted"
> count: the M60 ontology round took the lane from **3** emitted types to **7**, by adding
> `calls`, `exports` and `overrides` and by re-ruling `implements` and `instantiates` on
> measured evidence. Any statement below that says a type is "not emitted" is superseded
> where the ontology table says otherwise.

The question "are any relationship types missing?" deserves a measured answer rather than a
read of the ontology table, so here it is over the **entire eight-corpus draw (1,274 files,
349,633 relationships)** and then over the **full 9,953-file corpus** for reachability.

**Types emitted at the time of the M14 wave: 3 of the 13 the family ontology defines.**

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

**Not emitted at the time of the M14 wave, and each ruled with a reason rather than left
blank:** `calls`, `implements`, `instantiates`, `overrides` (asserted then as: the format has
no callable, no heritage clause, no constructor and no method to override), plus `uses`,
`exports`, `depends` and `field_access`, whose YAML equivalents were carried as `contains` +
`references` with a `relationshipType` that distinguishes them.

**Two of those four rulings did not survive measurement.** `calls` and `overrides` are now
emitted, and `implements` / `instantiates` are re-ruled with instrument A rather than from the
grammar alone. `uses` and `exports` were also un-emitted then and both fire now. The reasoning
and the counts are in *Relationship ontology*; the rulings are YAML-D9 … YAML-D12 in
`script/m14/spec/yaml-completeness.json`. What is worth keeping from the original ruling is
the shape of its error: **it asserted a whole group of four types from one argument about the
grammar, and one member of the group was measurable all along.** A group ruling is only as
strong as its weakest member, and a group is the cheapest way to make four unmeasured claims
look like one measured one.

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
| `yaml_workflow_call` | **calls** | 196 (M60, whole corpus) | `cabal/.github/workflows/release.yaml` |
| `yaml_workflow_call_unverified` | references | withheld when the document does not claim to be a workflow | `validation/m14/fixtures/yaml/workflow-call-role-negative.yaml` |
| `yaml_schema_publication` | **exports** | 2,511 (M60, whole corpus) | `docker/api/docs/v1.45.yaml`, `hledger/hledger-web/config/openapi.yaml` |
| `yaml_duplicate_key` | **overrides** | 20 (M60, whole corpus) | `helm/internal/plugin/testdata/plugdir/bad/duplicate-entries-v1/plugin.yaml` |

The four M60 families were measured with `script/m14/tmp/yaml-ontology-probe.ts` (role-scoped
parse-tree counts, whole corpus) and confirmed through production `parseFile` with
`script/m14/tmp/yaml-ontology-census.ts`; the two `unverified`/withheld rows are pinned by
fixtures rather than by a corpus count, because "correctly not emitted" has no count and a
fixture is what makes it a check rather than an assertion.

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
- **No expression, no `depends`, no `field_access`** — the format has no such construct,
  and none is invented. `depends_on` is carried as a `references` edge with its own
  `relationshipType` so it stays distinguishable from a generic dependency. `calls`,
  `uses`, `exports` and `overrides` were listed here as absent until the M60 round measured
  otherwise; that line was wrong and has been replaced above with the counts.
- **`apiContractPath` is emitted by the analyzer (3,341 over the corpus) and reaches the
  store as 0.** `pool-worker.ts` reshapes every symbol into the row shape with no such key
  while `parallel-indexer.ts` binds it. Both numbers are measured at both boundaries in
  `validation/m12/results/yaml-corpus-errors.json` so no gate can pass on a field that
  never had a value. **Central-owner work; not a lane claim.** `metadata` is likewise
  narrowed to a CSS allowlist at the same seam, so every metadata claim in this file is an
  *analyzer-boundary* claim.

## Declared limitations

Non-empty by measurement, not by temperament. Each item says what is uncertain and how it was
found.

1. **Grammar-version drift is the largest single source of error in this lane, and it is
   upstream.** The multi-line double-quoted scalar defect above leaves **69–72% of every
   large OpenAPI document unparsed**, so this lane's path counts on `docker/api/docs/*` are
   lower bounds, not measurements of the document. Everything this round counted is inside
   that bound: the 2,511 `exports` publications come from files whose trees stop early.
2. **`calls` targets are unresolved by construction (0.0% of 196 edges).** The target is a
   workflow in another file, or in another repository, and the analyzer is per-file. An
   edge that resolves only its source end is honest here but weak for `bb_impact`, which
   cannot tell a same-repo call from a cross-repo one without reading
   `metadata.isExternal`.
3. **`overrides` semantics are a convention, not the grammar (100% of 20 edges at 0.8).**
   Stated per-edge with a reason code; see the ontology section for why 1.0 would be a
   false claim.
4. **`imports` targets resolve 0.1–3.7%.** Correct for a per-file analyzer and still a real
   limit on any consumer that expects a bound endpoint.
5. **The `uses`-role rule is position-based and therefore blind to a workflow that does not
   use a `jobs:` block.** 103 corpus files have a top-level `jobs` and no `on:`; those are
   excluded by the shape gate on purpose, and the count of what that costs is in the
   gate-results table rather than guessed.
6. **The `exports` publication role is decided by two signals, either of which can lie:**
   the container name and the document's `openapi:`/`swagger:` claim. A bespoke API
   description that uses neither spelling publishes nothing; a non-API document that
   happens to carry `openapi:` at top level publishes its definitions.
7. **Two constructs were measured and deliberately not emitted**: Ansible's `!override`
   (12 occurrences, 1 file — the target variable is in another file, so there is no in-file
   endpoint) and `on.workflow_call.outputs.<name>` (**0 occurrences in 16,371 files** — the
   code for it was written, measured at zero, and removed rather than left as a dead
   branch).
8. **The ontology arbiter produced no verdict for this lane** (gate table above), so the
   independent check on these ten verdicts is the fixtures and the mutants, not the
   arbiter. That is a weaker position than an arbiter reporting a verdict, and it is not
   the same thing.
9. **Corpus drift.** `$HOME/fixtures/repositories` is shared and was growing
   during this round (123 directories at the final count; the admitted yaml count moved
   16,290 → 16,371 between two runs of the same script). Every count here states the
   population it came from; none should be read as a property of the corpus at a later
   time.

## M60 ontology round — gates, DERIVATION debt, and a false claim this round found

### Gates re-run, with results

| gate | command | result |
|---|---|---|
| M14 fixtures | `npx tsx script/m14/run-fixtures.ts --lang yaml` | **33 pass / 0 fail** |
| M14 mutation (F4) | `bun run script/m14/mutate-analyzer.ts` | **24 / 24 yaml mutants CAUGHT**; 1,499 caught overall; **6 SURVIVORS, all in other lanes** (`java/bare-read-type-attribution`, `groovy/modifier-return-type-loss`, `groovy/ctor-name-revert`, `scala/drop-import-source-rewrite`, `make/swallow-the-rule-after-a-comment`, `php/drop-external-override-guess`) |
| M60 rel-type coverage | `npx tsx script/m60/rel-type-coverage-gate.ts --only=yaml` | yaml `emitted` = 8 types; **6 DERIVATION findings**; the run **overwrites the shared 46-lane ledger with its scoped subset**, which this lane restored rather than committed |
| M14 ontology arbiter | `npx tsx script/m14/ontology-coverage-gate.ts yaml` | **NO VERDICT PRODUCED.** Two independent blockers, below |
| M14 honesty lint | `npx tsx script/m14/verify-honesty.ts` | **23 failures, byte-identical before and after this round's change** (verified by stashing the diff and re-running) — every one is an evidence-freshness failure driven by other lanes' edits to shared inputs. No yaml hygiene check fails. The 23 are pre-existing and are **not** cleared by this lane. |

**The arbiter cannot judge this lane, for two separate reasons.** Both are reported rather
than worked around, because both are in shared machinery this lane does not own:

1. `RULED_BY_LANG` in `script/m14/ontology-coverage-gate.ts` has entries for `bash` and
   `json` only. With no `yaml` entry the gate prints *"no RULING TABLE for yaml"* and exits
   **2** (line 289-293), so it cannot distinguish `RULED-SOUND` from `RULED-UNJUSTIFIED` for
   yaml. The rulings now exist and are in the gate's own expected shape —
   `script/m14/spec/yaml-completeness.json` carries `status: "RULED"` decisions YAML-D9 …
   YAML-D12 with `instrument` and `nodeTypesThatWouldMeanIt` fields — but `rulingFor()` is
   never reached, because it is only called for entries in `RULED`, which is empty for yaml.
2. The gate's own corpus walk aborted before reaching that check:
   `[BB-HANG] parser stuck 120s on ansible/test/integration/targets/cache-plugins/invalid_hostname_file_caches.yml
   — exiting`, preceded by six `[BB-PARSE-ERR] … memory access out of bounds` wasm traps.

**On that hang, stated at the confidence the evidence supports.** The named file is 191
bytes and parses in **658 ms** through `parseFile` on its own, and the five other OOM-flagged
files also parse cleanly at 1 worker (635 ms for four of them) and at 8 workers (7.5 s for
seven, including six 464–475 KB Docker OpenAPI documents). The box had **1 GB free of 15 GB**
with six lanes running. So the abort is **not** a per-file parser defect, and this lane does
not claim to have found one. What the evidence does support: the gate aborts under
whole-corpus load, and the difference between the passing small runs and the aborting large
one is duration and machine load. Which of the two is responsible is **not settled** here.
The three properties that would make the arbiter usable for yaml regardless are: a per-file
timeout in the gate's instrument-A walk (it has none; `parseFile`'s watchdog fires only in
the observation pass), a `yaml` entry in `RULED_BY_LANG`, and scoping the ledger write so a
`--only=yaml` run does not truncate the shared 46-lane file.

### DERIVATION debt: 5 → 6, and why it went up

The shared differential's audited-label filter for yaml is
`["extends", "implements", "instantiates", "overrides"]`. Against the 8 types this lane now
emits, the un-audited ones are `calls`, `contains`, `exports`, `imports`, `references`,
`uses` — **6**, up from 5 at handover.

The debt went **up** because two of the three types added (`calls`, `exports`) are not in the
differential's audit list, while one (`overrides`) is. That is the honest trade and it should
be named rather than hidden: the alternative was to rule the two types out, which measurement
showed to be wrong. The debt can be paid down in shared machinery this lane does not own —
`script/m14/differential.ts` line 23153's `calls` audit list needs `"yaml"` appended, and
`exports` needs a yaml entry in the audited set. **Paying it down in the lane instead would
have been dishonest**: `readOwnOracleLabels()` in the m60 gate prefers a lane's own
`script/m14/<lang>-truth.ts` `ORACLE_LABELS` export over the shared filter, so a lane could
make the DERIVATION findings disappear by exporting the analyzer's own label set — i.e. by
declaring that two walkers agree when only one had been run.

### A false claim this round found, in this lane's own documentation

The evidence pointer above previously read *"Mutants: `script/m60/yaml-mutants.ts` (15, all
caught)"*. **That claim was false.** The file exports `YAML_MUTANTS` and 15 entries were in
it, but nothing imported it: `script/m14/mutate-analyzer.ts` wires in `FSHARP_MUTANTS` and
no yaml array. So the 15 mutants were never run, and "all caught" described a run that had
not happened. This is exactly the failure the harness's own comment describes for fsharp — a
259-line block written into the shared registry and silently lost to a concurrent edit, which
is why that lane moved its mutants to a lane-owned file. For yaml the block was in a
lane-owned file from the start and was still not wired, which is the stronger version of the
same failure: **a separate file is necessary but not sufficient; registration is a separate
step and nothing checks it.**

Verified after temporary wiring (not committed — the registry is shared): **24 / 24 caught**,
each with the fixture that caught it named in the gate's own output. The two-line wiring
needed is in the lane report.

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

- Fixtures: `validation/m14/fixtures/yaml/` — **33 fixtures + 33 expectations**, all
  passing under `npx tsx script/m14/run-fixtures.ts --lang yaml`. Six are new this round:
  `workflow-call-role` (+ `-negative`), `schema-publication-export` (+ `-negative`),
  `duplicate-key-overrides`.
- Measurement harnesses (committed, reproducible): `validation/m14/fixtures/yaml/tools/`
  — `census.ts` (per-type counts, resolution rate, heuristic ratio, through production
  `parseFile`), `probe.ts` (instruments A and B over the whole corpus),
  `exports-probe.ts` (publication vs consumption, both sides counted),
  `dump-one.ts` (emits one file's relationships, for diagnosing a mismatch between an
  expectation and the analyzer). `census.ts` accepts `--sample N`, `--all`, and
  `--text=<regex>`; `--text` narrows the corpus *before* the draw, which is how the rare
  constructs were measured over their whole populations.
- Lane verification probe: `script/m14/tmp/yaml-verify-fixes.ts` (42/42)
- Mutants: `script/m60/yaml-mutants.ts` — **24 registered, 24 caught** via
  `script/m14/mutate-analyzer.ts`. Nine are new this round (`calls-reverted-to-imports`,
  `every-uses-becomes-a-call`, `calls-dropped`, `calls-shape-gate-removed`,
  `overrides-direction-reversed`, `overrides-all-to-first`, `overrides-confidence-inflated`,
  `exports-gate-removed`, `exports-over-fires`). See the wiring note below — this claim was
  **false until this round** and the correction is the reason it is stated with a number.
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
