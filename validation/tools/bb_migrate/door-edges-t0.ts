// Phase A: payload detail for the door cases whose classification needs inspecting, plus
// input-shape edges the descriptor does not state.
import { writeFileSync } from "node:fs"
import path from "node:path"
import { openDoor } from "./door"
const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")
const FIXTURE = path.join(ROOT, "test/fixtures/polyglot")
const door = await openDoor({ dir: FIXTURE, dataDir: path.join(ROOT, "validation/tools/bb_migrate/bbdata"), label: "edges" })
const cases: Array<{ id: string; args: any }> = [
  { id: "same-language-json", args: { symbolNames: ["basePrice"], targetLanguage: "javascript", format: "json" } },
  { id: "unknown-target-json", args: { symbolNames: ["basePrice"], targetLanguage: "cobol", format: "json" } },
  { id: "blank-name-json", args: { symbolNames: [""], targetLanguage: "python", format: "json" } },
  { id: "missing-name-json", args: { symbolNames: ["does_not_exist"], targetLanguage: "python", format: "json" } },
  { id: "blank-target-json", args: { symbolNames: ["basePrice"], targetLanguage: "", format: "json" } },
  { id: "blank-target-text", args: { symbolNames: ["basePrice"], targetLanguage: "   " } },
  { id: "wrong-type-symbolNames", args: { symbolNames: "basePrice", targetLanguage: "python" } },
  { id: "path-root-cohort", args: { paths: ["."], targetLanguage: "python", format: "json" } },
  { id: "numeric-name", args: { symbolNames: [123], targetLanguage: "python", format: "json" } },
  { id: "path-and-name-union", args: { symbolNames: ["applyDiscount"], paths: ["ts-js/src/pricing.js"], targetLanguage: "python", format: "json" } },
]
const out: any[] = []
for (const c of cases) {
  try {
    const r = await door.callTool(c.args, 120_000)
    let summary: any = { textHead: r.text.split("\n").slice(0, 3) }
    if (r.parsed) summary = {
      plans: r.parsed.plans?.length, unsupported: r.parsed.unsupported,
      truncation: r.parsed.truncation, effort: r.parsed.effort, scope: r.parsed.scope?.statement,
      cohort: r.parsed.cohort && { symbolsResolved: r.parsed.cohort.symbolsResolved, pathsRequested: r.parsed.cohort.pathsRequested, pathsUnmatched: r.parsed.cohort.pathsUnmatched, byLanguage: r.parsed.cohort.byLanguage, statement: r.parsed.cohort.statement },
      freshness: r.parsed.freshness && { fresh: r.parsed.freshness.fresh, stale: r.parsed.freshness.stale, missing: r.parsed.freshness.missing, mode: r.parsed.freshness.mode, remediationKeys: Object.keys(r.parsed.freshness.remediation ?? {}) },
    }
    out.push({ id: c.id, args: c.args, isError: r.isError, rpcError: r.rpcError, ms: r.ms, summary })
    console.log(JSON.stringify({ id: c.id, isError: r.isError, summary }))
  } catch (e) {
    out.push({ id: c.id, threw: String(e).slice(0, 300) })
  }
}
await door.close()
writeFileSync(path.join(ROOT, "validation/tools/bb_migrate/raw/door-edges-t0.json"), JSON.stringify(out, null, 1))
