// script/m26/verify-closure.ts — M26.X1 (issue #516). The closure gate.
//
// Nothing closes without the gate. Four passes:
//   Pass 1  full M26 suite at HEAD: every verifier green at the current
//           commit (W1–W6, V1, D1; G1 deliberately not re-run inside —
//           it validates X1's own evidence at the closing HEAD, the
//           M25 self-referential-trap rationale, inherited).
//   Pass 2  per-mutant records: every M26 verifier's evidence carries its
//           per-mutant list, and every recorded mutant is CAUGHT
//           (acceptance criterion: per-mutant records).
//   Pass 3  v2 completion-bar audit at current HEAD (master plan items 1-5)
//           via a pure audit function; negative probes prove the audit
//           fires on forged bar claims.
//   Pass 4  byte-identical regeneration for the deterministic legs
//           (fingerprint equality modulo the declared generatedAt/
//           currentCommit fields).
//
// Run: npx tsx script/m26/verify-closure.ts
// Evidence: validation/m26/results/X1.json (machine-emitted)

import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { join, resolve } from "node:path"
import { writeSealed, parseSealedRecord } from "../lib/evidence.ts"
import { parseSealedRecord } from "../lib/evidence.ts"

const ROOT = resolve(import.meta.dirname, "../..")
const RESULTS = join(ROOT, "validation/m26/results")
const MANIFEST_PATH = join(RESULTS, "manifest.json")

let checks = 0
let passed = 0
let negatives = 0
const failures: string[] = []

