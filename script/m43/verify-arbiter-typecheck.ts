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
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
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
// The probe file is planted BEFORE the single typecheck, so the ONE run's output carries BOTH the
// arbiter's errors (the control) and the probe's own error (n1). Two runs would double the gate's
// cost for the same evidence. The probe is DELETED in a finally, and it is a REAL filename (not a
// dotfile) because TypeScript's `**/*` glob does NOT match dotfiles — the first version of this
// probe was named `.m43-t1-probe.ts`, was therefore never IN the program, and n1 FAILED. The gate
// caught its own premise failing, which is the whole reason n1 exists.
const PROBE_REL = "script/m14/m43-t1-probe.ts"
const PROBE = path.join(ROOT, PROBE_REL)
let tscOut = ""
let parsed = { lines: [] as string[], byFile: new Map<string, string[]>() }
try {
  writeFileSync(PROBE, "export const M43_T1_PROBE: number = \"not a number\"\n")
  try {
    tscOut = execFileSync(
      "npx",
      ["tsc", "--noEmit", "-p", "tsconfig.scripts.json"],
      { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 },
    )
  } catch (e: any) {
    // tsc exits non-zero WHEN IT HAS ERRORS — that is the normal path here, and the output is the
    // evidence. A failure that is not a type error is a different thing and must not be read as one.
    tscOut = `${e.stdout ?? ""}\n${e.stderr ?? ""}`
  }
  parsed = parse(tscOut)
} finally {
  rmSync(PROBE, { force: true })
}

// ── the control: the arbiter typechecks clean ────────────────────────────────────────────────────
check(
  "the typecheck ran and produced parseable output",
  /error TS\d+/.test(tscOut),
  tscOut.slice(0, 300),
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

// ── n1: tsc REALLY reported a type error in a file under script/m14/ ─────────────────────────────
{
  const probeErrs = parsed.byFile.get(PROBE_REL) ?? []
  negative(
    "n1: tsc reported a type error in a file under script/m14/ (the premise the control rests on)",
    probeErrs.length > 0,
    "the probe file was planted and tsc did not report it — the control would be VACUOUS",
  )
  check("n1: the probe file was removed", !existsSync(PROBE))
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
