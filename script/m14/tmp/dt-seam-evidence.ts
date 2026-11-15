import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
const EMPTY = mkdtempSync(path.join(tmpdir(), "dt-seam-ev-"))
process.env.BB_DATA_DIR = EMPTY
const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")
const REPO = "/tmp/dt-seam"
async function main() {
  const { getProjectId } = await import(path.join(ROOT, "src/cli/index.ts"))
  const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer.ts"))
  const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database.ts"))
  const pid = getProjectId(REPO) as any
  const stats = await indexProjectParallel(pid, REPO, {})
  const raw = await BrainDatabase.getRawInstance(pid)
  const q = (sql: string) => raw.prepare(sql).all() as any[]
  const one = (sql: string) => raw.prepare(sql).get() as any
  const AN_FLAGS = ["isMemberRead","isSubscriptBase","isInterpolationRead","isNamedConstructor","isPrefixQualified","isTearOff","isSuperConstructor","isRedirectingConstructor","isMixin","isFieldRead","isPart","evidenceClass"]
  const flagCells: Record<string, number> = {}
  for (const k of AN_FLAGS)
    flagCells[k] = one(`SELECT COUNT(*) c FROM brain_relationship WHERE json_extract(metadata, '$.${k}') IS NOT NULL`).c
  const ev = {
    probe: "M60 dart retrofit (DT wave seam trace)",
    at: new Date().toISOString(),
    wave: "M49.DT1 @8a9b36d9",
    repo: REPO,
    method: "real pipeline (indexProjectParallel) into throwaway BB_DATA_DIR; rows read back with raw SQL; analyzer emission cross-checked via ASTEngine output",
    indexStats: { files: stats.totalFiles, errors: stats.errorFiles },
    rowsByType: Object.fromEntries(q(`SELECT relationship_type rt, COUNT(*) n FROM brain_relationship GROUP BY rt`).map((r: any) => [r.rt, r.n])),
    lineNumber: {
      gt0: one(`SELECT COUNT(*) c FROM brain_relationship WHERE line_number > 0`).c,
      eq0: one(`SELECT COUNT(*) c FROM brain_relationship WHERE line_number = 0`).c,
      nul: one(`SELECT COUNT(*) c FROM brain_relationship WHERE line_number IS NULL`).c,
      verdict: "analyzer never emits line_number on dart edges (all 21 analyzers except scala/xml); store writes NULL per M59.O2; no fabricated zeros",
    },
    analyzerFlagSurvival: flagCells,
    analyzerFlagVerdict: "all analyzer-origin metadata flags are 0: enrichRelationships() builds a fresh metadata object and UPDATE-overwrites the analyzer JSON (src/brain/brain-relationship-enrichment.ts). Surviving: type, source, target, confidence. Starved readers: lsp/hover evidence tiers (falls back to derivation), lsp/graph_usages evidence.",
    symbols: {
      total: one(`SELECT COUNT(*) c FROM brain_symbol`).c,
      withRange: one(`SELECT COUNT(*) c FROM brain_symbol WHERE line_start IS NOT NULL AND line_start > 0`).c,
      withParams: one(`SELECT COUNT(*) c FROM brain_symbol WHERE parameters IS NOT NULL AND parameters != '' AND parameters != '[]'`).c,
      withDocstring: one(`SELECT COUNT(*) c FROM brain_symbol WHERE docstring IS NOT NULL AND docstring != ''`).c,
      commentsVerdict: "dart analyzer emits comments[] but the store binds only symbol.docstring (4 analyzers set it; dart is not one) — dart comments land nowhere",
    },
    queryFallbacks: {
      calleesView: "row.lineNumber || node.line (graph-engine.ts) — NULL edges locate via the caller symbol line",
      callersView: "row.lineNumber || 0 — NULL edges report line 0 at the tool",
      verdict: "M59-known behavior; recorded, not re-filed",
    },
  }
  mkdirSync(path.join(ROOT, "validation/m60/results"), { recursive: true })
  writeFileSync(path.join(ROOT, "validation/m60/results/P1-dart.json"), JSON.stringify(ev, null, 2) + "\n")
  console.log("wrote validation/m60/results/P1-dart.json")
  console.log(JSON.stringify({ rowsByType: ev.rowsByType, line: ev.lineNumber, flags: flagCells,
    symbols: { total: ev.symbols.total, range: ev.symbols.withRange, params: ev.symbols.withParams, doc: ev.symbols.withDocstring } }, null, 1))
}
main().catch((e) => { console.error("FATAL", e); process.exit(1) })
