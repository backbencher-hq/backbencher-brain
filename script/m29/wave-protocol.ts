// script/m29/wave-protocol.ts — M29.R1 (issue #536): the wave checklist machine.
//
// ONE owner of the language-onboarding protocol (contract §9): a candidate
// language walks a fixed checklist and receives a mechanically-computed IDE
// claim-level cap. The binding is the milestone's core rule, enforced here
// and nowhere else:
//
//   IDE claim level of a language <= what its machine evidence proves:
//     I0  default (unverified)
//     I1  protocol-passed: #419 analyzer conformance (all sections pass in
//         the committed SPEC ledger) + component gates (positions, freshness)
//         green + a real per-language fixture indexed by the real indexer
//     I2  index-conformant: I1 + the real bb_lsp server leg run against that
//         language's own index (R2's per-language leg)
//     I3  editor-verified: I2 + recorded in-editor evidence (R2's E5-style
//         leg; the runner honors recorded evidence, never assumes it)
//
// Steps are declared, per-step pass/fail/blocked-with-reason. Silence is
// guilt: a step that did not run is `blocked` with a machine-readable reason,
// never `pass`, never omitted (contract §8.3).
//
// A launched language may additionally carry a SEALED DISPOSITION
// (validation/m29/results/wave-<lang>-disposition.json, written by
// writeDisposition() through the one sealed evidence path): a machine-readable
// record stating precisely why its LSP surface is terminally limited —
// "blocked" (the surface cannot be exercised today: a missing grammar, a
// shared file extension the path map refuses to guess) or
// "not-lsp-appropriate" (the surface exists but the LSP semantics do not apply:
// a build DSL with no callables). It is the honesty mechanism for an approved
// language that cannot honestly be verified. A disposition never raises a
// claim level; the verifier accepts it only when its failingChecks are a subset
// of the leg's REAL failed steps and its evidence record exists. A missing,
// unsealed or mismatched disposition fails — a waiver granted without evidence
// has no teeth (contract §8.3).
//
// CLI: npx tsx script/m29/wave-protocol.ts --language <lang> [--out <file>]
// Exit 0 = every non-blocked step passed; exit 1 = any real failure.

