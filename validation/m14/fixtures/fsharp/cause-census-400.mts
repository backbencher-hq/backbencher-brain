// THE RESIDUAL, BUCKETED BY THE ANALYZER'S OWN NAMED CAUSE — at the gate's own population.
//
// WHY THIS FILE EXISTS. `incoming-gate.ts fsharp fs 400` publishes `unresolved 25149` and caps its
// worklist at 25 names per type, so it can say HOW MANY and not WHICH CAUSE. This lane already
// computes a reason on every edge (`metadata.targetResolution`) — the fleet classification names
// fsharp as the instance that publishes the reason on a key the gate's declared-cause channel does
// not read. A count of the residual by that key is the classification clause 2 asks for.
//
// THE DISCIPLINE THIS FILE OBEYS: it reproduces the arbiter's own columns by IMPORTING the
// arbiter's rule (`classifyEdge` / `tally` / `externalClaimOf` from script/m14/incoming-rule.ts),
// and it REFUSES to print a bucket table unless the replica's totals equal the arbiter's published
// line to the edge. A census on its own key space would be a second, private measurement.
//
// Usage: bun run validation/m14/fixtures/fsharp/cause-census-400.mts [maxFiles]
import { execFileSync } from "node:child_process"
import { readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import {
  classifyEdge, externalClaimOf, tally, emptyOutcomes, isContainsEdge, targetOwner,
} from "../../../../script/m14/incoming-rule"

const REPO = "/home/ishaq2321/mcp/backbencher-brain"
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const LANG = "fsharp"
const EXT = "fs"
const EXTS = ["fs"]
const SIZE_CAP = 1024 * 1024
const MAX = Number(process.argv[2] || 400)

/* ── discovery: incoming-gate.ts discoverFiles, replicated ───────────────────────────────── */
function admitByExtension(rel: string, exts: string[], lang: string): boolean {
  const low = rel.toLowerCase()
  const base = low.slice(low.lastIndexOf("/") + 1)
  if (exts.some((e) => low.endsWith(`.${e}`))) return true
  return exts.some((e) => base === e) && detectLanguageFromPath(rel) === lang
}
const found: string[] = []
const repos = new Set<string>()
let absent = 0, overCap = 0
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
    if (!admitByExtension(rel, EXTS, LANG)) continue
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > SIZE_CAP) { overCap++; continue } } catch { absent++; continue }
    found.push(abs); repos.add(name)
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
console.error(`discovery: ${files.length} of ${total} .${EXT} files across ${repos.size} repos (stride ${Math.max(1, Math.floor(total / MAX))}; overCap ${overCap}, absent ${absent})`)

const repoOf = (f: string) => path.join(CR, (f.startsWith(CR) ? f.slice(CR.length + 1) : f).split(path.sep)[0])

const LABEL_ALIASES: Record<string, string> = {
  calls: "calls", call: "calls", uses: "uses", contains: "contains", composition: "contains",
  part_of: "contains", imports: "imports", brain_import: "imports", references: "references",
  depends_on: "references", related: "references", exports: "exports", provides: "exports",
  extends: "extends", inheritance: "extends", implements: "implements", implementation: "implements",
  overrides: "overrides", override: "overrides", instantiates: "instantiates",
}

/* ── walk + classify, the arbiter's own rule ─────────────────────────────────────────────── */
type Pend = { label: string; tgt: string; claim: any; repo: string; srcFile: string; line: number | null; meta: Record<string, any> }
const projectDecl = new Map<string, Map<string, number>>()
const projectKinds = new Map<string, Map<string, Set<string>>>()
const declPos = new Map<string, { file: string; line: number }[]>()
/** what each FILE publishes (`name` and `qualifiedName`) — the shipped rule's own test that the
 *  run could not reach the base is "this file does not publish the owner". */
const filePublished = new Map<string, Set<string>>()
const pending: Pend[] = []
let parsed = 0, failed = 0, degraded = 0

