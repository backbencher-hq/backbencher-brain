/**
 * OWNER-RESOLUTION GATE, PYTHON — the member channel on this lane, measured on the STORE
 * against inputs built to defeat every name-keyed strategy.
 *
 * ## The gap this closes
 *
 * Until this change python published NO relation-level owner channel: an analyzer sweep of
 * the whole admitted corpus found `metadata.owner` on 0 `calls`/`uses` edges, so the store's
 * `resolveMemberTargetsByOwner` (`src/ast/member-owner-resolution.ts`) — php's PHPD42 lever,
 * language-agnostic and scoped by the DATA (the presence of the key) rather than by a
 * language switch — had no input on this lane. Every python member edge therefore fell to the
 * store's name-keyed ranking (`resolveTargetStmt`): same file first, then lexicographic `s.id`
 * as TEXT, which binds a bare member name to whichever same-named declaration sorts first. A
 * member name is not identifying (`persist` is a method on many classes at once), so that is a
 * tie-break, not a fact about python, and the row is stored RESOLVED anyway.
 *
 * `real-python-analyzer.ts` now publishes `metadata.owner` on the member edges whose receiver
 * the analyzer can NAME: exactly `self.m()` / `cls.m()`, one dot, receiver the implicit first
 * parameter. See `memberOwnerOf` there for why that boundary is load-bearing (`self.store.save`
 * is NOT among them — `save` belongs to the VALUE of `self.store`). `python/member-owner-channel`
 * pins the analyzer's SIGNAL; THIS file pins what the store does with it.
 *
 * ## The three stores, and why one would not do
 *
 * The pass reads two independent signals — `metadata.owner` on the relation and `super_types`
 * on the symbol — and one store cannot separate them: a pass that resolved by owner alone,
 * with no walk, would light up the DIRECT row and be wrong about the INHERITED one. So the same
 * five files are stored three times, one signal removed from the analyzer's OWN result each
 * time, and the same rows are cleared and re-resolved in each:
 *
 *   A  as-is               direct -> GammaStore::persist  inherited -> AlphaStore::persist
 *   B  no `metadata.owner` NOTHING resolves — the pass has no input at all
 *   C  no `super_types`    direct still resolves, inherited NULL — the walk is load-bearing
 *
 * ## What it does NOT prove
 *
 * Not the population effect: this is five files, and `python-endpoint-resolution.ts` is the
 * instrument that sizes the lever over the corpus. Not that every resolvable row resolves — the
 * negatives are asserted as NULL with the rule that declined them named below, because a
 * boundary that is not asserted is a boundary that moves. And NOT the pipeline: this gate calls
 * `storeResults` directly so it can build its variants, exactly as php's gate does;
 * `store-heritage-seam.mts` is what proves the REAL pipeline (`indexProjectParallel`) carries the
 * `super_types` column the walk reads.
 *
 * Usage: bun validation/m14/fixtures/python/owner-resolution-gate.mts
 */
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { ASTEngine } from "../../../../src/ast/engine"
import { storeResults } from "../../../../src/ast/parallel-indexer"
import { resolveMemberTargetsByOwner } from "../../../../src/ast/member-owner-resolution"
import { BrainDatabase } from "../../../../src/brain/database"
import { fileURLToPath } from "node:url"

/** `class AlphaStore` — the ancestor both DIRECT and INHERITED resolve to or through. */
const ALPHA_PY = `"""The base every member row below is walked to, or from."""\n\n\nclass AlphaStore:\n    def __init__(self):\n        self.record = None\n\n    def persist(self, record):\n        self.record = record\n        return self.record\n`

/** `class BetaStore(AlphaStore)` — INHERITED: nothing here declares `persist`; the ancestor does. */
const BETA_PY = `from alpha import AlphaStore\n\n\nclass BetaStore(AlphaStore):\n    def go_inherited(self):\n        return self.persist("x")\n`

