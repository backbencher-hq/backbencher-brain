// src/ast/pool-diagnostics.ts — why aren't my pool workers starting?
//
// WHY THIS EXISTS. `parallel-indexer.ts` decides between the worker pool and
// in-process indexing by FORKing a probe worker and waiting for a `ready`
// handshake (parallel-indexer.ts:4539-4577). Every failure in that handshake
// lands in one `catch` and becomes one line:
//
//     [brain] ⚠ worker pool unavailable (The "modulePath" argument must be of
//     type string or an instance of Buffer or URL. Received null), falling
//     back to in-process indexing
//
// That message is the WHOLE diagnosis a user gets for a pool that never starts,
// and for the single most common cause — tsx is absent because the install was
// `--omit=dev` / `NODE_ENV=production`, or the checkout has no node_modules at
// all — it names neither the cause nor the fix. The reported string is
// Node's argument-validation text for `fork(null, ...)`, reached because
// `resolvePoolWorkerFork()` (parallel-indexer.ts:1208) returns
// `{ workerPath: null }` at line 1226 and the caller passes it to `fork()`
// unguarded.
//
// This module is the diagnosis, separated from the decision so it can be
// reused by the indexer, by `bb doctor`, and by a test, without any of them
// re-deriving the rules:
//
//   resolvePoolWorkerForkSafe()  — the resolver, as a discriminated union.
//                                 Never returns null; never throws.
//   probePoolWorker()           — actually forks the resolved target once and
//                                 classifies what happened (this is what
//                                 separates "tsx missing" from "tsx crashes
//                                 on load", which resolution alone cannot tell).
//   diagnosePoolStartup()       — resolve + probe, shaped as `bb doctor`
//                                 findings. Read-only.
//   attachWorkerOutputCapture() — reads a child's stdout/stderr. The existing
//                                 fork probe pipes both and reads NEITHER
//                                 (parallel-indexer.ts:4544), so a child that
//                                 crashes on load tells the parent nothing, and
//                                 a chatty child eventually blocks on a full
//                                 64 KB pipe buffer.
//
// NO INDEXING SEMANTICS ARE DECIDED HERE. This module resolves a fork target,
// observes a handshake, and explains a failure. It never parses a file, never
// chooses a worker count, and never changes what the pool does on success.
//
// WIRE IT IN (the whole change is 3 lines at parallel-indexer.ts:4541):
//
//     -import { resolvePoolWorkerFork } from ...        // local fn, delete
//     +import { resolvePoolWorkerForkSafe, PoolUnavailableError } from "./pool-diagnostics"
//
//     -const { workerPath: testWorkerPath, workerArgs: testWorkerArgs } = resolvePoolWorkerFork()
//     +const poolFork = resolvePoolWorkerForkSafe()
//     +if (!poolFork.ok) throw new PoolUnavailableError(poolFork)
//     +const { workerPath: testWorkerPath, workerArgs: testWorkerArgs } = poolFork
//
// `PoolUnavailableError.message` already contains the cause and the fix, so
// the existing `catch` at parallel-indexer.ts:4573 prints something actionable
// with no further edit. Three more sites are worth the same treatment and are
// listed in AGENT-1-REPORT; none of them is required for correctness.

import { fork as forkChild, spawnSync, type ChildProcess } from "node:child_process"
import { existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

export const WORKER_ENTRY_RELATIVE = path.join("src", "ast", "pool-worker.ts")

/**
 * One source of truth for the startup watchdog.
 *
 * The pool used `BB_WORKER_STARTUP_TIMEOUT_MS` (default 30000,
 * parallel-indexer.ts:1248) while the fork probe that PRECEDES it hardcoded
 * 60000 (parallel-indexer.ts:4550) and reported "timed out after 60s" in its
 * own error message. Two numbers for one deadline means the probe could wait
 * twice as long as the thing it is probing, and a user who lowered the
 * watchdog to make a startup bug reproducible still sat through a 60 s stall
 * before the fallback was reported. Read the value here so both sites agree.
 */
export const DEFAULT_WORKER_STARTUP_TIMEOUT_MS = 30_000

/** `BB_POOL_WORKER` values that mean "do not use the pool". */
const DISABLED_VALUES = new Set(["0", "false", "off", "no", "none"])

export function poolStartupTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.BB_WORKER_STARTUP_TIMEOUT_MS
  if (raw === undefined || raw === "") return DEFAULT_WORKER_STARTUP_TIMEOUT_MS
  const n = Number(raw)
  // A garbage or non-positive value must not become `setTimeout(fn, NaN)`,
  // which fires immediately and would report every worker as hung.
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_WORKER_STARTUP_TIMEOUT_MS
  return n
}

/**
 * Floor for the FORK PROBE's deadline. Not the workers' — see below.
 *
 * MEASURED, not guessed: a healthy cold start of the tsx target on this machine
 * is 0.9-3.4s (the compiled target 0.55-0.67s), and a cold module cache on a
 * loaded machine is worse. A probe deadline below that classifies a healthy
 * worker as hung, which is the same false verdict as an old one, just faster.
 */
export const POOL_PROBE_MIN_TIMEOUT_MS = 15_000

/**
 * The fork PROBE's deadline — deliberately NOT the same number as the workers'
 * watchdog, even though both come from one env var.
 *
 * They are two different questions, and the 60s that used to be hardcoded at
 * the probe was not laziness, it was the fixture:
 *
 *   - THE PROBE (parallel-indexer.ts:4655) forks ONE throwaway worker and waits
 *     for its first `ready`. It pays the whole loader cost — tsx boot plus the
 *     module graph — before a single byte of work is done.
 *   - EACH POOL WORKER (parallel-indexer.ts:1248) is forked only AFTER the probe
 *     has already proved the target boots, so its deadline covers the remaining
 *     work, not the cold start.
 *
 * When both read the same value, lowering the knob to make a slow machine
 * workable starves the probe, and lowering it to EXERCISE per-worker startup
 * failure (which is exactly what `script/m21/verify-w1-worker-lifecycle.ts:157`
 * does with `BB_WORKER_STARTUP_TIMEOUT_MS=700` + `BB_WORKER_DELAY_READY_MS=5000`)
 * stops exercising anything: measured on that fixture, the probe fails first at
 * 700 ms, the pool is never created, `phases.mode` is `in-process` and
 * `phases.workerStartupFailures` is 0 — so the assertion that startup failure is
 * counted distinctly from parser failure can no longer pass at any setting.
 *
 * With the probe floored, that fixture's own numbers work again: probe 15s (a
 * 5 s delayed `ready` fits), per-worker watchdog 700 ms (so it does fail, and is
 * counted). And the worst case for an unset environment is 30 s, not the 60 s
 * that used to be hardcoded — so no path waits a minute any more.
 */
export function poolProbeTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  return Math.max(poolStartupTimeoutMs(env), POOL_PROBE_MIN_TIMEOUT_MS)
}

/** How the fork target was found. Reported in the diagnosis so a user can see WHICH one was used. */
export type PoolForkSource = "compiled-dist" | "tsx-local" | "tsx-path" | "bun-native"

export type PoolFailureReason =
  /** `BB_POOL_WORKER` is explicitly off. Not a failure — a decision. */
  | "pool-disabled-by-env"
  /** `process.execPath` is neither Node nor Bun, so the fork target is unknowable. */
  | "runtime-unsupported"
  /** Compiled layout, but `pool-worker.js` is not on disk (partial install / wrong checkout). */
  | "worker-entry-missing"
  /** Running from source under Node, but no tsx binary exists. The confirmed bug. */
  | "tsx-missing"
  /** tsx exists but the probe could not execute it (EACCES / ENOENT / not a file). */
  | "tsx-not-runnable"
  /** tsx ran and died before `ready` — a load-time crash in the worker's import graph. */
  | "worker-load-crash"
  /** tsx ran fine but the child exited 0 without ever sending `ready`. */
  | "worker-exited-silently"
  /** The child exited non-zero before `ready`. */
  | "worker-exit-nonzero"
  /** The child was alive and said nothing within the startup window. */
  | "worker-startup-timeout"
  /** The installed worker predates the self-test, so `bb doctor` cannot verify it. */
  | "worker-selftest-unsupported"
  /** `fork()` itself refused (sandbox, closed fd table, no exec). */
  | "fork-unavailable"

export interface PoolForkOk {
  ok: true
  /** Never null. `fork()` throws a TypeError on null, which is how this bug started. */
  workerPath: string
  workerArgs: string[]
  source: PoolForkSource
  /** Root the paths were derived from — the checkouts people look in first. */
  projectRoot: string
}

export interface PoolForkFailure {
  ok: false
  reason: PoolFailureReason
  /** One sentence: what is wrong. Log-safe, no newlines. */
  message: string
  /** What to DO. Every entry is a command or a concrete action, never "try again". */
  remediation: string[]
  /** Evidence, for a bug report. Never contains secrets. */
  detail: {
    execPath?: string
    nodeVersion?: string
    moduleDir?: string
    projectRoot?: string
    /** Every path that was tried, in the order they were tried. */
    searchedPaths?: string[]
    workerPath?: string
    workerArgs?: string[]
    exitCode?: number | null
    signal?: string | null
    timeoutMs?: number
    /** Tail of the child's stderr — the evidence a load crash explains itself with. */
    stderrTail?: string
    stdoutTail?: string
    errorMessage?: string
    /** Set when the child's stderr was classifiable; drives `remediation`. */
    cause?: StderrCause
    /** The fix for `cause`, when the cause is more specific than the reason. */
    causeRemediation?: string[]
  }
}

