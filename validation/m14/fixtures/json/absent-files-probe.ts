/**
 * THE FILES NO INSTRUMENT CAN SEE — tracked in git, absent from disk.
 *
 * ## Why this exists
 *
 * Every instrument in this lane enumerates the ON-DISK population: `census.ts`,
 * `ruling-recheck.ts`, `trap-scan.ts` and `script/m14/firing-check.ts` all walk
 * `git ls-files` and then read each path, skipping what will not open. That is the right
 * default — an untracked build artifact is not what a consumer of the graph sees.
 *
 * But it makes a class of file invisible **silently**, and this lane's counts carry no
 * declaration of it. Measured on the shared corpus at 2026-10-04: **10 repositories are
 * `--filter=blob:none` partial clones whose working trees were never checked out**, and
 *
 *   | repo | tracked | absent on disk | absent AND json-extension |
 *   | --- | ---: | ---: | ---: |
 *   | pb-googleapis | 9,390 | 9,153 | **456** |
 *   | pb-grpc | 10,504 | 9,792 | **55** |
 *   | julia | 2,059 | 1,107 | **7** |
 *   | pb-reference | 3,678 | 2,797 | **4** |
 *   | cabal / cloogle.org / duckdb / flutter-packages / helm / hledger | — | 8 | 0 |
 *
 * **22,861 tracked files are absent across those 10 repositories and 522 of them carry a
 * json extension.** So "13,187 tracked json-extension files" and "12,543 admitted" differ
 * by 644, of which 522 are this and 116 are the census's 512 KB cap (limitation 11) and 6
 * are content-based rejection. The census never said which was which; this file does.
 *
 * ## What it measures, and what it deliberately does NOT do
 *
 * It reads the missing blobs **out of git into a temporary directory** and puts them
 * through the SAME production entry point (`parseFile` from `src/ast/pool-worker.ts`) and
 * the SAME ruling probe (`JSON_RULED` from `script/m14/json-ruled.ts`, imported rather than
 * restated so it cannot audit a different rule than the gate will read).
 *
 * It does **not** check the files out into the shared corpus. Six other lanes are reading
 * that tree concurrently and materialising 9,153 files underneath them would move their
 * denominators mid-run. The measurement is taken on a copy; fixing the corpus is a §8
 * report, not this lane's edit.
 *
 * ## What the answer is FOR
 *
 * Two things, and only two:
 *
 *   1. it states the size of the blind spot in edges and files, so "whole admitted
 *      population" in the lane doc can be read with its denominator attached; and
 *   2. it re-runs the `instantiates` ruling probe over a population the census cannot
 *      reach, which either extends the ruling's denominator or overturns it.
 *
 * A third thing it CANNOT do is establish a new relationship type. These files are
 * additional input to the same analyzer, so a type that reads 0 here reads 0 there too;
 * that is recorded rather than dressed up as coverage.
 *
 * ## Usage
 *   npx tsx validation/m14/fixtures/json/absent-files-probe.ts
 *   npx tsx validation/m14/fixtures/json/absent-files-probe.ts --out /tmp/absent.json
 *
 * Read-only with respect to the corpus. Writes only to a mkdtemp directory and `--out`.
 */
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"
import { JSON_RULED, type Ruled } from "../../../../script/m14/json-ruled"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const ALL_TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"] as const

/** The census's cap, restated so the two denominators are comparable. Changing one
 *  without the other is how a doc ends up quoting a population nobody measured. */
const MAX_BYTES = 512 * 1024
const SLOTS = 4

const argv = process.argv.slice(2)
const argOf = (flag: string, dflt: string) => {
  const i = argv.indexOf(flag)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt
}
const OUT = argOf("--out", "")

// -------------------------------------------------- 1. which tracked files will not open
type Absent = { repo: string; rel: string; bytes: number }
const absent: Absent[] = []
const perRepoAbsent: Record<string, { tracked: number; absent: number; jsonAbsent: number }> = {}
let reposScanned = 0

for (const e of readdirSync(CR, { withFileTypes: true })) {
  if (!e.isDirectory()) continue
  const dir = path.join(CR, e.name)
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
      .split("\0")
      .filter(Boolean)
  } catch {
    continue
  }
  if (tracked.length === 0) continue
  reposScanned++
  const row = { tracked: tracked.length, absent: 0, jsonAbsent: 0 }
  for (const rel of tracked) {
    if (existsSync(path.join(dir, rel))) continue
    row.absent++
    if (!/\.(json|jsonc|json5)$/i.test(rel)) continue
    row.jsonAbsent++
    // size from the object header, without materialising the blob
    let bytes = 0
    try {
      const sz = execFileSync("git", ["-C", dir, "cat-file", "-s", `HEAD:${rel}`], { encoding: "utf8", timeout: 30_000 })
      bytes = Number(sz.trim())
    } catch {
      bytes = -1 // size unobtainable; counted, still probed if the blob reads
    }
    absent.push({ repo: e.name, rel, bytes })
  }
  if (row.absent > 0) perRepoAbsent[e.name] = row
}

