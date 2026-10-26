/**
 * PERL ONTOLOGY-FIXTURE DIVERGENCE PROBE — what the analyzer EMITS today on each
 * of the eight red ontology fixtures, row by row, against what the fixture
 * expects.
 *
 * The (a)/(b) decision per fixture needs the analyzer's own output as evidence,
 * not the fixture's prose. This probe runs the PRODUCTION parse path
 * (engine.getParser -> analyzer.analyze) over each fixture source and prints
 * every emitted relationship with full metadata, beside the fixture's expected
 * rows, so each divergence is a named pair rather than a count.
 *
 * NO REGEX. Usage:
 *   bun script/m14/perl-fixture-divergence.mts [fixture-name...]
 */
import { readFileSync, readdirSync } from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve(import.meta.dir, "..", "..")
const FIX = path.join(ROOT, "validation", "m14", "fixtures", "perl")

const names = process.argv.slice(2).length ? process.argv.slice(2) : readdirSync(FIX).filter((f) => f.startsWith("ontology-") && f.endsWith(".pm")).map((f) => f.replace(/\.pm$/, ""))

const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
const { RealPerlAnalyzer } = await import(path.join(ROOT, "src/ast/real-perl-analyzer.ts"))
const parser = await (ASTEngine as any).getParser("perl")
const analyzer = new RealPerlAnalyzer()

const fmtMeta = (m: Record<string, unknown> | undefined) => {
  if (!m) return ""
  const keys = Object.keys(m).filter((k) => k !== "perlSpecific")
  if (!keys.length) return ""
  return " meta{" + keys.map((k) => `${k}=${JSON.stringify(m[k])}`).join(" ") + "}"
}

for (const name of names) {
  const src = readFileSync(path.join(FIX, `${name}.pm`), "utf8")
  const exp = JSON.parse(readFileSync(path.join(FIX, `${name}.expectation.json`), "utf8"))
  const tree = parser.parse(src)
  const result = (analyzer as any).analyze(tree.rootNode, src, `${name}.pm`, {})
  const rels = result.relationships ?? []
  console.log(`\n===== ${name} =====`)
  console.log(`EMITTED (${rels.length} relationships):`)
  for (const r of rels) {
    console.log(`  ${r.type} ${r.source} -> ${r.target} @${(r as any).line_number ?? "?"} conf=${r.confidence}${fmtMeta(r.metadata as any)}`)
  }
  const expected = exp.expectRelationships ?? []
  console.log(`EXPECTED (${expected.length} rows):`)
  for (const r of expected) {
    console.log(`  ${r.type} ${r.from ?? r.source} -> ${r.target} @${r.line_number ?? "?"} conf=${r.confidenceMin ?? r.confidence ?? "-"}${fmtMeta(r.meta)}`)
  }
  const forb = exp.expectForbiddenRelationships ?? []
  if (forb.length) {
    console.log(`FORBIDDEN (${forb.length}):`)
    for (const r of forb) console.log(`  ${r.type} ${r.from ?? "?"} -> ${r.target ?? "?"}`)
  }
  const syms = exp.expectSymbols ?? []
  if (syms.length) {
    const got = new Map<string, string>((result.symbols ?? []).map((s: any) => [`${s.name}|${s.kind}${s.ownerName ? "@" + s.ownerName : ""}`, "got"]))
    console.log(`SYMBOLS expected (${syms.length}):`)
    for (const s of syms) console.log(`  ${got.has(`${s.name}|${s.kind}${s.ownerName ? "@" + s.ownerName : ""}`) ? "ok  " : "MISS"} ${s.kind} ${s.name}${s.ownerName ? " @ " + s.ownerName : ""}`)
  }
}
