// Phase A behaviour matrix #2 — purpose-built fixture with tests, wide dir, constants.
// BB_DATA_DIR=$PWD/validation/tools/bb_analyze/bbdata BB_NO_AUTO_REFRESH=1 \
//   npx tsx validation/tools/bb_analyze/matrix-behaviour.ts > matrix-behaviour.json
import path from "node:path"
import { getProjectId } from "../../../src/cli/index"
import { indexProjectParallel } from "../../../src/ast/parallel-indexer"
import { PUBLIC_TOOL_DESCRIPTORS } from "../../../src/mcp/tool-registry"
import { validateToolArguments } from "../../../src/mcp/tool-validation"
import { createToolHandlers } from "../../../src/mcp/tool-handlers"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")
const DIR = path.join(ROOT, "validation/tools/bb_analyze/work/behaviour")
const descriptor = PUBLIC_TOOL_DESCRIPTORS.find((t) => t.name === "bb_analyze")!
const handler = createToolHandlers()["bb_analyze"]
const projectId = getProjectId(DIR)

// Index the behaviour fixture before invoking the handler, so every mode
// exercised below operates on real indexed data (F-002).
await indexProjectParallel(projectId, DIR, {})

type Row = { id: string; args: Record<string, unknown>; ok: boolean; isError?: boolean; bytes?: number; thrown?: string; text?: string; parsed?: any; notes: string[] }
const rows: Row[] = []
const pick = (o: any, keys: string[]) => Object.fromEntries(keys.filter((k) => o && k in o).map((k) => [k, o[k]]))

async function call(id: string, args: Record<string, unknown>, note?: (r: Row) => void) {
  const row: Row = { id, args, ok: false, notes: [] }
  try {
    const validated = validateToolArguments(descriptor, args)
    const res = await handler(validated, { projectPath: DIR, projectId })
    const text = res.content.map((c: any) => c.text).join("\n")
    row.text = text
    row.bytes = Buffer.byteLength(text)
    row.isError = res.isError === true
    row.ok = !row.isError
    try { row.parsed = JSON.parse(text) } catch {}
    note?.(row)
  } catch (e: any) {
    row.thrown = e?.message ?? String(e)
  }
  rows.push(row)
}

// ── complexity scoping, the parts docs make claims about ────────────────────
for (const [id, target] of [
  ["exact-file", "src/core/engine.ts"],
  ["dir-prefix-nested", "src/util"],
  ["dir-prefix-top", "src"],
  ["dir-prefix-deeper", "src/sub/deep"],
  ["absent", "src/nope.ts"],
  ["segment-boundary-src-util", "src/util"],
  ["segment-boundary-src-utilities", "src/utilities"],
  ["symbol-name-refused", "run"],
] as const) {
  await call(`complexity:${id}`, { mode: "complexity", target }, (r) => {
    const p = r.parsed
    if (!p) { r.notes.push(`ERR=${(r.text ?? "").slice(0, 120)}`); return }
    r.notes.push(`scope=${p.scope} scopeMatch=${p.scopeMatch} symbolCount=${p.symbolCount} filesInScope=${p.filesInScope} filesMatchingScope=${p.filesMatchingScope} maintainability=${JSON.stringify(p.metrics?.maintainability)} loc=${JSON.stringify(p.metrics?.linesOfCode)} coupling=${JSON.stringify(p.metrics?.couplingEdges)}`)
  })
}
await call("complexity:project", { mode: "complexity" }, (r) => {
  const p = r.parsed
  r.notes.push(`symbolCount=${p.symbolCount} match=${p.scopeMatch} maintainability=${JSON.stringify(p.metrics?.maintainability)} depth=${JSON.stringify(p.metrics?.depthOfInheritance)}`)
})

