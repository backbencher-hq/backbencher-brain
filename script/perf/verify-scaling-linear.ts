// verify-scaling-linear.ts — the gate: cross-file relationship resolution must
// not grow superlinearly in file count.
//
// §3 of docs/IDE-HONESTY-CONTRACT.md makes a measured budget a gate, and §11 F7
// puts the gate BEFORE the fix. This file is that gate. It is written so it can
// fail on the code as it stands (see the selftest below, and the measured
// before-arm in validation/m60/results/scaling-linear.before.json).
//
// ── WHY TWO CHECKS, AND WHY ONE OF THEM USES NO CLOCK ──
//
// The obvious check — "per-file seconds must not grow with N" — is not sound on
// this corpus, and a gate built on it would be theatre. The tier pools are
// nested prefixes of one file ordering (script/perf/make-pools.sh), and that
// ordering is src/ then script/; the src/ files average 279 stored relationships
// each and the script/ files average 66. So tier N's relationship DENSITY per
// file is not constant in N: it rises to N=200 (the src/-only tiers) and then
// FALLS as sparse script/ files enter. Per-file time at 800 files therefore
// looks BETTER than at 100 files on the unfixed code (0.095 s/file vs
// 0.159 s/file, measured) — not because the indexer got faster but because the
// average file got emptier. A per-file bound tuned to that is a bound on the
// FIXTURE, not on the indexer.
//
// So the gate normalises by the quantity the work actually scales with, and it
// checks the algorithmic shape directly:
//
//   CHECK 1 (no clock at all). The rows in the largest intermediate the
//   name-resolution pass MATERIALISED, divided by the number of relationships.
//   This is the candidate fan-out. It is counted by the pass from the table it
//   built (see `ResolvePlanStats` in src/ast/parallel-indexer.ts) and reported on
//   the phase line, so no amount of machine load can move it. A per-relationship
//   resolution must consult a bounded number of candidates; under the window plan
//   it does not, because popular names (`constructor`, `get`, `push`) accumulate
//   one candidate per file, so the ranked join grows with the project and the pass
//   becomes O(rels × N).
//
//   ── WHY THIS NUMBER COMES FROM THE PASS, AND NOT FROM SQL IN THIS FILE ──
//   It used to come from SQL here: a hand-written replica of the window plan's
//   join, which returned 2.87 pairs per relationship at 196 files. That replica
//   describes ONE plan. When the linear plan replaced the join, this gate kept
//   returning the old shape on code that no longer performed the join, so it
//   stayed red and the mismatch read as unexplained. A gate may not certify a
//   plan that is not the one running. The number now comes from the table the
//   live plan materialised, and this file CROSS-CHECKS it against the index:
//   a `window` report must equal the join count measured here, and a `linear`
//   report cannot exceed one row per stored relationship.
//
//   CHECK 2 (clock, normalised). The resolution phase's milliseconds per
//   stored relationship, at the largest tier divided by that at the smallest.
//   Same normaliser as check 1, so the fixture-density artifact cancels. To
//   survive machine noise the tiers run INTERLEAVED (small, large, small, large)
//   and each contributes its MINIMUM, because load only ever adds time; a
//   minimum over repeats is the least contaminated estimator available without
//   controlling for load.
//
// Both bounds are ratios. Neither is an absolute wall-clock number, because this
// machine's p95 has been observed to swing by 2.6× (see the load1 field in
// every record this writes).
//
// ── WHAT THIS GATE DOES NOT CLAIM ──
// It bounds ONE stage: cross-file relationship resolution. It does not bound
// parse time, the store phase, enrichment, gravity or taint, and a passing run
// says nothing about them. `validation/m60/results/scaling-linear.json` records
// the measured per-stage growth so a reader can see which stage is which.
//
// ── CORRECTNESS IS NOT NEGOTIABLE HERE ──
// This gate measures TIME and SHAPE. It cannot see whether the resolution
// picked the same symbol for the same edge — a "faster" resolution that drops
// or re-points an edge passes this gate and is a defect. That check lives in
// script/perf/rel-digest.mjs, which hashes the relationship multiset, and the
// fix's before/after digests are recorded alongside this gate's results.
//
// The before-arm record (validation/m60/results/scaling-linear.before.json) was
// written at the commit that introduced this file, on the unfixed code, and it
// FAILS both checks: fan-out 1.09 → 2.87 (2.64×) and resolve 0.045 → 0.115
// ms/rel (2.55×) over a 4× file increase. That is the gate failing before the
// fix, which §11 F7 requires and without which the gate proves nothing.
//
// Usage:
//   npx tsx script/perf/verify-scaling-linear.ts [--tiers 50,100,200] [--repeat 3]
//   npx tsx script/perf/verify-scaling-linear.ts --selftest
//
// Exit 0 when every check passes, 1 otherwise, and 4 when the run is REFUSED as
// unfalsifiable (fewer than two distinct tiers: both checks are ratios, and a
// ratio of one tier to itself is 1.0 under any bound). Writes its record to
// validation/m60/results/scaling-linear.<label>.json.

