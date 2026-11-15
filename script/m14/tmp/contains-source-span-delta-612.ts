/**
 * #612 follow-up, the SOURCE half, decided by DELTA rather than by rhetoric.
 *
 * `edgeDisagreesWithStructuralOwner` turned out to be a weak gauge: on ripgrep
 * 2,890 of 3,776 contains edges have a source name that is not unique in the
 * file, yet ZERO of them disagree with the target's `owner_symbol_id` — because
 * BOTH are the same `nameToSymbol.get(name)` lookup, so they are one opinion,
 * not two. The independent opinion is the edge's own `line_number` (the child's
 * naming line, #921): the intended source is the container whose span COVERS
 * that line. This probe asks whether that candidate is the one the store
 * actually wrote, and reports the size of the change a span rule would make.
 *
 *   npx tsx script/m14/tmp/contains-source-span-delta-612.ts <repo-dir-abs> [lang]
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
    `SELECT f.id fid, s.id sid, s.name sname, s.line_start sline, s.symbol_type skind,
            r.line_number rline, t.name tname, t.id tid, s.line_end send,
            (SELECT COUNT(*) FROM brain_symbol x WHERE x.file_id = f.id AND x.name = s.name) cands,
            (SELECT x.id FROM brain_symbol x
              WHERE x.file_id = f.id AND x.name = s.name
                AND x.line_start <= r.line_number
                AND COALESCE(x.line_end, x.line_start) >= r.line_number
              ORDER BY x.line_start DESC LIMIT 1) spanPick,
            (SELECT x.symbol_type FROM brain_symbol x
              WHERE x.file_id = f.id AND x.name = s.name
                AND x.line_start <= r.line_number
                AND COALESCE(x.line_end, x.line_start) >= r.line_number
              ORDER BY x.line_start DESC LIMIT 1) spanPickKind,
            (SELECT x.line_start FROM brain_symbol x
              WHERE x.file_id = f.id AND x.name = s.name
                AND x.line_start <= r.line_number
                AND COALESCE(x.line_end, x.line_start) >= r.line_number
              ORDER BY x.line_start DESC LIMIT 1) spanPickLine
       FROM brain_relationship r
       JOIN brain_symbol s ON s.id = r.source_symbol_id
       JOIN brain_symbol t ON t.id = r.target_symbol_id
       JOIN brain_file f ON f.id = s.file_id
      WHERE r.relationship_type = 'contains' AND f.id = t.file_id AND r.line_number IS NOT NULL
        ${lang ? "AND f.language = ?" : ""}`,
  )
  .all(...(lang ? [lang] : [])) as any[]

const amb = rows.filter((r) => r.cands > 1)
const withSpan = amb.filter((r) => r.spanPick)
const differ = withSpan.filter((r) => r.spanPick !== r.sid)

// The judgment-free gauge: a `contains` edge asserts ENCLOSURE, so a stored
// source whose span does not cover the child's line is a contradicted fact —
// exactly the reasoning that removed the degenerate-container owner clause.
const encloses = (r: any) => r.sline <= r.rline && (r.send ?? r.sline) >= r.rline
const sourceDoesNotEnclose = rows.filter((r) => r.sline > 0 && !encloses(r))
const ambiguousSourceDoesNotEnclose = amb.filter((r) => r.sline > 0 && !encloses(r))

// Where the two disagree, is the span pick a CONTAINER kind and the current one
// not? That is the shape where the disagreement is an obvious defect rather than
// a defensible difference of opinion about nested scopes.
const CONTAINER_KINDS = new Set(["class", "struct", "interface", "trait", "enum", "union", "namespace", "module", "impl", "object", "actor", "type", "function", "method", "constructor"])
const containerLike = differ.filter((r) => CONTAINER_KINDS.has(String(r.spanPickKind)))
const currentNotContainerLike = containerLike.filter((r) => !CONTAINER_KINDS.has(String(r.skind)))

const samples = differ.slice(0, 8).map((r) => ({
  at: `L${r.rline}`,
  sourceName: r.sname,
  current: `${r.skind}@${r.sline}`,
  spanPick: `${r.spanPickKind}@${r.spanPickLine}`,
  target: r.tname,
}))

console.log(
  JSON.stringify(
    {
      repo: path.basename(repo),
      lang: lang ?? "(all)",
      containsEdges: rows.length,
      storedSourceDoesNotEncloseChildLine: sourceDoesNotEnclose.length,
      ambiguousSourceName: amb.length,
      ambiguousSourceDoesNotEncloseChildLine: ambiguousSourceDoesNotEnclose.length,
      ambiguousWithSpanCandidate: withSpan.length,
      spanCandidateDiffersFromStoredSource: differ.length,
      spanCandidateDiffersAndIsContainerLike: containerLike.length,
      spanCandidateDiffersAndCurrentIsNotContainerLike: currentNotContainerLike.length,
      samples,
    },
    null,
    1,
  ),
)
