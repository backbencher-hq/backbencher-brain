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
const vue = await mk("tree-sitter-vue.wasm")
const js = await mk("tree-sitter-javascript.wasm")
const tsx = await mk("tree-sitter-tsx.wasm")
const KEYWORDS = new Set(["return", "key", "string", "if", "for", "typeof", "new", "in", "of"])
const callsOf = (body: string, parser: any) => {
  const s = new Set<string>()
  for (const e of diff.deriveTypeScriptEdges(parser.parse(body).rootNode)) if (e.label === "calls") s.add(e.target)
  return s
}
const src = [
  `<script lang="tsx" setup>`,
  `import { ref } from 'vue'`,
  ``,
  `type Props = {`,
  `  value: boolean`,
  `  ariaLabel?: string`,
  `  onChange: (value: string) => void`,
  `}`,
  ``,
  `const Cell: FunctionalComponent<Props> = ({ value, onChange }) => {`,
  `  return (`,
  `    <ElCheckbox`,
  `      onChange={onChange}`,
  `      modelValue={value}`,
  `    />`,
  `  )`,
  `}`,
  ``,
  `const generateColumns = (length = 10, prefix = 'column-') =>`,
  `  Array.from({ length }).map((_, i) => ({ key: \`\${prefix}\${i}\` }))`,
  ``,
  `const columns = generateColumns(10)`,
  `</script>`,
  `<template><div /></template>`,
  ``,
].join("\n")
const root = vue.parse(src).rootNode
const blocks = eng.ASTEngine.extractSfcScriptBlocks(root, src)
const pre = callsOf(blocks[0].body, js)
const post = callsOf(blocks[0].body, tsx)
console.log(`fabricated(js)=[${[...pre].filter((c) => KEYWORDS.has(c)).sort().join(",")}]`)
console.log(`lost(js)=[${[...post].filter((c) => !pre.has(c)).sort().join(",")}]`)
console.log(`js targets:  ${[...pre].sort().join(",")}`)
console.log(`tsx targets: ${[...post].sort().join(",")}`)

// and what the PRODUCTION pipeline emits for this SFC (analyzer side)
const res = await eng.ASTEngine.parseFile("probe.vue", src)
const aCalls = [...new Set((res.relationships ?? []).filter((r: any) => String(r.type).toLowerCase().startsWith("call")).map((r: any) => r.target))].sort()
console.log(`analyzer calls: ${aCalls.join(",")}`)
