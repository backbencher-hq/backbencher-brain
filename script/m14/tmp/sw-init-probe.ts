// script/m14/tmp/sw-init-probe.ts — attribute `instantiates constructor -> constructor`
// (AsyncTestingChannel.swift, full-extent swift depth finding): which site emits it,
// and what the symbol table thinks the enclosing owner of each init is.
// Run: bun script/m14/tmp/sw-init-probe.ts
import * as fs from "node:fs"
import { ASTEngine } from "../../../src/ast/engine"

const F = "/home/ishaq2321/bb_tests/repositories/swift-nio/Sources/NIOEmbedded/AsyncTestingChannel.swift"
const src = fs.readFileSync(F, "utf8")
const parsed: any = await (ASTEngine as any).parseFile(F, src, { language: "swift" })

console.log("--- symbols: name | kind | ownerName | parentId | line ---")
for (const s of parsed.symbols ?? []) {
  console.log(`  ${s.name} | ${s.kind} | owner=${s.ownerName} | parentId=${s.parentId} | line=${s.range?.startLine}`)
}

console.log("\n--- instantiates/uses edges with source or target 'constructor' ---")
for (const r of parsed.relationships ?? []) {
  const t = String(r.type).toLowerCase()
  if (String(r.source) === "constructor" || String(r.target) === "constructor") {
    console.log(`  L${r.line_number ?? r.metadata?.line ?? 0} ${t} ${r.source} -> ${r.target} conf=${r.confidence} meta=${JSON.stringify(r.metadata)}`)
  }
}
