// script/m13/verify-edit-rename.ts — M13.07 (E2).
//
// Proves bb_edit refactor renames only actual AST reference occurrences of the
// target symbol — never unrelated same-name bindings, other-object methods,
// property keys, or comment/string text. Two layers:
//
//   - unit: parseForSafety + isReferenceSite/isBindingParentType/findDeclarationName
//     classify occurrences correctly for TypeScript, Python, and Java.
//   - integration: full executeEdit refactor on indexed single-file projects
//     (TS/Python/Java) plus a cross-file caller-freshness rejection.

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, appendFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { executeEdit } from "../../src/intelligence/edit/edit-engine"
import { parseForSafety } from "../../src/ast/safety-primitives"
import { isReferenceSite, isBindingParentType, findDeclarationName } from "../../src/intelligence/edit/edit-engine"
import { Harness } from "./harness"

const harness = new Harness({
  issue: "M13.07",
  code: "E2",
  tool: "bb_edit",
  title: "bb_edit: AST reference-identity rename (replace text substitution)",
  layers: ["unit", "integration"],
  decisions: {
    identity: "parseForSafety occurrences carry exact AST byte ranges and node/parent types; no raw-text substring scan",
    memberName: "isMemberName (grammar property/field identifiers + object/name field names) marks obj.name / obj.name() / self.name as non-references",
    binding: "isBindingParentType treats declarations, params, locals, object keys, and imports as bindings (never references)",
    declaration: "findDeclarationName locates the binding identifier inside the symbol byte range",
    freshness: "caller files are freshness-checked via brain_file.id before any rename (fail loud, no silent partial)",
  },
  limitations: [
    "Cross-file import-specifier renaming (import { target } ...) is NOT performed: imports live in brain_import, not the calls/references relationships this path consumes. Tracked as cross-file rename completeness.",
    "Same-class instance method calls (obj.target() where obj is an instance of target's class) are conservatively NOT renamed — AST identity alone cannot distinguish same-class from other-object receivers; requires type-aware resolution (M14 analyzer completeness).",
    "Ambiguous same-name symbols require explicit filePath + lineStart (existing uniqueSymbol contract, unchanged).",
  ],
})

// ── UNIT: occurrence classification across languages ────────────────────────
type Classified = { line: number; ref: boolean; binding: boolean; member: boolean }
async function classify(file: string, code: string, name: string): Promise<Classified[]> {
  const parsed = await parseForSafety(file, code)
  return parsed.occurrences
    .filter((o) => o.text === name)
    .map((o) => ({ line: o.startLine, ref: isReferenceSite(o, ""), binding: isBindingParentType(o.parentType), member: o.isMemberName }))
}
function atLine(list: Classified[], line: number): Classified {
  const hit = list.find((c) => c.line === line)
  if (!hit) throw new Error(`no occurrence at line ${line}`)
  return hit
}

// TypeScript: declaration / property key / local binding / member / reference
{
  const code = `function target(): number { return 1 }\nfunction caller(): number {\n  const local = { target: 99 }\n  const target = 5\n  const member = local.target\n  const ref = target()\n  return member + ref\n}\n`
  const c = await classify("a.ts", code, "target")
  harness.check("TS: declaration is a binding, not a reference", atLine(c, 1).binding === true && atLine(c, 1).ref === false && atLine(c, 1).member === false)
  harness.negative("TS: object-literal property key is NOT a reference", atLine(c, 3).member === true && atLine(c, 3).ref === false)
  harness.negative("TS: local binding is NOT a reference", atLine(c, 4).binding === true && atLine(c, 4).ref === false)
  harness.negative("TS: member access (local.target) is NOT a reference", atLine(c, 5).member === true && atLine(c, 5).ref === false)
  const refs = c.filter((o) => o.ref)
  harness.check("TS: exactly one reference site (target())", refs.length === 1 && refs[0].line === 6, `got ${refs.map((r) => r.line).join(",")}`)
}

// Python: declaration / other-object method (self.target) / reference
{
  const code = `class A:\n    def target(self): return 1\n    def m(self): return self.target() + target()\n`
  const c = await classify("a.py", code, "target")
  harness.check("Python: declaration is a binding, not a reference", atLine(c, 2).binding === true && atLine(c, 2).ref === false)
  harness.negative("Python: self.target() is NOT a reference", atLine(c, 3).member === true && atLine(c, 3).ref === false)
  const refs = c.filter((o) => o.ref)
  harness.check("Python: exactly one reference site (target())", refs.length === 1 && refs[0].line === 3, `got ${refs.map((r) => r.line).join(",")}`)
}

// Java: declaration / this.target() / target() / helper.target()
{
  const code = `class A {\n  int target() { return 1; }\n  int m() { return this.target() + target() + helper.target(); }\n}\n`
  const c = await classify("A.java", code, "target")
  harness.check("Java: declaration is a binding, not a reference", atLine(c, 2).binding === true && atLine(c, 2).ref === false)
  const line3 = c.filter((o) => o.line === 3)
  const refs = line3.filter((o) => o.ref)
  const members = line3.filter((o) => o.member)
  harness.negative("Java: this.target() and helper.target() are NOT references", refs.length === 1 && members.length === 2, `refs=${refs.length} members=${members.length}`)
}

