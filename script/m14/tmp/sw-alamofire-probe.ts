// script/m14/tmp/sw-alamofire-probe.ts — the full-extent second-corpus finding:
// `MISSING Tests/TestHelpers.swift :: calls -> method`. Which node derives it?
// Run: bun script/m14/tmp/sw-alamofire-probe.ts
import * as fs from "node:fs"
import * as path from "node:path"
import { RealSwiftAnalyzer } from "../../../src/ast/real-swift-analyzer"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
const F = "<corpus-root>/bb_tests/repositories/alamofire/Tests/TestHelpers.swift"
const src = fs.readFileSync(F, "utf8")
const lines = src.split("\n")
const wts: any = await import("web-tree-sitter")
const P: any = wts.Parser ?? wts.default ?? wts
const L: any = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-swift.wasm")))
const pp = new P(); pp.setLanguage(LANG)
const root = pp.parse(src).rootNode
const mod: any = await import("../../../script/m14/differential")

function shape(n: any, depth = 0, maxDepth = 9): string {
  const pad = "  ".repeat(depth)
  const head = `${pad}${n.type}${n.isNamed ? "" : " (anon)"}${n.childCount === 0 ? ` ${JSON.stringify(n.text.slice(0, 40))}` : ""}`
  if (depth >= maxDepth) return head + " …"
  const kids: string[] = []
  for (let i = 0; i < n.childCount; i++) {
    const c = n.child(i)
    if (!c) continue
    if (!c.isNamed && c.text.trim() === "") continue
    kids.push(shape(c, depth + 1, maxDepth))
  }
  return [head, ...kids].join("\n")
}

const truth = mod.deriveSwiftEdges(root, new Set<string>())
console.log("oracle edges with target 'method':", JSON.stringify(truth.filter((e: any) => e.target === "method")))

const r: any = await new RealSwiftAnalyzer().analyze(root, src, "Tests/TestHelpers.swift", { typeKinds: new Map() } as any)
const rels = (r.relationships ?? []).map((x: any) => ({ label: String(x.type).toLowerCase(), from: String(x.source), target: String(x.target), conf: x.confidence }))
console.log("analyzer edges with target 'method':", JSON.stringify(rels.filter((x: any) => x.target === "method")))

console.log("\ncall_expression nodes whose text contains 'method':")
const st: any[] = [root]
while (st.length > 0) {
  const n = st.pop()!
  if (n.type === "call_expression" && /method/.test(n.text)) {
    const line = (src.slice(0, n.startIndex).match(/\n/g) ?? []).length + 1
    console.log(`  [line ${line}] ${JSON.stringify(lines[line - 1]?.trim().slice(0, 80))} parent=${n.parent?.type} grandparent=${n.parent?.parent?.type}`)
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)!
      const head = c.type === "navigation_expression" && c.namedChildCount > 0 ? c.namedChild(0)! : null
      console.log(`     named[${i}] ${c.type} head=${head ? `${head.type}:${head.text}` : "-"} text=${JSON.stringify(c.text.slice(0, 40))}`)
    }
    if (n.parent?.type === "enum_entry" || n.parent?.type === "statements") console.log(shape(n, 3, 7))
  }
  for (let i = n.namedChildCount - 1; i >= 0; i--) { const c = n.namedChild(i); if (c) st.push(c) }
}

console.log("\n--- analyzer CALLS edges (all) ---")
for (const x of rels) if (x.label === "calls") console.log(`  ${x.from} -> ${x.target} @${x.conf}`)
console.log(`total analyzer calls: ${rels.filter((x: any) => x.label === "calls").length}`)
