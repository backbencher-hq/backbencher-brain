/**
 * ZIG STORED-INCOMING — what the DATABASE actually attaches, per relationship type.
 *
 * ## Why this file exists
 *
 * `script/m14/incoming-check.ts` is a MODEL of resolution: it calls `parseFile`, builds
 * `name -> SymbolKind[]` in memory, and reports a target "ambiguous" when the string
 * names two or more kinds. The round brief treats its 19,962 ambiguous zig targets as
 * the population to attack, and its stated premise is that `src/lsp/impact.ts` "obtains
 * its reverse edges by SCANNING OUTGOING EDGES AND MATCHING TARGETS".
 *
 * Both halves of that are checkable, and at `HEAD` neither survives the check:
 *
 *   1. `src/lsp/impact.ts:530` reverse-walks on `r.target_symbol_id IN (...)` — the
 *      STORED id, not a string match against outgoing edges.
 *   2. `src/ast/parallel-indexer.ts:3499` resolves `contains` by the edge's OWN
 *      `line_number` inside its own file (`resolveContainsTargetStmt`, prepared at
 *      `:2353`), and every other type by `resolveTargetStmt` (`:2238`) — followed, once
 *      the symbol table is complete, by a set-based authoritative correction pass
 *      ranking candidates with `ROW_NUMBER() OVER (PARTITION BY t.rel_id ...)` at
 *      `:4128-4144` and applying it at `:4149`.
 *
 * So the number that decides whether the graph can walk TO a declaration is
 * `target_symbol_id IS NULL` in the stored row — and `incoming-check` cannot see that
 * column, because it never opens a database.
 *
 * This file opens the database `bb index` actually wrote and reports the stored
 * answer, then measures the two ways a stored attachment can still be wrong:
 *
 *   MISATTACHED   the row attached, but the attached symbol's `name` is not the edge's
 *                 `target_external` — the reverse walk will credit a declaration that
 *                 never mentioned the edge. This is the failure the brief is worried
 *                 about, and it is measurable rather than arguable.
 *   UNATTACHED    `target_symbol_id IS NULL` while `target_external` is a real string.
 *                 A bare name is split again, because "the analyzer never published
 *                 this name" and "the name is published and the store declined to bind"
 *                 are opposite findings with the same count:
 *                   NO-SYM   no `brain_symbol` in the whole project carries that name
 *                   HAS-SYM  one does, and this edge still did not bind to it
 *                 Subdivided into EXTERNAL (a package, path, builtin, `std.…` dotted
 *                 path — absent from the corpus BY NATURE) and ABSENT (a bare
 *                 identifier that no symbol in the window holds), because the two look
 *                 identical in a count and are opposite findings.
 *
 * ## The population is the store's, not this file's
 *
 * The project is indexed by `node bin/bb index <dir> --force` and this file reads the
 * resulting `brain.db`. It reports the file and row counts it found, so a number can
 * never be read over a population that was not there.
 *
 * ## THE STORE HAS TWO ROW ID FORMS, AND ONLY ONE OF THEM CARRIES A FILE
 *
 * `brain_relationship` has no `file_id`, and neither `source_symbol_id` nor
 * `target_symbol_id` can substitute for it: the file-scope rows publish `(global)` or
 * `(file)` as their source and never attach, so the symbol join cannot reach them. Both
 * id forms were read off stored rows:
 *
 *   PATH-SCOPED   <hash>:rel:<hash>:zls/src/diff.zig:edits:9:trace:calls:16
 *                 the origin FILE is in the id. calls, uses, contains, instantiates.
 *
 *   MARKER-SCOPED <hash>:rel:null:edits:exports:9
 *                 a literal `null` where the path would be, and NO path at all. exports,
 *                 imports, and the `@import`/`usingnamespace` references. No query can
 *                 attribute these rows to a language: the information is not in the
 *                 store, it is not merely unqueried.
 *
 * `--language` therefore scopes PATH-SCOPED rows only, and the marker rows get their own
 * column rather than being dropped or silently folded into a total. The file-scope types
 * are reported whole-project with that stated, because a zig-only `exports` number would
 * be a number over a population this file cannot name.
 *
 * ## Usage
 *
 *   npx tsx validation/m14/fixtures/zig/stored-incoming.ts --project <dir> [--language zig] [--json out.json]
 *
 * READ-ONLY. Opens the database readonly and writes nothing but `--json`.
 */
import * as os from "node:os"
import * as path from "node:path"
import Database from "better-sqlite3"

