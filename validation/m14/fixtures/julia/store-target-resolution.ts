/**
 * STORE TARGET RESOLUTION — what the store actually does with an emitted target, by type.
 * ------------------------------------------------------------------------
 * ## Why this file exists
 *
 * The lane's ambiguity split (`ambiguity-split.ts`) partitions an ambiguous target three
 * ways, and its THIRD partition answers "what does the store actually do with it". That
 * partition was computed by replaying ONE resolver statement for all ten types:
 *
 *     ORDER BY COALESCE(s.is_declaration,0) ASC, (s.file_id = ?) DESC, (f.language = ?) DESC, s.id
 *
 * That is `resolveTargetStmt` (`src/ast/parallel-indexer.ts:2239`) — and it is the wrong
 * statement for `contains`. `:3500` dispatches on the type:
 *
 *     const resolvedRow = relType === "contains" && relLine !== null
 *       ? resolveContainsTargetStmt.get(projectId, targetLeaf, fileId, relLine, relLang)
 *       : resolveTargetStmt.get(projectId, targetLeaf, fileId, relLang)
 *
 * and `resolveContainsTargetStmt` (`:2354`) orders DIFFERENTLY:
 *
 *     ORDER BY (s.file_id = ?) DESC, (s.line_start = ?) DESC, COALESCE(s.is_declaration,0) ASC,
 *              (f.language = ?) DESC, s.id
 *
 * The second tier is `line_start = <the edge's own line>`, which is the #612/#921 contract:
 * a `contains` edge carries the CHILD's naming line, so the target is the candidate
 * written on that line. So for `contains` the store has a disambiguator the split's
 * partition did not model, and the lane's own "attributed arbitrarily" figure is an
 * OVERSTATEMENT for that one type.
 *
 * That matters twice, and both are claims this file can falsify:
 *
 *   1. the lane doc's "16,608 of 19,938 edges (83.3%) are attributed arbitrarily today"
 *      counts the 827 `contains` edges in the `attribInFileMulti` arm as arbitrary; if the
 *      line tier decides them, that number is too high by however many it decides;
 *   2. §8 row 16's falsifiable PREDICTION for the shared target-lookup fix says the
 *      `incoming-check` ambiguous column "falls by at least the 827 + 1,343 + 357 = 2,527
 *      same-file multi-declaration edges" those three types contribute. If `contains` is
 *      already line-pinned, a supervisor who applies row 16, sees the `contains` column
 *      unchanged, and concludes the fix did not work. The prediction as written is not
 *      met by a correct implementation of row 16.
 *
 * ## What is measured
 *
 * Over the pinned 600-file sample, for every `contains` edge:
 *
 *   candidates    the published symbols whose `name` equals the edge's target leaf — the
 *                 rows `WHERE s.project_id = ? AND s.name = ?` would return;
 *   genericWinner the winner under `resolveTargetStmt`'s ORDER BY;
 *   lineWinner    the winner under `resolveContainsTargetStmt`'s ORDER BY;
 *   linePinned    `linePinned === 1` means EXACTLY ONE candidate sits on the edge's own
 *                 line, so the line tier decides the edge outright;
 *   verdict       whether the two statements disagree, and whether the one the store uses
 *                 lands on the candidate written on the edge's line.
 *
 * ## The 600-file window is EXACT for this type, and why
 *
 * A window of 600 files is a subset of what the store's `WHERE s.name = ?` sees, so a
 * replay can be missing a candidate. For `contains` it cannot be: `contains` is
 * intra-file (the target is a member of the same file), and `(s.file_id = ?) DESC` is the
 * FIRST tier of both statements, so every winner this file computes is a same-file
 * candidate, and the same-file candidate set is complete by construction. The window is
 * exact for the question asked. It is NOT exact for `references`/`calls`/etc., which is
 * why this file measures `contains` only.
 *
 * `is_declaration` is dropped from the model and that is ASSERTED, not assumed: this lane's
 * analyzer never sets `metadata.isDeclaration` (0 occurrences in `real-julia-analyzer.ts`),
 * so `pool-worker.ts:998` publishes `undefined`, the column is NULL, and
 * `COALESCE(NULL, 0)` is the constant 0 across every candidate — a tier that cannot
 * reorder anything. The file counts the symbols that carry it and exits non-zero if a
 * future analyzer edit makes it non-zero, because at that point both ORDER BYs must be
 * replayed with it and every number here is stale.
 *
 * ## NO REGEX
 *
 * Leaf extraction replays the store's `extractLeaf` by string splitting, not by pattern:
 * a `:123` line suffix, a `/N` arity suffix, then last-of-`:` then last-of-`.`. The source
 * text is never scanned; everything comes from `parseFile` output.
 *
 * ## Usage
 *
 *   npx tsx validation/m14/fixtures/julia/contains-target-resolution.ts [--json out.json] [--files N]
 *
 * Default sample = the `sampleList` of `validation/m14/measurements/julia-ambiguity-before.json`
 * (600 files, sampleHash 1c76a52a3ba9c16c), read from the committed record rather than
 * re-sampled, so this file and the split are provably the same population. `--files N` takes
 * the first N of that list for a fast self-test and is NOT a whole-population figure.
 *
 * READ-ONLY with respect to the corpus.
 */
