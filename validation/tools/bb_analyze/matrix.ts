// Phase A behaviour matrix for bb_analyze (source path: validation + handler, no transport).
// Every mode x parameter combination that the descriptor promises, plus the refusals.
// Run with a tool-local data dir:
//   BB_DATA_DIR=$PWD/validation/tools/bb_analyze/bbdata BB_NO_AUTO_REFRESH=1 \
//   npx tsx validation/tools/bb_analyze/matrix.ts > matrix.json
import path from "node:path"
import { existsSync } from "node:fs"
import { getProjectId } from "../../../src/cli/index"
import { PUBLIC_TOOL_DESCRIPTORS } from "../../../src/mcp/tool-registry"
import { validateToolArguments } from "../../../src/mcp/tool-validation"
import { createToolHandlers } from "../../../src/mcp/tool-handlers"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")
const DATA = process.env.BB_DATA_DIR
if (!DATA) throw new Error("BB_DATA_DIR must be set")

const descriptor = PUBLIC_TOOL_DESCRIPTORS.find((t) => t.name === "bb_analyze")!
const handler = createToolHandlers()["bb_analyze"]

type Row = {
  id: string
  args: Record<string, unknown>
  ok: boolean
  thrown?: string
  bytes?: number
  text?: string
  parsed?: any
  errorFlag?: boolean
  errorMessage?: string
  notes?: string[]
}
const rows: Row[] = []
const notes: string[] = []

async function call(id: string, args: Record<string, unknown>, note?: (r: Row) => void): Promise<Row> {
  const tier = (args as any).__tier ?? "T1"
  const dir = tier === "T0" ? path.join(ROOT, "test/fixtures/polyglot") : path.join(ROOT, ".perf-fixtures/bb-scale/n100")
  const clean = { ...args }
  delete clean.__tier
  const row: Row = { id, args: clean, ok: false }
  try {
    const validated = validateToolArguments(descriptor, clean)
    const res = await handler(validated, { projectPath: dir, projectId: getProjectId(dir) })
    const text = res.content.map((c: any) => c.text).join("\n")
    row.text = text
    row.bytes = Buffer.byteLength(text)
    row.errorFlag = res.isError === true
    try {
      row.parsed = JSON.parse(text)
    } catch {
      row.parsed = undefined
    }
    row.ok = !row.errorFlag
    note?.(row)
  } catch (e: any) {
    row.thrown = e?.message ?? String(e)
    row.ok = false
  }
  rows.push(row)
  return row
}

const T1 = path.join(ROOT, ".perf-fixtures/bb-scale/n100")
const T0 = path.join(ROOT, "test/fixtures/polyglot")

async function symbolIn(dir: string, kind: string, minDegree?: number): Promise<string | null> {
  const { BrainDatabase } = await import("../../../src/brain/database")
  const raw = await BrainDatabase.getRawInstance(getProjectId(dir))
  const pid = getProjectId(dir)
  const rows2 = raw.prepare(
    `SELECT s.name, COUNT(*) c FROM brain_relationship r JOIN brain_symbol s ON s.id = r.target_symbol_id
     WHERE r.project_id = ? GROUP BY s.name ORDER BY c DESC LIMIT 5`,
  ).all(pid) as Array<{ name: string; c: number }>
  const hit = rows2.find((r) => !minDegree || r.c >= minDegree)
  return hit?.name ?? null
}

const hubT1 = (await symbolIn(T1, "function", 3)) ?? "main"
const hubT0 = (await symbolIn(T0, "function")) ?? "main"
console.log(`# hubT1=${hubT1} hubT0=${hubT0}`)

// ── 1. callers / callees / trace ─────────────────────────────────────────────
for (const mode of ["callers", "callees", "trace"] as const) {
  await call(`${mode}:success`, { mode, target: hubT1 }, (r) => {
    const p = r.parsed
    const need = ["mode", "target", "found", "root", "rootMatch", "rootCandidates", "callers", "callees", "nodes", "summary", "provenance", "freshness"]
    const missing = need.filter((k) => !(k in p))
    if (missing.length) r.notes = [`missing keys: ${missing.join(",")}`]
    const s = p.summary ?? {}
    for (const k of ["returnedCallers", "returnedCallees", "pageEdgeLimit", "pageTruncated", "totalCallers", "totalCallees", "maxDepth", "maxDepthReached", "timeBudgetMs"]) {
      if (!(k in s)) (r.notes ??= []).push(`summary missing ${k}`)
    }
  })
  await call(`${mode}:limit1`, { mode, target: hubT1, limit: 1 }, (r) => {
    const p = r.parsed
    const over = (p.callers?.length ?? 0) > 1 || (p.callees?.length ?? 0) > 1
    r.notes = [over ? "LIMIT NOT HONORED" : `limit honored (c=${p.callers?.length}, ce=${p.callees?.length})`]
  })
  await call(`${mode}:notfound`, { mode, target: "zz_no_such_symbol_zz" }, (r) => {
    const p = r.parsed
    r.notes = [`found=${p.found} notFoundReason=${p.notFoundReason} rootMatch=${JSON.stringify(p.rootMatch)} isError=${r.errorFlag}`]
  })
}

