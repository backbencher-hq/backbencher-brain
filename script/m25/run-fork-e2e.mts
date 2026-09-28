// script/m25/run-fork-e2e.mts — M25.E6 fork verification driver.
//
// Runs the SHARED assertion core (script/m25/feature-assertions.ts — the
// one-library rule) inside each AVAILABLE fork (Cursor, Antigravity) at its
// pinned installed version, using the same inner test as E5 (editor-agnostic
// CJS). An unavailable fork is recorded BLOCKED with a reason — never
// omitted, never claimed by inheritance (contract §2 I4; issue #504).
//
// Run: npx tsx script/m25/run-fork-e2e.mts
// Evidence: validation/m25/results/F-<FORK>.json (machine-emitted, per fork)
//           docs/m25/FORK-CAPABILITY-MATRIX.md (generated FROM the evidence)
import { spawn } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { writeSealed } from "../lib/evidence.ts"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const ROOT = path.resolve(import.meta.dirname, "../..")
const EXT_ROOT = path.join(ROOT, "ide/vscode")
const RESULTS = path.join(ROOT, "validation/m25/results")
const MATRIX = path.join(ROOT, "docs/m25/FORK-CAPABILITY-MATRIX.md")
const FORK_TIMEOUT_MS = 420_000

const core = await import(pathToFileURL(path.join(ROOT, "script/m25/feature-assertions.ts")).href)
const { preflightForks } = await import(pathToFileURL(path.join(ROOT, "script/m25/fork-runner.ts")).href)
const { execFileSync } = await import("node:child_process")

