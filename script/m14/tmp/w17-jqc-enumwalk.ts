// W17: analyzer's actual view of jv_dtoa.c enums. Dump all EnumMember
// symbols and all enum_specifier nodes with their enclosing-scope state.
import * as fs from "fs"
import * as path from "path"
import * as WTS from "web-tree-sitter"
import { RealCAnalyzer } from "../../../src/ast/real-c-analyzer"

const ROOT = "/home/ishaq2321/mcp/backbencher-brain"

async function main() {
  const P: any = (WTS as any).Parser ?? (WTS as any).default ?? WTS
  const L: any = (WTS as any).Language ?? (WTS as any).default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-c.wasm")))
  const p = new P(); p.setLanguage(LANG)
  const src = fs.readFileSync("/home/ishaq2321/bb_tests/repositories/jq/src/jv_dtoa.c", "utf8")
  const root = p.parse(src).rootNode

  // structural: all enum_specifier nodes with file-level vs nested position
  const stack: any[] = [root]
  const enums: any[] = []
  while (stack.length) {
    const n = stack.pop()!
    if (n.type === "enum_specifier") {
      const line = src.slice(0, n.startIndex).split("\n").length
      const chain: string[] = []
      let cur: any = n.parent
      while (cur && chain.length < 4) { chain.push(cur.type); cur = cur.parent }
      enums.push("L" + line + " < " + chain.join(" < "))
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) stack.push(c) }
  }
  console.log("=== all enum_specifier nodes ===")
  for (const e of enums) console.log("  " + e)

  const out: any = new RealCAnalyzer().analyze(root, src, "src/jv_dtoa.c")
  const members = (out.symbols ?? []).filter((s: any) => String(s.kind) === "5" || (s.metadata as any)?.isEnumValue || (s.kind ?? "").toString().toLowerCase().includes("enum"))
  console.log("=== EnumMember symbols (first 30) ===")
  for (const m of members.slice(0, 30)) console.log("  " + m.name + " kind=" + m.kind)
  console.log("total enum-ish: " + members.length)
  const names = new Set((out.symbols ?? []).map((s: any) => s.name))
  for (const n2 of ["emin", "emax", "ROUND_BIASED", "Sudden_Underflow", "NO_HEX_FP"]) console.log(n2 + " is a symbol: " + names.has(n2))
}
main()
