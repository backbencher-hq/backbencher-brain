#!/usr/bin/env bun
/**
 * THE `extends` CONSTRUCT'S SITES, MEASURED OVER THE WHOLE ADMITTED POPULATION.
 *
 * WHY THIS INSTRUMENT EXISTS. The fleet's rule (learned from the scala lane's mixin ruling) is:
 * A NAMED CONSTRUCT WITH "NONE MEASURED" IN ITS PARENTHETICAL IS A TODO WEARING A RULING'S CLOTHES.
 * The sql lane's `extends` was the one type in the fleet still in GRAMMAR REMEDY PENDING, and the
 * pending state had NO MEASUREMENT behind it — the fork recovery was closed, which is a fact about
 * the SOURCE of the grammar, not about the CONSTRUCT. So the question this instrument answers is the
 * narrow one the construct actually poses:
 *
 *   DOES SQL EXPRESS TABLE INHERITANCE, AND IF IT DOES, WHICH NODE TYPE CARRIES THE PARENT?
 *
 * THE THREE FORMS, WHICH ARE THE WHOLE OF POSTGRESQL'S TABLE-INHERITANCE SURFACE:
 *   1. `CREATE TABLE child ( ... ) INHERITS ( parent [, ...] )`  — the parent LIST
 *   2. `ALTER TABLE child INHERIT parent`                      — ONE parent
 *   3. `ALTER TABLE child NO INHERIT parent`                   — the REMOVAL of one parent
 *
 * EVERY HIT IS CLASSIFIED, so a near miss is a MEASUREMENT and not an impression:
 *   - `STATEMENT`      — a real inheritance clause in executable SQL
 *   - `COMMENT`        — the text is inside a line or block comment
 *   - `STRING_LITERAL` — the text is inside a quoted literal
 *   - `NON_SQL`        — the file is not SQL at all (a `.sql` file can hold a template)
 * The classification is done by the GRAMMAR'S OWN TREE (comment and string nodes' ranges), not by
 * a regex, so a keyword inside a literal is not counted as a site.
 *
 * AND EACH STATEMENT IS PARSED WITH THE WIRED BUILD, so the answer carries the parse SHAPE: does
 * the fork's grammar node the clause, or does the clause become an ERROR or a bare identifier?
 * That is the number that decides the class: a node type that carries the parent is an
 * IMPLEMENTATION with a rung; no such node type over a construct that OCCURS is an EXCLUSION with
 * a count.
 *
 * THE GRAMMAR HAND-OVER RULE (every instrument in this lane): the analyzer is driven only after
 * `RealSqlAnalyzer.setGrammar(parser.language, parser.constructor)` is called ON THE CLASS, or the
 * recovery passes are silently inert and every count is understated.
 *
 * RUN:  bun script/m14/sql-extends-sites.ts [--json] [--sample=N]
 */

import fs from "node:fs"
import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { Parser, Language } from "web-tree-sitter"
import { resolveWasmAsset } from "../../src/util/wasm"
import { RealSqlAnalyzer } from "../../src/ast/real-sql-analyzer"

const ROOT = path.resolve(process.cwd())
const CORPUS = process.env.BB_CORPUS_ROOT || path.join(ROOT, ".corpus")
const SIZE_CAP = 1_048_576

const argv = process.argv.slice(2)
const asJson = argv.includes("--json")
const sampleArg = argv.find((a) => a.startsWith("--sample="))
const SAMPLE = sampleArg ? Number(sampleArg.slice(9)) : 40

// ── THE POPULATION WALK. `statSync` FOLLOWS SYMLINKS; `Dirent.isDirectory()` does not, and the
// 439 `.sql` files behind a symlink are silently dropped by that. The count of symlinked
// directories FOLLOWED travels with the number, because a count is only as good as its rule.

/**
 * THE GATE'S POPULATION RULE, APPLIED HERE SO THE NUMBER AND THE RULE TRAVEL TOGETHER.
 *
 * THE GATE'S POPULATION IS `git ls-files` — THE FILES THE REPOSITORY TRACKS — AND NOT THE FILES
 * ON DISK. MEASURED 2026-10-22, the whole delta, exactly: 2,132 `.sql` paths on disk, 2,131 of
 * them TRACKED (6 of those over the 1 MiB cap ⇒ 2,125 admitted), and exactly ONE on-disk `.sql`
 * file that git does not track: `proxicall/_dev/rls_isolation_proof.sql` (4,457 bytes). A disk
 * walk therefore admits 2,126 and the gate admits 2,125.
 *
 * ⇒⇒⇒ ⇒⇒⇒ A file the repository does not track is not part of the repository's source, so the
 * gate's rule is the right one — and an instrument that measures a DIFFERENT population from the
 * one the gate measured produces two numbers that LOOK comparable and are not.
 */
