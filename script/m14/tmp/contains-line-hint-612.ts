/**
 * #612 follow-up / can the edge disambiguate itself?
 *
 * A cpp `contains` edge is emitted BY NAME on both ends, and takes the CHILD's
 * naming line as `line_number` (#921). For the 57% of nlohmann-json's same-file
 * containment edges whose target name is not unique in the file, the store picks
 * a candidate with no information about WHICH one was meant. This probe asks
 * whether the edge already carries the answer: among same-file symbols sharing
 * the target's name, does exactly one sit on the edge's `line_number`?
 *
 *   npx tsx script/m14/tmp/contains-line-hint-612.ts <repo-dir-abs> [lang]
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

// Every same-file containment edge, with the candidate set the store chooses from.
const rows = db
  .prepare(
    `SELECT f.id fid, f.language lang, t.name tname, t.line_start tline,
            r.line_number rline, s.name sname, s.line_start sline,
            (SELECT COUNT(*) FROM brain_symbol x WHERE x.file_id = f.id AND x.name = t.name) cands,
            (SELECT COUNT(*) FROM brain_symbol x WHERE x.file_id = f.id AND x.name = t.name AND x.line_start = r.line_number) atline,
            (SELECT COUNT(*) FROM brain_symbol x WHERE x.file_id = f.id AND x.name = t.name AND x.line_start <= r.line_number AND COALESCE(x.line_end, x.line_start) >= r.line_number) covering,
            (SELECT CAST(x.line_start AS TEXT) FROM brain_symbol x
              WHERE x.file_id = f.id AND x.name = t.name
              ORDER BY CAST(x.line_start AS TEXT) ASC LIMIT 1) oldPickLine,
            (SELECT CAST(t.line_start AS TEXT)) targetLineText
       FROM brain_relationship r
       JOIN brain_symbol s ON s.id = r.source_symbol_id
       JOIN brain_symbol t ON t.id = r.target_symbol_id
       JOIN brain_file f ON f.id = s.file_id
      WHERE r.relationship_type = 'contains' AND f.id = t.file_id
        ${lang ? "AND f.language = ?" : ""}`,
  )
  .all(...(lang ? [lang] : [])) as any[]

// Containment is an INTRA-file relation. An edge whose target resolved into a
// different file did not escape by accident: the resolution order let a
// definition elsewhere outrank a same-file candidate.
const escapeClause = lang ? "AND f.language = ?" : ""
const allContains = db
  .prepare(
    `SELECT r.id, s.file_id sfile, t.file_id tfile
       FROM brain_relationship r
       JOIN brain_symbol s ON s.id = r.source_symbol_id
       JOIN brain_symbol t ON t.id = r.target_symbol_id
       JOIN brain_file f ON f.id = s.file_id
      WHERE r.relationship_type = 'contains' ${escapeClause}`,
  )
  .all(...(lang ? [lang] : [])) as any[]

const tally = (pred: (r: any) => boolean) => rows.filter(pred).length
const amb = rows.filter((r) => r.cands > 1)

const out = {
  repo: path.basename(repo),
  lang: lang ?? "(all)",
  containsEdgesTotal: allContains.length,
  containsTargetInAnotherFile: allContains.filter((r) => r.sfile !== r.tfile).length,
  sameFileContainmentEdges: rows.length,
  ambiguousTargetName: amb.length,
  // The edge's own line IS the target's stored line
  edgeLineEqualsTargetLine: tally((r) => r.rline === r.tline),
  // ...among the ambiguous ones
  ambiguousAndEdgeLineEqualsTargetLine: amb.filter((r) => r.rline === r.tline).length,
  // The hint pins EXACTLY ONE candidate
  ambiguousHintPinsExactlyOne: amb.filter((r) => r.atline === 1).length,
  ambiguousHintPinsNone: amb.filter((r) => r.atline === 0).length,
  ambiguousHintPinsSeveral: amb.filter((r) => r.atline > 1).length,
  // A containment-span hint (candidate whose range covers the line) also possible
  ambiguousSpanPinsExactlyOne: amb.filter((r) => r.covering === 1).length,
  // The store's ACTUAL current choice: is the resolved target the one the hint names?
  ambiguousCurrentChoiceMatchesHint: amb.filter((r) => r.rline === r.tline).length,
  // The PRE-FIX (no rule) choice, computed from THIS db rather than re-indexed:
  // the old tiebreak was the symbol id compared as TEXT, and the id is
  // `${fileId}:${name}:${line}` — identical except for the line — so the old
  // pick is the candidate whose line is lexicographically smallest, and the old
  // rule was WRONG for every edge whose own line is not that one.
  ambiguousOldChoiceWouldBeWrong: amb.filter((r) => String(r.rline) !== r.oldPickLine).length,
}
console.log(JSON.stringify(out, null, 1))