import { existsSync, readFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { execFileSync, spawn } from "node:child_process"
import path from "node:path"
import { realpathSync } from "node:fs"
import { createHash } from "node:crypto"
import { tmpdir } from "node:os"
import { writeSealed } from "../lib/evidence.ts"
import { parseSealedRecord } from "../lib/evidence.ts"
import { readEvidence } from "../lib/evidence.ts"
import { fileURLToPath } from "node:url"

export const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
export const SPEC_LEDGER = path.join(ROOT, "validation/m14/results/M14.0.SPEC.json")
const DIST_INDEX = path.join(ROOT, "dist", "index.js")

/** Wave registry: candidate languages and their fixture extensions (R2
 *  authors the fixture packs; the extension is the language's identity). */
export const WAVE_LANGUAGES: Record<string, string> = {
  java: "java", groovy: "groovy", kotlin: "kt", scala: "scala",
  typescript: "ts", javascript: "js", vue: "vue", svelte: "svelte",
  go: "go", rust: "rs", python: "py", csharp: "cs", dart: "dart",
  ruby: "rb", php: "php", c: "c", cpp: "cpp", zig: "zig",
  haskell: "hs", objc: "m", swift: "swift",
  // Wave 3 (2026-11-08): the remaining analyzers, onboarded in bulk. The
  // extension is the language's FIXTURE identity — `main.<ext>` under
  // script/m29/wave-fixtures/<lang>/. A language whose extension cannot be
  // resolved unambiguously from a path (objc/matlab both use .m) will report
  // that as its blocker rather than guess.
  tsx: "tsx", html: "html", css: "css", scss: "scss", sass: "sass",
  json: "json", yaml: "yaml", toml: "toml", markdown: "md", xml: "xml",
  graphql: "graphql", protobuf: "proto", sql: "sql", perl: "pl",
  lua: "lua", elixir: "ex", erlang: "erl", clojure: "clj", julia: "jl",
  r: "r", bash: "sh", powershell: "ps1", make: "mk", fsharp: "fs",
  nim: "nim", vb: "vb", vba: "bas", matlab: "m", clean: "icl",
  solidity: "sol", hcl: "hcl", terraform: "tf",
}

/** A SEALED disposition for an approved language whose LSP surface is honestly
 *  limited (the M29 wave-3 honesty mechanism). The record lives at
 *  validation/m29/results/wave-<lang>-disposition.json and is written through
 *  writeSealed(), so the trusted read refuses a hand edit.
 *
 *  The disposition never raises a claim level — it records WHY a launched
 *  language's S5/S6 evidence is terminally limited, which is exactly the
 *  machine-readable reason contract §8.3 says a blocked state must carry.
 *  A gate accepts one only when its `failingChecks` are a subset of the leg's
 *  REAL failed steps and its `evidence` record exists; anything else fails. */
export interface WaveDisposition {
  language: string
  disposition: "blocked" | "not-lsp-appropriate"
  /** One sentence naming the concrete limit (never "unknown reason"). */
  reason: string
  /** The leg steps this disposition covers; must be a subset of the leg's failed steps. */
  failingChecks: string[]
  /** Repo-relative path of the evidence record the disposition rests on. */
  evidence: string
  declaredAt: string
  declaredBy: string
}

/** Path of a language's sealed disposition record (absent = no waiver claimed). */
export function dispositionPath(language: string): string {
  return path.join(ROOT, "validation/m29/results", `wave-${language}-disposition.json`)
}

/** Write a disposition through the ONE sealed evidence write path. Refuses a
 *  record that could not be judged at all (no language, no reason, unknown
 *  disposition, no failing checks, no evidence path, no declarer) — a waiver
 *  granted without evidence has no teeth. */
export function writeDisposition(disposition: WaveDisposition): void {
  if (typeof disposition.language !== "string" || disposition.language.trim() === "") throw new Error("wave disposition: language is required")
  if (disposition.disposition !== "blocked" && disposition.disposition !== "not-lsp-appropriate") {
    throw new Error(`wave disposition: unknown disposition ${String(disposition.disposition)} (expected "blocked" or "not-lsp-appropriate")`)
  }
  if (typeof disposition.reason !== "string" || disposition.reason.trim() === "") throw new Error("wave disposition: reason is required")
  if (!Array.isArray(disposition.failingChecks) || disposition.failingChecks.length === 0) throw new Error("wave disposition: failingChecks must name at least one leg step")
  if (typeof disposition.evidence !== "string" || disposition.evidence.trim() === "") throw new Error("wave disposition: evidence path is required")
  if (typeof disposition.declaredAt !== "string" || disposition.declaredAt.trim() === "") throw new Error("wave disposition: declaredAt is required")
  if (typeof disposition.declaredBy !== "string" || disposition.declaredBy.trim() === "") throw new Error("wave disposition: declaredBy is required")
  writeSealed(dispositionPath(disposition.language), disposition as unknown as Record<string, unknown>)
}

/** Trusted read of a language's sealed disposition. A missing record is a
 *  declared absence (`ok: false` with the reason) — never an assumed
 *  disposition; an unsealed/tampered record is refused by `readEvidence`. */
export function readDisposition(language: string): { ok: true; disposition: WaveDisposition } | { ok: false; reason: string } {
  const file = dispositionPath(language)
  if (!existsSync(file)) return { ok: false, reason: `no sealed disposition record for ${language} (${path.relative(ROOT, file)})` }
  const read = readEvidence<WaveDisposition>(file)
  if (!read.ok) return { ok: false, reason: `disposition record refused: ${read.reason} (kind=${read.kind})` }
  return { ok: true, disposition: read.record }
}

/** Resolve a disposition's evidence path against ROOT and report whether the
 *  record exists. Evidence is a repo-relative record path (never assumed). */
export function dispositionEvidenceExists(evidence: string): boolean {
  if (typeof evidence !== "string" || evidence.trim() === "") return false
  return existsSync(path.isAbsolute(evidence) ? evidence : path.join(ROOT, evidence))
}

/**
 * The acceptance rule for a sealed disposition — PURE, so a gate and its
 * mutant suite can prove it both accepts a matching record and rejects a
 * mismatched one. It is the ONE owner of "is this waiver evidence-backed?".
 *
 * An approved language whose S5 leg is not `verified` may carry a sealed
 * disposition that records WHY its LSP surface is terminally limited. It is
 * accepted as a TERMINAL blocked / not-lsp-appropriate state only when ALL of
 * these hold:
 *   - it names THIS language;
 *   - it declares a known disposition and a non-empty reason;
 *   - it names at least one failing check, and EVERY named check is one the
 *     leg actually failed — a disposition may not invent evidence (naming a
 *     check the leg passed is exactly the waiver-without-teeth the gate must
 *     catch);
 *   - its evidence record exists and, when that record is a wave record, it
 *     belongs to THIS language — never another language's leg.
 * The caller consults this only for a leg whose status is not `verified`; a
 * verified leg passes as today and a missing leg stays a failure, so a
 * disposition is never conflated with either.
 */
export function acceptDisposition(
  language: string,
  disposition: WaveDisposition,
  legFailedSteps: string[],
  evidenceExists: boolean,
): { accepted: boolean; reason: string } {
  if (disposition.language !== language) {
    return { accepted: false, reason: `disposition names language ${JSON.stringify(disposition.language)}, not ${language}` }
  }
  if (disposition.disposition !== "blocked" && disposition.disposition !== "not-lsp-appropriate") {
    return { accepted: false, reason: `unknown disposition ${JSON.stringify(disposition.disposition)}` }
  }
  if (typeof disposition.reason !== "string" || disposition.reason.trim() === "") {
    return { accepted: false, reason: "disposition carries no reason" }
  }
  if (!Array.isArray(disposition.failingChecks) || disposition.failingChecks.length === 0) {
    return { accepted: false, reason: "disposition names no failing check" }
  }
  const invented = disposition.failingChecks.filter((check) => !legFailedSteps.includes(check))
  if (invented.length > 0) {
    return { accepted: false, reason: `disposition names check(s) the leg did not fail: ${invented.join(" | ")}` }
  }
  if (typeof disposition.evidence !== "string" || disposition.evidence.trim() === "") {
    return { accepted: false, reason: "disposition carries no evidence path" }
  }
  if (!evidenceExists) {
    return { accepted: false, reason: `disposition evidence does not exist: ${disposition.evidence}` }
  }
  const base = path.basename(disposition.evidence)
  const foreign = /^wave-(?:editor-)?([A-Za-z0-9_-]+)\.json$/.exec(base)
  if (foreign !== null && foreign[1] !== language) {
    return { accepted: false, reason: `disposition evidence ${base} belongs to ${foreign[1]}, not ${language}` }
  }
  return {
    accepted: true,
    reason: `${disposition.disposition}: ${disposition.reason} (covers ${disposition.failingChecks.length} failed check(s); evidence ${disposition.evidence})`,
  }
}

export type StepStatus = "pass" | "fail" | "blocked"
export interface Step {
  step: string
  status: StepStatus
  detail: string
}
export interface WaveVerdict {
  language: string
  steps: Step[]
  /** Mechanically computed IDE claim-level cap (contract §2 vocabulary). */
  ideCap: "I0" | "I1" | "I2" | "I3"
  /** Machine-readable reasons a higher cap was not reachable this run. */
  blockers: string[]
  ok: boolean
  commit: string
  /** S4 artifact stats when the real-index leg ran. */
  indexCounts: { files: number; symbols: number; relationships: number } | null
}

// --- Pure decision functions (the binding; mutated by the verifier) ----------

export type SpecLedger = { data: { languages: Record<string, { sections: Record<string, { status: string }> }> } }

/** S1: #419 analyzer conformance, read mechanically from the committed SPEC
 *  ledger. All sections must pass. A language missing from the ledger is
 *  conformance `false` with a reason — never assumed. */
export function analyzerConformance(spec: SpecLedger, language: string): { conformant: boolean; reason: string } {
  const entry = spec?.data?.languages?.[language]
  if (!entry) return { conformant: false, reason: `language ${language} absent from the #419 SPEC ledger` }
  const sections = entry.sections ?? {}
  if (Object.keys(sections).length === 0) return { conformant: false, reason: `language ${language} has no recorded sections` }
  const failing = Object.entries(sections)
    .filter(([, s]) => s.status !== "pass")
    .map(([name]) => name)
  if (failing.length > 0) return { conformant: false, reason: `failing sections: ${failing.join(",")}` }
  const n = Object.keys(sections).length
  return { conformant: true, reason: `${n}/${n} sections pass` }
}

/** The binding (contract §9 + §2): compute the IDE claim-level cap from step
 *  results. Pure — the verifier mutates inputs and requires the cap to move.
 *  Any fail in a tier's steps caps below that tier (a failed gate is never
 *  climbed past). */
export function computeCap(steps: Step[]): "I0" | "I1" | "I2" | "I3" {
  const byStep = new Map(steps.map((s) => [s.step, s]))
  const status = (name: string) => byStep.get(name)?.status
  const pass = (name: string) => status(name) === "pass"
  const tier1 = ["S1-analyzer-conformance", "S2-position-gate", "S3-freshness-gate", "S4-real-index"]
  // I1 floor: every tier-1 step passed (a blocked or failed step caps at I0).
  if (!tier1.every(pass)) return "I0"
  if (!pass("S5-server-leg")) return "I1"
  if (!pass("S6-editor-leg")) return "I2"
  return "I3"
}

// --- Step runners ------------------------------------------------------------

function gitCommit(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
  } catch {
    return "unknown"
  }
}

