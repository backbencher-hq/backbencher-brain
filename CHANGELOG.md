# Changelog

## 0.1.0 — first public release

The first public release of Backbencher Brain (`backbencher-brain` on npm, `bb` on
the command line). Everything below is what a fresh `npm install -g @backbencher/brain`
gives you. The section still headed **Unreleased** further down was written against
internal builds and ships in this release; read it as the detailed change record
behind this summary.

### What ships

- **16 MCP tools**, served over stdio to any MCP host (Claude Code, Cursor, VS Code,
  Zed, and anything else that speaks MCP): `bb_search`, `bb_ask`, `bb_analyze`,
  `bb_graph`, `bb_impact`, `bb_patterns`, `bb_security`, `bb_doc`, `bb_visualize`,
  `bb_migrate`, `bb_cross_language`, `bb_edit`, `bb_index`, `bb_health`,
  `bb_annotate`, `bb_annotations`. Tool descriptors are the same for the CLI and the
  MCP server, and `docs/data/public-tools.json` is generated from the executable
  registry so the catalog cannot drift from the tool that answers.
- **50 language analyzers**, from TypeScript/JavaScript, Python, Go,
  Rust, Java/Kotlin/Scala/Groovy and C/C++ through to Haskell, Clojure, Clean, Erlang,
  Julia, Nim, Solidity, HCL/Terraform, Vue, Svelte and more. TSX, Sass and Terraform are
  aliases of the TypeScript, CSS and HCL analyzers, not extra languages; the editor lane
  covers 49 of the 50 (Objective-C is excluded because `.m` is shared with MATLAB) and 48
  carry recorded in-editor evidence. The list is the `SUPPORTED_LANGUAGES` map in
  `src/ast/engine.ts`; the site reads the same map.
- **A CLI with 14 commands**: `bb index` (build/inspect the index), `bb search`,
  `bb mcp`, `bb setup`, `bb stats`, `bb status`, `bb health`, `bb doctor`,
  `bb projects`, `bb onboard`, `bb tool`, `bb upgrade`, `bb version`, `bb help`.
- **An LSP server** (`dist/lsp/server.js` over stdio; the editor extension launches it) for the launch languages recorded in
  `src/lsp/launch_languages.ts` — hover, definition, references, document symbols,
  workspace symbols, call hierarchy. The launch set is extended only through the
  recorded wave protocol, so the set here is what the gates prove, not a promise.
- **Local-first by construction.** The index is SQLite, one database per project,
  outside your repository (`bb stats` prints the path). Nothing is uploaded, there is
  no account, no telemetry and no hosted service; semantic search needs a local
  embedding provider you choose (`bb setup`).
- **Edits that declare their limits.** `bb_edit` does AST-bounded write/update/
  insert/delete/refactor with pre-image checks, dry runs, batch atomicity and a
  formatter step that reports what it actually did. Every read surface carries a
  freshness block rather than quietly answering from a stale index.

### Install

```bash
npm install -g @backbencher/brain     # primary path, Node.js >= 18
bb --version
bb setup                              # optional: semantic search provider
bb index /path/to/project
```

`curl -fsSL https://backbencher.cc/install.sh | bash` and
`irm https://backbencher.cc/install.ps1 | iex` remain as alternatives: they install
the same npm package, and fall back to a checksum-verified GitHub release binary only
when npm is unavailable. Pin a version with `VERSION=0.1.0` in front of either script.
Windows, Linux and macOS are supported; the native modules (`better-sqlite3`,
`web-tree-sitter`) build through npm's normal platform support.

### Known limits, stated rather than buried

- Node.js 18 or newer is required; there is no bundled runtime.
- Parsing and analysis are static. Nothing here executes the code it reads, so a
  clean report is not a proof of correctness or security.
- The LSP serves the languages in the launch set; other indexed languages still get
  the MCP/CLI surfaces but not editor features.
- Semantic retrieval quality depends on the embedding provider you configure; the
  lexical/graph surfaces work without one.
- `npm upgrade`/`bb upgrade` move you to the next published release; the index schema
  migrates in place and is never wiped by an upgrade.

### Version numbering

`0.1.0` is the first public version. Earlier internal builds counted up to `0.3.0`,
and a separate pre-release binary product used `1.0.x` version numbers; neither is
continued here. No `1.0.x` artifact was ever published to npm, and the `1.0.x`
installer line is retired — the installers in this repository install
`backbencher-brain` from npm.

