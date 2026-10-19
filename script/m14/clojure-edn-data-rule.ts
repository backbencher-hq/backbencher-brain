/**
 * CLJ-EX3 — the EDN DATA RULE as an EXECUTABLE, RED-CAPABLE pin.
 *
 * The shared fixture runner discovers Clojure fixture sources by `.clj/.cljs/.cljc` (74 rows), and a
 * `.edn` fixture cannot ride it — so the data rule's two-direction proof lives here, in the lane's
 * own instrument: `edn-data-rule.edn` must emit NOTHING (no symbols, no relationships of any of the
 * ten labels), while the same forms in `edn-data-rule-code.clj` keep their rows. Exit 1 on any
 * violation, so this is a fixture-shaped gate rather than a report.
 *
 * Usage: bun run script/m14/clojure-edn-data-rule.ts
 */
import * as fs from "node:fs"
import * as path from "node:path"
import { ASTEngine } from "../../src/ast/engine"
import { RealClojureAnalyzer } from "../../src/ast/real-clojure-analyzer"

const parser = await ASTEngine.getParser("clojure" as any)
const dir = "validation/m14/fixtures/clojure"
const TEN = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"]
const analyze = (name: string): { symbols: number; rows: Array<{ type: string; source: string; target: string; line: number }> } => {
  const file = path.join(dir, name)
  const content = fs.readFileSync(file, "utf8")
  const tree = parser.parse(content)
  if (!tree) throw new Error(`grammar could not parse ${name}`)
  const res: any = new RealClojureAnalyzer().analyze(tree.rootNode, content, file)
  return {
    symbols: (res.symbols ?? []).length,
    rows: (res.relationships ?? []).map((r: any) => ({ type: String(r.type), source: String(r.source), target: String(r.target), line: Number(r.line_number ?? 0) })),
  }
}
const failures: string[] = []
// direction 1: a data file emits nothing
const edn = analyze("edn-data-rule.edn")
if (edn.symbols !== 0) failures.push(`data file published ${edn.symbols} symbol(s) — data declares nothing`)
for (const r of edn.rows) failures.push(`data file emitted ${r.type} ${r.source}->${r.target}@${r.line} — a data literal is not a code edge`)
// direction 2: the same forms as code keep their rows (so the rule cannot be satisfied by breaking the analyzer)
const clj = analyze("edn-data-rule-code.clj")
const expected = [
  { type: "calls", source: "user", target: "shell", line: 3 },
  { type: "calls", source: "user", target: "clojure.test/is", line: 4 },
  { type: "calls", source: "user", target: "clojure.test/testing", line: 5 },
]
for (const want of expected) {
  if (!clj.rows.some((r) => r.type === want.type && r.source === want.source && r.target === want.target && r.line === want.line)) {
    failures.push(`code twin LOST its ${want.type} ${want.source}->${want.target}@${want.line} — the data rule must not empty the analyzer`)
  }
}
if (clj.rows.some((r) => r.type === "calls" && r.target === "is")) failures.push("core `is` call was emitted in the code twin (core suppression regressed)")
const total = TEN.length
console.log(`CLOJURE EDN DATA RULE — data file rows ${edn.rows.length} (expected 0) · code twin rows ${clj.rows.length} (expected ≥3) · labels checked ${total}`)
if (failures.length > 0) {
  for (const f of failures) console.log("  FAIL " + f)
  process.exit(1)
}
console.log("PASS — two-direction EDN data rule holds")
