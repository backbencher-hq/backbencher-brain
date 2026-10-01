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
    "Some grammars name declaration identifiers with non-identifier node types (Bash 'word', Perl 'bareword', Erlang 'atom', Clojure 'sym_name'/'sym_lit', PowerShell 'function_name', PHP 'name') and Elixir 'def' names parse as call arguments — these names are not reference occurrences, so rename cannot see them. Tracked as M14 reference-identification completeness.",
    "R function assignment (foo <- function()) parents the name under 'binary_operator' (ambiguous with arithmetic), so R binding names are not recognized. Tracked as M14.",
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

// ── UNIT: cross-language declaration-name binding classification ───────────
// The classifier must recognize every grammar's declaration container, not just
// TS/Python/Java. Each case parses a declaration and asserts the name occurrence
// is a binding (parent node is a recognized declaration container).
const xlangDecls: Array<{ lang: string; file: string; code: string; name: string }> = [
  { lang: "typescript", file: "a.ts", code: `function foo() { return 1 }\n`, name: "foo" },
  { lang: "javascript", file: "a.js", code: `function foo() { return 1 }\n`, name: "foo" },
  { lang: "python", file: "a.py", code: `def foo():\n    return 1\n`, name: "foo" },
  { lang: "ruby", file: "a.rb", code: `def foo\n  1\nend\n`, name: "foo" },
  { lang: "haskell", file: "a.hs", code: `foo = 1\n`, name: "foo" },
  { lang: "lua", file: "a.lua", code: `function foo() end\n`, name: "foo" },
  { lang: "c", file: "a.c", code: `int foo() { return 0; }\n`, name: "foo" },
  { lang: "cpp", file: "a.cpp", code: `int foo() { return 0; }\n`, name: "foo" },
  { lang: "rust", file: "a.rs", code: `fn foo() {}\n`, name: "foo" },
  { lang: "go", file: "a.go", code: `package p\nfunc foo() {}\n`, name: "foo" },
  { lang: "zig", file: "a.zig", code: `fn foo() void {}\n`, name: "foo" },
  { lang: "java", file: "A.java", code: `class A { int foo() { return 0; } }\n`, name: "foo" },
  { lang: "kotlin", file: "a.kt", code: `fun foo() {}\n`, name: "foo" },
  { lang: "scala", file: "a.scala", code: `object A { def foo = 1 }\n`, name: "foo" },
  { lang: "groovy", file: "a.groovy", code: `def foo() { 1 }\n`, name: "foo" },
  { lang: "swift", file: "a.swift", code: `func foo() {}\n`, name: "foo" },
  { lang: "dart", file: "a.dart", code: `void foo() {}\n`, name: "foo" },
  { lang: "csharp", file: "a.cs", code: `class A { void Foo() {} }\n`, name: "Foo" },
  { lang: "fsharp", file: "a.fs", code: `let foo x = x\n`, name: "foo" },
  { lang: "objective-c", file: "a.m", code: `@interface A\n- (int)foo;\n@end\n`, name: "foo" },
  // type/class declarations
  { lang: "typescript", file: "a.ts", code: `class Foo {}\n`, name: "Foo" },
  { lang: "rust", file: "a.rs", code: `struct Foo {}\n`, name: "Foo" },
  { lang: "cpp", file: "a.cpp", code: `class Foo {};\n`, name: "Foo" },
  { lang: "go", file: "a.go", code: `package p\ntype Foo struct{}\n`, name: "Foo" },
  { lang: "ruby", file: "a.rb", code: `class Foo\nend\n`, name: "Foo" },
  { lang: "fsharp", file: "a.fs", code: `type Foo = int\n`, name: "Foo" },
  { lang: "dart", file: "a.dart", code: `class Foo {}\n`, name: "Foo" },
  { lang: "java", file: "A.java", code: `class Foo {}\n`, name: "Foo" },
]
for (const d of xlangDecls) {
  let parsed
  try {
    parsed = await parseForSafety(d.file, d.code)
  } catch (e) {
    harness.check(`${d.lang}: parseForSafety succeeds`, false, e instanceof Error ? e.message : String(e))
    continue
  }
  const occ = parsed.occurrences.filter((o) => o.text === d.name)
  harness.check(`${d.lang}: declaration name is a recognized binding`, occ.length >= 1 && isBindingParentType(occ[0].parentType), occ.length === 0 ? "name not extracted" : `parent=${occ[0].parentType}`)
}

