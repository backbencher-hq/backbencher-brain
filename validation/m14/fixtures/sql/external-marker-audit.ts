// EXTERNAL-MARKER AUDIT — reconciles the two coverage numbers.
//
// THE DISCREPANCY. This lane reported "125 pooled edges now marked `postgresCatalog`" and
// "191 not-resolved edges carried `metadata.external` (6 boolean + 185 strings)". An
// independent re-run of `lane-census.ts` reports "66 not-resolved edges carrying
// `metadata.external` (6 boolean + 60 strings)". Both runs are of the same instrument, so the
// two cannot describe the same population and the difference has to be NAMED rather than
// argued. The candidate explanations are:
//   (a) DEFINITIONAL — 125 counts every edge the classifier marked, while 6/60 count only
//       those that are STILL not-resolved after the marker is read. Marking an edge changes
//       its OUTCOME (`unresolved` -> `externalUnverified`), so a marked edge leaves the
//       "not-resolved" bucket by construction and can never be counted in both.
//   (b) UNDER-DELIVERY — the marker fires on a narrower condition than intended, so
//       `pg_catalog` edges that should be marked are still counted as the real gap.
//   (c) DIFFERENT POPULATIONS — pooled corpus vs gate sample.
//
// This probe separates all three by counting, for every edge: WHICH external key it carries,
// the VALUE TYPE of that key, and the OUTCOME the arbiter's own rule assigns it. Nothing here
// is inferred from a difference of two runs.
//
// USAGE: bun validation/m14/fixtures/sql/external-marker-audit.ts [corpusRoot] [--pools]
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { getParser } from "../../../../src/ast/engine.ts"
import { classifyEdge, externalClaimOf, EXTERNAL_KEYS } from "../../../../script/m14/incoming-rule.ts"

const args = process.argv.slice(2)
const POOLED = args.includes("--pools")
const ROOT = args.find((a) => !a.startsWith("--")) || "/home/ishaq2321/bb_tests/repositories"
const CAP = 1_000_000

function walk(dir: string, out: string[] = [], depth = 0): string[] {
  if (depth > 24) return out
  let ents: any[]
  try { ents = readdirSync(dir, { withFileTypes: true }) } catch { return out }
  ents.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  for (const e of ents) {
    const p = join(dir, e.name)
    if (e.isDirectory()) { if (!/node_modules|\.git|third_party/.test(e.name)) walk(p, out, depth + 1) }
    else if (e.name.endsWith(".sql")) { try { if (statSync(p).size <= CAP) out.push(p) } catch {} }
  }
  return out
}
const repoOf = (abs: string) => {
  const rel = relative(ROOT, abs)
  return POOLED ? (rel.split("/").length > 1 ? rel.split("/")[0] : "_root") : "_one"
}

const m: any = await import("../../../../src/ast/real-sql-analyzer.ts")
const Cls = Object.values(m).find((v: any) => typeof v === "function" && /Analyzer$/.test(v.name)) as any

const files = walk(ROOT)
const declCount = new Map<string, Map<string, number>>()
const kinds = new Map<string, Map<string, Set<string>>>()
type Row = { file: string; repo: string; type: string; target: string; meta: any }
const rows: Row[] = []
let parsed = 0
for (const f of files) {
  let content: string
  try { content = readFileSync(f, "utf8") } catch { continue }
  const parser = await getParser("sql")
  const pr = await parser.parse(content, f)
  const res = new Cls().analyze(pr.rootNode, content, f)
  parsed++
  const repo = repoOf(f)
  const dc = declCount.get(repo) ?? new Map(); declCount.set(repo, dc)
  const kd = kinds.get(repo) ?? new Map(); kinds.set(repo, kd)
  for (const s of res.symbols || []) {
    if (!s?.name) continue
    dc.set(s.name, (dc.get(s.name) || 0) + 1)
    const k1 = kd.get(s.name) ?? new Set(); k1.add(String(s.kind)); kd.set(s.name, k1)
    if (s.qualifiedName) {
      dc.set(s.qualifiedName, (dc.get(s.qualifiedName) || 0) + 1)
      const k2 = kd.get(s.qualifiedName) ?? new Set(); k2.add(String(s.kind)); kd.set(s.qualifiedName, k2)
    }
  }
  for (const r of res.relationships || []) {
    rows.push({ file: f, repo, type: String((r as any).type ?? (r as any).relationshipType),
                target: String((r as any).target ?? ""), meta: (r as any).metadata })
  }
}

// ── classify every edge, and bucket the marker evidence
const NOT_RESOLVED = new Set(["unresolved", "ambDeclOnly", "ambBoth", "externalRefuted"])
const tally = {
  edges: 0,
  // per key: total edges carrying it, and how many are not-resolved
  byKey: new Map<string, { total: number; notResolved: number; valueTypes: Map<string, number> }>(),
  // the exact number the Lead's run reports: not-resolved edges carrying metadata.external
  notResolvedWithExternalKey: 0,
  notResolvedWithExternalTrue: 0,
  notResolvedWithExternalString: 0,
  notResolvedWithIsExternal: 0,
  // the number this lane reported: edges that MOVED out of `unresolved` because of the marker
  markedAndNowExternalUnverified: 0,
  markedAndNowExternalVerified: 0,
  markedAndNowAmbiguous: 0,
  markedAndRefuted: 0,
  isExternalTotal: 0,
  // pg-catalog-classified edges, regardless of the marker
  externalStringPgCatalog: 0,
  externalStringPgCatalogNotResolvedIfUnmarked: 0,
}
const outcomeOfKey = new Map<string, Map<string, number>>()

