/**
 * ZIG — the three incoming causes `archive/docs-pre-consolidation/ROUND-BRIEF.md` asks every lane to report, one
 * number per cell, from ONE draw and ONE walk.
 *
 * `script/m14/diagnose-incoming.mts` prints all three causes and its B and C counts are
 * UPPER BOUNDS rather than prizes, for reasons this file measures:
 *
 *   B  FORMAT MISMATCH — an unresolved target that contains a `.` and whose FINAL SEGMENT
 *      is a published name. The tool calls those "resolvable if both sides use one
 *      function". For zig after Z66 that reading is wrong in a checkable way — the
 *      target is `std.debug.assert` because `std` is an EXTERNAL `@import` alias, and
 *      `assert` is a published name in that file for unrelated reasons. Retargeting to
 *      `assert` binds a stdlib member to a same-named local declaration, which is the
 *      fabrication Z66 declined. The B cell is therefore partitioned by a fact
 *      production records: `metadata.zigExternalRef`.
 *
 *   A  NAME IS NOT AN IDENTIFIER — the published name is a bare simple name, so N files
 *      declaring it collapse into one node. The cell this file prices is AMBIGUOUS
 *      EDGES, and it partitions them the same way: an edge whose metadata says
 *      `zigImport` names a MODULE and is already marked external, while an edge with no
 *      such marker names a local declaration that merely shares a name. Those are two
 *      different defects wearing one number.
 *
 *   C  EXTERNAL — stdlib / builtin references, legitimately outside the corpus. Counted
 *      here in TARGETS, because `diagnose-incoming` prices C in targets.
 *
 * ## The two arms, and why both are here
 *
 * `diagnose-incoming.mts` reads `ASTEngine.parseFile`, the ANALYZER'S OWN per-file unit.
 * Production is `parseFile` from `src/ast/pool-worker`, which adds the pipeline stages —
 * pool, timeouts, truncation, enhancements, `keepSymbol`. The two are NOT the same
 * population, so the shared instrument's numbers are statements about the ENGINE arm.
 * Both arms are computed here from the same draw so the difference is measured rather
 * than assumed, and PRODUCTION decides anything, because production is what an edge in
 * `bb_graph` came from.
 *
 * ## Population
 *
 * `find <root> -name '*.zig' -type f | sort | head -N` — the identical draw and the
 * identical ordering `diagnose-incoming.mts` uses, because a before/after from two
 * different populations is not a before/after. Root and N are printed with every number.
 *
 * Usage: npx tsx validation/m14/fixtures/zig/incoming-abc-class.ts <root> [N] [--out p]
 */
import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { ASTEngine } from "../../../../src/ast/engine"
import { parseFile } from "../../../../src/ast/pool-worker"

const argv = process.argv.slice(2)
const positional = argv.filter((a) => !a.startsWith("--"))
const flag = (k: string, d: string) => {
  const hit = argv.find((a) => a === `--${k}` || a.startsWith(`--${k}=`))
  if (hit === undefined) return d
  const eq = hit.indexOf("=")
  return eq === -1 ? (argv[argv.indexOf(hit) + 1] ?? d) : hit.slice(eq + 1)
}
const root = positional[0] ?? "/home/ishaq2321/bb_tests/repositories"
const N = Number(positional[1] ?? 80)
const out = flag("out", "")
const REPO_ROOT = "/home/ishaq2321/bb_tests/repositories"

const files = execFileSync("bash", ["-lc", `find ${root} -name '*.zig' -type f | sort | head -${N}`], {
  encoding: "utf8",
  maxBuffer: 1 << 28,
})
  .trim()
  .split("\n")
  .filter(Boolean)

type RawEdge = {
  target: string
  type: string
  marked: boolean
  alias: string
  module: string
  /** names a MODULE rather than a declaration — `metadata.zigImport` / `isImport`. */
  isImport: boolean
  /** `undefined` when the edge carries no confidence at all — counted separately. */
  confidence: number | undefined
  file: string
}
type Classified = RawEdge & { bareModule: boolean; spelled: boolean; aliasBinds: boolean }

/** published name -> the files and qualifiedNames that declare it, per arm */
type NameIndex = Map<string, { files: Set<string>; quals: Set<string> }>
type Arm = { index: NameIndex; edges: RawEdge[]; fileNames: Map<string, Set<string>> }

const engine: Arm = { index: new Map(), edges: [], fileNames: new Map() }
const prod: Arm = { index: new Map(), edges: [], fileNames: new Map() }
const prodClassified: Classified[] = []
let engineFailed = 0
let prodFailed = 0
const collapse = (s: string) => s.replace(/\s+/g, "")

