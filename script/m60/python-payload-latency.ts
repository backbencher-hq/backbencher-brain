#!/usr/bin/env bun
/**
 * INCOMING_PY — the lane's payload / latency check.
 *
 * WHY THIS INSTRUMENT EXISTS. `docs/analyzers/ONTOLOGY-WORKSTREAM.md`: bb_graph's
 * un-narrowed `relationshipTypes` default is 2.5–4.8x a filtered answer (lodash
 * 487 KiB vs 101 KiB, ripgrep 795 vs 321), so adding edges is not free downstream.
 * "Re-run your lane's payload/latency check. If an addition regresses a green budget,
 * report it — do not quietly re-baseline."
 *
 * WHAT IT MEASURES, over a fixed draw of the pinned corpus:
 *
 *   1. STORED BYTES per relationship label — `JSON.stringify` of the rows the store
 *      would persist. Split by label, so a change that grows one label cannot hide
 *      inside an aggregate.
 *   2. THE HUB ANSWER — for the symbol carrying the most relationships, the answer
 *      size un-narrowed versus `relationshipTypes: ['calls']`. This is the ratio
 *      bb_graph actually exposes, computed from the same rows the store holds rather
 *      than from a second index, and it is the number the workstream quotes.
 *   3. PARSE LATENCY — wall time per file, mean and p95, plus the total, because an
 *      edge that costs a millisecond a file is a latency regression nobody sees in a
 *      byte count.
 *
 * It is a LANE instrument and it writes nothing: run it before and after a change and
 * compare the two JSON files. A regression is reported, not re-baselined.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { parseFile } from "../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const REPO = process.env.BB_PY_REPO ?? "python-codesql"
const LIMIT = Number(process.env.BB_PY_PAYLOAD_FILES ?? 120)
const MAX_BYTES = 512 * 1024

const repoDir = path.join(CR, REPO)
const files: { rel: string; abs: string }[] = []
{
  const tracked = execFileSync("git", ["-C", repoDir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  for (const rel of tracked) {
    const abs = path.join(repoDir, rel)
    try {
      if (statSync(abs).size > MAX_BYTES) continue
      const text = readFileSync(abs, "utf8")
      if (detectLanguageFromPath(abs, text) !== "python") continue
    } catch { continue }
    files.push({ rel, abs })
  }
}
// The largest files first: they carry the most edges, so this draw is where a
// per-edge payload change is measurable at all.
files.sort((a, b) => statSync(b.abs).size - statSync(a.abs).size)
const draw = files.slice(0, LIMIT)

const bytesByLabel = new Map<string, number>()
const edgesByLabel = new Map<string, number>()
let bytesTotal = 0
let edgesTotal = 0
let symBytes = 0
const hub = new Map<string, string[]>()
const times: number[] = []

for (const f of draw) {
  const t0 = performance.now()
  const r: any = await parseFile(f.abs, repoDir)
  times.push(performance.now() - t0)
  const rels: any[] = r.relationships ?? []
  edgesTotal += rels.length
  bytesTotal += Buffer.byteLength(JSON.stringify(rels))
  symBytes += Buffer.byteLength(JSON.stringify(r.symbols ?? []))
  for (const x of rels) {
    const label = String(x.type ?? x.relationshipType ?? "?")
    const b = Buffer.byteLength(JSON.stringify(x))
    bytesByLabel.set(label, (bytesByLabel.get(label) ?? 0) + b)
    edgesByLabel.set(label, (edgesByLabel.get(label) ?? 0) + 1)
    // the hub answer: bb_graph walks BOTH directions from a symbol, so both a row
    // naming it as source and a row naming it as target belong to its answer.
    const s = String(x.source ?? "")
    const t = String(x.target ?? "")
    for (const key of new Set([s, t])) {
      const arr = hub.get(key) ?? []
      arr.push(JSON.stringify(x))
      hub.set(key, arr)
    }
  }
}

let bestKey = ""
let bestRows: string[] = []
for (const [k, v] of hub) if (v.length > bestRows.length) { bestKey = k; bestRows = v }

const labels = [...bytesByLabel.keys()].sort()
const unNarrowed = Buffer.byteLength(JSON.stringify(bestRows))
const callsOnly = Buffer.byteLength(JSON.stringify(bestRows.filter((r) => r.includes('"calls"'))))
const timesSorted = [...times].sort((a, b) => a - b)
const p95 = timesSorted[Math.floor(timesSorted.length * 0.95)] ?? 0
const mean = times.reduce((a, b) => a + b, 0) / (times.length || 1)

const out = {
  corpus: { repo: REPO, files: draw.length, selection: "largest N .py files by byte size" },
  edges: edgesTotal,
  relationshipBytes: bytesTotal,
  symbolBytes: symBytes,
  bytesPerEdge: Number((bytesTotal / (edgesTotal || 1)).toFixed(1)),
  bytesPerRelationshipByLabel: Object.fromEntries(labels.map((l) => [l, { edges: edgesByLabel.get(l)!, bytes: bytesByLabel.get(l)!, bytesPerEdge: Number((bytesByLabel.get(l)! / edgesByLabel.get(l)!)).toFixed(1) }])),
  hubAnswer: { symbol: bestKey, rows: bestRows.length, unNarrowedBytes: unNarrowed, callsOnlyBytes: callsOnly, ratio: Number((callsOnly ? unNarrowed / callsOnly : 0).toFixed(2)) },
  latencyMs: { total: Number(times.reduce((a, b) => a + b, 0).toFixed(1)), mean: Number(mean.toFixed(2)), p95: Number(p95.toFixed(2)), max: Number((timesSorted.at(-1) ?? 0).toFixed(2)) },
}

console.log(`INCOMING_PY payload/latency — ${REPO}, ${draw.length} files`)
console.log(`  edges ${edgesTotal}   relationship bytes ${bytesTotal}   bytes/edge ${out.bytesPerEdge}   symbol bytes ${symBytes}`)
console.log(`  hub answer: symbol ${JSON.stringify(bestKey)} rows ${bestRows.length}  un-narrowed ${unNarrowed} B  calls-only ${callsOnly} B  ratio ${out.hubAnswer.ratio}x`)
console.log(`  latency ms: total ${out.latencyMs.total}  mean ${out.latencyMs.mean}  p95 ${out.latencyMs.p95}  max ${out.latencyMs.max}`)
console.log("  per-label bytes/edge:")
for (const l of labels) console.log(`    ${l.padEnd(13)} ${out.bytesPerRelationshipByLabel[l]!.edges} edges  ${out.bytesPerRelationshipByLabel[l]!.bytesPerEdge} B/edge`)

const at = process.argv.indexOf("--json")
if (at > 0) (await import("node:fs")).writeFileSync(process.argv[at + 1], JSON.stringify(out, null, 2))