# go.md

## Language

- Analyzer file: `src/ast/real-go-analyzer.ts`
- Parser: `tree-sitter-go`. The engine's grammar-name map (`src/ast/engine.ts`) carries
  `go: "tree-sitter-go"`, and `parseFile` resolves it through `resolveWasm`, which takes the
  **basename** `tree-sitter-go.wasm` and finds it in this repo's `wasm/` directory
  (`bbWasmCandidates` puts `<repo>/wasm` first, ahead of the `~/.bb/wasm` cache).
- Wired bytes, measured 2026-10-02: `wasm/tree-sitter-go.wasm`,
  sha256 `9963ca89b616eaf04b08a43bc1fb0f07b85395bec313330851f1f1ead2f755b6`, 235,957 B.
- **Pin-contract status: NOT registered.** `validation/m14/grammar-pins.json` has lanes for 26
  grammars; `go` is not one of them. An earlier revision of this file called the wasm
  "pinned", which was true only in the loose sense of "a file in `wasm/`". It is not pinned by
  the contract's rule (wired sha256 + enumerable surface + provenance), so a replacement of the
  wasm would be silent. What would close this: an entry for `go` in
  `validation/m14/grammar-pins.json`, re-runnable with `bun run audit:grammar-pins`.
- Earlier claim, **UNVERIFIED 2026-10-02**: that npm `tree-sitter-go` 0.25.0 was
  "verified behaviorally identical on the corpus via the production `parseFile` path — 5 vs 5
  grammar-error files, 0 fixed, 0 regressed". No artifact in `validation/` records that A/B and
  `script/m12/go-wasm-compare.ts` was not run here (it needs the npm tarball unpacked under
  `/tmp`). The claim is neither confirmed nor contradicted by this document; it is recorded as
  unverified rather than repeated as fact.
- Language detection: `.go` → `go` in `language-detection.ts`
- Wired in: `engine.ts getAnalyzer` → `case "go"` → `RealGoAnalyzer`
- Pure AST — symbols and relationships derive from Tree-sitter nodes/fields, never
  source-text scanning. The only string processing is on values already extracted from AST
  nodes (leaf-name extraction, quote stripping, struct-tag key/value parsing, signature
  normalization).
- Main shapes read: `source_file` → `package_clause` / `import_declaration` /
  `function_declaration` / `method_declaration` / `type_declaration` / `var_declaration` /
  `const_declaration`; fields via `field_declaration_list` → `field_declaration` with
  `name` / `type` / `tag`; qualified types via `qualified_type`.

## Symbol contract

