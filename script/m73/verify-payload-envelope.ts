// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the P1-4/P2-5 gate: ONE bounded response envelope with
//   summary-first bounds across the four graph-family surfaces (bb_impact,
//   bb_graph, bb_visualize json, bb_analyze mode=impact), plus the two
//   emitted-claim honesty defects (security tier units, visualize
//   "whole project" claim).
// WHICH GATE IT SERVES — fix campaign P1-4 (ISSUE-10) and P2-5 (ISSUE-12).
// WHY IT IS SHAPED THIS WAY — the triage finding measured bounds at 99.5-99.9%
//   of the payload and a 1 MB graph answer; a host cap therefore removes the
//   declaration first. This gate asserts the DECLARED property (summary is the
//   first top-level key and every bound is inside head -c 4096), not a byte
//   position that a future refactor could drift. It runs every surface over a
//   REAL indexed fixture (never mocks) and unit-tests the byte-budget mechanism
//   with a synthetic oversized payload, because a small fixture cannot
//   legitimately produce a >256 KB real answer.
//   It also pins the two claim defects: the security tier line must label its
//   population as lead-tier analyzers (stored leads are counted only in the
//   body), and the visualize "whole project" claim is allowed ONLY on a
//   complete project-scope first page — every scoped/truncated/absent/offset
//   answer must say "not the whole project".
// WHERE ITS EVIDENCE LIVES — docs/bb-bettercap-fix/evidence/payload-honesty/.
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/mcp/tools/shared.ts (envelope),
//   src/mcp/tools/bb_impact/handler.ts, src/mcp/tools/bb_graph/handler.ts,
//   src/intelligence/visualization/visualization-engine.ts,
//   src/intelligence/security/rebuild/registry.ts, docs/BB_SECURITY.md.
// CONTRACTS IT MUST NOT BREAK — no assertion may be weakened to go green; the
//   positive controls (real impact answer keeps its counts; a complete
//   project-scope visualize answer may still say "whole project") must pass.
//
// Run: npx tsx script/m73/verify-payload-envelope.ts
// ─────────────────────────────────────────────────────────────────────────────

import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const ENVELOPE_BUDGET = 256 * 1024
const HEAD_BYTES = 4096

