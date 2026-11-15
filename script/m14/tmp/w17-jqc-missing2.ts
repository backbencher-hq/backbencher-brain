// W17: find the lane's exact 5 MISSING edges — all 45 jq c files, oracle
// truth targets vs analyzer targets (uses/references/calls union).
import * as WTS from "web-tree-sitter"
import * as fs from "fs"
import * as path from "path"
import { RealCAnalyzer } from "../../../src/ast/real-c-analyzer"
import { deriveCCalls } from "../differential"

const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const JQ = "/home/ishaq2321/bb_tests/repositories/jq"

async function parseFile(abs: string) {
  const P: any = (WTS as any).Parser ?? (WTS as any).default ?? WTS
  const L: any = (WTS as any).Language ?? (WTS as any).default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-c.wasm")))
  const p = new P(); p.setLanguage(LANG)
  const src = fs.readFileSync(abs, "utf8")
  return { root: p.parse(src).rootNode, src }
}

async function main() {
  const srcDir = JQ + "/src"
  const files = fs.readdirSync(srcDir).filter(f => f.endsWith(".c")).sort()
  let total = 0
  for (const f of files) {
    const rel = "src/" + f
    const { root, src } = await parseFile(path.join(srcDir, f))
    const out: any = new RealCAnalyzer().analyze(root, src, rel)
    const aT: Set<string> = new Set()
    for (const r of (out.relationships ?? [])) {
      if (r.type === "uses" || r.type === "references" || r.type === "calls") aT.add(String(r.target))
    }
    const truth = deriveCCalls(root)
    const missing = [...new Set(truth.filter(e => !aT.has(e.target)).map(e => e.target))]
    total += missing.length
    if (missing.length) console.log(rel + ": " + missing.join(", "))
  }
  console.log("TOTAL missing-targets: " + total)
}
main()
