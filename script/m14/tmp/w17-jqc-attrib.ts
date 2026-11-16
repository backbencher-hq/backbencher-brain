// W17: dump the leaked edges with FULL attribution (from + target + label)
// on the prefix-2100 file, plus the enclosing-function probe: what function
// does each leaked line actually sit in vs what the analyzer attributed?
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
  const src = lines.slice(0, 2100).join("\n")
  const root = p.parse(src).rootNode
  const out: any = new RealCAnalyzer().analyze(root, src, "probe/p2100.c")
  const LEAK = new Set(["last_var", "is_empty_var", "init", "call_arg", "if_empty", "builtin_defs", "builtin_def_1arg", "rangevar", "rangestart", "range"])
  console.log("=== leaked edges (full attribution) ===")
  for (const r of (out.relationships ?? [])) {
    if (r.type === "uses" && LEAK.has(String(r.target))) {
      console.log(JSON.stringify(r))
    }
  }
  // symbols: do any leaked names exist as symbols (resolvable)?
  const names = new Set((out.symbols ?? []).map((s: any) => s.name))
  console.log("=== leaked names that ARE symbols ===")
  for (const n of [...LEAK]) if (names.has(n)) console.log(n)
}
main()
