// XML lane — `calls` 279, ENUMERATED. Clause 1 of the four-clause bar.
//
// `calls` reads 402 edges / 123 resolved / 279 ambiguous on the whole 11,562-file population, with
// `twin` 0 and `noDecl` 0 — nothing wrong-file and nothing dangling, so every one of the 279 is a
// NAME COLLISION. The bar needs each collision attributed, and 279 is small enough to name edge by
// edge. This probe builds the SAME key space the gate builds (name + qualifiedName alias, per
// repository, classification deferred until the key space is complete) and prints, for every
// ambiguous `calls` edge:
//
//   file, line, caller, callee            — the edge itself
//   declarationsInProject                 — how many declarations answer the callee name
//   declarationsInOwnFile                 — how many of them are in the edge's OWN file
//   distinctKinds                         — whether the collision is cross-kind as well
//
// THE QUESTION THAT DECIDES THE RULING: the resolver ranks the edge's OWN FILE before anything else
// (`resolveTargetStmt` / I13: declaration, same-file, same-language, id). So a collision whose own
// file declares the callee is settled by that preference; a collision whose own file does NOT
// declare it depends on the tie-break and is a genuine risk. The probe therefore splits the 279 on
// `declarationsInOwnFile > 0` — which is a measurement, not an assumption, and it is the falsifier
// the ruling needs: one edge in the second class falsifies "determinate".
//
// USAGE
//   bun validation/m14/fixtures/xml/calls-ambiguity.mts
//   BB_CA_EXTS=xml,xsd,dtd,svg,xsl,xslt,rng BB_CA_OUT=... bun ...
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { classifyEdge } from "../../../../script/m14/incoming-rule"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const EXTS = (process.env.BB_CA_EXTS ?? "xml,xsd,dtd,svg,xsl,xslt,rng").split(",").map((s) => s.trim()).filter(Boolean)
const LIMIT = Number(process.env.BB_CA_LIMIT ?? "0")
const OUT = process.env.BB_CA_OUT ?? ""

type Row = { repo: string; rel: string; abs: string }
const rows: Row[] = []
for (const name of readdirSync(CR).sort()) {
  const dir = path.join(CR, name)
  try { if (!statSync(dir).isDirectory()) continue } catch { continue }
  try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    const lower = rel.toLowerCase()
    if (!EXTS.some((e) => lower.endsWith("." + e))) continue
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > 512 * 1024) continue } catch { continue }
    let text: string
    try { text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "xml") continue
    rows.push({ repo: name, rel: rel.split(path.sep).join("/"), abs })
  }
}
const walked = LIMIT > 0 ? rows.slice(0, LIMIT) : rows

const declOf = new Map<string, Map<string, number>>()
const kindsOf = new Map<string, Map<string, Set<string>>>()
const whereOf = new Map<string, Map<string, string[]>>() // key -> ["file|line", ...]
type Edge = { repo: string; rel: string; tgt: string; src: string; line: number | null; cls: string }
const edges: Edge[] = []
let parsed = 0, failed = 0, degraded = 0

