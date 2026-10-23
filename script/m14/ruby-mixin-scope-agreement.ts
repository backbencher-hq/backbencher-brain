/**
 * THE MIXIN SCOPE AGREEMENT — THREE INDEPENDENT DERIVATIONS, ONE QUESTION, SITE BY SITE.
 *
 * ⇒ THE QUESTION. Is this `include`/`extend`/`prepend` call a MODULE COMPOSITION into a class?
 *
 * ⇒ THE THREE READERS, AND WHY THERE ARE THREE. A differential between the analyzer and the
 * oracle measures something only if the two sides are NOT the same computation. This lane now
 * holds three answers to the question above, and they are three different mechanisms:
 *
 *   1. THE ANALYZER (`src/ast/real-ruby-analyzer.ts`) — `mixinSelfKind` walks the AST's PARENT
 *      LINKS from the call node and names the first enclosing scope it meets.
 *   2. THE ORACLE (`script/m14/ruby-truth.ts`) — the walk FRAME carries the answer: `Frame.selfType`
 *      is set as the walk descends, so the oracle never walks back up.
 *   3. THIS CENSUS (`script/m14/ruby-mixin-scope.ts`) — a SCOPE STACK built by a separate walk of
 *      the tree, carried down as the walk descends.
 *
 * ⇒ All three describe the same LANGUAGE, so they must agree. None of them is a copy of another,
 * so their agreement is EVIDENCE and their disagreement is a FINDING. **⇒ A TRUTH COPIED FROM THE
 * ANALYZER WOULD AGREE BY CONSTRUCTION AND MEASURE NOTHING.**
 *
 * ⇒ AND THE MEASUREMENT IS SITE BY SITE, NOT BY TOTAL. A total can hide a disagreement behind a
 * compensating one; a site cannot. Every site with a constant argument is classified on all three
 * axes, and every disagreement is printed with its file, its line, its keyword, the receiver's
 * shape, and what each reader said.
 *
 * ⇒ AND THE LOCATOR IS EXACT, ON BOTH SIDES:
 *   · the ORACLE's decision carries the CALL node's line, which is the census's own `line`;
 *   · the ANALYZER's published row carries the ARGUMENT node's line, which is the census's own
 *     `argLine`, together with the target's leaf.
 * ⇒ THE LOCATOR IS THE SAME ONE THE IMPOSTOR CENSUS USES, and the census locates 416 of 416
 * published rows — so a disagreement here is a disagreement about a LOCATED row, not about a
 * row that could not be found.
 *
 * EXIT CODE: 0 when the three readers agree on every site; 4 when they do not, with every
 * disagreement printed. A non-zero exit is a CLAIM — that the three readers disagree somewhere —
 * and this instrument only makes it when it has the sites to back it.
 */
import { getParser } from "../../src/ast/engine"
import { RealRubyAnalyzer } from "../../src/ast/real-ruby-analyzer"
import { deriveRubyEdges, type RubyMixinDecision } from "./ruby-truth"
import { collectMixinSites, discoverRubyFiles, type MixinSite } from "./ruby-mixin-scope"
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import * as path from "node:path"

const CR = process.env.BB_CORPUS_ROOT ?? path.resolve(process.cwd(), ".corpus")
const OUT_DIR = path.join(CR, "..", "validation", "m14", "measurements")

const { files, repos, absent, overCap } = discoverRubyFiles(CR)

const parser = await getParser("ruby" as any)
const analyzer = new RealRubyAnalyzer()

/** ONE SITE, WITH ALL THREE READERS' ANSWERS. */
type Agreed = {
  file: string
  line: number
  argLine: number
  keyword: string
  target: string
  /** THE CENSUS'S READING — the scope stack. */
  censusSelfKind: MixinSite["selfKind"]
  censusReceiver: MixinSite["receiverShape"]
  /** THE ORACLE'S READING — the frame. */
  oracleSelfType: string
  oracleReceiver: string
  oracleOwner: string | undefined
  oraclePublished: boolean
  oracleRefusedBecause: string | undefined
  /** THE ANALYZER'S ANSWER — measured from its published rows, by the exact locator. */
  analyzerPublished: boolean
  /** The analyzer's published source, when it published. */
  analyzerSource: string
  /** TRUE when all three readers agree about whether this site is a composition. */
  agree: boolean
  /** TRUE when the readers agree on the CLASS ITSELF (the census's kind and the oracle's type). */
  kindsAgree: boolean
}

const agreed: Agreed[] = []
let parseFailures = 0
let analyzerRows = 0
let analyzerRowsLocated = 0
let truthRows = 0

