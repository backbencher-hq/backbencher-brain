import * as fs from "fs"
import * as WTS from "web-tree-sitter"
import { deriveTypeScriptReferencesTruth } from "../oracles/typescript-references"
const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
async function main() {
  const wts: any = WTS
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init()
  const lang = await L.load(`${ROOT}/wasm/tree-sitter-typescript.wasm`)
  const f = `${ROOT}/ide/vscode/src/auto-index.ts`
  const src = fs.readFileSync(f, "utf8")
  const p = new P(); p.setLanguage(lang)
  const tree = p.parse(src)
  const edges = deriveTypeScriptReferencesTruth(tree.rootNode)
  for (const want of [["IndexRunner","root"],["IndexRunner","env"],["AutoIndexMachine","consent"]]) {
    const hit = edges.find((e) => e.from === want[0] && e.target === want[1])
    console.log(`${want[0]} -> ${want[1]}: ${hit ? "ORACLE EMITS" : "oracle silent"}`)
  }
  // what does the file actually write around IndexRunner's body?
  const lines = src.split("\n")
  const idx = lines.findIndex((l) => /type IndexRunner/.test(l))
  console.log(`\ntype IndexRunner (line ${idx + 1}):`)
  for (let i = idx; i < Math.min(idx + 12, lines.length); i++) console.log(`  ${i + 1}: ${lines[i]}`)
  const m = lines.findIndex((l) => /AutoIndexMachine/.test(l))
  console.log(`\nAutoIndexMachine (line ${m + 1}):`)
  for (let i = m; i < Math.min(m + 10, lines.length); i++) console.log(`  ${i + 1}: ${lines[i]}`)
}
main()
