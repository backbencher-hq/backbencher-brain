/**
 * WHY THE FLEET'S R ROW IN `incoming-whole.tsv` IS OFF BY ONE — measured, not argued.
 *
 * ## The claim being tested
 *
 * `validation/m14/measurements/incoming-whole.tsv` records for `r`:
 *
 *     lane  files  fired  amb  unres
 *     r     21     7      8    190
 *
 * `r-incoming-population.ts --pop lower` walks the same 21 files (it is the population a
 * lower-case `*.r` glob yields; 21 of 2,184 admitted) and reproduces `fired 7` and `amb 8`
 * exactly, and PARITY-OK against `script/m14/incoming-check.ts` run as a child process, and
 * prints `unres 191`. One edge of difference, in the population the fleet row names.
 *
 * The question this file answers is which analyzer build printed 190, because "the fleet row
 * is stale by one edge" and "the fleet row is wrong" are different claims with different
 * owners.
 *
 * ## Why this is a spool diff and not a re-walk
 *
 * The bisect is cheap because both builds' walk results are already on disk. Each population
 * walk appends one JSON line per file to
 * `r-incoming-walk-<corpusDigest12>-<analyzerDigest8>.jsonl` — keyed by BOTH digests, so a
 * spool for a given analyzer build can never be read against another. The corpus digest is
 * the same for both files (the file set did not change); only the analyzer digest differs.
 * Diffing the two spools therefore identifies the edge that separates 190 from 191 WITHOUT
 * re-parsing 21 files per build, which is what made the naive bisect time out.
 *
 * The walk that produced each spool is `npx tsx r-incoming-population.ts --pop lower` with
 * the relevant build of `src/ast/real-r-analyzer.ts` in place:
 *
 *     git show <commit>:src/ast/real-r-analyzer.ts > src/ast/real-r-analyzer.ts
 *     npx tsx validation/m14/fixtures/r/r-incoming-population.ts --pop lower
 *     git checkout -- src/ast/real-r-analyzer.ts      # restore before the next build
 *
 * The spools are gitignored caches (see `.gitignore` in this directory), so a reader who
 * has none should re-walk the two builds named below. This file prints the answer from
 * whatever spools are present, and says which builds it could compare.
 *
 *     npx tsx validation/m14/fixtures/r/r-population-drift.ts
 *
 * ## What a wrong answer would look like
 *
 * If the difference were a corpus change, the two spools would carry different corpus
 * digests and this file would refuse to compare them. If it were a shared-instrument
 * change, `incoming-check.ts` run today would still disagree with the stored number, and
 * PARITY would fail in the parent harness. It does neither: the same child script, run over
 * the same files, prints 191. So the difference is in the ANALYZER, and one edge is named.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs"
import * as path from "node:path"

const DIR = path.resolve(process.cwd(), "validation/m14/fixtures/r")
const argv = process.argv.slice(2)
const only = argv.find((a) => a.startsWith("--only="))?.slice(7)
/** The analyzer build to diff everything else AGAINST. Defaults to the working tree's own
 *  digest, so the printed delta is "what the other builds did differently from HEAD". */
const baseArg = argv.find((a) => a.startsWith("--base="))?.slice(7)
let baseDigest = baseArg
if (!baseDigest) {
  const here = path.resolve(process.cwd(), "src/ast/real-r-analyzer.ts")
  baseDigest = existsSync(here)
    ? (await import("node:crypto")).createHash("sha256").update(readFileSync(here)).digest("hex").slice(0, 8)
    : undefined
}

interface Decl { n: string; k: string; q: string; r: string; f: string }
interface Edge { t: string; s: string; g: string; r: string; f: string }
interface Row { repo: string; decls: Decl[]; edges: Edge[] }

function load(file: string): Map<string, Row> {
  const rows = new Map<string, Row>()
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue
    try {
      const j = JSON.parse(line)
      if (j?.abs) rows.set(String(j.abs), j as Row)
    } catch { /* truncated tail */ }
  }
  return rows
}

const spools = readdirSync(DIR)
  .filter((f) => /^r-incoming-walk-[0-9a-f]{12}-[0-9a-f]{8}\.jsonl$/.test(f))
  .filter((f) => (only ? f.includes(only) : true))
  .sort()
if (!spools.length) {
  console.log(`no walk spools in ${path.relative(process.cwd(), DIR)} — run r-incoming-population.ts first`)
  process.exit(0)
}

const byCorpus = new Map<string, string[]>()
for (const f of spools) {
  const m = /^r-incoming-walk-([0-9a-f]{12})-([0-9a-f]{8})\.jsonl$/.exec(f)!
  const corpus = m![1]
  const list = byCorpus.get(corpus) ?? []
  list.push(f)
  byCorpus.set(corpus, list)
}

const pad = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)

/**
 * THE KEY SEPARATOR, declared once and written as an ESCAPE rather than a raw byte.
 *
 * The escape is the load-bearing part. This file first shipped the separator as nine
 * RAW NUL bytes. They work perfectly at runtime and they make git classify the file as
 * binary: it stops diffing, stops reviewing, and its diff is invisible in a PR. A raw
 * NUL in a committed source file is a defect even when the code is correct. This is the
 * same failure the cause-A counterfactual harness hit, recorded in
 * docs/analyzers/r.md, where a NUL separator was ALSO the right choice.
 *
 * A NUL is still the right separator, because no filesystem path, no R identifier and no
 * relationship type can contain one, so no pair of fields can collide the way bare
 * concatenation lets `ab`+`c` collide with `a`+`bc`. Every construction and every split
 * goes through this one constant, which is what stops the two from drifting: a bare space
 * separator already drifted once, on the line that printed a whole key where a name
 * belonged.
 */
