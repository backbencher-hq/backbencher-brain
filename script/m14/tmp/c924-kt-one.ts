// c924-kt-one — dump ONE kotlin file's truth rows and analyzer rows, side by side.
//
// The 60-file full-extent draw reads MISSING=1 on the landed (#924) tree and MISSING=0 on the
// unpatched baseline, for the same sample hash, with identical analyzer-edge counts:
//
//   [kotlin] 1 MISSING — calls (expr) -> `in`
//     (exposed-r2dbc/src/main/kotlin/org/jetbrains/exposed/v1/r2dbc/mappers/BinaryTypeMapper.kt)
//
// A one-row difference cannot be read off the lane total, and the sample set is the ONLY handle
// the harness prints. This reproduces the comparison on the named file so the row can be
// attributed to a side instead of guessed at.
//
// Run: bun script/m14/tmp/c924-kt-one.ts <kotlinFile> [repoRoot]
import * as fs from "node:fs"
import * as path from "node:path"

const HERE = path.resolve(import.meta.dirname ?? ".")
const { RealKotlinAnalyzer } = await import("../../../src/ast/real-kotlin-analyzer")
const mod: any = await import("../../../script/m14/differential")

const lastSegment = (name: string): string => {
  const parts = name.split(/::|\./).filter(Boolean)
  return parts[parts.length - 1] ?? name
}
const normTarget = (t: string): string =>
  lastSegment(String(t).replace(/<.*$/, "").replace(/\[.*$/, "").trim())

const wts: any = await import("web-tree-sitter")
const P: any = wts.Parser ?? wts.default ?? wts
const L: any = wts.Language ?? wts.default?.Language
const TREE = path.resolve(HERE, "../..", "..")
await P.init({ locateFile: () => path.join(TREE, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const LANG: any = await L.load(fs.readFileSync(path.join(TREE, "wasm", "tree-sitter-kotlin.wasm")))

const file = process.argv[2]
if (!file) throw new Error("usage: c924-kt-one.ts <kotlinFile> [repoRoot]")
const repoRoot = process.argv[3] ?? path.resolve(file.split("/src/")[0] ?? "/")
const content = fs.readFileSync(file, "utf8")
const p = new P()
p.setLanguage(LANG)
const root = p.parse(content).rootNode
const r: any = await new RealKotlinAnalyzer().analyze(root, content, path.relative(repoRoot, file))

const rels = (r.relationships ?? []).map((x: any) => ({ label: String(x.type).toLowerCase(), target: String(x.target) }))
const truth: any[] = [...mod.deriveTreeEdges(root, "kotlin"), ...mod.deriveKotlinEdges(root)]

// Which ORACLE owns a row is the question when the two disagree with each other: the harness sums
// both (tree walker + dedicated calls oracle), so a spelling difference BETWEEN them is invisible
// in the lane total.
const treeRows: any[] = mod.deriveTreeEdges(root, "kotlin")
const kotlinRows: any[] = mod.deriveKotlinEdges(root)
console.log(`oracle split: deriveTreeEdges=${treeRows.length} deriveKotlinEdges=${kotlinRows.length}`)
for (const [name, set] of [["deriveTreeEdges", treeRows], ["deriveKotlinEdges", kotlinRows]] as const) {
  for (const e of set) if (String(e.target).includes("in")) console.log(`  [${name}] ${e.label} ${e.from ?? "?"} -> ${JSON.stringify(String(e.target))}`)
}

console.log(`file=${path.relative(repoRoot, file)}  symbols=${(r.symbols ?? []).length}  truth=${truth.length}  analyzer-edges=${rels.length}`)
console.log("--- truth rows mentioning 'in' ---")
for (const te of truth) if (String(te.target).includes("in")) console.log(`  ${te.label} ${te.from ?? "?"} -> ${JSON.stringify(String(te.target))}`)
console.log("--- analyzer rows mentioning 'in' ---")
for (const x of rels) if (x.target.includes("in")) console.log(`  ${x.label} -> ${JSON.stringify(x.target)}`)

let matched = 0
const unmatched: any[] = []
for (const te of truth) {
  const hit = rels.some((x: any) => x.label === String(te.label).toLowerCase() && normTarget(x.target) === normTarget(te.target))
  if (hit) matched++
  else unmatched.push(te)
}
console.log(`matched=${matched}/${truth.length}`)
for (const u of unmatched) console.log(`  MISSING ${u.label} ${u.from ?? "?"} -> ${JSON.stringify(String(u.target))}`)
// Direction of a near-miss (same leaf, different spelling) is the whole question here: it tells
// whether the row is a lockstep break or a genuinely dropped edge.
for (const u of unmatched) {
  const leaf = normTarget(String(u.target))
  const near = rels.filter((x: any) => normTarget(x.target) === leaf || leaf.replace(/^`|`$/g, "") === normTarget(x.target))
  console.log(`  near-miss for ${JSON.stringify(String(u.target))}: ${near.length ? JSON.stringify(near) : "(analyzer publishes nothing with that leaf)"}`)
}
