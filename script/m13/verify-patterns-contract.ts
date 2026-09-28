// script/m13/verify-patterns-contract.ts — M13.35 (P1).
//
// bb_patterns contract: executable scopes are exactly orphaned + all;
// quality/architecture are plannedModes and must never be advertised as
// executable (registry description, enum, handler, and both transports).

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
  issue: "M13.35",
  code: "P1",
  tool: "bb_patterns",
  title: "bb_patterns: contract (orphaned vs all/quality/architecture)",
  layers: ["unit", "e2e"],
  decisions: {
    scopes: "executable scopes are exactly [orphaned, all]; quality/architecture live in plannedModes and are rejected at the boundary",
    advertising: "the registry description must not advertise quality/architecture as executable",
  },
  limitations: [
    "Framework/anti-pattern internals are the subject of M13.36; this issue locks the mode contract only.",
  ],
})

// ── 1. Registry contract ───────────────────────────────────────────────────
const descriptor = PUBLIC_TOOL_DESCRIPTORS.find((t) => t.name === "bb_patterns")!
const scopeEnum = (descriptor.inputSchema as any).properties?.scope?.enum ?? []
harness.check("registry: scope enum is exactly [orphaned, all]", JSON.stringify(scopeEnum) === JSON.stringify(["orphaned", "all"]), JSON.stringify(scopeEnum))
harness.check("registry: quality and architecture are plannedModes", (descriptor.plannedModes ?? []).includes("quality") && (descriptor.plannedModes ?? []).includes("architecture"), JSON.stringify(descriptor.plannedModes))
harness.check("registry: no quality/architecture scope advertised as executable", !scopeEnum.includes("quality") && !scopeEnum.includes("architecture"))
harness.negative(
  "registry: description does not advertise quality/architecture as executable",
  !descriptor.description.includes("architecture issues") && descriptor.description.includes("planned, not yet executable"),
  descriptor.description.slice(0, 140),
)

// ── 2. Validation boundary ─────────────────────────────────────────────────
harness.check("validation: scope=orphaned accepted", (() => { try { validateToolArguments(descriptor, { scope: "orphaned" }); return true } catch { return false } })())
harness.check("validation: scope=all accepted", (() => { try { validateToolArguments(descriptor, { scope: "all" }); return true } catch { return false } })())
const qualityErr = (() => { try { validateToolArguments(descriptor, { scope: "quality" }); return "" } catch (e: any) { return String(e) } })()
harness.negative("validation: scope=quality rejected as invalid enum", qualityErr.includes("scope") && qualityErr.length > 0, qualityErr.slice(0, 100))

// ── 3. Runtime: both transports ────────────────────────────────────────────
const root = mkdtempSync(path.join(tmpdir(), "bb-patterns-contract-"))
const projectId = getProjectId(root)
mkdirSync(path.join(root, "src"), { recursive: true })
writeFileSync(path.join(root, "src", "app.ts"), "export function used(): number { return 1 }\nexport function orphanedFn(): number { return 2 }\n")
await indexProjectParallel(projectId, root, {})

// CLI
const bb = path.resolve("bin/bb")
function cli(args: Record<string, unknown>): { text: string; ok: boolean } {
  try {
    const out = execFileSync("node", [bb, "tool", "bb_patterns", "--dir", root, "--args", JSON.stringify(args)], { cwd: process.cwd(), encoding: "utf8", stdio: "pipe" })
    return { text: out, ok: true }
  } catch (e: any) {
    return { text: `${e.stdout ?? ""}${e.stderr ?? ""}${e.message ?? ""}`, ok: false }
  }
}
{
  const r = cli({ scope: "orphaned", limit: 10 })
  harness.check("CLI: scope=orphaned runs and returns a provenance-bearing report", r.ok && r.text.includes("provenance"), r.text.slice(0, 160))
  const quality = cli({ scope: "quality" })
  harness.negative("CLI: scope=quality rejected as invalid enum", !quality.ok && quality.text.includes("scope"), quality.text.slice(0, 140))
}

// MCP stdio
{
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js")
  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js")
  const isBun = typeof Bun !== "undefined"
  const serverEntry = isBun ? path.resolve("src/mcp/server.ts") : path.resolve("bin/bb")
  const serverArgs = isBun ? ["--dir", root] : ["mcp", "--dir", root]
  const transport = new StdioClientTransport({ command: process.execPath, args: [serverEntry, ...serverArgs], cwd: process.cwd(), stderr: "pipe" })
  const client = new Client({ name: "verify-patterns-contract", version: "1.0.0" })
  const call = async (args: Record<string, unknown>) => {
    const res: any = await client.callTool({ name: "bb_patterns", arguments: args })
    return { text: (res?.content ?? []).map((c: any) => c.text ?? "").join("\n"), isError: res?.isError ?? false }
  }
  try {
    await client.connect(transport)
    const r = await call({ scope: "all", limit: 10 })
    harness.check("MCP: scope=all runs and returns a report", !r.isError && r.text.length > 0, r.text.slice(0, 160))
    const quality = await call({ scope: "quality" })
    harness.negative("MCP: scope=quality rejected as invalid enum", quality.isError && quality.text.includes("scope"), quality.text.slice(0, 140))
  } catch (e) {
    harness.check("MCP bb_patterns contract session", false, e instanceof Error ? e.message : String(e))
  } finally {
    try { await client.close() } catch {}
  }
}

rmSync(root, { recursive: true, force: true })
harness.emit()
