/**
 * SQL `overrides` RECONCILIATION — limitation 14, which was a hypothesis for two passes.
 *
 * THE UNSETTLED ITEM. Pass 1 recorded that the analyzer emitted 22 `overrides` edges where the
 * lane's own construct probe counted 15 same-kind OR REPLACE redeclarations, and attributed the
 * 7-edge gap to the analyzer keying `state.redeclared` on the name alone. Pass 2 RE-DERIVED all 22
 * analyzer edges from the parse tree, independently, and found every one sound — which moved the
 * defect to the PROBE's side and left the probe's 15 unexplained. Pass 3 proposed a mechanism in
 * prose: the probe registers a hit only when `count === 2`, so a name declared three or more times
 * contributes differently depending on visit order, and its own examples read `first at line 192,
 * again at line 184`, which is not document order.
 *
 * A prose mechanism is not a measurement. This probe states BOTH rules, applies BOTH to the same
 * parse trees, and decomposes the difference exactly. If the decomposition does not sum to the gap
 * the hypothesis is wrong, and this probe reports that rather than a partial explanation.
 *
 * THE THREE DIVERGENCES, and the third is the one pass 3 named.
 *
 *   1. MULTIPLICITY. `analyzer.recordReplacement` emits one edge per OR REPLACE declaration that is
 *      not the FIRST declaration of its `kind:name` key, for a name declared any number of times.
 *      `construct-probe.mts` P4 registers its classification inside `if (rec.count === 2)`, so it
 *      records AT MOST ONE hit per (file, kind:name). For a name declared N>=3 times the probe is
 *      short by N-2 by construction.
 *
 *   2. POSITION. The probe classifies only the declaration it visits SECOND, and files it by
 *      whether THAT one carries OR REPLACE. A name whose second declaration lacks OR REPLACE and
 *      whose third carries it is a real replacement to the analyzer and a `overrides-duplicate`
 *      to the probe.
 *
 *   3. VISIT ORDER — the pass-3 hypothesis, and it is a real defect. The probe's walk is
 *
 *          const stack = [root]; while (stack.length) { const n = stack.pop(); fn(n)
 *            for (let i = 0; i < n.childCount; i++) stack.push(n.child(i)) }
 *
 *      Children are pushed FORWARD into a LIFO stack, so siblings are visited in REVERSE document
 *      order. "The second occurrence" is therefore the second in reverse-sibling order, which is
 *      why the probe's own stored examples read `first at line 192, again at line 184`. This probe
 *      REPRODUCES that visit order rather than assuming document order, so the reproduction can be
 *      compared against the committed probe's 15.
 *
 * A FOURTH divergence is measured and reported separately rather than assumed away: the probe reads
 * OR REPLACE from `n.text.slice(0, 48).toUpperCase().includes("OR REPLACE")` — source TEXT — while
 * the analyzer reads a `keyword_replace` CHILD NODE. The text read can match a comment or a string
 * literal opening inside a declaration's first 48 characters. Both are computed here so the
 * difference is a number.
 *
 * NO REGEX (lane policy). Names come from `identifier`/`literal` leaves of the `object_reference` in
 * document order; OR REPLACE is read from a child node type. The one text read reproduced here is
 * reproduced AS the probe's rule, not used as this probe's own instrument, and the report says which
 * is which.
 *
 * USAGE:
 *   npx tsx validation/m14/fixtures/sql/overrides-reconciliation.mts [--out FILE]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from "node:fs"
import * as path from "node:path"
import { Parser, Language } from "web-tree-sitter"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..")
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const argv = process.argv.slice(2)
const argOf = (f: string) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined }
const OUT = argOf("--out")
const SIZE_CAP = 512 * 1024

// Discovery is identical to `ontology-census.mts`, `construct-probe.mts` and the arbiter's, so all
// four describe the same file set.
const admitted: { label: string; text: string }[] = []
for (const entry of readdirSync(CR)) {
  const dir = path.join(CR, entry)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try { if (statSync(abs).size > SIZE_CAP) continue; text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "sql") continue
    admitted.push({ label: `${entry}/${rel}`, text })
  }
}

await Parser.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const language = await Language.load(readFileSync(path.join(ROOT, "wasm", "tree-sitter-sql.wasm")))
const parser = new Parser()
parser.setLanguage(language as any)

// The construct probe's own DECL list, held constant on purpose: a name only one of the two lists
// knew would be a difference in the KEY, not in the arithmetic. Copied from
// `construct-probe.mts:189` and asserted equal to it by name in the report.
const DECL = ["create_function", "create_procedure", "create_table", "create_view", "create_trigger", "create_materialized_view", "create_type", "create_schema"]

/** The LEAF of an object_reference: last identifier/literal in document order. Quote stripping is a character function. */
function leafName(obj: any): string | null {
  const leaves: any[] = [...obj.descendantsOfType("identifier"), ...obj.descendantsOfType("literal")]
    .sort((a, b) => a.startIndex - b.startIndex)
  if (leaves.length === 0) return null
  let s = leaves[leaves.length - 1].text
  if (s.startsWith('"') || s.startsWith("`") || s.startsWith("[")) s = s.slice(1)
  if (s.endsWith('"') || s.endsWith("`") || s.endsWith("]")) s = s.slice(0, -1)
  return s.length ? s : null
}

