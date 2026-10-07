/**
 * KOTLIN PAYLOAD / LATENCY CHECK — the lane's own measurement of what the two
 * new relationship types cost, run because docs/analyzers/ONTOLOGY-WORKSTREAM.md
 * §"Adding edges is not free downstream" requires it and forbids quietly
 * re-baselining a green budget.
 *
 * THE QUESTION. `bb_graph`'s un-narrowed `relationshipTypes` default returns
 * EVERY type a lane emits — measured by `script/m60/rel-type-coverage-gate.ts`
 * check 2 as "traversal default 10 of 10", so both new labels are inside the
 * default and both land in an unfiltered answer. The workstream's own figures for
 * that are 2.5–4.8x a filtered answer (lodash 487 KiB vs 101 KiB, ripgrep 795 vs
 * 321). This file asks the same question of the kotlin lane with numbers.
 *
 * WHAT IS MEASURED, per type, on the SAME file set through production parseFile:
 *
 *   EDGES         the count, so the growth attributable to each type is a number
 *   BYTES         the serialized size of the edge array ALONE and of the whole
 *                 ParseResult, because "4,470 more edges" says nothing about a
 *                 payload until it is in bytes
 *   SHARE         each type's fraction of the total relationship bytes — the
 *                 number a consumer of an un-narrowed answer actually pays
 *   NARROWED      the same graph with `imports`/`exports` removed, i.e. what the
 *                 answer looked like before this wave, so the ratio is measured
 *                 rather than quoted from another lane
 *   LATENCY       wall time for the full parse at the file count, because a
 *                 payload regression that costs a second per 400 files is a
 *                 different fact from one that costs none
 *
 * A green budget that regresses is REPORTED here, not re-baselined: the ratio
 * numbers are printed with both operands so a reader can check them.
 *
 * CLI: npx tsx script/m14/kotlin-payload-latency.ts [--sample N] [--out f.json]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { parseFile } from "../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const ALL_TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"] as const
type Type = (typeof ALL_TYPES)[number]

function argOf(flag: string, dflt?: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : dflt
}
const REPOS = (argOf("--repo", "kotlin") ?? "kotlin").split(",").map((s) => s.trim()).filter(Boolean)
const SAMPLE = parseInt(argOf("--sample", "600") ?? "600")
const OUT = argOf("--out")
const WARM = parseInt(argOf("--warm", "0") ?? "0")

const files: { repo: string; dir: string; rel: string; abs: string }[] = []
for (const e of readdirSync(CR)) {
  if (!REPOS.includes(e)) continue
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let size: number
    try { size = statSync(abs).size } catch { continue }
    if (size > 512 * 1024) continue
    if (detectLanguageFromPath(abs) !== "kotlin") continue
    files.push({ repo: e, dir, rel, abs })
  }
}
files.sort((a, b) => (a.repo + "/" + a.rel < b.repo + "/" + b.rel ? -1 : 1))
const admitted = SAMPLE > 0 ? files.slice(0, SAMPLE) : files

const perType = new Map<Type, { edges: number; bytes: number }>()
const bump = (t: Type, n: number, b: number) => {
  const row = perType.get(t) ?? { edges: 0, bytes: 0 }
  row.edges += n
  row.bytes += b
  perType.set(t, row)
}
let totalEdges = 0
let totalEdgeBytes = 0
let totalResultBytes = 0
let symbols = 0
let parsed = 0
let threw = 0
const kept: any[][] = []

const t0 = Date.now()
let idx = 0
async function worker(): Promise<void> {
  while (true) {
    const i = idx++
    if (i >= admitted.length) return
    const f = admitted[i]
    let r: any
    try { r = await parseFile(f.abs, f.dir) } catch { threw++; continue }
    parsed++
    symbols += (r.symbols ?? []).length
    const rels: any[] = r.relationships ?? []
    totalEdges += rels.length
    const edgeBytes = Buffer.byteLength(JSON.stringify(rels))
    totalEdgeBytes += edgeBytes
    totalResultBytes += Buffer.byteLength(JSON.stringify({ symbols: r.symbols, relationships: rels, imports: r.imports, exports: r.exports }))
    for (const t of ALL_TYPES) {
      const mine = rels.filter((x) => String(x.type ?? x.relationshipType ?? "") === t)
      if (mine.length) bump(t, mine.length, Buffer.byteLength(JSON.stringify(mine)))
    }
    if (kept.length < 400) kept.push(rels)
  }
}
await Promise.all(Array.from({ length: 8 }, () => worker()))
const wallMs = Date.now() - t0

// LATENCY: a second pass over the SAME files, so the number excludes corpus
// enumeration and the wasm cold start and is comparable to a rerun of this file.
let warmMs = 0
if (WARM > 0) {
  const w0 = Date.now()
  let j = 0
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (true) {
      const i = j++
      if (i >= WARM) return
      try { await parseFile(admitted[i].abs, admitted[i].dir) } catch { /* counted above */ }
    }
  }))
  warmMs = Date.now() - w0
}

