// script/m71/probe-edit-overwrite-guard.ts — M71.D7/D9 stress measurement.
//
// The gates (E1 boundary, E7 engine, E9 wire, E12 docs) pin the DECISIVE cells of
// the overwrite guard and the plan-to-commit pre-image check. This probe is the
// other half of the evidence: the sweep, the agreement between the pure rule and
// the engine that is supposed to enforce it, the content shapes a real repository
// contains, and what the check COSTS.
//
// It prints a report and exits non-zero if any cell disagrees with the rule, so it
// can be run by hand after a change to either half:
//
//   npx tsx script/m71/probe-edit-overwrite-guard.ts
//
// Sections:
//   1. the rule swept over every (before, after) pair up to 120 lines, with the
//      boundary curve printed — the exact cell where the refusal starts
//   2. ENGINE AGREEMENT: every swept cell of a nested sub-sweep run through the real
//      engine on real files, refusal-for-refusal against the rule
//   3. COMMITTING RUNS: a real (non-dry-run) subset, proving a refused cell leaves
//      the file byte-identical and an allowed cell lands the requested bytes
//   4. CONTENT STRESS: CRLF, no trailing newline, blank-only, one huge line, latin-1
//      bytes, a BOM — the shapes where a line count could lie
//   5. PRE-IMAGE STRESS (D9): repeated interleaved trials (the file moves between
//      plan and commit) against controls, each checking bytes-on-disk afterwards
//   6. COST: what the extra byte read + sha256 costs per commit

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync, statSync } from "node:fs"
import { createHash } from "node:crypto"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../src/cli/index"
import { BrainDatabase } from "../../src/brain/database"
import { executeEdit, fileHash, lineCount, writeGuardMessage, WRITE_GUARD } from "../../src/intelligence/edit/edit-engine"

const root = mkdtempSync(path.join(tmpdir(), "m71-overwrite-guard-"))
const projectId = getProjectId(root)
const srcDir = path.join(root, "src")
mkdirSync(srcDir, { recursive: true })

const failures: string[] = []
const fail = (message: string): void => { failures.push(message); console.log(`  VIOLATION: ${message}`) }

/** A file of `n` lines, each a real TypeScript declaration. */
const linesOf = (n: number, tag = "v"): string =>
  n === 0 ? "" : Array.from({ length: n }, (_, i) => `export const ${tag}${i} = ${i}`).join("\n") + "\n"

/** The RULE, as the engine exports it — never a copy of it. */
const ruleRefuses = (before: string, after: string, overwrite?: boolean): boolean =>
  writeGuardMessage("src/probe.ts", { existed: true, before, after }, overwrite) !== null

// ── 1. the rule, swept ─────────────────────────────────────────────────────
console.log("── 1. the rule over every (before, after) pair (pure, no filesystem)")
{
  let cells = 0
  let refused = 0
  for (let before = 0; before <= 120; before++) {
    for (let after = 0; after <= before + 8; after++) {
      cells++
      const b = linesOf(before)
      const a = linesOf(after)
      const isRefused = ruleRefuses(b, a)
      if (isRefused) refused++
      // The invariant the documentation states, in the code's own terms: refused
      // exactly when at least `minRemovedLines` lines go AND at most half remain.
      const expected = before - after >= WRITE_GUARD.minRemovedLines && after <= before * WRITE_GUARD.maxRemainingRatio
      if (isRefused !== expected) fail(`rule cell ${before}→${after}: refused=${isRefused} expected=${expected}`)
      // `overwrite: true` is never questioned; `overwrite: false` always is.
      if (ruleRefuses(b, a, true)) fail(`rule cell ${before}→${after}: overwrite:true was refused`)
      if (!ruleRefuses(b, a, false)) fail(`rule cell ${before}→${after}: overwrite:false was NOT refused`)
    }
  }
  console.log(`  ${cells} cells, ${refused} refused (${((refused / cells) * 100).toFixed(1)}%), no invariant violated`)
  console.log("  the boundary — for each pre-image size, the largest new size still refused:")
  for (const before of [1, 4, 5, 6, 7, 10, 11, 20, 41, 100]) {
    let largest = -1
    for (let after = 0; after <= before; after++) if (ruleRefuses(linesOf(before), linesOf(after))) largest = after
    console.log(
      largest < 0
        ? `    ${String(before).padStart(3)} lines → never refused (even emptied: under the ${WRITE_GUARD.minRemovedLines}-line floor)`
        : `    ${String(before).padStart(3)} lines → refused at ≤ ${String(largest).padStart(3)} lines (${String(Math.round(((before - largest) / before) * 100)).padStart(3)}% gone), allowed from ${largest + 1} lines`,
    )
  }
  // A file that did not exist is never guarded, whatever the content.
  if (writeGuardMessage("src/new.ts", { existed: false, before: "", after: "" }, false) !== null) fail("rule fired for a path that did not exist")
  if (writeGuardMessage("src/new.ts", { existed: false, before: "", after: linesOf(9) }) !== null) fail("rule fired for a CREATE whose content is large")
}

