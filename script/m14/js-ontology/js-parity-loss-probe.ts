#!/usr/bin/env bun
/**
 * JAVASCRIPT lane — DOES THE IN-EDGE REPAIR PASS COVER THE ROWS THE STORE DELETES?
 *
 * `verify-store-path-parity.ts` (the gate) measures the DEFECT: after every file
 * is re-indexed through `reindexFilesParallel`, part of the stored graph exists
 * nowhere — a consumer's graph depends on HOW the code was indexed.
 *
 * This probe measures the CONTRACT. The store deletes two populations whenever a
 * file is re-stored (`storeResults`):
 *
 *   deleteFileRelationships           rows whose SOURCE symbol is in that file
 *   deleteFileRelationshipsByTarget   rows whose TARGET symbol is in that file,
 *                                     INCLUDING rows owned by OTHER files
 *
 * The second population is the dangerous one: the re-parsed file cannot re-emit
 * an edge that belongs to another file, so `snapshotInEdges` + `repairInEdges`
 * exist to copy it forward. This probe re-indexes the draw ONE FILE AT A TIME and,
 * for every row that actually vanishes, evaluates the snapshot's predicates on the
 * row BEFORE it is deleted:
 *
 *   r.target_external IS NOT NULL AND != ''      (the repair needs a name to re-resolve)
 *   r.source_symbol_id NOT IN (SELECT id FROM brain_symbol WHERE file_id IN (chunk))
 *
 * and then whether a repaired row exists AFTER the run. Every vanishing row is
 * therefore classified by the exact predicate that failed, which is the difference
 * between "the repair has a bug" and "the deletion has no repair for this class".
 *
 * Usage: bun run script/m14/js-ontology/js-parity-loss-probe.ts [--files=12] [--corpus=<dir>]
 */
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3)
const FILES = Number(arg("files") ?? "12")
const CORPUS = arg("corpus") ?? "$HOME/fixtures/repositories/svelte"
const JS_EXTS = /\.(js|mjs|cjs)$/

function admitted(): string[] {
  const tracked = execFileSync("git", ["-C", CORPUS, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 1 << 28 })
    .split("\0").filter(Boolean)
  const out: string[] = []
  for (const rel of tracked.sort()) {
    if (!JS_EXTS.test(rel)) continue
    const abs = path.join(CORPUS, rel)
    try { if (fs.statSync(abs).size > 512 * 1024) continue } catch { continue }
    out.push(abs)
  }
  return out
}

type Row = {
  id: string
  type: string
  src: string | null
  tgt: string | null
  target: string | null
  line: number | null
  srcSym: string | null
}

