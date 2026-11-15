// #841 round 13: BOTH SIDES of the scanner change.
//
// The four falsified rule-level attempts all bought the first column and broke
// the second (§7h: the corpus A/B found 1,480 files, all `Type name = …` local
// declarations). So a probe that only tests the fix is not evidence.
import { ASTEngine } from "../../../src/ast/engine"

const CASES: [string, string, boolean][] = [
  // [name, source, expectError]
  // --- the fix: bare-name types in closure-parameter position ---
  ["typed-closure-param", `class A { def m() { def x = files.find() { File f -> f.name.endsWith('.groovy') } } }\n`, false],
  ["typed-closure-2params", `class A { def m() { props.each { String key, Object value -> map.put(key, value) } } }\n`, false],
  ["typed-closure-parens", `class A { def m() { items.find { String it -> it.startsWith('x') } } }\n`, false],
  ["typed-closure-multiline", `class A { def m() { list.any() { AnnotationNode ann ->\n        ann.name == 'x' } } }\n`, false],
  // --- the classes that must NOT regress ---
  ["typed-local", `class A { def m() { String property = getVersionPropertyReference() } }\n`, false],
  ["typed-local-file", `class A { def m() { File file = tagsFile.get().asFile } }\n`, false],
  ["typed-local-int", `class A { def m() { int braceCount = 1 } }\n`, false],
  ["typed-local-generic", `class A { def m() { List<String> names = new ArrayList<String>() } }\n`, false],
  // --- untyped / def / zero-arg closures must be untouched ---
  ["untyped-params", `class A { def m() { list.each { a, b -> println a } } }\n`, false],
  ["untyped-it-arrow", `class A { def m() { list.each { it -> println it } } }\n`, false],
  ["def-params", `class A { def m() { c >> { def args -> println args } } }\n`, false],
  ["zero-arg", `class A { def m() { def c = { -> 42 } } }\n`, false],
  ["no-params", `class A { def m() { list.each { println it } } }\n`, false],
  // --- negative control: a comma-less, arrow-less sequence is not params ---
  ["arithmetic-body", `class A { def m() { def c = { Type a - b } } }\n`, false],
]

const parser = await ASTEngine.getParser("groovy" as any)
let wrong = 0
for (const [name, src, expectError] of CASES) {
  const tree = parser.parse(src)
  const root = tree.rootNode
  const hasErr = root.hasError
  const ok = hasErr === expectError
  if (!ok) wrong++
  console.log(`${ok ? "OK  " : "FAIL"} ${name.padEnd(22)} hasError=${hasErr}${expectError ? " (expected error)" : ""}`)
}
console.log(wrong === 0 ? "\nall probes agree with expectation" : `\n${wrong} probe(s) disagree`)
if (wrong > 0) process.exitCode = 1