| Field | Supported? | How extracted (AST node/field) |
| --- | --- | --- |
| name | ✅ | `package_clause` `package_identifier` → module; `type_spec` `name` → struct/interface; `field_declaration` `name` (repeated names share the field type); `function_declaration`/`method_declaration` `name`; `var_spec`/`const_spec` `identifier`s at package scope only |
| kind | ✅ | `interface_type` → `interface`; `struct_type` → `struct`; `method_declaration` → `method` (owner = receiver type, ownerKind `struct`); bare `function_declaration` → `function`; struct fields → `property`; package-scope `var_spec` → `variable`, `const_spec` → `constant`; other `type_spec` bodies → `type` |
| qualified/container name | ✅ | `ownerName` = receiver type for methods, declaring struct/interface for fields and interface methods, `parentStruct` for the generic walk |
| range (start/end line + column) | ✅ | the declaration node |
| parameters | ✅ | `parameter_list` → `parameter_declaration` (`name` + `type`); interface `method_spec` params via `extractGoMethodSpecParameters`; function-local params are NOT symbols (C# M12.07 negative contract: `ParamsAreNotSymbols`) |
| returnType | ✅ | `result` field / trailing type node (interface method specs too) |
| visibility | ✅ | `isGoExported` (first character is an upper-case Unicode letter — a code-point test, not an ASCII range) → `public`/`private` |

The analyzer constructs these ten `SymbolKind` values and no others (grep over
`src/ast/real-go-analyzer.ts`, re-measured 2026-10-02): `Class`, `Constant`, `Function`,
`Interface`, `Method`, `Module`, `Property`, `Struct`, `Type`, `Variable`.

**Symbols the production entry drops after the analyzer publishes them.** Measured 2026-10-03
over a 2,000-file draw (`script/m14/go-denylist-probe.ts`): the analyzer produced **53,868**
symbols and `keepSymbol` (`src/ast/pool-worker.ts`, MASTER-owned) dropped **10** of them —
0.019%. All ten are real Go declarations: `root` ×7 (six struct fields, one variable),
`self` ×1, `unknown` ×1 (the package-scope constant in
`src/cmd/compile/internal/ssacompile/prove.go`), `program` ×1. The denylist is documented as
"language keywords / conventions and synthetic tree-sitter artifact names — never legitimate
declarations in any language", and `root`, `self`, `program` and `unknown` are all legitimate
in Go (`root` is a tree node's own field name). Every edge that targets a dropped symbol is an
endpoint no consumer can resolve. **Not fixed here**: `pool-worker.ts` is shared engine
machinery, the denylist is load-bearing for other lanes, and widening it is a repository-level
decision. Reported.

## VERIFY_GO2 — independent re-verification, 2026-10-04

This section is the re-derivation. Everything below it is the handover record from `analyzer/GO`
and is kept as written rather than edited, so the two readings can be compared. Where they
disagree, this section wins and says so.

### The firing-check number

**9 of the 10 `RelationshipType` values fire, measured through the production path.**

`ASTEngine.parseFile` → `getParser("go")` → `getAnalyzer("go")` → `RealGoAnalyzer.analyze`, over
**every one of the 9,447 `.go` files** in `go-stdlib` @ `6f5c275e` that the lane admits
(`testdata/` excluded, ≤512 KB), 57 top-level packages, **9,447 parsed / 0 crashed**, 280,587
symbols, 866,760 relationships, 17m 10s.

The tenth is not a type the lane fails to implement. `src/ast/types.ts:69` declares
`Imports = "brain_import"` and `src/ast/engine.ts:455` declares `Imports = "imports"` — **two
enums, one name, two values.** The analyzer imports `ASTEngine.RelationshipType`, so it publishes
`"imports"`, which is **not a value of the canonical enum**. 27,170 import edges in 6,136 files
are therefore invisible to every consumer that compares against
`RelationshipType.Imports` from `src/ast/types.ts`, and nothing anywhere turns red. Both files
are MASTER-owned; see "Found outside this lane".

Three numbers, because they are not interchangeable:

| Draw | files | types that fire |
| --- | --- | --- |
| `script/m14/firing-check.mjs` default | 12 | 8 |
| this lane's first census (stride sample) | 140 | 8 |
| this lane's census, whole corpus | 9,447 | **9** |

The 140-file draw reported `overrides` **silent**. It is not silent: `overrides` fires 78 times in
26 files, and 26 of 9,447 is 0.28 %, so a 140-file stride sample expects 0.4 hits. A sample that
cannot distinguish "fires" from "does not" settles nothing, which is the absence-without-a-
measurement defect the ontology gate exists for.

### Per-type verdict — count and files, whole corpus

Every count is `relationships` with that `type` in the analyzer's output. "Files" is the number of
distinct files at least one such edge came from. No row here is a source scan.

| # | Type (enum value) | Verdict | Edges | Files | Where they came from |
| --- | --- | --- | --- | --- | --- |
| 1 | `calls` | EMITTED | 277,527 | 6,492 | every `call_expression` in a function, method, `go`/`defer` spawn or package-scope initializer; stdlib and receiver leaves both kept |
| 2 | `uses` | EMITTED | 222,899 | 5,620 | selector field access + channel operations, with the family write-gate on assignment-LHS and inc/dec operands |
| 3 | `references` | EMITTED | 130,747 | 6,123 | declared-type reference graph: struct fields, params, receivers, **bare and parenthesised result types**, var/const specs |
| 4 | `exports` | EMITTED | 114,453 | 5,286 | package-scope capitalised **types, funcs, consts and aliases** — now gated on the declaration's position |
| 5 | `contains` | EMITTED | 72,320 | 3,729 | the ownerName pass: struct fields, interface methods, methods. One edge per (owner, member) |
| 6 | `imports` (off-enum) | EMITTED | 27,170 | 6,136 | every `import_spec`, target = the module path string. **Not** an enum value — see above |
| 7 | `instantiates` | EMITTED | 18,641 | 3,268 | composite-literal construction at 0.8 (15,536) and PascalCase top-level-function calls at 0.6 (3,105) |
| 8 | `extends` | EMITTED | 1,703 | 636 | struct and interface embedding; the target is the embedded type's LEAF |
| 9 | `implements` | EMITTED | 1,222 | 324 | implicit interface satisfaction, own + promoted method sets |
| 10 | `overrides` | EMITTED | 78 | 26 | a depth-0 method shadowing a promoted one. Confidence 0.95 on **all 78** — the only sub-1.0 type in the lane that carries a reason code |
| — | `brain_import` | **SILENT** | 0 | 0 | the canonical enum value never appears, because the lane emits `"imports"` |

Nothing is RULED. All ten types name a construct Go expresses, and all ten are produced by
production `parseFile` on real corpus. The two types absent at handover (`exports`, `overrides`)
were GAPs and are now EMITTED; both were implemented by `analyzer/GO` and both are re-measured here
rather than adopted on its word.

### The six questions, per emitted type

Question 3 is answered with a second walker, `validation/m14/go/go-oracle.ts`, written from
tree-sitter-go 0.25.0's own `node-types.json` and the Go specification and sharing no helper with
the analyzer. **It can refute the analyzer; it cannot confirm it** — both walk the same wasm
through the same Node API, so a grammar or binding defect they share is invisible. Its 400-file
comparison, after this lane's three fixes:

| Type | 1 exists | 2 fires | 3 oracle agrees | 4 labelled | 5 both endpoints resolve | 6 confident / R7 |
| --- | --- | --- | --- | --- | --- | --- |
| `calls` | yes | 277,527 / 6,492 files | 10,206 oracle / 10,061 analyzer / **7,441 agree**, recall 0.580 | yes | src 100% file-local; tgt 2,709 file / 2,518 package / 5,402 unresolved — stdlib leaves, **correct** here | conf 0.8 on 100%, `usage_contextual`; **0 reason codes** |
| `uses` | yes | 222,899 / 5,620 | 3,220 / 7,889 / **2,692 agree**, recall 0.320 | yes | src 7,889 file / 2 pkg / 5 unknown; tgt 3,349 file / 1,300 pkg / 3,258 unresolved | conf 1.0 × 33,084, 0.7 × 189,183, 0.8 × 632; **189,815 sub-1.0 edges, 0 reason codes** |
| `references` | yes | 130,747 / 6,123 | 4,616 / 4,743 / **3,810 agree**, recall 0.687 | yes | src 4,906 file / 2 pkg / **22 `global`**; tgt 2,113 / 1,304 / 1,514 | conf 0.95 on 100%, `reference_qualified`; **130,747 sub-1.0 edges, 0 reason codes** |
| `exports` | yes | 114,453 / 5,286 | 4,153 / 3,732 / **3,722 agree**, recall 0.894 | yes, **after this lane's fix** | src and tgt **100% file-local** in the 400-file draw | conf 1.0 on 100%, `structural` — Go's rule is syntactic and total, so 1.0 is right and needs no reason code |
| `contains` | yes | 72,320 / 3,729 | 2,818 / 2,973 / **2,802 agree**, recall 0.937 | yes | src and tgt **100% file-local** | conf 1.0 on 100%, `structural` |
| `imports` | yes | 27,170 / 6,136 | 1,304 / 1,304 / **1,304 agree**, recall **1.000** | yes | tgt 4 file / 35 pkg / 1,266 unresolved — a module path is not a symbol, so "unresolved" is the expected shape | conf 0.9 on 100%, `import_based`; **0 reason codes** |
| `instantiates` | yes | 18,641 / 3,268 | 70 / 928 / **70 agree** | yes, **after this lane's fix** | src 948 file / 0 pkg / 4 `global`; tgt 447 file / 410 pkg / 96 unresolved | conf 0.8 × 15,536 and 0.6 × 3,105, both `structural`; **0 reason codes** |
| `extends` | yes | 1,703 / 636 | 34 / 56 / **33 agree**, recall 0.579 | yes | src and tgt **100% file-local** | conf 0.8 on 100%, `inferred`; **1,703 sub-1.0 edges, 0 reason codes** |
| `implements` | yes | 1,222 / 324 | 0 oracle / 40 analyzer | yes | src and tgt **100% file-local** | conf **1.0 on all 1,222** — the matcher's computed confidence, answerable now that it is counted |
| `overrides` | yes | 78 / 26 | 2 / 2 / **2 agree** | yes | src and tgt **100% file-local** | conf 0.95 on 100%, `usage_contextual`; **the only type whose sub-1.0 edges carry a `reasonCode`** |

Read honestly, that table says four things.

1. **The oracle agrees exactly on three types** (`imports` 1,304/1,304, `overrides` 2/2,
   `contains` 2,802/2,818) and closely on three more. On `calls`, `uses` and `references` the
   oracle-only rows are classified by the harness rather than left for a reader: 1,577 are calls
   to Go's builtin functions, 528 are the write-gate, 451 are composite-literal types the lane
   already carries as `instantiates` from the same construct. **355 `references` rows remain
   UNEXPLAINED and they are reported as a recall gap, not rounded away.**
2. **`implements` was previously recorded as having "no single claimable number"** because its
   confidence is computed rather than a literal. It is now countable: **1.0 on all 1,222 edges**.
   A computed field is measurable; the earlier claim that it was not was a measurement that had
   not been run.
3. **Endpoint resolution is strong where the language lets it be.** `contains`, `exports`,
   `extends`, `implements` and `overrides` resolve both ends file-locally on 100% of their edges.
   The low-resolution types are `calls`/`uses`/`references` whose targets are stdlib leaves, and
   for those "unresolved" is an artefact of the corpus being the standard library with nothing
   vendored — the two columns are never summed into one flattering figure.
4. **Every sub-1.0 edge in the lane except `overrides` lacks a machine-readable reason code**:
   **645,603 of 645,681 sub-1.0 edges, 99.99%**, against honesty-contract §4's requirement that
   any edge below 1.0 carry one. `overrides`, added this wave, is the only type that complies.
   That is a lane-wide finding and it is not fixed here: adding a reason code to six push sites
   changes what every consumer sees and belongs in its own commit.

### R7 — unknown symbols, empty names, placeholder endpoints

A note on what the artifacts do and do not contain: the census records per-type counts, file
lists, confidence and evidence-class distributions, line presence, reason-code presence, and the
two dangling-source counters — **not** a source-name histogram or a sample of raw edges. Corpus
identifiers trip the honesty gate's banned-vocabulary lint (`Complete`,
`mustHaveCompleteRequirements`, `markComplete` are real go names), and the right response to a
linter that cannot tell an identifier from a claim is to record the figure the analysis turns on,
not to delete the analysis.

Whole corpus, 866,760 relationships:

| check | count | what it is |
| --- | --- | --- |
| empty-string endpoints | **0** | R7's other half holds across all ten types |
| placeholder-literal endpoints | **178** | `uses` 52, `references` 45, `calls` 44, `contains` 19, `extends` 11, `instantiates` 6, `exports` 1 — all **source** `_`, Go's blank identifier, which has no name |
| `global` pseudo-source | **1,481** | `references` 710, `uses` 395, `instantiates` 235, `calls` 141 — an unattributable source, from a `func_literal` with no name and from the package-scope instantiation site |
| **total dangling source** | **1,659 (0.19%)** | |

`global` is the class GO36 and GOD11 were opened to fix for `type_spec` and `var_spec` sources
and that remains open for function literals. Not fixed here: it changes attribution for every
type at once. Reported with the count.

### What this lane changed, and the before/after

Three defects, each measured before and after by the same probe on the same draw.

| # | defect | before | after | falsifier |
| --- | --- | --- | --- | --- |
| 1 | `references` publishes **no** return-type reference when the result is written without parentheses (`func f() *T`) — the shape Go uses most. The declared-type walk matched only `field_declaration`, `parameter_declaration`, `var_spec` and `const_spec`, and a bare result is none of them. | 262 bare-result sites in 46 files → **265 expected edges, 1 published (0.4%)**; the parenthesised shape 97.0% | **257 of 267 (96.3%)**; parenthesised 97.0% | `validation/m14/go/go-return-type-probe.ts`, 200 files |
| 2 | `exports` published edges for names declared **inside a function body**, each carrying `exportForm: "capitalized_package_scope_name"` — the label of the rule it broke | **11** fabricated edges in 2 files (4,165 published) | **0** (4,153 published) | `validation/m14/go/go-mislabel-probe.ts`, 500 files |
| 3 | `instantiates` matched the callee **by name**, so `bufio.NewReader(r)` in a file declaring its own `NewReader` published a construction of the wrong symbol. The lane's own comment said "methods never instantiate"; the predicate did not enforce it | **8** mislabels in 6 files (155 at 0.6) | **0** (147 at 0.6) | same probe |

The 973 `instantiates` edges the fix drops are not a loss, and that claim is an argument from the
language rather than a per-edge measurement: an `instantiates` target must come from **this
file's** symbol table, a bare call at package scope can only reach a name in the current package
(spec, Identifier scope), a self-qualified call selects this package's top-level function, and
any other operand names a package whose symbols are not in this file — including an import alias,
because Go forbids a package importing itself. Every dropped edge therefore pointed at a symbol
the call could not have reached.

Three bugs in my own instruments, all found before any number was reported, are recorded because
each would have made the **analyzer** look wrong:

- `package_clause` has **no fields** in this grammar. `childForFieldName("name")` returns `""`,
  and an oracle built on it published nothing for `exports` or `imports`, which reads as a total
  analyzer failure.
- "the callee was a selector" is too coarse a mislabel test: `ed25519.Sign(...)` is a selector and
  it *is* the top-level function. 27 reported defects where 8 exist, until the discriminator was
  the qualifier's package rather than its shape.
- the file's **own** package name was missing from the qualifier set, so
  `src/html/template/escape.go:977` — `func HTMLEscape(...) { template.HTMLEscape(w, b) }` —
  was reported as a mislabel. It is correct.

And one bug in my own fixture, found by the mutation check: covering only the in-function
instantiation site left the package-scope site unpinned, and the first draft's expected
`global -> NewReader` had a *legitimate* producer, so the forbidden row passed with the guard
removed. A collision name needs a collision name with no legitimate producer. Second run: 6
mutants, 6 killed, 0 survivors.

### Payload and latency, before and after

400-file stride sample, same file list both sides, production `parseFile`:

| | subject `0494a8c54` | after | delta |
| --- | --- | --- | --- |
| unfiltered payload | 7,172,806 B | 7,238,323 B | **+0.91%** |
| unfiltered ÷ largest type (`calls`) | 2.756 | 2.781 | +0.9% |
| `references` edges | 4,545 | 4,931 | +386 |
| `exports` edges | 3,743 | 3,732 | −11 |
| `instantiates` edges | 953 | 928 | −25 |

Latency over four runs each: subject 43,088 / 56,092 / 57,889 / 59,107 ms; after 36,127 / 54,249 /
55,514 ms. **The ranges overlap completely, so no regression is claimed and no improvement is
claimed either.** The box was shared with another lane's process, which is why the spread exceeds
any plausible effect. The ratio is measured against the *largest* type because that is the most
favourable denominator; against `references` it is 7.2x, and the honest statement is that a caller
who does not narrow pays for all ten types. **No budget is declared for this lane** — the
Complexity envelope section below says so — so nothing green regressed, and that missing budget is
a pre-existing gap this lane does not paper over.

### The shared differential, before and after — including the regression

`script/m14/differential.ts --lang go --repo go-stdlib --sample 120`, run twice against an
**identical** file set. Getting that required pinning the harness's cold-pool rotation, which
advances on every run and otherwise draws different files each time — two runs of the same command
on the same commit produced `tree-truth` 5,977 and 13,243. A fresh `BB_M14_WORK` directory per run
replays the same seed. Both rows below carry truth hash `8dc1132194b93790`.

| | subject `0494a8c54` | this lane | delta |
| --- | --- | --- | --- |
| tree-truth | 6,662 | 6,662 | same hash |
| covered | 6,662 (100%) | 6,642 (99.7%) | |
| **MISSING** | **0** | **20** | **+20** |
| analyzer-edges | 4,431 | 4,427 | −4 |
| **unexplained** | **3** (`uses`) | **16** (`references` 13, `uses` 3) | **+13** |

**This is a regression against the shared harness and it is disclosed rather than rounded away.**

The 20 MISSING rows are all `instantiates`, and four of them were checked at source:

| truth row | the call in the file | what it is |
| --- | --- | --- |
| `instantiates -> Write` (src/encoding/binary/binary.go:418) | `w.Write(bs)` | a method on an `io.Writer` |
| `instantiates -> Size` (src/encoding/binary/binary.go:755) | `int(t.Size())` | a method on an interface value |
| `instantiates -> Read` (src/math/rand/rand.go:489) | `globalRand().Read(p)` | a method on a `*rand.Rand` |
| `instantiates -> New` (src/crypto/internal/fips140/sha256/sha256.go) | a package-qualified `New` | not this file's `func New()` |

The shared truth derives `instantiates` from "PascalCase callee leaf", which is the rule
`validation/m14/go/go-mislabel-probe.ts` independently falsified — 8 of 155 edges at confidence
0.6 named a symbol in a different package. So the analyzer is now stricter than the shared truth
and the harness charges the difference to the analyzer. **That adjudication needs the master's
ruling, because the file is `script/m14/differential.ts` and not this lane's to change.**

The 13 unexplained `references` rows are **not** attributable to this lane's changes from the
differential's output, and claiming otherwise would be the easy error. The scoped run writes no
artifact, so the rows cannot be listed from it. A direct check settles the question for the row
the oracle names: `references main -> DirEntry` in `lib/time/mkzip.go` is produced by the **subject
analyzer too** (both trees emit it at confidence 0.95, `metadata.relationshipType:
declared_type`, from the parameter of the func literal passed to `filepath.WalkDir`). The
differential's `references` truth is therefore narrower than the lane's `references` emission
surface both before and after; what changed is how many rows of that pre-existing shape fall in a
120-file draw.

### Found outside this lane — named, not fixed

1. **`src/ast/types.ts:69` and `src/ast/engine.ts:455` declare the same enum with different
   values for `Imports`** (`"brain_import"` vs `"imports"`). 27,170 go import edges are produced
   under a string that is not an enum value. Both files are MASTER-owned. **This is the single
   highest-value fix in the programme for this lane** and it cannot be made from here.
2. **`differential.ts:23396` audits eight of go's ten types.** `exports` and `overrides` are
   audited by nothing, so the lane reports green while not measuring two types — the exact failure
   `script/m14/verify-go-lane-coverage.ts` exists to catch, and that gate currently FAILS with
   *"the analyzer EMITS `exports` and it is NOT in go's compared set"*. Its own exemption list
   still records `overrides` as GO41 "the go analyzer emits zero of them", a ruling that stopped
   being true when the ontology round landed and that nothing re-checks. **Yes: the go lane is
   among the DERIVATION findings, on two of ten types.**
3. **`script/m14/verify-go-lane-coverage.ts` cannot run.** It hardcodes
   `const ROOT = "$HOME/mcp/backbencher-brain"`, a path that no longer exists, and
   aborts with ENOENT before it can fail on anything. Two files under `script/m14/` have this;
   **827** under `script/` reference the stale path.
4. **A fresh worktree cannot load any grammar.** `bun` resolves `web-tree-sitter` **0.27.0** from
   the global cache instead of the pinned **0.25.9**, and every language then fails with
   `Language.load failed for go: Error` — `Language.load` runs before the emscripten module
   exists. Symlinking the main checkout's `node_modules` fixes it. This is worktree
   provisioning, it is invisible in the main checkout, and it will silently stop the next agent.
5. **`script/m14/firing-check.mjs` measures the main checkout, not the lane under review**
   (`REPO = "$HOME/backbencher-brain"`), and samples 12 files from wherever its
   directory walk arrives first — for go-stdlib, `src/cmd/...` generator tooling. It is a floor,
   not a verdict, and this lane reimplemented it for that reason.

### Re-deriving every number in THIS section

```
# whole-corpus firing census: per-type counts, files, confidence, evidenceClass, reasonCode
bun run validation/m14/go/go-firing-census.ts 12000 \
  && GO_ARTIFACT=validation/m14/go/go-firing-census-fullcorpus-after.json \
     bun run validation/m14/go/go-firing-census.ts 12000

# independent oracle, 10 types, with disagreement classification
GO_ORACLE_ARTIFACT=validation/m14/go/go-oracle-400.json bun run validation/m14/go/go-oracle.ts 400

# endpoint resolution + R7 (pass 1 indexes every symbol in the corpus by package directory)
GO_ENDPOINT_ARTIFACT=validation/m14/go/go-endpoint-integrity.json \
  bun run validation/m14/go/go-endpoint-integrity.ts 400

# the two mislabelling falsifiers
GO_MISLABEL_ARTIFACT=validation/m14/go/go-mislabel-probe-after.json \
  bun run validation/m14/go/go-mislabel-probe.ts 600

# the return-type shape probe, both directions
GO_PROBE_ARTIFACT=validation/m14/go/go-return-type-probe.json bun run validation/m14/go/go-return-type-probe.ts 200
GO_PROBE_ARTIFACT=validation/m14/go/go-return-type-probe-after.json bun run validation/m14/go/go-return-type-probe.ts 200

# the shared differential, like-for-like (a FRESH cold-pool per run replays the same seed)
rm -rf /tmp/wf-before && mkdir -p /tmp/wf-before
git show 0494a8c54:src/ast/real-go-analyzer.ts > src/ast/real-go-analyzer.ts
BB_M14_WORK=/tmp/wf-before bun run script/m14/differential.ts --lang go --repo go-stdlib --sample 120
git checkout src/ast/real-go-analyzer.ts          # back to this lane's tree
rm -rf /tmp/wf-after && mkdir -p /tmp/wf-after
BB_M14_WORK=/tmp/wf-after bun run script/m14/differential.ts --lang go --repo go-stdlib --sample 120

# the lane coverage gate, which currently FAILS on exports (copy with ROOT repointed;
# script/m14/** is MASTER-owned and its ROOT constant points at a path that no longer exists)
sed 's#^const ROOT = .*#const ROOT = "'"$(pwd)"'"#' script/m14/verify-go-lane-coverage.ts > /tmp/vgo.ts
bun run /tmp/vgo.ts

# payload/latency, current tree
GO_PAYLOAD_ARTIFACT=validation/m14/go/go-payload-latency-after.json bun run validation/m14/go/go-payload-latency.ts 400

# fixtures and this lane's mutants
bun run script/m14/run-fixtures.ts --lang go     # 27 pass / 0 fail
bun run validation/m14/go/go-new-mutants.ts      # 6 mutants, 6 killed, 0 survivors
```

The "before" payload row needs the subject blob in place:
`git show 0494a8c54:src/ast/real-go-analyzer.ts > src/ast/real-go-analyzer.ts`, run, then restore.
The "before" numbers for the three defects are in the commit messages that fixed them, each with
the probe that produced them.

### Claim level

**L4 for the three defects fixed here** — fixtures pin the behaviour and six deliberately
injected defects all fail. **L1 for the lane as a whole**: the fixtures pass and the mutants die,
but the corpus census artifacts are produced by lane-owned scripts that a single agent wrote and
reviewed, and `exports` and `overrides` have **no oracle in the shared differential** at all. This
section does not claim L3 for the lane and cannot: the differential derives no go truth for two of
the ten types, so the honest level for those two is L1.

---

## AMBIGUITY_FLEET — the per-edge endpoint census, 2026-10-05

### What this section measures

For every edge the production path emits, does **both** endpoints bind to a real
declared symbol? Four failure classes are counted separately and never folded
into one figure: an endpoint spelled as an **unknown**, an **empty string**, an
R7 **placeholder literal**, and a **name no symbol declares**.

Instrument: `validation/m14/go/go-ambiguity-census.ts`, three passes —
`--index` (raw grammar, no analyzer: every declaration per package directory),
`--edges` (`ASTEngine.parseFile` → `getAnalyzer("go")` → `RealGoAnalyzer.analyze`,
one production call per file), `--merge`. Shardable at `--shard=i/n` because a
single process does not survive this corpus. **No regular expression appears in
the instrument**; every name decision is a `Set`/`Map` lookup, `split`,
`lastIndexOf`, `indexOf("/")` or string equality against a fixed vocabulary.

Artifacts: `validation/m14/measurements/go-ambiguity-draw-uncapped.json` (the
headline draw) and `go-ambiguity-draw-512kb.json` (the size-capped variant; the
delta is measured and reported below). Both are the compact form; the full
per-file class vectors are intermediate and re-derivable with
`GO_AMBIGUITY_COMPACT=0`.

### The population, and why two draws of it

Derived from disk by a recursive `readdir` walk with the production
`detectLanguageFromPath` rule — never a hand-written file list. Every exclusion
is counted and printed by the instrument.

| draw | admitted `.go` | excluded | parse failures | edges | files with ≥1 edge |
| --- | --- | --- | --- | --- | --- |
| **no cap (headline)** | **10,530** | 111 `testdata/` dirs only | 0 | 1,114,304 | 9,348 |
| 512 KB cap (variant) | 10,521 | 111 `testdata/` dirs + **9 files over 512 KB** | 0 | 1,026,839 | 9,341 |

Both passes see the same files inside a draw: a file the index pass could not
parse after three attempts is excluded from the edge pass too and counted, and
on both draws that count is **0**, so no name is scored "declared nowhere"
merely because the index never saw its file.

**The cap was a measurement defect and re-running found it.** The lane's
historical draw rule caps files at 512 KB. On an endpoint-*resolution* census
that cap is not neutral: it removes the files with the most declarations.

| | capped | un-capped | delta |
| --- | --- | --- | --- |
| distinct declarations in the index | 141,149 | **179,230** | +38,081 |
| `uses` ambiguous edges | 27,837 | **1,061** | −26,776 (96.2%) |
| `uses` AMBIGUITY RATE | 0.1233 | **0.0041** | |
| ALL TYPES AMBIGUITY RATE | 0.0625 | **0.0335** | |

Four of the 9 excluded files are the Go compiler's generated tables —
`src/cmd/compile/internal/ssa/ssaop/opGen.go` alone is 4.2 MB and declares on
the order of 9,000 operation constants — and the compiler's own files reference
them, so 26,776 edges pointed at a real declaration the capped index could not
see. **The un-capped draw is the headline and the capped draw is published beside
it**, because the capped figure is the one the lane's other instruments were
drawn on and a reader comparing them needs to see the difference rather than
inherit it.

### The AMBIGUITY RATE, per relationship type, un-capped draw

`AMBIGUITY RATE` = edges with at least one endpoint that binds to no declared
name ÷ edges emitted. **Two rates, both printed, neither suppressed.** A module
path is not a declaration and a file path is not a declaration, so the *strict*
column counts them as non-resolving; the *contract* column excepts a module path
on an `imports` **target**, which is what that label's own contract says it is.
An `imports` **source** that is a file path is not excepted — that is the
analyzer reporting the file had no package clause.

| type | edges | ambiguous | **rate** | by-contract | **contract-rate** | files | files + ambiguous |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `calls` | 309,634 | 3,512 | **0.0113** | 0 | 0.0113 | 7,243 | 270 |
| `uses` | 258,692 | 1,061 | **0.0041** | 0 | 0.0041 | 6,298 | 307 |
| `references` | 160,150 | 1,795 | **0.0112** | 0 | 0.0112 | 6,953 | 660 |
| `exports` | 233,047 | 71 | **0.0003** | 0 | 0.0003 | 5,955 | 36 |
| `contains` | 96,504 | 103 | **0.0011** | 0 | 0.0011 | 4,237 | 27 |
| `imports` | 30,524 | 30,524 | **1.0000** | 30,507 | 0.0006 | 6,912 | 6,912 |
| `instantiates` | 22,364 | 279 | **0.0125** | 0 | 0.0125 | 3,748 | 146 |
| `extends` | 1,788 | 13 | **0.0073** | 0 | 0.0073 | 691 | 7 |
| `implements` | 1,512 | 0 | **0.0000** | 0 | 0.0000 | 357 | 0 |
| `overrides` | 89 | 0 | **0.0000** | 0 | 0.0000 | 32 | 0 |
| **ALL TYPES** | **1,114,304** | **37,358** | **0.0335** | 30,507 | **0.0061** | 9,348 | 7,087 |

Three of those numbers are structural rather than incidental.

- `implements` and `overrides` are the only types whose **both** endpoints are
  declarations the same file writes, and they score 0/1,512 and 0/89. Nothing
  about them is ambiguous, at any rung.
- `imports` is the mirror image: **30,522 of 30,524 targets are module paths**,
  which the label's own contract says are not symbols, and its strict rate of
  1.0000 measures that contract rather than the lane. Its **17 non-contract
  edges are real**: 15 sources spelled `module` and 2 empty-string targets.
- `imports` and `exports` are the only types whose SOURCE is ever a package
  identity rather than a declaration, and on this draw the identity that trips
  R7's vocabulary is the package **name**: the source is
  `packageName || filePath` (`real-go-analyzer.ts:338` for imports, `:456` for
  exports), and `src/cmd/vendor/golang.org/x/mod/module` is a real Go package
  whose name is literally `module`. Measured, not inferred: pointing the same
  census at that directory alone (2 files) emits 15 `imports` edges and 28
  `exports` edges, and **every one of the 43 is ambiguous with the source spelled
  `module`** — which reproduces both placeholder counts exactly and localises
  them to two files.

### The four classes, counted separately (un-capped draw)

Endpoint counts, not edge counts; an edge with two non-resolving endpoints is
counted once in the rate and twice here, which is why the column does not sum to
the rate's numerator.

| class | endpoints | where |
| --- | --- | --- |
| **empty string** | **2** | `imports` targets only. Zero on the other nine types. |
| **unknown spelling** | **51** | `uses` 38 (target), `references` 7 (source), `exports` 4 (target), `contains` 2 (target) |
| **placeholder literal** | **2,186** | by type below |
| **undeclared name** | **4,627** | `calls` 3,237 · `references` 783 · `uses` 509 · `exports` 32 · `instantiates` 39 · `contains` 19 (source) · `references` 6 (source) · `extends` 2 (source) |
| *(not a defect: module path)* | *30,522* | `imports` targets |

The undeclared-name tail is concentrated and mechanical, not diffuse: the
compiler's generated rewrite tables reference ~9,000 operation constants from
the file that declares them, and this is a per-file analyzer whose targets are
leaf names. The instrument prints the name histogram to the terminal and keeps
it **out** of the artifact — it is real go-stdlib identifiers, and the honesty
lint scans `validation/m14/**` case-insensitively.

### R7 placeholder endpoints, and where the vocabulary is wrong

Every placeholder-classified endpoint, by token and side, from the instrument's
fixed R7 vocabulary (which is why no corpus identifier appears here):

| type | endpoints | breakdown |
| --- | --- | --- |
| `references` | 1,005 | src `global` 877 · `None` 57 · `_` 46 · `none` 1 · `null` 1 \| tgt `_` 21 · `None` 2 |
| `uses` | 515 | src `global` 430 · `_` 52 · `None` 4 \| tgt `global` 13 · `None` 6 · `none` 3 · `module` 2 · `NULL` 2 · `null` 2 · `_` 1 |
| `calls` | 276 | src `global` 141 · `None` 81 · `_` 45 · `null` 1 \| tgt `None` 7 · `_` 1 |
| `instantiates` | 247 | src `global` 236 · `_` 6 · `None` 2 \| tgt `None` 3 |
| `contains` | 82 | tgt `None` 52 · `_` 7 · `module` 2 · `global` 1 \| src `_` 19 · `None` 1 |
| `exports` | 35 | src `module` 28 · `_` 1 \| tgt `None` 5 · `NULL` 1 |
| `imports` | 15 | src `module` 15 |
| `extends` | 11 | src `_` 11 |

**Every token in R7's vocabulary is a legal Go identifier, and every one of them
is declared somewhere in this corpus.** Measured against the census's own
declaration index: `module` is declared in 2 package directories, `None` in 7,
`global` in 10, `none` in 3, `null` in 2, `NULL` in 1, and `_` is written in 614
files. The instrument therefore looks each placeholder-classified endpoint up in
the index as well and records the rung it lands on, and the artifact carries it:

| | endpoints | answered file-local | answered in package | corpus-only | answered by nothing |
| --- | --- | --- | --- | --- | --- |
| placeholder | 2,186 | 861 | 508 | 1,285 | 0 |
| unknown spelling | 51 | — | — | — | — (31 answered file-local or package) |

The 2,186 placeholder endpoints by token, from the artifact:

| token | total | source side | target side |
| --- | --- | --- | --- |
| `global` | 1,698 | 1,684 | 14 |
| `None` | 220 | 145 | 75 |
| `_` | 210 | 180 | 30 |
| `module` | 47 | 43 | 4 |
| `null` | 4 | 2 | 2 |
| `none` | 4 | 1 | 3 |
| `NULL` | 3 | 0 | 3 |

That table has to be read per token, because "a declaration answers to this
spelling" means three different things:

1. **`global` — 1,698 endpoints — a sentinel, not a name.** The analyzer
   publishes the literal `"global"` when it cannot attribute an edge to a
   declaration (`real-go-analyzer.ts:758`, `:4849`, `:4863`). A file that happens
   to declare something *called* `global` makes the spelling match without making
   the source attributable, so a rung answer here is not evidence of resolution.
   This is the largest placeholder class and it is the analyzer telling the truth
   about its own boundary — the same boundary GO36/GOD11 were opened for.
2. **`module` — 47 endpoints — the vocabulary is wrong about this corpus.**
   `golang.org/x/mod/module` is a real package in `src/cmd/vendor`, so 43
   `exports`/`imports` **sources** spelled `module` and 4 targets spelled `module`
   are **attributable, and 43 of the 47 answer file-locally**. Nothing is wrong
   with the analyzer here; R7's placeholder list collides with a package name.
3. **`None` / `none` / `null` / `NULL` — 231 endpoints — real cross-package
   leaves.** `src/simd/archsimd`, `src/syscall`, `src/vendor/.../asn1` and
   `src/runtime` declare them. 220 of the 231 are `None`. They are target-side
   leaves, which is this lane's recorded convention, not debris.
4. **`_` — 210 endpoints — Go's blank identifier, which names nothing by
   definition.** The census index does add `_` to a file's name set from
   `var_spec`/`const_spec` children, so 210 of the 861 "answered file-local"
   placeholder answers are that index artifact and must not be read as
   resolution. Subtracting them leaves 651 file-local answers.

### The six questions, re-answered on the whole corpus

Q1–Q3 are unchanged from the VERIFY_GO2 table above and are not re-measured
here; **Q4, Q5 and Q6 are re-measured on all 1,114,304 edges** instead of on a
2,000-file draw, because this instrument had the whole population in hand.

| type | 1 exists | 2 fires (edges / files) | 3 oracle agrees | 4 labelled (metadata key set) | 5 both endpoints resolve | 6 confident / R7 |
| --- | --- | --- | --- | --- | --- | --- |
| `calls` | yes | 309,634 / 7,243 | as VERIFY_GO2 (10,206 oracle / 10,061 analyzer / 7,441 agree, recall 0.580) | one shape, 309,634 | src 100% file-local; tgt 3,237 undeclared of 309,634 | conf 0.8 on 100%, `usage_contextual`; **0 reason codes** |
| `uses` | yes | 258,692 / 6,298 | as VERIFY_GO2 (recall 0.320) | three shapes: 207,093 / 50,945 / 654 | src 100% file-local; tgt 509 undeclared | conf 0.7 ×207,093 · 0.8 ×654 · 1.0 ×50,945; **207,747 sub-1.0, 0 reason codes** |
| `references` | yes | 160,150 / 6,953 | as VERIFY_GO2 (recall 0.687) | two shapes: 101,620 / 58,530 | src 99.98% file-local; tgt 783 undeclared | conf 0.95 on 100%, `reference_qualified`; **160,150 sub-1.0, 0 reason codes** |
| `exports` | yes | 233,047 / 5,955 | see DERIVATION below | one shape, 233,047 | **both ends 100% file-local**; 71 placeholder/undeclared endpoints, 43 of which are the real package `module` | conf 1.0 on 100%, `structural` — Go's rule is syntactic and total, so 1.0 needs no reason code |
| `contains` | yes | 96,504 / 4,237 | as VERIFY_GO2 (recall 0.937) | one shape carrying **no metadata beyond `evidenceClass`** | both ends 99.98% file-local | conf 1.0 on 100%, `structural` |
| `imports` | yes | 30,524 / 6,912 | as VERIFY_GO2 (recall 1.000) | one shape, 30,524 | tgt is a module path by the edge's own `metadata.isImport` marker, not by its spelling | conf 0.9 on 100%, `import_based`; **30,524 sub-1.0, 0 reason codes** |
| `instantiates` | yes | 22,364 / 3,748 | as VERIFY_GO2 | two shapes: 18,720 constructor-shaped · 3,644 composite-literal | src 98.9% file-local; tgt 39 undeclared | conf 0.8 ×18,720 · **0.6 ×3,644 — the only sub-0.7 population in the lane**; 0 reason codes |
| `extends` | yes | 1,788 / 691 | as VERIFY_GO2 (recall 0.579) | two shapes: 1,534 struct embed · 254 interface embed | both ends 98.8% file-local | conf 0.8 on 100%, `inferred`; 1,788 sub-1.0, 0 reason codes |
| `implements` | yes | 1,512 / 357 | as VERIFY_GO2 (0 oracle rows) | one shape | **every edge local > local** | conf 1.0 on 1,512, `structural` |
| `overrides` | yes | 89 / 32 | see DERIVATION below | one shape carrying all six keys | **every edge local > local** | conf 0.95 on 100%, `usage_contextual`; **89/89 carry a `reasonCode`** |

Q5, stated as the share of edges carrying a non-declaring endpoint on each side,
because "resolves" and "resolves file-locally" are different numbers and only the
first is a defect count:

| type | source non-declaring | target non-declaring | of which undeclared |
| --- | --- | --- | --- |
| `calls` | 268 = 0.09% | 3,269 = 1.06% | 3,237 |
| `uses` | 486 = 0.19% | 576 = 0.22% | 509 |
| `references` | 995 = 0.62% | 806 = 0.50% | 783 |
| `exports` | 29 = 0.01% | 42 = 0.02% | 32 |
| `contains` | 39 = 0.04% | 64 = 0.07% | 0 |
| `imports` | 15 = 0.05% | 30,524 = 100% (module paths, by contract) | 0 |
| `instantiates` | 244 = 1.09% | 42 = 0.19% | 39 |
| `extends` | 13 = 0.73% | 0 = 0% | 0 |
| `implements` | 0 | 0 | 0 |
| `overrides` | 0 | 0 | 0 |

So: **the two types whose every edge is `local > local` are `implements`
(1,512) and `overrides` (89); `contains` has zero undeclared endpoints on either
side; and the three leaf-name types sit between 98.9% and 99.8% resolvable**,
the remainder being declarations this single-file analyzer was not given the file
for. `imports` is the one type whose targets are 100% non-symbols, and that is
its label's contract rather than a defect.

Q6, restated because the figure above it was wrong when first written: **the
lane's honesty-contract §4 debt is 732,207 of 1,114,304 edges (65.7%)** carrying
a sub-1.0 confidence and no machine-readable reason code — `calls` 309,634,
`uses` 207,747, `references` 160,150, `imports` 30,524, `instantiates` 22,364,
`extends` 1,788. `overrides` is the only type that complies (89/89), and
`exports`/`contains`/`implements` need none at 1.0. Not fixed here: minting
reason codes at six push sites changes what every consumer sees and is its own
commit — the same conclusion the previous round reached on a 2,000-file draw,
now with the whole-corpus denominator.

### DERIVATION — the gate says clean, the differential still does not audit it

`script/m60/rel-type-coverage-gate.ts --langs=go`, run against a scratch root so
the shared 46-lane artifact was not overwritten:

```
CHECK 1 — DERIVATION: every emitted type has an oracle derivation
  clean
CHECK 2 — REACHABILITY: every emitted type is in the traversal default
  clean
CHECK 3 — AGREEMENT:    clean
CHECK 4 — ENUM:         clean
```

**Go has left the 100-DERIVATION-findings set, and the mechanism is worth
stating precisely, because the gate reading and the substantive reading differ.**
The gate reads a lane's audited set from `script/m14/go-truth.ts` when one
exists, and that module now publishes `GO_ORACLE_LABELS` with all ten labels
plus an independent `deriveGoExports` and `deriveGoOverrides`. **But
`script/m14/differential.ts` never imports that module.** It still calls six
`deriveGo*` oracles for go, none of them the new pair, and its compared-label
filter still excludes go from the `overrides` disjunct with the comment
*"GO41: the go analyzer emits zero of them"* — a statement that stopped being
true when the ontology round landed. So for `exports` and `overrides` the
substantive condition is unchanged: **233,047 + 89 = 233,136 edges — 20.9% of the
1,114,304 the lane publishes — are emitted and compared against nothing by the
shared differential.** The oracle exists; the wiring does not. Both files are
MASTER-owned (`script/m14/**`); reported, not changed.

### Edges are OUTGOING only

Every edge in this census leaves the file the analyzer was given. Nothing here
answers "who points AT this symbol": resolving incoming edges is a separate
subsystem (the `incoming-check` class of instrument), it is not built, and this
census cannot see it. The endpoint ladder measures whether the **target** of an
outgoing edge binds to a declaration; a declaration that nothing in this corpus
points at still scores as resolved.

### Gates re-run for this section, 2026-10-05

Every gate that speaks to this lane, with what it printed. Quoted with a path,
per honesty contract §1: the harness emits pass/fail, not the agent.

| gate | result | where it ran |
| --- | --- | --- |
| `firing-check-v2.mjs GO`, NFILES=200 | **10/10**, 200/200 parsed, `imports[]` 781 in 183 files | `validation/m14/go/go-firing-check-v2-NFILES200.txt` |
| `firing-check-v2.mjs GO`, NFILES=800 | **10/10**, 800/800 parsed, `imports[]` 3758 in 706 files | same file, second block |
| `go-ambiguity-census.ts --index` ×8 + `--index-merge` | 10,530 files parsed, **0 failed**, 1,185 package dirs, 179,230 distinct names | terminal; the index is intermediate |
| `go-ambiguity-census.ts --edges` ×8 + `--merge` | 10,530 parsed / 0 failed, 1,114,304 relationships | `go-ambiguity-draw-uncapped.json` |
| the same at the 512 KB cap | 10,521 parsed / 0 failed, 1,026,839 relationships | `go-ambiguity-draw-512kb.json` |
| `run-fixtures.ts --lang go` | **23 pass / 0 fail**, baseline gate reports no regressions | terminal; a scoped run writes no milestone evidence |
| `validation/m14/go/go-mutant-run.ts` (new this round) | baseline 23/0/0 problems, **8 of 8 mutants caught, 0 survivors** | terminal |
| `audit-analyzer-grammar.ts` | `go PASS refs=56 unknown=0 unknownFields=0` | terminal; the earlier figure of 54 did not reproduce. **This gate rewrites `validation/m14/results/M14.0.F1.json`** (issueId at `script/m14/audit-analyzer-grammar.ts:704`) — commit pointer, timestamp, `dead-literal-gate` 43/45 → 42/45 languages, and a `sql` adjudication row for a lane this branch does not own. Reverted here; reported |
| `go-oracle.ts 400` | every per-type figure reproduces the committed `go-oracle-400.json`, `imports` back to 1304/1304/1304 recall 1.000 after the double-count fix | `go-oracle.ts` |
| `differential.ts --lang go --repo go-stdlib --sample 120` | truth hash `8dc1132194b93790`, tree-truth 6,662, covered 6,642 (99.7%), MISSING 20, analyzer-edges 4,427, unexplained 16 | terminal — a scoped run refuses a lane-scoped artifact id |
| `rel-type-coverage-gate.ts --langs=go` | CHECK 1 DERIVATION **clean**, CHECKS 2/3/4 clean | scratch root, so the shared 46-lane artifact was not overwritten |
| `go-payload-latency.ts` | 400 files, 32,519 relationships, 7,238,323 B un-narrowed, ratio 2.781, 126.9 ms/file | see the note below |

**The payload row is on a different draw than either figure this document already
records**, and the difference is the corpus, not the analyzer: `cobra` is no
longer on this box, and the recovered `go-corpus-files.ts` excludes `vendor`.
Both earlier rows (27,397 relationships / 6,110,571 B, and 25,841 / 5,715,497 B)
are on the go-stdlib+cobra draw, this one is on go-stdlib alone with `vendor`
excluded, so the three numbers are not comparable to each other and none of them
is a regression against a prior value. **AMBIGUITY_FLEET adds no edges and
changes no edge**, so there is nothing to regress: the lane's payload is what it
was. No budget is declared for this lane — `validation/m60/analyzer-budget-register.json`
records go as `unscorable`, severity 5, status open — so no green budget was
regressed and nothing was re-baselined.

### What this section does not settle

- **Whether the undeclared 4,627 endpoints mean the analyzer is wrong.** They are
  real references to declarations outside the file, concentrated in the
  compiler's generated tables. Deciding that needs a consumer-side measurement
  (does `bb_graph`/`bb_impact` resolve them), which is not this lane's
  subsystem.
- **Whether `contains` needs more metadata.** It carries no key beyond
  `evidenceClass` on 96,504 edges, so a consumer cannot tell a struct field from
  an interface method from a method. Not wrong; not distinguishable.
- **The `imports` off-enum question is CLOSED, not open any more.** This file
  said above that `RelationshipType.Imports` serialises to `"brain_import"`.
  `src/ast/types.ts:83` now reads `Imports = "imports"`, the divergence the
  previous round reported is fixed in the MASTER-owned file, and go's 30,524
  import edges are produced under a value that *is* in the canonical enum.
- **Grammar-version drift.** 54 node-type references, `audit-analyzer-grammar.ts`
  reports 0 unknown, and the wasm is still not registered in
  `validation/m14/grammar-pins.json`.

---

## Relationship ontology

Twelve types, one row each, in the canonical register order of `src/ast/types.ts`.
(`decorates` and `part_of` are the two types this lane RULES OUT — ontological and
grammar-absence respectively — and neither publishes an edge, so neither carries a
claim row; both rulings, with their measured near misses and falsifiers, live in
`script/m14/spec/go-completeness.json`.) **Corrected 2026-10-05:** this section used
to say `RelationshipType.Imports` serialises to `"brain_import"` (`src/ast/types.ts`),
which is why it read as `imports` in prose and as `brain_import` on the wire.
`src/ast/types.ts:83` now reads `Imports = "imports"`, the three-enum divergence
is closed, and every count below is measured on that corrected tree — so go's
import edges are produced under a value that **is** in the canonical enum and the
"off-enum" label that appeared in the VERIFY_GO2 table above is retired. Every
count is **measured through the production `parseFile` entry** on a stated
draw, and every verdict is EMITTED / RULED / GAP with the measurement behind it.

| Relationship | Emitted? | How resolved | Confidence |
| --- | --- | --- | --- |
| calls | ✅ | `call_expression` from `qualified_calls` — LEAF targets incl. stdlib (`s.repo.Save(user)` → `calls Save -> Save`; `strings.ToUpper(v)` → `calls transform -> ToUpper`). Goroutine (`go f()`) and defer (`defer g()`) spawns are calls edges, deduped — one edge per (source, target). Go builtins filtered | 0.8 |
| extends | ✅ | interface embedding — an embedded interface element of a declared `interface_type` (`type ReadWriter interface { Reader; io.Closer }` → `extends ReadWriter -> Reader` / `Closer`): Go's interface-inheritance relation (the fleet's java interface/rust supertrait rule). Source = the interface, target = the embedded interface's LEAF, ONE `extends` edge per embedded element, no `contains` twin; a generic instantiation (`interface{ Cmp[int] }`) and a nested anonymous-interface element are different node shapes and are not this construct (`real-go-analyzer.ts:2847`). The STRUCT half of Go's embedding is composition, not inheritance, and is the `mixes_in` row below — BOTH HALVES ARE COUNTED, once per embedded type | 0.8 |
| implements | ✅ | implicit interface satisfaction (Go duck typing): `checkGoInterfaceImplementation` matches interface method signatures against the implementor's value/pointer receiver method sets (own + promoted), and a method matches only on the SAME name AND the SAME canonical signature — parameters by TYPE only, grouped declarations (`a, b int`) expanded one parameter per name, a VARIADIC parameter rendered `...T`, named results reduced to their types, no result = `void`. Implementor CANDIDATES are the declared non-interface types PLUS every method-receiver type name with no same-file `type` declaration. Confidence is computed per match (`matchedMethods / totalMethods`), not a literal | computed, `1.0` when the set is complete |
| uses | ✅ | two surfaces, distinguished by metadata: bare identifier READS at 1.0 (`metadata.nodeType`), selector field access at 0.7 (`metadata.selectorExpression`, `go_selector_use`), and a channel send/receive at 0.8 (`metadata.operationType`, `go_channel_operation`). Selectors that are the callee of a `call_expression` are skipped (the calls edge handles them) | 0.7 / 0.8 / 1.0 |
| imports | ✅ | each entry of the `imports` table emits `imports <package-or-file> -> <module path>` carrying `metadata.isImport: true`, `metadata.isGoImportDep: true` and the `import_spec`'s `line_number`. Deliberately labelled `imports` and NOT `references`: an import names a MODULE, and a module specifier is a path string whose separators no Go declaration may contain | 0.9 |
| exports | ✅ | the package's exported top-level units: `exports <package> -> <name>`, read FROM the `exports` array the lane has published since the M14 wave rather than recomputed, so the edge and the array cannot disagree. Go's rule is a CONVENTION (spec: exported iff the first character of the name is an upper-case Unicode letter), so confidence is 1.0 — a fact about the declaration, not an inference. **Scope:** no package-scope VARIABLE and no METHOD; both are exported in Go and both are excluded because membership rides `contains` and the M49 JVM-closure F3 invariant requires export names to be unique and top-level-resolvable. Pinned FORBIDDEN in `go/exports-contract` | 1.0 |
| contains | ✅ | ownerName pass: every symbol with an owner gets ONE `contains owner -> member` — struct fields, interface methods, methods. Never `contains package -> X` (package-contains noise removed) | 1.0 |
| references | ✅ | `qualified_type` references — `parentStruct`/`typeNode`/field type nodes written `pkg.Name` resolve to the LEAF after the final `.` (`t.text` when unqualified), deduped per `source|target|type`, with `metadata.relationshipType` and `metadata.qualifiedType` | 0.95 |
| overrides | ✅ | method promotion SHADOWING: a method declared on the outer type at depth 0 replaces the promoted method of the same name for every selector `x.M` (Go spec, selectors: the shallowest depth wins). Emitted as `overrides Outer.Method -> M`: the SOURCE keeps the shadowing declaration's qualified spelling (a Go method has no package-scope name of its own), and the TARGET is the promoted member's NAME alone — `#924` name-surface: a relationship target is a NAME the lane publishes, not a selector chain — with `metadata.targetQualified` (`Embedder.M`) and `metadata.embedder` carrying the pair the edge used to spell as its target. Matched by NAME, which is Go's rule — a signature-compatible shadow is the only shape most languages accept, but `x.M` selects the outer declaration even when the signatures differ — and `metadata.sameSignature` says which of the two it is. A QUALIFIED embed (`io.Writer`) is not followed: its method set is in another package. `metadata.promotedAtDepth` distinguishes a direct from a transitive displacement | 0.95 |
| instantiates | ✅ | PascalCase top-level FUNCTION calls only (`NewUser(...)` → `instantiates Find -> NewUser`), plus composite-literal construction `Foo{…}` / `&Foo{…}` / `pkg.Foo{…}` at the lower confidence — that second surface is the PascalCase-instantiation heuristic and is declared under Limitations | 0.8 (composite literal / constructor-shaped call) and 0.6 (`go_call_construction`) |
| renders | ✅ | a template RENDER call — `tpl.Execute(w, …)` / `tpl.ExecuteTemplate(w, "name", …)` where `tpl` resolves to a PUBLISHED package-level template symbol (`var page = template.Must(template.New(…).Parse(…))`) — publishes `renders`: source = the rendering function/method, target = the template NAME (for `ExecuteTemplate` the name argument is read by `goTemplateRenderNameArgument`; otherwise the constructed template's own name), `line_number` = the OPERAND's line (the rendered symbol's name at the call site — the selector may wrap, so the `Execute` token's line is a different and wrong site). GATED ON THE `html/template` IMPORT: `text/template` is the measured impostor class (144 importing files, almost all generators) and publishes no row, and locals, parameters, fields, call results, expression receivers and bare name strings emit nothing (`real-go-analyzer.ts:2993`; fixture `go/renders-template-execution`) | 0.9 |
| mixes_in | ✅ | an EMBEDDED FIELD relabel: a struct's anonymous `field_declaration` (`type UserService struct { BaseService; *Audit; io.Closer }` → one edge per embedded field) publishes `mixes_in UserService -> BaseService`: source = the embedding type, target = the embedded field's LEAF name (`goEmbeddedFieldName`), `line_number` = the embedded type's OWN line (`real-go-analyzer.ts:2795`). The STORED TYPE MOVED `extends` → `mixes_in` with confidence 0.8 and the SAME `confidence` / `evidenceClass` — THE RELABEL CONTRACT: a label move, not a distribution change — with `metadata.relationshipType: "go_struct_embedding"`, `isMixin: true` and `embedType: "struct_composition_mixes_in"` retained. ONE edge per embedded field, no `contains` twin. The INTERFACE half is not this row: an embedded interface composes no implementation and stays `extends` | 0.8 |

There is no row for `depends` or `field_access`: they are not `RelationshipType` members in
`src/ast/types.ts` — the family's spellings are `references` and `uses`.

### Per-type verdict — the relationship-type workstream

Draws, stated once and used throughout. **corpus** = `go-stdlib` @ `6f5c275e` (11,790 tracked
`.go`) + `cobra` @ `adbc881` (36) = **11,826 admitted files**, admitted by `git ls-files`, ≤512 KB,
`detectLanguageFromPath === "go"`. **Emission draw** = 2,000 files — the first 2,000 of the sorted
list — sharded 6 ways (`--sample 2000 --shard=i/6`) and merged, 0 parse failures in every shard.
**Probe draw** = all 11,826 admitted files (construct counts) and the 2,000-file draw (the
per-draw probe column). Instruments: `script/m14/go-ontology-census.ts` (production `parseFile`,
and its probes-only mode over raw tree-sitter with no analyzer).

The `Files in the draw` column is the **union of the six shards' per-type file sets**, and each
shard artifact records `filesOverlap` = (sum of per-shard file counts) − (union). It is **0 for
all ten types**, which is the measurement that says the shards partition the draw, so the figure
is a distinct-file count. Before this round `--merge` wrote `types[t].files = null` and kept only
5 sample files per type, so this column had no artifact behind it at all; the shard artifacts are
now committed under `validation/m14/measurements/go-census-shards/`, and
`--merge validation/m14/measurements/go-census-shards/s*.json` re-derives
`validation/m14/results/go-ontology-census-emission.json`.

**Every count in the two columns below was re-measured on 2026-10-03, and the previous
revision's numbers did not reproduce** — see "the artifact that did not reproduce" below. Cross-
checked against a second instrument on the shared 400-file draw: the census and
`go-payload-latency.ts` agree on all ten types to the edge.

| Type | Verdict | Count (2,000 files) | Files in the draw | Construct measured on the tree (11,826 files) |
| --- | --- | --- | --- | --- |
| calls | EMITTED | 88,128 | 1,601 | n/a — the construct is a `call_expression`, 1 of 179 node types observed |
| uses | EMITTED | 103,621 | 1,464 | n/a — `identifier` + `selector_expression` |
| contains | EMITTED | 14,634 | 786 | n/a — `field_declaration_list` / `method_spec` |
| imports | EMITTED | 9,508 | 1,746 | n/a — `import_spec`, 62,847 nodes observed |
| references | EMITTED | 29,944 | 1,476 | n/a — `qualified_type`, 130,478 nodes observed |
| exports | EMITTED (was GAP) | 18,197 | 1,186 | **231,897** package-scope capitalised declarations in **7,343** files — func 30,876 / type 13,386 / const 172,707 / var 2,975 / method 11,953 |
| extends | EMITTED | 297 | 105 | n/a — anonymous `field_declaration` |
| implements | EMITTED | 234 | 45 | n/a — `interface_type` × `method_declaration` |
| overrides | EMITTED (was GAP) | 17 | 5 | **161** same-file shadowing sites in 46 files · **1,006** package-wide in 256 files · **107** through an external stdlib embed in 43 files · **74** external embeds reported UNRESOLVED rather than counted |
| instantiates | EMITTED | 5,115 | 815 | n/a — `composite_literal` |

Two verdicts are worth their reasoning here, because the other eight are ordinary.

**`exports` is a CONVENTION, so a grammar inventory cannot decide it.** The ontology gate's
Instrument A (enumerate the node types the grammar produces) returned **179 node types for Go
and not one of them says "exported"** — `export_statement` occurs 0 times. That is the exact
reasoning that produced json's wrong `exports` ruling, and it is blind to a convention by
construction. Instrument B counts it on the tree instead: 231,897 sites in 7,343 files. The
language HAS the construct, so this was a GAP and not a RULED type. On the 2,000-file draw the
same probe finds **22,089** sites (const 12,518 / func 4,543 / method 2,988 / type 1,084 /
var 956) and the analyzer emits 18,197 `exports` edges from them. The edge does **not** carry
every site: 2,975 capitalised package-scope variables and 11,953 capitalised methods on the full
corpus are exported in Go and are deliberately not edges, and both exclusions are pinned as
forbidden rows in `validation/m14/fixtures/go/exports-contract.go` so the scope stays a decision
rather than becoming an accident. The gap between 22,089 sites and 18,197 edges is that exclusion
plus the export-name uniqueness rule, not an error rate — see `exports-widened-to-vars-and-methods`
in the mutant list, which fails if the scope widens.

**`overrides` is the shape bash was ruled on wrongly.** Go has no `override` keyword, so the
prose "Go has no override" would have been as wrong as bash's. The construct is method-promotion
shadowing, and it was in this analyzer's own evidence the whole time: `collectGoPromotedMethods`
computed that an outer method displaces a promoted one and discarded the displaced method
without recording it. Probe B5 — the bash instrument (a SECOND declaration of a name already
declared in the same file) applied to Go — finds **0** package-scope redeclarations outside
legal `func init()` and legal `type _` declarations (1,262 hits on the full corpus, every one of
them a `type _` or an `init`), which is the measurement that says Go's override surface is
promotion, not redefinition. Both sub-surfaces are counted separately because a per-file analyzer
can only see one of them, and the three numbers are on three different denominators:

| Sub-surface | Sites | Files | What it measures | Seen by this analyzer? |
| --- | --- | --- | --- | --- |
| same-file promotion shadowing | 161 | 46 | the construct a per-file analyzer can prove | yes — the `overrides` edge |
| package-wide shadowing | 1,006 | 256 | the construct including a method promoted from another file of the package | no — declared limitation |
| shadowing through an external stdlib embed | 107 | 43 | the construct including another package's method set | no — the embed is not followed |
| external embeds left UNRESOLVED | 74 | — | embeds whose target is outside the measured corpus | counted, never assumed |

The 2,000-file emission draw is a sixth of the corpus and sharded six ways, which is why it
carries 17 `overrides` edges in 5 files where the full-corpus probe finds 161 sites in 46 files.

### The artifact that did not reproduce

The previous revision of this table carried 290,528 relationships, 108,775 symbols and 63,156
`exports` edges for this draw. Re-running the same instrument, the same corpus commit and the
same admission rule on 2026-10-03 produced **269,695 relationships, 53,858 symbols and 18,197
`exports` edges**. Three independent runs agree on the new figures:

| run | export sites | why it rules |
| --- | --- | --- |
| six shards (0/6…5/6) of the 2,000-file draw, merged | 22,089 | the production measurement; 0 parse failures in every shard |
| ONE unsharded probes-only pass over the same 2,000 files | 22,089 | not a sharding artefact — the same number with no shards at all |
| census vs `go-payload-latency.ts` on the shared 400-file draw | — | all ten types agree to the edge: 6,342 symbols / 27,397 relationships, `exports` 1,555 and `overrides` 1 in both |

**Why it is not known:** the old artifact named its shards as `/tmp/opencode/go/shards/s*.json`,
which were deleted, so the old numbers cannot be re-derived at all. A corpus revision, a draw
recorded in a field nobody checked, and a stale merge are each consistent with what was
committed, and nothing committed distinguishes them. The artifact was therefore **replaced**
rather than annotated, because an unreproducible artifact is the one thing this workstream
forbids; the replacement is re-derivable from files now in the repository. This does not change
the verdict column: all ten types fire on the draw, in the same order of magnitude, and
`overrides` is 17 edges in 5 files either way.

### The six questions, per already-emitted type

Source derivation answers only the first. Each answer below carries the measurement it rests on.

**1 Exists — can the analyzer construct it?** All ten. Re-derived from
`src/ast/real-go-analyzer.ts` by grepping every `RelationshipType.*` reference, and independently
by the master lane verifier's own derivation (`script/m14/verify-lane-claims.sh` step 2), which
reads the analyzer and the engine enum and never reads this document.

**2 Fires — does it produce edges on a real corpus?** All ten, with the counts in the verdict
table above. This is the question source reading cannot answer: a branch whose predicate can
never match is invisible to derivation, and this lane has two such branches documented in its own
comments (the `parentStruct` frame that could never fire, and the `SymbolKind.Class` predicate
that could never be true because Go emits `struct`). The grammar audit (`bun run
script/m14/audit-analyzer-grammar.ts`) reports **go PASS, 54 node-type references, 0 unknown, 0
unknown fields** — that is a grammar-conformance reading, not a corpus measurement, and the two
are kept apart here on purpose.

**3 Correct — does an independent oracle agree?** The differential compares **8 of the 10**
labels for go against oracles that are separate walkers over the same tree: `deriveGoEdges`
(calls/instantiates/extends), `deriveGoImplements`, `deriveGoDeclaredTypeRefs` (references),
`deriveGoContains`, `deriveGoUses`, `deriveGoImports`. Re-run 2026-10-03 on one draw of 120
go-stdlib files, scoped (`--lang go --repo go-stdlib --sample 120`) and pinned by pointing
`BB_M14_WORK` at a private cold-pool state and resetting the rotation counter, because the default
rotation draws a DIFFERENT file set per run and the first attempt at this comparison produced a
meaningless difference (truth 10,610 → 13,808 across two runs of the "same" command). Draw hash
`f99a44c43cb02851`, identical to the run the previous revision recorded:

```
[go-stdlib] go: files=120 tree-truth=17093 covered=17093 (100%) MISSING=0
             | analyzer-edges=8216 unexplained=1 (0%) heuristic=0
             | hash=f99a44c43cb02851 | unexplained-by-label: references=1
```

| | truth rows | covered | MISSING | analyzer edges (compared) | unexplained |
| --- | --- | --- | --- | --- | --- |
| before this round's change | 17,093 | 17,093 (100%) | 0 | 8,216 | 1 (`references`) |
| after (re-measured 2026-10-03) | 17,093 | 17,093 (100%) | 0 | 8,216 | 1 (`references`) |

Identical, which is the point: **the two new edges are invisible to the differential**, because
the allowlist filters the analyzer side and names neither `exports` nor `overrides`. That is the
DERIVATION debt, quantified in its own section below. **What this question cannot support:** the
oracle is a second implementation over the SAME grammar, so a grammar bug shared by both paths is
invisible to it, and neither number above says anything about the two new types — they are
compared against nothing. The single `references` unexplained row is pre-existing and identical
on both sides of the change; it was not adjudicated in this round.

**4 Labelled — the right type, not a neighbour?** Per type, with the metadata that carries the
claim (2,000-file draw, one metadata key-set per type, re-measured 2026-10-03):

| Type | Metadata shapes and their counts | Read |
| --- | --- | --- |
| calls | `callExpression+isPackageQualified+relationshipType` 88,128 | one shape, one meaning: a `call_expression`'s leaf |
| uses | `relationshipType+selectorExpression` 89,332 · `nodeType+relationshipType` 14,209 · `operationType+pattern+relationshipType` 80 | three surfaces, three metadata keys, so a consumer can tell a field read from a bare identifier read from a channel operation |
| contains | `(none)` 14,634 | **no metadata at all** beyond `evidenceClass`, so the edge does not say whether the member is a struct field, an interface method or a method. Not wrong, but not distinguishable |
| imports | `isGoImportDep+isImport+packageName` 9,508 | target is the PATH, not the alias — pinned by 7 forbidden alias rows in `go/imports-contract` |
| references | `qualifiedType+relationshipType` 16,119 · `relationshipType` 13,825 | the qualified spelling is kept, so a `pkg.Type` use is recoverable |
| exports | `exportForm+relationshipType+symbolKind` 18,197 | carries the declaration's own kind |
| extends | `embedType+embeddedStruct+isAnonymous+isEmbedding+relationshipType` 252 · `embedType+embeddedInterface+…` 45 | one label for two constructs, distinguished by key: struct composition vs interface embedding |
| implements | `implementationType+isImplicit+matchedMethods+receiverSet+relationshipType` 234 | carries how many interface methods matched |
| overrides | `isOverride+promotedAtDepth+reasonCode+relationshipType+sameSignature+shadowedAtDepth` 17 | distinguishes substitutable override from legal Go hiding |
| instantiates | `isConstructor+relationshipType` 4,000 · `callExpression+relationshipType` 1,115 | the lower-confidence 1,115 are composite-literal constructions, not constructor-shaped calls |

The neighbour risks that were worth measuring rather than asserting: `imports` vs `references`
(the target's separators — a module path may contain `/` `.` `-`, no Go declaration may contain
`.`), `overrides` vs `extends` (a shadow is a relation between two METHODS; the embedding itself
is the `extends` edge), and `exports` vs `contains` (a member is contained; only a top-level unit
is exported). Each is pinned by a fixture row and each has a mutant that would reintroduce the
confusion.

**5 Resolved — do both endpoints bind to real symbols?** Scored three ways, because a per-file
analyzer on a package-scoped language understates resolution if you only ask about the file
(2,000-file draw, re-measured 2026-10-03; the target ladder is the interesting column):

| Type | target resolves in the file | in the package | in some drawn package | declared nowhere in the draw | source resolves in the package |
| --- | --- | --- | --- | --- | --- |
| contains | 14,627 (100.0%) | 14,627 | 0 | 7 | 13,648 (93.3%) |
| exports | 18,197 (100%) | 18,197 | 0 | 0 | 18,197 (100%) |
| extends | 297 (100%) | 297 | 0 | 0 | 297 (100%) |
| implements | 234 (100%) | 234 | 0 | 0 | 234 (100%) |
| overrides | 0 (by construction) | 0 | 17 | 0 | 0 (by construction) |
| calls | 21,385 (24.3%) | 23,148 | 23,794 | 41,186 | 88,109 (100.0%) |
| uses | 26,015 (25.1%) | 27,557 | 21,242 | 54,822 | 103,577 (100.0%) |
| references | 9,660 (32.3%) | 10,712 | 12,471 | 6,761 | 29,827 (99.6%) |
| imports | 11 (0.1%) | 29 | 902 | 8,577 | 9,508 (100%) |
| instantiates | 2,705 (52.9%) | 2,769 | 624 | 1,722 | 5,094 (99.6%) |

**The two ends of this ladder are not the same kind of fact, and the `NOWHERE` column is the one
that decides it.** The four structural types (`contains`, `exports`, `extends`, `implements`)
resolve at file scope at or near 100% because both endpoints are declarations the same file
writes; `calls`, `uses`, `references` and `instantiates` sit at 24–53% because their targets are
leaf names, and a Go leaf is usually a declaration in a file this single-file analyzer was not
given. The ladder separates those: of `calls`' 41,186 unresolvable-in-file targets, **23,794 are
declared somewhere in the drawn corpus** (stdlib leaves, third-party leaves) and only the
remainder is genuinely unaccounted. `imports` is the clearest case and it is not a defect: 8,577
of 9,508 targets are "declared nowhere" because a module path is not a declaration — it names a
package this two-repo corpus does not contain, which is the label's own contract.
`overrides` scores 0 at file scope **by design and by contract**: both endpoints are
`Receiver.Method`, a Go method has no package-scope name of its own, and the R10 census rule
measures separators in a lane's targets against the characters its own symbols use — no Go
declaration may contain `.`. A bare `Read` endpoint would be ambiguous across every receiver in
the file, which is the fabrication class rule R7 names; three forbidden rows in
`go/overrides-promotion` state it.

The unresolved tails are not defects and the numbers say which is which. `imports` is 8,577
"declared nowhere" because a module path is not a declaration — it names a package this corpus
does not contain. `calls`' 41,186 are stdlib and third-party leaves (`fmt`, `Sprintf`,
`callGoStackCheck`, 1,250 of them from one SIMD intrinsic table) kept deliberately per the Rust
family contract (`calls normalize -> println`); the ladder above attributes 23,794 of them to a
declaration somewhere in the drawn corpus. `contains`' 7 target-side and 986 source-side misses
are single-owner cases, not a class, and `implements` is 100% at every rung.

