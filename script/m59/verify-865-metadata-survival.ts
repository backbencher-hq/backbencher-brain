// script/m59/verify-865-metadata-survival.ts — #865 acceptance harness.
//
// THE STANDING INSTRUMENT for "does an analyzer's relationship metadata
// survive its own indexing pipeline?" — the question #865 answered NO before
// the merge fix, and that every future seam change must be measured against.
// Acceptance items, each able to fail, all against the REAL pipeline
// (indexProjectParallel → resolveRelationships → enrichRelationships):
//
//   1. SURVIVAL — a java fixture whose analyzer emits metadata-carrying edges
//      is indexed; every emitted key must be present on the stored row after
//      the full pipeline, and the enrichment dimensions must ALSO be present
//      (merge, not either/or).
//   2. STALE LAW — src/lsp/enrichment.ts's contract still holds on merged
//      rows: parseEnrichment recognises them via inferredAt, a row whose
//      inferredAt predates a later row change is STALE, and an analyzer-only
//      payload (no inferredAt) stays declared un-enriched.
//   3. RE-RUN — enrichRelationships run again over an already-merged index
//      keeps every analyzer key, refreshes inferredAt, and its frequency is
//      recomputed from the DB's real in-degree (recomputation, not freezing).
//   4. MUTATION (in-run RED/GREEN) — a one-line mutant of the REAL module
//      (the merge spread `{ ...existing }` → `{}`: the exact #865 wholesale
//      behaviour) is written to a scratch sibling, executed through its own
//      exported enrichRelationships against an already-merged index, and the
//      SAME survival predicate must convict it. A merge gate that cannot see
//      the wholesale write proves nothing.
//
// Scope, declared: survival counts analyzer keys only; enrichment keys are
// checked separately and never conflated. All indexes live in one throwaway
// data dir under /tmp.
//
// Run: bun script/m59/verify-865-metadata-survival.ts
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const DATA = mkdtempSync(path.join(tmpdir(), "m59-865-verify-data-"))
process.env.BB_DATA_DIR = DATA
if (!DATA.startsWith("/tmp/")) {
  console.error("REFUSING TO RUN: the mutation phase rewrites rows; a throwaway data dir is required")
  process.exit(2)
}

let checks = 0
let failed = 0
function check(name: string, ok: boolean, detail = "") {
  checks++
  if (ok) console.log(`  PASS  ${name}${detail ? `  ${detail}` : ""}`)
  else {
    failed++
    console.log(`  FAIL  ${name}${detail ? `  ${detail}` : ""}`)
  }
}

// The fixture the java analyzer gives metadata edges on:
//   - a field-typed reference (relationshipType + declaredOn + evidenceClass)
//   - an instantiation (isNew + evidenceClass structural)
//   - a qualified call (javaCallExpression + argumentCount + evidenceClass)
const REPO_JAVA = `package demo;\n\npublic class Repo {\n  private Store store = new Store();\n\n  public int load(int id) {\n    return store.fetch(id);\n  }\n}\n`
const STORE_JAVA = `package demo;\n\npublic class Store {\n  public int fetch(int id) {\n    return id;\n  }\n  public int fetchAll(int id) {\n    return id + 1;\n  }\n}\n`

// The analyzer keys this fixture's edges carry (measured by
// probe-865-metadata-survival.ts --emit-only) — survival asserts exactly
// these, never the enrichment-owned keys.
const ANALYZER_KEYS = ["relationshipType", "declaredOn", "evidenceClass", "isNew", "javaCallExpression", "argumentCount"]
const ENRICHMENT_KEYS = ["layerFlow", "criticality", "frequency", "role", "inferredAt"]

function parseMeta(m: string | null | undefined): Record<string, any> {
  try {
    const v = JSON.parse(m ?? "{}")
    return v !== null && typeof v === "object" ? v : {}
  } catch {
    return {}
  }
}

async function openDb(pid: any): Promise<any> {
  const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database.ts"))
  return BrainDatabase.getRawInstance(pid)
}

async function indexFixture(tag: string, extraFiles: Record<string, string> = {}): Promise<{ pid: any; db: any }> {
  const project = mkdtempSync(path.join(tmpdir(), `m59-865-verify-${tag}-`))
  mkdirSync(path.join(project, "src"), { recursive: true })
  writeFileSync(path.join(project, "src", "Repo.java"), REPO_JAVA)
  writeFileSync(path.join(project, "src", "Store.java"), STORE_JAVA)
  for (const [name, src] of Object.entries(extraFiles)) writeFileSync(path.join(project, "src", name), src)
  const { getProjectId } = await import(path.join(ROOT, "src/cli/index.ts"))
  const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer.ts"))
  const pid = getProjectId(project) as any
  await indexProjectParallel(pid, project, {})
  const db = await openDb(pid)
  return { pid, db }
}