/** `OR REPLACE` the ANALYZER's way: a `keyword_replace` direct child. */
function replacesByNode(node: any): boolean {
  for (let i = 0; i < node.childCount; i++) if (node.child(i).type === "keyword_replace") return true
  return false
}

/** `OR REPLACE` the PROBE's way: the first 48 characters of the declaration's own text, uppercased. */
function replacesByText(node: any): boolean {
  const head = node.text.slice(0, 48).toUpperCase()
  return head.indexOf("OR REPLACE") >= 0
}

interface Group {
  file: string
  key: string
  /** lines, in DOCUMENT order */
  lines: number[]
  /** node startIndex, in DOCUMENT order. Unique per node, so it is the join key for pass 2. */
  starts: number[]
  /** OR REPLACE by child node, parallel to lines */
  byNode: boolean[]
  /** OR REPLACE by the probe's 48-char text read, parallel to lines */
  byText: boolean[]
  /** indices into `lines`, in the PROBE's reverse-sibling visit order */
  probeVisitOrder: number[]
}

const groups: Group[] = []
let parseErrors = 0
let filesParsed = 0
let declsSeen = 0
let nodeTextDisagreements = 0
const nodeTextDisagreementExamples: string[] = []

for (const f of admitted) {
  const tree = parser.parse(f.text)
  if (!tree) { parseErrors++; continue }
  filesParsed++

  const perFile = new Map<string, Group>()
  const group = (key: string): Group => {
    let g = perFile.get(key)
    if (!g) { g = { file: f.label, key, lines: [], starts: [], byNode: [], byText: [], probeVisitOrder: [] }; perFile.set(key, g) }
    return g
  }

  // Pass 1 — DOCUMENT order. Children pushed in REVERSE so the LIFO stack yields forward order.
  {
    const stack: any[] = [tree.rootNode]
    while (stack.length) {
      const n = stack.pop()
      if (DECL.includes(n.type)) {
        declsSeen++
        const obj = n.descendantsOfType("object_reference")[0] as any
        if (obj) {
          const name = leafName(obj)
          if (name) {
            const g = group(`${n.type}:${name}`)
            g.lines.push(n.startPosition.row + 1)
            g.starts.push(n.startIndex)
            const byNode = replacesByNode(n)
            const byText = replacesByText(n)
            if (byNode !== byText) {
              nodeTextDisagreements++
              if (nodeTextDisagreementExamples.length < 10) {
                nodeTextDisagreementExamples.push(`${f.label}:${n.startPosition.row + 1} ${n.type} — node=${byNode} text=${byText} :: ${n.text.slice(0, 60).split("\n").join(" ")}`)
              }
            }
            g.byNode.push(byNode)
            g.byText.push(byText)
          }
        }
      }
      for (let i = n.childCount - 1; i >= 0; i--) stack.push(n.child(i))
    }
  }

  // Pass 2 — the PROBE's visit order, reproduced exactly: children pushed FORWARD into a LIFO
  // stack, so siblings come out in reverse. The join back to pass 1 is `startIndex`, which is
  // unique per node; the first version of this probe joined on LINE plus a running counter and
  // produced visit indices of 48 and 216 for a group of TWO declarations, which is how a broken
  // instrument announces itself if the output is read rather than skimmed.
  {
    const stack: any[] = [tree.rootNode]
    while (stack.length) {
      const n = stack.pop()
      if (DECL.includes(n.type)) {
        const obj = n.descendantsOfType("object_reference")[0] as any
        const name = obj ? leafName(obj) : null
        if (name) {
          const g = group(`${n.type}:${name}`)
          const idx = g.starts.indexOf(n.startIndex)
          if (idx < 0) throw new Error(`pass 2 saw a declaration pass 1 did not record: ${f.label}:${n.startIndex}`)
          g.probeVisitOrder.push(idx)
        }
      }
      for (let i = 0; i < n.childCount; i++) stack.push(n.child(i))
    }
  }

  for (const g of perFile.values()) if (g.lines.length >= 2) groups.push(g)
}