export type PoolForkResolution = PoolForkOk | PoolForkFailure

// ── remediation copy ────────────────────────────────────────────────────────
//
// Kept as data, in one function, so the message a user reads and the message a
// log records cannot drift apart.
//
// Each entry is ONE fix and may contain newlines; the renderer indents
// continuations under it. An earlier shape used separate array entries for
// continuations and the numbered output came out as `1. …  4. …  5. …`,
// because the numbering counted lines a reader sees as one instruction.

function npmInstallFix(what: string): string[] {
  return [
    `Install ${what}: \`npm install --include=dev\` in the bb checkout\n` +
      "tsx is a DEV dependency. A production install (`npm ci --omit=dev`, NODE_ENV=production,\n" +
      "a slim CI image) removes it, and the pool then fails exactly like this — silently,\n" +
      "because nothing on the path from \"tsx is gone\" to \"workers don't start\" said so.",
    "Or run the published build, which needs no tsx at all: `npm i -g backbencher-brain`",
  ]
}

function reinstallFix(): string[] {
  return [
    "Reinstall dependencies: `rm -rf node_modules && npm install --include=dev`\n" +
      "If that still fails the checkout is incomplete — `git status` should be clean and\n" +
      "`src/ast/pool-worker.ts` must exist.",
  ]
}

function inProcessOptOut(): string {
  // Truthful only because THIS module honours it: `resolvePoolWorkerForkSafe()`
  // returns `pool-disabled-by-env` and the caller falls back before forking.
  return "Or stay in-process (same index, slower): `BB_POOL_WORKER=0 bb index .`"
}

function remediationFor(reason: PoolFailureReason, detail: PoolForkFailure["detail"]): string[] {
  const workerCommand = `BB_POOL_WORKER=1 ${[detail.workerPath, ...(detail.workerArgs ?? [])].filter(Boolean).join(" ")}`
  switch (reason) {
    case "pool-disabled-by-env":
      return [
        "The pool is off by request, not by failure.\n" +
          "Unset it to get parallel indexing back: `unset BB_POOL_WORKER`",
      ]
    case "runtime-unsupported":
      return [
        `bb is running under \`${detail.execPath}\`, which is neither Node nor Bun.\n` +
          "Run it with Node >= 18 (`node --version`) or with Bun. The worker is forked with\n" +
          "the SAME executable as the parent, so an unrecognised runtime cannot load one:\n" +
          "answering \"I don't know\" costs an in-process index, guessing costs that plus a\n" +
          "failure that explains nothing.",
      ]
    case "worker-entry-missing":
      return [
        `Compiled worker entry \`${detail.workerPath}\` does not exist — a partial build, or an\n` +
          "install whose `files` list dropped dist/.",
        ...reinstallFix(),
      ]
    case "tsx-missing":
      return [...npmInstallFix("tsx, the TypeScript loader the dev worker needs"), inProcessOptOut()]
    case "tsx-not-runnable":
      return [
        `\`${detail.workerPath}\` exists but cannot be executed.\n` +
          "  `chmod +x node_modules/.bin/tsx`\n" +
          "or reinstall: `rm -rf node_modules && npm install --include=dev`",
        inProcessOptOut(),
      ]
    case "worker-load-crash":
      return [
        // The classified cause leads when stderr gave one. "Rebuild the native
        // module" and "install tsx" are OPPOSITE fixes, and guessing between
        // them from a truncated stack would be worse than reporting what the
        // child actually printed.
        ...(detail.causeRemediation ?? []),
        detail.stderrTail
          ? `The worker's own words:\n\`\`\`\n${detail.stderrTail}\n\`\`\``
          : "It printed nothing to stderr, so the cause is unknown.",
        detail.cause ? null : `Or run the worker by hand to see for yourself:\n  \`${workerCommand}\``,
        inProcessOptOut(),
      ].filter((x): x is string => x !== null)
    case "worker-exited-silently":
      return [
        "The worker exited cleanly WITHOUT sending `ready` — it never entered worker mode.\n" +
          "Most often `BB_POOL_WORKER` is not \"1\" in the child environment: an exported\n" +
          "`BB_POOL_WORKER=0` reads like a supported \"don't use the pool\" switch, and the\n" +
          "only consequence was that every forked worker left instantly.\n" +
          "Unset it (`unset BB_POOL_WORKER`), or set it to 0 deliberately to index in-process.",
      ]
    case "worker-exit-nonzero":
      return [
        `Worker exited with code ${detail.exitCode}${detail.signal ? ` (signal ${detail.signal})` : ""} before it was ready.`,
        detail.stderrTail ? `Its last words:\n\`\`\`\n${detail.stderrTail}\n\`\`\`` : "It printed nothing to stderr.",
        ...(detail.causeRemediation ?? []),
        `Or re-run with the worker's own logging:\n  \`BB_LOG_LEVEL=debug bb index --force .\``,
        inProcessOptOut(),
      ]
    case "worker-startup-timeout":
      return [
        `The worker stayed alive but sent no \`ready\` within ${detail.timeoutMs}ms.\n` +
          "It is loading slowly, or it is hung.",
        "Raise the watchdog on a slow machine or a cold cache:\n" +
          "  `BB_WORKER_STARTUP_TIMEOUT_MS=120000 bb index .`",
        `Or watch it start by hand:\n  \`${workerCommand}\``,
        inProcessOptOut(),
      ]
    case "worker-selftest-unsupported":
      return [
        "The installed worker did not answer bb's startup self-test, so bb cannot prove it\n" +
          "starts. That is expected for a build older than the self-test; it is NOT a failure\n" +
          "of the pool.",
        "Rebuild to get a verifiable worker: `npm run build` (and `npm install --include=dev`\n" +
          "if you are running from source, where tsx is required).",
      ]
    case "fork-unavailable":
      return [
        "The operating system refused to fork a worker process.\n" +
          "Check for a sandbox ceiling (`ulimit -u`, a container pids limit) and for free\n" +
          "file descriptors (`ulimit -n`).",
        inProcessOptOut(),
      ]
  }
}

function fail(
  reason: PoolFailureReason,
  message: string,
  detail: PoolForkFailure["detail"],
): PoolForkFailure {
  return { ok: false, reason, message, remediation: remediationFor(reason, detail), detail }
}

// ── the resolver ────────────────────────────────────────────────────────────

export interface PoolResolverDeps {
  /** Directory of the CALLING module. Defaults to this file's directory. */
  moduleDir?: string
  /** Defaults to `process.execPath`. */
  execPath?: string
  /** Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv
  /** Defaults to `fs.existsSync`. Injected so the resolver is testable. */
  exists?: (p: string) => boolean
  /** Defaults to `process.version`. */
  version?: string
}

function findOnPath(name: string, env: NodeJS.ProcessEnv, exists: (p: string) => boolean): string | null {
  for (const dir of (env.PATH || "").split(path.delimiter)) {
    if (!dir) continue
    const candidate = path.join(dir, name)
    try {
      if (exists(candidate)) return candidate
    } catch {
      // An unreadable PATH entry is not a reason to stop looking.
    }
  }
  return null
}

/** How far up the tree the package-root walk will look before giving up. */
const MAX_ROOT_WALK = 6

/**
 * The package root, found by walking up to the nearest `package.json`.
 *
 * WHY NOT `resolve(moduleDir, "../..")`, WHICH IS WHAT BOTH CALLERS USED.
 * That expression is only correct for ONE layout — the unbundled source tree,
 * where `src/ast` and `src/setup` each sit exactly two levels under the root.
 * It breaks for every other layout, and the bundle is the layout that ships:
 *
 *   - tsup puts the doctor's code in a CHUNK at `dist/doctor-<hash>.js`, so
 *     `import.meta.dirname` is `<pkg>/dist` and `../..` is the PARENT of the
 *     package. Measured, not argued: `bin/bb doctor` from a compiled build
 *     searched `<parent>/node_modules/.bin/tsx` and `<parent>/src/ast` — one
 *     level above the checkout, where nothing exists. Every path the module
 *     touches was wrong and the output said so.
 *   - the same walk put `createRequire(path.join(ROOT_PKG, "package.json"))`
 *     (src/setup/doctor.ts) outside the package, so better-sqlite3 failed to
 *     resolve and `readStoredModels` quietly returned `[]` — doctor's
 *     model-consistency check, dead in every published install and invisible
 *     because the catch swallows it.
 *
 * One package.json lookup, from any of those layouts, and it is right.
 */
