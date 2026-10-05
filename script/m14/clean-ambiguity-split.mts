/**
 * clean-ambiguity-split — WHY an incoming target is ambiguous, per type, with counts.
 *
 * ## The question
 *
 * `script/m14/incoming-check.ts` reports `ambiguousTargets` per type. It resolves a
 * target string against a `name -> distinct KINDS` index, so its ambiguous count is
 * the number of target strings published under two or more DIFFERENT KINDS. The lane's
 * own declaration dump shows a second, larger ambiguity that instrument cannot see:
 * one file declaring the same name four times under one kind
 * (`Data/Array/Strict.dcl`, four `class` symbols named `!a`, lines 18/20/21/23 — the
 * `instance Show|Eq|Ord|Appendable {!a}` family). Four candidates for a reverse walk
 * and a kind-keyed index calls it unambiguous. Both numbers are printed here, and they
 * are never added: they are different questions over the same edges.
 *
 * ## What an ambiguous edge IS, because the counting is easy to get wrong
 *
 * It is ONE edge that the reverse walk attributes to ONE of N declarations. It is not
 * N edges. So this count cannot be lowered by emitting fewer edges, and a "fix" that
 * drops edges to move it is not a fix. What moves it is the analyzer naming which
 * declaration it meant — a published name that is unique over the population.
 *
 * ## The split, and which parts are the lane's to repair
 *
 * The brief asks for three causes, and they have three different owners:
 *
 *   A  SCOPE          several declarations of one name INSIDE one file — a local
 *                     `where`/`let`/`with` binding, two instances named after a type
 *                     expression, a polymorphic instance member against a class member.
 *                     The lane owns the NAME; the published-symbol contract owns the
 *                     scope field, and there is none (every clean symbol's `scope` is
 *                     ABSENT — measured, not assumed).
 *   B  MODULE         one declaration per file, N files. Clean has no cross-module
 *                     overloading, so every `map` in every module is a legal distinct
 *                     declaration and a bare target string cannot say which. The lane
 *                     can read the module: the `imports` edges already name the modules
 *                     in scope.
 *   C  NAME CONTRACT  one name, two or more KINDS. Clean's namespaces let a class and a
 *                     function, or a type and a class, share a spelling. The published
 *                     name is not a unique identifier and no lane can make it one.
 *
 * `QNAME-ALIAS` is reported beside them and is NOT one of the three: it is ambiguity
 * the INSTRUMENT creates, by indexing a symbol's `qualifiedName` into the same map as
 * its `name`. When a qualifiedName and some other declaration's `name` meet under one
 * key, the map holds two kinds and `incoming-check` reports ambiguity no declaration
 * causes. It is counted separately so it cannot be charged to a lane.
 *
 * ## The one test that is not a name-shape guess
 *
 * A declaration named `!a` at `Strict.dcl:18` is not an identifier the source ever
 * spells. Rather than pattern-match the NAME, the loader reads the declaration's own
 * source LINE and asks whether the name occurs there as a token at all. A name absent
 * from the line that declares it is `UNSPELLED`: the analyzer invented it. This is a
 * measurement against the source, and it is why the construct-artefact bucket is a
 * count rather than an opinion.
 *
 * ## What this file does not do
 *
 * It does not decide which of two same-named declarations an edge MEANT. That is a
 * resolution question, and answering it here would be the classifier grading its own
 * measurement. It counts the candidates and names the files; the decision is left to a
 * reader with the source in front of them.
 *
 * Usage:
 *   npx tsx script/m14/clean-ambiguity-split.mts --in <identity-dir>
 *          [--json out.json] [--examples N] [--edge-detail]
 */
import * as fs from "node:fs"
import * as path from "node:path"

const ALL_TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"] as const
type Type = (typeof ALL_TYPES)[number]

const argv = process.argv.slice(2)
const arg = (k: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : "" }
const IN_DIR = arg("--in")
const JSON_OUT = arg("--json")
const EXAMPLES = Number(arg("--examples") ?? 8) || 8
const EDGE_DETAIL = argv.includes("--edge-detail")
if (!IN_DIR) {
  console.error("usage: npx tsx script/m14/clean-ambiguity-split.mts --in <identity-dir> [--json out] [--examples N] [--edge-detail]")
  process.exit(2)
}

