/**
 * PHP STORE RESOLUTION CENSUS — what the store BOUND a member edge to.
 *
 * ## Why this is a separate instrument from `reason-census.mts`
 *
 * The lane's reason census measures the ANALYZER's endpoints against the analyzer's own symbol set:
 * of 350,368 edges, 169,156 (48.3%) resolve to more than one declaration. That number is real and
 * it is not what this file measures. **An instrument cannot find a defect in a layer it does not
 * read**, and the store is a different layer with its own rules: it resolves a target by EXACT
 * `qualified_name` and, before any post-index pass runs, by BARE NAME at insert time
 * (`resolveTargetStmt`, `src/ast/parallel-indexer.ts:2726`, ranked same-file-then-`s.id`). A row the
 * census calls "ambiguous" can therefore be stored RESOLVED — against whichever declaration the
 * store's ranking picked. This file asks that question directly, over a deterministic sample of the
 * admitted population, by building a real store through the real `storeResults` and then looking at
 * what came out.
 *
 * ## The two phases, and why both are needed
 *
 *   PHASE A — THE STORE'S OWN BINDING, UNTOUCHED. Every `calls`/`uses` row whose metadata carries
 *     `owner` (the analyzer published a receiver it can NAME: `$this->`, `self::`, `static::`,
 *     `parent::`, `C::`) is classified by where its `target_symbol_id` actually landed:
 *
 *       resolved:owner        the receiver's own class declares the member
 *       resolved:ancestor     an ancestor of the receiver's class declares it — PHP's own lookup
 *       resolved:not-a-member the target's owner is not the receiver nor an ancestor (a file-level
 *                             function, a foreign class): the binding the source never meant
 *       resolved:MISLANDED    the same, and the receiver's class DOES declare a member of that name
 *                             or an ancestor does — so the store picked between declarations it
 *                             could tell apart, and picked the wrong one
 *       NULL                  left unresolved (the honest state)
 *
 *   PHASE B — THE OWNER CHANNEL GIVEN ITS WHOLE INPUT. Phase A is what the store says TODAY, and it
 *     is not the ceiling of the owner channel, because the insert-time ranking claims those rows
 *     before the owner pass (`src/ast/member-owner-resolution.ts`) can see them: the pass only fills
 *     NULL. So the instrument CLEARS those rows back to NULL — every owner-carrying row, including
 *     the ones the store resolved — runs the pass, and reads where it puts them and what it
 *     declines. That is the AFTER picture of the ranking fix, measured without making the fix, and
 *     the two phases together price the fix: `mislanded_that_the_pass_resolves` is the population
 *     the current ranking gets WRONG and a rule gets right.
 *
 * Clearing is a mutation, so it is bounded and asserted: the row COUNT must be identical before and
 * after (no edge created, none deleted), the pass's own contract is re-checked on the population (it
 * may only ever land a row on the receiver or an ancestor), and phase B's `scanned` must equal the
 * number of owner-carrying rows my classifier counted — a disagreement between the pass's input
 * definition and this file's would make every number below describe a different population.
 *
 * ## What it does NOT prove
 *
 * `resolved:not-a-member`/`MISLANDED` are statements about the STORE's binding, not about which
 * declaration the source meant: the receiver is the one the ANALYZER published, and for `parent::`
 * and `C::` that receiver is a real class by the analyzer's own rule. Rows with no `owner` metadata
 * (`$obj->m()`, `$this->svc->m()`) are counted as the type-inference wall and are not classified
 * further. And a sample is a sample: the frame is a deterministic stride over the admitted files
 * sorted by repo/path, which is reproducible and is NOT a random draw — `--files 0` runs the whole
 * admitted population, and the artifact records which one it was.
 *
 * Usage:
 *   bun validation/m14/fixtures/php/store-resolution-census.mts [--files N] [--from i] [--to j]
 *       [--out validation/m60/php/store-resolution-census.json]
 */
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import * as path from "node:path"
import { createHash } from "node:crypto"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"
import { storeResults } from "../../../../src/ast/parallel-indexer"
import { resolveMemberTargetsByOwner } from "../../../../src/ast/member-owner-resolution"
import { BrainDatabase } from "../../../../src/brain/database"

const args = process.argv.slice(2)
const argOf = (name: string): string | undefined => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const N = Number(argOf("--files") ?? 600)
const FROM = Number(argOf("--from") ?? 0)
const TO = argOf("--to") !== undefined ? Number(argOf("--to")) : Infinity
const OUT = argOf("--out") ?? "validation/m60/php/store-resolution-census.json"
const CORPUS = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SIZE_CAP = 512 * 1024
const CLASS_LIKE = ["class", "interface", "trait", "enum"]

