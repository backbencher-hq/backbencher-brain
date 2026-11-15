/**
 * THE MARKDOWN extQ DISPOSAL — 115,317 marked `uses` edges, split by EMITTING SITE and SHAPE, with
 * the falsifier RUN rather than argued (§5v), and the same instrument measuring what is left in the
 * unresolved column.
 *
 * ## What the gate says, and why this file exists
 *
 * `residual-gate.ts --lane markdown`, whole admitted population, reads
 * `uses 124,925 edges · resolved 4 · amb 1 · unresolved 9,555 · extOK 48 · ext? 115,317` — so the
 * lane's residual is 5.5% (the lowest measured anywhere) while its extQ column is the largest in the
 * programme: 41% of the lane's edges, sixty times yaml's 1,903. Clause 2 wants every edge resolved or
 * carrying an external claim the project VERIFIES, and only 48 of 115,365 verify.
 *
 * §5v's method, in order: SHAPE (measured, not assumed) · MECHANISM (why no claim kind can verify
 * them) · COUNT split by shape · FALSIFIER RUN. This instrument produces the first, third and
 * fourth; the mechanism is read from the arbiter's own code and quoted with its line.
 *
 * ## The split is by EMITTING SITE first, because that is the step that pays
 *
 * yaml's extQ fell 1,903 -> 254 with 82% of it turning out to be a FIX rather than a ruling. A site
 * is identified from the edge's own published metadata (`role`, `targetKind`), never inferred from
 * the target text, so the split cannot drift from the analyzer.
 *
 * ## The falsifier, stated so it can fail
 *
 * The claim on each of these edges is "this target names nothing the project publishes". The
 * arbiter cannot check that for a URI — `pathLikeTarget` refuses a scheme or a separator and returns
 * `externalUnverified` (incoming-rule.ts:577) — so the falsifier is run OUTSIDE the arbiter, against
 * the project's own two key spaces: an admitted FILE whose relative path ends with the target's leaf,
 * or a PUBLISHED SYMBOL whose name equals the target's last segment. A marked edge that hits either
 * is a claim the project can refute, and it is counted here by name.
 *
 * ## The control the Lead asked for: scss
 *
 * scss is the same family and the opposite behaviour: it sets NO claim key at all (`localBinding`,
 * `importProjectFile`, `remoteRef`, `baseBeyondRunScope` and every spelling in `EXTERNAL_KEYS` are
 * absent from `real-scss-analyzer.ts`), so its externals are not marked and land in `unresolved`
 * instead of `ext?`. The comparison is therefore not "which claims does scss verify" but "the same
 * kind of target is classified differently by two lanes" — which is what this file measures for
 * markdown's own targets.
 *
 * CLI: npx tsx validation/m14/fixtures/markdown/probe-markdown-extq-split.mts [--nf 0] [--ext md,markdown]
 * Read-only.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"
import { classifyEdge, externalClaimOf, emptyOutcomes, tally } from "../../../../script/m14/incoming-rule"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const argv = process.argv.slice(2)
const flag = (n: string): string | undefined => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 ? argv[i + 1] : undefined
}
const EXTS = (flag("ext") ?? "md,markdown").toLowerCase().split(",").map((x) => x.trim()).filter(Boolean)
const NF = Number(flag("nf") ?? "0")
// THE SHARDED ROUTE, mirroring `script/m14/clean-ontology-census.ts`'s own rule: the SORTED admitted
// list partitioned by `index % N`, so shards are disjoint, reproducible and independently re-runnable.
// It exists there because `src/ast/engine.ts:1441` arms a 120 s timeout and calls `process.exit(1)`,
// which is the same mechanism that produces FALLBACK ROWS — a file that runs long under contention is
// timed out, and `extractFallback()` answers for it. A sequential census therefore reports `0 degraded`
// while its files are falling back; the shard's own counters below are what tell the two apart.
const SHARD = Number(flag("shard") ?? "-1")
const SHARDS = Number(flag("shards") ?? "1")

type Type = "calls" | "uses" | "contains" | "imports" | "references" | "exports" | "overrides" | "extends" | "implements" | "instantiates"
const ALL_TYPES: Type[] = ["calls", "uses", "contains", "imports", "references", "exports", "overrides", "extends", "implements", "instantiates"]
type KeySpace = { decl: Map<string, number>; kinds: Map<string, Set<string>> }
const newKeySpace = (): KeySpace => ({ decl: new Map(), kinds: new Map() })
const addSymbol = (ks: KeySpace, name: string, kind: string): void => {
  ks.decl.set(name, (ks.decl.get(name) ?? 0) + 1)
  let s = ks.kinds.get(name)
  if (!s) ks.kinds.set(name, (s = new Set()))
  s.add(kind)
}
const addSymbolWithAlias = (ks: KeySpace, name: string, qname: string, kind: string): void => {
  addSymbol(ks, name, kind)
  if (qname.length > 0 && qname !== name) addSymbol(ks, qname, kind)
}
const repoOf = (f: string): string => path.relative(CR, f).split(path.sep)[0]

// ------------------------------------------------------------------ the gate's discovery rule
const found: string[] = []
const repos = new Set<string>()
for (const entry of readdirSync(CR).sort()) {
  const dir = path.join(CR, entry)
  try { if (!statSync(dir).isDirectory()) continue } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 1 << 28 }).split("\0").filter(Boolean) } catch { continue }
  repos.add(entry)
  for (const rel of tracked) {
    if (!EXTS.some((x) => rel.toLowerCase().endsWith(`.${x}`))) continue
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > 1024 * 1024) continue } catch { continue }
    found.push(abs)
  }
}
found.sort()
const stride = NF > 0 ? Math.max(1, Math.floor(found.length / NF)) : 1
const files = (NF > 0 ? found.filter((_, i) => i % stride === 0).slice(0, NF) : found)
  .filter((_, i) => SHARD < 0 || i % SHARDS === SHARD)

// ------------------------------------------------------------------ the walk
type Pending = { label: Type; tgt: string; claim: ReturnType<typeof externalClaimOf>; repo: string; file: string; line: number; role: string; targetKind: string }
const pending: Pending[] = []
const projectSpaces = new Map<string, KeySpace>()
/** repo -> every admitted file's relative path (lowercased), for the file half of the falsifier. */
const admittedPaths = new Map<string, string[]>()
let parsed = 0, failed = 0, fallbackRows = 0, fallbackFiles = 0
for (const f of files) {
  const repo = repoOf(f)
  let r: any
  try { r = await parseFile(f, repo, { projectRoot: repo } as any) } catch { failed++; continue }
  if (!r) { failed++; continue }
  parsed++
  if (r.fallback === true || String(r.metadata?.analysisVersion ?? "").includes("fallback")) fallbackFiles++
  let ks = projectSpaces.get(repo)
  if (!ks) projectSpaces.set(repo, (ks = newKeySpace()))
  for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
    const name = String(s?.name ?? "")
    if (name.length === 0) continue
    addSymbolWithAlias(ks, name, String(s?.qualifiedName ?? ""), String(s?.kind ?? ""))
  }
  let paths = admittedPaths.get(repo)
  if (!paths) admittedPaths.set(repo, (paths = []))
  // THE REPO's own relative path — a repo-relative link names the path from the repo root, so the
  // first version of this line (relative to the grandparent directory) measured a key space nobody
  // uses and inflated both the falsifier and the ceiling.
  paths.push(path.relative(path.join(CR, repo), f).split(path.sep).join("/").toLowerCase())
  for (const rel of Array.isArray(r.relationships) ? r.relationships : []) {
    const label = String(rel?.type ?? rel?.relationshipType ?? "") as Type
    if (!ALL_TYPES.includes(label)) continue
    const tgt = String(rel?.target ?? rel?.to ?? rel?.toSymbol ?? "")
    if (tgt.length === 0) continue
    if (String((rel as any)?.metadata?.method ?? "") === "regex") fallbackRows++
    pending.push({
      label, tgt, claim: externalClaimOf(rel), repo, file: f, line: Number(rel?.line_number ?? 0),
      role: String(rel?.metadata?.role ?? "(no role)"),
      targetKind: String(rel?.metadata?.targetKind ?? "(no targetKind)"),
      isFallback: String(rel?.metadata?.method ?? "") === "regex",
    })
  }
}

