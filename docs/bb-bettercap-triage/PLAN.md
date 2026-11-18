# Hunt plan — verified bettercap report defects, ordered by blast radius

Lead plan, 2026-11-18. Inputs: `findings/ISSUE-01…12-*.md` (12 lane verdicts), `findings/LEAD-FINDINGS.md`
(cross-cutting causes L-1…L-5), `GENERALITY.md` (language/tool matrix), `LEDGER.md` (status board),
`CHARTER.md` (evidence rules). Baseline: HEAD `be4c0ef25`, bb `0.1.6`, bettercap index
`4c7590f1…` (1972/1973 files, 55,785 symbols). All 12 report items reproduce in some form; **none is
false claim**, but 6 are misdescribed and 3 have their stated mechanism corrected by the lane work.
Fix order is by blast radius and by dependency, not by report order.

## 0. How to read a plan row

Each row: **what to change** (file:line root cause), **fix**, **gate** (the automated check that must
exist before the fix lands; a gate needs a pre-fix RED run and a positive control so the fix cannot
silently swallow a legitimate case), **verify** (the command that proves the user-visible symptom
gone), **size** (S ≤ 1 day, M 2–3 days, L 4–6 days for one owner), **depends on**.

Standing rule reminder: one language = one lane. P1-1 and P1-2 are both the Go analyzer and must be
owned by the same Go lane. P0-2 is the relationship resolver (a core/indexer lane, not a language
lane). P0-1 is the edit engine (tool lane).

## 1. Priority and sequencing

| order | id | defect family | items closed | size | owner |
|---|---|---|---|---|---|
| 1 | **P0-1** | F2 refactor safety (engine) | 01 (+ U2: dotted refs silently dropped in TS/JS/Python/Java) | M | edit-engine lane |
| 2 | **P0-2** | F1 unscoped name binding (indexer resolver) | 02, 05(index layer), L-1/L-2, cross-tool contamination | L | core indexer lane |
| 3 | **P1-1** | F3 Go import identity | 03 | M | Go lane (same as P1-2) |
| 4 | **P1-2** | F4 Go cross-file value reads | 04 | S | Go lane |
| 5 | **P1-3** | F5 test-intelligence model | 05(mapping layer), 06 | M | test-intel tool lane |
| 6 | **P1-4** | F6 response envelope | 10 | M | MCP tooling lane |
| 7 | **P2-1…6** | F7–F10 + honesty/ops | 07, 08, 09, 11, 12, L-4, U1 | S–M each | tool/embeddings lanes |

Ordering rationale: P0-1 and P0-2 are correctness/safety defects that corrupt user code or every
downstream answer. P1-1 precedes P1-2 because both touch the Go analyzer's per-file model and one
build/reindex cycle should carry both. P1-3 depends on P0-2 landing first (its mapping layer inherits
whatever the resolver emits; the mapping fix must be tested against a clean resolver). P1-4 is
independent and can run in parallel.

---

## 2. P0-1 — Make `bb_edit` refactor fail closed, and stop dropping dotted/namespace references

**Verified finding:** `findings/ISSUE-01-unsafe-refactor.md` — REAL, critical. Four independent
causes stack; each alone is enough to lose a site, and the plan still reports success:

- **A. Caller span attribution.** The `calls` row for `main.go:47` has `source_symbol_id =
  …:main.go:main:1` (the 12-byte `package main` module symbol, bytes 0–12) instead of
  `…:main.go:main:20` (the `func main` symbol, bytes 315–2610). Refactor renames inside the caller
  symbol's byte span (`edit-engine.ts:1988-2006`), so its window is `[0,12)` — line 47 is outside.
  DB proof: 44/44 edges from main.go are on the module symbol, 0 on `func main`. Emitter:
  `real-go-analyzer.ts:561-566`; first-wins name map `parallel-indexer.ts:4351-4360` +
  `CONTAINER_PRIORITY module:0`, resolution at `:5239`.
