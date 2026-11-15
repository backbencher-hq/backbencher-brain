/**
 * STORE BINDING TRUTH — what the REAL indexer binds each XML edge to.
 *
 * ## Why this file exists
 *
 * Every resolution number this lane has published so far is a NAME-MATCH count
 * computed in TypeScript over `parseFile` output: `ambiguity-split.mts` says a
 * target is ambiguous when N declarations share a name, and the lane doc quotes
 * "48.4 % of `references` targets resolve". Neither number is a measurement of
 * the graph a consumer walks. The graph is `brain_relationship.target_symbol_id`,
 * and it is written by SQL in `parallel-indexer.ts`, in this order:
 *
 *   insert time   `extractLeaf(target)` first (`parallel-indexer.ts:3375-3390`),
 *                 so a dotted or `:`-qualified target is REDUCED to its last
 *                 segment before any lookup;
 *                 `contains` with a line resolves by (name, file, LINE)
 *                 (`resolveContainsTargetStmt`, `:2354`), every other type by
 *                 `resolveTargetStmt`;
 *   pass 1        `target_external = qualified_name` exact, `INSERT OR IGNORE`
 *                 so a duplicated qualified name binds `MIN(id)` —
 *                 `parallel-indexer.ts:3977-4003`;
 *   pass 2        `target_external = name` and that name is UNIQUE project-wide
 *                 — `:3996-4020`;
 *   pass 4        the `module:item` import form — `src/ast/import-resolution.ts`;
 *   pass I13      for every NON-`contains` row whose target has no `.` and no
 *                 `:`, rebind to `name`-matches ranked (declaration, same-file,
 *                 same-language, id) — `:4110-4160`. A DOTTED target is excluded,
 *                 which is why "publish the qualified name" is not automatically
 *                 an improvement.
 *
 * Six rules, four of which no lane-owned instrument models. So the honest move
 * is to stop modelling and read the table: copy the draw into a scratch project,
 * index it with the production `indexProjectParallel`, and ask SQL what each edge
 * actually bound to.
 *
 * ## The number this produces that nothing else produces
 *
 * `boundOtherFile`: edges that DID bind, to a declaration in a different file
 * than the edge's source. That is the population the lane doc calls "B2
 * cross-file" (9,211 ambiguous edges) but cannot price, because an ambiguous
 * edge is one edge that may bind correctly and an unbound edge is a different
 * thing entirely. It is also the population `bb_impact` and `bb_migrate` act on
 * as if it were real.
 *
 * ## Discipline
 *
 * - REAL indexer, REAL store. No modelled SQL, no predicted bindings.
 * - The corpus is COPIED into a scratch directory first. The indexer writes a
 *   database and nothing else, but a copy means the measurement cannot depend on
 *   where it was run from and cannot be perturbed by the copy's own layout.
 * - READ-ONLY with respect to the corpus; the scratch directory and the project
 *   database are removed on exit.
 * - The draw method is identical to `ambiguity-split.mts`, and the draw
 *   fingerprint is printed, so a number from this file and a number from that one
 *   describe the same files.
 *
 * ## Usage
 *
 *   npx tsx validation/m14/fixtures/xml/store-binding-truth.mts
 *   BB_XML_FILES=300 BB_TRUTH_REPOS=libxml2   bound the run
 */
import { execFileSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { createHash } from "node:crypto"
import { getProjectId } from "../../../../src/cli/index"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const WANT = Number(process.env.BB_XML_FILES ?? 600)
const PER_REPO = Number(process.env.BB_XML_PER_REPO ?? 400)
const ONLY_REPO = process.env.BB_TRUTH_REPOS ?? ""
const OUT = process.env.BB_TRUTH_OUT ?? ""

// ───────────────────────────────────────────────────────────── corpus discovery
type FileRow = { repo: string; dir: string; rel: string; abs: string }
const byRepo = new Map<string, FileRow[]>()
for (const e of readdirSync(CR).sort()) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch { continue }
  const rows: FileRow[] = []
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
      encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
    }).split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let size: number
    try { size = statSync(abs).size } catch { continue }
    if (size > 512 * 1024) continue
    let text: string
    try { text = readFileSync(abs, "utf8") } catch { continue }
    if (ONLY_REPO && e !== ONLY_REPO) continue
    // The language router is not re-implemented here on purpose: this file does
    // not measure detection, and a second copy of the routing table would be a
    // second thing to keep honest. `.xml`-family suffixes plus the DTD/XSL/SVG
    // names the corpus uses are enough for a scratch project whose only purpose
    // is to be read back out of the store.
    const lower = rel.toLowerCase()
    if (!/\.(xml|xsd|dtd|xsl|xslt|svg|rng|ent|mod|nvdl)$/.test(lower)) continue
    rows.push({ repo: e, dir, rel, abs })
  }
  if (rows.length > 0) byRepo.set(e, rows.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0)))
}

const sample: FileRow[] = []
{
  const queues = new Map([...byRepo].map(([k, v]) => [k, [...v]]))
  const taken = new Map<string, number>()
  let progress = true
  while (progress && sample.length < WANT) {
    progress = false
    for (const [repo, rows] of queues) {
      if (rows.length === 0 || sample.length >= WANT) continue
      if ((taken.get(repo) ?? 0) >= PER_REPO) continue
      sample.push(rows.shift()!)
      taken.set(repo, (taken.get(repo) ?? 0) + 1)
      progress = true
    }
  }
}
sample.sort((a, b) => (a.repo === b.repo ? (a.rel < b.rel ? -1 : 1) : a.repo < b.repo ? -1 : 1))

const DRAW = (() => {
  const h = createHash("sha256")
  for (const f of sample) {
    let size = -1
    try { size = statSync(f.abs).size } catch {}
    h.update(`${f.repo}/${f.rel} ${size}\n`)
  }
  return h.digest("hex").slice(0, 16)
})()

// ───────────────────────────────────────────────────── scratch project + index
const root = mkdtempSync(path.join(tmpdir(), "bb-xml-truth-"))
let copied = 0
let copiedBytes = 0
for (const f of sample) {
  const dest = path.join(root, f.repo, f.rel)
  mkdirSync(path.dirname(dest), { recursive: true })
  try {
    cpSync(f.abs, dest)
    copied++
    copiedBytes += statSync(dest).size
  } catch { /* a file that will not copy is a file that cannot be indexed */ }
}

console.log(`store binding truth — xml`)
console.log(`  draw ${DRAW}  files ${copied} of ${sample.length} drawn  repos ${new Set(sample.map((f) => f.repo)).size}  bytes ${copiedBytes}`)
console.log(`  scratch ${root}`)

const t0 = Date.now()
const { indexProjectParallel } = await import("../../../../src/ast/parallel-indexer")
const { BrainDatabase } = await import("../../../../src/brain/database")

/**
 * THE SHIM, AND WHY IT IS HERE RATHER THAN IN A COMMIT.
 *
 * `origin/analyzers/ontology-laptop-b` — the aggregate every lane branches from,
 * and the tree this measurement was written on — carries TWO `VALUES` clauses in
 * one `insertSymbol` statement (`src/ast/parallel-indexer.ts:2163-2165`):
 *
 *     INSERT OR REPLACE INTO brain_symbol
 *     (id, project_id, ... 31 columns)
 *     VALUES (? x 31)
 *     VALUES (? x 31)          <-- second one
 *
 * SQLite rejects that at PREPARE time with `near "VALUES": syntax error`, so
 * every batch fails to store, every symbol is lost, and the run ends with
 * "no index for project <id> — post-processing derives from indexed symbols".
 * `origin/main` has ONE `VALUES` clause at the same place, so this is a merge
 * artifact on the aggregate, not a design.
 *
 * `parallel-indexer.ts` is shared machinery this lane does not own, so the
 * duplicate is REPORTED, not fixed here. But without a working store there is no
 * measurement, so this process installs a runtime shim on the sqlite driver's
 * `prepare` that drops the duplicate clause — in memory, for this process only,
 * with the shape checked before the rewrite (one `VALUES`, placeholder count ==
 * column count) and every application counted and printed below. If the shim
 * ever stops firing, the number says 0 and the numbers below are then read
 * against a broken store rather than silently against a repaired one.
 */
