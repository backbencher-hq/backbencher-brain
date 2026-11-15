// script/m14/tmp/sw-509-probe.ts — locate the ONE unexplained edge the full-extent
// swift-nio draw reports at the current analyzer bytes:
//   calls _shutdownGracefully -> queueCallbackPair (line 509)
// at Sources/NIOPosix/MultiThreadedEventLoopGroup.swift. Prints the analyzer's own
// relationship for that site AND the tree shape around it, so the ruling is read
// from the node, never guessed from the source line.
//
// Run: bun script/m14/tmp/sw-509-probe.ts
import * as fs from "node:fs"
import { ASTEngine } from "../../../src/ast/engine"

const F = "/home/ishaq2321/bb_tests/repositories/swift-nio/Sources/NIOPosix/MultiThreadedEventLoopGroup.swift"
const src = fs.readFileSync(F, "utf8")

const parsed: any = await (ASTEngine as any).parseFile(F, src, { language: "swift" })
const lines = src.split("\n")
console.log("=== published relationships naming queueCallbackPair ===")
for (const r of parsed.relationships ?? []) {
  if (!/queueCallbackPair/.test(String(r.target)) && !/queueCallbackPair/.test(String(r.source))) continue
  const ln: number = r.line_number ?? r.metadata?.line ?? 0
  console.log(`  L${ln} ${r.type}  ${r.source} -> ${r.target}  conf=${r.confidence}  | ${(lines[ln - 1] ?? "").trim()}`)
}

console.log("\n=== tree: every node whose text starts with `for queueCallbackPair` ===")
const root = (ASTEngine as any).parseTree
const seen: any[] = []
function walk(n: any, depth: number) {
  const t: string = n.text ?? ""
  if (t.startsWith("for queueCallbackPair") && t.length < 400) seen.push(n)
  for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i), depth + 1)
}
// parseFile does not expose the tree; re-parse via the raw parser path.
const wts: any = await import("web-tree-sitter")
const P: any = wts.Parser ?? wts.default ?? wts
const L: any = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "/home/ishaq2321/mcp/backbencher-brain/node_modules/web-tree-sitter/tree-sitter.wasm" })
const LANG: any = await L.load(fs.readFileSync("/home/ishaq2321/mcp/backbencher-brain/wasm/tree-sitter-swift.wasm"))
const p = new P()
p.setLanguage(LANG)
const tree = p.parse(src)
walk(tree.rootNode, 0)
for (const n of seen.slice(0, 3)) {
  console.log("---- node type=" + n.type + " @" + (n.startPosition.row + 1))
  console.log(n.toString().slice(0, 2000))
  console.log("---- source text:")
  console.log((n.text ?? "").slice(0, 400))
}
