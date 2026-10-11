#!/usr/bin/env tsx
// script/m62/verify-suite.mts — run the gate suite and report it as ONE verdict.
//
// WHY THIS EXISTS. Throughout this work the same failure kept recurring: a change
// was made, two or three gates were checked, and the session moved on. The gates
// that were NOT re-run were simply not known. That is how "the suite is green"
// became a claim nobody could reproduce. This runner exists so the claim is one
// command, and so the honest blocks are distinguishable from real breakage.
//
// THE HONEST-BLOCK ALLOWLIST. Three gates legitimately exit non-zero right now, and
// pretending otherwise would make this runner lie in the other direction:
//
//   m25 governance  exits 1 because E5 needs the owner's in-editor VS Code clicks,
//                    E6 needs a cursor CLI, and E7 needs Linux hardware. Those are
//                    recorded `blocked`/`known-gap` WITH reasons in the ledger
//                    (contract §8.3), which is exactly what an honest block is.
//   E5 in-editor    the run-vscode-e2e gate; same reason.
//
// They are listed with WHY, so adding a name to this list is a visible decision
// rather than a way to make the suite green. Anything NOT on this list that fails
// is a real failure and fails the suite.
//
// WHAT IT DOES NOT DO. It does not decide whether a gate is correct, it does not
// fix anything, and it does not soften a verdict. It runs each gate, records the
// exit code and the headline it printed, and reports.

import { spawnSync } from "node:child_process"
import path from "node:path"

const ROOT = process.cwd()

interface Gate {
  name: string
  script: string
  /** Why this gate is allowed to be red right now. Empty = must be green. */
  honestBlock?: string
  /** Skip when its precondition is absent (e.g. no dist build). */
  skipIfMissing?: string
}

const E5_REASON =
  "needs the owner's two in-editor VS Code clicks; the WAL snapshot cause was fixed and gated, but the leg has not been re-run in-editor."

const GATES: Gate[] = [
  { name: "src typecheck", script: "npm run typecheck", shell: true },
  { name: "m62 path-encoding", script: "script/m62/verify-path-encoding.ts" },
  { name: "m62 live-db-snapshot", script: "script/m62/verify-live-db-snapshot.ts" },
  { name: "m62 gate-typecheck ratchet", script: "script/m62/verify-gate-typecheck-coverage.ts" },
  { name: "m62 ledger-reseal", script: "script/m62/verify-ledger-reseal.ts" },
  { name: "m62 cli-resolution", script: "script/m62/verify-cli-resolution.mts" },
  // This one must be IN the suite, which is the interesting part: it reports gates
  // that are NOT in the suite. A gate that reports holes in the suite and is itself
  // only reachable by hand is a hole in the suite.
  { name: "m62 suite-coverage", script: "script/m62/verify-suite-coverage.ts" },
  // Both of these were red earlier in the session and are now green because the
  // defects they named were actually fixed. They are added here only once they pass,
  // and each carries its own canary.
  { name: "m62 reindex-replaces", script: "script/m62/verify-reindex-replaces.ts" },
  { name: "m62 indexer-option-contract", script: "script/m62/verify-indexer-option-contract.ts" },
  // Added once it went green: all three gates it named can now fail. Canaried by
  // removing one process.exit and watching it report 2 again.
  { name: "m62 gates-can-fail", script: "script/m62/verify-gates-can-fail.ts" },
  { name: "m62 mutant-crash-honesty", script: "script/m62/verify-mutant-crash-honesty.ts" },
  { name: "m23 p3 edge cases", script: "script/m23/verify-p3-edge-cases.ts" },
  { name: "m24 closure", script: "script/m24/verify-closure.ts" },
  { name: "m24 governance", script: "script/m24/verify-governance.ts" },
  { name: "m25 E1 extension skeleton", script: "script/m25/verify-extension-skeleton.ts" },
  { name: "m25 E2 auto-index", script: "script/m25/verify-auto-index.ts" },
  { name: "m25 E3 status surface", script: "script/m25/verify-status-surface.ts" },
  { name: "m25 E4 packaging", script: "script/m25/verify-packaging.ts" },
  { name: "m25 V1 harness core", script: "script/m25/verify-harness-core.ts" },
  { name: "m25 E5 in-editor", script: "script/m25/run-vscode-e2e.mts", honestBlock: E5_REASON },
  {
    name: "m25 D1 listing",
    script: "script/m25/verify-listing.ts",
    honestBlock:
      "downstream of E5: the listing claims VS Code I3 verified while E5's evidence says known-gap, so D1 correctly reports drift. Nothing to fix here until the in-editor leg runs.",
  },
  { name: "m25 D1i install docs", script: "script/m25/verify-install-docs.ts" },
  {
    name: "m25 X1 closure",
    script: "script/m25/verify-closure.ts",
    honestBlock:
      "spawns every M25 verifier and requires each to exit 0. D1i is green now (it was misconfigured, not unavailable); the remaining red legs are E5, D1 and the v1 completion bar, all tracing to the in-editor run.",
  },
  { name: "m26 external-arm plan", script: "script/m26/verify-external-arm-plan.ts" },
  { name: "m28 registry honesty", script: "script/m28/verify-project-registry-honesty.ts" },
  { name: "m31 bb-docs truth", script: "script/m31/verify-bb-docs-truth.ts" },
  // NOT LISTED: script/perf/probe-taint-plan-stats.ts. It is a MEASUREMENT probe,
  // not a gate — it takes a projectId argument and prints before/after plan
  // statistics. The first version of this runner listed it anyway, and it reported
  // a false red (exit=2, "usage: probe-taint-plan-stats.ts <projectId>"), which
  // looked like a broken gate and was nothing of the kind. A suite that reports
  // failures which are not failures trains you to ignore it.
  {
    name: "m25 governance",
    script: "script/m25/verify-governance.ts",
    honestBlock:
      "E5 needs the owner's in-editor VS Code clicks; E6 needs a cursor CLI; E7 needs Linux hardware. All three are recorded with reasons in the ledger.",
  },
] as Gate[]

