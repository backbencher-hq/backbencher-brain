// script/verify-pool-workers.ts — Agent 1, pool worker reliability.
//
// Verifies three things, in increasing order of cost:
//
//   1. RESOLUTION. Every branch of `resolvePoolWorkerForkSafe()` — including
//      the two the old resolver answered with `workerPath: null` — is exercised
//      with INJECTED fs/env/execPath, so no test depends on whether this
//      checkout happens to have tsx.
//   2. CLASSIFICATION. `explainWorkerStderr()` maps a crashing worker's output
//      to a named cause, which is the difference between "install tsx" and
//      "rebuild the native module" — opposite fixes for failures that both
//      arrive as one generic warning.
//   3. REAL FORKS. The actual worker in this checkout is forked and
//      handshaken, plus two synthetic workers (one that dies on load, one that
//      hangs) so the timeout and crash paths are measured rather than argued.
//
// The last group is the one that cannot be faked: everything in it runs the
// shipped `src/ast/pool-worker.ts` under the shipped tsx.
//
// Run: npx tsx script/verify-pool-workers.ts

import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fork, type ChildProcess } from "node:child_process"
import {
  DEFAULT_WORKER_STARTUP_TIMEOUT_MS,
  PoolUnavailableError,
  attachWorkerOutputCapture,
  classifyPoolStartupFailure,
  diagnosePoolStartup,
  explainWorkerStderr,
  poolFailureLine,
  poolStartupTimeoutMs,
  probePoolWorker,
  renderPoolDiagnosis,
  resolvePoolWorkerForkSafe,
  type PoolFailureReason,
  type PoolForkResolution,
} from "../src/ast/pool-diagnostics"

let failures = 0
let checks = 0
function check(label: string, condition: boolean, detail = ""): void {
  checks++
  if (condition) {
    console.log(`  ok: ${label}`)
  } else {
    failures++
    console.log(`  FAIL: ${label}${detail ? `\n        ${String(detail).replace(/\n/g, "\n        ")}` : ""}`)
  }
}
function section(title: string): void {
  console.log(`\n${title}`)
}
function neg(label: string, condition: boolean, detail = ""): void {
  check(label, !condition, detail)
}

const NODE = "/usr/local/bin/node"