- **B. Reference classifier.** Go `modules.LoadModules` is `selector_expression.field_identifier`; TS
  `Log.create` is `property_identifier`. `safety-primitives.ts:226-232` puts both in
  `MEMBER_NODE_TYPES`; `isMemberNameNode():265-266` returns true; `isReferenceSite()
  edit-engine.ts:640-647` then drops the occurrence. Measured on a correctly-spanned symbol:
  `NewSessionModule` has 46 package-qualified callers, plan = 1 file/1 site.
- **C. Silent zero-site file drop.** A caller-evidenced file that yields no sites is skipped at
  `edit-engine.ts:2061`; the completeness check at `:2051` only covers declaration/importer evidence
  in the same file. The closing warning says "2 site(s) across 2 file(s)" — success over a known miss.
- **D. No build/type gate.** Post-write validation only filters `/syntax error/`
  (`edit-engine.ts:926-931`), so a rename that leaves `main.go` calling the old name returns
  `validated: true`.

**Fix (four legs, land together):**
1. Span leg: when a `calls`/`uses` row's source symbol is a module/container symbol, fall back to the
   enclosing function/method symbol or to the call-site line's AST node before computing the rename
   window; alternatively store the call-site expression's own byte range. Gate: DB invariant — no
   relationship row may have source symbol type `module` when a same-file function encloses its
   `line_number`.
2. Classifier leg: make member-name classification position- and language-aware — a selector whose
   operand is an imported package/namespace (Go import map, TS `import * as`, Python module, Java
   static import) is a **reference**, not a member. Fall back conservatively (do not rename) only when
   the operand is a value/receiver whose type is unknown, and then **report** the skipped site.
3. Completeness leg: a caller-evidenced file with zero planned sites must (a) count as a survivor
   and (b) make the plan refuse (or, behind an explicit `allowIncomplete` flag, list it in
   `warnings` with file:line). No silent success.
4. Gate leg: add a pre-commit verification step that resolves every renamed name in every planned
   file's content and refuses if a known candidate reference text remains; where the project's
   toolchain is available and cheap (Go `go build ./...`, `tsc --noEmit` for TS files, `python -m
   py_compile`), run it bounded and report `verification: {attempted, tool, result}` — never claim
   verified when it did not run.

**Gate:** extend `script/m71/probe-refactor-completeness.ts` with (a) Go two-package module where
`main` calls `modules.LoadModules` (positive: caller renamed; negative control: pre-fix plan misses
it), (b) Go symbol whose caller is `package main` module attribution, (c) TS namespace import
`Log.create`, (d) same-package unqualified control still renamed, (e) "caller evidence + zero sites"
refuses. Run under `script/m13/verify-edit-rename.ts` + a new `verify-refactor-build.ts` leg.

**Verify on bettercap:** dry-run `LoadModules → LoadModulesRenamed` must plan **3 files / 3 sites**
(main.go included); a real rename on an indexed scratch copy + `go build ./...` must pass; the
dry-run must never be accepted as complete when a caller file yields 0 sites. Measured current:
2 files / 2 sites, main.go:47 untouched.

**Do not:** fix by adding `main.go` to an allowlist, or by making `refactor` reindex-only, or by
lowering `isMemberName` to false for all members (would rename `obj.method` on unrelated receivers —
must be operand/import-scoped).

---

## 3. P0-2 — Stop binding unresolved leaf names across files/packages/languages (L-1/L-2)

**Verified finding:** `findings/LEAD-FINDINGS.md` L-1/L-2 + `ISSUE-02-…` (REAL-BUT-MISDESCRIBED,
high). Same root cause produces report item 2 and the index layer of item 5, and contaminates graph/
impact/hover/orphans.

**Root cause chain (measured):**
1. Analyzer honestly records leaf-only targets for qualified external references (`errors.New`,
   `os`, `fmt`, `io`) with metadata `isPackageQualified/isStdlib` and `reasonCode=
   callee_recorded_as_a_leaf_name_whose_owner_is_not_resolved_per_file`
   (`real-go-analyzer.ts:6560-6588`).
