// script/m14/tmp/sw-platformstatus-probe.ts — which rule emits
// `uses testEquatableConformance -> platformSpecificStatus` in FileInfoTests.swift?
// Run: bun script/m14/tmp/sw-platformstatus-probe.ts
import * as fs from "node:fs"
import { ASTEngine } from "../../../src/ast/engine"

const F = "/home/ishaq2321/bb_tests/repositories/swift-nio/Tests/NIOFSTests/FileInfoTests.swift"
const src = fs.readFileSync(F, "utf8")
const parsed: any = await (ASTEngine as any).parseFile(F, src, { language: "swift" })
for (const r of parsed.relationships ?? []) {
  if (String(r.target) !== "platformSpecificStatus") continue
  console.log(JSON.stringify(r, null, 1))
}
console.log("--- symbols with platformSpecificStatus ---")
for (const s of parsed.symbols ?? []) {
  if (/platformSpecificStatus/.test(s.name)) console.log(`  ${s.name} | ${s.kind} | owner=${s.ownerName} | line=${s.range?.startLine}`)
}
console.log(`--- type symbols ---`)
for (const s of parsed.symbols ?? []) {
  if (/(class|struct|enum|extension|protocol)$/.test(String(s.kind))) console.log(`  ${s.name} | ${s.kind} | owner=${s.ownerName} | line=${s.range?.startLine}`)
}
