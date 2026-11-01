// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the handler for bb_search — the adapter that parses arguments, calls the owning engine, and shapes the tool result.
// WHICH TOOL IT SERVES — bb_search (see src/mcp/tools/bb_search/descriptor.ts for mutability, modes and schema).
// WHERE ITS EVIDENCE LIVES — docs/tools/bb_search.md, docs/BB_*.md for its guide page, validation/tools/bb_search/**, and the gate scripts named in its task.
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/mcp/tools/bb_search/descriptor.ts (schema/defaults), the owning engine modules it calls, docs/tools/bb_search.md, and its gate scripts.
// CONTRACTS IT MUST NOT BREAK — declared bounds, declared absence, freshness flags,
//   read/write boundary, and the no-regex policy (validation/tools/regex-allowlist.json).
// ─────────────────────────────────────────────────────────────────────────────

import type { ToolHandler } from "../shared"
import { textResult, resolveSafeReadPath, readIndexedFile, describeUnknownFilters } from "../shared"
import { BrainDatabase } from "../../../brain/database"
import { BrainTools } from "../../../ast/tools"
import { ASTEngine } from "../../../ast/engine"
import { resolveRowsFreshnessDetailed, buildStalenessEnvelope } from "../../../brain/freshness"
import { collectStaleFiles, maybeAutoRefresh, autoRefreshLine } from "../../../ast/auto-refresh"