// Documented reference-identification gaps: the name node type is not an
// identifier occurrence, so rename cannot see it (verified here, not hidden).
const xlangNameGaps: Array<{ lang: string; file: string; code: string; name: string }> = [
  { lang: "bash", file: "a.sh", code: `foo() { :; }\n`, name: "foo" },
  { lang: "perl", file: "a.pl", code: `sub foo { return 1; }\n`, name: "foo" },
  { lang: "erlang", file: "a.erl", code: `foo() -> ok.\n`, name: "foo" },
  { lang: "clojure", file: "a.clj", code: `(defn foo [] 1)\n`, name: "foo" },
  { lang: "powershell", file: "a.ps1", code: `function Foo { 1 }\n`, name: "Foo" },
  { lang: "php", file: "a.php", code: `<?php\nfunction foo() { return 1; }\n`, name: "foo" },
]
for (const g of xlangNameGaps) {
  const parsed = await parseForSafety(g.file, g.code)
  harness.check(`${g.lang}: name is a documented M14 reference-identification gap (not an occurrence)`, parsed.occurrences.filter((o) => o.text === g.name).length === 0, `got ${parsed.occurrences.filter((o) => o.text === g.name).length}`)
}

// ── UNIT: member-access receiver classification (regression-proof) ──
// In `obj.field`, the receiver `obj` MUST be a reference (not a binding).
// BUG FIXED: isBindingParentType substring t.includes("field") falsely matched
// field_expression (Rust/C++/Scala/Zig) and field_access (Java), classifying
// the receiver as a binding → silent under-rename. Fixed by FALSE_POSITIVE_
// BINDING_TYPES deny-list checked before substring rules.
//
// Other access types (member_expression, attribute, selector_expression,
// navigation_expression) were NOT broken — isMemberNameNode returns true
// for the member name before isBindingParentType runs on the receiver.
// Only field_expression and field_access required the deny-list fix.
//
// Fixtures cover: (a) affected grammars that WERE broken, (b) other grammars
// to prove no regression, (c) memberNameKnown grammars to verify member side.
const memberAccessCases: Array<{ lang: string; file: string; code: string; receiverName: string; memberName: string; memberNameKnown: boolean; wasBroken: boolean }> = [
  // These grammars WERE broken (field_expression / field_access matched t.includes("field")):
  { lang: "rust", file: "a.rs", code: `fn f() { let _ = obj.field; }`, receiverName: "obj", memberName: "field", memberNameKnown: true, wasBroken: true },
  { lang: "java", file: "A.java", code: `class A { void f() { int _ = obj.field; } }`, receiverName: "obj", memberName: "field", memberNameKnown: true, wasBroken: true },
  { lang: "cpp", file: "a.cpp", code: `void f() { int _ = obj.field; }`, receiverName: "obj", memberName: "field", memberNameKnown: true, wasBroken: true },
  { lang: "scala", file: "a.scala", code: `object A { def f = { val _ = obj.field } }`, receiverName: "obj", memberName: "field", memberNameKnown: false, wasBroken: true },
  // These grammars were NOT broken (isMemberNameNode already handles them):
  { lang: "python", file: "a.py", code: `_ = obj.field`, receiverName: "obj", memberName: "field", memberNameKnown: true, wasBroken: false },
  { lang: "go", file: "a.go", code: `package p\nfunc f() { _ = obj.field }`, receiverName: "obj", memberName: "field", memberNameKnown: true, wasBroken: false },
  { lang: "typescript", file: "a.ts", code: `const _ = obj.field;`, receiverName: "obj", memberName: "field", memberNameKnown: true, wasBroken: false },
  // Grammars where isMemberNameNode is incomplete (pre-existing, not a regression):
  { lang: "dart", file: "a.dart", code: `void f() { print(obj.field); }`, receiverName: "obj", memberName: "field", memberNameKnown: false, wasBroken: false },
  { lang: "swift", file: "a.swift", code: `func f() { let _ = obj.field }`, receiverName: "obj", memberName: "field", memberNameKnown: false, wasBroken: false },
  { lang: "kotlin", file: "a.kt", code: `fun f() { val _ = obj.field }`, receiverName: "obj", memberName: "field", memberNameKnown: false, wasBroken: false },
  { lang: "csharp", file: "a.cs", code: `class A { void F() { var _ = obj.Field; } }`, receiverName: "obj", memberName: "Field", memberNameKnown: false, wasBroken: false },
]
for (const c of memberAccessCases) {
  const parsed = await parseForSafety(c.file, c.code)
  const receivers = parsed.occurrences.filter((o) => o.text === c.receiverName)
  const members = parsed.occurrences.filter((o) => o.text === c.memberName)
  for (const r of receivers) {
    harness.check(
      `${c.lang}: receiver \`${c.receiverName}\` in \`${c.receiverName}.${c.memberName}\` is a REFERENCE (not a binding)`,
      isReferenceSite(r, "") === true && r.isMemberName === false,
      `parent=${r.parentType} isBinding=${isBindingParentType(r.parentType)} isRef=${isReferenceSite(r, "")} isMember=${r.isMemberName}`,
    )
  }
  if (c.memberNameKnown) {
    for (const m of members) {
      harness.negative(
        `${c.lang}: member name \`${c.memberName}\` in \`${c.receiverName}.${c.memberName}\` is NOT a reference`,
        m.isMemberName === true && isReferenceSite(m, "") === false,
        `parent=${m.parentType} isMember=${m.isMemberName}`,
      )
    }
  }
}

