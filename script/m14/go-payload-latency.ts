/**
 * GO LANE — PAYLOAD AND LATENCY, measured on one stated draw.
 *
 * WHY A LANE-OWNED FILE. `validation/m60/analyzer-budget-register.json` records
 * this lane's envelope as `unscorable` (severity 5, status open) with four named
 * reasons: no loadRule, no corpusManifest, no loadAvg1, no userCpuMsPerFile on
 * the corpus row. So there is no green latency budget for this lane to regress,
 * and "no budget" is not a measurement either — the M60 register's own rule is
 * that a lane's envelope must be a number. This file supplies the number and
 * names the draw it was taken on, so the next change has something to be
 * compared against.
 *
 * WHAT IS MEASURED, and why each figure is here:
 *
 *   wallMs / userCpuMs   latency. `userCpuMs` is the load-stable one: this
 *                        measurement box runs several analyzer lanes at once and
 *                        its load average has been 18 on 8 cores, so wall time
 *                        alone would mostly measure the neighbours. Both are
 *                        printed, and the ratio to the file count is printed
 *                        with them.
 *   relationships / symbols   the edge volume the new types add.
 *   bytesAll / bytesPerType    the SERIALIZED graph, because the thing the
 *                        workstream budgets is a payload: `bb_graph`'s
 *                        un-narrowed `relationshipTypes` default returns all ten
 *                        values, and both new types are already in that default,
 *                        so an un-narrowed query on a Go repo grows by whatever
 *                        these two types weigh. bytesAll is that un-narrowed
 *                        payload; bytesFiltered is the same graph with one type
 *                        asked for, so the ratio is the multiplier the
 *                        workstream quotes (2.5-4.8x elsewhere).
 *
 * The analyzer is whichever blob is in the working tree when this runs, so a
 * before/after is taken by checking the previous blob out, running, and checking
 * the new one back — the same procedure the differential comparison used.
 *
 * CLI: npx tsx script/m14/go-payload-latency.ts [--label after] [--out f.json]
 * Writes nothing outside --out.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { parseFile } from "../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const ALL_TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"]
function argOf(flag: string, dflt?: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : dflt
}
const LABEL = argOf("--label", "run")!
const OUT = argOf("--out")
const SAMPLE = parseInt(argOf("--sample", "400") ?? "400")
const REPOS = (argOf("--repo", "go-stdlib,cobra") ?? "").split(",").map((s) => s.trim()).filter(Boolean)

const files: string[] = []
for (const e of REPOS) {
  const dir = path.join(CR, e)
  try { if (!statSync(dir).isDirectory()) continue; execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    try {
      if (statSync(abs).size > 512 * 1024) continue
      if (detectLanguageFromPath(abs, readFileSync(abs, "utf8")) !== "go") continue
    } catch { continue }
    files.push(abs)
  }
}
files.sort()
const draw = files.slice(0, SAMPLE)
console.log(`go payload/latency [${LABEL}] — repos ${REPOS.join(",")} admitted ${files.length} drawn ${draw.length}`)

const cpu0 = process.cpuUsage()
const wall0 = Date.now()
const byType = new Map<string, number>()
let symbols = 0
let relationships = 0
let parseFail = 0
let idx = 0
async function worker() {
  while (true) {
    const i = idx++
    if (i >= draw.length) return
    let r: any
    try { r = await parseFile(draw[i], path.dirname(draw[i])) } catch { parseFail++; continue }
    symbols += (r?.symbols ?? []).length
    const rels = (r?.relationships ?? []) as any[]
    relationships += rels.length
    for (const x of rels) {
      const t = String(x.type ?? x.relationshipType ?? "").toLowerCase()
      if (ALL_TYPES.includes(t)) byType.set(t, (byType.get(t) ?? 0) + 1)
    }
  }
}
await Promise.all(Array.from({ length: Number(process.env.BB_CENSUS_WORKERS ?? 4) }, () => worker()))
const wallMs = Date.now() - wall0
const cpu = process.cpuUsage(cpu0)

/** The serialized graph, as a consumer receives it. Metadata is kept because a
 *  consumer receives it: dropping it would flatter the number by exactly the
 *  amount the new edges add (they carry four metadata keys between them). */
