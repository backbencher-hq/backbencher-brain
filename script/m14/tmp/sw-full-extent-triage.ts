// script/m14/tmp/sw-full-extent-triage.ts — attribute the six findings that only a
// FULL-EXTENT swift-nio draw (554 files) exposes. The 60-file canonical sample is clean,
// so these have never been seen: confirm which source line emits each edge instead of
// reading the code and guessing.
//
// Run: bun script/m14/tmp/sw-full-extent-triage.ts
import * as fs from "node:fs"
import { ASTEngine } from "../../../src/ast/engine"

const REPOS = "<corpus-root>/bb_tests/repositories/swift-nio"
const FILES = [
  ["Sources/NIOWebSocketServer/Server.swift", [85, 95, 138, 148]],
  ["Sources/NIOWebSocketClient/Client.swift", [0, 0]],
  ["Tests/NIOFSTests/FileInfoTests.swift", [74, 96]],
  ["Sources/NIOEmbedded/AsyncTestingChannel.swift", [290, 330]],
] as const

for (const [rel, [lo, hi]] of FILES) {
  const f = `${REPOS}/${rel}`
  const src = fs.readFileSync(f, "utf8")
  const parsed: any = await (ASTEngine as any).parseFile(f, src, { language: "swift" })
  const srcLines = src.split("\n")
  console.log(`\n=== ${rel} ===`)
  for (const r of parsed.relationships ?? []) {
    const line: number = r.metadata?.line ?? r.line ?? 0
    const interesting =
      /websocket|notUpgraded|platformSpecificStatus|constructor|init/.test(String(r.target)) ||
      /websocket|notUpgraded|platformSpecificStatus|constructor|init/.test(String(r.source))
    if (!interesting) continue
    if (line && (line < lo || line > hi)) continue
    const text = line ? (srcLines[line - 1] ?? "").trim() : ""
    console.log(`  L${line} ${r.type}  ${r.source} -> ${r.target}  conf=${r.confidence}  | ${text.slice(0, 96)}`)
  }
}
