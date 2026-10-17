// script/m71/diagnose-m67-fixture.ts — REVIEW PROBE (not a gate).
//
// m67's M2g asserts the disambiguated refactor of its own fixture reports
// `renamedSites === 2` (the declaration plus its call site). After the D2 work the
// count came back 1 while the two CONTENT checks around it still passed, which is
// contradictory: either something is renamed without being counted, or the count is
// no longer what the gate thinks it is. This reproduces the fixture byte for byte,
// runs the same edit through the engine, and prints the result.
//
// Run: npx tsx script/m71/diagnose-m67-fixture.ts

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { executeEdit } from "../../src/intelligence/edit/edit-engine"
import { parseForSafety } from "../../src/ast/safety-primitives"



const CODE = `export function target(): number { return 1 }\n\nexport function caller(): number {\n  const config = { target: 99 }\n  const helper = { target(x: number): number { return x } }\n  return target() + config.target + helper.target(1) + "target in string"\n  // target in comment\n}\n`

// Which occurrence of `target` is reported as a BINDING, and with which parentType?
// `collectShadowScopes` only considers binding occurrences; a scope covering the call
// site inside `caller()` means one of these produced a range.
const parsed = await parseForSafety("app.ts", CODE)
console.log("-- occurrences --")
for (const o of parsed.occurrences) {
  if (o.text !== "target") continue
  console.log(`   text=target parentType=${o.parentType} line=${o.startLine} [${o.startIndex},${o.endIndex}]`)
}
console.log("-- bodyRanges --")
for (const b of parsed.bodyRanges) console.log(`   nodeType=${b.nodeType} [${b.startIndex},${b.endIndex}]`)
console.log("-- declaredNames --")
for (const d of parsed.declaredNames) console.log(`   ${d.text} type=${d.declarationType} decl=[${d.declarationStart},${d.declarationEnd}]`)

const root = mkdtempSync(path.join(tmpdir(), "bb-m71-m67-"))
mkdirSync(path.join(root, "src"), { recursive: true })
writeFileSync(path.join(root, "src", "app.ts"), CODE)
const projectId = getProjectId(root)
try {
  await indexProjectParallel(projectId, root, {})
  console.log("before:", JSON.stringify(CODE))
  const result = await executeEdit(root, projectId, {
    mode: "refactor", symbolName: "target", filePath: "src/app.ts", lineStart: 1, newName: "renamedTarget", format: false,
  } as any)
  console.log("summary:", JSON.stringify(result.summary))
  console.log("warnings:", JSON.stringify(result.warnings))
  console.log("changes:", result.changes.length, result.changes.map((c) => path.basename(c.path)).join(","))
  const after = readFileSync(path.join(root, "src", "app.ts"), "utf8")
  console.log("after:", JSON.stringify(after))
  console.log("occurrences of renamedTarget:", (after.match(/renamedTarget/g) ?? []).length)
} finally {
  rmSync(root, { recursive: true, force: true })
  rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true })
}
console.log("PROBE COMPLETE")
