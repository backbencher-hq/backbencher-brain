import * as WTS from "web-tree-sitter"
import * as fs from "fs"
import * as path from "path"
import { RealVueAnalyzer } from "../../../src/ast/real-vue-analyzer"
const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const vlang = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-vue.wasm")))
  const jlang = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-javascript.wasm")))
  const src = `<template>\n <div/>\n</template>\n<script>\nexport default {\n methods: {\n deep() { helper(); }\n }\n};\n</script>`
  const p = new P(); p.setLanguage(vlang)
  const root = p.parse(src).rootNode
  const findAll = (n: any, pred: any, out: any[] = []): any[] => { if (pred(n)) out.push(n); for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) findAll(c, pred, out) } return out }
  const raw = findAll(root, (n: any) => n.type === "raw_text")[0]
  const sp = new P(); sp.setLanguage(jlang)
  const st = sp.parse(raw.text)
  const a = new RealVueAnalyzer() as any
  const r = await a.analyze(root, src, "T.vue", { sfcScriptTrees: [st], sfcScriptLines: [raw.startPosition.row + 1], sfcScriptCols: [raw.startPosition.column], sfcScriptLangs: [""], sfcScriptStartIndex: [raw.startIndex] })
  const m = (r.symbols ?? []).find((s: any) => s.name === "deep")
  const truth = src.indexOf("deep()")
  console.log("symbol range:", JSON.stringify(m?.range))
  console.log("ground truth SFC index of 'deep':", truth)
  console.log("MATCH:", m?.range.startIndex === truth)
}
main()
