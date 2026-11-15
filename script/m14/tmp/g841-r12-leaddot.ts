// #841 round 12 probe: does leading-dot continuation parse now?
//
// Both shapes are lifted verbatim from the corpus files that nominated the
// round, and both were verified legal with the real compiler (Groovy 3.0.24
// FileSystemCompiler, exit 0) before any grammar change.
import { ASTEngine } from "../../../src/ast/engine"
import { writeFileSync, mkdirSync } from "node:fs"

const ROOT = process.cwd()
void ROOT
mkdirSync("/tmp/g841-r12-probe", { recursive: true })

const CASES: [string, string][] = [
  ["cast-then-dot", `class A { def m(loaded) { ((org.example.Dirty) loaded)\n        .listDirtyPropertyNames() != null } }\n`],
  ["five-line-chain", `class B { def n(thing) { def d = thing\n            .sessions\n            .first()\n            .backingMap['Player']\n            .size() == 1\n        return d } }\n`],
  ["assign-then-dot", `class C { def p() { def x = foo()\n            .bar()\n            .baz()\n        return x } }\n`],
  // NEGATIVE control: a SEMICOLON must still terminate, so this stays an error.
  ["semicolon-then-dot", `class D { def q() { def y = 1;\n        .trim() } }\n`],
]

let bad = 0
for (const [name, src] of CASES) {
  const p = `/tmp/g841-r12-probe/${name}.groovy`
  writeFileSync(p, src)
  const parser = await ASTEngine.getParser("groovy" as any)
  const tree = parser.parse(src)
  const err = tree?.rootNode ? tree.rootNode.hasError : "no-tree"
  const expectError = name.startsWith("semicolon")
  const ok = expectError ? err === true : err === false
  if (!ok) bad++
  console.log(`${ok ? "OK  " : "FAIL"} ${name.padEnd(20)} hasError=${err}${expectError ? "  (expected: still an error)" : ""}`)
}
console.log(bad === 0 ? "\nall leading-dot shapes parse; the semicolon control still fails" : `\n${bad} case(s) wrong`)
if (bad > 0) process.exitCode = 1
