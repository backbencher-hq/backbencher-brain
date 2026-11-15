// Where is the ERROR in `def x = files?.find() { File f -> f.name }`?
import { ASTEngine } from "../../../src/ast/engine"

const CASES: [string, string][] = [
  ["FIX-TARGET typed + safe-nav", `class C {\n  def m() {\n    def x = files?.find() { File f -> f.name }\n    return x\n  }\n}\n`],
  ["CONTROL untyped + safe-nav", `class C {\n  def m() {\n    def x = files?.find() { f -> f.name }\n    return x\n  }\n}\n`],
]

const parser = await ASTEngine.getParser("groovy" as any)
for (const [name, src] of CASES) {
  const tree = parser.parse(src)
  const root = tree.rootNode
  console.log(`\n=== ${name}  hasError=${root.hasError} ===`)
  const lines = root.toString().split("\n")
  const idx = lines.findIndex((l) => l.includes("ERROR") || l.includes("MISSING"))
  if (idx >= 0) console.log(lines.slice(Math.max(0, idx - 4), idx + 4).join("\n"))
  else console.log(lines.join("\n").slice(0, 600))
}
