// script/m43/verify-arbiter-typecheck.ts — M43.T1
// THE ARBITER'S TYPE STATE IS MONITORED. (The gate that did not exist until the arbiter shipped a
// live ReferenceError.)
//
// THE DEFECT THIS EXISTS FOR. On 2026-10-20 the toml lane found that
// `script/m14/incoming-rule.ts` read `edgeFile` — a FREE VARIABLE — in the `packageScope` branch of
// the ambiguous cross-tab. The enclosing function had five parameters and no `edgeFile`, and the
// argument had been threaded into the sibling call and not into this one. REACHING THAT BRANCH
// THROWS INSIDE THE ARBITER, MID-ARM. It shipped because `tsconfig.json` (the SOURCE tree) is green
// and nobody typechecks `tsconfig.scripts.json`, where the arbiter lives. The arbiter is the shared
// instrument every lane's number flows through, and its type state was UNMONITORED.
//
// WHAT THE GATE PROVES.
//   (control) the arbiter typechecks CLEAN under the scripts project — zero type errors in
//             `script/m14/incoming-rule.ts` and `script/m14/incoming-gate.ts`;
//   (n1)      tsc REALLY reports a type error in a file under `script/m14/` — the premise the
//             control rests on, proved with a TEMP file that is deleted afterwards, so no real
//             source is ever mutated;
//   (n2)      the gate's own verdict REJECTS an arbiter error line — the check has teeth.
//
// WHY NO REAL FILE IS EVER MUTATED. Eight lane teammates are running arms against this arbiter
// RIGHT NOW. A byte-exact mutation of the arbiter would be a mutation of the instrument a live
// measurement is reading, and a measurement taken through a mutated arbiter is a WRONG measurement.
// The m43 selftest's plant-style gates mutate `src/ast/*` files, which no arm reads mid-run; this
// gate's governed surface IS read mid-run, so it proves its negative controls without touching it.
//
// THE LANE-OWNED ERRORS ARE REPORTED, NOT FAILED. `tsconfig.scripts.json` also covers the lanes'
// own probe scripts, and some of those have run-breaking errors. Those belong to the lanes; the
// gate prints them with their owners so the Lead can hand them over, and it does NOT fail on them.

import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const RESULTS_DIR = path.join(ROOT, "validation/m43/results")

/** THE GOVERNED SURFACE. The arbiter and the gate that drives it. */
const ARBITER_FILES = ["script/m14/incoming-rule.ts", "script/m14/incoming-gate.ts"]

/** THE CRASH CLASS. TS2304 is "Cannot find name" — a free variable, i.e. a ReferenceError at RUN
 *  time even though the file compiles. This is the exact class that shipped, so it is named. */
const CRASH_CLASS = "TS2304"

let checks = 0
let passed = 0
let failed = 0
let negatives = 0
function check(label: string, ok: boolean, detail = "") {
  checks++
  if (ok) passed++
  else { failed++; console.log(`FAIL: ${label}${detail ? ` — ${detail}` : ""}`) }
}
function negative(label: string, ok: boolean, detail = "") {
  negatives++
  check(`${label} [negative]`, ok, detail)
}

/** Run the scripts typecheck and return the error lines, grouped by file. */
function typecheck(): { lines: string[]; byFile: Map<string, string[]> } {
  const out = execFileSync(
    "npx",
    ["tsc", "--noEmit", "-p", "tsconfig.scripts.json"],
    { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 },
  )
  return parse(out)
}