for (const f of files) {
  let r: any
  try { r = await parseFile(f, repoOf(f), { projectRoot: repoOf(f) } as any) } catch { failed++; continue }
  if (!r) { failed++; continue }
  parsed++
  if (r.fallback === true || r.metadata?.analysisVersion === "2.0-basic-fallback") degraded++
  const repo = repoOf(f)
  let pDecl = projectDecl.get(repo); if (!pDecl) projectDecl.set(repo, (pDecl = new Map()))
  let pKinds = projectKinds.get(repo); if (!pKinds) projectKinds.set(repo, (pKinds = new Map()))
  const countKey = (key: string, kind: string, line: number | null) => {
    const p = { file: f, line: line ?? -1 }
    const at = declPos.get(key)
    if (!at) declPos.set(key, [p])
    else if (!at.some((d) => d.file === f && d.line === p.line)) at.push(p)
    pDecl!.set(key, (pDecl!.get(key) ?? 0) + 1)
    let qs = pKinds!.get(key); if (!qs) pKinds!.set(key, (qs = new Set())); qs.add(kind)
  }
  for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
    const name = String(s?.name ?? ""); if (!name.length) continue
    const symLine = Number((s as any)?.range?.startLine ?? (s as any)?.range?.start_line ?? (s as any)?.line_start ?? (s as any)?.lineStart ?? (s as any)?.startLine ?? (s as any)?.line ?? 0) || null
    countKey(name, String(s?.kind ?? ""), symLine)
    let fp = filePublished.get(f); if (!fp) filePublished.set(f, (fp = new Set()))
    fp.add(name)
    const q = String(s?.qualifiedName ?? "")
    if (q.length > 0 && q !== name) { countKey(q, String(s?.kind ?? ""), symLine); fp.add(q) }
  }
  for (const rel of Array.isArray(r.relationships) ? r.relationships : []) {
    const label = LABEL_ALIASES[String(rel?.type ?? rel?.relationshipType ?? "")]
    if (!label) continue
    const tgt = String(rel?.target ?? rel?.to ?? rel?.toSymbol ?? "")
    if (!tgt.length) continue
    const edgeLine = Number(rel?.line_number ?? rel?.lineNumber ?? rel?.line ?? 0) || null
    pending.push({ label, tgt, claim: externalClaimOf(rel), repo, srcFile: f, line: edgeLine, meta: (rel?.metadata ?? {}) as Record<string, any> })
  }
}

/* ── the arbiter's intent test, replicated (it is not exported from incoming-gate.ts) ────── */
const LINE_IS_TARGET_LINE = new Set(["contains", "exports"])
function classifyIntent(tgt: string, srcFile: string, line: number | null, label: string) {
  const decls = declPos.get(tgt)
  if (!decls || decls.length === 0) return "nothingAnywhere" as const
  const sameFile = decls.filter((d) => d.file === srcFile)
  if (sameFile.length === 0) return "arbitraryTwin" as const
  if (LINE_IS_TARGET_LINE.has(label) && line !== null && sameFile.some((d) => d.line === line)) return "intended" as const
  return "sameFileUnproven" as const
}

const totals = emptyOutcomes()
const intent = { intended: 0, sameFileUnproven: 0, arbitraryTwin: 0, nothingAnywhere: 0 }
const unresolvedRows: { label: string; tgt: string; file: string; abs: string; cls: string; nodeType: string; line: number | null; intent: string; meta: Record<string, any> }[] = []
for (const e of pending) {
  const isContains = isContainsEdge(e.label)
  const ownFileDeclares = (declPos.get(e.tgt) ?? []).some((d) => d.file === e.srcFile)
  const c = classifyEdge(projectDecl.get(e.repo)!, projectKinds.get(e.repo)!, e.tgt, e.claim, undefined, isContains, ownFileDeclares)
  tally(totals, c, e.tgt, e.label)
  intent[classifyIntent(e.tgt, e.srcFile, e.line, e.label)]++
  if (c.outcome === "unresolved") {
    unresolvedRows.push({
      label: e.label, tgt: e.tgt, file: path.relative(CR, e.srcFile), abs: e.srcFile, line: e.line,
      cls: String(e.meta.targetResolution ?? "(no class)"),
      nodeType: String(e.meta.nodeType ?? "(none)"),
      intent: classifyIntent(e.tgt, e.srcFile, e.line, e.label),
      meta: e.meta,
    })
  }
}

