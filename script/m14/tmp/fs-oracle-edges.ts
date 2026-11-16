/**
 * script/m14/tmp/fs-oracle-edges.ts — run ONLY the fsharp oracle on one file and
 * print its edges by label. The differential's rows are the authority; this is
 * the microscope for a disagreement.
 *
 * Run: bun script/m14/tmp/fs-oracle-edges.ts [file] [label]
 */
import * as fs from "fs"
import * as path from "path"

const ROOT = path.resolve(import.meta.dir ?? path.dirname(Bun.main), "..", "..", "..")
const FILE = process.argv[2] ?? "<corpus-root>/bb_tests/repositories/fsharp/src/Compiler/Service/FSharpProjectSnapshot.fs"
const LABEL = process.argv[3]

const { deriveFsharpEdges } = await import("../fsharp-truth-oracle")

async function main() {
  const { Parser, Language } = await import("web-tree-sitter")
  await Parser.init()
  const parser = new Parser()
  parser.setLanguage(await Language.load(new Uint8Array(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-fsharp.wasm")))))
  const tree = parser.parse(fs.readFileSync(FILE, "utf8"))!
  const edges = deriveFsharpEdges(tree.rootNode, [])
  const byLabel: Record<string, number> = {}
  for (const e of edges) byLabel[e.label] = (byLabel[e.label] ?? 0) + 1
  console.log(`file=${FILE}`)
  console.log(`total=${edges.length} byLabel=${JSON.stringify(byLabel)}`)
  for (const e of edges) {
    if (LABEL && e.label !== LABEL) continue
    console.log(`  ${e.label} ${e.from} -> ${e.target}`)
  }
  tree.delete()
}

await main()
