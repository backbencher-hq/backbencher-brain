// script/verify-tool-page-claims.ts — a tool page is a CLAIM about a payload.
//
// Every page in docs/tools/ is generated, and each one makes statements about
// the reply the tool actually returns: which summary fields are published,
// which counts ride the answer, what is declared and what is not. Nothing
// checked those statements against a real reply. The defects this file was
// written after were all found by hand, by reading a page next to a payload:
//
//   * docs/tools/bb_health.md said "This tool does not report per-file index
//     staleness and does not auto-refresh" while EVERY call returned a
//     `freshness` block naming fresh/stale/missing counts, the files behind
//     them, and why each file was classified as it was. bb_health was missing
//     from the generator's freshness table, so the page took the table's
//     "no freshness surface" branch: the page and the table agreed with each
//     other and disagreed with the tool.
//
//   * docs/tools/bb_graph.md named `summary.relationshipTypesUsed`, which the
//     tool payload never carried (the engine computes it; the handler echoes it
//     at `summary.scope.relationshipTypes`).
//
//   * docs/tools/bb_graph.md said the per-direction fan-out budget "is internal
//     and is not exposed" while the payload published `summary.callerBudget` and
//     `summary.calleeBudget` on every call, and it ended its Staleness section
//     by quoting FRESHNESS_REMEDIATION.dir — "reads auto-refresh stale files
//     within budget when enabled" — two sentences after denying auto-refresh.
//
// Both classes shipped because every other gate in the area checks the PAGE
// against a TABLE (the generator's freshness table, the registry's categories).
// This one checks the page against the PAYLOAD, through the real MCP door.
//
// Rules. Each is a pure function returning FINDINGS, so the negative battery at
// the bottom drives the same code the live run does rather than a copy of it.
//
//   C1 probe:     every public tool answers its representative call(s) through
//                 validateToolArguments -> handler without an error
//   C2 fields:    every qualified payload path a page names (`summary.x`,
//                 `truncation.originalNodes`, ...) resolves in the live reply.
//                 A path whose root is not a payload root is not a claim about
//                 this payload and is skipped, and the skip is PRINTED.
//   C3 denials:   a sentence that denies publishing something must not name a
//                 field the payload publishes — and the denied thing must be the
//                 SUBJECT of the denial ("the fan-out budget is internal"), not
//                 merely present in a sentence that mentions one.
//   C4 freshness: two separate denials, kept separate:
//                   - "does not report per-file index staleness": the payload
//                     must then carry no freshness markers;
//                   - "does not auto-refresh": the page must then not quote the
//                     auto-refresh remediation.
//                 A tool may truthfully report staleness and not repair it
//                 (bb_health, bb_ask), so conflating the two turned a true
//                 sentence into a failure.
//
// Several tools document fields that exist on a different branch of the same
// tool (bb_annotate's `surfacing.pathWarning` appears only for an unmatched
// `path`), so a tool may carry MORE THAN ONE probe and a path is satisfied if it
// resolves in any of that tool's replies.
//
// Coverage is printed per tool: which tools answered with a machine-readable
// payload, how many documented paths resolved, how many non-payload tokens were
// skipped, and how many denial sentences were audited. A tool the rules cannot
// reach is visible rather than silently unchecked.
//
// Run: bun run script/verify-tool-page-claims.ts
//   (or: npx tsx script/verify-tool-page-claims.ts)

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..")
const DOC_DIR = path.join(ROOT, "docs/tools")

let passed = 0
let failed = 0
let negatives = 0
const failures: string[] = []

function check(label: string, ok: boolean, detail = ""): void {
  if (ok) passed++
  else {
    failed++
    failures.push(detail ? `${label} — ${detail}` : label)
    console.log(`FAIL: ${label}${detail ? ` — ${detail}` : ""}`)
  }
}

function negative(label: string, detected: boolean, detail = ""): void {
  negatives++
  check(`${label} [negative]`, detected, detail)
}

// ═══════════════════════════════════════════════════════════════════════════
// The rules.
// ═══════════════════════════════════════════════════════════════════════════

export interface Finding {
  rule: string
  detail: string
}

