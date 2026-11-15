// ─────────────────────────────────────────────────────────────────────────────
// M72 — persisted store for the spec-driven security engine (`brain_security_flow`).
//
// WHAT THIS FILE IS — the only writer and the shared reader of the new security
// lead table. It owns four things and nothing else:
//   1. the row shape and the STABLE row id (`sec:<projectId>:<fileId>:<ruleId>:<byteStart>:<byteEnd>`),
//      which must not embed line numbers so a row survives a line move;
//   2. per-file deletion — every file store/delete clears this file's leads
//      BEFORE the new rows are inserted, so an edit that REMOVES a lead cannot
//      leave the old row behind (the defect the legacy writer had);
//   3. the lead → row mapping, including the two pipeline exclusions: test files
//      (`is_test_file = 1`) and languages with no spec are never persisted;
//   4. a read that degrades honestly when the table does not exist yet (a
//      read-only open never runs DDL), returning `initialized: false` with the
//      actionable message instead of throwing at the handler.
//
// WHICH TOOL IT SERVES — bb_security, through the pipeline (src/ast/pool-worker.ts
//   produces the leads, src/ast/parallel-indexer.ts persists them) and the answer
//   surface (src/mcp/tools/bb_security/handler.ts reads them).
// WHERE ITS EVIDENCE LIVES — docs/m72-security-rebuild/PLAN.md §2 Phase 1,
//   script/m72/store/run.ts (delete-on-reindex proof), validation/m72/**.
// EDIT TOGETHER WHEN THIS CHANGES — src/brain/schema-ddl.ts (DDL),
//   src/brain/brain.sql.ts (drizzle mirror), src/ast/parallel-indexer.ts (delete +
//   insert call sites), src/intelligence/security/rebuild/spec-types.ts.
// CONTRACTS IT MUST NOT BREAK — ids are line-number-free; a file's rows are
//   deleted on every store/delete before insert; test files and no-spec languages
//   are skipped; the legacy `brain_taint_flow` is never written from this module;
//   a missing table is a declared uninitialized state, never a crash.
// ─────────────────────────────────────────────────────────────────────────────

import { SECURITY_FLOW_DDL, ensureSecurityFlowTable } from "../../../brain/schema-ddl"
import { specForLanguage } from "./specs/index"
import type { SecurityLead, SecurityTier, SecurityVulnerability } from "./spec-types"

/** The exact message a reader reports when the table has not been created yet. */
export const SECURITY_FLOW_SETUP_HINT = "security engine not initialized; run bb index --post"

/**
 * Rollback switch for the retired token-coverage detector.
 *
 * The default (`unset`) path writes ONLY the spec engine's leads. `BB_SECURITY_LEGACY=1`
 * re-enables the old `brain_taint_flow` token cross-product and the old
 * cross-symbol stitching so an operator can compare/roll back one release
 * without reverting code. It is NOT a supported mode: the new table stays the
 * only store bb_security reads.
 */
export const SECURITY_LEGACY_ENV = "BB_SECURITY_LEGACY"

export function securityLegacyEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[SECURITY_LEGACY_ENV] === "1"
}

/** The table this module owns. Kept as a constant so no caller re-spells it. */
export const SECURITY_FLOW_TABLE = "brain_security_flow"

/** Lead lifecycle states persisted by Phase 1 (no `mitigated` row is emitted yet). */
export type SecurityFlowState = "lead" | "candidate" | "mitigated"

/** One persisted row, exactly as the DDL declares it. */
export interface SecurityFlowRow {
  id: string
  project_id: string
  file_id: string
  source_symbol_id: string | null
  sink_symbol_id: string | null
  vulnerability_type: string
  severity: string
  state: SecurityFlowState
  tier: SecurityTier
  rule_id: string
  source_line: number | null
  sink_line: number | null
  /** JSON string; the engine's evidence object plus the store's join context. */
  evidence: string
  time_created: number
  time_updated: number
}

/**
 * Stable id — line-number-free by contract.
 *
 * `byteStart`/`byteEnd` are the SINK token's offsets RELATIVE TO THE SYMBOL BODY
 * (the engine's own coordinate system; see spec-types.ts TokenMatch). They move
 * only when the matched text moves inside its function, not when the function
 * moves down the file, which is what "stable across a line move" means here.
 * `fileId` already includes the project id in the pipeline, so the leading
 * `projectId` is belt-and-braces: it keeps the id self-describing from the row
 * (`sec:` prefix) and cannot collide across projects.
 */