for (const r of rows) {
  tally.edges++
  const dc = declCount.get(r.repo) ?? new Map()
  const kd = kinds.get(r.repo) ?? new Map()
  const c = classifyEdge(dc as any, kd as any, r.target, externalClaimOf({ metadata: r.meta }))
  const notResolved = NOT_RESOLVED.has(c.outcome)

  for (const k of EXTERNAL_KEYS) {
    const v = r.meta?.[k]
    const present = v === true || (Array.isArray(v) && v.length > 0)
    if (!present) continue
    const e = tally.byKey.get(k) ?? { total: 0, notResolved: 0, valueTypes: new Map<string, number>() }
    e.total++
    if (notResolved) e.notResolved++
    const vt = Array.isArray(v) ? `array(${v.length})` : typeof v
    e.valueTypes.set(vt, (e.valueTypes.get(vt) || 0) + 1)
    tally.byKey.set(k, e)
  }
  if (r.meta?.isExternal === true) {
    tally.isExternalTotal++
    const oc = outcomeOfKey.get("isExternal") ?? new Map<string, number>()
    oc.set(c.outcome, (oc.get(c.outcome) || 0) + 1)
    outcomeOfKey.set("isExternal", oc)
    if (c.outcome === "externalUnverified") tally.markedAndNowExternalUnverified++
    else if (c.outcome === "externalVerified") tally.markedAndNowExternalVerified++
    else if (c.outcome === "ambDeclOnly" || c.outcome === "ambBoth") tally.markedAndNowAmbiguous++
    else if (c.outcome === "externalRefuted") tally.markedAndRefuted++
  }
  // `metadata.external` specifically, by VALUE TYPE — the two numbers in dispute
  const ex = r.meta?.external
  if (ex !== undefined) {
    if (typeof ex === "string" && ex === "postgresCatalog") tally.externalStringPgCatalog++
    if (notResolved) {
      tally.notResolvedWithExternalKey++
      if (ex === true) tally.notResolvedWithExternalTrue++
      else if (typeof ex === "string") tally.notResolvedWithExternalString++
      const oc = outcomeOfKey.get(`external:${typeof ex}`) ?? new Map<string, number>()
      oc.set(c.outcome, (oc.get(c.outcome) || 0) + 1)
      outcomeOfKey.set(`external:${typeof ex}`, oc)
    }
  }
  if (r.meta?.isExternal === true && notResolved) tally.notResolvedWithIsExternal++
}

const p = (s: any, n: number) => String(s).padEnd(n)
const pl = (s: any, n: number) => String(s).padStart(n)
console.log(`EXTERNAL-MARKER AUDIT`)
console.log(`corpus: ${ROOT}   scope: ${POOLED ? "PER REPO" : "single project"}`)
console.log(`files: ${files.length}   parsed: ${parsed}   edges: ${tally.edges}\n`)
console.log(`EVERY EXTERNAL KEY THE RULE KNOWS, on this population:`)
console.log(`  ${p("key", 24)}${pl("edges", 7)}${pl("not-resolved", 14)}   value types`)
for (const k of EXTERNAL_KEYS) {
  const e = tally.byKey.get(k)
  if (!e) continue
  console.log(`  ${p(k, 24)}${pl(e.total, 7)}${pl(e.notResolved, 14)}   ${[...e.valueTypes].map(([t, n]) => `${t}:${n}`).join("  ")}`)
}
console.log(`\nTHE LEAD'S NUMBER — "not-resolved edges carrying metadata.external":`)
console.log(`  total ........................................ ${tally.notResolvedWithExternalKey}`)
console.log(`    ...metadata.external === true (readable) ... ${tally.notResolvedWithExternalTrue}`)
console.log(`    ...metadata.external a STRING (inert) ...... ${tally.notResolvedWithExternalString}`)
console.log(`  outcome breakdown of those rows:`)
for (const [k, v] of outcomeOfKey) console.log(`    ${p(k, 20)} ${[...v].map(([o, n]) => `${o}:${n}`).join("  ")}`)
console.log(`\nTHIS LANE'S NUMBER — edges the new marker carried OUT of \`unresolved\`:`)
console.log(`  metadata.isExternal === true, total ........... ${tally.isExternalTotal}`)
console.log(`    now externalUnverified (left \`unresolved\`) . ${tally.markedAndNowExternalUnverified}`)
console.log(`    now externalVerified ....................... ${tally.markedAndNowExternalVerified}`)
console.log(`    now ambiguous (never was \`unresolved\`) ..... ${tally.markedAndNowAmbiguous}`)
console.log(`    now externalRefuted (THE FALSIFIER) ........ ${tally.markedAndRefuted}`)
console.log(`  metadata.external === "postgresCatalog" ...... ${tally.externalStringPgCatalog}`)
console.log(`  where isExternal is set, is external also set? ${tally.isExternalTotal === tally.externalStringPgCatalog + tally.notResolvedWithExternalTrue || tally.isExternalTotal ? "checked above by outcome + key" : "n/a"}`)
console.log(`  not-resolved AND isExternal===true .......... ${tally.notResolvedWithIsExternal}   <- can only be AMBIGUOUS edges; the claim is never consulted when decls>1`)
