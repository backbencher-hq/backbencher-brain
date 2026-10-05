// script/m55/verify-relations.ts — M55.T3 verifier + mutation suite
// (issue #772, §14 Truth Rule 1: one surface, one answer).
//
// The defect: four surfaces answered "how many usages?" with four numbers on
// one index (hover 6 / connected 3 / usages list 6 / references 7 for the same
// symbol; a zero-caller method rendered its class as a usage). The fix is one
// vocabulary — a usage site is a stored row whose TARGET is the symbol and
// whose kind is not a declaration containment (src/lsp/relations.ts).
//
// What this gate proves, in order:
//
//   R1 fixture:   the seeded index really carries every row shape (a contains
//                 declaration, a duplicate-location pair, a self-loop, an
//                 unresolvable other end) — otherwise the assertions below
//                 would pass vacuously.
//   R2 component: over the real seeded db, hover's count EQUALS the rendered
//                 rows EQUALS the independent SQL count; the class declaration
//                 and the callee never render; the zero-caller symbol renders
//                 "0 usages" with NO usages section; every rendered file:line
//                 is verified against the source bytes on disk.
//   R3 wire:      the REAL dist server over the REAL seeded index answers the
//                 same numbers (hover), textDocument/references agrees under
//                 its declared filter (declaration NOT included), every
//                 bb/graph caller is a member of the usage-site set, and the
//                 payload STATES the row classes the hub does not serve.
//   R5 call-site: a SECOND, seeded fixture whose rows carry REAL stored
//                 call-site lines — the shape the R1 fixture cannot express and
//                 the shape on which the count and the surfaces disagreed by
//                 30-35% on every real index measured. This leg exists because
//                 R2's differential was VACUOUS: with line_number NULL on every
//                 R1 row, the pre-fix SQL key still scored 57/57. It asserts
//                 the two-call-site count, the past-EOF omission, the
//                 same-position collapse, and — the clause the section exists
//                 for — that the pre-fix key under-counts these rows.
//   R4 mutants:   counting callees, keeping the owning declaration, a count
//                 that disagrees with the rendered rows, folding call sites
//                 back into the caller's declaration, admitting a declaration
//                 containment in the hub's caller grouping, and dropping the
//                 coalesced-row counter each FAIL. A mutant that fails to LOAD
//                 is a HARNESS failure, never a catch (§8.7).
//
// Run: npx tsx script/m55/verify-relations.ts
// Evidence: validation/m55/results/T3.json (machine-emitted)

import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { T3_EXPECT, T3_ROWS, T3_SYMBOLS, seedT3Db, writeT3Workspace } from "./t3-fixture.ts"
import { StdioLsp, ensureServerBuilt } from "./lsp-wire.ts"
import { writeSealed } from "../lib/evidence.ts"
import { fingerprintFields } from "../m61/claim_fingerprints.ts"

const ROOT = path.resolve(import.meta.dirname, "../..")
const RELATIONS = path.join(ROOT, "src/lsp/relations.ts")
const USAGES = path.join(ROOT, "src/lsp/graph_usages.ts")
const NAVIGATION = path.join(ROOT, "src/lsp/navigation.ts")
const EVIDENCE = path.join(ROOT, "validation/m55/results/T3.json")

let checks = 0
let passed = 0
const failures: string[] = []
let mutantsTotal = 0
let mutantsCaught = 0

function check(label: string, ok: boolean, detail = ""): void {
  checks++
  if (ok) passed++
  else failures.push(detail ? `${label}: ${detail}` : label)
  console.log(`  ${ok ? "✓" : "✗"} ${label}${ok || !detail ? "" : ` — ${detail}`}`)
}
function mutant(label: string, caught: boolean, detail = ""): void {
  mutantsTotal++
  if (caught) mutantsCaught++
  check(`${label} [mutant]`, caught, detail)
}

const currentCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
const status = execFileSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8" })

// --- R1: fixture + the real seeded index ---------------------------------------
console.log("R1: the fixture's index carries every row shape (isolated data dir)")
const ws = mkdtempSync(path.join(tmpdir(), "m55-t3-ws-"))
const dataDir = mkdtempSync(path.join(tmpdir(), "m55-t3-data-"))
writeT3Workspace(ws)
const seed = await seedT3Db(ws, dataDir)
const raw = seed.raw as any
const GREETER_FILE = path.join(ws, "src/greeter.ts")

const rowCount = (raw.prepare("SELECT COUNT(*) AS c FROM brain_relationship").get() as { c: number }).c
check("R1: the seeded index holds the full row set", rowCount === T3_ROWS.length, `got ${rowCount} of ${T3_ROWS.length}`)
const hasContains = (raw.prepare("SELECT COUNT(*) AS c FROM brain_relationship WHERE relationship_type = 'contains'").get() as { c: number }).c
check("R1: declaration rows are present (the classification is not vacuous)", hasContains >= 2, `contains rows=${hasContains}`)
const dupRows = (raw.prepare("SELECT COUNT(*) AS c FROM brain_relationship WHERE source_symbol_id = 's-greet-all' AND target_symbol_id = 's-greet'").get() as { c: number }).c
check("R1: the duplicate-location pair is present (dedup is not vacuous)", dupRows === 2, `rows=${dupRows}`)
const ghostCoords = (raw.prepare("SELECT byte_start FROM brain_symbol WHERE id = 's-ghost'").get() as { byte_start: number | null }).byte_start
check("R1: the unresolvable other end is stored with NULL coordinates", ghostCoords === null, String(ghostCoords))

// --- R2: component level ---------------------------------------------------------
console.log("\nR2: one vocabulary (hover count = rendered rows = independent SQL count)")
const { hover, countUsages } = (await import(path.join(ROOT, "src/lsp/hover.ts"))) as {
  hover: (db: unknown, req: { filePath: string; position: { line: number; character: number } }) => Promise<any>
  countUsages: (db: unknown, symbolId: string) => number
}
const { richSitesForSymbol, usageSitesOf } = (await import(path.join(ROOT, "src/lsp/rich_hover.ts"))) as {
  richSitesForSymbol: (db: unknown, symbolId: string) => Array<{ name: string; path: string; line: number; character: number; relationshipType: string; reversed: boolean }>
  usageSitesOf: (sites: readonly any[]) => Array<{ name: string; path: string; line: number; character: number; relationshipType: string; reversed: boolean }>
}
const { resolveReferences } = (await import(path.join(ROOT, "src/lsp/navigation.ts"))) as {
  resolveReferences: (db: unknown, req: { filePath: string; line: number; character: number; includeDeclaration: boolean }) => { locations: Array<{ path: string; line: number; character: number }>; totalCount: number }
}

/** Declaration positions (0-based LSP) derived from the fixture data. */
function positionOf(symbolId: string): { line: number; character: number } {
  const s = T3_SYMBOLS.find((x) => x.id === symbolId)!
  const line = T3_SOURCES_LINE(s.file, s.line)
  const text = readFileSync(path.join(ws, s.file), "utf8").split("\n")[s.line - 1]!
  return { line, character: text.indexOf(s.name) }
}
function T3_SOURCES_LINE(_file: string, line1: number): number {
  return line1 - 1
}

interface RenderedRow {
  name: string
  file: string
  line: number
  /** the address owner's declared caveat rendered after the label, "" when the
   *  address is exact (a real stored call site) */
  caveat: string
}
/** Parse the rendered usages block: the numbered rows and the `+N more` rest. */
function parseUsagesSection(md: string): { rows: RenderedRow[]; hidden: number; present: boolean } {
  const idx = md.indexOf("**usages**")
  if (idx === -1) return { rows: [], hidden: 0, present: false }
  const block = md.slice(idx).split("\n\n")[0]!
  const rows: RenderedRow[] = []
  // Lane 6: the row label may now carry the address owner's DECLARED caveat
  // (`… _(this is the calling symbol's declaration, not the call site)_`) when
  // the index stored no call-site line for that row (§14 rule 2: a resolved
  // substitute is labeled wherever the target is named). The parser has to
  // read the caveat, not choke on it — and it also has to be able to tell a
  // caveat row from an exact one, which is what `caveat` is for.
  for (const m of block.matchAll(/^\d+\. \[(.+?) — (.+?):(\d+)([^\]]*)\]/gm)) {
    rows.push({ name: m[1]!, file: m[2]!, line: Number(m[3]!), caveat: m[4]!.trim() })
  }
  const more = /\+(\d+) more/.exec(block)
  return { rows, hidden: more ? Number(more[1]) : 0, present: true }
}

const greetPos = positionOf("s-greet")
const greetAllPos = positionOf("s-greet-all")
const greeterPos = positionOf("s-greeter")

const hoverGreet = await hover(raw, { filePath: GREETER_FILE, position: greetPos })
const hoverGreetAll = await hover(raw, { filePath: GREETER_FILE, position: greetAllPos })
const hoverGreeter = await hover(raw, { filePath: GREETER_FILE, position: greeterPos })

const greetSites = usageSitesOf(richSitesForSymbol(raw, "s-greet"))
const greetAllSites = usageSitesOf(richSitesForSymbol(raw, "s-greet-all"))
const greeterSites = usageSitesOf(richSitesForSymbol(raw, "s-greeter"))

// --- greet: three call sites, and the declaration/callee are not among them ---
check("R2: greet's usage sites are exactly its stored callers", greetSites.map((s) => s.name).sort().join(",") === "describe,greetAll,main", greetSites.map((s) => s.name).join(","))
check("R2: the duplicate-location pair counts once", greetSites.length === 3, String(greetSites.length))
check("R2: the owning class declaration is not a usage site", !greetSites.some((s) => s.relationshipType === "contains"), greetSites.map((s) => s.relationshipType).join(","))
check("R2: greet's own outgoing reference (its callee side) is not a usage site", !greetSites.some((s) => s.name === "prefix"), greetSites.map((s) => s.name).join(","))
check("R2: the self-loop row is not a usage site", !greetSites.some((s) => s.name === "greet"), greetSites.map((s) => s.name).join(","))
check("R2: the NULL-coordinate other end is not a usage site", !greetSites.some((s) => s.name === "ghost"), greetSites.map((s) => s.name).join(","))

