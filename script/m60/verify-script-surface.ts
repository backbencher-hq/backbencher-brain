// M60 — the SCRIPT SURFACE gets a typecheck, and the typecheck gets a way to know it is blind.
//
// Why this exists (measured 2026-09-25, M60 oracle-sharpness wave). `tsconfig.json` includes only
// `src/**/*.ts`, so every `npx tsc --noEmit` this program has ever run never read a single script
// file: 790 script files (2,197 including scratch) were outside every typecheck claim made about
// them, including claims made in this wave. Compiled on purpose with `tsconfig.scripts.json`, the
// surface holds 973 type errors today — and the first glob run of it reported FOUR, all of them
// parse errors of one file, because of a second, nastier rule:
//
//   tsc reports SYNTACTIC diagnostics and then omits SEMANTIC diagnostics for the whole program
//   when any file in it fails to parse.
//
// Measured minimal pair (project options, replica at bac5d757):
//   files=[script/m14/differential.ts]                        -> 8 errors (its real ones)
//   files=[script/m14/differential.ts, <unparseable m29 file>] -> 3 errors, all m29's, the 8 gone
//   files=[script/m14/differential.ts, <a clean second root>]  -> 8 errors (so it is the parse
//                                                                 error, not the second root)
// One unparseable file therefore blinds a gate that cannot tell a blind run from a clean one. This
// gate can tell: it writes a canary file with ONE deliberate semantic error into the program it is
// about to compile, and refuses to publish any verdict if the canary's error does not come back.
// That is empirical — it does not need to know which diagnostic codes a parser refusal produces.
//
// The baseline is SHRINK-ONLY, like the M49.R2 regex register: the surface's existing errors are
// registered with the file that carries them, the gate fails on any new (file, code) — and a
// shrink is printed so the register can be re-frozen by hand (`--write-baseline`). Freezing 973
// errors is not a claim that they are acceptable; it is the only way to say out loud what the
// untyped layer actually costs while refusing to let it grow.
//
// Run: bun script/m60/verify-script-surface.ts [--selftest|--write-baseline|--report|--quiet]
import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { spawnSync } from "node:child_process"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..", "..")
const TSCONFIG = "tsconfig.scripts.json"
const BASELINE_REL = "validation/m60/script-surface-baseline.json"
/** A canary must be a name the config's script glob actually matches: a leading-dot file is NOT
 *  matched by that glob (measured 2026-09-25), and a file the program never reads proves nothing. */
const CANARY_REL = "script/m60/__script-surface-canary.ts"

const CANARY_SOURCE = [
  "// Written for the duration of one typecheck by script/m60/verify-script-surface.ts, then deleted.",
  "// Its single deliberate TS2322 is this instrument's proof that SEMANTIC diagnostics came back at",
  "// all — one file that fails to parse silences every semantic error in the program.",
  'export const __scriptSurfaceCanary: number = "deliberate type error"',
  "",
].join("\n")

export interface Diagnostic { file: string; line: number; col: number; code: string; text: string }

/** tsc's `--pretty false` output. Positional lines are diagnostics; a line that carries an error
 *  code WITHOUT a position is a configuration-level error none of the counts may absorb (the first
 *  attempt at this compilation produced 744 of those for one wrong option pair), so it is returned
 *  separately and refuses the run. Indented lines continue the previous message; the footer is
 *  tsc's own. */
export function parseDiagnostics(out: string): { diagnostics: Diagnostic[]; nonPositional: string[] } {
  const diagnostics: Diagnostic[] = []
  const nonPositional: string[] = []
  for (const raw of out.split("\n")) {
    const line = raw.replace(/\r$/, "").trimEnd()
    if (!line.trim()) continue
    const m = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/.exec(line)
    if (m) { diagnostics.push({ file: m[1].trim(), line: Number(m[2]), col: Number(m[3]), code: m[4], text: m[5] }); continue }
    if (line.startsWith(" ")) continue
    if (/^Found \d+ error/.test(line)) continue
    if (/\berror TS\d+\b/.test(line)) nonPositional.push(line.trim())
  }
  return { diagnostics, nonPositional }
}

