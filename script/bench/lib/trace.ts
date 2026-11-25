// script/bench/lib/trace.ts — read a run's NDJSON event stream as evidence, not as a log.
//
// WHY THIS EXISTS.
//
// The DSH headless `--json` stream carries NO timestamps. Verified against
// @deepseek-ai/dsh-headless/src/json-stream.ts: the seven emitted types are session,
// status, text, thinking, tool_call, tool_result, final, and none has a time field.
// So the discovery-tax endpoint -- "how much did the agent spend before it found the
// right file" -- has to be built from two different clocks:
//
//   * TOKENS come from the harness (`step_end.usage`), carry no timing assumption, and
//     are therefore the PRIMARY measure. `usage` is omitted when any attempt in a step
//     failed to report a sample, so a step total can be genuinely unknown; that is
//     represented as null here, never as 0.
//   * MILLISECONDS are stamped by the runner as lines arrive. That is an UPPER BOUND on
//     the agent's own latency (it includes pipe + scheduling), so it is used only for
//     ordering and for relative comparison between arms, which suffer the same bound.
//     It must never become a wall-clock speedup claim.
//
// Everything downstream (report.ts, grade.ts) recomputes from these events rather than
// from any stored summary. That is what makes a published number checkable: doctoring a
// figure would require doctoring the trace.

import { readFileSync } from "node:fs"

/** One line of `trace.ndjson`, as written by the runner. */
export interface TraceEvent {
  type: string
  /** ms since run start, stamped by the runner on arrival (upper bound). */
  _t_ms?: number
  [k: string]: unknown
}

export interface ToolCall {
  callId: string
  tool: string
  input: unknown
  /** Null when the call produced no recorded result (aborted run, crash). */
  result: { status: string; result: string } | null
  /** Runner arrival time, ms. */
  atMs: number | null
}

export interface Usage {
  inputTokens: number | null
  outputTokens: number | null
}

export interface TraceSummary {
  sessionId: string | null
  cwd: string | null
  events: number
  toolCalls: ToolCall[]
  /** Per-tool call counts. Keys are harness tool names (`bash`, `mcp__bb__bb_search`). */
  toolCounts: Record<string, number>
  /** bb MCP tool names that were actually CALLED (prefix `mcp__bb__`). */
  bbToolsCalled: string[]
  /** Calls whose tool name starts with `mcp__bb__`, whatever the outcome. */
  bbCallCount: number
  /** Calls whose name starts with `mcp__bb__` and whose result was an error. */
  bbRefusals: number
  /** Answers that declared a lexical/keyword fallback. Counted, not inferred. */
  bbFallbackAnswers: number
  /** Input bytes returned by all tools -- a size proxy, not a token count. */
  toolResultBytes: number
  /** Tool calls that appear to install packages or reach the network. */
  suspiciousCalls: { callId: string; tool: string; why: string }[]
  /** Sum of step_end.usage, or null when any step omitted a usage sample. */
  usage: Usage
  usageComplete: boolean
  finalText: string
  /** Reason from the terminal `final` event. */
  finalReason: string | null
  turnStartMs: number | null
  firstToolCallMs: number | null
}

const INSTALL_OR_NET = /(^|[\s;&|])(curl|wget)\s|(^|[\s;&|])(npm|pnpm|yarn)\s+(i|install|add)\b|(^|[\s;&|])pip3?\s+install\b|(^|[\s;&|])apt(-get)?\s+install\b|(^|[\s;&|])brew\s+install\b|(^|[\s;&|])cargo\s+(add|install)\b|(^|[\s;&|])go\s+get\b/

/** The tool name an MCP server exposes is `mcp__<server>__<tool>`. */
export function isBbTool(name: string): boolean {
  return name.startsWith("mcp__bb__")
}

/** Parse a trace file written by the runner. Throws on a malformed line: a trace we
 *  cannot read is not evidence, and silently skipping lines would under-count. */
export function readTrace(tracePath: string): TraceEvent[] {
  const raw = readFileSync(tracePath, "utf8")
  const out: TraceEvent[] = []
  const lines = raw.split("\n")
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (line.length === 0) continue
    try {
      out.push(JSON.parse(line) as TraceEvent)
    } catch {
      throw new Error(`trace: line ${i + 1} of ${tracePath} is not JSON. A partial trace is not evidence; re-run instead of reading it.`)
    }
  }
  return out
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null
}

