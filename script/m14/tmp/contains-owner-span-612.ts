/**
 * #612 follow-up, the OWNER column's version of the containment question.
 *
 * The store derives every symbol's structural owner and emits its own `contains`
 * edge from it — and that derivation is a NAME lookup (`nameToSymbol.get(owner)`,
 * first-wins), so a file that repeats a container name assigns the owner to
 * whichever declaration the analyzer emitted first. A `contains` edge asserts
 * ENCLOSURE, so an owner whose extent does not cover the child is a contradicted
 * fact, exactly like a name-resolved edge that landed on the wrong container.
 *
 * This probe measures three things, per repo and language, WITHOUT judging which
 * rule is right:
 *   1. how many owned symbols have an owner that does not enclose them
 *      (`contradictedOwner`), and
 *   2. of those, how many have an innermost same-name candidate that WOULD
 *      enclose them (`fixableByOwnName`, the same argument the edge source rule
 *      uses), and
 *   3. how many owned symbols would change owner under that rule at all
 *      (`ownerDiffersFromInnermost`, which includes cases where the current owner
 *      is a defensible outer container).
 *
 *   npx tsx script/m14/tmp/contains-owner-span-612.ts <repo-dir-abs> [lang]
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

const rows = db
  .prepare(
    `SELECT s.id sid, s.name sname, s.line_start sline, COALESCE(s.line_end, s.line_start) send,
            o.id oid, o.name oname, o.line_start oline, COALESCE(o.line_end, o.line_start) oend,
            f.relative_path path,
            (SELECT COUNT(*) FROM brain_symbol x WHERE x.file_id = s.file_id AND x.name = o.name) nameCands,
            (SELECT x.id FROM brain_symbol x
              WHERE x.file_id = s.file_id AND x.name = o.name
                AND x.line_start <= s.line_start
                AND COALESCE(x.line_end, x.line_start) >= s.line_start
              ORDER BY x.line_start DESC LIMIT 1) innermostAtChildLine
       FROM brain_symbol s
       JOIN brain_symbol o ON o.id = s.owner_symbol_id
       JOIN brain_file f ON f.id = s.file_id
      WHERE s.project_id = o.project_id AND s.line_start > 0 ${langClause}`,
  )
  .all(...params) as any[]

const encloses = (line: number, start: number, end: number) => start <= line && end >= line
const contradicted = rows.filter((r) => !encloses(r.sline, r.oline, r.oend))
const fixable = contradicted.filter((r) => r.innermostAtChildLine && r.innermostAtChildLine !== r.oid)
const differs = rows.filter((r) => r.innermostAtChildLine && r.innermostAtChildLine !== r.oid)
const ambiguousName = rows.filter((r) => r.nameCands > 1)

console.log(
  JSON.stringify(
    {
      repo: path.basename(repo),
      lang: lang ?? "(all)",
      ownedSymbolsWithLine: rows.length,
      ownerNameNotUnique: ambiguousName.length,
      contradictedOwner: contradicted.length,
      contradictedOwnerAmbiguousName: contradicted.filter((r) => r.nameCands > 1).length,
      fixableByOwnName: fixable.length,
      ownerDiffersFromInnermost: differs.length,
      samples: contradicted.slice(0, 8).map((r) => ({
        at: `${r.path}:${r.sline}`,
        child: r.sname,
        owner: `${r.oname}@${r.oline}-${r.oend}`,
        nameCands: r.nameCands,
        innermostAtChild: r.innermostAtChildLine ? "yes" : "none",
      })),
    },
    null,
    1,
  ),
)
