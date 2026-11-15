/**
 * SQL CONSTRUCT PROBE — instrument A (grammar inventory) and instrument B
 * (parse-tree semantic count) for the relationship types this lane does not emit.
 *
 * WHY A TEXT REGEX IS THE WRONG INSTRUMENT HERE, and what it would have cost.
 * The ontology gate's first version returned two false positives from text
 * probes: `extends` matched the words `class voice` inside a telnet IAC word
 * list in a string literal, and `instantiates` matched `new Map(` in a bash file
 * carrying embedded JavaScript in a heredoc. A SQL text probe is worse, because
 * `CREATE`, `FUNCTION` and the word `TABLE` all occur constantly inside plpgsql
 * bodies, dollar-quoted strings and `EXECUTE '…'` literals — 1,326 CREATE
 * declarations on the PostgreSQL extension corpus sit inside string literals
 * where a regex would happily "find" them and the tree cannot. So this probe
 * reads the PARSE TREE only, and for the one construct that is a string by
 * construction (`psql \i`, which names another file), it says so explicitly
 * rather than pretending the tree settles it.
 *
 * WHAT IS PRINTED
 *   1. Every distinct node type the wired grammar produces across the whole
 *      admitted corpus, with occurrence counts. That is instrument A's raw
 *      material: a ruling that says "the grammar has no node expressing X" is
 *      checkable against this list by anyone, without re-running this script.
 *   2. For each of the six non-emitted types, a semantic probe with its own
 *      count, its files, and its examples. Each probe names the NODE SHAPE it
 *      keys on, so a reader can check the probe against the grammar rather than
 *      trusting the number.
 *
 * USAGE:
 *   npx tsx validation/m14/fixtures/sql/construct-probe.mts [--out FILE]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from "node:fs"
import * as path from "node:path"
import { Parser, Language } from "web-tree-sitter"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..")
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const argv = process.argv.slice(2)
const argOf = (f: string) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined }
const OUT = argOf("--out")
const SIZE_CAP = 512 * 1024

const admitted: { repo: string; rel: string; abs: string; text: string }[] = []
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
    try { if (statSync(abs).size > SIZE_CAP) continue; text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "sql") continue
    admitted.push({ repo: entry, rel, abs, text })
  }
}

await Parser.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const language = await Language.load(readFileSync(path.join(ROOT, "wasm", "tree-sitter-sql.wasm")))
const parser = new Parser()
parser.setLanguage(language as any)

// ------------------------------------------------------------------ parse once
const trees: { label: string; root: any }[] = []
const vocabulary = new Map<string, number>()
const fieldsByType = new Map<string, Set<string>>()
let parseErrors = 0
for (const f of admitted) {
  const tree = parser.parse(f.text)
  if (!tree) { parseErrors++; continue }
  const label = `${f.repo}/${f.rel}`
  trees.push({ label, root: tree.rootNode })
  const stack: any[] = [tree.rootNode]
  while (stack.length) {
    const n = stack.pop()
    vocabulary.set(n.type, (vocabulary.get(n.type) ?? 0) + 1)
    if (!fieldsByType.has(n.type)) fieldsByType.set(n.type, new Set())
    const fs = fieldsByType.get(n.type)!
    for (let i = 0; i < n.childCount; i++) {
      const field = n.fieldNameForChild(i)
      if (field) fs.add(field)
    }
    for (let i = 0; i < n.childCount; i++) stack.push(n.child(i))
  }
}

// A counter that DOES NOT CAP, and a separate example list that does.
//
// The first version capped the hit LIST at 400 and reported `list.length` as the
// occurrence count. Every count under 400 was right and `instantiates-cast`
// reported 400 when the grammar produces 4,406 `cast` nodes over the corpus —
// a number that looked like a measurement and was a display limit. Counts are
// now unbounded and only the examples are bounded, which is the only ordering
// where a truncated page cannot be read as the whole set.
type Hit = { type: string; label: string; detail: string }
const hits = new Map<string, Hit[]>()
const counts = new Map<string, number>()
const hit = (type: string, label: string, detail: string) => {
  counts.set(type, (counts.get(type) ?? 0) + 1)
  const list = hits.get(type) ?? []
  if (list.length < 400) list.push({ type, label, detail })
  hits.set(type, list)
}

const walk = (root: any, fn: (n: any) => void) => {
  const stack: any[] = [root]
  while (stack.length) {
    const n = stack.pop()
    fn(n)
    for (let i = 0; i < n.childCount; i++) stack.push(n.child(i))
  }
}
const namedOf = (n: any, type: string) => n.namedChildren.filter((c: any) => c.type === type)

// ------------------------------------------------------------------ probes
//
// P1 `extends` — PostgreSQL table inheritance. Two distinct SQL constructs:
//    CREATE TABLE c (…) INHERITS (p [, …])   and   ALTER TABLE c INHERIT p
//    CREATE TABLE c (LIKE p [INCLUDING …])     structural copy, not inheritance
// Probed on the tree: a `create_table`/`alter_table` subtree carrying a token
// whose text is the keyword, so a `INHERITS` inside a string literal cannot hit.
for (const { label, root } of trees) {
  walk(root, (n) => {
    if (n.type === "create_table" || n.type === "alter_table" || n.type === "create_table_statement") {
      const toks = new Set<string>()
      walk(n, (c) => { if (c.childCount === 0) toks.add(c.text.toUpperCase()) })
      for (const kw of ["INHERITS", "INHERIT"]) {
        if (toks.has(kw)) hit("extends-inherits", label, `${n.type} carries token ${kw} — ${n.text.slice(0, 90).replace(/\s+/g, " ")}`)
      }
      if (toks.has("LIKE")) hit("extends-like", label, `${n.type} carries token LIKE — ${n.text.slice(0, 90).replace(/\s+/g, " ")}`)
    }
  })
}

// P2 `implements` — a supertype/interface clause. SQL has no interface type; the
// closest SQL shape is a type satisfying a DOMAIN or a CHECK, neither of which
// names a supertype. Probed on the tree for any clause keyword that would carry
// one.
for (const { label, root } of trees) {
  walk(root, (n) => {
    if (n.childCount !== 0) return
    const t = n.text.toUpperCase()
    if (t === "IMPLEMENTS") hit("implements-keyword", label, `${n.type} token IMPLEMENTS`)
    if (n.type === "implements_clause" || n.type === "superclass" || n.type === "interface_implementation" || n.type === "extends_clause") {
      hit("implements-node", label, `${n.type} — ${n.text.slice(0, 90).replace(/\s+/g, " ")}`)
    }
  })
}

// P3 `instantiates` — a constructor invocation. SQL has no `new`. The nearest
// shapes are (a) a CAST to a user-defined composite/enum type, which is
// PostgreSQL's row constructor, and (b) `CREATE TABLE x (…)` with a `LIKE`
// clause, already counted under extends-like. Probed on the tree.

// P4 `overrides` — a SECOND declaration of the SAME OBJECT already declared in
// the same file. PostgreSQL re-declares on purpose: `CREATE OR REPLACE FUNCTION`
// is a replacement, and the stock extension corpus carries one file PER VERSION
// with the same function declared in every version.
//
// THE PROBE BUGS THIS REPLACED, recorded because both are the exact failure the
// workstream warns about — "a probe that matches a SHAPE rather than a ROLE
// produces a number, and the number is worth nothing". Both produced numbers
// large enough to look like a finding, and both were wrong:
//
//   BUG 1 — keying on the FIRST `identifier` under the declaration's
//   `object_reference`. For `CREATE OR REPLACE FUNCTION hdb_catalog.f()` that is
//   the SCHEMA, so it reported 43 function "redefinitions" in which `hdb_catalog`
//   and `public` collided with themselves and `CREATE FUNCTION request.cookie`
//   reported `request`. Now keyed on the LEAF, the accessor the analyzer itself
//   uses.
//
//   BUG 2 — keying on the NAME alone, across declaration kinds. Hasura's
//   `10_to_11.sql` declares `CREATE FUNCTION hdb_catalog.hdb_schema_update_…()`
//   at line 7 and `CREATE TRIGGER hdb_schema_update_…` at line 25. Those are two
//   DIFFERENT OBJECTS that share a name; nothing is replaced. Now keyed on
//   `kind:name`.
//
// With both fixed, a redefinition is only counted when the same kind re-declares
// the same name, and it is then classified by whether the second declaration
// carries `OR REPLACE` (a replacement in PostgreSQL's own words) and whether a
// `DROP` of that name sits between the two (a schema migration, which is a
// re-creation and not an override).
const DECL = ["create_function", "create_procedure", "create_table", "create_view", "create_trigger", "create_materialized_view", "create_type", "create_schema"]
const DROP = ["drop_table", "drop_view", "drop_index", "drop_type", "drop_schema", "drop_sequence", "drop_function", "drop_procedure", "drop_trigger"]
const declaredNames = new Map<string, Map<string, { count: number; kind: string; line: number; start: number; orReplace: boolean }>>()
let orReplaceTotal = 0
for (const { label, root } of trees) {
  const perFile = new Map<string, { count: number; kind: string; line: number; start: number; orReplace: boolean }>()
  const drops: { name: string; start: number }[] = []
  walk(root, (n) => {
    if (n.type === "drop_table" || n.type === "drop_view" || n.type === "drop_index" || n.type === "drop_type" ||
      n.type === "drop_schema" || n.type === "drop_sequence" || n.type === "drop_function" || n.type === "drop_procedure" ||
      n.type === "drop_trigger") {
      const obj = n.descendantsOfType("object_reference")[0] as any
      if (obj) {
        const leaves: any[] = [...obj.descendantsOfType("identifier"), ...obj.descendantsOfType("literal")].sort((a, b) => a.startIndex - b.startIndex)
        if (leaves.length) drops.push({ name: leaves[leaves.length - 1].text.replace(/^["`[]/, "").replace(/["`\]]$/, ""), start: n.startIndex })
      }
      return
    }
    if (!DECL.includes(n.type)) return
    const head = n.text.slice(0, 48).toUpperCase()
    const orReplace = head.includes("OR REPLACE")
    if (orReplace) orReplaceTotal++
    const obj = n.descendantsOfType("object_reference")[0] as any
    if (!obj) return
    // The LEAF of the reference: last identifier/literal in document order.
    const leaves: any[] = [...obj.descendantsOfType("identifier"), ...obj.descendantsOfType("literal")]
      .sort((a, b) => a.startIndex - b.startIndex)
    if (leaves.length === 0) return
    const name = leaves[leaves.length - 1].text.replace(/^["`[]/, "").replace(/["`\]]$/, "")
    if (!name) return
    const key = `${n.type}:${name}`
    const rec = perFile.get(key) ?? { count: 0, kind: n.type, line: n.startPosition.row + 1, start: n.startIndex, orReplace: false }
    rec.count++
    if (rec.count === 2) {
      const droppedBetween = drops.some((d) => d.name === name && d.start > rec.start && d.start < n.startIndex)
      const laterHasReplace = orReplace
      const bucket = laterHasReplace ? "overrides-replace" : droppedBetween ? "overrides-after-drop" : "overrides-duplicate"
      const shape = laterHasReplace
        ? `second carries OR REPLACE (a replacement in PostgreSQL's own words)${droppedBetween ? "; a DROP of this name also sits between them" : ""}`
        : droppedBetween
          ? "no OR REPLACE, but a DROP of this name sits between them — a re-creation, not a replacement"
          : "no OR REPLACE and no intervening DROP — a duplicate declaration PostgreSQL would reject"
      hit(bucket, label, `${n.type} ${name}: first at line ${rec.line}, again at line ${n.startPosition.row + 1}; ${shape} — ${n.text.slice(0, 76).replace(/\s+/g, " ")}`)
    }
    rec.orReplace = rec.orReplace || orReplace
    perFile.set(key, rec)
  })
  declaredNames.set(label, perFile)
}
hit("or-replace-total", "corpus", `${orReplaceTotal} OR REPLACE declarations across the corpus`)

// The corpus-wide set of DECLARED type names, so the `instantiates` cast probe
// can ask the only question that matters: does any cast in the corpus target a
// type some file actually declares?
const declaredTypeNames = new Set<string>()
for (const { root } of trees) {
  walk(root, (n) => {
    if (n.type !== "create_type" && n.type !== "create_table") return
    const obj = n.descendantsOfType("object_reference")[0] as any
    if (!obj) return
    const leaves: any[] = [...obj.descendantsOfType("identifier"), ...obj.descendantsOfType("literal")]
      .sort((a, b) => a.startIndex - b.startIndex)
    if (leaves.length) declaredTypeNames.add(leaves[leaves.length - 1].text.replace(/^["`[]/, "").replace(/["`\]]$/, "").toLowerCase())
  })
}
// A cast to a user-defined type is PostgreSQL/DuckDB's composite- or
// alias-constructor: `ROW(1,2)::my_composite` builds a value of the declared
// composite type, and PostgreSQL implements it as a call to that type's
// constructor. That is the only shape in SQL that carries the meaning the
// ontology gives `instantiates`, and the grammar marks it structurally — the
// target is the `custom_type` FIELD of the `cast`, where a builtin target such
// as `::integer` is a bare anonymous token with no field at all. So the probe
// needs no hand-written builtin-type list, which is what killed its first
// version: it sliced the target out of the node TEXT after the first `::`, and a
// `cast` holding two casts reported targets like `::numeric /::numeric` and
// `::real) as float)`. Shape, not role, again.
const castTargets = new Map<string, number>()
const castLeftShapes = new Map<string, number>()
for (const { label, root } of trees) {
  walk(root, (n) => {
    if (n.type !== "cast") return
    const target = n.childForFieldName("custom_type") as any
    if (!target) return
    const leaves: any[] = [...target.descendantsOfType("identifier"), ...target.descendantsOfType("literal")]
      .sort((a, b) => a.startIndex - b.startIndex)
    if (leaves.length === 0) return
    const name = leaves[leaves.length - 1].text.replace(/^["`[]/, "").replace(/["`\]]$/, "").toLowerCase()
    if (!name) return
    castTargets.set(name, (castTargets.get(name) ?? 0) + 1)
    // The VALUE side: the named child before the `::` token. Recorded by node
    // type, because "constructed from a literal" and "converted from a column"
    // are different claims and only the first is an instantiation.
    let left: any = null
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i)
      if (c.type === "::") break
      if (c.isNamed) left = c
    }
    const shape = left ? `${left.type}${left.hasError ? "(ERROR)" : ""}` : "(none)"
    castLeftShapes.set(shape, (castLeftShapes.get(shape) ?? 0) + 1)
    const bucket = declaredTypeNames.has(name)
      ? left && !left.hasError && (left.type === "invocation" || left.type === "array" || left.type === "list")
        ? "instantiates-constructed-declared-type"
        : "instantiates-converted-declared-type"
      : "instantiates-undeclared-type"
    hit(bucket, label, `::${name} from a ${shape} node — ${n.text.slice(0, 70).replace(/\s+/g, " ")}`)
  })
}

// P5 `imports` — a dependency on ANOTHER FILE. The one construct that names a
// file is psql's `\i` / `\ir` include meta-command, which the grammar patch
// reads as an `extra`. `psql_meta_command` is a LEAF token whose text is the
// whole directive, so the command word and its argument are both inside that one
// token; the probe reports them separated, and says how many arguments are a
// psql VARIABLE (`:name`) rather than a literal path — a variable target cannot
// be resolved without the script that set it, and an edge whose target is
// invented from a variable name is a fabricated edge.
const psqlCommands = new Map<string, number>()
let psqlIncludeLiteral = 0
let psqlIncludeVariable = 0
let psqlIncludeOther = 0
for (const { label, root } of trees) {
  walk(root, (n) => {
    if (n.type === "ERROR") {
      // psql meta-commands that the wired grammar does not recognise land here.
      const t = n.text.trimStart()
      if (t.startsWith("\\")) hit("imports-error-backslash", label, `${n.type}: ${n.text.slice(0, 80).replace(/\s+/g, " ")}`)
      return
    }
    if (n.type !== "psql_meta_command") return
    hit("imports-node", label, `${n.type}: ${n.text.slice(0, 80).replace(/\s+/g, " ")}`)
    const text = n.text
    let i = 0
    while (i < text.length && text[i] !== " " && text[i] !== "\t" && text[i] !== "\n" && text[i] !== "\r") i++
    const command = text.slice(1, i).toLowerCase()
    const argument = text.slice(i).trim()
    psqlCommands.set(command, (psqlCommands.get(command) ?? 0) + 1)
    if (command !== "i" && command !== "ir") return
    if (argument.length === 0 || argument.startsWith(":")) { psqlIncludeVariable++; hit("imports-variable", label, `\\${command} ${argument.slice(0, 40)} — variable target, not resolvable`); return }
    const lower = argument.toLowerCase()
    if (lower.endsWith(".sql") || lower.endsWith(".psql") || lower.endsWith(".dump")) {
      psqlIncludeLiteral++
      hit("imports-file", label, `\\${command} ${argument} — names another file on disk`)
      return
    }
    psqlIncludeOther++
    hit("imports-other", label, `\\${command} ${argument.slice(0, 50)} — include with no recognisable filename extension`)
  })
}

// P6 `exports` — a module surface this file publishes. SQL files have no module
// surface: every object a migration declares is global to the database. Probed
// for the node shapes that would carry one, plus the two SQL constructs that
// carry an explicit list of names attached to something.
for (const { label, root } of trees) {
  walk(root, (n) => {
    if (n.childCount !== 0) return
    const t = n.text.toUpperCase()
    // A KEYWORD TOKEN, not a word. Pass 3's probe counted any leaf whose text is `EXPORT`,
    // `MODULE` or `PROVIDE`, and the corpus grew one file that declares a COLUMN named `module`
    // (`dark/backend/migrations/schema/09-user-data.sql` line 36, `module TEXT,`), so the
    // instrument-A evidence for the `exports` ruling silently moved from 0 to 1 and the number
    // meant nothing. This is the gate header's own false-positive shape — a probe for `extends`
    // matching `class voice` in a telnet IAC word list — reached from the other direction: not a
    // string literal but an ordinary identifier.
    //
    // The grammar is the discriminator and it settles the ruling on its own: **no node type
    // anywhere in the 480-type vocabulary contains `export`, `module` or `provide`, keyword or
    // otherwise.** There is no `keyword_module`, which is exactly why `module` lexes as an
    // `identifier`. So the keyword probe is keyed on the node TYPE, and a same-spelled identifier
    // is counted in its own bucket so the artifact shows the distinction instead of hiding it.
    if (t === "EXPORT" || t === "MODULE" || t === "PROVIDE") {
      if (n.type.startsWith("keyword_")) hit("exports-keyword", label, `${n.type} token ${t}`)
      else hit("exports-identifier-spelled-like-a-keyword", label, `${n.type} "${n.text}" at line ${n.startPosition.row + 1} — a declaration NAME, not a keyword`)
    }
    if (n.type === "export_statement" || n.type === "module_declaration" || n.type === "namespace_declaration") {
      hit("exports-node", label, `${n.type} — ${n.text.slice(0, 70)}`)
    }
    if (n.type === "grant_statement") hit("exports-grant", label, `grant_statement: ${n.text.slice(0, 90).replace(/\s+/g, " ")}`)
  })
}

// ------------------------------------------------------------------ report
const sortedVocab = [...vocabulary.entries()].sort((a, b) => b[1] - a[1])
console.log("SQL construct probe")
console.log(`corpus          ${admitted.length} admitted files, ${trees.length} parsed, ${parseErrors} parse failures`)
console.log(`grammar         wasm/tree-sitter-sql.wasm`)
console.log(`distinct node types produced by the grammar across the corpus: ${sortedVocab.length}`)
console.log("")
console.log("--- instrument A: full grammar node-type inventory (count, type) ---")
for (const [type, n] of sortedVocab) {
  const fields = [...(fieldsByType.get(type) ?? [])].sort()
  console.log(`${String(n).padStart(9)}  ${type}${fields.length ? `   fields: ${fields.join(",")}` : ""}`)
}
console.log("")
console.log("--- instrument B: semantic construct counts on the parse tree ---")
for (const [type, list] of [...hits.entries()].sort()) {
  const files = new Set(list.map((h) => h.label))
  console.log(`${type.padEnd(28)} occurrences ${String(counts.get(type) ?? 0).padStart(6)}   files(capped sample) ${String(files.size).padStart(5)}`)
  for (const h of list.slice(0, 3)) console.log(`      ${h.label}\n        ${h.detail}`)
}
console.log("")
console.log("--- psql meta-command census (the `imports` construct) ---")
console.log(`  psql_meta_command nodes total: ${psqlCommands.size ? [...psqlCommands.values()].reduce((a, b) => a + b, 0) : 0}`)
for (const [cmd, n] of [...psqlCommands.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  \\${cmd.padEnd(18)} ${String(n).padStart(5)}`)
}
console.log(`  include with a LITERAL filename : ${psqlIncludeLiteral}`)
console.log(`  include with a VARIABLE target : ${psqlIncludeVariable}`)
console.log(`  include with no filename suffix : ${psqlIncludeOther}`)
console.log("")
console.log("--- cast target frequency (every `cast` node's custom_type field, unbounded) ---")
for (const [t, n] of [...castTargets.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ::${t.padEnd(40)} ${String(n).padStart(5)}${declaredTypeNames.has(t) ? "   DECLARED IN CORPUS" : ""}`)
}
console.log("--- cast VALUE side node types (what is being converted) ---")
for (const [t, n] of [...castLeftShapes.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${t.padEnd(40)} ${String(n).padStart(5)}`)
}
console.log("")
const zero = ["extends-inherits", "implements-keyword", "implements-node", "instantiates-node", "imports-variable", "imports-other", "exports-keyword", "exports-node", "exports-grant", "exports-identifier-spelled-like-a-keyword"]
console.log("--- zero-result summary ---")
for (const k of zero) {
  console.log(`  ${k.padEnd(28)} ${String(counts.get(k) ?? 0).padStart(6)}`)
}
for (const t of ["overrides-replace", "overrides-after-drop", "overrides-duplicate"]) {
  const list = hits.get(t) ?? []
  const files = new Set(list.map((h) => h.label))
  console.log(`  ${t.padEnd(28)} ${String(counts.get(t) ?? 0).padStart(6)}   files(capped sample) ${files.size}`)
  for (const h of list.slice(0, 4)) console.log(`      ${h.label}\n        ${h.detail}`)
}
const ort = hits.get("or-replace-total") ?? []
console.log(`  ${"or-replace-declarations".padEnd(28)} ${String(ort.length ? ort[0].detail.split(" ")[0] : 0).padStart(6)}   (all OR REPLACE declarations, corpus-wide)`)

if (OUT) {
  mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true })
  writeFileSync(path.resolve(OUT), `${JSON.stringify({
    corpusRoot: CR,
    admittedFiles: admitted.length,
    parsed: trees.length,
    parseFailures: parseErrors,
    grammarWasm: "wasm/tree-sitter-sql.wasm",
    distinctNodeTypes: sortedVocab.length,
    grammarVocabulary: sortedVocab.map(([type, n]) => ({ type, n, fields: [...(fieldsByType.get(type) ?? [])].sort() })),
    constructCounts: Object.fromEntries([...counts.entries()].sort()),
    constructExamples: Object.fromEntries([...hits.entries()].map(([k, v]) => [k, v.slice(0, 8)])),
    castTargetFrequency: Object.fromEntries([...castTargets.entries()].sort((a, b) => b[1] - a[1])),
    castValueSideShapes: Object.fromEntries([...castLeftShapes.entries()].sort((a, b) => b[1] - a[1])),
    psqlMetaCommands: Object.fromEntries([...psqlCommands.entries()].sort((a, b) => b[1] - a[1])),
    psqlInclude: { literalFilename: psqlIncludeLiteral, variableTarget: psqlIncludeVariable, noFilenameSuffix: psqlIncludeOther },
    declaredTypeNames: [...declaredTypeNames].sort(),
    zeroProbes: zero.map((k) => ({ probe: k, occurrences: counts.get(k) ?? 0 })),
    overrideProbe: Object.fromEntries(["overrides-replace", "overrides-after-drop", "overrides-duplicate"].map((t) => [t, counts.get(t) ?? 0])),
  }, null, 2)}\n`)
  console.log(`\nwrote ${OUT}`)
}