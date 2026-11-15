/**
 * SOLIDITY LANE — the residual BUCKETING probe (m14, lane `solidity`).
 *
 * ## Why this file exists
 *
 * `script/m14/incoming-gate.ts` prints `unresolved 3240 · amb(decl) 11371` for this lane but only
 * a 25-name SAMPLE per type, so the residual cannot be bucketed by NAMED CONSTRUCT from its
 * output. This probe reproduces the gate's population, key space and classifier EXACTLY —
 * `classifyEdge`/`isContainsEdge`/`externalClaimOf` are IMPORTED from `script/m14/incoming-rule.ts`
 * rather than re-implemented — and cross-checks its own totals against the gate before it is
 * allowed to print a bucket.
 *
 * PARITY IS ASSERTED, NOT ASSUMED: the run prints `PARITY` (this probe's totals) beside the gate's
 * TABLE 1 columns. If they disagree the probe says so and its buckets are not to be quoted.
 *
 * Read-only over the corpus. It writes nothing.
 *
 *   bun run validation/m14/fixtures/solidity/residual-buckets.ts [maxFiles]
 */
import { execFileSync } from "node:child_process"
import { readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"
import { classifyEdge, externalClaimOf, isContainsEdge } from "../../../../script/m14/incoming-rule"
import { RESERVED_TOKENS, isReservedTarget } from "../../../../src/ast/solidity-reserved-tokens"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SIZE_CAP = 1024 * 1024
const MAX = Number(process.argv[2] ?? 400)

const ALL_TYPES = [
  "calls", "uses", "contains", "imports", "references",
  "exports", "extends", "implements", "overrides", "instantiates",
] as const
type Type = (typeof ALL_TYPES)[number]
const LABEL_ALIASES: Record<string, string> = {
  calls: "calls", call: "calls",
  uses: "uses",
  contains: "contains", composition: "contains", part_of: "contains",
  imports: "imports", brain_import: "imports",
  references: "references", depends_on: "references", related: "references",
  exports: "exports", provides: "exports",
  extends: "extends", inheritance: "extends",
  implements: "implements", implementation: "implements",
  overrides: "overrides", override: "overrides",
  instantiates: "instantiates",
}
const ontologyName = (raw: string): Type | null => (LABEL_ALIASES[raw] as Type) ?? null

/** the gate's own discovery rule, replicated for `.sol` (see incoming-gate.ts:316-416) */
function discover(maxFiles: number) {
  const found: string[] = []
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
      if (!rel.toLowerCase().endsWith(".sol")) continue
      const abs = path.join(dir, rel)
      try { if (statSync(abs).size > SIZE_CAP) continue } catch { continue }
      found.push(abs)
    }
  }
  found.sort()
  const total = found.length
  let files = found
  if (maxFiles > 0 && total > maxFiles) {
    const stride = Math.max(1, Math.floor(total / maxFiles))
    const picked: string[] = []
    for (let i = 0; i < found.length && picked.length < maxFiles; i += stride) picked.push(found[i])
    files = picked
  }
  return { files, total }
}
const repoOf = (f: string): string => {
  const rel = f.startsWith(CR) ? f.slice(CR.length + 1) : f
  return path.join(CR, rel.split(path.sep)[0])
}

const { files, total } = discover(MAX)
const projectDecl = new Map<string, Map<string, number>>()
const projectKinds = new Map<string, Map<string, Set<string>>>()
const declPos = new Map<string, { file: string; line: number }[]>()
const pooledDecl = new Map<string, number>()
const pooledKinds = new Map<string, Set<string>>()

type Pending = {
  label: Type; tgt: string; sig: string; md: Record<string, unknown>
  srcFile: string; line: number | null; repo: string; claim?: unknown
}
const pending: Pending[] = []
const reservedParamNames = new Map<string, number>()
let parsed = 0
let aliased = 0

