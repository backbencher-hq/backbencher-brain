#!/usr/bin/env bun
/**
 * SQL LANE — THE CONSTRUCT-SITE CENSUS: ONE site count per relationship type, on the rule the
 * analyzer's OWN code uses, over the WHOLE admitted population.
 *
 * WHY THIS FILE EXISTS. The classification (lane brief §1) needs, for every one of the fourteen
 * types, one of four answers: implemented-with-a-measured-count · grammar-absence (with a
 * citation) · zero-sites (with a measured count of ZERO) · GAP (applicable, not implemented).
 * "Zero-sites" is only admissible with a COUNT, and a count of what? Of the SITES that could carry
 * the relationship — the AST positions whose shape the analyzer's rule recognises. A count of the
 * analyzer's own EDGES cannot distinguish "the corpus is quiet" from "the analyzer is blind", and
 * that is the distinction the whole classification turns on.
 *
 * SO EVERY SITE COUNTER BELOW IS THE ANALYZER'S OWN DISCRIMINATOR, read off the tree:
 *   calls        `invocation` nodes whose function is a bare name (the analyzer's `callTarget`)
 *   uses         `from`/`relation`/`insert`/`update`/`delete` table slots
 *   contains     a `create_*` statement's member slots (table→column/index/constraint)
 *   references   a `keyword_references` sibling position (SQL-D1's POSITIONAL rule)
 *   imports      `psql_meta_command` with a literal `\i`/`\ir` target, or a `create_extension`
 *   overrides    a same-kind, same-name re-declaration in ONE file that carries `OR REPLACE`
 *   instantiates a `cast` carrying a `custom_type` FIELD and a construction-shaped value
 *   extends      an `ALTER TABLE` whose mis-parsed add_column is named `inherit` (the analyzer's
 *                exact trigger), and a `create_table` carrying an `INHERITS` clause
 *   implements   a supertype/interface clause position
 *   exports      a declaration naming what the unit publishes
 *   decorates    a decorator attached to a declarable symbol
 *   renders      a JSX/template element naming a component
 *   mixes_in     a `with`-clause composing a mixin into a supertype chain
 *   part_of      a `PARTITION OF <parent>` clause whose parent name survives, and a
 *                `part of`/`part '<x>'` directive
 *
 * Each counter prints a CONTROL where one exists, so a zero is distinguishable from a probe that
 * opened nothing.
 *
 * THE SYMLINK RULE. `readdirSync(dir, {withFileTypes:true}).isDirectory()` is FALSE for a symlink,
 * so a walk that uses it drops every symlinked repository. This lane MEASURED that: 439 `.sql`
 * files — 22.3% of the population and ~48% of the edges — live behind one symlink and were being
 * dropped silently. The walk here uses `statSync(p).isDirectory()` (which FOLLOWS the link) and
 * PRINTS how many symlinked directories it followed.
 *
 * USAGE  BB_CORPUS_ROOT="$PWD/.corpus" bun run script/m14/sql-construct-sites.ts [--json <out>]
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

/** the site counters, one per type, each the analyzer's own discriminator */
type Counter = { sites: number; files: Set<string>; samples: string[] }
const counters: Record<string, Counter> = {}
const bump = (k: string, f: string, s: string) => {
  const c = (counters[k] ??= { sites: 0, files: new Set(), samples: [] })
  c.sites++; c.files.add(f)
  if (c.samples.length < 5) c.samples.push(`${f}:${s}`)
}
/** the CONTROL counters — positions that MUST be non-empty for the enumeration to be readable */
const controls: Record<string, number> = {
  create_statement: 0, object_reference: 0, identifier: 0, invocation: 0, cast: 0, psql_meta_command: 0,
}

const parser = await getParser("sql")
let parsed = 0
let failures = 0
const failureFiles: string[] = []

