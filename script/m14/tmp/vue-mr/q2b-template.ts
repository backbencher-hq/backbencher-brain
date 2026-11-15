// Q2b — the TEMPLATE layer: the only part of the vue analyzer that is its own
// code rather than a delegation. Every construct here is vue's own extraction.
import { vue, rels, syms, names, probe, report } from "./harness"

const S = (body: string) => `<script>\nexport default {\n  name: 'W',\n  data: () => ({ count: 0, total: 1, label: 'x', items: [], row: null, show: true, flag: false, n: 1, s: 'a' }),\n  methods: { go(v) { return v } }\n}\n</script>\n`

async function main() {
  console.log("=== Q2b.1  shadowing: does the template walker model real Vue scope? ===")
  for (const [label, tpl] of [
    ["v-for over a member with the same var name", `<template><div v-for="items in rows">{{ items }}</div></template>`],
    ["slot prop shadows a member", `<template><MyT><template #default="{ count }">{{ count }}</template></MyT></template>`],
    ["slot shorthand #", `<template><MyT><template #item="{ count }">{{ count }}</template></MyT></template>`],
    ["nested v-for shadowing an outer var", `<template><div v-for="a in list"><span v-for="a in a">{{ a }}</span></div></template>`],
    ["v-for destructure", `<template><div v-for="({ id, name }, i) in items">{{ id }}{{ name }}{{ i }}</div></template>`],
    ["v-slot full form", `<template><MyT><template v-slot:body="{ count }">{{ count }}</template></MyT></template>`],
    ["v-for with index only", `<template><div v-for="(v, i) in items">{{ v }}{{ i }}</div></template>`],
    ["v-for over a function call", `<template><div v-for="x in getItems()">{{ x }}</div></template>`],
  ] as const) {
    const r = await vue(`${tpl}\n${S("")}`, "/tmp/probe/T.vue")
    const dataKeys = new Set(["count", "total", "label", "items", "row", "show", "flag", "n", "s", "go"])
    const uses = rels(r, "uses").filter((x: any) => dataKeys.has(String(x.target)))
    console.log(`  ${label.padEnd(48)} uses=${JSON.stringify(uses.map((x: any) => `${x.target}@${x.line_number}`))}`)
  }

  console.log("\n=== Q2b.2  object-literal keys in a template expression (the documented hole) ===")
  {
    const r = await vue(`<template><div :style="{ color: count }">{{ { a: total } }}</div></template>\n${S("")}`, "/tmp/probe/T2.vue")
    const uses = rels(r, "uses").map((x: any) => x.target)
    console.log(`  :style="{ color: count }" + {{ { a: total } }} -> uses=${JSON.stringify(uses)}`)
    console.log(`  (is the KEY 'color'/'a' emitted as a use if a member shares the name?)`)
    const r2 = await vue(`<template><div :x="{ color: color }"/></template>\n<script>export default { data: () => ({ color: 1 }) }</script>`, "/tmp/probe/T3.vue")
    console.log(`  key and value share a name: {{ color: color }} -> uses=${JSON.stringify(rels(r2, "uses").map((x: any) => x.target))}`)
  }

  console.log("\n=== Q2b.3  assignment / update expressions in a template ===")
  for (const [label, expr] of [
    ["v-model on a member", "v-model=\"count\""],
    ["v-model on a member member-path", "v-model=\"row.name\""],
    ["assignment @click", "@click=\"count = 5\""],
    ["compound assignment", "@click=\"total += 1\""],
    ["logical", "v-if=\"count && total\""],
    ["nullish", "v-if=\"count ?? total\""],
    ["ternary", "v-if=\"count ? total : n\""],
    ["optional chain", "{{ row?.name }}"],
    ["index access", "{{ items[0] }}"],
    ["filter", "{{ label.toUpperCase() }}"],
    ["array method", "{{ items.map(x => x) }}"],
    ["nested template literal", "@click=\"go(`a${count}b`)\""],
    ["escaped quote in string", "@click=\"go('it\\\\'s')\""],
    ["regex-ish slash in string", ":x=\"go('a/b')\""],
    ["comment-like in string", ":x=\"go('// not a comment')\""],
    ["unquoted attribute value", ":x=count"],
    ["empty expression", "{{ }}\""],
  ] as const) {
    const r = await vue(`<template><div ${expr}></div></template>\n${S("")}`, "/tmp/probe/T4.vue")
    const dataKeys = new Set(["count", "total", "label", "items", "row", "show", "flag", "n", "s", "go"])
    const uses = rels(r, "uses").filter((x: any) => dataKeys.has(String(x.target)))
    const inst = rels(r, "instantiates")
    console.log(`  ${label.padEnd(32)} uses=${JSON.stringify(uses.map((x: any) => x.target))} instantiates=${JSON.stringify(inst.map((x: any) => x.target))}`)
  }

  console.log("\n=== Q2b.4  component-usage detection: what is called a component? ===")
  for (const [label, tpl] of [
    ["kebab-case unknown", `<my-widget />`],
    ["PascalCase unknown", `<MyWidget />`],
    ["dotted component", `<Form.Input />`],
    ["namespaced", `<svg:circle />`],
    ["slot outlet", `<slot name="header" />`],
    ["built-in html", `<div><span><p></p></span></div>`],
    ["svg", `<svg><path/></svg>`],
    ["custom element (web component)", `<my-element></my-element>`],
    ["uppercase-only", `<X />`],
    ["dotted lowercase", `<foo.bar />`],
    ["component with dot in a directive", `<component :is="X" />`],
  ] as const) {
    const r = await vue(`<template>${tpl}</template>\n<script>export default { name: 'W' }</script>`, "/tmp/probe/T5.vue")
    const inst = rels(r, "instantiates")
    console.log(`  ${label.padEnd(32)} -> ${JSON.stringify(inst.map((x: any) => `${x.target}(conf=${x.confidence})`))}`)
  }

  console.log("\n=== Q2b.5  complexity accounting: which directives count as decisions? ===")
  for (const [label, tpl] of [
    ["v-if", `<div v-if="count"/>`],
    ["v-else-if", `<div v-if="count"/><div v-else-if="total"/>`],
    ["v-show", `<div v-show="count"/>`],
    ["v-for", `<div v-for="x in items"/>`],
    ["v-else", `<div v-if="count"/><div v-else/>`],
    ["v-bind", `<div :x="count"/>`],
    ["v-on", `<div @x="go(1)"/>`],
    ["v-model", `<div v-model="count"/>`],
    ["v-text", `<div v-text="count"/>`],
    ["v-html", `<div v-html="count"/>`],
    ["v-pre", `<div v-pre>{{ count }}</div>`],
    ["v-once", `<div v-once>{{ count }}</div>`],
    ["v-cloak", `<div v-cloak>{{ count }}</div>`],
    ["v-memo", `<div v-memo="[count]">{{ count }}</div>`],
  ] as const) {
    const r = await vue(`<template>${tpl}</template>\n${S("")}`, "/tmp/probe/T6.vue")
    console.log(`  ${label.padEnd(12)} complexity=${r.metadata?.complexity}`)
  }

  console.log("\n=== Q2b.6  multiple <template> blocks, and a template AFTER the script ===")
  {
    const src = [
      "<script>",                                     // 1
      "export default { name: 'W', data: () => ({ count: 0 }) }", // 2
      "</script>",                                    // 3
      "<template>",                                   // 4
      "  <p>{{ count }}</p>",                         // 5
      "</template>",                                  // 6
    ].join("\n")
    const r = await vue(src, "/tmp/probe/T7.vue")
    console.log(`  script-first SFC: uses=${JSON.stringify(rels(r, "uses").map((x: any) => `${x.source}->${x.target}@${x.line_number}`))}`)
  }

  console.log("\n=== Q2b.7  a .vue with NO template but a script (a .ts in disguise) ===")
  {
    const r = await vue(`<script lang="ts">
export interface Props { id: string }
export const helper = 1
export default { name: 'W' }
</script>`, "/tmp/probe/T8.vue")
    console.log(`  symbols: ${JSON.stringify(names(r))}`)
    console.log(`  exports: ${JSON.stringify((r.exports ?? []).map((e: any) => e.name))}`)
  }

  report()
}
main()