**6 Confident — are `evidenceClass` and confidence right, and is anything under 0.7 a
heuristic rather than a fact?** Measured confidence and tier distributions (2,000-file draw,
269,695 relationships, re-measured 2026-10-03):

| Type | Confidence | `evidenceClass` | Edges below 1.0 | Of those, carrying a machine-readable `reasonCode` |
| --- | --- | --- | --- | --- |
| contains | 1.0 ×14,634 | `structural` | 0 | — |
| exports | 1.0 ×18,197 | `structural` | 0 | — |
| implements | 1.0 ×234 | `structural` | 0 | — |
| uses | 0.7 ×89,332 · 0.8 ×80 · 1.0 ×14,209 | `usage_contextual` | 89,412 | **0** |
| calls | 0.8 ×88,128 | `usage_contextual` | 88,128 | **0** |
| references | 0.95 ×29,944 | `reference_qualified` | 29,944 | **0** |
| imports | 0.9 ×9,508 | `import_based` | 9,508 | **0** |
| extends | 0.8 ×297 | `inferred` | 297 | **0** |
| instantiates | 0.8 ×4,000 · **0.6 ×1,115** | `structural` | 5,115 | **0** |
| overrides | 0.95 ×17 | `usage_contextual` | 17 | **17 (100%)** |

