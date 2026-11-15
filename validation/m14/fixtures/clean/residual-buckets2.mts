#!/usr/bin/env bun
/**
 * CLEAN lane — RESIDUAL BUCKETS v2, with SAMPLES and with the declaration sites of a bucket.
 *
 * v1 (`residual-buckets.mts`) bucketed every edge with the GATE'S OWN RULE and reported counts.
 * This adds what a DOABILITY verdict needs:
 *   * the bare-name bucket split into declared-in-THIS-project / declared-elsewhere-in-corpus /
 *     declared-nowhere (v1's label said "ANOTHER project" for corpus-wide presence, which is
 *     wrong for an ambiguous edge: an ambiguous bare name IS declared in its own project);
 *   * a SAMPLE of (target, file:line, marker set) per bucket, so a bucket can be read and not
 *     only counted;
 *   * for the buckets whose module/owner IS in the project, WHERE that module is declared and
 *     whether any of the file claim's candidate spellings is admitted.
 *
 * Usage: bun validation/m14/fixtures/clean/residual-buckets2.mts [--json <out>] [--samples N]
 */
import * as fs from "node:fs"
import * as path from "node:path"
import { execFileSync } from "node:child_process"
import { parseFile } from "../../../../src/ast/pool-worker"
import { classifyEdge, externalClaimOf, isContainsEdge, type ProjectFacts } from "../../../../script/m14/incoming-rule"

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3)
const CORPUS = arg("corpus") ?? process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const JSON_OUT = arg("json")
const SAMPLES = Number(arg("samples") ?? "8")
const MAX_BYTES = 1024 * 1024

type FileRec = { abs: string; repo: string; rel: string }
const files: FileRec[] = []
for (const entry of fs.readdirSync(CORPUS)) {
  const repoRoot = path.join(CORPUS, entry)
  try { if (!fs.statSync(repoRoot).isDirectory()) continue } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", repoRoot, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 1 << 28 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    if (!/\.(icl|dcl)$/.test(rel)) continue
    const abs = path.join(repoRoot, rel)
    try { if (fs.statSync(abs).size > MAX_BYTES) continue } catch { continue }
    files.push({ abs, repo: repoRoot, rel })
  }
}

const declCount = new Map<string, Map<string, number>>()
const kindsOf = new Map<string, Map<string, Set<string>>>()
/** key -> the files that declare it (project-relative), for locating a bucket's declarations */
const declFiles = new Map<string, Map<string, string[]>>()
const admittedByRepo = new Map<string, string[]>()
for (const f of files) { const l = admittedByRepo.get(f.repo); if (l) l.push(f.abs); else admittedByRepo.set(f.repo, [f.abs]) }
const factsByRepo = new Map<string, ProjectFacts>()
const relByRepo = new Map<string, Set<string>>()
for (const [repo, list] of admittedByRepo) {
  const set = new Set<string>()
  for (const abs of list) set.add(path.relative(repo, abs).split(path.sep).join("/"))
  factsByRepo.set(repo, { packages: new Set(), files: set, sdkLib: false })
  relByRepo.set(repo, set)
}

type Edge = { type: string; src: string; tgt: string; md: Record<string, any>; line: number | null; file: FileRec; repo: string }
const edges: Edge[] = []
let parsed = 0, failed = 0
const pooledNames = new Set<string>()

