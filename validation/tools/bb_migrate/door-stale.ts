// Stale-plan evidence through the real MCP door: after an indexed fixture source changes,
// the plan must say so up front; a plan whose source cannot be resolved counts as missing.
import { appendFileSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { openDoor } from "./door"
const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")
const FIXTURE = path.join(ROOT, "validation/tools/bb_migrate/work/stale-fixture")
const DATA = path.join(ROOT, "validation/tools/bb_migrate/work/stale-data")
const door = await openDoor({ dir: FIXTURE, dataDir: DATA, label: "stale" })
const out: any[] = []
const record = (id: string, extra: any) => { out.push({ id, ...extra }); console.log(JSON.stringify({ id, ...extra })) }

const run = async (id: string, args: Record<string, unknown>) => {
  const r = await door.callTool(args, 120_000)
  const parsed = r.parsed
  record(id, {
    isError: r.isError, ms: r.ms,
    summary: parsed ? {
      plans: parsed.plans?.map((p: any) => ({ name: p.componentName, file: p.sourceFile, stale: p.stale })),
      freshness: parsed.freshness,
    } : { text: r.text.split("\n").slice(0, 6) },
  })
}
// before any edit: fresh
await run("before-edit-json", { symbolNames: ["basePrice"], targetLanguage: "python", format: "json" })
// edit an indexed source file: it is now stale
appendFileSync(path.join(FIXTURE, "ts-js/src/pricing.js"), "\n// stale-plan probe: this file changed after the last index\n")
await run("after-edit-json", { symbolNames: ["basePrice"], targetLanguage: "python", format: "json" })
await run("after-edit-text", { symbolNames: ["basePrice"], targetLanguage: "python" })
// remove an indexed source file: the plan's file cannot be resolved
try { rmSync(path.join(FIXTURE, "ts-js/src/format.js")) } catch { /* file may not exist */ }
await run("after-delete-json", { symbolNames: ["formatPrice", "basePrice"], targetLanguage: "python", format: "json" })
await door.close()
writeFileSync(path.join(ROOT, "validation/tools/bb_migrate/raw/door-stale.json"), JSON.stringify(out, null, 1))
