/**
 * NIM — THE RESIDUAL'S NAMED CAUSES, on the gate's own population and scope.
 *
 * `script/m14/incoming-gate.ts` prints one `unresolved` number per type and a 25-name
 * worklist. A worklist of names is not a CAUSE: this programme's clause 2 requires every
 * ambiguous/unresolved edge to be attributed to a NAMED cause with a measured count, and
 * the thing that has to be named is the CONSTRUCT, not the total.
 *
 * So this instrument decomposes `unresolved` without changing how it is produced:
 * discovery, the 1 MB cap, the even stride, `parseFile(f, repoOf(f), { projectRoot })`,
 * the name + qualifiedName key space and `classifyEdge` are the gate's own (the rule is
 * IMPORTED from `script/m14/incoming-rule.ts`, never copied). The gate's numbers are
 * reproduced first and printed beside the decomposition so a reader can see that the
 * parts are parts of THAT total and not of some other run.
 *
 * TWO AXES, because one does not name a construct:
 *
 *   WHERE THE NAME LIVES   the project declares nothing (that IS the outcome). Does the
 *                          RUN declare it anywhere (another repository of the corpus), or
 *                          does nothing in the draw declare it at all? Those are different
 *                          causes with different repairs — a project-scoped resolution
 *                          question versus a name the run has no declaration for.
 *
 *   WHAT THE EDGE IS       the construct the analyzer emitted, read off the edge's own
 *                          metadata (the marker set the gate groups by) and, for `calls`,
 *                          the call SHAPE from the retained `callExpression`. A cause
 *                          named "unresolved" is not a cause; "a dot-receiver call whose
 *                          leaf no file in the project declares" is.
 *
 * AND THE PRICE OF THE OBVIOUS REPAIR, measured rather than argued: for an edge whose file
 * imports a module the PROJECT does not contain, the target is a member of something the
 * project does not carry. This instrument counts how much of the residual sits in files
 * that import at least one module absent from their own project — which is the population
 * an "external module member" claim would have to cover — beside the count of those edges
 * whose module the run DOES declare somewhere, i.e. the ones that are cross-project rather
 * than external.
 *
 * Usage:
 *   npx tsx validation/m14/fixtures/nim/residual-cause-census.mts [--sample 400] [--top 12] [--out p.json]
 */
import { execFileSync } from "node:child_process"
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"
import { classifyEdge, externalClaimOf, isContainsEdge } from "../../../../script/m14/incoming-rule"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SIZE_CAP = 1024 * 1024
const argv = process.argv.slice(2)
const arg = (n: string, d: string) => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d
}
const SAMPLE = Number(arg("sample", "400"))
const TOP = Number(arg("top", "12"))
const OUT = arg("out", "")

// ───────────────────────────────────────────── population (the gate's own)
const found: string[] = []
const repos = new Set<string>()
for (const name of readdirSync(CR).sort()) {
  const dir = path.join(CR, name)
  try { if (!statSync(dir).isDirectory()) continue } catch { continue }
  try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
      .split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    if (!rel.toLowerCase().endsWith(".nim")) continue
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > SIZE_CAP) continue } catch { continue }
    found.push(abs)
    repos.add(name)
  }
}
found.sort()
const total = found.length
let files = found
let stride = 1
if (SAMPLE > 0 && total > SAMPLE) {
  stride = Math.max(1, Math.floor(total / SAMPLE))
  const picked: string[] = []
  for (let i = 0; i < found.length && picked.length < SAMPLE; i += stride) picked.push(found[i])
  files = picked
}
const repoOf = (f: string) => {
  const rel = f.startsWith(CR) ? f.slice(CR.length + 1) : f
  return path.join(CR, rel.split(path.sep)[0]!)
}

