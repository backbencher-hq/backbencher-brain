// script/m14/tmp/dt-extent-triage.ts — one file, both sides, the difference.
//
// The full-extent dart-http draw (335/335 files, hash 2dee60fd89aee7be) is RED:
// MISSING=1 `calls -> as` and 27 unexplained `instantiates <method> -> <ObjC
// class>`, all in one generated bindings file. This probe re-derives ONE file's
// two sides (the analyzer and the differential oracle, label|target after the
// harness's own normalisation) and prints the symmetric difference, so the
// ruling — analyzer fabrication or oracle under-derivation — is made against the
// SOURCE TEXT and the grammar shape, not against either side's claim.
//
// Usage: bun script/m14/tmp/dt-extent-triage.ts <file.dart> [labelFilter]
import * as fs from "node:fs"
import * as path from "node:path"
import { RealDartAnalyzer } from "../../../src/ast/real-dart-analyzer"
import { deriveDartEdges, deriveDartBareUses } from "../differential"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
const COMPARED = new Set(["extends", "implements", "instantiates", "calls", "uses"])

function lastSegment(t: string): string {
  const parts = String(t).replace(/^<\s*/, "").split(/::|\./).filter(Boolean)
  return parts[parts.length - 1] ?? t
}
function normTarget(t: string): string {
  return lastSegment(String(t).replace(/<.*$/, "").replace(/\[.*$/, "").trim())
}

async function main() {
  const file = process.argv[2]
  const filter = process.argv[3] ?? ""
  const rel = path.relative("<corpus-root>/bb_tests/repositories/dart-http", file)
  const wts0: any = await import("web-tree-sitter")
  const P0: any = wts0.Parser ?? wts0.default ?? wts0
  const L0: any = wts0.Language ?? wts0.default?.Language
  await P0.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG0: any = await L0.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-dart.wasm")))
  const content0 = fs.readFileSync(file, "utf8")
  const p0 = new P0(); p0.setLanguage(LANG0)
  const root0: any = p0.parse(content0).rootNode
  const analyzer: any = await new RealDartAnalyzer().analyze(root0, content0, rel)
  const seen = new Set<string>()
  const aEdges = (analyzer.relationships ?? [])
    .map((r: any) => ({ label: String(r.type).toLowerCase(), target: String(r.target), line: r.line_number, conf: r.confidence ?? 1 }))
    .filter((r: any) => COMPARED.has(r.label))
    .filter((r: any) => (filter ? r.target.includes(filter) : true))
    .filter((r: any) => { const k = r.label + "|" + normTarget(r.target); if (seen.has(k)) return false; seen.add(k); return true })

  // The oracle needs the symbols the analyzer produced (its bare-read mirror is
  // symbol-driven) and the tree.
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-dart.wasm")))
  const content = fs.readFileSync(file, "utf8")
  const p = new P(); p.setLanguage(LANG)
  const root = p.parse(content).rootNode
  const oEdges = [
    ...deriveDartEdges(root),
    ...deriveDartBareUses(root, analyzer.symbols ?? []),
  ].filter((e: any) => COMPARED.has(e.label) && (filter ? String(e.target).includes(filter) : true))

  console.log(`=== ${rel}`)
  const aKeys = new Set(aEdges.map((e: any) => e.label + "|" + normTarget(e.target)))
  const oKeys = new Set(oEdges.map((e: any) => e.label + "|" + normTarget(e.target)))
  const analyzerOnly = aEdges.filter((e: any) => !oKeys.has(e.label + "|" + normTarget(e.target)))
  const oracleOnly = oEdges.filter((e: any) => !aKeys.has(e.label + "|" + normTarget(e.target)))
  console.log(`analyzer edges=${aEdges.length} oracle edges=${oEdges.length}`)
  console.log(`analyzer-only (UNEXPLAINED if >=0.7): ${analyzerOnly.length}`)
  for (const e of analyzerOnly.slice(0, 40)) console.log(`  ${e.label} ${e.target} conf=${e.conf} line=${e.line}`)
  console.log(`oracle-only (MISSING): ${oracleOnly.length}`)
  for (const e of oracleOnly.slice(0, 40)) console.log(`  ${e.label} ${e.target}`)
}
main().then(() => process.exit(0))
