// script/m29/generate-precision-ledger.ts — M29.R4 (issue #539): the precision
// ledger generator.
//
// The ledger is GENERATED from evidence files — never hand-written. Every
// number traces to a persisted evidence file (path recorded in the artifact);
// claim levels come from the R1 protocol's computeCap (one owner of the
// binding); nothing here infers or aspires. Drift gate:
// script/m29/verify-precision-ledger.ts requires byte-identical regeneration —
// a hand edit to either artifact fails the gate until it is regenerated.
//
// Staleness policy (declared, enforced by the drift gate): the ledger is stale
// the moment any input evidence file changes; the gate's content hash of the
// inputs is recorded in the artifacts, so any edit or re-run upstream is
// detected. Regenerate with:
//   npx tsx script/m29/generate-precision-ledger.ts --write
//
// Outputs:
//   validation/m29/results/PRECISION-LEDGER.json  (machine-readable)
//   docs/m29/PRECISION-LEDGER.md                  (published table)
//
// Evidence: validation/m29/results/R4.json (generator run record)

import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { execFileSync } from "node:child_process"
import path from "node:path"
import { createHash } from "node:crypto"
import { computeCap, analyzerConformance, type SpecLedger, type Step } from "./wave-protocol.ts"
import { writeSealed } from "../lib/evidence.ts"
import { parseSealedRecord } from "../lib/evidence.ts"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const OUT_JSON = path.join(ROOT, "validation/m29/results/PRECISION-LEDGER.json")
const OUT_MD = path.join(ROOT, "docs/m29/PRECISION-LEDGER.md")
const APPROVAL = path.join(ROOT, "validation/m29/results/wave-1-approval.json")
const R3 = path.join(ROOT, "validation/m29/results/R3.json")

interface WaveS5 {
  language: string
  status: string
  steps: Array<{ step: string; status: string; detail?: string }>
  measurements: Array<{ op: string; p95WarmMs: number; samples: number }>
  budgetViolations: string[]
  commit: string
  generatedAt: string
}
interface WaveS6 {
  language: string
  status: string
  checks: Array<{ name: string; ok: boolean }>
  commit: string
}

function gitCommit(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
  } catch {
    return "unknown"
  }
}

// The owner-approved wave-1 set is the ledger's row set (authority: the
// approval record; languages are added here ONLY via a recorded wave).
function approvedLanguages(): string[] {
  const a = parseSealedRecord(APPROVAL) as { languages: string[] }
  return a.languages
}

