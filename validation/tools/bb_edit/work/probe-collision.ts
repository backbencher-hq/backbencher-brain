// Phase A unknowns: does refactor refuse a rename ONTO an existing name, and does a
// rename to the same name report success?
import { mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs"
import path from "node:path"
import { getProjectId } from "../../../../src/util/project-id"
import { indexProjectParallel } from "../../../../src/ast/parallel-indexer"
import { executeEdit } from "../../../../src/intelligence/edit/edit-engine"

const checks: Array<{ name: string; pass: boolean; detail: string }> = []
const ck = (name: string, pass: boolean, detail = ""): void => { checks.push({ name, pass, detail }); console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`) }

async function setup(label: string, files: Record<string, string>): Promise<{ root: string; projectId: string }> {
  const root = path.resolve(`validation/tools/bb_edit/work/run/collision-${label}`)
  rmSync(root, { recursive: true, force: true }); mkdirSync(root, { recursive: true })
  for (const [rel, content] of Object.entries(files)) { mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); writeFileSync(path.join(root, rel), content) }
  const projectId = getProjectId(root)
  await indexProjectParallel(projectId as any, root, {})
  return { root, projectId }
}

async function main(): Promise<void> {
  const source = 'export function target(): number {\n  return 1\n}\n\nexport function existing(): number {\n  return 2\n}\n'
  {
    const { root, projectId } = await setup("onto-existing", { "src/a.ts": source })
    let error = ""
    let result: any = null
    try { result = await executeEdit(root, projectId, { mode: "refactor", symbolName: "target", filePath: "src/a.ts", newName: "existing", format: false }) }
    catch (e: any) { error = e?.message ?? String(e) }
    const after = readFileSync(path.join(root, "src/a.ts"), "utf8")
    ck("refactor onto an existing name: refused", error.length > 0, error.slice(0, 200) || `accepted, renamedSites=${result?.summary?.renamedSites}`)
    ck("refactor onto an existing name: the file is not left with two functions of that name", (after.match(/function existing/g) ?? []).length <= 1, (after.match(/function existing/g) ?? []).length + " declarations")
  }
  {
    const { root, projectId } = await setup("same-name", { "src/a.ts": source })
    let error = ""
    let result: any = null
    try { result = await executeEdit(root, projectId, { mode: "refactor", symbolName: "target", filePath: "src/a.ts", newName: "target", format: false }) }
    catch (e: any) { error = e?.message ?? String(e) }
    const after = readFileSync(path.join(root, "src/a.ts"), "utf8")
    ck("refactor to the SAME name: refused as a no-op rather than reported as a rename", error.length > 0, error.slice(0, 160) || `accepted; sites=${result?.summary?.renamedSites} warnings=${JSON.stringify(result?.warnings)}; file_unchanged=${after === source}`)
  }
  const out = path.resolve("validation/tools/bb_edit/artifacts/collision.json")
  writeFileSync(out, JSON.stringify({ schemaVersion: 1, tool: "bb_edit", phase: "A-audit-collision", generatedAt: new Date().toISOString(), checks }, null, 2) + "\n")
}
main().catch((e) => { console.error("FATAL", e); process.exit(2) })