// ── dependencies: exact file / prefix / boundary / labels / row caps ────────
for (const [id, filePath] of [
  ["default", undefined],
  ["exact-file-engine", "src/core/engine.ts"],
  ["prefix-src-util", "src/util"],
  ["prefix-trailing-slash", "src/util/"],
  ["prefix-src", "src"],
  ["absent", "src/nowhere"],
  ["segment-util-not-utilities", "src/uti"],
] as const) {
  await call(`dependencies:${id}`, { mode: "dependencies", ...(filePath ? { filePath } : {}) }, (r) => {
    const p = r.parsed
    if (!p) { r.notes.push(`ERR=${(r.text ?? "").slice(0, 140)}`); return }
    const labels = new Set<string>()
    for (const d of p.dependencies ?? []) for (const x of d.dependencies ?? []) labels.add(String(x.resolution))
    r.notes.push(`returned=${p.summary?.returned} totalFiles=${p.summary?.totalFiles} truncated=${p.summary?.truncated} scope=${JSON.stringify(p.summary?.scope)} resolutions=${[...labels].join("/")} firstRows=${(p.dependencies ?? []).slice(0, 3).map((d: any) => d.file).join(",")}`)
    r.notes.push(`row.caps: ${JSON.stringify((p.dependencies ?? []).map((d: any) => [d.dependenciesTruncated, d.dependentsTruncated]).slice(0, 4))}`)
  })
}
await call("dependencies:limit1", { mode: "dependencies", limit: 1 }, (r) => {
  const p = r.parsed
  r.notes.push(`returned=${p.summary?.returned} pageLimit=${p.summary?.pageLimit} truncated=${p.summary?.truncated} totalFiles=${p.summary?.totalFiles}`)
})

// ── graph modes: kinds and matches ─────────────────────────────────────────
for (const [id, target] of [["hub", "hub"], ["leaf-recurse", "leaf"], ["constant", "MAX_RETRIES"], ["type-alias", "StageId"], ["enum", "Mode"], ["namespace", "Registry"], ["containment", "un"], ["case-fold", "HUB"]] as const) {
  await call(`callers:${id}`, { mode: "callers", target }, (r) => {
    const p = r.parsed
    if (!p) { r.notes.push(`ERR=${(r.text ?? "").slice(0, 120)}`); return }
    const kinds: Record<string, number> = {}
    for (const e of p.callers ?? []) kinds[e.relationshipType ?? "?"] = (kinds[e.relationshipType ?? "?"] ?? 0) + 1
    r.notes.push(`found=${p.found} root=${p.root?.name ?? null} match=${p.rootMatch} candidates=${p.rootCandidates} callers=${p.callers?.length} kinds=${JSON.stringify(kinds)} totals=${p.summary?.totalCallers}`)
  })
}
for (const [id, target] of [["hub", "hub"], ["constant", "MAX_RETRIES"], ["type-alias", "StageId"], ["enum", "Mode"], ["namespace", "Registry"], ["absent", "zzz_no"]] as const) {
  await call(`impact:${id}`, { mode: "impact", target }, (r) => {
    const p = r.parsed
    if (!p) { r.notes.push(`ERR=${(r.text ?? "").slice(0, 160)}`); return }
    r.notes.push(`found=${p.found} notFoundReason=${p.notFoundReason} reason=${String(p.reason ?? "").slice(0, 90)} root=${p.root?.name ?? null} match=${p.root?.match} files=${p.affectedFiles?.length} totalSymbols=${p.totalSymbols} ifKnown=${p.totalSymbolsIfKnown} depthReached=${p.depthReached} truncated=${p.truncated} risk=${p.riskLevel}`)
  })
}
await call("callees:hub", { mode: "callees", target: "hub" }, (r) => {
  const p = r.parsed
  r.notes.push(`callees=${p.callees?.length} kinds=${JSON.stringify([...new Set((p.callees ?? []).map((e: any) => e.relationshipType))])} totalCallees=${p.summary?.totalCallees}`)
})

