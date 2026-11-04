# `real-make-analyzer` — GNU Make

Pure-AST analyzer for GNU Make / GNU Make-compatible build files, on the
`tree-sitter-make` grammar (`wasm/tree-sitter-make.wasm`).

Every symbol and relationship is derived from node types, fields and node
positions. **There is no source-text regular expression in this file**, and
`script/m14/no-regex-gate.sh` re-checks that claim (the make analyzer appears
zero times in its census).

- Grammar: `tree-sitter-grammars/tree-sitter-make` @ `70613f3d`, package
  `tree-sitter-make@1.1.1` (MIT), vendored at `grammars/tree-sitter-make/` as a
  **local build from patched upstream source** — 3 measured patches (target-scoped
  `export`, `$$( ... )` shell escape, `.RECIPEPREFIX` + external scanner), adding
  no new node type and no new field, with the pristine build retained for A/B.
  Wired bytes: sha256 `af93a759…`, 177,291 B (see `## Language`).
- Source↔wasm proof: 44 named node types and 24 fields declared by
  `src/node-types.json`, 44 named and 24 fields in the wired wasm, **zero missing
  and zero extra in both directions**. See `grammars/tree-sitter-make/PIN.md`.
- **Current population (M14, 2026-10-31):** 755 admitted / 755 parsed, 0 parse
  failures, 0 degraded, 46,754 relationships over 67 repositories
  (`validation/m14/instruments/make/incoming-declaration.json`); fixtures 11/11.
- Historical pinned-corpus record (M60/M12): 1,781 symbols / 5,880 relationships
  over the 99-file corpus and 1,814 / 6,079 over the 100-file corpus, 0 unknown
  node types and 0 unknown fields in both; 0 files with ERROR/MISSING nodes in
  both. The recorded differential (84/84 facts, precision 1, recall 1) is a
  **historical** result — see `## Differential ground truth` for why it is not a
  claim about the current analyzer.
- Completeness: the spec classifies the 44 declared named types as **32 handled +
  10 correctly silent + 2 open gaps**; since then the analyzer gained one of the
  two open gaps (`VPATH_assignment`) and the grammar gained `.RECIPEPREFIX`, so the
  analyzer-side reading is asserted under `## Known gaps`.

## Language

- Analyzer file: `src/ast/real-makefile-analyzer.ts` (`RealMakefileAnalyzer`)
- Parser: `tree-sitter-make` @ `70613f3d`, package `tree-sitter-make@1.1.1`, vendored at `grammars/tree-sitter-make/` as a **local build from patched upstream source**: 3 measured patches — P1 target-scoped `export`, P2 `$$( ... )` shell escape, P3 `.RECIPEPREFIX` (grammar edits plus an external scanner). None adds a node type or a field: 44 named / 24 fields before and after.
- Wired wasm, measured 2026-11-03: `wasm/tree-sitter-make.wasm`, sha256 `af93a7597fd11dda62f5c4496fff828956c0a78656323785975ab96e3ae900ab`, 177,291 bytes — identical to `validation/m14/grammar-pins.json` → `lanes.make.wired` (generated 2026-11-01). The pre-P3 build (`ca3da9c9…`, 165,855 B) is the digest `PIN.md`'s summary table still shows and is superseded; the pristine upstream build (`e85bd50b…`, 148,909 B) is retained under `grammars/tree-sitter-make/ab/` so the A/B stays re-runnable.
- Source-to-wasm surface: 44 named node types and 24 fields declared by the pinned source, 44 named and 24 fields in the wired wasm, zero missing and zero extra in both directions (`grammars/tree-sitter-make/PIN.md`; surface digests in the pin).
- Language detection: extensions `mk`, `mak`, `makefile`; basenames `makefile`, `gnumakefile`, `.makefile`, `.gnumakefile` (`src/ast/language-detection.ts`). The production router admits by **basename as well as suffix**, so a file literally named `Makefile`, with no extension at all, is this lane's file.
- Wired in: `engine.ts` `getAnalyzer` → `RealMakefileAnalyzer`

## Symbol contract

