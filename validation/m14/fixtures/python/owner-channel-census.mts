/**
 * OWNER-CHANNEL CENSUS, PYTHON — how much of the member population the owner channel can
 * BIND, measured on a real repo through the REAL index and the REAL resolution pass.
 *
 * `owner-resolution-gate.mts` proves the CONTRACT on five crafted files; this prices the LEVER
 * the way php's `store-resolution-census.mts` does for its lane. The question it answers is the
 * one a fixture cannot: of every `calls`/`uses` row python publishes whose receiver the analyzer
 * can name (`metadata.owner`), how many does `resolveMemberTargetsByOwner` bind to a declaration
 * the receiver's own class chain holds, and how many does it decline?
 *
 * The number that matters is the DECLINED column as much as the RESOLVED one: the pass withdraws
 * every owner-carrying row from the store's name-keyed ranking before it runs, so a row it
 * declines becomes an honest NULL where the ranking would have kept a lucky (and unverifiable)
 * binding. A high resolved count and a low declined count together say the channel is a net gain;
 * a high declined count would say the boundary is too wide and should be narrowed.
 *
 * READ-ONLY over the corpus: the python files are COPIED into a temp project so nothing is
 * indexed in place, and all index state goes to a temp BB_DATA_DIR. The repo is named by
 * `BB_PY_REPO` (default `requests`, the smallest Python-bearing checkout on this box) under
 * `BB_CORPUS_ROOT`.
 *
 * REFUSES rather than reports zero when its corpus is absent: a census that silently prints
 * all-zeros for a missing repo is worse than one that does not run, because the zeros read
 * like a finding.
 *
 * Usage: bun validation/m14/fixtures/python/owner-channel-census.mts [--repo NAME]
 */
import { mkdtempSync, mkdirSync, readdirSync, statSync, copyFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import * as path from "node:path"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const argv = process.argv.slice(2)
const argOf = (f: string) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined }
const REPO = argOf("--repo") ?? process.env.BB_PY_REPO ?? "requests"
const repoDir = path.join(CR, REPO)
const MAX_BYTES = 512 * 1024

if (!existsSync(repoDir) || !statSync(repoDir).isDirectory()) {
  console.error(`no repo at ${repoDir} — this census refuses to report a zero from a missing corpus (set BB_CORPUS_ROOT/BB_PY_REPO)`)
  process.exit(2)
}

