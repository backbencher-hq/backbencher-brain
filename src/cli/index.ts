// Universal bb CLI on brain-core. Works under Bun and Node.
//   bb index <dir> [--force]
//   bb search <query> [--dir DIR] [--limit N] [--language LANG]
//   bb health [--dir DIR]
//   bb mcp [--dir DIR]
//   bb version
import { Command } from "commander"
import { createHash } from "crypto"
import { existsSync, mkdirSync, realpathSync, renameSync, statSync } from "fs"
import path from "path"
import { BrainDatabase } from "../brain/database"
import { indexProjectParallel } from "../ast/parallel-indexer"
import { acquireIndexLock, IndexLockHeldError, type IndexLockHandle } from "../ast/index-lock"
import { BrainTools } from "../ast/tools"
import { BACKBENCHER_BRAIN_VERSION } from "../version"
import { getUnifiedHealth, formatUnifiedHealth } from "../intelligence/health/health-provider"
import { bbProjectsDir } from "../util/bb-data-dir"
import { LogLevel, setLogLevel } from "../util/log"
import { computeCheckoutFingerprint, readStoredFingerprint } from "../ast/fingerprint"
import { FRESHNESS_REMEDIATION } from "../brain/freshness"
import { collectStaleFiles, maybeAutoRefresh, autoRefreshLine } from "../ast/auto-refresh"
import { resolveRowsFreshnessDetailed } from "../brain/freshness"

export function getProjectId(projectPath: string): string {
  const resolved = path.resolve(projectPath)
  let canonical = resolved
  try {
    canonical = realpathSync.native(resolved)
  } catch {
    // Nonexistent paths retain deterministic lexical identity for validation.
  }
  const canonicalId = createHash("sha1").update(canonical).digest("hex").substring(0, 40)
  if (canonical !== resolved) {
    const legacyId = createHash("sha1").update(resolved).digest("hex").substring(0, 40)
    const legacyDir = path.join(bbProjectsDir(), legacyId)
    const canonicalDir = path.join(bbProjectsDir(), canonicalId)
    if (existsSync(legacyDir) && !existsSync(canonicalDir)) {
      mkdirSync(bbProjectsDir(), { recursive: true })
      try { renameSync(legacyDir, canonicalDir) } catch {}
    }
  }
  return canonicalId
}

function requireDir(p: string): string {
  const abs = path.resolve(p)
  if (!existsSync(abs) || !statSync(abs).isDirectory()) {
    console.error(`✗ not a directory: ${abs}`)
    process.exit(1)
  }
  return abs
}

// M22.V1: remaining-time estimate from a live progress sample. Honest rule:
// no ETA is produced before there is at least one second of elapsed time and a
// non-zero processed rate; otherwise it returns "…". elapsedSeconds is the
// wall-clock ms elapsed since the run started (see parallel-indexer enrichment).
function formatETA(s: { processedFiles: number; totalFiles: number; elapsedSeconds?: number }): string {
  const elapsedS =
    s.elapsedSeconds !== undefined && s.elapsedSeconds > 0 ? s.elapsedSeconds / 1000 : 0
  if (elapsedS < 1 || s.processedFiles <= 0 || s.totalFiles <= 0) return "…"
  const perFileS = elapsedS / s.processedFiles
  const remaining = Math.max(0, (s.totalFiles - s.processedFiles) * perFileS)
  if (remaining < 60) return `${Math.round(remaining)}s`
  if (remaining < 3600) return `${Math.floor(remaining / 60)}m${Math.round(remaining % 60)}s`
  return `${Math.floor(remaining / 3600)}h${Math.floor((remaining % 3600) / 60)}m`
}

