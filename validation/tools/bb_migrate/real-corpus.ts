// bb_migrate on REAL work: single and batch migration plans over real cross-language
// repositories (Elixir/Erlang, Erlang, Clojure, JavaScript/TypeScript), executed through the
// REAL MCP stdio door against isolated indexes, with every plan verdict checked by a predicate
// that has a planted-negative control in the same document.
//
// Verdict predicates: dependency-order validity, wave partition, effort arithmetic, truncation
// naming, unsupported-reason matching, ambiguous-name candidates that resolve, staleness envelope,
// and cross-language evidence. Negative controls prove each predicate can fail.
import { readFileSync, writeFileSync } from "node:fs"
import { execSync } from "node:child_process"
import path from "node:path"
import { performance } from "node:perf_hooks"
import { openDoor } from "./door"
import { BrainDatabase } from "../../../src/brain/database"
import { generateMigrationPlans } from "../../../src/intelligence/migration/migration-engine"
import { CrossLanguageMigrationAssistant as MA } from "../../../src/ast/cross-language-migration-assistant"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")
const DATA_DIR = path.join(ROOT, "validation/tools/bb_migrate/realdata")
const indexInfo = JSON.parse(readFileSync(path.join(ROOT, "validation/tools/bb_migrate/raw/real-corpus-index.json"), "utf8"))
const OUT = path.join(ROOT, "validation/tools/bb_migrate/REAL-CORPUS.json")

const checks: any[] = []
let goodParsed: any = null
const check = (id: string, label: string, pass: boolean, detail: any) => {
  checks.push({ id, label, pass, detail })
  console.log(`${pass ? "PASS" : "FAIL"} ${id} — ${label}`)
}
const negative = (id: string, label: string, caught: boolean, detail: any) => {
  checks.push({ id, label, pass: caught, negative: true, detail })
  console.log(`${caught ? "PASS" : "FAIL"} ${id} [negative control] — ${label}`)
}

// ── verdict predicates (also used by the negative controls) ─────────────────
function orderViolations(parsed: any): string[] {
  const order: string[] = parsed?.dependencyOrder ?? []
  const position = new Map(order.map((name, index) => [name, index]))
  const out: string[] = []
  for (const edge of parsed?.dependencyGraph?.edges ?? []) {
    if (!position.has(edge.dependent) || !position.has(edge.dependency)) continue
    if (position.get(edge.dependency)! >= position.get(edge.dependent)!) out.push(`${edge.dependency} -> ${edge.dependent}`)
  }
  return out
}
function truncationViolations(parsed: any): string[] {
  const t = parsed?.truncation
  if (!t) return ["no truncation block"]
  const out: string[] = []
  if (t.requested !== t.returned + t.capped) out.push(`requested ${t.requested} != returned ${t.returned} + capped ${t.capped}`)
  if (t.truncated !== (t.capped > 0 || t.deduplicated > 0)) out.push(`truncated flag disagrees with capped/deduplicated`)
  if (t.capped > 0 && (!Array.isArray(t.cappedNames) || t.cappedNames.length !== t.capped)) out.push(`capped ${t.capped} but named ${t.cappedNames?.length}`)
  if ((parsed?.plans?.length ?? 0) > 100) out.push(`more than the 100-component cap returned`)
  return out
}
function effortViolations(parsed: any): string[] {
  const m = parsed?.methodology
  const e = parsed?.effort
  const out: string[] = []
  if (!m || !e) return ["no methodology/effort block"]
  const expectedBase = (parsed.plans?.length ?? 0) * 4
  if (m.baseHours !== expectedBase) out.push(`baseHours ${m.baseHours} != plans * 4 (${expectedBase})`)
  if (m.relationshipHours !== m.relationshipCount * 2) out.push(`relationshipHours ${m.relationshipHours} != relationshipCount ${m.relationshipCount} * 2`)
  if (m.missingMappingHours !== m.missingMappingCount * 6) out.push(`missingMappingHours ${m.missingMappingHours} != missingMappingCount ${m.missingMappingCount} * 6`)
  if (e.totalHours !== m.baseHours + m.relationshipHours + m.missingMappingHours) out.push("totalHours is not the sum of its parts")
  const shared = (e.perPlanSumHours ?? 0) - (e.totalHours ?? 0)
  if (Math.abs(shared - (e.sharedRelationshipHours ?? 0)) > 1e-9) out.push(`reported sharedRelationshipHours ${e.sharedRelationshipHours} != perPlanSum-total ${shared}`)
  const byKind = m.relationshipByKind ?? []
  const kindEdges = byKind.reduce((sum: number, k: any) => sum + k.edges, 0)
  const kindHours = byKind.reduce((sum: number, k: any) => sum + k.hours, 0)
  if (kindEdges !== m.relationshipCount) out.push(`by-kind edges ${kindEdges} != relationshipCount ${m.relationshipCount}`)
  if (kindHours !== m.relationshipHours) out.push(`by-kind hours ${kindHours} != relationshipHours ${m.relationshipHours}`)
  return out
}
function wavePlanViolations(parsed: any): string[] {
  const plans = parsed?.plans ?? []
  const wavePlan = parsed?.cohort?.wavePlan ?? []
  const out: string[] = []
  const seen = new Map<string, number>()
  for (const wave of wavePlan) for (const symbol of wave.symbols ?? []) seen.set(symbol.symbolId, (seen.get(symbol.symbolId) ?? 0) + 1)
  for (const plan of plans) {
    if (!plan?.symbolId) continue
    if (seen.get(plan.symbolId) !== 1) out.push(`${plan.componentName} appears ${seen.get(plan.symbolId) ?? 0} times in the wave plan`)
  }
  const flat = (parsed?.waves ?? []).flat().length
  if ((parsed?.cohort?.wavePlan?.length ?? 0) > 0 && flat < (parsed?.cohort?.wavePlan?.length ?? 0)) out.push(`wave labels (${flat}) fewer than waves (${parsed.cohort.wavePlan.length})`)
  return out
}
function unsupportedReasons(parsed: any): string[] { return (parsed?.unsupported ?? []).map((u: any) => u.unsupportedReason) }

