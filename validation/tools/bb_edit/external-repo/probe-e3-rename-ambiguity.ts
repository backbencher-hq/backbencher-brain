// Is the one remaining verify-edit-rename failure a gate bug or a tool limitation?
//
// The gate's TypeScript integration fixture is, in full:
//
//   export function target(): number { return 1 }
//   export function caller(): number {
//     const config = { target: 99 }
//     const helper = { target(x: number): number { return x } }
//     return target() + config.target + helper.target(1) + "target in string"
//     // target in comment
//   }
//
// The same-name object-literal properties are the POINT of the fixture — it
// asserts they are not renamed. But they also mean the name `target` is genuinely
// ambiguous in that file, and bb_edit's documented response to ambiguity is
// "provide filePath and lineStart". The gate supplies filePath and no lineStart,
// so the tool refuses and the gate records a failure before reaching any of the
// assertions it was written to make.
//
// If that reading is right, passing lineStart makes the refactor succeed and the
// fixture's own negatives hold. If it is wrong, the tool is failing a rename it
// should be able to do, which is a product defect. This distinguishes the two by
// running the same fixture both ways.

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const REPO = process.env.BB_REPO
const { getProjectId } = await import(path.join(REPO, "src/cli/index.ts"))
const { indexProjectParallel } = await import(path.join(REPO, "src/ast/parallel-indexer.ts"))
const { executeEdit } = await import(path.join(REPO, "src/intelligence/edit/edit-engine.ts"))
const { BrainDatabase } = await import(path.join(REPO, "src/brain/database.ts"))

const CODE = `export function target(): number { return 1 }\n\nexport function caller(): number {\n  const config = { target: 99 }\n  const helper = { target(x: number): number { return x } }\n  return target() + config.target + helper.target(1) + "target in string"\n  // target in comment\n}\n`

const root = mkdtempSync(path.join(tmpdir(), "bb-e3-rename-"))
mkdirSync(path.join(root, "src"), { recursive: true })
writeFileSync(path.join(root, "src", "app.ts"), CODE)
const projectId = getProjectId(root)

try {
  await indexProjectParallel(projectId, root, {})
  const raw = await BrainDatabase.getRawInstance(projectId)
  const matches = raw.prepare(
    "SELECT s.id, s.name, s.symbol_type AS st, s.line_start AS ls, s.byte_start AS bs FROM brain_symbol s " +
      "JOIN brain_file f ON f.id = s.file_id WHERE s.project_id = ? AND s.name = ? AND f.relative_path = ?",
  ).all(projectId, "target", "src/app.ts")
  console.log(`symbols named "target" in src/app.ts: ${matches.length}`)
  for (const m of matches) console.log(`   id=${String(m.id).slice(-24)} type=${m.st} line=${m.ls} byteStart=${m.bs}`)

  console.log(`\nA. refactor with filePath only (what the gate does):`)
  try {
    await executeEdit(root, projectId, { mode: "refactor", symbolName: "target", filePath: "src/app.ts", newName: "renamedTarget", format: false })
    console.log("   SUCCEEDED — so ambiguity is not the blocker")
  } catch (e: any) {
    console.log(`   refused: ${e?.message}`)
  }

  console.log(`\nB. refactor with filePath + lineStart (the documented disambiguation):`)
  writeFileSync(path.join(root, "src", "app.ts"), CODE)
  await indexProjectParallel(projectId, root, {})
  try {
    const r = await executeEdit(root, projectId, { mode: "refactor", symbolName: "target", filePath: "src/app.ts", lineStart: 1, newName: "renamedTarget", format: false })
    const after = readFileSync(path.join(root, "src", "app.ts"), "utf8")
    console.log(`   SUCCEEDED. changes=${r.changes.length} summary=${JSON.stringify(r.summary)}`)
    console.log(`\n   the fixture's own assertions, against the result:`)
    const cases: Array<[string, boolean, string]> = [
      ["declaration renamed", after.includes("function renamedTarget"), "function renamedTarget"],
      ["reference call renamed", after.includes("renamedTarget()"), "renamedTarget()"],
      ["property key NOT renamed", after.includes("{ target: 99 }"), "{ target: 99 }"],
      ["other-object method NOT renamed", after.includes("helper.target(1)"), "helper.target(1)"],
      ["member access NOT renamed", after.includes("config.target"), "config.target"],
      ["string NOT renamed", after.includes('"target in string"'), '"target in string"'],
      ["comment NOT renamed", after.includes("// target in comment"), "// target in comment"],
    ]
    let bad = 0
    for (const [label, ok, needle] of cases) {
      if (!ok) bad++
      console.log(`     ${ok ? "ok  " : "FAIL"}: ${label}`)
    }
    console.log(`\n   verdict: ${bad === 0 ? "every assertion the gate was written to make HOLDS" : `${bad} assertion(s) do not hold`}`)
    console.log(`   => the gate's fixture is fine; the gate's CALL is what fails.`)
  } catch (e: any) {
    console.log(`   refused: ${e?.message}`)
    console.log(`   => the tool cannot disambiguate with lineStart either, which IS a product limitation.`)
  }
} catch (e: any) {
  console.log(`session error: ${e?.message}`)
} finally {
  rmSync(root, { recursive: true, force: true })
  try { rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true }) } catch {}
}
