// MAKE'S UNRESOLVED COLUMN, BUCKETED BY NAMED CAUSE — over the gate's OWN population and rule.
//
// Why this exists: `incoming-gate.ts make mk,mak,makefile 400` prints ONE unresolved total (and a
// 25-name-capped worklist), so the lane cannot act on it. This probe reproduces the gate's
// discovery, its parse call and its classification rule (imported, never re-spelled), then splits
// the unresolved set by the analyzer's OWN metadata (`role`, `evidenceClass`, `isBuiltin`) AND by
// target SHAPE, which is the axis the gate's claim kinds act on.
//
// It must print the gate's own line — `REPLICA ... == GATE` — or the bucketing below is about a
// different population and says nothing. If the two disagree the probe says so.
//
// It also runs COUNTERFACTUALS: re-classifies the same edges with a candidate claim attached, so a
// fix can be priced (resolved / extOK / ext? / extFAIL) before a line of the analyzer changes.
//
// Usage: bun validation/m14/fixtures/make/tools/unresolved-cause-split.mts [maxFiles] [--repo=NAME]
import { execFileSync } from "node:child_process"
import { statSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../../src/ast/pool-worker"
import { detectLanguageFromPath } from "../../../../../src/ast/language-detection"
import {
  classifyEdge, externalClaimOf, tally, emptyOutcomes, isContainsEdge,
  pathLikeTarget, namespaceMatchOf, type ProjectFacts, type ExternalClaim,
} from "../../../../../script/m14/incoming-rule"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const MAX = Number(process.argv[2] || 400)
const REPO = (process.argv.find((a) => a.startsWith("--repo=")) ?? "").slice("--repo=".length)
const SIZE_CAP = 1024 * 1024
const LANE = "make"
const EXTS = ["mk", "mak", "makefile"]

// ── discovery: incoming-gate.ts discoverFiles, clause for clause ──────────────────────────────
const admitByExtension = (rel: string, exts: string[], lang: string): boolean => {
  const low = rel.toLowerCase()
  const base = low.slice(low.lastIndexOf("/") + 1)
  if (exts.some((e) => low.endsWith(`.${e}`))) return true
  return exts.some((e) => base === e) && detectLanguageFromPath(rel) === lang
}
const found: string[] = []
let absent = 0
let overCap = 0
for (const name of execFileSync("ls", [CR], { encoding: "utf8" }).split("\n").filter(Boolean).sort()) {
  if (REPO && name !== REPO) continue
  const dir = path.join(CR, name)
  try { if (!statSync(dir).isDirectory()) continue } catch { continue }
  try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512e6 }).split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    if (!admitByExtension(rel, EXTS, LANE)) continue
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > SIZE_CAP) { overCap++; continue } } catch { absent++; continue }
    found.push(abs)
  }
}
found.sort()
const admitted = found.slice()
let files = found
if (MAX > 0 && found.length > MAX) {
  const stride = Math.max(1, Math.floor(found.length / MAX))
  const picked: string[] = []
  for (let i = 0; i < found.length && picked.length < MAX; i += stride) picked.push(found[i])
  files = picked
}
const repoOf = (f: string) => path.join(CR, f.slice(CR.length + 1).split(path.sep)[0])
console.error(`discovery: ${files.length} of ${found.length} admitted (${absent} absent, ${overCap} over cap)${REPO ? ` --repo=${REPO}` : " (stride)"}`)

// facts per repo, exactly as the gate builds them (projectFactsForFiles: the lane's OWN admitted files)
const admittedByRepo = new Map<string, string[]>()
for (const f of admitted) {
  const r = repoOf(f)
  const l = admittedByRepo.get(r)
  if (l) l.push(f); else admittedByRepo.set(r, [f])
}
const facts = new Map<string, ProjectFacts>()
for (const [r, list] of admittedByRepo) {
  const set = new Set<string>()
  for (const abs of list) {
    const rel = path.relative(r, abs)
    if (rel.length > 0) set.add(rel.split(path.sep).join("/"))
  }
  facts.set(r, { packages: new Set<string>(), files: set, sdkLib: false })
}

