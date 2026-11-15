/**
 * WHERE EVERY `partition_by` NODE ACTUALLY SITS — the corpus-wide half of the pass-8 correction.
 *
 * ## WHY THIS FILE EXISTS
 *
 * The `extends` ruling is an instrument-A ruling: "no node type in the grammar's vocabulary expresses
 * a declaration naming a parent". Pass 3 supported it by searching all 480 node-type names for
 * substrings, and the page reported:
 *
 *   the two `partition` hits are a `table_partition` rule and a `keyword_partition` token
 *
 * **That is two of the three.** The corpus-wide vocabulary also contains a node type named exactly
 * `partition_by`, with 44 occurrences — the only one of the three whose name is not qualified by
 * `table_`, and therefore the one a reader checking the ruling would reach for first. A page that
 * names two of the three hits and does not say so is not a page whose `extends` ruling can be
 * audited, whatever the verdict.
 *
 * ## WHY A SUBSTRING COUNT CANNOT ANSWER THE QUESTION IT RAISES
 *
 * `partition_by` occurs 44 times, so the count alone does not say whether those 44 are the clause
 * that makes a child table a subtype of a parent. SQL uses `PARTITION BY` for two unrelated things:
 *
 *   - `CREATE TABLE p (...) PARTITION BY RANGE (x)` — a partitioning STRATEGY, and
 *   - `SELECT sum(x) OVER (PARTITION BY y)` — a WINDOW FUNCTION's ordering key.
 *
 * Only the first is about tables, and it names no parent; the second is not about tables at all. The
 * discriminator is the PARENT CHAIN, which is why this walks the tree and records it per site instead
 * of counting. A count could not tell them apart, and a count is what produced the two-of-three error.
 *
 * ## WHAT IT MEASURES, per site
 *
 *   chainFromRoot — node type up to `program`, nearest parent first
 *   namedChildren, fields, insideError — the shape, so a verdict can be re-derived rather than trusted
 *
 * ## USAGE
 *
 *   npx tsx validation/m14/fixtures/sql/partition-by-sites.mts [--out FILE] [--type NODE_TYPE]
 *
 * `--type` defaults to `partition_by`. The script is deliberately generic: the same walk answers
 * "where does node type X actually sit" for any node type a reader wants to challenge, which is the
 * question every instrument-A ruling eventually gets asked about its own near-miss names.
 *
 * ## WHAT IT DOES NOT CLAIM
 *
 * It reads the same 1,955 admitted files as the census, at 0 parse failures. It does not claim the
 * grammar cannot be patched: `extends` is classified `grammar+implementation` in
 * `SQL_RULING_FALSIFIABILITY`, and this file narrows WHICH clause is unreadable, not whether the
 * grammar could grow one.
 */
import { readFileSync, writeFileSync, statSync, readdirSync, mkdirSync } from "node:fs"
import * as path from "node:path"
import { execFileSync } from "node:child_process"
import { Parser, Language } from "web-tree-sitter"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..")
const CR = process.env.BB_CORPUS_ROOT || "/home/ishaq2321/bb_tests/repositories"
const argv = process.argv.slice(2)
const argOf = (f: string) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined }
const OUT = argOf("--out")
const TARGET = argOf("--type") || "partition_by"
/** Cap on stored sites, so a node type the grammar produces a million times cannot fill the artifact. */
const MAX_SITES = 2000

await Parser.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const language = await Language.load(readFileSync(path.join(ROOT, "wasm", "tree-sitter-sql.wasm")))
const parser = new Parser()
parser.setLanguage(language)

// The census's own admission rule, so this file and the census describe the same population: each
// corpus entry is its own git repository, so `ls-files` runs per repo and never at the root.
const files: string[] = []
for (const entry of readdirSync(CR)) {
  const dir = path.join(CR, entry)
  let st: any
  try { st = statSync(dir) } catch { continue }
  if (!st.isDirectory()) continue
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 1 << 28 })
      .split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    if (!/\.(sql|ddl)$/i.test(rel)) continue
    const abs = path.join(dir, rel)
    let size = 0
    try { size = statSync(abs).size } catch { continue }
    if (size <= 512 * 1024) files.push(abs)
  }
}

