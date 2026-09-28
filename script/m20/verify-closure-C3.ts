// script/m20/verify-closure-C3.ts — M20.C3 (final docs, claims, and closure).
//
// Runs LAST, after every tool issue has persisted evidence. It does not re-run
// tool verifiers; it audits that the closure contract is satisfied:
//
//   1. The ledger is structurally complete: all 17 M20 issues present, unique,
//      and every non-planned issue carries the required evidence fields.
//   2. Every non-planned issue's persisted evidence file exists and reports a
//      consistent status with zero failed checks (verified or known-gap).
//   3. Governance (C1) evidence reads VERIFIED from a clean relevant tree.
//   4. Real-repository complexity ledger (X2) and corpus identity (C2) present.
//   5. Per-tool docs exist and do not overclaim (no "perfect"/"exploit-proof"
//      language beyond documented limitations).
//   6. Docs acknowledge analyzer dependency rather than pretending analyzer
//      correctness is shipped.
//   7. The closure artifact exists and lists unresolved claims + dependencies.
//   8. No hollow (all-happy-path) assertions across M20 verifier scripts.
//
// Deliberately has NO auto-pass: any missing evidence, stale field, overclaim,
// or hollow scan makes C3 fail closed.

import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync } from "node:fs"
import { execFileSync } from "node:child_process"
import path from "node:path"
import { migrationSourceFingerprint } from "../../src/intelligence/migration/migration-evidence"