Three things follow, and the first two are findings rather than reassurances.

- **Under 0.7: exactly 1,115 edges, all `instantiates` at 0.6** — 0.41% of the graph, all from
  composite-literal construction (`go_call_construction`). That is the PascalCase-instantiation
  heuristic the honesty contract §3 requires to be declared, and it is declared under
  Limitations. Nothing else in the lane is below 0.7.
- **Contract §4 is not met by the pre-existing types: 232,488 of 269,695 edges (86.2%) carry a
  sub-1.0 confidence and NO machine-readable reason code.** The two new types comply (`overrides`
  17/17; `exports` needs none at 1.0). This replaces an UNVERIFIED note in an earlier revision of
  this file, which asked for exactly this census. Six push sites are responsible (`calls` ×1,
  `uses` ×3, `references` ×1, `extends` ×1, `instantiates` ×2). **Not fixed here**: which reason
  codes to mint, and what they cost in payload on every lane that emits sub-1.0 edges, is a
  repository-level decision rather than a lane defect — and the payload measurement below is
  what a lane-local fix would have to be weighed against. Reported.
- **`overrides` reads `usage_contextual`, not `structural`, and that is deliberate.** For the
  extends/implements/overrides family this classifier derives the tier from CONFIDENCE, so
  `extends` at 0.8 reads `inferred` and `overrides` at 0.95 reads `usage_contextual`. One rule
  for the family beats a per-type exception, and `src/lsp/evidence_tier.ts` rule 1 lets the
  stored claim win over the server's own derivation. An earlier revision of this file described
  `overrides` as never emitted and the `exports` branch of the classifier as a "family mirror";
  both statements are now false, and the classifier's own comment said so.

