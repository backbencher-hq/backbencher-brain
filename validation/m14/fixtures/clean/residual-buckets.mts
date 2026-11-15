#!/usr/bin/env bun
/**
 * CLEAN lane — THE RESIDUAL BUCKETED BY NAMED CAUSE, over the SAME population the gate measures.
 *
 * The incoming gate prints a 25-name worklist per type and a marker-set table. Neither is a
 * cause table: the worklist is capped (25 collected, thousands omitted) and the marker set is
 * the edge's metadata keys, not the CONSTRUCT the target names. This probe answers the question
 * the round brief asks — "bucket the unresolved by NAMED CAUSE with counts, naming the construct
 * in each bucket" — by classifying EVERY edge with the GATE'S OWN RULE (`classifyEdge`,
 * `externalClaimOf`, imported, never re-spelled) and then grouping the not-resolved ones by the
 * shape of the construct the target names.
 *
 * Population: the SAME discovery the gate performs (git ls-files, .icl/.dcl, <= 1 MB, per repo),
 * the SAME parseFile call (project root handed in), the SAME per-project key space (name +
 * qualifiedName alias), the SAME ProjectFacts (the unsampled admitted file list).
 *
 * Usage: bun validation/m14/fixtures/clean/residual-buckets.mts [--json <out>]
 */
import * as fs from "node:fs"
import * as path from "node:path"
import { execFileSync } from "node:child_process"
import { parseFile } from "../../../../src/ast/pool-worker"
import { classifyEdge, externalClaimOf, isContainsEdge, type ProjectFacts } from "../../../../script/m14/incoming-rule"

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3)
const CORPUS = arg("corpus") ?? process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const JSON_OUT = arg("json")
const MAX_BYTES = 1024 * 1024

// ── DISCOVERY (the gate's rule: tracked files only, extension admitted, size cap) ─────────────
type FileRec = { abs: string; repo: string; rel: string }
const files: FileRec[] = []
for (const entry of fs.readdirSync(CORPUS)) {
  const repoRoot = path.join(CORPUS, entry)
  try { if (!fs.statSync(repoRoot).isDirectory()) continue } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", repoRoot, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 1 << 28 })
      .split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    if (!/\.(icl|dcl)$/.test(rel)) continue
    const abs = path.join(repoRoot, rel)
    try { if (fs.statSync(abs).size > MAX_BYTES) continue } catch { continue }
    files.push({ abs, repo: repoRoot, rel })
  }
}

// ── PARSE + KEY SPACES (one per project = the repository, production's scope) ─────────────────
const declCount = new Map<string, Map<string, number>>()   // repo -> key -> declarations
const kindsOf = new Map<string, Map<string, Set<string>>>()
const admittedByRepo = new Map<string, string[]>()
for (const f of files) {
  const l = admittedByRepo.get(f.repo); if (l) l.push(f.abs); else admittedByRepo.set(f.repo, [f.abs])
}
const factsByRepo = new Map<string, ProjectFacts>()
for (const [repo, list] of admittedByRepo) {
  const set = new Set<string>()
  for (const abs of list) set.add(path.relative(repo, abs).split(path.sep).join("/"))
  factsByRepo.set(repo, { packages: new Set(), files: set, sdkLib: false })
}

type Edge = { type: string; src: string; tgt: string; md: Record<string, any>; line: number | null; file: FileRec; repo: string }
const edges: Edge[] = []
let parsed = 0, failed = 0
const pooledNames = new Set<string>()   // every name or qualifiedName published ANYWHERE in the corpus