// ------------------------------------------------------------------ classify + split
type Row = Outcomes & { edges: number }
const rows = new Map<Type, Row>()
for (const t of ALL_TYPES) rows.set(t, { ...emptyOutcomes(), edges: 0 })
const shapeOf = (t: string): string => {
  const colon = t.indexOf(":")
  if (colon > 0 && t.slice(0, colon).match(/^[a-zA-Z][a-zA-Z0-9+.-]*$/) !== null) return `scheme:${t.slice(0, colon).toLowerCase()}`
  if (t.startsWith("#")) return "fragment (#anchor)"
  if (t.includes("/") || t.includes("\\")) return "relative path"
  if (t.includes(".")) return "dotted name"
  return "bare token"
}
const leafOf = (t: string): string => {
  const q = t.split("#")[0]!.split("?")[0]!
  const seg = q.split("/").filter(Boolean)
  return (seg[seg.length - 1] ?? "").toLowerCase()
}
const siteRows = new Map<string, { edges: number; targets: Set<string> }>()
const shapeRows = new Map<string, number>()
const siteShape = new Map<string, Map<string, number>>()
let marked = 0, falsifierHits = 0, exactRefuted = 0, leafOnlyHits = 0
const refutedExamples: string[] = []
const falsifierExamples: string[] = []
const unresolvedUses: Pending[] = []
for (const e of pending) {
  const ks = projectSpaces.get(e.repo) ?? newKeySpace()
  const c = classifyEdge(ks.decl, ks.kinds, e.tgt, e.claim, undefined, e.label === "contains")
  const row = rows.get(e.label)!
  row.edges++
  tally(row, c, e.tgt, e.label)
  if (e.label === "uses" && c.outcome === "unresolved") unresolvedUses.push(e)
  if (e.claim === null) continue
  marked++
  const site = e.targetKind !== "(no targetKind)" ? `${e.role} / ${e.targetKind}` : e.role
  let s = siteRows.get(site)
  if (!s) siteRows.set(site, (s = { edges: 0, targets: new Set() }))
  s.edges++
  s.targets.add(e.tgt)
  const shape = shapeOf(e.tgt)
  shapeRows.set(shape, (shapeRows.get(shape) ?? 0) + 1)
  let ss = siteShape.get(site)
  if (!ss) siteShape.set(site, (ss = new Map()))
  ss.set(shape, (ss.get(shape) ?? 0) + 1)
  // ---- THE FALSIFIER, RUN: does the project itself answer this target?
  const leaf = leafOf(e.tgt)
  if (leaf.length === 0) continue
  // TWO TESTS, AND ONLY ONE OF THEM IS SOUND.
  //   SOUND     the arbitter's own refutation test: is the TARGET ITSELF a name the project publishes?
  //             A claim of externality is refuted exactly when the target names a declaration, so an
  //             exact-name hit is a REAL refutation and its count is the finding.
  //   UNSOUND   a LEAF hit — the target's last path segment matching a local file or symbol. It fires
  //             on coincidence (`https://github.com/…/CONTRIBUTING.md` versus this repo's own
  //             CONTRIBUTING.md) and would refute genuinely external URLs, so it is reported
  //             SEPARATELY as the reason a leaf-based checker cannot be the check that reaches this
  //             class. Mixing them would make a sound zero look like an unsound 3.6%.
  const exactHit = (ks.decl.get(e.tgt) ?? 0) > 0
  if (exactHit) { exactRefuted++; if (refutedExamples.length < 5) refutedExamples.push(`${path.relative(CR, e.file)}:${e.line} -[${e.label}]-> ${e.tgt} (the project publishes this name)`) }
  const fileHit = (admittedPaths.get(e.repo) ?? []).some((p) => p.endsWith(`/${leaf}`) || p === leaf)
  const symbolHit = (ks.decl.get(leaf) ?? 0) > 0
  if (fileHit || symbolHit) {
    falsifierHits++
    if (!exactHit) leafOnlyHits++
    if (falsifierExamples.length < 6) falsifierExamples.push(`${path.relative(CR, e.file)}:${e.line} -[${e.label}]-> ${e.tgt}  (${fileHit ? "FILE" : ""}${symbolHit ? " SYMBOL" : ""} answers the leaf "${leaf}")`)
  }
}

