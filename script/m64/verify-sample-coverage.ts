// script/m64/verify-sample-coverage.ts — the freshness-sample property, as a test.
//
// Three implementations were tried, and the gate exists because the first two
// each failed a different way:
//
//   `ORDER BY relative_path LIMIT n`  a PREFIX. On this repo's 1,654-file index
//       the first 200 were 189 docs/ files and ZERO of 166 src/ files — the
//       first src/ file is at rank 1452. The default freshness answer was
//       structurally an answer about Markdown. Deterministic, biased, useless.
//   `ORDER BY RANDOM() LIMIT n`       unbiased but not reproducible: five
//       integrity calls on one index gave 21,17,22,19,16 for a true 40 of 400,
//       and the 10% warn/error threshold fell between them.
//   `ROW_NUMBER() ... % k = 0`        deterministic and spread, but ALIASES
//       with a period in the file ordering: against a corpus with every 10th
//       file edited it reported a 20.0% drift rate for a true 10.0%.
//
// What ships is a deterministic pseudo-random sample (selectSampleFiles in
// src/brain/freshness.ts). The properties below are the ones that actually
// matter, and each names the failure mode it rules out.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../src/util/project-id"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { getUnifiedHealth } from "../../src/intelligence/health/health-provider"
import { selectSampleFiles } from "../../src/brain/freshness"

