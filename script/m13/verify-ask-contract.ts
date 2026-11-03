// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the bb_ask contract gate: executable modes are exactly [answer];
//   `explain`/`feature` are planned and rejected as unknown options; an empty query is
//   refused at the validation boundary in BOTH transports (source MCP stdio + source
//   CLI); a page size outside 1..100 is refused with the door's own words; and every
//   answer carries provenance and declared bounds.
// WHICH TOOL IT SERVES — bb_ask (read, requiresIndex true, modes: answer).
// WHY IT IS SHAPED THIS WAY — the gate runs from SOURCE under both bun and node, and it
//   forwards its environment to the stdio child: the SDK sanitizes the child env and
//   drops BB_DATA_DIR, so without forwarding the leg either measured the user's real
//   index or failed with "No index found" — a false red.
// WHERE ITS EVIDENCE LIVES — validation/m13/results/a1.json (harness default) and
//   validation/tools/bb_ask/gates/ (lane snapshot), docs/tools/bb_ask.md.
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/mcp/tools/bb_ask/{descriptor,handler}.ts,
//   src/intelligence/search/quick-answer.ts, verify-ask-stdio-entry.ts,
//   validation/tools/bb_ask/work/run-gates.mjs.
// CONTRACTS IT MUST NOT BREAK — one rule two doors; a refusal is isError with the named
//   message; no auto-pass assertions; evidence emitted with at least one negative.
// ─────────────────────────────────────────────────────────────────────────────

import { execFileSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { getProjectId } from "../../src/util/project-id"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { PUBLIC_TOOL_DESCRIPTORS } from "../../src/mcp/tool-registry"
import { validateToolArguments } from "../../src/mcp/tool-validation"
import { createToolHandlers } from "../../src/mcp/tool-handlers"
import { ASK_LIMIT_REFUSAL } from "../../src/intelligence/search/quick-answer"
import { Harness } from "./harness"

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const TSX_CLI = path.join(REPO_ROOT, "node_modules", "tsx", "dist", "cli.mjs")
const isBun = typeof (globalThis as any).Bun !== "undefined"

const harness = new Harness({
  issue: "M13.23",
  code: "A1",
  tool: "bb_ask",
  title: "bb_ask: contract (answer vs explain/feature) + empty-query and limit boundaries",
  layers: ["unit", "e2e"],
  decisions: {
    modes: "executable modes are exactly [answer]; explain/feature are plannedModes and are rejected as unknown options",
    boundary: "empty/whitespace query and limit outside 1..100 are refused by validateToolArguments (shared by MCP and CLI) with the same words the handler emits",
    envelope: "answer responses always carry provenance and declared bounds; no match list is invented",
  },
  limitations: [
    "The gate drives the SOURCE CLI/MCP entries (dist/ is a build artifact, rebuilt centrally).",
    "The corpus leg lives in verify-ask-e2e-corpus; this gate is a small fixture by design.",
  ],
})

// ── 1. Registry contract ───────────────────────────────────────────────────
const descriptor = PUBLIC_TOOL_DESCRIPTORS.find((tool) => tool.name === "bb_ask")!
harness.check("registry: executable modes are exactly [answer]", JSON.stringify(descriptor.modes) === JSON.stringify(["answer"]), JSON.stringify(descriptor.modes))
harness.check("registry: explain and feature are plannedModes (not executable)", (descriptor.plannedModes ?? []).includes("explain") && (descriptor.plannedModes ?? []).includes("feature"), JSON.stringify(descriptor.plannedModes))
harness.check("registry: no `mode` input property (not mode-discriminated)", !(descriptor.inputSchema as any).properties?.mode, "mode property present")
harness.check("registry: query is required", ((descriptor.inputSchema as any).required ?? []).includes("query"))
harness.check("registry: mutability is read + requiresIndex true", descriptor.mutability === "read" && descriptor.requiresIndex === true)
{
  const limit = (descriptor.inputSchema as any).properties?.limit
  harness.check("registry: limit declares default 5 and range 1..100 in prose", /default 5/.test(limit?.description ?? "") && /1\.\.100/.test(limit?.description ?? ""), String(limit?.description).slice(0, 140))
  harness.check("registry: limit carries machine-readable minimum/maximum", limit?.minimum === 1 && limit?.maximum === 100, `min=${limit?.minimum} max=${limit?.maximum}`)
}

// ── 2. Validation boundary (unit, no transports) ───────────────────────────
const emptyError = (() => { try { validateToolArguments(descriptor, { query: "" }); return "" } catch (e: any) { return String(e) } })()
harness.check("validation: empty query rejected", emptyError.includes("non-empty query"), emptyError.slice(0, 100))
const whitespaceError = (() => { try { validateToolArguments(descriptor, { query: "   " }); return "" } catch (e: any) { return String(e) } })()
harness.check("validation: whitespace-only query rejected", whitespaceError.includes("non-empty query"), whitespaceError.slice(0, 100))
const modeError = (() => { try { validateToolArguments(descriptor, { query: "x", mode: "explain" }); return "" } catch (e: any) { return String(e) } })()
harness.negative("validation: mode=explain rejected as unknown option (not executable)", modeError.includes("unknown or irrelevant options"), modeError.slice(0, 100))
const missingError = (() => { try { validateToolArguments(descriptor, {}); return "" } catch (e: any) { return String(e) } })()
harness.check("validation: missing query rejected", missingError.includes("missing required option"), missingError.slice(0, 100))
// 0 and >100 are the page-size rule; -1 and 2.5 are refused earlier by the shared
// whole-number/non-negative rule. Both are named refusals — none is clamped.
const LIMIT_REFUSALS: Array<{ value: number; fragment: string }> = [
  { value: 0, fragment: "limit must be a whole number between 1 and 100" },
  { value: 101, fragment: "limit must be a whole number between 1 and 100" },
  { value: -1, fragment: "limit must be non-negative" },
  { value: 2.5, fragment: "limit must be a whole number" },
]
for (const bad of LIMIT_REFUSALS) {
  const error = (() => { try { validateToolArguments(descriptor, { query: "x", limit: bad.value }); return "" } catch (e: any) { return String(e) } })()
  harness.negative(`validation: limit=${JSON.stringify(bad.value)} refused by name, never clamped`, error.includes(bad.fragment), error.slice(0, 140))
}

// ── 3. Runtime: both transports, from source ───────────────────────────────
const root = mkdtempSync(path.join(tmpdir(), "bb-ask-contract-"))
const projectId = getProjectId(root)
mkdirSync(path.join(root, "src"), { recursive: true })
writeFileSync(path.join(root, "src", "app.ts"), "export function handleRequest(): string { return \"ok\" }\n")
await indexProjectParallel(projectId, root, {})

const cliPrefix = isBun ? [path.join(REPO_ROOT, "src", "cli", "index.ts")] : [TSX_CLI, path.join(REPO_ROOT, "src", "cli", "index.ts")]
function cli(args: Record<string, unknown>): { text: string; ok: boolean } {
  try {
    const out = execFileSync(process.execPath, [...cliPrefix, "tool", "bb_ask", "--dir", root, "--args", JSON.stringify(args)], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: "pipe",
      env: { ...process.env },
    })
    return { text: out, ok: true }
  } catch (e: any) {
    return { text: `${e.stdout ?? ""}${e.stderr ?? ""}${e.message ?? ""}`, ok: false }
  }
}
{
  const r = cli({ query: "how does request handling work?" })
  harness.check("CLI (source entry): valid query returns an answer with provenance and bounds", r.ok && r.text.includes("[provenance:") && r.text.includes("[bounds:"), r.text.slice(0, 180))
  const empty = cli({ query: "" })
  harness.negative("CLI (source entry): empty query rejected", !empty.ok && empty.text.includes("non-empty query"), empty.text.slice(0, 140))
  const explain = cli({ query: "x", mode: "explain" })
  harness.negative("CLI (source entry): mode=explain rejected as unknown option", !explain.ok && explain.text.includes("unknown or irrelevant options"), explain.text.slice(0, 140))
  const zero = cli({ query: "x", limit: 0 })
  harness.negative("CLI (source entry): limit=0 refused with the page-size rule", !zero.ok && zero.text.includes(ASK_LIMIT_REFUSAL), zero.text.slice(0, 180))
  const over = cli({ query: "x", limit: 101 })
  harness.negative("CLI (source entry): limit=101 refused with the page-size rule", !over.ok && over.text.includes(ASK_LIMIT_REFUSAL), over.text.slice(0, 180))
}

