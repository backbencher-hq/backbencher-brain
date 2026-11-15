/**
 * DOES THE POOL WALK RETAIN — or does only the synthetic single-parser shape?
 *
 * ## Why this exists
 *
 * `script/m14/tmp/wasm-tree-retention.ts` established the mechanism and the remedy:
 * web-tree-sitter allocates each `Tree` in the WASM heap, only `tree.delete()` returns
 * it, there is no finaliser, and its `leak` vs `free` modes measured monotonic 449 -> 741
 * -> 878MB against flat 126 -> 135 -> 139MB. But that probe drives ONE parser in ONE
 * process — the shape `script/m14/differential.ts` uses. The dart coverage gate does not
 * parse that way: it calls `parseFile` from `src/ast/pool-worker`, which hands the work to
 * worker threads whose engine `parseFile` deletes its tree in a `finally`
 * (`src/ast/engine.ts:2152`).
 *
 * So "the gate dies of retained trees" is a HYPOTHESIS INHERITED FROM A DIFFERENT SHAPE,
 * not a measurement of this one. This probe measures the path the gate actually uses, at
 * the gate's own concurrency, and prints RSS on a fixed stride. The point is to tell
 * retention from something else before anything is "fixed":
 *
 *   monotonic growth  -> retention is real on this path too, and the leak is somewhere
 *                        in the pool/worker path rather than in the instrument
 *   sawtooth / flat   -> this path releases, and the death has another cause entirely
 *
 * It prints the count it walked beside the count it intended, because a sweep that dies
 * of heap exhaustion prints nothing at all, and "no data" and "too much data" look
 * identical from outside.
 *
 * Usage: bun validation/m14/fixtures/dart/walk-retention-probe.ts [repo] [limit] [concurrency]
 *   e.g. bun validation/m14/fixtures/dart/walk-retention-probe.ts /home/ishaq2321/bb_tests/repositories/dart-sdk 6000 8
 */
import fs from "node:fs"
import path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"

const REPO = process.argv[2] ?? "/home/ishaq2321/bb_tests/repositories/dart-sdk"
const LIMIT = Number(process.argv[3] ?? "6000")
const CONC = Number(process.argv[4] ?? "8")
const EVERY = 500

const files: { abs: string; dir: string }[] = []
const walk = (d: string) => {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(d, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    const p = path.join(d, e.name)
    if (e.isDirectory()) {
      if (!/^(\.|node_modules|build|target|out)$/.test(e.name)) walk(p)
    } else if (e.name.endsWith(".dart")) {
      files.push({ abs: p, dir: d })
    }
  }
}
walk(REPO)
files.sort((a, b) => (a.abs < b.abs ? -1 : a.abs > b.abs ? 1 : 0))
const sample = LIMIT > 0 ? files.slice(0, LIMIT) : files

const rss = () => Math.round(process.memoryUsage().rss / 1048576)
console.log(
  `pool-walk retention probe: repo=${path.basename(REPO)} files=${files.length} sample=${sample.length} concurrency=${CONC}`,
)
console.log(`  [start] rss=${rss()}MB`)

let i = 0
let ok = 0
let threw = 0
let empty = 0
const firstThrow: { i: number; f: string; msg: string } | null = null
let firstThrowRec: { i: number; f: string; msg: string } | null = firstThrow
let peak = rss()
const t0 = Date.now()

/** One wave of CONC files; mirrors the gate's call exactly: parseFile(abs, dir). */
const runOne = async (): Promise<void> => {
  const f = sample[i]
  i++
  try {
    const r: any = await parseFile(f.abs, f.dir)
    const rels = r?.relationships ?? []
    // Touch the payload the way the gate does, so this is not measuring a
    // result-free call.
    for (const x of rels) {
      const _t = String(x.type ?? (x as any).relationshipType ?? "")
      void _t
    }
    if (rels.length === 0) empty++
    ok++
  } catch (e: any) {
    threw++
    if (!firstThrowRec) {
      firstThrowRec = { i, f: f.abs, msg: String(e?.message ?? e).slice(0, 90) }
      console.log(`  !! THREW at #${i}: ${f.abs}\n     ${String(e?.message ?? e).slice(0, 160)}`)
    }
  }
  const now = rss()
  if (now > peak) peak = now
}

while (i < sample.length) {
  const wave = Math.min(CONC, sample.length - i)
  await Promise.all(Array.from({ length: wave }, () => runOne()))
  if (i % EVERY < CONC) {
    console.log(
      `  [#${i}/${sample.length} ok=${ok} empty=${empty} threw=${threw} rss=${rss()}MB ${Math.round((Date.now() - t0) / 1000)}s]`,
    )
  }
}

console.log(
  `RESULT files=${i}/${sample.length} ok=${ok} empty=${empty} threw=${threw} rssPeak=${peak}MB ${Math.round((Date.now() - t0) / 1000)}s`,
)
if (firstThrowRec) {
  console.log(`first throw: ${firstThrowRec.f}\n  ${firstThrowRec.msg}`)
}
