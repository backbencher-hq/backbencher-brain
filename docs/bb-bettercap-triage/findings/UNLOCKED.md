# Additional issues unlocked during triage (append-only)

Rules: append one block per discovered issue at the end; `## <lane> — <one-line title>` heading;
never edit another lane's block or earlier blocks. Keep each block to <= 25 lines: what was
observed, exact command, why it looks like a defect (not a documented limitation), evidence file
path. These are leads for the next round, not campaign deliverables — do not chase them.

## format example
## <lane> — what surfaced
- Observed: ...
- Command: ...
- Why defect: ...
- Evidence: evidence/<lane>/<file>

## go-imports — dependency mode ranks false cross-language edges as internal coupling
- Observed: bettercap project-wide `bb_analyze mode=dependencies` top rows are `Makefile` (score 170), `modules/ui/ui/assets/fontawesome/metadata/icons.yml` (94), `.github/workflows/release.yaml` (44), `modules/ui/ui/assets/openlayers/ol.js` (26) — the 358 "resolved" Go import edges are leaf-name collisions; `returnedInternalDependents:275` is mostly this noise while `returnedInternalDependencies:0`. `session/` has 0 import edges into it.
- Command: `node bin/bb tool bb_analyze --dir /home/ishaq2321/bettercap --args '{"mode":"dependencies","limit":20}'`
- Why defect: the same raw false edges as ISSUE-02 are counted as internal dependents and drive page ranking, so asset files read as the most-depended-on files in the project.
- Evidence: evidence/go-imports/deps-project-raw.json, evidence/go-imports/db-queries.txt

## go-imports — multi-repo workspace index cross-contaminates file dependents
- Observed: `bb_analyze dependencies filePath=".corpus/axios/lib"` → `.corpus/axios/lib/utils.js` lists dependents from `.corpus/moment/src/lib/...`, `.corpus/chartjs/test/...`, `.corpus/jquery/src/...` — unrelated repos inside one project index.
- Command: MCP `bb_analyze {"mode":"dependencies","filePath":".corpus/axios/lib","limit":5}`
- Why defect: specifier/tail resolution has no repository boundary, so dependents are claimed across unrelated trees (plausible cause: file-level import edges resolved against a project-wide index).
- Evidence: evidence/go-imports/mcp-workspace-language-comparison.txt

## go-imports — bb_graph exposes same-module Go imports as external `ext:` nodes
- Observed: `bb_graph` `symbol=session file=session/session.go direction=callees relationshipTypes=["imports"]` → 24 edges, all `to: ext:<path>` `isExternal:true`, including 6 `github.com/bettercap/bettercap/v2/{caplets,core,firewall,log,network,packets}` (same module, should be internal).
- Command: `node bin/bb tool bb_graph --dir /home/ishaq2321/bettercap --args '{"symbol":"session","file":"session/session.go","direction":"callees","maxDepth":1,"relationshipTypes":["imports"],"edgeLimit":50}'`
- Why defect: the same `is_external=1` misclassification is surfaced by a second tool with no resolution field, so a graph reader cannot tell untried-external from attempted-unresolved.
- Evidence: evidence/go-imports/graph-module-symbol-imports.json, evidence/go-imports/root-cause-quotes.txt

## cross-lang — same name-only binding corrupts SAME-language call edges (not just cross-language)
- Observed: bettercap `main.go` package symbol (`main.go:main:1`, `symbol_type: module`) holds 19 stored `calls` rows at confidence 0.8 bound to *other files'* same-named leaves, e.g. `Printf → modules/http_proxy/http_proxy_base.go`, `Error → js/http.go`, `Run → modules/net_probe/net_probe_test.go`, `Name → caplets/caplet.go`, `Close → modules/net_sniff/net_sniff_context.go`. Source lines are `fmt.Printf` / `log.Error`-style stdlib calls (`main.go:23,30,37,49,50,56,67`) whose leaves were resolved project-wide by `src/ast/parallel-indexer.ts:3863` `resolveTargetStmt` (same ranking; `is_cross_language=0` because both sides are Go). Reached via `inspect-db.cjs ... import-rows`.
- Why defect: the collision lottery is not cross-language-specific — the same mechanism fabricates same-language `calls` edges on the package symbol, feeding `bb_graph`/`bb_impact`/orphans (amplifies ISSUE-04's call-graph and ISSUE-03's dependency noise). Fix belongs in the same place as ISSUE-02's write-side gates.
- Evidence: evidence/cross-lang/db-maingo-all-rows.json

