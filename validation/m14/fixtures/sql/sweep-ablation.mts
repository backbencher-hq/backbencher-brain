/**
 * SWEEP ABLATION — what does the declaration sweep actually contribute, measured by removing it?
 *
 * ## WHY THIS EXISTS, and why a counter could not answer it
 *
 * `ambiguity-census.mts` reports `sweepDeclarationsRecovered = 0` over every admitted corpus file,
 * and `sweep-reachability.mts` shows why: the population that counter names — a DECLARATION node
 * nested inside another DECLARATION node — does not occur on this corpus. Read alone that looks
 * like dead code, and the dead-code reading is wrong, because the counter does not name everything
 * the pass does.
 *
 * `sweepDeclarations` has TWO jobs:
 *
 *   1. dispatch a declaration node the root walk never reached  -> `sweepDeclarationsRecovered`
 *   2. RE-ENTER a `statement` nested inside a declaration and run `processStatement` on it, which
 *      is the only route by which the SQL inside a plpgsql body produces FROM-relation and call
 *      edges. `processStatement` RETURNS after handling a declaration node, so the root walk never
 *      descends into one.
 *
 * Job 2 publishes `uses`/`calls` edges and increments no recovery counter at all. So "the counter
 * reads 0" and "the pass is dead" are different claims, and only an ABLATION separates them.
 *
 * ## THE INSTRUMENT
 *
 * Production `parseFile`, every admitted file, twice:
 *
 *   baseline   as shipped
 *   ablated    `RealSqlAnalyzer.prototype.sweepDeclarations` replaced with a no-op
 *
 * `sweepDeclarations` is TypeScript-`private`, which is compile-time only: at runtime it is an
 * ordinary prototype method, and `engine.ts` constructs the analyzer through a dynamic `import()`
 * that the ESM module cache returns once. So the patch reaches every `parseFile` call without a
 * byte of `src/` changing, and nothing on disk is edited. The analyzer SOURCE is untouched and
 * the ablation is reverted by re-importing under a fresh prototype assignment at the end, which
 * the script asserts by re-running one file and checking the edge count returns to baseline.
 *
 * Every edge is keyed by `(type, source, target, line)` so a LOST edge is a real disappearance and
 * a GAINED edge would be reported too rather than assumed absent.
 *
 * ## USAGE
 *   npx tsx validation/m14/fixtures/sql/sweep-ablation.mts [--out FILE] [--limit N]
 */
import { readdirSync, statSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { execFileSync } from "node:child_process"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"
import { RealSqlAnalyzer } from "../../../../src/ast/real-sql-analyzer"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..")
const CR = process.env.BB_CORPUS_ROOT || "/home/ishaq2321/bb_tests/repositories"
const argv = process.argv.slice(2)
const argOf = (f: string) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined }
const OUT = argOf("--out")
const LIMIT = Number(argOf("--limit") ?? "0")
const SHARDS = Number(argOf("--shards") ?? "0")
const SHARD = Number(argOf("--shard") ?? "0")
const LANG = "sql"
const SIZE_CAP = 512 * 1024

const admitted: { label: string; abs: string; text: string }[] = []
let reposScanned = 0
for (const entry of readdirSync(CR)) {
  const dir = path.join(CR, entry)
  let tracked: string[] = []
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
    reposScanned++
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text = ""
    try {
      if (statSync(abs).size > SIZE_CAP) continue
      text = readFileSync(abs, "utf8")
    } catch { continue }
    if (detectLanguageFromPath(abs, text) !== LANG) continue
    admitted.push({ label: `${entry}/${rel}`, abs, text })
  }
}
admitted.sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0))
// `--shards N --shard I` takes a contiguous slice, because a single process over 1,962 files is
// long enough that a fault costs the whole measurement; the census shards for the same reason.
const files = SHARDS > 0
  ? admitted.filter((_, i) => i % SHARDS === SHARD)
  : LIMIT > 0 ? admitted.slice(0, LIMIT) : admitted
console.log(`sweep ablation — production parseFile, prototype patched, source untouched`)
console.log(`corpus root      ${CR}`)
console.log(`repos scanned    ${reposScanned}`)
console.log(`admitted files   ${admitted.length}${LIMIT > 0 ? ` (measuring the first ${files.length})` : ""}`)

