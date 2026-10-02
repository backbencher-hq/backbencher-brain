// Direct OpenAI-compatible embeddings client for brain-core. Works with any
// provider exposing POST /embeddings: Google (generativelanguage OpenAI
// compatibility), NVIDIA NIM (api.nvidia.com/v1), OpenAI, and self-hosted
// vLLM/llama.cpp servers. No provider SDK required.
//
// M40.A8: precedence (env BB_EMBEDDING_* > config file > built-in default) is
// defined ONCE in src/config/config.ts resolveEmbeddingConfig(). This module
// consumes it — it must not re-implement or re-document a different order.
// Operational knobs (kill switch, fallback provider, timeout, bounds) live in
// ./embedding-config and are read from env var names M40.A8 does not define.
//
// HTTP CONTRACT — unchanged, deliberately:
//   POST {baseURL}/embeddings
//   body: { model, input: string | string[], encoding_format: "float" }
//   2xx:  { data: [{ embedding: number[] }] }   (order is the request order;
//         servers that return `index` out of order are re-sorted)
// Nothing here changes the wire format other modules rely on.
import { Config, resolveEmbeddingConfig } from "../../config/config"
import * as Log from "../../tool/brain-log"
import {
  assessEndpoint,
  describeEmbeddingSetup,
  parseEndpoint,
  readRuntimeOptions,
  redactSecrets,
  type EmbeddingRuntimeOptions,
  type EmbeddingSetupReport,
} from "./embedding-config"

const log = Log.create({ service: "openai-embed" })

export interface EmbeddingConfig {
  baseURL: string
  apiKey: string
  model: string
  dimension?: number
}

export function isEmbeddingConfigured(config: Record<string, unknown>): boolean {
  // M40.A8: single source of truth — no local env-probing. The kill switch is an
  // operational override, not a precedence tier, so it is layered on top here and
  // in readRuntimeOptions rather than inside resolveEmbeddingConfig.
  return resolveEmbeddingConfig(config).configured && !readRuntimeOptions().disabled
}

export async function getEmbeddingConfig(): Promise<EmbeddingConfig | null> {
  const config = await Config.get()
  const eff = resolveEmbeddingConfig(config)
  if (!eff.configured) return null
  const cfg: EmbeddingConfig = {
    baseURL: eff.baseURL,
    apiKey: eff.apiKey,
    model: eff.model,
    dimension: typeof config.embedding_dimension === "number" ? config.embedding_dimension : undefined,
  }
  // A base URL that cannot be an http(s) endpoint can never succeed, so returning
  // it only buys a guaranteed failure per batch. Returning null here makes
  // getEmbeddingConfig() agree with `parseEndpoint`, which is the same thing the
  // setup validator reports. Keyless-on-a-remote-host is deliberately NOT
  // rejected here: reporting it (`assessEndpoint`) is actionable, refusing to try
  // is not, and some deployments front a remote host with keyless auth.
  if (!parseEndpoint(cfg.baseURL)) {
    log.debug("embedding base URL is not a usable endpoint; remote embeddings off", { baseURL: cfg.baseURL })
    return null
  }
  return cfg
}

/**
 * Startup validation for the CLI / setup surfaces. Read-only, no network, and it
 * never returns a key value — only which env var is missing or broken.
 */
export async function getEmbeddingSetupReport(): Promise<EmbeddingSetupReport> {
  const config = await Config.get()
  return describeEmbeddingSetup(resolveEmbeddingConfig(config))
}

// ── error taxonomy ───────────────────────────────────────────────────────────
//
// The old client raised one opaque `EmbeddingApiError` whose message was
// `embedding API 401: <body>`, and SemanticEngine.embedMany matched on exactly
// one thing — `e.status === 429`. Everything else, a bad key above all, became
// a `log.debug` and a silent degrade to local vectors: the index looked healthy,
// `bb_ask` answers got quietly worse, and nothing told the user to fix their key.
//
// `kind` is the actionable classification. It is derived from the HTTP status,
// never guessed from a message, so it is stable across provider wording.
export type EmbeddingFailureKind =
  | "auth" // 401/403 — the key is wrong or lacks access. Fix the key.
  | "not_found" // 404 — wrong base URL path or unknown model name.
  | "rate_limit" // 429 — valid key, slow down and retry.
  | "server" // 5xx — provider-side, usually transient.
  | "timeout" // no response inside the bound.
  | "network" // DNS, connection refused, TLS.
  | "protocol" // 2xx whose body is not a usable embeddings response.

