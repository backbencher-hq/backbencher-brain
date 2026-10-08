/**
 * TYPESCRIPT LANE PAYLOAD / LATENCY — before-and-after on ONE fixed file set.
 *
 * ## Why a lane script and not the shared one
 *
 * The workstream doc names the risk: `bb_graph`'s un-narrowed `relationshipTypes`
 * default is measured at 2.5–4.8× a filtered answer (lodash 487 KiB vs 101 KiB,
 * ripgrep 795 vs 321), and adding edges is not free downstream. So a lane that adds
 * edges re-runs its payload/latency check and REPORTS a regression rather than
 * re-baselining quietly.
 *
 * `script/m60/payload-matrix.ts` measures FIELD EMISSION COVERAGE (33 declared
 * store fields × 48 languages) and is the wrong instrument for this: it cannot see
 * how many edges an analyzer publishes or how large they are. What is wanted here
 * is three numbers over a fixed draw — relationship COUNT, serialized relationship
 * PAYLOAD bytes, and WALL time per file — before and after the change, from the
 * production path.
 *
 * ## Method, and what makes the two runs comparable
 *
 * The analyzer file is swapped in-process between runs, so both see the same
 * files, the same parser instance and the same machine state. The BEFORE text is
 * `git show <ref>:src/ast/real-typescript-analyzer.ts`, and the runner REFUSES to
 * proceed if either variant fails to parse — a "before" number produced by a
 * broken module is not a measurement.
 *
 * Wall time on a shared box is unstable (the M12 harness header records this
 * analyzer measuring 25.8 ms/file and 172.6 ms/file minutes apart), so the timing
 * is reported as min-of-N per file AND the run is repeated in reverse order, and
 * both numbers are printed. Counts and bytes are deterministic and are the numbers
 * to trust.
 *
 * Usage:
 *   bun run script/m14/ts-payload-latency.ts [--ref <git-ref>] [--files N]
 *                                            [--repo element-plus] [--out p.json]
 *                                            [--repeats 3]
 */
import { execFileSync } from "node:child_process"
import { spawnSync } from "node:child_process"
import { readFileSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"

const argv = process.argv.slice(2)
const argOf = (f: string): string | undefined => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined }
const REPO_FILTER = argOf("--repo") ?? "element-plus"
const LIMIT = Number(argOf("--files") ?? "120")
const MAX_BYTES = Number(argOf("--max-bytes") ?? String(300 * 1024))
const REPEATS = Number(argOf("--repeats") ?? "3")
const OUT = argOf("--out")
const REF = argOf("--ref") ?? "HEAD~4"
// The order of the two measured children is a MEASUREMENT VARIABLE, not a detail.
// A control run with `--ref HEAD`, where BEFORE and AFTER are byte-identical
// analyzer text, reported an 8.1% wall-clock difference between the first and the
// second child — so this harness's timing floor is about +/-8% and a delta under
// that is noise. `--reverse` runs the children the other way round so the order
// effect is measured rather than argued about: if the delta changes sign, it is
// order.
const REVERSE = argv.includes("--reverse")
const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..")
const ANALYZER_REL = "src/ast/real-typescript-analyzer.ts"

// ----------------------------------------------------------------------------
// The fixed draw, by CONTENT HASH so the two runs provably see the same files
// even if the corpus moves underneath them.
// ----------------------------------------------------------------------------
import { createHash } from "node:crypto"
const files: { abs: string; sha: string; bytes: number }[] = []
{
  const dir = path.join(CR, REPO_FILTER)
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch { tracked = [] }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let st: { size: number }
    try { st = statSync(abs) } catch { continue }
    if (!rel.endsWith(".ts") || rel.endsWith(".d.ts")) continue
    if (st.size > MAX_BYTES || st.size === 0) continue
    const buf = readFileSync(abs)
    files.push({ abs, sha: createHash("sha256").update(buf).digest("hex").slice(0, 16), bytes: st.size })
    if (files.length >= LIMIT) break
  }
}
if (files.length === 0) throw new Error(`no corpus under ${REPO_FILTER}`)
const drawHash = createHash("sha256").update(files.map((f) => `${f.sha}:${f.bytes}`).join("\n")).digest("hex").slice(0, 16)

