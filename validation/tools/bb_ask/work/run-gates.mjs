// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the bb_ask gate battery: runs every gate under bun AND node against an
//   isolated per-lane data directory, records exit codes and logs, snapshots the emitted
//   evidence into validation/tools/bb_ask/gates/, and (with --mutants) proves every gate can
//   go RED by planting a mutation in the tool source and restoring it byte-identically.
// WHICH TOOL IT SERVES — bb_ask (read).
// WHERE ITS EVIDENCE LIVES — validation/tools/bb_ask/gates/summary.json,
//   validation/tools/bb_ask/gates/<runtime>/<gate>.log,
//   validation/tools/bb_ask/mutants.json.
// EDIT TOGETHER WHEN THIS CHANGES — the gate list below, script/m13/verify-ask-*.ts,
//   script/m15/verify-ask-deep.ts, script/m16/verify-ask-stats.ts, script/verify-semantic.ts.
//
// Usage:
//   node validation/tools/bb_ask/work/run-gates.mjs              # green battery, both runtimes
//   node validation/tools/bb_ask/work/run-gates.mjs --mutants    # red proofs, then green battery

import { spawnSync } from "node:child_process"
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import path from "node:path"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, "..", "..", "..", "..")
const TSX_CLI = path.join(REPO_ROOT, "node_modules", "tsx", "dist", "cli.mjs")
const EVIDENCE_DIR = path.join(REPO_ROOT, "validation", "tools", "bb_ask")
const GATES_DIR = path.join(EVIDENCE_DIR, "gates")
const MUTANTS_ONLY = process.argv.includes("--mutants")
const MUTANTS_NO_BATTERY = process.argv.includes("--mutants-only")
const RUNTIMES = ["bun", "node"]

/** Every gate, in an order that lets the docs gate read the others' results. */
const GATES = [
  { name: "verify-ask-contract", file: "script/m13/verify-ask-contract.ts" },
  { name: "verify-ask-provenance", file: "script/m13/verify-ask-provenance.ts" },
  { name: "verify-ask-adversarial", file: "script/m13/verify-ask-adversarial.ts" },
  { name: "verify-ask-integration", file: "script/m13/verify-ask-integration.ts" },
  { name: "verify-ask-honesty", file: "script/m13/verify-ask-honesty.ts" },
  { name: "verify-semantic", file: "script/verify-semantic.ts" },
  { name: "verify-ask-stats", file: "script/m16/verify-ask-stats.ts" },
  { name: "verify-ask-deep", file: "script/m15/verify-ask-deep.ts" },
  { name: "verify-ask-e2e-corpus", file: "script/m13/verify-ask-e2e-corpus.ts" },
  // Last: reads the summary of the others.
  { name: "verify-ask-docs", file: "script/m13/verify-ask-docs.ts" },
]

const RESULTS = {
  "verify-ask-contract": [path.join(REPO_ROOT, "validation/m13/results/a1.json")],
  "verify-ask-provenance": [path.join(REPO_ROOT, "validation/m13/results/a2.json")],
  "verify-ask-adversarial": [path.join(REPO_ROOT, "validation/m13/results/a3.json")],
  "verify-ask-integration": [path.join(REPO_ROOT, "validation/m13/results/a4.json")],
  "verify-ask-e2e-corpus": [path.join(REPO_ROOT, "validation/m13/results/a5.json")],
  "verify-ask-docs": [path.join(REPO_ROOT, "validation/m13/results/a6.json")],
  "verify-ask-honesty": [path.join(REPO_ROOT, "validation/m13/results/a7.json")],
  "verify-ask-stats": [path.join(REPO_ROOT, "validation/m16/results/A1.json"), path.join(REPO_ROOT, "validation/m16/results/A2.json"), path.join(REPO_ROOT, "validation/m16/results/A3.json"), path.join(REPO_ROOT, "validation/m16/results/A4.json")],
  "verify-ask-deep": ["a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8"].map((code) => path.join(REPO_ROOT, "validation/m15/results", `${code}.json`)),
}

const runId = new Date().toISOString().replace(/[:.]/g, "-")
const summaryPath = path.join(GATES_DIR, "summary.json")
mkdirSync(GATES_DIR, { recursive: true })

