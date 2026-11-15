// ─────────────────────────────────────────────────────────────────────────────
// OPERATIONAL embedding configuration — the knobs `resolveEmbeddingConfig` does
// not own.
//
// WHAT THIS FILE IS NOT: a second precedence implementation. The three fields
// that decide WHICH provider is used — base URL, model, API key — are resolved
// in exactly one place, `src/config/config.ts resolveEmbeddingConfig()` (M40.A8),
// and nothing here reads `BB_EMBEDDING_BASE_URL` / `_MODEL` / `_API_KEY` or
// `embedding_base_url` / `_model` / `_api_key`. That separation is enforced by
// script/m40/verify-a8-config.ts and it is load-bearing: a second implementation
// is how a precedence bug becomes invisible.
//
// WHAT THIS FILE IS: the operational layer around that decision — the kill
// switch, the optional fallback provider, timeouts, retry policy, request size
// bounds, and a startup validator that names the exact env var that is missing.
// All of it is read from NEW `BB_EMBEDDING_*` names that M40.A8 does not define.
//
// SECRETS: this module never returns, logs, or embeds an API key value. It
// returns only `hasKey: boolean` and a `keySource` label. `redactSecrets()` is
// the single redaction helper used on anything derived from a provider response.
//
// FALLBACK CHAIN (the documented order). Every layer is opt-in except the last:
//   0. BB_EMBEDDING_DISABLED      -> local word vectors only, zero HTTP calls
//   1. primary provider           -> env/config per resolveEmbeddingConfig
//   2. BB_EMBEDDING_FALLBACK_*    -> a second provider, used only when the
//                                    primary fails AND a fallback is configured
//   3. local word vectors         -> always available, offline, 50-dim
// Layers 1 and 2 live in openai-embed.ts; layer 3 is local-embed.ts. Layer 3 is
// invoked by SemanticEngine.embed/embedMany (engine.ts), which is the only place
// that knows whether it is indexing or querying — so a caller that gets vectors
// back from the client has already been through every configured remote layer.
// ─────────────────────────────────────────────────────────────────────────────

/** Loopback hosts: an embedding server on the same machine legitimately has no key. */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"])

export interface EmbeddingRuntimeOptions {
  /** Kill switch. When true no HTTP embedding call is ever attempted. */
  disabled: boolean
  /** Whole-request bound in ms, covering headers AND body. */
  timeoutMs: number
  /** Maximum inputs per /embeddings request. A CEILING, not a partition. */
  maxInputsPerRequest: number
  /** Client-side retries for the FALLBACK provider. Default 2, bounded. */
  fallbackRetries: number
  /** First backoff step in ms; doubles per attempt, plus jitter, capped. */
  retryBaseMs: number
  /** Ceiling for one backoff wait. */
  retryCapMs: number
  /** Optional second provider, tried only after the primary fails. */
  fallback: { baseURL: string; model: string; apiKey: string } | null
  /**
   * The vector width the configured model is EXPECTED to return, asserted by the
   * client rather than requested from it. `undefined` means "whatever the model
   * returns".
   *
   * Why it exists: `embedding_dimension` in a config file was plumbed all the way
   * into `EmbeddingConfig.dimension` and then read by nobody, so declaring a
   * dimension was a comment. An assertion turns it into a guard on the one
   * failure that is otherwise silent and permanent — a provider or model swapped
   * without a forced reindex writes vectors of a new width under the SAME
   * `embedding_model` label, and every later query then compares a query vector
   * of one width against stored rows of another and finds none of them, which
   * reports itself only as "no matching model embeddings".
   */
  assertedDimension?: number
}

export type EmbeddingProblemSeverity = "error" | "warning"

export interface EmbeddingSetupProblem {
  severity: EmbeddingProblemSeverity
  /** The env var a user must set, or null when the problem is about the value of a set var. */
  envVar: string | null
  /** Never contains a secret — only whether a key is present and where it came from. */
  message: string
}

/** The verdict for a candidate remote configuration. */
export interface EndpointReadiness {
  usable: boolean
  /** Host is a loopback address, so a missing API key is expected and fine. */
  loopback: boolean
  hasKey: boolean
  /** Where the key came from, for display. Never the key itself. */
  keySource: "env:BB_EMBEDDING_API_KEY" | "file:embedding_api_key" | "none"
  problems: EmbeddingSetupProblem[]
}

function intFromEnv(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (raw === undefined || raw === "") return fallback
  const n = Number(raw)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.floor(n)))
}