export function findPackageRoot(fromDir: string, exists: (p: string) => boolean = existsSync): string | null {
  let dir = path.resolve(fromDir)
  for (let i = 0; i <= MAX_ROOT_WALK; i++) {
    try {
      if (exists(path.join(dir, "package.json"))) return dir
    } catch {
      // Unreadable directory: keep walking.
    }
    const parent = path.dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
  return null
}

/**
 * Is this `execPath` a Node? The original check was
 * `execPath.endsWith("node") || execPath.endsWith("node.exe")`, which is FALSE
 * for `/usr/local/bin/node22`, `/opt/homebrew/opt/node@20/bin/node-abi-stable`
 * and every Windows `nodejs.exe`, and sent all of those down the Bun branch —
 * forking a `.ts` file with a Node that cannot parse TypeScript. The crash is
 * immediate and legible, but it happens on every single index run.
 *
 * `path.basename` is not enough on its own: on POSIX it does not treat `\` as a
 * separator, so a Windows path arriving in a POSIX test (or in a WSL-side
 * diagnosis) has to be split by hand or every `node.exe` looks like a filename.
 */
function looksLikeNode(execPath: string): boolean {
  const base = execPath.split(/[\\/]/).pop()!.toLowerCase().replace(/\.(exe|cmd|bat)$/, "")
  return /^node(js)?\d*(\.\d+)*$/.test(base)
}

function looksLikeBun(execPath: string): boolean {
  return execPath.split(/[\\/]/).pop()!.toLowerCase().includes("bun")
}

/**
 * Resolve the fork target for a pool worker, or explain why there isn't one.
 *
 * Same rules as `resolvePoolWorkerFork()` (parallel-indexer.ts:1208) — compiled
 * dist forks `pool-worker.js`, Node-from-source forks tsx plus the `.ts`
 * entry, Bun forks the entry directly — with three differences, all of them
 * about what happens when a rule cannot be satisfied:
 *
 *   1. it never returns `workerPath: null`, so `fork()` can never be handed
 *      one and throw a TypeError the caller then swallows;
 *   2. an unrecognised `execPath` is a diagnosis instead of a silent guess
 *      that the runtime is Bun;
 *   3. `BB_POOL_WORKER` is honoured as an opt-out (see below).
 */
export function resolvePoolWorkerForkSafe(deps: PoolResolverDeps = {}): PoolForkResolution {
  const env = deps.env ?? process.env
  const execPath = deps.execPath ?? process.execPath
  const exists = deps.exists ?? existsSync
  const moduleDir = deps.moduleDir ?? path.dirname(fileURLToPath(import.meta.url))
  const baseDetail = {
    execPath,
    nodeVersion: deps.version ?? process.version,
    moduleDir,
  }

  // The opt-out. `BB_POOL_WORKER=1` is what the parent hands its children;
  // nothing read the other values, which made `BB_POOL_WORKER=0` look like a
  // supported "force in-process" switch. It is not — see
  // `worker-exited-silently` for what it actually did: the child skipped the
  // keep-alive, exited 0 without sending `ready`, and the fork probe then hung
  // for its full 60 s timeout before reporting a failure that named nothing.
  const requested = (env.BB_POOL_WORKER ?? "").trim().toLowerCase()
  if (DISABLED_VALUES.has(requested)) {
    return fail(
      "pool-disabled-by-env",
      `pool disabled by BB_POOL_WORKER=${env.BB_POOL_WORKER} (in-process indexing will be used)`,
      { ...baseDetail, workerArgs: [env.BB_POOL_WORKER ?? ""] },
    )
  }

  // The package root, not "two levels up". `../..` is right for exactly one
  // layout (the unbundled `src/ast`) and wrong for every other — see
  // findPackageRoot. When no package.json is in reach (an injected test root,
  // a vendored copy) the old arithmetic is the fallback, so nothing that used to
  // resolve stops resolving.
  const walked = findPackageRoot(moduleDir, exists)
  const projectRoot = walked ?? path.resolve(moduleDir, "../..")
  const isCompiled =
    (moduleDir.endsWith(`${path.sep}dist`) || moduleDir.includes(`${path.sep}dist${path.sep}`)) &&
    !moduleDir.includes(`${path.sep}src${path.sep}`)

  if (isCompiled) {
    // `pool-worker.js` is a tsup ENTRY, so it lands at the top of dist/ — but
    // the CALLER may not: the bundle can be `dist/cli/index.js` or a chunk at
    // `dist/chunk-<hash>.js`, and the caller's own directory is not where the
    // worker is. Search upward a bounded number of levels instead of assuming a
    // sibling, and report every path tried when it is not there.
    const candidates: string[] = []
    let dir = moduleDir
    for (let i = 0; i <= MAX_ROOT_WALK; i++) {
      candidates.push(path.join(dir, "pool-worker.js"))
      const parent = path.dirname(dir)
      if (parent === dir) break
      dir = parent
    }
    if (walked) candidates.push(path.join(walked, "dist", "pool-worker.js"))

    const workerPath = candidates.find((p) => exists(p))
    if (!workerPath) {
      // Compiled layout selected but the entry is not on disk: a partial build,
      // or an install whose `files` list dropped dist/. The original resolver
      // returned the path unconditionally, so fork() raised ENOENT and the caller
      // reported "worker pool unavailable (spawn ENOENT)" — naming neither.
      return fail("worker-entry-missing", `compiled worker entry is missing (tried ${candidates.length} locations)`, {
        ...baseDetail,
        projectRoot,
        workerPath: candidates[0],
        searchedPaths: candidates,
      })
    }
    return { ok: true, workerPath, workerArgs: [], source: "compiled-dist", projectRoot }
  }

  const workerEntry = path.join(projectRoot, WORKER_ENTRY_RELATIVE)

  if (looksLikeNode(execPath)) {
    const localTsx = path.join(projectRoot, "node_modules", ".bin", "tsx")
    const localTsxExists = exists(localTsx)
    const tsxPath = localTsxExists ? localTsx : findOnPath("tsx", env, exists)
    if (!tsxPath) {
      return fail(
        "tsx-missing",
        `tsx not found: no \`tsx\` in ${localTsx} and none on PATH — the dev worker cannot be started`,
        {
          ...baseDetail,
          projectRoot,
          workerPath: workerEntry,
          searchedPaths: [localTsx, "$PATH"],
          errorMessage: exists(localTsx) ? "tsx present on PATH but unusable" : undefined,
        },
      )
    }
    // Present but not a runnable file is a DIFFERENT failure with a different
    // fix (permissions), and only a fork can tell. Flagged here cheaply: an
    // entry that exists and is not executable is broken, not merely odd.
    return {
      ok: true,
      workerPath: tsxPath,
      workerArgs: [workerEntry],
      source: localTsxExists ? "tsx-local" : "tsx-path",
      projectRoot,
    }
  }

  if (looksLikeBun(execPath)) {
    return { ok: true, workerPath: workerEntry, workerArgs: [], source: "bun-native", projectRoot }
  }

  // Neither Node nor Bun. The original code assumed Bun and forked the `.ts`
  // entry with this executable, which either crashed on TypeScript syntax or
  // — if the runtime happens to accept it — ran a worker the parent never
  // configured. Answering "I don't know" costs an in-process index; guessing
  // wrong costs the same index plus an unexplainable failure.
  return fail(
    "runtime-unsupported",
    `cannot fork a worker under \`${execPath}\`: expected a Node or a Bun executable`,
    { ...baseDetail, projectRoot, workerPath: workerEntry, searchedPaths: [localTsxPath(projectRoot)] },
  )
}

function localTsxPath(projectRoot: string): string {
  return path.join(projectRoot, "node_modules", ".bin", "tsx")
}

// ── the error the resolver throws ───────────────────────────────────────────

/**
 * Thrown where a null `workerPath` used to be passed to `fork()`.
 *
 * Its `message` is the DIAGNOSIS, not a label, because the caller's existing
 * `catch` interpolates `e?.message` into the user-facing warning. That means
 * wiring the resolver in at parallel-indexer.ts:4541 is enough to make the
 * failure name its cause and its fix — no edit to the catch required.
 */
export class PoolUnavailableError extends Error {
  readonly resolution: PoolForkFailure
  constructor(resolution: PoolForkFailure) {
    super(renderPoolDiagnosis(resolution))
    this.name = "PoolUnavailableError"
    this.resolution = resolution
  }
}

// ── stderr classification ───────────────────────────────────────────────────

/** Named causes a crashing worker can be attributed to. */
export type StderrCause =
  | "native-abi-mismatch"
  | "native-platform-mismatch"
  | "missing-module"
  | "typescript-source-run-as-js"
  | "permission-denied"
  | "out-of-memory"
  | "openssl-legacy-provider"
  | "tsx-loader-crash"
  | "unclassified"

export interface StderrExplanation {
  /** Machine-ish cause name, for logs and for `doctor` finding ids. */
  cause: StderrCause
  /** One line naming what happened. */
  summary: string
  /** Commands that fix THIS cause. */
  remediation: string[]
}

/**
 * Name the cause a crashing worker explains itself with.
 *
 * This is the distinction the resolver cannot make: "tsx is missing" and "tsx
 * ran and died" have opposite fixes (install tsx / fix the install), and both
 * reach the parent as the same one-line warning today.
 *
 * Exported and pure so the mapping can be asserted directly, without forking
 * anything.
 */
export function explainWorkerStderr(stderr: string): StderrExplanation {
  const s = stderr || ""
  const rebuildNative = [
    "The native module was built for a different Node ABI or platform. Rebuild it here:",
    "  `npm rebuild better-sqlite3 --build-from-source`",
    "or reinstall from scratch: `rm -rf node_modules && npm install --include=dev`",
  ]

  if (/NODE_MODULE_VERSION|was compiled against a different Node\.js version/i.test(s)) {
    return {
      cause: "native-abi-mismatch",
      summary: "a native module was compiled against a different Node.js version",
      remediation: rebuildNative,
    }
  }
  if (/ERR_DLOPEN_FAILED|invalid ELF header|wrong architecture|mach-o file, but this architecture|is not a valid Win32 application/i.test(s)) {
    return {
      cause: "native-platform-mismatch",
      summary: "a native module was built for another platform or architecture",
      remediation: [
        "This node_modules came from another machine/container. Reinstall here:",
        "  `rm -rf node_modules && npm install --include=dev`",
      ],
    }
  }
  if (/ERR_MODULE_NOT_FOUND|Cannot find module|Cannot find package '|Failed to resolve module|Cannot find module '\.\//i.test(s)) {
    return {
      cause: "missing-module",
      summary: "a module in the worker's import graph is not installed",
      remediation: [
        "The worker entry exists but one of its imports does not — a partial install.",
        "  `rm -rf node_modules && npm install --include=dev`",
      ],
    }
  }
  if (/SyntaxError: Unexpected token|Cannot use import statement outside a module|Unexpected token 'export'|unknown file extension \.ts/i.test(s)) {
    return {
      cause: "typescript-source-run-as-js",
      summary: "TypeScript source was executed by a runtime that cannot load it (tsx did not apply)",
      remediation: [
        "tsx resolved but did not run: the `tsx` on PATH is a shim or a different tool.",
        "Prefer the local one: `npm install --include=dev` (creates node_modules/.bin/tsx)",
        "Or run the compiled build, which needs no loader: `npm run build && node dist/cli/index.js index .`",
      ],
    }
  }
  if (/EACCES|Permission denied/i.test(s)) {
    return {
      cause: "permission-denied",
      summary: "the resolved worker/tsx file is not executable",
      remediation: [
        "`chmod +x node_modules/.bin/tsx`",
        "or reinstall: `rm -rf node_modules && npm install --include=dev`",
      ],
    }
  }
  if (/ENOMEM|Reached heap limit|heap out of memory|Allocation failed - JavaScript/i.test(s)) {
    return {
      cause: "out-of-memory",
      summary: "the worker ran out of memory during startup",
      remediation: [
        "Raise the heap the worker is allowed: `NODE_OPTIONS=--max-old-space-size=4096`",
        "Fewer workers also helps: lower bb's concurrency or run with fewer cores visible.",
      ],
    }
  }
  if (/ERR_OSSL_EVP_UNSUPPORTED|error:0308010C:digital envelope routines::unsupported|digital envelope routines/i.test(s)) {
    return {
      cause: "openssl-legacy-provider",
      summary: "an OpenSSL 3 / legacy digest incompatibility (old dependency on a modern Node)",
      remediation: [
        "Update the offending dependency, or run bb on Node 18 LTS where it still works.",
        "For webpack-era tools only: `NODE_OPTIONS=--openssl-legacy-provider`",
      ],
    }
  }
  if (/tsx|ts-node|esbuild/i.test(s) && /throw|error/i.test(s)) {
    return {
      cause: "tsx-loader-crash",
      summary: "the tsx loader itself failed while starting the worker",
      remediation: [
        "tsx is installed but broken. Reinstall it:",
        "  `npm install --include=dev tsx`",
        "Check the loader version: `node_modules/.bin/tsx --version`",
      ],
    }
  }
  return {
    cause: "unclassified",
    summary: "the worker failed to start for an unrecognised reason",
    remediation: [
      "Re-run with the child's own output:",
      "  `BB_LOG_LEVEL=debug BB_POOL_WORKER=1 node_modules/.bin/tsx src/ast/pool-worker.ts`",
      "and report the stack above if it persists.",
    ],
  }
}

/** Max bytes of child output kept per stream. A crash stack is the whole value. */
const CAPTURE_TAIL_BYTES = 8 * 1024

export interface WorkerOutputCapture {
  readonly stdout: string
  readonly stderr: string
  /**
   * Last N non-empty LINES of stderr, oldest first.
   *
   * Lines, not bytes, because a stack trace is worthless cut mid-line and
   * worth a lot intact: "Error: invalid ELF header" tells the reader to
   * reinstall node_modules, while the same bytes sliced at an arbitrary offset
   * can be an empty fragment that explains nothing. This is what the failure
   * path quotes.
   */
  stderrLines(): string[]
  /** True when the cap discarded something, so the report can say "last N lines". */
  readonly stderrTruncated: boolean
  /** Detach listeners and destroy the pipes. Always call this. */
  stop(): void
}

export interface WorkerOutputCaptureOptions {
  /**
   * Echo every line to the parent's stderr as it arrives. OFF by default, and
   * that default is load-bearing: a pool of N workers writing routine INFO
   * logging turns into a wall of text that buries the progress line, which is
   * what the previous unconditional relay did. Diagnostics are not logs — they
   * are surfaced by `explainWorkerStartupFailure` on the failure path only.
   */
  echo?: string
  /** Lines of each stream retained. Default 20. */
  lineLimit?: number
  /** Bytes retained per stream, hard ceiling. Default 8 KB. */
  byteLimit?: number
}

export const DEFAULT_CAPTURE_LINES = 20

/**
 * Read a forked child's stdout/stderr, keeping a bounded tail and echoing
 * nothing by default.
 *
 * `stdio: ["ignore","pipe","pipe","ipc"]` gives the parent a PIPE it must
 * drain, at every fork site: parallel-indexer.ts:1598 (the pool, where it now
 * drains via a gated relay) and :4648 (the fork probe, where NOTHING reads it).
 * Two consequences, and the second is the one that bites:
 *
 *   1. a worker that dies on load says nothing, so the only evidence available
 *      — its own error — is thrown away;
 *   2. a child that writes more than the pipe buffer (~64 KB) BLOCKS forever
 *      waiting for a reader that never comes.
 *
 * So: always drain, retain a bounded tail, and echo only on request. The tail
 * is what `explainWorkerStartupFailure` quotes; `echo` is opt-in so routine
 * logging still cannot flood a terminal.
 */
export function attachWorkerOutputCapture(
  child: ChildProcess,
  options: WorkerOutputCaptureOptions | string = {},
): WorkerOutputCapture {
  // Accept the older `(child, prefix)` shape so an existing call site keeps
  // working: a bare string is a prefix, i.e. "echo with this tag".
  const opts: WorkerOutputCaptureOptions = typeof options === "string" ? { echo: options } : options
  const echo = opts.echo ?? ""
  const lineLimit = Math.max(1, opts.lineLimit ?? DEFAULT_CAPTURE_LINES)
  const byteLimit = Math.max(256, opts.byteLimit ?? CAPTURE_TAIL_BYTES)

  let out = ""
  let err = ""
  let errTruncated = false

  /** Append, cap by bytes, and remember that a cap discarded something. */
  const keep = (acc: string, chunk: Buffer, isErr: boolean): string => {
    const next = acc + chunk.toString()
    if (next.length <= byteLimit) return next
    if (isErr) errTruncated = true
    return next.slice(-byteLimit)
  }

  const onOut = (d: Buffer) => {
    out = keep(out, d, false)
    if (echo) process.stderr.write(`${echo}${d.toString()}`)
  }
  const onErr = (d: Buffer) => {
    err = keep(err, d, true)
    if (echo) process.stderr.write(`${echo}${d.toString()}`)
  }

  child.stdout?.on("data", onOut)
  child.stderr?.on("data", onErr)

  return {
    get stdout() {
      return out
    },
    get stderr() {
      return err
    },
    get stderrTruncated() {
      return errTruncated
    },
    stderrLines() {
      return err
        .split("\n")
        .map((l) => l.trimEnd())
        .filter((l) => l.trim().length > 0)
        .slice(-lineLimit)
    },
    stop() {
      child.stdout?.off("data", onOut)
      child.stderr?.off("data", onErr)
    },
  }
}

/** The bounded stderr tail, as the block of lines a failure report quotes. */
export function stderrTailLines(capture: WorkerOutputCapture | undefined, limit = DEFAULT_CAPTURE_LINES): string[] {
  if (!capture) return []
  const lines = capture.stderrLines().slice(-limit)
  return lines
}

// ── synchronous probe (what `bb doctor` can afford) ─────────────────────────

/** Env that turns the worker entry into a one-shot startup self-test. */
export const SELFTEST_ENV = "BB_POOL_WORKER_SELFTEST"
/** Marker the self-test prints on stdout, one line of JSON. */
export const SELFTEST_MARKER = "[BB-WORKER-SELFTEST]"

/** What the worker's self-test reports about itself. */
export interface PoolWorkerSelfTestReport {
  ok: boolean
  engine: "ok" | "unavailable"
  wasm: "ok" | "unavailable"
  node: string
  pid: number
  execPath: string
  /** The startup problems found, in the order found. */
  diagnostics: string[]
}

export interface PoolSyncProbeOk extends PoolForkOk {
  ms: number
  report: PoolWorkerSelfTestReport
  stderrTail: string
}

export type PoolSyncProbeResult = PoolSyncProbeOk | PoolForkFailure

export interface PoolSyncProbeOptions {
  /** Hard ceiling. Default 30s — a cold tsx boot is seconds, not minutes. */
  timeoutMs?: number
  env?: NodeJS.ProcessEnv
}

/**
 * Start the worker ONCE, synchronously, and read what it says about itself.
 *
 * WHY THIS EXISTS SEPARATELY FROM `probePoolWorker`. `bb doctor` is called from
 * a SYNC function — `runDoctorChecks` in src/setup/doctor.ts is not async, and
 * src/cli/index.ts (which this work may not edit) calls it without `await`, so
 * making it async would hand the CLI a Promise and break `report.healthy`.
 * A probe that has to await an IPC handshake cannot run there at all.
 *
 * So this one does not handshake. It runs the worker's SELF-TEST mode
 * (`BB_POOL_WORKER_SELFTEST=1`, implemented in pool-worker.ts), which performs
 * the same startup work the handshake triggers — the wasm registry and the AST
 * engine — and prints one machine-readable line. That covers the two failures
 * that matter most and that resolution alone cannot see:
 *
 *   - the worker's own module graph fails to LOAD (a native module built for
 *     another platform, a module that is not installed): non-zero exit, and the
 *     error is on stderr for `explainWorkerStderr` to classify;
 *   - the engine or the wasm registry fails to load: the worker starts but is
 *     DEGRADED, and says so in the report instead of silently regex-parsing
 *     every file.
 *
 * What it cannot cover: the IPC handshake itself, and a worker that boots and
 * then wedges. `probePoolWorker` covers those and should be used wherever an
 * async caller is available.
 *
 * The child is spawned the way the pool spawns it — under `process.execPath`,
 * with the same target and args — so the verdict matches the indexer's, rather
 * than testing something the indexer never runs.
 */
export function probePoolWorkerSync(
  resolution: PoolForkResolution,
  opts: PoolSyncProbeOptions = {},
): PoolSyncProbeResult {
  if (!resolution.ok) return resolution
  const env = opts.env ?? process.env
  const timeoutMs = opts.timeoutMs ?? 30_000
  const startedAt = Date.now()

  let res: ReturnType<typeof spawnSync>
  try {
    res = spawnSync(
      process.execPath,
      [resolution.workerPath, ...resolution.workerArgs],
      {
        env: { ...env, [SELFTEST_ENV]: "1" },
        encoding: "utf8",
        timeout: timeoutMs,
        killSignal: "SIGKILL",
        maxBuffer: 4 * 1024 * 1024,
        windowsHide: true,
      },
    )
  } catch (e: any) {
    // spawnSync throws only on a malformed invocation, but a diagnostic that
    // throws is worse than one that reports nothing.
    return fail("fork-unavailable", `could not start a worker self-test: ${e?.message ?? String(e)}`, {
      workerPath: resolution.workerPath,
      workerArgs: resolution.workerArgs,
      errorMessage: String(e?.message ?? e),
    })
  }

  const ms = Date.now() - startedAt
  const stdout = typeof res.stdout === "string" ? res.stdout : ""
  const stderr = typeof res.stderr === "string" ? res.stderr : ""
  const stderrTail = stderr
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l.trim().length > 0)
    .slice(-DEFAULT_CAPTURE_LINES)
    .join("\n")

  // Timed out: the process was killed before it could finish starting.
  if (res.error && (res.error as any).code === "ETIMEDOUT") {
    const explained = stderrTail ? explainWorkerStderr(stderrTail) : null
    const attributed = explained && explained.cause !== "unclassified" ? explained : null
    return fail(
      attributed ? "worker-load-crash" : "worker-startup-timeout",
      attributed
        ? `worker self-test did not finish: ${attributed.summary}`
        : `worker self-test did not finish within ${timeoutMs}ms`,
      {
        workerPath: resolution.workerPath,
        workerArgs: resolution.workerArgs,
        timeoutMs,
        stderrTail: stderrTail || undefined,
        ...(attributed ? { cause: attributed.cause, causeRemediation: attributed.remediation } : {}),
      },
    )
  }

  const markerLine = stdout.split("\n").find((l) => l.startsWith(SELFTEST_MARKER))
  if (markerLine) {
    let report: PoolWorkerSelfTestReport | null = null
    try {
      report = JSON.parse(markerLine.slice(SELFTEST_MARKER.length).trim())
    } catch {
      report = null
    }
    if (report) {
      // A DEGRADED worker is not an unavailable pool: it indexes, it is just
      // thinner. The caller decides severity; this keeps the distinction.
      return { ...resolution, ms, report, stderrTail }
    }
  }

  // No marker. Either the worker predates the self-test, or it died before
  // printing one. Both are answerable, and answering them differently is the
  // point: an old build must not be reported as a broken pool.
  if (res.status === 0 && !stderrTail) {
    return fail(
      "worker-selftest-unsupported",
      "the installed worker did not run bb's startup self-test (it predates it)",
      { workerPath: resolution.workerPath, workerArgs: resolution.workerArgs, exitCode: 0 },
    )
  }
  const explained = stderrTail ? explainWorkerStderr(stderrTail) : null
  const attributed = explained && explained.cause !== "unclassified" ? explained : null
  return fail(
    attributed ? "worker-load-crash" : "worker-exit-nonzero",
    attributed
      ? `the worker failed to start: ${attributed.summary}`
      : `the worker exited with code ${res.status ?? "null"} before reporting a startup result`,
    {
      workerPath: resolution.workerPath,
      workerArgs: resolution.workerArgs,
      exitCode: res.status ?? null,
      signal: res.signal ?? null,
      stderrTail: stderrTail || undefined,
      ...(attributed ? { cause: attributed.cause, causeRemediation: attributed.remediation } : {}),
    },
  )
}