**Unknown symbols, empty names, placeholder endpoints (rule R7).** Measured by
`script/m14/go-endpoint-probe.ts` over the 2,000-file draw, 269,695 edges, re-run 2026-10-03
sharded 6 ways and merged (`validation/m14/measurements/go-endpoint-integrity.json`):

| class | count | by type |
| --- | --- | --- |
| empty name | **0** | — |
| placeholder-shaped | **34** | uses 16 · calls 10 · references 8 |
| non-identifier | **1** | references 1 |

- **Empty names: 0.** There was exactly **1** before this round — `references f -> ""` from
  `src/cmd/compile/internal/syntax/testdata/tparams.go`, where error recovery types an empty
  type-parameter list as a `type_identifier` whose text is `""`. Fixed at the collector, pinned by
  `{ "type": "references", "target": "" }` in `go/error-recovery-empty-type`, and the fix has its
  own mutant.
- **Placeholder-shaped: 34** (`uses` 16, `calls` 10, `references` 8). Every one was adjudicated
  this round by reading the source rather than by trusting the value, because the register's own
  record is that the first two runs convicting `Null`/`Unknown`/`Anonymous` were all real members.
  The sites, re-read 2026-10-03:
  - `calls → TODO` is `context.TODO()` (cobra/command_test.go, cmd/go/internal/modload).
  - `uses → Unknown` is a types sentinels leaf (`types2/const.go`, `types2/operand.go`,
    `ir/val.go`, `noder/reader.go`) — a declaration in another package of this corpus.
  - `references → Symbol` / `uses → Symbol` is `pe.Symbol` / `xcoff.Symbol`, the objfile package's
    exported type, read from `cmd/internal/objfile/*.go` and `cmd/link/internal/loadxcoff/*.go`.
  - `uses → unknown` is the package-scope constant at
    `src/cmd/compile/internal/ssacompile/prove.go:23` (`const unknown branch = iota`), which is
    also the name `keepSymbol` drops (above).
  - `calls → Anonymous` is `cmd/api/main_test.go`'s own local name.
  Four of the five classes are cross-package leaves, which is this lane's recorded convention,
  not debris.
