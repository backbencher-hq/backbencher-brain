// ─────────────────────────────────────────────────────────────────────────────
// ONE rendering of "what is bb going to do about embeddings, and what is wrong
// with it" — shared by `bb doctor`, `bb setup show` and `bb health`.
//
// WHY THIS FILE EXISTS. The three surfaces each re-derived the answer from the
// config files themselves, so each could be wrong in its own way and none of them
// could see a provider failure, because the client kept its failures to itself.
// The result was that a user with a misconfigured or failing endpoint read
// "No embedding configuration" and nothing else: no provider, no env var, no
// kill switch, no fallback, no status code, no action.
//
// The rule this file exists to keep: the surfaces AGREE. They all call
// `buildEmbeddingDiagnosis`, so "what would happen" is computed once. A
// diagnostic that disagrees with the code it diagnoses is worse than none — it
// sends the user to fix a thing that is not broken.
//
// SECRETS. Nothing here can return, print or embed a key. Layers carry
// `keyState: "present" | "absent" | "not-required"`, never a value, and every
// string that came from a provider is already redacted by openai-embed.
//
// NO NETWORK BY DEFAULT. `bb doctor` and `bb health` promise read-only local
// diagnosis (doctor.ts header). A live probe exists (`probeEmbeddingDiagnosis`)
// but is opt-in and makes exactly one bounded call, through the same code
// indexing uses, without reading or writing the client's auth latch — so
// diagnosing a provider cannot change what indexing does next.
// ─────────────────────────────────────────────────────────────────────────────

import {
  assessEndpoint,
  describeEmbeddingSetup,
  isEmbeddingDisabled,
  parseEndpoint,
  readRuntimeOptions,
  type EmbeddingProblemSeverity,
  type EmbeddingSetupProblem,
} from "./embedding-config"
import { classifyStatus, observedEmbeddingFailures, probeEmbeddingEndpoint, type EmbeddingFailureKind } from "./openai-embed"
import { LOCAL_VECTOR_DIMENSION } from "./local-embed"
import { SemanticEngine } from "./engine"
import type { SetupShowState, TierId, TierView } from "../../setup/setup-show"

export type EmbeddingLayerRole = "disabled" | "primary" | "fallback" | "local"

export interface EmbeddingChainLayer {
  /** 0..3 — the order bb actually tries them. */
  order: number
  role: EmbeddingLayerRole
  /** Human name, safe to print. */
  label: string
  /** base URL, or "offline" for the local layer. */
  endpoint: string
  model: string
  /** Never a key value. */
  keyState: "present" | "absent" | "not-required"
  /** Where the endpoint/model came from, e.g. "env:BB_EMBEDDING_BASE_URL". */
  source: string
  /** Would bb actually use this layer? */
  active: boolean
  /** Structural problems with this layer specifically. */
  problems: EmbeddingSetupProblem[]
}

export interface EmbeddingFailureView {
  baseURL: string
  model: string
  status: number
  kind: EmbeddingFailureKind
  /** What the user should do. One line. */
  advice: string
  message: string
  /** True when the client has stopped calling this endpoint for the process. */
  latched: boolean
}

export interface EmbeddingProbeResult {
  ok: boolean
  elapsedMs: number
  endpoint: string
  model: string
  dimension?: number
  status?: number
  kind?: EmbeddingFailureKind
  advice?: string
  message?: string
}

/**
 * `bb setup show`/`bb doctor` pick the winner as the first COMPLETE tier in
 * env > global > project order. The RUNTIME merges the two file tiers the other
 * way round — `Config.get()` is `{...home, ...local, ...explicit}` — so a
 * project's bb.json overrides ~/.bb/config.json. EMBEDDINGS.md says the same
 * ("bb.json in the project root overrides it per project").
 *
 * The two therefore disagree whenever BOTH file tiers are complete, and the
 * consequence is not cosmetic: doctor.ts compares `winnerModel` against the
 * models actually stored in `brain_semantic_embedding` and raises a `fail`
 * whose fix is `bb index --force`. With the tiers reversed the user is told to
 * reindex against the wrong model, and reindexing does not clear the finding.
 *
 * `script/m32/verify-setup-show.ts` asserts "global still outranks project" as
 * the contract, so this is NOT changed here — it is surfaced as a disagreement
 * the user can see, and the fix is reported to master. Silently switching the
 * order would break a passing gate; silently keeping it leaves a lie in the UI.
 */
