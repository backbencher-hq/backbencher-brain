/**
 * Store-level receiver binding controls over four PHP files.
 *
 * Direct and inherited members bind through exact declaration identities.
 * Duplicate class leaves in different namespaces remain distinct. Untyped
 * receivers, absent parents, and ambiguous ancestor declarations stay unresolved.
 *
 * Three stores separate the signals: A keeps both receiver and hierarchy facts;
 * B removes display/canonical receiver identities; C removes display/canonical
 * heritage. Rows are explicitly cleared before invoking the resolver to verify
 * that these facts, rather than a pre-existing name binding, determine results.
 *
 * This direct-store gate complements verify-php-unresolved-receivers.mts and
 * verify-php-stored-namespaces.mts, which also exercise actual worker indexing.
 * Earlier measurements and superseded name-ranking behavior are recorded in
 * the launch verification log, rather than asserted as required defects here.
 */
import { mkdtempSync, readFileSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { ASTEngine } from "../../../../src/ast/engine"
import { storeResults } from "../../../../src/ast/parallel-indexer"
import { resolveMemberTargetsByOwner } from "../../../../src/ast/member-owner-resolution"
import { BrainDatabase } from "../../../../src/brain/database"

const HERE = (import.meta as any).dirname ?? path.dirname(fileURLToPath(import.meta.url))
const SOURCES_DIR = path.resolve(HERE, "..", "..", "..", "m60", "php", "owner-resolution-sources")
const SOURCES = ["alpha.php", "beta.php", "gamma.php", "delta.php"].map((f) => path.join(SOURCES_DIR, f))

const failures: string[] = []
function check(ok: boolean, what: string, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}${detail ? `  ${detail}` : ""}`)
  if (!ok) failures.push(what)
}
function pin(ok: boolean, what: string, detail = ""): void {
  console.log(`${ok ? "PIN " : "FAIL"}  ${what}${detail ? `  ${detail}` : ""}`)
  if (!ok) failures.push(what)
}

/**
 * THE ROW SPELLINGS MOVED ON 2026-10-10, and this is that acknowledgement.
 *
 * `qualifyProvenMemberTargets` (real-php-analyzer.ts, commit cd0c77546) emits a member target as
 * `Owner.member` wherever the file's own symbol table proves it declares that member. Three rows below
 * were spelled with the bare member name when this gate was written and are now qualified —
 * `goDirect -> GammaStore.persist` and the two `Twin.solo` rows — so they are updated to the spelling
 * the ANALYZER emits, which is what `rowState` looks up (`r.target_external`).
 *
 * WHAT THAT CHANGES FOR THIS GATE, stated rather than left to be inferred: for those rows the store no
 * longer needs the owner CHANNEL to find the right declaration — the target already names it, and the
 * store's first strategy is an exact `qualified_name` match. The channel still owns every row whose
 * target stays bare, which is every row the file cannot prove (an inherited member, a receiver whose
 * type is not knowable), and those are exactly the rows the negatives below assert as NULL. Section 3
 * still clears and re-resolves the rows, so for the qualified ones it now measures "the pass re-finds
 * by owner what the target already said" — a weaker claim than before, which is why the DIRECT pin's
 * text names the mechanism that answered rather than crediting the pass by default.
 */
type Row = { source: string; target: string; type: string }
type State = { resolved: boolean; ownerName: string | null; ownerFile: string | null }

const DIRECT: Row = { source: "goDirect", target: "GammaStore.persist", type: "calls" }
const INHERITED: Row = { source: "goInherited", target: "persist", type: "calls" }
const COLLIDING: Row = { source: "goCollidingOwner", target: "Twin.solo", type: "calls" }
const QUALIFIED_PARENT: Row = { source: "goAmbiguousParent", target: "Twin.solo", type: "calls" }
const QUALIFIED_ANCESTOR: Row = { source: "goAmbiguousAncestor", target: "solo", type: "calls" }
const NEAREST: Row = { source: "goTwoAncestors", target: "dup", type: "calls" }
/** Cases for which no declaring member is established. */
const NEGATIVES: [Row, string][] = [
  [{ source: "goPlain", target: "persist", type: "calls" }, "a local variable does not identify a declaring class"],
  [{ source: "goExternalBase", target: "getMessage", type: "calls" }, "the parent declaration is outside the indexed population"],
]

async function readAll(): Promise<any[]> {
  const out: any[] = []
  for (const f of SOURCES) {
    const st = statSync(f)
    const r: any = await ASTEngine.parseFile(f, readFileSync(f, "utf8"))
    out.push({
      filePath: f, success: true, symbols: r.symbols ?? [], relationships: r.relationships ?? [], imports: r.imports ?? [],
      language: "php", fileHash: "owner-resolution-gate", sizeBytes: st.size, lastModified: st.mtimeMs,
    })
  }
  return out
}
const stripOwner = (all: any[]): any[] =>
  all.map((r) => ({ ...r, relationships: (r.relationships ?? []).map((x: any) => {
    if (!x?.metadata || typeof x.metadata !== "object" || !("owner" in x.metadata)) return x
    const { owner: _dropped, ownerIdentity: _identity, ...rest } = x.metadata
    return { ...x, metadata: rest }
  }) }))
const stripHeritage = (all: any[]): any[] =>
  all.map((r) => ({ ...r, symbols: (r.symbols ?? []).map((s: any) => {
    if (!s?.metadata || typeof s.metadata !== "object" || !("superTypes" in s.metadata)) return s
    const { superTypes: _dropped, superTypeIdentities: _canonical, baseIdentity: _base, ...rest } = s.metadata
    return { ...s, metadata: rest }
  }) }))

function rowState(db: any, row: Row): State {
  const r = db.prepare(
    `SELECT r.target_symbol_id AS tid, os.name AS owner_name, f.relative_path AS owner_file
       FROM brain_relationship r
       JOIN brain_symbol s ON s.id = r.source_symbol_id
       LEFT JOIN brain_symbol ts ON ts.id = r.target_symbol_id
       LEFT JOIN brain_symbol os ON os.id = ts.owner_symbol_id
       LEFT JOIN brain_file f ON f.id = os.file_id
      WHERE r.relationship_type = ? AND s.name = ? AND r.target_external = ?`,
  ).get(row.type, row.source, row.target) as any
  if (!r) throw new Error(`no stored row for ${row.type} ${row.source} -> ${row.target}`)
  return { resolved: r.tid !== null && r.tid !== undefined, ownerName: r.owner_name ?? null, ownerFile: r.owner_file ? path.basename(String(r.owner_file)) : null }
}
const describe = (s: State) => (s.resolved ? `${s.ownerName ?? "?"}@${s.ownerFile ?? "?"}` : "NULL")

/** Hand the pass the input it declares: those rows NULL. Then run it. */
function clearAndResolve(db: any, projectId: string, rows: Row[]) {
  const clear = db.prepare(
    `UPDATE brain_relationship SET target_symbol_id = NULL WHERE id IN (
       SELECT r.id FROM brain_relationship r JOIN brain_symbol s ON s.id = r.source_symbol_id
        WHERE r.relationship_type = ? AND s.name = ? AND r.target_external = ?)`,
  )
  for (const row of rows) clear.run(row.type, row.source, row.target)
  return resolveMemberTargetsByOwner(db, projectId)
}

async function main(): Promise<void> {
  const missing = SOURCES.filter((f) => { try { statSync(f); return false } catch { return true } })
  check(missing.length === 0, "every source this gate indexes exists on disk",
    missing.length ? `missing ${missing.map((m) => path.basename(m)).join(", ")} (dir ${SOURCES_DIR})` : `${SOURCES.length} file(s)`)
  if (missing.length) { console.log("\nFAIL — cannot measure: the inputs are not where this file resolves them"); process.exit(1) }

  const projectRoot = mkdtempSync(path.join(tmpdir(), "php-owner-res-"))
  const asIs = await readAll()
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
  const store = async (variant: any[], tag: string): Promise<[string, any]> => {
    const id = `php-owner-res-${tag}-${stamp}`
    await storeResults(id as any, projectRoot, variant)
    return [id, await BrainDatabase.getRawInstance(id as any)]
  }
  const [idA, dbA] = await store(asIs, "a")
  const [idB, dbB] = await store(stripOwner(asIs), "b")
  const [idC, dbC] = await store(stripHeritage(asIs), "c")

  // ---- 1. the premise: no name-keyed strategy can resolve these rows -------------------------
  const collisions = (db: any, name: string) => (db.prepare(`SELECT COUNT(*) c FROM brain_symbol WHERE name = ?`).get(name) as any).c as number
  check(collisions(dbA, "persist") >= 3 && collisions(dbA, "solo") === 2,
    "the premise: the member names collide project-wide, so `_res_name_unique` (HAVING COUNT(*)=1) cannot fire and the dotted fallback has no dot to split",
    `persist=${collisions(dbA, "persist")} declarations, solo=${collisions(dbA, "solo")}`)

  // ---- 2. Stored results must obey the declared receiver channel. ----
  const pinned = rowState(dbA, DIRECT)
  pin(pinned.resolved && pinned.ownerName === "GammaStore",
    "OWNED — `$this->persist()` written in `GammaStore` resolves to the class that DECLARES it",
    `landed on ${describe(pinned)}; the insert-time rank would have said AlphaStore, and until 2026-10-09 this row WAS the pinned defect`)
  for (const [row, why] of NEGATIVES) {
    const state = rowState(dbA, row)
    pin(!state.resolved, `DECLINED — ${row.source} -> ${row.target}: ${why}`, `landed on ${describe(state)}`)
  }

  // ---- 3. THE CLAIM: the pass's contract, given its own input ---------------------------------
  const aResult = clearAndResolve(dbA, idA, [DIRECT, INHERITED, COLLIDING, QUALIFIED_PARENT, QUALIFIED_ANCESTOR, NEAREST, ...NEGATIVES.map(([r]) => r)])
  const d = rowState(dbA, DIRECT)
  check(d.resolved && d.ownerName === "GammaStore",
    "DIRECT — `$this->persist()` resolves to the class that DECLARES it (the receiver's own)", `resolved=${d.resolved} owner=${d.ownerName}`)
  const i = rowState(dbA, INHERITED)
  check(i.resolved && i.ownerName === "BetaStore",
    "INHERITED — written where nothing declares it, resolves through ONE ancestor, which is PHP's own method resolution", `resolved=${i.resolved} owner=${i.ownerName}`)
  const twin = rowState(dbA, COLLIDING)
  check(twin.resolved && twin.ownerName === "Twin" && twin.ownerFile === "gamma.php",
    "COLLIDING OWNER NAME — `$this->solo()` in one of two classes called `Twin` resolves by IDENTITY to the one it is written in",
    `resolved=${twin.resolved} owner=${twin.ownerName}@${twin.ownerFile}`)
  for (const [row, why] of NEGATIVES) {
    const s = rowState(dbA, row)
    check(!s.resolved, `NEGATIVE — ${row.source} -> ${row.target} stays unresolved after the pass`, why)
  }
  for (const row of [QUALIFIED_PARENT, QUALIFIED_ANCESTOR]) {
    const state = rowState(dbA, row)
    check(state.resolved && state.ownerName === "Twin" && state.ownerFile === "delta.php",
      `CANONICAL PARENT — ${row.source} resolves the Twin in its own namespace`, describe(state))
  }
  const nearest = rowState(dbA, NEAREST)
  check(nearest.resolved && nearest.ownerName === "DupBase",
    "IMPLEMENTATION — PHP selects the inherited method over the interface contract", describe(nearest))
  check(aResult.ownerResolved === 3 && aResult.inheritedResolved === 3,
    "the pass's counters agree: three direct, three inherited",
    `ownerResolved=${aResult.ownerResolved} inheritedResolved=${aResult.inheritedResolved} ambiguousOwner=${aResult.ownerAmbiguous} notDeclared=${aResult.notDeclared}`)

  // ---- 4. the signal controls ----------------------------------------------------------------
  const bResult = clearAndResolve(dbB, idB, [DIRECT, INHERITED, COLLIDING])
  const bStates = [rowState(dbB, DIRECT), rowState(dbB, INHERITED), rowState(dbB, COLLIDING)]
  check(bResult.resolved === 0 && bStates.every((s) => !s.resolved),
    "CONTROL B — with both receiver identity fields removed from the analyzer's own result the pass resolves NOTHING (so the resolutions in section 3 are caused by that signal)",
    `resolved=${bResult.resolved} rows=${bStates.map(describe).join(", ")}`)

  const cResult = clearAndResolve(dbC, idC, [DIRECT, INHERITED, COLLIDING])
  const cDirect = rowState(dbC, DIRECT)
  const cInherited = rowState(dbC, INHERITED)
  check(cDirect.resolved && cDirect.ownerName === "GammaStore" && !cInherited.resolved && cResult.inheritedResolved === 0,
    "CONTROL C — with all heritage identity fields removed the DIRECT row still resolves and the INHERITED one does not: the ancestor walk is load-bearing, not a second reading of the owner",
    `direct=${describe(cDirect)} inherited=${describe(cInherited)}`)

  // ---- 5. idempotency, and the rows it must never touch ---------------------------------------
  const again = resolveMemberTargetsByOwner(dbA, idA)
  check(again.resolved === 0, "IDEMPOTENT — re-running the pass over the same store resolves nothing more", `resolved=${again.resolved}`)
  const wrongOwner = dbA.prepare(
    `SELECT COUNT(*) c FROM brain_relationship r
       JOIN brain_symbol s ON s.id = r.source_symbol_id
       LEFT JOIN brain_symbol ts ON ts.id = r.target_symbol_id
      WHERE r.relationship_type IN ('calls','uses') AND r.target_symbol_id IS NOT NULL
        AND ts.owner_symbol_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM brain_symbol os WHERE os.id = ts.owner_symbol_id)`,
  ).get() as any
  check(wrongOwner.c === 0, "no resolved member row names an owner that does not exist", `dangling=${wrongOwner.c}`)

  await dbA.close?.(); await dbB.close?.(); await dbC.close?.()
  console.log(`\n${failures.length === 0 ? "PASS" : "FAIL"} — ${failures.length ? failures.join("; ") : "php owner resolution gate"}`)
  process.exit(failures.length === 0 ? 0 : 1)
}
void main()
