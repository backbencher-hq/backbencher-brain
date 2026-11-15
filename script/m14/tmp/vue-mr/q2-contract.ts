// Q2 — the Vue-specific CONTRACT surface. Every one of these is a construct a
// .vue file writes that the TS analyzer's per-node model covers and the vue
// analyzer's Options/macro dispatch does not.
import { vue, rels, syms, names, assertTrue, assertEq, probe, report } from "./harness"

const TEMPLATE = (body: string) => `<template>\n  <div>{{ probe }}</div>\n</template>\n\n<script>\n${body}\n</script>\n`

async function main() {
  console.log("=== Q2.1  Options-API INHERITANCE: `extends:` and `mixins:` ===")

  await probe("A1 extends: { ... } — is the base component an extends edge?", async () => {
    const r = await vue(TEMPLATE(`export default {
  name: 'Child',
  extends: BasePanel,
  methods: { go() { return 1 } }
}`))
    const ext = rels(r, "extends")
    console.log(`     extends edges: ${JSON.stringify(ext.map((x: any) => `${x.source}->${x.target}`))}`)
    console.log(`     symbols: ${JSON.stringify(names(r))}`)
    assertTrue(ext.length > 0, "no `extends` edge for extends: BasePanel — Vue's own inheritance is invisible")
  })

  await probe("A2 extends: { ... } inline object form", async () => {
    const r = await vue(TEMPLATE(`export default {
  name: 'Child',
  extends: { methods: { inherited() { return 2 } } }
}`))
    const syms_ = syms(r, "inherited")
    console.log(`     inherited symbols: ${JSON.stringify(syms_.map((s: any) => `${s.name}:${s.kind} owner=${s.ownerName}`))}`)
    console.log(`     labels: ${JSON.stringify([...new Set(rels(r).map((x: any) => x.type))])}`)
  })

  await probe("A3 mixins: [M1, M2] — do mixin members reach the component?", async () => {
    const r = await vue(TEMPLATE(`export default {
  name: 'Child',
  mixins: [M1, M2],
  methods: { own() { return 3 } }
}`))
    console.log(`     symbols: ${JSON.stringify(names(r))}`)
    console.log(`     rels: ${JSON.stringify(rels(r).map((x: any) => `${x.type} ${x.source}->${x.target}`))}`)
  })

  console.log("\n=== Q2.2  provide()/inject() — the third leg of the component contract ===")

  await probe("B1 provide(key, {...}) — are the provided keys contract symbols?", async () => {
    const r = await vue(TEMPLATE(`export default {
  name: 'Prov',
  provide() { return { theme: this.theme, locale: 'en' } }
}`))
    const provided = syms(r, "theme").concat(syms(r, "locale"))
    console.log(`     provide keys as symbols: ${JSON.stringify(provided.map((s: any) => `${s.name}:${s.kind} owner=${s.ownerName}`))}`)
    console.log(`     all symbols: ${JSON.stringify(names(r))}`)
    assertTrue(provided.length === 2, "provide() keys never become symbols — only props/emits are extracted as contract")
  })

  await probe("B2 inject('theme') — is the injected key contract?", async () => {
    const r = await vue(TEMPLATE(`export default {
  name: 'Cons',
  inject: ['theme', 'locale']
}`))
    console.log(`     inject array form symbols: ${JSON.stringify(names(r))}`)
    assertTrue(syms(r, "theme").length > 0, "inject: ['theme'] yields no symbol")
  })

  await probe("B3 inject: { theme: {...} } object form", async () => {
    const r = await vue(TEMPLATE(`export default {
  name: 'Cons',
  inject: { theme: { default: 'dark' }, locale: { from: 'locale', default: 'en' } }
}`))
    console.log(`     inject object form symbols: ${JSON.stringify(names(r))}`)
  })

  await probe("B4 script-setup provide() — a real provide() call, the modern form", async () => {
    const r = await vue(`<template><div/></template>
<script setup>
import { provide, reactive } from 'vue'
const theme = reactive({ dark: true })
provide('theme', theme)
provide('api', { save() { return 1 }, load() { return 2 } })
</script>`)
    console.log(`     symbols: ${JSON.stringify(names(r))}`)
    console.log(`     rels: ${JSON.stringify(rels(r).map((x: any) => `${x.type} ${x.source}->${x.target}`))}`)
  })

  console.log("\n=== Q2.3  compiler macros: filtered from calls, extracted as contract? ===")

  await probe("C1 withDefaults(defineProps<...>(), {...}) — defaults are public contract", async () => {
    const r = await vue(`<template><div/></template>
<script setup lang="ts">
import { withDefaults, defineProps } from 'vue'
const props = withDefaults(defineProps<{ size?: number; label?: string }>(), { size: 10, label: 'hi' })
</script>`)
    const p = syms(r, "size")
    console.log(`     size symbol: ${JSON.stringify(p.map((s: any) => ({ kind: s.kind, owner: s.ownerName, md: s.metadata })))}`)
    console.log(`     all symbols: ${JSON.stringify(names(r))}`)
    assertTrue(p.length > 0 && p[0].metadata?.defaultValue !== undefined, "withDefaults default value never recorded on the prop symbol")
  })

  await probe("C2 defineExpose({ save, load }) — the component's PUBLIC surface", async () => {
    const r = await vue(`<template><div/></template>
<script setup>
import { ref, defineExpose } from 'vue'
const save = () => 1
const load = () => 2
defineExpose({ save, load })
</script>`)
    const s = syms(r, "save")
    console.log(`     save symbol: ${JSON.stringify(s.map((x: any) => ({ kind: x.kind, owner: x.ownerName, vis: x.visibility, md: x.metadata })))}`)
    assertTrue(s.some((x: any) => x.visibility === "public"), "defineExpose members are not marked public — the exposed surface is private by default")
  })

  await probe("C3 defineModel() — a two-way contract", async () => {
    const r = await vue(`<template><div/></template>
<script setup>
import { defineModel } from 'vue'
const model = defineModel()
</script>`)
    console.log(`     model symbol: ${JSON.stringify(syms(r, "model").map((s: any) => ({ kind: s.kind, owner: s.ownerName, md: s.metadata })))}`)
  })

  await probe("C4 defineSlots<{...}>() — the slot contract", async () => {
    const r = await vue(`<template><div/></template>
<script setup lang="ts">
defineSlots<{ default(props: { msg: string }): any }>()
</script>`)
    console.log(`     symbols: ${JSON.stringify(names(r))}`)
  })

  await probe("C5 defineOptions({ name, inheritAttrs }) — component identity", async () => {
    const r = await vue(`<template><div/></template>
<script setup>
defineOptions({ name: 'MyWidget', inheritAttrs: false })
</script>`)
    const comp = (r.symbols ?? []).filter((s: any) => s.kind === "class")
    console.log(`     class symbols: ${JSON.stringify(comp.map((s: any) => ({ name: s.name, range: s.range })))}`)
    assertTrue(comp.some((s: any) => s.name === "MyWidget"), "defineOptions({ name }) does not rename the component symbol")
  })

  console.log("\n=== Q2.4  Options API shapes with no branch at all ===")

  await probe("D1 setup() lifecycle hook (Options API)", async () => {
    const r = await vue(TEMPLATE(`export default {
  name: 'X',
  setup() { return {} }
}`))
    console.log(`     symbols: ${JSON.stringify(names(r))}`)
    assertTrue(syms(r, "setup").length > 0, "setup() — the Composition-API entry point — is not a symbol")
  })

  await probe("D2 methods: { async save(id: string): Promise<void> {} } TS signature", async () => {
    const r = await vue(`<template><div/></template>
<script lang="ts">
export default {
  name: 'X',
  methods: {
    async save(id: string): Promise<void> { await this.go(id) },
    go(id: string) { return id }
  }
}
</script>`)
    const s = syms(r, "save")
    console.log(`     save: ${JSON.stringify(s.map((x: any) => ({ kind: x.kind, params: x.parameters, ret: x.returnType, qc: x.qualified_calls })))}`)
  })

  await probe("D3 data() as an arrow property (Vue 2.6.12+ / 3.x style)", async () => {
    const r = await vue(TEMPLATE(`export default {
  name: 'X',
  data: () => ({ count: 0, list: [] })
}`))
    console.log(`     symbols: ${JSON.stringify(names(r))}`)
  })

  await probe("D4 provide as an object property, not a method", async () => {
    const r = await vue(TEMPLATE(`export default {
  name: 'X',
  provide: { theme: () => this.theme }
}`))
    console.log(`     symbols: ${JSON.stringify(names(r))}`)
    console.log(`     theme symbol: ${JSON.stringify(syms(r, "theme").map((s: any) => ({ kind: s.kind, owner: s.ownerName, md: s.metadata })))}`)
  })

  await probe("D5 expose: [...] (Vue 3 options API)", async () => {
    const r = await vue(TEMPLATE(`export default {
  name: 'X',
  expose: ['save', 'load']
}`))
    console.log(`     symbols: ${JSON.stringify(names(r))}`)
  })

  await probe("D6 inheritAttrs / model option (contract declarations)", async () => {
    const r = await vue(TEMPLATE(`export default {
  name: 'X',
  model: { prop: 'checked', event: 'change' },
  inheritAttrs: false
}`))
    console.log(`     symbols: ${JSON.stringify(names(r))}`)
  })

  await probe("D7 components: { Foo, Bar } — the LOCAL registration table", async () => {
    const r = await vue(`<template>
  <Foo/><Bar/>
</template>
<script>
import Foo from './Foo.vue'
import Bar from './Bar.vue'
export default {
  name: 'X',
  components: { Foo, Bar }
}
</script>`)
    const inst = rels(r, "instantiates")
    console.log(`     instantiates: ${JSON.stringify(inst.map((x: any) => `${x.source}->${x.target} conf=${x.confidence} ev=${x.metadata?.evidenceClass}`))}`)
    console.log(`     all rels: ${JSON.stringify(rels(r).map((x: any) => `${x.type} ${x.source}->${x.target}`))}`)
  })

  await probe("D8 <component :is=\"X\"> — dynamic component", async () => {
    const r = await vue(`<template>
  <component :is="currentView" />
</template>
<script>
export default { name: 'X', data: () => ({ currentView: 'div' }) }
</script>`)
    console.log(`     rels: ${JSON.stringify(rels(r).map((x: any) => `${x.type} ${x.source}->${x.target}`))}`)
  })

  await probe("D9 <template #default=\"{ row }\"> slot destructuring", async () => {
    const r = await vue(`<template>
  <MyTable>
    <template #default="{ row }">{{ row.name }}</template>
  </MyTable>
</template>
<script>
export default { name: 'X', data: () => ({ row: null }) }
</script>`)
    const uses = rels(r, "uses")
    console.log(`     uses: ${JSON.stringify(uses.map((x: any) => `${x.source}->${x.target}@${x.line_number}`))}`)
  })

  await probe("D10 v-model: a two-way contract edge", async () => {
    const r = await vue(`<template>
  <Child v-model="value" />
</template>
<script>
export default { name: 'X', props: ['value'], emits: ['update:value'] }
</script>`)
    console.log(`     rels: ${JSON.stringify(rels(r).map((x: any) => `${x.type} ${x.source}->${x.target}`))}`)
  })

  report()
}
main()
