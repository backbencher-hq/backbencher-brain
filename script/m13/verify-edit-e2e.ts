// script/m13/verify-edit-e2e.ts — M13.14 (E9).
//
// Exercises all five bb_edit modes and their error paths through BOTH real
// transports: the compiled Node CLI (`node bin/bb tool bb_edit …`) and the
// real MCP stdio server (StdioClientTransport → src/mcp/server.ts). Proves
// dry-run performs zero writes in both transports.

import { execFileSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { Harness } from "./harness"

const harness = new Harness({
  issue: "M13.14",
  code: "E9",
  tool: "bb_edit",
  title: "bb_edit: e2e (real MCP + compiled CLI, all five modes)",
  layers: ["e2e"],
  decisions: {
    transports: "compiled CLI via `node bin/bb tool bb_edit --dir <root> --args <json>`; MCP via StdioClientTransport → src/mcp/server.ts (Bun runs server.ts directly, Node uses bin/bb mcp)",
    dryRun: "every positive case uses dryRun:true so no file is written; a separate check confirms the target file does NOT exist after a dry-run write",
    modeAwareIndexGate: "M71.D6 runs its own leg against the SOURCE MCP server (`--import tsx --input-type=module -e`) on a project with no index: a compiled bundle would answer about whatever it was built from, and the claim under test is the gate in the tree",
  },
  limitations: [
    "The CLI transport reads the prebuilt bin/bb; run `npm run build` before this verifier.",
    "MCP stdio under Bun executes src/mcp/server.ts directly (no build needed for that path).",
  ],
})

const root = mkdtempSync(path.join(tmpdir(), "bb-edit-e2e-"))
const projectId = getProjectId(root)
const srcDir = path.join(root, "src")
mkdirSync(srcDir, { recursive: true })
writeFileSync(path.join(srcDir, "app.ts"), "export function e2eTarget(): number { return 1 }\nexport function e2eCaller(): number { return e2eTarget() }\n")
writeFileSync(path.join(srcDir, "solo.ts"), "export function solo(): number { return 9 }\n")
await indexProjectParallel(projectId, root, {})

const bb = path.resolve("bin/bb")
const isBun = typeof Bun !== "undefined"

// ── CLI transport: all five modes (dry-run, zero writes) ──────────────────
function cli(args: Record<string, unknown>): { text: string; ok: boolean } {
  try {
    const out = execFileSync("node", [bb, "tool", "bb_edit", "--dir", root, "--args", JSON.stringify(args)], { cwd: process.cwd(), encoding: "utf8", stdio: "pipe" })
    return { text: out, ok: true }
  } catch (e: any) {
    return { text: `${e.stdout ?? ""}${e.stderr ?? ""}${e.message ?? ""}`, ok: false }
  }
}

{
  // write (dry-run → no file created)
  const r = cli({ mode: "write", dryRun: true, filePath: "src/written.ts", content: "export const w = 1\n" })
  harness.check("CLI write dry-run succeeds", r.ok && r.text.includes('"dryRun": true'), r.text.slice(0, 160))
  harness.check("CLI write dry-run performs zero writes", !existsSync(path.join(srcDir, "written.ts")))
}
{
  // update
  const r = cli({ mode: "update", dryRun: true, symbolName: "e2eTarget", filePath: "src/app.ts", newContent: "return 42" })
  harness.check("CLI update dry-run succeeds", r.ok && r.text.includes('"dryRun": true'), r.text.slice(0, 160))
}
{
  // insert
  const r = cli({ mode: "insert", dryRun: true, targetSymbolName: "e2eTarget", filePath: "src/app.ts", position: "inside-bottom", newContent: "const ins = true" })
  harness.check("CLI insert dry-run succeeds", r.ok && r.text.includes('"dryRun": true'), r.text.slice(0, 160))
}
{
  // delete (dry-run)
  const r = cli({ mode: "delete", dryRun: true, symbolName: "solo", filePath: "src/solo.ts" })
  harness.check("CLI delete dry-run succeeds", r.ok && r.text.includes('"dryRun": true'), r.text.slice(0, 160))
  harness.check("CLI delete dry-run leaves the file untouched", readFileSync(path.join(srcDir, "solo.ts"), "utf8").includes("function solo"))
}
{
  // refactor
  const r = cli({ mode: "refactor", dryRun: true, symbolName: "e2eTarget", filePath: "src/app.ts", newName: "renamedTarget" })
  harness.check("CLI refactor dry-run succeeds", r.ok && r.text.includes('"dryRun": true'), r.text.slice(0, 160))
}
// CLI error paths (negatives)
{
  const r = cli({ mode: "write", content: "x" })
  harness.negative("CLI rejects write without filePath", !r.ok && r.text.includes("requires filePath"), r.text.slice(0, 140))
}
{
  const r = cli({ mode: "refactor", symbolName: "e2eTarget" })
  harness.negative("CLI rejects refactor without newName", !r.ok && (r.text.includes("requires newName") || r.text.includes("newName")), r.text.slice(0, 140))
}
{
  const r = cli({ mode: "write", filePath: "../escape.ts", content: "x" })
  harness.negative("CLI rejects path escape", !r.ok && r.text.includes("escapes"), r.text.slice(0, 140))
}

// ── MCP stdio transport: all five modes (dry-run) + error paths ───────────
{
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js")
  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js")
  const serverEntry = isBun ? path.resolve("src/mcp/server.ts") : path.resolve("bin/bb")
  const serverArgs = isBun ? ["--dir", root] : ["mcp", "--dir", root]
  const transport = new StdioClientTransport({ command: process.execPath, args: [serverEntry, ...serverArgs], cwd: process.cwd(), stderr: "pipe" })
  const client = new Client({ name: "verify-edit-e2e", version: "1.0.0" })
  const call = async (args: Record<string, unknown>) => {
    const res: any = await client.callTool({ name: "bb_edit", arguments: args })
    const text = (res?.content ?? []).map((c: any) => c.text ?? "").join("\n")
    return { text, isError: res?.isError ?? false }
  }
  try {
    await client.connect(transport)
    // write
    const w = await call({ mode: "write", dryRun: true, filePath: "src/mcp-written.ts", content: "export const m = 1\n" })
    harness.check("MCP write dry-run succeeds", !w.isError && w.text.includes('"dryRun": true'), w.text.slice(0, 160))
    harness.check("MCP write dry-run performs zero writes", !existsSync(path.join(srcDir, "mcp-written.ts")))
    // update
    const u = await call({ mode: "update", dryRun: true, symbolName: "e2eTarget", filePath: "src/app.ts", newContent: "return 42" })
    harness.check("MCP update dry-run succeeds", !u.isError && u.text.includes('"dryRun": true'), u.text.slice(0, 160))
    // insert
    const i = await call({ mode: "insert", dryRun: true, targetSymbolName: "e2eTarget", filePath: "src/app.ts", position: "inside-bottom", newContent: "const ins = true" })
    harness.check("MCP insert dry-run succeeds", !i.isError && i.text.includes('"dryRun": true'), i.text.slice(0, 160))
    // delete
    const d = await call({ mode: "delete", dryRun: true, symbolName: "solo", filePath: "src/solo.ts" })
    harness.check("MCP delete dry-run succeeds", !d.isError && d.text.includes('"dryRun": true'), d.text.slice(0, 160))
    // refactor
    const rf = await call({ mode: "refactor", dryRun: true, symbolName: "e2eTarget", filePath: "src/app.ts", newName: "renamedTarget" })
    harness.check("MCP refactor dry-run succeeds", !rf.isError && rf.text.includes('"dryRun": true'), rf.text.slice(0, 160))
    // error paths (negatives)
    const e1 = await call({ mode: "write", content: "x" })
    harness.negative("MCP rejects write without filePath", e1.isError && e1.text.includes("requires filePath"), e1.text.slice(0, 140))
    const e2 = await call({ mode: "write", filePath: "../escape.ts", content: "x" })
    harness.negative("MCP rejects path escape", e2.isError && e2.text.includes("escapes"), e2.text.slice(0, 140))
    const e3 = await call({ mode: "refactor", symbolName: "nonexistentSymbol", newName: "x", filePath: "src/app.ts" })
    harness.negative("MCP rejects unknown symbol", e3.isError, e3.text.slice(0, 140))
  } catch (e) {
    harness.check("MCP bb_edit e2e session", false, e instanceof Error ? e.message : String(e))
  } finally {
    try { await client.close() } catch {}
  }
}

// ── M71.D6: the index gate is per MODE, over the wire ─────────────────────
// Measured before the fix: ALL FIVE modes answered "No index found" on a project
// with no index — including `write`, which resolves no symbol and reindexes the
// file it wrote — and the refusal was returned WITHOUT `isError`, so a client
// branching on that flag read a write tool's refusal as a success. The registry
// carries the split (`indexFreeModes`), the server reads it, and both directions
// are asserted here: the exempt mode must reach the engine, and every other mode
// must be refused with the remediation AND the mode that still works.
{
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js")
  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js")
  const freshRoot = mkdtempSync(path.join(tmpdir(), "bb-edit-e2e-noindex-"))
  mkdirSync(path.join(freshRoot, "src"), { recursive: true })
  writeFileSync(path.join(freshRoot, "src", "app.ts"), "export function wireFn(): number { return 1 }\n")
  const freshProject = getProjectId(freshRoot)
  // The SOURCE server, not bin/bb: the claim under test is the gate in this tree,
  // and a compiled bundle would answer about whatever it was last built from.
  // `--input-type=module` is required — a launcher outside the repo is transformed
  // as CJS by tsx, where top-level await is a hard error (measured).
  const bootstrap = `const { startMcpServer } = await import(${JSON.stringify(path.resolve("src/mcp/server.ts"))}); await startMcpServer(process.argv[1])`
  // The launcher is runtime-AWARE. The tsx form is Node-only: under Bun,
  // `bun --import tsx --input-type=module -e <code>` fails before the server starts
  // (measured on Bun 1.3.14: `error: Cannot find module './cjs/index.cjs'`), so the
  // child exited and every check in this block reported `Connection closed` — a
  // gate that could not run reading as a gate that FAILED. Bun runs the source file
  // directly, which is what this block wants anyway (the source tree, not a compiled
  // bundle), so each runtime gets the invocation it can actually execute.
  const isBunRuntime = typeof (globalThis as any).Bun !== "undefined"
  const transport = new StdioClientTransport(
    isBunRuntime
      ? {
          command: process.execPath,
          args: [path.resolve("src/mcp/server.ts"), "--dir", freshRoot],
          cwd: process.cwd(),
          stderr: "pipe",
        }
      : {
          command: process.execPath,
          args: ["--import", "tsx", "--input-type=module", "-e", bootstrap, freshRoot],
          cwd: process.cwd(),
          stderr: "pipe",
        },
  )
  const client = new Client({ name: "verify-edit-e2e-noindex", version: "1.0.0" })
  const call = async (args: Record<string, unknown>) => {
    const res: any = await client.callTool({ name: "bb_edit", arguments: args })
    const text = (res?.content ?? []).map((c: any) => c.text ?? "").join("\n")
    return { text, isError: res?.isError === true }
  }
  try {
    await client.connect(transport)
    // Every symbol mode is refused, as an ERROR, with the remediation and the exemption named.
    for (const [mode, args] of Object.entries({
      update: { mode: "update", symbolName: "wireFn", newContent: "return 2" },
      insert: { mode: "insert", targetSymbolName: "wireFn", newContent: "const inserted = true" },
      delete: { mode: "delete", symbolName: "wireFn" },
      refactor: { mode: "refactor", symbolName: "wireFn", newName: "renamedWireFn" },
    })) {
      const refused = await call(args as Record<string, unknown>)
      harness.negative(`no-index wire: ${mode} is refused with the remediation and the exemption named`,
        refused.isError && refused.text.includes("No index found") && refused.text.includes("bb index")
          && refused.text.includes("`write`") && /needs that index for/.test(refused.text),
        `isError=${refused.isError} ${refused.text.slice(0, 180)}`)
    }
    // …and `write` is NOT refused: it creates the file, and the words say so.
    const wrote = await call({ mode: "write", filePath: "src/created.ts", content: "export function created(): number { return 7 }\n", format: false })
    harness.check("no-index wire: write reaches the engine and reports reindexed:true",
      !wrote.isError && wrote.text.includes('"reindexed": true'), `isError=${wrote.isError} ${wrote.text.slice(0, 180)}`)
    harness.check("no-index wire: the file exists with the requested bytes",
      existsSync(path.join(freshRoot, "src", "created.ts"))
        && readFileSync(path.join(freshRoot, "src", "created.ts"), "utf8").includes("created"),
      "reading src/created.ts back from disk")
    // The bootstrap, over the wire: the write indexed what it wrote, so the mode
    // that was refused a moment ago now resolves on the same project.
    const unblocked = await call({ mode: "update", symbolName: "created", newContent: "return 8", format: false })
    harness.check("no-index wire: the write unblocks the symbol modes on the same project",
      !unblocked.isError && readFileSync(path.join(freshRoot, "src", "created.ts"), "utf8").includes("return 8"),
      `isError=${unblocked.isError} ${unblocked.text.slice(0, 180)}`)
  } catch (e) {
    harness.check("MCP bb_edit no-index session", false, e instanceof Error ? e.message : String(e))
  } finally {
    try { await client.close() } catch {}
    rmSync(freshRoot, { recursive: true, force: true })
    rmSync(path.dirname(BrainDatabase.getDbPath(freshProject)), { recursive: true, force: true })
  }
}

// ── M71.D7: the overwrite guard, over the wire ────────────────────────────
// The engine half is measured in E7 against real files; what this leg adds is the
// part a CLIENT sees. A refused write must arrive as an ERROR with the remedy in
// the text — the same rule the index gate learned in D6 — because the alternative
// is a caller who reads `ok` and moves on believing the file was replaced.
//
// (D9's window is measured in E7, not here: the interleave has to happen INSIDE
// the process holding the plan, and this client is a different process from the
// server that plans and commits. E7 queues the mutation at the plan's own first
// await, which is the same window and a deterministic one.)
{
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js")
  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js")
  const serverEntry = isBun ? path.resolve("src/mcp/server.ts") : path.resolve("bin/bb")
  const serverArgs = isBun ? ["--dir", root] : ["mcp", "--dir", root]
  const transport = new StdioClientTransport({ command: process.execPath, args: [serverEntry, ...serverArgs], cwd: process.cwd(), stderr: "pipe" })
  const client = new Client({ name: "verify-edit-e2e-overwrite", version: "1.0.0" })
  const call = async (args: Record<string, unknown>) => {
    const res: any = await client.callTool({ name: "bb_edit", arguments: args })
    const text = (res?.content ?? []).map((c: any) => c.text ?? "").join("\n")
    return { text, isError: res?.isError === true }
  }
  const bigPath = path.join(srcDir, "wire-big.ts")
  const big = `// header\n` + Array.from({ length: 40 }, (_, i) => `export const w${i} = ${i}`).join("\n") + "\n"
  try {
    await client.connect(transport)
    writeFileSync(bigPath, big)
    const refused = await call({ mode: "write", filePath: "src/wire-big.ts", content: "export const w0 = 0\n", format: false })
    harness.negative("overwrite wire: a destructive write arrives as an ERROR naming the remedy",
      refused.isError && refused.text.includes("write refused")
        && refused.text.includes("(41 lines) with 1 line(s)") && refused.text.includes("Pass overwrite: true"),
      `isError=${refused.isError} ${refused.text.slice(0, 260)}`)
    harness.check("overwrite wire: the refusal is an envelope, not a bare string — ok:false, rolledBack:true",
      refused.text.includes('"ok": false') && refused.text.includes('"rolledBack": true'), refused.text.slice(0, 200))
    harness.check("overwrite wire: the refused write left the file byte-identical", readFileSync(bigPath, "utf8") === big)
    const dry = await call({ mode: "write", dryRun: true, filePath: "src/wire-big.ts", content: "export const w0 = 0\n", format: false })
    harness.negative("overwrite wire: a dry run reports the SAME refusal (the guard is at plan time)",
      dry.isError && dry.text.includes("write refused"), `isError=${dry.isError} ${dry.text.slice(0, 200)}`)
    const forced = await call({ mode: "write", filePath: "src/wire-big.ts", content: "export const w0 = 0\n", overwrite: true, format: false })
    harness.check("overwrite wire: the same request with overwrite:true commits",
      !forced.isError && forced.text.includes('"reindexed": true')
        && readFileSync(bigPath, "utf8") === "export const w0 = 0\n",
      `isError=${forced.isError} ${readFileSync(bigPath, "utf8")}`)
    const createOnly = await call({ mode: "write", filePath: "src/wire-big.ts", content: big, overwrite: false, format: false })
    harness.negative("overwrite wire: overwrite:false refuses an existing file as create-only",
      createOnly.isError && createOnly.text.includes("create-only") && createOnly.text.includes("src/wire-big.ts"),
      `isError=${createOnly.isError} ${createOnly.text.slice(0, 200)}`)
    const created = await call({ mode: "write", filePath: "src/wire-fresh.ts", content: "export const fresh = 1\n", overwrite: false, format: false })
    harness.check("overwrite wire: overwrite:false still creates when nothing is there",
      !created.isError && existsSync(path.join(srcDir, "wire-fresh.ts")), `isError=${created.isError} ${created.text.slice(0, 160)}`)
    const wrongType = await call({ mode: "write", filePath: "src/wire-big.ts", content: "x", overwrite: "yes" })
    harness.negative("overwrite wire: a non-boolean overwrite is refused by the schema, not coerced",
      wrongType.isError && wrongType.text.includes("must be boolean"), wrongType.text.slice(0, 200))
  } catch (e) {
    harness.check("MCP bb_edit overwrite session", false, e instanceof Error ? e.message : String(e))
  } finally {
    try { await client.close() } catch {}
  }
}

rmSync(root, { recursive: true, force: true })
rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true })

harness.emit()
