<!--
Author: Muhammad Ishaq Khan

WHAT THIS DOCUMENT IS — the Phase A read-only audit of bb_search: every mode and option
  exercised through the real MCP stdio door, the engines' runtime behaviour measured on both
  drivers (better-sqlite3 under Node, bun:sqlite under Bun), the docs' claims checked against
  observed answers, the existing gates inventoried and run, the regex and authorship census,
  and the defect list Phase B fixes.
WHO IT IS FOR — the bb_search owner (this file's author) and the campaign Lead reviewing scope.
EDIT TOGETHER WHEN THIS CHANGES — src/mcp/tools/bb_search/handler.ts, src/mcp/tools/bb_search/descriptor.ts,
  the four search engines, script/verify-search-modes.ts, script/m13/verify-search-*.ts,
  script/m15/verify-search-complete.ts, docs/BB_SEARCH.md, and validation/tools/bb_search/LATENCY.json.
-->

# bb_search — Phase A audit

Tool: `bb_search` (read, requiresIndex, modes `symbols` / `content` / `symbol` / `file`).
Working tree: campaign split landed (`src/mcp/tools/bb_search/{descriptor,handler}.ts` exist);
git HEAD `c43282e9268414205ca755f485393a8e4535c77f`; tree carries the Lead's split, uncommitted.
Compiled subject: `dist/` rebuilt at `2026-11-01T13:42` (rebuilt during this audit; the
reported numbers name that build).

**Everything below was produced by commands in `validation/tools/bb_search/audit/`.** The
raw payloads are the evidence; this document is the reading of them.

---

## 1. Method and environment

| What | How |
|---|---|
| Real MCP door | `@modelcontextprotocol/sdk` `Client` + `StdioClientTransport` to `src/mcp/server.ts` (Bun) and to `node bin/bb mcp --dir` / node+tsx source (Node). `validation/tools/bb_search/work/mcp-probe.ts` |
| Fixture | `validation/tools/bb_search/work/project` — 11 files, 44 symbols: exact/prefix/substring names, two files declaring `duplicateName`, a class + method, a constant, a Greek identifier (`UNICODE_ΣΊΣΥΦΟΣ`), `get_user` vs `getXuser` (LIKE-metacharacter probes), a body-only token (`bodyOnlyNeedle`), 25 `pagedSymbolNN` for pagination, Go file (`ProcessValue`), `__tests__/` file, `node_modules/` + `.d.ts` noise inputs, a stale file, a deleted file, an unindexed file, a 110 KB file, a symlink escaping the root |
| Index data | `BB_DATA_DIR=validation/tools/bb_search/bbdata` for every fixture leg — the shared `.bb-data` is never indexed into |
| Reads | `BB_NO_AUTO_REFRESH=1` on every measurement read (charter §3.6); the auto-refresh behaviour itself was probed in a separate declared run |
| Matrix | 84 calls × (bun runtime, node runtime) = `audit/matrix-raw.json`, `audit/matrix-node-raw.json`, digest in `audit/matrix-summary.tsv`; bounds probes in `audit/bounds-raw.json`; extras in `audit/extras-raw*.json`; auto-refresh probe in `audit/autorefresh-raw.json` |
| Latency | `audit/latency-{t0,t1,t2}.json`, summarised in `validation/tools/bb_search/LATENCY.json` |
| Gates | every existing bb_search gate run from this working tree; evidence redirected into `validation/tools/bb_search/gates/evidence/` through `work/harness-redirect.ts` so no shared evidence file was rewritten (see §7 for why) |
| Docs | `script/verify-tool-docs.ts` verify mode run by the docs gate (green); claims checked one by one against the matrix |

Two facts about the runtime matter for everything that follows: the tool ships as **Node +
better-sqlite3** (`bin/bb` is a Node entry over `dist/`), while the gate scripts and
`bun src/mcp/server.ts` run **Bun + bun:sqlite**. The two SQLite drivers disagree about what
`Statement.get()` returns when there is no row — `undefined` under better-sqlite3, `null`
under bun:sqlite — and two content-search guards are written as `!== undefined` (§3 D1).

---

## 2. Contract matrix

### 2.1 Mode × option acceptance (observed at the real MCP boundary)

`ok` = accepted and honoured; `refused` = `isError: true` with a message naming the accepted
set; `ignored` = accepted and silently not honoured (defect); `absent` = the mode has no such
concept.

| option | symbols | content | symbol | file | descriptor text | verdict |
|---|---|---|---|---|---|---|
| `mode` | ok | ok | ok | ok | enum of 4 | ok |
| `query` | ok | ok | ok (alias of symbolName) | refused | "Not accepted in file mode" | ok |
| `symbolName` | refused | refused | ok | refused | "exact symbol name for symbol mode" | ok |
| `filePath` | refused | refused | ok (disambiguator) | ok | as stated | ok |
| `limit` | ok (default 15) | ok | **refused** | refused | **"symbols/content/symbol modes only"** | **drift** |
| `offset` | ok | ok | refused | refused | "pagination offset (default 0)" unscoped | **drift** |
| `language` | ok (NOCASE) | ok but **case-sensitive on Node classic path** | refused | refused | "case-insensitive… symbols/content modes only" | **drift + D5** |
| `symbolKind` | ok (NOCASE) | ok but **case-sensitive on Node classic path** | refused | refused | "case-insensitive… symbols/content modes only" | **drift + D5** |
| `includeContent` | ok | refused | refused | refused | "symbols mode only" | ok |
| `exact` | ok | refused | refused | refused | "symbols mode only; obeys caseSensitive" | ok, except **D8** with `regex:true` |
| `caseSensitive` | ok | refused | refused | refused | "symbols mode only" | ok |
| `regex` | ok (routes to regex engine) | refused | refused | refused | "symbols mode only" | ok |
| `refresh` | ok (per-call opt-out) | ok | ok | **refused** | unscoped; "false opts out of the inline auto-refresh" | **drift + D6** |
| unknown option | refused, message names accepted set + aliases | same | same | same | "rejected … never silently ignored" | ok |

Declared defaults are executed by the handler: `mode symbols`, `limit 15`, `includeContent false`,
`exact false`, `caseSensitive false`, `regex false`, `offset 0` (`symbols.default`,
`content.default`, … in the matrix). `limit:0` returns no rows; `limit:1.5` → "must be a whole
number"; `limit:-1` → "must be non-negative". No `limit` ceiling exists (D10).

### 2.2 Output shape and declared evidence per mode

| mode | wire shape | `searchMode` | match-set declaration | freshness | rows carry `stale` |
|---|---|---|---|---|---|
| `symbols` | **plain text lines + footer** | **absent** | footer "showing X of Y" only when `total > page` — **no `totalMatches` / `truncated` field** | no `freshness` block; `[STALE]` marker + "N of M results are STALE" footer | yes |
| `content` | JSON envelope | `content` | `total` / `returned` / `truncated` / `truncationReason` | `freshness` block (`complete`, dir scope) | yes |
| `symbol` | JSON envelope | **absent** (matches array + `totalMatches`/`truncated`/`freshness`) | `totalMatches` (always complete; no paging) | `freshness` block | yes |
| `file` | JSON envelope | `file` | `totalMatches: 1`, `contentLength`, `truncated` at 100 000 chars | `freshness` block (file scope) | `stale` boolean |

`freshnessModes` registration is `["symbol","content","file"]`, so `symbols` being text-only is
consistent with the registry *field* but not with the registry *description* (§4 D14).

Verified bounds: `file` truncation at 100 000 chars with full `contentLength` (110 050-byte
probe → `truncated: true`, 100 000 chars returned); `content` and `symbols` paginate
(`offset` honoured, pages distinct); regex reports `scan-cap` / `time-budget` /
`projection-cap` / `unisolated-scan` and refuses to present a cut scan as complete (the empty
page footer says "this is NOT a complete answer").

### 2.3 Refusals observed (all `isError: true` at the MCP boundary)

`symbols` blank/absent query; `content` blank query; `file` missing `filePath`; `file` path
escape (`../escape.ts`, symlink `src/escape-link.txt` → `/etc/hostname`); `file` path is a
directory; `file` unindexed file; `file` nonexistent file; `file` with `query`/`limit`/`refresh`;
`symbol` blank `symbolName` when `query` given; `symbol` disagreeing `symbolName`/`query`;
`symbol` with `limit`/`offset`/`language`/`includeContent`; unknown `language` (lists indexed
vocabulary); unknown `symbolKind` (lists indexed kinds); unknown option (names accepted set);
invalid regex (named `invalid regex "<pattern>": <V8 message>`); unknown mode (enum error);
project with no index ("No index found …", isError). `symbol` mode for a missing symbol is a
**success** with `matches: []`, `totalMatches: 0` — declared absence, acceptable but
undocumented.

Two semantic gaps: `exact:true` + `regex:true` is accepted and `exact` is silently ignored
(D8), and `symbol` mode with a `filePath` that hits the LIKE fallback returns a match **without
the `language` field** (D11).

---

## 3. Defects (severity, evidence, root cause, Phase B fix)

### D1 — CRITICAL — content mode answers differently on the two runtimes, and the "giant corpus" guard never fires on either

**Evidence**

* `audit/matrix-summary.tsv`: `content.default` on Bun = `{total:1, matchMode:undefined,
  bodyCoverage:undefined}`; on Node = `{matchMode:"phrase", bodyCoverage:{withBody:0,…}}`.
  `content.multiWordNoPhrase` ("how does handle request work") = **0 rows on Bun**, 4 rows on
  Node. `content.lang.upper` ("Go") = 2 rows on Bun, **0 on Node** (that one is D5).
* `content.bodyOnly` ("bodyOnlyNeedle", which appears only inside
  `bodyOnlyHost`'s body) = 0 rows on **both** runtimes, though the fixture DB has 38/41
  symbols with a non-null `source_text` (`audit/fixture-state.json`).
* Instrumented copy of the current source, run under Bun:
  `audit/` engine probe → `isGiantCorpus=true` and `ensureContentFts=true` for a 41-symbol
  project whose `brain_symbol_content_fts_meta` is empty.

**Root cause** (two sites, one class of bug — `content-search.ts`):

```ts
// line 243 — isGiantCorpus()
return probe !== undefined              // bun:sqlite returns null when no row → always "giant"
// line 95  — ensureContentFts()
return marker !== undefined             // bun:sqlite returns null when no marker → always "ready"
```

* Under **Bun** both guards read as true: every project takes `searchContentBounded`, whose
  substring phase prefers the (empty) FTS table when `contentFtsReady` and skips the
  `source_text LIKE` fallback — so **qualified name, docstring and body are never searched**,
  the terms route does not exist in that path, and `matchMode` / `termMatch` /
  `bodyCoverage` are never emitted.
* Under **Node** both guards read as false: every project takes `searchContentClassic`, which
  loads the whole corpus per query and — because `searchContentClassic`'s SELECT omits
  `s.source_text AS sourceText` — **never searches a body**, while `bodyCoverage` reports
  `withBody: 0` for a corpus where 38/41 symbols have a body (a declared-absence lie in the
  field that exists specifically to distinguish "nothing matched" from "nothing could match").
* The bounded path that exists for giant corpora never runs on the product runtime, so the
  current workspace's 310 423-symbol index is fetched whole on every content query (see D16 /
  §6 T2 content p95).

**Fix plan:** make both guards driver-agnostic (`row != null`), make the classic SELECT carry
`source_text`, and make `bodyCoverage`/`matchMode` present in **both** paths (or delete the
classic path in favour of one path — the two-path split is what let them drift). Regression
test: body-only word found, `bodyCoverage.withBody > 0`, `matchMode` present, offset honoured,
on a small fixture under **both** runtimes.

### D2 — CRITICAL — regex symbol search intermittently returns "no results" for matching patterns

**Evidence**

* Compiled product subject, trivial pattern, 41-symbol fixture:
  `for i in 1..10: node bin/bb tool bb_search --dir .../project --args '{"query":"^handle.*","regex":true}'`
  → **7 returned matches, 3 returned "no results … scan was cut short (time-budget)"**
  (`audit/` transcript in this session; the same pattern is fully deterministic in the engine).
* Node+tsx MCP matrix: `symbols.regex.valid` and `symbols.regex.exactBoth` both cut at 2 s with
  an empty result; compiled `bb mcp` latency: all 5 warm runs cut.
* The direct worker experiment (`node /tmp/worker-test.mjs`, worker chunk loaded manually)
  posts `{ok:true, matchedIndexes:[0]}` immediately — the worker itself is correct.

**Root cause:** `regex-scan-worker.ts` starts the 2 000 ms `setTimeout` **before**
`new Worker(...)`, so worker-thread startup (loading the chunk and its import graph inside the
thread) is charged against the matching budget. On a loaded machine that start alone crosses
2 s; `scanWithDeadline` then resolves `{timedOut:true, matchedIndexes:[]}` and the answer is an
empty page with an honest-but-wrong "no results". On the fallback path
(`worker.on("error")`) it reports `inline: true` without ever running the inline matcher, so the
fallback cannot recover either.

**Fix plan:** start the deadline only on `worker.on("online")` (or after a separate startup
allowance), keep the hard kill for matching; make the error path actually run `matchNames`
inline when a matching budget remains; add a deterministic negative case that plants a worker
that never posts and asserts the answer is declared-bounded, plus 10 consecutive warm calls that
must all return the same match set on a small fixture.

### D3 — HIGH — `symbol` mode silently returns nothing for every project under a noise-named directory

**Evidence:** T0 fixture `test/fixtures/polyglot` — `symbols` mode finds `applyDiscount`
(and `content` mode finds it), `mode:"symbol", symbolName:"applyDiscount"` returns
`{"matches":[],"totalMatches":0}` — compiled product subject, both through
`node bin/bb tool` and through MCP. `audit/latency-t0.json` `symbol.default` records the empty
result.

**Root cause:** `findSymbol` (src/ast/engine.ts) returns `fileId` as the file **PATH**, and its
own consistency filter is `matches.filter(m => !isHardNoisePath(m.fileId))`. `isHardNoisePath`
is a *relative-path* predicate that treats any `fixtures` / `gen` / `build` / `dist` /
`vendor` / `snapshots` / `coverage` segment as noise, so a project checked out under
`test/fixtures/…` (or any repo whose absolute path contains one of those segments — a
`build/` workspace, a `dist/` checkout) loses **every** exact-symbol answer. The same filter is
correct in `symbol-search.ts`, where it is fed `relative_path`.

**Fix plan:** filter on the relative path (the handler can compute it for the returned matches,
or `findSymbol` can return `relative_path`); regression test with the project root itself under
a `fixtures/` segment asserting `mode:"symbol"` finds a symbol that `mode:"symbols"` finds.
(NB: `findSymbol` lives in `src/ast/engine.ts`, outside this tool's write scope — the handler-side
fix is in scope; the engine-side fix is requested from the Lead.)

### D4 — HIGH — gate `verify-search-honesty.ts` is red after the split, and pins a defect

**Evidence:** `bun --preload work/harness-redirect.ts ./script/m13/verify-search-honesty.ts`
→ exit **1**, `S4: KNOWN-GAP (13/16 passed)`:
`FAIL: symbol mode: handler delegates to ASTEngine.findSymbol` — the gate reads
`src/mcp/tool-handlers.ts`, which no longer contains the handler body (split moved it to
`src/mcp/tools/bb_search/handler.ts`);
`FAIL: file mode: guard requires a brain_file row…` — same stale file;
`FAIL: runtime: file mode refuses unindexed path (negative)` — the gate calls the handler and
expects it to **throw**, but the handler correctly returns an `isError` envelope (the
`verify-search-modes.ts` gate documents that it had to stop demanding a throw for exactly this
reason; the honesty gate still does).

**Fix plan:** point the static reads at the module that now owns the behaviour (handler file +
engines, not the assembler), replace the throw assertion with an envelope assertion, and add a
negative that mutates the copied tree to prove the check can go red.

### D5 — HIGH — content mode's `language`/`symbolKind` filters are case-sensitive on the product runtime

**Evidence:** `content.lang.upper` `{mode:"content",query:"ProcessValue",language:"Go"}` → 
`total: 0` on Node/compiled (`audit/matrix-node-raw.json`) while `language:"go"` → 2 rows; the
same for `symbolKind:"Function"`. Bun returns 2 rows for both because that path uses
`COLLATE NOCASE`. The validation layer *accepted* the uppercase value because
`describeUnknownFilters` compares case-insensitively, so the caller gets a silent empty page
for a filter the descriptor explicitly calls case-insensitive.

**Root cause:** `searchContentClassic` builds `f.language IN (?)` / `s.symbol_type = ?` with no
`COLLATE NOCASE` (the bounded path and `symbol-search.ts` both have it).

**Fix plan:** `COLLATE NOCASE` in the classic path too; regression: uppercase filter returns the
same rows as lowercase on the small fixture (node runtime).

### D6 — MEDIUM/HIGH — `file` mode claims the auto-refresh contract it does not have, and names an option it rejects

**Evidence:**

* `mode:"file"` on a stale file returns `stale:true` and a `freshness.remediation` that says
  *"reads auto-refresh this file within budget when enabled — disable with BB_NO_AUTO_REFRESH=1
  or refresh=false"* (`audit/extras-raw*.json`), while the same mode **rejects**
  `refresh:false` ("file mode does not accept: refresh") and **never calls** `maybeAutoRefresh`.
  This is the exact lie `FRESHNESS_REMEDIATION_MANUAL_ONLY` was introduced to stop for
  `bb_visualize`.
* The registry description claims every read auto-refreshes and declares an `autoRefresh`
  field; `file` mode has no `autoRefresh` key even when stale, and the auto-refresh probe shows
  only `symbols`/`content`/`symbol` refreshing (`audit/autorefresh-raw.json`: after
  `symbols` refreshed the file, `file` reported fresh — it never repaired anything itself).

**Fix plan:** choose one contract. Either (a) accept `refresh` on `file` and implement the
one-file repair + `autoRefresh` declaration, or (b) pass `{autoRefresh:false}` to
`buildStalenessEnvelope` for file mode, scope the description's auto-refresh sentence to the
three modes that have it, and drop the unscoped `refresh` wording. (b) is smaller and keeps the
read/write boundary tighter; either way the descriptor, the generated page and BB_SEARCH.md must
move together.

### D7 — MEDIUM — `symbols` mode drops the declared match-set fields the description promises

**Evidence:** every `symbols.*` row in the matrix is plain text; there is no `totalMatches`,
`truncated`, `searchMode` or `freshness` block. On `limit:1` the footer says
"showing 1 of 25 matches"; on `limit:1000` (more than exist) there is **no footer at all**, so a
complete page is indistinguishable from an unread one; on `limit:0` it says
"showing 0 of 25 matches". The registry description says *"Every response declares its match
set: totalMatches is the number of matching symbols the page was cut from"* — that field does
not exist on this mode's wire answer. `BB_SEARCH.md` claims "every response is tagged with
`searchMode`" — also false for symbols.

**Fix plan:** keep the human-readable lines but prepend/append a machine-readable declaration
(e.g. a JSON line or a structured footer with `totalMatches`, `truncated`, `staleCount`) — or
switch symbols to the same JSON envelope as the other three modes. Whichever, the description
and BB_SEARCH.md must describe the shape actually returned.

### D8 — MEDIUM — `exact` is silently ignored when `regex:true`

**Evidence:** `{query:"^handle.*", regex:true, exact:true}` returns `handleRequest` **and**
`handleResponse` — `exact` asks for whole-name matches only, the answer is a regex prefix match.
The description says an option a mode cannot honor is rejected, never silently ignored.

**Fix plan:** reject `exact` together with `regex` in validation/handler with a message naming
the conflict (or define and document `exact` as "regex must match the whole name", i.e. wrap
the pattern). Rejecting is cheaper and honest.

### D9 — MEDIUM — `content` mode writes to the index database (7 tables + 3 triggers) on a read

**Evidence:** fresh fixture, before: `[]`; after one `mode:"content"` call:
`["brain_symbol_content_fts", … "_data", "_idx", "_content", "_docsize", "_config", "_meta",
"bb_content_fts_symbol_insert", "bb_content_fts_symbol_update", "bb_content_fts_symbol_delete"]`
(`work/table-probe.ts`). Additionally `detectFts5` runs `CREATE VIRTUAL TABLE __bb_fts_probe` +
`DROP` on the first content call of every process, and the classic path's `rankWithFts5`
creates/inserts/drops an ephemeral FTS table per query. Consequence: the tool is `mutability:
read` yet takes a write transaction on the index (concurrent readers can hit locks; a
read-only index file changes behaviour), and the curated page's "Read-only. It does not
refresh the index or modify source files" is only half true. **During this audit the T2 content
measurement created that schema in the shared `.bb-data` index — disclosed to the Lead; no
repair was attempted because deleting schema from a shared index is not this owner's call.**

**Fix plan:** move the persistent FTS schema creation/rebuild to the index/maintenance path (or
gate it behind an explicit write capability), and make BOTH read paths fall back to SQL when the
marker is absent instead of creating DDL inline. Document honestly until then
("content mode may create its search index tables in the local index DB").

### D10 — MEDIUM — no `limit` ceiling; an answer can be far too big to read

`limit` accepts any non-negative integer. On this workspace index a `content` call with a large
limit returns every ranked match (the whole page slice is unbounded), and `symbols` is bounded
only by the 200 000-candidate fetch cap; `limit: 100000` on the 25-match fixture returned all 25
and there is no refusal path for "too big". `bb_analyze` refuses above a declared ceiling for
exactly this reason. **Fix plan:** declare and enforce a per-mode ceiling (e.g. 1000, or 5000
for content) with a message that names the ceiling and says the limit was refused rather than
clamped.

### D11 — MEDIUM — `symbol` mode returns a different match shape depending on how `filePath` resolves

`{symbolName:"duplicateName", filePath:"src/b.ts"}` matches via the LIKE fallback — whose SELECT
omits `language` — so the match has no `language` key while the same call without `filePath`
has `language: "typescript"`. A caller cannot rely on the field. **Fix plan:** align the two
SELECTs (engine-side; cross-scope request) or normalise in the handler.

### D12 — MEDIUM — `symbol` mode has no bound and rejects the one option that could bound it

Every duplicate declaration of a name is returned (`duplicateName` → 2, and a method name common
across a big repo returns all of them) but `limit`/`offset` are refused for the mode and
`truncated: false` is hard-coded. That is "complete but potentially enormous" rather than a
declared bound. **Fix plan:** accept `limit` (and `offset`) in `symbol` mode as a declared page
over a declared total, or declare the mode complete-by-design in the docs and cap the wire
size. This is also the mode where `truncated:false` is a promise the response cannot keep if
the array is cut elsewhere.

### D13 — MEDIUM — gates: two red, one green-that-cannot-fail, one red only under the campaign's own setup

See §7. Summary: `verify-search-honesty` red (D4); `verify-search-complete` (m15) writes
`known-gap` evidence but **exits 0** (it has no `process.exit` on failure), so `npm run verify`
passes while its own evidence says S2 failed; `verify-search-e2e`'s MCP leg is red whenever the
index lives under `BB_DATA_DIR` because the MCP SDK's `StdioClientTransport` sanitises the child
environment (HOME/PATH/SHELL/TERM/USER only), so the server reads `~/.bb` and answers "No index
found" — green only by writing the user's real data dir. **Fix plan:** pass
`env: { ...process.env }` in the gate's transport (and in any other gate spawning the real
server), add `process.exitCode`/throw on failed checks to the m15 gate, and repair D4's paths.