type Edge = { type: string; source: string; target: string; line: number }
function edgesOf(r: any): Map<string, Edge> {
  const m = new Map<string, Edge>()
  for (const rel of r?.relationships ?? []) {
    const e: Edge = {
      type: String(rel.type ?? ""),
      source: String(rel.source ?? ""),
      target: String(rel.target ?? ""),
      line: Number(rel.line ?? rel.startLine ?? -1),
    }
    m.set(`${e.type}|${e.source}|${e.target}|${e.line}`, e)
  }
  return m
}
const key = (e: Edge) => `${e.type}|${e.source}|${e.target}|${e.line}`

const proto = RealSqlAnalyzer.prototype as any
const original = proto.sweepDeclarations
if (typeof original !== "function") { console.error("sweepDeclarations is not on the prototype; the ablation cannot run"); process.exit(3) }

const perTypeBaseline = new Map<string, number>()
const perTypeAblated = new Map<string, number>()
const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1)
let symBaseline = 0, symAblated = 0
let lostTotal = 0, gainedTotal = 0, changedFiles = 0
const lostExamples: { file: string; edge: Edge }[] = []
const gainedExamples: { file: string; edge: Edge }[] = []
const filesWithLoss: { file: string; lost: number }[] = []

for (const f of files) {
  let base: any
  try { base = await parseFile(f.abs, LANG) } catch { continue }
  const be = edgesOf(base)
  symBaseline += (base?.symbols ?? []).length
  for (const e of be.values()) bump(perTypeBaseline, e.type)
  proto.sweepDeclarations = function () { /* ablated: the whole-tree pass contributes nothing */ }
  let abl: any
  try { abl = await parseFile(f.abs, LANG) } catch { abl = undefined }
  proto.sweepDeclarations = original
  const ae = edgesOf(abl)
  symAblated += (abl?.symbols ?? []).length
  for (const e of ae.values()) bump(perTypeAblated, e.type)
  let lost = 0, gained = 0
  for (const [k, e] of be) if (!ae.has(k)) { lost++; if (lostExamples.length < 40) lostExamples.push({ file: f.label, edge: e }) }
  for (const [k, e] of ae) if (!be.has(k)) { gained++; if (gainedExamples.length < 40) gainedExamples.push({ file: f.label, edge: e }) }
  lostTotal += lost; gainedTotal += gained
  if (lost + gained > 0) { changedFiles++; filesWithLoss.push({ file: f.label, lost }) }
}
void key

/**
 * The revert is asserted, not trusted, and BOTH halves of the assertion are load-bearing.
 *
 * The previous version of this block read `before === after && (during === before ? true : true)`.
 * The second conjunct is a tautology — both branches are `true` — so the ablated number was
 * computed, printed, and then never compared to anything. And the witness was `files[0]`, the
 * first admitted file in label order: a 3-edge Exposed snippet on which the ablation changes
 * nothing, so the restore agreed with itself whether or not the prototype was ever put back. The
 * artifact recorded `ok: true` on such a witness, which is a green light wired to nothing.
 *
 * Two conditions replace it, and the second is the one that makes the first mean anything:
 *
 *   SENSITIVE  the ablated run reads STRICTLY FEWER edges than the shipped run, so the witness is
 *              a file the pass actually reaches and the check is able to fail
 *   RESTORED   re-installing the original returns the file to its shipped edge count, byte for byte
 *
 * The witness is therefore the file the ablation cost the MOST edges, not the first file in the
 * list and not a file the pass never touches.
 */
let probe: (typeof files)[number] | undefined
let bestLost = 0
for (const w of filesWithLoss) if (w.lost > bestLost) { bestLost = w.lost; probe = files.find((f) => f.label === w.file) }
let revertOk = false, revertDetail = ""
let revertSensitive = false
if (probe) {
  const before = edgesOf(await parseFile(probe.abs, LANG)).size
  proto.sweepDeclarations = function () {}
  const during = edgesOf(await parseFile(probe.abs, LANG)).size
  proto.sweepDeclarations = original
  const after = edgesOf(await parseFile(probe.abs, LANG)).size
  revertSensitive = during < before
  revertOk = revertSensitive && before === after
  revertDetail = `${probe.label}: shipped ${before}, ablated ${during}, restored ${after}` +
    ` — sensitive=${revertSensitive} (ablated < shipped), restored=${before === after}` +
    (revertSensitive ? "" : " — NOT SENSITIVE: this file loses no edges, so it cannot witness a restore")
} else {
  revertDetail = "no file lost an edge, so there is no witness and this instrument cannot assert its own restore"
}

