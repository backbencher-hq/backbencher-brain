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
//   5. the provider chain bb will actually use, in order, with each layer's
//      source env var; every problem with it; and any failure the provider has
//      already reported to this process (401 / 404 / unreachable, each with the
//      action that resolves it).
//
// Check 5 is what this command was missing. "No embedding configuration" is a
// true sentence that answers none of the questions a user actually has: which
// provider, from where, is it working, and what do I run. It is assembled by
// src/brain/semantic/embedding-diagnosis.ts — the same module `bb setup show`
// and `bb health` read — so the three surfaces cannot disagree about what bb is
// going to do, which is the failure mode of every surface deriving its own
// answer.
//
// No network calls by default: `runDoctorChecks` stays synchronous and local.
// `runDoctorChecksWithProbe` opts into exactly one bounded embedding request
// through the same client indexing uses; it does not read or write that
// client's auth latch, so diagnosing a provider cannot change what indexing
// does afterwards. Diagnosis is read-only: --fix (S3) is the only command that
// mutates anything, and only file permissions.
//
// Exit code: 0 when healthy, 1 when at least one FAIL-level finding exists
// (so scripts/CI can branch). WARN findings do not change the exit code.

import { existsSync, readFileSync, statSync, chmodSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { bbDataDir } from "../util/bb-data-dir"
import { SemanticEngine } from "../brain/semantic/engine"
import { fingerprintKey } from "./setup-wizard"
import { describeEmbeddingConfig, type TierView } from "./setup-show"
import {
  buildEmbeddingDiagnosis,
  probeEmbeddingDiagnosis,
  type EmbeddingDiagnosis,
} from "../brain/semantic/embedding-diagnosis"
import { isEmbeddingDisabled } from "../brain/semantic/embedding-config"
import { LOCAL_VECTOR_DIMENSION } from "../brain/semantic/local-embed"

// Repository root — resolve once, cheap and stable for createRequire.
const ROOT_PKG = path.resolve(import.meta.dirname ?? ".", "../..")

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
  /**
   * What bb will actually do about embeddings, and what is wrong with it.
   * Present so `renderDoctorReport` can answer "which provider, from which env
   * var, is it failing, what do I run" instead of only "no configuration".
   */
  diagnosis?: EmbeddingDiagnosis
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

/**
 * The exact action for each env var the diagnosis can name.
 *
 * A finding that says "missing BB_EMBEDDING_BASE_URL" and stops there has moved
 * the user from not knowing to almost knowing. `bb setup` is the answer wherever
 * it can be — it hides the key on input and writes the file 0600 — so it is
 * named for the key, and the export form is given for the endpoint and model,
 * which are not secret and which an operator usually wants in their own shell.
 */
const ENV_FIX: Record<string, string> = {
  BB_EMBEDDING_BASE_URL: "export BB_EMBEDDING_BASE_URL=https://<host>/v1   (or: bb setup)",
  BB_EMBEDDING_MODEL: "export BB_EMBEDDING_MODEL=<model>   (or: bb setup)",
  BB_EMBEDDING_API_KEY: "bb setup",
  BB_EMBEDDING_DISABLED: "unset BB_EMBEDDING_DISABLED",
  BB_EMBEDDING_FALLBACK_BASE_URL: "export BB_EMBEDDING_FALLBACK_BASE_URL=... and BB_EMBEDDING_FALLBACK_MODEL=...",
  BB_EMBEDDING_FALLBACK_MODEL: "export BB_EMBEDDING_FALLBACK_MODEL=... and BB_EMBEDDING_FALLBACK_BASE_URL=...",
}

/** Map one diagnosis problem onto a doctor finding, or null when it is covered. */
function findingForProblem(
  index: number,
  problem: { severity: string; envVar: string | null; message: string },
  localLabel: string,
): Finding | null {
  // The "no provider configured at all" problem duplicates the existing
  // `no-config` finding (which knows about the wizard-skip marker), and
  // `semantic-degraded` already states the local fallback. Reporting a third
  // copy of the same fact is how a diagnostic list stops being read.
  if (/^No embedding provider is configured/.test(problem.message)) return null
  const id = `embed-${problem.envVar ? problem.envVar.toLowerCase().replace(/_/g, "-") : `problem-${index}`}`
  const fix = problem.envVar ? ENV_FIX[problem.envVar] : undefined
  return {
    id,
    severity: problem.severity === "error" ? "fail" : "warn",
    message: problem.message,
    fix: fix ?? `bb setup   (semantic search falls back to ${localLabel})`,
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
}): DoctorReport {
  const cwd = opts.cwd ?? process.cwd()
  const env = opts.env ?? process.env
  const dataDir = opts.dataDir ?? bbDataDir()
  const state = describeEmbeddingConfig(cwd, env, dataDir)

  const findings: Finding[] = []
  // Read the label from the engine rather than repeating the string. The local
  // label is versioned (`local-word-vectors-v3`) because a tokenizer change
  // makes old and new vectors occupy different spaces, and a hardcoded copy
  // here would report every re-embedded project as a mismatched model.
  const localLabel = SemanticEngine.LOCAL_MODEL_LABEL

  // One shared rendering of the chain, for the findings below and for the
  // renderer. `describeEmbeddingConfig` is the existing tier view rather than a
  // fresh read of the config, so this cannot become a second precedence
  // implementation (M40.A8).
  const diagnosis = buildEmbeddingDiagnosis({ state, env: env as NodeJS.ProcessEnv })

  // 0. The kill switch, named as such. `isEmbeddingDisabled` is read directly so
  //    the on/off answer is a first-class finding and not only a side effect of
  //    assembling the chain.
  if (isEmbeddingDisabled(env as NodeJS.ProcessEnv)) {
    findings.push({
      id: "embed-disabled",
      severity: "warn",
      message: "Embeddings are switched off (BB_EMBEDDING_DISABLED), so indexing stores only local word vectors. Nothing else in this report can make them appear.",
      fix: ENV_FIX.BB_EMBEDDING_DISABLED,
    })
  }

  // Every problem the shared validator found, each naming its env var and its
  // action. An `error`-severity problem is a `fail`: bb is not doing what the
  // user configured it to do.
  for (let i = 0; i < diagnosis.problems.length; i++) {
    const finding = findingForProblem(i, diagnosis.problems[i], localLabel)
    if (finding) findings.push(finding)
  }

  // Failures the provider has already reported to THIS process. Read from the
  // client's latch, not re-probed: this is what the provider last said, and a
  // long-lived indexing process is exactly where that knowledge exists.
  for (const failure of diagnosis.observedFailures) {
    findings.push({
      id: `embed-failed-${failure.kind}`,
      severity: failure.kind === "auth" || failure.kind === "not_found" ? "fail" : "warn",
      message:
        `The embedding provider rejected a request during this process: ${failure.status} ${failure.kind} ` +
        `from ${failure.baseURL} (model ${failure.model}). ${failure.advice}`,
      fix: failure.kind === "auth" ? ENV_FIX.BB_EMBEDDING_API_KEY : failure.kind === "not_found" ? ENV_FIX.BB_EMBEDDING_MODEL : "bb index .   (the affected batch fell back to local vectors; re-run to retry)",
    })
  }

  // The tier order this surface reports and the order the runtime uses can
  // disagree; that disagreement changes which model doctor just compared against
  // the index, so it is stated rather than left for the user to discover.
  if (diagnosis.tierOrderDisagreement) {
    findings.push({
      id: "embed-tier-order",
      severity: "warn",
      message: diagnosis.tierOrderDisagreement.detail,
      fix: "bb setup show   (to confirm which file tier is in effect)",
    })
  }

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

  const healthy = !findings.some((f) => f.severity === "fail")
  return { findings, healthy, winner: state.winner, storedModels, diagnosis }
}

/**
 * `runDoctorChecks` plus the one opt-in live probe.
 *
 * Separate from `runDoctorChecks` on purpose: that function is synchronous and
 * read-only, and script/m32/verify-doctor.ts depends on both properties (it
 * source-mutates the file and calls it synchronously from eleven mutants).
 * Making the probe part of it would either make every diagnosis touch the
 * network or break that gate.
 *
 * ── NOT YET REACHABLE FROM `bb doctor`. The CLI owns the flag and lives in
 * │  src/cli/index.ts, which is outside this file's ownership. Until it is
 * │  wired, this function and `probeEmbeddingEndpoint` are reachable only from
 * │  code and tests — `bb doctor` uses the read-only path and reports the
 * │  failures the client has ALREADY been given, which is the larger share of
 * │  what a user needs. The exact wiring required is:
 * │    .option("--probe-embeddings", "make one live embedding request to report 401/404/429/5xx/unreachable (network)")
 * │  and in the action, replacing the `runDoctorChecks` call with an
 * │  `await runDoctorChecksWithProbe(...)` when that flag is set.
 * │  Do NOT probe unconditionally: doctor's documented contract is read-only
 * │  local diagnosis, and an unconditional probe would make every `bb doctor`
 * │  in CI wait on a network round trip.
 */
export async function runDoctorChecksWithProbe(opts: Parameters<typeof runDoctorChecks>[0]): Promise<DoctorReport> {
  const env = opts.env ?? process.env
  const cwd = opts.cwd ?? process.cwd()
  const dataDir = opts.dataDir ?? bbDataDir()
  const report = runDoctorChecks(opts)
  const state = describeEmbeddingConfig(cwd, env, dataDir)
  const probed = await probeEmbeddingDiagnosis(buildEmbeddingDiagnosis({ state, env: env as NodeJS.ProcessEnv }), env as NodeJS.ProcessEnv)
  const probe = probed.probe
  if (!probe) return { ...report, diagnosis: probed }

  const findings = [...report.findings]
  if (probe.ok) {
    findings.push({
      id: "embed-probe-ok",
      severity: "info",
      message: `Embedding provider answered a live probe: ${probe.endpoint} returned ${probe.dimension}-dimensional vectors for ${probe.model} in ${probe.elapsedMs}ms.`,
    })
  } else {
    findings.push({
      id: `embed-probe-${probe.kind ?? "failed"}`,
      // 401/404 cannot be waited out or retried into working; 429 and 5xx can.
      severity: probe.kind === "auth" || probe.kind === "not_found" || probe.kind === "protocol" ? "fail" : "warn",
      message:
        `Embedding provider probe failed: ${probe.status ?? 0} ${probe.kind} from ${probe.endpoint} (model ${probe.model}) after ${probe.elapsedMs}ms. ` +
        `${probe.advice ?? ""} ${probe.message ?? ""}`.trim(),
      fix:
        probe.kind === "auth" ? ENV_FIX.BB_EMBEDDING_API_KEY
        : probe.kind === "not_found" ? ENV_FIX.BB_EMBEDDING_MODEL
        : probe.kind === "protocol" ? ENV_FIX.BB_EMBEDDING_BASE_URL
        : "bb index .   (retry; a rate limit or provider blip degrades the batch to local vectors)",
    })
  }
  const healthy = !findings.some((f) => f.severity === "fail")
  return { ...report, findings, healthy, diagnosis: probed }
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
  const icon: Record<Severity, string> = { fail: "✗", warn: "!", info: "·" }
  for (const f of r.findings) {
    lines.push(`${icon[f.severity]} ${f.message}`)
    if (f.fix) lines.push(`  Fix: ${f.fix}`)
  }

  // The chain, in resolution order, with the env var each layer came from. This
  // is the part that answers "what is bb actually going to call, and how do I
  // change that" — the findings above say what is broken, this says what the
  // machine will do about it either way. Printed even when every finding is
  // clean, because "which provider am I on" is a question worth answering on a
  // healthy install too.
  if (r.diagnosis) {
    lines.push("")
    lines.push(`embedding provider chain (${r.diagnosis.disabled ? "embeddings disabled — local only" : r.diagnosis.remoteReady ? "remote ready" : "remote NOT usable"}):`)
    for (const layer of r.diagnosis.chain) {
      const mark = layer.active ? "→" : " "
      const target = layer.role === "local" ? `${layer.endpoint} · ${LOCAL_VECTOR_DIMENSION}-dim` : `${layer.endpoint} · ${layer.model}`
      const key = layer.role === "local" || layer.role === "disabled" ? "" : ` · key ${layer.keyState}`
      lines.push(`  ${mark} ${layer.order + 1}. ${layer.label}: ${target}${key}  [${layer.source}]`)
    }
    if (r.diagnosis.probe) {
      const p = r.diagnosis.probe
      lines.push("")
      lines.push(
        p.ok
          ? `live probe: ${p.endpoint} ok — ${p.dimension}-dim in ${p.elapsedMs}ms`
          : `live probe: ${p.endpoint} failed — ${p.status ?? 0} ${p.kind} after ${p.elapsedMs}ms`,
      )
    }
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