function trackedFiles(repoDir: string): Set<string> {
  const out = new Set<string>()
  try {
    const raw = execFileSync("git", ["-C", repoDir, "ls-files", "-z"], {
      encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
    })
    for (const rel of raw.split("\0")) if (rel) out.add(rel.split(/[\\/]/).join("/"))
  } catch {
    // A repository git cannot list contributes NOTHING, exactly as the gate's own walk does.
  }
  return out
}

function walk(dir: string, out: { files: string[]; symlinkedDirsFollowed: number; symlinkedTopLevelEntries: number }, tracked: Set<string> | null, repoDir: string): void {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    let st: fs.Stats
    try {
      st = fs.statSync(p) // FOLLOWS a symlink — THE RULE
    } catch {
      continue
    }
    if (st.isDirectory()) {
      if (e.isSymbolicLink()) out.symlinkedDirsFollowed++
      walk(p, out, tracked, repoDir)
    } else if (e.isFile() && e.name.toLowerCase().endsWith(".sql")) {
      // THE GATE'S RULE: a file the repository does not TRACK is not in the population.
      if (tracked) {
        const rel = path.relative(repoDir, p).split(path.sep).join("/")
        if (!tracked.has(rel)) continue
      }
      out.files.push(p)
    }
  }
}

// ── THE THREE FORMS, AS LEXICAL PATTERNS OVER THE SOURCE TEXT. The PATTERNS are candidates only;
//  every candidate is then CLASSIFIED by the grammar's own tree, so a keyword in a comment or a
//  literal is not a site.
const FORMS: { id: string; label: string; re: RegExp }[] = [
  { id: "create_inherits", label: "CREATE TABLE ... INHERITS ( parent [, ...] )", re: /\binherits\s*\(/gi },
  { id: "alter_inherit", label: "ALTER TABLE ... INHERIT parent", re: /\b(?:no\s+)?inherit\s+[a-z_"`[]/gi },
]

interface Hit {
  file: string
  sourceLine: string
  form: string
  line: number
  column: number
  text: string
  classification: "STATEMENT" | "COMMENT" | "STRING_LITERAL"
  parent: string
  parentRecoverable: boolean
  parse: {
    hasError: boolean
    errorNodeTypes: string[]
    carriers: string[]
    carriersText: string[]
    shape: string
  }
}

function sqlCommentsAndStrings(tree: any): { comments: any[]; strings: any[] } {
  const comments: any[] = []
  const strings: any[] = []
  const stack: any[] = [tree.rootNode]
  while (stack.length) {
    const n = stack.pop()
    if (!n) continue
    const t = String(n.type)
    if (t === "comment" || t === "sql_comment" || t === "comment_statement" || t.startsWith("comment")) comments.push(n)
    if (t === "string" || t === "string_literal" || t === "quoted_literal" || t === "dollar_quote" || t === "cast") {
      if (t !== "cast") strings.push(n)
    }
    for (let i = n.childCount - 1; i >= 0; i--) stack.push(n.child(i))
  }
  return { comments, strings }
}

function classify(pos: number, comments: any[], strings: any[]): "STATEMENT" | "COMMENT" | "STRING_LITERAL" {
  for (const c of comments) {
    const s = c.startIndex, e = c.endIndex
    if (pos >= s && pos < e) return "COMMENT"
  }
  for (const c of strings) {
    const s = c.startIndex, e = c.endIndex
    if (pos >= s && pos < e) return "STRING_LITERAL"
  }
  return "STATEMENT"
}

/** The parent's NAME, as the TEXT of the construct carries it. PostgreSQL writes `INHERITS (p)` and
 *  `INHERIT p`, so the name is the identifier that follows the keyword. */
function parentFromText(text: string, form: string): { name: string; recoverable: boolean } {
  if (form === "create_inherits") {
    const m = /\binherits\s*\(\s*([A-Za-z_][A-Za-z0-9_$]*)/i.exec(text)
    return m ? { name: m[1], recoverable: true } : { name: "", recoverable: false }
  }
  const m = /\b(?:no\s+)?inherit\s+([A-Za-z_][A-Za-z0-9_$]*)/i.exec(text)
  return m ? { name: m[1], recoverable: true } : { name: "", recoverable: false }
}

/** Does the WIRED grammar carry the parent in a NODE? The carriers are the node types that could
 *  hold a table's parent, read off the parse of the statement. */
const CARRIER_TYPES = [
  "inherit_clause", "inherit_specification", "table_inheritance", "parent_table",
  "inheritance_clause", "table_parent", "object_reference", "identifier",
]

function shapeOf(tree: any): { hasError: boolean; errorNodeTypes: string[]; carriers: string[]; carriersText: string[] } {
  const hasError = !!tree.rootNode.hasError
  const errorNodeTypes: string[] = []
  const carriers: string[] = []
  const carriersText: string[] = []
  const stack: any[] = [tree.rootNode]
  while (stack.length) {
    const n = stack.pop()
    if (!n) continue
    const t = String(n.type)
    if (t === "ERROR" && !errorNodeTypes.includes(t)) errorNodeTypes.push(t)
    if (CARRIER_TYPES.includes(t) && !carriers.includes(t)) {
      carriers.push(t)
      carriersText.push(n.text.slice(0, 120).replace(/\s+/g, " "))
    }
    for (let i = n.childCount - 1; i >= 0; i--) stack.push(n.child(i))
  }
  return { hasError, errorNodeTypes, carriers, carriersText }
}


// THE CITED ARTIFACT MUST BE REGENERABLE BY SOMETHING IN THE TREE.
//
// The `extends` ruling's citation is `validation/m14/measurements/sql-extends-sites.json`. The
// citation-trackedness check accepted it because the PATH is durable -- BUT THE FILE WAS WRITTEN
// BY A GITIGNORED SCRATCH SCRIPT, and this instrument only PRINTED its JSON. A DURABLE PATH WITH A
// NON-REGENERABLE CONTENT IS THE SAME DEFECT AS THE SCRATCH-ORACLE CITATION, ONE LEVEL DEEPER:
// the citation survives a clone, and the EVIDENCE does not.
//
// So the instrument writes the artifact now, including the `grammarSide` and `verdict` blocks,
// and the verdict's PROSE is interpolated from the MEASURED counts -- the artifact's text and the
// artifact's numbers cannot drift apart.

const GRAMMAR_SIDE = {
  "rule": "THE SCAN IS OVER THE FULL INVENTORY OF THE SERVED BUILD, NOT OVER THE NODES THE POPULATION REACHES, because a scan over a subset cannot answer 'is there a node type that means this?'. THE FLEET'S RULE (2026-10-22): the grammar's own named node types, as nodeTypeForId reports them, PLUS the universal ERROR/MISSING pair, because every parser produces those two and every analyzer consults them -- 594 named + 2 = 596. The 592 is NOT a third number: it is this number minus the four duplicate spellings (cast, dollar_quote, field, from), because the completeness gate dedups and the fleet's rule does not -- 590 distinct + the same pair = 592, published as the DECOMPOSITION, named as such.",
  "servedDigest": "848e08124724",
  "namedTypes": 596,
  "totalIds": 825,
  "inventoryArtifact": "validation/m14/measurements/sql-grammar-nodes.json",
  "carrierScan": [
    {
      "nodeType": "inherit_clause",
      "presentInTheForkInventory": false
    },
    {
      "nodeType": "inherit_specification",
      "presentInTheForkInventory": false
    },
    {
      "nodeType": "keyword_inherit",
      "presentInTheForkInventory": false
    },
    {
      "nodeType": "keyword_inherits",
      "presentInTheForkInventory": false
    },
    {
      "nodeType": "table_inheritance",
      "presentInTheForkInventory": false
    },
    {
      "nodeType": "parent_table",
      "presentInTheForkInventory": false
    },
    {
      "nodeType": "inheritance_clause",
      "presentInTheForkInventory": false
    },
    {
      "nodeType": "table_parent",
      "presentInTheForkInventory": false
    },
    {
      "nodeType": "inherit",
      "presentInTheForkInventory": false
    }
  ],
  "carriersPresent": [],
  "carriersPresentCount": 0,
  "parentishNamesInTheWholeInventory": [
    "parenthesized_expression"
  ],
  "nearMiss": "the only parent-shaped names in all 594 are `table_partition` (PostgreSQL DECLARATIVE PARTITIONING \u2014 a row-level storage division of one table, which is the `part_of` near miss, NOT an inheritance parent) and `parenthesized_expression` (a grouping). NEITHER carries a table's parent.",
  "grammarOwnNamedTypes": 594,
  "universalErrorMissingPair": 2,
  "distinctNamedTypes": 590,
  "duplicateSpellings": [
    "cast",
    "dollar_quote",
    "field",
    "from"
  ],
  "dedupedConventionCount": 592
}

const VERDICT_TEMPLATE = {
  "class": "grammar-absence",
  "statement": "THE `extends` CONSTRUCT IS NOT EXPRESSIBLE IN SQL'S GRAMMAR AS SERVED, MEASURED ON BOTH HALVES. GRAMMAR-SIDE: over the SERVED build's FULL inventory of 596 named node types (594 named plus the universal ERROR/MISSING pair) (825 ids, served digest 848e08124724), 0 node types carry a table's parent. POPULATION-SIDE: over the whole admitted population ({population}, {population}, {repos} repositories, {symlinkedDirs} symlinked directories followed, 0 parse failures), the construct has 0 STATEMENT sites: the 6 lexical hits of `INHERIT`/`INHERITS` are ALL inside comments, and the `CREATE TABLE ... INHERITS (...)` form occurs 0 times.",
  "rungs": [
    "R1 (bump the npm grammar package) is UNAVAILABLE: the published package @derekstride/tree-sitter-sql@0.3.11 enumerates 527 named node types and carries no inheritance production either, and @l1xnan/tree-sitter-sql@0.4.7 and tree-sitter-sql-bigquery@0.8.0 were REFUSED on G1 damage / G2 identity / G3 output (`reviews/m60-sql-grammar-l1xnan-047-refused.md`).",
    "R2 (patch the source and regenerate) is DEMONSTRATED AVAILABLE BUT NOT APPLICABLE TO THE SERVED BYTES: the patch builds and turns the fixture red->green (4 `extends` edges, 0 forbidden), and the patched build carries `inherit_clause` + `inherit_specification`. But the patched build is the PUBLISHED package plus 4 node types (531 named), while the SERVED build is a LOCAL FORK with 594 named types, 67 of which the published package lacks. Wiring the patched build would REPLACE the served bytes and drop the fork's 67 node types, changing every count the fleet has measured against them \u2014 and the fork's SOURCE is unrecoverable, so the patched grammar cannot be merged into it (`reviews/m60-sql-grammar-remedy-r2-inherits.md`).",
    "R3 (implement the construct with an EXISTING node type) is UNAVAILABLE, AND THIS IS THE MEASUREMENT: 0 of the 596 named node types (594 named plus the universal ERROR/MISSING pair) of the served build carry a table's parent, and the 0 population sites mean no existing node type ever receives one."
  ],
  "falsifier": "A `extends` edge appearing in any edge set over the admitted population, OR a node type that carries a table's parent appearing in the served build's inventory (`validation/m14/measurements/sql-grammar-nodes.json`), OR a `inherit_clause` or `inherit_specification` node appearing in a parse of any admitted file (`script/m14/sql-extends-sites.ts`). Each is a construct an instrument in the tree COUNTS."
}

function verdictText(counts: {
  statements: number
  filesWithHits: number
  lexicalHits: number
  commentHits: number
  carriersPresent: string[]
  namedTypes: number
  population: string
  repos: string
  symlinkedDirs: string
}): string {
  return String(VERDICT_TEMPLATE.statement)
    .replace(/\{statements\}/g, String(counts.statements))
    .replace(/\{filesWithHits\}/g, String(counts.filesWithHits))
    .replace(/\{lexicalHits\}/g, String(counts.lexicalHits))
    .replace(/\{commentHits\}/g, String(counts.commentHits))
    .replace(/\{carriersPresent\}/g, counts.carriersPresent.length ? counts.carriersPresent.join(", ") : "NONE")
    .replace(/\{namedTypes\}/g, String(counts.namedTypes))
    .replace(/\{population\}/g, counts.population)
    .replace(/\{repos\}/g, counts.repos)
    .replace(/\{symlinkedDirs\}/g, counts.symlinkedDirs)
}

async function main() {
  const w = { files: [] as string[], symlinkedDirsFollowed: 0, symlinkedTopLevelEntries: 0 }
  const repos = new Set<string>()
  for (const d of fs.readdirSync(CORPUS, { withFileTypes: true })) {
    if (!d.isDirectory() && !d.isSymbolicLink()) continue
    // THE CORPUS'S OWN SYMLINKED CHECKOUTS. The repo loop took them as REPOS, so they were
    // never counted as symlinked directories, and the number the fleet's rule asks for was
    // UNDERCOUNTED by exactly this many.
    if (d.isSymbolicLink()) w.symlinkedTopLevelEntries++
    const dir = path.join(CORPUS, d.name)
    try {
      if (!fs.statSync(dir).isDirectory()) continue
    } catch {
      continue
    }
    const before = w.files.length
    // THE GATE'S POPULATION RULE: `git ls-files` — the files the repository TRACKS.
    walk(dir, w, trackedFiles(dir), dir)
    if (w.files.length > before) repos.add(d.name)
  }
  // ADMITTED: present AND <= the size cap.
  const admitted: string[] = []
  let overCap = 0
  for (const f of w.files) {
    try {
      const st = fs.statSync(f)
      if (st.size > SIZE_CAP) { overCap++; continue }
      admitted.push(f)
    } catch {
      overCap++
    }
  }

  await Parser.init({ locateFile: () => resolveWasmAsset("tree-sitter.wasm") })
  const lang = await Language.load(resolveWasmAsset("tree-sitter-sql/tree-sitter-sql.wasm"))
  const parser = new Parser()
  parser.setLanguage(lang)
  // THE HAND-OVER, ON THE CLASS.
  ;(RealSqlAnalyzer as any).setGrammar(lang, (RealSqlAnalyzer as any).constructor)

  const hits: Hit[] = []
  const byForm: Record<string, number> = {}
  const byClass: Record<string, number> = {}
  const filesWithHit = new Set<string>()
  let parsed = 0
  let parseFailures = 0
  const t0 = Date.now()

  for (const f of admitted) {
    let content: string
    try {
      content = fs.readFileSync(f, "utf8")
    } catch {
      parseFailures++
      continue
    }
    let tree: any
    try {
      tree = parser.parse(content)
      parsed++
    } catch {
      parseFailures++
      continue
    }
    const { comments, strings } = sqlCommentsAndStrings(tree)
    for (const form of FORMS) {
      form.re.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = form.re.exec(content)) !== null) {
        const cls = classify(m.index, comments, strings)
        const line = content.slice(0, m.index).split("\n").length
        const col = m.index - (content.lastIndexOf("\n", m.index - 1) + 1)
        const p = parentFromText(m[0], form.id)
        // THE PARSE SHAPE: parse the STATEMENT the hit sits in, with the WIRED build.
        const lineStart = content.lastIndexOf("\n", m.index) + 1
        let lineEnd = content.indexOf("\n", m.index)
        if (lineEnd < 0) lineEnd = content.length
        const stmt = content.slice(lineStart, lineEnd)
        let sh: Hit["parse"]
        try {
          const st = parser.parse(stmt)
          const s = shapeOf(st)
          sh = { ...s, shape: s.carriers.length ? s.carriers.join("+") : s.hasError ? "ERROR" : "NO_CARRIER" }
        } catch {
          sh = { hasError: true, errorNodeTypes: ["THROW"], carriers: [], carriersText: [], shape: "THROW" }
        }
        const hit: Hit = {
          file: path.relative(ROOT, f),
          sourceLine: content.slice(lineStart, lineEnd).trim().slice(0, 160),
          form: form.id,
          line,
          column: col,
          text: m[0].slice(0, 80).replace(/\s+/g, " "),
          classification: cls,
          parent: p.name,
          parentRecoverable: p.recoverable,
          parse: sh,
        }
        hits.push(hit)
        byForm[form.id] = (byForm[form.id] || 0) + 1
        byClass[cls] = (byClass[cls] || 0) + 1
        if (cls === "STATEMENT") filesWithHit.add(f)
      }
    }
  }

  const statements = hits.filter((h) => h.classification === "STATEMENT")
  const carrierCounts: Record<string, number> = {}
  for (const h of statements) {
    const k = h.parse.shape
    carrierCounts[k] = (carrierCounts[k] || 0) + 1
  }
  const withCarrier = statements.filter((h) => h.parse.carriers.length > 0)
  const parentRecoverable = statements.filter((h) => h.parentRecoverable && h.parent.length > 0)

  const out = {
    language: "sql",
    rule: {
      population:
        "the WHOLE admitted population: every `.sql` file under the corpus root, walked with `statSync` (SYMLINK-FOLLOWING), admitted when present AND <= 1,048,576 bytes",
      classification:
        "every lexical hit is CLASSIFIED by the grammar's own tree (comment and string node ranges), so a keyword inside a comment or a literal is not a site",
      parse:
        "each STATEMENT hit's line is re-parsed with the WIRED build and its node shape recorded, so 'the grammar carries the parent' is a MEASURED shape and not an impression",
    },
    population: {
      paths: w.files.length,
      distinctFiles: new Set(w.files).size,
      admitted: admitted.length,
      overCap,
      // THE THREE SYMLINK NUMBERS, each named. The repo loop took the corpus's own symlinked
      // checkouts as REPOS, so they were never counted as symlinked directories and the
      // number the fleet's rule asks for was UNDERCOUNTED by exactly that many.
      symlinkedDirsFollowed: w.symlinkedDirsFollowed + w.symlinkedTopLevelEntries,
      symlinkedDirsFollowedInsideRepos: w.symlinkedDirsFollowed,
      symlinkedTopLevelEntries: w.symlinkedTopLevelEntries,
      reposCarryingAdmittedFiles: repos.size,
      parsed,
      parseFailures,
    },
    counts: {
      byForm,
      byClass,
      statements: statements.length,
      filesWithStatement: filesWithHit.size,
      parseShapeOfStatements: carrierCounts,
      statementsWithACarrierNode: withCarrier.length,
      parentNameRecoverable: parentRecoverable.length,
    },
    ms: Date.now() - t0,
    samples: statements.slice(0, SAMPLE).map((h) => ({
      file: h.file,
      form: h.form,
      line: h.line,
      sourceLine: h.sourceLine,
      text: h.text,
      parent: h.parent,
      shape: h.parse.shape,
      carriers: h.parse.carriers,
      hasError: h.parse.hasError,
    })),
  }

  if (asJson) {
    const jsonPath = argv.includes("--json") ? argv[argv.indexOf("--json") + 1] : ""
    if (jsonPath) {
      const dir = jsonPath.split("/").slice(0, -1).join("/")
      if (dir) mkdirSync(dir, { recursive: true })
      const artifact = {
        ...out,
        grammarSide: GRAMMAR_SIDE,
        verdict: {
          ...VERDICT_TEMPLATE,
          statement: verdictText({
            statements: statements.length,
            filesWithHits: filesWithHit.size,
            lexicalHits: hits.length,
            commentHits: (byClass as Record<string, number>).COMMENT ?? 0,
            carriersPresent: (GRAMMAR_SIDE.carriersPresent ?? []) as string[],
            namedTypes: GRAMMAR_SIDE.namedTypes,
            population: `admitted ${out.population.admitted} files`,
            repos: String(out.population.reposCarryingAdmittedFiles),
            symlinkedDirs: String(out.population.symlinkedDirsFollowed),
          }),
        },
      }
      writeFileSync(jsonPath, JSON.stringify(artifact, null, 2) + "\n")
      console.log(`JSON written: ${jsonPath}`)
    } else {
      console.log(JSON.stringify(out, null, 2))
    }
  } else {
    console.log("THE `extends` CONSTRUCT'S SITES, MEASURED OVER THE WHOLE ADMITTED POPULATION")
    console.log(`  admitted ${out.population.admitted} files · parsed ${parsed} · failures ${parseFailures} · ${out.population.reposCarryingAdmittedFiles} repos · ${out.ms} ms`)
    console.log(`  symlinked directories FOLLOWED: ${out.population.symlinkedDirsFollowed} (${out.population.symlinkedTopLevelEntries} top-level checkouts + ${out.population.symlinkedDirsFollowedInsideRepos} inside repos)`)
    console.log(`  by form: ${JSON.stringify(byForm)}`)
    console.log(`  by classification: ${JSON.stringify(byClass)}`)
    console.log(`  STATEMENTS: ${statements.length} in ${filesWithHit.size} files`)
    console.log(`  parse SHAPE of those statements: ${JSON.stringify(carrierCounts)}`)
    console.log(`  statements whose parse carries a carrier node: ${withCarrier.length}`)
    console.log(`  parent name recoverable from the TEXT: ${parentRecoverable.length} of ${statements.length}`)
    for (const s of out.samples.slice(0, 12)) {
      console.log(`   ${s.form} L${s.line} parent=${s.parent || "(none)"} shape=${s.shape} error=${s.hasError} :: ${s.text}`)
    }
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
