// Scoped local identity (M60 functional lane, 2026-09-26): WHICH pin catches
// WHICH half of the contract.
//
// `mutate-analyzer.ts` records only the fixture NAME that failed, which cannot
// distinguish "the scoped pins did their job" from "some unrelated pin tripped".
// This probe applies each scoped-local transform to the real analyzer's output
// on the lane's fixture and reports, per transform, exactly which of the
// fixture's own constraints break — the evidence the two mutant descriptions
// cite.
//
// Usage: bun script/m14/tmp/hs-local-mutant-pins.ts [--out file]
import * as fs from "fs"
import * as path from "path"
const ROOT = "/home/ishaq2321/mcp/backbencher-brain"

const HS = path.join(ROOT, "validation/m14/fixtures/haskell/payload-and-complexity.hs")
const EXP = path.join(ROOT, "validation/m14/fixtures/haskell/payload-and-complexity.expectation.json")

// The transforms, verbatim from script/m14/mutate-analyzer.ts (kept inline so
// the probe does not import the mutant runner's whole mutant table).
function localIdentityFlat(r: any) {
  const rels: any[] = r.relationships ?? []
  const symbolNames = new Set<string>()
  for (const s of r.symbols ?? []) if (s?.name) symbolNames.add(String(s.name))
  let changed = false
  const flat = (name: any) => {
    if (typeof name !== "string") return name
    const dot = name.indexOf(".")
    if (dot <= 0) return name
    if (!symbolNames.has(name.slice(0, dot))) return name
    changed = true
    return name.slice(name.lastIndexOf(".") + 1)
  }
  const out = rels.map((rel) => {
    const source = flat(rel.source)
    const target = flat(rel.target)
    return source === rel.source && target === rel.target ? rel : { ...rel, source, target }
  })
  return changed ? { ...r, relationships: out } : r
}
function localScopeBlind(r: any, source?: string) {
  const rels: any[] = r.relationships ?? []
  if (rels.some((x: any) => String(x.type ?? x.relationshipType) === "calls" && x.source === "outOfScope" && x.target === "hop")) {
    return r
  }
  const lines = String(source ?? "").split("\n")
  let line = 0
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*outOfScope\b[^=]*=\s*hop\b/.test(lines[i])) {
      line = i + 1
      break
    }
  }
  if (!line) return r
  return {
    ...r,
    relationships: [
      ...rels,
      {
        type: "calls",
        source: "outOfScope",
        target: "hop",
        confidence: 0.9,
        line_number: line,
        metadata: { haskellSpecific: true, context: "local function call" },
      },
    ],
  }
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

  const pins: any[] = exp.expectRelationships ?? []
  const countPins: any[] = exp.expectRelationshipCount ?? []
  const forbidPins: any[] = exp.forbidRelationships ?? []

  const transforms: [string, (r: any, source?: string) => any][] = [
    ["(clean baseline)", (r) => r],
    ["haskell/local-identity-flat", (r) => localIdentityFlat(r)],
    ["haskell/local-scope-blind", (r, s) => localScopeBlind(r, s)],
  ]

  const report: any[] = []
  for (const [name, fx] of transforms) {
    const m = fx(res, content)
    const rels: any[] = m.relationships ?? []
    const failedPins = pins.filter((w) => !rels.some((r) => has(r, w)))
    const failedCounts = countPins.filter(
      (w) => rels.filter((r) => has(r, { ...w, equals: undefined })).length !== w.equals,
    )
    const trippedForbid = forbidPins.filter((w) => rels.some((r) => has(r, w)))
    const scopedEndpoints = rels.reduce((a: number, r: any) => {
      const isScoped = (n: any) =>
        typeof n === "string" && n.includes(".") && /^[a-z][A-Za-z0-9_']*\./.test(n) && !n.includes(".lookup")
      return a + (isScoped(r.source) ? 1 : 0) + (isScoped(r.target) ? 1 : 0)
    }, 0)
    report.push({
      transform: name,
      edges: rels.length,
      scopedLocalEndpoints: scopedEndpoints,
      pinsTotal: pins.length,
      pinsFailed: failedPins.map(label),
      countPinsFailed: failedCounts.map((w: any) => `${label(w)} equals ${w.equals}`),
      forbidPinsTripped: trippedForbid.map(label),
    })
    console.log(
      `${name.padEnd(30)} edges=${String(rels.length).padStart(4)} scopedEndpoints=${String(scopedEndpoints).padStart(3)} ` +
        `pinsFailed=${failedPins.length}/${pins.length} countPinsFailed=${failedCounts.length}/${countPins.length} forbidsTripped=${trippedForbid.length}`,
    )
    for (const w of failedPins) console.log(`    MISSING  ${label(w)}`)
    for (const w of failedCounts) console.log(`    COUNT    ${label(w)} equals ${w.equals}`)
    for (const w of trippedForbid) console.log(`    FORBID   ${label(w)}`)
  }

  if (OUT) {
    fs.mkdirSync(path.dirname(OUT), { recursive: true })
    fs.writeFileSync(
      OUT,
      JSON.stringify(
        {
          schemaVersion: 1,
          kind: "m60-haskell-local-mutant-pins",
          generatedAt: new Date().toISOString(),
          fixture: path.relative(ROOT, HS),
          expectation: path.relative(ROOT, EXP),
          note: "Baseline edges are the fixture-local draw. A transform is CAUGHT when any relationship pin, count pin, or forbid pin breaks — which pin is the point of this artifact, not the fixture name. `scopedLocalEndpoints` counts endpoints carrying a lowercase lexical owner chain (`owner.local`), i.e. the scoped identity this round introduced.",
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