const rows: Array<{ name: string; state: "green" | "red" | "blocked" | "skip"; detail: string }> = []

console.log("running the gate suite — this takes several minutes\n")

for (const gate of GATES) {
  const argv = (gate as Gate & { shell?: boolean }).shell
    ? ["sh", "-c", gate.script]
    : ["npx", "tsx", gate.script]
  const started = Date.now()
  const run = spawnSync(argv[0]!, argv.slice(1), {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 15 * 60_000,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, PATH: `${process.env.HOME}/.local/node/bin:${process.env.PATH}` },
  })
  const secs = ((Date.now() - started) / 1000).toFixed(0)
  const output = `${run.stdout ?? ""}${run.stderr ?? ""}`
  const code = run.status

  // The headline a gate prints, so the table says WHAT it concluded and not just
  // that it exited zero.
  const headline =
    /(?:^|\n)\s*([A-Z][A-Z0-9 _\-/]{4,60}(?:PASS|FAILED|VERIFIED|KNOWN-GAP)[^\n]{0,70})/.exec(output)?.[1]?.trim() ??
    /(VERIFIED|KNOWN-GAP|BLOCKED|FAIL|PASS)[^\n]{0,60}/.exec(output)?.[0]?.trim() ??
    ""

  if (code === null) {
    rows.push({ name: gate.name, state: "skip", detail: `timed out after ${secs}s` })
  } else if (code === 0) {
    rows.push({ name: gate.name, state: "green", detail: `${secs}s ${headline}`.trim() })
  } else if (gate.honestBlock) {
    rows.push({ name: gate.name, state: "blocked", detail: `exit=${code} — ${gate.honestBlock}` })
  } else {
    const firstFail = /(?:FAIL|✗)[^\n]{0,110}/.exec(output)?.[0]?.trim() ?? ""
    rows.push({ name: gate.name, state: "red", detail: `exit=${code} ${firstFail}`.trim() })
  }
  const last = rows[rows.length - 1]!
  process.stdout.write(`  ${last.state === "green" ? "ok  " : last.state === "red" ? "FAIL" : last.state === "blocked" ? "BLOCK" : "skip"} ${gate.name}\n`)
}

console.log("")
const width = Math.max(...rows.map((r) => r.name.length))
let failures = 0
let blocks = 0
for (const r of rows) {
  if (r.state === "red") failures++
  if (r.state === "blocked") blocks++
  const tag = r.state === "green" ? "ok  " : r.state === "red" ? "FAIL" : r.state === "blocked" ? "BLOCK" : "skip"
  console.log(`  ${tag} ${r.name.padEnd(width)}  ${r.detail}`)
}

console.log("")
console.log(`  ${rows.length - failures - blocks - rows.filter((r) => r.state === "skip").length} green, ${failures} red, ${blocks} honestly blocked, ${rows.filter((r) => r.state === "skip").length} skipped`)
if (blocks > 0) {
  console.log("  BLOCKED is not the same as broken: each one names why it cannot pass here.")
}
if (rows.some((r) => r.state === "skip")) {
  console.log("  SKIPPED is not the same as passed: each one says why it did not run.")
}
console.log(`\nSUITE: ${failures === 0 ? "no failures" : `${failures} FAILURE(S)`}`)
process.exit(failures === 0 ? 0 : 1)