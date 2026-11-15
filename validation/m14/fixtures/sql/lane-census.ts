// SQL LANE CENSUS — the DENOMINATOR instrument for script/m14/firing-check.mjs.
//
// WHY IT EXISTS. `firing-check.mjs` samples the first N files in directory-walk order.
// For the SQL lane on the duckdb corpus that order resolves to `benchmark/aoc24/queries`,
// `benchmark/clickbench/queries`, `benchmark/imdb_plan_cost/queries` … — read-only
// analytics SELECTs. Measured: only 5 of the first 120 sampled files contain ANY
// `CREATE/ALTER/DROP` at all, so a type whose construct is DDL (contains, references,
// overrides, instantiates) cannot fire in that sample no matter how correct the analyzer is.
// The instrument is not wrong; its SAMPLE is not representative, and this file is the
// unsampled measurement beside it.
//
// WHAT IT REPORTS, per relationship type:
//   edges     how many the production path emitted over the WHOLE corpus
//   files     in how many distinct files it emitted >= 1 edge of that type
//   sites     how many AST positions in the whole corpus could have produced it, counted
//             from the parse tree independently of the analyzer. This is the denominator
//             a "ruled inapplicable" claim needs: sites = 0 means the construct does not
//             occur; sites > 0 with edges = 0 means the analyzer is missing it.
//   unres/amb how many of the emitted edges name nothing / more than one declaration in
//             the file's OWN PROJECT (production's scope), counted with the SAME rule the
//             incoming gate uses (script/m14/incoming-rule.ts), so the two agree.
//
// USAGE  bun validation/m14/fixtures/sql/lane-census.ts [corpusDir] [maxFiles|0=all] [--pools]
//        default corpusDir = /home/ishaq2321/bb_tests/repositories/duckdb
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { join, relative, dirname } from "node:path"
import { getParser } from "../../../../src/ast/engine.ts"
import { RelationshipType } from "../../../../src/ast/types.ts"
import { classifyEdge, externalClaimOf } from "../../../../script/m14/incoming-rule.ts"

const args = process.argv.slice(2)
const POOLED = args.includes("--pools")
const positional = args.filter((a) => !a.startsWith("--"))
const ROOT = positional[0] || "/home/ishaq2321/bb_tests/repositories/duckdb"
const MAX = positional[1] ? Number(positional[1]) : 0
const EXT = ".sql"
/** The engine's own `FULL_AST_LIMIT`. It was 1,000,000 (a decimal MB) while the engine's limit is
 *  1 MB = 1,048,576, so the census's population and the analyzer's were two different sets —
 *  they happen to coincide on THIS corpus (all six over-cap files are >1.7 MB), which is exactly
 *  why a cap that is only accidentally right is worth aligning rather than leaving. */
const CAP = 1_048_576

const ALL = [...new Set(Object.values(RelationshipType))] as string[]

/** deterministic walk, sorted, so two runs of this census are the same corpus */
function walk(dir: string, out: string[] = [], depth = 0, followed: { dirs: number } = { dirs: 0 }): string[] {
  if (depth > 24) return out
  let ents: any[]
  try { ents = readdirSync(dir, { withFileTypes: true }) } catch { return out }
  ents.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  for (const e of ents) {
    const p = join(dir, e.name)
    // A SYMLINKED REPOSITORY IS STILL A REPOSITORY, and this walk used to drop every one of them
    // WITHOUT SAYING SO. `readdirSync(..., {withFileTypes:true})` reports a symlink with
    // `isDirectory() === false`, so `repositories/proxicall -> /home/ishaq2321/ProxiCall` — 439
    // `.sql` files, 22.3% of this lane's 1,965-file population and ~48% of its edges — was skipped
    // silently, and every "pooled, whole corpus" figure this instrument has produced (including
    // `lane-census-pooled.json`, 1,526 files) was short by one entire repository. The corpus root
    // holds exactly one such symlink. Measured 2026-10-11: walk 1,526 -> 1,965 files.
    // The corrective is the same one this programme applies to every misreporting instrument:
    // either FOLLOW it or SAY that you did not — and the count is printed below either way.
    let isDir = e.isDirectory()
    if (!isDir && e.isSymbolicLink()) {
      try { isDir = statSync(p).isDirectory(); if (isDir) followed.dirs++ } catch { /* dangling link */ }
    }
    if (isDir) { if (!/node_modules|\.git|third_party/.test(e.name)) walk(p, out, depth + 1, followed) }
    else if (e.name.endsWith(EXT)) { try { if (statSync(p).size <= CAP) out.push(p) } catch {} }
  }
  return out
}

