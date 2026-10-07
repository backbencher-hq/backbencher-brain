/**
 * SWIFT GRAMMAR SHAPE PROBE — what does the PINNED tree-sitter-swift actually
 * emit for the constructs an `exports` / `imports` edge would be read from?
 *
 * This is the oracle-independent step: it prints the S-expression for the
 * shapes in question so the analyzer's extraction can be written against the
 * tree rather than against source text. It is a PROBE, not a check — it asserts
 * nothing, so it cannot drift into a tautology. The numbers that become a
 * verdict come from swift-ontology-census.ts; these shapes are what make the
 * implementation defensible.
 *
 * Usage: bun script/m14/swift-grammar-shape-probe.ts
 */
import { readFileSync } from "node:fs"
import * as path from "node:path"

const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-swift.wasm"))))

const CASES: Array<{ label: string; src: string }> = [
  { label: "plain module import", src: "import Foundation\n" },
  { label: "attributed import (@testable)", src: "@testable import NIOCore\n" },
  { label: "attributed import (@_exported)", src: "@_exported import NIOCore\n" },
  { label: "scoped import (struct)", src: "import struct Foundation.URLSession\n" },
  { label: "scoped import (let, dotted)", src: "import let WinSDK.IPPROTO_IP\n" },
  { label: "submodule import", src: "import Foo.Bar.Baz\n" },
  { label: "public struct at file scope", src: "public struct Repo { public var x: Int = 0 }\n" },
  { label: "public func at file scope", src: "public func run() {}\n" },
  { label: "open class member", src: "open class S { open func f() {} }\n" },
  { label: "package access (Swift 5.9)", src: "package func p() {}\n" },
  { label: "internal (default, no modifier)", src: "func i() {}\n" },
  { label: "public typealias", src: "public typealias Handler = (Int) -> Void\n" },
  { label: "public protocol + members", src: "public protocol P { func f() }\n" },
  { label: "public enum", src: "public enum E: String { case a }\n" },
  { label: "public extension", src: "public extension Int { var d: Int { 1 } }\n" },
  { label: "public let/var at file scope", src: "public let g = 1\n" },
  { label: "private file scope (not an export)", src: "private func h() {}\n" },
  { label: "public init", src: "public class C { public init() {} }\n" },
  { label: "public subscript", src: "public class C2 { public subscript(i: Int) -> Int { 0 } }\n" },
]

function sexp(n: any, depth = 0, maxDepth = 4): string {
  const pad = "  ".repeat(depth)
  if (depth > maxDepth) return `${pad}(…${n.type})`
  const kids: string[] = []
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c) kids.push(sexp(c, depth + 1, maxDepth))
  }
  const anon: string[] = []
  for (let i = 0; i < n.childCount; i++) {
    const c = n.child(i)
    if (c && !c.isNamed) anon.push(JSON.stringify(c.type))
  }
  const anonStr = anon.length > 0 ? ` [${anon.join(" ")}]` : ""
  if (kids.length === 0) return `${pad}(${n.type}${anonStr})`
  return `${pad}(${n.type}${anonStr}${kids.length > 0 ? `\n${kids.join("\n")}` : ""})`
}

for (const c of CASES) {
  const t = parser.parse(c.src)
  console.log(`\n### ${c.label}`)
  console.log(`    ${JSON.stringify(c.src.trim())}`)
  console.log(sexp(t.rootNode, 0, 5))
  t.delete?.()
}