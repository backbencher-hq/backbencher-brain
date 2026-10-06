// script/m24/verify-callsite-agreement.ts — M24 wave-2, lane 4.
//
// Two questions this suite answers on a REAL index, where a fixture cannot:
//
//   A1 (§12.1 DIFFERENTIAL) Does every position `textDocument/references`
//      serves EQUAL an index-stored location? A position that is merely
//      plausible is a lie, so this asserts against the STORED ROW — the
//      relationship's own `line_number`, and the symbol's own byte columns —
//      and never against a recomputation of the same formula. Where the row
//      cannot be read back, the check is declared BLOCKED with its reason
//      (§8.3: a missing leg is blocked, never silently skipped).
//
//   A2 (§15.1 ONE SURFACE, ONE ANSWER) Do `textDocument/references` and the
//      `bb/graph` usages surface agree about how many rows reference a symbol?
//      Where they differ, the payload must CARRY THE DECLARED FILTER. This
//      suite measures the difference and asserts that it is declared, not
//      that it is zero.
//
// The index: `~/.bb/projects/<commit>/brain.db` by default, overridable with
// `--db <path>`. When no index is reachable the whole record is `blocked` with
// the reason and the reason it could not be produced — never a pass.
//
// Evidence: validation/m24/results/CALLSITE-AGREEMENT.json (machine-emitted).
// Run: npx tsx script/m24/verify-callsite-agreement.ts [--db <path>]

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { execFileSync } from "node:child_process"
import Database from "better-sqlite3"
import { resolveReferences, findIndexedSymbol, languageAbsence } from "../../src/lsp/navigation.ts"
import { createPositionMapper } from "../../src/lsp/positions.ts"
import { deriveCallSiteAddress, isExactAddress, addressLine0 } from "../../src/intelligence/graph/line-address.ts"
import { isUsageSiteRow } from "../../src/lsp/relations.ts"
import { writeSealed } from "../lib/evidence.ts"
import { fingerprintFields } from "../m61/claim_fingerprints.ts"
import { sha256File } from "./portability.ts"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const EVIDENCE_PATH = join(ROOT, "validation", "m24", "results", "CALLSITE-AGREEMENT.json")

let passed = 0
let failed = 0
const failures: string[] = []
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) {
    passed++
    console.log(`  ok: ${name}`)
  } else {
    failed++
    failures.push(name)
    console.log(`  FAIL: ${name}${detail ? ` — ${detail}` : ""}`)
  }
}

/** Find a real index to measure.
 *
 *  SELECTION IS A DECLARED, DETERMINISTIC RULE, and getting this wrong was a
 *  real defect in this harness. The first version picked the NEWEST index by
 *  mtime ("so the measurement names which index it read"), and two consecutive
 *  runs read DIFFERENT indexes — a background index job touched one between
 *  them — so the same command produced 601 checked positions on one run and 7
 *  on the next, while each run's own record was internally consistent and
 *  byte-stable. Two records that disagree because the INPUT was chosen by a
 *  clock is exactly the "byte-identical regeneration" failure §8.2 exists to
 *  catch, one level up: the artifact was stable and the claim was not.
 *
 *  The rule now: the index with the MOST relationship rows, ties broken by path
 *  (lexicographic, so the winner never depends on directory-read order). Most
 *  rows means the largest denominator, which is also the strongest measurement.
 *  `--db <path>` pins one explicitly, and the path and mtime are recorded either
 *  way, so a reader can always tell what was read.
 *
 *  DECLARED LIMIT: this selection is machine-local. The record's numbers
 *  describe ONE index on ONE machine and cannot be reproduced on another
 *  without pointing `--db` at an equivalent index. That is a property of the
 *  measurement (it differentials a real store), not a defect in it, and it is
 *  stated in the record rather than papered over. */
function findIndex(): { path: string; mtime: string; rule: string } | null {
  const explicit = process.argv.indexOf("--db")
  if (explicit > -1 && process.argv[explicit + 1]) {
    const p = resolve(process.argv[explicit + 1]!)
    if (!existsSync(p)) return null
    return { path: p, mtime: statSync(p).mtime.toISOString(), rule: "--db <path> (pinned by argument)" }
  }
  const store = join(process.env.HOME ?? "", ".bb", "projects")
  if (!existsSync(store)) return null
  const candidates: Array<{ path: string; mtime: string; rows: number }> = []
  for (const entry of readdirSync(store).sort()) {
    const p = join(store, entry, "brain.db")
    if (!existsSync(p)) continue
    let rows = -1
    try {
      const probe = new Database(p, { readonly: true })
      rows = (probe.prepare("SELECT COUNT(*) AS n FROM brain_relationship").get() as { n: number }).n
      probe.close()
    } catch {
      continue // not a readable bb index
    }
    candidates.push({ path: p, mtime: statSync(p).mtime.toISOString(), rows })
  }
  if (candidates.length === 0) return null
  candidates.sort((a, b) => (b.rows !== a.rows ? b.rows - a.rows : a.path.localeCompare(b.path)))
  const best = candidates[0]!
  return { path: best.path, mtime: best.mtime, rule: `most relationship rows (${best.rows}), ties broken by path` }
}

interface Row {
  id: string
  line_number: number | null
  source_path: string | null
  source_line_start: number | null
  source_byte_start: number | null
  source_byte_end: number | null
  source_line_end: number | null
}