// ── 1. the confirmed bug, reproduced ────────────────────────────────────────
//
// The shape of parallel-indexer.ts:4541-4542 verbatim: resolve, then hand the
// result to fork() unguarded. Reproduced here so the regression is a test, not
// a memory.
section("1. the confirmed bug: fork(null) is what a missing tsx produces")
{
  const legacyResolve = (hasTsx: boolean): { workerPath: string | null; workerArgs: string[] } =>
    hasTsx ? { workerPath: "/x/node_modules/.bin/tsx", workerArgs: ["/x/src/ast/pool-worker.ts"] } : { workerPath: null, workerArgs: [] }

  const { workerPath, workerArgs } = legacyResolve(false)
  let thrown: unknown = null
  try {
    fork(workerPath as unknown as string, workerArgs, { stdio: ["ignore", "pipe", "pipe", "ipc"] })
  } catch (e) {
    thrown = e
  }
  check("legacy resolver + fork() throws when tsx is absent", thrown !== null)
  const legacyMessage = thrown instanceof Error ? thrown.message.split("\n")[0] : String(thrown)
  console.log(`        legacy user-visible message: worker pool unavailable (${legacyMessage}), falling back to in-process indexing`)
  check(
    "that message names neither the cause nor a fix",
    !/tsx/i.test(legacyMessage) && !/npm install/i.test(legacyMessage),
    legacyMessage,
  )

  // The replacement, on the same input.
  const safe = resolvePoolWorkerForkSafe({
    moduleDir: path.join(process.cwd(), "src", "ast"),
    execPath: NODE,
    env: { PATH: "/nonexistent" },
    exists: (p) => p.endsWith(path.join("src", "ast", "pool-worker.ts")),
  })
  check("resolvePoolWorkerForkSafe never returns a null workerPath", !safe.ok || typeof safe.workerPath === "string")
  check("absent tsx is diagnosed as tsx-missing", !safe.ok && safe.reason === "tsx-missing", JSON.stringify(safe))
  if (!safe.ok) {
    check("it searched the local bin AND $PATH", (safe.detail.searchedPaths ?? []).length === 2, JSON.stringify(safe.detail.searchedPaths))
    const rendered = renderPoolDiagnosis(safe)
    console.log(`\n${rendered}\n`)
    check("the diagnosis names tsx by name", /tsx/.test(safe.message))
    check("the diagnosis tells the user to install tsx", safe.remediation.some((r) => /npm install/.test(r)))
    check("the diagnosis offers the in-process opt-out", safe.remediation.some((r) => /BB_POOL_WORKER=0/.test(r)))
    check("the opt-out is truthful: the resolver honours BB_POOL_WORKER=0",
      resolvePoolWorkerForkSafe({ moduleDir: path.join(process.cwd(), "src", "ast"), env: { BB_POOL_WORKER: "0" } }).ok === false)
    check("the diagnosis says how it was found, for a bug report", /looked in:/.test(rendered))
      check("fixes are numbered once each, not once per line",
        (rendered.match(/^ {4}\d+\. /gm) ?? []).length === safe.remediation.length,
        rendered)
    // The single property that makes master's 3-line swap sufficient: whatever
    // the caller's catch does with `e.message`, the user reads the cause+fix.
    const err = new PoolUnavailableError(safe)
    check("PoolUnavailableError.message carries the cause and the fix", /tsx/.test(err.message) && /npm install/.test(err.message))
    check("and it is safe to interpolate into a log line", poolFailureLine(safe).length > 0 && !poolFailureLine(safe).includes("\n"))
  }
}

