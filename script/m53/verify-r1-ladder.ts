// script/m53/verify-r1-ladder.ts — M53.R1 (issue #731).
//
// Runs the LSP-lane gate ladder (m24→m44 verify chain — the exact gates the
// shared npm verify chain carries for this lane) as subprocesses at the
// CURRENT HEAD, records each gate's exit code and last verdict line, and
// persists validation/m53/results/R1.json. R1 passes only when every gate
// exits 0 at this commit.
//
// Can-fail: the ladder demonstrably failed during this milestone (U5 gate
// 14/33 against the killing fixture BEFORE the M53 fix — recorded in the
// committed evidence trail). `--self-test` additionally injects one
// guaranteed-failing gate and asserts the R1 verdict flips.
//
// Run: npx tsx script/m53/verify-r1-ladder.ts [--self-test]

import { execFileSync, spawnSync } from "node:child_process"
import { writeFileSync, mkdirSync } from "node:fs"
import path from "node:path"
import { writeSealed } from "../lib/evidence.ts"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const OUT = path.join(ROOT, "validation/m53/results/R1.json")

// The authoritative lane ladder (mirrors the shared verify chain's m24→m44
// section — script/m53 is not the authority for gate membership; the chain
// is. Any gate added there must be added here and vice versa).
const GATES: Array<[string, string]> = [
  // m24 — the server
  ["m24-closure", "script/m24/verify-closure.ts"],
  // m25 — the extension
  ["m25-auto-index", "script/m25/verify-auto-index.ts"],
  ["m25-harness-core", "script/m25/verify-harness-core.ts"],
  ["m25-closure", "script/m25/verify-closure.ts"],
  // m26 — the graph
  ["m26-webview-core", "script/m26/verify-webview-core.ts"],
  ["m26-content-security", "script/m26/verify-content-security.ts"],
  ["m26-cross-lang", "script/m26/verify-cross-language-hover.ts"],
  ["m26-evidence-badges", "script/m26/verify-evidence-badges.ts"],
  ["m26-graph-docs", "script/m26/verify-graph-docs.ts"],
  ["m26-graph-transport", "script/m26/verify-graph-transport.ts"],
  ["m26-impact-mode", "script/m26/verify-impact-mode.ts"],
  ["m26-webview-harness", "script/m26/verify-webview-harness.ts"],
  ["m26-closure", "script/m26/verify-closure.ts"],
  // m27 — other editors
  ["m27-nvim", "script/m27/verify-nvim.ts"],
  ["m27-zed", "script/m27/verify-zed.ts"],
  ["m27-helix", "script/m27/verify-helix.ts"],
  ["m27-closure", "script/m27/verify-closure.ts"],
  // m28 — the union
  ["m28-union", "script/m28/verify-union.ts"],
  ["m28-mcp-tools", "script/m28/verify-mcp-tools.ts"],
  ["m28-annotation-store", "script/m28/verify-annotation-store.ts"],
  ["m28-annotation-ui", "script/m28/verify-annotation-ui.ts"],
  ["m28-closure", "script/m28/verify-closure.ts"],
  // m29 — the wave program (must precede the m42/m44 closures: those spawn
  // the m29 governance bar, so its evidence must be re-stamped first —
  // learned empirically when the ladder tripped its own freshness rule)
  ["m29-wave-protocol", "script/m29/verify-wave-protocol.ts"],
  ["m29-precision-ledger", "script/m29/verify-precision-ledger.ts"],
  ["m29-precision-improvements", "script/m29/verify-precision-improvements.ts"],
  ["m29-m29-docs", "script/m29/verify-m29-docs.ts"],
  ["m29-closure", "script/m29/verify-closure.ts"],
  // m42 — the interactive hover (after m29: spawns the m29 bar)
  ["m42-enrichment", "script/m42/verify-enrichment-surface.ts"],
  ["m42-highlight", "script/m42/verify-highlight.ts"],
  ["m42-hover-actions", "script/m42/verify-hover-actions.ts"],
  ["m42-hub", "script/m42/verify-hub.ts"],
  ["m42-hub-nav", "script/m42/verify-hub-navigation.ts"],
  ["m42-rich-hover", "script/m42/verify-rich-hover.ts"],
  ["m42-closure", "script/m42/verify-closure.ts"],
  // m44 — the understandable hub (last: spawns the m42 bar)
  ["m44-hub-tree", "script/m44/verify-hub-tree.ts"],
  ["m44-impact-resolution", "script/m44/verify-impact-resolution.ts"],
  ["m44-legend", "script/m44/verify-legend.ts"],
  // U2's owner gate: derives U2's record from the m26 webview harness record
  // (it must run AFTER m26-webview-harness above, whose fresh record it reads).
  ["m44-hub-list", "script/m44/verify-hub-list.ts"],
  ["m44-usages-fallback", "script/m44/verify-usages-fallback.ts"],
  ["m44-usages-groups", "script/m44/verify-usages-groups.ts"],
  ["m44-closure", "script/m44/verify-closure.ts"],
]

function gitHead(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
  } catch {
    return "unknown"
  }
}

