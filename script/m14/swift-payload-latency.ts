/**
 * SWIFT LANE PAYLOAD / LATENCY CHECK — the measurement the ontology workstream
 * requires after a lane adds edges.
 *
 * WHY IT EXISTS. `docs/analyzers/ONTOLOGY-WORKSTREAM.md` Part 2: bb_graph's
 * un-narrowed `relationshipTypes` default is EVERY kind the index stores, and a
 * hub symbol's default answer is measured at 2.5-4.8x a filtered one (lodash
 * 487 KiB vs 101 KiB, ripgrep 795 vs 321). A lane that adds a kind therefore adds
 * to that un-narrowed answer, and the rule is explicit: if the addition
 * REGRESSES a green budget, REPORT it — do not quietly re-baseline.
 *
 * So this measures four numbers, before and after, on the same corpus:
 *
 *   1. EDGES PER FILE, per relationship type. The new kinds' share of the total
 *      is the direct statement of how much they add to an un-narrowed answer.
 *   2. SERIALIZED BYTES of one file's full relationship array. This is the
 *      quantity bb_graph's payload is made of (every row rendered).
 *   3. EDGES OF THE BUSIEST SYMBOL at depth 1 — the hub answer, with the
 *      un-narrowed type set and with each type filtered out in turn.
 *   4. PARSE LATENCY per file, and the analyzer's own complexity, so a
 *      regression in cost is separable from a regression in output.
 *
 * MEASURES THE ANALYZER THAT IS ON DISK, AND SAYS WHICH ONE BY CONTENT.
 *
 * The first version of this script took the analyzer source as an argument,
 * compiled it, and then measured through `parseFile` — which resolves the
 * analyzer the ENGINE registered, not the one that had just been compiled. It
 * therefore reported byte-identical numbers for the before and after analyzer,
 * which is how the flaw was found: a payload measurement whose two halves are
 * equal is either a language that changed nothing or a measurement that
 * measured nothing. There is no second instrument here; the analyzer on disk IS
 * the subject, and `git hash-object` of that file is printed so the two runs of
 * a before/after pair cannot be mistaken for one another.
 *
 *   bun script/m14/swift-payload-latency.ts <label>
 *
 * Writes validation/m14/tmp/swift-payload-<label>.json. Reads nothing else,
 * writes nothing else, and asserts no threshold: the comparison is the reader's,
 * because a gate that only passes when the lane likes the number is not a gate.
 *
 * LATENCY IS ONLY COMPARABLE ON A QUIET MACHINE. This script does not serialise
 * the corpus against other work; a concurrent census or differential sweep on
 * the same box moved the per-file figure by 10% between two runs of identical
 * code. Compare latency only from runs taken back to back with nothing else
 * running, and treat a single number here as an order of magnitude, not a
 * measurement.
 */
import { readFileSync, writeFileSync, statSync } from "node:fs"
import { execFileSync } from "node:child_process"
import * as path from "node:path"

const LABEL = process.argv[2]
if (!LABEL) {
  console.error("usage: swift-payload-latency.ts <label>")
  process.exit(2)
}
const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"

const SRC = path.join(process.cwd(), "src/ast/real-swift-analyzer.ts")
const srcText = readFileSync(SRC, "utf8")
// Identify the subject by CONTENT. A before/after pair is only meaningful if the
// two analyzer texts actually differ, and this is what makes that checkable
// rather than a claim in a commit message.
const analyzerSha = execFileSync("git", ["hash-object", SRC], { encoding: "utf8" }).trim()
console.log(`subject: src/ast/real-swift-analyzer.ts @ blob ${analyzerSha}`)

// --------------------------------------------------------------------------
// CORPUS. Deliberately the two differential corpora at FULL extent, not a
// sample: a payload ratio computed on a 60-file draw is not a payload ratio.
// --------------------------------------------------------------------------
function admitted(repo: string): string[] {
  const dir = path.join(CR, repo)
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch { return [] }
  const out: string[] = []
  for (const rel of tracked) {
    if (!rel.endsWith(".swift")) continue
    try { const st = statSync(path.join(dir, rel)); if (st.isFile() && st.size > 0) out.push(rel) } catch { continue }
  }
  return out.sort()
}

const REPOS = ["swift-nio", "alamofire"]
const files: Array<{ repo: string; abs: string; dir: string; rel: string }> = []
for (const repo of REPOS) for (const rel of admitted(repo)) files.push({ repo, abs: path.join(CR, repo, rel), dir: path.join(CR, repo), rel })

// The PRODUCTION entry. This resolves the analyzer the engine registered, which
// is the file hashed above — the whole point of the measurement.
const { parseFile } = await import("../../src/ast/pool-worker")

const ALL_TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"]
const perType = new Map<string, number>()
let filesSeen = 0
let totalRels = 0
let totalBytes = 0
let relBytesPerFile: number[] = []
let totalMs = 0
let symbols = 0
// Hub accounting: edges incident to a symbol, per type. A symbol's id in the
// graph is the parallel-indexer's `${fileId}:${name}:${line}`, so both the bare
// name and the qualified `Owner.name` spelling are counted — the same two forms
// the indexer's `endsWith` fallbacks accept.
const hubEdges = new Map<string, { total: number; byType: Map<string, number> }>()
const symbolNames = new Map<string, number>()

