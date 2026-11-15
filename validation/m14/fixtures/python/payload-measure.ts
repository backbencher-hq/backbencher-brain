/**
 * PY-PAYLOAD — this lane's contribution to the graph payload budget, measured.
 *
 * ## Why this exists
 *
 * The ontology workstream: "Payloads and latency are budgeted and measured. `bb_graph`'s
 * un-narrowed `relationshipTypes` default is 2.5–4.8x a filtered one (lodash 487 KiB vs
 * 101 KiB, ripgrep 795 vs 321). Re-run your lane's payload/latency check." And: "More
 * edges means bigger graphs, and the graph surface is budgeted. If an addition regresses
 * a budgeted lane, report the regression — do not quietly re-baseline."
 *
 * So the question is not "is the lane fast" but "what does python put in an un-narrowed
 * graph answer, and by how much would narrowing help". Both are measured here over real
 * corpus through the PRODUCTION entry (`parseFile`), because an answer computed from the
 * analyzer's source or from a hand-written file list would be a number about nothing.
 *
 * ## Two numbers, and why one is not enough
 *
 *   un-narrowed  every relationship the analyzer emits for the file set, serialised the
 *                way the store receives it
 *   narrowed     the same set with a single `relationshipType` kept
 *
 * The ratio is the budget-relevant figure, because it is what a caller who narrows
 * `relationshipTypes` actually saves. Absolute bytes matter less than the ratio, which is
 * why both are printed.
 *
 * ## No edges were added on this branch
 *
 * The `implements` verdict is RULED, so `src/ast/real-python-analyzer.ts` is byte-identical
 * to the branch point (`git diff` on it is empty). Payload therefore cannot have moved,
 * and this script exists to publish the lane's standing figures rather than to witness a
 * change. A payload check that only runs after a change cannot tell you whether the
 * change regressed the budget; it can only tell you afterwards.
 *
 * ## No regex
 *
 * Corpus selection is `endsWith` on extensions; JSON is produced by `JSON.stringify`.
 * Nothing matches source text.
 *
 * Usage:
 *   bun run validation/m14/fixtures/python/payload-measure.ts --files 600
 *   bun run validation/m14/fixtures/python/payload-measure.ts --json
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const PY_CORPUS = path.join(CR, "python-corpus")

const argv = process.argv.slice(2)
const JSON_OUT = argv.includes("--json")
const fi = argv.indexOf("--files")
const LIMIT = fi >= 0 ? Number(argv[fi + 1]) || 0 : 600

function isCheckout(dir: string): boolean {
  try {
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
    return true
  } catch {
    return false
  }
}

function population(): string[] {
  const out: string[] = []
  let names: string[]
  try {
    names = readdirSync(PY_CORPUS).sort()
  } catch {
    return out
  }
  for (const name of names) {
    const dir = path.join(PY_CORPUS, name)
    try {
      if (!statSync(dir).isDirectory() || !isCheckout(dir)) continue
    } catch {
      continue
    }
    let tracked: string[] = []
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
        encoding: "utf8",
        maxBuffer: 512 * 1024 * 1024,
      })
        .split("\0")
        .filter(Boolean)
    } catch {
      continue
    }
    for (const rel of tracked) if (rel.endsWith(".py") || rel.endsWith(".pyi")) out.push(path.join(dir, rel))
  }
  return out
}

const all = population()
if (all.length === 0) {
  console.error(`payload-measure: no corpus under ${PY_CORPUS}`)
  process.exit(2)
}
let sample = all
let sampled = false
if (LIMIT > 0 && all.length > LIMIT) {
  const stride = Math.max(1, Math.floor(all.length / LIMIT))
  sample = []
  for (let i = 0; i < all.length && sample.length < LIMIT; i += stride) sample.push(all[i])
  sampled = true
}

const { parseFile } = await import(path.join(ROOT, "src", "ast", "pool-worker.ts"))

const ALL_TEN = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"]
const byTypeCount = new Map<string, number>()
const byTypeBytes = new Map<string, number>()
let unNarrowedBytes = 0
let symbolBytes = 0
let symbols = 0
let relationships = 0
let parsed = 0
let failed = 0
let degraded = 0
const t0 = Date.now()

for (const f of sample) {
  try {
    const r: any = await parseFile(f, path.dirname(f))
    if (!r) {
      failed++
      continue
    }
    parsed++
    if (r.fallback === true) degraded++
    const rels = Array.isArray(r.relationships) ? r.relationships : []
    const syms = Array.isArray(r.symbols) ? r.symbols : []
    symbols += syms.length
    relationships += rels.length
    symbolBytes += Buffer.byteLength(JSON.stringify(syms))
    unNarrowedBytes += Buffer.byteLength(JSON.stringify(rels))
    for (const e of rels) {
      const t = String(e?.type ?? e?.relationshipType ?? "(empty)")
      byTypeCount.set(t, (byTypeCount.get(t) ?? 0) + 1)
      byTypeBytes.set(t, (byTypeBytes.get(t) ?? 0) + Buffer.byteLength(JSON.stringify(e)))
    }
  } catch {
    failed++
  }
}
const elapsedMs = Date.now() - t0

const perType = ALL_TEN.map((t) => ({
  type: t,
  edges: byTypeCount.get(t) ?? 0,
  bytes: byTypeBytes.get(t) ?? 0,
  share: unNarrowedBytes ? ((byTypeBytes.get(t) ?? 0) / unNarrowedBytes) * 100 : 0,
})).sort((a, b) => b.bytes - a.bytes)

// The narrowing comparison: keep ONE type, which is what a caller filtering
// `relationshipTypes` gets.
const narrowed = perType.map((p) => ({ type: p.type, bytes: p.bytes, ratio: p.bytes ? unNarrowedBytes / p.bytes : 0 })).sort(
  (a, b) => b.ratio - a.ratio,
)
const biggest = narrowed[0]

const out = {
  corpusRoot: PY_CORPUS,
  populationTracked: all.length,
  sample: sample.length,
  sampleLimited: sampled,
  parsed,
  failed,
  degraded,
  symbols,
  relationships,
  elapsedMs,
  msPerFile: parsed ? elapsedMs / parsed : 0,
  symbolBytes,
  relationshipBytesUnnarrowed: unNarrowedBytes,
  perType,
  narrowing: narrowed,
}

if (JSON_OUT) {
  console.log(JSON.stringify(out, null, 1))
} else {
  const pad = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
  const kib = (b: number) => `${(b / 1024).toFixed(1)} KiB`
  console.log(`python payload measurement`)
  console.log(`corpus root:   ${PY_CORPUS}`)
  console.log(`POPULATION:    ${all.length} tracked .py/.pyi`)
  console.log(`SAMPLE:        ${sample.length}${sampled ? ` (stride-limited from ${all.length})` : " (the whole population)"}  parsed ${parsed}  unread ${failed}  degraded ${degraded}`)
  console.log(`symbols:       ${symbols}  (${kib(symbolBytes)})`)
  console.log(`relationships: ${relationships}  un-narrowed ${kib(unNarrowedBytes)}`)
  console.log(`elapsed:       ${elapsedMs} ms  (${(parsed ? (elapsedMs / parsed).toFixed(1) : "0")} ms/file, sequential, production parseFile)\n`)
  console.log(`${pad("type", 14)}${pad("edges", 9)}${pad("bytes", 12)}${pad("share", 8)}un-narrowed / this type only`)
  console.log("-".repeat(72))
  for (const p of perType) {
    const ratio = p.bytes ? (unNarrowedBytes / p.bytes).toFixed(1) : "-"
    console.log(`${pad(p.type, 14)}${pad(String(p.edges), 9)}${pad(kib(p.bytes), 12)}${pad(`${p.share.toFixed(1)}%`, 8)}${ratio}x`)
  }
  console.log(`\nwidest single-type narrowing: ${biggest.type} at ${biggest.ratio.toFixed(1)}x`)
  console.log(`No edges were added on this branch (implements is RULED and the analyzer is`)
  console.log(`unchanged), so these are standing figures rather than a before/after pair.`)
}