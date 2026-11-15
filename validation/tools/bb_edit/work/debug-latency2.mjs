import path from "node:path"
import { getProjectId } from "../../../../src/util/project-id.ts"
import { executeEdit } from "../../../../src/intelligence/edit/edit-engine.ts"
const root = path.resolve("validation/tools/bb_edit/work/run/tiers/t0-polyglot")
const id = getProjectId(root)
try {
  const r = await executeEdit(root, id, { mode: "update", symbolName: "total", filePath: "ts-js/src/checkout.ts", newContent: "return 3", dryRun: true, format: false })
  console.log("OK", r.changes.length, JSON.stringify(r.changes[0]?.after?.slice(0,120)))
} catch (e) { console.log("ERR:", e.message) }
try {
  const r2 = await executeEdit(root, id, { mode: "update", symbolName: "total", filePath: "ts-js/src/checkout.ts", newContent: "export function total(item: { price?: number }, discountPct: number): number {\n  return 5\n}", dryRun: true, format: false })
  console.log("OK-FULL", r2.changes.length)
} catch (e) { console.log("ERR-FULL:", e.message) }