const types = [...new Set([...perTypeBaseline.keys(), ...perTypeAblated.keys()])].sort()
console.log(`\nfiles whose edge set changed when the sweep was removed: ${changedFiles} of ${files.length}`)
console.log(`symbols  baseline ${symBaseline}   ablated ${symAblated}   delta ${symAblated - symBaseline}`)
console.log(`edges    baseline ${[...perTypeBaseline.values()].reduce((a, b) => a + b, 0)}   ablated ${[...perTypeAblated.values()].reduce((a, b) => a + b, 0)}`)
console.log(`lost by removing the sweep: ${lostTotal}    gained by removing it: ${gainedTotal}  (a gain would mean the sweep SUPPRESSES an edge)`)
console.log(`\nper type`)
console.log(`  ${"type".padEnd(14)}${"baseline".padStart(10)}${"ablated".padStart(10)}${"lost".padStart(8)}`)
for (const t of types) {
  const b = perTypeBaseline.get(t) ?? 0, a = perTypeAblated.get(t) ?? 0
  console.log(`  ${t.padEnd(14)}${String(b).padStart(10)}${String(a).padStart(10)}${String(b - a).padStart(8)}`)
}
console.log(`\nprototype restore assertion: ok=${revertOk} sensitive=${revertSensitive}  ${revertDetail}`)
for (const x of lostExamples.slice(0, 20)) console.log(`  LOST   ${x.file}  ${x.edge.type} ${x.edge.source} -> ${x.edge.target} @${x.edge.line}`)
for (const x of gainedExamples.slice(0, 10)) console.log(`  GAINED ${x.file}  ${x.edge.type} ${x.edge.source} -> ${x.edge.target} @${x.edge.line}`)

if (OUT) {
  mkdirSync(path.dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify({
    instrument: "validation/m14/fixtures/sql/sweep-ablation.mts",
    entryPoint: "parseFile (src/ast/pool-worker.ts)",
    ablation: "RealSqlAnalyzer.prototype.sweepDeclarations replaced with a no-op for the second pass; TypeScript `private` is compile-time only and engine.ts dynamic-imports the module once, so the patch reaches every call with src/ untouched",
    corpusRoot: CR, reposScanned, admittedFiles: admitted.length, measuredFiles: files.length,
    mode: SHARDS > 0 ? { shards: SHARDS, shard: SHARD } : { shards: 1, shard: 0 },
    sampling: SHARDS > 0
      ? `admitted files whose label-order index satisfies index % ${SHARDS} === ${SHARD}`
      : LIMIT > 0 ? `first ${files.length} admitted files in label order` : "every admitted file, no subset",
    edgeKey: "(type, source, target, line)",
    symbols: { baseline: symBaseline, ablated: symAblated, delta: symAblated - symBaseline },
    edges: {
      baseline: [...perTypeBaseline.values()].reduce((a, b) => a + b, 0),
      ablated: [...perTypeAblated.values()].reduce((a, b) => a + b, 0),
      lost: lostTotal, gained: gainedTotal,
    },
    perType: types.map((t) => ({ type: t, baseline: perTypeBaseline.get(t) ?? 0, ablated: perTypeAblated.get(t) ?? 0, lost: (perTypeBaseline.get(t) ?? 0) - (perTypeAblated.get(t) ?? 0) })),
    filesWhoseEdgeSetChanged: changedFiles,
    filesWithLoss: filesWithLoss.slice(0, 200),
    lostExamples, gainedExamples,
    prototypeRestored: { ok: revertOk, sensitive: revertSensitive, witnessIsMostLossingFile: true, detail: revertDetail },
  }, null, 2))
  console.log(`\nwrote ${OUT}`)
}