import { createHash, randomUUID } from "node:crypto"
import { BrainDatabase } from "../../brain/database"
import type { ProjectID } from "../../project/schema"
import type {
  AnalysisFindingInput,
  AnalysisFindingRecord,
  AnalysisFindingState,
  AnalysisHistoryReport,
  AnalysisRunInput,
  AnalysisRunKind,
  AnalysisRunRecord,
  AnalysisRunReport,
  AnalysisRunStatus,
} from "../contracts"

const ENGINE_VERSION = "m10.04"
const STATES: AnalysisFindingState[] = ["open", "resolved", "suppressed", "reopened", "mitigated", "stale"]
const STATE_ORDER: Record<AnalysisFindingState, number> = { open: 0, reopened: 1, mitigated: 2, stale: 3, suppressed: 4, resolved: 5 }

function now(): number { return Date.now() }
function json(value: unknown): string { return JSON.stringify(value ?? null) }
function parseJson(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (typeof value !== "string") return []
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : [] } catch { return [] }
}
function parseJsonStringArray(value: unknown): string[] {
  const list = parseJson(value)
  return list.filter((item): item is string => typeof item === "string")
}
function hash(value: unknown): string { return createHash("sha256").update(json(value)).digest("hex") }
function stateOf(value: unknown): AnalysisFindingState {
  return typeof value === "string" && STATES.includes(value as AnalysisFindingState) ? value as AnalysisFindingState : "open"
}

