/**
 * WHAT WOULD QUALIFYING DART'S BARE `calls` TARGETS BE WORTH? — dart lane, priced before built.
 *
 * The whole-corpus gate reads `calls` (index-assisted, per-project scope) as
 *
 *     calls   659,724 edges   231,752 resolved   216,685 ambiguous(decl)   211,287 unresolved
 *
 * and the marker census says the unresolved block is almost entirely edges with NO marker:
 * on one whole project (`dart-http`) that row read `(no marker) 757 resolved / 613 amb / 2,617
 * unresolved`, and its worklist is `close`, `build`, `listen`, `write`, `set`, `http`, `post`,
 * `test`, `expect` — METHOD NAMES WITH NO RECEIVER.
 *
 * Some of those are genuinely unresolvable from one file (a call on a parameter whose type the
 * file never states), but a large share are not: `close()` written inside class `C` that
 * DECLARES `close` is an implicit-`this` call, and Dart's own resolution order reaches the
 * enclosing class's instance members before anything else. The analyzer already knows that set —
 * it is the same member inventory `contains` is built from — so the spelling `C.close` is
 * available at the moment the edge is emitted, and the store can then bind it exactly.
 *
 * This prices the change before it is written, the same way the `contains` qualification was
 * priced, on the SAME edges and in PRODUCTION'S SCOPE (the project a file belongs to), over whole
 * checkouts so each project's key space is complete:
 *
 *   TODAY     target = the bare name, as emitted now
 *   PROPOSED  target = `EnclosingClass.name` where the edge's SOURCE lies inside a class declared
 *             in the SAME file and that class declares a member of that name; unchanged otherwise
 *
 * The rule is deliberately narrow: it never invents a receiver type, it only uses the class the
 * edge is already inside, and it proposes a qualified spelling only where a member of that name is
 * a published symbol of that class (`qualifiedName` present, so the spelling is one the project
 * can actually answer). The only number that matters is how many edges MOVE from ambiguous or
 * unresolved to resolved — and whether any move the other way, which would be a regression.
 *
 * Run: npx tsx validation/m14/fixtures/dart/bare-call-price.ts [repo,repo,...] [types]
 *      types defaults to `calls,uses`; pass `calls` to price one type.
 */