/** User-facing next action, one line, safe to print. */
const ADVICE: Record<EmbeddingFailureKind, string> = {
  auth: "The provider rejected the API key. Set a valid key, or run `bb setup` to re-enter it. Nothing will be embedded until this is fixed.",
  not_found: "The provider has no /embeddings endpoint at that base URL, or does not know the model name. Check BB_EMBEDDING_BASE_URL and BB_EMBEDDING_MODEL.",
  rate_limit: "Rate limited. The key looks valid; indexing backs off and retries. On a free tier this is a quota, not a fault.",
  server: "The provider returned a server error. Usually transient; indexing retries and falls back per batch meanwhile.",
  timeout: "The provider did not respond in time. Check network reachability and the base URL.",
  network: "Could not reach the provider. Check the base URL and network access.",
  protocol: "The provider answered with something that is not an embeddings response. The base URL is probably not an OpenAI-compatible /v1 endpoint.",
}

export function classifyStatus(status: number): EmbeddingFailureKind {
  if (status === 401 || status === 403) return "auth"
  if (status === 404) return "not_found"
  if (status === 429) return "rate_limit"
  if (status >= 500) return "server"
  if (status >= 400) return "protocol"
  return "server"
}

// Typed API error: carries the HTTP status and (for 429) the Retry-After
// seconds so callers can apply backoff instead of a blanket fallback latch.
export class EmbeddingApiError extends Error {
  status: number
  retryAfterSec?: number
  /** Actionable classification. `status === 429` keeps working unchanged. */
  kind: EmbeddingFailureKind
  /** One line the user can act on. Never contains a key. */
  advice: string
  /** Which provider produced it: "primary" | "fallback". */
  source: string

  constructor(status: number, message: string, retryAfterSec?: number, opts: { kind?: EmbeddingFailureKind; source?: string } = {}) {
    super(message)
    this.name = "EmbeddingApiError"
    this.status = status
    this.retryAfterSec = retryAfterSec
    this.kind = opts.kind ?? (status === 0 ? "network" : classifyStatus(status))
    this.advice = ADVICE[this.kind]
    this.source = opts.source ?? "primary"
  }
}

// ── auth latch ───────────────────────────────────────────────────────────────
//
// A wrong key is not a blip. Before this, every batch of a full index paid a
// round trip that came back 401, then degraded to local vectors — so a run with
// a bad key cost N network timeouts and produced an index that is entirely local
// while reporting no problem. One 401 is enough to know retrying will not help,
// so the endpoint+model pair is latched for the process and later calls fail
// immediately with the same classified error.
//
// Latched on `auth` and `not_found` only. A 429 or a 5xx is NOT latched: those
// recover, and engine.ts already owns a bounded Retry-After window for them —
// latching here would turn a transient blip into a permanent degradation, which
// is precisely the failure mode script/m30/verify-rate-limit.ts exists to catch.
const authLatch = new Map<string, EmbeddingApiError>()

/** Drop latched failures (tests, and a config change within one process). */
export function resetEmbeddingAuthLatch(): void {
  authLatch.clear()
}

/** Latched endpoints — for diagnostics. Contains no secrets. */
export function latchedEmbeddingEndpoints(): string[] {
  return [...authLatch.keys()]
}

function latchKey(baseURL: string, model: string): string {
  return `${baseURL}|${model}`
}

// ── the request ──────────────────────────────────────────────────────────────

interface AttemptResult {
  vectors: number[][]
}

function chunk<T>(items: T[], size: number): T[][] {
  if (size <= 1 || items.length <= size) return [items]
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms)
    // Never hold the event loop open for a backoff wait.
    if (typeof t === "object" && t && typeof (t as { unref?: () => void }).unref === "function") (t as { unref: () => void }).unref()
  })
}

function backoffFor(attempt: number, opts: EmbeddingRuntimeOptions, retryAfterSec?: number): number {
  // Retry-After is the provider telling us exactly how long; honour it, capped.
  if (retryAfterSec && retryAfterSec > 0) {
    return Math.min(retryAfterSec * 1000, opts.retryCapMs) + Math.floor(Math.random() * 100)
  }
  const exponential = opts.retryBaseMs * 2 ** attempt
  const capped = Math.min(exponential, opts.retryCapMs)
  return capped + Math.floor(Math.random() * Math.max(1, Math.floor(capped / 4)))
}

/** A failure worth another attempt. 4xx other than 429 is the caller's to fix. */
function isRetryable(error: EmbeddingApiError, attempt: number, maxAttempts: number): boolean {
  if (attempt >= maxAttempts - 1) return false
  return error.kind === "rate_limit" || error.kind === "server" || error.kind === "timeout" || error.kind === "network"
}

