// Phase A MCP-door evidence for bb_migrate on the T0 polyglot index:
// one success case and the full refusal matrix, through the real stdio door.
import { writeFileSync } from "node:fs"
import path from "node:path"
import { openDoor } from "./door"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")
const FIXTURE = path.join(ROOT, "test/fixtures/polyglot")
const DATA_DIR = path.join(ROOT, "validation/tools/bb_migrate/bbdata")
const door = await openDoor({ dir: FIXTURE, dataDir: DATA_DIR, label: "phaseA-t0" })

const tool = door.tools.find((t: any) => t.name === "bb_migrate")
const initStarted = Date.now()
const results: any[] = []
const record = (id: string, extra: Record<string, unknown>) => { results.push({ id, ...extra }); console.log(JSON.stringify({ id, ...extra })) }

record("tools-list", {
  toolCount: door.tools.length,
  present: !!tool,
  description: tool?.description?.slice(0, 120),
  params: tool ? Object.keys(tool.inputSchema?.properties ?? {}) : null,
  required: tool?.inputSchema?.required ?? null,
  formatEnum: tool?.inputSchema?.properties?.format?.enum ?? null,
  serverInfo: door.serverInfo,
})

const cases: Array<{ id: string; expect: "success" | "refusal"; args: Record<string, unknown>; timeoutMs?: number }> = [
  { id: "success-single-text", expect: "success", args: { symbolNames: ["basePrice"], targetLanguage: "python" } },
  { id: "success-single-json", expect: "success", args: { symbolNames: ["basePrice"], targetLanguage: "python", format: "json" } },
  { id: "success-alias-symbolName", expect: "success", args: { symbolName: "basePrice", targetLanguage: "go" } },
  { id: "success-batch", expect: "success", args: { symbolNames: ["basePrice", "applyDiscount"], targetLanguage: "ruby", format: "json" } },
  { id: "success-union-name-and-path", expect: "success", args: { symbolNames: ["basePrice"], paths: ["ts-js/src/pricing.js"], targetLanguage: "python", format: "json" } },
  { id: "refuse-missing-targetLanguage", expect: "refusal", args: { symbolNames: ["basePrice"] } },
  { id: "refuse-missing-subject", expect: "refusal", args: { targetLanguage: "python" } },
  { id: "refuse-unknown-option", expect: "refusal", args: { symbolNames: ["basePrice"], targetLanguage: "python", bogusOption: 1 } },
  { id: "refuse-invalid-format-enum", expect: "refusal", args: { symbolNames: ["basePrice"], targetLanguage: "python", format: "xml" } },
  { id: "refuse-path-escapes-project", expect: "refusal", args: { paths: ["../outside"], targetLanguage: "python" } },
  { id: "refuse-bogus-symbol-id", expect: "refusal", args: { symbolIds: ["sym_does_not_exist"], targetLanguage: "python" } },
  { id: "refuse-blank-symbolName", expect: "refusal", args: { symbolName: "", targetLanguage: "python" } },
  { id: "refuse-same-language", expect: "refusal", args: { symbolNames: ["basePrice"], targetLanguage: "javascript" } },
  { id: "edge-unknown-target-language", expect: "refusal", args: { symbolNames: ["basePrice"], targetLanguage: "cobol" } },
  { id: "edge-blank-name-in-array", expect: "refusal", args: { symbolNames: [""], targetLanguage: "python" } },
]
for (const c of cases) {
  try {
    const r = await door.callTool(c.args, c.timeoutMs ?? 60_000)
    const summary = r.parsed ? {
      plans: r.parsed.plans?.length,
      unsupported: r.parsed.unsupported?.length,
      unsupportedReasons: r.parsed.unsupported?.map((u: any) => u.unsupportedReason),
      dependencyOrder: r.parsed.dependencyOrder,
      orderingStatus: r.parsed.dependencyGraph?.orderingStatus,
      waves: r.parsed.waves,
      truncation: r.parsed.truncation && { truncated: r.parsed.truncation.truncated, requested: r.parsed.truncation.requested, returned: r.parsed.truncation.returned },
      freshness: r.parsed.freshness && { fresh: r.parsed.freshness.fresh, stale: r.parsed.freshness.stale, missing: r.parsed.freshness.missing, mode: r.parsed.freshness.mode },
      methodology: r.parsed.methodology && { baseHours: r.parsed.methodology.baseHours, relationshipHours: r.parsed.methodology.relationshipHours, missingMappingHours: r.parsed.methodology.missingMappingHours, rates: r.parsed.methodology.rates },
      effort: r.parsed.effort,
      planSymbols: r.parsed.plans?.map((p: any) => ({ name: p.componentName, source: p.sourceLanguage, target: p.targetLanguage, file: p.sourceFile, stale: p.stale, effort: p.effortEstimateHours })),
    } : { textHead: r.text.split("\n").slice(0, 3) }
    const outcome = r.rpcError ? "rpc-error" : r.isError ? "refusal" : "success"
    record(c.id, { expected: c.expect, outcome, verdict: outcome === c.expect ? "PASS" : "FAIL", ms: r.ms, rpcError: r.rpcError, summary })
  } catch (e) {
    record(c.id, { expected: c.expect, outcome: "threw", verdict: "FAIL", error: String(e).slice(0, 300) })
  }
}
record("wire-hygiene", { nonJsonStdout: door.nonJsonStdout(), stderrTail: door.stderr().split("\n").slice(-8) })
await door.close()
writeFileSync(path.join(ROOT, "validation/tools/bb_migrate/raw/door-phaseA-t0.json"), JSON.stringify({ at: new Date().toISOString(), fixture: FIXTURE, dataDir: DATA_DIR, initAndListMs: Date.now() - initStarted, results }, null, 1))