// ── 2. engine agreement ────────────────────────────────────────────────────
console.log("\n── 2. engine agreement (every subset cell run through executeEdit on real files, dry runs)")
let engineCells = 0
let engineRefusals = 0
{
  const cells: Array<[number, number]> = []
  for (let before = 0; before <= 12; before++) for (let after = 0; after <= before; after++) cells.push([before, after])
  for (let before = 13; before <= 400; before += 17) {
    for (const after of [0, 1, Math.floor(before / 2), Math.floor(before / 2) + 1, Math.floor(before * 0.7), before]) {
      if (after >= 0 && after <= before) cells.push([before, after])
    }
  }
  for (const [before, after] of cells) {
    const rel = `src/agree-${before}-${after}.ts`
    const file = path.join(root, rel)
    writeFileSync(file, linesOf(before))
    engineCells++
    const message = await executeEdit(root, projectId, { mode: "write", dryRun: true, filePath: rel, content: linesOf(after), format: false })
      .then(() => "", (e: Error) => e.message)
    const engineRefused = message.length > 0
    if (engineRefused) engineRefusals++
    const expected = before > 0 && ruleRefuses(linesOf(before), linesOf(after))
    if (engineRefused !== expected) fail(`engine cell ${before}→${after}: refused=${engineRefused} rule=${expected} message=${message.slice(0, 120)}`)
    if (engineRefused && !message.includes("write refused")) fail(`engine cell ${before}→${after}: refused without the guard's sentence: ${message.slice(0, 120)}`)
  }
  console.log(`  ${engineCells} cells through the engine, ${engineRefusals} refused — refusal-for-refusal identical to the rule`)
}

// ── 3. committing runs ─────────────────────────────────────────────────────
console.log("\n── 3. committing runs (dryRun:false) — a refusal must leave the bytes alone")
{
  const cells: Array<[number, number, boolean]> = [
    [41, 1, true], [41, 20, true], [41, 21, false], [10, 5, true], [10, 6, false],
    [6, 1, true], [4, 1, false], [2, 0, false], [200, 60, true], [200, 130, false], [1, 1, false], [0, 1, false],
  ]
  let checked = 0
  for (const [before, after, expectRefusal] of cells) {
    const rel = `src/commit-${before}-${after}.ts`
    const file = path.join(root, rel)
    const original = linesOf(before)
    writeFileSync(file, original)
    const message = await executeEdit(root, projectId, { mode: "write", filePath: rel, content: linesOf(after), format: false })
      .then(() => "", (e: Error) => e.message)
    const refused = message.length > 0
    if (refused !== expectRefusal) fail(`commit cell ${before}→${after}: refused=${refused} expected=${expectRefusal}`)
    const onDisk = readFileSync(file, "utf8")
    if (refused && onDisk !== original) fail(`commit cell ${before}→${after}: a refused write changed the file`)
    if (!refused && onDisk !== linesOf(after)) fail(`commit cell ${before}→${after}: an allowed write did not land the requested bytes`)
    if (!refused && (onDisk !== linesOf(after) || !existsSync(file))) fail(`commit cell ${before}→${after}: bytes on disk are not the request`)
    const temps = readdirSync(srcDir).filter((name) => name.includes(".bb-edit-"))
    if (temps.length > 0) fail(`commit cell ${before}→${after}: left temp files behind: ${temps.join(",")}`)
    checked++
  }
  console.log(`  ${checked} real writes: refusals byte-identical, allowed writes landed, no temp left behind`)
  // The acknowledgement path, on a real file.
  const rel = "src/commit-forced.ts"
  writeFileSync(path.join(root, rel), linesOf(300))
  const forced = await executeEdit(root, projectId, { mode: "write", filePath: rel, content: linesOf(1), overwrite: true, format: false })
  if (readFileSync(path.join(root, rel), "utf8") !== linesOf(1)) fail("overwrite:true did not replace the file")
  console.log(`  overwrite:true replaced a 300-line file with 1 line (pre-image carried in the result: ${forced.changes[0].before.length} bytes)`)
}

