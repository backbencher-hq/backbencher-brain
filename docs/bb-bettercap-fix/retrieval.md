# retrieval — P2-1/P2-2 lane status (bb_doc subject scope + bb_search symbol surface)

Status: **CLOSED** (fix landed, gate GREEN on the landed tree). Task: `task-14`. Lane: `retrieval`.
Base: triage findings `docs/bb-bettercap-triage/findings/ISSUE-07-doc-wrong-symbol.md` (PARTIAL) and
`ISSUE-08-search-symbol-mode.md` (REAL-BUT-MISDESCRIBED); charter `docs/bb-bettercap-fix/FIX-CHARTER.md`;
plan `docs/bb-bettercap-triage/PLAN.md` §P2-1/P2-2. Product: bb 0.1.6 line, fix landed in commit
`380a7e473` ("fix: wave-1 bettercap-report fixes across analyzers and tools"); current main at the time
of this page `09b82be95f6e924f52525d3c881106baceff762f`. All work read-only on bettercap; no
`npm run build`; no edits outside the lane's owned files (see Changed files).

## Gate (RED → GREEN)

New gate: `script/verify-retrieval-contract.ts` — hermetic in-process fixture (6 TS files, indexed by
the same `indexProjectParallel` harness the existing doc gates use; `BB_DATA_DIR` redirected into the
workspace scratch store because the sandbox blocks `~/.bb` creation). It drives the REAL `bb_doc` and
`bb_search` handlers and covers three groups: **A** doc subject contract, **B** search symbol-mode
source/identity contract, **C** docs-vs-behavior honesty.

```bash
mkdir -p .tools/triage-fix/retrieval/bbdata
BB_DATA_DIR=$PWD/.tools/triage-fix/retrieval/bbdata npx tsx script/verify-retrieval-contract.ts
```

| item | value |
|---|---|
| RED (pre-fix bytes) | `RETRIEVAL CONTRACT: 16/42 checks passed`, exit 1 — `evidence/retrieval/gate-red.txt` |
| intermediate (doc fixed, search not) | 29/43 — `evidence/retrieval/gate-doc-mid.txt` |
| GREEN candidate | `RETRIEVAL CONTRACT: 45/45 checks passed`, exit 0 — `evidence/retrieval/gate-green-candidate.txt` |
| GREEN final on landed tree | `RETRIEVAL CONTRACT: 45/45 checks passed`, exit 0 — `evidence/retrieval/gate-green-final.txt` (+ `.meta.txt`: 2026-11-20T21:42:40Z) |
| independent verifier | `evidence/verifier/runs/20261120T055722Z-final2-retrieval-contract.json` — exitCode 0, verdict `PASS`, gitHead `380a7e473` (cp1 red/green/final runs also present) |

RED evidence reproduced the triage symptoms exactly: ambiguous `Session` documented the property at
`src/module.ts:4` first and the declaration second with no scope declaration; `limit:1` produced an
API section containing only `property Session: Session | null is defined in src/module.ts at lines 4-4`
at `quality.passed:true`; qualified `session.Session` still returned both copies; `Dup` (two
declarations) had no union declaration; symbol mode returned `fileId:"/tmp/…"` and no `source`.

## Fix A — P2-1: `bb_doc` symbol mode resolves a SUBJECT, not a name union

`src/intelligence/documentation/doc-engine.ts`:

- **`DocSymbolSubject` + `resolveSymbolSubject()` (`:803`)** replaces the old name-`IN` scan
  (`target/leaf` copies ordered by `line_start`, qualified match appended only after the name rows).
  Resolution: qualified target → exact stored `qualified_name`, else a namespace-path selector
  (whole directory segment or file stem; `pathMatchesQualifier`); unqualified → exact-name copies,
  then **declaration kinds** (`DECLARATION_KINDS`, struct/class/interface/type/enum/function/method/
  module/namespace/protocol/record/union/object/actor/delegate) preferred over fields/properties/
  variables. Multi-declaration target → declared union. Resolution has its own bound
  (`RESOLUTION_CAP = 200`, declared as an `output-budget` unknown when hit) and **does not receive
  `limit`**: the per-section evidence cap can no longer change the documented subject.
