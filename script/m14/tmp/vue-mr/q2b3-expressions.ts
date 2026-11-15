// Q2b.3b — re-run of the expression probes with WELL-FORMED templates, plus the
// phantom `v` use Q2b.2 surfaced.
import { vue, rels, syms, names, probe, report } from "./harness"

const S = `<script>
export default {
  name: 'W',
  data: () => ({ count: 0, total: 1, label: 'x', items: [], row: null, show: true, flag: false, n: 1, s: 'a' }),
  methods: { go(v) { return v } }
}
</script>`

async function main() {
  console.log("=== Q2b.3b.0  where does the phantom `v` come from? ===")
  {
    const r = await vue(`<template><div :style="{ color: count }"/></template>\n${S}`, "/tmp/probe/V.vue")
    console.log(`  symbols: ${JSON.stringify(names(r))}`)
    console.log(`  uses: ${JSON.stringify(rels(r, "uses").map((x: any) => `${x.source}->${x.target}@${x.line_number}`))}`)
    const vSym = syms(r, "v")
    console.log(`  symbol 'v': ${JSON.stringify(vSym.map((s: any) => ({ kind: s.kind, owner: s.ownerName, scope: s.scope, range: s.range })))}`)
    // and the same file WITHOUT the param
    const r2 = await vue(`<template><div :style="{ color: count }"/></template>
<script>
export default { name: 'W', data: () => ({ count: 0 }) }
</script>`, "/tmp/probe/V2.vue")
    console.log(`  without a param: uses=${JSON.stringify(rels(r2, "uses").map((x: any) => x.target))}`)
  }

  console.log("\n=== Q2b.3b.1  well-formed template expressions ===")
  const cases: Array<[string, string]> = [
    ["interp member", `{{ count }}`],
    ["interp member path", `{{ row.name }}`],
    ["interp optional chain", `{{ row?.name }}`],
    ["interp index", `{{ items[0] }}`],
    ["interp method call", `{{ label.toUpperCase() }}`],
    ["interp array method", `{{ items.map(x => x) }}`],
    ["interp ternary", `{{ count ? total : n }}`],
    ["interp object literal", `{{ { a: count } }}`],
    ["interp object key==member", `{{ { count: count } }}`],
    ["bind member", `""`], // placeholder replaced below
  ]
  for (const [label, expr] of cases) {
    if (!expr) continue
    const tpl = label.startsWith("interp") ? `<template><div>${expr}</div></template>` : `<template><div :x="${expr}"></div></template>`
    const r = await vue(`${tpl}\n${S}`, "/tmp/probe/E.vue")
    const known = new Set(["count", "total", "label", "items", "row", "show", "flag", "n", "s", "go", "v"])
    const uses = rels(r, "uses").filter((x: any) => known.has(String(x.target)))
    console.log(`  ${label.padEnd(26)} uses=${JSON.stringify(uses.map((x: any) => x.target))}`)
  }

  console.log("\n=== Q2b.3b.2  the OBJECT-KEY hole, isolated: does a key become a use? ===")
  for (const [label, expr] of [
    ["key is a member name, value is a literal", `{{ { count: 1 } }}`],
    ["key is a member name, value is a member", `{{ { count: total } }}`],
    ["key is a string that names a member", `{{ { 'count': 1 } }}`],
    ["shorthand { count }", `{{ { count } }}`],
    ["nested object", `{{ { a: { count: 1 } } }}`],
    ["destructuring-ish in a call", `{{ go({ count: 1 }) }}`],
  ] as const) {
    const tpl = `<template><div>${expr}</div></template>`
    const r = await vue(`${tpl}\n${S}`, "/tmp/probe/K.vue")
    const uses = rels(r, "uses").map((x: any) => x.target)
    console.log(`  ${label.padEnd(38)} uses=${JSON.stringify(uses)}`)
  }

  console.log("\n=== Q2b.3b.3  namespaced / dotted TAGS ===")
  for (const [label, tpl] of [
    ["<svg:circle />", `<svg:circle />`],
    ["<svg:rect />", `<svg:rect />`],
    ["<Form.Input />", `<Form.Input />`],
    ["<form.input />", `<form.input />`],
    ["<Form.Input.Text />", `<Form.Input.Text />`],
    ["<x-foo.Bar />", `<x-foo.Bar />`],
  ] as const) {
    const r = await vue(`<template>${tpl}</template>\n<script>export default { name: 'W' }</script>`, "/tmp/probe/N.vue")
    console.log(`  ${label.padEnd(22)} -> ${JSON.stringify(rels(r, "instantiates").map((x: any) => x.target))}`)
  }
  {
    // is svg:circle even in the grammar's tag_name form?
    const r = await vue(`<template><svg><circle/></svg></template>\n<script>export default { name: 'W' }</script>`, "/tmp/probe/N2.vue")
    console.log(`  (control) <svg><circle/></svg> -> ${JSON.stringify(rels(r, "instantiates").map((x: any) => x.target))}`)
  }

  report()
}
main()