// ── 4. content stress ──────────────────────────────────────────────────────
console.log("\n── 4. content stress — the shapes where a line count could lie")
{
  const shapes: Array<[string, (n: number) => string]> = [
    // name, builder
    ["crlf", (n) => Array.from({ length: n }, (_, i) => `export const c${i} = ${i}`).join("\r\n") + "\r\n"],
    ["no trailing newline", (n) => Array.from({ length: n }, (_, i) => `export const n${i} = ${i}`).join("\n")],
    ["blank lines only", (n) => "\n".repeat(n)],
    ["one huge line", () => `export const huge = "${"x".repeat(2 * 1024 * 1024)}"\n`],
    ["latin-1 bytes", () => `// caf\xe9 w\xf6rld\n` + Array.from({ length: 39 }, (_, i) => `export const l${i} = ${i}`).join("\n") + "\n"],
    ["utf-8 BOM", (n) => "\uFEFF" + Array.from({ length: n }, (_, i) => `export const b${i} = ${i}`).join("\n") + "\n"],
    ["mixed blank/blank/blank", (n) => "\n\n\n" + Array.from({ length: n }, (_, i) => `export const m${i} = ${i}`).join("\n\n") + "\n\n"],
  ]
  for (const [name, build] of shapes) {
    const rel = `src/shape-${name.replace(/[^a-z0-9]+/gi, "-")}.ts`
    const file = path.join(root, rel)
    const original = build(40)
    writeFileSync(file, original)
    const beforeLines = lineCount(original)
    const after = `export const replacement = 1\n`
    const predicted = ruleRefuses(original, after)
    const message = await executeEdit(root, projectId, { mode: "write", filePath: rel, content: after, format: false })
      .then(() => "", (e: Error) => e.message)
    const engineRefused = message.length > 0
    const onDisk = readFileSync(file, "utf8")
    const intact = onDisk === original
    console.log(`  ${name.padEnd(22)} beforeLines=${String(beforeLines).padStart(4)} refused=${String(engineRefused).padStart(5)} rule=${String(predicted).padStart(5)} ${engineRefused ? `bytes-intact=${intact}` : "wrote-the-request"}`)
    if (engineRefused !== predicted) fail(`shape ${name}: engine=${engineRefused} rule=${predicted}`)
    if (engineRefused && !intact) fail(`shape ${name}: a refused write changed the bytes`)
    if (!engineRefused && onDisk !== after) fail(`shape ${name}: an allowed write did not land the request`)
  }
}

