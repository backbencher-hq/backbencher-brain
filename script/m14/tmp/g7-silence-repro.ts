// Why is the analyzer silent on `"/browse/town/$town"(...)` while the oracle
// mirror claims a read? Reduce the corpus shape step by step.
import { ASTEngine } from "../../../src/ast/engine"
import { RealGroovyAnalyzer } from "../../../src/ast/real-groovy-analyzer"

const CASES: Array<[string, string]> = [
  ["corpus-shape", `class S {
    void t() {
        def h = getUrlMappingsHolder {
            group "/home", {
                "/browse/town/$town"(controller: 'browser', action:[GET:"index"]) {
                }
            }
        }
    }
}
`],
  ["no-outer-juxt", `class S {
    void t() {
        "/browse/town/$town"(controller: 'browser')
    }
}
`],
  ["plain-statement-gstring", `class S {
    void t() {
        def x = "/browse/town/$town"
    }
}
`],
  ["closure-wrapped", `class S {
    void t() {
        def f = {
            "/browse/town/$town"(controller: 'browser')
        }
    }
}
`],
  ["juxt-with-args", `class S {
    void t() {
        group "/home", {
            def y = "$town"
        }
    }
}
`],
]

async function main(): Promise<void> {
  const parser = await ASTEngine.getParser("groovy" as any)
  const analyzer = new RealGroovyAnalyzer()
  for (const [name, src] of CASES) {
    const root = parser.parse(src).rootNode!
    const res: any = await analyzer.analyze(root, src, "t.groovy")
    const interp = (res.relationships ?? []).filter((r: any) => r.metadata?.isInterpolationRead)
    // the tree path of the identifier, so the shape is on the record
    let chain = "(no interpolated_identifier node)"
    const stack: any[] = [root]
    while (stack.length > 0) {
      const n = stack.pop()!
      if (n.type === "interpolated_identifier") {
        const parts: string[] = []
        let p: any = n
        while (p && parts.length < 6) { parts.push(p.type); p = p.parent }
        chain = parts.join(" <- ")
        break
      }
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) stack.push(c) }
    }
    console.log(`\n=== ${name} ===`)
    console.log(`  tree : ${chain}`)
    console.log(`  interp reads: ${interp.length ? interp.map((r: any) => `${r.source}->${r.target}@${r.line_number}`).join(" | ") : "(none)"}`)
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
