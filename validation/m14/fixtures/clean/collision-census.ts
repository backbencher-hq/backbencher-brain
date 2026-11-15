// CLEAN COLLISION CENSUS — classify the AMBIGUOUS column by collision dimension, and name the
// UNRESOLVED column so its external class is visible.
//
// WHY. This lane's bad column is unusual: 2,310 ambiguous against 1,908 unresolved of 10,217
// edges, i.e. most of it is AMBIGUITY. The gate reports the target and the declaration COUNT but
// not WHY the declarations collide, and the reason decides the fix:
//
//   sameKindSameOwnerSameFile   a name emitted twice by one owner in one file that does NOT
//                               collide -> the FALSIFIER class. If identity were sound this class
//                               would be EMPTY. (php's `sameKind`, css's `DUP-EMISSION`.)
//   diffModule                  the same declaration name in DIFFERENT FILES of one project — the
//                               yaml lane's shape: the identity lacks the file/module, and the fix
//                               is scoping the identity, not suppressing the edge.
//   diffOwner                   the same member name under DIFFERENT owners (a method name shared
//                               by several classes) — the identity lacks the owner.
//   diffKind                    the name is shared across NAMESPACES (a class and a type, a
//                               constructor and its type) — arguably not a collision at all.
//
// The UNRESOLVED column is reported as the DISTINCT TARGETS with counts, because its class is a
// language fact (Clean's standard environment and platform libraries are not in the corpus) and a
// reader has to see the names to judge it.
//
// USAGE: bun validation/m14/fixtures/clean/collision-census.ts [corpusRoot] [maxFiles|0] [--pool]
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { getParser } from "../../../../src/ast/engine.ts"
import { classifyEdge, externalClaimOf } from "../../../../script/m14/incoming-rule.ts"

const args = process.argv.slice(2)
// DEFAULT is the gate's population: every `.icl`/`.dcl` under the corpus root, strided. An earlier
// draft defaulted to Clyde only, which produced resolved 6280 / amb 1719 / unres 1323 where the
// gate reads 5999 / 2310 / 1908 for the SAME 60 files — a difference that is purely the
// population, and exactly the class of error this census exists to avoid. `--clyde` selects the
// single repository for a lane-local reading.
const CLYDE_ONLY = args.includes("--clyde")
const WITH_DCL = args.includes("--dcl")
const positional = args.filter((a) => !a.startsWith("--"))
const ROOT = positional[0] || "/home/ishaq2321/bb_tests/repositories"
const MAX = positional[1] ? Number(positional[1]) : 60

function walk(dir: string, out: string[] = [], depth = 0): string[] {
  if (depth > 20) return out
  let ents: any[]
  try { ents = readdirSync(dir, { withFileTypes: true }) } catch { return out }
  ents.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  for (const e of ents) {
    const p = join(dir, e.name)
    if (e.isDirectory()) { if (!/node_modules|\.git/.test(e.name)) walk(p, out, depth + 1) }
    // `.icl` ONLY by default — the SAME extension set the gate is invoked with (`clean icl`).
    // Admitting `.dcl` too widens the population from 164 to 312 files and makes every number
    // incomparable with the verdict. `--dcl` adds them.
    else if (e.name.endsWith(".icl") || (WITH_DCL && e.name.endsWith(".dcl"))) { try { if (statSync(p).size <= 1_000_000) out.push(p) } catch {} }
  }
  return out
}
const repoOf = (abs: string): string => {
  const rel = relative(ROOT, abs)
  return rel.split("/").length > 1 ? rel.split("/")[0] : "_root"
}

const m: any = await import("../../../../src/ast/real-clean-analyzer.ts")
const Cls = Object.values(m).find((v: any) => typeof v === "function" && /Analyzer$/.test(v.name)) as any

// A stride sample matching the gate's own selection, so the numbers are about the same population.
let all = walk(ROOT)
if (CLYDE_ONLY) all = all.filter((f) => repoOf(f) === "Clyde")
let files = all
if (MAX > 0 && all.length > MAX) {
  const stride = all.length / MAX
  const picked: string[] = []
  for (let i = 0; i < MAX; i++) picked.push(all[Math.floor(i * stride)])
  files = [...new Set(picked)]
}

