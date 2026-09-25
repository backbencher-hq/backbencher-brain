// script/m26/ambient-reality.ts — M26 (D1/W3): the SINGLE owner of MACHINE
// REALITY facts, and of the rule that keeps them out of byte-gated documents.
//
// Why this file exists (audited 2026-09-18, found by the M53/M61/M62 lane
// convergence). docs/m26/GRAPH.md (D1) and docs/m26/CROSS-LANGUAGE.md (W3) are
// byte-gated against a fresh generation, and their generators embedded
// `Real project dbs scanned: N` plus one row per real-index pair, both read
// live from the operator's `~/.bb/projects`. Those documents are committed, so
// the cascade was:
//
//   any `bb index` on this machine changes ~/.bb/projects
//     -> the next gate run regenerates a DIFFERENT committed document
//       -> the W3/D1 evidence records no longer match their files
//         -> m26 governance reports `W3:stale-commit, D1:stale-commit`
//           -> the m26 ladder leg exits 1
//             -> every downstream closure bar (M42/M44/M55/M61/M62) goes red.
//
// That cascade ran repeatedly and was misread as "staleness to re-pin" instead
// of what it is: a byte-gated artifact whose content is a function of machine
// state outside the repository. A document that ships in the repo cannot claim
// a fact that only one machine can reproduce.
//
// The rule this file enforces:
//   REPO-DERIVED facts      -> byte-gated documents (pure function of the repo);
//   MACHINE-REALITY facts   -> the evidence record (timestamped, pinned, and
//                              explicitly machine-specific), with the document
//                              carrying a stable pointer to it.
//
// Reading the real store is still evidence — "does cross-language data actually
// exist in a real index?" is a question worth answering — it is just not a
// fact a committed document may assert.

import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { createRequire } from "node:module"

const nodeRequire = createRequire(import.meta.url)
const Database = nodeRequire("better-sqlite3")

/** The operator's real index store. Read-only, and never asserted in a doc. */
export const REAL_DATA_DIR = join(process.env.HOME ?? "", ".bb", "projects")

/** One stored cross-language pair, attributed to the database that stores it.
 *  `database` is the project directory name, so a reader can tell two rows for
 *  the same pair in different projects apart (the previous doc table could not:
 *  it printed duplicate `typescript | json` rows with no way to tell why). */
export interface RealPair {
  source: string
  target: string
  edgeCount: number
  sampleBridge: string | null
  database: string
}

/** What a scan of machine reality found. `present` distinguishes "the store is
 *  absent on this machine" from "the store exists and holds nothing" — an
 *  absent store must never read as "no cross-language data anywhere". */
export interface RealityFacts {
  dir: string
  present: boolean
  scanned: number
  skipped: number
  pairs: RealPair[]
}

/** Scan the real project store (read-only, tolerant). A missing directory, an
 *  unreadable database, or a database without the relationship table is
 *  counted as `skipped`, never invented into a row. */
export function scanRealPairs(dataDir: string = REAL_DATA_DIR): RealityFacts {
  const pairs: RealPair[] = []
  let scanned = 0
  let skipped = 0
  const present = existsSync(dataDir)
  if (present) {
    for (const database of readdirSync(dataDir)) {
      try {
        const ro = new Database(join(dataDir, database, "brain.db"), { readonly: true })
        const has = ro
          .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='brain_relationship'`)
          .get()
        if (has) {
          scanned++
          const rows = ro
            .prepare(
              `SELECT sf.language AS source, tf.language AS target, COUNT(*) AS edgeCount, MAX(r.bridge_mechanism) AS sampleBridge
               FROM brain_relationship r
               JOIN brain_symbol ss ON ss.id = r.source_symbol_id AND ss.project_id = r.project_id
               JOIN brain_file sf ON sf.id = ss.file_id
               JOIN brain_symbol ts ON ts.id = r.target_symbol_id AND ts.project_id = r.project_id
               JOIN brain_file tf ON tf.id = ts.file_id
               WHERE r.is_cross_language = 1 GROUP BY sf.language, tf.language`,
            )
            .all() as Array<{ source: string | null; target: string | null; edgeCount: number; sampleBridge: string | null }>
          for (const r of rows) {
            if (r.source && r.target) {
              pairs.push({ source: r.source, target: r.target, edgeCount: r.edgeCount, sampleBridge: r.sampleBridge ?? null, database })
            }
          }
        } else {
          skipped++
        }
        ro.close()
      } catch {
        skipped++
      }
    }
  }
  return { dir: dataDir, present, scanned, skipped, pairs }
}

/** The stable block a byte-gated document carries in place of machine reality.
 *  Same bytes on every machine and every run — that is the point. */
export function realityPointerLines(recordPath: string, fields: string): string[] {
  return [
    "## Machine reality (recorded, not asserted here)",
    "",
    "Facts about a specific machine's own real index store — how many project",
    "databases were readable and which cross-language pairs they store — are",
    "machine-specific and are therefore **not** asserted by this document.",
    "This document is byte-gated because it is a pure function of the",
    "repository; a fact only one machine can reproduce does not belong in it.",
    "",
    "The live scan is recorded, per run, in the evidence record `" + recordPath + "`",
    "(" + fields + "). That record is timestamped and pinned,",
    "and it says of itself that it is machine-specific; read it there.",
    "",
  ]
}

/** The negative control for the ambient-independence check. A document that
 *  DOES embed machine reality. `assertAmbientIndependent` must reject it —
 *  otherwise the check that guards the real document cannot fail, and a check
 *  that cannot fail is not evidence (M61's rule). */
export function leakyControlDoc(heading: string, reality: RealityFacts): string {
  return [heading, "", "Real project dbs scanned: " + reality.scanned + " (skipped/unreadable: " + reality.skipped + ").", ""].join("\n")
}

/** True iff `generate` returns the same bytes for two different machine
 *  realities — i.e. iff the generated document is a pure function of the
 *  repository. Call it with the REAL reality and with a deliberately different
 *  one; any future edit that lets machine state into the document fails it. */
export function assertAmbientIndependent(generate: (reality: RealityFacts) => string, a: RealityFacts, b: RealityFacts): boolean {
  return generate(a) === generate(b)
}