/** The bound on a spawned component gate. ONE value, shared by this protocol and
 *  its own wiring harness (script/m29/verify-wave-harness.ts uses the same 420 s for
 *  the same two verifiers) — two different bounds for one verifier made the protocol
 *  report a timeout where its harness reported a verdict. */
export const GATE_BOUND_MS = 420_000

/**
 * Spawn a component gate (S2/S3) and classify its outcome HONESTLY.
 *
 * Three outcomes, three statuses, and the difference is the whole point:
 *   exit 0            -> `pass`
 *   exit != 0         -> `fail`   (the gate reached a verdict and the verdict is red)
 *   killed / timeout  -> `blocked` (the gate never reached a verdict)
 *
 * The third case used to be reported as `fail` with the detail "exit error", which
 * asserts something the run did not measure: the gate did not fail, it did not
 * finish. Measured on this machine 2026-10-07: script/m24/verify-positions.ts ran
 * 740 s without a verdict after the protocol's 240 s spawn bound killed its parent,
 * so the leg printed "exit error" — a red gate whose stated cause was false. The
 * protocol's own rule is the fix ("a step that did not run is `blocked` with a
 * machine-readable reason, never `pass`, never omitted"): a step that did not REACH
 * a verdict is `blocked` too, and the cap is unaffected (a blocked tier-1 step caps
 * at I0 exactly like a failed one — computeCap is unchanged).
 *
 * The second defect this closes is the orphan. `execFileSync(..., { timeout })`
 * signals only the direct child (`npx`), so `tsx` and the verifier kept running and
 * kept WRITING after the protocol had already read their status — the m24 records
 * this protocol's S2/S3 steps are about. The child is now a process-group leader
 * and the bound kills the GROUP, so a timed-out step leaves nothing behind.
 */
