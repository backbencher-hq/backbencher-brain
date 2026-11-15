/**
 * Does the walk's checkpoint tell the truth? — the dart lane's test for `resumable-walk`.
 *
 * WHY THIS EXISTS
 *
 * The whole-corpus dart gate could not be measured, and the reason was misread for three
 * days as "the corpus contains a file that hangs the parser". Two defects produced that
 * misreading, and both are in the checkpoint's semantics rather than in any analyzer:
 *
 *   1. `parseFile` does not reject when a parse crashes. It catches, writes
 *      `[BB-PARSE-ERR]`, and returns `extractFallback(...)` — regex extraction. The walk
 *      then wrote a plain `done` line, so a file the analyzer never read was
 *      indistinguishable from one it had measured, and the regex edges were counted as
 *      evidence that the analyzer fires.
 *   2. The file a run DIES on was never written at all (the marker came after the parse),
 *      so it was re-walked and re-killed forever, and the only file named in the output
 *      was the last one whose parse THREW — a different file entirely.
 *
 * A fix to a measurement instrument that is not itself tested is how the next three days
 * get lost the same way, so each semantic above is asserted here directly, against a
 * synthetic corpus and a synthetic checkpoint. No source files, no WASM, no corpus: this
 * runs in under a second and cannot be confused by what the corpus happens to contain.
 *
 * Run: npx tsx validation/m14/fixtures/dart/walk-checkpoint-honesty.ts
 */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { resumableWalk, readCheckpoint, resetCheckpoint } from "../../../../script/m14/resumable-walk"

let pass = 0
const failures: string[] = []
function check(what: string, ok: boolean, detail = ""): void {
  if (ok) { pass++; console.log(`  PASS  ${what}`) }
  else { failures.push(what); console.log(`  FAIL  ${what}${detail ? ` — ${detail}` : ""}`) }
}

const dir = mkdtempSync(join(tmpdir(), "bb-walk-honesty-"))
const cpPath = join(dir, "walk.txt")
const ids = ["/corpus/a.dart", "/corpus/b.dart", "/corpus/c.dart", "/corpus/d.dart"]
const opts = (run: (i: number) => Promise<any>) => ({ id: (i: number) => ids[i], concurrency: 4, run })

// ── 1. a fresh walk records four DIFFERENT outcomes as four different things ─────────
console.log("\n1. fresh walk: measured / degraded / abandoned are distinguishable")
let ran = 0
const s1 = await resumableWalk(cpPath, 4, opts(async (i) => {
  ran++
  if (i === 1) return { degraded: true, reason: "fallback:true (regex extraction)" } // a swallowed crash
  if (i === 2) throw new Error("killed the walk")                                     // abandon
  return undefined                                                                    // measured
}))
check("all four files were attempted", ran === 4, `ran=${ran}`)
check("walked counts only the 2 real measurements", s1.walked === 2, `walked=${s1.walked}`)
check("degraded is reported separately from walked", s1.degraded === 1, `degraded=${s1.degraded}`)
check("the abandoning file is counted bad", s1.skippedBad === 1, `skippedBad=${s1.skippedBad}`)
check("partial is TRUE when anything was degraded or abandoned", s1.partial === true)

const raw1 = readFileSync(cpPath, "utf8")
check("checkpoint carries the format header", raw1.startsWith("#bb-walk v2\n"), JSON.stringify(raw1.split("\n")[0]))
check("each attempt was recorded BEFORE its parse", raw1.includes(">/corpus/a.dart"))
check("a degraded file is NOT written as a success", raw1.includes("~/corpus/b.dart") && !raw1.includes("\n/corpus/b.dart"))
check("an abandoned file is marked, not dropped", raw1.includes("!/corpus/c.dart"))
check("the real measurement is a bare line", raw1.includes("\n/corpus/a.dart"))

// ── 2. resume: settled files are skipped, a degraded file gets ONE retry ─────────────
console.log("\n2. resume: settled files are skipped; a degraded file is retried once")
const retriedIds: number[] = []
const s2 = await resumableWalk(cpPath, 4, opts(async (i) => { retriedIds.push(i); return undefined }))
check("the measured file was not re-walked", !retriedIds.includes(0), `retried=${retriedIds.join(",")}`)
check("the abandoned file was not retried", !retriedIds.includes(2))
check("the degraded file WAS retried (a trap is usually accumulated state, not the input)",
  retriedIds.includes(1), `retried=${retriedIds.join(",")}`)
