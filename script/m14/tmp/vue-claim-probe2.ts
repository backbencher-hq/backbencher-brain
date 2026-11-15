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
  for (const [k, f] of [["vue", "tree-sitter-vue.wasm"], ["js", "tree-sitter-javascript.wasm"], ["ts", "tree-sitter-typescript.wasm"]] as const) {
    LANGS[k] = await L.load(fs.readFileSync(path.join(ROOT, "wasm", f)))
  }
}
function findAll(n: any, pred: (x: any) => boolean, out: any[] = []): any[] {
  if (pred(n)) out.push(n)
  for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) findAll(c, pred, out) }
  return out
}
function scriptBlocks(root: any) {
  const blocks: { body: string; startLine: number; startColumn: number; lang: string }[] = []
  for (const se of findAll(root, (n) => n.type === "script_element")) {
    const raw = se.namedChildren.find((c: any) => c.type === "raw_text")
    if (!raw) continue
    const stag = se.namedChildren.find((c: any) => c.type === "start_tag")
    const langAttr = stag ? /lang\s*=\s*"([^"]*)"/.exec(stag.text)?.[1] ?? "" : ""
    blocks.push({ body: raw.text, startLine: raw.startPosition.row + 1, startColumn: raw.startPosition.column, lang: langAttr })
  }
  return blocks
}
async function analyzeVue(src: string, file = "T.vue") {
  await parsers()
  const p = new P(); p.setLanguage(LANGS.vue)
  const root = p.parse(src).rootNode
  const trees: any[] = [], lines: number[] = [], cols: number[] = [], langs: string[] = [], idxs: number[] = []
  for (const b of scriptBlocks(root)) {
    const isTs = b.lang === "ts" || b.lang === "tsx"
    const sp = new P(); sp.setLanguage(isTs ? LANGS.ts : LANGS.js)
    trees.push(sp.parse(b.body))
    lines.push(b.startLine); cols.push(b.startColumn); langs.push(b.lang); idxs.push(b.startIndex)
  }
  const a = new RealVueAnalyzer() as any
  const ctx: any = trees.length ? { sfcScriptTrees: trees, sfcScriptLines: lines, sfcScriptCols: cols, sfcScriptLangs: langs, sfcScriptStartIndex: idxs } : {}
  return a.analyze(root, src, file, ctx)
}
async function main() {
  const run = async (name: string, src: string, checks: (r: any) => void) => {
    const r = await analyzeVue(src)
    try { checks(r); console.log("ok   " + name) } catch (e: any) { console.log("FAIL " + name + " :: " + e.message) }
  }
  const rels = (r: any, type: string) => (r.relationships ?? []).filter((x: any) => String(x.type).toLowerCase() === type)
  const syms = (r: any, name: string) => (r.symbols ?? []).filter((s: any) => s.name === name)

  await run("V2-member-chain-real", `<template>\n <div v-for="item in items">{{ item.id }}</div>\n</template>\n<script>\nexport default {\n computed: {\n items() { return []; },\n id() { return 0; }\n }\n};\n</script>`, (r) => {
    console.log("   uses=" + JSON.stringify(rels(r, "uses")) + " syms=" + JSON.stringify((r.symbols ?? []).map((s: any) => s.name)))
    if (!rels(r, "uses").some((x: any) => x.target === "items")) throw new Error("real collection use missed")
    if (rels(r, "uses").some((x: any) => x.target === "id")) throw new Error("loop-prop misattributed to member id (claim TRUE)")
  })
  await run("V2-commented-owner", `<template>\n <div/>\n</template>\n<script>\nexport /*c*/ default {\n methods: {\n go() {}\n }\n};\n</script>`, (r) => {
    const g = syms(r, "go")[0]
    console.log("   go=" + JSON.stringify(g ? { o: g.ownerName, ok: g.ownerKind } : null))
    if (g?.ownerName !== "T") throw new Error("commented-default owner wrong: " + g?.ownerName + " (claim TRUE)")
  })
  await run("V2-data-factory", `<template>\n <div>{{ count }}</div>\n</template>\n<script>\nexport default {\n data() { return { count: 0 }; }\n};\n</script>`, (r) => {
    console.log("   uses=" + JSON.stringify(rels(r, "uses")) + " syms=" + JSON.stringify((r.symbols ?? []).map((s: any) => s.name)))
    if (!rels(r, "uses").some((x: any) => x.target === "count")) throw new Error("factory data key unread")
  })
}
main()
