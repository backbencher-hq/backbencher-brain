/**
 * The residual of the #612 containment target rule: same-file containment edges
 * whose target name is not unique, where exactly ONE candidate sits on the edge's
 * own line — and yet the stored target is not it. Each sample row is a case the
 * rule should have placed; the count is the gauge the rule is judged by, and it
 * is the FIRST line of JSON so the corpus driver records it as a number (the
 * sweep's before arm predates this and kept the line as text).
 *   npx tsx script/m14/tmp/contains-residual-612.ts <repo> [lang]
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

const rows = db
  .prepare(
    `SELECT f.relative_path path, f.language lang, r.line_number rline,
            s.name sname, s.line_start sline,
            t.name tname, t.symbol_type tkind, t.line_start tline,
            (SELECT COUNT(*) FROM brain_symbol x WHERE x.file_id = f.id AND x.name = t.name) cands,
            (SELECT COUNT(*) FROM brain_symbol x WHERE x.file_id = f.id AND x.name = t.name AND x.line_start = r.line_number) atLine,
            (SELECT GROUP_CONCAT(x.line_start) FROM brain_symbol x WHERE x.file_id = f.id AND x.name = t.name) candidateLines,
            (SELECT COUNT(*) FROM brain_symbol y WHERE y.id = t.id AND y.line_start = r.line_number) isOnLine
       FROM brain_relationship r
       JOIN brain_symbol s ON s.id = r.source_symbol_id
       JOIN brain_symbol t ON t.id = r.target_symbol_id
       JOIN brain_file f ON f.id = s.file_id
      WHERE r.relationship_type = 'contains' AND f.id = t.file_id AND r.line_number IS NOT NULL
        ${lang ? "AND f.language = ?" : ""}
        AND (SELECT COUNT(*) FROM brain_symbol x WHERE x.file_id = f.id AND x.name = t.name) > 1
        AND (SELECT COUNT(*) FROM brain_symbol x WHERE x.file_id = f.id AND x.name = t.name AND x.line_start = r.line_number) = 1
        AND t.line_start != r.line_number
      LIMIT 15`,
  )
  .all(...(lang ? [lang] : []))

const total = db
  .prepare(
    `SELECT COUNT(*) c FROM brain_relationship r
       JOIN brain_symbol s ON s.id = r.source_symbol_id
       JOIN brain_symbol t ON t.id = r.target_symbol_id
       JOIN brain_file f ON f.id = s.file_id
      WHERE r.relationship_type = 'contains' AND f.id = t.file_id AND r.line_number IS NOT NULL
        ${lang ? "AND f.language = ?" : ""}
        AND (SELECT COUNT(*) FROM brain_symbol x WHERE x.file_id = f.id AND x.name = t.name) > 1
        AND (SELECT COUNT(*) FROM brain_symbol x WHERE x.file_id = f.id AND x.name = t.name AND x.line_start = r.line_number) = 1
        AND t.line_start != r.line_number`,
  )
  .get(...(lang ? [lang] : [])) as any

console.log(
  JSON.stringify(
    {
      repo: path.basename(repo),
      lang: lang ?? "(all)",
      residual: total.c,
      samples: rows,
    },
    null,
    1,
  ),
)
console.log(`residual (rule should have placed it): ${total.c}`)
console.log(JSON.stringify(rows, null, 1))