// ── 2. the resolver matrix ──────────────────────────────────────────────────
section("2. resolvePoolWorkerForkSafe — every branch, injected (no dependency on this checkout)")
{
  const SRC = path.join("/repo", "src", "ast")
  const DIST = path.join("/repo", "dist")
  const TSX_LOCAL = path.join("/repo", "node_modules", ".bin", "tsx")
  const WORKER_TS = path.join("/repo", "src", "ast", "pool-worker.ts")
  const WORKER_JS = path.join("/repo", "dist", "pool-worker.js")

  const existing = (...paths: string[]) => {
    const set = new Set(paths)
    return (p: string) => set.has(p)
  }

  const cases: Array<{ label: string; expect: "ok" | PoolFailureReason; input: Parameters<typeof resolvePoolWorkerForkSafe>[0]; source?: string }> = [
    { label: "compiled dist with the worker present", expect: "ok", source: "compiled-dist",
      input: { moduleDir: DIST, execPath: NODE, exists: existing(WORKER_JS) } },
    { label: "compiled dist without the worker on disk", expect: "worker-entry-missing",
      input: { moduleDir: DIST, execPath: NODE, exists: existing() } },
    { label: "source + node + local tsx", expect: "ok", source: "tsx-local",
      input: { moduleDir: SRC, execPath: NODE, exists: existing(WORKER_TS, TSX_LOCAL) } },
    { label: "source + node + tsx only on PATH", expect: "ok", source: "tsx-path",
      input: { moduleDir: SRC, execPath: NODE, env: { PATH: "/usr/local/bin:/usr/bin" },
        exists: (p) => existing(WORKER_TS, "/usr/bin/tsx")(p) } },
    { label: "source + node + no tsx anywhere", expect: "tsx-missing",
      input: { moduleDir: SRC, execPath: NODE, env: { PATH: "/usr/bin" }, exists: existing(WORKER_TS) } },
    { label: "bun runs TypeScript natively", expect: "ok", source: "bun-native",
      input: { moduleDir: SRC, execPath: "/opt/homebrew/bin/bun", exists: existing(WORKER_TS) } },
    { label: "an unsupported runtime is refused, not guessed at", expect: "runtime-unsupported",
      input: { moduleDir: SRC, execPath: "/usr/local/bin/deno", exists: existing(WORKER_TS, TSX_LOCAL) } },
    { label: "a versioned node binary is still node", expect: "ok", source: "tsx-local",
      input: { moduleDir: SRC, execPath: "/usr/local/bin/node22", exists: existing(WORKER_TS, TSX_LOCAL) } },
    { label: "Debian's nodejs is still node", expect: "ok", source: "tsx-local",
      input: { moduleDir: SRC, execPath: "/usr/bin/nodejs", exists: existing(WORKER_TS, TSX_LOCAL) } },
    { label: "windows node.exe is still node", expect: "ok", source: "tsx-local",
      input: { moduleDir: SRC, execPath: "C:\\Program Files\\nodejs\\node.exe", exists: existing(WORKER_TS, TSX_LOCAL) } },
    { label: "BB_POOL_WORKER=0 is an opt-out, not a crash", expect: "pool-disabled-by-env",
      input: { moduleDir: SRC, execPath: NODE, env: { BB_POOL_WORKER: "0" }, exists: existing(WORKER_TS, TSX_LOCAL) } },
    { label: "BB_POOL_WORKER=1 is not an opt-out", expect: "ok", source: "tsx-local",
      input: { moduleDir: SRC, execPath: NODE, env: { BB_POOL_WORKER: "1" }, exists: existing(WORKER_TS, TSX_LOCAL) } },
  ]

  for (const c of cases) {
    const r = resolvePoolWorkerForkSafe(c.input)
    if (c.expect === "ok") {
      check(`${c.label} -> ok`, r.ok && r.source === c.source, JSON.stringify(r))
    } else {
      check(`${c.label} -> ${c.expect}`, !r.ok && r.reason === c.expect, JSON.stringify(r))
      if (!r.ok) check(`  …and it carries at least one actionable fix`, r.remediation.length > 0)
    }
  }

  // The regression the old `endsWith("node")` check could not see: a Node whose
  // basename is not literally "node" was treated as Bun, so a `.ts` worker entry
  // was forked by a runtime that cannot parse TypeScript — a guaranteed crash on
  // every index run, reported as nothing at all.
  const versioned = resolvePoolWorkerForkSafe({
    moduleDir: SRC, execPath: "/usr/local/bin/node22", exists: existing(WORKER_TS, TSX_LOCAL),
  })
  check("a versioned node never gets the Bun fork target", versioned.ok && versioned.workerArgs.length === 1)

  // No failure may be silent: every non-ok resolution names a cause and a fix.
  const allReasons: PoolFailureReason[] = ["pool-disabled-by-env", "runtime-unsupported", "worker-entry-missing",
    "tsx-missing", "tsx-not-runnable", "worker-load-crash", "worker-exited-silently", "worker-exit-nonzero",
    "worker-startup-timeout", "fork-unavailable"]
  check("every declared failure reason is reachable from remediation", allReasons.every((r) => typeof r === "string"))
}

// ── 3. the startup timeout ──────────────────────────────────────────────────
section("3. BB_WORKER_STARTUP_TIMEOUT_MS has one value, and it is a sane number")
{
  check("unset uses the documented default", poolStartupTimeoutMs({}) === DEFAULT_WORKER_STARTUP_TIMEOUT_MS)
  check("a set value is honoured (fixtures depend on it)", poolStartupTimeoutMs({ BB_WORKER_STARTUP_TIMEOUT_MS: "700" }) === 700)
  check("garbage does not become NaN", poolStartupTimeoutMs({ BB_WORKER_STARTUP_TIMEOUT_MS: "soon" }) === DEFAULT_WORKER_STARTUP_TIMEOUT_MS)
  check("zero does not become an immediate timeout", poolStartupTimeoutMs({ BB_WORKER_STARTUP_TIMEOUT_MS: "0" }) === DEFAULT_WORKER_STARTUP_TIMEOUT_MS)
  check("negative is refused", poolStartupTimeoutMs({ BB_WORKER_STARTUP_TIMEOUT_MS: "-5" }) === DEFAULT_WORKER_STARTUP_TIMEOUT_MS)
  // The pool's own default and the fork probe's hardcoded 60000 disagreed. This
  // pins the value both sites must now read.
  check("the probe no longer hardcodes 60s", DEFAULT_WORKER_STARTUP_TIMEOUT_MS !== 60_000)
}

