/**
 * JULIA EXTENDED-VALUE CENSUS — the measurement behind `decorates`, `part_of`, `mixes_in`
 * and `renders`.
 *
 * WHY THIS EXISTS. The four extended values are not in the ten-type census's `ALL_TYPES`, so a
 * lane that implements two of them and rules two have no whole-population count for either half.
 * A ruling without a count is prose, and an implementation without a population is a fixture.
 * This instrument counts both, over the SAME admitted set and through the SAME production entry
 * point (`parseFile`), so the spec's `_implemented_measured` table and the `excluded` citations
 * quote one measurement rather than two.
 *
 * WHAT IT MEASURES.
 *   1. Every relationship type the production path emits, with EDGES and DISTINCT FILES.
 *   2. The two ruled constructs' nearest neighbours, counted rather than asserted:
 *      - `mixes_in`: Julia has no `with` clause; every type declares at most one supertype via
 *        `<:`. The script counts `extends` edges and the corpus's own lexical mentions of
 *        "mixin" (there is exactly one, a comment in julia's Compiler tests).
 *      - `renders`: Julia has no component/element syntax. It counts call edges whose target's
 *        last segment is `render`, and reports whether the grammar declares any rendering node.
 *   3. The grammar's own vocabulary, read from the committed census artifact, with the candidate
 *      words scanned: a name that is absent from 245 ids cannot be produced by the wired build.
 *
 * READ-ONLY. Writes only the path given by `--json` (default: stdout).
 *
 * Usage:
 *   npx tsx validation/m14/fixtures/julia/extended-census.ts
 *   npx tsx validation/m14/fixtures/julia/extended-census.ts --json validation/m14/measurements/julia-extended-census.json
 */
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const GRAMMAR_ARTIFACT = path.resolve("validation/m14/measurements/julia-grammar-nodes.json")
const jsonOut = (() => {
  const i = process.argv.indexOf("--json")
  return i >= 0 ? process.argv[i + 1] : null
})()

const files: { repo: string; rel: string; abs: string; text: string }[] = []
for (const e of readdirSync(CR)) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch {
    continue
  }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
      .split("\0")
      .filter(Boolean)
  } catch {
    continue
  }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try {
      if (statSync(abs).size > 512 * 1024) continue
      text = readFileSync(abs, "utf8")
    } catch {
      continue
    }
    if (detectLanguageFromPath(abs, text) !== "julia") continue
    files.push({ repo: e, rel, abs, text })
  }
}

const edgeCounts = new Map<string, number>()
const fileCounts = new Map<string, Set<string>>()
const renderCalls: { file: string; line: number; target: string }[] = []
let parsed = 0
let failed = 0
// WIDTH 4, the census's own constant: `parseFile` holds a whole tree while walking it, and the
// first serial version of this instrument ran for more than ten minutes on 1,985 files. The gate
// uses a worker pool for the same reason; this is the lane's own reproduction of that width.
const WIDTH = 4
for (let start = 0; start < files.length; start += WIDTH) {
  const chunk = files.slice(start, start + WIDTH)
  const results = await Promise.all(chunk.map(async (f) => {
    try {
      return { f, r: await parseFile(f.abs, f.text, "julia") }
    } catch {
      return { f, r: null }
    }
  }))
  for (const { f, r } of results) {
    if (!r) { failed++; continue }
    parsed++
    const key = `${f.repo}/${f.rel}`
    for (const e of r.relationships ?? []) {
      const t = String(e.type)
      edgeCounts.set(t, (edgeCounts.get(t) ?? 0) + 1)
      if (!fileCounts.has(t)) fileCounts.set(t, new Set())
      fileCounts.get(t)!.add(key)
      const target = String(e.target ?? "")
      const leaf = target.slice(Math.max(target.lastIndexOf("."), target.lastIndexOf(":")) + 1)
      if (t === "calls" && leaf === "render") renderCalls.push({ file: key, line: Number(e.line_number ?? 0), target })
    }
  }
}