const sites: any[] = []
let n = 0
let parsed = 0
let parseFails = 0
for (const f of files) {
  let src: string
  try { src = readFileSync(f, "utf8") } catch { continue }
  let tree: any
  try { tree = parser.parse(src) } catch { parseFails++; continue }
  if (!tree) { parseFails++; continue }
  parsed++
  const stack = [tree.rootNode]
  while (stack.length) {
    const node = stack.pop()!
    if (node.type === TARGET) {
      n++
      if (sites.length < MAX_SITES) {
        const chain: string[] = []
        for (let p = node.parent; p; p = p.parent) chain.push(p.type)
        const namedChildren: string[] = []
        for (let i = 0; i < node.namedChildCount; i++) {
          const c = node.namedChild(i)
          namedChildren.push(`${c.type}: ${c.text.slice(0, 60).split("\n").join(" ")}`)
        }
        let insideError = false
        for (let p = node.parent; p; p = p.parent) if (p.type === "ERROR") { insideError = true; break }
        sites.push({
          file: path.relative(CR, f),
          line: node.startPosition.row + 1,
          text: node.text.slice(0, 140).split("\n").join(" "),
          chainFromRoot: chain,
          nearestParent: chain[0] ?? null,
          namedChildren,
          insideError,
        })
      }
    }
    for (let i = 0; i < node.childCount; i++) stack.push(node.child(i))
  }
  tree.delete?.()
}

const byNearestParent: Record<string, number> = {}
const byChain: Record<string, number> = {}
for (const s of sites) {
  const k = s.nearestParent ?? "(root)"
  byNearestParent[k] = (byNearestParent[k] ?? 0) + 1
  const c = s.chainFromRoot.slice(0, 5).join(" > ")
  byChain[c] = (byChain[c] ?? 0) + 1
}
// The question the ruling actually turns on: does the node ever sit inside a DECLARATION of a table?
// A `create_table` in the chain is not sufficient on its own, and the distinction is not academic —
// `CREATE TABLE … AS SELECT … OVER (PARTITION BY x)` puts a window function inside a create_table
// while partitioning nothing. `create_query` is the CTAS query node, so its presence in the chain is
// what separates a CTAS from a table-partitioning declaration, and the count is reported in three
// parts rather than folded into one.
const inDecl = sites.filter((s) => s.chainFromRoot.includes("create_table") || s.chainFromRoot.includes("alter_table"))
const inDeclCtas = inDecl.filter((s) => s.chainFromRoot.includes("create_query"))
const inDeclPartitioning = inDecl.filter((s) => !s.chainFromRoot.includes("create_query"))
const underWindowSpec = sites.filter((s) => s.nearestParent === "window_specification").length

const report = {
  instrument: "validation/m14/fixtures/sql/partition-by-sites.mts",
  entryPoint: "tree-sitter walk over wasm/tree-sitter-sql.wasm (no analyzer code, no text matching)",
  corpusRoot: CR,
  nodeTypeSearched: TARGET,
  admittedFiles: files.length,
  filesParsed: parsed,
  parseFailures: parseFails,
  occurrences: n,
  sitesStored: sites.length,
  sitesStoredCap: MAX_SITES,
  byNearestParent,
  byChainFirstFive: byChain,
  nearestParentWindowSpecification: underWindowSpec,
  insideCreateOrAlterTable: {
    total: inDecl.length,
    viaCtasCreateQuery: inDeclCtas.length,
    inAPartitioningDeclaration: inDeclPartitioning.length,
    ctasSites: inDeclCtas.map((s) => ({ file: s.file, line: s.line, chainFromRoot: s.chainFromRoot.slice(0, 12) })),
  },
  verdict: underWindowSpec !== n
    ? `${n - underWindowSpec} of ${n} occurrences have a nearest parent other than window_specification and need explaining`
    : inDeclPartitioning.length > 0
      ? `ALL ${n} occurrences are window-function clauses, but ${inDeclPartitioning.length} sit inside a NON-CTAS table declaration and need explaining`
      : `ALL ${n} occurrences sit under a window_specification, and ${inDecl.length === 0 ? "none" : `the ${inDecl.length} inside a create_table ${inDecl.length === 1 ? "is" : "are"} a CTAS (create_query in the chain)`} — no occurrence is a table-partitioning clause, so this node type names no parent table`,
}

console.log(`${TARGET} sites — ${parsed} files parsed, ${parseFails} parse failures`)
console.log(`occurrences: ${n}`)
console.log("nearest parent:")
for (const [k, v] of Object.entries(byNearestParent).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(5)}  ${k}`)
console.log(`nearest parent window_specification: ${underWindowSpec} of ${n}`)
console.log(`inside create_table/alter_table: ${inDecl.length} total, ${inDeclCtas.length} via a CTAS create_query, ${inDeclPartitioning.length} in a partitioning declaration`)
console.log(`verdict: ${report.verdict}`)

if (OUT) {
  mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true })
  writeFileSync(path.resolve(OUT), `${JSON.stringify({ ...report, sites }, null, 2)}\n`)
  console.log(`\nwrote ${OUT}`)
}