const argv = process.argv.slice(2)
const arg = (k: string, d = ""): string => {
  const hit = argv.find((a) => a === `--${k}` || a.startsWith(`--${k}=`))
  if (!hit) return d
  const eq = hit.indexOf("=")
  return eq === -1 ? (argv[argv.indexOf(hit) + 1] ?? d) : hit.slice(eq + 1)
}

const PROJECT = arg("project", "")
if (!PROJECT) {
  console.error("--project <dir> is required (the directory `bb index` was run on)")
  process.exit(2)
}

// `src/util/project-id.ts:18` — the single owner of project identity, sha1 of the
// realpath truncated to 40. Imported rather than restated: a second derivation of
// project identity is a second answer, and this file's whole point is to read the
// database the indexer actually wrote.
const { getProjectId } = await import("../../../../src/util/project-id")
const projectId = arg("project-id", "") || getProjectId(path.resolve(PROJECT))
const dbPath = path.join(os.homedir(), ".bb", "projects", projectId, "brain.db")
const db = new Database(dbPath, { readonly: true, fileMustExist: true })

// `extractLeaf`, verbatim from `src/ast/parallel-indexer.ts:3376` — the rule the
// indexer itself applies to a `target_external` before it looks a symbol up. Restating
// it is a second definition of "which symbol did this edge mean", and it is registered
// as a SQL FUNCTION so the misattachment column is computed by the same function rather
// than by a SQL string expression that would drift from it. It cannot be imported
// because it is a local closure inside `storeResults`; a change to the original
// invalidates this file's misattachment column and the header says so.
const leaf = (s: string | null): string => {
  const noLine = String(s ?? "").replace(/:\d+$/, "")
  const noArity = noLine.replace(/\/\d+$/, "")
  const lastColon = noArity.split(":").pop() ?? noArity
  return (lastColon.split(".").pop() ?? lastColon).trim()
}
db.function("bbLeaf", { deterministic: true }, leaf)

const TYPES = [
  "calls",
  "uses",
  "contains",
  "imports",
  "references",
  "exports",
  "extends",
  "implements",
  "overrides",
  "instantiates",
]

const files = db.prepare(`SELECT count(*) c FROM brain_file`).get() as any
const symbols = db.prepare(`SELECT count(*) c FROM brain_symbol`).get() as any
const rels = db.prepare(`SELECT count(*) c FROM brain_relationship`).get() as any

/**
 * `--language <ext>` -> `r.id LIKE '%.<ext>:%'`, a substring test on the row id's path
 * segment, anchored on the extension BOUNDARY (`.zig:`) rather than a prefix, because
 * the path is glued to the hash with a colon and is otherwise indistinguishable from
 * the id's own separators. Measured on a real id:
 *
 *   <hash>:rel:<hash>:ghostty/example/c-vt-build-info/build.zig:build:3:addArgs:calls:40
 *
 * It is a substring test, not a parse of the id, so a path or SYMBOL NAME that itself
 * contains `.zig:` would be admitted. That error is bounded below rather than argued
 * away: `scopeRowsNotLanguage` counts the in-scope rows whose attached source file is
 * NOT this language, which is the only way a false admission can show itself.
 */
// REVISION NOTE (2026-10-16, M65/D2). This predicate was `r.id LIKE '%:rel:null:%'`,
// the spelling a row with no source symbol used to carry — and the store no longer
// writes it: an unattributed row's identity now names the file that emitted it
// (`<hash>:rel:file:<path>:<target>:<type>:<line>`), because the old form had no file
// component and two files could therefore collide onto ONE id (measured: 69,177 rows on
// the repository's own index; the cpp/objective-c refresh-parity failures in
// script/m65/verify-refresh-resolution.ts were that collision, alternating between runs).
// The population this marker EXCLUDES is "rows with no attached source symbol", which the
// store states directly — so it is read from the column now, which is true of an index
// built before or after the change, rather than from an id spelling that only one of them
// has. Measured on the repository's own index: `source_symbol_id IS NULL` = 69,177 rows,
// exactly the count the `:rel:null:` test returned there.
const MARKER = "r.source_symbol_id IS NULL"
const LANG = arg("language", "").replace(/^\./, "")
// Marker rows are EXCLUDED from the language scope, and the exclusion is load-bearing:
// a marker's payload is the imported NAME, so `@import("offsets.zig")` stores
// `<hash>:rel:null:offsets.zig:references:5` — 1,574 rows in the 600-file project that
// pass the `.zig:` substring while naming no file at all. Leaving them in put 1,574
// unattributable rows inside a "zig-scoped" total; excluding them makes cross-check A
// below an EQUALITY with the symbol-join route instead of an inequality.
const SCOPE = LANG ? `(NOT ${MARKER} AND r.id LIKE '%.${LANG}:%')` : "1=1"

