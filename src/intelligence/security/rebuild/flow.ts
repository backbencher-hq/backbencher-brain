// ─────────────────────────────────────────────────────────────────────────────
// M72 — the flow/evidence layer of the spec-driven security engine.
//
// WHAT THIS FILE IS — the decision layer between "a sink token exists" and "a
// lead is emitted". For one sink match it answers five questions, in this order:
//
//   1. IS THE DANGEROUS ARGUMENT DYNAMIC? A string/number/boolean literal (and a
//      literal-only expression such as `"a" + "b"`) is constant; a constant
//      argument is NEVER a lead, even when a spec sets
//      `requiresDynamicArgument: false` (the frozen contract in spec-types.ts).
//   2. IS THE SOURCE AND SINK THE SAME TOKEN? A source match that overlaps the
//      sink match is a self-pair (`RegExp.prototype.exec` matched by both a
//      "regex result" source rule and a `child_process.exec` sink rule) and is
//      discarded, not paired.
//   3. DOES A SOURCE-DERIVED VALUE ACTUALLY REACH THE ARGUMENT? Directly (the
//      source expression is inside the argument) or through a bounded
//      intra-symbol assignment chain (`x = req.body; db.query("..." + x)`), max
//      `DEFAULT_MAX_REACH_DEPTH` hops. There is no source×sink cartesian
//      product: a source that does not reach this argument contributes nothing.
//   4. IS THE SINK SANITIZED/PARAMETERIZED? A spec sanitizer whose vulnerability
//      matches (or is `*`) is tested against the ORIGINAL sink-call text, the
//      accepted argument text, and every assignment expression on the reach
//      path. Running sanitizers on the original text is deliberate: a
//      parameterized SQL placeholder (`?`, `$1`) lives INSIDE a string literal
//      that the matcher masked for token matching, and it must still be able to
//      exclude the sink.
//   5. WHAT SEVERITY MAY BE EMITTED? Rule-defined, but `critical` is reserved
//      for command/code execution with a dynamic argument and no sanitizer; a
//      SQL sink whose rule claims `critical` is lowered to `high`.
//
// WHY ASSIGNMENTS ARE EXTRACTED LEXICALLY — the engine runs on symbol bodies
// from a multi-language AST with no type/alias information. A bounded lexical
// chain (declaration keywords stripped, type annotations skipped, RHS continued
// across lines only while brackets are open or the line ends on an operator) is
// conservative in the right direction: it can miss a flow, but it cannot invent
// one from co-location.
//
// WHICH TOOL IT SERVES — bb_security via engine.ts.
// WHERE ITS EVIDENCE LIVES — docs/m72-security-rebuild/PLAN.md (the 16.0%
//   precision baseline and the "constant fopen / .exec() / comment" false
//   positives), script/m72/engine/run.ts.
// EDIT TOGETHER WHEN THIS CHANGES — matcher.ts (match shape), engine.ts
//   (lead assembly), spec-types.ts (contract), the per-language spec files.
// CONTRACTS IT MUST NOT BREAK — constant argument never leads; self-pair never
//   leads; sanitized sinks never lead; severity never exceeds command/code
//   execution; one deterministic source per sink; no language name in this file.
// ─────────────────────────────────────────────────────────────────────────────

import type { LanguageSecuritySpec, SanitizerRule, Severity, SinkRule } from "./spec-types"
import type {
  MaskedSource,
  MatchSymbolResult,
  SecuritySinkMatch,
  SecuritySourceMatch,
  SinkCallArgument,
  SinkSpan,
} from "./matcher"
import { lineAt } from "./matcher"

/** Maximum assignment hops followed while proving reachability. */
export const DEFAULT_MAX_REACH_DEPTH = 3

/** Bound on an assignment expression kept in evidence / reachPath. */
const ASSIGNMENT_TEXT_LIMIT = 160
/** Bound on a text region inspected by a sanitizer pattern. */
const SANITIZER_TEXT_LIMIT = 2000

