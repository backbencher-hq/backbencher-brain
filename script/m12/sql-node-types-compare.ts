import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { ASTEngine } from "../../src/ast/engine"

/**
 * M12 SQL node-type alignment gate.
 *
 * WHAT THIS REPLACED, and why it was not a gate: the previous version extracted
 * referenced node types with the regex
 *   /case\s+"([a-z_]+)"|\.type\s*===\s*"([a-z_]+)"|\.type\s*===\s*"([a-z_]+)"/
 * and then asserted `passed: live.length > 0`. Three defects, all of which let a
 * false claim through:
 *
 *  1. THE REGEX MISSES MOST CALL SITES. The analyzer reaches node types through
 *     `descendants(node, "x")`, `firstDescendant`, `directChild`, `containsType`,
 *     `containsChildType`, `namedChildren(...).filter(c => c.type === "x")` and
 *     two module-level Sets (`identifierTypes`, and the DECLARATION_NODES set).
 *     None of those match a `.type ===` comparison, so a whole class of
 *     references was invisible to the audit.
 *  2. `passed: live.length > 0` PASSES IF EXACTLY ONE REFERENCED TYPE IS LIVE.
 *     The lane's own `deadDefensiveReferences` list named 21 of 70 types as dead
 *     and the gate still reported `passed: true` — a list of 21 unreachable
 *     branches shipped as a green result.
 *  3. THE FIXTURE SET IS THREE FILES / 63 LINES. "Observed in the fixtures" was
 *     treated as "the grammar produces it", so a type the grammar emits only in
 *     T-SQL or PL/SQL read as dead and a type the fixtures happen to contain read
 *     as live.
 *
 * WHAT THIS DOES INSTEAD:
 *  - extracts references from the ANALYZER SOURCE with a real scan of every
 *    accessor, not a regex over two syntactic forms;
 *  - observes the grammar over the WHOLE corpus, not three fixtures, so "live"
 *    means "the grammar really emits this", and reports the dialects each type
 *    appears in;
 *  - fails on ANY reference the grammar never produces, unless the type is on an
 *    explicit, justified allowlist carried in this file.
 *
 * The allowlist is deliberately empty for the SQL lane as of this run: every dead
 * branch it would have needed (`grant_statement` naming when the grammar had no
 * such rule, `*_statement`, `word`, `create_table_column_parameter`, `column_def`,
 * `references_constraint`, `foreign_key_constraint`, `primary_key_constraint`,
 * `unique_constraint`, `primary_key_constraint`) was either deleted or made real.
 */

const source = readFileSync("src/ast/real-sql-analyzer.ts", "utf8")