/**
 * Is the kill switch on?
 *
 * Accepts `1/true/yes/on` (on) and `0/false/no/off` (off). An unrecognised value
 * is treated as OFF — a typo must not silently disable a provider the user paid
 * for, so the cost of a mistake here is a warning from `describeEmbeddingSetup`,
 * not a silent degradation. (The opposite choice — fail closed — is right for a
 * security control and wrong for a cost/quality switch.)
 */
export function isEmbeddingDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (env.BB_EMBEDDING_DISABLED ?? "").trim().toLowerCase()
  if (raw === "") return false
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on"
}

export function readRuntimeOptions(env: NodeJS.ProcessEnv = process.env): EmbeddingRuntimeOptions {
  const fbBase = (env.BB_EMBEDDING_FALLBACK_BASE_URL ?? "").trim()
  const fbModel = (env.BB_EMBEDDING_FALLBACK_MODEL ?? "").trim()
  const fbKey = (env.BB_EMBEDDING_FALLBACK_API_KEY ?? "").trim()
  return {
    disabled: isEmbeddingDisabled(env),
    timeoutMs: intFromEnv(env.BB_EMBEDDING_TIMEOUT_MS, 30_000, 1_000, 600_000),
    // 256, and the number is load-bearing rather than arbitrary.
    //
    // The indexer already chunks to `maxBatch = 100` snippets per call, so 256
    // keeps every real indexing request a SINGLE request. An earlier default of
    // 64 fragmented those 100-item batches into 64 + 36, and because a failure in
    // any chunk discards the whole batch (SemanticEngine falls back to local for
    // all of it, so a partial result is useless) the second request's failure
    // threw away the first request's 64 good vectors. Measured: a mock that
    // answered once and then 503ed stored 0 API vectors for 260 snippets under
    // the 64 default, and all 260 under this one — the run no longer loses a
    // completed request to an unrelated failure. 2048 is OpenAI's own input
    // ceiling; staying well under it keeps self-hosted servers (llama.cpp caps
    // far lower) working without configuration.
    maxInputsPerRequest: intFromEnv(env.BB_EMBEDDING_MAX_INPUTS, 256, 1, 2048),
    // Only the fallback provider retries inside the client. The PRIMARY provider's
    // retry is the per-batch path in engine.ts (`_apiRetryAt` + per-batch degrade),
    // which script/m30/verify-rate-limit.ts pins to EXACT call counts; a second
    // client-side retry loop for the primary would double-retry and change those
    // counts. See verifyNoteOnRetryOwnership below.
    fallbackRetries: intFromEnv(env.BB_EMBEDDING_FALLBACK_RETRIES, 2, 0, 5),
    retryBaseMs: intFromEnv(env.BB_EMBEDDING_RETRY_BASE_MS, 250, 10, 10_000),
    retryCapMs: intFromEnv(env.BB_EMBEDDING_RETRY_CAP_MS, 4_000, 100, 60_000),
    fallback: fbBase && fbModel ? { baseURL: fbBase.replace(/\/+$/, ""), model: fbModel, apiKey: fbKey } : null,
    assertedDimension: readDimensionAssertion(env),
  }
}

/**
 * `BB_EMBEDDING_DIMENSION` — a positive integer, or undefined.
 *
 * A non-numeric or non-positive value is IGNORED rather than coerced, so a typo
 * cannot turn into an assertion that fails every request (which would degrade
 * every batch to local vectors). `describeEmbeddingSetup` reports the bad value
 * so it is visible instead of silently absent.
 */
function readDimensionAssertion(env: NodeJS.ProcessEnv): number | undefined {
  const raw = (env.BB_EMBEDDING_DIMENSION ?? "").trim()
  if (raw === "") return undefined
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return undefined
  return Math.floor(n)
}

/** The raw, unvalidated dimension assertion — for reporting a rejected value. */
export function rawDimensionAssertion(env: NodeJS.ProcessEnv = process.env): string {
  return (env.BB_EMBEDDING_DIMENSION ?? "").trim()
}

/**
 * Is this base URL structurally usable?
 *
 * A value that cannot be a URL is worth catching before the first request rather
 * than after a 401 from whatever the resolver turned it into. Returns null for
 * an unparseable or non-http(s) URL.
 */
export function parseEndpoint(baseURL: string): { host: string; loopback: boolean } | null {
  let parsed: URL
  try {
    parsed = new URL(baseURL)
  } catch {
    return null
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null
  return { host: parsed.hostname, loopback: LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase()) }
}