function relRows(db: any, pid: any): any[] {
  return db
    .prepare(
      `SELECT r.id, r.relationship_type, r.time_updated, r.metadata, r.line_number,
              s.name AS source_name, t.name AS target_name
       FROM brain_relationship r
       LEFT JOIN brain_symbol s ON s.id = r.source_symbol_id
       LEFT JOIN brain_symbol t ON t.id = r.target_symbol_id
       WHERE r.project_id = ?`,
    )
    .all(pid) as any[]
}

function analyzerKeyInstances(rows: any[]): number {
  return rows.reduce((acc, r) => acc + ANALYZER_KEYS.filter((k) => parseMeta(r.metadata)[k] !== undefined).length, 0)
}

async function main() {
  console.log(`data dir: ${DATA}\n`)

  // ── 1. SURVIVAL through the full pipeline ────────────────────────────────
  const { pid, db } = await indexFixture("main")
  const rows = relRows(db, pid)
  const metaRows = rows.filter((r) => Object.keys(parseMeta(r.metadata)).length > 0)
  const perKey = new Map<string, number>(ANALYZER_KEYS.map((k) => [k, 0]))
  for (const r of rows)
    for (const k of ANALYZER_KEYS) if (parseMeta(r.metadata)[k] !== undefined) perKey.set(k, (perKey.get(k) ?? 0) + 1)
  const totalSurviving = [...perKey.values()].reduce((a, b) => a + b, 0)
  check("1a. analyzer keys survive the full pipeline (not all zero)",
    totalSurviving > 0,
    totalSurviving === 0 ? "every analyzer key was destroyed — the #865 wholesale write" : `${totalSurviving} key-instances survived`)
  check("1b. every emitted key class survived",
    ANALYZER_KEYS.every((k) => (perKey.get(k) ?? 0) > 0),
    JSON.stringify([...perKey.entries()]))
  // The enrichment's own contract: layerFlow/criticality/frequency/inferredAt
  // are ALWAYS written; role is only inferred for the calls/instantiates/
  // extends-family types (a `contains` row legitimately carries no role —
  // visible in the #865 body's own pre-fix samples too).
  const ALWAYS = ["layerFlow", "criticality", "frequency", "inferredAt"]
  const roleBearing = metaRows.filter((r) => ["calls", "instantiates", "extends", "implements", "overrides", "uses", "references", "imports"].includes(r.relationship_type))
  check("1c. merged rows are ALSO enrichment records (merge, not replacement)",
    metaRows.length > 0 && metaRows.every((r) => ALWAYS.every((k) => parseMeta(r.metadata)[k] !== undefined)) &&
      roleBearing.every((r) => parseMeta(r.metadata).role !== undefined),
    `${metaRows.length} rows checked for ${ALWAYS.join(",")}; ${roleBearing.length} role-bearing rows checked for role`)
  const calls = metaRows.filter((r) => r.relationship_type === "calls")
  check("1d. the java call edge keeps its call-site facts (javaCallExpression + argumentCount)",
    calls.length > 0 && calls.every((r) => parseMeta(r.metadata).javaCallExpression === "store.fetch" && parseMeta(r.metadata).argumentCount === 1),
    JSON.stringify(calls.map((r) => parseMeta(r.metadata).javaCallExpression)))
  check("1e. analyzer line_number survived the pipeline alongside metadata",
    calls.length > 0 && calls.every((r) => typeof r.line_number === "number" && r.line_number > 0),
    `call-site lines: ${calls.map((r) => r.line_number).join(",")}`)

  // ── 2. STALE LAW on merged rows ──────────────────────────────────────────
  const lsp = await import(path.join(ROOT, "src/lsp/enrichment.ts"))
  const callRow = metaRows.find((r) => r.relationship_type === "calls")
  const enr = lsp.parseEnrichment(callRow?.metadata)
  check("2a. a merged row is recognised as an enrichment record via inferredAt",
    enr !== null && typeof enr.inferredAt === "number",
    enr ? `inferredAt ${enr.inferredAt}` : "parseEnrichment returned null on a merged row")
  check("2b. staleness law: future row change => stale; real row => fresh",
    enr !== null && lsp.enrichmentIsStale(enr, (enr!.inferredAt ?? 0) + 5_000) === true &&
      lsp.enrichmentIsStale(enr, callRow?.time_updated ?? null) === false,
    "a merged row must be readable as enrichment AND rejectable as stale")
  check("2c. an analyzer-ONLY payload (no inferredAt) is declared un-enriched, never upgraded",
    lsp.parseEnrichment(JSON.stringify({ evidenceClass: "structural" })) === null,
    "presence law on an analyzer-only payload")

  // ── 3. RE-RUN: enrichment refreshes its own keys, keeps analyzer keys ────
  const { pid: pid2 } = await indexFixture("rerun", {
    "Other.java": `package demo;\n\npublic class Other {\n  private Store store = new Store();\n\n  public int grab(int id) {\n    return store.fetch(id);\n  }\n}\n`,
  })
  const db2 = await openDb(pid2)
  const before = relRows(db2, pid2)
  const callBefore = before.find((r) => r.relationship_type === "calls" && r.source_name === "load")
  const { enrichRelationships } = await import(path.join(ROOT, "src/brain/brain-relationship-enrichment.ts"))
  await enrichRelationships(pid2)
  const after = relRows(db2, pid2)
  const callAfter = after.find((r) => r.id === callBefore?.id)
  check("3a. re-run keeps every analyzer key on the same row",
    !!callBefore && !!callAfter &&
      ANALYZER_KEYS.every((k) => parseMeta(callAfter.metadata)[k] === parseMeta(callBefore.metadata)[k]),
    `before=${JSON.stringify(parseMeta(callBefore?.metadata))}`)
  check("3b. re-run refreshed the enrichment marker (inferredAt monotone non-decreasing)",
    !!callAfter && typeof parseMeta(callAfter.metadata).inferredAt === "number" &&
      parseMeta(callAfter.metadata).inferredAt >= parseMeta(callBefore?.metadata).inferredAt,
    `inferredAt ${parseMeta(callBefore?.metadata).inferredAt} -> ${parseMeta(callAfter?.metadata).inferredAt}`)
  // Recomputation proven against the DB's own in-degree, not assumed: the
  // frequency the row carries must equal one_of_<rows targeting the symbol>.
  const callAfterMeta = parseMeta(callAfter?.metadata)
  const targetId = db2
    .prepare(`SELECT target_symbol_id FROM brain_relationship WHERE id = ?`)
    .get(callAfter?.id) as any
  const inDeg = (
    db2
      .prepare(`SELECT COUNT(*) AS c FROM brain_relationship WHERE project_id = ? AND target_symbol_id = ? AND target_symbol_id IS NOT NULL AND target_symbol_id != ''`)
      .get(pid2, targetId?.target_symbol_id) as any
  ).c
  check("3c. re-run recomputed frequency from the DB's real in-degree",
    callAfterMeta.frequency === `one_of_${inDeg}`,
    `row says ${callAfterMeta.frequency}, DB in-degree says one_of_${inDeg}`)

  // ── 4. MUTATION: the wholesale write must be convictable ────────────────
  // One-line mutant of the REAL module: the merge spread `{ ...existing }`
  // becomes `{}` — which is precisely the pre-#865 behaviour (a fresh object,
  // analyzer keys dropped). The copy lives beside the real module so its
  // relative imports resolve, is imported under its own specifier, and is
  // deleted in a finally block.
  const realSource = readFileSync(path.join(ROOT, "src/brain/brain-relationship-enrichment.ts"), "utf8")
  const OCCURRENCES = realSource.split("const meta: any = { ...existing }").length - 1
  const mutantPath = path.join(ROOT, "src/brain", `.m59-865-wholesale-mutant-${Date.now()}.ts`)
  let mutantCaught = false
  let mutantDetail = ""
  try {
    if (OCCURRENCES !== 1) throw new Error(`mutation site not unique: found ${OCCURRENCES} occurrences of the merge spread`)
    const mutantSource = realSource.replace(
      "const meta: any = { ...existing }",
      "const meta: any = {} // MUTANT #865: wholesale write (analyzer keys dropped)",
    )
    writeFileSync(mutantPath, mutantSource)
    const mutantMod = await import(mutantPath)
    const { pid: pid3 } = await indexFixture("mut")
    const db3 = await openDb(pid3)
    const rowsBeforeMutant = relRows(db3, pid3)
    const survivedBefore = analyzerKeyInstances(rowsBeforeMutant)
    await mutantMod.enrichRelationships(pid3)
    const rowsAfterMutant = relRows(db3, pid3)
    const survivedAfter = analyzerKeyInstances(rowsAfterMutant)
    // The SAME predicate that passed item 1 must fail under the mutant:
    mutantCaught = survivedBefore > 0 && survivedAfter === 0
    mutantDetail = `real behaviour: ${survivedBefore} analyzer key-instances on the index; after the wholesale-write mutant ran: ${survivedAfter}`
  } catch (e: any) {
    mutantDetail = `mutation could not be executed: ${e.message}`
  } finally {
    try { rmSync(mutantPath, { force: true }) } catch {}
  }
  check("4. the survival predicate convicts the wholesale write (RED/GREEN)",
    mutantCaught,
    mutantDetail)

  console.log(`\n${checks - failed}/${checks} checks passed${failed ? `, ${failed} FAILED` : " — #865 acceptance items 1-4 all verified"}`)
  if (failed > 0) process.exitCode = 1
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