2. Eager resolver binds any bare target to a project symbol by name, ranked
   definition → same-file → same-language → **any language, lowest id** (`parallel-indexer.ts:3863`
   `resolveTargetStmt`, used `:5409`); deferred passes repeat the ranking (`_i13_best_any:6634`,
   `_i13_pick:6656`) and the cross-language marker then certifies language mismatch as a bridge
   (`:5876`, `:6749`).
3. The read surface republishes stored confidence/tier and launder `target_basis` to `symbol`
   (`cross_language_hover.ts:485-512`; graph reports `targetBasis:"symbol"` for rows that were never
   resolved to a real target).

**Measured blast radius:** bettercap `session.New:155` has 89 incoming `calls`; 88 come from
`target_external='New'` leaves of stdlib calls in files that never import `session`. Cross-language:
2,423/2,423 rows are `name-resolution` (≥43% structurally impossible pairs, e.g. `go→make imports`);
workspace project 15,836 cross rows, TS→JSON/Markdown at confidence 1.0/`structural`. All 7 report
rows are this mechanism (imports `os`/`fmt`/`io` rebound to YAML/Makefile/minified-JS symbols;
4 FontAwesome `main = _ref.main` destructuring rows rebound to Go `package main`).

**Fix:**
1. Binding gate: refuse to bind a target whose metadata declares `isExternal`/`isStdlib`/
   owner-unresolved `bindReason`, or whose candidate symbol is a non-code-symbol kind in a
   non-executable file language (reuse `analysis-exclusions.ts:108` NON_CODE_LANGUAGES — the product
   already declares "a YAML key/Markdown heading/JSON property has no callers and never will").
2. Scope: when a binding is attempted for a qualified target, resolve through the source file's
   import/package map (module path → dir for Go, relative import resolution for JS/TS) and require
   same-language for `calls`/`instantiates`; leave `unresolved`/`ext:` otherwise.
3. Cross-language marker: only set `is_cross_language=1` when an explicit bridge exists (import-path
   map, FFI/extern, generated artifact, known codegen pair), or degrade name-only rows to
   confidence ≤ 0.5, `evidenceClass: "inferred"`, `bindingBasis: "name-resolution-candidate"`, and
   never let them render as `imports`/`structural`. Preserve genuine bridges (positive control:
   graphql→TS codegen rows must survive).
4. Read surfaces: expose the binding basis/candidate; never launder `target_basis`; graph/cross-
   language/impact/orphan consumers must be able to see "candidate, name-only".
5. Deferred-pass determinism: the same ranking is duplicated in 3 places (eager, `_i13_pick`,
   `_res_best`); consolidate into one resolver used by both paths so a fix cannot apply to one arm.

**Gate:** (a) in-repo precision fixture: Go file importing stdlib + YAML/Makefile/JS files with
colliding tokens → assert 0 `calls`/`imports` rows bound to non-code files and 0 cross-language rows;
(b) mutation gate on `_i13_pick` + `resolveTargetStmt` (remove the gate → gate fails);
(c) bettercap assertion set: `cross rows where bridge=name-resolution and relationship_type in
(imports,calls,extends,instantiates) == 0`; `session.New` incoming calls from files without a
`session` import == 0; (d) positive control: real Go import of a same-module package resolves
internal, and graphql→TS bridge fixture survives.

**Verify on bettercap:** `bb_cross_language symbol=main` must show **no** `imports` facts to
`.github/**`, `Makefile`, `ol.js`; `bb_analyze callers target=New` must not list
`caplets/caplet_test.go`/`js/data_test.go` false callers; `bb_graph New` crossLanguageEdges honesty
declared. Current: 7 facts / 89 calls as above.

**Do not:** disable the cross-language feature globally, or drop all name-resolution rows without
the positive bridge controls (the contract documents them as candidates, so the fix is precision and
labelling, not extinction).

---

## 4. P1-1 — Go import identity: module path, `isExternal`, resolution (report 3)

