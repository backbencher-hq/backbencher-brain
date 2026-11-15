/**
 * #612 follow-up, the SOURCE half, decided by coherence rather than by a new rule.
 *
 * The store derives every symbol's owner structurally (`owner_symbol_id`) and
 * emits its OWN contains edge from it. So for a `contains` edge whose source was
 * resolved by NAME, there is already a second, structural answer in the same row
 * set. This probe asks how often the two disagree — i.e. how often the graph
 * holds an analyzer edge saying "A contains B" next to a structural owner saying
 * "C contains B", with A chosen only because A's name matched first.
 *
 *   npx tsx script/m14/tmp/contains-source-owner-agreement-612.ts <repo> [lang]
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

const q = (sql: string) => (db.prepare(sql).get(...(lang ? [lang] : [])) as any).c

const base = `
  FROM brain_relationship r
  JOIN brain_symbol s ON s.id = r.source_symbol_id
  JOIN brain_symbol t ON t.id = r.target_symbol_id
  JOIN brain_file f ON f.id = s.file_id
 WHERE r.relationship_type = 'contains' AND f.id = t.file_id ${lang ? "AND f.language = ?" : ""}`

const out = {
  repo: path.basename(repo),
  lang: lang ?? "(all)",
  sameFileContainsEdges: q(`SELECT COUNT(*) c ${base}`),
  // the target has a structural owner at all
  targetHasStructuralOwner: q(`SELECT COUNT(*) c ${base} AND t.owner_symbol_id IS NOT NULL`),
  // ...and the analyzer's edge names a DIFFERENT source than that owner
  edgeDisagreesWithStructuralOwner: q(
    `SELECT COUNT(*) c ${base} AND t.owner_symbol_id IS NOT NULL AND s.id != t.owner_symbol_id`,
  ),
  // ...and the structural owner is itself name-ambiguous in the file
  structuralOwnerNameNotUnique: q(
    `SELECT COUNT(*) c ${base} AND t.owner_symbol_id IS NOT NULL AND s.id != t.owner_symbol_id
       AND (SELECT COUNT(*) FROM brain_symbol x WHERE x.file_id = f.id AND x.name = s.name) > 1`,
  ),
}
console.log(JSON.stringify(out, null, 1))