// Cross-check A: the symbol-join route. It can only ever be <= the id scope, because it
// drops every row whose source did not attach — for zig, most `references`/`exports`/
// `imports`, which are file-scope edges published against `(global)`.
const joinCount = LANG
  ? (db
      .prepare(
        `SELECT count(*) c FROM brain_relationship r
           JOIN brain_symbol s ON s.id = r.source_symbol_id
           JOIN brain_file f ON f.id = s.file_id
          WHERE f.language = ?`,
      )
      .get(LANG.toLowerCase()) as any).c
  : -1
const scopeRows = (db.prepare(`SELECT count(*) c FROM brain_relationship r WHERE ${SCOPE}`).get() as any).c
const markerRows = (db.prepare(`SELECT count(*) c FROM brain_relationship r WHERE ${MARKER}`).get() as any).c
// Cross-check B: in-scope rows whose attached source file is a DIFFERENT language.
const scopeOffLanguage = LANG
  ? (db
      .prepare(
        `SELECT count(*) c FROM brain_relationship r
           JOIN brain_symbol s ON s.id = r.source_symbol_id
           JOIN brain_file f ON f.id = s.file_id
          WHERE ${SCOPE} AND f.language <> ?`,
      )
      .get(LANG.toLowerCase()) as any).c
  : -1

/**
 * A target_external is EXTERNAL when it cannot be a Zig declaration name at all: it
 * carries a path separator, a `/`, or a dotted module path. Zig declaration names are
 * bare identifiers or dotted owner paths (`Elf64.Chdr`), so a leading dotted segment
 * (`std.mem.eql`) and anything containing `/` are absent from the corpus BY NATURE.
 * The test is on the string's SHAPE, which is a property of the edge, not a guess about
 * what the corpus happens to contain.
 */
const perType: any[] = db
  .prepare(
    `SELECT r.relationship_type AS t,
            count(*) AS rows,
            sum(CASE WHEN ${MARKER} THEN 1 ELSE 0 END) AS markerScoped,
            sum(CASE WHEN NOT ${MARKER} THEN 1 ELSE 0 END) AS pathScoped,
            sum(CASE WHEN r.target_symbol_id IS NOT NULL THEN 1 ELSE 0 END) AS attached,
            sum(CASE WHEN r.source_symbol_id IS NOT NULL THEN 1 ELSE 0 END) AS srcAttached,
            sum(CASE WHEN r.is_cross_file = 1 THEN 1 ELSE 0 END) AS crossFile,
            -- MISATTACHED: the store bound a symbol the edge did not name. The indexer
            -- resolves on the target's LEAF (extractLeaf, parallel-indexer.ts:3376),
            -- so a dotted target_external legitimately binds the symbol whose name is
            -- its last segment and whose qualified_name IS the string. Comparing name
            -- alone flags every qualified target as a misattachment — the first
            -- revision of this file read 51 contains misattachments that were 51
            -- correct bindings of "Type.Declaration" to qualified_name "Type.Declaration".
            sum(CASE WHEN r.target_symbol_id IS NOT NULL
                      AND t.name IS NOT bbLeaf(r.target_external)
                      AND t.qualified_name IS NOT r.target_external THEN 1 ELSE 0 END) AS misattached,
            sum(CASE WHEN r.target_symbol_id IS NOT NULL
                      AND t.name IS bbLeaf(r.target_external) THEN 1 ELSE 0 END) AS attachedSameName,
            sum(CASE WHEN r.target_symbol_id IS NULL AND (r.target_external IS NULL OR r.target_external = '') THEN 1 ELSE 0 END) AS noTargetString,
            sum(CASE WHEN r.target_symbol_id IS NULL AND r.target_external IS NOT NULL AND r.target_external <> ''
                      AND (instr(r.target_external, '/') > 0
                           OR substr(r.target_external, 1, 1) = '.'
                           OR instr(r.target_external, ':') > 0) THEN 1 ELSE 0 END) AS unattachedExternalShape,
            sum(CASE WHEN r.target_symbol_id IS NULL AND r.target_external IS NOT NULL AND r.target_external <> ''
                      AND instr(r.target_external, '/') = 0
                           AND substr(r.target_external, 1, 1) <> '.'
                           AND instr(r.target_external, ':') = 0 THEN 1 ELSE 0 END) AS unattachedBareName,
            -- NO-SYM vs HAS-SYM: the split that decides whether an unattached bare name
            -- is the analyzer's to fix or the store's. brain_symbol is the project's
            -- WHOLE published surface, so HAS-SYM means the declaration exists and the
            -- edge declined it.
            sum(CASE WHEN r.target_symbol_id IS NULL AND r.target_external IS NOT NULL AND r.target_external <> ''
                      AND instr(r.target_external, '/') = 0
                      AND substr(r.target_external, 1, 1) <> '.'
                      AND instr(r.target_external, ':') = 0
                      AND NOT EXISTS (SELECT 1 FROM brain_symbol s2 WHERE s2.name = r.target_external)
                      THEN 1 ELSE 0 END) AS unattBareNoSym,
            sum(CASE WHEN r.target_symbol_id IS NULL AND r.target_external IS NOT NULL AND r.target_external <> ''
                      AND instr(r.target_external, '/') = 0
                      AND substr(r.target_external, 1, 1) <> '.'
                      AND instr(r.target_external, ':') = 0
                      AND EXISTS (SELECT 1 FROM brain_symbol s3 WHERE s3.name = r.target_external)
                      THEN 1 ELSE 0 END) AS unattBareHasSym
       FROM brain_relationship r
       LEFT JOIN brain_symbol t ON t.id = r.target_symbol_id
      WHERE ${SCOPE}
      GROUP BY r.relationship_type
      ORDER BY rows DESC`,
  )
  .all() as any[]

