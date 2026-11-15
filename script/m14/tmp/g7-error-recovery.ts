// Hypothesis: a syntax error in the file silences the interpolation read (the
// corpus file is one giant ERROR node spanning lines 1-1370). Controlled test:
// the same interpolation in a clean file, then with an unrelated error added.
import { ASTEngine } from "../../../src/ast/engine"
import { RealGroovyAnalyzer } from "../../../src/ast/real-groovy-analyzer"

const CLEAN = `class S {
    void t() {
        "/browse/town/$town"(controller: 'browser')
    }
}
`

const ERR_BEFORE_CLASS = `def oops = [1, , 2]
class S {
    void t() {
        "/browse/town/$town"(controller: 'browser')
    }
}
`

const ERR_OTHER_METHOD = `class S {
    void broken() {
        def x = [1, , 2]
    }
    void t() {
        "/browse/town/$town"(controller: 'browser')
    }
}
`

const ERR_SIBLING_STATEMENT = `class S {
    void t() {
        def x = [1, , 2]
        "/browse/town/$town"(controller: 'browser')
    }
}
`

const CASES: Array<[string, string]> = [
  ["clean (control)", CLEAN],
  ["error before class", ERR_BEFORE_CLASS],
  ["error in another method", ERR_OTHER_METHOD],
  ["error in the same method body", ERR_SIBLING_STATEMENT],
]

async function main(): Promise<void> {
  const parser = await ASTEngine.getParser("groovy" as any)
  const analyzer = new RealGroovyAnalyzer()
  for (const [name, src] of CASES) {
    const root = parser.parse(src).rootNode!
    const res: any = await analyzer.analyze(root, src, "t.groovy")
    const interp = (res.relationships ?? []).filter((r: any) => r.metadata?.isInterpolationRead)
    // where does the error sit?
    const errs: string[] = []
    const st: any[] = [root]
    while (st.length > 0) {
      const n = st.pop()!
      if (n.type === "ERROR") errs.push(`ERROR@${n.startPosition.row + 1}-${n.endPosition.row + 1}`)
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) st.push(c) }
    }
    console.log(`${name.padEnd(30)} hasError=${String(root.hasError).padEnd(5)} errs=[${errs.join(", ")}] reads=${interp.length ? interp.map((r: any) => `${r.source}->${r.target}@${r.line_number}`).join(" | ") : "(none)"}`)
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
