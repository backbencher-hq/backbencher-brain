// Phase-A read-only audit probe for bb_impact. Writes ONLY under
// validation/tools/bb_impact/** (fixtures + its own BB_DATA_DIR). Never touches
// the shared .bb-data index. Run with BB_NO_AUTO_REFRESH=1 for the measurement arm.
import { mkdirSync, writeFileSync, rmSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../../..")
const WORK = path.join(ROOT, "validation/tools/bb_impact/work")
const FIXTURES = path.join(WORK, "fixtures")

type Json = Record<string, any>
const out: Json[] = []
function record(id: string, payload: Json) {
  out.push({ id, ...payload })
  console.log(JSON.stringify({ id, ...payload }))
}

async function main() {
  const { getProjectId } = await import(path.join(ROOT, "src/util/project-id.ts"))
  const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer"))
  const { createToolHandlers } = await import(path.join(ROOT, "src/mcp/tool-handlers.ts"))

  rmSync(WORK + "/fixtures", { recursive: true, force: true })
  mkdirSync(FIXTURES, { recursive: true })

  const handlers = createToolHandlers() as any
  const call = async (args: Json) => {
    const r = await handlers.bb_impact(args, { projectPath: ctxPath.current, projectId: ctxPath.currentId } as any)
    const text = r?.content?.[0]?.text ?? ""
    let parsed: any = null
    try { parsed = JSON.parse(text) } catch { /* error text */ }
    return { isError: r?.isError === true, text, parsed }
  }
  const ctxPath: { current: string; currentId: string } = { current: "", currentId: "" }

  const writeFixture = (name: string, files: Record<string, string>) => {
    const dir = path.join(FIXTURES, name)
    for (const [rel, content] of Object.entries(files)) {
      const abs = path.join(dir, rel)
      mkdirSync(path.dirname(abs), { recursive: true })
      writeFileSync(abs, content)
    }
    return dir
  }
  const index = async (name: string, files: Record<string, string>) => {
    const dir = writeFixture(name, files)
    const pid = getProjectId(dir)
    await indexProjectParallel(pid, dir, {})
    return { dir, pid }
  }
  const use = (p: { dir: string; pid: string }) => { ctxPath.current = p.dir; ctxPath.currentId = p.pid }
  const summary = (p: any) => p && {
    shownCount: p.shownCount,
    totalCountIfKnown: p.totalCountIfKnown,
    directCount: p.directCount,
    truncated: p.truncated,
    truncationReason: p.truncationReason ?? null,
    reproducible: p.reproducible ?? null,
    depthReached: p.traversal?.depthReached,
    engineTruncationReason: p.traversal?.engineTruncationReason ?? null,
    budget: p.budget,
    rule: p.rule,
    countVerification: p.countVerification,
    cascade: p.cascade,
    rootMatch: p.rootMatch,
    resolution: p.resolution,
    viaCounts: p.impact ? {
      exact: p.impact.filter((d: any) => d.via === "exact").length,
      member: p.impact.filter((d: any) => d.via === "member").length,
      rangeFolded: p.impact.filter((d: any) => d.via === "range-folded").length,
    } : null,
    depths: p.impact ? [...new Set(p.impact.map((d: any) => d.depth))].sort((a, b) => a - b) : null,
    distinctDeps: p.impact ? new Set(p.impact.map((d: any) => d.id)).size : null,
    freshness: p.freshness ? { fresh: p.freshness.fresh, stale: p.freshness.stale, missing: p.freshness.missing } : null,
    rootStale: p.rootStale,
    autoRefresh: p.autoRefresh ?? null,
  }

  // ── 1. basic fixture: direct + one-hop chain + class cascade ────────────────
  const basic = await index("basic", {
    "src/a.ts": `export function leaf(): number { return 1 }\nexport class Service {\n  run(): void { leaf() }\n  other(): void {}\n}\n`,
    "src/b.ts": `import { leaf, Service } from "./a"\nexport function b1(): void { leaf() }\nexport function b2(): void { leaf() }\nexport function b3(): void { new Service().run() }\n`,
    "src/c.ts": `import { b1 } from "./b"\nexport function c1(): void { b1() }\n`,
    "src/d.ts": `import { c1 } from "./c"\nexport function d1(): void { c1() }\n`,
  })
  use(basic)
  const leaf = await call({ symbol: "leaf" })
  record("basic-leaf", { isError: leaf.isError, payload: summary(leaf.parsed) })
  const service = await call({ symbol: "Service" })
  record("basic-class-cascade", { isError: service.isError, payload: summary(service.parsed) })

  // ── 2. alias handling promised by the descriptor schema ─────────────────────
  for (const alias of ["target", "symbolName", "query"]) {
    const r = await call({ [alias]: "leaf" })
    record(`alias-${alias}`, { isError: r.isError, textHead: r.text.slice(0, 120) })
  }

  // ── 3. empty relationshipTypes: documented refusal vs actual behavior ──────
  const empty = await call({ symbol: "leaf", relationshipTypes: [] })
  record("reltypes-empty", {
    isError: empty.isError,
    payload: summary(empty.parsed),
    sameShownAsDefault: empty.parsed?.shownCount === leaf.parsed?.shownCount,
    textHead: empty.isError ? empty.text.slice(0, 200) : undefined,
  })
  const allKinds = await call({ symbol: "Service", relationshipTypes: ["contains", "uses", "references", "imports", "exports", "calls", "instantiates", "extends", "implements"] })
  record("reltypes-all-kinds", { isError: allKinds.isError, payload: summary(allKinds.parsed) })

  // ── 4. unknown symbol: loud declared error ──────────────────────────────────
  const unknown = await call({ symbol: "no_such_symbol_bb_impact_audit" })
  record("unknown-symbol", { isError: unknown.isError, text: unknown.text.slice(0, 240) })

  // ── 5. truncated answer: >200 distinct direct dependents ────────────────────
  const calls250 = ["export function target250(): void {}"]
  for (let i = 0; i < 250; i++) calls250.push(`export function f${i}(): void { target250() }`)
  const many = await index("many-callers", { "src/bulk.ts": calls250.join("\n") + "\n" })
  use(many)
  const manyRes = await call({ symbol: "target250" })
  record("budget-250", { isError: manyRes.isError, payload: summary(manyRes.parsed) })

  // ── 6. exact-budget boundary: 200 distinct dependents, 201 caller rows ─────
  // 199 callers in an early file + one caller with TWO call sites in the last
  // file: the engine's per-query row cap keeps 200 rows (199 + the first site),
  // and the 201st edge is a DUPLICATE of the 200th dependent's node.
  const early: string[] = []
  for (let i = 0; i < 199; i++) early.push(`export function e${i}(): void { target200() }`)
  const boundary = await index("budget-boundary", {
    "src/a-target.ts": "export function target200(): void {}\n",
    "src/aaa-callers.ts": `import { target200 } from "./a-target"\n` + early.join("\n") + "\n",
    "src/zzz-last.ts": `import { target200 } from "./a-target"\nexport function zz(): void {\n  target200()\n  target200()\n}\n`,
  })
  use(boundary)
  const boundaryRes = await call({ symbol: "target200" })
  record("budget-boundary-200", {
    isError: boundaryRes.isError,
    payload: summary(boundaryRes.parsed),
    totalEqualsShown: boundaryRes.parsed?.totalCountIfKnown === boundaryRes.parsed?.shownCount,
  })

  // ── 7. depth: 7-hop chain; declared maxDepth 5, reported depth semantics ───
  const deepFiles: Record<string, string> = { "src/chain0.ts": "export function hop0(): void {}\n" }
  for (let i = 1; i <= 6; i++) {
    deepFiles[`src/chain${i}.ts`] = `import { hop${i - 1} } from "./chain${i - 1}"\nexport function hop${i}(): void { hop${i - 1}() }\n`
  }
  const deep = await index("deep-chain", deepFiles)
  use(deep)
  const deepRes = await call({ symbol: "hop0" })
  record("depth-7-hop", { isError: deepRes.isError, payload: summary(deepRes.parsed), names: deepRes.parsed?.impact?.map((d: any) => `${d.name}@${d.depth}`) })

  // ── 8. determinism: identical calls, identical payload ─────────────────────
  const a = await call({ symbol: "leaf" })
  const b = await call({ symbol: "leaf" })
  record("determinism", { equal: JSON.stringify(a.parsed) === JSON.stringify(b.parsed), truncated: a.parsed?.truncated })

  // ── 9. twin agreement: component vs the bb/impact wire handler ─────────────
  const { computeImpact } = await import(path.join(ROOT, "src/lsp/impact.ts"))
  const { handleImpactRequest } = await import(path.join(ROOT, "src/lsp/impact_request.ts"))
  const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database.ts"))
  use(basic)
  const db = await (BrainDatabase as any).getRawInstance(basic.pid)
  const twinRows: Json[] = []
  for (const sym of ["leaf", "Service", "b1"]) {
    const comp = await computeImpact(db, basic.pid, sym)
    const wire = await handleImpactRequest(db, basic.pid, { schemaVersion: 1, symbol: sym })
    twinRows.push({
      symbol: sym,
      equal: JSON.stringify(comp) === JSON.stringify(wire),
      comp: { shown: comp.shownCount, total: comp.totalCountIfKnown, truncated: comp.truncated, reason: comp.truncationReason },
      wire: { shown: wire.shownCount, total: wire.totalCountIfKnown, truncated: wire.truncated, reason: wire.truncationReason },
    })
    // MCP door vs twin on the SAME index state
    const mcp = await call({ symbol: sym })
    twinRows[twinRows.length - 1].mcp = { shown: mcp.parsed?.shownCount, total: mcp.parsed?.totalCountIfKnown, truncated: mcp.parsed?.truncated, reason: mcp.parsed?.truncationReason }
  }
  record("twin-agreement", { rows: twinRows })

  // ── 10. refresh=false on a clean index: both arms agree, no repair ─────────
  const cleanDefault = await call({ symbol: "leaf" })
  const cleanOptOut = await call({ symbol: "leaf", refresh: false })
  record("refresh-clean", {
    defaultFreshness: summary(cleanDefault.parsed)?.freshness,
    optOutFreshness: summary(cleanOptOut.parsed)?.freshness,
    equal: JSON.stringify(cleanDefault.parsed) === JSON.stringify(cleanOptOut.parsed),
    defaultAutoRefresh: cleanDefault.parsed?.autoRefresh ?? null,
    optOutAutoRefresh: cleanOptOut.parsed?.autoRefresh ?? null,
  })

  writeFileSync(path.join(WORK, "phase-a-probe.json"), JSON.stringify(out, null, 2) + "\n")
  console.log("PROBE_DONE")
}

main().catch((e) => { console.error(e); process.exit(1) })