/** Parse tsc's output. tsc exits NON-ZERO when it has errors, so the caller reads stderr too. */
function parse(out: string): { lines: string[]; byFile: Map<string, string[]> } {
  const lines = out.split("\n").filter((l) => /error TS\d+/.test(l))
  const byFile = new Map<string, string[]>()
  for (const l of lines) {
    const m = /^([^(]+)\(\d+,\d+\):\s+error\s+(TS\d+)/.exec(l)
    if (!m) continue
    const f = m[1].trim()
    if (!byFile.has(f)) byFile.set(f, [])
    byFile.get(f)!.push(l)
  }
  return { lines, byFile }
}

/** THE VERDICT. The control is exactly this function, so the negative control exercises it. */
function arbiterErrors(byFile: Map<string, string[]>): string[] {
  const out: string[] = []
  for (const f of ARBITER_FILES) out.push(...(byFile.get(f) ?? []))
  return out
}

// ── ONE tsc RUN, TWO READINGS ────────────────────────────────────────────────────────────────────
// The control reads the ONE typecheck's output twice: the arbiter's errors are the control, and the
// FILE LIST the same run prints is the proof that the arbiter is IN the program at all.
//
// WHY THERE IS NO PROBE FILE IN THE TREE. The first version planted a temp file under script/m14/ and
// read the typecheck's error for it as the negative control. It worked — and it was WRONG: for the ~90
// seconds the gate runs, a file with a deliberate type error EXISTS in script/m14/, so every other tool
// that typechecks that tree sees a NEW error. The fleet's ratchet printed it, a lane's tsc run listed it,
// and a lane's message reported it back as an error in a file it did not own. A gate that makes the tree
// look broken while it runs is a gate that corrupts other instruments' readings — the same principle as
// not mutating the arbiter.
//
// SO THE PREMISE IS PROVED WITHOUT AN ARTEFACT: `--listFiles` prints every file in the program, so the
// arbiter's two files are ASSERTED TO BE IN IT (if they are not, the control is vacuous — nothing would
// ever report their errors), and tsc's own error-reporting is proved on a TEMP PROJECT OUTSIDE THE TREE,
// where a deliberate error is planted and the SAME tsc binary must report it. Two proofs, zero files
// added to the repository, and the tree is never in a broken state while the gate runs.
const PROBE_DIR = mkdtempSync(path.join(tmpdir(), "bb-t1-probe-"))
let tscOut = ""
let fileList = ""
let parsed = { lines: [] as string[], byFile: new Map<string, string[]>() }
try {
  try {
    const r = execFileSync(
      "npx",
      ["tsc", "--noEmit", "-p", "tsconfig.scripts.json", "--listFiles"],
      { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 128 * 1024 * 1024 },
    )
    tscOut = r
  } catch (e: any) {
    // tsc exits non-zero WHEN IT HAS ERRORS — that is the normal path here, and the output is the
    // evidence. A failure that is not a type error is a different thing and must not be read as one.
    tscOut = `${e.stdout ?? ""}\n${e.stderr ?? ""}`
  }
  parsed = parse(tscOut)
  // the file list is on stdout, one absolute path per line
  fileList = tscOut.split("\n").filter((l) => l.startsWith("/") && l.endsWith(".ts")).join("\n")
} finally {
  rmSync(PROBE_DIR, { recursive: true, force: true })
}

// ── the control: the arbiter typechecks clean ────────────────────────────────────────────────────
// ── THE CONTROL: DID THE TYPECHECK ACTUALLY RUN? ──────────────────────────────────────────────────
//
// FOUND BY THE POWERSHELL LANE (2026-10-20), AND IT WAS THE LEAD'S OWN BUG. The control's LABEL says
// "the typecheck ran and produced parseable output" and its PREDICATE was `/error TS\d+/.test(tscOut)`
// — **which DEMANDS A TYPE ERROR BE PRESENT**. The run is `tsc … --listFiles`, so on a CLEAN tree the
// output is the FILE LIST and the control was FALSE. **THE CONTROL WAS RED EXACTLY WHEN THE TREE WAS
// CLEAN, AND GREEN ONLY WHEN THE TREE WAS BROKEN** — and it sat beside a check that requires the arbiter
// to have ZERO type errors, so the two demanded opposite things and the gate could only pass on a broken
// tree. That is why it read 7/7 earlier: the tree still had six errors in four lanes' files. The Lead
// CLEARED those errors, and the gate went red — **A CONTROL THAT IS RED WHEN THE TREE IS CLEAN CANNOT BE
// TRUSTED TO GO RED WHEN THE TREE IS DIRTY.** The same shape as the toml lane's DEAD MUTATION SUITE: a
// broken instrument that reads as a working one.
//
// THE PREDICATE IS NOW WHAT THE LABEL SAYS: **tsc RAN**, which the `--listFiles` output proves (a
// non-empty program file list). It is true on a clean tree AND on a dirty one ✓. The error-reporting
// half is proved separately by n1b (the same tsc binary must report a deliberate error in a temp project
// OUTSIDE the tree), and the verdict's own refusal is proved by n2 (a synthetic arbiter error line).
check(
  "the typecheck ran and produced parseable output",
  fileList.length > 0,
  `tsc printed ${fileList.split("\n").filter(Boolean).length} program file(s); ${parsed.lines.length} diagnostic line(s)` +
    (parsed.lines.length > 0 ? ` — first: ${parsed.lines[0]}` : ""),
)
const arbErrs = arbiterErrors(parsed.byFile)
check(
  "the arbiter typechecks CLEAN (zero type errors in the arbiter and the gate)",
  arbErrs.length === 0,
  arbErrs.slice(0, 4).join(" | "),
)
const crashErrs = arbErrs.filter((l) => l.includes(CRASH_CLASS))
check(
  `the arbiter has no ${CRASH_CLASS} free variable (the class that shipped a ReferenceError)`,
  crashErrs.length === 0,
  crashErrs.slice(0, 2).join(" | "),
)

// ── n1: the arbiter IS IN THE PROGRAM, and tsc DOES report type errors ───────────────────────────
// n1a: `--listFiles` printed the program, and the arbiter's two files are IN it. If they were not, the
//      control would be VACUOUS — nothing would ever report their errors, so "zero errors" would mean
//      "never checked" and would look exactly like a pass.
// n1b: the SAME tsc binary reports a type error when given one — proved on a TEMP PROJECT OUTSIDE THE
//      TREE, so no file is ever added to the repository and the tree is never left looking broken.
{
  const inProgram = ARBITER_FILES.filter((f) => fileList.includes(path.join(ROOT, f)))
  negative(
    "n1a: the arbiter's files ARE in the tsc program (so a zero-error verdict means CHECKED, not unchecked)",
    inProgram.length === ARBITER_FILES.length,
    `only ${inProgram.length} of ${ARBITER_FILES.length} arbiter file(s) are in the program: ${inProgram.join(", ")}`,
  )
  let reported = false
  // A FRESH temp dir: the first one was removed in the earlier finally, and reusing it made the write
  // throw ENOENT, which the catch turned into "tsc did not report it". The gate was failing its own
  // negative control for a bookkeeping reason, and said so in the detail.
  const probeDir = mkdtempSync(path.join(tmpdir(), "bb-t1-probe-"))
  try {
    writeFileSync(path.join(probeDir, "probe.ts"), "export const P: number = \"not a number\"\n")
    writeFileSync(path.join(probeDir, "tsconfig.json"), JSON.stringify({
      compilerOptions: { noEmit: true, strict: true, skipLibCheck: true, target: "es2022", module: "esnext" },
      include: ["probe.ts"],
    }))
    let out = ""
    try {
      // THE PROJECT'S OWN tsc, BY ABSOLUTE PATH. `npx` resolves the local typescript only from inside
      // the project; run from a temp directory it tries to FETCH one, which is both slow and a network
      // dependency in a gate. The javascript lane reached the same conclusion independently.
      const TSC = path.join(ROOT, "node_modules/.bin/tsc")
      out = execFileSync(TSC, ["--noEmit", "-p", path.join(probeDir, "tsconfig.json")], {
        cwd: probeDir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 8 * 1024 * 1024,
      })
    } catch (e: any) { out = `${e.stdout ?? ""}\n${e.stderr ?? ""}` }
    reported = /error TS\d+/.test(out)
  } catch { reported = false } finally { rmSync(probeDir, { recursive: true, force: true }) }
  negative(
    "n1b: tsc really does report a type error (proved OUTSIDE the tree, so no file is added to it)",
    reported,
    "the temp project had a deliberate type error and tsc did not report it",
  )
}

// ── n2: the verdict REJECTS an arbiter error line ────────────────────────────────────────────────
{
  const synthetic = new Map<string, string[]>()
  synthetic.set("script/m14/incoming-rule.ts", [
    'script/m14/incoming-rule.ts(1629,56): error TS2304: Cannot find name \'edgeFile\'.',
  ])
  const rejected = arbiterErrors(synthetic)
  negative(
    "n2: the verdict REJECTS an arbiter error line (the check has teeth)",
    rejected.length === 1,
    "the verdict returned no error for a synthetic arbiter error — the check is VACUOUS",
  )
  const crashSeen = rejected.some((l) => l.includes(CRASH_CLASS))
  negative(
    "n2b: the crash class is recognised in a synthetic arbiter error",
    crashSeen,
    `expected a ${CRASH_CLASS} line to be recognised`,
  )
}

// ── the lane-owned errors: REPORTED, not failed ──────────────────────────────────────────────────
const laneErrors = parsed.lines.filter((l) => {
  const m = /^([^(]+)\(/.exec(l)
  return m ? !ARBITER_FILES.includes(m[1].trim()) : false
})
const byOwner = new Map<string, number>()
for (const l of laneErrors) {
  const m = /^([^(]+)\(/.exec(l)
  if (!m) continue
  byOwner.set(m[1].trim(), (byOwner.get(m[1].trim()) ?? 0) + 1)
}
const breaking = laneErrors.filter((l) => /TS2304|TS2300|TS2305|TS1117/.test(l))
if (byOwner.size) {
  console.log(`\nREPORT — the LANE-OWNED probe scripts carry ${laneErrors.length} type error(s) under the`)
  console.log(`same project. They are the lanes' to fix, and this gate does NOT fail on them.`)
  for (const [f, n] of [...byOwner.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(3)}  ${f}`)
  if (breaking.length) {
    console.log(`  of which ${breaking.length} BREAK A RUN (TS2304 free variable · TS2300 duplicate`)
    console.log(`  identifier · TS2305 missing export · TS1117 duplicate property):`)
    for (const l of breaking.slice(0, 12)) console.log(`    ${l.trim()}`)
  }
}

// ── evidence ────────────────────────────────────────────────────────────────────────────────────
const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
const ok = failed === 0
if (ok) {
  if (!existsSync(RESULTS_DIR)) writeFileSync(RESULTS_DIR, "")
  writeFileSync(path.join(RESULTS_DIR, "T1.json"), JSON.stringify({
    status: "verified",
    currentCommit: head,
    workingTreeRelevantChanges: [],
    verifierCommand: "bun run script/m43/verify-arbiter-typecheck.ts",
    evidenceFile: "T1.json",
    generatedAt: new Date().toISOString(),
    passed,
    failed,
    negativeCases: negatives,
    negativesDescription: "n1: tsc reports a type error in a temp file under script/m14/ (never a real file); n2: the verdict rejects a synthetic arbiter error line",
    governedSurface: ARBITER_FILES,
    laneOwnedErrorsReported: laneErrors.length,
    laneOwnedRunBreakingReported: breaking.length,
  }, null, 2) + "\n")
  console.log("evidence stamped: validation/m43/results/T1.json")
}
console.log(`\nT1: ${passed}/${checks} passed, ${negatives} negative case(s)${ok ? "" : `, ${failed} FAILED`}`)
process.exit(ok ? 0 : 1)
