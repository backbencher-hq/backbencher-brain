// The tree HAS `string_interpolation` at line 73, but the analyzer emitted no
// read. Instrument the analyzer path: run analyze() and print every node type it
// visits inside slashyFilter, plus the interpolation branch decisions.
import { readFileSync } from "node:fs"
import * as m from "../run-fixtures"
import { RealGroovyAnalyzer } from "../../../src/ast/real-groovy-analyzer"

async function main(): Promise<void> {
  const parser: any = await (m as any).getParser("groovy")
  const src = readFileSync("validation/m14/fixtures/groovy/interpolation-reads-g7.groovy", "utf8")
  const tree = parser.parse(src)
  const a: any = new RealGroovyAnalyzer()

  // instrument: wrap the walk by spying on relationships after full analyze
  const res: any = await a.analyze(tree.rootNode, src, "fixtures/groovy/interpolation-reads-g7.groovy")
  const interp = (res.relationships ?? []).filter((r: any) => (r.metadata ?? {}).isInterpolationRead)
  console.log("interpolation reads:", JSON.stringify(interp.map((r: any) => `${r.source}->${r.target}@${r.line_number}`)))

  // now check whether the walk even REACHES the interpolation: the stack walk in
  // collectFieldAccessUses pushes children only for named children. Print the
  // named children of the enclosing block to see the shapes the walk sees.
  const find = (n: any, t: string, out: any[] = []): any[] => {
    if (n.type === t) out.push(n)
    for (let i = 0; i < n.namedChildCount; i++) { const c: any = n.namedChild(i); if (c) find(c, t, out) }
    return out
  }
  const interpNodes = find(tree.rootNode, "string_interpolation")
  for (const n of interpNodes) {
    const chain: string[] = []
    let p: any = n
    while (p) { chain.unshift(p.type); p = p.parent }
    console.log(`string_interpolation @${n.startPosition.row + 1} ancestor-chain: ${chain.join(" < ")}`)
    console.log(`  parent = ${n.parent?.type}; grandparent = ${n.parent?.parent?.type}`)
  }
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
