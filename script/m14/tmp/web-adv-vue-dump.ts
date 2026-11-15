import { writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parseFile } from "../../../src/ast/pool-worker"
const CASES: Array<[string, string]> = [
  ["defineModel-basic", `<script setup lang="ts">\n  const model = defineModel<string>({ required: true })\n  console.log(model.value)\n</script>\n<template><input v-model="model" /></template>\n`],
  ["generic-component", `<script setup lang="ts" generic="T extends string | number">\n  import { format } from "./format"\n  const props = defineProps<{ items: T[] }>()\n  const first = () => format(props.items[0])\n</script>\n<template><ul><li v-for="i in props.items">{{ i }}</li></ul></template>\n`],
  ["component-usage", `<script setup>\n  import ChildWidget from "./ChildWidget.vue"\n</script>\n<template><ChildWidget :size="3" /></template>\n`],
]
for (const [name, src] of CASES) {
  const p = join(tmpdir(), `web-adv-vue-dump-${name}.vue`)
  writeFileSync(p, src)
  const r = await parseFile(p, process.cwd())
  console.log(`=== ${name}`)
  for (const s of r.symbols ?? []) console.log(`  sym ${s.kind}:${s.name}${s.ownerName ? " owner=" + s.ownerName : ""}`)
  for (const rel of r.relationships ?? []) console.log(`  rel ${rel.type} ${rel.source} -> ${rel.target}${rel.line_number ? " @" + rel.line_number : ""}`)
}
