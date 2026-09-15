// script/m25/run-vscode-e2e.mts — M25.E5 in-editor leg (outer driver).
//
// Pins VS Code 1.85.0 via @vscode/test-electron, opens the fixture workspace
// with the BUILT extension loaded, and runs the inner test
// (script/m25/e5-inner.js) inside the extension host. The inner test bridges
// the extension's REAL LanguageClient to the shared LspTransport and runs
// the shared assertion core (one-library rule) + the staleness render checks.
//
// Run: npx tsx script/m25/run-vscode-e2e.mts
// Evidence: validation/m25/results/E5.json (+ E5-inner.json from the host)
import { writeSealed } from "../lib/evidence.ts"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const EXT_ROOT = path.join(ROOT, "ide/vscode")
const RESULTS = path.join(ROOT, "validation/m25/results")

async function main(): Promise<void> {
  // 0. The core must be reachable from the extension host: bundle it into
  //    ide/vscode/dist/test/ (CJS) via the esbuild config's status-model step
  //    and copy the core in compiled form.
  const coreSrc = path.join(ROOT, "script/m25/feature-assertions.ts")
  const coreUrl = pathToFileURL(coreSrc).href
  const core = await import(coreUrl)

  console.log("E5: preparing fixture workspace + index…")
  const fx = await core.buildFixtureWorkspace()

  // 1. Build the extension (fresh, includes the E5 test bridge exports).
  console.log("E5: building extension…")
  const { execFileSync } = await import("node:child_process")
  execFileSync("node", ["esbuild-extension.mjs"], { cwd: EXT_ROOT, stdio: "inherit" })

  // 2. The inner test needs the core compiled CJS inside the extension:
  //    esbuild-bundle feature-assertions.ts (it is editor-import-free).
  const { build } = await import("esbuild")
  await build({
    entryPoints: [coreSrc],
    bundle: true,
    outfile: path.join(EXT_ROOT, "dist/test/feature-assertions.js"),
    format: "cjs",
    platform: "node",
    target: "node20",
    external: ["vscode", "better-sqlite3"],
    sourcemap: false,
    logLevel: "silent",
  })

  // 3. Inner test file (CJS, standard runTests contract) — substitute the
  //    bundled core/status require paths, then copy to the temp dir.
  // The inner template has the placeholders inside require("…") quotes
  // already — substitute the plain paths (no extra quoting).
  const innerSrc = readFileSync(path.join(ROOT, "script/m25/e5-inner.js"), "utf8")
    .replace("E5_CORE_PATH", path.join(EXT_ROOT, "dist/test/feature-assertions.js"))
    .replace("E5_STATUS_PATH", path.join(EXT_ROOT, "dist/test/status-model.js"))
  const outDir = mkdtempSync(path.join(tmpdir(), "e5-"))
  const innerPath = path.join(outDir, "e5-inner.js")
  writeFileSync(innerPath, innerSrc)

  // 4. Pinned editor run. @vscode/test-electron lives in the extension's
  //    node_modules (dependency of the extension), resolve from there.
  console.log("E5: launching pinned VS Code (1.85.0)…")
  const testElectronUrl = pathToFileURL(path.join(EXT_ROOT, "node_modules/@vscode/test-electron/out/index.js")).href
  const { runTests } = await import(testElectronUrl)
  const { execFileSync: efs } = await import("node:child_process")
  let innerError: string | null = null
  try {
    await runTests({
      version: "1.85.0",
      extensionDevelopmentPath: EXT_ROOT,
      extensionTestsPath: innerPath,
      launchArgs: [fx.workspaceDir, "--disable-extensions", "--disable-gpu"],
      extensionTestsEnv: {
        E5_OUT: path.join(outDir, "results.json"),
        E5_WS: fx.workspaceDir,
        E5_DATA: fx.dataDir,
        BB_DATA_DIR: fx.dataDir,
        // Server-side crash trace (test-only): the extension host swallows
        // server stderr, so a dead server left no evidence. This env var is
        // forwarded to the spawned bb_lsp process, which appends fatal-stack
        // traces to the file (declared test-only hook in src/lsp/server.ts).
        BB_LSP_STDERR_LOG: path.join(outDir, "server-crash.log"),
        // Regime declaration (§3): test-electron downloads and launches a
        // fresh editor — a cold first launch. The inner test's budget gate
        // then uses the declared cold ceiling (measured either way).
        E5_COLD_FIRST_LAUNCH: "true",
      },
    })
  } catch (err) {
    innerError = String(err).slice(0, 1000)
    console.error("E5: in-editor run failed —", innerError)
  }

  // 5. Evidence.
  mkdirSync(RESULTS, { recursive: true })
  const innerResults = existsSync(path.join(outDir, "results.json"))
    ? JSON.parse(readFileSync(path.join(outDir, "results.json"), "utf8"))
    : null
  const commit = efs("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
  const machine = core.machineInfo("vscode-1.85.0-in-editor")
  const checks = innerResults?.checks ?? []
  const passedInner = checks.filter((c: any) => c.ok).length
  const failedInner = checks.length - passedInner
  const result = {
    issue: "M25.E5",
    code: "E5",
    milestone: "M25",
    status: innerError === null && innerResults !== null && failedInner === 0 ? "verified" : "known-gap",
    editor: { name: "VS Code", version: "1.85.0", pinned: true, source: "@vscode/test-electron download" },
    machine,
    // Evidence-convention field names (matching the other M25 verifiers —
    // the governance gate cross-checks `currentCommit` and `failed`):
    currentCommit: commit,
    commit,
    failed: failedInner,
    activation: innerResults?.activation ?? null,
    measurements: innerResults?.measurements ?? [],
    checks,
    passed: passedInner,
    failed: failedInner,
    innerError,
    budgets: core.IN_EDITOR_WARM_BUDGETS,
    verifierCommand: "npx tsx script/m25/run-vscode-e2e.mts",
    evidenceFile: "E5.json",
    generatedAt: new Date().toISOString(),
    os: process.platform,
    limitations: [] as string[],
  }
  if (innerError !== null) {
    result.limitations.push(`in-editor run error: ${innerError.slice(0, 300)} (honest failure — never silently skipped)`)
  }
  writeSealed(path.join(RESULTS, "E5.json"), result)
  console.log(`E5: ${result.status.toUpperCase()} (${passedInner}/${checks.length} in-editor checks passed)`)
  process.exit(result.status === "verified" ? 0 : 1)
}

void main()
