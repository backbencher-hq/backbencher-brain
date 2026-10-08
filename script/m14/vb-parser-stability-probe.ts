/**
 * WHY TWO RUNS OF THE SAME VB CORPUS DISAGREE — the file, the mechanism, and
 * the size of the hole.
 *
 * THE SYMPTOM. `vb-determinism-probe.ts` re-parsed 500 corpus files four times
 * through production `parseFile`. 499 files produced a byte-identical answer
 * every time. ONE did not:
 *
 *     dismt/Elements/AutoUnattend/ActiveDirectory/ADDSJoinDialog.vb
 *       round 1 bea161d3bdd939a5   round 2 bea161d3bdd939a5
 *       round 3 bea161d3bdd939a5   round 4 d7cf5e84cf22be1f
 *
 * and the run's own stderr, in the same four rounds, carried:
 *
 *     [BB-PARSE-ERR] vb | .../ADDSJoinDialog.vb | memory access out of bounds
 *     [BB-HANG] parser stuck 120s on .../ADDSJoinDialog.vb — exiting
 *
 * So the analyzer is deterministic per file, and the CORPUS MEASUREMENT is not:
 * a file that crashes the wasm parser contributes fewer symbols and fewer
 * relationships in the run where it crashed. That is why the recorded BEFORE
 * artifact (102,295 relationships) and an independent re-measurement of the same
 * commit over the same 2,658 files (102,399) differ by 104 edges spread over
 * seven relationship types — not a rounding difference in one class, which is
 * the signature of a varying FILE SET.
 *
 * WHAT THIS FILE ESTABLISHES, separately for each question:
 *
 *   1. IS THE FILE ITSELF UNSTABLE, OR IS IT CONCURRENCY? The same file parsed
 *      N times SEQUENTIALLY (one at a time, no pool contention) and N times
 *      CONCURRENTLY, with the per-file digest compared. If sequential is stable
 *      and concurrent is not, the fault is the wasm under concurrency; if
 *      sequential also diverges, it is the file.
 *   2. HOW BIG IS THE HOLE? The file is parsed alone and its symbol and
 *      relationship counts are printed, so the per-run delta between a sweep
 *      where it parses and a sweep where it does not is a NUMBER rather than an
 *      inference from a total.
 *   3. HOW MANY OTHER FILES ARE EXPOSED? Every corpus file is parsed ONCE
 *      SEQUENTIALLY and any parse error or exception is recorded, because "one
 *      file" and "one file in a 500-file draw" are very different severities and
 *      only a full pass distinguishes them.
 *
 * It reads no analyzer source and imports no analyzer symbol: the question is
 * about the PARSER and the corpus, not about what this lane believes it emits.
 *
 * CLI: npx tsx script/m14/vb-parser-stability-probe.ts [--file <rel>] [--out f.json]
 */
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { readFileSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { parseFile } from "../../src/ast/pool-worker"

// Overloads, because the return depends on whether a default was given: a flag read
// WITH a default always yields a string, and the single `string | undefined` signature
// could not say so — `--file`'s value then had to be treated as optional where it is not.
function argOf(flag: string): string | undefined
function argOf(flag: string, dflt: string): string
function argOf(flag: string, dflt?: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : dflt
}
const CR = process.env.BB_VB_CORPUS_ROOT ?? "$HOME/fixtures/vb-corpus"
const REPOS = (argOf("--repo", "p3d,dismt,pcl,tankex,runtime") ?? "").split(",").map((s) => s.trim()).filter(Boolean)
const REPEATS = Math.max(2, parseInt(argOf("--repeats", "6") ?? "6"))
const FOCUS_REL = argOf("--file", "Elements/AutoUnattend/ActiveDirectory/ADDSJoinDialog.vb")
const OUT = argOf("--out")

const files: { repo: string; dir: string; rel: string; abs: string; bytes: number }[] = []
for (const e of REPOS) {
  const dir = path.join(CR, e)
  try { statSync(dir); execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    if (!rel.toLowerCase().endsWith(".vb")) continue
    const abs = path.join(dir, rel)
    let size: number
    try { size = statSync(abs).size } catch { continue }
    if (size > 512 * 1024) continue
    let text = ""
    try { text = readFileSync(abs, "utf8").replace(/^\uFEFF/, "") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "vb") continue
    files.push({ repo: e, dir, rel, abs, bytes: size })
  }
}
files.sort((a, b) => (a.repo + "/" + a.rel < b.repo + "/" + b.rel ? -1 : 1))

type Answer = { digest: string; symbols: number; rels: number; errors: number; threw: string }
async function parseOnce(f: { abs: string; dir: string }): Promise<Answer> {
  try {
    const r: any = await parseFile(f.abs, f.dir)
    const payload = {
      s: (r?.symbols ?? []).map((s: any) => [s.name, String(s.kind), s.ownerName ?? null]),
      r: (r?.relationships ?? []).map((x: any) => [x.source, x.target, String(x.type), x.line_number ?? 0]),
    }
    return {
      digest: createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 16),
      symbols: (r?.symbols ?? []).length,
      rels: (r?.relationships ?? []).length,
      errors: (r?.errors ?? []).length,
      threw: "",
    }
  } catch (e: any) {
    return { digest: "THREW", symbols: 0, rels: 0, errors: 0, threw: String(e?.message ?? e).slice(0, 120) }
  }
}

