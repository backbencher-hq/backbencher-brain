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

async function cmdIndex(dir: string, opts: { force?: boolean }) {
  const abs = requireDir(dir)
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
  const stats = await indexProjectParallel(pid, abs, {})
  const secs = ((Date.now() - t) / 1000).toFixed(1)
  const db = await BrainDatabase.getRawInstance(pid)
  const files = (db.prepare("SELECT COUNT(*) c FROM brain_file").get() as any).c
  const symbols = (db.prepare("SELECT COUNT(*) c FROM brain_symbol").get() as any).c
  const rels = (db.prepare("SELECT COUNT(*) c FROM brain_relationship").get() as any).c
  const emb = (db.prepare("SELECT COUNT(*) c FROM brain_semantic_embedding").get() as any).c
  console.log(`✓ indexed ${files} files, ${symbols} symbols, ${rels} relationships, ${emb} embeddings in ${secs}s`)
  console.log(`  stats: ${JSON.stringify({ totalFiles: stats.totalFiles, processed: stats.processedFiles, errors: stats.errorFiles })}`)
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
  program.name("bb").description("Backbencher Brain — universal code intelligence (40+ languages)")
  program.version(BACKBENCHER_BRAIN_VERSION)

  program
    .command("tool")
    .description("run one of the 10 public tools with JSON arguments")
    .argument("<name>", "public tool name, e.g. bb_search or bb_doc")
    .option("--dir <dir>", "project directory (default: cwd)")
    .option("--args <json>", "tool arguments as a JSON object", "{}")
    .action(async (name: string, opts: any) => { await cmdTool(name, opts) })

  program
    .command("index")
    .description("index a project")
    .argument("<dir>", "project directory")
    .option("--force", "wipe the existing index and rebuild")
    .action(async (dir: string, opts: any) => {
      await cmdIndex(dir, opts)
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
