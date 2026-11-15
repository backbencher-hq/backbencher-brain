// go lane — ROUND 5 fixture dump.
//
// What it is: the expectation file for `go/round5-surfaces` must be derived
// from the analyzer's REAL emission after a probe, never from theory
// (LANE-AUDIT-FORMULA §2). This script prints the emission in the shape the
// expectation file needs, so the author copies measured values rather than
// predicted ones — and so a later reader can re-run it against HEAD to see
// whether a value moved.
//
// Run: bun script/m14/tmp/go-round5-fixture-dump.ts
import * as fs from "node:fs"
import * as path from "node:path"
import { ASTEngine } from "../../../src/ast/engine"
import { RealGoAnalyzer } from "../../../src/ast/real-go-analyzer"

const file = path.join(import.meta.dir, "../../../validation/m14/fixtures/go/round5-surfaces.go")
const src = fs.readFileSync(file, "utf8")
const parser = await ASTEngine.getParser("go" as any)
const tree = parser.parse(src)
if (!tree.rootNode) throw new Error("no root node")
const res: any = await new RealGoAnalyzer().analyze(tree.rootNode, src, file)

console.log("=== SYMBOLS ===")
for (const s of res.symbols ?? []) {
  console.log(
    JSON.stringify({
      name: s.name,
      kind: s.kind,
      visibility: s.visibility,
      ownerName: s.ownerName ?? null,
      range: s.range,
      isExported: s.metadata?.isExported ?? null,
    }),
  )
}
console.log("=== EXPORTS ===")
console.log(JSON.stringify((res.exports ?? []).map((e: any) => ({ name: e.name, kind: e.kind, visibility: e.visibility })), null, 1))
console.log("=== FRAMEWORKS ===")
console.log(JSON.stringify({
  framework: res.metadata?.framework ?? null,
  detectedFrameworks: res.metadata?.detectedFrameworks ?? null,
  frameworkPatterns: (res.metadata?.frameworkPatterns ?? []).map((p: any) => ({
    framework: p.framework,
    patterns: p.patterns,
  })),
  primary: (res.metadata?.frameworkPatterns ?? [])[0]?.characteristics ?? null,
}))
console.log("=== ARCHITECTURAL INSIGHTS ===")
console.log(JSON.stringify((res.metadata?.architecturalInsights ?? []).map((i: any) => ({ category: i.category, message: i.message })), null, 1))
console.log("=== SCORE / QUALITY / COMPLEXITY ===")
console.log(JSON.stringify({
  architecturalScore: res.metadata?.architecturalScore,
  codeQuality: res.metadata?.codeQuality,
  complexity: res.metadata?.complexity,
  cyclomaticComplexity: res.metadata?.cyclomaticComplexity,
  linesOfCode: res.metadata?.linesOfCode,
}))
console.log("=== RELATIONSHIPS ===")
for (const r of res.relationships ?? []) {
  const label = String(r.type ?? r.relationshipType ?? "")
  if (label === "imports") continue
  console.log(
    JSON.stringify({
      type: label,
      from: r.source,
      target: r.target,
      line: (r as any).line_number ?? null,
      conf: r.confidence,
      rt: r.metadata?.relationshipType ?? null,
      evidenceClass: r.metadata?.evidenceClass ?? null,
    }),
  )
}