async function main() {
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-js-loss-"))
  const projDir = path.join(workdir, "proj")
  fs.mkdirSync(projDir, { recursive: true })
  const taken = admitted().slice(0, FILES)
  const copied: string[] = []
  for (const f of taken) {
    const rel = path.relative(CORPUS, f)
    const dest = path.join(projDir, rel)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.writeFileSync(dest, fs.readFileSync(f))
    copied.push(dest)
  }
  const dataDir = path.join(workdir, "data")
  fs.mkdirSync(dataDir, { recursive: true })
  process.env.BB_DATA_DIR = dataDir

  const { getProjectId } = await import(path.join(ROOT, "src/cli/index.ts"))
  const { indexProjectParallel, reindexFilesParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer.ts"))
  const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database.ts"))
  const pid = getProjectId(projDir) as any
  const raw: any = await BrainDatabase.getRawInstance(pid)
  const q = (sql: string, ...a: any[]) => raw.prepare(sql).all(...a) as any[]

  console.log(`js in-edge repair contract probe: one file at a time`)
  console.log(`corpus: ${CORPUS}`)
  console.log(`files:  ${copied.length}\n`)

  await indexProjectParallel(pid, projDir, { onProgress: () => {} })

  const row = (r: any): Row => ({
    id: String(r.id), type: String(r.t), src: r.src ?? null, tgt: r.tgt ?? null,
    target: r.target ? String(r.target) : null, line: r.line === null ? null : Number(r.line),
    srcSym: r.srcSym ? String(r.srcSym) : null,
  })
  const snapshotAll = (): Map<string, Row> =>
    new Map((q(`SELECT id, relationship_type AS t, source_external AS src, target_external AS tgt,
                  target_symbol_id AS target, line_number AS line, source_symbol_id AS srcSym
             FROM brain_relationship WHERE project_id = ?`, pid) as any[]).map((r) => [String(r.id), row(r)]))

  const total = { vanished: 0, captured: 0, repairedUnderOtherId: 0, lost: 0 }
  const byEscape: Record<string, number> = {}
  const byType: Record<string, number> = {}
  const examples: string[] = []
  let prev = snapshotAll()
  console.log(`full index: ${prev.size} rows\n`)

  for (const f of copied) {
    const rel = path.relative(projDir, f)
    const fileId = `${pid}:${rel}`
    // The store's own deletion criterion, verbatim: rows whose TARGET symbol
    // lives in this file, less the rows this file owns (it re-emits those).
    const candidates = (q(`SELECT r.id AS id, r.relationship_type AS t, r.source_external AS src,
                                  r.target_external AS tgt, r.target_symbol_id AS target,
                                  r.line_number AS line, r.source_symbol_id AS srcSym
                             FROM brain_relationship r JOIN brain_symbol t ON t.id = r.target_symbol_id
                            WHERE r.project_id = ? AND t.file_id = ?
                              AND (r.source_symbol_id IS NULL
                                   OR r.source_symbol_id NOT IN (SELECT id FROM brain_symbol WHERE file_id = ?))`,
      pid, fileId, fileId) as any[]).map(row)

    const rr = await reindexFilesParallel(pid, projDir, [{ path: f, type: "modified" as const }], {
      logger: { log: () => {}, write: () => {} },
    })
    const next = snapshotAll()
    let vanishedHere = 0
    const lostHere: string[] = []
    for (const c of candidates) {
      if (next.has(c.id)) continue
      vanishedHere++
      total.vanished++
      byType[c.type] = (byType[c.type] ?? 0) + 1
      // Did the repair copy the edge forward under its own `${src}:${type}:${target}:${line}:m40` id?
      const m40 = c.srcSym
        ? `${c.srcSym}:${c.type}:${c.tgt}:${c.line ?? 0}:m40`
        : null
      const repaired = m40 !== null && next.has(m40)
      // Would the snapshot's predicates have captured this row at all?
      const sourceIsNull = c.srcSym === null
      const noTargetName = c.tgt === null || c.tgt === ""
      const escape = sourceIsNull
        ? "ESCAPES snapshot (source_symbol_id IS NULL: NOT IN is NULL-false)"
        : noTargetName
          ? "ESCAPES snapshot (target_external NULL/empty)"
          : null
      if (escape === null && repaired) total.repairedUnderOtherId++
      else if (escape === null) {
        total.captured++
        byEscape["captured by snapshot but NOT repaired"] = (byEscape["captured by snapshot but NOT repaired"] ?? 0) + 1
      } else {
        total.lost++
        byEscape[escape] = (byEscape[escape] ?? 0) + 1
      }
      if (escape !== null && lostHere.length < 6) {
        lostHere.push(`${c.type} srcSym=${c.srcSym ? "set" : "NULL"} src=${c.src ?? "NULL"} -> ${c.tgt ?? "NULL"} line=${c.line ?? "?"}`)
      }
      if (escape !== null && examples.length < 12) examples.push(`${rel}  ${escape}\n      ${c.type} ${c.id}`)
    }
    if (vanishedHere) {
      console.log(`  ${rel}: ${candidates.length} inbound rows, ${vanishedHere} VANISHED (repairedInEdges=${rr.derived?.repairedInEdges ?? "?"})`)
      for (const l of lostHere) console.log(`      gone: ${l}`)
    }
    prev = next
  }

  console.log(`\ntotals: ${JSON.stringify(total)}`)
  console.log(`escapes: ${JSON.stringify(byEscape, null, 2)}`)
  console.log(`vanished by type: ${JSON.stringify(byType)}`)
  console.log(`examples:`)
  for (const e of examples) console.log(`  ${e}`)
}

await main()