// ───────────────────────────────────────────── walk, building the gate's two key spaces
type Rec = {
  repo: string; file: string; label: string; tgt: string; line: number | null
  sig: string; outcome: string
  /** names of the modules this FILE imports, as the imports edges spell them */
  fileModules: string[]
}
const projectDecl = new Map<string, Map<string, number>>()
const projectKinds = new Map<string, Map<string, Set<string>>>()
const projectModules = new Map<string, Map<string, number>>()  // repo -> module-name -> declarations
const pooledDecl = new Map<string, number>()
/** key -> the files that declare it, for the gate's `ownFileDeclares` input */
const declFiles = new Map<string, Set<string>>()
const EMPTY_FILES: Set<string> = new Set()
const recs: Rec[] = []
const fileModulesOf = new Map<string, string[]>()
let parsed = 0, failed = 0

function projectOf(repo: string): Map<string, number> {
  let m = projectDecl.get(repo)
  if (!m) projectDecl.set(repo, (m = new Map()))
  return m
}
function projectKindsOf(repo: string): Map<string, Set<string>> {
  let m = projectKinds.get(repo)
  if (!m) projectKinds.set(repo, (m = new Map()))
  return m
}
function projectModulesOf(repo: string): Map<string, number> {
  let m = projectModules.get(repo)
  if (!m) projectModules.set(repo, (m = new Map()))
  return m
}

type Edge = { label: string; tgt: string; rel: any }

function onto(t: string): string {
  // the gate's ontologyName map, for the labels this lane emits; anything else keeps its spelling
  const map: Record<string, string> = {
    calls: "calls", imports: "imports", exports: "exports", contains: "contains",
    references: "references", extends: "extends", implements: "implements",
    overrides: "overrides", uses: "uses", instantiates: "instantiates",
  }
  return map[t] ?? t
}

for (const f of files) {
  const repo = repoOf(f)
  let r: any
  try {
    r = await parseFile(f, repo, { projectRoot: repo } as any)
  } catch { failed++; continue }
  parsed++
  const pDecl = projectOf(repo), pKinds = projectKindsOf(repo), pMods = projectModulesOf(repo)
  const syms = Array.isArray(r?.symbols) ? r.symbols : []
  const noteDecl = (key: string) => {
    let s = declFiles.get(key); if (!s) declFiles.set(key, (s = new Set())); s.add(f)
  }
  for (const s of syms) {
    const name = String(s?.name ?? "")
    if (!name) continue
    const kind = String(s?.kind ?? "")
    const q = String((s as any)?.qualifiedName ?? "")
    pDecl.set(name, (pDecl.get(name) ?? 0) + 1)
    pooledDecl.set(name, (pooledDecl.get(name) ?? 0) + 1)
    noteDecl(name)
    let ks = pKinds.get(name); if (!ks) pKinds.set(name, (ks = new Set())); ks.add(kind)
    if (q && q !== name) {
      pDecl.set(q, (pDecl.get(q) ?? 0) + 1)
      pooledDecl.set(q, (pooledDecl.get(q) ?? 0) + 1)
      noteDecl(q)
      let qs = pKinds.get(q); if (!qs) pKinds.set(q, (qs = new Set())); qs.add(kind)
    }
    if (String(s?.kind ?? "") === "module" || (s as any)?.metadata?.nimModule) {
      pMods.set(name, (pMods.get(name) ?? 0) + 1)
    }
  }
  const rels: any[] = Array.isArray(r?.relationships) ? r.relationships : []
  const mods: string[] = []
  for (const rel of rels) {
    const label = onto(String(rel?.type ?? rel?.relationshipType ?? ""))
    if (label === "imports") {
      const t = String(rel?.target ?? "")
      if (t) mods.push(t)
    }
  }
  fileModulesOf.set(f, mods)
  for (const rel of rels) {
    const label = onto(String(rel?.type ?? rel?.relationshipType ?? ""))
    if (!label) continue
    const tgt = String(rel?.target ?? rel?.to ?? "")
    if (!tgt) continue
    const md = rel?.metadata ?? {}
    const markKeys = Object.keys(md).filter((k) => k !== "evidenceClass" && k !== "analysisVersion" && md[k] !== false && md[k] != null)
    markKeys.sort()
    recs.push({
      repo, file: f, label, tgt,
      line: Number(rel?.line_number ?? 0) || null,
      sig: markKeys.length ? markKeys.join("+") : "(no marker)",
      outcome: "", fileModules: mods,
    })
  }
}

