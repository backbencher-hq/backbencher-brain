// M12.26: shape-safety — analyzer `.type ===` refs vs grammar's emitted node types.
import { ASTEngine } from "../../src/ast/engine"
import { readFileSync } from "fs"

const analyzer = readFileSync("src/ast/real-clean-analyzer.ts", "utf8")
const refs = new Set<string>()
for (const m of analyzer.matchAll(/\.type\s*===\s*"([a-z_]+)"/g)) refs.add(m[1])

const root = "$HOME/fixtures/repositories/clean-stdlib"
const files = (await Bun.$`ls ${root}/*.icl ${root}/*.dcl`.text()).trim().split("\n").filter(Boolean)
const parser = await ASTEngine.getParser("clean")
const emitted = new Set<string>()
for (const f of files) {
  const src = await Bun.file(f).text()
  const tree = parser.parse(src)
  const walk = (n: any) => {
    emitted.add(n.type)
    for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i))
  }
  walk(tree.rootNode)
}
console.log(`analyzer refs: ${refs.size}, grammar emitted: ${emitted.size}`)
const missing = [...refs].filter((r) => !emitted.has(r)).sort()
console.log("MISSING refs:", missing.length ? missing.join(", ") : "none")
