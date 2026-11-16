import { execSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { ASTEngine } from "<corpus-root>/backbencher-brain/src/ast/engine"
import { RealHclAnalyzer } from "<corpus-root>/backbencher-brain/src/ast/real-hcl-analyzer"

// PROBE, not a hand-authored expectation: the lane's rule is that an expectation
// records what the analyzer DOES (measured through the same entry the fixture
// runner uses) after a defect class has been argued from the grammar. Every
// value below was then read back against the fixture source line by line.
const FIX = "<corpus-root>/backbencher-brain/validation/m14/fixtures/hcl/operation-operand-references.tf"
const src = readFileSync(FIX, "utf8")
const parser = await ASTEngine.getParser("hcl")
const tree = parser.parse(src)
const res = new RealHclAnalyzer().analyze(tree.rootNode as any, src, FIX)

const lines = src.split("\n")
const rels = res.relationships.filter((r) => r.type === "references")
const out: string[] = []
out.push("=== REFERENCES (target @ line_number) with the source line ===")
for (const r of rels) {
  const ln = (r as any).line_number
  out.push(`  ${String(r.target).padEnd(45)} L${String(ln).padEnd(3)} | ${(lines[ln - 1] ?? "").trim()}`)
}
out.push("")
out.push("=== reference targets containing a `var.` root, deduped ===")
const targets = [...new Set(rels.map((r) => r.target))].sort()
for (const t of targets) out.push("  " + t)
writeFileSync("<corpus-root>/bb_tests/hcl/out/fixture-probe-operation.txt", out.join("\n") + "\n")
console.log(out.join("\n"))
console.log("\nline_number coverage: " + rels.filter((r: any) => typeof r.line_number === "number").length + "/" + rels.length)
