/**
 * PHP — the PRODUCTION-PATH store seam gate.
 *
 *   bun script/m60/php-store-pipeline-seam.ts
 *
 * ## Why this gate exists and why no existing php gate could replace it
 *
 * Every other instrument in this lane calls `ASTEngine.parseFile` (directly, or through
 * `run-fixtures.ts`). That call returns the ANALYZER's object and never crosses the worker
 * boundary, so a fact the analyzer publishes correctly and the WORKER then drops is
 * invisible to all of them — the fixture sees the payload, the store never does, and both
 * sides read green. The markdown lane recorded the same structural hole as MD-5 and called
 * it "unpinnable" rather than "unpinned": the instrument that CAN see the worker had no
 * case for that language.
 *
 * php is in exactly that position today. `real-php-analyzer.ts` publishes
 * `metadata.superTypes` on class/interface/enum, `heritage-published.php` pins the payload,
 * and `store-heritage-roundtrip.mts` proves the COLUMN is writable — but that fixture
 * hand-builds its symbols and calls `storeResults`, which is the far side of the seam. So
 * both pass while a store built through the real pipeline carries `super_types` on 0 of its
 * class-like symbols. Measured: 0 of 4,940.
 *
 * The mechanism is `src/ast/pool-worker.ts`'s per-symbol projection, whose `metadata` is a
 * narrow per-language allowlist ("only keys a READER CONSUMES belong here"): CSS keys,
 * markdown keys, four bash keys, `isDeclaration`. `superTypes` is not on it, so
 * `parallel-indexer.ts`'s `symbol.metadata?.superTypes` reads `undefined` for every symbol
 * in every language, and the column is written NULL. `override-retarget.ts` opens with
 * `if (supertypes.size === 0) return out`, so php has no project-wide hierarchy at all.
 *
 * ## What this gate measures
 *
 * It indexes a small php project through `indexProjectParallel` — the REAL pipeline, worker
 * pool included — then queries brain.db and asserts, per fact, BOTH halves:
 *
 *   A  super_types survives the worker
 *        analyzerCarried  = class-like symbols whose parseFile payload has non-empty
 *                           metadata.superTypes           (measured on the same sources,
 *                                                          bypassing the projection)
 *        storeCarried     = rows with non-NULL brain_symbol.super_types
 *        ANALYZER CARRIES / STORE DROPS is a FAILURE, named as a seam defect — this is the
 *        falsifiable half, and it is the state at HEAD.
 *      plus exactness: for every symbol the analyzer gave a heritage, the STORED array is
 *      byte-identical to the analyzer's, and named pins hold (a base+interfaces class, an
 *      interface-only class, an enum, a no-heritage class NULL, a same-leaf base that keeps
 *      its qualification).
 *
 *   B  member identity survives the worker
 *      every stored member named `persist` carries `Owner.persist`, and no stored row
 *      carries the bare name — the spelling the store's qualified-name index needs in
 *      order to stop resolving a member read to the alphabetically first declaration.
 *
 *   C  the edges the hierarchy mirrors are actually in the store (extends/implements > 0),
 *      so a zero in A can never be read as "the analyzer emitted nothing".
 *
 * SCOPE, stated so the numbers are not over-read. Resolution of the AMBIGUOUS endpoints is
 * not asserted here: the insert-time resolver ranks `ORDER BY (s.file_id = ?) DESC,
 * (f.language = ?) DESC, s.id LIMIT 1`, and changing that is a store-visible decision this
 * gate documents rather than assumes. What is asserted is that the FACTS the analyzer
 * produces arrive in the store intact — the precondition every downstream lever needs.
 *
 * READ-ONLY apart from a temp project and a temp BB_DATA_DIR.
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import * as path from "node:path"

const ROOT = path.resolve((import.meta as any).dirname ?? path.dirname(process.argv[1] ?? "."), "..", "..")

/** Sources copied verbatim from the lane's fixtures: the same shapes the fixtures pin. */
const SOURCES = [
  "validation/m14/fixtures/php/heritage-published.php",
  "validation/m14/fixtures/php/member-identity.php",
]