// ---------------------------------------------------------------- the two rules

/** `analyzer.recordReplacement`, re-derived: one edge per OR REPLACE declaration at index >= 1. */
function analyzerEdges(g: Group, byText = false): number {
  const flags = byText ? g.byText : g.byNode
  let n = 0
  for (let i = 1; i < flags.length; i++) if (flags[i]) n++
  return n
}

/** `construct-probe.mts` P4, re-derived: at most one hit, and only if the SECOND VISITED carries OR REPLACE. */
function probeHits(g: Group, byText = false): boolean {
  const flags = byText ? g.byText : g.byNode
  if (g.probeVisitOrder.length < 2) return false
  const second = g.probeVisitOrder[1]
  return second < flags.length ? flags[second] : false
}

let analyzerTotal = 0
let probeTotal = 0
let probeTotalTextRead = 0
let analyzerTotalTextRead = 0
let multiplicityExcess = 0
let orderExcess = 0
const contributors: unknown[] = []

for (const g of groups) {
  const A = analyzerEdges(g)
  const P = probeHits(g) ? 1 : 0
  // What the probe's OWN rule would record if its walk visited in document order — isolates
  // divergence 3 from divergence 1.
  const H = g.byNode[1] ? 1 : 0
  analyzerTotal += A
  probeTotal += P
  probeTotalTextRead += probeHits(g, true) ? 1 : 0
  analyzerTotalTextRead += analyzerEdges(g, true)
  multiplicityExcess += A - H
  orderExcess += H - P
  if (A !== P) {
    contributors.push({
      file: g.file,
      key: g.key,
      declarations: g.lines.length,
      lines: g.lines,
      orReplaceByNode: g.byNode,
      orReplaceByText: g.byText,
      probeVisitOrder: g.probeVisitOrder,
      probeSecondVisitLine: g.lines[g.probeVisitOrder[1]],
      analyzerEdges: A,
      probeHits: P,
      multiplicity: A - H,
      order: H - P,
    })
  }
}

const gap = analyzerTotal - probeTotal
const decomposed = multiplicityExcess + orderExcess
const decompositionExact = decomposed === gap

// The 34 EVENTS are not 34 EDGES. `addRelationship` keys identity on (type, source, target) and
// `recordReplacement`'s source is the synthetic owner `global`, so every replacement of the same
// NAME collapses onto one edge no matter how many times it happened or what KIND it was. This
// measures that collapse, because "34 events became 22 edges" and "34 events became 34 edges and
// 12 were lost" are opposite findings and only one of them is true.
//
// PER FILE, not corpus-wide, because the analyzer is per-file: `parseFile` returns one edge array
// per file and the identity map is rebuilt for each. The first version of this probe counted
// distinct names CORPUS-WIDE and read 21 against production's 22; the difference is one name
// (`infinite_recursion`) replaced in two different files, which is 2 edges to `parseFile` and 1
// name to a corpus-wide set. Counting the collapse the way the analyzer sees it is the only
// version of this number that can be compared with a production count at all.
const groupsWithEvents = groups.filter((g) => analyzerEdges(g) > 0)
const edgeKeyOf = (g: Group) => g.key.slice(g.key.indexOf(":") + 1) // (Overrides, "global", name)
const perFileEdgeKeys = new Map<string, Set<string>>()
for (const g of groupsWithEvents) {
  if (!perFileEdgeKeys.has(g.file)) perFileEdgeKeys.set(g.file, new Set())
  perFileEdgeKeys.get(g.file)!.add(edgeKeyOf(g))
}
const distinctEdgeKeys = [...perFileEdgeKeys.values()].reduce((n, s) => n + s.size, 0)
const eventsCollapsed = analyzerTotal - distinctEdgeKeys
const namesAcrossFiles = new Map<string, Set<string>>()
for (const g of groupsWithEvents) {
  const name = edgeKeyOf(g)
  if (!namesAcrossFiles.has(name)) namesAcrossFiles.set(name, new Set())
  namesAcrossFiles.get(name)!.add(g.file)
}
const namesInSeveralFiles = [...namesAcrossFiles.entries()].filter(([, fs]) => fs.size > 1)
const kindCollisions = new Map<string, Set<string>>()
for (const g of groupsWithEvents) {
  const name = edgeKeyOf(g)
  if (!kindCollisions.has(name)) kindCollisions.set(name, new Set())
  kindCollisions.get(name)!.add(g.key.slice(0, g.key.indexOf(":")))
}
const namesAcrossKinds = [...kindCollisions.entries()].filter(([, kinds]) => kinds.size > 1)

