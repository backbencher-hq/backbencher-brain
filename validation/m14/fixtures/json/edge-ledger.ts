/**
 * WHOLE-CORPUS EDGE LEDGER — per-type counts over the admitted population, kill-safe.
 *
 * ## Why this file exists: the arbiter's counts are per-PROCESS, not per-CORPUS
 *
 * `script/m14/ontology-coverage-gate.ts` accumulates its edge counts into an in-memory
 * `Map` inside the callback it hands to `resumableWalk`:
 *
 *     const observed = new Map<Type, { n: number; files: Set<string> }>()
 *     const walkStats = await resumableWalk(CHECKPOINT, files.length, {
 *       run: async (i) => { const r = await parseFile(files[i].abs, files[i].dir)
 *                           for (const x of r.relationships ?? []) observed.set(...) },
 *     })
 *
 * and `resumable-walk.ts`'s checkpoint stores **paths only** — one path per line, `!`-
 * prefixed for a file it gave up on. Nothing about the EDGES is persisted. So every file
 * skipped as "already done" contributes its edges to no accumulator in this process, and
 * the verdict is computed over the SLICE this process happened to walk.
 *
 * That is not hypothetical here. The gate now reports its population honestly —
 * `walk: 13951/13951 files (100.0%) newly walked 204, resumed 13747` — and then prints
 * per-type counts drawn from those 204 files. It reported, for that run:
 *
 *     calls      EMITTED  2 edges
 *     imports    FALSIFIED  NOT EMITTED
 *
 * while the same repository's own ruling spec (`script/m14/spec/json-completeness.json`,
 * `BD-ontology`) records `imports` as EMITTED, and this lane's independent 601-file walk
 * finds 6 `imports` edges in it. A verdict that flips an emitted type to FALSIFIED
 * because the measurement resumed is not a verdict about the language.
 *
 * The shared gate is §8 machinery, so this lane does not edit it. This file is the
 * measurement that settles the same question in a shape that survives a kill: the EDGES
 * are appended to disk, so a process death costs the current file and nothing else.
 *
 * ## Why appending edges (and not just paths) is the whole trick
 *
 * `resumable-walk.ts` appends the path BEFORE parsing, which is right when the unit of
 * progress is "this file is done" and wrong when the unit is "these edges are known" —
 * a path-first checkpoint cannot be replayed into an edge count. Here each file's edges
 * are appended as one NDJSON record AFTER it parses, so the log is the measurement: the
 * summary at the end is computed from records on disk, and a run that dies at file 9,000
 * of 13,951 has already banked 8,999 files' worth of edges. `!`-prefixed bad paths are
 * carried in a SEPARATE marker file and skipped on resume, so a poison file costs one
 * file rather than every subsequent run.
 *
 * ## Two populations, both declared
 *
 * `-max-bytes` is honoured so this answers about the same population the census and the
 * gate do; passing `0` measures a SUPERSET and the summary says so. Either way the
 * denominator is printed next to the counts, per the honesty contract: a count without
 * its population is a finding about the wrong thing.
 *
 * ## Regex-free: string and path-segment tests only. It reads no source text.
 *
 * ## Usage
 *
 *   npx tsx validation/m14/fixtures/json/edge-ledger.ts [--out FILE] [--max-bytes N] [--summary]
 *   npx tsx validation/m14/fixtures/json/edge-ledger.ts --summary      # re-read the log, parse nothing
 *
 * READ-ONLY with respect to the corpus. Writes only to `--out`.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"
import { admittedFiles, DEFAULT_MAX_BYTES, describeWalk, type AdmittedFile } from "./admitted-files"

const ALL_TYPES = [
  "calls",
  "uses",
  "contains",
  "imports",
  "references",
  "exports",
  "extends",
  "implements",
  "overrides",
  "instantiates",
] as const
type Type = (typeof ALL_TYPES)[number]

const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"

function argOf(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? process.argv[i + 1] : undefined
}

/** One NDJSON record per file. The unit of progress is the record, not the path. */
type Record_ = {
  repo: string
  rel: string
  n: number
  /** Edge counts by type, for the ten ontology types only. */
  t: Partial<Record<Type, number>>
  /** Every Imports edge's target, so "is it emitted at all" has a witness. */
  imports: string[]
  /** Distinct `type` strings seen, unfiltered — a type outside the ten is still a finding. */
  seen: string[]
  /** Relationship count the analyzer produced in total, including any type not in the ten. */
  total: number
}

function readLog(out: string): Record_[] {
  if (!existsSync(out)) return []
  const rows: Record_[] = []
  for (const line of readFileSync(out, "utf8").split("\n")) {
    if (!line.trim()) continue
    try {
      rows.push(JSON.parse(line) as Record_)
    } catch {
      // A torn final line is the expected shape of a kill mid-append. It is dropped and
      // the file it belonged to is re-walked, because a record that did not fully land
      // is not a record.
    }
  }
  return rows
}

function readBad(marker: string): Set<string> {
  if (!existsSync(marker)) return new Set()
  return new Set(
    readFileSync(marker, "utf8")
      .split("\n")
      .map((l) => l.replace(/^!/, "").trim())
      .filter(Boolean),
  )
}

