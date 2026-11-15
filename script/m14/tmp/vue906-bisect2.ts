// Bisect the #906 trigger: strip one TS/JSX construct at a time from
// selection.vue's script block and see which removal stops the JS parse from
// fabricating [key,return,string] and losing [ref,from,generateColumns,...].
import fs from "node:fs"
import path from "node:path"
const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const diff: any = await import(path.join(ROOT, "script/m14/differential.ts"))
const eng: any = await import(path.join(ROOT, "src/ast/engine.ts"))
const wts: any = await import("web-tree-sitter")
const P: any = wts.Parser ?? wts.default ?? wts
const L: any = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const mk = async (w: string) => {
  const lang = await L.load(fs.readFileSync(path.join(ROOT, "wasm", w)))
  const p = new P()
  p.setLanguage(lang)
  return p
}
const js = await mk("tree-sitter-javascript.wasm")
const tsx = await mk("tree-sitter-tsx.wasm")
const KEYWORDS = new Set(["return", "key", "string", "if", "for", "typeof", "new", "in", "of", "else", "case"])

const real = fs.readFileSync("/home/ishaq2321/bb_tests/repositories/element-plus/docs/examples/table-v2/selection.vue", "utf8")
const rootOfReal = null

const callsOf = (body: string, parser: any) => {
  const s = new Set<string>()
  for (const e of diff.deriveTypeScriptEdges(parser.parse(body).rootNode)) if (e.label === "calls") s.add(e.target)
  return s
}

// script body = between the script tags
const m = real.match(/<script[^>]*>([\s\S]*?)<\/script>/)
const body = m![1]
const variants: Record<string, string> = {
  "0 baseline (real block)": body,
  "1 no `import type` lines": body.replace(/^import type .*$/gm, ""),
  "2 no `type X = {...}` block": body.replace(/type SelectionCellProps = \{[\s\S]*?\n\}\n/, ""),
  "3 no FunctionalComponent<> annotation": body.replace(/: FunctionalComponent<SelectionCellProps>/, ""),
  "4 no ReturnType<typeof ...>": body.replace(/ReturnType<typeof generateColumns>/, "any"),
  "5 no Column<any>[] annotation": body.replace(/: Column<any>\[\]/, ""),
  "6 no `props?: any` param": body.replace(/props\?: any/, "props"),
  "7 no JSX (SelectionCell tags)": body.replace(/<SelectionCell[\s\S]*?\/>/g, "null"),
  "8 no JSX (all tags)": body.replace(/<[A-Za-z][^>]*\/>/g, "null").replace(/<ElCheckbox[\s\S]*?\/>/g, "null"),
}
console.log(`baseline fabrication+loss:`)
{
  const pre = callsOf(body, js)
  const post = callsOf(body, tsx)
  console.log(`  fabricated=[${[...pre].filter((c) => KEYWORDS.has(c)).sort().join(",")}] lost=[${[...post].filter((c) => !pre.has(c)).sort().join(",")}]`)
}
for (const [name, v] of Object.entries(variants)) {
  if (name.startsWith("0 ")) continue
  const pre = callsOf(v, js)
  const post = callsOf(v, tsx)
  const fab = [...pre].filter((c) => KEYWORDS.has(c)).sort()
  const lost = [...post].filter((c) => !pre.has(c)).sort()
  console.log(`${name}: fabricated=[${fab.join(",")}] lost=[${lost.join(",")}]`)
}