import { spawnSync } from "child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "fs"
import { rmSync } from "fs"
import os from "os"
import path from "path"
import { fileURLToPath } from "url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, "../..")
const POOLS = path.join(REPO, ".perf-fixtures/bb-scale")
const SANDBOX = path.join(REPO, ".perf-fixtures/gate")
const RESULTS = path.join(REPO, "validation/m60/results")

// ── The bounds. Declared here, not derived from a run, so a run cannot tune
//    itself into passing. ──
//
// CHECK 1. Measured fan-out growth (joinRows/rels at 200 files ÷ at 50 files) on
// the unfixed code is 2.87 / 1.09 = 2.63 over a 4× file increase. A per-edge
// candidate scan that consults a bounded number of candidates does not grow at
// all; 1.5 admits ordinary candidate-count drift across tiers and rejects the
// unbounded fan-out.
const MAX_FANOUT_GROWTH = 1.5

// CHECK 2. Measured resolve-ms per relationship rose 0.031 (50 files) → 0.167
// (800 files), a 5.4× rise. Two tiers of an O(rels × N) pass on a 4× file
// increase land near 4×; 2.0 admits ordinary cache and page-size drift while
// rejecting it.
const MAX_RESOLVE_MS_PER_REL_GROWTH = 2.0

type Arm = {
  tier: number
  files: number
  rels: number
  syms: number
  /** Which resolution plan the pass reported executing. */
  plan: "window" | "linear"
  /** Rows in the largest intermediate the pass materialised, as reported by it. */
  largestIntermediate: number
  /** The window plan's join, counted from the written index (cross-check only). */
  indexJoinRows: number
  fanout: number
  resolveMs: number
  resolveMsPerRel: number
  wallSecs: number
  /** Load average (1-min) at the moment of the run, or null when unavailable. */
  load1: number | null
}

/** Index one tier in a throwaway data dir and read back the numbers the gate
 *  needs. A fresh BB_DATA_DIR per tier is load-bearing: a warm store skips
 *  parsing and the measurement would describe nothing. */
