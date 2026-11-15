/**
 * #612 follow-up / the 24 exceptions, named and checked against the source text.
 *
 * After the exact-line rule, one class of `contains` edge still stores a target
 * whose `line_start` is NOT the edge's `line_number`: edges whose target name is
 * unique in the file (so no rule can re-resolve them) but whose stored span
 * starts on an earlier line than the name. §8.2 of the family-closure report
 * counts 24 of them over the ten pinned repos, illustrates the shape with two
 * named symbols, and argues it is an understated-range artifact rather than a
 * wrong symbol. The count is a recorded gauge; the SHAPE was prose, and this
 * probe turns the shape into a record: it lists every such edge and checks the
 * claim in the source text — the name occurs on the edge's line and on no line of
 * the span above it.
 *
 *   npx tsx script/m14/tmp/contains-inner-line-samples-612.ts <repo-dir-abs> [lang]
 *
 * Output (stdout, JSON): counts plus one sample per edge, each carrying
 * `nameOnEdgeLine` / `nameAboveWithinSpan` (null when the name has no plain
 * identifier form to search for, e.g. `operator=`), so "the name sits on an inner
 * line of its own span" is a measured boolean per row, not an inference. `lineGap`
 * (edge line minus span start) separates the two shapes the rows fall into: a
 * decorated declaration whose stored span opens one line up (the `JSON_HEDLEY_PURE`
 * case, gap 1-2), and a span that is a macro or synthesized block (gap in the
 * thousands, e.g. `NLOHMANN_JSON_NAMESPACE_END`).
 */
import * as fs from "fs"
import * as path from "path"
import { createHash } from "crypto"
import { createRequire } from "module"

const require = createRequire(import.meta.url)
const Database = require("better-sqlite3")

const repo = process.argv[2]
const lang = process.argv[3]
const sha = createHash("sha1").update(repo).digest("hex")
const db = new Database(path.join(process.env.HOME ?? "", ".bb", "projects", sha, "brain.db"), { readonly: true })

// Same-file containment edges whose target name is UNIQUE in the file — the set
// where the old choice is provably right — plus the target's stored span.
const rows = db
  .prepare(
    `SELECT f.id fid, f.path fpath, f.relative_path frel, t.name tname, t.symbol_type ttype,
            COALESCE(t.is_declaration, 0) tdecl,
            t.line_start tstart, t.line_end tend, r.line_number rline,
            (SELECT COUNT(*) FROM brain_symbol x WHERE x.file_id = f.id AND x.name = t.name) cands
       FROM brain_relationship r
       JOIN brain_symbol s ON s.id = r.source_symbol_id
       JOIN brain_symbol t ON t.id = r.target_symbol_id
       JOIN brain_file f ON f.id = s.file_id
      WHERE r.relationship_type = 'contains' AND f.id = t.file_id
        ${lang ? "AND f.language = ?" : ""}`,
  )
  .all(...(lang ? [lang] : [])) as any[]

const unique = rows.filter((r) => r.cands === 1)
const disagreeing = unique.filter((r) => r.rline !== r.tstart)

/** Word-boundary match for names with a plain identifier form; null otherwise. */
function nameFinder(name: string): RegExp | null {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return null
  return new RegExp(`(^|[^A-Za-z0-9_])${name}([^A-Za-z0-9_]|$)`)
}

const samples: any[] = []
let nameOnEdgeLine = 0
let nameAboveWithinSpan = 0
let textChecked = 0
let textSkipped = 0
let fileUnreadable = 0

for (const r of disagreeing) {
  const file = path.isAbsolute(r.fpath) ? r.fpath : path.join(repo, r.fpath)
  const finder = nameFinder(r.tname)
  let onEdge: boolean | null = null
  let above: boolean | null = null
  if (finder && fs.existsSync(file)) {
    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/)
    const at = (n: number) => (lines[n - 1] ?? "")
    onEdge = finder.test(at(r.rline))
    above = false
    // every line of the span ABOVE the edge's line; if the span is wrong-headed
    // (end < start) read up to the line before the edge
    const top = Math.min(r.tstart, r.rline)
    for (let n = top; n < r.rline; n++) if (finder.test(at(n))) { above = true; break }
    textChecked++
    if (onEdge) nameOnEdgeLine++
    if (above) nameAboveWithinSpan++
  } else if (finder) {
    fileUnreadable++
  } else {
    textSkipped++
  }
  samples.push({
    at: `${r.frel ?? r.fpath}:${r.rline}`,
    name: r.tname,
    type: r.ttype,
    isDeclaration: r.tdecl === 1,
    edgeLine: r.rline,
    lineGap: r.tstart != null && r.rline != null ? r.rline - r.tstart : null,
    spanStart: r.tstart,
    spanEnd: r.tend,
    spanLines: r.tend != null && r.tstart != null ? r.tend - r.tstart + 1 : null,
    nameOnEdgeLine: onEdge,
    nameAboveWithinSpan: above,
  })
}

samples.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))

console.log(
  JSON.stringify(
    {
      repo: path.basename(repo),
      lang: lang ?? "(all)",
      sameFileContainmentEdges: rows.length,
      uniqueTargetNameEdges: unique.length,
      uniqueTargetNameLineMismatches: disagreeing.length,
      textChecked,
      textSkipped,
      fileUnreadable,
      nameOnEdgeLine,
      nameAboveWithinSpan,
      samples,
    },
    null,
    1,
  ),
)
