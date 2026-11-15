// XML lane — THE ONE-FILE INSERT HOOK. Settles the 1.83x `contains` factor.
//
// THE OPEN ITEM. `contains` emitted 4,375 edges over 300 libxslt files through `parseFile`, and the
// store held 7,649 rows — 1.748x, `contains` only (calls 1.0, imports 1.0, references 0.91). Two
// explanations survive the earlier probes (`emitted-vs-stored.mts` refuted probe ordering and
// row-id duplication; the excess is store-side and the store holds MORE distinct
// (source_symbol_id, target, line) TRIPLES than the analyzer emitted edges):
//
//   (a) ONE edge inserted more than once, each time bound to a different source symbol; or
//   (b) the analyzer emits MORE edges inside the indexer's worker path than a direct `parseFile`
//       call sees — which, if true, means every lane's edge counts through the pool path are wrong.
//
// THE TEST. Index ONE file in-process with a hook on the relationship insert, recording every row
// the store is asked to write (id, resolved source symbol, spelled source, target, type, line)
// beside that file's own direct `analyze()` output. The multiset comparison decides between (a) and
// (b) with no inference left.
//
// WHY THE HOOK IS THE RIGHT INSTRUMENT: the insert happens in the MAIN process (workers parse, the
// main process stores), so patching the driver's `prepare`/`run` sees every row. `INSERT OR IGNORE`
// means a repeated id writes nothing — so counting ROWS cannot see (a); counting INSERTS can.
//
// USAGE
//   HOME=$PWD/.tmp-xml/home bun validation/m14/fixtures/xml/insert-hook.mts
//   BB_HOOK_FILE=tests/docbook/common/common.xsl BB_HOOK_OUT=... bun ...
import { execFileSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../../../src/cli/index"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const REPO = process.env.BB_HOOK_REPO ?? "libxslt"
const REL = process.env.BB_HOOK_FILE ?? "tests/docbook/common/common.xsl"
const OUT = process.env.BB_HOOK_OUT ?? ""
const EXT_RE = /\.(xml|xsd|dtd|xsl|xslt|svg|rng|ent|mod|nvdl)$/
const PROJECT = process.env.BB_HOOK_PROJECT ?? `${REPO}/${REL}`

// ── the hook, installed BEFORE the database is opened
type Insert = { id: string; sourceId: string | null; targetId: string | null; sourceExternal: string | null; targetExternal: string; type: string; line: number | null }
const inserts: Insert[] = []
const fileInserts: string[] = []
{
  const mod: any = await import("better-sqlite3")
  const Driver = mod?.default ?? mod
  const proto = Driver?.prototype
  if (proto && typeof proto.prepare === "function") {
    const original = proto.prepare
    proto.prepare = function patched(sql: string, ...rest: any[]) {
      const stmt = original.call(this, sql, ...rest)
      if (typeof sql === "string") {
        if (/INSERT\s+(OR\s+IGNORE\s+)?INTO\s+brain_relationship\b/i.test(sql) && typeof stmt.run === "function") {
          const origRun = stmt.run.bind(stmt)
          stmt.run = (...args: any[]) => {
            inserts.push({
              id: String(args[0] ?? ""),
              sourceId: args[2] === null || args[2] === undefined ? null : String(args[2]),
              targetId: args[3] === null || args[3] === undefined ? null : String(args[3]),
              sourceExternal: args[4] === null || args[4] === undefined ? null : String(args[4]),
              targetExternal: String(args[5] ?? ""), type: String(args[6] ?? ""),
              line: args[9] === null || args[9] === undefined ? null : Number(args[9]),
            } as any)
            return origRun(...args)
          }
        } else if (/INTO\s+brain_file\b/i.test(sql) && typeof stmt.run === "function") {
          const origRun = stmt.run.bind(stmt)
          stmt.run = (...args: any[]) => { fileInserts.push(String(args[0] ?? "")); return origRun(...args) }
        }
      }
      return stmt
    }
  }
}

const srcAbs = path.join(CR, REPO, REL)
if (!existsSync(srcAbs)) { console.error(`no such file: ${srcAbs}`); process.exit(2) }
const root = mkdtempSync(path.join(tmpdir(), "bb-xml-hook-"))
const dest = path.join(root, PROJECT)
mkdirSync(path.dirname(dest), { recursive: true })
cpSync(srcAbs, dest)

// ── the analyzer's own output, direct, in THIS process
function collect(r: any): { type: string; source: string; target: string; line: number | null }[] {
  return (Array.isArray(r?.relationships) ? r.relationships : []).map((x: any) => ({
    type: String(x?.type ?? x?.relationshipType ?? ""),
    source: String(x?.source ?? ""),
    target: String(x?.target ?? ""),
    line: x?.line_number ?? x?.lineNumber ?? null,
  }))
}
const directBefore = collect(await parseFile(dest, root, { projectRoot: root } as any))

// ── the hooked index, ONE file
const { indexProjectParallel } = await import("../../../../src/ast/parallel-indexer")
const { BrainDatabase } = await import("../../../../src/brain/database")
const PID = getProjectId(root)
const t0 = Date.now()
await indexProjectParallel(PID as any, root, { skipDiscovery: true, files: [dest] } as any)
const indexMs = Date.now() - t0

const directAfter = collect(await parseFile(dest, root, { projectRoot: root } as any))

const raw = await BrainDatabase.getRawInstance(PID as any)
const symRows = raw.prepare(`SELECT id, name, file_id FROM brain_symbol WHERE project_id = ?`).all(PID) as any[]
const nameOf = new Map<string, string>()
const fileOf = new Map<string, string>()
for (const s of symRows) { nameOf.set(String(s.id), String(s.name ?? "")); fileOf.set(String(s.id), String(s.file_id ?? "")) }
const stored = raw.prepare(`SELECT relationship_type AS type, COUNT(*) AS c FROM brain_relationship WHERE project_id = ? GROUP BY relationship_type`).all(PID) as any[]

const key = (type: string, source: string, target: string, line: number | null) => `${type}\u0000${source}\u0000${target}\u0000${line ?? "?"}`
const multiset = (rows: { type: string; source: string; target: string; line: number | null }[]) => {
  const m = new Map<string, number>()
  for (const r of rows) m.set(key(r.type, r.source, r.target, r.line), (m.get(key(r.type, r.source, r.target, r.line)) ?? 0) + 1)
  return m
}
// The inserted rows carry a resolved SOURCE ID, not the spelled source — so they are compared
// through the symbol table, which is what makes this a comparison of the same field.
const insertedRows = inserts.map((i) => ({
  type: i.type,
  source: i.sourceId === null ? `(external)${i.sourceExternal ?? ""}` : (nameOf.get(i.sourceId) ?? `(unresolved-id)${i.sourceId}`),
  target: i.targetExternal,
  line: i.line,
}))
const mDirect = multiset(directBefore)
const mInserted = multiset(insertedRows)
const onlyInserted: string[] = [], onlyDirect: string[] = [], repeatedInserts: { key: string; inserts: number; analyzer: number }[] = []
for (const [k, n] of mInserted) {
  const d = mDirect.get(k) ?? 0
  if (d === 0) { if (onlyInserted.length < 10) onlyInserted.push(`${k.replace(/\u0000/g, " | ")} x${n}`) }
  else if (n > d && repeatedInserts.length < 10) repeatedInserts.push({ key: k.replace(/\u0000/g, " | "), inserts: n, analyzer: d })
}
for (const [k, n] of mDirect) {
  const ins = mInserted.get(k) ?? 0
  if (ins === 0 && onlyDirect.length < 10) onlyDirect.push(`${k.replace(/\u0000/g, " | ")} x${n}`)
}
// THE PREDICTION. `parallel-indexer.ts:3955-3984` synthesizes ONE `contains` row per owned symbol
// ("Universal contains relationship — owner→owned containment ..."), deduped against the engine's
// own contains pairs via `containsPairs` (keyed `${ownerLeaf} ${symbol.name}`). If that is the whole
// explanation, then stored - analyzer == distinct (owner, name) pairs among owned symbols that the
// analyzer's own contains edges do not already carry.
const ownedRows = raw.prepare(`
  SELECT s.name AS child, o.name AS owner
  FROM brain_symbol s JOIN brain_symbol o ON o.id = s.owner_symbol_id
  WHERE s.project_id = ? AND s.owner_symbol_id IS NOT NULL`).all(PID) as any[]
// THE EXACT PREDICTION, with the indexer's OWN two regexes (`parallel-indexer.ts:3651-3652` for the
// key set, `:3971` for the lookup). They are not the same shape:
//   key set  : leaf(src) + " " + leaf(tgt)      <- BOTH ends leaf-reduced
//   lookup   : leaf(ownerId) + " " + name       <- owner reduced, CHILD RAW
// For a prefixed name (`xsl:template`, `doc:reference`) the leaf is the part after the LAST colon,
// so the two keys differ and the dedup never fires: the indexer synthesizes a containment edge the
// analyzer already emitted.
const leafKey = (x: string) => x.replace(/^.*:([^:]+):?\d*$/, "$1")
const lookupLeaf = (id: string) => id.replace(/^.*:([^:]+):\d+$/, "$1")
const analyzerPairs = new Set<string>()
for (const r of directBefore) {
  if (r.type !== "contains") continue
  const a = leafKey(r.source), b = leafKey(r.target)
  if (a && b) { analyzerPairs.add(`${a} ${b}`); analyzerPairs.add(`${b} ${a}`) }
}
const ownedPairs = new Set<string>()
for (const o of ownedRows) ownedPairs.add(`${String(o.owner)} ${String(o.child)}`)
const ownedLookups = raw.prepare(`
  SELECT s.name AS child, s.owner_symbol_id AS ownerId
  FROM brain_symbol s WHERE s.project_id = ? AND s.owner_symbol_id IS NOT NULL`).all(PID) as any[]
const synthesizedPredicted = ownedLookups.filter((o: any) => !analyzerPairs.has(`${lookupLeaf(String(o.ownerId))} ${String(o.child)}`)).length
const colonNamedOwned = ownedLookups.filter((o: any) => String(o.child).includes(":")).length
const directContains = directBefore.filter((r) => r.type === "contains").length
const insertedContains = insertedRows.filter((r) => r.type === "contains").length

const report = {
  instrument: "xml insert hook — one file, the analyzer's edges beside every row the store was asked to write",
  file: PROJECT, projectId: PID, indexMs,
  counts: {
    directBeforeTotal: directBefore.length, directAfterTotal: directAfter.length,
    directBeforeContains: directContains, directAfterContains: directAfter.filter((r) => r.type === "contains").length,
    insertedTotal: inserts.length, insertedContains,
    storedByType: Object.fromEntries(stored.map((s: any) => [String(s.type), Number(s.c)])),
    brainFileInserts: fileInserts.length, brainFileInsertsDistinct: new Set(fileInserts).size,
    ownedSymbolPairs: ownedPairs.size,
    synthesizedPredicted, colonNamedOwned,
    storedContainsMinusAnalyzer: (Number((Object.fromEntries(stored.map((s2: any) => [String(s2.type), Number(s2.c)])) as any).contains ?? 0)) - directContains,
  },
  multiset: {
    directDistinctKeys: mDirect.size, insertedDistinctKeys: mInserted.size,
    onlyInserted: onlyInserted, onlyDirect: onlyDirect,
    insertedMoreOftenThanAnalyzerEmitted: repeatedInserts,
  },
  reading: {
    "(a)_insertedTwice": "insertedMoreOftenThanAnalyzerEmitted is non-empty: one analyzer edge is written more than once with different source bindings",
    "(b)_poolEmitsMore": "onlyInserted is non-empty: the indexer received edges a direct parseFile does not produce — a fleet-level finding about the pool path",
    "neither": "the multisets agree; then the 1.83x must come from a path this hook does not see (e.g. a second indexing pass) and brainFileInserts is the next thing to read",
  },
  directAfterEqualsBefore: JSON.stringify(directBefore) === JSON.stringify(directAfter),
}
const text = JSON.stringify(report, null, 2)
if (OUT) writeFileSync(OUT, text)
console.log(text)
rmSync(root, { recursive: true, force: true })
rmSync(path.join(homedir(), ".bb", "projects", String(PID)), { recursive: true, force: true })
