/**
 * clean-wide-walk — a sharded, self-healing driver for the WIDE clean population.
 *
 * WHY THIS EXISTS. The single-process WIDE census cannot complete on this machine.
 * `src/ast/engine.ts:1441` arms a 120 s `setTimeout` per parse and calls
 * `process.exit(1)` when it fires, so ONE file that runs long under CPU contention
 * deletes every other file's work in the same process. Two attempts at the 2,181-file
 * walk both aborted, which is why `docs/analyzers/real-clean-analyzer.md` marks the
 * WIDE `references` cell unquotable. That is an instrument limit, not a corpus fact,
 * and it is removable without touching `engine.ts` (§8, supervisor-owned).
 *
 * HOW. Each shard is a child `clean-ontology-census.ts` run over a deterministic
 * `index % N` partition of the SORTED admitted list, so shards are disjoint and
 * reproducible. A shard that exits non-zero has, by construction, told us which file
 * killed it: `engine.ts` writes `[BB-HANG] parser stuck 120s on <path> — exiting`
 * before exiting, and that path is read out of the child's stderr. The file is added
 * to an exclusion set and the shard is retried, so the walk makes progress and
 * converges on a shard that completes. Every excluded file is RECORDED and printed,
 * because "the walk finished" and "the walk finished having skipped N files" are
 * different claims and only the second one is what a reader can check.
 *
 * AN EXCLUSION IS NOT A MEASUREMENT OF THE FILE. The 120 s clock is wall-clock, so a
 * file that merely lost a CPU race to the other lanes on this machine is
 * indistinguishable here from a file the parser genuinely cannot walk. This driver
 * therefore does not claim to know which it was: it reports the excluded set and
 * leaves them UNMEASURED. `clean-excluded-probe.mts` re-measures each excluded file
 * alone, in its own process, and its result is what separates the two cases.
 *
 * WHAT IT DOES NOT DO. It does not re-timeout a skipped file, retry it in a
 * subprocess, or substitute a degraded parse: a file this driver cannot measure is
 * reported as unmeasured, never as zero edges. The aggregated population therefore
 * carries its own denominator — files attempted, files measured, files excluded — and
 * `clean-wide-aggregate.mts` prints all three.
 *
 * CONCURRENCY. `--concurrency N` runs N shards at a time. It exists because the walk
 * is otherwise ~5 h of wall clock on this box: each child is a separate process doing
 * its own parse work, so N children use N cores that would otherwise idle while other
 * lanes hold the machine. The cost is stated, not hidden: more children competing for
 * the same 120 s wall-clock budget means MORE files are excluded as a side effect of
 * load. Every exclusion is printed and every shard records its attempt count, so the
 * coverage figure is auditable against the concurrency that produced it. If the
 * exclusion count is load-sensitive, re-run at a lower `--concurrency` and compare —
 * a coverage figure that moves with `--concurrency` is not a coverage figure.
 *
 * Usage:
 *   npx tsx script/m14/clean-wide-walk.mts [--shards 24] [--out /tmp/clean-wide]
 *          [--shard-timeout 900] [--extra "--limit 120"] [--narrow] [--resume]
 *          [--concurrency 4]
 *
 * `--resume` re-uses a shard's JSON when that JSON records its own shard index, its own
 * shard count and a non-zero parsed count, and re-reads that shard's `.skip` file so its
 * exclusions survive into the aggregate's denominator. Without it, a driver killed
 * part-way loses the shards that already succeeded.
 */
import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import * as fs from "node:fs"
import * as path from "node:path"
import { promisify } from "node:util"

const execFileP = promisify(execFile)

const HERE = path.dirname(new URL(import.meta.url).pathname)
const CENSUS = path.join(HERE, "clean-ontology-census.ts")

const argv = process.argv.slice(2)
const arg = (k: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : "" }
const OUT_DIR = arg("--out") || "/tmp/clean-wide-walk"
const SHARDS = Number(arg("--shards") ?? 24) || 24
const SHARD_TIMEOUT_S = Number(arg("--shard-timeout") ?? 900) || 900
const CONCURRENCY = Math.max(1, Number(arg("--concurrency") ?? 1) || 1)
const EXTRA = arg("--extra") || ""

/**
 * The `--identity-dir` inside EXTRA, if there is one.
 *
 * A resumed shard is not re-run, so a shard whose tally JSON exists but whose IDENTITY
 * dump does not would be resumed with no dump — and the aggregator downstream would
 * read a SHORTER population than the JSON beside it claims, which is the exact failure
 * this driver already had once (six shards that were all shard 0). The guard is
 * therefore on the ARTEFACT the next stage needs, not only on the JSON's own fields.
 */