const failures: string[] = []
function check(ok: boolean, what: string, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}${detail ? `  ${detail}` : ""}`)
  if (!ok) failures.push(what)
}

// ------------------------------------------------------------------ population
// The admission rule is the reason census's, deliberately: same corpus root, same `git ls-files`
// enumeration, same path-first language routing with content read only for extensionless files,
// same size cap. A different rule here would make the two instruments' populations incomparable and
// there would be no way to notice from either artifact.
const admitted: { label: string; abs: string }[] = []
let reposScanned = 0
for (const entry of readdirSync(CORPUS)) {
  const dir = path.join(CORPUS, entry)
  let tracked: string[] = []
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
    reposScanned++
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
      .split("\0")
      .filter(Boolean)
  } catch {
    continue
  }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    const base = path.basename(abs).toLowerCase()
    const needsContent = base.lastIndexOf(".") < 0
    let text: string | undefined
    try {
      if (statSync(abs).size > SIZE_CAP) continue
      if (needsContent) text = readFileSync(abs, "utf8")
    } catch {
      continue
    }
    if (detectLanguageFromPath(abs, text) !== "php") continue
    admitted.push({ label: `${entry}/${rel}`, abs })
  }
}
admitted.sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0))
const population = admitted.length
const strideSample: typeof admitted = []
if (N === 0 || population <= N) strideSample.push(...admitted)
else for (let i = 0; i < N; i++) strideSample.push(admitted[Math.floor((i * population) / N)])
const frame = strideSample.slice(FROM, TO)
const frameDigest = createHash("sha256").update(frame.map((f) => f.label).join("\n")).digest("hex").slice(0, 16)

console.log(`php store resolution census — what a member edge was BOUND to`)
console.log(`corpus root         ${CORPUS}`)
console.log(`repos scanned       ${reposScanned}`)
console.log(`admitted population ${String(population).padStart(8)}`)
console.log(
  `files in frame      ${String(frame.length).padStart(8)}` +
    (frame.length < population ? `   SAMPLE of ${population} (--files ${N}) — a rate, not a total` : "   (the whole admitted population)"),
)
console.log(`frame digest        ${frameDigest}   frame[${FROM}:${TO === Infinity ? frame.length : TO}]`)

// ------------------------------------------------------------------ parse + store
const results: any[] = []
let parseErrors = 0
const tParse = Date.now()
for (const f of frame) {
  try {
    const r: any = await parseFile(f.abs, "php")
    if (r?.errors?.length) parseErrors++
    const st = statSync(f.abs)
    results.push({
      filePath: f.abs,
      success: r?.success ?? !r?.errors?.length,
      symbols: r?.symbols ?? [],
      relationships: r?.relationships ?? [],
      imports: r?.imports ?? [],
      language: "php",
      fileHash: String(r?.fileHash ?? frameDigest),
      sizeBytes: st.size,
      lastModified: st.mtimeMs,
    })
  } catch {
    parseErrors++
  }
}
const parseMs = Date.now() - tParse
const edgesParsed = results.reduce((n, r) => n + r.relationships.length, 0)

const projectRoot = mkdtempSync(path.join(tmpdir(), "php-store-census-"))
const projectId = `php-store-census-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
const tStore = Date.now()
await storeResults(projectId as any, projectRoot, results)
const storeMs = Date.now() - tStore
const db: any = await BrainDatabase.getRawInstance(projectId as any)

// ------------------------------------------------------------------ helpers
const rows = (sql: string, ...p: any[]): any[] => db.prepare(sql).all(...p) as any[]

