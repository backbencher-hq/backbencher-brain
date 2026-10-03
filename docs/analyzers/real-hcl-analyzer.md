# HCL / Terraform analyzer

## Language

- Analyzer: `src/ast/real-hcl-analyzer.ts`
- Parser: `wasm/tree-sitter-hcl.wasm`, loaded as `tree-sitter-hcl`
- Detection: `.tf`, `.tfvars`, `.tofu`, `.hcl` → `hcl` in
  `src/ast/language-detection.ts:85`. Three corpus formats that route nowhere are
  recorded under **Declared limitations**.
- Grammar pin: `grammars/tree-sitter-hcl/` (vendored source +
  `src/node-types.json`), gated by `script/m14/verify-grammar-pins.ts`.
  Upstream `tree-sitter-grammars/tree-sitter-hcl@64ad6278`, package
  `@tree-sitter-grammars/tree-sitter-hcl@1.2.0` (Apache-2.0), wired wasm
  sha256 `86bb80cd151bd3ab1e44ed431a9c1874978db31519c62055efb50f028a1d0118`
  (92,478 bytes). Measured agreement: **64 named types / 2 fields (`key`,
  `val`), 0 missing, 0 extra** in both directions. See `PIN.md`.
- Wiring: `ASTEngine` → `RealHclAnalyzer`

## What each of the ten relationship types means IN THIS LANGUAGE

The general taxonomy is not self-explanatory for a configuration language, so
each entry says what the edge asserts here, and what it is not.

| Type | What the edge asserts in HCL | What it is not |
| --- | --- | --- |
| `contains` | lexical containment: document → top-level block → nested block → attribute | not module membership. Terraform merges every `.tf` file in a directory into ONE module, and this analyzer has no cross-file view, so a `contains` edge never spans files |
| `references` | the enclosing block READS that fully-qualified project address (`var.x`, `local.x`, `module.x`, `data.T.N`, `T.N.attr`) | not a write, and not an override — an override target is `overrides` (below) |
| `uses` | the enclosing block reads a **language builtin**: `count.index`, `each.k`, `self.a`, `path.k`, `terraform.k` | not a project symbol. No file can declare `count`, so publishing these as `references` asserted a declaration that does not exist |
| `overrides` | an `override_resource` / `override_data` / `override_module` block REPLACES the values of the declaration its `target` names | not a read and not inheritance. The source is the override block, not its enclosing block |
| `calls` | the enclosing block calls a **callable this same file declares** (`function "f" {}`) | not a call to a Terraform global. `merge(…)`, `length(…)` and `provider::test::is_true(…)` declare nothing a repository can declare, so they carry no edge |
| `exports` | the document root publishes a top-level block as part of its surface | not a module export in the JS sense; a Terraform module's outputs are `output` blocks, which are among the exported blocks |
| `imports` | a `module` block names an external module by its `source` path | not a code import. The target is a filesystem path or a registry coordinate and binds to no symbol |
| `extends` | — (ruled, below) | HCL has no type declaration to extend |
| `implements` | — (ruled, below) | HCL has no interface to implement |
| `instantiates` | — (ruled, below) | a `resource` block builds an instance of a type the PROVIDER declares, and no repository declares it |

## Relationship ontology — what was changed in this wave

Two of the five types believed missing at handover are emitted now, and both
were found by measuring the corpus rather than by reading the analyzer:

- **`overrides` was not missing. It was MISLABELLED.** Terraform has a dedicated
  spelling for replacing a declaration's values — `override_resource` /
  `override_data` / `override_module`, each with a `target` — and the analyzer
  read that `target` as an ordinary `references` read, because the reference
  reader reached the attribute before anything knew the enclosing block was an
  override. Measured: **71 such blocks across 33 corpus files**, 68 carrying a
  `target`. The edge is now `overrides` and the `references` edge is SUPPRESSED
  rather than duplicated, so the retype costs the graph no edge. Pinned by
  `hcl/override-target-not-reference`, which forbids the `references` label in
  both the top-level and the nested form.
- **`calls` was not inapplicable. It was unmeasured.** HCL has no
  function-declaration production, but the ecosystem layers one on top of the
  container grammar, and the corpus contains it: **`function "bindir"` at
  `docker/docker-bake.hcl:56`, called on lines 101, 106, 137 and 151.** A callee
  becomes an edge only when a `function` block in the same file declares it, so
  the 12,968 unqualified and 20 namespaced `function_call` nodes elsewhere in the
  corpus still produce nothing. Pinned by `hcl/declared-function-call`.

**The two measurements were made by two different walkers and agree.**
`hcl-construct-probe.ts` counts on the parse tree, matching each `function_call`
callee against the `function` blocks it finds; `parseFile` counts what the
analyzer's DFS emits after resolving its pending call sites. Both report **4**,
and the probe names the callee (`bindir x4`) while the census names the file
(`docker/docker-bake.hcl`, 4 edges). The four non-declared classes in the same
probe are the collision classes, counted rather than waved through: of the
12,968 unqualified call nodes, **5,902** match only a block LABEL (`target "list"`
makes `list()` look declared), **1,383** match only an attribute or object key,
and **5,679** match no declared name at all.

**Five other emitted types are unchanged**: `contains`, `references`, `uses`,
`exports`, `imports`.

### The rest of the ontology, unchanged

- `contains` — parent → child block / attribute, qualified.
- `references` — enclosing block → a **project** Terraform address, from a maximal
  run of `variable_expr` + `get_attr`. Families: `var.<n>`, `local.<n>`,
  `module.<n>`, `data.<type>.<name>.<attr>`, `<resource_type>.<name>.<attr>`.
- `uses` — enclosing block → a **language builtin**: `count.index`, `each.<k>`,
  `self.<attr>`, `path.<k>`, `terraform.<k>`. These resolve to nothing in the
  index because no file can declare them, so they are the `uses` class (the
  global namespace) rather than `references`, following the house precedent at
  `real-sql-analyzer.ts:1569`. Carries `metadata.evidenceClass: "builtin_qualified"`
  and `hclBuiltin: true`.
