/**
 * M14 ONTOLOGY CENSUS — lua, a targeted read of the `overrides` edges on the files
 * probes B1/B2 named. A whole-corpus number says the type fires; this says the
 * edge is the RIGHT edge on the specific lines the probes reported, which is the
 * only way to tell an override from a coincidence.
 *
 * Usage: npx tsx script/m60/lua-overrides-check.ts
 */
import { parseFile } from "../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const TARGETS = [
  "kong/kong/pdk/log.lua",                        // B1: serialize redefined at L946
  "kong/kong/observability/tracing/instrumentation.lua", // B1: wrap redefined at L180
  "kong/spec/01-unit/01-db/11-declarative_lmdb_spec.lua", // B2: _lmdb.get overrides _lmdb.get
]

for (const rel of TARGETS) {
  const [repo, ...rest] = rel.split("/")
  const r = await parseFile(`${CR}/${rel}`, `${CR}/${repo}`)
  const edges = (r as any).relationships.filter((x: any) => String(x.type).toLowerCase() === "overrides")
  console.log(`\n=== ${rel}: ${edges.length} overrides edge(s), fallback=${(r as any).fallback ?? false}`)
  for (const e of edges) {
    console.log(
      `    ${e.source} -[overrides]-> ${e.target}  line=${e.line_number}  conf=${e.confidence}` +
        `  shape=${e.metadata?.relationshipType}  ${e.metadata?.member ? `member=${e.metadata.member}` : ""}` +
        `${e.metadata?.overridesLine ? ` priorLine=${e.metadata.overridesLine}` : ""}`,
    )
  }
  // The declaration lines the edge points at, so the claim can be checked by eye.
  const lines = (r as any).symbols
    .filter((s: any) => edges.some((e: any) => e.source === (s.ownerName ?? "global") && (e.target === s.name || e.target === s.qualifiedName)))
    .map((s: any) => `    sym ${s.name} line=${s.range?.startLine} owner=${s.ownerName ?? "-"} kind=${s.kind}`)
  for (const l of lines) console.log(l)
}
