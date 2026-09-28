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
// CLI: npx tsx script/m29/wave-protocol.ts --language <lang> [--out <file>]
// Exit 0 = every non-blocked step passed; exit 1 = any real failure.

import { existsSync, readFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import path from "node:path"
import { realpathSync } from "node:fs"
import { createHash } from "node:crypto"
import { tmpdir } from "node:os"
import { writeSealed } from "../lib/evidence.ts"
import { parseSealedRecord } from "../lib/evidence.ts"

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

function runGate(step: string, script: string): Step {
  try {
    execFileSync("npx", ["tsx", script], { cwd: ROOT, stdio: "ignore", timeout: 240_000 })
    return { step, status: "pass", detail: `${script} exit 0` }
  } catch (error) {
    const status = (error as { status?: number }).status
    return { step, status: "fail", detail: `${script} exit ${String(status ?? "error")}` }
  }
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
  steps.push(runGate("S2-position-gate", "script/m24/verify-positions.ts"))
  steps.push(runGate("S3-freshness-gate", "script/m24/verify-freshness.ts"))

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

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  main()
}
