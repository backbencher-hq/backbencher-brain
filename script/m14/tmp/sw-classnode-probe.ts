// script/m14/tmp/sw-classnode-probe.ts — the class at AsyncTestingChannel.swift:87
// (`public final class NIOAsyncTestingChannel: Channel {`) produces NO symbol, so every
// member's ownerName is undefined. Dump the node type and the name-resolution inputs.
// Run: bun script/m14/tmp/sw-classnode-probe.ts
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
const F = "<corpus-root>/bb_tests/repositories/swift-nio/Sources/NIOEmbedded/AsyncTestingChannel.swift"
const src = fs.readFileSync(F, "utf8")

const wts: any = await import("web-tree-sitter")
const P: any = wts.Parser ?? wts.default ?? wts
const L: any = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-swift.wasm")))
const pp = new P(); pp.setLanguage(LANG)
const root = pp.parse(src).rootNode
console.log(`root=${root.type} hasError=${root.hasError} children=${root.childCount}`)
for (let i = 0; i < root.childCount; i++) {
  const c = root.child(i)!
  console.log(`  [${i}] ${c.type}${c.isNamed ? "" : " (anon)"} ${JSON.stringify(c.text.slice(0, 60))}`)
}
// walk: report every class_declaration and what the analyzer's name lookup would find
const st: any[] = [root]
const decls: any[] = []
while (st.length > 0) {
  const n = st.pop()!
  if (n.type === "class_declaration") decls.push(n)
  for (let i = n.namedChildCount - 1; i >= 0; i--) { const c = n.namedChild(i); if (c) st.push(c) }
}
console.log(`\nclass_declaration nodes: ${decls.length}`)
for (const n of decls) {
  const line = (src.slice(0, n.startIndex).match(/\n/g) ?? []).length + 1
  const named = []
  for (let i = 0; i < n.namedChildCount; i++) named.push(n.namedChild(i)!.type)
  const anon: string[] = []
  for (let i = 0; i < n.childCount; i++) { const c = n.child(i)!; if (!c.isNamed) anon.push(c.type) }
  let ti: string | null = null
  for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i)!; if (c.type === "type_identifier") { ti = c.text; break } }
  console.log(`  L${line}: named=[${named.join(",")}] anon=[${anon.join(",")}] type_identifier=${JSON.stringify(ti)} first=${named[0] ?? "none"} | ${JSON.stringify(src.split("\n")[line - 1]?.trim().slice(0, 70))}`)
}
