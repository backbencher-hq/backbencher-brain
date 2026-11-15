/**
 * #612 follow-up — the counterfactual the containment target rule is defended
 * with: what the statement it replaces would have done with the SAME edges.
 *
 * The old statement is `resolveTargetStmt`:
 *   ORDER BY COALESCE(is_declaration,0) ASC, (file_id = ?) DESC, (language = ?) DESC, id
 * The id is `${projectId}:${path}:${name}:${line}` compared as TEXT, so among
 * candidates that tie on the tiers above it the lexicographically smallest LINE
 * wins — `constructor:227` beats `constructor:25`.
 *
 * This probe replays that ORDER BY against the symbols the DB already holds, so
 * the comparison does NOT depend on re-indexing a pre-#612 build: the candidate
 * set, the edge's own child line and the edge's file are the same whichever rule
 * resolved the edge. Candidates are fetched once per target NAME and the pick is
 * memoized per (file, language), because a name like `constructor` has thousands
 * of candidates and the corpus holds 127k containment edges. Gauges, per repo and
 * language:
 *
 *   oldPickWouldDiffer          the old statement resolves to a different symbol
 *   oldPickOffLine              ... whose line_start is not the child line the edge carries
 *   oldPickInAnotherFile        ... in a different file (containment is intra-file)
 *   linePinsOneAndOldPickMisses the edge's line names exactly one candidate and the
 *                               old statement is not it — each of these is a case
 *                               the rule fixes, and a case where the edge and the
 *                               symbol it points at cannot both be right
 *   linePinsOneAndOldPickEscapes ... of those, the old pick is in ANOTHER file, so
 *                               the stored graph would assert an intra-file relation
 *                               that leaves the file
 *   idTierOffLine               the same idea restricted to the id tier alone (the
 *                               gauge contains-line-hint-612 quotes), kept for
 *                               comparability
 *
 *   npx tsx script/m14/tmp/contains-old-rule-612.ts <repo-dir-abs> [lang]
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

const edges = db
  .prepare(
    `SELECT r.id rid, f.id fid, f.project_id pid, f.language lang, r.line_number rline,
            t.id tid, t.name tname, t.line_start tline,
            (SELECT COUNT(*) FROM brain_symbol x WHERE x.file_id = f.id AND x.name = t.name AND x.line_start = r.line_number) atLine
       FROM brain_relationship r
       JOIN brain_symbol s ON s.id = r.source_symbol_id
       JOIN brain_symbol t ON t.id = r.target_symbol_id
       JOIN brain_file f ON f.id = s.file_id
      WHERE r.relationship_type = 'contains' AND r.line_number IS NOT NULL
        ${lang ? "AND f.language = ?" : ""}`,
  )
  .all(...(lang ? [lang] : [])) as any[]

const candidates = db.prepare(
  `SELECT x.id xid, x.file_id xfile, x.line_start xline, COALESCE(x.is_declaration, 0) decl, fx.language xlang
     FROM brain_symbol x JOIN brain_file fx ON fx.id = x.file_id
    WHERE x.project_id = ? AND x.name = ?`,
)
const idTier = db.prepare(
  `SELECT x.line_start xline FROM brain_symbol x
    WHERE x.file_id = ? AND x.name = ?
    ORDER BY CAST(x.line_start AS TEXT) ASC LIMIT 1`,
)

// SQLite compares TEXT as UTF-8 bytes; compare the same way rather than with
// UTF-16 code units, so the replay is exact for any path in the corpus.
const cmp = (a: string, b: string) => Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"))

let differ = 0
let offLine = 0
let anotherFile = 0
let pinsOneAndMiss = 0
let pinsOneAndEscape = 0
let idTierOff = 0
const misses: any[] = []

for (const [key, group] of groupBy(edges, (e: any) => `${e.pid}\u0000${e.tname}`)) {
  const [pid, name] = key.split("\u0000")
  const rows = candidates.all(pid, name) as any[]
  const pickCache = new Map<string, any>()
  for (const e of group as any[]) {
    const ck = `${e.fid}\u0000${e.lang}`
    let pick = pickCache.get(ck)
    if (!pick) {
      pick = [...rows].sort(
        (x, y) =>
          x.decl - y.decl ||
          Number(y.xfile === e.fid) - Number(x.xfile === e.fid) ||
          Number(y.xlang === e.lang) - Number(x.xlang === e.lang) ||
          cmp(x.xid, y.xid),
      )[0]
      pickCache.set(ck, pick)
    }
    if (!pick) continue
    const differs = pick.xid !== e.tid
    if (differs) differ++
    if (pick.xline !== e.rline) offLine++
    if (pick.xfile !== e.fid) anotherFile++
    if (differs && e.atLine === 1) {
      pinsOneAndMiss++
      if (pick.xfile !== e.fid) pinsOneAndEscape++
      if (misses.length < 10) {
        misses.push({
          edge: e.rid,
          childLine: e.rline,
          edgeTarget: `${e.tname}@${e.tline}`,
          oldPick: `${e.tname}@${pick.xline}`,
          oldPickInEdgeFile: pick.xfile === e.fid,
        })
      }
    }
    const t = idTier.get(e.fid, e.tname) as any
    if (!t || t.xline !== e.rline) idTierOff++
  }
}

function groupBy<T>(xs: T[], key: (x: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>()
  for (const x of xs) {
    const k = key(x)
    const a = m.get(k)
    if (a) a.push(x)
    else m.set(k, [x])
  }
  return m
}

console.log(
  JSON.stringify(
    {
      repo: path.basename(repo),
      lang: lang ?? "(all)",
      containsEdgesWithLine: edges.length,
      oldPickWouldDiffer: differ,
      oldPickOffLine: offLine,
      oldPickInAnotherFile: anotherFile,
      linePinsOneAndOldPickMissesIt: pinsOneAndMiss,
      linePinsOneAndOldPickEscapesTheFile: pinsOneAndEscape,
      idTierOffLine: idTierOff,
      samples: misses,
    },
    null,
    1,
  ),
)
