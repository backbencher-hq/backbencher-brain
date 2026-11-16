// #841 r23 close-out: production-API (ASTEngine.parseFile) extraction for the
// varargs/default files at the committed r22 build. The direct analyzer.analyze()
// probe returns zeros (known instrument trap, r22 history) — parseFile is the
// authoritative entry the pipeline itself uses.
import path from "node:path"
const ROOT = "<corpus-root>/mcp/backbencher-brain"
const FILES = [
  ["TestData-simple", "<corpus-root>/bb_tests/repositories/grails-core/grails-test-examples/spring-security/ui/simple/grails-app/services/test/TestDataService.groovy"],
  ["TestData-extended", "<corpus-root>/bb_tests/repositories/grails-core/grails-test-examples/spring-security/ui/extended/grails-app/services/test/TestDataService.groovy"],
  ["ViolationAgg", "<corpus-root>/bb_tests/repositories/grails-core/build-logic/plugins/src/main/groovy/org/apache/grails/buildsrc/GrailsViolationAggregationPlugin.groovy"],
]
const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
for (const [tag, FILE] of FILES) {
  const fs = await import("node:fs")
  const text = fs.readFileSync(FILE, "utf8")
  const res = await (ASTEngine as any).parseFile(FILE, text)
  const syms = res.symbols ?? []
  const rels = res.relationships ?? []
  console.log(`===== ${tag}: ${syms.length} symbols, ${rels.length} rels`)
  const kinds: Record<string, number> = {}
  for (const s of syms) kinds[s.kind] = (kinds[s.kind] ?? 0) + 1
  console.log("   kinds:", JSON.stringify(kinds))
  const near = syms.filter((s: any) => (s.range?.startLine ?? s.line ?? 0) >= 95 && (s.range?.startLine ?? s.line ?? 0) <= 145)
  console.log("   syms 95-145:", near.map((s: any) => `${s.kind}:${s.name}@${s.range?.startLine ?? s.line}`).join(", ") || "none")
  const nearRels = rels.filter((r: any) => (r.line ?? 0) >= 95 && (r.line ?? 0) <= 145)
  console.log("   rels 95-145:", nearRels.map((r: any) => `${r.type}:${(r.targetName ?? r.target ?? "?")}@${r.line}`).join(", ") || "none")
}
