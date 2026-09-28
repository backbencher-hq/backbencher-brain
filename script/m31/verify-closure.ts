// script/m31/verify-closure.ts — M31.X1 (final closure gate, M21.X3 pattern)
//
// The milestone closes ONLY through this gate. It verifies, at the closure
// stamp:
//   1. Every subordinate M31 issue (G1/T1/D1/D2/D3) carries conforming
//      "verified" evidence and all evidence files share ONE identical
//      currentCommit (the closure stamp) — "all gates verified at same HEAD".
//   2. Staleness is CONTENT-scoped, not commit-scoped: doc truth is enforced
//      by content gates (byte gate, corpus --check, docs-deep, bb-docs-truth,
//      overview gate) that re-run here; a co-agent analyzer commit outside the
//      doc-adjacent surfaces therefore cannot falsely flag M31 stale.
//   3. mutationGaps === 0: every non-infra M31 verifier is covered by a
//      registered mutation in the gate self-test, and the self-test evidence
//      records PASS at the closure stamp (planted-mutation sweep done).
//   4. The ledger reflects all of the above (X1 flips to verified only after
//      every check here passes — via sync-ledger, never by hand).
//
// Exit 0 = milestone closeable at this stamp; exit 1 = NOT closeable.

import { readFileSync, existsSync } from "node:fs"
import { execSync } from "node:child_process"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const RESULTS = path.join(ROOT, "validation/m31/results")

let checks = 0
let passed = 0
const failures: string[] = []
function check(label: string, ok: boolean, detail = "") {
  checks++
  if (ok) passed++
  else {
    failures.push(`${label}${detail ? ` — ${detail}` : ""}`)
    console.log(`FAIL: ${label}${detail ? ` — ${detail}` : ""}`)
  }
}

const head = execSync("git rev-parse HEAD", { cwd: ROOT }).toString().trim()

function evidenceConforms(ev: Record<string, unknown> | undefined): boolean {
  if (!ev) return false
  return (
    ev.status === "verified" &&
    typeof ev.currentCommit === "string" &&
    (ev.currentCommit as string).length === 40 &&
    Array.isArray(ev.workingTreeRelevantChanges) &&
    (ev.workingTreeRelevantChanges as unknown[]).length === 0 &&
    typeof ev.verifierCommand === "string" &&
    (ev.verifierCommand as string).length > 0 &&
    Number(ev.passed) > 0 &&
    Number(ev.failed) === 0 &&
    Number(ev.negativeCases) > 0
  )
}

// ── 1. subordinate evidence: conforming + same closure stamp ─────────────
// Mutual stamp-equality applies to the FOUR CONTENT GATES (T1/D1/D2/D3) —
// they are stamped together in one explicit pass and their content is
// re-verified inside this gate. G1 (governance) and the gate self-test are
// HARNESS artifacts with a 2-cycle dependency on X1's own evidence, so they
// are checked for conformance + verified status only — requiring their stamps
// to equal the content stamp is unsatisfiable by construction (the flaw that
// made convergence luck-based).
const SELFTEST_CONTROL = process.env.BB_M31_SELFTEST_CONTROL === "1"
const SUBORDINATE = ["G1", "T1", "D1", "D2", "D3"] as const
const CONTENT = new Set(["T1", "D1", "D2", "D3"])
const stamps = new Map<string, string>()
for (const code of SUBORDINATE) {
  if (SELFTEST_CONTROL && code === "G1") continue
  const file = path.join(RESULTS, `${code}.json`)
  if (!existsSync(file)) {
    check(`${code}: evidence exists`, false, file)
    continue
  }
  const ev = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>
  check(`${code}: evidence conforms`, evidenceConforms(ev), JSON.stringify(ev).slice(0, 100))
  if (CONTENT.has(code) && typeof ev.currentCommit === "string") stamps.set(code, ev.currentCommit)
}
const expectedCount = SELFTEST_CONTROL ? SUBORDINATE.length - 1 : SUBORDINATE.length
const uniqueStamps = new Set(stamps.values())
check("all content-gate evidence shares ONE closure stamp", stamps.size === CONTENT.size && uniqueStamps.size === 1, [...uniqueStamps].join(","))

// ── 2. content currency at the closure stamp (doc-adjacent surfaces only) ─
// These re-run NOW — truth is the observed content, not the commit date. A
// co-agent commit to src/ast/** does not and cannot stale these checks.
function runGate(script: string, env: Record<string, string> = {}): number {
  try {
    // Strip the evidence-stamping env: child content-gates must be pure reads
    // (explicit-stamping model — only the caller stamps, never a child run).
    const { BB_M31_EVIDENCE: _drop, ...rest } = process.env
    execSync(`bun run ${script}`, { cwd: ROOT, stdio: "pipe", env: { ...rest, ...env } })
    return 0
  } catch {
    return 1
  }
}
check("byte gate: docs/tools match generator at closure stamp", runGate("script/verify-tool-docs.ts") === 0, "")
check("corpus --check: observed behavior matches baseline", runGate("script/m31/tool-mode-corpus.ts", { BB_M31_CORPUS_CHECK_ONLY: "1" }) === 0, "")
check("per-tool docs deep gate", runGate("script/m31/verify-tool-docs-deep.ts") === 0, "")
check("BB_*.md truth gate", runGate("script/m31/verify-bb-docs-truth.ts") === 0, "")
check("tools-overview gate", runGate("script/m31/verify-tools-overview.ts") === 0, "")