// ── walk: same parse call the gate makes ──────────────────────────────────────────────────────
type Pending = {
  label: string; tgt: string; claim: ExternalClaim | null
  repo: string; srcFile: string; line: number | null
  role: string; ev: string; isBuiltin: boolean; via: string; md: Record<string, unknown>
}
const pending: Pending[] = []
const projectDecl = new Map<string, Map<string, number>>()
const projectKinds = new Map<string, Map<string, Set<string>>>()
const declPos = new Map<string, { file: string; line: number }[]>()
let parsed = 0
let failed = 0

const bump = (repo: string, key: string, kind: string, file: string, line: number | null) => {
  let d = projectDecl.get(repo); if (!d) projectDecl.set(repo, (d = new Map()))
  let k = projectKinds.get(repo); if (!k) projectKinds.set(repo, (k = new Map()))
  d.set(key, (d.get(key) ?? 0) + 1)
  let s = k.get(key); if (!s) k.set(key, (s = new Set())); s.add(kind)
  const at = declPos.get(key)
  const pos = { file, line: line ?? -1 }
  if (!at) declPos.set(key, [pos]); else if (!at.some((x) => x.file === file && x.line === pos.line)) at.push(pos)
}

for (const f of files) {
  let r: any
  try { r = await parseFile(f, repoOf(f), { projectRoot: repoOf(f) } as any) } catch { failed++; continue }
  if (!r) { failed++; continue }
  parsed++
  const repo = repoOf(f)
  for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
    const n = String(s?.name ?? "")
    if (!n) continue
    // THE GATE'S OWN LINE READ, fallback chain included (`incoming-gate.ts` countKey's `symLine`):
    // `parseFile` normalises `range` AWAY and publishes flat `startLine`, which this probe read as
    // `range.startLine` on its first run — so every declaration position was null and the exact
    // intent test read `intended 0` against the gate's 7,480 while every other column matched.
    const symLine = Number((s as any)?.range?.startLine ?? (s as any)?.range?.start_line ?? (s as any)?.line_start
      ?? (s as any)?.lineStart ?? (s as any)?.startLine ?? (s as any)?.line ?? 0) || null
    bump(repo, n, String(s?.kind ?? ""), f, symLine)
    const q = String(s?.qualifiedName ?? "")
    if (q && q !== n) bump(repo, q, String(s?.kind ?? ""), f, symLine)
  }
  for (const rel of Array.isArray(r.relationships) ? r.relationships : []) {
    const label = String(rel?.type ?? rel?.relationshipType ?? "")
    const tgt = String(rel?.target ?? "")
    if (!label || !tgt) continue
    const md = (rel as any)?.metadata ?? {}
    pending.push({
      label, tgt, claim: externalClaimOf(rel), repo, srcFile: f,
      line: Number((rel as any)?.line_number ?? (rel as any)?.lineNumber ?? (rel as any)?.line ?? 0) || null,
      role: String(md.role ?? ""), ev: String(md.evidenceClass ?? ""),
      isBuiltin: md.isBuiltin === true, via: String(md.via ?? ""), md,
    })
  }
}

// ── classify: the gate's rule, with the gate's facts ──────────────────────────────────────────
const projectTotals = emptyOutcomes()
const pooledDecl = new Map<string, number>()
const pooledKinds = new Map<string, Map<string, Set<string>>>()
{
  for (const [, d] of projectDecl) for (const [k, n] of d) pooledDecl.set(k, (pooledDecl.get(k) ?? 0) + n)
}
for (const [, k] of projectKinds) for (const [key, s] of k) {
  let ps = pooledKinds.get(key); if (!ps) pooledKinds.set(key, (ps = new Set()))
  for (const v of s) ps.add(v)
}
const outcomeOf = (e: Pending, claim = e.claim) =>
  classifyEdge(projectDecl.get(e.repo)!, projectKinds.get(e.repo)!, e.tgt, claim, facts.get(e.repo),
    isContainsEdge(e.label), (declPos.get(e.tgt) ?? []).some((d) => d.file === e.srcFile))