## cross-lang — `bb_graph` and `bb_cross_language` answer different questions for one name (module vs function copy)
- Observed: `bb_cross_language main` unions 4 copies (`ambiguous:true`) and shows 7 facts on `main.go:main:1` (the `module`/package-clause symbol, where Go import rows are stored). `bb_graph {"symbol":"main"}` resolves the root to `main.go:main:20` (`function`) and returns 0 callees for `relationshipTypes:["imports","uses"]` — the same stored rows exist but no traversable root reaches them by name. Reproduced with `probe-graph-main.json` vs `probe-a-main-bettercap.json`.
- Why defect: a reader asking the graph door is told there is nothing cross-language on `main` while the cross-language door reports 7 facts at 0.9; neither declares that the other resolves a different copy (each is internally honest; the pair is not).
- Evidence: evidence/cross-lang/probe-graph-main.json, evidence/cross-lang/probe-a-main-bettercap.json

## [go-callgraph] A4.1 — Orphan findings compute a COVERAGE GAP INDICATOR that the CLI text surface never renders (medium)

Adjacent to ISSUE-04 (`findings/ISSUE-04-orphan-false-positives.md`). `src/intelligence/patterns/orphans.ts`
builds a per-finding `evidence[]` array and, whenever a symbol has no incoming row while its FILE has
some, appends a `COVERAGE GAP INDICATOR` block (`:812-827`, computed at `:916-921`) whose text is
literally: "this symbol has no incoming usage edge at all, but its file receives N incoming usage
edge(s) … That asymmetry is the signature of a missing reference rather than of an unused declaration."
That block is part of the engine JSON contract, but `node bin/bb tool bb_patterns --args
'{"scope":"orphaned","limit":500}'` prints only the one-line row + confidence. On bettercap the first
orphan row (`jsOnEventFunc`, 70%) does carry the caveat in JSON (its file has 3 incoming `uses` rows to
jsRuntime/jsListeners) yet the external reporter saw a bare "orphaned" line. Honesty-of-surface class
(same family as report items 10/12); suggested owner lane: `payload-honesty`. Evidence:
`docs/bb-bettercap-triage/evidence/go-callgraph/a3-patterns-orphaned-limit500.txt`,
`b2-db-identifier-usage-and-filecov.txt`, `b3-db-identifier-fns-and-filecov.txt`.

## [go-callgraph] A4.2 — Go analyzer's GO1 bare-identifier `uses` pass is same-file-only; 100% of emitted identifier_usage rows are same-file (high)