const STAT = fs.statSync(IN_DIR)
const SHARDS = STAT.isDirectory()
  ? fs.readdirSync(IN_DIR).filter((f) => f.startsWith("identity-") && f.endsWith(".ndjson")).sort()
  : [path.basename(IN_DIR)]
if (SHARDS.length === 0) { console.error(`no identity-<shard>.ndjson under ${IN_DIR}`); process.exit(2) }

type Decl = { name: string; kind: string; qname: string; line: number; owner: string; file: string; vis: string }
const declsByName = new Map<string, Decl[]>()
const declsByQName = new Map<string, Decl[]>()
/** `name -> distinct kinds`, built exactly as incoming-check.ts builds it. */
const kindsByName = new Map<string, Set<string>>()
const filesSeen = new Set<string>()
const edges: { t: number; src: string; tgt: string; file: string; line: number; conf: number; disc: string }[] = []
let declarations = 0, fileLines = 0

function push<K, V>(m: Map<K, V[]>, k: K, v: V): void { const a = m.get(k); if (a) a.push(v); else m.set(k, [v]) }
function addKind(m: Map<string, Set<string>>, k: string, kind: string): void { const s = m.get(k); if (s) s.add(kind); else m.set(k, new Set([kind])) }

for (const f of SHARDS) {
  for (const line of fs.readFileSync(path.join(IN_DIR, f), "utf8").split("\n")) {
    const t = line.trim()
    if (!t) continue
    const rec = JSON.parse(t) as { f: string; s: unknown[][]; r: unknown[][] }
    filesSeen.add(rec.f)
    for (const s of rec.s) {
      const d: Decl = { name: String(s[0]), kind: String(s[1]), qname: String(s[2]), line: Number(s[3]) || 0, owner: String(s[4]), file: rec.f, vis: String(s[5]) }
      declarations++
      if (!d.kind || !d.name) continue
      push(declsByName, d.name, d)
      addKind(kindsByName, d.name, d.kind)
      // incoming-check.ts also indexes the qualifiedName, under the same map.
      if (d.qname && d.qname !== d.name) { push(declsByQName, d.qname, d); addKind(kindsByName, d.qname, d.kind) }
    }
    for (const r of rec.r) {
      edges.push({ t: Number(r[0]), src: String(r[1]), tgt: String(r[2]), file: rec.f, line: Number(r[3]) || 0, conf: Number(r[4]), disc: String(r[5]) })
    }
  }
}

/**
 * Is `name` spelled as a token on the line that declares it?
 *
 * Reads the file through a process-wide cache (the same file is asked about once per
 * colliding declaration). A name that is not in its own declaration's line is one the
 * analyzer produced from something other than the text — the `!a` / `.a` / `!.a`
 * family, where the declaration is `instance Show {!a}` and the published name is the
 * stripped type expression.
 */
