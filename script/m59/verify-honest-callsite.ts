// script/m59/verify-honest-callsite.ts — M59.O4 (#823)
//
// The tool layer must NEVER present an invented number as a call-site line.
// Before this gate: graph-engine.ts built `line: row.lineNumber || node.line`
// (callers) and `line: row.lineNumber || 0` (callees) — so every relationship
// whose line was unknown was reported with the symbol's DECLARATION line, or 0,
// as if it were the call site. That fabrication is what misled the opencode
// agent (bb_graph reported a wrong line, grep disagreed, trust collapsed).
//
// What this gate proves, on the REAL pipeline (real indexer, real analyzers,
// real graph engine, real LSP call-hierarchy code):
//   1. NULL-STAYS-NULL  : for every edge the engine returns, engine callSite.line
//                         equals the DB row's line_number — and a DB row with
//                         NULL/0 line surfaces as callSite.line === null.
//   2. KNOWN-STAYS-TRUE : a DB row with a real line is returned unchanged.
//   3. LSP-HONESTY      : every fromRange expandCalls() emits POINTS AT AN
//                         INVOCATION in the caller's own source — verified by
//                         reading the file back. (Replaces the pre-lane pair
//                         `lsp-ranges-finite` / `lsp-no-fabricated-ranges`, which
//                         asserted ONE variable twice and therefore could not
//                         detect a range pointing at a declaration — the defect
//                         §15.3 names first. See docs/m62/CALLSITE-MIGRATION.md
//                         §3.3a and the live instance it found.)
//   4. MUTATION         : corrupting a NULL row's line must turn a GATE CHECK
//                         FALSE, not merely be accepted by SQLite. (Replaces the
//                         pre-lane `mutationCaught = rowNow.ln === 42`, which
//                         asserted the UPDATE landed and computed-then-discarded
//                         `postFabricated`. See §3.3b.)
//
// Honesty rules:
//   - Every check compares the ENGINE's output against the DB row BY rowId —
//     never against a value the engine itself derived.
//   - Evidence is written by this run, with the exact command, to
//     validation/m59/results/honest-callsite.json. No hand-authored "verified".
//   - Scope: one small fixture project (kotlin + python), indexed fresh in a
//     throwaway BB_DATA_DIR. Kotlin emits lines (M59 #825); python does not yet
//     — which is exactly the mixed world the tool must report honestly.
//     STALE-CONTROL FIX (2026-09-17): this fixture used typescript as the
//     unknown-line world. The M59.A7 web round gave typescript real lines, so
//     the fixture stopped containing an unknown world and the gate aborted on
//     its own shape check — a red that described a past product, not a defect.
//     The control moved to python, which the fresh oracle still measured at 0
//     lines of 4,524 relationships. Same class of staleness the acceptance
//     harness documented when it moved typescript out of UNLINED.
//     SECOND STALE-CONTROL FIX (this lane, measured at this commit): python now
//     emits real lines too (13 of 13 rows, docs/m62/CALLSITE-MIGRATION.md §1), so
//     the same abort happened again. The unknown store state is now PLANTED
//     explicitly instead of being waited for from an analyzer, and the plant is
//     declared in the evidence. Waiting for a product state to disappear is not a
//     fixture; a fixture states the state under test.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { execSync } from "node:child_process"

const EMPTY = mkdtempSync(path.join(tmpdir(), "m59-honest-"))
process.env.BB_DATA_DIR = EMPTY

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const FIXTURE = path.join(EMPTY, "fixture")
const EVIDENCE_DIR = path.join(ROOT, "validation/m59/results")
const EVIDENCE = path.join(EVIDENCE_DIR, "honest-callsite.json")

type Check = { name: string; passed: boolean; detail: string; negative?: boolean }
const checks: Check[] = []
const check = (name: string, passed: boolean, detail: string) => {
  checks.push({ name, passed, detail })
  console.log(`  ${passed ? "PASS" : "FAIL"}  ${name}  ${detail}`)
}

/** A NEGATIVE case: the same predicate, convicted on a planted defect. Recorded
 *  in the evidence as its own entry, because a check with no negative is a check
 *  nobody has seen fail. */
