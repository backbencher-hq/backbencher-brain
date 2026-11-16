// M49/M37 #867: dump the REAL analyzer output for the four anonymous-type-owner
// fixtures so the expectation files are authored from live emission (never from
// memory). The CONTRACT (owner = innermost enclosing declaration) is the ruling,
// not the run's; only the spelling of kind/owner and the edge lines come from here.
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
const CASES: Array<{ lang: string; file: string; wasm: string; mod: string; cls: string }> = [
  { lang: "java", file: "java/anonymous-type-owner.java", wasm: "tree-sitter-java.wasm", mod: "real-java-analyzer", cls: "RealJavaAnalyzer" },
  { lang: "groovy", file: "groovy/anonymous-type-owner.groovy", wasm: "tree-sitter-groovy.wasm", mod: "real-groovy-analyzer", cls: "RealGroovyAnalyzer" },
  { lang: "kotlin", file: "kotlin/anonymous-type-owner.kt", wasm: "tree-sitter-kotlin.wasm", mod: "real-kotlin-analyzer", cls: "RealKotlinAnalyzer" },
  { lang: "kotlin2", file: "kotlin/anon-type-not-file-primary-type.kt", wasm: "tree-sitter-kotlin.wasm", mod: "real-kotlin-analyzer", cls: "RealKotlinAnalyzer" },
  { lang: "scala", file: "scala/anonymous-type-owner.scala", wasm: "tree-sitter-scala.wasm", mod: "real-scala-analyzer", cls: "RealScalaAnalyzer" },
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
    const res: any = await analyzer.analyze(tree.rootNode, content, `fixtures/${c.file}`)
    console.log(`\n===== ${c.lang} (${c.file}) =====`)
    const anon = (res.symbols ?? []).filter((s: any) => String(s.name).startsWith("anonymous_"))
    for (const s of anon) {
      console.log(`  anon-symbol L${s.range?.startLine}  ${s.name}  kind=${s.kind} owner=${s.ownerName} ownerKind=${s.ownerKind}`)
    }
    for (const r of (res.relationships ?? [])) {
      const t = String(r.type ?? r.relationshipType)
      const target = String(r.target ?? r.targetName ?? "")
      if (
        String(r.source ?? "").startsWith("anonymous_") ||
        target.startsWith("anonymous_") ||
        String(r.source ?? "") === "root"
      ) {
        console.log(`  rel L${r.line_number ?? r.line}  ${t}  ${r.source} -> ${target}  conf=${r.confidence} meta=${JSON.stringify(r.metadata ?? {})}`)
      }
    }
  }
}

main()
