// W17: the exact final 4 MISSING + 2 unexplained targets on jq:c.
import * as WTS from "web-tree-sitter"
import * as fs from "fs"
import * as path from "path"
import { RealCAnalyzer } from "../../../src/ast/real-c-analyzer"
import { deriveCCalls } from "../differential"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
const JQ = "<corpus-root>/bb_tests/repositories/jq"

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
  const files = fs.readdirSync(JQ + "/src").filter(f => f.endsWith(".c")).sort()
  for (const f of files) {
    const rel = "src/" + f
    const { root, src } = await parseFile(JQ + "/" + rel)
    const out: any = new RealCAnalyzer().analyze(root, src, rel)
    const aT: Set<string> = new Set()
    for (const r of (out.relationships ?? [])) {
      if (r.type === "uses" || r.type === "references" || r.type === "calls") aT.add(String(r.target))
    }
    const edges = deriveCCalls(root)
    const tT = new Set(edges.map(e => e.target))
    const missing = [...new Set(edges.filter(e => !aT.has(e.target)).map(e => e.target))]
    const unexpl = [...aT].filter(t => !tT.has(t))
    if (missing.length || unexpl.length) {
      console.log(rel + " MISSING=[" + missing.join(", ") + "] UNEXPLAINED=[" + unexpl.join(", ") + "]")
      // dump source line for each
      const lines = src.split("\n")
      for (const nm of [...missing, ...unexpl]) {
        const idx = lines.findIndex(l => l.includes(nm))
        if (idx >= 0) console.log("   " + nm + " first@L" + (idx + 1) + ": " + lines[idx].trim().slice(0, 90))
      }
    }
  }
}
main()
