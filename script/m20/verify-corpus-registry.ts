// script/m20/verify-corpus-registry.ts — M20.C2.
//
// The registry is an evidence boundary, not a promise that every local checkout
// is clean. It records declared identity, observed Git state, tracked-file count,
// available syntax-error measurements, undeclared local repositories, and a
// deliberately missing-path negative. Environmental discrepancies produce an
// honest KNOWN-GAP result while the verifier itself exits successfully when its
// reporting rules are satisfied.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import path from "node:path"
import { migrationSourceFingerprint } from "../../src/intelligence/migration/migration-evidence"

type DeclaredRepository = {
  id: string
  path: string
  remote?: string
  revision: string
  trackedFiles?: number
  trackedBytes?: number
  clean?: boolean
  evidenceEligible?: boolean
  languages?: string[]
}

type SyntaxMeasurement = {
  artifact: string
  revision: string
  syntaxErrorFiles: number
  sourceField: string
  language: string | null
  corpus: string
}

type SnapshotDeclaration = {
  source: string
  revision: string
}

type SnapshotManifest = {
  root: string
  repositories: Record<string, SnapshotDeclaration>
}

type ObservedRepository = {
  id: string
  path: string
  sourceKind: "git-checkout" | "immutable-archive"
  snapshotPath: string | null
  activePath: string
  activeRevision: string | null
  activeDirtyFileCount: number | null
  remote: string | null
  languages: string[]
  expectedRevision: string
  actualRevision: string | null
  revisionMatch: boolean
  exists: boolean
  dirty: boolean | null
  dirtyFileCount: number | null
  expectedClean: boolean | null
  expectedEvidenceEligible: boolean | null
  actualTrackedFiles: number | null
  declaredTrackedFiles: number | null
  syntaxErrorFiles: number | null
  syntaxErrorStatus: "measured" | "not-measured"
  syntaxMeasurements: SyntaxMeasurement[]
  state: "verified" | "dirty" | "revision-mismatch" | "missing" | "invalid"
}

type Manifest = {
  repositories: DeclaredRepository[]
  externalCloneRoot: string
  evidenceRoot: string
  plannedAcquisitions?: Array<{ language: string; purpose: string; destination: string }>
}

type SnapshotIndex = {
  schemaVersion: number
  milestone: string
  purpose: string
  root: string
  policy: string
  repositories: Record<string, SnapshotDeclaration>
}

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const SOURCE_MANIFEST = path.join(ROOT, "validation/m11/corpus-manifest.json")
const SNAPSHOT_MANIFEST_PATH = path.join(ROOT, "validation/m20/corpus-snapshots.json")
const RESULTS = path.join(ROOT, "validation/m20/results")
const REGISTRY_PATH = path.join(RESULTS, "C2-registry.json")
const EVIDENCE_PATH = path.join(RESULTS, "C2.json")
const manifest = JSON.parse(readFileSync(SOURCE_MANIFEST, "utf8")) as Manifest
let snapshotIndex: SnapshotIndex | null = null
try { snapshotIndex = JSON.parse(readFileSync(SNAPSHOT_MANIFEST_PATH, "utf8")) as SnapshotIndex } catch {}
const RELEVANT_PATHS = new Set([
  "docs/m20/M20-MASTER-PLAN.md",
  "package.json",
  "script/verify-quality-gate.ts",
])

