#!/usr/bin/env bun
/**
 * SQL LANE — THE POPULATION CENSUS AND THE 14-TYPE CLASSIFICATION INPUT.
 *
 * WHAT THIS IS. One instrument that answers the three questions the lane brief (§1, §3) makes
 * the lane answer, on ONE population, with the population's rule named:
 *
 *   1. THE POPULATION — PATHS · DISTINCT FILES · ADMITTED, each with its rule, plus the count of
 *      SYMLINKED DIRECTORIES THE WALK FOLLOWED, printed because a walk that silently follows
 *      links is as unauditable as one that silently skips them.
 *   2. THE EMISSION — every relationship type the analyzer emits, over the WHOLE admitted
 *      population: edges · files · repos.
 *   3. THE CONSTRUCT SITES — for every type the analyzer does NOT emit, the number of AST
 *      positions in the whole population that COULD produce it, counted FROM THE TREE and
 *      independently of the analyzer. `sites = 0` is the only evidence that can support a
 *      zero-sites ruling; `sites > 0` with `edges = 0` is a GAP, not an absence.
 *
 * WHY IT IS NOT THE GATE. The gate (`script/m14/incoming-gate.ts`) is the RESOLUTION instrument
 * and the Lead's. This is the EMISSION instrument, and it exists because the gate's TABLE 1
 * reports resolved classes, not the raw per-type row population the classification needs, and
 * because the lane needs its own count of construct sites to tell "the corpus is quiet" from
 * "the analyzer is blind".
 *
 * THE SYMLINK RULE, AND WHY IT IS IN A FILE THAT PRINTS IT. `readdirSync(dir, {withFileTypes:true})`
 * reports a symlink with `isDirectory() === false`. A walk that uses `Dirent.isDirectory()` on a
 * corpus of symlinked repositories drops every one of them, silently. MEASURED on this lane's
 * corpus: 439 `.sql` files — 22.3% of the population and ~48% of the edges — live behind
 * `repositories/proxicall -> $HOME/ProxiCall`, and the census read 1,526 files where
 * the truth is 1,965. This walk therefore uses `statSync(p).isDirectory()` (which FOLLOWS the
 * link) with a `realpathSync` cycle guard, and PRINTS the number of symlinked directories it
 * followed. A number that changes when the walk changes is a number you cannot cite.
 *
 * USAGE
 *   BB_CORPUS_ROOT="$PWD/.corpus" bun run script/m14/sql-population.ts [--json <out>] [--pools]
 */
import { readFileSync, readdirSync, statSync, realpathSync, writeFileSync } from "node:fs"
import { join, relative } from "node:path"
import { execFileSync } from "node:child_process"
import { getParser } from "../../src/ast/engine.ts"
import { RelationshipType } from "../../src/ast/types.ts"

const args = process.argv.slice(2)
const jsonOut = args.includes("--json") ? args[args.indexOf("--json") + 1] : ""
const ROOT = process.env.BB_CORPUS_ROOT ?? join(process.cwd(), ".corpus")
const EXT = ".sql"
/** The engine's own FULL_AST_LIMIT — the cap the GATE admits by, so this census and the gate
 *  describe the same population rather than two populations that look alike. */
const CAP = 1_048_576

/** THE 14 — the live vocabulary. `n` is this list minus cited grammar-absence. */
const FOURTEEN = [
  "calls", "extends", "implements", "uses", "imports", "exports",
  "contains", "references", "overrides", "instantiates",
  "decorates", "renders", "mixes_in", "part_of",
]

type WalkStats = {
  symlinkedDirsFollowed: number
  symlinkedDirs: string[]
  symlinkedFilesFollowed: number
  repos: number
  /** the number of git repositories in the corpus, INCLUDING the ones that carry no `.sql` file */
  corpusGitRepos: number
  /** PATHS — every tracked `.sql` path the walk found, before dedup and before the size cap. */
  paths: number
  /** DISTINCT FILES — PATHS after dedup by realpath, so a repository reachable through two
   *  symlinks is counted once. */
  distinctFiles: number
  /** ADMITTED — DISTINCT FILES that also exist on disk and are within the engine's size cap. */
  admitted: number
  overCap: number
  overCapLargest: number
  absent: number
  /** the tracked-but-not-admitted paths, by reason — an exclusion that is not counted is silent. */
  excluded: { overCap: string[]; absent: string[]; duplicate: number }
}

