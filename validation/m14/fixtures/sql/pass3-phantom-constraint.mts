/**
 * SQL PASS-3 DEFECT PROBE — a `constant` symbol the file never declares.
 *
 * THE DEFECT. `processConstraint` reads a constraint's name from the identifier after
 * `keyword_constraint` (`CONSTRAINT <name> …`). When there is no `CONSTRAINT` keyword it falls back to
 * `childForFieldName("name")` and then to `directChild(node, "identifier")` — a fallback added for
 * MySQL's `UNIQUE KEY <name> (cols)`, where the index name IS a direct identifier.
 *
 * The grammar says that shape is not unique. For a FOREIGN KEY with no name:
 *
 *   constraint
 *     keyword_foreign  keyword_key
 *     ordered_columns (a, b)          <- the LOCAL columns, nested in `column` nodes
 *     keyword_references
 *     object_reference u
 *     identifier x                    <- DIRECT children: the REFERENCED table's columns
 *     identifier y
 *
 * so `directChild(node, "identifier")` returns `x` — a column of ANOTHER table — and the analyzer
 * publishes `constant:x` owned by the referencing table. `CREATE TABLE auth_account` in
 * `boundary/internal/db/schema/migrations/oss/postgres/0/07_auth.up.sql` yields two such phantoms
 * (`constant:scope_id` at lines 90 and 94, one per foreign key, both named after `auth_method`'s
 * first column).
 *
 * This is a FABRICATED DECLARATION, which is the most expensive mistake available: it inflates the
 * symbol census, and it is what makes a `contains` target ambiguous (a column `scope_id` and two
 * phantom constants `scope_id` under one owner — the exact collision `memberKind` was added for, and
 * the reason `memberKind` alone could not close all 100).
 *
* THE TEST, and why it cannot pass by accident. A phantom is only counted when the SAME file declares
 * a `property` with that name and that `ownerName` — i.e. the name is already a declared column of the
 * owning table, so a `constant` of the same name and owner is a second declaration of one thing.
 *
 * WHY THE TEST USES ONLY `kind` AND `ownerName`. The first version of this probe keyed on
 * `symbol.metadata.type === "constraint"` and found **zero** phantoms in the corpus, which read as
 * "no defect" and was an artifact of the measurement: `pool-worker.ts` forwards a WHITELIST of symbol
 * metadata keys across the worker boundary and the list is CSS-only plus markdown-only, so every
 * `metadata.type` this analyzer writes — `column`, `index`, `constraint`, `constraintKind`,
 * `sqlType`, `isPrimaryKey`, `addedByAlter` — is dropped before a consumer sees it. This probe
 * therefore reads only fields that DO survive production `parseFile`, which also makes it a test of
 * the same surface a graph consumer has. (The whitelisting is shared machinery: §8.)
 *
 * USAGE:
 *   npx tsx validation/m14/fixtures/sql/pass3-phantom-constraint.mts [--out FILE] <file> ...
 *   npx tsx validation/m14/fixtures/sql/pass3-phantom-constraint.mts --out FILE        # whole corpus
 */
import { writeFileSync, readdirSync, statSync, readFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import * as path from "node:path"
import { Parser, Language, type Node } from "web-tree-sitter"
import { parseFile } from "../../../../src/ast/pool-worker"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"

const argv = process.argv.slice(2)
const OUT = argv.includes("--out") ? argv[argv.indexOf("--out") + 1] : undefined
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SIZE_CAP = 512 * 1024

function discover(): string[] {
  const out: string[] = []
  for (const entry of readdirSync(CR)) {
    const dir = path.join(CR, entry)
    try {
      if (!statSync(dir).isDirectory()) continue
      execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
    } catch { continue }
    let tracked: string[]
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
    } catch { continue }
    for (const rel of tracked) {
      const abs = path.join(dir, rel)
      let text: string
      try {
        if (statSync(abs).size > SIZE_CAP) continue
        text = readFileSync(abs, "utf8")
      } catch { continue }
      if (detectLanguageFromPath(abs, text) !== "sql") continue
      out.push(abs)
    }
  }
  return out.sort()
}

