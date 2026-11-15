/**
 * HCL FIXTURE DUMP — the expectation source for validation/m14/fixtures/hcl.
 *
 * The lane's rule: an expectation records what the analyzer DOES, measured
 * through the same entry `run-fixtures.ts` uses, AFTER the defect class has been
 * argued from the grammar. So this probe runs every fixture and prints the full
 * emission with the source line each fact sits on, for transcription.
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs"
import { ASTEngine } from "/home/ishaq2321/backbencher-brain/src/ast/engine"
import { RealHclAnalyzer } from "/home/ishaq2321/backbencher-brain/src/ast/real-hcl-analyzer"

const DIR = "/home/ishaq2321/backbencher-brain/validation/m14/fixtures/hcl"
const parser = await ASTEngine.getParser("hcl")
const out: string[] = []

for (const f of readdirSync(DIR).filter((x) => x.endsWith(".tf")).sort()) {
  const src = readFileSync(`${DIR}/${f}`, "utf8")
  const lines = src.split("\n")
  const t = parser.parse(src)
  const res = new RealHclAnalyzer().analyze(t.rootNode as any, src, f)
  out.push(`\n${"=".repeat(78)}\n### ${f}\n${"=".repeat(78)}`)
  out.push(`--- source with line numbers ---`)
  for (let i = 0; i < lines.length; i++) out.push(`  ${String(i + 1).padStart(4)} | ${lines[i]}`)
  out.push(`\n--- symbols (${res.symbols.length}) ---`)
  for (const s of res.symbols) {
    out.push(
      `  ${String(s.kind).padEnd(8)} name=${JSON.stringify(s.name)} scope=${JSON.stringify(s.scope ?? "")} owner=${JSON.stringify(s.ownerName ?? null)} ownerKind=${s.ownerKind ?? "-"} L${s.range.startLine} qn=${JSON.stringify(s.qualifiedName ?? null)} meta=${JSON.stringify(s.metadata)}`,
    )
  }
  out.push(`\n--- relationships (${res.relationships.length}) ---`)
  for (const r of res.relationships) {
    const ln = (r as any).line_number
    out.push(
      `  ${String(r.type).padEnd(11)} ${String(r.source).padEnd(34)} -> ${String(r.target).padEnd(40)} L${String(ln).padEnd(3)} | ${(lines[ln - 1] ?? "").trim().slice(0, 90)}`,
    )
  }
  out.push(`\n--- imports (${res.imports.length}) ---`)
  for (const i of res.imports) out.push(`  module=${JSON.stringify(i.module)} path=${JSON.stringify(i.path)}`)
  out.push(`\n--- exports (${res.exports.length}) ---`)
  out.push("  " + res.exports.map((e) => `${e.name}:${e.kind}`).join(", "))
  out.push(`\n--- analyzer errors: ${res.errors.length} ---`)
  t.delete?.()
}

writeFileSync("/home/ishaq2321/bb_tests/hcl/out/fixture-dump.txt", out.join("\n") + "\n")
console.log(out.join("\n"))