/** Reduce a trace to the facts the report and the grader need. */
export function summarize(events: TraceEvent[]): TraceSummary {
  const calls = new Map<string, ToolCall>()
  let sessionId: string | null = null
  let cwd: string | null = null
  let finalText = ""
  let finalReason: string | null = null
  let inputTokens = 0
  let outputTokens = 0
  let anyTokens = false
  let usageComplete = true
  let turnStartMs: number | null = null
  let firstToolCallMs: number | null = null
  const suspicious: { callId: string; tool: string; why: string }[] = []
  let toolResultBytes = 0
  let bbFallbackAnswers = 0

  for (const e of events) {
    const t = typeof e._t_ms === "number" ? e._t_ms : null
    switch (e.type) {
      case "session":
        if (typeof e.sessionId === "string") sessionId = e.sessionId
        if (typeof e.cwd === "string") cwd = e.cwd
        break
      case "status": {
        if (e.phase === "turn_start" && turnStartMs === null) turnStartMs = t
        if (e.phase === "step_end") {
          const u = e.usage as Record<string, unknown> | undefined
          const inT = num(u?.inputTokens)
          const outT = num(u?.outputTokens)
          if (inT === null || outT === null) {
            // The harness omits usage entirely when any attempt failed to report a
            // sample. That makes the step total UNKNOWABLE -- it must not read as 0.
            usageComplete = false
          } else {
            inputTokens += inT
            outputTokens += outT
            anyTokens = true
          }
        }
        break
      }
      case "tool_call": {
        const callId = typeof e.callId === "string" ? e.callId : ""
        const tool = typeof e.tool === "string" ? e.tool : ""
        if (firstToolCallMs === null && t !== null) firstToolCallMs = t
        calls.set(callId, { callId, tool, input: e.input, result: null, atMs: t })
        const s = JSON.stringify(e.input ?? "")
        const m = INSTALL_OR_NET.exec(s)
        if (m) suspicious.push({ callId, tool, why: m[0].trim() })
        break
      }
      case "tool_result": {
        const callId = typeof e.callId === "string" ? e.callId : ""
        const c = calls.get(callId)
        const result = typeof e.result === "string" ? e.result : ""
        toolResultBytes += result.length
        if (typeof result === "string" && /keyword|lexical/i.test(result) && /not semantic|lexical, not semantic|KEYWORD match/i.test(result)) {
          bbFallbackAnswers++
        }
        if (c) c.result = { status: typeof e.status === "string" ? e.status : "unknown", result }
        break
      }
      case "final": {
        if (typeof e.text === "string") finalText = e.text
        const r = e.reason as Record<string, unknown> | undefined
        if (r && typeof r.kind === "string") finalReason = r.kind
        break
      }
      default:
        break
    }
  }

  const toolCalls = [...calls.values()]
  const toolCounts: Record<string, number> = {}
  for (const c of toolCalls) toolCounts[c.tool] = (toolCounts[c.tool] ?? 0) + 1
  const bbCalls = toolCalls.filter((c) => isBbTool(c.tool))

  return {
    sessionId,
    cwd,
    events: events.length,
    toolCalls,
    toolCounts,
    bbToolsCalled: [...new Set(bbCalls.map((c) => c.tool))].sort(),
    bbCallCount: bbCalls.length,
    bbRefusals: bbCalls.filter((c) => c.result?.status === "error").length,
    bbFallbackAnswers,
    toolResultBytes,
    suspiciousCalls: suspicious,
    usage: { inputTokens: anyTokens ? inputTokens : null, outputTokens: anyTokens ? outputTokens : null },
    usageComplete,
    finalText,
    finalReason,
    turnStartMs,
    firstToolCallMs,
  }
}

/**
 * The discovery tax, measured in tokens. This is the PRIMARY measure because the trace
 * carries no harness timestamps (see the header).
 *
 * WHY NOT "tokens before the first tool call": measured on a real trace, the harness
 * emits `tool_call` BEFORE the `step_end` that reports that step's usage. The first tool
 * call therefore happens inside the first step, whose usage is only known at the END of
 * it -- so a prefix measurement is structurally impossible, not merely missing. An
 * earlier version of this function returned null here and would have read as "unknown"
 * rather than "unmeasurable as asked".
 *
 * What IS measurable, and what the report actually needs: the input-token volume the
 * agent burned before it first edited one of the golden files. A step's `inputTokens` is
 * the full prompt sent for that step, so summing the steps that completed before the
 * step containing that edit is the real context burden incurred to find the file.
 *
 * `staticPrefixTokens` is the first step's inputTokens: the fixed cost of the arm
 * (system prompt + manual block + tool schemas) before any work happens. That is the
 * quantity that answers "isn't bb just 15k tokens of overhead?".
 */
