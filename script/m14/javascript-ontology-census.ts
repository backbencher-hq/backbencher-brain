/**
 * JAVASCRIPT ONTOLOGY CENSUS — the measurement instrument for
 * docs/analyzers/ONTOLOGY-WORKSTREAM.md.
 *
 * WHAT IT MEASURES, over the production entry (`src/ast/pool-worker.parseFile`,
 * the same call `engine.ts` makes), per relationship type:
 *
 *   FIRES       edges the analyzer actually produced, in how many FILES, and the
 *               per-file maximum — a single synthetic baseline can carry a
 *               quarter of a corpus's edges and a bare total hides that.
 *   RESOLVED    for each edge, does each endpoint name a symbol the analyzer
 *               emitted — same file, another file of the run, or neither.
 *   CONFIDENT   the confidence and evidenceClass distribution, so the share
 *               below the 0.7 fabrication threshold is a number, not a vibe.
 *   R7          unknown symbols, empty names and placeholder-literal endpoints.
 *
 * AND THE MISSING TYPE. `implements` is measured with BOTH instruments the
 * ontology gate names, because "JavaScript has no implements clause" is a claim
 * about a grammar and prose is not a measurement:
 *
 *   A: GRAMMAR INVENTORY — every node type the pinned tree-sitter-javascript
 *      grammar produces across the corpus. If no node type expresses a supertype
 *      clause beyond `class_heritage`, that is positive evidence of absence.
 *   B: PARSE-TREE COUNT — a semantic count, because a construct can hide in a
 *      shape the inventory does not name. Every `class_heritage` is read: a
 *      clause with more than one NAMED child is a multi-supertype clause, which
 *      is what `implements` looks like where a language has one.
 *   C: ANONYMOUS TOKENS — the `implements` keyword is an anonymous token, so it
 *      would not appear in the node-type inventory at all. Counted directly on
 *      every `class_heritage` (and, as a backstop, on every anonymous child
 *      anywhere in the tree).
 *   D: JSDOC `@implements` — the one place the JS ECOSYSTEM spells the word. It
 *      is a COMMENT, not the language, so instrument B cannot see it. Counted
 *      separately and reported separately so the ruling states which construct it
 *      ruled on.
 *
 * ## WHY THIS IS A FULL CENSUS AND NOT A SAMPLE
 *
 * A sample of this corpus lies, and it lied in a way worth recording. A
 * first-600 draw is 574 files of `tsc/testdata` — the TypeScript compiler's own
 * test BASELINES, which are TypeScript source and deliberately-malformed inputs
 * rather than JavaScript programs; 330 of 400 carry parse errors, 5,160 in all.
 * The obvious repair — "keep only files the JS grammar parses with zero
 * ERROR/MISSING nodes" — does not repair it either: `tsc/testdata/baselines/
 * reference/compiler/manyConstExports(target=es2015).js` parses CLEANLY and is a
 * single file holding **15,000 exports edges** (5,000 distinct targets). A
 * clean-file sample of 600 therefore reported 15,701 `exports` edges, 95.5% of
 * them from that one baseline; the unfiltered 600 reported 597. That is a 26x
 * swing in a headline number decided entirely by sample membership.
 *
 * So this census admits EVERY tracked js-family file and reports each type twice:
 * once over the clean population (the verdict basis — an edge recovered from an
 * ERROR node is a statement about the grammar's error recovery, not about the
 * lane) and once over the whole admitted population (a robustness note). Per-type
 * per-file counts are written out so the concentration is visible rather than
 * averaged away, and the top contributors are named.
 *
 * WRITES ONE FILE (validation/m14/tmp/javascript-census-<tag>.json). READ-ONLY
 * otherwise. Lane-owned; touches no shared harness.
 *
 * USAGE
 *   bun run script/m14/javascript-ontology-census.ts [--corpus=<dir>] [--tag=<name>]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { parseFile } from "../../src/ast/pool-worker"
import { LANGS } from "./differential"

const ALL_TYPES = [
  "calls", "uses", "contains", "imports", "references",
  "exports", "extends", "implements", "overrides", "instantiates",
] as const
type Type = (typeof ALL_TYPES)[number]

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}

const CR = arg("corpus", "$HOME/fixtures/repositories/typescript")
const TAG = arg("tag", path.basename(CR))
const SIZE_CAP = 512 * 1024
const OUT = `validation/m14/tmp/javascript-census-${TAG}.json`

// ---------------------------------------------------------------- corpus
// Tracked files only (a build artifact is not a source fact), deterministic
// order, byte-capped exactly as the ontology coverage gate caps them.
const tracked: string[] = execFileSync("git", ["-C", CR, "ls-files", "-z"], {
  encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
}).split("\0").filter(Boolean)

const admitted: string[] = []
for (const rel of tracked) {
  const abs = path.join(CR, rel)
  try {
    if (statSync(abs).size > SIZE_CAP) continue
    const text = readFileSync(abs, "utf8")
    if (detectLanguageFromPath(abs, text) !== "javascript") continue
  } catch { continue }
  admitted.push(rel)
}
admitted.sort()

console.log(`javascript ontology census — ${TAG}`)
console.log(`corpus: ${CR}`)
console.log(`tracked files: ${tracked.length}   admitted js-family (<=${SIZE_CAP >> 10} KiB, detected): ${admitted.length}\n`)

// ---------------------------------------------------------------- the run
type Edge = {
  source: string; target: string; type: Type
  confidence: number; evidenceClass: string
  line?: number; file: string; clean: boolean; metadata?: Record<string, unknown>
}

type Verdict = "symbol-in-file" | "symbol-elsewhere-in-run" | "module-leaf" | "path-leaf" | "dangling" | "empty"

/**
 * How well does one endpoint bind?
 *
 * The FIRST version of this instrument asked "is this string a symbol name" and
 * reported 644 of 644 `overrides` targets as dangling. Every one of those targets
 * is `Base.method` — a compound the lane spells `owner.member`, and no symbol is
 * NAMED `Base.method`, so a whole relationship class read as 100% unresolved. That
 * is the instrument being wrong, not the lane: `Base` and `method` are two real
 * symbols and the edge binds to both.
 *
 * So an endpoint is decomposed the way the lane SPELLS it, and each shape gets its
 * own answer:
 *   `mod:item`   an `imports` target — the ITEM is the name that can bind;
 *   `a.b` / `a::b` an `overrides` target or a `qualified_calls` key — both parts bind;
 *   a MODULE LEAF (the file's own basename, which this lane emits NO symbol for) is
 *     reported as its own category rather than counted as dangling, because "the lane
 *     does not symbol a module" is a DESIGNED property with its own number, and
 *     folding it into "dangling" hides which of the two is growing.
 */