// ── UNIT: qualified type references (scoped_type_identifier) ────────────────
// com.foo.Bar — the last segment (Bar) is a type reference, NOT a binding and
// NOT a member name. The package segments (com, foo) are qualifiers whose text
// won't match symbolName, so they self-resolve via the o.text filter.
// scoped_type_identifier was never broken by substring rules but is tested
// here to prevent regression from any future classification changes.
{
  for (const [lang, file, code] of [
    ["Groovy", "a.groovy", `class A extends com.foo.Bar {}`],
    ["Java", "A.java", `class A extends com.foo.Bar {}`],
  ]) {
    const parsed = await parseForSafety(file as string, code as string)
    const bars = parsed.occurrences.filter((o) => o.text === "Bar")
    harness.check(
      `${lang}: qualified type reference \`com.foo.Bar\` — \`Bar\` is a REFERENCE`,
      bars.length === 1 && isReferenceSite(bars[0], "") === true && bars[0].isMemberName === false,
      bars.length === 0 ? "Bar not extracted" : `parent=${bars[0].parentType} isRef=${isReferenceSite(bars[0], "")} isMember=${bars[0].isMemberName}`,
    )
  }
}

// ── INTEGRATION: full refactor on indexed projects ──────────────────────────
async function runIntegration(label: string, file: string, code: string, symbol: string, assert: (after: string) => void, lineStart?: number): Promise<void> {
  const root = mkdtempSync(path.join(tmpdir(), `bb-e2-${label}-`))
  const dir = path.dirname(file)
  if (dir !== ".") mkdirSync(path.join(root, dir), { recursive: true })
  writeFileSync(path.join(root, file), code)
  const projectId = getProjectId(root)
  try {
    await indexProjectParallel(projectId, root, {})
    // `lineStart` disambiguates. The TypeScript fixture deliberately contains
    // same-name constructs — `{ target: 99 }`, `{ target(x) {...} }` — because the
    // gate asserts they are NOT renamed. That makes the name genuinely ambiguous
    // in that file, and bb_edit's documented answer is "provide filePath and
    // lineStart". The call supplied filePath but not lineStart, so the tool
    // correctly refused and the gate recorded a failure before reaching any of the
    // assertions it was written to make.
    //
    // Verified rather than assumed: with lineStart:1 the same edit renames the
    // declaration and its call site, and ALL SEVEN of this gate's own assertions
    // hold — including every negative (property key, other-object method, member
    // access, string literal and comment all left alone). The fixture was right;
    // the CALL was wrong.
    const result = await executeEdit(root, projectId, { mode: "refactor", symbolName: symbol, filePath: file, lineStart, newName: "renamedTarget", format: false })
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
}, 1)

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