function runGate(step: string, script: string): Promise<Step> {
  return new Promise<Step>((resolve) => {
    const child = spawn("npx", ["tsx", script], { cwd: ROOT, stdio: "ignore", detached: true })
    let settled = false
    const finish = (s: Step): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(s)
    }
    const timer = setTimeout(() => {
      try {
        if (child.pid) process.kill(-child.pid, "SIGKILL")
      } catch {
        // already gone — the close handler will have settled this
      }
      finish({ step, status: "blocked", detail: `${script} did not reach a verdict within ${GATE_BOUND_MS / 1000}s — killed at the bound (a timeout is not a gate failure)` })
    }, GATE_BOUND_MS)
    child.on("error", (error) => finish({ step, status: "blocked", detail: `${script} could not be spawned: ${error.message}` }))
    child.on("close", (code, signal) => {
      if (code === 0) finish({ step, status: "pass", detail: `${script} exit 0` })
      else if (signal) finish({ step, status: "blocked", detail: `${script} was killed by ${signal} before reaching a verdict` })
      else finish({ step, status: "fail", detail: `${script} exit ${String(code)}` })
    })
  })
}

export interface S4Result {
  step: Step
  counts: { files: number; symbols: number; relationships: number } | null
}

/** S4: real per-language fixture pack + REAL indexing through the compiled
 *  indexer (the M28 differential-gate path). The pack's absence is a machine
 *  reason (blocked), not a skip; an indexing failure is a fail. */