- **Non-identifier characters: 1**, `references global -> ☹x` from
  `src/cmd/compile/internal/types2/testdata/local/issue68183.go` — a 29-line file that exists to
  test the parser's handling of invalid identifiers, whose own comments mark the lines
  `invalid character`. Re-read and confirmed: the name is written in the file and is not a legal
  Go identifier, so nothing can ever bind to it. Declared under Limitations. The count of 1 holds
  only because the two recorded conventions are excluded first (a module path on an `imports`
  target, a `Receiver.Method` on an `overrides` endpoint).

## What the two new types cost, measured

`script/m14/go-payload-latency.ts`, identical 400-file draw (cobra + the first 400 sorted
go-stdlib files), same machine, the analyzer blob swapped between runs (`d7726e15a`, which
contains neither edge, checked out for the "before" run and restored after). Re-run 2026-10-03;
artifacts at `validation/m14/measurements/go-payload-latency-{before,after}.json`:

| | before | after | delta |
| --- | --- | --- | --- |
| symbols | 6,342 | 6,342 | 0 |
| relationships | 25,841 | 27,397 | **+1,556 (+6.02%)** |
| — of which `exports` | 0 | 1,555 | +1,555 |
| — of which `overrides` | 0 | 1 | +1 |
| the other eight types | — | — | **+0 each, every one, byte-for-byte** |
| serialized graph, un-narrowed (`bytesAll`) | 5,715,497 B | 6,110,571 B | **+395,074 B (+6.91%)** |
| share of those bytes: `exports` / `overrides` | 0% / 0% | **6.46%** / 0.01% | — |
| un-narrowed ÷ single largest type | 1.91× | 2.05× | +0.14× |
| user CPU per file | 124.59 ms | 126.45 ms | +1.50% |
| wall per file | 151.28 ms | 171.85 ms | not comparable: loadavg1 was 20.56 before and 18.19 after, on a box running several lanes |

The "+0 each, byte-for-byte" row is the load-bearing one for the other eight types: it is not
"no significant change", it is `calls` 2,986,362 B in both runs, `uses` 1,387,013 B in both, and
so on for all ten byte counts, so the new edges cost exactly their own weight and nothing else.

`bb_graph`'s un-narrowed `relationshipTypes` default returns all ten values and both new types
were already in that default, so an un-narrowed query on a Go repo grows by the 6.91% above; the
multiplier against a single-type query moves 1.91× → 2.05×, which is at the low end of the
2.5–4.8× the workstream quotes for lodash and ripgrep. **No green budget was regressed**: the
`validation/m60/analyzer-budget-register.json` row for go is `unscorable` (severity 5, status
open: no loadRule, no corpusManifest, no loadAvg1, no userCpuMsPerFile), so there is no passing
budget for this to regress and nothing was re-baselined. The numbers above are the lane's own, on
a named draw.

## DERIVATION debt after this change

Measured with `script/m60/rel-type-coverage-gate.ts --langs=go` (run against a scratch root so
the shared 46-lane artifact was not overwritten — see the reporting note below):

```
CHECK 1 — DERIVATION: every emitted type has an oracle derivation
  go  2 un-audited: ["exports","overrides"]
  → gate exits 1 with 2 NEW findings
CHECK 2 — REACHABILITY: clean (the traversal default is 10 of 10)
CHECK 3 — AGREEMENT:    clean
CHECK 4 — ENUM:         clean
```

Go was one of the 12 lanes with **zero** DERIVATION findings and leaves that set when these edges
ship: **18,214 edges per 2,000 files — 6.8% of the 269,695 the lane publishes** — are emitted and
compared against nothing. (The previous revision put this at 63,173 edges and 21.0%; both
figures came from the artifact that did not reproduce, and the ratio is now LOWER as well as
smaller, because the re-measured `exports` population is smaller than the one that number came
from. The finding itself is unchanged and is now backed by an artifact that reproduces.)

The differential's compared-label list is a local expression in `script/m14/differential.ts`
(MASTER-owned) that names neither type for go, and its comment says why in the past tense:
*"not `overrides` (GO41: the go analyzer emits zero of them)"* — a statement that became false
when this lane started emitting them, and which is repeated twice in that file. Confirmed by
reading the allowlist: `...(lang === "go" ? ["references", "contains", "uses", "imports"] : [])`
over the base four, and the go truth block calls six `deriveGo*` oracles, none of which derives
either new type. Closing this needs two changes there, both reported rather than made:

1. an oracle that derives `exports` and `overrides` for go (the constructs are counted on the
   tree by `script/m14/go-ontology-census.ts` probes B1/B2/B3/B4, and
   `script/m14/go-overrides-diff.ts` already re-implements the selector rule independently over
   the same grammar — both are the starting point);
2. `"exports"` and `"overrides"` added to go's compared-label list.

Until both land, a defect in either edge ships invisibly — the same failure mode the ontology gate
was written for, one level down. What makes this cheap to close and is worth stating: the two
new edges are the ONLY thing standing between this lane and a clean CHECK 1, and the fixtures
already discriminate both of them (12 of the 17 go mutants target `exports` or `overrides`
specifically), so the behaviour is pinned even though it is not differentially audited.

## Gate results, re-run 2026-10-03

Every gate that speaks to this lane, with what it actually printed. Quoted with a path, per
honesty contract §1: the harness emits pass/fail, not the agent.

| gate | result | evidence |
| --- | --- | --- |
| `run-fixtures.ts --lang go` | **22 pass / 0 fail**, no baseline regression | terminal; scoped run writes no evidence by design |
| `go-mutant-run.ts` | clean 22/0, then **17 of 17 mutants caught, 0 survivors** | terminal |
| `audit-analyzer-grammar.ts` | **go PASS, refs=54, unknown=0, unknownFields=0**; tree exits 3 on `cpp` (2 unknown) and `rust` (2 unknown) | terminal |
| `rel-type-coverage-gate.ts --langs=go` | **CHECK 1 FAILS: 2 un-audited `["exports","overrides"]`**; CHECKS 2/3/4 clean | `validation/m60/results/rel-type-coverage.json` (run against a scratch root so the shared 46-lane artifact was not overwritten) |
| `differential.ts --lang go --repo go-stdlib --sample 120` | 17,093 truth rows, 100% covered, MISSING=0, 1 unexplained (`references`), hash `f99a44c43cb02851` | terminal only — `--emit` refuses a lane-scoped id (see below) |
| `go-payload-latency.ts` before/after | rels 25,841 → 27,397; bytes 5,715,497 → 6,110,571; user CPU 124.59 → 126.45 ms/file | `go-payload-latency-{before,after}.json` |
| `verify-doc-truth-emissions.ts` | reports `UNDOCUMENTED [go] contains` — **the gate's own off-by-one, not a gap in this document** | see below |
| `run-fixtures.ts` (unscoped) | exits on **two orphaned lanes, `r` and `lua`**: `r` has 0 expectation files and `lua` has 6, neither claimed by a runner lane | neither is in this lane; reported |

