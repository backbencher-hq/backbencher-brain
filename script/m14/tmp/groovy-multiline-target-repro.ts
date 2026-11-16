// Repro: the census dump showed a declared_type target whose TEXT spans two
// source lines — `org.springframework.http.HttpStatus.*` glued to the NEXT
// import statement — on grails-scaffolding's AsyncController template. It is
// POST-change only (the pre dump has no such row), so it is my own regression:
// the scoped branch publishes `n.text` and never checks that the node's text is
// a single dotted NAME.
import * as fs from "fs"
import { RealGroovyAnalyzer } from "../../../src/ast/real-groovy-analyzer"

const FILE =
  "<corpus-root>/bb_tests/repositories/grails-core/grails-scaffolding/src/main/templates/scaffolding/AsyncController.groovy"

async function main() {
  const SRC = fs.readFileSync(FILE, "utf8")
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const lang = await L.load(fs.readFileSync("wasm/tree-sitter-groovy.wasm"))
  const parser = new P()
  parser.setLanguage(lang)
  const tree = parser.parse(SRC)

  // Every scoped_type_identifier in the file, with span + text + parent.
  const stack = [tree.rootNode]
  while (stack.length) {
    const n = stack.pop()!
    if (n.type === "scoped_type_identifier") {
      process.stdout.write(
        `SCOPED parent=${n.parent?.type} span=${n.startPosition.row + 1}:${n.startPosition.column}-${n.endPosition.row + 1}:${n.endPosition.column}\n` +
          `   text=${JSON.stringify(n.text)}\n`,
      )
      const kids: string[] = []
      for (let i = 0; i < n.namedChildCount; i++) kids.push(`${n.namedChild(i)!.type}=${JSON.stringify(n.namedChild(i)!.text)}`)
      process.stdout.write(`   namedChildren: ${kids.join(", ")}\n`)
    }
    for (let i = 0; i < n.childCount; i++) stack.push(n.child(i)!)
  }

  const az: any = new RealGroovyAnalyzer()
  const res: any = az.analyze(tree.rootNode, SRC, FILE)
  const refs = (res.relationships ?? []).filter((r: any) => String(r.type) === "references")
  process.stdout.write(`\nreferences edges: ${refs.length}\n`)
  for (const r of refs) {
    const t = String(r.target ?? "")
    if (t.indexOf("HttpStatus") !== -1 || t.indexOf("TransactionStatus") !== -1 || t.indexOf("\n") !== -1) {
      process.stdout.write(`  ${JSON.stringify(r.source)} -> ${JSON.stringify(t)} line=${r.line_number} ${JSON.stringify(r.metadata ?? {})}\n`)
    }
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
