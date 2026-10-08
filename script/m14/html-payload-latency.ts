// HTML_FIX2 — the lane's payload/latency check, before and after a change.
//
// WHY IT EXISTS. The ontology workstream requires the lane to re-run its
// payload/latency check after adding edges and to REPORT a regression rather
// than quietly re-baseline. `bb_graph`'s un-narrowed `relationshipTypes`
// default is measured at 2.5–4.8× a kind-filtered one (lodash 487 KiB vs
// 101 KiB, ripgrep 795 vs 321), so "the graph got bigger" is a real cost and
// the only honest way to talk about it is in bytes.
//
// The html lane's own budget is not gated anywhere: `avgMsPerFile` for html
// lives in `validation/m14/differential-baseline.json`, which only the canonical
// 28-language sweep writes. So this instrument measures it directly and prints
// the POPULATION it measured over, which is the part M14-HONESTY-CONTRACT's
// "an instrument must declare the population it covered" rule exists for — a
// ms/KiB figure with no denominator is not a measurement.
//
// WHAT IT REPORTS, per corpus:
//
//   files / bytes / parsed        the population
//   relationships                 edge COUNT (the graph surface)
//   relMetadataBytes              JSON bytes of every relationship's `metadata`
//                                 object — the payload a graph consumer pays to
//                                 distinguish one edge's provenance from
//                                 another's, which is what the 2026-10-05 seam
//                                 fix spends its bytes on
//   symbolMetadataBytes           the same for symbols
//   ms/KiB                        throughput through the PRODUCTION path
//                                 (ASTEngine.parseFile, parsers pre-warmed)
//   ms/file                       reported alongside, and marked as the
//                                 non-portable unit: html's cost is dominated by
//                                 the delegate sub-parse, not the document walk
//
// USAGE:
//   bun script/m14/html-payload-latency.ts
//   bun script/m14/html-payload-latency.ts vuejs otp
//   BB_MAX_FILES=60 bun script/m14/html-payload-latency.ts      # fixed draw
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const REPO = process.env.BB_REPO || process.cwd()
const CORPUS = process.env.BB_CORPUS || "$HOME/fixtures/repositories"
const MAX_FILES = Number(process.env.BB_MAX_FILES || 0)
const WANT = process.argv.slice(2).filter((a) => !a.startsWith("-"))

const HTML_EXT = [".html", ".htm"]
const MAX_BYTES = 2_000_000

function findHtml(dir: string, out: string[]): void {
  let ents: any[]
  try { ents = readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of ents) {
    if (e.name === "node_modules" || e.name === ".git") continue
    const p = join(dir, e.name)
    if (e.isDirectory()) findHtml(p, out)
    else if (HTML_EXT.some((x) => e.name.endsWith(x))) {
      try { if (statSync(p).size > MAX_BYTES) continue } catch { continue }
      out.push(p)
    }
  }
}

const byCorpus = new Map<string, string[]>()
try {
  for (const e of readdirSync(CORPUS, { withFileTypes: true })) {
    if (!e.isDirectory()) continue
    const files: string[] = []
    findHtml(join(CORPUS, e.name), files)
    if (files.length > 0) byCorpus.set(e.name, files.sort())
  }
} catch { console.error(`no corpus under ${CORPUS}`); process.exit(1) }

const corpora = WANT.length > 0 ? WANT.filter((c) => byCorpus.has(c)) : [...byCorpus.keys()].sort()
if (corpora.length === 0) { console.error(`no requested corpus has html files under ${CORPUS}`); process.exit(1) }

const { ASTEngine } = await import(`${REPO}/src/ast/engine.ts`)
// A census that cannot parse cannot report a cost: the failure mode is a
// zero-cost lane that looks like the fastest one.
try { await ASTEngine.getParser("html") } catch (e) {
  console.error(`REFUSED: getParser("html") failed — ${String(e).slice(0, 140)}`)
  process.exit(2)
}
const htmlParser = await ASTEngine.getParser("html")
// Pre-warm every delegate the seam can reach, so the first file does not pay for
// a grammar load and the measurement is of the walk rather than of module
// resolution. Documented because NOT pre-warming is how a benchmark reports a
// one-off cost as a per-file average.
for (const l of ["javascript", "typescript", "tsx", "css"]) { try { await ASTEngine.getParser(l) } catch {} }

function metaBytes(rows: any[], key: string): number {
  let n = 0
  for (const r of rows) {
    const m = (r as any)?.[key]
    if (!m) continue
    // The stored shape is what JSON.stringify writes, so measure that and not a
    // hand-rolled byte count that could differ from the persistence layer's.
    n += Buffer.byteLength(JSON.stringify(m), "utf8")
  }
  return n
}

