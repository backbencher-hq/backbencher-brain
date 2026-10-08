#!/usr/bin/env tsx
// script/m62/verify-gate-typecheck-coverage.ts — the ratchet for the script
// directories that NO typecheck covers.
//
// WHY THIS EXISTS. `tsconfig.json` includes `src/**/*.ts` only. Proven on
// 2026-10-08, not inferred: a file at script/m62/__planted.ts containing
//
//   const n: number = "this is not a number"
//   const missing = someFunctionThatDoesNotExist(n)
//
// left `npm run typecheck` reporting **0 errors**, and `tsc --listFiles` did not
// even load the file. So every "tsc: 0 errors" ever said about a gate was
// vacuous, including several said while fixing other things.
//
// THE PART THAT ALREADY EXISTED, so this does not duplicate it.
//   script/m60/verify-script-surface.ts   found this gap on 2026-09-25 and
//                                         documents it, with a canary that
//                                         proves the compile was not blind
//   script/m14/verify-script-typecheck-baseline.ts
//                                         the ratchet under `typecheck:scripts`
// Both use `tsconfig.scripts.json`, which includes ONLY `script/m12/**` and
// `script/m14/**`. That baseline is 180 errors, worked down from 716.
//
// SO WHAT IS STILL UNCOVERED. Every other script directory — m11, m13, m15
// through m63, `lanes/`, `incoming-*`, `audit-index-modules` — about 3,000
// files. Measured here for the first time: **765 errors across 219 files**.
// Dominated by TS2339 (434, a property that does not exist on the inferred
// type), then TS2345, TS2451, TS2353. Two codes matter more than the count:
//   TS2304 (22)  cannot find name — a script referencing something undefined.
//                This is the exact class that made a walk return zero files
//                while a gate reported it clean.
//   TS2300 (18)  duplicate identifier — two definitions of one name.
//
// WHAT IT CLAIMS, EXACTLY. That no file's error count is HIGHER than the
// recorded baseline. It does NOT claim the scripts typecheck: a PASS prints the
// declared total and says so in as many words, because a gate that lets "no
// regressions" read as "clean" is the failure this whole regime exists to
// prevent.
//
// WHY A RATCHET AND NOT "FIX ALL 765". Fixing them is real work that has not
// been done, and pretending otherwise by quietly moving the bound is the thing
// this repository keeps refusing to do. A ratchet cannot be satisfied by
// shrinking the scope: it fails if the count rises, and it fails if a file that
// was clean starts erroring.
//
// THREE WAYS TO CHEAT IT, ALL CLOSED BELOW.
//   1. Add the offending file to `exclude`. The gate reports the exclude list
//      and requires it to match the recorded one exactly.
//   2. Introduce a parse error elsewhere. tsc reports SYNTACTIC diagnostics and
//      then OMITS SEMANTIC diagnostics for the whole program when any file fails
//      to parse, so a single unparseable file silently turns 765 errors into 4
//      and every ratchet on the planet passes. The CANARY exists for this.
//   3. Narrow `include`. The gate requires the recorded include list.

import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"

const ROOT = process.cwd()
const TSCONFIG = "tsconfig.gates-wide.json"
const BASELINE = "validation/m62/results/gate-typecheck-baseline.json"

type Check = { name: string; ok: boolean; detail: string }
const checks: Check[] = []
const check = (name: string, ok: boolean, detail: string): void => {
  checks.push({ name, ok, detail })
  console.log(`  ${ok ? "ok  " : "FAIL"}: ${name} — ${detail}`)
}

interface Baseline {
  totalErrors: number
  filesWithErrors: number
  perFile: Record<string, number>
  byCode: Record<string, number>
}

const cfg = JSON.parse(readFileSync(path.join(ROOT, TSCONFIG), "utf8")) as {
  include?: string[]
  exclude?: string[]
}
const baseline = JSON.parse(readFileSync(path.join(ROOT, BASELINE), "utf8")) as Baseline

// --- 1. the config still covers what the baseline was measured over ---------
check(
  "the gate config still includes the whole script tree",
  (cfg.include ?? []).includes("script/**/*.ts") && (cfg.include ?? []).includes("script/**/*.mts"),
  `include: ${(cfg.include ?? []).join(", ")}`,
)
check(
  "the tier-1 directories are still excluded, so its 180-error baseline stays valid",
  (cfg.exclude ?? []).includes("script/m12/**") && (cfg.exclude ?? []).includes("script/m14/**"),
  `exclude includes script/m12/** and script/m14/**`,
)