// ───────────────────────────────────────────── classify (the gate's own rule)
/** `classifyEdge`'s outcome vocabulary, folded to the four buckets TABLE 1 prints. */
function bucketOf(o: string): "resolved" | "ambiguous" | "unresolved" | "external" | "binding" | "cause" {
  if (o === "resolved") return "resolved"
  if (o === "ambDeclOnly" || o === "ambBoth") return "ambiguous"
  if (o === "unresolved") return "unresolved"
  if (o === "externalVerified" || o === "externalUnverified") return "external"
  if (o.startsWith("binding")) return "binding"
  return "cause"
}
for (const rec of recs) {
  const pDecl = projectOf(rec.repo), pKinds = projectKindsOf(rec.repo)
  const claim = externalClaimOf({ metadata: markerRecover(rec) })
  const res = classifyEdge(
    pDecl, pKinds, rec.tgt, claim as any, undefined,
    isContainsEdge(rec.label),
    (declFiles.get(rec.tgt) ?? EMPTY_FILES).has(rec.file),
  )
  rec.outcome = bucketOf(String((res as any)?.outcome ?? "?"))
}
/** The marker set, recovered as a metadata object so `externalClaimOf` sees the same keys. */
function markerRecover(rec: Rec): Record<string, unknown> {
  const o: Record<string, unknown> = {}
  for (const k of rec.sig.split("+")) if (k && k !== "(no marker)") o[k] = true
  return o
}

// ───────────────────────────────────────────── report
const out: string[] = []
const ALL = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"]
out.push(`# NIM RESIDUAL — NAMED CAUSES, gate population and scope`)
out.push(`population: ${parsed} parsed of ${files.length} sampled (corpus ${total} .nim files across ${repos.size} repos; stride ${stride}, cap ${SAMPLE})  failed-parse ${failed}`)
const byType = new Map<string, Rec[]>()
for (const r of recs) {
  let a = byType.get(r.label); if (!a) byType.set(r.label, (a = [])); a.push(r)
}
let TOT = { edges: 0, resolved: 0, amb: 0, unres: 0, proj: 0, elsewhere: 0, nowhere: 0, crossProjOnly: 0 }
out.push(``)
out.push(`TABLE 1 — reproduced, per project scope (this must equal the gate's own table)`)
out.push(`type          edges    resolved  amb      unresolved`)
for (const t of ALL) {
  const rows = byType.get(t) ?? []
  const resolved = rows.filter((r) => r.outcome === "resolved").length
  const amb = rows.filter((r) => r.outcome === "ambiguous").length
  const unres = rows.filter((r) => r.outcome === "unresolved").length
  if (rows.length === 0) continue
  TOT.edges += rows.length; TOT.resolved += resolved; TOT.amb += amb; TOT.unres += unres
  out.push(`${t.padEnd(13)} ${String(rows.length).padEnd(8)} ${String(resolved).padEnd(9)} ${String(amb).padEnd(8)} ${unres}`)
}
out.push(`${"TOTAL".padEnd(13)} ${String(TOT.edges).padEnd(8)} ${String(TOT.resolved).padEnd(9)} ${String(TOT.amb).padEnd(8)} ${TOT.unres}`)

