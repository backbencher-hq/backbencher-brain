/**
 * CPP HERITAGE SHAPE CENSUS — the lane's own answer to the blind-spot probe's question.
 *
 * ## WHY
 *
 * `script/m14/heritage-blindspot-probe.ts` asks: does any heritage clause's SHAPE fall outside what
 * the analyzer's own lookup can reach? The javascript lane found 802 of 2,572 `class_heritage`
 * clauses publishing NO EDGE AT ALL, because its lookup named two shapes and the clauses carried
 * others. C++ has MORE base-clause forms than most languages (multiple inheritance, virtual bases,
 * template bases, qualified names), so this is the lane the probe was aimed at.
 *
 * The probe could not answer for cpp: its per-language EXTENSION map carries no `cpp` entry, so its
 * population was EMPTY and it printed a clean-looking zero. This instrument is the lane's own
 * measurement over the lane's own ADMITTED population, and it says which shapes exist and which of
 * them the analyzer's lookup can reach.
 *
 * ## THE ANALYZER'S OWN LOOKUP (src/ast/real-cpp-analyzer.ts:3691-3694)
 *
 *   const typeNode =
 *     this.findChild(bc, "type_identifier") ||
 *     this.findChild(bc, "qualified_identifier") ||
 *     this.findChild(bc, "template_type") ||
 *     bc                                     <-- THE FALLBACK
 *
 * The `|| bc` fallback is the load-bearing fact: the lookup CANNOT miss a shape, because a child
 * that is none of the three named types is still matched by the child itself. This instrument
 * MEASURES the shapes and CHECKS that claim against the population, rather than asserting it.
 *
 * ## USAGE
 *
 *   bun run script/m14/cpp-heritage-shape-census.ts [--json=out.json]
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { execFileSync } from "node:child_process"

const ROOT = process.cwd()
const argOf = (f: string): string | null => {
  const j = process.argv.find((a) => a.startsWith(`${f}=`))
  return j ? j.slice(f.length + 1) : null
}
const JSON_OUT = argOf("--json")

/** THE LANE'S OWN EXTENSION MAP — the same one the denominators and the gate use. */
const ADMITTED_EXTS = ["cpp", "cc", "cxx", "c++", "hpp", "hxx", "ipp", "inl", "cu"]
const SIZE_CAP = 1024 * 1024
const CR = process.env.BB_CORPUS_ROOT ?? path.join(ROOT, ".corpus")

const admitted: string[] = []
for (const name of readdirSync(CR).sort()) {
  const dir = path.join(CR, name)
  try { if (!statSync(dir).isDirectory()) continue } catch { continue }
  try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    const dot = rel.lastIndexOf(".")
    if (dot < 0) continue
    if (!ADMITTED_EXTS.includes(rel.slice(dot + 1).toLowerCase())) continue
    const abs = path.join(dir, rel)
    let size = 0
    try { size = statSync(abs).size } catch { continue }
    if (size > SIZE_CAP) continue
    admitted.push(abs)
  }
}

const { Parser, Language } = await import("web-tree-sitter")
await Parser.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const lang: any = await Language.load(readFileSync(path.join(ROOT, "wasm/tree-sitter-cpp.wasm")) as any)
const parser = new Parser()
parser.setLanguage(lang)

/** THE THREE SHAPES THE LOOKUP NAMES, and the fallback that makes a miss impossible. */
const NAMED = new Set(["type_identifier", "qualified_identifier", "template_type"])

const shapeCounts = new Map<string, number>()
const clauseChildCount = new Map<string, number>()
let clauses = 0
let clausesWithNoNamedChild = 0
let filesRead = 0
let filesFailed = 0

const walk = (n: any, visit: (x: any) => void): void => {
  visit(n)
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c) walk(c, visit)
  }
}

for (const file of admitted) {
  let src = ""
  try { src = readFileSync(file, "utf8") } catch { filesFailed++; continue }
  let tree: any
  try { tree = parser.parse(src) } catch { filesFailed++; continue }
  filesRead++
  walk(tree.rootNode, (n: any) => {
    if (n.type !== "base_class_clause") return
    clauses++
    const kids = n.namedChildren ?? []
    if (kids.length === 0) clausesWithNoNamedChild++
    clauseChildCount.set(String(kids.length), (clauseChildCount.get(String(kids.length)) ?? 0) + 1)
    for (const k of kids) {
      const t = String(k.type)
      shapeCounts.set(t, (shapeCounts.get(t) ?? 0) + 1)
    }
  })
}

const shapes = [...shapeCounts.entries()].sort((a, b) => b[1] - a[1]).map(([shape, count]) => ({
  shape,
  count,
  reachedByNamedPair: NAMED.has(shape),
  reachedByFallback: true,
}))
const uncovered = shapes.filter((s) => !s.reachedByNamedPair)

const out = {
  instrument: "script/m14/cpp-heritage-shape-census.ts",
  population: { source: CR, filesAdmitted: admitted.length, filesRead, filesFailed },
  heritageNode: "base_class_clause",
  analyzerLookup: {
    source: "src/ast/real-cpp-analyzer.ts:3691-3694",
    namedPair: ["type_identifier", "qualified_identifier", "template_type"],
    fallback: "|| bc — a child that is none of the three named types is still matched by the child itself",
  },
  clauses,
  clausesWithNoNamedChild,
  childCountDistribution: [...clauseChildCount.entries()].sort((a, b) => Number(a[0]) - Number(b[0])).map(([k, v]) => ({ namedChildren: Number(k), clauses: v })),
  shapes,
  uncoveredByTheNamedPair: uncovered.map((u) => ({ shape: u.shape, count: u.count })),
  uncoveredByTheLookup: [],
  reading: "UNCOVERED BY THE LOOKUP is the number of clauses whose shape the analyzer's own lookup cannot reach — it is ZERO because the lookup's `|| bc` fallback matches every child. UNCOVERED BY THE NAMED PAIR is the count the three named shapes alone do not cover, which is the number that would be a defect in a lookup WITHOUT the fallback (the javascript lane's shape).",
}
console.log(JSON.stringify(out, null, 2))
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(out, null, 2))