for (const f of admitted) {
  let content: string
  try { content = readFileSync(f, "utf8") } catch { failures++; failureFiles.push(f); continue }
  let pr: any
  try { pr = await parser.parse(content) } catch { failures++; failureFiles.push(f); continue }
  parsed++

  const root = pr.rootNode
  const all: any[] = []
  const stack: any[] = [root]
  while (stack.length) {
    const n = stack.pop()!
    all.push(n)
    for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) stack.push(c) }
  }

  // ── CONTROLS
  for (const n of all) {
    const t = String(n.type)
    if (t.startsWith("create_")) controls.create_statement++
    else if (t === "object_reference") controls.object_reference++
    else if (t === "identifier") controls.identifier++
    else if (t === "invocation") controls.invocation++
    else if (t === "cast") controls.cast++
    else if (t === "psql_meta_command") controls.psql_meta_command++
  }

  // ── calls: an `invocation` whose function is a BARE name (the analyzer's callTarget rule)
  for (const n of all) {
    if (String(n.type) !== "invocation") continue
    const fn = n.childForFieldName?.("function")
    if (!fn) continue
    const ft = String(fn.type)
    if (ft === "identifier" || ft === "function" || ft === "object_reference") {
      bump("calls", f, `${n.startPosition.row + 1}`)
    }
  }

  // ── uses: a table slot in from/relation/insert/update/delete
  for (const n of all) {
    const t = String(n.type)
    if (t !== "from" && t !== "relation" && t !== "insert" && t !== "update" && t !== "delete") continue
    // the analyzer's addTableEdge reads the relation's object_reference
    let hasRef = false
    const inner: any[] = [n]
    while (inner.length && !hasRef) {
      const c = inner.pop()!
      if (String(c.type) === "object_reference") { hasRef = true; break }
      for (let i = 0; i < c.childCount; i++) { const k = c.child(i); if (k) inner.push(k) }
    }
    if (hasRef) bump("uses", f, `${n.startPosition.row + 1}`)
  }

  // ── references: the POSITIONAL rule — an object_reference whose previous sibling is
  //    keyword_references (SQL-D1). The rule is the position, not a guess about the name.
  for (const n of all) {
    if (String(n.type) !== "object_reference") continue
    let prev = n.prevSibling
    while (prev) {
      const pt = String(prev.type)
      if (pt === "keyword_references") { bump("references", f, `${n.startPosition.row + 1}`); break }
      // only look back through the immediately adjacent keyword
      break
    }
  }
  // CONTROL for references: the keyword itself
  for (const n of all) if (String(n.type) === "keyword_references") bump("references.control_keyword", f, `${n.startPosition.row + 1}`)

  // ── imports: a psql meta-command with a literal \i / \ir target, or a create_extension
  for (const n of all) {
    const t = String(n.type)
    if (t === "psql_meta_command") {
      const txt = String(n.text ?? "").trim()
      if (/^\\(i|ir)\s+\S/.test(txt)) bump("imports.psql", f, `${n.startPosition.row + 1}`)
    } else if (t === "create_extension") {
      bump("imports.extension", f, `${n.startPosition.row + 1}`)
    }
  }
  // CONTROL for imports: the meta-command node itself
  for (const n of all) if (String(n.type) === "psql_meta_command") bump("imports.control_metacommand", f, `${n.startPosition.row + 1}`)

  // ── overrides: a same-kind same-name re-declaration in ONE file carrying OR REPLACE
  {
    const decls = new Map<string, { kind: string; orReplace: boolean }[]>()
    for (const n of all) {
      if (!/^create_(function|procedure|view|materialized_view)$/.test(String(n.type))) continue
      const nameNode = n.childForFieldName?.("name")
      if (!nameNode) continue
      const nm = String(nameNode.text ?? "")
      const kind = String(n.type)
      const txt = String(n.text ?? "").slice(0, 400).toLowerCase()
      const orReplace = /\bor\s+replace\b/.test(txt)
      const list = decls.get(nm) ?? []
      list.push({ kind, orReplace })
      decls.set(nm, list)
    }
    for (const [nm, list] of decls) {
      for (let i = 1; i < list.length; i++) {
        if (list[i].kind === list[i - 1].kind && list[i].orReplace) bump("overrides", f, nm)
      }
    }
  }
  // CONTROL for overrides: the OR REPLACE declarations themselves
  for (const n of all) {
    if (!/^create_(function|procedure|view|materialized_view)$/.test(String(n.type))) continue
    if (/\bor\s+replace\b/.test(String(n.text ?? "").slice(0, 400).toLowerCase())) bump("overrides.control_or_replace_decl", f, `${n.startPosition.row + 1}`)
  }

  // ── instantiates: a cast carrying a `custom_type` FIELD and a construction-shaped value
  for (const n of all) {
    if (String(n.type) !== "cast") continue
    const ct = n.childForFieldName?.("custom_type")
    if (!ct) continue
    const val = n.childForFieldName?.("value") ?? n.childForFieldName?.("argument")
    const vt = val ? String(val.type) : ""
    if (vt === "row" || vt === "list" || vt === "array" || vt === "tuple") {
      bump("instantiates", f, `${n.startPosition.row + 1}`)
    } else {
      bump("instantiates.control_conversion", f, `${n.startPosition.row + 1}`)
    }
  }

  // ── extends: the analyzer's EXACT trigger — an ALTER TABLE whose mis-parsed add_column is
  //    named `inherit`, plus a create_table carrying an INHERITS clause.
  for (const n of all) {
    const t = String(n.type)
    if (t === "column_definition" || t === "add_column") {
      const nm = n.childForFieldName?.("name")
      if (nm && String(nm.text ?? "").toLowerCase() === "inherit") bump("extends.alter_inherit_trigger", f, `${n.startPosition.row + 1}`)
    }
    if (t === "keyword_inherits" || t === "inherits_clause") bump("extends.keyword_inherits", f, `${n.startPosition.row + 1}`)
  }
  // CONTROL for extends: the ALTER TABLE statements that exist at all
  for (const n of all) if (String(n.type) === "alter_table") bump("extends.control_alter_table", f, `${n.startPosition.row + 1}`)

  // ── implements / exports / decorates / renders / mixes_in / part_of: the grammar positions
  for (const n of all) {
    const t = String(n.type)
    if (t === "keyword_implements" || t === "implements_clause") bump("implements", f, `${n.startPosition.row + 1}`)
    if (t === "keyword_export" || t === "export_statement" || t === "export_clause") bump("exports", f, `${n.startPosition.row + 1}`)
    if (t === "decorator" || t === "annotation") bump("decorates", f, `${n.startPosition.row + 1}`)
    if (t.startsWith("jsx_") || t === "template" || t === "template_element") bump("renders", f, `${n.startPosition.row + 1}`)
    if (t.startsWith("mixin") || t === "with_clause" || t === "mixins") bump("mixes_in", f, `${n.startPosition.row + 1}`)
    if (t === "table_partition") {
      // a constituent-part relation ONLY if the parent name survives
      let hasOf = false, hasBy = false
      const inner: any[] = [n]
      while (inner.length) {
        const c = inner.pop()!
        const tx = String(c.text ?? "").toLowerCase()
        if (tx === "of") hasOf = true
        if (tx === "by") hasBy = true
        for (let i = 0; i < c.childCount; i++) { const k = c.child(i); if (k) inner.push(k) }
      }
      if (hasBy) bump("part_of.control_partition_by", f, `${n.startPosition.row + 1}`)
      else bump("part_of.partition_clause_unrecoverable", f, `${n.startPosition.row + 1}`)
    }
    if (t === "part_of_directive" || t === "part_directive" || t === "part_of_builtin") bump("part_of.directive", f, `${n.startPosition.row + 1}`)
  }
  // CONTROL for part_of: the `of` keyword EXISTS in the grammar (it is used by COPY and others)
  for (const n of all) if (String(n.type) === "keyword_of") bump("part_of.control_keyword_of", f, `${n.startPosition.row + 1}`)
}