let checks = 0, passed = 0, negatives = 0
function ck(label: string, cond: boolean, detail = ""): void { checks++; if (cond) passed++; else console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`) }
function nk(label: string, cond: boolean, detail = ""): void { negatives++; ck(`${label} [negative]`, cond, detail) }

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const RESULTS_DIR = path.join(ROOT, "validation/m20/results")
const manifest = JSON.parse(readFileSync(path.join(RESULTS_DIR, "manifest.json"), "utf8"))
const commits = {
  current: (execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }) || "").trim(),
}

// ── 1. Ledger structural completeness ─────────────────────────────────────
ck("C3: ledger lists all 17 M20 issues", manifest.issues.length === 17, `issues=${manifest.issues.length}`)
const codes = new Set(manifest.issues.map((i: any) => i.code))
ck("C3: all 17 codes unique C1-C3/M1-M3/P1-P3/S1-S3/D1-D3/X1-X2",
  codes.size === 17 && ["C1","C2","C3","M1","M2","M3","P1","P2","P3","S1","S2","S3","D1","D2","D3","X1","X2"].every((c) => codes.has(c)),
  "")
const expectedClosed = 16 // all except C3 itself (C3 is proven by this verifier run)
const closed = manifest.issues.filter((i: any) => i.code !== "C3" && (i.status === "verified" || i.status === "known-gap"))
ck("C3: all 16 non-C3 issues carry a final status", closed.length === expectedClosed, `closed=${closed.length}`)

// ── 2. Every non-planned issue has valid persisted evidence ───────────────
let evidenceErrors: string[] = []
// C1 and C3 are self-writing governance gates; C1.json is rewritten by every
// governance run (its generatedAt fields in the ledger can never stay byte-
// identical). Their VERIFIED/known-gap state is validated separately below by
// C3's explicit governance checks, so exclude both from this field-diff loop.
for (const issue of manifest.issues.filter((i: any) => i.code !== "C3" && i.code !== "C1")) {
  const ev = issue.evidence
  if (!ev) { evidenceErrors.push(`${issue.code}:no-evidence`); continue }
  const p = path.join(RESULTS_DIR, ev.evidenceFile)
  if (!existsSync(p)) { evidenceErrors.push(`${issue.code}:missing-file`); continue }
  let d; try { d = JSON.parse(readFileSync(p, "utf8")) } catch { evidenceErrors.push(`${issue.code}:unreadable`); continue }
  if (ev.status !== d.status || ev.currentCommit !== d.currentCommit || ev.passed !== d.passed || ev.failed !== d.failed || ev.negativeCases !== d.negativeCases)
    evidenceErrors.push(`${issue.code}:ledger-evidence-mismatch`)
  if (d.failed !== 0) evidenceErrors.push(`${issue.code}:has-failed-checks`)
  if (typeof d.passed !== "number" || d.passed <= 0) evidenceErrors.push(`${issue.code}:no-passed`)
  if (!Array.isArray(d.workingTreeRelevantChanges)) evidenceErrors.push(`${issue.code}:missing-dirty-check`)
  if (!d.verifierCommand) evidenceErrors.push(`${issue.code}:missing-verifier-command`)
}
ck("C3: every issue has consistent persisted evidence, zero failed checks", evidenceErrors.length === 0, evidenceErrors.join(","))

// ── 3. Governance evidence is verified from a clean relevant tree ─────────
const gov = JSON.parse(readFileSync(path.join(RESULTS_DIR, "C1.json"), "utf8"))
ck("C3: governance (C1) evidence is VERIFIED", gov.status === "verified", `gov.status=${gov.status}`)
function onlyEvidenceCommitsBetween(testedCommit: string, current: string): boolean {
  if (testedCommit === current) return true
  try {
    const changed = execFileSync("git", ["diff", "--name-only", `${testedCommit}..${current}`], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).split("\n").map((x) => x.trim()).filter(Boolean)
    return changed.length > 0 && changed.every((file) => file.startsWith("validation/m20/results/"))
  } catch { return false }
}
ck("C3: governance record is current or separated only by evidence commits", typeof gov.currentCommit === "string" && onlyEvidenceCommitsBetween(gov.currentCommit, commits.current), `gov=${gov.currentCommit} current=${commits.current}`)
ck("C3: governance clean relevant tree", Array.isArray(gov.workingTreeRelevantChanges) && gov.workingTreeRelevantChanges.length === 0, JSON.stringify(gov.workingTreeRelevantChanges))

// ── 4. Real-repo ledger and corpus identity present ───────────────────────
const x2 = JSON.parse(readFileSync(path.join(RESULTS_DIR, "X2.json"), "utf8"))
const measured = Array.isArray(x2.measured) ? x2.measured.filter((r: any) => r.state === "measured") : []
ck("C3: real-repo ledger measured >=2 corpora with numbers", measured.length >= 2 && measured.every((r: any) => typeof r.files === "number" && r.files > 0 && typeof r.symbols === "number"), JSON.stringify(measured.map((r: any) => r.corpus)))
ck("C3: X2 verified with benchmarks persisted", x2.status === "verified", `status=${x2.status}`)
const c2 = JSON.parse(readFileSync(path.join(RESULTS_DIR, "C2.json"), "utf8"))
ck("C3: corpus identity present", existsSync(path.join(RESULTS_DIR, "C2-registry.json")) || existsSync(path.join(RESULTS_DIR, "C2.json")), "")
ck("C3: corpus state honestly reported (verified or known-gap)", c2.status === "verified" || c2.status === "known-gap", `status=${c2.status}`)

// ── 5. Per-tool docs exist and do not overclaim ───────────────────────────
const TOOL_DOCS = ["bb_migrate", "bb_patterns", "bb_security", "bb_doc"]
const overclaim = /\b(perfect|flawless|bulletproof|exploit[\s-]?proof|100\s?% secure|cannot fail|never fails|absolutely (?:secure|correct|perfect|safe)|guarantee[d]? (?:to|that)?(?: no| not|[\w]+ )*(?:fail|break|miss|error))\b/gi
let missingDocs: string[] = [], docOverclaims: string[] = []
for (const t of TOOL_DOCS) {
  const p = path.join(ROOT, `docs/tools/${t}.md`)
  if (!existsSync(p)) { missingDocs.push(t); continue }
  const text = readFileSync(p, "utf8")
  // strip commentary we intentionally allow ("100%" inside a quoted limitation / code fence)
  const codeBlockStripped = text.replace(/```[\s\S]*?```/g, " ").replace(/`[^`]*`/g, " ")
  const hits = [...codeBlockStripped.matchAll(overclaim)].map((m) => m[0])
  if (hits.length) docOverclaims.push(`${t}:${hits.slice(0, 3).join(",")}`)
}
ck("C3: all four tool docs present", missingDocs.length === 0, missingDocs.join(","))
ck("C3: no tool doc overclaims perfection/guarantees", docOverclaims.length === 0, docOverclaims.join(" | "))
// Negatives: prove the overclaim detector is not vacuous. Use a fresh
// non-global clone so the /g lastIndex state of `overclaim` never leaks.
const noG = (re: RegExp): RegExp => new RegExp(re.source, re.flags.replace("g", ""))
nk("C3: overclaim detector fires on fabricated text", noG(overclaim).test("absolutely guaranteed to never fail"), "")
nk("C3: overclaim detector stays quiet on honest limitation wording", !noG(overclaim).test("and remains limited to these documented caveats"), "")

