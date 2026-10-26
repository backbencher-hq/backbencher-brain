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
  // Row verdict: a fixture row fails for exactly one of two reasons, and the
  // difference decides whether the ANALYZER owes work or the FIXTURE is stale.
  //   MISSING   no emitted edge matches type + from + target at all
  //   META-DIFF an edge matches type + from + target, but a metadata/confidence
  //             key differs — printed with the key so it is one row, not a guess
  //   MATCHED   the row matches in full
  const actual = rels.map((r: any) => ({
    type: String(r.type),
    from: String(r.source),
    target: String(r.target),
    line_number: r.line_number,
    confidence: r.confidence,
    metadata: r.metadata ?? {},
  }))
  const metaVal = (a: any, k: string) => (k.startsWith("meta.") ? (a.metadata ?? {})[k.slice(5)] : a[k])
  const rowVerdict = (want: any): string => {
    const shape = actual.filter((a) => a.type === want.type && a.from === (want.from ?? a.from) && a.target === want.target)
    if (shape.length === 0) return "MISSING"
    for (const a of shape) {
      let differs: string | undefined
      for (const [k, v] of Object.entries(want)) {
        if (k === "note" || k === "comment" || k === "confidenceMin" || k === "confidenceMax") continue
        if (k === "line_number" && v === null) { if (a.line_number != null) differs = `line_number:${a.line_number}!=null`; continue }
        const av = metaVal(a, k)
        if (Array.isArray(v)) { if (stableJson(av) !== stableJson(v)) differs = `${k}:${stableJson(av)}!=${stableJson(v)}`; continue }
        if (av !== v) differs = `${k}:${String(av)}!=${String(v)}`
        if (differs) break
      }
      if (want.confidenceMin !== undefined && a.confidence < want.confidenceMin) differs = `confidence:${a.confidence}<${want.confidenceMin}`
      if (want.confidenceMax !== undefined && a.confidence > want.confidenceMax) differs = `confidence:${a.confidence}>${want.confidenceMax}`
      if (!differs) return "MATCHED"
    }
    return "META-DIFF"
  }
  const stableJson = (v: any): string => JSON.stringify(v)
  console.log(`ROW VERDICTS:`)
  for (const r of expected) {
    const v = rowVerdict(r)
    console.log(`  ${v} ${r.type} ${r.from ?? r.source} -> ${r.target}@${r.line_number ?? "?"}${v === "META-DIFF" ? explainDiff(r) : ""}`)
  }
  function explainDiff(want: any): string {
    const out: string[] = []
    for (const a of actual.filter((x) => x.type === want.type && x.from === (want.from ?? x.from) && x.target === want.target)) {
      for (const [k, v] of Object.entries(want)) {
        if (k === "note" || k === "comment" || k === "confidenceMin" || k === "confidenceMax") continue
        const av = metaVal(a, k)
        if (av !== v && !Array.isArray(v)) out.push(`${k}: emitted=${JSON.stringify(av)} want=${JSON.stringify(v)}`)
      }
      if (out.length) break
    }
    return out.length ? " {" + out.join("; ") + "}" : ""
  }
  const forb = exp.expectForbiddenRelationships ?? []
  if (forb.length) {
    console.log(`FORBIDDEN (${forb.length}):`)
    for (const r of forb) {
      const hit = actual.find((a) => a.type === r.type && (r.from === undefined || a.from === r.from) && (r.target === undefined || a.target === r.target))
      console.log(`  ${hit ? "VIOLATED" : "clear"} ${r.type} ${r.from ?? "*"} -> ${r.target ?? "*"}`)
    }
  }
  const syms = exp.expectSymbols ?? []
  if (syms.length) {
    const got = new Map<string, string>((result.symbols ?? []).map((s: any) => [`${s.name}|${s.kind}${s.ownerName ? "@" + s.ownerName : ""}`, "got"]))
    console.log(`SYMBOLS expected (${syms.length}):`)
    for (const s of syms) console.log(`  ${got.has(`${s.name}|${s.kind}${s.ownerName ? "@" + s.ownerName : ""}`) ? "ok  " : "MISS"} ${s.kind} ${s.name}${s.ownerName ? " @ " + s.ownerName : ""}`)
  }
}
