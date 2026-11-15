// Phase-A audit probe #2 for bb_impact: failure-path honesty, empty-type
// fallback proof, unknown-parameter behavior, staleness/refresh semantics.
// Writes ONLY under validation/tools/bb_impact/**.
import { mkdirSync, writeFileSync, utimesSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../../..")
const WORK = path.join(ROOT, "validation/tools/bb_impact/work")
const FIXTURES = path.join(WORK, "fixtures")
const out: Record<string, any>[] = []
const record = (id: string, payload: Record<string, any>) => {
  out.push({ id, ...payload })
  console.log(JSON.stringify({ id, ...payload }))
}

async function main() {
  const arm = process.argv[2] ?? "measure"
  const { getProjectId } = await import(path.join(ROOT, "src/util/project-id.ts"))
  const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer"))
  const { createToolHandlers } = await import(path.join(ROOT, "src/mcp/tool-handlers.ts"))
  const handlers = createToolHandlers() as any
  const ctx: { current: string; currentId: string } = { current: "", currentId: "" }
  const call = async (args: Record<string, unknown>) => {
    const r = await handlers.bb_impact(args, { projectPath: ctx.current, projectId: ctx.currentId } as any)
    const text = r?.content?.[0]?.text ?? ""
    let parsed: any = null
    try { parsed = JSON.parse(text) } catch { /* error text */ }
    return { isError: r?.isError === true, text, parsed }
  }
  const summary = (p: any) => p && {
    shownCount: p.shownCount,
    totalCountIfKnown: p.totalCountIfKnown,
    directCount: p.directCount,
    truncated: p.truncated,
    truncationReason: p.truncationReason ?? null,
    reproducible: p.reproducible ?? null,
    depthReached: p.traversal?.depthReached,
    countVerification: p.countVerification,
    ruleTypes: p.rule?.relationshipTypes,
    cascade: p.cascade,
    freshness: p.freshness ? { fresh: p.freshness.fresh, stale: p.freshness.stale, missing: p.freshness.missing } : null,
    rootStale: p.rootStale,
    autoRefresh: p.autoRefresh ?? null,
    names: p.impact ? p.impact.map((d: any) => d.name).slice(0, 12) : null,
    staleFlags: p.impact ? p.impact.map((d: any) => d.stale) : null,
  }

  const useProject = async (name: string, files?: Record<string, string>) => {
    const dir = path.join(FIXTURES, name)
    if (files) {
      for (const [rel, content] of Object.entries(files)) {
        const abs = path.join(dir, rel)
        mkdirSync(path.dirname(abs), { recursive: true })
        writeFileSync(abs, content)
      }
    }
    const pid = getProjectId(dir)
    if (files) await indexProjectParallel(pid, dir, {})
    ctx.current = dir
    ctx.currentId = pid
    return { dir, pid }
  }

  // ── A. empty list is re-read as EVERY stored kind (proof by differential) ──
  await useProject("basic")
  const allKinds = ["calls", "instantiates", "extends", "implements", "contains", "uses", "references", "imports", "exports", "overrides"]
  const def = await call({ symbol: "leaf" })
  const empty = await call({ symbol: "leaf", relationshipTypes: [] })
  const explicit = await call({ symbol: "leaf", relationshipTypes: allKinds })
  record("empty-vs-all-kinds", {
    defaultShown: def.parsed?.shownCount,
    emptyShown: empty.parsed?.shownCount,
    allKindsShown: explicit.parsed?.shownCount,
    emptyRuleTypes: empty.parsed?.rule?.relationshipTypes,
    explicitRuleTypes: explicit.parsed?.rule?.relationshipTypes,
    emptyEqualsAllKinds: JSON.stringify([...(empty.parsed?.impact ?? [])].map((d: any) => d.id).sort()) === JSON.stringify([...(explicit.parsed?.impact ?? [])].map((d: any) => d.id).sort()),
    emptyNames: summary(empty.parsed)?.names,
    defaultNames: summary(def.parsed)?.names,
    extraKindsNames: (empty.parsed?.impact ?? []).filter((d: any) => !(def.parsed?.impact ?? []).some((x: any) => x.id === d.id)).map((d: any) => ({ name: d.name, rel: d.relationshipType, via: d.via })),
  })

  // ── B. count-walk failure path: depth boundary reached with an invalid rule ─
  // relationshipTypes: [] reaches the depth boundary in a deep chain, so the
  // completeness measurement RUNS and its SQL cannot be prepared. The catch in
  // countImpactDependents then reports total:null, direct:0, ceiling:false.
  await useProject("deep-chain")
  const deepInvalid = await call({ symbol: "hop0", relationshipTypes: [] })
  record("count-walk-failure", { isError: deepInvalid.isError, payload: summary(deepInvalid.parsed) })
  const deepDefault = await call({ symbol: "hop0" })
  record("count-walk-failure-control", { payload: summary(deepDefault.parsed) })

  // ── C. unknown / non-declared parameters: ignored silently? ────────────────
  const unknownParam = await call({ symbol: "leaf", maxDepth: 99, depth: 9, nope: true })
  record("unknown-params", { isError: unknownParam.isError, payload: summary(unknownParam.parsed) })
  const nonString = await call({ symbol: 12345 })
  record("non-string-symbol", { isError: nonString.isError, text: nonString.text.slice(0, 160) })
  const blank = await call({ symbol: "   " })
  record("blank-symbol", { isError: blank.isError, text: blank.text.slice(0, 160) })
  const bogusKind = await call({ symbol: "leaf", relationshipTypes: ["not_a_stored_kind"] })
  record("bogus-kind", { isError: bogusKind.isError, payload: summary(bogusKind.parsed) })
  const mixedKinds = await call({ symbol: "leaf", relationshipTypes: ["calls", 42, null] })
  record("mixed-types-array", { isError: mixedKinds.isError, payload: summary(mixedKinds.parsed) })

  // ── D. no dependents: zero is measured, not declared-absent ────────────────
  await useProject("no-deps", { "src/only.ts": "export function lonely(): number { return 7 }\n" })
  const lonely = await call({ symbol: "lonely" })
  record("no-dependents", { isError: lonely.isError, payload: summary(lonely.parsed) })

  // ── E. stale root + stale dependents: refresh=false vs default ─────────────
  // The fixture source is touched so the index file stat says STALE.
  await useProject("basic")
  const target = path.join(FIXTURES, "basic", "src", "b.ts")
  const content = "import { leaf, Service } from \"./a\"\nexport function b1(): void { leaf() }\nexport function b2(): void { leaf() }\nexport function b3(): void { new Service().run() }\n"
  writeFileSync(target, content + "// touched for staleness audit\n")
  const future = new Date(Date.now() + 5000)
  utimesSync(target, future, future)
  const staleDefault = await call({ symbol: "leaf" })
  const staleOptOut = await call({ symbol: "leaf", refresh: false })
  record("stale-default", { payload: summary(staleDefault.parsed) })
  record("stale-refresh-false", { payload: summary(staleOptOut.parsed) })
  // restore the fixture byte content so later runs are clean
  writeFileSync(target, content)

  writeFileSync(path.join(WORK, `phase-a-probe2-${arm}.json`), JSON.stringify(out, null, 2) + "\n")
  console.log("PROBE2_DONE")
}

main().catch((e) => { console.error(e); process.exit(1) })