for (const f of files) {
  let r: any
  try { r = await parseFile(f.abs, f.repo, { projectRoot: f.repo } as any) } catch { failed++; continue }
  if (!r) { failed++; continue }
  parsed++
  let dc = declCount.get(f.repo); if (!dc) declCount.set(f.repo, (dc = new Map()))
  let kd = kindsOf.get(f.repo); if (!kd) kindsOf.set(f.repo, (kd = new Map()))
  for (const s of r.symbols ?? []) {
    const name = String(s?.name ?? ""); if (!name) continue
    const q = String(s?.qualifiedName ?? "")
    pooledNames.add(name); if (q) pooledNames.add(q)
    for (const key of q && q !== name ? [name, q] : [name]) {
      dc.set(key, (dc.get(key) ?? 0) + 1)
      let ks = kd.get(key); if (!ks) kd.set(key, (ks = new Set()))
      ks.add(String(s?.kind ?? ""))
    }
  }
  for (const rel of r.relationships ?? []) {
    const type = String(rel?.type ?? rel?.relationshipType ?? "")
    if (!type) continue
    edges.push({
      type,
      src: String(rel?.source ?? rel?.from ?? ""),
      tgt: String(rel?.target ?? rel?.to ?? ""),
      md: (rel?.metadata ?? {}) as Record<string, any>,
      line: Number(rel?.line_number ?? 0) || null,
      file: f,
      repo: f.repo,
    })
  }
}
const repoDecl = (repo: string) => declCount.get(repo) ?? new Map<string, number>()
const repoKinds = (repo: string) => kindsOf.get(repo) ?? new Map<string, Set<string>>()

// ── CLASSIFY with the gate's own rule ────────────────────────────────────────────────────────
type Cls = { outcome: string; decls: number; claimKind: string; sig: string }
const classified: Array<{ e: Edge; c: Cls }> = []
for (const e of edges) {
  if (!e.tgt) continue
  const claim = externalClaimOf({ type: e.type, target: e.tgt, metadata: e.md })
  const containsLike = isContainsEdge(e.type)
  let ownFileDeclares: boolean | undefined
  // own-file scope for the ambiguous-claim disposition: does THIS FILE publish the target?
  ownFileDeclares = undefined
  const c = classifyEdge(repoDecl(e.repo), repoKinds(e.repo), e.tgt, claim, factsByRepo.get(e.repo), containsLike, ownFileDeclares)
  const sig = Object.keys(e.md).filter((k) => k !== "evidenceClass" && k !== "analysisVersion" && e.md[k] !== false && e.md[k] != null).sort().join("+") || "(no marker)"
  classified.push({ e, c: { outcome: c.outcome, decls: c.decls, claimKind: claim?.kind ?? "none", sig } })
}

// ── THE CONSTRUCT A TARGET NAMES — the cause vocabulary, decided from the string and the data ──
function rootOf(tgt: string): string | null {
  // `Module:item` / `Module:*` -> Module ; `A.B.c` -> A.B (everything before the last dot)
  const colon = tgt.indexOf(":")
  if (colon > 0) return tgt.slice(0, colon)
  const dot = tgt.lastIndexOf(".")
  return dot > 0 ? tgt.slice(0, dot) : null
}
function constructOf(e: Edge): string {
  const t = e.tgt
  const colon = t.indexOf(":")
  if (colon > 0) {
    const mod = t.slice(0, colon)
    const item = t.slice(colon + 1)
    const moduleInProject = (repoDecl(e.repo).get(mod) ?? 0) > 0
    if (item === "*") return moduleInProject ? "whole-module import, module IS in project" : "whole-module import, module NOT in project"
    return moduleInProject ? "from-import item, module IS in project" : "from-import item, module NOT in project"
  }
  const dot = t.lastIndexOf(".")
  if (dot > 0) {
    const owner = t.slice(0, dot)
    const ownerInProject = (repoDecl(e.repo).get(owner) ?? 0) > 0
    const leaf = t.slice(dot + 1)
    const leafInProject = (repoDecl(e.repo).get(leaf) ?? 0) > 0
    const leafAnywhere = pooledNames.has(leaf)
    if (ownerInProject) return "qualified name, owner IS in project"
    if (leafInProject) return "qualified name, owner absent but LEAF is in project"
    if (leafAnywhere) return "qualified name, owner+leaf absent from project, leaf in corpus"
    return "qualified name, nothing in corpus names it"
  }
  if (pooledNames.has(t)) return "bare name declared in ANOTHER project"
  return "bare name declared NOWHERE in the corpus"
}