// The NARROWED answer: the same edges with the two new labels removed, which is
// what an un-narrowed bb_graph answer cost before this wave.
const flat = kept.flat()
const narrowed = flat.filter((x) => String(x.type ?? "") !== "imports" && String(x.type ?? "") !== "exports")
const narrowedBytes = Buffer.byteLength(JSON.stringify(narrowed))
const allBytes = Buffer.byteLength(JSON.stringify(flat))

const out: any = {
  lane: "kotlin",
  instrument: "script/m14/kotlin-payload-latency.ts",
  repos: REPOS,
  files: admitted.length,
  parsed,
  threw,
  symbols,
  relationships: totalEdges,
  relationship_bytes: totalEdgeBytes,
  whole_result_bytes: totalResultBytes,
  per_type: Object.fromEntries([...perType.entries()].map(([t, r]) => [t, { edges: r.edges, bytes: r.bytes, pct_of_edge_bytes: +((r.bytes / totalEdgeBytes) * 100).toFixed(2) }])),
  narrowed_vs_unnarrowed: {
    note: "measured on a 400-file slice of the same run; the ratio is the kotlin lane's own number for the workstream's lodash/ripgrep 2.5-4.8x claim",
    unnarrowed_edges: flat.length,
    unnarrowed_bytes: allBytes,
    narrowed_edges: narrowed.length,
    narrowed_bytes: narrowedBytes,
    ratio: +((allBytes / Math.max(1, narrowedBytes))).toFixed(3),
    added_by_the_two_new_labels: { edges: flat.length - narrowed.length, bytes: allBytes - narrowedBytes },
  },
  latency: { cold_sweep_wall_ms: wallMs, ms_per_file: +(wallMs / Math.max(1, parsed)).toFixed(2), relationships_per_s: Math.round(totalEdges / (wallMs / 1000)), warm_first_n_files: WARM, warm_wall_ms: warmMs },
}
const p = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
console.log(`kotlin payload/latency — ${parsed}/${admitted.length} files, ${symbols.toLocaleString()} symbols, ${totalEdges.toLocaleString()} relationships, ${threw} threw\n`)
console.log(`${p("type", 14)}${p("edges", 10)}${p("bytes", 12)}${p("% of rel bytes", 16)}`)
console.log("-".repeat(52))
for (const t of ALL_TYPES) {
  const r = perType.get(t)
  if (!r) { console.log(`${p(t, 14)}${"0"}`); continue }
  console.log(`${p(t, 14)}${p(r.edges.toLocaleString(), 10)}${p(r.bytes.toLocaleString(), 12)}${p(((r.bytes / totalEdgeBytes) * 100).toFixed(2) + "%", 16)}`)
}
console.log("-".repeat(52))
console.log(`relationship bytes ${(totalEdgeBytes / 1024).toFixed(1)} KiB · whole ParseResult ${(totalResultBytes / 1024 / 1024).toFixed(2)} MiB`)
console.log(`\nun-narrowed vs narrowed (${out.narrowed_vs_unnarrowed.unnarrowed_edges} edges):`)
console.log(`  un-narrowed ${(allBytes / 1024).toFixed(1)} KiB   narrowed ${(narrowedBytes / 1024).toFixed(1)} KiB   ratio ${out.narrowed_vs_unnarrowed.ratio}x`)
console.log(`  the two new labels add ${out.narrowed_vs_unnarrowed.added_by_the_two_new_labels.edges} edges / ${(out.narrowed_vs_unnarrowed.added_by_the_two_new_labels.bytes / 1024).toFixed(1)} KiB`)
console.log(`\nlatency: cold sweep ${wallMs} ms over ${parsed} files = ${out.latency.ms_per_file} ms/file, ${out.latency.relationships_per_s.toLocaleString()} relationships/s${WARM ? `; warm ${warmMs} ms over ${WARM} files` : ""}`)
if (OUT) { writeFileSync(OUT, JSON.stringify(out, null, 1)); console.log(`\nwrote ${OUT}`) }