// key space: EXACTLY the gate's — name plus qualifiedName alias, per project
type Decl = { kind: string; file: string; qualifiedName?: string; ownerName?: string; range?: any }
const declsByRepo = new Map<string, Map<string, Decl[]>>()
const edges: { repo: string; type: string; target: string; meta: any }[] = []
let parsed = 0
for (const f of files) {
  let content: string
  try { content = readFileSync(f, "utf8") } catch { continue }
  const parser = await getParser("clean")
  const pr = await parser.parse(content, f)
  const res = new Cls().analyze(pr.rootNode, content, f)
  parsed++
  const repo = repoOf(f)
  const map = declsByRepo.get(repo) ?? new Map<string, Decl[]>()
  declsByRepo.set(repo, map)
  const add = (key: string, d: Decl): void => {
    const list = map.get(key) ?? []
    list.push(d)
    map.set(key, list)
  }
  for (const s of res.symbols || []) {
    if (!s?.name) continue
    const d: Decl = { kind: String(s.kind), file: relative(ROOT, f), qualifiedName: s.qualifiedName, ownerName: s.ownerName, range: s.range }
    add(s.name, d)
    if (s.qualifiedName && s.qualifiedName !== s.name) add(s.qualifiedName, d)
  }
  for (const r of res.relationships || []) {
    edges.push({ repo, type: String((r as any).type ?? (r as any).relationshipType), target: String((r as any).target ?? ""), meta: (r as any).metadata })
  }
}

// classify every edge, then bucket the AMBIGUOUS ones by collision dimension
const dims = new Map<string, { n: number; examples: Map<string, number> }>()
const dimByType = new Map<string, Map<string, number>>()
const unresNames = new Map<string, number>()
const falsifierAudit: { target: string; list: Decl[]; edges: number }[] = []
const unresByType = new Map<string, Map<string, number>>()
let amb = 0, unres = 0, resolved = 0, extOk = 0, extUnv = 0, extFail = 0

for (const e of edges) {
  const map = declsByRepo.get(e.repo) ?? new Map<string, Decl[]>()
  const count = new Map<string, number>()
  const kinds = new Map<string, Set<string>>()
  for (const [k, list] of map) { count.set(k, list.length); kinds.set(k, new Set(list.map((d) => d.kind))) }
  const c = classifyEdge(count as any, kinds as any, e.target, externalClaimOf({ metadata: e.meta }))
  if (c.outcome === "resolved") { resolved++; continue }
  if (c.outcome === "externalVerified") { extOk++; continue }
  if (c.outcome === "externalUnverified") { extUnv++; continue }
  if (c.outcome === "externalRefuted") { extFail++; continue }
  if (c.outcome === "unresolved") {
    unres++
    const per = unresByType.get(e.type) ?? new Map<string, number>()
    per.set(e.target, (per.get(e.target) || 0) + 1)
    unresByType.set(e.type, per)
    unresNames.set(e.target, (unresNames.get(e.target) || 0) + 1)
    continue
  }
  // ambiguous
  amb++
  const list = map.get(e.target) ?? []
  const owners = new Set(list.map((d) => d.ownerName ?? "(none)"))
  const kindsSet = new Set(list.map((d) => d.kind))
  const filesSet = new Set(list.map((d) => d.file))
  // THE SOUNDNESS FALSIFIER, split from the missing-discriminator case — and the split is a
  // correction to an earlier draft of THIS instrument. That draft called every same-kind
  // same-owner same-file group a duplicate identity, and its own audit refuted it: every case it
  // printed sat at a DIFFERENT source line (`[!a]` at 5:16, 60:75 and 167:172 of
  // StdOverloadedList.icl), i.e. three real declarations of an overloaded class member, not one
  // identity emitted twice. The two are different findings and only the first is a defect:
  //   trueDuplicateIdentity   same kind, owner, qname AND LINE -> identity emitted twice. This is
  //                           the class that would be EMPTY if identity were sound.
  //   overloadNoDiscriminator distinct DECLARATIONS (different lines) that share one identity key
  //                           because nothing in the key separates them — the identity lacks a
  //                           discriminator, which is a key-space gap rather than a double emit.
  const line = (d: Decl): string => String(d.range?.startLine ?? d.range?.start?.line ?? "?")
  const idWithLine = new Set(list.map((d) => `${d.kind}\u0000${d.ownerName ?? ""}\u0000${d.file}\u0000${line(d)}`))
  const trueDuplicate = idWithLine.size < list.length
  const dupIdentity = list.length !== new Set(list.map((d) => `${d.kind}\u0000${d.ownerName ?? ""}\u0000${d.qualifiedName ?? ""}`)).size
  let dim: string
  if (trueDuplicate && kindsSet.size === 1 && owners.size === 1 && filesSet.size === 1) dim = "trueDuplicateIdentity (FALSIFIER: same identity, same line)"
  else if (dupIdentity && kindsSet.size === 1 && owners.size === 1 && filesSet.size === 1) dim = "overloadNoDiscriminator (same kind+owner, DIFFERENT LINES, one identity)"
  else if (filesSet.size > 1 && owners.size <= 1 && kindsSet.size === 1) dim = "diffModule (same kind, same owner, DIFFERENT FILES)"
  else if (owners.size > 1) dim = "diffOwner (same member name under different owners)"
  else if (kindsSet.size > 1 && filesSet.size === 1) dim = "diffKind (name shared across kinds, one file)"
  else if (kindsSet.size > 1) dim = "diffKind (name shared across kinds)"
  else dim = "other"
  const d = dims.get(dim) ?? { n: 0, examples: new Map<string, number>() }
  d.n++
  d.examples.set(e.target, (d.examples.get(e.target) || 0) + 1)
  dims.set(dim, d)
  if ((dim.startsWith("trueDuplicateIdentity") || dim.startsWith("overloadNoDiscriminator")) && falsifierAudit.length < 20 && !falsifierAudit.some((x) => x.target === e.target)) {
    falsifierAudit.push({ target: e.target, list, edges: count.get(e.target) ?? list.length })
  }
  const per = dimByType.get(e.type) ?? new Map<string, number>()
  per.set(dim, (per.get(dim) || 0) + 1)
  dimByType.set(e.type, per)
}

