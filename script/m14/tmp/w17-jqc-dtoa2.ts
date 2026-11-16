// W17: decisive ruling data for the 4 jv_dtoa.c MISSING targets.
// (a) does the analyzer have symbols/edges for them?
// (b) what does the raw source look like at the oracle's admission points?
import * as fs from "fs"
import * as path from "path"
import * as WTS from "web-tree-sitter"
import { RealCAnalyzer } from "../../../src/ast/real-c-analyzer"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
const JQ = "<corpus-root>/bb_tests/repositories/jq"
const NAMES = ["ROUND_BIASED", "Sudden_Underflow", "NO_HEX_FP", "emin"]

async function main() {
  const P: any = (WTS as any).Parser ?? (WTS as any).default ?? WTS
  const L: any = (WTS as any).Language ?? (WTS as any).default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-c.wasm")))
  const p = new P(); p.setLanguage(LANG)
  const abs = path.join(JQ, "src/jv_dtoa.c")
  const src = fs.readFileSync(abs, "utf8")
  const root = p.parse(src).rootNode
  const out: any = new RealCAnalyzer().analyze(root, src, "src/jv_dtoa.c")

  console.log("=== analyzer symbols for the 4 names ===")
  for (const s of (out.symbols ?? [])) {
    if (NAMES.includes(s.name)) console.log(s.kind + " " + s.name + " @" + (s.line ?? s.startLine ?? "?"))
  }
  console.log("=== analyzer edges for the 4 names ===")
  let any = false
  for (const r of (out.relationships ?? [])) {
    if (NAMES.includes(String(r.target))) { console.log(r.type + " <- " + (r.from ?? r.source)); any = true }
  }
  if (!any) console.log("(none)")

  console.log("=== raw source at admission points ===")
  const lines = src.split("\n")
  const show = (n: number, ctx = 2): void => {
    console.log("--- L" + n + " ---")
    for (let i = Math.max(0, n - 1 - ctx); i < Math.min(lines.length, n + ctx); i++) {
      console.log((i + 1) + (i + 1 === n ? " >" : "  ") + " " + lines[i].slice(0, 110))
    }
  }
  show(1555); show(4122); show(3948); show(1858); show(3591)
}
main()