import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"

const argv = process.argv.slice(2)
const jsonIdx = argv.indexOf("--json")
const jsonOut = jsonIdx >= 0 ? argv[jsonIdx + 1] : null
const filesIdx = argv.indexOf("--files")
const FILE_LIMIT = filesIdx >= 0 && argv[filesIdx + 1] ? Number(argv[filesIdx + 1]) : null

const RECORD = path.join(
  process.cwd(),
  "validation/m14/measurements/julia-ambiguity-before.json",
)
const record = JSON.parse(readFileSync(RECORD, "utf8"))
const sampleList: string[] = record.sampleList as string[]
const files = (FILE_LIMIT ? sampleList.slice(0, FILE_LIMIT) : sampleList).map((abs) => ({
  abs,
  // The store keys a file row by its project-relative path, and `s.id` is
  // `${fileId}:${name}:${line}` compared as TEXT. Modelling fileId as the repo-relative
  // path reproduces the WITHIN-FILE tiebreak exactly (name is equal for every candidate,
  // so the remaining comparison is the line as text) and the cross-file ORDER, which is
  // unreachable for `contains` because the same-file tier is first.
  label: abs.slice(abs.indexOf("/repositories/") + "/repositories/".length),
}))

const WIDTH = Number(process.env.BB_JULIA_WORKERS ?? 1)

interface Candidate {
  label: string
  name: string
  kind: string
  startLine: number
  endLine: number
  /** `s.id` as the store spells it; compared as TEXT. */
  id: string
  isDeclaration: boolean
}
interface Rel {
  label: string
  type: string
  source: string
  target: string
  line: number
}

/** The store's `extractLeaf` (:3377), by splitting — never by pattern. */
const extractLeaf = (name: string): string => {
  const noLine = name.endsWith(":") === false && hasTrailingDigits(name) ? name.slice(0, name.lastIndexOf(":")) : name
  const noArity = hasTrailingDigits(noLine, "/") ? noLine.slice(0, noLine.lastIndexOf("/")) : noLine
  const lastColon = noArity.split(":").pop() ?? noArity
  return lastColon.split(".").pop() ?? lastColon
}
function hasTrailingDigits(s: string, sep = ":"): boolean {
  if (!s.endsWith(sep)) return false
  const tail = s.slice(0, s.length - sep.length)
  if (tail.length === 0) return false
  for (let i = tail.length - 1; i >= 0; i--) {
    const c = tail.charCodeAt(i)
    if (c < 48 || c > 57) return false
  }
  return true
}

/** `resolveTargetStmt` (:2239) — the generic statement, which is what the split replayed. */
const genericWinner = (cands: Candidate[], referringFile: string): Candidate =>
  [...cands].sort((a, b) => {
    if (a.isDeclaration !== b.isDeclaration) return a.isDeclaration ? -1 : 1 // COALESCE(...,0) ASC
    const af = a.label === referringFile ? 0 : 1
    const bf = b.label === referringFile ? 0 : 1
    if (af !== bf) return af - bf
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })[0]

