// Universal bb CLI on brain-core. Works under Bun and Node.
//   bb index <dir> [--force]
//   bb search <query> [--dir DIR] [--limit N] [--language LANG]
//   bb health [--dir DIR]
//   bb mcp [--dir DIR]
//   bb version
import { Command } from "commander"
import { createHash } from "crypto"
import { existsSync, statSync } from "fs"
import path from "path"
import { BrainDatabase } from "../brain/database"
import { indexProjectParallel } from "../ast/parallel-indexer"
import { BrainTools } from "../ast/tools"
import { checkResultsFreshness } from "../brain/freshness"

export function getProjectId(projectPath: string): string {
  return createHash("sha1").update(path.resolve(projectPath)).digest("hex").substring(0, 40)
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

async function cmdHealth(dir?: string) {
  const abs = dir ? requireDir(dir) : process.cwd()
  const pid = getProjectId(abs)
  const dbPath = BrainDatabase.getDbPath(pid)
  if (!existsSync(dbPath)) {
    console.error(`✗ no index for ${abs}. Run: bb index "${abs}"`)
    process.exit(1)
  }
  const raw = await BrainDatabase.getRawInstance(pid)
  const files = (raw.prepare("SELECT COUNT(*) c FROM brain_file").get() as any).c
  const symbols = (raw.prepare("SELECT COUNT(*) c FROM brain_symbol").get() as any).c
  const rels = (raw.prepare("SELECT COUNT(*) c FROM brain_relationship").get() as any).c
  const emb = (raw.prepare("SELECT COUNT(*) c FROM brain_semantic_embedding").get() as any).c
  // freshness sample: check up to 200 files
  const fileRows = raw.prepare("SELECT id FROM brain_file LIMIT 200").all() as any[]
  const freshness = checkResultsFreshness(raw, fileRows.map((r: any) => ({ fileId: r.id })))
  let fresh = 0
  let stale = 0
  let missing = 0
  for (const s of freshness.values()) {
    if (s === "fresh") fresh++
    else if (s === "stale") stale++
    else missing++
  }
  console.log(`project:   ${abs}`)
  console.log(`projectId: ${pid}`)
  console.log(`files:     ${files}`)
  console.log(`symbols:   ${symbols}`)
  console.log(`relations: ${rels}`)
  console.log(`embeddings:${emb}`)
  console.log(`freshness: ${fresh} fresh / ${stale} stale / ${missing} missing (of ${fileRows.length} sampled)`)
}

export async function runCli(argv: string[]): Promise<void> {
  const program = new Command()
  program.name("bb").description("Backbencher Brain — universal code intelligence (40+ languages)")
  program.version("0.2.0")

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
    .action(async (dir: string | undefined) => {
      await cmdHealth(dir)
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