**Verified finding:** `ISSUE-03-…` — REAL, high. 3-link chain: (1) Go analyzer never declares
`isExternal`/same-module (`real-go-analyzer.ts:5586-5599`, `:6188-6190` true for own module path), and
`pool-worker.ts:1930-1937` applies the JS rule "bare specifier ⇒ external" → all 1,880 import rows
`is_external=1`; (2) `dependencies.ts:274-288` only resolves when `!external`, dependents populated
only there, so `dependents:[]` (not resolution-independent); (3) no go.mod awareness anywhere, and the
index-time resolver only handles `<path>:<item>` targets, so Go edges never resolve.

**Generality:** Go broken on 3/3 Go indexes (bettercap 1,880/1,880; gh-cli 122/122; gqlgen 67/67);
JS/TS already correct. Sub-claim `unresolvedSpecifiers:0` is REAL-BUT-MISDESCRIBED (field is
documented internal-only; 0 is consistent with the wrong all-external input).

**Fix:** (1) persist `go.mod` module path + module-relative root at index time; (2) Go analyzer
publishes `isExternal=false` for same-module specifiers; (3) resolver maps module-path prefix →
package dir → all `.go` files in it, emits `resolution:"resolved"` for internal edges;
(4) external rows emit no/`external` resolution; rename the internal counter in the contract.

**Gate:** 4-file Go fixture gate in `script/verify-analyze.ts` (internal dep b resolved, b.dependents
contains a, `fmt` external, `returnedInternalDependencies ≥ 1`); post-index invariant "no
`brain_import` row whose path starts with the project module path may be `is_external=1`"; both must
run pre-fix RED.

**Verify on bettercap:** `dependencies filePath=session` → internal deps resolved (module path
prefix), non-empty dependents; `returnedInternalDependencies > 0`; `bb_graph` no longer shows
same-module imports as `ext:`.

---

## 5. P1-2 — Go cross-file function-value reads (report 4)

**Verified finding:** `ISSUE-04-…` — REAL-BUT-MISDESCRIBED, high. Orphan engine is correct and
kind-aware (`orphans.ts:49` includes uses/references; 70% formula at :909-913); the input is missing
because the Go GO1 pass only emits `uses` for same-file declarations (`fileValues` built at
`real-go-analyzer.ts:5015-5030`, gate `:5382`). `plugin.Defines["onEvent"] = jsOnEventFunc` at
`session/session.go:336` names a function declared in another file → **0 rows of any kind**. All 7
sibling callbacks identical; totals exact (4,385/2,739/1,644/4,697). `callers=0` is correct call
semantics — do not "fix" it.

**Fix:** emit a cross-file leaf value-read row (anchored at the use, declared-file out of scope) with
the analyzer's already-existing reason code
`used_identifier_recorded_as_a_leaf_whose_declaring_file_is_out_of_scope`
(`real-go-analyzer.ts:188-189`), so orphan/graph/hover see the reference. Optionally a bounded
per-file resolve of leaf→declaration by package dir. Also add asset-exclusion for the vendored
`modules/ui/ui/assets/**` tail in the file-orphan rule (separate issue: 1,573 of 1,644 orphaned-file
candidates are FontAwesome SVGs) — do this as a `bb_patterns` design fix, flagged, not a silent
count change.

**Gate:** extend `validation/m14/fixtures/go` with a two-file package `Registry["x"] = callback`
fixture + expectation `uses setup -> callback` under `script/m14/mutate-analyzer.ts`; a
`script/m13/verify-patterns-orphans.ts` assertion that a registered callback is NOT an orphan
candidate while `callers` remains 0.

**Verify on bettercap:** `bb_analyze callers jsOnEventFunc` stays 0 (correct), but the symbol must
carry an incoming `uses`/reference row and must **not** appear in the orphan page;
`bb_patterns scope=orphaned` census drops accordingly (report exact delta, do not chase to zero —
asset rule is separate).

---