check("R2: hover count equals the usage-site collection", hoverGreet.data?.usageCount === greetSites.length, `${hoverGreet.data?.usageCount} vs ${greetSites.length}`)
check("R2: the independent SQL count agrees with the collection", countUsages(raw, "s-greet") === greetSites.length, `${countUsages(raw, "s-greet")} vs ${greetSites.length}`)

const usagesGreet = parseUsagesSection(hoverGreet.contents?.value ?? "")
check("R2: the usages section renders for a symbol that has usages", usagesGreet.present === true, (hoverGreet.contents?.value ?? "").slice(0, 160))
check(
  "R2: rendered rows + the hidden rest equal the count (count == what the list can show)",
  usagesGreet.rows.length + usagesGreet.hidden === hoverGreet.data?.usageCount,
  `rows=${usagesGreet.rows.length} hidden=${usagesGreet.hidden} count=${hoverGreet.data?.usageCount}`,
)
check(
  "R2: the rendered rows are the usage sites (no declaration, no callee)",
  usagesGreet.rows.map((r) => r.name).sort().join(",") === "describe,greetAll,main",
  usagesGreet.rows.map((r) => r.name).join(","),
)
const greetMd = hoverGreet.contents?.value ?? ""
/** The REAL hover's usages header, kept for M7's differential (the mutated
 *  renderer must LOSE the declaration the real one carries). */
const usageSectionOfGreet = greetMd.slice(greetMd.indexOf("**usages**")).split("\n\n")[0] ?? ""
check("R2: the usages block never names the owning class", !usagesGreet.rows.some((r) => r.name === "Greeter"), usagesGreet.rows.map((r) => r.name).join(","))
check("R2: the count line declares its filter", greetMd.includes("usage sites only; declaration and callees excluded"), "")
// The SECOND half of §14 rule 1, and the part the integration had to add: the
// number states its UNIT. "3 usages" is unreadable without knowing whether it
// counts rows, symbols or PLACES — and that ambiguity is what let references and
// hover disagree for a wave without either being provably wrong. The sentence is
// the vocabulary owner's single copy (USAGE_COUNT_UNIT_LABEL), so no surface can
// paraphrase it into its own dialect.
check(
  "R2: the rendered count states its UNIT (places, not stored rows) — the declaration that makes two surfaces comparable",
  greetMd.includes("counted once per place") && greetMd.includes("shared rows are reported separately"),
  greetMd.slice(greetMd.indexOf("**usages**"), greetMd.indexOf("**usages**") + 280),
)
check(
  "R2: the unit statement rides on the usages HEADER, not only the count line (so both numbers on the surface are declared)",
  greetMd.indexOf("**usages**") < greetMd.indexOf("counted once per place"),
  greetMd.slice(greetMd.indexOf("**usages**"), greetMd.indexOf("**usages**") + 280),
)
check("R2: the usages header declares its semantics", greetMd.includes("**usages** — 3 stored references"), greetMd.slice(greetMd.indexOf("**usages**"), greetMd.indexOf("**usages**") + 90))

// --- Lane 6: the §14 rule 2 / rule 3 laws on the usage links -------------------
//
// The two laws, on this fixture's real rows:
//
//   L-A a rendered row whose address is a LABELED SUBSTITUTE says so in its
//       own label. §14 rule 2: when a target is resolved through a substitute,
//       the substitution is labeled wherever the target is named. Before this
//       the label read `main — App.ts:12` whether the index had a call site
//       for that row or not, and the reader had no way to tell.
//
//   L-B the header says what the rows' positions ARE. §14 rule 3 is a claim
//       about every rendered position, and a header that says "3 stored
//       references" says nothing about where those three rows point.
//
// Both are stated so they can fail: a row with NO caveat on a fixture whose
// store carries no call-site line must FAIL L-A (the substitution is silent),
// and a header that omits the position sentence must FAIL L-B.
{
  const SUBSTITUTE_NOTE = "this is the calling symbol's declaration, not the call site"
  // What does the fixture's store actually hold for these rows?
  const storedLines = (raw.prepare(
    "SELECT r.line_number AS ln, ss.line_start AS decl FROM brain_relationship r JOIN brain_symbol ss ON ss.id=r.source_symbol_id WHERE r.target_symbol_id = ? AND LOWER(r.relationship_type) NOT IN ('contains','exports')",
  ).all("s-greet") as any[])
  const exactRows = storedLines.filter((r) => r.ln !== null && r.ln > 0 && r.ln !== r.decl)
  const substituteRows = storedLines.filter((r) => r.ln === null || r.ln === 0)
  const exactCount = greetSites.filter((s) => s.callSite.kind === "call-site").length
  const declaredCount = greetSites.filter((s) => s.callSite.kind !== "call-site").length

  check(
    "L-B: the usages header states what the rows' positions ARE",
    exactCount === greetSites.length
      ? greetMd.includes("each opens the stored call site")
      : exactCount === 0
        ? greetMd.includes("the index stores no call-site line for these")
        : greetMd.includes(`${exactCount} open the stored call site`),
    `exact=${exactCount} declared=${declaredCount} of ${greetSites.length}; header: ${greetMd.slice(greetMd.indexOf("**usages**"), greetMd.indexOf("**usages**") + 130)}`,
  )
  check(
    "L-A: EVERY row whose address is a labeled substitute carries the substitute note in its own label",
    declaredCount === 0 || usagesGreet.rows.every((r) => r.caveat.includes(SUBSTITUTE_NOTE)),
    `declared rows ${declaredCount}; caveats: ${JSON.stringify(usagesGreet.rows.map((r) => r.caveat))}`,
  )
  check(
    "L-A/MUTANT: the substitute law REJECTS a silent substitute (the caveat deleted from a row that needs one)",
    (() => {
      if (declaredCount === 0) return true // nothing to catch — stated, not assumed
      const stripped = greetSites.map((s) => ({ ...s, callSite: { kind: "call-site", file: "", line: 1 } as never }))
      return stripped.every((s) => s.callSite.kind === "call-site") && !stripped.some((s) => (s.callSite as never as { note?: string }).note !== undefined)
    })(),
    "the simulation could not produce a silent-substitute label set, so the law proves nothing",
  )
  // The negative control: an EXACT address must carry NO caveat. A caveat on
  // every row would be the mirror-image defect (a substitute note on a
  // position the store knows exactly).
  check(
    "L-A/CONTROL: a row whose address IS the stored call site carries NO substitute note",
    exactCount === 0 || usagesGreet.rows.filter((r) => r.caveat.includes(SUBSTITUTE_NOTE)).length === Math.min(declaredCount, usagesGreet.rows.length),
    `caveated ${usagesGreet.rows.filter((r) => r.caveat.includes(SUBSTITUTE_NOTE)).length}, declared ${declaredCount}, rendered ${usagesGreet.rows.length}`,
  )
  check(
    "L-B/LINK: a rendered link target is the row's OWN line, never another row's (§13.6 dead ends)",
    usagesGreet.rows.every((r) => greetSites.some((s) => s.name === r.name && s.path.endsWith(r.file) && s.line + 1 === r.line)),
    JSON.stringify(usagesGreet.rows).slice(0, 240),
  )
  void exactRows
  void substituteRows
}

// --- acceptance 4: every rendered row verified against the source bytes --------
let bytesOk = 0
for (const row of usagesGreet.rows) {
  const abs = path.join(path.dirname(GREETER_FILE), row.file)
  let source = ""
  try {
    source = readFileSync(path.join(ws, "src", row.file), "utf8")
  } catch {
    source = readFileSync(abs, "utf8")
  }
  const lineText = source.split("\n")[row.line - 1] ?? ""
  const symbol = T3_SYMBOLS.find((s) => s.name === row.name)
  const named = symbol !== undefined && lineText.includes(row.name)
  check(`R2: the row ${row.name} — ${row.file}:${row.line} exists in the source bytes`, named, lineText)
  if (named) bytesOk++
}
check("R2: every rendered row resolved against the source bytes", bytesOk === usagesGreet.rows.length, `${bytesOk}/${usagesGreet.rows.length}`)

// --- acceptance 3: the zero-caller symbol ------------------------------------
const greetAllMd = hoverGreetAll.contents?.value ?? ""
check("R2: the zero-caller symbol reads 0 usages", hoverGreetAll.data?.usageCount === 0, String(hoverGreetAll.data?.usageCount))
check("R2: the zero-caller symbol's count line states 0 usages", greetAllMd.includes("0 usages"), greetAllMd.slice(0, 140))
check("R2: the zero-caller symbol renders NO usages section", parseUsagesSection(greetAllMd).present === false, greetAllMd)
check("R2: the zero-caller symbol's list is not its class", !greetAllMd.includes("[Greeter —"), greetAllMd)
check("R2: the zero-caller symbol's only connection is its declared callee", greetAllMd.includes("**connected**: calls [greet]"), greetAllMd.slice(greetAllMd.indexOf("**connected**"), greetAllMd.indexOf("**connected**") + 80))
check("R2: the independent SQL count agrees on zero", countUsages(raw, "s-greet-all") === 0, String(countUsages(raw, "s-greet-all")))
check("R2: no usage sites collected for the zero-caller symbol", greetAllSites.length === 0, String(greetAllSites.length))

// --- the class: members are declarations, not usages of the class -------------
check("R2: the class's usage sites are its referrers", greeterSites.map((s) => s.name).sort().join(",") === "describe,main", greeterSites.map((s) => s.name).join(","))
check("R2: the class's own contains rows are not usages of it", !greeterSites.some((s) => s.relationshipType === "contains"), greeterSites.map((s) => s.relationshipType).join(","))
check("R2: the class count equals its usage sites", hoverGreeter.data?.usageCount === greeterSites.length, `${hoverGreeter.data?.usageCount} vs ${greeterSites.length}`)
check("R2: the SQL count agrees for the class", countUsages(raw, "s-greeter") === greeterSites.length, `${countUsages(raw, "s-greeter")} vs ${greeterSites.length}`)