async function attemptRequest(texts: string[], cfg: EmbeddingConfig, options: EmbeddingRuntimeOptions, source: string): Promise<AttemptResult> {
  const url = `${cfg.baseURL}/embeddings`
  const payload = JSON.stringify({
    model: cfg.model,
    input: texts.length === 1 ? texts[0] : texts,
    encoding_format: "float",
  })
  const parsedUrl = new URL(url)
  const endpoint = parseEndpoint(cfg.baseURL)
  const isLocal = endpoint?.loopback ?? false

  if (isLocal) {
    // Do not send loopback traffic through HTTP_PROXY/ALL_PROXY. Some hosts
    // reject proxy connections to local IPs, which makes the built-in mock and
    // self-hosted embedding endpoints appear unavailable. Keep existing values
    // and append only the loopback hosts used by local embedding servers.
    const loopbackHosts = ["127.0.0.1", "localhost", "::1"]
    for (const key of ["NO_PROXY", "no_proxy"] as const) {
      const existing = process.env[key] ?? ""
      const values = new Set(existing.split(",").map((v) => v.trim()).filter(Boolean))
      for (const host of loopbackHosts) values.add(host)
      process.env[key] = [...values].join(",")
    }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs)
  let res: Response
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
      },
      body: payload,
      signal: controller.signal,
    })
    // The timer MUST stay armed across the body read. It used to be cleared in a
    // `finally` right after fetch resolved — which only means "headers arrived".
    // A provider (or a proxy, or a wedged socket) that sends headers and then
    // stalls left `res.text()` waiting forever, with the abort signal already
    // disarmed and nothing else bounding the call. A hung embeddings request is
    // exactly what must never happen: it wedges the background drainer.
    const status = res.status
    let retryAfterRaw: string | null = null
    if (status === 429 || status === 503) retryAfterRaw = res.headers.get("retry-after")
    const body = await res.text()
    clearTimeout(timer)

    if (status < 200 || status >= 300) {
      // Retry-After may be delta-seconds or an HTTP-date; only delta-seconds
      // are actionable here (dates require clock math we do not do).
      let retryAfterSec: number | undefined
      if (status === 429) {
        const secs = retryAfterRaw ? Number(retryAfterRaw) : NaN
        if (Number.isFinite(secs) && secs > 0) retryAfterSec = secs
      }
      throw new EmbeddingApiError(
        status,
        // Message text is part of the observed contract: script/m21/verify-embedding-provider.ts
        // matches /embedding API 429/ on it. Redaction is added, not substituted.
        `embedding API ${status}: ${redactSecrets(body.slice(0, 200), cfg.apiKey)}`,
        retryAfterSec,
        { source },
      )
    }

    let data: { data: Array<{ embedding?: unknown; index?: unknown }> }
    try {
      data = JSON.parse(body) as typeof data
    } catch {
      throw new EmbeddingApiError(status, `embedding API ${status}: response is not JSON — ${redactSecrets(body.slice(0, 200), cfg.apiKey)}`, undefined, { kind: "protocol", source })
    }
    if (!data || !Array.isArray(data.data)) {
      throw new EmbeddingApiError(status, `embedding API ${status}: response has no data array`, undefined, { kind: "protocol", source })
    }

    // Servers are supposed to return results in request order and are allowed to
    // say so with `index`. Sorting by a present index is a no-op for the ones
    // that omit it, and rescues the ones that do not.
    const rows = [...data.data]
    if (rows.some((row) => typeof row?.index === "number")) {
      rows.sort((a, b) => (typeof a?.index === "number" ? a.index : 0) - (typeof b?.index === "number" ? b.index : 0))
    }
    const embeddings = rows.map((row) => row?.embedding)

    // Count mismatch is checked FIRST, and with the original wording, because it
    // is the exact failure script/m21/verify-embedding-provider.ts asserts on
    // (`returned 1 vectors for 2 inputs`).
    if (embeddings.length !== texts.length) {
      throw new Error(`embedding API returned ${embeddings.length} vectors for ${texts.length} inputs`)
    }
    return { vectors: validateVectors(embeddings, texts.length, cfg, source) }
  } catch (e: any) {
    clearTimeout(timer)
    if (e?.name === "EmbeddingApiError") throw e
    if (e?.name === "AbortError") {
      throw new EmbeddingApiError(0, `embedding provider did not respond within ${options.timeoutMs}ms`, undefined, { kind: "timeout", source })
    }
    throw new EmbeddingApiError(0, `embedding request failed: ${redactSecrets(String(e?.message ?? e).slice(0, 200), cfg.apiKey)}`, undefined, { kind: "network", source })
  }
}

