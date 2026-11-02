# `real-make-analyzer` — GNU Make

Pure-AST analyzer for GNU Make / GNU Make-compatible build files, on the
`tree-sitter-make` grammar (`wasm/tree-sitter-make.wasm`).

Every symbol and relationship is derived from node types, fields and node
positions. **There is no source-text regular expression in this file**, and
`script/m14/tmp/make/` re-checks that claim on every run.

- Grammar: `tree-sitter-grammars/tree-sitter-make` @ `70613f3d`, package
  `tree-sitter-make@1.1.1` (MIT), vendored at `grammars/tree-sitter-make/` as a
  **local build from patched upstream source** — 2 measured patches, adding no new
  node type and no new field, with the pristine build retained for A/B. See
  `grammars/tree-sitter-make/PIN.md`.
- Source↔wasm proof: 44 named node types and 24 fields declared by
  `src/node-types.json`, 44 named and 24 fields in the wired wasm, **zero missing
  and zero extra in both directions**. See `grammars/tree-sitter-make/PIN.md`.
- Grammar conformance: 1,781 symbols / 5,880 relationships / 4 imports over the
  pinned 99-file corpus, 0 unknown node types, 0 unknown fields.
- Corpus differential vs an independent oracle: **recall 1.000000, precision
  1.000000**, 0 missing, 0 spurious, and **2,418 / 2,418 line numbers agreeing**.
- **0 files with ERROR/MISSING nodes** across the 99-file pinned corpus.
- Grammar conformance: 1,814 symbols / 6,079 relationships / 4 imports over the
  pinned 100-file corpus, 0 unknown node types, 0 unknown fields.
- Corpus differential vs an independent oracle: **recall 1.000000, precision
  1.000000**, 0 missing, 0 spurious, and **2,515 / 2,515 line numbers agreeing**.
- **0 files with ERROR/MISSING nodes** across the 100-file pinned corpus.
- Completeness: 44/44 named types classified, sections **A–H 8/8**. The corpus
  grammar residual is pinned to **zero** real ERROR/MISSING nodes.

## Language

- Analyzer file: `src/ast/real-makefile-analyzer.ts`
- Parser: `tree-sitter-make` @ `70613f3d`, package `tree-sitter-make@1.1.1`, vendored at `grammars/tree-sitter-make/` as a local build from patched upstream source (2 measured patches, adding no node type and no field); wired wasm `wasm/tree-sitter-make.wasm`
- Source-to-wasm identity: 44 named node types and 24 fields declared by the pinned source, 44 named and 24 fields in the wired wasm, zero missing and zero extra in both directions (`grammars/tree-sitter-make/PIN.md`)
- Language detection: extensions `mk`/`mak`, basenames `makefile`, `gnumakefile`, `.makefile`, `.gnumakefile` (`src/ast/language-detection.ts`)
- Wired in: `engine.ts` `getAnalyzer` → `RealMakefileAnalyzer`

## Symbol contract

| Field | Supported? | How extracted |
| --- | --- | --- |
| name | yes | the declaration node's name/word text; the assignment operator attached by the grammar is trimmed by character code |
| kind | yes | `variable_assignment`/`shell_assignment` → `constant`; `define_directive` → `function` (a macro is callable); each non-special `rule` target → `function`; one module symbol per file |
| qualified/container name | yes | the file's module symbol is the container; Make has exactly one declaration level, so there are no dotted qualified names |
| ownerName / ownerKind | yes | declarations are owned by the file module; a reference is owned by its nearest enclosing declaration, and a bare top-level expression is attributed to the module |
| range (start/end line + column) | yes | node positions (`range.startLine/startColumn/endLine/endColumn`) |
| parameters | no | a Make macro's arguments are `$(1)`-style positional references; they are not modelled as parameters on the signature |
| returnType / type | no | Make is untyped text substitution; variables hold strings |
| documentation/comments | no | comments are not attached as documentation |
| complexity metrics | yes | `metadata.complexity` = declared targets + conditionals, published as a relative count, not a cost |
| syntax errors | yes | ERROR/MISSING nodes are recorded and counted per file (0 across the pinned corpus) |
| decorators/attributes | no | Make has no attribute/decorator syntax |

## Relationship ontology