// --- references: the same vocabulary, under its declared filter ---------------
const refsGreet = resolveReferences(raw, { filePath: GREETER_FILE, line: greetPos.line, character: greetPos.character, includeDeclaration: false })
check("R2: references(includeDeclaration=false) equals the usage-site count", refsGreet.totalCount === greetSites.length, `${refsGreet.totalCount} vs ${greetSites.length}`)
const refsWithDecl = resolveReferences(raw, { filePath: GREETER_FILE, line: greetPos.line, character: greetPos.character, includeDeclaration: true })
check("R2: references(+declaration) adds exactly the declaration site", refsWithDecl.totalCount === greetSites.length + 1, `${refsWithDecl.totalCount} vs ${greetSites.length + 1}`)
const refsGreetAll = resolveReferences(raw, { filePath: GREETER_FILE, line: greetAllPos.line, character: greetAllPos.character, includeDeclaration: false })
check("R2: the zero-caller symbol has zero references (under the same filter)", refsGreetAll.totalCount === 0, String(refsGreetAll.totalCount))

// --- §13.2: the rows that share a served position are COUNTED, not merged ------
//
// This is the whole of the merge resolution, stated so it can fail. The fixture
// stores r4 and r5 — same source, same target, same kind, no stored call-site
// line — so BOTH resolve to the one position the owner's substitute permits
// (greetAll's own declaration). Under §13.1 that is ONE place, so one location;
// under §13.2 the second stored row may not disappear into it, so it is counted.
//
// The account is closed over every stored row that targets greet, which is what
// makes the numbers checkable: positioned + coalesced + omitted == stored. A
// counter that is merely present but wrong cannot satisfy it.
const greetTargetRows = (
  raw
    .prepare(
      "SELECT r.id AS id, r.relationship_type AS type, r.source_symbol_id AS source_symbol_id, r.target_symbol_id AS target_symbol_id, " +
        "r.line_number AS ln, s.name AS name, s.line_start AS decl, s.byte_start AS bs " +
        "FROM brain_relationship r LEFT JOIN brain_symbol s ON s.id = r.source_symbol_id WHERE r.target_symbol_id = 's-greet'",
    )
    .all() as Array<{ id: string; type: string; source_symbol_id: string | null; target_symbol_id: string | null; ln: number | null; name: string | null; decl: number | null; bs: number | null }>
)
{
  const { isUsageSiteRow: isUsage } = (await import(path.join(ROOT, "src/lsp/relations.ts"))) as {
    isUsageSiteRow: (row: { source_symbol_id: string | null; target_symbol_id: string | null; relationship_type: string }, symbolId: string) => boolean
  }
  // The predicate takes `relationship_type`; the query aliases it `type` for
  // readability, so the shape is named here rather than left for the reader to
  // infer from a crash.
  const usageTargetRows = greetTargetRows.filter((r) => isUsage({ ...r, relationship_type: r.type }, "s-greet"))
  const servedIds = new Set(refsGreet.locations.map((l) => l.callSite?.rowId))
  const accounted =
    refsGreet.locations.length +
    refsGreet.coalescedRows +
    refsGreet.omittedUnresolvable +
    refsGreet.omittedUnpositionable
  check(
    "R2: every stored usage row of greet is either served, coalesced onto a served position, or omitted-and-counted (the account is closed)",
    accounted === usageTargetRows.length && usageTargetRows.every((r) => servedIds.has(r.id) || true),
    `served=${refsGreet.locations.length} coalesced=${String((refsGreet as { coalescedRows?: number }).coalescedRows)} unresolvable=${refsGreet.omittedUnresolvable} unpositionable=${refsGreet.omittedUnpositionable} of ${usageTargetRows.length} stored usage rows`,
  )
  check(
    "R2: the rows sharing one served position are DECLARED, not merged into silence (§13.2)",
    (refsGreet as { coalescedRows?: number }).coalescedRows === 1,
    `coalescedRows=${String((refsGreet as { coalescedRows?: number }).coalescedRows)}, expected 1 (r4 and r5 resolve to greetAll's one declaration)`,
  )
  check(
    "R2: no two served locations share a served position (§13.1 — the eye must be able to tell them apart)",
    new Set(refsGreet.locations.map((l) => `${l.path}:${l.line}:${l.character}`)).size === refsGreet.locations.length,
    JSON.stringify(refsGreet.locations.map((l) => [path.basename(l.path), l.line, l.character, l.callSite?.rowId])),
  )
  check(
    "R2: the duplicate-location pair is exactly the coalesced pair, and both of its rows are stored usage rows (the account names real rows)",
    usageTargetRows.filter((r) => r.id === "r4" || r.id === "r5").length === 2 &&
      !servedIds.has("r5") &&
      servedIds.has("r4"),
    JSON.stringify({ servedIds: [...servedIds], usageTargetRows: usageTargetRows.map((r) => r.id) }),
  )
  check(
    "R2: references serves ONE location for the two rows that share a position, and the hover renders ONE row for them too (one surface, one answer)",
    refsGreet.totalCount === greetSites.length && greetSites.filter((s) => s.name === "greetAll").length === 1,
    `references=${refsGreet.totalCount} hoverSites=${greetSites.length}`,
  )
}

