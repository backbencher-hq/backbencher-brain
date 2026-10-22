#!/usr/bin/env bun
/**
 * SQL LANE — THE `part_of` / `extends` SITE PROBE (the whole admitted population).
 *
 * THE QUESTION. The four EXTENDED values are adjudicated per lane against a POSITIVE
 * grammar-inventory basis: a cell is `RULED` only when the PINNED GRAMMAR cannot express the
 * construct, so no corpus count can exist. For sql the basis is the pinned
 * `wasm/tree-sitter-sql.wasm` node-type inventory (592 named types, enumerated from the wasm
 * itself, with CONTROLS that must be non-empty so a zero is distinguishable from an unreadable
 * enumeration):
 *
 *   renders   — no `jsx_*`, no `template*` node type                     => RULED
 *   decorates — no `decorator` node type                                 => RULED
 *   mixes_in  — no `mixin*`, no `with_clause` node type                 => RULED
 *   part_of   — **the grammar HAS `table_partition`**                    => NOT ruled by absence
 *
 * `table_partition` is the grammar's node for PostgreSQL's `PARTITION <spec>` clause, and it
 * covers TWO different constructs:
 *   * `PARTITION BY <strategy>` — a partitioning STRATEGY (`range`, `list`, `hash`). The
 *     surviving identifier is the PARTITION KEY, not a parent. NOT a constituent-part relation.
 *   * `PARTITION OF <parent>` — a partition table IS a constituent part of the partitioned table
 *     it names, which is what `part_of` means.
 *
 * So `part_of` is NOT excluded by grammar-absence, and the honest question is DERIVABILITY: does
 * the parent's name survive the parse in the `PARTITION OF` position? This probe measures that,
 * from the tree, over the whole admitted population, and prints the tree shape at every site so a
 * reader can check the claim rather than take it.
 *
 * IT ALSO MEASURES `extends`, because the same question ("does the parent's name survive?") is
 * the one that decides `CREATE TABLE c (...) INHERITS (p)` versus `ALTER TABLE c INHERIT p`.
 *
 * THE TEXT COUNTERS ARE A CORPUS PROPERTY, not a resolution mechanism: they answer "how many
 * such statements EXIST in the corpus", which is the denominator a zero-sites ruling needs. The
 * DERIVABILITY answer comes from the tree, and no edge is ever produced from a text match.
 *
 * USAGE  BB_CORPUS_ROOT="$PWD/.corpus" bun run script/m14/sql-part-of-sites.ts [--json <out>]
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { execFileSync } from "node:child_process"
import { getParser } from "../../src/ast/engine.ts"

const args = process.argv.slice(2)
const jsonOut = args.includes("--json") ? args[args.indexOf("--json") + 1] : ""
const ROOT = process.env.BB_CORPUS_ROOT ?? join(process.cwd(), ".corpus")
const CAP = 1_048_576

// ── the population, the GATE's rule, with the symlink rule (statSync FOLLOWS the link)
const admitted: string[] = []
let symlinkedDirsFollowed = 0
let repos = 0
{
  let entries: string[] = []
  try { entries = readdirSync(ROOT) } catch { entries = [] }
  for (const name of entries.sort()) {
    const dir = join(ROOT, name)
    let isDir = false
    try { isDir = statSync(dir).isDirectory() } catch { isDir = false }
    if (!isDir) continue
    try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
    repos++
    let tracked: string[] = []
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
        .split("\0").filter(Boolean)
    } catch { continue }
    for (const rel of tracked) {
      if (!rel.endsWith(".sql")) continue
      const abs = join(dir, rel)
      let size = -1
      try { size = statSync(abs).size } catch { continue }
      if (size < 0 || size > CAP) continue
      admitted.push(abs)
    }
  }
  try {
    for (const e of readdirSync(ROOT, { withFileTypes: true })) {
      if (!e.isSymbolicLink()) continue
      try { if (statSync(join(ROOT, e.name)).isDirectory()) symlinkedDirsFollowed++ } catch { /* dangling */ }
    }
  } catch { /* no corpus root */ }
}
admitted.sort()

/** THE CORPUS PROPERTY counters — how many such STATEMENTS exist, independent of the tree. */
const TEXT = {
  partitionOf: /\bpartition\s+of\b/gi,
  partitionBy: /\bpartition\s+by\b/gi,
  attachPartition: /\battach\s+partition\b/gi,
  inherits: /\binherits\b/gi,
  inheritSingular: /\binherit\b/gi,
  createOrReplace: /\bcreate\s+or\s+replace\b/gi,
}
const textCounts: Record<string, number> = {}
const textFiles: Record<string, Set<string>> = {}
for (const k of Object.keys(TEXT)) { textCounts[k] = 0; textFiles[k] = new Set() }

/** the TREE sites */
type Site = {
  file: string; line: number; column: number
  /** the node's own source text, first line */
  text: string
  /** the node's tree shape */
  shape: string
  /** the tree's CHILD node types */
  childTypes: string[]
  /** does the subtree contain a node whose text is the `of` keyword? */
  hasOfKeyword: boolean
  /** does the subtree contain a node whose text is the `by` keyword? */
  hasByKeyword: boolean
  /** the enclosing statement's node type */
  enclosing: string
}
const tablePartitionSites: Site[] = []
const inheritsSites: Site[] = []
const keywordInheritsNodes = { count: 0, files: new Set<string>() }

