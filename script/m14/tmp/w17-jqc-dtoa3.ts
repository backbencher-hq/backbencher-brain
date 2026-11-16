// W17: which oracle branch admits the 4 jv_dtoa.c names? Dump raw edges.
import * as fs from "fs"
import * as path from "path"
import * as WTS from "web-tree-sitter"
import { deriveCCalls } from "../differential"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
const JQ = "<corpus-root>/bb_tests/repositories/jq"
const NAMES = new Set(["ROUND_BIASED", "Sudden_Underflow", "NO_HEX_FP", "emin"])

async function main() {
  const P: any = (WTS as any).Parser ?? (WTS as any).default ?? WTS
  const L: any = (WTS as any).Language ?? (WTS as any).default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-c.wasm")))
  const p = new P(); p.setLanguage(LANG)
  const abs = path.join(JQ, "src/jv_dtoa.c")
  const src = fs.readFileSync(abs, "utf8")
  const root = p.parse(src).rootNode
  const edges = deriveCCalls(root)
  for (const e of edges) {
    if (NAMES.has(e.target)) console.log(JSON.stringify(e))
  }
}
main()
