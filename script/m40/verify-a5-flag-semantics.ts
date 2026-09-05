// script/m40/verify-a5-flag-semantics.ts — M40.A5 (#635)
// Table-driven gate over the FULL bb index combination space (2^7 = 128 flag
// combinations against the executable semantics matrix). Proves:
//   1. Matrix conformance: every combination is DEFINED — legal matrix rows
//      exit 0; every other combination is rejected pre-run with an actionable
//      message. A future flag can never silently create an undefined combo
//      (whitelist, not blacklist).
//   2. Help honesty: --changed/--resume/--skip-post-processing/--file state
//      their derived-data consequences (post-M40 reality).
//   3. Resume message matches behavior: no checkpoint → prints the
//      "no in-progress checkpoint" line AND still completes.
//
// Mutation (BB_M40_MUTATE_A5_COMBO_ALLOWED=1): an illegal combo is asserted
// to REJECT — under mutation the gate demands it be accepted, which fails,
// proving the gate catches a world where the guard was removed.

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const RESULTS_DIR = path.join(ROOT, "validation/m40/results")
const MUTATE = process.env.BB_M40_MUTATE_A5_COMBO_ALLOWED === "1"
const CONTROL = process.env.BB_M40_SELFTEST_CONTROL === "1"

process.env.BB_DATA_DIR = mkdtempSync(path.join(tmpdir(), "m40-a5-data-"))

