// W17 v2: reproduce the actual jv_dtoa.c admission — the #ifdef mention
// dissolving into ERROR content while the preproc_def survives as a node.
import * as fs from "fs"
import * as path from "path"
import * as WTS from "web-tree-sitter"
import { RealCAnalyzer } from "../../../src/ast/real-c-analyzer"
import { deriveCCalls } from "../differential"

const ROOT = "<corpus-root>/mcp/backbencher-brain"

async function main() {
  const P: any = (WTS as any).Parser ?? (WTS as any).default ?? WTS
  const L: any = (WTS as any).Language ?? (WTS as any).default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-c.wasm")))
  const p = new P(); p.setLanguage(LANG)

  // Shape C: valueless define + use inside an if-condition that also breaks
  // (mimics "#ifndef NO_HEX_FP" glued after an unterminated initializer)
  const glue = [
    "#define NO_HEX_FP",
    "typedef struct { int (*fn)(void); } CFUNC;",
    "static const CFUNC function_list[] = {",
    "  {0},",
    "#ifdef NO_HEX_FP",
    "int f(int x) {",
    "  if (x > 0)",
    "    return 1;",
    "  return 0;",
    "}",
  ].join("\n") + "\n"

  const root = p.parse(glue).rootNode
  // show the raw parse shape around NO_HEX_FP mentions
  const stack: any[] = [root]
  while (stack.length) {
    const n = stack.pop()!
    if (n.type === "identifier" && n.text === "NO_HEX_FP") {
      const line = glue.slice(0, n.startIndex).split("\n").length
      const chain: string[] = []
      let cur: any = n.parent
      while (cur && chain.length < 5) { chain.push(cur.type); cur = cur.parent }
      console.log("L" + line + " < " + chain.join(" < "))
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) stack.push(c) }
  }
  const out: any = new RealCAnalyzer().analyze(root, glue, "probe/C.c")
  const aEdges = (out.relationships ?? []).filter((r: any) => r.target === "NO_HEX_FP").map((r: any) => r.type)
  const truth = deriveCCalls(root).filter(e => e.target === "NO_HEX_FP").map(e => e.label)
  console.log("analyzer=" + JSON.stringify(aEdges) + " oracle=" + JSON.stringify(truth))
}
main()
