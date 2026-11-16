// #866: dump the REAL analyzer output for the four anonymous-field-member
// fixtures, so the expectation files are authored from live emission (never
// from memory) while the CONTRACT itself stays the one the issue pre-declares.
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
const CASES: Array<{ lang: string; file: string; wasm: string; mod: string; cls: string }> = [
  { lang: "java", file: "java/anonymous-field-member.java", wasm: "tree-sitter-java.wasm", mod: "real-java-analyzer", cls: "RealJavaAnalyzer" },
  { lang: "groovy", file: "groovy/anonymous-field-member.groovy", wasm: "tree-sitter-groovy.wasm", mod: "real-groovy-analyzer", cls: "RealGroovyAnalyzer" },
  { lang: "kotlin", file: "kotlin/anonymous-field-member.kt", wasm: "tree-sitter-kotlin.wasm", mod: "real-kotlin-analyzer", cls: "RealKotlinAnalyzer" },
  { lang: "scala", file: "scala/anonymous-field-member.scala", wasm: "tree-sitter-scala.wasm", mod: "real-scala-analyzer", cls: "RealScalaAnalyzer" },
]

async function main() {
  const wts: any = await import("web-tree-sitter")
  const ParserClass = wts.Parser ?? wts.default ?? wts
  const Language = wts.Language ?? wts.default?.Language
  await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  for (const c of CASES) {
    const grammar = await Language.load(fs.readFileSync(path.join(ROOT, "wasm", c.wasm)))
    const parser = new ParserClass()
    parser.setLanguage(grammar)
    const abs = path.join(ROOT, "validation/m14/fixtures", c.file)
    const content = fs.readFileSync(abs, "utf8")
    const tree = parser.parse(content)
    const mod: any = await import(path.join(ROOT, `src/ast/${c.mod}.ts`))
    const analyzer = new mod[c.cls]()
    const res = await analyzer.analyze(tree.rootNode, content, `fixtures/${c.file}`)
    console.log(`\n===== ${c.lang} (${c.file}) =====`)
    console.log(" SYMBOLS:")
    for (const s of res.symbols ?? []) {
      console.log(`   L${String(s.range?.startLine).padStart(3)} ${String(s.kind).padEnd(12)} ${String(s.name).padEnd(22)} owner=${s.ownerName ?? "-"}`)
    }
    console.log(" RELATIONSHIPS:")
    for (const r of res.relationships ?? []) {
      const src = typeof r.source === "object" ? r.source?.name : r.source
      const tgt = typeof r.target === "object" ? r.target?.name : r.target
      console.log(`   L${String(r.line_number ?? "-").padStart(3)} ${String(r.type).padEnd(14)} ${String(src).padEnd(24)} -> ${tgt}`)
    }
  }
}
main()