### The `UNDOCUMENTED [go] contains` finding is a gate defect, and it is fleet-wide

`verify-doc-truth-emissions.ts` reports `UNDOCUMENTED [go] contains`. It is not a gap in this
document: `contains` is documented, at the first data row of the relationship table on line 73,
with a count and a resolution figure. Replicated against the gate's own `parseClaimTable` logic:

```
claim-shaped headers found at lines: 71
chosen header line 71 ["Relationship","Emitted?","How resolved","Confidence"]
rows READ: 9 ["extends","implements","imports","references","calls","uses","instantiates","exports","overrides"]
first data row DROPPED: "contains" (doc line 73)
```

The cause is at `script/m14/verify-doc-truth-emissions.ts:466-468`: after skipping the header row
and the rule row, `if (!started) { started = true; continue }` consumes the **first body row**
unconditionally, as though it were the separator. So every claim table in the repository loses
its first data row. It is not go-specific — the same run reports `UNDOCUMENTED` for `c`, `clojure`,
`cpp`, `csharp`, `css`, `dart`, `elixir`, `erlang`, `fsharp` and others, which is what makes it
fleet-wide rather than a lane defect. **Reported, not fixed**: the gate is MASTER-owned, and the
fix is to drop the `!started` skip so the loop starts at the first body row.

The previous revision of this file asserted this off-by-one as the explanation; it is confirmed
here by execution rather than by reading, and the confirmation is what the assertion lacked.

## VERIFIED EXTERNAL CLAIM ON LEAF TARGETS — `isStdlib` (2026-10-17)

**What it is.** The lane's unresolved targets are BARE LEAVES (`json.Marshal` publishes `Marshal`),
and their real reasons ride `metadata.reasonCode`, which the incoming gate reads nowhere. The one
claim the arbiter can verify on a bare target is an external `owner` claim, and the lane now attaches
`isStdlib: true` (plus `stdlibPath`, the import path that proves it — not itself a claim key) on
three surfaces, without moving the emitted target:

| surface | qualified spelling held | proves | cap-400 result |
|---|---|---|---|
| `calls` | `metadata.callExpression` (`json.Marshal`) | the call is a DIRECT member of an imported stdlib package | unresolved 10,238 -> **8,232**, extOK 0 -> **2,006** |
| `references` | `metadata.qualifiedType` (`context.Context`) | the type use names an imported stdlib package's type | unresolved 5,926 -> **4,269**, extOK 0 -> **1,657** |
| `instantiates` | `metadata.qualifiedType` (`http.Server{}`) | the constructed type is an imported stdlib package's type | unresolved 1,657 -> **1,593**, extOK 0 -> **64** |

**The proof, not a shape guess.** `GO_STDLIB_TOP_LEVEL` is the Go distribution's closed set of
top-level package directories. A claim is attached only when (i) the qualifier is a package THIS
FILE imports (alias read from the analyzer's own `ImportInfo`), (ii) the import path's first segment
is in that set, (iii) the qualifier is not the file's own package name and not a name the file
declares (shadowing), and (iv) the file does not itself publish the leaf. A receiver selector
(`r.reader.SearchWhere`), a deeper chain (`pkg.Value.Method`), a project-local package
(`internal/util`) and a third-party module (`github.com/...`) all fail the proof and stay silent.
The bounded audit (`validation/m14/fixtures/go/probe-go-claim-edges.ts`, first 60 stride files)
reads 564 claimed edges back against the WRITTEN import specs: qualifier-not-imported 0,
module-not-stdlib 0, shadowed-by-file-declaration 0, claim-without-qualifier 0.

**What it does NOT do, stated so the column is not read as stronger than it is.** It never raises
`resolved`; it does not change a target; it is a claim about the target's ORIGIN, verified by the
closed set rather than by the key-space lookup (for a bare target the lookup returns 0 by
construction, so it can never manufacture a refutation). It deliberately leaves 8,232 calls and 4,269
references unresolved: a receiver method's declaration cannot be proved external from a per-file
import list, and an unqualified type leaf has no owner to prove.

**Why NOT `baseBeyondRunScope`.** Measured against the arbiter's own `classifyEdge`: the cause
channel requires `base === targetOwner(target)`, and `targetOwner` of a bare leaf is null, so the
lane's own `reasonCode` placed on that key reads `causeRefuted` on **24,385 of 24,385** unresolved
edges. Qualifying the target would make the claim attachable (`~4,983` calls and `~3,950`
references at cap 400), but it would break the family leaf contract pinned by
`go/incoming-resolve-outgoing-only` and `go/relationship-and-payloads`, reopen the R10
`references|.`/`calls|.` separators, and require a clause-3 ruling for every qualifier name in a
shared instrument file. See `validation/m14/proposals/go-cause-channel.md`.

## STDLIB MULTI-SEGMENT IMPORT CITATION — `languageNamespaceSlash` (2026-10-19, task-38)

**What it is.** The `isStdlib` claim above reaches only SINGLE-SEGMENT module paths: the arbiter
sends a path-shaped target (`encoding/json`) to its path cases, where an external claim reads
`externalUnverified` — a clause-1 failure exactly as `unresolved` is. So the 208 stdlib
MULTI-SEGMENT imports of the cap-400 stride stayed unresolved although they cite a CLOSED,
language-level vocabulary. The lane now cites them through the namespace mechanism, with the
Lead-ruled **opt-in slash separator**.

**The ruled mechanism (Lead §21.21, Option A-modified).** `metadata.languageNamespaceSlash === true`
makes the arbiter's `namespaceMatchOf` split the target on `/` in addition to `.`, `::` and `:`.
Without the marker every other lane's citation arms are byte-identical — the opt-in is what keeps
this from being a global separator change.

**Emission (imports edges ONLY).** For an `imports` edge whose target is an import PATH read from
THIS FILE's import literal, with **≥2 `/`-separated segments** whose FIRST segment is a member of
the CLOSED `GO_STDLIB_TOP_LEVEL` set:
```
metadata.languageNamespace       = [<first segment>]     // exactly the cited root
metadata.languageNamespacePolicy = "strict-absent"
metadata.languageNamespaceSlash  = true
metadata.stdlibModule            = <full module path>     // evidence, not a claim key
```
`isStdlib` is deliberately NOT added on these rows: single-segment rows keep the existing
`isStdlib` route, so the two claim families never meet on one edge. **No shape heuristic is used** —
the forbidden sweep (`!includes(".")` ⇒ stdlib) would also claim a project-local `internal/util`; a
domain (`github.com/...`), a project path (`internal/...`) and an aliased path all fail the CLOSED
root test by construction. A wrong or non-listed root is REFUTED by the arbiter (fail-closed), never
resolved.

**Measured.** Eligible rows recomputed independently from the dump with the closed set (not from the
emission): cap-400 stride **208** rows (the earlier "stdlib-shaped" heuristic said 209; one row's
first segment is outside the closed vocabulary, so the ruled emission correctly does not claim it);
the `gql-gqlgen` chunk dump (888 files, the first baseline chunk) **414** rows exactly. The
whole-population count is the sum over the 27 per-repo chunk dumps as they are recorded.
Two-direction fixture `go/stdlib-multisegment-claim` pins claimed forms (`encoding/json`, `net/http`,
dot-aliased `net/url`, blank-aliased `crypto/sha256`) and FORBIDS the claim on `fmt` (single-segment
control), `github.com/...` and a project-internal path. Arbiter verification:
`bun run script/m14/go-stdlib-multisegment-census.ts --verify` — claimed rows verify, unclaimed stay
unresolved, a non-matching root refutes, the old `isStdlib` route is intact; the same instrument
prints the documented dotted-root leak (`github.com/...` claimed with `["github"]` verifies) as the
reason the emission vocabulary is closed.

**Pre-registered falsifiers for the arm:** any `extFAIL` on newly reached rows; any other lane's
`ext?`/`extFAIL` change (the opt-in makes it structurally impossible, the arm re-checks); any
`resolved` displacement. Expected at cap-400: 208 rows `unresolved → extOK` (clause-1 failure count
23,074 → 22,866).

## Supported constructs

- Fixtures: `validation/m14/fixtures/go/` — 32 fixtures, all passing. `service.go` (positive) and
  `Negative.go` (negative) in `validation/m12/fixtures/go/` are read by `script/m12/verify-analyzer.ts`.
  Four are new in this round: `exports-contract`, `overrides-promotion`,
  `overrides-qualified-embed`, `error-recovery-empty-type`.
- Covered: package/module declaration; `type` declarations of every body kind (struct, interface,
  alias, named basic type); struct fields including anonymous/embedded fields and tags; functions
  and methods with parameter lists and result lists; package-scope `var` and `const` specs;
  import declarations single and grouped; selector calls, goroutine spawns and deferred calls;
  constructor-shaped instantiation; composite-literal construction; qualified-type references;
  the exported top-level surface; method-promotion shadowing.
- Negative contract the fixture pins: function-local `var`/`const` and their specs are NOT
  symbols, and function parameters are NOT symbols.
- Mutation: `script/m14/go-mutants.ts` holds **17** go mutants and
  `script/m14/go-mutant-run.ts` runs them against the real fixture runner using the master
  runner's own comparison rule. Measured 2026-10-03: clean run 22 pass / 0 fail, then **17 of 17
  caught, 0 survivors**. The registry is wired into the MASTER-owned `mutate-analyzer.ts`
  `MUTANTS` array by the same two lines the fsharp lane used; that wiring is reported, not made.

## Limitations (declared, per honesty contract §3)

- **Heuristic call-edge and construction inference.** 5,115 `instantiates` edges, of which 1,115
  (22%) are composite-literal constructions published at confidence 0.6 — the only sub-0.7
  population in the lane. They are a convention (Go has no `new`), not a declaration.
- **`exports` does not carry the whole exported surface.** 22,089 capitalised package-scope
  declarations in the 2,000-file draw become 18,197 edges. The exclusions are decisions, not
  omissions in the measurement: package-scope VARIABLES and METHODS ride `contains`, because
  membership rides `contains` and the M49 JVM-closure F3 invariant requires export names to be
  unique and top-level-resolvable (Go permits `type Foo struct{}` and `var Foo = …` in one
  package, and two types each declaring `Read`). Both are pinned FORBIDDEN in
  `go/exports-contract`. A consumer asking "what does this package export?" gets the top-level
  units, not the full Go export list.
- **Cross-package and cross-file method sets.** The `overrides` pass resolves a promoted method
  against the embedding closure **as this file declares it**. A method promoted from another file
  of the same package is not in the closure (measured: 1,006 package-wide sites vs 161
  same-file), and an embed of another package's type is not followed at all (107 stdlib sites
  resolvable in-corpus, 74 external embeds left UNRESOLVED). **Absence of an `overrides` edge is
  therefore not evidence of absence of shadowing.**
- **The pre-existing `implements` promotion path reads `extends` targets by leaf and does not
  refuse a qualified embed** — the same leaf-collision that made the first `overrides` pass
  publish a false edge (see `go/overrides-qualified-embed`). Not changed here because that path
  is mirrored rule-for-rule by the differential's oracle and altering one side would break the
  symmetry the lane maintains. **A defect candidate for a follow-up round, not a ruling.**
- **Non-identifier endpoint residue.** 1 edge in 2,000 files publishes `references global -> ☹x`
  from `src/cmd/compile/internal/types2/testdata/local/issue68183.go`, a 29-line file that exists
  to test the parser's handling of invalid identifiers. The name is written in the file and is
  not a legal Go identifier, so nothing can ever bind to it.
- **A single process cannot measure this corpus, and the failure mode is silent.** An unsharded
  2,000-file run of the lane's own endpoint probe dies with
  `[BB-PARSE-ERR] go | …/cmd/compile/internal/test/testdata/arithBoundary_test.go | memory access out of bounds`
  followed by `[BB-HANG] parser stuck 120s on the same file — exiting`. That guard is a
  `process.exit` in MASTER-owned `engine.ts`, so a probe cannot catch it: the run reports on the
  files it reached and stops, which reads exactly like "no endpoint defects". Every corpus number
  in this document is therefore sharded across processes, and `go-endpoint-probe.ts` grew
  `--shard=i/n` for exactly this reason. A reader who re-runs any of these instruments WITHOUT
  `--shard` will get a smaller, cleaner-looking answer.
- **Grammar-recovery shapes.** Where the pinned grammar cannot parse valid Go, the analysis is
  incomplete rather than wrong: the analyzer reports the region as a parse error and continues.
  The M12 census measured 5 grammar-error files in 400 on the older `go-tools` corpus; the
  `go-tools` checkout is **no longer present** on this box (`fixtures/repositories` has
  `go-stdlib` and `cobra` for Go), so the differential's pinned primary corpus for this lane
  cannot be run as pinned — every number in this document is on `go-stdlib`/`cobra` instead.
- **Grammar-version drift.** The analyzer references 54 node types of `tree-sitter-go`; the
  grammar audit passes with 0 unknown, but the wasm is not registered in
  `validation/m14/grammar-pins.json`, so a swap of the wasm would be silent.

## Unsupported / explicit-unknown constructs

- Function-local declarations are out of scope by contract (see above), so a symbol census
  over a Go file will not include locals.
- Methods declared in a *different* file of the same package are visible to the
  interface-satisfaction check (receiver-type names with no same-file `type` declaration become
  implementor candidates) but a method declared in a *different package* is not. That is a
  per-file analyser's boundary, not a bug, and it is stated rather than approximated.