// Per-language rows — all fields derived, nothing decorative.
function languageRow(lang: string, spec: SpecLedger): Record<string, unknown> {
  const s5Path = `validation/m29/results/wave-${lang}.json`
  const s6Path = `validation/m29/results/wave-editor-${lang}.json`
  if (!existsSync(path.join(ROOT, s5Path))) {
    return { language: lang, claim: "I0", conformance: analyzerConformance(spec, lang), evidence: { s5: s5Path, s5Present: false }, limitations: ["S5 evidence missing — claim capped at I0 (declared absence, never assumed)"] }
  }
  const s5 = JSON.parse(readFileSync(path.join(ROOT, s5Path), "utf8")) as WaveS5
  // S6 is optional at claim time: computeCap says I2 without it, I3 with it.
  const s6 = existsSync(path.join(ROOT, s6Path)) ? (JSON.parse(readFileSync(path.join(ROOT, s6Path), "utf8")) as WaveS6) : null

  // The claim level: computeCap over steps derived from RECORDED evidence
  // only — one owner (computeCap), no re-derivation drift:
  //   S1  pure from the #419 SPEC ledger (M14's committed evidence)
  //   S2/S3  the M24 component gates' persisted evidence (P1/P2) at this tree
  //   S4/S5  the language's own S5 execution record (R2's verifier gated it)
  //   S6  the recorded in-editor evidence file (R2's S6 leg)
  const conformance = analyzerConformance(spec, lang)
  const gateEvidence = (file: string): boolean => {
    try {
      return (JSON.parse(readFileSync(path.join(ROOT, file), "utf8")) as { status?: string }).status === "verified"
    } catch {
      return false
    }
  }
  const s5ok = s5.status === "verified"
  const s6ok = !!s6 && s6.status === "verified" && (s6.checks?.every((c) => c.ok) ?? false)
  const steps: Step[] = [
    { step: "S1-analyzer-conformance", status: conformance.conformant ? "pass" : "fail", detail: conformance.reason },
    { step: "S2-position-gate", status: gateEvidence("validation/m24/results/P1.json") ? "pass" : "fail", detail: "persisted P1 evidence status" },
    { step: "S3-freshness-gate", status: gateEvidence("validation/m24/results/P2.json") ? "pass" : "fail", detail: "persisted P2 evidence status" },
    { step: "S4-real-index", status: s5.steps.find((s) => s.step === "S4-real-index")?.status === "pass" ? "pass" : "fail", detail: "recorded S4 step" },
    { step: "S5-server-leg", status: s5ok ? "pass" : "fail", detail: `recorded S5 status: ${s5.status}` },
    { step: "S6-editor-leg", status: s6 ? (s6ok ? "pass" : "fail") : "blocked", detail: s6 ? `recorded S6 status: ${s6.status}` : "no S6 evidence file recorded" },
  ]
  const claim = computeCap(steps)

  // Per-feature truth from the recorded step names (the S5 gate's own checks).
  const feature = (needle: string): boolean => s5.steps.some((s) => s.step.startsWith(needle) && s.status === "pass")
  const features = {
    capabilities: feature("L1:"),
    hover: feature("L2: hover renders"),
    evidenceTier: feature("L2: hover carries"),
    definition: feature("L3: definition"),
    references: feature("L3: references"),
    documentSymbols: feature("L4: documentSymbols"),
    workspaceSymbol: feature("L4: workspace"),
    declaredAbsence: feature("L4: absence"),
    callHierarchy: feature("L5:"),
    latencyBudget: feature("§3:"),
  }

  const warmP95: Record<string, number> = {}
  for (const m of s5.measurements) warmP95[m.op] = Math.round(m.p95WarmMs * 100) / 100

  // Analyzer-layer precision facts from the #419 SPEC ledger (M14 owns these
  // numbers; this ledger publishes them with the section as provenance).
  const specEntry = spec.data.languages[lang]
  const secDetail = (name: string): string => specEntry?.sections?.[name]?.detail ?? ""
  const diff = secDetail("section-e-differential")
  const perf = secDetail("section-f-perf-budget")
  const tiers = secDetail("section-d-evidence-tiers")
  const dm = /missing=(\d+)/.exec(diff)?.[1] ?? null
  const du = /unexplained=(\d+)/.exec(diff)?.[1] ?? null
  const floor = /^floor ([^:]+):/.exec(diff)?.[1] ?? null
  const msPerFile = /([\d.]+) ms\/file/.exec(perf)?.[1] ?? null
  const tierCount = /^(\d+) tier/.exec(tiers)?.[1] ?? null

  return {
    language: lang,
    claim,
    conformance: { conformant: conformance.conformant, detail: conformance.reason },
    features,
    latency: { warmP95Ms: warmP95, budgetViolations: s5.budgetViolations },
    analyzerPrecision: {
      differentialFloor: floor,
      differentialMissing: dm === null ? null : Number(dm),
      differentialUnexplained: du === null ? null : Number(du),
      msPerFile: msPerFile === null ? null : Number(msPerFile),
      evidenceTiersPinned: tierCount === null ? null : Number(tierCount),
      source: "validation/m14/results/M14.0.SPEC.json (sections e/f/d — M14's evidence, published here)",
    },
    evidence: {
      s5: { path: s5Path, commit: s5.commit, generatedAt: s5.generatedAt, status: s5.status },
      s6: s6 ? { path: s6Path, commit: s6.commit, status: s6.status } : { path: s6Path, present: false },
    },
    limitations: s5.budgetViolations.length > 0 ? [`budget violations recorded: ${s5.budgetViolations.join("; ")}`] : [],
  }
}

// --- Declared volatile fields in the input evidence --------------------------
//
// The ledger's inputs are EVIDENCE RECORDS, and a record correctly carries the
// metadata of the run that produced it: the commit it ran at, the generation
// time, and its seal. Those fields change on EVERY re-run even when nothing
// semantic changed — and this ledger's drift gate is byte-identical
// regeneration, so hashing raw bytes would make the gate un-passable after any
// upstream re-run while reporting "stale" for a ledger that is not stale.
//
// The fix is a declared exclusion, not a weakened gate: the hash is taken over
// the PARSED record with exactly these fields removed. Every semantic field
// still participates (a changed claim, check, measurement, status, or a
// re-shaped record all change the hash), which the R4 gate now proves in both
// directions (G2: a volatile field is ignored; M5: a semantic field is not).
const VOLATILE_FIELDS = new Set([
  "commit",
  "currentCommit",
  "generatedAt",
  "bbSeal",
  "workingTreeRelevantChanges",
])

/** Exported for the R4 gate's two-direction proof (volatile ignored, semantic
 *  honored). The gate must not be able to widen this exclusion silently. */