// ── handshake probe ─────────────────────────────────────────────────────────

export interface PoolProbeOptions {
  /** Override the deadline. Defaults to `BB_WORKER_STARTUP_TIMEOUT_MS`. */
  timeoutMs?: number
  env?: NodeJS.ProcessEnv
  /** Hard ceiling on the whole probe regardless of `timeoutMs`. */
  hardTimeoutMs?: number
}

export interface PoolProbeOk extends PoolForkOk {
  readyMs: number
  stderrTail: string
  stdoutTail: string
  /**
   * The `ready` message as received. pool-worker.ts reports `engine`, `wasm`,
   * `node`, `pid` and any startup `diagnostics` there, so a worker that starts
   * but is DEGRADED (engine not loaded — every file silently parsed by regex)
   * is distinguishable from a healthy one. Extra fields are additive; the
   * parent branches on `type` only.
   */
  ready?: Record<string, unknown>
}

export type PoolProbeResult = PoolProbeOk | PoolForkFailure

/**
 * Fork the resolved target once, send `warmup`, and classify the outcome.
 *
 * This is the second stage the resolver cannot be: only a real fork
 * distinguishes "tsx is missing" from "tsx ran and crashed loading the
 * worker", and only a real handshake distinguishes "crashed" from "hung".
 *
 * The child is always killed and its pipes always released, including on the
 * throw paths, so a probe can never leave a process or a timer behind in the
 * parent — which is what makes it safe for `bb doctor` to call.
 */
