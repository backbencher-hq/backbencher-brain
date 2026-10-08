// script/m14/verify-script-typecheck-baseline.ts — the ratchet under `typecheck:scripts`.
//
// WHY THIS EXISTS. `tsconfig.json` includes `src/**/*.ts` only, so CI's
// `npx tsc --noEmit` has never typechecked one file under `script/`. The scripts are
// owned by several lanes, they are compiled only by Bun's transpiler (which does not
// check), and nothing has ever failed when the error count grew. Measured on
// 2026-10-07: 716 errors in `script/m12/**` + `script/m14/**`, accumulated unseen.
// A sweep took that to 180 over three commits (7a4dea86f 716->262, 28ec610eb
// 262->192, e74884299 192->180). This gate exists so the number cannot climb back
// while the remaining 180 are worked down.
//
// WHAT IT CLAIMS, EXACTLY. That no file's error count is HIGHER than the recorded
// baseline. It does NOT claim the scripts typecheck: a PASS here prints the declared
// total and says so in as many words, because a gate that lets "no regressions" read
// as "clean" is how the 716 accumulated in the first place.
//
// WHO DECIDES. The baseline is the declared state; `--update-baseline` moves it, and
// it REFUSES to move UP unless `--allow-increase <reason>` carries a written reason
// that is recorded in the file (contract §3: an unexplained number is a claim on
// trust). So the ratchet is monotone by construction and an increase is a decision
// with a name attached, not an accident.
//
// EVERYTHING IS READ FROM THE COMMAND THAT ALREADY EXISTS. The gate runs the exact
// argv of `package.json`'s `typecheck:scripts`, so there is ONE definition of what
// "the script typecheck" means; a second, hand-copied flag list here would drift, and
// a gate whose scope differs from the command it is guarding reports a finding about
// the wrong thing. If that field is removed or stops looking like a tsc invocation,
// this gate fails loudly rather than checking something else in silence.
//
// THE COMPILER IS RESOLVED BY ABSOLUTE PATH, NEVER VIA `npx`, for the reason
// script/m60/verify-script-typecheck.ts records: `npx tsc` can resolve the unrelated
// `tsc` package (prints "This is not the tsc command you are looking for", exits 0),
// and a missing node_modules fails to launch at all. Both produce zero errors, and
// zero errors is the reading this gate must never invent.
//
// Usage:
//   bun run script/m14/verify-script-typecheck-baseline.ts                 # the gate
//   bun run script/m14/verify-script-typecheck-baseline.ts --selftest      # prove it can fail
//   bun run script/m14/verify-script-typecheck-baseline.ts --update-baseline [--note "..."]
//   bun run script/m14/verify-script-typecheck-baseline.ts --update-baseline --allow-increase "why"
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? path.dirname(process.argv[1] ?? "."), "..", "..")
const BASELINE_PATH = path.join(ROOT, "validation", "m14", "script-typecheck-baseline.json")

/** A canary carrying ONE deliberate semantic error, written for the duration of the
 *  compile and deleted in a `finally`.
 *
 *  WHY IT IS NEEDED. This gate's whole subject is a COUNT, and a program with no
 *  diagnostics and a compiler that never launched produce identical output — nothing.
 *  The gate already refused an empty run for that reason, and the refusal made the one
 *  reading it cannot verify (zero) unreportable: a sweep that fixed the last error could
 *  not lock the gain in. The canary resolves it the way `script/m60/verify-script-surface.ts`
 *  resolves it for the same reason — its own TS2322 has to come back, which proves
 *  DIAGNOSTICS are being reported, and then it is subtracted before anything is compared.
 *
 *  It lives DIRECTLY under `script/m14/` because the program's include glob matches every
 *  TypeScript file below that directory and `script/m14/tmp` is EXCLUDED: a canary under
 *  `tmp/` would be in no program and would prove nothing (m60's gate records the same
 *  measurement). */
const CANARY_REL = "script/m14/__typecheck-ratchet-canary.ts"
const CANARY_SOURCE = [
  "// Written for the duration of one typecheck by script/m14/verify-script-typecheck-baseline.ts,",
  "// then deleted. Its single deliberate TS2322 is this gate's proof that SEMANTIC diagnostics",
  "// came back at all — without it a clean run and a compiler that never started look the same.",
  'export const __typecheckRatchetCanary: number = "deliberate type error"',
  "",
].join("\n")
// NO evidence artifact is written into validation/m14/results/ by this gate, on purpose.
// That directory is the M14 evidence battery, and script/m49/verify-evidence-identity.ts
// maps every artifact in it to a producer; a new artifact emitted here would appear to
// that gate as an artifact whose producer it does not know. The baseline is a declaration
// (validation/m14/fixture-baseline.json is the precedent), and the gate's verdict is its
// exit status plus what it prints.

interface Baseline {
  schemaVersion: number
  gate: string
  command: string
  /** The total the baseline declares. Kept beside byFile so a reader can see both the
   *  size of the tail and where it lives without adding up 60 numbers. */
  declaredTotal: number
  byFile: Record<string, number>
  measuredAt: string
  measuredAtCommit: string
  updateHistory: Array<{ at: string; commit: string; total: number; note?: string; increaseJustification?: string }>
}

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim()
}

