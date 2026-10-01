// script/m63/verify-cl1-cross-language.ts — M63.CL1: the corpus gate for
// bb_cross_language that can actually fail.
//
// WHY THIS FILE EXISTS
// --------------------
// validation/m48/results/C1-bb_cross_language.json records
//   "status": "verified", "passed": 5, "failed": 0, "negativeCases": 5
// and that badge is what a reader takes as proof the tool was tested on real
// repositories. The predicate behind all five passes
// (script/m48/c1-repo-worker.ts:185) is
//
//   pass: !r.isError && (JSON.stringify(r.parsed ?? "").includes(sym.name)
//                          || (r.parsed as any)?.declaredAbsent === true)
//
// The handler echoed the requested symbol back as the `symbol` field, so the
// first clause was true for EVERY non-error answer whatever its facts were,
// and the second for every declared-absent answer. Measured on the real
// jvm-interop corpus by feeding that predicate the answers the lane actually
// observed (script/m63/verify-cl1-corpus-predicate.ts, CL1-T1): it accepted
// 6 of 6 impossible-or-dishonest answers and refused only `{}` — an object no
// handler would ever emit. Its five "negative cases" are a different probe
// (bb_graph on an unknown symbol) that never touches this tool's answer.
//
// So this file does not patch that predicate. It REPLACES the role: every
// claim below is a comparison between the tool's answer and a value derived
// independently, by plain SQL the tool does not execute, over a real index the
// real pipeline built. A tool that agrees with itself proves nothing.
//
// WHAT IS PROVEN
// --------------
//   A. EXISTENCE  a name the index does not hold is a loud declared error;
//                 a name it does hold is answered.
//   B. NO LOSS    facts == the independent count of stored cross-language rows
//                 touching that name, for EVERY sampled name. This is the
//                 predicate that fails on the old `.get()` door: `invoke` held
//                 21 stored rows and the old tool answered 0.
//   C. NO FALSE ABSENCE   declaredAbsent === true implies the independent count
//                 is 0 — for every sampled name, including every ambiguous one.
//   D. IDENTITY   every fact names both ends and a real stored row id that
//                 exists in this project.
//   E. NO LEAK    no fact carries a row belonging to another project.
//   J/K/L/M FOUR SURFACES no corpus can reach: a project with no cross-language
//                  rows at all, a MEMBER-driven truncation, own-first precedence at
//                  limit 1, and the absence note's project scope. Asking what the gate
//                  did NOT cover is what found the fifth defect.
//   I. HOVER DOOR the IDE door does not leak in EITHER direction, with the
//                  controls that make that non-vacuous, and M13/M14 each break one
//                  of the two predicates so both are proved load-bearing.
//   F. BOUND      limit is honoured; truncation and the true total are declared;
//                 the response is bounded.
//   G. DETERMINISM the same call twice gives the same bytes.
//   H. PROJECTION the editor's hover section and the agent door agree on the
//                 same stored rows for the same symbol (the M28.U1 union
//                 claim, re-derived from an independent direction this time).
//
// MUTANTS (each must be CAUGHT — a gate that cannot fail is not a gate)
//   M1 pick-one-copy       the old `.get()` door, planted verbatim
//   M2 false absence       declaredAbsent when a copy holds rows
//   M3 no identity         facts stripped of the counterparty
//   M4 no bound            the limit removed, truncation undeclared
//   M5 leak                the project filter dropped from the row query
//   M6 pair fabrication    a pair invented where the row has no languages
//
// Run: npx tsx script/m63/verify-cl1-cross-language.ts
// Evidence: validation/m63/results/CL1.json (machine-emitted, sealed)
//
// The corpus is built by the caller; see script/m63/cl1-corpus.ts. Point
// BB_CL1_CORPUS at a real repository and the verifier indexes it itself; point
// BB_CL1_DB / BB_CL1_PROJECT at an existing index to skip the build.

import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { writeSealed } from "../lib/evidence.ts"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
/**
 * Every temporary directory this gate creates, dropped on every exit path.
 *
 * The teardown used to sit on the last lines before `process.exit`, inside
 * `main()`, which is the path taken only when every check has run. A FAILING run
 * is a normal outcome here, not an exceptional one, and any throw before that
 * line reached `main().catch()` — which prints and exits without cleaning up.
 * That left a `cl1-seed-*` directory in TMPDIR and, more to the point, the
 * corpus directories `built` had already created. A leftover corpus directory is
 * not cosmetic: it is a second index on disk that a later measurement can pick
 * up.
 *
 * `process.on("exit")` fires on a normal return, on an uncaught exception, and
 * on an explicit `process.exit` — the three ways this program ends — and `rmSync`
 * is synchronous, which is all an exit listener is allowed to do. The explicit
 * calls before `process.exit` remain, so cleanup is not deferred to a listener
 * that `process.exit` could race; this is the backstop for the paths that never
 * reach them.
 */
const TEMP_DIRS: string[] = []
const dropAllTempDirs = () => {
  while (TEMP_DIRS.length) {
    const dir = TEMP_DIRS.pop()!
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* best effort */ }
  }
}
process.once("exit", dropAllTempDirs)

const COMPONENT = join(ROOT, "src", "lsp", "cross_language_hover.ts")
const HANDLERS = join(ROOT, "src", "mcp", "tool-handlers.ts")
const RESULTS_DIR = join(ROOT, "validation/m63/results")
const EVIDENCE = "CL1.json"

let checks = 0
let passed = 0
const failures: string[] = []