// ── 2. dependencies ──────────────────────────────────────────────────────────
await call("dependencies:default", { mode: "dependencies" })
await call("dependencies:limit1", { mode: "dependencies", limit: 1 })
await call("dependencies:filePath-exact", { mode: "dependencies", filePath: "src/wide/module_0.ts" })
await call("dependencies:filePath-trailing-slash", { mode: "dependencies", filePath: "src/wide/" })
await call("dependencies:filePath-absent", { mode: "dependencies", filePath: "src/does_not_exist" })
await call("dependencies:filePath-util-vs-utilities", { mode: "dependencies", filePath: "src/util" })

// ── 3. stats ─────────────────────────────────────────────────────────────────
await call("stats:default", { mode: "stats" }, (r) => {
  const p = r.parsed
  const f = p.freshness ?? {}
  r.notes = [`freshnessMode=${f.mode} fresh=${f.fresh} stale=${f.stale} missing=${f.missing} langs=${p.languages?.length}`]
  if (p.freshness?.freshnessMode === "sampled") r.notes.push("declared sampled")
})

// ── 4. complexity ────────────────────────────────────────────────────────────
await call("complexity:project", { mode: "complexity" })
await call("complexity:exact-file", { mode: "complexity", target: "src/wide/module_0.ts" })
await call("complexity:dir-prefix", { mode: "complexity", target: "src/wide" })
await call("complexity:top-level-dir", { mode: "complexity", target: "src" })
await call("complexity:symbol-refused", { mode: "complexity", target: hubT1 }, (r) => {
  r.notes = [`errorFlag=${r.errorFlag} msg=${(r.text ?? "").slice(0, 120)}`]
})
await call("complexity:absent-refused", { mode: "complexity", target: "zz/none.ts" })

// ── 5. impact ────────────────────────────────────────────────────────────────
await call("impact:success", { mode: "impact", target: hubT1 }, (r) => {
  const p = r.parsed
  const need = ["target", "found", "root", "scope", "directSymbols", "affectedFiles", "riskLevel", "truncated", "depthCap", "nodeBudget", "depthReached", "totalSymbols", "totalSymbolsIfKnown", "provenance", "freshness"]
  r.notes = [`missing=${need.filter((k) => !(k in p)).join(",")} root=${p.root ? p.root.name : null} match=${p.root?.match}`]
})
await call("impact:notfound", { mode: "impact", target: "zz_no_such_symbol_zz" }, (r) => {
  const p = r.parsed
  r.notes = [`found=${p.found} notFoundReason=${p.notFoundReason} isError=${r.errorFlag}`]
})
await call("impact:limit-refused", { mode: "impact", target: hubT1, limit: 5 }, (r) => {
  r.notes = [`errorFlag=${r.errorFlag} msg=${(r.text ?? "").slice(0, 100)}`]
})

