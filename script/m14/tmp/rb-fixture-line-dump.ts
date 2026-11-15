// script/m14/tmp/rb-fixture-line-dump.ts — measure the new ruby line fixture
// before authoring its expectation, so the pins are written from the analyzer's
// real behaviour (and any line that contradicts the target-written rule is a
// finding, not a number to copy).
//
// Run: bun script/m14/tmp/rb-fixture-line-dump.ts
import * as fs from "node:fs"
import * as path from "node:path"
import { ASTEngine } from "../../../src/ast/engine"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")
const FIX = path.join(ROOT, "validation/m14/fixtures/ruby/callsite-lines-825.rb")

const src = fs.readFileSync(FIX, "utf8")
const srcLines = src.split("\n")
console.log("=== numbered source ===")
srcLines.forEach((l, i) => console.log(String(i + 1).padStart(3), l))

const parsed: any = await (ASTEngine as any).parseFile(FIX, src, { language: "ruby" })
console.log("\n=== symbols ===")
for (const s of parsed?.symbols ?? []) {
  console.log(`  ${String(s.kind).padEnd(9)} ${String(s.name).padEnd(18)} owner=${String(s.ownerName).padEnd(10)} range=${JSON.stringify(s.range)}`)
}
console.log("\n=== relationships ===")
for (const r of parsed?.relationships ?? []) {
  const ln = r.line_number ?? r.metadata?.line
  console.log(`  L${String(ln ?? "-").padStart(3)} ${String(r.type).padEnd(13)} ${String(r.source).padEnd(20)} -> ${String(r.target).padEnd(22)} conf=${r.confidence} meta=${JSON.stringify(r.metadata ?? {})}`)
}