/** Errors per file per code, with the canary's own deliberate error removed: it is this run's
 *  probe, not the surface's debt. */
export function census(diagnostics: Diagnostic[], canaryRel: string): Map<string, Map<string, number>> {
  const byFile = new Map<string, Map<string, number>>()
  for (const d of diagnostics) {
    if (d.file === canaryRel) continue
    const codes = byFile.get(d.file) ?? new Map<string, number>()
    codes.set(d.code, (codes.get(d.code) ?? 0) + 1)
    byFile.set(d.file, codes)
  }
  return byFile
}

export interface Comparison {
  newFiles: { file: string; total: number }[]
  growth: { file: string; code: string; was: number; now: number }[]
  shrink: { file: string; code: string; was: number; now: number }[]
  vanished: string[]
  before: number
  after: number
}

/** Shrink-only comparison. A file absent from the baseline whose errors appear is a NEW defect
 *  (that is the rule that makes the register worth having); a code whose count fell is a shrink and
 *  is reported so the baseline can be re-frozen deliberately. */
export function compare(current: Map<string, Map<string, number>>, baseline: Map<string, Map<string, number>>): Comparison {
  const newFiles: Comparison["newFiles"] = []
  const growth: Comparison["growth"] = []
  const shrink: Comparison["shrink"] = []
  const vanished: string[] = []
  const total = (m: Map<string, Map<string, number>>) => [...m.values()].reduce((a, c) => a + [...c.values()].reduce((x, y) => x + y, 0), 0)
  for (const [file, codes] of current) {
    if (!baseline.has(file)) { newFiles.push({ file, total: [...codes.values()].reduce((a, b) => a + b, 0) }); continue }
    const was = baseline.get(file)!
    for (const [code, now] of codes) {
      const before = was.get(code) ?? 0
      if (now > before) growth.push({ file, code, was: before, now })
      else if (now < before) shrink.push({ file, code, was: before, now })
    }
    for (const [code, before] of was) if (!codes.has(code)) shrink.push({ file, code, was: before, now: 0 })
  }
  for (const file of baseline.keys()) if (!current.has(file)) vanished.push(file)
  return { newFiles, growth, shrink, vanished, before: total(baseline), after: total(current) }
}

/** The compiler is resolved from THIS gate's tree, never from the evaluated root: a fixture
 *  program has no node_modules of its own, and the first selftest run of this gate proved that
 *  resolving it locally turns into `npx tsc` inside a temp directory — no compiler, no output, and
 *  a "blind" verdict that blames the fixture for the gate's own wiring. */
const TSC_BIN = path.join(ROOT, "node_modules", "typescript", "bin", "tsc")
function runTsc(root: string, configRel: string): { out: string; status: number | null; error: string | null } {
  const args = ["--noEmit", "-p", path.join(root, configRel), "--pretty", "false"]
  const cmd = fs.existsSync(TSC_BIN) ? process.execPath : "npx"
  const argv = fs.existsSync(TSC_BIN) ? [TSC_BIN, ...args] : ["tsc", ...args]
  const proc = spawnSync(cmd, argv, { cwd: root, encoding: "utf8", maxBuffer: 128 * 1024 * 1024 })
  const out = `${proc.stdout ?? ""}${proc.stderr ?? ""}`
  return { out, status: proc.status, error: proc.error ? String(proc.error.message) : null }
}

/** The walk that counts what the config compiles, so the register can say how big the surface is
 *  without a second compiler run. Its exclusions are duplicated from the config on purpose and the
 *  two are compared at run time: a scope that drifts from the config would silently change what
 *  "the surface" means. */
