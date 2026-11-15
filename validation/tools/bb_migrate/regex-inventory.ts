// AST inventory of regex literals / RegExp constructions in bb_migrate's own sources,
// including the cross-language assistant that the policy gate's scan roots do not cover.
import { readFileSync } from "node:fs"
import path from "node:path"
import ts from "typescript"
const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")
const files = [
  "src/mcp/tools/bb_migrate/handler.ts",
  "src/mcp/tools/bb_migrate/descriptor.ts",
  "src/intelligence/migration/migration-engine.ts",
  "src/intelligence/migration/migration-source.ts",
  "src/intelligence/migration/migration-evidence.ts",
  "src/ast/cross-language-migration-assistant.ts",
]
const rows: any[] = []
for (const relative of files) {
  const source = ts.createSourceFile(relative, readFileSync(path.join(ROOT, relative), "utf8"), ts.ScriptTarget.ES2022, true)
  const lineOf = (pos: number) => source.getLineAndCharacterOfPosition(pos).line + 1
  const visit = (node: ts.Node) => {
    if (node.kind === ts.SyntaxKind.RegularExpressionLiteral) rows.push({ file: relative, line: lineOf(node.getStart(source)), kind: "literal", text: (node as any).text })
    if (ts.isNewExpression(node) && node.expression.getText(source) === "RegExp") rows.push({ file: relative, line: lineOf(node.getStart(source)), kind: "constructor", text: node.arguments?.[0]?.getText(source)?.slice(0, 160) })
    ts.forEachChild(node, visit)
  }
  visit(source)
}
console.log(JSON.stringify({ files, count: rows.length, rows }, null, 1))
