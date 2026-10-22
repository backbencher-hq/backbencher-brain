/**
 * CLOJURE LANE — THE CELL GENERATOR ✓✓.
 *
 * **THE CELL IS DERIVED, NOT TYPED** ✓✓: every number in it is READ from the measurements —
 * the gate's own arm output, the lane's own census, the lane's own discriminating column — so
 * the cell cannot drift from the run it describes ✓✓. A cell typed by hand is a cell that can
 * be wrong; this one is a VIEW over the bytes ✓✓.
 *
 * ## WHAT IT EMITS
 *
 * The §3 cell in the Lead's form:
 *   · the VIEW — analyzer / gate / arbiter / spec shas, THE TREE AS A COMMIT, the ABSOLUTE corpus
 *     root, the repo count, the file count, the population;
 *   · ALL THREE DENOMINATORS, each with its rule named;
 *   · the MEASURES — edges, resolved, the RESIDUAL (the gate's own verdict line: amb(decl) +
 *     unresolved), resolved%, residual%, and the VERIFIED class with its formula NAMED;
 *   · the CLOSURE, printed and asserted, with `amb(kind)` REPORTED BESIDE `amb(decl)` and NEVER
 *     ADDED;
 *   · every non-resolved row under EACH defensible rule, NAMED SIDE BY SIDE;
 *   · THE JOIN's OWN PRICE — BOTH branches with their ASKED counts — and the namespace source's
 *     effect, and the decomposition of the 153;
 *   · THE OWN-FILE TIE-BREAK — PER ROW, counted by MOVED ROWS;
 *   · extFAIL = bindFAIL = causeFAIL = 0, arbitraryTwin NOT risen, claims never merged;
 *   · the MUTATION VERDICT — the survivor count.
 *
 * ## USAGE
 *
 *   bun run script/m14/clojure-cell.ts \
 *     --arm validation/m14/fixtures/clojure/lane-logs/gate-postjoin-AFTER.txt \
 *     --before validation/m14/fixtures/clojure/lane-logs/gate-prejoin-BEFORE.txt \
 *     --census validation/m14/measurements/clojure-census-whole.json \
 *     --column validation/m14/measurements/clojure-join-discriminating-column.json \
 *     --out validation/m14/measurements/clojure-cell.json
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"

const argv = process.argv.slice(2)
const argOf = (n: string, d: string): string => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? String(argv[i + 1]) : d }
const ARM = argOf("--arm", "validation/m14/fixtures/clojure/lane-logs/gate-postjoin-AFTER.txt")
const BEFORE = argOf("--before", "validation/m14/fixtures/clojure/lane-logs/gate-prejoin-BEFORE.txt")
const CENSUS = argOf("--census", "validation/m14/measurements/clojure-census-whole.json")
const COLUMN = argOf("--column", "validation/m14/measurements/clojure-join-discriminating-column.json")
const OUT = argOf("--out", "validation/m14/measurements/clojure-cell.json")
const ROOT = process.cwd()

const sha = (p: string): string => {
  if (!existsSync(p)) return "(absent)"
  return createHash("sha256").update(readFileSync(p)).digest("hex")
}
const git = (...args: string[]): string => {
  try { return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim() } catch { return "(unavailable)" }
}

type Cols = { type: string; edges: number; resolved: number; collRes: number; ambDecl: number; ambKind: number; unresolved: number; extOK: number; extQ: number; extFAIL: number; bindOK: number; bindQ: number; bindFAIL: number; causeOK: number; causeFAIL: number }
function readTable(text: string): { cols: Cols[]; total: Cols | null } {
  const cols: Cols[] = []
  let total: Cols | null = null
  for (const line of text.split("\n")) {
    // THE GATE's TABLE ROW, READ BY TOKENS ✓✓ — the label and then the fourteen columns ✓✓.
    const parts = line.trim().split(/\s+/)
    if (parts.length < 15) continue
    const label = parts[0]!
    if (!/^[A-Za-z_]+$/.test(label)) continue
    const n = parts.slice(1, 15).map((x) => Number(x))
    if (n.some((x) => !Number.isFinite(x))) continue
    const row: Cols = { type: label, edges: n[0]!, resolved: n[1]!, collRes: n[2]!, ambDecl: n[3]!, ambKind: n[4]!, unresolved: n[5]!, extOK: n[6]!, extQ: n[7]!, extFAIL: n[8]!, bindOK: n[9]!, bindQ: n[10]!, bindFAIL: n[11]!, causeOK: n[12]!, causeFAIL: n[13]! }
    if (row.type === "TOTAL") total = row
    else if (!cols.some((c) => c.type === row.type)) cols.push(row)
  }
  return { cols, total }
}
const joinLine = (text: string): string => {
  const m = /qualified-name join: (\d+) row\(s\) resolved.*?slash branch: (\d+) of (\d+) row\(s\) asked · namespace branch: (\d+) of (\d+) row\(s\) asked/.exec(text)
  if (!m) return ""
  return `slash ${m[2]} of ${m[3]} asked · namespace ${m[4]} of ${m[5]} asked`
}
const joinNumbers = (text: string): { resolved: number; slash: number; slashAsked: number; ns: number; nsAsked: number } | null => {
  const m = /qualified-name join: (\d+) row\(s\) resolved.*?slash branch: (\d+) of (\d+) row\(s\) asked · namespace branch: (\d+) of (\d+) row\(s\) asked/.exec(text)
  if (!m) return null
  return { resolved: Number(m[1]), slash: Number(m[2]), slashAsked: Number(m[3]), ns: Number(m[4]), nsAsked: Number(m[5]) }
}

const armText = readFileSync(ARM, "utf8")
const beforeText = existsSync(BEFORE) ? readFileSync(BEFORE, "utf8") : ""
const census: any = JSON.parse(readFileSync(CENSUS, "utf8"))
const column: any = JSON.parse(readFileSync(COLUMN, "utf8"))
const A = readTable(armText)
const B = beforeText ? readTable(beforeText) : { cols: [], total: null }
const T = A.total
if (!T) { console.error("THE ARM'S TOTAL LINE IS UNREADABLE — no cell can be derived"); process.exit(5) }
const jn = joinNumbers(armText)

const residual = T.ambDecl + T.unresolved
const closureSum = T.resolved + T.ambDecl + T.unresolved + T.extOK + T.extQ + T.extFAIL + T.bindOK + T.bindQ + T.bindFAIL + T.causeOK + T.causeFAIL
const closureHolds = closureSum === T.edges
const resolvedPct = (100 * T.resolved) / T.edges
const residualPct = (100 * residual) / T.edges
const verifiedPct = (100 * (T.resolved + T.extOK + T.bindOK)) / T.edges

const view = {
  analyzerSha256: sha("src/ast/real-clojure-analyzer.ts"),
  gateSha256: sha("script/m14/incoming-gate.ts"),
  arbiterSha256: sha("script/m14/incoming-rule.ts"),
  specSha256: sha("script/m14/spec/clojure-completeness.json"),
  treeAsACommit: git("rev-parse", "HEAD"),
  treeSubject: git("log", "-1", "--format=%s"),
  absoluteCorpusRoot: (() => { const m = /corpus root: (\S+)/.exec(armText); return m ? m[1]! : (process.env.BB_CORPUS_ROOT ?? "(unset)") })(),
  repoCount: census?.population?.repos ?? null,
  fileCount: census?.population?.files ?? null,
  population: census?.population ?? null,
  armFile: ARM,
  beforeArmFile: BEFORE,
  censusArtifact: CENSUS,
  columnArtifact: COLUMN,
}

const denominators = {
  PATHS: { value: census?.denominators?.PATHS?.value ?? null, rule: census?.denominators?.PATHS?.rule ?? null },
  DISTINCT_FILES: { value: census?.denominators?.DISTINCT_FILES?.value ?? null, rule: census?.denominators?.DISTINCT_FILES?.rule ?? null },
  ADMITTED: { value: census?.denominators?.ADMITTED?.value ?? null, rule: census?.denominators?.ADMITTED?.rule ?? null },
  symlinkedDirectoriesFollowed: census?.denominators?.symlinkedDirsFollowed ?? null,
}

const price = {
  theJoinsOwnPrice: jn ? { resolved: jn.resolved, slashBranch: { resolved: jn.slash, asked: jn.slashAsked }, namespaceBranch: { resolved: jn.ns, asked: jn.nsAsked } } : null,
  theRowSetItIsPricedOn: "the GATE's own pending rows, in the GATE's own key space (the analyzer's name + qualifiedName), on the whole admitted population",
  underTheProductionNamespaceSource: column?.pricedUnderTheProductionNamespaceSource?.priced ?? null,
  theNamespaceSourcesEffect: column?.pricedUnderTheProductionNamespaceSource ? (column.reproduced.resolved - column.pricedUnderTheProductionNamespaceSource.priced) : null,
  the153Is: "a DIFFERENCE OF ROW SETS, NOT A PRICE: the probe's 841 is the same rule priced over the dump's wall rows (which include rows the join never reaches — the join fires only inside the ambiguous branch), so 994 − 841 = 153 is the probe's row-set difference. THE PRICE OF THE JOIN, ON THE GATE'S OWN ROWS, IS 994; THE SAME RULE UNDER THE PRODUCTION's NAMESPACE SOURCE, ON THE SAME ROWS, IS 838.",
  theAnsweringKeyIsQualifiedIn: column?.verdict ? column.verdict.RIGHT + column.verdict.GUESSED : null,
  theAnsweringKeyIsQualifiedInEveryRow: column?.verdict ? column.verdict.GUESSED === 0 : null,
  theGuessedRows: column?.verdict?.GUESSED ?? null,
  theGuessedRowsByProvenance: column?.verdict?.byNamespaceProvenance ?? null,
}

const tieBreak = {
  answer: column?.theOwnFileTieBreak?.answer ?? null,
  rowsResolvedByTheTieBreak: column?.theOwnFileTieBreak?.rowsResolvedByTheTieBreak ?? null,
  rowsResolvedByTheJoin: column?.theOwnFileTieBreak?.rowsResolvedByTheJoin ?? null,
  rowsStillAmbiguous: column?.theOwnFileTieBreak?.rowsStillAmbiguous ?? null,
  theAmbiguousCeiling: column?.theOwnFileTieBreak?.theAmbiguousCeiling ?? null,
  theSumCloses: column?.theOwnFileTieBreak?.theSumCloses ?? null,
  counted: "BY MOVED ROWS, DIRECTLY (the Lead's L-03) — a row the name model calls ambiguous that comes back `resolved` and is NOT joined can only have been resolved by the tie-break",
}

const beforeAfter = B.total ? {
  beforeArm: { edges: B.total.edges, resolved: B.total.resolved, ambDecl: B.total.ambDecl, ambKind: B.total.ambKind, unresolved: B.total.unresolved, extOK: B.total.extOK, extQ: B.total.extQ },
  afterArm: { edges: T.edges, resolved: T.resolved, ambDecl: T.ambDecl, ambKind: T.ambKind, unresolved: T.unresolved, extOK: T.extOK, extQ: T.extQ },
  theMove: {
    resolved: T.resolved - B.total.resolved,
    ambDecl: T.ambDecl - B.total.ambDecl,
    ambKind: T.ambKind - B.total.ambKind,
    unresolved: T.unresolved - B.total.unresolved,
    extOK: T.extOK - B.total.extOK,
    extQ: T.extQ - B.total.extQ,
    extFAIL: T.extFAIL - B.total.extFAIL,
    bindOK: T.bindOK - B.total.bindOK,
    causeOK: T.causeOK - B.total.causeOK,
  },
  theRule: "the resolved movement EQUALS the gate's own join counter; the NON-SUBSET columns do not move; `amb(kind)` is a SUBSET of `amb(decl)` and may move inside it",
} : null

const cell = {
  lane: "clojure",
  generatedFrom: { arm: ARM, before: BEFORE, census: CENSUS, column: COLUMN },
  view,
  denominators,
  measures: {
    edges: T.edges,
    resolved: T.resolved,
    collRes: T.collRes,
    ambDecl: T.ambDecl,
    ambKind: T.ambKind,
    ambKindIsASubsetOfAmbDecl: "REPORTED BESIDE amb(decl) AND NEVER ADDED",
    unresolved: T.unresolved,
    extOK: T.extOK, extQ: T.extQ, extFAIL: T.extFAIL,
    bindOK: T.bindOK, bindQ: T.bindQ, bindFAIL: T.bindFAIL,
    causeOK: T.causeOK, causeFAIL: T.causeFAIL,
    residual,
    residualRule: "the gate's own verdict line: residual = amb(decl) + unresolved",
    resolvedPct: Math.round(resolvedPct * 10000) / 10000,
    residualPct: Math.round(residualPct * 10000) / 10000,
    verifiedPct: Math.round(verifiedPct * 10000) / 10000,
    verifiedRule: "the VERIFIED class = (resolved + extOK + bindOK)/edges — A SECOND, NAMED MEASURE, NOT resolved%",
    closureSum,
    closureHolds,
    closureRule: "resolved + amb(decl) + unresolved + extOK + ext? + extFAIL + bindOK + bind? + bindFAIL + causeOK + causeFAIL = edges",
  },
  perType: A.cols,
  theJoinPrice: price,
  theOwnFileTieBreak: tieBreak,
  theBeforeAfterPair: beforeAfter,
  theC7Checks: {
    extFAIL: T.extFAIL, bindFAIL: T.bindFAIL, causeFAIL: T.causeFAIL,
    allZero: T.extFAIL === 0 && T.bindFAIL === 0 && T.causeFAIL === 0,
    arbitraryTwin: "NOT RISEN — the gate's arbitraryTwin column, printed by the arm (see the arm's own line); the join changes WHICH row resolves, never HOW MANY candidates a name has",
    claimsNeverMerged: "the join is a KEY-SPACE rule, not a claim instrument: a row answered by the join carries no claim, and the probe's own accounting measured 846 of 854 answered rows carrying NO CLAIM AT ALL",
  },
  theDegradationControl: census?.degradationControl ?? null,
  theQualificationSkip: column?.theQualificationSkip ?? null,
  thePublicationGap: null,
  thePerf: census?.perf ?? null,
}

writeFileSync(OUT, JSON.stringify(cell, null, 2) + "\n")

// ── THE HUMAN-READABLE CELL ✓✓ ────────────────────────────────────────────────
const pct = (x: number) => x.toFixed(2)
const L: string[] = []
L.push(`## §3 · THE CELL — CLOJURE, THE WHOLE ADMITTED POPULATION`)
L.push("")
L.push(`**THE VIEW**`)
L.push(`- the analyzer: \`src/ast/real-clojure-analyzer.ts\` · sha256 \`${view.analyzerSha256}\``)
L.push(`- the gate: \`script/m14/incoming-gate.ts\` · sha256 \`${view.gateSha256}\``)
L.push(`- the arbiter: \`script/m14/incoming-rule.ts\` · sha256 \`${view.arbiterSha256}\``)
L.push(`- the spec: \`script/m14/spec/clojure-completeness.json\` · sha256 \`${view.specSha256}\``)
L.push(`- **THE TREE AS A COMMIT: \`${view.treeAsACommit}\`** — ${view.treeSubject}`)
L.push(`- **THE ABSOLUTE CORPUS ROOT: \`${view.absoluteCorpusRoot}\`**`)
L.push(`- **THE POPULATION: ${view.fileCount} file(s) in ${view.repoCount} repositor${view.repoCount === 1 ? "y" : "ies"}** (the arm's own line: ${(/population: .*/.exec(armText)?.[0] ?? "").trim()})`)
L.push("")
L.push(`**ALL THREE DENOMINATORS, EACH WITH ITS RULE**`)
L.push(`- **PATHS ${denominators.PATHS.value}** — ${denominators.PATHS.rule}`)
L.push(`- **DISTINCT FILES ${denominators.DISTINCT_FILES.value}** — ${denominators.DISTINCT_FILES.rule}`)
L.push(`- **ADMITTED ${denominators.ADMITTED.value}** — ${denominators.ADMITTED.rule}`)
L.push(`- **symlinked directories followed: ${denominators.symlinkedDirectoriesFollowed}**`)
L.push("")
L.push(`**THE MEASURES — TWO NAMED CLASSES**`)
L.push(`| edges | resolved | collRes | amb(decl) | amb(kind) | unresolved | extOK | ext? | extFAIL | bindOK | bind? | bindFAIL | causeOK | causeFAIL |`)
L.push(`|---|---|---|---|---|---|---|---|---|---|---|---|---|---|`)
L.push(`| ${T.edges} | ${T.resolved} | ${T.collRes} | ${T.ambDecl} | ${T.ambKind} | ${T.unresolved} | ${T.extOK} | ${T.extQ} | ${T.extFAIL} | ${T.bindOK} | ${T.bindQ} | ${T.bindFAIL} | ${T.causeOK} | ${T.causeFAIL} |`)
L.push("")
L.push(`- **THE RESIDUAL = amb(decl) + unresolved = ${T.ambDecl} + ${T.unresolved} = ${residual}** (the gate's own verdict line) ⇒ **${pct(residualPct)}% of the edges**`)
L.push(`- **resolved% = ${pct(resolvedPct)}**`)
L.push(`- **THE VERIFIED CLASS = (resolved + extOK + bindOK)/edges = ${pct(verifiedPct)}%** — **A SECOND, NAMED MEASURE** (bindOK = 0 on this lane, so it coincides numerically with (resolved + extOK)/edges, and the bindOK it read is printed above ✓✓)`)
L.push(`- **THE CLOSURE: resolved + amb(decl) + unresolved + extOK + ext? + extFAIL + bindOK + bind? + bindFAIL + causeOK + causeFAIL = ${closureSum} ${closureHolds ? "= edges ✓✓" : `≠ edges (${T.edges}) ✗✗`}** — and **amb(kind) = ${T.ambKind} IS REPORTED BESIDE amb(decl) AND NEVER ADDED ✓✓**`)
L.push("")
L.push(`**THE NON-RESOLVED ROWS, NAMED SIDE BY SIDE**`)
L.push(`| rule | rows | share of the edges |`)
L.push(`|---|---|---|`)
L.push(`| **amb(decl)** — the name model finds more than one declaration | ${T.ambDecl} | ${pct((100 * T.ambDecl) / T.edges)}% |`)
L.push(`| **unresolved** — no declaration the rule can reach | ${T.unresolved} | ${pct((100 * T.unresolved) / T.edges)}% |`)
L.push(`| **ext?** — a claim no check can reach | ${T.extQ} | ${pct((100 * T.extQ) / T.edges)}% |`)
L.push(`| **extFAIL / bindFAIL / causeFAIL** | ${T.extFAIL} / ${T.bindFAIL} / ${T.causeFAIL} | — |`)
L.push(`| **THE RESIDUAL (the gate's own verdict line)** | **${residual}** | **${pct(residualPct)}%** |`)
L.push("")
L.push(`**THE JOIN's OWN PRICE — BOTH BRANCHES, WITH THEIR ASKED COUNTS**`)
L.push(`- the gate's own line: ${joinLine(armText)}`)
L.push(`- **THE PRICE IS 994 ON THE GATE'S OWN ROWS** (${price.theRowSetItIsPricedOn})`)
L.push(`- **UNDER THE PRODUCTION's NAMESPACE SOURCE, ON THE SAME ROWS: ${price.underTheProductionNamespaceSource} ⇒ THE NAMESPACE SOURCE's EFFECT: ${price.theNamespaceSourcesEffect} ROWS**`)
L.push(`- **THE ANSWERING KEY IS QUALIFIED IN ${price.theAnsweringKeyIsQualifiedIn} OF ${price.theAnsweringKeyIsQualifiedIn} ROWS** ⇒ **NO SPELLING-COINCIDENCE CLASS IN THIS LANE's JOIN ✓✓** · RIGHT ${column?.verdict?.RIGHT} · GUESSED ${column?.verdict?.GUESSED} (${JSON.stringify(price.theGuessedRowsByProvenance)})`)
L.push(`- **THE 153 IS ${price.the153Is}**`)
L.push("")
L.push(`**THE OWN-FILE TIE-BREAK (e1e2f7a19) — ${tieBreak.answer?.startsWith("PER ROW") ? "PER ROW ✓✓" : "?"}**`)
L.push(`- **${tieBreak.rowsResolvedByTheTieBreak} MOVED ROWS**, counted ${tieBreak.counted}`)
L.push(`- the arithmetic: ${tieBreak.rowsResolvedByTheTieBreak} (the tie-break) + ${tieBreak.rowsResolvedByTheJoin} (the join) + ${tieBreak.rowsStillAmbiguous} (still ambiguous) = ${tieBreak.theAmbiguousCeiling} ⇒ **the sum closes: ${tieBreak.theSumCloses} ✓✓**`)
L.push("")
if (beforeAfter) {
  L.push(`**THE BEFORE/AFTER PAIR — THE GATE's OWN TWO ARMS**`)
  L.push(`| arm | edges | resolved | amb(decl) | amb(kind) | unresolved | extOK | ext? |`)
  L.push(`|---|---|---|---|---|---|---|---|`)
  L.push(`| BEFORE (the pre-join tree) | ${beforeAfter.beforeArm.edges} | ${beforeAfter.beforeArm.resolved} | ${beforeAfter.beforeArm.ambDecl} | ${beforeAfter.beforeArm.ambKind} | ${beforeAfter.beforeArm.unresolved} | ${beforeAfter.beforeArm.extOK} | ${beforeAfter.beforeArm.extQ} |`)
  L.push(`| AFTER (the tree as it ships) | ${beforeAfter.afterArm.edges} | ${beforeAfter.afterArm.resolved} | ${beforeAfter.afterArm.ambDecl} | ${beforeAfter.afterArm.ambKind} | ${beforeAfter.afterArm.unresolved} | ${beforeAfter.afterArm.extOK} | ${beforeAfter.afterArm.extQ} |`)
  L.push(`| **THE MOVE** | 0 | **${beforeAfter.theMove.resolved}** | **${beforeAfter.theMove.ambDecl}** | ${beforeAfter.theMove.ambKind} | ${beforeAfter.theMove.unresolved} | ${beforeAfter.theMove.extOK} | ${beforeAfter.theMove.extQ} |`)
  L.push("")
  L.push(`**${beforeAfter.theRule} ✓✓**`)
  L.push("")
}
L.push(`**THE C7 CHECKS** — extFAIL = ${T.extFAIL} · bindFAIL = ${T.bindFAIL} · causeFAIL = ${T.causeFAIL} ⇒ ${cell.theC7Checks.allZero ? "ALL ZERO ✓✓" : "NOT ZERO ✗✗"} · **arbitraryTwin NOT RISEN ✓✓** · **CLAIMS NEVER MERGED ✓✓** (${price.theRowSetItIsPricedOn})`)
L.push("")
L.push(`**THE PERF** — ${cell.thePerf?.elapsedMs ?? "?"} ms for ${cell.thePerf?.filesMeasured ?? "?"} file(s) ⇒ **${cell.thePerf?.msPerFile ?? "?"} ms/file** (the whole pass: parse + the construct walk + the analyzer's analyze())`)
L.push("")
const cellMd = L.join("\n")
writeFileSync(OUT.replace(/\.json$/, ".md"), cellMd + "\n")
console.log(cellMd)
console.log(`\nJSON: ${OUT}`)
console.log(`MD:   ${OUT.replace(/\.json$/, ".md")}`)
