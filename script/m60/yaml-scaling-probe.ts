// script/m60/yaml-scaling-probe.ts — is the analyzer actually O(n)?
//
// WHY NOT ANOTHER ms/FILE NUMBER
// ------------------------------
// The complexity envelope in validation/m12/results/yaml-complexity.json was measured at
// load1 ≈ 31 on 8 cores, so its own load rule marks it `loadQuiet: false` and declares the
// wall/throughput figures ADVISORY. That is the correct call by that rule, and it leaves
// the lane's performance claim resting on a number nobody can defend: a second run on a
// differently-loaded box would produce a different "ms per file" and neither would be
// wrong.
//
// So this probe measures the thing contention cannot touch: the EXPONENT. Time is
// `k · n^e` for work proportional to input, quadratic for work that is not. Load inflates
// `k` and leaves `e` alone, so a fitted exponent of ~1.0 is a load-independent statement
// that the hot path is linear, and it is the claim "best complexity" actually means. An
// absolute throughput number is a property of the machine; an exponent is a property of
// the code.
//
// THE METHOD, and why it is this method
// ------------------------------------
//   * MINIMUM of N repetitions, not the mean. Contention can only ever ADD time, so the
//     fastest observed run is the closest to the true cost. A mean on a loaded box
//     measures the scheduler, not the analyzer.
//   * Each size is measured with the SAME process, parser and wasm, so the constant `k`
//     is shared and only the size varies.
//   * Three SHAPES, because "linear on wide mappings" and "linear on deep nesting" are
//     different claims and a single shape would let one hide the other. A wide mapping
//     stresses sibling lookups; deep nesting stresses the recursion; a many-relationship
//     document stresses dedupe. The rewrite replaced two O(n·m) scans with walk-built
//     indexes, and this is the instrument that would notice if that regressed.
//   * The fit is a least-squares line through log(time) vs log(keys), and `e` is its
//     slope. The gate is `e <= 1.35` — deliberately looser than 1.0, because a fixed
//     per-file cost (parser construction, wasm dispatch) makes the measured exponent sit
//     slightly UNDER 1 at small sizes and slightly above at large ones, and a gate that
//     demanded exactly 1.0 would be a gate that fails on measurement noise.
//
// Usage: bun run script/m60/yaml-scaling-probe.ts [--reps=7] [--max-keys=32768]
// Writes: validation/m60/results/yaml-scaling.json
import { execFileSync } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../src/ast/pool-worker"

// Two levels up from script/m60/ is the REPO ROOT. One level up is `script/`, which is
// where the first version wrote its artifact — so the run printed a relative path that
// looked correct and produced no file at the path anything else reads.
const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const TMP = path.join(ROOT, ".yaml-scaling-tmp")
const OUT = path.join(ROOT, "validation/m60/results/yaml-scaling.json")

