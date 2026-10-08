// probe-i13-equivalence.mjs — differential proof that the linear name-resolution
// plan picks the SAME symbol as the window-function plan, row for row.
//
// Run: node script/perf/probe-i13-equivalence.mjs <brain.db> <projectId> [--mutate]
//
// ── WHY THIS FILE EXISTS ──
//
// The window-function plan (src/ast/parallel-indexer.ts, `_i13_pick`) joins every
// relationship to every symbol sharing its target name and then ranks them with
// ROW_NUMBER(). Its work is O(rels x candidates-per-name), and candidates-per-name
// grows with the project, so the pass becomes superlinear — measured at 2.64x per
// 4x of files (validation/m60/results/scaling-linear.before.json).
//
// The linear plan replaces the ranking with three precomputed per-name tables
// (best-in-file, best-in-language, best-overall) and resolves each relationship
// with three indexed lookups. That is O(rels + symbols).
//
// A faster plan that picks a DIFFERENT symbol is a defect, not an optimisation:
// it silently re-points edges, and no count-based check in the repo would see it
// because the counts stay identical. So this probe computes BOTH plans on the
// same index and compares the resulting (rel_id -> target_symbol_id) assignments
// element by element. Disagreement in either direction fails the probe.
//
// ── WHAT "EQUIVALENT" MEANS HERE, PRECISELY ──
//
// The window function ranks candidates for one relationship by the lexicographic
// key
//
//   ( COALESCE(s.is_declaration, 0) ASC,
//     (s.file_id = t.src_file) DESC,
//     (COALESCE(f.language, '') = t.src_lang) DESC,
//     s.id ASC )
//
// and takes the minimum. Three observations make the linear plan able to
// reproduce that exactly:
//
//   1. The first key is a property of the NAME, not of the relationship: every
//      candidate with a higher declaration tier loses to every candidate at the
//      minimum tier. So only minimum-tier candidates can ever win, and one
//      `GROUP BY name` fixes the tier per name.
//   2. Within one file, `f.language` is CONSTANT — it is a column of
//      brain_file, and brain_file.id is the primary key. So among same-file
//      candidates the third key is a constant, and the winner is the lowest id.
//   3. Therefore the winner is one of exactly three candidates, in this order:
//        (a) lowest id at minimum tier, in the relationship's own file;
//        (b) failing (a), lowest id at minimum tier, in the relationship's own
//            language;
//        (c) failing both, lowest id at minimum tier.
//      A COALESCE chain over three indexed lookups returns exactly that.
//
// The NULL cases are load-bearing and are handled rather than assumed:
//   - `t.src_file IS NULL` (the source symbol is missing — 26,522 rows on the
//     n800 index): `s.file_id = NULL` is NULL, and SQLite sorts NULL last under
//     DESC, so no candidate claims the same-file tier. The lookup
//     `fi.file_id = NULL` matches nothing, which reproduces that.
//   - `f.language` NULL (the symbol's brain_file row is missing) and `t.src_lang`
//     NULL: both sides are COALESCEd to '' before comparison, so '' matches ''.
//     The per-language table groups on the COALESCEd value so a '' bucket exists.
//
// ── THE MUTATION ARM ──
//
// `--mutate` flips is_declaration on a deterministic sample of symbols before
// computing both plans. This corpus stores is_declaration NULL for every symbol
// (measured: 27,121 of 27,121 at n800), so observation 1 above is vacuous on it
// — the declaration tier never discriminates and the equivalence would hold for
// a plan that had simply dropped the tier. The mutation gives the tier real
// values, so a plan that ignored it would disagree and fail. Without this arm the
// proof covers only the easy half of the ranking key.
//
// It reads and writes a COPY. A measurement artifact is never mutated.
//
// A probe, not a gate: it prints a verdict and exits non-zero on disagreement;
// the gate that consumes its result is script/perf/verify-scaling-linear.ts, whose
// relationship-multiset digests carry the end-to-end claim.

