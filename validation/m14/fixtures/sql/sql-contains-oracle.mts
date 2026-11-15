/**
 * SQL's independent `contains` derivation — the DERIVATION half of this lane's debt.
 *
 * WHY THIS FILE EXISTS. `script/m60/rel-type-coverage-gate.ts` CHECK 1 reports, for
 * `sql`:
 *
 *   DERIVATION|sql|emits `calls`      but the differential audits [extends, implements,
 *   DERIVATION|sql|emits `contains`   instantiates, overrides] — stored and compared
 *   DERIVATION|sql|emits `imports`    against nothing
 *   DERIVATION|sql|emits `references`
 *   DERIVATION|sql|emits `uses`
 *
 * The gate's `audited` set is an ALLOWLIST read out of `differential.ts`, not an
 * oracle-existence check — so it claims four labels are audited. `differential.ts`
 * cannot audit SQL at all: `LANG_REPOS` has no `sql` key, so the harness says so out
 * loud rather than reporting a fabricated 0/0 —
 *
 *   [lane] SKIP sql: no corpus repo mapped in LANG_REPOS and none checked out
 *
 * The true figure is therefore **7 of 7 emitted types compared against nothing**, not 5.
 * This file is the lane-owned half of the fix: a second derivation over the same
 * grammar, sharing nothing with the analyzer's walk.
 *
 * ## WHAT MAKES IT INDEPENDENT, AND WHAT DOES NOT
 *
 * Independent: the owner/member relation is re-derived from the GRAMMAR's own
 * structure — a `column_definition`, a named `table_constraint`, a `create_index` or a
 * `constraint` clause is a member of the nearest enclosing `create_table` /
 * `create_type` / `create_view` declaration, found by walking the tree, and the
 * analyzer's `ownerName` field, `qualifiedNameFor`, `treeIndexes` and `processNamed*`
 * dispatch are not consulted. It reads nodes and their children.
 *
 * NOT independent, and stated rather than hidden: it walks the SAME wasm grammar, so a
 * grammar bug shared by both paths is invisible to it, exactly as the lane brief says
 * for any oracle in this position. It is a second implementation, not a second language.
 *
 * ## WHAT IT CLAIMS
 *
 * `contains` in SQL means: a declaration is contained by the declaration that creates
 * it. Members are the things a `CREATE TABLE` body declares — columns, named table
 * constraints, inline indexes — and a `CREATE INDEX ON t` is contained by `t`. Nothing
 * else: an `INSERT` target is not contained by the table, a `GRANT` grantee is not, and
 * a name merely READ inside a trigger body is not a member of the trigger. Each of those
 * exclusions is a shape the adversarial fixtures pin, so the comparison can tell an
 * over-broad oracle from a correct one.
 *
 * `ORACLE_LABELS` is the export `script/m60/rel-type-coverage-gate.ts` reads
 * (`readOwnOracleLabels`, `export const [A-Z_]*ORACLE_LABELS`), so the lane's audited
 * set is derived from the emitter rather than restated in a shared file.
 *
 * Run: npx tsx validation/m14/fixtures/sql/sql-contains-oracle.mts [--sample N]
 */