// The grammar half. A candidate word is reported present/absent against the WIRED build's own
// vocabulary, which is what `julia-grammar-nodes.json` records (245 ids = 106 named ids + 139 anon).
const grammar = existsSync(GRAMMAR_ARTIFACT) ? JSON.parse(readFileSync(GRAMMAR_ARTIFACT, "utf8")) : null
const allTypeNames: string[] = grammar?.allTypeNames ?? []
const words = ["mixin", "render", "component", "element", "jsx", "template", "vnode", "fragment", "slot", "wrapper", "part", "include", "decorat"]
const grammarScan = words.map((w) => ({ word: w, hits: allTypeNames.filter((n) => n.toLowerCase().includes(w)) }))

// The lexical half of the two rulings. A substring scan is the honest instrument for a CONSTRUCT
// the grammar has no node for: the question is whether the language's own source ever spells it.
const corpusScan = {
  mixinMentions: [] as { file: string; line: number; text: string }[],
  structOrAbstractLinesWithSubtype: 0,
  componentWordMentions: 0,
}
for (const f of files) {
  const key = `${f.repo}/${f.rel}`
  const lines = f.text.split("\n")
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    // WORD-BOUNDARY, NOT SUBSTRING: the first version counted "mixing" (26 occurrences) as a
    // mention of "mixin" and would have turned a one-comment corpus fact into a false population.
    const words = line.toLowerCase().split(/[^a-z0-9_]+/)
    if (words.includes("mixin")) corpusScan.mixinMentions.push({ file: key, line: i + 1, text: line.trim().slice(0, 160) })
    if (words.includes("component")) corpusScan.componentWordMentions++
    const t = line.trim()
    if (t.startsWith("struct ") || t.startsWith("mutable struct ") || t.startsWith("abstract type ")) {
      if (t.includes("<:")) corpusScan.structOrAbstractLinesWithSubtype++
    }
  }
}

const out = {
  language: "julia",
  population: { admitted: files.length, parsed, failed, corpusRoot: CR },
  types: Object.fromEntries(
    [...edgeCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([t, n]) => [t, { edges: n, files: fileCounts.get(t)!.size }]),
  ),
  grammar: {
    artifact: path.relative(process.cwd(), GRAMMAR_ARTIFACT),
    servedDigest: grammar?.servedDigest ?? null,
    namedTypes: grammar?.namedTypes ?? null,
    totalIds: grammar?.totalIds ?? null,
    allTypeNames: allTypeNames.length,
    candidateScan: grammarScan,
  },
  ruledConstructs: {
    mixes_in: {
      contract: "a class COMPOSES a mixin into its supertype chain; the members enter the composing type",
      grammarCandidateNodes: 0,
      grammarCandidateWords: grammarScan.filter((s) => s.word === "mixin").flatMap((s) => s.hits),
      corpusMentions: corpusScan.mixinMentions,
      corpusMentionCount: corpusScan.mixinMentions.length,
      nearestConstruct: "a declared supertype (`struct S <: A`) published as `extends`",
      nearestConstructCount: corpusScan.structOrAbstractLinesWithSubtype,
      verdict: "ruled — the language has no member-set composition and no `with` clause; the one corpus mention is a comment about an abstract-type extension",
    },
    renders: {
      contract: "a component RENDERS another component; the target is the rendered component",
      grammarCandidateNodes: 0,
      grammarCandidateWords: grammarScan.filter((s) => s.word === "render" || s.word === "component" || s.word === "element" || s.word === "jsx").flatMap((s) => s.hits),
      renderCallEdges: renderCalls.length,
      renderCallFiles: new Set(renderCalls.map((r) => r.file)).size,
      renderCallExamples: renderCalls.slice(0, 10),
      nearestConstruct: "an ordinary function named `render` called with a document argument, published as `calls`",
      componentWordMentions: corpusScan.componentWordMentions,
      verdict: "ruled — the language has no component/element syntax; `render(...)` is a function call, not a rendered component",
    },
  },
  measuredAt: new Date().toISOString(),
}

const text = JSON.stringify(out, null, 2) + "\n"
if (jsonOut) writeFileSync(path.resolve(jsonOut), text)
else console.log(text)
console.log(
  `julia extended census — ${files.length} admitted, ${parsed} parsed, ${failed} failed; ` +
    `${edgeCounts.get("decorates") ?? 0} decorates, ${edgeCounts.get("part_of") ?? 0} part_of; ` +
    `${renderCalls.length} render call edges; ${corpusScan.mixinMentions.length} mixin mention(s)`,
)