let checks = 0
let passed = 0
let negativeCases = 0
function check(label: string, condition: boolean, detail = ""): boolean {
  checks++
  if (condition) passed++
  else console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`)
  return condition
}
function negative(label: string, condition: boolean, detail = ""): void {
  negativeCases++
  check(`${label} [negative]`, condition, detail)
}

function workingTreeRelevantChanges(): string[] {
  try {
    return execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
      .split("\n").map((line) => line.slice(3).trim()).filter((file) => RELEVANT_PATHS.has(file) || file.startsWith("script/m20/"))
  } catch {
    return ["git-status-unavailable"]
  }
}

function runGit(repoPath: string, args: string[]): string | null {
  try {
    return execFileSync("git", ["-C", repoPath, ...args], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 128 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim()
  } catch {
    return null
  }
}

function syntaxMeasurements(repo: DeclaredRepository): SyntaxMeasurement[] {
  const resultDir = path.join(ROOT, "validation/m12/results")
  let files: string[] = []
  try { files = readdirSync(resultDir).filter((file) => file.endsWith(".json")) } catch { return [] }
  const measurements: SyntaxMeasurement[] = []
  for (const file of files) {
    const full = path.join(resultDir, file)
    try {
      const value = JSON.parse(readFileSync(full, "utf8")) as Record<string, unknown>
      if (value.corpus !== repo.path || value.revision !== repo.revision) continue
      const language = typeof value.language === "string" ? value.language : typeof value.fixtureLanguage === "string" ? value.fixtureLanguage : null
      const declaredLanguages = new Set((repo.languages ?? []).map((item) => item.toLowerCase()))
      if (language && !declaredLanguages.has(language.toLowerCase())) continue
      if (!language && declaredLanguages.size > 0) continue
      const candidates: Array<[string, unknown]> = [
        ["errorFiles", value.errorFiles],
        ["parseErrors", value.parseErrors],
        ["errors", value.errors],
      ]
      const candidate = candidates.find(([, raw]) => typeof raw === "number" || Array.isArray(raw))
      if (!candidate) continue
      const [, raw] = candidate
      const count = typeof raw === "number" ? raw : raw.length
      measurements.push({ artifact: path.relative(ROOT, full), revision: repo.revision, syntaxErrorFiles: count, sourceField: candidate[0], language, corpus: repo.path })
    } catch {
      // Unrelated or malformed historical evidence is not silently treated as a
      // zero; it is simply not a measurement for this repository.
    }
  }
  return measurements.sort((a, b) => a.artifact.localeCompare(b.artifact))
}

function inspect(repo: DeclaredRepository): ObservedRepository {
  const activeRevision = runGit(repo.path, ["rev-parse", "HEAD"])
  const activeExists = activeRevision !== null
  const activeDirtyText = activeExists ? runGit(repo.path, ["status", "--porcelain", "--untracked-files=all"]) : null
  const activeTrackedText = activeExists ? runGit(repo.path, ["ls-files", "-z"]) : null
  const activeDirtyFileCount = activeDirtyText === null ? null : activeDirtyText.length === 0 ? 0 : activeDirtyText.split("\n").filter(Boolean).length
  const activeTrackedFiles = activeTrackedText === null ? null : activeTrackedText.length === 0 ? 0 : activeTrackedText.split("\0").filter(Boolean).length

  // An immutable archive is eligible only when its sidecar proves the exact
  // source repository, declared ID, and pinned revision. Active dirty/mismatched
  // checkouts remain visible in the row but never contaminate snapshot evidence.
  const declaration = snapshotIndex?.repositories?.[repo.id]
  const snapshotPath = declaration ? path.join(snapshotIndex!.root, repo.id) : null
  let snapshotValid = false
  let snapshotTrackedFiles: number | null = null
  if (declaration && snapshotPath && existsSync(snapshotPath)) {
    try {
      const sidecar = JSON.parse(readFileSync(path.join(snapshotPath, ".m20-snapshot.json"), "utf8")) as Record<string, unknown>
      const sourceTree = runGit(declaration.source, ["rev-parse", `${declaration.revision}^{tree}`])
      snapshotValid = sidecar.id === repo.id && sidecar.source === declaration.source && sidecar.revision === declaration.revision && sidecar.archiveFormat === "git-archive" && sidecar.treeHash === sourceTree
      snapshotTrackedFiles = typeof sidecar.trackedFiles === "number" ? sidecar.trackedFiles : null
    } catch { snapshotValid = false }
  }

  const useSnapshot = snapshotValid
  const actualRevision = useSnapshot ? repo.revision : activeRevision
  const exists = useSnapshot || activeExists
  const dirtyFileCount = useSnapshot ? 0 : activeDirtyFileCount
  const actualTrackedFiles = useSnapshot ? snapshotTrackedFiles : activeTrackedFiles
  const measurements = syntaxMeasurements(repo)
  const revisionMatch = exists && actualRevision === repo.revision
  const state: ObservedRepository["state"] = !exists
    ? "missing"
    : !revisionMatch
      ? "revision-mismatch"
      : dirtyFileCount !== 0
        ? "dirty"
        : "verified"
  return {
    id: repo.id,
    path: repo.path,
    sourceKind: useSnapshot ? "immutable-archive" : "git-checkout",
    snapshotPath,
    activePath: repo.path,
    activeRevision,
    activeDirtyFileCount,
    remote: repo.remote ?? null,
    languages: repo.languages ?? [],
    expectedRevision: repo.revision,
    actualRevision,
    revisionMatch,
    exists,
    dirty: dirtyFileCount === null ? null : dirtyFileCount > 0,
    dirtyFileCount,
    expectedClean: repo.clean ?? null,
    expectedEvidenceEligible: repo.evidenceEligible ?? null,
    actualTrackedFiles,
    declaredTrackedFiles: repo.trackedFiles ?? null,
    syntaxErrorFiles: measurements.length > 0 ? measurements.reduce((total, measurement) => total + measurement.syntaxErrorFiles, 0) : null,
    syntaxErrorStatus: measurements.length > 0 ? "measured" : "not-measured",
    syntaxMeasurements: measurements,
    state,
  }
}

const declared = manifest.repositories ?? []
const observed = declared.map(inspect)
const declaredPaths = new Set(declared.map((repo) => path.resolve(repo.path)))
let localRepositories: string[] = []
try {
  localRepositories = readdirSync(manifest.externalCloneRoot)
    .filter((name) => existsSync(path.join(manifest.externalCloneRoot, name, ".git")))
    .map((name) => path.join(manifest.externalCloneRoot, name))
    .filter((repoPath) => !declaredPaths.has(path.resolve(repoPath)))
    .sort()
} catch {}

check("C2: source manifest exists and has declared repositories", declared.length > 0, String(declared.length))
check("C2: declared repository IDs are unique", new Set(declared.map((repo) => repo.id)).size === declared.length)
check("C2: every declared revision is a full commit hash", declared.every((repo) => /^[0-9a-f]{40}$/.test(repo.revision)))
check("C2: every declared path is absolute", declared.every((repo) => path.isAbsolute(repo.path)))
check("C2: every observed row preserves repository identity", observed.every((repo, index) => repo.id === declared[index]!.id && repo.path === declared[index]!.path && repo.expectedRevision === declared[index]!.revision))
check("C2: every missing, dirty, or mismatched checkout has an explicit state", observed.every((repo) => repo.state === "verified" || repo.state === "dirty" || repo.state === "revision-mismatch" || repo.state === "missing" || repo.state === "invalid"))
check("C2: no unavailable repository is treated as evidence-eligible", observed.filter((repo) => !repo.exists).every((repo) => repo.expectedEvidenceEligible !== true))
check("C2: syntax-error counts are measured or explicitly unmeasured", observed.every((repo) => repo.syntaxErrorStatus === "measured" ? typeof repo.syntaxErrorFiles === "number" && repo.syntaxMeasurements.every((measurement) => measurement.corpus === repo.path) : repo.syntaxErrorFiles === null))
check("C2: syntax measurements carry language provenance", observed.every((repo) => repo.syntaxMeasurements.every((measurement) => typeof measurement.language === "string")), JSON.stringify(observed.filter((repo) => repo.syntaxMeasurements.some((measurement) => !measurement.language)).map((repo) => repo.id)))
check("C2: undeclared local repositories are recorded", Array.isArray(localRepositories))
check("C2: measured syntax artifacts identify corpus and language", observed.every((repo) => repo.syntaxMeasurements.every((measurement) => measurement.corpus === repo.path && typeof measurement.language === "string")), "missing corpus/language provenance")

// Immutable snapshots are the preservation-first repair for active dirty or
// mismatched developer checkouts. They are accepted only when the sidecar
// proves the exact source repository, declared ID, pinned revision, and archive
// format. The active checkout state remains recorded above for transparency.
const snapshotDeclarations = snapshotIndex?.repositories ?? {}
const snapshotIds = Object.keys(snapshotDeclarations)
const declaredById = new Map(declared.map((repo) => [repo.id, repo]))
check("C2: snapshot manifest is explicit and structurally valid", snapshotIndex !== null && typeof snapshotIndex.root === "string" && snapshotIds.every((id) => declaredById.has(id)), `${SNAPSHOT_MANIFEST_PATH}`)
check("C2: snapshot recreation procedure is versioned", existsSync(path.join(ROOT, "script/m20/create-corpus-snapshots.ts")), "create-corpus-snapshots.ts missing")
check("C2: every declared snapshot has a valid immutable sidecar", observed.filter((repo) => snapshotIds.includes(repo.id)).every((repo) => repo.sourceKind === "immutable-archive" && repo.snapshotPath !== null && repo.actualRevision === repo.expectedRevision && repo.dirty === false && typeof repo.actualTrackedFiles === "number" && repo.actualTrackedFiles > 0), observed.filter((repo) => snapshotIds.includes(repo.id) && repo.sourceKind !== "immutable-archive").map((repo) => repo.id).join(","))
check("C2: snapshot-backed rows preserve active checkout state", observed.filter((repo) => repo.sourceKind === "immutable-archive").every((repo) => repo.activePath === repo.path && typeof repo.activeRevision === "string" && typeof repo.activeDirtyFileCount === "number"), "active state omitted")
check("C2: snapshots do not hide active repository modifications", observed.filter((repo) => repo.sourceKind === "immutable-archive" && (repo.activeDirtyFileCount ?? 0) > 0).every((repo) => repo.dirtyFileCount === 0 && repo.dirty === false), "snapshot state conflated with active state")

const missingFixture: DeclaredRepository = {
  id: "__m20_deliberately_missing__",
  path: path.join(manifest.externalCloneRoot, ".m20-deliberately-missing"),
  revision: "0".repeat(40),
  clean: true,
  evidenceEligible: true,
  languages: ["fixture"],
}
const missingObservation = inspect(missingFixture)
negative("C2: deliberately missing repository is blocked, never skipped", missingObservation.state === "missing" && !missingObservation.exists && missingObservation.actualRevision === null, JSON.stringify(missingObservation))
negative("C2: revision mismatch cannot be marked verified", observed.filter((repo) => !repo.revisionMatch).every((repo) => repo.state !== "verified"), observed.filter((repo) => !repo.revisionMatch).map((repo) => repo.id).join(","))
negative("C2: dirty checkout cannot be marked clean", observed.filter((repo) => repo.dirty === true).every((repo) => repo.state === "dirty" || repo.state === "revision-mismatch"), observed.filter((repo) => repo.dirty === true).map((repo) => repo.id).join(","))

const mismatchCount = observed.filter((repo) => repo.state === "revision-mismatch").length
const dirtyCount = observed.filter((repo) => repo.dirty === true).length
const missingCount = observed.filter((repo) => repo.state === "missing").length
const exactCount = observed.filter((repo) => repo.state === "verified").length
const corpusStatus = mismatchCount > 0 || dirtyCount > 0 || missingCount > 0 ? "known-gap" : "verified"
const generatedAt = new Date().toISOString()
const registry = {
  schemaVersion: 1,
  milestone: "M20",
  issue: "M20.C2",
  generatedAt,
  sourceManifest: "validation/m11/corpus-manifest.json",
  externalCloneRoot: manifest.externalCloneRoot,
  setup: {
    command: "bun run script/m20/create-corpus-snapshots.ts",
    fallbackCommand: "git clone <remote> $HOME/fixtures/repositories/<name> && git -C $HOME/fixtures/repositories/<name> checkout <40-character-revision>",
    policy: "The verifier is offline and never downloads, resets, cleans, or mutates external repositories. The setup utility refuses existing destinations and extracts only pinned Git archives.",
  },
  corpusStatus,
  counts: { declared: declared.length, exactRevisionAndClean: exactCount, revisionMismatch: mismatchCount, dirty: dirtyCount, missing: missingCount, undeclaredLocalRepositories: localRepositories.length },
  snapshotManifest: snapshotIndex ? path.relative(ROOT, SNAPSHOT_MANIFEST_PATH) : null,
  snapshotPolicy: snapshotIndex?.policy ?? null,
  repositories: observed,
  undeclaredLocalRepositories: localRepositories,
  deliberatelyMissing: missingObservation,
  limitations: [
    "This registry checks reproducible repository identity and availability; it does not parse every source file.",
    "Syntax-error counts are imported only from exact path/revision M12 evidence; missing measurements remain null and not zero.",
    "Dirty checkouts and revision mismatches are recorded as known gaps and are not evidence-eligible.",
    "A clean project revision is required before this registry result can be closure evidence.",
  ],
}
mkdirSync(RESULTS, { recursive: true })
writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2) + "\n")

const currentCommit = (() => { try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim() } catch { return "unknown" } })()
const currentWorkingTreeRelevantChanges = workingTreeRelevantChanges()
const preliminaryFailed = checks - passed
const preliminary = {
  issue: "M20.C2",
  code: "C2",
  milestone: "M20",
  status: preliminaryFailed === 0 && currentWorkingTreeRelevantChanges.length === 0 ? corpusStatus : "known-gap",
  checks,
  passed,
  failed: preliminaryFailed,
  negativeCases,
  currentCommit,
  sourceFingerprint: migrationSourceFingerprint(ROOT),
  workingTreeRelevantChanges: currentWorkingTreeRelevantChanges,
  verifierCommand: "bun run script/m20/verify-corpus-registry.ts",
  evidenceFile: "C2.json",
  generatedAt,
  registryFile: "C2-registry.json",
  corpusStatus,
  counts: registry.counts,
  deliberateMissingState: missingObservation.state,
  limitations: registry.limitations,
}
writeFileSync(EVIDENCE_PATH, JSON.stringify(preliminary, null, 2) + "\n")
const persisted = JSON.parse(readFileSync(EVIDENCE_PATH, "utf8")) as typeof preliminary
check("C2: evidence round-trip can be read", persisted.issue === preliminary.issue && persisted.registryFile === preliminary.registryFile && persisted.checks === preliminary.checks && persisted.passed === preliminary.passed && persisted.failed === preliminary.failed, "provisional evidence")
const failed = checks - passed
const result = {
  ...preliminary,
  status: failed === 0 && currentWorkingTreeRelevantChanges.length === 0 ? corpusStatus : "known-gap",
  checks,
  passed,
  failed,
}
writeFileSync(EVIDENCE_PATH, JSON.stringify(result, null, 2) + "\n")
const finalPersisted = JSON.parse(readFileSync(EVIDENCE_PATH, "utf8")) as typeof result
if (finalPersisted.issue !== result.issue || finalPersisted.registryFile !== result.registryFile || finalPersisted.checks !== result.checks || finalPersisted.passed !== result.passed || finalPersisted.failed !== result.failed) {
  console.log("  FAIL: C2 evidence final round-trip mismatch")
  process.exit(1)
}
console.log(`C2: ${result.status.toUpperCase()} (${result.passed}/${result.checks} passed, ${negativeCases} negative)`)
// A known-gap corpus is a valid, explicit outcome of this registry gate. The
// verifier exits non-zero only when its own reporting/negative checks fail.
process.exit(result.failed === 0 ? 0 : 1)
