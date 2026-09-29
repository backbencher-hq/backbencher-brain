import { readFileSync } from "node:fs"
import { ASTEngine } from "../../src/ast/engine"
const f = "$HOME/ishaq/fixtures/repositories/fmt/test/enum-test.cc"
const { tree } = await ASTEngine.parseTree(f, readFileSync(f, "utf8"))
const visit = (n: any) => {
  if (n.type === "enum_specifier" && n.startPosition.row === 23) {
    let p: any = n
    for (let i = 0; i < 4 && p; i++) {
      const fields: string[] = []
      for (let k = 0; k < p.childCount; k++) {
        const c = p.child(k)
        const fn = (p as any).fieldNameForChild ? (p as any).fieldNameForChild(k) : null
        if (fn) fields.push(`${fn}=${c.type}(${JSON.stringify(c.text.slice(0, 24))})`)
      }
      console.log(`  up${i}: ${p.type} line=${p.startPosition.row + 1} fields=[${fields.join(" ")}]`)
      p = p.parent
    }
  }
  for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) visit(c) }
}
visit(tree.rootNode)
