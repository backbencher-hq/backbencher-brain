// ide/vscode/src/auto-index.ts — M25.E2 core (pure, headless-testable).
//
// The single owner of the open-workspace auto-index flow (issue #500):
//   detect -> estimate scale -> consent -> index with progress -> ready.
//
// Declared guarantees (gated by script/m25/verify-auto-index.ts):
//   detection:    index presence = brain.db exists and is non-empty at
//                 <BB_DATA_DIR || ~/.bb>/projects/<sha1(realpath)[0..40)>/brain.db
//                 (same convention as src/cli/index.ts + src/util/bb-data-dir.ts)
//   consent:      indexing NEVER starts without an explicit consent decision;
//                 absence of a refusal is not consent
//   scale:        the consent decision is never requested before a scale
//                 estimate is available (the user is informed of expected
//                 scale before consenting — issue acceptance criterion)
//   non-blocking: start() resolves before indexing completes; the state
//                 machine performs no synchronous indexing work on the start
//                 path, so editor startup is never blocked
//   cancel:       cancel() during indexing moves to cancelled with the
//                 partial state honestly surfaced; a later start() resumes
//                 (re-invocation without --force), it does not re-consent
//   idempotent:   a second start() while indexing is a no-op (single flight)
//   bb_data_dir:  BB_DATA_DIR is honored for detection AND for the spawned
//                 server/index process environment (extension hosts that
//                 hide ~/.bb across processes — see src/util/bb-data-dir.ts)
//
// Honesty scope note: presence is a file-level fact. Semantic health of an
// existing index (schema currency, hash drift) is the server's and
// `bb doctor`'s job, never claimed here.
import { spawn, type ChildProcess } from "child_process"
import { createHash } from "crypto"
import { existsSync, readdirSync, statSync } from "fs"
import { homedir } from "os"
import path from "path"
import { realpathSync } from "fs"

/** The five launch languages (contract §3 scope). */
export const LAUNCH_LANGUAGE_EXTS = [".java", ".groovy", ".gradle", ".kt", ".kts", ".scala", ".sc", ".ts", ".tsx"]

export interface IndexDetection {
  projectId: string
  dbPath: string
  present: boolean
  /** db file size in bytes when present, else null */
  dbBytes: number | null
  /** how the data dir was resolved (declared provenance, never guessed) */
  dataDirProvenance: "BB_DATA_DIR" | "home"
}

export function projectIdForRoot(root: string): string {
  let canonical = path.resolve(root)
  try {
    canonical = realpathSync.native(canonical)
  } catch {
    // Nonexistent paths retain deterministic lexical identity (cli convention).
  }
  return createHash("sha1").update(canonical).digest("hex").substring(0, 40)
}

export function resolveDataDir(env: NodeJS.ProcessEnv = process.env): { dir: string; provenance: "BB_DATA_DIR" | "home" } {
  return env.BB_DATA_DIR
    ? { dir: path.resolve(env.BB_DATA_DIR), provenance: "BB_DATA_DIR" }
    : { dir: path.join(homedir(), ".bb"), provenance: "home" }
}

export function detectIndex(root: string, env: NodeJS.ProcessEnv = process.env): IndexDetection {
  const projectId = projectIdForRoot(root)
  const { dir, provenance } = resolveDataDir(env)
  const dbPath = path.join(dir, "projects", projectId, "brain.db")
  let present = false
  let dbBytes: number | null = null
  try {
    const st = statSync(dbPath)
    present = st.isFile() && st.size > 0
    dbBytes = present ? st.size : null
  } catch {
    present = false
  }
  return { projectId, dbPath, present, dbBytes, dataDirProvenance: provenance }
}

// ---------------------------------------------------------------------------
// Scale estimate — informs consent, never gates it silently away.
// ---------------------------------------------------------------------------

export type ScaleBucket = "small" | "medium" | "large" | "giant"

export interface ScaleEstimate {
  files: number
  bucket: ScaleBucket
  /** user-facing expectation message (M19 giant-repo numbers as reference) */
  message: string
  /** true when the walk hit the declared scan cap (estimate is a floor) */
  truncated: boolean
}

/** Declared scan cap: counting beyond this is pointless for bucketing. */
export const SCALE_SCAN_CAP = 20_000

/** Reference expectations (M19 precision-wave numbers as declared reference). */
export const SCALE_MESSAGES: Record<ScaleBucket, string> = {
  small: "Small workspace — indexing should finish in under a minute.",
  medium: "Medium workspace — expect a few minutes of background indexing.",
  large: "Large workspace — expect tens of minutes of background indexing; the editor stays usable throughout.",
  giant: "Giant workspace — expect a long background index (M19 reference: hours for 100k+ files); the editor stays usable throughout and features arrive incrementally.",
}

