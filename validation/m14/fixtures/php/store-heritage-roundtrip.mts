/**
 * PHP STORE ROUND-TRIP — the heritage payload, measured on the STORE.
 *
 * ## Why this file exists, and why the fixture next door is not enough
 *
 * `heritage-published.expectation.json` asserts `metadata.superTypes` on the ANALYZER's output.
 * That is the right place to pin the analyzer's rule, and it cannot see the boundary this file was
 * written for: the payload has to cross a seam that reads a DIFFERENT key from a DIFFERENT object
 * (`src/ast/parallel-indexer.ts:3590`, `symbol.metadata.superTypes` -> `brain_symbol.super_types`),
 * and that seam was, for php, the whole defect. php published heritage as EDGES only, so the column
 * was NULL on every php row, so `retargetCrossFileOverrides` — which opens
 * `if (supertypes.size === 0) return out` — returned before its first query. An analyzer-side
 * fixture cannot tell "the payload is published" from "the payload is stored", and the failure mode
 * this gate is built for is exactly the second one.
 *
 * ## What is asserted (the CLAIM)
 *
 *   1. THE PRECONDITION. Some php symbol stores a non-NULL `super_types`. That is the store-side
 *      form of the retarget pass's own early-return test, so a green row here is the pass being
 *      reachable for php at all.
 *   2. THE VALUES, on the shapes the fixture pins — base+interfaces, interfaces-only, an
 *      interface's `extends` parents, an enum's `implements` list, and the PHPD10 same-leaf cases
 *      in BOTH directions: a QUALIFIED same-leaf base keeps its qualification into the column, and
 *      a base that resolves to the class's own name stores NOTHING.
 *   3. THE MIRROR, generically rather than by name list: for every stored symbol carrying
 *      `super_types`, that set EQUALS the targets of that declaration's stored `extends` +
 *      `implements` rows. The analyzer derives the payload from the same decision that emits the
 *      edges, so the two must agree; if they ever disagree, a consumer holding the column walks a
 *      hierarchy the graph does not have.
 *   4. THE CROSS-FILE CASE, which is the whole point of a project-wide column: a subclass whose base
 *      is declared in ANOTHER file stores that base's name. The analyzer cannot verify that
 *      relationship in-file, which is why the column — not a second parse pass — is what makes an
 *      ancestor walk possible.
 *
 * ## What it does NOT claim
 *
 * That the walk is SOUND. The existing consumer keys its map on the symbol's bare `name`, and this
 * fixture set declares `FeaturesForm` in two files (both carrying the same base), so a name-keyed
 * consumer merges them. This gate pins that php's hierarchy REACHES the store and agrees with the
 * graph; it says nothing about which key a consumer should walk it with. What the column would
 * actually resolve is measured by `reason-census.mts`, which prices the `owner+inherited` lever at
 * 24,223 endpoints.
 *
 * ## THE SECOND SECTION IS A REPORT, AND IT IS NOT THIS GATE'S CLAIM
 *
 * Storing the same project a SECOND time loses a row, and the row is a cross-file heritage edge.
 * It reproduces 12 -> 11 heritage rows and 74 -> 73 relationships in total, it is permanent (a
 * third store stays at 11), and it has nothing to do with the payload this gate is about — it is
 * shared store machinery (`src/ast/parallel-indexer.ts:2928-2929`) and it is REPORTED here, not
 * edited here. The mechanism, measured rather than reasoned:
 *
 *   `storeResults` deletes, before inserting each file's rows,
 *   `DELETE FROM brain_relationship WHERE target_symbol_id IN (SELECT id FROM brain_symbol WHERE
 *   file_id = ?)` — every relationship from ANY file that targets this file's symbols. On a COLD
 *   store that delete finds nothing for cross-file rows, because their `target_symbol_id` is still
 *   NULL and only the post-index resolution pass fills it. On the SECOND store it finds them: the
 *   previous run's resolution already filled the column, so the target file's own turn deletes the
 *   inbound edge, and the source file — stored EARLIER — is never asked to re-emit it.
 *
 *   The ORDER is the proof, and it was run rather than argued. With the fixture set in the order
 *   this file lists (the defining file LAST), the 2nd store drops `extends SubContract ->
 *   BaseContract` and the 3rd keeps it dropped. With the DEFINING FILE FIRST, the same four files
 *   store 12 rows and stay at 12 across the 2nd and 3rd stores. Nothing is lost when the target is
 *   stored before the source — which is why the defect went unnoticed: it only bites the direction
 *   the file walk happens to order late.
 *
 * Why a report and not a failing check: the claim above and this defect have different owners. A
 * gate that goes red for machinery it does not own gets disabled, and a gate that stays SILENT
 * about it hides a real loss — so the loss is printed with the exact rows, the probe's own
 * operation is asserted (so it cannot become a vacuous zero), and the exit code carries only the
 * claim. If the store is ever fixed this section says OK and stops describing a defect; it cannot
 * decay into a stale sentence.
 *
 * ## Scope
 *
 * ONE temp project over four committed fixtures. `super_types` is a per-symbol column, so unlike a
 * resolution rate it does not depend on how many files are indexed: what is being asserted is what
 * the store binds, not a population share.
 *
 * Usage: bun validation/m14/fixtures/php/store-heritage-roundtrip.mts
 */
