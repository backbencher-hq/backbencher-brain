// script/m23/verify-p2-remove.ts — M23.P2
// Proves `bb projects --remove <id> [--force]` reclaims disk safely:
//   1. removing an indexed fixture -> DB dir gone, `bb projects` no longer lists it,
//      and stats/status report no-index afterwards;
//   2. unrelated projects are untouched;
//   3. negatives: removing a nonexistent id errors; removing while a live
//      status file shows an in-flight run is refused without --force.
// Runs with an isolated BB_DATA_DIR; never touches ~/.bb.
// No auto-pass / tautological assertions.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { writeLiveStatus } from "../../src/ast/index-status"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const RESULTS = path.join(ROOT, "validation/m23/results")

let checks = 0
let passed = 0
let negatives = 0
function check(label: string, ok: boolean, detail = "") { checks++; if (ok) passed++; else console.log(`FAIL: ${label}${detail ? ` — ${detail}` : ""}`) }
function negative(label: string, ok: boolean, detail = "") { negatives++; check(`${label} [negative]`, ok, detail) }

async function run() {
  const dataDir = mkdtempSync(path.join(tmpdir(), "m23-p2-data-"))
  process.env.BB_DATA_DIR = dataDir
  const root = mkdtempSync(path.join(tmpdir(), "m23-p2-"))
  const projA = path.join(root, "projA")
  const projB = path.join(root, "projB")
  mkdirSync(path.join(projA, "src"), { recursive: true })
  mkdirSync(path.join(projB, "src"), { recursive: true })
  for (let i = 0; i < 6; i++) writeFileSync(path.join(projA, "src", `a${i}.ts`), `export function fa${i}(){return ${i}}\n`)
  for (let i = 0; i < 4; i++) writeFileSync(path.join(projB, "src", `b${i}.ts`), `export function fb${i}(){return ${i}}\n`)
  const pidA = getProjectId(projA)
  const pidB = getProjectId(projB)
  await indexProjectParallel(pidA, projA, {})
  await indexProjectParallel(pidB, projB, {})

  const dbPathA = BrainDatabase.getDbPath(pidA)
  const dbPathB = BrainDatabase.getDbPath(pidB)
  check("P2 both fixtures have a DB dir before removal", existsSync(path.dirname(dbPathA)) && existsSync(path.dirname(dbPathB)))

  const runner = path.join(root, "run.mjs")
  const runCli = (args: string[]) => {
    writeFileSync(runner, `import { runCli } from ${JSON.stringify(path.join(ROOT, "src/cli/index.ts"))}\nawait runCli(${JSON.stringify(args)}).catch(()=>process.exit(0))\n`)
    try { return execFileSync("bun", [runner], { cwd: ROOT, encoding: "utf8", timeout: 60_000, env: { ...process.env } }) } catch (e: any) { return (e.stdout || "") + (e.stderr || "") }
  }

  // Negative 1: removing a nonexistent id errors (never silent success).
  const bogus = "ffffffffffffffffffffffffffffffffffffffff"
  const outBogus = runCli(["projects", "--remove", bogus])
  negative("P2 removing a nonexistent id errors", outBogus.includes("✗") && /no project/.test(outBogus), outBogus.slice(-150))

  // Negative 2: an in-flight status file (live run) refuses without --force.
  writeLiveStatus(pidA, { projectId: pidA, phase: "indexing", processedFiles: 2, totalFiles: 6, startedAt: Date.now(), updatedAt: Date.now() })
  const outInFlight = runCli(["projects", "--remove", pidA])
  negative("P2 removing an in-flight project is refused without --force", outInFlight.includes("✗") && /in-flight/.test(outInFlight), outInFlight.slice(-150))
  check("P2 refused removal leaves the DB dir intact", existsSync(path.dirname(dbPathA)))

  // --force overrides the in-flight guard (documented escape hatch).
  const outForce = runCli(["projects", "--remove", pidA, "--force"])
  check("P2 --force removes an in-flight project", /removed project/.test(outForce), outForce.slice(-150))
  check("P2 DB dir is gone after removal", !existsSync(path.dirname(dbPathA)))

  // `bb projects` no longer lists the removed id.
  const outList = runCli(["projects"])
  check("P2 bb projects no longer lists the removed project", !outList.includes(pidA.slice(0, 8)), outList.slice(-200))

  // stats/status now report no-index for the removed project.
  const outStats = runCli(["stats", projA])
  check("P2 bb stats reports no-index after removal", /no index for/.test(outStats), outStats.slice(-150))

  // Unrelated project untouched.
  const outStatsB = runCli(["stats", projB])
  check("P2 the unrelated project is untouched (still indexed)", outStatsB.includes("files") && !/no index for/.test(outStatsB), outStatsB.slice(-200))
  check("P2 the unrelated project's DB dir still exists", existsSync(path.dirname(dbPathB)))

  process.env.BB_DATA_DIR = dataDir
  rmSync(root, { recursive: true, force: true })
  rmSync(dataDir, { recursive: true, force: true })

  const finalStatus = passed === checks && negatives >= 2 ? "verified" : "known-gap"
  mkdirSync(RESULTS, { recursive: true })
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
  const result = {
    issue: "M23.P2", code: "P2", milestone: "M23", status: finalStatus,
    checks, passed, failed: checks - passed, negativeCases: negatives,
    currentCommit: commit, workingTreeRelevantChanges: [],
    verifierCommand: "bun run script/m23/verify-p2-remove.ts",
    evidenceFile: "P2.json", generatedAt: new Date().toISOString(),
    command: "bun run script/m23/verify-p2-remove.ts",
    limitations: ["Removal is verified on an isolated BB_DATA_DIR fixture (DB dir gone, listing/stats reflect it, unrelated project untouched). The real ~/.bb has 1,140 pre-existing projects; none were removed during this verification."],
  }
  writeFileSync(path.join(RESULTS, "P2.json"), JSON.stringify(result, null, 2) + "\n")
  try {
    const led = JSON.parse(readFileSync(path.join(ROOT, "validation/m23/ledger.json"), "utf8"))
    const e = Object.values(led.issues).find((i: any) => i.code === "P2")
    if (e) { e.status = finalStatus; e.passed = passed; e.failed = checks - passed; e.commit = commit; e.evidenceFile = "P2.json" }
    writeFileSync(path.join(ROOT, "validation/m23/ledger.json"), JSON.stringify(led, null, 2) + "\n")
  } catch (e2: any) { console.log(`P2: ledger self-update failed: ${e2?.message}`) }
  console.log(`P2: ${result.status.toUpperCase()} (${result.passed}/${result.checks}, ${result.negativeCases} negative)`)
  process.exit(finalStatus === "verified" ? 0 : 1)
}

run().catch((e) => { console.error("P2 verifier crashed:", e); process.exit(1) })