// The unattached BARE names, ranked. A bare identifier no symbol in the window holds is
// the population that COULD be an analyzer miss; a dotted module path is not.
const topUnattached: any[] = db
  .prepare(
    `SELECT target_external AS name, count(*) c, count(DISTINCT relationship_type) types
       FROM brain_relationship
      WHERE target_symbol_id IS NULL AND target_external IS NOT NULL AND target_external <> ''
        AND instr(target_external, '/') = 0 AND substr(target_external, 1, 1) <> '.' AND instr(target_external, ':') = 0
        AND source_symbol_id IS NOT NULL
        ${LANG ? `AND id LIKE '%.${LANG}:%'` : ''}
      GROUP BY 1 ORDER BY c DESC LIMIT 25`,
  )
  .all() as any[]

// The misattached rows, ranked by target string. This is the shape the brief calls
// "a name collision resolved to the wrong declaration".
const topMisattached: any[] = db
  .prepare(
    `SELECT r.target_external AS named, bbLeaf(r.target_external) AS namedLeaf,
            t.name AS bound, t.qualified_name AS boundQ,
            sf.relative_path AS boundFile, count(*) c
       FROM brain_relationship r
       JOIN brain_symbol t ON t.id = r.target_symbol_id
       JOIN brain_file sf ON sf.id = t.file_id
      WHERE r.target_symbol_id IS NOT NULL
        AND t.name IS NOT bbLeaf(r.target_external)
        AND t.qualified_name IS NOT r.target_external
      GROUP BY 1,2,3,4,5 ORDER BY c DESC LIMIT 25`,
  )
  .all() as any[]

const report = {
  tool: "zig-stored-incoming",
  project: PROJECT,
  projectId,
  dbPath,
  languageScope: LANG || "(none)",
  files: files.c,
  symbols: symbols.c,
  relationshipsAll: rels.c,
  relationshipsInScope: scopeRows,
  relationshipsInScopeViaSymbolJoin: joinCount,
  relationshipsInScopeNotLanguage: scopeOffLanguage,
  markerScopedRows: markerRows,
  perType,
  topUnattachedBareNames: topUnattached,
  topMisattached: topMisattached,
}

const out = arg("json", "")
if (out) {
  const { writeFileSync } = await import("node:fs")
  writeFileSync(path.resolve(process.cwd(), out), JSON.stringify(report, null, 2))
}