const EXCLUDE_DIRS = ["node_modules", "dist", "tests", "script/m14/tmp"] as const
function surfaceFiles(root: string, skip: string): number {
  let n = 0
  const walk = (dir: string) => {
    let entries: fs.Dirent[]
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const p = path.join(dir, e.name)
      const relp = path.relative(root, p).split(path.sep).join("/")
      if (EXCLUDE_DIRS.some((x) => relp === x || relp.startsWith(x + "/"))) continue
      if (e.isDirectory()) walk(p)
      else if (e.name.endsWith(".ts") && e.name !== skip) n++
    }
  }
  walk(path.join(root, "script"))
  return n
}

/** Which in-scope inputs are dirty in the working tree. A register is a measurement of a TREE, not
 *  of a commit — the same discipline the oracle-sharpness rows use — so the record says which files
 *  were uncommitted when it was frozen rather than implying the commit alone produced it. */
function dirtyInScope(root: string): string[] {
  const proc = spawnSync("git", ["status", "--porcelain", "--", "script", TSCONFIG], { cwd: root, encoding: "utf8" })
  return (proc.stdout ?? "").split("\n").map((l) => l.slice(3).trim()).filter(Boolean)
    .filter((l) => (l.endsWith(".ts") || l === TSCONFIG))
    .filter((l) => !EXCLUDE_DIRS.some((x) => l === x || l.startsWith(x + "/")))
    .sort()
}

interface Evaluation {
  verdict: "clean" | "shrink" | "growth" | "blind" | "non-positional" | "stale-canary" | "tsc-unavailable"
  canaryVisible: boolean
  diagnostics: Diagnostic[]
  nonPositional: string[]
  current: Map<string, Map<string, number>>
  comparison: Comparison | null
  status: number | null
}

/** One verdict from one compilation, canary included. Extracted so `--selftest` can run it against
 *  a throwaway program (a gate whose logic cannot be pointed at a fixture is a gate that has never
 *  been convicted). */
export function evaluate(root: string, configRel: string, canaryRel: string, baselinePath: string): Evaluation {
  const canary = path.join(root, canaryRel)
  if (fs.existsSync(canary)) {
    return { verdict: "stale-canary", canaryVisible: false, diagnostics: [], nonPositional: [], current: new Map(), comparison: null, status: null }
  }
  fs.mkdirSync(path.dirname(canary), { recursive: true })
  fs.writeFileSync(canary, CANARY_SOURCE)
  let out = ""
  let status: number | null = null
  let execError: string | null = null
  try {
    const run = runTsc(root, configRel)
    out = run.out
    status = run.status
    execError = run.error
  } finally {
    try { fs.rmSync(canary) } catch { /* the canary must never be the failure */ }
  }
  // An unrunnable compiler is its own refusal: with no output at all the canary would also be
  // "invisible", and blaming a parse error for a missing tsc is how a gate lies about its cause.
  if (execError) return { verdict: "tsc-unavailable", canaryVisible: false, diagnostics: [], nonPositional: [execError], current: new Map(), comparison: null, status }
  const { diagnostics, nonPositional } = parseDiagnostics(out)
  const current = census(diagnostics, canaryRel)
  const canaryVisible = diagnostics.some((d) => d.file === canaryRel)
  if (!canaryVisible) {
    // Either the program does not contain the canary (a broken config lets a gate publish a clean
    // tree it never read) or a parse refusal silenced the semantic layer. Both are refusals.
    return { verdict: "blind", canaryVisible, diagnostics, nonPositional, current, comparison: null, status }
  }
  if (nonPositional.length > 0) return { verdict: "non-positional", canaryVisible, diagnostics, nonPositional, current, comparison: null, status }
  let comparison: Comparison | null = null
  if (fs.existsSync(baselinePath)) {
    const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8")) as { errors: { file: string; codes: Record<string, number> }[] }
    const base = new Map<string, Map<string, number>>()
    for (const e of baseline.errors) base.set(e.file, new Map(Object.entries(e.codes)))
    comparison = compare(current, base)
    if (comparison.newFiles.length || comparison.growth.length) return { verdict: "growth", canaryVisible, diagnostics, nonPositional, current, comparison, status }
    return { verdict: comparison.shrink.length || comparison.vanished.length ? "shrink" : "clean", canaryVisible, diagnostics, nonPositional, current, comparison, status }
  }
  if (current.size > 0) return { verdict: "growth", canaryVisible, diagnostics, nonPositional, current, comparison, status }
  return { verdict: "clean", canaryVisible, diagnostics, nonPositional, current, comparison, status }
}