/** Read one arm: every published name with the files that declare it, and every edge. */
function harvest(r: any, file: string, arm: Arm): void {
  let mine = arm.fileNames.get(file)
  if (!mine) arm.fileNames.set(file, (mine = new Set()))
  for (const s of r?.symbols ?? []) {
    const name = String(s.name)
    mine.add(name)
    let e = arm.index.get(name)
    if (!e) arm.index.set(name, (e = { files: new Set(), quals: new Set() }))
    e.files.add(file)
    const q = String(s.qualifiedName ?? "")
    if (q && q !== name) e.quals.add(q)
  }
  for (const rel of r?.relationships ?? []) {
    const target = String(rel?.target ?? "")
    if (!target) continue
    const md = (rel.metadata ?? {}) as Record<string, unknown>
    arm.edges.push({
      target,
      type: String(rel?.type ?? "").toLowerCase(),
      marked: md.zigExternalRef === true,
      alias: String(md.zigImportAlias ?? ""),
      module: String(md.zigImportModule ?? ""),
      isImport: md.zigImport === true || md.isImport === true,
      confidence: typeof rel?.confidence === "number" ? (rel.confidence as number) : undefined,
      file,
    })
  }
}

for (const f of files) {
  const text = readFileSync(f, "utf8")
  const squashed = collapse(text)
  let engineResult: any = null
  let prodResult: any = null
  try {
    engineResult = await ASTEngine.parseFile(f, text)
    harvest(engineResult, f, engine)
  } catch {
    engineFailed++
  }
  try {
    prodResult = await parseFile(f, REPO_ROOT)
    harvest(prodResult, f, prod)
  } catch {
    prodFailed++
  }
  // The B cell's three checks need the file's own text and are computed against the
  // PRODUCTION arm's edge list after the whole walk, because a target can be published
  // by a LATER file than the one that emits the edge. Classifying inside the loop
  // against a partially-filled index is the bug an earlier revision of this file had:
  // it reported 22 edges where the correct answer is 56.
  for (const rel of prodResult?.relationships ?? []) {
    const target = String(rel?.target ?? "")
    const md = (rel.metadata ?? {}) as Record<string, unknown>
    const alias = String(md.zigImportAlias ?? "")
    const module = String(md.zigImportModule ?? "")
    prodClassified.push({
      target,
      type: String(rel?.type ?? "").toLowerCase(),
      marked: md.zigExternalRef === true,
      alias,
      module,
      isImport: md.zigImport === true || md.isImport === true,
      confidence: typeof rel?.confidence === "number" ? (rel.confidence as number) : undefined,
      file: f,
      bareModule: module !== "" && !/[./:]/.test(module),
      spelled: target.includes(".") ? squashed.includes(collapse(target)) : true,
      aliasBinds: alias === "" ? true : new RegExp(`\\b${alias}\\b`).test(text),
    })
  }
}

const engineNames = new Set(engine.index.keys())
const prodNames = new Set(prod.index.keys())

/**
 * rule B, computed on one arm. `diagnose-incoming.mts` applies, in order:
 *   unresolved  = distinct targets with no published name
 *   dotted      = unresolved containing `.`
 *   lastSegHits = dotted whose final segment IS a published name
 * and then prices the hit set by counting EDGES rather than targets. Reproduced in
 * that order from the same draw, so the two instruments' numbers are comparable
 * without either being re-derived by hand.
 */
function ruleB(names: Set<string>, arm: { target: string; type: string }[]) {
  const distinct = [...new Set(arm.map((e) => e.target))]
  const unresolved = distinct.filter((t) => !names.has(t))
  const dotted = unresolved.filter((t) => t.includes("."))
  const hits = dotted.filter((t) => names.has(t.split(".").pop()!))
  const hitSet = new Set(hits)
  const cost = new Map<string, number>()
  for (const e of arm) {
    if (names.has(e.target)) continue
    if (!e.target.includes(".")) continue
    if (!names.has(e.target.split(".").pop()!)) continue
    cost.set(e.type, (cost.get(e.type) ?? 0) + 1)
  }
  return {
    edges: arm.length,
    publishedNames: names.size,
    distinctTargets: distinct.length,
    unresolvedTargets: unresolved.length,
    dottedTargets: dotted.length,
    lastSegmentPublishedTargets: hits.length,
    recoverableEdges: [...cost.values()].reduce((a, b) => a + b, 0),
    recoverableByType: Object.fromEntries([...cost].sort((a, b) => b[1] - a[1])),
    hitSet,
  }
}