async function cmdIndex(
  dir: string | undefined,
  opts: { force?: boolean; skipPostProcessing?: boolean; post?: boolean; file?: string; changed?: boolean; resume?: boolean; import?: string; noSetup?: boolean },
) {
  // M22.C1: default `<dir>` to the current directory like every other command
  // (search/health/mcp all fall back to process.cwd()); `cd proj && bb index`
  // must index the project you are standing in.
  const abs = dir ? requireDir(dir) : process.cwd()
  // M30.S2: first-run embedding setup. Interactive ONLY on a TTY with no
  // config anywhere; non-TTY never hangs. --no-setup skips entirely.
  const { maybeRunFirstRunSetup } = await import("../setup/setup-wizard")
  await maybeRunFirstRunSetup({ noSetup: opts.noSetup === true })
  const pid = getProjectId(abs)
  // M40.A5: executable semantics matrix (docs/m40/PLAN.md "bb index flag
  // semantics matrix"). The legal-combination whitelist is the source of
  // truth: every listed combo maps to defined behavior, ANY combination not
  // on the list is rejected pre-run — a future flag can never silently
  // create an undefined combo. Rejection messages are actionable.
  {
    type Flags = { force: boolean; changed: boolean; resume: boolean; post: boolean; skipPost: boolean; file: boolean; imp: boolean }
    const f: Flags = {
      force: opts.force === true,
      changed: opts.changed === true,
      resume: opts.resume === true,
      post: opts.post === true,
      skipPost: opts.skipPostProcessing === true,
      file: opts.file != null,
      imp: opts.import != null,
    }
    const LEGAL: Array<{ when: (x: Flags) => boolean; behavior: string }> = [
      { when: (x) => !x.force && !x.changed && !x.resume && !x.post && !x.skipPost && !x.file && !x.imp, behavior: "full index + all post-processing" },
      { when: (x) => x.changed && !x.force && !x.resume && !x.post && !x.skipPost && !x.file && !x.imp, behavior: "incremental parse + bounded post-pass" },
      { when: (x) => x.resume && !x.force && !x.changed && !x.post && !x.skipPost && !x.file && !x.imp, behavior: "incremental from checkpoint + bounded post-pass" },
      { when: (x) => x.post && !x.force && !x.changed && !x.resume && !x.skipPost && !x.file && !x.imp, behavior: "no parse; re-run 5 derived phases only" },
      { when: (x) => x.skipPost && !x.force && !x.changed && !x.resume && !x.post && !x.file && !x.imp, behavior: "parse+store only; derived data deferred (bb index --post to finish)" },
      { when: (x) => x.file && !x.force && !x.changed && !x.resume && !x.post && !x.skipPost && !x.imp, behavior: "single-file reindex + scoped post-pass" },
      { when: (x) => x.imp && !x.force && !x.changed && !x.resume && !x.post && !x.skipPost && !x.file, behavior: "adopt DB, then incremental top-up" },
      { when: (x) => x.force && !x.changed && !x.resume && !x.post && !x.skipPost && !x.file && !x.imp, behavior: "wipe + full index + full post-processing" },
    ]
    if (!LEGAL.some((l) => l.when(f))) {
      const active = Object.entries(f).filter(([, v]) => v).map(([k]) => `--${k === "skipPost" ? "skip-post-processing" : k === "imp" ? "import" : k}`).join(" ")
      console.error(`✗ conflicting bb index options: ${active || "(none)"}\n  This combination has no defined behavior. See the semantics matrix: bb index --help, docs/m40/PLAN.md\n  Remediations: --force alone rebuilds everything; --post alone re-runs derived-data phases; --changed/--resume alone run the bounded pass.`)
      process.exitCode = 1
      return
    }
  }
  // M40.A1: standalone post-processing — re-runs the five heavy phases +
  // integrity check WITHOUT re-parsing. The remediation for stale derived
  // data after --changed/--resume/agent edits (those paths defer it by design).
  if (opts.post) {
    const { runPostProcessing } = await import("../ast/parallel-indexer")
    try {
      const post = await runPostProcessing(pid)
      console.log(`✓ post-processing complete in ${(post.totalMs / 1000).toFixed(1)}s`)
      for (const p of post.phases) {
        console.log(`  ${p.outcome === "ok" ? "✓" : p.outcome === "failed" ? "✗" : "-"} ${p.name.padEnd(14)} ${p.ms}ms`)
      }
      const failedPhases = post.phases.filter((p) => p.outcome === "failed")
      if (failedPhases.length > 0) {
        console.error(`✗ ${failedPhases.length} post-processing phase(s) failed (${failedPhases.map((p) => p.name).join(",")}) — index marked partial`)
        process.exitCode = 1
      }
    } catch (e: any) {
      console.error(`✗ post-processing failed: ${e?.message}`)
      process.exitCode = 1
    }
    return
  }
  // M23.P3: `bb index --import <db>` re-homes an existing brain.db (from a
  // moved project or another machine) onto this checkout's project id.
  if (opts.import != null) {
    const { importDbFile } = await import("../ast/project-registry")
    const result = importDbFile(opts.import, pid, abs)
    if (result.adopted) {
      console.log(`imported ${opts.import} as project ${pid.slice(0, 8)} (index rebound to this checkout)`)
      return
    }
    console.error(`✗ import failed: ${result.reason}`)
    process.exitCode = 1
    return
  }
  // M23.P3: adoption — if this checkout has no DB but a previously indexed
  // project matches its codebase fingerprint, re-home that DB to this id so
  // the index (symbols, relationships, embeddings) survives the move.
  let adopted = false
  if (!opts.force) {
    const dbPath = BrainDatabase.getDbPath(pid)
    if (!existsSync(dbPath)) {
      const { findAdoptableDb, adoptProject } = await import("../ast/project-registry")
      const { computeCheckoutFingerprint } = await import("../ast/fingerprint")
      const cf = await computeCheckoutFingerprint(abs)
      if (cf.fingerprint) {
        const candidate = findAdoptableDb(cf.fingerprint)
        if (candidate) {
          const result = adoptProject(candidate.id, pid, abs)
          if (result.adopted) {
            adopted = true
            console.log(`adopted existing index from project ${candidate.id.slice(0, 8)} (moved/rebound to ${pid.slice(0, 8)})`)
          } else {
            console.warn(`adoption failed: ${result.reason}`)
          }
        }
      }
    }
  }
  // M43.P1: a --force wipe+index is ONE lock scope — acquire before the wipe
  // so a concurrent indexer can never slip between the wipe and the run.
  // Non-force paths acquire inside indexProjectParallel/runPostProcessing.
  let heldLock: IndexLockHandle | null = null
  if (opts.force) {
    try {
      heldLock = await acquireIndexLock(pid, { kind: "wipe+index" })
    } catch (e: any) {
      if (e instanceof IndexLockHeldError) {
        console.error(`✗ ${e.message}`)
      } else {
        console.error(`✗ could not acquire the index lock: ${e?.message}`)
      }
      process.exitCode = 1
      return
    }
    // In-place wipe (never delete the DB file): deleting + recreating the file
    // orphans any running MCP server's open handle into a stale view. An
    // in-place wipe keeps the same file, so live connections see the fresh
    // index immediately.
    try {
      const { wipeProjectData } = await import("../ast/parallel-indexer")
      const raw = await BrainDatabase.getRawInstance(pid)
      wipeProjectData(raw)
      console.log(`wiped ${pid.slice(0, 8)} index in place (file kept)`)
    } catch (e: any) {
      console.error(`✗ wipe failed: ${e?.message}`)
    }
  }
  console.log(`indexing ${abs} (project ${pid.slice(0, 8)}…)`)
  const t = Date.now()
  const indexOpts: Parameters<typeof indexProjectParallel>[2] = { onProgress: (s) => {} }
  if (opts.skipPostProcessing) indexOpts.skipPostProcessing = true
  if (opts.file) {
    indexOpts.files = [opts.file]
    // M40.A5 (matrix row: "--file <p> → single-file reindex + scoped post-pass"):
    // incremental mode scopes the derived pass to this file. Unchanged files
    // still skip (the mtime/size check applies to overrides too) → honest
    // "skipped-unchanged".
    indexOpts.isIncremental = true
  }
  if (opts.changed) indexOpts.isIncremental = true
  // M23.P3: right after adoption the checkout is unchanged relative to the
  // adopted index (the move preserves mtimes), so top up incrementally instead
  // of re-parsing everything and duplicating symbol rows.
  if (adopted) indexOpts.isIncremental = true
  // M22.R1: resume from an interrupted run's checkpoint. The live status file
  // is the checkpoint: phase "indexing" (left behind if the process died) vs
  // "complete"/"failed". Resume always runs incremental (mtime/size skip the
  // already-indexed files, so strictly fewer files are processed than a fresh
  // run), and reports whether a checkpoint was actually found.
  if (opts.resume) {
    const { readLiveStatus } = await import("../ast/index-status")
    const ck = readLiveStatus(pid)
    const inProgress =
      !!ck &&
      (ck.phase === "indexing" || ck.phase === "cancelled") &&
      Date.now() - ck.updatedAt < 3_600_000
    if (inProgress) {
      console.log(`resuming interrupted index (checkpoint: ${ck.processedFiles}/${ck.totalFiles} files done)`)
    } else {
      console.log("no in-progress checkpoint; running incremental (only missing/changed files)")
    }
    indexOpts.isIncremental = true
  }
  // M22.V1: render a live single-line progress update on stderr (never stdout,
  // so stdout stays clean for any consuming process). Clears the line on the
  // terminal without disturbing the final summary on stdout.
  let lastProgressT = 0
  indexOpts.onProgress = (s: any) => {
      const now = Date.now()
      if (now - lastProgressT < 80) return
      lastProgressT = now
      const total = s.totalFiles > 0 ? s.totalFiles : s.processedFiles
      const pct =
        s.totalFiles > 0 ? Math.floor((s.processedFiles / s.totalFiles) * 100) : 0
      const fps = typeof s.filesPerSecond === "number" ? s.filesPerSecond.toFixed(1) : "?"
      const file = s.currentFile ?? ""
      const pw = process.stderr.isTTY ? `\r` : `\r[progress] `
      process.stderr.write(
        `${pw}${s.processedFiles}/${total} files (${pct}%) ${fps}/s ETA ${formatETA(s)} ${file ? `— ${file}` : ""}`,
      )
    }
  // M21.R3: cooperative cancellation — Ctrl+C stops the run gracefully instead
  // of killing the process mid-write. The abort signal makes the indexer stop
  // dispatching new batches and drain in-flight work; the live status file gets
  // phase "cancelled", so `bb index --resume` recognizes the checkpoint.
  const abort = new AbortController()
  const onSignal = (sig: string) => {
    if (abort.signal.aborted) return
    abort.abort()
    console.log(`\n${sig} received — cancelling index (draining in-flight files; resume with: bb index --resume)...`)
  }
  if (heldLock) indexOpts.lock = heldLock
  let stats
  try {
    process.once("SIGINT", () => onSignal("SIGINT"))
    process.once("SIGTERM", () => onSignal("SIGTERM"))
    indexOpts.signal = abort.signal
    stats = await indexProjectParallel(pid, abs, indexOpts)
  } catch (e: any) {
    process.removeAllListeners("SIGINT")
    process.removeAllListeners("SIGTERM")
    if (heldLock) await heldLock.release().catch(() => {})
    if (e instanceof IndexLockHeldError) {
      // M43.P1: another live process holds this project's index lock — refuse
      // loudly with the holder named, never interleave writes.
      console.error(`✗ ${e.message}`)
    } else {
      throw e
    }
    process.exitCode = 1
    return
  }
  process.removeAllListeners("SIGINT")
  process.removeAllListeners("SIGTERM")
  if (process.stderr.isTTY) process.stderr.write("\r\x1b[K")
  else process.stderr.write("\n")
  const secs = ((Date.now() - t) / 1000).toFixed(1)
  const db = await BrainDatabase.getRawInstance(pid)
  const files = (db.prepare("SELECT COUNT(*) c FROM brain_file").get() as any).c
  const symbols = (db.prepare("SELECT COUNT(*) c FROM brain_symbol").get() as any).c
  const rels = (db.prepare("SELECT COUNT(*) c FROM brain_relationship").get() as any).c
  const emb = (db.prepare("SELECT COUNT(*) c FROM brain_semantic_embedding").get() as any).c
  console.log(`✓ indexed ${files} files, ${symbols} symbols, ${rels} relationships, ${emb} embeddings in ${secs}s`)
  console.log(`  stats: ${JSON.stringify({ totalFiles: stats.totalFiles, processed: stats.processedFiles, errors: stats.errorFiles })}`)
  if (stats.cancelled) {
    console.log("⏸ index cancelled — progress saved. Resume with: bb index --resume")
  }
  if (stats.summary) {
    const s = stats.summary
    console.log(`  breakdown: ${s.newlyParsed} newly parsed | ${s.unchanged} unchanged | ${s.skipped} skipped | ${s.symbolLoss} symbol-loss (parsed 0 symbols) | ${s.errors} errors | ${s.timeouts} timeouts${s.cancelled ? ` | ${s.cancelled} cancelled` : ""}`)
    // The parse mode is part of the breakdown, because losing the worker pool is
    // a degradation a user can act on and nothing else on this line reveals it.
    // Measured by SIGKILLing workers mid-run: the fork test fails, the run falls
    // back to in-process parsing and indexes every file correctly — but takes
    // ~72s against a much faster pool-backed run, while every number above reads
    // pristine (`workerCount: 0, retries: 0, errors: 0, timeouts: 0`). It is the
    // same shape as the derived/consistency line: a real fact with no number.
    // A persisted run that predates this field has no parse mode, and a run
    // whose producer was removed has `undefined`. Neither is evidence that the
    // pool ran. Routing the unknown case into the pool branch made the line
    // assert "parsed with the worker pool (unknown)" — a claim the line had just
    // admitted it could not support. Say what is actually known instead.
    const parseMode = s.parseMode
    if (parseMode === "in-process") {
      console.log("  parsed in-process — the worker pool was unavailable, so this run was serial and is correspondingly slower")
    } else if (parseMode === "worker-pool") {
      console.log("  parsed with the worker pool")
    } else {
      console.log("  parsed: mode not recorded for this run (pre-dates the parseMode field)")
    }
    // M40.A2: honest derived-data reporting — never let a run imply its
    // relationships/enrichment/gravity/taints/health are current when they
    // were deferred.
    const derived = s.derivedPass ?? "deferred"
    // M40.A2's intent was "never let a run imply its relationships/enrichment/
    // gravity/taints/health are current when they were deferred". It could not be
    // kept, because `derivedPass` says WHICH pass ran and nothing said whether the
    // index ended up CONSISTENT — so the note for `skipped-unchanged` asserted
    // "untouched and consistent" on the strength of nothing.
    //
    // Measured, in the case a user actually meets: cancel a 60-file index
    // mid-run, then `bb index --resume`. The cancel interrupts relationship
    // resolution and leaves 16 relationships with `target_symbol_id IS NULL`.
    // The resume parses nothing, so its pass is `skipped-unchanged`; the
    // relationship COUNT recovers to the clean index's 180, so every count on
    // screen reads healthy; and those 16 edges are still unattached. Only
    // `bb index --post` resolves them.
    //
    // So the pass is reported as before, and CONSISTENCY is reported as a
    // measurement — a count taken from the store after the run, with the
    // remediation named when it is non-zero.
    const unresolved = Number(s.unresolvedRelationships ?? -1)
    const derivedNote: Record<string, string> = {
      full: "derived data fully re-processed",
      bounded: "derived data re-processed for touched files (bounded pass)",
      deferred: "derived data deferred — run: bb index --post",
      "skipped-unchanged": "no files parsed, so no derived pass ran",
    }
    console.log(`  derived: ${derived} (${derivedNote[derived] ?? derived})`)
    if (unresolved === 0) {
      console.log("  consistency: 0 unresolved relationships — every stored relationship is attached to a symbol")
    } else if (unresolved > 0) {
      // Present as rows, absent as edges: traversal reads these as missing, so
      // they UNDER-report, and the relationship count does not show it.
      console.log(
        `  consistency: ${unresolved} relationship(s) are not attached to a symbol — they are counted above but read as edges by no traversal. Run: bb index --post`,
      )
    } else {
      // The count is absent (a run persisted before this measurement existed).
      // Printing NOTHING here is a real gap, not a neutral one: "no line" and
      // "checked, nothing found" look identical on a terminal, so a reader takes
      // the absence as the all-clear. Name the check as not run.
      console.log("  consistency: not measured for this run (pre-dates the unresolved-relationship count)")
    }
    if (stats.m40Bounded) {
      const b = stats.m40Bounded
      const parts = [`${b.touchedSymbols} symbols touched`]
      if (b.repairedInEdges > 0) parts.push(`${b.repairedInEdges} cross-file edges restored`)
      if (b.purgedDeletedFiles > 0) parts.push(`${b.purgedDeletedFiles} deleted files purged`)
      console.log(`  bounded: ${parts.join(" | ")}`)
    }
  }
  if (heldLock) await heldLock.release().catch(() => {})
}

