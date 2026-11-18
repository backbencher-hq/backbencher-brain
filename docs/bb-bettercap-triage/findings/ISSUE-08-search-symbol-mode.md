# ISSUE-08 — `bb_search` mode `symbol`: metadata-only (no source) + inconsistent `fileId` shape + overclaiming surfaces

Lane: retrieval. Date: 2026-11-18. Product: bb 0.1.6, HEAD `be4c0ef25d9856b4ab09f448fec9e95ea2007c88`
(subject `Release 0.1.6: five analyzers, one graph`), CLI `node bin/bb`. Specimen: bettercap,
projectId `4c7590f1cba319aac298a50453c0ec440f2dc857`; workspace project `1d3d5710…` for
cross-project/language generality. Read-only.

## Verdict

**REAL-BUT-MISDESCRIBED.** The behaviour reproduces (symbol mode returns metadata only, no
source/body), and the `fileId` inconsistency is real, but the report's stated comparison target is
wrong: `mode:"symbols"` emits **text lines and has no `fileId` field at all**; the
`<projectId>:<relativePath>` `fileId` shape is emitted by **`content` and `file`** modes. The genuine
inconsistency is `symbol` (absolute machine path) vs `content`/`file` (`projectId:path`). The "skill
claims exact source" claim is REAL on the agent-facing surfaces (tool descriptor first line,
generated onboarding/disambiguation text, MCP guide) while the detailed reference (`docs/BB_SEARCH.md`)
and the implementation say metadata-only — i.e. the documentation set contradicts itself, not (only)
the code.

| # | Report sub-claim | Adjudication | What was measured |
|---|---|---|---|
| a | `mode=symbol` returns metadata only, no source | **REAL** | `matches[]` = `id, fileId, name, symbolType, lineStart, byteStart, byteEnd, language, relativePath, stale`; no body/source/snippet. The `byteStart/byteEnd` span is present but the bytes are never read. `includeContent:true` is **refused** in symbol mode (`symbol mode does not accept: includeContent — accepted for symbol: mode, query, symbolName, filePath, limit, offset, refresh`), so there is no one-call way to get the exact symbol's source. |
| b | `fileId` is absolute here vs `projectId:path` in `symbols` mode | **PARTLY FALSE / REAL against different modes** | `mode:"symbols"` is text (`name [kind] file:line (language)` + `[match-set] …`) and has no `fileId`. `content` and `file` modes emit `fileId:"<projectId>:<relativePath>"`. `symbol` mode emits `fileId:"/home/ishaq2321/bettercap/session/session.go"` (absolute) *and* `relativePath` in the same row. So the same field name means **absolute filesystem path** in one mode and **indexed file-row id** in the other two. |
| c | "the skill still claims exact source" | **REAL** | `src/mcp/tools/bb_search/descriptor.ts:16` (and its generated copies `docs/tools/bb_search.md:10`, `docs/data/public-tools.json:11`) opens: *"Unified indexed retrieval for symbol lists, content, exact symbol source, or files."* The same string later says symbol mode returns "the exact indexed symbol record(s) with byte bounds" — internal contradiction. `src/cli/onboard.ts:55` (rendered as the `bb:onboard` skill table in `AGENTS.md:9`): *"Find a symbol, its exact source, or a file — exact/lexical lookup."* `docs/MCP_CLI_INDEXER_GUIDE.md:321-322`: *"Retrieves indexed names/content/exact source or file results. … Use `query` for lexical retrieval, `symbolName` for exact source"*. |
| d | (implicit) detailed contract agrees with the behaviour | **TRUE** | `docs/BB_SEARCH.md:17-19` says symbol/content/symbols query the indexed tables and "file mode is the deliberate source-retrieval exception"; `docs/BB_SEARCH.md:93-97` and `docs/tools/bb_search.md:94` both document symbol mode as the metadata record only. So the surfaces disagree with each other; code matches the detailed reference. |

