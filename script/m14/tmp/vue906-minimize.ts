// What EXACTLY does the javascript parse fabricate/lose on element-plus's
// selection.vue script block? Measure, then minimize, so the F9 probe pins the
// real defect shape instead of a snippet that passes under both dispatches.
import fs from "node:fs"
import path from "node:path"
const ROOT = "<corpus-root>/mcp/backbencher-brain"
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
const KEYWORDS = new Set(["return", "key", "string", "if", "for", "while", "typeof", "new", "in", "of", "else", "switch", "catch", "delete", "await", "function", "class"])

const derive = (t: any) => {
  const calls = new Set<string>()
  for (const e of diff.deriveTypeScriptEdges(t)) if (e.label === "calls") calls.add(e.target)
  return calls
}
const report = (label: string, src: string) => {
  const root = vue.parse(src).rootNode
  const blocks = eng.ASTEngine.extractSfcScriptBlocks(root, src)
  if (blocks.length === 0) { console.log(`${label}: no script block`); return }
  const pre = derive(js.parse(blocks[0].body).rootNode)
  const post = derive(tsx.parse(blocks[0].body).rootNode)
  const bogus = [...pre].filter((c) => KEYWORDS.has(c))
  const lost = [...post].filter((c) => !pre.has(c))
  console.log(`${label}: jsCalls=${pre.size} tsxCalls=${post.size} fabricated=[${bogus.sort().join(",")}] lostByJs=[${lost.sort().join(",")}]`)
  console.log(`   tsx targets: ${[...post].sort().join(", ")}`)
}

// (A) the real file's script block, verbatim
const real = fs.readFileSync("<corpus-root>/bb_tests/repositories/element-plus/docs/examples/table-v2/selection.vue", "utf8")
report("A real selection.vue", real)

// (B) minimized: JSX return + typed destructure + Array.from().map object literal
report("B minimized", [
  `<script lang="tsx" setup>`,
  `import { ref } from 'vue'`,
  ``,
  `type Props = { value: boolean; onChange: (v: string) => void }`,
  ``,
  `const Cell = ({ value, onChange }: Props) => {`,
  `  return (`,
  `    <ElCheckbox`,
  `      onChange={onChange}`,
  `      modelValue={value}`,
  `    />`,
  `  )`,
  `}`,
  ``,
  `const generateColumns = (length = 10, prefix = 'column-') =>`,
  `  Array.from({ length }).map((_, columnIndex) => ({`,
  `    key: \`\${prefix}\${columnIndex}\`,`,
  `    title: \`Column \${columnIndex}\`,`,
  `  }))`,
  `</script>`,
  `<template><div /></template>`,
  ``,
].join("\n"))

// (C) the bare JSX return, nothing else
report("C bare jsx return", [
  `<script lang="tsx" setup>`,
  `const Cell = (props) => {`,
  `  return (`,
  `    <ElCheckbox`,
  `      onChange={props.onChange}`,
  `      modelValue={props.value}`,
  `    />`,
  `  )`,
  `}`,
  `</script>`,
  `<template><div /></template>`,
  ``,
].join("\n"))

// (D) JSX attribute with a member expression only
report("D attr shorthand", [
  `<script lang="tsx" setup>`,
  `const x = () => (`,
  `  <div key="a" className={styles.box}>`,
  `    {props.children}`,
  `  </div>`,
  `)`,
  `</script>`,
  `<template><div /></template>`,
  ``,
].join("\n"))
