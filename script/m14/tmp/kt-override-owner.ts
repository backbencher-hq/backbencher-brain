/**
 * M60 oracle-sharpness, kotlin triage (the sweep's first HARD masks).
 *
 * 4 truth rows on `exposed-core/.../ColumnType.kt` are PASSED by the published
 * (leaf) rule and NOT by a written-target rule, and all 4 are the SAME shape:
 *
 *   truth    overrides  ColumnWithTransform.valueToDB -> IColumnType.valueToDB
 *   analyzer overrides  ColumnWithTransform.valueToDB -> ColumnType.valueToDB
 *                                                       ColumnWithTransform.valueToDB   (self?)
 *
 * The source says: `interface IColumnType` DECLARES `valueToDB`; `abstract class
 * ColumnType : IColumnType` inherits it; `ColumnWithTransform : ColumnType` overrides
 * it. So the declaring type of the overridden member is IColumnType — which is where
 * the oracle points and where the analyzer does not. This probe dumps both sides plus
 * the member symbols, because the answer differs by model: an "inherited slot" model
 * would make ColumnType a legitimate owner, but then ColumnWithTransform -> itself is
 * not an override at all.
 */
import * as fs from "fs"
import { RealKotlinAnalyzer } from "../../../src/ast/real-kotlin-analyzer"
import { deriveTreeEdges } from "../differential"

const FILE = "<corpus-root>/bb_tests/repositories/Exposed/exposed-core/src/main/kotlin/org/jetbrains/exposed/v1/core/ColumnType.kt"

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const lang = await L.load(fs.readFileSync("wasm/tree-sitter-kotlin.wasm"))
  const parser = new P()
  parser.setLanguage(lang)
  const content = fs.readFileSync(FILE, "utf8")
  const root = parser.parse(content).rootNode

  const az: any = new RealKotlinAnalyzer()
  const s: any = az.analyze(root, content, "ColumnType.kt")
  const rels = (s.relationships ?? []).filter((r: any) => r.type === "overrides" || r.type === "extends")
  console.log(`analyzer: ${(s.symbols ?? []).length} symbols, ${(s.relationships ?? []).length} relationships`)
  console.log("analyzer edges naming a valueToDB/valueToString member:")
  for (const r of rels) {
    if (!/valueToDB|valueToString/.test(String(r.target)) && !/valueToDB|valueToString/.test(String(r.source))) continue
    console.log(`  ${String(r.type).padEnd(9)} ${r.source} -> ${r.target}  (line ${r.line_number ?? "?"}, conf ${r.confidence})`)
  }
  console.log("analyzer SYMBOLS naming a valueToDB/valueToString member (raw, to see the OWNER):")
  const members: any[] = (s.symbols ?? []).filter((sym: any) => /valueToDB|valueToString/.test(String(sym.name ?? "")))
  for (const sym of members) console.log(`  ${JSON.stringify(sym)}`)
  // THE JOIN QUESTION: is `ColumnType.valueToDB` — the target the resolver publishes
  // for an edge whose truth target is `IColumnType.valueToDB` — a name this lane has
  // a symbol for, or a dangling target?
  // ROOT CAUSE, two candidates that lead to different code: did the BFS never
  // REACH the interface (superTypes metadata gap), or reach it and reject it in the
  // signature test? Print the hierarchy the resolver reads and both signature forms.
  console.log("hierarchy as the resolver reads it (typeIndex.metadata.superTypes):")
  for (const sym of s.symbols ?? []) {
    if (!/^(IColumnType|ColumnType|ColumnWithTransform|NullableColumnWithTransform|ByteColumnType)$/.test(String(sym.name))) continue
    console.log(`  ${String(sym.name).padEnd(28)} kind=${sym.kind} superTypes=${JSON.stringify(sym.metadata?.superTypes ?? null)} typeParams=${JSON.stringify(sym.metadata?.typeParameters ?? null)}`)
  }
  const sigOf = (x: any) => `(${(x.parameters ?? []).map((p: any) => p.type ?? "").join(",")})`
  console.log("signatures the declSigs index compares:")
  for (const sym of members) console.log(`  ${String(sym.ownerName)}.${sym.name}  sig=${sigOf(sym)}  modifiers=${JSON.stringify(sym.metadata?.modifiers ?? [])}`)
  // THE RULE IS MEASURED, NOT RE-IMPLEMENTED (#949). This block used to carry an
  // in-probe copy of the analyzer's `hasTypeVar`, which is how the file kept
  // printing `hasTypeVar("(T?)") = false` AFTER the fix landed: a probe that
  // re-implements the rule it audits can only ever agree with itself. The copy is
  // deleted; the observable is the analyzer's own emitted edges.
  const resolved = (from: string) => rels
    .filter((r: any) => r.type === "overrides" && r.source === from)
    .map((r: any) => `${r.target}@${r.confidence}`)
  const wanted: [string, string][] = [
    ["ColumnWithTransform.valueToDB", "IColumnType.valueToDB@0.9"],
    ["NullableColumnWithTransform.valueToString", "IColumnType.valueToString@0.9"],
    ["ByteColumnType.valueToDB", "IColumnType.valueToDB@0.9"],
  ]
  console.log("#949 rule, measured through the analyzer's own edges (pre-fix these read ColumnType/ColumnWithTransform@0.5):")
  for (const [from, want] of wanted) {
    const got = resolved(from)
    console.log(`  ${got.includes(want) ? "PASS" : "FAIL"}  ${from} -> ${want}   (emitted: ${got.join(", ") || "nothing"})`)
  }
  const symbolNames = new Set<string>((s.symbols ?? []).flatMap((sym: any) =>
    [sym.name, sym.qualifiedName, sym.metadata?.qualifiedName].filter(Boolean) as string[]))
  for (const cand of ["IColumnType.valueToDB", "ColumnType.valueToDB", "ColumnWithTransform.valueToDB", "NullableColumnWithTransform.valueToDB", "valueToDB"]) {
    console.log(`  symbol named ${JSON.stringify(cand)}: ${symbolNames.has(cand) ? "PUBLISHED" : "ABSENT"}`)
  }
  const truth = deriveTreeEdges(root, "kotlin").filter((e: any) => /valueToDB|valueToString/.test(e.target))
  console.log("oracle truth edges naming a valueToDB/valueToString target:")
  for (const t of truth) console.log(`  ${String(t.label).padEnd(9)} ${t.from} -> ${t.target}`)
}
main().catch((e) => { console.error(e); process.exit(1) })
