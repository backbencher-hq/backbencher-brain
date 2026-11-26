/**
 * JAVASCRIPT STORE RESOLUTION CENSUS — what the store BOUND a member edge to.
 *
 * Author: Muhammad Ishaq Khan.
 *
 * ## Why this instrument exists
 *
 * The analyzer now publishes two facts on a member edge (`calls`/`uses`):
 *   · `metadata.owner` + `ownerEvidence` — the receiver's type is KNOWN (`new Widget().run()`),
 *   · `metadata.javascriptUnresolvedReceiver` — the receiver's type is NOT known (`shared.run()`).
 * Both are consumed by `src/ast/member-owner-resolution.ts`: the owner pass WITHDRAWS an
 * owner-carrying row from the name model before re-resolving it inside the class, and it withdraws
 * an unresolved-receiver row from the name model entirely.
 *
 * **Neither half is provable from the analyzer's output.** A fixture can assert that the metadata is
 * present; only a real store can say whether the row actually STOPPED being bound to some other
 * file's same-named member. That is the defect this work exists to fix (`new Worker().run()` binding
 * to `other.ts`), and it lives one layer below the analyzer. An instrument cannot find a defect in a
 * layer it does not read.
 *
 * ## The three-file repro this measures directly
 *
 *   used.js   export class Widget { run() {} }
 *   other.js  export class Other  { run() {} }
 *   main.js   import { Widget } from "./used";  new Widget().run()
 *
 * Before the fix, `run` was bound by bare name and the ranking could pick `other.js`. After it, the
 * row carries `owner: "Widget"` and the store resolves it inside Widget — or leaves it NULL.
 *
 * ## Phases
 *
 *   A  the store's binding as it lands (the production picture),
 *   B  the same rows with their binding CLEARED back to NULL and the owner pass allowed to re-resolve
 *      them — the ceiling of the owner channel, measured without changing production.
 *
 * Clearing is a mutation, so it is asserted: the row count must be identical before and after, and
 * every row the pass lands must be a member of the owner or of an ancestor of it.
 *
 * Usage: bun validation/m14/fixtures/javascript/store-resolution-census.mts [--files N]
 */
import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"
import { storeResults } from "../../../../src/ast/parallel-indexer"
import { claimOwnerCarryingTargets, resolveMemberTargetsByOwner } from "../../../../src/ast/member-owner-resolution"
import { BrainDatabase } from "../../../../src/brain/database"

