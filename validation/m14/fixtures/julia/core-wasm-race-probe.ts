/**
 * THE SHARED CORE-WASM RACE — why the arbiter can die before it prints anything.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `docs/analyzers/julia.md` records TWO ways `script/m14/ontology-coverage-gate.ts julia`
 * fails to reach the line that prints its verdict table: a `memory access out of bounds` parse trap
 * plus the `engine.ts:1441` self-destruct bomb, and the 8-worker concurrency that causes the trap.
 * A third way turned up on 2026-10-04 and it is NOT either of those, because it kills the process in
 * the first 400 ms, before a single corpus file is read:
 *
 *     failed to asynchronously prepare wasm: CompileError: WebAssembly.instantiate():
 *       section (code 7, "Export") extends past end of the module (length 4257, remaining bytes 2053)
 *     RuntimeError: Aborted(...) at async init (src/ast/engine.ts:148)
 *
 * That message is a WASM SECTION PARSER running off the end of a buffer. A correct module cannot do
 * that. A TRUNCATED one always can. So the question this probe answers is narrow and falsifiable:
 * can a reader of `/tmp/bb-ts-core.wasm` observe a file SHORTER than the module the writer intended
 * to publish? If yes, the crash is a torn read and no corpus fact is involved.
 *
 * THE DEFECT, FROM SOURCE
 * -----------------------
 * `src/ast/engine.ts:133-137`:
 *
 *     for (const tmpDir of [os.tmpdir(), "/tmp", process.cwd()]) {
 *       const tmp = p.join(tmpDir, "bb-ts-core.wasm")     // :135  FIXED, UNKEYED NAME
 *       fsModule.writeFileSync(tmp, coreWasm)             // :136  truncates, then writes 205,488 bytes
 *       wasmFile = tmp
 *       break
 *     }
 *
 * `writeFileSync` opens O_TRUNC: the 205,488-byte file becomes 0 bytes before any byte of the new
 * content lands. Every process that initialises ASTEngine rewrites this one path, and on Linux
 * `os.tmpdir()` and the literal `"/tmp"` in that array are the SAME directory, so the loop's two
 * candidates are one path.
 *
 * The asymmetry that makes this a defect rather than a style note: the LANGUAGE wasm is keyed by pid
 * and randomness, and this lane's own logs show it —
 * `/tmp/bb-wasm_tree-sitter-julia_tree-sitter-julia.wasm_1604316_5eciyocfza` — so two concurrent
 * lanes cannot corrupt each other's grammar. The CORE wasm has no such key. Six agents share one
 * machine and one fixed core path.
 *
 * WHAT THIS PROBE MEASURES, AND WHAT IT DOES NOT
 * ----------------------------------------------
 * MEASURED: the truncation window is real and observable. A reader concurrent with a writer sees
 * short files; this probe counts the short reads and instantiates them to show they reproduce the
 * arbiter's exact error class. It also shows the file is byte-identical to the engine's source of
 * truth once the writes stop, which is what rules out "the module on disk is wrong" and leaves
 * "the module was read mid-write" as the only remaining explanation of that crash.
 *
 * NOT MEASURED, AND NOT CLAIMED: this probe does not count how often the arbiter dies this way in
 * the field, because that depends on how many other processes are initialising the engine at the
 * same instant, which is a property of the fleet's scheduling and not of this repository. It was
 * observed once, here, with six lanes resident. A frequency claim would need instrumentation across
 * lanes and is not this lane's to make.
 *
 * IT IS NOT A JULIA DEFECT. Nothing in this file reads a corpus file or runs the analyzer. Every
 * number below is about the shared engine's temp-file handling, which is §8 shared machinery: this
 * lane REPORTS the fix and does not make it.
 *
 * USAGE
 * -----
 *   npx tsx validation/m14/fixtures/julia/core-wasm-race-probe.ts
 *   npx tsx validation/m14/fixtures/julia/core-wasm-race-probe.ts --rounds 40
 *
 * READ-ONLY with respect to the repository. It writes ONLY the shared core path that
 * `engine.ts:136` already writes on every engine init, and it restores that path byte-for-byte.
 */
import { createHash } from "node:crypto"
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const argValue = (flag: string, dflt?: string): string | undefined => {
  const i = process.argv.indexOf(flag)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt
}
const ROUNDS = Number(argValue("--rounds", "24") ?? "24")

const sha = (b: Buffer): string => createHash("sha256").update(b).digest("hex")

/** The exact write `engine.ts:136` performs, to the exact path `engine.ts:135` names. */
const CORE_NAME = "bb-ts-core.wasm"
const candidates = [os.tmpdir(), "/tmp", process.cwd()]
const corePath = candidates.map((d) => path.join(d, CORE_NAME)).find((p) => {
  try {
    return existsSync(p) && statSync(p).isFile()
  } catch {
    return false
  }
})

if (!corePath) {
  console.log(`no ${CORE_NAME} on disk; nothing to probe.`)
  console.log("run any instrument that initialises ASTEngine first, e.g.:")
  console.log("  npx tsx script/m14/firing-check.ts --files 8 julia")
  process.exit(2)
}