const stats: WalkStats = {
  symlinkedDirsFollowed: 0, symlinkedDirs: [], symlinkedFilesFollowed: 0, repos: 0, corpusGitRepos: 0,
  paths: 0, distinctFiles: 0, admitted: 0, overCap: 0, overCapLargest: 0, absent: 0,
  excluded: { overCap: [], absent: [], duplicate: 0 },
}

/** PATHS: every tracked `.sql` path under a git checkout in the corpus root. */
const pathSet = new Set<string>()
const realSet = new Set<string>()
const admittedAbs: string[] = []
const repoSeen = new Set<string>()
const perRepoFiles: Record<string, number> = {}
const repoOfAbs = new Map<string, string>()

function gitTracked(dir: string): string[] {
  try {
    return execFileSync("git", ["-C", dir, "ls-files", "-z"], {
      encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
    }).split("\0").filter(Boolean)
  } catch { return [] }
}

function isRepo(dir: string): boolean {
  try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }); return true }
  catch { return false }
}

{
  let entries: string[] = []
  try { entries = readdirSync(ROOT) } catch { entries = [] }
  for (const name of entries.sort()) {
    const dir = join(ROOT, name)
    // A SYMLINKED REPOSITORY IS STILL A REPOSITORY. `statSync` FOLLOWS the link; `Dirent.isDirectory()`
    // does not, and that is the whole defect this file exists to not repeat.
    let isDir = false
    try { isDir = statSync(dir).isDirectory() } catch { isDir = false }
    if (!isDir) continue
    const isLink = (() => { try { return statSync(dir).isDirectory() && !readdirSync(dir).length ? false : false } catch { return false } })()
    void isLink
    if (!isRepo(dir)) continue
    stats.corpusGitRepos++
    for (const rel of gitTracked(dir)) {
      if (!rel.endsWith(EXT)) continue
      const abs = join(dir, rel)
      pathSet.add(abs)
      let real = abs
      try { real = realpathSync(abs) } catch { /* dangling — counted as absent below */ }
      if (realSet.has(real)) { stats.excluded.duplicate++; continue }
      realSet.add(real)
      let size = -1
      try { size = statSync(abs).size } catch { /* absent */ }
      if (size < 0) { stats.absent++; stats.excluded.absent.push(abs); continue }
      if (size > CAP) {
        stats.overCap++; stats.overCapLargest = Math.max(stats.overCapLargest, size)
        stats.excluded.overCap.push(abs); continue
      }
      admittedAbs.push(abs)
      // THE REPO COUNT THE CELL MUST CARRY: the repositories that CARRY an admitted `.sql` file — NOT
      // the number of git repositories in the corpus. Measured 2026-10-21: the corpus holds 202 git
      // repositories (199 of them symlinked) and only **21** carry an admitted `.sql` file — duckdb 594 ·
      // boundary 486 · proxicall 438 · hasura-engine 347 · pixie 161 · postgrest 32 · sqlite 13 · 14 more
      // with 1–9 each. The gate's own walk counts it the same way (`incoming-gate.ts:526` —
      // `repos.add(name)` per ADMITTED file) and prints 21, and the two must agree or the cell's repo
      // count is a different number from the gate's. A census that reported 202 here would over-count
      // the projects by an order of magnitude, and the per-type REPOS rows would be the same number
      // while the population line was not.
      if (!repoSeen.has(name)) { repoSeen.add(name); stats.repos++; perRepoFiles[name] = (perRepoFiles[name] ?? 0) + 1 }
      repoOfAbs.set(abs, name)
    }
  }
}
stats.paths = pathSet.size
stats.distinctFiles = realSet.size
stats.admitted = admittedAbs.length
admittedAbs.sort()

