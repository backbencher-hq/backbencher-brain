// script/m71/probe-refactor-shapes.ts — REVIEW PROBE for bb_edit (not a gate).
//
// The caller-edge diagnostic showed a module-top-level call site stores its
// `calls` edge with source_symbol_id = NULL, and the refactor's caller query
// INNER JOINs brain_symbol on that column, so the row disappears. This measures
// which call-site shapes survive that join, by running the real refactor and
// reading what changed.
//
// Run: npx tsx script/m71/probe-refactor-shapes.ts

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"

const A = `export function target(): number {\n  return 1\n}\n`

const SHAPES: Array<{ label: string; b: string }> = [
  { label: "call at module top level", b: `import { target } from './a'\nexport const n = target()\n` },
  { label: "call inside an exported function", b: `import { target } from './a'\nexport function caller(): number {\n  return target()\n}\n` },
  { label: "call inside a class method", b: `import { target } from './a'\nexport class C {\n  run(): number {\n    return target()\n  }\n}\n` },
  { label: "call inside an arrow assigned to a const", b: `import { target } from './a'\nexport const run = () => target()\n` },
  { label: "aliased import, call inside a function", b: `import { target as aliased } from './a'\nexport function caller(): number {\n  return aliased()\n}\n` },
]

for (const shape of SHAPES) {
  const root = mkdtempSync(path.join(tmpdir(), "bb-review-shape-"))
  mkdirSync(path.join(root, "src"), { recursive: true })
  writeFileSync(path.join(root, "src", "a.ts"), A)
  writeFileSync(path.join(root, "src", "b.ts"), shape.b)
  const projectId = getProjectId(root)
  try {
    await indexProjectParallel(projectId, root, {})
    const { executeEdit } = await import("../../src/intelligence/edit/edit-engine")
    let summary: any, warnings: string[] | undefined, error: string | undefined
    try {
      const r = await executeEdit(root, projectId, { mode: "refactor", symbolName: "target", filePath: "src/a.ts", newName: "renamedTarget", format: false })
      summary = r.summary
      warnings = r.warnings
    } catch (e: any) {
      error = e?.message ?? String(e)
    }
    const bAfter = readFileSync(path.join(root, "src", "b.ts"), "utf8")
    const renamedInB = bAfter.includes("renamedTarget")
    console.log(`── ${shape.label}: ${error ? `ERROR ${JSON.stringify(error)}` : `summary=${JSON.stringify(summary)}`} renamedInB=${renamedInB} warnings=${JSON.stringify(warnings ?? [])}`)
    console.log(`   b.ts after: ${JSON.stringify(bAfter)}`)
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true })
  }
}

console.log("SHAPE PROBE COMPLETE")