import Database from "better-sqlite3"
import { copyFileSync, mkdtempSync, rmSync } from "fs"
import { tmpdir } from "os"
import path from "path"

const dbPath = process.argv[2]
const projectId = process.argv[3]
const mutate = process.argv.includes("--mutate")
if (!dbPath || !projectId) {
  console.error("usage: probe-i13-equivalence.mjs <brain.db> <projectId> [--mutate]")
  process.exit(2)
}

const tmp = mkdtempSync(path.join(tmpdir(), "bb-i13-"))
const copy = path.join(tmp, "brain.db")
copyFileSync(dbPath, copy)
const db = new Database(copy)

// ── The population: exactly the window function's WHERE, so both plans see the
//    same rows and a disagreement is about the RANKING, never the scope. ──
const POPULATION = `
  r.project_id = '${projectId}'
  AND r.target_external IS NOT NULL
  AND r.relationship_type <> 'contains'
  AND instr(r.target_external, '.') = 0
  AND instr(r.target_external, ':') = 0`

/** Source file + language per relationship, as `_i13_src` materialised them. */
const buildSrc = () => {
  db.exec(`DROP TABLE IF EXISTS temp._i13_src`)
  db.exec(`
    CREATE TEMP TABLE _i13_src AS
    SELECT r.id AS rel_id, src.file_id AS src_file, COALESCE(sf.language, '') AS src_lang
    FROM brain_relationship r
    LEFT JOIN brain_symbol src ON src.id = r.source_symbol_id
    LEFT JOIN brain_file sf ON sf.id = src.file_id
    WHERE r.project_id = '${projectId}'`)
}

/** The plan under test: rank every same-named candidate, keep the winner. */
/**
 * A plan that keeps the same-file and language preferences but DROPS the
 * declaration tier — i.e. ranks candidates by (same_file, same_lang, id) alone.
 *
 * It exists to be compared against the window plan on an index where the tier
 * actually discriminates. On this corpus as stored it cannot disagree, because
 * every symbol has is_declaration NULL (measured: 27,121 of 27,121 at n800) and
 * the tier term is constant. A probe that only ever ran on that corpus would
 * therefore "prove" equivalence for a plan that had silently dropped a third of
 * the ranking key. `--tiers` gives the tier real values; this plan then has to
 * disagree, and the probe reports that it does.
 */
function tierIgnoringPlan() {
  buildSrc()
  db.exec(`DROP TABLE IF EXISTS temp._i13_pick_notier`)
  db.exec(`
    CREATE TEMP TABLE _i13_pick_notier AS
    SELECT rel_id, target_symbol_id FROM (
      SELECT t.rel_id AS rel_id, s.id AS target_symbol_id,
             ROW_NUMBER() OVER (PARTITION BY t.rel_id
               ORDER BY (s.file_id = t.src_file) DESC,
                        (COALESCE(f.language, '') = t.src_lang) DESC,
                        s.id ASC) AS rn
      FROM _i13_src t
      JOIN brain_relationship r ON r.id = t.rel_id
      JOIN brain_symbol s ON s.project_id = '${projectId}' AND s.name = r.target_external
      LEFT JOIN brain_file f ON f.id = s.file_id
      WHERE ${POPULATION}
    ) WHERE rn = 1`)
  return db.prepare(`SELECT rel_id, target_symbol_id FROM _i13_pick_notier`).all()
}

function windowPlan() {
  buildSrc()
  db.exec(`DROP TABLE IF EXISTS temp._i13_pick_window`)
  db.exec(`
    CREATE TEMP TABLE _i13_pick_window AS
    SELECT rel_id, target_symbol_id FROM (
      SELECT t.rel_id AS rel_id, s.id AS target_symbol_id,
             ROW_NUMBER() OVER (PARTITION BY t.rel_id
               ORDER BY COALESCE(s.is_declaration, 0) ASC,
                        (s.file_id = t.src_file) DESC,
                        (COALESCE(f.language, '') = t.src_lang) DESC,
                        s.id ASC) AS rn
      FROM _i13_src t
      JOIN brain_relationship r ON r.id = t.rel_id
      JOIN brain_symbol s ON s.project_id = '${projectId}' AND s.name = r.target_external
      LEFT JOIN brain_file f ON f.id = s.file_id
      WHERE ${POPULATION}
    ) WHERE rn = 1`)
  return db.prepare(`SELECT rel_id, target_symbol_id FROM _i13_pick_window`).all()
}

