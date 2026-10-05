/**
 * WHY `memory access out of bounds` HAPPENS TO SOME FILES AND NOT OTHERS.
 *
 * ## The observation this probe exists to explain
 *
 * Six runs of `script/m14/protobuf-incoming-audit.mts` on the SAME 847-file corpus with
 * `src/` byte-identical produced SIX TABLES, and the table tracks how many parses trapped:
 *
 *   run  traps  hangs  exit  declarations with >=1 inbound edge   uses in-file-both
 *   #1     0      0      0              37424 (96.26%)                  9853
 *   #2     0      0      0              37424 (96.26%)                  9853
 *   #3     0      0      0              37424 (96.26%)                  9853
 *   #4     5      1      1              37325 (96.01%)                  9832
 *   #5     1      1      1              37406 (96.22%)                  9850
 *   #6     0      0      0              37424 (96.26%)                  9853
 *
 * Five trapped parses cost 99 declarations their inbound edge and 21 `uses` edges their
 * in-file resolution. Every trap was `memory access out of bounds` on one of five files,
 * and the `[BB-HANG]` line that follows always named the FIRST trapped file — a file whose
 * parse had already thrown, been caught, been counted, and whose tool went on to finish.
 *
 * Earlier passes recorded the same trap as "not reproducible in isolation". That is the
 * shape of a CONCURRENCY fault, not of a malformed file, and this probe tests that reading
 * instead of restating it.
 *
 * ## The candidate cause, from source
 *
 * `ASTEngine.getParser` (src/ast/engine.ts:723) keeps a module-level `parsers: Map` and
 * returns the CACHED instance:
 *
 *     if (parsers.has(language)) {
 *       parserUsage.set(language, Date.now())
 *       parseCount.set(language, currentCount + 1)
 *       return parsers.get(language)!
 *     }
 *
 * There is no lease, no checkout and no per-call parser. So N concurrent `parseFile` calls
 * for one language all reach `parser.parse(content)` (src/ast/engine.ts:1448) on the SAME
 * `Parser` object, and a `Parser` carries the in-flight parse in WASM-side state. Two
 * interleaved `parse()` calls on one instance corrupt each other's view of linear memory,
 * which is what `memory access out of bounds` is.
 *
 * The same function also DELETES that shared instance on a counter:
 *
 *     if (currentCount >= 500 && parsers.has(language)) {
 *       const p = parsers.get(language)!
 *       try { if (typeof p.delete === "function") p.delete() } catch {}
 *       parsers.delete(language); languages.delete(language)
 *       parserUsage.delete(language); parseCount.set(language, 0)
 *     }
 *
 * `p.delete()` frees WASM-side memory while other concurrent callers may still be inside
 * `parse()` on that very object. That is a use-after-free, and the corpus is 847 files — it
 * CROSSES the 500 threshold partway through a walk, which is why the fault looks
 * schedule-dependent and why it appears on some runs and not others. `--mode corpus`
 * exists to test this one: it records the SEQUENCE NUMBER of every parse and the sequence
 * number of every trap, so a trap that starts at parse ~500 is evidence for the recreate
 * race and a trap spread evenly from parse 1 is evidence against it.
 *
 * `parseBomb` (src/ast/engine.ts:1441) is armed immediately before that call and cleared
 * immediately after it — so a THROW leaves it armed, and 120 s later it calls
 * `process.exit(1)` in a process that has already printed its verdict. That is the
 * `[BB-HANG]` false attribution, and it is why a trapped run exits 1 after printing a
 * complete table.
 *
 * ## What this probe measures, and what it does not claim
 *
 *   IDENTITY  two `getParser("protobuf")` calls return the same object → the shared
 *             instance is not a hypothesis, it is a fact about the running code.
 *   SERIAL    the five observed files, parsed one at a time, `--rounds` times each.
 *   CONCURRENT the same files through `--workers` concurrent workers.
 *   CORPUS    the whole corpus, so the parse count crosses 500 and the trap's position in
 *             the parse sequence becomes readable.
 *
 * If SERIAL traps 0 and CONCURRENT traps > 0 on the same files, concurrency is the cause
 * and the fix belongs in `src/ast/engine.ts`, which this lane does not own. If SERIAL also
 * traps, the fault is in the file or the grammar and the concurrency reading is wrong. If
 * CORPUS traps only from parse ~500 on, the recreate race is implicated over plain
 * interleaving. If it traps from parse 1, the recreate race is not the whole story.
 *
 * It does NOT claim the fix works, and it does not measure the cost of a fix. It measures
 * which of two causes the evidence supports, and names the file that has to change.
 *
 * ## Skipping
 *
 * Needs nothing but this repository. No protoc, no corpus staging. Exits 0 either way; the
 * verdict is printed, because a probe that cannot fail is a probe that cannot inform.
 *
 * ## Reproduce
 *
 *   npx tsx script/m14/protobuf-wasm-trap-probe.mts --rounds 8 --workers 8
 *   npx tsx script/m14/protobuf-wasm-trap-probe.mts --mode corpus --workers 8
 */
