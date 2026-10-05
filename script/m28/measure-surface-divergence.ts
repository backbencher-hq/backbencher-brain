// script/m28/measure-surface-divergence.ts — the corpus-scale MEASUREMENT behind
// the copy-projection finding, kept as a re-runnable script rather than a number
// in a commit message.
//
// WHAT IS MEASURED, PRECISELY
//
//   docs/m63/CL1.md records the defect class: a surface that COPIES another
//   surface's rule instead of importing its owner. The copy in
//   src/mcp/tool-handlers.ts (bb_graph's `tierFor`) is now DELEGATED to
//   src/lsp/evidence_tier.ts, so the shipped door and the owner agree by
//   construction. That makes the divergence unmeasurable in the product — which
//   is the point — and leaves the historical size of the defect to a commit
//   message, which is where a number should never live.
//
//   So this script measures the DOCUMENTED PRE-FIX DERIVATION against the owner
//   over every stored relationship row of every project index on this machine.
//   That derivation is spelled out here verbatim and is the same body the M1
//   mutant plants, so the number in the lane report and the number a red-team
//   member re-derives come from one text.
//
//   It is a MEASUREMENT of a defect that was fixed, not a gate over the product.
//   The gate over the product is script/m28/verify-surface-parity.ts (U2).
//
// THE TWO RULES, AND WHY THERE IS ONLY ONE DERIVATION HERE
//
//   - the OWNER is IMPORTED (src/lsp/evidence_tier.ts) and is never re-typed;
//   - the PRE-FIX COPY is transcribed once, below, with its divergence named in
//     comments. It is the thing under measurement, so it cannot also be the
//     oracle — a file that typed BOTH would measure itself against itself.
//
// NO CORPUS IS A DECLARED ABSENCE. With no index available the result is
// `blocked`, never a silent zero: a measurement over zero rows proves nothing,
// and printing "0 disagreements" because there was nothing to look at is the lie
// this file refuses.
//
// Run: npx tsx script/m28/measure-surface-divergence.ts
// Env:   BB_DATA_DIR — where project indexes live (default ~/.bb)
//        BB_MAX_PROJECTS — cap how many indexes to stream (default: all)
// Output: validation/m28/results/U2-CORPUS.json (machine-emitted)
// Exit:   0 when at least one index was measured, 1 when none was (`blocked`)

import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"
import Database from "better-sqlite3"
import { classifyTier, evidenceClassOf } from "../../src/lsp/evidence_tier"
import { writeSealed } from "../lib/evidence.ts"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")

/** THE OWNER. Imported once; never re-typed. */
const ownerTier = (relationshipType: string, confidence: number | null, evidenceClass: string | null): string =>
  classifyTier({ relationshipType, confidence, evidenceClass })

/**
 * THE PRE-FIX COPY — the rule bb_graph's `tierFor` carried before it was
 * delegated to the owner. Transcribed verbatim from the file at the commit where
 * it drifted, and it is byte-for-byte the body M1 plants as a mutant, so the
 * figure reported here and the defect the gate observes are the same rule.
 *
 * Its four divergences from the owner, each measured on real rows below:
 *   1. STRUCTURAL held FOUR kinds where the owner holds ten — `call`, `extends`,
 *      `override`, `contains`, `exports` and `instantiates` fell through to
 *      `inferred`;
 *   2. there was NO usage branch, so `reference`/`references`/`use`/`uses`/
 *      `usage` read `inferred` where the owner reads `usage_contextual`;
 *   3. there was NO reference-qualified branch, so `references_qualified` and
 *      `reference_qualified` read `inferred` where the owner reads
 *      `reference_qualified`;
 *   4. it neither trimmed nor lowercased the stored kind, so `CALLS` and
 *      ` Calls ` read `inferred` where the owner reads `structural`.
 */
function prefixTier(relationshipType: string, confidence: number | null, evidenceClass: string | null): string {
  const STRUCTURAL = new Set(["calls", "inherits", "implements", "overrides"])
  const IMPORT = new Set(["imports", "import"])
  const stored = evidenceClass
  if (stored && ["structural", "import_based", "usage_contextual", "reference_qualified", "inferred"].includes(stored)) return stored
  if (STRUCTURAL.has(relationshipType)) return (confidence ?? 0) >= 0.7 ? "structural" : "inferred"
  if (IMPORT.has(relationshipType)) return "import_based"
  return "inferred"
}

