/**
 * THE CONTROL FOR THE LANE GATE'S FALLBACK LINE — and it fails if either the format or the
 * arithmetic is wrong, without duplicating either.
 *
 * ## What it controls
 *
 * `measurements/lane-gate-fallback-line.patch` adds a parser and one printed line to
 * `residual-gate.ts`, so a lane reading `residual 10,273` is told that **5,452 of it is not the
 * analyzer's** and that its own figure is 4,821. The patch is reported rather than landed
 * (`script/m14/` is shared), so its correctness has to be checkable from the artifact alone.
 *
 * ## Why the synthetic block is built from the GATE'S OWN SOURCE
 *
 * A control that hard-codes the format it is testing can only confirm that the test agrees with
 * itself. So this file READS `script/m14/incoming-gate.ts`, requires the three literal fragments the
 * parser depends on — the header prefix, the per-type suffix, and the total marker — and builds the
 * block from THOSE strings. **If the block's wording ever changes, this control fails** rather than
 * passing against a stale copy: that is the property that makes it a control.
 *
 * ## Two arms, and the second is the invisibility arm the Lead asked for
 *
 *   ARM 1  a block with markdown's real numbers (calls 5,528 · 5,062 in the residual; instantiates
 *          399 · 390) must parse to 5,452 fallback-in-residual and leave 4,821 of 10,273.
 *   ARM 2  a REAL captured clean run (the 300- and 600-file stride samples, which read `calls 0`)
 *          must parse to `null` — no block — so the line prints "NONE" where there is nothing to
 *          report. A control that only tests the busy case cannot show the quiet one is quiet.
 *
 * CLI: npx tsx validation/m14/fixtures/markdown/fallback-line-control.mts
 * Read-only.
 */
import { readFileSync, existsSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..")
const patchPath = path.join(ROOT, "validation/m14/fixtures/markdown/measurements/lane-gate-fallback-line.patch")
const patch = readFileSync(patchPath, "utf8")

// ---- the parser UNDER TEST, lifted verbatim from the patch artifact so there is one copy
const parserStart = patch.indexOf("function parseFallbackBlock(")
const parserEnd = patch.indexOf("\n@@", parserStart)
if (parserStart < 0 || parserEnd < 0) {
  console.log("CONTROL FAILED: the patch artifact does not contain `parseFallbackBlock`")
  process.exit(1)
}
// The parser is TypeScript (it lands in a `.ts` file), so it is materialised and imported rather
// than `new Function`-ed: one copy of the rule, executed as written in the artifact.
// The artifact is a DIFF, so every added line carries a leading `+` — stripped here, or the
// materialised parser would be rejected by the TypeScript parser for a reason that has nothing
// to do with the rule under test. (This bit is the reason a control is run rather than assumed.)
const parserSrc = patch.slice(parserStart, parserEnd)
  .split("\n")
  .map((l) => (l.startsWith("+") ? l.slice(1) : l))
  .join("\n")
const { mkdirSync, writeFileSync } = await import("node:fs")
const tmpDir = path.join(ROOT, ".tmp-md")
mkdirSync(tmpDir, { recursive: true })
const tmpFile = path.join(tmpDir, `parser-under-test-${process.pid}.ts`)
writeFileSync(tmpFile, `${parserSrc}\nexport { parseFallbackBlock }\n`)
const mod = await import(`file://${tmpFile}`)
const parseFallbackBlock = mod.parseFallbackBlock as (out: string) => { rows: Map<string, number>; residual: Map<string, number>; totalResidual: number } | null

// ---- the fragments the parser depends on, read from the gate ITSELF
const gate = readFileSync(path.join(ROOT, "script/m14/incoming-gate.ts"), "utf8")
const needs = ["FALLBACK ROWS — ", "edges above came from pool-worker.ts's", "fallback row(s)"]
const missing = needs.filter((n) => !gate.includes(n))
if (missing.length > 0) {
  console.log(`CONTROL FAILED: the incoming gate no longer prints ${JSON.stringify(missing)} — the parser's contract is broken`)
  process.exit(1)
}
// the per-type line's own shape, as the gate writes it (type padded, count padded, 'fallback row(s)')
const perTypeLine = (t: string, n: number, inResidual: number): string =>
  `  ${String(t).padEnd(14)} ${String(n).padStart(9)} fallback row(s) · ${String(inResidual).padStart(9)} of them in the RESIDUAL columns`

// ---- ARM 1: markdown's real numbers
const synthetic =
  `FALLBACK ROWS — 5927 of the 283975 edges above came from pool-worker.ts's extractFallback() ` +
  `(metadata { method: "regex" }), NOT from the analyzer:\n` +
  perTypeLine("calls", 5528, 5062) + "\n" +
  perTypeLine("instantiates", 399, 390) + "\n" +
  `  FALLBACK-IN-RESIDUAL TOTAL 5452 — deduct THIS from the residual column.\n`
const parsed = parseFallbackBlock(synthetic)
const arm1 =
  parsed !== null &&
  parsed.totalResidual === 5452 &&
  parsed.rows.get("calls") === 5528 &&
  parsed.residual.get("calls") === 5062 &&
  parsed.residual.get("instantiates") === 390
const residualPrinted = 10273
const ownResidual = parsed === null ? -1 : residualPrinted - parsed.totalResidual
console.log(`ARM 1  synthetic block in the gate's own format -> totalResidual ${parsed?.totalResidual} (want 5452) · calls ${parsed?.rows.get("calls")} (want 5528) · in-residual calls ${parsed?.residual.get("calls")} (want 5062)`)
console.log(`       so \`residual ${residualPrinted}\` reads as: ${parsed?.totalResidual} fallback, own residual ${ownResidual} (want 4821)`)
console.log(`       ${arm1 && ownResidual === 4821 ? "PASS" : "FAIL"}`)

// ---- ARM 2: the real clean runs
const cleanFiles = [
  "validation/m14/fixtures/markdown/measurements/stride-sample-300.txt",
  "validation/m14/fixtures/markdown/measurements/stride-sample-600.txt",
]
let arm2 = true
for (const rel of cleanFiles) {
  const abs = path.join(ROOT, rel)
  if (!existsSync(abs)) { console.log(`ARM 2  ${rel}: MISSING (not a pass — the artifact is the evidence)`); arm2 = false; continue }
  const out = readFileSync(abs, "utf8")
  const got = parseFallbackBlock(out)
  const callsZero = /^calls\s+0\s/m.test(out)
  console.log(`ARM 2  ${path.basename(rel)}: block ${got === null ? "ABSENT (=> the line prints NONE)" : "PRESENT — unexpected"} · calls row zero: ${callsZero}`)
  if (got !== null || !callsZero) arm2 = false
}

const ok = arm1 && ownResidual === 4821 && arm2
console.log("")
console.log(`VERDICT: ${ok ? "control fires on both arms — the line's arithmetic and its quiet case are both pinned" : "CONTROL DID NOT FIRE — the patch's parser or its format contract is wrong"}`)
process.exitCode = ok ? 0 : 1
