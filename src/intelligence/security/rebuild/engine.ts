// ─────────────────────────────────────────────────────────────────────────────
// M72 — per-symbol security engine (the indexer entry point).
//
// WHAT THIS FILE IS — the orchestration layer the parse pipeline calls once per
// symbol: resolve the language's `LanguageSecuritySpec` (specs/index.ts, with the
// registry's alias table as a fallback), mask + match the symbol body
// (matcher.ts), extract assignment chains and decide sink flows (flow.ts), and
// assemble `SecurityLead` values with complete evidence.
//
// THERE IS NO SOURCE×SINK CARTESIAN PRODUCT HERE. The old detector paired every
// source token with every sink token in a body (`parallel-indexer.ts`) and that
// is the measured 16.0%-precision behaviour M72 replaces. The engine emits a lead
// only when one sink's dangerous argument is dynamic AND a source-derived value
// reaches that argument (directly or through a bounded assignment chain) AND no
// spec sanitizer/parameterization applies. One lead per sink occurrence, using
// the earliest deterministic reaching source.
//
// SPEC-DRIVEN, NOT LANGUAGE-DRIVEN: no language name appears in this file. A
// language without a spec returns `[]`; a spec whose tier is `unsupported`
// returns `[]` (the answer surface declares "not scanned" from the registry, not
// from a silent zero here); an aliased id resolves through the spec's own
// `aliases` and then the registry alias table.
//
// TIER/SEVERITY CONTRACT: `SecurityLead.tier` is the producing spec's tier
// (`leads` in Phase 0/1 — the result is a lead to validate, never a finding).
// `state` is `"lead"`; the engine has no interprocedural proof to justify
// `"candidate"`. Severity is rule-defined, clamped so `critical` only appears for
// command/code execution with dynamic input and no sanitizer.
//
// TEST-/FILE-FILTERING IS THE CALLER'S JOB: the engine is policy-free. It does
// not read the filesystem, skip test paths, or gate on tier beyond the unsupported
// check. The pipeline decides which symbols are eligible before calling in.
//
// WHICH TOOL IT SERVES — bb_security via the parse pipeline (pool-worker →
//   parallel-indexer → brain_security_flow).
// WHERE ITS EVIDENCE LIVES — docs/m72-security-rebuild/PLAN.md §4,
//   script/m72/engine/run.ts (assertion suite).
// EDIT TOGETHER WHEN THIS CHANGES — matcher.ts, flow.ts, spec-types.ts,
//   registry.ts, specs/index.ts, the language spec files, and the m72 verifiers.
// CONTRACTS IT MUST NOT BREAK — synchronous/pure (no I/O, no DB); deterministic
//   ordering; `evidence.source/sink.byteStart` are UTF-8 byte offsets relative to
//   the `source` string handed in; no language hardcoded; no lead without a
//   reaching source.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  LanguageSecuritySpec,
  SecurityLead,
  SecurityLeadEvidence,
  SecurityLeadInput,
  SecurityTier,
  TokenMatch,
} from "./spec-types"
import { matchSymbol, DEFAULT_MATCHES_PER_RULE, DEFAULT_TEXT_LIMIT, type MatchSymbolResult } from "./matcher"
import { evaluateSinkFlow, extractAssignments, type FlowDecision } from "./flow"
import { specForLanguage } from "./specs/index"
import { SECURITY_LANGUAGE_ALIASES } from "./registry"

/** Engine/rules identity for evidence and the answer's engine declaration. */
export const ENGINE_VERSION = "m72-security-engine/1"

/**
 * Lower-camel alias so the pipeline's structural engine adapter (store.ts's
 * `SecurityEngineAdapter.engineVersion`) picks the version up without importing
 * engine internals. Same value as `ENGINE_VERSION`.
 */
export const engineVersion = ENGINE_VERSION

/** One symbol handed to the engine. Offsets in the evidence are relative to `source`. */
export interface AnalyzeSymbolInput {
  /** File language id, e.g. `typescript`; aliases are resolved through the spec/registry. */
  language: string
  /**
   * SYMBOL BODY TEXT ONLY (the snippet `TokenMatch` offsets are relative to),
   * never the whole file. An empty string yields no leads.
   */
  source: string
  /** File path echoed onto leads; default `""`. The engine does not interpret it. */
  file?: string
  /** Symbol id echoed onto leads; default `""`. The persistence layer maps the real id. */
  symbolId?: string
  /** One-based declaration line, used only by `toSecurityLeadInput`. */
  symbolLine?: number
}