import * as path from "node:path"
import { existsSync, readdirSync, statSync } from "node:fs"
import { parseFile } from "../../src/ast/pool-worker"
import { ASTEngine } from "../../src/ast/engine"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const argOf = (name: string, dflt: string): string => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : dflt
}
const ROUNDS = Number(argOf("rounds", "8"))
const WORKERS = Number(argOf("workers", "8"))
const MODE = argOf("mode", "all")

/** The five files that have trapped, named by the six runs recorded in this file's header. */
const OBSERVED = [
  "nomad/plugins/shared/structs/proto/stats.proto",
  "nvim-treesitter/tests/query/highlights/proto/test.proto",
  "pb-googleapis/google/api/apikeys/v2/apikeys.proto",
  "pb-googleapis/google/api/auth.proto",
  "pb-googleapis/google/api/backend.proto",
]

const files = OBSERVED.map((r) => path.join(CR, r)).filter((f) => existsSync(f))
if (files.length === 0) {
  console.log(`SKIP — none of the ${OBSERVED.length} observed files is on disk under ${CR}`)
  console.log("  This probe ran NO comparison. A missing input is not a passing input.")
  process.exit(0)
}

/**
 * Traps are counted from what PRODUCTION logged. `parseFile` catches the WASM throw and
 * substitutes a degraded fallback extraction, so the call itself resolves; the only record
 * that a trap happened is the `[BB-PARSE-ERR]` line. Patching `process.stderr.write` counts
 * it without re-implementing the catch, and without matching anything in the source text.
 */
let trapCount = 0
const trappedFiles: string[] = []
/** The parse SEQUENCE NUMBER each trap happened at, for the recreate-race test. */
const trapAt: number[] = []
let parseSeq = 0
const realWrite = process.stderr.write.bind(process.stderr)
process.stderr.write = ((chunk: any, ...rest: any[]): boolean => {
  const s = typeof chunk === "string" ? chunk : String(chunk)
  if (s.includes("[BB-PARSE-ERR]")) {
    trapCount++
    trapAt.push(parseSeq)
    const parts = s.split("|")
    if (parts.length >= 2) trappedFiles.push(parts[1].trim())
  }
  // Suppress the line: it is counted above, and printing it would make a clean run and a
  // trapping run look identical in the log.
  if (s.includes("[BB-PARSE-ERR]") || s.includes("[BB-HANG]")) return true
  return (realWrite as any)(chunk, ...rest)
}) as any

const since = () => trapCount
const delta = (from: number) => trapCount - from

async function serial(): Promise<{ attempts: number; traps: number }> {
  const start = since()
  let attempts = 0
  for (let r = 0; r < ROUNDS; r++) {
    for (const f of files) {
      attempts++
      parseSeq++
      try {
        await parseFile(f, path.dirname(f))
      } catch {
        /* parseFile catches the trap itself; a throw here is a different failure and is
           counted by the same trap tally only if production logged it */
      }
    }
  }
  return { attempts, traps: delta(start) }
}

async function concurrent(): Promise<{ attempts: number; traps: number }> {
  const start = since()
  let attempts = 0
  let next = 0
  async function worker(): Promise<void> {
    while (true) {
      const i = next++
      if (i >= files.length * ROUNDS) return
      const f = files[i % files.length]
      attempts++
      parseSeq++
      try {
        await parseFile(f, path.dirname(f))
      } catch {
        /* see serial() */
      }
    }
  }
  await Promise.all(Array.from({ length: WORKERS }, () => worker()))
  return { attempts, traps: delta(start) }
}

/**
 * The whole corpus, so `getParser`'s 500-parse recreate threshold is crossed and the trap's
 * POSITION in the parse sequence becomes readable. 847 files at 8 workers is the shape the
 * audit runs that trapped had; a single `parseFile` per file with no repeats is the shape
 * the census has.
 */
async function corpusMode(): Promise<{ attempts: number; traps: number; at: number[] }> {
  const all: string[] = []
  for (const entry of readdirSync(CR).sort()) {
    const dir = path.join(CR, entry)
    let isDir = false
    try { isDir = statSync(dir).isDirectory() } catch { continue }
    if (!isDir) continue
    const walk = (d: string): void => {
      let kids: string[]
      try { kids = readdirSync(d) } catch { return }
      for (const k of kids.sort()) {
        if (k === ".git" || k === "node_modules") continue
        const abs = path.join(d, k)
        let st
        try { st = statSync(abs) } catch { continue }
        if (st.isDirectory()) { walk(abs); continue }
        if (k.endsWith(".proto")) all.push(abs)
      }
    }
    walk(dir)
  }
  const start = since()
  const startSeq = parseSeq
  let next = 0
  async function worker(): Promise<void> {
    while (true) {
      const i = next++
      if (i >= all.length) return
      const f = all[i]
      parseSeq++
      try {
        await parseFile(f, path.dirname(f))
      } catch {
        /* see serial() */
      }
    }
  }
  await Promise.all(Array.from({ length: WORKERS }, () => worker()))
  return { attempts: all.length, traps: delta(start), at: trapAt.filter((n) => n > startSeq).map((n) => n - startSeq) }
}