const pad = (s: string | number, n: number) => (String(s) + " ".repeat(n)).slice(0, n)
console.log(`zig stored incoming — ${PROJECT} (project ${projectId.slice(0, 8)})`)
console.log(`db ${dbPath}`)
console.log(`brain_file ${files.c}  brain_symbol ${symbols.c}  brain_relationship ${rels.c}`)
console.log(
  `scope ${LANG ? "--language " + LANG : "(none — whole project)"}: ${scopeRows} of ${rels.c} rows` +
    (LANG
      ? `\n  cross-check A  symbol-join route sees ${joinCount}; the ${scopeRows - joinCount} it cannot see are rows whose source did not attach` +
        `\n  cross-check B  ${scopeOffLanguage} in-scope rows carry a source file of ANOTHER language (the substring scope's error)` 
      : ""),
)
console.log("")
console.log(
  pad("type", 13) +
    pad("rows", 8) +
    pad("path", 8) +
    pad("marker", 8) +
    pad("tgtAtt", 9) +
    pad("srcAtt", 8) +
    pad("MISATT", 8) +
    pad("noTgtStr", 9) +
    pad("unattExt", 9) +
    pad("unattBare", 10) +
    pad("noSym", 7) +
    pad("hasSym", 8) +
    "crossFile",
)
console.log("-".repeat(111))
let R = 0, A = 0, S = 0, M = 0, N = 0, E = 0, B = 0, X = 0, PS = 0, MK = 0, NS = 0, HS = 0
for (const t of TYPES) {
  const r = perType.find((x) => x.t === t) ?? {
    t,
    rows: 0,
    markerScoped: 0,
    pathScoped: 0,
    attached: 0,
    srcAttached: 0,
    crossFile: 0,
    misattached: 0,
    attachedSameName: 0,
    noTargetString: 0,
    unattachedExternalShape: 0,
    unattachedBareName: 0,
    unattBareNoSym: 0,
    unattBareHasSym: 0,
  }
  R += r.rows
  PS += r.pathScoped
  MK += r.markerScoped
  A += r.attached
  S += r.srcAttached
  M += r.misattached
  N += r.noTargetString
  E += r.unattachedExternalShape
  B += r.unattachedBareName
  NS += r.unattBareNoSym
  HS += r.unattBareHasSym
  X += r.crossFile
  console.log(
    pad(t, 13) +
      pad(r.rows, 8) +
      pad(r.pathScoped, 8) +
      pad(r.markerScoped, 8) +
      pad(r.attached, 9) +
      pad(r.srcAttached, 8) +
      pad(r.misattached, 8) +
      pad(r.noTargetString, 9) +
      pad(r.unattachedExternalShape, 9) +
      pad(r.unattachedBareName, 10) +
      pad(r.unattBareNoSym, 7) +
      pad(r.unattBareHasSym, 8) +
      r.crossFile,
  )
}
console.log("-".repeat(88))
console.log(
  pad("TOTAL", 13) + pad(R, 8) + pad(PS, 8) + pad(MK, 8) + pad(A, 9) + pad(S, 8) + pad(M, 8) + pad(N, 9) + pad(E, 9) + pad(B, 10) + pad(NS, 7) + pad(HS, 8) + X,
)
console.log("")
console.log(
  `MARKER-SCOPED rows carry no origin file: ${MK} of ${R} (${pct(MK, R)}). Their types ` +
    `(exports, imports, the @import references) cannot be attributed to a language by ANY query.`,
)
console.log("")
console.log(`target attached                       : ${A} of ${R} (${pct(A, R)})`)
console.log(`MISATTACHED (bound symbol's name <> target_external) : ${M} of ${R} (${pct(M, R)})`)
console.log(`unattached, target string is path/module-shaped     : ${E} (external by nature)`)
console.log(`unattached, target string is a BARE name            : ${B} (the only class that could be a miss)`)
console.log(`  of which NO published symbol carries that name     : ${NS}  (absent from this project by nature)`)
console.log(`  of which a published symbol DOES carry that name   : ${HS}  (the store declined a name that exists)`)
console.log(`unattached, no target string at all                 : ${N}`)
console.log("")
console.log("top unattached BARE names (the population that could be an analyzer miss):")
for (const r of topUnattached) console.log(`  ${pad(r.name, 34)} ${pad(r.c, 7)} types=${r.types}`)
console.log("")
console.log("top MISATTACHED (edge named one declaration, store bound another):")
for (const r of topMisattached)
  console.log(
    `  named=${pad(r.named, 30)} leaf=${pad(r.namedLeaf, 22)} bound=${pad(r.bound, 24)} q=${pad(r.boundQ, 34)} ${pad(r.boundFile, 46)} ${r.c}`,
  )

function pct(a: number, b: number): string {
  return b === 0 ? "n/a" : `${((a / b) * 100).toFixed(2)}%`
}