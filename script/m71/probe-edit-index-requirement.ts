// script/m71/probe-edit-index-requirement.ts — D6/D10 pre-fix measurement.
//
// WHAT IS MEASURED, and why from two directions. The register's D6 says
// "`write` is blocked over the wire when the project has no index" and D10 says
// per-mode rejections do not name the accepted set. Both are claims about the
// MCP surface, so a claim about one side is not evidence:
//
//   1. THE ENGINE, on a project that has never been indexed — does `write`
//      actually create the file, and what do the four symbol modes do? If the
//      engine refuses too, D6 is not a server-gate defect and "let write
//      through" would just move the failure one layer down.
//   2. THE REAL MCP STDIO SERVER (src/mcp/server.ts, driven by
//      StdioClientTransport exactly as m13/verify-edit-e2e.ts does) — what an
//      MCP client is TOLD for each mode.
//   3. THE VALIDATION LAYER — the exact per-mode rejection text, and the whole
//      mode × option matrix, so the D10 wording is a measurement rather than a
//      paraphrase.
//
// Run before and after the fix; the numbers printed here are the ones recorded
// in reviews/tools/bb_edit.md §4.6 and §4.10.

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { getProjectId } from "../../src/cli/index"
import { BrainDatabase } from "../../src/brain/database"
import { executeEdit, type EditRequest } from "../../src/intelligence/edit/edit-engine"
import { PUBLIC_TOOL_DESCRIPTORS } from "../../src/mcp/tool-registry"
import { validateToolArguments } from "../../src/mcp/tool-validation"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const descriptor = PUBLIC_TOOL_DESCRIPTORS.find((t) => t.name === "bb_edit")!

/** A one-symbol project, on disk, with NO index and no database row. */
function unindexedProject(label: string): { dir: string; projectId: string } {
  const dir = mkdtempSync(path.join(tmpdir(), `bb-m71-index-${label}-`))
  mkdirSync(path.join(dir, "src"), { recursive: true })
  writeFileSync(path.join(dir, "src", "app.ts"), "export function appFn(): number { return 1 }\n")
  return { dir, projectId: getProjectId(dir) }
}

async function indexedFileCount(projectId: string): Promise<number> {
  try {
    const raw = await BrainDatabase.getRawInstance(projectId)
    return ((raw.prepare("SELECT COUNT(*) c FROM brain_file WHERE project_id=?").get(projectId) as any).c ?? 0) as number
  } catch {
    return -1
  }
}

const ARGS: Record<string, Record<string, unknown>> = {
  write: { mode: "write", filePath: "src/created.ts", content: "export const created = 1\n", format: false },
  update: { mode: "update", symbolName: "appFn", newContent: "return 2", format: false },
  insert: { mode: "insert", targetSymbolName: "appFn", newContent: "  const inserted = true", format: false },
  delete: { mode: "delete", symbolName: "appFn", format: false },
  refactor: { mode: "refactor", symbolName: "appFn", newName: "renamedFn", format: false },
}
const MODES = ["write", "update", "insert", "delete", "refactor"] as const

console.log("=== 1. THE ENGINE, on a project that was never indexed ===\n")
for (const mode of MODES) {
  const { dir, projectId } = unindexedProject("engine")
  const before = readFileSync(path.join(dir, "src", "app.ts"), "utf8")
  let outcome: string
  try {
    const result = await executeEdit(dir, projectId, ARGS[mode] as EditRequest)
    outcome = `OK  reindexed=${result.reindexed} changedFiles=${result.changes.map((c) => c.path).join(",")}`
  } catch (error) {
    outcome = `THREW  ${(error as Error).message.split("\n")[0].slice(0, 120)}`
  }
  const createdFile = mode === "write" && readFileSync(path.join(dir, "src", "app.ts"), "utf8") === before
    ? (await import("node:fs")).existsSync(path.join(dir, "src", "created.ts"))
    : null
  console.log(`  ${mode.padEnd(9)} ${outcome}${createdFile === null ? "" : `  createdFile=${createdFile}`}`)
  console.log(`  ${"".padEnd(9)} indexed files after: ${await indexedFileCount(projectId)}`)
  rmSync(dir, { recursive: true, force: true })
  try { rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true }) } catch {}
}