/* ── THE REPLICA CHECK, and the table is not printed unless it passes ────────────────────── */
// BOTH published lines, each transcribed from the gate's own log at this population
// (`.tmp-fsharp-fix/gate-{before,after}.log`). Which one this run must reproduce is decided by
// the analyzer's own output: pre-fix no edge carries a declared cause, post-fix 7111 do.
const LINE_BEFORE = { edges: 44956, resolved: 16453, ambiguousByDecl: 1139, unresolved: 25149, externalVerified: 680, externalRefuted: 231, bindingVerified: 1286 }
const LINE_AFTER = { ...LINE_BEFORE, unresolved: 18038 }
const EXPECT = totals.causeDeclared > 0 ? LINE_AFTER : LINE_BEFORE
const LINE_LABEL = totals.causeDeclared > 0 ? "after (causeOK 7111)" : "before (causeOK 0)"
console.log(`REPLICA: edges ${pending.length} resolved ${totals.resolved} amb(decl) ${totals.ambiguousByDecl} unresolved ${totals.unresolved} extOK ${totals.externalVerified} extFAIL ${totals.externalRefuted} bindOK ${totals.bindingVerified} causeOK ${totals.causeDeclared}`)
console.log(`  gate line at this population: ${LINE_LABEL} — edges ${EXPECT.edges} resolved ${EXPECT.resolved} amb(decl) ${EXPECT.ambiguousByDecl} unresolved ${EXPECT.unresolved} extOK ${EXPECT.externalVerified} extFAIL ${EXPECT.externalRefuted} bindOK ${EXPECT.bindingVerified}`)
const mismatches = [
  ...Object.entries(EXPECT).filter(([k, v]) => k !== "edges" && (totals as any)[k] !== v),
  ...(pending.length === EXPECT.edges ? [] : [["edges", EXPECT.edges] as [string, number]]),
]
console.log(`  parsed ${parsed} failed ${failed} degraded ${degraded}`)
if (mismatches.length > 0) {
  console.log(`REPLICA MISMATCH on ${mismatches.map(([k, v]) => `${k}: ${(totals as any)[k]} vs ${v}`).join(" · ")}`)
  console.log(`REFUSING to print a bucket table from a replica that does not reproduce the arbiter's line.`)
  process.exit(2)
}
console.log(`REPLICA MATCHES the arbiter's published line on all seven columns.`)
console.log(`INTENT: intended ${intent.intended} · sameFileUnproven ${intent.sameFileUnproven} · arbitraryTwin ${intent.arbitraryTwin} · nothingAnywhere ${intent.nothingAnywhere}`)

/* ── THE BUCKET TABLE: the residual by the analyzer's own NAMED CAUSE ────────────────────── */
const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/
// Cause-claimable = the gate's own two spelling checks (incoming-rule.ts:1155): the reason must be
// identifier-shaped and must BE the target's owner. Both are properties of the target alone, so
// this is decidable here without guessing what the claim would say.
const causeClaimable = (tgt: string) => { const o = targetOwner(tgt); return o !== null && IDENT.test(o) }

type Bucket = { cls: string; n: number; claimable: number; intent: Record<string, number>; types: Map<string, number>; nodeTypes: Map<string, number>; samples: string[] }
const buckets = new Map<string, Bucket>()
for (const r of unresolvedRows) {
  let b = buckets.get(r.cls); if (!b) buckets.set(r.cls, (b = { cls: r.cls, n: 0, claimable: 0, intent: {}, types: new Map(), nodeTypes: new Map(), samples: [] }))
  b.n++
  if (causeClaimable(r.tgt)) b.claimable++
  b.intent[r.intent] = (b.intent[r.intent] ?? 0) + 1
  b.types.set(r.label, (b.types.get(r.label) ?? 0) + 1)
  b.nodeTypes.set(r.nodeType, (b.nodeTypes.get(r.nodeType) ?? 0) + 1)
  if (b.samples.length < 4) b.samples.push(`${r.file}:${r.line ?? "?"} ${r.label} -> ${r.tgt}`)
}
const ordered = [...buckets.values()].sort((a, b) => b.n - a.n)
console.log(`\nUNRESOLVED BY NAMED CAUSE (metadata.targetResolution), arbiter scope, ${unresolvedRows.length} rows:`)
console.log(`  ${"count".padStart(6)} ${"claimbl".padStart(7)}  named cause`)
for (const b of ordered) {
  const top = [...b.types].sort((x, y) => y[1] - x[1]).slice(0, 3).map(([k, v]) => `${k} ${v}`).join(", ")
  console.log(`  ${String(b.n).padStart(6)} ${String(b.claimable).padStart(7)}  ${b.cls.padEnd(28)} [${top}]`)
}
console.log(`  ${"-".repeat(60)}`)
console.log(`  ${String(unresolvedRows.length).padStart(6)} ${String(unresolvedRows.reduce((a, b) => a + b.claimable, 0)).padStart(7)}  TOTAL`)