for (const f of files) {
  let r: any
  try { r = await parseFile(f.abs, f.repo, { projectRoot: f.repo } as any) } catch { failed++; continue }
  if (!r) { failed++; continue }
  parsed++
  let dc = declCount.get(f.repo); if (!dc) declCount.set(f.repo, (dc = new Map()))
  let kd = kindsOf.get(f.repo); if (!kd) kindsOf.set(f.repo, (kd = new Map()))
  let df = declFiles.get(f.repo); if (!df) declFiles.set(f.repo, (df = new Map()))
  for (const s of r.symbols ?? []) {
    const name = String(s?.name ?? ""); if (!name) continue
    const q = String(s?.qualifiedName ?? "")
    pooledNames.add(name); if (q) pooledNames.add(q)
    for (const key of q && q !== name ? [name, q] : [name]) {
      dc.set(key, (dc.get(key) ?? 0) + 1)
      let ks = kd.get(key); if (!ks) kd.set(key, (ks = new Set()))
      ks.add(String(s?.kind ?? ""))
      let fs2 = df.get(key); if (!fs2) df.set(key, (fs2 = []))
      if (!fs2.includes(f.rel)) fs2.push(f.rel)
    }
  }
  for (const rel of r.relationships ?? []) {
    const type = String(rel?.type ?? rel?.relationshipType ?? "")
    if (!type) continue
    edges.push({
      type, src: String(rel?.source ?? rel?.from ?? ""), tgt: String(rel?.target ?? rel?.to ?? ""),
      md: (rel?.metadata ?? {}) as Record<string, any>, line: Number(rel?.line_number ?? 0) || null, file: f, repo: f.repo,
    })
  }
}
const repoDecl = (repo: string) => declCount.get(repo) ?? new Map<string, number>()
const repoKinds = (repo: string) => kindsOf.get(repo) ?? new Map<string, Set<string>>()
const repoFiles = (repo: string) => declFiles.get(repo) ?? new Map<string, string[]>()

type Cls = { outcome: string; decls: number; claimKind: string; sig: string }
const classified: Array<{ e: Edge; c: Cls }> = []
for (const e of edges) {
  if (!e.tgt) continue
  const claim = externalClaimOf({ type: e.type, target: e.tgt, metadata: e.md })
  const c = classifyEdge(repoDecl(e.repo), repoKinds(e.repo), e.tgt, claim, factsByRepo.get(e.repo), isContainsEdge(e.type), undefined)
  const sig = Object.keys(e.md).filter((k) => k !== "evidenceClass" && k !== "analysisVersion" && e.md[k] !== false && e.md[k] != null).sort().join("+") || "(no marker)"
  classified.push({ e, c: { outcome: c.outcome, decls: c.decls, claimKind: claim?.kind ?? "none", sig } })
}

function constructOf(e: Edge): string {
  const t = e.tgt
  const inProject = (k: string) => (repoDecl(e.repo).get(k) ?? 0)
  const colon = t.indexOf(":")
  if (colon > 0) {
    const mod = t.slice(0, colon), item = t.slice(colon + 1)
    const n = inProject(mod)
    const where = n > 0 ? `module declared in ${n} key(s)` : "module NOT in project"
    if (item === "*") return `imports \`Mod:*\` — ${where}`
    return `imports \`Mod:item\` — ${where}`
  }
  const dot = t.lastIndexOf(".")
  if (dot > 0) {
    const owner = t.slice(0, dot), leaf = t.slice(dot + 1)
    const o = inProject(owner), l = inProject(leaf)
    if (o > 0) return `qualified — owner IS in project (${o} decl)`
    if (l > 0) return `qualified — owner absent, LEAF is in project (${l} decl)`
    if (pooledNames.has(leaf)) return "qualified — owner+leaf absent from project, leaf in corpus"
    return "qualified — nothing in the corpus names it"
  }
  const n = inProject(t)
  if (n > 0) return `bare name — ${n} declaration(s) in THIS project`
  if (pooledNames.has(t)) return "bare name — absent from project, declared elsewhere in corpus"
  return "bare name — declared NOWHERE in the corpus"
}

const named = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1)
const sortDesc = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1])

const unresolved = classified.filter((x) => x.c.outcome === "unresolved")
const ambiguous = classified.filter((x) => x.c.outcome === "ambDeclOnly" || x.c.outcome === "ambBoth")

const outcomes = new Map<string, number>()
for (const x of classified) named(outcomes, x.c.outcome)
console.log(`CLEAN residual buckets v2 — ${parsed} parsed of ${files.length} admitted, ${failed} failed, ${classified.length} edges`)
console.log("OUTCOMES: " + sortDesc(outcomes).map(([k, v]) => `${k}=${v}`).join("  "))
console.log()

const report: Record<string, any> = { population: { parsed, admitted: files.length, failed, edges: classified.length }, outcomes: Object.fromEntries(sortDesc(outcomes)) }