export interface TierOrderDisagreement {
  reported: TierId | "none"
  actual: string
  detail: string
}

export interface EmbeddingDiagnosis {
  disabled: boolean
  configured: boolean
  /** A remote provider is configured AND structurally usable. */
  remoteReady: boolean
  /** A second provider is present in the chain. */
  fallbackConfigured: boolean
  /** The layer bb would reach first, if any. */
  primaryLayer: EmbeddingChainLayer | null
  chain: EmbeddingChainLayer[]
  problems: EmbeddingSetupProblem[]
  /** Failures the provider has already reported to THIS process. */
  observedFailures: EmbeddingFailureView[]
  /** Only when the caller explicitly probed. */
  probe: EmbeddingProbeResult | null
  tierOrderDisagreement: TierOrderDisagreement | null
}

/** Where the local layer's model label lives, so the two cannot drift in text. */
/**
 * The stored label for the local layer.
 *
 * Read from the engine rather than written here: the previous value was a
 * hand-written string, `local-word-vectors`, plus a parenthetical telling the
 * reader to go find `SemanticEngine.LOCAL_MODEL_LABEL` for the real one. That is
 * the exact false-claim class this codebase cares about — a label that does not
 * match what is stored (the stored one is `local-word-vectors-v3`), printed in a
 * field whose job is to name the model. It also drifted once already, which is
 * why the constant is now imported rather than restated.
 */
const LOCAL_LABEL_HINT = SemanticEngine.LOCAL_MODEL_LABEL

function sourceLabel(tier: TierId, field: "BASE_URL" | "MODEL" | "API_KEY"): string {
  return tier === "env" ? `env:BB_EMBEDDING_${field}` : `file:${tier}`
}

/**
 * The chain, in the order bb resolves it.
 *
 * Pure: derived from the tier view and the environment, so `bb doctor`,
 * `bb setup show` and a test all get the same answer for the same inputs.
 */
export function buildEmbeddingChain(state: SetupShowState, env: NodeJS.ProcessEnv = process.env): EmbeddingChainLayer[] {
  const options = readRuntimeOptions(env)
  const layers: EmbeddingChainLayer[] = []
  const winner = state.tiers.find((t) => t.tier === state.winner && t.complete)

  // 0. The kill switch. Present only when on, because a layer that is switched
  //    off is a state the user needs told about, not a step in the order.
  if (isEmbeddingDisabled(env)) {
    layers.push({
      order: 0,
      role: "disabled",
      label: "embeddings disabled",
      endpoint: "none",
      model: "none",
      keyState: "not-required",
      source: "env:BB_EMBEDDING_DISABLED",
      active: true,
      problems: [],
    })
  }

  // 1. Primary provider.
  if (state.configured && winner) {
    // The SECOND argument to assessEndpoint is key PRESENCE and the THIRD is the
    // key's source label. Passing the label as presence made every configured
    // tier report a key — so the chain said "key present" directly under a
    // finding that said "no key is set", which is worse than either alone.
    const hasKey = typeof winner.keyFingerprint === "string" && winner.keyFingerprint.length > 0
    const readiness = assessEndpoint(
      winner.baseURL ?? "",
      hasKey ? sourceLabel(winner.tier, "API_KEY") : "none",
      hasKey ? sourceLabel(winner.tier, "API_KEY") : "none",
    )
    layers.push({
      order: layers.length,
      role: "primary",
      label: `primary provider (${winner.tier})`,
      endpoint: winner.baseURL ?? "",
      model: winner.model ?? "",
      keyState: readiness.hasKey ? "present" : readiness.loopback ? "not-required" : "absent",
      source: `url ${sourceLabel(winner.tier, "BASE_URL")} · model ${sourceLabel(winner.tier, "MODEL")} · key ${hasKey ? sourceLabel(winner.tier, "API_KEY") : "none"}`,
      active: !options.disabled,
      problems: readiness.problems,
    })
  }

  // 2. Fallback provider — only meaningful when it is actually configured, and
  //    only reachable when a primary exists to fail.
  if (options.fallback) {
    const fbKeySource = options.fallback.apiKey ? "env:BB_EMBEDDING_API_KEY" : "none"
    const readiness = assessEndpoint(options.fallback.baseURL, fbKeySource, "env:BB_EMBEDDING_FALLBACK_API_KEY")
    layers.push({
      order: layers.length,
      role: "fallback",
      label: "fallback provider",
      endpoint: options.fallback.baseURL,
      model: options.fallback.model,
      keyState: readiness.hasKey ? "present" : readiness.loopback ? "not-required" : "absent",
      source: `url env:BB_EMBEDDING_FALLBACK_BASE_URL · model env:BB_EMBEDDING_FALLBACK_MODEL · key ${options.fallback.apiKey ? "env:BB_EMBEDDING_FALLBACK_API_KEY" : "none"}`,
      active: !options.disabled && state.configured,
      problems: readiness.problems,
    })
  }

  // 3. Local word vectors. Always last, always available, and the reason the
  //    chain has no dead end — so it is always shown, even when it is the only
  //    thing that will actually run.
  layers.push({
    order: layers.length,
    role: "local",
    label: "local word vectors",
    endpoint: "offline",
    model: LOCAL_LABEL_HINT,
    keyState: "not-required",
    source: "built in",
    active: true,
    problems: [],
  })

  return layers
}

