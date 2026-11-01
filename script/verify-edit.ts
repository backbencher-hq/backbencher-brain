// verify-edit.ts — hardened unified bb_edit engine .
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

 // A delete with live callers is refused — checked HERE, while `caller` really
 // does call `target`. The order matters: after the stale-bounds step below the
 // file has changed and the precondition would be gone.
 // The refusal names the INDEXED caller count, the live reference that would
 // survive the deletion (with its line and kind) and the `force=true` escape
 // hatch. The property is asserted directly: refused by default, with the
 // evidence named.
  let deleteRefusal = ""
  try { await executeEdit(root, projectId, { mode: "delete", symbolName: "target", filePath: "src/app.ts" }) } catch (error) { deleteRefusal = String(error) }
  check("delete with callers is blocked", deleteRefusal.includes("cannot delete target"), deleteRefusal.slice(0, 200) || "the delete was NOT refused")
  check("and the refusal names the caller evidence and the override", /\d+ indexed caller\(s\)/.test(deleteRefusal) && /force=true/.test(deleteRefusal), deleteRefusal.slice(0, 200))

 // Stale byte bounds: change the file on disk so the indexed rows no longer
 // match, then edit. The contract is that the edit REFRESHES that one file,
 // re-resolves the symbol and applies the edit to the CURRENT bytes, disclosing
 // the refresh in `warnings`. Every other read tool refreshes a stale file within
 // budget (BB_NO_AUTO_REFRESH); an edit that refused instead would make the FIRST
 // symbol edit after ANY external change — another tool, a git pull, a person —
 // a hard stop, even when the external change did not touch the symbol. Refusing
 // is not the safer behaviour: the bounds were never the problem. The property
 // worth asserting is the stronger one: the write lands on the bytes on disk, at
 // the offset they now have, and nothing else in the file is disturbed.
 //
 // The four external-change shapes (body changed, lines inserted, symbol
 // renamed, symbol removed) are owned by script/m13/verify-edit-freshness.ts;
 // this legacy gate keeps the basic one.
  writeFileSync(appPath, readFileSync(appPath, "utf8") + "// external stale change\n")
  const staleEdit = await executeEdit(root, projectId, { mode: "update", symbolName: "target", filePath: "src/app.ts", newContent: "export function target(value: number): number { return 99 }", format: false })
  const afterStale = readFileSync(appPath, "utf8")
  check("an edit on a stale file refreshes it and lands on the bytes on disk", afterStale.includes("return 99"), afterStale.split("\n").slice(0, 3).join(" | "))
  check("and the external change is not discarded by it", afterStale.includes("// external stale change"), afterStale.slice(-60).replace(/\n/g, "\\n"))
  check("the refresh is disclosed in warnings", (staleEdit.warnings ?? []).some((w) => /refresh/i.test(w)), JSON.stringify(staleEdit.warnings ?? []))
  check("and a call site outside the edited span is untouched", afterStale.includes("return target(1)"), afterStale.split("\n").find((line) => line.includes("target(1)")) ?? "missing")
  await indexProjectParallel(projectId, root, {})

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

// ── Import pruning after a delete: AST-only, declared when skipped ─────────
// Deleting a symbol can orphan an import. The prune must remove the orphans it can
// prove dead (TypeScript/JavaScript, by tree-sitter identity) and must NEVER edit a
// file whose import syntax it cannot read: a leftover import is harmless, a
// wrongly-removed one breaks the build. An earlier regex-table implementation
// corrupted Haskell (`import qualified Data.Map as M` lost its first token),
// deleted Python multi-name imports while the other name was still used, and
// dropped aliased Groovy imports used by surviving functions — all reported as
// successful, validated edits. These fixtures pin the fixed contract.
{
  const pruneParent = mkdtempSync(path.join(tmpdir(), "bb-edit-prune-"))
  const tsRoot = path.join(pruneParent, "ts")
  mkdirSync(path.join(tsRoot, "src"), { recursive: true })
  writeFileSync(path.join(tsRoot, "src", "m.ts"),
    'import { deadName, liveName } from "./mod"\n\nexport function target(): number {\n  return deadName()\n}\n\nexport function keep(): number {\n  return liveName()\n}\n')
  const tsProject = getProjectId(tsRoot)
  try {
    await indexProjectParallel(tsProject, tsRoot, {})
    const deleted = await executeEdit(tsRoot, tsProject, { mode: "delete", symbolName: "target", filePath: "src/m.ts", format: false })
    const after = readFileSync(path.join(tsRoot, "src", "m.ts"), "utf8")
    check("TS delete: the dead named import is removed", !after.includes("deadName") && after.includes("liveName") && after.includes('from "./mod"'), after)
    check("TS delete: the prune is declared attempted with the language", deleted.importPruning?.attempted === true && deleted.importPruning.language === "typescript", JSON.stringify(deleted.importPruning))
    check("TS delete: the removed binding is named on the result", JSON.stringify(deleted.importPruning?.removedBindings) === JSON.stringify(["deadName"]), JSON.stringify(deleted.importPruning?.removedBindings))
  } catch (error) {
    check("TS delete prune session", false, error instanceof Error ? error.message : String(error))
  } finally {
    rmSync(pruneParent, { recursive: true, force: true })
    rmSync(path.dirname(BrainDatabase.getDbPath(tsProject)), { recursive: true, force: true })
  }

  const hsParent = mkdtempSync(path.join(tmpdir(), "bb-edit-prune-hs-"))
  const hsRoot = path.join(hsParent, "hs")
  mkdirSync(path.join(hsRoot, "src"), { recursive: true })
  const hsImport = "import qualified Data.Map as M"
  writeFileSync(path.join(hsRoot, "src", "Main.hs"),
    "module Main where\n\n" + hsImport + "\n\ntarget x = x + 1\n\nkeep y = M.lookup y\n")
  const hsProject = getProjectId(hsRoot)
  try {
    await indexProjectParallel(hsProject, hsRoot, {})
    const deleted = await executeEdit(hsRoot, hsProject, { mode: "delete", symbolName: "target", filePath: "src/Main.hs", format: false })
    const after = readFileSync(path.join(hsRoot, "src", "Main.hs"), "utf8")
    check("Haskell delete: the aliased import is byte-identical after the delete", after.includes(hsImport) && after.includes("M.lookup y") && !after.includes("\n as M"), after.replace(/\n/g, "\\n"))
    check("Haskell delete: pruning is DECLARED skipped, with the language and a reason", deleted.importPruning?.attempted === false && deleted.importPruning?.language === "haskell" && /TypeScript\/JavaScript only/.test(deleted.importPruning?.reason ?? ""), JSON.stringify(deleted.importPruning))
    check("Haskell delete: the skip is surfaced as a warning too", (deleted.warnings ?? []).some((w) => /import cleanup was not attempted/.test(w)), JSON.stringify(deleted.warnings))
  } catch (error) {
    check("Haskell delete prune session", false, error instanceof Error ? error.message : String(error))
  } finally {
    rmSync(hsParent, { recursive: true, force: true })
    rmSync(path.dirname(BrainDatabase.getDbPath(hsProject)), { recursive: true, force: true })
  }
}

console.log(failures === 0 ? "\nEDIT: PASS" : `\nEDIT: ${failures} FAILURES`)
process.exit(failures > 0 ? 1 : 0)
