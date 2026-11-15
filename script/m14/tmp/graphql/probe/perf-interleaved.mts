/**
 * GraphQL PERF — DRIFT-FREE A/B, and a DETERMINISTIC accessor count.
 *
 * The 2x2 attribution probe runs each cell in its own process and takes medians,
 * which is not enough: on this machine the SAME binary measured a 529 ms and a
 * 999 ms parse of the same file in different sessions, so a 2x swing is pure
 * contention. Any A/B ratio taken from two different sessions is unfalsifiable.
 *
 * This probe therefore does two things that contention cannot touch:
 *
 *   1. Both analyzers are loaded into ONE process and run ALTERNATELY, so any
 *      drift in machine load hits both equally. The ratio of the medians of the
 *      interleaved series is the number to trust.
 *
 *   2. The number of tree-sitter accessor calls is COUNTED, not timed. Counts
 *      are exact and machine-independent, so they prove the algorithmic claim
 *      (a `namedChildCount` + `namedChild(i)` walk is O(n log n) in the binding;
 *      the cached `namedChildren` getter is one wasm call) even when the wall
 *      clock is too noisy to resolve a 9% move.
 *
 *   node probe/perf-interleaved.mts [file ...]
 */
import * as fs from "fs"
import * as path from "path"
import { CORPORA, GQL, ROOT } from "../paths.mts"
import { fileURLToPath } from "node:url"

const wts: any = await import(path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.js"))
const ParserClass = wts.Parser ?? wts.default ?? wts
const Language = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const parser = new ParserClass()
parser.setLanguage(await Language.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-graphql.wasm"))))

const NEW_SRC = path.join(ROOT, "src/ast/real-graphql-analyzer.ts")
// The pre-optimisation analyzer, kept as a FILE rather than in /tmp, for the same
// reason the previous wasm is kept byte-for-byte in grammar-rebuild/: an A/B whose
// baseline has evaporated is not reproducible. Prefer the committed copy; the /tmp
// path is a convenience for regenerating it.
const OLD_SRC = [path.join(GQL, "baseline/real-graphql-analyzer.PREFIX-O1.ts"), "/tmp/real-graphql-analyzer.SESSIONSTART.ts"].find((p) => fs.existsSync(p)) ?? ""
const { RealGraphqlAnalyzer } = await import(NEW_SRC)
let OLD: any = null
if (OLD_SRC) {
  try {
    OLD = (await import(OLD_SRC)).RealGraphqlAnalyzer
  } catch (e: any) {
    console.error(`could not load the baseline analyzer (${OLD_SRC}): ${e?.message ?? e}`)
    console.error(`the COUNTED half of this probe and its gate still run; only the A/B ratio is skipped.`)
  }
} else {
  console.error(`no baseline analyzer found; the A/B is skipped and only the counted gate runs.`)
  console.error(`regenerate it, or keep baseline/real-graphql-analyzer.PREFIX-O1.ts in place.`)
}

const files = process.argv.slice(2)
if (files.length === 0) files.push(`${CORPORA}/graphql-js/benchmark/github-schema.graphql`)
const inputs = files.map((f) => ({ f, src: fs.readFileSync(f, "utf8") }))
const trees = inputs.map((i) => ({ ...i, tree: parser.parse(i.src) }))
const lines = trees.reduce((a, t) => a + t.src.split("\n").length, 0)

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2 }
const run = (Ctor: any) => {
  const t = process.hrtime.bigint()
  let facts = 0
  for (const t2 of trees) { const r = new Ctor().analyze(t2.tree.rootNode, t2.src, t2.f); facts = r.symbols.length + r.relationships.length }
  return { ms: Number(process.hrtime.bigint() - t) / 1e6, facts }
}

// ---- deterministic accessor counts -----------------------------------------
const N: any = (wts.Node ?? (wts as any).default?.Node)
function countAccessors(Ctor: any) {
  const proto: any = N?.prototype
  if (!proto) return null
  const hits: Record<string, number> = {}
  const save: Record<string, any> = {}
  const keys = ["namedChildCount", "namedChild", "child", "childCount", "type", "startPosition", "endPosition", "startIndex", "endIndex", "text", "namedChildren"]
  for (const k of keys) {
    const d = Object.getOwnPropertyDescriptor(proto, k)
    if (!d) continue
    save[k] = d
    hits[k] = 0
    if (d.get) Object.defineProperty(proto, k, { ...d, get() { hits[k]++; return d.get!.call(this) } })
    else if (typeof d.value === "function") Object.defineProperty(proto, k, { ...d, value: function (...a: any[]) { hits[k]++; return d.value.apply(this, a) } })
  }
  let facts = 0
  try { for (const t of trees) { const r = new Ctor().analyze(t.tree.rootNode, t.src, t.f); facts = r.symbols.length + r.relationships.length } } finally {
    for (const k of keys) if (save[k]) Object.defineProperty(proto, k, save[k])
  }
  return { hits, facts }
}

const caNew = countAccessors(RealGraphqlAnalyzer)
const caOld = OLD ? countAccessors(OLD) : null

if (caNew) {
  console.log(`=== ACCESSOR CALLS, exact counts, ${lines} lines, ${caNew.facts} facts ===`)
  const keys = Object.keys(caNew.hits)
  const tot = (h: Record<string, number>) => keys.reduce((a, k) => a + h[k], 0)
  console.log(`  new total: ${tot(caNew.hits)}`)
  if (caOld) {
    console.log(`  old total: ${tot(caOld.hits)}`)
    console.log(`  ${"accessor".padEnd(16)}${"old".padStart(12)}${"new".padStart(12)}${"change".padStart(12)}`)
    for (const k of keys) {
      const o = caOld.hits[k], n = caNew.hits[k]
      if (o === n && o === 0) continue
      const ch = o ? ((n / o - 1) * 100).toFixed(1) + "%" : "new"
      console.log(`  ${k.padEnd(16)}${String(o).padStart(12)}${String(n).padStart(12)}${ch.padStart(12)}`)
    }
  }
  // Persist the counts: they are the machine-independent half of the performance
  // claim, and a doc that cites them must be able to re-derive them.
  const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "out")
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(path.join(outDir, "perf-accessors.json"), JSON.stringify({
    generatedAt: new Date().toISOString(),
    file: files[0],
    lines,
    facts: caNew.facts,
    counts: caNew.hits,
    baselineCounts: caOld ? caOld.hits : null,
    // The assertion that matters. `namedChildCount` is the O(n log n) walk the
    // binding's own documentation warns against, and its reappearance means a
    // future edit reintroduced the anti-pattern; a silent regression here is
    // exactly what the wall clock is too noisy to catch on its own.
    namedChildCountCalls: caNew.hits.namedChildCount,
    namedChildCalls: caNew.hits.namedChild,
    namedChildrenCalls: caNew.hits.namedChildren,
    totalAccessorCalls: keys.reduce((a, k) => a + caNew.hits[k], 0),
    baselineTotalAccessorCalls: caOld ? keys.reduce((a, k) => a + caOld.hits[k], 0) : null,
  }, null, 2))
  console.log(`  (written to out/perf-accessors.json)`)
  if (caNew.hits.namedChildCount > 0) {
    console.error(`\nGATE FAILED: ${caNew.hits.namedChildCount} namedChildCount call(s) — the O(n log n) walk is back.`)
    process.exitCode = 1
  }
  console.log()
}

