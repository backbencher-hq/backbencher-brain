// script/m31/tool-mode-corpus.ts — M31.T1
// Observed-behavior corpus: invoke every executable mode of all eleven public
// tools through the REAL dispatch path — validateToolArguments (the registry's
// validation layer, exactly what the MCP server runs) followed by the real
// handler with the server's try/catch error mapping. No mocks. The structural
// snapshot written here is the behavioral baseline M31.D2/D3 gates diff against.
//
// Determinism: fresh temp fixture per run, timestamps/durations/paths redacted
// before persisting, embedding API forced off (local fallback recorded honestly).
//
// Negative coverage: for every tool, invalid-input invocations must produce the
// documented error shape (isError text, never a throw, never silent success).

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const BASELINE = path.join(ROOT, "validation/m31/results/tool-mode-corpus.json")
// --check (M31 gate entry): regenerate against the LIVE tree into a .fresh file
// and diff against the committed baseline; any structural behavior change is a
// nonzero exit with named drifting invocations.
// BB_M31_CORPUS_CHECK_ONLY (self-test seam) must be honored at module load —
// before WRITE_TARGET is derived — so self-test runs can NEVER write the real
// baseline (a mutated run writing the real file would poison it).
const CHECK = process.argv.includes("--check") || process.env.BB_M31_CORPUS_CHECK_ONLY === "1"
const WRITE_TARGET = CHECK ? BASELINE + ".fresh" : BASELINE

delete process.env.BB_EMBEDDING_BASE_URL
delete process.env.BB_EMBEDDING_API_KEY
delete process.env.BB_EMBEDDING_MODEL

let checks = 0
let passed = 0
let failed = 0
function check(label: string, ok: boolean, detail = "") {
  checks++
  if (ok) passed++
  else {
    failed++
    console.log(`FAIL: ${label}${detail ? ` — ${detail}` : ""}`)
  }
}

function buildFixture(): string {
  const root = mkdtempSync(path.join(tmpdir(), "bb-m31-corpus-"))
  mkdirSync(path.join(root, "src"), { recursive: true })
  mkdirSync(path.join(root, "gen"), { recursive: true })
  writeFileSync(path.join(root, "src", "user-service.ts"), [
    "export interface User { id: number; name: string }",
    "export function findUser(users: User[], id: number): User | undefined {",
    "  return users.find((u) => u.id === id)",
    "}",
    "export function deleteUser(users: User[], id: number): boolean {",
    "  const before = users.length",
    "  const kept = users.filter((u) => u.id !== id)",
    "  users.length = 0",
    "  users.push(...kept)",
    "  return users.length < before",
    "}",
    "",
  ].join("\n"))
  writeFileSync(path.join(root, "src", "billing.py"), [
    "class Invoice:",
    '    """Billing document for a customer."""',
    "",
    "    def total(self, items):",
    '        """Sum of item prices."""',
    "        return sum(item.price for item in items)",
    "",
    "def refund(invoice, amount):",
    '    """Refund part of an invoice."""',
    "    return invoice.total([]) - amount",
    "",
  ].join("\n"))
  writeFileSync(path.join(root, "src", "Order.java"), [
    "package shop;",
    "public class Order {",
    "  private int total;",
    "  public int getTotal() { return total; }",
    "  public void addItem(int price) { total += price; }",
    "}",
    "",
  ].join("\n"))
  writeFileSync(path.join(root, "src", "cart.rb"), [
    "class Cart",
    "  def initialize",
    "    @items = []",
    "  end",
    "",
    "  def add(item)",
    "    @items << item",
    "  end",
    "",
    "  def count",
    "    @items.size",
    "  end",
    "end",
    "",
  ].join("\n"))
  writeFileSync(path.join(root, "src", "Widget.vue"), [
    "<template>",
    "  <div class=\"widget\">{{ label }}</div>",
    "</template>",
    "<script>",
    "export default {",
    "  name: 'Widget',",
    "  data() { return { label: 'w' } },",
    "}",
    "</script>",
    "",
  ].join("\n"))
  writeFileSync(path.join(root, "README.md"), "# corpus fixture\n")
  // files bb_edit write / bb_index single-file target
  writeFileSync(path.join(root, "gen", "write-me.ts"), "export const w = 0\n")
  writeFileSync(path.join(root, "gen", "agent-fresh.ts"), "export function freshlyMade(): number { return 42 }\n")
  return root
}

type ToolResult = { content: { text: string }[]; isError?: boolean }
type Invocation = { tool: string; mode: string; args: Record<string, unknown>; note?: string }

