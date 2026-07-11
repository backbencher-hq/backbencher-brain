// Backbencher Brain — CLI with progress display, status dashboard
// Polished terminal output with colored status, progress during indexing

import { Command } from "commander"
import { openDatabase, closeDatabase, cleanDatabase, listProjects } from "../database.js"
import { getStats, getMostComplex } from "../graph/query.js"
import { startServer } from "../server.js"
import { setVerbose } from "../util/log.js"
import "../tools/index.js"

const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  blue: "\x1b[34m",
}

function header() {
  process.stderr.write(`
${c.cyan}${c.bold}   ╔══════════════════════════════════════╗
   ║         BACKBENCHER BRAIN v0.1.0       ║
   ║         40 languages · MCP server       ║
   ╚══════════════════════════════════════╝${c.reset}

`)
}

function progressBar(current: number, total: number, width = 30): string {
  const pct = Math.min(current / total, 1)
  const filled = Math.round(pct * width)
  const empty = width - filled
  return `${c.cyan}█${c.reset}`.repeat(filled) + `${c.dim}░${c.reset}`.repeat(empty) + ` ${Math.round(pct * 100)}%`
}

export async function run(argv: string[]) {
  const program = new Command()

  program
    .name("bb")
    .description("Backbencher Brain — Universal MCP code intelligence server")
    .version("0.1.0")
    .option("-v, --verbose", "Verbose logging")
    .option("--no-color", "Disable colored output")

  // === START ===
  program
    .command("start [path]")
    .description("Start MCP server (auto-indexes project)")
    .option("-p, --project <path>", "Project directory (alternative to positional)")
    .option("--no-index", "Skip auto-indexing")
    .action(async (path, options) => {
      const projectPath = path || options.project || process.cwd()
      if (options.verbose) setVerbose(true)
      header()

      const db = openDatabase(projectPath)
      const stats = getStats(db.db, db.projectHash)

      if (!options.noIndex && stats.files === 0) {
        process.stderr.write(`${c.yellow}  First run — indexing project...${c.reset}\n\n`)
        const result = await indexWithProgress(projectPath, db.projectHash)
        stats.files = result?.totalFiles || result?.filesProcessed || 0
      }

      process.stderr.write(`${c.green}  ✓ MCP server ready on stdio${c.reset}\n`)
      process.stderr.write(`  Project: ${projectPath}\n`)
      process.stderr.write(`  Tools: 14 registered\n\n`)

      // MCP server runs until process killed. DB cleanup happens on exit.
      await startServer({ projectPath, projectHash: db.projectHash, db: db.db })
    })

  // === INDEX ===
  program
    .command("index [path]")
    .description("Index project without starting MCP server")
    .option("-p, --project <path>", "Project directory (alternative to positional)")
    .action(async (path, options) => {
      const projectPath = path || options.project || process.cwd()
      header()
      const db = openDatabase(projectPath)

      const result = await indexWithProgress(projectPath, db.projectHash)

      const successFiles = result?.totalFiles || result?.filesProcessed || 0
      const symbols = result?.symbolsExtracted || 0
      const relations = result?.relationshipsFound || 0
      const duration = result?.duration ? `${(result.duration/1000).toFixed(1)}s` : "unknown"

      console.log(`\n${c.green}  ✓ Indexing complete${c.reset}`)
      console.log(`  Files:     ${(successFiles as number).toLocaleString()}`)
      console.log(`  Symbols:   ${(symbols as number).toLocaleString()}`)
      console.log(`  Relations: ${(relations as number).toLocaleString()}`)
      console.log(`  Duration:  ${duration}`)

      closeDatabase(db)
    })

  // === STATUS ===
  program
    .command("status [path]")
    .description("Show project index health")
    .option("-p, --project <path>", "Project directory (alternative to positional)")
    .action(async (path, options) => {
      const projectPath = path || options.project || process.cwd()
      header()
      const db = openDatabase(projectPath)
      const stats = getStats(db.db, db.projectHash)
      const status = db.db.prepare("SELECT status, last_indexed_at FROM index_status WHERE project_hash = ?").get(db.projectHash) as any

      const health = stats.files > 0 ? `${c.green}● OK${c.reset}` : `${c.yellow}○ Not indexed${c.reset}`
      const lastIdx = status?.last_indexed_at
        ? new Date(status.last_indexed_at).toLocaleString()
        : "never"

      console.log(`
  ${c.bold}Project:${c.reset} ${projectPath}

  ┌──────────────────────────────────────────────┐
  │ Health         ${health}                          
  │ Status         ${status?.status || "unknown"}
  │ Last indexed   ${lastIdx}
  │                                              │
  │ Files          ${stats.files.toLocaleString().padStart(10)}
  │ Symbols        ${stats.symbols.toLocaleString().padStart(10)}
  │ Relationships  ${stats.relationships.toLocaleString().padStart(10)}
  │ Imports        ${stats.imports.toLocaleString().padStart(10)}
  │ Avg Complexity ${String(stats.avgComplexity).padStart(10)}
  │                                              │
  │ Languages      ${stats.languages.slice(0, 8).join(", ") || "none"}
  └──────────────────────────────────────────────┘
`)

      if (stats.symbols > 0) {
        const top = getMostComplex(db.db, db.projectHash, 5)
        console.log(`  ${c.bold}Top 5 most complex:${c.reset}`)
        for (const s of top) {
          console.log(`    ${s.name.padEnd(25)} complexity=${s.complexity}  ${s.relative_path}`)
        }
        console.log()
      }

      closeDatabase(db)
    })

  // === LIST ===
  program
    .command("list")
    .description("List all indexed projects")
    .action(() => {
      header()
      const projects = listProjects()
      if (Object.keys(projects).length === 0) {
        console.log(`  ${c.dim}No indexed projects found.${c.reset}\n`)
        console.log(`  Run ${c.cyan}bb index${c.reset} in a project directory.\n`)
        return
      }
      console.log(`  ${c.bold}Indexed projects:${c.reset}\n`)
      for (const [hash, info] of Object.entries(projects)) {
        const name = info.name.padEnd(20)
        const files = String(info.files).padStart(6)
        const symbols = String(info.symbols).padStart(8)
        const last = info.lastIndexed || "never"
        console.log(`  ${c.cyan}${name}${c.reset} ${files} files  ${symbols} symbols  last: ${last}`)
      }
      console.log()
    })

  // === CLEAN ===
  program
    .command("clean [path]")
    .description("Remove project index")
    .option("-p, --project <path>", "Project directory (alternative to positional)")
    .action((path, options) => {
      const projectPath = path || options.project || process.cwd()
      header()
      const removed = cleanDatabase(projectPath)
      if (removed) {
        console.log(`  ${c.green}✓ Removed index${c.reset} for ${projectPath}\n`)
      } else {
        console.log(`  ${c.yellow}No index found${c.reset} for ${projectPath}\n`)
      }
    })

  await program.parseAsync(["node", "bb", ...argv])
}

