// validation/tools/bb_cross_language/verify-cross-language.ts
//
// The falsifiable gate for bb_cross_language. It builds seeded store states the
// shipped corpora cannot reach (null-language rows, equal-language rows, a
// cross-project row pointing at this project's symbol, descendants that are the
// source of a cross-language row), checks the tool's answers against oracles this
// gate owns, and then PLANTS the defects those checks exist for — including a
// ROW-LEVEL project-predicate mutant — proving each one is caught by a probe that
// returns false on the unmutated code (probe polarity) and true on the mutant.
//
// Run: BB_NO_AUTO_REFRESH=1 npx tsx validation/tools/bb_cross_language/verify-cross-language.ts
//
// Optional corpus legs (recorded as `blocked` with the exact command when the index
// is absent, never silently skipped):
//   BB_GATE_CORPUS_DIR + BB_GATE_CORPUS_PROJECT  — row-set equality of the shipped
//   by-name statements against the join-order rewrite, on an index WITH rows.
//   e.g. BB_GATE_CORPUS_DIR=validation/tools/bb_cross_language/bbdata \
//        BB_GATE_CORPUS_PROJECT=a0e74040fb5c01a56dabd69d78711044402b104e
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { execFileSync } from "node:child_process"

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, "..", "..", "..")
const RESULTS = join(HERE, "results")
const COMPONENT = join(ROOT, "src", "lsp", "cross_language_hover.ts")
const HANDLER = join(ROOT, "src", "mcp", "tools", "bb_cross_language", "handler.ts")
const DATA = mkdtempSync(join(tmpdir(), "bbcl-gate-"))
process.env.BB_DATA_DIR = DATA
process.env.BB_NO_AUTO_REFRESH = "1"

const A = "clgatea0000000000000000000000000000000"
const B = "clgateb0000000000000000000000000000000"

