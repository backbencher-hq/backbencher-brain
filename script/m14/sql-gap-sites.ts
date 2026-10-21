#!/usr/bin/env bun
/**
 * SQL LANE — THE GAP-SITE CENSUS: the COUNT every D7 disposition needs, for every one of the
 * lane's open gaps, over the WHOLE admitted population.
 *
 * WHY. The doctrine says a disposition without a count is prose, and the counts the spec's gap
 * rows carry were taken on the OLD 1,460/1,526-file census — a population that no longer exists
 * and that, more importantly, was walked with a walk that SILENTLY DROPPED EVERY SYMLINKED
 * REPOSITORY. 439 `.sql` files — 22.3% of the population and ~48% of the edges — live behind one
 * symlink, and `readdirSync(dir, {withFileTypes:true}).isDirectory()` is FALSE for a symlink. Every
 * count below is therefore re-measured here, on the current population, with the symlink rule
 * obeyed (`statSync(p).isDirectory()` FOLLOWS the link) and the count of symlinked directories
 * followed PRINTED rather than assumed.
 *
 * THE SYMLINK LESSON IS THIS LANE'S OWN, and it is stated as a rule rather than a story: a walk
 * that drops 22.3% of the files cannot certify anything about the other 77.7%, because the files
 * it dropped are the ones nobody looked at. Any instrument in this lane that does NOT print its
 * symlinked-directory count is not trusted, including this one — so it prints it.
 *
 * FOR EACH GAP THE INSTRUMENT ANSWERS THE SAME QUESTION: how many SITES are there, over the whole
 * admitted population, for the construct the gap is about? A gap with 0 sites is a gap that cannot
 * fire on this corpus and says so; a gap with 4,000 sites is sized. Both are numbers.
 *
 * USAGE  BB_CORPUS_ROOT="$PWD/.corpus" bun run script/m14/sql-gap-sites.ts [--json <out>]
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { execFileSync } from "node:child_process"
import { getParser } from "../../src/ast/engine.ts"

const args = process.argv.slice(2)
const jsonOut = args.includes("--json") ? args[args.indexOf("--json") + 1] : ""
const ROOT = process.env.BB_CORPUS_ROOT ?? join(process.cwd(), ".corpus")
const CAP = 1_048_576

// ── the population, the GATE's rule, with the symlink rule
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

/** the counters, one per measured question */
type C = { sites: number; files: Set<string>; samples: string[] }
const counters: Record<string, C> = {}
const bump = (k: string, f: string, s: string) => {
  const c = (counters[k] ??= { sites: 0, files: new Set(), samples: [] })
  c.sites++; c.files.add(f)
  if (c.samples.length < 4) c.samples.push(`${f}:${s}`)
}
const text = (n: any) => String(n.text ?? "")

const parser = await getParser("sql")
let parsed = 0, failures = 0
const failedFiles: string[] = []
/** per-file symbol/edge tallies the D7 ledger needs */
let filesWithZeroFunctionSymbols = 0
let filesWithFunctions = 0