/** Optional overrides; the pipeline passes none of them. */
export interface AnalyzeSymbolOptions {
  /**
   * Explicit spec override. `undefined`/omitted = resolve from `language`;
   * `null` = force "no spec" (returns no leads). Used by tests/fixture runners.
   */
  spec?: LanguageSecuritySpec | null
  /** Maximum assignment hops followed while proving reachability (default 3). */
  maxReachDepth?: number
  /** Evidence text bound per match (default 200). */
  textLimit?: number
  /** Matches kept per rule per symbol (default 64). */
  maxMatchesPerRule?: number
}

/** Result of one symbol analysis for a caller that wants the tier too. */
export interface SymbolSecurityAnalysis {
  /** Canonical language id (spec id, or the normalized input id when no spec). */
  language: string
  /** Spec tier, or `null` when no spec resolved. */
  tier: SecurityTier | null
  leads: SecurityLead[]
}

// ── language resolution ──────────────────────────────────────────────────────

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** Lower-cased language id with the registry alias table applied (`tsx` → `typescript`). */
export function normalizeAnalysisLanguage(language: string): string {
  const key = (typeof language === "string" ? language : "").trim().toLowerCase()
  if (key.length === 0) return ""
  return SECURITY_LANGUAGE_ALIASES[key] ?? key
}

/**
 * The spec that will analyse `language`, or `null` when none exists. Resolution
 * order: the spec's own `aliases` (specs/index.ts) then the registry alias table.
 */
export function analysisSpecFor(language: string): LanguageSecuritySpec | null {
  const key = normalizeAnalysisLanguage(language)
  if (key.length === 0) return null
  return specForLanguage(key) ?? specForLanguage((typeof language === "string" ? language : "").trim().toLowerCase())
}

function resolveSpec(input: AnalyzeSymbolInput, options: AnalyzeSymbolOptions): LanguageSecuritySpec | null {
  if (Object.prototype.hasOwnProperty.call(options, "spec")) return options.spec ?? null
  return analysisSpecFor(input?.language ?? "")
}

function canonicalSpecLanguage(spec: LanguageSecuritySpec, fallback: string): string {
  const declared = typeof spec.language === "string" ? spec.language.trim().toLowerCase() : ""
  return declared.length > 0 ? declared : fallback
}

// ── evidence assembly ────────────────────────────────────────────────────────

function toTokenMatch(match: TokenMatch): TokenMatch {
  return {
    ruleId: match.ruleId,
    byteStart: match.byteStart,
    byteEnd: match.byteEnd,
    line: match.line,
    text: match.text,
  }
}

function buildEvidence(sink: MatchSymbolResult["sinks"][number], decision: FlowDecision): SecurityLeadEvidence {
  const source = decision.source
  if (!source) throw new Error("engine-core invariant: accepted flow without a source")
  const evidence: SecurityLeadEvidence = {
    ruleId: sink.ruleId,
    vulnerability: sink.vulnerability,
    severity: decision.severity ?? sink.severity,
    source: toTokenMatch(source),
    sink: toTokenMatch(sink),
    argumentText: decision.argumentText,
    dynamic: decision.dynamic,
    reachPath: [...decision.reachPath],
  }
  return evidence
}

// ── ordering ─────────────────────────────────────────────────────────────────

/**
 * Deterministic lead order: file, symbol id, vulnerability, rule id, sink byte
 * offset, sink byte end, source byte offset. Used inside `analyzeSymbol` and
 * across `analyzeSymbols`; the persistence layer can rely on it.
 */
export function compareSecurityLeads(a: SecurityLead, b: SecurityLead): number {
  return (
    compareStrings(a.file, b.file) ||
    compareStrings(a.symbolId, b.symbolId) ||
    compareStrings(a.vulnerability, b.vulnerability) ||
    compareStrings(a.ruleId, b.ruleId) ||
    a.evidence.sink.byteStart - b.evidence.sink.byteStart ||
    a.evidence.sink.byteEnd - b.evidence.sink.byteEnd ||
    a.evidence.source.byteStart - b.evidence.source.byteStart
  )
}

// ── the entry points ─────────────────────────────────────────────────────────