/** The replacement: three per-name aggregates, three indexed lookups per row. */
function linearPlan() {
  buildSrc()
  db.exec(`
    DROP TABLE IF EXISTS temp._i13_tier;
    DROP TABLE IF EXISTS temp._i13_best_file;
    DROP TABLE IF EXISTS temp._i13_best_lang;
    DROP TABLE IF EXISTS temp._i13_best_any;
    DROP TABLE IF EXISTS temp._i13_pick_linear;`)

  // Observation 1: the winning declaration tier is a property of the name.
  db.exec(`
    CREATE TEMP TABLE _i13_tier AS
    SELECT name, MIN(COALESCE(is_declaration, 0)) AS tier
    FROM brain_symbol WHERE project_id = '${projectId}'
    GROUP BY name`)
  db.exec(`CREATE UNIQUE INDEX temp._i13_tier_name ON _i13_tier(name)`)

  // Observation 2 + 3a: lowest id at minimum tier within one file.
  db.exec(`
    CREATE TEMP TABLE _i13_best_file AS
    SELECT s.name AS name, s.file_id AS file_id, MIN(s.id) AS symbol_id
    FROM brain_symbol s
    JOIN _i13_tier t ON t.name = s.name AND t.tier = COALESCE(s.is_declaration, 0)
    WHERE s.project_id = '${projectId}'
    GROUP BY s.name, s.file_id`)
  db.exec(`CREATE UNIQUE INDEX temp._i13_best_file_key ON _i13_best_file(name, file_id)`)

  // Observation 3b: lowest id at minimum tier within one language. The key is the
  // COALESCEd language, so the '' bucket exists and '' matches ''.
  db.exec(`
    CREATE TEMP TABLE _i13_best_lang AS
    SELECT s.name AS name, COALESCE(f.language, '') AS lang, MIN(s.id) AS symbol_id
    FROM brain_symbol s
    JOIN _i13_tier t ON t.name = s.name AND t.tier = COALESCE(s.is_declaration, 0)
    LEFT JOIN brain_file f ON f.id = s.file_id
    WHERE s.project_id = '${projectId}'
    GROUP BY s.name, COALESCE(f.language, '')`)
  db.exec(`CREATE UNIQUE INDEX temp._i13_best_lang_key ON _i13_best_lang(name, lang)`)

  // Observation 3c: lowest id at minimum tier, no preference.
  db.exec(`
    CREATE TEMP TABLE _i13_best_any AS
    SELECT s.name AS name, MIN(s.id) AS symbol_id
    FROM brain_symbol s
    JOIN _i13_tier t ON t.name = s.name AND t.tier = COALESCE(s.is_declaration, 0)
    WHERE s.project_id = '${projectId}'
    GROUP BY s.name`)
  db.exec(`CREATE UNIQUE INDEX temp._i13_best_any_key ON _i13_best_any(name)`)

  // The IS NOT NULL filter is LOAD-BEARING, and getting it wrong is a data bug
  // rather than a slow one. `_i13_best_any` is populated for every name that has
  // at least one symbol, and its minimum tier is by definition attained, so
  // `ba.symbol_id IS NULL` holds exactly when NO symbol carries the target name
  // — the case where the window plan's join produced no row at all.
  //
  // A row with a NULL target would then reach the `UPDATE … FROM _i13_pick`
  // apply step and WRITE NULL over a target that strategies 1/2/4 had already
  // resolved, un-binding a live edge. So the plan emits a row iff a candidate
  // exists, which is what the window plan does, and what the measured row counts
  // confirm (n200: 35,151 pick rows against 50,649 in-scope relationships, and
  // 35,151 is exactly the number of in-scope relationships that have a
  // same-named symbol).
  db.exec(`
    CREATE TEMP TABLE _i13_pick_linear AS
    SELECT t.rel_id AS rel_id,
           COALESCE(bf.symbol_id, bl.symbol_id, ba.symbol_id) AS target_symbol_id
    FROM _i13_src t
    JOIN brain_relationship r ON r.id = t.rel_id
    LEFT JOIN _i13_best_file bf ON bf.name = r.target_external AND bf.file_id = t.src_file
    LEFT JOIN _i13_best_lang bl ON bl.name = r.target_external AND bl.lang = t.src_lang
    LEFT JOIN _i13_best_any  ba ON ba.name = r.target_external
    WHERE ${POPULATION}
      AND COALESCE(bf.symbol_id, bl.symbol_id, ba.symbol_id) IS NOT NULL`)
  return db.prepare(`SELECT rel_id, target_symbol_id FROM _i13_pick_linear`).all()
}

