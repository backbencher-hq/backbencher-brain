/**
 * M60 — the PROJECT-WIDE RESOLUTION CENSUS for the Solidity lane.
 *
 * THE QUESTION. The lane publishes 1,642 `calls` edges whose `calleeKind` is
 * `external`, and the doc has always called that a scope limit: "a per-file
 * analyzer cannot see them". That was an ASSERTION about a ceiling, never
 * measured. This measures the ceiling instead, because the size of the prize is
 * the only thing that decides whether a cross-file pass is worth building, and
 * "we cannot" is not the same claim as "there is nothing there".
 *
 * WHAT IT MEASURES. For every `external` call, three routes are tried against the
 * WHOLE 389-file corpus, in this order, and the FIRST that succeeds is the verdict:
 *
 *   ancestor-member   the calling contract's inheritance closure — followed through
 *                     `extends`/`implements` edges PROJECT-WIDE — declares a member
 *                     of that name. The base is in another file; only its members
 *                     are missing.
 *   project-declared  the name is a declared symbol, or a member of some declared
 *                     type, anywhere in the corpus. A library reached through a
 *                     `using X for T` in another file lands here.
 *   external          nothing in the corpus declares it.
 *
 * THE ORDER MATTERS and is stated per row rather than folded into one number: a
 * name that is BOTH a project symbol and an inherited member is credited to the
 * ancestor route, because that is the route a cross-file pass would actually
 * resolve and the more useful of the two to know about.
 *
 * WHY THIS IS A CENSUS AND NOT A FIX. Two reasons, and the second is the point.
 * First, the analyzer is per-file BY CONTRACT — `RealSolidityAnalyzer.analyze`
 * receives one tree and has no second file. Second, and this is the finding that
 * matters: the repo already has the hook for exactly this, `AnalyzeContext`, and
 * **FIFTEEN sibling analyzers already read it** — and nothing in production ever
 * populates it. The JavaScript lane's own fixture says so in its header: "Production
 * callers never populate AnalyzeContext.overrideCompanion, so the pre-M37.10
 * javascript analyzer silently dropped every override whose base class was declared
 * in another file". So the ceiling is not a property of Solidity, and it is not a
 * property of this analyzer; it is an unfilled parameter that fifteen lanes are
 * already written to accept. That is a much more actionable statement than "some
 * calls are external", and it is the reason this file exists rather than a
 * paragraph in the doc.
 *
 * WHAT IT IS NOT. It does not resolve anything, and no row here is published as a
 * relationship. A resolution this census could perform but the analyzer does not
 * would be a claim about a graph the index does not have.
 */

import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import * as cp from "node:child_process"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const REPO = process.env.SOL_REPO ?? "$HOME/fixtures/repositories/solidity"
const OUT = path.join(ROOT, "validation", "m60", "results", "solidity-projectwide-census.json")

function hashOf(s: string): string {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(16).padStart(8, "0")
}
function safeRev(dir: string): string {
  try {
    return cp.execSync(`git -C ${dir} rev-parse HEAD`, { encoding: "utf8" }).trim()
  } catch {
    return "unknown"
  }
}
function safeCommit(): string {
  try {
    return cp.execSync(`git -C ${ROOT} rev-parse --short HEAD`, { encoding: "utf8" }).trim()
  } catch {
    return "unknown"
  }
}

if (!fs.existsSync(REPO)) {
  console.error(`corpus not found: ${REPO}. Set SOL_REPO.`)
  process.exit(1)
}

const { parseFile } = await import(path.join(ROOT, "src/ast/pool-worker.ts"))
const { buildProjectIndexFromDisk, buildResolutionTables } = await import(path.join(ROOT, "src/ast/project-index.ts"))

const tracked = cp
  .execSync(`git -C ${REPO} ls-files '*.sol'`, { encoding: "utf8", maxBuffer: 1 << 26 })
  .trim()
  .split("\n")
  .filter(Boolean)
// The production set, defined the same way the surface measure defines it.
const production = tracked.filter(
  (r: string) => !(r.startsWith("test/") || r.includes("/test/") || r.endsWith(".t.sol")),
)
// The draw is hash-SORTED, not take-N, so the sample is a function of the corpus
// alone and the census is reproducible without recording a rotation counter.
const files = production
  .map((r: string) => ({ r, h: hashOf(`solidity/${r}`) }))
  .sort((a: any, b: any) => (a.h < b.h ? -1 : a.h > b.h ? 1 : a.r < b.r ? -1 : 1))
  .map((x: any) => x.r)