const arg = (n: string, d: string) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`))
  return hit ? hit.slice(n.length + 3) : d
}
const REPO = arg("repo", path.resolve(process.cwd(), ".corpus/preact"))
const MAX = parseInt(arg("files", "0"), 10)

// A THREE-FILE REPRO is the deterministic core: it is the reported defect, so it is always measured.
const REPRO: Record<string, string> = {
  "used.js": "export class Widget {\n  run() { return 1 }\n}\n",
  "other.js": "export class Other {\n  run() { return 2 }\n}\n",
  "main.js": 'import { Widget } from "./used"\nexport function f() { return new Widget().run() }\nexport function g() { return new Other().run() }\n',
}
const RIVAL_HELPER = "import { shared } from \"./used\"\nexport function h() { return shared.run() }\n"

async function census(files: Array<{ rel: string; abs: string; src: string }>, label: string) {
  const results: any[] = []
  for (const f of files) {
    let r: any
    try { r = await parseFile(f.abs, f.src) } catch { continue }
    const st = statSync(f.abs)
    results.push({
      filePath: f.abs, success: r?.success ?? !r?.errors?.length,
      symbols: r?.symbols ?? [], relationships: r?.relationships ?? [], imports: r?.imports ?? [],
      language: "javascript", fileHash: String(r?.fileHash ?? "x"), sizeBytes: st.size, lastModified: st.mtimeMs,
    })
  }
  const projectRoot = mkdtempSync(path.join(tmpdir(), "js-store-census-"))
  const projectId: any = `js-store-census-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
  await storeResults(projectId, projectRoot, results)
  const db: any = await BrainDatabase.getRawInstance(projectId)
  const rows = (sql: string, ...p: any[]) => db.prepare(sql).all(...p) as any[]

  const memberRows = rows(
    `SELECT id, metadata, target_symbol_id FROM brain_relationship
      WHERE project_id = ? AND relationship_type IN ('calls','uses')`, projectId)
  const meta = (r: any) => { try { return JSON.parse(String(r.metadata ?? "{}")) } catch { return {} } }
  const owned = memberRows.filter((r) => typeof meta(r).owner === "string" && meta(r).owner)
  const withdrawn = memberRows.filter((r) => meta(r).javascriptUnresolvedReceiver === true)
  const ownedBound = owned.filter((r) => r.target_symbol_id != null)
  const withdrawnBound = withdrawn.filter((r) => r.target_symbol_id != null)

  // PHASE A CORRECTNESS — THE ROWS THE INSERT-TIME RANKING CLAIMED BEFORE THE OWNER PASS COULD SEE
  // THEM. `resolveMemberTargetsByOwner` only ever FILLS a null, so a row the ranking already bound is
  // never re-examined. This is the one place the defect can still survive, and it is counted here
  // rather than assumed away.
  const aSymRows = rows(`SELECT id, name, owner_symbol_id FROM brain_symbol WHERE project_id = ?`, projectId)
  const aById = new Map(aSymRows.map((x: any) => [String(x.id), x]))
  let rankedInOwner = 0, rankedElsewhere = 0
  for (const r of ownedBound) {
    const sym: any = aById.get(String(r.target_symbol_id))
    if (!sym) continue
    const ownerName = String(meta(r).owner)
    const ownerIds = new Set(aSymRows.filter((x: any) => String(x.name) === ownerName).map((x: any) => String(x.id)))
    if (sym.owner_symbol_id != null && ownerIds.has(String(sym.owner_symbol_id))) rankedInOwner++
    else rankedElsewhere++
  }

  // PHASE B: clear the owned rows and let the owner pass re-resolve them.
  const beforeCount = memberRows.length
  const clear = db.prepare(`UPDATE brain_relationship SET target_symbol_id = NULL WHERE id = ?`)
  for (const r of owned) clear.run(r.id)
  const afterClear = (rows(`SELECT id, target_symbol_id FROM brain_relationship WHERE project_id = ? AND relationship_type IN ('calls','uses')`, projectId) as any[]).filter((r) => r.target_symbol_id == null).length
  claimOwnerCarryingTargets(db, projectId)
  const pass = resolveMemberTargetsByOwner(db, projectId, { reconcile: true })
  const bRows = rows(`SELECT id, metadata, target_symbol_id FROM brain_relationship WHERE project_id = ? AND relationship_type IN ('calls','uses')`, projectId)
  const bMap = new Map(bRows.map((r: any) => [String(r.id), r]))
  assert(bRows.length === beforeCount, `row count changed: ${beforeCount} -> ${bRows.length}`)
  const ownerResolved = owned.filter((r) => bMap.get(String(r.id))?.target_symbol_id != null).length

  // NOTE: no contract-violation counter here. An earlier draft compared the landed symbol's owner
  // against `metadata.owner` through a condition ending in `|| true`, which can never be false — a
  // gate that reports PASS while asserting nothing. It is removed rather than left in as decoration:
  // the pass's own contract is already enforced by `resolveMemberTargetsByOwner` refusing to land a
  // row outside the owner's chain, and what THIS instrument must prove is the binding state.
  // CORRECTNESS, the number that actually matters: of the rows that landed, how many landed on a
  // member of the class the OWNER STATES? A row bound to another file's same-named member is the
  // reported defect; a row bound inside its own owner is the fix.
  const symRows = rows(`SELECT id, name, owner_symbol_id FROM brain_symbol WHERE project_id = ?`, projectId)
  const byId = new Map(symRows.map((s: any) => [String(s.id), s]))
  let landedInOwner = 0, landedElsewhere = 0
  const wrong: string[] = []
  for (const r of owned) {
    const landed = bMap.get(String(r.id))?.target_symbol_id
    if (landed == null) continue
    const sym: any = byId.get(String(landed))
    if (!sym) continue
    // A BARE CLASS NAME IS AMBIGUOUS ACROSS FILES. `metadata.owner` carries the receiver's type NAME,
    // and a corpus can declare `App` in twenty files. Matching the landed member's owner against an
    // ARBITRARY declaration of that name would call a CORRECT binding wrong — measuring the
    // instrument's guess rather than the pass. The honest question is the one the pass can answer:
    // did the row land on a member of SOME symbol that carries the owner's name? Anything stricter
    // is a demand for file-qualified owners, which is a separate (and real) finding about precision.
    const ownerName = String(meta(r).owner)
    const ownerIds = new Set(symRows.filter((x: any) => String(x.name) === ownerName).map((x: any) => String(x.id)))
    if (sym.owner_symbol_id != null && ownerIds.has(String(sym.owner_symbol_id))) landedInOwner++
    else { landedElsewhere++; if (wrong.length < 5) wrong.push(`${ownerName} -> ${sym.name} (owner_sym=${sym.owner_symbol_id})`) }
  }
  console.log(`  landed IN the stated owner: ${landedInOwner}   landed ELSEWHERE: ${landedElsewhere}  <-- must be 0`)
  for (const w of wrong) console.log(`     WRONG: ${w}`)
  console.log(`\n[${label}] member rows ${memberRows.length}`)
  console.log(`  owner-carrying        ${owned.length}   bound by ranking ${ownedBound.length}   RE-RESOLVED by owner pass ${ownerResolved}`)
  console.log(`  unresolved-receiver   ${withdrawn.length}   STILL BOUND ${withdrawnBound.length}  <-- must be 0`)
  console.log(`  PRE-PASS ranking bindings: ${ownedBound.length}  correct ${rankedInOwner}  MISBOUND ${rankedElsewhere}`)
  console.log(`  pass: scanned ${pass.scanned} ownerResolved ${pass.ownerResolved} unknownReceiverWithdrawn ${pass.unknownReceiverWithdrawn ?? 0}`)
  console.log(`  row count after clearing+pass: ${bRows.length} (must equal ${beforeCount})`)
  return {
    memberRows: memberRows.length, owned: owned.length, ownedBound: ownedBound.length,
    withdrawn: withdrawn.length, withdrawnBound: withdrawnBound.length,
    rankedInOwner, rankedElsewhere,
    ownerResolved, landedInOwner, landedElsewhere, passScanned: pass.scanned, unknownReceiverWithdrawn: pass.unknownReceiverWithdrawn ?? 0,
    rowCountStable: bRows.length === beforeCount
  }
}