export function securityFlowId(
  projectId: string,
  fileId: string,
  ruleId: string,
  byteStart: number,
  byteEnd: number,
): string {
  return `sec:${projectId}:${fileId}:${ruleId}:${byteStart}:${byteEnd}`
}

/** Prepared statements the write path prepares ONCE and reuses per file. */
export interface SecurityFlowStatements {
  /** Deletes every row this file owns, as a source OR as a sink endpoint. */
  deleteForFile: any
  insert: any
}

/**
 * Everything the pipeline knows about the symbol that produced the leads.
 * `fileId`/`symbolId` are the STORED ids (parallel-indexer's own); the engine
 * never derives them.
 */
export interface SecurityFlowContext {
  projectId: string
  fileId: string
  /** Project-relative path, for the evidence object a reader renders. */
  relativePath: string
  /** Stored symbol id (`<fileId>:<name>:<line>`) of the producing symbol. */
  symbolId: string
  /** One-based line of the symbol declaration; used to make the stored lines absolute. */
  symbolStartLine: number
  /** File language id, as stored on brain_file. */
  language: string
  /** `brain_file.is_test_file === 1`; test files are never persisted. */
  isTestFile: boolean
}

/**
 * The DDL, re-exported so the write path creates the table before preparing the
 * statements that need it (a pre-existing database never ran the new DDL).
 */
export function ensureSecurityFlowStore(raw: any): void {
  ensureSecurityFlowTable(raw)
}

/** Re-exported for gates that assert the reader's message is this exact text. */
export { SECURITY_FLOW_DDL }

/**
 * Prepare the write statements. The table is created first, so a pre-existing
 * database that has never seen M72 still gets ONE writable open that can store
 * leads (the same additive-migration rule as the column migrations: the DB every
 * editor opens is a pre-existing one).
 */