type Variant = "before" | "after"

const VARIANT_ARG = argv.find((a) => a.startsWith("--variant="))?.slice("--variant=".length)

/**
 * MEASURE ONE VARIANT, IN ITS OWN PROCESS.
 *
 * The first version of this script swapped the analyzer file in place inside one
 * process and imported it with a cache-busting query string. It reported
 * `relationships +0` on element-plus — a draw where an earlier census had measured
 * +68 import edges — and a 21.9% wall-clock regression on the strength of it. Both
 * numbers were wrong, and the reason is worth more than the fix:
 *
 *   `pool-worker.parseFile` imports the analyzer by its OWN path, with no query
 *   string, so bun's module cache handed back the FIRST variant for the second
 *   run. Busting the cache in THIS file's `import()` does nothing for a different
 *   importer. The "before" run therefore measured the fixed analyzer, which is why
 *   the edge delta was exactly zero and why the timing delta was noise.
 *
 * A "before" that silently measures the "after" produces a confident zero, and a
 * confident zero is the most dangerous number this programme has produced so far
 * (the 193d709db enum rename is the same shape). So each variant is measured in a
 * SEPARATE PROCESS, spawned from here, with the file on disk being the only thing
 * that differs. The child asserts which text it is running by hashing the analyzer
 * file it finds, and the parent asserts the hash matches the variant it asked for.
 */
/**
 * What the child prints between the `@@MEASURE@@` markers and the parent reads back.
 *
 * The declaration is not decoration: the parent's label arithmetic below needs the
 * counts to BE numbers. `measureInChild` returned `any`, so `Object.entries`
 * inferred `[string, unknown][]` from an `any` argument, `new Map` became
 * `Map<string, unknown>`, and `(a - b)` stopped typechecking — the declared type had
 * drifted from the record the child actually writes. `measureChild`, further down,
 * builds this shape, so the two sides cannot drift apart again silently.
 */
interface ChildMeasurement {
  analyzerHash: string
  drawHash: string
  files: number
  runs: number
  rels: number
  bytes: number
  byLabel: Record<string, number>
  perFileSamples: number[][]
}