const moduleLeaves = new Set<string>()
function classify(name: string, inFile: Set<string>): Verdict {
  if (!name) return "empty"
  if (inFile.has(name)) return "symbol-in-file"
  if (allSymbolNames.has(name)) return "symbol-elsewhere-in-run"
  if (name.includes("::")) {
    const [owner, member] = name.split("::", 2)
    return inFile.has(owner) && inFile.has(member) ? "symbol-in-file" : "dangling"
  }
  if (name.includes(":")) {
    // `imports` writes `<module>:<item>`; only the item can bind.
    const item = name.slice(name.lastIndexOf(":") + 1)
    if (item === "*") return "path-leaf"
    return inFile.has(item) || allSymbolNames.has(item) ? "symbol-in-file" : "path-leaf"
  }
  if (name.includes(".")) {
    const parts = name.split(".")
    const head = parts[0]
    const tail = parts[parts.length - 1]
    if (inFile.has(head) && inFile.has(tail)) return "symbol-in-file"
    if (moduleLeaves.has(head)) return "module-leaf"
    return "dangling"
  }
  if (moduleLeaves.has(name)) return "module-leaf"
  return "dangling"
}

type Tally = {
  n: number
  files: Set<string>
  perFile: Map<string, number>
  conf: Map<number, number>
  evidence: Map<string, number>
  src: Record<Verdict, number>
  tgt: Record<Verdict, number>
  /** edges with BOTH endpoints binding to a real symbol somewhere in the run */
  bothNamed: number
  srcUnresolvedExamples: string[]
  tgtUnresolvedExamples: string[]
  markedUnresolved: number
  noLineNumber: number
  cleanN: number
  cleanFiles: Set<string>
}

