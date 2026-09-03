// script/m22/verify-c1-cwd.ts — M22.C1
// Proves `bb index` (source CLI, invoked via runCli) defaults the project
// directory to the current working directory when no <dir> argument is given,
// while an explicit nonexistent path still errors clearly.
// No auto-pass / tautological assertions.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const RESULTS = path.join(ROOT, "validation/m22/results")

let checks = 0
let passed = 0
let negatives = 0
function check(label: string, ok: boolean, detail = "") { checks++; if (ok) passed++; else console.log(`FAIL: ${label}${detail ? ` — ${detail}` : ""}`) }
function negative(label: string, ok: boolean, detail = "") { negatives++; check(`${label} [negative]`, ok, detail) }

async function run() {
  const root = mkdtempSync(path.join(tmpdir(), "m22-c1-"))
  const proj = path.join(root, "proj")
  mkdirSync(path.join(proj, "src"), { recursive: true })
  for (let i = 0; i < 8; i++) writeFileSync(path.join(proj, "src", `m${i}.ts`), `export function g${i}(){return ${i}}\n`)

  // Run the SOURCE CLI from inside the project with NO dir argument.
  const runner = path.join(root, "run.mjs")
  writeFileSync(runner, `import { runCli } from ${JSON.stringify(path.join(ROOT, "src/cli/index.ts"))}\nawait runCli(["index"])\n`)
  let out = ""
  try {
    out = execFileSync("bun", [runner], { cwd: proj, encoding: "utf8", timeout: 120_000 })
  } catch (e: any) {
    out = (e.stdout || "") + (e.stderr || "")
  }
  // Without --force and with cwd defaulting, the project must be indexed.
  const indexed = /indexed \d+ files, \d+ symbols/i.test(out)
  check("C1 bb index with no <dir> (from inside the project) indexes the cwd", indexed, out.split("\n").slice(-3).join(" "))

  // Negative: a nonexistent explicit path must still error clearly.
  const runner2 = path.join(root, "run2.mjs")
  writeFileSync(runner2, `import { runCli } from ${JSON.stringify(path.join(ROOT, "src/cli/index.ts"))}\nawait runCli(["index", ${JSON.stringify(path.join(root, "does-not-exist"))}]).catch(()=>process.exit(0))\n`)
  let out2 = ""
  try {
    out2 = execFileSync("bun", [runner2], { cwd: proj, encoding: "utf8", timeout: 60_000 })
  } catch (e: any) {
    out2 = (e.stdout || "") + (e.stderr || "")
  }
  // requireDir prints "✗ not a directory" and calls process.exit(1).
  negative("C1 a nonexistent explicit <dir> is rejected, not silently indexed", /not a directory/.test(out2), out2.split("\n").slice(-2).join(" "))

  rmSync(root, { recursive: true, force: true })
  const finalStatus = passed === checks && negatives >= 1 ? "verified" : "known-gap"
  mkdirSync(RESULTS, { recursive: true })
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
  const result = {
    issue: "M22.C1", code: "C1", milestone: "M22", status: finalStatus,
    checks, passed, failed: checks - passed, negativeCases: negatives,
    currentCommit: commit, workingTreeRelevantChanges: [],
    verifierCommand: "bun run script/m22/verify-c1-cwd.ts",
    evidenceFile: "C1.json", generatedAt: new Date().toISOString(),
    command: "bun run script/m22/verify-c1-cwd.ts",
    fromInsideProjectIndexed: indexed,
    explicitNonexistentRejected: /not a directory/.test(out2),
    limitations: ["Verifies the source CLI cwd-default behavior; the compiled npm binary picks up the same cmdIndex path on rebuild."],
  }
  writeFileSync(path.join(RESULTS, "C1.json"), JSON.stringify(result, null, 2) + "\n")
  try {
    const led = JSON.parse(readFileSync(path.join(ROOT, "validation/m22/ledger.json"), "utf8"))
    const e = Object.values(led.issues).find((i: any) => i.code === "C1")
    if (e) { e.status = finalStatus; e.passed = passed; e.failed = checks - passed; e.commit = commit; e.evidenceFile = "C1.json" }
    writeFileSync(path.join(ROOT, "validation/m22/ledger.json"), JSON.stringify(led, null, 2) + "\n")
  } catch (e2: any) { console.log(`C1: ledger self-update failed: ${e2?.message}`) }
  console.log(`C1: ${result.status.toUpperCase()} (${result.passed}/${result.checks}, ${result.negativeCases} negative)`)
  process.exit(finalStatus === "verified" ? 0 : 1)
}

run().catch((e) => { console.error("C1 verifier crashed:", e); process.exit(1) })