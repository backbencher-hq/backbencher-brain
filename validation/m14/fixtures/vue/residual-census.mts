/**
 * VUE — CLAUSE 2's BUCKETS, measured over the INCOMING GATE'S OWN population.
 *
 * WHY THIS FILE EXISTS. `incoming-gate.ts vue vue 400` prints per-TYPE counts and a
 * 25-name worklist. Clause 2 asks for the unresolved total bucketed by a NAMED CONSTRUCT
 * with a count, and a per-type count is not a construct. So this census re-walks the same
 * 400-file stride population with the same `parseFile` call, builds the same per-project
 * key space (name + qualifiedName alias), classifies every edge with the SAME exported
 * rule (`classifyEdge`, script/m14/incoming-rule.ts) and then buckets.
 *
 * IT IS A CENSUS, NOT A SECOND ARBITER: it must REPRODUCE the gate's TABLE 1 exactly
 * (edges / resolved / amb(decl) / unresolved per type) or its buckets describe something
 * else. Section 0 checks that and says so when it fails.
 *
 * WHAT A BUCKET NAMES: the CONSTRUCT that produced the edge (a bare callee identifier, a
 * receiver call, a relative-module specifier, a package specifier, a component tag whose
 * name nothing declares, …), never "unresolved" restated.
 *
 * THE CAP IS RECORDED, NOT HIDDEN: the population is a STRIDE, so a component declared in
 * one of the 755 un-sampled .vue files of the same repository reads unresolved here. The
 * own-file probe (section 3) separates that from a name the analyzer itself holds.
 *
 * CLI: bun run validation/m14/fixtures/vue/residual-census.mts [--max 400] [--json out.json]
 * Writes nothing unless --json is given.
 */
import { execFileSync } from "node:child_process"
import { readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "path"
import { parseFile } from "../../../../src/ast/pool-worker"
import { classifyEdge, externalClaimOf, isContainsEdge } from "../../../../script/m14/incoming-rule"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SIZE_CAP = 1024 * 1024
const argOf = (flag: string, dflt: string): string => {
  const i = process.argv.indexOf(flag)
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : dflt
}
const MAX = Number(argOf("--max", "400"))
const JSON_OUT = argOf("--json", "")

type Type = "calls" | "uses" | "contains" | "imports" | "references" | "instantiates" | "exports" | "extends" | "implements" | "overrides"
const LABEL_ALIASES: Record<string, Type> = {
  calls: "calls", call: "calls", calls_function: "calls",
  uses: "uses", uses_type: "uses", uses_field: "uses",
  contains: "contains", contains_member: "contains", owns: "contains",
  imports: "imports", brain_import: "imports",
  references: "references", depends_on: "references", related: "references",
  exports: "exports", provides: "exports",
  extends: "extends", inheritance: "extends",
  implements: "implements", implementation: "implements",
  overrides: "overrides", override: "overrides",
  instantiates: "instantiates",
}
const ontologyName = (raw: string): Type | null => LABEL_ALIASES[raw] ?? null
const ALL_TYPES: Type[] = ["calls", "uses", "contains", "imports", "references", "instantiates", "exports", "extends", "implements", "overrides"]

// ---------------------------------------------------------------- population
const repoOf = (f: string): string => path.join(CR, path.relative(CR, f).split(path.sep)[0])

const found: string[] = []
const repoSet = new Set<string>()
for (const name of readdirSync(CR).sort()) {
  const dir = path.join(CR, name)
  try { if (!statSync(dir).isDirectory()) continue } catch { continue }
  try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    if (!rel.toLowerCase().endsWith(".vue")) continue
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > SIZE_CAP) continue } catch { continue }
    found.push(abs)
    repoSet.add(name)
  }
}
found.sort()
const total = found.length
let files = found
if (MAX > 0 && total > MAX) {
  const stride = Math.max(1, Math.floor(total / MAX))
  const picked: string[] = []
  for (let i = 0; i < found.length && picked.length < MAX; i += stride) picked.push(found[i])
  files = picked
}

