<!--
Author: Muhammad Ishaq Khan

WHAT THIS DOCUMENT IS — the Phase A audit of the public MCP tool `bb_doc`: every mode, option, citation, freshness path, budget rule, doc claim and gate measured against the working tree, with defect severities, exact evidence and the Phase B fix plan.
WHO IT IS FOR — the owner of `bb_doc` and the Lead reviewing the campaign's doc lane.
EDIT TOGETHER WHEN THIS CHANGES — validation/tools/bb_doc/LATENCY.json (the measurements this document quotes), validation/tools/bb_doc/probes*.json (the probe records), and the Phase B changes named in §15.
-->

# `bb_doc` — Phase A audit

Working tree: branch `main` at HEAD `c43282e92` plus the Lead's module split (uncommitted).
Tool: `backbencher-brain` 0.3.0, 16 public tools; `bb_doc` is read-only, requires an index,
7 modes (`symbol`, `file`, `module`, `feature`, `api`, `project`, `coverage`).

Measurements were taken with `BB_NO_AUTO_REFRESH=1` for every read (charter §3.6) and with
`BB_DATA_DIR=validation/tools/bb_doc/bbdata` for fixtures, so the shared `.bb-data` index was
read but never written. T2 is the live `.bb-data` reference index.

Artifacts behind this audit (all under `validation/tools/bb_doc/`):

| File | What it records |
|---|---|
| `LATENCY.json` | T0/T1/T2 warm latency, 5 runs/mode, p50/p95, exact commands, budget breaches |
| `probes.json` | 204 dispatch-path observations (modes × options × targets × refusals × empty project × determinism × engine predicates) |
| `probe-refresh.json` | 23 observations of the inline auto-refresh contract (stale, deleted, declined, budget) |
| `probes-extra.json` | 16 observations of relationship citations, markdown links, source bounds, T2 project bound |
| `logs/*.log` | raw stdout of every gate command and every measurement run |
| `logs/gate-exitcodes.txt` | the gate table's exit codes as they were read |
| `probes-*.ts`, `measure.ts` | the probe/measurement programs, rerunnable from the tree |

---

## 1. State summary

The tool is structurally sound: all 7 modes run through the real MCP dispatch path, every mode
emits its declared section set, an empty result does not report `passed`, citations resolve to
files and spans for the kinds that carry a path, the freshness envelope is present on JSON, the
inline auto-refresh works and declares itself, and the token budget machinery holds its own
arithmetic identity (`emitted + droppedForBudget === capped`).

It is **not** correct yet in five places a caller can see, and its gate set has three regressions
caused by the module split plus one assertion that only fires in a non-default environment:

| Severity | Count | Defect class |
|---|---|---|
| High | 1 | A documented relationship fact is measurably false on inbound edges (`main calls main`) |
| Medium | 9 | Stale/missing counts contradict the emitted citation list; markdown footer names the wrong surface; two curated pages deny behaviour the tool has; the generated page promises a file-scope remediation the handler never emits; `includeTests` is a no-op in all seven modes; `limit`/`maxTokens` are silently clamped or reinterpreted; the project/coverage symbol-selection bound is undeclared |
| Low | 9 | Doc drift in the three curated pages (examples, reference, design spec); unreachable documented cap; relationship citations without a path; API-mode target/surface notes |
| Gate | 5 | Two gates crash/red on the split, one has an environment-vacuous assertion, one is blocked by its own MCP child's env, one can only report `known-gap` until the split is committed |
| Latency | 2 | T2 every mode except coverage exceeds the 5 s budget (p50 2.2–7.0 s); feature mode is 19–52 s and exceeds the 30 s client timeout |

Latency, stated plainly: on the reference index a **default-argument `bb_doc` call costs seconds**,
not the 5 s budget, and `feature` mode is a timeout risk. `coverage` is the only mode inside budget.

---

## 2. Surface inventory (post-split)

| Artifact | Path | Notes |
|---|---|---|
| Descriptor | `src/mcp/tools/bb_doc/descriptor.ts` | Lead-seeded §8 header; description, schema, modes, defaults, examples |
| Handler | `src/mcp/tools/bb_doc/handler.ts` | Lead-seeded header; the pre-split handler body moved verbatim |
| Engine | `src/intelligence/documentation/doc-engine.ts` (2,478 lines) | no author header; carries milestone-narrative comments (§11) |
| Evidence fingerprint | `src/intelligence/documentation/evidence.ts` | `DOC_EVIDENCE_PATHS` still names the pre-split `tool-handlers.ts`/`tool-registry.ts` |
| Generated page | `docs/tools/bb_doc.md` (147 lines) | generated; edit `script/tool-docs/curation/bb_doc.ts` |
| Curated page | `script/tool-docs/curation/bb_doc.ts` | returns/errors/limitations/performance/safety/evidence + relation line |
| Design spec | `docs/BB_DOC.md` (612 lines) | no markdown header; contains measured-history prose |
| Reference | `docs/BB_DOC_REFERENCE.md` (35 lines) | no markdown header; stale claims (§8 D5, D13) |
| Examples | `docs/BB_DOC_EXAMPLES.md` (196 lines) | no markdown header; example shapes do not match measured output (§8 D11, D12) |
| Registry assembler | `src/mcp/tool-registry.ts`, `src/mcp/tool-handlers.ts` | Lead-owned; still imported by `evidence.ts` fingerprints |

