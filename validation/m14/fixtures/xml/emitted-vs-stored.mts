// XML lane — EMITTED vs STORED, and the 1.83x question.
//
// THE OPEN ITEM. The lane's store probe (`store-binding-truth.mts`) reported 39,293 stored
// `contains` rows against 21,486 emitted by the same files through `parseFile` — a factor of 1.83,
// while the other four types agreed within 2%. Disclosed four times and never explained. An
// unexplained factor of 1.8 in an instrument is not a rounding, so this probe isolates it.
//
// THE HYPOTHESIS THIS TESTS. In that instrument the EMITTED pass runs AFTER the index, in the same
// process, on a parser that has just walked 1,143 files. If the parser degrades at that point, the
// emitted column is an UNDERCOUNT and the "1.83x" is the instrument's own ordering rather than
// anything the store did. This probe parses the SAME files TWICE — before the index and after it —
// so the two explanations are separated by the numbers rather than by an argument:
//
//   emittedBefore == emittedAfter == stored   -> no anomaly on this draw
//   emittedBefore ~= stored > emittedAfter    -> the instrument's ordering is the cause
//   emittedBefore == emittedAfter < stored    -> the STORE writes more rows than the analyzer
//                                                emits, and the cause is in the indexer
//
// Emitted counts are keyed on the same row identity the store uses
// (`${source}|${type}|${target}|${line}`, per `parallel-indexer.ts`), and the store side counts
// rows directly (no joins — a join fanned out on duplicated symbol rows in an earlier probe and
// manufactured 482 phantom differences).
//
// USAGE
//   HOME=$PWD/.tmp-xml/home bun validation/m14/fixtures/xml/emitted-vs-stored.mts
//   BB_EVS_REPO=libxslt BB_EVS_FILES=300 BB_EVS_OUT=... bun ...
import { execFileSync } from "node:child_process"
import { cpSync, mkdirSync, mkdtempSync, readdirSync, statSync, rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../../../src/cli/index"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const REPO = process.env.BB_EVS_REPO ?? "libxslt"
const WANT = Number(process.env.BB_EVS_FILES ?? "300")
const OUT = process.env.BB_EVS_OUT ?? ""
const EXT_RE = /\.(xml|xsd|dtd|xsl|xslt|svg|rng|ent|mod|nvdl)$/

const repoDir = path.join(CR, REPO)
const chosen = execFileSync("git", ["-C", repoDir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
  .split("\0").filter(Boolean)
  .filter((rel) => EXT_RE.test(rel.toLowerCase()))
  .filter((rel) => { try { return statSync(path.join(repoDir, rel)).size <= 512 * 1024 } catch { return false } })
  .sort().slice(0, WANT)

const root = mkdtempSync(path.join(tmpdir(), "bb-xml-evs-"))
for (const rel of chosen) {
  const dest = path.join(root, REPO, rel)
  mkdirSync(path.dirname(dest), { recursive: true })
  cpSync(path.join(repoDir, rel), dest)
}

type Counts = { edges: number; keys: Set<string> }
const tally = (m: Map<string, Counts>, type: string, key: string) => {
  let c = m.get(type)
  if (!c) { c = { edges: 0, keys: new Set() }; m.set(type, c) }
  c.edges++; c.keys.add(key)
}

/** One full parse pass over the copied files, counted by type and by the store's row identity. */
async function parsePass(): Promise<Map<string, Counts>> {
  const m = new Map<string, Counts>()
  let parsed = 0, failed = 0, degraded = 0
  for (const rel of chosen) {
    let r: any
    try { r = await parseFile(path.join(root, REPO, rel), root, { projectRoot: root } as any) } catch { failed++; continue }
    if (!r) { failed++; continue }
    parsed++
    if (r.fallback === true || r.metadata?.analysisVersion === "2.0-basic-fallback") degraded++
    for (const rel2 of Array.isArray(r.relationships) ? r.relationships : []) {
      const type = String(rel2?.type ?? rel2?.relationshipType ?? "")
      if (!type) continue
      const line = rel2?.line_number ?? rel2?.lineNumber ?? "?"
      tally(m, type, `${String(rel2?.source ?? "")}|${type}|${String(rel2?.target ?? "")}|${line}`)
    }
  }
  ;(m as any).parsed = parsed; (m as any).failed = failed; (m as any).degraded = degraded
  return m
}

const emittedBefore = await parsePass()

const { indexProjectParallel } = await import("../../../../src/ast/parallel-indexer")
const { BrainDatabase } = await import("../../../../src/brain/database")
const PID = getProjectId(root)
const t0 = Date.now()
await indexProjectParallel(PID as any, root, { skipDiscovery: true, files: chosen.map((rel) => path.join(root, REPO, rel)) } as any)
const indexMs = Date.now() - t0

const emittedAfter = await parsePass()

const raw = await BrainDatabase.getRawInstance(PID as any)
const storedRows = raw.prepare(`SELECT relationship_type AS type, COUNT(*) AS c, COUNT(DISTINCT id) AS ids FROM brain_relationship WHERE project_id = ? GROUP BY relationship_type`).all(PID) as any[]

// WHERE THE EXTRA ROWS COME FROM. A row id is `${sourceId}:${targetName}:${relType}:${relLine}`, so
// two rows can differ only in `sourceId` (or line). If the store holds more distinct
// (source, target, line) triples than the analyzer emitted, then ONE spelled edge has been bound to
// more than one source symbol — inflation in the SOURCE resolution, not in the edges.
const perFile = raw.prepare(`
  SELECT ss.file_id AS fid, COUNT(*) AS rows, COUNT(DISTINCT r.source_symbol_id) AS srcIds,
         COUNT(DISTINCT r.target_external) AS targets, COUNT(DISTINCT r.line_number) AS lines
  FROM brain_relationship r JOIN brain_symbol ss ON ss.id = r.source_symbol_id
  WHERE r.project_id = ? AND r.relationship_type = 'contains'
  GROUP BY ss.file_id ORDER BY rows DESC LIMIT 3`).all(PID) as any[]
const srcAgg = raw.prepare(`
  SELECT COUNT(*) AS rows, COUNT(DISTINCT r.source_symbol_id) AS srcIds,
         COUNT(DISTINCT r.source_symbol_id || '|' || r.target_external || '|' || COALESCE(r.line_number,-1)) AS triples,
         COUNT(DISTINCT r.target_external) AS targets,
         SUM(CASE WHEN r.source_symbol_id IS NULL THEN 1 ELSE 0 END) AS nullSource
  FROM brain_relationship r WHERE r.project_id = ? AND r.relationship_type = 'contains'`).get(PID) as any
const srcExamples = raw.prepare(`
  SELECT ss.name AS src, r.target_external AS tgt, r.line_number AS line, COUNT(*) AS rows,
         COUNT(DISTINCT r.source_symbol_id) AS srcIds
  FROM brain_relationship r JOIN brain_symbol ss ON ss.id = r.source_symbol_id
  WHERE r.project_id = ? AND r.relationship_type = 'contains'
  GROUP BY ss.name, r.target_external, r.line_number HAVING COUNT(*) > 1 ORDER BY rows DESC LIMIT 8`).all(PID) as any[]

// THE HEAVIEST FILE, SIDE BY SIDE: the store's rows for it against the analyzer's edges for the
// same file. A factor of 1.7 has to be visible in one file's pattern or it is not in the rows.
const sideBySide = await (async () => {
  const top = perFile[0]
  if (!top) return null
  const fid = String(top.fid)
  const relPath = fid.startsWith(`${PID}:`) ? fid.slice(String(PID).length + 1) : fid
  const store = raw.prepare(`
    SELECT ss.name AS src, r.target_external AS tgt, r.line_number AS line
    FROM brain_relationship r JOIN brain_symbol ss ON ss.id = r.source_symbol_id
    WHERE r.project_id = ? AND r.relationship_type = 'contains' AND ss.file_id = ?
    ORDER BY r.line_number, ss.name, r.target_external LIMIT 25`).all(PID, fid) as any[]
  let emittedSample: any[] = []
  try {
    const r: any = await parseFile(path.join(root, relPath.includes(REPO + "/") ? relPath : path.join(REPO, relPath)), root, { projectRoot: root } as any)
    emittedSample = (r?.relationships ?? []).filter((x: any) => String(x?.type ?? x?.relationshipType ?? "") === "contains")
      .slice(0, 25).map((x: any) => ({ src: String(x?.source ?? ""), tgt: String(x?.target ?? ""), line: x?.line_number ?? x?.lineNumber ?? null }))
  } catch { /* a file this probe cannot re-parse is reported as an empty sample */ }
  return { file: relPath, storeRowsForFile: Number(top.rows), storeDistinctSrcIds: Number(top.srcIds), storeSample: store, emittedSample, emittedSampleSize: emittedSample.length }
})()

const types = [...new Set([...storedRows.map((r) => String(r.type)), ...emittedBefore.keys(), ...emittedAfter.keys()])]
  .filter((t) => !["parsed", "failed", "degraded"].includes(t)).sort()
const table = types.map((t) => {
  const b = emittedBefore.get(t), a = emittedAfter.get(t), s = storedRows.find((r) => String(r.type) === t)
  return {
    type: t,
    emittedBefore: b?.edges ?? 0, emittedBeforeDistinctKeys: b?.keys.size ?? 0,
    stored: Number(s?.c ?? 0), storedDistinctIds: Number(s?.ids ?? 0),
    emittedAfter: a?.edges ?? 0, emittedAfterDistinctKeys: a?.keys.size ?? 0,
    storedOverEmittedBefore: b?.edges ? Number((Number(s?.c ?? 0) / b.edges).toFixed(3)) : null,
    storedOverEmittedAfter: a?.edges ? Number((Number(s?.c ?? 0) / a.edges).toFixed(3)) : null,
  }
})

const report = {
  instrument: "xml emitted-vs-stored — the 1.83x question, isolated by parsing the same files before AND after the index",
  repo: REPO, files: chosen.length, root, projectId: PID, indexMs,
  parsePasses: { before: { parsed: (emittedBefore as any).parsed, failed: (emittedBefore as any).failed, degraded: (emittedBefore as any).degraded }, after: { parsed: (emittedAfter as any).parsed, failed: (emittedAfter as any).failed, degraded: (emittedAfter as any).degraded } },
  table,
  inflationDiagnosis: { storedContainsSrcAggregate: srcAgg, heaviestFiles: perFile, repeatedSourceTargetLine: srcExamples, sideBySideHeaviestFile: sideBySide },
  reading: {
    "noAnomaly": "stored == emittedBefore == emittedAfter",
    "instrumentOrdering": "stored ~= emittedBefore but emittedAfter is materially lower: the emitted column of the ORIGINAL probe is an undercount caused by parsing after a heavy index in one process",
    "storeWritesMore": "emittedBefore == emittedAfter < stored: the store really holds more rows than the analyzer emits, and the cause is in the indexer, not in the probe",
  },
}
const text = JSON.stringify(report, null, 2)
if (OUT) writeFileSync(OUT, text)
console.log(text)
rmSync(root, { recursive: true, force: true })
rmSync(path.join(homedir(), ".bb", "projects", String(PID)), { recursive: true, force: true })