- **Declared scope in the answer**: union title becomes `symbol: <target> (union of <n> indexed
  symbols)` (`:2341`); the summary opens with a `Union:` sentence or, for a single subject selected
  out of several copies, `Subject: <kind> <name> in <path>:<line> (selected from <n> indexed symbols
  of that name; <why>).` (`symbolSubjectSentence`, `:2763`). A target with exactly one indexed copy
  keeps the pre-fix title and summary byte-for-byte (positive control below).
- **`quality.scope`, measured** (`:2434`): `{ declared: "single"|"union"|"not-applicable", passed,
  subjects, copies, resolvedBy }`. `passed` is checkable: `single` must cite exactly its subject id;
  `union` must cite every declared subject; `quality.passed` gains this term, so a declared union the
  answer's own evidence cap cannot cover now fails. `DocCitation` carries `symbolId` for this test.
  Both output formats carry it: JSON object and a `scope:` line in the Markdown Quality block.
- Contract text updated: `docs/BB_DOC.md` — new "Subject resolution and scope (symbol mode)" section,
  `quality.scope` in the result contract, `limit` documented as an evidence cap only (never the
  subject selector), new verification-table row for this gate.

Real specimen (bettercap, source-level probe, read-only — `evidence/retrieval/bettercap-specimen-after.json`):

```text
Session (default):  title "symbol: Session", scope {declared:"single", subjects:1, copies:5,
                    resolvedBy:"declaration-kind"}, API: "struct Session is defined in
                    session/session.go at lines 72-98.", citation session/session.go:72, passed:true
Session (limit:1):  same subject and scope; API is the struct declaration only; passed:true
session.Session:    same subject, resolvedBy:"qualified-path"
New:                subject "function New in session/session.go:155" (property excluded), copies:2
LoadModules:        subject unchanged (copies:1, resolvedBy:"single-name"), title/summary unchanged
```

## Fix B — P2-2: `bb_search` symbol mode ships bounded source + one `fileId` convention

`src/mcp/tools/bb_search/handler.ts` (the projection is fixed at the owned handler boundary;
`src/ast/engine.ts` is not edited — see Residual R1):