async function cmdSearch(query: string, opts: { dir?: string; limit?: number; language?: string; mode?: string; filePath?: string; symbolName?: string; noAutoRefresh?: boolean }) {
  const dir = opts.dir ? requireDir(opts.dir) : process.cwd()
  const pid = getProjectId(dir)
  const dbPath = BrainDatabase.getDbPath(pid)
  if (!existsSync(dbPath)) {
    console.error(`✗ no index for ${dir}. Run: bb index "${dir}"`)
    process.exit(1)
  }
  // M40.A7: --mode routes through the REAL bb_search MCP handler (same code
  // path, same freshness envelope) — CLI/MCP parity by construction. Default
  // mode keeps the original symbols text rendering.
  // M40.A9/A7 negative-case fix: an UNKNOWN --mode value must be rejected —
  // silently falling back to the default listing hid the user's intent and
  // broke CLI/MCP surface parity.
  // M48.C1 (#699) surface-truth fix: `symbols` was rejected here while the
  // CLI's own --help and the MCP registry/docs advertise it as a mode (the
  // registry example literally calls mode:"symbols"). The advertised enum
  // value must work on BOTH doors: --mode symbols == the default listing.
  const KNOWN_MODES = new Set(["symbols", "content", "symbol", "file"])
  if (opts.mode !== undefined && !KNOWN_MODES.has(opts.mode)) {
    console.error(`✗ unknown search mode "${opts.mode}" (known: symbols, content, symbol, file)`)
    process.exit(1)
  }
  const mode = opts.mode ?? "symbols"
  if (mode !== "symbols") {
    const { createToolHandlers } = await import("../mcp/tool-handlers")
    const handler = createToolHandlers()["bb_search"]
    // M43.A2 (#658): content/symbol modes route through the bb_search MCP
    // handler (M40.A7 parity), which since A1 auto-refreshes stale files
    // within budget — --no-auto-refresh maps to the handler's refresh=false.
    const args: any = mode === "file"
      ? { mode: "file", filePath: opts.filePath ?? query }
      : mode === "symbol"
        ? { mode: "symbol", symbolName: opts.symbolName ?? query, filePath: undefined, ...(opts.noAutoRefresh ? { refresh: false } : {}) }
        : { mode: "content", query, limit: opts.limit ?? 15, language: opts.language, ...(opts.noAutoRefresh ? { refresh: false } : {}) }
    const res = await handler(args, { projectId: pid, projectPath: dir })
    if (res.isError) {
      console.error(res.content.map((c: any) => c.text).join("\n"))
      process.exitCode = 1
      return
    }
    const parsed = JSON.parse(res.content[0].text)
    if (mode === "content") {
      for (const r of parsed.results ?? []) {
        const stale = r.stale ? " ⚠stale" : ""
        console.log(`  ${path.posix.basename(String(r.fileId ?? r.file ?? ""))}:${r.line ?? "?"} — ${String(r.snippet ?? r.text ?? "").split("\n")[0].slice(0, 120)}${stale}`)
      }
      const env = parsed.freshness ?? {}
      console.log(`\n${parsed.total} results${parsed.staleCount ? ` (${parsed.staleCount} stale)` : ""}${env.stale != null ? ` | freshness: ${env.fresh} fresh / ${env.stale} stale / ${env.missing} missing` : ""}${parsed.staleCount ? ` — ${FRESHNESS_REMEDIATION.dir}` : ""}`)
    } else if (mode === "symbol") {
      for (const m of parsed.matches ?? []) {
        const stale = m.stale ? " ⚠stale" : ""
        console.log(`  ${m.name} [${m.type}] (${m.language ?? ""}, ${m.fileId ?? m.file ?? ""}:${m.line ?? "?"})${stale}`)
      }
      const env = parsed.freshness ?? {}
      if (env.stale != null) console.log(`\nfreshness: ${env.fresh} fresh / ${env.stale} stale / ${env.missing} missing — ${env.remediation ?? ""}`)
      if ((parsed.matches ?? []).length === 0) console.log(`no results for "${opts.symbolName ?? query}"`)
    } else {
      console.log(`${parsed.file} (${parsed.language})${parsed.truncated ? " [truncated]" : ""}${parsed.stale ? " ⚠stale" : ""}\n\n${parsed.content}`)
      const env = parsed.freshness ?? {}
      if (env.stale != null) console.log(`\nfreshness: ${env.fresh} fresh / ${env.stale} stale / ${env.missing} missing — ${env.remediation ?? ""}`)
    }
    // M43.A1/A2: the handler declares its inline repair decision on the
    // answer — surface it ("auto-refreshed N files in Xms" or the honest
    // decline with its reason).
    if (typeof parsed.autoRefresh === "string" && parsed.autoRefresh.length) console.log(parsed.autoRefresh)
    return
  }
  // M43.A2 (#658): rerunnable pass sharing the A1 core — when the first pass
  // finds stale files within budget the CLI repairs exactly those files and
  // runs the search AGAIN so the answer reflects the repair, declaring it.
  // Fresh pass ⇒ one pass, zero added cost, byte-identical output.
  const runPass = async () => {
    const results: any = await BrainTools.searchCode(pid, query, {
      maxResults: opts.limit ?? 15,
      languages: opts.language ? [opts.language] : undefined,
    })
    const lines: string[] = []
    for (const r of results) {
      const stale = r.stale ? " ⚠stale" : ""
      lines.push(`  ${r.symbolName} [${r.symbolType}] (${r.language}, ${r.file}:${r.line})${stale}`)
    }
    return { results, lines }
  }
  const pass1 = await runPass()
  if (pass1.results.length === 0) {
    console.log(`no results for "${query}"`)
    return
  }
  let footer = `\n${pass1.results.length} results${pass1.results.staleCount ? ` (${pass1.results.staleCount} stale — ${FRESHNESS_REMEDIATION.dir})` : ""}`
  let decision: string | null = null
  // searchSymbols already resolved staleness internally — only when it found
  // staleness do we resolve the row map ourselves (no extra stat cost on the
  // fresh path) to build the repair set.
  if ((pass1.results.staleCount ?? 0) > 0 && !opts.noAutoRefresh) {
    const raw = await BrainDatabase.getRawInstance(pid)
    const rows = pass1.results.map((r: any) => ({ fileId: r.fileId }))
    const detail = resolveRowsFreshnessDetailed(raw, pid, rows)
    const staleFiles = collectStaleFiles(raw, rows, detail.statuses)
    if (staleFiles.length > 0) {
      const d = await maybeAutoRefresh(pid, dir, staleFiles, { perCallOptOut: false })
      if (d.action === "refreshed") {
        const pass2 = await runPass()
        decision = autoRefreshLine(d)
        for (const line of pass2.lines) console.log(line)
        if (pass2.results.length === 0) console.log(`no results for "${query}"`)
        else console.log(`\n${pass2.results.length} results`)
        console.log(decision)
        return
      }
      if (d.action === "declined") decision = autoRefreshLine(d)
    }
  }
  for (const line of pass1.lines) console.log(line)
  console.log(footer)
  // M43.A2: the honest decline (budget / disabled / indexer-active) is
  // printed with the stale answer — never silently stale.
  if (decision && !footer.includes(decision)) console.log(decision)
}

