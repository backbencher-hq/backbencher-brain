/**
 * RE-DERIVATION of the fleet-wide index-resolution claim in commit `9472d1861`
 * ("research(toml): the eager-resolve defect is fleet-wide — 882 mis-bindings,
 * 32,359-edge fix, measured"), which added §"The resolver defect, measured
 * fleet-wide" to docs/analyzers/toml.md.
 *
 * That commit shipped NO instrument. This is the instrument. Every number it
 * asserts is recomputed here from a real brain.db, read-only, with the exact
 * definitions that reproduce the commit's population.
 *
 *   npx tsx validation/m14/fixtures/index/rederive-index-resolution-claim.mts
 *   npx tsx validation/m14/fixtures/index/rederive-index-resolution-claim.mts --db <path>
 *   npx tsx validation/m14/fixtures/index/rederive-index-resolution-claim.mts --census
 *
 * WHY THIS EXISTS. The claim's own population header — "this repository's own
 * live index (190,213 symbols, 496,886 relationships)" — is the M60 log line
 * from validation/m60/results/index-real-scoped.log (2026-10-09 11:16), a
 * DIFFERENT index generation (5,086 files, 3,177 MB, since reclaimed). The
 * 1,543 / 882 / 102,393 counts below reproduce EXACTLY, but only against the
 * workspace-local BB_DATA_DIR index at <repo>/.bb-data — whose real population
 * is 171,343 symbols / 180,552 relationships, not the quoted pair. Run with
 * --census to see every candidate index on the machine and which one the
 * numbers actually come from.
 *
 * READ-ONLY. Opens with better-sqlite3 `readonly: true`, sets `query_only`,
 * and writes nothing but TEMP tables. No index, symbol or relationship row is
 * modified. TEMP tables live in SQLite's temp store (MEMORY here), not in the
 * database file.
 */

import { createRequire } from "node:module"
import { existsSync, statSync, realpathSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { createHash } from "node:crypto"

const require = createRequire(import.meta.url)
const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, "..", "..", "..", "..")

const argv = process.argv.slice(2)
const argOf = (flag: string): string | undefined => {
  const i = argv.indexOf(flag)
  return i >= 0 ? argv[i + 1] : undefined
}
const CENSUS = argv.includes("--census")

/** src/util/project-id.ts: sha1(canonical path)[0..40]. */
function projectIdFor(p: string): string {
  let canonical = path.resolve(p)
  try { canonical = realpathSync.native(canonical) } catch {}
  return createHash("sha1").update(canonical).digest("hex").substring(0, 40)
}

const PROJECT_ID = projectIdFor(REPO)

interface Candidate { label: string; db: string; exists: boolean }

function candidates(): Candidate[] {
  const pid = PROJECT_ID
  const out: Candidate[] = []
  const dataDirs: Array<[string, string]> = []
  if (process.env.BB_DATA_DIR) dataDirs.push(["BB_DATA_DIR", path.resolve(process.env.BB_DATA_DIR)])
  dataDirs.push(["<repo>/.bb-data (what .vscode/mcp.json sets)", path.join(REPO, ".bb-data")])
  dataDirs.push(["<repo>/.bb-scope (M60 reclaim run)", path.join(REPO, ".bb-scope")])
  dataDirs.push(["~/.bb (bb default)", path.join(homedir(), ".bb")])
  for (const [label, dir] of dataDirs) {
    const db = path.join(dir, "projects", pid, "brain.db")
    out.push({ label, db, exists: existsSync(db) })
  }
  return out
}

type Row = Record<string, unknown>

function open(dbPath: string): any | null {
  try {
    const Database = require("better-sqlite3")
    const db = new Database(dbPath, { readonly: true, fileMustExist: true })
    db.pragma("query_only = 1")
    db.pragma("temp_store = MEMORY")
    return db
  } catch {
    return null
  }
}

const one = (db: any, sql: string, params: any[] = []): any => {
  const r = db.prepare(sql).get(...params) as Row | undefined
  return r ? Object.values(r)[0] : undefined
}
const all = (db: any, sql: string, params: any[] = []): Row[] => db.prepare(sql).all(...params) as Row[]

// ---------------------------------------------------------------- population

