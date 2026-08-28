// script/m21/verify-corpus.ts — M21.C2
// Read-only corpus identity gate. Never reset, clean, checkout, or write to a
// repository under test.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs"
import { execFileSync } from "node:child_process"
import path from "node:path"

type Row = { id: string; path: string; revision: string | null; trackedFiles: number | null; dirtyEntries: number | null; sizeClass: string; state: string; evidenceEligible?: boolean }
const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const REGISTRY = path.join(ROOT, "validation/m21/results/corpus-registry.json")
const RESULT = path.join(ROOT, "validation/m21/results/C2.json")
let checks = 0, passed = 0, negatives = 0
function check(label: string, ok: boolean, detail = "") { checks++; if (ok) passed++; else console.log(`FAIL: ${label}${detail ? ` — ${detail}` : ""}`) }
function negative(label: string, ok: boolean, detail = "") { negatives++; check(`${label} [negative]`, ok, detail) }
function git(repo: string, args: string[], maxBuffer = 1024 * 1024): string { return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer, stdio: ["ignore", "pipe", "ignore"] }).trim() }
function trackedFileCount(repo: string): number {
  // Keep the large path list out of the parent process. `git ls-files -z`
  // remains exact, while wc counts NUL-delimited records in a streaming pipe.
  const output = execFileSync("sh", ["-c", "git -C \"$1\" ls-files -z | tr -cd '\\0' | wc -c", "m21-corpus", repo], { encoding: "utf8", maxBuffer: 1024, stdio: ["ignore", "pipe", "ignore"] }).trim()
  return Number(output)
}
function inspect(row: Row): { exists: boolean; revision: string | null; trackedFiles: number | null; dirtyEntries: number | null } {
  if (!existsSync(row.path)) return { exists: false, revision: null, trackedFiles: null, dirtyEntries: null }
  try {
    return {
      exists: git(row.path, ["rev-parse", "--is-inside-work-tree"]) === "true",
      revision: git(row.path, ["rev-parse", "HEAD"]),
      trackedFiles: trackedFileCount(row.path),
      dirtyEntries: Number(git(row.path, ["status", "--porcelain"]).split("\n").filter(Boolean).length),
    }
  } catch { return { exists: false, revision: null, trackedFiles: null, dirtyEntries: null } }
}

const registry = JSON.parse(readFileSync(REGISTRY, "utf8")) as { schemaVersion: number; milestone: string; policy: Record<string, unknown>; repositories: Row[] }
check("C2 registry identity", registry.schemaVersion === 1 && registry.milestone === "M21" && registry.repositories.length >= 10)
check("C2 read-only policy declared", registry.policy.activeCheckoutsAreReadOnly === true && registry.policy.dirtyRepositoriesAreEvidenceEligible === false)
check("C2 has size classes", registry.repositories.some((r) => r.sizeClass === "small") && registry.repositories.some((r) => r.sizeClass === "medium") && registry.repositories.some((r) => ["large", "giant"].includes(r.sizeClass)))
check("C2 has explicit dirty and missing cases", registry.repositories.some((r) => r.state === "dirty") && registry.repositories.some((r) => r.state === "missing"))

const observations = registry.repositories.map((row) => ({ row, observed: inspect(row) }))
for (const { row, observed } of observations) {
  if (row.state === "missing") {
    negative(`${row.id}: missing path is not evidence eligible`, !observed.exists && row.evidenceEligible === false, `exists=${observed.exists}`)
    continue
  }
  check(`${row.id}: repository path/git exists`, observed.exists, row.path)
  check(`${row.id}: revision matches registry`, observed.revision === row.revision, `expected=${row.revision} observed=${observed.revision}`)
  check(`${row.id}: tracked file count matches registry`, observed.trackedFiles === row.trackedFiles, `expected=${row.trackedFiles} observed=${observed.trackedFiles}`)
  if (row.state === "clean") check(`${row.id}: clean state matches registry`, observed.dirtyEntries === 0, `dirty=${observed.dirtyEntries}`)
  if (row.state === "dirty") {
    negative(`${row.id}: dirty state is visible and ineligible`, (observed.dirtyEntries ?? 0) > 0 && row.evidenceEligible === false, `dirty=${observed.dirtyEntries}`)
  }
}
const nonexistent = observations.find(({ row }) => row.state === "missing")
negative("C2 missing-path mutation remains visibly missing", Boolean(nonexistent && !nonexistent.observed.exists), nonexistent?.row.path ?? "missing fixture absent")
const cleanRows = observations.filter(({ row, observed }) => row.state === "clean" && observed.exists)
check("C2 has at least five live clean repositories", cleanRows.length >= 5, `clean=${cleanRows.length}`)

const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
const result = {
  issue: "M21.C2", code: "C2", milestone: "M21",
  status: passed === checks && negatives >= 2 ? "verified" : "known-gap",
  checks, passed, failed: checks - passed, negativeCases: negatives,
  currentCommit: commit, workingTreeRelevantChanges: [],
  verifierCommand: "bun run script/m21/verify-corpus.ts", evidenceFile: "C2.json",
  generatedAt: new Date().toISOString(), registryFile: "validation/m21/results/corpus-registry.json",
  observations: observations.map(({ row, observed }) => ({ id: row.id, state: row.state, revision: observed.revision, trackedFiles: observed.trackedFiles, dirtyEntries: observed.dirtyEntries, exists: observed.exists, evidenceEligible: row.evidenceEligible !== false && row.state === "clean" })),
  limitations: ["Registry identity and checkout state are verified; this issue does not parse source files or prove indexing correctness.", "Dirty and missing repositories are intentionally retained as visible non-eligible states."],
}
mkdirSync(path.dirname(RESULT), { recursive: true })
writeFileSync(RESULT, JSON.stringify(result, null, 2) + "\n")
console.log(`C2: ${result.status.toUpperCase()} (${result.passed}/${result.checks}, ${result.negativeCases} negative)`)
process.exit(result.status === "verified" ? 0 : 1)