### D14 — MEDIUM — docs truth (full table in §4)

The registry description, the generated page, `docs/BB_SEARCH.md` and `docs/M13-TOOL-SEARCH.md`
contain claims this audit measured false: symbols-mode match-set fields; case-insensitive
content filters; content covering only name+qualified name+docstring (it is *intended* to cover
bodies and cannot); "Read-only … does not refresh the index"; auto-refresh on every read mode;
`limit`/`offset`/`refresh` acceptance per mode; `includeContent`'s "12-line cap" vs the
handler's 8-line render; the M13 page's "content … not arbitrary raw-file text" while the
engine is documented (in its own comments) to search the stored body column.

### D15 — LOW — dead code and regex debt in the search layer

* `symbol-search.ts: `unaliased()` is unused, and it is the only regex literal in that file
  (`/\bs\./g`) — deleting the dead function removes a regex use and the m15 S2 false failure.
* `content-search.ts`: `rankWithLike()` is unused (its docstring says it is the named ordering
  rule; it is not called).
* `content-search.ts` `firstLine`/`QUESTION_FRAME_WORDS` are used; `BODY_MATCH_WEIGHT` only by
  the dead-path scorer.
* `handler.ts` imports the whole shared tool surface (bb_analyze/bb_edit/bb_health imports that
  only the monolith needed); the split left them unused. Clean when editing the file.

### D16 — INFO/perf — content mode's per-query cost is O(corpus) on the product runtime

Because D1's giant guard never fires on Node, `searchContentClassic` loads every symbol row per
query (310 423 here). Measured T2: content p50 2.26 s / p95 3.31 s in round 1 and
p50 4.75 s / p95 8.82 s in round 2 (same query, machine under load from concurrent gate runs) —
**round 2 breaches the charter's 5 s read budget**. The fix is D1 (make the giant guard work),
not a micro-optimisation.

### D17 — LOW — `content`'s `staleCount`/`freshCount` are page-local next to a match-set `total`

`staleCount` counts stale rows **on the returned page**, while `total` is the whole match set.
The names sit adjacent and read as if they describe the same set. Rename (`pageStaleCount`) or
document.

### D18 — LOW — `symbol` mode for a missing symbol is an undocumented empty success

`{mode:"symbol", symbolName:"zzzNoSuch"}` → `{matches:[], totalMatches:0, truncated:false,
freshness:{…}}` with `isError:false`. Defensible (declared absence) but the docs' "Errors:
Missing mode-specific query…" should say so, or the envelope should carry `found:false`.

---

## 4. Docs drift (claim → measured reality)

| source | claim | measured |
|---|---|---|
| registry description + generated page (line 3) | "Every response declares its match set: totalMatches is …" | `symbols` mode has no `totalMatches`/`truncated` field (D7) |
| registry description + generated page | "Content mode also declares … matchMode … bodyCoverage" | absent entirely on Bun; present on Node only because the bounded path cannot run; `bodyCoverage.withBody` says 0 of 41 though 38 have bodies (D1) |
| registry description + generated page | "language and symbolKind are matched case-insensitively" | true in symbols; **false** in content on Node (D5) |
| registry description + generated page | "When a read finds stale/missing files within budget, the handler auto-refreshes … and declares it in an autoRefresh field" | true for symbols/content/symbol; **false for file** (D6) |
| registry description + generated page | "Options a mode cannot honor are rejected" | false for `exact`+`regex` (D8) |
| descriptor `limit` description | "symbols/content/symbol modes only" | symbol refuses `limit` |
| descriptor `offset` description | no mode scope | symbol/file refuse it |
| descriptor `refresh` description | no mode scope; auto-refresh default | file refuses it and never auto-refreshes |
| descriptor `query` description | "symbol/content/regex query" | `regex` is not a mode; it is a `symbols` option |
| generated page `## Safety` | "Read-only. It does not refresh the index or modify source files." | auto-refresh reindexes stale files by default; content mode creates FTS schema in the index DB (D9); the description two lines above says it *does* refresh |
| generated page `## Errors` | "Invalid regular expression" | true at engine level; on Node+tsx source runs the worker flake can instead return an empty bounded "no results" for a **valid** pattern (D2) |
| `docs/BB_SEARCH.md` | "Every response is tagged with `searchMode`" | false for `symbols` (text) |
| `docs/BB_SEARCH.md` | content searches "name + qualified name + docstring"; "the brain does not store raw file source … not full-text file contents" | the engine stores and intends to search a bounded symbol body (`source_text`, 38/41 here); the classic path silently doesn't; the M13 honesty gate asserts the *stale* sentence |
| `docs/BB_SEARCH.md` | "An invalid pattern raises `InvalidRegexError`" | true through MCP (`isError` + named message); CLI compiled path wraps it too |
| `docs/BB_SEARCH.md` | `includeContent` "(`line_start..line_end`, 12-line cap)" | engine cap is 12 lines, handler re-slices to **8** |
| `docs/BB_SEARCH.md` | `staleCount`, `freshCount` "(symbols/regex modes)" | both appear in content too (page-local) |
| `docs/BB_SEARCH.md` | `truncated` "(regex mode…)" | also content/symbols |
| `docs/BB_SEARCH.md` parameters table | missing `refresh` entirely | accepted by three modes |
| `docs/M13-TOOL-SEARCH.md` | "Content mode searches … not arbitrary raw-file text" | body column is searched by design on the bounded path (and the intent is to on both) |
| `docs/M13-TOOL-SEARCH.md` | "project-root traversal rejection" verified | true (symlink + `../` both refused) |
| `docs/M13-TOOL-SEARCH.md` | points at `validation/m13/results/search.json` | that file does not exist; evidence is `s1..s4.json` |
| docs generator | page is byte-fresh per the docs gate | true — but the gate validates *freshness of the page*, not the truth of its claims (D14) |

