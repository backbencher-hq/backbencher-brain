/**
 * script/m12/xml-node-types-compare.ts
 *
 * THE XML COMPLETENESS GATE (F8) — the blind-spot detector for the XML lane.
 *
 * Its predecessor scraped the analyzer's SOURCE TEXT with a regular expression
 * to guess which node types it handled:
 *
 *     for (const match of source.matchAll(/(?:type\s*===\s*|findDirectChild\(...)/g))
 *
 * That is unsound in three separate ways, all of which are defects the lane's own
 * rule forbids:
 *   1. it is a REGEX doing grammar work — the lane's standing rule is that no
 *      regular expression does syntax work, and this one was inferring the
 *      analyzer's grammar vocabulary from its punctuation;
 *   2. it can only see string literals in two syntactic positions, so any dispatch
 *      reached through a table, a set or a variable is invisible, and the gate's
 *      `passed` condition (`live.length > 0 && dead.length === 0`) is SATISFIED BY
 *      AN EMPTY LIST — an analyzer that handled nothing at all would pass;
 *   3. it measured the fixtures, not the corpus, so a node type that only occurs
 *      in real files could never be found.
 *
 * This version asks the analyzer itself. `RealXmlAnalyzer.DECLARED` and
 * `RealXmlAnalyzer.PASSTHROUGH_LITERALS` are the analyzer's own declared
 * vocabulary, each entry carrying the REASON it is acted on or passed through,
 * and the gate checks three things:
 *
 *   A. DECLARED ⊆ GRAMMAR — every type the analyzer acts on exists in the wired
 *      wasm. A name the analyzer dispatches on that the grammar cannot produce is
 *      a dead branch, and dead branches are how a defect hides.
 *   B. CORPUS ⊆ DECLARED ∪ PASSTHROUGH — every named node type observed in a
 *      real corpus is either acted on, or recorded as a pass-through with a
 *      reason. An UNCLASSIFIED type is the red this gate exists for.
 *   C. GRAMMAR ⊆ (DECLARED ∪ PASSTHROUGH ∪ UNREACHABLE) — every type the grammar
 *      declares is accounted for, with a measured list of the ones that no
 *      corpus file and no fixture produces.
 *
 * Modes:
 *   npx tsx script/m12/xml-node-types-compare.ts               # measure, gate, print
 *   npx tsx script/m12/xml-node-types-compare.ts --write       # re-emit the record
 *   npx tsx script/m12/xml-node-types-compare.ts --self-test   # prove the gate fails
 *
 * Writes validation/m12/results/xml-shape-safety.json, and only in --write.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { Parser, Language } from "web-tree-sitter"
import { RealXmlAnalyzer } from "../../src/ast/real-xml-analyzer"

const OUT = "validation/m12/results/xml-shape-safety.json"
const FIXTURE_DIR = "validation/m12/fixtures/xml"
const CORPUS = process.env.XML_CORPUS || "$HOME/fixtures/xml/repos"
const CORPUS_EXTS = (process.env.XML_CORPUS_EXTS || "*.xml *.xsd *.dtd").split(/\s+/).filter(Boolean)
const CORPUS_LIMIT = Number(process.env.XML_CORPUS_LIMIT || "1200")
const MAX_BYTES = 2_000_000
const WRITE = process.argv.includes("--write")
const SELF_TEST = process.argv.includes("--self-test")

/** The 34 constructs the lane's own fixture set must be able to produce. */
const DTD_SHAPE_PROBE =
  `<!DOCTYPE book PUBLIC "-//ACME//DTD BOOK 1.0//EN" "book.dtd" [` +
  `<!ELEMENT book (title,chapter+)><!ELEMENT title (#PCDATA)><!ELEMENT chapter EMPTY>` +
  `<!ATTLIST book id CDATA #REQUIRED lang (en|fr) #IMPLIED cover NOTATION (gif|jpg) #IMPLIED>` +
  `<!ENTITY % pe SYSTEM "common.dtd"><!ENTITY logo SYSTEM "logo.png" NDATA gif>` +
  `<!NOTATION gif SYSTEM "image/gif">]><book id="b" lang="en"><title>t</title><chapter/></book>`

const PI_SHAPE_PROBE = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<?tool some data?>\n<?xml-stylesheet type="text/xsl" href="s.xsl"?>\n<?xml-model href="m.rng" type="application/xml"?>\n<a><?inner content?></a>`
const CDATA_SHAPE_PROBE = `<a>x<![CDATA[<raw> & ]]>y<!--c-->&amp;&#65;&e;</a>`
const RELAXNG_PROBE = `<grammar xmlns="http://relaxng.org/ns/structure/1.0"><start><element name="doc"><attribute name="id"><text/></attribute></element></start></grammar>`

