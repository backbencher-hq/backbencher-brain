// src/setup/doctor.ts — M32.S2.
//
// `bb doctor`: concrete diagnosis of why semantic search is degraded, from
// REAL local state only. M30 got users into a working config; this answers
// the next question — "is everything actually consistent, and if not, what
// exactly do I run to fix it?"
//
// Checks (each backed by real files/DB rows — never invented):
//   1. config presence + completeness (all precedence tiers)
//   2. config file permissions (0600 expected; --fix, M32.S3, repairs it)
//   3. model consistency: the winning config's model vs the models actually
//      stored in brain_semantic_embedding for this project (readonly DB).
//      A mismatch means stored vectors can never be compared with query
//      vectors — the honest fix is `bb index --force`.
//   4. wizard-skip marker (informational)
//
// No network calls. Diagnosis is read-only: --fix (S3) is the only command
// that mutates anything, and only file permissions.
//
// Exit code: 0 when healthy, 1 when at least one FAIL-level finding exists
// (so scripts/CI can branch). WARN findings do not change the exit code.

import { existsSync, readFileSync, statSync, chmodSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { bbDataDir } from "../util/bb-data-dir"
import { diagnosePoolStartupSync, findPackageRoot, type PoolDoctorReport as PoolStartupReport } from "../ast/pool-diagnostics"
import { isEmbeddingDisabled } from "../brain/semantic/embedding-config"
import { SemanticEngine } from "../brain/semantic/engine"
import { fingerprintKey } from "./setup-wizard"
import { describeEmbeddingConfig, type TierView } from "./setup-show"

// Repository root — found by walking up to the nearest package.json.
//
// NOT `path.resolve(import.meta.dirname, "../..")`, which is what this used to
// be. That is correct only for the unbundled source layout (`src/setup` is two
// levels under the root); in the SHIPPED build tsup puts this file in a chunk at
// `dist/doctor-<hash>.js`, so `import.meta.dirname` is `<pkg>/dist` and `../..`
// is the PARENT of the package. Measured: `bin/bb doctor` from a compiled build
// searched `<parent>/node_modules/.bin/tsx` and `<parent>/src/ast` — one level
// above the checkout. It cost two things before it was found:
//
//   - `createRequire(path.join(ROOT_PKG, "package.json"))` pointed outside the
//     package, so better-sqlite3 failed to resolve and `readStoredModels`
//     returned `[]` from its `catch` — doctor's model-consistency check has been
//     dead in every published install, silently, because the catch swallows it;
//   - the pool section looked for the worker in the wrong tree entirely.
const ROOT_PKG = findPackageRoot(import.meta.dirname ?? ".") ?? path.resolve(import.meta.dirname ?? ".", "../..")

/**
 * The directory the pool resolver must measure itself from.
 *
 * `resolvePoolWorkerForkSafe()` derives every path from the directory of the
 * module it is asked about, because that is the only thing that is correct in
 * both builds: `src/ast` under tsx, `dist` for the compiled bundle. Called from
 * `src/setup/`, its own default would happen to land in the right place (both
 * are two levels below the package root) — but that is a coincidence of
 * directory depth, and `doctor` is the wrong place to depend on it.
 *
 * So the choice is explicit, and it is the choice that matters: a COMPILED
 * `dist/` is used when it exists, because that is what `bb` runs when installed,
 * and the source tree is the fallback for a checkout. Getting this backwards
 * would report a healthy install as missing its worker.
 */
function poolModuleDir(): string {
  const dist = path.join(ROOT_PKG, "dist")
  return existsSync(path.join(dist, "pool-worker.js")) ? dist : path.join(ROOT_PKG, "src", "ast")
}

/**
 * One pool probe per process, per target.
 *
 * A worker boot is 0.6-3.4s of real work, and `runDoctorChecks` is called once
 * per CLI invocation but MANY times per test process (script/m32/verify-doctor.ts
 * calls it ~10 times). Paying for a boot per call would add tens of seconds to
 * gates that have nothing to do with the pool, for an answer that cannot change:
 * within one process, the same fork target and the same files give the same
 * verdict.
 *
 * Keyed on the target directory and BB_POOL_WORKER, so a test that wants a
 * different answer asks a different question. `resetPoolDoctorCache()` exists for
 * a caller that genuinely mutated the checkout mid-process.
 */
let poolCache: { key: string; report: PoolStartupReport } | null = null

function runPoolDoctor(moduleDir: string, probe: boolean | undefined): PoolStartupReport {
  const key = `${moduleDir}|${process.env.BB_POOL_WORKER ?? ""}|${probe === false ? "noprobe" : "probe"}`
  if (poolCache && poolCache.key === key) return poolCache.report
  const report = diagnosePoolStartupSync({ moduleDir, probe })
  poolCache = { key, report }
  return report
}

/** Drop the memoised pool probe. For a caller that changed the checkout in-process. */
export function resetPoolDoctorCache(): void {
  poolCache = null
}

export type Severity = "fail" | "warn" | "info"

export type Finding = {
  id: string
  severity: Severity
  message: string
  /** exact command the user should run, when applicable — advice, never auto-fix (S3 is the only mutator) */
  fix?: string
}

export type DoctorReport = {
  findings: Finding[]
  healthy: boolean
  winner: "env" | "global" | "project" | "none"
  /** models found in the project's stored embeddings, with row counts */
  storedModels: { model: string; count: number }[]
  pool: PoolDoctorSummary
  /** The embedding layers bb would try, in order.
   *
   *  Exposed structurally (not only rendered) so a machine consumer can read
   *  which layer wins without scraping prose — the same reason `pool` is a
   *  summary object rather than a formatted string. `keyState` is presence
   *  only; no key value ever reaches here. */
  embeddingChain?: EmbeddingChainView[]
}

/** One layer of the embedding fallback chain, as reported. */
export type EmbeddingChainView = {
  order: number
  role: string
  label: string
  endpoint: string
  model: string
  keyState: string
  source: string
  active: boolean
}

/**
 * The one-line answer to "are my pool workers starting?".
 *
 * `findings` alone answers it only for a reader who knows which findings are
 * about the pool; a status field answers it without that. `reasonCode` is the
 * machine-readable form (`tsx-missing`, `worker-load-crash`, …) and
 * `remediation` carries the commands, so a caller can render this however it
 * likes — a future CLI could print the status alone and keep the detail behind a
 * flag.
 */
export type PoolStatus = "ok" | "degraded" | "unavailable" | "disabled" | "unchecked"

export type PoolDoctorSummary = {
  status: PoolStatus
  summary: string
  reasonCode?: string
  cause?: string
  remediation?: string[]
  /**
   * The runtime facts that decide the verdict: the executable and its version,
   * whether the COMPILED worker or tsx is in play, the module directory the
   * paths came from, and how long the worker took to start. `tsx-missing` and
   * `worker-entry-missing` present identically to a user and have different
   * fixes; this line is what tells them apart.
   */
  facts: string[]
}

function readJsonSafe(p: string): any | null {
  try {
    if (!existsSync(p)) return null
    return JSON.parse(readFileSync(p, "utf8"))
  } catch {
    return null
  }
}

type StoredModels = { model: string; count: number }[]

// Reads embedding models from the project's brain.db WITHOUT creating or
// writing it: opens the file directly in readonly mode. Missing DB or table
// yields [] — diagnosed as "no index yet", not an error.
function readStoredModels(projectId: string, dataDir: string): StoredModels {
  const dbPath = path.join(dataDir, "projects", projectId, "brain.db")
  if (!existsSync(dbPath)) return []
  try {
    // Anchor require at the repo root package.json — a bare require() from
    // src/setup/ fails to resolve under the compiled ESM bundle (the M30 P0
    // class: works under tsx, broken in dist).
    const require = createRequire(path.join(ROOT_PKG, "package.json"))
    const Database = require("better-sqlite3")
    const db = new Database(dbPath, { readonly: true, fileMustExist: true })
    try {
      const rows = db
        .prepare(
          `SELECT embedding_model AS model, COUNT(*) AS count FROM brain_semantic_embedding WHERE project_id = ? GROUP BY embedding_model`,
        )
        .all(projectId) as { model: string; count: number }[]
      return rows.map((r) => ({ model: String(r.model), count: Number(r.count) }))
    } finally {
      db.close()
    }
  } catch {
    // Table missing (old index) or driver unavailable: treat as no stored data.
    return []
  }
}

function tierIssues(t: TierView): { missing: string[]; modeWrong: boolean } {
  const missing: string[] = []
  if (t.present && !t.complete) {
    const reason = t.incompleteReason ?? ""
    if (reason.includes("base URL")) missing.push("base URL")
    if (reason.includes("model")) missing.push("model")
    if (!t.keyFingerprint) missing.push("API key")
  }
  const modeWrong = t.fileMode !== undefined && t.fileMode !== 0o600
  return { missing, modeWrong }
}

export function runDoctorChecks(opts: {
  cwd?: string
  env?: Record<string, string | undefined>
  dataDir?: string
  projectId?: string
  storedModels?: StoredModels
  /**
   * Start a real pool worker to verify it (default true).
   *
   * `false` makes the pool section resolution-only: still names the fork target,
   * the runtime, and any reason the target cannot be used — but does not pay for
   * a worker boot. Used by the test gates that must stay fast, and available to
   * any caller that already knows the pool is fine.
   */
  poolProbe?: boolean
  /**
   * Override the directory the pool is resolved from — `src/ast` in a source
   * checkout, `dist` in the compiled build.
   *
   * A test seam, like `env` and `dataDir` above it. It exists because the
   * interesting state (an install whose fork target cannot be used) cannot be
   * produced any other way: `bin/bb` cannot run at all without `dist`, so the
   * "no tsx" path is unreachable through the real binary. Left unset, the
   * install is detected.
   */
  poolModuleDir?: string
}): DoctorReport {
  const cwd = opts.cwd ?? process.cwd()
  const env = opts.env ?? process.env
  const dataDir = opts.dataDir ?? bbDataDir()
  const state = describeEmbeddingConfig(cwd, env, dataDir)

  const findings: Finding[] = []
  const embeddingChain: EmbeddingChainView[] = []
  // Read the label from the engine rather than repeating the string. The local
  // label is versioned (`local-word-vectors-v2`) because a tokenizer change
  // makes old and new vectors occupy different spaces, and a hardcoded copy
  // here would report every re-embedded project as a mismatched model.
  const localLabel = SemanticEngine.LOCAL_MODEL_LABEL

  // 1. Config presence/completeness per tier.
  if (!state.configured) {
    const skipped = state.tiers.some((t) => t.skippedMarker)
    findings.push({
      id: "no-config",
      severity: "fail",
      message: skipped
        ? "No embedding configuration (the wizard was skipped earlier)."
        : "No embedding configuration.",
      fix: "bb setup",
    })
  }
  for (const t of state.tiers) {
    const { missing, modeWrong } = tierIssues(t)
    if (missing.length > 0) {
      findings.push({
        id: `incomplete-${t.tier}`,
        severity: "fail",
        message: `${t.tier} tier is incomplete: missing ${missing.join(" + ")}.`,
        fix: "bb setup",
      })
    }
    if (modeWrong) {
      findings.push({
        id: `mode-${t.tier}`,
        severity: "warn",
        message: `${t.tier} config file has mode ${t.fileMode?.toString(8)} — the key may be world-readable.`,
        fix: "bb doctor --fix",
      })
    }
  }

  // 2. Model consistency: winning model vs stored embedding models.
  const winnerTier = state.tiers.find((t) => t.complete)
  const winnerModel = winnerTier?.model
  const storedModels = opts.storedModels ?? (opts.projectId ? readStoredModels(opts.projectId, dataDir) : [])
  if (winnerModel && storedModels.length > 0) {
    const matches = storedModels.filter((s) => s.model === winnerModel)
    if (matches.length === 0) {
      const storedDesc = storedModels.map((s) => `${s.model} (${s.count} rows)`).join(", ")
      findings.push({
        id: "model-mismatch",
        severity: "fail",
        message: `Model mismatch: config has ${winnerModel}, index has ${storedDesc}. Vectors from different models cannot be compared — the stored vectors are unusable.`,
        fix: "bb index --force",
      })
    } else {
      const foreign = storedModels.filter((s) => s.model !== winnerModel)
      if (foreign.length > 0) {
        const foreignDesc = foreign.map((s) => `${s.model} (${s.count} rows)`).join(", ")
        findings.push({
          id: "model-mixed",
          severity: "warn",
          message: `The index contains foreign-model vectors: ${foreignDesc}. They are never compared with ${winnerModel} queries.`,
          fix: "bb index --force",
        })
      }
    }
  } else if (winnerModel && storedModels.length === 0) {
    findings.push({
      id: "no-index",
      severity: "info",
      message: `No stored vectors for this project (no index or empty). Config model: ${winnerModel}.`,
      fix: "bb index .",
    })
  }

  // 3. Semantic degradation notice when nothing is configured at all.
  if (!winnerModel) {
    findings.push({
      id: "semantic-degraded",
      severity: "warn",
      message: `Semantic search will use ${localLabel} (weaker).`,
      fix: "bb setup",
    })
  }

  // 3b. EMBEDDING DIAGNOSIS. Agent 2 built the chain/failure analysis in
  //     src/brain/semantic/embedding-diagnosis.ts; nothing called it, so a user
  //     with a half-configured provider still saw only "No embedding
  //     configuration / Fix: bb setup" — which is a restatement, not a
  //     diagnosis. Wired here so the module's findings actually reach a user.
  //
  //     Deliberately added as a NEW section rather than a rewrite of the
  //     existing "3." block: agent 1's pool probe and agent 2's embedding chain
  //     both wanted this file, and the previous merge had to hold one of them
  //     back. Appending keeps both.
  //
  //     NOT YET REACHABLE from here: `probeEmbeddingEndpoint`, the live HTTP
  //     reachability probe, is exported by embedding-diagnosis but nothing calls
  //     it — deliberately. `runDoctorChecks` is sync, and a network call would
  //     have to be async, so wiring it here would hand the CLI a Promise and
  //     break `report.healthy`. Labelled in source so the gap stays VISIBLE
  //     instead of reading as a deliberate omission. `bb setup show --probe` is
  //     the intended caller.
  try {
    // Sync imports: `runDoctorChecks` is sync (agent 1 made the pool probe sync
    // because src/cli/index.ts calls it without `await`; an async import here
    // would hand the CLI a Promise and break `report.healthy`).
    const { buildEmbeddingDiagnosis } = require("../brain/semantic/embedding-diagnosis")
    const diagnosis = buildEmbeddingDiagnosis({ state, env: process.env })
    for (const p of diagnosis.problems ?? []) {
      // The real shape is `{ severity, envVar, message }` — no id, no fix.
      // `envVar` is the actionable half: it names the exact variable to set, so
      // it becomes the finding id AND the remediation. Deriving both from one
      // field keeps them from disagreeing.
      findings.push({
        id: p.envVar ? `embedding.${p.envVar.toLowerCase()}` : "embedding.config",
        severity: p.severity === "error" ? "fail" : "warn",
        message: p.message,
        // Never echo a key value — `envVar` is a variable NAME, and the module
        // guarantees `message` carries only presence/source, never the secret.
        ...(p.envVar ? { fix: `set ${p.envVar} (bb setup walks through it)` } : {}),
      })
    }
    // A tier-order disagreement is a configuration bug that produces confusing
    // behaviour rather than a hard failure, so it is reported explicitly rather
    // than left as an internal detail.
    if (diagnosis.tierOrderDisagreement) {
      findings.push({
        id: "embedding.tier-order-disagreement",
        severity: "warn",
        message: `embedding configuration layers disagree on precedence: ${diagnosis.tierOrderDisagreement.detail ?? diagnosis.tierOrderDisagreement.reason ?? "see bb setup show"}`,
        fix: "run `bb setup show` to see which layer wins",
      })
    }
    // The chain in order, so a user can see WHICH layer bb would reach first —
    // "no configuration" is far less actionable than "local words will be used
    // because the primary tier is incomplete".
    if (diagnosis.chain?.length) {
      for (const layer of diagnosis.chain) {
        // `label` is documented as safe to print; `keyState` is presence, never
        // a key value, so surfacing the chain cannot leak a credential.
        embeddingChain.push({
          order: layer.order,
          role: layer.role,
          label: layer.label,
          endpoint: layer.endpoint,
          model: layer.model,
          keyState: layer.keyState,
          source: layer.source,
          active: layer.active,
        })
      }
    }
    // The kill switch is the one embedding setting that changes behaviour
    // silently, so report it as its own fact rather than leaving it to be
    // inferred from a chain entry.
    if (isEmbeddingDisabled(process.env)) {
      findings.push({
        id: "embedding.disabled",
        severity: "warn",
        message: "embeddings are DISABLED (BB_EMBEDDING_DISABLED) — semantic search will not run at all",
        fix: "unset BB_EMBEDDING_DISABLED to enable semantic search",
      })
    }
  } catch (e: any) {
    // A diagnosis that cannot run must not take the report down with it — the
    // pool section below is the user's other headline answer.
    findings.push({
      id: "embedding.diagnosis-unavailable",
      severity: "warn",
      message: `embedding diagnosis could not run: ${e?.message ?? e}`,
      fix: "run `bb setup show` to inspect the embedding configuration",
    })
  }

  // 4. POOL WORKERS. The other question users arrive with, in the same shape:
  //    "it says my index is fine and it is crawling — are the workers running?"
  //
  //    This is a probe, not a guess. `diagnosePoolStartupSync` resolves the fork
  //    target and then STARTS a worker and asks what it loaded, which is the only
  //    way to tell "no tsx" (the common one: `npm ci --omit=dev`) from "tsx ran
  //    and the engine would not load" — identical from the outside, opposite
  //    fixes.
  //
  //    SYNC on purpose: `runDoctorChecks` is sync and src/cli/index.ts calls it
  //    without `await`, so an async probe here would hand the CLI a Promise and
  //    break `report.healthy`. The sync probe costs one worker boot (measured
  //    0.6-3.4s here) and is bounded; `opts.poolProbe: false` skips it.
  //
  //    `process.env`, NOT `opts.env`. `opts.env` exists so callers can fake the
  //    EMBEDDING config tiers without touching the real environment (that is how
  //    script/m32/verify-doctor.ts drives it with `env: {}`), and it says nothing
  //    about the pool: the pool will be forked with the real environment at index
  //    time, so a doctor that resolved against a fake one would report a state the
  //    user will never hit — and with `env: {}` the spawned worker would inherit no
  //    PATH at all.
  //
  //    Only `PoolFinding` fields are appended, so this section cannot leak key
  //    material or a whole environment into a report. The one env value it does
  //    print is `BB_POOL_WORKER`, because that setting IS the whole explanation
  //    when the pool is switched off.
  const poolReport = runPoolDoctor(opts.poolModuleDir ?? poolModuleDir(), opts.poolProbe)
  // Only warn/fail pool findings join the list. The `info` ones (which target is
  // in play, that a worker was verified) are facts about a pool that is WORKING,
  // and appending them would make `findings.length === 0` unreachable — which
  // would quietly delete the report's "no problems found" line for every install
  // with healthy embeddings. They are rendered under the pool status instead.
  findings.push(...poolReport.findings.filter((f) => f.severity !== "info"))

  const healthy = !findings.some((f) => f.severity === "fail")
  return {
    findings,
    healthy,
    winner: state.winner,
    storedModels,
    pool: summarizePool(poolReport),
    ...(embeddingChain.length ? { embeddingChain } : {}),
  }
}

/**
 * Compress the pool probe into the sentence a user is actually asking for.
 *
 * Kept beside the findings rather than inline in them so the STATUS is derived
 * once, from the probe, instead of re-inferred from rendered text by whatever
 * reads the report next.
 */
function summarizePool(report: PoolStartupReport): PoolDoctorSummary {
  const res = report.resolution
  const probe = report.probe
  const facts: string[] = [
    `runtime: ${process.execPath} (${process.version})`,
    res.ok
      ? `worker: ${res.source === "compiled-dist" ? "compiled dist/pool-worker.js" : `tsx + ${path.basename(res.workerArgs[0] ?? "?")}`}`
      : `worker: not resolvable (${res.reason})`,
  ]
  if (res.ok) facts.push(`root: ${res.projectRoot}`)

  if (!res.ok) {
    return {
      status: report.status === "disabled" ? "disabled" : "unavailable",
      summary:
        report.status === "disabled"
          ? "Pool workers are switched off (BB_POOL_WORKER) — indexing runs in-process, so it is slower."
          : `Pool workers cannot start (${res.reason}): ${res.message}`,
      reasonCode: res.reason,
      remediation: res.remediation,
      facts,
    }
  }
  if (!probe) {
    return {
      status: "unchecked",
      summary: `Pool fork target resolved (${res.source}) but was not started.`,
      facts,
    }
  }
  if (!probe.ok) {
    // An unverifiable worker is not a broken one — say which it is.
    const unverifiable = probe.reason === "worker-selftest-unsupported"
    return {
      status: unverifiable ? "unchecked" : "unavailable",
      summary: unverifiable
        ? `Pool workers could not be verified (${probe.reason}) — the installed worker predates the self-test.`
        : `Pool workers do not start (${probe.reason}): ${probe.message}`,
      reasonCode: probe.reason,
      remediation: probe.remediation,
      facts,
    }
  }
  const r = probe.report
  facts.push(`self-test: ${probe.ms}ms (pid ${r.pid}, node ${r.node})`)
  if (r.engine === "ok" && r.wasm === "ok") {
    return {
      status: "ok",
      summary: `Pool workers start normally (${res.source}); engine and grammars loaded in ${probe.ms}ms.`,
      facts,
    }
  }
  const broken: string[] = []
  if (r.engine !== "ok") broken.push("the AST engine did not load, so files are parsed by regex (fewer symbols)")
  if (r.wasm !== "ok") broken.push("the tree-sitter grammars did not load, so there is no grammar-based parsing")
  return {
    status: "degraded",
    summary: `Pool workers start but are DEGRADED: ${broken.join("; ")}.`,
    reasonCode: r.engine !== "ok" ? "pool-engine-unavailable" : "pool-wasm-unavailable",
    cause: r.diagnostics.join(" | ") || undefined,
    remediation: ["npm rebuild --build-from-source && rm -rf node_modules && npm install --include=dev"],
    facts,
  }
}

// Human-readable report. Keys appear only as fingerprints (inherited from the
// tier view; runDoctorChecks never reads raw key material into findings).
export function renderDoctorReport(r: DoctorReport): string {
  const lines: string[] = []
  lines.push("bb doctor — diagnostics")
  lines.push("")
  if (r.findings.length === 0) {
    lines.push("✓ No problems found — config and index look consistent.")
  }
  // The pool answer comes FIRST and on its own line, before the finding list. A
  // user who typed "workers don't start" is not reading a report to find out
  // whether they are reading a report — they want that sentence, and they want
  // it now. Everything after it is the evidence.
  if (r.pool) {
    const poolIcon: Record<PoolStatus, string> = {
      ok: "✓",
      degraded: "!",
      unavailable: "✗",
      disabled: "·",
      unchecked: "?",
    }
    lines.push(`${poolIcon[r.pool.status]} pool workers: ${r.pool.summary}`)
    if (r.pool.reasonCode) lines.push(`  reason: ${r.pool.reasonCode}`)
    if (r.pool.cause) lines.push(`  cause: ${r.pool.cause}`)
    for (const fact of r.pool.facts ?? []) lines.push(`  ${fact}`)
    // The FULL fix list. The `Fix:` line beside a finding is only ever the FIRST
    // remediation, and the first one is not always the right one — rebuilding a
    // native module beats reinstalling when the ABI is wrong.
    ;(r.pool.remediation ?? []).forEach((fix, i) => {
      const [first, ...rest] = fix.split("\n")
      lines.push(`  fix ${i + 1}: ${first.trim()}`)
      for (const cont of rest) if (cont.trim()) lines.push(`         ${cont.trim()}`)
    })
    lines.push("")
  }
  // The embedding chain, in the order bb resolves it. "No embedding
  // configuration" tells a user what happened; the chain tells them which layer
  // wins and why, which is what they need to change something. Printed after the
  // pool answer because both are headline sentences, but only when there is a
  // chain worth showing.
  if (r.embeddingChain?.length) {
    lines.push("embedding layers, in the order bb resolves them:")
    for (const layer of r.embeddingChain) {
      const mark = layer.active ? "→" : " "
      const key = layer.keyState === "present" ? "key present" : `key ${layer.keyState}`
      lines.push(`  ${mark} ${layer.order}. ${layer.label} — ${layer.model} @ ${layer.endpoint} (${key}, from ${layer.source})`)
    }
    lines.push("")
  }
  const iconFor: Record<Severity, string> = { fail: "✗", warn: "!", info: "·" }
  for (const f of r.findings) {
    lines.push(`${iconFor[f.severity]} ${f.message}`)
    if (f.fix) lines.push(`  Fix: ${f.fix}`)
  }
  return lines.join("\n") + "\n"
}

// --- M32.S3: bb doctor --fix -------------------------------------------------
//
// The ONLY mutating arm of doctor. Contract (master plan, completion bar 3):
//   - dry-run is the default; mutation requires apply=true
//   - repairs ONLY file permissions of embedding config files to 0600
//   - prints every change it makes (or would make, in dry-run)
//   - refuses everything else: no key material, no config content, no index,
//     no other files — a fix request outside the permission scope is a
//     refusal with an explanatory message, never a silent no-op

export type FixAction = {
  id: string
  file: string
  fromMode?: number
  toMode: 0o600
}

export type FixRefusal = {
  id: string
  reason: string
}

export type FixPlan = {
  actions: FixAction[]
  refusals: FixRefusal[]
}

// Maximum number of permission repairs per run — a safety valve against
// pathological state; doctor is a local diagnostic, not a batch tool.
const MAX_FIX_ACTIONS = 8

export function planDoctorFixes(opts: {
  cwd?: string
  env?: Record<string, string | undefined>
  dataDir?: string
}): FixPlan {
  const cwd = opts.cwd ?? process.cwd()
  const env = opts.env ?? process.env
  const dataDir = opts.dataDir ?? bbDataDir()
  const state = describeEmbeddingConfig(cwd, env, dataDir)

  const actions: FixAction[] = []
  const refusals: FixRefusal[] = []
  for (const t of state.tiers) {
    if (t.fileMode !== undefined && t.fileMode !== 0o600 && t.file) {
      if (actions.length >= MAX_FIX_ACTIONS) {
        refusals.push({ id: `mode-${t.tier}`, reason: `repair cap exceeded (${MAX_FIX_ACTIONS}) — unexpected state, manual review required` })
        continue
      }
      actions.push({ id: `mode-${t.tier}`, file: t.file, fromMode: t.fileMode, toMode: 0o600 })
    }
  }
  return { actions, refusals }
}

export function renderFixPlan(plan: FixPlan, applied: boolean): string {
  const lines: string[] = []
  lines.push(applied ? "bb doctor --fix — applied" : "bb doctor --fix — dry run (nothing changed; pass --fix to apply)")
  lines.push("")
  if (plan.actions.length === 0 && plan.refusals.length === 0) {
    lines.push("✓ No permission problems to fix.")
  }
  for (const a of plan.actions) {
    lines.push(`${applied ? "✓" : "·"} ${a.file}: mode ${a.fromMode?.toString(8)} -> ${a.toMode.toString(8)} ${applied ? "(applied)" : "(proposed)"}`)
  }
  for (const ref of plan.refusals) {
    lines.push(`✗ REFUSED ${ref.id}: ${ref.reason}`)
  }
  return lines.join("\n") + "\n"
}

export function applyDoctorFixes(opts: {
  cwd?: string
  env?: Record<string, string | undefined>
  dataDir?: string
  /** default false: dry-run. Only an explicit apply mutates. */
  apply?: boolean
}): { plan: FixPlan; applied: boolean } {
  const plan = planDoctorFixes(opts)
  const applied = opts.apply === true
  if (applied) {
    for (const a of plan.actions) {
      // The action targets a config file identified by the diagnosis itself;
      // re-verify it is still a regular file right before chmod.
      try {
        const st = statSync(a.file)
        if (!st.isFile()) throw new Error("not a regular file")
        chmodSync(a.file, a.toMode)
      } catch {
        // File vanished or changed between plan and apply: surface as refusal
        // rather than mutating something unverified.
        plan.refusals.push({ id: a.id, reason: "file changed between plan and apply — manual review required" })
        plan.actions = plan.actions.filter((x) => x !== a)
      }
    }
  }
  return { plan, applied }
}