/** One `variable = expression` assignment found in the symbol body. */
export interface AssignmentNode {
  /** Normalised target: a simple name or a dotted member chain (`this.sql`). */
  variable: string
  /** Proof text for evidence (`variable = expression`), trimmed and bounded. */
  expression: string
  /** Trimmed masked RHS — identifiers only, comments/string contents blanked. */
  maskedExpression: string
  /** Code-unit span of the assignment target in the symbol source. */
  targetStart: number
  targetEnd: number
  /** Code-unit span of the RHS expression in the symbol source. */
  expressionStart: number
  expressionEnd: number
  /** One-based line of the assignment target within the symbol. */
  line: number
}

/** Why a sink did not produce a lead. Never surfaced as a finding; used by tests/evidence. */
export type FlowRejection =
  | "self_pair"
  | "no_argument"
  | "constant_argument"
  | "no_reaching_source"
  | "sanitized"

/** One selector candidate (an argument expression, or the `any` trailing span). */
export interface FlowCandidate {
  kind: "argument" | "trailing"
  /** Argument index (0 for the trailing candidate). */
  index: number
  charStart: number
  charEnd: number
  /** Trimmed original-source text (bounded by the matcher's text limit). */
  text: string
  /** Trimmed masked text — lexical checks only. */
  masked: string
}

/** Options for `evaluateSinkFlow`. */
export interface FlowOptions {
  /** Maximum assignment hops followed while proving reachability. */
  maxReachDepth?: number
}

/** The complete flow decision for one sink match. */
export interface FlowDecision {
  accepted: boolean
  /** Set when `accepted` is false. */
  rejection?: FlowRejection
  /** The argument the decision was made about (first candidate for rejects). */
  argument: FlowCandidate | null
  /** True when the inspected argument contains a non-literal atom. */
  dynamic: boolean
  /** Emitted severity (only on accepted decisions). */
  severity?: Severity
  /** The source whose value reaches the argument (only on accepted decisions). */
  source?: SecuritySourceMatch
  /**
   * Evidence chain. First element is the source rule id; every following element
   * is one assignment expression from the source towards the sink.
   */
  reachPath: string[]
  /** Original-source text of the accepted argument. */
  argumentText: string
  /** Set when the sink was excluded by a sanitizer/parameterization rule. */
  sanitizer?: { ruleId: string; rationale: string }
}

// ── lexical predicates ───────────────────────────────────────────────────────

const CONSTANT_LITERALS = new Set(["true", "false", "null", "nil", "none", "undefined", "nan", "infinity"])

const RESERVED_TARGETS = new Set([
  "if",
  "else",
  "while",
  "for",
  "do",
  "switch",
  "case",
  "default",
  "return",
  "break",
  "continue",
  "throw",
  "try",
  "catch",
  "finally",
  "new",
  "delete",
  "typeof",
  "instanceof",
  "in",
  "of",
  "yield",
  "function",
  "class",
  "def",
  "lambda",
  "import",
  "export",
  "from",
  "package",
  "using",
  "namespace",
  "struct",
  "enum",
  "interface",
  "type",
  "void",
  "this",
  "self",
  "super",
  "true",
  "false",
  "null",
  "nil",
  "none",
  "undefined",
  "and",
  "or",
  "not",
])

const DECLARATION_MODIFIER_PATTERN =
  /^(?:export|public|private|protected|internal|static|final|readonly|const|constexpr|let|var|val|auto|my|local|mut|volatile|register|synchronized)\s+/i

function isWhitespaceCode(code: number): boolean {
  return code === 32 || code === 9 || code === 10 || code === 13 || code === 11 || code === 12
}

function isIdentifierStart(code: number): boolean {
  return (
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    code === 95 ||
    code === 36 ||
    code > 127
  )
}

function isIdentifierPart(code: number): boolean {
  return isIdentifierStart(code) || (code >= 48 && code <= 57)
}