/**
 * The winner the RUNTIME would use, derived from the same tier view the
 * displayed winner comes from, so the comparison is apples to apples.
 */
function detectTierOrderDisagreement(state: SetupShowState, env: NodeJS.ProcessEnv): TierOrderDisagreement | null {
  if (state.winner !== "global") return null
  const project = state.tiers.find((t) => t.tier === "project")
  if (!project?.complete) return null
  const explicit = (env.BB_CONFIG_FILE ?? "").trim()
  return {
    reported: state.winner,
    actual: explicit ? "BB_CONFIG_FILE" : "project",
    detail:
      `bb setup show and bb doctor report the global tier as the winner, but the runtime merges the file tiers ` +
      `project-last (bb.json overrides ~/.bb/config.json), so indexing actually uses ${explicit ? "BB_CONFIG_FILE" : "the project's bb.json"}` +
      (project.model ? ` (model ${project.model})` : "") + `.`,
  }
}

/**
 * Assemble the whole diagnosis. Read-only, no network.
 *
 * `state` is the existing tier view from setup-show.ts rather than a second
 * resolution of the config, precisely so this cannot become a competing
 * precedence implementation (M40.A8).
 */
/**
 * Per-field source labels, reconstructed from the tier view.
 *
 * Per FIELD, not per tier, because that is the contract: `resolveEmbeddingConfig`
 * resolves each of base URL / model / key independently, so a config with only a
 * base URL reports `sources.baseURL = "env:BB_EMBEDDING_BASE_URL"` and
 * `sources.model = "default"`. Reading the winner tier alone would report both as
 * defaults and turn "you are missing BB_EMBEDDING_MODEL" into "nothing is
 * configured" — a worse message for a partially configured user.
 *
 * Tier order is the displayed order (env > global > project), which is where the
 * documented disagreement with the runtime merge lives; `detectTierOrderDisagreement`
 * reports that separately rather than papering over it here.
 */
function reconstructSources(state: SetupShowState): { baseURL: string; model: string; apiKey: string } {
  const firstWith = (
    field: "BASE_URL" | "MODEL" | "API_KEY",
    pick: (tier: TierView) => string | undefined,
    fallback: string,
  ): string => {
    for (const tier of state.tiers) {
      const value = pick(tier)
      if (typeof value === "string" && value.length > 0) return sourceLabel(tier.tier, field)
    }
    return fallback
  }
  return {
    baseURL: firstWith("BASE_URL", (t) => t.baseURL, "default"),
    model: firstWith("MODEL", (t) => t.model, "default"),
    apiKey: firstWith("API_KEY", (t) => t.keyFingerprint, "none"),
  }
}