/** The symlinked-directory count is measured by RE-WALKING the corpus root's own entries and
 *  asking which of the repository directories are symlinks. Printing it is the point: a walk
 *  whose symlink behaviour is invisible cannot be compared against another walk. */
{
  let entries: import("node:fs").Dirent[] = []
  try { entries = readdirSync(ROOT, { withFileTypes: true }) } catch { entries = [] }
  for (const e of entries) {
    if (!e.isSymbolicLink()) continue
    const p = join(ROOT, e.name)
    let isDir = false
    try { isDir = statSync(p).isDirectory() } catch { isDir = false }
    if (!isDir) { stats.symlinkedFilesFollowed++; continue }
    stats.symlinkedDirsFollowed++
    stats.symlinkedDirs.push(e.name)
  }
}

// ── the analyzer
const m: any = await import("../../src/ast/real-sql-analyzer.ts")
const Cls = Object.values(m).find((v: any) => typeof v === "function" && /Analyzer$/.test(v.name)) as any
if (!Cls) throw new Error("no analyzer class exported")

// ── CONSTRUCT SITES, counted from the TREE, for every type the analyzer does not emit.
// Each entry is the exact grammar node that would carry the relationship, so `sites = 0` is
// evidence about the CORPUS and about the GRAMMAR's reach, not about the analyzer.
const SITE_NODES: Record<string, string[]> = {
  implements: ["keyword_implements", "implements_clause", "implements_statement"],
  exports: ["keyword_export", "export_statement", "export_clause", "export_database"],
  extends: ["keyword_inherits", "keyword_inherit", "inherits_clause"],
  decorates: ["decorator", "annotation", "decorated_definition"],
  renders: ["jsx_element", "template", "template_element", "interpolation"],
  mixes_in: ["mixin", "with_clause", "mixin_clause"],
  part_of: ["part_of_clause", "package_spec"],
}
const siteTally: Record<string, number> = {}
const siteFiles: Record<string, Set<string>> = {}
for (const k of Object.keys(SITE_NODES)) { siteTally[k] = 0; siteFiles[k] = new Set() }

/** EVERY node type the grammar produced, so the classification can say what the grammar HAS. */
const nodeTypeTally = new Map<string, number>()

const ambiguityTotals: Record<string, number> = {}
const ambiguityFiles: Record<string, Set<string>> = {}
const perType: Record<string, { edges: number; files: Set<string>; repos: Set<string> }> = {}
for (const t of FOURTEEN) perType[t] = { edges: 0, files: new Set(), repos: new Set() }

/** every emitted row, kept for the 14-type classification's per-type detail */
type Row = { file: string; repo: string; type: string; source: string; target: string; meta: any }
const rows: Row[] = []

let parsed = 0
let parseFailures = 0
const failures: string[] = []
const t0 = Date.now()

