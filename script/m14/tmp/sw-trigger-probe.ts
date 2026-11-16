// script/m14/tmp/sw-trigger-probe.ts — is `nonisolated(unsafe)` the trigger for the
// ERROR-wrapped class header in AsyncTestingChannel.swift?
// Run: bun script/m14/tmp/sw-trigger-probe.ts
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
const F = "<corpus-root>/bb_tests/repositories/swift-nio/Sources/NIOEmbedded/AsyncTestingChannel.swift"
const wts: any = await import("web-tree-sitter")
const P: any = wts.Parser ?? wts.default ?? wts
const L: any = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-swift.wasm")))

function probe(name: string, src: string) {
  const pp = new P(); pp.setLanguage(LANG)
  const root = pp.parse(src).rootNode
  const kinds: Record<string, number> = {}
  let errWrappedClass = false
  const st: any[] = [root]
  while (st.length > 0) {
    const n = st.pop()!
    kinds[n.type] = (kinds[n.type] ?? 0) + 1
    if (n.type === "ERROR" && n.child(0) && !n.child(0).isNamed && n.child(0).type === "class") errWrappedClass = true
    for (let i = n.namedChildCount - 1; i >= 0; i--) { const c = n.namedChild(i); if (c) st.push(c) }
  }
  console.log(`${name}: hasError=${root.hasError} class_declaration=${kinds["class_declaration"] ?? 0} ERROR=${kinds["ERROR"] ?? 0} errWrappedClass=${errWrappedClass}`)
}

const base = fs.readFileSync(F, "utf8")
probe("as-is", base)
probe("nonisolated(unsafe) -> nonisolated", base.replace(/nonisolated\(unsafe\)/g, "nonisolated"))
probe("nonisolated(unsafe) removed", base.replace(/nonisolated\(unsafe\) /g, ""))
probe("snippet with nonisolated(unsafe)", `final class C: P {\n  nonisolated(unsafe) var x: T!\n}\n`)
probe("snippet without", `final class C: P {\n  var x: T!\n}\n`)
probe("snippet bare nonisolated", `final class C: P {\n  nonisolated var x: T!\n}\n`)