const classLikeByName = new Map<string, string[]>()
const superTypesById = new Map<string, string[]>()
for (const s of rows(
  `SELECT id, name, super_types FROM brain_symbol WHERE project_id = ? AND symbol_type IN (${CLASS_LIKE.map(() => "?").join(", ")})`,
  projectId,
  ...CLASS_LIKE,
)) {
  const id = String(s.id)
  const list = classLikeByName.get(String(s.name)) ?? (classLikeByName.set(String(s.name), []), classLikeByName.get(String(s.name))!)
  list.push(id)
  try {
    const parsed = JSON.parse(String(s.super_types ?? "null"))
    if (Array.isArray(parsed)) superTypesById.set(id, parsed.filter((x: any) => typeof x === "string" && x))
  } catch {
    // a malformed payload is not a hierarchy
  }
}
/** Same spelling tolerance as the pass: whole name first, then its last segment; either must be unique. */
const parentByName = (name: string): string | null => {
  const leaf = name.includes("\\") ? name.slice(name.lastIndexOf("\\") + 1) : name
  for (const key of name === leaf ? [name] : [name, leaf]) {
    const ids = classLikeByName.get(key)
    if (ids && ids.length === 1) return ids[0]!
  }
  return null
}
const ancestorCache = new Map<string, Set<string>>()
const ancestorsOf = (id: string): Set<string> => {
  const hit = ancestorCache.get(id)
  if (hit) return hit
  const seen = new Set<string>()
  let frontier = (superTypesById.get(id) ?? []).map(parentByName).filter((x): x is string => !!x)
  let depth = 0
  while (frontier.length && depth < 16) {
    const next: string[] = []
    for (const pid of frontier) {
      if (pid === id || seen.has(pid)) continue
      seen.add(pid)
      for (const pname of superTypesById.get(pid) ?? []) {
        const gp = parentByName(pname)
        if (gp && gp !== id && !seen.has(gp)) next.push(gp)
      }
    }
    frontier = next
    depth++
  }
  ancestorCache.set(id, seen)
  return seen
}
const memberDeclares = (ownerId: string, name: string, kindFilter: Set<string> | null): number =>
  rows(
    `SELECT COUNT(*) c FROM brain_symbol WHERE project_id = ? AND owner_symbol_id = ? AND name = ?`,
    projectId,
    ownerId,
    name,
  )[0].c as number // kinds are checked below only where they matter (the pass's own filter)

const ownerOfRelation = (metadata: string | null): string => {
  try {
    const m = JSON.parse(String(metadata ?? "{}"))
    return m && typeof m === "object" && typeof m.owner === "string" ? m.owner : ""
  } catch {
    return ""
  }
}

type Row = {
  id: string
  relType: string
  target: string
  targetId: string | null
  metadata: string | null
  sourceId: string | null
  sourceOwnerId: string | null
  sourceOwnerName: string | null
  targetOwnerId: string | null
  targetOwnerName: string | null
  targetKind: string | null
}
const loadRows = (): Row[] =>
  (rows(
    `SELECT r.id, r.relationship_type, r.target_external, r.target_symbol_id, r.metadata,
            r.source_symbol_id AS source_id,
            s.owner_symbol_id AS source_owner_id, so.name AS source_owner_name,
            t.owner_symbol_id AS target_owner_id, u.name AS target_owner_name, t.symbol_type AS target_kind
       FROM brain_relationship r
       LEFT JOIN brain_symbol s ON s.id = r.source_symbol_id
       LEFT JOIN brain_symbol so ON so.id = s.owner_symbol_id
       LEFT JOIN brain_symbol t ON t.id = r.target_symbol_id
       LEFT JOIN brain_symbol u ON u.id = t.owner_symbol_id
      WHERE r.project_id = ? AND r.relationship_type IN ('calls','uses')`,
    projectId,
  ) as any[]).map((r) => ({
    id: String(r.id),
    relType: String(r.relationship_type),
    target: String(r.target_external ?? ""),
    targetId: r.target_symbol_id === null || r.target_symbol_id === undefined ? null : String(r.target_symbol_id),
    metadata: r.metadata ?? null,
    sourceId: r.source_id === null ? null : String(r.source_id),
    sourceOwnerId: r.source_owner_id === null || r.source_owner_id === undefined ? null : String(r.source_owner_id),
    sourceOwnerName: r.source_owner_name ?? null,
    targetOwnerId: r.target_owner_id === null || r.target_owner_id === undefined ? null : String(r.target_owner_id),
    targetOwnerName: r.target_owner_name ?? null,
    targetKind: r.target_kind ?? null,
  }))

/**
 * The receiver's class, by the pass's own Rule 0 first: when `metadata.owner` spells the name of the
 * declaration the source belongs to, the receiver IS that declaration and the store knows it by
 * identity — so a name collision elsewhere in the project is irrelevant. Otherwise the owner name
 * must identify exactly one class-like symbol; `ambiguous` and `absent` are returned as such rather
 * than guessed at.
 */
function receiverClass(r: Row, owner: string): { id: string | null; how: string } {
  if (r.sourceOwnerId && r.sourceOwnerName === owner) return { id: r.sourceOwnerId, how: "identity" }
  const ids = classLikeByName.get(owner)
  if (!ids || ids.length === 0) return { id: null, how: "absent" }
  if (ids.length > 1) return { id: null, how: "ambiguous" }
  return { id: ids[0]!, how: "name" }
}

