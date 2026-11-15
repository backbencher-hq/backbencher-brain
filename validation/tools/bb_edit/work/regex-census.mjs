// Accurate regex census for the bb_edit code surface using the TypeScript AST.
import ts from "typescript"
import { readFileSync } from "node:fs"

const files = [
  "src/intelligence/edit/edit-engine.ts",
  "src/ast/safety-primitives.ts",
  "src/ast/brain-surgical-patcher.ts",
  "src/ast/import-pruner.ts",
  "src/mcp/tools/bb_edit/descriptor.ts",
  "src/mcp/tools/bb_edit/handler.ts",
]
let total = 0
for (const file of files) {
  const text = readFileSync(file, "utf8")
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS)
  const hits = []
  const walk = (node) => {
    if (ts.isRegularExpressionLiteral(node)) hits.push({ line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1, kind: "literal", text: node.getText().slice(0, 70), jsdoc: false })
    else if (ts.isNewExpression(node) && node.expression.getText() === "RegExp") hits.push({ line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1, kind: "new RegExp", text: node.getText().replace(/\s+/g, " ").slice(0, 90) })
    ts.forEachChild(node, walk)
  }
  walk(source)
  // regexes appearing only inside comments (documentation) are counted separately
  const commentLines = new Set()
  const commentRegex = /\/\/.*$|\/\*[\s\S]*?\*\//gm
  let m
  while ((m = commentRegex.exec(text))) {
    const start = source.getLineAndCharacterOfPosition(m.index).line
    const end = source.getLineAndCharacterOfPosition(m.index + m[0].length).line
    for (let i = start; i <= end; i++) commentLines.add(i + 1)
  }
  const codeHits = hits.filter((h) => !commentLines.has(h.line))
  total += codeHits.length
  console.log(`\n=== ${file}`)
  console.log(`   runtime regex operations: ${codeHits.length}`)
  for (const h of codeHits) console.log(`   L${h.line} [${h.kind}] ${h.text}`)
}
console.log(`\nTOTAL runtime regex operations in the bb_edit code surface: ${total}`)