## 6. P1-3 — Test intelligence: validate mappings, and make the quality model language-aware (report 5/6)

**Verified findings:** `ISSUE-05-…`, `ISSUE-06-…` (both REAL). **Issue 5 (3 layers):** (i) Go analyzer
emits a package-qualified call as its bare LEAF (`real-go-analyzer.ts:6581-6588`; `errors.New` →
`target_external:"New"` with `isStdlib/isPackageQualified` only in metadata); (ii) the unscoped resolver
(the P0-2 defect) binds it to the project-wide lowest-id symbol (`parallel-indexer.ts:3863-3872`,
I13 `:6656-6696`), ignoring the row's own metadata — 91/91 incoming `session.New` calls come from bare
`New`, 50 of them from 13 test files; `Lock`/`Unlock` get 152 rows each from embedded `sync.Mutex`
calls; project-wide 457 of 3,245 test-file call rows (14.1%) are this stdlib-leaf shape, and
gqlgen/graphql reproduces (`executor.New` 155 leaf rows over 5 symbols); (iii) test-intel publishes a
stored call as `direct_call` 0.85 with no package/import validation (`test-intel.ts:229-236/275-287`).
Ground truth: `session.New` is untested — the correct mapping is 0 links. **Issue 6:** aggregate
0.322222 = mean of 7 per-file overalls; 7/7 `assertions: 0` against 114 real Go assertion sites;
`error_handling` is also 0 (report omitted); "parameterization" actually fires via the **`%s`
printf-verb** branch (`quality.ts:124`), with the hard-coded anchor string `it.each/test.each
template` (zero it.each tokens in the corpus); `fixtures` resolves to the `testing` import; the
classifier table is one JS-shaped table (`quality.ts:108-130`, `:235-244`, `:258-266`) and `language`
is selected at `:159` then never used. Shipped-classifier probe: Go t.Fatalf 0; testify 2/4
(`require.*` invisible); JS vitest 1.0; Python pytest 0/0; TS node:test 0.167 → JS-shaped globally.

**Fix:** (i) mapping: require the stored target to resolve to the exact symbol (not a leaf name) **and**
a reachability relationship (same package/module import, or resolved edge) before attaching a test;
otherwise report `unresolved` instead of 0.85; this must land after P0-2 so it is not testing against a
dirty resolver; (ii) quality: per-language assertion vocabularies (Go: `t.Fatal/t.Errorf/t.Fatalf/
t.Error`, testify `require.*`/`assert.*`, `cmp.Diff`; Python: `assert`, `pytest.raises`), per-language
parameterization anchors (Go `for _, tt := range` + `t.Run`, Python `pytest.mark.parametrize`, JS
`it.each/test.each`), remove the `%s`-count proxy or make it per-language, anchor `fixtures` on real
fixtures; (iii) surface the language heuristic used in the payload (and remove the inert
`clamp01` penalty path recorded in UNLOCKED).

**Gate:** fixtures for Go table-driven + testify + plain if/t.Fatalf, JS it.each, Python parametrize
(where environment allows; Go/JS must be in-repo) asserting `assertions > 0` and the language-correct
parameterization basis; mapping gate: a call to a same-named symbol in another package must NOT map
(pre-fix RED pins the measured bettercap rows: `errors.New`/`otto.New` → `session.New`); quality
projection from the lane's measurement (0.322 → ~0.50 with language-aware bases) must be reproduced,
not hand-tuned.

**Verify on bettercap:** mapping for `session.New` contains no caplets/js rows (correct answer: 0
links); Go test files score assertions from their 114 real sites; aggregate moves with the new basis
declared; `%s` no longer the only parameterization signal.

---

## 7. P1-4 — One response envelope with summary-first bounds (report 10)

