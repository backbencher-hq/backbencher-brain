// script/m71/probe-method-shapes.ts — FIX PROBE for bb_edit (not a gate).
//
// The full-declaration detector needs two facts this prints:
//   1. what `symbol_type` the index stores for a class method in TS and JS,
//   2. what `update` with a full method declaration does TODAY in each language
//      (the Kotlin probe proved silent nesting; the TS probe refused — JS was
//      never measured, and a JS `target() {…}` body parses as call+block, so it
//      may not be refused the way TS was).
//
// Run: npx tsx script/m71/probe-method-shapes.ts

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { ASTEngine } from "../../src/ast/engine"
import { executeEdit } from "../../src/intelligence/edit/edit-engine"

const CASES: Array<{ label: string; file: string; code: string; symbol: string; content: string }> = [
  {
    label: "ts class method",
    file: "a.ts",
    code: `export class A {\n  target(): number {\n    return 1\n  }\n}\n`,
    symbol: "target",
    content: `target(): number {\n    return 2\n  }`,
  },
  {
    label: "js class method",
    file: "a.js",
    code: `export class A {\n  target() {\n    return 1\n  }\n}\n`,
    symbol: "target",
    content: `target() {\n    return 2\n  }`,
  },
  {
    label: "js class method with modifier-like field",
    file: "a.js",
    code: `export class A {\n  static target() {\n    return 1\n  }\n}\n`,
    symbol: "target",
    content: `static target() {\n    return 2\n  }`,
  },
  {
    label: "ts method in namespace-object literal",
    file: "a.ts",
    code: `export const api = {\n  target(): number {\n    return 1\n  },\n}\n`,
    symbol: "target",
    content: `target(): number {\n    return 2\n  }`,
  },
]

for (const c of CASES) {
  const root = mkdtempSync(path.join(tmpdir(), "bb-review-method-"))
  mkdirSync(path.join(root, "src"), { recursive: true })
  writeFileSync(path.join(root, "src", c.file), c.code)
  const projectId = getProjectId(root)
  try {
    await indexProjectParallel(projectId, root, {})
    const raw = await BrainDatabase.getRawInstance(projectId as any)
    const rows = raw.prepare("SELECT name, symbol_type FROM brain_symbol WHERE name = ?").all(c.symbol) as any[]
    console.log(`── ${c.label}: indexed symbol_type=${JSON.stringify(rows)}`)
    let outcome = "ok"
    let error: string | undefined
    try {
      await executeEdit(root, projectId, { mode: "update", symbolName: c.symbol, filePath: `src/${c.file}`, newContent: c.content, format: false })
    } catch (e: any) {
      outcome = "error"
      error = e?.message ?? String(e)
    }
    const after = readFileSync(path.join(root, "src", c.file), "utf8")
    let syntaxErrors = -1
    try {
      const parsed = await ASTEngine.parseFile(path.join(root, "src", c.file), after)
      syntaxErrors = (parsed.errors ?? []).filter((x: any) => /syntax error/i.test(x.message ?? "")).length
    } catch {}
    console.log(`   outcome=${outcome}${error ? ` error=${JSON.stringify(error)}` : ""} syntaxErrors=${syntaxErrors}`)
    console.log(`   after=${JSON.stringify(after)}`)
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true })
  }
}
console.log("METHOD SHAPES COMPLETE")