async function cmdStats(dir: string | undefined) {
  // M22.V4: query committed index counts anytime, independent of any run state.
  const abs = dir ? requireDir(dir) : process.cwd()
  const pid = getProjectId(abs)
  const { composeStatus } = await import("../ast/index-status")
  const s = await composeStatus(pid)
  if (!s.hasIndex) {
    console.log(`no index for ${abs}. Run: bb index "${abs}"`)
    return
  }
  let embeddings = 0
  try {
    const r = await BrainDatabase.getRawInstance(pid)
    embeddings = (r.prepare("SELECT COUNT(*) c FROM brain_semantic_embedding").get() as any)?.c ?? 0
  } catch {}
  console.log(`index stats for ${abs}:`)
  console.log(`  files ${s.dbStats.files} | symbols ${s.dbStats.symbols} | relationships ${s.dbStats.relationships} | embeddings ${embeddings}`)
  // M23.P1: always show where this index lives so users can find/reclaim it.
  console.log(`  db: ${BrainDatabase.getDbPath(pid)}`)
}

async function cmdProjects(opts: { sort?: string; remove?: string; force?: boolean }) {
  // M23.P1/P2: registry of every indexed project with DB path + size, and
  // safe removal. Ground truth: without this, users can't see what's indexed,
  // where the DB lives, or reclaim disk (e.g. 1,178 dirs / 16 GB on this box).
  const { listProjects, removeProject, totalProjectsBytes } = await import("../ast/project-registry")
  if (opts.remove) {
    const r = removeProject(opts.remove, opts.force === true)
    if (r.removed) console.log(`removed project ${opts.remove.slice(0, 8)} (index reclaimed)`)
    else console.error(`✗ ${r.reason}`)
    process.exitCode = r.removed ? 0 : 1
    return
  }
  const projects = listProjects()
  if (projects.length === 0) {
    console.log("no indexed projects")
    return
  }
  const sort = opts.sort ?? "name"
  projects.sort((a, b) => (sort === "size" ? b.dbSizeBytes - a.dbSizeBytes : sort === "time" ? (b.lastIndexed ?? 0) - (a.lastIndexed ?? 0) : a.id.localeCompare(b.id)))
  const mb = (b: number) => `${(b / 1024 / 1024).toFixed(1)}MB`
  const when = (t: number | null) => (t ? new Date(t).toISOString().slice(0, 10) : "n/a")
  for (const p of projects) {
    const where = p.humanPath ?? "(no path recorded)"
    console.log(`${p.id.slice(0, 8)} | ${p.files} files ${p.symbols} syms | ${mb(p.dbSizeBytes)} | idx ${when(p.lastIndexed)} | ${p.status ?? ""} | ${where} | db: ${p.dbPath}`)
  }
  console.log(`\n${projects.length} projects, ${mb(totalProjectsBytes(projects))} total index size (${bbProjectsDir()})`)
}