/** `resolveContainsTargetStmt` (:2354) — the statement the store actually runs for `contains`. */
const lineWinner = (cands: Candidate[], referringFile: string, edgeLine: number): Candidate =>
  [...cands].sort((a, b) => {
    const af = a.label === referringFile ? 0 : 1
    const bf = b.label === referringFile ? 0 : 1
    if (af !== bf) return af - bf
    const al = a.startLine === edgeLine ? 0 : 1
    const bl = b.startLine === edgeLine ? 0 : 1
    if (al !== bl) return al - bl
    if (a.isDeclaration !== b.isDeclaration) return a.isDeclaration ? -1 : 1
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })[0]

async function main(): Promise<void> {
  const byName = new Map<string, Candidate[]>()
  const byQualified = new Map<string, Candidate[]>()
  const rels: Rel[] = []
  const degraded: string[] = []
  const threw: string[] = []
  let symbols = 0
  let isDeclarationSymbols = 0

  let idx = 0
  const worker = async (): Promise<void> => {
    while (true) {
      const i = idx++
      if (i >= files.length) return
      const f = files[i]
      let r: any
      try {
        r = await parseFile(f.abs, path.dirname(f.abs))
      } catch {
        threw.push(f.label)
        continue
      }
      if (!r) {
        threw.push(f.label)
        continue
      }
      if (r.fallback === true) degraded.push(f.label)
      for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
        const name = String((s as any)?.name ?? "")
        if (name.length === 0) continue
        symbols++
        // The store reads `symbol.startLine ?? symbol.range?.startLine ?? 0` (:2826-2829),
        // so the probe reads the same two keys in the same order. Reading only `range`
        // reads 0 for every symbol this pipeline publishes, which silently turns the
        // line tier into a no-op and makes both statements agree by construction.
        const startLine = Number((s as any)?.startLine ?? (s as any)?.range?.startLine ?? 0)
        const endLine = Number((s as any)?.endLine ?? (s as any)?.range?.endLine ?? startLine)
        const kind = String((s as any)?.kind ?? "")
        const isDecl = (s as any)?.isDeclaration === true
        if (isDecl) isDeclarationSymbols++
        const c: Candidate = { label: f.label, name, kind, startLine, endLine, id: `${f.label}:${name}:${startLine}`, isDeclaration: isDecl }
        const arr = byName.get(name)
        if (arr) arr.push(c)
        else byName.set(name, [c])
        // `qualifiedName` is registered as a SECOND key under the same name, which is what
        // `script/m14/incoming-check.ts:182-188` does and what this lane's own split does.
        // Kept as a separate map here so section two can compare "resolved by the spelling
        // the analyzer emitted" against "resolved by the leaf the store looks up".
        const q = String((s as any)?.qualifiedName ?? "")
        if (q.length > 0 && q !== name) {
          const qa = byQualified.get(q)
          if (qa) qa.push(c)
          else byQualified.set(q, [c])
        }
      }
      for (const rel of Array.isArray(r.relationships) ? r.relationships : []) {
        const type = String((rel as any)?.type ?? (rel as any)?.relationshipType ?? "")
        rels.push({
          label: f.label,
          type,
          source: String((rel as any)?.source ?? ""),
          target: String((rel as any)?.target ?? ""),
          line: Number((rel as any)?.line_number ?? 0),
        })
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, WIDTH) }, () => worker()))

  if (isDeclarationSymbols > 0) {
    console.error(
      `FATAL: ${isDeclarationSymbols} symbols carry isDeclaration. This file's ORDER BY replay drops the ` +
        `COALESCE(s.is_declaration,0) tier on the grounds that it is constant for this lane. That ground is no ` +
        `longer true, so every number here is stale.`,
    )
    process.exit(2)
  }

  type Arm =
    | "uniqueTarget" // one published symbol carries the name: not ambiguous
    | "ambSymCrossFile" // >1 symbol, referring file declares it 0 times
    | "ambSymInFileMulti" // >1 symbol, referring file declares it >=2 times — the arm §8 row 16 names
  const armOf = (cands: Candidate[], referringFile: string): { arm: Arm; fileHits: number } => {
    if (cands.length <= 1) return { arm: "uniqueTarget", fileHits: cands.length }
    const fileHits = cands.filter((c) => c.label === referringFile).length
    if (fileHits === 0) return { arm: "ambSymCrossFile", fileHits: 0 }
    if (fileHits >= 2) return { arm: "ambSymInFileMulti", fileHits }
    return { arm: "uniqueTarget", fileHits }
  }

  const arms: Record<Arm, number> = { uniqueTarget: 0, ambSymCrossFile: 0, ambSymInFileMulti: 0 }
  let linePinnedOne = 0
  let linePinnedZero = 0
  let linePinnedMany = 0
  let linePinnedManyAgrees = 0
  let statementsDisagree = 0
  let genericLandsOffLine = 0
  let storeOnLine = 0
  let genericOnLine = 0
  let candidatesTotal = 0
  let candidatesMax = 0
  const disagreeExamples: any[] = []
  const sampleEdges: any[] = []

  let containsEdges = 0
  for (const rel of rels) {
    // Section one replays `resolveContainsTargetStmt`, which `:3500` runs ONLY for
    // `contains`. Every other type is resolved by the generic statement with no line
    // anchor, so scoring the line tier against them measures a rule that does not
    // exist for them. Filtering here is what makes `containsEdges` true to its name
    // and what makes this file's section one comparable to the committed record.
    if (rel.type !== "contains") continue
    containsEdges++
    const leaf = extractLeaf(rel.target)
    const cands = byName.get(leaf) ?? []
    const { arm, fileHits } = armOf(cands, rel.label)
    arms[arm]++
    if (arm !== "ambSymInFileMulti") continue
    candidatesTotal += cands.length
    if (cands.length > candidatesMax) candidatesMax = cands.length
    if (sampleEdges.length < 12) {
      sampleEdges.push({
        file: rel.label,
        edgeLine: rel.line,
        source: rel.source,
        target: rel.target,
        leaf,
        candidates: cands
          .filter((c) => c.label === rel.label)
          .map((c) => `${c.name}@${c.startLine}-${c.endLine} ${c.kind}`),
        candidatesOutsideThisFile: cands.length - fileHits,
      })
    }

    // The line tier is only reachable for a SAME-FILE candidate: `(s.file_id = ?) DESC`
    // is the first tier, so an out-of-file candidate on the same line number is never
    // considered. Counting it here would credit the tier with a decision it does not make.
    const onLine = cands.filter((c) => c.label === rel.label && c.startLine === rel.line)
    if (onLine.length === 1) linePinnedOne++
    else if (onLine.length === 0) linePinnedZero++
    else linePinnedMany++

    const g = genericWinner(cands, rel.label)
    const l = lineWinner(cands, rel.label, rel.line)
    if (g.id !== l.id) {
      statementsDisagree++
      if (disagreeExamples.length < 8) {
        disagreeExamples.push({ file: rel.label, line: rel.line, target: rel.target, generic: g.id, lineRule: l.id })
      }
    }
    // "On the line" is the #612/#921 contract: the edge carries the child's naming line, so
    // the candidate written on that line is the declaration the edge means. An attribution
    // off the line is therefore a misattribution, and the two statements are scored on it.
    if (l.label === rel.label && l.startLine === rel.line) storeOnLine++
    if (g.label === rel.label && g.startLine === rel.line) genericOnLine++
    else genericLandsOffLine++
  }

  // `linePinnedManyAgrees` above is edge-shaped, not population-shaped; recompute it as the
  // count it claims to be so the record and the printout cannot disagree.
  linePinnedManyAgrees = 0
  for (const rel of rels) {
    if (rel.type !== "contains") continue
    const cands = byName.get(extractLeaf(rel.target)) ?? []
    if (armOf(cands, rel.label).arm !== "ambSymInFileMulti") continue
    const onLine = cands.filter((c) => c.label === rel.label && c.startLine === rel.line)
    if (onLine.length > 1 && genericWinner(cands, rel.label).id === lineWinner(cands, rel.label, rel.line).id) {
      linePinnedManyAgrees++
    }
  }

  // What the line tier BUYS this lane: edges the store attributes to the declaration the
  // edge names, minus the edges the generic statement would have got right unaided.
  const lineTierFixes = storeOnLine - genericOnLine

  // ------------------------------------------------------------------ section two
  // EMITTED SPELLING vs THE LEAF THE STORE LOOKS UP.
  //
  // `extractLeaf` (:3377) reduces the emitted target to its last `.` segment BEFORE the
  // lookup, so a module-qualified target is stored against the BARE name. The lane's own
  // instruments — `ambiguity-split.ts` and the shared `incoming-check.ts` — resolve the
  // target by the SPELLING as emitted, because `published` registers `qualifiedName` as a
  // key of its own. Those are different questions, and this is the size of the gap:
  //
  //   asSpelled  what the lane reports: `published.get(rel.target)`
  //   asLeaf     what the store does:   `published.get(extractLeaf(rel.target))`
  //
  // A target whose two readings disagree is a target whose ambiguity the lane's figure does
  // not describe. The store's arm is the one that reaches `target_symbol_id`.
  const TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"]
  const spelling: Record<string, Record<string, number>> = {}
  for (const t of TYPES) {
    spelling[t] = {
      edges: 0,
      qualifiedTarget: 0,
      armDiffers: 0,
      asSpelledUnresolved: 0,
      asLeafUnresolved: 0,
      asSpelledUnique: 0,
      asLeafAmbiguous: 0,
      asSpelledAmbiguous: 0,
      storeResolvesToNothing: 0,
      storeHasMoreCandidates: 0,
      spelledOnly: 0,
      leafOnly: 0,
      qualifiedBothWays: 0,
    }
  }
  const storeDoesNotUseTheEdgeTarget = new Set<string>()
  for (const rel of rels) {
    const t = spelling[rel.type]
    if (!t) continue
    t.edges++
    const leaf = extractLeaf(rel.target)
    const qualified = leaf !== rel.target && rel.target.length > 0
    if (qualified) t.qualifiedTarget++
    const asSpelled = (byName.get(rel.target) ?? []).concat(byQualified.get(rel.target) ?? [])
    const asLeaf = byName.get(leaf) ?? []
    const spelledArm = armOf(asSpelled, rel.label).arm
    const leafArm = armOf(asLeaf, rel.label).arm
    if (spelledArm !== leafArm) {
      t.armDiffers++
      // An edge the store attributes to a symbol that is NOT the one the lane's figure
      // resolved it to. Named once each; the count is the number above.
      if (storeDoesNotUseTheEdgeTarget.size < 12) storeDoesNotUseTheEdgeTarget.add(`${rel.type} ${rel.target} -> ${leaf}`)
    }
    if (asSpelled.length === 0) t.asSpelledUnresolved++
    if (asLeaf.length === 0) t.asLeafUnresolved++
    if (spelledArm === "uniqueTarget") t.asSpelledUnique++
    if (spelledArm !== "uniqueTarget") t.asSpelledAmbiguous++
    if (leafArm !== "uniqueTarget") t.asLeafAmbiguous++
    if (asLeaf.length === 0) t.storeResolvesToNothing++
    // `asSpelled` is either the leaf's own candidates or the qualified key's, and the
    // qualified key's symbol always carries the leaf as its `name` — so `asLeaf` can only
    // ever be a SUPERSET. The store therefore sees candidates the lane's figure never saw,
    // and the count of edges where that happens is `asLeaf.length > asSpelled.length`.
    else if (asLeaf.length > asSpelled.length) t.storeHasMoreCandidates++
    // Both directions, because the earlier claim here was one-directional and MEASURED WRONG.
    // This analyzer publishes qualified names WHOLE (`Real.show`, `Base.copy`), so a symbol's
    // `name` can itself BE the qualified spelling. `byQualified` is therefore not always a
    // subset of `byName`: for a target `M.x` the qualified key can be absent from `byName` while
    // the LEAF `x` is present under no `name` at all — and then `extractLeaf` LOSES a binding
    // the emitted spelling had. Measured on `uses` and `contains`, where the leaf reading has
    // MORE unresolved than the spelled reading (4,177 vs 4,175 and 45 vs 1).
    if (asSpelled.length > 0 && asLeaf.length === 0) t.spelledOnly++
    else if (asSpelled.length === 0 && asLeaf.length > 0) t.leafOnly++
    else if (asSpelled.length > 0 && asLeaf.length > 0) t.qualifiedBothWays++
  }
  const spellingTotals = TYPES.reduce(
    (acc, t) => {
      for (const k of Object.keys(spelling[t]) as (keyof (typeof spelling)[string])[]) {
        acc[k] = (acc[k] ?? 0) + spelling[t][k]
      }
      return acc
    },
    {} as Record<string, number>,
  )

  const recordOut = {
    instrument: "validation/m14/fixtures/julia/contains-target-resolution.ts",
    measured: new Date().toISOString().slice(0, 10),
    population: {
      record: "validation/m14/measurements/julia-ambiguity-before.json",
      sampleHash: record.sampleHash,
      stride: record.stride,
      corpusAdmitted: record.admittedFiles,
      files: files.length,
      isWholeSample: FILE_LIMIT === null,
      workerWidth: WIDTH,
      symbols,
      symbolsCarryingIsDeclaration: isDeclarationSymbols,
      containsEdges,
      allRelationshipTypes: rels.length,
      degraded,
      parseThrew: threw,
    },
    model: {
      genericStatement: "src/ast/parallel-indexer.ts:2239 resolveTargetStmt",
      containsStatement: "src/ast/parallel-indexer.ts:2354 resolveContainsTargetStmt",
      dispatch: "src/ast/parallel-indexer.ts:3500 — relType === 'contains' && relLine !== null",
      droppedTier:
        "COALESCE(s.is_declaration,0) — 0 of the symbols carry isDeclaration (asserted at runtime, exit 2 otherwise)",
      exactness:
        "exact for this type: contains is intra-file and (s.file_id = ?) DESC is the first tier of BOTH statements, so every winner is a same-file candidate and the 600-file window holds the whole candidate set",
    },
    arms,
    ambiguousInFileMulti: {
      edges: arms.ambSymInFileMulti,
      candidatesMean: arms.ambSymInFileMulti > 0 ? Number((candidatesTotal / arms.ambSymInFileMulti).toFixed(3)) : 0,
      candidatesMax,
      linePinnedOne,
      linePinnedZero,
      linePinnedMany,
      linePinnedManyWhereStatementsStillAgree: linePinnedManyAgrees,
      statementsDisagree,
      genericLandsOffTheEdgeLine: genericLandsOffLine,
      storeLandsOnTheEdgeLine: storeOnLine,
      genericLandsOnTheEdgeLine: genericOnLine,
      lineTierFixes,
    },
    examples: { statementsDisagree, sampleAmbiguousEdges: sampleEdges },
    targetSpelling: {
      question:
        "the store reduces every emitted target to its leaf before the lookup (extractLeaf, :3377); the lane's instruments resolve the SPELLING as emitted because published registers qualifiedName as a key. These are different questions.",
      perType: spelling,
      totals: spellingTotals,
      examples: [...storeDoesNotUseTheEdgeTarget],
    },
  }

  const sampleId = createHash("sha256").update(files.map((f) => f.label).join("\n")).digest("hex").slice(0, 16)
  recordOut.sampleHash = sampleId

  if (jsonOut) writeFileSync(jsonOut, `${JSON.stringify(recordOut, null, 2)}\n`)

  const p = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
  console.log(`contains target resolution — julia, ${files.length} file(s) of the pinned sample`)
  console.log(`sampleHash ${sampleId}  width ${WIDTH}  symbols ${symbols}  contains edges ${containsEdges} of ${rels.length} total`)
  console.log(`degraded ${degraded.length}   parse failures ${threw.length}   isDeclaration symbols ${isDeclarationSymbols}`)
  if (degraded.length || threw.length) {
    for (const f of [...degraded, ...threw].slice(0, 5)) console.log(`  ${f}`)
  }
  console.log("")
  console.log(p("arm", 24) + p("edges", 9) + "what it is")
  console.log("-".repeat(96))
  console.log(p("uniqueTarget", 24) + p(String(arms.uniqueTarget), 9) + "one published symbol carries the target name")
  console.log(p("ambSymCrossFile", 24) + p(String(arms.ambSymCrossFile), 9) + "ambiguous, referring file declares it 0 times")
  console.log(p("ambSymInFileMulti", 24) + p(String(arms.ambSymInFileMulti), 9) + "ambiguous, referring file declares it >=2 times")
  console.log("-".repeat(96))
  const m = recordOut.ambiguousInFileMulti
  console.log("")
  console.log("within ambSymInFileMulti:")
  console.log(`  candidates per edge      mean ${m.candidatesMean}  max ${m.candidatesMax}`)
  console.log(`  exactly one on edge line ${m.linePinnedOne}`)
  console.log(`  none on edge line        ${m.linePinnedZero}`)
  console.log(`  >1 on edge line          ${m.linePinnedMany} (statements still agree on ${m.linePinnedManyWhereStatementsStillAgree})`)
  console.log(`  the two statements disagree on ${m.statementsDisagree}`)
  console.log(`  store (line rule) lands on the edge's line  ${m.storeLandsOnTheEdgeLine}`)
  console.log(`  generic statement lands on the edge's line ${m.genericLandsOnTheEdgeLine}`)
  console.log(`  line tier fixes ${m.lineTierFixes} of ${m.edges} ambiguous contains edges`)
  if (!FILE_LIMIT) {
    console.log("")
    console.log(`whole pinned sample. The lane doc's "attributed arbitrarily today" counts this arm as arbitrary.`)
    console.log(`Measured: the store's OWN line rule decides ${m.storeLandsOnTheEdgeLine} of ${m.edges}, and the generic`)
    console.log(`statement would have got ${m.genericLandsOnTheEdgeLine} right unaided — so ${m.lineTierFixes} of the doc's`)
    console.log(`arbitrary figure is already resolved in the store, and §8 row 16 cannot move it.`)
  }
  console.log("")
  console.log("emitted spelling vs the leaf the store looks up, per type:")
  console.log(
    p("type", 14) + p("edges", 9) + p("qualified", 10) + p("arm differs", 13) + p("spelled unres", 15) +
      p("leaf unres", 12) + p("leaf amb", 10) + p("spelled-only", 14) + p("leaf-only", 11),
  )
  console.log("-".repeat(120))
  for (const t of TYPES) {
    const s = spelling[t]
    if (s.edges === 0) continue
    console.log(
      p(t, 14) + p(String(s.edges), 9) + p(String(s.qualifiedTarget), 10) + p(String(s.armDiffers), 13) +
        p(String(s.asSpelledUnresolved), 15) + p(String(s.asLeafUnresolved), 12) + p(String(s.asLeafAmbiguous), 10) +
        p(String(s.spelledOnly), 14) + String(s.leafOnly),
    )
  }
  console.log("-".repeat(120))
  console.log(
    `${p("TOTAL", 14)}${p(String(spellingTotals.edges), 9)}${p(String(spellingTotals.qualifiedTarget), 10)}${p(String(spellingTotals.armDiffers), 13)}${p(String(spellingTotals.asSpelledUnresolved), 15)}${p(String(spellingTotals.asLeafUnresolved), 12)}${p(String(spellingTotals.asLeafAmbiguous), 10)}${p(String(spellingTotals.spelledOnly), 14)}${String(spellingTotals.leafOnly)}`,
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
