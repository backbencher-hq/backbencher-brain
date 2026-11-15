/**
 * #612 follow-up, the SOURCE half of the same question.
 *
 * A cpp/c/zig `contains` edge names its source (the owner) by NAME only, and the
 * store picks the first same-file match. On the zig tree the ambiguous-source set
 * is large and real (`anonymous` 8,217 edges over 5 candidates, `Vector` 328 over
 * 71, zig `Group` 729 over 85). The edge carries the CHILD's line, which is a
 * point INSIDE the intended container — so the question is whether that line pins
 * one candidate:
 *   - SPAN: exactly one candidate whose [line_start, line_end] covers the line
 *   - INNERMOST SPAN: of those, exactly one is not contained by another candidate
 *   - LINE_SELF: exactly one candidate starts on that line (the target-side rule)
 *
 *   npx tsx script/m14/tmp/contains-source-hint-612.ts <repo-dir-abs> [lang]
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
    `SELECT r.line_number rline, f.id fid, s.name sname, s.line_start sline,
            (SELECT COUNT(*) FROM brain_symbol x WHERE x.file_id = f.id AND x.name = s.name) cands,
            (SELECT COUNT(*) FROM brain_symbol x
              WHERE x.file_id = f.id AND x.name = s.name
                AND COALESCE(x.line_end, x.line_start) >= r.line_number
                AND x.line_start <= r.line_number) spanPins,
            (SELECT COUNT(*) FROM brain_symbol x
              WHERE x.file_id = f.id AND x.name = s.name
                AND COALESCE(x.line_end, x.line_start) >= r.line_number
                AND x.line_start <= r.line_number
                AND NOT EXISTS (SELECT 1 FROM brain_symbol y
                                 WHERE y.file_id = f.id AND y.name = s.name
                                   AND y.line_start <= x.line_start
                                   AND COALESCE(y.line_end, y.line_start) >= COALESCE(x.line_end, x.line_start)
                                   AND y.line_start != x.line_start)) innermost,
            (SELECT COUNT(*) FROM brain_symbol x WHERE x.file_id = f.id AND x.name = s.name AND x.line_start = r.line_number) lineSelf
       FROM brain_relationship r
       JOIN brain_symbol s ON s.id = r.source_symbol_id
       JOIN brain_symbol t ON t.id = r.target_symbol_id
       JOIN brain_file f ON f.id = s.file_id
      WHERE r.relationship_type = 'contains' AND f.id = t.file_id AND r.line_number IS NOT NULL
        ${lang ? "AND f.language = ?" : ""}`,
  )
  .all(...(lang ? [lang] : [])) as any[]

const amb = edges.filter((e) => e.cands > 1)
const n = (p: (e: any) => boolean) => amb.filter(p).length
console.log(
  JSON.stringify(
    {
      repo: path.basename(repo),
      lang: lang ?? "(all)",
      edgesWithLine: edges.length,
      ambiguousSource: amb.length,
      spanPinsExactlyOne: n((e) => e.spanPins === 1),
      spanPinsNone: n((e) => e.spanPins === 0),
      spanPinsSeveral: n((e) => e.spanPins > 1),
      innermostPinsExactlyOne: n((e) => e.innermost === 1),
      lineSelfPinsExactlyOne: n((e) => e.lineSelf === 1),
    },
    null,
    1,
  ),
)
