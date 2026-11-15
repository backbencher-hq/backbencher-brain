/**
 * VB RESIDUAL CENSUS — the instrument behind VB-FIX.md's classification.
 *
 * READ-ONLY: it parses the corpus with production's own `parseFile`, classifies every edge with
 * the gate's own imported rule (`script/m14/incoming-rule`), and buckets `unresolved` by the
 * NAMED CONSTRUCT the edge came from — metadata scalars for every type, and for `references` a
 * real tree walk that reports the SOURCE GRAMMAR NODE (predefined_type / simple_name /
 * qualified_name / …) rather than the analyzer's own summary of it.
 *
 * It is here, next to the lane's fixtures, because the fleet's convention for a lane-owned
 * instrument is `validation/m14/fixtures/<lang>/tools/` (see `fixtures/hcl/tools/
 * store-binding-truth.mts`), and because a census that cannot be re-run is a number nobody can
 * check. Nothing in this file is imported by the analyzer or by any gate.
 *
 * Run from the repo root:  bun run validation/m14/fixtures/vb/tools/vb-residual-census.ts
 */
const fs = await import("node:fs")
const path = await import("node:path")
const ROOT = path.resolve(import.meta.dir, "..", "..", "..", "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const { parseFile } = await import(path.join(ROOT, "src/ast/pool-worker"))
const rule = await import(path.join(ROOT, "script/m14/incoming-rule"))
const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine"))

const files: string[] = []
function walk(d: string): void {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name)
    if (e.isDirectory()) { if (e.name === "node_modules" || e.name === ".git") continue; walk(p) }
    else if (e.name.toLowerCase().endsWith(".vb")) {
      try { if (fs.statSync(p).size <= 1048576) files.push(p) } catch { /* skip */ }
    }
  }
}
for (const repo of fs.readdirSync(CR)) {
  const p = path.join(CR, repo)
  let st: any; try { st = fs.statSync(p) } catch { continue }
  if (st.isDirectory()) walk(p)
}
files.sort()
const repoOf = (f: string): string => path.join(CR, f.slice(CR.length + 1).split(path.sep)[0])
const repos = new Set(files.map(repoOf))
console.log(`DISCOVERED ${files.length} .vb files (<=1MB) across ${repos.size} repos`)

const projDecl = new Map<string, Map<string, number>>()
const projKinds = new Map<string, Map<string, Set<string>>>()
const ownFileDecl = new Map<string, Set<string>>()
let aliasedKeys = 0

type Edge = { f: string; repo: string; type: string; src: string; tgt: string; line: number | null; md: Record<string, any>; outcome: string; decls: number; boundCollision: boolean; ownFile: boolean }
const edges: Edge[] = []

for (const f of files) {
  const r: any = await parseFile(f, repoOf(f), { projectRoot: repoOf(f) } as any)
  const repo = repoOf(f)
  let d = projDecl.get(repo); if (!d) { d = new Map(); projDecl.set(repo, d) }
  let k = projKinds.get(repo); if (!k) { k = new Map(); projKinds.set(repo, k) }
  const own = new Set<string>()
  ownFileDecl.set(f, own)
  for (const s of (r.symbols ?? []) as any[]) {
    const n = String(s?.name ?? ""); if (!n) continue
    own.add(n)
    d.set(n, (d.get(n) ?? 0) + 1)
    let ks = k.get(n); if (!ks) k.set(n, (ks = new Set())); ks.add(String(s?.kind ?? ""))
    const q = String(s?.qualifiedName ?? "")
    if (q && q !== n) {
      d.set(q, (d.get(q) ?? 0) + 1)
      let qs = k.get(q); if (!qs) k.set(q, (qs = new Set())); qs.add(String(s?.kind ?? ""))
      aliasedKeys++
    }
  }
  for (const rel of (r.relationships ?? []) as any[]) {
    const type = String(rel?.type ?? "")
    const tgt = String(rel?.target ?? "")
    const md = (rel?.metadata ?? {}) as Record<string, any>
    const line = Number(rel?.line_number ?? 0) || null
    edges.push({ f, repo, type, src: String(rel?.source ?? ""), tgt, line, md, outcome: "", decls: 0, boundCollision: false, ownFile: false })
  }
}
console.log(`ALIASED_KEYS (qualifiedName aliases) ${aliasedKeys}`)

const TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"]
const tally = new Map<string, { edges: number; resolved: number; collRes: number; amb: number; unres: number }>()
for (const t of TYPES) tally.set(t, { edges: 0, resolved: 0, collRes: 0, amb: 0, unres: 0 })

for (const e of edges) {
  const d = projDecl.get(e.repo)!
  const k = projKinds.get(e.repo)!
  const claim = rule.externalClaimOf({ type: e.type, target: e.tgt, metadata: e.md })
  const containsLike = rule.isContainsEdge(e.type)
  const cl = rule.classifyEdge(d, k, e.tgt, claim, undefined, containsLike, ownFileDecl.get(e.f)!.has(e.tgt))
  e.outcome = cl.outcome
  e.decls = cl.decls
  e.boundCollision = (cl as any).boundAmongCollision === true
  e.ownFile = ownFileDecl.get(e.f)!.has(e.tgt)
  const t = tally.get(e.type)
  if (!t) continue
  t.edges++
  if (cl.outcome === "resolved") { t.resolved++; if (e.boundCollision) t.collRes++ }
  else if (cl.outcome === "ambBoth" || cl.outcome === "ambDeclOnly") t.amb++
  else if (cl.outcome === "unresolved") t.unres++
}

console.log(`\nTABLE 1 (reproduced)`)
console.log(`type          edges    resolved collRes  amb      unres`)
let TE = 0, TR = 0, TC = 0, TA = 0, TU = 0
for (const t of TYPES) {
  const r = tally.get(t)!
  TE += r.edges; TR += r.resolved; TC += r.collRes; TA += r.amb; TU += r.unres
  console.log(`${t.padEnd(13)} ${String(r.edges).padStart(7)} ${String(r.resolved).padStart(9)} ${String(r.collRes).padStart(7)} ${String(r.amb).padStart(8)} ${String(r.unres).padStart(7)}`)
}
console.log(`${"TOTAL".padEnd(13)} ${String(TE).padStart(7)} ${String(TR).padStart(9)} ${String(TC).padStart(7)} ${String(TA).padStart(8)} ${String(TU).padStart(7)}`)

const SCALARS = ["qualified", "receiverIsQualified", "calleeIsQualified", "readKind", "constructionNode",
  "role", "baseTypeKnown", "resolvedInFile", "callShape", "callSignal", "importForm", "heritageForm",
  "constructsArray", "constructed", "duplicateRows", "roles", "baseType", "interfaceName"]
console.log(`\nUNRESOLVED BY TYPE x CONSTRUCT (metadata scalars, counts are of UNRESOLVED edges)`)
const byType = new Map<string, Map<string, number>>()
for (const e of edges) {
  if (e.outcome !== "unresolved") continue
  const parts: string[] = []
  for (const s of SCALARS) if (s in e.md) parts.push(`${s}=${JSON.stringify(e.md[s])}`)
  const sig = parts.join(" ") || "(no scalars)"
  let m = byType.get(e.type); if (!m) byType.set(e.type, m = new Map())
  m.set(sig, (m.get(sig) ?? 0) + 1)
}
for (const t of TYPES) {
  const m = byType.get(t); if (!m) continue
  const total = [...m.values()].reduce((a, b) => a + b, 0)
  console.log(`\n  ${t}  unresolved=${total}`)
  for (const [sig, n] of [...m.entries()].sort((a, b) => b[1] - a[1])) console.log(`    ${String(n).padStart(6)}  ${sig}`)
}

const PRE = new Set(["boolean", "byte", "sbyte", "char", "date", "decimal", "double", "integer", "long", "object", "short", "single", "string", "uinteger", "ulong", "ushort"])
console.log(`\nUNRESOLVED TARGETS THAT ARE VB BUILT-IN TYPE KEYWORDS (string match, lowercased):`)
const preTally = new Map<string, number>()
for (const e of edges) if (e.outcome === "unresolved" && PRE.has(e.tgt.toLowerCase())) preTally.set(e.tgt, (preTally.get(e.tgt) ?? 0) + 1)
let preTotal = 0
for (const [n, c] of [...preTally.entries()].sort((a, b) => b[1] - a[1])) { preTotal += c; console.log(`    ${String(c).padStart(6)}  ${n}`) }
console.log(`    ---- total ${preTotal} of ${TU} unresolved`)