interface Row { corpus: string; files: number; parsed: number; bytes: number; rels: number; syms: number; relMeta: number; symMeta: number; exports: number; exportsMeta: number; ms: number }
const rows: Row[] = []

for (const corpus of corpora) {
  const all = byCorpus.get(corpus)!
  const files = MAX_FILES > 0 ? all.slice(0, MAX_FILES) : all
  const row: Row = { corpus, files: files.length, parsed: 0, bytes: 0, rels: 0, syms: 0, relMeta: 0, symMeta: 0, exports: 0, exportsMeta: 0, ms: 0 }
  for (const f of files) {
    let content = ""
    try { content = readFileSync(f, "utf8") } catch { continue }
    // One warm-up parse, discarded, so the wasm heap is in steady state before
    // the first timed call.
    try { (htmlParser as any).parse(content, f)?.delete?.() } catch {}
    const t0 = performance.now()
    let r: any = null
    try { r = await ASTEngine.parseFile(f, content) } catch { continue }
    row.ms += performance.now() - t0
    row.parsed++
    row.bytes += Buffer.byteLength(content, "utf8")
    const rels = r.relationships ?? []
    const syms = r.symbols ?? []
    const exps = r.exports ?? []
    row.rels += rels.length
    row.syms += syms.length
    row.exports += exps.length
    row.relMeta += metaBytes(rels, "metadata")
    row.symMeta += metaBytes(syms, "metadata")
    row.exportsMeta += metaBytes(exps, "metadata")
  }
  rows.push(row)
}

const kib = (b: number) => (b / 1024).toFixed(1)
console.log(`html payload/latency   repo=${REPO}`)
console.log(`corpora: ${corpora.join(", ")}   ${MAX_FILES > 0 ? `BB_MAX_FILES=${MAX_FILES} (a FIXED draw — the draw is part of the population and moving it moves the number)` : "full corpus per corpus dir"}`)
console.log(`method: production ASTEngine.parseFile, delegates pre-warmed, one discarded warm-up parse per file\n`)
console.log(`corpus                 files parsed      KiB    rels     syms   relMetaKiB symMetaKiB expMetaKiB   ms/KiB   ms/file`)
for (const r of rows) {
  const msPerKiB = r.bytes === 0 ? 0 : r.ms / (r.bytes / 1024)
  const msPerFile = r.parsed === 0 ? 0 : r.ms / r.parsed
  console.log(
    `${r.corpus.padEnd(22)}${String(r.files).padStart(5)}${String(r.parsed).padStart(7)}${kib(r.bytes).padStart(8)}${String(r.rels).padStart(8)}${String(r.syms).padStart(8)}` +
    `${kib(r.relMeta).padStart(13)}${kib(r.symMeta).padStart(12)}${kib(r.exportsMeta).padStart(12)}` +
    `${msPerKiB.toFixed(2).padStart(9)}${msPerFile.toFixed(1).padStart(9)}`,
  )
}
const tot = rows.reduce((a, r) => ({
  files: a.files + r.files, parsed: a.parsed + r.parsed, bytes: a.bytes + r.bytes, rels: a.rels + r.rels,
  syms: a.syms + r.syms, relMeta: a.relMeta + r.relMeta, symMeta: a.symMeta + r.symMeta, exports: a.exports + r.exports,
  exportsMeta: a.exportsMeta + r.exportsMeta, ms: a.ms + r.ms,
}), { files: 0, parsed: 0, bytes: 0, rels: 0, syms: 0, relMeta: 0, symMeta: 0, exports: 0, exportsMeta: 0, ms: 0 })
console.log(`${"TOTAL".padEnd(22)}${String(tot.files).padStart(5)}${String(tot.parsed).padStart(7)}${kib(tot.bytes).padStart(8)}${String(tot.rels).padStart(8)}${String(tot.syms).padStart(8)}` +
  `${kib(tot.relMeta).padStart(13)}${kib(tot.symMeta).padStart(12)}${kib(tot.exportsMeta).padStart(12)}` +
  `${(tot.ms / (tot.bytes / 1024)).toFixed(2).padStart(9)}${(tot.ms / Math.max(1, tot.parsed)).toFixed(1).padStart(9)}`)
console.log(`\nPOPULATION: ${tot.parsed} of ${tot.files} enumerated files parsed. Every number above is over that set and no other.`)
console.log(`exports[] rows ${tot.exports} carrying ${kib(tot.exportsMeta)} KiB of metadata.`)
