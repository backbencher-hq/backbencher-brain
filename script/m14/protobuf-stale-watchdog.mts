/**
 * STALE WATCHDOG — why a gate can print a PASS and still exit 1.
 *
 * ## The observation this probe explains
 *
 * `script/m14/protobuf-ruling-table-proof.mts` run (c) — the derived coverage gate with
 * protobuf wired into `LANGS`, so both instruments read the protobuf grammar — printed
 *
 *   emitted 5/10   ruled-sound 5   FALSIFIED 0   ruled-without-justification 0
 *
 * and the process exited **1**. Run (c) is computed from a single `rows` array:
 *
 *   script/m14/ontology-coverage-gate.ts:383-397
 *     const falsified   = rows.filter((r) => r.status === "FALSIFIED")
 *     const unjustified = rows.filter((r) => r.status === "RULED-UNJUSTIFIED")
 *     console.log(`emitted ${emitted.length}/10 … FALSIFIED ${falsified.length} …`)
 *     process.exitCode = falsified.length + unjustified.length === 0 ? 0 : 1
 *
 * `FALSIFIED 0` and `unjustified 0` therefore FORCE `exitCode = 0`. There is no code
 * path from that summary line to exit 1. So the 1 came from somewhere else, and it
 * was not reproducible: of three full runs of the proof, run (c) exited 1 once and 0
 * twice, with a byte-identical verdict line all three times.
 *
 * ## The cause, located in code this lane does not own
 *
 * `src/ast/engine.ts:1441-1447` arms a per-file self-destruct and disarms it ONE line
 * after the parse returns:
 *
 *   const parseBomb = setTimeout(() => {
 *     process.stderr.write(`[BB-HANG] parser stuck 120s on ${filePath} — exiting\n`)
 *     process.exit(1)
 *   }, 120000)
 *
 *   const tree = parser.parse(content)
 *   clearTimeout(parseBomb)      // <-- skipped when parse() THROWS
 *
 * `parser.parse` is synchronous WASM and a WASM trap THROWS. This lane loses files to
 * exactly that trap, and the loss is real and measured — `memory access out of bounds`
 * on `pb-googleapis/google/api/apikeys/v2/resources.proto` and
 * `pb-googleapis/google/api/auth.proto` in this pass's census. So the throw skips the
 * disarm and leaves a LIVE 120 s timer in the event loop.
 *
 * `parseFile` catches the throw (`src/ast/pool-worker.ts:1222-1237`), prints
 * `[BB-PARSE-ERR]`, and falls back to `extractFallback`. The CATCH does not disarm the
 * timer either, because the timer belongs to a frame that already unwound. The walk
 * continues over the remaining ~840 files. When 120 s have elapsed since the throwing
 * file, the stale timer fires and calls `process.exit(1)`, terminating a process whose
 * verdict was computed correctly and printed in full.
 *
 * That is why it is load-dependent and intermittent: it fires only if the walk still has
 * 120 s of work left after the throwing file. Ten lanes share this machine, so whether
 * 120 s elapse is a function of who else is running.
 *
 * ## Why this matters beyond this lane
 *
 * The exit code is how the arbiter is consumed. A supervisor reading exit 1 concludes
 * the lane failed; exit 0 concludes it passed. For this lane the verdict line is the
 * reliable signal and the exit code is not, and nothing in the output says so — because
 * `protobuf-ruling-table-proof.mts:115-120` filters `BB-PARSE-ERR` and `BB-HANG` out of
 * BOTH streams, which removes the only two lines that would explain a non-zero exit:
 *
 *   const NOISE_TOKENS = ["BB-PARSE-ERR", "BB-HANG"]
 *
 * A second, compounding defect, and it is in THIS lane's file. The filter is right for
 * the table and wrong for the diagnosis: a `[BB-PARSE-ERR]` line is noise in a verdict
 * table and is the whole explanation in a failing run.
 *
 * ## What this probe does
 *
 * It does not infer the mechanism from reading engine.ts. It arms the same condition
 * the census creates and shows the process dying with a correct result already on
 * stdout and no error anywhere:
 *
 *   1. hook stderr BEFORE parsing, so a trap is observable — `parseFile` swallows the
 *      error and returns a fallback, so the only evidence a trap happened is the line
 *      pool-worker writes;
 *   2. parse corpus files through production `parseFile` until one traps, largest
 *      first, because a trap that depends on input size is likelier on a big file;
 *   3. print a marker line and this process's own PID;
 *   4. hold the event loop open past 120 s with a keep-alive timer;
 *   5. report which of the two happened — the marker and a clean exit 0, or death by
 *      the stale watchdog carrying an exit code this probe never chose.
 *
 * No filename is hard-coded, so a corpus change cannot silently turn this into a probe
 * that tests nothing, and no filename is trusted either: a file is only reported as
 * trapping when the stderr hook saw the trap on that iteration.
 *
 * Reproduce: npx tsx script/m14/protobuf-stale-watchdog.mts [--files N] [--hold-seconds S]
 *
 * A negative result is reported as a negative result. If no file traps within `--files`,
 * the probe prints `TRAPPING FILE: NONE FOUND` and then still holds the loop, so the
 * reader can tell "no trap, therefore nothing to arm" apart from "trap armed, no fire".
 *
 * `src/ast/engine.ts` is shared machinery this lane does not own (§8). The fix, for
 * whoever applies it: disarm in a `finally`, so the timer cannot outlive a throwing
 * parse. The `process.exit(1)` is a second question — the watchdog exists to stop an
 * infinite loop, and a parse that has already returned or thrown cannot be one — but
 * the disarm alone removes the false exits, and the disarm is the smaller change.
 */
import { readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
/**
 * Both spellings are accepted. An earlier version read only `--k=N`, so `--files 60`
 * was silently ignored and the run used the default while its own banner printed a
 * number derived from the default — a probe that reports the bound it used is the
 * whole point of a bounded search, so a bound the caller set and did not get is the
 * one failure this must not have.
 */
const argNum = (k: string, d: number): number => {
  const eq = process.argv.find((x) => x.startsWith(`--${k}=`))
  if (eq) {
    const n = Number(eq.slice(k.length + 3))
    if (Number.isFinite(n) && n > 0) return n
  }
  const at = process.argv.indexOf(`--${k}`)
  if (at >= 0 && process.argv[at + 1] !== undefined) {
    const n = Number(process.argv[at + 1])
    if (Number.isFinite(n) && n > 0) return n
  }
  return d
}
const FILES = argNum("files", 40)
const HOLD = argNum("hold-seconds", 135)
/**
 * Walk order. `discovery` (the default) is the order `protobuf-census.ts` walks in:
 * repos sorted, paths sorted within a repo. `size` is the same set re-sorted by
 * descending byte length.
 *
 * The default is `discovery` because that is the order under which the fault has been
 * OBSERVED, and an earlier version of this probe defaulted to `size` on the reasoning
 * that "a trap that depends on input size is likelier on a big file". That reasoning was
 * an assumption, it was never measured, and it suppressed the fault completely: all 847
 * files parsed largest-first in one process with zero traps, while the census on the
 * same 847 files traps two. Both results are kept — the negative one is evidence that
 * the fault is not a property of any single file — but the order that reproduces is the
 * default, because a probe whose default cannot reproduce the thing it exists to
 * reproduce reports a clean bill of health for the wrong reason.
 */
const ORDER = (() => {
  const eq = process.argv.find((x) => x.startsWith("--order="))
  if (eq) return eq.slice("--order=".length)
  const at = process.argv.indexOf("--order")
  if (at >= 0 && process.argv[at + 1] !== undefined) return process.argv[at + 1]
  return "discovery"
})()

// ------------------------------------------------------- stderr hook, FIRST
// `parseFile` catches a parse trap and returns a fallback, so the ONLY evidence a trap
// happened is the line pool-worker writes to stderr. Installed before any parse.
let lastParseErr: string | null = null
{
  const orig = process.stderr.write.bind(process.stderr)
  ;(process.stderr as any).write = (chunk: any, ...rest: any[]): boolean => {
    const s = typeof chunk === "string" ? chunk : Buffer.isBuffer(chunk) ? chunk.toString() : String(chunk)
    for (const line of s.split("\n")) {
      if (line.includes("BB-PARSE-ERR")) lastParseErr = line.trim()
      if (line.includes("BB-HANG")) lastParseErr = `${lastParseErr ?? ""} | ${line.trim()}`.trim()
    }
    return (orig as any)(chunk, ...rest)
  }
}

// ---------------------------------------------------------------- corpus walk
const files: string[] = []
for (const entry of readdirSync(CR).sort()) {
  const dir = path.join(CR, entry)
  try { if (!statSync(dir).isDirectory()) continue } catch { continue }
  const walk = (d: string): void => {
    let kids: string[]
    try { kids = readdirSync(d) } catch { return }
    for (const k of kids.sort()) {
      if (k === ".git" || k === "node_modules") continue
      const abs = path.join(d, k)
      let st
      try { st = statSync(abs) } catch { continue }
      if (st.isDirectory()) { walk(abs); continue }
      if (!k.endsWith(".proto")) continue
      if (st.size > 512 * 1024) continue
      files.push(abs)
    }
  }
  walk(dir)
}
// Discovery order IS the walk order: the loop above pushes in repos-sorted,
// paths-sorted sequence, which is byte-for-byte `protobuf-census.ts:57-80`.
if (ORDER === "size") {
  const sizeOf = new Map<string, number>()
  for (const f of files) { try { sizeOf.set(f, statSync(f).size) } catch { sizeOf.set(f, 0) } }
  files.sort((a, b) => (sizeOf.get(b) ?? 0) - (sizeOf.get(a) ?? 0))
}

console.log(`corpus ${files.length} .proto files; order=${ORDER}; probing up to ${FILES} for a parse trap`)

// ------------------------------------------------------------------ step 1/2
let trapped: string | null = null
let attempts = 0
const started = Date.now()
for (const f of files) {
  if (attempts >= FILES) break
  attempts++
  lastParseErr = null
  try { await parseFile(f) } catch { /* parseFile handles its own errors */ }
  if (lastParseErr !== null) {
    trapped = f
    console.log(`TRAP on attempt ${attempts}/${files.length}: ${path.relative(CR, f)}`)
    console.log(`  stderr: ${lastParseErr}`)
    break
  }
  if (attempts % 10 === 0) console.log(`  …${attempts} parsed, no trap yet`)
}

// ------------------------------------------------------------------ step 3/4/5
//
// `--arm` skips the corpus search and demonstrates the CONSEQUENCE directly, by
// reproducing the code SHAPE of `src/ast/engine.ts:1441-1447` with the throw injected.
// It is labelled a structural demonstration because that is what it is: the wasm trap
// is intermittent and this pass did not reproduce it (0 traps in 847 files, two walk
// orders), so the corpus arm of this probe reports a real negative and the mechanism
// is shown here instead of asserted. The three lines marked `engine.ts` are the shape
// as read from that file; the `throw` between the parse and the disarm is what a WASM
// trap does.
if (process.argv.includes("--arm")) {
  console.log("")
  console.log("ARMED: reproducing the SHAPE of src/ast/engine.ts:1441-1447 with a throw")
  console.log("  (a structural demonstration, not a reproduction of the wasm trap — see header)")
  const fire = setTimeout(() => {
    process.stderr.write(`[BB-HANG] parser stuck 120s on <the file whose parse threw> — exiting\n`)
    process.exit(1)
  }, 120000)

  const parseLikeEngineParse = (): never => {
    // engine.ts: const tree = parser.parse(content)
    throw new Error("simulated wasm trap: memory access out of bounds")
  }
  try {
    parseLikeEngineParse()
    // engine.ts: clearTimeout(parseBomb) — on the line AFTER the parse, with NO
    // try/finally and NO catch between them. It is INSIDE this try for that reason:
    // placing it outside (as a first version of this probe did) makes the demo prove
    // the opposite of its own claim, and it did — it printed SURVIVED, correctly,
    // because the throw had been caught before reaching the disarm.
    clearTimeout(fire)
  } catch {
    // pool-worker.ts:1222 catches this. The catch CANNOT reach `parseBomb`: the timer
    // belongs to a frame that has already unwound, which is the whole defect.
    console.log("caught the throw, exactly as src/ast/pool-worker.ts:1222 does")
    console.log("the disarm above was skipped, so a 120s timer is now armed")
  }

  console.log(`MARKER pid=${process.pid} verdict=clean-eligible; holding the loop past 120s`)
  const keepAlive = setInterval(() => {}, 1000)
  setTimeout(() => {
    clearInterval(keepAlive)
    console.log("SURVIVED — the watchdog did NOT fire")
    process.exit(0)
  }, 140000)
} else {
  console.log("")
  console.log(`TRAPPING FILE: ${trapped ? path.relative(CR, trapped) : `NONE FOUND in ${attempts} attempts`}`)
  console.log(`MARKER pid=${process.pid} verdict=clean-eligible`)
  const keepAlive = setInterval(() => {}, 1000)
  setTimeout(() => {
    clearInterval(keepAlive)
    console.log(`SURVIVED ${HOLD}s holding the event loop — the stale watchdog did NOT fire`)
    console.log(`RESULT: no stale timer armed; elapsed ${Math.round((Date.now() - started) / 1000)}s`)
    process.exit(0)
  }, HOLD * 1000)
}
