/**
 * A long walk must keep ONE grammar, not one per 500 files — dart lane.
 *
 * WHY THIS EXISTS
 *
 * `getParser` recreates its cached parser every 500 files ("prevents WASM memory
 * accumulation", it says). Recreating the PARSER is cheap and its memory is releasable.
 * Reloading the GRAMMAR is neither: measured 2026-10-07, web-tree-sitter 0.25.9 has no
 * `Language.delete`, and each `Language.load` of the dart grammar adds ~2.4 MB of RSS that
 * never comes back (10 consecutive loads: 97 MB -> 121 MB, monotonic).
 *
 * The first version of that recreation also dropped the grammar from the cache, so every
 * 500 files bought one NEW unfreeable grammar, and the concurrent callers at that boundary
 * each loaded their own because the shared in-flight promise was retired the instant it
 * settled, before any waiter had cached anything. Measured on this very walk, before the
 * fix: 139 "language parser loaded" lines over the 33,692-file dart corpus.
 *
 * This probe makes the claim countable instead of argued: it walks real dart files through
 * the production `parseFile`, and the number of grammars it loads is read off its own
 * output by counting `language parser loaded`. Nothing here is a mock.
 *
 * Usage:
 *   npx tsx validation/m14/fixtures/dart/parser-reload-probe.ts [files] [concurrency]
 *   # then: grep -c "language parser loaded" on the captured output
 */
import { readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"

/**
 * A deep slice of the dart SDK rather than the whole corpus: long enough to cross many
 * 500-file recreation boundaries (the thing under test), short enough to run while someone
 * else is using the machine. The default 3,000 crosses six.
 */
const ROOT = process.env.BB_PROBE_ROOT ?? "/home/ishaq2321/bb_tests/repositories/dart-sdk/pkg"
const LIMIT = Number(process.argv[2] ?? 3000)
const CONC = Number(process.argv[3] ?? 8)

function collect(dir: string, out: string[] = []): string[] {
  if (out.length >= LIMIT) return out
  let entries: string[]
  try { entries = readdirSync(dir) } catch { return out }
  for (const e of entries) {
    if (out.length >= LIMIT) return out
    if (e.startsWith(".") || e === "node_modules" || e === "build") continue
    const p = join(dir, e)
    let st: ReturnType<typeof statSync>
    try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) collect(p, out)
    else if (e.endsWith(".dart")) out.push(p)
  }
  return out
}

const files = collect(ROOT)
const rssMb = (): number => Math.round(process.memoryUsage().rss / (1024 * 1024))
const rssStart = rssMb()
console.log(`parser-reload probe: ${files.length} dart files under ${ROOT}, concurrency ${CONC}`)

let cursor = 0
let done = 0
let degraded = 0
let threw = 0
await Promise.all(
  Array.from({ length: CONC }, async () => {
    while (true) {
      const i = cursor++
      if (i >= files.length) return
      try {
        const r: any = await parseFile(files[i], ROOT)
        if (r?.fallback === true || r?.metadata?.analysisVersion === "2.0-basic-fallback") degraded++
      } catch { threw++ }
      done++
      if (done % 500 === 0) console.log(`  walked ${done}/${files.length}  rss ${rssMb()}MB`)
    }
  }),
)

const rssEnd = rssMb()
console.log(
  `DONE files=${done} degraded=${degraded} threw=${threw} ` +
    `rss ${rssStart}MB -> ${rssEnd}MB (${((rssEnd - rssStart) / (done / 1000)).toFixed(1)}MB per 1k files)`,
)
console.log(`GRAMMAR LOADS under test: count the "language parser loaded" lines in this output.`)