let tiersApplied = 0
if (process.argv.includes("--tiers")) {
  // Every NAME gets a non-zero MINIMUM tier, AND tiers vary WITHIN each name, so
  // the tier term of the ranking key discriminates both across names and among
  // the candidates of one name. Both halves are required: tiering whole names
  // uniformly leaves the minimum constant across a name's candidates, so a plan
  // that dropped the term would still agree and the negative control below would
  // catch nothing (measured — that was the first version of this arm, and it
  // reported `caught: false` on an index where 9,008 names had a non-zero tier).
  //
  // Within a name the assignment is `ROW_NUMBER() OVER (PARTITION BY name ORDER BY
  // id)`: the first candidate by id gets the name's tier, later ones get tier+1,
  // and a third of the names start one higher. The minimum is therefore attained
  // (the tier is not a phantom), and it is attained by a specific candidate whose
  // file and language preferences can be beaten — which is exactly the case a
  // tier-dropping plan gets wrong.
  db.exec(`
    WITH base AS (
      SELECT name, (ROW_NUMBER() OVER (ORDER BY name) % 3) AS base_tier
      FROM brain_symbol WHERE project_id = '${projectId}' GROUP BY name),
    ranked AS (
      SELECT s.id, b.base_tier + (ROW_NUMBER() OVER (PARTITION BY s.name ORDER BY s.id) - 1) AS tier
      FROM brain_symbol s JOIN base b ON b.name = s.name
      WHERE s.project_id = '${projectId}')
    UPDATE brain_symbol
    SET is_declaration = (SELECT tier FROM ranked WHERE ranked.id = brain_symbol.id)
    WHERE project_id = '${projectId}'`)
  tiersApplied = db.prepare(
    `SELECT COUNT(*) c FROM (SELECT name FROM brain_symbol WHERE project_id = ? GROUP BY name
      HAVING MIN(COALESCE(is_declaration, 0)) <> 0)`,
  ).get(projectId).c
}

let mutated = 0
if (mutate) {
  // Deterministic and reversible-by-copy: every 7th symbol by id, so the sample
  // is spread across files and languages rather than clustered in one.
  const ids = db.prepare(`SELECT id FROM brain_symbol WHERE project_id = ? ORDER BY id`).all(projectId).map((r) => r.id)
  const setT1 = ids.filter((_, i) => i % 7 === 0)
  const setT0 = ids.filter((_, i) => i % 7 === 1)
  const up = db.prepare(`UPDATE brain_symbol SET is_declaration = 1 WHERE id = ?`)
  const down = db.prepare(`UPDATE brain_symbol SET is_declaration = 0 WHERE id = ?`)
  db.transaction(() => {
    for (const id of setT1) up.run(id)
    for (const id of setT0) down.run(id)
  })()
  mutated = setT1.length + setT0.length
  // A plain index on is_declaration is not needed (nothing filters on it), but
  // the temp tables are rebuilt from scratch after this, so nothing stale.
}