/**
 * Every vector in a stored batch must be the same length and every component
 * finite. This is the guard on the dimension story:
 *
 *  - a mixed-dimension batch would be written to `brain_semantic_embedding` under
 *    ONE `embedding_model` label with a per-row `vector_dimension`, producing an
 *    index whose rows silently disagree about the space they are in;
 *  - a NaN/Infinity component serialises into the float32 blob and makes every
 *    later cosine comparison with that row NaN, which the ranker drops — one bad
 *    row silently removed from search with no error anywhere.
 *
 * A wrong dimension against `cfg.dimension` is the same failure one step
 * earlier: the provider was swapped (or reconfigured) without a forced reindex,
 * so the vectors being written are in a different space than the ones already
 * stored under this model label.
 */
function validateVectors(embeddings: unknown[], expected: number, cfg: EmbeddingConfig, source: string): number[][] {
  const out: number[][] = []
  let dimension: number | null = null
  for (let i = 0; i < embeddings.length; i++) {
    const vector = embeddings[i]
    if (!Array.isArray(vector) || vector.length === 0) {
      throw new EmbeddingApiError(200, `embedding API returned a non-vector for input ${i} of ${expected}`, undefined, { kind: "protocol", source })
    }
    for (const component of vector) {
      if (typeof component !== "number" || !Number.isFinite(component)) {
        throw new EmbeddingApiError(200, `embedding API returned a non-finite component in vector ${i}`, undefined, { kind: "protocol", source })
      }
    }
    if (dimension === null) dimension = vector.length
    else if (vector.length !== dimension) {
      throw new EmbeddingApiError(
        200,
        `embedding API returned mixed dimensions (${dimension} and ${vector.length}) in one batch — these vectors cannot be stored together`,
        undefined,
        { kind: "protocol", source },
      )
    }
    out.push(vector as number[])
  }
  if (cfg.dimension !== undefined && dimension !== null && dimension !== cfg.dimension) {
    throw new EmbeddingApiError(
      200,
      `embedding API returned ${dimension}-dimensional vectors but BB_EMBEDDING_DIMENSION declares ${cfg.dimension} — refusing to store vectors from a different space than the index already holds under "${cfg.model}". Reindex with the real dimension, or unset BB_EMBEDDING_DIMENSION.`,
      undefined,
      { kind: "protocol", source },
    )
  }
  return out
}

/**
 * Embed texts against an OpenAI-compatible endpoint.
 *
 * ORDERING OF THE FAILURE HANDLING, because it is the whole point of this
 * function having grown a fallback chain:
 *
 *  - the PRIMARY provider makes exactly ONE attempt per call. Its retry is the
 *    per-batch path in engine.ts (`_apiRetryAt`, Retry-After honoured, no
 *    process-wide latch), which script/m30/verify-rate-limit.ts pins to an exact
 *    HTTP call count per failure schedule. Adding a second, client-side retry
 *    loop here would double-retry, change those counts, and turn a recovered
 *    batch into a local one.
 *  - the FALLBACK provider, when configured, DOES retry with bounded
 *    exponential backoff — it is new surface with no existing gate, and a
 *    failover that fires once and gives up is not a failover.
 *  - when neither yields vectors, the error propagates. SemanticEngine catches
 *    it and degrades THAT batch to local word vectors, so indexing still
 *    completes. That is layer 3 of the chain and it is not this module's job.
 */