const sum = (f: (r: Row) => number): number => [...rows.values()].reduce((n, r) => n + f(r), 0)
console.log(`PROBE-MARKDOWN-EXTQ-SPLIT  ext=${EXTS.map((x) => "." + x).join(",")} nf=${NF} shard=${SHARD < 0 ? "(none)" : SHARD + "/" + SHARDS}`)
console.log(`SHARD-LINE shard=${SHARD < 0 ? "none" : SHARD} files=${files.length} parsed=${parsed} failed=${failed} FALLBACK-FILES=${fallbackFiles} FALLBACK-ROWS=${fallbackRows}`)
console.log(`  population ${files.length} of ${found.length} tracked files in ${repos.size} repos; parsed=${parsed} failed=${failed}`)
console.log(`  GATE COLUMNS: edges=${sum((r) => r.edges)} resolved=${sum((r) => r.resolved)} ofWhich=${sum((r) => r.resolvedAmongCollision)} amb=${sum((r) => r.ambiguousByDecl)} unres=${sum((r) => r.unresolved)} extOK=${sum((r) => r.externalVerified)} ext?=${sum((r) => r.externalUnverified)} extFAIL=${sum((r) => r.externalRefuted)}`)
console.log("")
console.log(`THE ${marked} CLAIMED EDGES, BY EMITTING SITE (from each edge's own published metadata)`)
for (const [site, v] of [...siteRows.entries()].sort((a, b) => b[1].edges - a[1].edges)) {
  const shapes = [...(siteShape.get(site) ?? new Map()).entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(" · ")
  console.log(`  ${site.padEnd(44)} ${String(v.edges).padStart(7)}  targets ${String(v.targets.size).padStart(6)}  ${shapes}`)
}
console.log("")
console.log(`SHAPE OF EVERY CLAIMED TARGET`)
for (const [k, v] of [...shapeRows.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(26)} ${v}`)
console.log("")
console.log(`FALSIFIER, RUN — does the project's own key space answer any claimed target?`)
console.log(`  SOUND TEST — the target ITSELF is a name the project publishes (a real refutation): ${exactRefuted} of ${marked}`)
// WHICH edge was refuted, named rather than counted — a count of 1 in 255,244 is either the first true
// false claim or a coincidence, and the difference is only visible if the edge is printed.
for (const x of refutedExamples) console.log(`     REFUTED: ${x}`)
console.log(`  UNSOUND TEST — the target's LEAF matches an admitted file or published symbol: ${falsifierHits} of ${marked} (${leafOnlyHits} of them leaf-only, i.e. coincidences a leaf-based checker would wrongly refute)`)
for (const x of falsifierExamples) console.log(`     ${x}`)
console.log("")
console.log(`THE UNRESOLVED \`uses\` COLUMN (${unresolvedUses.length} edges) BY SHAPE — the fixable half`)
const unresShape = new Map<string, number>()
for (const e of unresolvedUses) unresShape.set(shapeOf(e.tgt), (unresShape.get(shapeOf(e.tgt)) ?? 0) + 1)
for (const [k, v] of [...unresShape.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(26)} ${v}`)
const relUses = unresolvedUses.filter((e) => shapeOf(e.tgt) === "relative path")
const relResolvable = relUses.filter((e) => {
  const leaf = leafOf(e.tgt)
  return leaf.length > 0 && (admittedPaths.get(e.repo) ?? []).some((p) => p === e.tgt.toLowerCase().replace(/^\.\//, "") || p.endsWith(`/${e.tgt.toLowerCase().replace(/^\.\//, "")}`))
})
console.log(`  of the relative-path ones (${relUses.length}), the target file IS admitted in the project: ${relResolvable.length} — the CEILING of a file-scoped/resolved target for this column`)