function isWhitespaceAt(text: string, index: number): boolean {
  return index >= 0 && index < text.length && isWhitespaceCode(text.charCodeAt(index))
}

/**
 * Conservative "is this expression dynamic?" test over MASKED text: true when at
 * least one identifier atom appears that is not a literal keyword. String
 * contents are already blanked, so `"SELECT * FROM t"` is constant while
 * `"SELECT * FROM t" + name` is dynamic.
 */
export function isDynamicExpression(masked: string): boolean {
  const text = typeof masked === "string" ? masked : ""
  let i = 0
  while (i < text.length) {
    const code = text.charCodeAt(i)
    if (!isIdentifierStart(code)) {
      i += 1
      continue
    }
    let end = i + 1
    while (end < text.length && isIdentifierPart(text.charCodeAt(end))) end += 1
    const token = text.slice(i, end)
    if (!CONSTANT_LITERALS.has(token.toLowerCase())) return true
    i = end
  }
  return false
}

/**
 * True when the source and sink matches cover the same CALLEE TOKEN (shared span).
 *
 * The self-pair is "the source rule matched the sink's own name" — `r.URL.Query()`
 * as a SQL sink, or `/x/.exec(` as a command. It is a property of the callee token,
 * NOT of the whole call: a source inside the argument list (`subprocess.run(
 * sys.argv[1], shell=True)`, `fopen(argv[1], "r")`, `os.system(cmd)`) is a real
 * flow, not a self-pair. The earlier test compared against the entire call span
 * (callee + parentheses + arguments), so every such source was silently dropped as
 * `self_pair` — measured as a false negative on the Python `subprocess_shell`
 * fixture, where `python.cmd.subprocess_shell` never fired.
 *
 * `callStart` is the callee match start; the callee token ends where the argument
 * list opens. Both bounds are exclusive.
 */
export function isSelfPair(source: SecuritySourceMatch, sink: SecuritySinkMatch): boolean {
  const calleeStart = sink.callStart
  const firstArgStart = sink.arguments[0]?.charStart
  const calleeEnd =
    typeof firstArgStart === "number" && Number.isFinite(firstArgStart) && firstArgStart > calleeStart
      ? firstArgStart
      : sink.callEnd > calleeStart
        ? sink.callEnd
        : sink.charEnd
  return source.charStart < calleeEnd && calleeStart < source.charEnd
}

/**
 * Rule-declared severity, clamped by the M72 severity contract: `critical` only
 * for command/code execution with dynamic input and no sanitizer.
 */
export function securitySeverity(
  rule: Pick<SinkRule, "vulnerability" | "severity">,
  dynamic: boolean,
  sanitized: boolean,
): Severity {
  const isExecution = rule.vulnerability === "command_injection" || rule.vulnerability === "code_injection"
  if (rule.severity === "critical" && !(isExecution && dynamic && !sanitized)) return "high"
  return rule.severity
}

// ── selectors ────────────────────────────────────────────────────────────────

function asCandidate(kind: FlowCandidate["kind"], index: number, span: SinkSpan | SinkCallArgument): FlowCandidate {
  return {
    kind,
    index,
    charStart: span.charStart,
    charEnd: span.charEnd,
    text: span.text,
    masked: span.masked,
  }
}

/**
 * Selector semantics from the frozen contract:
 *   first — argument 0 only
 *   all   — every top-level argument is an independent candidate
 *   any   — the call text after the callee (arguments + chained calls, or the
 *           statement tail for non-call sinks such as attribute writes)
 */
export function selectSinkArguments(sink: SecuritySinkMatch): FlowCandidate[] {
  if (sink.argumentSelector === "first") {
    const first = sink.arguments[0]
    return first ? [asCandidate("argument", 0, first)] : []
  }
  if (sink.argumentSelector === "all") {
    return sink.arguments.map((argument) => asCandidate("argument", argument.index, argument))
  }
  return sink.trailing ? [asCandidate("trailing", 0, sink.trailing)] : []
}