const IDENTITY_DIR = (EXTRA.match(/(?:^|\s)--identity-dir\s+(\S+)/) ?? [])[1] ?? ""
const identityPathFor = (shard: number): string => path.join(IDENTITY_DIR, `identity-${shard}.ndjson`)
const NARROW = argv.includes("--narrow")
const RESUME = argv.includes("--resume")

// `--narrow` measures only the 312 git-tracked files the arbiter walks, and exists for
// the CONTROL run: the sharded machinery must reproduce the single-process PROD totals
// before any WIDE number built with it is quotable.
//
// The argument list is BUILT PER SHARD, not assembled from placeholders and patched by
// index. The placeholder version shipped once and every one of six shards ran shard 0,
// because the `--shard` value slot was never written — six identical JSONs whose summed
// totals read 39,168 edges against a true 30,744. The census was correct; the driver was
// lying by omission. Building the list per shard removes the class.
const censusArgsFor = (shard: number, outFile: string, skipFile: string): string[] => {
  const a = ["--shard", String(shard), "--shards", String(SHARDS), "--json", outFile, "--skip", skipFile]
  if (!NARROW) a.push("--wide")
  if (EXTRA) a.push(...EXTRA.split(" ").filter(Boolean))
  return a
}

fs.mkdirSync(OUT_DIR, { recursive: true })

/** Every `[BB-HANG] parser stuck 120s on <path>` the child printed, in order. */
function hangPaths(stderr: string): string[] {
  const out: string[] = []
  for (const line of stderr.split("\n")) {
    const m = /\[BB-HANG\][^\n]*? on (.+?) — exiting/.exec(line)
    if (m?.[1]) out.push(m[1].trim())
  }
  return out
}

type ShardResult = { shard: number; attempts: number; excluded: string[]; parsed: number; sampled: number; resumed?: boolean; failed?: string }

/** Where each exclusion came from, so a reader can see it was a shard's named hang. */
const exclusionOrigin = new Map<string, string>()

