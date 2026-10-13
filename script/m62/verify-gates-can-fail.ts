#!/usr/bin/env tsx
// script/m62/verify-gates-can-fail.ts — a gate that CANNOT fail is not a gate.
//
// FOUND 2026-10-11 while canarying the crash-honesty fixes. script/m55/verify-
// call-hierarchy.ts was made to fail its mutants on purpose (every mutant import
// pointed at a non-existent path). The run printed:
//
//   T2: KNOWN-GAP (55/55 passed, 0/9 mutants caught, 9 not judged)     exit 0
//
// Fifty-five of fifty-five checks PASSED. Nine of nine mutants were caught by NOTHING.
// And the process exited 0.
//
// The reason is the third thing this class of bug has in common: the file computes a
// verdict STRING and prints it, and has no `process.exit` anywhere. `VERIFIED` and
// `KNOWN-GAP` are both just text on stdout. Whether the gate passes is decided by the
// reader, and every automated caller — the suite, `npm run verify` — reads only the
// exit code.
//
// This gate is in the `npm run verify` chain, so the whole chain inherits it: a green
// `bb verify` that means nothing for this leg.
//
// THE CLASS. Any file that calls a check-style verdict function, has no exit
// mechanism at all, AND is reachable from `npm run verify` or verify:suite.mts. The
// reachability test is what makes this actionable rather than a list: the other
// files in the sweep are libraries (script/m55/lsp-wire.ts, script/m61/governance_core
// .ts) or scratch probes, and flagging those would bury the real finding.
//
// WHAT A FIX LOOKS LIKE, and why this gate does not apply it itself: each of these
// needs its own harness's notion of failure turned into an exit code, and several
// share a `failures[]` array that a two-line ending already resolves. Applying a
// blanket `process.exit(failures.length ? 1 : 0)` from here would be exactly the kind
// of confident bulk edit that turns a reported problem into an unreported one — some
// of these gates exit non-zero today through a helper this scan cannot see, and some
// legitimately always exit 0 because they are modules.

import { readFileSync } from "node:fs"
import path from "node:path"

type Check = { name: string; ok: boolean; detail: string }
const checks: Check[] = []
const check = (name: string, ok: boolean, detail: string): void => {
  checks.push({ name, ok, detail })
  console.log(`  ${ok ? "ok  " : "FAIL"}: ${name} — ${detail}`)
}

// This gate stays red, and it is not in verify-suite.mts, until the gates it names can
// fail. That is the declaration script/m62/verify-suite-coverage.ts looks for.
//
// NOTE ON THE COUNT. A first version of this gate reported 69. Nearly all of those
// were FALSE POSITIVES: script/m13/harness.ts ends in `emit(): never { process.exit(
// doc.summary.failed === 0 ? 0 : 1) }`, and script/m64/verify-paths.ts imports that
// same harness as "../m13/harness" — so those gates propagate failure correctly and a
// scan that only looked inside the gate file could not see it. Canary: forcing one
// m13 gate's negative to false gave exit code 1.
//
// The gate now resolves a harness delegated through ANY relative import, and the count
// is 3. It is left reporting them rather than fixed here, because each needs its own
// harness's notion of failure turned into an exit code and some may already exit
// through a mechanism this scan still cannot see.

const ROOT = process.cwd()
const { walkSourceFiles } = await import("./path_encoding_scan.ts")

// --- reachability: what actually runs? ---------------------------------------
const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
  scripts?: Record<string, string>
}
const chain = Object.values(pkg.scripts ?? {}).join("\n")
const suiteSrc = readFileSync(path.join(ROOT, "script/m62/verify-suite.mts"), "utf8")
const runsInVerifyChain = (rel: string): boolean => chain.includes(rel)
const runsInSuite = (rel: string): boolean => suiteSrc.includes(rel)

const files = walkSourceFiles(path.join(ROOT, "script"))
  .filter((f) => f.endsWith(".ts") || f.endsWith(".mts"))
  .map((f) => path.relative(ROOT, f))

const noExit: string[] = []
const reachableNoExit: Array<{ file: string; where: string }> = []