async function cmdStatus(dir: string | undefined) {
  // M22.V2: `bb status [<dir>]` — in-flight + last-run index state from any shell.
  const abs = dir ? requireDir(dir) : process.cwd()
  const pid = getProjectId(abs)
  const { composeStatus } = await import("../ast/index-status")
  const s = await composeStatus(pid)
  if (!s.hasIndex) {
    console.log(`no index for ${abs}. Run: bb index "${abs}"`)
    return
  }
  const ms = (v?: number) => (typeof v === "number" ? `${v}ms` : "n/a")
  if (s.isRunning && s.live) {
    const l = s.live
    const total = l.totalFiles > 0 ? l.totalFiles : l.processedFiles
    const pct = l.totalFiles > 0 ? Math.floor((l.processedFiles / l.totalFiles) * 100) : 0
    const elapsed = ((Date.now() - l.startedAt) / 1000).toFixed(0)
    console.log(`▶ indexing ${abs}: ${l.processedFiles}/${total} files (${pct}%) in ${elapsed}s${typeof l.filesPerSecond === "number" ? ` @ ${l.filesPerSecond.toFixed(1)} files/s` : ""}${l.currentFile ? ` — ${l.currentFile}` : ""}`)
    console.log(`  phase: ${l.phase}`)
  } else if (s.lastRun) {
    const r = s.lastRun
    console.log(`✓ last index of ${abs}: ${s.dbStats.files} files, ${s.dbStats.symbols} symbols, ${s.dbStats.relationships} relationships`)
    const t = r.phaseTimings ?? {}
    console.log(`  total ${ms(t.totalWallMs)} | parse ${ms(t.parseMs)} | dbFlush ${ms(t.dbFlushMs)} | discovery ${ms(t.discoveryMs)} | startup ${ms(t.workerStartupMs)}`)
    if (Array.isArray(r.postProcessing) && r.postProcessing.length) {
      console.log(`  post-processing: ${r.postProcessing.map((p: any) => `${p.phase ? p.phase : "?"}=${ms(p.ms)}`).join(", ")}`)
    }
    console.log(`  mode ${r.mode ?? "n/a"} | workers ${r.workerCount ?? "n/a"} | noop ${r.noop ? "yes" : "no"}`)
  } else {
    console.log(`index meta: ${s.dbStats.files} files, ${s.dbStats.symbols} symbols, ${s.dbStats.relationships} relationships (no recent run)`)
  }
  // M23.P1: always show where this index lives so users can find/reclaim it.
  console.log(`  db: ${BrainDatabase.getDbPath(pid)}`)
}

