/**
 * CSS CONSTRUCT + CHAIN-EDGE CENSUS — the whole-corpus instrument behind this lane's two
 * remaining verdicts: which of the seven silent relationship types the CORPUS can express
 * at all, and whether the selector-chain emission gate resolves the names it claims to.
 *
 * ## Why one file answers both
 *
 * Each question needs the same expensive thing — every admitted `.css` file parsed with the
 * production grammar and run through the production analyzer — so they share ONE walk. This
 * machine is an 8-core laptop shared by every lane; two walks for two questions is a cost
 * the second question does not justify.
 *
 * ## Question 1 — the seven silent types
 *
 * `bun script/m14/firing-check.mjs CSS_B` reads 7 SILENT types on the pico corpus, and a
 * sample can never certify that a type is ABSENT. So each construct that could express one
 * is counted on the whole admitted population, on the TREE (never in the text: a `@extend`
 * in a comment is not an `@extend`), and beside it the analyzer's own emitted edges are
 * counted so "the construct exists but nothing is emitted" is distinguishable from "the
 * construct does not exist".
 *
 * ## Question 2 — the chain gate's sub-tests
 *
 * `real-css-analyzer.ts` emits a `contains` edge for a selector chain only when both chain
 * leaves resolve (`RULING (2026-09-26)`: "emitted only for the chains where both leaves ARE
 * published symbols"). Its `resolves()` accepts an end if the exact name is published, OR
 * the dotted LEAF is, OR any `:`/`.` boundary TAIL is — and MEASURED, that last pair lets a
 * CLASS term `.button` be satisfied by a published TYPE-selector rule `button`
 * (`validation/m14/fixtures/css/single-file-dump.ts`, semantic.min.css: `names.has(".button")
 * = false`, `names.has("button") = true`, and the file emits `contains ".button" -> ".button"`).
 *
 * This census measures how much of the emitted chain population rests on which sub-test, and
 * how many of those matches are KIND-INCONSISTENT — the term's own spelling says class/id/
 * pseudo and the published name that satisfied it is a bare type selector. That number is the
 * cost/benefit of tightening the gate, measured before any change is made to it.
 *
 * The re-derivation of `resolves()` here is a DIAGNOSTIC, not a second decision: it is run
 * against the edges the analyzer ACTUALLY emitted, and every emitted edge for which the
 * re-derivation finds no satisfying sub-test is printed as a DIVERGENCE. A divergence count
 * that is not 0 means the copy has drifted from the analyzer and this census says so instead
 * of quietly explaining the analyzer with a rule it does not implement.
 *
 * ## Question 3 — the node vocabulary
 *
 * The candidate productions for the types that need a NODE (a call, a supertype clause, a
 * constructor) are checked against the distinct node types the corpus's parse trees actually
 * contain. Instrument A cannot see a construct the grammar routes through `at_rule` — that is
 * what the tree counts above are for — but it settles the `implements`/`instantiates` rows.
 *
 * ## The positive control, and why it is IN THIS FILE
 *
 * Neither a corpus zero nor a corpus one is evidence unless the probe can see the construct.
 * `CONTROL` below is a stylesheet carrying one of every construct this census rules on, and
 * it is parsed through the SAME `getParser("css")` the walk uses. Each control count must be
 * ≥ 1 or the census exits 3 and prints nothing else — the same discipline the incoming gate's
 * own positive control applies. It is in-line rather than a `.css` fixture because the fixture
 * runner requires an `.expectation.json` beside every `.css` in the lane directory, and an
 * expectation authored to make a census probe pass is a fixture that pins nothing.
 *
 * Usage:
 *   npx tsx validation/m14/fixtures/css/construct-and-chain-census.ts [--json]
 *   BB_CSS_CENSUS_LIMIT=200 npx tsx … # bounded draw, for a loaded machine
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..")
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SIZE_CAP = 1024 * 1024

const { getParser } = await import(`${ROOT}/src/ast/engine.ts`)
const analyzerMod: any = await import(`${ROOT}/src/ast/real-css-analyzer.ts`)
const Analyzer = Object.values(analyzerMod).find((v: any) => typeof v === "function" && /Analyzer$/.test(v.name)) as any
if (!Analyzer) {
  console.error("FATAL: no analyzer class exported from real-css-analyzer.ts")
  process.exit(2)
}

const argv = process.argv.slice(2)
const JSON_OUT = argv.includes("--json")
const LIMIT = Number(process.env.BB_CSS_CENSUS_LIMIT ?? 0)

// ------------------------------------------------------------------ population (the gate's rule)

function discover(ext: string, limit: number): { files: string[]; total: number; repos: number; overCap: number; absent: number } {
  const found: string[] = []
  const repos = new Set<string>()
  let overCap = 0
  let absent = 0
  let entries: string[]
  try {
    entries = readdirSync(CR)
  } catch {
    return { files: [], total: 0, repos: 0, overCap: 0, absent: 0 }
  }
  for (const name of entries.sort()) {
    const dir = path.join(CR, name)
    try { if (!statSync(dir).isDirectory()) continue } catch { continue }
    try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
    let tracked: string[]
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
    } catch { continue }
    for (const rel of tracked) {
      if (!rel.toLowerCase().endsWith(`.${ext.toLowerCase()}`)) continue
      const abs = path.join(dir, rel)
      try { if (statSync(abs).size > SIZE_CAP) { overCap++; continue } } catch { absent++; continue }
      found.push(abs)
      repos.add(name)
    }
  }
  found.sort()
  const total = found.length
  if (limit > 0 && total > limit) {
    const stride = Math.max(1, Math.floor(total / limit))
    const picked: string[] = []
    for (let i = 0; i < found.length && picked.length < limit; i += stride) picked.push(found[i])
    return { files: picked, total, repos: repos.size, overCap, absent }
  }
  return { files: found, total, repos: repos.size, overCap, absent }
}

// ------------------------------------------------------------------ tree helpers (node API only)

const kids = (n: any): any[] => {
  const out: any[] = []
  for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) out.push(c) }
  return out
}
const walk = (n: any, fn: (x: any) => void): void => {
  const stack = [n]
  while (stack.length > 0) {
    const x = stack.pop()
    fn(x)
    const cs = kids(x)
    for (let i = cs.length - 1; i >= 0; i--) stack.push(cs[i])
  }
}
/** Every child, named or ANONYMOUS. The `@media`/`@keyframes`/`@import` keyword tokens are
 *  not named children, so `kids()` cannot see them and a counter built on `kids()` alone
 *  reported `@keyframes 0` corpus-wide while the analyzer was publishing 2,667 keyframe
 *  `uses` edges. `@media (min-width: 1px)` measures as `media_statement` with children
 *  `["@media"(anon), feature_query, block]` — MEASURED with this grammar, not assumed. */