export async function embedOpenAICompatible(
  texts: string[],
  cfg: EmbeddingConfig,
  optionsOverride?: EmbeddingRuntimeOptions,
): Promise<number[][]> {
  if (!Array.isArray(texts) || texts.length === 0) return []
  const options = optionsOverride ?? readRuntimeOptions()
  if (options.disabled) {
    throw new EmbeddingApiError(0, "embeddings are disabled (BB_EMBEDDING_DISABLED)", undefined, { kind: "protocol", source: "primary" })
  }

  const latched = authLatch.get(latchKey(cfg.baseURL, cfg.model))
  if (latched) throw latched

  try {
    return await runProvider(texts, cfg, options, "primary", 1)
  } catch (primaryError: any) {
    if (primaryError?.name !== "EmbeddingApiError") throw primaryError
    if (primaryError.kind === "auth" || primaryError.kind === "not_found") {
      // Cache the failure so the rest of this process does not pay for it again.
      // Log at warn, not debug: this is the one provider failure a user can fix.
      log.warn("embedding provider rejected the request; further calls skipped for this process", {
        kind: primaryError.kind,
        status: primaryError.status,
        source: primaryError.source,
        advice: primaryError.advice,
      })
      authLatch.set(latchKey(cfg.baseURL, cfg.model), primaryError)
      throw primaryError
    }
    if (!options.fallback) throw primaryError

    log.debug("primary embedding provider failed; trying the configured fallback", {
      kind: primaryError.kind,
      status: primaryError.status,
    })
    const fbCfg: EmbeddingConfig = {
      baseURL: options.fallback.baseURL,
      apiKey: options.fallback.apiKey,
      model: options.fallback.model,
      dimension: cfg.dimension,
    }
    const fbLatched = authLatch.get(latchKey(fbCfg.baseURL, fbCfg.model))
    if (fbLatched) throw fbLatched
    try {
      const vectors = await runProvider(texts, fbCfg, options, "fallback", options.fallbackRetries + 1)
      log.debug("fallback embedding provider served the batch", { model: fbCfg.model })
      return vectors
    } catch (fallbackError: any) {
      if (fallbackError?.name === "EmbeddingApiError" && (fallbackError.kind === "auth" || fallbackError.kind === "not_found")) {
        log.warn("fallback embedding provider rejected the request; further calls skipped for this process", {
          kind: fallbackError.kind,
          status: fallbackError.status,
        })
        authLatch.set(latchKey(fbCfg.baseURL, fbCfg.model), fallbackError)
      }
      throw fallbackError
    }
  }
}

async function runProvider(
  texts: string[],
  cfg: EmbeddingConfig,
  options: EmbeddingRuntimeOptions,
  source: string,
  maxAttempts: number,
): Promise<number[][]> {
  // One request per chunk, and the chunk size is a CEILING rather than a
  // partition: a 100-input indexing batch is still a single request, which is the
  // property that keeps this off "one HTTP request per vector". It matters that
  // it IS a single request — a failure in any chunk of a multi-chunk call discards
  // the whole call (SemanticEngine degrades the entire batch to local vectors, so
  // a partial result has no consumer), which means needless fragmentation turns an
  // unrelated later failure into a loss of earlier completed work.
  const batches = chunk(texts, Math.max(1, options.maxInputsPerRequest))
  const out: number[][] = []
  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b]
    let attempt = 0
    for (;;) {
      try {
        const result = await attemptRequest(batch, cfg, options, source)
        out.push(...result.vectors)
        break
      } catch (e: any) {
        const err: EmbeddingApiError = e?.name === "EmbeddingApiError" ? e : new EmbeddingApiError(0, String(e?.message ?? e), undefined, { kind: "network", source })
        if (!isRetryable(err, attempt, maxAttempts)) throw err
        const wait = backoffFor(attempt, options, err.retryAfterSec)
        log.debug("embedding attempt failed; backing off before retry", {
          source,
          attempt: attempt + 1,
          maxAttempts,
          kind: err.kind,
          status: err.status,
          waitMs: wait,
        })
        await sleep(wait)
        attempt++
      }
    }
  }
  return out
}

/**
 * A short, loggable description of the active provider chain. Safe to print:
 * contains no key, only whether one is present.
 */
export async function describeEmbeddingChain(): Promise<Array<{ role: string; baseURL: string; model: string; hasKey: boolean; readiness: "ready" | "problem" }>> {
  const config = await Config.get()
  const eff = resolveEmbeddingConfig(config)
  const options = readRuntimeOptions()
  const out: Array<{ role: string; baseURL: string; model: string; hasKey: boolean; readiness: "ready" | "problem" }> = []
  if (eff.configured) {
    const readiness = assessEndpoint(eff.baseURL, eff.sources.apiKey, eff.sources.apiKey)
    out.push({
      role: options.disabled ? "primary (disabled)" : "primary",
      baseURL: eff.baseURL,
      model: eff.model,
      hasKey: eff.apiKey !== "" || readiness.loopback,
      readiness: options.disabled || readiness.problems.some((p) => p.severity === "error") ? "problem" : "ready",
    })
  }
  if (options.fallback) {
    const fb = assessEndpoint(options.fallback.baseURL, options.fallback.apiKey ? "env:BB_EMBEDDING_API_KEY" : "none", "env:BB_EMBEDDING_FALLBACK_API_KEY")
    out.push({
      role: "fallback",
      baseURL: options.fallback.baseURL,
      model: options.fallback.model,
      hasKey: options.fallback.apiKey !== "" || fb.loopback,
      readiness: fb.problems.some((p) => p.severity === "error") ? "problem" : "ready",
    })
  }
  out.push({ role: "local word vectors", baseURL: "offline", model: "local-word-vectors", hasKey: false, readiness: "ready" })
  return out
}

export { assessEndpoint, describeEmbeddingSetup }