if (OLD) {
  // warm both, then alternate
  run(RealGraphqlAnalyzer); run(OLD)
  const REPS = Number(process.env.PROFILE_REPS ?? 9)
  const a: number[] = [], b: number[] = []
  for (let i = 0; i < REPS; i++) { const r = run(RealGraphqlAnalyzer); a.push(r.ms); const o = run(OLD); b.push(o.ms) }
  const mn = (xs: number[]) => Math.min(...xs)
  const spread = (xs: number[]) => Math.max(...xs) / Math.min(...xs)
  const ma = median(a), mb = median(b)
  const mina = mn(a), minb = mn(b)
  console.log("=== INTERLEAVED A/B, one process, alternating ===")
  console.log(`  new series: ${a.map((x) => x.toFixed(0)).join(" ")}   spread x${spread(a).toFixed(1)}`)
  console.log(`  old series: ${b.map((x) => x.toFixed(0)).join(" ")}   spread x${spread(b).toFixed(1)}`)
  console.log("")
  // BOTH estimators are printed and NEITHER is gated, because on this machine the
  // per-run spread inside a single series reaches 4.6x. Repeated sessions of this
  // same A/B have reported 35% faster, 40%, 52%, and -13% SLOWER, which is not a
  // measurement of the code — it is a measurement of the machine. The MINIMUM is
  // the better estimator under contention (it approximates the uncontended cost),
  // so it is listed first, but the honest conclusion is that the wall clock cannot
  // resolve this change and the ACCESSOR COUNT is the claim that is pinned.
  console.log(`  by minimum : ${minb.toFixed(0)} -> ${mina.toFixed(0)} ms   (x${(mina / minb).toFixed(3)})   <- the better estimator under contention`)
  console.log(`  by median  : ${mb.toFixed(0)} -> ${ma.toFixed(0)} ms   (x${(ma / mb).toFixed(3)})`)
  console.log(`  VERDICT: the per-run spread is up to x${Math.max(spread(a), spread(b)).toFixed(1)}, so the wall clock does NOT resolve this change.`)
  console.log(`           The count is the claim: ${caNew ? "" : ""}see out/perf-accessors.json. Repeated sessions have ranged from 52% faster to 13% slower.`)
}