function analyzeSymbolInternal(input: AnalyzeSymbolInput, options: AnalyzeSymbolOptions): SymbolSecurityAnalysis {
  const inputLanguage = typeof input?.language === "string" ? input.language : ""
  const normalizedLanguage = normalizeAnalysisLanguage(inputLanguage)
  const spec = resolveSpec(input, options)
  if (!spec) return { language: normalizedLanguage, tier: null, leads: [] }

  const language = canonicalSpecLanguage(spec, normalizedLanguage)
  const tier = spec.tier
  if (tier === "unsupported") return { language, tier, leads: [] }

  const source = typeof input?.source === "string" ? input.source : ""
  if (source.trim().length === 0) return { language, tier, leads: [] }

  const textLimit =
    typeof options.textLimit === "number" && options.textLimit > 0 ? options.textLimit : DEFAULT_TEXT_LIMIT
  const maxMatchesPerRule =
    typeof options.maxMatchesPerRule === "number" && options.maxMatchesPerRule > 0
      ? options.maxMatchesPerRule
      : DEFAULT_MATCHES_PER_RULE

  const match = matchSymbol(spec, source, { textLimit, maxMatchesPerRule })
  const assignments = extractAssignments(match)
  const leads: SecurityLead[] = []
  const seen = new Set<string>()

  for (const sink of match.sinks) {
    const decision = evaluateSinkFlow(spec, match, sink, assignments, { maxReachDepth: options.maxReachDepth })
    if (!decision.accepted || !decision.source || !decision.severity) continue
    const identity = `${sink.ruleId}:${sink.byteStart}:${sink.byteEnd}:${decision.source.byteStart}`
    if (seen.has(identity)) continue
    seen.add(identity)
    leads.push({
      language,
      symbolId: typeof input.symbolId === "string" ? input.symbolId : "",
      file: typeof input.file === "string" ? input.file : "",
      vulnerability: sink.vulnerability,
      severity: decision.severity,
      ruleId: sink.ruleId,
      evidence: buildEvidence(sink, decision),
      tier,
      state: "lead",
    })
  }

  leads.sort(compareSecurityLeads)
  return { language, tier, leads }
}

/**
 * Analyse one symbol body and return its security leads.
 *
 * Synchronous and pure. Returns `[]` — never throws — for: no spec for the
 * language, `tier: "unsupported"`, an empty/non-string source, a body with no
 * source/sink pairing, or a sink whose argument is constant / sanitized /
 * self-paired / unreachable. The returned leads are sorted deterministically.
 */
export function analyzeSymbol(input: AnalyzeSymbolInput, options: AnalyzeSymbolOptions = {}): SecurityLead[] {
  return analyzeSymbolInternal(input, options).leads
}

/**
 * Analyse many symbols in one call and return the globally sorted lead list.
 * Equivalent to concatenating `analyzeSymbol` results and sorting with
 * `compareSecurityLeads`; provided because the persistent store wants one shape.
 */
export function analyzeSymbols(
  inputs: readonly AnalyzeSymbolInput[],
  options: AnalyzeSymbolOptions = {},
): SecurityLead[] {
  const leads: SecurityLead[] = []
  for (const input of inputs ?? []) {
    for (const lead of analyzeSymbol(input, options)) leads.push(lead)
  }
  leads.sort(compareSecurityLeads)
  return leads
}

/**
 * Convert one in-memory lead to the persistence shape from spec-types.ts.
 * `symbolLine` is the one-based declaration line the caller knows (the lead
 * itself only carries symbol-relative match lines). The returned evidence object
 * is the same plain data the lead exposes — callers must not mutate it.
 */
export function toSecurityLeadInput(lead: SecurityLead, symbolLine: number): SecurityLeadInput {
  return {
    language: lead.language,
    symbolId: lead.symbolId,
    file: lead.file,
    symbolLine: Number.isFinite(symbolLine) ? Math.trunc(symbolLine) : 0,
    evidence: lead.evidence,
  }
}

/**
 * One symbol's leads plus the tier that produced them, for callers that persist
 * a tier column. `tier` is `null` only when no spec resolved.
 */
export function analyzeSymbolWithTier(
  input: AnalyzeSymbolInput,
  options: AnalyzeSymbolOptions = {},
): SymbolSecurityAnalysis {
  return analyzeSymbolInternal(input, options)
}
