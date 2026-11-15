// script/m14/tmp/clean-127-oracle-shape.ts
//
// The clean lane has no F5 differential because no oracle derives its truth.
// Before writing one, the node shapes the oracle must key on are read off the
// PINNED v1.2.7 grammar rather than assumed from the v1.2.4-era analyzer
// comments: function_declaration's `name` field, application heads
// (qualified_identifier / constructor / identifier), the case_alternative
// pattern gate (is `arrow` a NAMED child?), import_declaration's `module`
// field, class_member -> type_signature -> signature_name, and
// instance_declaration's instance_class/constructor pair.
//
// Also runs RealCleanAnalyzer on a real Clyde file and prints its
// relationships, so the oracle's emission can be compared against the
// analyzer's on the same tree.
//
// Run: bun script/m14/tmp/clean-127-oracle-shape.ts
import { readFileSync } from "node:fs"
import path from "node:path"
import * as WTS from "web-tree-sitter"
import { RealCleanAnalyzer } from "../../../src/ast/real-clean-analyzer"

const ROOT = process.cwd()
const PINNED = path.join(ROOT, "wasm/tree-sitter-clean.wasm")

const CASES: [string, string][] = [
  ["module", `module demo\n`],
  ["import", `module demo\nimport StdEnv\nimport Data.Map as M\n`],
  ["function + call", `module demo\nf x = g (h x)\n`],
  ["qualified call", `module demo\nf x = M.lookup x m\n`],
  ["constructor app", `module demo\nf x = Just (Cons x [])\n`],
  ["case pattern", `module demo\nf x = case x of\n  Just y -> g y\n  Nothing -> h\n`],
  ["class", `module demo\nclass Eq a where\n  (==) infix 4 :: a a -> Bool\n`],
  ["instance", `module demo\ninstance Eq Int where\n  (==) a b = eq a b\n`],
  ["type + record", `module demo\n:: Point = { px :: Int, py :: Int }\n`],
  ["where local", `module demo\nf x = local x\nwhere\n  local y = g y\n`],
  ["multiclause", `module demo\nf 0 = a\nf n = b n\n`],
  ["instance plain member", `module demo\ninstance Eq Int where\n  eq a b = g a b\n`],
  ["class plain member", `module demo\nclass Eq a where\n  eq :: a a -> Bool\n`],
  ["ctor pattern head", `module demo\nf (Just x) = g x\nf Nothing = h\n`],
  ["nested case ctor body", `module demo\nf x = case x of\n  y -> Just y\n`],
  ["record construction", `module demo\nf x = { px = x, py = x }\n`],
  ["guard", `module demo\nf x | x == 0 = a\n    | otherwise = b\n`],
  ["lambda", `module demo\nf = \\x -> g x\n`],
  ["list comprehension", `module demo\nf xs = [g x \\ x <- xs]\n`],
]

const wts: any = WTS
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const lang = await L.load(readFileSync(PINNED))
const parser = new P()
parser.setLanguage(lang)

const dump = (n: any, depth = 0): string => {
  const pad = "  ".repeat(depth)
  const named: string[] = []
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c) named.push(c.type)
  }
  const fields: string[] = []
  for (let i = 0; i < n.childCount; i++) {
    const c = n.child(i)
    if (!c) continue
    const f = n.fieldNameForChild?.(i)
    if (f) fields.push(`${f}:${c.type}`)
  }
  const leaves = n.namedChildCount === 0 ? ` = ${JSON.stringify(n.text.slice(0, 40))}` : ""
  const line = `${pad}${n.type}${fields.length ? ` [${fields.join(", ")}]` : ""} (${named.length ? "" : "leaf"})${leaves}`
  const kids: string[] = []
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c) kids.push(dump(c, depth + 1))
  }
  return [line, ...kids].join("\n")
}

for (const [name, src] of CASES) {
  const tree = parser.parse(src)
  console.log(`### ${name}   errors=${tree.rootNode.hasError}`)
  console.log(dump(tree.rootNode))
  console.log()
}

// The analyzer's own view of a real file, for oracle/analyzer agreement triage.
const rel = process.env.CLEAN_PROBE_FILE ?? "Clyde/cleantools/Pm/PmPath.icl"
const full = path.join("/home/ishaq2321/bb_tests/repositories", rel)
const src = readFileSync(full, "utf8")
const tree = parser.parse(src)
const res = new RealCleanAnalyzer().analyze(tree.rootNode as any, src, full)
console.log(`### analyzer on ${rel}   errors=${tree.rootNode.hasError}`)
console.log(`symbols=${res.symbols.length} relationships=${res.relationships.length} imports=${res.imports.length}`)
for (const r of res.relationships) {
  console.log(`   ${String(r.type).padEnd(13)} ${r.source} -> ${r.target}`)
}