let passed = 0
const failures: string[] = []
function check(label: string, ok: boolean, detail = ""): void {
    if (ok) passed++
    else {
        failures.push(`${label}${detail ? ` — ${detail}` : ""}`)
        console.log(`FAIL: ${label}${detail ? ` — ${detail}` : ""}`)
    }
}
const head = (text: string, n = HEAD_BYTES): string => text.slice(0, n)
const utf8 = (text: string): number => Buffer.byteLength(text, "utf8")
/** The envelope contract: the FIRST top-level key is `summary`. */
function summaryFirst(text: string): boolean {
    return /^\{\s*"summary"\s*:/.test(text)
}

async function main(): Promise<void> {
    const dataDir = mkdtempSync(path.join(tmpdir(), "m73-data-"))
    process.env.BB_DATA_DIR = dataDir
    const { getProjectId } = await import(path.join(ROOT, "src/cli/index"))
    const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer"))
    const { createToolHandlers } = await import(path.join(ROOT, "src/mcp/tool-handlers"))
    const visualization = await import(path.join(ROOT, "src/intelligence/visualization/visualization-engine"))
    const registry = await import(path.join(ROOT, "src/intelligence/security/rebuild/registry"))
    const shared: any = await import(path.join(ROOT, "src/mcp/tools/shared"))
    const graphEngine = await import(path.join(ROOT, "src/intelligence/graph/graph-engine"))

    // ── fixture: a small real project the REAL indexer indexes ────────────────
    const proj = mkdtempSync(path.join(tmpdir(), "m73-fixture-"))
    mkdirSync(path.join(proj, "src"), { recursive: true })
    // hub + callers (impact/graph payloads with real edges)
    const hub: string[] = [`export function hub(): number { return 1 }`]
    for (let i = 0; i < 40; i++) hub.push(`export function caller${i}(): number { return hub() }`)
    writeFileSync(path.join(proj, "src", "hub.ts"), hub.join("\n") + "\n")
    writeFileSync(path.join(proj, "src", "leaf.ts"), `export function leaf(): number { return 2 }\nexport function leafCaller(): number { return leaf() }\n`)
    // module/scope target for visualize
    mkdirSync(path.join(proj, "src", "mod"), { recursive: true })
    writeFileSync(path.join(proj, "src", "mod", "a.ts"), `export function modFn(): number { return 3 }\nexport function modOther(): number { return modFn() }\n`)

    const realProj = realpathSync(proj)
    const projectId: string = getProjectId(realProj)
    const indexResult = await indexProjectParallel(projectId, realProj, {})
    check("A0: fixture indexed by the real indexer", (indexResult?.processedFiles ?? 0) >= 3, JSON.stringify({ total: indexResult?.totalFiles, processed: indexResult?.processedFiles }))

    const handlers = createToolHandlers() as Record<string, (args: any, ctx: { projectId: string; projectPath: string }) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>>
    const ctx = { projectId, projectPath: realProj }
    const raw = async (tool: string, args: any): Promise<{ text: string; isError: boolean }> => {
        const result = await handlers[tool](args, ctx)
        return { text: result.content?.[0]?.text ?? "", isError: result.isError === true }
    }
    const parse = (text: string): any => {
        try {
            return JSON.parse(text)
        } catch {
            return null
        }
    }

    // ═══ A. ENVELOPE CONTRACT — summary first, every bound inside 4 KB ═════════
    const impactText = (await raw("bb_impact", { symbol: "hub" })).text
    const impact = parse(impactText)
    check("A1: bb_impact first top-level key is summary", summaryFirst(impactText), head(impactText, 80))
    check("A1: bb_impact declares payloadBytes/payloadBudgetBytes in summary", typeof impact?.summary?.payloadBytes === "number" && impact?.summary?.payloadBudgetBytes === ENVELOPE_BUDGET, JSON.stringify({ bytes: impact?.summary?.payloadBytes, budget: impact?.summary?.payloadBudgetBytes }))
    for (const bound of ["truncated", "truncationReason", "shownCount", "totalCountIfKnown", "budget", "traversal", "countVerification", "payloadBytes"]) {
        check(`A1: bb_impact bound "${bound}" is inside head -c ${HEAD_BYTES}`, head(impactText).includes(`"${bound}"`))
    }
    check("A1: bb_impact declares the byte-budget vocabulary on every answer", impact?.summary?.byteBudgetRule === "payload-byte-budget-exhausted" && typeof impact?.summary?.byteBudgetExhausted === "boolean", JSON.stringify({ rule: impact?.summary?.byteBudgetRule, exhausted: impact?.summary?.byteBudgetExhausted }))
    check("A1: bb_impact summary.shownCount <= summary.budget.maxNodes", typeof impact?.summary?.shownCount === "number" && impact?.summary?.shownCount <= (impact?.summary?.budget?.maxNodes ?? -1), JSON.stringify({ shown: impact?.summary?.shownCount, max: impact?.summary?.budget?.maxNodes }))
    // positive control: the real answer keeps its counts and rows
    check("A1-control: real bb_impact answer keeps counts and rows", impact?.summary?.shownCount === impact?.data?.impact?.length && (impact?.summary?.totalCountIfKnown ?? -1) >= (impact?.summary?.shownCount ?? 0) && (impact?.summary?.shownCount ?? 0) > 0, JSON.stringify({ shown: impact?.summary?.shownCount, rows: impact?.data?.impact?.length, total: impact?.summary?.totalCountIfKnown }))

    const graphText = (await raw("bb_graph", { symbol: "hub" })).text
    const graph = parse(graphText)
    check("A2: bb_graph first top-level key is summary", summaryFirst(graphText), head(graphText, 80))
    for (const bound of ["truncated", "truncationReason", "totalCallers", "totalCallees", "edgeLimit", "maxEdges", "payloadBytes"]) {
        check(`A2: bb_graph bound "${bound}" is inside head -c ${HEAD_BYTES}`, head(graphText).includes(`"${bound}"`))
    }
    check("A2: bb_graph summary declares payloadBytes", typeof graph?.summary?.payloadBytes === "number")
    check("A2-control: real bb_graph answer keeps its edges", Array.isArray(graph?.data?.callers) && Array.isArray(graph?.data?.callees) && (graph?.data?.callers?.length ?? 0) > 0, JSON.stringify({ callers: graph?.data?.callers?.length, callees: graph?.data?.callees?.length }))
    const engineGraph = await graphEngine.graphTraversal(projectId, "hub", {})
    check("A2: bb_graph edge SET is unchanged by the node-table dedupe (vs the engine)", graph?.data?.callers?.length === engineGraph.callers.length && graph?.data?.callees?.length === engineGraph.callees.length, JSON.stringify({ handler: [graph?.data?.callers?.length, graph?.data?.callees?.length], engine: [engineGraph.callers.length, engineGraph.callees.length] }))
    check("A2: bb_graph summary returned counts equal the returned rows", graph?.summary?.totalCallers === graph?.data?.callers?.length && graph?.summary?.totalCallees === graph?.data?.callees?.length && graph?.summary?.returnedEdges === (graph?.data?.callers?.length ?? 0) + (graph?.data?.callees?.length ?? 0), JSON.stringify({ totalCallers: graph?.summary?.totalCallers, totalCallees: graph?.summary?.totalCallees, returnedEdges: graph?.summary?.returnedEdges }))
    check("A2: bb_graph every edge endpoint resolves in the node table", [...(graph?.data?.callers ?? []), ...(graph?.data?.callees ?? [])].every((e: any) => typeof e.from === "string" && typeof e.to === "string" && !!graph?.data?.nodes?.[e.from] && !!graph?.data?.nodes?.[e.to]), "an edge references an endpoint the node table omits")
    check("A2: bb_graph dedupes endpoints into a node table", graph?.data?.nodes && typeof graph?.data.nodes === "object" && Array.isArray(graph?.data?.callers) && ((graph?.data?.callers?.length ?? 0) === 0 || typeof graph?.data?.callers?.[0]?.from === "string"), JSON.stringify({ nodes: graph?.data?.nodes ? Object.keys(graph.data.nodes).length : null }))

    const vizText = (await raw("bb_visualize", { scope: "file", target: "src/hub.ts", format: "json" })).text
    const viz = parse(vizText)
    check("A3: bb_visualize json first top-level key is summary", summaryFirst(vizText), head(vizText, 80))
    for (const bound of ["truncated", "totalNodesAvailable", "maxNodes", "maxLinks", "offset", "nextOffset", "payloadBytes"]) {
        check(`A3: bb_visualize bound "${bound}" is inside head -c ${HEAD_BYTES}`, head(vizText).includes(`"${bound}"`))
    }
    check("A3: bb_visualize declares the byte-budget vocabulary on every answer", viz?.summary?.byteBudgetRule === "payload-byte-budget-exhausted" && typeof viz?.summary?.byteBudgetExhausted === "boolean")
    check("A3-control: bb_visualize json keeps its nodes/links", Array.isArray(viz?.data?.nodes) && (viz?.data?.nodes?.length ?? 0) > 0 && Array.isArray(viz?.data?.links), JSON.stringify({ nodes: viz?.data?.nodes?.length }))

    const analyzeText = (await raw("bb_analyze", { mode: "impact", target: "hub" })).text
    const analyze = parse(analyzeText)
    check("A4: bb_analyze mode=impact first top-level key is summary", summaryFirst(analyzeText), head(analyzeText, 80))
    for (const bound of ["truncated", "truncationReason", "nodeBudget", "depthCap", "totalSymbols", "totalSymbolsIfKnown", "payloadBytes"]) {
        check(`A4: bb_analyze-impact bound "${bound}" is inside head -c ${HEAD_BYTES}`, head(analyzeText).includes(`"${bound}"`))
    }
    check("A4: bb_analyze-impact declares the byte-budget vocabulary on every answer", analyze?.summary?.byteBudgetRule === "payload-byte-budget-exhausted" && typeof analyze?.summary?.byteBudgetExhausted === "boolean")
    check("A4-control: bb_analyze impact keeps its counts", typeof analyze?.summary?.totalSymbols === "number" && analyze?.summary?.totalSymbols === analyze?.data?.totalSymbols, JSON.stringify({ summary: analyze?.summary?.totalSymbols, data: analyze?.data?.totalSymbols }))

    // ═══ B. BYTE BUDGET — mechanism, unit-tested with an oversized payload ═══
    check("B1: shared exports one bounded envelope helper", typeof shared.boundedResult === "function" && typeof shared.PAYLOAD_BUDGET_BYTES === "number", JSON.stringify({ helper: typeof shared.boundedResult, budget: shared.PAYLOAD_BUDGET_BYTES }))
    if (typeof shared.boundedResult === "function") {
        const bigRows = Array.from({ length: 4000 }, (_, i) => ({ i, payload: "x".repeat(120) }))
        const big = shared.boundedResult({ truncated: false, payloadBytes: 0, payloadBudgetBytes: shared.PAYLOAD_BUDGET_BYTES }, { rows: bigRows })
        const bigText = big.content?.[0]?.text ?? ""
        const bigParsed = parse(bigText)
        check("B1: oversized payload is cut to the declared byte budget", utf8(bigText) <= shared.PAYLOAD_BUDGET_BYTES + 8192, `bytes=${utf8(bigText)} budget=${shared.PAYLOAD_BUDGET_BYTES}`)
        check("B1: byte truncation is declared in the summary (first 4 KB)", head(bigText).includes("payload-byte-budget-exhausted") && bigParsed?.summary?.truncated === true, JSON.stringify(bigParsed?.summary && { truncated: bigParsed.summary.truncated, reason: bigParsed.summary.truncationReason }))
        check("B1: dropped rows are counted in the summary", typeof bigParsed?.summary?.droppedRows === "number" && bigParsed.summary.droppedRows > 0, String(bigParsed?.summary?.droppedRows))
        const small = shared.boundedResult({ truncated: false, payloadBytes: 0, payloadBudgetBytes: shared.PAYLOAD_BUDGET_BYTES }, { rows: [{ i: 1 }] })
        const smallParsed = parse(small.content?.[0]?.text ?? "")
        check("B2-control: a small payload is not byte-truncated", smallParsed?.summary?.truncated === false && smallParsed?.summary?.droppedRows === 0, JSON.stringify(smallParsed?.summary))
    }

    // ═══ B2. REAL-SURFACE BYTE TRUNCATION — force a tiny budget, assert honesty ═══
    const savedBudget = process.env.BB_PAYLOAD_BUDGET_BYTES
    process.env.BB_PAYLOAD_BUDGET_BYTES = "4096"
    try {
      const tightText = (await raw("bb_graph", { symbol: "hub" })).text
      const tight = parse(tightText)
      check("B2: a forced tiny byte budget truncates a real graph answer", tight?.summary?.truncated === true && /payload-byte-budget-exhausted/.test(String(tight?.summary?.truncationReason)), JSON.stringify({ truncated: tight?.summary?.truncated, reason: tight?.summary?.truncationReason }))
      check("B2: the byte cut is declared in the first 4 KB", head(tightText).includes("payload-byte-budget-exhausted") && head(tightText).includes("\"payloadBytes\""))
      check("B2: the declared returned counts equal the rows returned after the cut", tight?.summary?.totalCallers === (tight?.data?.callers?.length ?? -1) && tight?.summary?.totalCallees === (tight?.data?.callees?.length ?? -1) && tight?.summary?.returnedEdges === (tight?.data?.callers?.length ?? 0) + (tight?.data?.callees?.length ?? 0), JSON.stringify({ totalCallers: tight?.summary?.totalCallers, rows: tight?.data?.callers?.length, totalCallees: tight?.summary?.totalCallees, returnedEdges: tight?.summary?.returnedEdges }))
      check("B2: dropped rows are counted and positive", typeof tight?.summary?.droppedRows === "number" && tight.summary.droppedRows > 0, String(tight?.summary?.droppedRows))
      check("B2: every returned edge still resolves in the pruned node table", [...(tight?.data?.callers ?? []), ...(tight?.data?.callees ?? [])].every((e: any) => !!tight?.data?.nodes?.[e.from] && !!tight?.data?.nodes?.[e.to]))
    } finally {
      if (savedBudget === undefined) delete process.env.BB_PAYLOAD_BUDGET_BYTES
      else process.env.BB_PAYLOAD_BUDGET_BYTES = savedBudget
    }

    // ═══ C. UNITS — engineCallerRows, not an unlabelled returnedCallers ═════
    check("C1: bb_impact names the engine-row count `engineCallerRows` (units in the name)", typeof impact?.summary?.traversal?.engineCallerRows === "number" && !("returnedCallers" in (impact?.summary?.traversal ?? {})), JSON.stringify(impact?.summary?.traversal ?? null).slice(0, 200))
    check("C1: bb_impact budget states what maxNodes bounds", impact?.summary?.budget?.maxNodes === 200 && /dependent/i.test(String(impact?.summary?.budget?.nodeBudgetMeans ?? "")), JSON.stringify(impact?.summary?.budget ?? null).slice(0, 200))

    // ═══ D. EMITTED CLAIMS — security units, visualize completeness claim ═══
    const tierLine = registry.formatSecurityTierDeclaration()
    check("D1: security tier line labels its population (lead-tier analyzers)", /lead-tier analyzers/.test(tierLine), tierLine)
    check("D1: security tier line does NOT print an unlabelled `N leads`", !/[0-9]+ leads\b/.test(tierLine), tierLine)
    check("D1: security tier line still declares unsupported languages are not scanned", /unsupported languages are NOT scanned/.test(tierLine), tierLine)
    check("D1-control: the registry census is still computed", (() => {
        const c = registry.securityTierCounts()
        return c.total === 53 && c.leads === 39 && c.unsupported === 14 && c.scan === 0
    })(), JSON.stringify(registry.securityTierCounts()))
    const impactToolDoc = readFileSync(path.join(ROOT, "docs", "tools", "bb_impact.md"), "utf8")
    check("C1: docs/tools/bb_impact.md documents engineCallerRows (tool-docs truth gate)", /engineCallerRows/.test(impactToolDoc) && /not the engine's caller rows|engine's caller ROWS/i.test(impactToolDoc), "docs/tools/bb_impact.md must document the unit rename")
    const secDoc = readFileSync(path.join(ROOT, "docs", "BB_SECURITY.md"), "utf8")
    check("D1: docs/BB_SECURITY.md shows the corrected unit label", /lead-tier analyzers/.test(secDoc) && !/tiers: 0 scan \/ 39 leads \/ 14 unsupported \(of 53 analyzers\)/.test(secDoc), "docs/BB_SECURITY.md must not contain the old unlabelled tier-example literal")
    const secHandler = readFileSync(path.join(ROOT, "src/mcp/tools/bb_security/handler.ts"), "utf8")
    check("D1: the stored-lead body line stays the only stored-lead count", /security leads: \$\{page\.total\} stored lead\(s\)/.test(secHandler))

    // visualize emitter matrix over real answers
    const vizCases: Array<{ name: string; args: any; mustClaim: boolean }> = [
        { name: "project complete first page", args: { scope: "project", format: "text" }, mustClaim: true },
        { name: "module page (scoped)", args: { scope: "module", target: "src/mod", format: "text" }, mustClaim: false },
        { name: "file page (scoped)", args: { scope: "file", target: "src/hub.ts", format: "text" }, mustClaim: false },
        { name: "symbol page (scoped)", args: { scope: "symbol", target: "hub", format: "text" }, mustClaim: false },
        { name: "absent target", args: { scope: "module", target: "no-such-module-xyz", format: "text" }, mustClaim: false },
        { name: "offset page", args: { scope: "project", offset: 1, format: "text" }, mustClaim: false },
    ]
    for (const c of vizCases) {
        const text = (await raw("bb_visualize", c.args)).text
        const claims = /this graph is the whole project/.test(text)
        check(`D2: visualize ${c.name} ${c.mustClaim ? "MAY claim" : "MUST NOT claim"} whole-project`, claims === c.mustClaim, claims ? "claimed whole project" : "did not claim whole project")
        if (!c.mustClaim) {
            check(`D2: visualize ${c.name} says explicitly it is not the whole project`, /not the whole project/.test(text), text.split("\n").filter((l: string) => /whole project|completeness|page:/.test(l)).join(" | ").slice(0, 240))
        }
    }

    // ── result ────────────────────────────────────────────────────────────────
    const total = passed + failures.length
    console.log(`\nM73 P1-4/P2-5: ${failures.length === 0 ? "GREEN" : "RED"} (${passed}/${total} passed)`)
    if (failures.length) {
        console.log("FAILURES:")
        for (const f of failures) console.log(`  - ${f}`)
    }
    const evidenceDir = path.join(ROOT, "docs/bb-bettercap-fix/evidence/payload-honesty")
    mkdirSync(evidenceDir, { recursive: true })
    writeFileSync(path.join(evidenceDir, failures.length ? "m73-gate-red.json" : "m73-gate-green.json"), JSON.stringify({ gate: "M73 P1-4/P2-5", status: failures.length ? "RED" : "GREEN", passed, failed: failures.length, failures, generatedAt: new Date().toISOString() }, null, 2))
    process.exit(failures.length === 0 ? 0 : 1)
}

main().catch((error) => {
    console.error(error)
    process.exit(1)
})