function measure(tier: number): Arm {
  const dir = path.join(POOLS, `n${tier}`)
  if (!existsSync(dir)) {
    throw new Error(`tier n${tier} has no pool — run script/perf/make-pools.sh ${tier}`)
  }
  const dd = path.join(SANDBOX, `n${tier}`)
  rmSync(dd, { recursive: true, force: true })
  mkdirSync(dd, { recursive: true })
  // Load average is recorded with every measurement because a timing without it
  // is not evidence on this machine (p95 observed to swing 2.6×). Declared
  // absent (null) rather than defaulted to 0: a missing number must not read as
  // an idle machine.
  //
  // Read from `node:os`. It used to shell out to `sysctl -n vm.loadavg`, which is a
  // macOS spelling: on Linux it exited non-zero and every record written there
  // carried `load1: null` — an absent figure where the whole point is to record
  // one. A platform that does not report a real load average (win32 returns
  // `[0, 0, 0]`) reports `null` instead, because a fabricated zero is worse than
  // an absence.
  const load1 = (() => {
    if (process.platform === "win32") return null
    const [one] = os.loadavg()
    return Number.isFinite(one) && one >= 0 ? one : null
  })()

  const t0 = process.hrtime.bigint()
  const r = spawnSync("node", [path.join(REPO, "bin/bb"), "index", dir, "--no-setup"], {
    env: { ...process.env, BB_DATA_DIR: dd, BB_LOG_LEVEL: "warn" },
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
  const wallSecs = Number(process.hrtime.bigint() - t0) / 1e9
  const output = `${r.stdout ?? ""}${r.stderr ?? ""}`
  if (r.status !== 0) {
    throw new Error(`index of n${tier} exited ${r.status}:\n${output.split("\n").slice(-8).join("\n")}`)
  }

  const m = /indexed ([\d,]+) files, ([\d,]+) symbols, ([\d,]+) relationships/.exec(output)
  if (!m) throw new Error(`n${tier}: no summary line in index output`)
  const files = Number(m[1].replace(/,/g, ""))
  const syms = Number(m[2].replace(/,/g, ""))
  const rels = Number(m[3].replace(/,/g, ""))

  if (rels === 0) throw new Error(`n${tier}: the index reports 0 relationships — the per-relationship checks have no denominator`)

  // The phase line carries the plan AND the largest intermediate it materialised.
  // A missing line is a hard failure rather than a skipped tier: §8.3 forbids
  // reporting an unmeasured tier as a pass, and this gate now has nothing else to
  // measure from.
  const resM = /resolved in (\d+)ms \[plan=(none|window|linear) largest-intermediate=(-?\d+)\]/.exec(output)
  if (!resM) {
    throw new Error(
      `n${tier}: no "resolved in Nms [plan=… largest-intermediate=…]" line — the resolution plan is not being reported, ` +
        `so this gate cannot see what ran (resolveRelationships reports it to runPostProcessing)`,)
  }
  const resolveMs = Number(resM[1])
  const plan = resM[2]
  if (plan !== "window" && plan !== "linear") {
    throw new Error(
      `n${tier}: the pass reported plan=${plan}, i.e. it found nothing to resolve. A tier with no resolution is not evidence about resolution.`,
    )
  }
  const reportedLargest = Number(resM[3])
  if (!Number.isFinite(reportedLargest) || reportedLargest < 0) {
    throw new Error(`n${tier}: the pass reported largest-intermediate=${resM[3]}, which is not a measurable count`)
  }

  // The fan-out, counted from the written index: the exact join the resolution
  // pass performs between relationships and same-named symbols. Same predicate
  // as the pass, so this is the number the pass's cost tracks.
  const projects = readdirSync(path.join(dd, "projects"))
  const sqlite = spawnSync("sqlite3", [path.join(dd, "projects", projects[0], "brain.db")], {
    input: `${FANOUT_SQL}\n`,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  })
  if (sqlite.status !== 0) throw new Error(`sqlite3 failed on n${tier}: ${sqlite.stderr}`)
  const rows = sqlite.stdout.trim().split("\n").map((s) => s.split("|"))
  const indexJoinRows = Number(rows[0][0])

  // The cross-check, and the reason the reported number is not taken on faith:
  // `window` materialises exactly the join counted just above, so the two must be
  // equal; the linear plan may not materialise more rows than there are stored
  // relationships to resolve. Either mismatch means the pass's report and the
  // index disagree about what ran, and a gate that cannot notice that will certify
  // a plan that is not in the code.
  if (plan === "window" && reportedLargest !== indexJoinRows) {
    throw new Error(
      `n${tier}: the pass reports the window plan with ${reportedLargest.toLocaleString()} rows against ` +
        `${indexJoinRows.toLocaleString()} counted from the written index — report and index disagree, so neither is measurable`,
    )
  }
  if (plan === "linear" && reportedLargest > rels) {
    throw new Error(
      `n${tier}: the pass reports the linear plan with a largest intermediate of ${reportedLargest.toLocaleString()} against ` +
        `${rels.toLocaleString()} stored relationships — the linear plan materialises at most one row per relationship`,
    )
  }

  return {
    tier,
    files,
    rels,
    syms,
    plan,
    largestIntermediate: reportedLargest,
    indexJoinRows,
    fanout: reportedLargest / rels,
    resolveMs,
    resolveMsPerRel: resolveMs / rels,
    wallSecs,
    load1,
  }
}

// The WINDOW PLAN's candidate count, measured from the written index: the exact
// join that plan's ranked intermediate materialises. It is the second opinion on a
// `window` report and it is NOT what check 1 reads — a replica describes the plan
// it was written against, which is exactly how this gate came to stay red on code
// that no longer performed the join.
//
// Fed on stdin with NO dot-commands: sqlite3's default output mode is already
// `list` with headers off, which is one bare integer per query, and this build
// ships without `.batch` (".help batch" → "Nothing matches"), so a pragma that
// looks harmless is an error here.
const FANOUT_SQL = `SELECT COUNT(*)
FROM brain_relationship r
JOIN brain_symbol s ON s.project_id = r.project_id AND s.name = r.target_external
WHERE r.project_id = (SELECT project_id FROM brain_symbol LIMIT 1)
  AND r.target_external IS NOT NULL
  AND r.relationship_type <> 'contains'
  AND instr(r.target_external, '.') = 0
  AND instr(r.target_external, ':') = 0`

type Check = { name: string; ok: boolean; detail: string; measured: number; bound: number }

/**
 * Evaluate both checks against measured arms. Extracted so `--selftest` can
 * drive it with synthetic numbers — a gate whose only test is a real run cannot
 * be shown to fail without breaking the product, and §8.7 asks for exactly that
 * proof.
 */
function evaluate(arms: Arm[]): Check[] {
  const small = arms[0]
  const large = arms[arms.length - 1]
  const fanoutGrowth = large.fanout / small.fanout
  const resolveGrowth = large.resolveMsPerRel / small.resolveMsPerRel
  return [
    {
      name: "resolution candidate fan-out stays bounded as files grow",
      ok: fanoutGrowth <= MAX_FANOUT_GROWTH,
      measured: fanoutGrowth,
      bound: MAX_FANOUT_GROWTH,
      detail:
        `plans ${small.plan} → ${large.plan}; rows in the largest intermediate per stored relationship: ` +
        `${small.fanout.toFixed(2)} at ${small.files} files → ${large.fanout.toFixed(2)} at ${large.files} files ` +
        `(${fanoutGrowth.toFixed(2)}× over ${(large.files / small.files).toFixed(0)}× the files; bound ${MAX_FANOUT_GROWTH}×). ` +
        `Counted by the pass from the table it built, so no machine load enters this number.`,
    },
    {
      name: "resolution cost per stored relationship stays bounded as files grow",
      ok: resolveGrowth <= MAX_RESOLVE_MS_PER_REL_GROWTH,
      measured: resolveGrowth,
      bound: MAX_RESOLVE_MS_PER_REL_GROWTH,
      detail:
        `resolve ms per relationship: ${small.resolveMsPerRel.toFixed(4)} at ${small.files} files → ` +
        `${large.resolveMsPerRel.toFixed(4)} at ${large.files} files (${resolveGrowth.toFixed(2)}×; bound ` +
        `${MAX_RESOLVE_MS_PER_REL_GROWTH}×). Minimum over interleaved repeats; load1 was ` +
        `${small.load1 ?? "unavailable"} (small tier) / ${large.load1 ?? "unavailable"} (large tier).`,
    },
  ]
}

// ── --selftest: the gate must be able to fail ──
//
// Three synthetic arms plus a planted regression, asserted against `evaluate`.
// The planted arm is the shape the unfixed code produces (fan-out and per-edge
// cost both rising with file count); the passing arm is the shape the fixed code
// produces. If `evaluate` cannot tell them apart, this gate cannot fail and the
// whole file is decoration.
function selftest(): number {
  const mk = (
    tier: number,
    files: number,
    rels: number,
    largestIntermediate: number,
    resolveMs: number,
    plan: "window" | "linear",
  ): Arm => ({
    tier,
    files,
    rels,
    syms: Math.round(rels / 5),
    plan,
    largestIntermediate,
    // `evaluate` bounds the reported fan-out, never this cross-check number, so a
    // selftest arm only has to be internally consistent (equal, as a window arm's
    // must be, and as the cross-check would require of it in `measure`).
    indexJoinRows: largestIntermediate,
    fanout: largestIntermediate / rels,
    resolveMs,
    resolveMsPerRel: resolveMs / rels,
    wallSecs: 0,
    load1: null,
  })

  // A linear arm: the largest intermediate is a per-name aggregate, so it stays
  // under one row per stored relationship at both tiers — the shape the
  // three-aggregate plan produces and the cross-check enforces.
  const linearArms = [mk(50, 47, 7920, 4750, 246, "linear"), mk(200, 196, 61333, 35151, 1900, "linear")]
  // The PLANTED REGRESSION: candidate fan-out per relationship grows with the
  // project (1.09 → 2.87) and per-edge resolution cost follows it. These are the
  // measured numbers of the unfixed name-resolution pass, not inventions.
  const plantedArms = [mk(50, 47, 7920, 8598, 246, "window"), mk(200, 196, 61333, 175869, 4335, "window")]

  let failures = 0
  const linear = evaluate(linearArms)
  for (const c of linear) {
    if (!c.ok) {
      failures++
      console.log(`  FAIL (selftest): ${c.name} rejected a LINEAR arm — the bound is too tight to be usable. ${c.detail}`)
    } else {
      console.log(`  ok (selftest): ${c.name} accepts a linear arm (measured ${c.measured.toFixed(2)}×, bound ${c.bound}×)`)
    }
  }
  const planted = evaluate(plantedArms)
  for (const c of planted) {
    if (c.ok) {
      failures++
      console.log(`  FAIL (selftest): ${c.name} ACCEPTED the planted regression (${c.measured.toFixed(2)}×) — this check cannot fail.`)
    } else {
      console.log(`  ok (selftest): ${c.name} rejects the planted regression (measured ${c.measured.toFixed(2)}×, bound ${c.bound}×)`)
    }
  }
  // A third arm: everything about file count grows, but the normalised cost does
  // not. This is the fixture-density artifact — 800 sparse files can legitimately
  // have MORE relationships than 200 dense ones while the indexer is linear.
  const densityArms = [mk(100, 97, 16522, 10000, 687, "linear"), mk(800, 796, 121782, 80275, 4040, "linear")]
  const density = evaluate(densityArms)
  for (const c of density) {
    if (!c.ok) {
      failures++
      console.log(`  FAIL (selftest): ${c.name} rejected a fixture-density change (${c.measured.toFixed(2)}×) — it is measuring the fixture, not the indexer.`)
    } else {
      console.log(`  ok (selftest): ${c.name} is unmoved by a 7.4× change in relationships-per-file (${c.measured.toFixed(2)}×)`)
    }
  }
  console.log(failures === 0 ? "selftest: PASS" : `selftest: ${failures} FAILURE(S)`)
  return failures
}

function parseArgs(argv: string[]) {
  let tiers = [50, 200]
  let repeat = 3
  let label = "current"
  let selftestOnly = false
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--tiers") tiers = argv[++i].split(",").map(Number)
    else if (argv[i] === "--repeat") repeat = Number(argv[++i])
    else if (argv[i] === "--label") label = argv[++i]
    else if (argv[i] === "--selftest") selftestOnly = true
  }
  tiers.sort((a, b) => a - b)
  return { tiers, repeat, label, selftestOnly }
}

const { tiers, repeat, label, selftestOnly } = parseArgs(process.argv.slice(2))

if (selftestOnly) {
  process.exit(selftest() === 0 ? 0 : 1)
}

// A run with fewer than two DISTINCT tiers makes both checks ratios of a number
// to itself — 1.0, under any bound — so it passes by construction and can only
// ever be decoration. Refused rather than recorded, the same way
// script/m14/run-fixtures.ts refuses a scoped lane run: a milestone claim may not
// rest on a run that could not have failed.
if (new Set(tiers).size < 2) {
  console.error(
    `refusing --tiers ${tiers.join(",")}: both checks are ratios between the smallest and the largest tier, ` +
      `so fewer than two distinct tiers pass them by construction. Use e.g. --tiers 50,200.`,
  )
  process.exit(4)
}

console.log(`scaling gate: tiers ${tiers.join(", ")}, ${repeat} interleaved repeats, arm "${label}"`)
const best = new Map<number, Arm>()
// Interleaved: small, large, small, large. A run of one tier to completion and
// then the other would let a load spike land entirely on one of them; alternating
// spreads any drift across both, and taking the minimum discards it.
for (let r = 0; r < repeat; r++) {
  for (const t of tiers) {
    const arm = measure(t)
    const prev = best.get(t)
    // The minimum is over resolveMsPerRel and joinRows together: the normalised
    // cost is what the gate bounds, and the join count is deterministic, so the
    // two always agree on which repeat was cleanest.
    if (!prev || arm.resolveMsPerRel < prev.resolveMsPerRel) best.set(t, arm)
    console.log(
      `  repeat ${r + 1}/${repeat} n${t}: ${arm.files} files, ${arm.rels.toLocaleString()} rels, ` +
        `fanout ${arm.fanout.toFixed(2)}, resolve ${arm.resolveMs}ms ` +
        `(${arm.resolveMsPerRel.toFixed(4)} ms/rel), wall ${arm.wallSecs.toFixed(1)}s, load1 ${arm.load1}`,
    )
  }
}

const arms = tiers.map((t) => best.get(t)!)
const checks = evaluate(arms)

console.log("")
let failures = 0
for (const c of checks) {
  if (c.ok) console.log(`  PASS  ${c.name}`)
  else {
    failures++
    console.log(`  FAIL  ${c.name}`)
  }
  console.log(`        ${c.detail}`)
}

// The record. §8.4: every claim field carries currentCommit, sourceFingerprint,
// verifierCommand, evidenceFile, generatedAt, counts, negativeCases,
// limitations. §8.3: nothing here is skipped or deferred — a tier that could not
// be measured throws above rather than being reported as a pass.
const commit = spawnSync("git", ["rev-parse", "HEAD"], { cwd: REPO, encoding: "utf8" }).stdout.trim()
const fingerprint = spawnSync("git", ["status", "--porcelain", "src/"], { cwd: REPO, encoding: "utf8" }).stdout.trim()
const record = {
  gate: "scaling-linear",
  claim: "cross-file relationship resolution cost per stored relationship does not grow superlinearly in file count",
  arm: label,
  generatedAt: new Date().toISOString(),
  currentCommit: commit,
  sourceFingerprint: fingerprint === "" ? "clean" : fingerprint,
  verifierCommand: `npx tsx script/perf/verify-scaling-linear.ts --tiers ${tiers.join(",")} --repeat ${repeat} --label ${label}`,
  // The arm's own file. Naming a single canonical path here would be a lie the
  // moment a before/after pair exists, which is the normal case for this gate.
  evidenceFile: `validation/m60/results/scaling-linear.${label}.json`,
  machine: {
    platform: process.platform,
    arch: process.arch,
    // `node:os` rather than the macOS-only `sysctl` spellings this used: on Linux
    // those returned EMPTY strings, so a record written here named no machine at
    // all — and a timing whose machine is unnamed is not reproducible evidence.
    cpus: String(os.cpus().length),
    model: os.cpus()[0]?.model?.trim() ?? "",
    node: process.version,
  },
  bounds: { maxFanoutGrowth: MAX_FANOUT_GROWTH, maxResolveMsPerRelGrowth: MAX_RESOLVE_MS_PER_REL_GROWTH },
  tiers,
  repeats: repeat,
  arms,
  passed: checks.filter((c) => c.ok).length,
  failed: checks.filter((c) => !c.ok).length,
  checks,
  negativeCases: [
    "selftest: a linear arm is ACCEPTED by both checks (a bound so tight it rejects correct code would be unusable)",
    "selftest: the PLANTED REGRESSION arm (fan-out 1.09→2.87, the measured shape of the unfixed name-resolution pass) is REJECTED by both checks",
    "selftest: a fixture-density change (97 files/16,522 rels → 796 files/121,782 rels, a 7.4× change in relationships-per-file) is NOT rejected — proving the gate measures the indexer and not the pool's file density",
  ],
  limitations: [
    "Check 1's number is reported by the pass about itself, so it is instrumented rather than independent; a pass that claimed a plan it did not run would still have to survive the index cross-check and check 2's clock.",
    "Bounds ONE stage: cross-file relationship resolution. Parse, the store phase, enrichment, gravity and taint are measured in the record but not gated.",
    "The checks are ratios between the smallest and largest tier; a regression that costs a constant factor at every size passes.",
    "Check 2 reads milliseconds, so it is load-sensitive by construction; the minimum over interleaved repeats bounds that sensitivity but does not remove it. Check 1 uses no clock.",
    "Tier pools are copies of this repository's own source files, so the numbers describe TypeScript-in-TS. Other languages have different relationship densities.",
    "This gate cannot see whether resolution attached the same target to the same edge. The relationship-multiset digests in script/perf/rel-digest.mjs carry that claim.",
  ],
}

mkdirSync(RESULTS, { recursive: true })
const out = path.join(RESULTS, `scaling-linear.${label}.json`)
writeFileSync(out, JSON.stringify(record, null, 2) + "\n")
console.log(`\nrecord: ${path.relative(REPO, out)}`)
console.log(failures === 0 ? `PASS (${checks.length}/${checks.length})` : `FAIL (${checks.filter((c) => c.ok).length}/${checks.length})`)
process.exit(failures === 0 ? 0 : 1)