console.log(`\nBINDING INTENT WITHIN EACH CAUSE (arbitraryTwin = the file-crossing class):`)
console.log(`  ${"count".padStart(6)}  ${"intended".padStart(8)} ${"sameFile".padStart(9)} ${"arbTwin".padStart(8)} ${"nothing".padStart(8)}  named cause`)
for (const b of ordered) {
  console.log(`  ${String(b.n).padStart(6)}  ${String(b.intent.intended ?? 0).padStart(8)} ${String(b.intent.sameFileUnproven ?? 0).padStart(9)} ${String(b.intent.arbitraryTwin ?? 0).padStart(8)} ${String(b.intent.nothingAnywhere ?? 0).padStart(8)}  ${b.cls}`)
}

console.log(`\nTHE TOP CAUSE'S CONSTRUCT — node types and samples:`)
for (const b of ordered.slice(0, 3)) {
  console.log(`  ${b.cls} (${b.n}, claimable ${b.claimable}):`)
  for (const [k, v] of [...b.nodeTypes].sort((x, y) => y[1] - x[1]).slice(0, 6)) console.log(`      ${String(v).padStart(6)}  ${k}`)
  for (const s of b.samples) console.log(`      e.g. ${s}`)
}

const claimableTotal = unresolvedRows.filter((r) => causeClaimable(r.tgt)).length
console.log(`\nPROJECTION: ${claimableTotal} of ${unresolvedRows.length} unresolved targets are 2-segment (owner is one identifier), the ONLY shape the gate's cause channel accepts (incoming-rule.ts:1154-1156).`)
console.log(`  the other ${unresolvedRows.length - claimableTotal} have a bare target or a multi-segment owner, where the same claim would read causeREFUTED and be counted AGAINST the lane (clause 4).`)

