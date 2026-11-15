// ─────────────────────────────────────────────────────────────────────────────
// M72 — frozen contract for the per-language security spec engine.
//
// WHAT THIS FILE IS — the types every language spec and the matcher/flow engine
// share. A spec is DATA, not code: rules are regex patterns plus the semantic
// fields the flow engine needs to decide whether a source actually reaches a
// sink. The engine never invents a flow from co-location: a lead is emitted only
// when a sink's argument is dynamic and a source-derived value reaches it, and a
// sanitizer/parameterized pattern is not present.
//
// WHICH TOOL IT SERVES — bb_security (via src/intelligence/security/rebuild).
// WHERE ITS EVIDENCE LIVES — docs/m72-security-rebuild/PLAN.md,
//   validation/m72/**, script/m72/**.
// EDIT TOGETHER WHEN THIS CHANGES — registry.ts, matcher.ts, flow.ts, engine.ts,
//   the per-language spec files, and the m72 verifiers.
// CONTRACTS IT MUST NOT BREAK — tiers are explicit; a sink with a constant
//   argument is never a lead; a same-token self-pair is never a lead; test files
//   are excluded by the pipeline; evidence carries rule id + byte offsets.
// ─────────────────────────────────────────────────────────────────────────────

/** Capability tier. `scan` may use vulnerability vocabulary; `leads` may not. */
export type SecurityTier = "scan" | "leads" | "unsupported"

/** Vulnerability families the engine may emit. Keep in sync with the handler labels. */
export type SecurityVulnerability =
  | "sql_injection"
  | "command_injection"
  | "code_injection"
  | "path_traversal"
  | "xss"
  | "insecure_deserialization"
  | "ssrf"
  | "open_redirect"
  | "weak_crypto"
  | "pii_leak"

/** Where a tainted value entered the symbol. Used for evidence, not for severity alone. */
export type SourceKind =
  | "user_input"
  | "env"
  | "cli"
  | "file"
  | "network"
  | "database"
  | "sensitive"
  | "argv"
  | "unknown"

export type Severity = "critical" | "high" | "medium" | "low"

/** Comment/string syntax for one language. The matcher masks these regions before matching. */
export interface LexicalSyntax {
  /** e.g. ["//", "#"] — a match starts anywhere after one of these on a line */
  lineComments: string[]
  /** e.g. C-style slash-star block comments and HTML comments */
  blockComments: Array<[string, string]>
  /** String delimiters; `escape` is the escape character (default "\\"). */
  strings: Array<{ delimiter: string; escape?: string; multiline?: boolean }>
}

/** A source rule: a call or value that introduces untrusted/derived data. */
export interface SourceRule {
  /** Stable rule id, e.g. "go.http.query". */
  id: string
  /** Regex over the masked symbol text. Must match a call/value expression. */
  pattern: RegExp
  sourceType: SourceKind
  /** Human explanation used in evidence. */
  description: string
  /** When true, the engine records the receiver/variable name from the match. */
  captureVariable?: boolean
}

/** A sink rule: a dangerous API and how its argument is selected. */
export interface SinkRule {
  /** Stable rule id, e.g. "python.sql.execute". */
  id: string
  /** Regex over the masked symbol text. Must match the sink call. */
  pattern: RegExp
  vulnerability: SecurityVulnerability
  /** Engine label for the sink family, e.g. "database_write". */
  sinkType: string
  /** Base severity; the flow engine may raise it to critical only for code/command execution. */
  severity: Severity
  /**
   * Which argument must be dynamic for the sink to be a lead.
   * `first` = first argument expression, `all` = any argument, `any` = any part
   * of the call text after the callee (conservative).
   */
  argument: "first" | "all" | "any"
  /** When true (default), a sink whose selected argument is a constant is not a lead. */
  requiresDynamicArgument?: boolean
  /** Engine label for the dangerous operation, used in evidence. */
  description: string
}

/** A sanitizer/parameterization rule: when present, the sink is not a lead (or is mitigated). */
export interface SanitizerRule {
  id: string
  /** Family this sanitizer applies to, or "*" for all. */
  vulnerability: SecurityVulnerability | "*"
  pattern: RegExp
  /** Evidence text explaining why the flow is excluded. */
  rationale: string
}

/** One language's complete security spec. */
export interface LanguageSecuritySpec {
  language: string
  /** Alternate language ids that resolve to this spec (e.g. tsx -> typescript). */
  aliases?: string[]
  tier: SecurityTier
  /** Why this tier; rendered in docs/evidence. */
  tierReason: string
  lexical: LexicalSyntax
  sources: SourceRule[]
  sinks: SinkRule[]
  sanitizers: SanitizerRule[]
  /** Known limits of this language's rules, rendered in the answer/docs. */
  limits: string[]
}

/** A matched token in a symbol body (byte offsets are relative to the symbol snippet). */
export interface TokenMatch {
  ruleId: string
  byteStart: number
  byteEnd: number
  /** One-based line within the symbol, when the matcher can compute it. */
  line: number
  /** Matched text, trimmed for evidence (bounded). */
  text: string
}

/** One emitted lead, before persistence. */
export interface SecurityLeadEvidence {
  ruleId: string
  vulnerability: SecurityVulnerability
  severity: Severity
  source: TokenMatch
  sink: TokenMatch
  /** The sink argument text the flow engine inspected. */
  argumentText: string
  /** True only when the argument is non-constant dynamic text. */
  dynamic: boolean
  /** Variable/assignment chain used to prove reachability, if any. */
  reachPath: string[]
  /** Sanitizer evidence when the sink was excluded or downgraded. */
  sanitizer?: { ruleId: string; rationale: string }
}

export interface SecurityLeadInput {
  language: string
  symbolId: string
  file: string
  /** One-based line of the symbol declaration (used to derive token lines). */
  symbolLine: number
  evidence: SecurityLeadEvidence
}

/** A rule-level decision returned by the engine for one symbol. */
export interface SecurityLead {
  language: string
  symbolId: string
  file: string
  vulnerability: SecurityVulnerability
  severity: Severity
  ruleId: string
  evidence: SecurityLeadEvidence
  /** Tier of the producing spec at scan time. */
  tier: SecurityTier
  /** `lead` for token-spec output; `candidate` only once reachability is proven. */
  state: "lead" | "candidate"
}