/** the repository a file belongs to = production's resolution scope */
function repoOf(abs: string): string {
  const rel = relative(ROOT, abs)
  const seg = rel.split("/")
  // Pooled root: <repo>/... . Single-repo root (duckdb): the whole thing is one project.
  if (POOLED) return seg.length > 1 ? seg[0] : "_root"
  return "_duckdb"
}

const m: any = await import("../../../../src/ast/real-sql-analyzer.ts")
const Cls = Object.values(m).find((v: any) => typeof v === "function" && /Analyzer$/.test(v.name)) as any
if (!Cls) throw new Error("no analyzer class exported")

const followed = { dirs: 0 }
let files = walk(ROOT, [], 0, followed)
if (MAX > 0 && files.length > MAX) files = files.slice(0, MAX)

// ── the site census: AST positions that could produce each relationship type, counted from
// the TREE, not from the analyzer. One walk per file, all node types tallied.
const SITE_NODES: Record<string, string[]> = {
  contains: ["create_schema", "create_table", "create_view", "create_materialized_view",
             "create_index", "create_function", "create_procedure", "create_type", "create_trigger"],
  references: ["keyword_references", "constraint", "column_definition"],
  imports: ["psql_meta_command", "create_extension"],
  overrides: ["create_function", "create_procedure", "create_view", "create_materialized_view"],
  instantiates: ["cast"],
  extends: ["keyword_inherits", "keyword_inherit"],
  implements: ["keyword_implements"],
  exports: ["keyword_export"],
  calls: ["invocation"],
  uses: ["from", "relation", "insert", "update", "delete"],
}
const siteTally: Record<string, number> = {}
const siteFiles: Record<string, Set<string>> = {}
for (const k of Object.keys(SITE_NODES)) { siteTally[k] = 0; siteFiles[k] = new Set() }
const nodeTypeTally = new Map<string, number>()

// ── PRECISE sites. The coarse counters above answer "is there a construct position at all";
// these answer "is there a position that MATCHES THE DISCRIMINATOR THE ANALYZER USES", which
// is the only denominator that can tell a real miss from a construct that never occurs.
// Each one is the exact rule read off real-sql-analyzer.ts, counted from the tree:
//   referencesFK      object_reference whose PREVIOUS SIBLING is keyword_references (SQL-D1's
//                     discriminator — the position, not a guess about the name)
//   importsPsql       psql_meta_command whose text starts with \i or \ir and names a literal
//   importsExtension  create_extension nodes (the second, separately labelled mechanism)
//   overridesPair     a same-kind same-name re-declaration in ONE file where the later one
//                     carries OR REPLACE — the only shape SQL-D12 calls a replacement
//   instantiatesCtor  a `cast` node carrying a `custom_type` FIELD (a user type, per SQL-D13)
//   extendsClause     keyword_inherits / keyword_inherit anywhere (SQL-D14: the grammar has none)
const precise: Record<string, number> = {
  referencesFK: 0, importsPsql: 0, importsExtension: 0,
  overridesPair: 0, overridesOrReplaceDecls: 0, instantiatesCtor: 0, extendsClause: 0,
  containsMembers: 0, callsInvocation: 0,
}
const preciseFiles: Record<string, Set<string>> = {}
for (const k of Object.keys(precise)) preciseFiles[k] = new Set()
/** per file, the declaration key -> the OR REPLACE flag, for the overridesPair probe */
const orReplaceSeen = new Map<string, boolean>()