absent.sort((a, b) => (a.repo === b.repo ? (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0) : a.repo < b.repo ? -1 : 1))

// -------------------------------------------------- 2. materialise into a temp dir (corpus untouched)
const work = mkdtempSync(path.join(tmpdir(), "bb-json-absent-"))
let materialised = 0
const unreadable: string[] = []
const local: Array<{ abs: string; label: string }> = []
for (const a of absent) {
  const dest = path.join(work, a.repo, a.rel)
  mkdirSync(path.dirname(dest), { recursive: true })
  let blob: Buffer
  try {
    blob = execFileSync("git", ["-C", path.join(CR, a.repo), "show", `HEAD:${a.rel}`], {
      maxBuffer: 64 * 1024 * 1024,
      timeout: 60_000,
    })
  } catch {
    unreadable.push(`${a.repo}/${a.rel}`)
    continue
  }
  writeFileSync(dest, blob)
  materialised++
  local.push({ abs: dest, label: `${a.repo}/${a.rel}` })
}

// -------------------------------------------------- 3. same admission test the census uses
const admitted: Array<{ abs: string; label: string }> = []
let overCap = 0
let rejectedByDetect = 0
for (const f of local) {
  let size = 0
  try { size = statSync(f.abs).size } catch { continue }
  if (size > MAX_BYTES) { overCap++; continue }
  let text: string
  try { text = readFileSync(f.abs, "utf8") } catch { continue }
  if (detectLanguageFromPath(f.abs, text) !== "json") { rejectedByDetect++; continue }
  admitted.push(f)
}

// -------------------------------------------------- 4. production parseFile over them
const edges: Record<string, number> = Object.fromEntries(ALL_TYPES.map(t => [t, 0]))
const filesByType: Record<string, Set<string>> = Object.fromEntries(ALL_TYPES.map(t => [t, new Set<string>()]))
const offLabel = new Map<string, number>()
let symbols = 0
let emptyName = 0
let emptyKind = 0
let parseFail = 0
const parseFailures: string[] = []
let idx = 0

async function worker(): Promise<void> {
  for (;;) {
    const i = idx++
    if (i >= admitted.length) return
    const f = admitted[i]
    let r: Awaited<ReturnType<typeof parseFile>>
    try {
      r = await parseFile(f.abs, readFileSync(f.abs, "utf8"), "json")
    } catch {
      parseFail++
      if (parseFailures.length < 8) parseFailures.push(f.label)
      continue
    }
    for (const s of r.symbols ?? []) {
      symbols++
      if (!s.name) emptyName++
      if (!s.kind) emptyKind++
    }
    for (const e of r.relationships ?? []) {
      const t = e.type as string
      if (!(t in edges)) { offLabel.set(t, (offLabel.get(t) ?? 0) + 1); continue }
      edges[t]++
      filesByType[t]!.add(f.label)
    }
  }
}
await Promise.all(Array.from({ length: SLOTS }, () => worker()))

// -------------------------------------------------- 5. the ruling probe, imported not restated
type Tally = { type: string; instrument: string; hits: string[]; files: number }
const tallies: Tally[] = JSON_RULED.map((r: Ruled) => ({ type: r.type, instrument: r.instrument, hits: [], files: 0 }))

const wts: any = await import("web-tree-sitter")
const WtsParser = wts.Parser ?? wts.default
const WtsLanguage = wts.Language ?? wts.default?.Language
await WtsParser.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const wasm = readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-json.wasm"))
const makeParser = async (): Promise<any> => {
  const p = new WtsParser()
  p.setLanguage(await WtsLanguage.load(wasm))
  return p
}
const slots: any[] = await Promise.all(Array.from({ length: SLOTS }, () => makeParser()))
let rIdx = 0
let probeThrew = 0
const probeThrewFiles: string[] = []

