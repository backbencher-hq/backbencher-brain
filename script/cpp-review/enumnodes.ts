import { readFileSync } from "node:fs"
import { ASTEngine } from "../../src/ast/engine"
const [, , file, type] = process.argv
const content = readFileSync(file, "utf8")
const { tree } = await ASTEngine.parseTree(file, content)
let n = 0
const visit = (x: any, depth: number) => {
  if (x.type === type) {
    n++
    const nm = x.childForFieldName?.("name")?.text ?? (x.namedChildren ?? []).find((c: any) => c.type === "type_identifier")?.text
    // is this node inside a comment? walk up
    let inComment = false, p: any = x.parent
    while (p) { if (p.type === "comment") { inComment = true; break } p = p.parent }
    console.log(`  ${x.type} @${x.startPosition.row + 1} name=${JSON.stringify(nm)} insideComment=${inComment} text=${JSON.stringify(x.text.replace(/\n/g, "\\n").slice(0, 70))}`)
  }
  for (let i = 0; i < x.childCount; i++) { const c = x.child(i); if (c) visit(c, depth + 1) }
}
visit(tree.rootNode, 0)
console.log(`${type} nodes: ${n}`)
