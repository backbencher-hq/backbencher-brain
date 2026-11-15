// W17 jq:c bisect: does the leak persist when builtin.c is truncated?
// Full file vs L1..N prefixes. The leak class: uses of function-locals
// (last_var, rangevar, builtin_defs, i) the ruled contract suppresses.
import * as fs from "fs"
import * as path from "path"
import * as WTS from "web-tree-sitter"
import { RealCAnalyzer } from "../../../src/ast/real-c-analyzer"

const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const JQ = "/home/ishaq2321/bb_tests/repositories/jq"

async function main() {
  const P: any = (WTS as any).Parser ?? (WTS as any).default ?? WTS
  const L: any = (WTS as any).Language ?? (WTS as any).default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-c.wasm")))
  const p = new P(); p.setLanguage(LANG)

  const full = fs.readFileSync(path.join(JQ, "src/builtin.c"), "utf8")
  const lines = full.split("\n")
  const LEAK = new Set(["last_var", "is_empty_var", "rangevar", "rangestart", "builtin_defs", "builtin_def_1arg", "call_arg", "if_empty", "init"])
  const prefixes = [200, 600, 1200, 2000, 2065, 2100, lines.length]
  for (const n of prefixes) {
    const src = lines.slice(0, n).join("\n")
    const root = p.parse(src).rootNode
    const out: any = new RealCAnalyzer().analyze(root, src, "probe/builtin-prefix.c")
    const leaks: string[] = []
    for (const r of (out.relationships ?? [])) {
      if (r.type === "uses" && LEAK.has(String(r.target))) leaks.push(String(r.target) + "@" + (r.line ?? "?"))
    }
    console.log("prefix L1.." + n + (root.hasError ? " [ERR]" : "") + " -> leaks: " + (leaks.join(", ") || "NONE"))
  }
}
main()