export function probePoolWorker(
  resolution: PoolForkResolution,
  opts: PoolProbeOptions = {},
): Promise<PoolProbeResult> {
  if (!resolution.ok) return Promise.resolve(resolution)

  const env = opts.env ?? process.env
  const timeoutMs = opts.timeoutMs ?? poolStartupTimeoutMs(env)
  const hardTimeoutMs = opts.hardTimeoutMs ?? Math.max(timeoutMs * 2, 10_000)
  const startedAt = Date.now()
  const common: PoolForkFailure["detail"] = {
    workerPath: resolution.workerPath,
    workerArgs: resolution.workerArgs,
    execPath: process.execPath,
    nodeVersion: process.version,
    projectRoot: resolution.projectRoot,
    timeoutMs,
  }

  return new Promise<PoolProbeResult>((resolve) => {
    let child: ChildProcess
    try {
      child = forkChild(resolution.workerPath, resolution.workerArgs, {
        env: { ...env, BB_POOL_WORKER: "1" },
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      })
    } catch (e: any) {
      // The failure the original code hit: fork() rejecting its arguments.
      resolve(
        fail("fork-unavailable", `fork() refused the resolved worker target: ${e?.message ?? String(e)}`, {
          ...common,
          errorMessage: String(e?.message ?? e),
        }),
      )
      return
    }

    const capture = attachWorkerOutputCapture(child)
    let settled = false
    let hardTimer: ReturnType<typeof setTimeout> | undefined

    const finish = (r: PoolProbeResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (hardTimer) clearTimeout(hardTimer)
      capture.stop()
      try {
        child.removeAllListeners()
        child.stdout?.destroy()
        child.stderr?.destroy()
        child.kill("SIGKILL")
      } catch {
        // Already gone.
      }
      resolve(r)
    }

    const timer = setTimeout(() => {
      const stderrTail = capture.stderr.trim()
      // A child that is silent and still alive after the full watchdog is a
      // different problem from one that printed a stack. Only the second has
      // an attributable cause.
      const explained = stderrTail ? explainWorkerStderr(stderrTail) : null
      const attributable = explained && explained.cause !== "unclassified" ? explained : null
      const detail: PoolForkFailure["detail"] = {
        ...common,
        stderrTail: stderrTail || undefined,
        ...(attributable ? { cause: attributable.cause, causeRemediation: attributable.remediation } : {}),
      }
      finish(
        fail(
          attributable ? "worker-load-crash" : "worker-startup-timeout",
          attributable
            ? `worker loaded tsx but could not finish starting: ${attributable.summary}`
            : `worker sent no ready handshake within ${timeoutMs}ms`,
          detail,
        ),
      )
    }, timeoutMs)

    hardTimer = setTimeout(() => {
      finish(
        fail("worker-startup-timeout", `worker handshake did not complete within ${hardTimeoutMs}ms`, {
          ...common,
          timeoutMs: hardTimeoutMs,
          stderrTail: capture.stderr.trim() || undefined,
        }),
      )
    }, hardTimeoutMs)

    child.on("error", (err: Error) => {
      finish(
        fail("fork-unavailable", `worker process error: ${err.message}`, {
          ...common,
          errorMessage: err.message,
          stderrTail: capture.stderr.trim() || undefined,
        }),
      )
    })

    child.on("exit", (code, signal) => {
      // Classify on `close`, not here. Node does NOT promise that a child's piped
      // stdout/stderr has been delivered by the time `exit` fires — and the class
      // of failure this exists for is the one whose ENTIRE diagnosis is its
      // stderr, so "probably delivered" is not good enough.
      //
      // Measured honestly: 25 identical crashing children in this environment
      // delivered their stderr BEFORE `exit` every time, and an earlier revision
      // of this file (classifying at `exit`) also produced complete stderr. So
      // this is NOT a bug reproduced here — it is an ordering the docs leave
      // open, and `close` is the only event guaranteed to follow the stdio
      // drain. The grace timer below stops it becoming a hang when a grandchild
      // still holds the write end.
      const classify = () => {
        if (settled) return
        const stderrTail = capture.stderr.trim()
        if (code === 0) {
          // Exited cleanly, never said `ready`. See `worker-exited-silently`:
          // this is what an inherited BB_POOL_WORKER=0 looks like from outside.
          finish(
            fail(
              "worker-exited-silently",
              "worker exited with code 0 without sending `ready` — it never entered worker mode",
              { ...common, exitCode: code, signal, stderrTail: stderrTail || undefined },
            ),
          )
          return
        }
        const explained = stderrTail ? explainWorkerStderr(stderrTail) : null
        const detail = {
          ...common,
          exitCode: code,
          signal,
          stderrTail: stderrTail || undefined,
          ...(explained && explained.cause !== "unclassified"
            ? { cause: explained.cause, causeRemediation: explained.remediation }
            : {}),
        }
        finish(
          fail(
            "worker-load-crash",
            explained
              ? `worker crashed before ready: ${explained.summary}`
              : `worker exited with code ${code}${signal ? ` (signal ${signal})` : ""} before ready`,
            detail,
          ),
        )
      }

      // `close` follows `exit` once the pipes are closed. The grace timer is
      // the safety net for a child that exits while a grandchild still holds
      // the write end — in that case `close` may never come, and a probe that
      // hangs is worse than one that reports slightly early.
      let grace: ReturnType<typeof setTimeout> | undefined = setTimeout(classify, 500)
      child.once("close", () => {
        if (grace) clearTimeout(grace)
        grace = undefined
        classify()
      })
    })

    child.on("message", (msg: any) => {
      if (msg?.type !== "ready") return
      finish({
        ok: true,
        workerPath: resolution.workerPath,
        workerArgs: resolution.workerArgs,
        source: resolution.source,
        projectRoot: resolution.projectRoot,
        readyMs: Date.now() - startedAt,
        stderrTail: capture.stderr.trim(),
        stdoutTail: capture.stdout.trim(),
        ready: typeof msg === "object" && msg !== null ? (msg as Record<string, unknown>) : undefined,
      })
    })

    // Sent immediately, exactly as the production call site does. Node buffers
    // IPC messages that arrive before the child's `process.on("message")` is
    // registered, so an early send is not a race — measured, not assumed
    // (script/verify-pool-workers.ts, "warmup is not lost").
    try {
      child.send({ type: "warmup", workerId: 0 })
    } catch (e: any) {
      finish(
        fail("fork-unavailable", `could not send warmup to the worker: ${e?.message ?? String(e)}`, {
          ...common,
          errorMessage: String(e?.message ?? e),
          stderrTail: capture.stderr.trim() || undefined,
        }),
      )
    }
  })
}