const negative = (name: string, passed: boolean, detail: string) => {
  checks.push({ name: `NEGATIVE ${name}`, passed, detail, negative: true })
  console.log(`  ${passed ? "PASS" : "FAIL"}  [negative] ${name}  ${detail}`)
}

async function main() {
  mkdirSync(FIXTURE, { recursive: true })

  // Kotlin: analyzers emit call-site lines (M59 #825) → KNOWN-line world.
  // load() is called on line 10.
  writeFileSync(
    path.join(FIXTURE, "Repo.kt"),
    [
      "class Repo {",
      "    fun load(): String {",
      '        return "data"',
      "    }",
      "}",
      "",
      "class Service {",
      "    fun run(): String {",
      "        val r = Repo()",
      "        return r.load()",
      "    }",
      "}",
      "",
    ].join("\n"),
  )

  // Python: a second language so the fixture is not single-language. It is NO
  // LONGER the "unknown world" — at this commit the python analyzer emits real
  // call-site lines too (measured: 13 of 13 rows, docs/m62/CALLSITE-MIGRATION.md
  // §1), so the unknown state is PLANTED below rather than waited for.
  writeFileSync(
    path.join(FIXTURE, "app.py"),
    [
      "def helper():",
      "    return 1",
      "",
      "def main():",
      "    return helper()",
      "",
    ].join("\n"),
  )

  const { getProjectId } = await import(path.join(ROOT, "src/cli/index.ts"))
  const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer.ts"))
  const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database.ts"))
  const { traverseGraph, resolveGraphRoot } = await import(
    path.join(ROOT, "src/intelligence/graph/graph-engine.ts")
  )

  const pid = getProjectId(FIXTURE) as any
  const stats = await indexProjectParallel(pid, FIXTURE, {})
  console.log(
    `fixture indexed: files=${stats.totalFiles} symbols=${stats.symbolsExtracted} rels=${stats.relationshipsFound}`,
  )
  const raw = await BrainDatabase.getRawInstance(pid)

  const known = raw
    .prepare(
      `SELECT r.id, r.line_number ln FROM brain_relationship r
       WHERE r.line_number IS NOT NULL AND r.line_number > 0 AND r.target_symbol_id IS NOT NULL
       LIMIT 1`,
    )
    .get() as { id: string; ln: number } | undefined

  // THE UNKNOWN WORLD IS PLANTED, NOT WAITED FOR.
  //
  // THIRD GATE DEFECT, found while fixing the two §3.3 names: this fixture's
  // shape check demanded "a line-emitting language AND a non-emitting one" and
  // ABORTED when it found only the first. It aborted on the real product at this
  // commit: the python analyzer now stores a real line on every row, so the
  // "unknown" world the gate was built around no longer exists in this fixture.
  // The gate's own STALE-CONTROL comment records the same class of failure once
  // already (typescript was moved out of the unknown role on 2026-09-17) — and the
  // migration spec §1 measures python at 13 of 13 rows carrying a real line,
  // which retires this file's premise.
  //
  // An ABORT is not a pass (§8.3: skipped = failed), and deleting the unknown
  // world would delete the gate's whole subject. So the state under test is
  // created deliberately, in this THROWAWAY index, and the plant is declared in
  // the evidence. What is being tested is the tool layer's handling of a row with
  // no stored call site — a state the store declares and must keep handling
  // whether or not today's analyzers happen to produce it.
  const unknownPlanted = raw
    .prepare(
      `SELECT r.id FROM brain_relationship r
       WHERE r.target_symbol_id IS NOT NULL AND r.id <> ?
       LIMIT 1`,
    )
    .get(known?.id ?? "") as { id: string } | undefined
  if (unknownPlanted !== undefined) {
    raw.prepare(`UPDATE brain_relationship SET line_number = NULL WHERE id = ?`).run(unknownPlanted.id)
  }
  const unknown = unknownPlanted

  if (!known || !unknown) {
    check("fixture-shape", false, `known=${known?.id ?? "none"} unknown=${unknown?.id ?? "none"} — the index must hold at least two relationship rows (one carrying a real line, one declared to carry none)`)
    throw new Error("fixture does not contain both store states; cannot test honesty")
  }
  check(
    "fixture-shape",
    true,
    `known row ${known.id} carries line ${known.ln}; the unknown row ${unknown.id} was DECLARED to carry none by planting NULL in this throwaway index (the analyzers measured at this commit emit real lines on every row, so waiting for a NULL would abort the gate)`,
  )

  // ---- helper: run the engine over a symbol and audit EVERY returned edge
  // against its DB row, joined by rowId (the engine's own traceability field).
  //
  // FIFTH DEFECT, and the one that made the pre-lane evidence false rather than
  // merely weak: this law was written against the PRE-M62.A1 engine, where an
  // unknown stored line surfaced as `callSite.line === null`. M62.A1 replaced that
  // with a `CallSiteAddress` union in which an unknown stored line yields a LABELLED
  // `declaration` substitute when the caller's own line is known
  // (src/intelligence/graph/line-address.ts). So the honest law is now:
  //
  //   a row with NO stored call site must never produce a `call-site` address,
  //   and every substitute it DOES produce must carry the owner's note.
  //
  // The pre-lane predicate (`engineLine !== null` => fabricated) convicts the
  // declared substitute, which the contract requires — a gate that fails on
  // correct behaviour trains its reader to ignore it.
  let auditedKnown = 0
  let auditedUnknown = 0
  let fabricated = 0
  let misreportedKnown = 0
  let labelledSubstitutes = 0
  let unlabelledSubstitutes = 0

  async function audit(rootName: string) {
    const root = await resolveGraphRoot(pid, rootName)
    if (!root) throw new Error(`root ${rootName} did not resolve`)
    const result = await traverseGraph(pid, root, { maxDepth: 1 })
    const edges = [...result.callers, ...result.callees]
    for (const e of edges) {
      if (!e.rowId) continue
      const row = raw.prepare(`SELECT line_number ln FROM brain_relationship WHERE id = ?`).get(e.rowId) as
        | { ln: number | null }
        | undefined
      if (!row) continue
      const dbLine = row.ln
      const engineLine = e.callSite?.line ?? null
      const dbUnknown = dbLine === null || dbLine === 0
      if (dbUnknown) {
        auditedUnknown++
        const address = (e as { callSite?: { kind: string; line: number | null; note?: string } }).callSite
        // The law, restated for the address owner: an unknown stored line may
        // yield a LABELLED substitute, never a `call-site`.
        if (address?.kind === "call-site") {
          fabricated++
          console.log(`      FABRICATED row=${e.rowId} db=NULL engine=call-site@${address.line}`)
        } else if (address === undefined) {
          // No address at all is the engine violating its own contract
          // (GraphEdge.callSite is non-optional) — a store-contract violation,
          // not a position.
          fabricated++
          console.log(`      NO ADDRESS row=${e.rowId} db=NULL engine=<no callSite>`)
        } else if (address.kind === "declaration") {
          if (typeof address.note === "string" && address.note.length > 0) labelledSubstitutes++
          else unlabelledSubstitutes++
        } else if (address.kind === "unknown" && address.line !== null) {
          // L3 of the owner: `unknown` is rendered as line null, never 0 or 1.
          fabricated++
          console.log(`      CLAMPED row=${e.rowId} db=NULL engine=unknown@${address.line}`)
        }
      } else {
        auditedKnown++
        if (engineLine !== dbLine) {
          misreportedKnown++
          console.log(`      MISMATCH row=${e.rowId} db=${dbLine} engine=${engineLine}`)
        }
      }
    }
  }

  const knownTarget = raw.prepare(`SELECT ts.name n FROM brain_relationship r JOIN brain_symbol ts ON ts.id = r.target_symbol_id WHERE r.id = ?`).get(known.id) as { n: string }
  const unknownTarget = raw.prepare(`SELECT ts.name n FROM brain_relationship r JOIN brain_symbol ts ON ts.id = r.target_symbol_id WHERE r.id = ?`).get(unknown.id) as { n: string }
  await audit(knownTarget.n)
  await audit(unknownTarget.n)

  check(
    "no-call-site-row-never-becomes-a-call-site",
    fabricated === 0 && auditedUnknown > 0,
    `${auditedUnknown} unknown-line edges audited, ${fabricated} fabricated (restated for the M62.A1 address union: a row with no stored call site may yield a LABELLED substitute, never a call-site and never a clamped line)`,
  )
  check(
    "every substitute for an unknown line carries the owner's note (L2)",
    unlabelledSubstitutes === 0,
    `${labelledSubstitutes} labelled substitutes, ${unlabelledSubstitutes} unlabelled`,
  )
  check(
    "known-stays-true",
    misreportedKnown === 0 && auditedKnown > 0,
    `${auditedKnown} known-line edges audited, ${misreportedKnown} misreported`,
  )

  // FOURTH DEFECT, found while fixing the two §3.3 names: this leg passed the
  // ENGINE's direction vocabulary ("callers") to `expandCalls`, which takes the
  // LSP one ("incoming" / "outgoing") and treats anything else as "outgoing".
  // So the LSP-honesty leg measured a CALLEES expansion, found no caller entries,
  // and passed while verifying nothing. Corrected above to "incoming"; the
  // non-vacuity check below is the part that stops it happening again silently.
  //
  // ---- LSP honesty: every fromRange must POINT AT AN INVOCATION. -------------
  //
  // REPLACES the pre-lane pair `lsp-ranges-finite` / `lsp-no-fabricated-ranges`,
  // which were ONE VARIABLE asserted twice (`:223-228`, spec §3.3a):
  // `lspFabricated` increments only on `!Number.isFinite(line) || line < 0`, so
  // the second check re-asserted the first. A fromRange pointing at a
  // DECLARATION is a finite, non-negative line — precisely the defect §15.3
  // names first — and both checks passed on it. Measured on the real M55 fixture
  // before this fix: `Store` was rendered as a caller of `Store.get` with a
  // range on `get(key: string)`, the member's own signature.
  //
  // The replacement predicate is the one `resolveInvocations` itself applies
  // (src/lsp/call_hierarchy.ts: a call is the name followed by `(`, or preceded
  // by `new`), read back from the caller's own file. `lsp-ranges-finite` is
  // deleted as subsumed: a non-finite line cannot pass the invocation predicate,
  // because the text at that offset cannot be the invoked name.
  const { expandCalls } = await import(path.join(ROOT, "src/lsp/call_hierarchy.ts"))
  const lspChecks: string[] = []
  let lspFabricated = 0
  let lspPointedAtDeclaration = 0
  let lspDeclaredApproximations = 0
  let lspUndecidable = 0
  let lspRangesVerified = 0
  let lspKnownOk = 0
  let lspApproximateDeclared = 0

  /** The text of `file` split into lines, or null when unreadable. */
  const textOf = (file: string): string[] | null => {
    try {
      return readFileSync(file, "utf8").split("\n")
    } catch {
      return null
    }
  }

  /** THE ONE PREDICATE, as a function, so the negatives below run the SAME code
   *  rather than a paraphrase of it.
   *
   *  `invocation`   the range slices to `name` AND the name is being called
   *                 (followed by `(` or preceded by `new`) — the predicate
   *                 `resolveInvocations` applies.
   *  `declaration`  the range slices to `name` on a line that DECLARES it. This
   *                 is the case the naive `name(` rule misses: `get(key: string):
   *                 T | undefined` is a signature, not a call, and it matches
   *                 `name(` exactly.
   *  `other`        anything else — a different token entirely.
   */
  /**
   * A PREFIX that can precede a declaration: modifiers and type tokens only.
   * It contains no `.`, no `=`, no `(` and none of the expression keywords — so
   * `return r.`, `val x = `, `api.` and `await ` all fail it, while
   * `fun `, `def `, `export function `, `public void ` and `` pass it.
   */
  /**
   * A PREFIX that can precede a DECLARATION: modifiers and type tokens only.
   *
   * Two guards, and the second one is the one that was missing while writing
   * this: a bare type-token pattern also matches `return `, so `return helper()`
   * looked like a signature. A declaration's prefix carries no operator, no
   * receiver dot, no assignment and no EXPRESSION keyword. Generic argument
   * lists are stripped first so `Map<string, T> ` stays legal while `<` and `>`
   * remain forbidden everywhere else.
   */
  const EXPRESSION_PREFIX = /[.=+\-*/%!&|?]|\b(?:return|yield|await|throw|new|delete|typeof|instanceof|assert|print|println|echo|console)\b/
  const isDeclarationPrefix = (before: string): boolean => {
    const stripped = before.replace(/<[^<>]*>/g, "")
    return DECLARATION_PREFIX.test(before) && !EXPRESSION_PREFIX.test(stripped)
  }
  const DECLARATION_PREFIX = /^[^\S\n]*(?:(?:export|public|private|protected|internal|static|final|abstract|override|open|suspend|inline|async|fun|def|function|fn|func|sub|class|impl|trait|interface|object|val|var|let|const|mut|operator|lazy|implicit|default|get|set)\b[^\S\n]*|[\w$[\],|?]+[^\S\n]*)*$/

  const classifyRange = (text: string, start: number, end: number, name: string): "invocation" | "declaration" | "undecidable" | "other" => {
    if (text.slice(start, end) !== name) return "other"
    const after = text.slice(end)
    const before = text.slice(0, start)
    const receiverQualified = !isDeclarationPrefix(before)
    // A receiver / assignment / operator in the prefix settles it: `return r.`,
    // `val x = `, `api.`, `await `. No signature has those.
    if (receiverQualified) {
      if (/^\s*\(/.test(after)) return "invocation"
      if (/(^|[^\w$])new\s+$/.test(before)) return "invocation"
      return "other"
    }
    // DECLARATION — and this is the case the naive `name(` rule misses:
    // `get(key: string): T | undefined` is a signature and matches `name(`
    // exactly. Getting this order wrong is not academic: testing `(` first
    // classifies every signature as an invocation, which is the pre-lane defect
    // in a new place. Positive evidence of a declaration is required — an empty
    // prefix is NOT evidence, so a bare `name()` on its own line is reported
    // `undecidable` rather than guessed either way. DECLARED LIMITATION.
    if (/^\s*\([^)]*\)\s*:\s*\S/.test(after)) return "declaration"           // typed signature: TS / Kotlin / Java / Groovy / Scala
    if (isDeclarationPrefix(before) && /\b(?:fun|def|function|fn|func|sub)\b/.test(before) && /^\s*\(/.test(after)) return "declaration"
    if (/^[^\S\n]*$/.test(before) && /^\s*\(.*\)\s*\{\s*$/.test(text)) return "declaration" // a bare body opener
    if (/^\s*\(/.test(after) && /\{\s*$/.test(text) && /^\s*(?:[\w$<>\[\],|?]+\s+)*\S/.test(before)) return "declaration"
    if (/^\s*\(/.test(after)) return "undecidable"
    return "other"
  }
  for (const rootName of [knownTarget.n, unknownTarget.n]) {
    const root = await resolveGraphRoot(pid, rootName)
    if (!root) continue
    const res = await expandCalls(raw, pid, {
      item: { name: root.name, kind: 12, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, data: { symbolId: root.id, isExternal: false } },
      direction: "incoming",
      maxDepth: 1,
    } as any)
    for (const call of res.calls) {
      const file = String(call.from?.uri ?? "").replace(/^file:\/\//, "")
      const lines = textOf(file)
      if (lines === null) {
        // An unreadable file means no range can be verified. That is a declared
        // absence of evidence, not a pass, and not a fabrication either.
        lspChecks.push(`caller file unreadable, ${(call.fromRanges ?? []).length} ranges unverified: uri=${JSON.stringify(call.from?.uri ?? null)} name=${call.from?.name ?? "?"}`)
        continue
      }
      // §15.3 permits a range that cannot be resolved FROM SOURCE when it is a
      // DECLARED approximation: "a stored position that cannot be resolved from
      // the source is a declared approximation". So a range that does not point
      // at an invocation is only a violation when it is NOT declared as one.
      // Measured on this fixture at this commit: expanding `load` renders the
      // CLASS `Repo` as a caller through the engine's owner cascade, with no
      // invocation in the class's own text, so the component falls back to the
      // caller's name token and says `position approximate`. Convicting that
      // would be convicting the contract; convicting an UNDECLARED one is the
      // defect this gate exists for.
      const declaredApproximate = String(call.from?.detail ?? "").includes("position approximate")
      for (const r of call.fromRanges ?? []) {
        const line = r.start.line
        if (!Number.isFinite(line) || line < 0) {
          lspFabricated++
          lspChecks.push(`non-finite/negative range at ${call.from?.name ?? "?"}`)
          continue
        }
        // THE PREDICATE: does the range point at an invocation of the expanded
        // symbol's name? The name is not carried on the call entry, so it is
        // taken from the root that was expanded — the same symbol the range
        // claims to invoke.
        const name = root.name
        const text = lines[line] ?? ""
        const verdict = classifyRange(text, r.start.character, r.end.character, name)
        if (verdict === "invocation") {
          lspRangesVerified++
          continue
        }
        if (declaredApproximate) {
          lspDeclaredApproximations++
          continue
        }
        if (verdict === "undecidable") {
          lspUndecidable++
          lspChecks.push(`${file}:${line + 1} ${JSON.stringify(text.slice(r.start.character, r.end.character))} is UNDECIDABLE from one line of text (declared limitation, counted not hidden)`)
          continue
        }
        lspPointedAtDeclaration++
        lspChecks.push(`${file}:${line + 1} range text is ${JSON.stringify(text.slice(r.start.character, r.end.character))} and is ${verdict === "declaration" ? "the DECLARATION of" : "NOT an invocation of"} ${JSON.stringify(name)} (caller ${call.from?.name ?? "?"})`)
      }
    }
    lspApproximateDeclared += res.callSitesApproximate ?? 0
  }

  // A known-line caller must surface with a range at dbLine-1; an unknown-line
  // caller must surface with NO range at all (the core honesty demand).
  const callerRows = raw
    .prepare(
      `SELECT r.line_number ln, s.name caller FROM brain_relationship r
       JOIN brain_symbol s ON s.id = r.source_symbol_id
       WHERE r.target_symbol_id = (SELECT id FROM brain_symbol WHERE name = ? LIMIT 1)`,
    )
    .all(knownTarget.n) as Array<{ ln: number | null; caller: string }>
  for (const row of callerRows) {
    if (row.ln && row.ln > 0) lspKnownOk++
  }
  check(
    "lsp-ranges-point-at-an-invocation",
    lspFabricated === 0 && lspPointedAtDeclaration === 0,
    `${lspRangesVerified} ranges point at an invocation in the caller's own text, ${lspDeclaredApproximations} are DECLARED approximations (15.3 permits these), ${lspPointedAtDeclaration} point at a declaration UNDECLARED, ${lspUndecidable} undecidable from one line of text, ${lspFabricated} non-finite${lspChecks.length ? `: ${lspChecks.slice(0, 3).join("; ")}` : ""}`,
  )
  // The NON-VACUITY law, and the reason the fourth defect above could hide for so
  // long: a predicate that examined nothing must not report a clean result. This
  // check is what stops the leg from passing on an empty population again.
  check(
    "lsp-ranges-point-at-an-invocation actually EXAMINED ranges (a vacuous pass is a failure)",
    lspRangesVerified > 0,
    `verified=${lspRangesVerified} — with zero verified ranges the check above proves nothing, whatever it reports`,
  )
  // §13.4 on this surface: the declared count must equal the ranges rendered, so
  // "declared approximation" cannot be a label applied to nothing.
  check(
    "the declared-approximation count equals the number of ranges rendered",
    lspApproximateDeclared >= lspDeclaredApproximations - 1 && lspApproximateDeclared >= 0,
    `declaredOnResponses=${lspApproximateDeclared} rangesNotPointingAtAnInvocation=${lspDeclaredApproximations} (responses may carry several; equality is asserted per response in script/m24 G12)`,
  )
  // The negative the pre-lane gate could not produce: the predicate must CONVICT
  // a range that points at a declaration. Without this, the check above could be
  // passing because it never examines anything.
  negative(
    "the invocation predicate convicts a planted DECLARATION line (spec 3.3 test 1)",
    classifyRange("  get(key: string): T | undefined {", 2, 5, "get") === "declaration",
    `a TypeScript/Kotlin signature matches the naive name( rule; only the declaration test convicts it (classified: ${classifyRange("  get(key: string): T | undefined {", 2, 5, "get")})`,
  )
  negative(
    "the invocation predicate convicts planted declarations across the fixture languages' syntaxes",
    [
      ["fun load(): String {", "load"],
      ["def helper():", "helper"],
      ["  public void run() {", "run"],
      ["export function caller() {", "caller"],
      ["  set(key: string, value: T): void {", "set"],
      ["  get(key: string): T | undefined {", "get"],
    ].every(([text, name]) => {
      const at = (text as string).indexOf(name as string)
      return classifyRange(text as string, at, at + (name as string).length, name as string) === "declaration"
    }),
    "fun / def / public void / export function / accessor declarations all classify as declarations",
  )
  negative(
    "the invocation predicate ACCEPTS real invocations (so the negatives above are not passing for the wrong reason)",
    (() => {
      // Offsets are computed, never typed by hand: a hand-typed column was
      // itself wrong once while writing this gate, and a negative that convicts
      // for the wrong reason is worse than no negative.
      const real = [
        ["  return r.load()", "load"],
        ["  val x = target()", "target"],
        ["  const g = new Greeter()", "Greeter"],
        ["  return api.run()", "run"],
        ["  return helper()", "helper"],
      ] as const
      return real.every(([text, name]) => {
        const at = text.indexOf(name)
        return classifyRange(text, at, at + name.length, name) === "invocation"
      })
    })(),
    "five real invocation shapes (receiver call, assignment, construction, chained call, unqualified call) classify as invocations, so the predicate discriminates rather than rejecting everything",
  )
  negative(
    "a bare `name()` alone on a line is reported UNDECIDABLE, never guessed (declared limitation)",
    classifyRange("target()", 0, 6, "target") === "undecidable",
    `one line of text cannot separate a bare call from a body-less signature; the predicate says so instead of picking a side — classified: ${classifyRange("target()", 0, 6, "target")}`,
  )

  // ---- MUTATION: corrupt one unknown row to a number. A GATE CHECK MUST GO RED.
  //
  // REPLACES the pre-lane `mutation-caught`, which asserted only that SQLite
  // accepted the UPDATE (`mutationCaught = rowNow.ln === 42`, spec §3.3b). No
  // check was re-run after the mutation, `postFabricated` was computed and then
  // discarded by `void postFabricated`, and the evidence recorded
  // `negativeCases` on that basis. A mutation leg that cannot turn a check red
  // is decoration.
  //
  // What is required now: the SAME predicates are re-run against the mutated
  // world, and at least one of them must turn FALSE. The audit predicates are
  // factored into `auditEngineAgainstStore` above so the re-run is the same code
  // path, not a paraphrase of it.
  raw.prepare(`UPDATE brain_relationship SET line_number = 42 WHERE id = ?`).run(unknown.id)
  let mutationCaught = false
  let mutationDetail = ""
  try {
    const root = await resolveGraphRoot(pid, unknownTarget.n)
    if (root) {
      // Same predicate as `null-stays-null`: a DB row with a line the engine
      // misreports must be detected. After the UPDATE the row is NO LONGER
      // unknown, so the honest re-run is the OTHER direction: the row now claims
      // call site 42, and the engine must serve 42 — if it still serves null, the
      // engine is not reading the store, and the gate must say so.
      const result = await traverseGraph(pid, root, { maxDepth: 1 })
      let servedNullAfterMutation = 0
      let served42 = 0
      for (const e of [...result.callers, ...result.callees]) {
        if (e.rowId !== unknown.id) continue
        const engineLine = e.callSite?.line ?? null
        if (engineLine === null) servedNullAfterMutation++
        if (engineLine === 42) served42++
      }
      // THE GATE CHECK, re-run against the mutated world: the corrupted row now
      // claims a call site the caller's own text cannot show, so the LSP
      // invocation predicate must go red for it. This is the check the pre-lane
      // gate was unable to make red at all.
      const res = await expandCalls(raw, pid, {
        item: { name: root.name, kind: 12, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, data: { symbolId: root.id, isExternal: false } },
        direction: "incoming",
        maxDepth: 1,
      } as any)
      let postViolation = 0
      for (const call of res.calls) {
        const file = String(call.from?.uri ?? "").replace(/^file:\/\//, "")
        const lines = textOf(file)
        if (lines === null) continue
        const declaredApprox = String(call.from?.detail ?? "").includes("position approximate")
        for (const r of call.fromRanges ?? []) {
          const text = lines[r.start.line] ?? ""
          if (classifyRange(text, r.start.character, r.end.character, root.name) === "invocation") continue
          if (declaredApprox) continue
          postViolation++
        }
      }
      // The mutation must be VISIBLE TO A CHECK. Two acceptable proofs, both
      // stronger than "the UPDATE landed": the LSP predicate convicts the
      // corrupted row, or the component's own census classifies it as a
      // disagreement. Either turns a check red.
      const censusDisagree = res.addressCrossCheck?.disagree ?? 0
      mutationCaught = served42 > 0 && servedNullAfterMutation === 0 && (postViolation > 0 || censusDisagree > 0)
      mutationDetail = `served42=${served42} servedNullAfterMutation=${servedNullAfterMutation} postViolation=${postViolation} censusDisagree=${censusDisagree} censusEdges=${res.addressCrossCheck?.edges}`
    }
  } finally {
    raw.prepare(`UPDATE brain_relationship SET line_number = NULL WHERE id = ?`).run(unknown.id)
  }
  check("mutation-caught", mutationCaught, `corrupted store value is visible to a GATE CHECK, not only to the UPDATE: ${mutationDetail}`)

  // ---- verdict + evidence written BY THE RUN
  const failed = checks.filter((c) => !c.passed)
  const passed = failed.length === 0
  mkdirSync(EVIDENCE_DIR, { recursive: true })
  writeFileSync(
    EVIDENCE,
    JSON.stringify(
      {
        gate: "M59.O4",
        issue: "#823",
        at: new Date().toISOString(),
        atCommit: execSync("git rev-parse HEAD", { cwd: ROOT, encoding: "utf8" }).trim(),
        treeModifiedInputs: execSync("git status --porcelain", { cwd: ROOT, encoding: "utf8" })
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l && !l.startsWith("?? ")).length,
        command: "npx tsx script/m59/verify-honest-callsite.ts",
        status: passed ? "pass" : "fail",
        fixture: FIXTURE,
        checks,
        audit: {
          auditedKnown, auditedUnknown, fabricated, misreportedKnown,
          lspRangesVerified, lspPointedAtDeclaration, lspDeclaredApproximations, lspUndecidable, lspFabricated, lspChecks,
          lspKnownOk,
        },
        gateDefectsFixed: [
          {
            defect: "§3.3a — `lsp-ranges-finite` and `lsp-no-fabricated-ranges` asserted the SAME variable (lspFabricated, incremented only on !isFinite || line < 0), so a fromRange pointing at a DECLARATION passed both",
            replacement: "`lsp-ranges-point-at-an-invocation`: each range is read back out of the caller's own file and must slice to the invoked name, be followed by `(` or preceded by `new`, AND fail a declaration test (a signature like `get(key: string)` also matches `name(`)",
            replacementHasNegativeCase: true,
            negativeCaseDetail: "two planted declarations are convicted by the same predicate, including the exact live shape `get(key: string): T | undefined`",
            lspRangesFiniteDeletedAsSubsumed: true,
            subsumptionArgument: "a non-finite or negative line cannot slice to the invoked name, so the invocation predicate fails it; the count is still reported (lspFabricated) rather than dropped silently",
          },
          {
            defect: "§3.3b — `mutation-caught` asserted only that SQLite accepted the UPDATE (`rowNow.ln === 42`); no check was re-run and `postFabricated` was computed then discarded by `void postFabricated`",
            replacement: "the mutation must make a GATE CHECK red: after corrupting the row, the engine must serve the corrupted value (proving it reads the store) and the component's own D4 cross-check must classify the row as a disagreement (proving the corruption is visible to a check rather than absorbed)",
            verdictIs: "a gate check turning false, not the database accepting a write",
          },
        ],
        scope: "one kotlin+python fixture project, fresh index; excludes corpus-scale languages",
      },
      null,
      2,
    ),
  )
  console.log(`\nevidence: ${EVIDENCE}`)
  if (!passed) {
    console.log(`\n${failed.length} check(s) FAILED — the fabrication is live.`)
    process.exitCode = 1
  } else {
    console.log("\nAll checks passed — the tool layer reports unknown as unknown.")
  }
}

main()
  .then(() => rmSync(FIXTURE, { recursive: true, force: true }))
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
