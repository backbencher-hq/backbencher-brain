/**
 * STORE-LEVEL RESOLUTION — the end-to-end question `ambiguity-split.mts` cannot answer.
 *
 * ## WHY A SECOND INSTRUMENT
 *
 * `ambiguity-split.mts` and `resolution-census.mts` both stop at `parseFile`: they ask whether the
 * edge's target STRING is a string some symbol in the same run published. The product does not work
 * that way. `src/ast/parallel-indexer.ts` stores a relationship with `target_external = target` and
 * then ATTACHES it to a symbol row through its own rules, which are not name equality:
 *
 *   insert time  `resolveTargetStmt` — `s.name = ?`, ranked (same file, same line, is_declaration)
 *   pass 1       `target_external = qualified_name`   EXACT match — the only deterministic one
 *   pass 2       `target_external = name` AND that name is UNIQUE in the project
 *   pass 4       `module:item` import form
 *   pass I13     re-resolves every BARE target by name over the now-complete symbol table,
 *                deliberately skipping any target containing `.` or `:`
 *
 * So "the target string is a published name" is neither necessary nor sufficient for an edge to bind,
 * and an analyzer change can move one without moving the other. Only this instrument sees the stored
 * row, so it is the one a before/after claim about resolution has to be made on.
 *
 * ## WHAT IT COUNTS
 *
 * Per project, every `brain_relationship` row, no sampling within a project:
 *
 *   edges                rows in brain_relationship
 *   tgt_unres            `target_symbol_id IS NULL`      — the end that binds to a symbol
 *   src_unres            `source_symbol_id IS NULL`
 *   unresExternal        unresolved AND `target_external` names something outside the corpus, as the
 *                        ANALYZER'S OWN `metadata.external` label says (postgresCatalog,
 *                        informationSchema, implicitSchema, platform). Counted, not silently merged
 *                        into the local-reference population — that is cause C, and it is countable
 *                        only because the analyzer already stamps it.
 *   unresUnlabelled      unresolved AND carrying no such label: the residue that is neither a
 *                        resolvable local reference nor a declared external
 *   wrongFile            resolved, but the attached target sits in ANOTHER file while the bare target
 *                        name also existed in the edge's OWN file — the population a name-keyed
 *                        resolution can silently misattach, and the only way to tell a correct
 *                        cross-file binding from a wrong one
 *
 * ## WHY THE POPULATION IS SQL-FILES-ONLY
 *
 * The first version of this instrument indexed whole repositories and every count came back
 * dominated by other languages' edges: postgrest holds 32 tracked `.sql` files and reported 10,073
 * `contains` edges, of which all but a few were written by its TypeScript and Haskell files. Those
 * are not this lane's edges, so `indexProjectParallel` is called with an explicit `files` list —
 * every git-tracked `.sql` file in the repo, no cap. The measured population is therefore exactly the
 * SQL population this lane's analyzer wrote, and the stored symbol table competing with it is SQL's.
 *
 * That second effect is stated rather than hidden: a SQL-only project has fewer same-named symbols
 * than a mixed one, so these resolution rates are the OPTIMISTIC end for a name-keyed resolution. A
 * before/after pair at the same repos and the same file list is still a valid pair; a comparison
 * against a mixed-language project is not.
 *
 * ## WHY THE POPULATION IS NAMED IN THE OUTPUT
 *
 * Every count here is a statement about the projects named in the header. A per-type resolution rate
 * without its file count is a statement about nothing in particular.
 *
 * ## USAGE
 *
 *   npx tsx validation/m14/fixtures/sql/store-resolution.mts [--repos a,b] [--out FILE]
 *
 * `--repos` is a comma list of corpus directory names; the default is every corpus repo holding at
 * least 20 git-tracked `.sql` files, discovered at run time. The discovery rule is printed with the
 * result, so a rerun on a grown corpus says which population it used rather than silently comparing
 * two different ones.
 */
import { execFileSync } from "node:child_process"
import { readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { indexProjectParallel } from "../../../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../../../src/brain/database"

const argv = process.argv.slice(2)
const argOf = (f: string) => {
  const i = argv.indexOf(f)
  if (i < 0) return undefined
  const v = argv[i + 1]
  if (v == null || v.startsWith("--")) {
    console.error(`store-resolution: \`${f}\` has no value`)
    process.exit(2)
  }
  return v
}
const OUT = argOf("--out")
const CORPUS = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const MIN_SQL = 20

// ------------------------------------------------------------------ population

type Repo = { name: string; dir: string; sqlFiles: number; files: string[] }
const found: Repo[] = []
for (const entry of readdirSync(CORPUS).sort()) {
  const dir = path.join(CORPUS, entry)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch {
    continue
  }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
      .split("\0")
      .filter(Boolean)
  } catch {
    continue
  }
  const sqlFiles = tracked.filter((r) => r.endsWith(".sql")).length
  if (sqlFiles >= MIN_SQL) found.push({ name: entry, dir, sqlFiles, files: tracked.filter((r) => r.endsWith(".sql")).map((r) => path.join(dir, r)) })
}
found.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
const wanted = argOf("--repos")
const repos: Repo[] = wanted
  ? found.filter((r) => wanted.split(",").map((s) => s.trim()).includes(r.name))
  : found

