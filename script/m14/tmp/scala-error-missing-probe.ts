// M60/SDJ-7 — the `ERROR, MISSING` census row for scala.
//
// The F8 census injects ERROR and MISSING into every language's node-type set by
// hand (neither is in the wasm symbol table), and the completeness gate FAILS a
// language that has no bucket for one of them. Kotlin (KDJ-2), java (JDJ-2) and
// javascript (JSD32) all ruled them HANDLED, following the guard each analyzer
// actually has. Scala has the guard at real-scala-analyzer.ts:189
// (`n.type === "ERROR" || n.isMissing`) and NEITHER row — so section-a fails.
//
// This probe establishes the two facts the ruling needs, on scala inputs:
//   1. the guard fires and produces exactly one diagnostic per ERROR node, while
//      partial extraction survives (the guard bypasses the damaged node, not the
//      file);
//   2. whether the pinned scala grammar ever produces a MISSING node at all —
//      kotlin's ruling notes its grammar produced NONE across 7 probes, which is
//      a stronger ground for `internal_silent` than java's.
import fs from "node:fs"
import path from "node:path"
import { RealScalaAnalyzer } from "../../../src/ast/real-scala-analyzer"
const ROOT = path.resolve((import.meta as any).dirname ?? path.dirname(process.argv[1]), "..", "..", "..")

const CASES: { name: string; src: string }[] = [
  { name: "unterminated class", src: "class E { class Inner { val w = 1 }" },
  { name: "unterminated brace", src: "class F { val a = 1" },
  { name: "stray close brace", src: "class H { val a = 1 } }" },
  { name: "truncated parameter list", src: "class K { def f( }" },
  { name: "lone operator", src: "class L { val x = }" },
  { name: "malformed generics", src: "class M[T <:] { val a: List<,> }" },
  { name: "well-typed class, one bad method", src: "class N { val ok = 1\n  def bad(: Int = 2 }" },
  { name: "MISSING-candidate: unclosed string", src: "class O { val s = \"unclosed }" },
  { name: "MISSING-candidate: unclosed block comment", src: "class P { val a = 1 } /* unclosed" },
  { name: "MISSING-candidate: enum that fails to parse", src: "enum Q { A, B; def m = 1 }" },
]

async function main(): Promise<void> {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const lang = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-scala.wasm")))
  const parser = new P()
  parser.setLanguage(lang)
  const analyzer = new RealScalaAnalyzer()

  for (const c of CASES) {
    const root = parser.parse(c.src).rootNode
    let errNodes = 0
    let missingNodes = 0
    const missingTexts: string[] = []
    const w = (n: any): void => {
      if (n.type === "ERROR") errNodes++
      if (n.isMissing || n.type === "MISSING") { missingNodes++; if (missingTexts.length < 4) missingTexts.push(`${n.type} ${JSON.stringify(n.text)}`) }
      for (let i = 0; i < n.namedChildCount; i++) w(n.namedChild(i))
      if (n.type === "ERROR") for (let i = 0; i < n.childCount; i++) { const ch = n.child(i); if (ch) w(ch) }
    }
    w(root)
    const res: any = analyzer.analyze(root, c.src, "/tmp/probe.scala")
    const diags = res.errors ?? []
    const sameMessage = diags.length > 0 && diags.every((d: any) => /Syntax .* detected/.test(d.message ?? ""))
    console.log(
      `${c.name.padEnd(38)} hasError=${String(!!root.hasError).padEnd(5)} ERROR=${errNodes} MISSING=${missingNodes}`
      + ` diagnostics=${diags.length} allFromTheGuard=${sameMessage}`
      + ` symbols=[${(res.symbols ?? []).map((s: any) => s.name).join(",")}]`,
    )
    if (missingTexts.length) console.log(`${" ".repeat(40)}missing nodes: ${missingTexts.join("  ")}`)
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