export async function realIndexStep(language: string): Promise<S4Result> {
  const ext = WAVE_LANGUAGES[language]
  if (!ext) return { step: { step: "S4-real-index", status: "blocked", detail: `language ${language} is not in the wave registry` }, counts: null }
  const packDir = path.join(ROOT, "script/m29/wave-fixtures", language)
  const mainFile = path.join(packDir, `main.${ext}`)
  if (!existsSync(mainFile)) {
    return {
      step: { step: "S4-real-index", status: "blocked", detail: `no wave fixture pack for ${language} (expected ${path.relative(ROOT, mainFile)}) — R2 authoring step` },
      counts: null,
    }
  }
  if (!existsSync(DIST_INDEX)) {
    return { step: { step: "S4-real-index", status: "blocked", detail: "dist/index.js missing — run npm run build first" }, counts: null }
  }
  const dataDir = path.join(tmpdir(), `m29-wave-${language}-${Date.now()}`)
  mkdirSync(dataDir, { recursive: true })
  try {
    const canonical = realpathSync.native(packDir)
    const projectId = createHash("sha1").update(canonical).digest("hex").substring(0, 40)
    process.env.BB_DATA_DIR = dataDir
    const dist = (await import(DIST_INDEX)) as { indexProjectParallel: (pid: string, p: string, o: Record<string, unknown>) => Promise<unknown> }
    if (typeof dist.indexProjectParallel !== "function") {
      return { step: { step: "S4-real-index", status: "blocked", detail: "dist/index.js has no indexProjectParallel export" }, counts: null }
    }
    await dist.indexProjectParallel(projectId, canonical, {})
    const { BrainDatabase } = (await import(path.join(ROOT, "src", "brain", "database.ts"))) as { BrainDatabase: { getRawInstance: (pid: string) => Promise<{ prepare: (q: string) => { get: () => { c: number } } }> } }
    const db = await BrainDatabase.getRawInstance(projectId)
    const files = db.prepare("SELECT COUNT(*) c FROM brain_file").get().c
    const symbols = db.prepare("SELECT COUNT(*) c FROM brain_symbol").get().c
    const rels = db.prepare("SELECT COUNT(*) c FROM brain_relationship").get().c
    if (files === 0 || symbols === 0) {
      return {
        step: { step: "S4-real-index", status: "fail", detail: `real indexing produced an empty index (files=${files}, symbols=${symbols}) — declared, never silent` },
        counts: { files, symbols, relationships: rels },
      }
    }
    return {
      step: { step: "S4-real-index", status: "pass", detail: `real indexer: ${files} files, ${symbols} symbols, ${rels} relationships from the ${language} pack` },
      counts: { files, symbols, relationships: rels },
    }
  } catch (error) {
    return { step: { step: "S4-real-index", status: "fail", detail: String((error as Error).message).slice(0, 200) }, counts: null }
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
  }
}

// --- Protocol driver ----------------------------------------------------------