- `//go:generate`, `//go:linkname`, cgo, and assembly are not interpreted.
- Dynamic dispatch through `interface{}` values is not resolved: Go's method set is known
  statically per type, so there is no dynamic edge to invent here, but a value stored in an
  `interface{}` and called through a variable name of that type resolves only if the variable's
  declared type is visible in the same file.

## Regex inventory

Measured with the repository's own scanner (`script/m12/regex-census-core.ts`, driven through
`script/m12/census-truth.ts scanHeadAnalyzers()`, which scans the **committed** analyzer
blobs), re-run 2026-10-02:

| File | HEAD regex usages | Census entries |
| --- | --- | --- |
| `real-go-analyzer.ts` | **0** | 0 |

Baseline at M12.01 was **9 usages** in this file (struct-tag parsing, `@Router` comment
scanning, import-path quote stripping, pointer/slice marker stripping, signature
normalization). The M12.22 audit replaced all 9 with pure char scans / AST token children.
The "census 95 → 86" figure this document used to carry is **not reproducible from the
committed artifact**: `validation/m12/results/regex-census.json` (generated 2026-09-28) records
`totalRegexUsages: 26` across 43 analyzers, and carries no per-file total for the pre-M12.22
state. Treat the 9 → 0 reduction as the documented history and the 95 → 86 totals as
UNVERIFIED. The code added in this round uses `String.includes` and char-code tests only, so the
zero stands.

The census gate itself is currently red **tree-wide** (`bun run script/m12/verify-regex-census.ts`:
`missing from census: 24, stale in census: 25`). None of those 49 findings are in this lane —
the stale rows are fsharp/vue/typescript/svelte/clean/javascript/python and the missing rows
are css/julia — but the gate does not pass, so "zero regex for go" is a per-file measurement
and not a claim that the policy gate passes.

## Complexity envelope

`validation/m12/results/go-complexity.json`, sealed 2026-09-14. Quoted verbatim:

| Run | files | symbols | relationships | wall ms | symbols/s | relationships/s | peak RSS |
| --- | --- | --- | --- | --- | --- | --- | --- |
| fixtures | 2 | 30 | 34 | 1112.66 | 26.96 | 30.56 | 188,014,592 |
| corpus_subset | 400 | 7157 | 28187 | 25066.99 | 285.51 | 1124.47 | 373,858,304 |

Declared budget: **none recorded for this lane**, and the M60 register now says so explicitly —
`validation/m60/analyzer-budget-register.json` records go as `unscorable`, severity 5, status
open, with four named reasons (no loadRule, no corpusManifest, no loadAvg1, no userCpuMsPerFile on
the corpus row). The payload/latency table above is this lane's own replacement for the missing
budget: one named draw, user-CPU latency, and the serialized payload both ways. What would close
the register row: a `go` entry in the register with a numeric bound, plus a per-phase timing
breakdown.

Hot-path audit: all hot paths are single-pass over per-file symbol sets; the interface
implementation check is a bounded interfaces × structs pairwise match (Rust-family pattern). One
superlinearity was found and removed in this round: the `overrides` pass rescanned the whole
method list for every embedded type of every method (O(methods² × embeds) on a single file, and
`src/go/types` and `cmd/compile/internal/types2` carry hundreds of methods each); it now indexes
methods by receiver once. **The remaining claim is structural — reasoned from the source, not
profiled.** What would verify it: a per-phase timing breakdown on the 400-file sample.

## Differential ground truth

- Ground truth: `validation/m12/ground-truth/go.json` — hand-audited, authority
  `manual_audit` (the artifact records `truthSource: "manual_audit"`,
  `truthReference: "validation/m12/fixtures/go"`).
- Result: `validation/m12/results/go-differential.json`, sealed **2026-09-28T02:54:45Z**.

**The claim this section used to make — "1.000 precision / 1.000 recall, 0 FP / 0 FN /
0 unknown on 64 facts" — is false against the committed artifact.** What the artifact records:

| Field | Value |
| --- | --- |
| `passed` | **false** |
| expected facts | 64 |
| true positives | 60 |
| **false positives** | **20** |
| **false negatives** | **4** |
| unknown | 1 |
| unsupported | 0 |
| **precision** | **0.750** |
| **recall** | **0.9375** |
| `earliestFailingLayer` | `ast_extraction` |

The 64-fact denominator is right; the ratios were not. The recorded false positives include
`rel:service.go:imports:service:fmt` and `rel:service.go:imports:service:strings`, and the
recorded false negatives are the matching `references:…` rows — which is the `imports` relabel
described in the ontology table above, seen from the oracle's side. The artifact predates that
relabel, so its rows describe a state the analyzer has since left.

**Evidence level: L0 — STALE, and it cannot be quoted as a current number.** The artifact
records the input hashes of 62 files, and 47 of them no longer match the working tree,
including the analyzer itself. Under `docs/M14-HONESTY-CONTRACT.md` §2, evidence whose inputs
have drifted is L0 and may not be documented as working.

**The M12 differential cannot be re-run for this lane as pinned**: its primary corpus is
`go-tools`, and `$HOME/fixtures/repositories/go-tools` does not exist on this box.
What was run instead, on 2026-10-03, is a **scoped** differential
(`--lang go --repo go-stdlib --sample 120`), which is what the six-questions table above quotes;
it writes no evidence artifact and refuses to replace the milestone's claim. The two runs were
made comparable by pointing `BB_M14_WORK` at a private cold-pool state and resetting the rotation
counter, because the default rotation draws a DIFFERENT file set per run and the first attempt at
this comparison produced a meaningless difference (truth 10,610 → 13,808 across two runs of the
"same" command).

Defects the M12.22 audit fixed, all pinned by the negative fixture. These are the doc's
substantive content and they still match the source:

1. **9 regexes** — struct tags, `@Router` comment, import quotes, pointer/slice markers,
   signature normalization → pure char scans.
2. **Locals as symbols** — function-local `var`/`const` (and their specs) no longer become
   symbols (C# `LocalsAreNotSymbols`).
3. **Struct kind** — `struct_type` → `struct` (was `class`).
4. **Embedding double-edge** — embedded types emitted BOTH `contains` and `extends`; now one
   `extends` edge only; field-type `uses` dropped.
5. **Pointer-receiver implements** — `implements *UserService -> Repository` →
   `implements UserService -> Repository` (plain source name).
6. **Call targets** — `s.repo.Save(user)` → `calls Save -> Save` (leaf), and stdlib
   `strings.ToUpper(v)` → `calls transform -> ToUpper`.
7. **Instantiates** — PascalCase top-level functions only; methods and unresolved stdlib
   leaves never instantiate.
8. **Selector uses source** — `uses s -> name` / `uses s.repo -> Save` → `uses Describe -> name`
   / `uses Save -> repo` (source = containing function, target = field leaf; call-callee
   selectors skipped).
9. **Package contains noise** — `contains service -> X` for every exported symbol removed.
10. **Goroutine/defer dedup** — `go process()` / `defer cleanup()` emitted duplicate `calls`
     edges; now deduped to one edge per (source, target).
11. **OwnerName contains pass** — struct fields, interface methods, and methods all get ONE
    `contains` edge via the ownerName pass.

## Corpus validation

- Corpus: `go-stdlib` @ `6f5c275e` ("cmd/go: read go.mod under the lock when selecting the
  toolchain"), external clone root `$HOME/fixtures/repositories/go-stdlib`, plus
  `cobra` @ `adbc881` as a second corpus. 11,826 admitted files between them.
- Earlier figures in this document — `go-tools` @ `bf54bcd2…`, 1,931 tracked files, a
  deterministic-first-400 sample, 5/400 grammar-error files, 20,149 ms — described a corpus that
  **is no longer on this box**. They are kept above as the M12 record and are not restated as
  current. The R14 census artifacts are `validation/m14/results/go-ontology-census-emission.json`
  (2,000-file emission draw, 6 shards merged), the six shard artifacts it is summed from under
  `validation/m14/measurements/go-census-shards/`, and
  `validation/m14/measurements/go-ontology-probes-full-corpus.json` (11,826-file construct probes).
  The endpoint-integrity and payload artifacts are `go-endpoint-integrity.json` and
  `go-payload-latency-{before,after}.json` in the same directory, and the 2,000-file construct
  probes are `go-ontology-probes-draw2000.json`.
- **A single long-lived process cannot measure this corpus.** The first full-corpus census run
  died at ~1,000 files with `[BB-PARSE-ERR] go | … | memory access out of bounds` followed by
  `[BB-HANG] parser stuck 120s` — the M49 W11 wasm-module degradation. The census therefore
  shards across processes (`--shard i/n`), and `script/m14/ontology-coverage-gate.ts`, which has
  no shard option, cannot complete a go run at all: measured, it aborts on
  `src/cmd/compile/internal/test/global_test.go` after admitting 16,993 files. Reported.
  Re-confirmed this round on a DIFFERENT instrument: the lane's own `go-endpoint-probe.ts` died
  the same way unsharded, which is why it now takes `--shard i/n` too. The census's own
  `--merge` also gained a check that the shards partition the draw (`filesOverlap`), because a
  merged per-type file count is only a distinct-file count when that holds.

## How to re-derive every number in this document

Each command is the one that produced the table beside it, with the shard set spelled out,
because an unsharded run of any of them produces a smaller and cleaner-looking answer (see the
W11 limitation above).

```
# verdict table + q4/q5/q6  (2,000-file emission draw, 6 shards, merged)
for i in 0 1 2 3 4 5; do
  bunx tsx script/m14/go-ontology-census.ts --repo go-stdlib,cobra \
    --sample 2000 --shard=$i/6 --out validation/m14/measurements/go-census-shards/s$i.json &
done; wait
bunx tsx script/m14/go-ontology-census.ts --merge \
  validation/m14/measurements/go-census-shards/s{0,1,2,3,4,5}.json \
  --out validation/m14/results/go-ontology-census-emission.json

# q3 differential (scoped; does NOT write the milestone artifact)
BB_M14_WORK=<private cold-pool state> bunx tsx script/m14/differential.ts \
  --lang go --repo go-stdlib --sample 120

# R7 endpoint integrity (2,000 files, 6 shards, merged)
for i in 0 1 2 3 4 5; do
  bunx tsx script/m14/go-endpoint-probe.ts --repo go-stdlib,cobra \
    --sample 2000 --shard=$i/6 --out <tmp>/s$i.json &
done; wait
bunx tsx script/m14/go-endpoint-probe.ts --merge <tmp>/s{0,1,2,3,4,5}.json \
  --merge-only --out validation/m14/measurements/go-endpoint-integrity.json

# payload/latency before+after (400 files; `before` = the d7726e15a analyzer blob)
bunx tsx script/m14/go-payload-latency.ts --label before --out <tmp>/pl-before.json
bunx tsx script/m14/go-payload-latency.ts --label after  --out <tmp>/pl-after.json

# fixtures + the 17 mutants
bun run script/m14/run-fixtures.ts --lang go
bun run script/m14/go-mutant-run.ts

# L2 grammar conformance
bun run script/m14/audit-analyzer-grammar.ts          # `go PASS refs=54 unknown=0`
```

**One gate in this chain cannot be run as written.** `differential.ts --emit` refuses a
lane-scoped artifact id: *"--emit has no declared artifact id for scope `go` — add one literal
emit call … beside clean's, because a computed id writes an artifact that M49
verify-evidence-identity reports as an orphan."* So the differential numbers above are terminal
output, not a committed artifact. Adding the `M14.0.F5.go` emit call is a MASTER-owned change and
is reported, not made.

## Node-type conformance

- Gate script: `script/m12/go-node-types-compare.ts`. (This file previously named it
  `script/m12/go-node-types-dump.ts`, which does not exist — a stale path.)
- Earlier claim: "29/29 analyzer node refs are emitted by the pinned grammar, 0 dead".
  **UNVERIFIED 2026-10-02.** The script could not be run here: it looks for
  `src/node-types.json` in `/tmp/ts-go-npm/package/` or `wasm/tree-sitter-go/`, and falls back
  to reading a grammar it also expects in `/tmp/ts-go-npm/package/grammar.js`; none of those
  paths exist in this tree and the `go` grammar is not vendored under `grammars/`. What would
  verify it: unpack the npm tarball to the expected path (or vendor `tree-sitter-go` under
  `grammars/`) and re-run the script.
- **What did run, 2026-10-03**: `bun run script/m14/audit-analyzer-grammar.ts` →
  `go PASS refs=54 unknown=0 unknownFields=0`. That is the L2 precondition (node-type references
  validated against the grammar's own surface), measured over the whole tree; the tree-wide gate
  exits non-zero on 4 unregistered literals in `cpp`/`rust`, none of them in this lane.

## Evidence pointers

- Fixtures: `validation/m14/fixtures/go/` (22 fixtures) · `validation/m12/fixtures/go/`
- Ground truth: `validation/m12/ground-truth/go.json`
- Differential: `validation/m12/results/go-differential.json` — **sealed 2026-09-28, stale**;
  the lane's pinned corpus is absent, see above
- Ontology census: `validation/m14/results/go-ontology-census-emission.json`,
  `validation/m14/measurements/go-ontology-probes-full-corpus.json`
- Complexity: `validation/m12/results/go-complexity.json` — sealed 2026-09-14, register row
  `unscorable`
- Corpus errors: `validation/m12/results/go-corpus-errors.json`
- Regex census: `validation/m12/results/regex-census.json` (no go entries)
- Corpus manifest: `validation/m12/corpus-manifest.json` → analyzer `go`
- Lane instruments (this lane owns them): `script/m14/go-ontology-census.ts`,
  `go-endpoint-probe.ts`, `go-denylist-probe.ts`, `go-overrides-diff.ts`,
  `go-payload-latency.ts`, `go-mutants.ts`, `go-mutant-run.ts`, `go-fixture-dump.ts`, `go-stdlib-multisegment-census.ts`
- Gate scripts: `script/m14/verify-analyzer.ts`, `script/m14/measure-analyzer.ts`,
  `script/m14/go-corpus-errors.ts`, `script/m12/go-node-types-compare.ts`,
  `script/m12/go-wasm-compare.ts`, `script/m12/verify-regex-census.ts`

## Issue

Closes M12.22 (GitHub issue #161). Relationship-type ontology round: `exports` and `overrides`
closed as GAPs with fixtures and mutants; R7 empty-name defect fixed; `keepSymbol` collision
reported.
