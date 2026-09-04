// src/lsp/hover.ts — M24.L2: hover over the persisted index.
//
// The only hover implementation for bb_lsp. Reads brain_symbol +
// brain_relationship and produces an LSP hover whose content states what the
// data is, how much to trust it, and whether it is stale — the differentiator
// claim: "the only hover that states how much to trust itself" (issue #491).
//
// Complement stance (IDE Honesty Contract §7): the hover is labeled as coming
// from the bb index; it never pretends to be compiler-grade semantics.
//
// Declared guarantees (gated by script/m24/verify-hover.ts):
//   G1 content:     hover at an indexed symbol returns name, signature,
//                   usage count, and evidence tier(s) of its edges
//   G2 consistency: usage count agrees with a direct count of
//                   brain_relationship rows for the same symbol
//   G3 honesty:     symbol not in index → declared "not indexed" hover,
//                   never a fabricated entry
//   G4 positions:   position resolution via the P1 component ONLY
//                   (no inline conversion — contract §5)
//   G5 freshness:   stale file (hash differs from disk) → stale marker on
//                   the hover, per the freshness gate (P2)
//   G6 latency:     p95 warm hover under the 50 ms budget on the fixture
//                   workspace (contract §3) — measured, machine-recorded
//
// Declared limitations:
//   - index-sourced only; no compiler-backed types (complement stance)
//   - evidence tiers describe relationship data quality, not symbol truth
//
// Run: imported by src/lsp/server.ts (registered as textDocument/hover in L2)

import { readFileSync } from "node:fs"
import type { CoreDatabase } from "../brain/database"
import { checkFileFreshness } from "../brain/freshness"
import {
  createPositionMapper,
  PositionError,
  resolveRowByteColumns,
  type IndexPosition,
  type LspPosition,
} from "./positions"

/** The five launch languages (#419-CONFORMANT set). */
export const LAUNCH_LANGUAGES = ["java", "groovy", "kotlin", "scala", "typescript"] as const

export function isLaunchLanguage(language: string | null): boolean {
  return language !== null && (LAUNCH_LANGUAGES as readonly string[]).includes(language)
}

export function languageForPath(filePath: string): string | null {
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase()
  const map: Record<string, string> = {
    ".java": "java",
    ".groovy": "groovy",
    ".gradle": "groovy",
    ".kt": "kotlin",
    ".kts": "kotlin",
    ".scala": "scala",
    ".sc": "scala",
    ".ts": "typescript",
    ".tsx": "typescript",
  }
  return map[ext] ?? null
}

/** Evidence tiers for relationship data, per the evidence class vocabulary. */
export type EvidenceTier = "indexed" | "inferred" | "semantic_candidate" | "unknown"

const RELATIONSHIP_TIER: Record<string, EvidenceTier> = {
  call: "indexed",
  calls: "indexed",
  import: "indexed",
  imports: "indexed",
  extends: "indexed",
  implements: "indexed",
  override: "indexed",
  reference: "indexed",
  references: "indexed",
  uses: "indexed",
}

function tierForRelationship(relType: string, confidence: number | null): EvidenceTier {
  const t = RELATIONSHIP_TIER[relType.toLowerCase()]
  if (t) return t
  if (confidence !== null && confidence < 0.5) return "semantic_candidate"
  return "inferred"
}

export interface SymbolHoverData {
  name: string
  qualifiedName: string | null
  symbolType: string
  signature: string
  usageCount: number
  evidenceTiers: EvidenceTier[]
  stale: boolean
  freshnessStatus: "fresh" | "stale" | "missing"
  filePath: string
  lineStart: number | null
  lineEnd: number | null
}

export interface HoverRequest {
  /** absolute file path */
  filePath: string
  /** LSP position (0-based line, 0-based UTF-16 character) */
  position: LspPosition
}

export interface HoverResult {
  /** null when nothing is hoverable — declared absence, never fabricated */
  contents: {
    value: string
    kind: "markdown"
  } | null
  range: { start: LspPosition; end: LspPosition } | null
  data: SymbolHoverData | null
  /** machine-readable honesty block, always present */
  provenance: {
    source: "bb_index"
    evidenceClass: EvidenceTier | "stale"
    engine: string
    limitations: string[]
    stale: boolean
  }
}

