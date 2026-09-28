// script/m13/verify-edit-boundary.ts — M13.06 (E1).
//
// Proves bb_edit enforces mode-specific required fields and rejects
// mode-irrelevant fields at the single validateToolArguments boundary, and that
// this one path is wired into BOTH the compiled CLI and the real MCP server
// (so neither transport can silently drop or ignore an invalid request).
//
//   - unit: per-mode required-field enforcement + irrelevant-field rejection
//   - transport: compiled `bb tool bb_edit` and real MCP stdio both reject the
//     same invalid request and accept the same valid dry-run.

import { execFileSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { TOOL_DESCRIPTORS } from "../../src/mcp/tool-registry"
import { validateToolArguments } from "../../src/mcp/tool-validation"
import { Harness } from "./harness"

const harness = new Harness({
  issue: "M13.06",
  code: "E1",
  tool: "bb_edit",
  title: "bb_edit: enforce mode-specific required fields at the boundary",
  layers: ["unit", "e2e"],
  decisions: {
    authority: "src/mcp/tool-validation.ts validateEditArguments, called by validateToolArguments (single path)",
    requiredByMode: {
      write: "filePath + (content|newContent)",
      update: "symbolName + (newContent|content)",
      insert: "targetSymbolName + (newContent|content); position enum [before|after|inside-top|inside-bottom]",
      delete: "symbolName",
      refactor: "symbolName + newName",
    },
    irrelevantRejected: "known schema fields that do not apply to the requested mode are rejected, not silently ignored",
    positionEnum: "enforced by validateProperty against the registry schema enum",
  },
  limitations: [
    "This verifies the boundary contract only; engine semantics (AST identity rename, per-language masking, rollback) are E2-E6.",
    "The compiled CLI path requires a fresh build (bin/bb); the MCP path under Bun executes src/mcp/server.ts directly.",
  ],
})

const root = mkdtempSync(path.join(tmpdir(), "bb-edit-boundary-"))
const projectId = getProjectId(root)
const editDescriptor = TOOL_DESCRIPTORS.find((d) => d.name === "bb_edit")!
mkdirSync(path.join(root, "src"), { recursive: true })
writeFileSync(path.join(root, "src", "app.ts"), "export function boundaryTarget(): string { return 'ok' }\n")

const ok = (args: Record<string, unknown>): boolean => {
  try {
    validateToolArguments(editDescriptor, args)
    return true
  } catch {
    return false
  }
}
const errOf = (args: Record<string, unknown>): string => {
  try {
    validateToolArguments(editDescriptor, args)
    return ""
  } catch (e) {
    return String(e)
  }
}

// ── write ─────────────────────────────────────────────────────────────────
harness.check("write accepts filePath + content", ok({ mode: "write", filePath: "src/new.ts", content: "export const x = 1\n" }))
harness.check("write accepts filePath + newContent", ok({ mode: "write", filePath: "src/new.ts", newContent: "export const x = 1\n" }))
harness.rejects("write rejects missing filePath", () => validateToolArguments(editDescriptor, { mode: "write", content: "x" }), "requires filePath")
harness.rejects("write rejects missing content/newContent", () => validateToolArguments(editDescriptor, { mode: "write", filePath: "src/new.ts" }), "requires content or newContent")
harness.rejects("write rejects empty filePath", () => validateToolArguments(editDescriptor, { mode: "write", filePath: "  ", content: "x" }), "requires filePath")
harness.rejects("write rejects mode-irrelevant symbolName", () => validateToolArguments(editDescriptor, { mode: "write", filePath: "src/a.ts", content: "x", symbolName: "nope" }), "does not accept: symbolName")

// ── update ────────────────────────────────────────────────────────────────
harness.check("update accepts symbolName + newContent", ok({ mode: "update", symbolName: "boundaryTarget", newContent: "export function boundaryTarget() { return 'x' }\n" }))
harness.rejects("update rejects missing symbolName", () => validateToolArguments(editDescriptor, { mode: "update", newContent: "x" }), "requires symbolName")
harness.rejects("update rejects missing content/newContent", () => validateToolArguments(editDescriptor, { mode: "update", symbolName: "boundaryTarget" }), "requires newContent or content")
harness.rejects("update rejects mode-irrelevant position", () => validateToolArguments(editDescriptor, { mode: "update", symbolName: "a", newContent: "x", position: "after" }), "does not accept: position")

// ── insert ────────────────────────────────────────────────────────────────
harness.check("insert accepts targetSymbolName + newContent + position", ok({ mode: "insert", targetSymbolName: "boundaryTarget", position: "inside-top", newContent: "const s = true\n" }))
harness.rejects("insert rejects missing targetSymbolName", () => validateToolArguments(editDescriptor, { mode: "insert", newContent: "x" }), "requires targetSymbolName")
harness.rejects("insert rejects missing content/newContent", () => validateToolArguments(editDescriptor, { mode: "insert", targetSymbolName: "a" }), "requires newContent or content")
harness.rejects("insert rejects invalid position enum", () => validateToolArguments(editDescriptor, { mode: "insert", targetSymbolName: "a", newContent: "x", position: "middle" }), "position must be one of")
harness.rejects("insert rejects mode-irrelevant symbolName", () => validateToolArguments(editDescriptor, { mode: "insert", targetSymbolName: "a", newContent: "x", symbolName: "b" }), "does not accept: symbolName")

// ── delete ────────────────────────────────────────────────────────────────
harness.check("delete accepts symbolName", ok({ mode: "delete", symbolName: "boundaryTarget" }))
harness.rejects("delete rejects missing symbolName", () => validateToolArguments(editDescriptor, { mode: "delete" }), "requires symbolName")
harness.rejects("delete rejects mode-irrelevant newContent", () => validateToolArguments(editDescriptor, { mode: "delete", symbolName: "a", newContent: "x" }), "does not accept: newContent")

// ── refactor ──────────────────────────────────────────────────────────────
harness.check("refactor accepts symbolName + newName", ok({ mode: "refactor", symbolName: "boundaryTarget", newName: "renamed" }))
harness.rejects("refactor rejects missing newName", () => validateToolArguments(editDescriptor, { mode: "refactor", symbolName: "a" }), "requires newName")
harness.rejects("refactor rejects mode-irrelevant position", () => validateToolArguments(editDescriptor, { mode: "refactor", symbolName: "a", newName: "b", position: "after" }), "does not accept: position")

// ── shared negatives ──────────────────────────────────────────────────────
harness.rejects("bb_edit rejects unknown fields", () => validateToolArguments(editDescriptor, { mode: "write", filePath: "a", content: "x", bogus: true }), "unknown or irrelevant options")
harness.rejects("bb_edit rejects invalid mode", () => validateToolArguments(editDescriptor, { mode: "explode" }), "mode must be one of")

// ── wiring: one validation path for both transports ───────────────────────
const serverSrc = readFileSync(path.resolve("src/mcp/server.ts"), "utf8")
const cliSrc = readFileSync(path.resolve("src/cli/index.ts"), "utf8")
harness.check("MCP server routes through validateToolArguments", serverSrc.includes("validateToolArguments"))
harness.check("compiled CLI routes through validateToolArguments", cliSrc.includes("validateToolArguments"))

// ── transport: compiled CLI ───────────────────────────────────────────────
await indexProjectParallel(projectId, root, {})
try {
  const out = execFileSync("node", [path.resolve("bin/bb"), "tool", "bb_edit", "--dir", root, "--args", JSON.stringify({ mode: "write", dryRun: true, filePath: "src/new.ts", content: "export const cliBoundary = true\n" })], { cwd: process.cwd(), encoding: "utf8", stdio: "pipe" })
  harness.check("CLI accepts valid write dry-run", out.includes('"dryRun": true'), out.slice(0, 160))
} catch (e: any) {
  harness.check("CLI accepts valid write dry-run", false, `${e.stdout ?? ""}${e.stderr ?? ""}${e.message ?? ""}`.slice(0, 200))
}
try {
  execFileSync("node", [path.resolve("bin/bb"), "tool", "bb_edit", "--dir", root, "--args", JSON.stringify({ mode: "write", content: "x" })], { cwd: process.cwd(), encoding: "utf8", stdio: "pipe" })
  harness.check("CLI rejects write without filePath", false)
} catch (e: any) {
  const text = `${e.stdout ?? ""}${e.stderr ?? ""}${e.message ?? ""}`
  harness.check("CLI rejects write without filePath", text.includes("requires filePath"), text.slice(0, 200))
}

// ── transport: real MCP stdio ─────────────────────────────────────────────
{
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js")
  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js")
  const isBun = typeof Bun !== "undefined"
  const serverEntry = isBun ? path.resolve("src/mcp/server.ts") : path.resolve("bin/bb")
  const serverArgs = isBun ? ["--dir", root] : ["mcp", "--dir", root]
  const transport = new StdioClientTransport({ command: process.execPath, args: [serverEntry, ...serverArgs], cwd: process.cwd(), stderr: "pipe" })
  const client = new Client({ name: "verify-edit-boundary", version: "1.0.0" })
  const call = async (args: Record<string, unknown>) => {
    const res: any = await client.callTool({ name: "bb_edit", arguments: args })
    const text = (res?.content ?? []).map((c: any) => c.text ?? "").join("\n")
    return { text, isError: res?.isError ?? false }
  }
  try {
    await client.connect(transport)
    const valid = await call({ mode: "write", dryRun: true, filePath: "src/mcp-new.ts", content: "export const mcpBoundary = true\n" })
    harness.check("MCP accepts valid write dry-run", !valid.isError && valid.text.includes('"dryRun": true'), valid.text.slice(0, 160))
    const invalid = await call({ mode: "write", content: "x" })
    harness.check("MCP rejects write without filePath", invalid.isError && invalid.text.includes("requires filePath"), invalid.text.slice(0, 160))
  } catch (e) {
    harness.check("MCP bb_edit boundary session", false, e instanceof Error ? e.message : String(e))
  } finally {
    try { await client.close() } catch {}
  }
}

rmSync(root, { recursive: true, force: true })
rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true })

harness.emit()