const parser = await getParser("sql")
/**
 * ⚠ THE GRAMMAR HAND-OVER, AND WHY IT IS NOT OPTIONAL.
 *
 * `analyze` is SYNCHRONOUS and `Language.load` is not, so the analyzer cannot build a parser for
 * its own recovery passes. It gets one from the caller: the engine does this in `parseRaw`
 * (`src/ast/engine.ts:1705-1714`) and the fixture runner does it explicitly
 * (`script/m14/run-fixtures.ts:765-769`, whose comment records that WITHOUT it "every recovery
 * pass was INERT in the fixture lane").
 *
 * WITHOUT THIS LINE, the SQL analyzer's DECLARATION-RESYNC pass and its EXECUTE-LITERAL pass are
 * BOTH SILENTLY INERT: `acquireParser()` fails, the pass takes its `resyncSkipped` /
 * `executeSkipped` branch and returns, and the file is reported as analysed anyway. A census that
 * omits the hand-over therefore reports SMALLER counts than the analyzer really produces, with no
 * error and no counter visible — the exact "the instrument is not measuring the thing" failure.
 * (This lane's own census omitted it until 2026-10-21, when the EXECUTE pass was found to be
 * silent in a probe and the hand-over was found to be the reason.)
 */
{
  // `Cls` IS the class, so the static hand-over lives on `Cls` itself. (The fixture runner
  // writes `analyzer.constructor.setGrammar` because IT holds an INSTANCE; `Class.constructor`
  // is `Function`, and calling `Function.setGrammar` throws — a hand-over that silently does
  // nothing is the same as no hand-over at all.)
  const ctor: any = Cls
  if (typeof ctor?.setGrammar === "function") {
    try { ctor.setGrammar((parser as any).language, (parser as any).constructor) } catch { /* no grammar */ }
  }
}
for (const f of admittedAbs) {
  let content: string
  try { content = readFileSync(f, "utf8") } catch { parseFailures++; failures.push(f); continue }
  try {
    const pr = await parser.parse(content)
    if (!pr) { parseFailures++; failures.push(f); continue }
    // the node-type census, from the tree
    const stack = [pr.rootNode]
    while (stack.length) {
      const n = stack.pop()!
      const nt = String(n.type)
      nodeTypeTally.set(nt, (nodeTypeTally.get(nt) ?? 0) + 1)
      for (const k of Object.keys(SITE_NODES)) {
        if (SITE_NODES[k].includes(nt)) { siteTally[k]++; siteFiles[k].add(f) }
      }
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i)
        if (c) stack.push(c)
      }
    }
    const res = new Cls().analyze(pr.rootNode, content, f)
    parsed++
    // THE ANALYZER'S OWN SUPPRESSION COUNTERS, AGGREGATED. A suppression that is not counted is a
    // number nobody can audit, and the campaign has already paid for that shape twice in this lane
    // (the `inherit` reserved-name guard, and the silent same-name containment drop).
    const amb = (res.metadata as any)?.ambiguity as Record<string, number> | undefined
    if (amb) {
      for (const [k, v] of Object.entries(amb)) {
        if (typeof v !== "number") continue
        ambiguityTotals[k] = (ambiguityTotals[k] ?? 0) + v
        if (v > 0) {
          if (!ambiguityFiles[k]) ambiguityFiles[k] = new Set<string>()
          ambiguityFiles[k].add(f)
        }
      }
    }
    const repo = repoOfAbs.get(f) ?? "?"
    for (const r of (res.relationships || [])) {
      const t = String((r as any).relationshipType ?? (r as any).type)
      if (!perType[t]) continue
      perType[t].edges++
      perType[t].files.add(f)
      perType[t].repos.add(repo)
      rows.push({
        file: f, repo, type: t,
        source: String((r as any).source ?? (r as any).from ?? ""),
        target: String((r as any).target ?? (r as any).to ?? ""),
        meta: (r as any).metadata ?? null,
      })
    }
  } catch (e) {
    parseFailures++
    failures.push(f)
  }
}
const ms = Date.now() - t0

// ── the report
const typeRows = FOURTEEN.map((t) => ({
  type: t,
  edges: perType[t].edges,
  files: perType[t].files.size,
  repos: perType[t].repos.size,
  sites: t in siteTally ? siteTally[t] : null,
  siteFiles: t in siteFiles ? siteFiles[t].size : null,
}))

