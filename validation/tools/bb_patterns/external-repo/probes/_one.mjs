// bb_tests/bb_patterns/probes/_one.mjs
// Runs ONE god-class query in its own process so a runaway statement can be
// killed by a wall-clock timeout. better-sqlite3 executes SQLite on the calling
// thread, so an in-process timer can never interrupt a runaway query — this
// file exists so the sweep in probe-p7 can bound the shipped form instead of
// hanging on it.
//
// argv: <projectId> shipped|B|C|D|E

import path from "node:path"
import { createRequire } from "node:module"

const REPO = process.env.BB_REPO
const repoRequire = createRequire(path.join(REPO, "package.json"))
const Database = repoRequire("better-sqlite3")
const TYPES = "'class','interface','struct','trait','enum'"
const [pid, which] = process.argv.slice(2)

const SQL = {
  shipped: `SELECT s.id, s.name, f.relative_path AS file, COALESCE(s.line_start,0) AS line, COUNT(m.id) AS members
    FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id
    LEFT JOIN brain_symbol m ON m.owner_symbol_id = s.id AND m.project_id = s.project_id
    WHERE s.project_id = ? AND s.symbol_type IN (${TYPES})
    GROUP BY s.id HAVING COUNT(m.id) > 10 ORDER BY members DESC`,
  B: `SELECT s.id, s.name, f.relative_path AS file, COALESCE(s.line_start,0) AS line, COUNT(m.id) AS members
    FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id
    LEFT JOIN brain_symbol m ON m.owner_symbol_id = s.id
    WHERE s.project_id = ? AND s.symbol_type IN (${TYPES})
    GROUP BY s.id HAVING COUNT(m.id) > 10 ORDER BY members DESC`,
  C: `SELECT s.id, s.name, f.relative_path AS file, COALESCE(s.line_start,0) AS line,
      (SELECT COUNT(*) FROM brain_symbol m WHERE m.owner_symbol_id = s.id) AS members
    FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id
    WHERE s.project_id = ? AND s.symbol_type IN (${TYPES})
      AND (SELECT COUNT(*) FROM brain_symbol m WHERE m.owner_symbol_id = s.id) > 10
    ORDER BY members DESC`,
  D: `SELECT s.id, s.name, f.relative_path AS file, COALESCE(s.line_start,0) AS line, agg.members
    FROM (SELECT owner_symbol_id AS oid, COUNT(*) AS members FROM brain_symbol
           WHERE owner_symbol_id IS NOT NULL GROUP BY owner_symbol_id HAVING COUNT(*) > 10) agg
    JOIN brain_symbol s ON s.id = agg.oid
    JOIN brain_file f ON f.id = s.file_id
    WHERE s.project_id = ? AND s.symbol_type IN (${TYPES})
    ORDER BY agg.members DESC`,
  E: `SELECT s.id, s.name, f.relative_path AS file, COALESCE(s.line_start,0) AS line, agg.members
    FROM (SELECT owner_symbol_id AS oid, COUNT(*) AS members FROM brain_symbol
           WHERE project_id = ? AND owner_symbol_id IS NOT NULL GROUP BY owner_symbol_id HAVING COUNT(*) > 10) agg
    JOIN brain_symbol s ON s.id = agg.oid
    JOIN brain_file f ON f.id = s.file_id
    WHERE s.project_id = ? AND s.symbol_type IN (${TYPES})
    ORDER BY agg.members DESC`,
}

const db = new Database(path.join(process.env.BB_DATA_DIR, "projects", pid, "brain.db"), { readonly: true, fileMustExist: true })
const params = which === "E" ? [pid, pid] : [pid]
const t0 = process.hrtime.bigint()
const rows = db.prepare(SQL[which]).all(...params)
const ms = Number(process.hrtime.bigint() - t0) / 1e6
process.stdout.write(JSON.stringify({ ms: Math.round(ms), n: rows.length, key: rows.map((r) => `${r.name}@${r.members}`).sort().join("|") }))
db.close()