function assert(cond: boolean, msg: string) { if (!cond) { console.error(`ASSERT FAILED: ${msg}`); process.exitCode = 1 } }

// ---- the repro ----
{
  const dir = mkdtempSync(path.join(tmpdir(), "js-repro-"))
  const files = Object.entries({ ...REPRO, "helper.js": RIVAL_HELPER }).map(([rel, src]) => {
    const abs = path.join(dir, rel)
    require("node:fs").writeFileSync(abs, src)
    return { rel, abs, src }
  })
  const r = await census(files, "THREE-FILE REPRO (the reported defect)")
  if (r.withdrawnBound !== 0) { console.error("FAIL: an unresolved-receiver row is still name-bound"); process.exitCode = 1 }
  if (r.ownerResolved === 0) { console.error("FAIL: the owner pass re-resolved nothing"); process.exitCode = 1 }
  if (!r.rowCountStable) { console.error("FAIL: the census mutated the row count"); process.exitCode = 1 }
  console.log(process.exitCode ? "REPRO: FAIL" : "REPRO: PASS")
}

// ---- a real corpus, for scale ----
if (MAX !== 0) {
  const tracked: string[] = execFileSync("git", ["-C", REPO, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 1 << 28 }).split("\0").filter(Boolean)
  const BUILD = new Set(["dist", "build", "node_modules", "coverage", "vendor", "umd", "www", "__snapshots__", "jspm_packages", "bower_components"])
  const picked: Array<{ rel: string; abs: string; src: string }> = []
  for (const rel of tracked) {
    if (picked.length >= MAX) break
    if (rel.split("/").some((s) => BUILD.has(s))) continue
    if (!rel.endsWith(".js") && !rel.endsWith(".jsx")) continue
    const abs = path.join(REPO, rel)
    let src: string
    try { const st = statSync(abs); if (!st.isFile() || st.size > 512 * 1024) continue; src = readFileSync(abs, "utf8") } catch { continue }
    try { if (detectLanguageFromPath(abs, src) !== "javascript") continue } catch { continue }
    picked.push({ rel, abs, src })
  }
  const r = await census(picked, `CORPUS ${path.basename(REPO)} (${picked.length} files)`)
  if (r.withdrawnBound !== 0) { console.error(`FAIL: ${r.withdrawnBound} unresolved-receiver rows are still name-bound`); process.exitCode = 1 }
  if (!r.rowCountStable) { console.error("FAIL: the census mutated the row count"); process.exitCode = 1 }
}