const out = (...a: unknown[]) => console.log(...a)
let failures = 0
const ck = (name: string, pass: boolean, detail: string) => {
  out(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`)
  if (!pass) failures++
}

async function build(dirs: string[], per: number) {
  const root = mkdtempSync(path.join(tmpdir(), "bb-h64-sample-"))
  for (const d of dirs) mkdirSync(path.join(root, d), { recursive: true })
  let i = 0
  for (const d of dirs) for (let k = 0; k < per; k++) writeFileSync(path.join(root, d, `f${String(i++).padStart(4, "0")}.ts`), `export function fn${i}(): number { return ${i} }\n`)
  const pid = getProjectId(root)
  await indexProjectParallel(pid as any, root, {})
  return { root, pid }
}
const clean = (root: string, pid: string) => {
  try { rmSync(path.dirname(BrainDatabase.getDbPath(pid as any)), { recursive: true, force: true }) } catch {}
  rmSync(root, { recursive: true, force: true })
}
const staledPaths = (root: string) => readFileSync(path.join(root, ".staled"), "utf8").split("\n").filter(Boolean)
const markStaled = (root: string, rels: string[]) => {
  for (const p of rels) {
    const abs = path.join(root, p)
    writeFileSync(abs, readFileSync(abs, "utf8") + "\n// staled\n")
  }
  writeFileSync(path.join(root, ".staled"), rels.join("\n"))
}
const allRows = async (pid: string) => {
  const raw = await BrainDatabase.getRawInstance(pid as any)
  return raw.prepare("SELECT id, relative_path FROM brain_file WHERE project_id=?").all(pid) as any[]
}

/** Draws further than `sigmas` binomial standard errors from `p`. */
function beyond(rates: number[], p: number, sigmas: number): number {
  const se = Math.sqrt((p * (1 - p)) / 200)
  return rates.filter((r) => Math.abs(r - p) > sigmas * se).length
}

// ── 1. the sample spans the whole range, not a prefix ───────────────────────
{
  const { root, pid } = await build(["aaa", "zzz"], 30)
  try {
    const rows = await allRows(pid)
    const sorted = [...rows].sort((a, b) => (a.relative_path < b.relative_path ? -1 : 1))
    const SAMPLE = 20
    const chosen = selectSampleFiles(rows, SAMPLE)
    const ranks = chosen.map((r) => sorted.findIndex((s) => s.id === r.id))
    out(`index ${sorted.length} files; sample ranks: ${ranks.slice().sort((a, b) => a - b).join(",")}`)
    // "Not a prefix" is a DETERMINISTIC property and is the actual defect, so it
    // is asserted as such: compare the selection against the first N in sort
    // order and require that they differ.
    //
    // The earlier version of this check asserted "max sampled rank >= length-5",
    // which is a per-draw assertion on a RANDOM quantity and fails at random —
    // the exact mistake this file's section 2 was written to avoid. It passed
    // three runs and failed the fourth (max rank 53 of 59, an ordinary draw for
    // 20 of 60). A gate that fails at random trains people to ignore it, and the
    // span is now checked as a distribution below instead.
    const prefix = sorted.slice(0, SAMPLE).map((r) => r.id).join("|")
    ck("the sample is NOT the first N files in sort order", chosen.map((r) => r.id).join("|") !== prefix, `the old LIMIT-prefix was exactly those ${SAMPLE} rows; this selection is a different set`)
    // Coverage of both trees: with a 30/30 split and k=20 the chance of drawing
    // all 20 from one side is 2^-19, so this is a sound assertion, and it is the
    // failure the real repo exhibited (0 of 166 src/ files).
    ck("the sample covers BOTH trees", chosen.some((r) => r.relative_path.startsWith("aaa/")) && chosen.some((r) => r.relative_path.startsWith("zzz/")), `${chosen.filter((r) => r.relative_path.startsWith("aaa/")).length} aaa / ${chosen.filter((r) => r.relative_path.startsWith("zzz/")).length} zzz`)
    // Span as a DISTRIBUTION, over many draws, which is the honest form of the
    // property the per-draw check was trying to test.
    {
      const maxRanks: number[] = []
      for (let d = 0; d < 200; d++) {
        const variant = rows.map((r) => ({ id: `${r.id}~${d}`, relative_path: r.relative_path }))
        const pick = selectSampleFiles(variant, SAMPLE)
        maxRanks.push(Math.max(...pick.map((r) => sorted.findIndex((s) => s.id === r.id.replace(`~${d}`, "")))))
      }
      const sortedMax = [...maxRanks].sort((a, b) => a - b)
      const median = sortedMax[Math.floor(sortedMax.length / 2)]
      const tail = sorted.length - 5
      const within5 = maxRanks.filter((m) => m >= tail).length
      // The rate is a property of the draw, not a target: for k of n uniform
      // draws the chance the maximum lands in the last 5 of 60 is ~89%, and the
      // first version of this check asserted 95% and failed on 179/200. The
      // MEDIAN is the stable statistic, and the contrast that matters is
      // against a prefix, which reaches rank 19 on 200 of 200 draws.
      ck("the sample TYPICALLY reaches the tail of the range", median >= tail, `median max rank ${median} of ${sorted.length - 1}; ${within5}/200 draws (${Math.round((within5 / 200) * 100)}%) reached the last 5, which is the exact hypergeometric rate for ${SAMPLE} of ${sorted.length}`)
      ck("and it reaches further than a prefix EVER can, on essentially every draw", maxRanks.filter((m) => m > SAMPLE - 1).length >= 195, `${maxRanks.filter((m) => m > SAMPLE - 1).length}/200 draws exceeded rank ${SAMPLE - 1}; the old LIMIT-prefix exceeded it on 0`)
    }

    // Stale everything the sample chose; the sample must FIND it, wherever it is.
    markStaled(root, chosen.map((r) => r.relative_path))
    const beyondPrefix = chosen.filter((r) => sorted.findIndex((s) => s.id === r.id) >= SAMPLE).length
    const r = await getUnifiedHealth(pid, root, { freshness: "sampled", sampleSize: SAMPLE })
    ck("the sampled check FINDS stale files across the whole range", r.freshness.stale === SAMPLE, `stale=${r.freshness.stale} of ${SAMPLE} sampled (${beyondPrefix} of them sit beyond rank ${SAMPLE - 1}, unreachable by the old prefix)`)
    ck("every reported stale file is one that was really staled", r.freshness.staleFiles.slice().sort().join("|") === chosen.map((x) => x.relative_path).sort().join("|"), `${r.freshness.staleFiles.length} paths`)
    ck("the report marks the check as a SAMPLE", r.freshness.mode === "sampled" && r.freshness.isComplete === false, `mode=${r.freshness.mode} isComplete=${r.freshness.isComplete}`)
    ck("the STALE_FILES warning says it is a lower bound, not a total", r.warnings.some((w) => w.code === "STALE_FILES" && /LOWER BOUND/i.test(w.message)), r.warnings.find((w) => w.code === "STALE_FILES")?.message?.slice(0, 95) ?? "missing")

    // Complete mode is the exact answer, and it is at least the sample.
    const comp = await getUnifiedHealth(pid, root, { freshness: "complete" })
    ck("complete mode reports the exact count", comp.freshness.stale === SAMPLE && comp.freshness.isComplete, `stale=${comp.freshness.stale}/${comp.freshness.total}`)
    ck("the sampled count is a LOWER BOUND on the complete count", r.freshness.stale <= comp.freshness.stale, `sampled=${r.freshness.stale} complete=${comp.freshness.stale}`)

    // Determinism: identical state must give an identical answer.
    const runs = await Promise.all([1, 2, 3, 4, 5].map(() => getUnifiedHealth(pid, root, { freshness: "sampled", sampleSize: SAMPLE })))
    ck("five concurrent identical calls agree exactly", new Set(runs.map((x) => `${x.freshness.fresh}/${x.freshness.stale}/${x.freshness.staleFiles.join("|")}`)).size === 1, `${new Set(runs.map((x) => x.freshness.staleFiles.join("|"))).size} distinct answer(s)`)

    // Asking for everything must not be labelled a sample.
    const all = await getUnifiedHealth(pid, root, { freshness: "sampled", sampleSize: rows.length })
    ck("sampleSize >= file count is reported as complete, not sampled", all.freshness.mode === "complete" && all.freshness.isComplete, `mode=${all.freshness.mode} checked=${all.freshness.checked}/${all.freshness.total}`)
  } finally { clean(root, pid) }
}

// ── 2. the sample does not ALIAS with a period in the file ordering ────────
// The property that killed the stride, kept as a regression test. Stale exactly
// every 10th file and the sampled rate must track 10%.
//
// This is a property of the SELECTOR, so it is tested on the selector directly
// with many independent draws rather than on one indexed corpus. A single draw
// of n=200 has a ~2.1pp standard error, so a single-draw tolerance would be a
// flaky gate — and worse, a gate that fails at random trains people to ignore
// it. Unbiasedness is a statement about the mean of many draws.
//
// 300 draws over a 4,000-file population. For contrast, a 1-in-20 stride lands
// on exactly 20.0% EVERY draw here (every 10th index is every 2nd sampled
// index), which is what "aliased" means: a deterministic answer that is
// consistently wrong by a factor of two.
{
  const N = 4000, PERIOD = 10, TRUTH = 1 / PERIOD
  const rows = Array.from({ length: N }, (_, i) => ({ id: `id-${i}`, relative_path: `p/${String(i).padStart(5, "0")}.ts` }))
  const isStaleIdx = (i: number) => i % PERIOD === 0
  const idxOf = new Map(rows.map((r, i) => [r.id, i]))
  const DRAWS = 300
  const rates: number[] = []
  for (let d = 0; d < DRAWS; d++) {
    // Vary the id space so each draw is an independent sample, exactly as a
    // different repository would be.
    const variant = rows.map((r) => ({ id: `${r.id}#${d}`, relative_path: r.relative_path }))
    const picked = selectSampleFiles(variant, 200)
    rates.push(picked.filter((p) => isStaleIdx(idxOf.get(p.id.split("#")[0]!)!)).length / picked.length)
  }
  const mean = rates.reduce((a, b) => a + b, 0) / rates.length
  const min = Math.min(...rates), max = Math.max(...rates)
  out(`300 independent draws of n=200 over ${N} files, every ${PERIOD}th stale (true ${(TRUTH * 100).toFixed(1)}%): mean ${(mean * 100).toFixed(2)}%, range ${(min * 100).toFixed(1)}%..${(max * 100).toFixed(1)}%`)
  ck("the sampled rate is UNBIASED on a periodic corpus", Math.abs(mean - TRUTH) < 0.005, `mean ${(mean * 100).toFixed(2)}% vs true ${(TRUTH * 100).toFixed(1)}% (a 1-in-20 stride returns exactly 20.0% on every draw — double the truth, consistently)`)
  ck("no draw is aliased to a multiple of the truth", max < TRUTH * 1.6, `max single draw ${(max * 100).toFixed(1)}%; a stride would put every draw at ${(TRUTH * PERIOD / 2 * 100).toFixed(0)}%`)
  ck("the spread is ordinary sampling error, not a systematic offset", beyond(rates, TRUTH, 3) <= Math.ceil(DRAWS * 0.01), `${beyond(rates, TRUTH, 3)} of ${DRAWS} draws beyond +/-3 standard errors (expected ~${(DRAWS * 0.0027).toFixed(1)}; a per-draw band here would fail at random and train people to ignore the gate)`)

  // The same population, a different period, to show it is not fitted to 10.
  for (const period of [3, 7, 25]) {
    const truth = 1 / period
    const ms: number[] = []
    for (let d = 0; d < 200; d++) {
      const variant = rows.map((r) => ({ id: `${r.id}#p${period}-${d}`, relative_path: r.relative_path }))
      const picked = selectSampleFiles(variant, 200)
      ms.push(picked.filter((p) => Number(p.id.split("#")[0]!.slice(3)) % period === 0).length / picked.length)
    }
    const m = ms.reduce((a, b) => a + b, 0) / ms.length
    ck(`unbiased at period ${period} too (not fitted to one stride)`, Math.abs(m - truth) < 0.006, `mean ${(m * 100).toFixed(2)}% vs true ${(truth * 100).toFixed(1)}%`)
  }
}