- **Bounded source** (`symbolSourceSlice`, helper at `:36`, `SYMBOL_SOURCE_MAX_CHARS = 2000`): each
  returned match carries `source` = the bytes between the indexed `byteStart`/`byteEnd` (byte slice
  first; a character slice fallback when the engine's repair path stored UTF-16 offsets), capped at
  2,000 characters with `sourceTruncated:true`; an indexed span past the current file end is truncated
  to the file and declared; unreadable/escaping paths get `sourceUnavailable` instead of a throw. The
  descriptor's "exact symbol source" promise is now true.
- **Identity** (`:306`): symbol mode now reports `fileId` = `<projectId>:<relativePath>` — the same
  indexed file-row id `content` and `file` modes already reported — and the machine path moves to
  `absolutePath`. `fileId` is remapped only AFTER freshness resolution (which needs the absolute
  path). Checked: no other `bb_search` code path leaks an absolute `fileId` (`content` rows carry
  `brain_symbol.file_id`, `file` mode carries `brain_file.id`, `symbols` is text and has no `fileId`).
- Contract text updated: `src/mcp/tools/bb_search/descriptor.ts` (source + `sourceTruncated` +
  `<projectId>:<relativePath>` / `absolutePath`), `docs/BB_SEARCH.md` (symbol-mode output, fileId
  identity paragraph, stale-source note), generated page `docs/tools/bb_search.md` +
  `script/tool-docs/curation/bb_search.ts` (regenerated, not hand-patched).
- `src/cli/onboard.ts` untouched: its claim "Find a symbol, its exact source, or a file" became
  truthful once symbol mode returned source; `docs/MCP_CLI_INDEXER_GUIDE.md` likewise untouched
  (outside ownership; claim now truthful).

Real specimen (`evidence/retrieval/bettercap-specimen-after.json`): symbol mode `Session` returns
`fileId:"4c7590f1…:modules/c2/c2.go"`, `absolutePath:"/home/ishaq2321/bettercap/modules/c2/c2.go"`,
`source:"Session"`, `sourceTruncated:false`; identity across modes: symbol `…:modules/c2/c2.go`,
content `…:modules/arp_spoof/arp_spoof_test.go`, file `…:session/session.go` — all
`<projectId>:<relativePath>`.

## Positive controls (all in the gate, green)

- **A1 unique-symbol doc unchanged**: `symbol: UniqueThing` title exact, single scope, one citation,
  `quality.passed:true`; bettercap `LoadModules` re-run keeps its pre-fix title AND summary.
- **A3/A4**: `limit:1` keeps the same subject as the default call (never a field-only doc); qualified
  targets resolve one subject on both analyzer shapes (TS stores qualified names; Go stores the bare
  name → namespace-path route).
- **A5/A7**: two declarations produce a declared union in title, scope, and Markdown heading.
- **B3/B4**: `content` and `file` modes still answer, still return source, and agree on `fileId`;
  `symbols` mode still lists names.
- **C**: the written contract (descriptor, BB_SEARCH.md, BB_DOC.md, generated page) matches the
  measured behavior field-for-field.

## Verification runs (existing gates, saved under `evidence/retrieval/`)

| command | result | evidence |
|---|---|---|
| `npx tsx script/m20/verify-doc-modes.ts` | `DOC D1: PASS` | `verify-doc-modes.txt` |
| `npx tsx script/verify-doc.ts` | `BB_DOC: PASS` | `verify-doc-smoke.txt` |
| `npx tsx script/m13/verify-doc-facts.ts` | `D1: VERIFIED (16/16 passed, 3 negatives)` | `verify-doc-facts.txt` |
| `npx tsx script/m20/verify-doc-truth.ts` | `DOC TRUTH: PASS` | `verify-doc-truth.txt` |
| `npx tsx script/m20/verify-doc-citations.ts` | `DOC D2: PASS` | `verify-doc-citations.txt` |
| `bun --preload ./validation/tools/bb_search/work/harness-redirect.ts ./script/verify-search-modes.ts` | `S1: VERIFIED (48/48 passed, 9 negatives)` | `verify-search-modes.txt` |
| `bun --preload … ./script/m13/verify-search-honesty.ts` | `S4: VERIFIED (21/21 passed, 4 negatives)` | `verify-search-honesty.txt` |
| `bun --preload … ./script/m13/verify-search-docs.ts` | `S5: VERIFIED (24/24 passed, 2 negatives)` | `verify-search-docs.txt` |
| `npx tsx script/verify-tool-docs.ts` | `TOOL DOCS: PASS (16 public tools, 18 artifacts)` | (run after the full regeneration below) |

All search/doc runs used `BB_DATA_DIR=$PWD/.tools/triage-fix/retrieval/bbdata BB_NO_AUTO_REFRESH=1`.
The M13 search gates are Bun scripts (`import.meta.dir`), so they need `bun --preload …` as their own
docs state; running them under `tsx` fails with `ERR_MODULE_NOT_FOUND` / undefined `import.meta.dir`.

**`npx tsc --noEmit`** on the current landed main: exit 2 with **one** error, in another lane's file
(`src/ast/real-csharp-analyzer.ts(2719,64): TS2345`); no error in any file this lane touched.
Evidence: `tsc-noemit.txt` (+ `.meta.txt`).

## Changed files (landed commit `380a7e473`)

| file | change |
|---|---|
| `src/intelligence/documentation/doc-engine.ts` | subject resolution, declared scope title/summary, `quality.scope` measured term, `limit` decoupled, `symbolId` on symbol citations |
| `src/mcp/tools/bb_search/handler.ts` | bounded `source`/`sourceTruncated`, `fileId` → `<projectId>:<relativePath>`, `absolutePath`, `sourceUnavailable` |
| `src/mcp/tools/bb_search/descriptor.ts` | shipped source + identity convention documented |
| `docs/BB_DOC.md`, `docs/BB_SEARCH.md` | contract text for the two fixes |
| `docs/tools/bb_search.md`, `script/tool-docs/curation/bb_search.ts` | regenerated page + curated returns line |
| `docs/data/public-tools.json`, `docs/tools/{bb_graph,bb_impact,bb_visualize}.md` | full `verify-tool-docs.ts --write` regeneration; the aggregate artifact is shared, and the page set also carried other lanes' already-current descriptors at regeneration time |
| `script/verify-retrieval-contract.ts` | NEW gate (no existing gate was weakened, skipped or re-baselined; no existing script edited) |
| `validation/tools/bb_search/gates/evidence/m13/s{1,4,5}.json` | written by the search gates themselves when re-run (test evidence, not product behavior) |

## Residuals / follow-ups

- **R1 — engine-level `fileId` — FIXED in `ee45e176d` (was: absolute for direct consumers).** `src/ast/engine.ts:2836`
  projects `fileId: BrainFileTable.path` (absolute). The fix now also changes the engine projection (`fileId = <projectId>:<relativePath>`, `absolutePath` carries the machine path; edit-engine `matchesOf` paths via `absolutePath`); the gate gained engine-level assertions → 48/48. The historical handler-boundary remap remains the wire contract; `ASTEngine.findSymbol` is also consumed by
  `src/intelligence/edit/edit-engine.ts:814,857`, which expects a filesystem path, so changing the
  engine projection is a cross-lane change (engine + edit-safety audit + any direct callers), not a
  lone `bb_search` fix. If a future tool exposes `findSymbol` rows directly, it must remap the same
  way (or the engine must grow a `path`/`fileId` split with edit-engine migrated in the same commit).
  Recorded for the next round; no `bb_search` code path leaks an absolute `fileId` today.
- **R2 — bettercap source-level re-run is done for `bb_doc`; the gh-cli source-level check CANNOT be
  verified here.** `bb_tests/repositories/gh-cli/internal` has an old index schema
  (`SchemaIncompatibleError: missing brain_relationship.target_basis/evidence_class` — the P2-6
  old-index-compat lane's scope), so the qualified-target specimen was verified only on the hermetic
  fixture (both analyzer shapes) and on bettercap (`session.Session`). CLI-dist E2E on bettercap is
  the Lead/coordinator step after the build.
- **R3 — `npx tsc --noEmit` is red on current main from another lane** (`real-csharp-analyzer.ts`),
  not from this lane (see above). Report as integration-blocking for whoever owns that file.
- **R4 — regeneration ordering for docs gates.** Editing a descriptor makes
  `docs/data/public-tools.json` and `website/src/data/tools.generated.ts` stale, so
  `verify-tool-docs.ts --only <tool> --write` is not enough for the S5 gate: run the FULL
  `npx tsx script/verify-tool-docs.ts --write` (it writes only generated artifacts). This was the one
  transient S5 `KNOWN-GAP`, resolved to `VERIFIED` once the aggregates were regenerated.
- **R5 — resolution cap is a declared bound at 200 copies**; a future target exceeding it gets an
  `output-budget` unknown, not a silent partial union (gate does not exercise >200 copies).

## CLI/dist E2E (final build, bettercap specimen — read-only)

Captured after the R1 fix with `node bin/bb` built from the final tree:

- `bb tool bb_doc --args '{"mode":"symbol","target":"Session","format":"json"}'` → `symbol: Session`,
  `quality.scope {declared:"single", passed:true, subjects:1, copies:5, resolvedBy:"declaration-kind"}`
  — same at `limit:1` (`DIST-E2E-bb_doc-Session.json`).
- `bb tool bb_search --args '{"mode":"symbol","query":"Session"}'` → 5 matches, every `fileId` is
  `<projectId>:<relativePath>`, `absolutePath` present, bounded `source` + `sourceTruncated`
  (`DIST-E2E-bb_search-Session.json`).
- Old-index doors (gh-cli 2026-10-17 index): `bb_graph`/`bb_impact`/`bb_visualize`/`bb_security` emit
  the typed `BB_SCHEMA_INCOMPATIBLE` + `bb index --post` remedy, no raw SQLite and no partial answer
  (`../verifier/p2/DIST-E2E-old-index-refusal-*.txt`).

## Evidence index (`docs/bb-bettercap-fix/evidence/retrieval/`)

`gate-red.txt` · `gate-doc-mid.txt` · `gate-green-candidate.txt` · `gate-green.txt` ·
`gate-green-final.txt` (+ `.meta.txt`) · `verify-doc-modes.txt` · `verify-doc-smoke.txt` ·
`verify-doc-facts.txt` · `verify-doc-truth.txt` · `verify-doc-citations.txt` ·
`verify-search-modes.txt` · `verify-search-honesty.txt` · `verify-search-docs.txt` ·
`tsc-noemit.txt` (+ `.meta.txt`) · `bettercap-specimen-after.json` / `.err` (JSON is the real-specimen
source-level probe; `.err` preserves the earlier aborted attempts incl. the gh-cli schema refusal) ·
independent verifier runs: `docs/bb-bettercap-fix/evidence/verifier/runs/*retrieval-contract.json`.
