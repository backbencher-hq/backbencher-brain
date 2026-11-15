// YAML SHARD WALK — is the lane's edge total produced by ONE long walk, and does its YIELD collapse?
//
// THE FLEET FINDING (markdown, measured on a 17,460-file corpus): from ~file 9,000 onward every file was
// answered by `extractFallback()` at ~0.3 edges/file where the analyzer yields 16–36 — a 2.23x
// under-count — while the run's own `degraded` line read 2. yaml's population is 18,364 files, LARGER
// than the corpus where the collapse was demonstrated, and `incoming-gate.ts` walks it in ONE
// sequential process (`await parseFile(f, …)` inside `for (const f of files)`, classification deferred
// to a second pass). So the question is direct: does this lane's walk lose edges with depth?
//
// THE TEST is a partition whose LONGEST WALK is short. `--of N --shard i` takes files where
// `index % N === i`; each shard is ~18,364/N files and each shard SUMS EXACTLY (an edge belongs to the
// file that emitted it, so partitioning files partitions edges). If the 8 shards sum to the total the
// one long walk reported, no edges were lost and the walk did not degrade; if they sum HIGHER, the
// long walk was degraded and its number was an under-count.
//
// It also counts BOTH degradation signatures `incoming-gate.ts` tests for (`result.fallback === true`
// and `metadata.analysisVersion === "2.0-basic-fallback"`), plus empty results, so the run's own
// `degraded` reading can be checked against the fallback reality.
//
//   npx tsx validation/m14/fixtures/yaml/shard-walk.ts --of 8 --shard 0
const REPO = process.env.BB_REPO || "/home/ishaq2321/mcp/backbencher-brain"
const { parseFile } = await import(`${REPO}/src/ast/pool-worker.ts`)
import { execFileSync } from "node:child_process"
import { readdirSync, statSync } from "node:fs"
import { join } from "node:path"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SIZE_CAP = 1024 * 1024
const EXTS = [".yaml", ".yml"]
const argv = process.argv.slice(2)
const OF = argv.includes("--of") ? Number(argv[argv.indexOf("--of") + 1]) : 1
const SHARD = argv.includes("--shard") ? Number(argv[argv.indexOf("--shard") + 1]) : 0

const files: string[] = []
const repoOf = new Map<string, string>()
for (const name of readdirSync(CR).sort()) {
  const dir = join(CR, name)
  try { if (!statSync(dir).isDirectory()) continue } catch { continue }
  try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    if (!EXTS.some((e) => rel.toLowerCase().endsWith(e))) continue
    const abs = join(dir, rel)
    try { if (statSync(abs).size > SIZE_CAP) continue } catch { continue }
    files.push(abs)
    repoOf.set(abs, dir)
  }
}
const mine = OF === 1 ? files : files.filter((_, i) => i % OF === SHARD)

let parsed = 0, failed = 0, fallbackSig = 0, basicSig = 0, emptyResults = 0
const byType = new Map<string, number>()
let edges = 0
let bucketEdges = 0
const yieldCurve: string[] = []
for (let i = 0; i < mine.length; i++) {
  let r: any
  // THE GATE'S OWN CALL SHAPE: project root = the REPOSITORY, not the corpus.
  try { r = await parseFile(mine[i], repoOf.get(mine[i]) ?? CR, { projectRoot: repoOf.get(mine[i]) ?? CR } as any) } catch { failed++; continue }
  if (!r) { failed++; continue }
  parsed++
  if (r.fallback === true) fallbackSig++
  if (r.metadata?.analysisVersion === "2.0-basic-fallback") basicSig++
  if ((r.symbols?.length ?? 0) === 0 && (r.relationships?.length ?? 0) === 0) emptyResults++
  for (const e of r.relationships ?? []) {
    edges++; bucketEdges++
    const t = String(e.type ?? "?")
    byType.set(t, (byType.get(t) ?? 0) + 1)
  }
  if ((i + 1) % 250 === 0) {
    yieldCurve.push(`    files ${String(i + 1).padStart(6)}   bucket edges ${String(bucketEdges).padStart(7)}   ${(bucketEdges / 250).toFixed(1)}/file   cumulative ${(edges / (i + 1)).toFixed(1)}/file`)
    bucketEdges = 0
  }
}
console.log(`SHARD ${SHARD}/${OF} — ${mine.length} file(s) of the ${files.length}-file admitted population`)
console.log(`  parsed ${parsed} · failed ${failed} · empty results ${emptyResults}`)
console.log(`  DEGRADATION SIGNATURES: fallback:true ${fallbackSig} · analysisVersion 2.0-basic-fallback ${basicSig}`)
console.log(`  EDGES ${edges}`)
console.log(`  by type: ${[...byType.entries()].sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t} ${n}`).join(" · ")}`)
if (yieldCurve.length) { console.log(`  YIELD CURVE (per 250 files):`); for (const l of yieldCurve) console.log(l) }
console.log(`SHARDSUM ${SHARD} ${edges} ${fallbackSig + basicSig}`)