for (const rel of files) {
  const src = readFileSync(path.join(ROOT, rel), "utf8")
  // It must actually assert something.
  if (!/\bcheck\s*\(|\bck\s*\(|\bnk\s*\(|\bmutant\s*\(/.test(src)) continue
  // A harness may delegate the exit to a helper. script/m13/harness.ts does exactly
  // that — `emit(): never { … process.exit(doc.summary.failed === 0 ? 0 : 1) }` — and
  // every m13 gate ends with `harness.emit()`.
  //
  // My first version only looked for an exit INSIDE the gate file and so reported 69
  // gates as unable to fail, nearly all of them m13. Canary: forcing one m13 gate's
  // `harness.negative(...)` to false gave exit code 1, so those gates propagate
  // failure correctly and the finding was an artefact of the scan.
  //
  // So the test now resolves the helper: if the file calls a harness method whose
  // declaration (in an imported sibling) contains process.exit, the gate can fail.
  const exitsDirectly = /process\.exit|exitCode|setExitCode/.test(src)
  let exitsViaHelper = false
  if (!exitsDirectly) {
    // Names imported from a local sibling module.
    // ANY relative sibling, at any depth: script/m64/verify-paths.ts imports the
    // m13 harness as "../m13/harness", which DOES exit. Resolving only "./x" would
    // have reported all seven m64 gates as unable to fail, which is wrong.
    const localPaths = [...src.matchAll(/from "(\.{1,2}\/[\w./-]+)"/g)].map((m) => m[1]!)
    for (const spec of localPaths) {
      const abs = path.join(path.dirname(path.join(ROOT, rel)), `${spec}.ts`)
      let helperSrc = ""
      try {
        helperSrc = readFileSync(abs, "utf8")
      } catch {
        continue
      }
      // The helper must actually set an exit code somewhere.
      if (!/process\.exit|exitCode|setExitCode/.test(helperSrc)) continue
      // And this gate must CALL something from it at the end of its run.
      const helperName = path.basename(spec).replace(/\.ts$/, "")
      const called = new RegExp(`\\b${helperName}\\b|\\b(?:emit|finish|report|finalize|summary)\\s*\\(`).test(src)
      if (called) exitsViaHelper = true
    }
  }
  if (exitsDirectly || exitsViaHelper) continue
  noExit.push(rel)
  if (runsInVerifyChain(rel)) reachableNoExit.push({ file: rel, where: "npm run verify" })
  else if (runsInSuite(rel)) reachableNoExit.push({ file: rel, where: "verify:suite" })
}

check(
  "the sweep was readable (zero files scanned means the walk failed, not that the tree is clean)",
  files.length > 500 && noExit.length >= 0,
  `${files.length} script(s) scanned; ${noExit.length} call check() but have no exit mechanism of their own`,
)

check(
  "every gate REACHED BY THE VERIFY CHAIN can fail (it sets an exit code)",
  reachableNoExit.length === 0,
  reachableNoExit.length === 0
    ? "every gate in the verify chain and the suite has an exit mechanism"
    : `*** ${reachableNoExit.length} gate(s) run by the chain print a verdict but ALWAYS exit 0, so a caller ` +
      `reading the exit code cannot tell VERIFIED from KNOWN-GAP: ${reachableNoExit
        .map((r) => `${r.file} (${r.where})`)
        .join(", ")} ***`,
)

if (reachableNoExit.length > 0) {
  console.log("\n  the ones that run:")
  for (const r of reachableNoExit) console.log(`    ${r.file}  —  ${r.where}`)
  console.log(
    "\n  A verdict string is not an exit code. Canaried on script/m55/verify-call-hierarchy.ts:\n" +
      "  breaking every mutant import gave `T2: KNOWN-GAP (55/55 passed, 0/9 mutants caught, 9 not judged)`\n" +
      "  and exit 0. Fifty-five checks passed with every mutant unjudged.\n\n" +
      "  The ${noExit.length - reachableNoExit.length} other file(s) with no exit are libraries or scratch probes\n" +
      "  and are NOT reported — a gate that flags unreachable code is a gate whose findings get ignored.",
  )
}

const failed = checks.filter((c) => !c.ok).length
console.log(`\nGATES CAN FAIL: ${failed === 0 ? "PASS" : `FAILED (${failed}) — see above`}`)
process.exit(failed === 0 ? 0 : 1)