import * as fs from "node:fs"
import { ASTEngine } from "../../../src/ast/engine"
const P = "validation/m14/fixtures/go/grouped-and-embedded-fields-889.go"
const src = fs.readFileSync(P, "utf8")
const parser = await ASTEngine.getParser("go" as any)
const tree: any = parser.parse(src)
const walk = (n: any) => {
  if (n.type === "field_declaration") {
    const kids: string[] = []
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      kids.push(`${c.type}:${JSON.stringify(String(c.text).slice(0, 24))}`)
    }
    console.log(`field_declaration ${JSON.stringify(String(n.text).slice(0, 40))}`)
    console.log(`   named children: ${kids.join(" | ")}`)
    console.log(`   field("name")=${JSON.stringify(n.childForFieldName("name")?.type ?? null)} field("type")=${JSON.stringify(n.childForFieldName("type")?.type ?? null)}`)
  }
  for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i))
}
walk(tree.rootNode)