async function main() {
  // 0. Preflight — the honest availability record for every fork.
  const availability = preflightForks()
  console.log("E6 preflight:", availability.map((a) => `${a.name}=${a.available ? a.version : "BLOCKED"}`).join(", "))

  // 1. NO shared fixture: each AVAILABLE fork builds its own (built inside
  //    the loop below). Sharing one fixture across forks leaked state —
  //    found live: Cursor's live staleness leg reindexed the shared db and
  //    the restore raced the still-open server, so Antigravity's session
  //    started on real-indexer rows (hashed ids) and its fixture-shape
  //    assertions failed honestly. Per-leg isolation removes the coupling.

  // 2. Bundle the core + status model CJS inside the extension (E5's exact step).
  const { build } = await import("esbuild")
  await build({
    entryPoints: [path.join(ROOT, "script/m25/feature-assertions.ts")],
    bundle: true,
    outfile: path.join(EXT_ROOT, "dist/test/feature-assertions.js"),
    format: "cjs",
    platform: "node",
    target: "node20",
    external: ["vscode", "better-sqlite3"],
    sourcemap: false,
    logLevel: "silent",
  })
  await build({
    entryPoints: [path.join(EXT_ROOT, "src/status-model.ts")],
    bundle: true,
    outfile: path.join(EXT_ROOT, "dist/test/status-model.js"),
    format: "cjs",
    platform: "node",
    target: "node20",
    external: ["vscode"],
    sourcemap: false,
    logLevel: "silent",
  })

  // 3. Inner test: E5's file verbatim (editor-agnostic by construction).
  const innerSrc = readFileSync(path.join(ROOT, "script/m25/e5-inner.js"), "utf8")
    .replace("E5_CORE_PATH", path.join(EXT_ROOT, "dist/test/feature-assertions.js"))
    .replace("E5_STATUS_PATH", path.join(EXT_ROOT, "dist/test/status-model.js"))
  const outDir = mkdtempSync(path.join(tmpdir(), "e6-"))
  const innerPath = path.join(outDir, "e5-inner.js")
  writeFileSync(innerPath, innerSrc)

  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
  const machine = core.machineInfo("fork-run")

  mkdirSync(RESULTS, { recursive: true })
  const records: Array<Record<string, unknown>> = []

  for (const fork of availability) {
    const evidenceFile = `F-${fork.name.toUpperCase()}.json`
    if (!fork.available) {
      // Honest blocked state — recorded, never omitted, never inherited.
      const rec = {
        issue: "M25.E6",
        code: "E6",
        fork: fork.name,
        status: "blocked",
        reason: fork.reason,
        os: process.platform,
        machine,
        currentCommit: commit,
        verifierCommand: "npx tsx script/m25/run-fork-e2e.mts",
        evidenceFile,
        generatedAt: new Date().toISOString(),
        limitations: ["fork unavailable on this machine — claim level stays unset; no inheritance from other forks"],
      }
      writeSealed(path.join(RESULTS, evidenceFile), rec)
      records.push(rec)
      continue
    }

    // 4. Per-fork fixture: fresh workspace + seeded db, built immediately
    //    before the launch — no fork ever sees another fork's index state.
    const fx = await core.buildFixtureWorkspace("")
    console.log(`E6: fixture for ${fork.name}: ${fx.workspaceDir}`)

    // 5. Launch the fork's GUI with the extension-test flags (VS Code CLI
    //    core flags — forks inherit the CLI, NOT our claims). The inner test
    //    writes results incrementally; the process exits 0/1 like E5's host.
    const forkOut = mkdtempSync(path.join(tmpdir(), `e6-${fork.name}-`))
    const resultsPath = path.join(forkOut, "results.json")
    console.log(`E6: launching ${fork.name} (${fork.version})…`)
    // (monotonic timing captured above)
    const child = spawn(fork.cli, [
      fx.workspaceDir,
      "--user-data-dir", path.join(forkOut, "user-data"),
      "--extensionDevelopmentPath", EXT_ROOT,
      "--extensionTestsPath", innerPath,
      "--disable-workspace-trust",
      "--disable-gpu",
      "--nologo",
    ], {
      detached: true,
      stdio: "ignore",
      env: {
        ...process.env,
        DISPLAY: process.env.DISPLAY ?? ":0",
        E5_OUT: resultsPath,
        E5_WS: fx.workspaceDir,
        E5_DATA: fx.dataDir,
        BB_DATA_DIR: fx.dataDir,
        BB_LSP_STDERR_LOG: path.join(forkOut, "server-crash.log"),
        // Regime declaration (§3): every fork leg runs in a FRESH user-data
        // dir — the editor binary is cold-paged and OS caches are cold. The
        // first launch of a session is therefore declared cold-first-launch
        // (the only honest witness is the orchestrator). Subsequent legs of
        // the same session would be warm.
        E5_COLD_FIRST_LAUNCH: "true",
        // Declared test policy: the fixture's index is seeded by the driver
        // (deterministic shape); the auto-index consent flow must not run
        // (no human to consent, and a real reindex would replace the seeded
        // rows with real-indexer rows — E6 evidence). "never" is the
        // machine's declared no-index mode, not a hidden bypass.
        BB_AUTOINDEX_MODE: "never",
      },
    })

    // Bounded wait: poll for the results file reaching a terminal state.
    // MONOTONIC CLOCK ONLY: this machine's wall clock has been observed to
    // jump hours mid-run (found live: a +11 h jump made a Date.now()
    // deadline expire instantly, killed the editor mid-loop, and left the
    // server writing to dead pipes). hrtime never jumps.
    const startHr = process.hrtime.bigint()
    const elapsedMsFn = () => Number((process.hrtime.bigint() - startHr) / 1_000_000n)
    const deadline = FORK_TIMEOUT_MS
    let finished = false
    while (elapsedMsFn() < deadline) {
      await new Promise((r) => setTimeout(r, 2000))
      if (existsSync(resultsPath)) {
        try {
          const partial = JSON.parse(readFileSync(resultsPath, "utf8"))
          const crashed = partial.checks?.some((c: any) => c.name === "E5: inner suite completed without crash" && c.ok === false)
          // Terminal: all core feature legs have run (crash marker present, or
          // the full suite count reached). The inner writes incrementally.
          // M44.X1: the suite now includes the M44 hub legs (E5-H5/E5-U4 and
          // the graph/staleness closers) — 26 stopped before the hub, which
          // left the new hub un-exercised in every fork. The inner suite is
          // 88 checks; the crash marker is the honest early-exit path.
          const names = (partial.checks ?? []).map((c: any) => c.name)
          const terminal = crashed || names.length >= 88
          if (terminal) { finished = true; break }
        } catch { /* mid-write — keep waiting */ }
      }
      if (child.exitCode !== null && child.exitCode !== 0 && !existsSync(resultsPath)) break
    }
    const elapsedMs = elapsedMsFn()
    try { process.kill(-child.pid!, "SIGTERM") } catch {}
    try { child.kill("SIGTERM") } catch {}

    let innerResults: any = null
    try { innerResults = JSON.parse(readFileSync(resultsPath, "utf8")) } catch {}
    const checks = innerResults?.checks ?? []
    const passed = checks.filter((c: any) => c.ok).length
    const failed = checks.length - passed
    const crashDetail = checks.find((c: any) => c.name === "E5: inner suite completed without crash" && c.ok === false)?.detail
    const verified = finished && failed === 0 && checks.length > 0 && innerResults?.activation !== null

    const limitations: string[] = []
    if (!finished) limitations.push(`editor did not reach a terminal suite state within ${FORK_TIMEOUT_MS / 1000} s (elapsed ${Math.round(elapsedMs / 1000)} s) — partial results recorded honestly`)
    if (crashDetail) limitations.push(`inner suite crash: ${String(crashDetail).slice(0, 300)}`)
    if (innerResults?.activation && !innerResults.activation.versionOk) limitations.push("server version below declared minimum for this fork run")

    const rec = {
      issue: "M25.E6",
      code: "E6",
      fork: fork.name,
      editor: { name: fork.name, version: fork.version, pinned: true, source: "installed CLI --version at preflight" },
      status: verified ? "verified" : "known-gap",
      os: process.platform,
      machine,
      currentCommit: commit,
      commit,
      failed,
      checks,
      checksPassed: passed,
      checksTotal: checks.length,
      activation: innerResults?.activation ?? null,
      elapsedMs,
      verifierCommand: "npx tsx script/m25/run-fork-e2e.mts",
      evidenceFile,
      generatedAt: new Date().toISOString(),
      limitations,
    }
    writeSealed(path.join(RESULTS, evidenceFile), rec)
    records.push(rec)
    console.log(`E6: ${fork.name} ${rec.status.toUpperCase()} (${passed}/${checks.length})`)
  }

  // 5. Capability matrix — GENERATED from the evidence files (no hand-edited
  //    claims). The verify-fork-matrix gate re-derives and checks it.
  const lines = [
    "# M25.E6 — Fork capability matrix (I4)",
    "",
    "Generated by `script/m25/run-fork-e2e.mts` from the per-fork evidence files.",
    "A row can only say what its own evidence file proves — no fork claim by",
    "inheritance (contract §1/§2).",
    "",
    "| Fork | Version (pinned) | OS | I4 claim | Evidence | Status |",
    "| --- | --- | --- | --- | --- | --- |",
  ]
  for (const rec of records) {
    const fork = String(rec.fork)
    const status = String(rec.status)
    if (status === "blocked") {
      lines.push(`| ${fork} | — | — | unset (blocked) | [${rec.evidenceFile}](../../validation/m25/results/${rec.evidenceFile}) | blocked: ${String(rec.reason).slice(0, 80)} |`)
    } else {
      const claim = status === "verified" ? "I4 (verified in this fork)" : "unset (known-gap)"
      lines.push(`| ${fork} | ${String((rec.editor as any)?.version)} | ${String(rec.os)} | ${claim} | [${rec.evidenceFile}](../../validation/m25/results/${rec.evidenceFile}) | ${status} (${rec.checksPassed}/${rec.checksTotal}) |`)
    }
  }
  lines.push("", "Owner spot-check: pending (scheduled per issue #504 closure requirements).", "")
  writeFileSync(MATRIX, lines.join("\n"))

  const blocked = records.filter((r) => r.status === "blocked").length
  const verifiedCount = records.filter((r) => r.status === "verified").length
  console.log(`E6: ${verifiedCount} verified, ${blocked} blocked, ${records.length - verifiedCount - blocked} known-gap — matrix: ${path.relative(ROOT, MATRIX)}`)
  process.exit(0)
}

void main()