const perType = new Map<Type, Tally>()
const zeroVerdicts = (): Record<Verdict, number> => ({
  "symbol-in-file": 0, "symbol-elsewhere-in-run": 0, "module-leaf": 0, "path-leaf": 0, dangling: 0, empty: 0,
})
const freshTally = (): Tally => ({
  n: 0, files: new Set(), perFile: new Map(), conf: new Map(), evidence: new Map(),
  src: zeroVerdicts(), tgt: zeroVerdicts(), bothNamed: 0,
  srcUnresolvedExamples: [], tgtUnresolvedExamples: [],
  markedUnresolved: 0, noLineNumber: 0, cleanN: 0, cleanFiles: new Set(),
})
for (const t of ALL_TYPES) perType.set(t, freshTally())

const allSymbolNames = new Set<string>()
const allEdges: Edge[] = []

let parsed = 0, threw = 0, filesWithEdges = 0
let totalSymbols = 0, totalEdges = 0
let errorFiles = 0, parseErrorCount = 0
const errorFileList: string[] = []

const wallStart = Date.now()
{
  let idx = 0
  async function worker(): Promise<void> {
    for (;;) {
      const i = idx++
      if (i >= admitted.length) return
      const rel = admitted[i]
      const abs = path.join(CR, rel)
      let r: any
      try { r = await parseFile(abs, CR) } catch { threw++; continue }
      parsed++
      const clean = !(r?.errors?.length)
      if (!clean) { errorFiles++; parseErrorCount += r.errors.length; if (errorFileList.length < 10) errorFileList.push(rel) }
      const symNames = new Set<string>()
      for (const s of r?.symbols ?? []) {
        const n = String(s?.name ?? "")
        if (n) { symNames.add(n); allSymbolNames.add(n) }
        totalSymbols++
      }
      moduleLeaves.add(path.basename(rel, path.extname(rel)))
      const rels = (r?.relationships ?? []) as any[]
      if (rels.length > 0) filesWithEdges++
      for (const x of rels) {
        const t = String(x.type ?? x.relationshipType ?? "").toLowerCase() as Type
        if (!ALL_TYPES.includes(t)) continue
        const src = String(x.source ?? "")
        const tgt = String(x.target ?? "")
        const conf = typeof x.confidence === "number" ? x.confidence : 1
        const ec = String(x.metadata?.evidenceClass ?? "(none)")
        const row = perType.get(t)!
        row.n++
        row.files.add(rel)
        row.perFile.set(rel, (row.perFile.get(rel) ?? 0) + 1)
        if (clean) { row.cleanN++; row.cleanFiles.add(rel) }
        row.conf.set(conf, (row.conf.get(conf) ?? 0) + 1)
        row.evidence.set(ec, (row.evidence.get(ec) ?? 0) + 1)
        const sv = classify(src, symNames)
        const tv = classify(tgt, symNames)
        row.src[sv]++
        row.tgt[tv]++
        if (sv !== "dangling" && sv !== "empty" && tv !== "dangling" && tv !== "empty") row.bothNamed++
        if (row.srcUnresolvedExamples.length < 8 && sv === "dangling" && src) row.srcUnresolvedExamples.push(`${rel}: ${src}`)
        if (row.tgtUnresolvedExamples.length < 8 && tv === "dangling" && tgt) row.tgtUnresolvedExamples.push(`${rel}: ${tgt}`)
        if (typeof x.line_number !== "number") row.noLineNumber++
        if (x.metadata?.unresolved === true) row.markedUnresolved++
        totalEdges++
        if (allEdges.length < 200000) allEdges.push({ source: src, target: tgt, type: t, confidence: conf, evidenceClass: ec, line: x.line_number, file: rel, clean, metadata: x.metadata })
      }
    }
  }
  await Promise.all(Array.from({ length: 8 }, () => worker()))
}
const wallMs = Date.now() - wallStart

