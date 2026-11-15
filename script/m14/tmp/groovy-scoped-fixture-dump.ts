// Dump every references edge for the scoped-type-references fixture, plus the
// parse shape of the `as` coercion line, so a missing edge is explained by the
// tree rather than guessed at.
import * as fs from "fs"
import { RealGroovyAnalyzer } from "../../../src/ast/real-groovy-analyzer"

const SRC = fs.readFileSync("validation/m14/fixtures/groovy/scoped-type-references.groovy", "utf8")

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const lang = await L.load(fs.readFileSync("wasm/tree-sitter-groovy.wasm"))
  const parser = new P()
  parser.setLanguage(lang)
  const tree = parser.parse(SRC)

  // Shape of every node on the coercion line.
  const line = 14
  const stack: any[] = [tree.rootNode]
  while (stack.length) {
    const n = stack.pop()!
    if (n.startPosition.row + 1 === line && (n.childCount === 0 || n.type === "binary_expression" || n.type === "local_variable_declaration" || n.type === "variable_declarator")) {
      process.stdout.write(`  tree ${n.type} [${n.startPosition.column}-${n.endPosition.column}] text=${JSON.stringify(n.text)} fields={left:${JSON.stringify(n.childForFieldName?.("left")?.type ?? null)},operator:${JSON.stringify(n.childForFieldName?.("operator")?.text ?? null)},type:${JSON.stringify(n.childForFieldName?.("type")?.type ?? null)}}\n`)
    }
    for (let i = 0; i < n.childCount; i++) stack.push(n.child(i)!)
  }

  const az: any = new RealGroovyAnalyzer()
  const res: any = az.analyze(tree.rootNode, SRC, "scoped-type-references.groovy")
  const refs = (res.relationships ?? []).filter((r: any) => String(r.type) === "references")
  process.stdout.write(`references edges: ${refs.length}\n`)
  for (const r of refs) {
    process.stdout.write(`  ${r.source} -> ${r.target}  line=${r.line_number} ${JSON.stringify(r.metadata ?? {})}\n`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