| Relationship type | Emitted? | How resolved | Confidence model |
| --- | --- | --- | --- |
| calls | yes | `$(call M, ...)` names its callee in the `arguments` node's first comma-separated field; resolved to the macro (`define`) the file declares | 1.0; `evidenceClass` records the evidence tier |
| contains | yes | the file module symbol contains every declaration (targets, variables, macros, includes) | 1.0 (structural) |
| exports | yes | every buildable target is public (an including makefile invokes it by name), plus `export V` directives | 1.0; `evidenceClass: export_target` for targets |
| imports | yes | `include f` publishes an edge from the file's module symbol to `f` | 1.0 (structural) |
| references | yes | only when THIS file declares the target; a prerequisite that names an undeclared file is `uses`, not a fabricated reference | 1.0; `evidenceClass` distinguishes a declared target |
| uses | yes | prerequisites, external variables, builtins and automatic variables; the unresolved ends are measured, not pooled | 1.0; `evidenceClass` is one of declared/builtin/external-file/external-variable/automatic and the corpus split is published |
| extends | no | RULED not applicable on measurement (`reviews/make/master-review.md` §5) | — (ruled absent) |
| implements | no | RULED not applicable on measurement (`reviews/make/master-review.md` §5) | — (ruled absent) |
| overrides | no | RULED not applicable on measurement (`reviews/make/master-review.md` §5) | — (ruled absent) |
| instantiates | no | RULED not applicable on measurement (`reviews/make/master-review.md` §5) | — (ruled absent) |

Every one of the 5,880 relationships carries a 1-based `line_number` on the name-bearing node.

## Supported constructs

| construct | node type | what it produces |
| --- | --- | --- |
| `VAR := v` | `variable_assignment` | `constant` symbol, operator from node positions |
| `VAR != cmd` | `shell_assignment` | `constant` symbol, operator `!=` |
| `define M ... endef` | `define_directive` | `function` symbol (a macro is callable) |
| `t: p` | `rule` | one `function` symbol per non-special target; dependency edges per prerequisite group |
| `$(VAR)` | `variable_reference` | `references` when this file declares it, else `uses` |
| `$(VAR:.c=.o)` | `substitution_reference` | as above (a sibling node, not a child) |
| `$@ $< $^` | `automatic_variable` | `uses`, `evidenceClass: automatic` |
| `$(call M, ...)` | `function_call` | `calls` edge to the macro |
| `include f` | `include_directive` | `imports` edge from the module symbol |
| `export V` | `export_directive` | `exports` edge |
| `$(foreach v, ...)` | `function_call` | `v` recorded as a local binder, not a variable |

`spec/make-completeness.json` classifies all 44 named types: 33 handled, 9 correctly silent, 4 open gaps (each named in "Known gaps" below). Fixtures: `validation/m14/fixtures/make/`.

## Regex inventory

**Zero source-text regular expressions in the analyzer**, re-checked by `script/m14/tmp/make/` on every run. The lane's one historical regex literal was found by `script/m12/make-contract-probe.ts` and removed; the contract probe now fails on a reintroduced literal. There is no regex doing syntax work: names come from grammar fields and node text positions, never from source scanning.

## Complexity envelope

`validation/m12/results/make-corpus-complexity.json` — pinned 14-file corpus, production path:

| Run | files | symbols | relationships | wall ms | symbols/s | relationships/s | peak RSS |
| --- | --- | --- | --- | --- | --- | --- | --- |
| make-corpus-production | 14 | 630 | 2,490 | 2,341.0 | 269.1 | 1,063.6 | 231.0 MiB |

Declared budget: none in-tree (no M12 budget artifact exists for make); the lane formula measures ms/Knode, and the analyzer's own `metadata.complexity` is a relative count (targets + conditionals), recorded as a count and not a cost. The larger pinned 99-file corpus reports 1,781 symbols / 5,880 relationships; the 100-file corpus 1,814 / 6,079, with throughput recorded per run.

## Differential ground truth

- Ground truth: `validation/m12/ground-truth/make.json` — `truthSource: manual_audit`, source `validation/m12/fixtures/make/{Build.mk,Library.mk,Negative.mk}`, expected 84 relations.
- Result: `validation/m12/results/make-differential.json` — `passed: true`, truePositive 84, falsePositive 0, falseNegative 0, unknown 0, precision 1, recall 1.
- Independent corpus differential: recall 1.000000, precision 1.000000, 0 missing, 0 spurious, and 2,418 / 2,418 line numbers agreeing over the pinned 99-file corpus (2,515 / 2,515 over the 100-file corpus).
- `validation/m12/results/make-contract.json` — 44 / 44 contract checks pass.

## Corpus validation

- Corpus: union of 13 pinned repositories (terraform, tf-aws-components, consul, boundary, luvit, kong, vault, nomad, waypoint, packer, terragrunt, Matrix, torrentinim); six probed repositories contributed no tracked Makefiles and are named as absent rather than silently dropped.
- Extensions: `Makefile`, `GNUmakefile`, `makefile`, `*.mk`.
- `validation/m12/results/make-corpus-errors.json`: 14 tracked files, 0 error files, 0 error nodes, 0 crash files.
- Wider conformance: 1,781 symbols / 5,880 relationships / 4 imports over the pinned 99-file corpus and 1,814 / 6,079 / 4 over the 100-file corpus — 0 unknown node types, 0 unknown fields in both.

