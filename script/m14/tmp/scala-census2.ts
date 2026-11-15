import fs from "node:fs"
import path from "node:path"
const ROOT = path.resolve((import.meta as any).dirname ?? path.dirname(process.argv[1]), "..", "..", "..")
const CORPUS = "/home/ishaq2321/bb_tests/repositories"
const repo = process.argv[2] ?? "cats-effect"
const limit = Number(process.argv[3] ?? 400)
function walkFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === ".git" || e.name === "target") continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walkFiles(p, out)
    else if (e.name.endsWith(".scala")) out.push(p)
  }
  return out
}
async function main(): Promise<void> {
  const wts: any = await import("web-tree-sitter")
  const ParserClass = wts.Parser ?? wts.default ?? wts
  const Language = wts.Language ?? wts.default?.Language
  await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const lang = await Language.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-scala.wasm")))
  const parser = new ParserClass()
  parser.setLanguage(lang)
  const files = walkFiles(path.join(CORPUS, repo)).sort().slice(0, limit)
  const hits: string[] = []
  const opNames = new Map<string, string[]>()
  let anonNoSuper = 0
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8")
    const rel = path.relative(path.join(CORPUS, repo), f)
    const tree = parser.parse(src)
    const walk = (n: any): void => {
      // (1) operator names that are DECLARATION names
      if (n.type === "function_definition" || n.type === "function_declaration" || n.type === "val_definition" || n.type === "var_definition") {
        const nm = n.childForFieldName("name") ?? n.childForFieldName("pattern")
        if (nm && nm.type === "operator_identifier") {
          const k = opNames.get(rel) ?? []
          k.push(`${nm.text} (line ${nm.startPosition.row + 1})`)
          opNames.set(rel, k)
        }
      }
      // (2) anonymous class with no readable supertype
      if (n.type === "instance_expression") {
        const tpl = n.namedChildren.find((c: any) => c.type === "template_body")
        const hasNew = n.children.find((c: any) => c.type === "new")
        if (tpl && hasNew) {
          const ty = n.namedChild(0)
          if (!ty || ["type_identifier", "generic_type", "stable_type_identifier"].indexOf(ty.type) < 0) {
            anonNoSuper++
            hits.push(`NO-SUPERTYPE ${rel}:${n.startPosition.row + 1} ty=${ty ? ty.type : "none"} text=${JSON.stringify(ty ? ty.text.slice(0, 90) : "")}`)
          }
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i))
    }
    walk(tree.rootNode)
  }
  console.log(`# ${repo}: ${anonNoSuper} anonymous classes with NO readable supertype`)
  for (const h of hits) console.log("  " + h)
  console.log(`\n# ${repo}: operator DECLARATION names, ${[...opNames.values()].reduce((a, b) => a + b.length, 0)} in ${opNames.size} files`)
  let n = 0
  for (const [f, v] of opNames) { if (n++ > 25) break; console.log(`  ${f}: ${v.join(", ")}`) }
}
main().catch((e) => { console.error(e); process.exit(1) })