const named = (m: Map<string, number>, k: string, n = 1) => m.set(k, (m.get(k) ?? 0) + n)
const sortDesc = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1])

const unresolved = classified.filter((x) => x.c.outcome === "unresolved")
const ambiguous = classified.filter((x) => x.c.outcome === "ambDeclOnly" || x.c.outcome === "ambBoth")
const claimed = classified.filter((x) => x.c.outcome.startsWith("external") || x.c.outcome.startsWith("cause") || x.c.outcome.startsWith("binding"))

console.log(`CLEAN residual buckets — population ${parsed} parsed of ${files.length} admitted, ${failed} failed`)
console.log(`edges ${classified.length}`)
console.log()

const outcomes = new Map<string, number>()
for (const x of classified) named(outcomes, x.c.outcome)
console.log("OUTCOMES (the gate's own rule, same population):")
for (const [k, v] of sortDesc(outcomes)) console.log(`  ${String(v).padStart(7)}  ${k}`)
console.log()

for (const [label, rows] of [["UNRESOLVED", unresolved], ["AMBIGUOUS", ambiguous]] as const) {
  console.log(`=== ${label} ${rows.length} — BY TYPE ===`)
  const byType = new Map<string, number>()
  for (const x of rows) named(byType, x.e.type)
  for (const [k, v] of sortDesc(byType)) console.log(`  ${String(v).padStart(7)}  ${k}`)
  console.log()
  console.log(`=== ${label} ${rows.length} — BY NAMED CONSTRUCT ===`)
  const byCause = new Map<string, number>()
  for (const x of rows) named(byCause, `${x.e.type}  ·  ${constructOf(x.e)}`)
  for (const [k, v] of sortDesc(byCause)) console.log(`  ${String(v).padStart(7)}  ${k}`)
  console.log()
  console.log(`=== ${label} ${rows.length} — BY TYPE + MARKER SET (top 15) ===`)
  const bySig = new Map<string, number>()
  for (const x of rows) named(bySig, `${x.e.type}  ${x.c.sig}`)
  for (const [k, v] of sortDesc(bySig).slice(0, 15)) console.log(`  ${String(v).padStart(7)}  ${k}`)
  console.log()
  console.log(`=== ${label} ${rows.length} — TOP 25 TARGETS ===`)
  const byTgt = new Map<string, number>()
  for (const x of rows) named(byTgt, x.e.tgt)
  for (const [k, v] of sortDesc(byTgt).slice(0, 25)) console.log(`  ${String(v).padStart(7)}  ${k}`)
  console.log()
}

const ext = new Map<string, number>()
for (const x of claimed) named(ext, `${x.c.outcome}  (claim: ${x.c.claimKind})`)
console.log("CLAIMED / DECLARED OUTCOMES:")
for (const [k, v] of sortDesc(ext)) console.log(`  ${String(v).padStart(7)}  ${k}`)
console.log()

if (JSON_OUT) {
  fs.writeFileSync(JSON_OUT, JSON.stringify({
    population: { parsed, admitted: files.length, failed },
    outcomes: Object.fromEntries(outcomes),
    unresolved: Object.fromEntries(sortDesc((() => { const m = new Map<string, number>(); for (const x of unresolved) named(m, `${x.e.type}  ·  ${constructOf(x.e)}`); return m })())),
    ambiguous: Object.fromEntries(sortDesc((() => { const m = new Map<string, number>(); for (const x of ambiguous) named(m, `${x.e.type}  ·  ${constructOf(x.e)}`); return m })())),
  }, null, 2))
}