Severity: **medium**. Why it matters: an agent that reads the descriptor/skill picks `bb_search`
`mode:"symbol"` expecting exact source and gets no code; it must then issue a second call (file mode
returns the **whole** file up to 100k chars, `content`/`symbols+includeContent` return a snippet but
only via name search). The absolute `fileId` is a machine path in a field that other modes use for a
portable `projectId:path` id, so consumers joining modes or caching by `fileId` see two different
namespaces for the same file. Absolute paths in the payload also differ from the deterministic-ID
convention used elsewhere ("never contain a machine path", `docs/BB_DOC.md:112`).

## Reproduce

```bash
cd /home/ishaq2321/mcp/backbencher-brain
B=/home/ishaq2321/bettercap
# 1) symbol mode: metadata only, absolute fileId
node bin/bb tool bb_search --dir $B --args '{"mode":"symbol","query":"Session"}' \
  > docs/bb-bettercap-triage/evidence/retrieval/08-search-symbol-Session.json
# 2) symbols mode: text, no fileId; includeContent gives snippets
node bin/bb tool bb_search --dir $B --args '{"mode":"symbols","query":"Session"}' \
  > docs/bb-bettercap-triage/evidence/retrieval/08-search-symbols-Session.txt
node bin/bb tool bb_search --dir $B --args '{"mode":"symbols","query":"Session","includeContent":true,"limit":3}' \
  > docs/bb-bettercap-triage/evidence/retrieval/08-search-symbols-Session-includeContent.txt
# 3) sibling modes for the same project: fileId = projectId:path
node bin/bb tool bb_search --dir $B --args '{"mode":"content","query":"Session","limit":3}' \
  > docs/bb-bettercap-triage/evidence/retrieval/08-search-content-Session.json
node bin/bb tool bb_search --dir $B --args '{"mode":"file","filePath":"session/session.go"}' \
  > docs/bb-bettercap-triage/evidence/retrieval/08-search-file-session-go.json
# 4) symbol mode refuses source-bearing options (no workaround inside the mode)
node bin/bb tool bb_search --dir $B --args '{"mode":"symbol","query":"Session","includeContent":true}' \
  > docs/bb-bettercap-triage/evidence/retrieval/08-search-symbol-Session-includeContent.json
# 5) the only in-mode disambiguator is filePath (works, but the report's mode did not use it)
node bin/bb tool bb_search --dir $B --args '{"mode":"symbol","query":"Session","filePath":"session/session.go"}' \
  > docs/bb-bettercap-triage/evidence/retrieval/08-search-symbol-Session-filePath.json
# 6) generality: workspace project, JS symbol
W=/home/ishaq2321/mcp/backbencher-brain
node bin/bb tool bb_search --dir $W --args '{"mode":"symbol","query":"Cancel","limit":4}' \
  > docs/bb-bettercap-triage/evidence/retrieval/08-generality-workspace-symbol-Cancel.json
node bin/bb tool bb_search --dir $W --args '{"mode":"content","query":"Cancel","limit":2}' \
  > docs/bb-bettercap-triage/evidence/retrieval/08-generality-workspace-content-Cancel.json
node bin/bb tool bb_search --dir $W --args '{"mode":"file","filePath":".corpus/axios/index.js"}' \
  > docs/bb-bettercap-triage/evidence/retrieval/08-generality-workspace-file-axios-index.json
```

## Bounded observed output

`mode:"symbol"`, `query:"Session"` (bettercap; full JSON 2,227 bytes):

```json
{"id":"4c7590f1cba319aac298a50453c0ec440f2dc857:modules/c2/c2.go:Session:46",
 "fileId":"/home/ishaq2321/bettercap/modules/c2/c2.go","name":"Session","symbolType":"property",
 "lineStart":46,"byteStart":902,"byteEnd":909,"language":"go","relativePath":"modules/c2/c2.go","stale":false}
```
5 matches total (4 `property`, 1 `struct`); no `body`/`source`/`snippet` key on any match;
`found:true,totalMatches:5,returned:5,truncated:false`. (Note: `id` uses `projectId:relativePath:name:line`;
`fileId` is the absolute path; `relativePath` is present too.)