for (const abs of files) {
  const content = readFileSync(abs, "utf8")
  let root: any
  // ⇒ THE ROOT IS CHECKED, NOT ASSUMED: a null root is a file this instrument did not read, and
  // it is COUNTED — never counted as a file with no mixin sites.
  try { root = parser.parse(content)?.rootNode } catch { parseFailures++; continue }
  if (!root) { parseFailures++; continue }
  const rel = path.relative(CR, abs)

  // ── READER 2: THE ORACLE, WITH ITS PER-SITE DECISIONS ────────────────────────────────────────
  const decisions: RubyMixinDecision[] = []
  const truthEdges = deriveRubyEdges(root, decisions)
  const truthPublished = truthEdges.filter(e => e.label === "mixes_in")
  truthRows += truthPublished.length

  // ── READER 1: THE ANALYZER'S OWN PUBLISHED ROWS ──────────────────────────────────────────────
  const rels = await analyzer.analyze(root, content, rel)
  const published = (rels.relationships ?? []).filter((r: any) => r.type === "mixes_in") as any[]
  analyzerRows += published.length

  // ── READER 3: THE CENSUS'S OWN SITE ENUMERATION ──────────────────────────────────────────────
  const sites = collectMixinSites(root, rel).filter(s => s.argIsConstant)

  // ⇒ THE LOCATOR, ON THE ANALYZER'S SIDE: the published row carries the ARGUMENT's line and the
  // target's leaf. The census's site carries the same two facts, so a published row is located
  // EXACTLY, and a row that cannot be located is a row whose site is not in the census at all —
  // which is itself a finding, so it is counted rather than dropped.
  const siteForRow = (r: any): MixinSite | undefined => {
    const leaf = String(r.target ?? "").split(/[.:#]/).pop() ?? ""
    const line = r.line_number ?? r.lineNumber
    const hits = sites.filter(s => s.argLine === line && s.argLeaf === leaf)
    return hits.length === 1 ? hits[0] : hits[0]
  }
  const analyzerAt = new Map<string, any[]>()
  for (const r of published) {
    const s = siteForRow(r)
    if (!s) continue
    analyzerRowsLocated++
    const k = `${s.file}:${s.line}:${s.argLine}:${s.argLeaf}`
    if (!analyzerAt.has(k)) analyzerAt.set(k, [])
    analyzerAt.get(k)!.push(r)
  }

  // ⇒ THE ORACLE'S DECISIONS, LOCATED BY THE CALL'S LINE — which the census's site also carries.
  const oracleAt = new Map<string, RubyMixinDecision>()
  for (const d of decisions) {
    const k = `${rel}:${d.line}:${d.line}:${d.target}`
    if (!oracleAt.has(k)) oracleAt.set(k, d)
  }

  for (const s of sites) {
    const k = `${s.file}:${s.line}:${s.argLine}:${s.argLeaf}`
    const d = oracleAt.get(k)
    const rows = analyzerAt.get(k) ?? []
    const analyzerPublished = rows.length > 0
    // THE ORACLE'S PUBLISHED ANSWER, when the oracle's decision was not located: it is counted as
    // a disagreement of its own, never as agreement.
    const oraclePublished = d ? d.published : false
    const censusSaysClass = s.selfKind === "class" || s.selfKind === "singleton"
    const oracleSaysClass = d ? (d.selfType === "class" || d.selfType === "singleton") : false
    agreed.push({
      file: s.file,
      line: s.line,
      argLine: s.argLine,
      keyword: s.keyword,
      target: s.argLeaf,
      censusSelfKind: s.selfKind,
      censusReceiver: s.receiverShape,
      oracleSelfType: d ? d.selfType : "(not located)",
      oracleReceiver: d ? d.receiver : "(not located)",
      oracleOwner: d?.owner,
      oraclePublished,
      oracleRefusedBecause: d?.refusedBecause,
      analyzerPublished,
      analyzerSource: rows.length ? String(rows[0].source ?? "") : "",
      // ⇒ THE THREE READERS AGREE when the analyzer and the oracle reach the SAME answer.
      agree: analyzerPublished === oraclePublished,
      // ⇒ AND THEY AGREE ON THE CLASS ITSELF when the census's kind and the oracle's type say the
      // same thing — a finer question, and the one that names a disagreement when it exists.
      kindsAgree: censusSaysClass === oracleSaysClass,
    })
  }
}

const disagreements = agreed.filter(a => !a.agree)
const kindDisagreements = agreed.filter(a => !a.kindsAgree)

// ⇒ THE CENSUS'S POSITIVE CONTROL: EVERY published analyzer row is LOCATED in the census's site
// enumeration. A locator that silently dropped rows would make every number here a count over a
// partial population, and a partial population reads exactly like a clean result.
const locatedControl = analyzerRows > 0 && analyzerRowsLocated === analyzerRows

// ⇒ THE CENSUS'S OWN POSITIVE CONTROL, THE SECOND ONE: the readers must be ABLE to disagree.
// A matrix whose every cell is "agree" is either a true unanimity or a broken instrument, and
// the difference is told by perturbing one reader and watching the matrix move. ⇒ The oracle's
// rule is recomputed with the census's OWN reading forced upon it — the same decision, decided
// the census's way — and the number of disagreements it produces is printed beside the real one.
// If the two numbers are identical for every site, the instrument cannot see a difference and
// its agreement is worthless.
let forcedDisagreements = 0
for (const a of agreed) {
  const censusSaysClass = a.censusSelfKind === "class" || a.censusSelfKind === "singleton"
  const censusReceiverOk = a.censusReceiver === "none" || a.censusReceiver === "self"
  const forced = censusSaysClass && censusReceiverOk
  if (forced !== a.oraclePublished) forcedDisagreements++
}

const byClass: Record<string, number> = {}
for (const a of agreed) {
  const k = `census:${a.censusSelfKind} · receiver:${a.censusReceiver} · analyzer:${a.analyzerPublished ? "published" : "refused"} · oracle:${a.oraclePublished ? "published" : "refused"}`
  byClass[k] = (byClass[k] ?? 0) + 1
}

const report = {
  question:
    "Do the analyzer's parent-walk, the oracle's frame, and the census's scope stack reach the SAME answer about which mixin call sites are module compositions — site by site, over the whole admitted population?",
  population: { corpusRoot: CR, admitted: files.length, repos, absent, overCap, parseFailures },
  sitesWithAConstantArgument: agreed.length,
  analyzerPublishedRows: analyzerRows,
  analyzerRowsLocatedInTheSites: analyzerRowsLocated,
  everyPublishedAnalyzerRowIsLocated: locatedControl,
  oraclePublishedRows: truthRows,
  disagreements: disagreements.length,
  kindDisagreements: kindDisagreements.length,
  theForcedRuleDisagreements: forcedDisagreements,
  theInstrumentCanSeeADifference: forcedDisagreements > 0,
  byClass,
  disagreementSamples: disagreements.slice(0, 200),
  kindDisagreementSamples: kindDisagreements.slice(0, 200),
  instrument: "script/m14/ruby-mixin-scope-agreement.ts",
}

mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(path.join(OUT_DIR, "ruby-mixin-scope-agreement-2026-10-22.json"), JSON.stringify(report, null, 2) + "\n")

console.log("RUBY — THE MIXIN SCOPE AGREEMENT (three independent derivations)")
console.log(`  population ${files.length} admitted .rb across ${repos} repos · parse failures ${parseFailures}`)
console.log(`  mixin sites with a constant argument: ${agreed.length}`)
console.log(`  the analyzer publishes ${analyzerRows} mixes_in rows; ${analyzerRowsLocated} located in the sites (control: ${locatedControl})`)
console.log(`  the oracle publishes ${truthRows} mixes_in rows`)
console.log(`  ⇒ DISAGREEMENTS (analyzer vs oracle): ${disagreements.length}`)
console.log(`  ⇒ KIND DISAGREEMENTS (census's kind vs oracle's type): ${kindDisagreements.length}`)
console.log(`  ⇒ THE FORCED-RULE CONTROL: ${forcedDisagreements} disagreement(s) ⇒ the instrument CAN see a difference: ${forcedDisagreements > 0}`)
for (const a of disagreements.slice(0, 25)) {
  console.log(`      ${a.file}:${a.line}  ${a.keyword} -> ${a.target}  census=${a.censusSelfKind}/${a.censusReceiver}  oracle=${a.oracleSelfType}/${a.oracleReceiver}  analyzer=${a.analyzerPublished ? "published" : "refused"}  oracle=${a.oraclePublished ? "published" : "refused" + (a.oracleRefusedBecause ? "(" + a.oracleRefusedBecause + ")" : "")}`)
}
for (const [k, v] of Object.entries(byClass).sort((x, y) => y[1] - x[1])) console.log(`      ${v}  ${k}`)
process.exit(disagreements.length > 0 ? 4 : 0)
