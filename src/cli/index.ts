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

async function cmdIndex(dir: string | undefined, opts: { force?: boolean; skipPostProcessing?: boolean; file?: string; changed?: boolean }) {
  // M22.C1: default `<dir>` to the current directory like every other command
  // (search/health/mcp all fall back to process.cwd()); `cd proj && bb index`
  // must index the project you are standing in.
  const abs = dir ? requireDir(dir) : process.cwd()
  const pid = getProjectId(abs)
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
  const indexOpts: { onProgress: (s: any) => void; skipPostProcessing?: boolean; files?: string[]; isIncremental?: boolean } = { onProgress: (s) => {} }
  if (opts.skipPostProcessing) indexOpts.skipPostProcessing = true
  if (opts.file) indexOpts.files = [opts.file]
  if (opts.changed) indexOpts.isIncremental = true
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
  const stats = await indexProjectParallel(pid, abs, indexOpts)
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
  if (stats.summary) {
    const s = stats.summary
    console.log(`  breakdown: ${s.newlyParsed} newly parsed | ${s.unchanged} unchanged | ${s.skipped} skipped | ${s.symbolLoss} symbol-loss (parsed 0 symbols) | ${s.errors} errors | ${s.timeouts} timeouts`)
  }
}

async function cmdSearch(query: string, opts: { dir?: string; limit?: number; language?: string }) {
  const dir = opts.dir ? requireDir(opts.dir) : process.cwd()
  const pid = getProjectId(dir)
  const dbPath = BrainDatabase.getDbPath(pid)
  if (!existsSync(dbPath)) {
    console.error(`✗ no index for ${dir}. Run: bb index "${dir}"`)
    process.exit(1)
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
  console.log(`\n${results.length} results${results.staleCount ? ` (${results.staleCount} stale — run bb index --force)` : ""}`)
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
}

async function cmdHealth(dir: string | undefined, opts: { refresh?: boolean; force?: boolean; wait?: boolean; complete?: boolean; integrity?: boolean; sampleSize?: number }) {
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
    .version(BACKBENCHER_BRAIN_VERSION)
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

  // M22 e2e: the header docs (and users) expect `bb version` as a command,
  // not only the --version flag.
  program
    .command("version")
    .description("print the bb version")
    .action(() => {
      console.log(BACKBENCHER_BRAIN_VERSION)
    })

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
    .option("--skip-post-processing", "parse + store only; defer relationship resolution/enrichment/gravity/taint/health")
    .option("--file <path>", "reindex a single file's symbols + relationships")
    .option("--changed", "reindex only files changed since the last index")
    .addHelpText("after", `
Examples:
  $ bb index                 # index the current directory
  $ bb index ../my-project   # index another directory
  $ bb index --changed       # reindex only changed files
  $ bb index --file src/a.ts # reindex a single file
  $ bb index --force         # wipe and rebuild in place
`)
    .action(async (dir: string | undefined, opts: any) => {
      await cmdIndex(dir, opts)
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
    .command("search")
    .description("search the index")
    .argument("<query>", "symbol name or fragment")
    .option("--dir <dir>", "project directory (default: cwd)")
    .option("--limit <n>", "max results", "15")
    .option("--language <lang>", "filter by language")
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

  await program.parseAsync(argv, { from: "user" })
}