export function normalizeEvidence(value: unknown): unknown {
  return dropVolatile(value)
}

function dropVolatile(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(dropVolatile)
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (VOLATILE_FIELDS.has(k)) continue
      out[k] = dropVolatile(v)
    }
    return out
  }
  return value
}

/** The bytes the hash is taken over for one declared input: raw for source
 *  files, volatile-normalized for JSON evidence (unparseable JSON falls back to
 *  raw so a corrupt record still drifts). */
function hashInputBytes(rel: string): string | null {
  const p = path.join(ROOT, rel)
  if (!existsSync(p)) return null
  if (!rel.endsWith(".json")) return readFileSync(p, "utf8")
  const raw = readFileSync(p, "utf8")
  try {
    return JSON.stringify(dropVolatile(JSON.parse(raw)))
  } catch {
    return raw
  }
}

export function hashInputs(inputs: string[]): string {
  const h = createHash("sha256")
  for (const rel of inputs) {
    const bytes = hashInputBytes(rel)
    if (bytes === null) continue
    h.update(rel, "utf8")
    h.update(bytes)
  }
  return h.digest("hex").substring(0, 40)
}

export function buildLedger(): { json: string; md: string; inputsHash: string } {
  const spec = JSON.parse(readFileSync(path.join(ROOT, "validation/m14/results/M14.0.SPEC.json"), "utf8")) as SpecLedger
  const languages = approvedLanguages()
  const rows = languages.map((l) => languageRow(l, spec))

  // Giant-scale row from R3 (scale regime — separate from per-language S5).
  let giant: Record<string, unknown> = { present: false, note: "R3.json missing — no scale row published" }
  if (existsSync(R3)) {
    const r3 = parseSealedRecord(R3) as any
    if (r3?.status === "verified") {
      giant = {
        present: true,
        corpus: { kind: r3.corpus.kind, revision: r3.corpus.corpusRevision, files: r3.corpus.indexedFiles },
        hoverP95Ms: Math.round((r3.budgets.serverLevel.measurements.find((m: any) => m.op === "hover")?.p95WarmMs ?? 0) * 100) / 100,
        inEditorHoverP95Ms: Math.round((r3.budgets.inEditor.measurements?.find((m: any) => m.op === "hover")?.p95WarmMs ?? 0) * 100) / 100,
        coldMedianMs: r3.budgets.coldStart.medianMs,
        // M29.R5: the evidence-tier precision improvement, measured on the
        // same index (F7: fixture-first fix, permanent mutant in the gate).
        tierRatio: r3.budgets.tierRatio
          ? {
              totalRelationships: r3.budgets.tierRatio.totalRelationships,
              inferredRatioBeforePct: r3.budgets.tierRatio.inferredRatioBeforePct,
              inferredRatioAfterPct: r3.budgets.tierRatio.inferredRatioAfterPct,
              fix: "hover honors stored metadata.evidenceClass + structural set at the W4 0.7 floor (script/m29/r5-tier-fixture.ts, mutant-gated)",
            }
          : null,
        evidence: "validation/m29/results/R3.json",
      }
    } else {
      giant = { present: false, note: `R3 status ${r3?.status} — scale row withheld (honest)` }
    }
  }

  // Inputs hash: any change to the evidence set invalidates the artifacts.
  const INPUTS = [
    ...languages.map((l) => `validation/m29/results/wave-${l}.json`),
    ...languages.map((l) => `validation/m29/results/wave-editor-${l}.json`),
    "validation/m14/results/M14.0.SPEC.json",
    "validation/m29/results/wave-1-approval.json",
    "validation/m29/results/R3.json",
    "script/m29/wave-protocol.ts",
    "script/m29/generate-precision-ledger.ts",
  ]
  const inputsHash = hashInputs(INPUTS)

  const doc = {
    milestone: "M29.R4",
    issue: 539,
    generatedBy: "npx tsx script/m29/generate-precision-ledger.ts --write",
    // NOTE: no wall-clock timestamp and no commit in the artifacts —
    // byte-identical regeneration is the drift gate, so the artifacts are
    // purely content-derived (inputsHash). The run record (R4.json) carries
    // the generation time and commit.
    inputsHash,
    inputs: INPUTS,
    languages: rows,
    giantScale: giant,
    stalenessPolicy: "This ledger is machine-regenerated. Any change to the SEMANTIC content of the input evidence (hash above) makes the artifacts stale; the drift gate (script/m29/verify-precision-ledger.ts) fails until regeneration. Declared volatile run metadata is excluded from the hash (commit, currentCommit, generatedAt, bbSeal, workingTreeRelevantChanges) because it changes on every re-run while the evidence itself does not — including it would make byte-identical regeneration un-passable. Hand edits fail byte-identical regeneration. Claim levels are computed by the R1 binding (computeCap) from recorded evidence — they cannot be edited up.",
    limitations: [
      "Differential floors are M14's committed baselines (named repo per language), not the full ecosystem — the numbers are floors, not upper bounds.",
      "Per-language warm p95 is measured over the wave fixture pack (real index, real server), not over giant-scale workspaces; the scale row (R3) covers the giant regime separately.",
      "Wave-1 covers the six owner-approved languages; all other analyzers onboard in later waves after M37/M14 (owner decision recorded).",
    ],
  }
  const json = JSON.stringify(doc, null, 2) + "\n"

  // The published markdown — a faithful rendering of the JSON (regenerated
  // together; the gate requires byte-identical equality with both).
  const md: string[] = []
  md.push("# Precision ledger — bb_lsp per-language, per-feature truth (M29.R4)\n")
  md.push(`Inputs hash \`${inputsHash}\` (deterministic: byte-identical regeneration is the drift gate. The hash covers the evidence's semantic content; declared volatile run metadata — commit, generation time, seal — is excluded, so an upstream re-run does not report a false "stale". Run record with commit + timestamp lives in validation/m29/results/R4.json).\n`)
  md.push("> This document is **generated** from evidence files. A hand edit breaks the drift gate (`script/m29/verify-precision-ledger.ts`). Claim levels are computed by the R1 binding from recorded evidence — they cannot be edited up. Staleness policy: any input-evidence change makes this stale until regenerated.\n")
  md.push("| language | claim | conformance | hover | tier | def | refs | docSym | wsSym | absence | callHier | budget | diff missing/unexplained | ms/file | tiers |")
  md.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |")
  for (const r of rows as any[]) {
    const f = r.features ?? {}
    const ap = r.analyzerPrecision ?? {}
    const cell = (b: unknown): string => (b === true ? "✅" : b === false ? "—" : "?")
    md.push(`| ${r.language} | ${r.claim} | ${r.conformance?.conformant ? "pass" : "FAIL"} | ${cell(f.hover)} | ${cell(f.evidenceTier)} | ${cell(f.definition)} | ${cell(f.references)} | ${cell(f.documentSymbols)} | ${cell(f.workspaceSymbol)} | ${cell(f.declaredAbsence)} | ${cell(f.callHierarchy)} | ${cell(f.latencyBudget)} | ${ap.differentialMissing ?? "?"}/${ap.differentialUnexplained ?? "?"} | ${ap.msPerFile ?? "?"} | ${ap.evidenceTiersPinned ?? "?"} |`)
  }
  md.push("")
  md.push(`**Giant scale (R3):** ${giant.present ? `hover p95 ${(giant as any).hoverP95Ms}ms over ${(giant as any).corpus.files} files (revision ${(giant as any).corpus.revision}); in-editor ${(giant as any).inEditorHoverP95Ms}ms; cold median ${(giant as any).coldMedianMs}ms${(giant as any).tierRatio ? `; evidence-tier inferred ratio ${(giant as any).tierRatio.inferredRatioBeforePct}% -> ${(giant as any).tierRatio.inferredRatioAfterPct}% (R5 fix, mutant-gated)` : ""}` : String((giant as any).note)}. Evidence: validation/m29/results/R3.json.`)
  md.push("")
  md.push("## Limitations (declared)\n")
  for (const l of doc.limitations) md.push(`- ${l}`)
  md.push("")
  md.push("## Evidence paths\n")
  for (const r of rows as any[]) {
    md.push(`- ${r.language}: S5 ${r.evidence.s5.path}${r.evidence.s6?.present ? `, S6 ${r.evidence.s6.path}` : ", S6 absent (declared)"}`)
  }
  md.push("")
  return { json, md: md.join("\n") + "\n", inputsHash }
}

// CLI entry.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const { json, md, inputsHash } = buildLedger()
  if (process.argv.includes("--write")) {
    writeFileSync(OUT_JSON, json)
    writeFileSync(OUT_MD, md)
    void new Date().toISOString
    const result = {
      status: "written",
      artifacts: ["validation/m29/results/PRECISION-LEDGER.json", "docs/m29/PRECISION-LEDGER.md"],
      inputsHash,
      commit: gitCommit(),
      generatedAt: new Date().toISOString(),
    }
    writeSealed(path.join(ROOT, "validation/m29/results/R4.json"), result)
    console.log(`R4: ledger written (inputsHash ${inputsHash.slice(0, 10)})`)
  } else {
    console.log(json)
  }
}
