// test/indexing-lifecycle/run-all.ts — the indexing-lifecycle suite runner.
//
// Runs every file in this directory as its own process (each test isolates its
// own $BB_DATA_DIR, and some drive env and cross-process behaviour, so they
// cannot share one) and prints one summary table.
//
//   npx tsx test/indexing-lifecycle/run-all.ts              # product as-is
//   npx tsx test/indexing-lifecycle/run-all.ts --with-repair
//
// `--with-repair` turns on the DIAGNOSTIC-ONLY shim documented in harness.ts,
// which patches the broken brain_symbol INSERT in-process so the rest of the
// lifecycle still produces signal. Results from that mode do NOT describe the
// shipped product; it exists to separate "one defect blocks everything" from
// "many defects".

import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const tsxCli = path.join(HERE, "../../node_modules/tsx/dist/cli.mjs")

const SUITES = [
  "store-integrity.ts",
  "resume-equivalence.ts",
  "checkpoint-durability.ts",
  "incremental-changed.ts",
  "index-lock.ts",
  "pool-fallback.ts",
  "empty-projects.ts",
]

const withRepair = process.argv.includes("--with-repair")
const only = process.argv.slice(2).filter((a) => a.endsWith(".ts") && !a.startsWith("--"))
const suites = only.length > 0 ? only : SUITES

interface Outcome {
  name: string
  code: number
  passed: number
  failed: number
  negatives: number
  tail: string[]
}

const outcomes: Outcome[] = []

for (const file of suites) {
  const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: "1" }
  if (withRepair) env.BB_TEST_INSERT_SYMBOL_REPAIR = "1"
  else delete env.BB_TEST_INSERT_SYMBOL_REPAIR

  process.stdout.write(`\n${"═".repeat(78)}\n▶ ${file}${withRepair ? "  [repair shim ON]" : ""}\n${"═".repeat(78)}\n`)
  const r = spawnSync(process.execPath, [tsxCli, path.join(HERE, file)], {
    cwd: path.resolve(HERE, "../.."),
    env,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
  const output = `${r.stdout ?? ""}${r.stderr ?? ""}`
  // The indexer is chatty on stderr; keep the readable lines only.
  const lines = output.split("\n")
  const failures = lines.filter((l) => l.includes("FAIL"))
  const summary = lines.find((l) => /^[a-z-]+: \d+\/\d+ passed/.test(l)) ?? ""
  const verdict = lines.filter((l) => /(ALL PASS|FAILURE\(S\)|CRASHED)/.test(l)).slice(-1)[0] ?? ""
  const m = /(\d+)\/(\d+) passed, (\d+) failed, (\d+) negative/.exec(summary)
  outcomes.push({
    name: file.replace(/\.ts$/, ""),
    code: r.status ?? -1,
    passed: m ? Number(m[1]) : 0,
    failed: m ? Number(m[3]) : 0,
    negatives: m ? Number(m[4]) : 0,
    tail: [...failures, ...(verdict ? [verdict] : [])].slice(0, 40),
  })
}

console.log(`\n${"═".repeat(78)}\nSUMMARY  (repair shim ${withRepair ? "ON — diagnostic only" : "off — product as-is"})\n${"═".repeat(78)}`)
console.log("suite                    checks  pass  fail  neg   exit")
for (const o of outcomes) {
  console.log(
    `${o.name.padEnd(24)} ${String(o.passed + o.failed).padStart(6)} ${String(o.passed).padStart(5)} ${String(o.failed).padStart(5)} ${String(o.negatives).padStart(5)}   ${o.code}`,
  )
}
const failedSuites = outcomes.filter((o) => o.code !== 0 || o.failed > 0)
for (const o of failedSuites) {
  console.log(`\n── ${o.name}: failing assertions`)
  for (const line of o.tail) console.log(`   ${line.trim().slice(0, 220)}`)
}
const totalFailed = outcomes.reduce((n, o) => n + o.failed, 0)
console.log(
  `\n${failedSuites.length === 0 ? "INDEXING LIFECYCLE: ALL PASS" : `INDEXING LIFECYCLE: ${failedSuites.length} suite(s) failing, ${totalFailed} assertion(s)`}`,
)
process.exit(failedSuites.length === 0 ? 0 : 1)