const engineB = ruleB(engineNames, engine.edges)
const prodB = ruleB(prodNames, prod.edges)

/** The production rule-B population, classified. */
const ruleBPopulation = prodClassified.filter((e) => prodB.hitSet.has(e.target))
const markedCell = ruleBPopulation.filter((e) => e.marked)
const unmarkedCell = ruleBPopulation.filter((e) => !e.marked)
const fullyVerified = markedCell.filter((e) => e.bareModule && e.spelled && e.aliasBinds)
const markedUnverified = markedCell.filter((e) => !(e.bareModule && e.spelled && e.aliasBinds))

/**
 * cause A. A target is AMBIGUOUS when more than one file publishes that name — the
 * shape `diagnose-incoming` counts — and the interesting quantity is not how many names
 * collide but how many EDGES land on a colliding name, because that is what a consumer
 * has to disambiguate. Each such edge is then partitioned by whether its own metadata
 * says it names a MODULE (`zigImport`) — already marked, already excludable — or a
 * declaration that merely shares a name, which is the genuine cause-A defect.
 */
const ambiguousTargets = [...prod.index.entries()]
  .filter(([, v]) => v.files.size > 1)
  .map(([name, v]) => ({ name, files: v.files.size, quals: v.quals.size }))
const ambiguousSet = new Set(ambiguousTargets.map((a) => a.name))
const ambiguousEdges = prodClassified.filter((e) => ambiguousSet.has(e.target))
const ambiguousImportEdges = ambiguousEdges.filter((e) => e.isImport)
const ambiguousLocalEdges = ambiguousEdges.filter((e) => !e.isImport)
const ambiguousLocalByType = new Map<string, number>()
for (const e of ambiguousLocalEdges) ambiguousLocalByType.set(e.type, (ambiguousLocalByType.get(e.type) ?? 0) + 1)
const noQualCount = ambiguousTargets.filter((a) => a.quals === 0).length
/**
 * The decisive split for WHERE the fix belongs. An ambiguous edge is recoverable by a
 * PER-FILE resolution rule when the edge's own file publishes the target — that is the
 * only file where the name is not a guess. An ambiguous edge with no same-file candidate
 * cannot be recovered that way at all: no local rule can pick a symbol the file does not
 * declare, and only a name that carries file identity can. So the two counts say whether
 * the work belongs in a resolver (shared machinery) or in this lane's name surface.
 */
const ambiguousLocalWithLocalCandidate = ambiguousLocalEdges.filter((e) => prod.fileNames.get(e.file)?.has(e.target))
const ambiguousLocalWithoutLocalCandidate = ambiguousLocalEdges.filter((e) => !prod.fileNames.get(e.file)?.has(e.target))
const noCandidateByType = new Map<string, number>()
for (const e of ambiguousLocalWithoutLocalCandidate) noCandidateByType.set(e.type, (noCandidateByType.get(e.type) ?? 0) + 1)
const withCandidateByType = new Map<string, number>()
for (const e of ambiguousLocalWithLocalCandidate) withCandidateByType.set(e.type, (withCandidateByType.get(e.type) ?? 0) + 1)
/** the top colliding names, with how their edges split */
const topAmbiguous = ambiguousTargets
  .sort((a, b) => b.files - a.files)
  .slice(0, 10)
  .map((a) => {
    const es = ambiguousEdges.filter((e) => e.target === a.name)
    return {
      name: a.name,
      files: a.files,
      distinctQualifiedNames: a.quals,
      edges: es.length,
      edgesNamingAModule: es.filter((e) => e.isImport).length,
      edgesNamingALocalDeclaration: es.filter((e) => !e.isImport).length,
    }
  })

/** cause C: every edge carrying an external marker, whatever its target shape. */
const markedTotal = prodClassified.filter((e) => e.marked).length
const markedByType = new Map<string, number>()
for (const e of prodClassified) if (e.marked) markedByType.set(e.type, (markedByType.get(e.type) ?? 0) + 1)
const dottedEdges = prodClassified.filter((e) => e.target.includes("."))
const markedDottedEdges = dottedEdges.filter((e) => e.marked)
/** diagnose-incoming prices cause C in TARGETS, so the marked set is priced that way too. */
const markedTargets = new Set(prodClassified.filter((e) => e.marked).map((e) => e.target))
const markedUnresolvedTargets = [...markedTargets].filter((t) => !prodNames.has(t))
/** every edge that names a MODULE — cause A's already-marked cell and cause C's wider set */
const importEdges = prodClassified.filter((e) => e.isImport)
const importByType = new Map<string, number>()
for (const e of importEdges) importByType.set(e.type, (importByType.get(e.type) ?? 0) + 1)
/** the residue: unresolved, and neither marker says why */
const unmarkedUnresolved = new Set(
  prodClassified.filter((e) => !prodNames.has(e.target) && !e.marked && !e.isImport).map((e) => e.target),
)