// ── rendering ───────────────────────────────────────────────────────────────

/** Single line. For `log.warn` and for the indexer's own warning. */
export function poolFailureLine(f: PoolForkFailure): string {
  const first = (f.remediation[0] ?? "").split("\n")[0]
  return `worker pool unavailable [${f.reason}]: ${f.message} — fix: ${first}`
}

/**
 * Full, multi-line diagnosis: what is wrong, the evidence, and every fix.
 *
 * Also the `message` of `PoolUnavailableError`, which is why it is written to
 * read correctly when it is interpolated into somebody else's warning line.
 */
export function renderPoolDiagnosis(r: PoolForkResolution): string {
  if (r.ok) {
    return `worker pool available: fork ${r.workerPath}${r.workerArgs.length ? " " + r.workerArgs.join(" ") : ""} (via ${r.source})`
  }
  const lines: string[] = []
  lines.push(`worker pool unavailable [${r.reason}]: ${r.message}`)

  const d = r.detail
  const evidence: string[] = []
  if (d.execPath) evidence.push(`runtime: ${d.execPath}${d.nodeVersion ? ` (${d.nodeVersion})` : ""}`)
  if (d.projectRoot) evidence.push(`root: ${d.projectRoot}`)
  if (d.searchedPaths?.length) evidence.push(`looked in: ${d.searchedPaths.join(", ")}`)
  if (d.workerPath) evidence.push(`worker: ${d.workerPath}${d.workerArgs?.length ? " " + d.workerArgs.join(" ") : ""}`)
  if (d.exitCode !== undefined) evidence.push(`exit: code=${d.exitCode}${d.signal ? ` signal=${d.signal}` : ""}`)
  if (d.timeoutMs !== undefined) evidence.push(`timeout: ${d.timeoutMs}ms`)
  if (evidence.length) lines.push("  " + evidence.join("\n  "))

  lines.push("  fix:")
  r.remediation.forEach((fix, i) => {
    // One array entry is one fix, however many lines it prints as. Numbering
    // the continuation lines instead made the output read `1. … 4. … 5. …`.
    const [first, ...rest] = fix.split("\n")
    lines.push(`    ${i + 1}. ${first.trim()}`)
    for (const cont of rest) lines.push(cont.trim() ? `       ${cont.trim()}` : "")
  })
  return lines.join("\n")
}

// ── bb doctor shape ─────────────────────────────────────────────────────────

/**
 * Structurally compatible with `Finding` in src/setup/doctor.ts
 * (`{ id, severity, message, fix }`). It is declared here rather than imported
 * so this module stays free of setup/embedding imports — `bb doctor` must be
 * able to diagnose a pool that cannot load the engine.
 */
export interface PoolFinding {
  id: string
  severity: "fail" | "warn" | "info"
  message: string
  fix?: string
}

export interface PoolStartupReport {
  /** True when the pool can start. `bb doctor` should exit non-zero when false. */
  ok: boolean
  /** What the resolver decided, without forking anything. */
  resolution: PoolForkResolution
  /** Present only when the probe actually ran. */
  probe?: PoolProbeResult
  findings: PoolFinding[]
}

/**
 * Resolve, then (optionally) prove.
 *
 * `probe: false` is the cheap form: it answers "could a worker even be
 * started, and if not why" without spending a fork. `probe: true` answers the
 * question users actually ask — "why aren't my pool workers starting?" — by
 * reproducing it.
 */
