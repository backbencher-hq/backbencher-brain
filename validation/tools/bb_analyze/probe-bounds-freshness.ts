// Phase A probes: declared bounds (page truncation, per-row caps) and the
// stale-vs-missing flag on every mode's report rows.
// BB_DATA_DIR=$PWD/validation/tools/bb_analyze/bbdata BB_NO_AUTO_REFRESH=1 \
//   npx tsx validation/tools/bb_analyze/probe-bounds-freshness.ts
import path from "node:path"
import { renameSync, appendFileSync, existsSync } from "node:fs"
import { getProjectId } from "../../../src/cli/index"
import { PUBLIC_TOOL_DESCRIPTORS } from "../../../src/mcp/tool-registry"
import { validateToolArguments } from "../../../src/mcp/tool-validation"
import { createToolHandlers } from "../../../src/mcp/tool-handlers"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")
const DIR = path.join(ROOT, "validation/tools/bb_analyze/work/behaviour")
const descriptor = PUBLIC_TOOL_DESCRIPTORS.find((t) => t.name === "bb_analyze")!
const handler = createToolHandlers()["bb_analyze"]
const out: any[] = []

async function run(id: string, args: Record<string, unknown>) {
  try {
    const validated = validateToolArguments(descriptor, args)
    const res = await handler(validated, { projectPath: DIR, projectId: getProjectId(DIR) })
    const text = res.content.map((c: any) => c.text).join("\n")
    let parsed: any
    try { parsed = JSON.parse(text) } catch {}
    return { id, args, isError: res.isError === true, text, parsed, bytes: Buffer.byteLength(text) }
  } catch (e: any) {
    return { id, args, thrown: e?.message ?? String(e), isError: true }
  }
}

// ── 1. page bounds ─────────────────────────────────────────────────────────
{
  const def = await run("callers:hub:default", { mode: "callers", target: "hub" })
  const full = await run("callers:hub:limit5000", { mode: "callers", target: "hub", limit: 5000 })
  const pop = await run("callers:popular:default", { mode: "callers", target: "popular" })
  const deps = await run("dependencies:popular-exact", { mode: "dependencies", filePath: "src/many/popular.ts" })
  out.push({
    probe: "page-bounds",
    callersHubDefault: { returned: def.parsed?.summary?.returnedCallers, total: def.parsed?.summary?.totalCallers, pageEdgeLimit: def.parsed?.summary?.pageEdgeLimit, pageTruncated: def.parsed?.summary?.pageTruncated, callersIfUncapped: def.parsed?.summary?.callersIfUncapped, edgeLimit: def.parsed?.summary?.edgeLimit, cappedQueries: def.parsed?.summary?.cappedQueries },
    callersHubFull: { returned: full.parsed?.summary?.returnedCallers, total: full.parsed?.summary?.totalCallers, pageTruncated: full.parsed?.summary?.pageTruncated },
    callersPopular: { returned: pop.parsed?.summary?.returnedCallers, total: pop.parsed?.summary?.totalCallers, pageEdgeLimit: pop.parsed?.summary?.pageEdgeLimit, pageTruncated: pop.parsed?.summary?.pageTruncated, callersIfUncapped: pop.parsed?.summary?.callersIfUncapped, truncated: pop.parsed?.summary?.truncated, truncationReason: pop.parsed?.summary?.truncationReason, timeBudgetMs: pop.parsed?.summary?.timeBudgetMs, timeBudgetExhausted: pop.parsed?.summary?.timeBudgetExhausted },
    popularRowCaps: deps.parsed?.dependencies?.map((d: any) => ({ file: d.file, dependentsTotal: d.dependentsTotal, dependentsReturned: d.dependents?.length, dependentsTruncated: d.dependentsTruncated, dependenciesTotal: d.dependenciesTotal, dependenciesTruncated: d.dependenciesTruncated })),
    dependenciesSummary: deps.parsed?.summary,
  })
}