const targetCounts = new Map<string, number>()
for (const e of ruleBPopulation) targetCounts.set(e.target, (targetCounts.get(e.target) ?? 0) + 1)
const topMarked = [...targetCounts.entries()]
  .filter(([t]) => ruleBPopulation.filter((e) => e.target === t).every((e) => e.marked))
  .sort((a, b) => b[1] - a[1])
  .slice(0, 12)
  .map(([t, n]) => {
    const e = ruleBPopulation.find((x) => x.target === t)!
    return { target: t, edges: n, type: e.type, alias: e.alias, module: e.module }
  })

/**
 * Per-type resolution, on the two tiers the lane's C6 control uses, and the heuristic
 * ratio the workstream asks every lane for.
 *
 *   fileLocal    the edge's OWN file publishes the target — the only tier where the
 *                name is not a guess
 *   corpusTier   SOME file in the population publishes it — the tier a consumer that
 *                indexes one whole project actually reaches
 *   heuristic    confidence < 0.7. A deterministic parse fact is not a heuristic, so
 *                these are countable rather than rhetorical.
 *
 * Both tiers are computed against the PRODUCTION arm's own name index, so an edge to a
 * declaration the pipeline deleted counts as unresolved rather than quietly binding.
 */
const typeRows = new Map<
  string,
  { edges: number; fileLocal: number; corpusTier: number; marked: number; heuristic: number; noConfidence: number; confidences: Map<string, number> }
>()
for (const e of prodClassified) {
  let row = typeRows.get(e.type)
  if (!row) typeRows.set(e.type, (row = { edges: 0, fileLocal: 0, corpusTier: 0, marked: 0, heuristic: 0, noConfidence: 0, confidences: new Map() }))
  row.edges++
  if (prod.fileNames.get(e.file)?.has(e.target)) row.fileLocal++
  if (prodNames.has(e.target)) row.corpusTier++
  if (e.marked || e.isImport) row.marked++
  if (e.confidence === undefined) row.noConfidence++
  else if (e.confidence < 0.7) row.heuristic++
  const ck = String(e.confidence ?? "absent")
  row.confidences.set(ck, (row.confidences.get(ck) ?? 0) + 1)
}
const resolutionByType = [...typeRows.entries()]
  .sort((a, b) => b[1].edges - a[1].edges)
  .map(([type, r]) => ({
    type,
    edges: r.edges,
    fileLocalPct: Number(((100 * r.fileLocal) / r.edges).toFixed(2)),
    corpusTierPct: Number(((100 * r.corpusTier) / r.edges).toFixed(2)),
    markedExternalPct: Number(((100 * r.marked) / r.edges).toFixed(2)),
    heuristicUnder07: r.heuristic,
    heuristicPct: Number(((100 * r.heuristic) / r.edges).toFixed(2)),
    noConfidence: r.noConfidence,
    confidences: Object.fromEntries([...r.confidences].sort()),
  }))
const totalHeuristic = [...typeRows.values()].reduce((a, r) => a + r.heuristic, 0)
const totalNoConfidence = [...typeRows.values()].reduce((a, r) => a + r.noConfidence, 0)
const totalEdges = prodClassified.length