| Field | Supported? | How extracted |
| --- | --- | --- |
| name | yes | the declaration node's name/word text; the assignment operator attached by the grammar is trimmed by character code. The module symbol is named for the FILE (its basename) |
| kind | yes | exactly three `SymbolKind` values: one `module` per file; `constant` for `variable_assignment` / `shell_assignment` / `VPATH_assignment`, and for a name that only an `export` directive introduces; `function` for a `define_directive` macro and for each non-special `rule` target |
| qualified/container name | no FIELD | the analyzer publishes no `qualifiedName` on a symbol: the container fact is an EDGE, not a name — the file module `contains` every declaration. Make has exactly one declaration level, so there are no dotted qualified names to build |
| ownerName / ownerKind | no FIELD | no symbol carries `ownerName`/`ownerKind` (measured: a symbol's keys are `name, kind, range, visibility, metadata`). Ownership is published as the module's `contains` edge; a reference is attributed to its nearest enclosing declaration as the EDGE SOURCE, never as an owner on the symbol |
| range (start/end line + column) | yes | node positions: `range.startLine / startColumn / endLine / endColumn / startIndex / endIndex` of the declaration node (`nodeToRange`) |
| parameters | no | a Make macro's arguments are `$(1)`-style positional references; they are not modelled as parameters on the signature. `$(call M,a,b)` arguments are recorded as the `calls` edge, not as symbol parameters |
| returnType / type | no | Make is untyped text substitution; variables hold strings, published as `metadata.value` |
| documentation/comments | no | `comment` nodes are not read and no doc comment is attached to a declaration |
| complexity metrics | yes | `metadata.complexity` = declared targets + conditionals (a relative count, not a cost), published with `linesOfCode`, `variableCount`, `targetCount`, `conditionalCount`, `moduleName` and `edgeCount` |
| syntax errors | no | the analyzer never reads `ERROR` or `isMissing` (0 reads in `src/ast/real-makefile-analyzer.ts`) and always returns `errors: []`. ERROR/MISSING are engine-level and counted by the corpus gates, not attached to declarations |
| decorators/attributes | no | Make has no attribute/decorator syntax; a `.PHONY`-style special target is a rule name, and its relation is ruled under `decorates` in the ontology table |

## Relationship ontology

| Relationship type | Emitted? | How resolved | Confidence model |
| --- | --- | --- | --- |
| calls | yes | `$(call M, ...)` names its callee in the `arguments` node's first comma-separated field; the edge is `owner -> macro` and resolves to the `define` the file (or project) declares | 1.0 (extractive); `evidenceClass: call` |
| contains | yes | the file module symbol contains every declaration: targets, variables and macros, plus the names an `export` directive declares | 1.0 (structural); `evidenceClass: declared_in_file` |
| exports | yes | every buildable target is public surface (an including makefile invokes it by name), plus every `export V` directive; `unexport V` retracts both the `exports` edge and the `isExported` flag | 1.0; `evidenceClass: export_target` for a target, `export_directive` for the directive |
| imports | yes | `include`/`-include`/`sinclude` publishes `module -> path`; a computed include records its EXPRESSION rather than being dropped; also published as an `ImportInfo[]` payload channel | 1.0 (structural); `evidenceClass: include_literal` / `include_computed` |
| references | yes | only when THIS file declares the name (a prerequisite naming a declared target of the same file is a reference too); `evidenceClass: reference` | 1.0 |
| uses | yes | everything the file does not declare: prerequisites that are files, external variables, GNU Make builtins, `$@`-family automatics and `$$`-shell variables | 1.0; `evidenceClass` is one of `external`, `builtin`, `external_prerequisite`, `automatic`, `local_binding`, `shell_variable` |
| extends | no | ruled `grammar-absence` in `script/m14/spec/make-completeness.json` (`coverage.excluded`): GNU Make has no type declaration, no base clause and no inheritance — 0 whole-word matches for the vocabulary over the 44 named types + 91 tokens + 24 fields, 0 of the 743 distinct key names in `key-space-census.json`, and 0 edges in 0 files over the 755-file arm | — (ruled absent) |
| implements | no | ruled `grammar-absence` (same block): no interface or conformance construct exists — 0 whole-word matches in the grammar inventory, 0 edges in 0 files over the 755-file arm | — (ruled absent) |
| overrides | yes | `override VAR := v` (an `override_directive`) **re-declares a name the SAME file already declared at another line** — the edge is `module -> name` at the override's line carrying `metadata.role: "redefinition"`, `via: "override_directive"`, `overrideLine`, `baseLine` and `evidenceClass: "redefinition"` (emission at `src/ast/real-makefile-analyzer.ts:863`). A site whose ONLY declaration is the override is REFUSED, because the replaced binding is the command line or the environment, not a symbol in the graph | 1.0 (extractive); measured 5 sites in 4 files → 3 edges in 2 files over the 697-file construct census and 3 edges / 3 resolved over the 755-file arm; pinned by `make/directive-flags` (`OVERRIDDEN` declared L11, overridden L12) |
| instantiates | no | ruled `grammar-absence`: Make has no `new` and no expression that yields a value — a recipe is a shell command; 0 whole-word matches in the grammar inventory, 0 edges in 0 files over the 755-file arm | — (ruled absent) |
| part_of | yes | `include f` splices `f` into the SAME make instance's scope, so a LITERAL include publishes `module -> the included file's module symbol` with `metadata.partRole: "library"`, `partPath` (the written path) and `partSymbol`. The target is symbol-shaped (the file's basename), never the path. A computed include (`include $(shell ...)`, `include $(RULES)`) and a path whose last segment is an expression earn an `imports` row and NO `part_of` | 1.0 (extractive); measured 264 edges, exactly 1:1 with the 264 literal include sites over the 755-file population (278 sites: 264 literal / 14 computed), of which 238 targets name an admitted file and 26 name something absent |
| decorates | no | ruled `ontological`: a special target (`.PHONY`, `.SUFFIXES`, ...) is a RULE NAME with side-effect semantics, not an APPLIED CALLABLE attached to a declaration — measured 1,324 special-target sites in 265 files governing 2,066 name occurrences, 0 applied callables | — (ruled absent) |
| renders | no | ruled `ontological`: Make builds products but declares no renderer, so no declaration names a render target — 0 whole-word matches for the render vocabulary over the whole grammar inventory and 0 shell-spawned render-tool sites over the 755-file population | — (ruled absent) |
| mixes_in | no | ruled `ontological`: `define ... endef` exists (80 sites, 190 call sites) but a macro body is TEXT spliced at expansion, not a member set composed into a super-anything — the census's chain-in-body counter reads 0 | — (ruled absent) |

Every edge this analyzer emits carries a 1-based `line_number` on the name-bearing node (set in `addRel`), and `confidence` is **1.0 for every edge**: the analyzer is extractive, so the `resolved` / `ambiguous` / `unresolved` classes the incoming gate prints are the ARBITER's measurement of an edge, not a confidence the analyzer computes. The 755-file whole-population arm emits **46,754** edges — `references` 17,353 · `contains` 12,037 · `uses` 9,881 · `exports` 5,837 · `imports` 1,202 · `part_of` 264 · `calls` 177 · `overrides` 3 — with `extends`/`implements`/`instantiates`/`decorates`/`renders`/`mixes_in` at 0 (`validation/m14/instruments/make/incoming-declaration.json`).

## Supported constructs

| construct | node type | what it produces |
| --- | --- | --- |
| `VAR := v` | `variable_assignment` | `constant` symbol, operator from node positions |
| `VAR != cmd` | `shell_assignment` | `constant` symbol, operator `!=` |
| `define M ... endef` | `define_directive` | `function` symbol (a macro is callable) |
| `t: p` | `rule` | one `function` symbol per non-special literal target; `contains` + `exports` edges; dependency edges per prerequisite group |
| `$(VAR)` | `variable_reference` | `references` when this file declares it, else `uses` |
| `$(VAR:.c=.o)` | `substitution_reference` | as above (a sibling node, not a child) |
| `$@ $< $^` | `automatic_variable` | `uses`, `evidenceClass: automatic` |
| `$(call M, ...)` | `function_call` | `calls` edge to the macro |
| `include f` | `include_directive` | `imports` edge from the module symbol; a LITERAL path also earns a `part_of` edge to the included file's module symbol (`partRole: library`, `partPath` on the edge) |
| `export V` | `export_directive` | `exports` edge (and a `contains` edge for a name no assignment declares) |
| `unexport V` | `unexport_directive` | retracts the `exports` edge and clears `isExported` on the symbol |
| `override V := x` | `override_directive` | `overrides` edge (`module -> V`, `role: redefinition`, `via: override_directive`, `overrideLine` + `baseLine`) when the file also holds a base declaration of `V` at another line |
| `private V := x` | `private_directive` | the nested assignment is still walked; the symbol gains `isPrivate` |
| `VPATH = src:include` | `VPATH_assignment` | `constant` symbol `VPATH` with `metadata.searchPaths` = the colon-separated value as a list; a reference to `VPATH` then becomes `references`, not `uses` |
| `.RECIPEPREFIX = >` | `RECIPEPREFIX_assignment` | the grammar models the prefix (P3 external scanner) so `>`-prefixed lines parse as `recipe_line`s; the assignment itself publishes no symbol and no edge (a settings annotation, not a buildable) |
| `$(foreach v, ...)` | `function_call` | `v` recorded as a local binder, not a variable |

**The spec's classification of the 44 declared named types** (`script/m14/spec/make-completeness.json`): `handled_verified._perType` carries 33 entries and `internal_silent._perType` carries 10. One handled entry, `endif_directive`, is not a declared node type (the grammar declares `else_directive` and the tokens `else` / `endif`; the analyzer's own comment at `src/ast/real-makefile-analyzer.ts:732` records the case's removal), so the spec's buckets over the 44 declared types are **32 handled + 10 correctly silent + 2 recorded open gaps** (`MAKE-G1` `VPATH_assignment`, `MAKE-G2` `RECIPEPREFIX_assignment`) = 44, plus the two grammar defects `MAKE-G3`/`MAKE-G4` that are FIXED by patches rather than node types. Both open gaps are re-measured under "Known gaps" below, and one of them is contradicted by the analyzer. Fixtures: 11 files in `validation/m14/fixtures/make/`, all passing (measured 2026-11-03).

## Regex inventory

**Zero source-text regular expressions in the analyzer**, measured 2026-11-03: `src/ast/real-makefile-analyzer.ts` contains 0 regex literals, and `bash script/m14/no-regex-gate.sh` passes with the make analyzer appearing **zero times** in its census. The lane's one historical regex literal was found by `script/m12/make-contract-probe.ts` and removed; the contract probe fails on a reintroduced literal. There is no regex doing syntax work: names come from grammar fields and node text positions, never from source scanning.

## Complexity envelope

`validation/m12/results/make-corpus-complexity.json` — pinned 14-file corpus, production path:

| Run | files | symbols | relationships | wall ms | symbols/s | relationships/s | peak RSS |
| --- | --- | --- | --- | --- | --- | --- | --- |
| make-corpus-production | 14 | 630 | 2,490 | 2,341.0 | 269.1 | 1,063.6 | 231.0 MiB |

Declared budget: none in-tree (no M12 budget artifact exists for make); the lane formula measures ms/Knode, and the analyzer's own `metadata.complexity` is a relative count (targets + conditionals), recorded as a count and not a cost. The larger pinned 99-file corpus reports 1,781 symbols / 5,880 relationships; the 100-file corpus 1,814 / 6,079, with throughput recorded per run.

**Current population (M14, 2026-10-31):** the whole gate-admitted population is 755 files over 67 repositories, and one production pass emits 46,754 relationships from it with **0 parse failures and 0 degraded (regex-fallback) files** (`validation/m14/instruments/make/incoming-declaration.json`). That artifact records edge counts, not wall time, so **throughput over the 755-file population is unknown** and is not inferred here from the 14-file run above.

## Differential ground truth

- Ground truth: `validation/m12/ground-truth/make.json` — `truthSource: manual_audit`, source `validation/m12/fixtures/make/{Build.mk,Library.mk,Negative.mk}`, 84 expected facts (symbols + relationships).
- Recorded result: `validation/m12/results/make-differential.json` — `passed: true`, truePositive 84, falsePositive 0, falseNegative 0, unknown 0, precision 1, recall 1.
- **That result is HISTORICAL, not a claim about the analyzer as it stands.** Its true-positive ids were written against an earlier analyzer: they spell the include source `makefile` (`rel:Build.mk:imports:makefile:config.mk`) and a `$(BIN)` function symbol (`symbol:Build.mk:22:function:$(BIN)`), while the current analyzer names the module for the FILE (`module:Build.mk`) and deliberately declares no computed target. Measured 2026-11-03 by running the analyzer on the same fixture. A re-run of the differential over the current analyzer is **owed and not claimed here**.
- Recorded corpus differential (M60 evidence): recall 1.000000, precision 1.000000, 0 missing, 0 spurious, and 2,418 / 2,418 line numbers agreeing over the pinned 99-file corpus (2,515 / 2,515 over the 100-file corpus) — `validation/m60/make/lane-evidence.json`.
- `validation/m12/results/make-contract.json` — 44 / 44 contract checks pass (M12 run).

## Corpus validation

- **Current population (M14, 2026-10-31):** 755 admitted of 755 parsed, **0 parse failures, 0 degraded**, 67 repositories, 46,754 relationships; the admitted set is the git-tracked set under the router's rule (`exts mk/mak/makefile/gnumakefile` plus basename `Makefile`), with 66 tracked-but-absent and 0 over the 1 MiB cap (`validation/m14/instruments/make/incoming-declaration.json`; run `BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/incoming-gate.ts make 0`).
- **Parser-level residual over that population, measured 2026-11-03:** 29 of 755 files carry real ERROR nodes (255 ERROR, 0 MISSING). The analyzer still publishes those files (0 degraded), so the recovery output is included; this is a parser-grammar residual on the wider population and is distinct from the pinned 99-file corpus's 0.
- **Construct censuses over the same 755 files** (`validation/m14/fixtures/make/`): `include` sites 278 (264 literal / 14 computed, 198 files) → `part_of` 264 edges exactly 1:1, wall split 238 admitted / 26 absent; `define` sites 80 (21 files) with 190 call sites; special-target sites 1,324 (265 files) governing 2,066 name occurrences; `overrides` 3 edges (2 files) from 5 sites, 2 sites refused.
- Historical M12 corpus: union of 13 pinned repositories (terraform, tf-aws-components, consul, boundary, luvit, kong, vault, nomad, waypoint, packer, terragrunt, Matrix, torrentinim); six probed repositories contributed no tracked Makefiles and are named as absent rather than silently dropped. `validation/m12/results/make-corpus-errors.json`: 14 tracked files, 0 error files, 0 error nodes, 0 crash files. Wider conformance over the pinned 99/100-file corpora: 1,781 / 5,880 / 4 and 1,814 / 6,079 / 4 — 0 unknown node types, 0 unknown fields in both.
- Fixtures: 11 in `validation/m14/fixtures/make/`, **11 pass / 0 fail** (measured 2026-11-03).

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
not exist. Measured over the pinned corpus, the unresolved edge ends divide as 241
file paths, 183 external variables, 160 builtins, 213 automatic variables and 11
shell variables — and **not one of them is a true dangler**
(`validation/m60/make/lane-evidence.json` → `dangleAdjudication`; the older
out-of-tree path this page used to cite is not in the repository).

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

| gap | node type | status, measured 2026-11-03 |
| --- | --- | --- |
| `MAKE-G1` | `VPATH_assignment` | **CONTRADICTED BY THE ANALYZER; the spec still lists it OPEN.** The analyzer HAS a `case "VPATH_assignment"` at `src/ast/real-makefile-analyzer.ts:693`: it declares a `constant` symbol `VPATH` whose `metadata.searchPaths` is the colon-separated value as a list, so a reference to `VPATH` becomes a `references` edge instead of a `uses`. Run measured on the fixture: `constant:VPATH paths=["src","include","vendor"]`; pinned by `make/vpath-assignment`. The construct also occurs in the CURRENT population — 2 of the 755 admitted files carry a `VPATH =` assignment (`otp/lib/diameter/src/Makefile`, `docker/vendor/github.com/Microsoft/hcsshim/Makefile`), and the otp file's run publishes the symbol. The spec's `gap` entry ("not modelled") and the absence of the type from `handled_verified._perType` are stale, and its `corpus.files: 99` is not the population this page measures. |
| `MAKE-G2` | `RECIPEPREFIX_assignment` | **Grammar-modelled, analyzer-unpublished.** P3 (grammar edits plus an external scanner) makes `.RECIPEPREFIX = >` lex `>`-prefixed lines as `recipe_line`s: the fixture `make/recipeprefix` parses with **0 ERROR / 0 MISSING nodes** and the analyzer publishes its targets (`build`, `clean`) and their recipe edges. The ASSIGNMENT itself still produces no symbol and no edge (there is no `case "RECIPEPREFIX_assignment"`), because it is a settings annotation rather than a buildable declaration. The spec's description ("recipe lines using a non-default prefix are not recognized") is stale; its status (the node type is not published) is accurate. Occurrences: 0 of the 755 admitted files set `.RECIPEPREFIX` (measured 2026-11-03). |

The two **grammar** gaps that used to sit here are closed. `MAKE-G3`
(`target: export VAR = value`) and `MAKE-G4` (`$$($(GO_CMD) list …)` — a shell
command inside an escaped-dollar expansion) were recorded as deliberately
unpatched, to protect the source↔wasm identity proof. That trade was then
measured rather than assumed, and it does not hold: the patches add **no node
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

**Current population (M14, 755 files, 2026-10-31)** — `validation/m14/instruments/make/incoming-declaration.json`:
`references` 17,353 · `contains` 12,037 · `uses` 9,881 · `exports` 5,837 ·
`imports` 1,202 · **`part_of` 264** · `calls` 177 · **`overrides` 3**; total
**46,754**. Ruled as absent (0 edges in 0 files): `extends`, `implements`,
`instantiates`, `decorates`, `renders`, `mixes_in`.

Every edge carries a 1-based **`line_number`** on the name-bearing node — set in
`addRel` for every edge, so a stored relationship can be navigated TO. The
product history is worth keeping: the lane once shipped with **0 of 1,784**
`contains` edges carrying a line number, which is why the field is asserted for
all 46,754 today.

Historical pinned-corpus split (M60, 99 files): `contains` 1,752 · `references`
1,976 · `exports` 1,357 · `uses` 790 · `imports` 4 · `calls` 1 (the 100-file run
adds `contains` 1,784 · `references` 2,114 · `exports` 1,381 · `uses` 795 ·
`imports` 4 · `calls` 1). `overrides` was declared `corpusUnexercised` at that
time and was later MEASURED to fire — the row above is that correction.

## Gates

| gate | result |
|---|---|
| `bun run script/m14/verify-grammar-pins.ts` | make registered; wired sha256 `af93a759…` / 177,291 B matches the file on disk and the pin; surface 44 named / 24 fields, source↔wasm exact |
| `bun run script/m14/run-fixtures.ts --lang make` | **11/11 pass, 0 fail** (measured 2026-11-03) |
| `npx tsx script/m14/verify-doc-truth-emissions.ts` | **0 FALSE_NEGATIVE / 0 FALSE_POSITIVE for `makefile`** (measured 2026-11-03, after the `overrides` correction recorded here). The gate's exit code is fleet-wide and reflects other lanes' rows |
| `npx tsx script/m14/verify-analyzer-docs.ts --lang makefile` | 8/8 required sections, 0 ontology gaps |
| `bash script/m14/no-regex-gate.sh` | passed; the make analyzer appears zero times |
| `bun run script/m14/audit-analyzer-grammar.ts` | 0 unknown node types, 0 unknown fields (M14 run) |
| `bun run script/m12/make-contract-probe.ts` | **44/44 pass** — and it is the gate that found the analyzer's one regex literal, a dead `endif_directive` branch, and the computed-target prerequisite loss (405 edges) |
| `bun run script/m12/make-node-types-compare.ts` | **passed** — 35 live node-type references, **0 phantom** |
| `bun run script/m12/make-corpus-errors.ts` | **passed** — 14/14 files clean, 0 error files, 0 crashes; grammar residual pinned |
| `bun run script/m12/make-corpus-measure.ts` | **passed** — 622 symbols / 2,480 relationships (M12 run; the later `make-corpus-complexity.json` run is 630 / 2,490) |
| `BB_MUTANT_ONLY="make/" bun run script/m14/mutate-analyzer.ts` | **21/21 caught** (M60 run) |
| `BB_MUTANT_ONLY="make/" bun run script/m14/mutate-analyzer.ts` | **24/24 caught** (M12 run) |
| `bun run script/m14/completeness-inventory.ts --lang make` | **sections A–H 8/8** |
| `bun run script/m14/differential.ts --lang make` | both corpora **100 %** covered, 0 missing, 0 unexplained (M60 run; the M12 differential artifact is historical — see `## Differential ground truth`) |

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
