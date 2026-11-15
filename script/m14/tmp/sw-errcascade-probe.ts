// script/m14/tmp/sw-errcascade-probe.ts — the class at AsyncTestingChannel.swift:87 parses
// as a property_declaration. Find the FIRST error node that starts the cascade.
// Run: bun script/m14/tmp/sw-errcascade-probe.ts
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const F = "/home/ishaq2321/bb_tests/repositories/swift-nio/Sources/NIOEmbedded/AsyncTestingChannel.swift"
const src = fs.readFileSync(F, "utf8")
const lines = src.split("\n")
const wts: any = await import("web-tree-sitter")
const P: any = wts.Parser ?? wts.default ?? wts
const L: any = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-swift.wasm")))
const pp = new P(); pp.setLanguage(LANG)
const root = pp.parse(src).rootNode
const lineOf = (i: number) => (src.slice(0, i).match(/\n/g) ?? []).length + 1

const errs: any[] = []
const st: any[] = [root]
while (st.length > 0) {
  const n = st.pop()!
  if (n.type === "ERROR" || n.isMissing) errs.push(n)
  for (let i = n.namedChildCount - 1; i >= 0; i--) { const c = n.namedChild(i); if (c) st.push(c) }
}
errs.sort((a, b) => a.startIndex - b.startIndex)
console.log(`error/missing nodes: ${errs.length}`)
for (const e of errs.slice(0, 12)) {
  console.log(`  L${lineOf(e.startIndex)}..L${lineOf(e.endIndex)} ${e.type}${e.isMissing ? " MISSING" : ""} text=${JSON.stringify(e.text.slice(0, 70))}`)
  console.log(`      |  ${JSON.stringify(lines[lineOf(e.startIndex) - 1]?.trim().slice(0, 90))}`)
}

// the ERROR node itself
{
  const e = errs.find((x) => x.type === "ERROR" && x.text.startsWith("class NIOAsyncTestingChannel"))!
  console.log(`\nERROR node children (childCount=${e.childCount}, namedChildCount=${e.namedChildCount}):`)
  for (let i = 0; i < Math.min(e.childCount, 30); i++) {
    const c = e.child(i)!
    console.log(`  child[${i}] ${c.type}${c.isNamed ? "" : " (anon)"}${c.isMissing ? " MISSING" : ""} ${JSON.stringify(c.text.slice(0, 50))}`)
  }
  console.log("  named children:")
  for (let i = 0; i < Math.min(e.namedChildCount, 30); i++) {
    const c = e.namedChild(i)!
    console.log(`    named[${i}] ${c.type} ${JSON.stringify(c.text.slice(0, 50))}`)
  }
}

// the property_declaration covering line 87
const byte = lines.slice(0, lines.findIndex((l) => l.startsWith("public final class NIOAsyncTestingChannel"))).join("\n").length + 1
let best: any = null
const st2: any[] = [root]
while (st2.length > 0) {
  const n = st2.pop()!
  if (n.type === "property_declaration" && n.startIndex <= byte && n.endIndex > byte) {
    if (!best || n.startIndex > best.startIndex) best = n
  }
  for (let i = n.namedChildCount - 1; i >= 0; i--) { const c = n.namedChild(i); if (c) st2.push(c) }
}
console.log(`\nproperty_declaration holding the class: L${lineOf(best.startIndex)}..L${lineOf(best.endIndex)}`)
for (let i = 0; i < best.namedChildCount; i++) {
  const c = best.namedChild(i)!
  console.log(`  named[${i}] ${c.type} ${JSON.stringify(c.text.slice(0, 60))}`)
}
for (let i = 0; i < best.childCount; i++) {
  const c = best.child(i)!
  console.log(`  child[${i}] ${c.type}${c.isNamed ? "" : " (anon)"} ${JSON.stringify(c.text.slice(0, 40))}`)
}
