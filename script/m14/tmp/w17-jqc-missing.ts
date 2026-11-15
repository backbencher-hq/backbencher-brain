// W17: classify the 5 MISSING truth edges on jq:c — oracle derives uses-truth
// the analyzer does not emit. Per-file diff of oracle truth targets vs
// analyzer uses/references targets.
import * as WTS from "web-tree-sitter"
import * as fs from "fs"
import * as path from "path"
import { RealCAnalyzer } from "../../../src/ast/real-c-analyzer"
import { deriveCCalls } from "../differential"

const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const JQ = "/home/ishaq2321/bb_tests/repositories/jq"
const FILES = [
  "src/lexer.c", "src/parser.c", "src/jv.c", "src/main.c", "src/execute.c",
  "src/builtin.c", "src/jq_test.c", "src/linker.c", "src/srcversion.c",
]
const PRESENT = (rel: string): boolean => fs.existsSync(JQ + "/" + rel)

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
  for (const rel of FILES.filter(PRESENT)) {
    const { root, src } = await parseFile(path.join(JQ, rel))
    const out: any = new RealCAnalyzer().analyze(root, src, rel)
    const aT: Set<string> = new Set()
    for (const r of (out.relationships ?? [])) {
      // mirror the lane: truth edges match ANY analyzer relationship target
      if (r.type === "uses" || r.type === "references" || r.type === "calls") aT.add(String(r.target))
    }
    const truth = deriveCCalls(root)
    const missing: string[] = []
    for (const e of truth) {
      if (!aT.has(e.target)) missing.push(e.target)
    }
    if (missing.length) console.log(rel + " MISSING: " + [...new Set(missing)].join(", "))
  }
}
main()
