// THE OVERLAP QUESTION: if `exports` were emitted over the FS-D8 surface, would it be a
// SECOND NAME FOR `contains` or a distinct adjacency?
//
// For every export-payload entry, find its symbol, spell the pair the way this lane spells
// relationships (source = the owner's published fqn when the file has one, else the bare
// owner name; target = the symbol's fqn), and test it against the `contains` pairs the same
// analyzer emitted for the same file. Both spellings come from the analyzer's own output, so
// this is a reading of the lane, not a second model of it.
//
// Run: bun .tmp-probe/fsharp-lane/fs-exports-overlap.mts [maxFiles]
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const REPO = "/home/ishaq2321/mcp/backbencher-brain"
const CORPUS = process.env.FS_CORPUS || "/home/ishaq2321/bb_tests/repositories/fsharp"
const MAXFILES = Number(process.argv[2] || process.env.NFILES || 0)
const CAP = 512 * 1024

const { getParser } = await import(`${REPO}/src/ast/engine.ts`)
const { RealFsharpAnalyzer } = await import(`${REPO}/src/ast/real-fsharp-analyzer.ts`)

function walk(dir, out) {
  let ents
  try { ents = readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of ents.sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.name === ".git" || e.name === "node_modules") continue
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.(fs|fsi|fsx)$/.test(e.name)) { try { if (statSync(p).size <= CAP) out.push(p) } catch {} }
  }
  return out
}
const all = walk(CORPUS, [])
const files = MAXFILES > 0 ? all.filter((_, i) => i % Math.ceil(all.length / MAXFILES) === 0).slice(0, MAXFILES) : all
const parser = await getParser("fsharp")
const analyzer = new RealFsharpAnalyzer()

const tally = { entries: 0, mapped: 0, containsPair: 0, noContainsPair: 0, ownerlessUnit: 0, noOwnerAndNoPair: 0, noSymbol: 0 }
const missing = []
const ownerlessSamples = []
let containsPairs = 0

for (const f of files) {
  const content = readFileSync(f, "utf8")
  let root
  try { root = (await parser.parse(content, f)).rootNode } catch { continue }
  const res = analyzer.analyze(root, content, f)
  const rels = res.relationships ?? []
  const contains = new Set(rels.filter((r) => (r.type ?? r.relationshipType) === "contains").map((r) => `${r.source}\u0000${r.target}`))
  containsPairs += contains.size
  const syms = res.symbols ?? []
  const byLine = new Map()
  for (const s of syms) { const k = `${s.name}@${s.range?.startLine}`; if (!byLine.has(k)) byLine.set(k, s) }
  const fqnByName = new Map()
  for (const s of syms) {
    const fqn = typeof s.metadata?.fqn === "string" ? s.metadata.fqn : s.name
    const prev = fqnByName.get(s.name)
    if (prev === undefined) fqnByName.set(s.name, fqn)
    else if (prev !== fqn) fqnByName.set(s.name, null)
  }
  for (const e of res.exports ?? []) {
    tally.entries++
    const s = byLine.get(`${e.name}@${e.range?.startLine}`)
    if (!s) { tally.noSymbol++; continue }
    tally.mapped++
    const childFqn = typeof s.metadata?.fqn === "string" ? s.metadata.fqn : s.name
    const owner = s.ownerName || s.scope
    if (!owner) {
      tally.ownerlessUnit++
      if (ownerlessSamples.length < 10) ownerlessSamples.push({ file: f.slice(CORPUS.length + 1), name: e.name, kind: e.kind })
      continue
    }
    const parentFqn = fqnByName.get(String(owner)) || String(owner)
    if (contains.has(`${parentFqn}\u0000${childFqn}`)) tally.containsPair++
    else {
      tally.noContainsPair++
      if (missing.length < 20) missing.push({ file: f.slice(CORPUS.length + 1), name: e.name, kind: e.kind, pair: `${parentFqn} -> ${childFqn}` })
    }
  }
}

const out = {
  corpus: CORPUS, filesMeasured: files.length,
  containsPairsEmitted: containsPairs,
  ...tally,
  overlapPctOfMappedOwned: +((100 * tally.containsPair) / Math.max(1, tally.containsPair + tally.noContainsPair)).toFixed(2),
  overlapPctOfAllEntries: +((100 * tally.containsPair) / Math.max(1, tally.entries)).toFixed(2),
  examplesWithNoContainsPair: missing,
  examplesOwnerlessUnits: ownerlessSamples,
}
writeFileSync(`${REPO}/.tmp-probe/fsharp-lane/fs-exports-overlap.json`, JSON.stringify(out, null, 2))
console.log(JSON.stringify(out, null, 2))
