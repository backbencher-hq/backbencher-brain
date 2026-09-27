# HCL / Terraform analyzer

## Language

- Analyzer: `src/ast/real-hcl-analyzer.ts`
- Parser: `wasm/tree-sitter-hcl.wasm`, loaded as `tree-sitter-hcl`
- Detection: `.tf`, `.tfvars`, `.tofu`, and `.hcl` → `hcl` in
  `src/ast/language-detection.ts`
- Grammar pin: `grammars/tree-sitter-hcl/` (vendored source +
  `src/node-types.json`), gated by `script/m14/verify-grammar-pins.ts`.
  Upstream `tree-sitter-grammars/tree-sitter-hcl@64ad6278`, package
  `@tree-sitter-grammars/tree-sitter-hcl@1.2.0` (Apache-2.0), wired wasm
  sha256 `86bb80cd151bd3ab1e44ed431a9c1874978db31519c62055efb50f028a1d0118`
  (92,478 bytes). Measured agreement: **64 named types / 2 fields (`key`,
  `val`), 0 missing, 0 extra** in both directions. See `PIN.md`.
- Wiring: `ASTEngine` → `RealHclAnalyzer`

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

A repeated **attribute key inside one block** is deliberately *not* disambiguated:
Terraform rejects it outright ("Attribute redefined"), so the collision is
inherited from invalid input (21 such identities remain in the corpus, all in
files whose path declares the intent).

Block metadata: `hclBlockType`, `hclLabels`, `hclBlockKind`
(`resource`/`data`/`variable`/`output`/`module`/`provider`/`terraform`/`locals`
or `nested`), `hclAddress`, `hclDuplicateIndex`.
Attribute metadata: `hclValueKind` (the grammar node type that actually describes
the value — the `operation` wrapper is unwrapped to
`binary_operation`/`unary_operation`), `hclAddress`.

## Relationship ontology

- `contains` — parent → child block / attribute, qualified.
- `references` — enclosing block → a **project** Terraform address, from a maximal
  run of `variable_expr` + `get_attr`. Families: `var.<n>`, `local.<n>`,
  `module.<n>`, `data.<type>.<name>.<attr>`, `<resource_type>.<name>.<attr>`.
- `uses` — enclosing block → a **language builtin**: `count.index`, `each.<k>`,
  `self.<attr>`, `path.<k>`, `terraform.<k>`. These resolve to nothing in the
  index because no file can declare them, so they are the `uses` class (the
  global namespace) rather than `references`, following the house precedent at
  `real-sql-analyzer.ts:1569`. Measured at 2,029 edges (4.6 % of all references);
  publishing them as `references` asserted a declaration that does not exist.
  Carries `metadata.evidenceClass: "builtin_qualified"` and `hclBuiltin: true`.
- `exports` — document root → each top-level block, alongside the `exports` array.
- `imports` — a `module` block → its `source` path, alongside the `imports` array
  (the same pairing C uses for its include edges: the array is the declaration
  list the indexer persists, the edge is what the graph draws).

Every relationship carries **`line_number`**, the 1-based line of the node the
target name is written on — the reference's own `variable_expr`, an attribute's
key, a block's header, a module's `source` key. This is the field the product
reads (`parallel-indexer.ts:2789,4393` persist only `rel.line_number`;
`graph.ts:526` surfaces only that), so an edge under any other spelling is stored
`NULL`. Measured: **213,487 / 213,487 (100 %)**. Dedupe is **per-site**: the key
includes the line, so one target referenced from two lines is two edges.