// ── assignment extraction ────────────────────────────────────────────────────

interface AssignmentOperator {
  index: number
  length: number
}

function findAssignmentOperators(masked: string): AssignmentOperator[] {
  const operators: AssignmentOperator[] = []
  for (let i = 0; i < masked.length; i++) {
    const char = masked[i]
    if (char === ":" && masked[i + 1] === "=") {
      if (masked[i - 1] === ":") continue // C++/Rust `::` — not an assignment
      operators.push({ index: i, length: 2 })
      i += 1
      continue
    }
    if (char === "<" && masked[i + 1] === "-") {
      if (masked[i + 2] === "-" || masked[i - 1] === "<") continue
      operators.push({ index: i, length: 2 })
      i += 1
      continue
    }
    if (char !== "=") continue
    const previous = masked[i - 1] ?? ""
    const next = masked[i + 1] ?? ""
    if (next === "=" || next === ">" || next === "~") continue // ==, =>, =~
    if ("=!<>+-*/%&|^~?:".includes(previous)) continue // compound/comparison operator
    operators.push({ index: i, length: 1 })
  }
  return operators
}

function statementStartBefore(masked: string, index: number): number {
  let i = index - 1
  while (i >= 0) {
    const char = masked[i]
    if (char === "\n" || char === "\r" || char === ";" || char === "{" || char === "}") return i + 1
    i -= 1
  }
  return 0
}

function lastIdentifier(text: string): string | null {
  const matches = text.match(/[A-Za-z_$][\w$]*/g)
  return matches && matches.length > 0 ? matches[matches.length - 1]! : null
}

/** Index of a single type-annotation colon (not `::`, not inside `<...>`). */
function findTypeColon(text: string): number {
  let angle = 0
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (char === "<") angle += 1
    else if (char === ">") angle = Math.max(0, angle - 1)
    else if (char === ":" && angle === 0 && text[i - 1] !== ":" && text[i + 1] !== ":") return i
  }
  return -1
}

interface ParsedTarget {
  variable: string
  start: number
  end: number
}

