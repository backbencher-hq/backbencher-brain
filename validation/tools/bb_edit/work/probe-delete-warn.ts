// Phase A: when `force: true` bypasses delete protection, does the answer WARN about
// the indexed callers it was told to ignore? The descriptor and the generated page
// both say leftovers are reported in `warnings`.
import { mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs"
import path from "node:path"
import { getProjectId } from "../../../../src/util/project-id"
import { indexProjectParallel } from "../../../../src/ast/parallel-indexer"
import { executeEdit } from "../../../../src/intelligence/edit/edit-engine"

const checks: Array<{ name: string; pass: boolean; detail: string }> = []
const ck = (name: string, pass: boolean, detail = ""): void => { checks.push({ name, pass, detail }); console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`) }

async function setup(label: string, files: Record<string, string>): Promise<{ root: string; projectId: string }> {
  const root = path.resolve(`validation/tools/bb_edit/work/run/delete-warn-${label}`)
  rmSync(root, { recursive: true, force: true }); mkdirSync(root, { recursive: true })
  for (const [rel, content] of Object.entries(files)) { mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); writeFileSync(path.join(root, rel), content) }
  const projectId = getProjectId(root)
  await indexProjectParallel(projectId as any, root, {})
  return { root, projectId }
}

async function main(): Promise<void> {
  // (1) the only caller is a NAMESPACE-imported call in another file
  {
    const { root, projectId } = await setup("namespace", {
      "src/a.ts": "export function lone(): number {\n  return 1\n}\n",
      "src/n.ts": 'import * as a from "./a"\n\nexport const v = a.lone()\n',
    })
    const r = await executeEdit(root, projectId, { mode: "delete", symbolName: "lone", filePath: "src/a.ts", force: true, format: false })
    const warnings = JSON.stringify(r.warnings ?? [])
    ck("force delete: the answer WARNs about the caller it was told to ignore", (r.warnings ?? []).length > 0, warnings)
    ck("force delete: the warning names the indexed caller count", (r.warnings ?? []).some((w) => /caller/i.test(w)), warnings)
    ck("force delete: the calling file is left untouched (declared behaviour)", readFileSync(path.join(root, "src/n.ts"), "utf8").includes("a.lone()"))
  }
  // (2) an ALIASED import (the shape the docs say is covered)
  {
    const { root, projectId } = await setup("aliased", {
      "src/a.ts": "export function target(): number {\n  return 1\n}\n",
      "src/us.ts": 'import { target as aliasedTarget } from "./a"\n\nexport const v = aliasedTarget()\n',
    })
    const r = await executeEdit(root, projectId, { mode: "delete", symbolName: "target", filePath: "src/a.ts", force: true, format: false })
    const warnings = JSON.stringify(r.warnings ?? [])
    ck("force delete aliased: a surviving import specifier is warned about", (r.warnings ?? []).some((w) => /importing file|specifier|remain/i.test(w)), warnings)
    ck("force delete aliased: the user file keeps its now-dangling specifier (declared)", readFileSync(path.join(root, "src/us.ts"), "utf8").includes("aliasedTarget"))
  }
  const out = path.resolve("validation/tools/bb_edit/artifacts/delete-warn.json")
  writeFileSync(out, JSON.stringify({ schemaVersion: 1, tool: "bb_edit", phase: "A-audit-delete-warnings", generatedAt: new Date().toISOString(), checks }, null, 2) + "\n")
}
main().catch((e) => { console.error("FATAL", e); process.exit(2) })