// The 12 of multiplicity-excess and the 12 of edge-collapse are INDEPENDENT sums that happen to be
// equal on this corpus, which is why the observable 22-vs-15 gap reduces exactly to the visit-order
// component. They are not equal by rule. The case that separates them is a name whose SECOND
// declaration lacks OR REPLACE and a LATER one carries it: there the analyzer finds an event the
// document-order hit test misses (multiplicity 1) while the edge collapse is 0. Counting that case
// is what makes the equality a measurement instead of an assumption.
const multiplicityWithoutCollapse = groups.filter((g) => analyzerEdges(g) > 0 && !g.byNode[1])
const collapseWithoutMultiplicity = groups.filter((g) => {
  const A = analyzerEdges(g)
  return A > 0 && A - (g.byNode[1] ? 1 : 0) === 0 && A - 1 !== 0
})

console.log(`overrides reconciliation — ${filesParsed} files parsed, ${parseErrors} parse failures, ${declsSeen} declarations, ${groups.length} redeclared (kind:name) groups`)
console.log(`  analyzer rule, OR REPLACE by keyword_replace node : ${analyzerTotal} events`)
console.log(`  probe rule,    OR REPLACE by node, PROBE visit order: ${probeTotal}`)
console.log(`  gap                                                : ${gap}`)
console.log(`  decomposed: multiplicity ${multiplicityExcess} + visit-order ${orderExcess} = ${decomposed}  ${decompositionExact ? "EXACT" : "DOES NOT SUM — hypothesis incomplete"}`)
console.log(`  EDGE identity (type, source=global, target=name), counted PER FILE as parseFile sees it: ${analyzerTotal} events -> ${distinctEdgeKeys} distinct edges; ${eventsCollapsed} collapsed across ${groupsWithEvents.length} groups in ${perFileEdgeKeys.size} files`)
console.log(`  production parseFile emits 22 — the reconciliation is ${distinctEdgeKeys === 22 ? "EXACT" : "OFF BY " + (distinctEdgeKeys - 22)}`)
console.log(`  names replaced in MORE THAN ONE file (each is its own edge to parseFile, 1 to a corpus-wide name set): ${namesInSeveralFiles.length}${namesInSeveralFiles.length ? " — " + namesInSeveralFiles.map(([n, f]) => `${n} in ${f.size} files`).join(", ") : ""}`)
console.log(`  names carried by MORE THAN ONE declaration kind (the kind part of the edge key is lost): ${namesAcrossKinds.length}${namesAcrossKinds.length ? " — " + namesAcrossKinds.map(([n, k]) => `${n} (${[...k].join("+")})`).join(", ") : ""}`)
console.log(`  the case that separates multiplicity-excess from edge-collapse: ${multiplicityWithoutCollapse.length} groups have an event whose SECOND declaration lacks OR REPLACE (multiplicity 1, collapse 0)${multiplicityWithoutCollapse.length ? " — " + multiplicityWithoutCollapse.slice(0, 6).map((g) => g.key).join(", ") : ""}`)
console.log(`  groups where the collapse happens without a multiplicity excess: ${collapseWithoutMultiplicity.length}`)
console.log(`  same two rules reading OR REPLACE from TEXT instead: analyzer ${analyzerTotalTextRead}, probe ${probeTotalTextRead}`)
console.log(`  declarations where the node read and the 48-char text read disagree: ${nodeTextDisagreements}`)
for (const e of nodeTextDisagreementExamples) console.log(`    ${e}`)
console.log(`  groups where the two rules differ: ${contributors.length}`)