function parseAssignmentTarget(masked: string, from: number, to: number): ParsedTarget | null {
  let start = from
  let end = to
  while (start < end && isWhitespaceCode(masked.charCodeAt(start))) start += 1
  while (end > start && isWhitespaceCode(masked.charCodeAt(end - 1))) end -= 1
  if (end <= start) return null
  const raw = masked.slice(start, end)
  // Reject targets that are expressions rather than declaration/assignment lvalues.
  if (/[?=+!~^|]/.test(raw)) return null

  let stripped = raw
  for (;;) {
    const modifier = DECLARATION_MODIFIER_PATTERN.exec(stripped)
    if (!modifier) break
    stripped = stripped.slice(modifier[0].length)
  }
  if (!stripped) return null

  const colon = findTypeColon(stripped)
  if (colon >= 0) {
    // `name: Type` — the variable is the identifier before the annotation.
    const variable = lastIdentifier(stripped.slice(0, colon))
    if (!variable || RESERVED_TARGETS.has(variable.toLowerCase())) return null
    return { variable, start, end }
  }

  // No annotation: a subscript/call target is not a plain variable.
  if (/[[\]()]/.test(stripped)) return null
  const tail = /([A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*)\s*$/.exec(stripped)
  if (!tail?.[1]) return null
  const variable = tail[1].replace(/\s*\.\s*/g, ".")
  const last = variable.slice(variable.lastIndexOf(".") + 1)
  if (RESERVED_TARGETS.has(last.toLowerCase())) return null
  return { variable, start, end }
}

function lineContinues(masked: string, newlineIndex: number): boolean {
  let before = newlineIndex - 1
  while (before >= 0 && (masked[before] === " " || masked[before] === "\t" || masked[before] === "\r")) before -= 1
  const previous = before >= 0 ? masked[before]! : ""
  let after = newlineIndex + 1
  while (after < masked.length && isWhitespaceCode(masked.charCodeAt(after))) after += 1
  const next = after < masked.length ? masked[after]! : ""
  // Only explicit continuation: trailing operator, or leading operator on the
  // next line. Open brackets are handled by depth, not here.
  if (previous && "+-*/%&|^,.<>?:".includes(previous)) return true
  if (next && "+-*/%&|^,.<>:?".includes(next)) return true
  return false
}

function findExpressionEnd(masked: string, from: number): number {
  let depth = 0
  let i = from
  while (i < masked.length) {
    const code = masked.charCodeAt(i)
    if (code === 40 || code === 91 || code === 123) {
      depth += 1
      i += 1
      continue
    }
    if (code === 41 || code === 93 || code === 125) {
      if (depth === 0) break // closes an enclosing scope: the expression ends
      depth -= 1
      i += 1
      continue
    }
    if (depth === 0 && code === 59) break // ;
    if (depth === 0 && (code === 10 || code === 13)) {
      if (lineContinues(masked, i)) {
        i += 1
        continue
      }
      break
    }
    i += 1
  }
  return i
}

function boundedEvidence(source: string, start: number, end: number, limit: number): string {
  const raw = source.slice(Math.max(0, start), Math.min(end, source.length)).trim()
  if (raw.length <= limit) return raw
  return raw.slice(0, Math.max(0, limit)) + "…"
}

/**
 * Extract `variable = expression` nodes from the masked symbol body. Lexical and
 * bounded by design: this proves simple intra-symbol flows, not dataflow.
 */
export function extractAssignments(maskedSource: MaskedSource): AssignmentNode[] {
  const masked = typeof maskedSource?.masked === "string" ? maskedSource.masked : ""
  const source = typeof maskedSource?.source === "string" ? maskedSource.source : ""
  if (masked.length === 0) return []
  const nodes: AssignmentNode[] = []
  const seen = new Set<string>()
  for (const operator of findAssignmentOperators(masked)) {
    const target = parseAssignmentTarget(masked, statementStartBefore(masked, operator.index), operator.index)
    if (!target) continue
    let expressionStart = operator.index + operator.length
    while (expressionStart < masked.length && isWhitespaceCode(masked.charCodeAt(expressionStart))) expressionStart += 1
    const expressionEnd = findExpressionEnd(masked, expressionStart)
    let trimmedEnd = expressionEnd
    while (trimmedEnd > expressionStart && isWhitespaceCode(masked.charCodeAt(trimmedEnd - 1))) trimmedEnd -= 1
    if (trimmedEnd <= expressionStart) continue
    const key = `${target.start}:${expressionStart}`
    if (seen.has(key)) continue
    seen.add(key)
    nodes.push({
      variable: target.variable,
      expression: boundedEvidence(source, expressionStart, trimmedEnd, ASSIGNMENT_TEXT_LIMIT),
      maskedExpression: masked.slice(expressionStart, trimmedEnd),
      targetStart: target.start,
      targetEnd: target.end,
      expressionStart,
      expressionEnd: trimmedEnd,
      line: lineAt(source, target.start),
    })
  }
  nodes.sort((a, b) => a.expressionStart - b.expressionStart || a.targetStart - b.targetStart)
  return nodes
}

// ── reachability ─────────────────────────────────────────────────────────────

function assignmentKey(assignment: AssignmentNode): string {
  return `${assignment.targetStart}:${assignment.expressionStart}`
}

function assignmentMatchesVariable(assignment: AssignmentNode, chain: string): boolean {
  if (assignment.variable === chain) return true
  const assignmentLast = assignment.variable.slice(assignment.variable.lastIndexOf(".") + 1)
  const chainLast = chain.slice(chain.lastIndexOf(".") + 1)
  return assignmentLast === chainLast
}

/** Every identifier / dotted member chain in masked text, in source order. */
export function extractVariableChains(masked: string): string[] {
  const chains: string[] = []
  const text = typeof masked === "string" ? masked : ""
  const pattern = /[A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) !== null) {
    const chain = match[0].replace(/\s*\.\s*/g, ".")
    const last = chain.slice(chain.lastIndexOf(".") + 1)
    if (RESERVED_TARGETS.has(last.toLowerCase())) continue
    chains.push(chain)
  }
  return chains
}