async function cmdHealth(dir: string | undefined, opts: { refresh?: boolean; force?: boolean; wait?: boolean; complete?: boolean; integrity?: boolean; sampleSize?: number; verboseConfig?: boolean }) {
  const abs = dir ? requireDir(dir) : process.cwd()
  const pid = getProjectId(abs)
  const dbPath = BrainDatabase.getDbPath(pid)
  if (!existsSync(dbPath)) {
    console.error(`✗ no index for ${abs}. Run: bb index "${abs}"`)
    process.exit(1)
  }
  const report = await getUnifiedHealth(pid, abs, {
    refresh: opts.refresh === true || opts.force === true,
    force: opts.force === true,
    wait: opts.wait !== false,
    freshness: opts.complete === true ? "complete" : "sampled",
    sampleSize: opts.sampleSize,
    integrity: opts.integrity === true,
    verbose: opts.verboseConfig === true,
  })
  console.log(formatUnifiedHealth(report))
  if (report.warnings.some((w) => w.severity === "error")) process.exitCode = 1
}

async function cmdTool(name: string, opts: { dir?: string; args?: string }): Promise<void> {
  const projectPath = opts.dir ? requireDir(opts.dir) : process.cwd()
  const { PUBLIC_TOOL_DESCRIPTORS } = await import("../mcp/tool-registry")
  const { validateToolArguments } = await import("../mcp/tool-validation")
  const { createToolHandlers } = await import("../mcp/tool-handlers")
  const descriptor = PUBLIC_TOOL_DESCRIPTORS.find((tool) => tool.name === name)
  if (!descriptor) throw new Error(`unknown public tool ${name}; expected: ${PUBLIC_TOOL_DESCRIPTORS.map((tool) => tool.name).join(", ")}`)
  let args: Record<string, unknown> = {}
  try { args = opts.args ? JSON.parse(opts.args) : {} } catch { throw new Error("--args must be a JSON object") }
  if (!args || Array.isArray(args) || typeof args !== "object") throw new Error("--args must be a JSON object")
  const validated = validateToolArguments(descriptor, args)
  const handler = createToolHandlers()[name]
  const result = await handler(validated, { projectPath, projectId: getProjectId(projectPath) })
  console.log(result.content.map((item) => item.text).join("\n"))
  if (result.isError) process.exitCode = 1
}