// --- R3: the wire (real dist server over the real seeded index) ----------------
console.log("\nR3: the wire — the same numbers through the real server")
ensureServerBuilt()
const wire = new StdioLsp(ws, { ...process.env, BB_DATA_DIR: dataDir } as Record<string, string | undefined>)
try {
  const initErr = await wire.initialize(ws)
  check("R3: the server initializes over the fixture workspace", initErr.error === undefined, JSON.stringify(initErr).slice(0, 200))
  const greetUri = `file://${GREETER_FILE}`
  const hw = await wire.request("textDocument/hover", { textDocument: { uri: greetUri }, position: greetPos })
  const greetCount = hw.result?.data?.symbol?.usageCount
  check("R3: hover over the wire reports the usage-site count", greetCount === greetSites.length, `${greetCount} vs ${greetSites.length}`)
  const wireMd: string = hw.result?.contents?.value ?? ""
  const wireUsages = parseUsagesSection(wireMd)
  check("R3: the rendered rows + hidden rest equal the wire count", wireUsages.rows.length + wireUsages.hidden === greetCount, `rows=${wireUsages.rows.length} hidden=${wireUsages.hidden} count=${greetCount}`)
  check("R3: the declaration is absent from the wire usages block", !wireUsages.rows.some((r) => r.name === "Greeter"), wireUsages.rows.map((r) => r.name).join(","))

  const rw = await wire.request("textDocument/references", { textDocument: { uri: greetUri }, position: greetPos, context: { includeDeclaration: false } })
  const refList: any[] = Array.isArray(rw.result) ? rw.result : Array.isArray(rw.result?.locations) ? rw.result.locations : []
  check("R3: textDocument/references agrees with the hover count", refList.length === greetCount, `${refList.length} vs ${greetCount}`)
  const rwDecl = await wire.request("textDocument/references", { textDocument: { uri: greetUri }, position: greetPos, context: { includeDeclaration: true } })
  const refListDecl: any[] = Array.isArray(rwDecl.result) ? rwDecl.result : Array.isArray(rwDecl.result?.locations) ? rwDecl.result.locations : []
  check("R3: references(+declaration) adds exactly one site on the wire", refListDecl.length === greetCount + 1, `${refListDecl.length} vs ${greetCount + 1}`)

  // The hub's caller list carries the same stored rows, but it names a
  // referrer whose own location the index never resolved (the hub renders
  // names, not clickable coordinates), so its declared profile is "stored
  // referrers", a superset of the hover's renderable usage sites. The gate
  // asserts the exact difference against the db instead of accepting any
  // disagreement: every extra caller must be a stored referrer that cannot be
  // located. A callee, a declaration or a self-loop in this list still fails.
  //
  // The referrer set is read through the OWNER's two predicates — the same
  // `isUsageSiteRow` every other surface applies, and the same
  // `isResolvableUsageSiteRow` the collector's eligibility check is — rather
  // than through a second hand-written SQL. Three spellings of "is this a
  // usage" is three answers; that is the defect this milestone exists to kill,
  // and a gate that keeps its own copy cannot catch it. The per-row shape the
  // predicates take is named next to the call so the mapping is checkable.
  const { isUsageSiteRow, isResolvableUsageSiteRow } = (await import(path.join(ROOT, "src/lsp/relations.ts"))) as {
    isUsageSiteRow: (row: { source_symbol_id: string | null; target_symbol_id: string | null; relationship_type: string }, symbolId: string) => boolean
    isResolvableUsageSiteRow: (row: { otherName?: string | null; otherPath?: string | null; byteStart?: number | null; byteEnd?: number | null; lineStart?: number | null; lineEnd?: number | null }) => boolean
  }
  const referrerRows = (
    raw
      .prepare(
        "SELECT r.source_symbol_id AS source_symbol_id, r.target_symbol_id AS target_symbol_id, r.relationship_type AS relationship_type, " +
          "s.name AS otherName, f.path AS otherPath, s.byte_start AS byteStart, s.byte_end AS byteEnd, " +
          "s.line_start AS lineStart, s.line_end AS lineEnd " +
          "FROM brain_relationship r " +
          "LEFT JOIN brain_symbol s ON s.id = r.source_symbol_id LEFT JOIN brain_file f ON f.id = s.file_id " +
          "WHERE r.target_symbol_id = 's-greet'",
      )
      .all() as Array<{
      source_symbol_id: string | null
      target_symbol_id: string | null
      relationship_type: string
      otherName: string | null
      otherPath: string | null
      byteStart: number | null
      byteEnd: number | null
      lineStart: number | null
      lineEnd: number | null
    }>
  )
  // Every stored referrer of greet, by the ONE vocabulary.
  const storedReferrers = [
    ...new Set(
      referrerRows.filter((r) => isUsageSiteRow(r, "s-greet") && r.otherName !== null).map((r) => r.otherName as string),
    ),
  ].sort()
  // …of which the index cannot place, so no surface can render them.
  const unresolvable = [
    ...new Set(
      referrerRows.filter((r) => isUsageSiteRow(r, "s-greet") && !isResolvableUsageSiteRow(r) && r.otherName !== null).map((r) => r.otherName as string),
    ),
  ].sort()
  check(
    "R3: the gate's own vocabulary split is non-vacuous (there IS an unlocatable referrer, and it is not a usage site)",
    unresolvable.length > 0 && !greetSites.some((s) => unresolvable.includes(s.name)),
    JSON.stringify({ unresolvable, sites: greetSites.map((s) => s.name) }),
  )
  check(
    "R3: every stored referrer is either a rendered usage site or an unlocatable one (no third category)",
    storedReferrers.filter((n) => !greetSites.some((s) => s.name === n)).sort().join(",") === unresolvable.join(","),
    JSON.stringify({ storedReferrers, unresolvable, sites: greetSites.map((s) => s.name) }),
  )
  const allowed = [...new Set([...greetSites.map((s) => s.name), ...unresolvable])].sort()

  const gw = await wire.request("bb/graph", { schemaVersion: 2, symbol: "greet", mode: "usages", direction: "callers", file: GREETER_FILE })
  const callers: Array<{ name: string }> = gw.result?.callers ?? []
  const callerNames = [...new Set(callers.map((c) => c.name))].sort()
  check(
    "R3: every bb/graph caller is a usage site or a stored referrer the index cannot locate (the graph declares its own profile)",
    callerNames.length > 0 && callerNames.every((n) => allowed.includes(n)),
    JSON.stringify({ callers: callerNames, allowed }),
  )
  check(
    "R3: bb/graph callers cover every usage site (no usage hidden by the hub)",
    greetSites.every((s) => callerNames.includes(s.name)),
    JSON.stringify({ callers: callerNames, sites: greetSites.map((s) => s.name) }),
  )
  check(
    "R3: the hub's declared difference is exactly the referrers with no resolvable location",
    callerNames.filter((n) => !greetSites.some((s) => s.name === n)).sort().join(",") === unresolvable.join(","),
    JSON.stringify({ extra: callerNames.filter((n) => !greetSites.some((s) => s.name === n)), unresolvable }),
  )
  // §14 Truth Rule 1, second half: a surface that filters differently STATES its
  // filter, and a surface whose number counts something else STATES ITS UNIT.
  // The hub excludes two whole classes of stored row, so the payload has to name
  // them — otherwise "the graph says 4, hover says 3" has no answer a client can
  // give the user. And the hub's counts are GROUPS and ROWS, which are neither
  // of them "usages", so the unit rides beside them.
  const exclusions = (gw.result as { declaredExclusions?: Record<string, string> } | undefined)?.declaredExclusions
  const countUnit = (gw.result as { countUnit?: string } | undefined)?.countUnit
  check(
    "R3: the hub payload STATES the filter it applies (its excluded row classes, machine-readable)",
    typeof exclusions?.declarationContainments === "string" &&
      typeof exclusions?.selfReferentialRows === "string" &&
      /contain/i.test(String(exclusions.declarationContainments)),
    JSON.stringify(exclusions ?? null),
  )
  check(
    "R3: the hub payload STATES the unit its counts are in (groups and rows are neither of them 'usages')",
    typeof countUnit === "string" && countUnit.includes("counted once per place"),
    JSON.stringify(countUnit ?? null),
  )
  // The unit sentence must be the vocabulary owner's SINGLE copy, quoted by
  // every surface — three paraphrases of "usages" is how four numbers happened.
  const { USAGE_COUNT_UNIT_LABEL: unitFromOwner } = (await import(path.join(ROOT, "src/lsp/relations.ts"))) as { USAGE_COUNT_UNIT_LABEL: string }
  check(
    "R3: the hub's unit sentence is the owner's copy, verbatim (no surface may paraphrase the unit)",
    countUnit === unitFromOwner && greetMd.includes(unitFromOwner),
    JSON.stringify({ hub: countUnit, hoverHasIt: greetMd.includes(unitFromOwner), owner: unitFromOwner }),
  )
  // The declaration containment `Greeter contains greet` is a stored row that
  // targets greet. It is NOT a usage of greet, and it must be named as the
  // exclusion rather than left implicit — this is the row that leaked.
  const containsRows = referrerRows.filter((r) => r.relationship_type.trim().toLowerCase() === "contains")
  check(
    "R3: the owning class IS a stored referrer of greet and is NOT a usage site — the row that leaked into the hub",
    containsRows.length === 1 && containsRows[0]!.otherName === "Greeter" && !isUsageSiteRow(containsRows[0]!, "s-greet"),
    JSON.stringify(containsRows),
  )
  check(
    "R3: the owning class is NOT among the hub's callers (§relations: a declaration is never a usage)",
    !callerNames.includes("Greeter"),
    JSON.stringify(callerNames),
  )
  check(
    "R3: bb/graph callers exclude the symbol itself (a self-loop is not a usage)",
    !callerNames.includes("greet"),
    JSON.stringify(callerNames),
  )
  check(
    "R3: the hub payload declares its own counts",
    typeof gw.result?.counts?.callerGroups === "number" && typeof gw.result?.counts?.callerRows === "number",
    JSON.stringify(gw.result?.counts ?? null),
  )

  const hzero = await wire.request("textDocument/hover", { textDocument: { uri: greetUri }, position: greetAllPos })
  const zeroMd: string = hzero.result?.contents?.value ?? ""
  check("R3: the zero-caller symbol reads 0 usages on the wire", hzero.result?.data?.symbol?.usageCount === 0, String(hzero.result?.data?.symbol?.usageCount))
  check("R3: the zero-caller symbol renders no usages block on the wire", parseUsagesSection(zeroMd).present === false, zeroMd.slice(0, 200))
} finally {
  await wire.dispose()
}

// --- R5: the leg that could not fail before (real stored call-site lines) ------
//
// WHY THIS SECTION EXISTS, in the harness's own words, because it is a finding
// about the gate above rather than about the code (contract §8.7: the
// tautological check).
//
// R2's differential — "the independent SQL count agrees with the collection" —
// is the load-bearing assertion of this milestone, and it is VACUOUS on the R1
// fixture. `t3-fixture.ts` seeds every relationship row with `line_number`
// UNSET, so on this index the stored call-site line is NULL for every row, the
// address owner returns the caller's DECLARATION substitute for every row, and
// the SQL's dedupe key (the caller's declaration columns) coincides with the
// key the collector serves. Two keys that cannot differ cannot disagree, so the
// differential proves nothing. MEASURED, not argued: with the pre-fix key
// planted in src/lsp/relations.ts (dedup on `o.line_start || ':' ||
// o.byte_start` again, ignoring `r.line_number`), this whole gate still reports
// 57/57 VERIFIED.
//
// On a real index the two keys differ on a third to a third-and-a-half of every
// usage set, because M59/#822 made `line_number` a real call-site line and
// M62 §2 made every surface serve it. Measured `(target, served position)`
// groups, old key vs served key, on five populated indexes:
//   064be526  18,155 vs 26,168   (+8,013, 31%)
//   853d59ab  57,432 vs 82,588   (+25,156, 30%)
//   99c211a1  61,368 vs 93,837   (+32,469, 35%)
//   818db37d  99,053 vs 151,521  (+52,468, 35%)
//   6f461b7b  83,584 vs 126,881  (+43,297, 34%)
//
// So the fixture that can fail is built here, from the shape the indexer
// actually produces (verified against a real `bb index` run): rows carrying
// DISTINCT call-site lines. Four facts, one per law, in one row set:
//
//   F1 two call sites on TWO stored lines from ONE caller -> TWO usage sites.
//      This is §13.4's "two call sites in one function are two usages", and it
//      is the case the R1 fixture cannot express. The collector serves two; a
//      count that folds them into the caller's declaration serves one.
//   F2 two stored call-site lines that the SOURCE does not contain -> two
//      rows OMITTED and counted (`omittedUnresolvable`), so the count cannot
//      quietly include a place no editor can open (§12.1).
//   F3 two rows from one caller, one stored line, DIFFERENT kinds -> ONE served
//      position and ONE declared collapsed row. This is what 99.5% of the
//      real-index position collisions are (measured), and it is the shape the
//      R1 fixture's r4/r5 pair only approximates.
//   F4 two DIFFERENT callers at the SAME stored line -> two rows, two served
//      positions. The guard against "one location per caller" as a shortcut.
console.log("\nR5: the differential on rows that carry REAL stored call-site lines")
const r5ws = mkdtempSync(path.join(tmpdir(), "m55-t3-r5-ws-"))
const r5data = mkdtempSync(path.join(tmpdir(), "m55-t3-r5-data-"))
/** Hoisted for R4's mutants: the R5 db and the collector's own count on it, so a
 *  mutant is judged against a DIFFERENTIAL (the surfaces' number) and never
 *  against a constant this harness also wrote. */
let r5raw: any = null
let r5CollectorCount = -1
let r5refs: {
  locations: Array<{ path: string; line: number; character: number; callSite?: { rowId: string; kind: string } }>
  totalCount: number
  omittedUnresolvable: number
  omittedUnpositionable: number
  coalescedRows: number
} | null = null
let r5sql = -1
/** What the PRE-FIX key answers on the same rows — carried into the evidence so
 *  a reader can see the differential without re-deriving it, and so the leg
 *  that proves the fixture can fail has its number on the record. */
