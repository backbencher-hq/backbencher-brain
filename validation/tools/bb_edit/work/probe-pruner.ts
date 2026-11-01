// Focused probe: bb_edit `delete` runs ImportPruner on the declaration file.
// The pruner is regex-based for every language except TS/JS. This measures
// whether an ALIASED import that is still used by a surviving function survives
// the prune (it must) — the case where usage is spelled with the alias, not the
// imported module's last path segment.
import { mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs"
import path from "node:path"
import { getProjectId } from "../../../../src/util/project-id"
import { indexProjectParallel } from "../../../../src/ast/parallel-indexer"
import { executeEdit } from "../../../../src/intelligence/edit/edit-engine"
import { ASTEngine } from "../../../../src/ast/engine"

const checks: Array<{ name: string; pass: boolean; detail: string; negative?: boolean }> = []
function ck(name: string, pass: boolean, detail = ""): void { checks.push({ name, pass, detail }); if (!pass) console.log(`FAIL ${name} — ${detail}`) }

async function fixtureCase(label: string, extension: string, files: Record<string, string>, symbolName: string, guard: (after: string) => boolean, guardDetail: string): Promise<void> {
  const root = path.resolve(`validation/tools/bb_edit/work/run/pruner-${label}`)
  rmSync(root, { recursive: true, force: true })
  mkdirSync(root, { recursive: true })
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
    writeFileSync(path.join(root, rel), content)
  }
  const projectId = getProjectId(root)
  await indexProjectParallel(projectId as any, root, {})
  const found = await ASTEngine.findSymbol(projectId, symbolName)
  if (found.matches.length === 0) { ck(`${label}: symbol ${symbolName} is indexed (probe prerequisite)`, false, "symbol not found"); return }
  const target = found.matches[0].fileId
  try {
    await executeEdit(root, projectId, { mode: "delete", symbolName, filePath: path.relative(root, target), force: true, format: false })
  } catch (e: any) {
    ck(`${label}: delete ${symbolName} succeeds`, false, e?.message?.slice(0, 200))
    return
  }
  const after = readFileSync(target, "utf8")
  ck(`${label}: delete ${symbolName} succeeds`, true)
  ck(`${label}: ${guardDetail}`, guard(after), after.slice(0, 300).replace(/\n/g, "⏎"))
  void extension
}

async function main(): Promise<void> {
  // Haskell: usage is spelled with the alias `M`, the module segment is `Map`.
  await fixtureCase("haskell-alias", ".hs", {
    "src/Main.hs": [
      "module Main where",
      "",
      "import qualified Data.Map as M",
      "",
      "target x = x + 1",
      "",
      "keep y = M.lookup y",
      "",
    ].join("\n"),
  }, "target", (after) => after.includes("import qualified Data.Map as M") && after.includes("M.lookup"), "a still-used ALIASED import survives the prune")


  // Python: one `from x import a, b` line; the deleted symbol used `a`, a surviving
  // function uses `b`. Pruning by the FIRST name must not delete `b` with it.
  await fixtureCase("python-multiname", ".py", {
    "src/m.py": [
      "from mod import a, b",
      "",
      "def target():",
      "    return a()",
      "",
      "def keep():",
      "    return b()",
      "",
    ].join("\n"),
  }, "target", (after) => after.includes("b") && after.includes("from mod import"), "a partially-used multi-name import keeps the still-used name")

  // TS control: an aliased import used by the survivor must survive.
  await fixtureCase("ts-alias", ".ts", {
    "src/m.ts": [
      'import { a as aliasedA } from "./mod"',
      "",
      "export function target(): number {",
      "  return aliasedA()",
      "}",
      "",
      "export function keep(): number {",
      "  return aliasedA()",
      "}",
      "",
    ].join("\n"),
  }, "target", (after) => after.includes("aliasedA") && after.includes('from "./mod"'), "a TS aliased import used by the survivor survives")

  // TS control: selectively prune only the dead name of a multi-name import.
  await fixtureCase("ts-multiname", ".ts", {
    "src/m.ts": [
      'import { deadName, liveName } from "./mod"',
      "",
      "export function target(): number {",
      "  return deadName()",
      "}",
      "",
      "export function keep(): number {",
      "  return liveName()",
      "}",
      "",
    ].join("\n"),
  }, "target", (after) => after.includes("liveName") && !after.includes("deadName") && after.includes('from "./mod"'), "a TS multi-name import prunes only the dead specifier")

  // Elixir: `alias Foo.Bar, as: Baz` — usage is `Baz`.
  await fixtureCase("elixir-alias", ".ex", {
    "src/m.ex": [
      "defmodule M do",
      "  alias Foo.Bar, as: Baz",
      "",
      "  def target(x) do",
      "    x + 1",
      "  end",
      "",
      "  def keep(y) do",
      "    Baz.call(y)",
      "  end",
      "end",
      "",
    ].join("\n"),
  }, "target", (after) => after.includes("alias Foo.Bar, as: Baz"), "a still-used ALIASED alias survives the prune")

  // Groovy: `import a.b.C as D` — usage is `D`.
  await fixtureCase("groovy-alias", ".groovy", {
    "src/M.groovy": [
      "import com.example.Util as U",
      "",
      "def target() {",
      "  1",
      "}",
      "",
      "def keep() {",
      "  U.call()",
      "}",
      "",
    ].join("\n"),
  }, "target", (after) => after.includes("import com.example.Util as U"), "a still-used ALIASED import survives the prune")

  const out = path.resolve("validation/tools/bb_edit/artifacts/pruner.json")
  mkdirSync(path.dirname(out), { recursive: true })
  writeFileSync(out, JSON.stringify({ schemaVersion: 1, tool: "bb_edit", phase: "A-audit-pruner", generatedAt: new Date().toISOString(), summary: { total: checks.length, passed: checks.filter((c) => c.pass).length, failed: checks.filter((c) => !c.pass).length }, checks }, null, 2) + "\n")
  console.log(`\nPRUNER: ${checks.filter((c) => c.pass).length}/${checks.length} passed → ${out}`)
}

main().catch((e) => { console.error("FATAL", e); process.exit(2) })