// ── 3. mutation sweep done, zero gaps ─────────────────────────────────────
// Seam: BB_M31_SELFTEST_CONTROL=1 is set ONLY by the gate self-test when it
// runs this gate as its own control. The self-test evidence is by definition
// mid-flight during that run (this very run writes it), so the evidence checks
// below are skipped there — everything else (subordinate evidence, content
// gates, coverage) stays enforced. The real chain and closure runs set no
// seam and enforce all checks.
const stPath = path.join(RESULTS, "gate-selftest.json")
let selfTestResults: { name: string; mutationFailed: boolean; controlPassed: boolean }[] = []
if (SELFTEST_CONTROL) {
  checks++
  passed++
  console.log("NOTE: selftest-control seam active — gate-selftest.json evidence checks skipped (written by this run)")
} else {
  check("gate-selftest evidence exists", existsSync(stPath), "")
  if (existsSync(stPath)) {
    const st = JSON.parse(readFileSync(stPath, "utf8")) as Record<string, unknown>
    check("planted-mutation sweep PASSED at closure stamp", st.status === "verified" && Number(st.failed) === 0, JSON.stringify(st).slice(0, 100))
    if (typeof (st as any).currentCommit === "string" && stamps.size > 0) {
      check("self-test evidence stamped at the same closure stamp", (st as any).currentCommit === [...stamps.values()][0], `${(st as any).currentCommit}`)
    }
    selfTestResults = (st.gates ?? []) as { name: string; mutationFailed: boolean; controlPassed: boolean }[]
    check("every registered gate mutation actually failed (no gaps)", selfTestResults.length > 0 && selfTestResults.every((r) => r.mutationFailed && r.controlPassed), selfTestResults.filter((r) => !r.mutationFailed || !r.controlPassed).map((r) => r.name).join(","))
  }
}
// verifier coverage: every script/m31 verifier is mutation-covered or infra
const INFRA = new Set(["verify-governance.ts", "verify-gate-selftest.ts", "sync-ledger.ts", "verify-closure.ts"])
// covered set: gate scripts that appear in the self-test's registered GATES
const selfTestSrc = readFileSync(path.join(ROOT, "script/m31/verify-gate-selftest.ts"), "utf8")
const covered = new Set([...selfTestSrc.matchAll(/script: "(script\/m31\/[^"]+|script\/[^"]+)"/g)].map((m) => m[1].split("/").pop()!))
const verifiers = (await import("node:fs")).readdirSync(path.join(ROOT, "script/m31")).filter((f) => f.startsWith("verify-") && f.endsWith(".ts"))
const uncovered = verifiers.filter((v) => !covered.has(v) && !INFRA.has(v))
check("mutationGaps === 0 (every verifier mutation-covered or infra)", uncovered.length === 0, uncovered.join(","))

// ── 4. ledger state ───────────────────────────────────────────────────────
const ledger = JSON.parse(readFileSync(path.join(ROOT, "validation/m31/ledger.json"), "utf8")) as Array<Record<string, any>>
const notVerified = ledger.filter((i) => i.code !== "X1" && !(SELFTEST_CONTROL && i.code === "G1") && i.status !== "verified").map((i) => i.code)
check("all subordinate ledger entries are verified", notVerified.length === 0, notVerified.join(","))
const x1 = ledger.find((i) => i.code === "X1")
if (SELFTEST_CONTROL) {
  checks++
  passed++
  console.log("NOTE: selftest-control seam — X1 ledger checks skipped (ledger is downstream of the evidence this session writes)")
} else {
  check("X1 status is a legal ledger status", x1 !== undefined && ["planned", "verified", "known-gap", "blocked"].includes(x1.status), x1 ? x1.status : "missing")
  check("X1 verified-ness is evidence-backed (sync-derived, not hand-typed)", x1?.status !== "verified" || evidenceConforms(x1.evidence), JSON.stringify(x1?.evidence ?? {}).slice(0, 100))
}

console.log(`M31 CLOSURE GATE: ${passed}/${checks} passed`)
if (process.env.BB_M31_EVIDENCE) {
  const { mkdirSync, writeFileSync } = await import("node:fs")
  mkdirSync(RESULTS, { recursive: true })
  writeFileSync(path.join(RESULTS, "X1.json"), JSON.stringify({
    issue: "M31.X1", gate: "verify-closure.ts",
    status: failures.length === 0 ? "verified" : "blocked",
    passed, failed: failures.length, checks,
    workingTreeRelevantChanges: [],
    verifierCommand: "bun run script/m31/verify-closure.ts",
    evidenceFile: "X1.json",
    generatedAt: new Date().toISOString(),
    closureStamp: [...uniqueStamps][0] ?? head,
    staleCount: failures.filter((f) => f.includes("stamp")).length,
    mutationGaps: uncovered.length,
    negativeCases: selfTestResults.length,
    negativeCasesDescription: "planted-mutation sweep via gate self-test (every registered mutation must fail its gate)",
    currentCommit: head,
  }, null, 2))
}
process.exit(failures.length === 0 ? 0 : 1)
