// Why no read for className inside /${className}.groovy/ in the FIXTURE file
// (line 73), when the isolated probe DID emit one? Dump the actual tree.
import { readFileSync } from "node:fs"
import * as m from "../run-fixtures"

async function main(): Promise<void> {
  const parser: any = await (m as any).getParser("groovy")
  const src = readFileSync("validation/m14/fixtures/groovy/interpolation-reads-g7.groovy", "utf8")
  const tree = parser.parse(src)
  const slashy: any[] = []
  const visit = (n: any): void => {
    if (n.type === "slashy_string") slashy.push(n)
    for (let i = 0; i < n.childCount; i++) { const c: any = n.child(i); if (c) visit(c) }
  }
  visit(tree.rootNode)
  for (const s of slashy) {
    console.log(`slashy @${s.startPosition.row + 1}:${s.startPosition.column} -> "${s.text.slice(0, 50)}"`)
    const show = (n: any, d: number): void => {
      const leaf = n.childCount === 0 ? ` "${n.text.slice(0, 30)}"` : ""
      console.log("  ".repeat(d) + n.type + leaf)
      for (let i = 0; i < n.childCount; i++) { const c: any = n.child(i); if (c) show(c, d + 1) }
    }
    show(s, 2)
  }
  console.log("hasError:", tree.rootNode.hasError)
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