const INVOCATIONS: Invocation[] = [
  { tool: "bb_search", mode: "symbols", args: { mode: "symbols", query: "User" } },
  { tool: "bb_search", mode: "content", args: { mode: "content", query: "invoice" } },
  { tool: "bb_search", mode: "symbol", args: { mode: "symbol", symbolName: "findUser" } },
  { tool: "bb_search", mode: "file", args: { mode: "file", filePath: "src/user-service.ts" } },
  { tool: "bb_ask", mode: "answer", args: { query: "where are users deleted" }, note: "no-key local fallback (API deliberately not configured)" },
  { tool: "bb_health", mode: "status", args: {} },
  { tool: "bb_health", mode: "refresh", args: { refresh: true }, note: "refresh mutates only index data; fresh index = nothing to do" },
  { tool: "bb_patterns", mode: "orphaned", args: { scope: "orphaned" } },
  { tool: "bb_patterns", mode: "all", args: { scope: "all" } },
  { tool: "bb_security", mode: "findings", args: {} },
  { tool: "bb_visualize", mode: "project", args: { scope: "project", format: "json" } },
  { tool: "bb_visualize", mode: "file", args: { scope: "file", target: "src/user-service.ts", format: "json" } },
  { tool: "bb_visualize", mode: "symbol", args: { scope: "symbol", target: "findUser", format: "json" } },
  { tool: "bb_visualize", mode: "module", args: { scope: "module", target: "src", format: "json" } },
  { tool: "bb_visualize", mode: "feature", args: { scope: "feature", target: "billing", format: "json" } },
  { tool: "bb_migrate", mode: "plan", args: { symbolName: "findUser", targetLanguage: "python" } },
  { tool: "bb_analyze", mode: "callers", args: { mode: "callers", target: "deleteUser" } },
  { tool: "bb_analyze", mode: "callees", args: { mode: "callees", target: "deleteUser" } },
  { tool: "bb_analyze", mode: "trace", args: { mode: "trace", target: "deleteUser" } },
  { tool: "bb_analyze", mode: "dependencies", args: { mode: "dependencies", filePath: "src/user-service.ts" } },
  { tool: "bb_analyze", mode: "stats", args: { mode: "stats" } },
  { tool: "bb_analyze", mode: "complexity", args: { mode: "complexity" } },
  { tool: "bb_analyze", mode: "impact", args: { mode: "impact", target: "findUser" } },
  { tool: "bb_analyze", mode: "test_mapping", args: { mode: "test_mapping" } },
  { tool: "bb_analyze", mode: "test_gaps", args: { mode: "test_gaps" } },
  { tool: "bb_analyze", mode: "test_impact", args: { mode: "test_impact", target: "findUser" } },
  { tool: "bb_analyze", mode: "test_quality", args: { mode: "test_quality" } },
  { tool: "bb_doc", mode: "symbol", args: { mode: "symbol", target: "findUser" } },
  { tool: "bb_doc", mode: "file", args: { mode: "file", target: "src/billing.py" } },
  { tool: "bb_doc", mode: "module", args: { mode: "module", target: "src" } },
  { tool: "bb_doc", mode: "feature", args: { mode: "feature", target: "billing" } },
  { tool: "bb_doc", mode: "api", args: { mode: "api" } },
  { tool: "bb_doc", mode: "project", args: { mode: "project" } },
  { tool: "bb_doc", mode: "coverage", args: { mode: "coverage" } },
  { tool: "bb_edit", mode: "write", args: { mode: "write", filePath: "gen/write-me.ts", content: "export const w = 1\n", dryRun: false } },
  { tool: "bb_edit", mode: "update", args: { mode: "update", symbolName: "refund", filePath: "src/billing.py", newContent: "def refund(invoice, amount):\n    return amount\n", dryRun: true }, note: "dryRun — no disk mutation" },
  { tool: "bb_edit", mode: "insert", args: { mode: "insert", targetSymbolName: "getTotal", filePath: "src/Order.java", position: "inside-top", newContent: "int stamp = 0;", dryRun: true }, note: "dryRun" },
  { tool: "bb_edit", mode: "delete", args: { mode: "delete", symbolName: "addItem", filePath: "src/Order.java", dryRun: true }, note: "dryRun" },
  { tool: "bb_edit", mode: "refactor", args: { mode: "refactor", symbolName: "findUser", newName: "findUserById", dryRun: true }, note: "dryRun" },
  { tool: "bb_index", mode: "file", args: { path: "gen/agent-fresh.ts" }, note: "single-file reindex" },
  { tool: "bb_index", mode: "auto", args: { path: "gen/agent-fresh.ts" }, note: "auto resolves to file for a file path" },
  { tool: "bb_index", mode: "dir", args: { path: "src" }, note: "incremental dir index" },
]

