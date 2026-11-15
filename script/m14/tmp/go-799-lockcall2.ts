// go (round 4) — the OWNER of the 2 MISSING `calls` rows, second cut.
//
// go-799-errline.ts showed the whole tail of
// go-tools/go/analysis/passes/modernize/testdata/src/slicesbackward/slicesbackward.go
// sits inside one nested ERROR/composite_literal recovery region, yet the
// analyzer emits `calls String/StringPtr` (lines 231/238) from that same region
// and drops `calls Lock/Unlock` (lines 217/218). This prints the analyzer's
// recovered function/method symbols with their line spans, plus every emitted
// `calls` edge with its relationshipType and source symbol — so the rule that
// separates the two shapes is read off the output rather than guessed at.
//
// Run: bun script/m14/tmp/go-799-lockcall2.ts [file]
import * as fs from "node:fs"
import { ASTEngine } from "../../../src/ast/engine"
import { RealGoAnalyzer } from "../../../src/ast/real-go-analyzer"

const REAL =
  process.argv[2] ??
  "/home/ishaq2321/bb_tests/repositories/go-tools/go/analysis/passes/modernize/testdata/src/slicesbackward/slicesbackward.go"
const src = fs.readFileSync(REAL, "utf8")
const parser = await ASTEngine.getParser("go" as any)
const tree: any = parser.parse(src)
const root = tree.rootNode

const res: any = await new RealGoAnalyzer().analyze(root, src, REAL)

const syms = (res.symbols ?? []) as any[]
console.log(`=== analyzer symbols: ${syms.length} total; function/method ones in the tail ===`)
const nLines = src.split("\n").length
for (const s of syms) {
  const kind = String(s.kind ?? "")
  if (!/Function|Method/i.test(kind)) continue
  const start = s.range?.startLine ?? s.range?.start?.row ?? "?"
  const end = s.range?.endLine ?? s.range?.end?.row ?? "?"
  if (Number(start) < nLines - 120) continue
  console.log(`  ${kind.padEnd(10)} ${String(s.name).padEnd(28)} lines ${start}-${end} owner=${s.ownerName ?? "-"}`)
}

console.log(`=== emitted calls edges (with relationshipType + line) ===`)
for (const r of (res.relationships ?? []) as any[]) {
  if (String(r.type) !== "calls") continue
  const ln = Number(r.line_number ?? r.metadata?.line ?? 0)
  console.log(
    `  line ${String(ln).padStart(4)}  ${String(r.target).padEnd(14)} src=${String(r.source).padEnd(24)} rt=${r.metadata?.relationshipType ?? "-"} expr=${JSON.stringify(r.metadata?.callExpression ?? "")}`,
  )
}

// Does the file declare Lock/Unlock anywhere? (truth admits selector leaves
// unconditionally, so this is only for the record.)
console.log(`=== declarations naming Lock/Unlock/String/StringPtr in the file ===`)
for (const m of src.matchAll(/\bfunc\s+(\([^)]*\)\s*)?([A-Za-z_][A-Za-z0-9_]*)/g)) {
  console.log(`  ${m[2]}  (receiver: ${(m[1] ?? "-").trim()})`)
}