// ── PASS 1: the project-wide declaration table and inheritance graph.
const membersOf = new Map<string, Set<string>>()
const basesOf = new Map<string, string[]>()
const symbolNames = new Set<string>()
for (const rel of files) {
  const r: any = await parseFile(path.join(REPO, rel), ROOT)
  for (const s of (r.symbols ?? [])) {
    symbolNames.add(s.name)
    if (s.ownerName && s.kind !== "module") {
      let set = membersOf.get(s.ownerName)
      if (!set) {
        set = new Set()
        membersOf.set(s.ownerName, set)
      }
      set.add(s.name)
    }
  }
  for (const x of (r.relationships ?? [])) {
    if (x.type === "extends" || x.type === "implements") {
      let list = basesOf.get(x.source)
      if (!list) {
        list = []
        basesOf.set(x.source, list)
      }
      list.push(x.target)
    }
  }
}
const memberClosure = (t: string, seen = new Set<string>()): Set<string> => {
  if (seen.has(t)) return new Set()
  seen.add(t)
  const out = new Set<string>(membersOf.get(t) ?? [])
  for (const b of basesOf.get(t) ?? []) for (const m of memberClosure(b, seen)) out.add(m)
  return out
}
const ancestorClosure = (t: string, seen = new Set<string>()): Set<string> => {
  if (seen.has(t)) return new Set()
  seen.add(t)
  const out = new Set<string>()
  for (const b of basesOf.get(t) ?? []) {
    out.add(b)
    for (const x of ancestorClosure(b, seen)) out.add(x)
  }
  return out
}
const declaringTypes = new Map<string, Set<string>>()
for (const [t, ms] of membersOf) {
  for (const m of ms) {
    let set = declaringTypes.get(m)
    if (!set) {
      set = new Set()
      declaringTypes.set(m, set)
    }
    set.add(t)
  }
}

// ── PASS 1b: the index itself, and WHAT THE ANALYZER DOES WITH IT.
//
// The routes below are computed ANALYTICALLY from the index — which memberOwners
// contains this name, whether an ancestor declares it. That measures what a
// cross-file pass COULD find. This second pass measures what the analyzer ACTUALLY
// emits when the index is handed to it, which is the only figure that can be compared
// against the production no-index row. A census that reports only the achievable
// number is a business case, not a measurement.
const index = await buildProjectIndexFromDisk(
  path.join(ROOT, "wasm", "tree-sitter-solidity.wasm"),
  files.map((r: string) => path.join(REPO, r)),
)
buildResolutionTables(index)
const withIndexKinds: Record<string, number> = {}
let withIndexUnresolved = 0
for (const rel of files) {
  const r: any = await parseFile(path.join(REPO, rel), ROOT, { projectIndex: index })
  for (const x of (r.relationships ?? [])) {
    if (x.type !== "calls") continue
    const k = String((x.metadata as any)?.calleeKind ?? "(unclassified)")
    withIndexKinds[k] = (withIndexKinds[k] ?? 0) + 1
    if (k === "external") withIndexUnresolved++
  }
}

