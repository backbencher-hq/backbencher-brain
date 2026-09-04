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
import { BrainTools } from "../ast/tools"
import { BACKBENCHER_BRAIN_VERSION } from "../version"
import { getUnifiedHealth, formatUnifiedHealth } from "../intelligence/health/health-provider"
import { bbProjectsDir } from "../util/bb-data-dir"
import { LogLevel, setLogLevel } from "../util/log"
import { computeCheckoutFingerprint, readStoredFingerprint } from "../ast/fingerprint"
import { FRESHNESS_REMEDIATION } from "../brain/freshness"

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
  if (opts.force) {
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
  process.once("SIGINT", () => onSignal("SIGINT"))
  process.once("SIGTERM", () => onSignal("SIGTERM"))
  indexOpts.signal = abort.signal
  const stats = await indexProjectParallel(pid, abs, indexOpts)
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
    // M40.A2: honest derived-data reporting — never let a run imply its
    // relationships/enrichment/gravity/taints/health are current when they
    // were deferred.
    const derived = s.derivedPass ?? "deferred"
    const derivedNote: Record<string, string> = {
      full: "derived data fully re-processed",
      bounded: "derived data re-processed for touched files (bounded pass)",
      deferred: "derived data deferred — run: bb index --post",
      "skipped-unchanged": "no files changed — derived data untouched and consistent",
    }
    console.log(`  derived: ${derived} (${derivedNote[derived] ?? derived})`)
    if (stats.m40Bounded) {
      const b = stats.m40Bounded
      const parts = [`${b.touchedSymbols} symbols touched`]
      if (b.repairedInEdges > 0) parts.push(`${b.repairedInEdges} cross-file edges restored`)
      if (b.purgedDeletedFiles > 0) parts.push(`${b.purgedDeletedFiles} deleted files purged`)
      console.log(`  bounded: ${parts.join(" | ")}`)
    }
  }
}

async function cmdSearch(query: string, opts: { dir?: string; limit?: number; language?: string; mode?: string; filePath?: string; symbolName?: string }) {
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
  const mode = opts.mode === "content" || opts.mode === "symbol" || opts.mode === "file" ? opts.mode : "symbols"
  if (mode !== "symbols") {
    const { createToolHandlers } = await import("../mcp/tool-handlers")
    const handler = createToolHandlers()["bb_search"]
    const args: any = mode === "file"
      ? { mode: "file", filePath: opts.filePath ?? query }
      : mode === "symbol"
        ? { mode: "symbol", symbolName: opts.symbolName ?? query, filePath: undefined }
        : { mode: "content", query, limit: opts.limit ?? 15, language: opts.language }
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
    return
  }
  const results: any = await BrainTools.searchCode(pid, query, {
    maxResults: opts.limit ?? 15,
    languages: opts.language ? [opts.language] : undefined,
  })
  if (results.length === 0) {
    console.log(`no results for "${query}"`)
    return
  }
  const raw = await BrainDatabase.getRawInstance(pid)
  for (const r of results) {
    const stale = r.stale ? " ⚠stale" : ""
    console.log(`  ${r.symbolName} [${r.symbolType}] (${r.language}, ${r.file}:${r.line})${stale}`)
  }
  console.log(`\n${results.length} results${results.staleCount ? ` (${results.staleCount} stale — ${FRESHNESS_REMEDIATION.dir})` : ""}`)
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
    .description("run one of the 10 public tools with JSON arguments")
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
    .addHelpText("after", `\nExamples:\n  $ bb search handleRequest                 # symbol listing (default)\n  $ bb search --mode content "findUser("    # content matches with snippets\n  $ bb search --mode symbol --symbol-name handleRequest\n  $ bb search --mode file src/app.ts        # print an indexed file's content\n`)
    .action(async (query: string, opts: any) => {
      await cmdSearch(query, { ...opts, limit: parseInt(opts.limit, 10) })
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