`metadata.evidenceClass` follows the M14 honesty taxonomy, as C and C++ use it:
`structural` (containment and the public surface), `reference_qualified` (a
fully-qualified **project** address, never a bare-name guess), `builtin_qualified`
(a **builtin** address), and `import_based` (a module's `source`). HCL emits
**no** `usage_contextual` or `inferred` edge at all — every fact is read off the
AST at confidence 1.0 — so those tiers do not apply and their absence is the
record, not an omission.

## What is ruled, and why

- **`calls` is not applicable, on measurement.** HCL declares no function, class,
  struct or type of any kind (0 of the grammar's 64 named node types), so no
  project can declare a callee. Across 12,977 `function_call` nodes in 9,079
  corpus files over 144 distinct callees, **zero** resolve to a declared symbol;
  the 5 that appear to are provable name collisions — four are Terraform core
  functions (`length`, `file`, `timestamp`, `lower`) and the fifth (`object`) is a
  **type keyword** in `type = object({…})` sitting beside a declared
  `output "object"`. Every `calls` edge would dangle, which is the shape java and
  groovy suppress with explicit builtin filters. The reference read *inside* a
  call is still published.
- **`extends` / `implements` / `overrides` / `instantiates` are not applicable.**
  HCL has no type declaration, base clause or interface implementation among its
  64 node types. Enforced, not merely stated: `run-fixtures.ts`'s
  `UNIVERSAL_FORBIDDEN_RELATIONSHIPS` for hcl refuses `extends`/`implements` into
  the reference roots `var`, `local`, `module` and `data`.

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
inside a damaged region is still emitted — the swallow class (#907). Measured:
244 corpus files carry ERROR nodes and still yield 145,645 symbols. The one
shape that is genuinely unreachable, where the grammar emits no `block` node at
all under Go-template damage, is 2 files in 9,079 and is ruled with a minimal
reconstruction in `reviews/hcl/master-review.md` § 6.

## Regex inventory

The analyzer contains **zero** regular-expression literals and no
`RegExp`/`match`/`replace` calls. The only `split` is `content.split("\n")` for a
line count. Labels come from the `template_literal` grammar field, object values
from the `val` field, and all reference extraction is node-type and field driven.

## Complexity envelope

One iterative DFS over the tree plus one recursive expression walk, with
Set-backed per-site relationship dedupe — O(nodes + emitted facts), no per-symbol
relationship scan. `complexity` (subtree node count) is memoised on node id so it
adds no asymptotic cost.

**No ms-per-file budget is published.** Measured under nine concurrent analyzer
agents (load average 35–51), the same analyzer over the same 600 files measured
1.451 / 2.097 / 3.885 ms per file on three consecutive rounds. What is published
instead is the machine-independent shape — over 4,172 files / 915,635 nodes:
**ms per 1k AST nodes = 50.21 / 47.45 / 49.64 / 48.83 across size quartiles,
spread 1.06 — flat.** Per source byte the ratio *falls* (20.58 → 7.29 ms/KiB) as
fixed per-file overhead amortises, which is the opposite of the O(n²) signature.

## Differential ground truth

Reference extraction is audited against an **independent** flat-sweep grammar
oracle over **9,079 files / 1,623,844 nodes / 9 independent repos**, using a
different algorithm on purpose (flat maximal-run sweep with byte-range
suppression, against the analyzer's recursive descent with threaded scope).

- **recall 0.999931** (2 missed, both in one Go-template file — ruled)
- **precision 1.000000** (0 spurious)
- M14.0.F5, both corpora: `terraform:hcl` 60 files / tree-truth 49 / **100 %**,
  MISSING 0, unexplained 0, heuristic 0; `tf-aws-components:hcl` 60 files /
  tree-truth 563 / **100 %**, MISSING 0, unexplained 0, heuristic 0
- Parse success: **0.0 %** failure on 400-file draws from both corpora

## Verification

| Gate | Result |
| --- | --- |
| `script/m14/run-fixtures.ts --lang hcl` | **8 / 8 pass** |
| `script/m14/mutate-analyzer.ts` (hcl) | **9 / 9 mutants caught** |
| `script/m14/completeness-inventory.ts --lang hcl` | sections A–D pass; E/F blocked, see review § 8 |
| `script/m12/hcl-contract-probe.ts` | **38 / 38** |
| `script/m14/audit-analyzer-grammar.ts` | hcl PASS, 0 unknown types, 0 unknown fields |
| `script/m14/verify-grammar-pins.ts` | hcl 0 drift, source↔wasm exact |
| `script/m14/verify-analyzer-hygiene.ts` | all 24 analyzers clean |
| `script/m14/verify-parse-success.ts` | 0.0 % / 0.0 % |
| `script/m14/verify-probe-battery.ts` | 37 / 37 |

Fixtures (one per defect class, each with a `forbid` set naming the specific
pre-fix wrong answer): `operation-operand-references`,
`dynamic-iterator-scope`, `dynamic-sibling-scope`, `sibling-identity`, `moved`,
`flat-attribute-document`, `object-key-not-reference`, `negative-syntax-error`.

## Spec

`script/m14/spec/hcl-completeness.json` — all **64** grammar named types bucketed
(57 `handled_verified`, 7 `internal_silent`) plus tree-sitter's runtime `ERROR`
recorded outside the buckets with its reason, and **8 design decisions** ruling,
each with a measurement behind it: the five inapplicable relationship kinds
(including `calls`, ruled on 12,977 corpus call nodes), the 441 block types, the
Go-template recall residual, the swallow class, duplicate attribute keys, quoted
attribute keys, `ERROR`'s place in a grammar census, and the
`uses`-versus-`references` class boundary.

## Review

`reviews/hcl/master-review.md` — 13 defects (12 fixed, 1 filed cross-language),
4 rejected after probing, 3 instrument defects found in my own oracle and
recorded rather than quietly corrected.
