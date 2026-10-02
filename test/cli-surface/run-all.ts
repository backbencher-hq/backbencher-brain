// test/cli-surface/run-all.ts — the CLI-surface suite runner.
//
//   npx tsx test/cli-surface/run-all.ts
//   npx tsx test/cli-surface/run-all.ts matrix.ts
//
// One process per file: each suite isolates its own $BB_DATA_DIR, and the
// packaging suite writes into a staged copy of the package, so they cannot share
// one process.

import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, "../..")
const tsxCli = path.join(REPO, "node_modules/tsx/dist/cli.mjs")

const SUITES = ["matrix.ts", "behaviour.ts", "packaging.ts"]
const only = process.argv.slice(2).filter((a) => a.endsWith(".ts"))
const suites = only.length > 0 ? only : SUITES

interface Outcome {
  name: string
  code: number
  checks: number
  passed: number
  failed: number
  negatives: number
  detail: string[]
}

const outcomes: Outcome[] = []

for (const file of suites) {
  process.stdout.write(`\n${"=".repeat(78)}\n> ${file}\n${"=".repeat(78)}\n`)
  const r = spawnSync(process.execPath, [tsxCli, path.join(HERE, file)], {
    cwd: REPO,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: 1_800_000,
    env: { ...process.env, NO_COLOR: "1" },
  })
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`
  const lines = out.split("\n")
  const summary = lines.find((l) => /^[a-z-]+: \d+\/\d+ passed/.test(l)) ?? ""
  const m = /(\d+)\/(\d+) passed, (\d+) failed, (\d+) negative/.exec(summary)
  outcomes.push({
    name: file.replace(/\.ts$/, ""),
    code: r.status ?? -1,
    checks: m ? Number(m[1]) + Number(m[3]) : 0,
    passed: m ? Number(m[1]) : 0,
    failed: m ? Number(m[3]) : 0,
    negatives: m ? Number(m[4]) : 0,
    detail: lines.filter((l) => l.includes("FAIL") || l.startsWith("  note:")).slice(0, 60),
  })
}

console.log(`\n${"=".repeat(78)}\nSUMMARY\n${"=".repeat(78)}`)
console.log("suite          checks  pass  fail  neg   exit")
for (const o of outcomes) {
  console.log(
    `${o.name.padEnd(14)} ${String(o.checks).padStart(6)} ${String(o.passed).padStart(5)} ${String(o.failed).padStart(5)} ${String(o.negatives).padStart(5)}   ${o.code}`,
  )
}
const bad = outcomes.filter((o) => o.code !== 0 || o.failed > 0)
for (const o of bad) {
  console.log(`\n-- ${o.name}: failing assertions`)
  for (const line of o.detail) console.log(`   ${line.trim().slice(0, 230)}`)
}
const totalFailed = outcomes.reduce((n, o) => n + o.failed, 0)
console.log(`\n${bad.length === 0 ? "CLI SURFACE: ALL PASS" : `CLI SURFACE: ${bad.length} suite(s) failing, ${totalFailed} assertion(s)`}`)
process.exit(bad.length === 0 ? 0 : 1)