// What did the include narrowing DROP, and is every dropped operand really
// runtime-dynamic? Walks real corpora, evaluates the pre-fix and post-fix rules
// on each include expression, and classifies the difference by operand shape.
import fs from "node:fs"
import path from "node:path"
const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")
const CORPUS = "/home/ishaq2321/bb_tests/repositories"
const { phpStaticIncludePath } = await import(path.join(ROOT, "src/ast/real-php-analyzer.ts"))
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
const INCLUDES = new Set(["include_expression", "require_expression", "include_once_expression", "require_once_expression"])

const shapes = new Map<string, { count: number; sample: string }>()
const keeps = new Map<string, number>()
let total = 0
const scan = (d: string, files: string[]) => {
  let es: fs.Dirent[]
  try { es = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
  for (const e of es) {
    const q = path.join(d, e.name)
    if (e.isDirectory()) { if (!/^(\.|vendor|node_modules)/.test(e.name)) scan(q, files) }
    else if (e.name.endsWith(".php")) files.push(q)
  }
}
const files: string[] = []
for (const r of ["phpunit", "phpmyadmin"]) scan(path.join(CORPUS, r), files)
console.log(`files: ${files.length}`)
for (const file of files) {
  let src: string
  try { src = fs.readFileSync(file, "utf8") } catch { continue }
  if (src.length > 400_000) continue
  let tree: any
  try { tree = p.parse(src) } catch { continue }
  if (!tree) continue
  const walk = (n: any) => {
    if (INCLUDES.has(n.type)) {
      total++
      const oldVal = OLD(n)
      const newVal = phpStaticIncludePath(n)
      if (oldVal !== undefined && newVal !== undefined) keeps.set("kept", (keeps.get("kept") ?? 0) + 1)
      else if (oldVal === undefined && newVal !== undefined) keeps.set("newly-kept", (keeps.get("newly-kept") ?? 0) + 1)
      else if (oldVal !== undefined && newVal === undefined) {
        // classify the first path-shaped child's shape
        let shape = "(none)"
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (!c) continue
          if (c.type === "binary_expression") {
            const ops = c.namedChildren.map((x: any) => x.type)
            shape = `binary[${ops.join("+")}]`
          } else shape = c.type
          break
        }
        const rec = shapes.get(shape) ?? { count: 0, sample: "" }
        rec.count++
        if (!rec.sample) rec.sample = `${JSON.stringify(String(oldVal).slice(0, 70))} @ ${path.relative(CORPUS, file)}:${n.startPosition.row + 1}`
        shapes.set(shape, rec)
      }
    }
    for (const c of n.children ?? []) walk(c)
  }
  walk(tree.rootNode)
}
console.log(`include expressions: ${total}`)
console.log("outcomes:", JSON.stringify([...keeps.entries()]))
console.log("\nDROPPED, by operand shape:")
for (const [shape, rec] of [...shapes.entries()].sort((a, b) => b[1].count - a[1].count)) {
  console.log(`  x${String(rec.count).padStart(4)}  ${shape}`)
  console.log(`        e.g. ${rec.sample}`)
}
p.delete()