/**
 * CHECK D's source, written here rather than copied from a fixture, and built to make the WRONG
 * answer reachable rather than merely unlikely.
 *
 * The store's insert-time resolver (`resolveTargetStmt`) attaches a bare member name to
 * `ORDER BY COALESCE(s.is_declaration,0) ASC, (s.file_id = ?) DESC, (f.language = ?) DESC, s.id
 * LIMIT 1`, i.e. same-file first and then the lexicographically smallest symbol id — and an id is
 * `${projectId}:${relativePath}:${name}:${line}`, so when nothing in the citing file declares the
 * name, the winner is the ALPHABETICALLY FIRST declaration anywhere in the project. Three
 * declarations of `act` are placed so that the wrong ones (`ZetaStore`, `UpsilonStore`) both sort
 * before the right one (`WidgetBase`), which makes the mislanding deterministic instead of
 * occasional.
 *
 * The four rows, and why each is here:
 *
 *   `SubWidget::run` -> `$this->act()`   the class does NOT declare it and its base DOES: PHP's own
 *                                        lookup says `WidgetBase::act`, and the analyzer published
 *                                        `metadata.owner: SubWidget` because `$this` states the
 *                                        receiver outright. The honest answer is reachable; the
 *                                        ranking's answer is a different class.
 *   `SubWidget::run` -> `$this->own()`   declared by the receiver itself: the arm a pass that went
 *                                        straight to the ancestors would get wrong.
 *   `Broken::go`     -> `$this->act()`   its base is UNRESOLVABLE (`\Totally\Outside\Thing`), so the
 *                                        analyzer publishes no `super_types` for `Broken` and nothing
 *                                        in the chain declares `act`. The honest answer is NULL, and
 *                                        this is the row that a resolver preferring a stranger over
 *                                        silence gets wrong.
 *   `WidgetBase::act`, `ZetaStore::act`, `UpsilonStore::act`  exist as SYMBOLS, so D3's NULL is a
 *                                        refusal and not an absence — the gate asserts they landed.
 */
const SRC_MEMBER_CHANNEL = `<?php

namespace Fixture\\Seam;

class ZetaStore
{
    public function act(): int
    {
        return 1;
    }
}

class UpsilonStore
{
    public function act(): int
    {
        return 2;
    }
}

abstract class WidgetBase
{
    public function act(): int
    {
        return 3;
    }
}

class SubWidget extends WidgetBase
{
    public function own(): int
    {
        return 4;
    }

    public function run(): int
    {
        $this->act();
        $this->own();
        return 0;
    }
}

class Broken extends \\Totally\\Outside\\Thing
{
    public function go(): int
    {
        $this->act();
        return 0;
    }
}
`

/** Named pins — the absolute expectations, so an analyzer that publishes nothing cannot pass. */
const PINNED_HERITAGE: Array<{ owner: string; contains: string[]; note: string }> = [
  { owner: "WithBaseAndInterfaces", contains: ["Base", "Second", "Labeled"], note: "both halves at once" },
  { owner: "WithInterfaceOnly", contains: ["Second"], note: "the arm a base-only implementation gets right by accident" },
  { owner: "Suit", contains: ["Labeled"], note: "enum heritage (PHP 8.1 class_interface_clause)" },
  { owner: "DerivedIface", contains: ["First", "Second"], note: "an interface's parents are extends edges" },
]
/** base is a fully-qualified path whose LEAF equals the class's own name: qualification kept. */
const SAME_LEAF_OWNER = "FeaturesForm"
/** declares no heritage: the column must say so with NULL, not with a fabricated row. */
const NO_HERITAGE_OWNER = "NoHeritage"
/** members whose colliding names make the qualified spelling the only thing that separates them. */
const MEMBER_NAME = "persist"
const EXPECTED_MEMBER_QNAMES = ["AlphaStore.persist", "BetaStore.persist", "LogsPersist.persist", "Persister.persist"]

function fail(msg: string): void {
  console.log(`  FAIL  ${msg}`)
  process.exitCode = 1
}

function ok(msg: string): void {
  console.log(`  ok    ${msg}`)
}

