/**
 * c-call-target-probe — K1 (D7 #996) evidence instrument.
 *
 * Prints the `calls` rows the analyzer publishes for ONE file (default the K1 fixture), so the
 * BEFORE (RED: `-> if`, `-> $global_code_object_cache_find`) and AFTER (GREEN: refused) states are
 * reproducible with a command instead of a screenshot. This is a development/evidence instrument,
 * not a gate: it parses exactly one file through the production analyzer.
 *
 * Usage:
 *   bun run script/m14/c-call-target-probe.ts [validation/m14/fixtures/c/call-target-refusals-996.c]
 */
import * as fs from "node:fs"
import * as path from "node:path"
import { getParser } from "../../src/ast/engine"
import { RealCAnalyzer } from "../../src/ast/real-c-analyzer"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..", "..")
const rel = process.argv[2] ?? "validation/m14/fixtures/c/call-target-refusals-996.c"
const src = fs.readFileSync(path.join(ROOT, rel), "utf8")
const parser: any = await getParser("c")
const analyzer = new RealCAnalyzer()
const result: any = await analyzer.analyze(parser.parse(src).rootNode, src, rel)
console.log(`file: ${rel}`)
for (const e of (result.relationships ?? []) as any[]) {
  if (String(e.type) === "calls") console.log(`calls ${e.source} -> ${e.target} @${e.line_number}`)
}
const bad = ((result.relationships ?? []) as any[]).filter((e) => String(e.type) === "calls" &&
  (String(e.target).includes("$") || ["if", "else", "for", "while", "switch", "return", "sizeof"].includes(String(e.target))))
if (bad.length > 0) {
  console.log(`REFUSAL-CLASS TARGETS PUBLISHED: ${bad.length}`)
  process.exit(1)
}
console.log("REFUSAL-CLASS TARGETS PUBLISHED: 0")