for (const f of files) {
  const repo = repoOf(f)
  let r: any
  try { r = await parseFile(f, repo, { projectRoot: repo } as any) } catch { continue }
  if (!r) continue
  parsed++
  let pDecl = projectDecl.get(repo)
  if (!pDecl) projectDecl.set(repo, (pDecl = new Map()))
  let pKinds = projectKinds.get(repo)
  if (!pKinds) projectKinds.set(repo, (pKinds = new Map()))
  const countKey = (key: string, kind: string, file: string, line: number | null) => {
    const at = declPos.get(key)
    const pos = { file, line: line ?? -1 }
    if (!at) declPos.set(key, [pos])
    else if (!at.some((d) => d.file === file && d.line === pos.line)) at.push(pos)
    pooledDecl.set(key, (pooledDecl.get(key) ?? 0) + 1)
    let ps = pooledKinds.get(key)
    if (!ps) pooledKinds.set(key, (ps = new Set()))
    ps.add(kind)
    pDecl!.set(key, (pDecl!.get(key) ?? 0) + 1)
    let qs = pKinds!.get(key)
    if (!qs) pKinds!.set(key, (qs = new Set()))
    qs.add(kind)
  }
  for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
    const name = String(s?.name ?? "")
    if (name.length === 0) continue
    const kind = String(s?.kind ?? "")
    const line = Number((s as any)?.range?.startLine ?? (s as any)?.range?.start_line ?? (s as any)?.line_start ?? (s as any)?.lineStart ?? (s as any)?.startLine ?? (s as any)?.line ?? 0) || null
    const q = String((s as any)?.qualifiedName ?? "")
    countKey(name, kind, f, line)
    if (q.length > 0 && q !== name) { countKey(q, kind, f, line); aliased++ }
    // the reserved-token census: parameter names the symbol itself publishes
    for (const p of Array.isArray((s as any)?.parameters) ? (s as any).parameters : []) {
      const pn = String(p?.name ?? "")
      if (pn.length > 0 && RESERVED_TOKENS.has(pn)) {
        reservedParamNames.set(pn, (reservedParamNames.get(pn) ?? 0) + 1)
      }
    }
  }
  for (const rel of Array.isArray(r.relationships) ? r.relationships : []) {
    const label = ontologyName(String(rel?.type ?? ""))
    if (!label) continue
    const tgt = String(rel?.target ?? "")
    if (tgt.length === 0) continue
    const md = ((rel as any)?.metadata ?? {}) as Record<string, unknown>
    const markKeys = Object.keys(md).filter(
      (k) => k !== "evidenceClass" && k !== "analysisVersion" && md[k] !== false && md[k] != null,
    )
    markKeys.sort()
    const claim = externalClaimOf(rel)
    pending.push({
      label, tgt, md, srcFile: f, repo,
      line: Number((rel as any)?.line_number ?? 0) || null,
      sig: markKeys.length ? markKeys.join("+") : "(no marker)",
      ...(claim ? { claim } : {}),
    })
  }
}

// ── classification, through the gate's OWN classifier ────────────────────────────────────────
type Row = { edges: number; resolved: number; collRes: number; amb: number; unres: number; ext: number; cause: number; bind: number }
const rows = new Map<Type, Row>()
for (const t of ALL_TYPES) rows.set(t, { edges: 0, resolved: 0, collRes: 0, amb: 0, unres: 0, ext: 0, cause: 0, bind: 0 })

type Bucket = { type: string; sig: string; shape: string; n: number; samples: string[]; names: Map<string, number> }
const unresolvedBuckets = new Map<string, Bucket>()
const ambBuckets = new Map<string, Bucket>()
const intent = new Map<string, { intended: number; sameFileUnproven: number; arbitraryTwin: number; nothingAnywhere: number }>()
const causeKeys = new Map<string, number>()