const NEGATIVES: Invocation[] = [
  { tool: "bb_search", mode: "missing-query", args: { mode: "symbols" } },
  { tool: "bb_search", mode: "unindexed-file", args: { mode: "file", filePath: "nope.ts" } },
  { tool: "bb_ask", mode: "empty-query", args: { query: "" } },
  { tool: "bb_ask", mode: "missing-query", args: {} },
  { tool: "bb_health", mode: "unknown-option", args: { refreshMode: "x" } },
  { tool: "bb_health", mode: "bad-sample", args: { sampleSize: -5 } },
  { tool: "bb_patterns", mode: "bad-scope", args: { scope: "nonexistent" } },
  { tool: "bb_patterns", mode: "bad-confidence", args: { scope: "orphaned", confidenceThreshold: 42 } },
  { tool: "bb_security", mode: "unknown-option", args: { scanMode: "x" } },
  { tool: "bb_security", mode: "bad-history-limit", args: { history: true, limit: -1 } },
  { tool: "bb_visualize", mode: "bad-scope", args: { scope: "galaxy", target: "x" } },
  { tool: "bb_visualize", mode: "missing-target", args: { scope: "symbol" } },
  { tool: "bb_migrate", mode: "missing-language", args: { symbolName: "findUser" } },
  { tool: "bb_migrate", mode: "missing-symbols", args: { targetLanguage: "python" } },
  { tool: "bb_analyze", mode: "bad-mode", args: { mode: "vibes" } },
  { tool: "bb_analyze", mode: "missing-target", args: { mode: "callers" } },
  { tool: "bb_doc", mode: "bad-mode", args: { mode: "vibes" } },
  { tool: "bb_doc", mode: "missing-target", args: { mode: "symbol" } },
  { tool: "bb_edit", mode: "bad-mode", args: { mode: "vibes" } },
  { tool: "bb_edit", mode: "path-escape", args: { mode: "write", filePath: "../outside.ts", content: "x" } },
  { tool: "bb_index", mode: "missing-path", args: {} },
  { tool: "bb_index", mode: "missing-file", args: { path: "no/such.ts" } },
  { tool: "bb_graph", mode: "missing-symbol", args: {} },
  { tool: "bb_graph", mode: "bad-depth", args: { symbol: "handleRequest", maxDepth: 99 } },
  { tool: "bb_impact", mode: "missing-symbol", args: {} },
  { tool: "bb_cross_language", mode: "missing-symbol", args: {} },
  { tool: "bb_annotate", mode: "missing-symbol", args: { body: "note" } },
  { tool: "bb_annotate", mode: "empty-body", args: { symbol: "handleRequest", body: "" } },
  { tool: "bb_annotate", mode: "over-limit-body", args: { symbol: "handleRequest", body: "x".repeat(2001) } },
  { tool: "bb_annotations", mode: "bad-limit", args: { limit: 500 } },
]

function redact(value: unknown): unknown {
  if (typeof value === "string") {
    return value
      .replace(/\/tmp\/bb-m31-corpus-[^"'\s\\]*/g, "<TMP>")
      .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z?/g, "<TS>")
      .replace(/\b\d+ms\b/g, "<DUR>")
      .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<UUID>")
      .replace(/\b[0-9a-f]{40}\b/g, "<SHA1>")
  }
  if (Array.isArray(value)) return value.map(redact)
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (/^(duration|elapsed|tookMs|generatedAt|timestamp|indexedAt|time_.*|_time.*)$/i.test(k)) { out[k] = "<REDACTED>"; continue }
      out[k] = redact(v)
    }
    return out
  }
  return value
}

