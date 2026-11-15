/**
 * ONE EDGE'S PROVENANCE — why does this target read `unresolved`?
 *
 * A count cannot be argued with, and it also cannot be acted on. When the gate names ONE
 * unresolved target, the next question is which emission branch produced it and what the
 * file's own published names were at that moment. This file answers exactly that for one
 * (file, target) pair, using production's `parseFile`, and prints the candidate
 * explanations as DATA rather than as a conclusion:
 *
 *   - every edge whose target contains the target string, with its marker set
 *   - whether the target itself is a published symbol NAME of the file
 *   - for each contribution the file makes to the target's spelling, the site
 *   - the `resolves()` inputs the chain gate reads, enumerated: the exact name, the
 *     dotted leaf, and every `:`/`.` boundary tail of the target, each with whether the
 *     file publishes it. The predicate in `real-css-analyzer.ts` accepts the target if
 *     ANY of those is published; this prints which one (if any) said yes — so a
 *     suffix-collision (`button` satisfying `.button`) is visible as a fact rather than
 *     inferred from the code.
 *
 * The enumeration is a DIAGNOSTIC of the analyzer's own predicate, not a second copy of
 * the decision: nothing here decides anything, and the edge list printed above it comes
 * from the analyzer itself, so a divergence between the two would be visible in the same
 * output rather than hidden behind a copy.
 *
 * Usage:
 *   npx tsx validation/m14/fixtures/css/single-file-dump.ts <repo-relative-or-abs .css> <target-substring>
 */
import { readFileSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { parseFile } from "../../../../src/ast/pool-worker"
import { getParser } from "../../../../src/ast/engine"
import { RealCssAnalyzer } from "../../../../src/ast/real-css-analyzer"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..")
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const argv = process.argv.slice(2)
const fileArg = argv[0]
const needle = argv[1] ?? ""
if (!fileArg) {
  console.error("usage: single-file-dump.ts <file.css> <target-substring>")
  process.exit(2)
}
const abs = path.isAbsolute(fileArg) ? fileArg : path.join(CR, fileArg)
const rel = abs.startsWith(CR + path.sep) ? abs.slice(CR.length + 1) : abs
const repo = abs.startsWith(CR + path.sep) ? path.join(CR, rel.split(path.sep)[0]) : path.dirname(abs)

const text = readFileSync(abs, "utf8")
const r: any = await parseFile(abs, repo, { projectRoot: repo } as any)

const names = new Set<string>()
const scoped = new Set<string>()
for (const s of r.symbols ?? []) {
  names.add(String(s.name))
  if (s.scope) scoped.add(`${s.scope}.${s.name}`)
  if (s.qualifiedName) scoped.add(String(s.qualifiedName))
}

console.log(`file:   ${rel}`)
console.log(`bytes:  ${text.length}`)
console.log(`parsed: ${(r.symbols ?? []).length} symbols, ${(r.relationships ?? []).length} relationships, analysisVersion ${r.metadata?.analysisVersion}`)
console.log(``)

// ---------------------------------------------------------------------------------------
// WHAT PRODUCTION DELIVERS vs WHAT THE ANALYZER EMITTED.
//
// `parseFile` is not a pass-through: it runs `filterNoiseRelationships` (pool-worker.ts:683),
// whose NOISE_TARGETS block drops an edge whose target's LEAF is a tree-sitter accessor
// name (`type`, `text`, `parent`, `firstChild`, …) or a hyphenated CSS property, UNLESS the
// file itself declares that name. Measured over the whole corpus, that is the ONE difference
// between the census's `analyze()` walk (238,585 `contains`) and the incoming gate's
// `parseFile` walk (235,080) — every other type matches to the edge. Printed here per file so
// a count that disagrees between two instruments can be attributed instead of argued about.
// ---------------------------------------------------------------------------------------
{
  const parser = await getParser("css")
  const tree = await parser.parse(text, abs)
  const direct: any = new RealCssAnalyzer().analyze(tree.rootNode, text, abs)
  const tally = (rs: any[]): Record<string, number> => {
    const m: Record<string, number> = {}
    for (const x of rs) m[x.type] = (m[x.type] ?? 0) + 1
    return m
  }
  const key = (x: any) => `${x.type}\u0000${x.source}\u0000${x.target}\u0000${JSON.stringify(x.metadata ?? {})}`
  const delivered = new Set((r.relationships ?? []).map(key))
  const dropped = (direct.relationships ?? []).filter((x: any) => !delivered.has(key(x)))
  console.log(`analyze() emitted : ${(direct.relationships ?? []).length} relationships  ${JSON.stringify(tally(direct.relationships ?? []))}`)
  console.log(`parseFile() gave  : ${(r.relationships ?? []).length} relationships  ${JSON.stringify(tally(r.relationships ?? []))}`)
  console.log(`production dropped: ${dropped.length}  ${JSON.stringify(tally(dropped))}`)
  for (const x of dropped.slice(0, 8)) console.log(`    ${x.type} ${JSON.stringify(x.source)} -> ${JSON.stringify(x.target)}`)
  console.log(``)
}
console.log(`EDGES WHOSE TARGET CONTAINS ${JSON.stringify(needle)}`)
for (const e of r.relationships ?? []) {
  const t = String(e.target ?? "")
  if (t.indexOf(needle) === -1) continue
  const md = e.metadata ?? {}
  const keys = Object.keys(md).filter((k) => k !== "evidenceClass" && k !== "analysisVersion").sort()
  console.log(`  ${String(e.type).padEnd(10)} ${JSON.stringify(e.source).slice(0, 40).padEnd(40)} -> ${JSON.stringify(t).padEnd(40)} [${keys.join("+")}]`)
}
console.log(``)
console.log(`SYMBOLS WHOSE NAME CONTAINS ${JSON.stringify(needle)} (first 40)`)
let shown = 0
for (const s of r.symbols ?? []) {
  const n = String(s.name)
  if (n.indexOf(needle) === -1) continue
  if (shown++ >= 40) break
  console.log(`  ${String(s.kind).padEnd(10)} ${JSON.stringify(n).slice(0, 60).padEnd(60)} line ${s.range?.start?.line ?? "?"} scope ${JSON.stringify(s.scope ?? "")}`)
}
console.log(`  … ${shown} shown of ${(r.symbols ?? []).filter((s: any) => String(s.name).indexOf(needle) !== -1).length}`)
console.log(``)
console.log(`IS THE TARGET ITSELF A PUBLISHED NAME?`)
console.log(`  names.has(${JSON.stringify(needle)}) = ${names.has(needle)}`)
console.log(``)
console.log(`THE CHAIN GATE'S OWN SUB-TESTS for ${JSON.stringify(needle)} (any one being published satisfies it)`)
const leafOf = (n: string): string => {
  const segs = n.split(":").filter((x) => x.length > 0)
  const last = segs[segs.length - 1] ?? ""
  const dots = last.split(".")
  return dots[dots.length - 1]
}
console.log(`  exact name          ${JSON.stringify(needle)}  published=${names.has(needle)}`)
console.log(`  dotted leaf         ${JSON.stringify(leafOf(needle))}  published=${names.has(leafOf(needle))}`)
for (let i = 0; i < needle.length; i++) {
  const c = needle[i]
  if (c !== ":" && c !== ".") continue
  const tail = needle.slice(i + 1)
  if (tail.length === 0) continue
  console.log(`  boundary tail @${i}   ${JSON.stringify(tail)}  published=${names.has(tail)}`)
}
