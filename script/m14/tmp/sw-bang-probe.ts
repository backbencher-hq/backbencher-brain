// script/m14/tmp/sw-bang-probe.ts — synthetic battery for the two remaining shapes:
//   (a) `$0.alpha!.beta += 1`  (the $0 force-unwrap read the analyzer emits and the
//       oracle does not)
//   (b) `case .websocket(let x):` (the grammar recovers a switch pattern into a
//       call_expression whose callee is the KEYWORD `case`)
// Run: bun script/m14/tmp/sw-bang-probe.ts
import * as fs from "node:fs"
import * as path from "node:path"
import { RealSwiftAnalyzer } from "../../../src/ast/real-swift-analyzer"

const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const wts: any = await import("web-tree-sitter")
const P: any = wts.Parser ?? wts.default ?? wts
const L: any = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-swift.wasm")))
const mod: any = await import("../../../script/m14/differential")

function shape(n: any, depth = 0, maxDepth = 10): string {
  const pad = "  ".repeat(depth)
  const head = `${pad}${n.type}${n.isNamed ? "" : " (anon)"}${n.childCount === 0 ? ` ${JSON.stringify(n.text.slice(0, 32))}` : ""}`
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

const CASES: Array<[string, string]> = [
  ["LHS-bang (corpus shape)", `final class T {\n  func f() {\n    g { $0.alpha!.beta += 1 }\n  }\n}\n`],
  ["LHS-bang no double (corpus shape, single suffix)", `final class T {\n  func f() {\n    g { $0.alpha! += 1 }\n  }\n}\n`],
  ["read position", `final class T {\n  func f() {\n    g { print($0.alpha!) }\n  }\n}\n`],
  ["read position, no bang", `final class T {\n  func f() {\n    g { print($0.alpha) }\n  }\n}\n`],
  ["LHS no bang (nested nav)", `final class T {\n  func f() {\n    g { $0.alpha.beta += 1 }\n  }\n}\n`],
  ["LHS-bang, plain receiver", `final class T {\n  func f() {\n    g { x.alpha!.beta += 1 }\n  }\n}\n`],
  ["read position nested bang", `final class T {\n  func f() {\n    g { print($0.alpha!.beta) }\n  }\n}\n`],
  ["read position nested bang, plain receiver", `final class T {\n  func f() {\n    g { print(x.alpha!.beta) }\n  }\n}\n`],
  ["LHS bang assign", `final class T {\n  func f() {\n    g { $0.alpha! = 1 }\n  }\n}\n`],
  ["case pattern with binding", `enum E { case websocket(Int)\n  case notUpgraded }\nfinal class T {\n  func f(_ v: E) async throws {\n    switch v {\n    case .websocket(let x):\n      print(x)\n    case .notUpgraded:\n      return\n    }\n  }\n}\n`],
]

for (const [name, code] of CASES) {
  const pp = new P(); pp.setLanguage(LANG)
  const root = pp.parse(code).rootNode
  const r: any = await new RealSwiftAnalyzer().analyze(root, code, "t.swift", { typeKinds: new Map() } as any)
  const analyzerRels = (r.relationships ?? []).map((x: any) => ({ label: String(x.type).toLowerCase(), from: String(x.source), target: String(x.target), conf: x.confidence }))
    .filter((x: any) => ["calls", "uses", "instantiates"].includes(x.label))
  const truth = mod.deriveSwiftEdges(root, new Set<string>())
  for (const e of mod.deriveSwiftBareUses(root, r.symbols ?? [])) truth.push(e)
  console.log(`\n===== ${name} (hasError=${root.hasError}) =====`)
  console.log(`  analyzer: ${analyzerRels.map((x: any) => `${x.label} ${x.from}->${x.target}@${x.conf}`).join(" | ") || "(none)"}`)
  console.log(`  oracle  : ${truth.map((x: any) => `${x.label} ${x.target}`).join(" | ") || "(none)"}`)
  // shape of the interesting node
  const marks = ["postfix_expression", "bang"]
  for (const m of marks) {
    const hits: any[] = []
    const st: any[] = [root]
    while (st.length > 0) {
      const n = st.pop()!
      if (m === "bang" ? n.type === "bang" : n.type === "postfix_expression") hits.push(n)
      for (let i = n.namedChildCount - 1; i >= 0; i--) { const c = n.namedChild(i); if (c) st.push(c) }
    }
    if (hits.length) for (const h of hits.slice(0, 2)) console.log(`  [${m}]\n${shape(h, 2, 8)}`)
  }
  if (/case pattern/.test(name)) {
    const st: any[] = [root]
    while (st.length > 0) {
      const n = st.pop()!
      if (n.type === "call_expression") { console.log(`  [call_expression parent=${n.parent?.type} grandparent=${n.parent?.parent?.type}]\n${shape(n, 2, 8)}`) }
      for (let i = n.namedChildCount - 1; i >= 0; i--) { const c = n.namedChild(i); if (c) st.push(c) }
    }
  }
}
