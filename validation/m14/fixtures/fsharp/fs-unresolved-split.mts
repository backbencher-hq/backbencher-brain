// THE UNRESOLVED SET, SPLIT — and the replica that is allowed to say so.
//
// The arbiter (`incoming-gate.ts`) caps its worklist at a handful of names per type, so it can
// report `4,871 unresolved` and not which 4,871. A census that prints the population must first
// PROVE it counts the same way, so this file reproduces the arbiter's own columns exactly
// (discovery rule, key space, classification, tally — all imported, not copied) and REFUSES to
// print the split unless the totals match the arbiter's published line to the edge.
//
// Then, for every unresolved target, the two questions the lead asked:
//   EXTERNAL      the name (and its owner) is declared NOWHERE in the whole corpus — the
//                 project has looked and does not have it.
//   IN-CORPUS     the name IS declared somewhere in the project but not in the stride's key
//                 space — a property of the sample, or of the analyzer's spelling.
// The corpus-side evidence comes from `.tmp-probe/fsharp-lane/fs-corpus-dump.jsonl`, produced
// by walking every git-tracked .fs/.fsi/.fsx in the corpus with the same analyzer.
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "/home/ishaq2321/mcp/backbencher-brain/src/ast/pool-worker.ts"
import {
  classifyEdge, externalClaimOf, tally, emptyOutcomes,
} from "/home/ishaq2321/mcp/backbencher-brain/script/m14/incoming-rule.ts"

const REPO = "/home/ishaq2321/mcp/backbencher-brain"
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const EXT = "fs"
const MAX = Number(process.argv[2] || 60)
const SIZE_CAP = 1024 * 1024

const LABEL_ALIASES: Record<string, string> = {
  calls: "calls", call: "calls", uses: "uses", contains: "contains", composition: "contains",
  part_of: "contains", imports: "imports", brain_import: "imports", references: "references",
  depends_on: "references", related: "references", exports: "exports", provides: "exports",
  extends: "extends", inheritance: "extends", implements: "implements", implementation: "implements",
  overrides: "overrides", override: "overrides", instantiates: "instantiates",
}
const ALL_TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"]

/* ── discovery: incoming-gate.ts discoverFiles, replicated line for line ─────────────────── */
const found: string[] = []
const repoSet = new Set<string>()
for (const name of execFileSync("ls", [CR], { encoding: "utf8" }).split("\n").filter(Boolean).sort()) {
  const dir = path.join(CR, name)
  try { if (!statSync(dir).isDirectory()) continue } catch { continue }
  try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    if (!rel.toLowerCase().endsWith(`.${EXT}`)) continue
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > SIZE_CAP) continue } catch { continue }
    found.push(abs); repoSet.add(name)
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
console.error(`discovery: ${files.length} of ${total} .fs files across ${repoSet.size} repos (stride ${Math.max(1, Math.floor(total / MAX))})`)

const repoOf = (f: string) => path.join(CR, (f.startsWith(CR) ? f.slice(CR.length + 1) : f).split(path.sep)[0])

/* ── walk + classify, the arbiter's own rule ─────────────────────────────────────────────── */
const projectDecl = new Map<string, Map<string, number>>()
const projectKinds = new Map<string, Map<string, Set<string>>>()
const pending: { label: string; tgt: string; claim: any; repo: string; meta: any; file: string }[] = []
const perLabel = new Map<string, any[]>()
let parsed = 0, failed = 0, degraded = 0, aliased = 0

for (const f of files) {
  let r: any
  try { r = await parseFile(f, repoOf(f), { projectRoot: repoOf(f) } as any) } catch { failed++; continue }
  if (!r) { failed++; continue }
  parsed++
  if (r.fallback === true || r.metadata?.analysisVersion === "2.0-basic-fallback") degraded++
  const repo = repoOf(f)
  let pDecl = projectDecl.get(repo); if (!pDecl) projectDecl.set(repo, (pDecl = new Map()))
  let pKinds = projectKinds.get(repo); if (!pKinds) projectKinds.set(repo, (pKinds = new Map()))
  const countKey = (key: string, kind: string) => {
    pDecl!.set(key, (pDecl!.get(key) ?? 0) + 1)
    let qs = pKinds!.get(key); if (!qs) pKinds!.set(key, (qs = new Set())); qs.add(kind)
  }
  for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
    const name = String(s?.name ?? ""); if (!name.length) continue
    countKey(name, String(s?.kind ?? ""))
    const q = String(s?.qualifiedName ?? "")
    if (q.length > 0 && q !== name) { countKey(q, String(s?.kind ?? "")); aliased++ }
  }
  // DEFERRED classification: the key space must be complete first (the gate's own note).
  for (const rel of Array.isArray(r.relationships) ? r.relationships : []) {
    const label = LABEL_ALIASES[String(rel?.type ?? rel?.relationshipType ?? "")]
    if (!label) continue
    const tgt = String(rel?.target ?? rel?.to ?? rel?.toSymbol ?? "")
    if (!tgt.length) continue
    pending.push({ label, tgt, claim: externalClaimOf(rel), repo, meta: rel.metadata ?? {}, file: f })
  }
}