/**
 * Validate a candidate remote endpoint. Reports problems a user can act on, and
 * names the env var for each one. Never reads a secret back out.
 *
 * The `keySource` / `apiKeySource` inputs are the *labels* `resolveEmbeddingConfig`
 * already produced — this function cannot see the key value, only where it came
 * from and whether one exists.
 */
export function assessEndpoint(
  baseURL: string,
  keySource: string,
  apiKeySource: string,
): EndpointReadiness {
  const problems: EmbeddingSetupProblem[] = []
  const parsed = parseEndpoint(baseURL)
  const hasKey = keySource !== "none" && keySource !== "default"

  if (!parsed) {
    problems.push({
      severity: "error",
      envVar: "BB_EMBEDDING_BASE_URL",
      message: `embedding base URL is not a usable http(s) endpoint (${JSON.stringify(baseURL)}). Set BB_EMBEDDING_BASE_URL to a full OpenAI-compatible /v1 URL, e.g. https://openrouter.ai/api/v1`,
    })
    return { usable: false, loopback: false, hasKey, keySource: keySource as EndpointReadiness["keySource"], problems }
  }

  if (!parsed.loopback && !hasKey) {
    // This is the silent-degradation case: base URL + model set, no key. Without
    // this check the engine treats the provider as configured and pays a failed
    // round trip per batch forever, then degrades each batch to local vectors
    // with no message anywhere telling the user their key is missing.
    problems.push({
      severity: "error",
      envVar: "BB_EMBEDDING_API_KEY",
      message:
        `embedding provider ${parsed.host} is not local, so it needs a key, and none is set (source: ${apiKeySource}). ` +
        "Set BB_EMBEDDING_API_KEY, or point BB_EMBEDDING_BASE_URL at a loopback endpoint that needs no key. " +
        "Until then every batch degrades to local word vectors.",
    })
  } else if (!parsed.loopback && hasKey && apiKeySource === "default") {
    problems.push({
      severity: "warning",
      envVar: null,
      message: "embedding key resolved from a config file; confirm that file is mode 0600 (bb doctor --fix)",
    })
  }

  return { usable: true, loopback: parsed.loopback, hasKey, keySource: keySource as EndpointReadiness["keySource"], problems }
}

/**
 * The startup validation the CLI/setup surfaces: what is configured, what is
 * broken, and what to set. Assembled from the M40.A8 resolver plus this file's
 * operational layer, so it can never disagree with what the client will do.
 */
export interface EmbeddingSetupReport {
  /** True when a remote provider is configured AND structurally usable. */
  remoteReady: boolean
  /** True when the kill switch is on. */
  disabled: boolean
  /** True when a second provider is configured as a fallback. */
  fallbackConfigured: boolean
  problems: EmbeddingSetupProblem[]
}