const allKids = (n: any): any[] => {
  const out: any[] = []
  for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) out.push(c) }
  return out
}
/** The at-keyword of an at-rule, however the grammar spelled it: a `at_keyword` node, or
 *  the anonymous `@…` token a dedicated statement production carries. */
const atKeywordOf = (n: any): string => {
  const cs = allKids(n)
  const kw = cs.find((c: any) => c.type === "at_keyword")
  if (kw) return String(kw.text).trim().toLowerCase()
  const anon = cs.find((c: any) => c.type.length > 1 && c.type.charCodeAt(0) === 64)
  return anon ? String(anon.text).trim().toLowerCase() : ""
}
/** Does this node carry an at-keyword at all? Keeps the per-node cost off the 341,686
 *  `call_expression` nodes, which cannot. */
const isAtStatement = (type: string): boolean =>
  type === "at_rule" || type === "postcss_statement" || type.endsWith("_statement")
const unquote = (s: string): string => {
  const t = s.trim()
  if (t.length >= 2) { const a = t.charAt(0), b = t.charAt(t.length - 1); if ((a === '"' || a === "'") && a === b) return t.slice(1, -1) }
  return t
}

/** The analyzer's `stripOccurrenceSuffix` — a trailing `:<digits>` is dropped. Diagnostic only. */
const stripOccurrenceSuffix = (name: string): string => {
  let i = name.length
  while (i > 0) { const c = name.charAt(i - 1); if (c < "0" || c > "9") break; i-- }
  if (i === name.length) return name
  if (i === 0 || name.charAt(i - 1) !== ":") return name
  return name.slice(0, i - 1)
}
/** The analyzer's `leafOf`. Diagnostic only. */
const leafOf = (n: string): string => {
  const segs = stripOccurrenceSuffix(n).split(":").filter((x) => x.length > 0)
  const last = segs[segs.length - 1] ?? ""
  const dots = last.split(".")
  return dots[dots.length - 1]
}
/** The KIND a selector spelling declares: class `.x`, id `#x`, pseudo `:x`, universal `*`, else type. */
const kindClass = (s: string): string => {
  if (s.length === 0) return "empty"
  const c = s.charAt(0)
  if (c === ".") return "class"
  if (c === "#") return "id"
  if (c === ":") return "pseudo"
  if (c === "*") return "universal"
  if (s.indexOf(",") !== -1) return "group"
  if (s.indexOf(" ") !== -1) return "compound"
  return "type"
}

