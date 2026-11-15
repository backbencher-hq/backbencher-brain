/**
 * WHAT DOES THE PROJECT INDEX ACTUALLY CHANGE? — dart lane, one repository at a time.
 *
 * The incoming gate walks the corpus FILE BY FILE with no context:
 *
 *     parseFile(files[i], path.dirname(files[i]))
 *
 * The worker path (`pool-worker.ts` `parse_batch`) passes `{ projectIndex, projectRoot }` into
 * every parse when the parent handed it an index for that extension — so the question "is arm A
 * the gate's invocation or production's?" is a question about ONE MAP, and for `.dart` the answer
 * is BOTH: the parent (
 * `parallel-indexer.ts` `PROJECT_INDEX_EXTENSIONS`) lists `.sol`, `.fs`, `.proto` and `.scss`, and
 * its `wasmByLang`/`specByLang` maps carry no dart entry either, so no dart index is ever built and
 * `contextFor` returns `{ projectRoot }` alone. This header used to assert the opposite —
 * "Production does [pass an index]" — on the strength of a stale sentence in `pool-worker.ts`
 * ("`INDEX_SPECS` carries `dart` alone"; there is no `INDEX_SPECS` in this tree). Measured
 * 2026-10-12: the dart index is built ONLY by this lane's own instruments, so A is the gate's
 * invocation AND production's, and B is what wiring `.dart` in would buy.
 *
 * Two dart passes READ an index and would change if one arrived — the override pass (cross-file
 * base and member resolution, `companionForPass2`) and the expression pass (`visibleTypes`, and
 * `indexDeclares` inside `qualifiedTarget`) — so this instrument measures what the wiring is worth
 * rather than whether the analyzer is degraded today. "Add the index" is only the right fix if the
 * number moves, and the number to read is TABLE 2's `receiverMemberOutsideRun` row: the cell the
 * lane's residual sizes the store lever from.
 *
 * A/B on the SAME files, same order, in one process:
 *   A  no context            — what the gate does today
 *   B  { projectIndex }      — what production does
 *
 * Run: npx tsx validation/m14/fixtures/dart/project-index-effect.ts [repo] [maxFiles]
 */