// ---------------------------------------------------------------- walk
type Pending = {
  label: Type; tgt: string; claim: ReturnType<typeof externalClaimOf>; sig: string
  repo: string; file: string; line: number | null; md: Record<string, unknown>
}
const projectDecl = new Map<string, Map<string, number>>()
const projectKinds = new Map<string, Map<string, Set<string>>>()
/** file -> declared names (for the own-file probe) */
const fileDecl = new Map<string, Map<string, number>>()
const pending: Pending[] = []
let parsed = 0, failed = 0, degraded = 0, emptyResults = 0
const edgeCount = new Map<Type, number>()
for (const t of ALL_TYPES) edgeCount.set(t, 0)

/** file -> symbol name -> the qualifiedNames this file publishes for it (pool-worker's own
 *  normalisation, so the probe asks about the key the gate actually indexes). */
const fileQual = new Map<string, Map<string, string[]>>()

for (const f of files) {
  let r: any
  try { r = await parseFile(f, repoOf(f), { projectRoot: repoOf(f) } as any) } catch { failed++; continue }
  if (!r) { failed++; continue }
  parsed++
  if (r.fallback === true || r.metadata?.analysisVersion === "2.0-basic-fallback") degraded++
  if ((r.symbols?.length ?? 0) === 0 && (r.relationships?.length ?? 0) === 0) emptyResults++
  const repo = repoOf(f)
  let pDecl = projectDecl.get(repo); if (!pDecl) projectDecl.set(repo, (pDecl = new Map()))
  let pKinds = projectKinds.get(repo); if (!pKinds) projectKinds.set(repo, (pKinds = new Map()))
  let fDecl = fileDecl.get(f); if (!fDecl) fileDecl.set(f, (fDecl = new Map()))
  let fQual = fileQual.get(f); if (!fQual) fileQual.set(f, (fQual = new Map()))
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1)
  for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
    const name = String(s?.name ?? "")
    if (!name) continue
    const kind = String(s?.kind ?? "")
    bump(pDecl, name)
    let ks = pKinds.get(name); if (!ks) pKinds.set(name, (ks = new Set())); ks.add(kind)
    bump(fDecl, name)
    // THE SAME NORMALISATION pool-worker applies (`:1312`) — the key the gate indexes.
    const q = String((s as any)?.qualifiedName || (s as any)?.metadata?.fqn || ((s as any)?.scope ? `${(s as any).scope}.${name}` : name))
    if (q && q !== name) {
      bump(pDecl, q)
      let qs = pKinds.get(q); if (!qs) pKinds.set(q, (qs = new Set())); qs.add(kind)
    }
    const list = fQual.get(name) ?? []
    if (!list.includes(q)) list.push(q)
    fQual.set(name, list)
  }
  for (const rel of Array.isArray(r.relationships) ? r.relationships : []) {
    const label = ontologyName(String(rel?.type ?? rel?.relationshipType ?? ""))
    if (!label) continue
    const tgt = String(rel?.target ?? rel?.to ?? rel?.toSymbol ?? "")
    if (!tgt) continue
    edgeCount.set(label, (edgeCount.get(label) ?? 0) + 1)
    const md = (rel as any)?.metadata ?? {}
    const sig = Object.keys(md).filter((k) => k !== "evidenceClass" && k !== "analysisVersion" && md[k] !== false && md[k] != null).sort().join("+") || "(no marker)"
    const line = Number((rel as any)?.line_number ?? (rel as any)?.lineNumber ?? (rel as any)?.line ?? 0) || null
    pending.push({ label, tgt, claim: externalClaimOf(rel), sig, repo, file: f, line, md })
  }
}

const outcomes: Record<string, number> = {}
/** repo -> lowercased key -> the keys it spells (for the variant probe, built once) */
const projectLower = new Map<string, Map<string, string[]>>()
for (const [repo, decl] of projectDecl) {
  const low = new Map<string, string[]>()
  for (const key of decl.keys()) {
    const l = key.toLowerCase()
    const list = low.get(l)
    if (list) list.push(key)
    else low.set(l, [key])
  }
  projectLower.set(repo, low)
}
const byType = new Map<Type, Record<string, number>>()
for (const e of pending) {
  const c = classifyEdge(projectDecl.get(e.repo)!, projectKinds.get(e.repo)!, e.tgt, e.claim, undefined, isContainsEdge(e.label), fileDecl.get(e.file)?.has(e.tgt) ?? false)
  outcomes[c.outcome] = (outcomes[c.outcome] ?? 0) + 1
  let row = byType.get(e.label); if (!row) byType.set(e.label, (row = {}))
  row[c.outcome] = (row[c.outcome] ?? 0) + 1
  ;(e as any).outcome = c.outcome
}