// ── 2. stale vs missing on every row-bearing mode ──────────────────────────
const W4 = path.join(DIR, "src/wide/w4.ts") // will be DELETED from disk (missing)
const TESTFILE = path.join(DIR, "tests/format.test.ts") // will be DELETED from disk (missing)
const W5 = path.join(DIR, "src/wide/w5.ts") // will be MODIFIED (stale)
const backups: Array<[string, string]> = []
function hide(p: string) { const b = p + ".phaseA.bak"; renameSync(p, b); backups.push([p, b]) }
function modify(p: string) { appendFileSync(p, "\n// phaseA freshness probe\n") }

let baseline: any, modified: any
try {
  baseline = {
    complexity: await run("complexity:w5:baseline", { mode: "complexity", target: "src/wide/w5.ts" }),
    deps: await run("dependencies:wide:baseline", { mode: "dependencies", filePath: "src/wide" }),
  }
  hide(W4)
  hide(TESTFILE)
  modify(W5)
  const after = {
    stats: await run("stats:after", { mode: "stats" }),
    complexityW5: await run("complexity:w5:after", { mode: "complexity", target: "src/wide/w5.ts" }),
    callersHub: await run("callers:hub:after", { mode: "callers", target: "hub" }),
    depsWide: await run("dependencies:wide:after", { mode: "dependencies", filePath: "src/wide" }),
    testGaps: await run("test_gaps:after", { mode: "test_gaps" }),
    testMapping: await run("test_mapping:after", { mode: "test_mapping" }),
    testQuality: await run("test_quality:after", { mode: "test_quality" }),
    impactHub: await run("impact:hub:after", { mode: "impact", target: "hub" }),
  }
  const staleOf = (rows: any[], key: string, want: string) => rows.filter((r) => r?.[key] === want)
  out.push({
    probe: "stale-vs-missing",
    note: `${path.basename(W4)} and ${path.basename(TESTFILE)} deleted from disk (status=missing); w5.ts modified (status=stale); index untouched`,
    stats: { freshness: after.stats.parsed?.freshness },
    complexityW5: { row: after.complexityW5.parsed?.breakdown?.[0], rowStale: after.complexityW5.parsed?.breakdown?.map((b: any) => b.stale), freshness: after.complexityW5.parsed?.freshness },
    graphNodesStale: (after.callersHub.parsed?.nodes ? Object.values(after.callersHub.parsed.nodes).map((n: any) => ({ file: n.file, stale: n.stale })) : []),
    deps: { rows: after.depsWide.parsed?.dependencies?.map((d: any) => ({ file: d.file, stale: d.stale })), freshness: after.depsWide.parsed?.freshness },
    testGaps: { sample: after.testGaps.parsed?.gaps?.slice(0, 3).map((g: any) => ({ file: g.file, stale: g.stale })), anyStale: after.testGaps.parsed?.gaps?.some((g: any) => g.stale === true), anyWideStale: (after.testGaps.parsed?.gaps ?? []).filter((g: any) => String(g.file).startsWith("src/wide")).map((g: any) => ({ file: g.file, stale: g.stale })), freshness: after.testGaps.parsed?.freshness },
    testMapping: { entriesForWide: (after.testMapping.parsed?.entries ?? []).filter((e: any) => String(e.file).startsWith("src/wide")).map((e: any) => ({ file: e.file, stale: e.stale })), anyStale: after.testMapping.parsed?.entries?.some((e: any) => e.stale === true) },
    testQuality: { files: after.testQuality.parsed?.files?.map((f: any) => ({ file: f.relativePath, stale: f.stale })), freshness: after.testQuality.parsed?.freshness },
    impactHub: { affected: after.impactHub.parsed?.affectedFiles, freshness: after.impactHub.parsed?.freshness },
  })
} finally {
  for (const [orig, bak] of backups) if (existsSync(bak)) renameSync(bak, orig)
  appendFileSync(W5, "") // w5 stays modified; it is a probe fixture
}

console.log(JSON.stringify(out, null, 2))
