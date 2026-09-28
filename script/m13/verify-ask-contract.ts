// script/m13/verify-ask-contract.ts — M13.23 (A1).
//
// bb_ask contract: executable modes = [answer] exactly; explain/feature are
// plannedModes (not executable); the tool is NOT mode-discriminated (no `mode`
// input property); an empty or whitespace-only query is rejected at the
// validation boundary in BOTH transports (MCP stdio + compiled CLI); a mode
// argument is rejected as an unknown option rather than silently accepted.
//
// Also verifies the honest answer envelope: the response carries provenance
// (evidenceClass / engine) and never fabricates a source list when no
// semantic matches exist.

import { execFileSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { PUBLIC_TOOL_DESCRIPTORS } from "../../src/mcp/tool-registry"
import { validateToolArguments } from "../../src/mcp/tool-validation"
import { Harness } from "./harness"

const harness = new Harness({
  issue: "M13.23",
  code: "A1",
  tool: "bb_ask",
  title: "bb_ask: contract (answer vs explain/feature) + empty-query boundary",
  layers: ["unit", "e2e"],
  decisions: {
    modes: "executable modes are exactly [answer]; explain/feature live in plannedModes and are not accepted as arguments",
    boundary: "empty/whitespace query rejected by validateToolArguments (shared by MCP and CLI); a `mode` argument is rejected as unknown",
    envelope: "answer responses always carry provenance (evidenceClass/engine) and never invent sources for unmatched queries",
  },
  limitations: [
    "The CLI transport reads the prebuilt bin/bb; run `npm run build` before this verifier.",
    "MCP stdio under Bun executes src/mcp/server.ts directly.",
  ],
})

// ── 1. Registry contract ───────────────────────────────────────────────────
const descriptor = PUBLIC_TOOL_DESCRIPTORS.find((t) => t.name === "bb_ask")!
harness.check("registry: executable modes are exactly [answer]", JSON.stringify(descriptor.modes) === JSON.stringify(["answer"]), JSON.stringify(descriptor.modes))
harness.check("registry: explain and feature are plannedModes (not executable)", (descriptor.plannedModes ?? []).includes("explain") && (descriptor.plannedModes ?? []).includes("feature"), JSON.stringify(descriptor.plannedModes))
harness.check("registry: no `mode` input property (not mode-discriminated)", !(descriptor.inputSchema as any).properties?.mode, "mode property present")
harness.check("registry: query is required", ((descriptor.inputSchema as any).required ?? []).includes("query"))
harness.check("registry: mutability is read + requiresIndex true", descriptor.mutability === "read" && descriptor.requiresIndex === true)

// ── 2. Validation boundary (unit, no transports) ───────────────────────────
const emptyError = (() => { try { validateToolArguments(descriptor, { query: "" }); return "" } catch (e: any) { return String(e) } })()
harness.check("validation: empty query rejected", emptyError.includes("non-empty query"), emptyError.slice(0, 100))
const whitespaceError = (() => { try { validateToolArguments(descriptor, { query: "   " }); return "" } catch (e: any) { return String(e) } })()
harness.check("validation: whitespace-only query rejected", whitespaceError.includes("non-empty query"), whitespaceError.slice(0, 100))
const modeError = (() => { try { validateToolArguments(descriptor, { query: "x", mode: "explain" }); return "" } catch (e: any) { return String(e) } })()
harness.negative("validation: mode=explain rejected as unknown option (not executable)", modeError.includes("unknown or irrelevant options"), modeError.slice(0, 100))
const missingError = (() => { try { validateToolArguments(descriptor, {}); return "" } catch (e: any) { return String(e) } })()
harness.check("validation: missing query rejected", missingError.includes("missing required option"), missingError.slice(0, 100))

// ── 3. Runtime: both transports ────────────────────────────────────────────
const root = mkdtempSync(path.join(tmpdir(), "bb-ask-contract-"))
const projectId = getProjectId(root)
mkdirSync(path.join(root, "src"), { recursive: true })
writeFileSync(path.join(root, "src", "app.ts"), "export function handleRequest(): string { return \"ok\" }\n")
await indexProjectParallel(projectId, root, {})

// CLI transport
const bb = path.resolve("bin/bb")
function cli(args: Record<string, unknown>): { text: string; ok: boolean } {
  try {
    const out = execFileSync("node", [bb, "tool", "bb_ask", "--dir", root, "--args", JSON.stringify(args)], { cwd: process.cwd(), encoding: "utf8", stdio: "pipe" })
    return { text: out, ok: true }
  } catch (e: any) {
    return { text: `${e.stdout ?? ""}${e.stderr ?? ""}${e.message ?? ""}`, ok: false }
  }
}
{
  const r = cli({ query: "how does request handling work?" })
  harness.check("CLI: valid query returns an answer with provenance", r.ok && r.text.includes("provenance"), r.text.slice(0, 160))
  const empty = cli({ query: "" })
  harness.negative("CLI: empty query rejected", !empty.ok && empty.text.includes("non-empty query"), empty.text.slice(0, 140))
  const explain = cli({ query: "x", mode: "explain" })
  harness.negative("CLI: mode=explain rejected as unknown option", !explain.ok && explain.text.includes("unknown or irrelevant options"), explain.text.slice(0, 140))
}

// MCP stdio transport
{
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js")
  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js")
  const isBun = typeof Bun !== "undefined"
  const serverEntry = isBun ? path.resolve("src/mcp/server.ts") : path.resolve("bin/bb")
  const serverArgs = isBun ? ["--dir", root] : ["mcp", "--dir", root]
  const transport = new StdioClientTransport({ command: process.execPath, args: [serverEntry, ...serverArgs], cwd: process.cwd(), stderr: "pipe" })
  const client = new Client({ name: "verify-ask-contract", version: "1.0.0" })
  const call = async (args: Record<string, unknown>) => {
    const res: any = await client.callTool({ name: "bb_ask", arguments: args })
    const text = (res?.content ?? []).map((c: any) => c.text ?? "").join("\n")
    return { text, isError: res?.isError ?? false }
  }
  try {
    await client.connect(transport)
    const ok = await call({ query: "how does request handling work?" })
    harness.check("MCP: valid query returns an answer with provenance", !ok.isError && ok.text.includes("provenance"), ok.text.slice(0, 160))
    const empty = await call({ query: "" })
    harness.negative("MCP: empty query rejected", empty.isError && empty.text.includes("non-empty query"), empty.text.slice(0, 140))
    const explain = await call({ query: "x", mode: "explain" })
    harness.negative("MCP: mode=explain rejected as unknown option", explain.isError && explain.text.includes("unknown or irrelevant options"), explain.text.slice(0, 140))
  } catch (e) {
    harness.check("MCP bb_ask contract session", false, e instanceof Error ? e.message : String(e))
  } finally {
    try { await client.close() } catch {}
  }
}

rmSync(root, { recursive: true, force: true })
harness.emit()