export function describeEmbeddingSetup(
  eff: { baseURL: string; model: string; configured: boolean; sources: { baseURL: string; model: string; apiKey: string } },
  env: NodeJS.ProcessEnv = process.env,
): EmbeddingSetupReport {
  const options = readRuntimeOptions(env)
  const problems: EmbeddingSetupProblem[] = []

  if (options.disabled) {
    return {
      remoteReady: false,
      disabled: true,
      fallbackConfigured: options.fallback !== null,
      problems: [
        {
          severity: "warning",
          envVar: "BB_EMBEDDING_DISABLED",
          message: "embeddings are disabled (BB_EMBEDDING_DISABLED). Indexing uses local word vectors; no embedding request will be made.",
        },
      ],
    }
  }

  if (!eff.configured) {
    // Say WHICH var is missing. resolveEmbeddingConfig can only report that the
    // fields came from the default tier; a user who exported a key and nothing
    // else has no way to learn that the key alone is not enough.
    const missingEnvVar = eff.sources.baseURL === "default" ? "BB_EMBEDDING_BASE_URL" : "BB_EMBEDDING_MODEL"
    const sourceHint =
      eff.sources.baseURL === "default" && eff.sources.model === "default"
        ? "No embedding provider is configured, so semantic search uses local word vectors (50-dim, keyword-level). To enable a provider run `bb setup`, or set both BB_EMBEDDING_BASE_URL and BB_EMBEDDING_MODEL."
        : `Embedding provider is partially configured: ${missingEnvVar} is not set. Set ${missingEnvVar} (and BB_EMBEDDING_API_KEY for a hosted endpoint).`
    problems.push({ severity: "warning", envVar: missingEnvVar, message: sourceHint })
  } else {
    const readiness = assessEndpoint(eff.baseURL, eff.sources.apiKey, eff.sources.apiKey)
    problems.push(...readiness.problems)
  }

  // A malformed assertion is reported rather than silently dropped: the client
  // ignores it, so without this the user has set a knob that does nothing and no
  // surface will say so.
  const rawDimension = rawDimensionAssertion(env)
  if (rawDimension !== "" && options.assertedDimension === undefined) {
    problems.push({
      severity: "warning",
      envVar: "BB_EMBEDDING_DIMENSION",
      message: `BB_EMBEDDING_DIMENSION is set to ${JSON.stringify(rawDimension)}, which is not a positive integer. The assertion is ignored — vectors of any width will be accepted.`,
    })
  }

  if (options.fallback) {
    const fb = assessEndpoint(options.fallback.baseURL, options.fallback.apiKey ? "env:BB_EMBEDDING_API_KEY" : "none", "env:BB_EMBEDDING_FALLBACK_API_KEY")
    for (const problem of fb.problems) {
      problems.push({
        ...problem,
        message: `fallback provider: ${problem.message}`,
        envVar: problem.envVar ? problem.envVar.replace("BB_EMBEDDING_API_KEY", "BB_EMBEDDING_FALLBACK_API_KEY").replace("BB_EMBEDDING_BASE_URL", "BB_EMBEDDING_FALLBACK_BASE_URL") : null,
      })
    }
    if (!options.fallback.model) {
      problems.push({ severity: "error", envVar: "BB_EMBEDDING_FALLBACK_MODEL", message: "fallback provider is missing BB_EMBEDDING_FALLBACK_MODEL" })
    }
  } else {
    const wantsFallback = (env.BB_EMBEDDING_FALLBACK_BASE_URL ?? "") !== "" || (env.BB_EMBEDDING_FALLBACK_MODEL ?? "") !== ""
    if (wantsFallback) {
      problems.push({
        severity: "error",
        envVar: wantsFallback && (env.BB_EMBEDDING_FALLBACK_BASE_URL ?? "") === "" ? "BB_EMBEDDING_FALLBACK_BASE_URL" : "BB_EMBEDDING_FALLBACK_MODEL",
        message: "BB_EMBEDDING_FALLBACK_BASE_URL / BB_EMBEDDING_FALLBACK_MODEL are set inconsistently; both are required for the fallback provider",
      })
    }
  }

  return {
    remoteReady: eff.configured && problems.every((p) => p.severity !== "error"),
    disabled: false,
    fallbackConfigured: options.fallback !== null,
    problems,
  }
}

/**
 * Replace any secret with a placeholder.
 *
 * Applied to every provider-derived string that can reach a log line, an error
 * message, or a validation file. Provider error bodies are attacker-adjacent
 * input (a user can point BB_EMBEDDING_BASE_URL anywhere), and some gateways echo
 * the request — including headers — back in the error. script/m21/verify-embedding-provider.ts
 * already asserts the key is absent from captured errors; this makes that true by
 * construction rather than by luck.
 */
export function redactSecrets(text: string, ...secrets: Array<string | undefined>): string {
  let out = text
  for (const secret of secrets) {
    if (typeof secret !== "string" || secret.length < 8) continue
    while (out.includes(secret)) out = out.replaceAll(secret, "[REDACTED]")
  }
  // A bearer token can appear base64-ish or URL-encoded in an echoed body.
  return out.replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, "$1[REDACTED]")
}

/**
 * Why the PRIMARY provider does not retry inside this client.
 *
 * Kept next to the code because the next reader will otherwise "fix" the missing
 * retry loop. The answer is that the retry EXISTS, one layer up: engine.ts
 * `embedMany` degrades a failed batch to local vectors and leaves the run
 * un-latched, and `_apiRetryAt` holds a bounded Retry-After window. That design
 * is pinned by script/m30/verify-rate-limit.ts, which asserts the EXACT number of
 * HTTP calls a storm/blip schedule makes (2 in both cases). A client-side retry
 * loop for the primary would turn those into 3 and 4 and would degrade batch 1 to
 * a local vector that the gate expects to come back on the API. So: primary =
 * one attempt per batch, engine owns the retry; fallback provider = client-owned
 * retry, because it is new surface with no gate to break.
 */
export const verifyNoteOnRetryOwnership =
  "primary retry is engine.ts _apiRetryAt (script/m30/verify-rate-limit.ts pins its call counts); " +
  "fallback provider retry is owned here, bounded by BB_EMBEDDING_FALLBACK_RETRIES"