export async function runCli(argv: string[]): Promise<void> {
  const program = new Command()
  program
    .name("bb")
    .description("Backbencher Brain — universal code intelligence (40+ languages)")
    // M33.S1: parity across all three version forms (-V was the only form before).
    .version(BACKBENCHER_BRAIN_VERSION, "-v, --version", "output the version number")
    // M22.W1: one logging story. Workers inherit BB_LOG_LEVEL from the parent
    // (pool-worker.ts only defaults to "error" when the parent sets nothing).
    .option("--verbose", "show diagnostics (debug logs, per-file worker/WASM lines)")
    .option("--quiet", "suppress informational output (warnings/errors only)")
    .hook("preAction", (thisCommand) => {
      // M22.W1: one logging story. Apply the level to this process's logger
      // immediately and publish it through the environment so forked pool
      // workers (which inherit the parent env) honor the same level instead
      // of their hardcoded "error" default.
      const opts = thisCommand.opts()
      if (opts.verbose) {
        process.env.BB_LOG_LEVEL = "debug"
        setLogLevel(LogLevel.DEBUG)
      } else if (opts.quiet) {
        process.env.BB_LOG_LEVEL = "warn"
        setLogLevel(LogLevel.WARN)
      }
    })

  // M33.S2: unknown commands and options get did-you-mean suggestions (commander
  // default) plus an explicit pointer to the help surface instead of a dead end.
  program.showSuggestionAfterError(true)
  program.showHelpAfterError("(run 'bb --help' for a list of commands)")

  program
    .command("tool")
    .description("run one of the public tools with JSON arguments")
    .argument("<name>", "public tool name, e.g. bb_search or bb_doc")
    .option("--dir <dir>", "project directory (default: cwd)")
    .option("--args <json>", "tool arguments as a JSON object", "{}")
    .action(async (name: string, opts: any) => { await cmdTool(name, opts) })

  program
    .command("index")
    .description("index a project (default: current directory)")
    .argument("[dir]", "project directory (default: current directory)")
    .option("--force", "wipe the existing index and rebuild")
    .option("--no-setup", "skip the first-run embedding setup prompt")
    .option("--skip-post-processing", "parse + store only; SKIP relationship resolution/enrichment/gravity/taint/health (derived data goes stale until: bb index --post)")
    .option("--post", "re-run relationship/enrichment/gravity/taint/health phases only — no re-parse (remediation for stale derived data after --changed/--resume/agent edits)")
    .option("--file <path>", "reindex a single file's symbols + relationships (runs a scoped derived-data pass for that file)")
    .option("--changed", "reindex only files changed since the last index (runs the bounded derived-data pass for touched files — relationships stay current)")
    .option("--resume", "continue from an interrupted run's checkpoint (incremental: only missing/changed files; runs the bounded derived-data pass)")
    .option("--import <db>", "adopt an existing brain.db file (re-home a moved project's index)")
    .addHelpText("after", `
Examples:
  $ bb index                 # index the current directory
  $ bb index ../my-project   # index another directory
  $ bb index --changed       # reindex only changed files
  $ bb index --file src/a.ts # reindex a single file
  $ bb index --force         # wipe and rebuild in place
  $ bb index import --db <path>  # adopt an existing DB for a moved project
`)
    .action(async (dir: string | undefined, opts: any) => {
      await cmdIndex(dir, opts)
    })

  const setupCmd = program
    .command("setup")
    .description("embedding provider setup (API key, model)")
  setupCmd
    .action(async () => {
      const { runSetupWizard } = await import("../setup/setup-wizard")
      if (!process.stdin.isTTY) {
        console.error("✗ bb setup requires an interactive terminal.")
        process.exit(1)
      }
      await runSetupWizard()
    })
  setupCmd
    .command("show")
    .description("show the embedding configuration (key as fingerprint only)")
    .action(async () => {
      const { describeEmbeddingConfig, renderSetupShow } = await import("../setup/setup-show")
      const state = describeEmbeddingConfig()
      console.log(renderSetupShow(state))
      if (!state.configured) process.exitCode = 1
    })

  program
    .command("doctor")
    .description("diagnose embedding setup and index consistency (read-only)")
    .option("--dir <dir>", "project directory (default: cwd)")
    .option("--fix", "repair permission problems (0600 only; this IS the explicit apply — without it doctor is read-only)")
    .action(async (opts: any) => {
      const { runDoctorChecks, renderDoctorReport, applyDoctorFixes, renderFixPlan } = await import("../setup/doctor")
      const cwd = opts.dir ? requireDir(opts.dir) : process.cwd()
      if (opts.fix) {
        const { plan, applied } = applyDoctorFixes({ cwd, apply: true })
        console.log(renderFixPlan(plan, applied))
        if (plan.refusals.length > 0) process.exitCode = 1
        return
      }
      const report = runDoctorChecks({ cwd, projectId: getProjectId(cwd) })
      console.log(renderDoctorReport(report))
      if (!report.healthy) process.exitCode = 1
    })

  program
    .command("stats")
    .description("query index counts anytime: files/symbols/relationships/embeddings (default: cwd)")
    .argument("[dir]", "project directory (default: current directory)")
    .action(async (dir: string | undefined) => {
      await cmdStats(dir)
    })

  program
    .command("status")
    .description("show in-flight/last-run index state and per-phase timings (default: cwd)")
    .argument("[dir]", "project directory (default: current directory)")
    .action(async (dir: string | undefined) => {
      await cmdStatus(dir)
    })

  program
    .command("projects")
    .description("list every indexed project: DB path, size, counts, last index (default: all projects)")
    .option("--sort <field>", "sort by name|size|time", "name")
    .option("--remove <id>", "remove one indexed project by id (reclaims its DB + embeddings)")
    .option("--force", "remove even if that project is currently being indexed")
    .addHelpText("after", `
Examples:
  $ bb projects                # list all indexed projects with DB path + size
  $ bb projects --sort size    # biggest indexes first
  $ bb projects --remove 1a2b3c4d   # reclaim that project's index space
`)
    .action(async (opts: any) => {
      await cmdProjects(opts)
    })

  program
    .command("search")
    .description("search the index (modes: symbols [default], content, symbol, file — parity with the MCP bb_search tool)")
    .argument("<query>", "query text; in file mode, the file path to print")
    .option("--mode <mode>", "retrieval mode: symbols (default), content, symbol, or file")
    .option("--file-path <path>", "file target for --mode file (overrides the positional query)")
    .option("--symbol-name <name>", "exact symbol name for --mode symbol (overrides the positional query)")
    .option("--dir <dir>", "project directory (default: cwd)")
    .option("--limit <n>", "max results", "15")
    .option("--language <lang>", "filter by language")
    // M43.A2 (#658): the CLI read path auto-refreshes stale files within
    // budget before answering (same decision as the MCP bb_search tool);
    // --no-auto-refresh answers from existing data with the staleness footer.
    .option("--no-auto-refresh", "answer from the existing index with the staleness footer instead of auto-refreshing stale files within budget")
    .addHelpText("after", `\nExamples:\n  $ bb search handleRequest                 # symbol listing (default)\n  $ bb search --mode content "findUser("    # content matches with snippets\n  $ bb search --mode symbol --symbol-name handleRequest\n  $ bb search --mode file src/app.ts        # print an indexed file's content\n  $ bb search --no-auto-refresh query      # never auto-refresh on read\n`)
    .action(async (query: string, opts: any) => {
      // Commander negation: `--no-auto-refresh` sets opts.autoRefresh = false
      // (default true); translate to the option cmdSearch reads.
      await cmdSearch(query, { ...opts, noAutoRefresh: opts.autoRefresh === false, limit: parseInt(opts.limit, 10) })
    })

  program
    .command("health")
    .description("index health and freshness")
    .argument("[dir]", "project directory (default: cwd)")
    .option("--refresh", "reindex the project before reporting")
    .option("--force", "force a full in-place reindex (implies --refresh)")
    .option("--no-wait", "do not wait for the refresh to finish")
    .option("--complete", "check freshness for all files (not just a sample)")
    .option("--integrity", "run the 12-point index integrity check")
    .option("--sample-size <n>", "freshness sample size (default: 200)", "200")
    .option("--verbose-config", "show effective embedding config + per-field source (M40.A8)")
    .action(async (dir: string | undefined, opts: any) => {
      await cmdHealth(dir, { ...opts, sampleSize: parseInt(opts.sampleSize, 10) })
    })

  // M50.A3 (#765): guidance an agent host can read on every turn. Generated
  // from the tool registry, so it can never name a tool that does not exist.
  program
    .command("onboard")
    .description("write the bb tools guidance section into <dir>/AGENTS.md (generated from the tool registry)")
    .argument("[dir]", "project directory (default: current directory)")
    .option("--check", "report drift/ghost tool names without writing (exit 1 when not current)")
    .option("--print", "print the generated section to stdout without writing")
    .option("--file <path>", "guide file to write (default: <dir>/AGENTS.md)")
    .addHelpText("after", `
Examples:
  $ bb onboard                # write/refresh AGENTS.md in the current project
  $ bb onboard ../my-project  # same for another directory
  $ bb onboard --check        # CI: fail when the guidance drifted or names a ghost tool
  $ bb onboard --print        # show the generated section
`)
    .action(async (dir: string | undefined, opts: any) => {
      const { onboard, renderOnboardResult } = await import("./onboard")
      const abs = dir ? requireDir(dir) : process.cwd()
      const result = onboard(abs, { check: opts.check === true, print: opts.print === true, file: opts.file })
      console.log(renderOnboardResult(result))
      if (opts.check === true && result.changed) process.exitCode = 1
    })

  program
    .command("mcp")
    .description("start the MCP server over stdio (for Claude Code, Cursor, VS Code…)")
    .option("--dir <dir>", "default project directory (default: cwd)")
    .action(async (opts: any) => {
      const { startMcpServer } = await import("../mcp/server")
      await startMcpServer(opts.dir ? requireDir(opts.dir) : process.cwd())
    })

  // M33.S1: `bb version` subcommand — the documented form (see header comment)
  // that did not exist until now.
  program
    .command("version")
    .description("print the bb version")
    .action(() => {
      console.log(BACKBENCHER_BRAIN_VERSION)
    })

  await program.parseAsync(argv, { from: "user" })
}

// M23.P3: allow running the CLI module directly (bun src/cli/index.ts <args>).
// Without this entry the module only defines runCli, so direct invocation is a
// silent no-op — a real trap for scripts and verifiers.
if (import.meta.main) {
  try {
    await runCli(process.argv.slice(2))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`error: ${message}`)
    process.exitCode = 1
  }
}