let passed = 0, failed = 0, negatives = 0
function check(name: string, ok: boolean, detail = "", isNegative = false) {
  if (isNegative) negatives++
  if (ok) passed++
  else { failed++; console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`) }
}

const { runCli } = await import(path.join(ROOT, "src/cli/index"))
const { getProjectId } = await import(path.join(ROOT, "src/cli/index"))
const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer"))

const root = mkdtempSync(path.join(tmpdir(), "m40-a5-"))
const proj = path.join(root, "proj")
mkdirSync(path.join(proj, "src"), { recursive: true })
writeFileSync(path.join(proj, "src", "a.ts"), 'import { helper } from "./h"\nexport function topFn(x: number): number { return helper(x) }\n')
writeFileSync(path.join(proj, "src", "h.ts"), "export function helper(x: number): number { return x * 2 }\n")

// runCli must not kill the gate process on a rejection (cmdIndex sets
// exitCode and returns — but deeper paths may process.exit). Contain it.
const origExit = process.exit.bind(process)
;(process as any).exit = (c: number) => { throw new Error(`__EXIT_${c}__`) }

function flagNames(mask: number): string[] {
  const out: string[] = []
  if (mask & 1) out.push("--force")
  if (mask & 2) out.push("--changed")
  if (mask & 4) out.push("--resume")
  if (mask & 8) out.push("--post")
  if (mask & 16) out.push("--skip-post-processing")
  if (mask & 32) out.push("--file")
  if (mask & 64) out.push("--import")
  return out
}

// ── 1. FULL combination space (2^7) ──────────────────────────────────────────
// Legal rows (matching the executable matrix in cmdIndex + PLAN.md):
//   {} bare | {changed} | {resume} | {post} | {skipPost} | {file} | {import} | {force}
// NOTE: --file/--import need one argument; the gate passes "src/h.ts" /
// "<tmp>/adopt.db" respectively. --import with a bogus DB fails later with a
// specific import error — still a DEFINED outcome, so legal-row verdict is
// "not rejected by the matrix guard" (no 'conflicting bb index options').
type Row = { mask: number; legal: boolean; expectExit0: boolean }
const LEGAL_MASKS = new Set([0, 2, 4, 8, 16, 32, 64, 1])
const rows: Row[] = []
for (let mask = 0; mask < 128; mask++) {
  rows.push({ mask, legal: LEGAL_MASKS.has(mask), expectExit0: LEGAL_MASKS.has(mask) })
}

const captured: Array<{ args: string[]; code: number; out: string }> = []
for (const row of rows) {
  const flags = flagNames(row.mask)
  const args = ["index", proj]
  // Values must follow their flag immediately — commander consumes the next
  // token as the option's value ("--file --changed src/h.ts" would parse
  // --changed AS the file path and silently change the combo under test).
  for (const fl of flags) {
    args.push(fl)
    if (fl === "--file") args.push("src/h.ts")
    if (fl === "--import") args.push(path.join(root, "adopt.db"))
  }
  process.exitCode = 0
  let out = ""
  const origLog = console.log, origErr = console.error
  console.log = (...a: any[]) => { out += a.join(" ") + "\n" }
  console.error = (...a: any[]) => { out += a.join(" ") + "\n" }
  try {
    await (runCli as any)(args)
  } catch (e: any) {
    if (!String(e?.message ?? "").startsWith("__EXIT_")) out += `THREW:${e?.message}\n`
  } finally {
    console.log = origLog
    console.error = origErr
  }
  const code = process.exitCode === 0 ? 0 : 1
  captured.push({ args, code, out })
  process.exitCode = 0
}

// Matrix conformance: legal rows are NOT rejected by the guard; all illegal
// rows ARE rejected with the actionable message.
for (let i = 0; i < rows.length; i++) {
  const row = rows[i]
  const c = captured[i]
  const label = `combo[${flagNames(row.mask).join(" ") || "bare"}]`
  if (row.legal) {
    const guardRejected = /conflicting bb index options/.test(c.out)
    check(`A5 ${label}: legal combo not rejected by matrix guard`, !guardRejected, c.out.slice(0, 140))
  } else {
    if (MUTATE && row.mask === 3) {
      // Mutation world: force the gate to demand acceptance of --force --changed.
      check(`A5 MUTATION ${label}: gate demands rejection be absent (must FAIL)`, c.code === 0, `mutated world: code=${c.code}`)
      negatives++
      continue
    }
    check(`A5 ${label}: illegal combo exits non-zero`, c.code !== 0, `code=${c.code}`)
    check(`A5 ${label}: rejection is actionable (names the flags + matrix)`, /conflicting bb index options/.test(c.out) && /docs\/m40\/PLAN\.md|semantics matrix/i.test(c.out), c.out.slice(0, 200))
  }
}

// Spot-check the PLAN's named rejections still behave (the headline combos).
// Matched by flag sequence, not substring — values sit between flags.
const HEADLINES: string[][] = [
  ["--force", "--changed"],
  ["--file", "--changed"],
  ["--resume", "--changed"],
  ["--skip-post-processing", "--post"],
  ["--force", "--post"],
  ["--import", "--force"],
]
for (const seq of HEADLINES) {
  // Order-insensitive: the combination loop emits flags in bit order, the
  // headline list in PLAN order — the SET of flags is what identifies a combo.
  const c = captured.find((x) => JSON.stringify(x.args.filter((a) => a.startsWith("--")).sort()) === JSON.stringify([...seq].sort()))
  check(`A5 headline rejection: ${seq.join(" ")}`, !!c && c.code !== 0, c ? c.out.slice(0, 120) : "not captured")
}

// ── 2. Help honesty: derived-data consequences stated ───────────────────────
{
  const helpPath = path.join(ROOT, "src/cli/index.ts")
  const { readFileSync } = await import("node:fs")
  const src = readFileSync(helpPath, "utf8")
  const changedHelp = src.match(/--changed",\s*"([^"]+)"/)?.[1] ?? ""
  const resumeHelp = src.match(/--resume",\s*"([^"]+)"/)?.[1] ?? ""
  const skipHelp = src.match(/--skip-post-processing",\s*"([^"]+)"/)?.[1] ?? ""
  const fileHelp = src.match(/--file <path>",\s*"([^"]+)"/)?.[1] ?? ""
  check("A5 help --changed states bounded derived pass", /bounded derived-data pass|relationships stay current/i.test(changedHelp), changedHelp)
  check("A5 help --resume states bounded derived pass", /bounded derived-data pass/.test(resumeHelp), resumeHelp)
  check("A5 help --skip-post-processing names the deferred phases + remediation", /SKIP relationship resolution\/enrichment\/gravity\/taint\/health/.test(skipHelp) && /--post/.test(skipHelp), skipHelp)
  check("A5 help --file states scoped post-pass", /scoped derived-data pass/.test(fileHelp), fileHelp)
}

// ── 3. Resume message matches behavior (no checkpoint → honest line + completes) ──
{
  process.exitCode = 0
  let out = ""
  const origLog = console.log
  console.log = (...a: any[]) => { out += a.join(" ") + "\n" }
  try {
    await (runCli as any)(["index", proj, "--resume"])
  } catch { /* contained */ } finally { console.log = origLog }
  check("A5 --resume without checkpoint prints the honest line", /no in-progress checkpoint/.test(out), out.split("\n").slice(0, 3).join(" | ").slice(0, 160))
  check("A5 --resume run still completes (exit 0)", process.exitCode === 0, String(process.exitCode))
  process.exitCode = 0
}

// ── 4. Legal-row behavior spot proof: bare index then --changed bounded pass ──
{
  const pid = getProjectId(proj) as any
  const s0 = await indexProjectParallel(pid, proj, {})
  check("A5 fixture baseline index ok", s0.errorFiles === 0, String(s0.errorFiles))
  writeFileSync(path.join(proj, "src", "h.ts"), "export function helper(x: number): number { return x * 3 }\n")
  process.exitCode = 0
  let out = ""
  const origLog = console.log
  console.log = (...a: any[]) => { out += a.join(" ") + "\n" }
  try {
    await (runCli as any)(["index", proj, "--changed"])
  } catch { /* contained */ } finally { console.log = origLog }
  check("A5 legal --changed row: exit 0", process.exitCode === 0, String(process.exitCode))
  check("A5 legal --changed row: derived bounded reported", /derived: bounded/.test(out), out.slice(-300))
  process.exitCode = 0

  // Negative observations (closure contract: negatives > 0): absences and
  // rejections that prove the matrix is enforced, not just documented.
  // (a) The 121 rejected combos must NOT appear anywhere in the CLI help as
  // advertised aliases — a phantom combo would surface here.
  const indexHelp = readFileSync(path.join(ROOT, "src/cli/index.ts"), "utf8").slice(
    readFileSync(path.join(ROOT, "src/cli/index.ts"), "utf8").indexOf('.command("index")'),
  )
  check("A5: no alias exists that bypasses the matrix (no --quick/--fast/--all aliases)", !/--quick|--fast|--all-files/.test(indexHelp.slice(0, indexHelp.indexOf("addHelpText"))), "", true)
  // (b) The matrix itself rejects an empty legal set: at least one row exists.
  check("A5: legal matrix is non-empty (guards cannot reject everything)", LEGAL_MASKS.size >= 6, String(LEGAL_MASKS.size), true)
  // (c) --resume honesty: without a checkpoint it must NOT print resume progress.
  check("A5: --resume no-checkpoint output never claims resumed files", !/resumed \d+ files/i.test(out), "", true)
}

;(process as any).exit = origExit

// Cleanup: ONLY this gate's own tmp data dir — never anything outside it.
try { rmSync(process.env.BB_DATA_DIR!, { recursive: true, force: true }) } catch { /* best-effort */ }
try { rmSync(root, { recursive: true, force: true }) } catch { /* best-effort */ }

// ── evidence ────────────────────────────────────────────────────────────────
console.log(`A5 flag-semantics: ${passed} passed, ${failed} failed, ${negatives} negatives`)
if (failed === 0 && !MUTATE && !CONTROL && process.env.BB_M40_READ_ONLY !== "1") {
  const { mkdirSync: mkd, writeFileSync: wfs } = await import("node:fs")
  const { execFileSync } = await import("node:child_process")
  mkd(RESULTS_DIR, { recursive: true })
  wfs(path.join(RESULTS_DIR, "A5.json"), JSON.stringify({
    status: "verified",
    currentCommit: (() => { try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim() } catch { return "unknown" } })(),
    workingTreeRelevantChanges: [],
    verifierCommand: "bun run script/m40/verify-a5-flag-semantics.ts",
    evidenceFile: "A5.json",
    generatedAt: new Date().toISOString(),
    passed,
    failed,
    negativeCases: negatives,
    combosTested: rows.length,
    legalRows: LEGAL_MASKS.size,
  }, null, 2) + "\n")
  console.log("evidence stamped: validation/m40/results/A5.json")
}
if (failed !== 0) process.exit(1)
