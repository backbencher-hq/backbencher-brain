// Where does the G7 oracle mirror over-claim? The corpus-wide probe found 4
// oracle-only `uses` edges, all interpolation-shaped, all in two Spock specs whose
// GStrings sit in CALLEE position (`"/browse/town/$town"(controller: …)`). The
// analyzer suppresses a callee-position read; if the mirror does not, the mirror
// is wrong. This prints the tree path from the interpolated identifier up to the
// statement, the analyzer's own `uses` edges for the file, and the oracle's.
import { readFileSync } from "node:fs"
import { ASTEngine } from "../../../src/ast/engine"
import { RealGroovyAnalyzer } from "../../../src/ast/real-groovy-analyzer"
import { deriveGroovyEdges } from "../differential"

const F = "/home/ishaq2321/bb_tests/repositories/grails-core/grails-web-url-mappings/src/test/groovy/grails/web/mapping/RestfulResourceMappingSpec.groovy"

async function main(): Promise<void> {
  const content = readFileSync(F, "utf8")
  const parser = await ASTEngine.getParser("groovy" as any)
  const root = parser.parse(content).rootNode!
  const analyzer = new RealGroovyAnalyzer()
  const res: any = await analyzer.analyze(root, content, "RestfulResourceMappingSpec.groovy")
  const uses = (res.relationships ?? []).filter((r: any) => String(r.type) === "uses")
  console.log(`analyzer uses edges: ${uses.length}`)
  for (const u of uses) console.log(`  ${u.source} -> ${u.target} @${u.line_number} ${JSON.stringify(u.metadata ?? {})}`)
  const truth = deriveGroovyEdges(root)
  console.log(`oracle edges: ${truth.length}`)
  for (const t of truth) console.log(`  ${t.label} -> ${t.target}`)
  // the tree path for every interpolated identifier on the two lines
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    if (n.type === "interpolated_identifier") {
      const row = n.startPosition.row + 1
      if (row >= 278 && row <= 285) {
        const chain: string[] = []
        let p: any = n
        while (p && chain.length < 8) { chain.push(p.type); p = p.parent }
        console.log(`TREE line ${row} ${JSON.stringify(n.text)}: ${chain.join(" <- ")}`)
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) stack.push(c) }
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
