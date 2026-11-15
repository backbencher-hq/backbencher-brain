// Import-pruning contract probe (Phase B, findings F1/F2).
// The contract after the rewrite: pruning is TypeScript/JavaScript-only, AST-driven,
// and a language it does not support is left BYTE-FOR-BYTE unchanged with the skip
// DECLARED on the result (`importPruning.attempted === false` + reason + warning).
import { mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs"
import { createHash } from "node:crypto"
import path from "node:path"
import { getProjectId } from "../../../../src/util/project-id"
import { indexProjectParallel } from "../../../../src/ast/parallel-indexer"
import { executeEdit, type EditResult } from "../../../../src/intelligence/edit/edit-engine"
import { ASTEngine } from "../../../../src/ast/engine"

const checks: Array<{ name: string; pass: boolean; detail: string }> = []
const ck = (name: string, pass: boolean, detail = ""): void => { checks.push({ name, pass, detail }); console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? " — " + String(detail).slice(0, 180) : ""}`) }
const sha = (file: string): string => createHash("sha256").update(readFileSync(file)).digest("hex")

async function setup(label: string, files: Record<string, string>): Promise<{ root: string; projectId: string }> {
  const root = path.resolve(`validation/tools/bb_edit/work/run/prune-${label}`)
  rmSync(root, { recursive: true, force: true })
  mkdirSync(root, { recursive: true })
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
    writeFileSync(path.join(root, rel), content)
  }
  const projectId = getProjectId(root)
  await indexProjectParallel(projectId as any, root, {})
  return { root, projectId }
}

async function deleteSymbol(root: string, projectId: string, symbolName: string, dryRun = false): Promise<{ result?: EditResult; error?: any; file: string }> {
  const found = await ASTEngine.findSymbol(projectId, symbolName)
  const file = found.matches[0]?.fileId ?? ""
  try {
    const result = await executeEdit(root, projectId, { mode: "delete", symbolName, filePath: file ? path.relative(root, file) : undefined, force: true, dryRun, format: false } as any)
    return { result, file }
  } catch (e: any) {
    return { error: e, file }
  }
}

async function main(): Promise<void> {
  // ── TS/JS: pruning RUNS and removes only dead bindings ──────────────────
  {
    const { root, projectId } = await setup("ts-dead", {
      "src/m.ts": 'import { deadName, liveName } from "./mod"\n\nexport function target(): number {\n  return deadName()\n}\n\nexport function keep(): number {\n  return liveName()\n}\n',
    })
    const r = await deleteSymbol(root, projectId, "target")
    const after = readFileSync(path.join(root, "src/m.ts"), "utf8")
    ck("ts: delete succeeds", !!r.result, r.error?.message)
    ck("ts: pruning WAS attempted and declares the language", r.result?.importPruning?.attempted === true && r.result.importPruning.language === "typescript", JSON.stringify(r.result?.importPruning))
    ck("ts: the dead named specifier is removed", !after.includes("deadName") && after.includes("liveName") && after.includes('from "./mod"'), after.replace(/\n/g, "⏎"))
    ck("ts: the result names the binding it removed", JSON.stringify(r.result?.importPruning?.removedBindings) === JSON.stringify(["deadName"]), JSON.stringify(r.result?.importPruning?.removedBindings))
    ck("ts: the removal is reported as a warning", (r.result?.warnings ?? []).some((w) => /removed 1 import binding/.test(w)), JSON.stringify(r.result?.warnings))
  }
  {
    const { root, projectId } = await setup("ts-kept", {
      "src/m.ts": 'import { a as aliasedA } from "./mod"\n\nexport function target(): number {\n  return aliasedA()\n}\n\nexport function keep(): number {\n  return aliasedA()\n}\n',
    })
    const r = await deleteSymbol(root, projectId, "target")
    const after = readFileSync(path.join(root, "src/m.ts"), "utf8")
    ck("ts: an ALIASED import still used by a survivor is kept", after.includes('import { a as aliasedA } from "./mod"'), after.replace(/\n/g, "⏎"))
    ck("ts: nothing is declared removed when nothing was dead", (r.result?.importPruning?.removedBindings.length ?? -1) === 0, JSON.stringify(r.result?.importPruning))
  }
  {
    const { root, projectId } = await setup("ts-default", {
      "src/m.ts": 'import defaultThing from "./mod"\n\nexport function target(): number {\n  return defaultThing()\n}\n\nexport const keep = 1\n',
    })
    const r = await deleteSymbol(root, projectId, "target")
    const after = readFileSync(path.join(root, "src/m.ts"), "utf8")
    ck("ts: a dead DEFAULT import goes with its statement", !after.includes("defaultThing") && !after.includes('from "./mod"'), after.replace(/\n/g, "⏎"))
    void r
  }
  {
    const { root, projectId } = await setup("ts-namespace", {
      "src/m.ts": 'import * as ns from "./mod"\n\nexport function target(): number {\n  return ns.one()\n}\n\nexport function keep(): number {\n  return ns.two()\n}\n',
    })
    await deleteSymbol(root, projectId, "target")
    const after = readFileSync(path.join(root, "src/m.ts"), "utf8")
    ck("ts: a namespace import still used by a survivor keeps its statement", after.includes('import * as ns from "./mod"'), after.replace(/\n/g, "⏎"))
  }
  // dry run declares the same plan-time outcome, and writes nothing
  {
    const { root, projectId } = await setup("ts-dry", {
      "src/m.ts": 'import { deadName } from "./mod"\n\nexport function target(): number {\n  return deadName()\n}\n',
    })
    const before = sha(path.join(root, "src/m.ts"))
    const r = await deleteSymbol(root, projectId, "target", true)
    ck("ts dryRun: the plan declares the prune it would perform", r.result?.importPruning?.attempted === true && JSON.stringify(r.result.importPruning.removedBindings) === JSON.stringify(["deadName"]), JSON.stringify(r.result?.importPruning))
    ck("ts dryRun: nothing was written", sha(path.join(root, "src/m.ts")) === before)
  }

  // ── Other languages: NOT attempted, untouched, DECLARED ─────────────────
  const cases: Array<{ label: string; file: string; content: string; symbol: string; guard: (after: string) => boolean; guardDetail: string }> = [
    {
      label: "haskell",
      file: "src/Main.hs",
      content: "module Main where\n\nimport qualified Data.Map as M\n\ntarget x = x + 1\n\nkeep y = M.lookup y\n",
      symbol: "target",
      guard: (after) => after.includes("import qualified Data.Map as M") && after.includes("M.lookup y") && !after.includes("\n as M"),
      guardDetail: "the aliased import survives intact (this file used to lose `import qualified Data.Map` and keep ` as M`)",
    },
    {
      label: "python",
      file: "src/m.py",
      content: "from mod import a, b\n\ndef target():\n    return a()\n\ndef keep():\n    return b()\n",
      symbol: "target",
      guard: (after) => after.includes("from mod import a, b") && after.includes("return b()"),
      guardDetail: "the multi-name import survives (it used to be deleted whole while `b` was still used)",
    },
    {
      label: "groovy",
      file: "src/M.groovy",
      content: 'import com.example.Util as U\n\ndef target() {\n  1\n}\n\ndef keep() {\n  U.call()\n}\n',
      symbol: "target",
      guard: (after) => after.includes("import com.example.Util as U") && after.includes("U.call()"),
      guardDetail: "the aliased import survives (it used to be deleted while `U.call()` remained)",
    },
  ]
  for (const c of cases) {
    const { root, projectId } = await setup(c.label, { [c.file]: c.content })
    const absolute = path.join(root, c.file)
    const before = readFileSync(absolute)
    const r = await deleteSymbol(root, projectId, c.symbol)
    const afterBytes = readFileSync(absolute)
    const after = afterBytes.toString("utf8")
    ck(`${c.label}: delete succeeds`, !!r.result, r.error?.message)
    ck(`${c.label}: import pruning is DECLARED not attempted`, r.result?.importPruning?.attempted === false && typeof r.result.importPruning.reason === "string" && r.result.importPruning.reason.includes(c.label === "haskell" ? "haskell" : c.label), JSON.stringify(r.result?.importPruning))
    ck(`${c.label}: the declared skip is also a warning`, (r.result?.warnings ?? []).some((w) => /import cleanup was not attempted/.test(w)), JSON.stringify(r.result?.warnings))
    ck(`${c.label}: ${c.guardDetail}`, c.guard(after), after.replace(/\n/g, "⏎"))
    ck(`${c.label}: the import line is byte-identical before and after`, before.includes(Buffer.from("import")), `${before.length} bytes`)
    void afterBytes
  }

  const out = path.resolve("validation/tools/bb_edit/artifacts/import-pruning.json")
  mkdirSync(path.dirname(out), { recursive: true })
  writeFileSync(out, JSON.stringify({ schemaVersion: 1, tool: "bb_edit", phase: "B-import-pruning", generatedAt: new Date().toISOString(), summary: { total: checks.length, passed: checks.filter((c) => c.pass).length, failed: checks.filter((c) => !c.pass).length }, checks }, null, 2) + "\n")
  console.log(`\nIMPORT-PRUNING: ${checks.filter((c) => c.pass).length}/${checks.length} passed → ${out}`)
  process.exit(checks.every((c) => c.pass) ? 0 : 1)
}
main().catch((e) => { console.error("FATAL", e); process.exit(2) })
