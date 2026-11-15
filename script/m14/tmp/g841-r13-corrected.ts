// CORRECTED probes for round 13.
//
// Round 13's first probe set was invalid as an instrument: `class C { def m() {
// def x = 1 } }` is an ERROR in this grammar because a local declaration needs a
// trailing DELIMITER and a single-line body supplies none before `}` — while
// `{ def m() { list.each { it } } }` passes, because an expression statement is
// covered by the method-body tail escape. So every case whose last statement was
// a declaration reported ERR for a reason that had nothing to do with the
// construct under test. That is a manufactured failure of exactly the family the
// reducer's header warns about.
//
// Every case below is therefore multi-line and ends with a `return`, so no case's
// verdict can come from the tail-escape rule.
import { ASTEngine } from "../../../src/ast/engine"

const CASES: [string, string, boolean][] = [
  // the construct under test: bare-name type in closure-parameter position
  ["typed-safe-call-closure", `class C {\n  def m() {\n    def x = files?.find() { File f -> f.name.endsWith('.groovy') }\n    return x\n  }\n}\n`, false],
  ["typed-call-closure", `class C {\n  def m() {\n    def x = files.find() { File f -> f.name }\n    return x\n  }\n}\n`, false],
  ["typed-noparens-closure", `class C {\n  def m() {\n    def x = files.find { File f -> f.name }\n    return x\n  }\n}\n`, false],
  ["typed-two-params", `class C {\n  def m() {\n    props.each { String key, Object value -> map.put(key, value) }\n    return map\n  }\n}\n`, false],
  ["untyped-safe-call-closure", `class C {\n  def m() {\n    def x = files?.find() { f -> f.name }\n    return x\n  }\n}\n`, false],
  // regression class: typed locals, multi-line, with a trailing return
  ["local-String", `class C {\n  def m() {\n    String property = getVersionPropertyReference()\n    return property\n  }\n}\n`, false],
  ["local-File", `class C {\n  def m() {\n    File file = tagsFile.get().asFile\n    return file\n  }\n}\n`, false],
  ["local-int", `class C {\n  def m() {\n    int braceCount = 1\n    return braceCount\n  }\n}\n`, false],
  ["local-generic", `class C {\n  def m() {\n    List<String> names = new ArrayList<String>()\n    return names\n  }\n}\n`, false],
  ["local-closure-valued", `class C {\n  def m() {\n    Closure c = { 1 }\n    return c\n  }\n}\n`, false],
  ["field-typed-and-used", `class C {\n  String name = 'x'\n  def m() {\n    return name\n  }\n}\n`, false],
]

const parser = await ASTEngine.getParser("groovy" as any)
let wrong = 0
for (const [name, src, expectError] of CASES) {
  const t = parser.parse(src)
  const err = t.rootNode.hasError
  const ok = err === expectError
  if (!ok) wrong++
  console.log(`${ok ? "OK  " : "FAIL"} ${name.padEnd(26)} hasError=${err}`)
}
console.log(wrong === 0 ? "\nall cases agree with expectation" : `\n${wrong} case(s) disagree`)
if (wrong > 0) process.exitCode = 1