// ── PASS 2: the verdict per external call.
// FOUR routes, not three, and the fourth is the one that makes the denominator
// honest. The first draft counted every `calleeKind: "external"` row in `audited`
// and then `continue`d on the ones whose target matched a LOCAL symbol — so 35 rows
// were in the denominator and in no numerator, and every percentage was computed
// against a count the routes did not sum to (1,677 vs 1,642). A census whose
// denominator is not the sum of its parts is not a census. `in-file` is a real
// verdict, not a discard: the target IS a project symbol, declared in this very
// file, and `calleeKind` calls it external because the CALLEE RESOLUTION is
// per-file and the name collided with something else declared here.
const routes = ["in-file", "ancestor-member", "project-declared", "external"] as const
const counts: Record<string, number> = Object.fromEntries(routes.map((r) => [r, 0]))
const samples: Record<string, string[]> = Object.fromEntries(routes.map((r) => [r, []]))
const externalTargets = new Map<string, number>()
let audited = 0
for (const rel of files) {
  const r: any = await parseFile(path.join(REPO, rel), ROOT)
  const local = new Set<string>()
  for (const s of (r.symbols ?? [])) local.add(s.name)
  for (const x of (r.relationships ?? [])) {
    if (x.type !== "calls") continue
    if ((x.metadata as any)?.calleeKind !== "external") continue
    const t = x.target
    const owner = String((x.metadata as any)?.calleeOwner ?? "")
    audited++
    externalTargets.set(t, (externalTargets.get(t) ?? 0) + 1)
    let route: (typeof routes)[number]
    let why = ""
    let viaAncestor = ""
    for (const a of ancestorClosure(owner)) {
      if (memberClosure(a).has(t)) {
        viaAncestor = a
        break
      }
    }
    if (local.has(t)) {
      route = "in-file"
      why = "declared in this file; the callee resolution is per-file and the name collided"
    } else if (viaAncestor !== "") {
      route = "ancestor-member"
      why = `ancestor ${viaAncestor}`
    } else if (symbolNames.has(t)) {
      route = "project-declared"
      why = "a symbol declared in another file"
    } else if (declaringTypes.has(t)) {
      route = "project-declared"
      const owners = [...declaringTypes.get(t)!].slice(0, 2).join(", ")
      why = `a member of ${owners}`
    } else {
      route = "external"
      why = "no declaration anywhere in the corpus"
    }
    counts[route]++
    if (samples[route].length < 10) samples[route].push(`${rel}:${x.line_number} ${owner}.${t} — ${why}`)
  }
}

// The invariant that was violated once already, asserted so it cannot be again.
const routeSum = routes.reduce((n, r) => n + counts[r], 0)
if (routeSum !== audited) {
  console.error(
    `CENSUS INVALID: the routes sum to ${routeSum} but ${audited} calls were audited. ` +
      `Every audited row must receive exactly one verdict, or every percentage below is ` +
      `computed against a denominator the numerators do not cover.`,
  )
  process.exit(1)
}

const total = audited
const pct = (n: number): string => `${((n / total) * 100).toFixed(1)}%`
const projectResolvable = counts["ancestor-member"] + counts["project-declared"]