// ---------------------------------------------------------------------------
// A + C: the grammar's own enumerable surface
// ---------------------------------------------------------------------------
await Parser.init()
const wasmPath = "wasm/tree-sitter-xml.wasm"
const language = await Language.load(wasmPath)
const grammarNamed = new Set<string>()
for (let id = 0; id < language.nodeTypeCount; id++) {
  const name = language.nodeTypeForId(id)
  if (name && language.nodeTypeIsNamed(id)) grammarNamed.add(name)
}
const grammarFields: string[] = []
for (let id = 1; id <= language.fieldCount; id++) {
  const name = language.fieldNameForId(id)
  if (name) grammarFields.push(name)
}

const parser = new Parser()
parser.setLanguage(language)

const declared = RealXmlAnalyzer.DECLARED
const passthrough = RealXmlAnalyzer.PASSTHROUGH_LITERALS

// ---------------------------------------------------------------------------
// B: the corpus census
// ---------------------------------------------------------------------------
const observed = new Map<string, number>()
const observedIn = new Map<string, Set<string>>()
const observe = (root: any, where: string) => {
  const stack = [root]
  while (stack.length) {
    const node = stack.pop()!
    if (node.isNamed) {
      observed.set(node.type, (observed.get(node.type) ?? 0) + 1)
      if (!observedIn.has(node.type)) observedIn.set(node.type, new Set())
      const where2 = observedIn.get(node.type)!
      if (where2.size < 4) where2.add(where)
    }
    for (let i = 0; i < node.childCount; i++) stack.push(node.child(i))
  }
}

const fixtureFiles = readdirSync(FIXTURE_DIR).filter((f) => /\.(xml|xsd)$/i.test(f)).sort()
const fixtureErrors: { file: string; errorNodes: number }[] = []
for (const file of fixtureFiles) {
  const tree = parser.parse(readFileSync(join(FIXTURE_DIR, file), "utf8"))
  if (tree.rootNode.hasError) {
    let e = 0
    const walk = (n: any) => { if (n.isError) e++; for (let i = 0; i < n.childCount; i++) walk(n.child(i)) }
    walk(tree.rootNode)
    fixtureErrors.push({ file, errorNodes: e })
  }
  observe(tree.rootNode, `fixture:${file}`)
  tree.delete()
}
// The production corpus carries no internal DTD subset and no stylesheet PI, so
// the defensive handlers are shape-verified here rather than claimed untested.
for (const [label, probe] of Object.entries({ DTD_SHAPE_PROBE, PI_SHAPE_PROBE, CDATA_SHAPE_PROBE, RELAXNG_PROBE })) {
  const tree = parser.parse(probe)
  observe(tree.rootNode, `probe:${label}`)
  tree.delete()
}