## Unreleased

### The editor surfaces stopped disagreeing with each other

Four surfaces answer "who uses this symbol": the hover card, `bb/graph` `mode:"usages"`
(the hub), `textDocument/references`, and the hover's own `connected:` line. Measured on a
real index over real stdio, one symbol produced four numbers — `greet` reported 6 usages in
prose while its own connections line listed 3 callers, the hub listed 6 caller groups, and
references returned 7 locations. Each number was individually defensible: they counted
different things, and none of them said what.

They now count one thing and say so. A **usage site** is a stored relationship row whose
target is the symbol and whose kind is not a declaration containment, owned in one place
(`src/lsp/relations.ts`); a **count** is a count of served positions, and the unit sentence is
the owner's single copy quoted by every surface. The hover's count equals its rendered rows
plus a declared remainder; zero is stated rather than omitted.

Three separate lies were removed to get there, each found only because a human read the
surface:

- **The hover's "usages" list was not usages.** `greetAll` has zero callers and rendered
  "3 usages" listing its own class (`Greeter`) and its own callee (`greet`). Declaration
  containments now render in their own labelled section and never in the usage list or the
  connection summary.
- **The hub served the owner-family cascade as callers.** A method with **zero** callers
  answered six caller groups — every class member's referrers plus the class's own
  instantiators — so "who calls this" listed symbols that never call it. Cascade rows are now
  excluded **and counted** per bucket (`selfReferentialRows`, `declarationContainments`,
  `ownerFamilyRows`), with `callerCandidateRows` on the payload so every excluded row is
  accounted for. The naive fix — drop everything not adjacent to the root — was measured and
  rejected: it deleted the hub's legitimate transitive call tree. The law that satisfies both
  is that a deeper row is served only when it extends an already-served chain.
- **The class's caller list carried a member's own call**, re-attributed to the class. It now
  equals the class's usage sites.

`script/m55/verify-relations.ts` grew four cross-surface assertions (`R3b`) that pin the
agreement on the wire: a zero-caller symbol answers zero from hover, references and the hub;
an empty answer is empty *by a declared filter* whose counts close the row arithmetic; a
symbol with callers reconciles as groups = usage places + the declared unlocatable referrers.

### A position a surface could not know is no longer shown

Three classes of invented position, all found by reading rendered surfaces:

- **The hover served stored call-site lines past the end of the source.** A three-line file
  with rows stored at lines 40 and 41 rendered two usage links that opened past the file.
  The hover now applies the same line bound `textDocument/references` applies
  (`createPositionMapper(text).lineTexts.length`), refuses to serve such a row, and declares
  the count: *"usages omitted — N stored rows name a call-site line past the end of the source
  file"*, with `data.omittedUsageRows`. Measured before/after: collector sites 2 → 0,
  `omittedUnresolvable` unchanged at 2. The agreement is gated, not described.
- **Call hierarchy listed the root as its own caller and callee**, pointed every `fromRanges`
  entry at a declaration instead of the call site, and threw `-32603` when a caller was
  expanded. Self-edges are dropped and **declared with their reason**; ranges come from the
  M62 address owner and carry the declared unknown where the store holds no real line.
- **Outgoing connected/containment links opened the far end's file at the caller's stored
  line** — a link labelled "instantiates [Greeter]" that opened `greeter.ts:4` when the site is
  `app.ts:4`. Outgoing rows now open the far end's declaration and never turn a stored line
  into a link target for a different symbol.

A new absence code `no_stored_calls` distinguishes "served symbol with an empty call list" from
`symbol_not_at_position`, which was false for it — a machine-readable code a client may branch
on must not contradict the answer.

### The hover's relationship denominator was ten kinds against an index that stores fourteen

`decorates`, `renders`, `mixes_in` and `part_of` were stored, classified by the hover's own tier
owner, and could not be rendered or declared because the denominator and the verb table stopped
at ten. All fourteen now have a denominator entry, both-direction verbs, and — for `part_of` —
a declared absence instead of a link (a module-level inclusion, like `imports`, is not drawn as
a symbol link). The drift gate that catches this was itself anchored on a file the kind
enumeration had moved out of, so it had been reporting a refactor as a pass rather than
checking a fact.

### Warm hover latency: p95 51.31 ms → 9.82 ms