`mode:"symbols"`, `query:"Session"` (text, 1,062 bytes):

```
Session [property] modules/c2/c2.go:46 (go)
...
showing 15 of 139 matches
[match-set] searchMode=symbols totalMatches=139 returned=15 truncated=false staleCount=0
```

`mode:"symbols"`, `includeContent:true` (1,711 bytes) — source IS available in the sibling mode:

```
sessionRoute [method] modules/api_rest/api_rest_controller.go:320 (go)
    func (mod *RestAPI) sessionRoute(w http.ResponseWriter, r *http.Request) {
```

`mode:"content"`, `query:"Session"` — `fileId` differs from symbol mode:

```json
{"file":"modules/arp_spoof/arp_spoof_test.go",
 "fileId":"4c7590f1cba319aac298a50453c0ec440f2dc857:modules/arp_spoof/arp_spoof_test.go",
 "line":110,"symbolName":"Session","symbolType":"property"}
```

`mode:"file"`, `filePath:"session/session.go"` — same `projectId:path` shape, plus the source:

```json
{"searchMode":"file","file":"session/session.go",
 "fileId":"4c7590f1cba319aac298a50453c0ec440f2dc857:session/session.go",
 "language":"go","content":"package session\n\nimport (…","contentLength":…}
```

`mode:"symbol"` + `includeContent:true` — refused with a named error (exit code 1), so the mode
cannot return source at all:

```
error: bb_search symbol mode does not accept: includeContent — accepted for symbol: mode, query, symbolName, filePath, limit, offset, refresh
```

Disambiguation via `filePath` does work inside symbol mode (`1 match`, `symbolType:"struct"`,
`session/session.go:72`), which is the documented workaround.

## Expected vs observed

- Expected: the tool descriptor's opening promise ("content, exact symbol source, or files") maps to
  a mode that returns source; the onboarding skill says bb_search finds "a symbol, its exact source,
  or a file"; the MCP guide says "`symbolName` for exact source".
- Observed: `mode:"symbol"` returns a metadata record only; only `mode:"file"` returns source (whole
  file) and only `mode:"symbols"+includeContent`/`mode:"content"` return snippets. The detailed
  reference accurately documents metadata-only, so the claim set is internally inconsistent.
- Expected: one `fileId` convention per tool. Observed: `symbol` = absolute filesystem path;
  `content`/`file` = `<projectId>:<relativePath>` (the indexed file-row id). `symbols` mode has no
  `fileId` at all. The same physical file therefore has two `fileId` identities depending on mode.

## Root cause (file:line + quoted code)