Contract sources of truth this audit measured against: the descriptor schema, `docs/BB_DOC.md`
(the design specification the engine's header names), the generated page, and the curated pages.

---

## 3. Mode matrix — measured on a purpose-built fixture (dispatch path)

Fixture: 5 indexed files (TS, Python, test, workflow YAML), plus a planted `net_http` framework
attribution, an `api_contract_path`, and an open analysis finding. All numbers are from
`probes.json` (`modeSummaries`).

| Mode | Required sections emitted | Facts | Citations (file/index) | Unknowns | `passed` | Budget estimate |
|---|---|---|---|---|---|---|
| `symbol` | api, behavior, dependencies, tests, limitations | 9 | 4 (2/2) | 1 | true | 1,326 |
| `file` | overview, public-symbols, dependencies, risks | 10 | 10 (5/5) | 1 | true | 1,498 |
| `module` | purpose, entry-points, public-surface, module-graph | 26 | 26 (17/9) | 1 | true | 3,169 |
| `feature` | entry-points, flow, components, test-coverage | 27 | 17 (12/5) | 16 | true | 3,602 |
| `api` | endpoints, inputs-outputs, errors, examples (+optional dependencies) | 10 | 8 (5/3) | 3 | true | 1,930 |
| `project` | architecture, inventory, risks, documentation-map (+optional dependencies) | 30 | 25 (16/9) | 5 | true | 3,755 |
| `coverage` | documented, undocumented, stale, unsupported | 15 | 16 (16/0) | 1 | true | 2,406 |

Checked for every mode and green: `quality.passed` equals the conjunction of exactly the four
documented terms; every non-`unknown` fact carries at least one citation; every `unknown`
names a rendered section; every file-backed citation exists on disk with an in-range line span;
the JSON envelope carries `freshness` with all six registered fields; markdown starts with
`# <title>` and carries `## Quality`; the Sources section appears iff file-backed citations exist.

Structural observations:

1. `api` mode found the planted `/login` contract (`P3.api.planted-endpoint-found`) and its
   `errors` section explains the index cannot record an error surface, as documented.
2. `coverage` classifies undocumented symbols as `classification: "unknown"` with
   `confidence: null`, and the `unsupported` section names the `#` comment marker for Python
   symbols the reader cannot see. Both are the honest shapes `docs/BB_DOC.md` claims.
3. `feature` mode's semantic discovery cannot be proved to have failed from the output: when
   `semanticVectorSearch` falls back instead of throwing, the section lead states
   "Candidates came from N lexical and 0 semantic match(es)" — declared, but not as an unknown.
   A caller cannot distinguish "no semantic matches" from "embeddings absent, keyword-only".
4. The index health line from the fixture proves embeddings are *absent* (`holds no vectors,
   semantic search is keyword-only`), yet `feature` mode still counts results from the fallback
   as `semantic`. This is the semantic cap in D15: the confidence rule keyed on
   `kind: "embedding"` citations can never fire.

---

## 4. Option matrix — every schema option, measured

`P2`/`P4` in `probes.json` and `~/.bb`-free dispatch through `validateToolArguments`.

| Option | Schema declaration | Measured behaviour | Verdict |
|---|---|---|---|
| `format` | enum markdown/json, default markdown | JSON: envelope + `reference`; Markdown: same document + freshness footer. Invalid value refused by the validator (`must be one of: markdown, json`). | truthful |
| `audience` | enum developer/maintainer/user/website | selectable none required; `maintainer`/`website` add optional `evidence-index`; tags carry the value; required sections never dropped. Invalid value refused. | truthful |
| `detail` | enum brief/standard/deep | per-section cap 5 / `limit` / `3×limit`; `brief` drops optional sections; `deep` adds optional `all-edges`. Invalid refused. | truthful |
| `includeExamples` | boolean | records an honest `not-observed` unknown; no examples are ever emitted in any mode. | over-promises (D14) |
| `includeDiagrams` | boolean | records an honest `not-observed` unknown; `reference.diagrams` stays `[]`. | truthful (but BB_DOC.md contradicts itself, D14) |
| `includeTests` | boolean, default false | **no-op in all 7 modes**: `symbol`/`feature` force test evidence on, other modes never render it, and `api` computes but never emits it. `includeTests:false` cannot suppress test facts. | defect (D7) |
| `limit` | number, no range, default 20 | clamped silently: `20→20`, `100→100`, `101→100`, `1000→100`, `0→1`, `1→1`; accepted by the validator, including 0 (validated as "non-negative"). | defect (D8) |
| `maxTokens` | number, no range, default 4000 | `1/50/500` honoured (budget `passed:false`, shortfall declared, required sections kept); `4000` default; `16000` ceiling honoured; `20000→16000` silently; `0→4000` (the smallest request becomes the default). | defect (D8) |
| `refresh` | boolean | `false` declines the inline repair with its reason; omitted/`true` repairs and regenerates. Works (see §6). | truthful |
| `mode` | enum, required | unknown/missing refused; handler-side message names the seven. | truthful |
| `target` aliases | `symbol`/`symbolName`/`query` → `target` | all three accepted; conflicting values refused; blank alias does not satisfy the required target. | truthful |

---

## 5. Target resolution

Measured (`P3`, `probes-extra`):

- `file` mode resolves an exact path, `./path`, an absolute path, a directory prefix, a bare
  basename with and without extension (`math`, `math.ts`). An absent path resolves to no file.
- The absent case's own explanation is `No indexed file matched this target, so there is nothing
  about it to describe.` — it does **not** say which of the four forms it tried.
  `docs/BB_DOC.md` §Modes line 186-189 promises it does (D16).
- `module` mode resolves a directory and a nested directory; a nonexistent module produces a
  document whose `purpose`/`public-surface`/`module-graph` are empty but whose inventory and
  entry-point facts are **project-wide**, and the result reports `passed: true` (D17, D9 sibling).
- `symbol` mode resolves by name, qualified name, and the last dotted/`::` segment.
- `feature` mode discovers candidates lexically over name/qualified-name/docstring and tops up
  semantically; every emitted fact still cites a symbol, file, relationship, import, test or
  health row — never an embedding row.
- `project` mode accepts and echoes a target in `title`/`canonicalPath`/`slugs` but does not use it
  to scope selection. That is undocumented (D10).
- `coverage` mode's target scopes the file selection, but classification covers at most
  `limit × 2` symbols, and the emitted document cites files only through `unsupported`/other
  sections — the files it examined are not credited as evidence.

---

## 6. Citations, freshness and inline auto-refresh

Citation resolvability: for `symbol`, `file`, `module`, `feature`, `api`, `project`, `coverage`,
every emitted citation with a `path` resolved on disk with an in-range `lineStart`
(`P1.*.citations-resolve`, `P1.*.citation-spans-in-file`, `E4.link-*`).
Markdown links `[n](path#Lx-Ly)` resolve to their Sources row.

Defects found here:

1. **Inbound relationship facts are false (D1, High).** On a two-file fixture, the document for
   `add` reports `math exports math.`, `app imports app.`, `main calls main.` — every inbound
   edge names the other symbol twice and never the documented symbol. The document for `main`
   reports `main calls add.` (correct outbound) and `app exports app.` (broken inbound).
   Root cause: in `addRelationshipFacts`, the inbound branch sets both `subject` and `other`
   from `otherSymbol`. `script/m20/verify-doc-truth.ts` T3/T19 cannot catch it because both
   tokens are symbol names — the predicate only asks whether a symbol is named.
2. **Relationship citation path and line can describe different files (D18, Low).** For an
   outbound edge the citation's `path` is the *target's* file while `lineStart` is the
   relationship's line in the *source* file, and freshness is resolved for the source file.
   Two of the fixture's three relationship citations carry no path at all and are rendered in
   the index-scoped list even though the edge names files.
3. **`quality.references.stale/missing` count collected citations, not emitted ones (D2,
   Medium-High).** Measured: T2 `project` mode reports `references.stale: 94` while the answer
   contains 7 citations; fixture `project` mode reports `stale: 56` with **0** emitted stale
   citations. The Quality block therefore tells a reader to find 56 stale sources in a Sources
   list of 10 that shows none — the exact "count a reader can check and finds wrong" failure
   `docs/BB_DOC.md` says condemns the whole block.
4. **Markdown stale footer names the wrong surface (D3, Medium).** With a stale cited file and
   `refresh:false` (or `BB_NO_AUTO_REFRESH=1`), the document footer is
   `1 stale, 0 missing of 2 findings' files — reads auto-refresh stale files…`. `findings` is
   the `bb_security` vocabulary; `bb_doc` cites documents, not findings. The shared
   `derivedStaleness` footer is used verbatim. `script/m20/verify-doc-truth.ts` T17 asserts this
   exact string is absent — and it goes RED when `BB_NO_AUTO_REFRESH=1` (the charter's mandated
   measurement environment); with auto-refresh enabled the handler repairs the file and the
   assertion passes **vacuously** (D22, Gate).
5. **The envelope is always project-scoped (D6, Medium).** The handler builds
   `buildStalenessEnvelope(..., { kind: "dir" })`, so a single-file document's JSON remediation
   names `bb index --changed` and the project path. The generated page's Staleness section
   documents a file-scope branch (`bb index "<file>"`) that this tool can never emit.
6. **A regenerated document can still cite stale files (D19, Low).** `file` mode over a
   30-file directory with all 30 stale: the repair set is computed from the pre-refresh
   citation list (3 files), the document is regenerated, and the regenerated document cites
   4 stale files, reported honestly in the envelope. The description's "auto-refreshes exactly
   those files" is therefore "exactly those files the pre-refresh document cited".
7. Auto-refresh itself works and is declared: `auto-refreshed 1 file in 4298ms (derived pass:
   bounded)`, the file is reindexed (hash changes on disk and in the index), the returned
   document reports the post-refresh line bounds, and the envelope is clean afterwards.
   `refresh:false` gives `auto-refresh disabled (BB_NO_AUTO_REFRESH or refresh=false)` and the
   answer stays marked stale. A deleted cited file is purged from the index (`1 deleted file(s)`)
   and no `missing` citation survives.

Index-scoped citations (`kind: health`) are excluded from the file-scoped envelope by design and
render in a separate `## Index` list, documented as such.

---

## 7. Token budget — the claim vs the wire

`P2.maxTokens.*`, `P7.estimate-is-not-an-undercount`, `probes-extra.json` E5/E6.

- The budget is measured on the engine's compact JSON object (`estimateTokens = ceil(JSON length/4)`)
  with a same-width placeholder in the reported field, then the loop halves the largest section
  until it fits, at most 12 passes; every drop is declared as an `output-budget` unknown; a
  required section always keeps at least one fact; the bounds identity is checked and the
  generator throws rather than publish a miscount. All of that is real and verified.
- What the caller receives is bigger: the handler adds the freshness envelope, the auto-refresh
  line and two-space indentation. Measured wire/estimate ratios: **1.37–1.47×** on the fixture and
  **1.26×** on T2. So `maxTokens: 4000` returns ~5,300 wire tokens.
- **The registry description says "the token budget is enforced against the whole payload"**;
  `docs/BB_DOC.md` §Quality is the honest version ("the returned object, not the wire bytes",
  measured 1.30–1.47×). A caller reading the tool description is misled by the executable contract
  (D20-meta / part of D14/D20).
- **T2 project mode cannot meet its own ceiling**: `maxTokens: 16000` on the reference index
  produced `estimated 18052`, wire 22,126 tokens, `budget.passed: false`, and 25,034 ms wall time.
  Reporting the shortfall is documented behaviour; the point is that this is a *legal default-
  ceiling* call on the campaign's reference index and it is both over budget and over the 5 s
  budget. The description's "enforced" language is false there, and the recommended remedy
  ("raise maxTokens") cannot help — 16000 is the hard maximum.
- `maxTokens: 0` → 4000 (default), `maxTokens: 20000` → 16000, both silent; the validator admits
  them. `limit: 0` → 1, `limit: 101` → 100, silent. D8.

---

## 8. Doc truth — every curated claim that can be checked, checked

The gate `script/m31/verify-bb-docs-truth.ts` validates the JSON fences of the `BB_*.md` pages
against the live registry and PASSES (61/61). The claims below are the prose claims it cannot
check, verified by hand/command:

| # | Page · claim | Measured | Verdict |
|---|---|---|---|
| D4 | `docs/tools/bb_doc.md` · **Safety**: "Read-only. It never refreshes implicitly…" | the handler auto-refreshes stale cited files by default; the same page's Staleness section and the registry description say so | **false** (curation) |
| D5 | `docs/BB_DOC_REFERENCE.md` · "Documentation generation does not … refresh the index" | same | **false** |
| D6 | generated page · Staleness names a file-scope remediation | handler always emits project-scope | unreachable branch |
| D11 | `docs/BB_DOC_EXAMPLES.md` · Symbol Markdown has `## Signature`, `## Dependencies`, `## Limitations`, `# \`handleRequest\`` | measured headings are `## API`, `## Behavior`, `## Dependencies`, `## Tests`, `## Limitations`, title `# symbol: handleRequest`; `## Signature` does not exist | drift |
| D12 | same · Project JSON has `completeness.expected: 2`, no `quality.bounds`, missing budget fields, `title: "Project reference"`, tags `["api","entry-point"]` | project declares 4 required sections; `bounds` is mandatory in the type; title is `<mode> documentation`; tags are `[mode, audience, detail]` | drift |
| D13 | `docs/BB_DOC_REFERENCE.md` · coverage lists "unavailable evidence counts"; api describes only contract paths/route-ish symbols | section id is `unsupported`; the only api input that has ever matched is the `net_http` framework route | drift |
| D14 | `docs/BB_DOC.md` · "Markdown may contain Mermaid with cited nodes and edges; JSON exposes reference.diagrams" vs Operational Limits "Diagrams are not emitted in this implementation"; "Examples are emitted only when…" | no diagram or example code exists | internal contradiction / over-promise |
| D15 | `docs/BB_DOC.md` · "semantic-only feature discovery is capped at 0.70" | no citation of kind `embedding` is ever created; the cap is unreachable | dead claim |
| D16 | `docs/BB_DOC.md` · absent file target "says which of the four forms it tried" | empty explanation names none | stale promise |
| D17 | `docs/BB_DOC.md` · module mode documents "module files, public surface, dependency relationships" | an unknown module still documents project-wide inventory/entry points and passes | scope leak |
| D20 | registry description · "token budget enforced against the whole payload" | 1.37–1.47× overhead disclosed only in BB_DOC.md | executable-contract drift |
| D8 | registry schema · `limit`/`maxTokens` | bounded/clamped, ranges undeclared | undeclared bounds |

Measured facts quoted in `docs/BB_DOC.md` that this audit could not re-derive (they name other
corpora and older runs): the `1 218 of 1 218` parameter-list measurement, the go_tools 281-symbol
breakdown, the 8-corpus `api` history, the 500-check bb_tests corpus run (the corpus directory
`bb_tests/` is absent from this checkout; 6 of its 10 repositories are missing here — see §13).
They are recorded as **unverifiable here**, not as false.

---

## 9. Gate inventory — 24 doc gates, command → exit code

Runtime: `bun run` (the commands the repository's `verify`/`docs:verify` scripts use).
Environment: `BB_DATA_DIR=validation/tools/bb_doc/bbdata`, `BB_NO_AUTO_REFRESH=1`, except where
noted. Exact raw output: `validation/tools/bb_doc/logs/gate-<gate>.log`.

### 9.1 The `bb_doc` suite (11)

| # | Command | Exit | Result |
|---|---|---|---|
| 1 | `bun run script/m13/verify-doc-facts.ts` | **1** | RED after the split: 3 checks grep `src/mcp/tool-handlers.ts` for the handler and the section no longer lives there (D21) |
| 2 | `bun run script/m13/verify-doc-modes.ts` | 0 | GREEN: all 7 modes through the CLI, missing-target and invalid-mode negatives |
| 3 | `bun run script/m13/verify-doc-e2e-corpus.ts` | **1 / 0** | exit 1 with `BB_DATA_DIR` set — the MCP child is spawned through `StdioClientTransport`, whose default env does not carry `BB_DATA_DIR`, so the child reports "No index found" (D24); exit 0 with `HOME` pointed at a writable directory (child inherits `HOME`). Without either, `~/.bb` is read-only in this sandbox (EROFS — §13) |
| 4 | `bun run script/m13/verify-doc-docs.ts` | **1** | RED because it requires `d1.json`/`d3.json` `verifiedState: verified`, and the two gates above are red (blocked, §13) |
| 5 | `bun run script/m15/verify-doc-deep.ts` | **2** | D1–D5 VERIFIED, then **FATAL** at D6: reads `src/mcp/tool-registry.ts` and splits on `name: "bb_doc"`, which the split moved to the descriptor file; D6/D7/D8 never run (D21) |
| 6 | `bun run script/m20/verify-doc-modes.ts` | 0 | 25/25 checks + 1 negative; evidence status `known-gap` only because the split leaves `tool-handlers.ts`/`tool-registry.ts`/the page dirty (D25) |
| 7 | `bun run script/m20/verify-doc-citations.ts` | 0 | 10/10 + 3 negatives; same `known-gap` status |
| 8 | `bun run script/m20/verify-doc-examples-diagrams.ts` | 0 | 10/10 + 3 negatives; same `known-gap` status |
| 9 | `bun run script/m20/verify-doc-truth.ts` | **1** | 111/112: RED on T17, the stale-markdown footer naming "findings' files" — only reachable under `BB_NO_AUTO_REFRESH=1`, which is why the default-environment run is vacuously green (D3 + D22) |
| 10 | `bun run script/verify-doc.ts` | 0 | GREEN (7 modes, citation resolution, stale labelling, budget gate, no source mutation) |
| 11 | `bun run script/verify-doc-design.ts` | 0 | GREEN (design-spec text lint) |

### 9.2 The doc-corpus gates (13) — shared with other tools

| # | Command | Exit | Result |
|---|---|---|---|
| 12 | `bun run script/verify-tool-docs.ts` | 0 | PASS, 16 tools / 18 artifacts |
| 13 | `bun run script/verify-tool-page-claims.ts` | 0 | PASS, 34/0 + 15 negatives |
| 14 | `bun run script/verify-docs-indexing.ts` | **1** | 12 failures, all in `docs/indexing/**`: line citations outside the cited file (e.g. `src/mcp/tool-handlers.ts:880` after the split shrank that file). Shared-doc defect, outside this task's write scope |
| 15 | `bun run script/m16/verify-docs-truth.ts` | **1** | 1 failure about `BB_PATTERNS` (not `bb_doc`); a shared-gate drift, outside scope |
| 16 | `bun run script/m48/verify-d1-doc-truth.ts` | 0 | PASS, 139/0 + 4 negatives (it wrote `validation/m48/results/D1.json`; gate-owned evidence) |
| 17 | `bun run script/m31/verify-bb-docs-truth.ts` | 0 | PASS 61/61, executed=21 structural=26 declared-unverifiable=9 |
| 18 | `bun run script/m31/verify-tool-docs-deep.ts` | 0 | PASS 211/211 |
| 19 | `bun run script/m31/tool-mode-corpus.ts --check` | **1** | invocations PASS 76/76 but behavior drifted from the committed baseline for 16 non-`bb_doc` invocations; `bb_doc` is not named among them |
| 20 | `bun run script/m35/verify-docs-staleness.ts` | 0 | PASS 128/128 + 17 negatives |
| 21 | `bun run script/m56/verify-docs-completeness.ts` | **1** | CLI-help parse mismatch in the website data generator (declared flags vs empty help) — unrelated to `bb_doc` |
| 22 | `bun run script/m60/markdown-mutants.ts` | 0 | PASS |
| 23 | `bun run script/m41/verify-design.ts` | 0 | PASS |
| 24 | `bun run script/m62/verify-docs.ts` | 0 | PASS |

Gate-set verdict: of the 11 `bb_doc` gates, 6 are green in substance (5 green, 1 green-with-
`known-gap` status ×3 sharing that status, 1 green only with a `HOME` override), 2 are red because
of the split (both in this task's write scope), 1 is red on a real product defect, 1 is blocked by
transitive evidence state. Of the 13 shared gates, 4 are red — none of them about `bb_doc`.

---

## 10. Regex audit (charter §7)

`script/tools/verify-regex-policy.ts` runs green: 112 tool source files, 112 regex uses, 0
allowlisted, **0 new**, 112 frozen debt. The `bb_doc` engine owns 8 of that 112 — all text
normalisation, none a code classifier:

| Regex | Site | Purpose | Phase B |
|---|---|---|---|
| `/\s+/` | `collapse` | whitespace collapse | replaceable by a char scan |
| `/\r?\n/` | `SourceReader.readLines` | line split | replaceable (`split("\n")` + trim trailing `\r`) |
| `/^\/\*\*?\s?/` `/^\/\/\s?/` `/^\*\s?/` `/\*\/$/` | `SourceReader.docstring` | comment-marker strip | replaceable by `startsWith` + `slice` |
| `/[\\/.: ]+/` | slug split | metadata slugs | replaceable by a char-set split |
| `/item\(s\) were dropped to stay inside/` | budget-note dedupe | own generated sentence | replaceable by `includes` on the fixed phrase |

None is inside a caller-supplied-pattern surface. The census gate `script/m15/verify-doc-deep.ts`
D2 currently *requires at least four* regex literals in the engine (`clean.length >= 4`), so it
would go red when the debt is paid — that assertion is inverted and is in this task's write scope.

---

## 11. Authorship audit (charter §8/§9)

- `src/mcp/tools/bb_doc/descriptor.ts`, `handler.ts`, `script/tool-docs/curation/bb_doc.ts`: the
  Lead-seeded §8 header is present; `WHERE ITS EVIDENCE LIVES` lines need refreshing to the
  post-split paths (Phase B).
- `src/intelligence/documentation/doc-engine.ts`: **no author header**; first line is
  `// M20.D3 — the bb_doc documentation generator.` Its comments carry banned authoring narrative:
  `M20.D3`, `§15.4 / M55.T4`, `M28…`, `M43.A1/A2`, `M35.S2`, `M48…`, `M55…`, `M59.A11`, `M64.H2`,
  `M71.D13`, `issue #NNN`, `MEASURED DEFECT (2026-10-16, found by script/m20/verify-doc-truth.ts)`,
  `shipped`, `standing rule`, and long "this was broken before / a review found" histories.
  `evidence.ts` has no header and no narrative (clean apart from the header).
- `docs/BB_DOC.md`: no markdown §8 header; title carries `(M9.15)`; body contains milestone
  labels (`M43.A1/A2`). `docs/BB_DOC_REFERENCE.md`, `docs/BB_DOC_EXAMPLES.md`: no headers.
- The 11 `bb_doc` gate scripts: no headers, milestone codes in the first line
  (`// M13.55 (D1)`, `// M20.D1`, `// M15.D1-D8`), and `script/m13/verify-doc-facts.ts`,
  `verify-doc-modes.ts`, `verify-doc-docs.ts`, `verify-doc-e2e-corpus.ts` narrate `M13`/`M20`
  issues. All are in this task's write scope.
- `handler.ts` body comments still contain `M28.T1 (issue #624)`, `M48.P1 (#696)`,
  `M55.T5 / §15.1`, `M43.A1/A2`, `M35.S2` — moved verbatim from the pre-split file.

Per §9 the technical `owner` meanings stay (`owner cascade` does not appear here); all milestone
labels, issue numbers and "shipped/standing rule/fleet" narrative must go.

---

## 12. Defect register

Severity: **H** = a caller is given a false statement or loses an answer; **M** = a documented
contract, bound or count is wrong; **L** = drift/over-promise that misleads without breaking a
call; **G** = gate defect.

| ID | Sev | Defect | Evidence | Phase B fix |
|---|---|---|---|---|
| D1 | H | Inbound relationship fact names the other symbol twice (`main calls main`) and never the documented symbol | `probes-extra` E1/F1; `doc-engine.ts` `addRelationshipFacts` inbound branch | subject/object split: inbound subject = edge source, object = documented symbol; add a T3 truth predicate on the *pair* |
| D2 | M-H | `references.stale/missing` count collected citations, not emitted ones (T2 94 vs 7; fixture 56 vs 0) | `probes-extra` E3/R6; `makeResult` | compute counts after `keptByReference()` and publish `droppedCitations` separately |
| D3 | M | Markdown stale footer says "findings' files" | `probe-refresh` R2; m20 DOC-TRUTH T17 RED under `BB_NO_AUTO_REFRESH=1` | build the footer in the handler from the citation count and `FRESHNESS_REMEDIATION.dir` with document vocabulary |
| D4 | M | Generated page Safety says "never refreshes implicitly" | `docs/tools/bb_doc.md` vs registry description + live behaviour | curation rewrite; regenerate with `--only bb_doc --write` |
| D5 | M | `BB_DOC_REFERENCE.md` says the tool does not refresh the index | live auto-refresh R1 | rewrite page |
| D6 | M | Generated Staleness section documents a file-scope remediation `bb_doc` never emits | handler hardcodes `kind: "dir"` | emit `kind: "file"` for single-file documents, or stop promising the branch; prefer the former and keep both reachable |
| D7 | M | `includeTests` is a no-op in all 7 modes | P2 includeTests; engine forces test evidence for symbol/feature/coverage | `request.includeTests` is `boolean \| undefined`; engine default = mode-based, explicit `false` suppresses; declare applicability |
| D8 | M | `limit` and `maxTokens` silently clamped/reinterpreted; ranges undeclared | P2.limit.*, P2.maxTokens.* | validate in the handler: `limit` 1–100, `maxTokens` 1–16000, refuse out-of-range with the accepted range; declare in schema + docs |
| D9 | M | project/coverage symbol-selection bound (`2×limit`) undeclared | E5/E6: T2 documentation map available=200 of 310,423 symbols; only files truncation is noted | add a declared `not-indexed` unknown whenever selected symbols < total in scope |
| D10 | L | `project` target is metadata-only, undocumented | P3.project.target-is-metadata-only | declare in schema description/docs |
| D11 | L | Symbol Markdown example headings/title do not match measured output | P8.examples-section-names-match-measured | regenerate examples from a real run |
| D12 | L | Project JSON example contradicts the type (expected 2 vs 4, no bounds, tags) | P8.examples-project-expected-matches-declared | regenerate examples from a real run |
| D13 | L | Reference page names "unavailable" (section is `unsupported`); api omits framework route | page read | rewrite page |
| D14 | L | BB_DOC.md contradicts itself on diagrams; over-promises examples | text scan | rewrite those sections |
| D15 | L | Documented semantic-only 0.70 cap is unreachable (no `embedding` citations) | `grep kind: "embedding"` → none | state the actual rule, or cap the semantic candidate facts; document which |
| D16 | L | File target absent-case does not name the forms tried | P3 absent-case | extend the empty explanation |
| D17 | M | `module` mode with an unknown module documents project-wide inventory/entry points and passes | P5.module | scope inventory/entry-points to the selected files; empty module must not pass |
| D18 | L | Outbound relationship citation pairs target file with source line; two citations have no path | E1 | cite the call-site file/line (own file + relationship line); path for import/export edges from the edge's file |
| D19 | L | Post-refresh regenerated document can cite stale files outside the repair set | budget-decline probe | one bounded second repair pass over the regenerated citation set |
| D20 | M | Registry description says budget enforced against "the whole payload" (wire is 1.26–1.47×) | P1 ratios; T2 project | descriptor wording: measured object disclosure + link to the doc's wire note |
| D21 | G | `m13/verify-doc-facts.ts` greps the pre-split handler location; `m15/verify-doc-deep.ts` FATALs splitting the pre-split registry | gate table rows 1 and 5 | point at `src/mcp/tools/bb_doc/**`; assert the split layout positively |
| D22 | G | DOC-TRUTH T17 is vacuously green with auto-refresh enabled; red only under the charter's measurement env | row 9 | pin `refresh:false` and a stale precondition so the assertion always fires; then the fixed footer is a deliberate red→green |
| D23 | G | `m13/verify-doc-docs.ts` depends on `verifiedState` from the two red gates | row 4 | transitive by design; becomes green when d1/d3 are green |
| D24 | G | doc-e2e-corpus MCP leg cannot run with `BB_DATA_DIR` (MCP child env strip); `~/.bb` is read-only here | row 3 | pass `env` through to `StdioClientTransport` in the gate (documented workaround: `HOME`) |
| D25 | G | m20 evidence can only be `known-gap` while `DOC_EVIDENCE_PATHS` files are dirty from the split | rows 6-9 | add the post-split files to the fingerprint paths; state that `verified` needs the split committed |

The 5 gate defects are not "the tool is wrong"; they are why the suite cannot currently prove the
tool. D21/D22 are fixed in this task; D24 in this task; D23/D25 are evidence-state facts reported
to the Lead.

---

## 13. Blocked legs (exact commands and reasons)

1. **`m13/verify-doc-docs.ts` cannot reach `verified` yet.** It requires
   `validation/m13/results/{d1,d2,d3}.json` with `verifiedState === "verified"`; d1/d3 are red on
   the split (D21). Command: `bun run script/m13/verify-doc-docs.ts` → exit 1. After Phase B fixes
   d1/d3, it is expected green.
2. **`m20` doc gates can only record `known-gap`.** `src/intelligence/documentation/evidence.ts`
   fingerprints `src/mcp/tool-handlers.ts`, `src/mcp/tool-registry.ts`, `docs/tools/bb_doc.md`;
   the split leaves all three dirty, so `docRelevantWorkingTreeChanges()` is non-empty and
   `status` is `known-gap` even at 0 failed checks. Commands and observed statuses:
   `bun run script/m20/verify-doc-modes.ts` → 25/25, known-gap; `…-citations` → 10/10, known-gap;
   `…-examples-diagrams` → 10/10, known-gap; `…-truth` → 111/112 + 1 real failure.
   `verified` requires the Lead's commit.
3. **`m13/verify-doc-e2e-corpus.ts` MCP leg is environment-blocked two ways.** With
   `BB_DATA_DIR` set: `MCP project: returns output — No index found for /tmp/…` (the MCP SDK child
   does not inherit `BB_DATA_DIR`). Without it: `EROFS: read-only file system,
   mkdir '/home/ishaq2321/.bb/projects/…'` (the sandbox home is read-only). Working command:
   `HOME=$PWD/validation/tools/bb_doc/work/home BB_NO_AUTO_REFRESH=1 bun run script/m13/verify-doc-e2e-corpus.ts`
   → exit 0, 6/6. This is a gate-environment defect (D24), not a tool defect.
4. **The `bb_tests` corpus companion gate is absent from this checkout.** `docs/BB_DOC.md` names
   `bb_tests/bb_doc/verify-corpus.ts` (500-check run over ten repositories). `bb_tests/` does not
   exist here; `/home/ishaq2321/bb_tests/repositories` holds `rake`, `rebar3`, `clojure`, `zig` but
   is missing `lua`, `go_tools`, `typescript`, `perl5`, `openssl`, `cpython`. The ten-corpus
   predicates are therefore **not run here**; the four present repos are exercised by m13 D3 and
   m15 D5. This leg must be reported `blocked`.
5. **`script/m31/verify-gate-selftest.ts` (the mutation audit `docs/BB_DOC.md` cites) was not run.**
   It plants defects in `src/` and restores them; running it in the shared checkout while the fleet
   process regenerates evidence is unsafe. The Phase B gates will instead be shown red on the real
   split regressions (D21) and on the T17 defect (D3), plus in-gate negative twins. A full mutation
   run belongs to the Lead on a clean/committed tree.
6. **`~/.bb` writes are denied by the sandbox** (`EROFS`). Any gate whose child resolves the
   default data dir needs `HOME` redirected inside the workspace; recorded with each command.
7. **T2 auto-refresh was deliberately not exercised.** Repairing stale files on the reference
   index would write the shared `.bb-data` index, which charter §3.5 forbids. T2 freshness is
   measured read-only with `BB_NO_AUTO_REFRESH=1`; the repair path is measured on fixtures.

---

## 14. Latency baseline

Source: `validation/tools/bb_doc/LATENCY.json` (full tables, runs and commands). Warm p50/p95:

| Tier | mode | p50 | p95 | budget | within |
|---|---|---|---|---|---|
| T0 (polyglot) | symbol/file/module/api/project/coverage | 34–61 | 52–83 | 250 | yes |
| T0 | **feature** | 225 | **819** | 250 | **no** |
| T1 (n100) | symbol/file/module/api/project/coverage | 62–309 | 69–574 | 1,000 | yes |
| T1 | **feature** | 700 | **1,594** | 1,000 | **no** |
| T2 (.bb-data) | coverage | 2,231 | 2,750 | 5,000 | yes (barely) |
| T2 | symbol | 3,142 | 4,458 | 5,000 | yes (barely) |
| T2 | module | 4,708 | **9,458** | 5,000 | **no** |
| T2 | file | 6,774 | **53,721** | 5,000 | **no** |
| T2 | api | 6,974 | **10,592** | 5,000 | **no** |
| T2 | project | 7,033 | **13,414** | 5,000 | **no** |
| T2 | **feature** | 18,982 | **52,063** (2 runs) | 5,000 / 30,000 timeout | **no** |

Cold first call in a fresh process: 60 ms (T0), 771 ms (T1), 8,460–36,191 ms (T2, DB open and
schema/index setup). T2 project mode with `limit=100, maxTokens=16000`: 25,034 ms, over budget.
The host was at load average 12–22 from the shared fleet process during T2, which inflates the
variance (one file-mode run measured 53.7 s against a 4–7 s norm), but the 2–7 s p50 is not an
artifact of load: it is a query-shape cost, not a scheduler cost. Diagnosis work for Phase B:
the relationship fetch (`ORDER BY r.line_number LIMIT ?` over the project's relationships —
820,040 rows here) and, for `feature`, the full semantic search (19–52 s, 1.3 GB max RSS).
The reference index measured here holds **6,452 files / 310,423 symbols / 820,040 relationships**,
not the 11,440 / 1,283,638 / 4,418,260 in CHARTER Appendix A; both numbers should be reconciled
by the Lead's bench before the campaign's cross-tool latency table is published.

---

## 15. Phase B plan (in this task's write scope)

1. **Engine (`doc-engine.ts`)** — D1 (inbound edge subject/object), D18 (citation path/line for
   edges), D2 (counts over emitted citations), D9 (declared symbol-selection bound), D7
   (`includeTests` tri-state), D16 (file empty explanation tries all four forms), D17 (module
   inventory/entry-point facts scoped to the selected files), D15 (semantic rule stated as what
   the code does), D14 (no diagram/example promises in code comments). Replace all 8 regexes with
   char scans (§10) and add the §8 author header; remove the milestone narrative.
2. **Handler (`handler.ts`)** — D3 (footer vocabulary built in the handler), D6 (file-scope
   envelope for single-file documents), D8 (limit/maxTokens range refusal), D19 (one bounded
   repair re-check after regeneration); clean the moved milestone comments.
3. **Descriptor + curation** — D20 (measured payload wording), D8/D10/D7 declarations, D4 safety
   sentence, errors/limitations for the new refusals; regenerate
   `npx tsx script/verify-tool-docs.ts --only bb_doc --write` and verify with `--only bb_doc`.
4. **Docs** — rewrite `docs/BB_DOC.md`, `docs/BB_DOC_REFERENCE.md`, `docs/BB_DOC_EXAMPLES.md`
   against measured behaviour, add the §8 markdown header to each, generate the examples from a
   real run (D11/D12/D13/D14/D15), remove milestone framing from the title.
5. **Gates** — fix D21 (m13 facts + m15 deep read the post-split descriptor/handler),
   D24 (pass `env` to the MCP transport; keep the `HOME` path documented), D22 (pin
   `refresh:false` in T17 and assert the stale branch), invert the m15 D2 regex census to demand
   zero regex literals, and add falsifiable checks for D1, D2, D3, D7, D8, D9 and the declared
   bounds identity. Each new predicate gets a negative twin; the two split regressions are the
   observed red→green proof for the repaired gates.
6. **Evidence** — per charter §5: `validation/tools/bb_doc/EVIDENCE.json` with `schemaVersion`,
   `tool`, `status`, `currentCommit`, `verifierCommand`, `passed`, `failed`, `negativeCases`,
   `generatedAt`, `blockedLegs`; per-gate JSON under `validation/tools/bb_doc/gates/`; re-run
   T0/T1/T2 and rewrite `LATENCY.json`; re-run the 24 gates and record the new table.
7. **Verification** — `npx tsc --noEmit`; every gate command; the probes again; the two live-T2
   reads (`project` default, `feature` once) to confirm the latency work without writing the
   shared index. Report at Phase B completion.

## 16. Unknowns carried forward

- Whether `feature` mode can be made meaningfully faster without dropping semantic discovery:
  the candidate fix (skip semantic unless `detail:"deep"`) changes recall for `standard`; it
  needs a declared decision and a doc sentence, which is Phase B work, not an audit claim.
- Whether the 30 s client timeout is the operative bound in the fleet's client configuration;
  measured single calls at 19–52 s are unsafe under either a 30 s MCP timeout or a 5 s budget.
- Whether the shared `~/.bb` index used by gates is expected to be writable in the campaign's
  reference environment; here it is not (EROFS), so gates whose children resolve the default data
  dir need the `HOME` redirect.
- `brain_index_status.total_files/indexed_files` for the reference project read `1/1` while the
  index holds 6,452 files; `bb_doc` reads only `indexing_version` (`v1.0.0`), so the tool's
  metadata is unaffected, but the status row itself is a data anomaly outside this task.

---

# Phase B resolution (recorded after the fixes)

Every defect in §12 is resolved or explicitly declared. Evidence: `EVIDENCE.json` (gate table,
red-then-green entries, cold-open breakdown), `LATENCY.json` v2, and the raw gate logs under
`logs/final-*.log` / `logs/v2-*.log`.

| ID | Resolution |
|---|---|
| D1 | Inbound relationship facts now render `<neighbour> <type> <documented symbol>`; the truth gate's T29 uses two DISTINCT names and a negative twin. Measured: `checkout exports total.` / `caller calls callee.` |
| D2 | `references.stale/missing/broken` count EMITTED citations; `collectedStale`/`collectedMissing` carry the gathered totals; the fixtures' 56-vs-0 and T2's 94-vs-7 contradictions are gone |
| D3 | Handler builds the footer in the document's vocabulary (`N stale, 0 missing of 1 cited file(s) — this read does NOT auto-refresh — …`), manual-only constants on decline; T17 now pins `refresh:false` so the stale branch always runs |
| D4/D5 | Generated page Safety and the Reference page now state the bounded inline repair as behaviour; `docs:generate --only bb_doc --write` re-rendered the page |
| D6 | Single-cited-file documents emit the FILE-scope envelope (real `bb index "<file>"` remediation); multi-file documents project scope; both generated-page branches reachable |
| D7 | Tri-state `includeTests`: absent = mode default, explicit false suppresses in `symbol`/`feature`, the other five modes refuse by name |
| D8 | `limit` 1–100 and `maxTokens` 1–16000 are declared in the schema (minimum/maximum) and REFUSED out of range by the handler; no silent clamp remains |
| D9 | project/module/coverage/file documents publish `selected N of M indexed symbol(s)` when the 2×limit selection is smaller than the scope |
| D10 | Descriptor states project's target is metadata only |
| D11/D12/D13/D14/D15/D16 | `docs/BB_DOC_EXAMPLES.md` now carries real abridged output; `docs/BB_DOC_REFERENCE.md` and `docs/BB_DOC.md` were rewritten against measured behaviour; the absent-file explanation names the four forms tried; the unreachable 0.70 semantic cap sentence is gone; diagrams/examples are stated as never emitted |
| D17 | Unmatched module target is refused with the two directory forms and a remedy — no project-wide fallback and no `passed: true` |
| D18 | Relationship citations name the call-site file and the relationship line; both ends are named in the id |
| D19 | A second bounded repair round runs after regeneration (MAX_REPAIR_ROUNDS = 2) |
| D20 | Budget is enforced on the decorated payload; `estimatedTokens * 4 >= payload`; budget.passed agrees with the payload measurement; the default budget is 8,000 because the measured minimum honest project rendering on the reference index is ~6,700 tokens |
| D21 | m13 facts reads the split modules through `script/lib/tool-sources.ts`; m15 deep reads the descriptor/handler modules — both were RED on the split, now GREEN |
| D22 | T17 pins `refresh:false` and asserts the stale branch; it was RED under `BB_NO_AUTO_REFRESH=1` before the footer fix |
| D24 | The e2e gate passes `env: process.env` to the MCP transport; the earlier `No index found` leg is GREEN |
| D25 | m20 evidence stays `known-gap` at 0 failed checks by its own rule while the split tree is dirty — declared, integration stamps `verified` |
| Latency | All default T2 calls are inside 5 s (p50 71–1967 ms; p95 139–3654 ms). Cold first default call 3.9 s on a cold page cache / 930 ms with warm cache; read-only open 2 ms. `detail:"deep"` feature is an 18.0 s, 926 MB opt-in, declared in the descriptor, curation and pages |
| Regex | The engine's 8 text-normalisation literals were replaced with char scans; `verify-regex-policy.ts` PASS with the doc-engine rows paid to zero (`m15` D2 now REQUIRES zero, via an AST census) |

Final lane gate table (all eight commands exit 0; exact logs in `logs/final-*.log`):

`m13/verify-doc-facts` · `m13/verify-doc-modes` · `m13/verify-doc-e2e-corpus` · `m13/verify-doc-docs` ·
`m15/verify-doc-deep` (D1–D8 VERIFIED) · `m20/verify-doc-modes` · `m20/verify-doc-citations` ·
`m20/verify-doc-examples-diagrams` · `m20/verify-doc-truth` (PASS 128/128, 29 negatives) ·
`script/verify-doc.ts` · `script/verify-doc-design.ts` · `script/tools/verify-regex-policy.ts` ·
`script/verify-tool-page-claims.ts` (cross-lane, GREEN).

Declared blocked/cross-lane: the four shared gates that read the full-generator artifacts
(`verify-tool-docs`, `m35`, `m48`, `m31 tool-docs-deep`) fail only on stale
`docs/data/public-tools.json` + `website/src/data/tools.generated.ts` until the Lead's integration
`npm run docs:generate`; `m31 bb-docs-truth`, `m16`, `m31 tool-mode-corpus` are red on other
owners' in-flight tools; the bb_tests ten-repository companion and the m31 gate-selftest remain
declared blocked (§13).

---

# Release-grade real-corpus leg (Phase B completion)

The fixture gates prove the contract; this leg proves the tool on real work through the door a
caller actually gets. Raw record: `REAL-CORPUS.json`; command in `EVIDENCE.json.realCorpus`.

**Five real repositories, indexed once each into an isolated `BB_DATA_DIR`
(`validation/tools/bb_doc/realcorpus/bbdata`, gitignored build state), then driven through the REAL
MCP stdio server (`node bin/bb mcp --dir <corpus>` via the MCP SDK client, inherited environment):**

| Corpus | Language | Population | Call range |
|---|---|---|---|
| `rake` | Ruby | 109 files / 1,593 symbols / 9,075 relationships | 49–733 ms |
| `rebar3` | Erlang | 303 files / 7,012 symbols / 38,143 relationships | 96–421 ms |
| `clojure` | Clojure | 347 files / 12,764 symbols / 65,458 relationships | 105–799 ms |
| `go-tools/gopls` | Go | 706 files / 16,069 symbols / 72,134 relationships | 82–887 ms |
| `zig/src` | Zig | 174 files / 34,006 symbols / 143,618 relationships | 49–533 ms |

Per corpus, all seven modes answered (35/35), every emitted citation resolved on disk
(932/932 checked, 0 unresolved), every JSON answer published `freshness.passed: true`
(35/35), and all six documented refusals came back named and `isError` (30/30): unknown module,
`limit` 101, `maxTokens` 0, `includeTests` on project, missing symbol target, invalid mode.
`project` calls repeated warm at 193–1,006 ms.

Two runtime facts are recorded rather than smoothed over:
- The MCP child must be `node` (`bin/bb` has a node shebang). A bun-child probe on the same
  WAL-backed corpus answered "No index found" because bun:sqlite could not open the read-only
  handle; the identical node-door request returns the full document. The release door is node.
- The isolated index is 1.2 GB and gitignored; the leg is regenerable with the one command in
  `REAL-CORPUS.json.commands.indexAndProbe`.

Cold-open declaration (unchanged, now cross-referenced here): on the reference index the read-only
DB open is **2 ms**, the first cheap query **1 ms**, and the first DEFAULT project call **3.9 s on
a cold page cache / 930 ms with a warm cache / 1.4 s warm** — page-cache warm-up, not query time.
Declared in `EVIDENCE.json.coldOpen`, `LATENCY.json`, `docs/BB_DOC.md` §Measured cost, the
Reference page, and the generated page's Performance section.

`freshness.passed` claim: the JSON envelope has published its own verdict since Phase B, all 35
real-corpus documents carry it, and the cross-lane gate that flagged the claim
(`verify-tool-page-claims`) is GREEN (34 passed, 0 failed, 15 negatives).

---

# M31 mutation-selftest routing (two mutants)

Routed by the Lead from `script/m31/verify-gate-selftest.ts`: `m20-doc-truth-signature` and
`m20-doc-modes-contract` were reported undetected. Root cause was **stale mutation anchors**, not
weak assertions: both anchors were written against pre-split code. The signature anchor no longer
existed (the engine delegates rendering to the LSP owner, so the old `return parameters === null ? …`
line is only quoted in a history comment), and the mode-guard anchor pointed at
`src/mcp/tool-handlers.ts`, while the guard has moved to `src/mcp/tools/bb_doc/handler.ts` with the
tool split. The self-test's own `mutation anchor found` check failed; on a not-applied mutation the
control passes and the mutant looks undetected.

Fixes (commit `60fa91be9`):
- **`m20-doc-truth-signature`** re-anchored to the delegating renderer
  (`renderSignature` → owner) and mutates it to bracket the owner's unknown-list marker as `()`.
  T30 was also strengthened: an empty bracket pair is a claim that the list is empty **even when
  the "no parameter list" caveat sits beside it** — the old predicate exempted that exact shape, so
  the planted defect passed. The negative twin now convicts the caveat-plus-brackets shape.
- **`m20-doc-modes-contract`** re-anchored to `src/mcp/tools/bb_doc/handler.ts`, where the guard
  now lives; the mutation is unchanged in meaning (drop the guard → accept an invalid mode).
  `m20/verify-doc-modes` now converts a thrown refusal into a named check failure, so detection is
  an asserted predicate rather than an ambiguous crash exit.

Measured: with each mutation planted on the clean tree the gate exits non-zero on its own assertion
(T30 "empty argument list" / "invalid mode is rejected"); on the clean tree both gates pass. Full
self-test after the fix: **PASS 69/69** at `60fa91be9`, with all five bb_doc mutants
`mutationFailed: true, controlPassed: true` (log `logs/selftest-routed-3.log`).