// ── 6. test intelligence ─────────────────────────────────────────────────────
await call("test_mapping:default", { mode: "test_mapping" }, (r) => {
  const s = r.parsed?.summary ?? {}
  r.notes = [`returned=${s.returned} productionSymbols=${s.productionSymbols} truncated=${s.truncated} tested=${s.testedSymbols} testFiles=${s.testFiles} unknowns=${JSON.stringify(r.parsed?.provenance?.unknowns)}`]
})
await call("test_mapping:limit2", { mode: "test_mapping", limit: 2 }, (r) => {
  const s = r.parsed?.summary ?? {}
  r.notes = [`entries=${r.parsed?.entries?.length} returned=${s.returned} truncated=${s.truncated}`]
})
await call("test_mapping:filePath-exact-file", { mode: "test_mapping", filePath: "src/wide/module_0.ts" }, (r) => {
  const s = r.parsed?.summary ?? {}
  r.notes = [`productionSymbols=${s.productionSymbols} returned=${s.returned} (an exact existing file answers an empty population?)`]
})
await call("test_gaps:default", { mode: "test_gaps" }, (r) => {
  const s = r.parsed?.summary ?? {}
  r.notes = [`gaps=${s.total} productionSymbols=${s.productionSymbols} directlyTested=${s.directlyTested} excludedAsNoise=${s.excludedAsNoise} returned=${s.returned} truncated=${s.truncated}`]
})
await call("test_gaps:limit2", { mode: "test_gaps", limit: 2 }, (r) => {
  const s = r.parsed?.summary ?? {}
  r.notes = [`gaps=${r.parsed?.gaps?.length} returned=${s.returned} truncated=${s.truncated}`]
})
await call("test_impact:default", { mode: "test_impact", target: hubT1 }, (r) => {
  const p = r.parsed ?? {}
  r.notes = [`found=${p.found} direct=${p.directTests?.length} indirect=${p.indirectTests?.length} truncated=${p.truncated} hasSummary=${"summary" in p} timeBudgetDeclared=${"timeBudgetMs" in p}`]
})
await call("test_impact:notfound", { mode: "test_impact", target: "zz_no_such_symbol_zz" }, (r) => {
  const p = r.parsed
  r.notes = [`found=${p.found} isError=${r.errorFlag} freshness=${JSON.stringify(p.freshness?.mode)}`]
})
await call("test_quality:default", { mode: "test_quality" }, (r) => {
  const p = r.parsed ?? {}
  const s = p.summary ?? {}
  r.notes = [`files=${p.files?.length} summary.returned=${s.returned} summary.truncated=${s.truncated} sampled=${p.provenance?.sampled}`]
})
await call("test_quality:limit2", { mode: "test_quality", limit: 2 }, (r) => {
  const p = r.parsed ?? {}
  r.notes = [`files=${p.files?.length} (limit was 2) sampled=${p.provenance?.sampled}`]
})

// ── 7. refusals ──────────────────────────────────────────────────────────────
const refusals: Array<[string, Record<string, unknown>]> = [
  ["refusal:no-mode", {}],
  ["refusal:blank-mode", { mode: "" }],
  ["refusal:unknown-mode", { mode: "coupling" }],
  ["refusal:unknown-option", { mode: "stats", verbose: true }],
  ["refusal:limit-on-stats", { mode: "stats", limit: 5 }],
  ["refusal:limit-on-impact", { mode: "impact", target: hubT1, limit: 5 }],
  ["refusal:limit-on-test_impact", { mode: "test_impact", target: hubT1, limit: 5 }],
  ["refusal:limit0", { mode: "dependencies", limit: 0 }],
  ["refusal:limit-negative", { mode: "dependencies", limit: -1 }],
  ["refusal:limit-fraction", { mode: "dependencies", limit: 2.5 }],
  ["refusal:limit-over-graph-ceiling", { mode: "callers", target: hubT1, limit: 5001 }],
  ["refusal:limit-over-rest-ceiling", { mode: "dependencies", limit: 2001 }],
  ["refusal:target-on-stats", { mode: "stats", target: hubT1 }],
  ["refusal:target-on-dependencies", { mode: "dependencies", target: "src" }],
  ["refusal:filePath-on-callers", { mode: "callers", target: hubT1, filePath: "src" }],
  ["refusal:filePath-on-complexity", { mode: "complexity", filePath: "src" }],
  ["refusal:blank-target-callers", { mode: "callers", target: "   " }],
  ["refusal:no-target-callers", { mode: "callers" }],
  ["refusal:no-target-impact", { mode: "impact" }],
  ["refusal:no-target-test_impact", { mode: "test_impact" }],
]
for (const [id, args] of refusals) {
  await call(id, args, (r) => {
    r.notes = [`errorFlag=${r.errorFlag} thrown=${r.thrown ? "YES" : "no"} msg=${(r.text ?? "").slice(0, 110).replace(/\n/g, " ")}`]
  })
}

// ── 8. alias forgiveness ─────────────────────────────────────────────────────
await call("alias:symbol->target", { mode: "callers", symbol: hubT1 })
await call("alias:query->target", { mode: "callers", query: hubT1 })

// ── 9. T0 tiny correctness ───────────────────────────────────────────────────
await call("T0:callers", { mode: "callers", target: hubT0, __tier: "T0" })
await call("T0:stats", { mode: "stats", __tier: "T0" })

console.log(JSON.stringify({ tool: "bb_analyze", dataDir: DATA, rows }, null, 2))