const perType = new Map<string, { edges: number; resolved: number; amb: number; unres: number; extOK: number; extQ: number; extFAIL: number; cause: number }>()
let collRes = 0
const unresolved: { e: Pending; scope: string }[] = []
const intent = { intended: 0, sameFileUnproven: 0, arbitraryTwin: 0, nothingAnywhere: 0 }
for (const e of pending) {
  const row = perType.get(e.label) ?? { edges: 0, resolved: 0, amb: 0, unres: 0, extOK: 0, extQ: 0, extFAIL: 0, cause: 0 }
  perType.set(e.label, row)
  row.edges++
  const c = outcomeOf(e)
  tally(projectTotals, c, e.tgt, e.label)
  switch (c.outcome) {
    case "resolved": row.resolved++; if (c.boundAmongCollision) collRes++; break
    case "ambDeclOnly": case "ambBoth": row.amb++; break
    case "externalVerified": row.extOK++; break
    case "externalUnverified": row.extQ++; break
    case "externalRefuted": row.extFAIL++; break
    case "causeDeclared": case "causeRefuted": row.cause++; break
    default: row.unres++
  }
  if (c.outcome === "unresolved") {
    const d = declPos.get(e.tgt)
    const scope = !d || d.length === 0 ? "nothing-anywhere-in-capped-project" : "in-corpus-exact-sample-miss"
    unresolved.push({ e, scope })
  }
  const decls = declPos.get(e.tgt)
  if (!decls || decls.length === 0) intent.nothingAnywhere++
  else {
    const same = decls.filter((d) => d.file === e.srcFile)
    if (same.length === 0) intent.arbitraryTwin++
    else if ((e.label === "contains" || e.label === "exports") && e.line !== null && same.some((d) => d.line === e.line)) intent.intended++
    else intent.sameFileUnproven++
  }
}
void outcomeOf

console.log(`REPLICA: files ${parsed} of ${files.length} (${failed} failed) · edges ${pending.length} · resolved ${projectTotals.resolved} · collRes ${collRes} · amb(decl) ${projectTotals.ambiguousByDecl} · amb(kind) ${projectTotals.ambiguousByKind} · unresolved ${projectTotals.unresolved} · extOK ${projectTotals.externalVerified} · ext? ${projectTotals.externalUnverified} · extFAIL ${projectTotals.externalRefuted} · causeOK ${projectTotals.causeDeclared} · causeFAIL ${projectTotals.causeRefuted}`)
const GATE = process.env.MAKE_GATE_LINE // optional: "edges,resolved,collRes,amb,unres"
console.log(`BINDING INTENT: intended ${intent.intended} · sameFileUnproven ${intent.sameFileUnproven} · arbitraryTwin ${intent.arbitraryTwin} · nothingAnywhere ${intent.nothingAnywhere}`)
console.log(`\nBY TYPE (edges / resolved / amb / unresolved / extOK / ext? / extFAIL):`)
for (const [t, r] of [...perType].sort((a, b) => b[1].unres - a[1].unres)) {
  console.log(`  ${t.padEnd(12)} ${String(r.edges).padStart(6)} / ${String(r.resolved).padStart(6)} / ${String(r.amb).padStart(5)} / ${String(r.unres).padStart(5)} / ${String(r.extOK).padStart(4)} / ${String(r.extQ).padStart(4)} / ${String(r.extFAIL).padStart(4)}`)
}

