// YAML LANE CENSUS — the DENOMINATOR instrument.
//
// WHY IT EXISTS. `script/m14/firing-check.mjs` reports which relationship types FIRE on a stride
// sample, and a sample can never certify ABSENCE. This lane's own history is the argument: the
// instrument's zero for `calls` is a statement about the drawn files, not about the language, and
// the fixture pins a `calls` edge the corpus draw does not contain. So every silent type is
// measured here against the WHOLE corpus, with a SITE COUNT read from the tree independently of
// the analyzer: `sites = 0` means the construct does not occur and the silence is correct;
// `sites > 0` with `edges = 0` means the analyzer is missing it.
//
// WHAT IT REPORTS, per relationship type:
//   edges   how many the production path emitted over the whole corpus
//   files   in how many distinct files it emitted at least one edge of that type
//   sites   independent construct positions (see SITE RULES below)
//   sFls    in how many distinct files those sites occur
//
// SITE RULES, one per type, each the analyzer's own discriminator rather than an approximation:
//   calls        a `uses` key at `jobs.<id>.uses` in a file whose shape matches the analyzer's
//                "GitHub Actions" signature (`jobs` an object AND `on` present). Counted from the
//                TREE, so it does not depend on the analyzer emitting anything.
//   imports      a `uses` key anywhere else (step level), plus `!include`-shaped tag applications
//   contains     a block/flow mapping pair -- the containment unit of a YAML document
//   uses/        a scalar with a `*anchor` alias, and `!include`-free tag applications
//   references
//   extends      a `services.<x>.extends` key (docker-compose's single inheritance form)
//   implements /
//   exports /
//   overrides /
//   instantiates  GRAMMAR-ABSENCE types: counted by scanning the corpus's ENTIRE node-type
//                inventory for any type naming the construct. If no node type in the whole corpus
//                can express it, the type is inapplicable to the LANGUAGE, not merely unseen.
//
// USAGE: bun validation/m14/fixtures/yaml/lane-census.ts [corpusRoot] [maxFiles|0=all] [--pools]
//        default corpusRoot = /home/ishaq2321/bb_tests/repositories/ansible
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { join, relative } from "node:path"
import { getParser } from "../../../../src/ast/engine.ts"
import { RelationshipType } from "../../../../src/ast/types.ts"

const args = process.argv.slice(2)
const POOLED = args.includes("--pools")
const positional = args.filter((a) => !a.startsWith("--"))
const ROOT = positional[0] || "/home/ishaq2321/bb_tests/repositories/ansible"
const MAX = positional[1] ? Number(positional[1]) : 0
const CAP = 1_000_000

const ALL = [...new Set(Object.values(RelationshipType))] as string[]

/** The analyzer's own OpenAPI publication containers (`OPENAPI_COMPONENT_CONTAINERS`). */
const OPENAPI_COMPONENT_CONTAINERS = new Set([
  "schemas", "responses", "parameters", "examples", "requestBodies",
  "headers", "securitySchemes", "links", "callbacks", "pathItems",
])

function walk(dir: string, out: string[] = [], depth = 0): string[] {
  if (depth > 24) return out
  let ents: any[]
  try { ents = readdirSync(dir, { withFileTypes: true }) } catch { return out }
  ents.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  for (const e of ents) {
    const p = join(dir, e.name)
    if (e.isDirectory()) { if (!/node_modules|\.git|third_party|vendor/.test(e.name)) walk(p, out, depth + 1) }
    else if (e.name.endsWith(".yaml") || e.name.endsWith(".yml")) {
      try { if (statSync(p).size <= CAP) out.push(p) } catch {}
    }
  }
  return out
}
const repoOf = (abs: string): string => {
  const rel = relative(ROOT, abs)
  return POOLED ? (rel.split("/").length > 1 ? rel.split("/")[0] : "_root") : "_one"
}

const m: any = await import("../../../../src/ast/real-yaml-analyzer.ts")
const Cls = Object.values(m).find((v: any) => typeof v === "function" && /Analyzer$/.test(v.name)) as any
if (!Cls) throw new Error("no analyzer class exported")

let files = walk(ROOT)
if (MAX > 0) files = files.slice(0, MAX)