async function runShard(shard: number): Promise<ShardResult> {
  // A shard can only be carved down if the poison file is known, so each attempt
  // passes the CURRENT exclusion list and the child re-derives its own file set.
  // The census's shard membership does not depend on the exclusions (it partitions the
  // sorted list first), so an exclusion is applied by ADDING a --skip list rather than
  // by changing the shard index — see --skip below.
  const excludedForShard: string[] = []
  let attempts = 0
  let parsed = 0
  let sampled = 0

  const outFile = path.join(OUT_DIR, `shard-${shard}.json`)

  // RESUME. A shard that already produced a complete, self-describing JSON is not
  // re-run. This is not an optimisation: on this machine the whole-process timeout is
  // shorter than the walk, so the driver gets killed part-way and the next session has
  // to redo the shards that already succeeded. The guard is on the JSON's OWN recorded
  // population, not on its existence — a JSON left behind by a shard that then hit its
  // own retry loop is partial in `sampled` and is re-run.
  if (RESUME && fs.existsSync(outFile)) {
    try {
      const j = JSON.parse(fs.readFileSync(outFile, "utf8")) as { sampled?: number; filesParsed?: number; shard?: number | null; shards?: number | null }
      const own = j.shard === shard && (j.shards ?? 0) === SHARDS
      const complete = Number(j.sampled ?? 0) > 0 && Number(j.filesParsed ?? 0) > 0
      const dumped = !IDENTITY_DIR || fs.existsSync(identityPathFor(shard))
      if (own && complete && dumped) {
        parsed = Number(j.filesParsed)
        sampled = Number(j.sampled)
        // A resumed shard DID exclude files on its earlier attempt. Its `.skip` file is
        // the only record of them, and the aggregate's denominator counts them, so it
        // is read back here — otherwise a resumed shard reports its exclusions as zero
        // and the aggregate silently claims a coverage it did not measure.
        const skipPath = path.join(OUT_DIR, `shard-${shard}.skip`)
        if (fs.existsSync(skipPath)) {
          for (const line of fs.readFileSync(skipPath, "utf8").split("\n")) {
            const t = line.trim()
            if (t && !excludedForShard.includes(t)) { excludedForShard.push(t); allExcluded.add(t); exclusionOrigin.set(t, `shard ${shard} (resumed)`) }
          }
        }
        console.log(`shard ${String(shard).padStart(3)}/${SHARDS} SKIP resumed  parsed ${parsed}/${sampled}  excluded ${excludedForShard.length}`)
        return { shard, attempts: 0, excluded: excludedForShard, parsed, sampled, resumed: true }
      }
    } catch { /* unreadable partial — fall through and re-run */ }
  }

  for (;;) {
    attempts++
    totalAttempts++
    if (attempts > 40) {
      const why = `gave up after ${attempts} attempts with ${excludedForShard.length} excluded`
      console.error(`shard ${shard}: ${why}`)
      return { shard, attempts, excluded: excludedForShard, parsed, sampled, failed: why }
    }
    const skipFile = path.join(OUT_DIR, `shard-${shard}.skip`)
    fs.writeFileSync(skipFile, excludedForShard.join("\n") + (excludedForShard.length ? "\n" : ""))
    const args = censusArgsFor(shard, outFile, skipFile)

    let status: number | null = null
    let signal: NodeJS.Signals | null = null
    let stdout = ""
    let stderr = ""
    try {
      const r = await execFileP("npx", ["tsx", CENSUS, ...args], {
        encoding: "utf8", timeout: SHARD_TIMEOUT_S * 1000, maxBuffer: 1024 * 1024 * 256,
      })
      stdout = r.stdout; stderr = r.stderr; status = 0
    } catch (e) {
      const ex = e as { stdout?: string; stderr?: string; code?: number | string; signal?: NodeJS.Signals; killed?: boolean }
      stdout = ex.stdout ?? ""; stderr = ex.stderr ?? ""
      status = typeof ex.code === "number" ? ex.code : null
      signal = ex.signal ?? null
    }

    const hangs = hangPaths(stderr)
    if (status === 0 && hangs.length === 0) {
      try {
        const j = JSON.parse(fs.readFileSync(outFile, "utf8"))
        parsed = Number(j.filesParsed ?? 0)
        sampled = Number(j.sampled ?? 0)
      } catch (e) {
        console.error(`shard ${shard}: exit 0 but the JSON is unreadable: ${(e as Error).message}`)
      }
      const m = /files parsed OK (\d+)\/(\d+)/.exec(stdout)
      if (m) { parsed = Number(m[1]); sampled = Number(m[2]) }
      console.log(`shard ${String(shard).padStart(3)}/${SHARDS} OK   attempt ${attempts}  parsed ${parsed}/${sampled}  excluded ${excludedForShard.length}`)
      return { shard, attempts, excluded: excludedForShard, parsed, sampled }
    }

    // A failure with no [BB-HANG] line means the CHILD was killed or crashed without
    // naming a file — a different failure that excluding a file cannot fix.
    if (hangs.length === 0) {
      const why = signal ? `signal ${signal}` : `status ${status}`
      console.error(`shard ${shard}: attempt ${attempts} failed with ${why} and named no file — not retryable by exclusion`)
      console.error(stderr.split("\n").slice(-6).join("\n"))
      return { shard, attempts, excluded: excludedForShard, parsed, sampled, failed: `${why}, named no file` }
    }
    for (const h of hangs) {
      if (!excludedForShard.includes(h)) excludedForShard.push(h)
      allExcluded.add(h)
      exclusionOrigin.set(h, `shard ${shard} attempt ${attempts}`)
    }
    console.log(`shard ${String(shard).padStart(3)}/${SHARDS} died on ${hangs.length} file(s), retrying without ${excludedForShard.length}`)
    for (const h of hangs) console.log(`        excluded: ${h}`)
  }
}

// ---------------------------------------------------------------------- pool
const results: ShardResult[] = []
const allExcluded = new Set<string>()
let totalAttempts = 0

if (CONCURRENCY === 1) {
  for (let shard = 0; shard < SHARDS; shard++) results.push(await runShard(shard))
} else {
  let next = 0
  const worker = async () => {
    for (;;) {
      const shard = next++
      if (shard >= SHARDS) return
      results.push(await runShard(shard))
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, SHARDS) }, () => worker()))
}
results.sort((a, b) => a.shard - b.shard)

const summary = {
  shards: SHARDS, concurrency: CONCURRENCY, totalAttempts,
  completedShards: results.filter((r) => r.parsed > 0).length,
  failedShards: results.filter((r) => r.failed).map((r) => r.shard),
  excluded: [...allExcluded].sort(),
  exclusionOrigin: Object.fromEntries([...exclusionOrigin.entries()].sort()),
  perShard: results,
}

fs.writeFileSync(path.join(OUT_DIR, "walk-summary.json"), JSON.stringify(summary, null, 2))