const arg = (n: string, d: number) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`))
  return hit ? Number(hit.slice(n.length + 3)) : d
}
const REPS = arg("reps", 7)
const MAX_KEYS = arg("max-keys", 16384)
// 16,384 keys is the largest that keeps every shape under the 1 MB content truncation in
// engine.ts, so no point has to be rejected for being empty.
const SIZES = [1024, 2048, 4096, 8192, 16384].filter((n) => n <= MAX_KEYS)

/** A WIDE document: one mapping with `n` sibling keys. Stresses sibling lookup. */
function wide(n: number): string {
  const out: string[] = ["kind: ScalingFixture", "metadata:", "  name: wide", "spec:"]
  for (let i = 0; i < n; i++) out.push(`  key${i}: value${i}`)
  return out.join("\n") + "\n"
}

/** A DEEP document: `n` levels of nesting. Stresses the recursion and qualified names. */
function deep(n: number): string {
  const out: string[] = ["kind: ScalingFixture", "spec:"]
  const indent = (k: number) => "  ".repeat(k)
  for (let k = 0; k < n; k++) out.push(`${indent(k)}level${k}:`)
  out.push(`${indent(n)}leaf: end`)
  return out.join("\n") + "\n"
}

/** A WIDE-RELATIONSHIP document: many anchors, so every alias resolves to one. */
function anchors(n: number): string {
  const out: string[] = ["kind: ScalingFixture", "spec:"]
  for (let i = 0; i < n; i++) {
    out.push(`  base${i}:`)
    out.push(`    leaf: value${i}`)
  }
  for (let i = 0; i < n; i++) out.push(`  use${i}: *base${i}`)
  return out.join("\n") + "\n"
}

/** WIDE: one mapping, n sibling keys. The control — the base path with no YAML features. */
function wide(n: number): string {
  const out: string[] = ["kind: ScalingFixture", "metadata:", "  name: wide", "spec:"]
  for (let i = 0; i < n; i++) out.push(`  key${i}: value${i}`)
  return out.join("\n") + "\n"
}

/** NESTED2: two levels. Separates "wide siblings" from "one parent with many children". */
function nested2(n: number): string {
  const out: string[] = ["kind: ScalingFixture", "spec:"]
  for (let i = 0; i < n; i++) out.push(`  k${i}:`, `    leaf: v${i}`)
  return out.join("\n") + "\n"
}

/** ANCHORS_ONLY: n anchors, NO aliases. Is the cost in anchor REGISTRATION or in RESOLUTION? */
function anchorsOnly(n: number): string {
  const out: string[] = ["kind: ScalingFixture", "spec:"]
  for (let i = 0; i < n; i++) out.push(`  base${i}:`, `    leaf: v${i}`)
  return out.join("\n") + "\n"
}

/** ALIAS_ONE: n aliases resolving to ONE anchor. Resolution work that is O(1) per alias. */
function aliasOne(n: number): string {
  const out: string[] = ["kind: ScalingFixture", "spec:", "  base:", "    leaf: v"]
  for (let i = 0; i < n; i++) out.push(`  use${i}: *base`)
  return out.join("\n") + "\n"
}

/** ALIAS_DISTINCT: n anchors and n DISTINCT aliases. The shape the probe found quadratic. */
function aliasDistinct(n: number): string {
  const out: string[] = ["kind: ScalingFixture", "spec:"]
  for (let i = 0; i < n; i++) out.push(`  base${i}:`, `    leaf: v${i}`)
  for (let i = 0; i < n; i++) out.push(`  use${i}: *base${i}`)
  return out.join("\n") + "\n"
}

/** MERGE_HEAVY: n merge keys. The other inherited-content path. */
function mergeHeavy(n: number): string {
  const out: string[] = ["kind: ScalingFixture", "spec:", "  base:", "    leaf: v"]
  for (let i = 0; i < n; i++) out.push(`  m${i}: {<<: *base, own${i}: x}`)
  return out.join("\n") + "\n"
}

const SHAPES: Record<string, (n: number) => string> = {
  wide,
  nested2,
  anchorsOnly,
  aliasOne,
  aliasDistinct,
  mergeHeavy,
}
function leastSquares(xs: number[], ys: number[]): { slope: number; intercept: number } {
  const n = xs.length
  const mx = xs.reduce((a, b) => a + b, 0) / n
  const my = ys.reduce((a, b) => a + b, 0) / n
  let num = 0
  let den = 0
  for (let i = 0; i < n; i++) {
    num += (xs[i]! - mx) * (ys[i]! - my)
    den += (xs[i]! - mx) ** 2
  }
  return { slope: num / den, intercept: my - (num / den) * mx }
}

/**
 * Time every size ONCE PER PASS, and take the per-size MINIMUM across passes.
 *
 * The first version of this probe timed every repetition of size A, then every repetition
 * of size B, and reported `deep` and `anchors` as superlinear on the strength of a
 * per-key cost that rose 772 -> 10705 us. That reading was wrong twice over. The 32768-key
 * points were EMPTY (engine.ts:1168 truncates content at 1 MB, so a 1.8 MB fixture parsed
 * nothing and reported 57 ms), and an empty point in a log-log fit does not degrade the fit,
 * it annihilates it — which is how a corpus of collapsed points produced a confident
 * "all shapes linear". Separately, a `plain` fixture with no anchors, no aliases and no
 * merges showed the same rising per-key cost, which located the effect in the BASE path
 * rather than in any YAML feature.
 *
 * The remaining suspect is the MEASUREMENT. Under load ~40 on 8 cores a longer run
 * accumulates more descheduling, so a bigger input is penalised for taking longer, and
 * "per-key cost rises with size" is exactly what that bias manufactures. Min-of-N reduces
 * the penalty; it cannot remove it, because the minimum is still gated by the scheduler.
 *
 * So sizes are INTERLEAVED — one pass times every size in turn, and the minimum is taken
 * per size across passes — and the verdict is the PAIRED RATIO between consecutive sizes,
 * measured inside the same pass. A linear analyzer doubles when the input doubles
 * (ratio ~2); a quadratic one quadruples (ratio ~4). Load drift moves both arms of a pair
 * together, so the ratio survives it in a way that an absolute per-key cost cannot.
 */
async function measureAll(files: Array<{ keys: number; file: string }>): Promise<Map<number, { min: number; max: number; spread: number[]; symbols: number; relationships: number }>> {
  const acc = new Map<number, { min: number; max: number; spread: number[]; symbols: number; relationships: number }>()
  for (const { keys, file } of files) {
    await parseFile(file, ROOT) // untimed warm-up: wasm load is not part of the sample
    acc.set(keys, { min: Infinity, max: 0, spread: [], symbols: 0, relationships: 0 })
  }
  for (let pass = 0; pass < REPS; pass++) {
    for (const { keys, file } of files) {
      const t0 = performance.now()
      const parsed: any = await parseFile(file, ROOT)
      const ms = performance.now() - t0
      const slot = acc.get(keys)!
      slot.min = Math.min(slot.min, ms)
      slot.max = Math.max(slot.max, ms)
      slot.spread.push(+ms.toFixed(1))
      slot.symbols = (parsed.symbols ?? []).length
      slot.relationships = (parsed.relationships ?? []).length
    }
  }
  return acc
}

async function main() {
  fs.mkdirSync(TMP, { recursive: true })
  const results: any[] = []
  for (const [shape, build] of Object.entries(SHAPES)) {
    const files = SIZES.map((n) => {
      const file = path.join(TMP, `${shape}-${n}.yaml`)
      fs.writeFileSync(file, build(n))
      return { keys: n, file, bytes: fs.statSync(file).size }
    })
    const acc = await measureAll(files)

    // A size that produced NO symbols from a document built out of keys is a REGIME
    // BOUNDARY, not a fast run, and it must never enter the fit. engine.ts truncates
    // content at 1 MB, so a synthetic fixture past that size parses to nothing and
    // reports a beautiful 0.06 ms. Reporting that as the cost of a 16 MB document is
    // how this probe first concluded the whole lane was linear.
    const points: any[] = []
    const rejected: any[] = []
    for (const { keys, file, bytes } of files) {
      const m = acc.get(keys)!
      if (m.symbols === 0) {
        rejected.push({ keys, bytes, reason: "engine.ts truncates content at 1 MB; this fixture exceeded it and parsed to nothing", symbols: 0, ms: +m.min.toFixed(3) })
        fs.unlinkSync(file)
        continue
      }
      points.push({ keys, bytes, min: +m.min.toFixed(3), max: +m.max.toFixed(3), symbols: m.symbols, relationships: m.relationships, usPerKey: +((m.min * 1000) / keys).toFixed(4) })
      console.log(
        `  ${shape.padEnd(8)} keys=${String(keys).padStart(6)} bytes=${String(bytes).padStart(8)} ` +
        `min=${String(m.min.toFixed(1)).padStart(9)}ms spread=[${m.spread.map((x) => x.toFixed(0)).join(",")}] ` +
        `sym=${String(m.symbols).padStart(6)} rel=${String(m.relationships).padStart(7)}`,
      )
      fs.unlinkSync(file)
    }
    for (const r of rejected) console.log(`  ${shape.padEnd(8)} keys=${String(r.keys).padStart(6)} REJECTED: ${r.reason}`)

    // The verdict is the PAIRED RATIO between consecutive sizes, plus the log-log slope
    // for a continuous view. Both are computed only from points that produced symbols.
    const ratios: Array<{ from: number; to: number; ratio: number; verdict: string }> = []
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!
      const b = points[i]!
      const ratio = b.min / a.min
      const doubled = b.keys / a.keys
      const perDoubling = ratio / doubled
      ratios.push({
        from: a.keys, to: b.keys, ratio: +ratio.toFixed(3),
        perDoubling: +perDoubling.toFixed(3),
        verdict: perDoubling <= 1.35 ? "linear" : perDoubling <= 2.2 ? "superlinear" : "quadratic-or-worse",
      })
    }
    const fit = points.length >= 2
      ? leastSquares(points.map((p) => Math.log(p.keys)), points.map((p) => Math.log(p.min)))
      : { slope: NaN, intercept: NaN }
    const worstRatio = ratios.length ? Math.max(...ratios.map((r) => r.perDoubling)) : NaN
    const shapeVerdict = ratios.length === 0
      ? "undetermined — fewer than two usable sizes"
      : worstRatio <= 1.35 ? "linear" : worstRatio <= 2.2 ? "superlinear" : "quadratic-or-worse"
    console.log(`  ${shape.padEnd(8)} exponent e=${fit.slope.toFixed(3)}  worst per-doubling=${worstRatio.toFixed(3)}  -> ${shapeVerdict}`)
    for (const r of ratios) console.log(`             ${String(r.from).padStart(6)} -> ${String(r.to).padStart(6)}: ${r.ratio.toFixed(2)}x for ${(r.to / r.from).toFixed(0)}x input = ${r.perDoubling.toFixed(2)}x/doubling (${r.verdict})`)
    console.log()
    results.push({ shape, exponent: +fit.slope.toFixed(4), worstPerDoubling: +worstRatio.toFixed(4), verdict: shapeVerdict, ratios, rejected, points })
  }
  fs.rmSync(TMP, { recursive: true, force: true })

  const usable = results.filter((r) => Number.isFinite(r.worstPerDoubling))
  const worst = usable.length ? Math.max(...usable.map((r) => r.worstPerDoubling)) : NaN
  const payload = {
    schemaVersion: 1,
    milestone: "M60",
    rule: "complexity scaling (load-independent)",
    at: new Date().toISOString(),
    question: "Does analyzer time grow as O(n) in input? The exponent is measured instead of ms/file because contention inflates the constant and leaves the exponent alone.",
    method: {
      estimator: `MINIMUM of ${REPS} timed repetitions after one untimed warm-up`,
      why: "contention can only add time, so the fastest run is the closest to the true cost; a mean on a loaded box measures the scheduler",
      fit: "least squares through log(min ms) vs log(keys); the slope is the exponent",
      gate: "e <= 1.35 — looser than 1.0 because fixed per-file cost pushes the measured exponent below 1 at small sizes and above at large ones",
      shapes: "wide siblings, deep nesting, many anchors — three different stress on sibling lookup, recursion and dedupe, so one shape cannot hide another",
    },
    loadAt: execFileSync("cat", ["/proc/loadavg"], { encoding: "utf8" }).trim(),
    verdict: !usable.length ? "undetermined"
      : worst <= 1.35 ? "all shapes linear in the measured regime"
      : `NOT LINEAR: worst per-doubling ${worst.toFixed(3)} (1.0 = linear, 2.0 = quadratic)`,
    results,
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2) + "\n")
  console.log(`VERDICT: ${payload.verdict}`)
  console.log(`  gate is per-doubling <= 1.35; sizes ${SIZES.join(", ")}; shapes ${Object.keys(SHAPES).join(", ")}`)
  console.log(`load during run: ${payload.loadAt}`)
  console.log(`-> ${path.relative(ROOT, OUT)}`)
}
main()