export async function diagnosePoolStartup(
  opts: PoolResolverDeps & { probe?: boolean; probeTimeoutMs?: number; env?: NodeJS.ProcessEnv } = {},
): Promise<PoolStartupReport> {
  const { probe: doProbe = true, probeTimeoutMs, ...resolverDeps } = opts
  const resolution = resolvePoolWorkerForkSafe(resolverDeps)
  const findings: PoolFinding[] = []

  if (!resolution.ok) {
    findings.push({
      id: `pool-${resolution.reason}`,
      severity: resolution.reason === "pool-disabled-by-env" ? "info" : "fail",
      message: renderPoolDiagnosis(resolution),
      fix: resolution.remediation[0],
    })
    return { ok: false, resolution, findings }
  }

  findings.push({
    id: "pool-target",
    severity: "info",
    message: `Worker fork target resolved: ${resolution.workerPath}${
      resolution.workerArgs.length ? " " + resolution.workerArgs.join(" ") : ""
    } (via ${resolution.source}).`,
  })

  if (!doProbe) return { ok: true, resolution, findings }

  const probe = await probePoolWorker(resolution, {
    timeoutMs: probeTimeoutMs ?? poolStartupTimeoutMs(resolverDeps.env ?? process.env),
  })
  if (!probe.ok) {
    findings.push({
      id: `pool-${probe.reason}`,
      severity: "fail",
      message: renderPoolDiagnosis(probe),
      fix: probe.remediation[0],
    })
    return { ok: false, resolution, probe, findings }
  }

  findings.push({
    id: "pool-ready",
    severity: "info",
    message: `A forked worker signalled ready in ${probe.readyMs}ms.`,
  })
  // A worker can be "ready" and still be parsing every file with regex. That
  // is not a pool failure — it indexes, and reports success — but it is the
  // difference between a full symbol count and a thin one, and until now
  // nothing reported it anywhere.
  const ready = probe.ready ?? {}
  if (ready.engine === "unavailable") {
    findings.push({
      id: "pool-engine-unavailable",
      // WARN, not fail. The pool DID start and files DO get indexed — through
      // regex extraction, which yields fewer symbols. So the pool is degraded,
      // not broken, and a doctor exiting 1 here would report an outage where the
      // product is quietly returning a thinner index. The message says that in
      // as many words, because "degraded" is the entire point of it.
      severity: "warn",
      message:
        "A worker started but could not load the AST engine, so every file it parses falls back to " +
        "regex extraction (fewer symbols, still reported as indexed).\n" +
        `  worker said: ${Array.isArray(ready.diagnostics) ? ready.diagnostics.join(" | ") : "(no detail)"}`,
      fix: "npm rebuild --build-from-source && rm -rf node_modules && npm install --include=dev",
    })
  }
  if (ready.wasm === "unavailable") {
    findings.push({
      id: "pool-wasm-unavailable",
      severity: "warn",
      message:
        "A worker started but the tree-sitter wasm registry did not load. Grammar-based parsing " +
        "(the accurate path) is unavailable; files still index through the fallback.",
      fix: "Check that wasm/*.wasm shipped with your install: `ls wasm | head`",
    })
  }
  if (probe.stderrTail) {
    // The child talked while starting. Not a failure, but the only place its
    // own diagnostics surface, so they are surfaced rather than dropped.
    findings.push({
      id: "pool-worker-stderr",
      severity: "info",
      message: `The worker wrote to stderr during startup:\n${probe.stderrTail}`,
    })
  }
return { ok: true, resolution, probe, findings }
}

// ── the synchronous form, for `bb doctor` ───────────────────────────────────

/**
 * Four states, because "workers don't start" and "workers started but are
 * quietly worse" are different problems with different fixes:
 *
 *   - `disabled`    — off by request (`BB_POOL_WORKER=0`). Not a failure.
 *   - `unavailable` — no worker can start. This is the report a user needs.
 *   - `degraded`    — workers start, but the engine or the grammars did not
 *                     load, so files are parsed by regex. Indexing works; the
 *                     result is thinner. A WARN, not an exit-1.
 *   - `ok`          — verified by actually starting one.
 */
export type PoolDoctorStatus = "ok" | "degraded" | "unavailable" | "disabled"

export interface PoolDoctorReport {
  status: PoolDoctorStatus
  findings: PoolFinding[]
  resolution: PoolForkResolution
  /** Present when the self-test actually ran. */
  probe?: PoolSyncProbeResult
}

export interface PoolDoctorOptions {
  /**
   * Directory of the AST module — `src/ast` when running from source, `dist`
   * when running compiled. The resolver derives every path from it, so a caller
   * that is NOT two levels below the package root must pass it. From
   * `src/setup/` the default is already correct (both are two levels deep);
   * from `src/setup/checks/` it would not be.
   */
  moduleDir?: string
  env?: NodeJS.ProcessEnv
  /**
   * Run the worker's self-test. Default true — resolution alone cannot see a
   * worker whose own module graph fails to load, which is the case a user is
   * actually reporting when they say "workers don't start".
   */
  probe?: boolean
  /** Self-test ceiling in ms. Default 30s. */
  timeoutMs?: number
}

/**
 * The synchronous diagnosis `bb doctor` calls.
 *
 * Sync because `runDoctorChecks` (src/setup/doctor.ts) is sync and
 * src/cli/index.ts calls it without `await`; an async probe there would hand the
 * CLI a Promise and break `report.healthy`. The cost of sync is real — it blocks
 * the process for the length of one worker boot — so the probe is bounded,
 * skipped entirely when resolution already failed (there is nothing to probe),
 * and never throws.
 */
export function diagnosePoolStartupSync(opts: PoolDoctorOptions = {}): PoolDoctorReport {
  const env = opts.env ?? process.env
  const findings: PoolFinding[] = []
  let resolution: PoolForkResolution
  try {
    resolution = resolvePoolWorkerForkSafe({ moduleDir: opts.moduleDir, env })
  } catch (e: any) {
    // The resolver does not throw — it returns a union. This guard exists so a
    // future edit cannot make a throwing resolver take `bb doctor` down with it.
    const message = String(e?.message ?? e)
    return {
      status: "unavailable",
      resolution: {
        ok: false,
        reason: "fork-unavailable",
        message: `the pool resolver itself failed: ${message}`,
        remediation: ["This is a bug in bb. Re-run with BB_LOG_LEVEL=debug and report it."],
        detail: { errorMessage: message },
      },
      findings: [
        {
          id: "pool-resolver-crashed",
          severity: "fail",
          message: `the pool resolver threw: ${message}`,
          fix: "This is a bug in bb — please report it with the message above.",
        },
      ],
    }
  }

  if (!resolution.ok) {
    const disabled = resolution.reason === "pool-disabled-by-env"
    findings.push({
      id: `pool-${resolution.reason}`,
      severity: disabled ? "info" : "fail",
      message: renderPoolDiagnosis(resolution),
      fix: resolution.remediation[0],
    })
    return { status: disabled ? "disabled" : "unavailable", resolution, findings }
  }

  // The runtime facts a reader needs BEFORE they read a cause: which loader is
  // in play, and what is running it. A missing compiled entry and a missing tsx
  // have different fixes and both present as "workers don't start" until you
  // know which build is running.
  const target =
    resolution.source === "compiled-dist"
      ? `the compiled worker (${resolution.workerPath})`
      : `tsx + TypeScript source (${resolution.workerPath} ${resolution.workerArgs.join(" ")})`
  findings.push({
    id: "pool-target",
    severity: "info",
    message:
      `Pool workers fork ${target}\n` +
      `  runtime: ${process.execPath} (${process.version})\n` +
      `  root: ${resolution.projectRoot}`,
  })

  if (opts.probe === false) return { status: "ok", resolution, findings }

  let probe: PoolSyncProbeResult
  try {
    probe = probePoolWorkerSync(resolution, { env, timeoutMs: opts.timeoutMs })
  } catch (e: any) {
    findings.push({
      id: "pool-selftest-crashed",
      severity: "warn",
      message: `the worker self-test could not be run: ${String(e?.message ?? e)}`,
      fix: "Re-run with BB_LOG_LEVEL=debug; if this repeats it is a bug in bb.",
    })
    return { status: "ok", resolution, findings }
  }

  if (!probe.ok) {
    // An old build that predates the self-test is not a broken pool, so it is a
    // warn that says why, rather than a fail that would send the user chasing a
    // reinstall they do not need.
    const unverifiable = probe.reason === "worker-selftest-unsupported"
    findings.push({
      id: `pool-${probe.reason}`,
      severity: unverifiable ? "warn" : "fail",
      message: renderPoolDiagnosis(probe),
      fix: probe.remediation[0],
    })
    return { status: unverifiable ? "ok" : "unavailable", resolution, probe, findings }
  }

  const r = probe.report
  if (r.engine === "unavailable") {
    findings.push({
      id: "pool-engine-unavailable",
      severity: "warn",
      message:
        "Pool workers START, but the AST engine did not load, so every file is parsed by regex\n" +
        "extraction instead of its grammar. Indexing succeeds and returns FEWER symbols than a\n" +
        "healthy run — which reads as \"bb works\" and is not.\n" +
        `  worker said: ${r.diagnostics.join(" | ") || "(no detail)"}`,
      fix: "npm rebuild --build-from-source && rm -rf node_modules && npm install --include=dev",
    })
  }
  if (r.wasm === "unavailable") {
    findings.push({
      id: "pool-wasm-unavailable",
      severity: "warn",
      message:
        "Pool workers START, but the tree-sitter wasm registry did not load. Grammar-based\n" +
        "parsing is unavailable; files still index through the regex fallback.\n" +
        `  worker said: ${r.diagnostics.join(" | ") || "(no detail)"}`,
      fix: "Check the grammars shipped with your install: `ls wasm | head`",
    })
  }
  if (r.engine === "ok" && r.wasm === "ok") {
    findings.push({
      id: "pool-verified",
      severity: "info",
      message: `A pool worker started and loaded the engine and the grammars in ${probe.ms}ms (pid ${r.pid}, ${r.node}).`,
    })
  }
  const status: PoolDoctorStatus = r.engine === "ok" && r.wasm === "ok" ? "ok" : "degraded"
  return { status, resolution, probe, findings }
}
// ── turning a caught failure into something a user can act on ───────────────