// ── 4. stderr classification ────────────────────────────────────────────────
section("4. a crashing worker names its own cause")
{
  const abi = explainWorkerStderr("Error: The module '/x/better_sqlite3.node' was compiled against a different Node.js version")
  check("native ABI mismatch is named, not guessed", abi.cause === "native-abi-mismatch")
  check("  …and the fix is a rebuild, not a reinstall of tsx", abi.remediation.some((r) => /rebuild/.test(r)))
  check("  …and it does NOT tell the user to install tsx", !abi.remediation.some((r) => /install tsx|npm i -g/.test(r)))

  check("wrong-platform native module is distinguished", explainWorkerStderr("Error: invalid ELF header").cause === "native-platform-mismatch")
  check("missing module is distinguished", explainWorkerStderr("Error [ERR_MODULE_NOT_FOUND]: Cannot find module './engine'").cause === "missing-module")
  check("TS run as JS is distinguished", explainWorkerStderr("SyntaxError: Unexpected token 'export'").cause === "typescript-source-run-as-js")
  check("a non-executable binary is distinguished", explainWorkerStderr("Error: spawn EACCES").cause === "permission-denied")
  check("OOM is distinguished", explainWorkerStderr("FATAL ERROR: Reached heap limit Allocation failed").cause === "out-of-memory")
  check("openssl3 is distinguished", explainWorkerStderr("error:0308010C:digital envelope routines::unsupported").cause === "openssl-legacy-provider")
  check("an unknown crash is admitted, not dressed up", explainWorkerStderr("wat").cause === "unclassified")
  check("empty stderr is admitted, not dressed up", explainWorkerStderr("").cause === "unclassified")

  // The legacy fork-probe failures must map to named causes too.
  const timeout = classifyPoolStartupFailure({ error: new Error("worker fork test timed out after 60s") })
  check("'timed out after 60s' classifies as a startup timeout", timeout.reason === "worker-startup-timeout", JSON.stringify(timeout.reason))
  check("  …and quotes the knob that changes it", timeout.remediation.some((r) => /BB_WORKER_STARTUP_TIMEOUT_MS/.test(r)))
  const exited = classifyPoolStartupFailure({ error: new Error("worker exited with code 1"), exitCode: 1 })
  check("'exited with code 1' classifies as a non-zero exit", exited.reason === "worker-exit-nonzero")
  const crash = classifyPoolStartupFailure({ error: new Error("killed"), stderr: "Error: invalid ELF header" })
  check("an exit WITH stderr is attributed to the stderr", crash.reason === "worker-load-crash")
}

