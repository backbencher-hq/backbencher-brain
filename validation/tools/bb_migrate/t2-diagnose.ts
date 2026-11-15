// Diagnose the T2 shapes that breached the budget: what the request actually LOADED and
// why the cohort shape refused. Read-only after the one-time open; TIMING through the handler.
import path from "node:path"
import { performance } from "node:perf_hooks"
import { getProjectId } from "../../../src/cli/index"
import { handler } from "../../../src/mcp/tools/bb_migrate/handler"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")
const projectId = getProjectId(ROOT)
const projectPath = ROOT
const call = async (label: string, args: Record<string, unknown>) => {
  const started = performance.now()
  const result = await handler(args, { projectId, projectPath })
  const ms = performance.now() - started
  const text = result.content[0]?.text ?? ""
  let parsed: any = null
  try { parsed = JSON.parse(text) } catch { /* text */ }
  const summary = parsed ? {
    plans: parsed.plans?.length, unsupported: parsed.unsupported?.length,
    planNames: (parsed.plans ?? []).slice(0, 12).map((p: any) => `${p.componentName}[${p.sourceLanguage}->${p.targetLanguage}]`),
    work: parsed.cohort?.work, truncation: parsed.truncation && { truncated: parsed.truncation.truncated, requested: parsed.truncation.requested, returned: parsed.truncation.returned, capped: parsed.truncation.capped, deduplicated: parsed.truncation.deduplicated, cappedNamesCount: parsed.truncation.cappedNames?.length },
    effort: parsed.effort, orderingStatus: parsed.dependencyGraph?.orderingStatus, orderLen: parsed.dependencyOrder?.length, waves: parsed.waves?.map((w: any[]) => w.length),
    scope: parsed.scope && { integrationPoints: parsed.scope.integrationPoints, inScope: parsed.scope.inScope, completeness: parsed.scope.completeness },
    unsupportedReasons: parsed.unsupported?.map((u: any) => u.unsupportedReason), freshness: parsed.freshness && { fresh: parsed.freshness.fresh, stale: parsed.freshness.stale, missing: parsed.freshness.missing, mode: parsed.freshness.mode },
    methodTotals: parsed.methodology && { base: parsed.methodology.baseHours, rel: parsed.methodology.relationshipHours, missH: parsed.methodology.missingMappingHours, missN: parsed.methodology.missingMappingCount, relCount: parsed.methodology.relationshipCount },
  } : { textHead: text.split("\n").slice(0, 6) }
  console.log(JSON.stringify({ label, ms: Number(ms.toFixed(1)), isError: result.isError === true, summary }, null, 1))
}

await call("single-known", { symbolNames: ["generateMigrationPlans"], targetLanguage: "python", format: "json" })
await call("twelve-common", { symbolNames: ["push", "get", "set", "run", "start", "add", "update", "create", "load", "save", "read", "write"], targetLanguage: "python", format: "json" })
await call("path-cohort", { paths: ["src/mcp/tools"], targetLanguage: "python", format: "json" })
await call("path-cohort-file", { paths: ["src/mcp/tools/bb_migrate/handler.ts"], targetLanguage: "python", format: "json" })
