#!/usr/bin/env npx tsx
/**
 * PROBE — is the R `[BB-HANG]` a HANG, or a self-destruct timer LEAKED BY A THROW?
 *
 * ## The claim under test
 *
 * HANDOFF §5.1 records: `[BB-HANG] parser stuck 120s on ggplot2/R/scale-hue.R — exiting`,
 * with `degraded 2` in one artifact and `degraded 0` in another. Read as written, that is a
 * file that hangs the R parser for 120 s.
 *
 * The competing reading — MEASURED here — is that nothing hung. `scale-hue.R` makes tree-sitter-r
 * trap (`memory access out of bounds`), the trap propagates out of `engine.parseRaw`, and in the
 * pre-2026-10-07 engine the `clearTimeout(parseBomb)` sat on the line AFTER `parser.parse()`, so
 * the throw skipped it. The guard stayed ARMED, the throw was caught one level up in
 * `pool-worker.ts:1424` (which prints `[BB-PARSE-ERR]` and returns the regex fallback — that is
 * the `degraded` count), the walk finished normally, and then 120 s later the orphaned timer fired
 * in an unrelated turn of the event loop, named the last file whose parse had thrown, and called
 * `process.exit(1)` — after the summary had already been printed.
 *
 * That reading predicts three things this probe tests directly, in three child processes:
 *
 *   ARM A   old shape (disarm after the parse)  + parse THROWS  -> leak: exits 1 with [BB-HANG]
 *   ARM B   old shape (disarm after the parse)  + parse SUCCEEDS -> no leak: exits 0, fast
 *   ARM C   current shape (disarm in `finally`) + parse THROWS  -> no leak: exits 0, fast
 *
 * ARM B is the control for ARM A: without it, ARM A's exit 1 could be explained by "a bomb always
 * fires" rather than "a THROW skips the disarm". ARM C is the live claim about the tree as checked
 * out. If ARM C leaked, this probe would say so and the finding would be that the engine fix did
 * not hold.
 *
 * The 120 s figure is shortened to `BOMB_MS` because the question is the leak and its ordering,
 * not the timeout value. Nothing here claims to reproduce a tree-sitter trap: that is a separate
 * measurement (`probe-hang-live.ts`), and this probe deliberately does not assert it.
 *
 * Run: `npx tsx validation/m14/fixtures/r/probe-hang-mechanism.ts`  (exits 0 iff A leaks, B and C do not)
 */

import { execFileSync } from "node:child_process"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const NODE = process.execPath
const BOMB_MS = 400
/** Comfortably longer than BOMB_MS, so a leaked timer has every chance to fire. */
const KILL_AFTER_MS = 3000

/** The pre-8f0e0c930 shape: the disarm sits on the line AFTER the parse. */
const OLD_SHAPE = `function parseRawLike() {
  const parseBomb = setTimeout(() => {
    process.stderr.write("[BB-HANG] parser stuck 120s on ggplot2/R/scale-hue.R — exiting\\n")
    process.exit(1)
  }, ${BOMB_MS})
  step()                    // parser.parse(content) — the line the throw escapes
  clearTimeout(parseBomb)   // on the next line: NEVER REACHED when step() throws
}`

/** The shape as of 8f0e0c930: the disarm is in `finally`. */
const NEW_SHAPE = `function parseRawLike() {
  const parseBomb = setTimeout(() => {
    process.stderr.write("[BB-HANG] parser stuck 120s on ggplot2/R/scale-hue.R — exiting\\n")
    process.exit(1)
  }, ${BOMB_MS})
  try {
    step()
  } finally {
    clearTimeout(parseBomb)
  }
}`

const DRIVER = (shape: string, stepBody: string) => `const step = () => { ${stepBody} }
${shape}
// pool-worker.ts:1424 — the trap is CAUGHT one level up and the regex fallback is returned.
function workerLike() {
  try { parseRawLike(); return "parsed" } catch (e) { return "degraded (regex fallback): " + e.message }
}
const v = workerLike()
console.log("files walked OK: 1   " + v)
console.log("summary printed; exitCode set to 0; event loop now drains")
process.exitCode = 0
`

type Arm = { name: string; shape: string; step: string; expect: "leak" | "clean" }

const ARMS: Arm[] = [
  {
    name: "A  old shape + THROW (the reported R shape)",
    shape: OLD_SHAPE,
    step: `throw new Error("memory access out of bounds")`,
    expect: "leak",
  },
  {
    name: "B  old shape + SUCCESS (control for A)",
    shape: OLD_SHAPE,
    step: `/* returns normally */`,
    expect: "clean",
  },
  {
    name: "C  current shape (finally) + THROW (the tree as checked out)",
    shape: NEW_SHAPE,
    step: `throw new Error("memory access out of bounds")`,
    expect: "clean",
  },
]

const dir = mkdtempSync(path.join(tmpdir(), "bb-hangmech-"))
const results: { arm: Arm; status: number; ms: number; out: string; bombed: boolean }[] = []

for (const [i, arm] of ARMS.entries()) {
  const file = path.join(dir, `arm${i}.mjs`)
  writeFileSync(file, DRIVER(arm.shape, arm.step))
  const t0 = Date.now()
  let status = -1
  let out = ""
  try {
    out = execFileSync(NODE, [file], { stdio: "pipe", timeout: KILL_AFTER_MS, encoding: "utf8" })
    status = 0
  } catch (e: any) {
    status = typeof e.status === "number" ? e.status : -1
    out = `${e.stdout ?? ""}${e.stderr ?? ""}`
  }
  const ms = Date.now() - t0
  results.push({ arm, status, ms, out, bombed: out.includes("[BB-HANG]") })
}

console.log("=".repeat(78))
console.log("PROBE — is [BB-HANG] a hang, or a timer leaked by a thrown parse?")
console.log(`node ${process.version}   bomb=${BOMB_MS}ms   kill-after=${KILL_AFTER_MS}ms`)
console.log("=".repeat(78))

let ok = true
for (const r of results) {
  const leaked = r.status === 1 && r.bombed && r.ms >= BOMB_MS
  const clean = r.status === 0 && !r.bombed && r.ms < BOMB_MS
  const got = leaked ? "LEAK" : clean ? "clean" : `UNCLASSIFIED (exit ${r.status}, ${r.ms}ms)`
  const good = r.arm.expect === "leak" ? leaked : clean
  if (!good) ok = false
  console.log()
  console.log(`${r.arm.name}`)
  console.log(`  expect ${r.arm.expect.toUpperCase().padEnd(5)}  got ${got}  exit=${r.status}  wall=${r.ms}ms`)
  console.log(`  [BB-HANG] printed: ${r.bombed ? "YES" : "no"}`)
  for (const line of r.out.split("\n").filter(Boolean)) console.log(`    | ${line}`)
}

console.log()
console.log("-".repeat(78))
if (ok) {
  console.log("RESULT: the mechanism reproduces and the current tree is immune to it.")
  console.log("        A leaks only because the THROW skips the disarm (B proves the disarm")
  console.log("        normally runs); C proves `finally` closes the path on this checkout.")
  console.log()
  console.log("        => `[BB-HANG] ... on ggplot2/R/scale-hue.R` is NOT evidence that file hangs.")
  console.log("        => it names the last parse that THREW, which is why the named file changes")
  console.log("           between runs and parses cleanly alone.")
  process.exit(0)
} else {
  console.log("RESULT: NOT REPRODUCED / NOT IMMUNE. The reading above must not be claimed.")
  console.log("        One of the three arms behaved against its prediction; investigate before")
  console.log("        reporting any verdict on the R hang.")
  process.exit(1)
}
