// script/m71/debug-java-span.ts — debug probe (not a gate).
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { ASTEngine } from "../../src/ast/engine"
import { executeEdit } from "../../src/intelligence/edit/edit-engine"

const CASES = [
  {
    label: "java",
    file: "A.java",
    code: `class A {\n    int target() {\n        return 1;\n    }\n}\n`,
    content: `int target() {\n    return 2;\n}`,
  },
  {
    label: "kotlin",
    file: "a.kt",
    code: `fun target(): Int {\n    return 1\n}\n`,
    content: `fun target(): Int {\n    return 2\n}`,
  },
  {
    label: "csharp",
    file: "B.cs",
    code: `class B {\n    int Target() {\n        return 1;\n    }\n}\n`,
    content: `int Target() {\n    return 2;\n}`,
  },
]

for (const c of CASES) {
  const root = mkdtempSync(path.join(tmpdir(), "bb-dbg-span-"))
  mkdirSync(path.join(root, "src"), { recursive: true })
  const abs = path.join(root, "src", c.file)
  writeFileSync(abs, c.code)
  const projectId = getProjectId(root)
  try {
    await indexProjectParallel(projectId, root, {})
    const found: any = await ASTEngine.findSymbol(projectId, c.file === "B.cs" ? "Target" : "target", `src/${c.file}`)
    const m = (found.matches ?? [])[0]
    console.log(`── ${c.label}: symbol=${JSON.stringify(m)}`)
    if (m) {
      console.log(`   slice=[${JSON.stringify(c.code.slice(m.byteStart, m.byteEnd))}]`)
      console.log(`   charAt(byteEnd-1)=${JSON.stringify(c.code.slice(m.byteEnd - 1, m.byteEnd + 2))}`)
    }
    let outcome = "ok"
    let error = ""
    try {
      await executeEdit(root, projectId, { mode: "update", symbolName: c.file === "B.cs" ? "Target" : "target", filePath: `src/${c.file}`, newContent: c.content, format: false })
    } catch (e: any) {
      outcome = "error"
      error = e?.message ?? String(e)
    }
    console.log(`   outcome=${outcome} ${error}`)
    console.log(`   after=${JSON.stringify(readFileSync(abs, "utf8"))}`)
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true })
  }
}