export interface DiscoveryTax {
  /** Tokens for the first step: the arm's fixed startup cost. Null when unknown. */
  staticPrefixTokens: number | null
  /** Input tokens summed over steps completed BEFORE the step holding the first edit. */
  tokensBeforeFirstEdit: number | null
  /** True when every step up to the measured point reported a usage sample. */
  complete: boolean
  /** Step index (0-based) of the first tool call whose input names a golden file. */
  firstGoldenEditStep: number | null
  /** Arrival ms of that call, an UPPER BOUND. */
  firstGoldenEditMs: number | null
}

const EDIT_TOOLS = /^(edit|write|apply_patch|str_replace|create_file|mcp__bb__bb_edit)$/

/**
 * @param events  the run's trace
 * @param golden  basenames of the files the task expects to be edited (may be empty)
 */
export function discoveryTax(events: TraceEvent[], golden: string[]): DiscoveryTax {
  // Map every tool_call to the step it happened in, so usage (emitted at step_end) can be
  // attributed. A step's usage is reported at its end, and includes the step's own work.
  let step = -1
  let stepInput: (number | null)[] = []
  const callStep = new Map<string, number>()
  let staticPrefixTokens: number | null = null
  let firstGoldenEditStep: number | null = null
  let firstGoldenEditMs: number | null = null

  for (const e of events) {
    switch (e.type) {
      case "status":
        if (e.phase === "step_start") {
          step++
          stepInput[step] = null
        } else if (e.phase === "step_end") {
          const u = e.usage as Record<string, unknown> | undefined
          const n = num(u?.inputTokens)
          if (step >= 0) stepInput[step] = n
          if (step === 0) staticPrefixTokens = n
        }
        break
      case "tool_call": {
        const callId = typeof e.callId === "string" ? e.callId : ""
        callStep.set(callId, step)
        const tool = typeof e.tool === "string" ? e.tool : ""
        const inputText = JSON.stringify(e.input ?? "")
        const touchesGolden = golden.length > 0 && golden.some((g) => {
          const base = g.split("/").pop() ?? g
          return base.length > 0 && inputText.includes(base)
        })
        const isEdit = EDIT_TOOLS.test(tool) || (tool === "bash" && /\b(sed|patch)\b/.test(inputText))
        if (firstGoldenEditStep === null && isEdit && touchesGolden) {
          firstGoldenEditStep = step
          firstGoldenEditMs = typeof e._t_ms === "number" ? e._t_ms : null
        }
        break
      }
      default:
        break
    }
  }

  if (firstGoldenEditStep === null) {
    return { staticPrefixTokens, tokensBeforeFirstEdit: null, complete: false, firstGoldenEditStep: null, firstGoldenEditMs: null }
  }
  let sum = 0
  let complete = true
  for (let i = 0; i < firstGoldenEditStep; i++) {
    const v = stepInput[i]
    if (v === null || v === undefined) { complete = false; continue }
    sum += v
  }
  return { staticPrefixTokens, tokensBeforeFirstEdit: sum, complete, firstGoldenEditStep, firstGoldenEditMs }
}

/** Billed input volume for the whole run, and how much of it was cache reads. Summing is
 *  correct: each step re-sends its whole prompt. */
export function tokenTotals(events: TraceEvent[]): { input: number | null; output: number | null; cacheRead: number | null; complete: boolean } {
  let input = 0
  let output = 0
  let cacheRead = 0
  let any = false
  let complete = true
  for (const e of events) {
    if (e.type !== "status" || e.phase !== "step_end") continue
    const u = e.usage as Record<string, unknown> | undefined
    const i = num(u?.inputTokens)
    const o = num(u?.outputTokens)
    const c = num(u?.cacheReadTokens)
    if (i === null || o === null) { complete = false; continue }
    input += i
    output += o
    cacheRead += c ?? 0
    any = true
  }
  return { input: any ? input : null, output: any ? output : null, cacheRead: any ? cacheRead : null, complete }
}