function selftest(): number {
  let pass = 0, fail = 0
  const check = (label: string, ok: boolean, detail = "") => { if (ok) pass++; else { fail++; console.log(`FAIL: ${label}${detail ? " — " + detail : ""}`) } }

  // --- the parser ------------------------------------------------------------------------------
  const p1 = parseDiagnostics("script/a.ts(1,2): error TS2322: Type 'string' is not assignable to type 'number'.\n")
  check("parser: a positional diagnostic is read with file, position and code",
    p1.diagnostics.length === 1 && p1.diagnostics[0].file === "script/a.ts" && p1.diagnostics[0].line === 1 && p1.diagnostics[0].code === "TS2322")
  const p2 = parseDiagnostics("error TS6059: File 'x' is not under 'rootDir'.\n  The file is in the program because:\n    Matched by include pattern\nFound 1 error.\n")
  check("parser: a configuration error carries no position and is kept separate",
    p2.diagnostics.length === 0 && p2.nonPositional.length === 1 && p2.nonPositional[0].startsWith("error TS6059"), JSON.stringify(p2))
  const p3 = parseDiagnostics("script/a.ts(9,1): error TS2345: Argument of type '{ x: string; }' is not assignable.\n  Types of property 'x' are incompatible.\n")
  check("parser: a continuation line is not mistaken for a second diagnostic", p3.diagnostics.length === 1)

  // --- the census ------------------------------------------------------------------------------
  const c = census([{ file: "script/a.ts", line: 1, col: 1, code: "TS2322", text: "" },
                    { file: "script/a.ts", line: 4, col: 1, code: "TS2322", text: "" },
                    { file: CANARY_REL, line: 1, col: 1, code: "TS2322", text: "" }], CANARY_REL)
  check("census: counts per file per code", c.get("script/a.ts")?.get("TS2322") === 2)
  check("census: the canary's own deliberate error is not debt", !c.has(CANARY_REL))

  // --- the comparison --------------------------------------------------------------------------
  const base = new Map([["script/a.ts", new Map([["TS2322", 2]])], ["script/b.ts", new Map([["TS2339", 1]])]])
  const same = compare(new Map([["script/a.ts", new Map([["TS2322", 2]])], ["script/b.ts", new Map([["TS2339", 1]])]]), base)
  check("compare: the baseline itself is clean", same.newFiles.length === 0 && same.growth.length === 0 && same.shrink.length === 0)
  const grew = compare(new Map([["script/a.ts", new Map([["TS2322", 3]])]]), base)
  check("compare: growth in an existing (file, code) is caught", grew.growth.length === 1 && grew.growth[0].was === 2 && grew.growth[0].now === 3)
  const fresh = compare(new Map([["script/untracked-probe.ts", new Map([["TS7006", 1]])]]), base)
  check("compare: a file absent from the register is NEW debt, not silence", fresh.newFiles.length === 1 && fresh.newFiles[0].file === "script/untracked-probe.ts")
  const shrank = compare(new Map([["script/a.ts", new Map([["TS2322", 1]])]]), base)
  check("compare: a shrink is reported, not hidden", shrank.shrink.some((s) => s.was === 2 && s.now === 1) && shrank.vanished.includes("script/b.ts"))

  // --- the gate, pointed at a throwaway program -------------------------------------------------
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "m60-script-surface-"))
  try {
    fs.mkdirSync(path.join(dir, "src"), { recursive: true })
    fs.writeFileSync(path.join(dir, "tsconfig.json"), JSON.stringify({
      compilerOptions: { target: "ES2023", module: "ESNext", moduleResolution: "bundler", strict: true, noEmit: true, skipLibCheck: true },
      include: ["src/**/*.ts"],
    }, null, 2) + "\n")
    const canaryRel = "src/__script-surface-canary.ts"
    const baseline = path.join(dir, "baseline.json")
    fs.writeFileSync(path.join(dir, "src", "clean.ts"), "export const x: number = 1\n")
    const clean = evaluate(dir, "tsconfig.json", canaryRel, baseline)
    check("evaluate: a clean program with a visible canary is clean", clean.verdict === "clean" && clean.canaryVisible, clean.verdict)
    fs.writeFileSync(path.join(dir, "src", "debt.ts"), 'export const y: number = "one real error"\n')
    const debt = evaluate(dir, "tsconfig.json", canaryRel, baseline)
    check("evaluate: a semantic error is seen and counted", debt.current.get("src/debt.ts")?.get("TS2322") === 1, JSON.stringify([...debt.current.keys()]))
    check("evaluate: with no register, any error is growth — never an implicit pass", debt.verdict === "growth")
    // The rule this gate was built for: one file tsc cannot parse silences the semantic layer, and
    // the canary is what refuses the verdict instead of publishing a smaller number.

    // The three-line shape that tsc 5.9.3 mis-parses — an arrow returning a parenthesised object
    // literal with no semicolon, immediately followed by a bare block — is pinned here deliberately,
    // as the same shape that used to sit in script/m29/verify-wave-protocol.ts. If a future tsc
    // parses it, THIS CHECK FAILS and says so, and the workaround comment in that file then deserves
    // revisiting rather than being forgotten.
    fs.writeFileSync(path.join(dir, "src", "unparseable.ts"),
      'type Step = { step: string; status: string; detail: string }\n' +
      'const step = (name: string, status: Step["status"]): Step => ({ step: name, status, detail: "" })\n' +
      '{ const x = 1 }\n')
    const blind = evaluate(dir, "tsconfig.json", canaryRel, baseline)
    check("evaluate: one unparseable file makes the run BLIND and is refused, not reported as smaller",
      blind.verdict === "blind" && !blind.canaryVisible, blind.verdict)
    check("evaluate: the refusing diagnostics name the parse errors it did get",
      blind.diagnostics.some((d) => d.file === "src/unparseable.ts" && d.code === "TS1003"), JSON.stringify(blind.diagnostics.map((d) => `${d.code}@${d.file}`)))
    // And the file the instrument itself leaves behind must refuse rather than be counted as debt.
    fs.writeFileSync(path.join(dir, canaryRel), "export const __scriptSurfaceCanary: number = 0\n")
    const stale = evaluate(dir, "tsconfig.json", canaryRel, baseline)
    check("evaluate: a canary left by a dead run refuses (stale-canary) instead of being measured",
      stale.verdict === "stale-canary", stale.verdict)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }

  console.log(`\nM60 script-surface selftest: ${pass} passed, ${fail} failed`)
  return fail > 0 ? 1 : 0
}

