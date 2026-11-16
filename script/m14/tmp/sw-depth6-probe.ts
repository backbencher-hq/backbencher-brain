// script/m14/tmp/sw-depth6-probe.ts — the six findings a FULL-EXTENT swift-nio draw
// (554 files) exposes and the 60-file canonical draw never touched. Dump the exact
// node shapes plus BOTH sides' edges, so each finding is attributed to a construct
// instead of guessed.
//
//   MISSING   Sources/NIOEmbedded/AsyncTestingChannel.swift :: calls -> init
//   UNEXPLAINED Tests/NIOFSTests/FileInfoTests.swift :: uses testEquatableConformance -> platformSpecificStatus
//   UNEXPLAINED Sources/NIOWebSocketClient/Client.swift :: calls handleUpgradeResult -> websocket
//   UNEXPLAINED Sources/NIOWebSocketServer/Server.swift :: calls root -> websocket
//   UNEXPLAINED Sources/NIOWebSocketServer/Server.swift :: calls root -> notUpgraded
//   UNEXPLAINED Sources/NIOEmbedded/AsyncTestingChannel.swift :: instantiates constructor -> constructor
//
// Run: bun script/m14/tmp/sw-depth6-probe.ts
import * as fs from "node:fs"
import * as path from "node:path"
import { RealSwiftAnalyzer } from "../../../src/ast/real-swift-analyzer"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
const REPO = "<corpus-root>/bb_tests/repositories/swift-nio"
const FILES = [
  "Sources/NIOEmbedded/AsyncTestingChannel.swift",
  "Tests/NIOFSTests/FileInfoTests.swift",
  "Sources/NIOWebSocketClient/Client.swift",
  "Sources/NIOWebSocketServer/Server.swift",
]

function shape(n: any, depth = 0, maxDepth = 8): string {
  const pad = "  ".repeat(depth)
  const head = `${pad}${n.type}${n.isNamed ? "" : " (anon)"}${n.childCount === 0 ? ` text=${JSON.stringify(n.text.slice(0, 48))}` : ""}`
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

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-swift.wasm")))
  const mod: any = await import("../../../script/m14/differential")

  // corpus-wide protocol names: mirrors the lane harness (sample-wide set).
  const protos = new Set<string>()
  const allFiles: string[] = []
  ;(function walk(dir: string) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) { if (!/^(\.|build|\.build)/.test(e.name)) walk(path.join(dir, e.name)) }
      else if (e.name.endsWith(".swift")) allFiles.push(path.join(dir, e.name))
    }
  })(REPO)

  let i = 0
  for (const f of allFiles) {
    if (i++ % 25 === 0) process.stdout.write(`\r[protocol prescan] ${i}/${allFiles.length}`)
    const content = fs.readFileSync(f, "utf8")
    const pp = new P(); pp.setLanguage(LANG)
    const root = pp.parse(content).rootNode
    const st: any[] = [root]
    while (st.length > 0) {
      const n = st.pop()!
      if (n.type === "protocol_declaration") {
        for (let k = 0; k < n.namedChildCount; k++) {
          const c = n.namedChild(k)
          if (c && c.type === "type_identifier") { protos.add(c.text); break }
        }
      }
      for (let k = n.namedChildCount - 1; k >= 0; k--) { const c = n.namedChild(k); if (c) st.push(c) }
    }
  }
  process.stdout.write(`\r[protocol prescan] done: ${protos.size} protocols, ${allFiles.length} files\n`)
  const typeKinds = new Map<string, string>()
  for (const nm of protos) typeKinds.set(nm, "interface")

  for (const rel of FILES) {
    const f = path.join(REPO, rel)
    const content = fs.readFileSync(f, "utf8")
    const srcLines = content.split("\n")
    const pp = new P(); pp.setLanguage(LANG)
    const root = pp.parse(content).rootNode
    const r: any = await new RealSwiftAnalyzer().analyze(root, content, rel, { typeKinds } as any)
    const analyzerRels = (r.relationships ?? []).map((x: any) => ({ label: String(x.type).toLowerCase(), from: String(x.source), target: String(x.target), conf: x.confidence }))
    const truth = mod.deriveSwiftEdges(root, protos)
    for (const e of mod.deriveSwiftBareUses(root, r.symbols ?? [])) truth.push(e)

    console.log(`\n########## ${rel} ##########`)
    console.log("--- analyzer calls/uses/instantiates ---")
    for (const x of analyzerRels) {
      if (!["calls", "uses", "instantiates"].includes(x.label)) continue
      console.log(`  ${x.label} ${x.from} -> ${x.target} conf=${x.conf}`)
    }
    console.log("--- oracle calls/uses/instantiates ---")
    for (const x of truth) {
      if (!["calls", "uses", "instantiates"].includes(x.label)) continue
      console.log(`  ${x.label} ${x.from} -> ${x.target}`)
    }
    const onlyAnalyzer = analyzerRels.filter((x) => ["calls", "uses", "instantiates"].includes(x.label) && !truth.some((t: any) => t.label === x.label && t.target === x.target))
    const onlyOracle = truth.filter((t: any) => ["calls", "uses", "instantiates"].includes(t.label) && !analyzerRels.some((x) => x.label === t.label && x.target === t.target))
    console.log(`--- ONE-SIDED --- analyzer-only=${onlyAnalyzer.length} oracle-only=${onlyOracle.length}`)
    for (const x of onlyAnalyzer) console.log(`  A-ONLY ${x.label} ${x.from} -> ${x.target} conf=${x.conf}`)
    for (const x of onlyOracle) console.log(`  O-ONLY ${x.label} ${x.from} -> ${x.target}`)

    // shape dumps for the constructs under suspicion
    const marks: Array<{ at: string; pick: (n: any) => boolean }> = [
      { at: "switch_entry", pick: (n) => n.type === "switch_entry" },
      { at: "value_argument_label", pick: (n) => n.type === "value_argument_label" },
      { at: "init_declaration", pick: (n) => n.type === "init_declaration" },
      { at: "call_expression>init", pick: (n) => n.type === "call_expression" && /(^|[^\w.])init\s*\(/.test(n.text) },
      { at: "case-pattern", pick: (n) => n.type === "prefix_expression" && n.text.trim().startsWith(".") },
    ]
    for (const m of marks) {
      const hits: any[] = []
      const st2: any[] = [root]
      while (st2.length > 0) {
        const n = st2.pop()!
        if (m.pick(n)) hits.push(n)
        for (let k = n.namedChildCount - 1; k >= 0; k--) { const c = n.namedChild(k); if (c) st2.push(c) }
      }
      if (hits.length === 0) continue
      console.log(`\n@@@ nodes matching ${m.at}: ${hits.length}`)
      for (const n of hits.slice(0, 6)) {
        const line = (content.slice(0, n.startIndex).match(/\n/g) ?? []).length + 1
        console.log(`  [line ${line}] ${JSON.stringify(srcLines[line - 1]?.trim().slice(0, 100))}`)
        console.log(shape(n, 3))
      }
      if (hits.length > 6) console.log(`  … +${hits.length - 6} more`)
    }
  }
}

await main()