**Verified finding:** `ISSUE-10-…` — REAL-BUT-MISDESCRIBED composite, medium. The `345 vs maxNodes
200` headline is two units (engine caller rows vs dependent-node budget; budget is enforced —
`shownCount=200`, reason `impact-node-budget-exhausted`; `maxNodes` is not caller-settable). Real:
payload size (graph Session 1,087,986 B > 1 MB; impact Session 188,433 B) and bounds-after-data
(graph summary at 99.46–99.71%; impact counts at 99.73–99.90%; a 150 KB cut of the 188 KB impact
answer contains zero `truncated`/`shownCount` tokens). Root: four hand-ordered JSON literals
(`bb_impact/handler.ts:160-192`, `bb_graph/handler.ts:199-287`, visualize json, analyze=impact), no
shared envelope.

**Fix:** shared `boundedResult(summary, data)` emitted by all four surfaces: `summary` first with
`truncated/truncationReason(s)` then counts/budget then `payloadBytes/payloadBudgetBytes` then
`freshness`; `data` second; 256 KB default payload budget with byte-truncation declared; dedupe
graph endpoint duplication with a node table; rename `returnedCallers` → `engineCallerRows` (units in
the name) and document.

**Gate:** contract gate asserting the first top-level key is `summary` and every bound appears
within the first 4 KB; `shownCount ≤ budget.maxNodes`; hub-symbol payload ≤ 256 KB or declared byte
truncation; run over every tool payload family (impact/graph/visualize/analyze-impact).

**Verify on bettercap:** `bb_graph Session` payload ≤ 256 KB with summary in first 4 KB;
`head -c 150000` of `bb_impact Session` contains `"truncated": true` and `"shownCount"`.

---

## 8. P2 items (independent, each with its own gate)

| id | issue | fix (root cause) | gate | verify |
|---|---|---|---|---|
| P2-1 | 07 doc scope | doc-engine `:713-741` name-only union: declare scope in title/body ("union of N symbols"), prefer declaration/struct over fields, make qualified target disambiguate, make `limit` a per-section cap not a subject selector, add a scope term to `quality.passed` (or declare the pass is consistency-only) | doc contract test: ambiguous name ⇒ scope declared; qualified target ⇒ one subject; `limit:1` never changes subject | `bb_doc Session` leads with the canonical struct + scope sentence; `session.Session` yields one symbol |
| P2-2 | 08 search surface | symbol mode: preferred fix — include bounded source slice using existing byteStart/byteEnd (honoring descriptor promise "exact symbol source") with `sourceTruncated`; alternative — correct descriptor/onboard/MCP guide claims. Unify `fileId` to `<projectId>:<relativePath>` in symbol mode (`engine.ts:2836`) and drop absolute path or move to `absolutePath` | mode-field matrix gate (descriptor-promised field per mode); identity gate (same file same fileId across symbol/content/file; no `/^\/` fileId); docs-vs-descriptor honesty gate | symbol mode returns source (or claims corrected); all four modes agree on fileId |
| P2-3 | 09 embeddings lifecycle | (a) persist durable `backfillPending` state when the configured model space is under-covered (reconcile exists at `parallel-indexer.ts:2966+` but runs only inside `bb index`, stops after 2 stalled batches, records nothing); (b) make the read path prefer/fall back to the most populated model space **with a declared fallback** instead of hard-filtering to the configured one (`semantic-search.ts:329-333`), and never silently degrade index batches to local word vectors without recording it (`engine.ts:412-431`); (c) expose per-space coverage + pending state in `bb_ask` metadata/health | provider-switch integration test: configure a second provider → next query either uses a populated space with declared fallback or reports pending backfill; a project with <5% coverage can never return an undeclared keyword answer | `bb_ask` on bettercap answers from the 23,924-vector local space with a declared fallback, or declares "backfill pending: 1/55,785 in configured space" |
| P2-4 | 11 index health | (a) derive `status` from all completion causes including deliberate `skippedFiles`, never print `complete` beside an INCOMPLETE count (`parallel-indexer.ts:7989-8005`); (b) replace the `force=true` remedy with the real cause: the 1 missing file is `modules/ui/ui/vendor.js` (5.43 MB, skipped by the >5 MB size tier) — say "skipped by size tier", which `force` cannot fix; (c) split syntax-error attribution: 16 `.less` (CSS-grammar gap: `@var` / `.@{}` interpolation) vs 8 `.scss` (separate lane); (d) coverage line must explain configured-space vs library coverage and pending backfill (P2-3), and persist `embedOutcome` instead of losing it | health honesty test: a run with skipped files can never report `status=complete`; the incomplete remedy must name a cause `force` can address (or none); syntax-error summary groups by language; coverage line states both spaces | `bb health bettercap` shows consistent status, per-language error attribution, two-space coverage |
| P2-5 | 12 emitters | security formatter label "lead-tier analyzers" (registry census is project-independent; stored leads line is the only lead count) + regenerate docs; visualize claim gated on `scope==project && !truncated && offset==0`, otherwise emit "N of M symbols in this <scope> page — not the whole project" | text-emitter gate matrix over scope × truncated × absent; docs truth gate greps the corrected label/claim | both texts are true in every probe combination |
| P2-6 | L-4 old-index | read-tool open either bounded-migrates or refuses with a named schema/compatibility error naming remediation; never emit raw SQLite `no such column` | integration test opening a v(N-1) fixture DB: `isError` with named refusal containing `schema`/`migration` | graph-family tools no longer crash on the 2026-10-17 indexes |
| P2-7 | U1 dist integrity | rebuild `dist` and add a dist-integrity gate (every referenced chunk exists; no stale hashed chunk references), then restart the workspace MCP server | `script/verify-dist-integrity.ts` extension: static check that all relative chunk imports exist; CI runs it on every build | MCP `bb_edit`/`bb_search` work on the workspace project; `Cannot find module dist/database-HE6EE3VA.js` impossible |

