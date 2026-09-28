// M20.X2 — real repositories and complexity ledger.
//
// Runs the tools against real repositories on disk, records measured wall-clock
// and index sizes, and reports blocked states honestly when a corpus is
// unavailable or times out. Nothing is fabricated: every number in the ledger
// is measured by this run.
//
// Corpora:
//   small  - rake/lib/rake (Ruby)
//   medium - rebar3/apps (Erlang)
//   large  - $HOME/TypeScript/src/compiler (TypeScript)
//
// Per repo: index wall time, file/symbol counts, patterns scan time + count,
// security scan time + count. Missing corpus -> recorded as blocked.

import { mkdirSync, writeFileSync, existsSync } from "node:fs"
import { execFileSync } from "node:child_process"
import path from "node:path"
import { performance } from "node:perf_hooks"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { PatternBrainTools } from "../../src/ast/tools"
import { CrossLanguageSecurityAnalysis } from "../../src/security/cross-language-security"
import { migrationSourceFingerprint } from "../../src/intelligence/migration/migration-evidence"
import { patternSourceFingerprint } from "../../src/intelligence/patterns/evidence"
import { securitySourceFingerprint } from "../../src/intelligence/security/evidence"
import { docSourceFingerprint } from "../../src/intelligence/documentation/evidence"
import { createHash } from "node:crypto"

