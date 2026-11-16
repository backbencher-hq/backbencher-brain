// W17: classify the 22 unexplained edges after CGD39. For each file, find
// analyzer use/references targets with no truth target, then dump every
// mention chain of those names to see which mentions survive.
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
    const truth = new Set(deriveCCalls(root).map(e => e.target))
    const only = [...aT].filter(t => !truth.has(t))
    if (!only.length) continue
    console.log("== " + rel + " :: " + only.join(", "))
    // mention chains for the first few names
    const want = new Set(only.slice(0, 6))
    const stack: any[] = [root]
    while (stack.length) {
      const n = stack.pop()!
      if (n.type === "identifier" && want.has(n.text)) {
        const line = src.slice(0, n.startIndex).split("\n").length
        const chain: string[] = []
        let cur: any = n.parent
        while (cur && chain.length < 4) { chain.push(cur.type); cur = cur.parent }
        console.log("   " + n.text + " L" + line + " < " + chain.join(" < "))
      }
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) stack.push(c) }
    }
  }
}
main()