// Limitation 1 quotes "22 of 777 real replacement events" and the 777 has never been reproduced by
// a committed instrument at any pass. The per-file figure above is 34 events; the corpus-wide
// figure is a DIFFERENT question, because PostgreSQL's extension corpus ships one file PER VERSION
// with the same function re-declared in every version, so a name declared in 14 version scripts is
// 13 replacement events that a per-file analyzer structurally cannot see. Both are measured here,
// by applying the analyzer's OWN rule to one corpus-wide declaration list per name in document
// order, and the two are reported side by side because they differ by an order of magnitude and
// quoting either without the other is how a reader would come to the wrong one.
const corpusNames = new Map<string, { file: string; start: number; line: number; replaces: boolean }[]>()
for (const g of groups) {
  let list = corpusNames.get(g.key)
  if (!list) { list = []; corpusNames.set(g.key, list) }
  for (let i = 0; i < g.lines.length; i++) list.push({ file: g.file, start: g.starts[i], line: g.lines[i], replaces: g.byNode[i] })
}
let corpusNamesRepeated = 0
let corpusEvents = 0
const top: { key: string; events: number; files: number }[] = []
for (const [key, list] of corpusNames) {
  if (list.length < 2) continue
  corpusNamesRepeated++
  list.sort((a, b) => (a.file === b.file ? a.start - b.start : a.file < b.file ? -1 : 1))
  // The analyzer's rule, verbatim: an event per OR REPLACE declaration that is not the first.
  let events = 0
  for (let i = 1; i < list.length; i++) if (list[i].replaces) events++
  corpusEvents += events
  if (events > 0) top.push({ key, events, files: new Set(list.map((d) => d.file)).size })
}
top.sort((a, b) => b.events - a.events)
console.log(`  PER FILE  (what a per-file analyzer can see): ${analyzerTotal} events -> ${distinctEdgeKeys} edges`)
console.log(`  CORPUS-WIDE (same rule, one declaration list per name across files): ${corpusNamesRepeated} names declared 2+ times, ${corpusEvents} replacement events`)
for (const t of top.slice(0, 6)) console.log(`    ${t.key}: ${t.events} events across ${t.files} files`)
console.log(`  limitation 1's denominator "777" is reproduced by NEITHER instrument and is withdrawn as unmeasured`)

if (OUT) {
  mkdirSync(path.dirname(OUT), { recursive: true })
  writeFileSync(
    OUT,
    JSON.stringify(
      {
        instrument: "validation/m14/fixtures/sql/overrides-reconciliation.mts",
        entryPoint: "tree-sitter parse of the admitted corpus (no parseFile: the question is which of two RULES is right, and both are re-implemented here)",
        corpusRoot: CR,
        admittedFiles: admitted.length,
        filesParsed,
        parseErrors,
        declarationsSeen: declsSeen,
        redeclaredGroups: groups.length,
        declList: DECL,
        analyzerRule: "one edge per OR REPLACE declaration at document index >= 1 of a kind:name key",
        probeRule: "at most one hit per kind:name, and only if the SECOND declaration in the probe's reverse-sibling visit order carries OR REPLACE",
        analyzerEdges: analyzerTotal,
        probeHits: probeTotal,
        gap,
        decomposition: { multiplicity: multiplicityExcess, visitOrder: orderExcess, sum: decomposed, exact: decompositionExact },
        edgeIdentityCollapse: {
          events: analyzerTotal,
          groupsCarryingAnEvent: groupsWithEvents.length,
          filesCarryingAnEvent: perFileEdgeKeys.size,
          distinctEdgeKeysPerFile: distinctEdgeKeys,
          collapsed: eventsCollapsed,
          productionParseFileEdges: 22,
          reconcilesWithProduction: distinctEdgeKeys === 22,
          note: "addRelationship keys on (type, source, target) and recordReplacement's source is the synthetic owner `global`, so repeat replacements of one NAME collapse onto one edge. The kind is not part of the edge key, so a name redeclared as two kinds also collapses. Counted PER FILE because the identity map is rebuilt per parseFile call; a corpus-wide name set reads 21 and is the wrong denominator.",
          namesInSeveralFiles: namesInSeveralFiles.map(([name, files]) => ({ name, files: [...files] })),
          namesAcrossKinds: namesAcrossKinds.map(([name, kinds]) => ({ name, kinds: [...kinds] })),
          multiplicityWithoutCollapse: { count: multiplicityWithoutCollapse.length, keys: multiplicityWithoutCollapse.slice(0, 20).map((g) => `${g.file} ${g.key}`) },
          collapseWithoutMultiplicity: collapseWithoutMultiplicity.length,
        },
        sameRulesReadingReplaceFromText: { analyzer: analyzerTotalTextRead, probe: probeTotalTextRead },
        nodeVsTextReadDisagreements: { count: nodeTextDisagreements, examples: nodeTextDisagreementExamples },
        contributors,
        settles: "limitation 14 — the 22-vs-15 gap is DECOMPOSED, and the decomposition is checked for exactness rather than asserted",
      },
      null,
      2,
    ) + "\n",
  )
  console.log(`wrote ${OUT}`)
}
