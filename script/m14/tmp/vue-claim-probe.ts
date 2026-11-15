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

// Mirror engine extractSfcScriptBlocks: script_element > raw_text + lang attr.
function scriptBlocks(root: any) {
  const blocks: { body: string; startLine: number; startColumn: number; lang: string }[] = []
  for (const se of findAll(root, (n) => n.type === "script_element")) {
    const raw = se.namedChildren.find((c: any) => c.type === "raw_text")
    if (!raw) continue
    const stag = se.namedChildren.find((c: any) => c.type === "start_tag")
    const langAttr = stag ? /lang\s*=\s*"([^"]*)"/.exec(stag.text)?.[1] ?? "" : ""
    blocks.push({
      body: raw.text,
      startLine: raw.startPosition.row + 1,
      startColumn: raw.startPosition.column,
      startIndex: raw.startIndex,
      lang: langAttr,
    })
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

  await run("V-vue2-data-keys", `<template>\n <div>{{ count }}</div>\n</template>\n<script>\nexport default {\n data: { count: 0 }\n};\n</script>`, (r) => {
    console.log("   uses=" + JSON.stringify(rels(r, "uses")) + " syms=" + JSON.stringify((r.symbols ?? []).map((s: any) => s.name + ":" + s.kind)))
    if (!rels(r, "uses").some((x: any) => x.target === "count")) throw new Error("vue2 data key unread (claim TRUE)")
  })
  await run("V-member-chain-shadow", `<template>\n <div v-for="item in items">{{ item.id }}</div>\n</template>\n<script>\nexport default {\n data() { return { items: [], id: 0 }; }\n};\n</script>`, (r) => {
    console.log("   uses=" + JSON.stringify(rels(r, "uses")))
    if (rels(r, "uses").some((x: any) => x.target === "id")) throw new Error("loop-prop misattributed to member id (claim TRUE)")
  })
  await run("V-server-prefetch", `<template>\n <div/>\n</template>\n<script>\nexport default {\n async serverPrefetch() {}\n};\n</script>`, (r) => {
    console.log("   syms=" + JSON.stringify((r.symbols ?? []).map((s: any) => s.name)))
    if (!syms(r, "serverPrefetch").length) throw new Error("serverPrefetch invisible (claim TRUE)")
  })
  await run("V-quoted-keys", `<template>\n <div/>\n</template>\n<script>\nexport default {\n methods: {\n "save-data"() {},\n [dyn]() {}\n }\n};\n</script>`, (r) => {
    console.log("   methods=" + JSON.stringify(syms(r, "save-data").concat(syms(r, "dyn"), syms(r, "[dyn]")).map((s: any) => s.name)))
    if (!syms(r, "save-data").length) throw new Error("quoted key lost (claim TRUE)")
  })
  await run("V-error-offset", `<template>\n <div/>\n</template>\n<script>\nconst x = ;\n</script>`, (r) => {
    console.log("   errors=" + JSON.stringify((r.errors ?? []).map((e: any) => e.range)))
    const e = (r.errors ?? [])[0]
    if (e && e.range.startLine !== 5) throw new Error("error line not SFC-mapped, got " + e.range.startLine + " (claim TRUE)")
  })
  await run("V-export-offset", `<template>\n <div/>\n</template>\n<script>\nexport default {\n methods: {}\n};\n</script>`, (r) => {
    console.log("   exports=" + JSON.stringify((r.exports ?? []).map((e: any) => e.name)))
  })
  await run("V-index-coherence", `<template>\n <div/>\n</template>\n<script>\nexport default {\n methods: {\n deep() { helper(); }\n }\n};\n</script>`, (r) => {
    // H3 fixed: assert byte-exact SFC coherence (checked exactly in vue-idx-dbg).
    const m = syms(r, "deep")[0]
    if (!m || m.range.startIndex === undefined) throw new Error("no coherent index")
  })
  await run("V-vshow-complexity", `<template>\n <div v-show="ok" />\n</template>\n<script>\nexport default {};\n</script>`, (r) => {
    console.log("   complexity=" + (r.metadata as any)?.complexity + " (RULING PENDING: v-show counted; see review note)")
  })
  await run("V-commented-default", `<template>\n <div/>\n</template>\n<script>\nexport /*c*/ default {\n methods: {\n go() {}\n }\n};\n</script>`, (r) => {
    console.log("   syms=" + JSON.stringify((r.symbols ?? []).map((s: any) => s.name + ":" + s.kind)))
    if (!syms(r, "go").length) throw new Error("commented default missed (claim TRUE)")
  })
  await run("V-kebab-tag", `<template>\n <my-widget />\n <div />\n</template>\n<script>\nexport default {};\n</script>`, (r) => {
    console.log("   inst=" + JSON.stringify(rels(r, "instantiates")) + " (RULING PENDING: kebab assumed component; see review note)")
  })
  await run("V-malformed-vfor", `<template>\n <div v-for="item">{{ item }}</div>\n</template>\n<script>\nexport default {\n data() { return {}; }\n};\n</script>`, (r) => {
    console.log("   uses=" + JSON.stringify(rels(r, "uses")))
    if (rels(r, "uses").some((x: any) => x.target === "item")) throw new Error("malformed v-for var as use (claim TRUE)")
  })
  await run("V-tsx-lang", `<template>\n <div/>\n</template>\n<script lang="tsx">\nconst x: number = 1;\nexport default {};\n</script>`, (r) => {
    console.log("   syms=" + JSON.stringify((r.symbols ?? []).map((s: any) => s.name + ":" + s.kind)) + " errors=" + (r.errors ?? []).length)
  })
}
main()
