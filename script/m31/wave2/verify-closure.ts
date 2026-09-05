// script/m31/wave2/verify-closure.ts — M31.X1 (wave-2 closure, wave-1 pattern)
//
// Milestone 31 closes ONLY through this gate (wave-2 side). It verifies at the
// closure stamp:
//   1. Every wave-2 issue (D4/G2/F1/D5/G3) carries conforming "verified"
//      evidence; the four CONTENT gates share ONE identical currentCommit (the
//      closure stamp). G3 (governance) is a harness artifact — conformance +
//      verified status only, no stamp equality (2-cycle dependency, wave-1
//      lesson).
//   2. Content currency at the closure stamp: every content gate re-runs HERE
//      read-only (BB_M31_READ_ONLY=1) — truth is observed content, not commit
//      age. Shared surfaces the wave-2 doc work touched (byte gate, M35
//      staleness gate, wave-1 doc gates) re-run too, so wave-1 survival is
//      proven by execution, not by evidence age.
//   3. Mutation sweep: each non-infra content gate (D4/G2/F1/D5) is run under
//      its registered seam and MUST exit non-zero (a gate that cannot fail is
//      not a gate). Seams: D4 skip-tool, G2 skip-tool, F1 site-entry removal,
//      D5 skip-knobs.
//   4. Ledger: all wave-2 subordinate entries verified; X1 evidence-backed.
//   5. Wave-1 survival: wave-1 ledger entries remain all-verified.
//
// Exit 0 = milestone closeable at this stamp; exit 1 = NOT closeable.

import { readFileSync, existsSync, readdirSync, mkdirSync, writeFileSync } from "node:fs"
import { execFileSync, spawnSync } from "node:child_process"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")
const RESULTS = path.join(ROOT, "validation/m31/wave2/results")
const WAVE2_SCRIPTS = path.join(ROOT, "script/m31/wave2")

let checks = 0, passed = 0
const failures: string[] = []
function check(label: string, ok: boolean, detail = "") {
  checks++
  if (ok) passed++
  else { failures.push(`${label}${detail ? ` — ${detail}` : ""}`); console.log(`FAIL: ${label}${detail ? ` — ${detail}` : ""}`) }
}

const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()

function evidenceConforms(ev: Record<string, unknown> | undefined): boolean {
  if (!ev) return false
  return ev.status === "verified"
    && typeof ev.currentCommit === "string" && (ev.currentCommit as string).length === 40
    && Array.isArray(ev.workingTreeRelevantChanges) && (ev.workingTreeRelevantChanges as unknown[]).length === 0
    && typeof ev.verifierCommand === "string" && (ev.verifierCommand as string).length > 0
    && Number(ev.passed) > 0 && Number(ev.failed) === 0 && Number(ev.negativeCases) > 0
}

function runScript(script: string, extraEnv: Record<string, string> = {}, label = script): number {
  const res = spawnSync("bun", ["run", script], {
    cwd: ROOT, encoding: "utf8",
    env: { ...process.env, BB_M31_READ_ONLY: "1", ...extraEnv },
    timeout: 600_000,
  })
  const status = res.status ?? 1
  if (status !== 0) {
    const out = (res.stdout ?? "").trim().split("\n").slice(-4).join(" | ")
    const err = (res.stderr ?? "").trim().split("\n").slice(-4).join(" | ")
    console.log(`  [child ${label} exited ${status}] out: ${out}`)
    if (err) console.log(`  [child ${label} stderr] ${err}`)
  }
  return status
}

// ── 1. subordinate evidence: conforming + single content closure stamp ──
const CONTENT = ["D4", "G2", "F1", "D5"] as const
const stamps = new Map<string, string>()
for (const code of [...CONTENT, "G3"]) {
  const file = path.join(RESULTS, `${code}.json`)
  if (!existsSync(file)) { check(`${code}: evidence exists`, false, file); continue }
  const ev = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>
  check(`${code}: evidence conforms`, evidenceConforms(ev), JSON.stringify(ev).slice(0, 110))
  if ((CONTENT as readonly string[]).includes(code) && typeof ev.currentCommit === "string") stamps.set(code, ev.currentCommit)
}
const uniqueStamps = new Set(stamps.values())
check("all content-gate evidence shares ONE closure stamp", stamps.size === CONTENT.length && uniqueStamps.size === 1, [...uniqueStamps].join(","))

