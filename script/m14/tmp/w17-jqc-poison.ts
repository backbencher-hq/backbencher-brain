// W17: find the minimal early prefix that (combined with the real tail)
// triggers the local-suppression leak. K lines from the top + real tail.
import * as fs from "fs"
import * as path from "path"
import * as WTS from "web-tree-sitter"
import { RealCAnalyzer } from "../../../src/ast/real-c-analyzer"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
const JQ = "<corpus-root>/bb_tests/repositories/jq"

async function main() {
  const P: any = (WTS as any).Parser ?? (WTS as any).default ?? WTS
  const L: any = (WTS as any).Language ?? (WTS as any).default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-c.wasm")))
  const p = new P(); p.setLanguage(LANG)

  const full = fs.readFileSync(path.join(JQ, "src/builtin.c"), "utf8")
  const lines = full.split("\n")
  const LEAK = new Set(["last_var", "is_empty_var", "init", "call_arg", "if_empty"])
  const tail = lines.slice(2059, 2100).join("\n")
  for (const K of [1955, 1965, 1975, 1985, 1992]) {
    const src = lines.slice(0, K).join("\n") + "\n" + tail
    const root = p.parse(src).rootNode
    const out: any = new RealCAnalyzer().analyze(root, src, "probe/bisectK.c")
    const leaks: string[] = []
    for (const r of (out.relationships ?? [])) {
      if (r.type === "uses" && LEAK.has(String(r.target))) leaks.push(String(r.target))
    }
    console.log("K=" + K + (root.hasError ? " [ERR]" : "") + " -> leaks: " + (leaks.join(", ") || "NONE"))
  }
}
main()