/** `class GammaStore` — DIRECT: the receiver's own class declares `persist`. */
const GAMMA_PY = `class GammaStore:\n    def persist(self, record):\n        return record\n\n    def go_direct(self):\n        return self.persist("y")\n`

/**
 * TWO classes called `Twin` in ONE file. Rule 0 answers the receiver by IDENTITY (the class the
 * call is written in), so the name collision must not make the answer ambiguous — which is the
 * whole reason the store's rule 0 is asked before any name lookup.
 */
const DELTA_PY = `class Twin:\n    def solo(self):\n        return 1\n\n    def go_twin(self):\n        return self.solo()\n\n\nclass Twin:\n    def solo(self):\n        return 2\n`

/**
 * The NEGATIVES, each with the rule that must decline it. `go_local`'s receiver is a local whose
 * type is written down nowhere; `go_module_self`'s `self` is an ordinary parameter of a
 * module-level function, so there is no enclosing class to name. Both carry NO owner, so the
 * pass never sees them.
 */
const NEG_PY = `from gamma import GammaStore\n\n\ndef go_local():\n    store = GammaStore()\n    return store.persist("z")\n\n\ndef go_module_self(self):\n    return self.thing()\n`

/**
 * TWO declarations of ONE member: a class-body annotation (`value: int`, PEP 526) and an instance
 * assignment (`self.value = 0`). The analyzer publishes a Property for each — the annotation as a
 * class variable, the assignment as an instance attribute — and the independent oracle corroborates
 * BOTH (`walkClassBody` / `instanceAttrSeen` in `oracles/python-truth.ts`), so neither may be
 * dropped. They share owner, name and kind: they are the same member written twice, and the pass
 * resolves them rather than declining. This is the case PY-D10 measured on `requests` (162 of 180
 * declines) — the row that turns `ambiguousInChain` into a resolution.
 */
const DUPE_PY = `class DupeStore:\n    value: int\n\n    def __init__(self):\n        self.value = 0\n\n    def go_dupe(self):\n        return self.value\n`

type Row = { source: string; target: string; type: string }
type State = { resolved: boolean; ownerName: string | null; ownerFile: string | null }

const DIRECT: Row = { source: "go_direct", target: "persist", type: "calls" }
const INHERITED: Row = { source: "go_inherited", target: "persist", type: "calls" }
const COLLIDING: Row = { source: "go_twin", target: "solo", type: "calls" }
const DUPLICATE: Row = { source: "go_dupe", target: "value", type: "uses" }
const NEGATIVES: [Row, string][] = [
  [{ source: "go_local", target: "persist", type: "calls" }, "no declared receiver (a local) — the analyzer publishes no owner BY DESIGN"],
  [{ source: "go_module_self", target: "thing", type: "calls" }, "`self` is a module-level parameter — there is no enclosing class to name"],
]