interface Measured {
  files: number
  symbols: number
  relationships: number
  boundEdges: number
  crossFileDotted: number
  exactNameIgnored: number
  exactNameIgnoredByLang: Row[]
  suffixOnlyIgnoredFirstDot: number
  suffixOnlyIgnoredSuffixOfQualified: number
  haveSameFileNameCandidate: number
  alreadyPointedThere: number
  wouldRepoint: number
  wouldRepointByLang: Row[]
  wouldRepointCrossLanguage: number
  wouldRepointXlangShapes: Row[]
}

function measure(db: any, pid: string): Measured {
  const files = one(db, "SELECT COUNT(*) FROM brain_file WHERE project_id = ?", [pid])
  const symbols = one(db, "SELECT COUNT(*) FROM brain_symbol WHERE project_id = ?", [pid])
  const relationships = one(db, "SELECT COUNT(*) FROM brain_relationship WHERE project_id = ?", [pid])

  // One row per (file, name): the store's own "a symbol of this name exists in
  // this file" relation, plus the deterministic pick a same-file-preference
  // change would take (MIN(id), the tie-break strategies 1/2/3 already use).
  db.exec(`CREATE TEMP TABLE loc AS
    SELECT file_id, name, MIN(id) AS min_id
    FROM brain_symbol WHERE project_id = '${pid}'
    GROUP BY file_id, name`)
  db.exec(`CREATE INDEX loc_idx ON loc(file_id, name)`)

  // Every edge with its source file, bound target file and languages.
  db.exec(`CREATE TEMP TABLE e AS
    SELECT r.id AS rid, r.target_external AS te, r.target_symbol_id AS tid,
           r.is_cross_language AS xl,
           ss.file_id AS sfile, sf.language AS slang,
           ts.file_id AS tfile, tf.language AS tlang, ts.name AS bname
    FROM brain_relationship r
    JOIN brain_symbol ss ON ss.id = r.source_symbol_id
    LEFT JOIN brain_symbol ts ON ts.id = r.target_symbol_id
    LEFT JOIN brain_file sf ON sf.id = ss.file_id
    LEFT JOIN brain_file tf ON tf.id = ts.file_id
    WHERE r.project_id = '${pid}'`)
  db.exec(`CREATE INDEX e_sfile ON e(sfile)`)
  db.exec(`CREATE INDEX e_tid ON e(tid)`)

  const boundEdges = one(db, "SELECT COUNT(*) FROM e WHERE tid IS NOT NULL")

  // ---- the 1,543: bound, cross-file, dotted target text.
  db.exec(`CREATE TEMP TABLE p2 AS SELECT * FROM e
    WHERE tid IS NOT NULL AND tfile <> sfile AND instr(te, '.') > 0`)

  const crossFileDotted = one(db, "SELECT COUNT(*) FROM p2")

  // ---- the 882: a symbol of the EXACT SAME NAME exists in the edge's OWN file.
  db.exec(`CREATE TEMP TABLE p2_exact AS
    SELECT p.* FROM p2 p JOIN loc l ON l.file_id = p.sfile AND l.name = p.te`)
  const exactNameIgnored = one(db, "SELECT COUNT(*) FROM p2_exact")
  const exactNameIgnoredByLang = all(db,
    `SELECT COALESCE(slang, '(none)') AS language, COUNT(*) AS n
     FROM p2_exact GROUP BY slang ORDER BY n DESC`)

  // ---- the suffix-only row. Two defensible readings, both reported.
  const suffixOnlyIgnoredFirstDot = one(db,
    `SELECT COUNT(*) FROM p2 p
     WHERE NOT EXISTS (SELECT 1 FROM loc l WHERE l.file_id = p.sfile AND l.name = p.te)
       AND EXISTS (SELECT 1 FROM loc l WHERE l.file_id = p.sfile
                   AND l.name = substr(p.te, instr(p.te, '.') + 1))`)
  // The suffix set _res_qsuffix builds: qualified_name with leading segments
  // stripped, i.e. "qualified_name ends with `.<target>`".
  const suffixOnlyIgnoredSuffixOfQualified = one(db,
    `SELECT COUNT(*) FROM p2 p
     WHERE NOT EXISTS (SELECT 1 FROM loc l WHERE l.file_id = p.sfile AND l.name = p.te)
       AND EXISTS (SELECT 1 FROM brain_symbol l
                   WHERE l.file_id = p.sfile AND l.qualified_name IS NOT NULL
                     AND (l.qualified_name = p.te
                          OR substr(l.qualified_name, -1 * (length(p.te) + 1)) = '.' || p.te))`)

  // ---- the same-file-preference blast radius, over ALL bound edges.
  db.exec(`CREATE TEMP TABLE pop AS
    SELECT e.*, l.min_id AS local_min
    FROM e JOIN loc l ON l.file_id = e.sfile AND l.name = e.te
    WHERE e.tid IS NOT NULL`)
  const haveSameFileNameCandidate = one(db, "SELECT COUNT(*) FROM pop")
  const alreadyPointedThere = one(db, "SELECT COUNT(*) FROM pop WHERE tid = local_min")
  const wouldRepoint = one(db, "SELECT COUNT(*) FROM pop WHERE tid <> local_min")
  db.exec(`CREATE TEMP TABLE wr AS SELECT * FROM pop WHERE tid <> local_min`)
  const wouldRepointByLang = all(db,
    `SELECT COALESCE(slang, '(none)') AS language, COUNT(*) AS n
     FROM wr GROUP BY slang ORDER BY n DESC LIMIT 10`)
  const wouldRepointCrossLanguage = one(db, "SELECT COUNT(*) FROM wr WHERE xl = 1")
  const wouldRepointXlangShapes = all(db,
    `SELECT COALESCE(slang,'?') || ' -> ' || COALESCE(tlang,'?') || ' -> ' || COALESCE(slang,'?') AS shape,
            COUNT(*) AS n
     FROM wr WHERE xl = 1 GROUP BY shape ORDER BY n DESC LIMIT 8`)

  return {
    files, symbols, relationships, boundEdges,
    crossFileDotted, exactNameIgnored, exactNameIgnoredByLang,
    suffixOnlyIgnoredFirstDot, suffixOnlyIgnoredSuffixOfQualified,
    haveSameFileNameCandidate, alreadyPointedThere, wouldRepoint,
    wouldRepointByLang, wouldRepointCrossLanguage, wouldRepointXlangShapes,
  }
}