const pooledDecl = new Map<string, number>(), pooledKinds = new Map<string, Set<string>>()
for (const [repo, m] of projectDecl) for (const [k, n] of m) {
  pooledDecl.set(k, (pooledDecl.get(k) ?? 0) + n)
  let ks = pooledKinds.get(k); if (!ks) pooledKinds.set(k, (ks = new Set()))
  for (const kk of projectKinds.get(repo)!.get(k) ?? []) ks.add(kk)
}

const totals = emptyOutcomes()
let edges = 0
for (const e of pending) {
  edges++
  const c = classifyEdge(projectDecl.get(e.repo)!, projectKinds.get(e.repo)!, e.tgt, e.claim)
  tally(totals, c, e.tgt, e.label)
  if (c.outcome === "unresolved") {
    const list = perLabel.get(e.label) ?? []; perLabel.set(e.label, list)
    list.push({ tgt: e.tgt, file: path.relative(CR, e.file), meta: e.meta })
  }
}

const published = `${edges}`
console.log(`REPLICA (must equal the arbiter's line): edges ${edges}, resolved ${totals.resolved}, amb(decl) ${totals.ambiguousByDecl}, unresolved ${totals.unresolved}, extOK ${totals.externalVerified}, extFAIL ${totals.externalRefuted}`)
console.log(`  parsed ${parsed}, failed ${failed}, degraded ${degraded}, qualifiedName aliases ${aliased}`)

/* ── the corpus-wide key space, from the full dump ───────────────────────────────────────── */
const DUMP = `${REPO}/.tmp-probe/fsharp-lane/fs-corpus-dump.jsonl`
if (!existsSync(DUMP)) { console.log(`no ${DUMP} yet — the corpus-side split cannot be computed`); process.exit(0) }
const corpNames = new Map<string, number>()   // name -> occurrences
const corpQnames = new Map<string, number>()
const corpRepoNames = new Map<string, Set<string>>()  // repo -> names declared there
let dumpedFiles = 0
for (const line of readFileSync(DUMP, "utf8").split("\n")) {
  if (!line.trim()) continue
  const row = JSON.parse(line); dumpedFiles++
  const rn = corpRepoNames.get(row.repo) ?? new Set<string>(); corpRepoNames.set(row.repo, rn)
  for (const s of row.symbols ?? []) {
    if (s.n) { corpNames.set(s.n, (corpNames.get(s.n) ?? 0) + 1); rn.add(s.n) }
    if (s.q) { corpQnames.set(s.q, (corpQnames.get(s.q) ?? 0) + 1); rn.add(s.q) }
  }
}
console.log(`corpus dump: ${dumpedFiles} files, ${corpNames.size} distinct names, ${corpQnames.size} distinct qualified names`)

