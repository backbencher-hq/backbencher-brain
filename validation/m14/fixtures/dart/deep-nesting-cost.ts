/**
 * THE COST CURVE FOR NESTED `if` IN DART — and the fixture that pins it
 *
 * ## Why this exists
 *
 * `walk-dart.txt` marks `dart-sdk/tests/language/syntax/deep_nesting_statement_test.dart`
 * `!bad`, and the reason was never established — `resumable-walk` marks bad on a throw OR
 * a 120s hang and records neither. Measured so far:
 *
 *   raw `parser.parse` of that file   1,063 ms, 43,567 nodes, iterative depth 20,005
 *   production `parseFile` of it         HUNG — no result within 300,000 ms
 *
 * The parse finished in about a second, so the >299 s is spent AFTER parsing, inside
 * `src/ast/real-dart-analyzer.ts`. That analyzer's tree walk is iterative
 * (`stack: Frame[]`, real-dart-analyzer.ts:394), so depth cannot be blowing a JS stack —
 * the cost has to be super-linear in DEPTH, not in node count.
 *
 * ## The mechanism this measures
 *
 * The file's shape is 9,998 repetitions of one line:
 *
 *     if (x == 0) { //# 01: continued
 *
 * which makes the tree a left-leaning spine ~10,000 levels deep. The analyzer contains
 * several ancestor climbs (`let p = n.parent; while (...) p = p.parent` — lines 2536,
 * 2910, 3058, 3131, 3255, 3464). If any of them runs per node, cost is O(N·D): at
 * N=43,567 and D=20,005 that is 8.7e8 `Node.parent` reads, each one a WASM boundary
 * crossing that re-unmarshals the node.
 *
 * So the prediction is testable and specific: time should grow SUPER-LINEARLY with the
 * nesting count. A linear curve would refute it and mean the cost is per-node instead.
 *
 * ## What this writes
 *
 * `deep-nest-<n>.dart` fixtures, each a faithful reproduction of the real file's shape at
 * nesting depth n, plus the measured curve. The deepest one that completes inside the
 * budget becomes a regression fixture with a real timing assertion — a fixture whose
 * assertion is "this took < N seconds" catches a reintroduced ancestor walk, which a
 * shape-only fixture cannot.
 *
 * Run: npx tsx validation/m14/fixtures/dart/deep-nesting-cost.ts [budgetMs]
 */
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
const require = createRequire(import.meta.url)
import { mkdirSync, writeFileSync } from "node:fs"
import * as path from "node:path"

const ROOT = process.cwd()
const budgetMs = Number(process.argv[2] ?? 45_000)
const FIXTURES = "/tmp/opencode/dart-generated"
mkdirSync(FIXTURES, { recursive: true })

/**
 * The real file's shape, reproduced exactly: a `main` whose body is n nested `if`
 * statements, each opening a block. The trailing close braces and the final statement
 * matter — without them the file does not parse, and a non-parsing fixture measures the
 * error path rather than the analyzer.
 */
function nestedIfs(n: number): string {
  const open = "main() {\n"
  let s = "var x = 0;\n\n"
  for (let i = 0; i < n; i++) s += `  if (x == 0) { //# 01: continued\n`
  s += "x = 1;\n"
  s += "}\n".repeat(n)
  s += "  return x;\n}\n"
  return s
}

const CHILD = "/tmp/opencode/dart-deepnest-child.mts"
writeFileSync(
  CHILD,
  `import { parseFile } from ${JSON.stringify(path.join(ROOT, "src/ast/pool-worker.ts"))}
import * as path from "node:path"
const f = process.argv[2]
const t0 = Date.now()
try {
  const r: any = await parseFile(f, path.dirname(f))
  const byType: Record<string, number> = {}
  for (const x of (r?.relationships ?? [])) {
    const t = String(x?.type ?? "").toLowerCase()
    if (t) byType[t] = (byType[t] ?? 0) + 1
  }
  process.stdout.write("@@R@@" + JSON.stringify({ ok: true, ms: Date.now() - t0,
    rels: (r?.relationships ?? []).length, syms: (r?.symbols ?? []).length, byType }))
} catch (e: any) {
  process.stdout.write("@@R@@" + JSON.stringify({ ok: false, ms: Date.now() - t0,
    err: String(e?.message ?? e).slice(0, 300) }))
}
`,
)

/**
 * Doubling ladder. Small enough that even a 45 s budget leaves the whole matrix inside a
 * few minutes, large enough to separate n^1 from n^2 over an 8x range.
 */
const LADDER = [125, 250, 500, 1_000, 2_000]

/** Repeats per size. MINIMUM across repeats, not mean: contention only ever adds time. */
const PASSES = 3

interface Obs { ms: number | null; rels: number; syms: number; note: string }
const obs = new Map<number, Obs[]>()
for (const n of LADDER) obs.set(n, [])

console.log(`nested-if cost curve — external budget ${budgetMs} ms per file, ${PASSES} passes`)
console.log(`shape: main() { if (x == 0) { x n times }  — matches deep_nesting_statement_test.dart`)