/** The argv `typecheck:scripts` runs, split exactly as npm would split it. */
function scriptTypecheckArgv(): string[] {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as { scripts?: Record<string, string> }
  const line = pkg.scripts?.["typecheck:scripts"]
  if (!line) fail(["package.json has no `typecheck:scripts` script — this gate cannot know what to run, and guessing is worse than refusing"])
  const argv = line!.split(/\s+/).filter(Boolean)
  if (argv[0] !== "tsc") fail([`\`typecheck:scripts\` no longer starts with \`tsc\` (it is: ${line}) — this gate refuses to run something it has not been told how to read`])
  return argv.slice(1)
}

function fail(lines: string[]): never {
  for (const l of lines) console.error(l)
  process.exit(2)
}

/** Absolute path to the compiler, or a refusal. Never `npx`. */
function compiler(): string {
  for (const candidate of ["typescript/bin/tsc", ".bin/tsc"]) {
    const p = path.join(ROOT, "node_modules", candidate)
    if (existsSync(p)) return p
  }
  return fail([
    "script typecheck ratchet: REFUSING to report — no TypeScript compiler found.",
    "  looked in: node_modules/typescript/bin/tsc and node_modules/.bin/tsc",
    "  (a missing compiler produces zero errors, and zero errors is the one reading this gate must not invent)",
  ])
}

interface Counts {
  total: number
  byFile: Map<string, number>
  messages: Map<string, string[]>
}

function measure(): Counts {
  const argv = scriptTypecheckArgv()
  const canaryPath = path.join(ROOT, CANARY_REL)
  let text = ""
  writeFileSync(canaryPath, CANARY_SOURCE)
  try {
    try {
      text = execFileSync(process.execPath, [compiler(), ...argv], { cwd: ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, timeout: 900_000, stdio: ["ignore", "pipe", "pipe"] })
    } catch (e: any) {
      text = String(e?.stdout ?? "") + String(e?.stderr ?? "")
    }
  } finally {
    rmSync(canaryPath, { force: true })
  }
  const byFile = new Map<string, number>()
  const messages = new Map<string, string[]>()
  for (const raw of text.split("\n")) {
    const m = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/.exec(raw.trim())
    if (!m) continue
    const file = path.relative(ROOT, m[1]).split(path.sep).join("/")
    byFile.set(file, (byFile.get(file) ?? 0) + 1)
    const list = messages.get(file) ?? []
    if (list.length < 8) list.push(`${m[4]}:${m[2]} ${m[5]}`)
    messages.set(file, list)
  }
  const canaryErrors = byFile.get(CANARY_REL) ?? 0
  byFile.delete(CANARY_REL)
  messages.delete(CANARY_REL)
  if (canaryErrors === 0) {
    fail([
      "script typecheck ratchet: REFUSING to report — the canary's own error did not come back.",
      `  ran: ${process.execPath} ${compiler()} ${argv.join(" ")}`,
      `  ${CANARY_REL} carries one deliberate TS2322 and the run reported ${canaryErrors} of it`,
      "  (a run that cannot report the canary cannot report a ZERO either: zero errors is the one reading this gate must never invent)",
    ])
  }
  return { total: [...byFile.values()].reduce((a, b) => a + b, 0), byFile, messages }
}

interface Comparison {
  regressed: Array<{ file: string; from: number; to: number }>
  resolved: Array<{ file: string; from: number; to: number }>
  totalDelta: number
}

/** Pure, so `--selftest` can prove it fails on an increase without touching a source file. */
export function compare(current: Map<string, number>, baseline: Record<string, number>): Comparison {
  const regressed: Comparison["regressed"] = []
  const resolved: Comparison["resolved"] = []
  for (const [file, to] of current) {
    const from = baseline[file] ?? 0
    if (to > from) regressed.push({ file, from, to })
  }
  for (const [file, from] of Object.entries(baseline)) {
    const to = current.get(file) ?? 0
    if (to < from) resolved.push({ file, from, to })
  }
  const total = (m: Map<string, number> | Record<string, number>) => [...(m instanceof Map ? m.values() : Object.values(m))].reduce((a, b) => a + b, 0)
  return { regressed, resolved, totalDelta: total(current) - total(baseline) }
}

function readBaseline(): Baseline | null {
  if (!existsSync(BASELINE_PATH)) return null
  return JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as Baseline
}

function selftest(): boolean {
  const cases: Array<[string, Counts["byFile"], Record<string, number>, boolean]> = [
    ["equal counts pass", new Map([["a.ts", 2]]), { "a.ts": 2 }, true],
    ["a decrease passes", new Map([["a.ts", 1]]), { "a.ts": 2 }, true],
    ["an increase FAILS", new Map([["a.ts", 3]]), { "a.ts": 2 }, false],
    ["a NEW file with errors FAILS", new Map([["a.ts", 2], ["new.ts", 1]]), { "a.ts": 2 }, false],
    ["a resolved file passes", new Map([["a.ts", 2]]), { "a.ts": 2, "b.ts": 4 }, true],
    ["an empty baseline fails on any error", new Map([["a.ts", 1]]), {}, false],
  ]
  let ok = true
  for (const [name, current, baseline, expectPass] of cases) {
    const r = compare(current, baseline)
    const passes = r.regressed.length === 0
    const good = passes === expectPass
    ok &&= good
    console.log(`${good ? "PASS" : "FAIL"}  selftest: ${name}  (regressed: ${r.regressed.map((x) => x.file).join(", ") || "none"})`)
  }
  return ok
}