const summary = {
  schemaVersion: 1,
  tool: "bb_ask",
  generatedAt: new Date().toISOString(),
  runId,
  currentCommit: (() => { try { return spawnSync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8" }).stdout.trim() } catch { return "unknown" } })(),
  runtimes: RUNTIMES,
  gates: GATES.map((gate) => ({ gate: gate.name, file: gate.file, verified: false, failed: null, runtimes: {} })),
  totalNegativeCases: 0,
  blockedLegs: [],
  mutants: (() => {
    try {
      const previous = JSON.parse(readFileSync(path.join(EVIDENCE_DIR, "mutants.json"), "utf8"))
      return { path: "validation/tools/bb_ask/mutants.json", allRed: previous.allRed === true, count: previous.mutants?.length ?? 0 }
    } catch { return null }
  })(),
}
const writeSummary = () => writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + "\n")

function runtimeCommand(runtime, gateFile) {
  if (runtime === "bun") return { command: "bun", args: ["run", gateFile] }
  return { command: process.execPath, args: [TSX_CLI, gateFile] }
}

function countNegatives() {
  let negatives = 0
  for (const files of Object.values(RESULTS)) {
    for (const file of files) {
      try {
        const document = JSON.parse(readFileSync(file, "utf8"))
        negatives += Number(document.negativeCases ?? document.negatives ?? 0)
      } catch {}
    }
  }
  return negatives
}

function runGate(runtime, gate, logDir) {
  const dataDir = path.join(EVIDENCE_DIR, "bbdata", `gates-${runtime}`)
  mkdirSync(dataDir, { recursive: true })
  const { command, args } = runtimeCommand(runtime, gate.file)
  const started = Date.now()
  const result = spawnSync(command, args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: 30 * 60 * 1000,
    env: { ...process.env, BB_NO_AUTO_REFRESH: "1", BB_DATA_DIR: dataDir, BB_EMBEDDING_DISABLED: "1", ...(gate.env ?? {}) },
  })
  const ms = Date.now() - started
  const out = `${result.stdout ?? ""}${result.stderr ?? ""}`
  mkdirSync(logDir, { recursive: true })
  writeFileSync(path.join(logDir, `${gate.name}.log`), `${out}\n[exit ${result.status} in ${ms} ms]\n`)
  return { exit: result.status ?? -1, ms, output: out }
}

function snapshotEvidence(runtime) {
  for (const [gate, files] of Object.entries(RESULTS)) {
    for (const file of files) {
      if (!existsSync(file)) continue
      const target = path.join(GATES_DIR, "evidence", runtime, gate, path.basename(file))
      mkdirSync(path.dirname(target), { recursive: true })
      copyFileSync(file, target)
    }
  }
}

// ── Red proofs: one mutation per gate, restored byte-identically ──────────
const MUTANTS = [
  { name: "confidence-cap-removed", file: "src/intelligence/search/quick-answer.ts", find: "const confidence = nonDiscriminative ? Math.min(0.4, rawConfidence) : rawConfidence", replace: "const confidence = rawConfidence", gate: "verify-ask-honesty", expect: /FAIL/ },
  { name: "engine-opens-read-write", file: "src/intelligence/search/semantic-search.ts", find: '    raw = await BrainDatabase.getRawInstance(projectId, { readonly: true })', replace: "    raw = await BrainDatabase.getRawInstance(projectId)", gate: "verify-ask-honesty", expect: /read-only/ },
  { name: "fallback-similarity-zero", file: "src/intelligence/search/semantic-search.ts", find: "similarity: null,\n    language: row.language,", replace: "similarity: 0,\n    language: row.language,", gate: "verify-ask-honesty", expect: /FAIL/ },
  { name: "coverage-ignores-model", file: "src/intelligence/search/semantic-search.ts", find: "    if (model !== null) {\n      comparableEmbeddings", replace: "    if (false) {\n      comparableEmbeddings", gate: "verify-ask-honesty", expect: /FAIL/ },
  { name: "handler-limit-clamped", file: "src/mcp/tools/bb_ask/handler.ts", find: "if (!Number.isInteger(requested) || requested < ASK_LIMIT_MIN || requested > ASK_LIMIT_MAX) {", replace: "if (false) {", gate: "verify-ask-honesty", expect: /FAIL/ },
  { name: "truncation-not-declared", file: "src/intelligence/search/quick-answer.ts", find: "const truncated = retrieval.scanCapped === true || (retrieval.rankedCandidates ?? 0) > sources.length", replace: "const truncated = false", gate: "verify-ask-honesty", expect: /FAIL/ },
  { name: "stale-flag-dropped", file: "src/intelligence/search/semantic-search.ts", find: 'stale: status === "stale" || status === "missing" || undefined,', replace: "stale: undefined,", gate: "verify-ask-integration", expect: /FAIL/ },
  { name: "provenance-line-dropped", file: "src/mcp/tools/bb_ask/handler.ts", find: "parts.push(renderProvenance(result))", replace: "void renderProvenance(result)", gate: "verify-ask-e2e-corpus", expect: /FAIL/ },
  { name: "regex-reintroduced", file: "src/intelligence/search/quick-answer.ts", find: "const ENGINE = \"quick-answer@intelligence\"", replace: "const __PROBE = \"x\".replace(/x/, \"y\")\nvoid __PROBE\nconst ENGINE = \"quick-answer@intelligence\"", gate: "verify-ask-deep", expect: /FAIL/ },
  { name: "function-union-narrowed", file: "src/intelligence/search/quick-answer.ts", find: 'label: "functions", types: ["function", "method"]', replace: 'label: "functions", types: ["function"]', gate: "verify-ask-stats", expect: /FAIL/ },
  { name: "nan-guard-removed", file: "src/intelligence/search/semantic-search.ts", find: "if (Number.isFinite(similarity)) scored.push({ entityId: row.entityId, similarity })", replace: "scored.push({ entityId: row.entityId, similarity })", gate: "verify-semantic", expect: /FAIL/ },
  { name: "aggregate-provenance-mislabeled", file: "src/intelligence/search/quick-answer.ts", find: '            evidenceClass: "indexed",\n            engine: ENGINE,\n            engineVersion: ENGINE_VERSION,\n            projectId,\n            source: aggregate,', replace: '            evidenceClass: "semantic_candidate",\n            engine: ENGINE,\n            engineVersion: ENGINE_VERSION,\n            projectId,\n            source: aggregate,', gate: "verify-ask-provenance", expect: /FAIL/ },
  { name: "descriptor-drifts-from-page", file: "src/mcp/tools/bb_ask/descriptor.ts", find: 'description:\n      "Answer a question about the codebase from the index', replace: 'description:\n      "DRIFTED Answer a question about the codebase from the index', gate: "verify-ask-docs", expect: /FAIL/ },
]

function sha256(text) { return createHash("sha256").update(text).digest("hex") }

// A mutant is a temporary edit to a tracked source file. It is restored in a `finally`
// block, but a killed process cannot run one — so every mutation first writes the exact
// original bytes to an ignored backup plus a manifest, and the next run restores any
// pending backup BEFORE it does anything else. That makes a killed mutant run safe to
// rerun instead of leaving the tree half-mutated (which is exactly how one gate went red
// for a caller).
const MUTANT_STATE_PATH = path.join(EVIDENCE_DIR, "bbdata", "mutant-pending.json")
function restorePendingMutation() {
  if (!existsSync(MUTANT_STATE_PATH)) return null
  try {
    const pending = JSON.parse(readFileSync(MUTANT_STATE_PATH, "utf8"))
    const target = path.join(REPO_ROOT, pending.file)
    const current = readFileSync(target, "utf8")
    if (sha256(current) === pending.originalSha) {
      // Already restored by a previous attempt; just clear the manifest.
      rmSync(MUTANT_STATE_PATH, { force: true })
      return { file: pending.file, action: "already-restored" }
    }
    writeFileSync(target, readFileSync(pending.backupPath, "utf8"))
    const restored = sha256(readFileSync(target, "utf8"))
    rmSync(MUTANT_STATE_PATH, { force: true })
    rmSync(pending.backupPath, { force: true })
    return { file: pending.file, mutant: pending.mutant, action: "restored", byteIdentical: restored === pending.originalSha }
  } catch (cause) {
    return { file: "unknown", action: "restore-failed", detail: cause instanceof Error ? cause.message : String(cause) }
  }
}
const pendingRestore = restorePendingMutation()
if (pendingRestore) console.log(`mutant recovery: ${JSON.stringify(pendingRestore)}`)

function proveMutants() {
  const dataDir = path.join(EVIDENCE_DIR, "bbdata", "mutants")
  mkdirSync(dataDir, { recursive: true })
  const results = []
  for (const mutant of MUTANTS) {
    const filePath = path.join(REPO_ROOT, mutant.file)
    const original = readFileSync(filePath, "utf8")
    const originalHash = sha256(original)
    const occurrences = original.split(mutant.find).length - 1
    if (occurrences !== 1) {
      results.push({ mutant: mutant.name, gate: mutant.gate, status: "invalid-mutation", detail: `find string occurs ${occurrences} times` })
      continue
    }
    const mutated = original.replace(mutant.find, mutant.replace)
    mkdirSync(path.dirname(MUTANT_STATE_PATH), { recursive: true })
    const backupPath = path.join(path.dirname(MUTANT_STATE_PATH), `mutant-backup-${sha256(mutant.file).slice(0, 12)}.bak`)
    writeFileSync(backupPath, original)
    writeFileSync(MUTANT_STATE_PATH, JSON.stringify({ mutant: mutant.name, file: mutant.file, backupPath, originalSha: originalHash, at: new Date().toISOString() }, null, 2))
    writeFileSync(filePath, mutated)
    const gate = GATES.find((entry) => entry.name === mutant.gate)
    let outcome
    try {
      outcome = runGate("node", gate, path.join(GATES_DIR, "mutant"))
    } finally {
      writeFileSync(filePath, original)
      rmSync(backupPath, { force: true })
      rmSync(MUTANT_STATE_PATH, { force: true })
    }
    const restoredHash = sha256(readFileSync(filePath, "utf8"))
    const red = outcome.exit !== 0 && mutant.expect.test(outcome.output)
    results.push({
      mutant: mutant.name,
      file: mutant.file,
      gate: mutant.gate,
      expectedRed: true,
      observedExit: outcome.exit,
      redObserved: red,
      expectationMatched: mutant.expect.test(outcome.output),
      restoredByteIdentical: restoredHash === originalHash,
      detail: outcome.output.split("\n").filter((line) => line.includes("FAIL")).slice(0, 3).join(" | "),
    })
    console.log(`mutant ${mutant.name}: exit=${outcome.exit} red=${red} restored=${restoredHash === originalHash}`)
  }
  writeFileSync(path.join(EVIDENCE_DIR, "mutants.json"), JSON.stringify({ schemaVersion: 1, tool: "bb_ask", generatedAt: new Date().toISOString(), currentCommit: summary.currentCommit, mutants: results, allRed: results.every((row) => row.redObserved === true && row.restoredByteIdentical === true) }, null, 2) + "\n")
  return results
}

// ── Main ─────────────────────────────────────────────────────────────────
let mutantResults = null
if (MUTANTS_ONLY || MUTANTS_NO_BATTERY) {
  mutantResults = proveMutants()
  summary.mutants = { path: "validation/tools/bb_ask/mutants.json", allRed: mutantResults.every((row) => row.redObserved === true), count: mutantResults.length }
  // Under --mutants-only the fresh summary must NOT be written first: the merge below
  // reads the existing summary to preserve the last battery's green matrix, and writing
  // the fresh one here made it read its own empty gates (losing the measured exits).
  if (!MUTANTS_NO_BATTERY) writeSummary()
  if (MUTANTS_NO_BATTERY) {
    // `--mutants-only` is a red-proof refresh, not a battery run: merge the proof into
    // the existing summary so the green gate matrix recorded by the last battery is left
    // exactly as measured.
    let merged = summary
    if (existsSync(summaryPath)) {
      try {
        const existing = JSON.parse(readFileSync(summaryPath, "utf8"))
        if (Array.isArray(existing.gates) && existing.gates.length > 0) merged = { ...existing, mutants: summary.mutants, mutatedAt: new Date().toISOString() }
      } catch {}
    }
    writeFileSync(summaryPath, JSON.stringify(merged, null, 2) + "\n")
    const allRed = mutantResults.every((row) => row.redObserved === true && row.restoredByteIdentically === true)
    console.log(`MUTANTS: ${mutantResults.filter((row) => row.redObserved).length}/${mutantResults.length} observed red, restored byte-identically: ${mutantResults.every((row) => row.restoredByteIdentical)}`)
    process.exit(allRed ? 0 : 1)
  }
}

// Gates are the outer loop so the docs gate (last) reads COMPLETE rows for every other
// gate under both runtimes — a per-runtime outer loop would show it half-filled rows and
// fail on its own scheduling rather than on documentation truth.
for (const gate of GATES) {
  const row = summary.gates.find((entry) => entry.gate === gate.name)
  for (const runtime of RUNTIMES) {
    const outcome = runGate(runtime, gate, path.join(GATES_DIR, runtime))
    row.runtimes[runtime] = { exit: outcome.exit, ms: outcome.ms, log: `gates/${runtime}/${gate.name}.log` }
    row.verified = RUNTIMES.every((name) => row.runtimes[name]?.exit === 0)
    row.failed = row.runtimes[runtime].exit
    // Keep the negative-case census current: the docs gate reads this summary and must
    // see the other gates' observed negatives, not a value computed after it runs.
    summary.totalNegativeCases = countNegatives()
    writeSummary()
    console.log(`${runtime} ${gate.name}: exit=${outcome.exit} ${outcome.ms}ms`)
  }
}
for (const runtime of RUNTIMES) snapshotEvidence(runtime)

summary.totalNegativeCases = countNegatives()
summary.verified = summary.gates.every((row) => row.verified === true)
summary.failed = summary.gates.filter((row) => row.verified !== true).map((row) => row.gate)
writeSummary()
console.log(`\nGATES: ${summary.verified ? "ALL VERIFIED" : "FAILED: " + summary.failed.join(", ")} (${summary.gates.length} gates × ${RUNTIMES.length} runtimes, ${summary.totalNegativeCases} negative cases)`)
if (mutantResults) console.log(`MUTANTS: ${mutantResults.filter((row) => row.redObserved).length}/${mutantResults.length} observed red, restored byte-identically: ${mutantResults.every((row) => row.restoredByteIdentical)}`)
process.exit(summary.verified && (!mutantResults || mutantResults.every((row) => row.redObserved && row.restoredByteIdentical)) ? 0 : 1)