function scopeLines(root: string): string {
  try {
    const text = fs.readFileSync(path.join(root, TSCONFIG), "utf8")
    return text.split("\n").filter((l) => /"(include|exclude)"/.test(l)).map((l) => l.trim()).join(" ")
  } catch { return "(config unreadable)" }
}

function main(): number {
  const args = process.argv.slice(2)
  if (args.includes("--selftest")) return selftest()
  const quiet = args.includes("--quiet")
  const cfgText = scopeLines(ROOT)
  const drift = EXCLUDE_DIRS.filter((x) => !cfgText.includes(x))
  if (drift.length > 0) {
    console.error(`REFUSED: ${TSCONFIG}'s scope and this gate's walk disagree about ${drift.join(", ")} — fix one, not neither.`)
    return 1
  }

  if (args.includes("--report")) {
    try {
      const baseline = JSON.parse(fs.readFileSync(path.join(ROOT, BASELINE_REL), "utf8"))
      console.log(`registered ${baseline.totals.errors} error(s) in ${baseline.totals.filesWithErrors} file(s) of the script surface`)
      console.log(`measured ${baseline.measuredAt.date} at ${baseline.measuredAt.headShort} (${baseline.measuredAt.filesInScope} file(s) in scope, tsc ${baseline.measuredAt.tsVersion}, canary visible: ${baseline.measuredAt.canaryVisible})`)
      for (const e of baseline.errors.slice(0, 15)) console.log(`  ${String(e.total).padStart(4)}  ${e.file}`)
      if (baseline.errors.length > 15) console.log(`  … ${baseline.errors.length - 15} more file(s)`)
      return 0
    } catch {
      console.error(`no register at ${BASELINE_REL} — run without --report to measure the surface`)
      return 2
    }
  }

  const t0 = Date.now()
  const ev = evaluate(ROOT, TSCONFIG, CANARY_REL, path.join(ROOT, BASELINE_REL))
  const seconds = ((Date.now() - t0) / 1000).toFixed(0)
  const files = new Set([...ev.current.keys()]).size
  const errors = ev.comparison?.after ?? [...ev.current.values()].reduce((a, c) => a + [...c.values()].reduce((x, y) => x + y, 0), 0)

  if (!quiet) {
    console.log(`M60 script surface — tsc ${TSCONFIG} in ${seconds}s, canary ${ev.canaryVisible ? "VISIBLE (semantic diagnostics are being reported)" : "INVISIBLE (the run is blind)"}`)
    console.log(`scope: ${cfgText}`)
  }
  if (ev.verdict === "tsc-unavailable") {
    console.error(`\nREFUSED: the compiler could not be executed (${ev.nonPositional[0] ?? "unknown"}) — nothing was measured.`)
    return 2
  }
  switch (ev.verdict) {
    case "stale-canary":
      console.error(`\nREFUSED: ${CANARY_REL} already exists. A previous run died before deleting it, and its one deliberate error is now in the surface. Delete it and run again — a stale canary is never measured as debt.`)
      return 1
    case "blind":
      console.error(`\nREFUSED (blind): the canary's deliberate error did not come back, so this compilation proved nothing about the surface's semantics.`)
      console.error(`Cause, measured 2026-09-25: one file that fails to PARSE silences every semantic diagnostic in the program. The parse errors below are the whole diagnosis — fix the file that carries them, then run again.`)
      for (const d of ev.diagnostics.slice(0, 20)) console.error(`  ${d.file}(${d.line},${d.col}): ${d.code} ${d.text}`)
      if (ev.diagnostics.length > 20) console.error(`  … ${ev.diagnostics.length - 20} more`)
      return 1
    case "non-positional":
      console.error(`\nREFUSED: tsc reported ${ev.nonPositional.length} error(s) with no file position — configuration-level failures that no count may absorb:`)
      for (const l of ev.nonPositional.slice(0, 10)) console.error(`  ${l}`)
      return 1
    case "growth": {
      console.error(`\nFAIL: the script surface carries ${errors} error(s) in ${files} file(s) WITH ERRORS — more than the ${ev.comparison?.before ?? 0} registered.`)
      for (const f of ev.comparison?.newFiles.slice(0, 10) ?? []) console.error(`  NEW  ${f.total}  ${f.file}`)
      for (const g of ev.comparison?.growth.slice(0, 10) ?? []) console.error(`  MORE ${g.file}: ${g.code} ${g.was} -> ${g.now}`)
      console.error(`\nThe register is shrink-only: fix these, or if they are deliberate and better than the register says, re-freeze with --write-baseline and say so in the commit.`)
      return 1
    }
    case "shrink":
      console.log(`\nPASS (shrink): ${ev.comparison?.before ?? 0} registered -> ${errors} now, in ${files} file(s).`)
      for (const s of ev.comparison?.shrink.slice(0, 10) ?? []) console.log(`  LESS ${s.file}: ${s.code} ${s.was} -> ${s.now}`)
      for (const v of ev.comparison?.vanished.slice(0, 10) ?? []) console.log(`  GONE ${v}`)
      console.log(`Re-freeze deliberately: bun script/m60/verify-script-surface.ts --write-baseline`)
      return 0
    case "clean":
      console.log(`\nPASS (clean): ${errors} error(s) in ${files} file(s) with errors — exactly the register (${ev.comparison?.before ?? 0}).`)
      return 0
  }
  console.error(`\nunreachable verdict ${(ev as { verdict: string }).verdict}`)
  return 2
}