const shapeOf = (e: Pending): string => {
  const t = e.tgt
  if (/[/\\]/.test(t) || /\.sol$/i.test(t)) return "path-like"
  if (e.md.isYulPathSegment || e.md.isYulVariableRead || e.md.isYulMemberReference) return "yul"
  if (e.md.viaObject || e.md.calleeObject) return `member-of:${String(e.md.calleeObject ?? e.md.viaObject ?? "?")}`
  if (/\./.test(t)) return "dotted"
  if (e.md.isVariableReference) return "bare-variable-ref"
  if (e.md.isMemberReference) return "bare-member-ref"
  if (t === "*") return "star"
  return "bare"
}
/** the gate's `classifyIntent` (incoming-gate.ts:584-597) */
const classifyIntent = (tgt: string, srcFile: string, line: number | null, label: string) => {
  const decls = declPos.get(tgt) ?? []
  if (!(label === "contains" || label === "exports")) {
    if (decls.length === 0) return "nothingAnywhere"
    return decls.some((d) => d.file === srcFile) ? "sameFileUnproven" : "arbitraryTwin"
  }
  if (line === null) {
    if (decls.length === 0) return "nothingAnywhere"
    return decls.some((d) => d.file === srcFile) ? "sameFileUnproven" : "arbitraryTwin"
  }
  if (decls.some((d) => d.file === srcFile && d.line === line)) return "intended"
  if (decls.length === 0) return "nothingAnywhere"
  return decls.some((d) => d.file === srcFile) ? "sameFileUnproven" : "arbitraryTwin"
}

for (const e of pending) {
  const row = rows.get(e.label)!
  row.edges++
  const isContains = isContainsEdge(e.label)
  const ownFileDeclares = (declPos.get(e.tgt) ?? []).some((d) => d.file === e.srcFile)
  const c = classifyEdge(projectDecl.get(e.repo)!, projectKinds.get(e.repo)!, e.tgt, (e as any).claim ?? null, undefined, isContains, ownFileDeclares)
  let i = intent.get(e.label)
  if (!i) intent.set(e.label, (i = { intended: 0, sameFileUnproven: 0, arbitraryTwin: 0, nothingAnywhere: 0 }))
  i[classifyIntent(e.tgt, e.srcFile, e.line, e.label)]++
  const bump = (map: Map<string, Bucket>, cat: "unres" | "amb") => {
    const key = `${e.label}\u0000${e.sig}\u0000${shapeOf(e)}`
    let b = map.get(key)
    if (!b) map.set(key, (b = { type: e.label, sig: e.sig, shape: shapeOf(e), n: 0, samples: [], names: new Map() }))
    b.n++
    b.names.set(e.tgt, (b.names.get(e.tgt) ?? 0) + 1)
    if (b.samples.length < 3) b.samples.push(`${path.relative(CR, e.srcFile)}:${e.line ?? "?"} -> ${e.tgt}`)
    void cat
  }
  switch (c.outcome) {
    case "resolved": row.resolved++; if ((c as any).boundAmongCollision) row.collRes++; break
    case "ambDeclOnly": case "ambBoth": row.amb++; bump(ambBuckets, "amb"); break
    case "externalVerified": case "externalUnverified": row.ext++; break
    case "causeDeclared": case "causeRefuted": {
      row.cause++
      causeKeys.set(String((e as any).claim?.base ?? "(unnamed)"), (causeKeys.get(String((e as any).claim?.base ?? "(unnamed)")) ?? 0) + 1)
      break
    }
    case "bindingVerified": case "bindingRefuted": case "bindingUnverified": row.bind++; break
    default: row.unres++; bump(unresolvedBuckets, "unres")
  }
}

const tot = [...rows.values()].reduce((a, r) => ({
  edges: a.edges + r.edges, resolved: a.resolved + r.resolved, collRes: a.collRes + r.collRes,
  amb: a.amb + r.amb, unres: a.unres + r.unres,
}), { edges: 0, resolved: 0, collRes: 0, amb: 0, unres: 0 })
const it = [...intent.values()].reduce((a, r) => ({
  intended: a.intended + r.intended, sameFileUnproven: a.sameFileUnproven + r.sameFileUnproven,
  arbitraryTwin: a.arbitraryTwin + r.arbitraryTwin, nothingAnywhere: a.nothingAnywhere + r.nothingAnywhere,
}), { intended: 0, sameFileUnproven: 0, arbitraryTwin: 0, nothingAnywhere: 0 })