const perType: Record<string, { edges: number; files: Set<string>; unres: number; amb: number; extOK: number; extUnv: number; extFail: number }> = {}
for (const t of ALL) perType[t] = { edges: 0, files: new Set(), unres: 0, amb: 0, extOK: 0, extUnv: 0, extFail: 0 }
const NO_SITE_RULE = new Set(["references"])
const sites: Record<string, number> = { calls: 0, imports: 0, contains: 0, uses: 0, references: 0, extends: 0, implements: 0, exports: 0, overrides: 0, instantiates: 0 }
const siteFiles: Record<string, Set<string>> = {}
for (const k of Object.keys(sites)) siteFiles[k] = new Set()

const nodeTypes = new Map<string, number>()
const keyPaths = new Map<string, number>()
const errors: string[] = []
let parsed = 0
// project key space (per repo) for the resolution columns, using the gate's own rule
const declCount = new Map<string, Map<string, number>>()
const kinds = new Map<string, Map<string, Set<string>>>()
const emitted: { repo: string; type: string; target: string; meta: any }[] = []

/**
 * Is this pair's VALUE a mapping? The grammar wraps it: `block_mapping_pair -> flow_node(key) :
 * block_node(value)`, so a mapping-valued key has `value.type === "block_node"` and the mapping is
 * its CHILD. Testing `value.type === "block_mapping"` directly matches nothing at all — measured:
 * it made `jobs` read as a non-object and drove the `calls` site count to 0 for a corpus whose
 * workflow files all have one.
 */
function isMappingValue(val: any): boolean {
  if (!val) return false
  if (val.type === "block_mapping" || val.type === "flow_mapping") return true
  if (val.type === "block_node" || val.type === "flow_node") {
    return (val.namedChildren ?? []).some((c: any) => c.type === "block_mapping" || c.type === "flow_mapping")
  }
  return false
}

/** Every ENCLOSING mapping pair's key, outermost first. Empty for a top-level pair. */
function pairChain(n: any, content: string): string[] {
  const chain: string[] = []
  for (let a = n.parent; a; a = a.parent) {
    const pk = pairKey(a, content)
    if (pk) chain.unshift(pk)
  }
  return chain
}

