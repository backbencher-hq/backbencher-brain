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

  await run("V3-ts-options-params", `<template>\n <div @click="save(1)" />\n</template>\n<script lang="ts">\nexport default {\n methods: {\n save(id: string): void { this.store(id); }\n }\n};\n</script>`, (r) => {
    const m = syms(r, "save")[0]
    console.log("   save=" + JSON.stringify(m ? { p: m.parameters, rt: m.returnType, o: m.ownerName, qc: m.qualified_calls } : null))
    console.log("   calls=" + JSON.stringify(rels(r, "calls")))
    if (!m?.parameters?.length) throw new Error("TS params lost in merge (claim TRUE)")
    if (!(m?.qualified_calls ?? []).includes("this.store") && JSON.stringify(m?.qualified_calls ?? []).indexOf("store") === -1) throw new Error("this.store call lost (claim TRUE)")
  })
  await run("V3-defineprops-generic-e2e", `<template>\n <div>{{ id }}</div>\n</template>\n<script setup lang="ts">\ndefineProps<{ id: string }>();\n</script>`, (r) => {
    console.log("   syms=" + JSON.stringify((r.symbols ?? []).map((s: any) => s.name + ":" + s.kind)) + " uses=" + JSON.stringify(rels(r, "uses")))
    if (!syms(r, "id").length) throw new Error("generic prop missing e2e (claim TRUE)")
    if (!rels(r, "uses").some((x: any) => x.target === "id")) throw new Error("template use of generic prop missing (claim TRUE)")
  })
  await run("V3-hybrid-blocks", `<template>\n <div @click="go" />\n</template>\n<script>\nimport { helper } from "./u";\nexport default {\n methods: {\n go() { helper(); }\n }\n};\n</script>\n<script setup>\nconst x = 1;\n</script>`, (r) => {
    console.log("   syms=" + JSON.stringify((r.symbols ?? []).map((s: any) => s.name + ":" + s.kind)) + " imports=" + JSON.stringify((r.imports ?? []).map((i: any) => i.module)))
    console.log("   patterns=" + JSON.stringify((r.metadata as any)?.patterns))
    if (!syms(r, "go").length) throw new Error("options method lost in hybrid (claim TRUE)")
    if (!(r.imports ?? []).some((i: any) => i.module === "./u")) throw new Error("plain-block import lost (claim TRUE)")
  })
  await run("V3-ts-computed-types", `<template>\n <div>{{ total }}</div>\n</template>\n<script lang="ts">\nexport default {\n computed: {\n total(): number { return 1; }\n }\n};\n</script>`, (r) => {
    const t = syms(r, "total")[0]
    console.log("   total=" + JSON.stringify(t ? { k: t.kind, rt: t.returnType, o: t.ownerName } : null))
    console.log("   uses=" + JSON.stringify(rels(r, "uses")))
    if (t?.returnType !== "number") throw new Error("computed return type lost (claim TRUE)")
    if (!rels(r, "uses").some((x: any) => x.target === "total")) throw new Error("template use of computed missing (claim TRUE)")
  })
}
main()
