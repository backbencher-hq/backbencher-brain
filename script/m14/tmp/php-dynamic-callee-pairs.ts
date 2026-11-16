// Predicted edge drop from the dynamic-callee narrowing: distinct
// (enclosing owner, target) pairs, which is what a deduped edge count counts.
import fs from "node:fs"
import path from "node:path"
const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")
const CORPUS = "<corpus-root>/bb_tests/repositories"
const { phpStaticCallableName } = await import(path.join(ROOT, "src/ast/real-php-analyzer.ts"))
const wts: any = await import("web-tree-sitter")
const ParserClass = wts.Parser ?? wts.default ?? wts
const Language = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const p = new ParserClass()
p.setLanguage(await Language.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-php.wasm"))))
const list = (d: string, out: string[]) => {
  let es: fs.Dirent[]
  try { es = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
  for (const e of es) {
    const q = path.join(d, e.name)
    if (e.isDirectory()) { if (!/^(\.|vendor|node_modules)/.test(e.name)) list(q, out) }
    else if (e.name.endsWith(".php")) out.push(q)
  }
}
const OWNERS = new Set(["function_definition", "method_declaration", "anonymous_function", "arrow_function"])
for (const repo of ["phpunit", "phpmyadmin"]) {
  const files: string[] = []
  list(path.join(CORPUS, repo), files)
  let sites = 0
  const pairs = new Set<string>()
  const perFileTargets = new Map<string, Set<string>>()
  const perFile = new Map<string, number>()
  for (const f of files) {
    let src: string
    try { src = fs.readFileSync(f, "utf8") } catch { continue }
    if (src.length > 400_000) continue
    let t: any
    try { t = p.parse(src) } catch { continue }
    if (!t) continue
    const walk = (n: any, owner: string) => {
      let next = owner
      if (OWNERS.has(n.type)) {
        next = n.childForFieldName?.("name")?.text ?? n.namedChildren.find((c: any) => c.type === "name")?.text ?? "global"
      }
      if (n.type === "function_call_expression") {
        const fn = n.childForFieldName("function")
        if (fn && !phpStaticCallableName(fn)) {
          sites++
          const target = String(fn.text).replace(/^\$/, "").replace(/[^A-Za-z0-9_]/g, "")
          pairs.add(`${next}->${target}`)
          const rel = path.relative(CORPUS, f)
          if (!perFileTargets.has(rel)) perFileTargets.set(rel, new Set())
          perFileTargets.get(rel)!.add(target)
          perFile.set(path.relative(CORPUS, f), (perFile.get(path.relative(CORPUS, f)) ?? 0) + 1)
          if (perFile.size > 0 && !perFile.has("__first")) perFile.set("__first", 0)
        }
      }
      for (const c of n.children ?? []) walk(c, next)
    }
    walk(t.rootNode, "global")
  }
  let perFileDistinct = 0
  for (const s2 of perFileTargets.values()) perFileDistinct += s2.size
  console.log(`${repo}: dynamic-callee sites=${sites}  distinct (owner,target)=${pairs.size}  per-file distinct targets=${perFileDistinct} (harness dedupes label:target PER FILE)`)
  const top = [...new Map([...perFile.entries()].filter(([k]) => k !== "__first")).entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
  for (const [f, n] of top) console.log(`   most sites: ${f} (${n})`)
}
p.delete()