out.push(``)
out.push(`TABLE 2 — THE UNRESOLVED SPLIT BY WHERE THE NAME LIVES, project scope`)
out.push(`  inRun  = the RUN (this ${files.length}-file draw) declares the target somewhere: either`)
out.push(`           only in ANOTHER repository (cross-project) or in this one under a name the`)
out.push(`           project key space did not count. The project itself declares nothing.`)
out.push(`  nowhere= NO FILE IN THE DRAW declares the target at all.`)
out.push(`type          unresolved  targetInRun  targetNowhere  ofInRun:inOtherRepo`)
for (const t of ALL) {
  const rows = (byType.get(t) ?? []).filter((r) => r.outcome === "unresolved")
  if (rows.length === 0) continue
  let inRun = 0, no = 0, otherRepo = 0
  for (const r of rows) {
    const p = (pooledDecl.get(r.tgt) ?? 0) > 0
    if (p) { inRun++; if ((projectOf(r.repo).get(r.tgt) ?? 0) === 0) otherRepo++ } else no++
  }
  TOT.proj += rows.length; TOT.elsewhere += inRun; TOT.nowhere += no; TOT.crossProjOnly += otherRepo
  out.push(`${t.padEnd(13)} ${String(rows.length).padEnd(11)} ${String(inRun).padEnd(12)} ${String(no).padEnd(14)} ${otherRepo}`)
}
out.push(`${"TOTAL".padEnd(13)} ${String(TOT.proj).padEnd(11)} ${String(TOT.elsewhere).padEnd(12)} ${String(TOT.nowhere).padEnd(14)} ${TOT.crossProjOnly}`)

// ── the construct axis, per type
const CONSTRUCTS: Record<string, (r: Rec) => string> = {
  calls: (r) => (r.sig.includes("nimImportBased") ? "import-qualified call" : "call"),
  imports: (r) => {
    const p = String((r as any)?.writtenPath ?? "")
    return p.length ? `import ${p}` : "import (path not retained here)"
  },
  references: (r) => "reference",
  exports: (r) => "re-export",
  extends: (r) => "heritage base",
}
out.push(``)
out.push(`TABLE 3 — THE UNRESOLVED BY NAMED CONSTRUCT (marker set the gate groups by)`)
for (const t of ALL) {
  const rows = (byType.get(t) ?? []).filter((r) => r.outcome === "unresolved")
  if (rows.length === 0) continue
  const m = new Map<string, number>()
  for (const r of rows) m.set(r.sig, (m.get(r.sig) ?? 0) + 1)
  out.push(`  ${t} — ${rows.length} unresolved`)
  for (const [sig, n] of [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP)) {
    out.push(`    ${String(n).padStart(6)}  ${sig}`)
  }
}

// ── the external-module price
out.push(``)
out.push(`TABLE 4 — THE PRICE OF AN "EXTERNAL MODULE MEMBER" CLAIM, measured`)
out.push(`  For each unresolved edge: does the EDGE'S OWN FILE import a module the edge's own`)
out.push(`  PROJECT does not contain (no module symbol of that name in the project)?`)
out.push(`  importsAbsent = at least one imported module absent from the project`)
out.push(`  and, of those, how many name a module the RUN declares somewhere (cross-project,`)
out.push(`  which is a resolution-scope question, not an externality).`)
out.push(`type          unresolved  importsAbsent  ofThose:moduleInRun  importsAllPresent`)
for (const t of ALL) {
  const rows = (byType.get(t) ?? []).filter((r) => r.outcome === "unresolved")
  if (rows.length === 0) continue
  let absent = 0, modInRun = 0, allPresent = 0
  for (const r of rows) {
    const pMods = projectModulesOf(r.repo)
    const missing = r.fileModules.filter((m) => (pMods.get(m) ?? 0) === 0)
    if (missing.length === 0) { allPresent++; continue }
    absent++
    if (missing.some((m) => (pooledDecl.get(m) ?? 0) > 0)) modInRun++
  }
  out.push(`${t.padEnd(13)} ${String(rows.length).padEnd(11)} ${String(absent).padEnd(14)} ${String(modInRun).padEnd(21)} ${allPresent}`)
}

// ── top targets, with provenance
out.push(``)
out.push(`TABLE 5 — TOP UNRESOLVED TARGETS with their provenance in the draw`)
for (const t of ["calls", "references", "imports", "exports", "extends"]) {
  const rows = (byType.get(t) ?? []).filter((r) => r.outcome === "unresolved")
  if (rows.length === 0) continue
  const m = new Map<string, number>()
  for (const r of rows) m.set(r.tgt, (m.get(r.tgt) ?? 0) + 1)
  out.push(`  ${t}:`)
  for (const [name, n] of [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP)) {
    const inRun = pooledDecl.get(name) ?? 0
    out.push(`    ${String(n).padStart(5)}  ${name.padEnd(28)} inRunDecls ${inRun}  ${inRun === 0 ? "NOTHING IN THE DRAW DECLARES IT" : "declared elsewhere in the draw"}`)
  }
}