const workers = 6
let idx = 0
async function worker(): Promise<void> {
  while (true) {
    const i = idx++
    if (i >= files.length) return
    const f = files[i]
    let r: any
    const t0 = Date.now()
    try { r = await parseFile(f.abs, f.dir) } catch { continue }
    totalMs += Date.now() - t0
    if (r.fallback) continue
    filesSeen++
    symbols += (r.symbols ?? []).length
    const rels = r.relationships ?? []
    totalRels += rels.length
    const bytes = Buffer.byteLength(JSON.stringify(rels))
    totalBytes += bytes
    relBytesPerFile.push(bytes)
    for (const x of rels) {
      const t = String(x.type ?? x.relationshipType ?? "")
      if (!ALL_TYPES.includes(t)) continue
      perType.set(t, (perType.get(t) ?? 0) + 1)
      const src = String(x.source ?? "")
      const tgt = String(x.target ?? "")
      for (const side of [src, tgt]) {
        if (!side || side === "root") continue
        const leaf = side.split(".").pop() ?? side
        for (const key of new Set([side, leaf])) {
          let h = hubEdges.get(key)
          if (!h) { h = { total: 0, byType: new Map() }; hubEdges.set(key, h) }
          h.total++
          h.byType.set(t, (h.byType.get(t) ?? 0) + 1)
        }
      }
    }
    for (const s of r.symbols ?? []) symbolNames.set(String(s.name ?? ""), (symbolNames.get(String(s.name ?? "")) ?? 0) + 1)
  }
}
await Promise.all(Array.from({ length: workers }, () => worker()))

// The hub answer bb_graph's un-narrowed default would return: the symbol with
// the most incident edges. Reported with the un-narrowed type set and once per
// type removed, so the reader can see which kind the default is actually made of.
const hubs = [...hubEdges.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 5)
const hubRows = hubs.map(([name, h]) => ({
  symbol: name,
  unNarrowedEdges: h.total,
  byType: Object.fromEntries([...h.byType.entries()].sort((a, b) => b[1] - a[1])),
  narrowedByRemovingEachType: Object.fromEntries(
    [...h.byType.keys()].sort().map((t) => [t, h.total - (h.byType.get(t) ?? 0)]),
  ),
  declaredInCorpusFiles: symbolNames.get(name) ?? 0,
}))

const sorted = [...relBytesPerFile].sort((a, b) => a - b)
const pct = (p: number) => (sorted.length > 0 ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : 0)

const out = {
  at: new Date().toISOString(),
  label: LABEL,
  analyzerSource: SRC,
  analyzerBlobSha: analyzerSha,
  analyzerLines: srcText.split("\n").length,
  corpus: REPOS.map((r) => ({ repo: r, files: admitted(r).length })),
  filesMeasured: filesSeen,
  symbols,
  relationships: totalRels,
  relationshipsPerFile: filesSeen > 0 ? +(totalRels / filesSeen).toFixed(2) : null,
  serializedRelationshipBytes: totalBytes,
  serializedBytesPerFile: filesSeen > 0 ? +(totalBytes / filesSeen).toFixed(1) : null,
  bytesPerFileP50: pct(0.5),
  bytesPerFileP95: pct(0.95),
  bytesPerFileMax: sorted.length > 0 ? sorted[sorted.length - 1] : 0,
  perTypeEdges: Object.fromEntries(ALL_TYPES.map((t) => [t, perType.get(t) ?? 0]).filter(([, n]) => (n as number) > 0)),
  perTypeSharePct: Object.fromEntries(ALL_TYPES.map((t) => [t, perType.has(t) ? +(100 * (perType.get(t)!) / totalRels).toFixed(2) : 0])),
  parseLatency: { totalMs, avgMsPerFile: filesSeen > 0 ? +(totalMs / filesSeen).toFixed(1) : null },
  hubAnswers: hubRows,
}
writeFileSync(`validation/m14/tmp/swift-payload-${LABEL}.json`, JSON.stringify(out, null, 2))
console.log(`swift payload/latency [${LABEL}] analyzer blob ${analyzerSha} (${out.analyzerLines} lines)`)
console.log(`  corpus ${filesSeen} files · ${symbols.toLocaleString()} symbols · ${totalRels.toLocaleString()} relationships (${out.relationshipsPerFile}/file)`)
console.log(`  serialized relationship bytes/file: mean ${out.serializedBytesPerFile} · p50 ${out.bytesPerFileP50} · p95 ${out.bytesPerFileP95} · max ${out.bytesPerFileMax}`)
console.log(`  parse latency: ${out.parseLatency.avgMsPerFile} ms/file`)
console.log(`  per-type edges: ${JSON.stringify(out.perTypeEdges)}`)
console.log(`  per-type share%: ${JSON.stringify(out.perTypeSharePct)}`)
console.log(`  busiest symbols (un-narrowed edges): ${hubRows.map((h) => `${h.symbol}=${h.unNarrowedEdges}`).join(", ")}`)
console.log(`wrote validation/m14/tmp/swift-payload-${LABEL}.json`)