## 9. Do-not list (anti-fixes that would hide the defect)

- Do not "fix" issue 4 by making `callers` include non-call references — the missing edge kind is
  `uses`; callers=0 is correct.
- Do not fix issue 10 by raising budgets/limits or by truncating output silently — the defect is
  ordering and declared units.
- Do not fix issue 2 by disabling cross-language rows outright — the contract documents them as
  candidates; fix binding scope + labelling and keep genuine bridges (positive controls).
- Do not fix issue 7 by sorting `session/session.go` first only — a union still needs a declared
  scope and a subject; the qualified-target path must actually disambiguate.
- Do not fix issue 3 by marking all imports internal — stdlib/third-party must stay external.
- Do not weaken the orphan formula or assertion heuristics to move numbers; add the missing evidence
  and language vocabularies.

## 10. Open questions / campaign limitations carried into the fix work

- Fresh-index creation was blocked in this environment (`bb index` cannot mkdir under
  `~/.bb/projects`), and `/tmp` was per-bash-call ephemeral, so Python/Java/Rust generality cells are
  code-prediction only (`GENERALITY.md` §4). First fix session should re-run those cells on a machine
  with index-write access.
- Whole-repo `go build ./...` on bettercap was blocked (needs go1.25 toolchain/network + writable
  module cache); the compile consequence was proven on a two-package fixture instead. P0-1's gate leg
  should use the real repo when the toolchain is available.
- The workspace MCP server was serving a stale dist chunk during the campaign (U1); evidence was
  captured through the CLI `--dir` path. Fix P2-7 before relying on MCP-side parity again.
- The report's exact byte numbers (impact ~137 KB, graph ~962 KB) and the exact `returnedCallers:345`
  query were not reproducible byte-exact; size class and mechanism reproduce, numbers recorded as
  drift (see ISSUE-10 §3).

## 11. Definition of done for the campaign

For each P0/P1 row: lane finding exists (it does), fix landed behind its gate (gate fails before,
passes after; positive control green), bettercap verify command shows the user-visible symptom gone,
and `LEDGER.md` row moved to FIXED with the gate name and evidence path. P2 rows may be batched but
must not be silently dropped: each is either fixed with its gate or explicitly deferred with a
`KNOWN-ISSUES.md` entry written by the owner.