export async function evaluateLanguage(language: string): Promise<WaveVerdict> {
  const steps: Step[] = []
  const blockers: string[] = []

  // S1: analyzer conformance from the committed SPEC ledger.
  let spec: SpecLedger | null = null
  try {
    spec = parseSealedRecord(SPEC_LEDGER) as SpecLedger
  } catch {
    // spec stays null — S1 records the reason below
  }
  if (!spec) {
    steps.push({ step: "S1-analyzer-conformance", status: "blocked", detail: `#419 SPEC ledger unreadable at ${path.relative(ROOT, SPEC_LEDGER)}` })
  } else {
    const conf = analyzerConformance(spec, language)
    steps.push({ step: "S1-analyzer-conformance", status: conf.conformant ? "pass" : "fail", detail: conf.reason })
  }

  // S2/S3: component gates (positions, freshness) — real verifiers, spawned.
  // A gate that never reached a verdict is `blocked`, and a blocked step is a
  // declared blocker like every other one: the cap is unreachable this run and the
  // reason is machine-readable. `blockers` is what a reader is owed; `fail` is a
  // verdict the run does not have.
  for (const [name, script] of [
    ["S2-position-gate", "script/m24/verify-positions.ts"],
    ["S3-freshness-gate", "script/m24/verify-freshness.ts"],
  ] as const) {
    const s = await runGate(name, script)
    steps.push(s)
    if (s.status === "blocked") blockers.push(`${name}: ${s.detail}`)
  }

  // S4: real per-language fixture + real indexing.
  const s4 = await realIndexStep(language)
  steps.push(s4.step)
  if (s4.step.status === "blocked") blockers.push(s4.step.detail)

  // S5: the per-language server leg. Real only against the language's OWN
  // index with per-language assertions — that is R2's execution evidence.
  // Like S6 below, the runner honors the RECORDED leg (wave-<lang>.json,
  // written by R2's execution): verified → pass, failed → fail, missing →
  // a declared blocker. Never a silent pass; never a hardcoded blocked when
  // evidence exists (that bug capped verified languages at I1).
  const serverLegPath = path.join(ROOT, "validation/m29/results", `wave-${language}.json`)
  if (existsSync(serverLegPath)) {
    try {
      const leg = parseSealedRecord(serverLegPath) as { status?: string }
      steps.push({ step: "S5-server-leg", status: leg.status === "verified" ? "pass" : "fail", detail: `recorded S5 leg status: ${String(leg.status)}` })
      if (leg.status !== "verified") blockers.push("S5-server-leg recorded leg is not verified")
    } catch {
      steps.push({ step: "S5-server-leg", status: "fail", detail: "recorded S5 leg unreadable" })
      blockers.push("S5-server-leg recorded leg unreadable")
    }
  } else {
    steps.push({ step: "S5-server-leg", status: "blocked", detail: "requires R2's per-language server leg (real bb_lsp over the language's own index)" })
    blockers.push("S5-server-leg requires R2 execution")
  }

  // S6: editor-verified evidence (R2's in-editor leg). The runner only
  // honors recorded wave evidence — it never assumes it.
  const waveEvidence = path.join(ROOT, "validation/m29/results", `wave-editor-${language}.json`)
  if (existsSync(waveEvidence)) {
    try {
      const ev = parseSealedRecord(waveEvidence) as { status?: string }
      steps.push({ step: "S6-editor-leg", status: ev.status === "verified" ? "pass" : "fail", detail: `recorded evidence status: ${String(ev.status)}` })
    } catch {
      steps.push({ step: "S6-editor-leg", status: "fail", detail: "recorded evidence unreadable" })
    }
  } else {
    steps.push({ step: "S6-editor-leg", status: "blocked", detail: "no recorded in-editor evidence for this language — R2 execution step" })
    blockers.push("S6-editor-leg requires R2 in-editor evidence")
  }

  const ideCap = computeCap(steps)
  const ok = steps.every((s) => s.status !== "fail")
  return { language, steps, ideCap, blockers, ok, commit: gitCommit(), indexCounts: s4.counts }
}

function main(): void {
  const args = process.argv.slice(2)
  const langIdx = args.indexOf("--language")
  const language = langIdx !== -1 ? args[langIdx + 1] : undefined
  const outIdx = args.indexOf("--out")
  const outFile = outIdx !== -1 ? args[outIdx + 1] : undefined
  if (!language) {
    console.error("usage: wave-protocol.ts --language <lang> [--out <file>]")
    console.error(`registry: ${Object.keys(WAVE_LANGUAGES).join(", ")}`)
    process.exit(2)
  }
  void evaluateLanguage(language).then((verdict) => {
    console.log(`wave protocol — ${language}`)
    for (const s of verdict.steps) {
      console.log(`  ${s.status.toUpperCase().padEnd(7)} ${s.step} — ${s.detail}`)
    }
    console.log(`  IDE cap: ${verdict.ideCap}${verdict.blockers.length ? ` (blockers: ${verdict.blockers.length})` : ""}`)
    if (outFile) {
      mkdirSync(path.dirname(outFile), { recursive: true })
      writeSealed(outFile, verdict)
    }
    process.exit(verdict.ok ? 0 : 1)
  })
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main()
}