---

## 5. Regex inventory (charter §7)

Policy gate: `npx tsx script/tools/verify-regex-policy.ts` → **PASS**, 112 frozen-debt rows,
0 allowlisted, 0 new. The baseline (frozen at commit `1c3ad41`) attributes these rows to this
tool's scope:

| file:line | kind | source | needed? | status |
|---|---|---|---|---|
| `src/intelligence/search/symbol-search.ts:69` | literal | `/[^\x00-\x7F]/` | yes — Unicode-vs-ASCII fold decision; no string op decides "contains non-ASCII" as cheaply/precisely | baseline debt (keep; written justification + tests in Phase B or replace with a charCode loop) |
| `src/intelligence/search/symbol-search.ts:369` | literal | `/\bs\./g` | **no** — `unaliased()` is dead code (D15) | **delete in Phase B** (pays debt) |
| `src/intelligence/search/content-search.ts:283` | literal | `/\s+/` (rankWithFts5 term split) | yes in the classic path, but that path is only reachable when D1 is fixed... | keep with justification or replace with `split(" ").filter` for exact parity |
| `src/intelligence/search/content-search.ts:737` | literal | `/\s/` (isSingleToken) | replaceable by a char scan | Phase B: replace (pays debt) |
| `src/intelligence/search/regex-search.ts:63` (`compileRegex`) | constructor | `<dynamic>` (user pattern) | **yes — the documented exception** | needs allowlist row + edge-case test file |
| `src/intelligence/search/regex-scan-worker.ts:62` (`matchNames`) | constructor | `<dynamic>` (user pattern) | **yes — same feature, worker copy** | needs allowlist row + edge-case test file |
| `script/m15/verify-search-complete.ts:83,95,251` | literal (in the gate itself) | op-pattern census, classifier signs, auto-pass regex | gate's own AST-ish text scan; SCAN_DIRS excludes `script/` | not counted by the policy gate; leave or convert to string ops |