// ------------------------------------------------------------------ the positive control

const CONTROL = `
@import "control-import.css";
@import url("control-url.css") screen;
@function --double(--v) { result: calc(var(--v) * 2); }
:export { control-name: control-value; }
.control-a { composes: control-b; composes: control-c from "./control-other.css"; color: red; }
.control-b { color: blue; }
@extend .control-b;
@property --control-registered { syntax: "<color>"; inherits: false; initial-value: red; }
@keyframes control-spin { from { opacity: 0 } to { opacity: 1 } }
@keyframes control-spin { from { opacity: 1 } to { opacity: 0 } }
.control-d { --control-var: 1px; }
.control-e { width: var(--control-var); }
`

type Counts = Record<string, number>

function countConstructs(root: any, c: Counts): void {
  walk(root, (n) => {
    if (n.type === "import_statement") c.importStatements++
    // THE AT-KEYWORD IS READ ON EVERY NODE THAT HAS ONE, not only on `at_rule`.
    //
    // The first version of this counter read `at_keyword` only inside
    // `at_rule`/`postcss_statement`, and reported `@keyframes at_rules 0` across the whole
    // corpus while the analyzer was emitting 2,667 `uses` edges to keyframes it had
    // published — a contradiction, and the counter was the wrong one. The grammar has a
    // DEDICATED `keyframes_statement` production (it is in this lane's own
    // `handled_verified.types`), so the construct never arrives as `at_rule`. Reading the
    // keyword wherever it appears is what makes the number a fact about the corpus instead
    // of a fact about which node type this file happened to guess.
    const kw = isAtStatement(n.type) ? atKeywordOf(n) : ""
    if (kw.length > 0) {
      c.atKeywords.set(kw, (c.atKeywords.get(kw) ?? 0) + 1)
      if (kw === "@extend") c.extendAtRules++
      if (kw === "@function") c.functionAtRules++
      if (kw === "@property") c.propertyAtRules++
      if (kw === "@keyframes") c.keyframesAtRules++
    }
    if (n.type === "declaration") {
      const prop = kids(n).find((x: any) => x.type === "property_name")
      if (prop && String(prop.text).trim() === "composes") {
        c.composesDeclarations++
        const vals = kids(n).filter((x: any) => x.type !== "property_name")
        const sawFrom = vals.some((v: any) => String(v.text).trim().toLowerCase() === "from")
        if (sawFrom) c.composesFromDeclarations++
      }
    }
    if (n.type === "rule_set") {
      const sel = kids(n).find((x: any) => x.type === "selectors")
      const t = sel ? String(sel.text).trim() : ""
      if (t === ":export" || t === ":exports") c.exportBlocks++
    }
    if (n.type === "call_expression") {
      c.callExpressions++
      const fn = kids(n).find((x: any) => x.type === "function_name")
      if (fn) c.callFunctionNames.add(String(fn.text).trim())
    }
    if (n.type === "ERROR") c.errorNodes++
    c.nodeTypes.add(n.type)
  })
}