interface SymbolRow {
  id: string
  name: string
  qualified_name: string | null
  symbol_type: string
  line_start: number | null
  line_end: number | null
  byte_start: number | null
  byte_end: number | null
  return_type: string | null
  parameters: string | null
  visibility: string | null
  file_id: string
}

interface FileRow {
  id: string
  path: string
  language: string | null
}

/** Build a human-readable signature from the indexed symbol fields. */
export function buildSignature(row: {
  name: string
  symbol_type: string
  return_type: string | null
  parameters: string | null
  visibility: string | null
}): string {
  const parts: string[] = []
  if (row.visibility) parts.push(row.visibility)
  parts.push(row.symbol_type)
  let sig = parts.join(" ") + " " + row.name
  if (row.parameters !== null && row.parameters !== undefined) {
    sig += `(${row.parameters})`
  } else if (row.symbol_type === "function" || row.symbol_type === "method") {
    sig += "(…)"
  }
  if (row.return_type) sig += ` → ${row.return_type}`
  return sig
}

/**
 * Resolve the LSP position to an index position via the P1 component and
 * find the symbol whose indexed range contains it. Returns null when the
 * position is outside every indexed symbol (honest absence).
 */
export function findSymbolAtPosition(
  raw: CoreDatabase,
  filePath: string,
  position: LspPosition,
): { symbol: SymbolRow; file: FileRow } | null {
  // Single index query: symbols in this file whose line range could contain
  // the requested line. Position conversion happens ONLY via P1.
  const rows = raw
    .prepare(
      `SELECT s.id, s.name, s.qualified_name, s.symbol_type, s.line_start, s.line_end,
              s.byte_start, s.byte_end, s.return_type, s.parameters, s.visibility, s.file_id,
              f.id AS f_id, f.path, f.language
       FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id
       WHERE f.path = ? AND s.line_start IS NOT NULL AND s.line_end IS NOT NULL
         AND s.line_start <= ? AND s.line_end >= ?`,
    )
    .all(filePath, position.line + 1, position.line + 1) as Array<SymbolRow & { f_id: string; path: string; language: string | null }>

  if (rows.length === 0) return null

  // Prefer the innermost symbol (smallest range) containing the position.
  let best: { symbol: SymbolRow; file: FileRow } | null = null
  let bestWidth = Number.MAX_SAFE_INTEGER
  for (const row of rows) {
    const width = (row.line_end ?? 0) - (row.line_start ?? 0)
    if (width < bestWidth) {
      bestWidth = width
      best = {
        symbol: row,
        file: { id: row.f_id, path: row.path, language: row.language },
      }
    }
  }
  return best
}

/** Count usages of a symbol from brain_relationship (direct count). */
export function countUsages(raw: CoreDatabase, symbolId: string): number {
  const row = raw
    .prepare(
      "SELECT COUNT(*) AS c FROM brain_relationship WHERE target_symbol_id = ? OR source_symbol_id = ?",
    )
    .get(symbolId, symbolId) as { c: number }
  return row.c
}

/** Collect evidence tiers across the symbol's relationships. */
export function evidenceTiersFor(raw: CoreDatabase, symbolId: string): EvidenceTier[] {
  const rows = raw
    .prepare(
      "SELECT relationship_type, confidence FROM brain_relationship WHERE target_symbol_id = ? OR source_symbol_id = ?",
    )
    .all(symbolId, symbolId) as Array<{ relationship_type: string; confidence: number | null }>
  const tiers = new Set<EvidenceTier>()
  for (const r of rows) tiers.add(tierForRelationship(r.relationship_type, r.confidence))
  return [...tiers].sort()
}

/** Format the hover markdown, including the honesty block. */
export function formatHoverMarkdown(data: SymbolHoverData): string {
  const lines: string[] = []
  lines.push(`\`\`\`\n${data.signature}\n\`\`\``)
  lines.push(`**${data.name}** — ${data.symbolType}, ${data.usageCount} usage${data.usageCount === 1 ? "" : "s"}`)
  if (data.evidenceTiers.length > 0) {
    lines.push(`evidence: ${data.evidenceTiers.join(", ")}`)
  } else {
    lines.push("evidence: none (no indexed relationships)")
  }
  if (data.stale) {
    lines.push(`⚠️ **stale** — file changed since indexing (${data.freshnessStatus})`)
  }
  lines.push(`_source: bb index (${data.filePath}:${data.lineStart ?? "?"})_`)
  return lines.join("\n\n")
}