// ---------------------------------------------------------------- R7
// Rule R7: an endpoint that is a language PLACEHOLDER rather than a written name
// is a defect, and so is an empty one. Measured here, not argued about.
//
// THE TWO CLASSES ARE COUNTED SEPARATELY, because counting them as one number is
// what makes an R7 report useless. Measured on the full corpus, the single
// combined total reads ~3,100 sites and most of them are NOT defects:
//
//   EMPTY            the endpoint names NOTHING. tree-sitter's error recovery
//                    produces zero-length `identifier` nodes inside TypeScript
//                    syntax in a `.js` file (`var xs2: typeof moduleA[]`), and a
//                    `.`-chain whose property is missing (`throw undefined.`).
//                    There is no written name behind it, so this is R7 exactly.
//   KEYWORD-FREE     the endpoint is a WRITTEN token the language supplies and
//                    no declaration binds: `module` (the CommonJS free
//                    variable), `global` (this analyzer's own fallback, which is
//                    an R7 defect), `self`/`super` where error recovery made a
//                    keyword into an identifier.
//   WRITTEN-NAME     the endpoint is a written NAME that merely collides with a
//                    keyword: `default` in `exports.default = RIL` is the
//                    CommonJS spelling of the default export, and the analyzer is
//                    supposed to name it. Counting it as a placeholder convicts
//                    the lane for being right.
//
// The register that matters for R7 is the EMPTY one, plus `global`. The other two
// are reported with their counts so the decision is visible rather than asserted.
const KEYWORD_FREE_TOKENS = new Set(["global", "__global__", "<global>", "module", "self", "*", "this", "super"])
const WRITTEN_NAME_TOKENS = new Set(["default"])
const r7 = {
  emptySource: 0, emptyTarget: 0, placeholderSource: 0, placeholderTarget: 0,
  keywordFreeSource: 0, keywordFreeTarget: 0, writtenNameSource: 0, writtenNameTarget: 0,
  byType: {} as Record<string, number>,
  samples: [] as string[],
}
for (const e of allEdges) {
  const bump = (k: string): void => { r7.byType[k] = (r7.byType[k] ?? 0) + 1 }
  if (!e.source) { r7.emptySource++; bump(`emptySource:${e.type}`); if (r7.samples.length < 12) r7.samples.push(`empty source: ${e.type} -> "${e.target}" (${e.file})`) }
  if (!e.target) { r7.emptyTarget++; bump(`emptyTarget:${e.type}`); if (r7.samples.length < 12) r7.samples.push(`empty target: ${e.type} <- "${e.source}" (${e.file})`) }
  if (e.source && KEYWORD_FREE_TOKENS.has(e.source) && !allSymbolNames.has(e.source)) { r7.keywordFreeSource++; r7.placeholderSource++; bump(`keywordFreeSource:${e.source}:${e.type}`) }
  if (e.target && KEYWORD_FREE_TOKENS.has(e.target) && !allSymbolNames.has(e.target)) { r7.keywordFreeTarget++; r7.placeholderTarget++; bump(`keywordFreeTarget:${e.target}:${e.type}`) }
  if (e.source && WRITTEN_NAME_TOKENS.has(e.source) && !allSymbolNames.has(e.source)) { r7.writtenNameSource++; bump(`writtenNameSource:${e.source}:${e.type}`) }
  if (e.target && WRITTEN_NAME_TOKENS.has(e.target) && !allSymbolNames.has(e.target)) { r7.writtenNameTarget++; bump(`writtenNameTarget:${e.target}:${e.type}`) }
}

// ---------------------------------------------------------------- implements
const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const wasmPath = (LANGS as any)["javascript"]?.wasm ?? "tree-sitter-javascript.wasm"
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", wasmPath))))

// INSTRUMENT A — the grammar's own vocabulary, observed across the whole corpus.
const nodeTypes = new Map<string, number>()
// INSTRUMENT B — semantic counts on the tree, where a string cannot fake them.
const heritageShapes = new Map<string, number>()
const heritageMulti: string[] = []
const implementsTokens: string[] = []
const heritageTokens = new Map<string, number>()
const supertypeNodes = new Map<string, number>()
let heritageClauses = 0
let multiSupertypeClauses = 0
let multiSupertypeInsideError = 0
let trees = 0