function newCounts(): Counts & { callFunctionNames: Set<string>; nodeTypes: Set<string>; atKeywords: Map<string, number> } {
  return {
    importStatements: 0, extendAtRules: 0, functionAtRules: 0, propertyAtRules: 0,
    keyframesAtRules: 0, composesDeclarations: 0, composesFromDeclarations: 0, exportBlocks: 0,
    callExpressions: 0, errorNodes: 0, callFunctionNames: new Set<string>(), nodeTypes: new Set<string>(),
    atKeywords: new Map<string, number>(),
  } as any
}

const parser = await getParser("css")

// THE CONTROL RUNS FIRST, ALWAYS. An instrument that cannot see a planted construct must
// not be allowed to report that the corpus lacks it.
const controlCounts = newCounts()
{
  const pr = await parser.parse(CONTROL, "control.css")
  countConstructs(pr.rootNode, controlCounts)
}
const controlFired: Record<string, number> = {
  "import_statement": controlCounts.importStatements,
  "@extend at_rule": controlCounts.extendAtRules,
  "@function at_rule": controlCounts.functionAtRules,
  "@property at_rule": controlCounts.propertyAtRules,
  // THE CONTROL THAT WOULD HAVE CAUGHT THE DEFECT ABOVE, added with the fix: the control
  // stylesheet carries two `@keyframes` blocks, so a counter that cannot see them must fail
  // here rather than report a corpus zero that reads like an absence.
  "@keyframes statement": controlCounts.keyframesAtRules,
  ":export rule_set": controlCounts.exportBlocks,
  "composes declaration": controlCounts.composesDeclarations,
  "composes … from … declaration": controlCounts.composesFromDeclarations,
  "call_expression": controlCounts.callExpressions,
}
const controlFailures = Object.entries(controlFired).filter(([, n]) => n < 1)
if (controlFailures.length > 0) {
  console.error("FATAL: this census's own positive control did not fire.")
  for (const [k, n] of controlFailures) console.error(`  ${k}: planted in the control stylesheet, counted ${n}`)
  console.error("Refusing to report corpus zeros: a probe that cannot see a planted construct")
  console.error("returns the same 0 as a corpus that does not contain it.")
  process.exit(3)
}

// ------------------------------------------------------------------ the walk

const { files, total, repos, overCap, absent } = discover("css", LIMIT)
const corpus = newCounts()
let parsed = 0
let failed = 0
const emitted: Record<string, { edges: number; files: Set<string>; targets: Set<string> }> = {}
const bumpEdge = (t: string, f: string, target: string) => {
  let e = emitted[t]
  if (!e) emitted[t] = e = { edges: 0, files: new Set(), targets: new Set() }
  e.edges++
  e.files.add(f)
  if (target.length > 0) e.targets.add(target)
}

/** Chain-edge census accumulators. */
const chain = {
  edges: 0,
  ends: { exact: 0, leafOnly: 0, boundaryOnly: 0, none: 0 },
  edgesWithNonExactEnd: 0,
  edgesWithKindInconsistentEnd: 0,
  kindInconsistentEnds: 0,
  kindConsistentSuffixEnds: 0,
  selfEdges: 0,
  selfEdgesKindInconsistent: 0,
  selfEdgesNonExact: 0,
  divergences: 0,
  lostIfTightened: 0,
  examplesKindInconsistent: [] as string[],
  examplesSelf: [] as string[],
  examplesDivergence: [] as string[],
  matchedByExample: [] as string[],
}