export interface HoverDeps {
  /** injectable clock for latency measurement (tests) */
  now?: () => number
}

/**
 * The hover handler. Reads through the persisted index; every response
 * carries the honesty block. Never fabricates: no symbol at the position →
 * contents null with provenance explaining why.
 */
export function hover(
  raw: CoreDatabase,
  request: HoverRequest,
  deps: HoverDeps = {},
): HoverResult {
  const startedAt = (deps.now ?? Date.now)()
  const language = languageForPath(request.filePath)

  // Declared-absent languages: not an error, an honest limitation.
  if (!isLaunchLanguage(language)) {
    return {
      contents: null,
      range: null,
      data: null,
      provenance: {
        source: "bb_index",
        evidenceClass: "unknown",
        engine: "bb_lsp hover@m24.l2",
        limitations: [
          language === null
            ? "file type not in the launch language set"
            : `${language} is not a launch language (launch: ${LAUNCH_LANGUAGES.join(", ")})`,
        ],
        stale: false,
      },
    }
  }

  const found = findSymbolAtPosition(raw, request.filePath, request.position)
  if (!found) {
    return {
      contents: null,
      range: null,
      data: null,
      provenance: {
        source: "bb_index",
        evidenceClass: "unknown",
        engine: "bb_lsp hover@m24.l2",
        limitations: ["no indexed symbol at this position (not indexed)"],
        stale: false,
      },
    }
  }

  const { symbol, file } = found
  const freshness = checkFileFreshness(raw, file.id)
  const freshnessStatus = freshness?.status ?? "missing"
  const stale = freshnessStatus !== "fresh"

  const usageCount = countUsages(raw, symbol.id)
  const tiers = evidenceTiersFor(raw, symbol.id)

  const data: SymbolHoverData = {
    name: symbol.name,
    qualifiedName: symbol.qualified_name,
    symbolType: symbol.symbol_type,
    signature: buildSignature(symbol),
    usageCount,
    evidenceTiers: tiers,
    stale,
    freshnessStatus,
    filePath: file.path,
    lineStart: symbol.line_start,
    lineEnd: symbol.line_end,
  }

  // Range comes from the P1 component only — never inline conversion.
  // resolveRowByteColumns normalizes the index's dual byte conventions
  // (per-line declared vs file-absolute stored by the parallel indexer);
  // an unconvertible row omits the range honestly instead of throwing.
  let range: HoverResult["range"] = null
  if (symbol.line_start !== null && symbol.line_end !== null && symbol.byte_start !== null && symbol.byte_end !== null) {
    try {
      const sourceText = readFileSync(file.path, "utf8")
      const startCol = resolveRowByteColumns(sourceText, symbol.line_start, symbol.byte_start)
      const endCol = resolveRowByteColumns(sourceText, symbol.line_end, symbol.byte_end)
      if (startCol === null || endCol === null) {
        // Impossible coordinates: omit the range, keep the honest content.
      } else {
        const mapper = createPositionMapper(sourceText)
        const indexRange = {
          start: { line: startCol.line, column: startCol.column } satisfies IndexPosition,
          end: { line: endCol.line, column: endCol.column } satisfies IndexPosition,
        }
        range = mapper.indexRangeToLsp(indexRange)
      }
    } catch (error) {
      if (!(error instanceof PositionError)) throw error
      // Unreadable file or impossible positions: omit the range honestly,
      // keep the hover content.
    }
  }

  const elapsed = (deps.now ?? Date.now)() - startedAt
  void elapsed // latency measured by the verifier; kept for symmetry

  return {
    contents: { value: formatHoverMarkdown(data), kind: "markdown" },
    range,
    data,
    provenance: {
      source: "bb_index",
      evidenceClass: stale ? "stale" : (tiers[0] ?? "unknown"),
      engine: "bb_lsp hover@m24.l2",
      limitations: [
        "index-sourced; no compiler-backed types (complement stance)",
      ],
      stale,
    },
  }
}