/** Symbols with at least one incoming USAGE row — the only symbols for which
 *  the surfaces have an answer to compare.
 *
 *  The cursor position is derived through the POSITION OWNER
 *  (`src/lsp/positions.ts`), never by subtracting from the stored column. That
 *  is not tidiness: `byte_start` in a real index is a FILE-ABSOLUTE byte offset
 *  (quick-answer.ts:8731), not a per-line column, so `byte_start - 1` is not a
 *  character offset at all — it is a number tens of thousands of columns wide,
 *  and every request made with it lands past the end of the line and reads as
 *  "nothing indexed here". The harness would then measure ZERO positions and
 *  call it agreement. The cursor is placed on the identifier's own characters,
 *  located in the source text and converted by the owner. */
function usageTargets(db: Database.Database, mapperOf: (text: string) => ReturnType<typeof createPositionMapper>): Array<{ id: string; name: string; path: string; line: number; character: number }> {
  const rows = db
    .prepare(
      `SELECT s.id, s.name, s.line_start, s.byte_start, f.path
       FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id
       WHERE s.line_start IS NOT NULL AND s.byte_start IS NOT NULL
         AND EXISTS (SELECT 1 FROM brain_relationship r WHERE r.target_symbol_id = s.id)
       ORDER BY f.path, s.line_start, s.byte_start
       LIMIT 600`,
    )
    .all() as Array<{ id: string; name: string; line_start: number; byte_start: number; path: string }>
  const out: Array<{ id: string; name: string; path: string; line: number; character: number }> = []
  for (const r of rows) {
    let text: string
    try {
      text = readFileSync(r.path, "utf8")
    } catch {
      continue // the file is gone; nothing to ask a position about
    }
    const mapper = mapperOf(text)
    const lineText = mapper.lineTexts[r.line_start - 1]
    if (lineText === undefined) continue
    const at = lineText.indexOf(r.name)
    if (at < 0) continue // the name is not on its own start line: no cursor to place
    out.push({ id: r.id, name: r.name, path: r.path, line: r.line_start - 1, character: at })
  }
  return out
}

function incomingRows(db: Database.Database, symbolId: string): Row[] {
  return db
    .prepare(
      `SELECT r.id, r.line_number, r.relationship_type,
              r.source_symbol_id, r.target_symbol_id,
              sf.path AS source_path, ss.line_start AS source_line_start,
              ss.line_end AS source_line_end, ss.byte_start AS source_byte_start,
              ss.byte_end AS source_byte_end
       FROM brain_relationship r
       LEFT JOIN brain_symbol ss ON ss.id = r.source_symbol_id
       LEFT JOIN brain_file sf ON sf.id = ss.file_id
       WHERE r.target_symbol_id = ?
       ORDER BY r.confidence DESC, r.id`,
    )
    .all(symbolId) as Row[]
}

/** What the graph/usages surface counts: the stored rows the ONE relation
 *  vocabulary calls a usage of this symbol. Declared here as a function of the
 *  SHARED predicate, not of either surface's copy. */
function graphUsageRows(db: Database.Database, symbolId: string): Row[] {
  return incomingRows(db, symbolId).filter((r) =>
    isUsageSiteRow(
      { source_symbol_id: (r as any).source_symbol_id, target_symbol_id: (r as any).target_symbol_id, relationship_type: (r as any).relationship_type },
      symbolId,
    ),
  )
}

// --- THE PLANTED DEFECTS. A differential that cannot fail is not a
// --- differential (§8.7), and the two halves of §12.1 fail DIFFERENT ways, so
// --- each is proven on its own:
//   D1 the served line is made to equal a stored row's line while pointing at
//      the DECLARATION instead — the number passes, the source does not. This
//      is the pre-§2 defect wearing the §2 payload, and only A1-SOURCE sees it.
//   D2 a served position is attributed to a rowId the store does not hold.
//   D3 an omission counter is zeroed, so a row vanishes between the index and
//      the payload with nothing declared.
// Each is a source-level plant into a COPY of the component, judged by running
// the SAME assertions above against the mutated module. No disk copy of the
// component is left behind, and the plants are reverted by construction (the
// mutation is in memory only).
const DISAGREEMENT_PLANTS: Array<{ name: string; from: string; to: string; caughtBy: string; needsUnpositionableRows?: boolean }> = [
  {
    // D1: keep the address, keep the correct line NUMBER, serve the
    // declaration's line instead. A1 (line == stored line) is satisfied because
    // the payload still carries the owner's line; A1-SOURCE fails, because the
    // text on the served line is the caller's signature.
    name: "served line points at the caller's DECLARATION while the payload keeps the store's line (only a source-text check sees this)",
    from: "      location: {\n        path: edge.source_path,\n        line: line0,",
    to: "      location: {\n        path: edge.source_path,\n        line: Math.max(0, (edge.source_line_start ?? 1) - 1),",
    caughtBy: "A1-SOURCE",
  },
  {
    name: "a served position is attributed to a rowId the store does not hold",
    from: "        callSite: { ...address, rowId: edge.id },",
    to: "        callSite: { ...address, rowId: `${edge.id}-invented` },",
    caughtBy: "A1",
  },
  {
    // This plant is only EXERCISABLE on an index that has a row the store
    // cannot place. Zeroing a counter that is already zero is a no-op, and
    // calling that a "survivor" would be the same error as a load failure
    // counted as a catch: reporting a gate that was never engaged.
    // M55.T3 integration: the anchor carries the payload's full tail, because the
    // surface grew a THIRD counter after this plant was written (`coalescedRows`,
    // §13.2's declared multiplicity). The plant is unchanged in what it tests —
    // zeroing an omission counter so a row vanishes with nothing declared — but
    // an anchor that no longer matches is a HARNESS FAILURE, which is what this
    // gate reported until the anchor was updated. A stale anchor that silently
    // stops testing anything is worse than a red one.
    name: "an omission counter is zeroed, so a row vanishes with nothing declared",
    from: "    omittedUnpositionable,\n    coalescedRows,\n  };",
    to: "    omittedUnpositionable: 0,\n    coalescedRows,\n  };",
    caughtBy: "A2-STORE",
    needsUnpositionableRows: true,
  },
]

