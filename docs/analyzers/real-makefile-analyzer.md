# `real-makefile-analyzer` — GNU Make

Pure-AST analyzer for GNU Make / GNU Make-compatible build files, on the
`tree-sitter-make` grammar (`wasm/tree-sitter-make.wasm`).

Every symbol and relationship is derived from node types, fields and node
positions. **There is no source-text regular expression in this file**, and
`script/m14/tmp/make/` re-checks that claim on every run.

- Grammar: `tree-sitter-grammars/tree-sitter-make` @ `70613f3d`, package
  `tree-sitter-make@1.1.1` (MIT), vendored at `grammars/tree-sitter-make/`.
- Source↔wasm proof: 44 named node types and 24 fields declared by
  `src/node-types.json`, 44 named and 24 fields in the wired wasm, **zero missing
  and zero extra in both directions**. See `grammars/tree-sitter-make/PIN.md`.
- Grammar conformance: 1,772 symbols / 5,870 relationships / 4 imports over the
  pinned 99-file corpus, 0 unknown node types, 0 unknown fields.
- Corpus differential vs an independent oracle: **recall 1.000000, precision
  1.000000**, 0 missing, 0 spurious, and **2,427 / 2,427 line numbers agreeing**.
- Completeness: 44/44 named types classified, sections **A–H 8/8**.

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

| | |
|---|---|
| `MAKE-G3` | `target: export VAR = value` — 10 lines in 2 of 99 files — is not parsed by tree-sitter-make 1.1.1. 5 variable names are not extracted. **Visible, not silent**: the engine's tree-error collector reports 8 and 2 errors for those files. Patching the grammar was refused: it would trade a clean source↔wasm identity proof for 10 lines in 2 files. |
| `MAKE-G1` | `VPATH = src` is not modelled. 0 corpus occurrences, so there is nothing to design against; the sibling `vpath` directive form *is* recorded, so the two spellings are deliberately asymmetric. |
| `MAKE-G2` | `.RECIPEPREFIX = >` is not modelled. 0 corpus occurrences, which is not the same claim as no risk. |
| `MAKE-G4` | A second grammar limitation: `MAIN_PACKAGES=$$($(GO_CMD) list …)` — a shell command inside an escaped-dollar expansion with a nested reference — is one ERROR node in `vault/Makefile`, so `MAIN_PACKAGES` is not extracted. Pinned in the two M12 corpus gates. |

## Relationships emitted

`contains` 1,742 · `references` 1,971 · `exports` 1,347 · `uses` 805 ·
`imports` 4 · `calls` 1.

Every one of the 5,870 carries **`line_number`**, which is a product field: the
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
| `bun run script/m14/run-fixtures.ts --lang make` | **6/6 pass** |
| `BB_MUTANT_ONLY="make/" bun run script/m14/mutate-analyzer.ts` | **18/18 caught** |
| `bun run script/m14/completeness-inventory.ts --lang make` | **sections A–H 8/8** |
| `bun run script/m14/differential.ts --lang make` | both corpora **100 %** covered, 0 missing, 0 unexplained |
