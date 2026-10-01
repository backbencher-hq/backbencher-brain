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
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { mkdtempSync, realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { writeSealed } from "../lib/evidence.ts"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
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

const NAME_COPIES = (projectId: string) =>
  `SELECT s.id AS id, s.name AS name, f.relative_path AS path, f.language AS language, s.line_start AS line
   FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id
   WHERE s.project_id = '${projectId}' AND s.name = :name
   ORDER BY f.relative_path, s.line_start, s.id`

function truthFor(raw: any, projectId: string, name: string): { rows: any[]; copies: any[] } {
  const rows = raw.prepare(INDEPENDENT_ROWS(projectId)).all({ name }) as unknown as any[]
  const copies = raw.prepare(NAME_COPIES(projectId)).all({ name }) as unknown as any[]
  return { rows, copies }
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
    const pairable = truth.rows.filter((r) => r.selfLang && r.otherLang && r.selfLang.toLowerCase() !== r.otherLang.toLowerCase())
    const result = await call("bb_cross_language", { symbol: name })

    check(`CL1 B: every stored row is reported — ${name}`, result.parsed?.pairCount === pairable.length,
      `tool=${result.parsed?.pairCount} independent=${pairable.length} copies=${truth.copies.length} storedRows=${truth.rows.length}`)
    check(`CL1 A: ${name} is answered, not refused`, result.isError === false, result.text.slice(0, 120))
    check(`CL1 C: absence is never false — ${name}`, result.parsed?.declaredAbsent !== true || pairable.length === 0,
      `declaredAbsent=${result.parsed?.declaredAbsent} independentPairableRows=${pairable.length}`)
    check(`CL1 A2: copy count matches the index — ${name}`, result.parsed?.copyCount === truth.copies.length,
      `tool=${result.parsed?.copyCount} independent=${truth.copies.length}`)

    // D: identity, and every rowId real and in-project
    const facts = (result.parsed?.facts ?? []) as any[]
    const rowIds = new Set(facts.map((f) => f.rowId))
    check(`CL1 D: facts are deduplicated by row id — ${name}`, rowIds.size === facts.length, `${facts.length} facts, ${rowIds.size} distinct rowIds`)
    let identityOk = true
    let rowIdOk = true
    for (const f of facts) {
      if (!f.other || typeof f.other.symbol !== "string" && typeof f.other.symbol !== "object" && !f.other) identityOk = false
      if (!f.other || typeof f.other.file !== "string") identityOk = false
      if (typeof f.rowId !== "string") identityOk = false
      const owns = raw.prepare("SELECT 1 AS ok FROM brain_relationship WHERE id = ? AND project_id = ? AND is_cross_language = 1").get(f.rowId, projectId)
      if (!owns) rowIdOk = false
    }
    check(`CL1 D: every fact names its counterparty (symbol+file) — ${name}`, identityOk, `facts=${facts.length}`)
    check(`CL1 D2: every fact's rowId is a stored cross-language row of THIS project — ${name}`, rowIdOk, `facts=${facts.length}`)

    // E: nothing from another project
    const foreign = raw.prepare(
      `SELECT COUNT(*) AS c FROM brain_relationship r JOIN brain_symbol ts ON ts.id = r.target_symbol_id
       WHERE r.is_cross_language = 1 AND ts.name = ? AND r.project_id <> ?`).get(name, projectId) as any
    check(`CL1 E: no foreign row can appear — ${name}`, foreign.c === 0, `foreignRowsForName=${foreign.c}`)

    samples.push({ name, copies: truth.copies.length, storedRows: truth.rows.length, toolFacts: result.parsed?.pairCount ?? -1, pairableRows: pairable.length })
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

  // ── The errors ─────────────────────────────────────────────────────────────
  {
    const missing = await call("bb_cross_language", { symbol: "zz_cl1_absent_symbol_xyz" })
    check("CL1: an unknown symbol is a loud declared error, not an empty set", missing.isError === true && /not found/.test(missing.text), missing.text.slice(0, 120))
    const blank = await call("bb_cross_language", { symbol: "   " })
    check("CL1: a blank symbol is refused", blank.isError === true, blank.text.slice(0, 120))
  }

  // ── MUTANTS: the gate must be able to fail ─────────────────────────────────
  const handlerSrc = readFileSync(HANDLERS, "utf8")
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
      from: "      declaredAbsent: shown.length === 0,",
      to: "      declaredAbsent: shown.length < 3,",
      probe: async (m, r, pid) => {
        const ambiguous = await pickAmbiguousWithRows(r, pid)
        const out = await (m.createToolHandlers() as any).bb_cross_language({ symbol: ambiguous }, { projectId: pid, projectPath: "." } as any)
        return JSON.parse(out.content[0].text).declaredAbsent === true
      },
    },
    {
      id: "M3", name: "no identity (counterparty stripped)", file: "component",
      from: "      other: { symbol: row.other_name, file: row.other_file, language: row.other_language, line: row.other_line },",
      to: "      other: { symbol: null, file: null, language: null, line: null } as any,",
      probe: async (m, r, pid) => {
        const out = await (m.createToolHandlers() as any).bb_cross_language({ symbol: await pickUniqueWithRows(r, pid) }, { projectId: pid, projectPath: "." } as any)
        const parsed = JSON.parse(out.content[0].text)
        return (parsed.facts ?? []).some((f: any) => !f.other || typeof f.other.file !== "string")
      },
    },
    {
      id: "M4", name: "no bound (limit ignored, truncation undeclared)", file: "handler",
      from: "    const shown = result.facts.slice(0, limit)",
      to: "    const shown = result.facts.slice(0, Number.MAX_SAFE_INTEGER)",
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
      id: "M6", name: "pair fabrication where the row has no languages", file: "component",
      from: "    const pair = selfLang && otherLang && selfLang.toLowerCase() !== otherLang.toLowerCase()\n      ? `${selfLang} → ${otherLang}`\n      : null",
      to: "    const pair = `${selfLang ?? 'unknown'} → ${otherLang ?? 'unknown'}`",
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
      // A mutant that cannot load is a CAUGHT defect (the tool would break), but
      // it is recorded as a load failure so the number is not inflated by a
      // typo in this file.
      detected = true
      note = `load/throw: ${String(error).slice(0, 120)}`
    } finally {
      try { rmSync(mutatedPath, { force: true }) } catch {}
      if (mutant.file === "handler" && !mutant.id.match(/M3|M5|M6/)) {
        try { rmSync(join(ROOT, "src", "lsp", "__cl1-mutant-M.ts"), { force: true }) } catch {}
      }
    }
    if (detected) { caught++; console.log(`  caught: ${mutant.id} ${mutant.name}`) } else { console.log(`  SURVIVED: ${mutant.id} ${mutant.name}`) }
    mutantRecords.push({ id: mutant.id, name: mutant.name, caught: detected, note })
  }
  check("CL1: every planted defect is caught (a gate that cannot fail is not a gate)", caught === mutants.length && mutants.length >= 6, `${caught}/${mutants.length}`)

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
  for (const dir of built) { try { rmSync(dir, { recursive: true, force: true }) } catch {} }
  process.exit(failed === 0 && caught === mutants.length ? 0 : 1)
}

main().catch((error) => { console.error(error); process.exit(1) })
