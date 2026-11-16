// script/m14/tmp/sw-recoverykind-probe.ts — what kind does handleDeclaration's
// DEEP anonymous-token search derive for an ERROR-recovered nominal, and what
// does a HEADER-ONLY search derive? (The deep search can see a nested
// declaration's keyword token.)
// Run: bun script/m14/tmp/sw-recoverykind-probe.ts
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
const FILES = [
  "<corpus-root>/bb_tests/repositories/swift-nio/Sources/NIOEmbedded/AsyncTestingChannel.swift",
  "<corpus-root>/mcp/backbencher-brain/validation/m14/fixtures/swift/error-recovery-nominal.swift",
]
const wts: any = await import("web-tree-sitter")
const P: any = wts.Parser ?? wts.default ?? wts
const L: any = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-swift.wasm")))
const KW = ["class", "struct", "enum", "extension", "actor"]

function deepHas(n: any, kw: string): boolean {
  const st: any[] = [n]
  while (st.length > 0) {
    const c = st.pop()!
    if (c.type === kw && !c.isNamed) return true
    for (let i = c.childCount - 1; i >= 0; i--) { const ch = c.child(i); if (ch) st.push(ch) }
  }
  return false
}
for (const F of FILES) {
  const src = fs.readFileSync(F, "utf8")
  const pp = new P(); pp.setLanguage(LANG)
  const root = pp.parse(src).rootNode
  const lineOf = (i: number) => (src.slice(0, i).match(/\n/g) ?? []).length + 1
  const st: any[] = [root]
  while (st.length > 0) {
    const n = st.pop()!
    if (n.type === "ERROR") {
      const anonFirst = n.child(0) && !n.child(0).isNamed ? n.child(0).type : "(named)"
      console.log(`\n${path.basename(F)}: ERROR L${lineOf(n.startIndex)}..L${lineOf(n.endIndex)} first=${anonFirst}`)
      // header-only scan: walk children until a declaration-ish named node
      let headerKw: string | null = null
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i)!
        if (!c.isNamed && KW.includes(c.type)) { headerKw = c.type; break }
        if (c.isNamed && (c.type === "modifiers" || c.type === "attribute" || c.type === "comment")) continue
        if (c.isNamed) break
      }
      console.log(`  header-only keyword: ${headerKw}  | deep: ${KW.filter((k) => deepHas(n, k)).join(",")}`)
      const named: string[] = []
      for (let i = 0; i < n.namedChildCount; i++) named.push(n.namedChild(i)!.type)
      console.log(`  children: ${n.childCount} named: ${n.namedChildCount} -> [${named.slice(0, 10).join(",")}]`)
      // name candidates
      const nameCand: string[] = []
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)!
        if (c.type === "type_identifier" || c.type === "simple_identifier" || c.type === "identifier" || c.type === "user_type") nameCand.push(`${c.type}:${c.text.slice(0, 24)}`)
      }
      console.log(`  name candidates (all named w/ identifier types): [${nameCand.slice(0, 6).join(", ")}]`)
    }
    for (let i = n.namedChildCount - 1; i >= 0; i--) { const c = n.namedChild(i); if (c) st.push(c) }
  }
}
