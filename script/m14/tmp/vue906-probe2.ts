import fs from "node:fs"
import path from "node:path"
const ROOT = "<corpus-root>/mcp/backbencher-brain"
const wts: any = await import("web-tree-sitter")
const P: any = wts.Parser ?? wts.default ?? wts
const L: any = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const vueLang = await L.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-vue.wasm")))
const parser = new P()
parser.setLanguage(vueLang)

const src = [
  `<script lang="tsx" setup>`,
  `import { ref } from "vue"`,
  `const list = ref(makeList(3))`,
  `function makeList(n: number) {`,
  `  return Array.from({ length: n }).map((_, i) => i)`,
  `}`,
  `const render = () => <div key="a">{list.value.length}</div>`,
  `</script>`,
  ``,
  `<template>`,
  `  <div class="probe">{{ render }}</div>`,
  `</template>`,
  ``,
].join("\n")

const root = parser.parse(src).rootNode
console.log("tree errors:", root.hasError)
const mod: any = await import(path.join(ROOT, "src/ast/real-vue-analyzer.ts"))
const analyzer = new mod.RealVueAnalyzer()
const res = await analyzer.analyze(root, src, "probe.vue")
console.log("symbols:", res.symbols?.map((s: any) => `${s.kind}:${s.name}`).join(", "))
const byLabel: Record<string, string[]> = {}
for (const r of res.relationships ?? []) {
  ;(byLabel[r.type] ??= []).push(`${r.source}->${r.target}`)
}
for (const [k, v] of Object.entries(byLabel)) console.log(`  ${k}: ${v.join(", ")}`)
