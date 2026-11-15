// How many `calls` targets did the dynamic-callee narrowing drop, per corpus?
import fs from "node:fs"
import path from "node:path"
const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")
const CORPUS = "/home/ishaq2321/bb_tests/repositories"
const wts: any = await import("web-tree-sitter")
const ParserClass = wts.Parser ?? wts.default ?? wts
const Language = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const p = new ParserClass()
p.setLanguage(await Language.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-php.wasm"))))
const shapes = new Map<string, { n: number; s: string }>()
const list = (d: string, out: string[]) => {
  let es: fs.Dirent[]
  try { es = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
  for (const e of es) {
    const q = path.join(d, e.name)
    if (e.isDirectory()) { if (!/^(\.|vendor|node_modules)/.test(e.name)) list(q, out) }
    else if (e.name.endsWith(".php")) out.push(q)
  }
}
for (const repo of ["phpunit", "phpmyadmin"]) {
  const files: string[] = []
  list(path.join(CORPUS, repo), files)
  let dyn = 0
  const seen = new Map<string, { n: number; s: string }>()
  for (const f of files) {
    let src: string
    try { src = fs.readFileSync(f, "utf8") } catch { continue }
    if (src.length > 400_000) continue
    let t: any
    try { t = p.parse(src) } catch { continue }
    if (!t) continue
    const walk = (n: any) => {
      if (n.type === "function_call_expression") {
        const fn = n.childForFieldName("function")
        if (fn && fn.type !== "name" && fn.type !== "qualified_name") {
          dyn++
          const r = seen.get(fn.type) ?? { n: 0, s: "" }
          r.n++
          if (!r.s) r.s = `${JSON.stringify(n.text.replace(/\s+/g, " ").slice(0, 60))} @ ${path.relative(CORPUS, f)}:${n.startPosition.row + 1}`
          seen.set(fn.type, r)
        }
      }
      for (const c of n.children ?? []) walk(c)
    }
    walk(t.rootNode)
  }
  console.log(`${repo}: files=${files.length} dynamic-callee sites=${dyn}`)
  for (const [k, v] of seen) console.log(`   ${k} x${v.n}  e.g. ${v.s}`)
}
p.delete()