// INSTRUMENT D — JSDoc `@implements`, which is a COMMENT and therefore invisible
// to A, B and C. Counted as comment text, which is the only place it can be.
const jsdoc = { implementsTags: 0, extendsTags: 0, filesWithImplements: 0, filesWithExtends: 0, examples: [] as string[] }
let comments = 0

for (const rel of admitted) {
  const text = readFileSync(path.join(CR, rel), "utf8")
  const t = parser.parse(text)
  if (!t) continue
  trees++
  const visit = (n: any): void => {
    nodeTypes.set(n.type, (nodeTypes.get(n.type) ?? 0) + 1)
    if (n.type === "comment") {
      comments++
      const body = n.text
      // A JSDoc TAG, not the word: `@implements` / `@extends`, optionally inside
      // a `{...}` type. Matched on the `@` so prose that merely says the word
      // cannot inflate the count.
      if (body.includes("@implements")) {
        jsdoc.implementsTags++
        jsdoc.filesWithImplements++
        if (jsdoc.examples.length < 8) jsdoc.examples.push(`${rel}: ${body.slice(0, 100)}`)
      }
      if (body.includes("@extends")) { jsdoc.extendsTags++; jsdoc.filesWithExtends++ }
    }
    if (n.type === "class_heritage") {
      heritageClauses++
      const kids: string[] = []
      for (let i = 0; i < n.namedChildCount; i++) kids.push(n.namedChild(i)!.type)
      const shape = kids.join("+") || "(empty)"
      heritageShapes.set(shape, (heritageShapes.get(shape) ?? 0) + 1)
      // A MULTI-SUPERTYPE CLAUSE is what `implements` would look like where a
      // language has one, and it is counted STRUCTURALLY: more than one NAMED
      // child under `class_heritage` is the only shape a second supertype can
      // take in this grammar.
      //
      // An earlier probe fired on a comma in the clause's TEXT and reported one
      // "multi-supertype clause" on
      // `tsc/testdata/.../anonClassDeclarationEmitIsAnon.js`:
      // `extends (0, wrapClass_1.Timestamped)(User)`. That is a SEQUENCE
      // expression — TypeScript's `__extends` helper output — with exactly one
      // supertype, and the comma belongs to the expression. A text pattern
      // matching a SHAPE a real construct also has is the mistake this gate
      // already records once. The structural count is authoritative; the text
      // comma is not counted at all.
      if (kids.length > 1) {
        // The COUNT is the measurement; the array is a sample of it. This used to
        // be one capped array with `heritageMulti.length` reported as the count, so
        // the census printed "multi-supertype 8" on the ts corpus when the
        // structural count is 40 — a cap read as a measurement, which is the one
        // thing a corpus probe must never be. Measured by
        // `script/m14/javascript-implements-ruling.ts` instrument B/C, which keeps
        // every hit's ERROR flag: all 40 are `[ERROR, identifier]`.
        multiSupertypeClauses++
        multiSupertypeInsideError += /ERROR/.test(n.toString()) ? 1 : 0
        if (heritageMulti.length < 8) heritageMulti.push(`${rel}: [${kids.join(", ")}] ${n.text.slice(0, 120)}`)
      }
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i)
        if (c && !c.isNamed) {
          heritageTokens.set(c.type, (heritageTokens.get(c.type) ?? 0) + 1)
          if (c.type === "implements") implementsTokens.push(`${rel}: ${c.text}`)
        }
      }
    }
    // The other node type a supertype clause could hide in, if the grammar had
    // one: `implements_clause` / `superclass` / `interface_declaration` /
    // `extends_clause`. Counted so instrument A's claim is falsifiable by the
    // same walk rather than by a name search.
    if (n.type.includes("implement") || n.type === "superclass" ||
        n.type === "interface_declaration" || n.type === "extends_clause") {
      supertypeNodes.set(n.type, (supertypeNodes.get(n.type) ?? 0) + 1)
    }
    for (let i = 0; i < n.childCount; i++) visit(n.child(i))
  }
  visit(t.rootNode)
  t.delete?.()
}
jsdoc.filesWithImplements = new Set(admitted.filter((r) => {
  const text = readFileSync(path.join(CR, r), "utf8")
  return text.includes("@implements")
})).size
jsdoc.filesWithExtends = new Set(admitted.filter((r) =>
  readFileSync(path.join(CR, r), "utf8").includes("@extends"))).size

