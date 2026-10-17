// script/m71/probe-edit-crossfile-review.ts — REVIEW PROBE for bb_edit (not a gate).
//
// Measures whether `refactor` protects every OTHER file that names the symbol,
// not only the ones the index recorded a calls/uses edge for:
//
//   H7a  plain cross-file call (control: index has a `calls` edge)
//   H7b  aliased import  `import { target as aliased } from './a'`
//        (M68 measured that this records 'exports' only, no call edge)
//   H7c  barrel re-export `export { target } from './a'`
//   H7d  side-effect-free type usage `let f: typeof target`
//
// Run: npx tsx script/m71/probe-edit-crossfile-review.ts

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { executeEdit } from "../../src/intelligence/edit/edit-engine"

async function runCase(label: string, files: Record<string, string>, symbolName: string, newName: string) {
  const root = mkdtempSync(path.join(tmpdir(), `bb-review-x-${label}-`))
  for (const [f, c] of Object.entries(files)) {
    const dir = path.dirname(f)
    if (dir !== ".") mkdirSync(path.join(root, dir), { recursive: true })
    writeFileSync(path.join(root, f), c)
  }
  const projectId = getProjectId(root)
  try {
    await indexProjectParallel(projectId, root, {})
    let outcome = "ok"
    let error: string | undefined
    let warnings: string[] | undefined
    let summary: any
    try {
      const r = await executeEdit(root, projectId, { mode: "refactor", symbolName, filePath: "a.ts", newName, format: false })
      warnings = r.warnings
      summary = r.summary
    } catch (e: any) {
      outcome = "error"
      error = e?.message ?? String(e)
    }
    console.log(`── ${label}: outcome=${outcome}${error ? ` error=${JSON.stringify(error)}` : ""} summary=${JSON.stringify(summary)} warnings=${JSON.stringify(warnings ?? [])}`)
    for (const f of Object.keys(files)) {
      const after = readFileSync(path.join(root, f), "utf8")
      console.log(`   ${f}: ${JSON.stringify(after)}`)
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true })
  }
}

const A = `export function target(): number {\n  return 1\n}\n`

await runCase("H7a plain cross-file call", { "a.ts": A, "b.ts": `import { target } from './a'\nexport const n = target()\n` }, "target", "renamedTarget")

await runCase("H7b aliased import", { "a.ts": A, "b.ts": `import { target as aliased } from './a'\nexport const n = aliased()\n` }, "target", "renamedTarget")

await runCase("H7c barrel re-export", { "a.ts": A, "b.ts": `export { target } from './a'\n` }, "target", "renamedTarget")

await runCase("H7d typeof reference", { "a.ts": A, "b.ts": `import { target } from './a'\nexport type T = typeof target\n` }, "target", "renamedTarget")

console.log("CROSS-FILE PROBE COMPLETE")
