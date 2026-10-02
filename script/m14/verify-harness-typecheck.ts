/**
 * 2026-09-29: the harness typecheck gate — the check whose ABSENCE let a merge land three bare
 * strings inside a typed array in `completeness-inventory.ts`, which then crashed that gate at
 * runtime instead of reporting its section-A failure.
 *
 * WHY A SEPARATE PROGRAM. `tsconfig.json` includes only .ts files under `src`, so nothing under `script/`
 * has ever been type-checked. The failure this gate would have caught is on record:
 * `00c19478 fix(m14): three harness gates could not RUN — repair the merge that broke them`
 * introduced `"manual_audit"`, `"markdown"`, `"scss"` as elements of
 * `const checks: SectionCheck[]`, tsc said nothing, and the gate died on `c.id.padEnd`. A repair
 * commit is where it came from.
 *
 * WHY NOT JUST WIDEN tsconfig.json. The src program runs on every edit. `differential.ts` alone is
 * over 20k lines, and the harness is ~60 files. Putting the harness on the hot path to buy a check
 * that runs far less often is the wrong trade, so this points at `tsconfig.harness.json` instead
 * and the two programs stay separate.
 *
 * WHY tmp/ IS EXCLUDED, specifically. `script/m14/tmp/**` holds scratch probes and copies of other
 * lanes' fixture data, and that fixture data is DELIBERATELY malformed — a constructor inside an
 * object literal in `class-expression-members.ts` is a TypeScript syntax error by design, as a
 * parse-error fixture. Including it yields three permanent failures that are properties of the
 * test corpus rather than of the code, and a gate that always fails is a gate nobody reads.
 *
 * WHAT IT DOES NOT DO. It does not check `script/m14/tmp/**` at all, so a probe that is meant to
 * be kept is not covered until it moves out of tmp — which is the correct direction, since tmp is
 * scratch by definition. It also says nothing about whether a gate PASSES; only that it type-checks.
 */
import { execFileSync } from "child_process"
import * as fs from "fs"
import * as path from "path"

const ROOT = process.cwd()
const CONFIG = path.join(ROOT, "tsconfig.harness.json")

if (!fs.existsSync(CONFIG)) {
  console.error("tsconfig.harness.json is missing — the harness would go unchecked again, which is the failure this gate exists to prevent.")
  process.exit(2)
}

