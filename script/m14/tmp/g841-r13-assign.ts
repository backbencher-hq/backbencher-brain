// Hypothesis from round 13's isolation: the trigger is not the typed parameter,
// it is a LOCAL DECLARATION whose initializer contains a closure.
import { ASTEngine } from "../../../src/ast/engine"

const CASES: [string, string][] = [
  ["1 decl-literal-empty", `class C { def m() { def x = { 1 } } }\n`],
  ["2 decl-literal-zeroarg", `class C { def m() { def x = { -> 42 } } }\n`],
  ["3 decl-literal-params", `class C { def m() { def x = { a, b -> a } } }\n`],
  ["4 decl-call-trailing-closure", `class C { def m() { def x = list.collect { it } } }\n`],
  ["5 decl-call-parens-closure", `class C { def m() { def x = list.collect() { it } } }\n`],
  ["6 decl-plain", `class C { def m() { def x = 1 } }\n`],
  ["7 decl-list", `class C { def m() { def x = [1, 2] } }\n`],
  ["8 assign-literal", `class C { def m() { x = { 1 } } }\n`],
  ["9 typed-decl-literal", `class C { def m() { Closure c = { 1 } } }\n`],
  ["10 top-level-decl-literal", `def x = { 1 }\n`],
  ["11 decl-closure-then-stmt", `class C { def m() { def x = { 1 }\n        println x } }\n`],
  ["12 decl-nested-closure-in-call", `class C { def m() { def x = foo({ 1 }) } }\n`],
  ["13 field-literal", `class C { def x = { 1 } }\n`],
  ["14 method-return-literal", `class C { def m() { return { 1 } } }\n`],
]

const parser = await ASTEngine.getParser("groovy" as any)
for (const [name, src] of CASES) {
  const t = parser.parse(src)
  console.log(`${t.rootNode.hasError ? "ERR " : "OK  "} ${name}`)
}