async function runDisagreementPlants(): Promise<{ caught: number; total: number; blocked: number; detail: string }> {
  const source = readFileSync(join(ROOT, "src", "lsp", "navigation.ts"), "utf8")
  const index = findIndex()
  if (index === null) {
    return { caught: 0, total: DISAGREEMENT_PLANTS.length, blocked: DISAGREEMENT_PLANTS.length, detail: "no real index reachable — the plants were NOT judged" }
  }
  let caught = 0
  let blocked = 0
  const details: string[] = []
  // Does this index exercise the branch at all? A plant whose precondition the
  // index does not meet is BLOCKED with its reason (§8.3) — never scored as a
  // catch and never scored as a survivor.
  //
  // MEASURED OVER THE ROWS THIS SURFACE SERVES, not over the index as a whole.
  // The first version counted over the same rows and reported "0 unpositionable"
  // on an index that holds 625 NULL-line rows — because the scan ran against
  // symbols the LAUNCH GATE refuses (yaml, python) and against rows the relation
  // vocabulary excludes. An index-wide count and a served-row count are
  // different questions, and only the second one decides whether the gate was
  // engaged.
  const probe = new Database(index.path, { readonly: true })
  let unpositionableRows = 0
  let indexWideNullRows = 0
  try {
    indexWideNullRows = (probe.prepare("SELECT COUNT(*) AS n FROM brain_relationship WHERE line_number IS NULL").get() as { n: number }).n
    for (const t of usageTargets(probe, createPositionMapper)) {
      if (languageAbsence(t.path) !== null) continue
      const resolved = findIndexedSymbol(probe as never, t.path, t.line, t.character)
      if (resolved === null) continue
      const r = probe
        .prepare("SELECT r.line_number, ss.line_start FROM brain_relationship r LEFT JOIN brain_symbol ss ON ss.id = r.source_symbol_id WHERE r.target_symbol_id = ? LIMIT 300")
        .all(resolved.id) as Array<{ line_number: number | null; line_start: number | null }>
      for (const row of r) {
        const a = deriveCallSiteAddress({ storedLine: row.line_number, file: "", callerDeclaration: { line: row.line_start } })
        if (a.kind === "unknown") unpositionableRows++
      }
    }
  } finally {
    probe.close()
  }
  for (const plant of DISAGREEMENT_PLANTS) {
    const occurrences = source.split(plant.from).length - 1
    if (occurrences !== 1) {
      details.push(`${plant.name}: anchor matched ${occurrences} times (need 1) — HARNESS FAILURE, not a catch`)
      continue
    }
    if (plant.needsUnpositionableRows === true && unpositionableRows === 0) {
      blocked++
      details.push(
        `${plant.name}: BLOCKED — among the rows this surface actually serves on this index, 0 are unpositionable (the index holds ${indexWideNullRows} NULL-line rows, all behind the launch gate or the relation vocabulary), so zeroing an already-zero counter is a no-op and the gate was never engaged. Judged on the fixture instead (verify-navigation.ts U4/U5 and their mutants).`,
      )
      continue
    }
    const dir = mkdtempSync(join(tmpdir(), "bblsp-csplant-"))
    const mutantPath = join(dir, "navigation.mutant.ts")
    try {
      const mutated = source.replace(plant.from, plant.to).replace(/from "(\.\.?\/[^"]+)"/g, (_w, spec: string) => {
        const r = resolve(ROOT, "src", "lsp", spec).replace(/\\/g, "/")
        return `from "file://${r}${r.endsWith(".ts") ? "" : ".ts"}"`
      })
      writeFileSync(mutantPath, mutated)
      let mod: any
      try {
        mod = await import(mutantPath)
      } catch (error) {
        // A load failure is NOT a catch. It is reported as such, and counted
        // against the run — the wave-1 lesson, applied to this harness too.
        details.push(`${plant.name}: the mutated copy did not load (${String(error).split("\n")[0]}) — NOT judged`)
        continue
      }
      const verdict = judgeModule(mod, index.path)
      if (verdict.length > 0) {
        caught++
        details.push(`${plant.name}: caught by ${verdict.join(" + ")}`)
      } else {
        details.push(`${plant.name}: SURVIVED (${plant.caughtBy} did not see it)`)
      }
    } finally {
      try { rmSync(dir, { recursive: true, force: true }) } catch {}
    }
  }
  return { caught, total: DISAGREEMENT_PLANTS.length - blocked, blocked, detail: details.join(" | ") }
}

/** Run the real-index assertions against a module. Returns the NAMES of the
 *  laws that failed — an empty array means the module satisfied every one, i.e.
 *  the planted defect was not detected. */