export function prepareSecurityFlowStatements(raw: any): SecurityFlowStatements {
  ensureSecurityFlowTable(raw)
  return {
    // Project-scoped, and covers the three ways a row belongs to this file:
    //   - it was produced BY a symbol in this file (file_id / source_symbol_id),
    //   - it was produced BY any symbol of this file (sink_symbol_id — the engine
    //     is intra-symbol, but the delete must not depend on that staying true).
    // The symbol subqueries are resolved BEFORE the caller deletes brain_symbol
    // rows, which is why the pipeline orders this delete first.
    deleteForFile: raw.prepare(
      `DELETE FROM ${SECURITY_FLOW_TABLE}
        WHERE project_id = ?
          AND (file_id = ?
               OR source_symbol_id IN (SELECT id FROM brain_symbol WHERE file_id = ?)
               OR sink_symbol_id IN (SELECT id FROM brain_symbol WHERE file_id = ?))`,
    ),
    insert: raw.prepare(
      `INSERT OR REPLACE INTO ${SECURITY_FLOW_TABLE}
        (id, project_id, file_id, source_symbol_id, sink_symbol_id, vulnerability_type, severity,
         state, tier, rule_id, source_line, sink_line, evidence, time_created, time_updated)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
  }
}

/** Convenience for delete-only paths (stale-file cleanup, purge, deleted files). */
export function deleteSecurityFlowsForFile(raw: any, projectId: string, fileId: string): number {
  try {
    const stmt = raw.prepare(
      `DELETE FROM ${SECURITY_FLOW_TABLE}
        WHERE project_id = ?
          AND (file_id = ?
               OR source_symbol_id IN (SELECT id FROM brain_symbol WHERE file_id = ?)
               OR sink_symbol_id IN (SELECT id FROM brain_symbol WHERE file_id = ?))`,
    )
    return stmt.run(projectId, fileId, fileId, fileId)?.changes ?? 0
  } catch {
    // A database that has never been opened writable with M72 code has no table.
    // Deleting from it is a no-op, not a failure — the rows cannot exist.
    return 0
  }
}

/** Why a lead was dropped before persistence; the store never silently drops. */
export type SecurityLeadSkipReason = "test_file" | "no_spec" | "unsupported_tier" | "malformed"

export interface SecurityFlowMapping {
  row: SecurityFlowRow | null
  skipped?: SecurityLeadSkipReason
}

/** Absolute (file) line from a symbol-relative one; null when unknown. */
function absoluteLine(symbolStartLine: number, relativeLine: number | undefined | null): number | null {
  if (typeof relativeLine !== "number" || !Number.isFinite(relativeLine) || relativeLine < 1) return null
  if (!Number.isFinite(symbolStartLine) || symbolStartLine < 1) return null
  return symbolStartLine + Math.floor(relativeLine) - 1
}

/**
 * Map one engine lead to one row.
 *
 * Returns `{ row: null, skipped }` for the two contract exclusions (test file,
 * no spec / unsupported language) and for a malformed lead. Nothing is invented:
 * a lead whose evidence lacks a sink token is dropped as `malformed` rather than
 * stored with made-up offsets (the id would otherwise be non-reproducible).
 */
export function securityLeadToRow(
  lead: SecurityLead,
  context: SecurityFlowContext,
  now: number,
): SecurityFlowMapping {
  if (context.isTestFile) return { row: null, skipped: "test_file" }

  const spec = specForLanguage(context.language)
  if (!spec) return { row: null, skipped: "no_spec" }
  if (spec.tier === "unsupported") return { row: null, skipped: "unsupported_tier" }

  const evidence = lead?.evidence
  const sink = evidence?.sink
  if (!sink || typeof sink.byteStart !== "number" || typeof sink.byteEnd !== "number") {
    return { row: null, skipped: "malformed" }
  }
  if (typeof lead.ruleId !== "string" || lead.ruleId.length === 0) {
    return { row: null, skipped: "malformed" }
  }

  const sourceLine = absoluteLine(context.symbolStartLine, evidence.source?.line)
  const sinkLine = absoluteLine(context.symbolStartLine, sink.line)
  const id = securityFlowId(context.projectId, context.fileId, lead.ruleId, sink.byteStart, sink.byteEnd)

  // Evidence is JSON-serializable by contract (spec-types.ts). The store adds the
  // join context a reader would otherwise re-derive from brain_symbol/brain_file:
  // the stored symbol id, the file language, and the ABSOLUTE lines — while the
  // engine's symbol-relative coordinates stay untouched under `source`/`sink`.
  const persistedEvidence = {
    ...evidence,
    store: {
      language: context.language,
      tier: lead.tier,
      file: context.relativePath,
      symbolId: context.symbolId,
      symbolStartLine: context.symbolStartLine,
      sourceLine,
      sinkLine,
    },
  }

  return {
    row: {
      id,
      project_id: context.projectId,
      file_id: context.fileId,
      // The Phase-1 engine is intra-symbol: the source and the sink are in the
      // same symbol, and both columns name that symbol's stored id so a reader
      // can join either side. Null would be dishonest — the lead is not
      // cross-symbol, and the row should not look like an unresolved flow.
      source_symbol_id: context.symbolId || null,
      sink_symbol_id: context.symbolId || null,
      vulnerability_type: String(lead.vulnerability),
      severity: String(lead.severity),
      state: lead.state === "candidate" ? "candidate" : "lead",
      tier: lead.tier,
      rule_id: lead.ruleId,
      source_line: sourceLine,
      sink_line: sinkLine,
      evidence: JSON.stringify(persistedEvidence),
      time_created: now,
      time_updated: now,
    },
  }
}

export interface PersistSecurityFlowResult {
  inserted: number
  skipped: Partial<Record<SecurityLeadSkipReason, number>>
}

/**
 * Persist a symbol's leads. The CALLER must have deleted this file's rows first
 * (see `prepareSecurityFlowStatements().deleteForFile`); this function only
 * inserts, so an ordering mistake shows up as leftover rows in the verify script
 * rather than being hidden here.
 */
export function persistSecurityLeads(
  statements: SecurityFlowStatements,
  context: SecurityFlowContext,
  leads: ReadonlyArray<SecurityLead> | undefined | null,
  now: number = Date.now(),
): PersistSecurityFlowResult {
  const result: PersistSecurityFlowResult = { inserted: 0, skipped: {} }
  if (!Array.isArray(leads) || leads.length === 0) return result
  for (const lead of leads) {
    const mapping = securityLeadToRow(lead, context, now)
    if (!mapping.row) {
      const reason = mapping.skipped ?? "malformed"
      result.skipped[reason] = (result.skipped[reason] ?? 0) + 1
      continue
    }
    const row = mapping.row
    statements.insert.run(
      row.id,
      row.project_id,
      row.file_id,
      row.source_symbol_id,
      row.sink_symbol_id,
      row.vulnerability_type,
      row.severity,
      row.state,
      row.tier,
      row.rule_id,
      row.source_line,
      row.sink_line,
      row.evidence,
      row.time_created,
      row.time_updated,
    )
    result.inserted++
  }
  return result
}

// ─────────────────────────────────────────────────────────────────────────────
// READ SIDE
// ─────────────────────────────────────────────────────────────────────────────

/** True when this database has the M72 table (a missing table is not an error). */
export function securityFlowTableExists(raw: any): boolean {
  try {
    return Boolean(
      raw.prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?").get(SECURITY_FLOW_TABLE),
    )
  } catch {
    return false
  }
}

/** One row as a reader consumes it: parsed evidence + resolved symbol/file labels. */
export interface SecurityFlowView {
  id: string
  projectId: string
  file: string | null
  fileId: string
  sourceSymbolId: string | null
  sinkSymbolId: string | null
  symbolName: string | null
  language: string | null
  vulnerabilityType: SecurityVulnerability | string
  severity: string
  state: SecurityFlowState
  tier: SecurityTier | string
  ruleId: string
  sourceLine: number | null
  sinkLine: number | null
  /** Parsed evidence object, or null when the column is not valid JSON. */
  evidence: unknown
  timeCreated: number
}

export interface SecurityFlowReadOptions {
  limit?: number
  offset?: number
  /** Restrict to one tier (`leads` today). Omitted reads every tier. */
  tier?: SecurityTier
  /** Restrict to one state (`lead`/`candidate`/`mitigated`). */
  state?: SecurityFlowState
}

export interface SecurityFlowReadResult {
  /** False with `message` when the table does not exist yet — never throws. */
  initialized: boolean
  message?: string
  rows: SecurityFlowView[]
  /** Pre-page census for the applied filters. */
  total: number
  limit: number
  offset: number
  truncated: boolean
}

const DEFAULT_READ_LIMIT = 200

/**
 * Read this project's leads. A read-only handle never runs DDL, so on an index
 * created before M72 (or on a project that has never been written by M72 code)
 * the table is absent — that is a declared `initialized: false` state, not a
 * crash and not a clean zero.
 */
export function readSecurityFlows(
  raw: any,
  projectId: string,
  options: SecurityFlowReadOptions = {},
): SecurityFlowReadResult {
  const limit = Math.max(1, Math.floor(options.limit ?? DEFAULT_READ_LIMIT))
  const offset = Math.max(0, Math.floor(options.offset ?? 0))

  if (!securityFlowTableExists(raw)) {
    return {
      initialized: false,
      message: SECURITY_FLOW_SETUP_HINT,
      rows: [],
      total: 0,
      limit,
      offset,
      truncated: false,
    }
  }

  const where: string[] = ["f.project_id = ?"]
  const params: unknown[] = [projectId]
  if (options.tier) {
    where.push("f.tier = ?")
    params.push(options.tier)
  }
  if (options.state) {
    where.push("f.state = ?")
    params.push(options.state)
  }
  const whereSql = where.join(" AND ")

  try {
    const totalRow = raw
      .prepare(`SELECT COUNT(*) AS c FROM ${SECURITY_FLOW_TABLE} f WHERE ${whereSql}`)
      .get(...params) as { c?: number } | undefined
    const total = Number(totalRow?.c ?? 0)

    const rows = raw
      .prepare(
        `SELECT f.id, f.project_id, f.file_id, f.source_symbol_id, f.sink_symbol_id,
                f.vulnerability_type, f.severity, f.state, f.tier, f.rule_id,
                f.source_line, f.sink_line, f.evidence, f.time_created,
                bf.relative_path AS rel_path, bf.language AS language, bs.name AS symbol_name
           FROM ${SECURITY_FLOW_TABLE} f
           LEFT JOIN brain_file bf ON bf.id = f.file_id
           LEFT JOIN brain_symbol bs ON bs.id = f.sink_symbol_id
          WHERE ${whereSql}
          ORDER BY f.id
          LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as any[]

    return {
      initialized: true,
      rows: rows.map((row: any) => ({
        id: String(row.id),
        projectId: String(row.project_id),
        file: row.rel_path ?? null,
        fileId: String(row.file_id ?? ""),
        sourceSymbolId: row.source_symbol_id ?? null,
        sinkSymbolId: row.sink_symbol_id ?? null,
        symbolName: row.symbol_name ?? null,
        language: row.language ?? null,
        vulnerabilityType: row.vulnerability_type,
        severity: row.severity,
        state: row.state,
        tier: row.tier,
        ruleId: row.rule_id,
        sourceLine: row.source_line ?? null,
        sinkLine: row.sink_line ?? null,
        evidence: parseEvidence(row.evidence),
        timeCreated: Number(row.time_created ?? 0),
      })),
      total,
      limit,
      offset,
      truncated: offset + rows.length < total,
    }
  } catch (error) {
    // A table that exists but cannot be read (corrupt JSON, missing column on a
    // partially-migrated DB) is still not a handler crash: declare it.
    return {
      initialized: false,
      message: `${SECURITY_FLOW_SETUP_HINT} (read failed: ${(error as Error)?.message ?? String(error)})`,
      rows: [],
      total: 0,
      limit,
      offset,
      truncated: false,
    }
  }
}

function parseEvidence(value: unknown): unknown {
  if (typeof value !== "string" || value.length === 0) return null
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ENGINE ADAPTER
//
// The pipeline (src/ast/pool-worker.ts) must attach engine leads WITHOUT making
// the whole indexer depend on the engine module existing: the engine is a
// separate workstream and, until it lands, the default pipeline has no security
// output at all (legacy is gated off) — which is the honest state, not a crash.
// The adapter is deliberately narrow: one optional function, structural typing,
// no import of engine internals. `engine.ts` is loaded lazily by a NON-LITERAL
// specifier so a tree without it still typechecks and a runtime without it
// safely no-ops. Once `engine.ts` is present in the tree, the pool-worker call
// site uses the static import and this loader is only the safety net.
// ─────────────────────────────────────────────────────────────────────────────

/** The engine's per-symbol input (matches engine-core's frozen `AnalyzeSymbolInput`). */
export interface SecurityEngineSymbolInput {
  /** File language id; the engine normalises case and registry aliases. */
  language: string
  /** The symbol BODY ONLY — `content.slice(range.startIndex, range.endIndex)`. */
  source: string
  /** Path echoed onto the lead; the pipeline overrides ids at insert time. */
  file?: string
  /** Stored symbol id is NOT known in the worker; the store maps it at insert. */
  symbolId?: string
  /** One-based declaration line, echoed for evidence/tests. */
  symbolLine?: number
}

/** The narrow shape the pipeline depends on. */
export interface SecurityEngineAdapter {
  analyzeSymbol(input: SecurityEngineSymbolInput): SecurityLead[]
  analysisSpecFor?: (language: string) => unknown | null
  engineVersion?: string
}

/**
 * Resolve an installed engine or `null`.
 *
 * `null` means "no engine in this tree/at this path": every caller must treat it
 * as a declared absence (write no leads) rather than an error. The specifier is
 * a variable on purpose — see the block comment above.
 */
export async function loadSecurityEngine(): Promise<SecurityEngineAdapter | null> {
  const engineModuleSpecifier = "./engine"
  try {
    const mod = (await import(engineModuleSpecifier)) as Partial<SecurityEngineAdapter>
    if (typeof mod.analyzeSymbol !== "function") return null
    return {
      analyzeSymbol: mod.analyzeSymbol,
      analysisSpecFor: typeof mod.analysisSpecFor === "function" ? mod.analysisSpecFor : undefined,
      engineVersion: typeof mod.engineVersion === "string" ? mod.engineVersion : undefined,
    }
  } catch {
    return null
  }
}