// ---------------------------------------------------------------- buckets
const rel = (f: string): string => path.relative(CR, f)

/** F31's own question, asked of an unresolved target: does the EDGE'S OWN FILE declare this
 *  name under a spelling the graph does not key on — kebab↔Pascal, or a case fold? This is
 *  the probe for "the analyzer already holds what the target needs". */
const kebabToPascal = (s: string): string => s.replace(/(^|-)([a-z0-9])/g, (_, __, c) => String(c).toUpperCase())
const pascalToKebab = (s: string): string => s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/([A-Z])([A-Z][a-z])/g, "$1-$2").toLowerCase()
const ownFileVariant = (e: Pending): string | null => {
  const decls = fileDecl.get(e.file)
  if (!decls || decls.size === 0) return null
  const leaf = e.tgt.includes(":") ? e.tgt.slice(e.tgt.lastIndexOf(":") + 1) : e.tgt
  const cands = [leaf, kebabToPascal(leaf), pascalToKebab(leaf)]
  if (e.tgt.includes(".")) cands.push(e.tgt.split(".").pop()!)
  const low = new Set([...decls.keys()].map((k) => k.toLowerCase()))
  for (const c of cands) if (c && c !== e.tgt && low.has(c.toLowerCase())) return c
  return null
}

/**
 * THE LEAF PROBE — the trap, measured before it is walked into.
 *
 * A composite target (`./vp-menu-link.vue:VPMenuLink`) carries the LEAF the import introduces.
 * Rebasing the target onto that leaf would resolve SOME of these — and every one whose leaf is
 * declared MORE THAN ONCE in the project lands in amb/collRes, where production's tie-break
 * picks and the indexer measures ~75% of such picks wrong. So the probe reports all three states
 * per bucket: leaf-absent (nothing to gain), leaf-unique (would resolve), leaf-collision (the
 * trap). `callee` is the same probe for the FULL `calleeExpression` the analyzer already kept.
 */
type LeafProbe = { absent: number; unique: number; collision: number; examples: Set<string> }
const emptyProbe = (): LeafProbe => ({ absent: 0, unique: 0, collision: 0, examples: new Set() })
const leafOf = (tgt: string): string => (tgt.includes(":") ? tgt.slice(tgt.lastIndexOf(":") + 1) : tgt)

/**
 * THE QUALIFICATION PROBE — the fleet-wide cause (b), measured on this lane.
 *
 * "The leaf is published and the qualifier is thrown away." Here the qualifier is not thrown
 * away: it is already IN THE SYMBOL TABLE as the member's `qualifiedName`, which is exactly
 * the key production matches by (strategy 1, `_res_qname.qualified_name`) and exactly the key
 * the gate indexes as an alias. So for every edge that is ambiguous or unresolved, this asks:
 * does the EDGE'S OWN FILE declare a symbol with this leaf, and is one of the qualified names
 * that file publishes for it declared EXACTLY ONCE in the project? `exact` is the number a
 * qualified target would move from amb/unresolved to resolved; `collision` is the number that
 * would stay ambiguous (or become one); `absent` is the number the current key space cannot
 * answer at all.
 */
type QualProbe = { exact: number; collision: number; none: number; examples: Set<string> }
const emptyQual = (): QualProbe => ({ exact: 0, collision: 0, none: 0, examples: new Set() })
function qualOf(e: Pending): { kind: "exact" | "collision" | "none"; key: string | null } {
  const quals = fileQual.get(e.file)?.get(leafOf(e.tgt))
  if (!quals || quals.length === 0) return { kind: "none", key: null }
  const decls = projectDecl.get(e.repo)!
  const unique = quals.filter((q) => (decls.get(q) ?? 0) === 1)
  if (unique.length > 0) return { kind: "exact", key: unique[0] }
  return { kind: "collision", key: quals[0] }
}