const nodeTypesMatchingImplement = [...nodeTypes.keys()].filter((n) => n.includes("implement"))

// ---------------------------------------------------------------- report
const topFiles = (tally: Tally, k = 8): Array<[string, number]> =>
  [...tally.perFile.entries()].sort((a, b) => b[1] - a[1]).slice(0, k)

const out: any = {
  at: new Date().toISOString(),
  tag: TAG,
  corpus: CR,
  corpusCommit: (() => { try { return execFileSync("git", ["-C", CR, "rev-parse", "HEAD"], { encoding: "utf8" }).trim() } catch { return null } })(),
  grammar: { wasm: wasmPath, nodeTypesDistinct: nodeTypes.size, nodeTypesMatchingImplement, supertypeNodes: Object.fromEntries(supertypeNodes) },
  selection: {
    rule: `every git-tracked file whose extension+content detects as javascript and whose size is <= ${SIZE_CAP} bytes; parsed in full. NO sampling: a sample of this corpus is decided by one synthetic baseline (see the file header).`,
    tracked: tracked.length,
    admitted: admitted.length,
  },
  run: {
    parsed, threw, filesWithEdges, totalSymbols, totalEdges, wallMs,
    cleanFiles: admitted.length - errorFiles, errorFiles, parseErrorCount,
    errorFileExamples: errorFileList,
  },
  types: Object.fromEntries(ALL_TYPES.map((t) => {
    const row = perType.get(t)!
    return [t, {
      verdict: row.n > 0 ? "EMITTED" : "NOT-EMITTED",
      n: row.n,
      files: row.files.size,
      cleanN: row.cleanN,
      cleanFiles: row.cleanFiles.size,
      topFiles: Object.fromEntries(topFiles(row)),
      maxPerFile: topFiles(row, 1)[0]?.[1] ?? 0,
      concentrationTop8: topFiles(row).reduce((a, [, n]) => a + n, 0),
      confidence: Object.fromEntries([...row.conf.entries()].sort((a, b) => b[0] - a[0]).map(([k, v]) => [String(k), v])),
      underPointSeven: [...row.conf.entries()].filter(([k]) => k < 0.7).reduce((a, [, v]) => a + v, 0),
      evidenceClass: Object.fromEntries([...row.evidence.entries()].sort((a, b) => b[1] - a[1])),
      // RESOLUTION, per endpoint. The tally keys are `src`/`tgt` (the shape
      // `classify` returns); the first cut of this report read `row.srcResolvedFile`
      // and friends, fields the tally never had, so every resolution number came
      // out `undefined` and the whole question was unmeasured rather than answered.
      source: { ...row.src },
      target: { ...row.tgt },
      sourceResolvesInFile: row.src["symbol-in-file"],
      sourceResolvesElsewhereInRun: row.src["symbol-elsewhere-in-run"],
      targetResolvesInFile: row.tgt["symbol-in-file"],
      targetResolvesElsewhereInRun: row.tgt["symbol-elsewhere-in-run"],
      targetDangling: row.tgt.dangling,
      sourceDangling: row.src.dangling,
      // Edges with BOTH endpoints binding to a real symbol (same file or elsewhere
      // in the run). Counted during the walk rather than derived from the two
      // dangling totals, because one edge can be unresolved at BOTH ends and
      // subtracting the two would count it once instead of twice.
      bothEndpointsNamed: row.bothNamed,
      sourceUnresolvedExamples: row.srcUnresolvedExamples,
      targetUnresolvedExamples: row.tgtUnresolvedExamples,
      markedUnresolved: row.markedUnresolved,
      noLineNumber: row.noLineNumber,
    }]
  })),
  r7,
  implements: {
    instrumentA_grammarInventory: {
      distinctNodeTypes: nodeTypes.size,
      nodeTypesMatchingImplement,
      supertypeShapedNodes: Object.fromEntries(supertypeNodes),
      verdict: nodeTypesMatchingImplement.length === 0 && supertypeNodes.size === 0
        ? `the grammar produced ${nodeTypes.size} distinct node types across ${trees} trees and NONE is an implements/supertype clause node`
        : `FALSIFIED: ${[...nodeTypesMatchingImplement, ...supertypeNodes.keys()].join(", ")}`,
    },
    instrumentB_heritageStructure: {
      heritageClauses,
      shapes: Object.fromEntries([...heritageShapes.entries()].sort((a, b) => b[1] - a[1])),
      multiSupertypeClauses,
      multiSupertypeInsideError,
      multiSupertypeExamples: heritageMulti,
      anonymousTokensInHeritage: Object.fromEntries(heritageTokens),
      implementsTokenOccurrences: implementsTokens.length,
      implementsTokenExamples: implementsTokens,
    },
    instrumentD_jsdocComments: {
      commentNodes: comments,
      jsdocImplementsTags: jsdoc.implementsTags,
      filesWithImplementsTag: jsdoc.filesWithImplements,
      jsdocExtendsTags: jsdoc.extendsTags,
      filesWithExtendsTag: jsdoc.filesWithExtends,
      examples: jsdoc.examples,
      note: "a COMMENT, not the language. Reported so the ruling states which construct it ruled on; the lane does not parse JSDoc types into the payload.",
    },
  },
  nodeTypeTable: [...nodeTypes.entries()].sort((a, b) => b[1] - a[1]),
}
mkdirSync(path.dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify(out, null, 2))