// ------------------------------------------------------------------- verdict

const CLAIM = {
  population: { symbols: 190213, relationships: 496886, files: 5086 },
  crossFileDotted: 1543,
  exactNameIgnored: 882,
  exactNameIgnoredByLang: { json: 853, markdown: 18, elixir: 9, lua: 4, css: 4 },
  suffixOnlyIgnored: 36,
  haveSameFileNameCandidate: 102393,
  alreadyPointedThere: 70034,
  wouldRepoint: 32359,
  wouldRepointByLang: { json: 31785, typescript: 105, toml: 27, hcl: 19, tsx: 17, markdown: 17 },
  wouldRepointCrossLanguage: 56,
}

function verdict(label: string, measured: unknown, claimed: unknown): string {
  const ok = String(measured) === String(claimed)
  return `${ok ? "REPRODUCED    " : "NOT REPRODUCED"}  ${label}: measured ${measured}, commit says ${claimed}`
}

// ---------------------------------------------------------------------- main

const cands = candidates()
console.log(`repo          ${REPO}`)
console.log(`project id    ${PROJECT_ID}   (sha1(realpath)[0..40], src/util/project-id.ts)`)
console.log(`data dir      ${process.env.BB_DATA_DIR ? `BB_DATA_DIR=${process.env.BB_DATA_DIR}` : "unset (bb default = ~/.bb)"}`)
console.log("")
console.log("INDEX CANDIDATES for this project id")
for (const c of cands) {
  if (!c.exists) { console.log(`  MISSING   ${c.label}\n            ${c.db}`); continue }
  const st = statSync(c.db)
  const db = open(c.db)
  if (!db) {
    console.log(`  UNREADABLE ${c.label}  ${(st.size / 1e6).toFixed(1)} MB  mtime ${st.mtime.toISOString()}`)
    console.log(`            ${c.db}`)
    console.log(`            (another mount owns this file read-only; WAL creation gets EROFS.`)
    console.log(`             The sqlite3 CLI can still read it: sqlite3 "file:${c.db}?immutable=1")`)
    continue
  }
  const s = one(db, "SELECT COUNT(*) FROM brain_symbol WHERE project_id = ?", [PROJECT_ID])
  const r = one(db, "SELECT COUNT(*) FROM brain_relationship WHERE project_id = ?", [PROJECT_ID])
  const f = one(db, "SELECT COUNT(*) FROM brain_file WHERE project_id = ?", [PROJECT_ID])
  console.log(`  ok        ${c.label}`)
  console.log(`            ${c.db}`)
  console.log(`            ${(st.size / 1e6).toFixed(1)} MB  mtime ${st.mtime.toISOString()}  files ${f}  symbols ${s}  relationships ${r}`)
  db.close()
}
if (CENSUS) process.exit(0)