// ── 2. content + shared-surface currency at the closure stamp (read-only) ─
check("byte gate: docs/tools match generator at closure stamp", runScript("script/verify-tool-docs.ts") === 0, "")
check("M35 staleness gate (bb_health truth surface)", runScript("script/m35/verify-docs-staleness.ts") === 0, "")
check("wave-1: per-tool docs deep gate", runScript("script/m31/verify-tool-docs-deep.ts") === 0, "")
check("wave-1: BB_*.md truth gate", runScript("script/m31/verify-bb-docs-truth.ts") === 0, "")
check("wave-1: tools-overview gate", runScript("script/m31/verify-tools-overview.ts") === 0, "")
check("wave-2 governance (read-only)", runScript("script/m31/wave2/verify-governance.ts") === 0, "")
for (const code of CONTENT) {
  check(`wave-2 content gate ${code} passes read-only at closure`, runScript(`script/m31/wave2/${scriptFor(code)}`) === 0, "")
}

// ── 3. mutation sweep: every non-infra gate must fail under its seam ──
const SEAMS: Record<string, string> = {
  D4: "BB_M31_MUTATE_D4_SKIP=bb_annotate",
  G2: "BB_M31_MUTATE_G2_SKIP=bb_search",
  F1: "BB_M31_MUTATE_F1_SKIP=bb_search",
  D5: "BB_M31_MUTATE_D5_SKIP_KNOBS=1",
}
const mutationResults: Record<string, { control: number; mutation: number }> = {}
for (const code of CONTENT) {
  const control = runScript(`script/m31/wave2/${scriptFor(code)}`)
  const env: Record<string, string> = {}
  for (const pair of SEAMS[code].split(" ")) { const [k, v] = pair.split("="); env[k] = v }
  const mutation = runScript(`script/m31/wave2/${scriptFor(code)}`, env)
  mutationResults[code] = { control, mutation }
  check(`${code}: control passes, mutation fails (gate can refuse)`, control === 0 && mutation !== 0, `control=${control} mutation=${mutation}`)
}

// ── 4. wave-2 ledger state ──
const ledger = JSON.parse(readFileSync(path.join(ROOT, "validation/m31/wave2/ledger.json"), "utf8")) as Array<Record<string, any>>
const notVerified = ledger.filter((i) => i.code !== "X1" && i.status !== "verified").map((i) => i.code)
check("all wave-2 subordinate ledger entries are verified", notVerified.length === 0, notVerified.join(","))
// X1 is closure infra, registered in gates-registry.json but intentionally NOT
// a ledger row (wave-2 governance forbids extra ledger codes); its artifact is
// this run's own X1.json evidence, written below when green.

// ── 5. wave-1 survival: sealed system still all-verified ──
const w1Ledger = JSON.parse(readFileSync(path.join(ROOT, "validation/m31/ledger.json"), "utf8")) as Array<Record<string, any>>
const w1NotVerified = w1Ledger.filter((i) => i.status !== "verified").map((i) => i.code)
check("wave-1 ledger still all-verified (sealed system survived)", w1NotVerified.length === 0, w1NotVerified.join(","))

// ── emit X1 evidence ──
const ok = failures.length === 0
console.log(`M31 WAVE-2 CLOSURE GATE: ${passed}/${checks} passed`)
if (process.env.BB_M31_READ_ONLY !== "1") {
  mkdirSync(RESULTS, { recursive: true })
  writeFileSync(path.join(RESULTS, "X1.json"), JSON.stringify({
    issue: "M31.X1-wave2", gate: "verify-closure.ts",
    status: ok ? "verified" : "blocked",
    passed, failed: failures.length, checks,
    workingTreeRelevantChanges: [],
    verifierCommand: "bun run script/m31/wave2/verify-closure.ts",
    evidenceFile: "X1.json",
    generatedAt: new Date().toISOString(),
    closureStamp: [...uniqueStamps][0] ?? head,
    mutationSweep: mutationResults,
    negativeCases: CONTENT.length,
    negativeCasesDescription: "per-gate mutation seams: every content gate must fail under its registered corruption",
    currentCommit: head,
  }, null, 2))
}
process.exit(ok ? 0 : 1)

function scriptFor(code: string): string {
  return { D4: "verify-d4-new-tool-docs.ts", G2: "verify-g2-doc-surface.ts", F1: "verify-f1-truth-feed.ts", D5: "verify-d5-freshness-docs.ts" }[code] ?? ""
}