const shim = { fired: 0, checked: 0 }
{
  const mod: any = await import("better-sqlite3")
  const Driver = mod?.default ?? mod
  const proto = Driver?.prototype
  if (proto && typeof proto.prepare === "function") {
    const original = proto.prepare
    proto.prepare = function patched(sql: string, ...rest: any[]) {
      if (typeof sql === "string" && /INSERT\s+OR\s+REPLACE\s+INTO\s+brain_symbol\b/i.test(sql)) {
        const lines = sql.split("\n")
        const valueLines = lines.map((l, i) => (/^\s*VALUES\s*\(/i.test(l) ? i : -1)).filter((i) => i >= 0)
        if (valueLines.length > 1) {
          const cols = sql.match(/\(([^()]*)\)\s*\n\s*VALUES/i)?.[1] ?? ""
          const columnCount = cols.split(",").map((c) => c.trim()).filter(Boolean).length
          const placeholders = (lines[valueLines[0]].match(/\?/g) ?? []).length
          if (columnCount > 0 && columnCount === placeholders) {
            shim.checked++
            const dropped = new Set(valueLines.slice(1))
            const out = lines.filter((_, i) => !dropped.has(i)).join("\n")
            shim.fired++
            return original.call(this, out, ...rest)
          }
        }
      }
      return original.call(this, sql, ...rest)
    }
  }
}

/**
 * The project id is DERIVED from the scratch path by the production function,
 * because `brain_relationship.project_id` is a foreign key into a project
 * registry: an invented id stores nothing and fails with
 * "no index for project <id> — post-processing derives from indexed symbols",
 * which reads like a resolver bug and is not one. Measured: 60 files, invented
 * id, 20 batches, every batch "failed to store", 0 symbols.
 */
const PID = getProjectId(root)
let stats: any
try {
  stats = await indexProjectParallel(PID as any, root, {})
} catch (e) {
  console.error(`index failed: ${(e as Error)?.message ?? e}`)
  rmSync(root, { recursive: true, force: true })
  process.exit(2)
}
const indexMs = Date.now() - t0
const raw = await BrainDatabase.getRawInstance(PID as any)

// ────────────────────────────────────────────────────────────────── read truth
/**
 * One row per stored relationship. `target_symbol_id IS NULL` is the store's own
 * word for "this edge names nothing in the graph", and `target_file` <> `source_file`
 * is the store's own word for "this edge crosses a file boundary" — both are
 * columns, not interpretations, which is why this query can be the measurement.
 */
type Row = {
  type: string
  target_external: string | null
  source_bound: number
  target_bound: number
  same_file: number | null
  tgt_name: string | null
  tgt_qname: string | null
  is_cross_file: number | null
}
const rows = raw.prepare(`
  SELECT r.relationship_type AS type,
         r.target_external AS target_external,
         CASE WHEN r.source_symbol_id IS NULL THEN 0 ELSE 1 END AS source_bound,
         CASE WHEN r.target_symbol_id IS NULL THEN 0 ELSE 1 END AS target_bound,
         CASE WHEN ss.file_id = ts.file_id THEN 1 ELSE 0 END AS same_file,
         ts.name AS tgt_name,
         ts.qualified_name AS tgt_qname,
         r.is_cross_file AS is_cross_file
  FROM brain_relationship r
  LEFT JOIN brain_symbol ss ON ss.id = r.source_symbol_id
  LEFT JOIN brain_symbol ts ON ts.id = r.target_symbol_id
  WHERE r.project_id = ?
`).all(PID) as unknown as Row[]

type TypeRow = {
  edges: number
  sourceUnbound: number
  targetUnbound: number
  bound: number
  boundSameFile: number
  boundOtherFile: number
  /** bound rows whose target NAME equals the spelled target exactly. */
  boundNameExact: number
  /** bound rows whose target QUALIFIED name equals the spelled target exactly. */
  boundQnameExact: number
  /** bound rows where the spelled target has to be reduced to bind at all. */
  boundNeedsLeafReduction: number
  /** store says cross-file, store's own is_cross_file column. */
  crossFileFlag: number
  /** `is_cross_file` disagrees with the join: the flag lies in one direction. */
  crossFileFlagWrong: number
}
const perType = new Map<string, TypeRow>()
const blank = (): TypeRow => ({
  edges: 0, sourceUnbound: 0, targetUnbound: 0, bound: 0, boundSameFile: 0, boundOtherFile: 0,
  boundNameExact: 0, boundQnameExact: 0, boundNeedsLeafReduction: 0, crossFileFlag: 0, crossFileFlagWrong: 0,
})
const leaf = (s: string | null): string => {
  if (!s) return ""
  const noLine = s.replace(/:\d+$/, "")
  const lastColon = noLine.split(":").pop() ?? ""
  return (lastColon.split(".").pop() ?? "")
}
for (const r of rows) {
  const key = String(r.type ?? "")
  let row = perType.get(key)
  if (!row) { row = blank(); perType.set(key, row) }
  row.edges++
  if (r.source_bound !== 1) row.sourceUnbound++
  if (r.target_bound !== 1) { row.targetUnbound++; continue }
  row.bound++
  if (r.same_file === 1) row.boundSameFile++
  else row.boundOtherFile++
  const spelled = String(r.target_external ?? "")
  if (r.tgt_name === spelled) row.boundNameExact++
  else if (leaf(spelled) === r.tgt_name) row.boundNeedsLeafReduction++
  if (r.tgt_qname === spelled) row.boundQnameExact++
  if (r.is_cross_file === 1) row.crossFileFlag++
  if ((r.is_cross_file === 1) !== (r.same_file === 0)) row.crossFileFlagWrong++
}

const symCount = (raw.prepare("SELECT COUNT(*) AS c FROM brain_symbol WHERE project_id = ?").get(PID) as any)?.c ?? 0
const fileCount = (raw.prepare("SELECT COUNT(*) AS c FROM brain_file WHERE project_id = ?").get(PID) as any)?.c ?? 0

// ─────────────────────────────────────────────── what the analyzer EMITTED
/**
 * The same files, through the production `parseFile`, counted before the store
 * sees them. Without this column the table below cannot say whether a missing row
 * is an edge the analyzer never produced or an edge the store refused, and those
 * are different defects in different files.
 *
 * `relKey` reproduces the store's own row identity,
 * `parallel-indexer.ts:3657`: `${sourceSymbolId}:${targetName}:${relType}:${relLine ?? "?"}`.
 * `sourceSymbolId` is NOT reproducible outside the store (it is a resolved row
 * id), so `relKey` here substitutes the edge's SPELLED source. It is therefore an
 * UPPER BOUND on the store's collapse: if two edges agree on relKey here they may
 * still differ once the store binds their sources to different declarations, and
 * if they differ here they cannot collapse. Read as a bound, never as a count.
 */
const emitted = new Map<string, { edges: number; withLine: number; withoutLine: number; distinctKeys: Set<string> }>()
{
  const { parseFile } = await import("../../../../src/ast/pool-worker")
  for (const f of sample) {
    const abs = path.join(root, f.repo, f.rel)
    if (!existsSync(abs)) continue
    let r: any
    try { r = await parseFile(abs, root) } catch { continue }
    if (!r) continue
    for (const rel of Array.isArray(r.relationships) ? r.relationships : []) {
      const rawType = String(rel?.type ?? rel?.relationshipType ?? "")
      if (!rawType) continue
      let row = emitted.get(rawType)
      if (!row) { row = { edges: 0, withLine: 0, withoutLine: 0, distinctKeys: new Set() }; emitted.set(rawType, row) }
      row.edges++
      const line = rel?.line_number ?? rel?.lineNumber ?? null
      if (line === null || line === undefined) row.withoutLine++
      else row.withLine++
      const src = String(rel?.source ?? rel?.from ?? "")
      const tgt = String(rel?.target ?? rel?.to ?? "")
      row.distinctKeys.add(`${src}|${rawType}|${tgt}|${line ?? "?"}`)
    }
  }
}

const dupQname = (() => {
  const r = raw.prepare(`
    SELECT COUNT(*) AS c FROM (
      SELECT qualified_name FROM brain_symbol WHERE project_id = ? AND qualified_name IS NOT NULL
      GROUP BY qualified_name HAVING COUNT(*) > 1
    )`).get(PID) as any
  return r?.c ?? 0
})()
const dupName = (() => {
  const r = raw.prepare(`
    SELECT COUNT(*) AS c FROM (
      SELECT name FROM brain_symbol WHERE project_id = ? GROUP BY name HAVING COUNT(*) > 1
    )`).get(PID) as any
  return r?.c ?? 0
})()

// ─────────────────────────────────────────── why a row is unbound, from SQL
/**
 * `target_symbol_id IS NULL` is the store's verdict; these are the candidate
 * causes, each checked in SQL rather than argued:
 *
 *   leafUnique      the target's LAST SEGMENT names exactly one declaration in
 *                   the project. If this is true of an unbound row, the row was
 *                   excluded from strategy 2 for a SPELLING reason, not a
 *                   missing-declaration reason — which is a defect an analyzer can
 *                   reach and a schema change cannot.
 *   qnameSuffix     some declaration publishes `something.<target>` exactly. If
 *                   this is true, strategy 1 (`target_external = qualified_name`)
 *                   would have bound the row had the edge SPELLED the qualified
 *                   name. That is the round brief's cause B, priced against the
 *                   real store instead of against a name-match count.
 *   nameExists      the bare name is declared somewhere (pass 2 or I13 both look
 *                   for exactly this and still did not bind).
 */
const unboundDiagnosis = (() => {
  const per: Record<string, Record<string, number>> = {}
  const causes: Array<[string, string, number]> = [
    ["leafUnique", `EXISTS (SELECT 1 FROM brain_symbol s WHERE s.project_id = ? AND s.name =
        (SELECT CASE WHEN instr(r.target_external, '.') > 0
          THEN substr(r.target_external, instr(r.target_external, '.') + 1)
          ELSE r.target_external END))`, 3],
    ["qnameSuffix", `EXISTS (SELECT 1 FROM brain_symbol s WHERE s.project_id = ? AND s.qualified_name LIKE '%.' || r.target_external)`, 3],
    ["nameExists", `EXISTS (SELECT 1 FROM brain_symbol s WHERE s.project_id = ? AND s.name = r.target_external)`, 3],
    ["dottedTarget", `(instr(r.target_external, '.') > 0 OR instr(r.target_external, ':') > 0)`, 2],
  ]
  for (const [type] of [...perType.entries()].sort((a, b) => b[1].edges - a[1].edges)) {
    const row: Record<string, number> = {}
    const base = (raw.prepare(`SELECT COUNT(*) AS c FROM brain_relationship r
      WHERE r.project_id = ? AND r.relationship_type = ? AND r.target_symbol_id IS NULL`).get(PID, type) as any)?.c ?? 0
    row.unbound = base
    for (const [name, pred, arity] of causes) {
      const sql = `SELECT COUNT(*) AS c FROM brain_relationship r
        WHERE r.project_id = ? AND r.relationship_type = ? AND r.target_symbol_id IS NULL AND ${pred}`
      const params = arity === 3 ? [PID, type, PID] : [PID, type]
      row[name] = (raw.prepare(sql).get(...params) as any)?.c ?? 0
    }
    per[type] = row
  }
  return per
})()

const unboundTopTargets = (raw.prepare(`
  SELECT r.relationship_type AS type, r.target_external AS target, COUNT(*) AS n
  FROM brain_relationship r
  WHERE r.project_id = ? AND r.target_symbol_id IS NULL
  GROUP BY r.relationship_type, r.target_external ORDER BY n DESC LIMIT 20
`).all(PID) as any[]) ?? []

const otherFileSamples = (raw.prepare(`
  SELECT r.relationship_type AS type, r.target_external AS target,
         r.source_external AS source, ss.name AS src_name, sf.relative_path AS src_file,
         tf.relative_path AS tgt_file, ts.name AS tgt_name, ts.qualified_name AS tgt_qname
  FROM brain_relationship r
  LEFT JOIN brain_symbol ss ON ss.id = r.source_symbol_id
  LEFT JOIN brain_file sf ON sf.id = ss.file_id
  LEFT JOIN brain_symbol ts ON ts.id = r.target_symbol_id
  LEFT JOIN brain_file tf ON tf.id = ts.file_id
  WHERE r.project_id = ? AND r.target_symbol_id IS NOT NULL AND ss.file_id <> ts.file_id
  LIMIT 20
`).all(PID) as any[]) ?? []

const sum = (f: (t: TypeRow) => number) => [...perType.values()].reduce((a, t) => a + f(t), 0)
const report = {
  instrument: "store-binding-truth",
  draw: DRAW,
  filesDrawn: sample.length,
  filesCopied: copied,
  repos: new Set(sample.map((f) => f.repo)).size,
  corpusAdmittedFiles: [...byRepo.values()].reduce((a, r) => a + r.length, 0),
  indexMs,
  indexStats: {
    totalFiles: stats?.totalFiles, symbols: stats?.symbols ?? symCount,
    relationships: stats?.relationships, imports: stats?.imports,
  },
  storeRows: {
    brainFile: fileCount,
    brainSymbol: symCount,
    brainRelationship: rows.length,
    qualifiedNamesDuplicated: dupQname,
    namesDuplicated: dupName,
  },
  perType: Object.fromEntries([...perType.entries()].sort((a, b) => b[1].edges - a[1].edges)),
  emittedByType: Object.fromEntries(
    [...emitted.entries()]
      .map(([t, v]) => [t, { edges: v.edges, withLine: v.withLine, withoutLine: v.withoutLine, distinctSpelledKeys: v.distinctKeys.size }])
      .sort((a: any, b: any) => b[1].edges - a[1].edges),
  ),
  totals: {
    edges: sum((t) => t.edges),
    sourceUnbound: sum((t) => t.sourceUnbound),
    targetUnbound: sum((t) => t.targetUnbound),
    bound: sum((t) => t.bound),
    boundSameFile: sum((t) => t.boundSameFile),
    boundOtherFile: sum((t) => t.boundOtherFile),
    boundNameExact: sum((t) => t.boundNameExact),
    boundQnameExact: sum((t) => t.boundQnameExact),
    boundNeedsLeafReduction: sum((t) => t.boundNeedsLeafReduction),
    crossFileFlag: sum((t) => t.crossFileFlag),
    crossFileFlagWrong: sum((t) => t.crossFileFlagWrong),
  },
  unboundDiagnosis,
  unboundTopTargets,
  otherFileSamples,
}

if (OUT) writeFileSync(OUT, JSON.stringify({ ...report, drawRows: sample.map((f) => `${f.repo}/${f.rel}`) }, null, 2))

const pad = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
console.log(`  indexed in ${indexMs} ms: ${fileCount} files, ${symCount} symbols, ${rows.length} relationship rows`)
console.log(`  duplicate-VALUES shim: fired ${shim.fired} time(s), shape-checked ${shim.checked} (0 = no working store, read nothing below as measured)`)
console.log(`  duplicated qualified_name keys ${dupQname}; duplicated bare names ${dupName}`)
console.log("")
console.log(pad("type", 16) + pad("edges", 9) + pad("srcUnb", 8) + pad("tgtUnb", 8) + pad("bound", 9)
  + pad("sameFile", 10) + pad("otherFile", 11) + pad("nameExact", 11) + pad("qnameExact", 12) + "leafRed")
console.log("-".repeat(96))
for (const [t, r] of [...perType.entries()].sort((a, b) => b[1].edges - a[1].edges)) {
  console.log(
    pad(t, 16) + pad(String(r.edges), 9) + pad(String(r.sourceUnbound), 8) + pad(String(r.targetUnbound), 8)
    + pad(String(r.bound), 9) + pad(String(r.boundSameFile), 10) + pad(String(r.boundOtherFile), 11)
    + pad(String(r.boundNameExact), 11) + pad(String(r.boundQnameExact), 12) + String(r.boundNeedsLeafReduction),
  )
}
console.log("-".repeat(96))
const T = report.totals
console.log(`bound ${T.bound} of ${T.edges} (${((T.bound / Math.max(1, T.edges)) * 100).toFixed(1)}%)  unbound ${T.targetUnbound}`)
console.log(`  bound same file ${T.boundSameFile}   bound OTHER FILE ${T.boundOtherFile}   cross_file flag ${T.crossFileFlag}   flag disagrees with the join ${T.crossFileFlagWrong}`)
console.log(`  bound by exact name ${T.boundNameExact}   by exact qualified name ${T.boundQnameExact}   only after leaf reduction ${T.boundNeedsLeafReduction}`)
console.log("")
console.log("emitted by parseFile on the same files, and the store's row identity")
console.log(pad("type", 16) + pad("emitted", 10) + pad("withLine", 10) + pad("noLine", 8) + pad("distinctKeys", 14) + pad("stored", 9) + "stored/emitted")
console.log("-".repeat(84))
for (const [t, v] of [...emitted.entries()].sort((a, b) => b[1].edges - a[1].edges)) {
  const stored = perType.get(t)?.edges ?? 0
  console.log(
    pad(t, 16) + pad(String(v.edges), 10) + pad(String(v.withLine), 10) + pad(String(v.withoutLine), 8)
    + pad(String(v.distinctKeys.size), 14) + pad(String(stored), 9)
    + (v.edges ? `${((stored / v.edges) * 100).toFixed(1)}%` : "—"),
  )
}
console.log("(the store ADDS rows of its own — auto-generated owner->child contains, parallel-indexer.ts:3138 —")
console.log(" so stored/emitted above 100% is not an anomaly; the emitted and distinct-key columns are the analyzer's)")
console.log("")
console.log("unbound rows, cause checked in SQL (each column is a SUBSET of unbound, not exclusive)")
console.log(pad("type", 16) + pad("unbound", 10) + pad("leafUnique", 12) + pad("qnameSuffix", 13) + pad("nameExists", 12) + "dotted")
console.log("-".repeat(66))
for (const [t, d] of Object.entries(unboundDiagnosis)) {
  console.log(pad(t, 16) + pad(String(d.unbound), 10) + pad(String(d.leafUnique), 12) + pad(String(d.qnameSuffix), 13)
    + pad(String(d.nameExists), 12) + String(d.dottedTarget))
}
console.log("")
console.log("top unbound targets (type, target_external, rows)")
for (const r of unboundTopTargets) console.log(`  ${r.type}  ${r.target}  ${r.n}`)
console.log("")
console.log(`bound to ANOTHER file — ${T.boundOtherFile} rows; first ${otherFileSamples.length}:`)
for (const r of otherFileSamples) console.log(`  ${r.type}  ${r.src_name} -[${r.target}]-> ${r.tgt_name} (${r.tgt_qname})  ${r.src_file} -> ${r.tgt_file}`)

rmSync(root, { recursive: true, force: true })
try { rmSync(path.dirname(BrainDatabase.getDbPath(PID as any)), { recursive: true, force: true }) } catch { /* nothing to clean */ }
process.exit(0)