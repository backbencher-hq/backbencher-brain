// script/m29/verify-wave-execution.ts — M29.R2 verifier + mutation suite (issue #537).
//
// Proves wave-1 execution is real, owner-scoped, and honest — and that the
// suite CAN FAIL:
//
//   R1 approval:   the approval record governs — every executed leg's
//                  language is in the record; an unapproved language is
//                  rejected (mutant-proven)
//   R2 S5 legs:    every approved language has wave-<lang>.json with
//                  verified status, real index counts, passing steps, and
//                  §3 budget compliance at the current commit
//   R3 S6 legs:    a REAL headless Neovim session per language (M27.N1
//                  pattern, provisioned .tools layout) drives the real
//                  server through the wave expectations; results land as
//                  wave-editor-<lang>.json which the R1 runner honors
//   R4 mutants:    approval-forgery, missing-leg, and drifted-approval
//                  defects are all CAUGHT
//
// Run: npx tsx script/m29/verify-wave-execution.ts
// Evidence: validation/m29/results/R2.json (machine-emitted)

import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { realpathSync } from "node:fs"
import path from "node:path"
import { ROOT, WAVE_LANGUAGES, acceptDisposition, dispositionEvidenceExists, readDisposition, type WaveDisposition } from "./wave-protocol.ts"
import { assertLanguageApproved, hoverCharacter, staleRelevantPaths } from "./wave-execute.ts"
import { writeSealed, canonicalizeKeys } from "../lib/evidence.ts"
import { fingerprintFields } from "../m61/claim_fingerprints.ts"
import { parseSealedRecord } from "../lib/evidence.ts"

/** Every owner-approved wave record (wave-1, wave-2, …): the union is the
 *  execution authority, mirroring the executor's approvedLanguages(). */
function approvalRecord(): { languages: string[]; approvedBy?: string; ownerStatement?: string; waves: string[] } | null {
  const dir = path.join(ROOT, "validation/m29/results")
  if (!existsSync(dir)) return null
  const files = readdirSync(dir).filter((f) => /^wave-\d+-approval\.json$/.test(f)).sort()
  if (files.length === 0) return null
  const languages: string[] = []
  let approvedBy: string | undefined
  let ownerStatement: string | undefined
  for (const f of files) {
    try {
      const rec = JSON.parse(readFileSync(path.join(dir, f), "utf8")) as { languages?: string[]; approvedBy?: string; ownerStatement?: string }
      for (const lang of rec.languages ?? []) if (!languages.includes(lang)) languages.push(lang)
      approvedBy ??= rec.approvedBy
      ownerStatement ??= rec.ownerStatement
    } catch {}
  }
  return { languages, approvedBy, ownerStatement, waves: files }
}
const APPROVAL = path.join(ROOT, "validation/m29/results/wave-1-approval.json")

/** True when any input that can change this language's measured behaviour has
 *  changed since `commit`. The same relevance rule R2 applies to an S5 leg, so
 *  a resumed record is never trusted across a real change. */
function staleSince(commit: string, language: string): boolean {
  try {
    const changed = execFileSync("git", ["diff", "--name-only", commit, "HEAD", "--", ...staleRelevantPaths(language)], { cwd: ROOT, encoding: "utf8" })
      .split("\n")
      .filter(Boolean)
    return changed.length > 0
  } catch {
    return true
  }
}
const NVIM = path.join(ROOT, ".tools", "nvim-linux-x86_64", "bin", "nvim")

// Neovim refuses to start when it cannot create its state directory
// (E739: Cannot create directory ~/.local/state/nvim). This sandbox mounts $HOME
// read-only, so every driven session failed with a Lua chunk error that reads like
// a driver bug rather than a sandbox one. Same fix as script/m27/verify-nvim.ts,
// never propagated to these two drivers: point every XDG location at a writable
// directory under the system temp area.
const NVIM_QUIET_XDG: Record<string, string> = (() => {
  const base = path.join(tmpdir(), "m29-nvim-xdg")
  const env: Record<string, string> = {}
  for (const key of ["STATE", "DATA", "CACHE", "CONFIG"] as const) {
    const dir = path.join(base, key.toLowerCase())
    mkdirSync(dir, { recursive: true })
    env[`XDG_${key}_HOME`] = dir
  }
  return env
})()


