/**
 * #612 follow-up: how many stored `contains` edges name a TARGET that is not
 * unique inside its own file? Those are the edges a name-only emission cannot
 * have meant, and the store has to guess which symbol was intended.
 *
 *   npx tsx script/m14/tmp/contains-ambiguity-612.ts <repo-dir-abs> [lang]
 */
import { createHash } from "crypto"
import * as path from "path"
import { createRequire } from "module"

const require = createRequire(import.meta.url)
const Database = require("better-sqlite3")

const repo = process.argv[2]
const lang = process.argv[3]
const sha = createHash("sha1").update(repo).digest("hex")
const db = new Database(path.join(process.env.HOME ?? "", ".bb", "projects", sha, "brain.db"), { readonly: true })

const langClause = lang ? "AND f.language = ?" : ""
const params = lang ? [lang] : []

const ambiguous = `
  SELECT COUNT(*) c FROM brain_relationship r
   JOIN brain_symbol s ON s.id = r.source_symbol_id
   JOIN brain_symbol t ON t.id = r.target_symbol_id
   JOIN brain_file f ON f.id = s.file_id
   WHERE r.relationship_type = 'contains' AND f.id = t.file_id
     ${langClause}
     AND (SELECT COUNT(*) FROM brain_symbol x WHERE x.file_id = f.id AND x.name = t.name) > 1`

const total = `
  SELECT COUNT(*) c FROM brain_relationship r
   JOIN brain_symbol s ON s.id = r.source_symbol_id
   JOIN brain_symbol t ON t.id = r.target_symbol_id
   JOIN brain_file f ON f.id = s.file_id
   WHERE r.relationship_type = 'contains' AND f.id = t.file_id ${langClause}`

// Also: the edge's source is name-only too, so an ambiguous SOURCE is the same
// defect on the other end.
const ambiguousSource = `
  SELECT COUNT(*) c FROM brain_relationship r
   JOIN brain_symbol s ON s.id = r.source_symbol_id
   JOIN brain_symbol t ON t.id = r.target_symbol_id
   JOIN brain_file f ON f.id = s.file_id
   WHERE r.relationship_type = 'contains' AND f.id = t.file_id
     ${langClause}
     AND (SELECT COUNT(*) FROM brain_symbol x WHERE x.file_id = f.id AND x.name = s.name) > 1`

const one = (sql: string) => (db.prepare(sql).get(...params) as any).c

const out: any = {
  repo: path.basename(repo),
  lang: lang ?? "(all)",
  containmentEdgesSameFile: one(total),
  targetNameNotUnique: one(ambiguous),
  sourceNameNotUnique: one(ambiguousSource),
}

out.topAmbiguousTargets = db
  .prepare(
    `SELECT t.name, t.symbol_type kind, COUNT(*) c
       FROM brain_relationship r
       JOIN brain_symbol s ON s.id = r.source_symbol_id
       JOIN brain_symbol t ON t.id = r.target_symbol_id
       JOIN brain_file f ON f.id = s.file_id
      WHERE r.relationship_type = 'contains' AND f.id = t.file_id
        ${langClause}
        AND (SELECT COUNT(*) FROM brain_symbol x WHERE x.file_id = f.id AND x.name = t.name) > 1
      GROUP BY 1,2 ORDER BY c DESC LIMIT 12`,
  )
  .all(...params)

console.log(JSON.stringify(out, null, 1))