## What Make's graph actually looks like

GNU Make has **exactly one declaration level**. A target, a variable, a macro and
an include are siblings at file scope; `ifdef`/`ifeq` *select* between
alternatives, they do not nest declarations. So a makefile is not a tree of
blocks the way an HCL file is — it is a flat set of declarations joined by
references — and the graph is built around that:

- **One module symbol per file**, named for the file. It `contains` every
  declaration and `exports` what the file provides, and it is the source of every
  include edge. Without it `exports` has no source and "what does this Makefile
  offer?" is unanswerable.
- **`references` only when this file declares the target.** Everything else is
  `uses`, carrying an `evidenceClass` so the class is readable rather than pooled.

That second rule is the content of the analyzer. A Make prerequisite is usually a
**file** and a Make variable is often set by the **command line, the environment,
or another makefile**, and GNU Make ships **builtins** no file can declare.
Publishing those as project-internal references asserts a declaration that does
not exist. Measured over the corpus, the unresolved edge ends divide as 241 file
paths, 183 external variables, 160 builtins, 213 automatic variables and 11 shell
variables — and **not one of them is a true dangler**
(`fixtures/make/out/dangle-adjudication.json`).

## Node types the analyzer reads

| construct | node type | what it produces |
|---|---|---|
| `VAR := v` | `variable_assignment` | `constant` symbol, operator from node positions |
| `VAR != cmd` | `shell_assignment` | `constant` symbol, operator `!=` |
| `define M … endef` | `define_directive` | **`function`** symbol — a macro is callable |
| `t: p` | `rule` | one `function` symbol per non-special target; dependency edges for every prerequisite group |
| `$(VAR)` | `variable_reference` | `references` if declared here, else `uses` |
| `$(VAR:.c=.o)` | `substitution_reference` | as above — a **sibling** of `variable_reference`, not a child |
| `$@ $< $^` | `automatic_variable` | `uses`, `evidenceClass: automatic` |
| `$(call M, …)` | `function_call` | `calls` edge to the macro |
| `include f` | `include_directive` | `imports` edge from the module |
| `export V` | `export_directive` | `exports` edge |
| `$(foreach v,…)` | `function_call` | `v` recorded as a **local binder**, not a variable |

`spec/make-completeness.json` classifies all 44 named types — 33 handled, 9
correctly silent, 4 open gaps — and `reviews/make/master-review.md` carries the
measurements behind each ruling.

## Grammar quirk: recipe-swallowed conditionals

tree-sitter-make nests a conditional that directly follows a rule *with a
recipe* **inside that rule's recipe child** — observed in the elixir Makefile,
where the `test` rule's span absorbs the entire following `ifdef/ifeq` block.
The old analyzer `continue`d after processing a rule and silently dropped
every rule inside those swallowed conditionals. The rewrite always descends
into children (including recipes), so nested rules like `debug:`, `release:`,
`gcc-ok:` are extracted with their own ranges and edges. Reference collection
stops at rule/conditional boundaries so a swallowed block's references attach
to the block's own rules, never the outer rule.

## Facts read from positions, never from text

Four of these were defects, not features, and each is a place where reading the
node naively produces a plausible wrong answer:

- **An assignment's name arrives with its operator attached.** The grammar's
  `word` node spans `CGO_ENABLED?` for `?=` but only `CC` for `:=`. Capturing it
  verbatim gave 55 symbols named `CGO_ENABLED?` / `BUILD_TAGS+` and **112 edge ends
  that dangled by construction**, because every reference names the clean
  identifier. The tail is trimmed by character code.
- **A `$(call …)` names its callee in the `arguments` node's first
  comma-separated field**, not in a child of its own.
- **A reference's owner is the nearest enclosing declaration**, tracked per walk
  frame. A conditional the grammar swallows into another rule's recipe must not
  donate its references to the outer rule — and a bare top-level expression
  (`$(foreach t,… $(eval $(call mk,$(t))))`, the idiom nomad's GNUmakefile uses to
  reify its package targets) has no enclosing rule at all, so it is attributed to
  the module.
- **Both expansion spellings are normalised.** `${VAR}` is Make's second form and
  is common — 68 occurrences across 14 of 99 corpus files. Handling only `$(`
  published each as `uses target -> ${VAR}` *and* a second `references` edge to
  `VAR`: the same fact twice, one spelling dangling.

## Known gaps, stated rather than hidden