for (const f of files) {
  let content: string
  try { content = readFileSync(f, "utf8") } catch { failed++; continue }
  let root: any
  try {
    const pr = await parser.parse(content, f)
    root = pr.rootNode
  } catch { failed++; continue }
  parsed++
  countConstructs(root, corpus)

  let res: any
  try {
    res = new Analyzer().analyze(root, content, f)
  } catch { failed++; continue }
  const rel = f.slice(CR.length + 1).split(path.sep).join("/")

  // The analyzer's own name set, exactly as `resolves()` builds it.
  const names = new Set<string>()
  for (const s of res.symbols ?? []) {
    names.add(String(s.name))
    if (s.scope) names.add(`${s.scope}.${s.name}`)
  }

  for (const e of res.relationships ?? []) {
    const t = String(e.type ?? "")
    bumpEdge(t, rel, String(e.target ?? ""))
    if (t !== "contains") continue
    if (!e.metadata?.isSelectorChain) continue
    chain.edges++
    const from = String(e.source ?? "")
    const to = String(e.target ?? "")

    const endHow = (end: string): { how: string; matched: string } => {
      if (names.has(end)) return { how: "exact", matched: end }
      const leaf = leafOf(end)
      if (names.has(leaf)) return { how: "leaf", matched: leaf }
      for (let i = 0; i < end.length; i++) {
        const c = end.charAt(i)
        if (c !== ":" && c !== ".") continue
        const tail = end.slice(i + 1)
        if (tail.length > 0 && names.has(tail)) return { how: "boundary", matched: tail }
      }
      return { how: "none", matched: "" }
    }
    const a = endHow(from)
    const b = endHow(to)
    for (const x of [a, b]) {
      if (x.how === "exact") chain.ends.exact++
      else if (x.how === "leaf") chain.ends.leafOnly++
      else if (x.how === "boundary") chain.ends.boundaryOnly++
      else chain.ends.none++
    }
    const nonExact = a.how !== "exact" || b.how !== "exact"
    if (nonExact) chain.edgesWithNonExactEnd++
    if (a.how === "none" || b.how === "none") {
      chain.divergences++
      if (chain.examplesDivergence.length < 8) chain.examplesDivergence.push(`${rel}: ${JSON.stringify(from)} -> ${JSON.stringify(to)}  (${a.how}/${b.how})`)
    }
    for (const [end, x] of [[from, a], [to, b]] as [string, { how: string; matched: string }][]) {
      if (x.how === "exact") continue
      const consistent = kindClass(end) === kindClass(x.matched)
      if (consistent) chain.kindConsistentSuffixEnds++
      else {
        chain.kindInconsistentEnds++
        if (chain.examplesKindInconsistent.length < 10) {
          chain.examplesKindInconsistent.push(`${rel}: chain term ${JSON.stringify(end)} (${kindClass(end)}) satisfied by published ${JSON.stringify(x.matched)} (${kindClass(x.matched)}) via ${x.how}`)
        }
      }
    }
    const kindInconsistent = (a.how !== "exact" && kindClass(from) !== kindClass(a.matched)) || (b.how !== "exact" && kindClass(to) !== kindClass(b.matched))
    if (kindInconsistent) {
      chain.edgesWithKindInconsistentEnd++
      chain.lostIfTightened++
    }
    if (from === to) {
      chain.selfEdges++
      if (kindInconsistent || nonExact) chain.selfEdgesKindInconsistent++
      if (nonExact) chain.selfEdgesNonExact++
      if (chain.examplesSelf.length < 8) chain.examplesSelf.push(`${rel}: ${JSON.stringify(from)} -> ${JSON.stringify(to)}  [${a.how}/${b.how}]`)
    }
  }
}