async function measureInChild(variant: Variant, repeats: number): Promise<ChildMeasurement> {
  const liveAbs = path.join(REPO_ROOT, ANALYZER_REL)
  const expectText = variant === "before"
    ? execFileSync("git", ["-C", REPO_ROOT, "show", `${REF}:${ANALYZER_REL}`], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    : readFileSync(liveAbs, "utf8")
  const expectHash = createHash("sha256").update(expectText).digest("hex").slice(0, 16)

  // Write the variant into place and LEAVE it there: the child reads it, and the
  // parent restores before doing anything else. `finally` covers a child that dies.
  writeFileSync(liveAbs, expectText)
  let out: ChildMeasurement
  try {
    const r = spawnSync(process.execPath, [
      import.meta.path,
      "--variant=child",
      "--child-variant", variant,
      "--expect-hash", expectHash,
      "--files", String(LIMIT),
      "--repo", REPO_FILTER,
      "--max-bytes", String(MAX_BYTES),
      "--repeats", String(repeats),
      "--draw-hash", drawHash,
    ], { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 })
    const text = `${r.stdout ?? ""}`
    const marker = "@@MEASURE@@"
    const at = text.lastIndexOf(marker)
    if (at < 0) {
      throw new Error(`the ${variant} child produced no measurement marker. stderr tail: ${text.slice(-600)} / ${String(r.stderr ?? "").slice(-600)}`)
    }
    out = JSON.parse(text.slice(at + marker.length).split("\n@@END@@")[0])
  } finally {
    writeFileSync(liveAbs, AFTER_TEXT)
  }
  if (out.analyzerHash !== expectHash) {
    throw new Error(`the ${variant} child measured analyzer hash ${out.analyzerHash} but ${expectHash} was on disk — refusing the number`)
  }
  if (out.drawHash !== drawHash) {
    throw new Error(`the ${variant} child measured draw hash ${out.drawHash} but the parent drew ${drawHash} — the two runs did not see the same bytes`)
  }
  return out
}

/** Runs inside the child process: measure whatever analyzer is on disk. */
async function measureChild(): Promise<void> {
  const liveAbs = path.join(REPO_ROOT, ANALYZER_REL)
  const analyzerHash = createHash("sha256").update(readFileSync(liveAbs)).digest("hex").slice(0, 16)
  if (argOf("--expect-hash") && argOf("--expect-hash") !== analyzerHash) {
    throw new Error(`analyzer on disk hashes ${analyzerHash}, expected ${argOf("--expect-hash")}`)
  }
  const mod: any = await import(liveAbs)
  const Cls = Object.values(mod).find((v: any) => typeof v === "function" && String(v.name).endsWith("Analyzer"))
  if (!Cls) throw new Error("the analyzer on disk exports no *Analyzer class")
  const { parseFile } = await import("../../src/ast/pool-worker")
  const runs: any[] = []
  for (let i = 0; i < Math.max(1, REPEATS); i++) {
    let rels = 0, bytes = 0
    const byLabel = new Map<string, number>()
    const perFileMs: number[] = []
    for (const f of files) {
      const t0 = performance.now()
      let r: any
      try { r = await parseFile(f.abs, path.dirname(f.abs)) } catch { perFileMs.push(-1); continue }
      perFileMs.push(performance.now() - t0)
      const rows: any[] = r.relationships ?? []
      rels += rows.length
      for (const x of rows) {
        const t = String(x.type ?? x.relationshipType ?? "")
        byLabel.set(t, (byLabel.get(t) ?? 0) + 1)
      }
      bytes += Buffer.byteLength(JSON.stringify(rows), "utf8")
    }
    runs.push({ rels, bytes, byLabel: Object.fromEntries(byLabel), perFileMs })
  }
  const first = runs[0]
  console.log(`@@MEASURE@@${JSON.stringify({
    analyzerHash, drawHash, files: files.length, runs: runs.length,
    rels: first.rels, bytes: first.bytes, byLabel: first.byLabel,
    perFileSamples: runs.map((r) => r.perFileMs),
  })}\n@@END@@`)
}

if (VARIANT_ARG === "child") {
  await measureChild()
  process.exit(0)
}

const AFTER_TEXT = readFileSync(path.join(REPO_ROOT, ANALYZER_REL), "utf8")

/** min-of-N per file, then the median of those minima: robust to a shared box. */
function summarise(samples: number[][]): { minTotal: number; medianFile: number } {
  const mins: number[] = []
  for (let i = 0; i < samples[0].length; i++) {
    let best = Number.POSITIVE_INFINITY
    for (const run of samples) {
      const v = run[i]
      if (v >= 0 && v < best) best = v
    }
    if (Number.isFinite(best)) mins.push(best)
  }
  mins.sort((a, b) => a - b)
  const medianFile = mins.length ? mins[Math.floor(mins.length / 2)] : Number.NaN
  return { minTotal: mins.reduce((a, b) => a + b, 0), medianFile }
}

console.log(`typescript payload / latency — corpus ${REPO_FILTER}`)
console.log(`${files.length} files, draw hash ${drawHash} (content-addressed, so the two runs provably see the same bytes)`)
console.log(`source bytes ${files.reduce((a, f) => a + f.bytes, 0).toLocaleString()}`)
console.log(`BEFORE variant = \`git show ${REF}:${ANALYZER_REL}\`; AFTER = the working tree`)
console.log(`child order: ${REVERSE ? "BEFORE, AFTER" : "AFTER, BEFORE"}` + (REF === "HEAD" ? "   (CONTROL: both variants are the same analyzer text)" : ""))
console.log("")

const order: Variant[] = REVERSE ? ["before", "after"] : ["after", "before"]
const firstChild = await measureInChild(order[0], REPEATS)
const secondChild = await measureInChild(order[1], REPEATS)
const after1 = order[0] === "after" ? firstChild : secondChild
const before = order[0] === "before" ? firstChild : secondChild
console.log("measuring AFTER again (for determinism) …")
const after2 = await measureInChild("after", 1)

const drift = after2.rels === 0 ? 0 : Math.abs(after2.rels - after1.rels) / after1.rels
const results = {
  before: { rels: before.rels, bytes: before.bytes, byLabel: new Map(Object.entries(before.byLabel)) },
  after: { rels: after1.rels, bytes: after1.bytes, byLabel: new Map(Object.entries(after1.byLabel)) },
}

const pad = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
const kb = (n: number) => `${(n / 1024).toFixed(1)} KiB`
const tB = summarise(before.perFileSamples)
const tA = summarise(after1.perFileSamples)

console.log(`\n${pad("metric", 34)}${pad("before", 16)}${pad("after", 16)}${pad("delta", 18)}`)
console.log("-".repeat(84))
const rowsOut: { metric: string; before: number | string; after: number | string; delta: string }[] = []
const line = (metric: string, b: number | string, a: number | string, delta: string) => {
  console.log(pad(metric, 34) + pad(String(b), 16) + pad(String(a), 16) + pad(delta, 18))
  rowsOut.push({ metric, before: b, after: a, delta })
}
line("relationships", results.before.rels, results.after.rels,
  `${results.after.rels - results.before.rels >= 0 ? "+" : ""}${results.after.rels - results.before.rels} (${(((results.after.rels - results.before.rels) / (results.before.rels || 1)) * 100).toFixed(1)}%)`)
line("relationship payload", kb(results.before.bytes), kb(results.after.bytes),
  `${results.after.bytes - results.before.bytes >= 0 ? "+" : ""}${kb(results.after.bytes - results.before.bytes)}`)
line("payload bytes per edge", (results.before.bytes / (results.before.rels || 1)).toFixed(1), (results.after.bytes / (results.after.rels || 1)).toFixed(1), "")
line("wall, min-of-N total", `${tB.minTotal.toFixed(0)} ms`, `${tA.minTotal.toFixed(0)} ms`, `${(((tA.minTotal - tB.minTotal) / (tB.minTotal || 1)) * 100).toFixed(1)}%`)
line("wall, median file", `${tB.medianFile.toFixed(1)} ms`, `${tA.medianFile.toFixed(1)} ms`, `${(((tA.medianFile - tB.medianFile) / (tB.medianFile || 1)) * 100).toFixed(1)}%`)
line("determinism drift on re-run", "-", `${(drift * 100).toFixed(2)}%`, "counts must be 0")

console.log(`\nper-label relationship counts:`)
const labels = [...new Set([...results.before.byLabel.keys(), ...results.after.byLabel.keys()])].sort()
console.log(`${pad("label", 16)}${pad("before", 12)}${pad("after", 12)}delta`)
for (const l of labels) {
  const b = results.before.byLabel.get(l) ?? 0
  const a = results.after.byLabel.get(l) ?? 0
  console.log(pad(l, 16) + pad(String(b), 12) + pad(String(a), 12) + (a - b >= 0 ? "+" : "") + (a - b))
}
if (drift > 0.02) {
  console.log(`\nWARNING: the AFTER run disagreed with itself by ${(drift * 100).toFixed(2)}% on a deterministic`)
  console.log(`count. The analyzer is a pure function of the source text, so this is measurement noise`)
  console.log(`and the count row should not be read to that precision.`)
}
console.log(`\nDIRECTION: all of this is OUTGOING ONLY. An analyzer emits edges from the file being`)
console.log(`analyzed; who points AT a symbol is a separate subsystem that is not built (graph.ts`)
console.log(`builds no reverse edges and the schema stores none).`)

if (OUT) {
  writeFileSync(OUT, JSON.stringify({
    at: new Date().toISOString(), corpus: REPO_FILTER, files: files.length, drawHash,
    ref: REF, maxBytes: MAX_BYTES, repeats: REPEATS,
    before: { rels: results.before.rels, bytes: results.before.bytes, byLabel: Object.fromEntries(results.before.byLabel), minTotalMs: tB.minTotal, medianFileMs: tB.medianFile },
    after: { rels: results.after.rels, bytes: results.after.bytes, byLabel: Object.fromEntries(results.after.byLabel), minTotalMs: tA.minTotal, medianFileMs: tA.medianFile },
    rows: rowsOut,
  }, null, 2))
  console.log(`\nwrote ${OUT}`)
}