const report = {
  instrument: "script/m14/sql-population.ts",
  // THE ANALYZER'S OWN SUPPRESSION COUNTERS over the whole population. `sameNameContainmentSuppressed`
  // is the one this lane added on 2026-10-21: the `contains` edge whose source and target bare NAMES
  // were equal, which silently dropped a real declaration. It reads 0 now because the guard tests
  // the DECLARATION IDENTITY instead of the name.
  ambiguity: Object.fromEntries(
    Object.keys(ambiguityTotals)
      .sort()
      .map((k) => [k, { total: ambiguityTotals[k], files: ambiguityFiles[k]?.size ?? 0 }]),
  ),
  corpus_root: ROOT,
  corpus_root_absolute: ROOT.startsWith("/") ? ROOT : join(process.cwd(), ROOT),
  population: {
    rule_PATHS: "every tracked `.sql` path under a git checkout in the corpus root (git ls-files)",
    rule_DISTINCT: "PATHS deduped by realpath, so a repository reachable through two symlinks counts once",
    rule_ADMITTED: "DISTINCT files that exist on disk AND are <= 1,048,576 bytes (the engine's FULL_AST_LIMIT, the gate's SIZE_CAP)",
    paths: stats.paths,
    distinctFiles: stats.distinctFiles,
    admitted: stats.admitted,
    repos: stats.repos,
    corpusGitRepos: stats.corpusGitRepos,
    reposWithAdmittedSql: stats.repos,
    perRepoAdmittedFiles: perRepoFiles,
    symlinkedDirsFollowed: stats.symlinkedDirsFollowed,
    symlinkedDirs: stats.symlinkedDirs,
    symlinkedFilesFollowed: stats.symlinkedFilesFollowed,
    excluded: { overCap: stats.overCap, overCapLargest: stats.overCapLargest, absent: stats.absent, duplicate: stats.excluded.duplicate },
  },
  parse: { parsed, failures: parseFailures, ms, msPerFile: parsed ? +(ms / parsed).toFixed(3) : null },
  types: typeRows,
  grammarNodeTypes: nodeTypeTally.size,
  grammarNodeTypeHistogram: Object.fromEntries([...nodeTypeTally.entries()].sort((a, b) => b[1] - a[1])),
}

console.log("═".repeat(78))
console.log("SQL LANE — POPULATION CENSUS AND 14-TYPE CLASSIFICATION INPUT")
console.log("═".repeat(78))
console.log(`corpus root (ABSOLUTE) : ${report.corpus_root_absolute}`)
console.log(`repos carrying .sql     : ${stats.repos}   (of ${stats.corpusGitRepos} git checkouts in the corpus)`)
console.log(`PATHS                  : ${stats.paths}   (tracked .sql paths)`)
console.log(`DISTINCT FILES         : ${stats.distinctFiles}   (deduped by realpath)`)
console.log(`ADMITTED               : ${stats.admitted}   (<= 1,048,576 bytes, present on disk)`)
console.log(`  symlinked dirs FOLLOWED: ${stats.symlinkedDirsFollowed}  ${stats.symlinkedDirs.length ? "-> " + stats.symlinkedDirs.join(", ") : ""}`)
console.log(`  symlinked files followed: ${stats.symlinkedFilesFollowed}`)
console.log(`  excluded: overCap ${stats.overCap} (largest ${stats.overCapLargest} bytes) · absent ${stats.absent} · duplicate ${stats.excluded.duplicate}`)
console.log(`parsed ${parsed} · failures ${parseFailures} · ${ms} ms · ${report.parse.msPerFile} ms/file`)
console.log("─".repeat(78))
console.log("TYPE            EDGES      FILES     REPOS   SITES   SITE-FILES")
for (const r of typeRows) {
  console.log(
    r.type.padEnd(15) +
    String(r.edges).padStart(6) +
    String(r.files).padStart(10) +
    String(r.repos).padStart(9) +
    (r.sites === null ? "".padStart(9) : String(r.sites).padStart(8)) +
    (r.siteFiles === null ? "".padStart(12) : String(r.siteFiles).padStart(11)),
  )
}
console.log("─".repeat(78))
console.log(`grammar node types produced (whole population): ${nodeTypeTally.size}`)
if (parseFailures) {
  console.log(`PARSE FAILURES (${parseFailures}):`)
  for (const f of failures.slice(0, 20)) console.log("  " + f)
}
console.log("═".repeat(78))

if (jsonOut) {
  writeFileSync(jsonOut, JSON.stringify({ ...report, rows: rows.slice(0, 0) }, null, 2))
  console.log(`JSON written: ${jsonOut}`)
}