const w = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
console.log(`${w("type", 14)}${w("verdict", 12)}${w("n", 9)}${w("files", 8)}${w("cleanN", 9)}${w("conf<0.7", 9)}${w("src dngl", 10)}${w("tgt dngl", 10)}evidenceClass`)
console.log("-".repeat(126))
for (const t of ALL_TYPES) {
  const r = (out.types as any)[t]
  if (!r.n) { console.log(`${w(t, 14)}${w(r.verdict, 12)}${w("0", 9)}${w("0", 8)}${w("0", 9)}${w("-", 9)}${w("-", 10)}${w("-", 10)}-`); continue }
  console.log(`${w(t, 14)}${w(r.verdict, 12)}${w(r.n.toLocaleString(), 9)}${w(String(r.files), 8)}${w(r.cleanN.toLocaleString(), 9)}${w(String(r.underPointSeven), 9)}${w(String(r.sourceDangling), 10)}${w(String(r.targetDangling), 10)}${JSON.stringify(r.evidenceClass)}`)
}
console.log("-".repeat(126))
console.log(`parsed ${parsed}/${admitted.length}  threw ${threw}  clean ${admitted.length - errorFiles}  errorFiles ${errorFiles} (${parseErrorCount} errors)`)
console.log(`symbols ${totalSymbols.toLocaleString()}  edges ${totalEdges.toLocaleString()}  ${wallMs} ms  distinct node types ${nodeTypes.size} over ${trees} trees`)
console.log(`\nR7: emptySource ${r7.emptySource}  emptyTarget ${r7.emptyTarget}  placeholderSource ${r7.placeholderSource}  placeholderTarget ${r7.placeholderTarget}`)
console.log(`R7 by shape: ${JSON.stringify(r7.byType)}`)
if (r7.samples.length) for (const s of r7.samples) console.log(`   ${s}`)
console.log(`\nimplements / A: ${out.implements.instrumentA_grammarInventory.verdict}`)
console.log(`implements / B: ${heritageClauses} heritage clauses; shapes ${JSON.stringify(out.implements.instrumentB_heritageStructure.shapes)}; multi-supertype ${multiSupertypeClauses} (${multiSupertypeInsideError} inside an ERROR node); \`implements\` token ${implementsTokens.length}; anonymous tokens seen ${JSON.stringify(out.implements.instrumentB_heritageStructure.anonymousTokensInHeritage)}`)
console.log(`implements / D: JSDoc @implements ${jsdoc.implementsTags} in ${jsdoc.filesWithImplements} files; @extends ${jsdoc.extendsTags} in ${jsdoc.filesWithExtends} files (comments, not language)`)
console.log(`\nwrote ${OUT}`)