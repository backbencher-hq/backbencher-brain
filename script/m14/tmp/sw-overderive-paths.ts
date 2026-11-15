// For each name the bare mirror over-derives, print the node that triggered it
// plus its parent chain — so the fix targets the real construct, not a guess.
import * as fs from "fs"
import * as WTS from "web-tree-sitter"

const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const NIO = "/home/ishaq2321/bb_tests/repositories/swift-nio"
const TARGETS: Record<string, string[]> = {
  "Sources/NIOFS/FileType.swift": ["regular", "directory"],
  "Sources/NIOCore/EventLoop.swift": ["now", "hours", "fullNS", "ValidationError"],
  "Tests/NIOHTTP1Tests/TestUtils.swift": ["ipv6Loopback", "fulfilled", "group", "fulfilledBox"],
  "Tests/NIOPosixTests/IPv4Header.swift": ["rawValue", "v1", "protocol", "totalLength"],
  "Sources/NIOPosix/Bootstrap.swift": ["takingOwnershipOfDescriptor"],
}

async function main() {
  const wts: any = WTS
  const Parser = wts.Parser ?? wts.default ?? wts
  const Language = wts.Language ?? wts.default?.Language
  await Parser.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const lang = await Language.load(fs.readFileSync(ROOT + "/wasm/tree-sitter-swift.wasm"))
  const P = new Parser()
  P.setLanguage(lang)

  for (const f of Object.keys(TARGETS)) {
    const wanted = new Set(TARGETS[f])
    const src = fs.readFileSync(NIO + "/" + f, "utf8")
    const root = P.parse(src).rootNode
    console.log("=== " + f)
    const hits: string[] = []
    const walk = (n: any, chain: string) => {
      const label = n.type + (n.text && n.text.length < 40 && !n.text.includes("\n") ? "(" + n.text + ")" : "")
      if (n.type === "simple_identifier" && wanted.has(n.text)) {
        const line = src.slice(0, n.startIndex).split("\n").length
        hits.push("  L" + line + " " + n.text + "  chain: " + chain)
      }
      for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i), chain + " > " + label)
    }
    walk(root, "")
    for (const h of hits.slice(0, 12)) console.log(h)
  }
}
main()