const parser = await ASTEngine.getParser("vb" as any)
const refEdges = edges.filter((e) => e.type === "references")
const byFile = new Map<string, Edge[]>()
for (const e of refEdges) { let l = byFile.get(e.f); if (!l) byFile.set(e.f, l = []); l.push(e) }

type Site = { type: string; text: string; line: number }
const constructTally = new Map<string, { n: number; unres: number; sample: string[] }>()
const qualFull = new Map<string, number>()
let matched = 0, unmatched = 0
for (const [f, list] of byFile) {
  const content = fs.readFileSync(f, "utf8")
  const tree = parser.parse(content)
  if (!tree) continue
  const sites: Site[] = []
  const stack: any[] = [tree.rootNode]
  while (stack.length) {
    const n = stack.pop()
    const t = n.type
    if (t === "predefined_type" || t === "qualified_name" || t === "global_qualified_name" ||
        t === "simple_name" || t === "generic_name" || t === "nullable_type" || t === "array_type" ||
        t === "identifier" || t === "member_access_expression" || t === "imports_statement") {
      if (n.text.length <= 200) sites.push({ type: t, text: n.text.trim(), line: n.startPosition.row + 1 })
    }
    for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) stack.push(c) }
  }
  for (const e of list) {
    const leafEq = (txt: string): boolean => {
      const last = txt.split(".").pop() ?? txt
      return last.replace(/\?$/, "") === e.tgt
    }
    const at = sites.filter((s) => s.line === e.line && leafEq(s.text) &&
      (s.type === "predefined_type" || s.type === "qualified_name" || s.type === "global_qualified_name" || s.type === "simple_name" || s.type === "generic_name" || s.type === "nullable_type"))
    let key: string
    if (at.length === 0) { key = "UNMATCHED-BY-LINE"; unmatched++ }
    else {
      matched++
      const ty = at.map((s) => s.type)
      key = ty.includes("qualified_name") ? "qualified_name"
        : ty.includes("global_qualified_name") ? "global_qualified_name"
        : ty.includes("nullable_type") ? "nullable_type"
        : ty.includes("generic_name") ? "generic_name"
        : ty.includes("simple_name") ? "simple_name"
        : "predefined_type"
      if (key === "qualified_name" || key === "global_qualified_name") {
        const full = at.filter((s) => s.type === "qualified_name" || s.type === "global_qualified_name").map((s) => s.text)
        for (const x of full) qualFull.set(x, (qualFull.get(x) ?? 0) + 1)
      }
    }
    let c = constructTally.get(key); if (!c) constructTally.set(key, c = { n: 0, unres: 0, sample: [] })
    c.n++
    if (e.outcome === "unresolved") c.unres++
    if (c.sample.length < 6) c.sample.push(`${e.tgt}@${path.basename(f)}:${e.line}`)
  }
}
console.log(`\nreferences: SOURCE GRAMMAR NODE (tree-matched; ${matched} matched, ${unmatched} unmatched of ${refEdges.length})`)
for (const [k, v] of [...constructTally.entries()].sort((a, b) => b[1].n - a[1].n)) {
  console.log(`    ${String(v.n).padStart(6)} edges  ${String(v.unres).padStart(6)} unres  ${k}   e.g. ${v.sample.join(", ")}`)
}
console.log(`\nFULL QUALIFIED PATHS SEEN ON DISCARDED references (top 25 of ${qualFull.size} distinct):`)
for (const [k, v] of [...qualFull.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`    ${String(v).padStart(5)}  ${k}`)

console.log(`\nNAMESPACE DECLARATIONS: published name`)
const nsTally = new Map<string, number>()
for (const f of files) {
  const r: any = await parseFile(f, repoOf(f), { projectRoot: repoOf(f) } as any)
  for (const s of (r.symbols ?? []) as any[]) if (String(s?.kind) === "namespace") nsTally.set(String(s.name), (nsTally.get(String(s.name)) ?? 0) + 1)
}
console.log(`    ${nsTally.size} distinct namespace names; ${[...nsTally.values()].reduce((a, b) => a + b, 0)} declarations`)
console.log(`    sample: ${[...nsTally.keys()].slice(0, 20).join(" | ")}`)

console.log(`\nIMPORTS edges (all ${edges.filter((e) => e.type === "imports").length}) — target / outcome / decls`)
const imp = edges.filter((e) => e.type === "imports")
const impTally = new Map<string, { n: number; unres: number }>()
for (const e of imp) { const k = e.tgt; let c = impTally.get(k); if (!c) impTally.set(k, c = { n: 0, unres: 0 }); c.n++; if (e.outcome === "unresolved") c.unres++ }
for (const [k, v] of [...impTally.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 40)) console.log(`    ${String(v.n).padStart(4)} (${v.unres} unres)  ${k}`)

// BOUNDARY OF THE predefined_type CLASS: every unresolved edge whose TARGET SPELLS a built-in
// keyword, by relationship type — the ones the grammar-node test would NOT reach are named here.
console.log(`\nUNRESOLVED TARGETS SPELLING A VB BUILT-IN KEYWORD, BY RELATIONSHIP TYPE:`)
const spellBy = new Map<string, number>()
for (const e of edges) if (e.outcome === "unresolved" && PRE.has(e.tgt.toLowerCase())) spellBy.set(e.type, (spellBy.get(e.type) ?? 0) + 1)
for (const [t, n] of [...spellBy.entries()].sort((a, b) => b[1] - a[1])) console.log(`    ${String(n).padStart(6)}  ${t}`)
console.log(`  unresolved edges whose target spells a builtin AND are NOT a predefined_type references edge:`)
const stray: Edge[] = []
for (const e of edges) if (e.outcome === "unresolved" && PRE.has(e.tgt.toLowerCase()) && e.type !== "references") stray.push(e)
console.log(`    ${stray.length} edge(s)`)
for (const e of stray.slice(0, 40)) console.log(`      ${e.type} ${e.src} -> ${e.tgt}  @${path.basename(e.f)}:${e.line}  md=${JSON.stringify(e.md)}`)

// THE MEASURED BOUNDARY OF THE CLAIMED CLASS: every unresolved `references` edge whose target SPELLS a
// built-in keyword but did NOT come from a `predefined_type` node — named one by one, because "the class
// is exactly the grammar's node" is a claim that has to be checkable.
console.log(`\nUNRESOLVED references SPELLING A BUILT-IN BUT NOT A predefined_type NODE (the class boundary):`)
let bcount = 0
for (const e of edges) {
  if (e.type !== "references" || e.outcome !== "unresolved" || !PRE.has(e.tgt.toLowerCase())) continue
  bcount++
  if (bcount <= 25) console.log(`    ${e.src} -> ${e.tgt}  @${path.basename(e.f)}:${e.line}  md=${JSON.stringify(e.md)}`)
}
console.log(`    total ${bcount}`)

// SELF-TEST OF THE MECHANISM THIS LANE RELIES ON. Pure function of the imported rule, no analyzer
// involved: a `languageNamespace` claim must be decided by the LIST and not by the symbol table, so an
// edge whose target HAS a declaration in the key space must still read `externalVerified`. If this ever
// prints anything but `ok`, the claim this lane publishes is being decided by a different branch than
// the one it was chosen for.
{
  const declMap = new Map<string, number>([["String", 3]])
  const kindMap = new Map<string, Set<string>>([["String", new Set(["class"])]])
  const claim = rule.externalClaimOf({ type: "references", target: "String", metadata: { languageNamespace: ["Boolean", "String"] } })
  const cl = rule.classifyEdge(declMap, kindMap, "String", claim, undefined, false, true)
  const kindOK = claim?.kind === "namespace"
  const listOK = cl.outcome === "externalVerified" && cl.decls === 3
  const refutable = rule.classifyEdge(declMap, kindMap, "EventArgs", rule.externalClaimOf({ type: "references", target: "EventArgs", metadata: { languageNamespace: ["Boolean", "String"] } }), undefined, false, true)
  console.log(`\nSELF-TEST (claim mechanism): kind=${claim?.kind} ${kindOK ? "ok" : "FAIL"} · declared target still verified=${listOK ? "ok" : "FAIL"} · unlisted root refuted=${refutable.outcome === "externalRefuted" ? "ok" : "FAIL"} (${refutable.outcome})`)
}

console.log(`\nDECLARATIONS NAMED LIKE A VB BUILT-IN KEYWORD (the extFAIL risk of a builtin claim):`)
let risk = 0
for (const [repo, d] of projDecl) for (const [name, n] of d) if (PRE.has(name.toLowerCase())) { risk += n; console.log(`    ${repo.split(path.sep).pop()}  ${name}  x${n}`) }
console.log(`    total ${risk}`)
