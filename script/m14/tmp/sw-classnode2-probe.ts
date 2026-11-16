// script/m14/tmp/sw-classnode2-probe.ts — what IS the node at AsyncTestingChannel.swift:87?
// Run: bun script/m14/tmp/sw-classnode2-probe.ts
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
const F = process.argv[2] ?? "<corpus-root>/bb_tests/repositories/swift-nio/Sources/NIOEmbedded/AsyncTestingChannel.swift"
const src = fs.readFileSync(F, "utf8")
const wts: any = await import("web-tree-sitter")
const P: any = wts.Parser ?? wts.default ?? wts
const L: any = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-swift.wasm")))
const pp = new P(); pp.setLanguage(LANG)
const root = pp.parse(src).rootNode

const lines = src.split("\n")
const target = process.argv[3] ?? "public final class NIOAsyncTestingChannel"
const lineIdx = lines.findIndex((l) => l.startsWith(target))
const byte = lines.slice(0, lineIdx).join("\n").length + 1
console.log(`line ${lineIdx + 1} starts at byte ${byte}: ${JSON.stringify(lines[lineIdx])}`)

// deepest node whose span starts at/just before that byte
let best: any = null
const st: any[] = [root]
while (st.length > 0) {
  const n = st.pop()!
  if (n.startIndex <= byte && n.endIndex > byte) {
    if (!best || n.startIndex > best.startIndex) best = n
  }
  for (let i = n.namedChildCount - 1; i >= 0; i--) { const c = n.namedChild(i); if (c) st.push(c) }
}
console.log(`\ndeepest covering node: ${best.type} (${best.startIndex}..${best.endIndex}) first 40 chars=${JSON.stringify(best.text.slice(0, 40))}`)
console.log("ancestors:")
let cur = best
const chain: string[] = []
while (cur) { chain.push(`${cur.type}${cur.isError ? "!!ERROR" : ""}[${cur.namedChildCount}]`); cur = cur.parent }
console.log("  " + chain.join(" < "))
console.log("\nbest children:")
for (let i = 0; i < best.childCount; i++) {
  const c = best.child(i)!
  console.log(`  ${i} ${c.type}${c.isNamed ? "" : " (anon)"}${c.isMissing ? " MISSING" : ""} ${JSON.stringify(c.text.slice(0, 50))}`)
}
// how big is the ERROR region? print ERROR nodes covering line 87
console.log("\nERROR nodes containing line 87:")
const st2: any[] = [root]
while (st2.length > 0) {
  const n = st2.pop()!
  if ((n.type === "ERROR" || n.isMissing) && n.startIndex <= byte && n.endIndex > byte) {
    const l = (src.slice(0, n.startIndex).match(/\n/g) ?? []).length + 1
    const e = (src.slice(0, n.endIndex).match(/\n/g) ?? []).length + 1
    console.log(`  ${n.type} lines ${l}..${e} text=${JSON.stringify(n.text.slice(0, 120))}`)
  }
  for (let i = n.namedChildCount - 1; i >= 0; i--) { const c = n.namedChild(i); if (c) st2.push(c) }
}