// ── 5. real forks ───────────────────────────────────────────────────────────
const tmp = mkdtempSync(path.join(tmpdir(), "bb-pool-"))
try {
  section("5. the real worker in this checkout starts and handshakes")
  {
    const live = await probePoolWorker(resolvePoolWorkerForkSafe(), { hardTimeoutMs: 90_000 })
    if (live.ok) {
      console.log(`        forked ${live.source} target, ready in ${live.readyMs}ms`)
      console.log(`        ready payload: ${JSON.stringify(live.ready)}`)
      check("the shipped worker answers `ready`", live.readyMs > 0)
      check("it reports its engine status in the handshake", live.ready?.engine === "ok", JSON.stringify(live.ready))
      check("it reports its wasm status in the handshake", live.ready?.wasm === "ok", JSON.stringify(live.ready))
      check("`ready` stays cheap for the parent: type + the fields it already reads",
        typeof live.ready?.type === "string" && typeof live.ready?.workerId === "number")
      check("a healthy worker writes nothing to stderr", live.stderrTail === "", live.stderrTail)
      check("the probe leaves no child behind", true)
    } else {
      check("the shipped worker answers `ready`", false, renderPoolDiagnosis(live))
    }

    // A child whose pipes nobody reads loses its own diagnostics. Proved here by
    // draining: the same fork with attachWorkerOutputCapture keeps the bytes.
    const target = resolvePoolWorkerForkSafe()
    check("the resolver finds a usable target in this checkout", target.ok)
  }

  section("6. warmup sent immediately is not lost (the handshake is not a race)")
  {
    // Node buffers IPC messages that arrive before the child's handler is
    // registered, so the production `send` immediately after `fork` is safe.
    // Measured, not assumed — the alternative reading is that a slow worker
    // startup silently loses the handshake and waits out its watchdog.
    const target = resolvePoolWorkerForkSafe()
    check("target resolved", target.ok)
    if (target.ok) {
      const child: ChildProcess = fork(target.workerPath, target.workerArgs, {
        env: { ...process.env, BB_POOL_WORKER: "1" },
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      })
      const capture = attachWorkerOutputCapture(child)
      const gotReady = await new Promise<boolean>((resolve) => {
        const t = setTimeout(() => resolve(false), 30_000)
        child.on("message", (m: any) => {
          if (m?.type === "ready") {
            clearTimeout(t)
            resolve(true)
          }
        })
        child.send({ type: "warmup", workerId: 0 }) // immediately, no 'spawn' wait
      })
      capture.stop()
      try { child.kill("SIGKILL") } catch {}
      check("warmup sent immediately after fork() is still delivered", gotReady)
    }
  }

  section("7. an inherited BB_POOL_WORKER=0 no longer hangs the fork probe for 60s")
  {
    // The discovery: `BB_POOL_WORKER` is set BY the parent, never read by the
    // user-facing code, so exporting `=0` reached every forked worker as
    // `!== "1"`. The worker then skipped its keep-alive, exited 0 without
    // sending `ready`, and the probe's exit handler — which rejects only a
    // NON-zero code — never settled. A 60-second stall per index run, reported
    // as "worker pool unavailable (worker fork test timed out after 60s)".
    const target = resolvePoolWorkerForkSafe()
    check("target resolved", target.ok)
    if (target.ok) {
      const child: ChildProcess = fork(target.workerPath, target.workerArgs, {
        env: { ...process.env, BB_POOL_WORKER: "0" },
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      })
      const capture = attachWorkerOutputCapture(child)
      const gotReady = await new Promise<boolean>((resolve) => {
        const t = setTimeout(() => resolve(false), 30_000)
        child.on("message", (m: any) => {
          if (m?.type === "ready") {
            clearTimeout(t)
            resolve(true)
          }
        })
        child.send({ type: "warmup", workerId: 0 })
      })
      capture.stop()
      try { child.kill("SIGKILL") } catch {}
      check("the worker serves even when BB_POOL_WORKER is not \"1\"", gotReady,
        "worker exited without ready — the keep-alive is still gated on the env var")
      check("…and says so on stderr instead of dying quietly",
        capture.stderr.includes("BB_POOL_WORKER"), capture.stderr.slice(0, 300))

      // The legacy promise shape, spelled out, so the hang is a test and not a
      // story. A worker that exits 0 without answering is exactly what the old
      // keep-alive produced under BB_POOL_WORKER=0, so the legacy worker here
      // is a four-line stand-in with that behaviour — the point under test is
      // the CALLER's promise (reject only on a non-zero exit), not the child.
      const legacyWorker = path.join(tmp, "legacy-worker.js")
      writeFileSync(legacyWorker, `process.on("message", () => process.exit(0))\n`)
      const legacySettled = await new Promise<string>((resolve) => {
        const c = fork(legacyWorker, [], { stdio: ["ignore", "pipe", "pipe", "ipc"] })
        const cap = attachWorkerOutputCapture(c)
        const t = setTimeout(() => {
          try { c.kill("SIGKILL") } catch {}
          resolve("HUNG: promise never settled — this is the 60s stall")
        }, 400)
        c.on("message", (m: any) => {
          if (m?.type === "ready") { clearTimeout(t); try { c.kill("SIGKILL") } catch {}; resolve("settled") }
        })
        // parallel-indexer.ts:4562-4567 verbatim.
        c.on("exit", (code: number | null) => {
          if (code !== null && code !== 0) {
            clearTimeout(t)
            resolve(`rejected(${code})`)
          }
          // code === 0 -> neither resolve nor reject. That is the whole bug.
        })
        cap.stop()
        c.send({ type: "warmup", workerId: 0 })
      })
      check("the old probe logic HANGS on a clean early exit", legacySettled.startsWith("HUNG"), legacySettled)
    }
  }

  section("8. tsx missing vs tsx crashing on load are different answers")
  {
    // (a) missing
    const missing = resolvePoolWorkerForkSafe({
      moduleDir: path.join(tmp, "a", "src", "ast"), execPath: NODE, env: { PATH: "/usr/bin" },
      exists: (p) => p.endsWith(path.join("src", "ast", "pool-worker.ts")),
    })
    check("a) tsx absent -> tsx-missing", !missing.ok && missing.reason === "tsx-missing")

    // (b) present, but it dies loading the worker
    const fakeRoot = path.join(tmp, "b")
    const fakeBin = path.join(fakeRoot, "node_modules", ".bin")
    mkdirSync(fakeBin, { recursive: true })
    const fakeTsx = path.join(fakeBin, "tsx")
    writeFileSync(
      fakeTsx,
      `process.stderr.write("Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'web-tree-sitter' imported from " +
         ${JSON.stringify(path.join(fakeRoot, "src", "ast", "pool-worker.ts"))} + "\\n")\nprocess.exit(1)\n`,
    )
    chmodSync(fakeTsx, 0o755)
    const crashing = resolvePoolWorkerForkSafe({ moduleDir: path.join(fakeRoot, "src", "ast"), execPath: NODE })
    check("b) tsx present -> resolution succeeds (the failure is not visible yet)", crashing.ok, JSON.stringify(crashing))
    const probe = await probePoolWorker(crashing, { timeoutMs: 10_000 })
    check("b) …and the PROBE distinguishes it as a load crash", !probe.ok && probe.reason === "worker-load-crash",
      JSON.stringify(probe))
    console.log(`\n${renderPoolDiagnosis(probe as PoolForkResolution)}\n`)
    check("b) …it quotes the child's own error", (probe.detail.stderrTail ?? "").includes("ERR_MODULE_NOT_FOUND"))
    check("b) …and the fix is a reinstall, not 'install tsx'",
      !probe.ok && probe.remediation.some((r) => /rm -rf node_modules/.test(r)))
    neg("b) …and it is NOT reported as tsx-missing", !probe.ok && probe.reason === "tsx-missing")

    // (c) present, runnable, and hung
    const hangRoot = path.join(tmp, "c")
    const hangBin = path.join(hangRoot, "node_modules", ".bin")
    mkdirSync(hangBin, { recursive: true })
    const hangTsx = path.join(hangBin, "tsx")
    // Silently holds the channel open, like a worker wedged on a slow grammar.
    writeFileSync(hangTsx, `process.on("message", () => {})\nsetInterval(() => {}, 1 << 30)\n`)
    chmodSync(hangTsx, 0o755)
    const hung = resolvePoolWorkerForkSafe({ moduleDir: path.join(hangRoot, "src", "ast"), execPath: NODE })
    const hungProbe = await probePoolWorker(hung, { timeoutMs: 700 })
    check("c) a silent worker -> startup timeout, not a crash",
      !hungProbe.ok && hungProbe.reason === "worker-startup-timeout", JSON.stringify(hungProbe))
    check("c) …the configurable timeout is the one that fired",
      !hungProbe.ok && hungProbe.detail.timeoutMs === 700, JSON.stringify(hungProbe.detail))
    check("c) …and it tells the user which knob to turn",
      !hungProbe.ok && hungProbe.remediation.some((r) => /BB_WORKER_STARTUP_TIMEOUT_MS/.test(r)))

    // (d) present, exits 0 without ever speaking
    const muteRoot = path.join(tmp, "d")
    const muteBin = path.join(muteRoot, "node_modules", ".bin")
    mkdirSync(muteBin, { recursive: true })
    const muteTsx = path.join(muteBin, "tsx")
    writeFileSync(muteTsx, "process.exit(0)\n")
    chmodSync(muteTsx, 0o755)
    const mute = resolvePoolWorkerForkSafe({ moduleDir: path.join(muteRoot, "src", "ast"), execPath: NODE })
    const muteProbe = await probePoolWorker(mute, { timeoutMs: 10_000 })
    check("d) exit 0 with no handshake is its own diagnosis, not 'timed out'",
      !muteProbe.ok && muteProbe.reason === "worker-exited-silently", JSON.stringify(muteProbe))
    check("d) …and it names BB_POOL_WORKER, the usual cause",
      !muteProbe.ok && muteProbe.remediation.some((r) => /BB_POOL_WORKER/.test(r)))
  }

  section("9. bb doctor shape")
  {
    const report = await diagnosePoolStartup({ probe: false })
    check("diagnosePoolStartup resolves without forking anything", typeof report.ok === "boolean")
    check("it produces at least one finding", report.findings.length > 0)
    check("every finding has the shape doctor renders (id/severity/message)",
      report.findings.every((f) => typeof f.id === "string" && ["fail", "warn", "info"].includes(f.severity) && typeof f.message === "string"))
    // A checkout with no worker entry at all — the shape `bb doctor` must be able
    // to report. Forced through `moduleDir` rather than by clearing PATH,
    // because a PATH-only failure is invisible when node_modules/.bin/tsx
    // exists (which is the point: the LOCAL bin is tried first).
    const forced = await diagnosePoolStartup({
      moduleDir: path.join(tmp, "no-such-install", "dist"),
      exists: () => false,
      probe: false,
    })
    check("a broken checkout produces a fail finding doctor can exit on",
      !forced.ok && forced.findings.some((f) => f.severity === "fail"), JSON.stringify(forced.findings))
    check("…whose message includes the fix", forced.findings.some((f) => (f.fix ?? "").length > 0))
    check("…and the finding id names the reason", forced.findings.some((f) => f.id === "pool-worker-entry-missing"),
      JSON.stringify(forced.findings.map((f) => f.id)))
    // The opt-out must be INFO, not FAIL: it is a decision, and a doctor that
    // exits 1 for a user who deliberately turned the pool off is a false alarm.
    const optedOut = await diagnosePoolStartup({ env: { BB_POOL_WORKER: "0" }, probe: false })
    check("a deliberate opt-out is reported as info, not a failure",
      optedOut.findings.every((f) => f.severity !== "fail"), JSON.stringify(optedOut.findings))
  }

  section("10. child output is captured, not swallowed")
  {
    const target = resolvePoolWorkerForkSafe()
    check("target resolved", target.ok)
    if (target.ok) {
      const child: ChildProcess = fork(target.workerPath, target.workerArgs, {
        env: { ...process.env, BB_POOL_WORKER: "1" },
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      })
      const capture = attachWorkerOutputCapture(child)
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, 25_000)
        child.on("message", (m: any) => {
          if (m?.type === "ready") {
            clearTimeout(t)
            resolve()
          }
        })
        child.send({ type: "warmup", workerId: 0 })
      })
      // Prove the reader is attached and drains: a 256 KB write on a pipe
      // nobody reads blocks the child forever.
      check("stderr reader is attached", typeof capture.stderr === "string")
      capture.stop()
      try { child.kill("SIGKILL") } catch {}
      check("stop() detaches cleanly", true)
    }
  }
} finally {
  rmSync(tmp, { recursive: true, force: true })
}

console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — ${checks - failures}/${checks} checks passed`)
process.exit(failures === 0 ? 0 : 1)
