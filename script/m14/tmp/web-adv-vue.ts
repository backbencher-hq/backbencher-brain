// Vue adversarial round — corpus-absent Vue 3.4/3.5 constructs against the
// pinned analyzer + grammar. The pinned corpus (vue-core) tracks 11 .vue
// files, so the census has maximal sampling blindness; this probe set is the
// compensating instrument. Two questions per case, the #841 form:
//   1. does the GRAMMAR parse it? (hasError-gated node walk)
//   2. does the ANALYZER lose what a correct parse would surface?
//     (production parseFile: symbols/relationships vs per-case expectations)
// Run: bun script/m14/tmp/web-adv-vue.ts
import { writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ASTEngine } from "../../../src/ast/engine"
import { parseFile } from "../../../src/ast/pool-worker"

const CASES: Array<[string, string, { syms: string[]; rels: Array<[string, string]>; note?: string }]> = [
  // --- corpus-absent Vue 3.4/3.5 constructs ---
  ["defineModel-basic", `<script setup lang="ts">\n  const model = defineModel<string>({ required: true })\n  console.log(model.value)\n</script>\n<template><input v-model="model" /></template>\n`, { syms: [], rels: [], note: "macro symbol must be filtered" }],
  ["defineModel-renamed", `<script setup>\n  const title = defineModel('title')\n</script>\n<template><h1>{{ title }}</h1></template>\n`, { syms: [], rels: [] }],
  ["generic-component", `<script setup lang="ts" generic="T extends string | number">\n  import { format } from "./format"\n  const props = defineProps<{ items: T[] }>()\n  const first = () => format(props.items[0])\n</script>\n<template><ul><li v-for="i in props.items">{{ i }}</li></ul></template>\n`, { syms: ["first"], rels: [] }],
  ["props-destructure-defaults", `<script setup lang="ts">\n  import { watch } from "vue"\n  const { msg = "hello", count = 0 } = defineProps<{ msg?: string; count?: number }>()\n  watch(count, () => {})\n</script>\n<template><p>{{ msg }}</p></template>\n`, { syms: [], rels: [] }],
  ["defineSlots-typed", `<script setup lang="ts">\n  const slots = defineSlots<{ header(props: { seq: number }): any }>()\n</script>\n<template><slot name="header" /></template>\n`, { syms: [], rels: [] }],
  ["vapor-if", `<script setup>\n  import { ref } from 'vue'\n  const ok = ref(true)\n</script>\n<template>\n  <button @click="ok = !ok">toggle</button>\n  <div v-if="ok">on</div>\n  <span v-if="!ok">off</span>\n</template>\n`, { syms: ["ok"], rels: [] }],
  // --- pin the classic emission surface against the modern spellings ---
  ["emits-callable", `<script setup>\n  const emit = defineEmits(['save'])\n  const save = () => emit('save')\n</script>\n<template><button @click="save">go</button></template>\n`, { syms: ["save"], rels: [] }],
  ["component-usage", `<script setup>\n  import ChildWidget from "./ChildWidget.vue"\n</script>\n<template><ChildWidget :size="3" /></template>\n`, { syms: [], rels: [["?", "ChildWidget"]] }],
]

async function main() {
  const rows: any[] = []
  for (const [name, src, expected] of CASES) {
    const p = join(tmpdir(), `web-adv-vue-${name.replace(/[^a-z0-9-]/gi, "_")}.vue`)
    writeFileSync(p, src)
    let treeErr = 0
    try {
      const parser = await ASTEngine.getParser("vue")
      const tree = parser.parse(src)
      if ((tree.rootNode as any).hasError) {
        const stack = [tree.rootNode]
        while (stack.length) {
          const n = stack.pop()!
          if (n.type === "ERROR" || n.isMissing) treeErr++
          for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) stack.push(c) }
        }
      }
    } catch { treeErr = -1 }
    let symbols: any[] = []
    let relationships: any[] = []
    let pipelineErr = 0
    let note = ""
    try {
      const parsed = await parseFile(p, process.cwd())
      symbols = parsed.symbols ?? []
      relationships = parsed.relationships ?? []
      pipelineErr = (parsed.errors ?? []).length
    } catch (e: any) { note = String(e?.message ?? e).slice(0, 90) }
    const names = new Set(symbols.map((s: any) => s.name))
    const missingSyms = expected.syms.filter((n) => !names.has(n))
    const relTargets = new Set(relationships.map((r: any) => r.target))
    const missingRels = expected.rels.filter(([, t]) => t !== "?" && !relTargets.has(t))
    const macroLeak = symbols.filter((s: any) => /^(defineModel|defineSlots|defineProps|defineEmits|defineExpose|withDefaults|defineOptions)$/.test(s.name)).map((s: any) => s.name)
    rows.push({ case: name, grammarErrNodes: treeErr, pipelineErrors: pipelineErr, symbols: symbols.length, relationships: relationships.length, missingSyms, missingRels, macroLeak })
    console.log(
      `${name.padEnd(26)} grammarErr=${String(treeErr).padStart(3)} pipeErr=${pipelineErr} syms=${symbols.length} rels=${relationships.length}` +
      `${missingSyms.length ? " MISSING:" + missingSyms.join(",") : ""}${missingRels.length ? " MISSING-REL:" + missingRels.map(([, t]) => t).join(",") : ""}` +
      `${macroLeak.length ? " MACRO-LEAK:" + macroLeak.join(",") : ""}${note ? " | " + note : ""}`,
    )
  }
  console.log(JSON.stringify(rows, null, 1))
}
main().catch((e) => { console.error(e); process.exit(1) })