const report = {
  root,
  drawN: N,
  filesWalked: files.length,
  engineFailed,
  prodFailed,
  engineArm: { ...engineB, hitSet: undefined },
  productionArm: { ...prodB, hitSet: undefined },
  causeA: {
    ambiguousTargets: ambiguousTargets.length,
    withNoDistinctQualifiedName: noQualCount,
    ambiguousEdges: ambiguousEdges.length,
    edgesNamingAModule: ambiguousImportEdges.length,
    edgesNamingALocalDeclaration: ambiguousLocalEdges.length,
    localByType: Object.fromEntries([...ambiguousLocalByType].sort((a, b) => b[1] - a[1])),
    partitionIdentityHolds: ambiguousImportEdges.length + ambiguousLocalEdges.length === ambiguousEdges.length,
    localWithSameFileCandidate: ambiguousLocalWithLocalCandidate.length,
    localWithoutSameFileCandidate: ambiguousLocalWithoutLocalCandidate.length,
    withCandidateByType: Object.fromEntries([...withCandidateByType].sort((a, b) => b[1] - a[1])),
    withoutCandidateByType: Object.fromEntries([...noCandidateByType].sort((a, b) => b[1] - a[1])),
    topAmbiguous,
  },
  productionRuleBPopulation: {
    edges: ruleBPopulation.length,
    distinctTargets: targetCounts.size,
    markedExternalRef: markedCell.length,
    unmarked: unmarkedCell.length,
    identityHolds: markedCell.length + unmarkedCell.length === ruleBPopulation.length,
    markedAlsoBareModuleSpelledAliasBinds: fullyVerified.length,
    markedFailingOneOfThose: markedUnverified.length,
    unmarkedTargets: [...new Set(unmarkedCell.map((e) => e.target))].slice(0, 20),
    topMarkedTargets: topMarked,
  },
  resolutionByType,
  heuristicRatio: {
    edges: totalEdges,
    under07: totalHeuristic,
    under07Pct: Number(((100 * totalHeuristic) / totalEdges).toFixed(2)),
    noConfidenceField: totalNoConfidence,
  },
  causeC: {
    markedEdgesAllShapes: markedTotal,
    markedByType: Object.fromEntries([...markedByType].sort()),
    dottedEdgesAllShapes: dottedEdges.length,
    markedAndDottedEdges: markedDottedEdges.length,
    markedDistinctTargets: markedTargets.size,
    markedDistinctUnresolvedTargets: markedUnresolvedTargets.length,
    unresolvedDistinctTargetsTotal: prodB.unresolvedTargets,
    moduleNamingEdges: importEdges.length,
    moduleNamingByType: Object.fromEntries([...importByType].sort()),
    /** an unresolved target with no marker at all — the residue neither A nor C explains */
    unmarkedUnresolvedTargetCount: unmarkedUnresolved.size,
    unmarkedUnresolvedTargets: [...unmarkedUnresolved].slice(0, 20),
  },
}

