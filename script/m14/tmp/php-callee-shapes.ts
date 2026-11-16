// Measure: for php `function_call_expression`, which callee node types appear in
// real corpus code, and what `calls` target the analyzer publishes for each.
import fs from "node:fs"
import path from "node:path"
const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")
const CORPUS = "<corpus-root>/bb_tests/repositories"
const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
const wts: any = await import("web-tree-sitter")
const ParserClass = wts.Parser ?? wts.default ?? wts
const Language = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const parser = new ParserClass()
parser.setLanguage(await Language.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-php.wasm"))))

const repos = ["phpunit/src", "phpmyadmin/src", "phpmyadmin/tests"]
const files: string[] = []
const scan = (d: string) => {
  let es: fs.Dirent[]
  try { es = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
  for (const e of es) {
    const p = path.join(d, e.name)
    if (e.isDirectory()) { if (!/^(\.|vendor|node_modules)/.test(e.name)) scan(p) }
    else if (e.name.endsWith(".php")) files.push(p)
  }
}
for (const r of repos) scan(path.join(CORPUS, r))

const shapeCount = new Map<string, number>()
const shapeSample = new Map<string, string>()
const targetsByShape = new Map<string, Set<string>>()
for (const file of files.slice(0, 400)) {
  const src = fs.readFileSync(file, "utf8")
  let tree: any
  try { tree = parser.parse(src) } catch { continue }
  if (!tree) continue
  const walk = (n: any) => {
    if (n.type === "function_call_expression") {
      const fn = n.childForFieldName("function")
      const t = fn ? fn.type : "(none)"
      shapeCount.set(t, (shapeCount.get(t) ?? 0) + 1)
      if (!shapeSample.has(t)) shapeSample.set(t, `${n.text.replace(/\s+/g, " ").slice(0, 70)} @ ${path.relative(CORPUS, file)}`)
      if (fn && fn.type !== "name" && fn.type !== "qualified_name") {
        if (!targetsByShape.has(t)) targetsByShape.set(t, new Set())
        targetsByShape.get(t)!.add(fn.text.slice(0, 60))
      }
    }
    for (const c of n.children ?? []) walk(c)
  }
  walk(tree.rootNode)
}
console.log(`scanned ${Math.min(files.length, 400)} files of ${files.length}`)
for (const [t, n] of [...shapeCount.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`\n${t}  x${n}`)
  console.log(`   e.g. ${shapeSample.get(t)}`)
  const tg = targetsByShape.get(t)
  if (tg) console.log(`   NON-NAME targets (${tg.size}): ${[...tg].slice(0, 10).map((x) => JSON.stringify(x)).join(", ")}`)
}
parser.delete()
