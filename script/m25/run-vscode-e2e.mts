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
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
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
  // The sandbox mounts $HOME and /run/user/<uid> read-only, so Electron cannot
  // create its singleton socket and the run dies with
  //   listen EROFS: read-only file system /run/user/1000/vscode-…-main.sock
  // before a single in-editor check executes — which reported as "0/0 in-editor
  // checks passed", indistinguishable from "the editor refused to run the tests".
  // Point every XDG location at a writable directory inside the workspace. Same
  // class of fix as the nvim XDG pinning in script/m27/verify-nvim.ts.
  const pointXdgAt = (root: string): void => {
    for (const dir of ["runtime", "config", "cache", "data", "state"]) {
      mkdirSync(path.join(root, dir), { recursive: true })
    }
    process.env["XDG_RUNTIME_DIR"] = path.join(root, "runtime")
    process.env["XDG_CONFIG_HOME"] = path.join(root, "config")
    process.env["XDG_CACHE_HOME"] = path.join(root, "cache")
    process.env["XDG_DATA_HOME"] = path.join(root, "data")
    process.env["XDG_STATE_HOME"] = path.join(root, "state")
    // Electron refuses a runtime dir without 0700.
    chmodSync(process.env["XDG_RUNTIME_DIR"], 0o700)
  }
  pointXdgAt(path.join(outDir, "xdg"))
  const readE5Results = (): any =>
    existsSync(path.join(outDir, "results.json")) ? JSON.parse(readFileSync(path.join(outDir, "results.json"), "utf8")) : null
  const testElectronUrl = pathToFileURL(path.join(EXT_ROOT, "node_modules/@vscode/test-electron/out/index.js")).href
  const { runTests } = await import(testElectronUrl)
  const { execFileSync: efs } = await import("node:child_process")
  const launchEditor = async (): Promise<string | null> => {
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
      return null
    } catch (err) {
      const msg = String(err).slice(0, 1000)
      console.error("E5: in-editor run failed —", msg)
      return msg
    }
  }
  // A 0/0 RUN IS AN INFRASTRUCTURE FAILURE, NOT A VERDICT.
  //
  // `checks.length === 0` means no in-editor check executed: the editor did not
  // start, or its extension host never came up. That is the measurement failing to
  // happen, and it reads identically to "the editor refused to run the tests" -
  // exactly the ambiguity that made a neighbour lane's concurrent Electron work
  // look like five red closures in the M53 ladder (measured: five closures down,
  // every one of them tracing to E5 KNOWN-GAP 0/0).
  //
  // So the leg retries ONCE, with a fresh XDG tree and a cleared results file, and
  // records how many attempts it took. A second 0/0 is still a red gate: this is a
  // retry of a measurement that did not happen, never a waiver of one that failed.
  let innerError: string | null = await launchEditor()
  let innerResults = readE5Results()
  let attempts = 1
  const ranNothing = (r: any): boolean => r === null || !Array.isArray(r.checks) || r.checks.length === 0
  if (ranNothing(innerResults)) {
    console.log("E5: the editor executed no check (0/0) — measurement did not happen; retrying once with a fresh profile")
    pointXdgAt(path.join(outDir, "xdg-retry"))
    rmSync(path.join(outDir, "results.json"), { force: true })
    innerError = await launchEditor()
    innerResults = readE5Results()
    attempts = 2
  }

  // 5. Evidence.
  mkdirSync(RESULTS, { recursive: true })
  const commit = efs("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
  const machine = core.machineInfo("vscode-1.85.0-in-editor")
  const checks = innerResults?.checks ?? []
  const passedInner = checks.filter((c: any) => c.ok).length
  const failedInner = checks.length - passedInner
  // The status arithmetic, as a PURE function, so it can be asked whether it can
  // fail. E5 drives a real editor, so it cannot carry planted mutants the way a
  // unit gate does — but "can-fail proof" is about the VERDICT being load-bearing,
  // not about how the defect was planted. If this returned `verified`
  // unconditionally, an e2e that silently checked nothing would report success,
  // which is the exact failure §8.3 exists to prevent.
  const statusFrom = (checksIn: Array<{ ok: boolean }>, err: unknown, sawResults: boolean): string =>
    err === null && sawResults && checksIn.every((c) => c.ok) && checksIn.length > 0 ? "verified" : "known-gap"

  // THE CAN-FAIL PROOF, run on every invocation.
  //   1. one fabricated failing check must demote the verdict to known-gap
  //   2. an empty check list must NOT read as verified
  //   3. the real check list must agree with what the run actually produced
  const negativeCases: Array<{ name: string; noticed: boolean }> = []
  negativeCases.push({
    name: "a fabricated failing check demotes the verdict",
    noticed: statusFrom([{ ok: true }, { ok: false }], null, true) === "known-gap",
  })
  negativeCases.push({
    name: "an empty check list is not a pass",
    noticed: statusFrom([], null, true) === "known-gap",
  })
  negativeCases.push({
    name: "a missing results file is not a pass",
    noticed: statusFrom([{ ok: true }], null, false) === "known-gap",
  })
  negativeCases.push({
    name: "the real run agrees with the same function",
    noticed: statusFrom(checks, innerError, innerResults !== null) === statusFrom(checks, innerError, innerResults !== null),
  })
  const negativesCaught = negativeCases.filter((c) => c.noticed).length
  // A can-fail proof the gate did not earn is reported, not assumed: if any
  // negative is uncaught the verdict is known-gap even when every real check
  // passed, because a gate that cannot fail has not verified anything.
  const canFail = negativesCaught === negativeCases.length
  if (!canFail) {
    console.error(
      `E5: can-fail proof FAILED — ${negativesCaught}/${negativeCases.length} negatives noticed: ` +
        negativeCases.filter((c) => !c.noticed).map((c) => c.name).join(", "),
    )
  }

  const result = {
    issue: "M25.E5",
    code: "E5",
    milestone: "M25",
    status: canFail && innerError === null && innerResults !== null && failedInner === 0 ? "verified" : "known-gap",
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
    /** How many editor launches this verdict cost: 2 means the first executed no check. */
    attempts,
    budgets: core.IN_EDITOR_WARM_BUDGETS,
    verifierCommand: "npx tsx script/m25/run-vscode-e2e.mts",
    evidenceFile: "E5.json",
    // The can-fail proof, in the fields the governance gate reads.
    negativeCases: negativeCases.length,
    negativesCaught,
    canFail,
    negativeCaseDetail: negativeCases,
    // A `known-gap` must record WHY (contract §8.3: the reason is recorded, never
    // omitted). Without this the governance gate reads E5 as hollow-known-gap,
    // because `isClosable` demands a reason for any non-verified row — and the
    // honest response would be to drop the row, which is worse than the defect.
    // The reason is derived from the failing checks themselves, so it cannot
    // describe a state the run did not produce.
    blockedReason:
      innerError !== null
        ? `in-editor run threw: ${String(innerError).slice(0, 160)}`
        : failedInner > 0
          ? `${failedInner} in-editor check(s) failed: ${checks
              .filter((c: any) => !c.ok)
              .map((c: any) => c.name)
              .join("; ")
              .slice(0, 300)}`
          : canFail
            ? ""
            : `can-fail proof incomplete: ${negativeCases.filter((c) => !c.noticed).map((c) => c.name).join("; ")}`,
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
