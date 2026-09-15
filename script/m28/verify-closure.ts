// script/m28/verify-closure.ts — M28.X1 closure gate (issue #629).
//
// Final gate for The Union milestone:
//   Pass 1  full M28 suite re-run at current HEAD (every verifier exits 0)
//   Pass 2  per-mutant records: named, from the pass-1 runs, cross-checked
//           against each evidence file's aggregate counts
//   Pass 3  v4 completion-bar audit at HEAD (master plan items 1-4) with
//           negative probes — the audit fires on forged bar claims
//   Pass 4  byte-identical regeneration (modulo declared volatile fields)
//
// Run: npx tsx script/m28/verify-closure.ts
// Evidence: validation/m28/results/X1.json (machine-emitted)

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { join } from "node:path"
import { writeSealed, parseSealedRecord } from "../lib/evidence.ts"
import { parseSealedRecord } from "../lib/evidence.ts"

const ROOT = join(import.meta.dirname ?? ".", "../..")
const RESULTS = join(ROOT, "validation/m28/results")
const MANIFEST_PATH = join(RESULTS, "manifest.json")

let checks = 0
let passed = 0
let failures = 0
let negatives = 0
const failureList: string[] = []

function check(label: string, ok: boolean, detail = ""): void {
  checks++
  if (ok) passed++
  else {
    failures++
    failureList.push(detail ? `${label} — ${detail}` : label)
    console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`)
  }
}

function negative(label: string, ok: boolean, detail = ""): void {
  negatives++
  checks++
  if (ok) passed++
  else {
    failures++
    failureList.push(detail ? `${label} — ${detail}` : label)
    console.log(`  FAIL(negative): ${label}${detail ? ` — ${detail}` : ""}`)
  }
}

function runVerifier(script: string): { exit: number; stdout: string } {
  try {
    const stdout = execFileSync("npx", ["tsx", script], { cwd: ROOT, encoding: "utf8", timeout: 570_000, stdio: ["ignore", "pipe", "ignore"] })
    return { exit: 0, stdout }
  } catch (e: unknown) {
    const code = (e as { status?: number }).status
    const stdout = (e as { stdout?: string }).stdout ?? ""
    return { exit: typeof code === "number" ? code : 1, stdout }
  }
}

function fingerprint(file: string): string | null {
  try {
    const j = parseSealedRecord(file)
    delete j.generatedAt
    delete j.currentCommit
    // bbSeal is declared-volatile integrity metadata (sealedAt changes every
    // regeneration); parseSealedRecord has already VERIFIED the seal, so the
    // equivalence check compares content only (same rule as m24's closure).
    delete j.bbSeal
    return JSON.stringify(j)
  } catch {
    return null
  }
}

interface SuiteEntry {
  code: string
  script: string
  evidence: string
}
const SUITE: SuiteEntry[] = [
  { code: "T1", script: "script/m28/verify-mcp-tools.ts", evidence: "T1.json" },
  { code: "U1", script: "script/m28/verify-union.ts", evidence: "U1.json" },
  { code: "A1", script: "script/m28/verify-annotation-store.ts", evidence: "A1.json" },
  { code: "A2", script: "script/m28/verify-annotation-ui.ts", evidence: "A2.json" },
  { code: "V1", script: "script/m28/verify-mcp-surface.ts", evidence: "V1.json" },
]

export interface BarInput {
  ledger: Record<string, { status: string; evidence?: { status?: string } }>
  unionProven: boolean
  annotations: {
    provenanceEnforced: boolean
    schemaRefusal: boolean
    inEditorLeg: boolean
  }
  surface: {
    generatedFromRegistry: boolean
    driftGated: boolean
  }
}

/** v4 completion-bar audit (master plan items 1-4) as a pure function. */
export function completionBarViolations(input: BarInput): string[] {
  const v: string[] = []
  const ev = (c: string) => input.ledger[c]?.evidence?.status ?? input.ledger[c]?.status
  // Item 1: the three new MCP read tools verified, each reusing its IDE-side component.
  if (ev("T1") !== "verified") v.push("bar1: the MCP read-tool leg is not verified (T1)")
  // Item 2: the union differential gate proves MCP ≡ IDE on the shared fixture.
  if (ev("U1") !== "verified") v.push("bar2: the union differential gate is not verified (U1)")
  if (!input.unionProven) v.push("bar2: union equality not machine-proven")
  // Item 3: annotation write/read verified with enforced provenance.
  if (ev("A1") !== "verified") v.push("bar3: the annotation store leg is not verified (A1)")
  if (!input.annotations.provenanceEnforced) v.push("bar3: provenance not enforced")
  if (!input.annotations.schemaRefusal) v.push("bar3: schema-level provenance refusal not proven")
  // Item 4: annotations visible in-editor (hover + graph) with author labels.
  if (ev("A2") !== "verified") v.push("bar4: the annotations-in-IDE leg is not verified (A2)")
  if (!input.annotations.inEditorLeg) v.push("bar4: no real in-editor leg")
  // The generated surface doc exists and is drift-gated.
  if (ev("V1") !== "verified") v.push("bar: the generated MCP surface doc is not verified (V1)")
  if (!input.surface.generatedFromRegistry || !input.surface.driftGated) v.push("bar: surface doc not registry-generated + drift-gated")
  // Closure-gate discipline — only X1 may remain planned.
  const planned = Object.entries(input.ledger).filter(([, i]) => i.status === "planned").map(([c]) => c)
  if (!planned.every((c) => c === "X1")) v.push(`bar5: ledger has non-X1 planned cells: ${planned.join(",")}`)
  return v
}

console.log("M28.X1 closure-gate verifier\n")
const currentCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()

// --- Pass 1: full suite at HEAD ---------------------------------------------------
console.log("pass 1: full M28 suite at HEAD")
const suiteStdout: Record<string, string> = {}
for (const { code, script } of SUITE) {
  console.log(`  running ${code}…`)
  const run = runVerifier(script)
  suiteStdout[code] = run.stdout
  check(`X1: ${code} verifier passes at HEAD`, run.exit === 0, `exit=${run.exit}`)
}

// --- Pass 2: per-mutant records -----------------------------------------------------
console.log("\npass 2: per-mutant records (named, from the pass-1 runs; cross-checked against the evidence aggregates)")
const mutantsCaught: Record<string, { caught: number; total: number } | null> = {}
const perMutantRecords: Record<string, Array<{ name: string; caught: boolean }>> = {}
for (const { code, evidence } of SUITE) {
  const records: Array<{ name: string; caught: boolean }> = []
  for (const line of (suiteStdout[code] ?? "").split("\n")) {
    const caughtM = line.match(/^\\s*caught:\\s*(.+?)\\s*$/)
    const survivedM = line.match(/^\\s*SURVIVED:\\s*(.+?)\\s*$/)
    if (caughtM) records.push({ name: caughtM[1], caught: true })
    else if (survivedM) records.push({ name: survivedM[1], caught: false })
  }
  perMutantRecords[code] = records
  let aggCaught = -1
  let aggTotal = -1
  try {
    const rec = parseSealedRecord(join(RESULTS, evidence)) as { mutantsCaught?: number; mutantsTotal?: number }
    aggCaught = rec.mutantsCaught ?? -1
    aggTotal = rec.mutantsTotal ?? -1
  } catch {}
  const namedCaught = records.filter((r) => r.caught).length
  mutantsCaught[code] = records.length > 0 ? { caught: namedCaught, total: records.length } : aggTotal >= 0 ? { caught: aggCaught, total: aggTotal } : null
  check(`X1: ${code} evidence carries a per-mutant record`, records.length > 0 || aggTotal > 0, `named=${records.length} aggregate=${aggCaught}/${aggTotal}`)
  if (records.length > 0 && aggTotal >= 0) {
    check(`X1: ${code} named record count agrees with the evidence aggregate`, records.length === aggTotal, `named=${records.length} aggregate=${aggTotal}`)
  }
  check(`X1: ${code} every mutant caught (${namedCaught}/${records.length || aggTotal})`, records.length > 0 ? namedCaught === records.length : aggCaught === aggTotal, `${namedCaught}/${records.length || aggTotal}`)
}

// --- Pass 3: v4 completion-bar audit at HEAD ----------------------------------------
console.log("\npass 3: v4 completion-bar audit (master plan items 1-4)")
const manifest = parseSealedRecord(MANIFEST_PATH) as { issues: Array<{ code: string; status: string; evidence?: { status?: string } }> }
const ledgerMap: BarInput["ledger"] = {}
for (const i of manifest.issues) ledgerMap[i.code] = { status: i.status, evidence: i.evidence }

function evidenceFor(code: string): Record<string, unknown> | null {
  const entry = SUITE.find((s) => s.code === code)
  if (!entry) return null
  try {
    return parseSealedRecord(join(RESULTS, entry.evidence)) as Record<string, unknown>
  } catch {
    return null
  }
}
const a1Ev = evidenceFor("A1")
const a2Ev = evidenceFor("A2")
const u1Ev = evidenceFor("U1")
const surfaceSrc = existsSync(join(ROOT, "script/m28/verify-mcp-surface.ts")) ? readFileSync(join(ROOT, "script/m28/verify-mcp-surface.ts"), "utf8") : ""
const storeSrc = existsSync(join(ROOT, "src/brain/schema-ddl.ts")) ? readFileSync(join(ROOT, "src/brain/schema-ddl.ts"), "utf8") : ""
const annotateSrc = existsSync(join(ROOT, "src/mcp/tool-handlers.ts")) ? readFileSync(join(ROOT, "src/mcp/tool-handlers.ts"), "utf8") : ""

const barInput: BarInput = {
  ledger: ledgerMap,
  unionProven: u1Ev !== null && u1Ev["status"] === "verified" && typeof u1Ev["claimLevel"] === "string" && u1Ev["claimLevel"].includes("machine-proven identical"),
  annotations: {
    provenanceEnforced: annotateSrc.includes("'agent'") && annotateSrc.includes("author_class"),
    schemaRefusal: storeSrc.includes("brain_annotation") && storeSrc.includes("author_class TEXT NOT NULL"),
    inEditorLeg: a2Ev !== null && existsSync(join(ROOT, "script/m28/annotation-driver.lua")) && existsSync(join(ROOT, ".tools/nvim-linux-x86_64/bin/nvim")),
  },
  surface: {
    generatedFromRegistry: surfaceSrc.includes("tool-registry.ts"),
    driftGated: surfaceSrc.includes("byte-identical") && existsSync(join(ROOT, "docs/m28/MCP-SURFACE.md")),
  },
}
const barViolations = completionBarViolations(barInput)
check("X1: v4 completion bar audited item-by-item — zero violations", barViolations.length === 0, barViolations.join("; "))
// Negative probes: the audit must fire on forged bar claims.
{
  const noUnion: BarInput = { ...barInput, unionProven: false }
  negative("X1: negative — bar audit fires when union proof disappears", completionBarViolations(noUnion).some((x) => x.startsWith("bar2")))
  const noSchema: BarInput = { ...barInput, annotations: { ...barInput.annotations, schemaRefusal: false } }
  negative("X1: negative — bar audit fires when the schema-level refusal claim is lost", completionBarViolations(noSchema).some((x) => x.startsWith("bar3")))
  const noEditor: BarInput = { ...barInput, annotations: { ...barInput.annotations, inEditorLeg: false } }
  negative("X1: negative — bar audit fires when the in-editor leg disappears", completionBarViolations(noEditor).some((x) => x.startsWith("bar4")))
  const dirtyLedger: BarInput = { ...barInput, ledger: { ...barInput.ledger, A2: { status: "planned" } } }
  negative("X1: negative — bar audit fires when a leg regresses to planned", completionBarViolations(dirtyLedger).some((x) => x.startsWith("bar4")))
}

// --- Pass 4: byte-identical regeneration (deterministic legs) ------------------------
console.log("\npass 4: byte-identical regeneration check (modulo declared volatile fields)")
for (const { code, script, evidence } of SUITE) {
  const fp = join(RESULTS, evidence)
  const before = fingerprint(fp)
  const run = runVerifier(script)
  const after = fingerprint(fp)
  check(`X1: ${code} regeneration run passes`, run.exit === 0, `exit=${run.exit}`)
  check(`X1: ${code} evidence byte-identical (modulo generatedAt/currentCommit)`, before !== null && before === after)
}
// The generated surface doc must also regenerate byte-identically (markdown:
// the JSON fingerprint helper does not apply, so compare raw content).
{
  const docPath = join(ROOT, "docs/m28/MCP-SURFACE.md")
  const before = existsSync(docPath) ? readFileSync(docPath, "utf8") : null
  void runVerifier("script/m28/verify-mcp-surface.ts")
  const after = existsSync(docPath) ? readFileSync(docPath, "utf8") : null
  check("X1: MCP surface doc regenerates byte-identical", before !== null && before === after)
}

// --- Evidence -------------------------------------------------------------------------
const failed = checks - passed
const result = {
  issue: "629",
  code: "X1",
  milestone: "M28",
  status: failed === 0 ? "verified" : "known-gap",
  checks,
  passed,
  failed,
  failures: failureList,
  negativeCases: negatives,
  currentCommit,
  verifierCommand: "npx tsx script/m28/verify-closure.ts",
  barViolations,
  perMutantRecords,
  generatedAt: new Date().toISOString(),
}
mkdirSync(RESULTS, { recursive: true })
writeSealed(join(RESULTS, "X1.json"), result)
console.log(`\nX1: ${result.status.toUpperCase()} (${passed}/${checks} passed, ${negatives} negative)`)
if (result.status !== "verified") process.exitCode = 1