for (const f of admitted) {
  let content: string
  try { content = readFileSync(f, "utf8") } catch { failures++; failedFiles.push(f); continue }
  let pr: any
  try { pr = await parser.parse(content, f) } catch { failures++; failedFiles.push(f); continue }
  parsed++
  const root = pr.rootNode
  const all: any[] = []
  const stack: any[] = [root]
  while (stack.length) {
    const n = stack.pop()!
    all.push(n)
    for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) stack.push(c) }
  }
  const byType = (t: string) => all.filter((n) => String(n.type) === t)
  /** every node of `t` INSIDE `root`'s subtree, document order — the scoping the old code got wrong */
  const sub = (root: any, t: string): any[] => {
    const out: any[] = []
    const st: any[] = [root]
    while (st.length) {
      const n = st.pop()!
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i)
        if (!c) continue
        if (String(c.type) === t) out.push(c)
        st.push(c)
      }
    }
    return out
  }

  // ── G1 / G7 / G19: the opaque dollar-quoted body and the 13 plpgsql_* node types
  for (const n of byType("create_function").concat(byType("create_procedure"))) {
    const body = sub(n, "function_body")[0] ?? sub(n, "procedure_body")[0] ?? sub(n, "do_statement")[0]
    if (!body) { bump("G1_G7.control_no_body", f, `${n.startPosition.row + 1}`); continue }
    // a dollar-quoted body is an OPAQUE token to this grammar: the statements inside it are text
    const isDollar = /^\$[A-Za-z_0-9]*\$/.test(text(body).trim())
    bump(isDollar ? "G1_G7.opaque_dollar_quoted_body" : "G1_G7.parsed_body", f, `${n.startPosition.row + 1}`)
    // CONTROL: does the body contain a node the grammar DID build (a real statement) or not?
    const inner = sub(body, "statement").length
    bump(inner > 0 ? "G1_G7.body_with_parsed_statements" : "G1_G7.body_with_no_parsed_statements", f, `${n.startPosition.row + 1}`)
  }
  for (const n of all) {
    const t = String(n.type)
    if (t.startsWith("plpgsql_")) { bump("G19.plpgsql_node_produced", f, `${n.startPosition.row + 1}`); bump(`G19.type.${t}`, f, "") }
    // THE PLAN's row set, measured: the LOCAL-VARIABLE arm (G7/G19 plan P3) would read exactly the
    // nodes that NAME a variable — `DECLARE x int` and `x := …` — and those two node types are the
    // ones that have no relation in the 14-type vocabulary. The counter is the UNION, so the file
    // count is the number of files a local-variable arm would touch, not the sum of two overlapping
    // per-type file counts.
    if (t === "plpgsql_declarations" || t === "plpgsql_assignment") bump("PLAN.P3_local_variable_sites", f, `${n.startPosition.row + 1}`)
    // P1: the dynamic-SQL arm's row set — the nodes whose `query` field carries a LITERAL the tree
    // can hand over, so the EXECUTE-literal pass could read it from the tree instead of the text.
    if (t === "plpgsql_execute") {
      const q = n.childForFieldName?.("query")
      bump(q && String(q.type) === "literal" ? "PLAN.P1_plpgsql_execute_with_literal_query" : "PLAN.P1_plpgsql_execute_without_literal_query", f, `${n.startPosition.row + 1}`)
    }
  }
  // the CONTROL for G19: the node types EXIST in the pinned grammar (13 of them) but are not produced
  bump("G19.control_create_function", f, "")

  // ── G2: a CREATE INDEX with no key list
  for (const n of byType("create_index")) {
    // the key list is whatever the index node holds after its name and its ON target
    const hasFields = sub(n, "index_fields").length + sub(n, "index_field").length +
                      sub(n, "column").length + sub(n, "term").length > 0
    if (!hasFields) bump("G2.create_index_without_key_list", f, `${n.startPosition.row + 1}`)
    else bump("G2.control_create_index", f, `${n.startPosition.row + 1}`)
  }

  // ── G6: a policy's / grant's predicate naming a table that is NOT the ON target
  for (const n of byType("policy").concat(byType("grant_statement"))) {
    bump("G6.policy_or_grant_site", f, `${n.startPosition.row + 1}`)
    // the table the statement is ABOUT (the `ON` target) vs the tables its PREDICATE names
    let onTarget = ""
    const kids = all.filter((x) => x.parent === n)
    for (let i = 0; i < kids.length; i++) {
      if (String(kids[i].type) === "keyword_on") {
        const next = kids[i + 1]
        if (next && String(next.type) === "object_reference") onTarget = text(next)
      }
    }
    // any object_reference inside the statement that is not the ON target = a predicate table
    for (const r of sub(n, "object_reference")) {
      const t = text(r)
      if (!t || t === onTarget) continue
      // the ON target's own object_reference is the one directly under the statement
      if (r.parent === n) continue
      bump("G6.predicate_table_reference", f, `${r.startPosition.row + 1} ${t}`)
    }
  }

  // ── G8: the EXECUTE literal shapes
  for (const n of byType("plpgsql_execute").concat(byType("execute_statement"))) {
    const t = text(n).trim()
    // the SHAPE the analyzer's text pass recovers: EXECUTE [IMMEDIATE] '<sql>' — a single literal
    // immediately after the keyword. Everything else is out of its reach.
    const lit = /^(?:EXECUTE|execute)\s+(?:IMMEDIATE\s+|immediate\s+)?'/.exec(t)
    if (lit) {
      bump("G8.execute_literal_recovered_shape", f, `${n.startPosition.row + 1}`)
      const rest = t.slice(lit[0].length)
      if (rest.includes("'")) bump("G8.execute_concatenated_fragment", f, `${n.startPosition.row + 1}`)
    } else if (/format\s*\(/.test(t)) bump("G8.execute_format_shape", f, `${n.startPosition.row + 1}`)
    else bump("G8.execute_other_shape", f, `${n.startPosition.row + 1}`)
  }

  // ── G11: the LIKE clause inside a CREATE TABLE
  for (const n of byType("keyword_like")) {
    const underCreateTable = byType("create_table").some((ct) => isUnder(n, ct))
    if (underCreateTable) bump("G11.keyword_like_in_create_table", f, `${n.startPosition.row + 1}`)
    else bump("G11.control_keyword_like_elsewhere", f, `${n.startPosition.row + 1}`)
  }

  // ── G12: a column_definition named KEY inside an add_column (MySQL's index syntax)
  for (const n of byType("column_definition")) {
    if (!byType("add_column").some((a) => isUnder(n, a))) continue
    const nm = n.childForFieldName?.("name")
    if (nm && String(text(nm)).toLowerCase() === "key") bump("G12.add_column_named_key", f, `${n.startPosition.row + 1}`)
  }

  // ── G15: the containment root — what owns a `contains` member
  // (the analyzer's own metadata is the authority; the census counts the OWNER's kind)
  for (const n of byType("create_schema")) bump("G15.create_schema_site", f, `${n.startPosition.row + 1}`)

  // ── G17: a cast whose VALUE side the grammar could not parse
  for (const n of byType("cast")) {
    if (!n.childForFieldName?.("custom_type")) continue
    const value = valueSideOfCast(n)
    if (!value) continue
    if (value.hasError) bump("G17.cast_with_damaged_value_side", f, `${n.startPosition.row + 1}`)
  }

  // ── G18: the six statements with no arm
  for (const t of ["drop_materialized_view", "drop_database", "drop_role", "drop_extension", "drop_procedure", "refresh_materialized_view"]) {
    const n = byType(t)[0]
    if (n) bump(`G18.${t}`, f, `${n.startPosition.row + 1}`)
  }
  // the CONTROL for G18: the ten drop_* statements that DO have an arm
  for (const t of ["drop_table", "drop_view", "drop_index", "drop_type", "drop_schema", "drop_sequence", "drop_column", "drop_constraint", "drop_function", "drop_policy"]) {
    const n = byType(t)[0]
    if (n) bump(`G18.control_${t}`, f, `${n.startPosition.row + 1}`)
  }

  // ── G13: a symbol the pool worker's NOISE_TARGETS would drop (`root`)
  if (/\broot\b/i.test(content)) bump("G13.file_mentions_root", f, "")
  for (const n of byType("create_function")) {
    const nm = n.childForFieldName?.("name") ?? sub(n, "identifier")[0] ?? sub(n, "object_reference")[0]
    if (nm && text(nm).toLowerCase() === "root") bump("G13.function_named_root", f, `${n.startPosition.row + 1}`)
  }
}