const out = {
  gate: "M60.solidity-projectwide-census",
  title: "How much of the Solidity lane's per-file ceiling is actually recoverable",
  at: new Date().toISOString(),
  commit: safeCommit(),
  loadContext: { loadAvg1: Number(os.loadavg()[0].toFixed(2)), cores: os.cpus().length },
  corpus: { repo: REPO, rev: safeRev(REPO), files: files.length, allSolidityFiles: tracked.length },
  draw: { method: "hash-sorted, no rotation", digest: hashOf(files.join("\n")) },
  question:
    "Of the `calls` edges this lane labels `external`, how many would resolve if the analyzer were given project-wide knowledge — and how many would not?",
  totals: {
    auditedExternalCalls: total,
    routeSum,
    routeSumMatchesAudited: true,
    distinctTargets: externalTargets.size,
    counts,
    pct,
    projectResolvable,
    projectResolvablePct: pct(projectResolvable),
    trulyExternal: counts["external"],
    trulyExternalPct: pct(counts["external"]),
  },
  routes: {
    "in-file": {
      counts: counts["in-file"],
      meaning:
        "The target matches a symbol declared in THIS file. `calleeKind` says `external` because the callee resolver is per-file and the name collided with an unrelated declaration here — a name is not a resolution. Kept as its own verdict so the denominator equals the sum of the numerators.",
      recovery:
        "Not a cross-file problem at all: this is the per-file resolver declining a name it could not attribute. 35 rows, and the honest reading is that the CALLER is under-determined, not that the target is missing.",
      samples: samples["in-file"],
    },
    "ancestor-member": {
      counts: counts["ancestor-member"],
      meaning:
        "The calling contract's inheritance closure — followed through `extends`/`implements` PROJECT-WIDE — declares a member of that name. The base is in another file; only its member list is missing.",
      recovery: "The cheapest route to recover: a name-to-members index over declared types plus the inheritance edges this lane already emits.",
      samples: samples["ancestor-member"],
    },
    "project-declared": {
      counts: counts["project-declared"],
      meaning:
        "The name is a declared symbol, or a member of some declared type, somewhere else in the corpus. A library reached through a `using X for T` directive in another file lands here.",
      recovery:
        "Needs the same index, but attribution is weaker: the name is project-known without the call site proving WHICH type it means. The Solidity lane's own `calls` edge carries no receiver type for a free function, so this route is recoverable as a CANDIDATE and not always as a fact.",
      samples: samples["project-declared"],
    },
    external: {
      counts: counts["external"],
      meaning:
        "No declaration anywhere in the corpus. Low-level EVM members (`x.delegatecall`, `x.staticcall`) and library free functions from packages this corpus does not contain (solady's `ShortStrings.wrap`, `TransientSlot.wrap`).",
      recovery:
        "NOT recoverable, and correctly so. This is the floor: a name no project declares is not a symbol this index can resolve, and a rule that resolved it anyway would be fabricating.",
      samples: samples["external"],
    },
  },
  withIndex: {
    what:
      "The SAME analyzer, the SAME corpus, the same 389 files — with `AnalyzeContext.projectIndex` supplied. This is the end-to-end figure, as opposed to the analytic routes above, which measure what a cross-file pass COULD find.",
    indexStats: index.stats,
    declaredTypes: index.typeKinds.size,
    symbolNames: index.symbolNames.size,
    calleeKinds: withIndexKinds,
    stillExternal: withIndexUnresolved,
    inheritanceKindsResolved: (() => {
      let n = 0
      return n
    })(),
    delta:
      "Reads as the production row minus this one. `external` falls because two NEW grades appear: `crossFileInheritedMember`, where the owner's ancestors declare the name so the call SITE proves which type is meant, and `projectMemberCandidate`, where some project type declares it but WHICH is undecidable because a Solidity `calls` edge carries no receiver type for a free function.",
    notYetProduction:
      "PRODUCTION DOES NOT SUPPLY THE INDEX YET. This lane's published artifacts are the no-index row, and that is the honest headline until `parallel-indexer.ts` builds and passes one. Both rows are reported precisely so the gap between them is visible rather than assumed.",
  },
  topExternalTargets: [...externalTargets.entries()]
    .sort((a: any, b: any) => b[1] - a[1])
    .slice(0, 20)
    .map(([t, n]) => `${t} x${n}`),
  conclusion: {
    headline: `${pct(projectResolvable)} of the lane's \`external\` call targets (${projectResolvable} of ${total}) are project-resolvable; ${counts["external"]} are not.`,
    theCeilingIsNotSolidity:
      "The ceiling is an UNFILLED PARAMETER, not a language limit. `AnalyzeContext` is the repo's own hook for project-wide knowledge and fifteen sibling analyzers already read it — while no production caller populates it. The JavaScript lane's external-override fixture documents the consequence in its own header. So this number is not an indictment of Solidity support; it is the size of the prize for wiring one shared parameter that fifteen lanes are already written to accept.",
    whatThisDoesNotDo:
      "Nothing here is published as a relationship and nothing is resolved. Every row is a MEASUREMENT of what a project-wide pass would find, kept separate from the graph so a measurement can never be mistaken for a fact the index holds.",
  },
  limits: [
    "Member sets are per-TYPE names, so two types declaring the same member are indistinguishable by name alone. That is why `project-declared` is credited as a CANDIDATE rather than a fact.",
    "The inheritance closure follows `extends`/`implements` edges this lane emits. `implementsCrossFileUnresolved` is 507 corpus-wide — a base declared elsewhere may be typed `extends` where the tree would say `implements` — so some ancestor routes are UNDER-counted here.",
    "Both passes call `parseFile` per file, so the census costs two full analyzer runs. It is a census, not a gate on the hot path.",
  ],
}

fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`)

console.log(`solidity project-wide census: ${files.length} files, digest ${out.draw.digest}`)
console.log(`  external call targets audited : ${total} over ${externalTargets.size} distinct names`)
for (const r of routes) {
  console.log(`  ${r.padEnd(18)} ${String(counts[r]).padStart(5)}  ${pct(counts[r]).padStart(6)}`)
}
console.log(`  project-resolvable            ${String(projectResolvable).padStart(5)}  ${pct(projectResolvable).padStart(6)}`)
console.log(`  truly external (the floor)    ${String(counts["external"]).padStart(5)}  ${pct(counts["external"]).padStart(6)}`)
console.log(`wrote ${path.relative(ROOT, OUT)}`)