type Bucket = { bucket: string; n: number; examples: Map<string, number>; intent: Map<string, number>; leaf: LeafProbe; callee: LeafProbe; qual: QualProbe; variant: number; variantEx: Set<string> }
const buckets = new Map<string, Bucket>()   // key = `${type}\u0000${bucket}`
const bucketIntent = new Map<string, Map<string, number>>()
const intentOf = (e: Pending, bucket: string): string => {
  // the intent test, applied only where the analyzer could ever be right or wrong: for the
  // rest, the edge has no candidate at all and the class is "no declaration anywhere".
  const decls = projectDecl.get(e.repo)!
  if ((decls.get(e.tgt) ?? 0) > 0) return "has-declaration(should-not-be-unresolved)"
  return "no-declaration-anywhere-in-the-run"
}

function bucketOf(e: Pending): string {
  const md = e.md as Record<string, any>
  const tgt = e.tgt
  switch (e.label) {
    case "imports": {
      if (tgt.includes(":")) {
        const spec = tgt.slice(0, tgt.lastIndexOf(":"))
        if (spec.startsWith(".")) return spec.toLowerCase().endsWith(".vue") ? "relative .vue specifier (composite `path:item`)" : "relative non-.vue module (composite `path:item`)"
        if (spec.startsWith("@/") || spec.startsWith("~/")) return "project alias specifier (composite `path:item`)"
        return "bare package specifier (composite `pkg:item`)"
      }
      return "import target with no composite spelling"
    }
    case "calls": {
      const callee = typeof md.calleeExpression === "string" ? md.calleeExpression : ""
      if (!callee) return "call with no callee expression recorded"
      if (callee.includes(".")) return "receiver call `x.y` (member path)"
      if (callee === "this") return "`this` call"
      return "bare callee identifier"
    }
    case "instantiates": {
      const tag = typeof md.tagAsWritten === "string" ? md.tagAsWritten : tgt
      if (md.isComponentUsage) return "component tag (isComponentUsage)"
      if (/^[a-z]+$/.test(tag) && tag === tag.toLowerCase()) return "lowercase tag with no isComponentUsage marker"
      return "instantiates target with no component marker"
    }
    case "references": {
      if (md.isTypeReference) return "type reference (isTypeReference)"
      if (md.isPropContract) return "prop contract key"
      if (md.isEmitContract) return "emit contract key"
      if (md.isProvideContract || md.isInjectContract) return "provide/inject contract key"
      if (typeof md.module === "string") return "type-only import reference"
      return "reference with no construct marker"
    }
    case "uses": {
      if (md.isTemplateExpression) return "template expression name"
      if (md.isTemplateInterpolation) return "template interpolation name"
      return "script-side use"
    }
    case "contains": return "contains"
    default: return "other"
  }
}

for (const e of pending as any[]) {
  if (e.outcome !== "unresolved" && !String(e.outcome).startsWith("amb")) continue
  const b = bucketOf(e)
  const key = `${e.label}\u0000${b}\u0000${e.outcome === "unresolved" ? "unresolved" : "ambiguous"}`
  let row = buckets.get(key)
  if (!row) buckets.set(key, (row = { bucket: b, n: 0, examples: new Map(), intent: new Map(), leaf: emptyProbe(), callee: emptyProbe(), qual: emptyQual(), variant: 0, variantEx: new Set() }))
  row.n++
  row.examples.set(e.tgt, (row.examples.get(e.tgt) ?? 0) + 1)
  const q = qualOf(e)
  row.qual[q.kind]++
  if (q.kind === "exact" && q.key && row.qual.examples.size < 6) row.qual.examples.add(`${e.tgt} -> ${q.key}`)
  const it = e.outcome === "unresolved" ? ownFileVariant(e) : null
  row.intent.set(it ? `own-file-variant:${it === e.tgt ? "same" : it}` : intentOf(e, b), (row.intent.get(it ? `own-file-variant:${it}` : intentOf(e, b)) ?? 0) + 1)
  if (e.outcome === "unresolved") {
    const decls = projectDecl.get(e.repo)!
    const probe = (p: LeafProbe, name: string) => {
      if (!name || name === e.tgt) return
      const n = decls.get(name)
      if (n === undefined) p.absent++
      else if (n === 1) { p.unique++; if (p.examples.size < 6) p.examples.add(name) }
      else { p.collision++; if (p.examples.size < 6) p.examples.add(`${name}(${n})`) }
    }
    probe(row.leaf, leafOf(e.tgt))
    const callee = typeof (e.md as any).calleeExpression === "string" ? (e.md as any).calleeExpression : ""
    probe(row.callee, callee)
    // THE VARIANT PROBE — the last way an unresolved target could still be answerable: the project
    // declares the SAME thing under a spelling the edge did not use (case fold, kebab↔Pascal, the
    // leaf of a dotted/composite target). Counted separately from the leaf probe because a leaf is
    // only one of the spellings, and this is the question "is the declaration in the run AT ALL".
    const varies = new Set<string>()
    const leaf = leafOf(e.tgt)
    for (const cand of [leaf, kebabToPascal(leaf), pascalToKebab(leaf), leaf.toLowerCase(), e.tgt.split(".").pop() ?? leaf]) {
      if (!cand || cand === e.tgt) continue
      const hit = projectLower.get(e.repo)?.get(cand.toLowerCase())
      if (hit) for (const key of hit) varies.add(key)
    }
    if (varies.size === 1) { row.variant++; if (row.variantEx.size < 5) row.variantEx.add(`${e.tgt} -> ${[...varies][0]}`) }
  }
  void bucketIntent
}

