// W23 (#841 residual): isolate the trigger of
//   def x = a.collect { SourceSet it -> it.cp.filter(File) }
// which hasError=true while the untyped / bare-call / no-chain controls parse.
// Prints hasError plus the S-expression of every ERROR node found.
// Usage: bun script/m14/tmp/w23-closure-probe.ts
import * as fs from "fs"

const CASES: Array<[string, string]> = [
  ["baseline FAIL", "def x = a.collect { SourceSet it -> it.cp.filter(File) }\n"],
  ["no args on tail call", "def x = a.collect { SourceSet it -> it.cp.filter() }\n"],
  ["one-level chain", "def x = a.collect { SourceSet it -> it.filter(File) }\n"],
  ["two-level chain, literal arg", "def x = a.collect { SourceSet it -> it.cp.filter('F') }\n"],
  ["two-level chain, no call", "def x = a.collect { SourceSet it -> it.cp.files }\n"],
  ["chain + call, untyped param", "def x = a.collect { it.cp.filter(File) }\n"],
  ["chain + call, typed, explicit arrow body parens", "def x = a.collect { SourceSet it -> (it.cp.filter(File)) }\n"],
  ["typed param, body two stmts", "def x = a.collect { SourceSet it; it.cp.filter(File) }\n"],
  ["typed param, body stmt then return", "def x = a.collect { SourceSet it ->\n  it.cp.filter(File)\n}\n"],
  ["typed param, dotted call on OTHER name", "def x = a.collect { SourceSet it -> y.cp.filter(File) }\n"],
  ["typed param, dotted call, statement position", "def x = 1\nx.collect { SourceSet it -> it.cp.filter(File) }\n"],
  ["typed param, assign to var", "def y = a.collect { SourceSet it -> it.cp.filter(File) }\n"],
  ["method decl + typed closure", "class C {\n  def m() {\n    return a.collect { SourceSet it -> it.cp.filter(File) }\n  }\n}\n"],
  ["one-level chain, generic arg", "def x = a.collect { SourceSet it -> it.filter(Map.class) }\n"],
  ["two-level chain, single-arg no parens", "def x = a.collect { SourceSet it -> it.cp.filter File }\n"],
]

async function main(): Promise<void> {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const lang = await L.load(fs.readFileSync("wasm/tree-sitter-groovy.wasm"))
  const parser = new P()
  parser.setLanguage(lang)
  let fails = 0
  for (const [label, src] of CASES) {
    const tree = parser.parse(src)
    const root = tree.rootNode
    const errs: string[] = []
    const walk = (n: any): void => {
      if (n.type === "ERROR" || n.isMissing) {
        const t = n.text.replace(/\n/g, "\\n")
        if (t.length > 0) errs.push(`${n.type}${n.isMissing ? "(missing)" : ""}@${n.startIndex}: ${JSON.stringify(t)}`)
      }
      for (let i = 0; i < n.childCount; i++) walk(n.child(i))
    }
    walk(root)
    if (root.hasError) fails++
    console.log(`${root.hasError ? "FAIL" : "ok  "}  ${label}`)
    if (root.hasError) console.log(`        ${errs.slice(0, 3).join(" | ") || "(no non-empty ERROR node: zero-width phantom)"}`)
  }
  console.log(`\n${fails} of ${CASES.length} failing`)
}
main()