function shapeOfItem(item: unknown): unknown {
  if (Array.isArray(item)) return { array: item.length }
  if (item && typeof item === "object") return { object: Object.keys(item as Record<string, unknown>).sort() }
  return typeof item
}
function topLevelScalars(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) if (v === null || typeof v !== "object") out[k] = v
  return out
}
function shape(result: ToolResult): unknown {
  const text = result.content?.[0]?.text ?? ""
  const parsed = (() => { try { return JSON.parse(text) } catch { return null } })()
  if (parsed === null) return { kind: result.isError ? "error-text" : "text", textHead: redact(text.slice(0, 160)) }
  if (Array.isArray(parsed)) return { kind: "json-array", length: parsed.length, itemShape: parsed.length ? shapeOfItem(parsed[0]) : null }
  // arrayItemKeys: keys of the first item of each top-level array field —
  // output-field documentation often describes item fields (e.g. matches[].symbolName).
  const arrayItemKeys: Record<string, string[]> = {}
  for (const [k, v] of Object.entries(parsed)) {
    if (Array.isArray(v) && v.length > 0 && v[0] && typeof v[0] === "object" && !Array.isArray(v[0])) {
      arrayItemKeys[k] = Object.keys(v[0] as Record<string, unknown>).sort()
    }
  }
  return { kind: "json-object", keys: Object.keys(parsed).sort(), scalars: redact(topLevelScalars(parsed)), arrayItemKeys }
}