// ---------------------------------------------------------------- report
const pct = (n: number, d: number) => d === 0 ? "—" : `${((100 * n) / d).toFixed(1)}%`
console.log(`vue residual census — population: ${parsed} parsed of ${files.length} sampled (corpus has ${total} .vue files across ${repoSet.size} repos; stride=${MAX > 0 && total > MAX ? Math.max(1, Math.floor(total / MAX)) : 1})`)
console.log(`  failed ${failed} · degraded ${degraded} · empty-result ${emptyResults} · endpoint keys: name + qualifiedName aliases`)

console.log(`\n0 · REPRODUCTION AGAINST THE GATE (must match TABLE 1 exactly)`)
console.log(`  type          edges   resolved   amb(decl)  unresolved   |  gate`)
const gate: Record<string, [number, number, number, number]> = {
  calls: [1075, 44, 61, 881], uses: [824, 278, 499, 47], contains: [119, 119, 0, 0],
  imports: [681, 0, 0, 681], references: [437, 97, 131, 164], instantiates: [756, 124, 2, 630],
}
let mismatch = 0
let tEdges = 0, tRes = 0, tAmb = 0, tUnres = 0
for (const t of ALL_TYPES) {
  const row = byType.get(t) ?? {}
  const resolved = (row.resolved ?? 0) + (row.bindingVerified ?? 0) + (row.externalVerified ?? 0) + (row.causeDeclared ?? 0)
  const amb = (row.ambDeclOnly ?? 0) + (row.ambBoth ?? 0)
  const unres = row.unresolved ?? 0
  const edges = edgeCount.get(t) ?? 0
  tEdges += edges; tRes += row.resolved ?? 0; tAmb += amb; tUnres += unres
  const g = gate[t]
  const ok = !g ? "     (not in gate table)" : (g[0] === edges && g[1] === (row.resolved ?? 0) && g[2] === amb && g[3] === unres) ? "  ✓ matches" : (mismatch++, `  ✗ gate ${g.join("/")}`)
  console.log(`  ${t.padEnd(14)}${String(edges).padStart(5)}${String(row.resolved ?? 0).padStart(10)}${String(amb).padStart(11)}${String(unres).padStart(12)}   |${ok}`)
  void resolved
}
console.log(`  ${"TOTAL".padEnd(14)}${String(tEdges).padStart(5)}${String(tRes).padStart(10)}${String(tAmb).padStart(11)}${String(tUnres).padStart(12)}   | gate 3892/662/693/2403 ${mismatch === 0 ? "✓ matches" : `✗ ${mismatch} type(s) differ`}`)

console.log(`\n1 · UNRESOLVED BY NAMED CONSTRUCT (the clause-2 buckets)`)
const rows = [...buckets.entries()].filter(([k]) => k.endsWith("\u0000unresolved"))
  .sort((a, b) => b[1].n - a[1].n)