/** the `key` text of a mapping pair, whichever grammar shape carries it */
function pairKey(n: any, content: string): string | null {
  if (n.type !== "block_mapping_pair" && n.type !== "flow_pair") return null
  const k = n.childForFieldName?.("key")
  return k ? content.slice(k.startIndex, k.endIndex).replace(/^["']|["']$/g, "") : null
}

for (const f of files) {
  let content: string
  try { content = readFileSync(f, "utf8") } catch { continue }
  let pr: any
  try {
    const parser = await getParser("yaml")
    pr = await parser.parse(content, f)
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
      const t = String((r as any).type ?? (r as any).relationshipType)
      if (!perType[t]) continue
      perType[t].edges++
      perType[t].files.add(f)
      emitted.push({ repo, type: t, target: String((r as any).target ?? ""), meta: (r as any).metadata })
    }
  } catch (e) { errors.push(`${relative(ROOT, f)}: ${String(e).slice(0, 70)}`); continue }

  // ── independent SITE census, from the tree
  if (!pr?.rootNode) continue
  const stack: any[] = [pr.rootNode]
  const topKeys = new Set<string>()
  let jobsIsObject = false
  let hasOn = false
  while (stack.length) {
    const n = stack.pop()
    nodeTypes.set(n.type, (nodeTypes.get(n.type) || 0) + 1)
    const key = pairKey(n, content)
    if (key) {
      // TOP-LEVEL means NO enclosing mapping pair. The grammar wraps a document's root mapping
      // in `block_node`/`flow_node`, so a parent-type test against `document`/`stream` finds
      // nothing at all — measured: it reported 0 top-level keys for a 33-file corpus in which
      // every file has them. The enclosing-pair chain is the test that does not depend on how
      // many wrappers the grammar inserts.
      const chainLen = pairChain(n, content).length
      if (chainLen === 0) {
        topKeys.add(key)
        const val = n.childForFieldName?.("value")
        if (key === "jobs" && isMappingValue(val)) jobsIsObject = true
        if (key === "on") hasOn = true
      }
    }
    const kids = n.children ?? []
    for (let i = kids.length - 1; i >= 0; i--) if (kids[i]) stack.push(kids[i])
  }
  const workflowShaped = jobsIsObject && hasOn
  for (const k of topKeys) keyPaths.set(k, (keyPaths.get(k) || 0) + 1)

  // second pass: path-qualified site detection
  const dupSeen = new Map<number, Map<string, number>>()
  const stack2: any[] = [pr.rootNode]
  while (stack2.length) {
    const n = stack2.pop()
    const key = pairKey(n, content)
    if (key) {
      const chain = pairChain(n, content)
      if (key === "uses") {
        // job level: `jobs.<id>.uses`, i.e. a two-segment chain whose head is `jobs`, in a file
        // whose SHAPE matches the analyzer's own "GitHub Actions" signature.
        if (workflowShaped && chain.length === 2 && chain[0] === "jobs") {
          sites.calls++; siteFiles.calls.add(f)
        } else {
          sites.imports++; siteFiles.imports.add(f)
        }
      }

      // OpenAPI's publication containers are what the analyzer publishes as `exports`
      // (`relationshipType: yaml_schema_publication`).
      // EXACTLY the analyzer's `schemaPublicationRole`: the PARENT path is `definitions`/`$defs`
      // and nothing deeper, or `components.<one of the ten container names>`. A looser rule that
      // accepted any key under `components` counted the container keys themselves and overstated
      // the denominator 19 against 5 published.
      // ...AND the document must declare `openapi`/`swagger` at top level: `resolveSchemaExports`
      // emits nothing unless `documentShapes` has one, because "a publication edge on a
      // coincidence is a fabricated edge". Without this the denominator overstated 10 against 5.
      if (topKeys.has("openapi") || topKeys.has("swagger")) {
        if ((chain.length === 1 && (chain[0] === "definitions" || chain[0] === "$defs")) ||
            (chain.length === 2 && chain[0] === "components" && OPENAPI_COMPONENT_CONTAINERS.has(chain[1]))) {
          sites.exports++; siteFiles.exports.add(f)
        }
      }
      // a `!include`-shaped tag application is an import site the `uses` rule does not see
      if (key === "functions" || key === "include") {
        const val = n.childForFieldName?.("value")
        if (val) { sites.imports++; siteFiles.imports.add(f) }
      }
      // DUPLICATE MAPPING KEY inside one mapping is what the analyzer publishes as `overrides`
      // (`relationshipType: yaml_duplicate_key`, last-wins). Counted per enclosing mapping.
      const parentMap = n.parent
      if (parentMap) {
        const seenInMap = dupSeen.get(parentMap.id) ?? new Map<string, number>()
        dupSeen.set(parentMap.id, seenInMap)
        const prev = seenInMap.get(key) ?? 0
        seenInMap.set(key, prev + 1)
        if (prev > 0) { sites.overrides++; siteFiles.overrides.add(f) }
      }
      // containment unit of a document
      sites.contains++; siteFiles.contains.add(f)
    }
    // An ALIAS is the analyzer's one site for BOTH `uses` and `extends`: it emits `uses` for a
    // plain `*anchor` and `extends` for a MERGE alias (`<<: *anchor`), read off `alias.merge`.
    // Counting every alias as `uses` made the merge aliases look like 5 missed `uses` edges when
    // the analyzer had published all 5 as `extends` — a fabricated gap.
    if (n.type === "alias") {
      const isMerge = pairChain(n, content).includes("<<")
      if (isMerge) { sites.extends++; siteFiles.extends.add(f) }
      else { sites.uses++; siteFiles.uses.add(f) }
    }
    const kids = n.children ?? []
    for (let i = kids.length - 1; i >= 0; i--) if (kids[i]) stack2.push(kids[i])
  }
}

// resolution columns, using the incoming gate's own rule
const { classifyEdge, externalClaimOf } = await import("../../../../script/m14/incoming-rule.ts")
for (const e of emitted) {
  const dc = declCount.get(e.repo) ?? new Map()
  const kd = kinds.get(e.repo) ?? new Map()
  const c = classifyEdge(dc as any, kd as any, e.target, externalClaimOf({ metadata: e.meta }))
  const p = perType[e.type]
  if (c.outcome === "unresolved") p.unres++
  else if (c.outcome === "ambDeclOnly" || c.outcome === "ambBoth") p.amb++
  else if (c.outcome === "externalVerified") p.extOK++
  else if (c.outcome === "externalUnverified") p.extUnv++
  else if (c.outcome === "externalRefuted") p.extFail++
}

const pad = (s: any, n: number) => String(s).padEnd(n)
const pl = (s: any, n: number) => String(s).padStart(n)

console.log(`YAML LANE CENSUS`)
console.log(`corpus: ${ROOT}   scope: ${POOLED ? "PER REPO" : "single project"}   maxFiles: ${MAX || "0 (all)"}`)
const nYml = files.filter((f) => f.endsWith(".yml")).length
const nYaml = files.length - nYml
console.log(`extensions admitted: BOTH .yml and .yaml (same set as firing-check.mjs; ` +
  `incoming-gate.ts admits .yaml ONLY and will disagree on a .yml-dominated corpus)`)
console.log(`admitted (<= ${CAP} B): ${files.length}  = ${nYml} .yml + ${nYaml} .yaml` +
  `   parsed: ${parsed}   failures: ${errors.length}`)
console.log(`\nFIRING — production path (getParser -> parse -> analyze, NO projectRoot, matching firing-check)`)
console.log(`${pad("type", 14)}${pl("edges", 8)}${pl("files", 7)}${pl("sites", 8)}${pl("sFls", 7)}   ${pad("amb", 6)}${pl("unres", 7)}${pl("extOK", 6)}${pl("ext?", 6)}${pl("extFAIL", 8)}`)
let tot = 0
for (const t of ALL) {
  const p = perType[t]
  tot += p.edges
  const siteCell = NO_SITE_RULE.has(t) ? "n/a" : String(sites[t] ?? 0)
  const siteFlCell = NO_SITE_RULE.has(t) ? "n/a" : String(siteFiles[t]?.size ?? 0)
  console.log(`${pad(t, 14)}${pl(p.edges, 8)}${pl(p.files.size, 7)}${pl(siteCell, 8)}${pl(siteFlCell, 7)}   ${pad(p.amb, 6)}${pl(p.unres, 7)}${pl(p.extOK, 6)}${pl(p.extUnv, 6)}${pl(p.extFail, 8)}`)
  if (NO_SITE_RULE.has(t)) { /* no site rule: see NO_SITE_RULE */ }
  else if (p.edges === 0 && (sites[t] ?? 0) > 0) console.log(`   ^ SILENT WITH SITES: ${sites[t]} position(s) in ${siteFiles[t].size} file(s), 0 edges`)
  else if (p.edges === 0 && (sites[t] ?? 0) === 0) console.log(`   ^ NO CONSTRUCT IN THIS CORPUS: 0 site(s) in ${files.length} file(s)`)
}
console.log(`${pad("TOTAL", 14)}${pl(tot, 8)}`)

// ── the GRAMMAR-ABSENCE proof: no node type in the whole corpus names the construct
console.log(`\nGRAMMAR-ABSENCE CHECK — distinct node types seen: ${nodeTypes.size}`)
for (const probe of ["implement", "export", "override", "instantiat", "new_", "inherit", "extends"]) {
  const hits = [...nodeTypes].filter(([t]) => t.includes(probe))
  console.log(`  node types containing '${probe}': ${hits.length ? hits.map(([t, n]) => `${t}:${n}`).join("  ") : "NONE"}`)
}
console.log(`\ntop-level keys seen (first 25 by frequency):`)
for (const [k, v] of [...keyPaths].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`  ${pad(k, 26)}${pl(v, 7)}`)

if (errors.length) { console.log(`\nfirst failures:`); for (const e of errors.slice(0, 8)) console.log("  " + e) }
const OUT = process.env.CENSUS_OUT
if (OUT) {
  writeFileSync(OUT, JSON.stringify({
    corpus: ROOT, pooled: POOLED, admitted: files.length, parsed,
    perType: Object.fromEntries(ALL.map((t) => [t, {
      edges: perType[t].edges, files: perType[t].files.size,
      sites: sites[t] ?? 0, siteFiles: siteFiles[t]?.size ?? 0,
      amb: perType[t].amb, unres: perType[t].unres,
      extOK: perType[t].extOK, extUnv: perType[t].extUnv, extFail: perType[t].extFail,
    }])),
    nodeTypes: Object.fromEntries([...nodeTypes].sort((a, b) => b[1] - a[1])),
    topLevelKeys: Object.fromEntries([...keyPaths].sort((a, b) => b[1] - a[1])),
  }, null, 2))
  console.log(`\nwrote ${OUT}`)
}