// ============================================================================
// PROGRESS DISPLAY DURING INDEXING (uses real backbencher indexer)
// ============================================================================

async function indexWithProgress(projectPath: string, dbHash: string): Promise<any> {
  // Import the real backbencher indexer with shims
  const { indexProjectParallel } = await import("../indexer/parallel-indexer.js")
  let lastUpdate = 0

  return indexProjectParallel(dbHash as any, projectPath, {
    onProgress: (stats: any) => {
      const now = Date.now()
      if (now - lastUpdate < 500 && stats.processedFiles < stats.totalFiles) return
      lastUpdate = now

      const pct = Math.min(stats.processedFiles / stats.totalFiles, 1)
      const filled = Math.round(pct * 30)
      const bar = "\x1b[36m█\x1b[0m".repeat(filled) + "\x1b[2m░\x1b[0m".repeat(30 - filled)
      const fps = stats.filesPerSecond?.toFixed(0) || "?"
      const eta = stats.filesPerSecond > 0 ? `${Math.round((stats.totalFiles - stats.processedFiles) / stats.filesPerSecond)}s` : "..."

      process.stderr.write(
        `\r  Indexing  ${bar}  ${Math.round(pct * 100)}%  ${stats.processedFiles}/${stats.totalFiles} files  ${fps}/s  ETA: ${eta}    `
      )
    },
  })
}