type Bucket = Record<string, number>
const bucket: Bucket = {}
const count = (k: string, n = 1): void => {
  bucket[k] = (bucket[k] ?? 0) + n
}

function classifyPhaseA(all: Row[]): { ownerRows: Row[]; mislandedIds: string[] } {
  const ownerRows: Row[] = []
  const mislandedIds: string[] = []
  for (const r of all) {
    const owner = ownerOfRelation(r.metadata)
    if (!owner) {
      count("no-declared-receiver")
      if (!r.targetId) count("no-declared-receiver:NULL")
      continue
    }
    ownerRows.push(r)
    const recv = receiverClass(r, owner)
    if (!r.targetId) {
      count("null")
      count(`null:receiver-${recv.how}`)
      continue
    }
    if (!recv.id) {
      count("resolved:receiver-unknown-to-this-classifier")
      continue
    }
    if (r.targetOwnerId === recv.id) {
      count("resolved:owner")
      continue
    }
    if (r.targetOwnerId && ancestorsOf(recv.id).has(r.targetOwnerId)) {
      count("resolved:ancestor")
      continue
    }
    // The target's owner is neither the receiver nor an ancestor of it. Is the name even a member
    // the receiver's chain declares? If so the store picked between declarations it could tell
    // apart and picked one the source never meant — the defect this instrument exists to count.
    const declaredHere =
      memberDeclares(recv.id, r.target, null) > 0 ||
      [...ancestorsOf(recv.id)].some((a) => memberDeclares(a, r.target, null) > 0)
    if (declaredHere) {
      count("resolved:MISLANDED")
      mislandedIds.push(r.id)
    } else {
      count("resolved:not-a-member")
    }
  }
  return { ownerRows, mislandedIds }
}

// ------------------------------------------------------------------ interpretive context
// The ancestry lookups below are only meaningful if the store actually carries a hierarchy, and a
// FRAME of the population breaks that on purpose: a parent class declared in a file outside the
// frame is a parent the store does not have. The census therefore reports both facts rather than
// leaving a suppressed ancestor stage to be misread as "php has no inheritance".
const context = {
  classLikeSymbols: classLikeByName.size === 0 ? 0 : [...classLikeByName.values()].reduce((n, v) => n + v.length, 0),
  classLikeWithSuperTypes: superTypesById.size,
  profile: "",
}
{
  const names = new Set<string>()
  for (const list of superTypesById.values()) for (const n of list) names.add(n)
  let resolved = 0
  for (const n of names) if (parentByName(n)) resolved++
  context.profile = `${resolved} of ${names.size} distinct parent name(s) resolve to exactly one class-like symbol in this store`
  console.log(`hierarchy in store  ${context.classLikeWithSuperTypes} of ${context.classLikeSymbols} class-like symbol(s) carry super_types; ${context.profile}`)
}

// ------------------------------------------------------------------ phase A
const before = loadRows()
const a = classifyPhaseA(before)
check(a.ownerRows.length > 0, "the sample contains member edges with a DECLARED receiver (the input this file classifies)", `${a.ownerRows.length} row(s) of ${before.length} calls/uses`)
check((bucket["resolved:ancestor"] ?? 0) > 0 || (bucket["resolved:owner"] ?? 0) > 0, "the store resolved some member rows at all", JSON.stringify({ owner: bucket["resolved:owner"] ?? 0, ancestor: bucket["resolved:ancestor"] ?? 0, null: bucket["null"] ?? 0 }))

// ------------------------------------------------------------------ phase B
// Clear EVERY owner-carrying row back to NULL and hand the pass its whole input. The row count is
// asserted across the mutation: this instrument may not create or delete an edge.
const rowCountBefore = rows(`SELECT COUNT(*) c FROM brain_relationship WHERE project_id = ?`, projectId)[0].c as number
const clear = db.prepare(`UPDATE brain_relationship SET target_symbol_id = NULL WHERE id = ?`)
for (const r of a.ownerRows) clear.run(r.id)
const rowCountCleared = rows(`SELECT COUNT(*) c FROM brain_relationship WHERE project_id = ?`, projectId)[0].c as number
const countered = resolveMemberTargetsByOwner(db, projectId)
const rowCountAfter = rows(`SELECT COUNT(*) c FROM brain_relationship WHERE project_id = ?`, projectId)[0].c as number

check(rowCountBefore === rowCountCleared && rowCountAfter === rowCountBefore, "clearing and re-resolving changed no ROW COUNT (no edge created, none deleted)", `${rowCountBefore} -> ${rowCountCleared} -> ${rowCountAfter}`)
check(countered.scanned === a.ownerRows.length, "the pass's OWN input definition agrees with this file's classifier (a disagreement would mean the numbers describe different populations)", `pass scanned ${countered.scanned} vs classifier ${a.ownerRows.length}`)