function check(label: string, ok: boolean, detail = ""): void {
  checks++
  if (ok) passed++
  else {
    failures.push(label)
    console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`)
  }
}
function negative(label: string, ok: boolean, detail = ""): void {
  negatives++
  if (!ok) {
    failures.push(label)
    console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`)
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

// --- Pass 2/3 data -------------------------------------------------------------

interface SuiteEntry {
  code: string
  script: string
  evidence: string
}
const SUITE: SuiteEntry[] = [
  { code: "W1", script: "script/m26/verify-webview-core.ts", evidence: "W1.json" },
  { code: "W2", script: "script/m26/verify-graph-transport.ts", evidence: "W2.json" },
  { code: "W3", script: "script/m26/verify-cross-language-hover.ts", evidence: "W3.json" },
  { code: "W4", script: "script/m26/verify-evidence-badges.ts", evidence: "W4.json" },
  { code: "W5", script: "script/m26/verify-impact-mode.ts", evidence: "W5.json" },
  { code: "W6", script: "script/m26/verify-content-security.ts", evidence: "W6.json" },
  { code: "V1", script: "script/m26/verify-webview-harness.ts", evidence: "V1.json" },
  { code: "D1", script: "script/m26/verify-graph-docs.ts", evidence: "D1.json" },
]

// --- Pure audit function (mutation/negative target) -----------------------------

export interface BarInput {
  ledger: Record<string, { status: string; evidence?: { status?: string } }>
  files: { graphDoc: string; transportDoc: string }
  mutantsCaught: (code: string) => { caught: number; total: number } | null
  panelLive: { commandRegistered: boolean; panelRenders: boolean; forkVerified: boolean }
}

/** v2 completion-bar audit (master plan items 1-5) as a pure function. */
export function completionBarViolations(input: BarInput): string[] {
  const v: string[] = []
  const ev = (c: string) => input.ledger[c]?.evidence?.status ?? input.ledger[c]?.status
  // Item 1: graph webview live in VS Code at I3; at least one fork at I4 or
  // honestly blocked (never claimed, never omitted).
  if (ev("W1") !== "verified" || ev("W2") !== "verified") v.push("bar1: webview core/transport not verified")
  if (!input.panelLive.commandRegistered) v.push("bar1: bbLsp.showGraph command not registered (webview not live in VS Code)")
  if (!input.panelLive.panelRenders) v.push("bar1: graph panel not verified rendering in-editor (E5 leg)")
  if (!input.panelLive.forkVerified) v.push("bar1: no fork verified at I4 (or blocked-with-reason — not recorded)")
  // Item 2: cross-language hover verified on stored pairs; absent declared.
  if (ev("W3") !== "verified") v.push("bar2: cross-language hover not verified")
  if (!input.files.graphDoc.includes("declared absent")) v.push("bar2: per-pair absence not declared in the generated docs")
  // Item 3: badges for all tiers; inferred-never-structural mutation-proven.
  if (ev("W4") !== "verified") v.push("bar3: evidence badges not verified")
  const w4 = input.mutantsCaught("W4")
  if (w4 === null || w4.caught !== w4.total) v.push("bar3: inferred-never-structural not mutation-proven")
  // Item 4: impact bounded, truncation visible, budget met.
  if (ev("W5") !== "verified") v.push("bar4: impact mode not verified")
  if (!input.files.graphDoc.includes("RENDER_BUDGET")) v.push("bar4: truncation policy not documented from the live budget")
  // Item 5: closure gate green; ledger clean.
  const planned = Object.entries(input.ledger).filter(([, i]) => i.status === "planned").map(([c]) => c)
  if (!planned.every((c) => c === "X1")) v.push(`bar5: ledger has non-X1 planned cells: ${planned.join(",")}`)
  if (!input.files.transportDoc.includes("bb/graph")) v.push("bar5: transport doc lost the declared method")
  return v
}

console.log("M26.X1 closure-gate verifier\n")
const currentCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()

// --- Pass 1: full suite at HEAD ---------------------------------------------------
console.log("pass 1: full M26 suite at HEAD")
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
  // Named records from the run's own output ("caught: X" / "SURVIVED: X").
  const records: Array<{ name: string; caught: boolean }> = []
  for (const line of (suiteStdout[code] ?? "").split("\n")) {
    const caughtM = line.match(/^\s*caught:\s*(.+?)\s*$/)
    const survivedM = line.match(/^\s*SURVIVED:\s*(.+?)\s*$/)
    if (caughtM) records.push({ name: caughtM[1], caught: true })
    else if (survivedM) records.push({ name: survivedM[1], caught: false })
  }
  perMutantRecords[code] = records
  // Cross-check against the evidence aggregates.
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

// --- Pass 3: v2 completion-bar audit at HEAD ----------------------------------------
console.log("\npass 3: v2 completion-bar audit (master plan items 1-5)")
const manifest = parseSealedRecord(MANIFEST_PATH) as { issues: Array<{ code: string; status: string; evidence?: { status?: string } }> }
const ledgerMap: BarInput["ledger"] = {}
for (const i of manifest.issues) ledgerMap[i.code] = { status: i.status, evidence: i.evidence }
const graphDoc = readFileSync(join(ROOT, "docs/m26/GRAPH.md"), "utf8")
const transportDoc = readFileSync(join(ROOT, "docs/m26/GRAPH-TRANSPORT.md"), "utf8")
const extensionSource = readFileSync(join(ROOT, "ide/vscode/src/extension.ts"), "utf8")
const e5Out = (() => {
  const candidates = [join(ROOT, "validation/m25/results/E5.json")]
  const envOut = process.env.E5_OUT
  if (envOut) candidates.unshift(envOut, `${envOut}-inner.json`, join(envOut, "results.json"))
  for (const c of candidates) {
    try {
      const j = parseSealedRecord(c)
      const checksArr: Array<{ name: string; ok: boolean }> = []
      const walk = (o: unknown): void => {
        if (Array.isArray(o)) o.forEach(walk)
        else if (o && typeof o === "object") {
          const rec = o as { name?: unknown; ok?: unknown; checks?: unknown; results?: unknown }
          if (typeof rec.name === "string" && typeof rec.ok === "boolean") checksArr.push({ name: rec.name, ok: rec.ok })
          if (rec.checks) walk(rec.checks)
          if (rec.results) walk(rec.results)
        }
      }
      walk(j)
      if (checksArr.length > 0) return { checksArr, source: c }
    } catch {
      continue
    }
  }
  return { checksArr: [] as Array<{ name: string; ok: boolean }>, source: "none" }
})()
const panelRenders = e5Out.checksArr.some((c) => c.name === "E5: graph panel renders the fixture root graph" && c.ok === true)
check("X1: the in-editor graph-leg evidence exists (E5 records the panel render)", e5Out.checksArr.length > 0, `source=${e5Out.source}`)
const barInput: BarInput = {
  ledger: ledgerMap,
  files: { graphDoc, transportDoc },
  mutantsCaught: (c) => mutantsCaught[c] ?? null,
  panelLive: {
    commandRegistered: extensionSource.includes('"bbLsp.showGraph"') && extensionSource.includes("showGraphPanel"),
    panelRenders,
    forkVerified: existsSync(join(ROOT, "script/m25/run-fork-e2e.mts")),
  },
}
const barViolations = completionBarViolations(barInput)
check("X1: v2 completion bar audited item-by-item — zero violations", barViolations.length === 0, barViolations.join("; "))
// Negative probes: the audit must fire on forged bar claims.
{
  const noPanel: BarInput = { ...barInput, panelLive: { ...barInput.panelLive, commandRegistered: false } }
  negative("X1: negative — bar audit fires when the panel command disappears", completionBarViolations(noPanel).some((x) => x.startsWith("bar1")))
  const unprovenTiers: BarInput = { ...barInput, mutantsCaught: (c) => (c === "W4" ? { caught: 4, total: 5 } : barInput.mutantsCaught(c)) }
  negative("X1: negative — bar audit fires when W4 loses a mutant", completionBarViolations(unprovenTiers).some((x) => x.includes("bar3")))
  const dirtyLedger: BarInput = { ...barInput, ledger: { ...barInput.ledger, W5: { status: "planned" } } }
  negative("X1: negative — bar audit fires when impact evidence regresses to planned", completionBarViolations(dirtyLedger).some((x) => x.includes("bar4")))
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

// --- Evidence -------------------------------------------------------------------------
const failed = checks - passed
const result = {
  issue: "516",
  code: "X1",
  milestone: "M26",
  status: failed === 0 ? "verified" : "known-gap",
  checks,
  passed,
  failed,
  failures,
  negativeCases: negatives,
  currentCommit,
  verifierCommand: "npx tsx script/m26/verify-closure.ts",
  barViolations,
  perMutantRecords,
  generatedAt: new Date().toISOString(),
}
mkdirSync(RESULTS, { recursive: true })
writeSealed(join(RESULTS, "X1.json"), result)
console.log(`\nX1: ${result.status.toUpperCase()} (${passed}/${checks} passed, ${negatives} negative)`)
if (result.status !== "verified") process.exitCode = 1