const srcCache = new Map<string, string[] | null>()
function spelledInLine(d: Decl): boolean | "NOFILE" {
  let lines = srcCache.get(d.file)
  if (lines === undefined) {
    try { lines = fs.readFileSync(d.file, "utf8").split("\n") } catch { lines = null }
    srcCache.set(d.file, lines)
  }
  if (lines === null) return "NOFILE"
  const text = lines[d.line - 1]
  if (text === undefined) return "NOFILE"
  return tokenPresent(text, d.name)
}
function tokenPresent(text: string, name: string): boolean {
  const n = name.trim()
  if (!n) return false
  const i = text.indexOf(n)
  if (i < 0) return false
  let at = 0
  for (;;) {
    at = text.indexOf(n, at)
    if (at < 0) return false
    const before = at === 0 ? "" : text[at - 1]
    const after = at + n.length >= text.length ? "" : text[at + n.length]
    const isWord = (c: string) => /[A-Za-z0-9_']/.test(c)
    if (!isWord(before) && !isWord(after)) return true
    at += n.length
  }
}

// ---------------------------------------------------------------- classification
type Bucket = "UNSPELLED" | "A_SCOPE" | "B_MODULE" | "C_NAME_CONTRACT" | "QNAME_ALIAS" | "UNIQUE" | "UNRESOLVED" | "SELF"
/** The verdict for one published name, computed once and reused by every edge. */
const nameVerdict = new Map<string, Bucket>()
const nameNote = new Map<string, string>()

for (const [name, ds] of declsByName) {
  if (ds.length === 1 && (kindsByName.get(name)?.size ?? 0) === 1) { nameVerdict.set(name, "UNIQUE"); continue }
  // Bucket A candidates: >1 declaration row. Bucket C candidates: >1 kind.
  const kinds = kindsByName.get(name) ?? new Set<string>()
  const distinctKinds = kinds.size
  // UNSPELLED wins over everything: a name the source never spells is an invented
  // name, and no scope rule can make an invented name unique.
  const spelled = ds.map(spelledInLine)
  const unspelled = spelled.filter((s) => s === false).length
  if (unspelled > 0) { nameVerdict.set(name, "UNSPELLED"); nameNote.set(name, `${unspelled}/${ds.length} declarations do not spell it`); continue }
  // QNAME-ALIAS: the extra kinds come from a qualifiedName, not from a declaration of
  // this name. Detected by comparing the kinds declared under this NAME against the
  // kinds incoming-check's map holds for it.
  const nameKinds = new Set(ds.map((d) => d.kind))
  const aliasKinds = [...kinds].filter((k) => !nameKinds.has(k))
  if (distinctKinds > 1 && aliasKinds.length === distinctKinds && ds.length === 1) {
    nameVerdict.set(name, "QNAME_ALIAS"); nameNote.set(name, `kinds ${aliasKinds.join(",")} come only from a qualifiedName`); continue
  }
  if (distinctKinds > 1) { nameVerdict.set(name, "C_NAME_CONTRACT"); nameNote.set(name, `kinds ${[...kinds].sort().join("+")} over ${ds.length} declarations in ${new Set(ds.map((d) => d.file)).size} files`); continue }
  // One kind, several rows.
  const fileCount = new Set(ds.map((d) => d.file)).size
  if (fileCount === 1) { nameVerdict.set(name, "A_SCOPE"); nameNote.set(name, `${ds.length} declarations in 1 file: ${ds.map((d) => `${d.kind}@${d.line}`).join(" ")}`) }
  else { nameVerdict.set(name, "B_MODULE"); nameNote.set(name, `${ds.length} declarations across ${fileCount} files`) }
}

const perType: Record<string, { edges: number; selfLoops: number; resolved: number; unresolved: number; ambKind: number; ambDecl: number; buckets: Record<Bucket, number>; ambNames: Set<string>; unresNames: Set<string> }> = Object.create(null)
for (const t of ALL_TYPES) {
  perType[t] = { edges: 0, selfLoops: 0, resolved: 0, unresolved: 0, ambKind: 0, ambDecl: 0, buckets: { UNSPELLED: 0, A_SCOPE: 0, B_MODULE: 0, C_NAME_CONTRACT: 0, QNAME_ALIAS: 0, UNIQUE: 0, UNRESOLVED: 0, SELF: 0 }, ambNames: new Set(), unresNames: new Set() }
}
const globalBuckets: Record<Bucket, number> = { UNSPELLED: 0, A_SCOPE: 0, B_MODULE: 0, C_NAME_CONTRACT: 0, QNAME_ALIAS: 0, UNIQUE: 0, UNRESOLVED: 0, SELF: 0 }
const bucketNames: Record<string, Set<string>> = { UNSPELLED: new Set(), A_SCOPE: new Set(), B_MODULE: new Set(), C_NAME_CONTRACT: new Set(), QNAME_ALIAS: new Set() }
const edgesByBucket: Record<Bucket, { t: string; src: string; tgt: string; file: string; line: number }[]> = { UNSPELLED: [], A_SCOPE: [], B_MODULE: [], C_NAME_CONTRACT: [], QNAME_ALIAS: [], UNIQUE: [], UNRESOLVED: [], SELF: [] }
/** distribution of candidate counts, so "one name with 40 declarations" is visible. */
const declCountHist = new Map<number, number>()

for (const e of edges) {
  const row = perType[ALL_TYPES[e.t]]
  row.edges++
  if (!e.tgt) { row.buckets.UNRESOLVED++; globalBuckets.UNRESOLVED++; continue }
  if (e.src === e.tgt) { row.buckets.SELF++; row.selfLoops++; globalBuckets.SELF++; edgesByBucket.SELF.push({ t: ALL_TYPES[e.t], src: e.src, tgt: e.tgt, file: e.file, line: e.line }); continue }
  const v = nameVerdict.get(e.tgt)
  const resolvedHere = v !== undefined || (declsByQName.has(e.tgt))
  if (!resolvedHere) {
    row.buckets.UNRESOLVED++; globalBuckets.UNRESOLVED++; row.unresolved++; row.unresNames.add(e.tgt)
    if (edgesByBucket.UNRESOLVED.length < 4000) edgesByBucket.UNRESOLVED.push({ t: ALL_TYPES[e.t], src: e.src, tgt: e.tgt, file: e.file, line: e.line })
    continue
  }
  row.resolved++
  const verdict: Bucket = v ?? "UNIQUE"
  row.buckets[verdict]++
  globalBuckets[verdict]++
  bucketNames[verdict]?.add(e.tgt)
  const ds = declsByName.get(e.tgt) ?? []
  if (ds.length > 1) { const h = declCountHist.get(ds.length) ?? 0; declCountHist.set(ds.length, h + 1); row.ambDecl++ }
  if ((kindsByName.get(e.tgt)?.size ?? 0) > 1) { row.ambKind++; row.ambNames.add(e.tgt) }
  if (edgesByBucket[verdict].length < 4000) edgesByBucket[verdict].push({ t: ALL_TYPES[e.t], src: e.src, tgt: e.tgt, file: e.file, line: e.line })
}

// ---------------------------------------------------------------- report
const w = (s: string | number, n: number) => (String(s) + " ".repeat(n)).slice(0, n)
const pct = (a: number, b: number) => (b === 0 ? "  n/a" : `${((a / b) * 100).toFixed(1)}%`)
const fired = ALL_TYPES.filter((t) => perType[t].edges > 0)

console.log(`clean ambiguity split — ${filesSeen.size} files, ${declarations} declarations, ${edges.length} edges, ${fired.length}/10 types fired`)
console.log(`identity shards: ${SHARDS.length} (${SHARDS.join(", ")})`)
console.log(`distinct published names (declarations): ${declsByName.size}   names with >1 declaration: ${[...declsByName.values()].filter((d) => d.length > 1).length}`)
console.log(`distinct qualifiedNames published: ${declsByQName.size}\n`)

console.log("PER TYPE — the instrument's question, then the declaration question, then the split")
console.log([w("type", 13), w("edges", 8), w("unres", 7), w("ambKinds", 10), w("ambDecls", 9), ...["UNSPELL", "A_SCOPE", "B_MODULE", "C_CONTRACT", "QALIAS", "UNIQUE"].map((h) => w(h, 9))].join(""))
console.log("-".repeat(122))
for (const t of ALL_TYPES) {
  const r = perType[t]
  if (r.edges === 0) { console.log(`${w(t, 13)}${w("0", 8)}NOT EMITTED`); continue }
  console.log([
    w(t, 13), w(r.edges, 8), w(r.unresolved, 7), w(r.ambKind, 10), w(r.ambDecl, 9),
    w(r.buckets.UNSPELLED, 9), w(r.buckets.A_SCOPE, 9), w(r.buckets.B_MODULE, 9), w(r.buckets.C_NAME_CONTRACT, 9), w(r.buckets.QNAME_ALIAS, 9), w(r.buckets.UNIQUE, 9),
  ].join(""))
}
console.log("-".repeat(122))
const totalRow = ALL_TYPES.reduce((a, t) => {
  const r = perType[t]
  a.edges += r.edges; a.unresolved += r.unresolved; a.ambKind += r.ambKind; a.ambDecl += r.ambDecl
  for (const k of Object.keys(a.buckets) as Bucket[]) a.buckets[k] += r.buckets[k]
  return a
}, { edges: 0, unresolved: 0, ambKind: 0, ambDecl: 0, buckets: { UNSPELLED: 0, A_SCOPE: 0, B_MODULE: 0, C_NAME_CONTRACT: 0, QNAME_ALIAS: 0, UNIQUE: 0, UNRESOLVED: 0, SELF: 0 } as Record<Bucket, number> })
console.log([
  w("ALL", 13), w(totalRow.edges, 8), w(totalRow.unresolved, 7), w(totalRow.ambKind, 10), w(totalRow.ambDecl, 9),
  w(totalRow.buckets.UNSPELLED, 9), w(totalRow.buckets.A_SCOPE, 9), w(totalRow.buckets.B_MODULE, 9), w(totalRow.buckets.C_NAME_CONTRACT, 9), w(totalRow.buckets.QNAME_ALIAS, 9), w(totalRow.buckets.UNIQUE, 9),
].join(""))
console.log("")
console.log("AMBIGUOUS EDGES BY CAUSE (one edge, N candidate declarations)")
const causeRows: [Bucket, string][] = [
  ["UNSPELLED", "invented name — absent from the line that declares it"],
  ["A_SCOPE", "N declarations of one name INSIDE one file"],
  ["B_MODULE", "one declaration per file, N files (module-level reuse)"],
  ["C_NAME_CONTRACT", "one name, 2+ KINDS"],
  ["QNAME_ALIAS", "extra kinds come from a qualifiedName, not a declaration"],
]
for (const [b, desc] of causeRows) {
  const n = globalBuckets[b]
  console.log(`  ${w(b, 18)}${w(n, 8)}${pct(n, edges.length).padStart(8)} of ${edges.length}   distinct names ${w(bucketNames[b].size, 7)} ${desc}`)
}
console.log("")
console.log("CANDIDATE-COUNT HISTOGRAM — edges whose target name has N declaration rows")
for (const n of [...declCountHist.keys()].sort((a, b) => a - b)) console.log(`  ${w(n, 6)}declarations: ${w(declCountHist.get(n)!, 8)} edges`)
console.log("")

console.log("THE WORST NAMES, by edges pointing at a name with candidates")
const worst: { name: string; v: Bucket; decls: number; kinds: number; edges: number; note: string }[] = []
for (const [name, ds] of declsByName) {
  if (ds.length < 2 && (kindsByName.get(name)?.size ?? 0) < 2) continue
  let n = 0
  for (const e of edges) if (e.tgt === name) n++
  if (n === 0) continue
  worst.push({ name, v: nameVerdict.get(name) ?? "UNIQUE", decls: ds.length, kinds: kindsByName.get(name)?.size ?? 0, edges: n, note: nameNote.get(name) ?? "" })
}
worst.sort((a, b) => b.edges - a.edges)
for (const x of worst.slice(0, EXAMPLES)) console.log(`  ${w(x.name, 26)}${w(x.v, 16)}${w(x.edges, 7)}edges  ${x.note}`)
console.log("")

for (const [b, rows] of [["UNSPELLED", edgesByBucket.UNSPELLED], ["A_SCOPE", edgesByBucket.A_SCOPE], ["B_MODULE", edgesByBucket.B_MODULE], ["C_NAME_CONTRACT", edgesByBucket.C_NAME_CONTRACT], ["QNAME_ALIAS", edgesByBucket.QNAME_ALIAS], ["UNRESOLVED", edgesByBucket.UNRESOLVED]] as [Bucket, { t: string; src: string; tgt: string; file: string; line: number }[]][]) {
  if (rows.length === 0) continue
  console.log(`SAMPLE EDGES — ${b} (${rows.length} collected, up to ${EXAMPLES} shown)`)
  for (const r of rows.slice(0, EXAMPLES)) console.log(`  ${w(r.t, 13)}${r.file}:${r.line}  ${r.src} -> ${r.tgt}`)
  console.log("")
}

if (JSON_OUT) {
  fs.writeFileSync(JSON_OUT, JSON.stringify({
    inDir: IN_DIR, shards: SHARDS, files: filesSeen.size, declarations, edges: edges.length,
    distinctNames: declsByName.size, namesWithMultipleDeclarations: [...declsByName.values()].filter((d) => d.length > 1).length,
    fired: fired.length,
    perType: Object.fromEntries(ALL_TYPES.map((t) => [t, {
      edges: perType[t].edges, unresolved: perType[t].unresolved, ambKind: perType[t].ambKind, ambDecl: perType[t].ambDecl,
      selfLoops: perType[t].selfLoops, resolved: perType[t].resolved, buckets: perType[t].buckets,
    }])),
    buckets: globalBuckets,
    bucketNames: Object.fromEntries(Object.entries(bucketNames).map(([k, v]) => [k, v.size])),
    declCountHistogram: Object.fromEntries([...declCountHist.entries()].sort((a, b) => a[0] - b[0])),
    worst: worst.slice(0, 100),
  }, null, 2))
  console.log(`JSON written: ${JSON_OUT}`)
}