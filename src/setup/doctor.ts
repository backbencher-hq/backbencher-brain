// src/setup/doctor.ts — M32.S2.
//
// `bb doctor`: concrete diagnosis of why semantic search is degraded, from
// REAL local state only. M30 got users into a working config; this answers
// the next question — "is everything actually consistent, and if not, what
// exactly do I run to fix it?"
//
// Checks (each backed by real files/DB rows — never invented):
//   1. config presence + completeness (all precedence tiers)
//   2. config file permissions (0600 expected; --fix, M32.S3, repairs it)
//   3. model consistency: the winning config's model vs the models actually
//      stored in brain_semantic_embedding for this project (readonly DB).
//      A mismatch means stored vectors can never be compared with query
//      vectors — the honest fix is `bb index --force`.
//   4. wizard-skip marker (informational)
//
// No network calls. Diagnosis is read-only: --fix (S3) is the only command
// that mutates anything, and only file permissions.
//
// Exit code: 0 when healthy, 1 when at least one FAIL-level finding exists
// (so scripts/CI can branch). WARN findings do not change the exit code.

import { existsSync, readFileSync, statSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { bbDataDir } from "../util/bb-data-dir"
import { fingerprintKey } from "./setup-wizard"
import { describeEmbeddingConfig, type TierView } from "./setup-show"

// Repository root — resolve once, cheap and stable for createRequire.
const ROOT_PKG = path.resolve(import.meta.dirname ?? ".", "../..")

export type Severity = "fail" | "warn" | "info"

export type Finding = {
  id: string
  severity: Severity
  message: string
  /** exact command the user should run, when applicable — advice, never auto-fix (S3 is the only mutator) */
  fix?: string
}

export type DoctorReport = {
  findings: Finding[]
  healthy: boolean
  winner: "env" | "global" | "project" | "none"
  /** models found in the project's stored embeddings, with row counts */
  storedModels: { model: string; count: number }[]
}

function readJsonSafe(p: string): any | null {
  try {
    if (!existsSync(p)) return null
    return JSON.parse(readFileSync(p, "utf8"))
  } catch {
    return null
  }
}

type StoredModels = { model: string; count: number }[]

// Reads embedding models from the project's brain.db WITHOUT creating or
// writing it: opens the file directly in readonly mode. Missing DB or table
// yields [] — diagnosed as "no index yet", not an error.
function readStoredModels(projectId: string, dataDir: string): StoredModels {
  const dbPath = path.join(dataDir, "projects", projectId, "brain.db")
  if (!existsSync(dbPath)) return []
  try {
    // Anchor require at the repo root package.json — a bare require() from
    // src/setup/ fails to resolve under the compiled ESM bundle (the M30 P0
    // class: works under tsx, broken in dist).
    const require = createRequire(path.join(ROOT_PKG, "package.json"))
    const Database = require("better-sqlite3")
    const db = new Database(dbPath, { readonly: true, fileMustExist: true })
    try {
      const rows = db
        .prepare(
          `SELECT embedding_model AS model, COUNT(*) AS count FROM brain_semantic_embedding WHERE project_id = ? GROUP BY embedding_model`,
        )
        .all(projectId) as { model: string; count: number }[]
      return rows.map((r) => ({ model: String(r.model), count: Number(r.count) }))
    } finally {
      db.close()
    }
  } catch {
    // Table missing (old index) or driver unavailable: treat as no stored data.
    return []
  }
}

function tierIssues(t: TierView): { missing: string[]; modeWrong: boolean } {
  const missing: string[] = []
  if (t.present && !t.complete) {
    const reason = t.incompleteReason ?? ""
    if (reason.includes("base URL")) missing.push("base URL")
    if (reason.includes("model")) missing.push("model")
    if (!t.keyFingerprint) missing.push("API key")
  }
  const modeWrong = t.fileMode !== undefined && t.fileMode !== 0o600
  return { missing, modeWrong }
}

export function runDoctorChecks(opts: {
  cwd?: string
  env?: Record<string, string | undefined>
  dataDir?: string
  projectId?: string
  storedModels?: StoredModels
}): DoctorReport {
  const cwd = opts.cwd ?? process.cwd()
  const env = opts.env ?? process.env
  const dataDir = opts.dataDir ?? bbDataDir()
  const state = describeEmbeddingConfig(cwd, env, dataDir)

  const findings: Finding[] = []
  const localLabel = "local-word-vectors"

  // 1. Config presence/completeness per tier.
  if (!state.configured) {
    const skipped = state.tiers.some((t) => t.skippedMarker)
    findings.push({
      id: "no-config",
      severity: "fail",
      message: skipped
        ? "Embedding yapılandırması yok (sihirbaz daha önce atlanmış)."
        : "Embedding yapılandırması yok.",
      fix: "bb setup",
    })
  }
  for (const t of state.tiers) {
    const { missing, modeWrong } = tierIssues(t)
    if (missing.length > 0) {
      findings.push({
        id: `incomplete-${t.tier}`,
        severity: "fail",
        message: `${t.tier} katmanı eksik: ${missing.join(" + ")}.`,
        fix: "bb setup",
      })
    }
    if (modeWrong) {
      findings.push({
        id: `mode-${t.tier}`,
        severity: "warn",
        message: `${t.tier} yapılandırma dosyasının izni ${t.fileMode?.toString(8)} — anahtar dünyaca okunabilir olabilir.`,
        fix: "bb doctor --fix",
      })
    }
  }

  // 2. Model consistency: winning model vs stored embedding models.
  const winnerTier = state.tiers.find((t) => t.complete)
  const winnerModel = winnerTier?.model
  const storedModels = opts.storedModels ?? (opts.projectId ? readStoredModels(opts.projectId, dataDir) : [])
  if (winnerModel && storedModels.length > 0) {
    const matches = storedModels.filter((s) => s.model === winnerModel)
    if (matches.length === 0) {
      const storedDesc = storedModels.map((s) => `${s.model} (${s.count} satır)`).join(", ")
      findings.push({
        id: "model-mismatch",
        severity: "fail",
        message: `Model uyuşmazlığı: yapılandırmada ${winnerModel}, indekste ${storedDesc}. Farklı modellerin vektörleri karşılaştırılamaz — mevcut vektörler kullanılmıyor.`,
        fix: "bb index --force",
      })
    } else {
      const foreign = storedModels.filter((s) => s.model !== winnerModel)
      if (foreign.length > 0) {
        const foreignDesc = foreign.map((s) => `${s.model} (${s.count} satır)`).join(", ")
        findings.push({
          id: "model-mixed",
          severity: "warn",
          message: `İndekste yabancı model vektörleri var: ${foreignDesc}. Bunlar ${winnerModel} sorgularıyla karşılaştırılmaz.`,
          fix: "bb index --force",
        })
      }
    }
  } else if (winnerModel && storedModels.length === 0) {
    findings.push({
      id: "no-index",
      severity: "info",
      message: `Bu proje için kayıtlı vektör yok (indeks yok veya boş). Yapılandırmadaki model: ${winnerModel}.`,
      fix: "bb index .",
    })
  }

  // 3. Semantic degradation notice when nothing is configured at all.
  if (!winnerModel) {
    findings.push({
      id: "semantic-degraded",
      severity: "warn",
      message: `Semantik arama ${localLabel} ile çalışacak (daha zayıf).`,
      fix: "bb setup",
    })
  }

  const healthy = !findings.some((f) => f.severity === "fail")
  return { findings, healthy, winner: state.winner, storedModels }
}

// Human-readable report. Keys appear only as fingerprints (inherited from the
// tier view; runDoctorChecks never reads raw key material into findings).
export function renderDoctorReport(r: DoctorReport): string {
  const lines: string[] = []
  lines.push("bb doctor — tanılama")
  lines.push("")
  if (r.findings.length === 0) {
    lines.push("✓ Sorun bulunamadı — yapılandırma ve indeks tutarlı görünüyor.")
  }
  const icon: Record<Severity, string> = { fail: "✗", warn: "!", info: "·" }
  for (const f of r.findings) {
    lines.push(`${icon[f.severity]} ${f.message}`)
    if (f.fix) lines.push(`  Çözüm: ${f.fix}`)
  }
  return lines.join("\n") + "\n"
}