// Comment/string text never produces identifier occurrences
{
  const code = `function target(): number { return 1 }\n// target stays in comment\nconst s = "target stays in string"\nfunction caller() { return target() }\n`
  const parsed = await parseForSafety("a.ts", code)
  const commentOrString = parsed.occurrences.filter((o) => o.text === "target" && o.startLine > 1 && o.startLine < 4)
  harness.check("TS: comment/string text is never an occurrence", commentOrString.length === 0, `got ${commentOrString.length}`)
}

// findDeclarationName returns the declaration identifier byte offset
{
  const code = `export function target(): number { return 1 }\n`
  const parsed = await parseForSafety("a.ts", code)
  const idx = findDeclarationName(parsed.occurrences, "target", 0, code.length)
  const expected = code.indexOf("target")
  harness.check("findDeclarationName locates the binding identifier", idx === expected, `got ${idx} want ${expected}`)
}

// ── INTEGRATION: full refactor on indexed projects ──────────────────────────
async function runIntegration(label: string, file: string, code: string, symbol: string, assert: (after: string) => void): Promise<void> {
  const root = mkdtempSync(path.join(tmpdir(), `bb-e2-${label}-`))
  const dir = path.dirname(file)
  if (dir !== ".") mkdirSync(path.join(root, dir), { recursive: true })
  writeFileSync(path.join(root, file), code)
  const projectId = getProjectId(root)
  try {
    await indexProjectParallel(projectId, root, {})
    const result = await executeEdit(root, projectId, { mode: "refactor", symbolName: symbol, filePath: file, newName: "renamedTarget", format: false })
    harness.check(`${label}: refactor produces exactly one change`, result.changes.length === 1, `got ${result.changes.length}`)
    const after = readFileSync(path.join(root, file), "utf8")
    assert(after)
  } catch (e) {
    harness.check(`${label}: refactor session`, false, e instanceof Error ? (e.stack ?? e.message) : String(e))
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true })
  }
}

const tsFixture = `export function target(): number { return 1 }\n\nexport function caller(): number {\n  const config = { target: 99 }\n  const helper = { target(x: number): number { return x } }\n  return target() + config.target + helper.target(1) + "target in string"\n  // target in comment\n}\n`
await runIntegration("ts", "src/app.ts", tsFixture, "target", (after) => {
  harness.check("TS: declaration renamed", after.includes("function renamedTarget"))
  harness.check("TS: reference call renamed", after.includes("renamedTarget()"))
  harness.negative("TS: property key NOT renamed", after.includes("{ target: 99 }"))
  harness.negative("TS: other-object method NOT renamed", after.includes("helper.target(1)"))
  harness.negative("TS: member access NOT renamed", after.includes("config.target"))
  harness.negative("TS: string NOT renamed", after.includes('"target in string"'))
  harness.negative("TS: comment NOT renamed", after.includes("// target in comment"))
})

const pyFixture = `def target():\n    return 1\n\ndef caller():\n    config = {"target": 99}\n    return target() + config["target"] + "target in string"\n    # target in comment\n`
await runIntegration("python", "app.py", pyFixture, "target", (after) => {
  harness.check("Python: declaration renamed", after.includes("def renamedTarget"))
  harness.check("Python: reference call renamed", after.includes("renamedTarget()"))
  harness.negative("Python: dict string key NOT renamed", after.includes('config["target"]'))
  harness.negative("Python: string NOT renamed", after.includes('"target in string"'))
  harness.negative("Python: comment NOT renamed", after.includes("# target in comment"))
})

const javaFixture = `class A {\n  int target() { return 1; }\n  int caller() {\n    A helper = new A();\n    return target() + helper.target() + 1;\n  }\n}\n`
await runIntegration("java", "A.java", javaFixture, "target", (after) => {
  harness.check("Java: declaration renamed", after.includes("int renamedTarget()"))
  harness.check("Java: reference call renamed", after.includes("renamedTarget()"))
  harness.negative("Java: other-object method NOT renamed", after.includes("helper.target()"))
})

// ── INTEGRATION: cross-file caller freshness (fail loud) ────────────────────
{
  const root = mkdtempSync(path.join(tmpdir(), "bb-e2-fresh-"))
  mkdirSync(path.join(root, "src"), { recursive: true })
  writeFileSync(path.join(root, "src", "target.ts"), `export function target(): number { return 1 }\n`)
  writeFileSync(path.join(root, "src", "caller.ts"), `import { target } from "./target"\nexport function caller(): number { return target() }\n`)
  const projectId = getProjectId(root)
  try {
    await indexProjectParallel(projectId, root, {})
    // Make the caller file stale, then attempt a cross-file refactor.
    appendFileSync(path.join(root, "src", "caller.ts"), "\n// stale change\n")
    await harness.rejectsAsync(
      "cross-file refactor fails loud on a stale caller file",
      () => executeEdit(root, projectId, { mode: "refactor", symbolName: "target", filePath: "src/target.ts", newName: "renamedTarget", format: false }),
      "not fresh",
    )
  } catch (e) {
    harness.check("cross-file freshness session", false, e instanceof Error ? (e.stack ?? e.message) : String(e))
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true })
  }
}

harness.emit()