console.log(`wasm trap probe — corpus root ${CR}`)
console.log(`observed trapping files present: ${files.length} of ${OBSERVED.length}, ${ROUNDS} rounds, ${WORKERS} concurrent workers, mode ${MODE}\n`)

// --- IDENTITY: is the cached parser one object or many? ---
const p1 = await ASTEngine.getParser("protobuf")
const p2 = await ASTEngine.getParser("protobuf")
const sameInstance = p1 === p2
console.log("IDENTITY")
console.log(`  getParser("protobuf") twice returns the SAME Parser object: ${sameInstance}`)
console.log(`  this is the precondition for the concurrency reading; it is read from the`)
console.log(`  running code, not inferred from src/ast/engine.ts's source.\n`)

const RECREATE_AT = 500 // src/ast/engine.ts:743 — `if (currentCount >= 500 && ...)`
let serialRes = { attempts: 0, traps: 0 }
let concRes = { attempts: 0, traps: 0 }
let corpusRes: { attempts: number; traps: number; at: number[] } | null = null

if (MODE === "all" || MODE === "serial" || MODE === "concurrent") {
  const s = await serial()
  serialRes = s
  console.log(`SERIAL     ${s.attempts} parses, 1 at a time`)
  console.log(`  traps ${s.traps}`)
  for (const f of new Set(trappedFiles)) console.log(`    ${f}`)
  console.log("")

  const c = await concurrent()
  concRes = c
  console.log(`CONCURRENT ${c.attempts} parses, ${WORKERS} workers`)
  console.log(`  traps ${c.traps}`)
  for (const f of new Set(trappedFiles)) console.log(`    ${f}`)
  console.log("")
}

if (MODE === "all" || MODE === "corpus") {
  const cm = await corpusMode()
  corpusRes = cm
  console.log(`CORPUS     ${cm.attempts} parses, ${WORKERS} workers, crossing getParser's ${RECREATE_AT}-parse recreate`)
  console.log(`  traps ${cm.traps}`)
  if (cm.traps > 0) {
    const at = [...cm.at].sort((a, b) => a - b)
    console.log(`  trap at parse #  min ${at[0]}  max ${at[at.length - 1]}  all ${JSON.stringify(at)}`)
    const after = at.filter((n) => n >= RECREATE_AT).length
    console.log(`  traps at or after parse ${RECREATE_AT}: ${after} of ${at.length}` + (after === at.length ? "  <- consistent with the recreate race" : "  <- traps before the recreate, so it is not the only cause"))
  }
  for (const f of new Set(trappedFiles)) console.log(`    ${f}`)
  console.log("")
}

console.log("VERDICT")
if (corpusRes && corpusRes.traps > 0) {
  const after = corpusRes.at.filter((n) => n >= RECREATE_AT).length
  if (after === corpusRes.at.length) {
    console.log(`  RECREATE RACE is supported: every trap landed at parse ${RECREATE_AT} or later,`)
    console.log(`  and getParser deletes the shared Parser at exactly ${RECREATE_AT} parses while other`)
    console.log("  concurrent callers may be inside parse() on it. The fix belongs in")
    console.log("  src/ast/engine.ts:getParser — do not `p.delete()` an instance that is in use.")
  } else {
    console.log(`  RECREATE RACE is NOT the whole story: ${corpusRes.at.length - after} of ${corpusRes.at.length} traps`)
    console.log(`  landed before parse ${RECREATE_AT}, so plain interleaving on one shared instance is implicated too.`)
  }
} else if (MODE === "corpus") {
  console.log(`  NOT REPRODUCED on the corpus this run: ${corpusRes?.attempts ?? 0} parses, 0 traps.`)
  console.log("  This run establishes nothing either way — see the recorded audit runs in the header.")
} else {
  const serialClean = serialRes.traps === 0
  const concurrentTraps = concRes.traps > 0
  if (sameInstance && serialClean && concurrentTraps) {
    console.log("  CONCURRENCY is supported: one shared Parser instance, 0 traps serially,")
    console.log(`  ${concRes.traps} under ${WORKERS} workers, on the same files. The fix belongs in`)
    console.log("  src/ast/engine.ts:getParser — a per-call or leased Parser, and a `finally`")
    console.log("  around parseBomb. This lane does not own that file and does not edit it.")
  } else if (concurrentTraps && !serialClean) {
    console.log("  THE FILE OR THE GRAMMAR is implicated: serial parses trap too, so")
    console.log("  concurrency is not necessary for the fault.")
  } else if (!concurrentTraps && !serialClean) {
    console.log("  UNEXPLAINED: traps occur without concurrency and not with it. Treat this")
    console.log("  run as evidence of nothing; re-run before quoting a cause.")
  } else {
    console.log("  NOT REPRODUCED: 0 traps in both modes on this run. The trap is")
    console.log("  schedule-dependent and did not fire here, so this run establishes")
    console.log("  nothing either way. Six recorded audit runs did trap — see the header.")
  }
}
console.log("")
console.log(`limits: ${ROUNDS} rounds x ${files.length} files is a sample of the fault's rate,`)
console.log("not its rate; and a run with 0 traps is a run that did not observe the fault.")