const lines = [
  `incoming A/B/C classification — zig`,
  `root ${root}  draw N=${N}  files walked ${files.length}  engine parse failures ${engineFailed}  production parse failures ${prodFailed}`,
  ``,
  `rule B on the ENGINE arm (what diagnose-incoming.mts prints — ASTEngine.parseFile)`,
  `  published names ${engineB.publishedNames}  edges ${engineB.edges}  distinct targets ${engineB.distinctTargets}`,
  `  unresolved ${engineB.unresolvedTargets}  dotted ${engineB.dottedTargets}  final segment published ${engineB.lastSegmentPublishedTargets}`,
  `  EDGES recoverable ${engineB.recoverableEdges}  ${JSON.stringify(engineB.recoverableByType)}`,
  ``,
  `rule B on the PRODUCTION arm (parseFile from src/ast/pool-worker)`,
  `  published names ${prodB.publishedNames}  edges ${prodB.edges}  distinct targets ${prodB.distinctTargets}`,
  `  unresolved ${prodB.unresolvedTargets}  dotted ${prodB.dottedTargets}  final segment published ${prodB.lastSegmentPublishedTargets}`,
  `  EDGES recoverable ${prodB.recoverableEdges}  ${JSON.stringify(prodB.recoverableByType)}`,
  ``,
  `the production rule-B population, partitioned by metadata.zigExternalRef`,
  `  edges          ${ruleBPopulation.length}   distinct targets ${targetCounts.size}`,
  `  marked         ${markedCell.length}`,
  `  unmarked       ${unmarkedCell.length}   <- a genuine format mismatch, if any`,
  `  identity holds ${report.productionRuleBPopulation.identityHolds}`,
  ``,
  `the marked cell, checked three ways (bare module path / spelled verbatim / alias token present)`,
  `  all three hold  ${fullyVerified.length} of ${markedCell.length}`,
  `  one fails       ${markedUnverified.length}`,
  ``,
  `unmarked targets (the only shape worth retargeting)`,
  ...(report.productionRuleBPopulation.unmarkedTargets.length
    ? report.productionRuleBPopulation.unmarkedTargets.map((t) => `  ${t}`)
    : [`  (none)`]),
  ``,
  `largest fully-marked targets in the rule-B population`,
  ...(topMarked.length
    ? topMarked.map((r) => `  ${String(r.edges).padStart(4)}  ${r.target}   [${r.type} via ${r.alias} = @import("${r.module}")]`)
    : [`  (none)`]),
  ``,
  `cause A — targets published by MORE THAN ONE file, and the edges that land on them`,
  `  ambiguous targets                ${ambiguousTargets.length}`,
  `    of which no distinct qualifiedName  ${noQualCount}`,
  `  edges on an ambiguous target     ${ambiguousEdges.length}`,
  `    naming a MODULE (metadata.zigImport)  ${ambiguousImportEdges.length}   <- already marked external`,
  `    naming a LOCAL declaration             ${ambiguousLocalEdges.length}   <- the genuine cause-A defect`,
  `      ${JSON.stringify(Object.fromEntries([...ambiguousLocalByType].sort((a, b) => b[1] - a[1])))}`,
  `    partition identity holds        ${report.causeA.partitionIdentityHolds}`,
  ``,
  `  of the ${ambiguousLocalEdges.length} local-declaration edges, where a fix belongs`,
  `    the edge's OWN file publishes the target  ${ambiguousLocalWithLocalCandidate.length}   <- a per-file resolver recovers these`,
  `    no same-file candidate                   ${ambiguousLocalWithoutLocalCandidate.length}   <- only a file-scoped NAME recovers these`,
  `      with candidate     ${JSON.stringify(Object.fromEntries([...withCandidateByType].sort((a, b) => b[1] - a[1])))}`,
  `      without candidate  ${JSON.stringify(Object.fromEntries([...noCandidateByType].sort((a, b) => b[1] - a[1])))}`,
  ``,
  `  largest colliding names`,
  `    ${"name".padEnd(14)}${"files".padStart(6)}${"quals".padStart(7)}${"edges".padStart(8)}${"module".padStart(8)}${"local".padStart(8)}`,
  ...topAmbiguous.map(
    (r) =>
      `    ${r.name.slice(0, 14).padEnd(14)}${String(r.files).padStart(6)}${String(r.distinctQualifiedNames).padStart(7)}` +
      `${String(r.edges).padStart(8)}${String(r.edgesNamingAModule).padStart(8)}${String(r.edgesNamingALocalDeclaration).padStart(8)}`,
  ),
  ``,
  `cause C — edges naming something outside the project`,
  `  carrying metadata.zigExternalRef  ${markedTotal}  ${JSON.stringify(Object.fromEntries([...markedByType].sort()))}`,
  `    dotted ${markedDottedEdges.length} of ${dottedEdges.length} dotted edges`,
  `    ${markedTargets.size} distinct targets, ${markedUnresolvedTargets.length} of them unresolved`,
  `      (of ${prodB.unresolvedTargets} unresolved targets in total on this arm)`,
  `  carrying metadata.zigImport       ${importEdges.length}  ${JSON.stringify(Object.fromEntries([...importByType].sort()))}`,
  ``,
  `unresolved targets carrying NEITHER marker — the residue no marker explains`,
  ...(report.causeC.unmarkedUnresolvedTargets.length
    ? report.causeC.unmarkedUnresolvedTargets.map((t) => `  ${t}`)
    : [`  (see json: causeC.unmarkedUnresolvedTargets)`]),
  ``,
  `per-type resolution and the heuristic ratio (production arm)`,
  `  ${"type".padEnd(13)}${"edges".padStart(8)}${"file-loc".padStart(10)}${"corpus".padStart(9)}${"marked".padStart(9)}${"heur<0.7".padStart(10)}${"no-conf".padStart(9)}`,
  ...resolutionByType.map(
    (r) =>
      `  ${r.type.padEnd(13)}${String(r.edges).padStart(8)}${(r.fileLocalPct + "%").padStart(10)}${(r.corpusTierPct + "%").padStart(9)}` +
      `${(r.markedExternalPct + "%").padStart(9)}${String(r.heuristicUnder07).padStart(10)}${String(r.noConfidence).padStart(9)}`,
  ),
  `  ${"ALL".padEnd(13)}${String(totalEdges).padStart(8)}`,
  `  heuristic ratio (confidence < 0.7): ${totalHeuristic} of ${totalEdges} = ${((100 * totalHeuristic) / totalEdges).toFixed(2)}%   edges with no confidence field: ${totalNoConfidence}`,
]

console.log(lines.join("\n"))
if (out) {
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, JSON.stringify(report, null, 1))
  console.log(`\nwrote ${out}`)
}