// ── THE SHIPPED RULE'S OWN PREDICATE, evaluated on the same rows ──────────────────────────
// class is one whose meaning is "this file does not publish this path" · the run neither published
// nor opened the owner · the owner is identifier-shaped (the gate's spelling test) · the edge
// carries no external-claim key (bucket 3 and the external books are mutually exclusive).
const BASE_CLASSES = new Set(["external-type-or-module", "external-namespace", "module-member", "base-member-external", "interface-member-external"])
const EXTERNAL_KEYS = ["zigExternalRef", "nimStdlibModule", "isExternal", "isExternalTarget", "external", "externalRef", "isStdlib", "stdlibModule", "moduleNamingEdges", "markAsExternal", "isExternalBase", "importOutsideProject"]
const ruleAttaches = (r: typeof unresolvedRows[number]): boolean => {
  if (!BASE_CLASSES.has(r.cls)) return false
  if (r.meta.projectIndexRefined === true) return false
  if (EXTERNAL_KEYS.some((k) => r.meta[k] === true || (Array.isArray(r.meta[k]) && r.meta[k].length > 0))) return false
  const o = targetOwner(r.tgt)
  if (o === null || !IDENT.test(o)) return false
  const fp = filePublished.get(r.abs)
  return !(fp?.has(o) ?? false)
}
const wouldAttach = unresolvedRows.filter(ruleAttaches)
const wouldByClass = new Map<string, number>()
for (const r of wouldAttach) wouldByClass.set(r.cls, (wouldByClass.get(r.cls) ?? 0) + 1)
console.log(`\nTHE SHIPPED RULE WOULD DECLARE A CAUSE ON ${wouldAttach.length} of the ${unresolvedRows.length} rows STILL unresolved — on a post-fix run this is the LEFTOVER, not a projection; the pre-fix projection is the line the report quotes.`)
for (const [k, v] of [...wouldByClass].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(6)}  ${k}`)
const wouldIntent = { intended: 0, sameFileUnproven: 0, arbitraryTwin: 0, nothingAnywhere: 0 } as Record<string, number>
for (const r of wouldAttach) wouldIntent[r.intent]++
console.log(`  their binding intent: intended ${wouldIntent.intended} · sameFileUnproven ${wouldIntent.sameFileUnproven} · arbitraryTwin ${wouldIntent.arbitraryTwin} · nothingAnywhere ${wouldIntent.nothingAnywhere}`)
const excludedByOwner = unresolvedRows.filter((r) => BASE_CLASSES.has(r.cls) && causeClaimable(r.tgt) && !ruleAttaches(r))
console.log(`  ${excludedByOwner.length} edge(s) in those classes are REFUSED by the run-reach test (the file publishes or opens the owner), e.g.:`)
for (const r of excludedByOwner.slice(0, 5)) console.log(`      ${r.file}:${r.line ?? "?"} ${r.cls} -> ${r.tgt}`)

// ── WHAT THE ANALYZER ACTUALLY WROTE, read back off the parse results ─────────────────────
// READ OVER EVERY EDGE, not over the unresolved ones: once the claim is published the edge is
// no longer `unresolved` (the gate's own sum makes `causeOK` a column of its own), so enumerating
// the attached set from `unresolvedRows` would report 0 on a run where 7,111 were attached —
// which is exactly what the first version of this block did.
const attached = pending
  .filter((e) => typeof e.meta.baseBeyondRunScope === "string" && e.meta.baseBeyondRunScope.length > 0)
  .map((e) => ({ file: path.relative(CR, e.srcFile), line: e.line, type: e.label, target: e.tgt, base: e.meta.baseBeyondRunScope, cls: String(e.meta.targetResolution ?? ""), intent: classifyIntent(e.tgt, e.srcFile, e.line, e.label) }))
console.log(`\nATTACHED IN THE ANALYZER'S OWN OUTPUT: ${attached.length} edge(s) carry baseBeyondRunScope`)
if (attached.length > 0) {
  const byCls = new Map<string, number>()
  for (const r of attached) byCls.set(r.cls, (byCls.get(r.cls) ?? 0) + 1)
  for (const [k, v] of [...byCls].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(6)}  ${k}`)
  const ai = { intended: 0, sameFileUnproven: 0, arbitraryTwin: 0, nothingAnywhere: 0 } as Record<string, number>
  for (const r of attached) ai[r.intent]++
  console.log(`  binding intent of the attached set: intended ${ai.intended} · sameFileUnproven ${ai.sameFileUnproven} · arbitraryTwin ${ai.arbitraryTwin} · nothingAnywhere ${ai.nothingAnywhere}`)
  console.log(`  (${attached.length} carry it; ${totals.causeDeclared} are READ by the gate — the difference is edges the project already resolves, where the gate never reads a cause)`)
  for (const r of attached.slice(0, 8)) console.log(`  ${r.file}:${r.line ?? "?"} ${r.type} -> ${r.target}   [base ${r.base}]`)
}

writeFileSync(path.join(REPO, ".tmp-fsharp-fix/cause-census-400.json"), JSON.stringify({
  population: { files: files.length, total, parsed, failed, degraded },
  totals, intent,
  buckets: Object.fromEntries(ordered.map((b) => [b.cls, { n: b.n, claimable: b.claimable, intent: b.intent, types: Object.fromEntries(b.types), nodeTypes: Object.fromEntries(b.nodeTypes), samples: b.samples }])),
  specOfCauseClaim: { key: "baseBeyondRunScope", ownerShaped: IDENT.source, ownerMustEqualTargetOwner: true },
  projection: { wouldAttach: wouldAttach.length, byClass: Object.fromEntries(wouldByClass), intent: wouldIntent, refusedByRunReach: excludedByOwner.length },
  attached: attached.map((r) => ({ file: r.file, line: r.line, type: r.type, target: r.target, base: r.base, cls: r.cls, intent: r.intent })),
}, null, 2))
console.log(`\nwrote .tmp-fsharp-fix/cause-census-400.json`)