import { readdirSync, statSync, readFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"
// web-tree-sitter 0.25 has no default export under tsx/node: `import wts from` is a
// SyntaxError and `import * as wts` yields no `init`. The named `Parser` / `Language`
// are the real API, and `construct-probe.mts` already imports them that way.
import { Parser, Language } from "web-tree-sitter"

/**
 * The labels this oracle derives. Kept to the ONE it actually implements: naming a
 * label here that the code below never derives is the exact mistake the shared
 * allowlist's own `#910` and `G7` notes record, in the direction that turns real edges
 * into MISSING rows.
 */
export const SQL_ORACLE_LABELS = ["contains"] as const

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"

/**
 * THE GRAMMAR'S OWN SHAPE, read off the tree rather than assumed. Measured on
 * validation/m12/fixtures/sql/{Schema,Schema2}.sql by walking every
 * `create_table` / `create_index` / `create_type` / `column_definitions` / `constraint`
 * node and printing its fields:
 *
 *   create_table         NO field for the table name. Its children are
 *                        keyword_create, keyword_table, object_reference, column_definitions.
 *   create_type          same shape: keyword_create, keyword_type, object_reference, …
 *   column_definitions   the body — members are its DIRECT children, not the owner's.
 *   column_definition    field `name` = identifier, field `type` = the type node.
 *   constraint           field `name` = identifier (`CONSTRAINT oi_order_fk …`).
 *   create_index         field `column` = the INDEX's own name; the table is the
 *                        `object_reference` that follows `keyword_on` and carries NO field.
 *   create_schema        an `identifier` child, no field.
 *
 * So an owner's name is "the object_reference / identifier that is not inside the body",
 * and a member's name is field `name`. Getting this from the tree rather than from the
 * analyzer is the independence the oracle rests on: an assumption here would be a
 * second copy of the analyzer's assumption rather than a check on it.
 */

/** The declarations that can OWN members. */
const OWNER_NODES = new Set([
  "create_table",
  "create_table_as",
  "create_type",
  "create_view",
  "create_materialized_view",
  "create_function",
  "create_procedure",
])

/** The nodes that are MEMBERS of an owner when they appear inside its body. */
const MEMBER_NODES = new Set(["column_definition", "constraint"])

/**
 * The body of a `CREATE TABLE` is not flat. Measured on
 * boundary/…/postgres/10/03_credential.up.sql, `column_definitions` for
 * `credential_library` has FOUR direct children:
 *
 *   0 column_definition  public_id wt_public_id primary key
 *   1 column_definition  store_id wt_public_id not null
 *   2 ERROR              constraint credential_store_fkey references …
 *   3 constraints        ,
 constraint credential_library_store_id_public_id_uq …
 *
 * so a TABLE-level constraint sits inside a `constraints` node one level below the body,
 * and a COLUMN-level one is an `ERROR` child of the body directly. Reading only the
 * body's direct children — which is what the first version did — misses every
 * table-level constraint: 43 of 46 analyzer-only edges in the 100-file sample were
 * exactly that class, and the oracle reported them as unexplained rather than as its own
 * blind spot. That distinction is the whole reason this instrument compares both
 * directions and prints causes.
 */
const BODY_GROUP_NODES = new Set(["constraints"])

/** An owner's own name: the reference its HEAD carries, never one from its body. */
function ownerName(node: any): string | null {
  for (const field of ["name", "table", "object_reference"]) {
    const child = node.childForFieldName?.(field)
    const t = child?.type
    if (t === "identifier" || t === "object_reference" || t === "qualified_name") return leafOf(t === "identifier" ? child.text : child.text)
  }
  // No field carries it (measured above), so take the head reference positionally: the
  // last `object_reference` / `identifier` BEFORE the body node.
  const bodyAt = node.children.findIndex((c: any) => c.type === "column_definitions")
  const limit = bodyAt < 0 ? node.childCount : bodyAt
  for (let i = 0; i < limit; i++) {
    const c = node.child(i)
    if (c.type === "object_reference" || c.type === "identifier") return leafOf(c.text)
  }
  return null
}

/** A member's own name: field `name`, which the measurement shows every member carries. */
function memberName(node: any): string | null {
  const child = node.childForFieldName?.("name")
  return child ? leafOf(child.text) : null
}

/**
 * A dotted reference's last component, with quoting removed — SQL quoting is syntax, not
 * part of the name, which is what `sqld16-quoted-dotted-name` pins.
 *
 * The split is PER COMPONENT rather than a strip-then-split, and the difference is
 * measured rather than stylistic: hasura-engine ships
 * `CREATE TABLE "public"."t1" ("id" serial …)`, and stripping the outer quotes from the
 * whole reference first leaves `public"."t1`, whose last dot is the one inside the quotes —
 * so the "leaf" comes back as `"t1` with a quote still attached and every edge in the file
 * misses. 265 analyzer-only edges over the corpus, all of them that shape.
 */
function leafOf(text: string | undefined): string | null {
  if (!text) return null
  // Split on the dots that are NOT inside quotes. `sqld16-quoted-dotted-name` pins the
  // distinction as a PARSE FACT — `FROM vault.secret` is two leaves, `FROM "vault.secret"`
  // is one — and this function has to honour it or the comparison measures the split, not
  // the analyzer. postgrest's `pgrst_reserved_chars` fixture writes `"a.dotted.column"` as
  // a single column name, and phpmyadmin's exploit_test.sql writes column names containing
  // dots, spaces and `;`, so a plain `.split(".")` mangles every one of them: 3 analyzer-only
  // and 11 oracle-only edges at the 1,962-file population were exactly this.
  const parts: string[] = []
  let current = ""
  let quote: string | null = null
  for (const ch of text) {
    if (quote) {
      current += ch
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "`") {
      quote = ch
      current += ch
      continue
    }
    if (ch === ".") {
      parts.push(current)
      current = ""
      continue
    }
    current += ch
  }
  parts.push(current)
  const cleaned = parts
    .map((part) => part.replace(/^["`\[]+/, "").replace(/["`\]]+$/, "").trim())
    .filter(Boolean)
  return cleaned.length ? cleaned[cleaned.length - 1] : null
}


/** The `ON <table>` of a CREATE INDEX: the object_reference after `keyword_on`. */
function indexSubject(node: any): string | null {
  if (node.type !== "create_index") return null
  for (let i = 0; i < node.childCount - 1; i++) {
    if (node.child(i).type === "keyword_on") {
      const ref = node.child(i + 1)
      if (ref.type === "object_reference" || ref.type === "identifier") return leafOf(ref.text)
    }
  }
  const field = node.childForFieldName?.("table")
  return field ? leafOf(field.text) : null
}

/** The table an `ALTER TABLE` acts on: the `object_reference` that follows
 *  `keyword_table`, with no field of its own. */
function alterSubject(node: any): string | null {
  for (let i = 0; i < node.childCount - 1; i++) {
    if (node.child(i).type === "keyword_table") {
      const ref = node.child(i + 1)
      if (ref && (ref.type === "object_reference" || ref.type === "identifier")) return leafOf(ref.text)
    }
  }
  return null
}

/** The index's OWN name — field `column`, which the measurement shows, not position. */
function indexOwnName(node: any): string | null {
  const f = node.childForFieldName?.("column") ?? node.childForFieldName?.("name")
  return f ? leafOf(f.text) : null
}

/**
 * The KEY of a `contains` edge: `<file>::<owner>.<member>`.
 *
 * The file component is the file's own published name — the basename with its extension,
 * which is what the analyzer publishes as the file's `module` symbol and therefore what
 * its qualified names are built from. It is read the same way from both sides: here from
 * the path, there from `fileModuleNameFor`. A key built from the corpus-RELATIVE path
 * would match nothing, and 713 oracle edges against 759 analyzer edges reading as 0%
 * agreement is what that looks like.
 */
function fileModuleName(filePath: string): string {
  const slash = filePath.lastIndexOf("/")
  return slash >= 0 ? filePath.slice(slash + 1) : filePath
}

function edgeKey(file: string, owner: string, member: string): string {
  return `${fileModuleName(file)}::${owner}.${member}`
}

/** Oracle-only edges, split by WHY the analyzer does not publish them. Same reasoning as
 *  the analyzer-only split, in the other direction: an unexplained residue is a number
 *  nobody can act on, and the two causes here have opposite owners. */
const oracleOnlyByCause: Record<string, number> = {}
const oracleOnlyExamplesByCause: Record<string, string[]> = {}

/** Owners whose `contains` this oracle disputes on the GROUNDS rather than on a fact:
 *  `create_function` nodes carrying `RETURNS TABLE (…)`. Filled while deriving, then
 *  consulted while comparing, so the split cannot depend on the analyzer's output. */
const RETURNS_TABLE_OWNERS = new Set<string>()

/** Names the analyzer's `RESERVED_AS_COLUMN_NAME` guard declines: `like` and `inherit` as
 * unquoted column names, plus — measured, not assumed — names the grammar could not
 * represent as an identifier at all. */
const DECLINED_MEMBER_NAMES = new Set(["like", "inherit", "LIKE", "INHERIT"])

/** Owners that are COMPOSITE TYPES — `CREATE TYPE t AS (…)` / `AS STRUCT(…)` — whose
 *  attributes the analyzer records as `fields` on the type symbol rather than as symbols
 *  of their own. Recorded while deriving, before any analyzer output is read. */
const COMPOSITE_TYPE_OWNERS = new Set<string>()

/** The member name out of a `<file>::<owner>.<member>` key. Used by the split below,
 *  which has to reason about the relationship between the two halves. */
function memberOfQualified(key: string): string {
  const qualified = key.includes("::") ? key.slice(key.indexOf("::") + 2) : key
  return qualified.slice(qualified.lastIndexOf(".") + 1)
}

/** Analyzer-only edges, split by WHY the oracle missed them. The split matters: an edge
 *  the analyzer reads out of an ERROR node is a RECOVERY, and a recovery is the class
 *  where a fabricated edge would hide, so the residue is reported by cause rather than as
 *  one "unexplained" bucket. */
const analyzerOnlyByCause: Record<string, number> = {}
const analyzerOnlyDetail: { file: string; key: string; cause: string }[] = []
const analyzerOnlyExamplesByCause: Record<string, string[]> = {}

/** The body of an owner, as this oracle reads it. */
function bodyOf(node: any): any[] {
  return node.children.filter((c: any) => c.type === "column_definitions")
}

/**
 * The BYTE SPANS every ERROR node occupies, so a member can be tested by POSITION rather
 * than by name.
 *
 * The name-based test was tried first and it is wrong in a way worth recording: it read
 * `aoc2022_day17_rocks.bits` as clean and `aoc2022_day17_rocks.id` as a recovery, in the
 * same CREATE TABLE on the same line, because `id` also appears as an identifier somewhere
 * else inside the file's ERROR regions and `bits` happened not to. A classifier that
 * separates two halves of one declaration by coincidence is not a classifier — it is a
 * coin. A member's own line, tested against the damaged spans, is the structural fact.
 */
function damagedLineSpans(root: any): { from: number; to: number }[] {
  const spans: { from: number; to: number }[] = []
  const walk = (n: any): void => {
    if (n.type === "ERROR" || n.isError === true || n.isMissing === true) {
      spans.push({ from: n.startIndex ?? 0, to: n.endIndex ?? 0 })
    }
    for (let i = 0; i < n.childCount; i++) walk(n.child(i))
  }
  walk(root)
  return spans
}

// A `memberOffset(hits, member, owner)` helper stood here, documented as "the byte offset
// of a member's own `name` token, or null when it cannot be found". No `OracleHit` carries
// an `offset` (every `hits.push` in this file writes file/owner/member/memberKind/line), no
// caller was ever written for it, and its declared return said `number | null` while the
// value it produced for a FOUND hit was `undefined`. Deleted with the finding recorded: the
// offset the doc names is not collected anywhere in this oracle, so a future reader that
// wants it has to record it at the `hits.push` sites first.

/** Names that are grammar KEYWORDS rather than declarations. A `contains` member whose
 *  name is one of these was read from the wrong slot: the tree has a keyword there, not an
 *  identifier. Kept small and explicit rather than swept from the grammar's keyword
 *  vocabulary, because `key`, `name`, `range`, `type` and `value` are all legal unquoted
 *  identifiers in PostgreSQL and a broad guard would invent false positives — the same
 *  trade `RESERVED_AS_COLUMN_NAME` in the analyzer already makes. */
const GRAMMAR_KEYWORDS = new Set(["key", "unique", "primary", "foreign", "constraint", "check", "index"])

interface OracleHit {
  file: string
  owner: string
  member: string
  memberKind: string
  line: number
}

function deriveFromTree(root: any, file: string, hits: OracleHit[]): void {
  const walk = (node: any): void => {
    if (OWNER_NODES.has(node.type)) {
      const owner = ownerName(node)
      if (owner) {
        // Members are the body's DIRECT children. `column_definitions` is the body, so
        // the owner's own named children are one level too high — which is why the
        // first version of this oracle found 0 edges over 100 files and every one of
        // the analyzer's 759 was "analyzer-only".
        const bodies = node.children.filter((c: any) => c.type === "column_definitions")
        const scan = bodies.length ? bodies : [node]
        for (const body of scan) {
          const visit = (container: any): void => {
            for (let i = 0; i < container.namedChildCount; i++) {
              const child = container.namedChild(i)
              if (BODY_GROUP_NODES.has(child.type)) {
                visit(child)
                continue
              }
              if (!MEMBER_NODES.has(child.type)) continue
              const member = memberName(child)
              if (!member) continue
              hits.push({
                file,
                owner,
                member,
                memberKind: child.type,
                line: (child.startPosition?.row ?? 0) + 1,
              })
            }
          }
          visit(body)
        }
      }
    }
    // A column ADDED by `ALTER TABLE t ADD COLUMN c …` is contained by `t` exactly as a
    // column declared in the CREATE TABLE body is: it is a member of that table, and the
    // corpus's migration convention depends on it. Measured: 12 of the 19 edges the oracle
    // reported unexplained at the 1,962-file population were this shape —
    // proxicall/database/migrations/20260906030000_fms_refund_retry_consumer.sql adds
    // `attempt_count`, `next_attempt_at` and `requires_manual_review` by ALTER and then
    // indexes them. The oracle read only declaration bodies and so called a true fact
    // unexplained, which is the safe direction to be wrong in and still wrong.
    if (node.type === "alter_table") {
      const table = alterSubject(node)
      if (table) {
        const visit = (container: any): void => {
          for (let i = 0; i < container.namedChildCount; i++) {
            const child = container.namedChild(i)
            if (child.type === "add_constraint" || child.type === "add_column") {
              const added = (): void => {
                for (let j = 0; j < child.namedChildCount; j++) {
                  const c = child.namedChild(j)
                  if (c.type !== "column_definition") continue
                  const member = memberName(c)
                  if (!member) continue
                  hits.push({ file, owner: table, member, memberKind: "add_column", line: (c.startPosition?.row ?? 0) + 1 })
                }
              }
              added()
            }
            if (child.type !== "add_constraint" && child.type !== "add_column") visit(child)
          }
        }
        visit(node)
      }
    }

    // A CREATE INDEX is contained by the table it indexes. Not through OWNER_NODES,
    // because an index has no body — the grammar expresses the relation in its ON
    // clause, which is the structural fact the oracle reads.
    const subject = indexSubject(node)
    if (subject) {
      const own = indexOwnName(node)
      if (own) hits.push({ file, owner: subject, member: own, memberKind: "create_index", line: (node.startPosition?.row ?? 0) + 1 })
    }
    for (let i = 0; i < node.namedChildCount; i++) walk(node.namedChild(i))
  }
  walk(root)
}

// ------------------------------------------------------------------ population
const sampleArg = process.argv.indexOf("--sample")
const SAMPLE = sampleArg >= 0 ? Number(process.argv[sampleArg + 1]) : 400

const files: { abs: string; dir: string; rel: string }[] = []
for (const repo of readdirSync(CR).sort()) {
  if (files.length >= SAMPLE) break
  const dir = path.join(CR, repo)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch {
    continue
  }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z", "*.sql"], {
      encoding: "utf8",
      maxBuffer: 128 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .split("\0")
      .filter(Boolean)
  } catch {
    continue
  }
  for (const rel of tracked) {
    if (files.length >= SAMPLE) break
    const abs = path.join(dir, rel)
    try {
      if (statSync(abs).size > 512 * 1024) continue
    } catch {
      continue
    }
    files.push({ abs, dir, rel: `${repo}/${rel}` })
  }
}

console.log(`oracle: SQL_ORACLE_LABELS = ${JSON.stringify(SQL_ORACLE_LABELS)}`)
console.log(`population ${files.length} git-tracked .sql <=512KB, repos in name order`)

await Parser.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new Parser()
parser.setLanguage(await Language.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-sql.wasm"))))

let oracleEdges = 0
let analyzerEdges = 0
let agreed = 0
let oracleOnly = 0
let analyzerOnly = 0
const oracleOnlyEx: string[] = []
const analyzerOnlyEx: string[] = []
const oracleOnlyKind: Record<string, number> = {}

let next = 0
const CONC = 8
const worker = async () => {
  for (;;) {
    const i = next++
    if (i >= files.length) return
    const f = files[i]
    const text = readFileSync(f.abs, "utf8")
    const tree = parser.parse(text)
    if (!tree) continue
    const hits: OracleHit[] = []
    deriveFromTree(tree.rootNode, f.rel, hits)

    // Record the `RETURNS TABLE` and composite-type owners as they are derived, before
    // any analyzer output is read, so the split below cannot be a rationalisation of it.
    const noteReturnsTable = (n: any): void => {
      if (n.type === "create_type") {
        const owner = ownerName(n)
        // `CREATE TYPE t AS (…)` is a `column_definitions` child; DuckDB's
        // `CREATE TYPE t AS STRUCT(x REAL, …)` puts the word STRUCT in an ERROR node
        // first (the grammar has no `struct_specifier`), so the same
        // `column_definitions` follows it. Both carry the attributes.
        const hasAttrs = n.children.some((c: any) => c.type === "column_definitions")
        if (owner && hasAttrs) COMPOSITE_TYPE_OWNERS.add(owner)
      }
      if (n.type === "create_function") {
        const hasReturnsTable = n.children.some(
          (c: any, i: number) => c.type === "keyword_table" && n.fieldNameForChild?.(i) === null,
        )
        const hasBody = n.children.some((c: any) => c.type === "column_definitions")
        if (hasReturnsTable && hasBody) {
          const owner = ownerName(n)
          if (owner) RETURNS_TABLE_OWNERS.add(owner)
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) noteReturnsTable(n.namedChild(i))
    }
    noteReturnsTable(tree.rootNode)

    // The analyzer's own set for this file, on the same population and through the
    // production entry point.
    let analyzerKeys = new Set<string>()
    let lastSymbols: any[] = []
    try {
      const r: any = await parseFile(f.abs, f.dir)
      lastSymbols = r.symbols ?? []
      for (const e of r.relationships ?? []) {
        if (String(e.type).toLowerCase() !== "contains") continue
        analyzerEdges++
        // The analyzer's `contains` TARGET is already the qualified name
        // (`<file>::<owner>.<member>`) since pass 14, so it is used verbatim. Prefixing
        // it again with the file is what made every key read `X::Y.X::Y` and turned a
        // 100% agreement into 0%.
        analyzerKeys.add(String(e.target))
      }
    } catch {
      /* pool-worker returns a fallback; the oracle side is unaffected */
    }

    const oracleKeys = new Set<string>()
    for (const h of hits) {
      if (!h.member) continue
      oracleEdges++
      oracleKeys.add(edgeKey(f.abs, h.owner, h.member))
    }

    // The names the analyzer PUBLISHES in this file. A `contains` edge whose source is
    // not among them cannot be published at all, because containment names a member of a
    // DECLARED owner — and that is a real rule, not a gap: boundary splits one table's
    // creation across files (`internal/edition/testdata/three/1/01_add_table.up.sql` is
    // nothing but `alter table tree add column name text`), so a per-file analyzer
    // reading only this file has no `tree` to attach the column to.
    const publishedNames = new Set<string>()
    for (const sym of lastSymbols) publishedNames.add(String((sym as any).name))

    for (const k of oracleKeys) {
      if (analyzerKeys.has(k)) {
        agreed++
        continue
      }
      oracleOnly++
      const qualified = k.includes("::") ? k.slice(k.indexOf("::") + 2) : k
      const owner = qualified.slice(0, qualified.lastIndexOf("."))
      // `RETURNS TABLE (a int, b text)` is the third cause, and it is a DISAGREEMENT
      // between two readings rather than a defect in either. The oracle reads the
      // `column_definitions` a `create_function` carries and calls the columns members;
      // the analyzer reads them as the function's OUT PARAMETERS, which is what
      // PostgreSQL's `RETURNS TABLE` is — the same names appear in the symbol's
      // `parameters`, not as symbols. Both readings are of the same node, which is why
      // this is worth naming: an instrument that reported it as UNEXPLAINED would be
      // asking the analyzer to change a correct decision.
      const cause = RETURNS_TABLE_OWNERS.has(owner)
        ? "DISAGREEMENT: the owner is a `RETURNS TABLE (...)` function. The oracle calls those columns members; the analyzer calls them the function's OUT PARAMETERS, which is what `RETURNS TABLE` is in PostgreSQL. Same node, two readings, neither wrong."
        : memberOfQualified(k) === owner && publishedNames.has(owner)
          ? "DISAGREEMENT: the member name EQUALS its owner — a column named after its own table (`useragent.useragent`, `keyword.keyword`). The analyzer publishes the column as a symbol and the containment edge is keyed with memberKind, so the two agree on WHICH declaration; the oracle reads the edge as self-referential and declines it."
          : COMPOSITE_TYPE_OWNERS.has(owner)
            ? "DECISION, NOT A DEFECT: a COMPOSITE TYPE's attributes. `CREATE TYPE point AS STRUCT(x REAL, y REAL)` (DuckDB) and `CREATE TYPE address AS (line1 text, city text)` (PostgreSQL) — the analyzer records the attribute names as `fields` on the type symbol and publishes no per-attribute symbol, so there is no containment edge to emit. Publishing one is defensible and is NOT shipped; this lane records the choice rather than leaving it implicit."
            : DECLINED_MEMBER_NAMES.has(memberOfQualified(k))
              ? "DECLINED: the analyzer refused to publish this member. The name is a bare grammar keyword (`LIKE`) or a quoted name the grammar itself could not represent (`<script>alert(100);</script>` in phpmyadmin/tests/test_data/exploit_test.sql, `col  w  space` in postgrest's reserved-chars fixture). `RESERVED_AS_COLUMN_NAME` in the analyzer records the reasoning: a name-only test cannot separate `ALTER TABLE t ADD key my_type` (legal PostgreSQL) from a keyword read from the wrong slot, and one phantom is cheaper than a missing declaration. The oracle disagrees and is right to disagree — this is a DECISION with a price, not a silent omission."
              : publishedNames.has(owner)
                ? "UNEXPLAINED: the owner IS declared in this file, so the edge was available and was not emitted"
              : "the owner is not declared in this file — a per-file analyzer has nothing to attach the member to, and a migration that splits a table across files puts the ADD COLUMN in a different file from the CREATE TABLE"
      oracleOnlyByCause[cause] = (oracleOnlyByCause[cause] ?? 0) + 1
      const bucket = (oracleOnlyExamplesByCause[cause] ??= [])
      if (bucket.length < 6) bucket.push(`${k}  (${f.rel})`)
      if (oracleOnlyEx.length < 12) oracleOnlyEx.push(`${k}  (${f.rel})`)
    }
    // Where the grammar is damaged, by BYTE SPAN over the whole file. The whole file,
    // not owners' bodies: in duckdb/…/aoc2022/load/day17.sql the `CREATE MACRO … & …`
    // lambdas are unparseable, so the grammar puts the following
    // `CREATE TABLE aoc2022_day17_rocks (id INTEGER, bits INTEGER[])` INSIDE an ERROR node
    // and there is no `create_table` node to read an owner from at all. An owner-scoped
    // sweep cannot see those, and calling the analyzer's recovery "unexplained" is the
    // expensive direction: a recovery is exactly where a fabricated declaration hides.
    const damagedLines = new Set<number>()
    for (const sp of damagedLineSpans(tree.rootNode)) {
      // One row per line the span covers, resolved through the tree's own row index.
      const fromRow = tree.rootNode.descendantForIndex(sp.from)?.startPosition.row ?? 0
      const toRow = tree.rootNode.descendantForIndex(Math.max(sp.from, sp.to - 1))?.endPosition.row ?? fromRow
      for (let r = fromRow; r <= toRow && r - fromRow < 4000; r++) damagedLines.add(r + 1)
    }

    // The analyzer publishes a symbol per member, and a symbol carries its line. That line
    // is the member's OWN line, which is what the span test needs — an edge does not carry
    // one (`line` reads undefined on every edge parseFile returns), so the symbol list is
    // the only place the position exists.
    const memberLine = new Map<string, number>()
    for (const sym of lastSymbols) {
      const line = (sym as any).startLine ?? (sym as any).line
      if (typeof line === "number") memberLine.set(`${String((sym as any).name)}`, line)
    }

    for (const k of analyzerKeys) {
      if (oracleKeys.has(k)) continue
      analyzerOnly++
      // The member is the last dotted component of the qualified target.
      const qualified = k.includes("::") ? k.slice(k.indexOf("::") + 2) : k
      const member = qualified.slice(qualified.lastIndexOf(".") + 1)
      // GRAMMAR_KEYWORDS is the third cause and it is a real defect, not a recovery: a
      // member whose name IS a bare grammar keyword is a declaration the analyzer read
      // from the wrong slot. `ALTER TABLE log ADD KEY useragent_id (useragent_id)` parses
      // as a column named `KEY`, which this file's own comment at
      // real-sql-analyzer.ts:477 records and deliberately does not guard, because the
      // tree cannot distinguish it from the legal `ALTER TABLE t ADD key my_type`.
      const line = memberLine.get(member)
      const cause = GRAMMAR_KEYWORDS.has(member.toLowerCase())
        ? "FABRICATED: the member name is a bare grammar keyword, so the declaration was read from the wrong slot"
        : line != null && damagedLines.has(line)
          ? "recovered from an ERROR node — the grammar could not parse the construct, and the analyzer read the declaration out of the damage"
          : "NOT on a damaged line — UNEXPLAINED by this oracle"
      analyzerOnlyByCause[cause] = (analyzerOnlyByCause[cause] ?? 0) + 1
      const bucket = (analyzerOnlyExamplesByCause[cause] ??= [])
      if (bucket.length < 6) bucket.push(`${k}  (${f.rel})`)
      analyzerOnlyDetail.push({ file: f.rel, key: k, cause })
      if (analyzerOnlyEx.length < 12) analyzerOnlyEx.push(`${k}  [${cause.split(" ")[0]}]  (${f.rel})`)
    }
    tree.delete?.()
  }
}
await Promise.all(Array.from({ length: CONC }, worker))

console.log(`\ntype            oracle  analyzer  agreed  oracle-only  analyzer-only`)
console.log(`contains        ${String(oracleEdges).padStart(6)}  ${String(analyzerEdges).padStart(8)}  ${String(agreed).padStart(6)}  ${String(oracleOnly).padStart(11)}  ${String(analyzerOnly).padStart(13)}`)
console.log(`\nagreement ${agreed} of ${oracleEdges} oracle edges = ${oracleEdges ? ((agreed / oracleEdges) * 100).toFixed(2) : "n/a"}%`)
console.log(`oracle-only  ${oracleOnly}  (${oracleEdges ? ((oracleOnly / oracleEdges) * 100).toFixed(2) : "n/a"}% of the oracle)`)
console.log(`analyzer-only ${analyzerOnly} (${analyzerEdges ? ((analyzerOnly / analyzerEdges) * 100).toFixed(2) : "n/a"}% of the analyzer)`)
if (oracleOnlyEx.length) {
  console.log(`\noracle-only examples:`)
  for (const e of oracleOnlyEx) console.log(`  ${e}`)
}
if (process.argv.includes("--detail")) {
  const out = analyzerOnlyDetail.map((d) => `${d.cause.split(" ")[0]}\t${d.file}\t${d.key}`)
  console.log(`\n--detail rows (${out.length}):`)
  for (const line of out) console.log(line)
}
if (oracleOnlyEx.length) {
  console.log(`\noracle-only, BY CAUSE:`)
  for (const cause of Object.keys(oracleOnlyByCause).sort()) {
    console.log(`  ${String(oracleOnlyByCause[cause]).padStart(5)}  ${cause}`)
    for (const e of oracleOnlyExamplesByCause[cause] ?? []) console.log(`           ${e}`)
  }
}
if (analyzerOnlyEx.length) {
  console.log(`\nanalyzer-only, BY CAUSE:`)
  for (const cause of Object.keys(analyzerOnlyByCause).sort()) {
    console.log(`  ${String(analyzerOnlyByCause[cause]).padStart(5)}  ${cause}`)
    for (const e of analyzerOnlyExamplesByCause[cause] ?? []) console.log(`           ${e}`)
  }
}