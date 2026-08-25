/**
 * OWNER SPOT-CHECK HELPER (#419 / honesty-contract §5.6).
 *
 * Not a gate. Produces the per-language evidence pack a human reviewer
 * needs to sample claims quickly:
 *   - fixture inventory with introducing commit + pre-fix proof pointer
 *   - live re-run verdict per fixture
 *   - current gates snapshot (audit/differential/typecheck floors)
 *
 * CLI: bun run script/m14/owner-spot-check.ts --lang svelte [--sample 3]
 */
import * as fs from "fs"
import * as path from "path"

const ROOT = path.join(__dirname, "..", "..")
const args = process.argv.slice(2)
const lang = args.includes("--lang") ? args[args.indexOf("--lang") + 1] : "svelte"
const sampleN = args.includes("--sample") ? parseInt(args[args.indexOf("--sample") + 1]) : 3

function sh(cmd: string): string {
  try {
    return require("child_process").execSync(cmd, { cwd: ROOT, encoding: "utf8" }).trim()
  } catch (e: any) {
    return `(failed: ${String(e?.message ?? e).slice(0, 80)})`
  }
}

const dir = path.join(ROOT, "validation", "m14", "fixtures", lang)
if (!fs.existsSync(dir)) {
  console.error(`no fixtures for ${lang}`)
  process.exit(1)
}
const files = fs.readdirSync(dir).filter((f) => !f.endsWith(".expectation.json"))

console.log(`# OWNER SPOT-CHECK PACK — ${lang}`)
console.log(`generated: ${new Date().toISOString()}`)
console.log(`HEAD: ${sh("git rev-parse HEAD")}`)
console.log("")

// 1. Fixture inventory with provenance
console.log(`## Fixture inventory (${files.length})`)
for (const f of files.sort()) {
  const base = f.replace(/\.[^.]+$/, "")
  const firstCommit = sh(
    `git log --diff-filter=A --format="%h | %s" -1 -- validation/m14/fixtures/${lang}/${f}`,
  )
  console.log(`  ${base}\n    provenance: ${firstCommit || "(uncommitted)"}`)
}

// 2. Live verdict
console.log(`\n## Live re-run`)
const out = sh(`bun run script/m14/run-fixtures.ts --lang ${lang} 2>&1`)
for (const line of out.split("\n")) {
  if (/^(PASS|FAIL)/.test(line.trim()) || line.includes("summary")) console.log("  " + line.trim())
}

// 3. Random sample pack for human inspection
console.log(`\n## Sample ${sampleN} fixture(s) for manual inspection`)
const seeded = [...files].sort(() => 0.5 - Math.random()).slice(0, sampleN)
for (const f of seeded) {
  const base = f.replace(/\.[^.]+$/, "")
  const expPath = path.join(dir, `${base}.expectation.json`)
  console.log(`\n  --- ${base} ---`)
  console.log(`  source: validation/m14/fixtures/${lang}/${f}`)
  if (fs.existsSync(expPath)) {
    const exp = JSON.parse(fs.readFileSync(expPath, "utf8"))
    console.log(`  claim:   ${exp.rationale ? exp.rationale.slice(0, 160) : "(no rationale)"}`)
    const checks = Object.keys(exp).filter((k) => k.startsWith("expect") || k.startsWith("forbid"))
    console.log(`  asserts: ${checks.join(", ")}`)
  }
}

// 4. Gates snapshot
console.log(`\n## Gates snapshot`)
const baseline = JSON.parse(fs.readFileSync(path.join(ROOT, "validation", "m14", "differential-baseline.json"), "utf8"))
const counts = baseline.counts ?? {}
for (const [k, v] of Object.entries<any>(counts)) {
  if (!k.startsWith(`${lang}:`) && !k.endsWith(`:${lang}`)) continue
  const anyV: any = v
  if (anyV.missing === undefined) continue
  console.log(`  ${k}: missing=${anyV.missing} unexplained=${anyV.unexplained} perf=${anyV.perf?.avgMsPerFile}ms/file`)
}
console.log(`\nVerify independently:`)
console.log(`  bun run script/m14/run-fixtures.ts --lang ${lang}`)
console.log(`  bun run script/m14/audit-analyzer-grammar.ts --prove-java`)
console.log(`  bun run script/m14/differential.ts --repo <corpus>`)