check("alreadyDone counts only the settled SUCCESSES", s2.alreadyDone === 2, `alreadyDone=${s2.alreadyDone}`)
check("the retried file is now a real measurement", s2.walked === 1, `walked=${s2.walked}`)
check("retried is reported", s2.retried === 1, `retried=${s2.retried}`)
// An abandoned file is still in the population and the analyzer never read it, so a run
// that reached the last file is STILL partial. This is the whole point of the change: the
// old checkpoint reported this run's population as complete.
check("a walk containing an abandoned file is reported partial, not complete", s2.partial === true, `partial=${s2.partial}`)

// ── 3. the file the process DIED on is identifiable, and is not re-killed forever ────
console.log("\n3. the file a run died on: named by the checkpoint, not retried forever")
const cp3 = join(dir, "walk-crashed.txt")
// Two attempts with no outcome is exactly what a process killed twice leaves behind.
writeFileSync(cp3, `#bb-walk v2\n>/corpus/x.dart\n>/corpus/x.dart\n`)
let calledOnX = false
const s3 = await resumableWalk(cp3, 1, { id: () => "/corpus/x.dart", run: async () => { calledOnX = true } })
check("a file with 2 attempts and no outcome is NOT run a third time", calledOnX === false)
check("it is recorded as abandoned, with the reason", readFileSync(cp3, "utf8").includes("killed the walk 2 times"))
check("it counts as bad, not as walked", s3.skippedBad === 1 && s3.walked === 0)
check(
  "readCheckpoint can NAME it (the old format could not)",
  readCheckpoint(join(dir, "walk-crashed-2.txt")) !== null && (() => {
    const cp4 = join(dir, "walk-crashed-2.txt")
    writeFileSync(cp4, `#bb-walk v2\n>/corpus/y.dart\n`)
    return readCheckpoint(cp4).unfinished.includes("/corpus/y.dart")
  })(),
)

// ── 4. a legacy checkpoint is not silently trusted ──────────────────────────────────
console.log("\n4. a pre-format checkpoint is reported as untrusted, not quietly accepted")
const cp5 = join(dir, "walk-legacy.txt")
// No header: the ambiguous format. Both offered ids are settled by it — one as a success,
// one as abandoned — so a correct reader runs NOTHING (the callback below throws).
writeFileSync(cp5, `/corpus/a.dart\n!/corpus/b.dart\n`)
const s5 = await resumableWalk(cp5, 2, opts(async () => { throw new Error("must not run") }))
check("legacy history is flagged untrusted", s5.untrustedHistory === true)
check("its done line is still honoured (no forced re-walk of other lanes)", s5.alreadyDone === 1, `alreadyDone=${s5.alreadyDone}`)
check("its bad line is still honoured", s5.skippedBad === 1 && s5.walked === 0, `skippedBad=${s5.skippedBad} walked=${s5.walked}`)
check("the buckets partition the population offered", s5.walked + s5.degraded + s5.alreadyDone + s5.alreadyDegraded + s5.skippedBad === s5.total)

// ── 6. the buckets add up on a realistic mixed population ───────────────────────────
console.log("\n5. buckets partition the population (no file counted twice, none unaccounted)")
for (const [name, s] of [["fresh", s1], ["resumed", s2], ["killed", s3]] as const) {
  const sum = s.walked + s.degraded + s.alreadyDone + s.alreadyDegraded + s.skippedBad
  check(`${name}: ${s.walked}+${s.degraded}+${s.alreadyDone}+${s.alreadyDegraded}+${s.skippedBad} === ${s.total}`, sum === s.total, `sum=${sum}`)
}

// ── 5. resetCheckpoint starts an honest, trusted checkpoint ─────────────────────────
console.log("\n6. resetCheckpoint starts a trustworthy checkpoint")
const cp6 = join(dir, "walk-reset.txt")
writeFileSync(cp6, "stale garbage\n")
resetCheckpoint(cp6)
check("reset writes the header and nothing else", readFileSync(cp6, "utf8") === "#bb-walk v2\n")
check("a reset checkpoint reports trusted, not untrusted", readCheckpoint(cp6).untrustedHistory === false)

console.log(`\n${pass} assertion(s) passed, ${failures.length} failed`)
if (failures.length) { console.log(`FAIL: ${failures.join(" | ")}`); process.exitCode = 1 }