console.log(`store resolution — production indexProjectParallel, then the stored rows`)
console.log(`corpus root        ${CORPUS}`)
console.log(`discovery rule     git work tree, >= ${MIN_SQL} git-tracked .sql files, name-sorted`)
console.log(`repos found        ${found.map((r) => `${r.name}(${r.sqlFiles})`).join(" ") || "NONE"}`)
if (repos.length === 0) {
  console.error("store-resolution: no repos selected")
  process.exit(2)
}
console.log(`repos indexed      ${repos.length}: ${repos.map((r) => r.name).join(" ")}`)
console.log(`project ids        one per repo, named store-resolution-<repo>, wiped if present`)

const TYPES = [
  "contains", "references", "calls", "uses", "overrides", "instantiates",
  "implements", "extends", "exports", "imports", "brain_import",
]

const perRepo: any[] = []
const typeTotals = new Map<string, Record<string, number>>()
for (const t of TYPES) {
  typeTotals.set(t, { edges: 0, tgt_unres: 0, src_unres: 0, unresExternal: 0, unresUnlabelled: 0, wrongFile: 0 })
}

const EXTERNAL_KINDS = ["postgresCatalog", "informationSchema", "implicitSchema", "platform"]
// Cause C read off the analyzer's own label, of which this lane writes TWO shapes, both measured
// against the stored rows:
//   classifyExternalTarget's four strings — 'postgresCatalog' | 'informationSchema' |
//     'implicitSchema' | 'platform' — on an edge whose target is a database object
//   `external: true` on a `CREATE EXTENSION` `imports` edge, whose target is installed into the
//     DATABASE rather than declared by any file
// The first version of this reader looked only for the four strings and reported `ext 0` on every
// type of every project. That was the READER and not the store: a direct query over the same rows
// read 399 edges carrying a string label, and 26 more carrying the boolean. A reader that cannot see
// a label reports the label as absent, which is the failure this project exists to prevent, so the
// two shapes are named here rather than pattern-matched.
const labelled = (ann: any): boolean => {
  if (ann == null) return false
  let o: any
  try {
    o = typeof ann === "string" ? JSON.parse(ann) : ann
  } catch {
    return false
  }
  if (!o || typeof o !== "object") return false
  if (typeof o.external === "string" && EXTERNAL_KINDS.includes(o.external)) return true
  if (o.external === true || o.external === 1) return true
  const buckets = o.externalTargets
  if (buckets && typeof buckets === "object" && EXTERNAL_KINDS.some((k) => Number(buckets[k]) > 0)) return true
  return false
}

