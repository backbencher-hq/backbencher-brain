// What the PRE-R10 include rule would have published for each include in the
// fixture — so the fixture's forbids are transcribed from a measurement of the
// defect rather than guessed.
import fs from "node:fs"
import path from "node:path"
const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")
const wts: any = await import("web-tree-sitter")
const ParserClass = wts.Parser ?? wts.default ?? wts
const Language = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const p = new ParserClass()
p.setLanguage(await Language.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-php.wasm"))))
const clean = (t: string) => (/^['"](.*)['"]$/s.exec(t) ? t.slice(1, -1) : t)
const collapse = (t: string) => t.replace(/\s+/g, "")
const OLD = (node: any): string | undefined => {
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i)
    if (!c) continue
    if (c.type === "encapsed_string" || c.type === "string") return clean(c.text)
    if (c.type === "binary_expression") return collapse(c.text)
    if (c.type === "name" || c.type === "qualified_name") return c.text
  }
  return undefined
}
for (const f of ["include-paths.php"]) {
  const file = path.join(ROOT, "validation/m14/fixtures/php", f)
  const tree = p.parse(fs.readFileSync(file, "utf8"))!
  const walk = (n: any) => {
    if (["include_expression","require_expression","include_once_expression","require_once_expression"].includes(n.type)) {
      console.log(`${String(n.startPosition.row + 1).padStart(3)} OLD=${JSON.stringify(OLD(n))}  raw=${JSON.stringify(n.text.replace(/\s+/g, " "))}`)
    }
    for (const c of n.children ?? []) walk(c)
  }
  walk(tree.rootNode)
}
p.delete()