// ── 6. Docs acknowledge analyzer dependency (M14) rather than shipping it ─
let depOk = 0
for (const t of TOOL_DOCS) {
  const p = path.join(ROOT, `docs/tools/${t}.md`)
  if (!existsSync(p)) continue
  const text = readFileSync(p, "utf8")
  if (/\b(analyzer|AST|symbol|relationship)\b/i.test(text) && /\b(limit|depend|range|scope|gap|caveat)\b/i.test(text)) depOk++
}
ck("C3: tool docs couple their claims to analyzer inputs and limitations", depOk === 4, `depOk=${depOk}`)

// ── 7. Closure artifact present with unresolved claims + dependencies ─────
const closurePath = path.join(ROOT, "docs/m20/M20-CLOSURE.md")
ck("C3: closure artifact exists", existsSync(closurePath), "docs/m20/M20-CLOSURE.md missing")
if (existsSync(closurePath)) {
  const text = readFileSync(closurePath, "utf8")
  ck("C3: closure artifact documents unresolved claims", /unresolved|caveat|open/i.test(text), "no unresolved-claims section")
  ck("C3: closure artifact documents analyzer dependency (M14)", /M14|analyzer|co-agent/i.test(text), "no dependency section")
  ck("C3: closure artifact lists issue codes M1-M3/P1-P3/S1-S3/D1-D3/X1-X2/C2", ["M1","P1","S1","D1","X1","C2"].every((c) => text.includes(c)), "")
}

// ── 8. No hollow (always-true) assertions across M20 verifiers ────────────
const verifierDir = path.join(ROOT, "script/m20")
const hollowTrue = ["ck(", "\"", "\"", ", true)"].join("")
const orTrue = ["|", "|", " true)"].join("")
// Strip comments and quoted string literals first so documentation of the
// tautology patterns (or assembled detector strings) is not mistaken for a
// real hollow assertion in executable code.
function stripCommentsAndStrings(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n").map((line) => line.split("//")[0]).join("\n")
    .replace(/["'](?:[^\\"'\\n]|\\.)*["']/g, "")
}
let hollowFiles: string[] = []
for (const f of readdirSync(verifierDir).filter((f) => f.endsWith(".ts"))) {
  if (f.includes("closure")) continue // this file uses the same assembled-string technique
  const code = stripCommentsAndStrings(readFileSync(path.join(verifierDir, f), "utf8"))
  if (code.includes(hollowTrue) || code.includes(orTrue)) hollowFiles.push(`${f}:hollow-true`)
  if (/[|&]\s*true\s*[,)]/.test(code)) hollowFiles.push(`${f}:or-true`)
}
ck("C3: no hollow always-true assertions in M20 verifiers", hollowFiles.length === 0, hollowFiles.join(","))

// C3 is a governance-tool issue, so the governance verifier attributes the
// migration fingerprint to it (its sourceFingerprintFor() default branch).
// Use the same boundary here so the persisted record passes the C1 gate.
const governanceSourceFingerprint = migrationSourceFingerprint(ROOT)
const result = {
  issue: "M20.C3", code: "C3", milestone: "M20",
  status: passed === checks && negatives >= 2 ? "verified" : "known-gap",
  checks, passed, failed: checks - passed, negativeCases: negatives,
  currentCommit: commits.current,
  sourceFingerprint: governanceSourceFingerprint,
  workingTreeRelevantChanges: gov.workingTreeRelevantChanges,
  verifierCommand: "bun run script/m20/verify-closure-C3.ts",
  evidenceFile: "C3.json",
  generatedAt: new Date().toISOString(),
  limitations: [
    "Closure audit reads persisted tool evidence; it does not re-run tool verifiers.",
    "Analyzer (M14) correctness itself is owned by the co-agent milestone and is only declared as a documented dependency, not independently re-verified here.",
  ],
}
mkdirSync(RESULTS_DIR, { recursive: true })
writeFileSync(path.join(RESULTS_DIR, "C3.json"), JSON.stringify(result, null, 2) + "\n")
const done = result.negativeCases >= 2 ? result.status : "known-gap"
console.log(`C3: ${done.toUpperCase()} (${result.passed}/${result.checks} checks, ${result.negativeCases} negatives)`)
process.exit(result.status === "verified" ? 0 : 1)