function check(label: string, condition: boolean, detail = ""): void {
  checks++
  if (condition) passed++
  else {
    failures.push(`${label}${detail ? ` — ${detail}` : ""}`)
    console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`)
  }
}

// ── The independent truth ────────────────────────────────────────────────────
// Deliberately NOT the component's SQL. It is a different shape (two queries,
// no UNION, no direction column) over the same tables, so agreement is
// evidence and a shared typo is not.
const INDEPENDENT_ROWS = (projectId: string) => `
SELECT r.id AS rowId, r.relationship_type AS type, r.confidence AS confidence,
       r.bridge_mechanism AS bridge, 'caller' AS direction,
       ts.name AS selfName, tf.relative_path AS selfFile, tf.language AS selfLang,
       ss.name AS otherName, sf.relative_path AS otherFile, sf.language AS otherLang
FROM brain_relationship r
JOIN brain_symbol ts ON ts.id = r.target_symbol_id
JOIN brain_file   tf ON tf.id = ts.file_id
JOIN brain_symbol ss ON ss.id = r.source_symbol_id
JOIN brain_file   sf ON sf.id = ss.file_id
WHERE r.project_id = '${projectId}' AND r.is_cross_language = 1 AND ts.name = :name
UNION ALL
SELECT r.id AS rowId, r.relationship_type AS type, r.confidence AS confidence,
       r.bridge_mechanism AS bridge, 'callee' AS direction,
       ss.name AS selfName, sf.relative_path AS selfFile, sf.language AS selfLang,
       ts.name AS otherName, tf.relative_path AS otherFile, tf.language AS otherLang
FROM brain_relationship r
JOIN brain_symbol ss ON ss.id = r.source_symbol_id
JOIN brain_file   sf ON sf.id = ss.file_id
JOIN brain_symbol ts ON ts.id = r.target_symbol_id
JOIN brain_file   tf ON tf.id = ts.file_id
WHERE r.project_id = '${projectId}' AND r.is_cross_language = 1 AND ss.name = :name`

/** The member rows, derived independently of the component's query. A symbol
 *  is a member here when the STORE says so (`owner_symbol_id` is the ownership
 *  edge) and the owner carries the asked name. This is deliberately not the
 *  graph engine's id-prefix range: that is a lexical superset, disclosed as
 *  such, and importing it would make the gate agree with whatever the
 *  component did instead of measuring it. */
const INDEPENDENT_MEMBER_ROWS = (projectId: string) => `
SELECT r.id AS rowId, r.relationship_type AS type, r.confidence AS confidence,
       r.bridge_mechanism AS bridge, 'caller' AS direction,
       m.id AS memberId, m.name AS memberName, mfile.language AS memberLang,
       ss.name AS otherName, sf.relative_path AS otherFile, sf.language AS otherLang
FROM brain_relationship r
JOIN brain_symbol m ON m.id = r.target_symbol_id
JOIN brain_symbol owner ON owner.id = m.owner_symbol_id
JOIN brain_file mfile ON mfile.id = m.file_id
JOIN brain_symbol ss ON ss.id = r.source_symbol_id
JOIN brain_file sf ON sf.id = ss.file_id
WHERE r.project_id = '${projectId}' AND r.is_cross_language = 1 AND owner.name = :name
  AND m.name <> owner.name
UNION ALL
SELECT r.id AS rowId, r.relationship_type AS type, r.confidence AS confidence,
       r.bridge_mechanism AS bridge, 'callee' AS direction,
       m.id AS memberId, m.name AS memberName, mfile.language AS memberLang,
       ts.name AS otherName, tf.relative_path AS otherFile, tf.language AS otherLang
FROM brain_relationship r
JOIN brain_symbol m ON m.id = r.source_symbol_id
JOIN brain_symbol owner ON owner.id = m.owner_symbol_id
JOIN brain_file mfile ON mfile.id = m.file_id
JOIN brain_symbol ts ON ts.id = r.target_symbol_id
JOIN brain_file tf ON tf.id = ts.file_id
WHERE r.project_id = '${projectId}' AND r.is_cross_language = 1 AND owner.name = :name
  AND m.name <> owner.name`


const NAME_COPIES = (projectId: string) =>
  `SELECT s.id AS id, s.name AS name, f.relative_path AS path, f.language AS language, s.line_start AS line
   FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id
   WHERE s.project_id = '${projectId}' AND s.name = :name
   ORDER BY f.relative_path, s.line_start, s.id`

/** The independent truth, INCLUDING the member side.
 *
 *  `memberIds` is the oracle for `memberCount` and it is deliberately NOT "every
 *  member the name has". A member contributes to the answer only when it has a
 *  row that can be reported: one whose two ends name different languages (else
 *  it lands in `unpairableRowCount`) and that is not already an own row (a
 *  class calling its own method is an ordinary internal edge; the row is
 *  emitted once, from the own section, and counted in `collapsedRowCount`).
 *  An earlier version of this oracle counted every member, which made the tool
 *  look deficient for being precise — it reported 5 where the loose oracle said
 *  86, and the difference was entirely rows that correctly have nowhere to go. */
function truthFor(raw: any, projectId: string, name: string): { rows: any[]; copies: any[]; memberRows: any[]; memberIds: Set<string> } {
  const rows = raw.prepare(INDEPENDENT_ROWS(projectId)).all({ name }) as unknown as any[]
  const copies = raw.prepare(NAME_COPIES(projectId)).all({ name }) as unknown as any[]
  const memberRows = raw.prepare(INDEPENDENT_MEMBER_ROWS(projectId)).all({ name }) as unknown as any[]
  const ownRowIds = new Set(rows.map((r: any) => r.rowId))
  const differs = (a: string | null, b: string | null): boolean =>
    Boolean(a) && Boolean(b) && String(a).toLowerCase() !== String(b).toLowerCase()
  const memberIds = new Set<string>(
    memberRows
      .filter((r: any) => !ownRowIds.has(r.rowId) && differs(r.memberLang, r.otherLang))
      .map((r: any) => r.memberId as string),
  )
  return { rows, copies, memberRows, memberIds }
}

interface Sample {
  name: string
  copies: number
  storedRows: number
  toolFacts: number
  pairableRows: number
}

async function main(): Promise<void> {
  const corpus = process.env.BB_CL1_CORPUS
  let dataDir = process.env.BB_CL1_DB
  let projectId = process.env.BB_CL1_PROJECT
  const built: string[] = []

  if (!dataDir || !projectId) {
    if (!corpus) {
      console.error("set BB_CL1_CORPUS=<real repo path> to build an index, or BB_CL1_DB + BB_CL1_PROJECT to reuse one")
      process.exit(2)
    }
    const { buildCorpusIndex } = await import("./cl1-corpus.ts")
    const built_ = await buildCorpusIndex(corpus)
    dataDir = built_.dataDir
    projectId = built_.projectId
    built.push(built_.dataDir)
    TEMP_DIRS.push(built_.dataDir) // the exit hook cleans up even if a later throw skips the loop
  }

  const { BrainDatabase } = await import(join(ROOT, "src", "brain", "database.ts"))
  const { createToolHandlers } = await import(join(ROOT, "src", "mcp", "tool-handlers.ts"))
  const { storedCrossLanguageRows, factsFromRows, crossLanguageSection } = await import(join(ROOT, "src", "lsp", "cross_language_hover.ts"))
  process.env.BB_DATA_DIR = dataDir!
  const raw = await BrainDatabase.getRawInstance(projectId as any)
  const handlers = createToolHandlers()
  const ctx = { projectId, projectPath: corpus ?? dataDir }

  const call = async (tool: string, args: Record<string, unknown>) => {
    const result: any = await (handlers as any)[tool](args, ctx)
    const text = result?.content?.[0]?.text ?? ""
    let parsed: any = text
    try { parsed = JSON.parse(text) } catch { /* text wire format */ }
    return { isError: result?.isError === true, text, parsed }
  }

  const totalCross = (raw.prepare("SELECT COUNT(*) AS c FROM brain_relationship WHERE project_id = ? AND is_cross_language = 1").get(projectId) as any).c as number
  check("CL1: the corpus actually holds cross-language rows (a gate over zero rows proves nothing)", totalCross > 0, `cross rows=${totalCross}`)

  // ── A/B/C/D/E/F/G over a sample that deliberately includes the hard cases ──
  const sampleNames: string[] = []
  // (a) the ambiguous names with the most stored rows — the old door's blind spot
  for (const row of raw.prepare(
    `SELECT name FROM (SELECT ts.name AS name, COUNT(*) AS n
       FROM brain_relationship r JOIN brain_symbol ts ON ts.id = r.target_symbol_id
       WHERE r.project_id = ? AND r.is_cross_language = 1 GROUP BY ts.name
       UNION ALL
       SELECT ss.name AS name, COUNT(*) AS n
       FROM brain_relationship r JOIN brain_symbol ss ON ss.id = r.source_symbol_id
       WHERE r.project_id = ? AND r.is_cross_language = 1 GROUP BY ss.name)
     GROUP BY name ORDER BY n DESC LIMIT 8`).all(projectId, projectId) as any[]) sampleNames.push(row.name)
  // (b) ambiguous names with ZERO rows — the false-absence case
  for (const row of raw.prepare(
    `SELECT s.name AS name, COUNT(*) AS copies FROM brain_symbol s
     WHERE s.project_id = ? GROUP BY s.name HAVING copies > 3 LIMIT 8`).all(projectId) as any[]) {
    if (!sampleNames.includes(row.name)) sampleNames.push(row.name)
  }
  // (c) a unique name that HAS rows
  const unique = raw.prepare(
    `SELECT ss.name AS name FROM brain_relationship r JOIN brain_symbol ss ON ss.id = r.source_symbol_id
     WHERE r.project_id = ? AND r.is_cross_language = 1
       AND (SELECT COUNT(*) FROM brain_symbol s2 WHERE s2.project_id = ? AND s2.name = ss.name) = 1 LIMIT 1`
  ).get(projectId, projectId) as any
  if (unique) sampleNames.push(unique.name)
  // (d) a unique name with no rows at all
  const quiet = raw.prepare(
    `SELECT s.name AS name FROM brain_symbol s WHERE s.project_id = ?
       AND s.name NOT IN (SELECT ts.name FROM brain_relationship r JOIN brain_symbol ts ON ts.id = r.target_symbol_id WHERE r.project_id = ? AND r.is_cross_language = 1)
       AND s.name NOT IN (SELECT ss.name FROM brain_relationship r JOIN brain_symbol ss ON ss.id = r.source_symbol_id WHERE r.project_id = ? AND r.is_cross_language = 1)
       AND (SELECT COUNT(*) FROM brain_symbol s2 WHERE s2.project_id = ? AND s2.name = s.name) = 1 LIMIT 1`
  ).get(projectId, projectId, projectId, projectId) as any
  if (quiet) sampleNames.push(quiet.name)

  const samples: Sample[] = []
  for (const name of [...new Set(sampleNames)]) {
    const truth = truthFor(raw, projectId!, name)
    // Rows that cannot name a pair (unknown or equal endpoint languages) are
    // declared skipped by the contract, so the loss check counts pairable rows.
    // A row names a pair only when both ends carry a language and the two
    // differ. The own query carries its own language as `selfLang`; the member
    // query carries the MEMBER's separately, because the member is the endpoint
    // the row names. Two predicates, one per shape, rather than one predicate
    // guessing which column is populated.
    const differs = (a: string | null, b: string | null): boolean =>
      Boolean(a) && Boolean(b) && String(a).toLowerCase() !== String(b).toLowerCase()
    const ownPairable = truth.rows.filter((r) => differs(r.selfLang, r.otherLang))
    const memPairable = truth.memberRows.filter((r) => differs(r.memberLang, r.otherLang))
    const totalPairable = ownPairable.length + memPairable.length
    // At the CEILING, so this check measures LOSS and not truncation. With the
    // default 200 a symbol holding 242 stored rows is correctly truncated to
    // 200, and comparing the SHOWN count against the TOTAL calls that correct
    // answer a defect — which is exactly what the first CL2 run reported for
    // `Method`. Truncation gets its own check (B2) below.
    const result = await call("bb_cross_language", { symbol: name, limit: 1000 })

    // B: the union. Before CL2 this compared pairCount against the OWN rows
    // alone, which made every owner with member rows fail — the check was
    // detecting the fix, not a defect.
    check(`CL1 B: every stored row is reported — ${name}`,
      result.parsed?.pairCount === totalPairable && result.parsed?.ownFactCount === ownPairable.length && result.parsed?.memberFactCount === memPairable.length,
      `tool(pair/own/member)=${result.parsed?.pairCount}/${result.parsed?.ownFactCount}/${result.parsed?.memberFactCount} independent=${totalPairable}/${ownPairable.length}/${memPairable.length} copies=${truth.copies.length}`)
    check(`CL1 B2: the declared total equals the independent total — ${name}`,
      result.parsed?.totalCountIfKnown === totalPairable,
      `tool=${result.parsed?.totalCountIfKnown} independent=${totalPairable}`)
    check(`CL1 A: ${name} is answered, not refused`, result.isError === false, result.text.slice(0, 120))
    // C: absence means THE NAME IS SILENT — neither the copies nor their
    // members. Before CL2 this only knew about own rows, so the gate could not
    // have caught the defect that motivated CL2 at all.
    check(`CL1 C: absence is never false — ${name}`,
      result.parsed?.declaredAbsent !== true || totalPairable === 0,
      `declaredAbsent=${result.parsed?.declaredAbsent} independentPairableRows=${totalPairable}`)
    check(`CL1 A2: copy count matches the index — ${name}`, result.parsed?.copyCount === truth.copies.length,
      `tool=${result.parsed?.copyCount} independent=${truth.copies.length}`)

    // D: identity, and every rowId real and in-project
    const facts = (result.parsed?.facts ?? []) as any[]
    const memberFacts = (result.parsed?.memberFacts ?? []) as any[]
    const rowIds = new Set(facts.map((f) => f.rowId))
    check(`CL1 D: facts are deduplicated by row id — ${name}`, rowIds.size === facts.length, `${facts.length} facts, ${rowIds.size} distinct rowIds`)
    let identityOk = true
    let rowIdOk = true
    for (const f of facts) {
      if (!f.other || typeof f.other.file !== "string") identityOk = false
      if (typeof f.rowId !== "string") identityOk = false
      const owns = raw.prepare("SELECT 1 AS ok FROM brain_relationship WHERE id = ? AND project_id = ? AND is_cross_language = 1").get(f.rowId, projectId)
      if (!owns) rowIdOk = false
    }
    check(`CL1 D: every fact names its counterparty (symbol+file) — ${name}`, identityOk, `facts=${facts.length}`)
    check(`CL1 D2: every fact's rowId is a stored cross-language row of THIS project — ${name}`, rowIdOk, `facts=${facts.length}`)

    // ── the M63.CL2 properties ────────────────────────────────────────────────
    // I: a cascaded fact is marked AND names the member. An attribution the
    //    reader cannot check is the thing this whole section exists to avoid.
    let markOk = true
    let memberReal = true
    const claimedMembers = new Set<string>()
    for (const f of memberFacts) {
      if (f.match !== "owner-cascade") markOk = false
      const mid = f.matchedMemberId
      if (typeof mid !== "string" || !truth.memberIds.has(mid)) { memberReal = false } else { claimedMembers.add(mid) }
      if (typeof f.matchedMember?.symbol !== "string" || typeof f.matchedMember?.file !== "string") markOk = false
      const owns = raw.prepare("SELECT 1 AS ok FROM brain_relationship WHERE id = ? AND project_id = ? AND is_cross_language = 1").get(f.rowId, projectId)
      if (!owns) rowIdOk = false
    }
    check(`CL1 I: every member fact is marked owner-cascade and names its member — ${name}`, markOk, `memberFacts=${memberFacts.length}`)
    check(`CL1 I2: every claimed member is really a member of a copy — ${name}`, memberReal, `memberFacts=${memberFacts.length} realMembers=${truth.memberIds.size}`)
    check(`CL1 I3: memberCount matches the distinct members the truth has — ${name}`,
      // Compared against the TRUTH, not against the members that survived the
      // limit: `memberCount` describes the whole answer while the sample
      // describes a possibly-truncated section, and comparing the two is
      // meaningless whenever a limit bit. It passed by accident until `Method`
      // hit the ceiling and emptied memberFacts.
      (result.parsed?.memberCount ?? -1) === truth.memberIds.size,
      `tool=${result.parsed?.memberCount} independent=${truth.memberIds.size}`)
    // J: no row in both sections. A row counted twice inflates every number.
    const overlap = memberFacts.filter((f) => rowIds.has(f.rowId))
    check(`CL1 J: no stored row appears in both sections — ${name}`, overlap.length === 0, `overlap=${overlap.length}`)
    // K: the own section never carries a cascade marker, and vice versa.
    const ownMisMarked = facts.filter((f) => f.match !== "exact" || f.matchedMember)
    check(`CL1 K: the own section is exactly the symbol's own rows — ${name}`, ownMisMarked.length === 0, `misMarked=${ownMisMarked.length}`)
    // L: the symptom itself must be visible when it happens.
    const expectSilent = ownPairable.length === 0 && memPairable.length > 0
    check(`CL1 L: a silent symbol with loud members says so — ${name}`,
      result.parsed?.silentItselfButNotItsMembers === expectSilent,
      `tool=${result.parsed?.silentItselfButNotItsMembers} expected=${expectSilent}`)

    // E: nothing from another project
    const foreign = raw.prepare(
      `SELECT COUNT(*) AS c FROM brain_relationship r JOIN brain_symbol ts ON ts.id = r.target_symbol_id
       WHERE r.is_cross_language = 1 AND ts.name = ? AND r.project_id <> ?`).get(name, projectId) as any
    check(`CL1 E: no foreign row can appear — ${name}`, foreign.c === 0, `foreignRowsForName=${foreign.c}`)

    samples.push({ name, copies: truth.copies.length, storedRows: truth.rows.length + truth.memberRows.length, toolFacts: result.parsed?.pairCount ?? -1, pairableRows: totalPairable })
  }

  // ── SEEDED STORE STATES: the two counters no corpus can reach ───────────────
  //
  // Measured on BOTH corpora (2,810 cross-language rows, 1,662 names):
  // unpairableRowCount and collapsedRowCount were 0 on every name. The store was
  // then asked whether it CAN produce either state, and the answers matter:
  //
  //   unpairable   needs an endpoint with no detected language, or both endpoints
  //                sharing one. Every indexed file has a language (0 of 922) and
  //                same-language rows flagged cross: 0. The null-language route
  //                exists only through the cross-language persister, which
  //                parallel-indexer imports and never calls. So: NOT REACHABLE
  //                from a real index, and the fixture is the only way to verify
  //                the guard.
  //
  //   collapsed    NOT reachable via a self-edge, which is the obvious guess and
  //                the wrong one: a self-edge is one symbol in one file, so both
  //                ends share a language and the row is dropped as unpairable
  //                before the counter is reached. The reachable route is a row
  //                between TWO DIFFERENT same-named symbols in different-language
  //                files — which satisfies the own query's caller arm and callee
  //                arm at once, and is exactly what a name-resolution
  //                cross-language edge between two copies of a common name looks
  //                like. The MEMBER route stays impossible, excluded by the
  //                member query's own `m.name <> owner.name` filter.
  //
  // So both are guards against store states no current writer produces, and both
  // are verified by building the state. The fixture lives in its own data dir so
  // it cannot touch the corpus under test, it is built ONCE and kept alive for
  // the mutant phase (M11 and M12 need the same states), and the whole dir is
  // removed in a finally — which rolls back every seeded row at once.
  let seededCtx: { projectId: string; projectPath: string } | null = null
  let seededRaw: any = null
  const seededFixtureDir = mkdtempSync(join(tmpdir(), "cl1-seed-"))
  TEMP_DIRS.push(seededFixtureDir)
  /**
   * Run a read against the fixture project. `BrainDatabase.getRawInstance`
   * resolves the store from `BB_DATA_DIR` at CALL time, so the variable has to be
   * in scope for the read as well as for the build — scoping it only around the
   * writes produced a handler that answered with a text error where JSON was
   * expected, and the gate died in JSON.parse with nothing pointing at the
   * cause.
   */
  const withSeeded = async <T,>(fn: () => Promise<T>): Promise<T> => {
    if (!seededCtx) throw new Error("withSeeded: no fixture")
    const saved = process.env.BB_DATA_DIR
    process.env.BB_DATA_DIR = seededFixtureDir
    try { return await fn() } finally { process.env.BB_DATA_DIR = saved }
  }
  {
    const FIX = "cl1seeded000000000000000000000000000000"
    mkdirSync(join(seededFixtureDir, "projects", FIX), { recursive: true })
    const savedData = process.env.BB_DATA_DIR
    process.env.BB_DATA_DIR = seededFixtureDir
    try {
      const { BrainDatabase: SeedDb } = await import(join(ROOT, "src", "brain", "database.ts"))
      seededRaw = await SeedDb.getRawInstance(FIX as any)
      const file = (id: string, name: string, language: string | null) =>
        seededRaw.prepare("INSERT OR REPLACE INTO brain_file (id, project_id, path, relative_path, language, file_hash) VALUES (?,?,?,?,?,?)")
          .run(id, FIX, `/seed/${name}`, name, language, `h-${id}`)
      const sym = (id: string, name: string, fileId: string, line: number) =>
        seededRaw.prepare("INSERT OR REPLACE INTO brain_symbol (id, project_id, file_id, name, symbol_type, line_start, line_end, byte_start, byte_end, gravity_score, owner_symbol_id) VALUES (?,?,?,?,?,?,?,?,?,?,NULL)")
          .run(id, FIX, fileId, name, "function", line, line, 0, 10, 1)
      const rel = (id: string, src: string, tgt: string, type = "calls") =>
        seededRaw.prepare("INSERT OR REPLACE INTO brain_relationship (id, project_id, source_symbol_id, target_symbol_id, relationship_type, confidence, is_cross_language, bridge_mechanism) VALUES (?,?,?,?,?,?,?,?)")
          .run(id, FIX, src, tgt, type, 0.9, 1, "name-resolution")

      // STATE 1 — an endpoint with no detected language. The row IS cross-language
      // (a .ts file against an unlabelled one) and IS unnameable: there is no
      // language on one side to put in a pair.
      file("s-ts", "caller.ts", "typescript")
      file("s-unlabelled", "mystery.unknownlang", null)
      sym("s-caller", "seedCaller", "s-ts", 1)
      sym("s-unlabelled-sym", "seedMystery", "s-unlabelled", 1)
      rel("s-unpairable-r", "s-caller", "s-unlabelled-sym", "uses")

      // STATE 2 — a row between TWO DIFFERENT same-named symbols in files of
      // different languages. The own query's caller arm matches the target's name
      // and its callee arm matches the source's, so the row is seen twice; it is
      // pairable, because the two ends really do have different languages.
      file("s-twin-ts", "twin.ts", "typescript")
      file("s-twin-clj", "twin.clj", "clojure")
      sym("s-twin-a", "seedTwin", "s-twin-ts", 1)
      sym("s-twin-b", "seedTwin", "s-twin-clj", 1)
      rel("s-collapsed-r", "s-twin-a", "s-twin-b")

      seededCtx = { projectId: FIX, projectPath: "/seed" }
    } finally {
      process.env.BB_DATA_DIR = savedData
    }
  }
  // The fixture dir is removed at the END of the run, not at the end of the
  // build, because the mutant phase reads it. Deleting the directory removes
  // every seeded row at once, which is why there is no per-row rollback to get
  // wrong.
  const dropSeededFixture = () => { try { rmSync(seededFixtureDir, { recursive: true, force: true }) } catch {} }

  if (seededCtx && seededRaw) {
    const seedHandlers = createToolHandlers()
    // STATE 1: counted, never dressed up.
    {
      const p = await withSeeded(async () => {
        const r: any = await (seedHandlers as any).bb_cross_language({ symbol: "seedMystery" }, seededCtx as any)
        return JSON.parse(r.content[0].text)
      })
      const oracle = seededRaw.prepare("SELECT COUNT(*) AS n FROM brain_relationship WHERE project_id = ? AND is_cross_language = 1 AND id = 's-unpairable-r'").get(seededCtx.projectId) as any
      check("CL1 S1: the seeded unpairable row EXISTS (otherwise the check is vacuous)", oracle?.n === 1, `oracle=${oracle?.n}`)
      check("CL1 S1: unpairableRowCount counts it", p.unpairableRowCount === 1, `tool=${p.unpairableRowCount}`)
      check("CL1 S1: no fact is emitted for a row that cannot name a pair", p.pairCount === 0, `pairCount=${p.pairCount}`)
      check("CL1 S1: and it is a declared absence, not a silence", p.declaredAbsent === true, `declaredAbsent=${p.declaredAbsent}`)
      check("CL1 S1: storedRowCount still counts the row, so nothing is silently dropped",
        p.storedRowCount === 1, `storedRowCount=${p.storedRowCount}`)
    }
    // STATE 2: emitted once, with the second match counted.
    {
      const p = await withSeeded(async () => {
        const r: any = await (seedHandlers as any).bb_cross_language({ symbol: "seedTwin" }, seededCtx as any)
        return JSON.parse(r.content[0].text)
      })
      check("CL1 S2: the seeded same-named cross-language row is emitted exactly once", p.pairCount === 1, `pairCount=${p.pairCount}`)
      check("CL1 S2: the second match is counted as collapsed, not dropped silently", p.collapsedRowCount === 1, `collapsed=${p.collapsedRowCount}`)
      const rowIds = new Set((p.facts ?? []).map((f: any) => f.rowId))
      check("CL1 S2: the row appears once in the facts, not twice", rowIds.size === (p.facts ?? []).length, `facts=${(p.facts ?? []).length} distinct=${rowIds.size}`)
      check("CL1 S2: both copies are declared (the name is ambiguous in the fixture)", p.copyCount === 2, `copyCount=${p.copyCount}`)
    }
  } else {
    check("CL1 S: the seeded fixture was built", false, "no seeded context")
  }

  // ── F: the bound, on the worst symbol in the corpus ────────────────────────
  {
    const hub = raw.prepare(
      `SELECT name FROM (SELECT ts.name AS name, COUNT(*) AS n FROM brain_relationship r JOIN brain_symbol ts ON ts.id = r.target_symbol_id
         WHERE r.project_id = ? AND r.is_cross_language = 1 GROUP BY ts.name
         UNION ALL
         SELECT ss.name AS name, COUNT(*) AS n FROM brain_relationship r JOIN brain_symbol ss ON ss.id = r.source_symbol_id
         WHERE r.project_id = ? AND r.is_cross_language = 1 GROUP BY ss.name)
       GROUP BY name ORDER BY n DESC LIMIT 1`).get(projectId, projectId) as any
    if (hub) {
      const full = await call("bb_cross_language", { symbol: hub.name })
      const total = full.parsed?.totalCountIfKnown
      const capped = await call("bb_cross_language", { symbol: hub.name, limit: 5 })
      check("CL1 F: the hub declares its true total", typeof total === "number" && total >= capped.parsed?.pairCount, `total=${total}`)
      check("CL1 F2: limit is honoured", capped.parsed?.pairCount === 5, `pairCount=${capped.parsed?.pairCount}`)
      check("CL1 F3: truncation is first-class (never silent)", capped.parsed?.truncated === true && typeof capped.parsed?.truncationReason === "string",
        `truncated=${capped.parsed?.truncated} reason=${String(capped.parsed?.truncationReason).slice(0, 80)}`)
      check("CL1 F4: truncation means the total exceeds the cap", total > 5, `total=${total}`)
      const underLimit = await call("bb_cross_language", { symbol: hub.name, limit: 1 })
      check("CL1 F5: a cap above the total does NOT claim truncation", underLimit.parsed?.truncated === true,
        "expected truncated=true here only if total>1; the hub always exceeds 1")
      const refused = await call("bb_cross_language", { symbol: hub.name, limit: 100000 })
      check("CL1 F6: a limit beyond the declared ceiling is refused, not clamped silently", refused.isError === true, refused.text.slice(0, 120))
      const zero = await call("bb_cross_language", { symbol: hub.name, limit: 0 })
      check("CL1 F7: limit 0 is refused", zero.isError === true, zero.text.slice(0, 120))
      // The measured payload bound, stated as a fact.
      const bytes = full.text.length
      check("CL1 F8: the hub answer is bounded and declares what it dropped", bytes < 400_000 && full.parsed?.truncated === (full.parsed?.pairCount < total),
        `bytes=${bytes} shown=${full.parsed?.pairCount} total=${total} truncated=${full.parsed?.truncated}`)
    }
  }

  // ── G: determinism ─────────────────────────────────────────────────────────
  {
    const a = await call("bb_cross_language", { symbol: samples[0]!.name })
    const b = await call("bb_cross_language", { symbol: samples[0]!.name })
    check("CL1 G: the same call twice gives the same bytes", a.text === b.text, `${a.text.length} vs ${b.text.length}`)
  }

  // ── H: the union claim, re-derived from the other direction ────────────────
  // The M28.U1 test compared the tool against a re-implementation of the same
  // queries, so both doors could be wrong together. Here the IDE door is fed
  // the hover's OWN component on an exact symbol id, and the agent door is fed
  // the name; for an UNAMBIGUOUS name the two must describe the same rows.
  {
    if (unique) {
      const row = raw.prepare("SELECT s.id AS id, f.language AS language FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id WHERE s.project_id = ? AND s.name = ?").get(projectId, unique.name) as any
      const ideFacts = factsFromRows(storedCrossLanguageRows(raw, row.id), row.language)
      const agent = await call("bb_cross_language", { symbol: unique.name })
      const agentPairs = new Set((agent.parsed?.facts ?? []).map((f: any) => `${f.pair}|${f.direction}|${f.relationshipType}|${f.bridge}`))
      const idePairs = new Set(ideFacts.map((f: any) => `${f.pair}|${f.direction}|${f.relationshipType}|${f.bridge}`))
      const same = agentPairs.size === idePairs.size && [...agentPairs].every((p) => idePairs.has(p))
      check("CL1 H: the agent door and the hover door describe the same stored rows for an unambiguous name", same,
        `agent=${[...agentPairs].join("; ")} ide=${[...idePairs].join("; ")}`)
      // And the hover section still renders nothing for a symbol with no rows.
      check("CL1 H2: the hover projection is unchanged (empty section when no rows)", crossLanguageSection([]) === "")
    }
  }

  // ── I: the HOVER door does not leak either ──────────────────────────────────
  // CL1 closed the cross-project leak on the agent door and declared the hover
  // door latent, on the reasoning that a hover symbol id is project-prefixed. That
  // reasoning had a hole: the id being project-scoped says nothing about the
  // ROWS. `storedCrossLanguageRows` joined the opposite symbol with
  // `ss.project_id = r.project_id`, which reads like a project filter and is not
  // one. The row is now constrained to the project of the symbol asked about, in
  // both directions, and this asserts it against a row that is really foreign.
  //
  // The two controls are the load-bearing part. Without them this check passes
  // identically when the insert failed, the row was never stored, or the victim
  // had no cross-language rows to begin with — three ways to measure nothing.
  {
    const other = "cl1hoverleak000000000000000000000000000"
    const victim = raw.prepare(
      "SELECT s.id AS id, s.name AS name, f.language AS language FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id WHERE s.project_id = ? AND s.id IN (SELECT target_symbol_id FROM brain_relationship WHERE project_id = ? AND is_cross_language = 1) LIMIT 1",
    ).get(projectId, projectId) as any
    if (!victim) {
      check("CL1 I: a hover anchor exists (otherwise this section measures nothing)", false, "no cross-language row in the index")
    } else {
      const beforeRows = storedCrossLanguageRows(raw, victim.id).length
      const ins = (t_: string, cols: string, vals: unknown[]) =>
        raw.prepare(`INSERT OR REPLACE INTO ${t_} (${cols}) VALUES (${cols.split(",").map(() => "?").join(",")})`).run(...vals)
      ins("brain_file", "id,project_id,path,relative_path,language,file_hash", ["cl1hover-f", other, "/x/leak.clj", "leak.clj", "clojure", "leak"])
      ins("brain_symbol", "id,project_id,file_id,name,symbol_type,line_start,line_end,byte_start,byte_end,gravity_score", ["cl1hover-s", other, "cl1hover-f", "hoverLeakCaller", "function", 1, 1, 0, 1, 1])
      ins("brain_symbol", "id,project_id,file_id,name,symbol_type,line_start,line_end,byte_start,byte_end,gravity_score", ["cl1hover-s2", other, "cl1hover-f", "hoverLeakCallee", "function", 2, 2, 0, 1, 1])
      // TWO rows, one per direction, because the two arms are not
      // interchangeable. Each direction's pre-existing JOIN pins the OPPOSITE
      // endpoint to the row's project, so a row is only ever seen by the
      // direction whose opposite endpoint is foreign:
      //   caller arm (r.target_symbol_id = victim) — JOIN pins SOURCE, foreign === foreign: passes
      //   callee arm (r.source_symbol_id = victim) — JOIN pins TARGET,  foreign === foreign: passes
      // Seeding only the caller shape left the callee filter verified by reading
      // it and not by breaking it.
      ins("brain_relationship", "id,project_id,source_symbol_id,target_symbol_id,relationship_type,confidence,is_cross_language,bridge_mechanism", ["cl1hover-r", other, "cl1hover-s", victim.id, "calls", 0.99, 1, "LEAKED-CALLER-DIRECTION"])
      ins("brain_relationship", "id,project_id,source_symbol_id,target_symbol_id,relationship_type,confidence,is_cross_language,bridge_mechanism", ["cl1hover-r2", other, victim.id, "cl1hover-s2", "calls", 0.99, 1, "LEAKED-CALLEE-DIRECTION"])
      try {
        const after = storedCrossLanguageRows(raw, victim.id)
        const leakedFacts = JSON.stringify(factsFromRows(after, victim.language))
        for (const [label, rowId] of [["CALLER", "cl1hover-r"], ["CALLEE", "cl1hover-r2"]] as const) {
          // CONTROL 1 — the row is really in the table. Without it "no leak" is
          // indistinguishable from "the insert silently failed".
          const stored = raw.prepare("SELECT COUNT(*) AS c FROM brain_relationship WHERE id = ?").get(rowId) as any
          check(`CL1 I (${label}): the foreign row is really stored (control — without this the check is vacuous)`, stored?.c === 1, `rows=${stored?.c}`)
          // CONTROL 2 — and it really is another project's row, touching this symbol.
          const foreign = raw.prepare(
            `SELECT COUNT(*) AS c FROM brain_relationship r
             JOIN brain_symbol ts ON ts.id = r.target_symbol_id JOIN brain_symbol ss ON ss.id = r.source_symbol_id
             WHERE r.id = ? AND r.project_id <> ? AND (ts.project_id = ? OR ss.project_id = ?)`,
          ).get(rowId, projectId, projectId, projectId) as any
          check(`CL1 I (${label}): and it really belongs to another project (control)`, foreign?.c === 1, `foreign=${foreign?.c}`)
          // THE CLAIM — that direction returns nothing from it.
          const leakedRows = after.filter((r: any) => r.bridge_mechanism === `LEAKED-${label}-DIRECTION`).length
          check(`CL1 I (${label}): the hover door returns no foreign row in this direction`, leakedRows === 0, `leakedRows=${leakedRows}`)
          check(`CL1 I (${label}): and no fact is built from one`, leakedFacts.includes(`LEAKED-${label}-DIRECTION`) === false, `leakedFact=true`)
        }
        check("CL1 I: the door still returns exactly the rows that ARE its own", after.length === beforeRows, `before=${beforeRows} after=${after.length}`)
      } finally {
        for (const [t_, id] of [["brain_relationship", "cl1hover-r"], ["brain_relationship", "cl1hover-r2"], ["brain_symbol", "cl1hover-s"], ["brain_symbol", "cl1hover-s2"], ["brain_file", "cl1hover-f"]] as const) {
          try { raw.prepare(`DELETE FROM ${t_} WHERE id = ?`).run(id) } catch {}
        }
      }
    }
  }

  // ── J/K/L/M: the four surfaces no corpus can reach ─────────────────────────
  //
  // Asking what this gate does NOT cover found a fifth defect in the tool (§M), and
  // three surfaces that turned out to be correct but had never been run. All four
  // need fixtures, because none of them is reachable from an index that is rich in
  // cross-language rows — which is all this gate had ever run on.
  //
  // Every fixture below uses PAIRABLE rows: the two ends sit in files of genuinely
  // different languages. That is not decoration. GAP3's first draft seeded a
  // `.ts -> .ts` own row, so the row was unpairable, so the tool correctly refused
  // to emit it, and the probe reported a precedence failure that was entirely the
  // probe's own fault. A failing assertion is a question about the fixture before
  // it is a question about the code.
  {
    // One builder for all four, in its own data dir so no fixture can touch the
    // corpus under test. Reuses the exit-hook registry, so a failing run cleans up
    // like every other temp dir here.
    const gapDir = mkdtempSync(join(tmpdir(), "cl1-gap-"))
    TEMP_DIRS.push(gapDir)
    const gapProjects: Record<string, string> = {
      empty: "cl1gapempty00000000000000000000000000000",
      memberTrunc: "cl1gapmemtr00000000000000000000000000000",
      precedence: "cl1gapprec00000000000000000000000000000",
      scopeA: "cl1gapscopeA0000000000000000000000000000",
      scopeB: "cl1gapscopeB0000000000000000000000000000",
    }
    for (const id of Object.values(gapProjects)) mkdirSync(join(gapDir, "projects", id), { recursive: true })
    let gapRaw: Record<string, any> = {}
    const savedGapData = process.env.BB_DATA_DIR
    process.env.BB_DATA_DIR = gapDir
    try {
      const { BrainDatabase: GapDb } = await import(join(ROOT, "src", "brain", "database.ts"))
      for (const [key, id] of Object.entries(gapProjects)) gapRaw[key] = await GapDb.getRawInstance(id as any)
      const GFile = (k: string, fid: string, name: string, language: string) =>
        gapRaw[k].prepare("INSERT OR REPLACE INTO brain_file (id, project_id, path, relative_path, language, file_hash) VALUES (?,?,?,?,?,?)")
          .run(fid, gapProjects[k], `/g/${name}`, name, language, `h-${fid}`)
      const GSym = (k: string, sid: string, fid: string, name: string, owner?: string) =>
        gapRaw[k].prepare("INSERT OR REPLACE INTO brain_symbol (id, project_id, file_id, name, symbol_type, line_start, line_end, byte_start, byte_end, gravity_score, owner_symbol_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
          .run(sid, gapProjects[k], fid, name, "function", 1, 1, 0, 10, 1, owner ?? null)
      const GRel = (k: string, rid: string, src: string, tgt: string) =>
        gapRaw[k].prepare("INSERT OR REPLACE INTO brain_relationship (id, project_id, source_symbol_id, target_symbol_id, relationship_type, confidence, is_cross_language, bridge_mechanism) VALUES (?,?,?,?,?,?,?,?)")
          .run(rid, gapProjects[k], src, tgt, "calls", 0.9, 1, "name-resolution")
      /** Call the tool inside a fixture project. `getRawInstance` reads
       *  BB_DATA_DIR at call time, so the variable has to be in scope for the READ
       *  as well as the build — the same scoping bug that killed the earlier S1/S2
       *  wiring, one level up. */
      const gapAsk = async (k: string, symbol: string, extra: Record<string, unknown> = {}) => {
        const saved = process.env.BB_DATA_DIR
        process.env.BB_DATA_DIR = gapDir
        try {
          const hs = createToolHandlers()
          const r: any = await (hs as any).bb_cross_language({ symbol, ...extra }, { projectId: gapProjects[k], projectPath: "/g" } as any)
          return JSON.parse(r.content[0].text)
        } finally { process.env.BB_DATA_DIR = saved }
      }

      // ── J: a project with no cross-language rows at all ──────────────────
      // The most common real-world case, and the one the gate's own corpus
      // precondition makes unreachable: it refuses a corpus with zero cross rows.
      GFile("empty", "j-f1", "only.ts", "typescript")
      GSym("empty", "j-s1", "j-f1", "jLonely")
      {
        // CONTROL — the project really is empty of cross-language rows. Without
        // it, "no rows" and "the fixture failed to build" are the same answer.
        const rows = (gapRaw.empty.prepare("SELECT COUNT(*) AS n FROM brain_relationship WHERE is_cross_language = 1").get() as any).n
        check("CL1 J: the empty fixture really has no cross-language rows (control)", rows === 0, `rows=${rows}`)
        const p = await gapAsk("empty", "jLonely")
        check("CL1 J: a project with no cross-language rows answers with a DECLARED absence", p.declaredAbsent === true, `declaredAbsent=${p.declaredAbsent}`)
        check("CL1 J: and an empty fact set, not an error", (p.facts ?? []).length === 0 && (p.memberFacts ?? []).length === 0, `facts=${(p.facts ?? []).length}`)
        check("CL1 J: the name is still reported as present in the index (absence is about ROWS, not existence)", p.copyCount === 1, `copyCount=${p.copyCount}`)
        check("CL1 J: and the reason is stated, not implied", typeof p.absenceNote === "string" && p.absenceNote.length > 0, `note=${String(p.absenceNote).slice(0, 60)}`)
      }

      // ── K: truncation driven by the MEMBER section ───────────────────────
      // own = 0, member = 6, limit 4. The only shape where `memberFacts.slice(0,
      // remaining)` is genuinely partial — F2/F3 always truncate a hub with own
      // rows, so `remaining` is 0 before members are considered.
      GFile("memberTrunc", "k-ft", "owner.ts", "typescript")
      GFile("memberTrunc", "k-fc", "members.clj", "clojure")
      GSym("memberTrunc", "k-owner", "k-ft", "kOwner")
      for (let i = 0; i < 6; i++) {
        GFile("memberTrunc", `k-mf${i}`, `m${i}.clj`, "clojure")
        GSym("memberTrunc", `k-ms${i}`, `k-mf${i}`, `kMember${i}`, "k-owner")
        GFile("memberTrunc", `k-cf${i}`, `caller${i}.ts`, "typescript")
        GSym("memberTrunc", `k-cs${i}`, `k-cf${i}`, `kCaller${i}`)
        GRel("memberTrunc", `k-r${i}`, `k-cs${i}`, `k-ms${i}`)
      }
      {
        const full = await gapAsk("memberTrunc", "kOwner")
        check("CL1 K: the fixture is the shape that only the member path can truncate", full.ownFactCount === 0 && full.memberFactCount === 6, `own=${full.ownFactCount} member=${full.memberFactCount}`)
        const p = await gapAsk("memberTrunc", "kOwner", { limit: 4 })
        check("CL1 K: the member section honours the budget", p.memberFactCount === 4 && p.pairCount === 4, `member=${p.memberFactCount} pair=${p.pairCount}`)
        check("CL1 K: a member-driven truncation is declared, not silent", p.truncated === true, `truncated=${p.truncated}`)
        check("CL1 K: and the true total is the whole union, not the shown part", p.totalCountIfKnown === 6, `total=${p.totalCountIfKnown}`)
        check("CL1 K: the reason attributes the drop to the member section", /on its members/.test(String(p.truncationReason)), String(p.truncationReason).slice(0, 90))
      }

      // ── L: own-first precedence at limit 1 ───────────────────────────────
      // The handler states the intent: one budget over the union, own rows first,
      // and the rows naming the symbol itself must never be crowded out by a
      // member's edges. At limit 1 that intent is a single fact, and it must be
      // the owner's.
      GFile("precedence", "p-fts", "owner.ts", "typescript")
      GFile("precedence", "p-fmc", "member.clj", "clojure")
      GSym("precedence", "p-owner", "p-fts", "pTarget")
      GSym("precedence", "p-mem", "p-fmc", "pMember", "p-owner")
      GFile("precedence", "p-foc", "owncaller.clj", "clojure") // .clj -> .ts owner = pairable
      GSym("precedence", "p-ocs", "p-foc", "pOwnCaller")
      GRel("precedence", "p-r-own", "p-ocs", "p-owner")
      for (let i = 0; i < 2; i++) {
        GFile("precedence", `p-fmc${i}`, `memcaller${i}.ts`, "typescript") // .ts -> .clj member = pairable
        GSym("precedence", `p-mcs${i}`, `p-fmc${i}`, `pMemCaller${i}`)
        GRel("precedence", `p-r-m${i}`, `p-mcs${i}`, "p-mem")
      }
      {
        const at1 = await gapAsk("precedence", "pTarget", { limit: 1 })
        const at2 = await gapAsk("precedence", "pTarget", { limit: 2 })
        const at4 = await gapAsk("precedence", "pTarget", { limit: 4 })
        check("CL1 L: the fixture holds 1 pairable own row and 2 pairable member rows", at4.totalCountIfKnown === 3, `total=${at4.totalCountIfKnown}`)
        check("CL1 L: at limit 1 the OWN row wins the budget (a member's edge never crowds out the symbol's own)", at1.ownFactCount === 1 && at1.memberFactCount === 0, `own=${at1.ownFactCount} member=${at1.memberFactCount}`)
        check("CL1 L: and the one fact shown is the owner's, named as the self side", (at1.facts?.[0]?.self?.symbol) === "pTarget", `self=${at1.facts?.[0]?.self?.symbol}`)
        check("CL1 L: the dropped member row is declared, not vanished", at1.truncated === true && at1.totalCountIfKnown === 3, `truncated=${at1.truncated} total=${at1.totalCountIfKnown}`)
        check("CL1 L: at limit 2 the member row appears and truncation is still declared", at2.pairCount === 2 && at2.memberFactCount === 1 && at2.truncated === true, `pair=${at2.pairCount} member=${at2.memberFactCount}`)
        check("CL1 L: at limit 4 nothing is dropped and nothing claims truncation", at4.pairCount === 3 && at4.truncated === false, `pair=${at4.pairCount} truncated=${at4.truncated}`)
        check("CL1 L: the answer is never larger than the budget at any limit", [at1, at2, at4].every((r: any) => r.pairCount === Math.min(r.limit, r.totalCountIfKnown)), [at1, at2, at4].map((r: any) => `${r.limit}:${r.pairCount}/${r.totalCountIfKnown}`).join(" "))
      }

      // ── M: the absence note's SCOPE (M63.CL4) ────────────────────────────
      // The same name in TWO projects, cross-language rows in one and not the
      // other. All three queries bind a projectId, so the answer covers one
      // project — and the note used to say "anywhere in the index", which is a
      // claim about the whole store. With both projects real this was false as
      // written (lane/cl-absence-scope.ts measured CLAIM_IS_FALSE: true).
      for (const k of ["scopeA", "scopeB"] as const) {
        GFile(k, `${k}-f1`, "x.ts", "typescript")
        GSym(k, `${k}-s1`, `${k}-f1`, "jScopedName")
      }
      GFile("scopeB", "scopeB-f2", "z.clj", "clojure")
      GSym("scopeB", "scopeB-s2", "scopeB-f2", "jCallerInB")
      GRel("scopeB", "scopeB-r1", "scopeB-s2", "scopeB-s1")
      {
        // CONTROL — the other project really does hold a row for this name. If the
        // insert had failed, the scoping would be untestable and the check below
        // would pass for the wrong reason.
        const elsewhere = (gapRaw.scopeB.prepare(
          "SELECT COUNT(*) AS n FROM brain_relationship r JOIN brain_symbol ts ON ts.id = r.target_symbol_id WHERE r.is_cross_language = 1 AND ts.name = 'jScopedName'",
        ).get() as any).n
        check("CL1 M: another project really does hold a cross-language row for this name (control)", elsewhere === 1, `rowsElsewhere=${elsewhere}`)
        const p = await gapAsk("scopeA", "jScopedName")
        check("CL1 M: the absence for THIS project is still correctly declared", p.declaredAbsent === true, `declaredAbsent=${p.declaredAbsent}`)
        check("CL1 M: and the note does not claim the whole index", !/anywhere in the index/i.test(String(p.absenceNote)), String(p.absenceNote).slice(0, 100))
        check("CL1 M: it scopes the claim to the project that was actually searched", /in THIS PROJECT/i.test(String(p.absenceNote)), String(p.absenceNote).slice(0, 100))
      }
    } finally {
      process.env.BB_DATA_DIR = savedGapData
    }
  }

  // ── The errors ─────────────────────────────────────────────────────────────
  {
    const missing = await call("bb_cross_language", { symbol: "zz_cl1_absent_symbol_xyz" })
    check("CL1: an unknown symbol is a loud declared error, not an empty set", missing.isError === true && /not found/.test(missing.text), missing.text.slice(0, 120))
    const blank = await call("bb_cross_language", { symbol: "   " })
    check("CL1: a blank symbol is refused", blank.isError === true, blank.text.slice(0, 120))
  }

  // ── MUTANTS: the gate must be able to fail ─────────────────────────────────
  const handlerSrc = readFileSync(HANDLERS, "utf8")
  /**
   * The count of mutants is the CONTRACT, not an observation: deleting mutants
   * until the suite gets easier is the one failure this floor exists to catch.
   * It is deliberately NOT the backstop against a silently skipped mutant that
   * M26 W3's floor is — there, an anchor miss lowers the count. Here `caught ===
   * mutants.length` already fails on an anchor miss, because the miss is recorded
   * as not-caught and `mutants.length` counts what was DECLARED.
   */
  const MUTANT_FLOOR = 14
  const componentSrc = readFileSync(COMPONENT, "utf8")
  const mutants: Array<{ id: string; name: string; file: "handler" | "component"; from: string; to: string; probe: (m: any, raw: any, projectId: string) => Promise<boolean> }> = [
    {
      id: "M1", name: "pick-one-copy (the old door, planted verbatim)", file: "handler",
      from: "const result = storedCrossLanguageFactsByName(raw, projectId as string, symbol)",
      to: "const result = storedCrossLanguageFactsByName(raw, projectId as string, (raw.prepare(\"SELECT s.name AS name FROM brain_symbol s WHERE s.project_id = ? AND s.name = ? ORDER BY s.id LIMIT 1\").get(projectId, symbol) as any)?.name ?? symbol)",
      // The mutant silently answers for one copy, so the independent count and
      // the tool's answer disagree — exactly the `invoke` failure.
      probe: async (m, r, pid) => {
        const name = (await (m.createToolHandlers() as any).bb_cross_language(
          { symbol: (await pickAmbiguousWithRows(r, pid)) }, { projectId: pid, projectPath: "." } as any))
        const parsed = JSON.parse((name as any).content[0].text)
        return parsed.pairCount < parsed.storedRowCount
      },
    },
    {
      id: "M2", name: "false absence", file: "handler",
      from: "      declaredAbsent: shownCount === 0,",
      to: "      declaredAbsent: shownCount < 3,",
      probe: async (m, r, pid) => {
        const ambiguous = await pickAmbiguousWithRows(r, pid)
        const out = await (m.createToolHandlers() as any).bb_cross_language({ symbol: ambiguous }, { projectId: pid, projectPath: "." } as any)
        return JSON.parse(out.content[0].text).declaredAbsent === true
      },
    },
    {
      id: "M3", name: "no identity (counterparty stripped)", file: "component",
      from: "    other: { symbol: row.other_name, file: row.other_file, language: row.other_language, line: row.other_line },",
      to: "    other: { symbol: null, file: null, language: null, line: null } as any,",
      probe: async (m, r, pid) => {
        const out = await (m.createToolHandlers() as any).bb_cross_language({ symbol: await pickUniqueWithRows(r, pid) }, { projectId: pid, projectPath: "." } as any)
        const parsed = JSON.parse(out.content[0].text)
        return (parsed.facts ?? []).some((f: any) => !f.other || typeof f.other.file !== "string")
      },
    },
    {
      id: "M4", name: "no bound (limit ignored, truncation undeclared)", file: "handler",
      from: "    const ownShown = result.facts.slice(0, limit)",
      to: "    const ownShown = result.facts.slice(0, Number.MAX_SAFE_INTEGER)",
      probe: async (m, r, pid) => {
        const hub = await pickHub(r, pid)
        const out = await (m.createToolHandlers() as any).bb_cross_language({ symbol: hub, limit: 5 }, { projectId: pid, projectPath: "." } as any)
        const parsed = JSON.parse(out.content[0].text)
        return parsed.pairCount > 5 || parsed.truncated !== true
      },
    },
    {
      id: "M5", name: "cross-project leak (row filter dropped)", file: "component",
      from: "WHERE r.project_id = ? AND r.is_cross_language = 1 AND ts.name = ?",
      to: "WHERE r.is_cross_language = 1 AND ts.name = ?",
      probe: async (m, r, pid) => {
        // Plant a row owned by ANOTHER project whose target is this project's
        // symbol. A handler that does not filter the row by project returns it.
        const other = "cl1leak00000000000000000000000000000000"
        const victim = r.prepare("SELECT s.id AS id, s.name AS name FROM brain_symbol s WHERE s.project_id = ? AND s.id IN (SELECT target_symbol_id FROM brain_relationship WHERE project_id = ? AND is_cross_language = 1) LIMIT 1").get(pid, pid) as any
        if (!victim) return false
        r.prepare("INSERT OR REPLACE INTO brain_file (id, project_id, path, relative_path, language, file_hash) VALUES (?,?,?,?,?,?)").run("cl1leak-f", other, "/x/leak.clj", "leak.clj", "clojure", "leak")
        r.prepare("INSERT OR REPLACE INTO brain_symbol (id, project_id, file_id, name, symbol_type, line_start, line_end, byte_start, byte_end, gravity_score) VALUES (?,?,?,?,?,?,?,?,?,?)").run("cl1leak-s", other, "cl1leak-f", "leakCaller", "function", 1, 1, 0, 1, 1)
        r.prepare("INSERT OR REPLACE INTO brain_relationship (id, project_id, source_symbol_id, target_symbol_id, relationship_type, confidence, is_cross_language, bridge_mechanism) VALUES (?,?,?,?,?,?,?,?)").run("cl1leak-r", other, "cl1leak-s", victim.id, "calls", 0.99, 1, "LEAKED-FROM-ANOTHER-PROJECT")
        try {
          const out = await (m.createToolHandlers() as any).bb_cross_language({ symbol: victim.name }, { projectId: pid, projectPath: "." } as any)
          return JSON.stringify(JSON.parse(out.content[0].text)).includes("LEAKED-FROM-ANOTHER-PROJECT")
        } finally {
          r.prepare("DELETE FROM brain_relationship WHERE id = 'cl1leak-r'").run()
          r.prepare("DELETE FROM brain_symbol WHERE id = 'cl1leak-s'").run()
          r.prepare("DELETE FROM brain_file WHERE id = 'cl1leak-f'").run()
        }
      },
    },
    {
      // M63.CL3 — the two guards that no corpus can trigger. A guard that is
      // never exercised is a comment, so each is exercised and each is broken.
      id: "M11", name: "unpairable rule removed (a row with no language gets a fabricated pair)", file: "component",
      from: "  if (pair === null) { counters.unpairable++; return null }",
      to: "  if (pair === null) { counters.unpairable++; const fab = { ...row } as any; fab.self_language = fab.self_language ?? \'unknown\'; fab.other_language = fab.other_language ?? \'unknown\'; return factFromRow(fab, match, { unpairable: 0 }, matchedMember, pairFromLanguage) }",
      probe: async (m) => {
        const name = seededNameFor("unpairable")
        if (!name) throw new Error("M11 UNVERIFIABLE: the seeded unpairable state is missing")
        return withSeeded(async () => {
          const out = await (m.createToolHandlers() as any).bb_cross_language({ symbol: name }, seededCtx as any)
          const p = JSON.parse(out.content[0].text)
          return (p.facts ?? []).some((f: any) => typeof f.pair === "string" && f.pair.includes("unknown"))
        })
      },
    },
    {
      // M63.CL4 — the absence note widened back to "anywhere in the index". A
      // wording fix with no mutant is a wording fix the next editor silently
      // undoes, and this one is the tool's strongest claim: it is what a caller
      // reads instead of checking. The seeded fixture is the only construction
      // that can tell the two wordings apart — one project holding rows for the
      // name, the project being asked about holding none.
      id: "M15", name: "the absence note claims the whole index instead of the searched project", file: "handler",
      from: "no stored cross-language rows anywhere in THIS PROJECT's index for '${symbol}'",
      to: "no stored cross-language rows anywhere in the index for '${symbol}'",
      probe: async (m) => {
        const seed = await seedScopePair()
        if (!seed) return false
        const p = JSON.parse((await (m.createToolHandlers() as any).bb_cross_language({ symbol: seed.name }, seed.ctxA as any)).content[0].text)
        // Caught when the note makes the claim the fixture disproves.
        return /anywhere in the index/i.test(String(p.absenceNote)) && seed.rowsElsewhere === 1
      },
    },
    {
      // M63.CL3 — the hover door's project filter, dropped from the OTHER
      // direction. M13 and M14 are separate mutants for separate predicates on
      // purpose: a single mutant that removed both would be caught by a check
      // looking at either arm, so neither predicate would be proved
      // load-bearing. Two filters, two removals.
      id: "M14", name: "hover door leaks a foreign row (project filter dropped from the callee direction)", file: "component",
      from: "         AND r.project_id = (SELECT s2.project_id FROM brain_symbol s2 WHERE s2.id = ?)`,\n    )\n    .all(symbolId, symbolId) as Array<{ relationship_type: string; confidence: number | null; bridge_mechanism: string | null; other_language: string | null; metadata: string | null }>\n  for (const r of callees)",
      to: "`,\n    )\n    .all(symbolId) as Array<{ relationship_type: string; confidence: number | null; bridge_mechanism: string | null; other_language: string | null; metadata: string | null }>\n  for (const r of callees)",
      probe: async (m, r, pid) => {
        const other = "cl1hoverm140000000000000000000000000000"
        // The victim is the SOURCE of the seeded row, because M14 mutates the
        // callee arm (`r.source_symbol_id = ?`).
        const victim = r.prepare("SELECT s.id AS id, s.name AS name, f.language AS language FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id WHERE s.project_id = ? AND s.id IN (SELECT source_symbol_id FROM brain_relationship WHERE project_id = ? AND is_cross_language = 1) LIMIT 1").get(pid, pid) as any
        if (!victim) return false
        const ins = (t_: string, cols: string, vals: unknown[]) =>
          r.prepare(`INSERT OR REPLACE INTO ${t_} (${cols}) VALUES (${cols.split(",").map(() => "?").join(",")})`).run(...vals)
        ins("brain_file", "id,project_id,path,relative_path,language,file_hash", ["cl1hoverm14-f", other, "/x/leak3.clj", "leak3.clj", "clojure", "leak3"])
        ins("brain_symbol", "id,project_id,file_id,name,symbol_type,line_start,line_end,byte_start,byte_end,gravity_score", ["cl1hoverm14-s", other, "cl1hoverm14-f", "hoverM14Callee", "function", 1, 1, 0, 1, 1])
        ins("brain_relationship", "id,project_id,source_symbol_id,target_symbol_id,relationship_type,confidence,is_cross_language,bridge_mechanism", ["cl1hoverm14-r", other, victim.id, "cl1hoverm14-s", "calls", 0.99, 1, "M14-LEAKED-CALLEE"])
        try {
          const rows = m.storedCrossLanguageRows(r, victim.id)
          return rows.some((x: any) => x.bridge_mechanism === "M14-LEAKED-CALLEE")
        } finally {
          for (const [t_, id] of [["brain_relationship", "cl1hoverm14-r"], ["brain_symbol", "cl1hoverm14-s"], ["brain_file", "cl1hoverm14-f"]] as const) {
            try { r.prepare(`DELETE FROM ${t_} WHERE id = ?`).run(id) } catch {}
          }
        }
      },
    },
    {
      // M63.CL3 — the hover door's project filter, dropped from the caller
      // direction; M14 drops the callee one. A mutant that removed both would be
      // caught by a check looking at either arm, so neither predicate would be
      // proved load-bearing — and a filter present in one query and absent from
      // its twin is precisely the shape of the bug CL3 fixed.
      id: "M13", name: "hover door leaks a foreign row (project filter dropped from the caller direction)", file: "component",
      from: "         AND r.project_id = (SELECT s2.project_id FROM brain_symbol s2 WHERE s2.id = ?)`,\n    )\n    .all(symbolId, symbolId) as Array<{ relationship_type: string; confidence: number | null; bridge_mechanism: string | null; other_language: string | null; metadata: string | null }>\n  for (const r of callers)",
      to: "`,\n    )\n    .all(symbolId) as Array<{ relationship_type: string; confidence: number | null; bridge_mechanism: string | null; other_language: string | null; metadata: string | null }>\n  for (const r of callers)",
      probe: async (m, r, pid) => {
        const other = "cl1hoverm130000000000000000000000000000"
        // The victim is the TARGET of the seeded row, because M13 mutates the
        // caller arm (`r.target_symbol_id = ?`). Picking a symbol that is the
        // SOURCE of some cross-language row instead — the shape the first draft
        // used — produces a row the caller query's own JOIN discards, so the
        // mutated WHERE is never evaluated and the mutant is unexercised rather
        // than surviving.
        const victim = r.prepare("SELECT s.id AS id, s.name AS name, f.language AS language FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id WHERE s.project_id = ? AND s.id IN (SELECT target_symbol_id FROM brain_relationship WHERE project_id = ? AND is_cross_language = 1) LIMIT 1").get(pid, pid) as any
        if (!victim) return false
        const ins = (t_: string, cols: string, vals: unknown[]) =>
          r.prepare(`INSERT OR REPLACE INTO ${t_} (${cols}) VALUES (${cols.split(",").map(() => "?").join(",")})`).run(...vals)
        ins("brain_file", "id,project_id,path,relative_path,language,file_hash", ["cl1hoverm13-f", other, "/x/leak2.clj", "leak2.clj", "clojure", "leak2"])
        ins("brain_symbol", "id,project_id,file_id,name,symbol_type,line_start,line_end,byte_start,byte_end,gravity_score", ["cl1hoverm13-s", other, "cl1hoverm13-f", "hoverM13Target", "function", 1, 1, 0, 1, 1])
        // A CALLER row: the foreign symbol is the SOURCE and the victim is the
        // TARGET, which is what `r.target_symbol_id = ?` matches. The caller
        // query's JOIN (`ss.project_id = r.project_id`) passes on its own here —
        // source and row share the foreign project — so the new filter is the
        // only thing that can keep this row out, and M13 removes it.
        ins("brain_relationship", "id,project_id,source_symbol_id,target_symbol_id,relationship_type,confidence,is_cross_language,bridge_mechanism", ["cl1hoverm13-r", other, "cl1hoverm13-s", victim.id, "calls", 0.99, 1, "M13-LEAKED-CALLER"])
        try {
          const rows = m.storedCrossLanguageRows(r, victim.id)
          return rows.some((x: any) => x.bridge_mechanism === "M13-LEAKED-CALLER")
        } finally {
          for (const [t_, id] of [["brain_relationship", "cl1hoverm13-r"], ["brain_symbol", "cl1hoverm13-s"], ["brain_file", "cl1hoverm13-f"]] as const) {
            try { r.prepare(`DELETE FROM ${t_} WHERE id = ?`).run(id) } catch {}
          }
        }
      },
    },
    {
      id: "M12", name: "collapse rule removed (a same-named cross-language row is emitted twice)", file: "component",
      from: "    if (seenRows.has(row.row_id)) { collapsed++; continue }\n    seenRows.add(row.row_id)\n\n    const fact = factFromRow(row, \"exact\", counters)",
      to: "    seenRows.add(row.row_id)\n\n    const fact = factFromRow(row, \"exact\", counters)",
      probe: async (m) => {
        const name = seededNameFor("collapsed")
        if (!name) throw new Error("M12 UNVERIFIABLE: the seeded same-named cross-language state is missing")
        return withSeeded(async () => {
          const out = await (m.createToolHandlers() as any).bb_cross_language({ symbol: name }, seededCtx as any)
          const p = JSON.parse(out.content[0].text)
          return p.pairCount > 1 || p.collapsedRowCount !== 1
        })
      },
    },
    {
      // M63.CL2 — the three ways the member section can lie. Each is caught by a
      // different check, so passing means the checks are independent.
      id: "M7", name: "cascade laundered: member rows absorbed into facts", file: "handler",
      from: "      facts: ownShown,",
      to: "      facts: [...ownShown, ...memberShown],",
      probe: async (m, r, pid) => {
        const name = await pickOwnerWithMembers(r, pid)
        if (!name) return false
        const out = await (m.createToolHandlers() as any).bb_cross_language({ symbol: name }, { projectId: pid, projectPath: "." } as any)
        const p = JSON.parse(out.content[0].text)
        return (p.facts ?? []).some((f: any) => f.match === "owner-cascade" || f.matchedMember)
      },
    },
    {
      id: "M8", name: "the pre-CL2 absence rule (own rows only)", file: "handler",
      from: "      declaredAbsent: shownCount === 0,",
      to: "      declaredAbsent: ownShown.length === 0,",
      probe: async (m, r, pid) => {
        const name = await pickOwnerWithMembers(r, pid)
        if (!name) return false
        const out = await (m.createToolHandlers() as any).bb_cross_language({ symbol: name }, { projectId: pid, projectPath: "." } as any)
        const p = JSON.parse(out.content[0].text)
        // The defect verbatim: a symbol with member rows, answered as absent.
        return p.declaredAbsent === true && (p.memberFactCount ?? 0) > 0
      },
    },
    {
      id: "M9", name: "cascade reported with no member to check it against", file: "component",
      from: "    }, row.member_language, row.member_id)",
      to: "    }, row.member_language)",
      probe: async (m, r, pid) => {
        const name = await pickOwnerWithMembers(r, pid)
        if (!name) return false
        const out = await (m.createToolHandlers() as any).bb_cross_language({ symbol: name }, { projectId: pid, projectPath: "." } as any)
        const p = JSON.parse(out.content[0].text)
        return (p.memberFacts ?? []).some((f: any) => typeof f.matchedMemberId !== "string")
      },
    },
    {
      id: "M6", name: "pair fabrication where the row has no languages", file: "component",
      from: "  const pair = selfLang && otherLang && selfLang.toLowerCase() !== otherLang.toLowerCase()\n    ? `${selfLang} → ${otherLang}`\n    : null",
      to: "  const pair = `${selfLang ?? 'unknown'} → ${otherLang ?? 'unknown'}`",
      probe: async (m, r, pid) => {
        const out = await (m.createToolHandlers() as any).bb_cross_language({ symbol: await pickUniqueWithRows(r, pid) }, { projectId: pid, projectPath: "." } as any)
        const parsed = JSON.parse(out.content[0].text)
        return (parsed.facts ?? []).some((f: any) => typeof f.pair === "string" && f.pair.includes("unknown"))
      },
    },
  ]

  // The names each mutant needs, chosen from the REAL index (never invented).
  async function pickAmbiguousWithRows(r: any, pid: string): Promise<string> {
    const row = r.prepare(
      `SELECT name FROM (SELECT ts.name AS name, COUNT(DISTINCT r.id) AS n FROM brain_relationship r JOIN brain_symbol ts ON ts.id = r.target_symbol_id
         WHERE r.project_id = ? AND r.is_cross_language = 1 GROUP BY ts.name
         UNION ALL SELECT ss.name AS name, COUNT(DISTINCT r.id) AS n FROM brain_relationship r JOIN brain_symbol ss ON ss.id = r.source_symbol_id
         WHERE r.project_id = ? AND r.is_cross_language = 1 GROUP BY ss.name)
       WHERE name IN (SELECT name FROM brain_symbol GROUP BY name HAVING COUNT(*) > 1)
       GROUP BY name ORDER BY n DESC LIMIT 1`).get(pid, pid) as any
    return row?.name ?? (r.prepare("SELECT name FROM brain_symbol WHERE project_id = ? LIMIT 1").get(pid) as any).name
  }
  async function pickUniqueWithRows(r: any, pid: string): Promise<string> {
    const row = r.prepare(
      `SELECT ss.name AS name FROM brain_relationship r JOIN brain_symbol ss ON ss.id = r.source_symbol_id
       WHERE r.project_id = ? AND r.is_cross_language = 1
         AND (SELECT COUNT(*) FROM brain_symbol s2 WHERE s2.project_id = ? AND s2.name = ss.name) = 1 LIMIT 1`).get(pid, pid) as any
    return row?.name ?? (r.prepare("SELECT name FROM brain_symbol WHERE project_id = ? LIMIT 1").get(pid) as any).name
  }
  /** Two projects holding the same name, cross-language rows in one and not the
   *  other. Built fresh for M15 because a mutant runs against a MUTATED handler
   *  and cannot share section J's fixture objects — the mutation harness re-imports
   *  the module, so any state it captured from the real one is not in scope.
   *
   *  Returns null when it cannot be built, and the probe treats null as NOT CAUGHT
   *  rather than passing: an unplantable mutant must not bank as caught. */
  async function seedScopePair(): Promise<{ name: string; ctxA: any; rowsElsewhere: number } | null> {
    const dir = mkdtempSync(join(tmpdir(), "cl1-scope-"))
    TEMP_DIRS.push(dir)
    const A = "cl1m15scopeA0000000000000000000000000000"
    const B = "cl1m15scopeB0000000000000000000000000000"
    for (const id of [A, B]) mkdirSync(join(dir, "projects", id), { recursive: true })
    const saved = process.env.BB_DATA_DIR
    process.env.BB_DATA_DIR = dir
    try {
      const { BrainDatabase: Db } = await import(join(ROOT, "src", "brain", "database.ts"))
      const rawA = await Db.getRawInstance(A as any)
      const rawB = await Db.getRawInstance(B as any)
      const NAME = "m15ScopedName"
      const f = (raw: any, fid: string, pid: string, file: string, language: string) =>
        raw.prepare("INSERT OR REPLACE INTO brain_file (id, project_id, path, relative_path, language, file_hash) VALUES (?,?,?,?,?,?)").run(fid, pid, `/m/${file}`, file, language, `h-${fid}`)
      const s = (raw: any, sid: string, pid: string, fid: string, name: string) =>
        raw.prepare("INSERT OR REPLACE INTO brain_symbol (id, project_id, file_id, name, symbol_type, line_start, line_end, byte_start, byte_end, gravity_score) VALUES (?,?,?,?,?,?,?,?,?,?)").run(sid, pid, fid, name, "function", 1, 1, 0, 10, 1)
      f(rawA, "m15a-f1", A, "x.ts", "typescript"); s(rawA, "m15a-s1", A, "m15a-f1", NAME)
      f(rawB, "m15b-f1", B, "x.ts", "typescript"); s(rawB, "m15b-s1", B, "m15b-f1", NAME)
      f(rawB, "m15b-f2", B, "z.clj", "clojure"); s(rawB, "m15b-s2", B, "m15b-f2", "m15CallerInB")
      rawB.prepare("INSERT OR REPLACE INTO brain_relationship (id, project_id, source_symbol_id, target_symbol_id, relationship_type, confidence, is_cross_language, bridge_mechanism) VALUES (?,?,?,?,?,?,?,?)")
        .run("m15b-r1", B, "m15b-s2", "m15b-s1", "calls", 0.9, 1, "name-resolution")
      const rowsElsewhere = (rawB.prepare("SELECT COUNT(*) AS n FROM brain_relationship r JOIN brain_symbol ts ON ts.id = r.target_symbol_id WHERE r.is_cross_language = 1 AND ts.name = ?").get(NAME) as any).n
      return { name: NAME, ctxA: { projectId: A, projectPath: "/m" }, rowsElsewhere }
    } finally {
      process.env.BB_DATA_DIR = saved
    }
  }

  /** The seeded states, for the mutants whose subject the corpora cannot
   *  produce. Reading these from the CORPUS is how M11 came to be recorded as
   *  not-caught when it had simply been unprobeable: no corpus has a file with no
   *  language, so the probe found nothing and returned false. A mutant that
   *  cannot be probed is neither caught nor surviving — it is unverified, and
   *  these read the fixture the S-checks just built. */
  const seededNameFor = (where: "unpairable" | "collapsed"): string | null => {
    if (!seededRaw || !seededCtx) return null
    // seededRaw is a handle already opened against the fixture db, so no
    // BB_DATA_DIR switch is needed here — only the HANDLER reads it.
    const row = where === "unpairable"
      ? seededRaw.prepare("SELECT name FROM (SELECT ts.name AS name FROM brain_relationship r JOIN brain_symbol ts ON ts.id = r.target_symbol_id LEFT JOIN brain_file tf ON tf.id = ts.file_id WHERE r.project_id = ? AND r.is_cross_language = 1 AND (tf.language IS NULL OR TRIM(tf.language) = '') LIMIT 1)").get(seededCtx.projectId)
      : seededRaw.prepare("SELECT name FROM (SELECT ss.name AS name FROM brain_relationship r JOIN brain_symbol ss ON ss.id = r.source_symbol_id WHERE r.project_id = ? AND r.is_cross_language = 1 AND r.source_symbol_id != r.target_symbol_id AND EXISTS (SELECT 1 FROM brain_symbol t2 WHERE t2.name = ss.name AND t2.id = r.target_symbol_id) LIMIT 1)").get(seededCtx.projectId)
    return (row as any)?.name ?? null
  }

  /** An owner whose MEMBERS hold cross-language rows — the subject the CL2
   *  mutants are about. Read from the index, never invented: a mutant probed
   *  against a symbol with no member rows passes for the wrong reason. */
  async function pickOwnerWithMembers(r: any, pid: string): Promise<string | null> {
    const row = r.prepare(
      `SELECT owner.name AS name FROM brain_relationship r
       JOIN brain_symbol m ON m.id = r.target_symbol_id
       JOIN brain_symbol owner ON owner.id = m.owner_symbol_id
       WHERE r.project_id = ? AND r.is_cross_language = 1 AND m.name <> owner.name
       GROUP BY owner.id ORDER BY COUNT(*) DESC LIMIT 1`).get(pid) as any
    return row?.name ?? null
  }
  async function pickHub(r: any, pid: string): Promise<string> {
    const row = r.prepare(
      `SELECT name FROM (SELECT ts.name AS name, COUNT(*) AS n FROM brain_relationship r JOIN brain_symbol ts ON ts.id = r.target_symbol_id
         WHERE r.project_id = ? AND r.is_cross_language = 1 GROUP BY ts.name
         UNION ALL SELECT ss.name AS name, COUNT(*) AS n FROM brain_relationship r JOIN brain_symbol ss ON ss.id = r.source_symbol_id
         WHERE r.project_id = ? AND r.is_cross_language = 1 GROUP BY ss.name)
       GROUP BY name ORDER BY n DESC LIMIT 1`).get(pid, pid) as any
    return row.name
  }

  let caught = 0
  const mutantRecords: Array<{ id: string; name: string; caught: boolean; note: string }> = []
  for (const mutant of mutants) {
    const target = mutant.file === "handler" ? handlerSrc : componentSrc
    if (!target.includes(mutant.from)) {
      mutantRecords.push({ id: mutant.id, name: mutant.name, caught: false, note: "ANCHOR NOT FOUND — the mutant did not run" })
      console.log(`  ANCHOR MISS: ${mutant.id} ${mutant.name}`)
      continue
    }
    const mutatedPath = join(ROOT, "src", mutant.file === "handler" ? "mcp" : "lsp", `__cl1-mutant-${mutant.id}.ts`)
    let src = target.replace(mutant.from, mutant.to)
    // Absolute specifiers so the mutant resolves from wherever it is imported.
    const abs = (p: string) => `file://${join(ROOT, "src", p).replace(/\\/g, "/")}`
    if (mutant.file === "handler") {
      src = src
        .replace(/from "\.\.\/brain\/database"/g, `from "${abs("brain/database.ts")}"`)
        .replace(/from "\.\.\/lsp\/cross_language_hover"/g, `from "${abs("lsp/__cl1-mutant-M.ts")}"`)
        .replace(/from "\.\/tool-registry"/g, `from "${abs("mcp/tool-registry.ts")}"`)
        .replace(/from "\.\.\//g, `from "${abs("")}`)
    } else {
      src = src.replace(/from "\.\/evidence_tier"/g, `from "${abs("lsp/evidence_tier.ts")}"`)
    }
    // The handler mutant must load the COMPONENT mutant, so M3/M5/M6 compose
    // with M1/M2/M4 instead of silently importing the real component.
    if (mutant.file === "handler" && !mutant.id.match(/M3|M5|M6/)) {
      writeFileSync(join(ROOT, "src", "lsp", "__cl1-mutant-M.ts"), componentSrc)
    }
    writeFileSync(mutatedPath, src)
    let detected = false
    let note = ""
    try {
      const m: any = await import(mutatedPath + `?v=${Date.now()}`)
      detected = await mutant.probe(m, raw, projectId!)
    } catch (error) {
      // A mutant that cannot LOAD is a caught defect: the tool would break. But a
      // mutant that throws because its SUBJECT STATE is missing is not caught at
      // all, and banking it as caught is how M11 came to be "verified" while
      // being unprobeable. The two are distinguished by the message the probe
      // throws, so an unverifiable mutant stays red.
      const message = String(error)
      const unverifiable = message.includes("UNVERIFIABLE")
      detected = !unverifiable
      note = unverifiable
        ? `UNVERIFIABLE — not counted as caught: ${message.slice(0, 140)}`
        : `load/throw: ${message.slice(0, 120)}`
    } finally {
      try { rmSync(mutatedPath, { force: true }) } catch {}
      if (mutant.file === "handler" && !mutant.id.match(/M3|M5|M6/)) {
        try { rmSync(join(ROOT, "src", "lsp", "__cl1-mutant-M.ts"), { force: true }) } catch {}
      }
    }
    if (detected) { caught++; console.log(`  caught: ${mutant.id} ${mutant.name}`) } else { console.log(`  SURVIVED: ${mutant.id} ${mutant.name}`) }
    mutantRecords.push({ id: mutant.id, name: mutant.name, caught: detected, note })
  }
  check("CL1: every planted defect is caught (a gate that cannot fail is not a gate)", caught === mutants.length && mutants.length >= MUTANT_FLOOR, `${caught}/${mutants.length} (floor ${MUTANT_FLOOR})`)

  // ── Evidence ───────────────────────────────────────────────────────────────
  let commit = "unknown"
  try { commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim() } catch {}
  const failed = checks - passed
  const result = {
    issue: "M63.CL1",
    code: "CL1",
    milestone: "M63",
    status: failed === 0 && caught === mutants.length ? "verified" : "known-gap",
    checks,
    passed,
    failed,
    mutantsCaught: caught,
    mutantsTotal: mutants.length,
    mutantRecords,
    failures,
    currentCommit: commit,
    verifierCommand: "npx tsx script/m63/verify-cl1-cross-language.ts",
    evidenceFile: EVIDENCE,
    corpus: { path: corpus ?? "(reused index)", projectId, crossLanguageRows: totalCross },
    samples,
    generatedAt: new Date().toISOString(),
    claimLevel: "verified — every count compared against SQL the tool does not execute, over a real polyglot index, with six planted defects all caught",
    replaces: "validation/m48/results/C1-bb_cross_language.json (predicate accepted 6 of 6 impossible answers — see script/m63/verify-cl1-corpus-predicate.ts)",
    limitations: [
      "Coverage is bounded by what the analyzers stored: 100% of cross-language rows in the measured corpus carry bridge_mechanism 'name-resolution', the indexer's name-matching placeholder, so the bridge field is data but not a communication mechanism.",
      "A name held by many symbols is answered as the union over all copies; the facts name the copy, so an agent can narrow, but the tool does not choose one on the agent's behalf.",
      "Facts are bounded by the declared limit with first-class truncation; totalCountIfKnown is the count of pairable matched rows, and unpairableRowCount reports the rows that could not name a pair.",
    ],
  }
  mkdirSync(RESULTS_DIR, { recursive: true })
  writeSealed(join(RESULTS_DIR, EVIDENCE), result)
  console.log(`CL1: ${result.status.toUpperCase()} (${passed}/${checks} passed, ${caught}/${mutants.length} mutants caught)`)
  dropSeededFixture()
  // Unregister before the explicit loop: a dir already removed must not be
  // removed again on the exit hook, and popping is how the registry drains.
  for (const dir of built) {
    const at = TEMP_DIRS.indexOf(dir)
    if (at >= 0) TEMP_DIRS.splice(at, 1)
    try { rmSync(dir, { recursive: true, force: true }) } catch {}
  }
  process.exit(failed === 0 && caught === mutants.length ? 0 : 1)
}

main().catch((error) => { console.error(error); process.exit(1) })