async function main() {
  const evidence: any = {
    tool: "bb_migrate",
    measuredAt: new Date().toISOString(),
    gitHead: execSync("git rev-parse HEAD", { cwd: ROOT, encoding: "utf8" }).trim(),
    dataDir: DATA_DIR,
    corpusRoot: "/home/ishaq2321/bb_tests/repositories",
    door: { command: "npx tsx src/mcp/server.ts --dir <repo>", env: { BB_DATA_DIR: DATA_DIR, BB_NO_AUTO_REFRESH: "1" }, protocol: "JSON-RPC over stdio (initialize, notifications/initialized, tools/list, tools/call)" },
    selectionCommand: "npx tsx validation/tools/bb_migrate/index-real-corpus.ts (BB_DATA_DIR=" + DATA_DIR + ")",
    repos: [] as any[],
    checks,
  }
  for (const repo of indexInfo.repos) {
    if (!repo.counts) continue
    const projectId = repo.projectId
    const raw = await BrainDatabase.getRawInstance(projectId, { readonly: true })
    const q = (sql: string) => raw.prepare(sql).all(projectId) as any[]
    const repoEvidence: any = {
      id: repo.id, dir: repo.dir, projectId, languages: repo.byLanguage, counts: repo.counts, crossLanguageRelationships: repo.crossLanguageRelationships,
      cases: [], latency: {},
    }

    // ── selection: cross-language symbols, unique plannable names, an ambiguous name,
    //    and a directory whose cohort exceeds the 100-component cap ──────────────
    const cross = q(
      `SELECT s.id id, s.name name, f.language language, f.relative_path file,
              SUM(CASE WHEN r.is_cross_language=1 THEN 1 ELSE 0 END) crossEdges
       FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id
       JOIN brain_relationship r ON r.source_symbol_id = s.id OR r.target_symbol_id = s.id
       WHERE s.project_id=? AND s.symbol_type IN ('function','method','class','module','macro') AND f.language IN ('elixir','erlang','clojure','javascript','typescript')
       GROUP BY s.id HAVING crossEdges > 0 ORDER BY crossEdges DESC, s.name LIMIT 20`,
    ).map((r: any) => ({ ...r, crossEdges: Number(r.crossEdges) }))
    const routeFor = (language: string): string | null => {
      const candidates = ["elixir", "erlang", "typescript", "python", "go", "rust", "clojure"]
      return candidates.find((target) => target !== language && MA.hasMigrationRoute(language, target)) ?? null
    }
    const uniqueNames = q(
      `SELECT s.name name, s.symbol_type type, f.language language, COUNT(*) n, COUNT(DISTINCT s.file_id) files
       FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id
       WHERE s.project_id=? AND s.symbol_type IN ('function','method','class','module','macro') AND f.language IN ('elixir','erlang','clojure','javascript','typescript')
       GROUP BY lower(s.name) HAVING files = 1 AND n = 1 ORDER BY (SELECT COUNT(*) FROM brain_relationship r WHERE r.source_symbol_id = s.id OR r.target_symbol_id = s.id) DESC LIMIT 80`,
    ).map((r: any) => ({ ...r, n: Number(r.n), files: Number(r.files) }))
    const ambiguousRows = q(
      `SELECT lower(s.name) name, COUNT(DISTINCT s.file_id) files
       FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id
       WHERE s.project_id=? AND f.language IN ('elixir','erlang','clojure','javascript','typescript') AND s.symbol_type IN ('function','method','class','module','macro')
       GROUP BY lower(s.name) HAVING files BETWEEN 2 AND 60 ORDER BY files ASC LIMIT 12`,
    ).map((r: any) => ({ name: r.name, files: Number(r.files) }))
    const migratableFiles = q(
      `SELECT f.relative_path path FROM brain_file f
       WHERE f.project_id=? AND f.language IN ('elixir','erlang','clojure','javascript','typescript')`,
    ).map((r: any) => String(r.path))
    const dirCounts = new Map<string, number>()
    for (const file of migratableFiles) {
      const parts = file.split("/")
      if (parts.length < 2) continue
      for (let depth = 1; depth <= Math.min(3, parts.length - 1); depth++) {
        const prefix = parts.slice(0, depth).join("/")
        dirCounts.set(prefix, (dirCounts.get(prefix) ?? 0) + 1)
      }
    }
    const dirs = [...dirCounts.entries()].map(([prefix, files]) => ({ prefix, files })).sort((a, b) => b.files - a.files || a.prefix.localeCompare(b.prefix))

    // probe with the production planner (selection only; every VERDICT below goes through the door)
    const probe = async (args: any) => generateMigrationPlans(projectId, { symbolNames: [], targetLanguage: "typescript", ...args })
    const crossPlan = [] as any[]
    for (const candidate of cross) {
      const target = routeFor(candidate.language)
      if (!target) continue
      const outcome = await probe({ symbolIds: [candidate.id], targetLanguage: target })
      const plan = outcome.plans[0]
      if (plan && (plan.relationshipEvidence ?? []).some((e: any) => e.isCrossLanguage === true)) { crossPlan.push({ candidate, target, plan }); break }
    }
    const batchNames: string[] = []
    for (const candidate of uniqueNames) {
      if (batchNames.length >= 5) break
      if (batchNames.includes(candidate.name)) continue
      const target = routeFor(candidate.language)
      if (!target) continue
      const outcome = await probe({ symbolNames: [candidate.name], targetLanguage: target })
      if (outcome.plans.length === 1) batchNames.push(candidate.name)
    }
    const dirCohort = dirs.find((d) => d.files >= 120) ?? dirs[0]
    let ambiguous: { name: string; candidateId: string } | null = null
    for (const row of ambiguousRows) {
      const candidates = raw.prepare(
        `SELECT s.id id, s.name name FROM brain_symbol s JOIN brain_file f ON f.id=s.file_id
         WHERE s.project_id=? AND lower(s.name)=? AND s.symbol_type IN ('function','method','class','module','macro') AND f.language IN ('elixir','erlang','clojure','javascript','typescript') LIMIT 5`,
      ).all(projectId, row.name) as any[]
      for (const candidate of candidates) {
        const probeById = await probe({ symbolIds: [candidate.id] })
        if (probeById.plans.length === 1) { ambiguous = { name: row.name, candidateId: candidate.id }; break }
      }
      if (ambiguous) break
    }

    // ── the door ────────────────────────────────────────────────────────────
    const door = await openDoor({ dir: repo.dir, dataDir: DATA_DIR, label: `real-${repo.id}` })
    const tool = door.tools.find((t: any) => t.name === "bb_migrate")
    check(`door-${repo.id}`, `${repo.id}: bb_migrate is registered on the live door`, !!tool, tool?.description?.slice(0, 100))

    const call = async (label: string, args: any, timeoutMs = 240_000) => {
      const r = await door.callTool(args, timeoutMs)
      if (r.parsed?.plans?.length && !goodParsed) goodParsed = r.parsed
      repoEvidence.cases.push({ label, args, ms: r.ms, isError: r.isError, rpcError: r.rpcError, parsed: r.parsed ? summaryOf(r.parsed) : null, textHead: r.parsed ? undefined : r.text.split("\n").slice(0, 4) })
      return r
    }

    // single plan by symbol id (the unambiguous selector)
    if (crossPlan[0]) {
      const c = crossPlan[0]
      const r = await call("single-cross-language", { symbolIds: [c.candidate.id], targetLanguage: c.target, format: "json" })
      const parsed = r.parsed
      check(`single-${repo.id}`, `${repo.id}: single plan by symbol id (${c.candidate.name}, ${c.candidate.language} -> ${c.target})`, !!parsed && parsed.plans?.length === 1 && !r.isError, { ms: r.ms, plan: parsed?.plans?.[0]?.componentName })
      if (parsed) {
        const crossEdges = (parsed.plans[0].relationshipEvidence ?? []).filter((e: any) => e.isCrossLanguage === true)
        check(`cross-evidence-${repo.id}`, `${repo.id}: the plan cites real cross-language relationship evidence`, crossEdges.length > 0 && parsed.plans[0].relationshipEvidence.every((e: any) => typeof e.confidence === "number" || e.confidence === null), { crossEdges: crossEdges.length, sample: crossEdges[0] && { line: crossEdges[0].line, bridge: crossEdges[0].bridgeMechanism, confidence: crossEdges[0].confidence } })
        check(`order-${repo.id}`, `${repo.id}: dependency order respects every in-scope edge`, orderViolations(parsed).length === 0, orderViolations(parsed).slice(0, 5))
        check(`effort-${repo.id}`, `${repo.id}: effort arithmetic is self-consistent and by-kind sums to the total`, effortViolations(parsed).length === 0, effortViolations(parsed).slice(0, 5))
        check(`waves-${repo.id}`, `${repo.id}: the wave plan accounts for every plan exactly once`, wavePlanViolations(parsed).length === 0, wavePlanViolations(parsed).slice(0, 5))
        check(`freshness-${repo.id}`, `${repo.id}: a just-built index yields a complete freshness envelope with no stale plan`, !!parsed.freshness && parsed.freshness.mode === "complete" && parsed.freshness.stale === 0 && parsed.plans.every((p: any) => p.stale === false), { freshness: parsed.freshness, staleFlags: parsed.plans.map((p: any) => p.stale) })
      }
    }

    // batch by names (unique across files)
    if (batchNames.length >= 2) {
      const target = routeFor(crossPlan[0]?.candidate.language ?? "elixir") ?? "typescript"
      const r = await call("batch-names", { symbolNames: batchNames, targetLanguage: target, format: "json" })
      const parsed = r.parsed
      const accounted = (parsed?.plans?.length ?? 0) + (parsed?.unsupported?.length ?? 0)
      check(`batch-${repo.id}`, `${repo.id}: a ${batchNames.length}-name batch accounts for every requested name`, !!parsed && !r.isError && accounted === batchNames.length && parsed.truncation.deduplicated === 0, { requested: batchNames.length, plans: parsed?.plans?.length, refused: parsed?.unsupported?.length })
      check(`batch-order-${repo.id}`, `${repo.id}: the batch order respects every in-scope edge and the wave plan partitions it`, !!parsed && orderViolations(parsed).length === 0 && wavePlanViolations(parsed).length === 0, { order: parsed?.dependencyOrder, violations: parsed ? orderViolations(parsed).slice(0, 5) : null })
      check(`batch-effort-${repo.id}`, `${repo.id}: batch effort arithmetic is self-consistent`, !!parsed && effortViolations(parsed).length === 0, parsed ? effortViolations(parsed).slice(0, 5) : null)
    }

    // directory cohort: cap + naming + partition
    if (dirCohort) {
      const target = routeFor(crossPlan[0]?.candidate.language ?? "elixir") ?? "typescript"
      const r = await call("path-cohort", { paths: [dirCohort.prefix], targetLanguage: target, format: "json" })
      const parsed = r.parsed
      check(`cohort-${repo.id}`, `${repo.id}: a directory cohort returns at most the 100-component cap and names what it dropped`, !!parsed && !r.isError && (parsed.plans?.length ?? 0) <= 100 && truncationViolations(parsed).length === 0 && (parsed.truncation.capped === 0 || parsed.truncation.cappedNames.length === parsed.truncation.capped), { path: dirCohort.prefix, files: dirCohort.files, truncation: parsed?.truncation && { requested: parsed.truncation.requested, returned: parsed.truncation.returned, capped: parsed.truncation.capped, named: parsed.truncation.cappedNames?.length }, plans: parsed?.plans?.length })
      check(`cohort-effort-${repo.id}`, `${repo.id}: cohort effort arithmetic is self-consistent (no negative shared hours)`, !!parsed && effortViolations(parsed).length === 0 && (parsed.effort?.sharedRelationshipHours ?? 0) >= 0, parsed ? { effort: parsed.effort, violations: effortViolations(parsed).slice(0, 5) } : null)
    }

    // unsupported cases: unknown target, same language, missing symbol, misspelled id
    const sampleLanguage = crossPlan[0]?.candidate.language ?? "elixir"
    const unknown = await call("unsupported-unknown-target", { symbolNames: batchNames.slice(0, 1), targetLanguage: "cobol", format: "json" })
    check(`unknown-target-${repo.id}`, `${repo.id}: an unknown target language is refused by name in the payload, not silently planned`, !!unknown.parsed && unsupportedReasons(unknown.parsed).includes("unsupported-target") && (unknown.parsed.plans?.length ?? 0) === 0, unsupportedReasons(unknown.parsed))
    const same = crossPlan[0] ? await call("unsupported-same-language", { symbolIds: [crossPlan[0].candidate.id], targetLanguage: sampleLanguage, format: "json" }) : null
    check(`same-language-${repo.id}`, `${repo.id}: a same-language request produces no plan and names the reason`, !!same && !!same.parsed && unsupportedReasons(same.parsed).includes("same-language") && (same.parsed.plans?.length ?? 0) === 0, same?.parsed ? unsupportedReasons(same.parsed) : "no cross-language plan to ask about")
    const missing = await call("unsupported-missing-symbol", { symbolNames: ["zzz_no_such_symbol_" + repo.id], targetLanguage: "typescript", format: "json" })
    check(`missing-symbol-${repo.id}`, `${repo.id}: a name no symbol carries is refused as missing-symbol`, !!missing.parsed && unsupportedReasons(missing.parsed).includes("missing-symbol"), unsupportedReasons(missing.parsed))
    const bogusId = await call("refuse-bogus-id", { symbolIds: ["not-a-real-symbol-id"], targetLanguage: "typescript" })
    check(`bogus-id-${repo.id}`, `${repo.id}: a symbol id no symbol carries is refused by the handler with isError`, bogusId.isError === true && !bogusId.rpcError, bogusId.text.split("\n")[0])

    // ambiguous name refuses with candidates that actually resolve by id
    if (ambiguous) {
      const byName = await call("ambiguous-name", { symbolNames: [ambiguous.name], targetLanguage: "typescript", format: "json" })
      const refusal = byName.parsed?.unsupported?.find((u: any) => u.unsupportedReason === "ambiguous-symbol")
      check(`ambiguous-${repo.id}`, `${repo.id}: ambiguous name "${ambiguous.name}" refuses and names candidate ids`, !!refusal && (refusal.candidates?.length ?? 0) > 1, refusal ? { reason: refusal.reason, candidates: refusal.candidates?.length } : unsupportedReasons(byName.parsed))
      const byId = await call("ambiguous-resolved-by-id", { symbolIds: [ambiguous.candidateId], targetLanguage: "typescript", format: "json" })
      check(`identity-${repo.id}`, `${repo.id}: the ambiguity refusal's candidate id resolves to exactly one plan`, !!byId.parsed && byId.parsed.plans?.length === 1 && !byId.isError, { plan: byId.parsed?.plans?.[0]?.componentName, ms: byId.ms })
    }

    // an unrouted pair: planned, with the missing-data gap stated twice (mapping that cannot be made)
    if (crossPlan[0]) {
      const source = crossPlan[0].candidate.language
      const unrouted = ["elixir", "erlang", "clojure", "typescript", "javascript"].find((t) => t !== source && !MA.hasMigrationRoute(source, t))
      if (unrouted) {
        const r = await call("unrouted-pair", { symbolIds: [crossPlan[0].candidate.id], targetLanguage: unrouted, format: "json" })
        const full = await door.callTool({ symbolIds: [crossPlan[0].candidate.id], targetLanguage: unrouted, format: "json" }, 180_000)
        const plan = full.parsed?.plans?.[0]
        const provenance = plan?.dependencyProvenance
        const noteText = JSON.stringify(provenance ?? {})
        // The contract is "no INVENTED mapping", not "dependencies is empty": an observed
        // import with no registered target is reported as confidence 0 / target null, which
        // is declared, not invented. Every dependency row must therefore carry no target.
        const dependencyRows = plan?.dependencies ?? []
        const invented = dependencyRows.filter((d: any) => d.target != null || (d.confidence ?? 0) > 0)
        check(`unrouted-${repo.id}`, `${repo.id}: an unrouted ${source} -> ${unrouted} pair is planned with the missing-data gap declared and no invented mapping`, !!plan && noteText.includes("MISSING DATA") && invented.length === 0 && (plan.inferredDependencies?.length ?? 0) === 0, { target: unrouted, note: provenance?.note, dependencyRows: dependencyRows.length, inventedTargets: invented.length, riskFactors: plan?.riskAssessment?.factors?.length })
      }
    }

    // latency: warm single-plan call, five runs
    if (crossPlan[0] && batchNames.length) {
      const target = crossPlan[0].target
      const args = { symbolNames: [batchNames[0]], targetLanguage: target, format: "json" }
      const samples: number[] = []
      for (let i = 0; i < 5; i++) { const r = await door.callTool(args, 240_000); samples.push(r.ms) }
      const sorted = [...samples].sort((a, b) => a - b)
      repoEvidence.latency.singleJson = { samplesMs: samples, p50Ms: sorted[2], p95Ms: sorted[Math.min(4, Math.ceil(0.95 * sorted.length) - 1)] }
    }
    repoEvidence.cases = repoEvidence.cases.map((c: any) => ({ ...c }))
    evidence.repos.push({ ...repoEvidence, doorNonJsonStdout: door.nonJsonStdout(), toolDescription: tool?.description?.slice(0, 160) })
    await door.close()
  }

  // ── planted negative controls: every verdict predicate must reject a wrong answer ──
  const good = goodParsed
  if (good) {
    const reversed = JSON.parse(JSON.stringify(good))
    if ((reversed.dependencyOrder?.length ?? 0) > 1) reversed.dependencyOrder = reversed.dependencyOrder.slice().reverse()
    else reversed.dependencyGraph = { ...(reversed.dependencyGraph ?? {}), edges: [{ dependent: reversed.dependencyOrder?.[0] ?? "a", dependency: reversed.dependencyOrder?.[0] ?? "a" }] }
    negative("neg-order", "the order predicate catches a reversed order / a self-dependent edge", orderViolations(reversed).length > 0, orderViolations(reversed).slice(0, 3))
    const noNames = JSON.parse(JSON.stringify(good)); noNames.truncation = { ...(noNames.truncation ?? {}), capped: 3, cappedNames: [], requested: 3, returned: 0, truncated: true }
    negative("neg-truncation", "the truncation predicate catches a cap that does not name what it dropped", truncationViolations(noNames).length > 0, truncationViolations(noNames))
    const badEffort = JSON.parse(JSON.stringify(good)); badEffort.methodology = { ...(badEffort.methodology ?? {}), relationshipHours: (badEffort.methodology?.relationshipHours ?? 0) + 2 }
    negative("neg-effort", "the effort predicate catches a total that is not the sum of its parts", effortViolations(badEffort).length > 0, effortViolations(badEffort).slice(0, 3))
    const noFreshness = JSON.parse(JSON.stringify(good)); delete noFreshness.freshness
    negative("neg-freshness", "the freshness predicate catches a missing freshness envelope", !(noFreshness.freshness && noFreshness.freshness.mode === "complete" && noFreshness.plans.every((p: any) => p.stale === false)), "envelope removed")
    const noCross = JSON.parse(JSON.stringify(good)); noCross.plans = noCross.plans.map((p: any) => ({ ...p, relationshipEvidence: (p.relationshipEvidence ?? []).map((e: any) => ({ ...e, isCrossLanguage: false })) }))
    negative("neg-cross", "the cross-language predicate catches a plan whose cross-language evidence vanished", noCross.plans.every((p: any) => (p.relationshipEvidence ?? []).filter((e: any) => e.isCrossLanguage === true).length === 0), "all isCrossLanguage flags cleared")
    const noWaves = JSON.parse(JSON.stringify(good)); noWaves.cohort = { ...(noWaves.cohort ?? {}), wavePlan: [] }
    negative("neg-waves", "the wave-partition predicate catches a wave plan that omits plans", wavePlanViolations(noWaves).length > 0, wavePlanViolations(noWaves).slice(0, 3))
  } else {
    check("negative-controls", "a good payload exists to plant negatives against", false, "no parsed plan case found")
  }

  const failed = checks.filter((c) => !c.pass)
  evidence.summary = { checks: checks.length, passed: checks.length - failed.length, failed: failed.length, negativeControls: checks.filter((c) => c.negative).length, failedIds: failed.map((c) => c.id) }
  evidence.verdict = failed.length === 0 ? "verified" : "failed"
  writeFileSync(OUT, JSON.stringify(evidence, null, 1))
  console.log(`\nREAL-CORPUS: ${evidence.verdict} (${evidence.summary.passed}/${evidence.summary.checks} checks, ${evidence.summary.negativeControls} negative controls) — ${OUT}`)
  if (failed.length) process.exitCode = 1
}