export function buildEmbeddingDiagnosis(opts: {
  state: SetupShowState
  env?: NodeJS.ProcessEnv
  /** Failures already observed; injectable so a caller can pass a snapshot. */
  observedFailures?: EmbeddingFailureView[]
}): EmbeddingDiagnosis {
  const env = opts.env ?? process.env
  const state = opts.state
  const chain = buildEmbeddingChain(state, env)
  const winner = state.tiers.find((t) => t.tier === state.winner && t.complete)

  // Reuse the single operational validator. Its input is the effective config
  // shape that resolveEmbeddingConfig produces, reconstructed from the winning
  // tier — the same three fields, read through the one place that reads them.
  const sources = reconstructSources(state)
  const setup = describeEmbeddingSetup(
    { baseURL: winner?.baseURL ?? "", model: winner?.model ?? "", configured: state.configured, sources },
    env,
  )

  const observed: EmbeddingFailureView[] = opts.observedFailures ?? observedEmbeddingFailures().map((f) => ({ ...f, latched: true }))

  return {
    disabled: isEmbeddingDisabled(env),
    configured: state.configured,
    remoteReady: setup.remoteReady && !isEmbeddingDisabled(env),
    fallbackConfigured: chain.some((l) => l.role === "fallback"),
    primaryLayer: chain.find((l) => l.role === "primary") ?? null,
    chain,
    problems: setup.problems,
    observedFailures: observed,
    probe: null,
    tierOrderDisagreement: detectTierOrderDisagreement(state, env),
  }
}

/**
 * Opt-in live probe of the PRIMARY provider: one bounded call, classification
 * from the same code indexing uses, and deliberately no interaction with the
 * client's auth latch so that diagnosing cannot change behaviour.
 */
export async function probeEmbeddingDiagnosis(diagnosis: EmbeddingDiagnosis, env: NodeJS.ProcessEnv = process.env): Promise<EmbeddingDiagnosis> {
  const layer = diagnosis.primaryLayer
  if (!layer || diagnosis.disabled) return { ...diagnosis, probe: null }
  const endpoint = parseEndpoint(layer.endpoint)
  const key = readApiKeyForProbe(layer, env)
  const result = await probeEmbeddingEndpoint(
    { baseURL: layer.endpoint, apiKey: key, model: layer.model },
    { timeoutMs: Math.min(readRuntimeOptions(env).timeoutMs, 15_000) },
  )
  return {
    ...diagnosis,
    probe: {
      ok: result.ok,
      elapsedMs: result.elapsedMs,
      endpoint: layer.endpoint,
      model: layer.model,
      dimension: result.dimension,
      status: result.status,
      kind: result.kind ?? (result.ok ? undefined : classifyStatus(result.status ?? 0)),
      advice: result.advice,
      message: result.message,
    },
  }
}

/**
 * The key for a probe, read from the winning tier only. Returned to the probe
 * and never stored, logged or returned: the probe result carries no key, so a
 * key cannot escape this function by accident.
 */
function readApiKeyForProbe(layer: EmbeddingChainLayer, env: NodeJS.ProcessEnv): string {
  if (layer.keyState === "absent") return ""
  if (layer.source.startsWith("env:")) return env.BB_EMBEDDING_API_KEY ?? ""
  return "" // file-backed keys are never read back here; a probe without one reports 401, which is the honest answer
}

/** Severity mapping for surfaces that have three levels (doctor: fail/warn/info). */
export function severityOf(problem: EmbeddingSetupProblem): EmbeddingProblemSeverity {
  return problem.severity
}

/**
 * One line per layer, for a surface with no room for the aligned block
 * `bb doctor` prints. Returns [] for an empty chain rather than a blank line,
 * so a caller can splice it unconditionally.
 */
export function renderChainSummary(diagnosis: EmbeddingDiagnosis): string[] {
  return diagnosis.chain.map((l) => {
    const mark = l.active ? "→" : " "
    const target = l.role === "local" ? `${l.endpoint} · ${LOCAL_VECTOR_DIMENSION}-dim` : `${l.endpoint} · ${l.model}`
    const key = l.role === "local" || l.role === "disabled" ? "" : ` · key ${l.keyState}`
    return `  ${mark} ${l.order + 1}. ${l.label}: ${target}${key}  [${l.source}]`
  })
}

/** The one-word verdict `bb setup show` prints above the chain. */
export function embeddingChainVerdict(diagnosis: EmbeddingDiagnosis): string {
  if (diagnosis.disabled) return "disabled (BB_EMBEDDING_DISABLED) — local word vectors only"
  if (diagnosis.remoteReady) return diagnosis.fallbackConfigured
    ? "remote ready (primary + fallback)"
    : "remote ready"
  return "remote NOT usable — semantic search degrades to local word vectors"
}

/** The dimension the local layer emits — for a report that states it. */
export const LOCAL_DIMENSION = LOCAL_VECTOR_DIMENSION