import { execFileSync } from "node:child_process"
import { readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const CONC = Number(process.env.BB_DART_CONC ?? 4)
const repos = (process.argv[2] ?? "dart-http,riverpod,proxicall").split(",")
const TYPES = new Set((process.argv[3] ?? "calls,uses").split(","))

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

type Sym = { name?: string; kind?: string; qualifiedName?: string; ownerName?: string }
type Rel = { type?: string; source?: string; target?: string; metadata?: Record<string, unknown> }
type Tally = { resolved: number; ambiguous: number; unresolved: number }
type Price = {
  edges: number
  /** today's outcome -> proposed outcome, the cross-tabulation the price exists for */
  move: Map<string, number>
  today: Tally
  proposed: Tally
  /** edges where the proposal changed the spelling at all */
  changed: number
  examples: string[]
  /** edges inside a known class that does NOT declare the name: the proposal correctly declines */
  noQualifier: number
}
const emptyTally = (): Tally => ({ resolved: 0, ambiguous: 0, unresolved: 0 })

const perRepo = new Map<string, { files: string[]; keys: Map<string, number>; price: Price }>()
for (const name of repos) {
  const files = filesOf(name)
  if (files !== null && files.length > 0) {
    perRepo.set(path.join(CR, name), {
      files,
      keys: new Map(),
      price: {
        edges: 0, move: new Map(), today: emptyTally(), proposed: emptyTally(),
        changed: 0, examples: [], noQualifier: 0,
      },
    })
  }
}

const WORK: { repo: string; abs: string }[] = []
for (const [repo, b] of perRepo) for (const abs of b.files) WORK.push({ repo, abs })

/** Parse every file once, keeping BOTH halves: the key space and the edges to price. */
type Parsed = { repo: string; abs: string; syms: Sym[]; rels: Rel[] }
const parsed: Parsed[] = []
let next = 0
let failed = 0
await Promise.all(Array.from({ length: CONC }, async () => {
  while (true) {
    const i = next++
    if (i >= WORK.length) return
    const { repo, abs } = WORK[i]
    try {
      const r: any = await parseFile(abs, path.dirname(abs))
      parsed.push({
        repo, abs,
        syms: Array.isArray(r?.symbols) ? r.symbols : [],
        rels: Array.isArray(r?.relationships) ? r.relationships : [],
      })
    } catch {
      failed++
    }
  }
}))

// ------------------------------------------------- THE KEY SPACE, in the gate's own unit: a name
// and its `qualifiedName` alias, one increment each, keyed PER PROJECT because that is the scope
// production resolves in (`parallel-indexer.resolveRelationships`, `WHERE s.project_id = ?`).
for (const { repo, syms } of parsed) {
  const keys = perRepo.get(repo)!.keys
  for (const s of syms) {
    const n = String(s?.name ?? "")
    if (!n) continue
    keys.set(n, (keys.get(n) ?? 0) + 1)
    const q = String(s?.qualifiedName ?? "")
    if (q && q !== n) keys.set(q, (keys.get(q) ?? 0) + 1)
  }
}

/** today → proposed, by the gate's own outcome names, for one repo's key space */
function classify(keys: Map<string, number>, tgt: string): string {
  const n = keys.get(tgt) ?? 0
  if (n === 0) return "unresolved"
  return n === 1 ? "resolved" : "ambiguous"
}

for (const { repo, syms, rels } of parsed) {
  const keys = perRepo.get(repo)!.keys
  // What this FILE declares, by owner: the member inventory the proposal is allowed to use.
  const byOwner = new Map<string, Map<string, string>>()
  const declaredTypes = new Set<string>()
  for (const s of syms) {
    const owner = String(s?.ownerName ?? "")
    const name = String(s?.name ?? "")
    if (!name) continue
    if (owner) {
      let m = byOwner.get(owner)
      if (!m) byOwner.set(owner, (m = new Map()))
      const q = String(s?.qualifiedName ?? "")
      if (q && q !== name) m.set(name, q)
      continue
    }
    if (typeof s.name === "string" && s.name) declaredTypes.add(s.name)
  }
  for (const rel of rels) {
    const t = String(rel?.type ?? rel?.relationshipType ?? "")
    if (!TYPES.has(t)) continue
    const tgt = String(rel?.target ?? "")
    if (!tgt || tgt.includes(".")) continue
    // A BINDING'S spelling is not a receiver question: `x#y` is deliberate and stays.
    if (rel?.metadata?.localBinding === true) continue
    const src = String(rel?.source ?? "")
    const dot = src.lastIndexOf(".")
    const owner = dot > 0 ? src.slice(0, dot) : ""
    let proposed = tgt
    if (owner && declaredTypes.has(owner)) {
      const m = byOwner.get(owner)
      const q = m?.get(tgt)
      if (q) proposed = q
      else perRepo.get(repo)!.price.noQualifier++
    }
    const p = perRepo.get(repo)!.price
    p.edges++
    const a = classify(keys, tgt)
    const b = classify(keys, proposed)
    p.today[a as keyof Tally]++
    p.proposed[b as keyof Tally]++
    const key = `${a} -> ${b}`
    p.move.set(key, (p.move.get(key) ?? 0) + 1)
    if (proposed !== tgt) {
      p.changed++
      if (p.examples.length < 8) p.examples.push(`${src} -> ${tgt}  ⇒  ${proposed}`)
    }
  }
}

const total = emptyTally()
const totalProposed = emptyTally()
let totEdges = 0
let totChanged = 0
let totNoQualifier = 0
let totUp = 0
let totDown = 0
console.log(`bare-target price — ${[...perRepo.keys()].map((p) => path.basename(p)).join(", ")}`)
console.log(`files parsed: ${parsed.length} (${failed} failed/degraded)   types: ${[...TYPES].join(", ")}`)
for (const [repo, b] of perRepo) {
  const get = (k: string) => b.price.move.get(k) ?? 0
  const regress = get("resolved -> ambiguous") + get("resolved -> unresolved")
  const up = get("unresolved -> resolved") + get("ambiguous -> resolved")
  console.log("")
  console.log(`  ${path.basename(repo)}  edges ${b.price.edges}  re-spelled ${b.price.changed}`)
  console.log(`    TODAY     resolved ${b.price.today.resolved}  ambiguous ${b.price.today.ambiguous}  unresolved ${b.price.today.unresolved}`)
  console.log(`    PROPOSED  resolved ${b.price.proposed.resolved}  ambiguous ${b.price.proposed.ambiguous}  unresolved ${b.price.proposed.unresolved}`)
  console.log(`    MOVES     unresolved→resolved ${get("unresolved -> resolved")}  ambiguous→resolved ${get("ambiguous -> resolved")}  REGRESSIONS ${regress}`)
  console.log(`    (edges inside a known class that declares no such member: ${b.price.noQualifier})`)
  for (const e of b.price.examples.slice(0, 4)) console.log(`      ${e}`)
  total.resolved += b.price.today.resolved
  total.ambiguous += b.price.today.ambiguous
  total.unresolved += b.price.today.unresolved
  totalProposed.resolved += b.price.proposed.resolved
  totalProposed.ambiguous += b.price.proposed.ambiguous
  totalProposed.unresolved += b.price.proposed.unresolved
  totEdges += b.price.edges
  totChanged += b.price.changed
  totNoQualifier += b.price.noQualifier
  totUp += up
  totDown += regress
}
console.log("")
console.log(`TOTAL  edges ${totEdges}  re-spelled ${totChanged}`)
console.log(`  TODAY     resolved ${total.resolved}  ambiguous ${total.ambiguous}  unresolved ${total.unresolved}`)
console.log(`  PROPOSED  resolved ${totalProposed.resolved}  ambiguous ${totalProposed.ambiguous}  unresolved ${totalProposed.unresolved}`)
console.log(`  MOVES     +${totUp} resolved, ${totDown} regression(s) — a regression needs two`)
console.log(`            declarations of the same \`Owner.member\` in one project, so it is counted.`)
console.log(`  declines   ${totNoQualifier} edge(s) inside a known class that does not declare the name —`)
console.log(`             left at their bare spelling, because that receiver's type is not this file's.`)
console.log(
  `  The proposal can only re-spell an edge whose enclosing class DECLARES the name, and the`,
)
console.log(
  `  qualified spelling is one this project publishes — so a regression needs two declarations`,
)
console.log(`  of the same \`Owner.member\` in one project, which is why it is counted rather than assumed.`)