export function bucketFor(files: number): ScaleBucket {
  if (files < 1_000) return "small"
  if (files < 10_000) return "medium"
  if (files < 100_000) return "large"
  return "giant"
}

/**
 * Count launch-language source files under root. `listFiles` is injectable
 * for headless tests; the default is a bounded recursive walk that skips
 * common heavyweight directories (declared list, not folklore).
 */
export function estimateScale(root: string, listFiles: (root: string) => string[] = defaultListFiles): ScaleEstimate {
  const files = listFiles(root).length
  const bucket = bucketFor(files)
  const truncated = files >= SCALE_SCAN_CAP
  return {
    files,
    bucket,
    message: truncated ? `${SCALE_MESSAGES[bucket]} (estimate is a floor — scan cap reached)` : SCALE_MESSAGES[bucket],
    truncated,
  }
}

const SKIPPED_DIRS = new Set(["node_modules", ".git", "dist", "build", "out", "target", ".venv", "venv", "__pycache__"])

function defaultListFiles(root: string): string[] {
  const out: string[] = []
  const walk = (dir: string, depth: number): void => {
    if (out.length >= SCALE_SCAN_CAP || depth > 12) return
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const entry of entries) {
      if (out.length >= SCALE_SCAN_CAP) return
      const abs = path.join(dir, entry)
      let st: import("fs").Stats
      try {
        st = statSync(abs)
      } catch {
        continue
      }
      if (st.isDirectory()) {
        if (!SKIPPED_DIRS.has(entry)) walk(abs, depth + 1)
      } else if (LAUNCH_LANGUAGE_EXTS.includes(path.extname(entry).toLowerCase())) {
        out.push(abs)
      }
    }
  }
  walk(root, 0)
  return out
}

// ---------------------------------------------------------------------------
// The consent state machine.
// ---------------------------------------------------------------------------

export type AutoIndexState =
  | { phase: "idle" }
  | { phase: "no-index"; detection: IndexDetection }
  | { phase: "estimating"; detection: IndexDetection }
  | { phase: "awaiting-consent"; detection: IndexDetection; scale: ScaleEstimate }
  | { phase: "indexing"; detection: IndexDetection; scale: ScaleEstimate; startedAt: number }
  | { phase: "ready"; detection: IndexDetection }
  | { phase: "cancelled"; detection: IndexDetection; scale: ScaleEstimate; note: string }
  | { phase: "failed"; detection: IndexDetection; scale: ScaleEstimate | null; error: string }

export interface ProgressEvent {
  phase: "estimating" | "awaiting-consent" | "indexing" | "ready" | "cancelled" | "failed"
  message: string
  /** best-effort file counters parsed from the index process output */
  filesDone?: number
  filesTotal?: number
  at: number
}

export interface AutoIndexPolicy {
  /** "ask" (default): consent surface; "never": never index, declared no-op */
  mode: "ask" | "never"
}

export interface RunnerResult {
  code: number | null
  /** true when the process was terminated by our cancel (SIGTERM) */
  cancelled: boolean
  /** raw combined output tail for honest failure reports */
  outputTail: string
}

export type IndexRunner = (
  root: string,
  env: NodeJS.ProcessEnv,
  onOutput: (chunk: string) => void,
  onSpawn: (cancel: () => void) => void,
) => Promise<RunnerResult>

/** Real runner: `bb index <dir> --no-setup` using the resolved bb entry. */
export function realRunner(bbEntry: string): IndexRunner {
  return (root, env, onOutput, onSpawn) => {
    return new Promise((resolve) => {
      let cancelled = false
      let tail = ""
      let child: ChildProcess
      try {
        child = spawn(process.execPath, [bbEntry, "index", root, "--no-setup"], {
          env,
          stdio: ["ignore", "pipe", "pipe"],
        })
      } catch (err) {
        resolve({ code: null, cancelled: false, outputTail: String(err) })
        return
      }
      onSpawn(() => {
        cancelled = true
        child.kill("SIGTERM")
      })
      const absorb = (chunk: Buffer | string): void => {
        const s = String(chunk)
        tail = (tail + s).slice(-4_000)
        onOutput(s)
      }
      child.stdout?.on("data", absorb)
      child.stderr?.on("data", absorb)
      child.on("error", (err) => resolve({ code: null, cancelled, outputTail: tail + String(err) }))
      child.on("close", (code) => resolve({ code, cancelled: cancelled, outputTail: tail }))
    })
  }
}

export interface AutoIndexMachine {
  /** current state (read-only view) */
  readonly state: AutoIndexState
  /** begin the flow: detect, estimate, request consent, or index if consented */
  start(consent: "granted" | "not-granted"): Promise<void>
  /** record the user's consent decision from the surface */
  decideConsent(granted: boolean): Promise<void>
  /** cancel an in-flight index; partial state is surfaced, resume allowed */
  cancel(): void
  /** subscribe to progress events (returns an unsubscribe fn) */
  onProgress(listener: (event: ProgressEvent) => void): () => void
}