// Handler-level refusal: a library caller that bypasses the door meets the same rule.
{
  const handler = createToolHandlers().bb_ask
  const zero = (await handler({ query: "request handling", limit: 0 }, { projectId, projectPath: root } as any)) as any
  const zeroText = (zero?.content ?? []).map((c: any) => c.text ?? "").join("\n")
  harness.negative("handler: limit=0 refused with the same sentence the door uses", zero?.isError === true && zeroText.includes(ASK_LIMIT_REFUSAL), zeroText.slice(0, 180))
  const over = (await handler({ query: "request handling", limit: 101 }, { projectId, projectPath: root } as any)) as any
  const overText = (over?.content ?? []).map((c: any) => c.text ?? "").join("\n")
  harness.negative("handler: limit=101 refused with the same sentence the door uses", over?.isError === true && overText.includes(ASK_LIMIT_REFUSAL), overText.slice(0, 180))
}

// MCP stdio transport, source entry, environment forwarded.
{
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js")
  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js")
  const serverEntry = path.join(REPO_ROOT, "script", "m13", "verify-ask-stdio-entry.ts")
  const serverCommand = isBun ? [path.join(REPO_ROOT, "src", "mcp", "server.ts"), "--dir", root] : [TSX_CLI, serverEntry, "--dir", root]
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: serverCommand,
    cwd: REPO_ROOT,
    stderr: "pipe",
    // The SDK sanitizes the child environment; forward everything so BB_DATA_DIR reaches
    // the server and the probe reads the same index it measured.
    env: { ...process.env } as Record<string, string>,
  })
  const client = new Client({ name: "verify-ask-contract", version: "1.0.0" })
  const call = async (args: Record<string, unknown>) => {
    const res: any = await client.callTool({ name: "bb_ask", arguments: args })
    const text = (res?.content ?? []).map((c: any) => c.text ?? "").join("\n")
    return { text, isError: res?.isError ?? false }
  }
  try {
    await client.connect(transport)
    const ok = await call({ query: "how does request handling work?" })
    harness.check("MCP (source entry): valid query returns an answer with provenance and bounds", !ok.isError && ok.text.includes("[provenance:") && ok.text.includes("[bounds:"), ok.text.slice(0, 180))
    const empty = await call({ query: "" })
    harness.negative("MCP (source entry): empty query rejected", empty.isError && empty.text.includes("non-empty query"), empty.text.slice(0, 140))
    const explain = await call({ query: "x", mode: "explain" })
    harness.negative("MCP (source entry): mode=explain rejected as unknown option", explain.isError && explain.text.includes("unknown or irrelevant options"), explain.text.slice(0, 140))
    const zero = await call({ query: "x", limit: 0 })
    harness.negative("MCP (source entry): limit=0 refused with the page-size rule", zero.isError && zero.text.includes(ASK_LIMIT_REFUSAL), zero.text.slice(0, 180))
    const over = await call({ query: "x", limit: 101 })
    harness.negative("MCP (source entry): limit=101 refused with the page-size rule", over.isError && over.text.includes(ASK_LIMIT_REFUSAL), over.text.slice(0, 180))
  } catch (e) {
    harness.check("MCP bb_ask contract session", false, e instanceof Error ? e.message : String(e))
  } finally {
    try { await client.close() } catch {}
  }
}

rmSync(root, { recursive: true, force: true })
harness.emit()
