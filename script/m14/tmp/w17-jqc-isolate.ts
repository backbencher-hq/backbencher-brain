// W17: isolate the trigger. V1 = real lines 2060-2126 alone (block unknown).
// V2 = same + `typedef int block;` preamble. V3 = prefix-2100 file.
// Decides whether the leak needs earlier file state or is local.
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
  const tail = lines.slice(2059, 2126).join("\n")

  const CFUNC = "#define CFUNC(func, name, arity) \\\n  {.fptr = { .a ## arity = func }, name, arity}\n"
  const cases: Record<string, string> = {
    V1_tail_alone: tail,
    V4_cfunc_then_tail: CFUNC + tail,
  }
  for (const [name, src] of Object.entries(cases)) {
    const root = p.parse(src).rootNode
    const out: any = new RealCAnalyzer().analyze(root, src, "probe/" + name + ".c")
    const leaks: string[] = []
    for (const r of (out.relationships ?? [])) {
      if (r.type === "uses" && LEAK.has(String(r.target))) leaks.push(String(r.target))
    }
    console.log(name + (root.hasError ? " [ERR]" : "") + " -> leaks: " + (leaks.join(", ") || "NONE"))
  }
}
main()
