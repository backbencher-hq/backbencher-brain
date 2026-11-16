// script/m14/tmp/sw-shape2-probe.ts — remaining unknowns of the six full-extent findings.
// Run: bun script/m14/tmp/sw-shape2-probe.ts
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
const REPO = "<corpus-root>/bb_tests/repositories/swift-nio"
const wts: any = await import("web-tree-sitter")
const P: any = wts.Parser ?? wts.default ?? wts
const L: any = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-swift.wasm")))

function shape(n: any, depth = 0, maxDepth = 12): string {
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

function parse(src: string) {
  const pp = new P(); pp.setLanguage(LANG)
  return pp.parse(src).rootNode
}

// (1) the $0 member-read statement
{
  const f = `${REPO}/Tests/NIOFSTests/FileInfoTests.swift`
  const src = fs.readFileSync(f, "utf8")
  const root = parse(src)
  console.log("### (1) FileInfoTests.swift — every node whose text mentions the $0 read")
  const st: any[] = [root]
  while (st.length > 0) {
    const n = st.pop()!
    if (n.text.startsWith("assertNotEqualAfterMutation { $0.platformSpecificStatus!.st_dev") &&
        n.parent && !n.parent.text.startsWith("assertNotEqual")) {
      console.log(shape(n, 1, 14))
      break
    }
    for (let i = n.namedChildCount - 1; i >= 0; i--) { const c = n.namedChild(i); if (c) st.push(c) }
  }
}

// (2) call expressions mentioning websocket/notUpgraded
for (const rel of ["Sources/NIOWebSocketClient/Client.swift", "Sources/NIOWebSocketServer/Server.swift"]) {
  const src = fs.readFileSync(`${REPO}/${rel}`, "utf8")
  const lines = src.split("\n")
  const root = parse(src)
  console.log(`\n### (2) ${rel} — call_expression nodes mentioning websocket/notUpgraded`)
  const st: any[] = [root]
  while (st.length > 0) {
    const n = st.pop()!
    if (n.type === "call_expression" && /websocket|notUpgraded/.test(n.text)) {
      const line = (src.slice(0, n.startIndex).match(/\n/g) ?? []).length + 1
      console.log(`  [line ${line}] ${JSON.stringify(lines[line - 1]?.trim().slice(0, 90))}`)
      console.log(shape(n, 3, 10))
    }
    for (let i = n.namedChildCount - 1; i >= 0; i--) { const c = n.namedChild(i); if (c) st.push(c) }
  }
}

// (3) minimal repro of the class parse
console.log("\n### (3) minimal repro: which class declaration shape degrades?")
const CASES: Array<[string, string]> = [
  ["bare", `public final class Foo: Bar {\n  let a = 1\n}\n`],
  ["attribute+class", `@available(macOS 10.15, *)\npublic final class Foo: Bar {\n  let a = 1\n}\n`],
  ["attribute+class+enum", `@available(macOS 10.15, *)\npublic final class Foo: Bar {\n  public enum E {\n    case a\n  }\n  let a = 1\n}\n`],
  ["docfence", `/// \`\`\`\n/// a\n/// \`\`\`\npublic final class Foo: Bar {\n  let a = 1\n}\n`],
  ["attribute+extension", `@available(macOS 10.15, *)\nextension Foo: Bar {}\n`],
]
for (const [name, code] of CASES) {
  const root = parse(code)
  const types: string[] = []
  const st: any[] = [root]
  while (st.length > 0) {
    const n = st.pop()!
    if (/declaration|extension/.test(n.type) && n.type !== "source_file") types.push(n.type)
    for (let i = n.namedChildCount - 1; i >= 0; i--) { const c = n.namedChild(i); if (c) st.push(c) }
  }
  console.log(`  ${name}: hasError=${root.hasError} decls=[${[...new Set(types)].join(",")}]`)
}