/** `--write-baseline` is a separate, explicit act: it measures and records. Kept out of main()'s
 *  switch so that the measurement cannot be written by a run that was refused for blindness. */
function writeBaseline(): number {
  const ev = evaluate(ROOT, TSCONFIG, CANARY_REL, path.join(ROOT, "__no-such-baseline.json"))
  if (ev.verdict === "blind" || ev.verdict === "stale-canary" || ev.verdict === "non-positional") {
    console.error(`REFUSED: ${ev.verdict} — a register may not be frozen from a run that proved nothing.`)
    return 1
  }
  const errors = [...ev.current.entries()].map(([file, codes]) => ({
    file, total: [...codes.values()].reduce((a, b) => a + b, 0),
    codes: Object.fromEntries([...codes.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))),
  })).sort((a, b) => b.total - a.total || a.file.localeCompare(b.file))
  const tsVersion = (() => {
    try { return fs.readFileSync(path.join(ROOT, "node_modules", "typescript", "package.json"), "utf8").match(/"version":\s*"([^"]+)"/)?.[1] ?? "unknown" } catch { return "unknown" }
  })()
  const head = (() => {
    const p = spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" })
    return { head: (p.stdout ?? "").trim(), headShort: (p.stdout ?? "").trim().slice(0, 8) }
  })()
  const record = {
    schemaVersion: 1,
    milestone: "M60",
    gate: "script-surface typecheck",
    contract: "SHRINK-ONLY. Every error in this register is real, measured debt of the untyped layer (see reviews/m60-script-surface-typecheck.md); the gate fails on any new file or any (file, code) whose count grows. A shrink is printed and only re-frozen by hand with --write-baseline, from a run whose canary came back.",
    measuredAt: { date: new Date().toISOString(), ...head, tsVersion, tsconfig: TSCONFIG, canaryVisible: ev.canaryVisible, filesInScope: surfaceFiles(ROOT, path.basename(CANARY_REL)), dirtyInScope: dirtyInScope(ROOT) },
    totals: { errors: errors.reduce((a, e) => a + e.total, 0), filesWithErrors: errors.length },
    errors,
  }
  fs.mkdirSync(path.dirname(path.join(ROOT, BASELINE_REL)), { recursive: true })
  fs.writeFileSync(path.join(ROOT, BASELINE_REL), JSON.stringify(record, null, 2) + "\n")
  console.log(`wrote ${BASELINE_REL}: ${record.totals.errors} error(s) in ${record.totals.filesWithErrors} file(s), canary visible=${ev.canaryVisible}, ${record.measuredAt.dirtyInScope.length} dirty in scope`)
  if (record.measuredAt.dirtyInScope.length) {
    console.log(`  the register measures a working tree: re-freeze once ${record.measuredAt.dirtyInScope.length === 1 ? "that file" : "those files"} land(s) if the commit is what the record should describe`)
    for (const f of record.measuredAt.dirtyInScope.slice(0, 10)) console.log(`    dirty  ${f}`)
  }
  return 0
}

const isMain = process.argv[1]?.endsWith("verify-script-surface.ts")
if (isMain) process.exitCode = process.argv.includes("--write-baseline") ? writeBaseline() : main()