function leafOf(qname: string): string {
  const i = qname.lastIndexOf("\\")
  return i >= 0 ? qname.slice(i + 1) : qname
}

async function main(): Promise<void> {
  const data = mkdtempSync(path.join(tmpdir(), "php-seam-data-"))
  process.env.BB_DATA_DIR = data
  const project = mkdtempSync(path.join(tmpdir(), "php-seam-proj-"))
  mkdirSync(path.join(project, "src"), { recursive: true })
  for (const rel of SOURCES) {
    writeFileSync(path.join(project, "src", path.basename(rel)), readFileSync(path.join(ROOT, rel)))
  }
  writeFileSync(path.join(project, "src", "member-channel.php"), SRC_MEMBER_CHANNEL)

  console.log("php store seam (production path)")
  console.log(`  project: ${project}`)

  // ---- 1. what the ANALYZER publishes on the same sources, bypassing the projection.
  //
  // NB `parseFile` exported from `pool-worker.ts` is NOT usable here: it returns the
  // PROJECTED object, so measuring with it would make this gate's control part of the thing
  // it is testing (that mistake was made once, and it read "analyzer carries 0" while
  // `heritage-published.expectation.json` pins the payload). `ASTEngine.parseFile` is the
  // analyzer entry the fixtures use.
  const { ASTEngine } = (await import(path.join(ROOT, "src/ast/engine.ts"))) as any
  interface AnalyzerHeritage {
    qname: string
    name: string
    kind: string
    superTypes: string[]
  }
  const analyzerHeritage: AnalyzerHeritage[] = []
  const analyzerMemberQnames = new Set<string>()
  for (const rel of SOURCES) {
    const abs = path.join(project, "src", path.basename(rel))
    const r = await ASTEngine.parseFile(abs, readFileSync(abs, "utf8"))
    for (const s of r.symbols ?? []) {
      const sup = s.metadata?.superTypes
      if (Array.isArray(sup) && sup.length > 0) {
        analyzerHeritage.push({ qname: s.qualifiedName ?? s.name, name: s.name, kind: s.kind, superTypes: sup })
      }
      if (s.name === MEMBER_NAME && typeof s.qualifiedName === "string") analyzerMemberQnames.add(s.qualifiedName)
    }
  }
  const analyzerCarried = analyzerHeritage.length
  console.log(`  analyzer carries superTypes on ${analyzerCarried} class-like symbol(s) (parseFile, projection bypassed)`)
  console.log(`  analyzer qualifies ${analyzerMemberQnames.size} member(s) named ${MEMBER_NAME}: ${[...analyzerMemberQnames].sort().join(", ") || "—"}`)

  // ---- 2. what the STORE keeps, through the REAL pipeline (indexProjectParallel).
  const { getProjectId } = (await import(path.join(ROOT, "src/cli/index.ts"))) as any
  const { indexProjectParallel } = (await import(path.join(ROOT, "src/ast/parallel-indexer.ts"))) as any
  const { BrainDatabase } = (await import(path.join(ROOT, "src/brain/database.ts"))) as any
  const pid = getProjectId(project) as any

  try {
    await indexProjectParallel(pid, project, {})
  } catch (e) {
    fail(`the production index did not complete: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`)
    return
  }

  const db = await BrainDatabase.getRawInstance(pid)
  const symbols = db
    .prepare(
      `SELECT name, qualified_name, symbol_type, super_types
         FROM brain_symbol WHERE project_id = ?`,
    )
    .all(pid) as any[]
  const edgeRows = db
    .prepare(
      `SELECT relationship_type, COUNT(*) c FROM brain_relationship
        WHERE project_id = ? AND relationship_type IN ('extends','implements')
        GROUP BY relationship_type`,
    )
    .all(pid) as any[]

  console.log(`  store holds ${symbols.length} symbol(s), heritage edges: ${JSON.stringify(edgeRows.map((r) => [r.relationship_type, r.c]))}`)
  if (symbols.length === 0) {
    fail("no symbols were stored at all — the run did not measure what this gate claims")
    return
  }

  // ---- CHECK C: the edges the hierarchy mirrors must exist, or a zero in A is unreadable.
  const edgeTotal = edgeRows.reduce((n, r) => n + r.c, 0)
  if (edgeTotal > 0) ok(`C: ${edgeTotal} extends/implements edge(s) present, so a zero in A is not "the analyzer emitted nothing"`)
  else fail("C: no extends/implements edges stored — check A's zero is unreadable until this is understood")

  // ---- CHECK A: does the column carry what the analyzer published?
  // Scoped to the names CHECK A measured, because CHECK D's source now shares the store: a name
  // filter rather than a file filter, and it is exact rather than approximate — D's identifiers
  // (`ZetaStore`, `UpsilonStore`, `WidgetBase`, `SubWidget`, `Broken`) do not occur in either
  // fixture, which the `matches exactly 1 stored row` assertion below would catch if they ever did.
  const analyzerNames = new Set(analyzerHeritage.map((h) => h.name))
  const storedByName = new Map<string, any[]>()
  for (const s of symbols) {
    const k = String(s.name)
    const list = storedByName.get(k) ?? []
    list.push(s)
    storedByName.set(k, list)
  }
  const storeCarriedRows = symbols.filter(
    (s) => s.super_types !== null && s.super_types !== undefined && analyzerNames.has(String(s.name)),
  )
  const storeCarried = storeCarriedRows.length
  console.log(`  store carries super_types on ${storeCarried} symbol(s)`)

  if (analyzerCarried > 0 && storeCarried === 0) {
    fail(
      `A: SEAM DROPS — the analyzer published metadata.superTypes on ${analyzerCarried} symbol(s) and the store holds the column on 0. ` +
        `The worker projection (src/ast/pool-worker.ts, the per-symbol metadata allowlist) does not carry the key, so parallel-indexer.ts's ` +
        `symbol.metadata?.superTypes reads undefined and override-retarget.ts returns at "if (supertypes.size === 0) return out".`,
    )
  } else if (analyzerCarried > 0 && storeCarried < analyzerCarried) {
    fail(`A: SEAM PARTIAL — analyzer carried ${analyzerCarried}, store carries ${storeCarried}`)
  } else if (analyzerCarried > 0) {
    ok(`A: every analyzer-published heritage reached the store (${storeCarried}/${analyzerCarried})`)
  } else {
    fail("A: the analyzer published NO heritage on these sources — the gate measured nothing")
  }

  // ---- CHECK A-exact: the stored array must be the analyzer's array, not a re-derivation.
  let exactMismatches = 0
  for (const h of analyzerHeritage) {
    const candidates = storedByName.get(h.name) ?? []
    if (candidates.length !== 1) {
      const byLeaf = symbols.filter((s) => leafOf(String(s.qualified_name)) === h.name).map((s) => String(s.qualified_name))
      fail(
        `A-exact: ${h.name} (analyzer qname ${h.qname}, heritage ${JSON.stringify(h.superTypes)}) matches ${candidates.length} stored row(s)` +
          (candidates.length > 0
            ? ` with qualified_name ${JSON.stringify(candidates.map((c) => String(c.qualified_name)))}`
            : `; rows whose qualified_name leaf is ${h.name}: ${JSON.stringify([...new Set(byLeaf)])}`),
      )
      exactMismatches++
      continue
    }
    const row = candidates[0]!
    let stored: unknown = null
    try {
      stored = row.super_types ? JSON.parse(row.super_types) : null
    } catch {
      fail(`A-exact: ${h.qname} stored super_types is not JSON: ${String(row.super_types)}`)
      exactMismatches++
      continue
    }
    const a = JSON.stringify(h.superTypes)
    const b = JSON.stringify(stored)
    if (a !== b) {
      fail(`A-exact: ${h.name} (stored ${String(row.qualified_name)}) analyzer ${a} != stored ${b}`)
      exactMismatches++
    }
  }
  if (exactMismatches === 0 && analyzerCarried > 0) ok(`A-exact: all ${analyzerCarried} heritage payload(s) stored byte-identical`)

  // ---- CHECK A-pins: absolute named expectations, so an all-empty payload cannot pass.
  for (const pin of PINNED_HERITAGE) {
    const row = [...symbols].find((s) => s.name === pin.owner)
    if (!row) {
      fail(`A-pin: no stored symbol named ${pin.owner}`)
      continue
    }
    let stored: string[] = []
    try {
      stored = row.super_types ? JSON.parse(row.super_types) : []
    } catch {
      stored = []
    }
    const missing = pin.contains.filter((c) => !stored.includes(c))
    if (missing.length === 0) ok(`A-pin: ${pin.owner} -> ${JSON.stringify(stored)} (${pin.note})`)
    else fail(`A-pin: ${pin.owner} stored ${JSON.stringify(stored)} lacks ${JSON.stringify(missing)} — expected to contain ${JSON.stringify(pin.contains)}`)
  }

  {
    const row = [...symbols].find((s) => s.name === SAME_LEAF_OWNER)
    if (!row) fail(`A-pin: no stored symbol named ${SAME_LEAF_OWNER}`)
    else {
      let stored: string[] = []
      try {
        stored = row.super_types ? JSON.parse(row.super_types) : []
      } catch {
        stored = []
      }
      const kept = stored.some((b) => b !== SAME_LEAF_OWNER && leafOf(b) === SAME_LEAF_OWNER)
      if (kept) ok(`A-pin: ${SAME_LEAF_OWNER} -> ${JSON.stringify(stored)} keeps the qualification that separates it from its own name`)
      else fail(`A-pin: ${SAME_LEAF_OWNER} stored ${JSON.stringify(stored)} does not keep a qualified same-leaf base — a consumer walking this would land on the class it started from`)
    }
  }

  {
    const row = [...symbols].find((s) => s.name === NO_HERITAGE_OWNER)
    if (!row) fail(`A-pin: no stored symbol named ${NO_HERITAGE_OWNER}`)
    else if (row.super_types === null || row.super_types === undefined) ok(`A-pin: ${NO_HERITAGE_OWNER} stores NULL, the column's honest "declares no supertypes"`)
    else fail(`A-pin: ${NO_HERITAGE_OWNER} stores ${String(row.super_types)} but declares no heritage`)
  }

  // ---- CHECK B: member identity survives the worker.
  const members = symbols.filter((s) => s.name === MEMBER_NAME)
  if (members.length === 0) {
    fail(`B: no stored symbol named ${MEMBER_NAME} — the member identity half measured nothing`)
  } else {
    const bare = members.filter((s) => String(s.qualified_name) === MEMBER_NAME)
    const qnames = new Set(members.map((s) => String(s.qualified_name)))
    const missing = EXPECTED_MEMBER_QNAMES.filter((q) => !qnames.has(q))
    if (bare.length > 0) {
      fail(`B: ${bare.length} stored member(s) carry the BARE name ${MEMBER_NAME} as qualified_name: ${[...new Set(bare.map((s) => s.symbol_type))].join(", ")}`)
    }
    if (missing.length > 0) {
      fail(`B: stored ${MEMBER_NAME} members lack the owner-qualified spellings ${JSON.stringify(missing)} (have ${JSON.stringify([...qnames].sort())})`)
    }
    if (bare.length === 0 && missing.length === 0) {
      ok(`B: all ${members.length} stored ${MEMBER_NAME} member(s) carry an owner-qualified name (${[...qnames].sort().join(", ")})`)
    }
  }

  // ---- CHECK D: the member channel — where a member read was actually BOUND.
  //
  // A, B and C are about FACTS arriving. This one is about a fact arriving at the right place, which
  // is the only thing an agent reading the graph can be wrong about: `SubWidget::run` calling
  // `$this->act()` and the store saying `ZetaStore::act` is not an unresolved edge, it is a confident
  // false statement about which class a method call reaches.
  const memberRows = db
    .prepare(
      `SELECT r.id, r.target_external, r.target_symbol_id, s.name AS source_name,
              t.name AS target_name, t.qualified_name AS target_qname
         FROM brain_relationship r
         LEFT JOIN brain_symbol s ON s.id = r.source_symbol_id
         LEFT JOIN brain_symbol t ON t.id = r.target_symbol_id
        WHERE r.project_id = ? AND r.relationship_type IN ('calls','uses')`,
    )
    .all(pid) as any[]

  const landedOn = (sourceName: string, target: string): string | null | undefined => {
    const rows = memberRows.filter((r) => String(r.source_name) === sourceName && String(r.target_external) === target)
    if (rows.length === 0) return undefined // no such row at all: a different failure than a NULL
    const row = rows.find((r) => r.target_symbol_id !== null && r.target_symbol_id !== undefined)
    return row ? String(row.target_qname) : null
  }

  // D0 — the row set itself. A resolver that DELETED edges to avoid binding them would look like a
  // success on D1-D3, so the rows the analyzer emitted are counted in the store first.
  {
    const emitted = (await ASTEngine.parseFile(path.join(project, "src", "member-channel.php"), SRC_MEMBER_CHANNEL)) as any
    const emittedMemberRows = (emitted.relationships ?? []).filter(
      (r: any) => r.type === "calls" || r.type === "uses",
    ).length
    const storedMemberRows = memberRows.filter((r) => r.id.includes("member-channel")).length
    if (emittedMemberRows === storedMemberRows && emittedMemberRows > 0) {
      ok(`D0: all ${emittedMemberRows} member row(s) of member-channel.php are in the store — a NULL below is a refusal, not an absence`)
    } else {
      fail(`D0: member-channel.php emitted ${emittedMemberRows} member row(s) and the store holds ${storedMemberRows}`)
    }
  }

  // D4 (control) — the declarations the wrong answer would have to come from must EXIST, or D1/D3
  // pass for the wrong reason.
  for (const qn of ["ZetaStore.act", "UpsilonStore.act", "WidgetBase.act", "SubWidget.own"]) {
    const present = symbols.some((s) => String(s.qualified_name) === qn)
    if (present) ok(`D4: ${qn} is a stored symbol, so it is available to be chosen wrongly`)
    else fail(`D4: ${qn} is not in the store — CHECK D cannot distinguish a correct refusal from a missing declaration`)
  }

  // D1 — inherited read: the receiver does not declare it, its base does. PHP's own lookup.
  {
    const land = landedOn("run", "act")
    if (land === undefined) fail("D1: no `$this->act()` row from `SubWidget::run` at all")
    else if (land === null) {
      fail(
        "D1: `SubWidget::run -> $this->act()` is UNRESOLVED, but `WidgetBase` declares `act` and `metadata.owner` names the receiver — an honest NULL is still a hole where PHP's own lookup has an answer",
      )
    } else if (land.endsWith("WidgetBase.act")) {
      ok("D1: `$this->act()` in the subclass lands on WidgetBase.act — the declared ancestor, not the alphabetically first stranger")
    } else {
      fail(
        `D1: \`$this->act()\` in \`SubWidget::run\` landed on ${land} — ${land.split(".")[0]} does not declare it and is not an ancestor of SubWidget. This is the confident-wrong-edge shape: nothing about the row is marked unresolved.`,
      )
    }
  }

  // D2 — the receiver's OWN declaration: the arm a straight-to-the-ancestors rule would break.
  {
    const land = landedOn("run", "own")
    if (land === undefined) fail("D2: no `$this->own()` row from `SubWidget::run` at all")
    else if (land && land.endsWith("SubWidget.own")) ok("D2: `$this->own()` lands on the receiver's own declaration")
    else fail(`D2: \`$this->own()\` landed on ${land === null ? "NULL" : land} — expected the receiver's own SubWidget.own`)
  }

  // D3 — no answer is reachable: the base is unresolvable, so nothing in the chain declares `act`.
  {
    const land = landedOn("go", "act")
    if (land === undefined) fail("D3: no `$this->act()` row from `Broken::go` at all")
    else if (land === null) {
      ok("D3: `$this->act()` behind an unresolvable base stays NULL — the honest \"not known\", not a stranger")
    } else {
      fail(
        `D3: \`$this->act()\` behind the unresolvable base \\Totally\\Outside\\Thing landed on ${land} — that class is neither the receiver nor an ancestor, and the edge is stored as resolved.`,
      )
    }
  }

  console.log(process.exitCode ? "\nverdict: FAIL" : "\nverdict: PASS")
}

await main()