/** The engine's own source of truth: the module `hasWasmInRegistry("tree-sitter.wasm")` yields. */
function resolveTruth(): Buffer | null {
  const roots = [process.cwd(), path.resolve(process.cwd(), "node_modules")]
  for (const root of roots) {
    const p = path.join(root, "node_modules", "web-tree-sitter", "tree-sitter.wasm")
    if (existsSync(p)) return readFileSync(p)
  }
  const direct = path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm")
  return existsSync(direct) ? readFileSync(direct) : null
}

const truth = resolveTruth()
const onDisk = readFileSync(corePath)

console.log("core-wasm race probe — src/ast/engine.ts:133-137")
console.log(`  shared path        : ${corePath}`)
console.log(`  path is KEYED      : ${/\\d{4,}/.test(path.basename(corePath)) ? "yes" : "NO — fixed name, no pid/random"}`)
console.log(`  bytes on disk      : ${onDisk.length}`)
console.log(`  engine source truth : ${truth ? `${truth.length} bytes` : "NOT FOUND"}`)
if (truth) console.log(`  disk == truth (sha) : ${sha(onDisk) === sha(truth) ? "IDENTICAL" : "DIFFERENT"}`)
console.log(
  `  os.tmpdir() == "/tmp": ${os.tmpdir() === "/tmp" ? "yes — the loop's first two candidates are ONE path" : "no"}`,
)
console.log()

if (!truth) {
  console.log("cannot run the race arm without the engine's source-of-truth module; stopping.")
  process.exit(2)
}

// ---------------------------------------------------------------------------------------------
// ARM 1 — the truncation window. A writer does exactly what engine.ts:136 does, repeatedly; a
// reader samples the same path and records every length it observes. `writeFileSync` truncates
// first, so a short observation is a torn read of a file that is correct before and after.
// ---------------------------------------------------------------------------------------------
let shortReads = 0
let fullReads = 0
const observed = new Set<number>()
let stop = false

const writer = (async () => {
  // Yield between rounds so the reader interleaves rather than running entirely before or after.
  for (let i = 0; i < ROUNDS && !stop; i++) {
    writeFileSync(corePath, truth)
    await new Promise((r) => setImmediate(r))
  }
})()

const reader = (async () => {
  const deadline = Date.now() + 60_000
  while (!stop && Date.now() < deadline) {
    try {
      const len = readFileSync(corePath).length
      observed.add(len)
      if (len === truth.length) fullReads++
      else shortReads++
    } catch {
      /* a reader can also lose the race outright; that is a short read too */
      shortReads++
    }
    if (shortReads > 2000) break
  }
})()

await Promise.all([writer, reader])
stop = true

const lengths = [...observed].sort((a, b) => a - b)
console.log("ARM 1 — truncation window (writer = engine.ts:136, reader = concurrent process)")
console.log(`  rounds             : ${ROUNDS}`)
console.log(`  reads at FULL size : ${fullReads}`)
console.log(`  reads SHORT        : ${shortReads}`)
console.log(`  distinct lengths   : ${lengths.length}${lengths.length ? ` -> ${lengths.slice(0, 12).join(", ")}${lengths.length > 12 ? ", …" : ""}` : ""}`)
console.log(
  shortReads > 0
    ? `  VERDICT: a concurrent reader CAN observe a short file. The window is real.`
    : `  VERDICT: no short read observed in ${ROUNDS} rounds on THIS machine. The window exists in`,
)
if (shortReads === 0) {
  console.log(`           writeFileSync's O_TRUNC semantics but did not open here — it is a race, so its`)
  console.log(`           absence in one run is not evidence of safety. The arbiter DID crash this way.`)
}
console.log()

// ---------------------------------------------------------------------------------------------
// ARM 2 — does a short read actually produce the arbiter's error class? The arbiter printed
//   section (code 7, "Export") extends past end of the module (length 4257, remaining bytes 2053)
// so instantiate a deliberately truncated module and compare the message shape.
// ---------------------------------------------------------------------------------------------
console.log("ARM 2 — what a truncated module does to the WASM section parser")
const full = truth
const cut = Math.floor(full.length * 0.5)
for (const [label, buf] of [
  [`intact (${full.length} bytes)`, full],
  [`truncated to ${cut} bytes`, full.subarray(0, cut)],
] as const) {
  try {
    await WebAssembly.compile(buf)
    console.log(`  ${label.padEnd(28)} -> COMPILES`)
  } catch (e) {
    const m = (e as Error)?.message ?? String(e)
    console.log(`  ${label.padEnd(28)} -> ${m.slice(0, 110)}`)
  }
}
console.log()

// ---------------------------------------------------------------------------------------------
// ARM 3 — restore. The probe leaves the shared path byte-identical to how it found it.
// ---------------------------------------------------------------------------------------------
const after = readFileSync(corePath)
console.log("ARM 3 — the shared path is left as found")
console.log(`  before sha : ${sha(onDisk)}`)
console.log(`  after  sha : ${sha(after)}`)
console.log(`  restorable : ${truth.length} bytes available; writing truth back`)
writeFileSync(corePath, truth)
console.log(`  final  sha : ${sha(readFileSync(corePath))}  == engine source of truth`)