const parser = await getParser("sql")
for (const f of admitted) {
  let content: string
  try { content = readFileSync(f, "utf8") } catch { continue }
  for (const [k, re] of Object.entries(TEXT)) {
    re.lastIndex = 0
    const m = content.match(re)
    if (m && m.length) { textCounts[k] += m.length; textFiles[k].add(f) }
  }
  let pr: any
  try { pr = await parser.parse(content) } catch { continue }
  const stack: any[] = [pr.rootNode]
  while (stack.length) {
    const n = stack.pop()!
    const t = String(n.type)
    if (t === "keyword_inherits") { keywordInheritsNodes.count++; keywordInheritsNodes.files.add(f) }
    if (t === "table_partition" || t === "keyword_inherits") {
      // collect the subtree's child types and check for the of/by keywords
      const childTypes: string[] = []
      let hasOf = false, hasBy = false
      const inner: any[] = [n]
      while (inner.length) {
        const c = inner.pop()!
        const ct = String(c.type)
        if (ct !== n.type) childTypes.push(ct)
        const txt = String(c.text ?? "").toLowerCase()
        if (txt === "of") hasOf = true
        if (txt === "by") hasBy = true
        for (let i = 0; i < c.childCount; i++) { const k = c.child(i); if (k) inner.push(k) }
      }
      let stmt = n.parent
      while (stmt && stmt.type !== "program") stmt = stmt.parent
      const site: Site = {
        file: f,
        line: n.startPosition.row + 1,
        column: n.startPosition.column + 1,
        text: String(n.text ?? "").split("\n")[0].slice(0, 140),
        shape: String(n.toString()).slice(0, 260),
        childTypes: [...new Set(childTypes)],
        hasOfKeyword: hasOf,
        hasByKeyword: hasBy,
        enclosing: stmt ? String(stmt.type) : "?",
      }
      if (t === "table_partition") tablePartitionSites.push(site)
      else inheritsSites.push(site)
    }
    for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) stack.push(c) }
  }
}

const ofSites = tablePartitionSites.filter((s) => s.hasOfKeyword)
const bySites = tablePartitionSites.filter((s) => s.hasByKeyword)
const otherTp = tablePartitionSites.filter((s) => !s.hasOfKeyword && !s.hasByKeyword)

const report = {
  instrument: "script/m14/sql-part-of-sites.ts",
  population: { root: ROOT, admitted: admitted.length, repos, symlinkedDirsFollowed },
  textCorpusProperty: Object.fromEntries(Object.entries(textCounts).map(([k, v]) => [k, { occurrences: v, files: textFiles[k].size }])),
  tree: {
    table_partition_nodes: tablePartitionSites.length,
    table_partition_OF: ofSites.length,
    table_partition_BY: bySites.length,
    table_partition_other: otherTp.length,
    keyword_inherits_nodes: keywordInheritsNodes.count,
    keyword_inherits_files: keywordInheritsNodes.files.size,
  },
  ofSites, bySites, otherTp, inheritsSites,
}

console.log("═".repeat(78))
console.log("SQL — `part_of` / `extends` SITE PROBE (the whole admitted population)")
console.log("═".repeat(78))
console.log(`corpus root : ${ROOT}`)
console.log(`admitted    : ${admitted.length} .sql files across ${repos} repos · symlinked dirs followed: ${symlinkedDirsFollowed}`)
console.log("─".repeat(78))
console.log("CORPUS PROPERTY (text counters — how many such STATEMENTS exist):")
for (const [k, v] of Object.entries(report.textCorpusProperty)) {
  console.log(`  ${k.padEnd(18)} ${String(v.occurrences).padStart(5)} occurrences in ${v.files} files`)
}
console.log("─".repeat(78))
console.log("TREE (the derivability answer):")
console.log(`  table_partition nodes        : ${report.tree.table_partition_nodes}`)
console.log(`    … the PARTITION OF form     : ${report.tree.table_partition_OF}`)
console.log(`    … the PARTITION BY form     : ${report.tree.table_partition_BY}   (a STRATEGY, not a constituent part)`)
console.log(`    … neither                   : ${report.tree.table_partition_other}`)
console.log(`  keyword_inherits nodes        : ${report.tree.keyword_inherits_nodes} in ${report.tree.keyword_inherits_files} files`)
console.log("─".repeat(78))
for (const s of ofSites) {
  console.log(`PARTITION OF  ${s.file}:${s.line}:${s.column}`)
  console.log(`   text   : ${s.text}`)
  console.log(`   tree   : ${s.shape}`)
  console.log(`   children: ${s.childTypes.join(", ")}`)
}
for (const s of otherTp) {
  console.log(`OTHER TP     ${s.file}:${s.line}:${s.column}`)
  console.log(`   text   : ${s.text}`)
  console.log(`   tree   : ${s.shape}`)
}
console.log("═".repeat(78))
if (jsonOut) { writeFileSync(jsonOut, JSON.stringify(report, null, 2)); console.log(`JSON written: ${jsonOut}`) }