// ── test intelligence on a corpus WITH tests ───────────────────────────────
await call("test_mapping:default", { mode: "test_mapping" }, (r) => {
  const p = r.parsed, s = p?.summary ?? {}
  r.notes.push(`entries=${p?.entries?.length} productionSymbols=${s.productionSymbols} returned=${s.returned} truncated=${s.truncated} tested=${s.testedSymbols} testFiles=${s.testFiles} scannedTestSymbols=${s.scannedTestSymbols} links=${s.evidenceLinks}`)
  r.notes.push(`identity productionSymbols+excludedAsNoise=${s.productionSymbols + s.excludedAsNoise} tested+untested=${s.testedSymbols + s.untestedSymbols}`)
})
await call("test_mapping:filePath-exact-file", { mode: "test_mapping", filePath: "src/core/engine.ts" }, (r) => {
  const s = r.parsed?.summary ?? {}
  r.notes.push(`productionSymbols=${s.productionSymbols} returned=${s.returned} testFiles=${s.testFiles}  <-- exact existing file`)
})
await call("test_mapping:filePath-prefix-src", { mode: "test_mapping", filePath: "src" }, (r) => {
  const s = r.parsed?.summary ?? {}
  r.notes.push(`productionSymbols=${s.productionSymbols} returned=${s.returned}`)
})
await call("test_gaps:default", { mode: "test_gaps" }, (r) => {
  const p = r.parsed, s = p?.summary ?? {}
  r.notes.push(`gaps=${s.total} productionSymbols=${s.productionSymbols} directlyTested=${s.directlyTested} excludedAsNoise=${s.excludedAsNoise} byCategory=${JSON.stringify(s.byCategory)} highRisk=${s.highRisk}`)
  r.notes.push(`identity: total+directlyTested=${s.total + s.directlyTested} vs productionSymbols=${s.productionSymbols}; productionSymbols+excludedAsNoise=${s.productionSymbols + s.excludedAsNoise}`)
})
await call("test_gaps:limit2", { mode: "test_gaps", limit: 2 }, (r) => {
  const s = r.parsed?.summary ?? {}
  r.notes.push(`gaps=${r.parsed?.gaps?.length} returned=${s.returned} truncated=${s.truncated} total=${s.total}`)
})
await call("test_impact:hub", { mode: "test_impact", target: "hub" }, (r) => {
  const p = r.parsed
  r.notes.push(`found=${p.found} direct=${p.directTests?.length} indirect=${p.indirectTests?.length} affected=${p.affectedTestFiles?.length} truncated=${p.truncated} hasSummary=${"summary" in p} fields=${Object.keys(p).join(",")}`)
})
await call("test_impact:run", { mode: "test_impact", target: "run" }, (r) => {
  const p = r.parsed
  r.notes.push(`found=${p.found} direct=${p.directTests?.length} indirect=${p.indirectTests?.length} evidence=${JSON.stringify([...new Set((p.directTests ?? []).map((t: any) => t.evidence))])} relTypes=${JSON.stringify([...new Set([...(p.directTests ?? []), ...(p.indirectTests ?? [])].map((t: any) => t.relationshipType))])}`)
})
await call("test_quality:default", { mode: "test_quality" }, (r) => {
  const p = r.parsed, s = p?.summary ?? {}
  r.notes.push(`files=${p?.files?.length} (fixture has 3 code test files) summary=${JSON.stringify(s)} provenance.sampled=${p?.provenance?.sampled}`)
})
await call("test_quality:limit1", { mode: "test_quality", limit: 1 }, (r) => {
  const p = r.parsed, s = p?.summary ?? {}
  r.notes.push(`files=${p?.files?.length} summary=${JSON.stringify(s)} provenance.sampled=${p?.provenance?.sampled} <-- limit=1`)
})
await call("test_quality:filePath-exact-file", { mode: "test_quality", filePath: "test/unit/engine.test.ts" }, (r) => {
  const p = r.parsed
  r.notes.push(`files=${p?.files?.length} <-- exact existing test file`)
})
await call("test_quality:filePath-prefix", { mode: "test_quality", filePath: "test" }, (r) => {
  const p = r.parsed
  r.notes.push(`files=${(p?.files ?? []).map((f: any) => f.relativePath).join(",")}`)
})

// ── stats on a polyglot-ish fixture ────────────────────────────────────────
await call("stats", { mode: "stats" }, (r) => {
  const p = r.parsed
  r.notes.push(`files=${p.files} symbols=${p.symbols} relationships=${p.relationships} callEdges=${p.callEdges} couplingTypes=${p.couplingRelationshipTypes?.length} testFiles=${p.testFiles} productionFiles=${p.productionFiles} langs=${JSON.stringify(p.languages)} freshness.mode=${p.freshness?.mode}`)
})

// ── refusal family on this fixture ─────────────────────────────────────────
await call("refusal:complexity-borderline-symbol", { mode: "complexity", target: "Pipeline" }, (r) => {
  r.notes.push(`isError=${r.isError} msg=${(r.text ?? "").slice(0, 130)}`)
})

console.log(JSON.stringify({ tool: "bb_analyze", fixture: DIR, rows }, null, 2))
