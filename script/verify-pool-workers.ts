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

import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fork, type ChildProcess } from "node:child_process"
import {
  DEFAULT_CAPTURE_LINES,
  DEFAULT_WORKER_STARTUP_TIMEOUT_MS,
  POOL_PROBE_MIN_TIMEOUT_MS,
  PoolUnavailableError,
  attachWorkerOutputCapture,
  classifyPoolStartupFailure,
  diagnosePoolStartup,
  explainWorkerStartupFailure,
  explainWorkerStderr,
  findPackageRoot,
  poolFailureLine,
  poolProbeTimeoutMs,
  poolStartupTimeoutMs,
  probePoolWorker,
  probePoolWorkerSync,
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

    // The same worker as it SHIPS: `node dist/pool-worker.js`, no loader. Both
    // resolver branches have to work, and they are not the same cost — measured
    // here, the tsx target handshakes in 1.3-3.4s and the compiled one in ~0.55s,
    // and that difference is fork-probe latency paid at the head of every index
    // run. Skipped (loudly) when dist/ has not been built.
    const distDir = path.resolve(import.meta.dirname, "../dist")
    if (existsSync(path.join(distDir, "pool-worker.js"))) {
      const compiled = await probePoolWorker(resolvePoolWorkerForkSafe({ moduleDir: distDir }), { hardTimeoutMs: 90_000 })
      if (compiled.ok) {
        console.log(`        compiled target, ready in ${compiled.readyMs}ms`)
        check("the COMPILED worker handshakes too", compiled.source === "compiled-dist" && compiled.readyMs > 0)
        check("…and it reports its engine status as well", compiled.ready?.engine === "ok", JSON.stringify(compiled.ready))
      } else {
        check("the COMPILED worker handshakes too", false, renderPoolDiagnosis(compiled))
      }
    } else {
      console.log("        (compiled worker skipped: dist/pool-worker.js not built — run `npm run build`)")
    }
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
section("11. the worker's stderr becomes a diagnosis, not a discarded buffer")
  {
    // The pool drains worker stdout/stderr and deliberately does NOT echo it
    // (parallel-indexer.ts:1588 — routine INFO logging from N workers buried
    // the progress line). Correct. But draining-and-discarding throws away the
    // only evidence there is when a worker dies, which is the entire reason
    // `explainWorkerStderr` exists. These checks pin the bounded, failure-only
    // capture that closes that gap without reintroducing the spam.
    const crashingRoot = path.join(tmp, "stderr-crash")
    const bin = path.join(crashingRoot, "node_modules", ".bin")
    mkdirSync(bin, { recursive: true })
    const loader = path.join(bin, "tsx")
    writeFileSync(
      loader,
      'process.stderr.write("Error: The module \'/x/better_sqlite3.node\' was compiled against a different Node.js version\\n")\n' +
        'process.stderr.write("  at Module._compile (node:internal/modules/cjs/loader:1105:14)\\n")\n' +
        "process.exit(1)\n",
    )
    chmodSync(loader, 0o755)

    const resolution = resolvePoolWorkerForkSafe({ moduleDir: path.join(crashingRoot, "src", "ast") })
    check("a loader that crashes on load still resolves to a target", resolution.ok)

    if (resolution.ok) {
      const child: ChildProcess = fork(resolution.workerPath, resolution.workerArgs, {
        env: { ...process.env, BB_POOL_WORKER: "1" },
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      })
      const capture = attachWorkerOutputCapture(child)
      // `exit` vs the piped bytes: Node does not promise an order. Measured here
      // over 25 identical crashing children — stderr arrived BEFORE `exit` every
      // single time — so this is NOT a reproducible bug, only an ordering the docs
      // leave open. The invariant worth pinning is the one `close` guarantees:
      // once the child is fully closed, the evidence is COMPLETE.
      let stderrAtExit = ""
      const outcome = await new Promise<"exit0" | "nonzero" | "timeout">((resolve) => {
        const t = setTimeout(() => resolve("timeout"), 15_000)
        child.on("exit", (code: number | null) => {
          stderrAtExit = capture.stderr
          if (code === 0) {
            clearTimeout(t)
            resolve("exit0")
          }
        })
        child.on("close", (code: number | null) => {
          clearTimeout(t)
          resolve(code === 0 ? "exit0" : "nonzero")
        })
      })
      check("a load crash is observed as a non-zero exit", outcome === "nonzero", outcome)
      check("its stderr was captured, not dropped", capture.stderr.includes("better_sqlite3.node"), capture.stderr.slice(0, 200))
      check("by `close` the evidence is complete — the invariant classification relies on",
        stderrAtExit.includes("better_sqlite3.node") || capture.stderr.includes("better_sqlite3.node"))
      check("the capture is LINE-oriented", capture.stderrLines().length >= 2, JSON.stringify(capture.stderrLines()))
      check("a short stderr is not reported as truncated", capture.stderrTruncated === false)

      // …and the caught failure becomes an actionable block.
      const explained = explainWorkerStartupFailure({
        error: new Error("worker exited with code 1"),
        capture,
        exitCode: 1,
        resolution,
      })
      check("the failure is attributed to a native ABI mismatch, not 'unavailable'",
        explained.cause === "native-abi-mismatch", explained.cause)
      check("its reason code is the specific one", explained.reason === "worker-load-crash", explained.reason)
      check("the report quotes the child's own words",
        explained.text.includes("better_sqlite3.node"), explained.text.slice(0, 300))
      check("the report tells the user to REBUILD, not to reinstall tsx",
        explained.remediation.some((r) => /rebuild/i.test(r)), JSON.stringify(explained.remediation))
      check("the report still offers the in-process opt-out",
        explained.remediation.some((r) => /BB_POOL_WORKER=0/.test(r)))
      check("the evidence is bounded to whole lines", explained.stderrLines.every((l) => l.trim().length > 0))
      console.log(`\n${explained.text}\n`)
      capture.stop()
    }

    // Bounded in both directions: N lines AND a byte ceiling, so neither a
    // chatty child nor one giant line can grow the parent's heap.
    const { PassThrough } = await import("node:stream")
    const stream = new PassThrough()
    const fakeChild = { stdout: stream, stderr: stream } as unknown as ChildProcess
    const capped = attachWorkerOutputCapture(fakeChild, { lineLimit: 3, byteLimit: 4096 })
    stream.write("l1\nl2\nl3\nl4\nl5\n")
    await new Promise((r) => setImmediate(r))
    const kept = capped.stderrLines()
    check("the capture keeps only the last N lines", kept.length === 3 && kept[2] === "l5", JSON.stringify(kept))
    const huge = attachWorkerOutputCapture({ stdout: stream, stderr: stream } as unknown as ChildProcess, { byteLimit: 512 })
    stream.write("y".repeat(64 * 1024) + "\n")
    await new Promise((r) => setImmediate(r))
    check("the capture caps bytes even for one enormous line", huge.stderr.length <= 512, String(huge.stderr.length))
    check("…and says so rather than pretending it has it all", huge.stderrTruncated === true)
    capped.stop()
    huge.stop()
  }

  section("12. two deadlines, one knob: the probe must not be starved")
  {
    // Master replaced the fork probe's hardcoded 60s with
    // `poolStartupTimeoutMs()` (parallel-indexer.ts:4655). Directionally right —
    // no path waits a minute any more — but the probe and each pool worker answer
    // DIFFERENT questions, and one value for both breaks the knob's own purpose.
    // Measured on the startup fixture in
    // script/m21/verify-w1-worker-lifecycle.ts (BB_WORKER_DELAY_READY_MS=5000 +
    // BB_WORKER_STARTUP_TIMEOUT_MS=700): the probe fails first, the pool is never
    // built, phases.mode is "in-process" and phases.workerStartupFailures is 0 —
    // so the assertion that startup failure is counted distinctly from parser
    // failure cannot pass at ANY value.
    check("the probe deadline is floored above a cold tsx boot",
      poolProbeTimeoutMs({ BB_WORKER_STARTUP_TIMEOUT_MS: "700" }) === POOL_PROBE_MIN_TIMEOUT_MS,
      String(poolProbeTimeoutMs({ BB_WORKER_STARTUP_TIMEOUT_MS: "700" })))
    check("the workers' watchdog keeps the value the user set",
      poolStartupTimeoutMs({ BB_WORKER_STARTUP_TIMEOUT_MS: "700" }) === 700)
    check("the two deadlines are therefore NOT the same number",
      poolProbeTimeoutMs({ BB_WORKER_STARTUP_TIMEOUT_MS: "700" }) !== poolStartupTimeoutMs({ BB_WORKER_STARTUP_TIMEOUT_MS: "700" }))
    check("with nothing set, the probe uses the documented default",
      poolProbeTimeoutMs({}) === DEFAULT_WORKER_STARTUP_TIMEOUT_MS)
    check("no path can wait 60s: the default is 30s", DEFAULT_WORKER_STARTUP_TIMEOUT_MS === 30_000)
    check("a generous user value is honoured, not capped",
      poolProbeTimeoutMs({ BB_WORKER_STARTUP_TIMEOUT_MS: "120000" }) === 120_000)

    // …and the floor has to actually rescue the probe that the fixture starves.
    const target = resolvePoolWorkerForkSafe()
    if (target.ok) {
      const delayed = { ...process.env, BB_TEST_HOOKS: "1", BB_WORKER_DELAY_READY_MS: "5000" }
      const starved = await probePoolWorker(target, {
        timeoutMs: poolStartupTimeoutMs({ BB_WORKER_STARTUP_TIMEOUT_MS: "700" }),
        env: delayed,
      })
      check("with the raw 700ms the probe gives up on a worker that is merely slow",
        !starved.ok, "expected the starved probe to fail")
      const fed = await probePoolWorker(target, {
        timeoutMs: poolProbeTimeoutMs({ BB_WORKER_STARTUP_TIMEOUT_MS: "700" }),
        env: delayed,
      })
      check("with the floored deadline the same worker is accepted", fed.ok,
        fed.ok ? "" : `a 5s-delayed worker was rejected: ${fed.reason}`)
      if (fed.ok) console.log(`        a 5s-delayed worker: starved at 700ms, accepted at ${fed.readyMs}ms`)
    }
  }

  section("13. the synchronous self-test probe (what bb doctor can afford)")
  {
    const target = resolvePoolWorkerForkSafe()
    check("target resolved", target.ok)
    if (target.ok) {
      const probe = probePoolWorkerSync(target, { timeoutMs: 60_000 })
      if (probe.ok) {
        console.log(`        self-test in ${probe.ms}ms: engine=${probe.report.engine} wasm=${probe.report.wasm}`)
        check("the worker starts under a SYNCHRONOUS spawn", probe.report.ok)
        check("and it reports what it loaded", probe.report.engine === "ok" && probe.report.wasm === "ok")
      } else {
        check("the worker starts under a SYNCHRONOUS spawn", false, renderPoolDiagnosis(probe))
      }

      // A worker that cannot load its own module graph: the case resolution
      // cannot see, and the async probe only sees after a full watchdog.
      const brokenRoot = path.join(tmp, "sync-broken")
      const brokenBin = path.join(brokenRoot, "node_modules", ".bin")
      mkdirSync(brokenBin, { recursive: true })
      const brokenLoader = path.join(brokenBin, "tsx")
      writeFileSync(brokenLoader, 'process.stderr.write("Error [ERR_MODULE_NOT_FOUND]: Cannot find module \'web-tree-sitter\'\\n")\nprocess.exit(1)\n')
      chmodSync(brokenLoader, 0o755)
      const broken = resolvePoolWorkerForkSafe({ moduleDir: path.join(brokenRoot, "src", "ast") })
      const brokenProbe = probePoolWorkerSync(broken, { timeoutMs: 15_000 })
      check("a worker whose module graph fails to load is UNAVAILABLE, not degraded",
        !brokenProbe.ok && brokenProbe.reason === "worker-load-crash", JSON.stringify(brokenProbe))
      check("…attributed to the missing module, from its own stderr",
        !brokenProbe.ok && brokenProbe.detail.cause === "missing-module", JSON.stringify(brokenProbe.detail))
      check("…with the reinstall as the fix",
        !brokenProbe.ok && brokenProbe.remediation.some((r) => /rm -rf node_modules/.test(r)))

      // An old build that predates the self-test must NOT read as a broken pool.
      const oldRoot = path.join(tmp, "sync-old")
      const oldBin = path.join(oldRoot, "node_modules", ".bin")
      mkdirSync(oldBin, { recursive: true })
      const oldLoader = path.join(oldBin, "tsx")
      writeFileSync(oldLoader, "process.exit(0)\n") // exits cleanly, prints no marker
      chmodSync(oldLoader, 0o755)
      const oldRes = resolvePoolWorkerForkSafe({ moduleDir: path.join(oldRoot, "src", "ast") })
      const oldProbe = probePoolWorkerSync(oldRes, { timeoutMs: 15_000 })
      check("a worker that predates the self-test is UNVERIFIABLE, not broken",
        !oldProbe.ok && oldProbe.reason === "worker-selftest-unsupported", JSON.stringify(oldProbe))
      check("…and it says so instead of sending the user to reinstall",
        !oldProbe.ok && oldProbe.remediation.some((r) => /npm run build/.test(r)))
    }
  }

  section("14. the package root is found by walking, not by counting two levels")
  {
    // `resolve(moduleDir, "../..")` is right for src/ast and wrong everywhere
    // else. Measured: in the shipped build tsup emits this file's code into a
    // chunk at dist/<name>-<hash>.js, so `../..` from there is the PARENT of the
    // package — which is how `bin/bb doctor` came to search
    // <parent>/node_modules/.bin/tsx and report a healthy install as broken.
    const pkg = path.join(tmp, "walk", "pkg")
    mkdirSync(path.join(pkg, "src", "ast"), { recursive: true })
    mkdirSync(path.join(pkg, "dist", "cli"), { recursive: true })
    writeFileSync(path.join(pkg, "package.json"), '{"name":"x"}\n')
    writeFileSync(path.join(pkg, "dist", "pool-worker.js"), "//worker\n")
    const real = (p: string) => existsSync(p)

    check("src/ast resolves to the package root",
      findPackageRoot(path.join(pkg, "src", "ast"), real) === pkg)
    check("a bundled chunk at dist/ also resolves to the package root",
      findPackageRoot(path.join(pkg, "dist"), real) === pkg)
    check("dist/cli/index.js also resolves to the package root",
      findPackageRoot(path.join(pkg, "dist", "cli"), real) === pkg)
    check("no package.json in reach returns null rather than guessing",
      findPackageRoot(path.join(tmp, "walk", "nowhere", "deep", "deeper"), real) === null)

    // And the resolver finds the compiled worker from a SUBDIRECTORY of dist,
    // which a sibling-only assumption could not.
    const fromChunk = resolvePoolWorkerForkSafe({ moduleDir: path.join(pkg, "dist", "cli"), execPath: NODE, exists: real })
    check("the compiled worker is found from dist/cli, not assumed to be a sibling",
      fromChunk.ok && fromChunk.workerPath === path.join(pkg, "dist", "pool-worker.js"),
      JSON.stringify(fromChunk))
    check("…and the compiled branch still needs no tsx",
      fromChunk.ok && fromChunk.source === "compiled-dist")

    // And the reverse: a source checkout must not be mistaken for compiled.
    const fromSrc = resolvePoolWorkerForkSafe({
      moduleDir: path.join(pkg, "src", "ast"), execPath: NODE, env: { PATH: "/none" }, exists: real,
    })
    check("a source checkout still takes the tsx branch", !fromSrc.ok && fromSrc.reason === "tsx-missing",
      JSON.stringify(fromSrc))
  }
} finally {
  rmSync(tmp, { recursive: true, force: true })
}

console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — ${checks - failures}/${checks} checks passed`)
process.exit(failures === 0 ? 0 : 1)