const FILES = (() => {
  const given = argv.filter((a, i) => !a.startsWith("--") && argv[i - 1] !== "--out")
  return given.length ? given.sort() : discover()
})()

/**
 * THE ORACLE, and why the heuristic above is not the verdict.
 *
 * "A `constant` whose name equals a column name under the same owner" also matches REAL MySQL indexes:
 * `UNIQUE KEY \`db_name\` (\`db_name\`, \`table_name\`)` names the index after the column, which is legal
 * and which phpMyAdmin's `create_tables.sql` does 4 times. So the heuristic has a false-positive floor
 * and cannot decide the question on its own.
 *
 * The oracle walks the parse tree — an independent read of the same grammar the analyzer reads — and
 * records, for every `constraint` node, whether it HAS a name and where that name sits. A `constant`
 * symbol is a phantom when the file declares a constraint at that symbol's own line whose name is NOT
 * there: the analyzer then took its name from somewhere the language does not put a name, which is the
 * defect. A `constant` whose line does carry a named constraint is a real declaration however much its
 * name resembles a column's.
 *
 * This is what lets the report say "0 phantoms" instead of "the count fell from 57 to 4".
 */
await Parser.init()
const SQL_LANG = await Language.load(path.resolve("wasm/tree-sitter-sql.wasm"))
const parser = new Parser()
parser.setLanguage(SQL_LANG)

/**
 * Strip SQL's identifier quotes. Character work, no regex (lane policy): MySQL backticks, ANSI double
 * quotes and SQL Server brackets all spell the SAME identifier as the bare form, and the analyzer
 * publishes the bare form — comparing the tree's raw `\`db_name\`` against a symbol named `db_name`
 * would report every quoted name as a phantom, which is the false positive that would have made this
 * oracle useless on exactly the corpus it was written for.
 */
function unquote(s: string): string {
  let t = s
  if (t.length >= 2) {
    const a = t[0]
    const b = t[t.length - 1]
    if ((a === "`" && b === "`") || (a === '"' && b === '"') || (a === "[" && b === "]")) t = t.slice(1, -1)
  }
  return t
}

/** line -> true when a NAMED constraint is declared on that 1-based line. */
function namedConstraintLines(file: string): Map<number, string[]> {
  const out = new Map<number, string[]>()
  let tree: any
  try {
    tree = parser.parse(readFileSync(file, "utf8"))
  } catch {
    return out
  }
  const visit = (n: Node) => {
    if (n.type === "constraint") {
      const kids: Node[] = []
      for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c.isNamed) kids.push(c) }
      const kwAt = kids.findIndex((c) => c.type === "keyword_constraint")
      const colsAt = kids.findIndex((c) => c.type === "ordered_columns" || c.type === "column")
      let name: string | null = null
      if (kwAt >= 0) {
        const after = kids.slice(kwAt + 1).find((c) => c.type === "identifier")
        if (after) name = after.text
      } else if (colsAt >= 0) {
        // MySQL's `UNIQUE KEY <name> (cols)`: the name is the identifier BEFORE the column list.
        const before = kids.slice(0, colsAt).find((c) => c.type === "identifier")
        if (before) name = before.text
      }
      if (name) {
        const line = n.startPosition.row + 1
        const arr = out.get(line) ?? []
        arr.push(unquote(name))
        out.set(line, arr)
      }
    }
    for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c.isNamed) visit(c) }
  }
  visit(tree.rootNode)
  try { tree.delete() } catch { /* the wasm tree is freed on GC; a failure here must not fail the probe */ }
  return out
}

let constantsOwned = 0
const phantoms: { file: string; name: string; owner: string; line: number; declaredColumnLine: number }[] = []
const legitimateSameNameIndexes: { file: string; name: string; owner: string; line: number; constraintName: string }[] = []
const filesWithPhantoms = new Set<string>()
let parseFailures = 0
const treeCache = new Map<string, Map<number, string[]>>()