// ------------------------------------------------------------------ report

const VOCAB_CANDIDATES = {
  calls: ["function_declaration", "function_definition", "method_definition", "function_item", "generator_function_declaration", "arrow_function", "function_expression", "function_declarator", "function_rule", "custom_function_statement"],
  extends: ["class_declaration", "class_specifier", "inheritance_specifier", "base_class_clause", "superclass", "base_list"],
  implements: ["implements_clause", "extends_clause", "interface_implementation", "type_inheritance_clause", "super_interfaces"],
  instantiates: ["new_expression", "object_creation_expression", "constructor_invocation", "object_creation", "instantiation_expression", "new_declarator"],
}
const vocabFound: Record<string, string[]> = {}
for (const [k, list] of Object.entries(VOCAB_CANDIDATES)) vocabFound[k] = list.filter((n) => corpus.nodeTypes.has(n))

const report = {
  command: `npx tsx validation/m14/fixtures/css/construct-and-chain-census.ts${LIMIT ? ` (BB_CSS_CENSUS_LIMIT=${LIMIT})` : ""}`,
  population: { parsed, failed, walked: files.length, admitted: total, repos, overCap, absent, wholeCorpus: LIMIT === 0 },
  positiveControl: controlFired,
  atKeywords: Object.fromEntries([...corpus.atKeywords.entries()].sort((a, b) => b[1] - a[1])),
  constructs: {
    importStatements: corpus.importStatements,
    extendAtRules: corpus.extendAtRules,
    functionAtRules: corpus.functionAtRules,
    propertyAtRules: corpus.propertyAtRules,
    keyframesAtRules: corpus.keyframesAtRules,
    composesDeclarations: corpus.composesDeclarations,
    composesFromDeclarations: corpus.composesFromDeclarations,
    exportBlocks: corpus.exportBlocks,
    callExpressions: corpus.callExpressions,
    distinctFunctionNames: corpus.callFunctionNames.size,
    errorNodes: corpus.errorNodes,
    distinctNodeTypes: corpus.nodeTypes.size,
  },
  emittedEdges: Object.fromEntries(Object.entries(emitted).sort().map(([k, v]) => [k, { edges: v.edges, files: v.files.size, distinctTargets: v.targets.size }])),
  vocabularyFound: vocabFound,
  chainCensus: {
    edges: chain.edges,
    ends: chain.ends,
    edgesWithNonExactEnd: chain.edgesWithNonExactEnd,
    edgesWithKindInconsistentEnd: chain.edgesWithKindInconsistentEnd,
    kindInconsistentEnds: chain.kindInconsistentEnds,
    kindConsistentSuffixEnds: chain.kindConsistentSuffixEnds,
    selfEdges: chain.selfEdges,
    selfEdgesNonExact: chain.selfEdgesNonExact,
    divergences: chain.divergences,
    lostIfTightened: chain.lostIfTightened,
    examplesKindInconsistent: chain.examplesKindInconsistent,
    examplesSelf: chain.examplesSelf,
    examplesDivergence: chain.examplesDivergence,
  },
}