// ── the doability price for the two candidate repairs
out.push(``)
out.push(`TABLE 6 — PRICE OF THE TWO OBVIOUS REPAIRS (what each rule would actually answer)`)
{
  // (a) publish the module qualifier on an import-qualified call: `mod.leaf`
  let unresCalls = 0, wouldMatchQualified = 0
  for (const r of (byType.get("calls") ?? []).filter((x) => x.outcome === "unresolved")) {
    unresCalls++
    for (const m of r.fileModules) {
      if ((projectOf(r.repo).get(`${m}.${r.tgt}`) ?? 0) > 0) { wouldMatchQualified++; break }
    }
  }
  out.push(`  (a) calls -> \`<importedModule>.<leaf>\`: of ${unresCalls} unresolved calls, ${wouldMatchQualified} would match a project symbol carrying that qualifiedName`)
  // (b) module-import repair: would a qualified module path answer?
  let unresImports = 0, projHasStem = 0
  for (const r of (byType.get("imports") ?? []).filter((x) => x.outcome === "unresolved")) {
    unresImports++
    if ((projectModulesOf(r.repo).get(r.tgt) ?? 0) > 0) projHasStem++
  }
  out.push(`  (b) imports -> project holds a MODULE SYMBOL of that name: ${projHasStem} of ${unresImports} unresolved imports`)
}

// ── the site axis: WHICH CONSTRUCT, with file:line the reader can open
out.push(``)
out.push(`TABLE 7 — UNRESOLVED TARGETS WITH THEIR SOURCE SITES (2 examples each; the construct)`)
{
  const srcCache = new Map<string, string[]>()
  const lineOf = (f: string, n: number | null): string => {
    if (!n) return "(no line)"
    let ls = srcCache.get(f)
    if (!ls) { try { ls = readFileSync(f, "utf8").split("\n") } catch { ls = [] } srcCache.set(f, ls) }
    return (ls[n - 1] ?? "").trim().slice(0, 110)
  }
  for (const t of ["references", "calls", "imports", "exports", "extends"]) {
    const rows = (byType.get(t) ?? []).filter((r) => r.outcome === "unresolved")
    if (rows.length === 0) continue
    const m = new Map<string, Rec[]>()
    for (const r of rows) { let a = m.get(r.tgt); if (!a) m.set(r.tgt, (a = [])); a.push(r) }
    out.push(`  ${t} — ${rows.length} unresolved across ${m.size} distinct targets`)
    for (const [name, rs] of [...m.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, TOP)) {
      const inRun = pooledDecl.get(name) ?? 0
      out.push(`    ${String(rs.length).padStart(5)}  ${name.padEnd(26)} inRunDecls ${String(inRun).padEnd(5)} ${inRun === 0 ? "NOTHING DECLARES IT" : "declared elsewhere"}`)
      for (const r of rs.slice(0, 2)) {
        out.push(`             ${r.file.replace(CR + "/", "")}:${r.line ?? "?"}  ${lineOf(r.file, r.line)}`)
      }
    }
  }
}

const text = out.join("\n")
console.log(text)
if (OUT) {
  writeFileSync(OUT, JSON.stringify({
    population: { parsed, sampled: files.length, total, repos: repos.size, stride, cap: SAMPLE },
    totals: TOT,
    table1: ALL.map((t) => {
      const rows = byType.get(t) ?? []
      return { type: t, edges: rows.length, resolved: rows.filter((r) => r.outcome === "resolved").length, amb: rows.filter((r) => r.outcome === "ambiguous").length, unresolved: rows.filter((r) => r.outcome === "unresolved").length }
    }),
  }, null, 2))
}