console.log(`solidity residual-buckets — population ${parsed} parsed of ${files.length} sampled (corpus ${total} .sol; stride cap ${MAX})`)
console.log(`qualifiedName aliases indexed: ${aliased}`)
console.log(`PARITY — edges ${tot.edges} · resolved ${tot.resolved} · collRes ${tot.collRes} · amb(decl) ${tot.amb} · unresolved ${tot.unres}`)
console.log(`  (compare against the gate's TABLE 1 TOTAL row for the same cap; if these differ, do not quote the buckets)`)
console.log(`INTENT TOTAL — intended ${it.intended} · sameFileUnproven ${it.sameFileUnproven} · arbitraryTwin ${it.arbitraryTwin} · nothingAnywhere ${it.nothingAnywhere}`)
console.log(`DECLARED-CAUSE channel (baseBeyondRunScope) — ${[...causeKeys.entries()].map(([k, v]) => `${k}=${v}`).join(" ") || "none"}`)
console.log(``)
console.log(`UNRESOLVED BY NAMED CONSTRUCT — ${unresolvedBuckets.size} bucket(s), summing ${[...unresolvedBuckets.values()].reduce((a, b) => a + b.n, 0)}`)
for (const b of [...unresolvedBuckets.values()].sort((x, y) => y.n - x.n)) {
  console.log(`  ${String(b.n).padStart(5)}  ${b.type.padEnd(12)} ${b.shape.padEnd(22)} markers=${b.sig}`)
  for (const s of b.samples) console.log(`         ${s}`)
}
console.log(``)
console.log(`TOP TARGET NAMES IN THE THREE LARGEST UNRESOLVED BUCKETS`)
for (const b of [...unresolvedBuckets.values()].sort((x, y) => y.n - x.n).slice(0, 3)) {
  const top = [...b.names.entries()].sort((x, y) => y[1] - x[1]).slice(0, 15)
  console.log(`  ${b.n}  ${b.type}/${b.shape}: ${b.names.size} distinct name(s) — ${top.map(([n, c]) => `${n}(${c})`).join(" ")}`)
}
console.log(``)
console.log(`AMBIGUOUS(decl) BY NAMED CONSTRUCT — ${ambBuckets.size} bucket(s), summing ${[...ambBuckets.values()].reduce((a, b) => a + b.n, 0)}`)
for (const b of [...ambBuckets.values()].sort((x, y) => y.n - x.n).slice(0, 25)) {
  console.log(`  ${String(b.n).padStart(5)}  ${b.type.padEnd(12)} ${b.shape.padEnd(22)} markers=${b.sig}`)
  for (const s of b.samples) console.log(`         ${s}`)
}
// ── WHAT A BARE READ OF THE CONSTRUCT WOULD LOOK LIKE TO `isReservedTarget` ───────────────────
// The binding spelling is not in RESERVED_TOKENS, so a claimed read escapes `isReservedTarget`'s
// bare-`uses` drop. That means a parameter whose NAME is an EVM-opcode token (a legal Solidity
// identifier — `add`, `byte`, `gas`, `call`, `balance`) has its reads DROPPED in silence today.
// Measured here: how many parameter/return names in this population are reserved tokens.
console.log(``)
console.log(`RESERVED-TOKEN NAMES USED AS PARAMETERS OR RETURN NAMES (the silent-drop input)`)
{
  const top = [...reservedParamNames.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)
  console.log(`  distinct parameter/return names that ARE reserved tokens: ${reservedParamNames.size}`)
  console.log(`  ${top.map(([n, c]) => `${n}(${c})`).join(" ") || "(none measured)"}`)
  console.log(`  isReservedTarget("uses", <name>, {isVariableReference:true}) for the top three: ` +
    top.slice(0, 3).map(([n]) => `${n}=${isReservedTarget("uses", n, { isVariableReference: true })}`).join(" "))
  console.log(`  RESERVED_TOKENS size ${RESERVED_TOKENS.size}`)
}
console.log(``)
console.log(`PER TYPE (compare to TABLE 1)`)
for (const t of ALL_TYPES) {
  const r = rows.get(t)!
  if (r.edges === 0) continue
  const i = intent.get(t) ?? { intended: 0, sameFileUnproven: 0, arbitraryTwin: 0, nothingAnywhere: 0 }
  console.log(`  ${t.padEnd(12)} edges ${String(r.edges).padStart(6)} resolved ${String(r.resolved).padStart(6)} collRes ${String(r.collRes).padStart(5)} amb ${String(r.amb).padStart(6)} unres ${String(r.unres).padStart(5)} | intended ${i.intended} sameFile ${i.sameFileUnproven} arbTwin ${i.arbitraryTwin} nothing ${i.nothingAnywhere}`)
}