// Auto-select: the commit's own population (cross-file dotted bound edges =
// 1,543) decides which index the numbers came from; --db overrides.
const explicit = argOf("--db")
let chosen: { label: string; db: string } | null = null
if (explicit) {
  chosen = { label: "(--db)", db: path.resolve(explicit) }
} else {
  for (const c of cands) {
    if (!c.exists) continue
    const db = open(c.db)
    if (!db) continue
    const n = one(db, `SELECT COUNT(*) FROM brain_relationship r
      JOIN brain_symbol ss ON ss.id = r.source_symbol_id
      JOIN brain_symbol ts ON ts.id = r.target_symbol_id
      WHERE r.project_id = ? AND ts.file_id <> ss.file_id AND instr(r.target_external, '.') > 0`, [PROJECT_ID])
    db.close()
    if (n === CLAIM.crossFileDotted) { chosen = { label: c.label, db: c.db }; break }
  }
  if (!chosen) {
    const first = cands.find((c) => c.exists && open(c.db))
    if (first) chosen = { label: `${first.label} (fallback: no candidate matches the 1,543 population)`, db: first.db }
  }
}
if (!chosen) { console.error("no readable index for this project id — nothing to re-derive"); process.exit(2) }

const db = open(chosen.db)
if (!db) { console.error(`cannot open ${chosen.db} read-only`); process.exit(2) }

console.log("")
console.log(`MEASURED ON  ${chosen.label}`)
console.log(`             ${chosen.db}`)
const m = measure(db, PROJECT_ID)
console.log(`             files ${m.files}  symbols ${m.symbols}  relationships ${m.relationships}  bound edges ${m.boundEdges}`)

console.log("")
console.log("POPULATION HEADER THE COMMIT QUOTES")
console.log(verdict("symbols", m.symbols, CLAIM.population.symbols))
console.log(verdict("relationships", m.relationships, CLAIM.population.relationships))
console.log(verdict("files", m.files, CLAIM.population.files))

console.log("")
console.log("A. THE FABRICATION SIGNATURE")
console.log(verdict("cross-file dotted edges", m.crossFileDotted, CLAIM.crossFileDotted))
console.log(verdict("ignored an exact-name symbol in their OWN file", m.exactNameIgnored, CLAIM.exactNameIgnored))
console.log(`                         by language: ${m.exactNameIgnoredByLang.map((r) => `${r.language} ${r.n}`).join(", ")}`)
console.log(`                         commit says: ${Object.entries(CLAIM.exactNameIgnoredByLang).map(([k, v]) => `${k} ${v}`).join(", ")}`)
console.log(verdict("ignored a suffix-only local symbol (leaf after first dot)",
  m.suffixOnlyIgnoredFirstDot, CLAIM.suffixOnlyIgnored))
console.log(`                         (suffix-of-qualified_name reading gives ${m.suffixOnlyIgnoredSuffixOfQualified})`)

console.log("")
console.log("B. THE SAME-FILE-PREFERENCE BLAST RADIUS")
console.log(verdict("bound edges WITH a same-file exact-name candidate",
  m.haveSameFileNameCandidate, CLAIM.haveSameFileNameCandidate))
console.log(verdict("already pointed there (bound target IS the deterministic local pick)",
  m.alreadyPointedThere, CLAIM.alreadyPointedThere))
console.log(verdict("WOULD REPOINT", m.wouldRepoint, CLAIM.wouldRepoint))
console.log(`                         by language: ${m.wouldRepointByLang.map((r) => `${r.language} ${r.n}`).join(", ")}`)
console.log(`                         commit says: ${Object.entries(CLAIM.wouldRepointByLang).map(([k, v]) => `${k} ${v}`).join(", ")}`)
console.log(verdict("of those, cross-language", m.wouldRepointCrossLanguage, CLAIM.wouldRepointCrossLanguage))
console.log(`                         shapes: ${m.wouldRepointXlangShapes.map((r) => `${r.shape} ${r.n}`).join(", ")}`)

db.close()
