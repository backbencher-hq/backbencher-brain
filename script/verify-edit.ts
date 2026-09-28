// verify-edit.ts — hardened unified bb_edit engine (M9.13).
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../src/cli/index"
import { indexProjectParallel } from "../src/ast/parallel-indexer"
import { BrainDatabase } from "../src/brain/database"
import { executeEdit, resolveSafeEditPath } from "../src/intelligence/edit/edit-engine"

let failures = 0
function check(label: string, condition: boolean, detail = "") { if (condition) console.log("  ok: " + label); else { failures++; console.log("  FAIL: " + label + (detail ? " " + detail : "")) } }
async function rejects(label: string, action: () => unknown | Promise<unknown>, fragment: string) {
  try { await action(); check(label, false, "did not reject") } catch (error) { check(label, String(error).includes(fragment), String(error)) }
}

const parent = mkdtempSync(path.join(tmpdir(), "bb-edit-parent-"))
const root = path.join(parent, "project")
const sibling = path.join(parent, "project-evil")
const outside = path.join(parent, "outside")
mkdirSync(path.join(root, "src"), { recursive: true }); mkdirSync(sibling); mkdirSync(outside)
writeFileSync(path.join(root, "src", "app.ts"),
  "export function target(value: number): number {\n" +
  "  if (value > 0) { const nested = { value: value + 1 }; return nested.value }\n" +
  "  return 0\n}\n" +
  "export function caller(): number {\n" +
  "  const label = 'target should stay in string'\n" +
  "  // target should stay in comment\n" +
  "  return target(1)\n}\n" +
  "export function duplicate(): number { return 1 }\n")
writeFileSync(path.join(root, "src", "other.ts"), "export function duplicate(): number { return 2 }\n")
const projectId = getProjectId(root)
try {
  await indexProjectParallel(projectId, root, {})

  await rejects("path escape rejected", () => Promise.resolve(resolveSafeEditPath(root, "../escape.ts")), "escapes project root")
  await rejects("sibling-prefix escape rejected", () => Promise.resolve(resolveSafeEditPath(root, path.join(sibling, "x.ts"))), "escapes project root")
  symlinkSync(outside, path.join(root, "link"))
  await rejects("symlink escape rejected", () => Promise.resolve(resolveSafeEditPath(root, "link/x.ts")), "symlink")

  const nestedPath = path.join(root, "generated", "deep", "new.ts")
  await executeEdit(root, projectId, { mode: "write", filePath: "generated/deep/new.ts", content: "export const nested = true\n", format: false })
  check("write creates parent directories", existsSync(nestedPath))

  const appPath = path.join(root, "src", "app.ts")
  const beforeDry = readFileSync(appPath, "utf8")
  const dry = await executeEdit(root, projectId, { mode: "update", symbolName: "target", filePath: "src/app.ts", newContent: "export function target(): number { return 9 }", dryRun: true })
  check("dry-run returns exact before/after", dry.changes.length === 1 && dry.changes[0].before === beforeDry && dry.changes[0].after.includes("return 9"))
  check("dry-run performs no writes", readFileSync(appPath, "utf8") === beforeDry && !dry.reindexed)

  await executeEdit(root, projectId, { mode: "insert", targetSymbolName: "target", filePath: "src/app.ts", position: "inside-bottom", newContent: "const insertedAtBodyEnd = true", format: false })
  const inserted = readFileSync(appPath, "utf8")
  check("inside-bottom uses matching outer brace", inserted.indexOf("insertedAtBodyEnd") < inserted.indexOf("export function caller"))
  check("nested braces remain intact", inserted.includes("const nested = { value: value + 1 }"))

  await rejects("overloaded/same-name symbol requires disambiguation", () => executeEdit(root, projectId, { mode: "update", symbolName: "duplicate", newContent: "export function duplicate() { return 3 }" }), "ambiguous")

  writeFileSync(appPath, readFileSync(appPath, "utf8") + "\n// external stale change\n")
  await rejects("stale byte bounds rejected", () => executeEdit(root, projectId, { mode: "update", symbolName: "caller", filePath: "src/app.ts", newContent: "export function caller() { return 2 }" }), "stale index bounds")
  await indexProjectParallel(projectId, root, {})

  await rejects("delete with callers is blocked", () => executeEdit(root, projectId, { mode: "delete", symbolName: "target", filePath: "src/app.ts" }), "active references")

  const beforeInvalid = readFileSync(appPath, "utf8")
  await rejects("invalid update rolls back", () => executeEdit(root, projectId, { mode: "update", symbolName: "caller", filePath: "src/app.ts", newContent: "export function caller( {", format: false }), "validation failed")
  check("failed validation leaves file unchanged", readFileSync(appPath, "utf8") === beforeInvalid)

  await executeEdit(root, projectId, { mode: "refactor", symbolName: "target", filePath: "src/app.ts", newName: "renamedTarget", format: false })
  const renamed = readFileSync(appPath, "utf8")
  check("declaration renamed", renamed.includes("function renamedTarget"))
  check("call identifier renamed", renamed.includes("return renamedTarget(1)"))
  check("rename does not alter string", renamed.includes("'target should stay in string'"))
  check("rename does not alter comment", renamed.includes("// target should stay in comment"))
} catch (error) {
  check("edit session", false, error instanceof Error ? (error.stack ?? error.message) : String(error))
} finally {
  rmSync(parent, { recursive: true, force: true })
  rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true })
}
console.log(failures === 0 ? "\nEDIT: PASS" : `\nEDIT: ${failures} FAILURES`)
process.exit(failures > 0 ? 1 : 0)