function main(): void {
  const dataDir = process.env.BB_DATA_DIR ? path.resolve(process.env.BB_DATA_DIR) : path.join(homedir(), ".bb")
  let projectsDir = path.join(dataDir, "projects")
  if (!isDir(projectsDir)) projectsDir = dataDir

  let candidates: string[] = []
  try {
    candidates = readdirSync(projectsDir).filter((p) => isDir(path.join(projectsDir, p)))
  } catch {
    candidates = []
  }
  const max = Number(process.env.BB_MAX_PROJECTS ?? 0)
  if (Number.isFinite(max) && max > 0) candidates = candidates.slice(0, max)

  const perProject: Array<Record<string, unknown>> = []
  for (const projectId of candidates) {
    const dbPath = path.join(projectsDir, projectId, "brain.db")
    if (!existsSync(dbPath)) continue
    let db: Database.Database
    try {
      db = new Database(dbPath, { readonly: true, fileMustExist: true })
    } catch (error) {
      perProject.push({ projectId, status: "unreadable", reason: String(error).slice(0, 140) })
      continue
    }
    try {
      const total = (db.prepare("SELECT COUNT(*) AS n FROM brain_relationship").get() as { n: number }).n
      const languages = (db.prepare("SELECT language, COUNT(*) AS n FROM brain_file GROUP BY 1 ORDER BY 2 DESC").all() as Array<{ language: string; n: number }>)
      if (total === 0) {
        perProject.push({ projectId, status: "blocked", reason: "no stored relationship rows — a measurement over zero rows proves nothing", languages: languages.map((l) => `${l.language}:${l.n}`).slice(0, 20) })
        continue
      }
      // A row whose stored evidenceClass is already a declared legend tier
      // CANNOT disagree: the stored claim wins on BOTH sides. Those rows are
      // counted as they stream (not by a second SQL query that could drift from
      // the loop), and both denominators are published so the disagreement share
      // is never a quietly narrowed one.
      const DECLARED_LEGEND_TIERS = ["structural", "import_based", "usage_contextual", "reference_qualified", "inferred"]
      let rows = 0
      let decidable = 0
      let storedClaimWins = 0
      let disagreements = 0

      const byKind = new Map<string, { n: number; example: string }>()
      const stmt = db.prepare("SELECT relationship_type, confidence, metadata FROM brain_relationship")
      for (const row of stmt.iterate() as Iterable<{ relationship_type: string; confidence: number | null; metadata: string | null }>) {
        rows++
        const storedClass = evidenceClassOf(row.metadata)
        const owner = ownerTier(row.relationship_type, row.confidence, storedClass)
        const prefix = prefixTier(row.relationship_type, row.confidence, storedClass)
        if (storedClass !== null && DECLARED_LEGEND_TIERS.includes(storedClass)) {
          // Both rules return the stored claim, so this row measures nothing.
          storedClaimWins++
          continue
        }
        decidable++
        if (prefix === owner) continue
        disagreements++
        const entry = byKind.get(row.relationship_type) ?? {
          n: 0,
          example: `${row.relationship_type} conf=${row.confidence} stored=${JSON.stringify(storedClass)}: pre-fix copy=${prefix} owner=${owner}`,
        }
        entry.n++
        byKind.set(row.relationship_type, entry)
      }
      perProject.push({
        projectId,
        status: "measured",
        languages: languages.length,
        languageBreakdown: languages.map((l) => `${l.language}:${l.n}`).slice(0, 24),
        storedRelationshipRows: rows,
        rowsWhoseStoredClassIsADeclaredLegendTier: storedClaimWins,
        rowsWhereTheTwoRulesCanDisagree: decidable,
        rowsWhereTheyDoDisagree: disagreements,
        shareOfAllStoredRows: Number((disagreements / rows).toFixed(6)),
        shareOfDecidableRows: decidable === 0 ? null : Number((disagreements / decidable).toFixed(6)),
        byKind: [...byKind.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 12).map(([kind, v]) => ({ kind, rows: v.n, example: v.example })),
      })
    } catch (error) {
      perProject.push({ projectId, status: "error", reason: String(error).slice(0, 160) })
    } finally {
      try {
        db.close()
      } catch {
        /* a handle that will not close is not a measurement failure */
      }
    }
  }

  const measured = perProject.filter((m) => m.status === "measured") as Array<{ storedRelationshipRows: number; rowsWhereTheTwoRulesCanDisagree: number; rowsWhereTheyDoDisagree: number; languageBreakdown?: string[] }>
  const totalRows = measured.reduce((n, m) => n + m.storedRelationshipRows, 0)
  const totalDecisive = measured.reduce((n, m) => n + m.rowsWhereTheTwoRulesCanDisagree, 0)
  const totalDisagreements = measured.reduce((n, m) => n + m.rowsWhereTheyDoDisagree, 0)
  let currentCommit = "unknown"
  try {
    currentCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
  } catch {}

  const handlerSource = readFileSync(path.join(ROOT, "src/mcp/tool-handlers.ts"), "utf8")
  const result = {
    issue: "M28.U2-CORPUS",
    code: "U2-CORPUS",
    milestone: "M28",
    status: measured.length > 0 ? "measured" : "blocked",
    whatWasMeasured:
      "src/lsp/evidence_tier.ts (the imported owner) vs the PRE-FIX inline derivation bb_graph's tierFor carried (transcribed verbatim in this script, and byte-identical to the body script/m28/verify-surface-parity.ts plants as mutant M1)",
    shippedDoorNowDelegates: /const tierFor = \(e: \{[^\n]*\}\): string =>\s*\n\s*classifyTier\(/.test(handlerSource),
    dataDir,
    currentCommit,
    verifierCommand: "npx tsx script/m28/measure-surface-divergence.ts",
    evidenceFile: "U2-CORPUS.json",
    generatedAt: new Date().toISOString(),
    counts: {
      indexesFound: candidates.length,
      indexesMeasured: measured.length,
      storedRelationshipRowsStreamed: totalRows,
      rowsWhereTheTwoRulesCanDisagree: totalDecisive,
      disagreements: totalDisagreements,
      shareOfAllStoredRows: totalRows === 0 ? null : Number((totalDisagreements / totalRows).toFixed(6)),
      shareOfDecidableRows: totalDecisive === 0 ? null : Number((totalDisagreements / totalDecisive).toFixed(6)),
    },
    perProject,
    claimLevel:
      measured.length > 0
        ? `measured — the pre-fix derivation disagreed with the owner on ${totalDisagreements} of ${totalDecisive} rows where a disagreement was possible (${totalRows} stored rows streamed) across ${measured.length} index(es) on this machine. Scoped to the indexes present at ${dataDir}; no claim about any corpus not present here.`
        : "blocked — no project index was available to measure; a measurement over zero rows proves nothing",
    limitations: [
      "READ-ONLY. Indexes are opened with better-sqlite3 readonly:true; nothing is written, seeded or modified. Point BB_DATA_DIR at a copy to remove even the open.",
      "This measures a FIXED defect (the pre-fix derivation), not the shipped product. The gate over the product is script/m28/verify-surface-parity.ts (U2), which reads the tier out of bb_graph's own payload.",
      "A row whose stored evidenceClass is already a declared legend tier cannot disagree — the stored claim wins on both sides — so the per-project count publishes both denominators (allStoredRows and rowsWhereTheTwoRulesCanDisagree).",
      "Only indexes present under the resolved data dir are measured. An absent corpus is declared absent, never assumed, and with none present the result is `blocked` and the exit code is 1.",
    ],
    sourceFingerprint: {
      "src/lsp/evidence_tier.ts": createHash("sha256").update(readFileSync(path.join(ROOT, "src/lsp/evidence_tier.ts"), "utf8")).digest("hex"),
      "src/mcp/tool-handlers.ts": createHash("sha256").update(handlerSource).digest("hex"),
      "script/m28/measure-surface-divergence.ts": createHash("sha256").update(readFileSync(path.join(ROOT, "script/m28/measure-surface-divergence.ts"), "utf8")).digest("hex"),
    },
  }
  mkdirSync(path.join(ROOT, "validation/m28/results"), { recursive: true })
  writeSealed(path.join(ROOT, "validation/m28/results", result.evidenceFile), result)

  for (const m of perProject) {
    if (m.status !== "measured") {
      console.log(`${m.projectId}: ${m.status} — ${m.reason}`)
      continue
    }
    const breakdown = (m.languageBreakdown as string[]).slice(0, 6).join(" ")
    console.log(`${m.projectId}: ${m.rowsWhereTheyDoDisagree} of ${m.rowsWhereTheTwoRulesCanDisagree} decidable rows disagree (${(100 * Number(m.shareOfDecidableRows)).toFixed(1)}% of ${m.storedRelationshipRows} stored rows)  langs: ${breakdown}`)
    for (const k of (m.byKind as Array<{ kind: string; rows: number; example: string }>).slice(0, 6)) {
      console.log(`    ${k.kind}: ${k.rows}  — ${k.example}`)
    }
  }
  console.log(`U2-CORPUS: ${result.status.toUpperCase()} (${measured.length} index(es), ${totalDisagreements} of ${totalDecisive} decidable rows, out of ${totalRows} stored rows)`)
  process.exit(measured.length > 0 ? 0 : 1)
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

main()