const NULS = "\u0000"

console.log(`r-population-drift — ${spools.length} spool(s), ${byCorpus.size} corpus set(s)`)
console.log("")
for (const [corpus, files] of [...byCorpus.entries()].sort()) {
  console.log(`corpus set ${corpus} — ${files.length} analyzer build(s) walked it`)
  console.log(pad("analyzer", 12) + pad("files", 8) + pad("edges", 9) + pad("symbols", 10) + "spool")
  console.log("-".repeat(96))
  const loaded = new Map<string, Map<string, Row>>()
  for (const f of files) {
    const rows = load(path.join(DIR, f))
    loaded.set(f, rows)
    const edges = [...rows.values()].reduce((a, r) => a + r.edges.length, 0)
    const syms = [...rows.values()].reduce((a, r) => a + r.decls.length, 0)
    console.log(pad(/-([0-9a-f]{8})\.jsonl$/.exec(f)![1], 12) + pad(String(rows.size), 8) + pad(String(edges), 9) + pad(String(syms), 10) + f)
  }
  console.log("-".repeat(96))

  const base = baseDigest
    ? (files.find((f) => f.includes(`-${baseDigest}.jsonl`)) ?? files[0])
    : files[0]
  const rest = files.filter((f) => f !== base)
  console.log(`base ${/-([0-9a-f]{8})\.jsonl$/.exec(base)![1]}${baseDigest && base.includes(`-${baseDigest}.jsonl`) ? " (working tree digest)" : " (no matching spool for the working tree digest; fell back to the first)"}`)
  console.log("")
  if (!rest.length) {
    console.log(`only one build for this corpus set — nothing to diff. Run the fleet row's build too.`)
    console.log("")
    continue
  }
  for (const b of rest) {
    const A = loaded.get(base)!
    const B = loaded.get(b)!
    const ka = (e: Edge) => [e.t, e.s, e.g, e.f].join(NULS)
    const ma = new Map<string, number>(), mb = new Map<string, number>()
    for (const r of A.values()) for (const e of r.edges) ma.set(ka(e), (ma.get(ka(e)) ?? 0) + 1)
    for (const r of B.values()) for (const e of r.edges) mb.set(ka(e), (mb.get(ka(e)) ?? 0) + 1)
    const added = [...mb.keys()].filter((k) => !ma.has(k))
    const removed = [...ma.keys()].filter((k) => !mb.has(k))
    const aE = [...ma.values()].reduce((x, y) => x + y, 0)
    const bE = [...mb.values()].reduce((x, y) => x + y, 0)
    const aS = [...A.values()].reduce((x, r) => x + r.decls.length, 0)
    const bS = [...B.values()].reduce((x, r) => x + r.decls.length, 0)
    const aFiles = A.size, bFiles = B.size
    console.log(`DIFF  ${/-([0-9a-f]{8})\.jsonl$/.exec(base)![1]} -> ${/-([0-9a-f]{8})\.jsonl$/.exec(b)![1]}`)
    console.log(`  files ${aFiles} -> ${bFiles}   edges ${aE} -> ${bE} (net ${bE - aE})   symbols ${aS} -> ${bS} (net ${bS - aS})`)
    if (aFiles !== bFiles) {
      console.log(`  FILE SETS DIFFER by ${Math.abs(aFiles - bFiles)} — this diff is NOT a statement about the analyzer.`)
      console.log("")
      continue
    }
    console.log(`  edge keys added ${added.length}, removed ${removed.length}`)
    for (const k of added) { const [t, s, g, f] = k.split(NULS); console.log(`   + ${t}: ${s} -> ${g}    ${path.basename(f)}`) }
    for (const k of removed.slice(0, 40)) { const [t, s, g, f] = k.split(NULS); console.log(`   - ${t}: ${s} -> ${g}    ${path.basename(f)}`) }
    if (removed.length > 40) console.log(`   … ${removed.length - 40} more removed`)
    // symbol-surface delta: a name-surface change would show here even when edges are stable
    const sn = (m: Map<string, Row>) => {
      const s = new Set<string>()
      for (const r of m.values()) for (const d of r.decls) s.add(`${d.k}\u0000${d.n}`)
      return s
    }
    const sa = sn(A), sb = sn(B)
    const sAdd = [...sb].filter((k) => !sa.has(k)), sRem = [...sa].filter((k) => !sb.has(k))
    console.log(`  symbol keys added ${sAdd.length}, removed ${sRem.length}${sAdd.length || sRem.length ? "" : "  (name surface identical)"}`)
    for (const k of sAdd.slice(0, 20)) console.log(`   + ${k.split(NULS)[0]} ${k.split(NULS).slice(1).join(" ")}`)
    for (const k of sRem.slice(0, 20)) console.log(`   - ${k.split(NULS)[0]} ${k.split(NULS)[1]}`)
    console.log("")
  }
}
console.log(`Every comparison above is over one corpus set sha256 prefix; a differing file count`)
console.log(`would have been refused rather than reported as an analyzer delta.`)
if (!existsSync(path.join(DIR, ".gitignore"))) console.log(`NOTE: .gitignore missing from ${DIR}`)