This is the root cause of ISSUE-04, recorded as an adjacent unlock because it is a *graph-wide* edge gap,
not only an orphan-detector issue: every other consumer (`bb_graph`, `bb_impact`, `bb_visualize`,
`bb_doc`) also misses cross-file function-value references. Gate: `src/ast/real-go-analyzer.ts:5015-5030`
(`fileValues` built from this file's symbols) + `:5382` (`fileValues.has(name)`). Measured on bettercap:
366 `identifier_usage` rows, 366 anchored, **0 cross-file**; 8 `session/js*Func` callbacks registered via
`plugin.Defines[...] = fn` in a different file all have 0 incoming rows of any kind. The analyzer's own
reason-code vocabulary already declares the intended fix shape
(`:188-189 "used_identifier_recorded_as_a_leaf_whose_declaring_file_is_out_of_scope"`). Suggested fix +
gate in ISSUE-04. Evidence: `b1`, `b3` under `docs/bb-bettercap-triage/evidence/go-callgraph/`.

## retrieval — bb_doc symbol-mode `limit` doubles as the SUBJECT selector (adjacent to ISSUE-07, medium)

`src/intelligence/documentation/doc-engine.ts:713-741` passes the caller's per-section evidence cap
(`limit`, documented in `docs/BB_DOC.md:268` as "Default evidence limit: 20 items per section") into
`targetSymbols(..., limit)` where it is the `LIMIT ?` of the symbol-resolution SQL. Lowering the
evidence cap therefore changes WHICH symbol is documented, silently: on bettercap
`{"mode":"symbol","target":"Session","limit":1}` returns a document titled `symbol: Session` whose only
API fact is `property Session: *Session is defined in session/module.go at lines 35-35`, with
`quality.passed:true`, `completeness 5/5`. The `Symbol` the caller asked for (the canonical struct
`session/session.go:72`) is absent and nothing declares that the subject set was truncated.
Reproduce: `node bin/bb tool bb_doc --dir /home/ishaq2321/bettercap --args '{"mode":"symbol","target":"Session","limit":1,"format":"json"}'`.
Evidence: `docs/bb-bettercap-triage/evidence/retrieval/07-doc-session-limit1-bettercap.json`.
Why defect: a bound that is documented as a presentation cap silently becomes a resolution/disambiguation
input; the ambiguity is resolved by `ORDER BY s.line_start`, i.e. by line number, not by meaning.

## retrieval — bb_doc accepts a qualified target but does not prefer the qualified match (adjacent to ISSUE-07, medium)

`docs/BB_DOC.md:121` says a symbol target may be a "symbol name, qualified name, or its last dotted/
`::` segment". In `doc-engine.ts:713-731` the branch builds `names = [target, short, leaf]` and runs
the **unqualified `s.name IN (...)` query first**; the `qualified_name IN (...)` query is only appended
after the name rows and only while `byName.length < limit`. A qualified target therefore still returns
every same-named copy: `{"mode":"symbol","target":"config.Options"}` on gh-cli/internal returns
`3 file(s) and 3 symbol(s) in scope` — `struct Options` at `skills/installer/installer.go:26`,
`property Options` at `codespaces/connection/connection.go:30`, `variable Options` at
`config/config.go:674` — and leads its API with the unrelated struct, while
`reference.canonicalPath` says `config.Options`. bettercap agrees: `target:"session.Session"` returns
the same 5 copies as `target:"Session"`.
Reproduce/evidence: `docs/bb-bettercap-triage/evidence/retrieval/07-generality-ghcli-doc-qualified-Options.json`,
`07-doc-qualified-session-bettercap.json`.
Why defect: a qualified name is the one disambiguator `bb_doc` documents, and it is silently ignored
for scope selection; the caller cannot pin a subject at all (no `filePath` option exists in `bb_doc`).

## retrieval — bb_doc symbol mode documents JSON data-file properties as if they were code symbols (adjacent to ISSUE-07/08, low)

On the workspace project `{"mode":"symbol","target":"Session"}` puts
`property Session: boolean` from `.corpus/webpack/test/cases/json/weird-properties/globals.json:1467`
into the same 3-symbol scope as a TypeScript `type` (socket.io adapter) and a TypeScript `interface`
(`script/m13/verify-visualize-browser.ts:178`), and cites the JSON key in the API/Tests sections with
`100%` extracted confidence. Data-file keys are indexed as `property` symbols, and symbol-mode
resolution has no source-file-class/noise filter (the `symbols` search path applies hard-noise rules;
`doc-engine.ts:713-741` does not). Evidence:
`docs/bb-bettercap-triage/evidence/retrieval/07-generality-workspace-doc-Session.json`,
`07-generality-workspace-symbol-Session.json`.
Why defect: a cited documentation generator asserting a JSON test fixture key is "declared public"
property of a symbol conflates code declarations with data vocabulary; adjacent to the JSON-property
noise class noted by other lanes. Suggested owner for the fix: docs/analyzer noise policy.

## [payload-honesty] U10.1 — Older indexes: graph-family tools die with a raw SQLite `no such column` instead of a declared schema refusal (medium)

Found while establishing ISSUE-10/12 generality on the `bb_tests` indexes (all built 2026-10-17, before
the current schema). Every call on `bb_tests/repositories/gql-gqlgen/graphql`
(projectId `3cc416747a0082a80b42b89928cb8c909e09e371`, 161 files, "complete" per `bb projects`) fails
*before any payload*, with the database's own error text:

```text
$ node bin/bb tool bb_impact --dir /home/ishaq2321/bb_tests/repositories/gql-gqlgen/graphql --args '{"symbol":"New"}'
bb_impact: no such column: r.target_basis
$ node bin/bb tool bb_graph  --dir /home/ishaq2321/bb_tests/repositories/gql-gqlgen/graphql --args '{"symbol":"New"}'
bb_graph: no such column: r.target_basis
$ node bin/bb tool bb_security --dir /home/ishaq2321/bb_tests/repositories/gql-gqlgen/graphql --args '{"limit":5}'
security leads: engine not initialized — security engine not initialized; run bb index --post
```

Mechanism (suspected, code-read only): `bb_impact` deliberately opens the index **byte-read-only** so a
read cannot mutate it — `src/mcp/tools/bb_impact/handler.ts:66-69`:
`const raw = await BrainDatabase.getRawInstance(projectId as any, { readonly: true })`. A read-only open
does not run pending schema migrations, so the current query (which references `brain_relationship.
target_basis`, a newer column) fails on an index created by an older build. `bb_graph` goes through
`graphTraversal` and fails identically; `bb_security` at least downgrades to a declared "engine not
initialized" message. The honesty contract this campaign is testing says a read tool must declare
staleness/incompatibility instead of surfacing a raw storage error. Suggested fix: on open (or on the
first such failure) compare the DB's schema/version marker to the build's expected schema and either
(a) return a declared refusal naming the version mismatch and the remediation (`bb index --post` /
`bb index <dir>`), or (b) run the bounded migration on a read-tool open when safe. Gate: an integration
test opening a v(N-1) fixture DB and asserting `isError` with a named refusal containing
`schema`/`migration`, never `no such column`.

Blast radius: every project indexed by an older bb build (the `bb tools` table in the workspace also
lists many `/tmp`-era project DBs); it makes cross-project generality probes silently unattributable
(a user sees a tool crash, not "index too old"). Found on ISSUE-10 probes (b)/(e); evidence:
`docs/bb-bettercap-triage/evidence/payload-honesty/impact-gql-graphql-default.out`,
`graph-gql-graphql-default.out`, `security-gql-graphql-limit5.out`.

## [edit-safety] U1 — MCP `bb_edit` is dead on the workspace project: stale dist chunk references a file that does not exist (high)

- Observed: MCP tool call `bb_edit` `{"mode":"refactor","symbolName":"create","filePath":"src/tool/brain-log.ts","newName":"createLog","dryRun":true}` returns
  `Error: { "ok": false, ..., "error": "Cannot find module '/home/ishaq2321/mcp/backbencher-brain/dist/database-HE6EE3VA.js' imported from /home/ishaq2321/mcp/backbencher-brain/dist/chunk-PHPRG35J.js", "refusedBeforeWriting": true }`.
  On-disk dist contains only `database-35MKQZKM.js`; `dist/chunk-PHPRG35J.js` references `database-HE6EE3VA` (1 occurrence) — the on-disk chunk graph is internally inconsistent, so this is not only a stale process: a fresh load of that chunk fails too.
- Command: MCP `bb_edit` (workspace project, dryRun:true); cross-check `ls dist | grep '^database-'`.
- Why defect: the documented canonical edit door is unavailable from MCP for every agent, and the failure is reported as an edit-layer error instead of an unavailable-tool/build-integrity error. CLI engine path (`node bin/bb tool bb_edit ... dryRun`) works on the same tree, so the dist split/bundle is the fault. Adjacent to ISSUE-01 (my generality probe had to use the CLI).
- Evidence: docs/bb-bettercap-triage/evidence/edit-safety/10-generality-ts-namespace-import.txt

## [edit-safety] U2 — refactor's reference classifier silently drops every dotted/namespace reference in TS/JS, Python and Java too (high)

- Observed: `refactor create → createLog` (`src/tool/brain-log.ts`) plans 1 file/1 site while 36 cross-file sites use it through `import * as Log` + `Log.create(...)`; no warning names the missed files. Go equivalent measured at scale: `refactor NewSessionModule` plans 1 file/1 site with 46 correctly-spanned package-qualified callers. The cause is shared: `src/ast/safety-primitives.ts:226-232` puts `property_identifier`/`field_identifier` in `MEMBER_NODE_TYPES`, `isMemberNameNode()` (`:265-266`) returns true, and `isReferenceSite()` (`src/intelligence/edit/edit-engine.ts:640-647`) excludes every `isMemberName` occurrence — so any `ns.member` / `pkg.Func` / `Type.member` reference is invisible to rename, while the plan-completeness check (`:2051-2061`) only covers declaration/import evidence in the same file.
- Command: `node bin/bb tool bb_edit --dir /home/ishaq2321/mcp/backbencher-brain --args '{"mode":"refactor","symbolName":"create","filePath":"src/tool/brain-log.ts","newName":"createLog","dryRun":true}'`
- Why defect: same silent-under-report class as ISSUE-01, but the blast radius is not Go-specific — it is every namespace-qualified reference in the four dotted-access languages. Documented contract (`docs/BB_EDIT.md:195-203`) promises refusal when evidence is left unrenamed; measured behaviour is a success message. Fix sketch + gate are in `findings/ISSUE-01-unsafe-refactor.md` §7-8 (F1/F3/F4).
- Evidence: docs/bb-bettercap-triage/evidence/edit-safety/09-workspace-ts-namespace-import-refactor-dryrun.json, 10-generality-ts-namespace-import.txt

## [embeddings-health] U1 — keyword-fallback retrieval line erases which model space was compared (`queryModel=none` while coverage names "this model space") (medium)

- Observed: `bb_ask` on bettercap, query "how does bettercap discover and load modules at startup"
  prints `[retrieval: method=keyword-fallback, queryModel=none, indexModel=none, embeddingCoverage=0% (1/55785 symbols embedded in this model space), libraryCoverage=43% (23925/55785 across all models), reason=no-vector-above-threshold, scanned=1/20000, filtered=1, candidates=0]`.
  A remote query vector WAS produced and compared in the configured `nvidia/nemotron-3.5-embed-8b`
  space (the scan's 1 row is that space); the same run's sibling query prints `queryModel=none` after
  falling back to `local-word-vectors-v3`. The line names neither the model nor the dimension on the
  fallback path, so `embeddingCoverage=… "in this model space"` has no antecedent.
- Cause: `src/intelligence/search/semantic-search.ts:583-598` `keywordFallback()` hardcodes
  `queryModel: "none"`, `indexModel: "none"`, `dimension: 0` in `metadata`, while
  `embeddingCoverage` is then filled from `facts.comparison.libraryCoverage`; the handler renders
  `queryModel/indexModel` and prints coverage only when `symbols>0` (`src/mcp/tools/bb_ask/handler.ts:45-78`).
- Why defect: the number that is supposed to let a user diagnose semantic unavailability cannot be
  attributed to a model space; it also contradicts the same tool's Q2 line. Fix: pass
  `facts.comparison` into the fallback metadata (queryModel = space actually compared, dimension),
  and add a gate that no line may print "in this model space" without naming the model.
- Evidence: docs/bb-bettercap-triage/evidence/embeddings-health/01-ask-q1.txt, 02-ask-q2.txt,
  08-source-quotes.txt §C; finding ISSUE-09 §5.2.

## [embeddings-health] U2 — `[INCOMPLETE_INDEX]` remedy cannot fix its own cause: a deliberate >5MB skip is counted as a failure, and `status` ignores `skippedFiles` (medium-high)

- Observed on bettercap: `brain_index_status` = `status=complete total_files=1973 indexed_files=1972`;
  last run counts `skippedFiles=1, errorFiles=0`. The single "never written" file is
  `modules/ui/ui/vendor.js` (5,430,946 bytes), skipped by the size tier
  (`src/ast/parallel-indexer.ts:1005-1013`: `if (fileStat.size > STRUCTURAL_LIMIT) { … stats.skippedFiles++ }`).
  `status` is decided only from `errorFiles`/`missingAfterRecovery`
  (`src/ast/parallel-indexer.ts:7989-8005`), so a deliberate skip can never make it `partial`.
  The health error then says `Run refresh=true, force=true to rebuild from scratch` — which skips the
  same file again, so this project will report `[INCOMPLETE_INDEX]` on every rebuild forever.
- Why defect: (i) an intentional size-tier exclusion is indistinguishable from a lost write;
  (ii) the suggested remedy is provably ineffective; (iii) the same line also prints
  `status=complete` beside it (see ISSUE-11). Fix: persist `skippedTooLarge` separately, decide
  status from `coveredFiles < stats.totalFiles` (intentional skips excluded), name the file/reason in
  a `SKIPPED_TOO_LARGE` warning, and offer `.bbignore`/size-tier as the remedy instead of `force`.
- Evidence: docs/bb-bettercap-triage/evidence/embeddings-health/04-health-plain.txt,
  07-db-forensics.txt, 08-source-quotes.txt §F/G; finding ISSUE-11 §5.1-5.2.

## [embeddings-health] U3 — an index run's embedding outcome is not persisted, so 42.9% coverage cannot be explained (and queue-dropped batches are `log.debug` only) (medium)

- Observed: bettercap `bb health` says `embeddings: 23925 rows / 23925 entities / 42.9% of symbols`
  with per-model split, but nothing in the DB records what the last run attempted: `stats.summary.embedOutcome`
  (`queued/embedded/failed/dropped/skipped`, `src/ast/parallel-indexer.ts:8169-8176`) lives only in
  memory, `indexing_errors=[]`, and `performance_stats` has no embedding counters. The queue overflow
  path drops whole batches with only `log.debug` + an in-memory metric
  (`src/ast/parallel-indexer.ts:2582, 3176-3191`; cap 25,000; drain wait 300 s default at
  `src/cli/index.ts:390`). So the user sees 42.9% but cannot learn whether the remainder was never
  attempted (queue drop), attempted-and-failed per batch (provider down, local fallback), or pending
  — the same missing "backfill pending" state that makes ISSUE-09 unactionable.
- Why defect: coverage is honest but unactionable; a user cannot choose between "wait/retry",
  "reconfigure provider", and "re-run --force". Fix: persist the run's `embedOutcome` and per-model
  counts in `brain_index_status`, print them next to coverage, and count dropped batches as a
  warning (not debug) when they exceed 0.
- Evidence: docs/bb-bettercap-triage/evidence/embeddings-health/07-db-forensics.txt,
  08-source-quotes.txt §H; findings ISSUE-09 §5.5 / ISSUE-11 §5.4.

## go-testintel — test_quality's penalty term is inert (clamp01 floors the composite at 0)
- Observed: `overall` = `Σ conf·clamp01(evidenceStrength − 0.5·penalty)/Σ conf` (`src/intelligence/testing/quality.ts:301-313`). `clamp01` floors the bracket at 0, so a dimension with 0 evidence and `penaltyPotential: 1` contributes exactly 0 and can never pull a file below its other dimensions' credit; for `assertions` (`strength=c/6`, `penalty=1−c/6`) any file with 0–2 assertions scores identical to zero evidence. Measured: `session/session_test.go` recomputes 0.4111 with the penalty fully absorbed.
- Command: recomputation from `evidence/go-testintel/06-quality-session-fp.json` (documented in ISSUE-06 §"What 0.322 is"); `evidence/go-testintel/06-projection-language-aware.json`.
- Why defect: `docs/BB_TEST_QUALITY.md:32-39` publishes a Penalty column ("1 − count/6") that reads as a scoring input; the implementation makes it a no-op at the floor, so "zero evidence" is not distinguished from "insufficient evidence" in `aggregate.mean`.
- Evidence: evidence/go-testintel/06-projection-language-aware.json, findings/ISSUE-06-test-quality.md

## go-testintel — observedAnchor is a hard-coded label, not the token that matched
- Observed: `parameterization.observedAnchor` is the constant `"it.each/test.each template"` whenever `param > 0` (`quality.ts:263`), so Go files matched only by the regex's `%s` alternative report a JS construct they do not contain (4/7 bettercap session files; `%s` counts equal raw match counts exactly). Same fixed-label shape in `mocking` (`"mock-library import"` / `"spy/mock call sites"`) and `assertions` (`"assert/expect usage"`).
- Command: `jq -r '.files[] | [.dimensions[]|select(.id=="parameterization")|.observedAnchor]' evidence/go-testintel/06-quality-session-fp.json`; `grep -o '%s' session/*_test.go` counts.
- Why defect: anchor exists so a reader can tell WHICH construct was observed; a constant makes the field unfalsifiable and actively mis-describes a Go file as JS-parameterized.
- Evidence: evidence/go-testintel/06-quality-session-fp.json

## go-testintel (cross-ref go-callgraph) — leaf-resolved calls make `t.Error`/`errors.New` look like production calls on a second Go repo
- Observed: gqlgen `graphql` index — `executor/executor.go:New:37` receives 155 `calls` rows, all `target_external:"New"`, incl. `callExpression:"errors.New"` / `isStdlib:1` test rows; `batch.go:Error`, `collect_fields_cache_store.go:Len`, `cache.go:Get`, `websocket_subprotocol.go:String` are each page-capped at 20 links from leaf collisions (incl. Go's own `t.Error(` and `fmt.Stringer` selectors). `New` has five symbols in that repo and every leaf row binds to the lowest-id one.
- Command: `node bin/bb tool bb_analyze --dir /home/ishaq2321/bb_tests/repositories/gql-gqlgen/graphql --args '{"mode":"test_mapping","limit":2000}'`
- Why defect: same mechanism as ISSUE-05 at the index layer; it also pollutes `bb_graph`/`bb_impact`/`bb_doc` for the second Go repo, i.e. it is not a test-intel-only defect.
- Evidence: evidence/go-testintel/05-mapping-gqlgen-graphql.json