const failures: string[] = []
function check(ok: boolean, what: string, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}${detail ? `  ${detail}` : ""}`)
  if (!ok) failures.push(what)
}

const HERE = (import.meta as any).dirname ?? path.dirname(fileURLToPath(import.meta.url))

async function readAll(dir: string): Promise<any[]> {
  const files = ["alpha.py", "beta.py", "gamma.py", "delta.py", "dupe.py", "negatives.py"]
  const out: any[] = []
  for (const f of files) {
    const abs = path.join(dir, f)
    const r: any = await ASTEngine.parseFile(abs, await (await import("node:fs")).readFileSync(abs, "utf8"))
    out.push({
      filePath: abs, success: true, symbols: r.symbols ?? [], relationships: r.relationships ?? [], imports: r.imports ?? [],
      language: "python", fileHash: `owner-resolution-gate-${f}`, sizeBytes: 0, lastModified: 0,
    })
  }
  return out
}
const stripOwner = (all: any[]): any[] =>
  all.map((r) => ({ ...r, relationships: (r.relationships ?? []).map((x: any) => {
    if (!x?.metadata || typeof x.metadata !== "object" || !("owner" in x.metadata)) return x
    const { owner: _dropped, ...rest } = x.metadata
    return { ...x, metadata: rest }
  }) }))
const stripHeritage = (all: any[]): any[] =>
  all.map((r) => ({ ...r, symbols: (r.symbols ?? []).map((s: any) => {
    if (!s?.metadata || typeof s.metadata !== "object" || !("superTypes" in s.metadata)) return s
    const { superTypes: _dropped, ...rest } = s.metadata
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
  const data = mkdtempSync(path.join(tmpdir(), "py-owner-data-"))
  process.env.BB_DATA_DIR = data
  const project = mkdtempSync(path.join(tmpdir(), "py-owner-proj-"))
  const sources: Record<string, string> = { "alpha.py": ALPHA_PY, "beta.py": BETA_PY, "gamma.py": GAMMA_PY, "delta.py": DELTA_PY, "dupe.py": DUPE_PY, "negatives.py": NEG_PY }
  for (const [f, text] of Object.entries(sources)) writeFileSync(path.join(project, f), text)

  console.log("python owner-resolution gate (the member channel, measured on the store)")
  console.log(`  project: ${project}`)

  const asIs = await readAll(project)
  const nOwner = asIs.flatMap((r) => r.relationships as any[]).filter((r) => (r.metadata as any)?.owner).length
  const nSelf = asIs.flatMap((r) => r.relationships as any[]).filter((r) => typeof (r.metadata as any)?.qualified === "string" && /^(self|cls)\./.test((r.metadata as any).qualified)).length
  check(nOwner > 0, "the premise: the analyzer publishes `metadata.owner` on at least one member edge (it published NONE before this change)", `owner-carrying=${nOwner}; self./cls.-rooted member edges=${nSelf}`)

  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
  const store = async (variant: any[], tag: string): Promise<[string, any]> => {
    const id = `py-owner-res-${tag}-${stamp}`
    await storeResults(id as any, project, variant)
    return [id, await BrainDatabase.getRawInstance(id as any)]
  }
  const [idA, dbA] = await store(asIs, "a")
  const [idB, dbB] = await store(stripOwner(asIs), "b")
  const [idC, dbC] = await store(stripHeritage(asIs), "c")

  // ---- 1. the premise: no name-keyed strategy can identify these rows ------------------------
  const collisions = (db: any, name: string) => (db.prepare(`SELECT COUNT(*) c FROM brain_symbol WHERE name = ?`).get(name) as any).c as number
  check(collisions(dbA, "persist") >= 2 && collisions(dbA, "solo") === 2,
    "the premise: the member names collide project-wide, so `_res_name_unique` (HAVING COUNT(*)=1) cannot fire — the ranking, if it runs, must pick one of several by tie-break",
    `persist=${collisions(dbA, "persist")} declarations (AlphaStore, GammaStore), solo=${collisions(dbA, "solo")} (the two Twins)`)

  // ---- 2. the OWNER CHANNEL is authoritative inside storeResults, where the pass actually runs
  const d0 = rowState(dbA, DIRECT)
  check(d0.resolved && d0.ownerName === "GammaStore",
    "DIRECT — `self.persist()` written in `GammaStore` resolves to the class that DECLARES it",
    `landed on ${describe(d0)}`)
  const i0 = rowState(dbA, INHERITED)
  check(i0.resolved && i0.ownerName === "AlphaStore",
    "INHERITED — written where nothing declares it, resolves through ONE ancestor, which is python's own MRO",
    `landed on ${describe(i0)}`)
  const t0 = rowState(dbA, COLLIDING)
  check(t0.resolved && t0.ownerName === "Twin" && t0.ownerFile === "delta.py",
    "COLLIDING OWNER NAME — `self.solo()` in one of two classes called `Twin` resolves by IDENTITY to the one it is written in",
    `landed on ${describe(t0)}`)
  const p0 = rowState(dbA, DUPLICATE)
  check(p0.resolved && p0.ownerName === "DupeStore",
    "DUPLICATE MEMBER — `self.value` resolves even though the class declares `value` TWICE (an annotation and an instance assignment): same owner+name+kind is ONE member",
    `landed on ${describe(p0)}`)

  // ---- 3. THE CLAIM: the pass's contract, given its own input ---------------------------------
  const aResult = clearAndResolve(dbA, idA, [DIRECT, INHERITED, COLLIDING, DUPLICATE, ...NEGATIVES.map(([r]) => r)])
  const d = rowState(dbA, DIRECT)
  check(d.resolved && d.ownerName === "GammaStore",
    "DIRECT — after clearing, the owner channel re-binds to the receiver's own class", `landed on ${describe(d)}`)
  const i = rowState(dbA, INHERITED)
  check(i.resolved && i.ownerName === "AlphaStore",
    "INHERITED — resolves through exactly one ancestor (the walk is what answers it)", `landed on ${describe(i)}`)
  const twin = rowState(dbA, COLLIDING)
  check(twin.resolved && twin.ownerName === "Twin" && twin.ownerFile === "delta.py",
    "COLLIDING — identity, not name: the twin it is written in", `landed on ${describe(twin)}`)
  const dupe = rowState(dbA, DUPLICATE)
  check(dupe.resolved && dupe.ownerName === "DupeStore",
    "DUPLICATE — after clearing, the same-kind duplicate set binds to ONE of its own declarations", `landed on ${describe(dupe)}`)
  for (const [row, why] of NEGATIVES) {
    const s = rowState(dbA, row)
    check(!s.resolved, `NEGATIVE — ${row.source} -> ${row.target} stays unresolved after the pass`, why)
  }
  check(aResult.ownerResolved >= 2 && aResult.inheritedResolved >= 1 && aResult.sameKindDuplicateResolved >= 1,
    "the pass's own counters agree with the rows: at least two direct (one of them a same-kind duplicate), one through an ancestor",
    `ownerResolved=${aResult.ownerResolved} (duplicate=${aResult.sameKindDuplicateResolved}) inheritedResolved=${aResult.inheritedResolved} ambiguousInChain=${aResult.ambiguousInChain} notDeclared=${aResult.notDeclared}`)

  // ---- 4. the signal controls ------------------------------------------------------------------
  const bResult = clearAndResolve(dbB, idB, [DIRECT, INHERITED, COLLIDING, DUPLICATE])
  const bStates = [rowState(dbB, DIRECT), rowState(dbB, INHERITED), rowState(dbB, COLLIDING), rowState(dbB, DUPLICATE)]
  check(bResult.resolved === 0 && bStates.every((s) => !s.resolved),
    "CONTROL B — with `metadata.owner` removed from the analyzer's own result the pass resolves NOTHING (so the resolutions in section 3 are caused by that signal)",
    `resolved=${bResult.resolved} rows=${bStates.map(describe).join(", ")}`)

  const cResult = clearAndResolve(dbC, idC, [DIRECT, INHERITED, COLLIDING, DUPLICATE])
  const cDirect = rowState(dbC, DIRECT)
  const cInherited = rowState(dbC, INHERITED)
  check(cDirect.resolved && cDirect.ownerName === "GammaStore" && !cInherited.resolved && cResult.inheritedResolved === 0,
    "CONTROL C — with `super_types` removed the DIRECT row still resolves and the INHERITED one does not: the ancestor walk is load-bearing, not a second reading of the owner",
    `direct=${describe(cDirect)} inherited=${describe(cInherited)}`)

  // ---- 5. idempotency, and the rows it must never touch -----------------------------------------
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
  console.log(`\n${failures.length === 0 ? "PASS" : "FAIL"} — ${failures.length ? failures.join("; ") : "python owner resolution gate"}`)
  process.exit(failures.length === 0 ? 0 : 1)
}
void main()
