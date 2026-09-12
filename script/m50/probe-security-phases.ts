// script/m50/probe-security-phases.ts — M50.A2 residual (bb_security ~1.23s)
//
// Phase attribution and PARITY proof for the security engine's symbol
// resolution. analyzeTaintFlows used to load EVERY symbol row of the project
// (168,629 here) into a Map just to resolve the handful of ids referenced by
// brain_taint_flow endpoints and flow paths. This probe measures both the old
// (full map) and the bounded (only referenced ids) resolutions on the same
// real DB and asserts they agree for every id the engine actually asks about —
// a "faster" that changes a resolution is not a fix.
//
// Writes validation/m50/results/A2-security-phases.json.

import { BrainDatabase } from "../../src/brain/database"
import { getProjectId } from "../../src/cli/index"
import { analyzeTaintFlows } from "../../src/intelligence/security/taint"

const ROOT = "$HOME/mcp/backbencher-brain"
const pid = getProjectId(ROOT) as any

type TaintRow = { source_symbol_id: string | null; sink_symbol_id: string | null; flow_path: string | null }

function parseFlowPath(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter(Boolean).map(String)
  if (typeof value !== "string" || !value) return []
  const trimmed = value.trim()
  try {
    const parsed = JSON.parse(trimmed)
    if (Array.isArray(parsed)) return parsed.filter(Boolean).map(String)
  } catch {}
  if (trimmed.includes("|||")) return trimmed.split("|||").filter(Boolean)
  return trimmed ? [trimmed] : []
}

async function main() {
  const raw = await BrainDatabase.getRawInstance(pid)

  // ── taint rows (the input to resolution) ────────────────────────────────
  const t0 = Date.now()
  const rows = raw
    .prepare(
      "SELECT source_symbol_id, sink_symbol_id, flow_path FROM brain_taint_flow WHERE project_id = ?",
    )
    .all(pid) as TaintRow[]
  const taintRowsMs = Date.now() - t0

  // Every id the engine can ask resolveNode() about.
  const needed = new Set<string>()
  for (const r of rows) {
    if (r.source_symbol_id) needed.add(r.source_symbol_id)
    if (r.sink_symbol_id) needed.add(r.sink_symbol_id)
    for (const id of parseFlowPath(r.flow_path)) needed.add(id)
  }

  // ── OLD: load every symbol into a Map ──────────────────────────────────
  const t1 = Date.now()
  const allRows = raw
    .prepare("SELECT s.id, s.name, s.line_start AS line, f.relative_path AS file FROM brain_symbol s LEFT JOIN brain_file f ON f.id = s.file_id WHERE s.project_id = ?")
    .all(pid) as Array<{ id: string; name: string; line: number; file: string }>
  const allQueryMs = Date.now() - t1
  const t2 = Date.now()
  const oldMap = new Map<string, { name: string; file: string; line: number }>()
  for (const s of allRows) oldMap.set(s.id, { name: s.name, file: s.file, line: s.line })
  const oldBuildMs = Date.now() - t2

  // ── NEW: load only the referenced ids, chunked for SQLite's limit ──────
  const ids = [...needed]
  const t3 = Date.now()
  const bounded = new Map<string, { name: string; file: string; line: number }>()
  const CHUNK = 500
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK)
    const q =
      "SELECT s.id, s.name, s.line_start AS line, f.relative_path AS file FROM brain_symbol s LEFT JOIN brain_file f ON f.id = s.file_id WHERE s.project_id = ? AND s.id IN (" +
      chunk.map(() => "?").join(",") +
      ")"
    for (const s of raw.prepare(q).all(pid, ...chunk) as Array<{ id: string; name: string; line: number; file: string }>) {
      bounded.set(s.id, { name: s.name, file: s.file, line: s.line })
    }
  }
  const boundedQueryMs = Date.now() - t3

  // Parity: for every id the engine resolves, both maps must agree exactly
  // (both presence and the resolved name/file/line), and neither map may hold
  // an id outside the requested set (a bounded map that invents rows is worse).
  let missingInBounded = 0
  let mismatched = 0
  const extraInBounded = [...bounded.keys()].filter((k) => !needed.has(k)).length
  for (const id of ids) {
    const o = oldMap.get(id)
    const n = bounded.get(id)
    if (!!o !== !!n) { missingInBounded++; continue }
    if (o && n && (o.name !== n.name || o.file !== n.file || o.line !== n.line)) mismatched++
  }

  // ── end-to-end engine timing + output digest ───────────────────────────
  const t4 = Date.now()
  const report = await analyzeTaintFlows(pid)
  const engineMs = Date.now() - t4
  const findingKeys = report.findings
    .map((f) => `${f.id}|${f.vulnerabilityType}|${f.state}|${f.file}:${f.line}|${f.symbol ?? ""}`)
    .sort()

  const out = {
    probe: "M50.A2-security-phases",
    at: new Date().toISOString(),
    projectId: pid,
    dbPath: BrainDatabase.getDbPath?.(pid) ?? null,
    phases: {
      taintRowsMs,
      taintRows: rows.length,
      neededSymbolIds: needed.size,
      allSymbolRows: allRows.length,
      allQueryMs,
      oldBuildMs,
      oldTotalMs: allQueryMs + oldBuildMs,
      boundedQueryMs,
      chunks: Math.ceil(ids.length / CHUNK),
    },
    parity: {
      idsChecked: ids.length,
      missingInBounded,
      mismatched,
      extraInBounded,
      equal: missingInBounded === 0 && mismatched === 0 && extraInBounded === 0,
    },
    engine: {
      engineMs,
      findings: report.findings.length,
      summary: report.summary,
      findingKeys,
      digest: findingKeys.join("\n"),
    },
  }
  const fs = await import("node:fs")
  fs.mkdirSync("$HOME/mcp/backbencher-brain/validation/m50/results", { recursive: true })
  const file = "$HOME/mcp/backbencher-brain/validation/m50/results/A2-security-phases.json"
  const prev = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null
  let digestMatch: boolean | null = null
  if (prev?.engine?.digest) digestMatch = prev.engine.digest === out.engine.digest
  const payload = { ...out, prevEngineDigestMatch: digestMatch }
  fs.writeFileSync(file, JSON.stringify(payload, null, 2) + "\n")
  console.log(JSON.stringify({ phases: out.phases, parity: out.parity, engineMs, findings: out.engine.findings, prevEngineDigestMatch: digestMatch }, null, 2))
}
main().catch((e) => { console.error(e?.stack || e); process.exit(1) })