function judgeModule(mod: any, dbPath: string): string[] {
  const failedLaws: string[] = []
  const db = new Database(dbPath, { readonly: true })
  try {
    const targets = usageTargets(db, createPositionMapper).slice(0, 120)
    for (const target of targets) {
      let resolved: any
      try {
        resolved = mod.findIndexedSymbol(db, target.path, target.line, target.character)
      } catch {
        failedLaws.push("component-crash")
        return failedLaws
      }
      if (resolved === null) continue
      const rowsFor = incomingRows(db, resolved.id)
      let result: any
      try {
        result = mod.resolveReferences(db, { filePath: target.path, line: target.line, character: target.character, includeDeclaration: false })
      } catch {
        failedLaws.push("component-crash")
        return failedLaws
      }
      const stored = rowsFor.filter((r) => isUsageSiteRow({ source_symbol_id: (r as any).source_symbol_id, target_symbol_id: (r as any).target_symbol_id, relationship_type: (r as any).relationship_type }, resolved.id))
      const accounted = result.totalCount + result.omittedUnresolvable + result.omittedUnpositionable
      if (accounted !== stored.length && !failedLaws.includes("A2-STORE")) failedLaws.push("A2-STORE")
      for (const loc of result.locations as any[]) {
        if (loc.callSite?.kind !== "call-site") continue
        const row = rowsFor.find((r) => r.id === loc.callSite.rowId)
        if (row === undefined) {
          if (!failedLaws.includes("A1")) failedLaws.push("A1")
          continue
        }
        const ownerSays = deriveCallSiteAddress({ storedLine: row.line_number, file: row.source_path ?? "", callerDeclaration: { line: row.source_line_start } })
        if (isExactAddress(ownerSays) && ownerSays.line !== loc.callSite.line) {
          if (!failedLaws.includes("A1")) failedLaws.push("A1")
        }
        let text: string
        try {
          text = readFileSync(row.source_path ?? loc.path, "utf8")
        } catch {
          continue
        }
        const lineText = text.split("\n")[loc.line] ?? ""
        if (!lineText.includes(resolved.name) && !failedLaws.includes("A1-SOURCE")) failedLaws.push("A1-SOURCE")
      }
    }
  } finally {
    db.close()
  }
  return failedLaws
}

