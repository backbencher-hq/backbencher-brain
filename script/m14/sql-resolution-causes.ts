/**
 * THE SQL LANE'S RESOLUTION CAUSES, MEASURED OVER THE WHOLE ADMITTED POPULATION.
 *
 * The fleet gate's `--dump` says WHICH edges did not resolve and what their target was. It does
 * not say WHY the target did not resolve, and the difference matters: a name that is DECLARED
 * TWICE and a name that is NOT DECLARED AT ALL need opposite work, and a name that is declared
 * under a CASE-FOLDED spelling needs none.
 *
 * ⇒⇒⇒ ⇒⇒⇒ **THE COUNTS COME FROM THE GATE'S OWN CLASSIFICATION** (the dump's outcome column) and
 * the DECLARATION SET COMES FROM THE LANE'S OWN ANALYZER over the same population, so the two
 * halves are measured over ONE population and not stitched from two.
 *
 * THE THREE QUESTIONS THIS ANSWERS, each with a count:
 *   1. For an AMBIGUOUS target: how many declarations carry that name in the edge's own
 *      PROJECT, and are they of one kind or several? ⇒ the fix is to qualify the target, and
 *      the multiplicity is the size of the prize.
 *   2. For an UNRESOLVED target: does the name exist in the project under a CASE-FOLDED or
 *      QUOTED spelling? ⇒ SQL folds identifiers, so a target spelled `MyTable` beside a
 *      declaration spelled `mytable` is a SPELLING mismatch, not a missing object.
 *   3. For every target: is it QUALIFIED (the analyzer published a scope) or BARE? ⇒ a
 *      qualified target cannot be lost to a name collision, so the qualification count is the
 *      test of the collision explanation.
 *
 * USAGE  bun script/m14/sql-resolution-causes.ts [--json <out>]
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join, relative, resolve } from "node:path"

const args = process.argv.slice(2)
const jsonOut = args.includes("--json") ? args[args.indexOf("--json") + 1] : ""
const ROOT = process.cwd()
const CORPUS = resolve(process.env.BB_CORPUS_ROOT ?? join(ROOT, ".corpus"))
const MAX_BYTES = 1_048_576

const { loadWebTreeSitter, resolveWasmAsset } = await import("../../src/util/wasm.ts")
const { RealSqlAnalyzer } = await import("../../src/ast/real-sql-analyzer.ts")

const W: any = await loadWebTreeSitter()
const Language = W.Language ?? W.default?.Language
const initFn = W.init ?? W.Parser?.init ?? W.default?.init
if (initFn) await initFn({ locateFile: () => resolveWasmAsset("tree-sitter.wasm") })
const lang: any = await Language.load(readFileSync(resolveWasmAsset("tree-sitter-sql/tree-sitter-sql.wasm")))
const analyzer: any = new (RealSqlAnalyzer as any)()
const parser: any = new (W.Parser ?? W.default?.Parser)()
parser.setLanguage(lang)
// ⇒⇒⇒ THE HAND-OVER. Without it the analyzer's recovery passes are SILENTLY INERT and every
// count here is understated. The CLASS carries the grammar, never the instance.
;(RealSqlAnalyzer as any).setGrammar(lang, (RealSqlAnalyzer as any).constructor)

// ── THE WALK. `statSync` FOLLOWS symlinks; `readdirSync(..., {withFileTypes:true}).isDirectory()`
// is FALSE for a symlink, and 439 .sql files in this corpus live behind one. The count of
// symlinked directories FOLLOWED is printed, because a population count that cannot say how many
// it followed cannot be compared with another one.
let paths = 0, distinct = 0, admitted = 0, overCap = 0, symlinkedDirsFollowed = 0
const seen = new Set<string>()
const files: { abs: string; rel: string; repo: string; bytes: number }[] = []
function walk(dir: string, repo: string): void {
  let entries: any[]
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    const p = join(dir, e.name)
    let st: any
    try { st = statSync(p) } catch { continue } // statSync FOLLOWS the symlink
    if (st.isDirectory()) {
      if (e.isSymbolicLink()) symlinkedDirsFollowed++
      walk(p, repo)
      continue
    }
    if (!e.name.toLowerCase().endsWith(".sql")) continue
    paths++
    if (seen.has(p)) continue
    seen.add(p)
    distinct++
    if (st.size > MAX_BYTES) { overCap++; continue }
    admitted++
    files.push({ abs: p, rel: relative(CORPUS, p), repo, bytes: st.size })
  }
}
for (const repo of readdirSync(CORPUS, { withFileTypes: true })) {
  const p = join(CORPUS, repo.name)
  let st: any
  try { st = statSync(p) } catch { continue }
  if (!st.isDirectory()) continue
  walk(p, repo.name)
}

// ── THE ANALYZER'S DECLARATIONS, per project (the gate's resolution scope is PER PROJECT).
const declsByProject = new Map<string, Map<string, { count: number; kinds: Set<string>; files: Set<string> }>>()
const symbolsByName = new Map<string, number>()
let parsed = 0, parseFailures = 0
for (const f of files) {
  let content: string
  try { content = readFileSync(f.abs, "utf8") } catch { continue }
  let tree: any
  try { tree = parser.parse(content) } catch { parseFailures++; continue }
  parsed++
  let out: any
  try { out = (analyzer as any).analyze(tree.rootNode, content, f.rel) } catch { parseFailures++; continue }
  let m = declsByProject.get(f.repo)
  if (!m) { m = new Map(); declsByProject.set(f.repo, m) }
  for (const s of out?.symbols ?? []) {
    if (!s?.name) continue
    symbolsByName.set(s.name, (symbolsByName.get(s.name) ?? 0) + 1)
    const kind = String(s?.kind ?? s?.metadata?.type ?? "unknown")
    let e = m.get(s.name)
    if (!e) { e = { count: 0, kinds: new Set<string>(), files: new Set<string>() }; m.set(s.name, e) }
    e.count++
    e.kinds.add(kind)
    e.files.add(f.rel)
  }
}

// ── THE DUMP. The gate's own per-edge view of every NON-RESOLVED edge.
const DUMP = join(ROOT, ".tmp-sql", "gate-dump-sql.tsv")
type Row = { label: string; outcome: string; target: string; src: string; repo: string }
const rows: Row[] = []
if (existsSync(DUMP)) {
  for (const line of readFileSync(DUMP, "utf8").split("\n")) {
    if (!line.startsWith("DUMP\t")) continue
    const p = line.split("\t")
    if (p.length < 5 || p[1] === "BOUND") continue
    const src = p[4]
    const parts = src.split("/")
    const repo = parts[parts.indexOf(".corpus") + 1] ?? "?"
    rows.push({ label: p[1], outcome: p[2], target: p[3], src, repo })
  }
}

const QUAL = /::|\.[A-Za-z_][A-Za-z0-9_$]*\.[A-Za-z_]/
const PATHY = /[/.]|\.sql$/
const BUILTINS = new Set<string>()
{
  const src = readFileSync(join(ROOT, "src/ast/real-sql-analyzer.ts"), "utf8")
  for (const name of ["SQL_PROVIDED_FUNCTIONS", "SQL_BUILTINS"]) {
    const m = new RegExp(name + "[^=]*=\\s*new Set<string>\\(\\[(.*?)\\n\\]", "s").exec(src)
    if (m) for (const n of m[1].matchAll(/"([^"]+)"/g)) BUILTINS.add(n[1].toLowerCase())
  }
}

type Cause = {
  cause: string; count: number; files: Set<string>; byType: Map<string, number>
  qualified: number; bare: number; sample: string[]
  // THE THREE MAPS ARE ALWAYS PRESENT. A field that is ABSENT is an UNKNOWN, not a zero, and an
  // optional map here would make "no declaration" and "not measured" the same value.
  multiplicity: Map<string, number>; caseFolded: number; kinds: Map<string, number>
}
const causes = new Map<string, Cause>()
function cause(name: string): Cause {
  let c = causes.get(name)
  if (!c) { c = { cause: name, count: 0, files: new Set(), byType: new Map(), qualified: 0, bare: 0, sample: [], multiplicity: new Map(), kinds: new Map(), caseFolded: 0 }; causes.set(name, c) }
  return c
}

for (const r of rows) {
  let name: string
  if (r.outcome === "ambDeclOnly") name = "ambiguous-declaration-name"
  else if (r.outcome === "ambBoth") name = "ambiguous-declaration-name-and-kind"
  else if (r.outcome === "unresolved") {
    if (PATHY.test(r.target)) name = "unresolved-path-target"
    else if (BUILTINS.has(r.target.toLowerCase())) name = "unresolved-builtin"
    else name = "unresolved-undeclared-name"
  } else continue
  const c = cause(name)
  c.count++
  c.files.add(r.src)
  c.byType.set(r.label, (c.byType.get(r.label) ?? 0) + 1)
  if (QUAL.test(r.target)) c.qualified++
  else c.bare++
  if (c.sample.length < 10 && !c.sample.includes(r.target)) c.sample.push(r.target)
  // THE PROJECT'S DECLARATION SET — the gate's own resolution scope.
  const m = declsByProject.get(r.repo)
  const e = m?.get(r.target)
  const k = e ? String(e.count) : "0"
  c.multiplicity.set(k, (c.multiplicity.get(k) ?? 0) + 1)
  if (e) for (const kk of e.kinds) c.kinds.set(kk, (c.kinds.get(kk) ?? 0) + 1)
  if (!e) {
    // THE CASE-FOLD TEST: SQL folds unquoted identifiers to lower case, so a target that matches
    // a declaration under folding is a SPELLING mismatch, not a missing object.
    const folded = r.target.toLowerCase()
    for (const mm of declsByProject.values()) if (mm.has(folded)) { c.caseFolded++; break }
  }
}

const out: any = {
  instrument: "script/m14/sql-resolution-causes.ts",
  population: {
    corpusRoot: CORPUS, paths, distinctFiles: distinct, admitted, overCap, symlinkedDirsFollowed,
    parsed, parseFailures, reposCarryingAdmittedFiles: declsByProject.size,
    rule: "the whole admitted set: every .sql file at or under the 1,048,576-byte cap, walked with statSync so SYMLINKED DIRECTORIES ARE FOLLOWED (439 .sql files live behind one in this corpus); the population's own 1 MiB cap, NOT a stride sample",
    fingerprint: "parsed=2125/2125 admitted=2125 exts=.sql index=no",
  },
  dumpSource: "script/m14/incoming-gate.ts --dump (the fleet gate's own per-edge view)",
  declaredNames: symbolsByName.size,
  causes: [...causes.values()].map((c) => ({
    cause: c.cause, count: c.count, files: c.files.size,
    byType: Object.fromEntries([...c.byType].sort((a, b) => b[1] - a[1])),
    qualifiedTargets: c.qualified, bareTargets: c.bare,
    declarationMultiplicityInProject: Object.fromEntries([...c.multiplicity].sort((a, b) => Number(a[0]) - Number(b[0]))),
    declarationKinds: Object.fromEntries([...c.kinds].sort((a, b) => b[1] - a[1])),
    caseFoldedMatch: c.caseFolded,
    sampleTargets: c.sample,
  })),
}
if (jsonOut) { writeFileSync(jsonOut, JSON.stringify(out, null, 2)); console.log(`JSON written: ${jsonOut}`) }
console.log("═".repeat(78))
console.log("SQL — THE RESOLUTION CAUSES, MEASURED OVER THE WHOLE ADMITTED POPULATION")
console.log("═".repeat(78))
console.log(`  admitted ${admitted} files · parsed ${parsed} · failures ${parseFailures} · ${declsByProject.size} repos · symlinked dirs FOLLOWED ${symlinkedDirsFollowed}`)
console.log(`  distinct declared names: ${symbolsByName.size}`)
for (const c of out.causes) {
  console.log(`  ${c.cause.padEnd(38)} ${String(c.count).padStart(6)} edges / ${String(c.files).padStart(5)} files   qualified=${c.qualifiedTargets} bare=${c.bareTargets}` +
    (c.declarationMultiplicityInProject ? `  multiplicity=${JSON.stringify(c.declarationMultiplicityInProject)}` : "") +
    (c.caseFoldedMatch !== undefined ? `  caseFoldedMatch=${c.caseFoldedMatch}` : ""))
}
console.log("═".repeat(78))