import { mkdtempSync, readFileSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { ASTEngine } from "../../../../src/ast/engine"
import { storeResults } from "../../../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../../../src/brain/database"
import { fileURLToPath } from "node:url"

// The script's own directory. (The first version wrapped this in `path.dirname(...)` and resolved
// one level up, to `validation/m14/fixtures/` — which is why the inputs are checked on disk before
// they are used rather than assumed.)
const HERE = (import.meta as any).dirname ?? path.dirname(fileURLToPath(import.meta.url))
// The defining file is LAST on purpose: that is the order the defect above needs, and the order
// that makes this probe a witness rather than a coincidence.
const FIXTURES = [
  "heritage-published.php",
  "same-leaf-inheritance.php",
  "cross-file-override.php",
  "cross-file-override-base.php",
].map((f) => path.join(HERE, f))

const failures: string[] = []
const reports: string[] = []
function check(ok: boolean, what: string, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}${detail ? `  ${detail}` : ""}`)
  if (!ok) failures.push(what)
}
function report(what: string, detail: string): void {
  console.log(`REPORT  ${what}  ${detail}`)
  reports.push(what)
}
const asSet = (json: string | null | undefined): string[] => {
  if (json === null || json === undefined) return []
  try {
    const p = JSON.parse(json)
    return Array.isArray(p) ? [...p].map(String).sort() : []
  } catch {
    return []
  }
}
const sameSet = (a: string[], b: string[]): boolean =>
  JSON.stringify([...a].sort()) === JSON.stringify([...b].sort())

/** Every relationship the store holds, as a comparable key. */
function relKeys(db: any): Set<string> {
  const rows = db
    .prepare(
      `SELECT r.relationship_type t, COALESCE(s.name, r.source_external, '(null)') src, r.target_external tg
         FROM brain_relationship r LEFT JOIN brain_symbol s ON s.id = r.source_symbol_id`,
    )
    .all() as any[]
  return new Set(rows.map((r) => `${r.t} ${r.src} -> ${r.tg}`))
}

async function main(): Promise<void> {
  // The inputs are checked BEFORE they are used. A probe that indexes the wrong directory reports
  // about a corpus it never read, and its green rows would be about that corpus.
  const missing = FIXTURES.filter((f) => {
    try { statSync(f); return false } catch { return true }
  })
  check(missing.length === 0, "every fixture this gate indexes exists on disk",
    missing.length ? `missing ${missing.map((m) => path.basename(m)).join(", ")} (dir ${HERE})` : `${FIXTURES.length} file(s)`)
  if (missing.length) {
    console.log("\nFAIL — cannot measure: the inputs are not where this file resolves them")
    process.exit(1)
  }

  const projectRoot = mkdtempSync(path.join(tmpdir(), "php-heritage-rt-"))
  // A FRESH project id per run. The claim is about a store that is built, not one that is rebuilt:
  // the defect in the second section is exactly a rebuild artifact, and letting it contaminate the
  // claim would make this probe report the wrong thing as false.
  const projectId = `php-heritage-rt-${Date.now()}-${Math.floor(Math.random() * 1e6)}` as any
  const results: any[] = []
  for (const f of FIXTURES) {
    const st = statSync(f)
    const r: any = await ASTEngine.parseFile(f, readFileSync(f, "utf8"))
    results.push({
      filePath: f,
      success: true,
      symbols: r.symbols ?? [],
      relationships: r.relationships ?? [],
      imports: r.imports ?? [],
      language: "php",
      fileHash: "php-heritage-rt",
      sizeBytes: st.size,
      lastModified: st.mtimeMs,
    })
  }
  await storeResults(projectId, projectRoot, results)
  const db: any = await BrainDatabase.getRawInstance(projectId)

  const symbols = db
    .prepare(`SELECT name, qualified_name, super_types FROM brain_symbol WHERE project_id = ?`)
    .all(projectId) as any[]
  // JOINED, not read off `source_external`. A relationship whose source resolves to a stored symbol
  // carries `source_symbol_id` and leaves `source_external` NULL, so reading that column returns
  // the EMPTY set for every row and the mirror check below would compare each stored hierarchy
  // against nothing. It failed loudly the first time only because the stored sets are non-empty; a
  // symbol with no heritage would have compared [] to [] and "passed" a check that never read the
  // graph. The join's own size is asserted so a zero-length read cannot look like agreement.
  const rels = db
    .prepare(
      `SELECT r.relationship_type, s.name AS source_name, r.target_external
         FROM brain_relationship r JOIN brain_symbol s ON s.id = r.source_symbol_id
        WHERE r.project_id = ? AND s.project_id = ?`,
    )
    .all(projectId, projectId) as any[]

  // ---- 1. the precondition the retarget pass tests, read on the store ----------------------
  const withheritage = symbols.filter((s) => s.super_types !== null && s.super_types !== undefined)
  check(withheritage.length > 0,
    "the store holds a php hierarchy at all (retargetCrossFileOverrides' `supertypes.size === 0` early return is now false)",
    `symbols with super_types = ${withheritage.length}/${symbols.length}`)
  const byName = new Map<string, any[]>()
  for (const s of symbols) {
    const list = byName.get(s.name) ?? (byName.set(s.name, []), byName.get(s.name)!)
    list.push(s)
  }
  const heritageOf = (name: string): string[][] => (byName.get(name) ?? []).map((s) => asSet(s.super_types))

  // ---- 2. the values, on the shapes the fixture pins --------------------------------------
  const row = (name: string, want: string[], note: string) => {
    const got = heritageOf(name)
    check(got.length > 0 && got.every((g) => sameSet(g, want)), note, `${name} -> ${JSON.stringify(got)}`)
  }
  row("WithBaseAndInterfaces", ["Base", "Second", "Labeled"], "base AND interfaces reach the store")
  row("WithInterfaceOnly", ["Second"], "interfaces without a base reach the store")
  row("Base", ["First"], "a class whose only heritage is an interface reaches the store")
  row("DerivedIface", ["First", "Second"], "an interface's `extends` parents reach the store")
  row("Suit", ["Labeled"], "an enum's implements list reaches the store (PHP 8.1 shape)")
  row("FeaturesForm", ["Forms\\User\\FeaturesForm"], "a same-leaf QUALIFIED base keeps its qualification in the column")

  const emptyHeritage = (name: string, note: string) => {
    const got = heritageOf(name)
    check(got.length > 0 && got.every((g) => g.length === 0), note, `${name} -> ${JSON.stringify(got)}`)
  }
  emptyHeritage("NoHeritage", "a class with no heritage stores NULL, not []")
  emptyHeritage("PlainIface", "an interface with no parents stores NULL")
  emptyHeritage("InvalidArgumentException",
    "the unresolvable same-leaf base stores NOTHING — a payload that re-read the node text would name the class as its own ancestor")

  // ---- negative controls on the checks themselves ------------------------------------------
  // Every row above is an EQUALITY against a set, so a comparator that always said yes, or a name
  // that resolves to no rows at all, would print the same greens. Both are pinned on the same two
  // functions the rows use, which is the only form of this that is worth anything.
  check(heritageOf("NoSuchSymbolAnywhere").length === 0,
    "negative control: a name this project does not declare yields no rows (a typo'd row cannot pass)")
  check(!sameSet(["Base"], ["Base", "Second"]) && sameSet(["Second", "Base"], ["Base", "Second"]),
    "negative control: the comparator rejects a one-member difference and ignores order")

  // ---- 3. the mirror, generically ---------------------------------------------------------
  const edgeRows = rels.filter((r) => r.relationship_type === "extends" || r.relationship_type === "implements")
  check(edgeRows.length > 0, "the mirror check has a graph to compare against (a zero-row join would agree with anything)",
    `${edgeRows.length} heritage edge row(s)`)
  const edgeTargets = new Map<string, Set<string>>()
  for (const r of edgeRows) {
    const src = String(r.source_name ?? "")
    let set = edgeTargets.get(src)
    if (!set) { set = new Set(); edgeTargets.set(src, set) }
    set.add(String(r.target_external ?? ""))
  }
  const mismatched: string[] = []
  for (const s of withheritage) {
    const stored = asSet(s.super_types)
    const fromEdges = [...(edgeTargets.get(String(s.name)) ?? new Set<string>())]
    if (!sameSet(stored, fromEdges)) mismatched.push(`${s.name}: stored ${JSON.stringify(stored)} vs edges ${JSON.stringify(fromEdges)}`)
  }
  check(mismatched.length === 0,
    "every stored hierarchy EQUALS the targets of that declaration's stored extends+implements rows",
    mismatched.length ? mismatched.slice(0, 4).join(" | ") : `checked ${withheritage.length} symbol(s)`)

  // ---- 4. the cross-file case -------------------------------------------------------------
  const sub = heritageOf("SubContract")
  check(sub.length > 0 && sub.every((g) => sameSet(g, ["BaseContract"])),
    "a subclass whose base lives in ANOTHER file stores that base's name",
    `SubContract -> ${JSON.stringify(sub)}`)

  // ---- the REPORT: what a SECOND store does to the same project ---------------------------
  const before = relKeys(db)
  await storeResults(projectId, projectRoot, results)
  const after = relKeys(db)
  const lost = [...before].filter((k) => !after.has(k))
  const gained = [...after].filter((k) => !before.has(k))
  // The probe's own operation is asserted: a report that silently measured nothing would read as
  // "no loss", which is the one answer it must never give for the wrong reason.
  check(before.size > 0 && after.size > 0,
    "the re-index probe really re-stored the project and read it back (a zero-row read would report no loss)",
    `${before.size} -> ${after.size} relationship row(s)`)
  if (lost.length === 0 && gained.length === 0) {
    report("re-index stability (NOT this gate's claim)", "OK — a second store changed no relationship row")
  } else {
    report("RE-INDEX LOSES ROWS (NOT this gate's claim, and not edited here)",
      `${before.size} -> ${after.size}; lost ${lost.length}, gained ${gained.length}`)
    for (const k of lost.slice(0, 8)) console.log(`        lost: ${k}`)
    for (const k of gained.slice(0, 8)) console.log(`        gained: ${k}`)
    console.log("        mechanism: parallel-indexer.ts:2928-2929 deletes every relationship (from ANY file) whose")
    console.log("        target_symbol_id lives in the file being stored; on the 2nd store the previous run's")
    console.log("        resolution has already filled that column, so the target file's own turn deletes the")
    console.log("        inbound cross-file edge and the source file — stored earlier — never re-emits it.")
    console.log("        order experiment: the same 4 files store 12 heritage rows and hold 12 when the defining")
    console.log("        file is stored FIRST; stored last, the 2nd store drops to 11 and the 3rd keeps it dropped.")
  }

  // ---- 5. the control: the SAME store with the payload removed ----------------------------
  // Every green row above shares one cause — the analyzer publishes `metadata.superTypes` — and a
  // gate whose rows would also go green for a different reason is not evidence about that cause.
  // So the analyzer's own output is taken apart in memory, the key removed from every symbol, and
  // the same four files are stored into a second, cold project. This reproduces the state of php
  // BEFORE the change exactly, from the analyzer's result rather than from a description of it,
  // and it is also what makes the first four rows falsifiable: if `super_types` were being filled
  // by anything else, this run would still find rows.
  const stripped = results.map((r) => ({
    ...r,
    symbols: (r.symbols ?? []).map((s: any) => {
      if (!s?.metadata || typeof s.metadata !== "object" || !("superTypes" in s.metadata)) return s
      const { superTypes: _dropped, ...rest } = s.metadata
      return { ...s, metadata: rest }
    }),
  }))
  const controlId = `php-heritage-rt-control-${Date.now()}-${Math.floor(Math.random() * 1e6)}` as any
  await storeResults(controlId, projectRoot, stripped)
  const controlDb: any = await BrainDatabase.getRawInstance(controlId)
  const controlRows = controlDb
    .prepare(`SELECT COUNT(*) c FROM brain_symbol WHERE project_id = ? AND super_types IS NOT NULL`)
    .get(controlId) as any
  const controlSymbols = controlDb.prepare(`SELECT COUNT(*) c FROM brain_symbol WHERE project_id = ?`).get(controlId) as any
  check(controlSymbols.c > 0 && controlRows.c === 0,
    "control: with `metadata.superTypes` removed the SAME files store NULL on EVERY symbol (the rows above are caused by the payload, and this gate can fail)",
    `${controlRows.c}/${controlSymbols.c} non-NULL`)
  await controlDb.close?.()

  await db.close?.()
  console.log(`\n${failures.length === 0 ? "PASS" : "FAIL"} — ${failures.length ? failures.join("; ") : "php heritage store round-trip"}`)
  console.log(`reports (not claims): ${reports.length ? reports.join("; ") : "none"}`)
  process.exit(failures.length === 0 ? 0 : 1)
}
void main()
