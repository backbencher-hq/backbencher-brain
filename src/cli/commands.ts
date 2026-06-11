// Backbencher Brain — CLI entry point
// Parses commands and routes to handlers

import { Command } from "commander"

export async function run(argv: string[]) {
  const program = new Command()

  program
    .name("bb")
    .description("Backbencher Brain — Universal MCP code intelligence server")
    .version("0.1.0")

  // All brain subcommands
  program
    .command("start [path]")
    .description("Start MCP server (indexes project if needed)")
    .option("-p, --project <path>", "Project directory")
    .action(async (path, options) => {
      const projectPath = path || options.project || process.cwd()
      console.log(`Starting MCP server for: ${projectPath}`)
      console.log("MCP server — coming in M6")
    })

  program
    .command("index [path]")
    .description("Index project without starting MCP server")
    .option("-p, --project <path>", "Project directory")
    .action(async (path, options) => {
      const projectPath = path || options.project || process.cwd()
      console.log(`Indexing: ${projectPath}`)
      console.log("Indexer — coming in M4")
    })

  program
    .command("status [path]")
    .description("Show index health for a project")
    .option("-p, --project <path>", "Project directory")
    .action(async (path, options) => {
      const projectPath = path || options.project || process.cwd()
      console.log(`Status for: ${projectPath}`)
      console.log("Status dashboard — coming in M5")
    })

  program
    .command("list")
    .description("List all indexed projects")
    .action(async () => {
      console.log("Indexed projects — coming in M8")
    })

  program
    .command("clean [path]")
    .description("Remove index for a project")
    .option("-p, --project <path>", "Project directory")
    .action(async (path, options) => {
      const projectPath = path || options.project || process.cwd()
      console.log(`Cleaning index for: ${projectPath}`)
    })

  await program.parseAsync(["node", "bb", ...argv])
}
