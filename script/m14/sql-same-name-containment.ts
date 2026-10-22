/**
 * SQL — THE SAME-NAME CONTAINMENT DEFECT, SIZED OVER THE WHOLE ADMITTED POPULATION.
 *
 * THE DEFECT. `addRelationship` drops a `contains` edge whose SOURCE and TARGET BARE NAMES are equal:
 *
 *     if (source === target && type === ASTEngine.RelationshipType.Contains) return
 *
 * That guard exists to stop a declaration containing ITSELF. But a table and one of its COLUMNS may
 * legally share a name — `CREATE TABLE keyword (keyword VARCHAR, id INT)` — and then the two are
 * DIFFERENT declarations (different kinds: `class` and `property`; different ids: `keyword` and
 * `keyword.keyword`) that the BARE-NAME test cannot tell apart. The containment edge is DROPPED, and
 * so is the column's containment fact.
 *
 * WHY IT MATTERS AND WHY IT IS NOT A COSMETIC DEFECT: a column that is not contained by its table is
 * not in the table's shape, so every consumer that reads a table's members (a schema graph, an AI
 * agent reading the graph, a migration tool) loses the column. The differential MEASURED it as a
 * MISSING row, and a MISSING row is a truth the analyzer does not publish.
 *
 * WHAT THIS INSTRUMENT COUNTS, AND WHAT IT DOES NOT. It counts the sites where a table's member
 * shares the table's own name — the rows the guard drops. It does NOT count the guard's other
 * purpose (a genuine self-containment), because a genuine self-containment is impossible in SQL: a
 * table's members are always of a different kind than the table, and a file's members are never the
 * file.
 *
 * USAGE: bun run script/m14/sql-same-name-containment.ts [--json <out>]
 */
import { mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { execFileSync } from "node:child_process"
import { getParser } from "../../src/ast/engine.ts"
import { RealSqlAnalyzer } from "../../src/ast/real-sql-analyzer.ts"

const args = process.argv.slice(2)
const jsonOut = args.includes("--json") ? args[args.indexOf("--json") + 1] : ""
const ROOT = process.env.BB_CORPUS_ROOT ?? join(process.cwd(), ".corpus")
const CAP = 1_048_576
const EXT = ".sql"

const parser: any = await getParser("sql" as any)
// THE GRAMMAR HAND-OVER — on the CLASS. Without it the analyzer's recovery passes are SILENTLY INERT.
;(RealSqlAnalyzer as any).setGrammar(parser.language, parser.constructor)

function isRepo(dir: string): boolean {
  try {
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
    return true
  } catch {
    return false
  }
}
function tracked(dir: string): string[] {
  try {
    return execFileSync("git", ["-C", dir, "ls-files", "-z"], {
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
    })
      .split("\0")
      .filter(Boolean)
  } catch {
    return []
  }
}

const absFiles: string[] = []
const realSeen = new Set<string>()
let symlinkedDirs = 0
let overCap = 0
let absent = 0
let duplicate = 0
let dirEntries: string[] = []
try { dirEntries = readdirSync(ROOT).sort() } catch { dirEntries = [] }
for (const name of dirEntries) {
  const dir = join(ROOT, name)
  let isDir = false
  try { isDir = statSync(dir).isDirectory() } catch { isDir = false }
  if (!isDir || !isRepo(dir)) continue
  for (const rel of tracked(dir)) {
    if (!rel.endsWith(EXT)) continue
    const abs = join(dir, rel)
    let real = abs
    try { real = realpathSync(abs) } catch { /* absent below */ }
    if (realSeen.has(real)) { duplicate++; continue }
    realSeen.add(real)
    let size = -1
    try { size = statSync(abs).size } catch { /* absent */ }
    if (size < 0) { absent++; continue }
    if (size > CAP) { overCap++; continue }
    absFiles.push(abs)
  }
}

/** The members of a `create_table` / `alter_table` whose name EQUALS the owner's name. */
function membersSharingOwnerName(root: any): { kind: string; owner: string; member: string; line: number }[] {
  const out: { kind: string; owner: string; member: string; line: number }[] = []
  const named = (n: any): any[] => {
    const a: any[] = []
    for (let i = 0; i < (n?.namedChildCount ?? 0); i++) a.push(n.namedChild(i))
    return a
  }
  const desc = (n: any, t: string, acc: any[] = []): any[] => {
    if (!n) return acc
    if (n.type === t) acc.push(n)
    for (const c of named(n)) desc(c, t, acc)
    return acc
  }
  for (const ct of desc(root, "create_table")) {
    const kids = named(ct)
    const ownerNode = kids.find((c: any) => c.type === "object_reference")
    const owner = ownerNode ? (named(ownerNode)[0]?.text ?? "").replace(/^["`[]|["`\]]$/g, "") : ""
    if (!owner) continue
    const defs = kids.find((c: any) => c.type === "column_definitions")
    if (!defs) continue
    for (const cd of named(defs)) {
      if (cd.type !== "column_definition") continue
      const nm = named(cd)[0]
      if (!nm) continue
      const member = nm.text.replace(/^["`[]|["`\]]$/g, "")
      if (member === owner) out.push({ kind: "column", owner, member, line: nm.startPosition.row + 1 })
    }
  }
  return out
}

// THE EDGE CHECK — the defect was in the EDGE, not in the tree, so the instrument must measure the
// EDGE. Before the fix the containment edge for a same-named member was DROPPED (the guard compared
// BARE NAMES); after it the edge is published. So the instrument reports, per site, whether the
// containment edge is now present — which makes the fix falsifiable on the corpus rather than only
// on a fixture.
const sites: { file: string; kind: string; owner: string; member: string; line: number; edgePublished: boolean }[] = []
const perRepo: Record<string, number> = {}
let parsed = 0
let failures = 0
const t0 = Date.now()
for (const abs of absFiles) {
  let content = ""
  try { content = readFileSync(abs, "utf8") } catch { continue }
  let tree: any
  try { tree = parser.parse(content) } catch { failures++; continue }
  parsed++
  let res: any = null
  try { res = new RealSqlAnalyzer().analyze(tree.rootNode, content, abs) } catch { /* counted by the census */ }
  const rels: any[] = res?.relationships ?? []
  for (const s of membersSharingOwnerName(tree.rootNode)) {
    const edgePublished = rels.some(
      (r: any) => String(r.relationshipType ?? r.type) === "contains" && String(r.source ?? r.from) === s.owner && String(r.target ?? r.to) === s.member,
    )
    sites.push({ file: abs, ...s, edgePublished })
    const repo = abs.slice(ROOT.length + 1).split("/")[0]
    perRepo[repo] = (perRepo[repo] ?? 0) + 1
  }
}
const ms = Date.now() - t0

const report = {
  population: {
    admitted: absFiles.length,
    overCap,
    absent,
    duplicate,
    parsed,
    failures,
    ms,
    symlinkedDirsFollowed: symlinkedDirs,
  },
  defect: {
    name: "a table's member sharing the table's own name is dropped from the containment graph",
    guard: "src/ast/real-sql-analyzer.ts — `if (source === target && type === Contains) return`",
    sites: sites.length,
    files: new Set(sites.map((s) => s.file)).size,
    repos: Object.keys(perRepo).length,
    perRepo,
    byKind: sites.reduce<Record<string, number>>((a, s) => { a[s.kind] = (a[s.kind] ?? 0) + 1; return a }, {}),
    // THE FIX'S FALSIFIER, ON THE CORPUS: every site must now carry its containment edge. A site
    // whose edge is still missing would mean the guard still fires on a name collision, and this
    // number is what says so.
    edgePublished: sites.filter((s) => s.edgePublished).length,
    edgeStillMissing: sites.filter((s) => !s.edgePublished).length,
    rows: sites,
  },
}

console.log("═".repeat(78))
console.log("SQL — THE SAME-NAME CONTAINMENT DEFECT, SIZED")
console.log("═".repeat(78))
console.log(`admitted ${absFiles.length} files · parsed ${parsed} · failures ${failures} · ${ms} ms`)
console.log(`SITES where a table's member shares the table's own name: ${sites.length} in ${new Set(sites.map((s) => s.file)).size} files over ${Object.keys(perRepo).length} repos`)
for (const [k, v] of Object.entries(report.defect.byKind)) console.log(`  ${k}: ${v}`)
for (const s of sites.slice(0, 20)) console.log(`  ${s.file.slice(ROOT.length + 1)}  ${s.kind} "${s.member}" of "${s.owner}" (line ${s.line})  edge=${s.edgePublished ? "PUBLISHED" : "MISSING"}`)
if (jsonOut) {
  mkdirSync(dirname(jsonOut), { recursive: true })
  writeFileSync(jsonOut, JSON.stringify(report, null, 2))
  console.log(`JSON written: ${jsonOut}`)
}
