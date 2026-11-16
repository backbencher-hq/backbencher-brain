// FINDINGS REGISTER — vue master review, 2026-09-30.
// Every claim below is asserted here against the LIVE analyzer through the
// production path, and each carries the counterfactual that proves the shape is
// the analyzer's doing and not the grammar's.
import * as path from "path"
import { vue, plain, rels, syms, names, probe, report } from "./harness"

const CORPUS = "<corpus-root>/bb_tests/repositories"

async function main() {
  console.log("# F1 — Options-API INHERITANCE is not a relationship")
  await probe("F1a extends: Base -> no `extends` edge (counterfactual: the same text as .ts has one)", async () => {
    const body = "export default {\n  name: 'Child',\n  extends: BasePanel,\n}"
    const v = await vue(`<template><p/></template>\n<script>\n${body}\n</script>`, "/tmp/probe/F1.vue")
    const t = await plain("class Child extends BasePanel {}\n", "/tmp/probe/F1.ts")
    const vExt = rels(v, "extends")
    const tExt = rels(t, "extends")
    console.log(`     .vue  extends edges: ${JSON.stringify(vExt.map((x: any) => `${x.source}->${x.target}`))}`)
    console.log(`     .ts   extends edges: ${JSON.stringify(tExt.map((x: any) => `${x.source}->${x.target}`))}`)
    console.log(`     .vue  every edge:    ${JSON.stringify(rels(v).map((x: any) => `${x.type}:${x.source}->${x.target}`))}`)
    if (vExt.length) console.log("     NOTE: emits an extends edge now — finding is closed")
  })
  await probe("F1b extends: [A, B] and mixins: [A, B] produce no inheritance edge either", async () => {
    const v = await vue(`<template><p/></template>
<script>
export default { name: 'C', extends: [BaseA, BaseB], mixins: [M1, M2], methods: { own() {} } }
</script>`, "/tmp/probe/F1b.vue")
    console.log(`     extends=${rels(v, "extends").length} implements=${rels(v, "implements").length} overrides=${rels(v, "overrides").length}`)
    console.log(`     all: ${JSON.stringify(rels(v).map((x: any) => `${x.type}:${x.source}->${x.target}`))}`)
  })

  console.log("\n# F2 — provide()/inject() is the third leg of the contract and is absent")
  await probe("F2a provide() keys never become symbols (counterfactual: props DO)", async () => {
    const v = await vue(`<template><p/></template>
<script>
export default {
  name: 'P',
  props: { myProp: String },
  provide() { return { theme: this.theme, locale: 'en' } }
}
</script>`, "/tmp/probe/F2.vue")
    console.log(`     symbols: ${JSON.stringify(names(v))}`)
    console.log(`     myProp isProp=${JSON.stringify(syms(v, "myProp").map((s: any) => !!s.metadata?.isProp))}`)
    console.log(`     theme symbol: ${JSON.stringify(syms(v, "theme").map((s: any) => s.kind))}`)
  })
  await probe("F2b inject: ['theme'] array form and inject: {…} object form", async () => {
    for (const [label, inj] of [["array", `inject: ['theme', 'locale']`], ["object", `inject: { theme: { default: 'dark' } }`]] as const) {
      const v = await vue(`<template><p/></template>\n<script>\nexport default { name: 'C', ${inj} }\n</script>`, "/tmp/probe/F2b.vue")
      console.log(`     ${label} form: symbols=${JSON.stringify(names(v))}`)
    }
  })
  await probe("F2c a real provide(key, {...}) call — its members are ownerless, as measured on the corpus", async () => {
    const v = await vue(`<template><p/></template>
<script setup>
import { provide } from 'vue'
provide('tour', { updateModelValue() { return 1 }, onClose() { return 2 } })
</script>`, "/tmp/probe/F2c.vue")
    console.log(`     symbols: ${JSON.stringify(names(v))}`)
    for (const s of v.symbols ?? []) if (s.kind === "method") console.log(`       method ${s.name} owner=${s.ownerName ?? "NONE"}`)
  })

  console.log("\n# F3 — withDefaults() defaults are dropped")
  await probe("F3a the prop is extracted; the default is not", async () => {
    const v = await vue(`<template><p/></template>
<script setup lang="ts">
import { withDefaults, defineProps } from 'vue'
const props = withDefaults(defineProps<{ size?: number; label?: string }>(), { size: 10, label: 'hi' })
</script>`, "/tmp/probe/F3.vue")
    console.log(`     size: ${JSON.stringify(syms(v, "size").map((s: any) => ({ kind: s.kind, md: s.metadata, range: s.range })))}`)
    console.log(`     label: ${JSON.stringify(syms(v, "label").map((s: any) => ({ kind: s.kind, md: s.metadata })))}`)
  })
  await probe("F3b counterfactual: a runtime default() in an Options prop IS recorded?", async () => {
    const v = await vue(`<template><p/></template>
<script>
export default { name: 'W', props: { size: { type: Number, default: 10 } } }
</script>`, "/tmp/probe/F3b.vue")
    console.log(`     size: ${JSON.stringify(syms(v, "size").map((s: any) => ({ kind: s.kind, md: s.metadata })))}`)
  })

  console.log("\n# F4 — defineOptions({ name }) does not rename the component")
  await probe("F4a the component symbol is the FILE stem; the declared name is lost", async () => {
    const v = await vue(`<template><p/></template>
<script setup>
defineOptions({ name: 'MyWidget' })
</script>`, "/tmp/probe/F4.vue")
    const classes = (v.symbols ?? []).filter((s: any) => s.kind === "class")
    console.log(`     file=FileStem.vue, defineOptions name='MyWidget' -> class symbols ${JSON.stringify(classes.map((s: any) => s.name))}`)
    console.log(`     counterfactual, Options API: ${JSON.stringify((await vue(`<template><p/></template>\n<script>\nexport default { name: 'MyWidget' }\n</script>`, "/tmp/probe/F4.vue")).symbols.filter((s: any) => s.kind === "class").map((s: any) => s.name))}`)
  })

  console.log("\n# F5 — setup() is not a symbol")
  await probe("F5a the Composition-API entry point in the Options API", async () => {
    const v = await vue(`<template><p/></template>
<script>
export default { name: 'X', setup() { return {} }, created() {} }
</script>`, "/tmp/probe/F5.vue")
    console.log(`     symbols: ${JSON.stringify(names(v))}   (created IS recognised: ${syms(v, "created").length > 0}, setup is not: ${syms(v, "setup").length === 0})`)
  })

  console.log("\n# F6 — raw computed keys survive in `data` and `props` (the M2/VSD15 ruling applied to 1 of 3 sites)")
  await probe("F6a data: computed key surfaces as a symbol named `[dyn]`", async () => {
    for (const [label, body] of [
      ["data", `export default { data: () => ({ [dyn]: 1, plain: 2 }) }`],
      ["props", `export default { props: { [dyn]: Number, plain: String } }`],
      ["emits", `export default { emits: { [dyn]: null } }`],
      ["methods (the FIXED site)", `export default { methods: { [dyn]() {}, plain() {} } }`],
    ] as const) {
      const v = await vue(`<template><p/></template>\n<script>\n${body}\n</script>`, "/tmp/probe/F6.vue")
      const raw = (v.symbols ?? []).filter((s: any) => String(s.name).startsWith("["))
      console.log(`     ${label.padEnd(22)} symbols=${JSON.stringify(names(v))}${raw.length ? "  <-- RAW" : ""}`)
    }
  })
  await probe("F6b an index signature becomes a property named `[key]`", async () => {
    const v = await vue(`<template><p/></template>
<script lang="ts">
interface KeyControlMapping { [key: string]: KeyControl }
</script>`, "/tmp/probe/F6b.vue")
    console.log(`     symbols: ${JSON.stringify((v.symbols ?? []).map((s: any) => ({ name: s.name, kind: s.kind, md: s.metadata, owner: s.ownerName })))}`)
  })

  console.log("\n# F7 — hasTypeInference is hardcoded false")
  await probe("F7a a lang=ts SFC with an interface and annotations still says false", async () => {
    const src = `<template><p/></template>
<script lang="ts">
interface P { id: string }
const p: P = { id: 'x' }
export default { name: 'W' }
</script>`
    const v = await vue(src, "/tmp/probe/F7.vue")
    const t = await plain("interface P { id: string }\nconst p: P = {id:'x'}", "/tmp/probe/F7.ts")
    console.log(`     .vue hasTypeInference=${v.metadata?.hasTypeInference}   .ts hasTypeInference=${t.metadata?.hasTypeInference}`)
    console.log(`     .vue symbols: ${JSON.stringify(names(v))}`)
  })

  console.log("\n# F8 — split component identity: two Class symbols, disjoint edge sets")
  await probe("F8a a `name:` option produces a second Class that owns nothing the first does not", async () => {
    const v = await vue(`<template><p>{{ label }}</p></template>
<script>
export default { name: 'MyWidget', props: { label: String } }
</script>`, "/tmp/probe/F8.vue")
    const classes = (v.symbols ?? []).filter((s: any) => s.kind === "class")
    console.log(`     file=F8.vue; class symbols: ${JSON.stringify(classes.map((s: any) => ({ name: s.name, md: s.metadata })))}`)
    for (const rel of rels(v)) console.log(`       ${String(rel.type).padEnd(11)} ${String(rel.source).padEnd(9)} -> ${rel.target}`)
  })

  console.log("\n# F9 — a namespaced builtin tag is a component usage; a dotted tag is not a leaf")
  await probe("F9a <svg:circle/> instantiates; <Form.Input/> targets the ROOT", async () => {
    for (const [label, tpl] of [["<svg:circle />", `<svg:circle />`], ["<svg:rect />", `<svg:rect />`], ["<Form.Input />", `<Form.Input />`], ["<Form.Input.Text />", `<Form.Input.Text />`], ["<x-foo.Bar />", `<x-foo.Bar />`], ["<circle />", `<circle />`]] as const) {
      const v = await vue(`<template>${tpl}</template>\n<script>export default { name: 'W' }</script>`, "/tmp/probe/F9.vue")
      console.log(`     ${label.padEnd(22)} -> ${JSON.stringify(rels(v, "instantiates").map((x: any) => x.target))}`)
    }
  })

  console.log("\n# F10 — an unquoted object-literal KEY in a template expression reads as a member")
  await probe("F10a {{ { count: 1 } }} emits Uses(count); the quoted form does not", async () => {
    const s = `<script>export default { name: 'W', data: () => ({ count: 0 }) }</script>`
    for (const [label, expr] of [["unquoted key", `{{ { count: 1 } }}`], ["quoted key", `{{ { 'count': 1 } }}`], ["key+value", `{{ { count: total } }}`]] as const) {
      const v = await vue(`<template><div>${expr}</div></template>\n${s}`, "/tmp/probe/F10.vue")
      console.log(`     ${label.padEnd(14)} uses=${JSON.stringify(rels(v, "uses").map((x: any) => x.target))}`)
    }
  })

  console.log("\n# F11 — the `uses -> implements` keyword edge is inherited from the JS sub-analyzer")
  await probe("F11a identical script body: .js and .vue emit it, .ts and .vue[lang=ts] do not", async () => {
    const body = "export class Impl implements Service {\n  run() { return 1 }\n}"
    for (const [label, file, src] of [
      [".ts", "/tmp/probe/K.ts", body],
      [".js", "/tmp/probe/K.js", body],
      [".vue <script>", "/tmp/probe/K.vue", `<template><p/></template>\n<script>\n${body}</script>`],
      [".vue <script lang=ts>", "/tmp/probe/K.vue", `<template><p/></template>\n<script lang="ts">\n${body}</script>`],
    ] as const) {
      const r = await plain(src, file)
      const kw = rels(r).filter((x: any) => ["implements", "extends", "class", "return", "interface"].includes(String(x.target)))
      console.log(`     ${label.padEnd(24)} keyword targets: ${JSON.stringify(kw.map((x: any) => `${x.type}:${x.source}->${x.target}`))}`)
    }
  })

  report()
  void CORPUS
}
main()