// THE SAME EDGES AGAINST THE FULL-CORPUS KEY SPACE. The arbiter's own comment says this is the
// authoritative reading ("the full-corpus run is the authoritative reading — 35.1% resolved"),
// and the stride's key space is a sample of the PROJECT as well as of the edges. The key space
// here comes from the corpus dump (every admitted file, per repository), so the question is
// "would this target resolve if the whole project were in scope?".
const corpDecl = new Map<string, Map<string, number>>()
const corpKinds = new Map<string, Map<string, Set<string>>>()
for (const line of readFileSync(DUMP, "utf8").split("\n")) {
  if (!line.trim()) continue
  const row = JSON.parse(line)
  let m = corpDecl.get(row.repo); if (!m) corpDecl.set(row.repo, (m = new Map()))
  let km = corpKinds.get(row.repo); if (!km) corpKinds.set(row.repo, (km = new Map()))
  const add = (k: string, kind: string) => {
    m!.set(k, (m!.get(k) ?? 0) + 1)
    let ks = km!.get(k); if (!ks) km!.set(k, (ks = new Set())); ks.add(kind)
  }
  for (const sy of row.symbols ?? []) {
    if (!sy.n) continue
    add(sy.n, sy.k)
    if (sy.q && sy.q !== sy.n) add(sy.q, sy.k)
  }
}
const corpTotals = emptyOutcomes()
for (const e of pending) {
  const repoKey = path.basename(e.repo)
  const decl = corpDecl.get(repoKey), kinds = corpKinds.get(repoKey)
  if (!decl) continue
  tally(corpTotals, classifyEdge(decl, kinds!, e.tgt, e.claim), e.tgt, e.label)
}
console.log(`\nFULL-CORPUS SCOPE, the same ${pending.length} edges: resolved ${corpTotals.resolved}, amb(decl) ${corpTotals.ambiguousByDecl}, unresolved ${corpTotals.unresolved}, extOK ${corpTotals.externalVerified}, extFAIL ${corpTotals.externalRefuted}`)

// classify every unresolved target
const rows = []
const byClass = new Map<string, number>()
for (const [label, list] of [...perLabel].sort()) {
  for (const u of list) {
    const owner = u.tgt.includes(".") ? u.tgt.slice(0, u.tgt.lastIndexOf(".")) : null
    const leaf = u.tgt.includes(".") ? u.tgt.slice(u.tgt.lastIndexOf(".") + 1) : u.tgt
    const whole = corpNames.get(u.tgt) ?? corpQnames.get(u.tgt) ?? 0
    const leafHit = corpNames.get(leaf) ?? 0
    const ownerHit = owner ? (corpNames.get(owner) ?? corpQnames.get(owner) ?? 0) : 0
    const cls = whole > 0 ? "in-corpus-exact" : ownerHit > 0 ? "in-corpus-owner" : leafHit > 0 ? "in-corpus-leaf-only" : "nowhere-in-corpus"
    byClass.set(cls, (byClass.get(cls) ?? 0) + 1)
    rows.push({ label, target: u.tgt, cls, whole, leaf, leafHit, owner, ownerHit, file: u.file, markerKeys: Object.keys(u.meta).sort().join("+"), targetResolution: u.meta.targetResolution ?? "", nodeType: u.meta.nodeType ?? "", isAttributeUsage: u.meta.isAttributeUsage === true, bare: !u.tgt.includes(".") })
  }
}
console.log(`\nUNRESOLVED SPLIT (${rows.length} targets, per-project scope, the arbiter's scope):`)
for (const [k, v] of [...byClass].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(22)} ${v}`)

console.log(`\nthe ${rows.filter((r) => r.cls === "nowhere-in-corpus").length} NOWHERE-IN-CORPUS targets, by the analyzer's own class:`)
{
  const m = new Map<string, number>()
  for (const r of rows.filter((x) => x.cls === "nowhere-in-corpus")) {
    const k = `${r.bare ? "bare" : "dotted"} | ${r.targetResolution || "(no class)"}`
    m.set(k, (m.get(k) ?? 0) + 1)
  }
  for (const [k, v] of [...m].sort((a, b) => b[1] - a[1])) console.log(`  ${v.toString().padStart(5)}  ${k}`)
}

console.log(`\nper label, the class counts:`)
for (const label of ALL_TYPES) {
  const rs = rows.filter((r) => r.label === label)
  if (!rs.length) continue
  const m = new Map<string, number>()
  for (const r of rs) m.set(r.cls, (m.get(r.cls) ?? 0) + 1)
  console.log(`  ${label.padEnd(12)} ${[...m].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(" ")}`)
}

writeFileSync(`${REPO}/.tmp-probe/fsharp-lane/fs-unresolved-split.json`, JSON.stringify({
  edges, totals, parsed, failed, degraded, aliased,
  fullCorpusTotals: corpTotals,
  corpusDump: { files: dumpedFiles, names: corpNames.size, qnames: corpQnames.size },
  byClass: Object.fromEntries(byClass), rows,
}, null, 2))
console.log(`\nwrote .tmp-probe/fsharp-lane/fs-unresolved-split.json`)