async function main(): Promise<void> {
  const data = mkdtempSync(path.join(tmpdir(), "py-owner-census-data-"))
  process.env.BB_DATA_DIR = data
  const project = mkdtempSync(path.join(tmpdir(), "py-owner-census-proj-"))

  // Copy the python files, preserving the tree, so the corpus is never indexed in place.
  let copied = 0
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === ".git" || e.name === "node_modules") continue
      const abs = path.join(d, e.name)
      if (e.isDirectory()) { walk(abs); continue }
      if (!(e.name.endsWith(".py") || e.name.endsWith(".pyi"))) continue
      try { if (statSync(abs).size > MAX_BYTES) continue } catch { continue }
      const rel = path.relative(repoDir, abs)
      const dest = path.join(project, rel)
      mkdirSync(path.dirname(dest), { recursive: true })
      copyFileSync(abs, dest)
      copied++
    }
  }
  walk(repoDir)

  console.log(`python owner-channel census — repo ${REPO} (${copied} python file(s) ≤ 512 KiB)`)
  if (copied === 0) { console.error("the repo carries no python files under the size cap — nothing to measure"); process.exit(2) }

  const { getProjectId } = (await import("../../../../src/cli/index.ts")) as any
  const { indexProjectParallel } = (await import("../../../../src/ast/parallel-indexer.ts")) as any
  const { BrainDatabase } = (await import("../../../../src/brain/database.ts")) as any
  const { resolveMemberTargetsByOwner } = (await import("../../../../src/ast/member-owner-resolution.ts")) as any
  const pid = getProjectId(project) as any
  await indexProjectParallel(pid, project, {})

  const db = await BrainDatabase.getRawInstance(pid)
  const rows = db
    .prepare(`SELECT id, relationship_type, target_external, metadata FROM brain_relationship WHERE project_id = ? AND relationship_type IN ('calls','uses')`)
    .all(pid) as any[]
  const ownerOf = (r: any): string | undefined => {
    try { const m = JSON.parse(String(r.metadata ?? "{}")); return typeof m?.owner === "string" ? m.owner : undefined } catch { return undefined }
  }
  const ownerRows = rows.filter((r) => ownerOf(r) !== undefined)
  const memberRows = rows.length

  console.log(`member rows (calls+uses): ${memberRows}`)
  console.log(`owner-carrying rows (metadata.owner present): ${ownerRows.length}  (${memberRows ? (100 * ownerRows.length / memberRows).toFixed(1) : "-"}% of member rows)`)
  const byReason = new Map<string, number>()
  for (const r of ownerRows) {
    let rc = "?"
    try { rc = JSON.parse(String(r.metadata ?? "{}"))?.reasonCode ?? "?" } catch { /* */ }
    byReason.set(String(rc), (byReason.get(String(rc)) ?? 0) + 1)
  }
  console.log(`  by reasonCode: ${[...byReason.entries()].map(([k, v]) => `${k}:${v}`).join(" ")}`)

  // The pass's own counters, over its exact input: clear the owner rows, run it, read the split.
  const clear = db.prepare(`UPDATE brain_relationship SET target_symbol_id = NULL WHERE id = ?`)
  for (const r of ownerRows) clear.run(String(r.id))
  const res = resolveMemberTargetsByOwner(db, pid)
  const declined = res.ownerNotInPopulation + res.ownerAmbiguous + res.notDeclared + res.ambiguousInChain
  console.log(`\nthe pass over its input (all owner rows cleared first):`)
  console.log(`  scanned           ${res.scanned}`)
  console.log(`  RESOLVED (total)  ${res.resolved}   owner=${res.ownerResolved} (of which same-kind duplicate=${res.sameKindDuplicateResolved})  inherited=${res.inheritedResolved}`)
  console.log(`  DECLINED (total)  ${declined}   notInPopulation=${res.ownerNotInPopulation}  ownerAmbiguous=${res.ownerAmbiguous}  notDeclared=${res.notDeclared}  ambiguousInChain=${res.ambiguousInChain}`)
  console.log(`  resolved share of owner rows: ${res.scanned ? (100 * res.resolved / res.scanned).toFixed(1) : "-"}%`)

  // CHARACTERIZE THE DECLINES, so `ambiguousInChain` is not a bare number. For each row the
  // pass left NULL, count the same-named members in the owner's OWN class. A count of 0 is a
  // name the class does not declare (inherited-or-foreign, or filtered by the type's kind).
  // A count > 1 in the SAME KIND is NO LONGER a decline: the pass resolves a same-owner/name/kind
  // candidate set as ONE member (python's annotation `x: T` beside `self.x = ...`, or a run of
  // `@overload` stubs). A count > 1 that STILL declines is a genuinely MULTI-KIND set (a name a
  // class carries as both a method and a property) — two different members, which the pass refuses
  // to pick between. Before round 5 the duplicate rows landed in `ambiguousInChain`; they now land
  // in `ownerResolved`/`sameKindDuplicateResolved`, and this breakdown is how a reader sees it.
  const declinedRows = db.prepare(
    `SELECT r.target_external AS tgt, s.name AS src, so.name AS src_owner, so.id AS src_owner_id, r.metadata AS md
       FROM brain_relationship r
       LEFT JOIN brain_symbol s ON s.id = r.source_symbol_id
       LEFT JOIN brain_symbol so ON so.id = s.owner_symbol_id
      WHERE r.project_id = ? AND r.relationship_type IN ('calls','uses')
        AND r.target_symbol_id IS NULL AND r.metadata LIKE '%"owner":%'`,
  ).all(pid) as any[]
  const classIds = new Map<string, string[]>()
  for (const c of db.prepare(`SELECT id, name FROM brain_symbol WHERE project_id = ? AND symbol_type IN ('class','interface','trait','enum')`).all(pid) as any[]) {
    const l = classIds.get(String(c.name)) ?? (classIds.set(String(c.name), []), classIds.get(String(c.name))!)
    l.push(String(c.id))
  }
  const memberCount = db.prepare(`SELECT COUNT(*) c FROM brain_symbol WHERE project_id = ? AND owner_symbol_id = ? AND name = ?`)
  const buckets = new Map<number, number>()
  const samples: string[] = []
  for (const r of declinedRows) {
    let owner = ""
    try { owner = JSON.parse(String(r.md ?? "{}"))?.owner ?? "" } catch { /* */ }
    if (!owner) continue
    const ownerId = r.src_owner_id && String(r.src_owner) === owner
      ? String(r.src_owner_id)
      : (classIds.get(owner)?.length === 1 ? classIds.get(owner)![0] : "")
    const n = ownerId ? ((memberCount.get(pid, ownerId, String(r.tgt)) as any).c as number) : 0
    buckets.set(n, (buckets.get(n) ?? 0) + 1)
    if (n > 1 && samples.length < 6) samples.push(`${r.src_owner}.${r.tgt}[${n}]`)
  }
  console.log(`\ndeclined rows, by same-named member count in the owner's OWN class:`)
  for (const [n, c] of [...buckets.entries()].sort((a, b) => a[0] - b[0])) {
    const why = n === 0
      ? "the class does not declare it — inherited-or-foreign, or excluded by the type's kind filter"
      : n === 1
        ? "one same-named member, but excluded by the type's kind filter (e.g. a `uses` on a method)"
        : `${n} same-named members of DIFFERENT KINDS — a real ambiguity; the same-kind duplicate case resolves and no longer reaches here`
    console.log(`  ${n} same-named member(s): ${c} row(s)  (${why})`)
  }
  if (samples.length) console.log(`  e.g. ${samples.join(" ")}`)
  console.log(`\nnote: every owner row was WITHDRAWN from the name-keyed ranking inside the index; a declined row is`)
  console.log(`      an honest NULL where the ranking would have kept an unverifiable binding, so declined is not a loss`)
  console.log(`      of a TRUE edge — it is the removal of a tie-break that was never a fact about python.`)
  await db.close?.()
}
void main().catch((e) => { console.error(e); process.exit(1) })