const pad = (s: any, n: number) => String(s).padEnd(n)
const pl = (s: any, n: number) => String(s).padStart(n)
console.log(`CLEAN COLLISION CENSUS`)
console.log(`root: ${ROOT}   scope: ${CLYDE_ONLY ? "CLYDE ONLY (--clyde)" : "ALL REPOS — the gate's population"}   files: ${files.length} of ${all.length}   parsed: ${parsed}`)
console.log(`\nTABLE (per project, the gate's scope and its rule):`)
console.log(`  resolved ${resolved}   ambiguous ${amb}   unresolved ${unres}   extOK ${extOk}  ext? ${extUnv}  extFAIL ${extFail}`)
console.log(`\nAMBIGUOUS BY COLLISION DIMENSION:`)
for (const [k, v] of [...dims].sort((a, b) => b[1].n - a[1].n)) {
  console.log(`  ${pad(k, 62)}${pl(v.n, 6)}`)
  console.log(`      examples: ${[...v.examples].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([n, c]) => `${n}(${c})`).join("  ")}`)
}
// THE FALSIFIER, AUDITED. A non-empty falsifier class is a claim that the analyzer published one
// identity twice, so the declarations behind the first few cases are printed in full: kind, owner,
// qualified name and source line. Without this the class is a number nobody can check.
if (falsifierAudit.length) {
  console.log(`\nFALSIFIER AUDIT — the declarations behind the first cases (kind / owner / qname / line):`)
  for (const a of falsifierAudit.slice(0, 8)) {
    console.log(`  target ${JSON.stringify(a.target)}  (${a.list.length} declarations, edges ${a.edges}):`)
    for (const d of a.list.slice(0, 6)) {
      const rr = d.range ? `${d.range.startLine ?? d.range.start?.line ?? "?"}:${d.range.endLine ?? d.range.end?.line ?? "?"}` : "?"
      console.log(`      ${pad(d.kind, 12)} owner=${pad(d.ownerName ?? "(none)", 22)} qname=${pad(d.qualifiedName ?? "(none)", 30)} ${d.file}:${rr}`)
    }
  }
} else {
  console.log(`\nFALSIFIER AUDIT — the class is EMPTY, so identity is sound on this population.`)
}

console.log(`\nDIMENSION BY RELATIONSHIP TYPE:`)
for (const [t, per] of [...dimByType].sort((a, b) => [...b[1].values()].reduce((x, y) => x + y, 0) - [...a[1].values()].reduce((x, y) => x + y, 0))) {
  console.log(`  ${pad(t, 14)}${[...per].sort((a, b) => b[1] - a[1]).map(([d, n]) => `${d.split(" (")[0]}:${n}`).join("  ")}`)
}
console.log(`\nUNRESOLVED — DISTINCT TARGETS with counts (the external class in full):`)
for (const [t, per] of [...unresByType].sort((a, b) => [...b[1].values()].reduce((x, y) => x + y, 0) - [...a[1].values()].reduce((x, y) => x + y, 0))) {
  const rows = [...per].sort((a, b) => b[1] - a[1])
  const total = rows.reduce((x, [, n]) => x + n, 0)
  console.log(`  ${pad(t, 14)}${pl(total, 6)} edge(s), ${rows.length} distinct target(s):`)
  for (const [n, c] of rows.slice(0, 14)) console.log(`      ${pl(c, 5)}  ${n}`)
  if (rows.length > 14) console.log(`      ... and ${rows.length - 14} more`)
}
