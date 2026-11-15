/**
 * LIVE-INDEX RESOLUTION PROBE — does commit 9472d1861's fleet-wide claim still hold?
 *
 * THE CLAIM (unattributed, shipped as prose with no instrument):
 *   measured on "this repository's own live index (190,213 symbols, 496,886 relationships)":
 *     - 1,543 cross-file dotted edges
 *     - 882 of them ignored an EXACT-NAME symbol in their own file
 *     - a same-file-preference change WOULD REPOINT 32,359 bound edges
 *     - hand-checked: validation/m14/issue-urls.json target `M14.0.F1` "-> bound to
 *       validation/m14/results/M14.0.F1.json"
 *
 * USAGE
 *   node validation/m14/fixtures/index/live-index-resolution-probe.cjs [db] [--index]
 *
 * WHY A COPY AND WHY `--index`: the live index lives outside the session workspace
 * (/home/ishaq2321/.bb/projects/<id>/brain.db). SQLite needs a writable directory beside the
 * file for its temp store, so a read-only open OUTSIDE the workspace fails with
 * SQLITE_CANTOPEN — which is why the first version of this probe crashed on the very database
 * its queries had just worked on. Copy it in first, and pass `--index` to build the two
 * covering indexes the correlated checks need (the product's own index has none, which took a
 * 500k-row correlated EXISTS from seconds to minutes).
 *
 *   cp /home/ishaq2321/.bb/projects/1d3d57103be91b8f9716d70199fe28a3f39245d9/brain.db \
 *      .tmp-index/live.db
 *   node validation/m14/fixtures/index/live-index-resolution-probe.cjs .tmp-index/live.db --index
 *
 * THE DRIVER MATTERS TOO. `node:sqlite`'s `DatabaseSync` reported "unable to open database file"
 * and then 0 tables on a file whose header reads `SQLite format 3`. The product uses
 * `better-sqlite3`; so does this probe. An instrument that cannot open the artefact must not be
 * reported as a finding about the artefact.
 *
 * SCHEMA (the index is NOT `symbols`/`relationships`; those table names do not exist):
 *   brain_file(id, path) · brain_symbol(id, project_id, file_id, name, qualified_name, ...)
 *   brain_relationship(id, project_id, source_symbol_id, target_symbol_id, relationship_type,
 *                      confidence, context, line_number, is_cross_file, ...)
 */
const Database = require("better-sqlite3")

const args = process.argv.slice(2)
const BUILD_INDEX = args.includes("--index")
const DB = args.find((a) => !a.startsWith("--")) ||
  "/home/ishaq2321/.bb/projects/1d3d57103be91b8f9716d70199fe28a3f39245d9/brain.db"

// A COPY may be written to (indexes); the live file must never be. Read-only when not asked to index.
const db = new Database(DB, { readonly: !BUILD_INDEX, fileMustExist: true })
const one = (s, ...a) => db.prepare(s).get(...a)
const all = (s, ...a) => db.prepare(s).all(...a)
const say = (label, v) => console.log(`${label.padEnd(58)} ${typeof v === "object" ? JSON.stringify(v) : v}`)

if (BUILD_INDEX) {
  db.exec("create index if not exists probe_sym_file_name on brain_symbol(file_id, name)")
  db.exec("create index if not exists probe_sym_name on brain_symbol(name)")
  db.exec("create index if not exists probe_rel_src on brain_relationship(source_symbol_id)")
  db.exec("create index if not exists probe_rel_tgt on brain_relationship(target_symbol_id)")
  console.log("(built probe_sym_file_name, probe_sym_name, probe_rel_src, probe_rel_tgt on the COPY)\n")
}

console.log(`index ${DB}`)
console.log(`      ${one("select count(*) c from brain_file").c} files, ` +
            `${one("select count(*) c from brain_symbol").c} symbols, ` +
            `${one("select count(*) c from brain_relationship").c} relationships`)
console.log(`      claim says 190,213 symbols / 496,886 relationships\n`)