for (const repo of repos) {
  const pid = `store-resolution-${repo.name}`
  try {
    const raw = await BrainDatabase.getRawInstance(pid)
    raw.exec("DELETE FROM brain_relationship")
    raw.exec("DELETE FROM brain_symbol")
    raw.exec("DELETE FROM brain_file")
  } catch { /* first run: no rows */ }

  const t0 = Date.now()
  await indexProjectParallel(pid, repo.dir, { files: repo.files })
  const ms = Date.now() - t0

  const raw = await BrainDatabase.getRawInstance(pid)
  const files = (raw.prepare("SELECT COUNT(*) c FROM brain_file").get() as any).c as number
  const symbols = (raw.prepare("SELECT COUNT(*) c FROM brain_symbol").get() as any).c as number

  const rows = raw
    .prepare(
      `SELECT r.relationship_type AS type,
              COUNT(*) AS edges,
              SUM(CASE WHEN r.target_symbol_id IS NULL THEN 1 ELSE 0 END) AS tgt_unres,
              SUM(CASE WHEN r.source_symbol_id IS NULL THEN 1 ELSE 0 END) AS src_unres
       FROM brain_relationship r WHERE r.project_id = ? GROUP BY r.relationship_type`,
    )
    .all(pid) as any[]

  // Cause C read off the analyzer's own label. `annotations` is the JSON column the store fills from
  // the analyzer's `metadata`; the four keys are the ones `classifyExternalTarget` stamps.
  const extRows = raw
    .prepare(
      `SELECT r.relationship_type AS type,
              COALESCE(r.target_external, '') AS tgt,
              r.target_symbol_id AS tid,
              (SELECT t.file_id FROM brain_symbol t WHERE t.id = r.target_symbol_id) AS tfile,
              (SELECT s.file_id FROM brain_symbol s WHERE s.id = r.source_symbol_id) AS sfile,
              r.metadata AS ann
       FROM brain_relationship r WHERE r.project_id = ?`,
    )
    .all(pid) as any[]

  const localNameInOwnFile = raw.prepare(
    `SELECT COUNT(*) c FROM brain_symbol WHERE project_id = ? AND name = ? AND file_id = ?`,
  )

  const perType = new Map<string, Record<string, number>>()
  for (const row of rows) {
    const t = String(row.type)
    perType.set(t, {
      edges: row.edges,
      tgt_unres: row.tgt_unres ?? 0,
      src_unres: row.src_unres ?? 0,
      unresExternal: 0,
      unresUnlabelled: 0,
      wrongFile: 0,
    })
    if (!typeTotals.has(t)) typeTotals.set(t, { edges: 0, tgt_unres: 0, src_unres: 0, unresExternal: 0, unresUnlabelled: 0, wrongFile: 0 })
  }

  const unresSamples = new Map<string, { edges: number; labelled: number; top: Map<string, number> }>()
  for (const r of extRows) {
    const t = String(r.type)
    const pt = perType.get(t)
    if (!pt) continue
    const isLabelled = labelled(r.ann)
    if (r.tid == null) {
      if (isLabelled) pt.unresExternal++
      else {
        pt.unresUnlabelled++
        const s = unresSamples.get(t) ?? { edges: 0, labelled: 0, top: new Map<string, number>() }
        s.edges++
        if (isLabelled) s.labelled++
        s.top.set(r.tgt, (s.top.get(r.tgt) ?? 0) + 1)
        unresSamples.set(t, s)
      }
    } else if (r.tfile != null && r.sfile != null && r.tfile !== r.sfile) {
      // Resolved, but check whether the bare name ALSO existed in the edge's own file: if it did,
      // a name-keyed resolution had a nearer candidate and this binding needs an argument.
      const nearer = (localNameInOwnFile.get(pid, r.tgt, r.sfile) as any).c as number
      if (nearer > 0) pt.wrongFile++
    }
  }

  for (const [t, v] of perType) {
    const tot = typeTotals.get(t)!
    tot.edges += v.edges
    tot.tgt_unres += v.tgt_unres
    tot.src_unres += v.src_unres
    tot.unresExternal += v.unresExternal
    tot.unresUnlabelled += v.unresUnlabelled
    tot.wrongFile += v.wrongFile
  }

  perRepo.push({
    repo: repo.name,
    dir: repo.dir,
    gitTrackedSql: repo.sqlFiles,
    filesIndexed: files,
    symbols,
    ms,
    perType: Object.fromEntries(perType),
    unresTopTargets: Object.fromEntries(
      [...unresSamples.entries()].map(([t, s]) => [
        t,
        [...s.top.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([target, edges]) => ({ target, edges })),
      ]),
    ),
  })

  console.log(`\n== ${repo.name}  (${files} files indexed, ${repo.sqlFiles} tracked .sql, ${symbols} symbols, ${(ms / 1000).toFixed(1)}s)`)
  console.log("   type            edges  tgt_unres   pct  src_unres  ext  unlab  otherFile")
  for (const t of TYPES) {
    const v = perType.get(t)
    if (!v) continue
    const pct = v.edges ? ((100 * (v.edges - v.tgt_unres)) / v.edges).toFixed(2) + "%" : "-"
    console.log(
      `   ${t.padEnd(14)} ${String(v.edges).padStart(6)} ${String(v.tgt_unres).padStart(10)} ${pct.padStart(8)} ${String(v.src_unres).padStart(10)} ${String(v.unresExternal).padStart(4)} ${String(v.unresUnlabelled).padStart(6)} ${String(v.wrongFile).padStart(10)}`,
    )
  }
}

console.log(`\n== TOTAL over ${repos.length} projects (${perRepo.reduce((a, r) => a + r.filesIndexed, 0)} files indexed)`)
console.log("   type            edges  tgt_unres   pct  src_unres  ext  unlab  otherFile")
let eAll = 0, uAll = 0
for (const t of TYPES) {
  const v = typeTotals.get(t)!
  if (!v.edges) continue
  eAll += v.edges
  uAll += v.tgt_unres
  const pct = ((100 * (v.edges - v.tgt_unres)) / v.edges).toFixed(2) + "%"
  console.log(
    `   ${t.padEnd(14)} ${String(v.edges).padStart(6)} ${String(v.tgt_unres).padStart(10)} ${pct.padStart(8)} ${String(v.src_unres).padStart(10)} ${String(v.unresExternal).padStart(4)} ${String(v.unresUnlabelled).padStart(6)} ${String(v.wrongFile).padStart(10)}`,
  )
}
console.log(`   ${"ALL".padEnd(14)} ${String(eAll).padStart(6)} ${String(uAll).padStart(10)} ${((100 * (eAll - uAll)) / eAll).toFixed(2).padStart(7)}%`)

const record = {
  instrument: "validation/m14/fixtures/sql/store-resolution.mts",
  entryPoint: "indexProjectParallel (src/ast/parallel-indexer.ts)",
  corpusRoot: CORPUS,
  discovery: `git work tree, >= ${MIN_SQL} git-tracked .sql files, name-sorted`,
  repos: repos.map((r) => r.name),
  perRepo,
  totals: Object.fromEntries(typeTotals),
  allEdges: eAll,
  allUnresolvedTargets: uAll,
}
if (OUT) {
  writeFileSync(OUT, JSON.stringify(record, null, 2))
  console.log(`\nwrote ${OUT}`)
}