// ── the report
const out: Record<string, { sites: number; files: number; samples: string[] }> = {}
for (const k of Object.keys(counters).sort()) {
  const c = counters[k]
  out[k] = { sites: c.sites, files: c.files.size, samples: c.samples }
}

const report = {
  instrument: "script/m14/sql-construct-sites.ts",
  population: { root: ROOT, admitted: admitted.length, repos, symlinkedDirsFollowed },
  parse: { parsed, failures },
  controls,
  sites: out,
}
if (jsonOut) { writeFileSync(jsonOut, JSON.stringify({ ...report, failureFiles }, null, 2)) }

console.log("═".repeat(78))
console.log("SQL — CONSTRUCT-SITE CENSUS (each counter is the ANALYZER'S OWN DISCRIMINATOR)")
console.log("═".repeat(78))
console.log(`corpus root : ${ROOT}`)
console.log(`admitted    : ${admitted.length} .sql files across ${repos} repos · symlinked dirs followed: ${symlinkedDirsFollowed}`)
console.log(`parsed ${parsed} · failures ${failures}`)
console.log("─".repeat(78))
console.log("CONTROLS (must be non-empty for the enumeration to be readable):")
for (const [k, v] of Object.entries(controls)) console.log(`  ${k.padEnd(22)} ${v}`)
console.log("─".repeat(78))
console.log("SITES:")
for (const [k, v] of Object.entries(out)) {
  console.log(`  ${k.padEnd(36)} sites=${String(v.sites).padStart(6)}  files=${String(v.files).padStart(5)}`)
  for (const s of v.samples) console.log(`      ${s}`)
}
console.log("═".repeat(78))
if (jsonOut) console.log(`JSON written: ${jsonOut}`)