let checks = 0
let passed = 0
const failures: string[] = []
const check = (label: string, ok: boolean, detail = "") => {
  checks++
  if (ok) passed++
  else { failures.push(`${label}${detail ? ` — ${detail}` : ""}`); console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`) }
}

type Handlers = Record<string, (args: any, ctx: any) => Promise<any>>
const parse = (result: any) => {
  const text = result?.content?.[0]?.text ?? ""
  try { return { parsed: JSON.parse(text), text } } catch { return { parsed: null, text } }
}

// ── the seeded store ─────────────────────────────────────────────────────────
async function seed(): Promise<{ raw: any; handlers: Handlers; ctxA: any }> {
  const { BrainDatabase } = await import(join(ROOT, "src", "brain", "database.ts"))
  const { createToolHandlers } = await import(join(ROOT, "src", "mcp", "tool-handlers.ts"))
  mkdirSync(join(DATA, "projects", A), { recursive: true })
  const rawA = await (BrainDatabase as any).getRawInstance(A)
  // Project B's rows live in the SAME database file, under their own project_id.
  // That is the leak shape the tool guards against: a relationship row minted for
  // another project and pointing at this project's symbol. Two separate database
  // files could not express it (the foreign target would fail the FK before the
  // tool ever ran), and the per-project path is not what the row's project filter
  // is for.
  const rawB = rawA

  const file = (raw: any, pid: string, id: string, relative: string, language: string | null) =>
    raw.prepare("INSERT OR REPLACE INTO brain_file (id, project_id, path, relative_path, language, file_hash) VALUES (?,?,?,?,?,?)")
      .run(id, pid, `/g/${relative}`, relative, language, `h-${id}`)
  const sym = (raw: any, pid: string, id: string, fileId: string, name: string, owner: string | null, line = 1) =>
    raw.prepare("INSERT OR REPLACE INTO brain_symbol (id, project_id, file_id, name, symbol_type, line_start, line_end, byte_start, byte_end, gravity_score, owner_symbol_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
      .run(id, pid, fileId, name, "function", line, line, 0, 10, 1, owner)
  const rel = (raw: any, pid: string, id: string, src: string, tgt: string, cross: 0 | 1, bridge: string | null, type = "calls") =>
    raw.prepare("INSERT OR REPLACE INTO brain_relationship (id, project_id, source_symbol_id, target_symbol_id, relationship_type, confidence, is_cross_language, bridge_mechanism) VALUES (?,?,?,?,?,?,?,?)")
      .run(id, pid, src, tgt, type, 0.9, cross, bridge)

  // A: the main fixture. gateTarget (ts) holds one own row from a clojure caller.
  file(rawA, A, "a-ts", "target.ts", "typescript")
  file(rawA, A, "a-clj", "caller.clj", "clojure")
  file(rawA, A, "a-py", "other.py", "python")
  file(rawA, A, "a-java", "other.java", "java")
  sym(rawA, A, "a-target", "a-ts", "gateTarget", null)
  sym(rawA, A, "a-caller", "a-clj", "gateCaller", null)
  sym(rawA, A, "a-py-sym", "a-py", "gatePy", null)
  sym(rawA, A, "a-java-sym", "a-java", "gateJava", null)
  rel(rawA, A, "a-own-1", "a-caller", "a-target", 1, "name-resolution")
  // B: another project, holding a cross-language row that POINTS AT A's symbol.
  file(rawB, B, "b-clj", "foreign.clj", "clojure")
  sym(rawB, B, "b-src", "b-clj", "gateForeignCaller", null)
  rel(rawB, B, "b-leak-row", "b-src", "a-target", 1, "LEAK-FROM-ANOTHER-PROJECT")

  // A member row under an owner (member ts, other python): member fact shape.
  file(rawA, A, "a-owner", "owner.kt", "kotlin")
  sym(rawA, A, "a-owner-s", "a-owner", "gateOwner", null)
  file(rawA, A, "a-member", "member.ts", "typescript")
  sym(rawA, A, "a-member-s", "a-member", "gateMember", "a-owner-s")
  rel(rawA, A, "a-mem-1", "a-py-sym", "a-member-s", 1, "name-resolution")
  // Owner with a member of the SAME NAME as the owner: the member scan's
  // `m.name <> owner.name` exclusion is the only thing that keeps this out.
  file(rawA, A, "a-owner2", "owner2.kt", "kotlin")
  sym(rawA, A, "a-owner2-s", "a-owner2", "gateTwinOwner", null)
  file(rawA, A, "a-twin", "twin.clj", "clojure")
  sym(rawA, A, "a-twin-s", "a-twin", "gateTwinOwner", "a-owner2-s")
  rel(rawA, A, "a-twin-row", "a-py-sym", "a-twin-s", 1, "name-resolution")

  // Unpairable rows: null-language endpoint, and equal-language ends.
  file(rawA, A, "a-nolang", "mystery.unknownlang", null)
  sym(rawA, A, "a-nolang-s", "a-nolang", "gatePairless", null)
  rel(rawA, A, "a-pairless-row", "a-caller", "a-nolang-s", 1, "name-resolution")
  file(rawA, A, "a-same-a", "same1.ts", "typescript")
  file(rawA, A, "a-same-b", "same2.ts", "typescript")
  sym(rawA, A, "a-same-a-s", "a-same-a", "gateSameLang", null)
  sym(rawA, A, "a-same-b-s", "a-same-b", "gateSameCaller", null)
  rel(rawA, A, "a-same-row", "a-same-b-s", "a-same-a-s", 1, "name-resolution")
  // A NON-cross row into a name of its own: only the is_cross_language filter keeps
  // it out of the facts.
  file(rawA, A, "a-noncross", "noncross.ts", "typescript")
  sym(rawA, A, "a-noncross-s", "a-noncross", "gateNonCross", null)
  rel(rawA, A, "a-noncross-row", "a-caller", "a-noncross-s", 0, null)

  // Deeper descendants, one row into a descendant and one row OUT of another
  // descendant — the direction asymmetry the count used to have.
  file(rawA, A, "a-deep", "deep.ts", "typescript")
  file(rawA, A, "a-deep-child", "deepChild.clj", "clojure")
  file(rawA, A, "a-deep-gout", "deepGrandOut.kt", "kotlin")
  file(rawA, A, "a-deep-gin", "deepGrandIn.kt", "kotlin")
  sym(rawA, A, "a-deep-s", "a-deep", "gateDeep", null)
  sym(rawA, A, "a-deep-child-s", "a-deep-child", "gateDeepChild", "a-deep-s")
  sym(rawA, A, "a-deep-gout-s", "a-deep-gout", "gateDeepGrandOut", "a-deep-child-s")
  sym(rawA, A, "a-deep-gin-s", "a-deep-gin", "gateDeepGrandIn", "a-deep-child-s")
  rel(rawA, A, "a-deep-out-row", "a-deep-gout-s", "a-java-sym", 1, "name-resolution")
  rel(rawA, A, "a-deep-in-row", "a-java-sym", "a-deep-gin-s", 1, "name-resolution")

  // Budget + counts: two own facts with DIFFERENT pairs and directions, three
  // member facts sharing one pair (so pairCount and signatureCount differ from
  // factCount and from each other).
  file(rawA, A, "a-bud", "budget.ts", "typescript")
  sym(rawA, A, "a-bud-s", "a-bud", "gateBudget", null, 3)
  rel(rawA, A, "a-bud-own-1", "a-caller", "a-bud-s", 1, "name-resolution")
  rel(rawA, A, "a-bud-own-2", "a-bud-s", "a-py-sym", 1, "name-resolution")
  file(rawA, A, "a-bud-owner", "budgetOwner.kt", "kotlin")
  // The owner is a SECOND COPY of the asked name: the member scan is keyed on
  // `owner.name = ?`, so a member's rows are reachable from the name only when the
  // owner itself carries that name.
  sym(rawA, A, "a-bud-owner-s", "a-bud-owner", "gateBudget", null)
  for (let i = 1; i <= 3; i++) {
    file(rawA, A, `a-bm${i}`, `bm${i}.kt`, "kotlin")
    sym(rawA, A, `a-bm${i}-s`, `a-bm${i}`, `gateBudgetMember${i}`, "a-bud-owner-s")
    rel(rawA, A, `a-bud-mem-${i}`, "a-py-sym", `a-bm${i}-s`, 1, "name-resolution")
  }
  // Silent owner: member rows, none of its own.
  file(rawA, A, "a-silent", "silent.kt", "kotlin")
  file(rawA, A, "a-silent-member", "silentMember.ts", "typescript")
  sym(rawA, A, "a-silent-s", "a-silent", "gateSilent", null)
  sym(rawA, A, "a-silent-member-s", "a-silent-member", "gateSilentMember", "a-silent-s")
  rel(rawA, A, "a-silent-row", "a-py-sym", "a-silent-member-s", 1, "name-resolution")
  // Copies: three copies, one stored row.
  for (const [i, lang] of [[1, "typescript"], [2, "javascript"], [3, "python"]] as const) {
    file(rawA, A, `a-copy${i}`, `copy${i}.${i === 3 ? "py" : "ts"}`, lang)
    sym(rawA, A, `a-copy${i}-s`, `a-copy${i}`, "gateCopies", null, i)
  }
  rel(rawA, A, "a-copies-row", "a-java-sym", "a-copy2-s", 1, "name-resolution")
  // A genuinely unconnected name.
  file(rawA, A, "a-absent", "absent.ts", "typescript")
  sym(rawA, A, "a-absent-s", "a-absent", "gateAbsent", null)

  const handlers = createToolHandlers() as Handlers
  return { raw: rawA, handlers, ctxA: { projectId: A, projectPath: "/g" } }
}

const ask = async (handlers: Handlers, ctx: any, args: Record<string, unknown>) => {
  const result = await handlers["bb_cross_language"](args, ctx)
  const { parsed, text } = parse(result)
  return { parsed, text, isError: result?.isError === true }
}
const rowIds = (facts: any[]) => (facts ?? []).map((f: any) => f.rowId).sort()

async function main(): Promise<void> {
  const { raw, handlers, ctxA } = await seed()

  // ── the answer shapes ───────────────────────────────────────────────────────
  const target = await ask(handlers, ctxA, { symbol: "gateTarget" })
  check("G1: a stored cross-language row produces a fact", rowIds(target.parsed?.facts).join(",") === "a-own-1", JSON.stringify(rowIds(target.parsed?.facts)))
  check("G1b: every fact names both ends and the stored row id", (target.parsed?.facts ?? []).every((f: any) => f.self?.symbol === "gateTarget" && f.other?.symbol === "gateCaller" && typeof f.rowId === "string"))
  check("G2: a cross-project row is NOT a fact about this project's symbol", !JSON.stringify(target.parsed ?? {}).includes("LEAK-FROM-ANOTHER-PROJECT"), "foreign row leaked")
  check("G2b: the foreign row is really in the store (control)", (raw.prepare("SELECT COUNT(*) n FROM brain_relationship WHERE id = 'b-leak-row'").get() as any).n === 1)
  check("G2c: storedRowCount is this project's rows only", target.parsed?.storedRowCount === 1, `storedRowCount=${target.parsed?.storedRowCount}`)

  // member fact shape (D3)
  const owner = await ask(handlers, ctxA, { symbol: "gateOwner" })
  const mem = (owner.parsed?.memberFacts ?? [])[0]
  check("G3: a member fact's self is the MEMBER the row names", mem?.self?.symbol === "gateMember", JSON.stringify(mem?.self ?? null))
  check("G3b: and its owner is the copy the row was attributed through", mem?.owner?.symbol === "gateOwner", JSON.stringify(mem?.owner ?? null))
  check("G3c: and pair is exactly self.language → other.language", mem?.pair === `${mem?.self?.language} → ${mem?.other?.language}`, `pair=${mem?.pair}`)
  check("G3d: matchedMember mirrors self and matchedMemberId is the member id", JSON.stringify(mem?.matchedMember) === JSON.stringify(mem?.self) && mem?.matchedMemberId === "a-member-s")
  check("G3e: silentItselfButNotItsMembers describes the owner-only case", owner.parsed?.silentItselfButNotItsMembers === true && owner.parsed?.ownFactCount === 0)
  const twin = await ask(handlers, ctxA, { symbol: "gateTwinOwner" })
  check("G3f: a member named exactly like its owner is reported once, as an own row, never as a cascade", (twin.parsed?.memberFacts ?? []).length === 0 && twin.parsed?.factCount === 1, `memberFacts=${(twin.parsed?.memberFacts ?? []).length} factCount=${twin.parsed?.factCount}`)

  // absence law (D1)
  const pairless = await ask(handlers, ctxA, { symbol: "gatePairless" })
  check("G4: a stored row that cannot name a pair is NOT absence", pairless.parsed?.declaredAbsent === false, `declaredAbsent=${pairless.parsed?.declaredAbsent}`)
  check("G4b: it is counted, with a note that names the count", pairless.parsed?.unpairableRowCount === 1 && /unpairable/i.test(String(pairless.parsed?.pairlessRowNote)), `unpairable=${pairless.parsed?.unpairableRowCount} note=${String(pairless.parsed?.pairlessRowNote).slice(0, 70)}`)
  check("G4c: and no fact is invented for it", pairless.parsed?.factCount === 0 && pairless.parsed?.absenceNote === null)
  const sameLang = await ask(handlers, ctxA, { symbol: "gateSameLang" })
  check("G4d: equal-language ends are unpairable, not absence", sameLang.parsed?.declaredAbsent === false && sameLang.parsed?.unpairableRowCount === 1 && sameLang.parsed?.factCount === 0)
  const nonCross = await ask(handlers, ctxA, { symbol: "gateNonCross" })
  check("G4e: a same-language row flagged NOT cross-language is not a fact and not counted", nonCross.parsed?.storedRowCount === 0 && nonCross.parsed?.factCount === 0 && rowIds(nonCross.parsed?.facts).length === 0)
  const absent = await ask(handlers, ctxA, { symbol: "gateAbsent" })
  check("G4f: a genuinely unconnected name declares absence, with no pairless note", absent.parsed?.declaredAbsent === true && absent.parsed?.pairlessRowNote === null && typeof absent.parsed?.absenceNote === "string")
  check("G4g: and the symbol still exists in the index (absence is about rows, not existence)", absent.parsed?.copyCount === 1)

  // deeper descendants, both directions (D2)
  const deep = await ask(handlers, ctxA, { symbol: "gateDeep" })
  check("G5: rows on descendants at depth>=2 are counted in BOTH directions", deep.parsed?.deeperDescendantRowCount === 2, `count=${deep.parsed?.deeperDescendantRowCount}`)
  check("G5b: and the count is published only when it is non-zero", typeof deep.parsed?.deeperDescendantNote === "string" && /descendants/i.test(String(deep.parsed?.deeperDescendantNote)))
  check("G5c: the descendant rows are never emitted as the owner's facts", deep.parsed?.factCount === 0 && deep.parsed?.declaredAbsent === true)

  // counts and budget (D5/D6)
  const budget1 = await ask(handlers, ctxA, { symbol: "gateBudget", limit: 1 })
  check("G6: the budget is own-facts-first at limit 1", budget1.parsed?.ownFactCount === 1 && budget1.parsed?.memberFactCount === 0, `own=${budget1.parsed?.ownFactCount} member=${budget1.parsed?.memberFactCount}`)
  check("G6b: both section truncation flags are named and true when the limit cuts each section", budget1.parsed?.ownFactsTruncated === true && budget1.parsed?.memberFactsTruncated === true)
  check("G6c: the pre-truncation total and member count are declared", budget1.parsed?.totalCountIfKnown === 5 && budget1.parsed?.memberCount === 3, `total=${budget1.parsed?.totalCountIfKnown} memberCount=${budget1.parsed?.memberCount}`)
  check("G6d: truncation is declared with a reason", budget1.parsed?.truncated === true && typeof budget1.parsed?.truncationReason === "string")
  const budget5 = await ask(handlers, ctxA, { symbol: "gateBudget", limit: 5 })
  check("G6e: factCount counts facts", budget5.parsed?.factCount === 5, `factCount=${budget5.parsed?.factCount}`)
  check("G6f: pairCount counts DISTINCT pairs, not facts", budget5.parsed?.pairCount === 3, `pairCount=${budget5.parsed?.pairCount}`)
  check("G6g: signatureCount counts distinct (pair, direction, bridge, tier)", budget5.parsed?.signatureCount === 3, `signatureCount=${budget5.parsed?.signatureCount}`)

  // copies (bounds)
  const copies = await ask(handlers, ctxA, { symbol: "gateCopies", limit: 1 })
  check("G7: copyCount is the true total and ambiguous is set", copies.parsed?.copyCount === 3 && copies.parsed?.ambiguous === true)
  check("G7b: the copy cap is declared even when it does not bite", copies.parsed?.copiesCap === 200 && copies.parsed?.copiesTruncated === false)

  // refusals
  for (const [label, args] of [
    ["blank symbol", { symbol: "   " }],
    ["missing symbol", {}],
    ["unknown symbol", { symbol: "no-such-name-xyz" }],
    ["limit 0", { symbol: "gateTarget", limit: 0 }],
    ["limit 1001", { symbol: "gateTarget", limit: 1001 }],
    ["fractional limit", { symbol: "gateTarget", limit: 2.5 }],
    ["string limit", { symbol: "gateTarget", limit: "5" }],
  ] as const) {
    const answer = await ask(handlers, ctxA, args as Record<string, unknown>)
    check(`G8: ${label} is a declared error`, answer.isError === true, answer.text.slice(0, 100))
  }
  const g9 = await ask(handlers, ctxA, { symbol: "gateTarget" })
  check("G9: the same call twice gives the same bytes", g9.text === target.text)

  // ── corpus leg: row-set equality of the D4 join-order rewrite ───────────────
  const blockedLegs: Array<{ leg: string; command: string; reason: string }> = []
  const corpusDir = process.env.BB_GATE_CORPUS_DIR
  const corpusProject = process.env.BB_GATE_CORPUS_PROJECT
  if (corpusDir && corpusProject) {
    const Database = (await import("better-sqlite3")).default as any
    const db = new Database(join(corpusDir, "projects", corpusProject, "brain.db"), { readonly: true, fileMustExist: true })
    try {
      const names = (db.prepare(
        `SELECT ts.name AS name FROM brain_relationship r JOIN brain_symbol ts ON ts.id = r.target_symbol_id
         WHERE r.project_id = ? AND r.is_cross_language = 1 GROUP BY ts.name ORDER BY COUNT(*) DESC LIMIT 25`,
      ).all(corpusProject) as any[]).map((x) => x.name as string)
      check("G10: the corpus leg has names to compare (a leg over zero names proves nothing)", names.length > 0, `names=${names.length}`)
      let equal = true
      for (const name of names) {
        // Shipped shape (relationship table first) vs the rewrite (symbol name
        // index first). Same predicates, different join order: the row SET must be
        // identical, element by element, not merely the same size.
        const OLD = `SELECT r.id AS row_id FROM brain_relationship r
          JOIN brain_symbol ts ON ts.id = r.target_symbol_id JOIN brain_symbol ss ON ss.id = r.source_symbol_id
          WHERE r.project_id = ? AND r.is_cross_language = 1 AND ts.name = ?
          UNION ALL SELECT r.id FROM brain_relationship r
          JOIN brain_symbol ss ON ss.id = r.source_symbol_id JOIN brain_symbol ts ON ts.id = r.target_symbol_id
          WHERE r.project_id = ? AND r.is_cross_language = 1 AND ss.name = ? ORDER BY row_id`
        const NEW = `SELECT r.id AS row_id FROM brain_symbol ts
          CROSS JOIN brain_relationship r ON r.target_symbol_id = ts.id AND r.is_cross_language = 1
          CROSS JOIN brain_symbol ss ON ss.id = r.source_symbol_id
          WHERE ts.name = ? AND r.project_id = ?
          UNION ALL SELECT r.id FROM brain_symbol ts
          CROSS JOIN brain_relationship r ON r.source_symbol_id = ts.id AND r.is_cross_language = 1
          CROSS JOIN brain_symbol ss ON ss.id = r.target_symbol_id
          WHERE ts.name = ? AND r.project_id = ? ORDER BY row_id`
        const a = (db.prepare(OLD).all(corpusProject, name, corpusProject, name) as any[]).map((x) => x.row_id)
        const b = (db.prepare(NEW).all(name, corpusProject, name, corpusProject) as any[]).map((x) => x.row_id)
        if (JSON.stringify(a) !== JSON.stringify(b)) { equal = false; console.log(`    row-set mismatch for ${name}: old=${a.length} new=${b.length}`) }
      }
      check("G10b: the join-order rewrite returns an IDENTICAL row set on a corpus that has rows", equal)
    } finally { db.close() }
  } else {
    blockedLegs.push({
      leg: "D4 row-set equality on a corpus with stored rows",
      command: "BB_GATE_CORPUS_DIR=validation/tools/bb_cross_language/bbdata BB_GATE_CORPUS_PROJECT=<elixir project id> npx tsx validation/tools/bb_cross_language/verify-cross-language.ts",
      reason: "no corpus index was named (the seeded fixtures carry the projection tests, but only a real corpus can prove the rewrite preserves thousands of rows)",
    })
  }

  // ── the mutation suite ─────────────────────────────────────────────────────
  const handlerSource = readFileSync(HANDLER, "utf8")
  const componentSource = readFileSync(COMPONENT, "utf8")
  const HANDLER_DIR = join(ROOT, "src", "mcp", "tools", "bb_cross_language")
  const COMPONENT_DIR = join(ROOT, "src", "lsp")
  const SHIM = "\nexport function createToolHandlers() { return { bb_cross_language: handler } }\n"
  const componentSpecifier = "../../../lsp/cross_language_hover"

  interface Mutant {
    id: string
    name: string
    file: "handler" | "component"
    from: string
    to: string
    probe: (handlers: Handlers) => Promise<boolean>
  }
  const mutants: Mutant[] = [
    {
      // THE ROW-LEVEL MUTANT THIS GATE EXISTS FOR: the row's own project predicate
      // is dropped from the caller arm, so a relationship row minted for another
      // project and pointing at this project's symbol becomes a fact about it.
      id: "M1", name: "row-level project leak (row project predicate dropped)", file: "component",
      // The parameter count is preserved (`? IS NOT NULL` still binds the project
      // id), because a mutation that changes the statement's arity would fail to
      // load and that is a harness failure, not an observed leak.
      from: "WHERE ts.name = ? AND r.project_id = ?\nUNION ALL",
      to: "WHERE ts.name = ? AND (? IS NOT NULL)\nUNION ALL",
      probe: async (h) => {
        const answer = await ask(h, ctxA, { symbol: "gateTarget" })
        return JSON.stringify(answer.parsed ?? {}).includes("LEAK-FROM-ANOTHER-PROJECT") || (answer.parsed?.storedRowCount ?? 0) > 1
      },
    },
    {
      id: "M2", name: "cross-language flag dropped (a same-language row becomes a fact)", file: "component",
      from: "CROSS JOIN brain_relationship r ON r.target_symbol_id = ts.id AND r.is_cross_language = 1",
      to: "CROSS JOIN brain_relationship r ON r.target_symbol_id = ts.id",
      probe: async (h) => {
        const answer = await ask(h, ctxA, { symbol: "gateNonCross" })
        return (answer.parsed?.facts ?? []).some((f: any) => f.rowId === "a-noncross-row")
      },
    },
    {
      id: "M3", name: "storedRowCount drops the member section (rows silently uncounted)", file: "component",
      from: "    storedRowCount: rows.length + memberRows.length,",
      to: "    storedRowCount: rows.length,",
      probe: async (h) => {
        // gateOwner's own rows are zero and it has exactly one member row, so a
        // count that drops the member section says 0 for a store that holds 1.
        const answer = await ask(h, ctxA, { symbol: "gateOwner" })
        return answer.parsed?.storedRowCount !== 1
      },
    },
    {
      id: "M4", name: "the deeper count is target-only again (outgoing descendant rows vanish)", file: "component",
      // The source arm is retargeted (not deleted) so the statement keeps its
      // parameter count: a deletion would change the arity and fail to load, which
      // is a harness failure rather than an observed defect.
      from: "  SELECT r.id FROM down CROSS JOIN brain_relationship r ON r.source_symbol_id = down.id",
      to: "  SELECT r.id FROM down CROSS JOIN brain_relationship r ON r.target_symbol_id = down.id",
      probe: async (h) => {
        const answer = await ask(h, ctxA, { symbol: "gateDeep" })
        return answer.parsed?.deeperDescendantRowCount === 1
      },
    },
    {
      id: "M5", name: "a member fact's self goes back to the owner (pair no longer recomputable)", file: "component",
      from: "  const self: CrossLanguageEnd = { symbol: row.self_name, file: row.self_file, language: row.self_language, line: row.self_line }",
      to: "  const self: CrossLanguageEnd = { symbol: row.owner_name ?? row.self_name, file: row.owner_file ?? row.self_file, language: row.owner_language ?? row.self_language, line: row.owner_line ?? row.self_line }",
      probe: async (h) => {
        const answer = await ask(h, ctxA, { symbol: "gateOwner" })
        const fact = (answer.parsed?.memberFacts ?? [])[0]
        return !!fact && fact.pair !== `${fact.self?.language} → ${fact.other?.language}`
      },
    },
    {
      id: "M6", name: "absence keyed on emitted facts again (a stored row is declared absent)", file: "handler",
      from: "  const declaredAbsent = result.storedRowCount === 0",
      to: "  const declaredAbsent = result.facts.length === 0",
      probe: async (h) => {
        const answer = await ask(h, ctxA, { symbol: "gatePairless" })
        return answer.parsed?.declaredAbsent === true
      },
    },
    {
      id: "M7", name: "own-first budget broken (a member's edge crowds out the symbol's own)", file: "handler",
      from: "  const ownShown = result.facts.slice(0, limit)",
      to: "  const ownShown = result.facts.slice(0, 0)",
      probe: async (h) => {
        const answer = await ask(h, ctxA, { symbol: "gateBudget", limit: 1 })
        return answer.parsed?.ownFactCount !== 1
      },
    },
    {
      id: "M8", name: "a pair is fabricated for a row that cannot name one", file: "component",
      from: "  if (pair === null) { counters.unpairable++; return null }",
      to: "  if (pair === null) { counters.unpairable++; return { self: { symbol: row.self_name, file: row.self_file, language: row.self_language, line: row.self_line }, direction: row.direction, other: { symbol: row.other_name, file: row.other_file, language: row.other_language, line: row.other_line }, pair: \"unknown → unknown\", bridge: UNNAMED_BRIDGE, tier: \"inferred\", confidence: row.confidence ?? 0, relationshipType: row.relationship_type, rowId: row.row_id, match } }",
      probe: async (h) => {
        const answer = await ask(h, ctxA, { symbol: "gatePairless" })
        return (answer.parsed?.factCount ?? 0) > 0
      },
    },
  ]

  const mutantRecords: Array<{ id: string; name: string; caught: boolean; note: string }> = []
  let caught = 0
  for (const mutant of mutants) {
    const target = mutant.file === "handler" ? handlerSource : componentSource
    if (!target.includes(mutant.from)) {
      mutantRecords.push({ id: mutant.id, name: mutant.name, caught: false, note: "ANCHOR NOT FOUND — the mutant did not run" })
      console.log(`  ANCHOR MISS: ${mutant.id} ${mutant.name}`)
      continue
    }
    const mutated = target.replace(mutant.from, mutant.to)
    if (mutated === target) {
      mutantRecords.push({ id: mutant.id, name: mutant.name, caught: false, note: "the replacement reproduces the original text" })
      continue
    }
    const componentPath = join(COMPONENT_DIR, `__xlang-gate-${mutant.id}.ts`)
    const handlerPath = join(HANDLER_DIR, `__xlang-gate-${mutant.id}.ts`)
    let detected = false
    let note = ""
    try {
      if (mutant.file === "component") {
        writeFileSync(componentPath, mutated)
        if (!handlerSource.includes(`from "${componentSpecifier}"`)) throw new Error("harness: the handler no longer imports the component")
        writeFileSync(handlerPath, handlerSource.replace(`from "${componentSpecifier}"`, `from "${componentPath.replace(/\\/g, "/")}"`) + SHIM)
      } else {
        writeFileSync(handlerPath, mutated + SHIM)
      }
      const module: any = await import(`${handlerPath}?v=${Date.now()}`)
      const handlers = module.createToolHandlers() as Handlers
      detected = await mutant.probe(handlers)
    } catch (error) {
      // A mutant that cannot LOAD is a harness failure, not a catch: the mutation is
      // a source edit of a file this gate owns, so a parse/import error means the
      // transformation is wrong. Reporting it as caught is how a mutation suite goes
      // green while testing its own import errors.
      note = `HARNESS FAILURE — the mutant did not load: ${String(error).slice(0, 160)}`
      detected = false
    } finally {
      try { rmSync(componentPath, { force: true }) } catch {}
      try { rmSync(handlerPath, { force: true }) } catch {}
    }
    if (detected) { caught++; console.log(`  caught: ${mutant.id} ${mutant.name}`) } else { console.log(`  NOT CAUGHT: ${mutant.id} ${mutant.name}${note ? ` — ${note}` : ""}`) }
    mutantRecords.push({ id: mutant.id, name: mutant.name, caught: detected, note })
  }
  check("G11: every planted defect is caught by a probe that is false on the unmutated code", caught === mutants.length, `${caught}/${mutants.length}`)

  // PROBE POLARITY. A probe that returns true on the real code is not a probe; it is
  // a tautology that will report a defect no matter what. Run every probe against the
  // real handlers and require false.
  const polarity: string[] = []
  for (const mutant of mutants) {
    try {
      if (await mutant.probe(handlers)) polarity.push(mutant.id)
    } catch { polarity.push(`${mutant.id} (probe threw)`) }
  }
  check("G12: every probe is FALSE on the unmutated code (a probe that is always true cannot fail)", polarity.length === 0, polarity.join(", "))

  // No mutant module may be left in the source tree.
  const leftovers = [...readdirSync(HANDLER_DIR).filter((f) => f.startsWith("__xlang-gate-")), ...readdirSync(COMPONENT_DIR).filter((f) => f.startsWith("__xlang-gate-"))]
  check("G13: the mutation suite leaves no module behind in src/", leftovers.length === 0, leftovers.join(", "))

  // ── evidence ───────────────────────────────────────────────────────────────
  let commit = "unknown"
  try { commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim() } catch {}
  const failed = checks - passed
  const evidence = {
    schemaVersion: 1,
    tool: "bb_cross_language",
    status: failed === 0 && caught === mutants.length ? "verified" : "partial",
    currentCommit: commit,
    verifierCommand: "BB_NO_AUTO_REFRESH=1 npx tsx validation/tools/bb_cross_language/verify-cross-language.ts",
    checks,
    passed,
    failed,
    negativeCases: mutants.length,
    mutantsCaught: caught,
    mutantsTotal: mutants.length,
    mutantRecords,
    generatedAt: new Date().toISOString(),
    fixtures: { projects: [A, B], kind: "seeded store states the shipped corpora cannot reach" },
    blockedLegs,
    claimLevel: "verified — seeded-state answers checked against fixtures this gate owns, the D4 join-order rewrite proved row-set-identical when a corpus index is supplied, and every planted defect (including a ROW-LEVEL project-predicate leak) caught by a probe proved false on the unmutated code",
  }
  mkdirSync(RESULTS, { recursive: true })
  writeFileSync(join(RESULTS, "GATE.json"), JSON.stringify(evidence, null, 2) + "\n")
  console.log(`GATE: ${evidence.status.toUpperCase()} (${passed}/${checks} passed, ${caught}/${mutants.length} mutants caught)`)
  rmSync(DATA, { recursive: true, force: true })
  process.exit(evidence.status === "verified" ? 0 : 1)
}

main().catch((error) => { console.error(error); process.exit(1) })