1. **No source in symbol mode** — the handler forwards to `ASTEngine.findSymbol`, whose projection has
   no body/content column; `byteStart/byteEnd` are returned but never sliced:

   `src/mcp/tools/bb_search/handler.ts:200` (`if (mode === "symbol")`), `:218`
   (`await ASTEngine.findSymbol(...)`); `src/ast/engine.ts:2821-2840` projection:

   ```ts
   type SymbolRow = { id: string; fileId: string; name: string; symbolType: string;
     lineStart: number | null; byteStart: number | null; byteEnd: number | null;
     language: string | null; relativePath: string }
   ...
   fileId: BrainFileTable.path,          // ← absolute path, not brain_file.id
   ...
   relativePath: BrainFileTable.relative_path,
   ```

   `includeContent` is a symbols-mode-only option in the descriptor schema
   (`src/mcp/tools/bb_search/descriptor.ts`, option description "include a code snippet per result
   (default false). symbols mode only"), and the symbol branch's option-scope guard rejects it
   (`error: bb_search symbol mode does not accept: includeContent …`).

2. **`fileId` inconsistency** — symbol mode projects the file's absolute `path` into the field named
   `fileId` (`engine.ts:2836`). The sibling modes project the indexed file id:
   `src/mcp/tools/bb_search/handler.ts:104` `fileId: row.id` (file mode; `brain_file.id` is
   `<projectId>:<relativePath>`), and content mode's rows carry `fileId` from
   `brain_symbol.file_id` (`src/intelligence/search/content-search.ts:329/707`), which is the same
   `brain_file.id`. The contract text is under-specified: `docs/BB_SEARCH.md:93` says symbol mode's
   `fileId` is "the indexed file path", while `docs/BB_SEARCH.md:99-102` calls `file` mode's `fileId`
   "indexed `fileId`" — two different things under one name. `src/ast/engine.ts:2829-2831` even
   documents the hazard: *"The project-relative path. Noise rules are relative-path rules; the
   absolute `fileId` must not be used for them"*.

3. **Overclaiming surfaces** — same tool, three different claims:
   - `src/mcp/tools/bb_search/descriptor.ts:16`: `"Unified indexed retrieval for symbol lists,
     content, exact symbol source, or files."` → regenerated into `docs/tools/bb_search.md:10` and
     `docs/data/public-tools.json:11`; this single string both promises "exact symbol source"
     (opening) and describes symbol mode as "the exact indexed symbol record(s) with byte bounds"
     (later).
   - `src/cli/onboard.ts:55`: `bb_search: "Find a symbol, its exact source, or a file — exact/lexical
     lookup."` → rendered as the skill/onboarding table (`AGENTS.md:9` today).
   - `docs/MCP_CLI_INDEXER_GUIDE.md:321-322`: `"Retrieves indexed names/content/exact source or file
     results. … Use \`query\` for lexical retrieval, \`symbolName\` for exact source, …"`.
   - Truthful counterparts: `docs/BB_SEARCH.md:17-19` (file mode is the source-retrieval exception),
     `docs/BB_SEARCH.md:93-97`, `docs/tools/bb_search.md:94`.

   So the defect is: the mode that is denominated "exact symbol" does not return any source, while
   the surfaces that advertise "exact source" do not say which mode provides it. Note the intended
   reading may have been "exact source" = `symbolName` + `filePath` (exact lookup by name), but
   `mode:"symbol"` returns no source bytes, so the phrase is false for the mode it points at.

## Generality table

| language | project (index) | repro | same class? | evidence |
|---|---|---|---|---|
| Go | bettercap `4c7590f1…` | symbol mode: `fileId:"/home/ishaq2321/bettercap/session/session.go"`, no source; content/file: `fileId:"4c7590f1…:session/session.go"` + source | **YES** | `evidence/retrieval/08-search-symbol-Session.json`, `08-search-content-Session.json`, `08-search-file-session-go.json` |
| Go | bettercap | `symbols` + `includeContent` returns code snippet (source available in sibling mode, not symbol mode) | YES (contract split) | `08-search-symbols-Session-includeContent.txt`, `08-search-symbols-Session.txt` |
| Go | bettercap | `includeContent` on symbol mode refused by name | YES (no in-mode source path) | `08-search-symbol-Session-includeContent.json` |
| JavaScript | workspace `1d3d5710…` (`.corpus/axios`) | symbol mode `Cancel`: `fileId:"/home/ishaq2321/mcp/backbencher-brain/.corpus/axios/index.js"`, no source; content mode: `fileId:"1d3d5710…:.corpus/axios/tests/browser/cancel.browser.test.js"`; file mode: `fileId:"1d3d5710…:.corpus/axios/index.js"` + `content` | **YES** (language-independent) | `08-generality-workspace-symbol-Cancel.json`, `08-generality-workspace-content-Cancel.json`, `08-generality-workspace-file-axios-index.json` |
| TypeScript/JSON | workspace `1d3d5710…` | same projection path (`BrainFileTable.path`) — no language-aware branch in the projection | inferred YES (same single code path; `07-generality-workspace-symbol-Session.json` shows the same row shape) | `07-generality-workspace-symbol-Session.json` |

The projection is a single language-agnostic Drizzle/SQL select (`engine.ts:2836`), so the shape and
absence of source are not Go-specific.

Environment note (not part of the verdict): the session's **workspace-bound MCP server** failed all
reads during this lane with `Cannot find module '…/dist/database-HE6EE3VA.js'` (stale chunk names
after a `dist/` rebuild, server started against the previous build) — probes were therefore run
through the CLI (`node bin/bb … --dir <project>`), which uses the current build and behaves
identically. Owned lock: none; no probes were run concurrently.

## Fix sketch

Option A (prefer, matches the descriptor promise): **return bounded source in symbol mode.**
The row already carries `byteStart`/`byteEnd` and the absolute path; slice the on-disk bytes for each
match (the same read `findSymbol` already does for byte-offset repair) behind a declared bound
(e.g. max 12 lines / 4 KiB per match) and always mark `sourceTruncated`. Reuse
`symbols`-mode's `includeContent` semantics, but make it default-on for the exact mode (it is "the
exact symbol" — a record without its source is not what the descriptor sells), or add an explicit
`includeSource` option refused by modes that cannot honour it.

Option B (if source is intentionally out of scope for symbol mode): **make every surface say so.**
In `descriptor.ts` first sentence replace "content, exact symbol source, or files" with
"symbol records, content, files"; in `src/cli/onboard.ts:55` change to "Find a symbol's record, its
context, or a file"; in `docs/MCP_CLI_INDEXER_GUIDE.md:321-322` say "`symbolName` for the exact
symbol record (use `mode:"file"` for source)". Add the same sentence to the mode table.

Either way: **unify `fileId`.** Emit `fileId = brain_file.id` (`<projectId>:<relativePath>`) in symbol
mode like `content`/`file`, and keep the absolute filesystem path in a distinct field (e.g.
`absolutePath`, or drop it — `relativePath` + project root suffice) so no machine path leaks into a
field other modes use as a portable id. Document `symbols` mode's absence of `fileId` explicitly
(text mode).

## Gate proposal

- **Mode-field matrix gate** (`script/verify-tool-docs.ts` + `script/m13/verify-search-modes.ts`):
  for each mode, execute a fixture query and assert the emitted keys equal the documented keys; assert
  the word "source"/"content" appears in the descriptor only for modes that actually emit a source
  field. This gate would have caught the descriptor's "exact symbol source" promise.
- **Identity gate**: assert every mode's `fileId` for the same file is byte-identical
  (`<projectId>:<relativePath>`); a fixture project with one file reachable from all four modes makes
  the mismatch red immediately. Also assert no `fileId` matches `/^\//` (absolute path) for any mode.
- **Onboarding gate**: extend `script/verify-tool-docs.ts --only bb_search` to check the
  `TASK_DISAMBIGUATION` table in `src/cli/onboard.ts` against the descriptor's mode matrix (the
  existing docs generator already renders both; the contradiction was not checked).
- **Option-scope gate**: keep the (currently correct) refusal of `includeContent`/`language` in symbol
  mode green — if Option A adds source support, update the schema and this gate together so the
  allowed-options matrix cannot drift from the handler guard.

## Evidence paths

- `docs/bb-bettercap-triage/evidence/retrieval/08-search-symbol-Session.json` (metadata only, abs fileId)
- `08-search-symbols-Session.txt`, `08-search-symbols-New.txt` (text mode, no fileId)
- `08-search-symbols-Session-includeContent.txt` (source snippet in sibling mode)
- `08-search-content-Session.json`, `08-search-file-session-go.json` (`projectId:path` fileId + source)
- `08-search-symbol-Session-includeContent.json` (refusal), `08-search-symbol-Session-language.json` (refusal)
- `08-search-symbol-Session-filePath.json` (in-mode disambiguation works)
- `08-search-symbol-Session-page.json`, `08-search-symbol-LoadModules.json`, `08-search-symbol-New.json`
- `08-generality-workspace-symbol-Cancel.json`, `08-generality-workspace-content-Cancel.json`,
  `08-generality-workspace-file-axios-index.json`

bb 0.1.6 · HEAD `be4c0ef25` · 2026-11-18.
