/**
 * WHAT WOULD QUALIFYING DART'S `contains` TARGETS BE WORTH? — dart lane, priced before built.
 *
 * `addContainmentRelationships` emits `source: symbol.ownerName, target: symbol.name` — TWO BARE
 * NAMES. The incoming gate's whole-corpus run reads that type as:
 *
 *     contains  700,265 edges   169,829 resolved   530,368 ambiguous(decl)   68 unresolved
 *
 * so 75.7% of the lane's largest clean-looking type cannot be walked to a declaration, and the
 * cause is not a defect in any member: a JSON document repeats key names relentlessly and so does
 * a Dart project (`value`, `build`, `name`, `toString`), and a bare name that two classes declare
 * is ambiguous BY CONSTRUCTION. The resolver cannot fix it — strategy 2 resolves a bare name only
 * under `HAVING COUNT(*) = 1` — so the fix, if it is one, is in what the edge NAMES.
 *
 * The json lane already walked this road and recorded why: its `contains` was its LAST type
 * emitting bare names, and it moved to the symbol's `qualifiedName` (a file-scoped path), with
 * `source: ownerPathOf(symbol), target: String(symbol.qualifiedName || symbol.name)` and the note
 * that the change can only ADD resolution, never remove it, because a bare name that was unique
 * still resolves under its qualified spelling... which is not quite the argument here, so THIS
 * census measures it instead of inheriting it.
 *
 * It prices both spellings on the SAME edges, in PRODUCTION'S SCOPE (the project a file belongs
 * to), over whole checkouts so each project's key space is complete:
 *
 *   TODAY     target = the member's bare name, as emitted now
 *   PROPOSED  target = the member's `qualifiedName` (`Owner.member`), falling back to the bare
 *             name exactly where the analyzer's own symbol carries no qualifier
 *
 * and it reports the cross-tabulation, because the only number that matters is how many edges MOVE
 * from ambiguous to resolved (and whether any move the other way, which would be a regression).
 *
 * Run: npx tsx validation/m14/fixtures/dart/contains-target-price.ts [repo,repo,...]
 */
import { execFileSync } from "node:child_process"
import { readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const CONC = 4
const repos = (process.argv[2] ?? "dart-http,riverpod,proxicall").split(",")

function filesOf(name: string): string[] | null {
  const dir = path.join(CR, name)
  try { if (!statSync(dir).isDirectory()) return null } catch { return null }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
      .split("\0").filter(Boolean)
  } catch { return null }
  return tracked.filter((r) => r.endsWith(".dart")).map((r) => path.join(dir, r))
}

type Edge = { today: string; proposed: string }
type RepoBundle = { files: string[]; edges: Edge[]; keys: Map<string, number> }
const perRepo = new Map<string, RepoBundle>()
for (const name of repos) {
  const files = filesOf(name)
  if (files !== null && files.length > 0) perRepo.set(path.join(CR, name), { files, edges: [], keys: new Map() })
}

let parsed = 0
let failed = 0
/** symbols whose ownerName.name does NOT equal the published qualifiedName — the fix's blind spot */
let diverge = 0
for (const [repo, bundle] of perRepo) {
  let cursor = 0
  await Promise.all(Array.from({ length: CONC }, async () => {
    while (true) {
      const i = cursor++
      if (i >= bundle.files.length) return
      const f = bundle.files[i]
      let r: any
      try { r = await parseFile(f, repo) } catch { failed++; continue }
      if (!r || r.fallback === true) { failed++; continue }
      parsed++
      // The member's own qualified spelling, as the analyzer publishes it: `Name` -> the
      // symbol carrying that name and that owner, whose `qualifiedName` pool-worker synthesises
      // from the symbol's scope. Indexed per file, because `contains` is a same-file statement.
      const byOwned = new Map<string, string>()
      const bumpKey = (k: string) => { if (k.length > 0) bundle.keys.set(k, (bundle.keys.get(k) ?? 0) + 1) }
      for (const s of r.symbols ?? []) {
        const name = String(s?.name ?? "")
        const owner = String(s?.ownerName ?? "")
        const q = String(s?.qualifiedName ?? "")
        if (name.length > 0 && q.length > 0) byOwned.set(`${owner}\u0000${name}`, q)
        bumpKey(name)
        if (q !== name) bumpKey(q)
        // CAN THE ANALYZER COMPUTE THE PUBLISHED SPELLING FROM ITS OWN FIELDS? It would emit
        // `ownerName.name`; the engine publishes `qualifiedName`, which pool-worker synthesises
        // from the symbol's `scope`. Where those two disagree the fix would emit a spelling that
        // nothing publishes — so the census counts them instead of assuming they agree.
        if (owner.length > 0 && q !== `${owner}.${name}`) diverge++
      }
      for (const rel of r.relationships ?? []) {
        if (String(rel?.type ?? "") !== "contains") continue
        const target = String(rel?.target ?? "")
        if (target.length === 0) continue
        const source = String(rel?.source ?? rel?.from ?? "")
        const proposed = byOwned.get(`${source}\u0000${target}`) ?? target
        bundle.edges.push({ today: target, proposed })
      }
    }
  }))
}

const rows = new Map<string, number>()
const bump = (k: string) => rows.set(k, (rows.get(k) ?? 0) + 1)
let totalEdges = 0

for (const [repo, bundle] of perRepo) {
  // THE KEY SPACE was collected in the same pass as the edges: every name, plus every
  // qualifiedName as the same declaration's alias (two spellings of one declaration must not read
  // as two). Collecting it in a second parse would double the cost of the census, and a census
  // that takes twice as long is one a lane runs half as often.
  const keys = bundle.keys
  const verdictOf = (t: string): "resolved" | "ambiguous" | "none" => {
    const n = keys.get(t) ?? 0
    return n === 1 ? "resolved" : n === 0 ? "none" : "ambiguous"
  }
  for (const e of bundle.edges) {
    totalEdges++
    const t = verdictOf(e.today)
    const p = verdictOf(e.proposed)
    bump(`${t} -> ${p}`)
    if (t === "ambiguous" && p === "ambiguous" && e.today !== e.proposed) bump("  (ambiguous both ways: the OWNER name is the collision)")
  }
}

console.log(`dart \`contains\` target qualification — priced on whole checkouts: ${repos.join(", ")}`)
console.log(`files parsed: ${parsed} (${failed} failed/degraded)   contains edges: ${totalEdges}`)
console.log(`scope: PER PROJECT (production's), each project's key space complete`)
console.log(`\nsymbols whose \`ownerName.name\` !== published \`qualifiedName\`: ${diverge}` +
  ` (0 means the analyzer can compute the published spelling from its own fields)`)
console.log(`\ncross-tabulation — TODAY's bare target -> PROPOSED qualified target:`)
for (const [k, v] of [...rows.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(8)}  ${k}`)