function ensureColumn(raw: any, table: string, name: string, ddl: string): void {
  const columns = raw.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  if (columns.some((col) => col.name === name)) return
  raw.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${ddl}`)
}

function ensureHistorySchema(raw: any): void {
  raw.exec(`
    CREATE TABLE IF NOT EXISTS brain_analysis_run (
      id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL, kind TEXT NOT NULL,
      status TEXT NOT NULL, engine_version TEXT NOT NULL, input_hash TEXT NOT NULL,
      started_at INTEGER NOT NULL, completed_at INTEGER, finding_count INTEGER NOT NULL DEFAULT 0,
      error TEXT, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS brain_analysis_finding (
      id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL, kind TEXT NOT NULL,
      fingerprint TEXT NOT NULL, rule TEXT NOT NULL, title TEXT NOT NULL, severity TEXT NOT NULL,
      state TEXT NOT NULL, confidence REAL, evidence TEXT,
      location TEXT, limitations TEXT, evidence_class TEXT, engine TEXT, engine_version TEXT,
      first_seen_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL, resolved_at INTEGER, suppressed_at INTEGER, mitigated_at INTEGER,
      occurrence_count INTEGER NOT NULL DEFAULT 0, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS brain_analysis_occurrence (
      id TEXT PRIMARY KEY NOT NULL, finding_id TEXT NOT NULL, run_id TEXT NOT NULL, state TEXT NOT NULL,
      location TEXT, evidence TEXT, limitations TEXT, evidence_class TEXT, engine TEXT, engine_version TEXT,
      observed_at INTEGER NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS brain_analysis_finding_identity_idx ON brain_analysis_finding(project_id, kind, fingerprint);
    CREATE INDEX IF NOT EXISTS brain_analysis_run_project_idx ON brain_analysis_run(project_id);
    CREATE INDEX IF NOT EXISTS brain_analysis_run_kind_idx ON brain_analysis_run(kind);
    CREATE INDEX IF NOT EXISTS brain_analysis_run_started_idx ON brain_analysis_run(started_at);
    CREATE INDEX IF NOT EXISTS brain_analysis_finding_project_idx ON brain_analysis_finding(project_id);
    CREATE INDEX IF NOT EXISTS brain_analysis_finding_state_idx ON brain_analysis_finding(project_id, state);
    CREATE INDEX IF NOT EXISTS brain_analysis_occurrence_finding_idx ON brain_analysis_occurrence(finding_id);
    CREATE INDEX IF NOT EXISTS brain_analysis_occurrence_run_idx ON brain_analysis_occurrence(run_id);
  `)
  ensureColumn(raw, "brain_analysis_finding", "location", "TEXT")
  ensureColumn(raw, "brain_analysis_finding", "limitations", "TEXT")
  ensureColumn(raw, "brain_analysis_finding", "evidence_class", "TEXT")
  ensureColumn(raw, "brain_analysis_finding", "engine", "TEXT")
  ensureColumn(raw, "brain_analysis_finding", "engine_version", "TEXT")
  ensureColumn(raw, "brain_analysis_occurrence", "limitations", "TEXT")
  ensureColumn(raw, "brain_analysis_occurrence", "evidence_class", "TEXT")
  ensureColumn(raw, "brain_analysis_occurrence", "engine", "TEXT")
  ensureColumn(raw, "brain_analysis_occurrence", "engine_version", "TEXT")
}

export function fingerprintFinding(kind: string, input: AnalysisFindingInput): string {
  return input.fingerprint ?? hash({ kind, rule: input.rule, title: input.title, location: input.location ?? null, evidence: input.evidence ?? [], limitations: input.limitations ?? [], evidenceClass: input.evidenceClass ?? null, engine: input.engine ?? null, engineVersion: input.engineVersion ?? null })
}

function readRun(row: any): AnalysisRunRecord {
  return { id: row.id, projectId: row.project_id, kind: row.kind, status: row.status, engineVersion: row.engine_version, inputHash: row.input_hash, startedAt: row.started_at, completedAt: row.completed_at ?? null, findingCount: row.finding_count, error: row.error ?? null }
}
function readFinding(row: any): AnalysisFindingRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    kind: row.kind,
    fingerprint: row.fingerprint,
    rule: row.rule,
    title: row.title,
    severity: row.severity,
    state: stateOf(row.state),
    confidence: row.confidence ?? null,
    evidence: parseJson(row.evidence),
    location: row.location ?? null,
    limitations: parseJsonStringArray(row.limitations),
    evidenceClass: row.evidence_class ?? null,
    engine: row.engine ?? null,
    engineVersion: row.engine_version ?? null,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    resolvedAt: row.resolved_at ?? null,
    suppressedAt: row.suppressed_at ?? null,
    mitigatedAt: row.mitigated_at ?? null,
    occurrenceCount: row.occurrence_count,
  }
}

function orderedFindings(rows: any[]): AnalysisFindingRecord[] {
  return rows
    .map(readFinding)
    .sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || b.lastSeenAt - a.lastSeenAt || a.fingerprint.localeCompare(b.fingerprint))
}

export async function startAnalysisRun(input: AnalysisRunInput): Promise<AnalysisRunRecord> {
  const raw = await BrainDatabase.getRawInstance(input.projectId)
  ensureHistorySchema(raw)
  const timestamp = now()
  const id = randomUUID()
  raw.prepare(`INSERT INTO brain_analysis_run (id,project_id,kind,status,engine_version,input_hash,started_at,finding_count,time_created,time_updated) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(id, input.projectId, input.kind, "running", input.engineVersion ?? ENGINE_VERSION, hash(input.input ?? {}), timestamp, 0, timestamp, timestamp)
  return readRun(raw.prepare("SELECT * FROM brain_analysis_run WHERE id=?").get(id))
}

export async function completeAnalysisRun(projectId: string, runId: string, findings: AnalysisFindingInput[], options: { retentionDays?: number; incremental?: boolean; touchedFingerprints?: string[] } = {}): Promise<AnalysisRunReport> {
  const raw = await BrainDatabase.getRawInstance(projectId)
  ensureHistorySchema(raw)
  const timestamp = now()
  const report: AnalysisRunReport = { run: {} as AnalysisRunRecord, findings: [], newFindings: 0, repeatedFindings: 0, resolvedFindings: 0, reopenedFindings: 0, staleFindings: 0, orderedFindings: [] }
  const finish = raw.transaction(() => {
    const run = raw.prepare("SELECT * FROM brain_analysis_run WHERE id=? AND project_id=?").get(runId, projectId) as any
    if (!run) throw new Error(`analysis run not found: ${runId}`)
    if (run.status !== "running") throw new Error(`analysis run is not running: ${runId} (status=${run.status})`)
    const runEngineVersion = run.engine_version
    const seen = new Set<string>()
    for (const input of findings) {
      const fingerprint = fingerprintFinding(run.kind, input)
      if (seen.has(fingerprint)) continue
      seen.add(fingerprint)
      const evidenceClass = input.evidenceClass ?? null
      const engine = input.engine ?? null
      const engineVersion = input.engineVersion ?? runEngineVersion
      const limitations = input.limitations ?? []
      const existing = raw.prepare("SELECT * FROM brain_analysis_finding WHERE project_id=? AND kind=? AND fingerprint=?").get(projectId, run.kind, fingerprint) as any
      const priorState = existing ? stateOf(existing.state) : null
      const nextState = input.state ? stateOf(input.state) : (priorState === "resolved" || priorState === "stale" ? "reopened" : priorState === "suppressed" || priorState === "mitigated" ? priorState : "open")
      let findingId: string
      if (!existing) {
        findingId = randomUUID()
        raw.prepare(`INSERT INTO brain_analysis_finding (id,project_id,kind,fingerprint,rule,title,severity,state,confidence,evidence,location,limitations,evidence_class,engine,engine_version,first_seen_at,last_seen_at,occurrence_count,time_created,time_updated) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(findingId, projectId, run.kind, fingerprint, input.rule, input.title, input.severity, nextState, input.confidence ?? null, json(input.evidence), input.location ?? null, json(limitations), evidenceClass, engine, engineVersion, timestamp, timestamp, 1, timestamp, timestamp)
        report.newFindings++
      } else {
        findingId = existing.id
        // `rule`, `title` and `severity` are refreshed on repeat. They were NOT
        // in this UPDATE, so a persisted severity was frozen at the value it
        // held on FIRST observation: re-grading a flow from `high` to `critical`
        // (the indexer rewrites `brain_taint_flow.severity` on every reindex)
        // left history reporting `high` forever. Found by the bb_security XR4
        // regression check, which asserts a re-grade is visible in place — a
        // history that cannot report a changed grade is not a history of the
        // current state.
        //
        // `input.X ?? existing.X` keeps the prior value when a caller omits the
        // field, so a sparse update cannot blank a stored one.
        raw.prepare(`UPDATE brain_analysis_finding SET state=?, rule=?, title=?, severity=?, confidence=?, evidence=?, location=?, limitations=?, evidence_class=?, engine=?, engine_version=?, last_seen_at=?, occurrence_count=occurrence_count+1, resolved_at=?, suppressed_at=?, mitigated_at=?, time_updated=? WHERE id=?`).run(nextState, input.rule ?? existing.rule, input.title ?? existing.title, input.severity ?? existing.severity, input.confidence ?? existing.confidence ?? null, json(input.evidence), input.location ?? existing.location ?? null, json(input.limitations ?? (existing.limitations ? parseJsonStringArray(existing.limitations) : [])), evidenceClass ?? existing.evidence_class ?? null, engine ?? existing.engine ?? null, engineVersion ?? existing.engine_version ?? null, timestamp, nextState === "resolved" ? timestamp : existing.resolved_at, nextState === "suppressed" ? timestamp : existing.suppressed_at, nextState === "mitigated" ? timestamp : existing.mitigated_at, timestamp, findingId)
        if (nextState === "reopened") report.reopenedFindings++
        else report.repeatedFindings++
      }
      raw.prepare("INSERT INTO brain_analysis_occurrence (id,finding_id,run_id,state,location,evidence,limitations,evidence_class,engine,engine_version,observed_at,time_created,time_updated) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").run(randomUUID(), findingId, runId, nextState, input.location ?? null, json(input.evidence), json(limitations), evidenceClass, engine, engineVersion, timestamp, timestamp, timestamp)
    }
    const prior = options.incremental
      ? (options.touchedFingerprints ?? []).length > 0
        ? raw.prepare("SELECT * FROM brain_analysis_finding WHERE project_id=? AND kind=? AND state IN ('open','reopened') AND fingerprint IN (" + options.touchedFingerprints!.map(() => "?").join(",") + ")").all(projectId, run.kind, ...options.touchedFingerprints!) as any[]
        : []
      : raw.prepare("SELECT * FROM brain_analysis_finding WHERE project_id=? AND kind=? AND state IN ('open','reopened') AND last_seen_at < ?").all(projectId, run.kind, timestamp) as any[]
    for (const row of prior) {
      if (!seen.has(row.fingerprint)) {
        raw.prepare("UPDATE brain_analysis_finding SET state='resolved', resolved_at=?, time_updated=? WHERE id=?").run(timestamp, timestamp, row.id)
        report.resolvedFindings++
      }
    }
    const retentionMs = (options.retentionDays ?? 90) * 86400000
    raw.prepare("DELETE FROM brain_analysis_occurrence WHERE observed_at < ?").run(timestamp - retentionMs)
    raw.prepare("UPDATE brain_analysis_run SET status='completed', completed_at=?, finding_count=?, time_updated=? WHERE id=?").run(timestamp, seen.size, timestamp, runId)
    report.run = readRun(raw.prepare("SELECT * FROM brain_analysis_run WHERE id=?").get(runId))
    const allRows = raw.prepare("SELECT * FROM brain_analysis_finding WHERE project_id=? AND kind=?").all(projectId, run.kind) as any[]
    report.findings = orderedFindings(allRows)
    report.orderedFindings = report.findings
  })
  finish()
  return report
}

export async function failAnalysisRun(projectId: string, runId: string, error: unknown): Promise<AnalysisRunRecord> {
  const raw = await BrainDatabase.getRawInstance(projectId)
  ensureHistorySchema(raw)
  const message = error instanceof Error ? error.message : String(error)
  const timestamp = now()
  raw.prepare("UPDATE brain_analysis_run SET status='failed', completed_at=?, error=?, time_updated=? WHERE id=? AND project_id=?").run(timestamp, message, timestamp, runId, projectId)
  return readRun(raw.prepare("SELECT * FROM brain_analysis_run WHERE id=?").get(runId))
}

export async function setFindingState(projectId: string, findingId: string, state: AnalysisFindingState): Promise<AnalysisFindingRecord> {
  if (!STATES.includes(state)) throw new Error(`invalid finding state: ${state}`)
  const raw = await BrainDatabase.getRawInstance(projectId)
  ensureHistorySchema(raw)
  const timestamp = now()
  const field = state === "resolved" ? "resolved_at" : state === "suppressed" ? "suppressed_at" : state === "mitigated" ? "mitigated_at" : null
  raw.prepare(`UPDATE brain_analysis_finding SET state=?, ${field ? `${field}=?,` : ""} time_updated=? WHERE id=? AND project_id=?`).run(...(field ? [state, timestamp, timestamp, findingId, projectId] : [state, timestamp, findingId, projectId]))
  const row = raw.prepare("SELECT * FROM brain_analysis_finding WHERE id=? AND project_id=?").get(findingId, projectId) as any
  if (!row) throw new Error(`finding not found: ${findingId}`)
  return readFinding(row)
}

export async function getAnalysisHistory(projectId: string, kind?: string, limit = 20): Promise<AnalysisHistoryReport> {
  const raw = await BrainDatabase.getRawInstance(projectId)
  ensureHistorySchema(raw)
  const runs = (kind ? raw.prepare("SELECT * FROM brain_analysis_run WHERE project_id=? AND kind=? ORDER BY started_at DESC LIMIT ?").all(projectId, kind, limit) : raw.prepare("SELECT * FROM brain_analysis_run WHERE project_id=? ORDER BY started_at DESC LIMIT ?").all(projectId, limit)) as any[]
  const findingRows = (kind ? raw.prepare("SELECT * FROM brain_analysis_finding WHERE project_id=? AND kind=?").all(projectId, kind) : raw.prepare("SELECT * FROM brain_analysis_finding WHERE project_id=?").all(projectId)) as any[]
  const findings = orderedFindings(findingRows)
  const summary = Object.fromEntries(STATES.map((state) => [state, findings.filter((row) => row.state === state).length])) as Record<AnalysisFindingState, number>
  return { runs: runs.map(readRun), findings, summary }
}

export interface ExecuteAnalysisArgs {
  projectId: ProjectID
  kind: AnalysisRunKind
  input?: unknown
  engineVersion?: string
  retentionDays?: number
  incremental?: boolean
  touchedFingerprints?: string[]
  /** Build the list of findings to persist for this run. Called inside the shared wrapper. */
  persist: (run: AnalysisRunRecord) => Promise<AnalysisFindingInput[]> | AnalysisFindingInput[]
}

export interface ExecuteAnalysisResult {
  run: AnalysisRunRecord
  report: AnalysisRunReport
  findings: AnalysisFindingRecord[]
}

/**
 * Shared analysis-execution wrapper (M10.04). All threaded intelligence paths
 * that need persistence go through this: start -> persist -> complete -> read.
 * On error, the run is marked failed and the error rethrown. The same code
 * path guarantees consistent retention, identity, ordering, and lifecycle.
 */
export async function executeAnalysis(args: ExecuteAnalysisArgs): Promise<ExecuteAnalysisResult> {
  const run = await startAnalysisRun({ projectId: args.projectId, kind: args.kind, input: args.input, engineVersion: args.engineVersion, retentionDays: args.retentionDays })
  try {
    const inputs = await args.persist(run)
    const report = await completeAnalysisRun(args.projectId, run.id, inputs, { retentionDays: args.retentionDays, incremental: args.incremental, touchedFingerprints: args.touchedFingerprints })
    return { run: report.run, report, findings: report.findings }
  } catch (error) {
    await failAnalysisRun(args.projectId, run.id, error)
    throw error
  }
}