Phase B: add `validation/tools/bb_search/work/regex-edge-tests.ts` (or a `test/` file) covering
empty input, no-match/boundary match, Unicode (multi-byte and astral), multiline,
anchors/quantifiers actually used, user-input escaping (`%`, `_`, `\`), a long input proving no
catastrophic backtracking under a time-box, invalid patterns producing a named error, and the
`exact`+`regex` conflict; then request two allowlist rows from the Lead (shared file, not this
owner's scope) pointing at that test file.

No regex is used for source parsing anywhere in this tool's scope: symbols and content are SQL
over indexed AST facts; the regex option is a user-pattern name scan (charter §7.3). The m15 S2
self-check currently *fails* because `symbol-search.ts` gained the dead `unaliased` regex — the
Phase B deletion flips it red→green for a true reason.

---

## 6. Latency (full detail in `LATENCY.json`)

Subject: compiled artifact (`node bin/bb mcp --dir`, Node v22.22.1 / better-sqlite3), warm, 5
runs per call, one discarded warm call, `BB_NO_AUTO_REFRESH=1`.

| tier | call | p50 | p95 | budget | verdict |
|---|---|---|---|---|---|
| T0 (polyglot) | symbols default | 19.2 ms | 29.1 ms | <250 ms | pass |
| T0 | content default | 49.1 ms | 80.8 ms | <250 ms | pass |
| T0 | symbol default | 61.0 ms | 96.2 ms | <250 ms | pass (returns 0 rows — D3) |
| T0 | file default | 33.0 ms | 67.6 ms | <250 ms | pass |
| T0 | regex option | 2059.5 ms | 2080.1 ms | n/a (not default) | bounded cut (D2) |
| T1 (n100) | symbols default | 41.2 ms | 43.0 ms | <1 s | pass |
| T1 | content default | 90.7 ms | 128.8 ms | <1 s | pass |
| T1 | symbol default | 20.9 ms | 23.9 ms | <1 s | pass |
| T1 | file default | 10.5 ms | 14.0 ms | <1 s | pass |
| T1 | regex option | 2086.5 ms | 2120.9 ms | n/a | bounded cut (D2) |
| T2 (workspace, 6 452 files / 310 423 symbols) | symbols (named) | 1809.0 ms | 3573.4 ms | <5 s | pass |
| T2 | symbols (broad) | 1817.6 ms | 1989.6 ms | <5 s | pass |
| T2 | content default (round 2) | 4754.6 ms | **8824.5 ms** | <5 s | **FAIL** |
| T2 | content default (round 1) | 2259.0 ms | 3313.6 ms | <5 s | pass (same query; tail is load-dependent) |
| T2 | symbol default | 20.8 ms | 29.2 ms | <5 s | pass |
| T2 | file default | 31.1 ms | 37.7 ms | <5 s | pass |
| T2 | regex option | 2174.8 ms | 2620.1 ms | n/a | declared cut scan (scan-cap), not a match set |

Charter appendix A says the reference index is 11 440 files / 1 283 638 symbols / ~3.4 GB; the
index in `.bb-data` today is **6 452 files / 310 423 symbols / 3.6 GB** (it predates the split and
the source tree changed), so these are the load numbers for this audit.

---

## 7. Gates inventory (all run from this working tree)

Harness note: the m13 harness writes `validation/m13/results/<code>.json`; running a gate
unmodified would overwrite **shared evidence** during a read-only audit. A preload shim
(`work/harness-redirect.ts`) redirects only the harness output path into
`validation/tools/bb_search/gates/evidence/`; the gate logic is executed unchanged. The m15 gate
writes with bare `writeFileSync`, so it was run from a shadow cwd
(`validation/tools/bb_search/gates/m15run/`) whose `src/` and `docs/` symlink to this tree — its
real evidence files remain untouched. Every shared evidence file's mtime was checked before/after
(`validation/m13/results/s1.json` still `Oct 2 01:14`).

| gate | command | exit | result | evidence |
|---|---|---|---|---|
| S1 modes | `BB_DATA_DIR=$PWD/validation/tools/bb_search/bbdata BB_NO_AUTO_REFRESH=1 bun --preload ./validation/tools/bb_search/work/harness-redirect.ts ./script/verify-search-modes.ts` | 0 | VERIFIED 30/30, 3 negatives | `audit/gate-modes.log`, `gates/evidence/m13/s1.json` |
| S2 e2e | `HOME=$PWD/validation/tools/bb_search/work/home BB_NO_AUTO_REFRESH=1 bun --preload ./validation/tools/bb_search/work/harness-redirect.ts ./script/m13/verify-search-e2e.ts` | 0 | VERIFIED 18/18, 10 negatives | `audit/gate-e2e-home.log` |
| S2 e2e under the charter's `BB_DATA_DIR` | `BB_DATA_DIR=$PWD/validation/tools/bb_search/bbdata BB_NO_AUTO_REFRESH=1 bun --preload ./work/harness-redirect.ts ./script/m13/verify-search-e2e.ts` | **1** | KNOWN-GAP 12/18 — MCP leg answers "No index found" (SDK env sanitisation, D13) | `audit/gate-e2e.log` |
| S3 corpus | `BB_DATA_DIR=$PWD/validation/tools/bb_search/bbdata BB_NO_AUTO_REFRESH=1 BB_CORPUS_ROOT=/home/ishaq2321/bb_tests/repositories bun --preload ./work/harness-redirect.ts ./script/m13/verify-search-corpus.ts` | **1** | KNOWN-GAP 20/24; 4 freshness probes blocked (below) | `audit/gate-corpus.log` |
| S4 honesty | same pattern with `./script/m13/verify-search-honesty.ts` | **1** | KNOWN-GAP 13/16, 3 fails (D4) | `audit/gate-honesty.log` |
| S5 docs | same pattern with `./script/m13/verify-search-docs.ts` | 0 | VERIFIED 24/24, 2 negatives | `audit/gate-docs.log` |
| m15 complete | `cd validation/tools/bb_search/gates/m15run && BB_DATA_DIR=… BB_NO_AUTO_REFRESH=1 BB_CORPUS_ROOT=… bun $PWD/script/m15/verify-search-complete.ts` | **0** (but evidence KNOWN-GAP) | S1 ok, **S2 2 fails** (`symbol-search` now has a regex op, content op-count changed), **S7 7/6** (counts inconsistent and depends on s2.json), rest verified | `audit/gate-m15.log`, `gates/m15run/validation/m15/results/` |
| m35 envelope | `HOME=$PWD/validation/tools/bb_search/work/home2 BB_NO_AUTO_REFRESH=1 npx tsx script/m35/verify-envelope-contract.ts` | 0 | PASS 37/37, 8 negatives (covers bb_search symbol/content/file blocks) | `audit/gate-envelope.log` |
| regex policy | `npx tsx script/tools/verify-regex-policy.ts` | 0 | PASS — 112 frozen debt, 0 new, 0 stale rows | `validation/tools/regex-policy.json` (shared, regenerated by the gate in verify mode — content unchanged from the Lead's run) |
| docs generator (verify) | run by the docs gate | 0 | `docs/tools/bb_search.md` byte-fresh | in `audit/gate-docs.log` |
| typecheck | `npx tsc --noEmit` | **0** | clean baseline before Phase B (`tsc-exit=0`) | `audit/tsc.log` |

**m15 cannot fail:** `verify-search-complete.ts` writes `known-gap` evidence and still exits 0
(no `process.exit` on failure; only a fatal setup error exits 2), so `npm run verify` reports
success while the evidence says the gate failed. That is a "green run over a gate that cannot go
red" (charter §4.4) and is a Phase B fix in this owner's scope.

### Blocked legs (declared, with the exact failing command)

1. **S3 corpus freshness probes — EROFS (environment, not product).**
   `raw.prepare(...)` is fine; the gate writes a probe line into the real corpus file and
   restores it: `writeFileSync → EROFS: read-only file system, open
   '/home/ishaq2321/bb_tests/repositories/rake/lib/rake/application.rb'`.
   The corpus is present (`BB_CORPUS_ROOT=/home/ishaq2321/bb_tests/repositories`), all
   indexing/search/pagination checks passed for rake, graphql-js, rebar3, go-tools; the four
   freshness checks are blocked because this session's write scope is the workspace, so
   `/home/ishaq2321/bb_tests/**` is read-only. Status: **blocked**, not green.
2. **S2 e2e MCP leg under `BB_DATA_DIR` — environment/tooling (D13).** Command in the table
   above; server answers `No index found for <fixture>` because
   `@modelcontextprotocol/sdk`'s `StdioClientTransport` inherits only
   `HOME/LOGNAME/PATH/SHELL/TERM/USER`. Green only with an isolated `HOME` and the default data
   dir — i.e. the gate cannot run under charter ground rule 5 without a one-line fix in the gate.
3. **T2 content measurement side effect (disclosed).** Measuring `mode:"content"` against
   `.bb-data` caused the tool's own read path to create its FTS schema in the shared index
   (D9). Further T2 content reads were stopped; no repair was attempted.

---

## 8. Authorship / banned comments

Headers (§8): present on `descriptor.ts`, `handler.ts`, `docs/tools/bb_search.md`,
`script/tool-docs/curation/bb_search.ts`. **Missing** on the four engines
(`symbol-search.ts`, `content-search.ts`, `regex-search.ts`, `regex-scan-worker.ts`), the six
gate scripts, and `docs/BB_SEARCH.md` — Phase B adds them.

Banned process-attribution narrative (charter §9) present in this tool's files:

* `handler.ts` — 9 comments: `M28.T1 (issue #624)`, `M48.P1 (#696)`, `M55.T5 / §15.1`,
  `M40.A7 negative-case fix`, `M48.C1 (#699) corpus catch`, `M40.A7`, `M35.E1` ×3,
  `M43.A1 (#657)` ×2.
* `symbol-search.ts` — `M19.Q1 measured…`; `content-search.ts` — `M19.Q1` ×2 (and "measured"
  facts that belong as plain facts); `regex-search.ts`/`regex-scan-worker.ts` — "Measured…"
  process narration is mostly plain technical facts and can stay as such, but "an earlier
  version of this comment claimed… retracted" is authoring history → rewrite as the current
  technical reason.
* gate scripts — every header is a milestone narrative (`M13.19 (S2)`, `M15.S1-S8`, …) and
  `issue:` payload fields; the harness schema needs an `issue` identity, so keep the field but
  rewrite the prose comments in the author's voice. `verify-search-modes.ts` has
  "M40.A7 contract" narration.
* `docs/BB_SEARCH.md` has a milestone section title ("M13") and no §8 markdown header;
  `docs/M13-TOOL-SEARCH.md` is out of this owner's write scope (Lead to decide), but its claims
  are in §4.

No "Generated with"/co-author markers were found in this tool's scope.

---

## 9. Phase B plan (after "split landed" — received)

Ordered by risk, all inside the task's write scope unless marked cross-scope:

1. **D1** content-search: `row != null` guards; classic SELECT carries `source_text`; one
   match/curation rule for `bodyCoverage`/`matchMode`/`termMatch`; regression × both runtimes.
2. **D2** regex worker: deadline starts on `online`; error path runs the inline matcher within
   the remaining budget; 10×-warm determinism test.
3. **D3** symbol-mode noise filter on relative paths; handler-side normalisation + cross-scope
   request for `findSymbol` (engine.ts) if the handler cannot derive the relative path safely.
4. **D5** `COLLATE NOCASE` in the classic path.
5. **D6** file-mode freshness contract: manual-only remediation + description fix (and drop the
   unscoped `refresh` wording); no new write path.
6. **D7** symbols-mode machine-readable match-set declaration; update description + BB_SEARCH.
7. **D8** refuse `exact`+`regex`; **D10** declared per-mode `limit` ceiling; **D11/D12** symbol
   mode shape/bound (handler-side where possible).
8. **D9** stop creating FTS schema on the read path (SQL fallback when marker absent; leave the
   persistent index to maintenance), and document the truth until then.
9. **D4/D13** repair the three gates: honesty → new module paths + envelope assertion; e2e →
   forward the child env; m15 → fail the process on failed checks and fix its S2 text checks;
   corpus freshness leg stays **declared blocked** (EROFS) with the exact command recorded.
10. **Docs** descriptor + curation + BB_SEARCH rewrite from the measured matrix; regenerate the
    page with `npx tsx script/verify-tool-docs.ts --only bb_search --write`.
11. **Authorship** §8 headers on engines/gates/BB_SEARCH; remove the banned comments listed in §8.
12. **Regex** delete dead `unaliased`; replace `/\s/`; write the edge-case test file; ask the
    Lead for the two `new RegExp` allowlist rows (shared file, not this owner's scope).
13. **Evidence** `validation/tools/bb_search/REPORT.json` (gate table, negative cases, latency
    before/after) and re-run every gate including the planted-mutant red proof.

Cross-scope requests to the Lead (message sent separately): `src/ast/engine.ts#findSymbol`
relative-path return / language in the LIKE-fallback SELECT; `validation/tools/regex-allowlist.json`
two rows; and notice that `docs/M13-TOOL-SEARCH.md` claims need the Lead's edit.

## 10. Unknowns / not measured

* T2 content measurement was not repeated after the shared-index side effect was discovered;
  the 8.8 s p95 is a measured round, not a controlled benchmark.
* `content` memory high-water on T2 was not instrumented (only wall clock).
* Corpus freshness truthfulness remains **blocked** (EROFS) and is reported only through its
  static code path here; the S3 gate's indexing/search legs did pass on four real repos.
* Whether the worker-startup flake (D2) is also present in `bun`-compiled builds was not tested
  (the shipped artifact is Node; Bun source always cut in this audit).
* The `.bb-data` FTS schema created during measurement is left in place (see §7.3); its effect
  on other tools' reads was not assumed either way.