for (const [label, rows] of [["UNRESOLVED", unresolved], ["AMBIGUOUS", ambiguous]] as const) {
  const byCause = new Map<string, number>()
  for (const x of rows) named(byCause, `${x.e.type}  ·  ${constructOf(x.e)}`)
  console.log(`=== ${label} ${rows.length} — BY TYPE × NAMED CONSTRUCT ===`)
  for (const [k, v] of sortDesc(byCause)) console.log(`  ${String(v).padStart(7)}  ${k}`)
  console.log()
  report[label.toLowerCase()] = Object.fromEntries(sortDesc(byCause))

  // SAMPLES per cause, with the declaration sites of the bucket's own module/owner
  console.log(`=== ${label} — SAMPLES (up to ${SAMPLES} per cause) ===`)
  const byCauseRows = new Map<string, Array<{ e: Edge; c: Cls }>>()
  for (const x of rows) { const k = `${x.e.type}  ·  ${constructOf(x.e)}`; const l = byCauseRows.get(k); if (l) l.push(x); else byCauseRows.set(k, [x]) }
  for (const [k, v] of sortDesc(byCause)) {
    const list = byCauseRows.get(k)!
    console.log(`  ── ${k}  (${v})`)
    for (const x of list.slice(0, SAMPLES)) {
      const rel = `${x.e.file.rel}:${x.e.line ?? "?"}`
      const extra = x.e.type === "imports"
        ? (() => {
            const mod = x.e.tgt.slice(0, x.e.tgt.indexOf(":") > 0 ? x.e.tgt.indexOf(":") : undefined)
            const sites = (repoFiles(x.e.repo).get(mod) ?? []).slice(0, 3)
            const cands = [`${mod.split(".").join("/")}.icl`, `${mod.split(".").join("/")}.dcl`]
            const admitted = cands.filter((c) => relByRepo.get(x.e.repo)?.has(c))
            return sites.length ? ` · decl@${sites.join(",")} · candidates=${cands.join("|")} admitted=[${admitted.join("|")}]` : " · decl@(none)"
          })()
        : ""
      console.log(`      ${rel.padEnd(52)} tgt=${JSON.stringify(x.e.tgt)}  src=${JSON.stringify(x.e.src)}  md=${x.c.sig}${extra}`)
    }
  }
  console.log()
}

console.log("AMBIGUOUS — TOP 25 (target, in-project declarations, files carrying them):")
const byTgt = new Map<string, number>()
for (const x of ambiguous) named(byTgt, x.e.tgt)
for (const [k, v] of sortDesc(byTgt).slice(0, 25)) {
  const where = [...new Set(files.filter((f) => f.rel && (repoDecl(f.repo).get(k) ?? 0) > 0).map((f) => f.rel))].slice(0, 3)
  console.log(`  ${String(v).padStart(6)}  ${k}   files=${where.join(",") || "?"}`)
}
console.log()

console.log("UNRESOLVED — TOP 25 (target, count, whether the name exists anywhere in the corpus):")
const byTgtU = new Map<string, number>()
for (const x of unresolved) named(byTgtU, x.e.tgt)
for (const [k, v] of sortDesc(byTgtU).slice(0, 25)) console.log(`  ${String(v).padStart(6)}  ${k}   inCorpus=${pooledNames.has(k)}`)

// FULL dump of the unresolved bare-name targets: the closed-list decision needs the whole
// histogram, not the top 25.
const bareUnres = new Map<string, number>()
for (const x of unresolved) {
  if (x.e.tgt.includes(".") || x.e.tgt.includes(":")) continue
  named(bareUnres, x.e.tgt)
}
console.log()
console.log(`UNRESOLVED BARE-NAME TARGETS (full histogram, ${bareUnres.size} distinct, ${[...bareUnres.values()].reduce((a, b) => a + b, 0)} edges):`)
for (const [k, v] of sortDesc(bareUnres)) console.log(`  ${String(v).padStart(5)}  ${k}  inCorpus=${pooledNames.has(k)}`)
report.bareUnresolved = Object.fromEntries(sortDesc(bareUnres))

if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(report, null, 2))