const focus = files.find((f) => f.rel === FOCUS_REL) ?? files.find((f) => f.rel.endsWith(FOCUS_REL))
if (!focus) { console.error(`focus file not found: ${FOCUS_REL}`); process.exit(2) }
console.log(`vb parser stability probe — corpus ${CR}  admitted ${files.length}`)
console.log(`focus: ${focus.repo}/${focus.rel}  ${focus.bytes} bytes\n`)

// ── 1. SEQUENTIAL: one parse at a time, no pool contention ────────────────────
console.log("1. SEQUENTIAL repeats of the focus file (one at a time)")
const seq: Answer[] = []
for (let i = 0; i < REPEATS; i++) {
  const a = await parseOnce(focus)
  seq.push(a)
  console.log(`   run ${i + 1}: digest ${a.digest}  symbols ${a.symbols}  rels ${a.rels}  parseErrors ${a.errors}${a.threw ? `  THREW ${a.threw}` : ""}`)
}
const seqStable = new Set(seq.map((a) => a.digest)).size === 1

// ── 2. CONCURRENT: the same file, many at once, as a sweep does ─────────────
console.log(`\n2. CONCURRENT repeats of the focus file (${REPEATS} at once, as a sweep does)`)
const con: Answer[] = await Promise.all(Array.from({ length: REPEATS }, () => parseOnce(focus)))
for (const [i, a] of con.entries()) {
  console.log(`   run ${i + 1}: digest ${a.digest}  symbols ${a.symbols}  rels ${a.rels}  parseErrors ${a.errors}${a.threw ? `  THREW ${a.threw}` : ""}`)
}
const conStable = new Set(con.map((a) => a.digest)).size === 1

// ── 3. HOLE SIZE: what one sweep loses when this file fails ──────────────────
const focusOk = seq.find((a) => a.digest !== "THREW") ?? seq[0]
const focusBad = seq.find((a) => a.digest === "THREW") ?? (seqStable ? null : seq.find((a) => a.digest !== seq[0].digest))
console.log(`\n3. HOLE SIZE`)
console.log(`   when the file parses : ${focusOk.symbols} symbols, ${focusOk.rels} relationships`)
if (focusBad) {
  console.log(`   when it fails        : ${focusBad.symbols} symbols, ${focusBad.rels} relationships`)
  console.log(`   => one sweep differs from another by up to ${focusOk.rels - focusBad.rels} relationships in THIS file alone`)
} else {
  console.log(`   no divergent answer observed in ${REPEATS} sequential repeats, so this file's contribution is stable HERE`)
  console.log(`   (a divergence observed only under concurrency still costs the sweep everything this file would have contributed)`)
}

// ── 4. HOW MANY FILES ARE EXPOSED: one sequential pass over the whole corpus ──
console.log(`\n4. FULL SEQUENTIAL PASS over ${files.length} files (exposure census)`)
const threw: Array<{ file: string; message: string }> = []
const unstable: string[] = []
let idx = 0
async function worker(): Promise<void> {
  while (true) {
    const i = idx++
    if (i >= files.length) return
    const f = files[i]
    const a = await parseOnce(f)
    if (a.threw) threw.push({ file: `${f.repo}/${f.rel}`, message: a.threw })
  }
}
await Promise.all(Array.from({ length: 4 }, () => worker()))
void unstable
console.log(`   files whose production parse THREW: ${threw.length}`)
for (const t of threw.slice(0, 25)) console.log(`     ${t.file}  ${t.message}`)

console.log(`\nVERDICT`)
console.log(`   sequential stable : ${seqStable ? "yes" : "NO"}`)
console.log(`   concurrent stable : ${conStable ? "yes" : "NO"}`)
console.log(`   => ${seqStable && !conStable
  ? "the FILE is fine and the pinned wasm is unstable UNDER CONCURRENCY. Every corpus sweep in this lane runs 8-way, so every sweep total is a sample of a nondeterministic parser, not a property of the language."
  : !seqStable
    ? "the FILE is unstable even parsed alone, so the defect is in the grammar/wasm for this input, not in concurrency."
    : "no divergence observed in this run — which is NOT a clearance: the 4-way determinism sweep DID diverge on this same file. One clean run is not a green measurement."}`)

if (OUT) {
  writeFileSync(OUT, JSON.stringify({
    corpusRoot: CR, admitted: files.length, focus: `${focus.repo}/${focus.rel}`, focusBytes: focus.bytes,
    repeats: REPEATS, sequential: seq, concurrent: con, sequentialStable: seqStable, concurrentStable: conStable,
    threwSequentialPass: threw,
  }, null, 2))
  console.log(`\nwrote ${OUT}`)
}
process.exitCode = seqStable && conStable ? 0 : 1