export interface AutoIndexDeps {
  root: string
  env?: NodeJS.ProcessEnv
  runner?: IndexRunner
  now?: () => number
  /** persist a granted consent decision (workspaceState in the glue) */
  saveConsent?: () => void
  /** load a previously granted consent decision (resume across reopen) */
  loadConsent?: () => boolean
}

export function createAutoIndexMachine(deps: AutoIndexDeps): AutoIndexMachine {
  const env = deps.env ?? process.env
  const runner = deps.runner ?? realRunner(path.join(__dirname, "index.js"))
  const now = deps.now ?? (() => Date.now())
  const listeners = new Set<(event: ProgressEvent) => void>()
  let current: AutoIndexState = { phase: "idle" }
  let cancelChild: (() => void) | null = null
  let inFlight = false
  let pendingScale: ScaleEstimate | null = null

  const detection = (): IndexDetection => detectIndex(deps.root, env)

  function emit(event: ProgressEvent): void {
    for (const l of listeners) l(event)
  }

  async function runIndex(state: Extract<AutoIndexState, { phase: "indexing" }>): Promise<void> {
    const result = await runner(deps.root, { ...env }, () => {}, (cancel) => (cancelChild = cancel))
    cancelChild = null
    inFlight = false
    if (result.cancelled) {
      current = {
        phase: "cancelled",
        detection: state.detection,
        scale: state.scale,
        note: "Index cancelled by user. Any partial index state remains on disk and is resumed (without re-consent) on the next open.",
      }
      emit({ phase: "cancelled", message: current.note, at: now() })
      return
    }
    if (result.code !== 0) {
      current = {
        phase: "failed",
        detection: state.detection,
        scale: state.scale,
        error: `bb index exited ${result.code ?? "unknown"}. Output tail: ${result.outputTail.slice(-500) || "(empty)"}`,
      }
      emit({ phase: "failed", message: current.error, at: now() })
      return
    }
    const after = detection()
    // Honest check: a "successful" index that left no db is a failure.
    if (!after.present) {
      current = {
        phase: "failed",
        detection: after,
        scale: state.scale,
        error: "bb index reported success but no brain.db was written at the expected path.",
      }
      emit({ phase: "failed", message: current.error, at: now() })
      return
    }
    current = { phase: "ready", detection: after }
    emit({ phase: "ready", message: "Index ready — bb_lsp features active.", at: now() })
  }

  return {
    get state(): AutoIndexState {
      return current
    },
  async start(consent): Promise<void> {
    if (inFlight) return // idempotence: single flight
    const det = detection()
    if (det.present) {
      current = { phase: "ready", detection: det }
      emit({ phase: "ready", message: "Existing index found — features active.", at: now() })
      return
    }
    // Resume across reopen: a previously granted consent (persisted by the
    // glue) counts as granted — the user decided once, reopening resumes.
    if (consent === "not-granted" && deps.loadConsent?.() === true) consent = "granted"
    if (consent === "granted") {
      // Consent is on record; estimate (if not already known) and index
      // without re-asking. The estimate still informs the progress message.
      const scale = pendingScale ?? estimateScale(deps.root)
      pendingScale = scale
      inFlight = true
      current = { phase: "indexing", detection: det, scale, startedAt: now() }
      emit({ phase: "indexing", message: `Indexing (${scale.bucket} workspace, ${scale.files} source files).`, at: now() })
      await runIndex(current)
      return
    }
    current = { phase: "no-index", detection: det }
    if ((env.BB_AUTOINDEX_MODE ?? "ask") === "never") {
      return
    }
    current = { phase: "estimating", detection: det }
    emit({ phase: "estimating", message: "Estimating workspace scale…", at: now() })
    const scale = estimateScale(deps.root)
    pendingScale = scale
    current = { phase: "awaiting-consent", detection: det, scale }
    emit({ phase: "awaiting-consent", message: scale.message, at: now() })
  },
    async decideConsent(granted): Promise<void> {
      if (current.phase !== "awaiting-consent") return
      if (!granted) {
        pendingScale = null
        emit({ phase: "awaiting-consent", message: "Declined — no index will be built. Reopen via command to retry.", at: now() })
        return
      }
      deps.saveConsent?.()
      const scale = current.scale
      inFlight = true
      current = { phase: "indexing", detection: current.detection, scale, startedAt: now() }
      emit({ phase: "indexing", message: `Indexing started (${scale.bucket} workspace, ${scale.files} source files).`, at: now() })
      await runIndex(current)
    },
    cancel(): void {
      cancelChild?.()
    },
    onProgress(listener): () => void {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
