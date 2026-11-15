import * as WTS from "web-tree-sitter"
import * as fs from "fs"
import * as path from "path"
import { RealVueAnalyzer } from "../../../src/ast/real-vue-analyzer"

const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
let P: any, LANGS: Record<string, any> = {}
async function parsers() {
  if (P) return
  const wts: any = await import("web-tree-sitter")
  P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  for (const [k, f] of [["vue", "tree-sitter-vue.wasm"], ["js", "tree-sitter-javascript.wasm"]] as const)
    LANGS[k] = await L.load(fs.readFileSync(path.join(ROOT, "wasm", f)))
}
function findAll(n: any, pred: (x: any) => boolean, out: any[] = []): any[] {
  if (pred(n)) out.push(n)
  for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) findAll(c, pred, out) }
  return out
}
async function analyzeVue(src: string) {
  await parsers()
  const p = new P(); p.setLanguage(LANGS.vue)
  const root = p.parse(src).rootNode
  const trees: any[] = [], lines: number[] = [], cols: number[] = [], idxs: number[] = []
  for (const se of findAll(root, (n) => n.type === "script_element")) {
    const raw = se.namedChildren.find((c: any) => c.type === "raw_text")
    if (!raw) continue
    const sp = new P(); sp.setLanguage(LANGS.js)
    trees.push(sp.parse(raw.text))
    lines.push(raw.startPosition.row + 1); cols.push(raw.startPosition.column); idxs.push(raw.startIndex)
  }
  const a = new RealVueAnalyzer() as any
  return a.analyze(root, src, "T.vue", trees.length ? { sfcScriptTrees: trees, sfcScriptLines: lines, sfcScriptCols: cols, sfcScriptLangs: [""], sfcScriptStartIndex: idxs } : {})
}
async function main() {
  const run = async (name: string, src: string, checks: (r: any) => void) => {
    const r = await analyzeVue(src)
    try { checks(r); console.log("ok   " + name) } catch (e: any) { console.log("FAIL " + name + " :: " + e.message) }
  }
  const rels = (r: any, t: string) => (r.relationships ?? []).filter((x: any) => String(x.type).toLowerCase() === t)
  const syms = (r: any, n: string) => (r.symbols ?? []).filter((s: any) => s.name === n)
  await run("D-string-literal-args", `<template>\n <div @click="go('save')" />\n</template>\n<script>\nexport default {\n methods: {\n go(x) {},\n save() {}\n }\n};\n</script>`, (r) => {
    console.log("   uses=" + JSON.stringify(rels(r, "uses")))
    if (rels(r, "uses").some((x: any) => x.target === "save")) throw new Error("string literal read as member (claim TRUE)")
  })
  await run("D-arrow-data", `<template>\n <div>{{ count }}</div>\n</template>\n<script>\nexport default {\n data: () => ({ count: 0 })\n};\n</script>`, (r) => {
    console.log("   syms=" + JSON.stringify((r.symbols ?? []).map((s: any) => s.name)) + " uses=" + JSON.stringify(rels(r, "uses")))
    if (!syms(r, "count").length) throw new Error("arrow data keys missed (claim TRUE)")
  })
  await run("D-pairfn-data", `<template>\n <div>{{ count }}</div>\n</template>\n<script>\nexport default {\n data: function() { return { count: 0 }; }\n};\n</script>`, (r) => {
    console.log("   syms=" + JSON.stringify((r.symbols ?? []).map((s: any) => s.name)))
    if (!syms(r, "count").length) throw new Error("pair-fn data keys missed (claim TRUE)")
  })
  await run("D-decorated-default", `<template>\n <div/>\n</template>\n<script>\n@Dec\nexport default {\n methods: {\n go() {}\n }\n};\n</script>`, (r) => {
    const g = syms(r, "go")[0]
    console.log("   go=" + JSON.stringify(g ? { o: g.ownerName } : null))
    if (g?.ownerName !== "T") throw new Error("decorated default ownerless (claim TRUE)")
  })
  await run("D-dollar-emit", `<template>\n <div @click=\"$emit('save')\" />\n</template>\n<script>\nexport default {\n methods: {\n save() {}\n }\n};\n</script>`, (r) => {
    console.log("   uses=" + JSON.stringify(rels(r, "uses")) + " syms=" + JSON.stringify((r.symbols ?? []).map((s: any) => s.name)))
  })
}
main()
