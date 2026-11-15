// script/m14/tmp/sw-attr-case-probe.ts — the #924 swift half: an enum CASE with a
// preceding `@available(...)` attribute publishes a `contains` target whose text
// is the attribute payload (`HTTPTypes.swift`, 5 cases desugared into 1 deduped
// target).
//
// Run: bun script/m14/tmp/sw-attr-case-probe.ts
import * as fs from "node:fs"
import * as path from "node:path"
import { RealSwiftAnalyzer } from "../../../src/ast/real-swift-analyzer"

const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const F = "/home/ishaq2321/bb_tests/repositories/swift-nio/Sources/NIOHTTP1/HTTPTypes.swift"
const wts: any = await import("web-tree-sitter")
const P: any = wts.Parser ?? wts.default ?? wts
const L: any = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-swift.wasm")))

const src = fs.readFileSync(F, "utf8")
const pp = new P(); pp.setLanguage(LANG)
const root = pp.parse(src).rootNode

// Shape dump: the enum body around line 824.
const stack: any[] = [root]
let dumped = 0
while (stack.length > 0 && dumped < 12) {
  const n = stack.pop()!
  if (n.type === "enum_entry" || n.type === "enum_class_case" || n.type === "enum_case" || n.type === "ERROR" || n.type === "modifiers") {
    if (n.startPosition.row + 1 >= 820 && n.startPosition.row + 1 <= 832 && dumped < 12) {
      dumped++
      console.log(`node ${n.type} L${n.startPosition.row + 1}-${n.endPosition.row + 1} fields=${JSON.stringify(n.children.map((c: any) => `${c.type}${c.isNamed ? "" : "!"}:${JSON.stringify(c.text.slice(0, 40))}`))}`)
    }
  }
  for (let i = n.namedChildCount - 1; i >= 0; i--) stack.push(n.namedChild(i))
}

const r: any = await new RealSwiftAnalyzer().analyze(root, src, "HTTPTypes.swift", { typeKinds: new Map() } as any)
console.log("-- symbols whose name contains '@' or ':' --")
for (const s of r.symbols ?? []) {
  if (/[@,():]/.test(String(s.name))) console.log(`  ${s.name} | ${s.kind} | owner=${s.ownerName} | line=${s.range?.startLine}`)
}
console.log("-- relationship targets containing '@' --")
for (const e of r.relationships ?? []) {
  if (String(e.target).includes("@")) console.log(`  ${e.type} ${e.source} -> ${JSON.stringify(e.target)} L${e.line_number}`)
}
console.log("-- the 5 attributed cases as symbols --")
for (const name of ["invalidHost", "invalidPort", "invalidPath", "invalidQueryString", "invalidFragment"]) {
  const hit = (r.symbols ?? []).find((s: any) => s.name === name)
  console.log(`  ${name}: ${hit ? `${hit.kind} owner=${hit.ownerName} line=${hit.range?.startLine}` : "ABSENT"}`)
}
