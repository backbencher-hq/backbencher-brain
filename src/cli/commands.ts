// Backbencher Brain — CLI entry point
// Parses commands and routes to handlers

import { Command } from "commander"
import { openDatabase, closeDatabase, cleanDatabase, listProjects } from "../database.js"
import { indexProject } from "../indexer/parallel.js"
import { getStats } from "../graph/query.js"
import { startServer } from "../server.js"
import { setVerbose } from "../util/log.js"

// Import tools to register them
import "../tools/index.js"

export async function run(argv: string[]) {
  const program = new Command()

  program
    .name("bb")
    .description("Backbencher Brain — Universal MCP code intelligence server")
    .version("0.1.0")
    .option("-v, --verbose", "Verbose logging")

  // === START — MCP server mode ===
  program
    .command("start [path]")
    .description("Start MCP server (indexes project if needed)")
    .option("-p, --project <path>", "Project directory")
    .option("--no-index", "Skip auto-indexing")
    .action(async (path, options) => {
      const projectPath = path || options.project || process.cwd()
      if (options.verbose) setVerbose(true)

      const db = openDatabase(projectPath)
      const stats = getStats(db.db, db.projectHash)

      if (!options.noIndex && stats.files === 0) {
        process.stderr.write("Indexing project for the first time...\n")
        await indexProject(projectPath, db.db, { verbose: options.verbose })
      }

      // Start MCP server over stdio
      await startServer({
        projectPath,
        projectHash: db.projectHash,
        db: db.db,
      })

      closeDatabase(db)
    })

  // === INDEX ===
  program
    .command("index [path]")
    .description("Index project without starting MCP server")
    .option("-p, --project <path>", "Project directory")
    .action(async (path, options) => {
      const projectPath = path || options.project || process.cwd()
      if (options.verbose) setVerbose(true)

      const db = openDatabase(projectPath)
      process.stderr.write(`Indexing ${projectPath}...\n`)

      const stats = await indexProject(projectPath, db.db, { verbose: options.verbose })

      console.log(JSON.stringify({
        files: stats.successFiles,
        symbols: stats.symbolsExtracted,
        relationships: stats.relationshipsFound,
        duration: stats.endTime ? `${((stats.endTime - stats.startTime) / 1000).toFixed(1)}s` : "unknown",
        errors: stats.errors.length,
      }, null, 2))

      closeDatabase(db)
    })

  // === STATUS ===
  program
    .command("status [path]")
    .description("Show index health for a project")
    .option("-p, --project <path>", "Project directory")
    .action(async (path, options) => {
      const projectPath = path || options.project || process.cwd()
      const db = openDatabase(projectPath)
      const stats = getStats(db.db, db.projectHash)

      console.log(`
  Backbencher Brain v0.1.0
  Project: ${projectPath}

  ┌────────────────────────────────────────┐
  │ Health         ${stats.files > 0 ? "● OK" : "○ Not indexed"}
  │ Files          ${stats.files.toLocaleString()}
  │ Symbols        ${stats.symbols.toLocaleString()}
  │ Relationships  ${stats.relationships.toLocaleString()}
  │ Imports        ${stats.imports.toLocaleString()}
  │ Languages      ${stats.languages.length > 0 ? stats.languages.join(", ") : "none"}
  │ Avg Complexity ${stats.avgComplexity}
  └────────────────────────────────────────┘
`)

      closeDatabase(db)
    })

  // === LIST ===
  program
    .command("list")
    .description("List all indexed projects")
    .action(async () => {
      const projects = listProjects()
      if (Object.keys(projects).length === 0) {
        console.log("No indexed projects found.")
        return
      }

      console.log("\nIndexed projects:")
      for (const [hash, info] of Object.entries(projects)) {
        console.log(`  ${info.name}  (${info.path})`)
        console.log(`    Files: ${info.files.toLocaleString()} | Symbols: ${info.symbols.toLocaleString()} | Last: ${info.lastIndexed || "never"}`)
      }
    })

  // === CLEAN ===
  program
    .command("clean [path]")
    .description("Remove index for a project")
    .option("-p, --project <path>", "Project directory")
    .action(async (path, options) => {
      const projectPath = path || options.project || process.cwd()
      const removed = cleanDatabase(projectPath)
      console.log(removed ? `✓ Removed index for ${projectPath}` : `✗ No index found for ${projectPath}`)
    })

  await program.parseAsync(["node", "bb", ...argv])
}
