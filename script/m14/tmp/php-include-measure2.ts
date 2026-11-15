// Measure validation/m14/fixtures/php/include-paths.php after the composed-path
// fix, so the expectation is authored from the measurement.
import * as fs from "fs"
import { RealPhpAnalyzer } from "../../../src/ast/real-php-analyzer"

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const lang = await L.load(fs.readFileSync("wasm/tree-sitter-php.wasm"))
  const parser = new P()
  parser.setLanguage(lang)
  const path = "validation/m14/fixtures/php/include-paths.php"
  const source = fs.readFileSync(path, "utf8")
  const tree = parser.parse(source)
  let errs = 0
  const st = [tree.rootNode]
  while (st.length) {
    const n = st.pop()!
    if (n.type === "ERROR" || n.isMissing) errs++
    for (let i = 0; i < n.childCount; i++) st.push(n.child(i)!)
  }
  process.stdout.write(`parse errors: ${errs}\n`)
  const az: any = new RealPhpAnalyzer()
  const res: any = az.analyze(tree.rootNode, source, path)
  process.stdout.write(`imports:\n`)
  for (const i of res.imports ?? []) process.stdout.write(`  ${JSON.stringify(i.module)}  ${JSON.stringify(i.metadata)}\n`)
  process.stdout.write(`references:\n`)
  for (const r of res.relationships ?? []) {
    if (String(r.type) === "references") process.stdout.write(`  ${JSON.stringify(r.source)} -> ${JSON.stringify(r.target)}\n`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