const all: any[] = []
let bytesPerType: Record<string, number> = {}
{
  // second pass to measure bytes: kept separate so the counting pass above stays
  // the cheap one, and so a byte figure is never inferred from a count
  const rels: any[] = []
  idx = 0
  const collect = async () => {
    while (true) {
      const i = idx++
      if (i >= draw.length) return
      let r: any
      try { r = await parseFile(draw[i], path.dirname(draw[i])) } catch { continue }
      for (const x of (r?.relationships ?? []) as any[]) {
        const t = String(x.type ?? x.relationshipType ?? "").toLowerCase()
        if (!ALL_TYPES.includes(t)) continue
        rels.push({ type: t, source: x.source, target: x.target, confidence: x.confidence, line_number: x.line_number, metadata: x.metadata })
      }
    }
  }
  await Promise.all(Array.from({ length: Number(process.env.BB_CENSUS_WORKERS ?? 4) }, () => collect()))
  all.push(...rels)
  for (const t of ALL_TYPES) bytesPerType[t] = Buffer.byteLength(JSON.stringify(rels.filter((x) => x.type === t)))
}
const bytesAll = Buffer.byteLength(JSON.stringify(all))
const biggest = ALL_TYPES.slice().sort((a, b) => (bytesPerType[b] ?? 0) - (bytesPerType[a] ?? 0))[0]
const bytesFiltered = bytesPerType[biggest] ?? 0
const out = {
  label: LABEL,
  repos: REPOS,
  admitted: files.length,
  drawn: draw.length,
  parsedThroughProductionEntry: draw.length - parseFail,
  parseFailures: parseFail,
  symbols,
  relationships,
  edgesByType: Object.fromEntries([...byType].sort((a, b) => b[1] - a[1])),
  latency: { wallMs, userCpuMs: Math.round(cpu.user / 1000), systemCpuMs: Math.round(cpu.system / 1000), msPerFileWall: +(wallMs / draw.length).toFixed(2), userCpuMsPerFile: +(cpu.user / 1000 / draw.length).toFixed(2) },
  payload: { bytesAll, bytesFilteredBiggestType: bytesFiltered, biggestType: biggest, ratioAllToOneType: +(bytesAll / Math.max(1, bytesFiltered)).toFixed(2), bytesPerType, shareOfBytesByType: Object.fromEntries(ALL_TYPES.map((t) => [t, +(((bytesPerType[t] ?? 0) / Math.max(1, bytesAll)) * 100).toFixed(2)])) },
  loadAvg1: Number((await import("node:os")).loadavg()[0].toFixed(2)),
  note: "Latency on a box running several analyzer lanes concurrently: wallMs is reported but userCpuMs is the load-stable figure. `bytesAll` is the un-narrowed `bb_graph` payload (the traversal default is all ten types); `ratioAllToOneType` is the multiplier against the single largest type.",
}
console.log(`\nsymbols ${symbols}  relationships ${relationships}  parseFailures ${parseFail}`)
console.log(`latency: wall ${wallMs} ms (${(wallMs / draw.length).toFixed(2)} ms/file) | user CPU ${out.latency.userCpuMs} ms (${out.latency.userCpuMsPerFile} ms/file) | loadavg1 ${out.loadAvg1}`)
console.log(`payload: bytesAll ${bytesAll} | biggest type ${biggest} ${bytesFiltered} | ratio ${out.payload.ratioAllToOneType}x`)
console.log(`share of serialized bytes: ${JSON.stringify(out.payload.shareOfBytesByType)}`)
if (OUT) { writeFileSync(OUT, JSON.stringify(out, null, 2)); console.log(`\nwrote ${OUT}`) }
process.exit(0)