// --- 2. the CANARY. One deliberate semantic error, planted into the program --
// It must come back in the output. If it does not, this compile was BLIND — most
// likely because some other file failed to parse and tsc dropped all semantic
// diagnostics — and every number below would be meaningless. No verdict is
// published from a blind run.
const CANARY_REL = "script/__typecheck-canary.ts"
const CANARY = `// Temporary, written by verify-gate-typecheck-coverage.ts, deleted by it.\nconst canary: number = "deliberate type error"\nexport default canary\n`
const canaryAbs = path.join(ROOT, CANARY_REL)
writeFileSync(canaryAbs, CANARY, "utf8")

let output = ""
let canaryErrored = false
try {
  output = execFileSync("npx", ["tsc", "-p", TSCONFIG, "--pretty", "false"], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 256 * 1024 * 1024,
  })
} catch (err) {
  // tsc exits non-zero because it found errors. That is the expected case; the
  // diagnostics are on stdout. A spawn failure is not.
  const e = err as { stdout?: string; stderr?: string; message?: string }
  if (typeof e.stdout === "string" && e.stdout.length > 0) output = e.stdout
  else if (typeof e.stderr === "string" && e.stderr.length > 0) output = e.stderr
  else throw err
} finally {
  rmSync(canaryAbs, { force: true })
}

// Match on the FILE, not on the canary's source text. The first version of this
// check required the output to contain the string literal written into the
// canary, on the assumption that the diagnostic would quote the offending
// source. It does not — tsc emits
//   script/__typecheck-canary.ts(1,7): error TS2322: Type 'string' is not
//   assignable to type 'number'.
// and never mentions the literal at all, so the canary reported itself missing on
// a perfectly healthy run. The gate still refused to publish a verdict, which is
// the behaviour that matters, but the check itself was wrong.
const canaryDiagnostics = output
  .split("\n")
  .filter((l) => l.includes("__typecheck-canary.ts") && /error TS\d+/.test(l))
canaryErrored = canaryDiagnostics.length > 0
check(
  "the CANARY error came back — this compile was not blind",
  canaryErrored,
  canaryErrored
    ? `one planted error observed (${canaryDiagnostics[0]!.trim().slice(0, 60)}), so the semantic pass really ran`
    : "*** the canary's error did NOT appear: the run is blind (almost certainly an unparseable file), and every number here is meaningless ***",
)

// --- 2b. THE CANARY HAS TEETH. Prove it can actually fail, by blinding it.
//
// The blindness this guards against is real and documented by
// script/m60/verify-script-surface.ts with a measured minimal pair: when any file
// in the program fails to parse, tsc reports SYNTACTIC diagnostics and then OMITS
// SEMANTIC diagnostics for the WHOLE program. A single unparseable file therefore
// turns 765 errors into a handful of parse errors, and every ratchet on the
// planet passes. This leg plants an unparseable file, re-runs, and requires the
// canary's semantic error to DISAPPEAR — i.e. it requires the blindness to
// happen. A canary that cannot fail is the same mistake as a gate that cannot.
{
  const BREAKER_REL = "script/__typecheck-breaker.ts"
  const BREAKER_ABS = path.join(ROOT, BREAKER_REL)
  writeFileSync(BREAKER_ABS, `export const x: = ;\nfunction (\n`, "utf8")
  writeFileSync(canaryAbs, CANARY, "utf8")
  let blindOutput = ""
  try {
    blindOutput = execFileSync("npx", ["tsc", "-p", TSCONFIG, "--pretty", "false"], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 256 * 1024 * 1024,
    })
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string }
    blindOutput = typeof e.stdout === "string" ? e.stdout : typeof e.stderr === "string" ? e.stderr : ""
  } finally {
    rmSync(BREAKER_ABS, { force: true })
    rmSync(canaryAbs, { force: true })
  }
  const blindSawBreaker = blindOutput.includes("__typecheck-breaker.ts")
  const blindSawCanary = blindOutput.includes("__typecheck-canary.ts")
  const blindSemanticCount = (blindOutput.match(/error TS2339|error TS2345|error TS2322/g) ?? []).length
  check(
    "the canary CAN fail: an unparseable file really does blind the semantic pass",
    blindSawBreaker && !blindSawCanary,
    blindSawBreaker
      ? `the breaker parsed as an error; the canary's semantic error ${blindSawCanary ? "still appeared (so this tsc does NOT drop semantics — good, but then the breaker is a weaker test)" : "DISAPPEARED, so the blindness this guards against is real on this tsc"}`
      : "*** the breaker produced no diagnostic at all, so this leg proved nothing ***",
  )
  const healthySemanticCount = (output.match(/error TS2339|error TS2345|error TS2322/g) ?? []).length
  console.log(
    `         (semantic-shaped diagnostics: ${blindSemanticCount} while blinded, versus ${healthySemanticCount} on the healthy run)`,
  )
}