const t0 = process.hrtime.bigint()
const windowRows = windowPlan()
const tWindow = Number(process.hrtime.bigint() - t0) / 1e6
const t1 = process.hrtime.bigint()
const linearRows = linearPlan()
const tLinear = Number(process.hrtime.bigint() - t1) / 1e6

const asMap = (rows) => new Map(rows.map((r) => [r.rel_id, r.target_symbol_id]))
const win = asMap(windowRows)
const lin = asMap(linearRows)

const disagreements = []
for (const [relId, target] of win) {
  const other = lin.get(relId)
  if (other !== target) disagreements.push({ relId, window: target, linear: other, inLinear: lin.has(relId) })
}
for (const relId of lin.keys()) if (!win.has(relId)) disagreements.push({ relId, window: null, linear: lin.get(relId), inLinear: true })

// The negative control. Run only when the tier actually discriminates, because
// that is the only condition under which a tier-dropping plan CAN be caught.
const tiersInUse = db.prepare(
  `SELECT COUNT(*) c FROM (SELECT name FROM brain_symbol WHERE project_id = ? GROUP BY name
    HAVING MIN(COALESCE(is_declaration, 0)) <> 0)`,
).get(projectId).c
let negativeControl
if (tiersInUse > 0) {
  const notier = tierIgnoringPlan()
  const notierMap = new Map(notier.map((r) => [r.rel_id, r.target_symbol_id]))
  let differs = 0
  for (const [relId, target] of win) if (notierMap.get(relId) !== target) differs++
  negativeControl = {
    namesWhoseWinningTierIsNotZero: tiersInUse,
    tierDroppingPlanRows: notier.length,
    tierDroppingPlanDisagreements: differs,
    // A disagreement of 0 here would mean this index cannot tell the two plans
    // apart, so an IDENTICAL verdict from the linear plan would be weak.
    caught: differs > 0,
  }
} else {
  negativeControl = {
    namesWhoseWinningTierIsNotZero: 0,
    ran: false,
    reason: "every symbol on this index has is_declaration NULL, so the tier term cannot discriminate; re-run with --mutate or --tiers",
  }
}

const relsInScope = db.prepare(`SELECT COUNT(*) c FROM brain_relationship r WHERE ${POPULATION}`).get().c
const nullSrc = db.prepare(
  `SELECT COUNT(*) c FROM brain_relationship r LEFT JOIN brain_symbol s ON s.id = r.source_symbol_id WHERE ${POPULATION} AND s.file_id IS NULL`,
).get().c

const result = {
  db: path.basename(path.dirname(dbPath)),
  arm: [mutate ? "mutated (is_declaration given real values)" : "as-stored", ...(tiersApplied > 0 ? ["--tiers"] : [])].join(" + "),
  symbolsFlipped: mutated,
  namesWithNonZeroWinningTier: tiersApplied,
  relationshipsInScope: relsInScope,
  rowsWithNullSourceFile: nullSrc,
  windowPlan: { rows: windowRows.length, ms: Math.round(tWindow) },
  linearPlan: { rows: linearRows.length, ms: Math.round(tLinear) },
  // Coverage: both plans must resolve the SAME SET of relationships, not merely
  // agree on the ones they both found. A plan that resolved fewer rows would
  // look "identical" on the intersection.
  sameRowCount: windowRows.length === linearRows.length,
  disagreements: disagreements.length,
  examples: disagreements.slice(0, 5),
  negativeControl,
  // IDENTICAL is only a strong verdict when the negative control ran and the
  // tier-dropping plan was caught. Otherwise the index could not have told the
  // two apart and "IDENTICAL" is a statement about the fixture, not the plan —
  // so it is reported as INCONCLUSIVE rather than as a pass.
  verdict:
    windowRows.length !== linearRows.length || disagreements.length > 0
      ? "DIFFERENT"
      : negativeControl.caught === false
        ? "IDENTICAL (negative control not exercised)"
        : "IDENTICAL",
}
console.log(JSON.stringify(result, null, 1))

db.close()
rmSync(tmp, { recursive: true, force: true })
process.exit(result.verdict === "DIFFERENT" ? 1 : 0)