interface ReachResult {
  path: string[]
  assignments: AssignmentNode[]
}

function resolveChain(
  chain: string,
  assignments: AssignmentNode[],
  source: SecuritySourceMatch,
  sinkCharStart: number,
  visited: Set<string>,
  depth: number,
): AssignmentNode[] | null {
  if (depth <= 0) return null
  const candidates = assignments.filter(
    (assignment) =>
      assignment.expressionStart < sinkCharStart &&
      assignmentMatchesVariable(assignment, chain) &&
      !visited.has(assignmentKey(assignment)),
  )
  // Deterministic: the nearest preceding assignment is tried first.
  candidates.sort(
    (a, b) => b.expressionStart - a.expressionStart || b.targetStart - a.targetStart,
  )
  for (const assignment of candidates) {
    if (assignment.expressionStart <= source.charStart && source.charEnd <= assignment.expressionEnd) {
      return [assignment]
    }
    const innerVisited = new Set(visited)
    innerVisited.add(assignmentKey(assignment))
    for (const inner of extractVariableChains(assignment.maskedExpression)) {
      const nested = resolveChain(inner, assignments, source, sinkCharStart, innerVisited, depth - 1)
      if (nested) return [assignment, ...nested]
    }
  }
  return null
}

function tryReach(
  source: SecuritySourceMatch,
  candidate: FlowCandidate,
  assignments: AssignmentNode[],
  sink: SecuritySinkMatch,
  maxDepth: number,
): ReachResult | null {
  // Direct: the source expression is inside the inspected argument.
  if (candidate.charStart <= source.charStart && source.charEnd <= candidate.charEnd) {
    return { path: [source.ruleId], assignments: [] }
  }
  // Variable identity: a rule that declares a source variable (`captureVariable`,
  // e.g. `export let x`, `defineProps`, `request.args`) and a sink that consumes
  // that same identifier are one flow, with no assignment in between. Without this
  // the captured variable is dead data and component/prop code reads as zero —
  // measured: Svelte `export let code; eval(code)` produced no lead while the
  // equivalent `const code = getInput(); eval(code)` did, purely because the second
  // had an assignment to follow.
  if (source.variable && source.variable.length > 0) {
    for (const chain of extractVariableChains(candidate.masked)) {
      if (!assignmentMatchesVariable({ variable: source.variable } as AssignmentNode, chain)) continue
      return { path: [source.ruleId], assignments: [] }
    }
  }
  for (const chain of extractVariableChains(candidate.masked)) {
    const resolved = resolveChain(chain, assignments, source, sink.charStart, new Set(), maxDepth)
    if (resolved) {
      return {
        path: [source.ruleId, ...resolved.map((assignment) => `${assignment.variable} = ${assignment.expression}`)],
        assignments: resolved,
      }
    }
  }
  return null
}

// ── sanitizers ───────────────────────────────────────────────────────────────

function sanitizerTexts(
  match: MatchSymbolResult,
  sink: SecuritySinkMatch,
  candidate: FlowCandidate,
  reach: AssignmentNode[],
): string[] {
  const texts: string[] = []
  const callEnd = Math.max(sink.callEnd, sink.charEnd)
  const callText = match.source.slice(sink.callStart, Math.min(callEnd, sink.callStart + SANITIZER_TEXT_LIMIT)).trim()
  if (callText.length > 0) texts.push(callText)
  if (candidate.text.length > 0) texts.push(candidate.text)
  for (const assignment of reach) {
    texts.push(`${assignment.variable} = ${assignment.expression}`)
  }
  return texts
}

