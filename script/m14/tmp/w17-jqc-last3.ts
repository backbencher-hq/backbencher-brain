// W17: exact sides for the final residuals.
// (a) jv_dtoa: which oracle mention still admits ROUND_BIASED (chain)?
// (b) jv_dtoa: the analyzer edge with target "0" (full JSON + node).
// (c) parser.c: analyzer edge for YY_INITIAL_VALUE + oracle's absence reason
//     (dump decl node shape of `# define YY_INITIAL_VALUE(Value) Value`).
import * as fs from "fs"
import * as path from "path"
import * as WTS from "web-tree-sitter"
import { RealCAnalyzer } from "../../../src/ast/real-c-analyzer"
import { deriveCCalls } from "../differential"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
const JQ = "<corpus-root>/bb_tests/repositories/jq"

async function parse(abs: string) {
  const P: any = (WTS as any).Parser ?? (WTS as any).default ?? WTS
  const L: any = (WTS as any).Language ?? (WTS as any).default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-c.wasm")))
  const p = new P(); p.setLanguage(LANG)
  const src = fs.readFileSync(abs, "utf8")
  return { p, root: p.parse(src).rootNode, src }
}
const chainOf = (n: any, d = 5): string => {
  const chain: string[] = []
  let cur: any = n
  while (cur && chain.length < d) { chain.push(cur.type + (cur.type === "ERROR" ? "@" + cur.startIndex : "")); cur = cur.parent }
  return chain.join(" < ")
}

async function main() {
  // (a) oracle edges for ROUND_BIASED still exist? which label?
  {
    const { root } = await parse(JQ + "/src/jv_dtoa.c")
    const es = deriveCCalls(root).filter(e => e.target === "ROUND_BIASED")
    console.log("(a) oracle ROUND_BIASED edges: " + JSON.stringify(es))
  }
  // (b) analyzer edge to "0"
  {
    const { p, root, src } = await parse(JQ + "/src/jv_dtoa.c")
    const out: any = new RealCAnalyzer().analyze(root, src, "src/jv_dtoa.c")
    const z = (out.relationships ?? []).filter((r: any) => String(r.target) === "0")
    console.log("(b) analyzer edges to '0': " + JSON.stringify(z))
    // find identifier nodes with text exactly "0"
    const stack: any[] = [root]
    while (stack.length) {
      const n = stack.pop()!
      if (n.type === "identifier" && n.text === "0") {
        const line = src.slice(0, n.startIndex).split("\n").length
        console.log("    ident '0' L" + line + " < " + chainOf(n, 4))
      }
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) stack.push(c) }
    }
  }
  // (c) YY_INITIAL_VALUE
  {
    const { p, root, src } = await parse(JQ + "/src/parser.c")
    const out: any = new RealCAnalyzer().analyze(root, src, "src/parser.c")
    const ae = (out.relationships ?? []).filter((r: any) => r.target === "YY_INITIAL_VALUE")
    const oe = deriveCCalls(root).filter(e => e.target === "YY_INITIAL_VALUE")
    console.log("(c) analyzer YY_INITIAL_VALUE: " + JSON.stringify(ae.map((r: any) => r.type + "/" + (r.metadata?.nodeType ?? ""))))
    console.log("    oracle YY_INITIAL_VALUE: " + JSON.stringify(oe))
    // decl node shape
    const stack: any[] = [root]
    while (stack.length) {
      const n = stack.pop()!
      if (n.type === "preproc_function_def" && n.text.includes("YY_INITIAL_VALUE")) {
        console.log("    decl L" + src.slice(0, n.startIndex).split("\n").length + " text=" + JSON.stringify(n.text.slice(0, 60)))
        const kids: string[] = []
        for (let i = 0; i < n.namedChildCount; i++) kids.push(n.namedChild(i)?.type + ":" + (n.namedChild(i)?.text ?? "").slice(0, 20))
        console.log("    children: " + kids.join(" | "))
        break
      }
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) stack.push(c) }
    }
  }
}
main()
