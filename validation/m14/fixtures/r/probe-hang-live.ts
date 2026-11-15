#!/usr/bin/env npx tsx
/**
 * PROBE — the LIVE reading: does the current tree hang, trap, or leak a bomb on the ggplot2 corpus?
 *
 * This is the end-to-end arm of the R hang verdict. It walks the actual population the HANDOFF
 * names (`ggplot2/R/scale-hue.R`) through the PRODUCTION `parseFile` — the same function
 * `parallel-indexer.ts` calls, the same one that arms `engine.ts`'s `parseBomb` in-process — and
 * then refuses to schedule anything, so that:
 *
 *   - if a file HANGS the parser, this process stops producing output and has to be killed
 *     (the bomb cannot fire: `parser.parse()` is synchronous C/WASM and blocks the event loop);
 *   - if a file makes the grammar TRAP, `pool-worker.ts:1424` catches it, writes
 *     `[BB-PARSE-ERR]`, and returns the regex fallback -> the file counts as `degraded`;
 *   - if that trap LEAKED the bomb (the pre-8f0e0c930 engine), the process stays alive past its
 *     own summary and exits 1 ~120 s later with `[BB-HANG]` naming the last file that threw;
 *   - if the trap did NOT leak it (the tree as checked out), the process exits promptly, code 0.
 *
 * The wall time to exit is therefore the measurement. `process.on("exit")` stamps it into the log
 * so the evidence does not depend on how the caller timed the process.
 *
 * Declares `degraded` unconditionally, per HANDOFF §5.1: every R figure declares its degraded count.
 *
 * Run:  timeout 400 npx tsx validation/m14/fixtures/r/probe-hang-live.ts
 */

import { readdirSync, readFileSync, statSync } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"

const T0 = Date.now()
const loadAtStart = os.loadavg()
const ROOT = process.env.BB_R_ROOT ?? "/home/ishaq2321/bb_tests/repositories/ggplot2"
const CONCURRENCY = Number(process.env.BB_LIVE_CONC ?? "2")

/** Every `.R` file under `dir`, sorted — the population, stated, not sampled. */
function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === ".git") continue
      walk(p, out)
    } else if (e.isFile() && /\.(R|r)$/.test(e.name)) out.push(p)
  }
  return out
}

const files = (
  process.env.BB_R_FILES
    ? process.env.BB_R_FILES.split(/[\n:]/).map((s) => s.trim()).filter(Boolean)
    : walk(ROOT)
).sort()
// Repeating the list is how the "poison file" reading is tested: if one file really does hang or
// trap the parser, hammering the SAME path N times must show it, and one pass over 360 files that
// reaches a file once does not.
const REPEAT = Math.max(1, Number(process.env.BB_LIVE_REPEAT ?? "1"))
const planned = REPEAT === 1 ? files.length : files.length * REPEAT

// Capture stderr so the trap lines can be counted and named without interleaving.
const trapLines: string[] = []
const origWrite = process.stderr.write.bind(process.stderr)
process.stderr.write = ((chunk: any, ...rest: any[]) => {
  const s = String(chunk)
  if (s.includes("[BB-PARSE-ERR]")) trapLines.push(s.trim())
  return origWrite(chunk, ...rest)
}) as any

let degraded = 0
let failed = 0
const degradedFiles: string[] = []
let done = 0

async function worker(queue: string[]) {
  for (;;) {
    const f = queue.shift()
    if (!f) return
    try {
      const res: any = await parseFile(f, path.dirname(f))
      if (res?.fallback === true || res?.metadata?.fallback === true) {
        degraded++
        degradedFiles.push(path.relative(ROOT, f))
      }
    } catch (e: any) {
      failed++
    }
    done++
  }
}

const queue: string[] = []
for (let r = 0; r < REPEAT; r++) queue.push(...files)
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(queue)))

const walkMs = Date.now() - T0
const summary =
  `load average at start: ${loadAtStart.map((n) => n.toFixed(2)).join(" ")}  (1m 5m 15m)  ` +
  `cores: ${os.cpus().length}\n` +
  (process.env.BB_R_FILES
    ? `population: ${files.length} named file(s), repeated ${REPEAT}x = ${planned} parses\n`
    : `population: ${files.length} .R files under ${ROOT} (whole population, no stride), ` +
      `repeated ${REPEAT}x = ${planned} parses\n`) +
  `files walked: ${done}   degraded (regex fallback): ${degraded}   parse failures: ${failed}\n` +
  `traps ([BB-PARSE-ERR]): ${trapLines.length}\n` +
  `walk wall time: ${walkMs}ms\n`
origWrite(summary)
if (trapLines.length) {
  origWrite(`trap files are named because they change the population:\n`)
  for (const t of trapLines) origWrite(`  ${t}\n`)
}
origWrite(
  `nothing further is scheduled: if a parse bomb leaked, this process now stays alive and exits 1 ` +
    `~120s after the throw, printing [BB-HANG].\n`
)

process.on("exit", (code) => {
  origWrite(
    `EXIT code=${code} after ${Date.now() - T0}ms total ` +
      `(walk ${walkMs}ms; post-walk drain ${Date.now() - T0 - walkMs}ms)\n`
  )
})
process.exitCode = 0