for (const f of walked) {
  let r: any
  try { r = await parseFile(f.abs, path.join(CR, f.repo), { projectRoot: path.join(CR, f.repo) } as any) } catch { failed++; continue }
  if (!r) { failed++; continue }
  parsed++
  if (r.fallback === true || r.metadata?.analysisVersion === "2.0-basic-fallback") degraded++
  if (!declOf.has(f.repo)) { declOf.set(f.repo, new Map()); kindsOf.set(f.repo, new Map()); whereOf.set(f.repo, new Map()) }
  const decl = declOf.get(f.repo)!, kinds = kindsOf.get(f.repo)!, where = whereOf.get(f.repo)!
  const countKey = (key: string, kind: string, at: string) => {
    decl.set(key, (decl.get(key) ?? 0) + 1)
    let ks = kinds.get(key); if (!ks) kinds.set(key, (ks = new Set())); ks.add(kind)
    let ws = where.get(key); if (!ws) where.set(key, (ws = [])); ws.push(at)
  }
  for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
    const name = String(s?.name ?? "")
    if (name.length === 0) continue
    const kind = String(s?.kind ?? "")
    const at = `${f.rel}|${s?.range?.start?.line ?? s?.range?.startLine ?? "?"}`
    countKey(name, kind, at)
    const q = String(s?.qualifiedName ?? "")
    if (q.length > 0 && q !== name) countKey(q, kind, at)
  }
  const templateNames = new Set((Array.isArray(r.symbols) ? r.symbols : []).filter((s: any) => String(s?.name ?? "").length > 0).map((s: any) => String(s.name)))
  for (const rel of Array.isArray(r.relationships) ? r.relationships : []) {
    const type = String(rel?.type ?? rel?.relationshipType ?? "")
    if (type !== "calls") continue
    const tgt = String(rel?.target ?? rel?.to ?? rel?.toSymbol ?? "")
    if (tgt.length === 0) continue
    const md = rel?.metadata ?? {}
    edges.push({ repo: f.repo, rel: f.rel, tgt, src: String(rel?.source ?? ""), line: rel?.line_number ?? rel?.lineNumber ?? null, cls: String(md.resolvable ?? "(none)") })
    void templateNames
  }
}

const ambiguous: any[] = []
const byClass: Record<string, number> = {}
for (const e of edges) {
  const decl = declOf.get(e.repo)!, kinds = kindsOf.get(e.repo)!, where = whereOf.get(e.repo)!
  const c = classifyEdge(decl, kinds, e.tgt, null)
  byClass[`${c.outcome}|${e.cls}`] = (byClass[`${c.outcome}|${e.cls}`] ?? 0) + 1
  if (c.outcome !== "ambDeclOnly" && c.outcome !== "ambBoth") continue
  // deduped: a symbol counted under both its name and its qualifiedName pushes its site twice,
  // and a doubled site would inflate declarationsInOwnFile — the number this ruling turns on.
  const sites = [...new Set(where.get(e.tgt) ?? [])]
  const ownFile = sites.filter((s) => s.startsWith(`${e.rel}|`))
  ambiguous.push({
    file: e.rel, line: e.line, caller: e.src, callee: e.tgt,
    analyzerClass: e.cls,
    declarationsInProject: c.decls,
    declarationsInOwnFile: ownFile.length,
    declarationSitesInOwnFile: ownFile.slice(0, 6),
    otherFileSites: sites.filter((s) => !s.startsWith(`${e.rel}|`)).slice(0, 4),
    kinds: c.kinds,
  })
}

const ownFileDeclares = ambiguous.filter((a) => a.declarationsInOwnFile > 0).length
const noOwnFileDecl = ambiguous.filter((a) => a.declarationsInOwnFile === 0)
const report = {
  instrument: "xml calls ambiguity — every ambiguous `calls` edge enumerated with the key space the gate builds",
  population: { extensions: EXTS, admitted: rows.length, walked: walked.length, parsed, failed, degraded },
  totals: { callsEdges: edges.length, ambiguous: ambiguous.length, resolvedOrOther: edges.length - ambiguous.length },
  outcomeByAnalyzerClass: byClass,
  ruling: {
    question: "does the edge's OWN FILE declare the callee? The resolver ranks own-file before anything else, so a collision the own file settles is determinate; one it does not is a genuine tie-break risk.",
    declarationsInOwnFile_gt0: ownFileDeclares,
    declarationsInOwnFile_eq0: noOwnFileDecl.length,
    falsifier: "any edge with declarationsInOwnFile === 0 falsifies 'determinate by own-file preference' — those edges are listed in full under noOwnFileDeclaration",
  },
  noOwnFileDeclaration: noOwnFileDecl,
  ambiguousEdges: ambiguous,
}
const text = JSON.stringify(report, null, 2)
if (OUT) writeFileSync(OUT, text)
console.log(JSON.stringify({ population: report.population, totals: report.totals, outcomeByAnalyzerClass: byClass, ownFileDeclares, noOwnFileDecl: noOwnFileDecl.length, sample: ambiguous.slice(0, 5) }, null, 2))
if (OUT) console.log(`full list written to ${OUT}`)
