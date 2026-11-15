// Isolate the REAL trigger for the corpus line
//   dirFiles?.find() { File f -> f.name.endsWith('.groovy') }
// by varying one thing at a time. `files.find { String it -> … }` already parses
// (probe round 13), so "typed closure param" alone is not the trigger.
import { ASTEngine } from "../../../src/ast/engine"

const CASES: [string, string][] = [
  ["A noParens-untyped", `class C { def m() { files.find { f -> f.name } } }\n`],
  ["B noParens-typed", `class C { def m() { files.find { File f -> f.name } } }\n`],
  ["C parens-untyped", `class C { def m() { files.find() { f -> f.name } } }\n`],
  ["D parens-typed", `class C { def m() { files.find() { File f -> f.name } } }\n`],
  ["E parens-safe-prefix-untyped", `class C { def m() { def x = files?.find() { f -> f.name } } }\n`],
  ["F parens-safe-prefix-typed", `class C { def m() { def x = files?.find() { File f -> f.name } } }\n`],
  ["G assign-parens-typed", `class C { def m() { def x = files.find() { File f -> f.name } } }\n`],
  ["H assign-noparens-typed", `class C { def m() { def x = files.find { File f -> f.name } } }\n`],
  ["I parens-closure-noargslist", `class C { def m() { def x = files.find() { f.name } } }\n`],
  ["J nested-call-parens-typed", `class C { def m() { list.add findAll() { File f -> f.name } } }\n`],
]

const parser = await ASTEngine.getParser("groovy" as any)
for (const [name, src] of CASES) {
  const t = parser.parse(src)
  console.log(`${t.rootNode.hasError ? "ERR " : "OK  "} ${name}`)
}
