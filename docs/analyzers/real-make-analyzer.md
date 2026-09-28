# Make analyzer

## Language

- Analyzer: `src/ast/real-makefile-analyzer.ts`
- Parser: vendored `wasm/tree-sitter-make.wasm` (tree-sitter-make@1.1.1), loaded as `tree-sitter-make`
- Detection: `Makefile`, `GNUmakefile`, `makefile`, `.mk`, `.mak` → `make` in
  `src/ast/language-detection.ts`
- Wiring: `ASTEngine` → `RealMakefileAnalyzer`

## Symbol contract

| Construct | Symbol kind | AST source | Identity |
| --- | --- | --- | --- |
| `VAR := value` / `=` / `?=` / `+=` / `::=` | `constant` | `variable_assignment` | variable name |
| `VAR != shell-command` | `constant` | `shell_assignment` | variable name |
| `define VAR ... endef` | `constant` | `define_directive` | variable name |
| `export VAR := value` / `override VAR += ...` | `constant` | `export_directive`/`override_directive` → `variable_assignment` | variable name |
| rule target (literal or `$(VAR)`) | `function` | `rule` → `targets` | target word text |
| pattern target (`%.o`) | `function` | `rule` → `targets` | target word text |

Every emitted symbol carries an AST-derived 1-based line range. Special
targets (`.PHONY`, `.DEFAULT`, `.SUFFIXES`, `.NOTPARALLEL`, ...) are
meta-directives, not buildable objects, and are excluded — the M11 contract
`.PHONY and include directives excluded as meta-directives` is preserved.

## Relationship ontology

- `uses`: rule target → each prerequisite (`targets`-owned `prerequisites`
  nodes, one per `|`-separated group so order-only prereqs resolve).
- `uses`: rule target → every `$(VAR)` referenced in its targets, prereqs, or
  recipe.
- `uses`: variable → every `$(OTHER)` referenced in its value.
- `calls`: rule/variable → callee of `$(call NAME, args...)`.
- `imports`: `makefile` → included file for `include`, `-include`, `sinclude`
  (also emitted as `ImportInfo` rows with line numbers).

Builtin functions (`wildcard`, `shell`, `strip`, `subst`, `eval`, ...) are
not symbols and not call targets; `automatic_variable` (`$@`, `$<`, `$^`,
`$(@D)`) and positional arguments (`$(1)`, `$(2)`) are skipped.

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

## Supported constructs

- Variables: all assignment operators, `define`/`endef`, shell assignments,
  `export`, `override`, `unexport`, `undefine` (declaration-bearing forms
  only — `unexport`/`undefine` emit no symbols, they remove definitions).
- Rules: explicit, variable-reference targets (`$(BIN):`), pattern rules
  (`%.o: %.c`), order-only prereqs (`| builddir`), recipes.
- Conditionals: `ifdef`/`ifndef`/`ifeq`/`ifneq` with `else`/`else ifeq`
  chains.
- Includes: `include`, `-include`, `sinclude`.
- Functions: `$(call NAME, args)` calls; `$(VAR)` uses; builtin functions
  skipped.

## Unsupported / explicit boundaries

- `$(eval $(call ...))` chains: the inner call is resolved (the walker
  descends through `arguments`), but the generated rules inside `define`
  bodies are template text, not parsed rules.
- Automatic variables and `$(1)`-style positional args produce no symbols.

## Regex inventory

Zero regex literals and zero `RegExp` calls. The assignment operator and
function-call names are derived from node positions (`name.endIndex` to
`value.startIndex`; text between `$(` and the `arguments` node), and
all-digit checks walk character codes. The machine-checked census is
`validation/m12/results/regex-census.json` (make: 1 → 0).

## Complexity envelope

Measured in `validation/m12/results/make-corpus-complexity.json`:
one production `parseFile` pass per acceptance file; single iterative DFS
over the tree with O(1) Map-backed symbol dedupe (`name:kind`) and
Set-backed relationship dedupe — O(nodes + emitted facts), no per-symbol
O(n) scans. Corpus: the union of every tracked Makefile across six pinned
clean repos (elixir@024beb1, cabal@670955a, luarocks@665f160,
terraform@2e1710b, cython@51a460b, tree-sitter-clean@58729d3) — the make
ecosystem has no single representative repository.

## Verification

- Differential: `validation/m12/results/make-differential.json` — 84 facts,
  precision/recall 1.000, 0 FP/FN/unknown.
- Contract: `validation/m12/results/make-contract.json` — 34/34.
- Shape: `validation/m12/results/make-shape-safety.json` — 34 referenced
  node types, 34 live, 0 dead, 36 observed.
- Corpus: `validation/m12/results/make-corpus-errors.json` — 7/7 clean,
  0 errors, 0 crashes.