/**
 * One real MCP stdio session against a fresh UNINDEXED project.
 *
 * The SOURCE server, not a build artifact: the claim under test is the gate in
 * this tree, and `--input-type=module` is required because a launcher written
 * into the temp project sits outside the repo's package.json, where tsx
transforms it as CJS and top-level await is a hard error (measured:
 * ERR_REQUIRE_ASYNC_MODULE, "Connection closed").
 */
async function withWireServer(label: string, body: (call: (args: Record<string, unknown>) => Promise<{ text: string; isError: boolean }>) => Promise<void>): Promise<void> {
  const { dir, projectId } = unindexedProject(label)
  const bootstrap = `const { startMcpServer } = await import(${JSON.stringify(path.join(ROOT, "src/mcp/server.ts"))}); await startMcpServer(process.argv[1])`
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", "--input-type=module", "-e", bootstrap, dir],
    cwd: ROOT,
    stderr: "pipe",
  })
  const client = new Client({ name: "probe-edit-index-requirement", version: "1.0.0" })
  const call = async (args: Record<string, unknown>) => {
    const res: any = await client.callTool({ name: "bb_edit", arguments: args })
    const text = (res?.content ?? []).map((c: any) => c.text ?? "").join("\n")
    return { text: text.replace(/\s+/g, " "), isError: res?.isError === true }
  }
  const line = (mode: string, r: { text: string; isError: boolean }, note = "") =>
    console.log(`  ${mode.padEnd(9)} isError=${String(r.isError).padEnd(5)} ${r.text.slice(0, 240)}${note}`)
  try {
    await client.connect(transport)
    await body(async (args) => {
      const r = await call(args)
      line(String(args.mode), r)
      return r
    })
  } catch (error) {
    // reported below; the session line names which leg died
    console.log(`  ${label} session failed: ${(error as Error).message}`)
  } finally {
    try { await client.close() } catch {}
    rmSync(dir, { recursive: true, force: true })
    try { rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true }) } catch {}
  }
}

console.log("\n=== 2. THE REAL MCP SERVER, on a project that was never indexed ===\n")
// (a) the four symbol modes with nothing indexed — the state the register's D6
// measured, on a project where no `write` has run first (a write reindexes the
// file it wrote, so it would change what the next call sees: that is (b)).
await withWireServer("symbol", async (call) => {
  for (const mode of ["update", "insert", "delete", "refactor"] as const) await call(ARGS[mode]!)
})
// (b) the two halves of D6 on one project: `write` must reach the engine, and its
// own reindex must be what unblocks the mode that was refused a moment earlier.
await withWireServer("bootstrap", async (call) => {
  await call({ mode: "write", filePath: "src/created.ts", content: "export function created(): number { return 7 }\n", format: false })
  await call({ mode: "update", symbolName: "created", newContent: "return 8", format: false })
  console.log("  ^ the second call is the mode the first call's own reindex unblocked, on the same project")
})

console.log("\n=== 3. THE VALIDATION LAYER: per-mode rejections and the mode × option matrix ===\n")
const properties = Object.keys(descriptor.inputSchema.properties ?? {})
for (const mode of MODES) {
  const rejected: string[] = []
  const accepted: string[] = []
  for (const property of properties) {
    if (property === "mode") continue
    const probe: Record<string, unknown> = { ...ARGS[mode]!, [property]: ARGS[mode]![property] ?? (property === "lineStart" ? 1 : property === "position" ? "after" : property === "dryRun" || property === "force" ? true : property === "format" ? false : property === "content" ? "x" : property === "newName" ? "n" : property === "targetSymbolName" ? "appFn" : property === "filePath" ? "src/app.ts" : property === "symbolName" ? "appFn" : "x") }
    try {
      validateToolArguments(descriptor, probe)
      accepted.push(property)
    } catch (error) {
      const message = (error as Error).message
      rejected.push(property)
      if (/does not accept/.test(message)) console.log(`  ${mode} + ${property}: ${message}`)
    }
  }
  console.log(`  ${mode.padEnd(9)} accepted: ${accepted.join(", ")}`)
  console.log(`  ${"".padEnd(9)} refused:  ${rejected.filter((r) => !accepted.includes(r)).join(", ")}`)
}