if (JSON_OUT) {
  console.log(JSON.stringify(report, null, 2))
} else {
  const P = report.population
  console.log(`css construct + chain census — ${P.wholeCorpus ? "WHOLE ADMITTED POPULATION" : `bounded draw of ${LIMIT}`}`)
  console.log(`population: ${P.parsed} parsed of ${P.walked} walked (corpus admits ${P.admitted} .css files across ${P.repos} repos)`)
  console.log(`  skipped by the gate's admission rule: ${P.absent} tracked-but-absent + ${P.overCap} over the 1 MB cap   failures ${P.failed}`)
  console.log(``)
  console.log(`POSITIVE CONTROL (planted in-line, parsed with the same grammar; all must be >= 1)`)
  for (const [k, n] of Object.entries(controlFired)) console.log(`  ${String(n).padStart(3)}  ${k}`)
  console.log(``)
  console.log(`SILENT-TYPE CONSTRUCTS ON THE TREE (whole population)`)
  const C = report.constructs
  console.log(`  import_statement nodes                       ${C.importStatements}`)
  console.log(`  @extend at_rules                             ${C.extendAtRules}`)
  console.log(`  @function at_rules                           ${C.functionAtRules}`)
  console.log(`  @property at_rules                           ${C.propertyAtRules}`)
  console.log(`  @keyframes statements (at_keyword)          ${C.keyframesAtRules}`)
  console.log(`  composes declarations (any)                  ${C.composesDeclarations}`)
  console.log(`  composes … from … declarations               ${C.composesFromDeclarations}`)
  console.log(`  :export / :exports rule_sets                 ${C.exportBlocks}`)
  console.log(`  call_expression nodes                        ${C.callExpressions}   distinct function names ${C.distinctFunctionNames}`)
  console.log(`  ERROR nodes                                  ${C.errorNodes}`)
  console.log(`  distinct node types                          ${C.distinctNodeTypes}`)
  console.log(``)
  console.log(`AT-KEYWORDS ON THE TREE (every node carrying an \`at_keyword\` child)`)
  for (const [k, n] of Object.entries(report.atKeywords)) console.log(`  ${String(n).padStart(7)}  ${k}`)
  console.log(``)
  console.log(`EMITTED EDGES BY TYPE (the analyzer's own output over the same walk)`)
  for (const [k, v] of Object.entries(report.emittedEdges)) {
    console.log(`  ${k.padEnd(13)} edges ${String((v as any).edges).padStart(7)}   files ${String((v as any).files).padStart(4)}   distinct targets ${String((v as any).distinctTargets).padStart(5)}`)
  }
  console.log(``)
  console.log(`NODE VOCABULARY — candidate productions for the types that need a NODE`)
  for (const [k, list] of Object.entries(vocabFound)) {
    console.log(`  ${k.padEnd(13)} found ${list.length === 0 ? "NONE" : JSON.stringify(list)}`)
  }
  console.log(``)
  const K = report.chainCensus
  console.log(`CHAIN-EDGE RESOLUTION CENSUS (contains + isSelectorChain)`)
  console.log(`  edges                                        ${K.edges}`)
  console.log(`  ends: exact ${K.ends.exact}  leaf-only ${K.ends.leafOnly}  boundary-only ${K.ends.boundaryOnly}  unexplained ${K.ends.none}`)
  console.log(`  edges with a non-exact end                   ${K.edgesWithNonExactEnd}`)
  console.log(`  edges with a KIND-INCONSISTENT end           ${K.edgesWithKindInconsistentEnd}`)
  console.log(`  kind-inconsistent ENDS                       ${K.kindInconsistentEnds}   (kind-consistent suffix ends: ${K.kindConsistentSuffixEnds})`)
  console.log(`  self-edges (source === target)               ${K.selfEdges}   of which non-exact ${K.selfEdgesNonExact}`)
  console.log(`  DIVERGENCES (emitted, but no sub-test fires) ${K.divergences}`)
  console.log(`  edges that a kind-consistent gate would drop ${K.lostIfTightened}`)
  console.log(``)
  if (K.examplesKindInconsistent.length) {
    console.log(`  KIND-INCONSISTENT MATCHES — a chain term satisfied by a different kind of selector`)
    for (const x of K.examplesKindInconsistent) console.log(`    ${x}`)
    console.log(``)
  }
  if (K.examplesSelf.length) {
    console.log(`  SELF-EDGES`)
    for (const x of K.examplesSelf) console.log(`    ${x}`)
    console.log(``)
  }
  if (K.examplesDivergence.length) {
    console.log(`  DIVERGENCES — the diagnostic copy does not explain these emitted edges`)
    for (const x of K.examplesDivergence) console.log(`    ${x}`)
    console.log(``)
  }
}