// ── the buckets: NAMED CONSTRUCT = (type, role, evidenceClass, shape) ─────────────────────────
const shape = (t: string) => pathLikeTarget(t) ? "path-like" : /[\s{}`<>"']/.test(t) ? "expression-text" : t.startsWith("$") ? "raw-expression" : "bare-identifier"
const keyOf = (e: Pending) => `${e.label} · role=${e.role || "(none)"} · evidenceClass=${e.ev || "(none)"}${e.isBuiltin ? " · isBuiltin" : ""} · ${shape(e.tgt)}`
const byCause = new Map<string, { n: number; scope: Map<string, number>; samples: Pending[] }>()
for (const u of unresolved) {
  const k = keyOf(u.e)
  let b = byCause.get(k)
  if (!b) byCause.set(k, (b = { n: 0, scope: new Map(), samples: [] }))
  b.n++
  b.scope.set(u.scope, (b.scope.get(u.scope) ?? 0) + 1)
  if (b.samples.length < 4) b.samples.push(u.e)
}
console.log(`\nUNRESOLVED ${unresolved.length} BY NAMED CONSTRUCT:`)
let acc = 0
for (const [k, b] of [...byCause].sort((a, b) => b[1].n - a[1].n)) {
  acc += b.n
  const scopes = [...b.scope].map(([s, n]) => `${s} ${n}`).join(" · ")
  console.log(`  ${String(b.n).padStart(5)}  (${((b.n / unresolved.length) * 100).toFixed(1)}%)  ${k}`)
  console.log(`         scope: ${scopes} · e.g. ${b.samples.map((s) => JSON.stringify(s.tgt)).join(" ")}`)
  console.log(`         at: ${[...new Set(b.samples.map((s) => path.relative(CR, s.srcFile)))].slice(0, 2).join("  ")}`)
}
console.log(`  ---- bucket sum ${acc} of ${unresolved.length}`)

// ── shape census of the unresolved set (the axis a claim kind can act on) ─────────────────────
const byShape = new Map<string, number>()
for (const u of unresolved) byShape.set(shape(u.e.tgt), (byShape.get(shape(u.e.tgt)) ?? 0) + 1)
console.log(`\nUNRESOLVED BY TARGET SHAPE: ${[...byShape].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(" · ")}`)

// ── the DISTINCT spellings each tier emits, so a closed list is enumerated not remembered ─────
for (const tier of ["builtin", "automatic"]) {
  const names = new Map<string, number>()
  for (const e of pending) {
    if (e.ev !== tier && e.role !== "automatic_variable") continue
    if (e.ev !== tier) continue
    names.set(e.tgt, (names.get(e.tgt) ?? 0) + 1)
  }
  console.log(`\nDISTINCT TARGETS, evidenceClass=${tier} (${names.size}): ${[...names].sort().map(([n, c]) => `${n}×${c}`).join(" ")}`)
}
{
  const names = new Map<string, number>()
  for (const e of pending) if (e.role === "automatic_variable") names.set(e.tgt, (names.get(e.tgt) ?? 0) + 1)
  console.log(`DISTINCT TARGETS, role=automatic_variable (${names.size}): ${[...names].sort().map(([n, c]) => `${n}×${c}`).join(" ")}`)
}

// ── the CLAIM CENSUS: what the analyzer actually attached, by named construct ─────────────────
{
  const byKind = new Map<string, number>()
  const byConstruct = new Map<string, { n: number; samples: string[] }>()
  const byOutcome = new Map<string, number>()
  for (const e of pending) {
    if (!e.claim) continue
    byKind.set(e.claim.kind, (byKind.get(e.claim.kind) ?? 0) + 1)
    const k = `${e.claim.kind} · ${e.label} · role=${e.role || "(none)"} · ev=${e.ev || "(none)"}`
    const b = byConstruct.get(k) ?? { n: 0, samples: [] }
    byConstruct.set(k, b)
    b.n++
    if (b.samples.length < 3) b.samples.push(JSON.stringify(e.tgt))
    const o = outcomeOf(e).outcome
    byOutcome.set(`${e.claim.kind} -> ${o}`, (byOutcome.get(`${e.claim.kind} -> ${o}`) ?? 0) + 1)
  }
  console.log(`\nCLAIMS PRESENT ON THE EDGES: ${[...byKind].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(" · ") || "(none)"}`)
  for (const [k, b] of [...byConstruct].sort((a, b) => b[1].n - a[1].n)) console.log(`  ${String(b.n).padStart(5)}  ${k}  e.g. ${b.samples.join(" ")}`)
  console.log(`  claims by OUTCOME: ${[...byOutcome].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(" · ")}`)
}

// ── COUNTERFACTUALS: price a candidate claim before touching the analyzer ─────────────────────
// A = the NAMESPACE claim on edges the analyzer already marks isBuiltin (roots = the target itself,
//     which is what a BUILTIN_VARIABLES list membership check produces).
// B = the generic OWNER claim on bare identifiers with no claim at all.
// C = THE PROPOSED RULE, exactly: a namespace claim for the two tiers the analyzer already labels
//     from a CLOSED language list (builtin / automatic), an `owner` marker for the two tiers the
//     analyzer already labels `external`, and NOTHING for every other tier.
const bareName = (t: string): boolean => {
  if (t.length === 0) return false
  const c0 = t.charCodeAt(0)
  if (!((c0 >= 65 && c0 <= 90) || (c0 >= 97 && c0 <= 122) || c0 === 95)) return false
  for (let i = 1; i < t.length; i++) {
    const c = t.charCodeAt(i)
    if (!((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95)) return false
  }
  return true
}
type Cf = { name: string; pick: (e: Pending) => ExternalClaim | null }
// GNU MAKE'S AUTOMATIC VARIABLES, the documented closed set, spelled as the analyzer emits them
// (the `$` is part of the target). A spelling the grammar truncated (`$(@:/`, `$(@:bin/%=%`) is NOT
// in it, so an edge carrying one stays unresolved instead of being excused by a list that would
// have to grow a malformed member to cover it.
const GNU_AUTOMATIC = new Set([
  "$@", "$%", "$<", "$?", "$^", "$+", "$*", "$|",
  "$(@D)", "$(@F)", "$(%D)", "$(%F)", "$(<D)", "$(<F)", "$(?D)", "$(?F)",
  "$(^D)", "$(^F)", "$(+D)", "$(+F)", "$(*D)", "$(*F)", "$(|D)", "$(|F)",
])
const nsc = (e: Pending): ExternalClaim | null =>
  (e.ev === "builtin" || (e.ev === "automatic" && GNU_AUTOMATIC.has(e.tgt))) ? { kind: "namespace", roots: [e.tgt] } : null
const own = (e: Pending): ExternalClaim | null =>
  (e.claim === null && e.ev === "external" && bareName(e.tgt)) ? { kind: "owner" } : null
const proposed = (e: Pending): ExternalClaim | null => (e.claim !== null ? null : nsc(e) ?? own(e))
for (const cf of [{ name: "A namespace on isBuiltin", pick: nsc }, { name: "B owner on bare identifiers", pick: own },
  { name: "C PROPOSED (closed-list namespace + owner on external tiers)", pick: proposed }] as Cf[]) {
  const t = emptyOutcomes()
  let moved = 0
  let lostResolved = 0
  const moves = new Map<string, number>()
  const refuted: string[] = []
  for (const e of pending) {
    const base = outcomeOf(e)
    const c = outcomeOf(e, cf.pick(e) ?? e.claim)
    tally(t, c, e.tgt, e.label)
    if (base.outcome !== c.outcome) {
      moved++
      const k = `${base.outcome} -> ${c.outcome}`
      moves.set(k, (moves.get(k) ?? 0) + 1)
    }
    if (base.outcome === "resolved" && c.outcome !== "resolved") lostResolved++
    if (c.outcome === "externalRefuted") refuted.push(`${e.label} ${JSON.stringify(e.tgt)} (${e.ev || e.role}) @ ${path.relative(CR, e.srcFile)}`)
  }
  console.log(`\nCOUNTERFACTUAL ${cf.name}: edges moved ${moved} · resolved-LEFT ${lostResolved}`)
  console.log(`  resolved ${t.resolved} · amb(decl) ${t.ambiguousByDecl} · unresolved ${t.unresolved} · extOK ${t.externalVerified} · ext? ${t.externalUnverified} · extFAIL ${t.externalRefuted} · causeOK ${t.causeDeclared} · causeFAIL ${t.causeRefuted} · bindOK ${t.bindingVerified}`)
  console.log(`  moves: ${[...moves].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(" · ")}`)
  if (refuted.length) console.log(`  REFUTED (${refuted.length}): ${refuted.slice(0, 8).join(" | ")}${refuted.length > 8 ? " …" : ""}`)
  // WHAT THE RULE ACTUALLY TOUCHES, by named construct — so the claim is auditable per bucket.
  const claimed = new Map<string, number>()
  for (const e of pending) {
    if (cf.pick(e) === null) continue
    const k = `${cf.pick(e)!.kind} · ${e.label} · role=${e.role || "(none)"} · ev=${e.ev || "(none)"}`
    claimed.set(k, (claimed.get(k) ?? 0) + 1)
  }
  if (claimed.size) console.log(`  claim attached by construct: ${[...claimed].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(" | ")}`)
}
if (GATE) console.log(`\nGATE LINE FOR COMPARISON: ${GATE}`)
