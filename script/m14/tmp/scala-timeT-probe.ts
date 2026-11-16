// Ground truth on the real #855 site: does TimeT.scala parse cleanly, what does
// the analyzer emit for lines 130-162, and what does the tree look like there?
import * as fs from "fs"
import * as path from "path"
const ROOT = "<corpus-root>/mcp/backbencher-brain"
const FILE =
  "<corpus-root>/bb_tests/repositories/cats-effect/kernel-testkit/shared/src/main/scala/cats/effect/kernel/testkit/TimeT.scala"

const text = fs.readFileSync(FILE, "utf8")
const lines = text.split("\n")

// --- 1. parser-level truth -------------------------------------------------
const WTS: any = await import("web-tree-sitter")
const P = WTS.default ?? WTS
const { Parser, Language } = P
await (P.init ?? Parser.init).call(P, {
  locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm"),
})
const lang = await Language.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-scala.wasm")))
const parser = new Parser()
parser.setLanguage(lang)
const tree = parser.parse(text)
console.log(`parser: hasError=${tree.rootNode.hasError}`)
const errs: string[] = []
;(function collect(n: any): void {
  if (n.type === "ERROR" || n.isMissing)
    errs.push(
      `${n.type}${n.isMissing ? " MISSING" : ""} [${n.startPosition.row + 1}:${n.startPosition.column}-${n.endPosition.row + 1}:${n.endPosition.column}] ${JSON.stringify(n.text.slice(0, 50))}`,
    )
  for (let i = 0; i < n.childCount; i++) collect(n.child(i))
})(tree.rootNode)
console.log(`parser: ${errs.length} ERROR/MISSING node(s)`)
for (const e of errs.slice(0, 10)) console.log("   " + e)

// tree shape for the region
console.log("\n--- tree nodes intersecting lines 140-150 ---")
;(function walk(n: any, d: number): void {
  const s = n.startPosition.row + 1
  const e = n.endPosition.row + 1
  if (e >= 140 && s <= 150 && n.named)
    console.log(
      "   " +
        "  ".repeat(Math.min(d, 12)) +
        `${n.type} [${s}:${n.startPosition.column}-${e}:${n.endPosition.column}]`,
    )
  for (let i = 0; i < n.childCount; i++) walk(n.child(i), d + 1)
})(tree.rootNode, 0)

// --- 2. analyzer truth ----------------------------------------------------
const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
const res: any = await ASTEngine.parseFile(FILE, text)
const rels = (res.relationships ?? []).filter(
  (r: any) => (r.line_number ?? 0) >= 128 && (r.line_number ?? 0) <= 162,
)
console.log(`\n--- analyzer relationships with line in [128,162]: ${rels.length} ---`)
for (const r of rels.slice().sort((a: any, b: any) => (a.line_number ?? 0) - (b.line_number ?? 0)))
  console.log(
    `   ${String(r.line_number).padStart(4)}  ${String(r.type).padEnd(12)} ${String(r.source).padEnd(16)} -> ${String(r.target).padEnd(18)}`,
  )
console.log(`\n--- all analyzer 'calls' edges whose line is in [140,162] ---`)
for (const r of (res.relationships ?? []).filter(
  (r: any) => r.type === "calls" && (r.line_number ?? 0) >= 140 && (r.line_number ?? 0) <= 162,
))
  console.log(`   ${r.line_number}  ${r.source} -> ${r.target}`)
console.log("\n--- source lines 144-152 ---")
for (let i = 143; i < 152; i++) console.log(`   ${i + 1}| ${lines[i]}`)
