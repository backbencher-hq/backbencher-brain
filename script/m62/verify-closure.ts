// script/m62/verify-closure.ts — M62.X1 (issue #878).
//
// The milestone is closed by an AUDIT at one HEAD, never by assertion:
//
//   R1 the chain:     the M62 gate chain (A1/A2/A3/D1) is RE-EXECUTED here —
//                     nothing is trusted from a previous run.
//   R2 the ledger:    every record is sealed and verified, every entry is the
//                     projection of its record, and the ledger (with THIS run's
//                     own measured entry substituted) passes every structural
//                     rule. The ledger may read `closed` only when every issue
//                     is verified and this audit is green.
//   R3 the lane:      every IDE-lane closure record (m24/m26/m42/m44/m55/m61)
//                     is verified, pinned, and FRESH BY RELEVANCE — its pin is
//                     an ancestor of HEAD and no lane source file changed since
//                     it ran, so a green record cannot be a stale claim about a
//                     tree that has moved.
//   R4 the claim:     the address invariants are re-checked through the REAL
//                     engine over a REAL seeded index at this HEAD: no
//                     call-site without a positive line, no unlabeled
//                     substitute, no unknown carrying a numeric line.
//   R5 the packs:     SPOT-CHECK-PACK.md (and the known-gaps inventory) are
//                     GENERATED; a hand edit fails byte-identical regeneration.
//   N1–N7 negatives:  a stale lane pin, a lane source change, a missing record,
//                     a hollow M62 entry, a hand-edited pack, a lane escape and
//                     an invariant violation each FAIL the audit.
//
// Evidence: validation/m62/results/X1.json (machine-emitted, sealed).
// Run: npx tsx script/m62/verify-closure.ts

import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { readEvidence, writeSealed } from "../lib/evidence.ts"
import { SEED } from "./a1-fixture.ts"
import {
  EXPECTED_CODES,
  SELF_OWNED_CODES,
  addressInvariants,
  generatedFindings,
  laneBarFindings,
  laneViolations,
  ledgerEntryFrom,
  packFindings,
  validateLedger,
  type Ledger,
} from "./governance_core.ts"

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const RESULTS = path.join(ROOT, "validation/m62/results")
const EVIDENCE = path.join(RESULTS, "X1.json")
const LEDGER_PATH = path.join(RESULTS, "manifest.json")
const PLAN = path.join(ROOT, "docs/m62/M62-MASTER-PLAN.md")
const DOC = path.join(ROOT, "docs/m62/LINE-ADDRESS.md")
const PACK = path.join(RESULTS, "SPOT-CHECK-PACK.md")
const GAPS = path.join(RESULTS, "KNOWN-GAPS.md")

/** The M62 chain, re-executed in order (R1). */
const CHAIN: Array<[string, string]> = [
  ["A1", "npx tsx script/m62/verify-address.ts"],
  ["A2", "npx tsx script/m62/verify-consumers.ts"],
  ["A3", "npx tsx script/m62/verify-arrival.ts"],
  ["D1", "npx tsx script/m62/verify-docs.ts"],
]

/** The IDE lane's closure records (R3): each lane re-earns its own bar; this
 *  audit requires those bars to be verified and still true of this tree. */
const LANE_BARS: Array<[string, string]> = [
  ["m24 (The Server)", "validation/m24/results/X1.json"],
  ["m26 (The Graph)", "validation/m26/results/X1.json"],
  ["m42 (The Interactive Hover)", "validation/m42/results/X1.json"],
  ["m44 (The Understandable Hub)", "validation/m44/results/X1.json"],
  ["m55 (The Hub That Tells the Truth)", "validation/m55/results/X1.json"],
  ["m61 (Verifier Truth)", "validation/m61/results/X1.json"],
]

/** Files whose change invalidates a lane record (relevance, not equality). */
const LANE_SOURCES = ["src/lsp/", "src/intelligence/", "src/mcp/tool-handlers.ts", "script/m24/", "script/m26/", "script/m42/", "script/m44/", "script/m55/", "script/m62/"]

const NEGATIVES = 7

let checks = 0
let passed = 0
const failures: string[] = []
function check(label: string, ok: boolean, detail = ""): void {
  checks++
  if (ok) passed++
  else failures.push(detail ? `${label}: ${detail}` : label)
  console.log(`  ${ok ? "✓" : "✗"} ${label}${ok || !detail ? "" : ` — ${detail}`}`)
}
function negative(label: string, ok: boolean, detail = ""): void {
  check(`negative: ${label}`, ok, detail)
}

const currentCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()

function runGate(cmd: string): { ok: boolean; last: string } {
  try {
    const out = execFileSync("bash", ["-lc", cmd], { cwd: ROOT, encoding: "utf8", timeout: 1_800_000, stdio: ["ignore", "pipe", "pipe"] })
    const lines = out.trim().split("\n")
    return { ok: true, last: lines[lines.length - 1] ?? "" }
  } catch (error: any) {
    const out = `${String(error?.stdout ?? "")}${String(error?.stderr ?? "")}`
    const lines = out.trim().split("\n")
    return { ok: false, last: lines[lines.length - 1] ?? String(error?.message ?? error).slice(0, 200) }
  }
}

function isAncestor(commit: string): boolean {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", commit, "HEAD"], { cwd: ROOT, stdio: "ignore" })
    return true
  } catch {
    return false
  }
}
/** Lane files that changed after the pin — COMMITTED or still in the working
 *  tree. The tree leg matters: a lane record pinned at an older commit is a
 *  claim about code that is no longer current, and uncommitted edits were a
 *  real hole in an earlier form of this rule (found while building X1). */
function laneChangedSince(commit: string): string[] {
  const paths = new Set<string>()
  try {
    const committed = execFileSync("git", ["diff", "--name-only", `${commit}..HEAD`], { cwd: ROOT, encoding: "utf8" })
    for (const p of committed.split("\n").map((l) => l.trim())) if (p.length > 0 && LANE_SOURCES.some((s) => p.startsWith(s))) paths.add(p)
  } catch {
    paths.add("<git diff failed>")
  }
  try {
    const status = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: ROOT, encoding: "utf8" })
    for (const line of status.split("\n")) {
      const p = line.slice(3).trim()
      if (p.length > 0 && LANE_SOURCES.some((s) => p.startsWith(s))) paths.add(`${p} (uncommitted)`)
    }
  } catch {
    paths.add("<git status failed>")
  }
  return [...paths]
}

/** R5's spot-check pack, GENERATED from the projected ledger. */
function generatePack(ledger: Ledger): string {
  const L: string[] = []
  L.push("# M62 spot-check pack — for the owner")
  L.push("")
  L.push("The achieved/not-achieved verdict is the owner's, never the gate's (IDE")
  L.push("Honesty Contract §8.5). Below is what to try and what is explicitly not")
  L.push("claimed, so the verdict can be made on evidence.")
  L.push("")
  L.push("## What to try")
  L.push("")
  L.push("1. Index a project whose analyzers store no call-site line (every language")
  L.push("   today except the ones M59 covers). Hover a symbol and open the graph: no")
  L.push("   row anywhere may read `line 0`, and the graph's rows say which position")
  L.push("   they are showing.")
  L.push("2. Ask an agent for `bb_graph` on a symbol that calls others: every edge")
  L.push("   carries a `callSite` with a `kind` (`call-site` only when a real line was")
  L.push("   stored) and a `note` for every non-exact kind.")
  L.push("3. Index a Scala project (the one analyzer that stores real call-site lines")
  L.push("   today) and repeat: the same surfaces show exact call sites, with no code")
  L.push("   change and no re-verification of this milestone.")
  L.push("4. Read `docs/m62/LINE-ADDRESS.md` (generated) beside the behaviour you saw.")
  L.push("")
  L.push("## What is explicitly NOT claimed")
  L.push("")
  L.push("Per-language real-line COVERAGE is M59's lane (M59.A7). This milestone claims")
  L.push("the consumption contract: whatever the store writes is interpreted honestly.")
  L.push("M59.A2/A4/A8 (NULL-vs-0 write rule, multiplicity, row identity) land in the")
  L.push("co-agent lane; `script/m62/verify-arrival.ts` is the acceptance for their")
  L.push("arrival and shows the upgrade needs no consumer change.")
  L.push("")
  L.push("## The issues")
  L.push("")
  for (const issue of ledger.issues) L.push(`- **${issue.code}** (#${issue.githubIssue}, ${issue.status}): ${issue.scope}`)
  L.push("")
  return L.join("\n")
}

