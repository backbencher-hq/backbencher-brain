/**
 * ORPHANED `parseBomb` — a reproduction, in the production code path, of a `[BB-HANG]`
 * that is not a hang at all.
 *
 * ## WHAT IT REPRODUCES
 *
 * `npx tsx script/m14/ontology-coverage-gate.ts scss` prints its full verdict —
 *
 *     emitted 8/10   ruled-sound 2   FALSIFIED 0   ruled-without-justification 0
 *
 * — and then exits **1** with this line:
 *
 *     [BB-HANG] parser stuck 120s on .../r-pkgdown/inst/highlight-styles/solarized.scss — exiting
 *
 * Four earlier runs of the identical command named four DIFFERENT files, which this
 * document previously read as evidence of scheduler starvation (the machine runs
 * load average ~25 on 8 cores). That reading was wrong, and this file is why.
 *
 * ## THE DEFECT — three lines of shared code, no lane-specific trigger
 *
 * `src/ast/engine.ts:1441` arms a hard self-destruct timer immediately before the
 * synchronous WASM parse and clears it immediately after:
 *
 *     1441    const parseBomb = setTimeout(() => {
 *     1442      process.stderr.write(`[BB-HANG] parser stuck 120s on ${filePath} — exiting\n`)
 *     1443      process.exit(1)
 *     1444    }, 120000)
 *     1446    const tree = parser.parse(content)
 *     1447    clearTimeout(parseBomb)
 *
 * `parser.parse` can THROW — web-tree-sitter surfaces a WASM heap fault as a JS
 * exception (`memory access out of bounds`), which the real run above logged as
 * `[BB-PARSE-ERR] scss | .../solarized.scss | memory access out of bounds` — and a
 * throw between 1444 and 1447 skips line 1447. The timer is then ORPHANED: still armed,
 * no parse in flight, holding a closure over `filePath`.
 *
 * `parseFile` then does exactly what it is written to do. `src/ast/pool-worker.ts:1222`
 * catches, logs `[BB-PARSE-ERR]`, and returns `extractFallback(...)` (the degraded regex
 * extractor — which is what puts a `DEGRADED` marker on a firing sweep). The caller sees
 * a normal result and moves on to the next file.
 *
 * 120 s after the parse that ALREADY RETURNED, the orphaned timer fires and prints a
 * statement that is false in every part:
 *
 *   - "parser stuck"  — nothing was stuck; the parse threw at t=0 and unwound
 *   - "120s"          — no parse was in flight for 120 s; this is the timer's own delay
 *   - `filePath`      — it names the file that threw MINUTES AGO, not the file being read
 *
 * and then calls `process.exit(1)`, converting a completed verdict into a failed exit
 * code. That is what made the round brief's "the arbiter must exit 0" untestable here, and
 * it is why four runs named four different files: each run traps on whichever file the
 * grammar happened to fault on that day.
 *
 * ## THE FIX (shared file, §8 — NOT applied here)
 *
 * Clear the timer in a `finally`, so a throw cannot skip it:
 *
 *     const parseBomb = setTimeout(...)
 *     let tree
 *     try { tree = parser.parse(content) } finally { clearTimeout(parseBomb) }
 *
 * The message should also stop asserting a hang it cannot observe. "parser exceeded the
 * 120 s budget" is true of a real hang; "parser stuck" is not true of a fault that
 * returned. Distinguishing them needs the timer to record whether the parse completed:
 *
 *     let done = false
 *     const parseBomb = setTimeout(() => {
 *       process.stderr.write(done
 *         ? `[BB-STALE-TIMER] ${filePath} — parse returned but its timer was not cleared\n`
 *         : `[BB-HANG] parser exceeded 120s on ${filePath} — exiting\n`)
 *       process.exit(1)
 *     }, 120000)
 *
 * `src/ast/engine.ts` is supervisor-owned shared machinery (lane brief §8) and every
 * language's lane runs through it, so this file documents the need and changes no shared
 * code. It is a §8 item in `docs/analyzers/scss.md`.
 *
 * ## HOW TO RUN
 *
 *     npx tsx validation/m14/fixtures/scss/scss-orphaned-parsebomb-repro.ts <any .scss path>
 *
 * Takes ~2 min because the defect is a 120 s timer and shortening it would stop
 * reproducing the real thing. Exits non-zero BY DESIGN — that is the finding.
 *
 * ## WHY THE THROW IS INJECTED RATHER THAN A REAL FAULT
 *
 * The genuine fault is a WASM heap trap in the pinned `wasm/tree-sitter-scss.wasm`, and
 * it does NOT reproduce outside the gate's concurrency: measured in isolation,
 * `solarized.scss` (1,895 B) parses clean at 1.7–52.3 ms over 5 runs, and 48 parses at
 * 16-way concurrency over the same directory produced 0 traps and 0 errors. So the
 * TRIGGER is unreproduced and this file does not claim to have found it.
 *
 * What this file claims is narrower and fully established: **when `parser.parse` throws,
 * the timer is orphaned, and an orphaned timer produces a false `[BB-HANG]` and a
 * `process.exit(1)` from inside an otherwise completed run.** The injected throw stands in
 * for the trap because the consequence under investigation is the handler, not the fault.
 * A reproduction of the cause is not required to establish the effect.
 */
import { readFileSync } from "node:fs"
import * as path from "node:path"
import * as wts from "web-tree-sitter"

const F = process.argv[2]
if (!F) {
  console.error("usage: tsx scss-orphaned-parsebomb-repro.ts <any .scss path>")
  process.exit(64)
}

const poolMod: any = await import("../../../../src/ast/pool-worker")

const orig = wts.Parser.prototype.parse
let armed = false
;(wts.Parser.prototype as any).parse = function (this: any, content: string, ...rest: any[]) {
  if (!armed) {
    armed = true
    // the exact failure text the real gate run logged: a WASM heap fault
    throw new Error("memory access out of bounds")
  }
  return orig.call(this, content, ...rest)
}

console.log(`injecting ONE parse throw for ${path.basename(F)}`)
try {
  const r = await poolMod.parseFile(F, readFileSync(F, "utf8"), "scss")
  console.log(
    `parseFile RETURNED normally: symbols=${r.symbols?.length ?? 0} ` +
      `rels=${r.relationships?.length ?? 0} — the caller cannot tell this from a good parse`,
  )
} catch (e: any) {
  console.log(`parseFile THREW: ${e?.message}`)
}
console.log(`parse already returned. idling — an ORPHANED parseBomb should now fire.`)
setInterval(() => console.log(`  alive at ${Math.round(performance.now() / 1000)}s`), 30000)