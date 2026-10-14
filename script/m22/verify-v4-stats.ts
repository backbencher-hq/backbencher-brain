// script/m22/verify-v4-stats.ts — M22.V4
// Proves `bb stats [<dir>]` returns committed index counts anytime, matched
// against an INDEPENDENT SQL count (not the same code path), and that an
// unindexed project reports "no index" instead of a fabricated zero.
// No auto-pass / tautological assertions.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const RESULTS = path.join(ROOT, "validation/m22/results")

let checks = 0
let passed = 0
let negatives = 0
function check(label: string, ok: boolean, detail = "") { checks++; if (ok) passed++; else console.log(`FAIL: ${label}${detail ? ` — ${detail}` : ""}`) }
function negative(label: string, ok: boolean, detail = "") { negatives++; check(`${label} [negative]`, ok, detail) }

async function run() {
  const root = mkdtempSync(path.join(tmpdir(), "m22-v4-"))
  const proj = path.join(root, "proj")
  mkdirSync(path.join(proj, "src"), { recursive: true })
  const N = 12
  for (let i = 0; i < N; i++) writeFileSync(path.join(proj, "src", `m${i}.ts`), `export function k${i}(){return ${i}}\n`)
  const pid = getProjectId(proj)
  await indexProjectParallel(pid, proj, {})

  // independent SQL counts
  const db = await BrainDatabase.getRawInstance(pid)
  const sqlFiles = (db.prepare("SELECT COUNT(*) c FROM brain_file").get() as any)?.c ?? 0
  const sqlSymbols = (db.prepare("SELECT COUNT(*) c FROM brain_symbol").get() as any)?.c ?? 0
  const sqlRels = (db.prepare("SELECT COUNT(*) c FROM brain_relationship").get() as any)?.c ?? 0

  // bb stats via source CLI
  const runner = path.join(root, "run.mjs")
  writeFileSync(runner, `import { runCli } from ${JSON.stringify(path.join(ROOT, "src/cli/index.ts"))}\nawait runCli(["stats", ${JSON.stringify(proj)}]).catch(()=>process.exit(0))\n`)
  let out = ""
  try { out = execFileSync("bun", [runner], { cwd: ROOT, encoding: "utf8", timeout: 90_000 }) } catch (e: any) { out = (e.stdout || "") + (e.stderr || "") }
  const m = out.match(/files (\d+) \| symbols (\d+) \| relationships (\d+) \| embeddings (\d+)/)
  check("V4 bb stats prints a files/symbols/relationships/embeddings line", !!m, out.slice(-200))
  if (m) {
    check("V4 stats files match independent SQL count", Number(m[1]) === sqlFiles, `stats=${m[1]} sql=${sqlFiles}`)
    check("V4 stats symbols match independent SQL count", Number(m[2]) === sqlSymbols, `stats=${m[2]} sql=${sqlSymbols}`)
    check("V4 stats relationships match independent SQL count", Number(m[3]) === sqlRels, `stats=${m[3]} sql=${sqlRels}`)
  }

  // negative: unindexed project => "no index", not a fabricated zero line
  const noProj = path.join(root, "unindexed")
  mkdirSync(noProj, { recursive: true })
  writeFileSync(path.join(noProj, "x.ts"), "export const q=1\n")
  const runner2 = path.join(root, "run2.mjs")
  writeFileSync(runner2, `import { runCli } from ${JSON.stringify(path.join(ROOT, "src/cli/index.ts"))}\nawait runCli(["stats", ${JSON.stringify(noProj)}]).catch(()=>process.exit(0))\n`)
  let out2 = ""
  try { out2 = execFileSync("bun", [runner2], { cwd: ROOT, encoding: "utf8", timeout: 60_000 }) } catch (e: any) { out2 = (e.stdout || "") + (e.stderr || "") }
  negative("V4 an unindexed project reports no-index (not a fabricated zero)", /no index for/.test(out2), out2.slice(-120))

  // second negative (honesty): a project whose DB exists but holds no index
  // rows must NOT be reported as an indexed project with fabricated counts.
  const emptyPid = getProjectId(path.join(root, "empty-but-open"))
  const emptyDb = await BrainDatabase.getRawInstance(emptyPid) // creates an empty schema'd DB
  const zeroFiles = (emptyDb.prepare("SELECT COUNT(*) c FROM brain_file").get() as any)?.c ?? -999
  const cp = await (await import("../../src/ast/index-status")).composeStatus(emptyPid)
  negative("V4 an empty index (DB exists, 0 rows) is not surfaced as indexed counts", zeroFiles === 0 && cp.dbStats.files === 0 && cp.hasIndex === false, `files=${cp.dbStats.files}`)

  rmSync(root, { recursive: true, force: true })
  const finalStatus = passed === checks && negatives >= 2 ? "verified" : "known-gap"
  mkdirSync(RESULTS, { recursive: true })
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
  const result = {
    issue: "M22.V4", code: "V4", milestone: "M22", status: finalStatus,
    checks, passed, failed: checks - passed, negativeCases: negatives,
    currentCommit: commit, workingTreeRelevantChanges: [],
    verifierCommand: "bun run script/m22/verify-v4-stats.ts",
    evidenceFile: "V4.json", generatedAt: new Date().toISOString(),
    command: "bun run script/m22/verify-v4-stats.ts",
    independentCounts: { files: sqlFiles, symbols: sqlSymbols, relations: sqlRels },
    limitations: ["Counts are verified against independent SQL on a controlled fixture; real-repo counts match the same code path."],
  }
  writeFileSync(path.join(RESULTS, "V4.json"), JSON.stringify(result, null, 2) + "\n")
  try {
    const led = JSON.parse(readFileSync(path.join(ROOT, "validation/m22/ledger.json"), "utf8"))
    const e = Object.values(led.issues).find((i: any) => i.code === "V4")
    if (e) { e.status = finalStatus; e.passed = passed; e.failed = checks - passed; e.commit = commit; e.evidenceFile = "V4.json" }
    writeFileSync(path.join(ROOT, "validation/m22/ledger.json"), JSON.stringify(led, null, 2) + "\n")
  } catch (e2: any) { console.log(`V4: ledger self-update failed: ${e2?.message}`) }
  console.log(`V4: ${result.status.toUpperCase()} (${result.passed}/${result.checks}, ${result.negativeCases} negative)`)
  process.exit(finalStatus === "verified" ? 0 : 1)
}

run().catch((e) => { console.error("V4 verifier crashed:", e); process.exit(1) })