export const handler: ToolHandler = async (args, { projectId, projectPath }) => {
    const mode = args.mode === "content" ? "content" : args.mode === "symbol" || args.mode === "file" ? args.mode : "symbols"
    // Invalid input must return an MCP error
    // envelope, not throw out of the handler — a thrown error crashes the
    // whole tool call on hosts that do not wrap handlers in try/catch.
    // The registry advertises mode enum
    // [symbols, content, symbol, file] (and the docs example calls
    // mode:"symbols"), the validation layer accepts it — but this guard
    // rejected it. Surface truth: the advertised enum value must work.
    if (args.mode !== undefined && !"symbols content symbol file".split(" ").includes(String(args.mode))) {
      return textResult(`bb_search: unknown mode "${args.mode}" (known: symbols, content, symbol, file)`, true)
    }
    // `limit` is a page size AND a work budget. It has a floor (0 returns no
    // rows) and now a declared ceiling: above this the answer stops being a page
    // and becomes a corpus dump. Refused, not clamped — a clamped page would
    // look like the caller's request was honoured, which is the failure the
    // parameter exists to prevent.
    const LIMIT_CEILING = 2000
    if (args.limit !== undefined && Number(args.limit) > LIMIT_CEILING) {
      return textResult(
        `bb_search: limit must be between 0 and ${LIMIT_CEILING} — refused rather than clamped, so a returned page always means the page asked for`,
        true,
      )
    }
    // `exact` asks for whole-name matches; a regex is a pattern over names. The
    // combination was accepted and `exact` was silently ignored, so a caller who
    // asked for `^handle.*` "exactly" got a prefix match. An option a mode cannot
    // honour is refused, never dropped.
    if (args.regex === true && args.exact === true) {
      return textResult("bb_search symbols mode: exact and regex cannot be combined — exact asks for a whole-name match, regex asks for a pattern; pass one", true)
    }
    // A language / symbolKind value the index does not contain is reported as
    // an error, because a filter that excludes everything is indistinguishable
    // from a symbol that does not exist. Checked before any search work so the
    // correction arrives in the same round trip.
    if (mode === "symbols" || mode === "content") {
      const unknown = await describeUnknownFilters(projectId as string, args)
      if (unknown) return textResult(unknown, true)
    }
    if (mode === "file") {
      // The door refuses mode-irrelevant options; the handler keeps its own
      // guard for direct/library callers. `refresh` is the one option a caller
      // is most likely to pass here by mistake, because the schema describes it
      // without a mode scope — this mode never auto-refreshes.
      if (args.refresh !== undefined) {
        return textResult("bb_search file mode does not accept: refresh — accepted for file: mode, filePath (file mode never auto-refreshes; its stale remediation names the manual reindex command)", true)
      }
      let target: { absolute: string; relative: string }
      try {
        target = resolveSafeReadPath(projectPath, String(args.filePath))
      } catch (e: any) {
        return textResult(`bb_search mode=file: ${e?.message ?? "invalid path"}`, true)
      }
      const raw = await BrainDatabase.getRawInstance(projectId as any)
      // Looked up by the INDEXED relative path first, not by the realpath'd
      // absolute one. resolveSafeReadPath returns realpathSync(candidate) while
      // brain_file.path holds the path the indexer was given, so a project
      // reached through a symlink (/tmp, /var on macOS, a symlinked checkout)
      // reported "file is not indexed" for a file that IS indexed. The relative
      // path is symlink-independent; the absolute path stays as a fallback for
      // an index built from realpaths.
      const byRelative = raw
        .prepare("SELECT id, language, file_hash FROM brain_file WHERE project_id=? AND relative_path=?")
        .get(projectId, target.relative) as { id: string; language: string; file_hash: string } | undefined
      const row = byRelative ?? (raw
        .prepare("SELECT id, language, file_hash FROM brain_file WHERE project_id=? AND path=?")
        .get(projectId, target.absolute) as { id: string; language: string; file_hash: string } | undefined)
      // An error envelope, not a throw: this handler's own contract,
      // stated above) is that invalid input returns isError, and the sibling
      // branches here already do.
      if (!row) return textResult(`bb_search mode=file: file is not indexed: ${target.relative}`, true)
      const read = readIndexedFile(target.absolute, projectPath, target.relative)
      if ("error" in read) return textResult(`bb_search mode=file: ${read.error}`, true)
      const content = read.content
      const maxChars = 100_000
      const truncated = content.length > maxChars
      // Freshness from the shared resolver — per-item flag + envelope
      // block (file-scope remediation names this exact file).
      const detail = resolveRowsFreshnessDetailed(raw, projectId as any, [{ fileId: row.id }])
      const fileStatus = detail.statuses.get(row.id) ?? "missing"
      return textResult(JSON.stringify({
        searchMode: "file",
        file: target.relative,
        fileId: row.id,
        language: row.language || "unknown",
        content: truncated ? content.slice(0, maxChars) : content,
        contentLength: content.length,
        truncated,
        // Declared so every mode's response names its match set, even the one
        // that can only ever match a single file.
        totalMatches: 1,
        stale: fileStatus !== "fresh",
        // This mode never auto-refreshes: it reads current source and measures
        // it against the index hash. The envelope must not claim a repair path
        // that does not exist here (nor name `refresh=false`, which this mode
        // rejects).
        freshness: buildStalenessEnvelope(detail.summary, { kind: "file", path: target.relative, autoRefresh: false }),
      }, null, 2))
    }
    if (mode === "content") {
      const { searchContent } = await import("../../../intelligence/search/content-search")
      // searchContent returns a typed array with meta attached (searchMode/staleCount/…).
      // JSON.stringify of an array drops those properties, so the wire response must
      // wrap the results in an explicit envelope — otherwise the mode and freshness
      // metadata silently vanish for every MCP/CLI consumer.
      const raw = await BrainDatabase.getRawInstance(projectId as any)
      // The pass is rerunnable — when the first pass finds stale
      // files within budget we repair them inline and run AGAIN so the answer
      // reflects the repair, with the decision declared on the answer.
      const runPass = async () => {
        // offset was never forwarded, although searchContent fully supports it —
        // so offset:100 returned page 1 byte-identically and an agent paging
        // until the page came back empty never terminated.
        const results = await searchContent(projectId as any, String(args.query ?? ""), {
          maxResults: Number(args.limit ?? 15),
          offset: Number(args.offset ?? 0),
          languages: args.language ? [String(args.language)] : undefined,
          symbolKind: args.symbolKind ? String(args.symbolKind) : undefined,
        })
        // Freshness block from the shared resolver (rows carry fileId;
        // per-row stale flags are set by searchContent itself).
        const detail = resolveRowsFreshnessDetailed(raw, projectId as any, results.map((r: any) => ({ fileId: r.fileId })))
        return {
          answer: {
            searchMode: "content",
            query: String(args.query ?? ""),
            // `total` is the MATCH SET and `returned` is the page. Reporting the
            // page length as `total` meant a caller could not tell one match
            // from fifteen, and a truncated page read as a complete one.
            total: results.totalMatches ?? results.length,
            returned: results.length,
            staleCount: results.staleCount ?? 0,
            freshCount: results.freshCount ?? 0,
            // staleCount/freshCount describe the RETURNED PAGE, while total
            // describes the whole match set; the names sat next to each other and
            // read as one set. Both remain for compatibility, and the page-local
            // meaning is now stated in a field name too.
            pageStaleCount: results.staleCount ?? 0,
            truncated: results.truncated ?? false,
            ...(results.truncationReason ? { truncationReason: results.truncationReason } : {}),
            // Which route matched, and how much of the corpus has a searchable
            // body. Without these a caller cannot tell a phrase hit (the text
            // says this verbatim) from a keyword coincidence (it discusses the
            // same words), nor "nothing matched" from "nothing could match" on a
            // database indexed before bodies were stored. Declared in
            // SearchResults and populated by searchContent; carried here because a
            // disclosure that stops at the search layer is not a disclosure.
            ...(results.matchMode ? { matchMode: results.matchMode } : {}),
            // Which words carried the match, when the answer is a keyword
            // coincidence rather than the phrase that was asked for. This was
            // computed, declared in SearchResults, and then dropped here — so
            // the comment above ("a disclosure that stops at the search layer
            // is not a disclosure") was true of every OTHER field on this
            // object and false of this one.
            ...(results.termMatch ? { termMatch: results.termMatch } : {}),
            ...(results.bodyCoverage ? { bodyCoverage: results.bodyCoverage } : {}),
            freshness: buildStalenessEnvelope(detail.summary, { kind: "dir" }),
            results,
          },
          rows: results.map((r: any) => ({ fileId: r.fileId })),
          statuses: detail.statuses,
        }
      }
      const pass1 = await runPass()
      const staleFiles = collectStaleFiles(raw, pass1.rows, pass1.statuses)
      if (staleFiles.length > 0) {
        const decision = await maybeAutoRefresh(projectId, projectPath, staleFiles, { perCallOptOut: args.refresh === false })
        if (decision.action === "refreshed") {
          const pass2 = await runPass()
          return textResult(JSON.stringify({ ...pass2.answer, autoRefresh: autoRefreshLine(decision) }, null, 2))
        }
        if (decision.action === "declined") {
          // Honest decline: answer from existing data with the envelope, and
          // declare why the automatic repair did not run.
          return textResult(JSON.stringify({ ...pass1.answer, autoRefresh: autoRefreshLine(decision) }, null, 2))
        }
      }
      return textResult(JSON.stringify(pass1.answer, null, 2))
    }
    if (mode === "symbol") {
      const raw = await BrainDatabase.getRawInstance(projectId as any)
      // Rerunnable pass — repair stale files inline within
      // budget, then answer from the SECOND pass so the answer reflects the
      // repair (declared).
      // Both branches produce either an answer or an error envelope, so the
      // call sites must narrow the type before reading answer/rows/statuses.
      type SymbolPass = { answer: Record<string, unknown>; rows: Array<{ filePath: string }>; statuses: Map<string, string> } | { envelope: string }
      const runPass = async (): Promise<SymbolPass> => {
        let found: { matches: any[] }
        try {
          found = await ASTEngine.findSymbol(projectId, String(args.symbolName ?? args.query ?? "").trim(), args.filePath ? String(args.filePath) : undefined)
        } catch (error: any) {
          // findSymbol's internals (dynamic import, DB handle) threw. The
          // handler returns an error envelope rather than letting a raw driver
          // or loader message reach the caller as a "successful" answer.
          return { envelope: `bb_search mode=symbol: ${error?.message ?? String(error)}` }
        }
        // Per-match stale flag + envelope block. findSymbol rows alias
        // fileId to the file PATH, so the resolver gets filePath rows.
        //
        // Paging (D12): a symbol name can legitimately be declared in many files
        // (a common method name), and the complete set can be enormous. With no
        // `limit` the mode keeps its original contract — the COMPLETE match set —
        // and a declared `truncated:false`. With `limit` it is a page over the
        // same complete set: `totalMatches` is the set size, `returned` the page,
        // `truncated` says whether the page is the whole set, and `offset` walks
        // it. 0 rows past the end and a declared total, never an empty answer that
        // reads as "no such symbol".
        const matches = (found as { matches: any[] }).matches ?? []
        const totalMatches = matches.length
        const pageLimit = args.limit === undefined ? null : Number(args.limit)
        const pageOffset = Number(args.offset ?? 0)
        const page = pageLimit === null ? matches : matches.slice(pageOffset, pageOffset + pageLimit)
        const detail = resolveRowsFreshnessDetailed(raw, projectId as any, page.map((m: any) => ({ filePath: m.fileId })))
        for (const m of page) m.stale = detail.statuses.get(m.fileId) !== "fresh"
        return {
          answer: {
            ...found,
            matches: page,
            // `found` spells out absence, because an empty `matches` array is
            // otherwise the same shape as a symbol with no output.
            found: totalMatches > 0,
            totalMatches,
            returned: page.length,
            // A page that is not the whole set says so; the default (no limit)
            // answer is the whole set and says that instead.
            truncated: pageLimit === null ? false : pageOffset + page.length < totalMatches,
            ...(pageLimit !== null && pageOffset + page.length < totalMatches
              ? { truncationReason: "page-limit", nextOffset: pageOffset + page.length }
              : {}),
            freshness: buildStalenessEnvelope(detail.summary, { kind: "dir" }),
          },
          rows: page.map((m: any) => ({ filePath: m.fileId })),
          statuses: detail.statuses,
        }
      }
      const pass1 = await runPass()
      if ("envelope" in pass1) return textResult(pass1.envelope, true)
      const staleFiles = collectStaleFiles(raw, pass1.rows, pass1.statuses)
      if (staleFiles.length > 0) {
        const decision = await maybeAutoRefresh(projectId, projectPath, staleFiles, { perCallOptOut: args.refresh === false })
        if (decision.action === "refreshed") {
          const pass2 = await runPass()
          if ("envelope" in pass2) return textResult(pass2.envelope, true)
          return textResult(JSON.stringify({ ...pass2.answer, autoRefresh: autoRefreshLine(decision) }, null, 2))
        }
        if (decision.action === "declined") {
          return textResult(JSON.stringify({ ...pass1.answer, autoRefresh: autoRefreshLine(decision) }, null, 2))
        }
      }
      return textResult(JSON.stringify(pass1.answer, null, 2))
    }
    // Trimmed once, here, so the value echoed back in "no results for …" is the
    // value that was actually searched.
    const query = String(args.query ?? "").trim()
    if (!query) return textResult("bb_search: query must not be empty", true)
    // Rerunnable pass — the pass answers from the SECOND run
    // after an inline repair, with the decision declared on a trailing line.
    // No staleness (searchCode's own resolution found none) ⇒ one pass, zero
    // added cost, byte-identical output with the pre-A1 behavior.
    const runPass = async () => {
      const results: any = await BrainTools.searchCode(projectId, query, {
        maxResults: Number(args.limit ?? 15),
        languages: args.language ? [String(args.language)] : undefined,
        symbolKind: args.symbolKind ? String(args.symbolKind) : undefined,
        includeContent: args.includeContent === true,
        exact: args.exact === true,
        caseSensitive: args.caseSensitive === true,
        regex: args.regex === true,
        offset: Number(args.offset ?? 0),
      })
      // A stale row's snippet is read from CURRENT disk while its line numbers
      // come from the index, so the two describe different revisions of the
      // file. The [STALE] marker qualifies the record; the snippet line is
      // marked separately, because the bytes are on the NEXT line.
      const lines = results.map((result: any) => {
        const stale = result.stale ? " [STALE]" : ""
        const snippet = result.snippet && result.snippet !== result.symbolName
          ? `\n    ${String(result.snippet).split("\n").slice(0, 8).join("\n    ")}${result.stale ? "\n    [snippet read from the current file; the line numbers above are from the index]" : ""}`
          : ""
        return `${result.symbolName} [${result.symbolType}] ${result.file}:${result.line} (${result.language})${stale}${snippet}`
      })
      // The engine already computed totalMatches / truncated / staleCount, and
      // this response is a rendered STRING — so those fields were structurally
      // dropped and a truncated page read as a complete one. The footer is what
      // makes the page legible: how many matches exist, whether the page is all
      // of them, and how many rows are stale.
      const total = results.totalMatches ?? results.length
      const footer: string[] = []
      if (total > lines.length) {
        footer.push(
          `showing ${lines.length} of ${total} match${total === 1 ? "" : "es"}` +
            (results.truncated ? " — TRUNCATED: a candidate cap or the noise filter kept matches out of this page" : ""),
        )
      }
      if ((results.staleCount ?? 0) > 0) footer.push(`${results.staleCount} of ${lines.length} results are STALE — the file changed after indexing`)
      if (results.freshnessError) footer.push("freshness could not be resolved for these results (staleCount is not a freshness claim)")
      if (results.truncated && lines.length === 0) {
        // An EMPTY page is not automatically a complete answer. When the engine
        // declared it was cut short, "no results" is a statement the caller
        // cannot check — a bounded scan and a scan that genuinely found nothing
        // were byte-identical. Measured case: `(a+)+b` on this repo's own index
        // returns "no results" in 0.3s when the scan completes and in 2s when
        // the time budget kills it; the two answers must not look the same.
        footer.push(
          `scan was cut short (${results.truncationReason ?? "unknown"}) over ${results.scannedRows ?? "some"} candidate rows — this is NOT a complete answer`,
        )
      } else if (results.truncated && lines.length > 0) {
        footer.push(`TRUNCATED (${results.truncationReason ?? "unknown"}) — this page is not the whole match set`)
      }
      // The MATCH-SET declaration. This mode answers as text, so the counts the
      // engine computed were structurally dropped and a short page could only be
      // read as a complete one. One trailing machine-readable line states how
      // many matched, how many were returned, whether the scan was cut, and how
      // many rows are stale — the same facts the JSON modes carry as fields.
      footer.push(
        `[match-set] searchMode=symbols totalMatches=${total} returned=${lines.length} truncated=${results.truncated === true} staleCount=${results.staleCount ?? 0}` +
          (results.truncationReason ? ` truncationReason=${results.truncationReason}` : "") +
          (results.freshnessError ? " freshnessError=true" : ""),
      )
      return {
        text: lines.length
          ? lines.join("\n") + (footer.length ? `\n${footer.join("\n")}` : "")
          : `no results for "${query}"` + (footer.length ? `\n${footer.join("\n")}` : ""),
        results,
        lines,
        rows: results.map((r: any) => ({ fileId: r.fileId })),
      }
    }
    const pass1 = await runPass()
    // searchSymbols already resolved staleness internally (result.stale +
    // staleCount) — only when it found staleness do we resolve the row map
    // ourselves (no added stat cost on the fresh path) to build the repair set.
    if ((pass1.results.staleCount ?? 0) > 0) {
      const raw = await BrainDatabase.getRawInstance(projectId as any)
      const detail = resolveRowsFreshnessDetailed(raw, projectId as any, pass1.rows)
      const staleFiles = collectStaleFiles(raw, pass1.rows, detail.statuses)
      if (staleFiles.length > 0) {
        const decision = await maybeAutoRefresh(projectId, projectPath, staleFiles, { perCallOptOut: args.refresh === false })
        if (decision.action === "refreshed") {
          const pass2 = await runPass()
          // pass2.text already carries the honest "no results for …" when the
          // edit removed every match — always keep it, then declare.
          return textResult(`${pass2.text}\n${autoRefreshLine(decision)}`)
        }
        if (decision.action === "declined") {
          // Honest decline appended to the stale answer — never silently stale.
          return textResult(`${pass1.text}\n${autoRefreshLine(decision)}`)
        }
      }
    }
    return textResult(pass1.text)
}