/**
 * First sanitizer in spec order that applies to this vulnerability family and
 * matches one of the inspected texts, or `null`. Patterns run on ORIGINAL text,
 * so parameterized-SQL placeholders are visible.
 */
export function findSanitizer(
  spec: LanguageSecuritySpec,
  vulnerability: SecuritySinkMatch["vulnerability"],
  texts: string[],
): SanitizerRule | null {
  for (const sanitizer of spec?.sanitizers ?? []) {
    if (!sanitizer || !(sanitizer.pattern instanceof RegExp)) continue
    if (sanitizer.vulnerability !== "*" && sanitizer.vulnerability !== vulnerability) continue
    let regex: RegExp
    try {
      regex = new RegExp(sanitizer.pattern.source, sanitizer.pattern.flags.replace(/g/g, ""))
    } catch {
      continue
    }
    for (const text of texts) {
      if (typeof text !== "string" || text.length === 0) continue
      regex.lastIndex = 0
      if (regex.test(text)) return sanitizer
    }
  }
  return null
}

// ── the decision ─────────────────────────────────────────────────────────────

function rejection(
  reason: FlowRejection,
  argument: FlowCandidate | null,
  dynamic: boolean,
  extra: Partial<FlowDecision> = {},
): FlowDecision {
  return {
    accepted: false,
    rejection: reason,
    argument,
    dynamic,
    reachPath: [],
    argumentText: argument?.text ?? "",
    ...extra,
  }
}

/**
 * Decide whether ONE sink match yields a lead, and with which source evidence.
 * Pure and deterministic. There is no cartesian product: the function returns at
 * most one accepted flow, anchored on a single sink occurrence.
 */
export function evaluateSinkFlow(
  spec: LanguageSecuritySpec,
  match: MatchSymbolResult,
  sink: SecuritySinkMatch,
  assignments: AssignmentNode[],
  options: FlowOptions = {},
): FlowDecision {
  // A source that covers the sink token is the same token, not a flow. This is
  // checked before argument selection: the self-pair is a property of the match,
  // not of the call shape.
  const reachableSources = (match.sources ?? []).filter((source) => !isSelfPair(source, sink))
  const candidates = selectSinkArguments(sink)
  if ((match.sources ?? []).length > 0 && reachableSources.length === 0) {
    return rejection("self_pair", candidates[0] ?? null, isDynamicExpression(candidates[0]?.masked ?? ""))
  }
  if (candidates.length === 0) return rejection("no_argument", null, false)

  const dynamicCandidates = candidates.filter((candidate) => isDynamicExpression(candidate.masked))
  if (dynamicCandidates.length === 0) {
    const first = candidates[0] ?? null
    return rejection("constant_argument", first, false)
  }

  const orderedSources = [...reachableSources].sort(
    (a, b) => a.charStart - b.charStart || (a.ruleId < b.ruleId ? -1 : a.ruleId > b.ruleId ? 1 : 0),
  )
  const maxDepth =
    typeof options.maxReachDepth === "number" && options.maxReachDepth > 0
      ? options.maxReachDepth
      : DEFAULT_MAX_REACH_DEPTH

  for (const candidate of dynamicCandidates) {
    for (const source of orderedSources) {
      const reach = tryReach(source, candidate, assignments, sink, maxDepth)
      if (!reach) continue
      const sanitizer = findSanitizer(spec, sink.vulnerability, sanitizerTexts(match, sink, candidate, reach.assignments))
      if (sanitizer) {
        return rejection("sanitized", candidate, true, {
          source,
          reachPath: reach.path,
          argumentText: candidate.text,
          sanitizer: { ruleId: sanitizer.id, rationale: sanitizer.rationale },
        })
      }
      return {
        accepted: true,
        argument: candidate,
        dynamic: true,
        severity: securitySeverity(sink, true, false),
        source,
        reachPath: reach.path,
        argumentText: candidate.text,
      }
    }
  }

  const firstDynamic = dynamicCandidates[0] ?? null
  return rejection("no_reaching_source", firstDynamic, true)
}