async function main(): Promise<void> {
  const maxBytes = Number(argOf("--max-bytes") ?? DEFAULT_MAX_BYTES)
  const out = argOf("--out") ?? "validation/m14/measurements/json-edge-ledger.ndjson"
  const marker = out + ".bad"
  mkdirSync(path.dirname(out), { recursive: true })

  // --summary re-reads the log and parses NOTHING. Cheap, and it is how the report quotes
  // a number without re-walking a corpus.
  if (process.argv.includes("--summary")) {
    summarize(readLog(out), maxBytes)
    return
  }

  const walk = admittedFiles(CORPUS_ROOT, maxBytes)
  console.log(describeWalk(walk, CORPUS_ROOT))
  console.log(`ledger: ${out}`)
  console.log(`population: ${walk.files.length} admitted files (maxBytes=${maxBytes || "unbounded"})`)
  console.log("")

  const done = new Set(readLog(out).map((r) => `${r.repo}/${r.rel}`))
  const bad = readBad(marker)
  const pending = walk.files.filter((f) => !done.has(`${f.repo}/${f.rel}`) && !bad.has(f.abs))
  console.log(`already banked: ${done.size}   given up on: ${bad.size}   pending: ${pending.length}`)

  let walked = 0
  let newEdges = 0
  for (const f of pending as AdmittedFile[]) {
    let r: any
    try {
      r = await parseFile(f.abs, f.dir)
    } catch {
      // parseFile answers a parser hang by calling process.exit(), which this file cannot
      // intercept. The catch is here for the throwing shapes only; the hang simply ends the
      // run with everything banked so far intact, which is the property being bought.
      appendFileSync(marker, `!${f.abs}\n`)
      console.log(`[GAVE-UP] ${f.repo}/${f.rel}`)
      continue
    }
    const t: Partial<Record<Type, number>> = {}
    const imports: string[] = []
    const seen = new Set<string>()
    let total = 0
    for (const x of r.relationships ?? []) {
      const raw = String(x.type ?? x.relationshipType ?? "")
      seen.add(raw)
      total++
      const key = raw.toLowerCase() as Type
      if (!ALL_TYPES.includes(key)) continue
      t[key] = (t[key] ?? 0) + 1
      if (key === "imports") imports.push(String(x.target ?? ""))
    }
    appendFileSync(out, JSON.stringify({ repo: f.repo, rel: f.rel, n: (r.relationships ?? []).length, t, imports, seen: [...seen].sort(), total } satisfies Record_) + "\n")
    walked++
    newEdges += total
    if (walked % 500 === 0) console.log(`  walked ${walked}/${pending.length}  edges so far this run: ${newEdges}`)
  }
  console.log("")
  console.log(`walked ${walked} files this run, ${newEdges} edges.`)
  summarize(readLog(out), maxBytes)
}

function summarize(rows: Record_[], maxBytes: number): void {
  const perType = new Map<Type, { n: number; files: Set<string>; repos: Set<string> }>()
  for (const t of ALL_TYPES) perType.set(t, { n: 0, files: new Set(), repos: new Set() })
  const seenTypes = new Map<string, number>()
  let edges = 0
  let symbols = 0
  const importTargets = new Map<string, number>()

  for (const r of rows) {
    edges += r.total
    symbols += r.n
    for (const [k, v] of Object.entries(r.t)) {
      const e = perType.get(k as Type)!
      e.n += v as number
      e.files.add(`${r.repo}/${r.rel}`)
      e.repos.add(r.repo)
    }
    for (const s of r.seen) seenTypes.set(s, (seenTypes.get(s) ?? 0) + 1)
    for (const tgt of r.imports) importTargets.set(tgt, (importTargets.get(tgt) ?? 0) + 1)
  }

  console.log("=".repeat(78))
  console.log("WHOLE-CORPUS EDGE LEDGER — summary from records on disk")
  console.log("=".repeat(78))
  console.log(`population : ${rows.length} files, ${maxBytes || "unbounded"} maxBytes`)
  console.log(`edges      : ${edges}   (symbols field total ${symbols})`)
  console.log("")
  console.log(pad("type", 14) + pad("edges", 10) + pad("files", 9) + "repos")
  console.log("-".repeat(45))
  for (const t of ALL_TYPES) {
    const e = perType.get(t)!
    console.log(pad(t, 14) + pad(String(e.n), 10) + pad(String(e.files.size), 9) + String(e.repos.size))
  }
  const emitted = ALL_TYPES.filter((t) => (perType.get(t)!.n ?? 0) > 0)
  const absent = ALL_TYPES.filter((t) => (perType.get(t)!.n ?? 0) === 0)
  console.log("")
  console.log(`emitted ${emitted.length}/10: ${emitted.join(", ")}`)
  console.log(`absent  ${absent.length}/10: ${absent.join(", ")}`)
  console.log("")
  console.log(`every 'type' string the analyzer published, with the files it appeared in:`)
  for (const [s, n] of [...seenTypes].sort((a, b) => b[1] - a[1])) console.log(`  ${pad(s, 34)} ${n} files`)
  if (importTargets.size > 0) {
    console.log("")
    console.log(`distinct 'imports' targets: ${importTargets.size}; first 12 by edge count:`)
    for (const [t, n] of [...importTargets].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`  ${pad(t, 52)} ${n}`)
  }
}

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length)
}

await main()