The warm budget is 50 ms (§3). One of three busy shapes missed it. The cause was not the parse:
the hover resolved a full call-site location for **every** row and then discarded it for any row
whose stored call-site line was real, so a 32-file symbol paid 30 file reads and 60 position
mappers per request for positions nothing later read. Now a row with a real stored call-site
line is served from `(caller path, stored line)` validated only by the line-count bound, and
line counts ride a bounded LRU keyed by `(path, mtimeMs, size)` — stat-only on a warm hit,
re-read on any mismatch. Measured with load average 20.67 on 8 CPUs: shape A p50 6.62 ms /
p95 9.82 ms; shapes B and C under 5 ms. No regex was introduced (regex policy: 0 new).

### The extension activated on 7 of the 14 languages the server serves

`src/lsp/launch_languages.ts` is the single owner of the launch set (14 languages), but
`package.json` `activationEvents` and the client's `documentSelector` listed 7. On a Go, Rust,
C, C++, Vue, Svelte or Zig file the extension never activated; in a mixed workspace VS Code
sent no requests for those files at all. Both lists are now derived from the owner through a
type-enforced language-id table, and `esbuild-extension.mjs` fails the build if
`activationEvents` drifts from the launch set.

### The status-bar badge was dead on three paths

Clicking the `bb` badge opened nothing when there was no workspace folder (a single file
opened), when the server was not resolved, or when the server version was incompatible — the
click target was assigned only on the success path. The command is now assigned at creation and
every command is registered before any early return, so no badge renders without a working
click.

### A claim ladder with three definitions

The I0–I5 levels were defined three times and disagreed: the contract said I2
INDEX-CONFORMANT / I3 EDITOR-VERIFIED / I4 FORK-VERIFIED, the extension README said
RUNTIME-PASSED / IN-EDITOR / CROSS-EDITOR, and the status model said HARNESS-VERIFIED /
EDITOR-VERIFIED / PRECISION-VERIFIED. The website rendered two of them side by side. The
contract is governing; both other copies now defer to it and define no second ladder.

### Verification machinery repaired

Six gates were red or silently not running, each for a reason unrelated to the product:

- `verify-relations.ts` M4 anchored on a source expression M62 had moved behind the
  single-owner constant `STORED_LINE_COLUMN`, so it matched zero times.
- `verify-call-hierarchy.ts` C1 asserted a store shape the engine stopped producing in
  `2617ac1bd` ("an unresolved target is reported as unresolved, not matched by name"); it is
  now a hermetic planted-row test, and the seven free verdicts it caused are gone.
- `verify-hover-coverage.ts` V1c read `src/mcp/tool-registry.ts`, where the relationship-kind
  enumeration no longer lives, and its machine metadata shelled out to
  `sysctl -n hw.ncpu`, which crashes on Linux before any result is written.
- `verify-evidence-tree-clean.ts` counted ~6.7k **deliberately gitignored** research artifacts
  as "scratch" while its own self-check asked git the same question and got a different
  answer; and its EVID-TREE claim declared only verifier paths as coverage, so the fingerprint
  could not discriminate and the gate threw on every run that reached the evidence write.
- Four gates (`verify-server`, `verify-usage-scope`, `verify-usages-fallback`) did not pin
  `BB_DATA_DIR`, so on a host with a read-only `~/.bb` every absence-carrier path died with
  `-32603 ENOENT` — a red gate about the sandbox. They now pin a temp data dir unless one is
  supplied, and `L1` is 142/142 reproducibly.

### Documentation and tree hygiene

Documentation now states measured fact rather than narrated decision: the "owner said",
"his words" and "owner live test" framing is gone from the IDE documents and from the
analyzer header template that taught it. Thirteen superseded/duplicate documents and twelve
stray root files (six ad-hoc probes referencing a path that does not exist in this layout, a
certificate log, two XML probes, two superseded root docs, an unused wasm copy) were removed
after a reference grep proved nothing cited them. A new `docs/IDE-LANE-BASELINE.md` records,
per record, what the documents claimed, what the record claimed, what the gate returned at
HEAD, and what is actually true — four different states that had been collapsed into one.

### A `callers` count was not a count of calls

The graph engine's default covers every relationship kind the index stores — documented, and
deliberate, because `contains` is the parent→member edge and excluding it stops a traversal rooted
at a class from reaching that class's own methods. Three consumers in `src/` read that set while
making a claim about one kind:

- `testImpact` published a depth-0 row from a test file as a DIRECT test without asking what kind
  of row it was, so a test class that *contains* the symbol under test answered as a test that
  depends on it — and `testSuggestions` stamped that `direct_call` at 0.85 confidence.
- `testSuggestions`'s `blastRadius`, labelled "caller closure", counted containment and lexical
  rows, and it feeds `priorityFor`, so structure inflated a priority.
- the deprecated `analyzeImpact` (not reachable from any tool since M48) fitted every kind into
  `directSymbols` / `affectedFiles`.

Measured on a fixture whose store holds, from the real analyzer, `realTest --calls--> nested` and
`TestHost --contains--> nested`: the unscoped walk returns both callers, the scoped walk returns
one, and the tool now reports `directTests: [{ testSymbol: "realTest", relationshipType: "calls",
evidence: "direct_call" }]`. `TestImpactReport.directTests` / `indirectTests` and
`AffectedTestEntry` now carry `relationshipType` and `evidence`, so "directly a test" is never
published as "directly calls". `testSuggestions` walks `bb_impact`'s declared dependency rule
(`IMPACT_REL_TYPES`, one list, imported from its owner) instead of every kind.

`bb_analyze`'s page said nothing about the kind set its `callers`/`callees`/`trace` modes walk; it
does now, including that mode `impact` walks the declared dependency rule instead — so a `callers`
count and an `impact` count about the same symbol are not the same question, and both name the rule.
Pinned by `script/m65/verify-edge-kind-scoping.ts`: an inventory of every graph call site in `src/`
(an unscoped one must be a declared all-kinds door), a fixture differential against the store, two
mutations, and source guards so a reverted filter fails the gate.

### The public surface grew from ten to sixteen

The 0.3.0 section below describes that release's surface, and it was accurate when it
was written (2026-08-09). Six tools have been added since, so the live surface is
sixteen — the number is now read from `docs/data/public-tools.json` wherever it is
needed instead of being restated:

- `bb_index` — reindex a file or directory so the index reflects edits immediately,
  plus `mode=post` to re-run derived phases without re-parsing.
- `bb_graph` — per-symbol callers/callees at a declared depth, with per-edge evidence
  tier and confidence from the canonical graph engine.
- `bb_impact` — bounded reverse-dependency impact with a declared node budget and an
  echoed relationship-type rule.
- `bb_cross_language` — stored cross-language facts for one symbol, with absence
  declared rather than inferred when the store holds none.
- `bb_annotate` — write an agent-authored note with `author_class` enforced at the
  schema level, never spoofable.
- `bb_annotations` — read notes back with full provenance and a declared bound.

Same release window, same defect class: `README.md` and both MCP acceptance harnesses
(`script/verify-mcp.ts`, `script/verify-mcp-e2e.ts`) had kept the old count in prose and
in an assertion. The stale assertion failed at command 125 of 358 in `npm run verify`,
which made the 233 commands after it unreachable — so nothing downstream could notice.
Both harnesses now derive the expected surface from the contract file, cover all sixteen
tools (five had no MCP-level test at all, and `bb_index` had never been called as a tool),
and fail with a named missing/undeclared list rather than a bare number.

## 0.3.0

### Intelligence Tools Rebuild

- Published the final ten-tool MCP surface: `bb_search`, `bb_ask`, `bb_analyze`,
  `bb_patterns`, `bb_security`, `bb_doc`, `bb_visualize`, `bb_migrate`, `bb_edit`,
  and `bb_health`.
- Removed compatibility aliases after the announced breaking-release window:
  `bb_select`, `bb_relationships`, `bb_refresh`, `bb_write`, `bb_update`,
  `bb_insert`, `bb_delete`, `bb_refactor`, `bb_test_quality`, and
  `bb_test_suggestions`.
- Replacements are `bb_search mode=symbol`; `bb_analyze` callers/callees/trace and
  test modes; `bb_health refresh=true`; and `bb_edit` write/update/insert/delete/
  refactor modes.
- Removed alias-only stale-index mutation exceptions. Canonical symbol mutations
  require current indexed AST bounds.
- Preserved internal indexing, semantic, graph, analysis, test, edit, health,
  documentation, visualization, and migration engines. They are implementation
  layers, not separately advertised MCP tools.

Historical migration details remain in `archive/docs-pre-consolidation/MCP_TOOL_MIGRATION.md`.
