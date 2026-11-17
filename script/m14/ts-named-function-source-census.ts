#!/usr/bin/env bun
// TS NAMED-FUNCTION SOURCE CENSUS — how many rows the named-function-expression parity moves.
//
// ## Why this instrument
//
// The JS-twin parity fix (2026-11-17) makes a NAMED function expression its own read/call actor:
// reads and calls inside `const inner = function handler() { outerRead(x) }` are sourced to
// `handler`, not to the enclosing `outer` (real.function_expression actors, published symbol when
// one exists, synthetic source actor otherwise). The claim "this fixes rows" is a claim about a
// POPULATION, so it is answered by a count over a derived population — this file.
//
// It measures, per sampled file: the number of named function expressions, how many of their names
// are ALSO published symbols (the published branch of the fix), and how many emitted relationships
// are now sourced to a named expression's own name where no symbol carries it (the synthetic
// branch's rows — exactly the rows that were charged to an enclosing actor before the fix). A
// pre-fix comparison is not stored: the fix is one expression, the fixture
// `typescript/named-function-expression-source` pins its behaviour both ways (positive rows +
// anonymous control), and the moved-row count is the size of the correction.
//
// Population rule: the lane's own admission walk over the named repository's tracked files
// (`ts-corpus.ts` is imported rather than re-implemented), the same SIZE_CAP, and a deterministic
// stride printed with the run. No regex — extension and string tests only.
//
// Usage:
//   BB_CORPUS_ROOT=$HOME/bb_tests/repositories bun run script/m14/ts-named-function-source-census.ts [repo] [maxFiles] [--json path]
import { execFileSync } from "node:child_process"
import { readFileSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { SIZE_CAP } from "./ts-corpus"

const REPO_ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const CR = process.env.BB_CORPUS_ROOT ?? join(process.env.HOME ?? "", "bb_tests/repositories")
const argv = process.argv.slice(2)
const jsonIdx = argv.indexOf("--json")
const JSON_OUT = jsonIdx >= 0 ? argv[jsonIdx + 1] : null
const rest = argv.filter((a) => !a.startsWith("--"))
const REPO = rest[0] ?? "gql-graphql-mesh"
const MAX_FILES = Number(rest[1] ?? 400)

const repoDir = join(CR, REPO)
let tracked: string[] = []
try {
  tracked = execFileSync("git", ["-C", repoDir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
    .split("\0")
    .filter(Boolean)
} catch {
  console.error(`no corpus repository at ${repoDir} — UNMEASURED is not a zero`)
  process.exit(2)
}
const files = tracked.filter((rel) => {
  if (!rel.endsWith(".ts") && !rel.endsWith(".tsx")) return false
  try {
    return statSync(join(repoDir, rel)).size <= SIZE_CAP
  } catch {
    return false
  }
})
if (files.length === 0) {
  console.error(`no admitted .ts/.tsx file under ${repoDir} — UNMEASURED is not a zero`)
  process.exit(2)
}
const stride = Math.max(1, Math.floor(files.length / Math.max(1, MAX_FILES)))
const sample = files.filter((_, i) => i % stride === 0).slice(0, MAX_FILES)

const engine: any = await import(join(REPO_ROOT, "src/ast/engine"))
const analyzerModule: any = await import(join(REPO_ROOT, "src/ast/real-typescript-analyzer"))
const analyzer: any = new analyzerModule.RealTypeScriptAnalyzer()

let filesParsed = 0
let parseFailed = 0
let namedFnSites = 0
let publishedNameSites = 0
let edges = 0
let movedRows = 0
const samples: string[] = []

for (const rel of sample) {
  let src: string
  try {
    src = readFileSync(join(repoDir, rel), "utf8")
  } catch {
    parseFailed++
    continue
  }
  let parser: any
  try {
    parser = await engine.getParser(rel.endsWith(".tsx") ? "tsx" : "typescript")
  } catch {
    parseFailed++
    continue
  }
  const tree = parser.parse(src)
  if (tree.rootNode.hasError) {
    parseFailed++
    try { tree.delete?.() } catch {}
    continue
  }
  filesParsed++
  const result: any = await analyzer.analyze(tree.rootNode, src, rel)
  const symbolNames = new Set<string>((result.symbols ?? []).map((s: any) => String(s.name ?? "")))
  const named: string[] = []
  const walk = (node: any): void => {
    if (node.type === "function_expression") {
      const nameNode = node.childForFieldName?.("name")
      const name = nameNode?.text
      if (name) {
        named.push(String(name))
        namedFnSites++
        if (symbolNames.has(String(name))) publishedNameSites++
      }
    }
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child) walk(child)
    }
  }
  walk(tree.rootNode)
  const namedSet = new Set(named)
  for (const edge of result.relationships ?? []) {
    edges++
    const source = String(edge.source ?? "")
    if (namedSet.has(source) && !symbolNames.has(source)) {
      movedRows++
      if (samples.length < 10) samples.push(`${rel}: ${edge.type} ${source} -> ${String(edge.target ?? "")}`)
    }
  }
  try { tree.delete?.() } catch {}
}

const report = {
  instrument: "script/m14/ts-named-function-source-census.ts",
  repo: REPO,
  corpusRoot: CR,
  population: { trackedTs: files.length, sampled: sample.length, stride, filesParsed, parseFailed },
  namedFnSites,
  publishedNameSites,
  edges,
  rowsNowAttributedToOwnName: movedRows,
  samples,
  note: "rowsNowAttributedToOwnName counts emitted rows sourced to a named function expression's own name with no published symbol of that name — the synthetic branch's size, i.e. the rows that were charged to an enclosing actor before the 2026-11-17 parity fix. A name that IS a published symbol takes the published branch and is not counted here.",
}
console.log(JSON.stringify(report, null, 1))
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(report, null, 2) + "\n")