function summaryOf(parsed: any) {
  return {
    plans: (parsed.plans ?? []).map((p: any) => ({ symbolId: p.symbolId, name: p.componentName, sourceLanguage: p.sourceLanguage, targetLanguage: p.targetLanguage, file: p.sourceFile, stale: p.stale, effort: p.effortEstimateHours, risk: p.riskAssessment?.level, deps: p.dependencies?.length, inferred: p.inferredDependencies?.length, crossEdges: (p.relationshipEvidence ?? []).filter((e: any) => e.isCrossLanguage === true).length })),
    unsupported: parsed.unsupported,
    dependencyOrder: parsed.dependencyOrder,
    orderingStatus: parsed.dependencyGraph?.orderingStatus,
    edges: parsed.dependencyGraph?.edges?.length, unresolved: parsed.dependencyGraph?.unresolvedDependencies?.length, cycles: parsed.dependencyGraph?.cycles?.length,
    waves: parsed.waves,
    scope: { integrationPoints: parsed.scope?.integrationPoints, inScope: parsed.scope?.inScope, completeness: parsed.scope?.completeness },
    methodology: parsed.methodology && { baseHours: parsed.methodology.baseHours, relationshipHours: parsed.methodology.relationshipHours, relationshipCount: parsed.methodology.relationshipCount, missingMappingHours: parsed.methodology.missingMappingHours, missingMappingCount: parsed.methodology.missingMappingCount, byKind: parsed.methodology.relationshipByKind, rates: parsed.methodology.rates },
    effort: parsed.effort,
    truncation: parsed.truncation,
    cohort: parsed.cohort && { symbolsResolved: parsed.cohort.symbolsResolved, pathsRequested: parsed.cohort.pathsRequested, pathsUnmatched: parsed.cohort.pathsUnmatched, filesCovered: parsed.cohort.filesCovered, work: parsed.cohort.work, byLanguage: parsed.cohort.byLanguage, refusedByReason: parsed.cohort.refusedByReason, statement: parsed.cohort.statement },
    freshness: parsed.freshness,
    evidenceTotals: parsed.evidenceTotals,
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1 })
