// M59.A7 / dimension 8 (haskell): WHICH pin catches WHICH half of the contract.
//
// `mutate-analyzer.ts` records only the fixture NAME that failed, which cannot
// distinguish "the line pins did their job" from "some unrelated pin tripped".
// This probe applies each dimension-8 transform to the real analyzer's output on
// the lane's fixture and reports, per transform, exactly which of the fixture's
// own constraints break — the evidence the two mutant descriptions cite.
//
// Usage: bun script/m14/tmp/hs-line-mutant-pins.ts [--out file]
import * as fs from "fs"
import * as path from "path"
const ROOT = "/home/ishaq2321/mcp/backbencher-brain"

const HS = path.join(ROOT, "validation/m14/fixtures/haskell/payload-and-complexity.hs")
const EXP = path.join(ROOT, "validation/m14/fixtures/haskell/payload-and-complexity.expectation.json")

// The transforms, verbatim from script/m14/mutate-analyzer.ts (kept inline so the
// probe does not import the mutant runner's whole mutant table).
function edgeLineAbsent(r: any) {
  const rels: any[] = r.relationships ?? []
  if (!rels.some((rel) => rel && "line_number" in rel)) return r
  return {
    ...r,
    relationships: rels.map((rel) => {
      const { line_number, ...rest } = rel
      return rest
    }),
  }
}
function edgeLinePerSet(r: any) {
  const rels: any[] = r.relationships ?? []
  const seen = new Set<string>()
  const out: any[] = []
  for (const rel of rels) {
    const key = `${rel.source}|${rel.type}|${rel.target}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(rel)
  }
  return out.length === rels.length ? r : { ...r, relationships: out }
}

function label(want: any): string {
  const ln = "line_number" in want ? `@${want.line_number}` : ""
  return `${want.type} ${want.source} -> ${want.target}${ln}`
}

async function main() {
  const outIdx = process.argv.indexOf("--out")
  const OUT = outIdx >= 0 ? process.argv[outIdx + 1] : null
  const exp = JSON.parse(fs.readFileSync(EXP, "utf8"))
  const content = fs.readFileSync(HS, "utf8")

  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-haskell.wasm")))
  const mod: any = await import(path.join(ROOT, "src/ast/real-haskell-analyzer"))
  const p = new P()
  p.setLanguage(LANG)
  const res: any = await new mod.RealHaskellAnalyzer().analyze(p.parse(content).rootNode, content, path.basename(HS))

  const has = (rel: any, want: any) =>
    String(rel.type) === String(want.type) &&
    rel.source === want.source &&
    rel.target === want.target &&
    (!("line_number" in want) || rel.line_number === want.line_number)

  const linePins: any[] = (exp.expectRelationships ?? []).filter((w: any) => "line_number" in w)
  const countPins: any[] = exp.expectRelationshipCount ?? []
  const forbidPins: any[] = exp.forbidRelationships ?? []

  const transforms: [string, (r: any) => any][] = [
    ["(clean baseline)", (r) => r],
    ["haskell/edge-line-absent", edgeLineAbsent],
    ["haskell/edge-line-per-set", edgeLinePerSet],
  ]

  const report: any[] = []
  for (const [name, fx] of transforms) {
    const m = fx(res)
    const rels: any[] = m.relationships ?? []
    const failedLines = linePins.filter((w) => !rels.some((r) => has(r, w)))
    const failedCounts = countPins.filter(
      (w) => rels.filter((r) => has(r, { ...w, equals: undefined })).length !== w.equals,
    )
    const trippedForbid = forbidPins.filter((w) => rels.some((r) => has(r, w)))
    const unlined = rels.filter((r) => !(typeof r.line_number === "number" && r.line_number > 0)).length
    report.push({
      transform: name,
      edges: rels.length,
      unlined,
      linePinsTotal: linePins.length,
      linePinsFailed: failedLines.map(label),
      countPinsFailed: failedCounts.map((w: any) => `${label(w)} equals ${w.equals}`),
      forbidPinsTripped: trippedForbid.map(label),
    })
    console.log(
      `${name.padEnd(26)} edges=${String(rels.length).padStart(4)} unlined=${unlined} ` +
        `linePinsFailed=${failedLines.length}/${linePins.length} countPinsFailed=${failedCounts.length}/${countPins.length}`,
    )
    for (const w of failedLines) console.log(`    MISSING  ${label(w)}`)
    for (const w of failedCounts) console.log(`    COUNT    ${label(w)} equals ${w.equals}`)
    if (trippedForbid.length) for (const w of trippedForbid) console.log(`    FORBID   ${label(w)}`)
  }

  if (OUT) {
    fs.mkdirSync(path.dirname(OUT), { recursive: true })
    fs.writeFileSync(
      OUT,
      JSON.stringify(
        {
          schemaVersion: 1,
          kind: "m60-haskell-line-mutant-pins",
          generatedAt: new Date().toISOString(),
          fixture: path.relative(ROOT, HS),
          expectation: path.relative(ROOT, EXP),
          note: "Baseline edges are the fixture-local draw; `unlined` is the count of relationships with no positive line_number. A transform is CAUGHT when any line pin, count pin, or forbid pin breaks — which pin is the point of this artifact, not the fixture name.",
          report,
        },
        null,
        2,
      ) + "\n",
    )
    console.log(`wrote ${OUT}`)
  }
}
main()