- `exports` — document root → each top-level block, alongside the `exports` array.
- `imports` — a `module` block → its `source` path, alongside the `imports` array
  (the same pairing C uses for its include edges: the array is the declaration
  list the indexer persists, the edge is what the graph draws).

Every relationship carries **`line_number`**, the 1-based line of the node the
target name is written on — the reference's own `variable_expr`, an attribute's
key, a block's header, a module's `source` key, a function callee's identifier,
an override's `target` key. This is the field the product reads
(`parallel-indexer.ts:2789,4393` persist only `rel.line_number`;
`graph.ts:526` surfaces only that), so an edge under any other spelling is stored
`NULL`. Measured: **216,541 / 216,541 (100 %)**. Dedupe is **per-site**: the key
includes the line, so one target referenced from two lines is two edges.

`metadata.evidenceClass` follows the M14 honesty taxonomy, as C and C++ use it:
`structural` (containment, the public surface, and the two new types —
`overrides` and `calls` are both parser-deterministic), `reference_qualified` (a
fully-qualified **project** address, never a bare-name guess), `builtin_qualified`
(a **builtin** address), and `import_based` (a module's `source`). HCL emits
**no** `usage_contextual` or `inferred` edge at all — every fact is read off the
AST at confidence 1.0 — so those tiers do not apply and their absence is the
record, not an omission. `builtin_qualified` is NOT one of the five tiers
`src/lsp/evidence_tier.ts` declares, so a stored `uses` row falls through to that
module's derivation and reads `usage_contextual` there; see **Findings for the
supervisor**.

## Symbol contract

A root `module` symbol named from the file stem is emitted first, so the
containment graph has a trunk and every non-root symbol has an owner (the
JSON/YAML/SQL/XML convention).

| Construct | Symbol kind | AST source | Identity |
| --- | --- | --- | --- |
| document root | `module` | `config_file` | file stem (`Infrastructure.tf` → `Infrastructure`) |
| `resource` block | `class` | `block` | `<resource_type>.<name>` (Terraform address) |
| `data` block | `class` | `block` | `<data_type>.<name>`, or the block type when label-less |
| `variable` / `output` block | `variable` | `block` | `<name>` (single label) |
| `module` / `provider` block | `module` | `block` | `<name>` |
| `terraform` / `locals` | `module` | `block` | block type (no label) |
| `function` block | `class` + `metadata.hclFunctionDecl` | `block` | `<block_type>.<label>` |
| `override_*` block | `class` | `block` | block type, or `<block_type>.<label>` |
| nested block (`lifecycle`, `backend`, `dynamic`, `content`, …) | `class` | `block` | `<block_type>` or `<block_type>.<label>` |
| attribute / argument | `property` | `attribute` | enclosing-block path plus attribute key |

Every symbol carries an AST-derived range (1-based line/column, byte offsets), a
`complexity` (its own subtree's node count, memoised so the whole analysis stays
O(nodes)), `qualifiedName`, a dot-qualified `scope`, and `ownerName`/`ownerKind`.

**`ownerName` is the parent's leaf name; `scope` is the parent's qualified path.**
They are two different facts and are never the same string except at the top
level, where the parent is the document.

**Sibling disambiguation.** Terraform repeats `locals` legitimately and
`moved`/`removed`/`import` one-per-move by design, and the HashiCorp DSLs repeat
label-less blocks (waypoint's `parameter`). Such siblings get an ordinal suffix —
`locals`, `locals#2`, `locals#3` — with the unsuffixed Terraform address kept in
`metadata.hclAddress`, so nothing about the address is lost. The top-level
sibling map is **seeded with the document root's name**, so `moved.tf` holding
`moved {}` gives the document the bare name and the blocks `moved#2`…; measured
at 308 corpus sites that collision would otherwise create. A top-level attribute
of a flat document is disambiguated the same way (`project = "hello"` in
`project.hcl`).

The disambiguation is per LEVEL, so two blocks legitimately share a leaf name at
different depths — `override_resource` at the document root and
`run.test.override_resource` inside a `run` block are distinct symbols with
distinct qualified paths. That is why the `overrides` edge source is a qualified
path and not a leaf name.

A repeated **attribute key inside one block** is deliberately *not*
disambiguated: Terraform rejects it outright ("Attribute redefined"), so the
collision is inherited from invalid input. Measured on this corpus: **21 repeated
`(scope, name)` identities**, and every one is an attribute key rather than a
block — `terraform.backend.local|path` on two lines, `duplicate|foo` in a file
named `duplicate.tfvars`, `storage.raft|retry_join` eight times.

Block metadata: `hclBlockType`, `hclLabels`, `hclBlockKind`
(`resource`/`data`/`variable`/`output`/`module`/`provider`/`terraform`/`locals`
or `nested`), `hclAddress`, `hclDuplicateIndex`, and `hclFunctionDecl` on a
`function` block. Attribute metadata: `hclValueKind` (the grammar node type that
actually describes the value — the `operation` wrapper is unwrapped to
`binary_operation`/`unary_operation`), `hclAddress`.

**Symbol metadata does not cross the worker boundary.** `pool-worker.ts:960`
forwards a fixed allowlist of symbol-metadata keys and none of the `hcl*` keys
are on it, so `hclFunctionDecl` — like `hclBlockType`, `hclAddress` and every
other key above — is readable from `analyze()` and from the fixture lane but not
from `parseFile`. Relationship metadata has no such filter and does cross.
Recorded for the supervisor rather than worked around: the fix is a shared file.

## Verdicts — all ten types

Measured with `validation/m14/measurements/hcl/hcl-corpus-census.ts` (production
`parseFile` from `src/ast/pool-worker.ts`, never `analyze()`) and
`validation/m14/measurements/hcl/hcl-construct-probe.ts` (instruments A and B).
Corpus: **9,329 tracked files / 16 repositories / 2,035,319 nodes**, every tracked
file whose path routes to `hcl` — a census, not a sample.

| Type | Verdict | Edges | Files | Example sites |
| --- | --- | --- | --- | --- |
| `calls` | **EMITTED** (ruled inapplicable at handover) | 4 | 1 | `docker/docker-bake.hcl:101,106,137,151` → `function.bindir` |
| `uses` | EMITTED | 2,073 | 579 | `boundary/enos/enos-scenario-e2e-aws-rdp-base.hcl:29` → `path.root` |
| `contains` | EMITTED | 138,570 | 8,343 | `terraform/internal/command/testdata/plan-modules-race/mod0/main.tf` |
| `imports` | EMITTED | 2,041 | 1,403 | `boundary/enos/ci/hcp-resources/main.tf:35` → `../../modules/aws_ssh_keypair` |
| `references` | EMITTED | 42,122 | 3,807 | `terraform-aws-components/…/context.tf` → `module.this.context` |
| `exports` | EMITTED | 31,663 | 8,343 | every top-level block of every file |
| `extends` | **RULED** | 0 | — | instrument A, below |
| `implements` | **RULED** | 0 | — | instrument A, below |
| `overrides` | **EMITTED** (ruled inapplicable at handover) | 68 | 33 | `terraform/internal/configs/testdata/valid-modules/with-mocks/test_case_one.tftest.hcl` |
| `instantiates` | **RULED** | 0 | — | instrument B, below |

Totals for the same census: **147,485 symbols, 216,541 relationships, 2,044
imports, 40,987 exports**, 84 files carrying syntax errors, 14 files yielding no
symbol. `SymbolKind` values: `property` 97,883, `class` 19,100, `variable`
15,496, `module` 15,006 — **0 empty kinds, 0 `unknown` kinds, 0 empty names, 0
empty qualified names, 0 ownerless properties, 21 repeated `(scope, name)`
identities** (all attribute keys; see the symbol contract).

### Before and after, same corpus, same commit

Two censuses of the same 9,329 files minutes apart, one with the analyzer at
`HEAD` and one with this wave's analyzer in place:

| Type | before | after | delta | attributable to this change |
| --- | --- | --- | --- | --- |
| `overrides` | 0 | 68 | **+68** | all 68 |
| `calls` | 0 | 4 | **+4** | all 4 |
| `references` | 42,195 | 42,122 | −73 | −68 (the retyped override targets); −5 is run noise |
| `contains` | 138,586 | 138,570 | −16 | 0 — noise |
| `exports` | 31,667 | 31,663 | −4 | 0 — noise |
| `imports` | 2,042 | 2,041 | −1 | 0 — noise |
| `uses` | 2,073 | 2,073 | 0 | 0 |
| extends / implements / instantiates | 0 | 0 | 0 | 0 |
| **relationships total** | 216,563 | 216,541 | −22 | **+4** (the `calls` edges); −26 is noise |
| **symbols total** | 147,504 | 147,485 | −19 | 0 — noise |

**Payload budget.** The graph effect is **+4 edges net**: the 68 `overrides`
edges are the 68 `references` edges retyped, not duplicated, and the 4 `calls`
edges are new. Measured against the workstream's stated concern — `bb_graph`'s
un-narrowed default at 2.5–4.8× a kind-filtered query — 4 edges on 216,541 is
0.0018 % of HCL relationship volume and no budgeted lane moves. No budget file
was touched.

**The noise floor, stated rather than hidden.** Two censuses of the SAME analyzer
commit over the same corpus, minutes apart, gave **147,370 vs 147,485 symbols**
and **216,284 vs 216,541 relationships** — so the run-to-run spread is ±115
symbols and ±257 relationships. That is why the per-type deltas above are
attributed only where they exceed it: `overrides` 0 → 68 and `calls` 0 → 4 are
unambiguous, `references` −73 against a −68 expectation leaves −5 of noise, and
the totals carry −26 relationships of noise against a +4 real change. The cause
is the worker pipeline under load, not the grammar: see **Not reproducible
byte-for-byte**.

### RULED: `extends`, `implements`

- **Instrument: A — grammar inventory.**
- **Probe:** enumerate every node type the grammar produces across the whole
  corpus, and every block type its containers declare, then ask whether any of
  them expresses a type declaration, a base clause or an interface list.
- **Measured:** **64 named node types and 37 anonymous token types** over
  2,035,319 nodes; **455 distinct block types**. Of 18 declaration-shaped node
  types probed (`class_declaration`, `interface_declaration`,
  `struct_declaration`, `trait_declaration`, `enum_declaration`,
  `type_declaration`, `base_clause`, `superclass`, `extends_clause`,
  `implements_clause`, `interface_specifier`, `inheritance_specifier`,
  `type_parameter`, `object_type`, `annotation`, `modifiers`, `type_identifier`,
  `superclass`), **0 are produced**. Of the 455 block types, **0** are named
  `class`, `interface`, `struct`, `trait`, `enum`, `extends`, `implements`,
  `base`, `super`, `protocol` or `func`.
- **The three near-misses, checked rather than waved through.** `type` occurs as
  a block type **3** times, and all three are waypoint plugin config sections
  (`plugin "go1" { type { mapper = true } }` in
  `waypoint/internal/config/testdata/plugins/explicit.hcl`); `method` occurs
  **60** times and all sixty are vault's `auto_auth { method { … } }` config
  section; `function` occurs **once** and is a real callable declaration, which
  is why `calls` is EMITTED above. None of the three is a type declaration.
- **Overturn condition:** a corpus file containing a `block` whose type is a
  declaration keyword, or any tree producing one of the 18 probed node types.
  `hcl-construct-probe.ts` prints both inventories in full, so a new type cannot
  arrive without appearing in that output.

### RULED: `instantiates`

- **Instrument: B — parse-tree semantic count.** A grammar inventory cannot
  settle this one: the language *can* express an instantiation
  (`resource "T" "n" {}` builds an instance of `T`), so the question is whether
  any file declares the thing being instantiated.
- **Probe:** count `resource` / `data` blocks whose TYPE LABEL is declared by a
  declaration form other than `resource` / `data` — i.e. an instantiation whose
  target the index could bind.
- **Measured:** **3,931** `resource`/`data` blocks over **439** distinct type
  labels. **891** match a `mock_resource` / `mock_data` / `mock_provider` label
  (`aws_instance` 563, `test_resource` 201, `test` 35, `aws_s3_bucket` 60,
  `aws_availability_zones` 12, `test_data_source` 17). Every other type label is
  declared by the **provider binary**, which is in no repository. The 891 are
  Terraform's test-mocking declarations: a `mock_resource "aws_instance"` says
  "for this aliased provider, instances of `aws_instance` are mocked", and a
  resource block of that type does take the mock — but a `mock_resource` is a
  mock, not a type, and publishing `instantiates` against it would assert a type
  declaration that does not exist and would fire on 3,040 blocks whose type is
  genuinely external. So no edge is published and the count is recorded instead.
- **Overturn condition:** a corpus file declaring a named **type** — as opposed
  to a mock, a data-source label or a resource type — that a `resource` or `data`
  block instantiates. On the day that appears, this ruling is wrong and
  `instantiates` becomes EMITTED.

### The construct that was believed absent and was not

`overrides` and `calls` are the reason this wave exists. The handover note listed
both as missing on the strength of a prose argument, and the prose was wrong in
the same way for two different reasons:

- **`overrides`** — the argument was "HCL has no redefinition semantics, so no
  override can exist". The premise is true of the **grammar**: instrument B's
  redefinition probe finds **858** repeated block addresses (enclosing path +
  type + labels) and 1,843 repeated attribute keys in a single file, and
  `hashicorp/hcl` returns every block of a type rather than replacing any. But
  Terraform does not express an override by repeating a declaration — it has a
  **dedicated block type for it**, and there are 71 of them. A ruling phrased
  about the grammar was answering the wrong question.
- **`calls`** — the argument was "0 of the 64 node types declare a function".
  Also true, and beside the point: a function declaration in this ecosystem is an
  ordinary one-label block, so it never needed a node type. There is exactly one
  in the corpus and it has four call sites.

### The `unknown` endpoint question, stated rather than waved through

Standing rule R7 (`validation/m60/ledger.json`) forbids an analyzer from NAMING
something with the placeholder literal `unknown`. This corpus produces **33
relationship endpoints and 18 symbols literally named `unknown`**, across 15
files. Every one is a real declaration: `variable "unknown" {}` and
`resource "aws_instance" "unknown" {}` in tflint's inspection fixtures,
`component "unknown" {}` in terraform's stacks testdata. `unknown` is a legal
HCL identifier, so the analyzer is reporting the source faithfully and no
placeholder is being invented. The tension is real and it is recorded under
**Findings for the supervisor**: a consumer that filters `target != 'unknown'`
drops 33 true edges.

### Not reproducible byte-for-byte

Two censuses of the same 9,329 files by the SAME analyzer commit, minutes apart,
differed: **147,370 vs 147,485 symbols**, **216,284 vs 216,541 relationships**,
and **12 vs 14 files yielding no symbol**. The parser is deterministic — a single
file parses to the same tree in 4–7 ms in isolation, including the file the pool
worker reported as `[BB-HANG] … stuck 120s` under six concurrent agents
(`terraform/internal/configs/testdata/config-diagnostics/unexpected-provider/mod/main.tf`,
32 bytes, `resource "foo_resource" "a" {}`). The variance is in the worker
pipeline under load — parse timeouts and truncation — not in the grammar. Every
number in this document is a single measured run and is labelled as such.

## The six questions, per emitted type

Measured on the same census. "Bound" means bound to a symbol row by the same
resolution the indexer performs, in the order it performs it:
`resolveTargetStmt` (`parallel-indexer.ts:2239`, any symbol in the project with
that NAME) → exact `qualified_name` → unique `name` → the dotted tail after the
first dot.

| Type | Edges | Target bound | Source bound | Both ends | confidence < 0.7 | `line_number` absent |
| --- | --- | --- | --- | --- | --- | --- |
| `calls` | 4 | 4 (100 %) | 4 (100 %) | 4 (100 %) | 0 | 0 |
| `overrides` | 68 | 50 (73.53 %) | 68 (100 %) | 50 (73.53 %) | 0 | 0 |
| `uses` | 2,073 | 1,411 (68.07 %) | 2,070 (99.81 %) | 1,409 (68.02 %) | 0 | 0 |
| `contains` | 138,570 | 138,293 (99.80 %) | 134,166 (96.81 %) | 134,067 (96.61 %) | 0 | 0 |
| `imports` | 2,041 | 21 (1.03 %) | 1,828 (89.56 %) | 21 (1.03 %) | 0 | 0 |
| `references` | 42,122 | 29,561 (70.18 %) | 38,352 (91.05 %) | 25,790 (61.25 %) | 0 | 0 |
| `exports` | 31,663 | 31,430 (99.26 %) | 31,407 (99.28 %) | 31,215 (98.54 %) | 0 | 0 |

**1 — Exists.** All seven are constructed in `real-hcl-analyzer.ts`;
`RelationshipType.Calls` and `RelationshipType.Overrides` are new in this wave.

**2 — Fires.** All seven produce edges on the corpus; the two smallest classes
are the two that were believed dead. `calls` fires on **1 file of 9,329** — that
is the whole population, and it is stated rather than rounded up.

**3 — Correct.** **No independent oracle exists for HCL, and the differential
refuses to run.** `npx tsx script/m14/differential.ts --lang hcl --repo
terraform --sample 60` exits with `parsed 60 file(s) and derived ZERO truth
edges — the parser or the oracle is dead, not clean (a 0/0 row is a fabricated
pass)`. This is pre-existing, not a consequence of this wave: the identical
error appears with the analyzer at `HEAD` (verified by reverting the file and
re-running). `grep 'lang === "hcl"' script/m14/differential.ts` returns nothing,
so no truth derivation and no label-allowlist entry is registered for this
language. The consequence is stated plainly: **question 3 is UNANSWERED for every
HCL type, including the five that were already emitted.** The reference-extraction
figures this document inherited (recall 0.999931, precision 1.000000 over an
independent flat-sweep oracle) come from an oracle that no longer runs in this
tree and are therefore not re-published as current.

**4 — Labelled.** The two new labels are pinned in both directions.
`overrides`: `hcl/override-target-not-reference` forbids `references` and `uses`
on the target and forbids `extends`/`implements` into it.
`calls`: `hcl/declared-function-call` forbids `calls` to `merge`, to `length`,
to `double` (the call-site spelling rather than the declaration's identity), and
to a declared-but-uncalled `function.unused`; it forbids `references` to a bare
single-identifier path. Three mutants per class re-enact the wrong answer and
are caught: `hcl/override-published-as-reference`,
`hcl/override-duplicated-as-reference`, `hcl/override-sourced-from-enclosing-block`,
`hcl/calls-to-every-callee`, `hcl/calls-target-is-the-callee-spelling`,
`hcl/calls-links-every-declaration`.
The pre-existing confusion pair (`uses` vs `references`) stays pinned by
`hcl/builtin-vs-project-reference` and its two mutants.

**5 — Resolved.** The rates above, and the breakdown matters more than the
headline:

- `imports` at 1.03 % is **correct, not a defect**: the target is a module source
  path (`./child`, `../../modules/aws_ssh_keypair`,
  `cloudposse/stack-config/yaml//modules/remote-state`), and the indexer stores
  it as `target_external`. 21 of 2,041 bind because some symbol happens to share
  the name.
- `uses` at 68.07 % is **almost entirely accidental**: 1,397 of its 1,411 bindings
  come from the dotted-tail strategy matching an unrelated name, and only **14**
  bind by exact name. This is expected — builtins are declared by nothing — and it
  is the reason the class is `uses` rather than `references`.
- `overrides` at 73.53 % splits **21 by exact name** (trustworthy) and **29 by
  dotted tail** (`aws_instance.second` binding because a symbol named `second`
  exists), with **18 unbound** — those are the corpus's deliberately invalid
  fixtures (`invalid_module_override_target.tftest.hcl` targets
  `module.absent_four`, which no file declares). A `bb_impact` answer built on
  the dotted-tail half could name the wrong symbol; that is a property of the
  indexer's third strategy, not of this analyzer.
- `references` at 70.18 % is the largest unbound class in absolute terms
  (12,561 edges), led by `module.this.context` (761),
  `module.iam_roles.terraform_role_arn` (236), `module.this.enabled` (233),
  `step.create_vault_cluster.root_token` (124). These are references into
  modules declared in *other repositories* of the module tree, so no symbol in
  this project declares them.

CSS `references` is the workstream's published reference point at 66.8 % of edges
resolved at both ends; HCL `references` resolves at both ends on **61.25 %**,
which is 5.55 points below it.

**6 — Confident.** Every edge of every type carries `confidence: 1`, and **0 of
216,541 relationships are under 0.7**. The heuristic ratio for this lane is
therefore **0 of 216,541**, and it is countable: the census prints the `<0.7`
column per type on every run. `evidenceClass` per type, from the same census:
`structural` 138,570 (`contains`) + 31,663 (`exports`) + 68 (`overrides`) + 4
(`calls`) = 170,305; `reference_qualified` 42,122 (`references`);
`builtin_qualified` 2,073 (`uses`); `import_based` 2,041 (`imports`). Sum
216,541.

## Reference extraction — the three rules that are easy to get wrong

1. **A path is a maximal CONSECUTIVE run of `variable_expr`/`get_attr` read over
   `child()`, not `namedChild()`.** The grammar wraps arithmetic and comparison
   operands in `operation → binary_operation`, whose children are the same
   sibling run — reading only named children walks over the `+` and welds
   `var.a + var.b` into `var.a.var.b`.
2. **A node may hold several runs.** A leftover `variable_expr` from a second
   operand forms no path on its own; the second operand has to be read in its
   parent's context.
3. **`index`/`splat` end the run without contributing a segment** — Terraform
   resolves `aws_instance.web[*].id` and `var.list[0]` against the address
   accumulated so far — but are still descended into, because
   `var.map[var.key]` writes a real reference inside the index.

### What is a loop local

| Binds | Named by | Scope |
| --- | --- | --- |
| `for` expression | `for_intro` identifiers | the whole for-expression — declaration, result **and** condition |
| `dynamic` block | the `iterator` attribute, or the block's own **label** when absent | that block's own body, and nothing else |

The `dynamic` scope is per-block, not per-enclosing-subtree: a resource carrying
`dynamic "assume_role"` and `dynamic "vpc"` must keep publishing its `vpc.*`
reads. Bindings are counted, so a name is suppressed only while a block that binds
it is still open.

### What is not a reference

Object-literal keys (read through the grammar's `key` FIELD, so a key that has any
token before it is still excluded), `for`-intro variables, `dynamic` loop locals,
function names, and bare single-identifier paths — `type = string` is a
type-constraint keyword. A real Terraform reference is always qualified.

## Flat documents

A flat attribute map is a legitimate HCL document and a `*.tfvars` file is nothing
else. Every top-level attribute is a `property` owned by the document root, so
consul-style agent config, `enos.vars.hcl` and every tfvars file yield symbols
rather than nothing.

## Syntax errors

Owned by `ASTEngine` (tree-sitter ERROR/MISSING); the analyzer declares none of
its own. It **descends through** ERROR nodes, so a declaration that survived
inside a damaged region is still emitted — the swallow class (#907). Measured on
this corpus: **76 files carry an ERROR or MISSING node** (246 ERROR nodes, 0
MISSING) and still yield symbols; 84 files arrive at the census carrying a
reported error of some kind. The one shape that is genuinely unreachable, where
the grammar emits no `block` node at all under Go-template damage, is ruled in
`script/m14/spec/hcl-completeness.json` HCL-D4 with a minimal reconstruction in
`reviews/hcl/master-review.md` § 6.

## Regex inventory

The analyzer contains **zero** regular-expression literals and no
`RegExp`/`match`/`replace` calls. The only `split` is `content.split("\n")` for a
line count. Labels come from the `template_literal` grammar field, object values
from the `val` field, function callees from the `function_call` node's `identifier`
child, and all reference extraction is node-type and field driven.

## Complexity envelope

One iterative DFS over the tree plus one recursive expression walk, with
Set-backed per-site relationship dedupe — O(nodes + emitted facts), no per-symbol
relationship scan. `complexity` (subtree node count) is memoised on node id so it
adds no asymptotic cost. The `calls` resolution adds **no** tree pass: call sites
are recorded during the expression walk that already visits every `function_call`
node, and joined against the declaration map after the DFS, because a call may
precede its declaration in the file (`docker/docker-bake.hcl` declares `bindir` on
line 56 and calls it on 101). A pre-pass would have doubled the node visits this
envelope is written against.

**No ms-per-file budget is published.** What is published instead is the
machine-independent shape: ms per 1k AST nodes flat across size quartiles. Per
source byte the ratio *falls* as fixed per-file overhead amortises, which is the
opposite of the O(n²) signature.

## Differential ground truth

**There is none that runs.** See question 3 above: the F5 harness exits on
`derived ZERO truth edges` for `terraform:hcl`, and it did so identically before
this wave. The inherited numbers (recall 0.999931, precision 1.000000 over
9,079 files, `M14.0.F5` at 100 % coverage on two corpora) are **not
reproduced here** and are not published as current.

## Mutation

| Harness | Result |
| --- | --- |
| `script/m14/mutate-analyzer.ts` with `BB_MUTANT_ONLY=hcl/` | **12 / 12 caught** (registry is shared; not edited) |
| `validation/m14/measurements/hcl/hcl-mutants.ts` | **6 / 6 caught** |

The lane-owned runner exists because `script/m14/mutate-analyzer.ts` is shared
machinery (workstream §8) and already carries twelve `hcl/*` mutants; the
precedent for a lane-owned module is `script/m14/fsharp-mutants.ts`. Each of the
six is a revert of one decision in this wave, documented in the file with the
defect class and the fixture that catches it.

## Verification

| Gate | Command | Result |
| --- | --- | --- |
| Ontology coverage | `npx tsx script/m14/ontology-coverage-gate.ts hcl` | **exit 2 — no ruling table for `hcl`**; see Findings 1 |
| Relationship-type coverage | `npx tsx script/m60/rel-type-coverage-gate.ts --langs=hcl` | 6 DERIVATION findings; checks 2–4 clean |
| Completeness sections A–H | `bun run script/m14/completeness-inventory.ts --lang hcl` | **4 of 8 sections FAIL** — A, B, E, F; C, D, G, H pass. Three of the four also FAIL with the analyzer at `HEAD` |
| Fixtures | `npx tsx script/m14/run-fixtures.ts --lang hcl` | **11 / 11 pass** |
| Mutation (shared registry) | `BB_MUTANT_ONLY=hcl/ npx tsx script/m14/mutate-analyzer.ts` | **12 / 12 caught** |
| Mutation (lane-owned) | `npx tsx validation/m14/measurements/hcl/hcl-mutants.ts` | **6 / 6 caught** |
| Grammar audit | `bun run script/m14/audit-analyzer-grammar.ts` | hcl **PASS**, refs=15, unknown=0, unknownFields=0 |
| Grammar pin | `bun run script/m14/verify-grammar-pins.ts` | hcl pinned, `copies:mirror=IDENTICAL`, 121 ids / 64 named / 57 anon / 2 fields. `PIN FAILURE julia` is another lane's |
| Analyzer hygiene | `bun run script/m14/verify-analyzer-hygiene.ts` | hcl clean; 3 findings, all in `cpp` / `haskell` / `elixir`, and the gate's `release blocked` line is theirs |
| m12 contract probe | `npx tsx script/m12/hcl-contract-probe.ts` | **38 / 38 pass** |
| Differential | `npx tsx script/m14/differential.ts --lang hcl --repo terraform --sample 60` | **hard error, ZERO truth edges** |
| Parse success | `bun run script/m14/verify-parse-success.ts` | **no hcl row exists** — the lane has no corpus pin (Findings 3). The run exits 2 on `proxicall:dart`'s moved sample, which is not this lane |
| Probe battery | `bun run script/m14/verify-probe-battery.ts` | 2 failures, `F9-PROBE-M3710-PHP` and `F9-PROBE-CLEAN-HEAD-PATTERN`; no hcl row |

### Which completeness failures this wave caused, and which it did not

| Section | At `HEAD` | After | Cause |
| --- | --- | --- | --- |
| A — structural | FAIL | FAIL | unchanged: the census finds 2 runtime node types (`ERROR`, `MISSING`) in no bucket, which spec decision HCL-D7 argues for and the gate's rule 2 rejects |
| B — relationship kinds | **pass** | **FAIL** | **caused by this wave**: the analyzer now emits `calls` and `overrides`, and `requiredKinds` for hcl (`script/m14/completeness-inventory.ts:772`) names only the five it emitted before. See Findings 9 |
| E — differential | FAIL | FAIL | unchanged: no baseline floor row for `terraform:hcl`, because the differential cannot run |
| F — perf budget | FAIL | FAIL | unchanged: no `avgMsPerFile` row for `terraform:hcl`, same cause |
| C, D, G, H | pass | pass | — |

**An instrument defect this lane introduced and removed.** The four harnesses were
first written under `validation/m14/fixtures/hcl/`, as the workstream suggests.
`completeness-inventory.ts`'s `emittedKinds` (line 1074) reads **every non-`.json`
file in the fixtures directory** and runs `ASTEngine.parseFile` on it — so four
`.ts` files were detected as TypeScript and their relationships counted as HCL
emissions, and section-b reported a phantom `instantiates` for a kind this
analyzer has never emitted. The harnesses now live in
`validation/m14/measurements/hcl/`, and the phantom is gone. The finding is kept
because the same trap awaits the next lane that puts a script in its fixtures
directory.

Fixtures (one per defect class, each with a `forbid` set naming the specific
wrong answer): `operation-operand-references`, `dynamic-iterator-scope`,
`dynamic-sibling-scope`, `sibling-identity`, `moved`, `flat-attribute-document`,
`object-key-not-reference`, `negative-syntax-error`,
`builtin-vs-project-reference`, and the two added here —
`override-target-not-reference`, `declared-function-call`.

## Spec

`script/m14/spec/hcl-completeness.json` buckets all 64 grammar named types (57
`handled_verified`, 7 `internal_silent`). **Its corpus block and its decision
HCL-D1 are now stale and the file is not this lane's to edit** — see Findings.
HCL-D1's ruling on `calls` and `overrides` is falsified by the measurements
above; its rulings on `extends`, `implements` and `instantiates` still hold, with
the probes now stated in measurable form.

## Review

`reviews/hcl/master-review.md` — 13 defects (12 fixed, 1 filed cross-language),
4 rejected after probing, 3 instrument defects found in the lane's own oracle and
recorded rather than quietly corrected.

## Declared limitations

Not a list of hedges; each entry is a construct that exists, or a measurement,
that this analyzer does not cover.

1. **`func` — Terraform 1.8+ user-defined functions — is not read.** `function`
   is measured at 1 declaration and 4 call sites in this corpus; `func`, the
   Terraform spelling of the same construct, occurs **0** times, so it is not in
   `FUNCTION_DECL_BLOCKS`. It parses as an ordinary one-label block, so a corpus
   containing `func "add" { … }` plus a call to `add` would find the declaration
   emitted as a nested block and **no `calls` edge**. Probe: block type `func` in
   `hcl-construct-probe.ts` output. Deliberate: every emitted `calls` edge in this
   lane is backed by a measured declaration, and adding an unmeasured spelling
   would put an unbacked edge class in the graph.
2. **Function resolution is same-file only.** The analyzer has no cross-file
   view, so a `func`/`function` declared in one `.tf` file and called in another
   of the same Terraform module produces no edge. Measured population: 0 sites
   (the one declaration and its four calls are in one file).
3. **A namespace-qualified provider function call binds nothing.**
   `provider::test::is_true(true)` is a `function_call` node whose callee
   identifier is the whole `provider::test::is_true` (the grammar's identifier
   production accepts `:`), and the function is implemented in the provider
   binary. **20 such calls over 9 distinct callees** in this corpus; none emits
   an edge.
4. **The `overrides` source is the override block, and the block has no name.**
   `override_resource {}` carries no label, so its symbol is the shared leaf name
   `override_resource` and a second one in the same scope becomes
   `override_resource#2`. The edge source is therefore a qualified path, which is
   what disambiguates it; a consumer keying on the leaf name alone cannot tell
   two override blocks in one scope apart.
5. **`.tfcomponent.hcl` and `.tfmock.hcl` route by their `.hcl` suffix, but
   `.tfcomponent` and `.tfmock` are not declared extensions.** Terraform Stacks
   components and mock files reach the analyzer only because they end in `.hcl`.
   A `foo.tfcomponent` with no `.hcl` in the name would not be routed at all.
6. **Go-template damage.** A file that is a Go `text/template` named `.hcl` parses
   as HCL and its `{{- range .x }}` reads as a two-segment path. This is the
   entire measured reference-recall residual of the inherited differential and is
   ruled in spec decision HCL-D3; the emission is faithful to the bytes.
7. **`builtin_qualified` is not a declared evidence tier.** The five tiers in
   `src/lsp/evidence_tier.ts` are `structural`, `import_based`,
   `usage_contextual`, `reference_qualified`, `inferred`. HCL's `uses` edges carry
   a sixth label, `builtin_qualified`, which that module treats as an unclaimed
   store label and therefore re-derives — so a `uses` row reads `usage_contextual`
   on the LSP surfaces while the stored metadata says `builtin_qualified`. 2,073
   corpus edges are affected. Reported, not changed: the label is pinned by an
   existing fixture and the tier vocabulary is a shared file.
8. **No HCL symbol metadata reaches the index.** `pool-worker.ts:960` forwards a
   fixed allowlist of symbol-metadata keys; no `hcl*` key is on it. Every
   `hclBlockType` / `hclAddress` / `hclFunctionDecl` value is therefore readable
   from `analyze()` and from the fixture lane but **not** from `parseFile` or from
   `brain_symbol`. Relationship metadata has no such filter and does cross, so
   `hclOverrideKind`, `hclCallee`, `hclBuiltin` and `evidenceClass` survive.
9. **The census is not byte-reproducible under load.** Two runs over the same
   9,329 files differed by 115 symbols and 2 empty files, and one file was
   reported `[BB-HANG] parser stuck 120s` under six concurrent agents while
   parsing in 4–7 ms in isolation. Every number here is one measured run.
10. **HCL is a configuration language with a provider binary behind it.** No
    repository declares the resource types, provider functions or backend
    schemas a `.tf` file uses, so `instantiates` has no bindable target and
    `imports` has no bindable target by construction. A graph over HCL is a graph
    over declarations, not over the infrastructure it describes.

## Findings for the supervisor

Each item names the file, the function, what must change, and why. None was
edited here.

1. **`script/m14/ontology-coverage-gate.ts` has no `RULED_BY_LANG` entry for
   `hcl`.** `RULED_BY_LANG` (line 192) is `{ bash: BASH_RULED, json: JSON_RULED }`,
   so `npx tsx script/m14/ontology-coverage-gate.ts hcl` exits 2 with
   `no RULING TABLE for hcl` and refuses to report on any of the ten types. Add
   an `HCL_RULED` array with three entries, using the measurements in this
   document:
   - `extends`, `implements` — `instrument: "A:grammar-inventory"`,
     `nodeTypesThatWouldMeanIt`: the 18 declaration-shaped names listed above. All
     0 in the observed inventory, so the gate reports `RULED-SOUND`.
   - `instantiates` — needs `instrument: "B:parse-tree-count"` with a
     `countOnTree` that counts `resource`/`data` blocks whose type label is
     declared by a non-`resource`/`data` block form. Measured 891 against
     `mock_resource`/`mock_data`/`mock_provider`; see the ruling above for why
     that count is not published as an edge. A gate that reports `FALSIFIED` on
     891 is reporting the mock case, so the probe needs the mock exclusion
     spelled out in the probe itself.
   `calls`, `overrides`, `uses`, `contains`, `references`, `exports` and
   `imports` will then be measured as `EMITTED` by the gate itself.
2. **`script/m14/spec/hcl-completeness.json` decision HCL-D1 is falsified.**
   Its text states that `extends`/`implements`/`overrides`/`instantiates` are
   "not applicable" and that `calls` resolves to nothing across 12,977
   `function_call` nodes. On this corpus `overrides` occurs 71 times and a
   declared `function` is called 4 times. The gate's `rulingFor()` reads this
   file for written rulings, so leaving it uncorrected would let a future gate
   pass a wrong ruling — which is the exact failure mode this gate exists to
   catch. Needed edit: split HCL-D1 into HCL-D1a (`extends`/`implements`/
   `instantiates` ruled, with the probes and counts above) and HCL-D9
   (`overrides` and `calls` GAP, closed by this wave), and refresh the `corpus`
   block — it says `files: 9079, repos: 9` and the measured census is 9,329
   files over 16 repositories with a different repository set.
3. **`script/m14/differential.ts` has no HCL truth derivation and no label
   allowlist entry**, so `differential.ts --lang hcl` cannot run at all and every
   HCL type is a DERIVATION finding. Two edits are needed and the differential's
   own doctrine requires them together ("truth AND allowance in the same commit"):
   - a lane-owned `script/m14/oracles/hcl.ts` exporting
     `deriveHclContainsTruth` / `deriveHclReferencesTruth` /
     `deriveHclUsesTruth` / `deriveHclExportsTruth` / `deriveHclImportsTruth` /
     `deriveHclOverridesTruth` / `deriveHclCallsTruth`, each from the parse tree
     by a rule stated independently of the analyzer's recursive descent — the flat
     maximal-run sweep with byte-range suppression is the shape the inherited HCL
     oracle used, and it is reproducible;
   - an entry in the compared-label filter at `differential.ts:23153`:
     `...(lang === "hcl" ? ["contains", "references", "uses", "exports", "imports", "overrides", "calls"] : [])`,
     plus `hcl` in `LANG_REPOS` (the primary corpus measured here is
     `terraform`, 2,281 admitted files) and a `SECOND_CORPUS` entry
     (`terraform-aws-components`, 1,809).
   Until the overrides oracle lands, the 68 `overrides` edges will read as
   `unexplained` on the F5 run, because `overrides` is already inside the shared
   filter's head list (`["extends", "implements", "instantiates", "overrides"]`)
   while no hcl truth derivation produces it. That is a 68-edge harness gap, not
   68 analyzer defects, and it is cheaper to pay now than to misread later.
4. **`script/m14/run-fixtures.ts` has no `UNIVERSAL_FORBIDDEN_RELATIONSHIPS`
   entry for `hcl`.** `docs/analyzers/real-hcl-analyzer.md` claimed before this
   wave that it did — "run-fixtures.ts's `UNIVERSAL_FORBIDDEN_RELATIONSHIPS` for
   hcl refuses extends/implements into the reference roots var/local/module/data".
   The map (line 438) holds `java`, `groovy`, `kotlin`, `scala` only. The claim
   was false; this lane now enforces the same boundary inside its own fixtures
   (`hcl/override-target-not-reference` forbids `extends`/`implements`/`uses` on an
   override target), so the property holds — but it is held by a fixture, not by
   the universal map. Adding
   `hcl: [{ type: "extends", target: "var" }, { type: "extends", target: "local" }, { type: "extends", target: "module" }, { type: "extends", target: "data" }, { type: "implements", target: "var" }, { type: "implements", target: "local" }, { type: "implements", target: "module" }, { type: "implements", target: "data" }]`
   would make it universal, and `matchConstraints` matches `target` by exact
   string, so `target: "var"` would not catch `var.x` — the rows need
   `targetStartsWith` or one row per observed target. **This is the one item on
   the list I could not verify the shape of without editing the file.**
5. **`pool-worker.ts` symbol-metadata allowlist omits every `hcl*` key**
   (line 960). Adding the eight keys the analyzer emits would make
   `hclBlockType`, `hclAddress`, `hclDuplicateIndex`, `hclFunctionDecl` and
   `hclValueKind` visible to `brain_symbol.annotations`. Read-only today.
6. **Standing rule R7 collides with a legal HCL identifier.** 33 relationship
   endpoints and 18 symbols in this corpus are literally named `unknown`, all
   from real declarations (`variable "unknown"`, `resource "aws_instance"
   "unknown"`, `component "unknown"`). The analyzer is faithful; the register in
   `validation/m60/symbol-sentinel-register.json` counts source STATEMENTS rather
   than runtime values, so the static census does not see this class at all. If
   R7 is meant to cover emitted values rather than analyzer source, HCL needs a
   declared exemption keyed on "the name is the source's own", and the exemption
   belongs in the ledger.
7. **`.tfcomponent` / `.tfmock` are undeclared extensions** that reach HCL only
   through the `.hcl` suffix (`EXTENSION_LANGUAGE` in
   `src/ast/language-detection.ts`). `language-detection.ts` is shared.
8. **One `[BB-HANG]` observed, not reproducible in isolation** —
   `terraform/internal/configs/testdata/config-diagnostics/unexpected-provider/mod/main.tf`
   (32 bytes) was reported stuck for 120 s by the pool worker under six concurrent
   agents and parses in 4–7 ms alone. Recorded because the census is not
   byte-reproducible because of it; not attributed to the grammar.
9. **`script/m14/completeness-inventory.ts` `LANG_CONFIGS.hcl.requiredKinds`
   (line 772) needs `calls` and `overrides`.** The row is
   `["contains", "references", "uses", "imports", "exports"]`, and its comment
   explains the omission of `calls` as "hcl RULES that kind not applicable on
   measurement (0 of its 64 node types declare a function, and 0 of 12,977
   corpus function_call nodes resolve to a declared symbol)". Both halves of that
   comment are now falsified — `docker/docker-bake.hcl:56` declares
   `function "bindir"` and calls it 4 times — so the row becomes
   `["contains", "references", "uses", "imports", "exports", "calls", "overrides"]`
   and the comment should be replaced by the measurement. Section B of that gate
   reads FAIL on this wave until the row is updated, and that failure is the gate
   correctly reporting published output its contract row does not account for.