/** The known-gaps inventory: what the milestone does not claim. */
function generateGaps(ledger: Ledger): string {
  const L: string[] = []
  L.push("# M62 known gaps — declared, not hidden")
  L.push("")
  L.push("> GENERATED by `script/m62/verify-closure.ts`. An empty file here would")
  L.push("> itself be a claim, so the out-of-scope items are declared before the")
  L.push("> per-record limitations.")
  L.push("")
  L.push("## Out of scope by the plan (declared)")
  L.push("")
  L.push("- Analyzer emission of call-site lines per language (M59.A7) and the store's")
  L.push("  `NULL`-vs-`0` write rule (M59.A2) — co-agent lane.")
  L.push("- Usage-row multiplicity and duplicate-edge collapse (M59.A4/A8): those change")
  L.push("  what a row IS; the hub model is re-derived when they land (the M53 pattern).")
  L.push("- References and call hierarchy keep navigating to the referencing symbol's own")
  L.push("  indexed location (byte-accurate); they make no call-site claim.")
  L.push("")
  L.push("## Limitations carried by the records")
  L.push("")
  for (const issue of ledger.issues) {
    const rec = readEvidence<{ limitations?: string[] }>(path.join(RESULTS, issue.evidence?.evidenceFile ?? ""))
    const limitations = rec.ok ? (rec.record.limitations ?? ["(the record declares no limitations)"]) : [`(record ${issue.evidence?.evidenceFile ?? "?"} not readable: ${rec.reason})`]
    L.push(`### ${issue.code}`)
    L.push("")
    for (const l of limitations) L.push(`- ${l}`)
    L.push("")
  }
  return L.join("\n")
}

interface Fixture { ws: string; dataDir: string; projectId: string; cleanup(): void }

async function makeFixture(): Promise<Fixture> {
  const ws = mkdtempSync(path.join(tmpdir(), "m62x1-ws-"))
  const dataDir = mkdtempSync(path.join(tmpdir(), "m62x1-data-"))
  for (const [rel, content] of Object.entries(SEED.files)) writeFileSync(path.join(ws, rel), content)
  const projectId = createHash("sha1").update(path.resolve(ws)).digest("hex").substring(0, 40)
  mkdirSync(path.join(dataDir, "projects", projectId), { recursive: true })
  process.env.BB_DATA_DIR = dataDir
  const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database.ts"))
  const db = await BrainDatabase.getRawInstance(projectId)
  const fileIds: Record<string, string> = {}
  const fileStmt = db.prepare(`INSERT INTO brain_file (id, project_id, path, relative_path, language, file_hash) VALUES (?,?,?,?,?,?)`)
  let i = 0
  for (const rel of Object.keys(SEED.files)) {
    const id = `file-${++i}`
    fileIds[rel] = id
    fileStmt.run(id, projectId, path.join(ws, rel), rel, "typescript", `m62x1-hash-${i}`)
  }
  const symStmt = db.prepare(`INSERT INTO brain_symbol (id, project_id, file_id, name, symbol_type, line_start, line_end, byte_start, byte_end, gravity_score) VALUES (?,?,?,?,?,?,?,?,?,?)`)
  for (const s of SEED.symbols) symStmt.run(s.id, projectId, fileIds[s.file], s.name, s.symbolType, s.lineStart, s.lineEnd, 1, 2, 5)
  const relStmt = db.prepare(
    `INSERT INTO brain_relationship (id, project_id, source_symbol_id, target_symbol_id, relationship_type, confidence, metadata, line_number, is_cross_language, target_external) VALUES (?,?,?,?,?,?,?,?,?,?)`,
  )
  for (const r of SEED.relationships) relStmt.run(r.id, projectId, r.source, r.target, "calls", 0.9, '{"evidenceClass":"structural"}', r.lineNumber, 0, null)
  return {
    ws,
    dataDir,
    projectId,
    cleanup: () => {
      try { rmSync(ws, { recursive: true, force: true }) } catch {}
      try { rmSync(dataDir, { recursive: true, force: true }) } catch {}
    },
  }
}