function main(): void {
  if (process.argv.includes("--selftest")) process.exit(selftest() ? 0 : 2)

  const update = process.argv.includes("--update-baseline")
  const noteIdx = process.argv.indexOf("--note")
  const note = noteIdx >= 0 ? process.argv[noteIdx + 1] : undefined
  const incIdx = process.argv.indexOf("--allow-increase")
  const justification = incIdx >= 0 ? process.argv[incIdx + 1] : undefined
  const baseline = readBaseline()
  const current = measure()

  console.log(`script typecheck ratchet — command: ${baseline?.command ?? "tsc " + scriptTypecheckArgv().join(" ")}`)
  console.log(`  files with errors: ${current.byFile.size}   errors now: ${current.total}   baseline declares: ${baseline ? baseline.declaredTotal : "(none yet)"}`)

  if (update) {
    if (!baseline) {
      writeBaseline(current, null, note, undefined)
      console.log(`baseline created: ${path.relative(ROOT, BASELINE_PATH)} declares ${current.total} error(s) in ${current.byFile.size} file(s)`)
      process.exit(0)
    }
    if (current.total > baseline.declaredTotal) {
      if (!justification) {
        fail([
          `REFUSING to move the ratchet UP: ${baseline.declaredTotal} -> ${current.total}.`,
          "  The baseline is a floor: a decrease may be recorded, an increase needs a reason.",
          '  Re-run with --allow-increase "<why>" and the reason is written into the file.',
        ])
      }
    }
    writeBaseline(current, baseline, note, justification)
    console.log(`baseline updated: ${baseline.declaredTotal} -> ${current.total}${justification ? ` (increase allowed: ${justification})` : ""}`)
    process.exit(0)
  }

  if (!baseline) {
    fail([
      `no baseline at ${path.relative(ROOT, BASELINE_PATH)}`,
      `  errors now: ${current.total} in ${current.byFile.size} file(s)`,
      "  seed it with: bun run script/m14/verify-script-typecheck-baseline.ts --update-baseline",
    ])
  }

  const r = compare(current.byFile, baseline!.byFile)
  const scope = `declared ${baseline!.declaredTotal} in ${Object.keys(baseline!.byFile).length} file(s)`

  if (r.regressed.length) {
    console.error(`\nFAIL — ${r.regressed.length} file(s) have MORE type errors than declared (${scope}):`)
    for (const g of r.regressed.sort((a, b) => b.to - b.from - (a.to - a.from))) {
      console.error(`  ${g.file}  ${g.from} -> ${g.to}`)
      for (const msg of current.messages.get(g.file) ?? []) console.error(`      ${msg.slice(0, 150)}`)
    }
    console.error("\n  A new error is a regression: fix it, or move the baseline with a written reason.")
    process.exit(2)
  }

  console.log(
    current.total === 0
      // The message has to change with the reading, or the gate would go on disclaiming a
      // claim it is no longer making: with the canary in place a zero is a MEASUREMENT.
      ? "PASS — no file's error count rose, and the surface is at ZERO errors: the canary proved diagnostics were reported, so the zero is a reading and not an absence of output."
      : `PASS — no file's error count rose. This is NOT a claim that the scripts typecheck: ${current.total} error(s) are DECLARED in the baseline and still there.`,
  )
  if (r.totalDelta < 0) console.log(`  ${-r.totalDelta} error(s) fewer than declared — lock the gain in with --update-baseline`)
  if (r.resolved.length) console.log(`  resolved/gone: ${r.resolved.map((x) => `${x.file} ${x.from}->${x.to}`).join(", ")}`)
  process.exit(0)
}

function writeBaseline(current: Counts, previous: Baseline | null, note: string | undefined, increaseJustification: string | undefined): void {
  const byFile = Object.fromEntries([...current.byFile.entries()].sort(([a], [b]) => (a < b ? -1 : 1)))
  const history = previous?.updateHistory ?? []
  history.push({ at: new Date().toISOString(), commit: git(["rev-parse", "HEAD"]), total: current.total, ...(note ? { note } : {}), ...(increaseJustification ? { increaseJustification } : {}) })
  const next: Baseline = {
    schemaVersion: 1,
    gate: "m14-script-typecheck-baseline",
    command: previous?.command ?? "tsc " + scriptTypecheckArgv().join(" "),
    declaredTotal: current.total,
    byFile,
    measuredAt: new Date().toISOString(),
    measuredAtCommit: git(["rev-parse", "HEAD"]),
    updateHistory: history,
  }
  writeFileSync(BASELINE_PATH, JSON.stringify(next, null, 2) + "\n")
}

main()