| `MAKE-G1` | `VPATH = src` is not modelled. 0 corpus occurrences, so there is nothing to design against; the sibling `vpath` directive form *is* recorded, so the two spellings are deliberately asymmetric. A coverage gap, not a correctness defect. |
| `MAKE-G2` | `.RECIPEPREFIX = >` is not modelled. 0 corpus occurrences, which is not the same claim as no risk. A coverage gap, not a correctness defect. |

The two **grammar** gaps that used to sit here are closed. `MAKE-G3`
(`target: export VAR = value`) and `MAKE-G4` (`$$($(GO_CMD) list …)` — a shell
command inside an escaped-dollar expansion) were recorded as deliberately
unpatched, to protect the source↔wasm identity proof. That trade was then
measured rather than assumed, and it does not hold: the two patches add **no node
type and no field** — 44 named / 24 fields before and after, zero added, zero
removed — so the proof loses nothing and is re-measured for the patched source.

Measured over the 99-file corpus: **11 ERROR nodes → 0**, 3 files improved, 0
regressed. At the product level, **1,772 → 1,781 symbols** and **5,870 → 5,880
relationships**. Every one of the 19 facts the patch changes is either
error-recovery garbage that is now gone (a `?` used as a variable name, a whole
`VAR=value` used as a name) or a reference re-attributed to the variable whose
value it is read in. **The analyzer needed no change** — the constructs were
already modelled, just unreachable, which is the strongest evidence the patch is
well-founded. 9 previously invisible declarations are now visible. The pristine
build and the patch are retained under `grammars/tree-sitter-make/ab/` so the comparison can
be repeated rather than believed.

## Relationships emitted

`contains` 1,752 · `references` 1,976 · `exports` 1,357 · `uses` 790 ·
`imports` 4 · `calls` 1.

Every one of the 5,880 carries **`line_number`**, which is a product field: the
`contains` 1,784 · `references` 2,114 · `exports` 1,381 · `uses` 795 ·
`imports` 4 · `calls` 1.

Every one of the 6,079 carries **`line_number`**, which is a product field: the
indexer stores it and the address surfaces serve call-site positions from it. The
lane shipped with **0 of 1,784** edges carrying one.

The other four kinds in the taxonomy — `extends`, `implements`, `overrides`,
`instantiates` — are **ruled not applicable on measurement**, not left as silent
gaps; `reviews/make/master-review.md` §5 carries each count.

## Gates

| gate | result |
|---|---|
| `bun run script/m14/verify-grammar-pins.ts` | make registered; 0 drift; source↔wasm exact |
| `bun run script/m14/audit-analyzer-grammar.ts` | 0 unknown node types, 0 unknown fields |
| `bun run script/m12/make-contract-probe.ts` | **44/44 pass** — and it is the gate that found the analyzer's one regex literal, a dead `endif_directive` branch, and the computed-target prerequisite loss (405 edges) |
| `bun run script/m12/make-node-types-compare.ts` | **passed** — 35 live node-type references, **0 phantom** |
| `bun run script/m12/make-corpus-errors.ts` | **passed** — 12/14 files clean, 0 crashes, grammar residual **pinned** |
| `bun run script/m12/make-corpus-measure.ts` | **passed** — 622 symbols / 2,480 relationships, throughput recorded |
| `bun run script/m14/run-fixtures.ts --lang make` | **7/7 pass** |
| `BB_MUTANT_ONLY="make/" bun run script/m14/mutate-analyzer.ts` | **21/21 caught** |
| `BB_MUTANT_ONLY="make/" bun run script/m14/mutate-analyzer.ts` | **24/24 caught** |
| `bun run script/m14/completeness-inventory.ts --lang make` | **sections A–H 8/8** |
| `bun run script/m14/differential.ts --lang make` | both corpora **100 %** covered, 0 missing, 0 unexplained |

## Where the detail lives

This file is the contract. The reasoning, every defect found and what it cost, and
the measurements behind each number above are in
`reviews/make/master-review.md`; the consolidated evidence is
`validation/m60/make/lane-evidence.json`; the re-runnable probes are in
`script/m14/tmp/make/`.

**There is exactly one Make analyzer document and it is this one.** An earlier
revision of the lane also wrote `docs/analyzers/makefile.md`, named
after the analyzer *file* rather than the language. That was not cosmetic:
`script/m60/grammar-lanes-source.ts` derives lane names from doc **filenames**, so
the second file fabricated a lane called `makefile` alongside the real `make`, and
the two documents then drifted — the second carried current numbers while the first
kept assertions from before the lane was rebuilt (84 facts, a 34/34 contract, 7/7
clean files, 36 observed types), with no gate reading it, because the lane's own
doc-truth audit was pointed at the second file. Two documents for one language is
how a stale claim survives: `verify-m12-final-audit.ts` resolves
`real-${lang}-analyzer.md` for `lang=make`, which is **this** file, so the
numbers above are the ones the milestone audit actually checks.