function isUnder(node: any, ancestor: any): boolean {
  let p = node?.parent
  while (p) {
    if (p === ancestor) return true
    p = p.parent
  }
  return false
}
function valueSideOfCast(cast: any): any | null {
  let value: any = null
  for (let i = 0; i < cast.childCount; i++) {
    const child = cast.child(i)
    if (!child) continue
    if (child.type === "::") break
    if (child.isNamed) value = child
  }
  return value
}

const out: Record<string, { sites: number; files: number; samples: string[] }> = {}
for (const k of Object.keys(counters).sort()) {
  const c = counters[k]
  out[k] = { sites: c.sites, files: c.files.size, samples: c.samples }
}
const report = {
  instrument: "script/m14/sql-gap-sites.ts",
  population: { root: ROOT, admitted: admitted.length, repos, symlinkedDirsFollowed },
  parse: { parsed, failures },
  gaps: out,
}
if (jsonOut) { writeFileSync(jsonOut, JSON.stringify({ ...report, failureFiles: failedFiles }, null, 2)) }

console.log("═".repeat(78))
console.log("SQL — GAP-SITE CENSUS (the COUNT each D7 disposition needs)")
console.log("═".repeat(78))
console.log(`corpus root : ${ROOT}`)
console.log(`admitted    : ${admitted.length} .sql files across ${repos} repos · symlinked dirs followed: ${symlinkedDirsFollowed}`)
console.log(`parsed ${parsed} · failures ${failures}`)
console.log("─".repeat(78))
for (const [k, v] of Object.entries(out)) {
  console.log(`  ${k.padEnd(42)} sites=${String(v.sites).padStart(6)}  files=${String(v.files).padStart(5)}`)
  for (const s of v.samples) console.log(`      ${s}`)
}
console.log("═".repeat(78))
if (jsonOut) console.log(`JSON written: ${jsonOut}`)