for (const f of FILES) {
  let r: any
  try {
    r = await parseFile(f, path.dirname(f))
  } catch {
    parseFailures++
    continue
  }
  const syms = Array.isArray(r?.symbols) ? r.symbols : []
  // (owner, name) -> line, for columns. Only `kind`, `ownerName` and `startLine` are read, because
  // only those survive the worker boundary — see the header.
  const declaredColumns = new Map<string, number>()
  for (const s of syms) {
    if (String(s?.kind ?? "") !== "property") continue
    declaredColumns.set(`${s?.ownerName ?? ""}|${s?.name ?? ""}`, Number(s?.startLine ?? 0))
  }
  const candidates: any[] = []
for (const s of syms) {
  if (String(s?.kind ?? "") !== "constant") continue
  const owner = String(s?.ownerName ?? "")
  if (!owner) continue
  // Counted HERE, before the same-name filter, so the denominator is every owned `constant` in the
  // corpus rather than only the ones in files that happen to collide. The first version of this
  // counter sat after a `continue` and reported 6 owned constants for a corpus that has ~2,000.
  constantsOwned++
  const declaredAt = declaredColumns.get(`${owner}|${s?.name ?? ""}`)
  if (declaredAt !== undefined) candidates.push({ s, owner, name: String(s?.name ?? ""), line: Number(s?.startLine ?? 0), declaredAt })
}
if (candidates.length === 0) continue
let named = treeCache.get(f)
if (!named) { named = namedConstraintLines(f); treeCache.set(f, named) }
for (const c of candidates) {
  // THE VERDICT: does a NAMED constraint sit on this symbol's own line?
  const onLine = named.get(c.line)
  if (onLine && onLine.includes(c.name)) {
    legitimateSameNameIndexes.push({ file: path.basename(f), name: c.name, owner: c.owner, line: c.line, constraintName: c.name })
    continue
  }
  phantoms.push({ file: path.basename(f), name: c.name, owner: c.owner, line: c.line, declaredColumnLine: c.declaredAt })
  filesWithPhantoms.add(f)
}
}

const report = {
  instrument: "validation/m14/fixtures/sql/pass3-phantom-constraint.mts",
  entryPoint: "parseFile (src/ast/pool-worker.ts)",
  filesMeasured: FILES.length,
  parseFailures,
  ownedConstants: constantsOwned,
  phantoms: {
    n: phantoms.length,
    files: filesWithPhantoms.size,
    examples: phantoms.slice(0, 12),
  },
  legitimateSameNameIndexes: {
    n: legitimateSameNameIndexes.length,
    note: "MySQL indexes that share a name with a column of the same table (`UNIQUE KEY db_name (db_name, …)`). Real declarations; the heuristic flags them and the tree oracle clears them.",
    examples: legitimateSameNameIndexes.slice(0, 8),
  },
  rule: "a `constant` symbol whose name and ownerName equal a `property` the SAME file declares under that owner, AND whose own line carries no NAMED constraint in the parse tree",
}

if (OUT) writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`)
console.log(`SQL pass-3 phantom-constraint probe — ${FILES.length} files`)
console.log(`  owned constant symbols: ${constantsOwned}`)
console.log(`  same-name-as-a-column constants examined: ${phantoms.length + legitimateSameNameIndexes.length}`)
console.log(`  PHANTOM declarations (tree oracle finds no named constraint on the symbol's line): ${phantoms.length} in ${filesWithPhantoms.size} files`)
console.log(`  legitimate same-name indexes cleared by the oracle: ${legitimateSameNameIndexes.length}`)
for (const p of phantoms.slice(0, 6)) console.log(`    PHANTOM ${p.file}: constant:${p.name} owner=${p.owner} line=${p.line}; property of the same owner at line ${p.declaredColumnLine}`)
for (const p of legitimateSameNameIndexes.slice(0, 4)) console.log(`    ok      ${p.file}: constant:${p.name} owner=${p.owner} line=${p.line} — a named constraint is declared there`)
if (OUT) console.log(`\nwrote ${OUT}`)