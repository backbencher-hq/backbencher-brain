// #866 follow-up measurement: what does an anonymous type's OWNER (and its
// containment edge source) resolve to in each JVM language, in the two contexts
// that can differ — a literal inside a METHOD, and a literal in a CLASS-LEVEL
// property initialiser? Written because the #866 census observed `owner=build`
// (java/groovy/scala) vs `owner=Ak` (kotlin) and a difference that is observed
// must be measured before it is either fixed or filed.
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
const ROOT = "<corpus-root>/mcp/backbencher-brain"

const CASES: Array<{ lang: string; file: string; wasm: string; mod: string; cls: string; src: string }> = [
  {
    lang: "java",
    file: "Ow.java",
    wasm: "tree-sitter-java.wasm",
    mod: "real-java-analyzer",
    cls: "RealJavaAnalyzer",
    src: [
      "class Ow {",
      "  int target() { return 1; }",
      "  void inMethod() {",
      "    Runnable a = new Runnable() { public void run() { target(); } };",
      "  }",
      "  Runnable inField = new Runnable() { public void run() { target(); } };",
      "}",
    ].join("\n"),
  },
  {
    lang: "groovy",
    file: "Ow.groovy",
    wasm: "tree-sitter-groovy.wasm",
    mod: "real-groovy-analyzer",
    cls: "RealGroovyAnalyzer",
    src: [
      "class Ow {",
      "  int target() { return 1 }",
      "  void inMethod() {",
      "    def a = new Runnable() { void run() { target() } }",
      "  }",
      "  def inField = new Runnable() { void run() { target() } }",
      "}",
    ].join("\n"),
  },
  {
    lang: "kotlin",
    file: "Ow.kt",
    wasm: "tree-sitter-kotlin.wasm",
    mod: "real-kotlin-analyzer",
    cls: "RealKotlinAnalyzer",
    src: [
      "class Ow {",
      "  fun target(): Int = 1",
      "  fun inMethod() {",
      "    val a = object : Runnable { override fun run() { target() } }",
      "  }",
      "  val inField = object : Runnable { override fun run() { target() } }",
      "}",
    ].join("\n"),
  },
  {
    lang: "scala",
    file: "Ow.scala",
    wasm: "tree-sitter-scala.wasm",
    mod: "real-scala-analyzer",
    cls: "RealScalaAnalyzer",
    src: [
      "class Ow {",
      "  def target(): Int = 1",
      "  def inMethod(): Unit = {",
      "    val a = new Runnable { override def run(): Unit = target() }",
      "  }",
      "  val inField: Runnable = new Runnable { override def run(): Unit = target() }",
      "}",
    ].join("\n"),
  },
]

async function main() {
  const wts: any = await import("web-tree-sitter")
  const ParserClass = wts.Parser ?? wts.default ?? wts
  const Language = wts.Language ?? wts.default?.Language
  await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const dir = mkdtempSync(path.join(tmpdir(), "ow866-"))
  for (const c of CASES) {
    const grammar = await Language.load((await import("node:fs")).readFileSync(path.join(ROOT, "wasm", c.wasm)))
    const parser = new ParserClass()
    parser.setLanguage(grammar)
    const p = path.join(dir, c.file)
    writeFileSync(p, c.src)
    const tree = parser.parse(c.src)
    const mod: any = await import(path.join(ROOT, `src/ast/${c.mod}.ts`))
    const analyzer = new mod[c.cls]()
    const res = await analyzer.analyze(tree.rootNode, c.src, c.file)
    console.log(`\n===== ${c.lang} =====`)
    for (const s of res.symbols ?? []) {
      if (String(s.name).startsWith("anonymous_")) {
        console.log(`   anon symbol L${s.range?.startLine}  ${s.name}  owner=${s.ownerName ?? "-"} ownerKind=${s.ownerKind ?? "-"}`)
      }
    }
    for (const r of res.relationships ?? []) {
      const src = typeof r.source === "object" ? r.source?.name : r.source
      const tgt = typeof r.target === "object" ? r.target?.name : r.target
      if (String(tgt).startsWith("anonymous_")) {
        console.log(`   contains-edge L${r.line_number}  ${r.type}  ${src} -> ${tgt}`)
      }
    }
  }
}
main()