// ── 3. the selection is a pure function of the id set ──────────────────────
{
  const rows = Array.from({ length: 5000 }, (_, i) => ({ id: `id-${i}`, relative_path: `p/${String(i).padStart(5, "0")}.ts` }))
  const a = selectSampleFiles(rows, 137).map((r) => r.id)
  const reversed = [...rows].reverse()
  const b = selectSampleFiles(reversed, 137).map((r) => r.id)
  const c = selectSampleFiles(rows, 137).map((r) => r.id)
  ck("the same set yields the same sample", a.join("|") === c.join("|"), "")
  ck("the INPUT ORDER does not change the sample", a.slice().sort().join("|") === b.slice().sort().join("|"), `${a.length} ids`)
  ck("the sample size is honoured exactly", a.length === 137 && new Set(a).size === 137, `${a.length} selected, ${new Set(a).size} distinct`)
  ck("asking for more than exists returns everything, once", selectSampleFiles(rows, 99999).length === rows.length, `${selectSampleFiles(rows, 99999).length}`)
  ck("the result is ordered by path for a stable report", selectSampleFiles(rows, 5).map((r) => r.relative_path).join(",") === [...selectSampleFiles(rows, 5).map((r) => r.relative_path)].sort().join(","), selectSampleFiles(rows, 5).map((r) => r.relative_path).join(","))
  // Distribution: a 10% slice should land near 10% of the population, and not
  // concentrate in one region of the ordering.
  const sel = new Set(selectSampleFiles(rows, 500).map((r) => r.id))
  const buckets = Array.from({ length: 10 }, (_, b) => rows.filter((r) => Math.floor(Number(r.id.slice(3)) / 500) === b && sel.has(r.id)).length)
  ck("the sample is spread across the whole ordering (10 buckets of 50)", buckets.every((n) => n > 20), `per-bucket ${buckets.join(",")} (expected ~50 each; a prefix would give 500,0,0,0,0,0,0,0,0,0)`)
  void staledPaths
}

out(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`)
process.exit(failures === 0 ? 0 : 1)