import { execFileSync } from "node:child_process"
import { readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"
import { buildProjectIndexStreaming, buildResolutionTables, DART_DECLARATION_SPEC } from "../../../../src/ast/project-index"
import { resolveWasmAsset } from "../../../../src/util/wasm"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const REPO = process.argv[2] ?? "dart-http"
const MAX = Number(process.argv[3] ?? 0)
const DIR = path.join(CR, REPO)

const tracked = execFileSync("git", ["-C", DIR, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
  .split("\0").filter(Boolean)
let files = tracked.filter((r) => r.endsWith(".dart")).map((r) => path.join(DIR, r))
files = files.filter((f) => { try { return statSync(f).size <= 1024 * 1024 } catch { return false } }).sort()
if (MAX > 0) files = files.slice(0, MAX)
console.log(`project index effect — ${REPO}: ${files.length} .dart files`)

type Tally = { edges: number; resolved: number; ambiguous: number; unresolved: number; marked: number }
const perType = new Map<string, Tally>()
/** THE RECEIVER CUT, per cause, on both arms — the column pair the lane's residual table sizes the
 *  store lever from (`receiverMemberOutsideRun ≈ 76,192 · type-declared-elsewhere ≈ 79,008`), and
 *  the reason this instrument grew a second table: the FIRST table answers "what does the index
 *  change" for the lane as a whole, and the store lever is a question about ONE cause and one
 *  branch of `qualifiedTarget`. A row is bucketed by `metadata.receiverCause` and, for a row that
 *  was SPELLED rather than left bare, by the claim it carries instead — the two are mutually
 *  exclusive by construction in `receiverCut`, so the bucket is a partition and not an overlap. */
const perCause = new Map<string, Tally>()

/** One pass over the whole repository. `tag` keeps the two populations apart: A is the
 *  gate's invocation, B is production's. The gate's rule applies inside each: `decls === 1`
 *  resolved · `> 1` ambiguous · `=== 0` unresolved. */
async function pass(tag: "A" | "B", index?: unknown): Promise<Map<string, number>> {
  const declCount = new Map<string, number>()
  const byType = new Map<string, { target: string; marked: boolean }[]>()
  const byCause = new Map<string, { target: string; marked: boolean }[]>()
  for (const f of files) {
    let r: any
    try {
      r = index === undefined
        ? await parseFile(f, DIR)
        : await parseFile(f, DIR, { projectIndex: index } as any)
    } catch { continue }
    if (!r || r.fallback === true) continue
    for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
      const n = String(s?.name ?? "")
      if (n) declCount.set(n, (declCount.get(n) ?? 0) + 1)
      const q = String(s?.qualifiedName ?? "")
      if (q && q !== n) declCount.set(q, (declCount.get(q) ?? 0) + 1)
    }
    for (const rel of Array.isArray(r.relationships) ? r.relationships : []) {
      const label = String(rel?.type ?? rel?.relationshipType ?? "").toLowerCase()
      if (!label) continue
      const md = rel?.metadata
      const marked = !!md && typeof md === "object" && EXTERNAL_KEYS.some((k) => (md as any)[k] === true)
      const target = String(rel?.target ?? rel?.to ?? rel?.toSymbol ?? "")
      if (!byType.has(label)) byType.set(label, [])
      byType.get(label)!.push({ target, marked })
      // The cut's bucket: the declared cause when the row stayed BARE, else the claim a SPELLED row
      // carries (`baseBeyondRunScope`), else `(qualified)` — a row the run spelled with no claim,
      // which is the one class that can already raise a resolution today.
      const cut = (md && typeof md === "object")
        ? (typeof (md as any).receiverCause === "string" ? String((md as any).receiverCause)
          : typeof (md as any).baseBeyondRunScope === "string" ? "spelled:baseBeyondRunScope" : null)
        : null
      const bucket = cut ?? "(qualified)"
      if (!byCause.has(bucket)) byCause.set(bucket, [])
      byCause.get(bucket)!.push({ target, marked })
    }
  }
  for (const [label, edges] of byType) {
    let t = perType.get(`${label}\u0000${tag}`)
    if (!t) { t = { edges: 0, resolved: 0, ambiguous: 0, unresolved: 0, marked: 0 }; perType.set(`${label}\u0000${tag}`, t) }
    for (const e of edges) {
      t.edges++
      if (e.marked) t.marked++
      const d = declCount.get(e.target) ?? 0
      if (d === 1) t.resolved++
      else if (d > 1) t.ambiguous++
      else t.unresolved++
    }
  }
  for (const [bucket, edges] of byCause) {
    let t = perCause.get(`${bucket}\u0000${tag}`)
    if (!t) { t = { edges: 0, resolved: 0, ambiguous: 0, unresolved: 0, marked: 0 }; perCause.set(`${bucket}\u0000${tag}`, t) }
    for (const e of edges) {
      t.edges++
      if (e.marked) t.marked++
      const d = declCount.get(e.target) ?? 0
      if (d === 1) t.resolved++
      else if (d > 1) t.ambiguous++
      else t.unresolved++
    }
  }
  return declCount
}

const EXTERNAL_KEYS = ["isExternalBase", "isExternal", "isExternalTarget", "external", "externalRef", "isStdlib", "stdlibModule"]

console.log(`building the project index the way production does (${files.length} files)...`)
const wasm = resolveWasmAsset("tree-sitter-dart/tree-sitter-dart.wasm")
const index = await buildProjectIndexStreaming(wasm, files, DART_DECLARATION_SPEC)
// THE CLOSED-MAP PREP. `buildResolutionTables` attaches `__closedMembers` (type -> its
// inheritance-closed member set) as a side effect, and the header's arm C is the question "what if
// the analyzer READ that map instead of the declared one" — so the data both reads need must exist
// before either arm runs, and the count below is the evidence that it does. Two maps, two reads, one
// population: `index.typeMembers` is what the indexer fills (`addTo(index.typeMembers, owner, name)`)
// and what `qualifiedTarget`'s `indexDeclares` asks; `__closedMembers` is what
// `buildResolutionTables` computes and what that branch does NOT ask. Replacing one with the other
// would move EVERY consumer of `typeMembers` at once (the override pass reads it too), which is why
// the arm is measured by repairing the one read in the analyzer rather than by swapping the data.
buildResolutionTables(index as any)
const closedMembers = (index as any).__closedMembers as Map<string, Set<string>> | undefined
console.log(`index: ${index.stats.files} files indexed, ${index.stats.damaged} damaged, ${index.typeKinds.size} types, ${index.typeMembers.size} with members`)
console.log(`closed member map prepared: ${closedMembers?.size ?? 0} type(s) (what a repaired read would consult)\n`)

await pass("A")
await pass("B", index)

const w = (s: string | number, n: number) => (String(s) + " ".repeat(n)).slice(0, n)
console.log(w("type", 16) + w("A edges", 9) + w("A unres", 9) + w("B edges", 9) + w("B unres", 9) + "Δ resolved")
console.log("-".repeat(70))
const labels = [...new Set([...perType.keys()].map((k) => k.split("\u0000")[0]))].sort()
const tot = { aEdges: 0, aUnres: 0, bEdges: 0, bUnres: 0, dRes: 0 }
for (const l of labels) {
  const a = perType.get(`${l}\u0000A`) ?? { edges: 0, resolved: 0, ambiguous: 0, unresolved: 0, marked: 0 }
  const b = perType.get(`${l}\u0000B`) ?? { edges: 0, resolved: 0, ambiguous: 0, unresolved: 0, marked: 0 }
  tot.aEdges += a.edges; tot.aUnres += a.unresolved; tot.bEdges += b.edges; tot.bUnres += b.unresolved
  tot.dRes += b.resolved - a.resolved
  console.log(w(l, 16) + w(a.edges, 9) + w(a.unresolved, 9) + w(b.edges, 9) + w(b.unresolved, 9) + String(b.resolved - a.resolved))
}
console.log("-".repeat(70))
console.log(w("TOTAL", 16) + w(tot.aEdges, 9) + w(tot.aUnres, 9) + w(tot.bEdges, 9) + w(tot.bUnres, 9) + String(tot.dRes))
console.log(
  `\nThe index changes emitted edge COUNTS as well as resolution (the expression pass gates type\n` +
  `mentions on types the run can see), so a difference in edges is a difference in what the\n` +
  `analyzer produces, not a re-count of the same population.`,
)

// ---------------------------------------------------------------------------------------------
// TABLE 2 — the receiver cut. THE STORE READ AS THE MEMBER INDEX is a question about this table:
// `receiverMemberOutsideRun` is the branch where the owner type is IN THIS FILE and neither the
// in-file ancestry walk nor `indexDeclares` names the member, so the index is the only thing that
// can move it. `(qualified)` is the control: those rows carry no cut at all, and they must be the
// ones that already resolve — if the control moves, the two arms are not measuring the same rule.
// ---------------------------------------------------------------------------------------------
const causeLabels = [...new Set([...perCause.keys()].map((k) => k.split("\u0000")[0]))].sort()
console.log(w("receiverCause", 30) + w("A rows", 8) + w("A res", 7) + w("A unres", 8) + w("B rows", 8) + w("B res", 7) + w("B unres", 8) + "Δ resolved")
console.log("-".repeat(86))
const ct = { aRows: 0, aRes: 0, aUnres: 0, bRows: 0, bRes: 0, bUnres: 0 }
for (const l of causeLabels) {
  const a = perCause.get(`${l}\u0000A`) ?? { edges: 0, resolved: 0, ambiguous: 0, unresolved: 0, marked: 0 }
  const b = perCause.get(`${l}\u0000B`) ?? { edges: 0, resolved: 0, ambiguous: 0, unresolved: 0, marked: 0 }
  ct.aRows += a.edges; ct.aRes += a.resolved; ct.aUnres += a.unresolved
  ct.bRows += b.edges; ct.bRes += b.resolved; ct.bUnres += b.unresolved
  console.log(w(l, 30) + w(a.edges, 8) + w(a.resolved, 7) + w(a.unresolved, 8) + w(b.edges, 8) + w(b.resolved, 7) + w(b.unresolved, 8) + String(b.resolved - a.resolved))
}
console.log("-".repeat(86))
console.log(w("TOTAL (cut rows)", 30) + w(ct.aRows, 8) + w(ct.aRes, 7) + w(ct.aUnres, 8) + w(ct.bRows, 8) + w(ct.bRes, 7) + w(ct.bUnres, 8) + String(ct.bRes - ct.aRes))
const bare = perCause.get("receiverMemberOutsideRun\u0000A")?.edges ?? 0
console.log(
  `\nThe store lever's population on THIS repository is the \`receiverMemberOutsideRun\` row above: ${bare}\n` +
  `row(s) in arm A. Read the Δ resolved column beside the row-count column, not instead of it — a row\n` +
  `that leaves the bare population can land in any of the three columns, and the \`spelled:\` bucket is\n` +
  `where it lands when the index supplies the type but nothing supplies the member.`,
)