// ── the population the claim reasons about
say("cross-file edges (by FILE_ID)", one(`select count(*) c from brain_relationship r
  join brain_symbol ss on ss.id=r.source_symbol_id
  join brain_symbol ts on ts.id=r.target_symbol_id
  where ss.file_id <> ts.file_id`).c)
say("  ...the same, by the index's own flag", one(`select count(*) c from brain_relationship r
  join brain_symbol ss on ss.id=r.source_symbol_id join brain_symbol ts on ts.id=r.target_symbol_id
  where r.is_cross_file=1 and ss.file_id <> ts.file_id`).c)
say("  claim says", "1,543")
console.log(`      by type: ` + all(`select r.relationship_type t, count(*) c from brain_relationship r
       join brain_symbol ss on ss.id=r.source_symbol_id join brain_symbol ts on ts.id=r.target_symbol_id
       where ss.file_id <> ts.file_id group by 1 order by c desc`).map((r) => `${r.t}:${r.c}`).join(" ") + "\n")

// ── THE CORE CLAIM: a cross-file edge whose target NAME also exists in the source's own file
say("cross-file edges ignoring a same-file EXACT-NAME symbol", one(`select count(*) c from brain_relationship r
  join brain_symbol ss on ss.id=r.source_symbol_id
  join brain_symbol ts on ts.id=r.target_symbol_id
  where ss.file_id <> ts.file_id
    and exists (select 1 from brain_symbol l where l.file_id = ss.file_id and l.name = ts.name)`).c)
say("  claim says", "882")

// ── the counterfactual: bound edges WITH a same-file exact-name candidate, and where they point
const withCandidate = one(`select count(*) c from brain_relationship r
  join brain_symbol ss on ss.id=r.source_symbol_id
  join brain_symbol ts on ts.id=r.target_symbol_id
  where exists (select 1 from brain_symbol l where l.file_id = ss.file_id and l.name = ts.name)`).c
const alreadyThere = one(`select count(*) c from brain_relationship r
  join brain_symbol ss on ss.id=r.source_symbol_id
  join brain_symbol ts on ts.id=r.target_symbol_id
  where ts.file_id = ss.file_id
    and exists (select 1 from brain_symbol l where l.file_id = ss.file_id and l.name = ts.name)`).c
say("bound edges WITH a same-file exact-name candidate", withCandidate)
say("  already pointed there (nothing to repoint)", alreadyThere)
say("  WOULD REPOINT = the difference", withCandidate - alreadyThere)
say("  claim says", "32,359 (json 31,785, typescript 105, ...)")

// ── the hand-checked example, checked
const ex = all(`select ss.name sn, ss.file_id sf, ts.name tn, ts.file_id tf, r.relationship_type t
  from brain_relationship r
  join brain_symbol ss on ss.id=r.source_symbol_id
  join brain_symbol ts on ts.id=r.target_symbol_id
  where ts.name='M14.0.F1'`)
say("edges targeting a symbol named M14.0.F1", ex.length)
for (const e of ex) say("  " + e.t, `${e.sn} -> ${e.tn}   SAME FILE: ${e.sf === e.tf}`)
console.log(`      claim: "validation/m14/issue-urls.json  target M14.0.F1 -> bound to validation/m14/results/M14.0.F1.json"`)

// ── the claim's language split, as a distribution over source extensions
const byExt = one(`select count(*) c, sum(case when sf.path like '%.json' then 1 else 0 end) json_e
  from brain_relationship r
  join brain_symbol ss on ss.id=r.source_symbol_id join brain_file sf on sf.id=ss.file_id
  join brain_symbol ts on ts.id=r.target_symbol_id
  where ss.file_id <> ts.file_id
    and exists (select 1 from brain_symbol l where l.file_id=ss.file_id and l.name=ts.name)`)
say("cross-file edges WITH a local exact-name candidate", `${byExt.c}  (json ${byExt.json_e})`)
say("  claim's split", "json 853, markdown 18, elixir 9, lua 4, css 4")
db.close()