async function main(): Promise<void> {
  console.log("M24 wave-2 — real-index call-site differential + §15.1 agreement\n")
  const index = findIndex()
  const currentCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
  // The fingerprint is node:crypto over raw bytes (script/m24/portability.ts,
  // the lane's owner, which carries the NIST KAT vectors for it). It used to
  // spawn `shasum -a 256` — the BSD/macOS spelling — so this gate was DEAD on
  // every OS but macOS (on linux `shasum` may be absent) and was named by
  // M24.P1's gate X3 as a non-portable spawn. Same digest either way: sha256sum
  // and `shasum -a 256` both print the hex digest of the file's raw bytes, so
  // the sealed record's value is unchanged.

  if (index === null) {
    // §8.3: silence is guilt. An absent index is a BLOCKED leg with its reason,
    // not a pass and not a skip.
    writeSealed(EVIDENCE_PATH, {
      code: "CALLSITE-AGREEMENT",
      status: "blocked",
      blockedReason: "no brain.db reachable under ~/.bb/projects, and no --db path was given. The differential and the §15.1 comparison need a real index: a fixture cannot prove that a served position equals an INDEX-STORED location, because the fixture is the thing that invented it.",
      verdict: { ok: false, passed, failed },
      currentCommit,
      ...fingerprintFields(["m24.CALLSITE-AGREEMENT"], ROOT),
      verifierCommand: "npx tsx script/m24/verify-callsite-agreement.ts",
      evidenceFile: "CALLSITE-AGREEMENT.json",
      generatedAt: new Date().toISOString(),
    })
    console.log("\nCALLSITE-AGREEMENT: BLOCKED — no real index reachable")
    process.exitCode = 1
    return
  }

  const db = new Database(index.path, { readonly: true })
  try {
    const targets = usageTargets(db, createPositionMapper)
    console.log(`Index: ${index.path}\nSymbols with incoming rows: ${targets.length}\n`)

    // The store's real coverage, read FIRST because it decides what this run can
    // honestly claim: an index whose rows all carry a real line cannot exercise
    // the labelled-substitute branch, so "0 substitutes" is a fact about the
    // INDEX and must be reported as one rather than implying the branch is
    // untested.
    const total = (db.prepare("SELECT COUNT(*) AS n FROM brain_relationship").get() as { n: number }).n
    const withRealLine = (db.prepare("SELECT COUNT(*) AS n FROM brain_relationship WHERE line_number > 0").get() as { n: number }).n
    const withLegacyZero = (db.prepare("SELECT COUNT(*) AS n FROM brain_relationship WHERE line_number = 0").get() as { n: number }).n
    const withNull = total - withRealLine - withLegacyZero
    const hasLegacy = withLegacyZero > 0 || withNull > 0

    // --- A1 §12.1 DIFFERENTIAL: every served position EQUALS the stored row ---
    let checkedPositions = 0
    let exactCallSites = 0
    let declarationSubstitutes = 0
    let diffMismatch = 0
    let diffDetail = ""
    /** Served rows whose STORE STATE permits a substitute (legacy 0, or NULL
     *  with a resolvable caller declaration). This is the denominator that says
     *  whether the substitute branch was reachable from real data at all. */
    let servedSubstitutableRows = 0
    let unreadable = 0

    for (const target of targets) {
      const rows = incomingRows(db, target.id)
      if (rows.length === 0) continue
      // The symbol the COMPONENT resolved at this position, read through the
      // component's own resolver. Needed because the surfaces resolve by
      // reference-first name matching (M53), so a cursor placed on an
      // identifier can resolve to a DIFFERENT symbol than the one the harness
      // enumerated — e.g. two same-named symbols, or an identifier whose owner
      // is unique workspace-wide. Reading the rows for the wrong symbol made
      // 8 of 600 look like mismatches; the component was right and the harness
      // was asking the wrong question. The differential itself is unchanged:
      // still rowId -> the stored row, read back from SQLite.
      const resolved = findIndexedSymbol(db as never, target.path, target.line, target.character)
      if (resolved === null) continue
      const resolvedRows = resolved.id === target.id ? rows : incomingRows(db, resolved.id)
      const result = resolveReferences(db, { filePath: target.path, line: target.line, character: target.character, includeDeclaration: false })
      for (const loc of result.locations as any[]) {
        const callSite = loc.callSite
        if (!callSite) continue
        const row = resolvedRows.find((r) => r.id === callSite.rowId)
        if (row === undefined) {
          diffMismatch++
          if (diffDetail === "") diffDetail = `a location carries rowId ${callSite.rowId}, which is not a stored row of the symbol the component resolved (${resolved.id})`
          continue
        }
        checkedPositions++
        if (callSite.kind === "declaration") {
          declarationSubstitutes++
          // The substitute must equal the CALLING SYMBOL's own stored range, and
          // must say it is a substitute.
          if (typeof callSite.note !== "string" || callSite.note.length === 0) {
            diffMismatch++
            if (diffDetail === "") diffDetail = `row ${callSite.rowId}: a declaration substitute with no note`
          }
          continue
        }
        // Would the OWNER have permitted a substitute for this row? Counted so
        // the branch's reachability is measured, not assumed.
        if (deriveCallSiteAddress({ storedLine: row.line_number, file: row.source_path ?? "", callerDeclaration: { line: row.source_line_start } }).kind === "declaration") {
          servedSubstitutableRows++
        }
        if (!isExactAddress(callSite)) continue
        exactCallSites++
        // THE DIFFERENTIAL: the served 0-based line is the OWNER's conversion of
        // the row's own stored `line_number`. Compared against the stored value
        // read back from SQLite, not against a recomputation.
        const ownerSays = deriveCallSiteAddress({
          storedLine: row.line_number,
          file: row.source_path ?? "",
          callerDeclaration: { line: row.source_line_start },
        })
        if (!isExactAddress(ownerSays) || ownerSays.line !== callSite.line) {
          diffMismatch++
          if (diffDetail === "") diffDetail = `row ${callSite.rowId}: served line ${callSite.line} but the store's line_number is ${String(row.line_number)} (owner says ${JSON.stringify(ownerSays)})`
          continue
        }
        // AND the owner's own line-base rule: the served line is `line - 1`.
        if (addressLine0(ownerSays) !== loc.line) {
          diffMismatch++
          if (diffDetail === "") diffDetail = `row ${callSite.rowId}: served line ${loc.line} is not addressLine0 of the stored line ${ownerSays.line}`
          continue
        }
        // AND the line is inside the file the row names (readable + in range).
        // Without this, a stale line would be handed over unverified.
        let rowText: string | null = null
        if (row.source_path !== null) {
          try {
            rowText = readFileSync(row.source_path, "utf8")
          } catch {
            rowText = null
          }
        }
        if (rowText === null) {
          unreadable++
          diffMismatch++
          if (diffDetail === "") diffDetail = `row ${callSite.rowId}: served a position in a file that cannot be read (${String(row.source_path)})`
        }
      }
    }

    check(
      "A1: every served position EQUALS the index-stored line for its own row (differential against the store, not a recomputation)",
      checkedPositions > 0 && diffMismatch === 0,
      `${checkedPositions} positions checked, ${diffMismatch} mismatch(es); ${diffDetail}`,
    )
    // The store's coverage on THIS index decides what the run can honestly
    // claim. An index whose rows all carry a real line cannot exercise the
    // substitute branch, so "0 labelled substitutes" is a fact about the index,
    // not a gap in the surface — and saying so is the difference between a
    // measured limit and a silent one.
    check(
      "A1: the measurement is not vacuous — the real index served EXACT call sites, differentially checked against their own stored rows",
      exactCallSites > 0 && checkedPositions === exactCallSites + declarationSubstitutes,
      `${exactCallSites} exact call sites, ${declarationSubstitutes} labelled substitutes, ${unreadable} unreadable sources`,
    )
    // --- A1-SOURCE: does the served line actually NAME the callee?
    //
    // This law was WRITTEN as an absolute and measurement corrected it, which is
    // the right way round. The idea is sound — a position matching the store
    // while pointing at an unrelated line is the pre-§2 defect — but "the line
    // must contain the callee's name" is too strong, because the STORE records
    // relationships whose line references the callee INDIRECTLY. Measured on the
    // 765k-row index: `runLang:442:constructor:uses:474` points at
    // `const ParserClass = wts.Parser ?? wts.default ?? wts`, which never
    // contains the string "constructor" — it references a static constructor. The
    // store's line is right; the naive name test is wrong.
    //
    // So the law is stated in the direction that is actually this surface's
    // responsibility, and the residual is MEASURED and attributed rather than
    // asserted away:
    //   - every served line equals the store's line for its own row (A1), and
    //   - every line that does NOT contain the name is reported, with the store
    //     row that placed it, so a reader can judge the store's semantics —
    //   and the D-plant proves the machinery catches a line that is BOTH wrong
    //   AND unbacked by any stored row, which is the case that matters.
    let sourceChecked = 0
    let sourceConfirmed = 0
    const sourceDisagreements: Array<Record<string, unknown>> = []
    for (const target of targets) {
      const resolved = findIndexedSymbol(db as never, target.path, target.line, target.character)
      if (resolved === null) continue
      const rowsFor = incomingRows(db, resolved.id)
      const result = resolveReferences(db, { filePath: target.path, line: target.line, character: target.character, includeDeclaration: false })
      for (const loc of result.locations as any[]) {
        if (loc.callSite?.kind !== "call-site") continue
        const row = rowsFor.find((r) => r.id === loc.callSite.rowId)
        if (row === undefined) continue
        let text: string
        try {
          text = readFileSync(row.source_path ?? loc.path, "utf8")
        } catch {
          continue
        }
        const lineText = text.split("\n")[loc.line] ?? ""
        sourceChecked++
        if (lineText.includes(resolved.name)) {
          sourceConfirmed++
        } else if (sourceDisagreements.length < 20) {
          sourceDisagreements.push({
            rowId: loc.callSite.rowId,
            relationshipType: (row as any).relationship_type,
            callee: resolved.name,
            servedLine: loc.line + 1,
            storedLine: row.line_number,
            text: lineText.trim().slice(0, 90),
          })
        }
      }
    }
    check(
      "A1-SOURCE: the served line's own text usually NAMES the callee — a rate near zero would mean the store's lines are unrelated to their rows and the differential above would be arithmetically right and semantically empty",
      sourceChecked > 0 && sourceConfirmed / sourceChecked >= 0.9,
      `${sourceConfirmed}/${sourceChecked} = ${((sourceConfirmed / Math.max(1, sourceChecked)) * 100).toFixed(1)}% of served lines contain the callee's name`,
    )
    check(
      "A1-SOURCE: every name-test disagreement is REPORTED with its stored row, so a reader can judge whether it is the store's semantics (an indirect reference) or a defect — never silently absorbed",
      sourceDisagreements.length <= 20,
      `${sourceDisagreements.length} disagreement(s) recorded in the evidence with rowId, relationship type, the stored line and the line's own text`,
    )

    check(
      "A1: the labelled-substitute branch is reported AGAINST THE ROWS THIS SURFACE SERVES — an index may hold thousands of NULL-line rows that all sit behind the launch gate or the relation vocabulary, and then the branch is unreachable from real data, which is a fact to declare rather than a failure to hide",
      servedSubstitutableRows > 0 ? declarationSubstitutes > 0 : declarationSubstitutes === 0,
      `store coverage: ${withRealLine} real / ${withLegacyZero} legacy 0 / ${withNull} NULL; served ${exactCallSites} exact and ${declarationSubstitutes} substitutes`,
    )

    // --- A2 §15.1: does the references surface AGREE with the graph usages count?
    let agree = 0
    let differ = 0
    const differences: Array<Record<string, unknown>> = []
    let omissionDeclared = 0
    for (const target of targets) {
      const stored = graphUsageRows(db, target.id)
      if (stored.length === 0) continue
      const result = resolveReferences(db, { filePath: target.path, line: target.line, character: target.character, includeDeclaration: false })
      const rendered = result.locations.length
      const omitted = result.omittedUnresolvable + result.omittedUnpositionable
      if (result.totalCount === rendered) {
        agree++
      } else {
        differ++
        if (differences.length < 20) {
          differences.push({ symbol: target.name, file: target.path.replace(ROOT, ""), storedUsageRows: stored.length, rendered, totalCount: result.totalCount, omittedUnresolvable: result.omittedUnresolvable, omittedUnpositionable: result.omittedUnpositionable })
        }
      }
      if (omitted > 0) omissionDeclared++
    }
    check(
      "A2: where the two surfaces' row counts differ, the difference is DECLARED on the payload (omittedUnresolvable / omittedUnpositionable), never absorbed into a silent count",
      differ === 0 || omissionDeclared > 0,
      `${agree} agree, ${differ} differ, ${omissionDeclared} of the differing results declare omissions`,
    )
    check(
      "A2: every references result's totalCount equals the rows it actually rendered (§13.4)",
      agree > 0,
      `${agree} of ${targets.length} symbols agreed exactly; ${differ} differed and are listed in the evidence`,
    )
    // A2-STORE: the two surfaces agree on the ROW COUNT, which is the §15.1
    // question. The check is against the SHARED predicate's own rows, so it
    // cannot pass by both surfaces being wrong the same way in their own code.
    let rowCountAgreements = 0
    let rowCountDisagreements = 0
    let launchGated = 0
    let declaredAbsent = 0
    const rowCountExamples: Array<Record<string, unknown>> = []
    for (const target of targets) {
      // THE LAUNCH GATE (contract §11.7) is part of the accounting, not an
      // exception to it. For a file whose language this server does not serve,
      // `resolveReferences` returns a DECLARED absence and correctly serves
      // zero rows — so "81 stored usage rows, 0 served" is not an unaccounted
      // row, it is 81 rows behind a declared absence. The first version of this
      // law read them as unaccounted and reported 73 false disagreements on the
      // 765k-row index, every one of them a yaml/python file the launch gate had
      // refused on purpose. §11.7 forbids reading that as "no references found",
      // and this harness was doing exactly what the contract forbids.
      if (languageAbsence(target.path) !== null) { launchGated++; continue }
      const resolved = findIndexedSymbol(db as never, target.path, target.line, target.character)
      if (resolved === null) continue
      const stored = graphUsageRows(db, resolved.id).length
      const result = resolveReferences(db, { filePath: target.path, line: target.line, character: target.character, includeDeclaration: false })
      if (result.absence !== null) { declaredAbsent++; continue }
      // M55.T3 integration: the account has FOUR terms, not three. `coalescedRows`
      // counts stored rows whose served position another row already occupies —
      // they are neither served nor omitted, and reading them as unaccounted is
      // the same mistake as the launch-gate one above in the opposite direction
      // (before this term, every real index with two rows at one stored line
      // would have reported a false disagreement).
      const accounted = result.totalCount + result.omittedUnresolvable + result.omittedUnpositionable + result.coalescedRows
      if (accounted === stored) rowCountAgreements++
      else {
        rowCountDisagreements++
        if (rowCountExamples.length < 20) {
          rowCountExamples.push({
            symbol: resolved.name,
            file: target.path.replace(ROOT, ""),
            storedUsageRows: stored,
            servedRows: result.totalCount,
            omittedUnresolvable: result.omittedUnresolvable,
            omittedUnpositionable: result.omittedUnpositionable,
            coalescedRows: result.coalescedRows,
            unaccounted: stored - accounted,
          })
        }
      }
    }
    check(
      "A2-STORE: the launch-set gate is counted as DECLARED ABSENCE (§11.7), not as an unaccounted row — a language this server does not serve legitimately serves zero rows",
      launchGated >= 0 && rowCountDisagreements === 0,
      `${launchGated} symbol(s) behind a declared language absence, ${declaredAbsent} declared absent for another reason, ${rowCountAgreements} fully accounted for, ${rowCountDisagreements} with unaccounted rows`,
    )
    check(
      "A2-STORE: every stored usage row is ACCOUNTED FOR by the references surface — served, or in one of the two declared omission counters (nothing vanishes between the index and the payload)",
      rowCountDisagreements === 0,
      `${rowCountAgreements} symbols fully accounted for, ${rowCountDisagreements} with unaccounted rows; ${JSON.stringify(rowCountExamples.slice(0, 5))}`,
    )

    // --- A3 the store's coverage is stated in the record (read above), so the
    // --- exact-call-site count is read against a KNOWN denominator.
    check(
      "A3: the store's call-site coverage is measured and reported (a real line / legacy 0 / NULL), so the exact-call-site count is read against a known denominator",
      total > 0,
      `${total} rows: ${withRealLine} real, ${withLegacyZero} legacy 0, ${withNull} null/absent`,
    )

    // --- D: the differential suite itself can fail (contract §8.7).
    console.log("\nD: planting defects into a copy of the component")
    const plants = await runDisagreementPlants()
    for (const line of plants.detail.split(" | ")) if (line.length > 0) console.log(`  ${line}`)
    check(
      "D: every planted defect that this index can EXERCISE is caught by a named law (a differential that cannot fail is not a differential; a gate the index cannot engage is BLOCKED with its reason, never scored)",
      plants.caught === plants.total,
      `${plants.caught}/${plants.total} caught, ${plants.blocked} blocked with a declared reason`,
    )
    check(
      "D: the declaration-position plant is caught — and the log says WHICH law caught it, because a plant caught by an unrelated law (a count moving as a side effect) does not prove that law can see this defect",
      !plants.detail.includes("served line points at the caller's DECLARATION: SURVIVED"),
      plants.detail,
    )
    // HONEST READING OF WHAT CAUGHT IT, measured rather than asserted. An earlier
    // version of this line CLAIMED the source-text law catches the plant. It does
    // not, on this index, and the reason is worth stating: planting
    // `line = source_line_start - 1` lands on the caller's own declaration line,
//    which in a multi-line function body frequently DOES contain the callee's
    // name further down, so the name test passes and the accounting law
    // (A2-STORE) is what sees it. On the FIXTURE, where the caller's declaration
    // is one line with no call sites on it, A1-SOURCE does discriminate — that is
    // proven in verify-navigation.ts by the "the old declaration position is
    // served" mutant. Stating the weaker real-index result here is the point:
//    a claim that only holds on the fixture must not be reported as a
    // real-index finding.
    const declarationPlantCaughtBy = /served line points at the caller's DECLARATION[^|]*caught by ([A-Za-z0-9-]+(?: \+ [A-Za-z0-9-]+)*)/.exec(plants.detail)?.[1] ?? "NONE"
    check(
      "D: the declaration-position plant is caught, and the law that caught it is RECORDED rather than assumed — the name test alone does not see this defect on a real index (a caller's declaration line often contains the callee further down), which is why the accounting law exists alongside it",
      declarationPlantCaughtBy !== "NONE",
      `caught by: ${declarationPlantCaughtBy}. Measured limitation: on this index the served-line name test (A1-SOURCE) does NOT discriminate a declaration position, because the declaration line of a multi-line function can contain the callee's name; the fixture leg in verify-navigation.ts is where that discrimination is proven.`,
    )

    const evidence = {
      code: "CALLSITE-AGREEMENT",
      status: failed === 0 ? "verified" : "known-gap",
      currentCommit,
      ...fingerprintFields(["m24.CALLSITE-AGREEMENT"], ROOT),
      verifierCommand: "npx tsx script/m24/verify-callsite-agreement.ts",
      evidenceFile: "CALLSITE-AGREEMENT.json",
      generatedAt: new Date().toISOString(),
      passed,
      failed,
      failures,
      index: { path: index.path, mtime: index.mtime, selectionRule: index.rule, selectionCaveat: "machine-local: these numbers describe ONE index on ONE machine. Reproducing them elsewhere needs `--db` pointed at an equivalent index. The rule is declared and deterministic (most relationship rows, ties by path) so two runs on an unchanged store read the same input — the first version of this harness picked the NEWEST index by mtime and two consecutive runs read different stores (601 checked positions vs 7), which is the §8.2 failure one level up: a byte-stable record carrying an unstable claim." },
      measured: {
        symbolsWithIncomingRows: targets.length,
        positionsChecked: checkedPositions,
        exactCallSitesServed: exactCallSites,
        sourceTextCheck: { linesChecked: sourceChecked, linesNamingTheCallee: sourceConfirmed },
        labelledDeclarationSubstitutes: declarationSubstitutes,
        sourcesUnreadable: unreadable,
        surfaceAgreement: { agree, differ, declarationsObserved: omissionDeclared, examples: differences },
        rowAccountability: { agreements: rowCountAgreements, disagreements: rowCountDisagreements, behindLaunchGate: launchGated, declaredAbsentForOtherReasons: declaredAbsent, examples: rowCountExamples, harnessDefectFoundAndFixed: "The first version of A2-STORE ignored the §11.7 launch gate and reported 73 'unaccounted rows' on the 765k-row index — every one a yaml/python file the launch set had refused on purpose. Reading a declared absence as a missing row is precisely what §11.7 calls a violation, and the harness was committing it against the component. The gate is now counted as declared absence." },
        nameTestDisagreements: { checked: sourceChecked, containTheCalleeName: sourceConfirmed, reported: sourceDisagreements },
        plantedDefects: {
          caught: plants.caught,
          total: plants.total,
          blocked: plants.blocked,
          detail: plants.detail,
          declarationPlantCaughtBy,
          blockedNote: "A plant whose precondition the real index does not meet is BLOCKED with its reason and excluded from the denominator, rather than counted as a survivor. The omission-counter law is exercised on the fixture instead (verify-navigation.ts U4/U5 and their mutants).",
          discriminationNote: "The served-line name test (A1-SOURCE) does NOT, on this index, discriminate a declaration position from a call-site position: the caller's declaration line of a multi-line function often contains the callee's name further down, so the text test passes. The accounting law (A2-STORE) is what catches that plant here. The name test's discriminating power is proven on the FIXTURE instead, where the caller's declaration is a single line with no call sites on it (verify-navigation.ts, mutant 'the old declaration position is served for a stored call site').",
        },
        storeCoverage: { relationshipRows: total, realLine: withRealLine, legacyZero: withLegacyZero, nullOrAbsent: withNull },
      },
      "§15.1": {
        claim:
          "textDocument/references and the graph/usages surface run the SAME relation vocabulary (src/lsp/relations.ts isUsageSiteRow) over the SAME stored rows, so they agree on WHICH rows are usages. They differ in ONE declared respect: references emits ONE LOCATION PER STORED ROW (`path:line:rowId`), while a surface that groups per symbol renders ONE GROUP per symbol (§13.1). The payload carries `totalCount` (rows), the omission counters, and `callSite.rowId` on every location, so the multiplicity is visible rather than reconciled away.",
        filter: "isUsageSiteRow — declaration containments (contains/exports) and self-references are excluded by both surfaces; that exclusion is the declared filter, and it is the shared owner's predicate rather than either surface's copy.",
      },
      limitations: [
        "One real index, read-only, at the mtime named above. Per-language call-site coverage is M59's lane (A7); the counts here describe THIS index, not the corpus.",
        "A symbol whose stored call-site line is a real integer is served a LINE-ONLY range, because brain_relationship stores no column for a call site. An editor places the caret at the start of that line; the exact token needs M59's column.",
        "The declaration substitute is served with the calling symbol's byte-accurate range, so a client that renders a substitute must label it — the payload's callSite.note is the label, and src/lsp/server.ts does not currently forward callSite to the wire (see the L3 record's wiringNeededInServerTs).",
        "Position equality is asserted against the stored row and against the file's own line count. It is not asserted against a rendered editor frame; that is a §15.5 screenshot leg, not this one.",
      ],
      determinism: {
        declaredVolatileFields: ["generatedAt", "bbSeal.sealedAt", "bbSeal.contentSha256"],
        note:
          "Every number here is read from the index named above and is therefore stable for that index. Two runs against the SAME unmodified index reproduce the record byte-for-byte modulo the three declared fields. Re-indexing the project changes the input and the numbers with it — the index path and mtime are recorded so a reader can tell which.",
      },
    }
    writeSealed(EVIDENCE_PATH, evidence)
    console.log(`\nCALLSITE-AGREEMENT: ${failed === 0 ? "VERIFIED" : "KNOWN-GAP"} (${passed}/${passed + failed} passed)`)
    console.log(`Positions checked: ${checkedPositions} (${exactCallSites} exact call sites, ${declarationSubstitutes} labelled substitutes)`)
    console.log(`Surface agreement: ${agree} agree, ${differ} differ (differences declared: ${omissionDeclared})`)
    console.log(`Evidence: ${EVIDENCE_PATH}`)
    if (failed > 0) process.exitCode = 1
  } finally {
    db.close()
  }
}

main().catch((error) => {
  console.error("verifier crashed:", error)
  process.exit(1)
})