function runGate(script: string, extraArgs: string[] = []): { rc: number; verdict: string; timedOut: boolean } {
  const r = spawnSync("npx", ["tsx", script, ...extraArgs], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 2_400_000,
  })
  const out = (r.stdout ?? "") + (r.stderr ?? "")
  const m = out.match(/(VERIFIED|KNOWN-GAP|BLOCKED|PASS|FAIL)[^\n]*/g)
  const verdict = m ? m[m.length - 1].slice(0, 160) : "(no verdict line)"
  // A TIMEOUT IS NOT A FAILURE, and this function conflated the two.
  //
  // `r.status` is null when spawnSync kills the child, so `r.status ?? 1` turned
  // "this gate ran out of budget" into "this gate returned 1" — the one number
  // the aggregate counts. Measured, not inferred: script/m26/verify-closure.ts
  // takes 8m00s wall on an idle machine and prints `X1: VERIFIED` with exit 0,
  // against a 900s budget here. Under the ladder's own load that inflates past
  // 900s, the child is SIGTERM'd before it prints a verdict, and the ladder
  // records `rc=1 :: (no verdict line)` — which reads as a content failure and
  // sends triage to the wrong file. It is a BUDGET failure, and the honest
  // signal is the absence of a verdict line, not the number 1.
  //
  // So the timeout is surfaced as its own field. A gate that fails on its
  // content still returns rc=1 with a verdict; a gate that ran out of budget
  // returns timedOut with rc=0 so it does not contaminate the content count,
  // and the aggregate counts timeouts separately. Folding them together is
  // exactly what made this undiagnosable in the first place.
  const timedOut = !!r.error || r.signal === "SIGTERM"
  return { rc: timedOut ? 0 : (r.status ?? 1), verdict, timedOut }
}

// --- The can-fail proof (the degenerate aggregate) ----------------------------
// Proves the aggregation flips on a failing gate WITHOUT re-running the whole
// ladder: the always-failing gate is executed for real (rc must be 1) and the
// same aggregate() the ladder uses must mark the run not-ok.
//
// M61.V6 (#847): this proof used to run only under `--self-test`, so R1.json
// carried counts and no can-fail proof — the verifier lint's registry flagged
// it as a promise owed to this issue. It now runs on EVERY ladder invocation
// and its result is recorded in the evidence.
const aggregate = (rs: Array<{ rc: number }>): number => rs.filter((g) => g.rc !== 0).length
function selfTest(): { flipped: boolean; rc: number; timedOut: boolean } {
  const bogus = runGate("script/m53/does-not-exist-gate.ts")
  // A gate that does not exist fails FAST, so it must report rc!=0 and timedOut=false.
  // Asserting timedOut=false here is what stops the timeout carve-out from
  // swallowing real failures: if a missing script were misread as a timeout, the
  // can-fail proof would pass while the ladder proved nothing.
  return { flipped: bogus.rc !== 0 && !bogus.timedOut && aggregate([{ rc: 0 }, { rc: bogus.rc }]) > 0, rc: bogus.rc, timedOut: bogus.timedOut }
}
if (process.argv.includes("--self-test")) {
  const st = selfTest()
  if (!st.flipped) {
    console.error("SELF-TEST FAILED: an always-failing gate did NOT flip the R1 verdict")
    process.exit(1)
  }
  console.log("SELF-TEST PASSED: an always-failing gate (rc=1) flips the R1 verdict")
  process.exit(0)
}

// --- The ladder --------------------------------------------------------------
console.log(`R1: running the ${GATES.length}-gate lane ladder at ${gitHead().slice(0, 8)}`)
const results = GATES.map(([name, script]) => {
  const r = runGate(script)
  // `?` for a timeout: neither a pass nor a content failure, and the reason is on
  // the line. A silent pass here would be the same failure as the silent skip in
  // the verify chain — an unread row that looks like a green one.
  const mark = r.timedOut ? "?" : r.rc === 0 ? "✓" : "✗"
  const ok = r.rc === 0
  console.log(`  ${mark} ${name} rc=${r.rc}${r.timedOut ? " TIMED OUT" : ""} :: ${r.verdict}`)
  return { name, script, rc: r.rc, verdict: r.verdict, ok, timedOut: r.timedOut }
})

const failed = results.filter((g) => !g.ok)
const timedOut = results.filter((g) => g.timedOut)
// The can-fail proof, recorded every run (M61.V6 / #847).
const st = selfTest()
const mutantsCaught = st.flipped ? 1 : 0
const mutantsTotal = 1
const checksList = [
  `${st.flipped ? "ok" : "FAIL"}: M: degenerate-aggregate — a bogus gate (rc=${st.rc}) flips the R1 verdict`,
  `${timedOut.length === 0 ? "ok" : "FAIL"}: M: no-gate-timed-out — ${timedOut.length} of ${results.length} exceeded the budget; a timeout is never a pass and never a content failure`,
  ]
// A timeout makes the run NOT ok. It is separated from `failed` so triage can tell
// "this gate is wrong" from "this gate did not finish", but it is never allowed to
// pass silently, which is the whole point of the distinction.
const ok = failed.length === 0 && timedOut.length === 0 && st.flipped
const result = {
  issue: "M53.R1",
  code: "R1",
  milestone: "M53",
  status: ok ? "verified" : "known-gap",
  passed: results.length - failed.length,
  failed: failed.length,
  mutantsCaught,
  mutantsTotal,
  checksList,
  canFail: { name: "degenerate-aggregate", flipped: st.flipped, bogusRc: st.rc },
  gatesTotal: results.length,
  gates: results,
  currentCommit: gitHead(),
  verifierCommand: "npx tsx script/m53/verify-r1-ladder.ts",
  generatedAt: new Date().toISOString(),
}
mkdirSync(path.dirname(OUT), { recursive: true })
writeSealed(OUT, result)
console.log(`R1: ${result.status.toUpperCase()} (${result.passed}/${results.length} gates green, ${mutantsCaught}/${mutantsTotal} can-fail proof)`)
console.log(`Evidence: ${OUT}`)
process.exit(ok ? 0 : 1)