const corpusRepos: string[] = []
let corpusFiles = 0
let corpusBytes = 0
let corpusErrorFiles = 0
let corpusMissingNodes = 0
try {
  for (const repo of readdirSync(CORPUS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
    const dir = join(CORPUS, repo)
    let list: string[] = []
    try { list = execFileSync("git", ["-C", dir, "ls-files", ...CORPUS_EXTS], { encoding: "utf8", maxBuffer: 1 << 28 }).split("\n").filter(Boolean) } catch { continue }
    corpusRepos.push(repo)
    for (const rel of list) {
      if (corpusFiles >= CORPUS_LIMIT) break
      const abs = join(dir, rel)
      let bytes = 0
      try { bytes = statSync(abs).size } catch { continue }
      if (bytes > MAX_BYTES) continue
      let src: string
      try { src = readFileSync(abs, "utf8") } catch { continue }
      const tree = parser.parse(src)
      if (tree.rootNode.hasError) corpusErrorFiles++
      const walk = (n: any) => { if (n.isMissing) corpusMissingNodes++; for (let i = 0; i < n.childCount; i++) walk(n.child(i)) }
      walk(tree.rootNode)
      observe(tree.rootNode, `corpus:${repo}`)
      tree.delete()
      corpusFiles++
      corpusBytes += bytes
    }
  }
} catch (error: any) {
  console.error(`corpus census unavailable (${String(error?.message ?? error).slice(0, 160)}); the gate runs on fixtures + shape probes only`)
}

// ---------------------------------------------------------------------------
// G. TREE COVERAGE — an ORACLE-FREE invariant
// ---------------------------------------------------------------------------
/**
 * The differential's recall numbers depend on a SECOND implementation being
 * right, and this lane's differential is not: its namespace scoping is broken in
 * a way the analyzer's is not (measured on
 * `grails-core/…/grails-context.xsd`, the oracle resolved the XSD namespace for
 * **1 of 62** elements, so it reported 76,372 spurious relationships and a
 * contains-attribute recall of 0.910 that were entirely its own error). Two
 * implementations disagreeing is evidence about BOTH, and a recall figure from a
 * broken oracle is a lie with a decimal point.
 *
 * So the load-bearing coverage claim is made WITHOUT an oracle: every `element`
 * node in the tree yields exactly one element symbol, and every `Attribute` node
 * exactly one attribute symbol. Counted from the parse tree and the analyzer's
 * own output, they must be EQUAL, per file, with no tolerance. That is a stronger
 * statement than a recall percentage — it cannot be met by publishing the wrong
 * name, and it cannot be met by publishing anything twice.
 */
const coverage: { file: string; treeElements: number; symbolElements: number; treeAttributes: number; symbolAttributes: number }[] = []
{
  const { RealXmlAnalyzer: Analyzer } = await import("../../src/ast/real-xml-analyzer")
  const analyzer = new Analyzer()
  const audit = (label: string, src: string) => {
    const t = parser.parse(src)
    let elements = 0
    let attributes = 0
    const st = [t.rootNode]
    while (st.length) {
      const n = st.pop()!
      if (n.type === "element") {
        elements++
        const tag = n.children.find((c: any) => c.type === "STag" || c.type === "EmptyElemTag")
        if (tag) for (let i = 0; i < tag.namedChildCount; i++) if (tag.namedChild(i)?.type === "Attribute") attributes++
      }
      for (let i = 0; i < n.childCount; i++) st.push(n.child(i))
    }
    t.delete()
    const result: any = analyzer.analyze(treeOf(src).rootNode, src, label) as any
    const symbolElements = (result.symbols ?? []).filter((x: any) => x.metadata?.nodeType === "element").length
    const symbolAttributes = (result.symbols ?? []).filter((x: any) => x.metadata?.nodeType === "Attribute").length
    coverage.push({ file: label, treeElements: elements, symbolElements, treeAttributes: attributes, symbolAttributes })
  }
  // one parse per source, shared between the count and the analyzer
  const trees = new Map<string, any>()
  const treeOf = (src: string) => {
    let t = trees.get(src)
    if (!t) { t = parser.parse(src); trees.set(src, t) }
    return t
  }
  const sources: [string, string][] = [
    ...fixtureFiles.map((f) => [`fixture:${f}`, readFileSync(join(FIXTURE_DIR, f), "utf8")] as [string, string]),
    ...Object.entries({ DTD_SHAPE_PROBE, PI_SHAPE_PROBE, CDATA_SHAPE_PROBE, RELAXNG_PROBE }).map(([k, v]) => [`probe:${k}`, v] as [string, string]),
  ]
  for (const [label, src] of sources) audit(label, src)
  trees.clear()
}

// ---------------------------------------------------------------------------
// the checks
// ---------------------------------------------------------------------------
const declaredKeys = Object.keys(declared)
const passthroughKeys = Object.keys(passthrough)
const notInGrammar = declaredKeys.filter((t) => !grammarNamed.has(t)).sort()
const unclassified = [...observed.keys()].filter((t) => !declared[t] && !passthrough[t] && t !== "ERROR").sort()
const unaccounted = [...grammarNamed].filter((t) => !declared[t] && !passthrough[t]).sort()
const hiddenInGrammar = [...passthroughKeys].filter((t) => t.startsWith("_") || !grammarNamed.has(t)).sort()
const unusedDeclared = declaredKeys.filter((t) => !observed.has(t)).sort()
const duplicateAcrossTables = declaredKeys.filter((t) => passthrough[t] !== undefined).sort()

const checks: { name: string; passed: boolean; detail?: string }[] = []
const check = (name: string, passed: boolean, detail?: string) => checks.push({ name, passed, detail })

check("A. every type the analyzer acts on exists in the wired grammar", notInGrammar.length === 0,
  notInGrammar.length ? `no such named type: ${notInGrammar.join(", ")}` : `${declaredKeys.length} declared types, all live`)
check("A2. a type is not in both DECLARED and PASSTHROUGH", duplicateAcrossTables.length === 0,
  duplicateAcrossTables.length ? `in both: ${duplicateAcrossTables.join(", ")}` : undefined)
check("A3. every declared type carries a reason", declaredKeys.every((k) => (declared[k] ?? "").trim().length > 0),
  declaredKeys.filter((k) => !(declared[k] ?? "").trim()).join(", ") || undefined)
check("A4. every pass-through carries a reason", passthroughKeys.every((k) => (passthrough[k] ?? "").trim().length > 0),
  passthroughKeys.filter((k) => !(passthrough[k] ?? "").trim()).join(", ") || undefined)
check("B. every node type seen in fixtures, probes and the corpus is classified", unclassified.length === 0,
  unclassified.length ? `UNCLASSIFIED: ${unclassified.join(", ")}` : `${observed.size} named types, all classified`)
check("C. every type the grammar declares is accounted for", unaccounted.length === 0,
  unaccounted.length ? `UNACCOUNTED: ${unaccounted.join(", ")}` : `${grammarNamed.size} grammar named types`)
check("D. the declared vocabulary is not vacuous", declaredKeys.length >= 20,
  `${declaredKeys.length} declared, ${passthroughKeys.length} pass-through`)
// E is CORPUS-ONLY on purpose. The first version accepted the fixtures as
// sufficient, which made the check impossible to fail — a vacuous check in a gate
// about not having vacuous checks. The corpus census is a separate obligation
// from the fixture set: the fixtures prove the handlers run, the corpus proves
// they are the right handlers for what real files contain.
check("E. the corpus census actually ran", corpusFiles > 0,
  corpusFiles > 0
    ? `${corpusFiles} corpus files, ${corpusBytes} bytes, ${corpusRepos.length} repos, ${corpusErrorFiles} with ERROR nodes`
    : `no corpus file was read. Set XML_CORPUS to a directory of pinned git repos (default ${CORPUS}) and XML_CORPUS_EXTS to the globs. Without a corpus this gate can only prove the fixtures, which is not what it is for.`)
check("F. the fixture set is present and non-empty", fixtureFiles.length > 0, `${fixtureFiles.length} fixtures`)
const coverageMismatch = coverage.filter((c) => c.treeElements !== c.symbolElements || c.treeAttributes !== c.symbolAttributes)
check("G. one symbol per tree element and per tree attribute, per file", coverageMismatch.length === 0,
  coverageMismatch.length
    ? `MISMATCH: ${coverageMismatch.map((c) => `${c.file} tree ${c.treeElements}e/${c.treeAttributes}a vs symbols ${c.symbolElements}e/${c.symbolAttributes}a`).join("; ")}`
    : `${coverage.length} sources, ${coverage.reduce((s, c) => s + c.treeElements, 0)} elements and ${coverage.reduce((s, c) => s + c.treeAttributes, 0)} attributes, all exact`)

const result = {
  schemaVersion: 2,
  analyzer: "xml",
  grammar: `wired ${wasmPath}`,
  policy: "This gate asks the analyzer for its vocabulary. The predecessor scraped the analyzer's source with a regular expression and its `passed` condition was satisfied by an EMPTY list, so an analyzer that handled nothing would have passed; the regular expression is gone and the empty-vocabulary case is now check D.",
  checks,
  passed: checks.every((c) => c.passed),
  declared: Object.fromEntries(Object.entries(declared).sort()),
  passthrough: Object.fromEntries(Object.entries(passthrough).sort()),
  notInGrammar,
  unclassifiedObserved: unclassified,
  unaccountedInGrammar: unaccounted,
  hiddenPassThroughLiterals: hiddenInGrammar,
  declaredButUnobserved: unusedDeclared,
  observed: Object.fromEntries([...observed].sort((a, b) => b[1] - a[1])),
  observedIn: Object.fromEntries([...observedIn].map(([k, v]) => [k, [...v].sort()])),
  treeCoverage: coverage,
  fixtureFiles,
  fixtureErrors,
  corpus: { files: corpusFiles, bytes: corpusBytes, repos: corpusRepos, extensions: CORPUS_EXTS, limit: CORPUS_LIMIT, errorFiles: corpusErrorFiles, missingNodes: corpusMissingNodes },
}

if (WRITE) writeFileSync(OUT, JSON.stringify(result, null, 2) + "\n")

// ---------------------------------------------------------------------------
// self-test: prove the gate can fail
// ---------------------------------------------------------------------------
if (SELF_TEST) {
  /**
   * Recompute EVERY check from a mutated copy, so a mutation that disables a
   * check is itself caught. The first version of this self-test recomputed only
   * A/A2/A3/A4/D and reported "MISSED" for the B and C mutations — a self-test
   * that cannot see a check it does not recompute is worse than no self-test,
   * because it prints green.
   */
  const recompute = (r: any): string[] => {
    const d = Object.keys(r.declared ?? {})
    const p = Object.keys(r.passthrough ?? {})
    const failed: string[] = []
    if (d.filter((t) => !grammarNamed.has(t)).length > 0) failed.push("A.")
    if (d.some((k) => (r.passthrough ?? {})[k] !== undefined)) failed.push("A2.")
    if (d.some((k) => !(r.declared[k] ?? "").trim())) failed.push("A3.")
    if (p.some((k) => !(r.passthrough[k] ?? "").trim())) failed.push("A4.")
    // B: every OBSERVED type classified
    const unclassified = [...observed.keys()].filter((t) => !(r.declared ?? {})[t] && !(r.passthrough ?? {})[t] && t !== "ERROR")
    if (unclassified.length > 0) failed.push("B.")
    // C: every GRAMMAR type accounted for
    if ([...grammarNamed].some((t) => !(r.declared ?? {})[t] && !(r.passthrough ?? {})[t])) failed.push("C.")
    if (d.length < 20) failed.push("D.")
    if (!((r.corpus?.files ?? 0) > 0)) failed.push("E.")
    if (!((r.fixtureFiles ?? []).length > 0)) failed.push("F.")
    // G: tree coverage is the ORACLE-FREE claim, so the self-test has to be able
    // to break it by losing or duplicating one symbol.
    if ((r.treeCoverage ?? []).some((c: any) => c.treeElements !== c.symbolElements || c.treeAttributes !== c.symbolAttributes)) failed.push("G.")
    return failed
  }
  const cases: { name: string; mutate: (r: any) => void; expect: string }[] = [
    { name: "a declared type the grammar lacks", mutate: (r) => { r.declared.NoSuchType = "injected" }, expect: "A." },
    { name: "an observed type nobody classified", mutate: (r) => { delete r.declared.element; delete r.passthrough.element }, expect: "B." },
    { name: "a grammar type nobody accounted for", mutate: (r) => { delete r.declared.PI; delete r.passthrough.PI }, expect: "C." },
    { name: "a reason stripped off a declaration", mutate: (r) => { r.declared.element = "  " }, expect: "A3." },
    { name: "a reason stripped off a pass-through", mutate: (r) => { r.passthrough.PITarget = "" }, expect: "A4." },
    { name: "a type in both tables", mutate: (r) => { r.passthrough.element = "also here" }, expect: "A2." },
    { name: "an empty declared vocabulary", mutate: (r) => { r.declared = {}; r.passthrough = {} }, expect: "D." },
    { name: "an empty corpus record", mutate: (r) => { r.corpus = { files: 0 } }, expect: "E." },
    { name: "an empty fixture set", mutate: (r) => { r.fixtureFiles = [] }, expect: "F." },
    { name: "a lost element in tree coverage", mutate: (r) => { r.treeCoverage[0].symbolElements -= 1 }, expect: "G." },
    { name: "a duplicated attribute in tree coverage", mutate: (r) => { r.treeCoverage[0].symbolAttributes += 1 }, expect: "G." },
  ]
  let selfTestPassed = true
  for (const c of cases) {
    const copy = JSON.parse(JSON.stringify(result))
    c.mutate(copy)
    const failed = recompute(copy)
    const ok = failed.includes(c.expect)
    if (!ok) selfTestPassed = false
    console.log(`  self-test ${ok ? "caught " : "MISSED "} ${c.name}  (expected ${c.expect}, got ${failed.join(",") || "none"})`)
  }
  // and the UNMUTATED record must be green, or the gate proves nothing
  const clean = recompute(result)
  if (clean.length > 0) { selfTestPassed = false; console.log(`  self-test RED: the unmutated record fails ${clean.join(",")}`) }
  else console.log("  self-test clean: the unmutated record passes every check")
  console.log(selfTestPassed ? "self-test: green" : "self-test: RED")
  if (!selfTestPassed) process.exitCode = 1
}

console.log(JSON.stringify({
  passed: result.passed,
  checks,
  declaredCount: declaredKeys.length,
  passthroughCount: passthroughKeys.length,
  grammarNamedTypes: grammarNamed.size,
  observedTypes: observed.size,
  corpus: result.corpus,
  unusedDeclared,
}, null, 2))
if (!result.passed) process.exitCode = 1