// ── 5. pre-image stress (D9) ───────────────────────────────────────────────
console.log("\n── 5. plan → commit pre-image stress (D9)")
{
  // The interleave: `planEdit` reads the target synchronously before its first
  // await, so a microtask queued before the call runs at exactly the window — after
  // the plan's read and before the commit's re-check. Deterministic, 40 times, with
  // a different external content each round.
  let refusedCount = 0
  let controls = 0
  const TRIALS = 40
  for (let i = 0; i < TRIALS; i++) {
    const rel = `src/moving-${i}.ts`
    const file = path.join(root, rel)
    const planned = `export const planned${i} = ${i}\n`
    const external = `export const external${i} = ${i}\n// saved by an editor mid-plan\n`
    writeFileSync(file, planned)
    queueMicrotask(() => writeFileSync(file, external))
    const message = await executeEdit(root, projectId, { mode: "write", filePath: rel, content: `export const committed${i} = ${i}\n`, format: false })
      .then(() => "", (e: Error) => e.message)
    const onDisk = readFileSync(file, "utf8")
    if (message.length === 0) fail(`pre-image trial ${i}: the edit committed over a file that moved (on disk: ${onDisk.slice(0, 40)})`)
    else {
      refusedCount++
      if (onDisk !== external) fail(`pre-image trial ${i}: a refusal did not leave the external bytes intact`)
      if (!message.includes(fileHash(file)!.slice(0, 12))) fail(`pre-image trial ${i}: the refusal does not name the current bytes`)
      if (!message.includes("bb_edit wrote nothing")) fail(`pre-image trial ${i}: the refusal does not say nothing was written`)
      if (readdirSync(srcDir).some((name) => name.includes(".bb-edit-"))) fail(`pre-image trial ${i}: temp file left behind`)
    }
    // …and the same call without the interleave must COMMIT, or the check would be
    // a blanket refusal rather than a window check.
    const control = await executeEdit(root, projectId, { mode: "write", filePath: rel, content: `export const committed${i} = ${i}\n`, format: false })
    if (readFileSync(file, "utf8") !== `export const committed${i} = ${i}\n`) fail(`pre-image control ${i}: the edit did not commit on an unmoved file`)
    if (control.reindexed !== true) fail(`pre-image control ${i}: reindexed=${control.reindexed}`)
    controls++
  }
  console.log(`  ${TRIALS} interleaved trials: ${refusedCount} refused with nothing written; ${controls} controls all committed`)
  // The other two directions, and a binary external write.
  const appeared = path.join(root, "src/appeared.ts")
  queueMicrotask(() => writeFileSync(appeared, "export const sneaky = 1\n"))
  const appearedMessage = await executeEdit(root, projectId, { mode: "write", filePath: "src/appeared.ts", content: "export const mine = 1\n", format: false })
    .then(() => "", (e: Error) => e.message)
  console.log(`  a file that APPEARS at a create target: ${appearedMessage.includes("no file at that path") ? "refused, and left alone" : "NOT REFUSED"}`)
  if (!appearedMessage.includes("no file at that path")) fail("a file appearing at a create target was not refused")
  if (readFileSync(appeared, "utf8") !== "export const sneaky = 1\n") fail("the appeared file was overwritten")
  const vanishing = path.join(root, "src/vanishing.ts")
  writeFileSync(vanishing, "export const willVanish = 1\n")
  queueMicrotask(() => rmSync(vanishing))
  const vanishedMessage = await executeEdit(root, projectId, { mode: "write", filePath: "src/vanishing.ts", content: "export const replacement = 1\n", format: false })
    .then(() => "", (e: Error) => e.message)
  console.log(`  a target that VANISHES: ${vanishedMessage.includes("now gone") ? "refused, and NOT recreated" : "NOT REFUSED"}`)
  if (!vanishedMessage.includes("now gone")) fail("a vanished target was not refused")
  if (existsSync(vanishing)) fail("the vanished target was recreated from the plan")
  const binary = path.join(root, "src/binary.ts")
  writeFileSync(binary, "export const binary = 1\n")
  queueMicrotask(() => writeFileSync(binary, Buffer.from([0x2f, 0x2f, 0xe9, 0xff, 0x0a])))
  const binaryMessage = await executeEdit(root, projectId, { mode: "write", filePath: "src/binary.ts", content: "export const binary = 2\n", format: false })
    .then(() => "", (e: Error) => e.message)
  const binaryIntact = readFileSync(binary).equals(Buffer.from([0x2f, 0x2f, 0xe9, 0xff, 0x0a]))
  console.log(`  a non-UTF-8 external write: ${binaryMessage.length > 0 && binaryIntact ? "refused, and the bytes are untouched" : "MISSED"}`)
  if (binaryMessage.length === 0 || !binaryIntact) fail("a non-UTF-8 external write was not caught (or the bytes were lost)")
}

// ── 6. cost ────────────────────────────────────────────────────────────────
console.log("\n── 6. what the check costs (1 MiB and 8 MiB files, 30 reps each)")
{
  for (const bytes of [1 << 20, 8 << 20]) {
    const file = path.join(root, `cost-${bytes}.bin`)
    writeFileSync(file, Buffer.alloc(bytes, 0x61))
    const reps = 30
    let readMs = 0
    let hashMs = 0
    for (let i = 0; i < reps; i++) {
      let t = process.hrtime.bigint()
      readFileSync(file)
      readMs += Number(process.hrtime.bigint() - t) / 1e6
      t = process.hrtime.bigint()
      createHash("sha256").update(readFileSync(file)).digest("hex")
      hashMs += Number(process.hrtime.bigint() - t) / 1e6
    }
    const perRead = readMs / reps
    const perHash = hashMs / reps
    console.log(`  ${(bytes / (1 << 20)).toFixed(0)} MiB: read ${perRead.toFixed(2)} ms, read+sha256 ${perHash.toFixed(2)} ms (+${(perHash - perRead).toFixed(2)} ms per target ≈ ${((perHash - perRead) / perRead * 100).toFixed(0)}% of the read it already did)`)
  }
  const stats = statSync(path.join(root, "src", "commit-41-21.ts"))
  console.log(`  (one target is normally a source file: ${stats.size} bytes for the 41→21 cell above)`)
}

console.log(`\n${failures.length === 0 ? "PROBE: no violation" : `PROBE: ${failures.length} VIOLATION(S)`} — ${failures.length} problem(s) recorded`)
rmSync(root, { recursive: true, force: true })
rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true })
process.exit(failures.length === 0 ? 0 : 1)