async function main(): Promise<void> {
  const planText = readFileSync(PLAN, "utf8")
  const ledger = JSON.parse(readFileSync(LEDGER_PATH, "utf8")) as Ledger

  // --- R1: the chain, re-executed --------------------------------------------------------
  console.log("R1: the M62 chain, re-executed at this HEAD")
  const chainResults: Record<string, { ok: boolean; last: string }> = {}
  for (const [code, cmd] of CHAIN) {
    const res = runGate(cmd)
    chainResults[code] = res
    check(`R1: ${code} is green at this tree`, res.ok, res.last)
  }

  // --- R2: the records and the projected ledger ------------------------------------------
  console.log("\nR2: the records and the ledger")
  const derived = new Map<string, NonNullable<Ledger["issues"][number]["evidence"]>>()
  for (const issue of ledger.issues) {
    const file = issue.evidence?.evidenceFile ?? `${issue.code}.json`
    const read = readEvidence<Record<string, unknown>>(path.join(RESULTS, file))
    if (issue.code === "G1" || issue.code === "X1") {
      check(`R2: ${issue.code}'s record is sealed and verified (self-owned; read, not judged)`, read.ok && (read.record as { status?: string }).status === "verified", read.ok ? `status=${(read.record as { status?: string }).status}` : read.reason)
      continue
    }
    check(`R2: ${issue.code}'s record is sealed and verified`, read.ok && (read.record as { status?: string }).status === "verified", read.ok ? `status=${(read.record as { status?: string }).status}` : read.reason)
    if (!read.ok) continue
    const rec = read.record as Record<string, number | undefined>
    derived.set(issue.code, ledgerEntryFrom(read.record, { mutants: Number(rec.mutantsTotal ?? 0), negatives: Number(rec.negativeCases ?? 0) }))
  }
  const existingX1 = ledger.issues.find((i) => i.code === "X1") as Ledger["issues"][number]
  const x1Entry: Ledger["issues"][number] = {
    ...existingX1,
    status: "verified",
    evidence: {
      status: "verified",
      verifierCommand: "npx tsx script/m62/verify-closure.ts",
      evidenceFile: "X1.json",
      passed: 0, // substituted with this run's measured counts below
      failed: 0,
      realFailed: 0,
      negativeCases: NEGATIVES,
      recordCommit: currentCommit,
    },
  }
  const projected: Ledger = {
    ...ledger,
    status: "open",
    issues: ledger.issues.map((i) => (i.code === "X1" ? x1Entry : derived.has(i.code) ? { ...i, evidence: derived.get(i.code) } : i)),
  }

  // --- R3: the lane, by relevance ---------------------------------------------------------
  console.log("\nR3: the IDE lane's closure records (verified AND still true of this tree)")
  const laneFindings: Array<{ name: string; findings: string[] }> = []
  for (const [name, file] of LANE_BARS) {
    const read = readEvidence<{ status?: string; passed?: number; mutantsCaught?: number; currentCommit?: string }>(path.join(ROOT, file))
    const findings = read.ok ? laneBarFindings(read.record, { isAncestor, laneChanged: laneChangedSince }) : [read.reason]
    laneFindings.push({ name, findings })
    check(`R3: ${name} is verified and fresh`, findings.length === 0, findings.join("; "))
  }

  // --- R4: the claim, re-checked on a real index -------------------------------------------
  console.log("\nR4: the address invariants through the REAL engine at this HEAD")
  const fx = await makeFixture()
  try {
    const engine = await import(path.join(ROOT, "src/intelligence/graph/graph-engine.ts"))
    const trav = await engine.graphTraversal(fx.projectId, "root", { direction: "both", maxDepth: 2 })
    const addresses = [...(trav.callers ?? []), ...(trav.callees ?? [])].map((e: any) => e.callSite)
    check("R4: the traversal produced an address for every seeded row (not vacuous)", addresses.length === SEED.relationships.length, `${addresses.length}/${SEED.relationships.length}`)
    const violations = addressInvariants(addresses)
    check("R4: every address satisfies the owner's invariants (call-site ⇒ positive line; substitute/unknown ⇒ a note; unknown ⇒ null line)", violations.length === 0, violations.join(", "))
  } finally {
    try { fx.cleanup() } catch {}
  }

  // --- R5: the generated packs ---------------------------------------------------------------
  console.log("\nR5: the generated packs")
  const freshPack = generatePack(projected)
  const freshGaps = generateGaps(projected)
  const packOnDisk = existsSync(PACK) ? readFileSync(PACK, "utf8") : null
  const packDrift = packOnDisk === null ? [] : generatedFindings(packOnDisk, freshPack)
  check(`R5: the spot-check pack is byte-identical to a fresh generation${packOnDisk === null ? " (first run creates it; the drift rule binds from the next run)" : ""}`, packDrift.length === 0, packDrift.join(", "))
  check("R5: the pack names every issue", packFindings(freshPack, EXPECTED_CODES).length === 0, packFindings(freshPack, EXPECTED_CODES).join(", "))
  const docText = existsSync(DOC) ? readFileSync(DOC, "utf8") : null
  check("R5: the generated address doc exists and carries its generation banner", docText !== null && /GENERATED/.test(docText), docText === null ? `${DOC} is missing` : "no GENERATED banner")

  // --- negatives ---------------------------------------------------------------------------
  console.log("\nnegatives (every rule must be able to fail)")
  negative("a stale lane pin FAILS the relevance rule", laneBarFindings({ status: "verified", passed: 40, mutantsCaught: 5, currentCommit: "0".repeat(40) }, { isAncestor: () => false, laneChanged: () => [] }).length > 0)
  negative("a lane source change since the pin FAILS the relevance rule", laneBarFindings({ status: "verified", passed: 40, mutantsCaught: 5, currentCommit: currentCommit }, { isAncestor: () => true, laneChanged: () => ["src/lsp/hover.ts"] }).length > 0)
  negative("a missing lane record FAILS", laneBarFindings(undefined, { isAncestor: () => true, laneChanged: () => [] }).length > 0)
  {
    const hollow = JSON.parse(JSON.stringify(projected)) as Ledger
    const i = hollow.issues.find((x) => x.code !== "X1" && x.code !== "G1")!
    i.evidence = { ...i.evidence, mutantsCaught: 0, negativeCases: 0, passed: 0 }
    negative("a hollow M62 entry FAILS the ledger rules", validateLedger(hollow, planText, SELF_OWNED_CODES).some((e) => e.startsWith("hollow-")))
  }
  negative("a hand-edited pack FAILS byte-identical regeneration", generatedFindings(`${freshPack}\n<!-- hand edit -->\n`, freshPack).length > 0)
  negative("a lane escape FAILS the lane rules", laneViolations({ issues: [{ ...(ledger.issues[0] as any), artifacts: ["script/m59/x.ts"] }] }).length > 0)
  negative("an invariant violation FAILS (a call-site without a positive line)", addressInvariants([{ kind: "call-site", file: "a.ts", line: 0 } as any]).length > 0)

  // --- the verdict and the writes ------------------------------------------------------------
  const othersVerified = projected.issues.filter((i) => i.code !== "X1").every((i) => i.status === "verified" && Boolean(i.evidence?.evidenceFile))
  check("R2: every other issue is verified before X1 may close the ledger", othersVerified, projected.issues.map((i) => `${i.code}=${i.status}`).join(" "))

  const failed = checks - passed
  x1Entry.evidence!.passed = passed
  x1Entry.evidence!.failed = failed
  x1Entry.evidence!.realFailed = failed
  const finalLedger: Ledger = { ...projected, status: othersVerified && failed === 0 ? "closed" : "open" }
  const ledgerErrors = validateLedger(finalLedger, planText, SELF_OWNED_CODES)
  check("R2: the whole ledger (with this run's entry) passes every structural rule", ledgerErrors.length === 0, ledgerErrors.join(", "))

  const result = {
    issue: "M62.X1",
    code: "X1",
    milestone: "M62",
    status: failed === 0 ? "verified" : "known-gap",
    checks,
    passed,
    failed,
    realFailed: failed,
    negativeCases: NEGATIVES,
    mutantsCaught: 0,
    mutantsTotal: 0,
    currentCommit,
    verifierCommand: "npx tsx script/m62/verify-closure.ts",
    evidenceFile: "X1.json",
    generatedAt: new Date().toISOString(),
    schemaVersion: 1,
    chain: Object.entries(chainResults).map(([code, r]) => ({ code, ok: r.ok, last: r.last })),
    lane: laneFindings,
    ledgerStatus: finalLedger.status,
    packDriftChecked: packOnDisk !== null,
    artifacts: ["validation/m62/results/SPOT-CHECK-PACK.md", "validation/m62/results/KNOWN-GAPS.md"],
    laws: [
      "R1 the M62 chain re-executes",
      "R2 every entry is the projection of a sealed record",
      "R3 every lane bar is verified and fresh by relevance",
      "R4 the address invariants hold through the real engine",
      "R5 the packs are generated, never hand-written",
    ],
    limitations: [
      "The lane bars are re-read (verified + fresh by relevance); each lane's own closure gate re-earns its bar, which this audit requires rather than re-runs.",
      "Per-language real-line coverage remains M59's claim; this audit re-checks the consumption contract only.",
      "The pack drift rule binds from the second run (the first run creates the pack).",
    ],
  }
  mkdirSync(RESULTS, { recursive: true })
  writeFileSync(PACK, freshPack)
  writeFileSync(GAPS, freshGaps)
  writeSealed(EVIDENCE, result)
  writeFileSync(LEDGER_PATH, `${JSON.stringify(finalLedger, null, 2)}\n`)
  console.log(`\nX1: ${result.status.toUpperCase()} (${passed}/${checks}) — ledger ${finalLedger.status}`)
  process.exit(failed === 0 ? 0 : 1)
}

void main()