async function main() {
  // Self-test seam: honored at module load above (CHECK) so this run writes
  // .fresh and never the real baseline.
  const { getProjectId } = await import(path.join(ROOT, "src/cli/index"))
  const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer"))
  const { createToolHandlers } = await import(path.join(ROOT, "src/mcp/tool-handlers"))
  const { validateToolArguments } = await import(path.join(ROOT, "src/mcp/tool-validation"))
  const { PUBLIC_TOOL_DESCRIPTORS, TOOL_DESCRIPTORS } = await import(path.join(ROOT, "src/mcp/tool-registry"))

  const fixture = buildFixture()
  const projectId = (getProjectId as (p: string) => string)(fixture)
  const context = { projectPath: fixture, projectId }
  const handlers = createToolHandlers()
  const descriptors = new Map(TOOL_DESCRIPTORS.map((d) => [d.name as string, d]))

  const indexStats = await indexProjectParallel(projectId as any, fixture, { skipPostProcessing: false })
  check("fixture indexes without errors", indexStats.errorFiles === 0, `errors=${indexStats.errorFiles}`)
  // Determinism gate (M35 pre-work): the background embedding queue (M21.E2)
  // writes embeddings asynchronously. bb_doc.feature's semantic expansion
  // returns a DIFFERENT evidence set depending on whether those writes landed
  // before dispatch — an observed run-to-run baseline flip. Drain the queue
  // deterministically (bounded, never hangs) before any tool runs.
  const { flushBackgroundEmbeddings } = await import(path.join(ROOT, "src/ast/parallel-indexer"))
  const flush = await flushBackgroundEmbeddings({ timeoutMs: 30_000 })
  check("embedding queue drained deterministically", flush.resolved === "drained", JSON.stringify(flush))

  /** The REAL dispatch sequence from src/mcp/server.ts — validation inside try/catch. */
  async function dispatch(tool: string, args: Record<string, unknown>): Promise<ToolResult> {
    const descriptor = descriptors.get(tool)
    const handler = handlers[tool]
    if (!descriptor || !handler) return { content: [{ type: "text", text: `unknown tool: ${tool}` }], isError: true }
    try {
      const validated = validateToolArguments(descriptor, args)
      return await handler(validated, context)
    } catch (error: any) {
      return { content: [{ type: "text", text: `error: ${error?.message ?? String(error)}` }], isError: true }
    }
  }

  const toolNames = PUBLIC_TOOL_DESCRIPTORS.map((t) => t.name)
  // Derive the expected count from the live registry, not a literal: the tool
  // surface grows (M31 wave-2 lesson — the 11 literal went stale at 16).
  const expectedToolCount = PUBLIC_TOOL_DESCRIPTORS.length
  check(`all ${expectedToolCount} tools have handlers`, toolNames.length === expectedToolCount && toolNames.every((n) => typeof handlers[n] === "function"), toolNames.join(","))

  const corpus: Record<string, unknown> = {}
  const missingHandlers: string[] = []
  for (const inv of INVOCATIONS) {
    if (!handlers[inv.tool]) { missingHandlers.push(inv.tool); continue }
    let result: ToolResult
    try {
      result = await dispatch(inv.tool, inv.args)
    } catch (e) {
      check(`${inv.tool}[${inv.mode}]: dispatch never throws`, false, String((e as Error).message).slice(0, 160))
      corpus[`${inv.tool}.${inv.mode}`] = { threw: String((e as Error).message).slice(0, 300) }
      continue
    }
    check(`${inv.tool}[${inv.mode}]: returns content`, Array.isArray(result.content) && result.content.length > 0)
    if (result.isError) {
      corpus[`${inv.tool}.${inv.mode}`] = { kind: "reported-error", head: redact(result.content[0]?.text.slice(0, 200)) }
      check(`${inv.tool}[${inv.mode}]: error result carries text`, (result.content[0]?.text ?? "").length > 0)
      continue
    }
    corpus[`${inv.tool}.${inv.mode}`] = shape(result) as unknown
  }
  check("no tool lacks a handler", missingHandlers.length === 0, missingHandlers.join(","))

  const negatives: Record<string, unknown> = {}
  for (const inv of NEGATIVES) {
    let result: ToolResult | null = null
    let threw = false
    try {
      result = await dispatch(inv.tool, inv.args)
    } catch (e) {
      threw = true
      negatives[`${inv.tool}.${inv.mode}`] = { threw: String((e as Error).message).slice(0, 200) }
    }
    if (threw || !result) {
      check(`${inv.tool}[${inv.mode}]: invalid input does not throw`, false, String((negatives[`${inv.tool}.${inv.mode}`] as { threw?: string } | undefined)?.threw ?? ""))
      continue
    }
    const isErr = result.isError === true
    negatives[`${inv.tool}.${inv.mode}`] = isErr
      ? { isError: true, head: redact(result.content[0]?.text.slice(0, 160)) }
      : { isError: false, head: redact(result.content[0]?.text.slice(0, 160)) }
    check(`${inv.tool}[${inv.mode}]: invalid input answered with structured error`, isErr, (result.content[0]?.text ?? "").slice(0, 120))
  }

  const baseline = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    environment: {
      embeddingProvider: "local-fallback (API keys deliberately absent)",
      fixtureLanguages: ["typescript", "python", "java", "ruby", "vue"],
      dispatchPath: "validateToolArguments -> handler (server.ts sequence)",
    },
    validInvocations: INVOCATIONS.length,
    negativeInvocations: NEGATIVES.length,
    corpus,
    negatives,
  }
  mkdirSync(path.dirname(WRITE_TARGET), { recursive: true })
  writeFileSync(WRITE_TARGET, JSON.stringify(baseline, null, 2) + "\n")
  rmSync(fixture, { recursive: true, force: true })
  console.log(`M31 TOOL-MODE CORPUS: ${failed === 0 ? "PASS" : "FAIL"} (${passed}/${checks}) — ${INVOCATIONS.length} valid + ${NEGATIVES.length} negative invocations`)
  if (failed !== 0) process.exit(1)
  if (!CHECK) process.exit(0)

  // ── check phase: diff fresh vs committed ──
  const committed = JSON.parse(readFileSync(BASELINE, "utf8")) as Record<string, unknown>
  const fresh = JSON.parse(readFileSync(WRITE_TARGET, "utf8")) as Record<string, unknown>
  delete (committed as any).generatedAt
  delete (fresh as any).generatedAt
  const cc = committed as any, ff = fresh as any
  const keys = new Set([...Object.keys(cc.corpus ?? {}), ...Object.keys(ff.corpus ?? {}), ...Object.keys(cc.negatives ?? {}), ...Object.keys(ff.negatives ?? {})])
  const drift = [...keys].filter((k) =>
    JSON.stringify((cc.corpus ?? {})[k]) !== JSON.stringify((ff.corpus ?? {})[k]) ||
    JSON.stringify((cc.negatives ?? {})[k]) !== JSON.stringify((ff.negatives ?? {})[k]))
  if (drift.length > 0) {
    console.error(`CORPUS CHECK: FAIL — behavior drifted from committed baseline. Drifting invocations: ${drift.slice(0, 10).join(", ")}${drift.length > 10 ? ` (+${drift.length - 10} more)` : ""}`)
    process.exit(1)
  }
  console.log("CORPUS CHECK: PASS — observed behavior matches committed baseline")
  // M31.T1 evidence envelope (same contract as every M21/M31 verifier evidence file)
  const { execFileSync } = await import("node:child_process")
  const evidence = {
    status: "verified",
    currentCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(),
    workingTreeRelevantChanges: [] as string[],
    verifierCommand: "bun run script/m31/tool-mode-corpus.ts --check",
    evidenceFile: "T1.json",
    generatedAt: new Date().toISOString(),
    passed: checks,
    failed: 0,
    negativeCases: NEGATIVES.length,
  }
  if (process.env.BB_M31_EVIDENCE === "1") writeFileSync(BASELINE.replace("tool-mode-corpus.json", "T1.json"), JSON.stringify(evidence, null, 2) + "\n")
  process.exit(0)
}

main().catch((e) => {
  console.error("CORPUS FATAL:", e)
  process.exit(1)
})