// Written once, up front, so disk timing never lands inside a timed run.
const files = new Map<number, string>()
for (const n of LADDER) {
  const text = nestedIfs(n)
  const f = path.join(FIXTURES, `deep-nest-${n}.dart`)
  writeFileSync(f, text)
  files.set(n, f)
}

function loadAvg(): string {
  try { return require("node:os").loadavg().map((x: number) => x.toFixed(2)).join(" ") } catch { return "?" }
}

function timeOne(n: number): Obs {
  const r = spawnSync("npx", ["tsx", CHILD, files.get(n)!], { cwd: ROOT, encoding: "utf8", timeout: budgetMs })
  const raw = r.stdout ?? ""
  const i = raw.indexOf("@@R@@")
  if (i < 0) return { ms: null, rels: 0, syms: 0, note: `HUNG > ${budgetMs} ms` }
  try {
    const p = JSON.parse(raw.slice(i + 4).slice(0, raw.lastIndexOf("}") + 1))
    return p.ok
      ? { ms: p.ms, rels: p.rels ?? 0, syms: p.syms ?? 0, note: "" }
      : { ms: p.ms, rels: 0, syms: 0, note: `THREW: ${String(p.err).slice(0, 80)}` }
  } catch {
    return { ms: null, rels: 0, syms: 0, note: "unparseable child output" }
  }
}

// ROUND-ROBIN, not ladder order.
//
// The first version of this probe walked LADDER in order and produced n=1000 "HUNG >
// 45 s" next to n=4000 "2,815 ms" — a cost function that is not monotonic in its own
// input, which is not a measurement of anything. Six language lanes share this host, so
// sequential sampling reads machine load as file size: the early sizes inherited the busy
// period and the late ones inherited the quiet one.
//
// Interleaving fixes the drift — every size sees the same mix of busy and quiet — and
// MINIMUM across passes discards the slow samples, because contention can only add time
// to a fixed workload. Both are needed: interleaving alone still lets a size unlucky in
// every pass read high.
for (let pass = 0; pass < PASSES; pass++) {
  for (const n of [...LADDER].reverse()) {
    const o = timeOne(n)
    obs.get(n)!.push(o)
    process.stdout.write(`  pass ${pass + 1}/${PASSES} n=${String(n).padStart(5)} -> ${o.ms != null ? `${o.ms} ms` : o.note}   (loadavg ${loadAvg()})\n`)
  }
}

console.log(`\n  ${"n".padStart(6)}  ${"bytes".padStart(8)}  ${"min".padStart(10)}  ${"all samples".padStart(34)}  ${"rels".padStart(5)}`)
const rows: { n: number; bytes: number; min: number | null; rels: number }[] = []
for (const n of LADDER) {
  const all = obs.get(n)!
  const times = all.map((o) => o.ms).filter((x): x is number => x != null)
  const min = times.length ? Math.min(...times) : null
  const hung = all.length - times.length
  rows.push({ n, bytes: files.get(n)!.length, min, rels: all.find((o) => o.rels)?.rels ?? 0 })
  console.log(`  ${String(n).padStart(6)}  ${String(files.get(n)!.length).padStart(8)}  ${(min != null ? `${min} ms` : "HUNG").padStart(10)}  ${(times.map((t) => `${t}`).join(",") + (hung ? `,${hung} hung` : "")).padEnd(34)}  ${String(rows[rows.length - 1].rels).padStart(5)}`)
}

const done = rows.filter((r) => r.min != null)
console.log(`\nSCALING (min of ${PASSES})`)
if (done.length >= 2) {
  console.log(`  ${done.map((r) => `n=${r.n}: ${r.min}ms`).join("   ")}`)
  for (let i = 1; i < done.length; i++) {
    const a = done[i - 1], b = done[i]
    const ratioN = b.n / a.n
    const ratioT = b.min! / Math.max(a.min!, 1)
    const exponent = Math.log(ratioT) / Math.log(ratioN)
    console.log(`  n ${String(a.n).padStart(5)} -> ${String(b.n).padStart(5)}  (x${ratioN.toFixed(1)})  time x${ratioT.toFixed(2).padStart(8)}   =>  time ~ n^${exponent.toFixed(2)}`)
  }
  console.log(`
  n^1  linear in node count   -> per-node cost, no depth effect
  n^2  quadratic in DEPTH     -> a per-node ancestor climb: O(N x D)`)
}

const largest = done[done.length - 1]
const smallestHung = rows.find((r) => r.min == null && LADDER.indexOf(r.n) > (largest?.n ?? 0) - 1)
console.log(`
LARGEST COMPLETING FIXTURE: ${largest ? `deep-nest-${largest.n}.dart at ${largest.min} ms` : "none"}`)
console.log(`SMALLEST HANGING FIXTURE:  ${smallestHung ? `deep-nest-${smallestHung.n}.dart (> ${budgetMs} ms in all ${PASSES} passes)` : "none in this ladder"}`)
console.log(`Fixtures written to ${path.relative(ROOT, FIXTURES)}/`)