console.log("harness typecheck: all .ts under src, plus all .ts under script/m14 (tmp/ excluded: scratch and deliberately-malformed fixture data)")
let out = ""
try {
  out = execFileSync("bunx", ["tsc", "--noEmit", "-p", CONFIG], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  console.log("  0 errors")
  console.log("\nVERDICT: PASS - the harness type-checks. This is the check whose absence let a typed")
  console.log("array hold three strings and take a gate down with it.")
  process.exit(0)
} catch (e: any) {
  out = `${e.stdout ?? ""}${e.stderr ?? ""}`
}

const lines = out.split("\n").filter((l) => l.includes("error TS"))

// A baseline, because a gate that reports 333 failures on the day it is written is a gate nobody
// reads — and "nobody reads it" is how the 333 got there. The baseline is the error COUNT per
// file as measured when this program was created, so a fix that removes forty and adds one
// elsewhere shows up as a move rather than a wash, and any NEW error fails. Fixing the baseline
// downward is progress; raising it is a decision someone has to make out loud.
const baselinePath = path.join(ROOT, "validation/m14/harness-typecheck-baseline.json")
let baseline: Record<string, number> = {}
let baselineTotal = 0
if (fs.existsSync(baselinePath)) {
  try {
    const b = JSON.parse(fs.readFileSync(baselinePath, "utf8"))
    baseline = b.byFile ?? {}
    baselineTotal = b.total ?? 0
  } catch { baseline = {} }
}
const byFile = new Map<string, number>()
for (const l of lines) {
  const f = l.slice(0, l.indexOf("("))
  byFile.set(f, (byFile.get(f) ?? 0) + 1)
}
console.log(`  ${lines.length} error(s) across ${byFile.size} file(s)\n`)
for (const [f, n] of [...byFile.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
  console.log(`  ${String(n).padStart(4)}  ${f.replace(ROOT + "/", "")}`)
}
console.log(`\n  first 10:`)
for (const l of lines.slice(0, 10)) console.log(`    ${l.replace(ROOT + "/", "")}`)

const inTmp = lines.filter((l) => l.includes("/tmp/"))
if (inTmp.length > 0) {
  console.log(`\n  ${inTmp.length} error(s) are under script/m14/tmp/ — the exclusion is not working and`)
  console.log(`  should be widened rather than these being reported as code defects.`)
}
// per-file comparison against the baseline
const actual: Record<string, number> = {}
for (const l of lines) {
  const f = l.slice(0, l.indexOf("("))
  actual[f] = (actual[f] ?? 0) + 1
}
const rel = (f: string): string => f.replace(ROOT + "/", "")

// `--write-baseline` re-records the current per-file counts, and exists so the baseline can be
// kept honest as lanes fix their own files rather than drifting permanently stale. It is a
// deliberate act: a baseline only ever moves down without someone running this on purpose.
if (process.argv.includes("--write-baseline")) {
  const out2: Record<string, number> = {}
  for (const [f, n] of Object.entries(actual)) out2[rel(f)] = n
  const sorted: Record<string, number> = {}
  for (const k of Object.keys(out2).sort()) sorted[k] = out2[k]
  const byCode: Record<string, number> = {}
  for (const l of lines) { const m = /error (TS\d+):/.exec(l); if (m) byCode[m[1]] = (byCode[m[1]] ?? 0) + 1 }
  fs.writeFileSync(baselinePath, JSON.stringify({
    _why: "tsconfig.json includes only .ts under src, so nothing under script/ was ever in a TypeScript program. That is how completeness-inventory.ts came to hold three bare strings inside `const checks: SectionCheck[]` — legal JavaScript, invisible to tsc, and a runtime crash in the gate it broke. These are the errors that already existed when the harness program was created; the gate fails on any error NOT in this baseline.",
    _measured: "tsconfig.harness.json, excluding script/m14/tmp (scratch + deliberately malformed fixture data)",
    total: lines.length,
    files: Object.keys(sorted).length,
    byFile: sorted,
    byCode,
  }, null, 2) + "\n")
  console.log(`  wrote ${baselinePath}: ${lines.length} errors across ${Object.keys(sorted).length} files`)
}
const newErrors: string[] = []
const grown: string[] = []
for (const [f, n] of Object.entries(actual)) {
  const was = baseline[rel(f)] ?? 0
  if (n > was) (n > was && was === 0 ? newErrors : grown).push(`    ${rel(f)}: ${was} -> ${n} (+${n - was})`)
}
for (const [f, was] of Object.entries(baseline)) {
  const now = actual[path.join(ROOT, f)] ?? 0
  if (now === 0) console.log(`  FIXED  ${f}  (${was} -> 0)`)
}
if (grown.length > 0) {
  console.log(`\n  file(s) with MORE errors than the baseline:`)
  for (const g of grown) console.log(g)
}
if (newErrors.length > 0) {
  console.log(`\n  file(s) with errors the baseline never recorded:`)
  for (const g of newErrors) console.log(g)
}
if (grown.length === 0 && newErrors.length === 0) {
  console.log(`  no file exceeds its baseline (${baselineTotal} errors recorded, ${lines.length} present)`)
  console.log(`\nVERDICT: PASS (at baseline) — no NEW type error in the harness.`)
  console.log(`  ${baselineTotal} pre-existing errors remain, ${baselineTotal - lines.length} fixed since. They are`)
  console.log(`  other lanes' code and are not this commit's to change silently.`)
  process.exit(0)
}
console.log(`\nVERDICT: FAIL — ${grown.length + newErrors.length} file(s) regressed against the baseline.`)
console.log(`  Every "0 tsc errors" claim about a script/m14 file made before tsconfig.harness.json`)
console.log(`  existed was vacuous, because those files were in no TypeScript program at all.`)
process.exit(1)