// ── what a file contains at the TEXT level, to size the DDL/DML split that produced the
// unrepresentative sample. Text, not tree, on purpose: this is a property of the corpus.
const TEXT_PROBES: Record<string, RegExp> = {
  ddlAny: /\b(create|alter|drop)\s+(or\s+replace\s+)?(table|schema|view|materialized|index|function|procedure|trigger|type|sequence|role|extension|database|policy|domain)\b/i,
  psqlInclude: /^\s*\\i(r)?\s/m,
  createExtension: /\bcreate\s+extension\b/i,
  orReplace: /\bcreate\s+or\s+replace\b/i,
  foreignKey: /\bforeign\s+key\b|\breferences\s+[a-z_"`]/i,
  inherits: /\binherits?\s*\(/i,
}
const textCounts: Record<string, number> = {}
for (const k of Object.keys(TEXT_PROBES)) textCounts[k] = 0

// ── THE EXTERNAL-VISIBILITY SPLIT of the not-resolved set.
//
// The analyzer classifies a target it can prove is outside the project
// (`classifyExternalTarget`) and writes the KIND into `metadata.external` as a
// STRING. `script/m14/incoming-rule.ts` accepts an external claim only when
// `md[key] === true`, so a string-valued `external` is INERT: the edge is
// reported as plain `unresolved` even though the analyzer said what it was.
// This counts that from the other side — how many not-resolved edges carry a
// classification the arbiter cannot see, and whether the claim would SURVIVE
// verification if the value were boolean (the target's owner is not a published
// declaration, so the claim could not be refuted).
const unresolvedExternal = {
  total: 0, stringValued: 0, booleanTrue: 0, unmarked: 0,
  wouldBeVerified: 0, wouldBeUnverified: 0, wouldBeRefuted: 0,
  byKind: new Map<string, number>(),
  names: new Map<string, number>(),
}

// ── edge outcomes, counted with the gate's own rule
const perType: Record<string, { edges: number; files: Set<string>; unres: number; amb: number; extOK: number; extUnv: number; extFail: number }> = {}
for (const t of ALL) perType[t] = { edges: 0, files: new Set(), unres: 0, amb: 0, extOK: 0, extUnv: 0, extFail: 0 }
const parseErrors: string[] = []
let parsed = 0
// project key space: file -> target -> declarations (built from the SAME population, two passes)
const declCountByRepo = new Map<string, Map<string, number>>()
const kindsByRepo = new Map<string, Map<string, Set<string>>>()
const emitted: { file: string; repo: string; type: string; target: string; meta: any }[] = []
const perFileTypes = new Map<string, Set<string>>()

for (const f of files) {
  let content: string
  try { content = readFileSync(f, "utf8") } catch { continue }
  for (const [k, re] of Object.entries(TEXT_PROBES)) if (re.test(content)) textCounts[k]++
  let pr: any
  try {
    const parser = await getParser("sql")
    pr = await parser.parse(content, f)
    const res = new Cls().analyze(pr.rootNode, content, f)
    parsed++
    const repo = repoOf(f)
    const dc = declCountByRepo.get(repo) ?? new Map<string, number>()
    const kd = kindsByRepo.get(repo) ?? new Map<string, Set<string>>()
    declCountByRepo.set(repo, dc); kindsByRepo.set(repo, kd)
    for (const s of res.symbols || []) {
      if (!s?.name) continue
      dc.set(s.name, (dc.get(s.name) || 0) + 1)
      const set = kd.get(s.name) ?? new Set<string>(); set.add(String(s.kind)); kd.set(s.name, set)
      if (s.qualifiedName) {
        const q = dc.get(s.qualifiedName) || 0
        dc.set(s.qualifiedName, q + 1)
        const qs = kd.get(s.qualifiedName) ?? new Set<string>(); qs.add(String(s.kind)); kd.set(s.qualifiedName, qs)
      }
    }
    const seen = new Set<string>()
    for (const r of res.relationships || []) {
      const t = String((r as any).relationshipType ?? (r as any).type)
      if (!perType[t]) continue
      perType[t].edges++
      perType[t].files.add(f)
      seen.add(t)
      emitted.push({ file: f, repo, type: t, target: String((r as any).target ?? ""), meta: (r as any).metadata })
    }
    perFileTypes.set(f, seen)
    // tree walk for sites
    if (pr?.rootNode) {
      const stack: any[] = [pr.rootNode]
      const fileSites: Record<string, number> = {}
      const fp: Record<string, boolean> = {}
      const orReplace = new Map<string, boolean>()
      while (stack.length) {
        const n = stack.pop()
        nodeTypeTally.set(n.type, (nodeTypeTally.get(n.type) || 0) + 1)
        for (const [k, types] of Object.entries(SITE_NODES)) {
          if (types.includes(n.type)) { fileSites[k] = (fileSites[k] || 0) + 1 }
        }
        // ── precise probes
        if (n.type === "invocation") { precise.callsInvocation++; fp.callsInvocation = true }
        if (n.type === "keyword_inherits" || n.type === "keyword_inherit") {
          precise.extendsClause++; fp.extendsClause = true
        }
        if (n.type === "create_extension") { precise.importsExtension++; fp.importsExtension = true }
        if (n.type === "psql_meta_command") {
          // the analyzer's own test: the command word is the first token, the target a literal
          // with a .sql/.psql/.dump-ish suffix. Count what the analyzer can read.
          const txt = content.slice(n.startIndex, n.endIndex)
          if (/^\s*\\i(r)?\s+\S/.test(txt)) { precise.importsPsql++; fp.importsPsql = true }
        }
        if (n.type === "object_reference") {
          const sibs = n.parent?.children ?? []
          const i = sibs.findIndex((c: any) => c && c.id === n.id && c.startIndex === n.startIndex)
          if (i > 0 && sibs[i - 1]?.type === "keyword_references" && !sibs[i - 1]?.isMissing) {
            precise.referencesFK++; fp.referencesFK = true
          }
        }
        if (n.type === "cast") {
          // a user-typed target is a FIELD named custom_type — a builtin target is anonymous
          const hasCustom = (n.childForFieldName?.("custom_type") ?? null) !== null
          if (hasCustom) { precise.instantiatesCtor++; fp.instantiatesCtor = true }
        }
        if (n.type.startsWith("create_")) {
          const nameNode = n.childForFieldName?.("name") ?? n.childForFieldName?.("object")
          const nm = nameNode ? content.slice(nameNode.startIndex, nameNode.endIndex) : ""
          const txt = content.slice(n.startIndex, Math.min(n.endIndex, n.startIndex + 260))
          const isOrReplace = /\bcreate\s+or\s+replace\b/i.test(txt)
          if (isOrReplace) { precise.overridesOrReplaceDecls++; fp.overridesOrReplaceDecls = true }
          const key = `${n.type}\u0000${nm}`
          if (nm) {
            if (orReplace.get(key)) { precise.overridesPair++; fp.overridesPair = true }
            if (isOrReplace) orReplace.set(key, true)
          }
        }
        if (n.type === "column_definition" || n.type === "field" || n.type === "create_index") {
          precise.containsMembers++
        }
        const kids = n.children ?? []
        for (let i = kids.length - 1; i >= 0; i--) if (kids[i]) stack.push(kids[i])
      }
      for (const [k, c] of Object.entries(fileSites)) { siteTally[k] += c; siteFiles[k].add(f) }
      for (const k of Object.keys(fp)) preciseFiles[k].add(f)
    }
  } catch (e) { parseErrors.push(`${f}: ${String(e).slice(0, 80)}`) }
}

// second pass: classify every emitted edge against its own project's key space
for (const e of emitted) {
  const dc = declCountByRepo.get(e.repo) ?? new Map()
  const kd = kindsByRepo.get(e.repo) ?? new Map()
  const c = classifyEdge(dc as any, kd as any, e.target, externalClaimOf({ metadata: e.meta }))
  const p = perType[e.type]
  if (c.outcome === "unresolved") p.unres++
  else if (c.outcome === "ambDeclOnly" || c.outcome === "ambBoth") p.amb++
  else if (c.outcome === "externalVerified") p.extOK++
  else if (c.outcome === "externalUnverified") p.extUnv++
  else if (c.outcome === "externalRefuted") p.extFail++
  // ── the external-visibility split (see `unresolvedExternal`)
  if (c.outcome === "unresolved" || c.outcome === "ambDeclOnly" || c.outcome === "ambBoth") {
    const v = (e.meta as any)?.external
    if (v !== undefined) {
      unresolvedExternal.total++
      const k = typeof v === "string" ? v : `<${typeof v}>`
      unresolvedExternal.byKind.set(k, (unresolvedExternal.byKind.get(k) || 0) + 1)
      if (v === true) unresolvedExternal.booleanTrue++
      else {
        unresolvedExternal.stringValued++
        unresolvedExternal.names.set(`${k}  ${e.target}`, (unresolvedExternal.names.get(`${k}  ${e.target}`) || 0) + 1)
        // would the claim survive the owner lookup?
        const owner = e.target.lastIndexOf(".") > 0 ? e.target.slice(0, e.target.lastIndexOf(".")) : null
        if (owner === null) unresolvedExternal.wouldBeUnverified++
        else if ((dc.get(owner) ?? 0) > 0) unresolvedExternal.wouldBeRefuted++
        else unresolvedExternal.wouldBeVerified++
      }
    } else {
      unresolvedExternal.unmarked++
    }
  }
}

const pad = (s: any, n: number) => String(s).padEnd(n)
const padl = (s: any, n: number) => String(s).padStart(n)

console.log(`SQL LANE CENSUS`)
console.log(`corpus: ${ROOT}   scope: ${POOLED ? "PER REPO (pooled roots)" : "single project"}`)
console.log(`admitted .sql (<= ${CAP} B): ${files.length}   parsed: ${parsed}   parse/analyze failures: ${parseErrors.length}`)
console.log(`walk: ${followed.dirs} SYMLINKED director${followed.dirs === 1 ? "y" : "ies"} FOLLOWED (a symlinked repo is a repo; this walk used to drop them silently)`)
console.log(`\nTEXT-LEVEL CORPUS COMPOSITION (files containing at least one)` )
for (const [k, v] of Object.entries(textCounts)) console.log(`  ${pad(k, 18)} ${padl(v, 6)}  (${(100 * v / files.length).toFixed(1)}%)`)
console.log(`\nFIRING — production path (getParser -> parse -> analyze) over the WHOLE corpus`)
console.log(`${pad("type", 14)}${padl("edges", 7)}${padl("files", 7)}${padl("sites", 8)}${padl("sFls", 6)}  ${pad("resolved", 9)}${padl("amb", 6)}${padl("unres", 7)}${padl("extOK", 7)}${padl("ext?", 6)}${padl("extFAIL", 8)}`)
let totE = 0
for (const t of ALL) {
  const p = perType[t]
  totE += p.edges
  const resolved = p.edges - p.unres - p.amb - p.extOK - p.extUnv - p.extFail
  console.log(`${pad(t, 14)}${padl(p.edges, 7)}${padl(p.files.size, 7)}${padl(siteTally[t] ?? 0, 8)}${padl(siteFiles[t]?.size ?? 0, 6)}  ${padl(resolved, 9)}${padl(p.amb, 6)}${padl(p.unres, 7)}${padl(p.extOK, 7)}${padl(p.extUnv, 6)}${padl(p.extFail, 8)}`)
  if (p.edges === 0 && (siteTally[t] ?? 0) > 0) {
    console.log(`   ^ SILENT WITH SITES: ${siteTally[t]} construct position(s) in ${siteFiles[t]?.size} file(s), 0 edges`)
  }
  if (p.edges === 0 && (siteTally[t] ?? 0) === 0) {
    console.log(`   ^ INAPPLICABLE IN THIS CORPUS: 0 construct positions in ${files.length} file(s)`)
  }
}
console.log(`${pad("TOTAL", 14)}${padl(totE, 7)}`)

// ── PRECISE SITES: the denominator each "0 edges" claim has to answer with.
console.log(`\nPRECISE CONSTRUCT SITES (the analyzer's own discriminator, counted from the tree)`)
for (const [k, v] of Object.entries(precise)) {
  console.log(`  ${pad(k, 22)} ${padl(v, 7)} site(s) in ${padl(preciseFiles[k].size, 5)} file(s)`)
}
// ── per-construct breakdown of the types that DID fire, so "1070 edges" is auditable
const byMemberKind = new Map<string, number>()
const byRefRole = new Map<string, number>()
for (const e of emitted) {
  if (e.type === "contains") {
    const k = String((e.meta as any)?.memberKind ?? "(none)")
    byMemberKind.set(k, (byMemberKind.get(k) || 0) + 1)
  }
  if (e.type === "references") {
    const md = (e.meta as any) ?? {}
    const k = ["constraint", "triggerTarget", "indexOn", "dependency", "documented", "operation", "column"]
      .filter((x) => md[x] !== undefined).join("+") || "(none)"
    byRefRole.set(k, (byRefRole.get(k) || 0) + 1)
  }
}
if (byMemberKind.size) {
  console.log(`\ncontains edges by metadata.memberKind (the member the edge names):`)
  for (const [k, v] of [...byMemberKind].sort((a, b) => b[1] - a[1])) console.log(`  ${pad(k, 20)} ${padl(v, 7)}`)
}
if (byRefRole.size) {
  console.log(`\nreferences edges by the metadata marker set that produced them:`)
  for (const [k, v] of [...byRefRole].sort((a, b) => b[1] - a[1])) console.log(`  ${pad(k, 34)} ${padl(v, 7)}`)
}

// ── THE EXTERNAL-VS-IN-CORPUS SPLIT the incoming-gate contract asks for.
console.log(`\nEXTERNAL-VISIBILITY SPLIT of the not-resolved (ambiguous + unresolved) edges`)
console.log(`  not-resolved edges carrying metadata.external            ${padl(unresolvedExternal.total, 6)}`)
console.log(`    ...valued \`true\` (the arbiter CAN read the claim)     ${padl(unresolvedExternal.booleanTrue, 6)}`)
console.log(`    ...valued as a KIND STRING (the arbiter CANNOT)          ${padl(unresolvedExternal.stringValued, 6)}`)
console.log(`  not-resolved edges naming nothing published, unmarked     ${padl(unresolvedExternal.unmarked, 6)}   <- the real gap after the split`)
if (unresolvedExternal.stringValued) {
  console.log(`  if the string were boolean, the claim would verify as:`)
  console.log(`    externalVerified / externalUnverified / externalRefuted = ${unresolvedExternal.wouldBeVerified} / ${unresolvedExternal.wouldBeUnverified} / ${unresolvedExternal.wouldBeRefuted}`)
  console.log(`  by classified kind:`)
  for (const [k, v] of [...unresolvedExternal.byKind].sort((a, b) => b[1] - a[1])) console.log(`    ${pad(k, 22)} ${padl(v, 6)}`)
  console.log(`  the classified targets, so the classification itself can be audited:`)
  for (const [k, v] of [...unresolvedExternal.names].sort((a, b) => b[1] - a[1])) console.log(`    ${padl(v, 4)}  ${k}`)
}

// distinct grammar node types seen — the vocabulary, for a "cannot be expressed" ruling
console.log(`\ndistinct grammar node types seen: ${nodeTypeTally.size}`)
const interesting = ["keyword_inherits", "keyword_inherit", "keyword_implements", "keyword_export",
  "create_extension", "psql_meta_command", "keyword_like", "cast", "create_type", "create_domain"]
console.log("signature nodes: " + interesting.map((n) => `${n}=${nodeTypeTally.get(n) ?? 0}`).join("  "))

if (parseErrors.length) {
  console.log(`\nfirst failures:`)
  for (const e of parseErrors.slice(0, 10)) console.log("  " + e)
}
const OUT = process.env.CENSUS_OUT
if (OUT) {
  writeFileSync(OUT, JSON.stringify({
    corpus: ROOT, pooled: POOLED, admitted: files.length, parsed,
    // THE POPULATION'S OWN TERMS, in the artifact and not only on stdout: a symlinked
    // directory that was FOLLOWED is the difference between 1,526 and 1,965 files here.
    symlinkedDirsFollowed: followed.dirs, sizeCap: CAP,
    composition: textCounts,
    perType: Object.fromEntries(ALL.map((t) => [t, {
      edges: perType[t].edges, files: perType[t].files.size,
      sites: siteTally[t] ?? 0, siteFiles: siteFiles[t]?.size ?? 0,
      amb: perType[t].amb, unres: perType[t].unres,
      extOK: perType[t].extOK, extUnv: perType[t].extUnv, extFail: perType[t].extFail,
    }])),
    nodeTypes: Object.fromEntries([...nodeTypeTally].sort((a, b) => b[1] - a[1])),
    sampleFiles: files.slice(0, 40).map((f) => relative(ROOT, f)),
  }, null, 2))
  console.log(`\nwrote ${OUT}`)
}
