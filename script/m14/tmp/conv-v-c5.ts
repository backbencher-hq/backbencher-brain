import * as fs from "fs"
import { RealVueAnalyzer } from "../../../src/ast/real-vue-analyzer"
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const LANGS: any = {}
  for (const [k, f] of [["vue", "tree-sitter-vue.wasm"], ["js", "tree-sitter-javascript.wasm"]] as const) {
    LANGS[k] = await L.load(fs.readFileSync("wasm/" + f))
  }
  const src = [
    "<template>",
    "  <button @click=\"go('save')\">x</button>",
    "</template>",
    "<script>",
    "export default {",
    "  methods: { go(s) {} },",
    "}",
    "</script>",
  ].join("\n") + "\n"
  const p = new P(); p.setLanguage(LANGS.vue)
  const root = p.parse(src).rootNode
  function findAll(n: any, pred: (x: any) => boolean, out: any[] = []): any[] {
    if (pred(n)) out.push(n)
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) findAll(c, pred, out) }
    return out
  }
  const trees: any[] = [], slines: number[] = [], cols: number[] = [], langs: string[] = [], idxs: number[] = []
  for (const se of findAll(root, (n) => n.type === "script_element")) {
    const raw = se.namedChildren.find((c: any) => c.type === "raw_text")
    if (!raw) continue
    const stag = se.namedChildren.find((c: any) => c.type === "start_tag")
    const langAttr = stag ? /lang\s*=\s*"([^"]*)"/.exec(stag.text)?.[1] ?? "" : ""
    const isTs = langAttr === "ts"
    const sp = new P(); sp.setLanguage(isTs ? LANGS.ts : LANGS.js)
    trees.push(sp.parse(raw.text))
    slines.push(raw.startPosition.row + 1); cols.push(raw.startPosition.column); langs.push(langAttr); idxs.push(raw.startIndex)
  }
  const az = new RealVueAnalyzer() as any
  const ctx: any = { sfcScriptTrees: trees, sfcScriptLines: slines, sfcScriptCols: cols, sfcScriptLangs: langs, sfcScriptStartIndex: idxs }
  const res: any = az.analyze(root, src, "probe.vue", ctx)
  for (const e of res.relationships) {
    process.stdout.write((e.type ?? "?") + "  " + (e.source ?? "?") + " -> " + (e.target ?? "?") + "\n")
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