// ------------------------------------------------------------------- checks
// A partition that produced identical shards is a broken partition. It once failed
// SILENTLY: six copies of shard 0 summed to a plausible-looking total.
//
// The test has to be on the shards' FILE SETS, not on their counts. The first version
// signed on `parsed/sampled:excluded`, and a balanced partition of 312 files into 12
// shards where every file parses signs identically on all 12 — 26/26:0 — so the check
// fired on a healthy 12-shard CONTROL and would have had to be muted, which is how a
// real duplicate would have survived it. A count cannot distinguish "balanced" from
// "duplicated"; a disjoint set can: two shards sharing a digest share every file,
// which a partition cannot do.
function shardDigest(shard: number): string | null {
  const f = path.join(OUT_DIR, `shard-${shard}.json`)
  if (!fs.existsSync(f)) return null
  try {
    const j = JSON.parse(fs.readFileSync(f, "utf8")) as { sampleFiles?: string[] }
    if (!Array.isArray(j.sampleFiles)) return null
    return createHash("sha1").update(j.sampleFiles.slice().sort().join("\n")).digest("hex")
  } catch { return null }
}

const digests = new Map<string, number[]>()
const noDigest: number[] = []
for (const r of results) {
  if (r.parsed === 0) continue
  const d = shardDigest(r.shard)
  if (!d) { noDigest.push(r.shard); continue }
  digests.set(d, [...(digests.get(d) ?? []), r.shard])
}
const duplicates = [...digests.entries()].filter(([, v]) => v.length > 1)

// Overlap: two shards naming the SAME file. The digest test catches a whole shard
// duplicated; this catches a partial one, which is the case a hash would miss.
const seenFile = new Map<string, number>()
const overlaps: string[] = []
for (const r of results) {
  const f = path.join(OUT_DIR, `shard-${r.shard}.json`)
  if (!fs.existsSync(f)) continue
  let list: string[] = []
  try { list = (JSON.parse(fs.readFileSync(f, "utf8")) as { sampleFiles?: string[] }).sampleFiles ?? [] } catch { continue }
  for (const rel of list) {
    const prior = seenFile.get(rel)
    if (prior !== undefined) overlaps.push(`${rel} (shards ${prior} and ${r.shard})`)
    else seenFile.set(rel, r.shard)
  }
}

if (noDigest.length) {
  console.error(`\nPARTITION UNVERIFIED — shards ${noDigest.join(", ")} carry no sampleFiles, so their`)
  console.error(`membership cannot be checked. Re-run them with this census revision to make the`)
  console.error(`check possible; until then the aggregate is UNMEASURED for membership.`)
}
if (duplicates.length) {
  console.error(`\nDEGENERATE PARTITION: ${duplicates.length} group(s) of shards share a FILE-SET digest:`)
  for (const [d, v] of duplicates) console.error(`  sha1 ${d} shared by shards ${v.join(", ")}`)
  console.error(`Disjoint shards cannot share a file set. Treat the aggregate as UNMEASURED.`)
}
if (overlaps.length) {
  console.error(`\nPARTITION OVERLAP: ${overlaps.length} file(s) claimed by more than one shard:`)
  for (const o of overlaps.slice(0, 20)) console.error(`  ${o}`)
  console.error(`A partition must be disjoint. Treat the aggregate as UNMEASURED.`)
}
if (!duplicates.length && !noDigest.length && !overlaps.length) {
  console.log(`\nPARTITION OK — ${results.length} shards, ${digests.size} distinct file-set digests, ${seenFile.size} distinct files, 0 overlaps.`)
}

const failed = results.filter((r) => r.failed)
const measured = results.reduce((a, r) => a + r.parsed, 0)
const attempted = results.reduce((a, r) => a + r.sampled, 0)
console.log(`\nWIDE WALK: ${SHARDS} shards at concurrency ${CONCURRENCY}, ${totalAttempts} child runs`)
if (failed.length) console.log(`FAILED SHARDS (no measurement contributed): ${failed.map((r) => r.shard).join(", ")}`)
console.log(`files attempted ${attempted}   files measured ${measured}   files excluded ${allExcluded.size}`)
console.log(`measured / attempted = ${attempted ? ((measured / attempted) * 100).toFixed(1) : "n/a"}%`)
if (allExcluded.size) {
  console.log(`\nEXCLUDED FILES — these are UNMEASURED, not empty:`)
  for (const f of [...allExcluded].sort()) console.log(`  ${f}    [${exclusionOrigin.get(f) ?? "?"}]`)
  console.log(`\nAn exclusion is a 120s WALL-CLOCK timeout, not a verdict on the file. Re-measure each`)
  console.log(`one alone with:\n  npx tsx script/m14/clean-excluded-probe.mts --in ${OUT_DIR}`)
}
console.log(`\naggregate with:\n  npx tsx script/m14/clean-wide-aggregate.mts --in ${OUT_DIR}`)
if (duplicates.length || noDigest.length || overlaps.length || failed.length) process.exit(3)