async function probeWorker(slot: number): Promise<void> {
  for (;;) {
    const i = rIdx++
    if (i >= admitted.length) return
    const f = admitted[i]
    let tree: any = null
    try {
      tree = slots[slot].parse(readFileSync(f.abs, "utf8"))
    } catch {
      probeThrew++
      if (probeThrewFiles.length < 8) probeThrewFiles.push(f.label)
      slots[slot] = await makeParser()
      continue
    }
    if (!tree) continue
    for (const t of tallies) {
      const entry = JSON_RULED.find((r: Ruled) => r.type === t.type)!
      const before = t.hits.length
      if (entry.countOnTree) entry.countOnTree(tree.rootNode, f.label, t.hits)
      if (t.hits.length > before) t.files++
    }
    tree.delete?.()
  }
}
await Promise.all(Array.from({ length: SLOTS }, (_, s) => probeWorker(s)))

// -------------------------------------------------- report
const totalAbsentFiles = Object.values(perRepoAbsent).reduce((a, r) => a + r.absent, 0)
const totalAbsentJson = Object.values(perRepoAbsent).reduce((a, r) => a + r.jsonAbsent, 0)
const totalEdges = Object.values(edges).reduce((a, n) => a + n, 0)

console.log(`\n=== json absent-files probe — corpus ${CR} ===`)
console.log(`repositories scanned ${reposScanned}; repositories with tracked-but-absent files ${Object.keys(perRepoAbsent).length}`)
console.log(`tracked-but-absent files ${totalAbsentFiles}; of those json-extension ${totalAbsentJson}`)
console.log(`\nrepo                     tracked  absent  json-absent`)
for (const [r, row] of Object.entries(perRepoAbsent).sort())
  console.log(`${r.padEnd(24)}${String(row.tracked).padStart(7)}${String(row.absent).padStart(8)}${String(row.jsonAbsent).padStart(13)}`)

console.log(`\nmaterialised into ${work} (the corpus itself was NOT modified)`)
console.log(`  blobs unreadable from the local object store: ${unreadable.length}`)
console.log(`  over the ${MAX_BYTES} B cap: ${overCap}`)
console.log(`  not admitted as json by detectLanguageFromPath: ${rejectedByDetect}`)
console.log(`  ADMITTED (same test as census.ts): ${admitted.length}   parse failures: ${parseFail}` + (parseFailures.length ? `  e.g. ${parseFailures.join(", ")}` : ""))
console.log(`  symbols ${symbols} (empty name ${emptyName}, empty kind ${emptyKind})   relationships ${totalEdges}`)
if (offLabel.size) console.log(`  relationship types OUTSIDE the ten: ${[...offLabel].map(([t, n]) => `${t}=${n}`).join(", ")}`)

console.log(`\ntype              edges  files`)
console.log(`-------------------------------------`)
for (const t of ALL_TYPES) {
  const n = filesByType[t]!.size
  console.log(`${t.padEnd(16)}${String(edges[t]).padStart(7)}${(n ? String(n) : "-").padStart(7)}`)
}

console.log(`\nruling probe (imported from script/m14/json-ruled.ts) over the same ${admitted.length} files`)
console.log(`  parse throws ${probeThrew}` + (probeThrewFiles.length ? `  e.g. ${probeThrewFiles.join(", ")}` : ""))
for (const t of tallies)
  console.log(`  ${t.type.padEnd(14)} ${t.instrument.padEnd(20)} hits ${String(t.hits.length).padStart(4)}  files ${t.files}` + (t.hits.length ? `  e.g. ${t.hits.slice(0, 3).join(" | ")}` : ""))

const out = {
  tool: "json-absent-files-probe",
  corpusRoot: CR,
  repositoriesScanned: reposScanned,
  repositoriesWithAbsentFiles: Object.keys(perRepoAbsent).length,
  perRepoAbsent,
  trackedAbsentFiles: totalAbsentFiles,
  trackedAbsentJsonFiles: totalAbsentJson,
  materialised,
  unreadableBlobs: unreadable.length,
  overCap,
  rejectedByDetect,
  admitted: admitted.length,
  parseFailures: parseFail,
  symbols,
  emptyNameSymbols: emptyName,
  emptyKindSymbols: emptyKind,
  relationships: totalEdges,
  offLabelTypes: Object.fromEntries(offLabel),
  types: Object.fromEntries(ALL_TYPES.map(t => [t, { edges: edges[t], files: filesByType[t]!.size }])),
  rulings: tallies.map(t => ({ type: t.type, instrument: t.instrument, hits: t.hits.length, files: t.files, examples: t.hits.slice(0, 5) })),
  probeThrows: probeThrew,
}
if (OUT) { writeFileSync(OUT, JSON.stringify(out, null, 2)); console.log(`\nwrote ${OUT}`) }