if (!canaryErrored) {
  const failed = checks.filter((c) => !c.ok).length
  console.log(`\nGATE TYPECHECK COVERAGE: BLIND (${failed} failing check(s); no verdict published)`)
  process.exit(1)
}

// --- 3. measure. The canary's own diagnostics are dropped so they do not count.
const counts = new Map<string, number>()
const codes = new Map<string, number>()
for (const line of output.split("\n")) {
  const m = /^([^(]+)\(\d+,\d+\): error (TS\d+):/.exec(line)
  if (!m) continue
  const file = m[1]!
  if (file.includes("__typecheck-canary")) continue
  counts.set(file, (counts.get(file) ?? 0) + 1)
  codes.set(m[2]!, (codes.get(m[2]!) ?? 0) + 1)
}
const total = [...counts.values()].reduce((a, b) => a + b, 0)

check(
  "the measured total matches the recorded baseline (no drift since it was taken)",
  total === baseline.totalErrors,
  `measured ${total}, baseline ${baseline.totalErrors}`,
)

// --- 4. no FILE may be worse than its baseline -----------------------------
{
  const worse: string[] = []
  for (const [file, n] of counts) {
    const was = baseline.perFile[file] ?? 0
    if (n > was) worse.push(`${file}: ${was} -> ${n}`)
  }
  for (const [file, was] of Object.entries(baseline.perFile)) {
    if (!counts.has(file)) worse.push(`${file}: ${was} -> 0 (file no longer reports, expected to be dropped from the baseline deliberately)`)
  }
  check(
    "no file's error count is higher than its recorded baseline",
    worse.length === 0,
    worse.length === 0 ? `${counts.size} file(s), all at or under baseline` : `*** ${worse.length} regressed: ${worse.slice(0, 6).join("; ")} ***`,
  )
}

// --- 5. the exclude list has not been widened -------------------------------
{
  const recorded = [
    "node_modules",
    "dist",
    "tests",
    "script/m12/**",
    "script/m14/**",
    "script/incoming-rust/rust-contains-oracle-check.ts",
    "script/m14/tmp/elixir-274/validation/m14/fixtures/typescript/error-ranges.ts",
    "script/m14/tmp/elixir-274/validation/m14/fixtures/typescript/import-target-shapes.ts",
    "script/m14/tmp/elixir-274/validation/m14/fixtures/typescript/class-expression-members.ts",
  ]
  const actual = (cfg.exclude ?? []).slice().sort()
  const same = actual.length === recorded.length && recorded.slice().sort().every((e, i) => e === actual[i])
  check(
    "the exclude list is exactly the four named oracle/fixture files plus tier-1",
    same,
    same ? `${actual.length} entries` : `*** changed: ${actual.filter((e) => !recorded.includes(e)).join(", ") || actual.join(", ")} ***`,
  )
}

// --- 6. the honest statement, in words, every time it passes ----------------
const undef = codes.get("TS2304") ?? 0
const dupes = codes.get("TS2300") ?? 0
console.log(
  `\n  THIS IS NOT A PASS ON THE SCRIPTS. ${total} TypeScript errors remain across ${counts.size} files\n` +
    `  in the script directories no tsconfig covers. ${undef} of them are "cannot find name" — the class\n` +
    `  that lets a gate report a clean run while examining nothing — and ${dupes} are duplicate\n` +
    `  identifiers. The baseline exists so the number can only shrink.`,
)

// The working tree must be as we found it.
check("the canary file was removed", !existsSync(canaryAbs), existsSync(canaryAbs) ? "*** still present ***" : "clean")

const failed = checks.filter((c) => !c.ok).length
console.log(`\nGATE TYPECHECK COVERAGE: ${failed === 0 ? "NO REGRESSIONS (not clean)" : `FAILED (${failed})`} — ${total} errors tracked`)
process.exit(failed === 0 ? 0 : 1)