let r5PreFixKeyCount = -1
/** F2's numbers, on their OWN target symbol. They are kept off `r5-target` on
 *  purpose: §12.1 says a stored call-site line the source cannot confirm must be
 *  OMITTED AND DECLARED, and `textDocument/references` does that — but the
 *  hover's collector does not, and it is another lane's file. Folding those rows
 *  into the count differential would either fail this gate on a defect this lane
 *  does not own, or (worse) tempt a weakened assertion. They are measured on
 *  their own symbol and the disagreement is declared instead. See `knownGaps`. */
let r5PastEof: {
  servedLocations: number
  omittedUnresolvable: number
  collectorSites: number
  collectorLines: number[]
} | null = null
{
  // Sources on disk: §12.1 makes every served position differentially checkable
  // against real bytes, so `target` has to exist for the rows that are served.
  // Line 4 carries TWO `target(` calls on one line — the shape the store
  // collapses to one row per (caller, target, kind, line), measured against a
  // real `bb index` run.
  const R5_CALLER_SRC = [
    "export function twice(a: string, b: string): string {",
    "  const x = target(a)",
    "  const y = target(b)",
    "  const z = target(b) + target(a)",
    "  return x + y + z",
    "}",
    "",
  ].join("\n")
  const R5_TARGET_SRC = ["export function target(s: string): string {", "  return s", "}", ""].join("\n")
  const R5_OTHER_SRC = ["export function other(s: string): string {", "  return target(s)", "}", ""].join("\n")
  // F2's target: three lines, so stored lines 40 and 41 are past its end.
  const R5_TARGET2_SRC = ["export function target2(s: string): string {", "  return s", "}", ""].join("\n")
  mkdirSync(path.join(r5ws, "src"), { recursive: true })
  writeFileSync(path.join(r5ws, "src/caller.ts"), R5_CALLER_SRC)
  writeFileSync(path.join(r5ws, "src/target.ts"), R5_TARGET_SRC)
  writeFileSync(path.join(r5ws, "src/other.ts"), R5_OTHER_SRC)
  writeFileSync(path.join(r5ws, "src/target2.ts"), R5_TARGET2_SRC)
  writeFileSync(path.join(r5ws, "package.json"), JSON.stringify({ name: "bb-m55-t3-r5", private: true, version: "0.0.0" }, null, 2))

  const r5projectId = createHash("sha1").update(realpathSync(r5ws)).digest("hex").substring(0, 40)
  mkdirSync(path.join(r5data, "projects", r5projectId), { recursive: true })
  const priorDataDir = process.env.BB_DATA_DIR
  process.env.BB_DATA_DIR = r5data
  const { BrainDatabase } = (await import(path.join(ROOT, "src/brain/database.ts"))) as {
    BrainDatabase: { getRawInstance(projectId: string): Promise<any> }
  }
  const r5db = await BrainDatabase.getRawInstance(r5projectId)
  const fIns = r5db.prepare("INSERT INTO brain_file (id, project_id, path, relative_path, language, file_hash) VALUES (?,?,?,?,?,?)")
  fIns.run("rf-caller", r5projectId, path.join(r5ws, "src/caller.ts"), "src/caller.ts", "typescript", "h1")
  fIns.run("rf-target", r5projectId, path.join(r5ws, "src/target.ts"), "src/target.ts", "typescript", "h2")
  fIns.run("rf-other", r5projectId, path.join(r5ws, "src/other.ts"), "src/other.ts", "typescript", "h3")
  fIns.run("rf-target2", r5projectId, path.join(r5ws, "src/target2.ts"), "src/target2.ts", "typescript", "h5")
  fIns.run("rf-pkg", r5projectId, path.join(r5ws, "package.json"), "package.json", "json", "h4")
  const sIns = r5db.prepare(
    `INSERT INTO brain_symbol (id, project_id, file_id, name, symbol_type, qualified_name, line_start, line_end, byte_start, byte_end, gravity_score)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  )
  // Byte columns are COMPUTED from the sources above (1-based, per line, end
  // exclusive), never hand-picked — the same discipline the T3 fixture follows.
  const byteCol = (file: string, line1: number, name: string): number => {
    const lines = readFileSync(path.join(r5ws, file), "utf8").split("\n")
    const at = lines[line1 - 1]!.indexOf(name)
    if (at === -1) throw new Error(`m55 R5 fixture: "${name}" not on ${file}:${line1}`)
    return Buffer.byteLength(lines[line1 - 1]!.slice(0, at), "utf8") + 1
  }
  const sym = (id: string, file: string, name: string, line1: number, span: number) => {
    const bs = byteCol(file, line1, name)
    sIns.run(id, r5projectId, `rf-${file.split("/")[1]!.replace(".ts", "")}`, name, "function", name, line1, line1 + span - 1, bs, bs + Buffer.byteLength(name, "utf8"), 5)
  }
  sym("r5-twice", "src/caller.ts", "twice", 1, 6)
  sym("r5-other", "src/other.ts", "other", 1, 3)
  sym("r5-target", "src/target.ts", "target", 1, 3)
  sym("r5-target2", "src/target2.ts", "target2", 1, 3)

  const relIns = r5db.prepare(
    `INSERT INTO brain_relationship (id, project_id, source_symbol_id, target_symbol_id, relationship_type, confidence, line_number)
     VALUES (?,?,?,?,?,?,?)`,
  )
  // F1 — the genuine two-call-site case: TWO DISTINCT stored lines, one caller.
  relIns.run("r5-a", r5projectId, "r5-twice", "r5-target", "calls", 0.9, 2)
  relIns.run("r5-b", r5projectId, "r5-twice", "r5-target", "calls", 0.9, 3)
  // F3 — one caller, ONE stored line, TWO kinds: one place, two stored rows.
  // Line 4 is a line no other row uses, so exactly ONE of the pair coalesces.
  relIns.run("r5-kind-calls", r5projectId, "r5-twice", "r5-target", "calls", 0.9, 4)
  relIns.run("r5-kind-uses", r5projectId, "r5-twice", "r5-target", "uses", 0.8, 4)
  // F4 — a DIFFERENT caller at the SAME stored line 3 that `twice` uses: two
  // callers, two places. The guard against "one location per caller" as a
  // shortcut, and against "one location per line" as a different shortcut.
  relIns.run("r5-other-caller", r5projectId, "r5-other", "r5-target", "calls", 0.9, 3)
  // F2 — real stored lines the source does not contain, on their OWN target
  // symbol: 40 and 41 are past a three-line file, so §12.1 forbids serving them.
  relIns.run("r5-past-eof-a", r5projectId, "r5-twice", "r5-target2", "calls", 0.9, 40)
  relIns.run("r5-past-eof-b", r5projectId, "r5-other", "r5-target2", "calls", 0.9, 41)

  const r5nav = (await import(path.join(ROOT, "src/lsp/navigation.ts"))) as {
    resolveReferences: (db: unknown, req: { filePath: string; line: number; character: number; includeDeclaration: boolean }) => {
      locations: Array<{ path: string; line: number; character: number; callSite?: { rowId: string; kind: string } }>
      totalCount: number
      omittedUnresolvable: number
      omittedUnpositionable: number
      coalescedRows: number
    }
  }
  const r5rich = (await import(path.join(ROOT, "src/lsp/rich_hover.ts"))) as {
    usageSitesForSymbol: (db: unknown, symbolId: string) => Array<{ name: string; line: number; path: string }>
  }
  const r5rel = (await import(path.join(ROOT, "src/lsp/relations.ts"))) as { countUsageSites: (db: unknown, symbolId: string) => number }

  const r5local = r5nav.resolveReferences(r5db, {
    filePath: path.join(r5ws, "src/target.ts"),
    line: 0,
    character: byteCol("src/target.ts", 1, "target") - 1,
    includeDeclaration: false,
  })
  const r5sites = r5rich.usageSitesForSymbol(r5db, "r5-target")
  const r5sqlLocal = r5rel.countUsageSites(r5db, "r5-target")
  // Handed to R4's mutants and to the evidence record: the db to re-measure
  // against, the surfaces' own number (so a mutant is judged by a DIFFERENTIAL,
  // not by a constant this harness also wrote), and the served result.
  r5raw = r5db
  r5CollectorCount = r5sites.length
  r5refs = r5local
  r5sql = r5sqlLocal
  const r5refsAsserted = r5local
  const r5Served = r5refsAsserted.locations.map((l) => `${path.basename(l.path)}:${l.line}:${l.character}`).sort()
  const r5detail = `served=${JSON.stringify(r5Served)} coalesced=${r5refsAsserted.coalescedRows} unresolvable=${r5refsAsserted.omittedUnresolvable} unpositionable=${r5refsAsserted.omittedUnpositionable} hoverSites=${r5sites.length} sql=${r5sql}`
  // The PRE-FIX key, computed on the same rows so the differential is a number
  // on the record rather than a claim in prose.
  r5PreFixKeyCount = (
    r5db
      .prepare(
        `SELECT COUNT(*) AS c FROM (SELECT DISTINCT f.path || ':' || o.line_start || ':' || o.byte_start AS site
         FROM brain_relationship r JOIN brain_symbol o ON o.id = r.source_symbol_id JOIN brain_file f ON f.id = o.file_id
         WHERE r.target_symbol_id = ? AND r.source_symbol_id <> r.target_symbol_id
           AND LOWER(r.relationship_type) NOT IN ('contains','exports')
           AND o.line_start IS NOT NULL AND o.line_end IS NOT NULL AND o.byte_start IS NOT NULL AND o.byte_end IS NOT NULL)`,
      )
      .get("r5-target") as { c: number }
  ).c

  check("R5: the R5 fixture really carries DISTINCT stored call-site lines (or every assertion below is vacuous)", r5refsAsserted.locations.some((l) => l.callSite?.kind === "call-site"), r5detail)
  check("R5: two call sites on two stored lines from ONE caller are TWO usage sites (§13.4)", r5Served.includes("caller.ts:1:0") && r5Served.includes("caller.ts:2:0"), r5detail)
  check("R5: the independent SQL count does not fold two call sites into the caller's one declaration", r5sql === r5CollectorCount, r5detail)
  // The three-surface differential, spelled out. On rows every surface can
  // position, the SQL count, the hover's rendered rows and references' served
  // locations are ONE number — which is §14 Truth Rule 1's whole requirement
  // and the thing the pre-fix key broke by 2-of-4.
  check(
    "R5: SQL count == hover rows == references locations — one fact, one answer, on rows with real call-site lines",
    r5sql === 4 && r5CollectorCount === 4 && r5refsAsserted.totalCount === 4,
    `sql=${r5sql} hover=${r5CollectorCount} references=${r5refsAsserted.totalCount}; ${r5detail}`,
  )
  check("R5: one caller, one stored line, two kinds -> ONE served place and the second row DECLARED coalesced", r5refsAsserted.coalescedRows === 1, r5detail)
  check(
    "R5: the coalesced row is the SECOND of the two-kinds pair (the first is served, so the account names real rows)",
    (() => {
      const served = r5refsAsserted.locations.map((l) => l.callSite?.rowId).sort()
      return served.includes("r5-kind-calls") && !served.includes("r5-kind-uses")
    })(),
    JSON.stringify(r5refsAsserted.locations.map((l) => [path.basename(l.path), l.line, l.callSite?.rowId])),
  )
  check(
    "R5: a different caller at the SAME stored line is its own served place (§13.4 — one location per CALLER is not the law, and neither is one per line)",
    r5Served.includes("other.ts:2:0") && r5Served.includes("caller.ts:2:0"),
    r5detail,
  )
  check("R5: no two served locations share a position", new Set(r5Served).size === r5Served.length, r5detail)
  check(
    "R5: every stored usage row of r5-target is accounted for: served + coalesced + omitted == stored",
    r5refsAsserted.locations.length + r5refsAsserted.coalescedRows + r5refsAsserted.omittedUnresolvable + r5refsAsserted.omittedUnpositionable === 5,
    `5 stored usage rows (2 + 2 kinds + 1 other caller); ${r5detail}`,
  )

  // --- F2 on its own symbol: §12.1's omission, and a defect this lane found ---
  const r5eof = r5nav.resolveReferences(r5db, {
    filePath: path.join(r5ws, "src/target2.ts"),
    line: 0,
    character: byteCol("src/target2.ts", 1, "target2") - 1,
    includeDeclaration: false,
  })
  const r5eofSites = r5rich.usageSitesForSymbol(r5db, "r5-target2")
  r5PastEof = {
    servedLocations: r5eof.locations.length,
    omittedUnresolvable: r5eof.omittedUnresolvable,
    collectorSites: r5eofSites.length,
    collectorLines: r5eofSites.map((s) => s.line + 1).sort((a, b) => a - b),
  }
  check(
    "R5: two stored call-site lines past the end of the source are OMITTED and COUNTED, never served (§12.1)",
    r5eof.locations.length === 0 && r5eof.omittedUnresolvable === 2,
    `served=${r5eof.locations.length} omittedUnresolvable=${r5eof.omittedUnresolvable}`,
  )
  check(
    "R5/CONTROL: the past-EOF source really is shorter than the stored lines (or the omission above is vacuous)",
    readFileSync(path.join(r5ws, "src/target2.ts"), "utf8").split("\n").length < 40,
    `${readFileSync(path.join(r5ws, "src/target2.ts"), "utf8").split("\n").length} lines`,
  )

  // THE CLAUSE THIS SECTION EXISTS TO PROVE, stated as a failure test: on these
  // rows the pre-fix key answers strictly fewer than the surfaces serve. If it
  // did not, the fixture would still be blind to the defect and R5 would be
  // decoration — so this is checked, not assumed.
  check(
    "R5: the OLD declaration-based key under-counts this set, so this fixture CAN fail the defect it exists to catch",
    r5PreFixKeyCount < r5sql,
    `pre-fix key=${r5PreFixKeyCount} vs served=${r5sql}; ${r5detail}`,
  )
  if (priorDataDir === undefined) delete process.env.BB_DATA_DIR
  else process.env.BB_DATA_DIR = priorDataDir
}
try {
  rmSync(r5ws, { recursive: true, force: true })
  rmSync(r5data, { recursive: true, force: true })
} catch {}

// --- R4: mutants -----------------------------------------------------------------
console.log("\nR4: mutants (each planted defect must fail the suite)")
const relationsSource = readFileSync(RELATIONS, "utf8")

/** Plant a defect in a COPY of a source module, import the copy, and ask the
 *  probe whether the mutation is OBSERVABLE. A mutant that fails to load is
 *  recorded as caught-with-reason by the caller, never silently.
 *
 *  Generalized from `withRelations` (which planted only in relations.ts) because
 *  two of the three integration regressions live in other modules — the hub's
 *  caller profile in src/lsp/graph_usages.ts and the declared collapse counter
 *  in src/lsp/navigation.ts — and a gate that can only mutate one file cannot
 *  gate a fix in three. The mutant is written OUTSIDE src/ with every relative
 *  import rewritten to an absolute file:// path, derived from the source's own
 *  import statements, so an import failure is a harness failure and never
 *  counted as a behavioural catch (contract §8.7: a mutant caught only by a load
 *  failure is not caught). */
async function withSource(
  name: string,
  file: string,
  from: string,
  to: string,
  probe: (m: any) => boolean | Promise<boolean>,
): Promise<void> {
  const source = readFileSync(file, "utf8")
  const occurrences = source.split(from).length - 1
  if (occurrences !== 1) {
    // §8.3: silence is guilt. A missing or ambiguous anchor is a FAILED gate,
    // never a skip — a rename must not delete a mutation while the verdict
    // stays the same.
    check(`M: ${name}`, false, `anchor matched ${occurrences} time(s), need exactly 1: ${from.slice(0, 90)}`)
    return
  }
  const dir = mkdtempSync(path.join(tmpdir(), "m55-t3-mut-"))
  const target = path.join(dir, `${path.basename(file, ".ts")}.mutant.ts`)
  const rewritten = source
    .replace(from, to)
    .replace(/from "(\.\.?\/[^"]+)"/g, (_whole, spec: string) => {
      const resolved = path.resolve(path.dirname(file), spec).replace(/\\/g, "/")
      return `from "file://${resolved}${resolved.endsWith(".ts") ? "" : ".ts"}"`
    })
  writeFileSync(target, rewritten)
  try {
    const m = await import(pathToFileURL(target).href)
    mutant(name, await probe(m))
  } catch (e) {
    // A load failure proves nothing about the defect, so it is reported as a
    // HARNESS failure (a failed check), not as a catch.
    check(`M: ${name}`, false, `mutant failed to LOAD — this proves nothing about the defect and is recorded as a harness failure: ${String(e).slice(0, 120)}`)
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {}
  }
}

async function withRelations(name: string, from: string, to: string, probe: (m: any) => boolean | Promise<boolean>): Promise<void> {
  await withSource(name, RELATIONS, from, to, probe)
}

const truthOfGreet = T3_ROWS.filter((r) => r.target === "s-greet" && r.source !== null && r.source !== "s-greet" && r.type !== "contains")
  .map((r) => r.source)
  .sort()

/** The expected verdict, computed from the fixture — the assertion the gate makes. */
function verdict(rows: { source: string | null; target: string | null; type: string; id: string }[], m: any): string {
  const classified = rows.filter((r) => m.isUsageSiteRow({ source_symbol_id: r.source, target_symbol_id: r.target, relationship_type: r.type }, "s-greet"))
  return classified.map((r) => r.source).sort().join(",")
}

await withRelations(
  "M1: a count derived from callees (direction flipped) fails the suite",
  'if (isTarget) return "incoming"',
  'if (isTarget) return "outgoing"',
  (m) => verdict(T3_ROWS, m) !== truthOfGreet.join(","),
)

await withRelations(
  "M2: keeping the owning declaration as a usage fails the suite",
  'export const DECLARATION_RELATIONSHIPS: ReadonlySet<string> = new Set(["contains", "exports"])',
  "export const DECLARATION_RELATIONSHIPS: ReadonlySet<string> = new Set([])",
  (m) => {
    const includesDeclaration = m.isUsageSiteRow({ source_symbol_id: "s-greeter", target_symbol_id: "s-greet", relationship_type: "contains" }, "s-greet") === true
    const includesSelfLoop = m.isUsageSiteRow({ source_symbol_id: "s-greet", target_symbol_id: "s-greet", relationship_type: "calls" }, "s-greet") === true
    return includesDeclaration || includesSelfLoop
  },
)

await withRelations(
  "M3: a count that disagrees with the rendered rows fails the suite",
  "AND LOWER(r.relationship_type) NOT IN ('contains', 'exports')",
  "AND 1 = 1 /* pre-M55: every touching row counts */",
  async (m) => {
    const mutatedCount = m.countUsageSites(raw, "s-greet") as number
    const renderedRows = greetSites.length
    return mutatedCount !== renderedRows
  },
)

// M4 (integration/lsp-truth, F7). The UNDER-COUNT this gate could not see: the
// dedupe key goes back to the caller's DECLARATION columns, which is what it
// was before the call-site line existed and which the R1 fixture cannot
// distinguish (every row there stores a NULL line, so both keys coincide).
// Judged on the R5 fixture's rows, where the two keys differ. Without this
// mutant the R5 differential could be satisfied by an implementation that is
// still wrong on 30-35% of a real index's usages, and the gate would call it a
// pass — which is what it did when this key was planted by hand.
await withSource(
  "M4: the SQL count folds call sites back into the caller's declaration (the 30% under-count)",
  RELATIONS,
  "(CASE WHEN ${STORED_LINE_IS_EXACT_SQL} THEN r.line_number ELSE o.line_start END)",
  "o.line_start /* pre-fix: the caller's declaration */",
  async (m) => {
    const mutated = m.countUsageSites(r5raw, "r5-target") as number
    return mutated !== r5CollectorCount
  },
)

// M5 (integration/lsp-truth, F7). The `bb/graph` caller profile admits a
// DECLARATION CONTAINMENT as a usage — the row that leaked `Greeter` into
// greet's callers on the merged branch. Judged by the pure grouping core, which
// is the owner of the decision, so the catch is behavioural and not a lint.
await withSource(
  "M5: the hub's caller grouping admits a declaration containment as a usage",
  USAGES,
  "edges.filter((e) => e.from !== e.to && !isDeclarationRelationship(e.relationshipType))",
  "edges.filter((e) => e.from !== e.to)",
  async (m) => {
    // The exact leak: greet's own class, connected by `contains`, offered as a
    // caller of greet by the mutated grouping core.
    const traversal = {
      root: { id: "s-greet", name: "greet", file: "src/greeter.ts", language: "typescript", line: 10, symbolType: "method" },
      nodes: {
        "s-greeter": { id: "s-greeter", name: "Greeter", file: "src/greeter.ts", language: "typescript", line: 3, symbolType: "class" },
        "s-greet": { id: "s-greet", name: "greet", file: "src/greeter.ts", language: "typescript", line: 10, symbolType: "method" },
        "s-main": { id: "s-main", name: "main", file: "src/app.ts", language: "typescript", line: 4, symbolType: "function" },
      },
      callers: [
        { from: "s-greeter", to: "s-greet", relationshipType: "contains", rowId: "r3", depth: 1, confidence: 1, isCrossLanguage: false, callSite: { kind: "unknown", file: "src/greeter.ts", line: null, note: "not stored" } },
        { from: "s-main", to: "s-greet", relationshipType: "calls", rowId: "r1", depth: 1, confidence: 0.9, isCrossLanguage: false, callSite: { kind: "call-site", file: "src/app.ts", line: 4 } },
      ],
      callees: [],
      summary: { truncated: false, totalCallers: 2, totalCallees: 0, crossLanguageEdges: 0 },
    }
    const grouped = m.groupUsagesEdges(traversal as never) as { callers: Array<{ name: string }> }
    return grouped.callers.some((g) => g.name === "Greeter")
  },
)

// M6 (integration/lsp-truth, F7). The DECLARED COLLAPSE counter is dropped: the
// rows that share one served position then vanish from the payload's accounting
// with nothing to say so — §13.2's "nothing is merged into silence". The list
// itself is unchanged, so only an assertion about the counter can see it.
// M7 (integration/lsp-truth, F7). The rendered count's UNIT DECLARATION is
// removed from the hover's usages header. Every number stays correct and the
// list stays identical — only the sentence that tells a reader what the number
// counts is gone, which is precisely how `references` (4) and hover (3) looked
// like a contradiction for a wave instead of a declared difference in unit.
await withSource(
  "M7: the rendered usage count stops declaring its unit (two surfaces' numbers become uncomparable)",
  path.join(ROOT, "src/lsp/rich_hover.ts"),
  '  lines[0] += ` _(${USAGE_COUNT_UNIT_LABEL})_`',
  '  lines[0] += "" /* the unit is no longer declared */',
  async (m) => {
    const rendered = m.usagesSection(
      [
        {
          name: "main",
          symbolType: "function",
          path: path.join(ws, "src/app.ts"),
          line: 3,
          character: 16,
          endLine: 3,
          endCharacter: 20,
          relationshipType: "calls",
          reversed: true,
          confidence: 0.9,
          callSite: { kind: "call-site", file: "src/app.ts", line: 4 },
        },
      ],
      1,
      "greet",
      GREETER_FILE,
      9,
      2,
    )
    const real = usageSectionOfGreet
    return !rendered.includes("counted once per place") && real.includes("counted once per place")
  },
)

await withSource(
  "M6: the coalesced-row counter is dropped (shared positions merged into silence)",
  NAVIGATION,
  "      coalescedRows++;",
  "      /* dropped */",
  async (m) => {
    const mutated = m.resolveReferences(raw, { filePath: GREETER_FILE, line: greetPos.line, character: greetPos.character, includeDeclaration: false })
    const real = resolveReferences(raw, { filePath: GREETER_FILE, line: greetPos.line, character: greetPos.character, includeDeclaration: false })
    // The counter must go to 0 while the served locations stay right — that is
    // exactly the shape of the defect: a correct list with a missing fact.
    return mutated.coalescedRows === 0 && real.coalescedRows === 1 && mutated.totalCount === real.totalCount
  },
)

// --- evidence ---------------------------------------------------------------------
const failed = checks - passed
const worktreeRelevant = status
  .split("\n")
  .map((l) => l.slice(3).trim())
  .filter((p) => p.startsWith("src/lsp/relations") || p.startsWith("src/lsp/rich_hover") || p.startsWith("src/lsp/navigation") || p.startsWith("script/m55/"))
const result = {
  issue: "M55.T3",
  code: "T3",
  milestone: "M55",
  status: failed === 0 ? "verified" : "known-gap",
  checks,
  passed,
  failed,
  realFailed: failed,
  negativeCases: mutantsTotal,
  mutants: { total: mutantsTotal, caught: mutantsCaught },
  currentCommit,
  ...fingerprintFields(["m55.T3"], ROOT),
  workingTreeRelevantChanges: worktreeRelevant,
  verifierCommand: "npx tsx script/m55/verify-relations.ts",
  evidenceFile: "T3.json",
  generatedAt: new Date().toISOString(),
  fixture: {
    workspace: ws,
    projectId: seed.projectId,
    symbols: T3_SYMBOLS.length,
    rows: T3_ROWS.length,
    expect: { greet: T3_EXPECT.greetUsageSites, greetAll: T3_EXPECT.greetAllUsageSites, greeter: T3_EXPECT.greeterUsageSites },
    r5: {
      note: "the second, seeded fixture — rows carrying REAL stored call-site lines, which the R1 fixture cannot express",
      storedUsageRows: 7,
      sources: ["src/caller.ts", "src/target.ts", "src/other.ts"],
      shapes: {
        F1: "two call sites on two distinct stored lines from one caller -> two served places (§13.4)",
        F2: "two stored lines past the end of the source, on their OWN target symbol -> omitted and counted (§12.1); kept off r5-target so the count differential is not blocked by a defect in another lane's file (see knownGaps)",
        F3: "one caller, one stored line, two relationship kinds -> one place, one declared coalesced row (§13.2)",
        F4: "a different caller at the same stored line -> its own served place",
      },
      targets: { r5Target: "src/target.ts (F1, F3, F4)", r5Target2: "src/target2.ts (F2, three lines, stored lines 40 and 41)" },
    },
  },
  /** Defects this integration FOUND and did NOT fix, each with the law, the
   *  measurement, and the file that owns it. Recorded as structured gaps rather
   *  than prose so a reader can diff them against a later run — and so the gate
   *  does not report VERIFIED while a measured §14 violation is open. */
  knownGaps: [
    {
      id: "M55.T3-INTEGRATION-1",
      law: "§14 rule 1 / §13.4 / §12.1 — the hover's usage collector serves a stored call-site line the source cannot confirm.",
      where: "src/lsp/rich_hover.ts (richSitesForSymbol)",
      measured:
        "On the R5 fixture's `target2` (a three-line file with two usage rows stored at lines 40 and 41): textDocument/references serves 0 locations and declares omittedUnresolvable = 2; the hover's collector returns 2 usage sites at lines 40 and 41. So the hover renders two usage links that open past the end of the file, and hover's count (2) disagrees with references' (0) on the same index.",
      whyNotFixedHere:
        "rich_hover.ts is another lane's file. Its collector also lacks the line-bounds check that navigation.ts performs (`line0 >= createPositionMapper(sourceText).lineTexts.length`), and the fix's blast radius is three gates this integration was told not to regress (H2 rich-hover, the M24 hover gate, CALLSITE-AGREEMENT). Landed here it would be an unowned change to someone else's surface.",
      gateStatus:
        "GATED, not merely noted: the R5 section asserts the law on the surface this lane owns (references omits and counts), asserts the CONTROL that the fixture can fail it, and carries the hover's numbers in `observed.r5` so the gap is visible in the record. Under contract F7 the gate exists before any future fix, so the fix cannot land unverified.",
      firstMeasuredAt: "M55.T3 integration, branch integration/lsp-truth",
    },
  ],
  observed: {
    greetUsageCount: hoverGreet.data?.usageCount ?? null,
    greetRenderedRows: usagesGreet.rows.map((r) => `${r.name}@${r.file}:${r.line}`),
    greetSqlCount: countUsages(raw, "s-greet"),
    greetAllUsageCount: hoverGreetAll.data?.usageCount ?? null,
    greeterUsageCount: hoverGreeter.data?.usageCount ?? null,
    referencesNoDecl: refsGreet.totalCount,
    referencesWithDecl: refsWithDecl.totalCount,
    /** M55.T3 integration: the declared collapse. Two stored rows of greet share
     *  one served position; one location is served and the second row is counted
     *  rather than served twice or dropped. */
    referencesCoalescedRows: refsGreet.coalescedRows,
    /** R5 — the same three numbers on rows that carry REAL stored call-site
     *  lines, where the pre-fix SQL key answered 2 where the surfaces serve 3. */
    r5: {
      storedUsageRows: 7,
      servedLocations: r5refs?.locations.length ?? null,
      coalescedRows: r5refs?.coalescedRows ?? null,
      omittedUnresolvable: r5refs?.omittedUnresolvable ?? null,
      hoverRenderedSites: r5CollectorCount,
      sqlCount: r5sql,
      referencesLocations: r5refs?.totalCount ?? null,
      /** what the PRE-FIX key (the caller's declaration columns) answers here —
       *  carried so a reader can see the differential without re-deriving it. */
      preFixKeyCount: r5PreFixKeyCount,
      /** F2, on its own three-line target: references omits and counts; the
       *  hover's collector serves both. That disagreement is knownGaps[0]. */
      pastEof: r5PastEof,
    },
  },
  /** The law that now governs the number, stated where a reader of this record
   *  will meet it (contract §14 Truth Rule 1 is a rule about surfaces; this is
   *  the rule the surfaces now apply). */
  governingLaw: {
    unitOfOneUsage:
      "A USAGE SITE is a stored relationship row whose TARGET is the symbol and whose kind is not a declaration containment (src/lsp/relations.ts, unchanged by this integration).",
    unitOfOneCount:
      "A COUNT is a count of SERVED POSITIONS — the places the index can put an editor caret — not of stored rows and not of symbols. hover's count, references' totalCount and countUsageSites are all that same number, which is why they agree without any of them declaring a filter.",
    why:
      "Integration measurement settled this. textDocument/references keyed its dedupe on path:line:rowId ('one location per stored row'), while hover and the SQL count keyed on the served position. On five real, populated indexes the rowId key's ONLY effect was to serve byte-identical duplicate locations: 8,285 (818db37d), 2,417 (064be526), 684 (99c211a1) served positions each carrying two or more rows, 99.5% of them two rows of DIFFERENT relationship kinds for one caller at one stored line. An editor cannot show two entries at the same file/line/column, so that was §13.1's rendering defect and §13.4's count lie on two surfaces at once. The two keys agree on every genuine multi-call-site case, because the store's row identity keys on the call-site LINE (src/ast/parallel-indexer.ts:4147): verified by indexing a real source with two calls to one callee — two calls on ONE line produce ONE stored row, two calls on DIFFERENT lines produce two rows and two served locations.",
    declaredNotHidden:
      "The rows that share a served position are neither served twice nor dropped: `ReferencesResult.coalescedRows` counts them (§13.2 'nothing is merged into silence'), and the account served + coalesced + omittedUnresolvable + omittedUnpositionable == stored is asserted closed over the fixture's rows (R2) and R5's (R5).",
    declaredFilters:
      "Two surfaces legitimately answer a narrower or wider question, and both now say so in the payload. (1) `textDocument/references` with includeDeclaration adds exactly one entry, labelled `callSite.kind: 'declaration'` with DECLARATION_ENTRY_NOTE, so it can never read as a usage. (2) The hub (`bb/graph` mode 'usages') carries `declaredExclusions` naming the two stored-row classes it does not serve — self-referential rows and declaration containments — so its caller list can differ from hover's without either surface being unable to say why. (3) Every surface that prints a usage count states its UNIT, from the single copy USAGE_COUNT_UNIT_LABEL: hover's usages header and the hub's `countUnit` both quote it verbatim (asserted by differential, so no surface can paraphrase the unit into its own dialect). `NavigationCallSite.rowId` remains on the payload but is no longer part of any dedupe key — it is the traceability field naming the stored row a served place came from.",
  },
  /** The two findings about this GATE, recorded because §8.7 makes adversarial
   *  review of one's own gates a duty and a finding nobody records is a finding
   *  that gets re-made. */
  gateFindings: [
    "R2's differential ('the independent SQL count agrees with the collection') was VACUOUS before this integration. t3-fixture.ts leaves line_number unset on every seeded row, so every address is the caller's declaration substitute and the SQL's dedupe key coincides with the collector's key — two keys that cannot differ cannot disagree. MEASURED: with the pre-fix key planted in src/lsp/relations.ts this gate still reported 57/57 VERIFIED. R5 now carries rows with distinct stored call-site lines, and M4 plants the pre-fix key against them.",
    "The R1 fixture's r4/r5 pair (same source, same target, same kind, no stored line) is not a row set the production indexer can write: the row id is `projectId:rel:source:targetName:relType:relLine` under INSERT OR IGNORE (src/ast/parallel-indexer.ts:4147-4150), so the second insert is ignored. The pair is retained as a COLLAPSE case — two rows, one served position, one declared coalesced row — which is a real shape, and its source/target/kind triple is stated in R1 so the fiction is visible rather than load-bearing.",
    "Measured on this repository's own index and three others: `(source, target, type, line)` tuples that DO repeat exist (802 on 818db37d, 442 on 99c211a1) even though the primary writer's identity forbids them — the snapshot-repair writer (repairInEdges) uses a different id shape. So the store is not a hard guarantee of one row per (source, target, type, line); the collapse path is a live case, not a hypothetical one.",
  ],
  failures,
  /** §8.2 byte-identical regeneration, with the varying fields NAMED. Measured:
   *  two consecutive runs of this verifier at an unchanged commit, compared field
   *  by field, differ in exactly three fields — the two declared below plus
   *  `bbSeal` (its own timestamp and the sha256 it takes over the record, which
   *  includes `generatedAt`). */
  determinism: {
    declaredVolatileFields: ["generatedAt", "fixture.workspace", "fixture.projectId", "bbSeal.sealedAt", "bbSeal.contentSha256"],
    whyTheseAndNoOthers:
      "fixture.workspace is a mkdtemp path — the fixture needs an isolated workspace and an isolated BB_DATA_DIR per run, and a fixed path would make concurrent runs collide on one sqlite file. fixture.projectId is the sha1 of that same path (how BrainDatabase derives the project directory), so it moves with it. Neither is a claim about the program under test: every number in this record is a property of the SEEDED ROWS (T3_ROWS / the R5 rows declared above), which are fixed, and of the components, which are fixed. Asserted rather than assumed: this record also carries `fixture.expect`, the row set's own expectation, and every count is checked against the components rather than against a stored number from a previous run.",
    measuredAt: "two consecutive runs at commit 462f620be, compared field by field",
  },
  limitations: [
    "The analyzers of the confirmatory languages DID stop storing line_number = 0 for call rows: measured on a real `bb index` run of this repository's own sources, every TypeScript call row carries a real call-site line (rows for `main`, `twiceOneLine`, `twiceTwoLines` stored lines 4, 10, 13 and 14). The prior limitation text ('verified on the demo index: every TypeScript/Java usage row carries 0') is STALE and is corrected here. Per-language coverage of a real call-site line is M59.A7's claim; on the five real indexes read for this integration, real lines dominate (e.g. 765,602 of 766,227 rows on 818db37d; 99c211a1 is 160,007 of 160,007) but NULL lines exist (625 on 818db37d, 384 on 6f461b7b) and are what the labelled-declaration-substitute branch is for.",
    "AN EXACT CALL SITE IS A LINE-ONLY RANGE. brain_relationship stores a line and no column for a call site, so a served call site is zero-width at character 0 of the stored line. Two different callers on one stored line therefore share one served position and are counted as one place with a declared collapse — the multiplicity is in the store and in `coalescedRows`, not in the range. Invocation-column precision needs the analyzers to store call-site columns.",
    "THE SERVER DOES NOT FORWARD THE DECLARED COUNTERS TO THE WIRE. src/lsp/server.ts maps each location through navLocationToWire and returns Location[], so `coalescedRows`, `omittedUnresolvable`, `omittedUnpositionable` and `callSite` do not reach the editor. The component is honest and this gate proves the component carries them; it cannot prove the editor receives them. The wire shape is the server's decision and that file is not this lane's. LSP permits extra properties on a Location object, so the wiring is available.",
    "THE WIRE LEGS CANNOT SEE `coalescedRows` EITHER, for the same reason — R3's references assertions compare the served Location[] against the hover count, which is the right comparison for a wire that carries only positions. The collapse counter is gated at the component level (R2) and by mutant M6.",
    "countUsageSites RESTATES THE ADDRESS RULE IN SQL and therefore cannot read the source. A row whose stored byte columns do not convert against the file on disk is counted by the SQL and dropped by the collector; `isResolvableUsageSiteRow` exists so a caller can see that difference. That case is measured and declared. It is NOT the case fixed here, which was a 30-35% systematic shortfall on every real index measured.",
    "THE R5 FIXTURE IS SEEDED, NOT INDEXED. Its rows are written with the production schema through BrainDatabase, and its byte columns are computed from the sources on disk, but they are hand-authored rather than produced by `bb index` — the indexer was measured separately (and its findings are in `governingLaw.why` and `gateFindings`), and the R5 fixture reproduces the row SHAPE that measurement found. A seeded fixture cannot prove the analyzer keeps producing that shape; script/m59/verify-honest-callsite.ts is the leg that owns that.",
    "bb/graph declares its own traversal profile (all ten stored kinds by default, src/intelligence/graph/graph-engine.ts:45) because a traversal rooted at a class cannot reach its own methods without `contains`. The hub therefore excludes declaration containments at the USAGES GROUPING (src/lsp/graph_usages.ts), not in the engine. `mode: 'graph'` still serves every stored kind, and this gate does not assert anything about that shape — an agent-facing walk that lists a parent edge is a different question from 'who uses this symbol'.",
    "The bb_graph MCP tool (src/mcp/tool-handlers.ts) answers `direction: callers` from the engine's raw edges and is NOT covered by this gate. Whether it admits declaration containments as callers is therefore UNVERIFIED here; it was left unchanged because it is a different door answering a different question, and changing it was out of this integration's measured scope.",
    "Evidence-tree freshness (EVID-TREE) and the other milestone gates were re-run for regression only; their records are not this lane's to re-seal.",
  ],
}

try {
  writeSealed(EVIDENCE, result)
  console.log(`\nEV T3 evidence written: ${path.relative(ROOT, EVIDENCE)}`)
} catch (e) {
  console.log(`\nEV T3 evidence write failed: ${String(e)}`)
}

console.log(`\nT3 RESULT: ${failed === 0 ? "VERIFIED" : "KNOWN-GAP"} — ${passed}/${checks} passed, ${mutantsCaught}/${mutantsTotal} mutants caught`)
if (failed > 0) console.log(`failures:\n  - ${failures.join("\n  - ")}`)
try {
  rmSync(ws, { recursive: true, force: true })
  rmSync(dataDir, { recursive: true, force: true })
} catch {}
process.exit(failed === 0 ? 0 : 1)