let sumU = 0
for (const [k, v] of rows) {
  const t = k.split("\u0000")[0]
  sumU += v.n
  console.log(`  ${t.padEnd(14)}${String(v.n).padStart(5)}  ${pct(v.n, tUnres).padStart(6)} of type's unresolved   ${v.bucket}`)
  console.log(`        top targets: ${[...v.examples.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([t2, n2]) => `${t2}×${n2}`).join("  ")}`)
  console.log(`        probe: ${[...v.intent.entries()].map(([a, b]) => `${a} ${b}`).join(" · ")}`)
  if (v.leaf.absent + v.leaf.unique + v.leaf.collision > 0) {
    console.log(`        LEAF (after the last ':'): absent ${v.leaf.absent} · unique ${v.leaf.unique} (would resolve) · collision ${v.leaf.collision} (THE TRAP)${v.leaf.examples.size ? ` · e.g. ${[...v.leaf.examples].join(", ")}` : ""}`)
  }
  if (v.qual.exact + v.qual.collision + v.qual.none > 0) {
    console.log(`        QUALIFIER (the qualifiedName the own file already publishes): EXACT ${v.qual.exact} (would resolve, no tie-break) · still-colliding ${v.qual.collision} · no own-file member ${v.qual.none}${v.qual.examples.size ? ` · e.g. ${[...v.qual.examples].join(", ")}` : ""}`)
  }
  if (v.variant > 0) console.log(`        VARIANT: ${v.variant} edge(s) whose target the project declares under another spelling${v.variantEx.size ? ` · e.g. ${[...v.variantEx].join(", ")}` : ""}`)
  if (v.callee.absent + v.callee.unique + v.callee.collision > 0) {
    console.log(`        CALLEE (the full calleeExpression the edge already keeps): absent ${v.callee.absent} · unique ${v.callee.unique} · collision ${v.callee.collision}${v.callee.examples.size ? ` · e.g. ${[...v.callee.examples].join(", ")}` : ""}`)
  }
}
console.log(`  ${"SUM".padEnd(14)}${String(sumU).padStart(5)}  (gate unresolved 2403 — the buckets must close on it)`)

console.log(`\n2 · AMBIGUOUS BY NAMED CONSTRUCT (the collRes side: a tie-break chose)`)
for (const [k, v] of [...buckets.entries()].filter(([k2]) => k2.endsWith("\u0000ambiguous")).sort((a, b) => b[1].n - a[1].n).slice(0, 12)) {
  const t = k.split("\u0000")[0]
  console.log(`  ${t.padEnd(14)}${String(v.n).padStart(5)}  ${v.bucket}`)
  console.log(`        top targets: ${[...v.examples.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([t2, n2]) => `${t2}×${n2}`).join("  ")}`)
  console.log(`        QUALIFIER: EXACT ${v.qual.exact} (would resolve, no tie-break) · still-colliding ${v.qual.collision} · no own-file member ${v.qual.none}${v.qual.examples.size ? ` · e.g. ${[...v.qual.examples].join(", ")}` : ""}`)
}

console.log(`\n3 · SAMPLE EDGES FROM THE LARGEST UNRESOLVED BUCKETS (for hand-reading)`)
for (const [k, v] of rows.slice(0, 8)) {
  const t = k.split("\u0000")[0]
  const b = k.split("\u0000")[1]
  const samp = (pending as any[]).filter((e) => e.label === t && bucketOf(e) === b && e.outcome === "unresolved").slice(0, 10)
  console.log(`  [${t} · ${b}]`)
  for (const e of samp) console.log(`      ${rel(e.file)}:${e.line ?? "?"}  -> ${e.tgt}   markers=${e.sig}`)
}

if (JSON_OUT) {
  writeFileSync(JSON_OUT, JSON.stringify({
    population: { parsed, sampled: files.length, corpusTotal: total, repos: repoSet.size, max: MAX },
    reproduction: { edges: tEdges, resolved: tRes, amb: tAmb, unresolved: tUnres, mismatches: mismatch },
    buckets: Object.fromEntries([...buckets.entries()].map(([k, v]) => [k, { n: v.n, targets: Object.fromEntries([...v.examples.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40)), probe: Object.fromEntries(v.intent), leaf: { absent: v.leaf.absent, unique: v.leaf.unique, collision: v.leaf.collision, examples: [...v.leaf.examples] }, callee: { absent: v.callee.absent, unique: v.callee.unique, collision: v.callee.collision, examples: [...v.callee.examples] } }])),
  }, null, 2))
}