/** Every dotted token in the page: `summary.callerBudget`, `root.candidates`,
 *  `truncation.originalNodes`, `import.meta.main`, ... Extraction does not care
 *  whether the token is backticked — the root filter below is what makes it a
 *  payload claim. It does care about the NEIGHBOURS: `freshness.ts` inside
 *  `src/brain/freshness.ts` is a path segment, not a field claim, so a token
 *  touching `/`, `-` or another dotted segment is not a token. Digit-leading
 *  candidates (version ranges, "2.5-4.8x") never match. */
const DOTTED_TOKEN = /(?<![A-Za-z0-9_/.\-])([A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+)(?![A-Za-z0-9_/\-])/g

export function documentedPaths(page: string): string[] {
  const out = new Set<string>()
  for (const match of page.matchAll(DOTTED_TOKEN)) {
    if (match[1].length <= 140) out.add(match[1])
  }
  return [...out].sort()
}

/** The named roots a payload offers. A top-level array payload (analysis
 *  history, annotation rows) is described by its first row, so a page claiming
 *  `location.file` can still be checked. */
export function payloadRoots(payload: unknown): Map<string, unknown> {
  const roots = new Map<string, unknown>()
  const source = Array.isArray(payload) ? payload[0] : payload
  if (source && typeof source === "object" && !Array.isArray(source)) {
    for (const [key, value] of Object.entries(source as Record<string, unknown>)) roots.set(key, value)
  }
  return roots
}

/** Resolve `a.b.c` against a payload: ok / missing (the root exists, a segment
 *  does not) / not-a-root (the page is talking about something else, which is
 *  not this gate's business). */
export function resolvePath(payload: unknown, dotted: string): { state: "ok" | "missing" | "not-a-root"; at?: string } {
  const roots = payloadRoots(payload)
  const segments = dotted.split(".")
  if (!roots.has(segments[0])) return { state: "not-a-root" }
  let cursor: unknown = roots.get(segments[0])
  for (const segment of segments.slice(1)) {
    if (cursor === null || typeof cursor !== "object") return { state: "missing", at: segment }
    const bag = cursor as Record<string, unknown>
    if (Array.isArray(bag)) {
      // A one-element array of objects is this repo's idiom for a declared row
      // shape; resolve through the first row.
      const row = bag[0]
      if (row === undefined || row === null || typeof row !== "object") return { state: "missing", at: segment }
      if (!(segment in (row as Record<string, unknown>))) return { state: "missing", at: segment }
      cursor = (row as Record<string, unknown>)[segment]
      continue
    }
    if (!(segment in bag)) return { state: "missing", at: segment }
    cursor = bag[segment]
  }
  return { state: "ok" }
}

/** C2: every qualified path the page names must resolve in at least one of the
 *  tool's live replies. */
export function pathFindings(page: string, payloads: unknown[]): { findings: Finding[]; checked: number; skipped: number } {
  const findings: Finding[] = []
  let checked = 0
  let skipped = 0
  for (const dotted of documentedPaths(page)) {
    const roots = payloads.filter((payload) => payloadRoots(payload).has(dotted.split(".")[0]))
    if (roots.length === 0) {
      skipped++
      continue
    }
    checked++
    if (roots.some((payload) => resolvePath(payload, dotted).state === "ok")) continue
    const first = resolvePath(roots[0], dotted)
    findings.push({
      rule: "C2 field path",
      detail: `page names \`${dotted}\` but no reply publishes \`${first.at ?? dotted}\` (${roots.length} replied with the \`${dotted.split(".")[0]}\` block)`,
    })
  }
  return { findings, checked, skipped }
}

/** Sentences that mention a denial at all — used to SELECT sentences to audit,
 *  never to conclude. */
const DENIAL_MENTION =
  /\bis internal\b|\bnot exposed\b|\bnot published\b|\bnever (reports|reported)\b|\bnot report(s|ed)\b|\bdoes not report\b|\bnot surfaced\b|\bhidden from the (response|payload|answer)\b|\bsilently (dropped|discarded|removed)\b/i

export function denialSentences(page: string): string[] {
  return page
    .split(/(?<=[.;:])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0 && DENIAL_MENTION.test(sentence))
}

/** The FORM a denial must take to be a claim about a field's publication:
 *  `<subject> [optional parenthetical] is/are [never|not] <denial>` — the denied
 *  thing is the SUBJECT.
 *
 *  This precision is the difference between a gate and a nuisance. These
 *  sentences are all TRUE, all mention a denial, and none denies publishing:
 *
 *    "A position is never fabricated and never reported as line 0"
 *    "a kind you do not list is never reported, and a filter you supply is
 *     recorded in the answer's `truncationReason`"
 *    "an empty result is never reported as passing"
 *
 *  The first three were measured false findings before the subject requirement
 *  (plus one ungrouped-alternation bug that made every sentence match every
 *  field). A subject-form denial is unambiguous. */
const DENIAL_PREDICATE =
  "\\b(?:is|are|stays|remains|was|were)\\s+(?:never\\s+)?(?:internal|hidden|silent|undisclosed|unreported)\\b|\\b(?:is|are|stays|remains|was|were)\\s+(?:never|not)\\s+(?:published|exposed|reported|surfaced|returned|emitted)\\b"

/** Concept names a page uses for a field it ALSO publishes. The generic rule
 *  catches a denial that names the field; these are the paraphrases, declared so
 *  the ratchet covers the classes this repo has shipped ("fan-out budget" is the
 *  one that shipped). */
export const DENIAL_ALIASES: Readonly<Record<string, readonly string[]>> = {
  "fan-out budget": ["callerBudget", "calleeBudget"],
  "site limit": ["edgeLimit"],
  "wall-clock budget": ["timeBudgetMs"],
  "total-edge limit": ["maxEdges"],
  "depth cap": ["maxDepth"],
  "node budget": ["maxNodes", "maxLinks"],
}

function camelWords(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLowerCase()
    .trim()
}

/** Every field path a payload publishes, to three levels. */
function publishedFields(payload: unknown): Array<{ path: string; name: string }> {
  const out: Array<{ path: string; name: string }> = []
  const walk = (value: unknown, scope: string, depth: number): void => {
    if (depth > 3 || value === null || typeof value !== "object") return
    const bag = Array.isArray(value) ? (value[0] as Record<string, unknown> | undefined) : (value as Record<string, unknown>)
    if (!bag || typeof bag !== "object") return
    for (const [key, child] of Object.entries(bag)) {
      const dotted = scope ? `${scope}.${key}` : key
      out.push({ path: dotted, name: key })
      walk(child, dotted, depth + 1)
    }
  }
  walk(payload, "", 0)
  return out
}

/** C3: no sentence may deny publishing a field the payload publishes. */
export function denialFindings(page: string, payloads: unknown[]): Finding[] {
  const findings: Finding[] = []
  const published = payloads.flatMap((payload) => publishedFields(payload))
  const subjects = new Map<string, string>() // subject text -> the payload path it names
  for (const field of published) {
    subjects.set(field.name, field.path)
    const words = camelWords(field.name)
    if (words.includes(" ") && words.length > 6) subjects.set(words, field.path)
  }
  for (const [phrase, suffixes] of Object.entries(DENIAL_ALIASES)) {
    for (const suffix of suffixes) {
      const hit = published.find((field) => field.name === suffix)
      if (hit) subjects.set(phrase, hit.path)
    }
  }

  for (const sentence of denialSentences(page)) {
    const denied = new Set<string>()
    for (const [subject, dotted] of subjects) {
      const escaped = subject.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      // The predicate alternation MUST be grouped: ungrouped, its top-level `|`
      // splits this whole pattern and the subject half becomes optional, which
      // makes every sentence containing a denial match every field (measured —
      // 39 false findings on bb_impact's page from exactly that). A closing
      // backtick/quote after the subject is allowed because the pages write field
      // names that way ("`callerBudget` is not published").
      const pattern = new RegExp(`(?<![A-Za-z0-9_])${escaped}[\\u0060'"]?(?:\\s*\\([^)]*\\))?\\s+(?:${DENIAL_PREDICATE})`, "i")
      if (pattern.test(sentence)) denied.add(dotted)
    }
    for (const dotted of denied) {
      findings.push({
        rule: "C3 denial",
        detail: `page denies publishing \`${dotted.split(".").pop()}\` while the reply publishes \`${dotted}\` — "${sentence.slice(0, 170)}"`,
      })
    }
  }
  return findings
}

/** Machine markers that a reply reports per-file freshness. Named so a finding
 *  quotes WHAT it saw rather than asserting "staleness". */
export const FRESHNESS_MARKERS: ReadonlyArray<readonly [string, RegExp]> = [
  ["freshness block", /"freshness"\s*:/],
  ["freshness header", /\bfreshness\s*[:=]\s|\bfreshness why\b/i],
  ["stale row marker", /\[STALE\b|\[stale\]/],
  ["staleCount field", /"staleCount"|"stale_count"|staleCount\s*[:=]/],
  ["stale/missing tally", /\bstale\b\s*[:=]\s*\d|\bstale files\b/i],
  ["autoRefresh declaration", /\bautoRefresh\b/],
]

export function freshnessMarkers(payloadText: string): string[] {
  return FRESHNESS_MARKERS.filter(([, pattern]) => pattern.test(payloadText)).map(([name]) => name)
}

/** Denying that staleness is REPORTED is a different claim from denying that the
 *  tool REPAIRS it. Both are checkable; only the first is contradicted by a
 *  payload that carries freshness markers. */
export const DENY_REPORTS_STALENESS = /does not report per-file index staleness|does not report index staleness|no per-file index staleness/i
export const DENY_AUTO_REFRESH = /does not auto-refresh/i

/** C4: a page that denies reporting staleness must not sit next to a reply that
 *  reports it; a page that denies auto-refreshing must not quote the
 *  auto-refresh remediation. */
export function freshnessFindings(page: string, payloadText: string, remediationDir: string): Finding[] {
  const findings: Finding[] = []
  const deniesReporting = DENY_REPORTS_STALENESS.test(page)
  const deniesAutoRefresh = DENY_AUTO_REFRESH.test(page)
  if (!deniesReporting && !deniesAutoRefresh) return findings

  if (deniesAutoRefresh && (page.includes(remediationDir) || /reads auto-refresh stale files within budget/.test(page))) {
    findings.push({
      rule: "C4 freshness",
      detail: "page denies auto-refresh and quotes the auto-refresh remediation (the registered constant names the behavior the same section just denied)",
    })
  }
  if (deniesReporting) {
    const markers = freshnessMarkers(payloadText)
    if (markers.length) {
      findings.push({
        rule: "C4 freshness",
        detail: `page denies reporting per-file index staleness while the reply carries: ${markers.join(", ")}`,
      })
    }
  }
  return findings
}

// ═══════════════════════════════════════════════════════════════════════════
// The fixture + probes.
// ═══════════════════════════════════════════════════════════════════════════

const SERVICE_TS = `import { normalize } from "./util"

export class Service {
  handle(input: string): string {
    const query = "SELECT * FROM users WHERE id = " + input
    return this.respond(normalize(query))
  }

  private respond(value: string): string {
    console.log("page_claims_probe_key_12345")
    return value.trim()
  }
}

export function entry(input: string): string {
  const service = new Service()
  return service.handle(input)
}
`

const UTIL_TS = `export function normalize(value: string): string {
  return value.split(" ").join(" ").trim()
}
`

const CONSUMER_PY = `def consume_entry():
    return "cross-language probe"
`

/** Representative calls, one or more per public tool. A tool whose page
 *  documents a field that only one input variant emits gets a second probe, so
 *  the path check is exercised against that variant instead of being excused.
 *  `bb_edit` writes INSIDE the throwaway fixture; nothing outside it is touched. */
const PROBES: ReadonlyArray<{ tool: string; args: Record<string, unknown>; note: string }> = [
  { tool: "bb_search", args: { query: "handle", limit: 5 }, note: "content retrieval page" },
  { tool: "bb_ask", args: { query: "how does the entry point handle a request", limit: 3 }, note: "natural-language answer" },
  { tool: "bb_analyze", args: { mode: "callers", target: "entry" }, note: "callers mode, JSON" },
  { tool: "bb_health", args: { history: true }, note: "history=true => { health, history }" },
  { tool: "bb_patterns", args: {}, note: "default orphan/anti-pattern scan" },
  { tool: "bb_security", args: {}, note: "default taint scan" },
  { tool: "bb_visualize", args: { scope: "project", format: "json", maxNodes: 20, maxLinks: 50 }, note: "JSON graph" },
  { tool: "bb_migrate", args: { symbolNames: ["entry"], targetLanguage: "go", format: "json" }, note: "JSON plan" },
  { tool: "bb_doc", args: { mode: "symbol", target: "entry", format: "json" }, note: "JSON documentation" },
  { tool: "bb_edit", args: { mode: "write", filePath: "src/page-claims-probe.ts", content: "export const pageClaimsProbe = true\n" }, note: "write into the fixture" },
  { tool: "bb_index", args: { path: "src/page-claims-probe.ts" }, note: "reindex that file" },
  { tool: "bb_graph", args: { symbol: "entry" }, note: "default traversal" },
  { tool: "bb_impact", args: { symbol: "entry" }, note: "bounded impact" },
  { tool: "bb_cross_language", args: { symbol: "entry" }, note: "cross-language facts" },
  { tool: "bb_annotate", args: { symbol: "entry", body: "page-claims gate probe" }, note: "write a note" },
  // The other documented branch of the same tool: a path that matches no indexed
  // file selects `surfacing.pathWarning` instead of `surfacing.pathNote`.
  { tool: "bb_annotate", args: { symbol: "entry", body: "page-claims gate probe (unmatched path)", path: "src/no-such-file.ts" }, note: "unmatched path => pathWarning variant" },
  { tool: "bb_annotations", args: { symbol: "entry" }, note: "read the note back" },
]

async function main(): Promise<void> {
  const { indexProjectParallel, getProjectId, validateToolArguments, handlers, descriptorFor, remediationDir } = await loadSurface()
  const toolNames = PROBES.map((probe) => probe.tool).filter((name, index, all) => all.indexOf(name) === index)

  // ── the fixture ──────────────────────────────────────────────────────────
  const base = mkdtempSync(path.join(os.tmpdir(), "bb-page-claims-"))
  const workspace = path.join(base, "workspace")
  const dataDir = path.join(base, "data")
  mkdirSync(path.join(workspace, "src"), { recursive: true })
  mkdirSync(dataDir, { recursive: true })
  writeFileSync(path.join(workspace, "src", "service.ts"), SERVICE_TS)
  writeFileSync(path.join(workspace, "src", "util.ts"), UTIL_TS)
  writeFileSync(path.join(workspace, "src", "consumer.py"), CONSUMER_PY)
  process.env.BB_DATA_DIR = dataDir

  const context = { projectId: getProjectId(workspace), projectPath: workspace }
  const indexResult: any = await indexProjectParallel(context.projectId, context.projectPath, {})
  check("fixture indexed by the real indexer", (indexResult?.processedFiles ?? 0) >= 3, JSON.stringify({ processedFiles: indexResult?.processedFiles }))

  const coverage: string[] = []
  const replies = new Map<string, { texts: string[]; payloads: unknown[] }>()

  for (const tool of toolNames) {
    const page = readFileSync(path.join(DOC_DIR, `${tool}.md`), "utf8")
    const handler = (handlers as any)[tool]
    if (typeof handler !== "function") {
      check(`C1 ${tool}: handler exists`, false, "no handler in createToolHandlers()")
      continue
    }

    const payloads: unknown[] = []
    const texts: string[] = []
    for (const probe of PROBES.filter((candidate) => candidate.tool === tool)) {
      // The REAL door: the same argument validation the MCP server applies,
      // then the handler the server calls.
      let text = ""
      let isError = false
      try {
        const validated = validateToolArguments(descriptorFor(tool), probe.args)
        const result: any = await handler(validated, context)
        text = (result?.content ?? []).map((part: any) => part?.text ?? "").join("\n")
        isError = result?.isError === true
      } catch (error) {
        check(`C1 ${tool}: representative call answered`, false, `${probe.note} — ${String((error as Error)?.message ?? error).slice(0, 200)}`)
        continue
      }
      check(`C1 ${tool}: representative call answered`, !isError && text.length > 0, `${probe.note} — ${text.slice(0, 140)}`)
      if (isError) continue
      texts.push(text)
      let parsed: unknown = null
      try {
        parsed = JSON.parse(text)
      } catch {
        parsed = null
      }
      if (parsed !== null && typeof parsed === "object") payloads.push(parsed)
    }
    replies.set(tool, { texts, payloads })

    // C4 reads the page against every reply of this tool.
    for (const text of texts) {
      for (const finding of freshnessFindings(page, text, remediationDir)) check(`${finding.rule}: ${tool}`, false, finding.detail)
    }

    if (payloads.length === 0) {
      coverage.push(`${tool}: text reply only (C2/C3 skipped — the pages name fields the text renderer renames)`)
      continue
    }
    const paths = pathFindings(page, payloads)
    for (const finding of paths.findings) check(`${finding.rule}: ${tool}`, false, finding.detail)
    for (const finding of denialFindings(page, payloads)) check(`${finding.rule}: ${tool}`, false, finding.detail)
    coverage.push(
      `${tool}: ${payloads.length} machine-readable reply(s) — ${paths.checked} documented path(s) resolved, ${paths.skipped} non-payload token(s) skipped, ${denialSentences(page).length} denial sentence(s) audited`,
    )
  }

  const jsonTools = [...replies.values()].filter((reply) => reply.payloads.length > 0).length
  console.log(`\ncoverage (${jsonTools}/${toolNames.length} tools answered with a machine-readable payload):`)
  for (const line of coverage) console.log(`  ${line}`)

  // ── negatives: each rule must be able to FAIL ─────────────────────────────
  // Driven through the same functions the live run uses, on the replies of real
  // tools, so a rule that stopped biting is caught here rather than quietly
  // passing every page.
  const graphPage = readFileSync(path.join(DOC_DIR, "bb_graph.md"), "utf8")
  const graphPayloads = replies.get("bb_graph")!.payloads
  const graphPayload = graphPayloads[0]

  const realPathCount = pathFindings(graphPage, graphPayloads).checked
  negative("C2 detects a fabricated field path on a real payload", realPathCount > 5 && pathFindings("The answer publishes `summary.pageClaimsNotAField` always.", graphPayloads).findings.length === 1, `real path count=${realPathCount}`)
  negative("C2 detects a real field NESTED under a path the reply does not have", pathFindings("A caller can read `summary.pageClaimsNotAField.deep` today.", graphPayloads).findings.length === 1)
  negative("C2 still resolves a path the reply does publish", pathFindings("The bound rides `summary.callerBudget`.", graphPayloads).findings.length === 0)
  negative("C2 accepts a path that only ONE of a tool's variants publishes", pathFindings("A note reports `surfacing.pathWarning` when the path matches no file.", replies.get("bb_annotate")!.payloads).findings.length === 0)

  // The exact shipped sentences, driven against the payload that refutes them.
  const fanOutDenial = "The per-direction fan-out budget (50 symbols) is internal and is not exposed: truncation is declared in the summary when it bites."
  negative("C3 catches the shipped \"fan-out budget is internal\" contradiction", denialFindings(fanOutDenial, graphPayloads).length > 0, `findings=${JSON.stringify(denialFindings(fanOutDenial, graphPayloads))}`)
  negative("C3 catches a subject-form denial naming a published field", denialFindings("The per-dimension `callerBudget` is not published anywhere in the reply.", graphPayloads).some((finding) => finding.detail.includes("callerBudget")))
  negative("C3 is not fooled by a denial about something the reply does NOT publish", denialFindings("The retired analyzer's exit code is internal and is not exposed anywhere.", graphPayloads).length === 0)
  negative("C3 is not fooled by a true sentence that merely mentions a denial", denialFindings("A position is never fabricated and never reported as line 0, and a filter is recorded in `truncationReason`.", graphPayloads).length === 0)

  const analyzeReply = replies.get("bb_analyze")!
  const analyzeText = analyzeReply.texts[0]
  const markers = freshnessMarkers(analyzeText)
  negative("C4 sees the freshness markers this repo's read tools really emit", markers.length > 0, `markers=${markers.join(",")}`)
  negative("C4 catches a page that denies reporting the surface its reply shows", freshnessFindings("This tool does not report per-file index staleness.", analyzeText, remediationDir).length > 0)
  negative("C4 catches a denying page that quotes the auto-refresh remediation", freshnessFindings(`The answer is not refreshed: this tool does not auto-refresh. Remediation: ${remediationDir}`, graphPayloads, remediationDir).length > 0)
  negative("C4 leaves a denying page alone when the reply shows nothing", freshnessFindings("This tool does not report per-file index staleness and does not auto-refresh.", replies.get("bb_graph")!.texts[0], remediationDir).length === 0)
  negative("C4 leaves a page that claims the surface alone", freshnessFindings("Staleness surfaces as: a `freshness` block.", analyzeText, remediationDir).length === 0)
  negative(
    "C4 does not read a truthful \"does not auto-refresh\" as a denial of REPORTING staleness",
    freshnessFindings("It does not auto-refresh on a read. Staleness surfaces as: a `freshness` block.", analyzeText, remediationDir).length === 0,
  )

  // C1 must be able to fail: a probe the tool refuses is not "answered".
  const refusal: any = await (handlers as any).bb_graph(validateToolArguments(descriptorFor("bb_graph"), { symbol: "noSuchSymbolInThisFixture" }), context)
  negative("C1 sees a refused probe as a failure", refusal?.isError === true || String(refusal?.content?.[0]?.text ?? "").startsWith("bb_graph:"), String(refusal?.content?.[0]?.text ?? "").slice(0, 120))

  // The reply the paths are resolved against is a REAL stored-key reply, so a
  // "path not found" finding is about the tool's own answer.
  const graphRootId = (graphPayload as any)?.root?.id
  check(
    "bb_graph reply carries a full stored root id (paths are checked against a real reply)",
    typeof graphRootId === "string" && /^[0-9a-f]{40}:/.test(graphRootId),
    String(graphRootId).slice(0, 60),
  )

  rmSync(base, { recursive: true, force: true })
  rmSync(dataDir, { recursive: true, force: true })

  const ok = failed === 0
  console.log(`\nTOOL PAGE CLAIMS: ${ok ? "PASS" : "FAIL"} (${passed} passed, ${failed} failed, ${negatives} negatives)`)
  if (!ok) for (const failure of failures) console.log(`  CLAIM-FAIL: ${failure.slice(0, 400)}`)
  process.exit(ok ? 0 : 1)
}

/** Load the MCP surface + indexer, resolving the sqlite driver per runtime the
 *  way the server does. BB_DATA_DIR is set by main() BEFORE this import, so no
 *  module holds a path computed from the ambient data dir. */
async function loadSurface(): Promise<{
  indexProjectParallel: (projectId: string, projectPath: string, options: any) => Promise<any>
  getProjectId: (projectPath: string) => string
  validateToolArguments: (descriptor: any, args: any) => any
  handlers: Record<string, any>
  descriptorFor: (name: string) => any
  remediationDir: string
}> {
  const registry = await import("../src/mcp/tool-registry")
  const validation = await import("../src/mcp/tool-validation")
  const handlersModule = await import("../src/mcp/tool-handlers")
  const freshness = await import("../src/brain/freshness")
  const projectIdModule = await import("../src/util/project-id")

  // Under Node the compiled dist is the supported indexing entry (the source
  // indexer's pool worker is bun:sqlite); under Bun the source is.
  const useDist = typeof (globalThis as any).Bun === "undefined"
  const indexer: any = useDist ? await import(path.join(ROOT, "dist", "index.js")) : await import("../src/ast/parallel-indexer")

  const descriptors = new Map<string, any>((registry.PUBLIC_TOOL_DESCRIPTORS as any[]).map((descriptor) => [descriptor.name, descriptor]))
  const handlers: Record<string, any> = (handlersModule as any).createToolHandlers()

  return {
    indexProjectParallel: (indexer.indexProjectParallel as any).bind(indexer),
    getProjectId: (useDist ? indexer.getProjectId : projectIdModule.getProjectId) as any,
    validateToolArguments: validation.validateToolArguments as any,
    handlers,
    descriptorFor: (name: string) => {
      const descriptor = descriptors.get(name)
      if (!descriptor) throw new Error(`no public tool descriptor named ${name}`)
      return descriptor
    },
    remediationDir: freshness.FRESHNESS_REMEDIATION.dir,
  }
}

const isDirectRun = ((): boolean => {
  try {
    if ((import.meta as { main?: boolean }).main === true) return true
  } catch {
    /* import.meta.main unsupported on this runtime */
  }
  const argv1 = process.argv[1] ?? ""
  return argv1.endsWith("verify-tool-page-claims.ts") || argv1.endsWith("verify-tool-page-claims.js")
})()

if (isDirectRun) {
  await main()
}
