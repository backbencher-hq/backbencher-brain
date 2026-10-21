import { readFileSync } from "node:fs"
import * as path from "node:path"
const ROOT = path.resolve(import.meta.dir, "..", "..")
const wts: any = await import(path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.js"))
const ParserClass = wts.Parser ?? wts.default ?? wts
const Language = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const grammar: any = await Language.load(readFileSync(path.join(ROOT, "wasm/tree-sitter-perl.wasm")))
const parser = new ParserClass()
parser.setLanguage(grammar)
const { derivePerlTruth } = await import(path.join(ROOT, "script/m14/perl-truth.ts"))
const f = process.argv[2]
const tree = parser.parse(readFileSync(f, "utf8"))
for (const e of derivePerlTruth(tree.rootNode) as any[]) {
  if (["extends", "implements", "overrides", "instantiates"].includes(e.label)) console.log(`  ${e.label}|${e.from}|${e.target}`)
}
const walk = (n: any): void => {
  const t = String(n.text ?? "").split("\n")[0].trim()
  if (n.type === "use_statement" && /^use (Mojo::Base|parent|base|role)\b/.test(t)) {
    const kids: string[] = []
    for (let i = 0; i < (n.childCount ?? 0); i++) {
      const c = n.child(i)
      kids.push(`${c.type}(${n.fieldNameForChild(i) ?? "-"})=${c.text.split("\n")[0].slice(0,24)}`)
    }
    console.log(`  SHAPE ${t.slice(0,40)} :: ${kids.join(" | ")}`)
  }
  for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) walk(c) }
}
walk(tree.rootNode)
