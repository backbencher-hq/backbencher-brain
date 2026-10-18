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
// CORRECTED boundary (D7 K1, arm-A measured): only KEYWORD targets are refusal-class. A
// non-identifier spelling is a spelling the analyzer's own name model accepts (generated Cython
// templates publish such identifiers, and some calls resolve to them), so it must KEEP publishing.
// The broad first guard refused it and withdrew 3 real resolutions; see C-D7-DISPOSITION.md.
const KEYWORDS = new Set(["if","else","for","while","do","switch","case","default","break","continue","return","goto","sizeof","typedef","struct","union","enum","static","extern","inline","register","volatile","const","auto","signed","unsigned","void","char","short","int","long","float","double","_Bool","_Complex","_Imaginary","restrict","_Alignas","_Alignof","_Atomic","_Generic","_Noreturn","_Static_assert","_Thread_local"])
const bad = ((result.relationships ?? []) as any[]).filter((e) => String(e.type) === "calls" && KEYWORDS.has(String(e.target)))
const dollar = ((result.relationships ?? []) as any[]).filter((e) => String(e.type) === "calls" && String(e.target).includes("$"))
console.log(`non-identifier ($) calls rows still published: ${dollar.length} (corrected boundary: must be > 0 when the fixture has one)`)
if (bad.length > 0) {
  console.log(`REFUSAL-CLASS (keyword) TARGETS PUBLISHED: ${bad.length}`)
  process.exit(1)
}
console.log("REFUSAL-CLASS (keyword) TARGETS PUBLISHED: 0")