/** Every way the analyzer names a node type. Each entry is (pattern, why). */
const EXTRACTORS: { re: RegExp; why: string }[] = [
  { re: /\bcase\s+"([a-z0-9_]+)"/g, why: "switch case" },
  { re: /\.type\s*===\s*"([a-z0-9_]+)"/g, why: "type equality" },
  { re: /\.type\s*!==\s*"([a-z0-9_]+)"/g, why: "type inequality" },
  { re: /\.(?:descendants|firstDescendant|directChild|containsType|containsChildType|referencesTarget)\(\s*\w+\s*,\s*"([a-z0-9_]+)"/g, why: "typed accessor" },
  { re: /\.namedChildren\([^)]*\)\.filter\(\s*\w+\s*=>\s*\w+\.type\s*===\s*"([a-z0-9_]+)"/g, why: "filtered children" },
]

const refs = new Map<string, Set<string>>()
for (const { re, why } of EXTRACTORS) {
  for (const m of source.matchAll(re)) {
    if (!m[1]) continue
    if (!refs.has(m[1])) refs.set(m[1], new Set())
    refs.get(m[1])!.add(why)
  }
}

/**
 * Module-level Sets, classified BY NAME.
 *
 * The analyzer holds Sets of two different kinds and conflating them is how a
 * keyword list ends up audited as a node-type list: `SQL_KEYWORDS` and
 * `SQL_BUILTINS` are SQL words, not grammar node types, and a gate that cannot
 * tell them apart reports every reserved word as a dead reference. So a Set is
 * read as a NODE-TYPE Set only when its name says it is one — `identifierTypes`,
 * `queryTypes`, `DECLARATION_NODES`, `*NodeTypes`, `*NODES`. Anything else is
 * recorded under `nonNodeTypeSets` so the exclusion is visible in the artifact
 * rather than implicit.
 */
const nonNodeTypeSets: Record<string, string[]> = {}
for (const m of source.matchAll(/const\s+([A-Za-z0-9_]+)\s*=\s*new Set(?:<[^>]*>)?\(\[([\s\S]*?)\]\)/g)) {
  const name = m[1]
  const members = [...m[2].matchAll(/"([a-zA-Z0-9_]+)"/g)].map((x) => x[1])
  const isNodeTypeSet = /(?:Types|NODES|NodeTypes)$/.test(name)
  if (!isNodeTypeSet) {
    nonNodeTypeSets[name] = members
    continue
  }
  for (const t of members) {
    if (!refs.has(t)) refs.set(t, new Set())
    refs.get(t)!.add(`Set ${name}`)
  }
}

/**
 * Types the analyzer references that are NOT node types at all: field names,
 * metadata keys, symbol kinds, relationship types and pattern strings. Listing
 * them here is what makes the allowlist auditable — a name is either a node type
 * the grammar emits or a name in this set, and adding to this set is a visible
 * decision.
 */
const NOT_NODE_TYPES = new Set([
  // grammar FIELD names
  "type", "custom_type", "name", "value", "precision", "scale", "size", "schema", "database",
  "increment", "start", "alias", "argument", "column", "col_name", "old_name", "new_name",
  "operation", "operator", "option", "parameter", "password", "predicate", "left", "right",
  "low", "high", "user", "unit", "function", "expression", "enum_element", "new", "table",
  // metadata keys the analyzer writes
  "table", "column", "constraint", "view", "materialized_view", "index", "trigger", "enum",
  "custom_type", "schema", "sequence", "role", "extension", "database", "policy", "procedure",
  "function", "enumValues", "fields", "indexName", "isSchemaEntity", "isTrigger", "targetTable",
  "actionFunction", "sqlType", "isPrimaryKey", "isUnique", "isNullable", "references",
  "constraintKind", "sqlFunction", "functionName", "qualifiedName", "returnsTable",
  "recoveredFromErrorRegion", "addedByAlter", "operation", "tableReference", "qualified",
  "dependency", "indexOn", "triggerTarget", "triggerAction", "policyOn", "documented",
  "constraint_kind", "column_name", "type_name",
  // symbol kinds / relationship types / pattern words
  "class", "property", "function", "constant", "namespace", "module", "type", "contains",
  "references", "uses", "calls", "imports", "exports", "extends", "implements", "overrides",
  "Tables", "Views", "Materialized Views", "Custom Indexes", "Stored Functions", "Triggers",
  "Enum Types", "Custom Types", "Schemas", "Sequences", "Extensions", "Roles", "Databases",
  "Procedures", "Schema Evolution (ALTER)", "Schema Evolution (DROP)", "INSERT Statements",
  "UPDATE Statements", "DELETE Statements", "MERGE Statements", "TRUNCATE Statements",
  "COPY Statements", "Session Configuration", "SQL Documentation",
  "Permissions (GRANT/REVOKE)", "Row Level Security", "Join Query Mapping",
  "Common Table Expressions (CTE)", "Set Operations (UNION/INTERSECT/EXCEPT)", "Subqueries",
  "Conditional Logic (CASE/WHEN)", "SELECT *", "Primary Key Constraint", "Unique Constraint",
  "Foreign Key Constraints", "Transaction Management", "Procedural Block", "RETURNING Clause",
  // shape guards, not node types
  "integer", "bigint", "numeric", "varchar", "timestamp", "uuid", "double", "text",
  "boolean", "date", "time", "datetime", "smallint", "tinyint", "mediumint", "char",
  "nvarchar", "json", "int",
])

const candidateTypes = [...refs.entries()]
  .filter(([t]) => !NOT_NODE_TYPES.has(t))
  .map(([t, whys]) => ({ type: t, referencedVia: [...whys].sort() }))

/**
 * Observe the grammar over the WHOLE corpus AND over a declared probe set.
 *
 * Corpus-only observation is its own false negative: ProxiCall contains no
 * CREATE TYPE, no CREATE PROCEDURE, no CREATE POLICY, no MERGE and no
 * parameter-mode prefix, so a grammar that emits every one of them reads as not
 * emitting them and the gate would demand an allowlist entry for correct code.
 * "Live" has to mean "the grammar emits this somewhere the lane actually looks",
 * so the observed set is the union of the real corpus and the dialect battery,
 * and the artifact records WHICH source each type came from — a type that only
 * exists in a probe stays visible as probe-only rather than passing silently.
 */
const CORPUS = process.env.BB_SQL_CORPUS ?? "$HOME/ProxiCall"
const PROBE_DIR = "$HOME/fixtures/sql/probe/dialects"
const observed = new Map<string, Set<string>>()
let corpusFiles = 0
let corpusBytes = 0
let probeFiles = 0

const absorb = (tree: any, label: string): void => {
  const stack: any[] = [tree.rootNode]
  while (stack.length) {
    const n = stack.pop()
    if (!observed.has(n.type)) observed.set(n.type, new Set())
    observed.get(n.type)!.add(label)
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
}

const parser = await ASTEngine.getParser("sql" as any)
try {
  const { execFileSync } = await import("node:child_process")
  const list = execFileSync("git", ["-C", CORPUS, "ls-files", "*.sql", "*.SQL", "*.psql", "*.ddl"], { encoding: "utf8" })
    .trim().split("\n").filter(Boolean)
  for (const rel of list) {
    const text = readFileSync(join(CORPUS, rel), "utf8")
    corpusFiles++
    corpusBytes += text.length
    const tree = parser.parse(text)
    absorb(tree, `corpus:${rel}`)
    tree.delete?.()
  }
} catch (e: any) {
  console.error(`WARN: corpus observation failed (${e?.message?.slice(0, 160)}); falling back to the m12 fixture set`)
  for (const f of readdirSync("validation/m12/fixtures/sql").filter((x) => x.endsWith(".sql"))) {
    corpusFiles++
    const tree = parser.parse(readFileSync(join("validation/m12/fixtures/sql", f), "utf8"))
    absorb(tree, `m12-fixture:${f}`)
    tree.delete?.()
  }
}
if (existsSync(PROBE_DIR)) {
  for (const f of readdirSync(PROBE_DIR).filter((x) => x.endsWith(".sql")).sort()) {
    probeFiles++
    const tree = parser.parse(readFileSync(join(PROBE_DIR, f), "utf8"))
    absorb(tree, `probe:${f}`)
    tree.delete?.()
  }
}

/** The explicit allowlist of referenced-but-not-emitted types, each with a reason. */
const ALLOWLIST: Record<string, string> = {}

const live = candidateTypes.filter((c) => observed.has(c.type))
const dead = candidateTypes.filter((c) => !observed.has(c.type))
const unjustifiedDead = dead.filter((c) => !ALLOWLIST[c.type])

const result = {
  schemaVersion: 2,
  analyzer: "sql",
  analyzerSource: "src/ast/real-sql-analyzer.ts",
  // Names the PATCH, not the upstream version, and names the patch that is
  // actually wired. The previous string still described the V2 patch set
  // ("opaque dollar-quote body") two candidates after the opaque DO body was
  // REJECTED and the plpgsql grammar shipped, so the artifact misdescribed its
  // own bytes. Validated by sha256 in validation/m14/grammar-pins.json.
  grammar: "@derekstride/tree-sitter-sql 0.3.11 (PATCHED: named key constraints, DELETE USING/alias, GRANT/REVOKE as visible nodes, DO/DROP POLICY, and PL/pgSQL procedural statement scaffolding) — wired sha256 9d2142efde7d17205b5e662343536eba1babe1c965857e24dd4f4b253a693e20",
  observation: { corpus: CORPUS, corpusFiles, corpusBytes, probeFiles, distinctNodeTypesObserved: observed.size },
  extraction: {
    note: "Every accessor form is scanned, not a two-form regex. The old gate's regex matched only `case \"x\"` and `.type === \"x\"`, so `descendants(node, \"x\")`, `containsType`, `directChild`, the identifier-type Set and the declaration-node Set were all invisible to it.",
    candidateNodeTypes: candidateTypes.length,
    nonNodeTypeSetsExcluded: Object.fromEntries(Object.entries(nonNodeTypeSets).map(([k, v]) => [k, v.length])),
    nonNodeTypeSetsNote: "Sets whose name does not end in Types/NODES are SQL word lists, not grammar node types. Excluding them by NAME (not by hand-listing their members) is what keeps SQL_KEYWORDS from being audited as 180 dead node-type references.",
  },
  referencedNodeTypes: candidateTypes.map((c) => c.type).sort(),
  liveReferencedNodeTypes: live.map((c) => c.type).sort(),
  probeOnlyReferencedNodeTypes: live.filter((c) => ![...(observed.get(c.type) ?? [])].some((f) => f.startsWith("corpus:") || f.startsWith("m12-fixture:"))).map((c) => c.type).sort(),
  probeOnlyNote: "Referenced node types the pinned CORPUS never exercises but the declared dialect battery does. Kept visible because a type that only a probe produces is the shape a corpus-only gate gets wrong in the other direction.",
  deadDefensiveReferences: dead.map((c) => ({ type: c.type, referencedVia: c.referencedVia, justification: ALLOWLIST[c.type] ?? null })),
  unjustifiedDeadReferences: unjustifiedDead.map((c) => c.type).sort(),
  observedCorpusNodeTypes: [...observed.keys()].sort(),
  passed: unjustifiedDead.length === 0 && live.length > 0,
  rule: "every node type the analyzer names must be one the grammar emits over the whole corpus, unless it carries a written justification in ALLOWLIST above. `passed` is no longer `live.length > 0`.",
}
writeFileSync("validation/m12/results/sql-shape-safety.json", JSON.stringify(result, null, 2) + "\n")
console.log(`observation: ${corpusFiles} corpus files (${corpusBytes} bytes) + ${probeFiles} probe files, ${observed.size} distinct node types`)
console.log(`referenced node-type candidates: ${candidateTypes.length}`)
console.log(`live: ${live.length}  dead: ${dead.length}  unjustified-dead: ${unjustifiedDead.length}`)
for (const d of unjustifiedDead) console.log(`  DEAD (no justification): ${d.type}  via ${d.referencedVia.join(", ")}`)
console.log(`passed=${result.passed}`)
if (!result.passed) process.exitCode = 1