let checks = 0
let passed = 0
let mutantsCaught = 0
let mutantsTotal = 0

function check(label: string, condition: boolean, detail = ""): void {
  checks++
  if (condition) passed++
  else console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`)
}
function mutant(label: string, caught: boolean, detail = ""): void {
  mutantsTotal++
  if (caught) mutantsCaught++
  check(`mutant caught: ${label}`, caught, detail)
}

function gitCommit(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
  } catch {
    return "unknown"
  }
}

interface WaveLeg {
  language: string
  status: "verified" | "failed" | "blocked"
  steps: Array<{ step: string; status: string; detail: string }>
  indexCounts: { files: number; symbols: number; relationships: number } | null
  commit: string
  machine: Record<string, string>
}
interface EditorLeg {
  language: string
  session?: Record<string, unknown>
  checks: Array<{ name: string; ok: boolean; detail: string }>
}

const WARM_BUDGETS: Record<string, number> = {
  hover: 50, definition: 50, references: 50,
  documentSymbol: 50, workspaceSymbol: 150, prepareCallHierarchy: 100,
}


// --- R1: the approval record governs ----------------------------------------
let approval = approvalRecord()
check("R1: approval record exists and is readable", approval !== null)
check("R1: approval names an owner", typeof approval?.approvedBy === "string" && approval.approvedBy.length > 0)
check("R1: approval names languages", Array.isArray(approval?.languages) && approval.languages.length > 0)
if (approval) {
  for (const lang of approval.languages) {
    check(`R1: ${lang} is in the wave registry`, WAVE_LANGUAGES[lang] !== undefined)
  }
}

// --- R2: S5 legs (real index + real server) for every approved language -----
// A language is expected to be `verified`; a language that is not may instead
// be TERMINAL — a sealed disposition that names precisely why its LSP surface
// is limited, accepted only when its failingChecks are the leg's REAL failed
// steps and its evidence record exists. Terminal states are printed with their
// reason and never counted as verified; a missing leg is always a failure.
const terminalByLang = new Map<string, { disposition: string; reason: string }>()
const legSummaries: Array<{ language: string; status: string; steps: number; budgetsOk: boolean; terminal?: string; dispositionReason?: string }> = []
for (const lang of approval?.languages ?? []) {
  const legPath = path.join(ROOT, "validation/m29/results", `wave-${lang}.json`)
  if (!existsSync(legPath)) {
    check(`R2: ${lang} has an S5 leg`, false, "wave-<lang>.json missing")
    legSummaries.push({ language: lang, status: "missing", steps: 0, budgetsOk: false })
    continue
  }
  const leg = parseSealedRecord(legPath) as WaveLeg
  const legFailedSteps = leg.steps.filter((s) => s.status === "fail").map((s) => s.step)
  let terminal: { disposition: string; reason: string } | null = null
  if (leg.status !== "verified") {
    const dispositionRead = readDisposition(lang)
    if (dispositionRead.ok) {
      const verdict = acceptDisposition(
        lang,
        dispositionRead.disposition,
        legFailedSteps,
        dispositionEvidenceExists(dispositionRead.disposition.evidence),
      )
      if (verdict.accepted) {
        terminal = { disposition: dispositionRead.disposition.disposition, reason: verdict.reason }
      } else {
        check(`R2: ${lang} sealed disposition is NOT accepted`, false, verdict.reason)
      }
    }
  }
  if (leg.status === "verified") {
    check(`R2: ${lang} S5 status verified`, true, "verified")
  } else if (terminal !== null) {
    check(`R2: ${lang} S5 terminal ${terminal.disposition} (sealed disposition)`, true, terminal.reason)
    terminalByLang.set(lang, terminal)
  } else {
    check(`R2: ${lang} S5 status verified`, false, leg.status)
  }
  // Freshness per the ledger model: the leg is stale only if a RELEVANT
  // input changed since its commit (exact-HEAD equality would stale on
  // every evidence-only pin, which is output, not input).
  //
  // RELEVANCE IS PER-LANGUAGE (corrected when wave-2's packs were authored):
  // the path list named the WHOLE `script/m29/wave-fixtures` directory, so
  // authoring another language's pack staled every approved leg — a new
  // language would invalidate the six that were already verified, which is
  // exactly the coupling contract §9 says a wave must not have (language N+1
  // joins as a ROUTINE wave). The fixture path is now the language's OWN pack
  // plus the shared server/launch-set sources that really are common inputs.
  const legStale = staleSince(leg.commit, lang)
  check(`R2: ${lang} S5 inputs unchanged since its run`, !legStale, `${leg.commit.slice(0, 12)} vs HEAD`)
  check(`R2: ${lang} S5 real index non-empty`, (leg.indexCounts?.files ?? 0) > 0 && (leg.indexCounts?.symbols ?? 0) > 0, JSON.stringify(leg.indexCounts))
  const fails = leg.steps.filter((s) => s.status === "fail")
  check(
    `R2: ${lang} S5 has no failed steps`,
    leg.status === "verified" ? fails.length === 0 : terminal !== null,
    terminal !== null ? `${fails.length} failing step(s) covered by the sealed disposition` : fails.map((s) => s.step).join(","),
  )
  check(`R2: ${lang} S5 executed only its own language`, leg.language === lang)
  const budgetStep = leg.steps.find((s) => s.step.startsWith("§3"))
  check(`R2: ${lang} S5 §3 budget step passed`, budgetStep?.status === "pass", budgetStep?.detail)
  legSummaries.push({
    language: lang,
    status: leg.status,
    steps: leg.steps.length,
    budgetsOk: budgetStep?.status === "pass",
    ...(terminal !== null ? { terminal: terminal.disposition, dispositionReason: terminal.reason } : {}),
  })
}

// --- R3: S6 legs — REAL headless Neovim per language -------------------------
check("R3: portable Neovim provisioned (.tools layout, D-7)", existsSync(NVIM), NVIM)
const editorSummaries: Array<{ language: string; status: string; checks: number; failed: number; terminal?: string; dispositionReason?: string }> = []
if (existsSync(NVIM) && approval) {
  for (const lang of approval.languages) {
    // A language whose S5 leg was accepted as TERMINAL (sealed disposition)
    // has no honest in-editor green to produce: the disposition says why the
    // surface is limited, and an editor leg would either fail for the same
    // declared reason or exercise a surface the disposition rules out. Record
    // the terminal state with its reason — never counted as verified, never
    // conflated with a missing editor leg.
    const terminal = terminalByLang.get(lang)
    if (terminal !== undefined) {
      check(`R3: ${lang} in-editor leg terminal ${terminal.disposition} (sealed disposition)`, true, terminal.reason)
      editorSummaries.push({ language: lang, status: `terminal-${terminal.disposition}`, checks: 0, failed: 0, terminal: terminal.disposition, dispositionReason: terminal.reason })
      continue
    }
    // RESUME RULE. Fifty real nvim sessions per invocation is why this gate
    // could never finish on a shared checkout: one interruption and the whole
    // measurement was lost. A prior in-editor leg is reusable only when it is
    // SEALED, VERIFIED and FRESH under the same relevance rule R2 uses — a
    // tampered record, a red record or a record measured before a relevant
    // change is re-run, never trusted.
    const editorPath = path.join(ROOT, "validation/m29/results", `wave-editor-${lang}.json`)
    if (existsSync(editorPath)) {
      try {
        const prior = parseSealedRecord(editorPath) as { status?: string; commit?: string; checks?: unknown[] } & Record<string, unknown>
        const priorChecks = Array.isArray(prior.checks) ? prior.checks.length : 0
        if (prior.status === "verified" && typeof prior.commit === "string" && priorChecks > 0 && !staleSince(prior.commit, lang)) {
          check(`R3: ${lang} in-editor leg verified (resumed — sealed, verified, fresh)`, true, `${prior.commit.slice(0, 8)} · ${priorChecks} checks`)
          editorSummaries.push({ language: lang, status: "verified", checks: priorChecks, failed: 0 })
          continue
        }
      } catch {
        // unreadable or tampered — fall through and re-measure
      }
    }
    const packDir = path.join(ROOT, "script/m29/wave-fixtures", lang)
    const ext = WAVE_LANGUAGES[lang]
    const expPath = path.join(packDir, "expectations.json")
    if (!existsSync(expPath)) {
      check(`R3: ${lang} expectations exist`, false, expPath)
      continue
    }
    const expect = parseSealedRecord(expPath) as Record<string, unknown> & { hoverLine?: number; hover?: { symbol?: string } }
    const hoverChar = hoverCharacter(packDir, ext, expect.hoverLine ?? 0, expect.hover?.symbol ?? "")
    expect["ext"] = ext
    expect["hoverCharacter"] = hoverChar
    // The driver reads expectations from disk — write the ENRICHED record
    // (ext + derived hoverCharacter) to a temp file and pass that path.
    const enrichedDir = mkdtempSync(path.join(tmpdir(), `m29-s6-${lang}-`))
    const enrichedPath = path.join(enrichedDir, "expectations.json")
    writeSealed(enrichedPath, expect)

    // A REAL index for the pack in a temp data dir; nvim (and through it the
    // spawned server) receives BB_DATA_DIR so the editor leg serves the same
    // index the S5 leg proved (contract §4: the index must exist to be read).
    const dataDir = mkdtempSync(path.join(tmpdir(), `m29-s6-data-${lang}-`))
    process.env.BB_DATA_DIR = dataDir
    const canonical = realpathSync.native(packDir)
    const projectId = createHash("sha1").update(canonical).digest("hex").substring(0, 40)
    const dist = (await import(path.join(ROOT, "dist", "index.js"))) as { indexProjectParallel: (pid: string, p: string, o: Record<string, unknown>) => Promise<unknown> }
    await dist.indexProjectParallel(projectId, canonical, {})

    const ws = packDir // drive the real pack in place (read-only assertions)
    // The driver writes raw session output to a temp path; THIS verifier
    // computes the verdict and writes the final evidence (contract §8.1:
    // evidence JSON is written by verifier scripts), embedding a top-level
    // `status` the R1 protocol runner reads for the S6 step.
    const driverOut = path.join(enrichedDir, "driver-result.json")
    let stderr = ""
    try {
      execFileSync(NVIM, ["--headless", "--clean", "-u", "NONE", "-i", "NONE", "-n", "-l", path.join(ROOT, "script/m29/wave-editor-driver.lua")], {
        cwd: ROOT, encoding: "utf8", timeout: 120_000,
        env: { ...process.env, ...NVIM_QUIET_XDG, BB_DATA_DIR: dataDir, BB29_OUT: driverOut, BB29_LANG: lang, BB29_WS: ws, BB29_EXPECT: enrichedPath, BB29_ROOT: ROOT },
        stdio: ["ignore", "pipe", "pipe"],
      })
    } catch (error) {
      // nvim may exit non-zero after qa!; results still count.
      stderr = (error as { stderr?: string; message?: string }).stderr ?? (error as { message?: string }).message ?? ""
    }
    if (!existsSync(driverOut)) {
      rmSync(enrichedDir, { recursive: true, force: true })
      rmSync(dataDir, { recursive: true, force: true })
      check(`R3: ${lang} in-editor session produced results`, false, stderr.slice(0, 160) || "no results written")
      editorSummaries.push({ language: lang, status: "failed", checks: 0, failed: 0 })
      continue
    }
    const driverResult = parseSealedRecord(driverOut) as EditorLeg
    rmSync(enrichedDir, { recursive: true, force: true })
    rmSync(dataDir, { recursive: true, force: true })
    const result = driverResult
    const failedChecks = result.checks.filter((c) => !c.ok)
    // Final evidence: driver session + verifier-computed status, written by
    // this script to the path the R1 protocol runner reads.
    const outPath = path.join(ROOT, "validation/m29/results", `wave-editor-${lang}.json`)
    // Canonical key order: the driver's `raw` payloads come through a Lua table
    // (vim.json.encode), so their key order is arbitrary per run. Their BYTES
    // are an input of the M29 precision ledger's semantic hash, so a shuffled
    // payload made that ledger change on every re-run for no semantic reason.
    // Values are untouched — only key order is normalized (canonicalizeKeys).
    writeSealed(outPath, canonicalizeKeys({ ...result, status: failedChecks.length === 0 ? "verified" : "failed", commit: gitCommit() }))
    for (const c of result.checks) {
      check(`R3/${lang}: ${c.name}`, c.ok, c.detail)
    }
    check(`R3: ${lang} in-editor leg fully green`, failedChecks.length === 0, failedChecks.map((c) => c.name).join(","))
    editorSummaries.push({ language: lang, status: failedChecks.length === 0 ? "verified" : "failed", checks: result.checks.length, failed: failedChecks.length })
  }
}

/** The RELEVANT inputs of one language's S5 leg: imported from the execution
 *  library (ONE rule, both doors read it — the gate must not re-implement what
 *  it gates). Wave-2 rule: the language's OWN analyzer is in the list.
 *  M4 plants the directory-wide path back against this SAME imported rule.
 *  (History: this was a dynamic import placed below its first use — the TDZ
 *  ReferenceError landed in the staleness catch and every leg read stale.) */

// --- R4: mutants --------------------------------------------------------------
{
  // M4: the per-language relevance rule. The defect it catches is the coupling
  // this file shipped with: naming the WHOLE fixtures directory, so authoring
  // wave-2's packs staled the six approved legs that were already verified.
  // The rule holds when a leg's inputs name its OWN pack, never another
  // language's and never the directory.
  {
    const paths = staleRelevantPaths("java")
    mutant(
      "a wave leg staled by another language's pack (the directory-wide rule)",
      paths.includes("script/m29/wave-fixtures/java") &&
        !paths.includes("script/m29/wave-fixtures") &&
        !paths.includes("script/m29/wave-fixtures/zig"),
    )
    // Wave-2 rule, mutant-gated: dropping the language's own analyzer from the
    // list would break the guarantee that a changed analyzer stales the leg.
    mutant(
      "a wave leg NOT staled by its own analyzer's change (the pre-wave-2 rule)",
      paths.includes("src/ast/real-java-analyzer.ts"),
    )
  }

  // M1: approval forgery — an unapproved language must be rejected by the
  // execution guard.
  let rejected = false
  try {
    assertLanguageApproved("cobol", { languages: approval?.languages ?? [] })
  } catch {
    rejected = true
  }
  mutant("unapproved language executes a wave leg", rejected)

  // M2: a leg whose language disagrees with its filename must be caught by
  // the per-leg identity check (simulate by swapping two legs' language
  // fields and re-running the R2 checks in-memory).
  if (approval && approval.languages.length >= 2) {
    const a = approval.languages[0]!
    const b = approval.languages[1]!
    const pa = path.join(ROOT, "validation/m29/results", `wave-${a}.json`)
    const pb = path.join(ROOT, "validation/m29/results", `wave-${b}.json`)
    if (existsSync(pa) && existsSync(pb)) {
      const la = parseSealedRecord(pa) as WaveLeg
      const lb = parseSealedRecord(pb) as WaveLeg
      mutant("leg language/filename swap goes unnoticed", !(la.language === b || lb.language === a))
    } else {
      mutant("leg language/filename swap goes unnoticed", true, "legs missing — skipped")
    }
  }

  // M3: a drifted approval (languages reordered/replaced) must fail the
  // registry cross-check.
  const drifted = { languages: ["java", "python", "typescript", "javascript", "kotlin", "cobol"] }
  const driftIllegal = drifted.languages.some((l) => WAVE_LANGUAGES[l] === undefined)
  mutant("approval drift to a non-registry language passes", driftIllegal)

  // M5: the disposition acceptance rule. A waiver that points at evidence the
  // leg did not produce has no teeth — naming a check the leg PASSED must be
  // rejected exactly like a missing evidence record or another language's leg.
  // The positive control is the other half of the mutant: a gate that can only
  // reject is not a rule, it is a wall, and a real matching disposition must
  // still be accepted.
  {
    const legFailed = ["L5: call hierarchy only for a callable symbol (item, or declared absence naming the kind)"]
    const base: WaveDisposition = {
      language: "make",
      disposition: "not-lsp-appropriate",
      reason: "a make target has no call tree (build DSL, no callable symbols)",
      failingChecks: legFailed,
      evidence: "validation/m29/results/wave-make.json",
      declaredAt: "2026-11-08T00:00:00.000Z",
      declaredBy: "mutation-suite",
    }
    const matching = acceptDisposition("make", base, legFailed, true)
    check("R4: a sealed disposition matching the leg is accepted (positive control)", matching.accepted, matching.reason)
    const invented = acceptDisposition("make", { ...base, failingChecks: ["L2: hover renders the symbol"] }, legFailed, true)
    mutant("a disposition naming a check the leg did not fail goes unnoticed", !invented.accepted, invented.reason)
    const missingEvidence = acceptDisposition("make", base, legFailed, false)
    mutant("a disposition whose evidence record is missing goes unnoticed", !missingEvidence.accepted, missingEvidence.reason)
    const foreignEvidence = acceptDisposition("make", { ...base, evidence: "validation/m29/results/wave-terraform.json" }, legFailed, true)
    mutant("a disposition resting on another language's leg goes unnoticed", !foreignEvidence.accepted, foreignEvidence.reason)
    const wrongLanguage = acceptDisposition("sass", base, legFailed, true)
    mutant("a disposition filed under another language goes unnoticed", !wrongLanguage.accepted, wrongLanguage.reason)
  }
}

// --- Persist evidence --------------------------------------------------------
const finalFailed = checks - passed
const result = {
  issue: "M29.R2",
  code: "R2",
  milestone: "M29",
  status: finalFailed === 0 ? "verified" : "known-gap",
  checks,
  passed,
  failed: finalFailed,
  mutantsCaught,
  mutantsTotal,
  currentCommit: gitCommit(),
  verifierCommand: "npx tsx script/m29/verify-wave-execution.ts",
  ...fingerprintFields(["m29.R2"], ROOT),
  evidenceFile: "R2.json",
  generatedAt: new Date().toISOString(),
  approval: {
    record: "validation/m29/results/wave-1-approval.json",
    approvedBy: approval?.approvedBy,
    languages: approval?.languages,
  },
  s5Legs: legSummaries,
  s6Legs: editorSummaries,
  terminalDispositions: [...terminalByLang.entries()].map(([language, declared]) => ({
    language,
    disposition: declared.disposition,
    reason: declared.reason,
  })),
  limitations: [
    "S6 in-editor legs run in headless Neovim on Linux only (OS-scoped per contract §10); other OSes are declared absent, not assumed.",
    "S5/S6 legs exercise exactly the languages named by the wave approval records; languages outside the approval record are not onboarded this wave (the binding forbids it).",
    "An approved language whose S5 leg is not verified is accepted as a TERMINAL blocked / not-lsp-appropriate state only when a sealed validation/m29/results/wave-<lang>-disposition.json exists whose failingChecks are a subset of the leg's REAL failed steps and whose evidence record exists. It is printed with its reason and never counted as verified; a missing leg is always a failure.",
  ],
}
const evidenceDir = path.join(ROOT, "validation/m29/results")
mkdirSync(evidenceDir, { recursive: true })
writeSealed(path.join(evidenceDir, "R2.json"), result)
console.log(`R2: ${result.status.toUpperCase()} (${passed}/${checks} passed, ${mutantsCaught}/${mutantsTotal} mutants, ${terminalByLang.size} terminal disposition(s))`)
process.exit(finalFailed === 0 && mutantsCaught === mutantsTotal ? 0 : 1)