// Where did the pass put them, and — the headline — how many of the store's mislandings did it fix?
const after = new Map(loadRows().map((r) => [r.id, r]))
let passOwner = 0
let passAncestor = 0
let passMislandedFixed = 0
let passWrong = 0
for (const r of a.ownerRows) {
  const now = after.get(r.id)
  if (!now || !now.targetId) continue
  const owner = ownerOfRelation(r.metadata)
  const recv = receiverClass(r, owner)
  if (!recv.id) continue
  if (now.targetOwnerId === recv.id) passOwner++
  else if (now.targetOwnerId && ancestorsOf(recv.id).has(now.targetOwnerId)) passAncestor++
  else passWrong++
  if (a.mislandedIds.includes(r.id)) passMislandedFixed++
}
check(passWrong === 0, "the pass's own contract, re-checked on the population: every row it lands sits on the receiver or an ancestor of it", `${passWrong} row(s) elsewhere`)
check(countered.resolved === passOwner + passAncestor, "the pass's counters agree with where the rows actually sit", `counters ${countered.resolved} vs rows owner=${passOwner} ancestor=${passAncestor}`)

// ------------------------------------------------------------------ report
const report = {
  generatedAt: new Date().toISOString(),
  corpusRoot: CORPUS,
  entryPoint: "parseFile (src/ast/pool-worker.ts) -> storeResults (src/ast/parallel-indexer.ts)",
  admittedFiles: population,
  filesInFrame: frame.length,
  sampling: N === 0 || population <= N ? "whole admitted population" : `deterministic stride over the ${population} admitted files sorted by repo/path, --files ${N}`,
  frameDigest,
  frame: frame.map((f) => f.label),
  parseErrors,
  edgesParsed,
  timingsMs: { parse: parseMs, store: storeMs },
  hierarchyInStore: context,
  phaseA_storeBinding: bucket,
  phaseA_mislandedRowIds: a.mislandedIds,
  phaseB_ownerChannelGivenItsWholeInput: {
    ...countered,
    putOnReceiver: passOwner,
    putOnAncestor: passAncestor,
    mislandingsRepaired: passMislandedFixed,
  },
}

console.log(`\nfiles parsed        ${results.length}  (${parseErrors} with parse errors)`)
console.log(`edges parsed        ${edgesParsed}`)
console.log(`timings             parse ${(parseMs / 1000).toFixed(1)}s  store ${(storeMs / 1000).toFixed(1)}s`)

const order = [
  "resolved:owner",
  "resolved:ancestor",
  "resolved:MISLANDED",
  "resolved:not-a-member",
  "resolved:receiver-unknown-to-this-classifier",
  "null",
  "null:receiver-identity",
  "null:receiver-name",
  "null:receiver-absent",
  "null:receiver-ambiguous",
  "no-declared-receiver",
  "no-declared-receiver:NULL",
]
console.log(`\nPHASE A — what the store bound a member edge to, untouched:`)
for (const k of order) if (bucket[k] !== undefined) console.log(`  ${k.padEnd(46)} ${String(bucket[k]).padStart(8)}`)

console.log(`\nPHASE B — the owner channel given the WHOLE input (all ${a.ownerRows.length} rows reset to NULL):`)
console.log(`  ownerResolved         ${String(countered.ownerResolved).padStart(8)}   (rows now on the receiver: ${passOwner})`)
console.log(`  inheritedResolved     ${String(countered.inheritedResolved).padStart(8)}   (rows now on an ancestor: ${passAncestor})`)
console.log(`  ownerAmbiguous        ${String(countered.ownerAmbiguous).padStart(8)}`)
console.log(`  ownerNotInPopulation  ${String(countered.ownerNotInPopulation).padStart(8)}`)
console.log(`  notDeclared           ${String(countered.notDeclared).padStart(8)}`)
console.log(`  ambiguousInChain      ${String(countered.ambiguousInChain).padStart(8)}`)
console.log(`  mislandings repaired  ${String(passMislandedFixed).padStart(8)} of ${a.mislandedIds.length} the store had bound elsewhere`)

mkdirSync(path.dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify(report, null, 2) + "\n")
console.log(`\nartifact            ${OUT}`)

await db.close?.()
console.log(`\n${failures.length === 0 ? "PASS" : "FAIL"} — php store resolution census${failures.length ? ": " + failures.join("; ") : ""}`)
process.exit(failures.length === 0 ? 0 : 1)