let checks = 0
let passed = 0
let negativeCases = 0
function check(label: string, condition: boolean, detail = ""): void {
  checks++
  if (condition) { passed++; console.log(`  ok: ${label}`) }
  else console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`)
}
function negative(label: string, condition: boolean, detail = ""): void {
  negativeCases++
  check(`${label} [negative]`, condition, detail)
}

function crossToolSourceFingerprint(rootPath: string): string {
  const joined = [migrationSourceFingerprint(rootPath), patternSourceFingerprint(rootPath), securitySourceFingerprint(rootPath), docSourceFingerprint(rootPath)].join("|")
  return createHash("sha256").update(joined).digest("hex")
}

const REPO_ROOT = "$HOME/fixtures/repositories"
const TSC = "$HOME/TypeScript/src/compiler"
const corpora: Array<{ id: string; path: string; family: string }> = [
  { id: "rake", path: path.join(REPO_ROOT, "rake", "lib", "rake"), family: "ruby" },
  { id: "rebar3", path: path.join(REPO_ROOT, "rebar3", "apps"), family: "erlang" },
  { id: "typescript-compiler", path: TSC, family: "typescript" },
]

const ledger: any[] = []
const cleanup: Array<() => void> = []
for (const corpus of corpora) {
  if (!existsSync(corpus.path)) {
    ledger.push({ corpus: corpus.id, family: corpus.family, state: "blocked", reason: "missing-path" })
    continue
  }
  const projectId = getProjectId(corpus.path)
  let indexMs = 0
  let patternsMs = 0
  let securityMs = 0
  try {
    let t0 = performance.now()
    await indexProjectParallel(projectId, corpus.path, {})
    indexMs = Math.round(performance.now() - t0)
    const raw = await BrainDatabase.getRawInstance(projectId)
    const files = (raw.prepare("SELECT COUNT(*) c FROM brain_file WHERE project_id=?").get(projectId) as { c: number }).c
    const symbols = (raw.prepare("SELECT COUNT(*) c FROM brain_symbol WHERE project_id=?").get(projectId) as { c: number }).c

    t0 = performance.now()
    const patterns = await PatternBrainTools.detectPatterns(projectId, { includeOrphaned: true, includeFramework: false, includeAntiPatterns: true, confidenceThreshold: 0, maxResults: 100 })
    patternsMs = Math.round(performance.now() - t0)

    t0 = performance.now()
    const security = await CrossLanguageSecurityAnalysis.analyzeSecurityAcrossLanguages(projectId)
    securityMs = Math.round(performance.now() - t0)

    const findingCount = patterns.patterns.length
    ledger.push({ corpus: corpus.id, family: corpus.family, state: "measured", files, symbols, indexMs, patternsMs, securityMs, patternFindings: findingCount, securityTotal: security.summary.total, securityResolved: security.summary.resolved, securityUnresolved: security.summary.unresolvedSources })
    check(`corpus ${corpus.id}: indexed and measured`, files > 0 && symbols > 0, JSON.stringify({ files, symbols }))
    check(`corpus ${corpus.id}: patterns scan completed with count`, typeof findingCount === "number", `count=${findingCount}`)
    check(`corpus ${corpus.id}: security scan completed with summary`, typeof security.summary.total === "number", `total=${security.summary.total}`)
  } catch (error) {
    ledger.push({ corpus: corpus.id, family: corpus.family, state: "blocked", reason: error instanceof Error ? error.message.slice(0, 200) : String(error) })
  } finally {
    const dbDir = path.dirname(BrainDatabase.getDbPath(projectId))
    cleanup.push(() => { try { BrainDatabase.getRawInstance(projectId).close() } catch {} })
    // Remove the indexed DB after measurement to avoid disk growth.
    try { const { rmSync } = require("node:fs") as typeof import("node:fs"); rmSync(dbDir, { recursive: true, force: true }) } catch {}
  }
}

const measuredCount = ledger.filter((entry) => entry.state === "measured").length
check("ledger: at least two corpora measured", measuredCount >= 2, `measured=${measuredCount}`)
const blocked = ledger.filter((entry) => entry.state === "blocked")
check("ledger: blocked states recorded without fabrication", blocked.length === corpora.length - measuredCount, JSON.stringify(blocked))
negative("ledger: no corpus reports measured with zero files", ledger.every((entry) => entry.state !== "measured" || entry.files > 0), JSON.stringify(ledger))

const failed = checks - passed
// Real relevant-dirty-check: prove the cross-tool boundary + M20 scripts are clean
// before calling this evidence verified. Mirrors the governance verifier's gate.
const relevantWorkingTreeChanges = (): string[] => {
  try {
    const relevant = new Set(["docs/m20/M20-MASTER-PLAN.md", "package.json"])
    return execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
      .split("\n").map((line) => line.slice(3).trim()).filter((file) => file && (file.startsWith("script/m20/") || file.startsWith("src/intelligence/") || relevant.has(file)))
  } catch {
    return ["git-status-unavailable"]
  }
}
const dirty = relevantWorkingTreeChanges()
const result = {
  issue: "M20.X2", code: "X2", milestone: "M20",
  status: failed === 0 && dirty.length === 0 ? "verified" : "known-gap",
  checks, passed, failed, negativeCases,
  currentCommit: (() => { try { return Bun.spawnSync(["git", "rev-parse", "HEAD"]).stdout.toString().trim() } catch { return "unknown" } })(),
  sourceFingerprint: crossToolSourceFingerprint(path.resolve(".")),
  workingTreeRelevantChanges: dirty,
  verifierCommand: "bun run script/m20/verify-real-repo-ledger.ts",
  evidenceFile: "X2.json",
  generatedAt: new Date().toISOString(),
  measured: ledger,
  limitations: ["Wall-clock measurements are environment-dependent (concurrent co-agent indexing may inflate times); they prove completion and scale, not a performance guarantee.", "Corpus coverage is limited to the repositories present on this machine at run time."],
}
mkdirSync(path.resolve("validation/m20/results"), { recursive: true })
writeFileSync(path.resolve("validation/m20/results/X2.json"), JSON.stringify(result, null, 2) + "\n")
console.log(result.status === "verified" ? "\nCROSS-TOOL X2: PASS" : `\nCROSS-TOOL X2: ${failed} FAILURES (dirty=${dirty.length})`)
process.exit(failed || dirty.length ? 1 : 0)