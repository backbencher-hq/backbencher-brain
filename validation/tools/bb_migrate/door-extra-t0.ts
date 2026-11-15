// Remaining Phase A door probes: alias/symbolName union, blank entries in arrays, absolute
// path inside the project, and the unindexed-project door.
import { writeFileSync } from "node:fs"
import path from "node:path"
import { openDoor } from "./door"
const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")
const FIXTURE = path.join(ROOT, "test/fixtures/polyglot")
const DATA = path.join(ROOT, "validation/tools/bb_migrate/bbdata")
const out: any[] = []
const door = await openDoor({ dir: FIXTURE, dataDir: DATA, label: "extra" })
const run = async (id: string, args: any) => {
  const r = await door.callTool(args, 120_000)
  out.push({ id, args, isError: r.isError, ms: r.ms, plans: r.parsed?.plans?.map((p: any) => p.componentName), unsupported: r.parsed?.unsupported?.map((u: any) => u.unsupportedReason), truncation: r.parsed?.truncation, cohort: r.parsed?.cohort && { symbolsResolved: r.parsed.cohort.symbolsResolved, pathsRequested: r.parsed.cohort.pathsRequested, pathsUnmatched: r.parsed.cohort.pathsUnmatched }, textHead: r.parsed ? undefined : r.text.split("\n").slice(0, 3) })
  console.log(JSON.stringify(out[out.length - 1]))
}
await run("both-name-forms", { symbolName: "basePrice", symbolNames: ["applyDiscount"], targetLanguage: "python", format: "json" })
await run("absolute-path-inside", { paths: [path.join(FIXTURE, "ts-js/src/pricing.js")], targetLanguage: "python", format: "json" })
await run("blank-path-entry", { paths: [""], targetLanguage: "python", format: "json" })
await run("blank-path-plus-valid", { paths: ["", "ts-js/src/pricing.js"], targetLanguage: "python", format: "json" })
await run("blank-entries-mixed", { symbolNames: ["basePrice", "", "  "], targetLanguage: "python", format: "json" })
await run("empty-arrays", { symbolNames: [], paths: [], symbolIds: [], targetLanguage: "python" })
await run("duplicate-names", { symbolNames: ["basePrice", "basePrice"], targetLanguage: "python", format: "json" })
await door.close()

// unindexed project through the real door (fresh isolated data dir, no index)
const unindexedDir = path.join(ROOT, "validation/tools/bb_migrate/work/unindexed-project")
const emptyData = path.join(ROOT, "validation/tools/bb_migrate/work/unindexed-door-data")
let door2: any = null
try {
  door2 = await openDoor({ dir: unindexedDir, dataDir: emptyData, label: "unindexed" })
  const r = await door2.callTool({ symbolNames: ["only"], targetLanguage: "python" }, 60_000)
  out.push({ id: "unindexed-door", isError: r.isError, ms: r.ms, rpcError: r.rpcError, textHead: r.text.split("\n").slice(0, 3), parsed: r.parsed ? { plans: r.parsed.plans?.length, freshness: r.parsed.freshness } : null })
} catch (e) {
  out.push({ id: "unindexed-door", threw: String(e).slice(0, 300), serverTools: door2?.tools?.length ?? null })
} 
await door2?.close()
console.log(JSON.stringify(out[out.length - 1]))
writeFileSync(path.join(ROOT, "validation/tools/bb_migrate/raw/door-extra-t0.json"), JSON.stringify(out, null, 1))