export interface WorkerStartupFailureInput {
  /** Whatever the `catch` received. */
  error?: unknown
  /** The bounded capture from `attachWorkerOutputCapture`, preferred. */
  capture?: WorkerOutputCapture
  /** Raw stderr, when there is no capture object. */
  stderr?: string
  exitCode?: number | null
  signal?: string | null
  timeoutMs?: number
  /** The resolution that produced the fork, if the caller still has it. */
  resolution?: PoolForkResolution
  workerPath?: string
  workerArgs?: string[]
  /** Lines of stderr quoted in the report. Default `DEFAULT_CAPTURE_LINES`. */
  lineLimit?: number
}

export interface WorkerStartupFailure {
  ok: false
  /** Reason code — the thing to grep, and the `doctor` finding id. */
  reason: PoolFailureReason
  /** Machine cause from the child's own output, or `unclassified`. */
  cause: StderrCause
  /** One sentence in prose. */
  causeSummary: string
  /** One line naming the failure. */
  message: string
  /** Ordered fixes. */
  remediation: string[]
  /** The bounded evidence: last N non-empty lines of the child's stderr. */
  stderrLines: string[]
  stderrTruncated: boolean
  /** Terminal-ready block: cause, evidence, fixes, runtime facts. */
  text: string
}

/**
 * THE call the indexer makes when the pool will not start.
 *
 * Everything a user is told about a dead pool comes from here, in one place, so
 * the fork probe and `bb doctor` cannot describe the same failure differently.
 * It is built from what the caller actually HAS at the catch: the error, the
 * bounded stderr capture, and the exit code. The chain is:
 *
 *     child's stderr  ->  explainWorkerStderr  ->  a named cause
 *                     ->  PoolForkFailure       ->  cause + fixes + evidence
 *
 * That middle step is the one that was missing. The pool knew it had failed and
 * roughly why the TARGET was unusable, but the worker's own output — a native
 * module built for another platform, a module that is not installed, a Node
 * version mismatch — was drained and dropped, so it was never the answer to
 * "why aren't my pool workers starting?", even though it was the only evidence
 * anyone had.
 *
 * Anti-spam: nothing here writes to the terminal. It RETURNS text for the
 * failure path; routine worker logging stays un-echoed.
 */
export function explainWorkerStartupFailure(input: WorkerStartupFailureInput): WorkerStartupFailure {
  const limit = Math.max(1, input.lineLimit ?? DEFAULT_CAPTURE_LINES)
  const stderr = input.capture ? input.capture.stderr : (input.stderr ?? "")
  const lines = input.capture
    ? input.capture.stderrLines().slice(-limit)
    : stderr
        .split("\n")
        .map((l) => l.trimEnd())
        .filter((l) => l.trim().length > 0)
        .slice(-limit)
  const truncated = input.capture ? input.capture.stderrTruncated : stderr.length > 0 && lines.join("\n").length < stderr.trim().length
  // The evidence block is the LINES, not the raw buffer: a stack trace cut at an
  // arbitrary byte offset is usually the useless part.
  const evidence = lines.join("\n")
  const classified = evidence.trim() ? explainWorkerStderr(evidence) : null
  const attributed = classified && classified.cause !== "unclassified" ? classified : null
  const errMsg = input.error instanceof Error ? input.error.message : input.error ? String(input.error) : ""
  const detail: PoolForkFailure["detail"] = {
    workerPath: input.workerPath ?? (input.resolution?.ok ? input.resolution.workerPath : undefined),
    workerArgs: input.workerArgs ?? (input.resolution?.ok ? input.resolution.workerArgs : undefined),
    execPath: process.execPath,
    nodeVersion: process.version,
    timeoutMs: input.timeoutMs,
    exitCode: input.exitCode,
    signal: input.signal,
    stderrTail: evidence || undefined,
    ...(attributed ? { cause: attributed.cause, causeRemediation: attributed.remediation } : {}),
  }

  // A resolution-time failure already IS the complete answer — the worker was
  // never forked, so its stderr is irrelevant (usually empty).
  let failure: PoolForkFailure
  if (input.resolution && !input.resolution.ok) {
    failure = input.resolution
  } else {
    const reason: PoolFailureReason = attributed
      ? "worker-load-crash"
      : /timed out after|handshake did not complete/i.test(errMsg)
        ? "worker-startup-timeout"
        : input.exitCode === 0
          ? "worker-exited-silently"
          : input.exitCode !== undefined && input.exitCode !== null
            ? "worker-exit-nonzero"
            : "fork-unavailable"
    const message = attributed
      ? `the worker failed to start: ${attributed.summary}`
      : errMsg || DEFAULT_FAILURE_MESSAGE[reason]
    failure = fail(reason, message, {
      ...detail,
      timeoutMs: input.timeoutMs ?? (reason === "worker-startup-timeout" ? poolProbeTimeoutMs() : undefined),
    })
  }

  const text = renderPoolDiagnosis(failure) + (truncated
    ? "\n  (earlier stderr was dropped by the capture — the full trace, if the worker logged\n" +
      "   one, is in $BB_DATA_DIR/logs/)"
    : "")
  return {
    ok: false,
    reason: failure.reason,
    cause: attributed?.cause ?? failure.detail.cause ?? "unclassified",
    causeSummary: attributed?.summary ?? failure.message,
    message: failure.message,
    remediation: failure.remediation,
    stderrLines: lines,
    stderrTruncated: truncated,
    text,
  }
}

const DEFAULT_FAILURE_MESSAGE: Record<PoolFailureReason, string> = {
  "pool-disabled-by-env": "the pool is disabled by BB_POOL_WORKER",
  "runtime-unsupported": "the worker cannot be forked under this runtime",
  "worker-entry-missing": "the worker entry is not on disk",
  "tsx-missing": "no tsx binary was found, so the source worker cannot be started",
  "tsx-not-runnable": "the resolved tsx binary is not runnable",
  "worker-load-crash": "the worker failed to start",
  "worker-exited-silently": "the worker exited without ever reporting ready",
  "worker-exit-nonzero": "the worker exited with a non-zero code",
  "worker-startup-timeout": "the worker did not report ready in time",
  "fork-unavailable": "forking a worker failed",
  "worker-selftest-unsupported": "the installed worker does not support a startup self-test",
}

/**
 * Drop-in replacement for the probe's own `catch`.
 *
 * Classifies an arbitrary failure of the fork test — including the ones that
 * come from code this module does not own — into the same union, so every
 * "pool unavailable" line in the product names a cause and a fix.
 */
export function classifyPoolStartupFailure(input: {
  error?: unknown
  exitCode?: number | null
  signal?: string | null
  stderr?: string
  workerPath?: string
  workerArgs?: string[]
  timeoutMs?: number
  resolution?: PoolForkResolution
}): PoolForkFailure {
  const { error, exitCode, signal, stderr, workerPath, workerArgs, timeoutMs, resolution } = input
  const stderrTail = (stderr ?? "").trim()
  const base: PoolForkFailure["detail"] = {
    workerPath: workerPath ?? (resolution?.ok ? resolution.workerPath : undefined),
    workerArgs: workerArgs ?? (resolution?.ok ? resolution.workerArgs : undefined),
    execPath: process.execPath,
    nodeVersion: process.version,
    timeoutMs,
    exitCode,
    signal,
    stderrTail: stderrTail || undefined,
  }
  const errMsg = error instanceof Error ? error.message : error ? String(error) : ""

  if (/timed out after|handshake did not complete/i.test(errMsg)) {
    return fail("worker-startup-timeout", errMsg, { ...base, timeoutMs: timeoutMs ?? DEFAULT_WORKER_STARTUP_TIMEOUT_MS })
  }
  if (/worker exited with code/i.test(errMsg)) {
    const explained = stderrTail ? explainWorkerStderr(stderrTail) : null
    return fail("worker-exit-nonzero", errMsg, {
      ...base,
      ...(explained && explained.cause !== "unclassified"
        ? { cause: explained.cause, causeRemediation: explained.remediation }
        : {}),
    })
  }
  if (stderrTail) {
    const explained = explainWorkerStderr(stderrTail)
    return fail("worker-load-crash", `worker failed to start: ${explained.summary}`, {
      ...base,
      cause: explained.cause,
      causeRemediation: explained.remediation,
    })
  }
  return fail("fork-unavailable", errMsg || "the fork probe failed for an unknown reason", {
    ...base,
    errorMessage: errMsg || undefined,
  })
}
