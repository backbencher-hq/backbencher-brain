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
  const storedByName = new Map<string, any[]>()
  for (const s of symbols) {
    const k = String(s.name)
    const list = storedByName.get(k) ?? []
    list.push(s)
    storedByName.set(k, list)
  }
  const storeCarriedRows = symbols.filter((s) => s.super_types !== null && s.super_types !== undefined)
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

  console.log(process.exitCode ? "\nverdict: FAIL" : "\nverdict: PASS")
}

await main()
