// script/m59/verify-store-line-landing.ts — M59.O3
//
// Does the analyzer's call-site line now reach the DATABASE? Runs the REAL
// pipeline (worker pool, real analyzers, the fixed store) over a REAL corpus
// repo, then checks the landed values against the SOURCE — never against the
// index's own opinion of itself.
//
// Isolation: writes to a throwaway BB_DATA_DIR; the user's index is untouched.
// Before M59: every existing index measured 0 rows with line_number > 0.
//
// Tier A (necessary condition): for a row claiming line L on relationship
// target T, source line L must contain T's name as a token. Reported as
// "consistent" — never as "correct". A pass is not proof; a fail is proof of a
// wrong line.

import { readFileSync, existsSync } from "node:fs"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const EMPTY = mkdtempSync(path.join(tmpdir(), "m59-data-"))
process.env.BB_DATA_DIR = EMPTY

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const TARGET_REPO = process.argv[2] ?? "$HOME/fixtures/repositories/cats-effect"

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function tierAConsistent(lines: string[], line: number, token: string): boolean {
  if (!Number.isFinite(line) || line < 1 || line > lines.length) return false
  const src = lines[line - 1]
  const head = token.replace(/_+$/, "")
  const variants = token === head ? [token] : [token, head]
  return variants.some((v) => new RegExp(`(^|[^\\w$])${escapeRe(v)}([^\\w$]|$)`).test(src))
}

async function main() {
  const { getProjectId } = await import(path.join(ROOT, "src/cli/index.ts"))
  const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer.ts"))
  const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database.ts"))

  const pid = getProjectId(TARGET_REPO) as any
  console.log(`repo: ${TARGET_REPO}`)
  console.log(`temp data dir: ${EMPTY}`)

  const t0 = Date.now()
  const stats = await indexProjectParallel(pid, TARGET_REPO, {})
  console.log(`indexed in ${Date.now() - t0}ms: files=${stats.totalFiles} symbols=${stats.totalSymbols} rels=${stats.totalRelationships} errors=${stats.errorFiles}`)

  const raw = await BrainDatabase.getRawInstance(pid)
  const total = (raw.prepare("SELECT COUNT(*) c FROM brain_relationship").get() as any).c as number
  const withLine = (raw.prepare("SELECT COUNT(*) c FROM brain_relationship WHERE line_number IS NOT NULL AND line_number > 0").get() as any).c as number
  const zero = (raw.prepare("SELECT COUNT(*) c FROM brain_relationship WHERE line_number = 0").get() as any).c as number
  const nul = (raw.prepare("SELECT COUNT(*) c FROM brain_relationship WHERE line_number IS NULL").get() as any).c as number

  console.log("\n=== DB after the fix (this is the whole point) ===")
  console.log(`  total relationships : ${total}`)
  console.log(`  line_number > 0     : ${withLine}`)
  console.log(`  line_number = 0     : ${zero}   <-- 0 means "unknown"; must not exist for analyzer rows`)
  console.log(`  line_number NULL    : ${nul}`)
  console.log(`  db: ${BrainDatabase.getDbPath(pid)}`)

  console.log("\n=== by relationship_type (line_number > 0) ===")
  for (const r of raw.prepare("SELECT relationship_type rt, COUNT(*) n FROM brain_relationship WHERE line_number > 0 GROUP BY relationship_type ORDER BY n DESC").all() as any[]) {
    console.log(`  ${String(r.rt).padEnd(16)} ${r.n}`)
  }

  console.log("\n=== by source language (line_number > 0) ===")
  for (const r of raw.prepare(`SELECT f.language lang, COUNT(*) n FROM brain_relationship r JOIN brain_symbol s ON s.id = r.source_symbol_id JOIN brain_file f ON f.id = s.file_id WHERE r.line_number > 0 GROUP BY f.language ORDER BY n DESC`).all() as any[]) {
    console.log(`  ${String(r.lang).padEnd(16)} ${r.n}`)
  }

  // ── The independent check: landed lines vs the SOURCE ─────────────────────
  const rows = raw.prepare(`
    SELECT r.id, r.relationship_type rt, r.line_number ln, r.target_external te,
           s.name sname, f.relative_path path
    FROM brain_relationship r
    JOIN brain_symbol s ON s.id = r.source_symbol_id
    JOIN brain_file f ON f.id = s.file_id
    WHERE r.line_number > 0
  `).all() as any[]

  let consistent = 0
  let inconsistent = 0
  const failures: any[] = []
  const fileCache = new Map<string, string[]>()
  for (const r of rows) {
    const abs = path.join(TARGET_REPO, r.path)
    if (!existsSync(abs)) continue
    let lines = fileCache.get(abs)
    if (!lines) {
      lines = readFileSync(abs, "utf8").split("\n")
      fileCache.set(abs, lines)
    }
    const token = String(r.te ?? r.sname ?? "").split(".").pop() ?? ""
    if (!token) continue
    if (tierAConsistent(lines, r.ln, token)) consistent++
    else {
      inconsistent++
      if (failures.length < 10) {
        failures.push({ path: r.path, line: r.ln, target: r.te, sourceLine: (lines[r.ln - 1] ?? "").trim().slice(0, 90) })
      }
    }
  }

  console.log("\n=== landed lines checked against the SOURCE (Tier A) ===")
  console.log(`  consistent   : ${consistent}`)
  console.log(`  INCONSISTENT : ${inconsistent}`)
  for (const f of failures) console.log(`    WRONG ${f.path}:${f.line} target=${f.target} src="${f.sourceLine}"`)

  const outDir = path.join(ROOT, "validation/m59/results")
  const { mkdirSync, writeFileSync } = await import("node:fs")
  mkdirSync(outDir, { recursive: true })
  writeFileSync(
    path.join(outDir, "store-line-landing.json"),
    JSON.stringify(
      {
        probe: "M59.O3",
        at: new Date().toISOString(),
        repo: TARGET_REPO,
        tempDataDir: EMPTY,
        indexStats: { files: stats.totalFiles, symbols: stats.totalSymbols, relationships: stats.totalRelationships, errorFiles: stats.errorFiles },
        db: { total, withLine, zero, null: nul },
        byType: raw.prepare("SELECT relationship_type rt, COUNT(*) n FROM brain_relationship WHERE line_number > 0 GROUP BY relationship_type ORDER BY n DESC").all(),
        byLanguage: raw.prepare(`SELECT f.language lang, COUNT(*) n FROM brain_relationship r JOIN brain_symbol s ON s.id = r.source_symbol_id JOIN brain_file f ON f.id = s.file_id WHERE r.line_number > 0 GROUP BY f.language ORDER BY n DESC`).all(),
        sourceCheck: { checked: rows.length, consistent, inconsistent, failures },
        before: "every pre-existing index on this machine: 0 rows with line_number > 0 (189,499 of 189,499 were 0)",
      },
      null,
      2,
    ),
  )
}

main().catch((e) => {
  console.error("FATAL", e)
  process.exit(1)
})
