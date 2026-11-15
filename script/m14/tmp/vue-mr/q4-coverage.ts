// Q4 — what the 100%-coverage differential CANNOT see.
//
// The differential derives TRUTH from the same grammar and the same embedded
// script trees the analyzer consumes, then compares EDGE SETS. So it is blind to
// (a) symbols the oracle does not derive at all, (b) payload fields, (c) any
// construct absent from the 131+829-file corpus. This file attacks those three.
import * as fs from "fs"
import { vue, rels, syms, names, probe, report } from "./harness"

async function main() {
  console.log("=== Q4.1  PAYLOAD: what does the component symbol carry, vs the TS analyzer's? ===")
  {
    const vueSrc = `<template><p/></template>
<script>
export default { name: 'W', props: { a: String }, methods: { go() {} } }
</script>`
    const r = await vue(vueSrc, "/tmp/probe/P.vue")
    for (const s of r.symbols ?? []) {
      console.log(`  VUE  ${String(s.kind).padEnd(8)} ${String(s.name).padEnd(6)} keys=${Object.keys(s).join(",")}`)
      console.log(`       vis=${s.visibility} scope=${JSON.stringify(s.scope)} params=${JSON.stringify(s.parameters)} ret=${s.returnType} cx=${s.complexity} ev=${JSON.stringify(s.metadata?.evidenceClass)}`)
    }
    console.log(`  metadata: ${JSON.stringify(r.metadata, null, 1).split("\n").slice(0, 30).join("\n  ")}`)

    const { plain } = await import("./harness")
    const tsR = await plain("export class W { a = 1; go() { return 1 } }", "/tmp/probe/P.ts")
    console.log("  --- the same surface as .ts ---")
    for (const s of tsR.symbols ?? []) {
      console.log(`  TS   ${String(s.kind).padEnd(8)} ${String(s.name).padEnd(6)} keys=${Object.keys(s).join(",")}`)
    }
    console.log(`  TS metadata keys: ${Object.keys(tsR.metadata ?? {}).join(" ")}`)
  }

  console.log("\n=== Q4.2  complexity: the script half is a delegated SUM, not a real count ===")
  {
    const src = `<template>
  <div v-if="a"><span v-for="x in xs" :key="x">{{ x }}</span></div>
  <p v-else-if="b">y</p>
</template>
<script>
export default {
  data: () => ({ a: 1, b: 2, xs: [] }),
  methods: {
    m() { if (this.a) { return 1 } else { return 2 } },
    n(x) { return x ? 1 : 0 }
  }
}
</script>`
    const r = await vue(src, "/tmp/probe/Cx.vue")
    console.log(`  complexity=${r.metadata?.complexity} cyclomatic=${r.metadata?.cyclomaticComplexity} linesOfCode=${r.metadata?.linesOfCode}`)
    const { plain } = await import("./harness")
    const tsR = await plain("function m(){ if(1) {return 1} else {return 2} }\nfunction n(x){ return x?1:0 }\n", "/tmp/probe/Cx.ts")
    console.log(`  same decisions as .ts: complexity=${tsR.metadata?.complexity} cyclomatic=${tsR.metadata?.cyclomaticComplexity}`)
    console.log(`  VUE expected: 1 + 2 (template v-if,v-else-if... v-for,v-show) + script decisions`)
  }

  console.log("\n=== Q4.3  hasTypeInference is hardcoded false even for lang=\"ts\" ===")
  {
    const r = await vue(`<template><p/></template>
<script lang="ts">
interface P { id: string }
const p: P = { id: 'x' }
export default defineComponent({ props: { a: Number } as P })
</script>`, "/tmp/probe/TI.vue")
    console.log(`  hasTypeInference=${r.metadata?.hasTypeInference} (lang=ts, interfaces and annotations present)`)
    const { plain } = await import("./harness")
    const t = await plain("interface P { id: string }\nconst p: P = {id:'x'}", "/tmp/probe/TI.ts")
    console.log(`  .ts analyzer reports hasTypeInference=${t.metadata?.hasTypeInference}`)
  }

  console.log("\n=== Q4.4  evidence tier: every edge the analyzer emits, classified? ===")
  {
    const src = `<template>
  <MyChild v-if="show" />
</template>
<script>
import { ref } from 'vue'
import Child from './Child.vue'
export default {
  components: { MyChild: Child },
  data: () => ({ show: false }),
  methods: { save() { return 1 } }
}
</script>`
    const r = await vue(src, "/tmp/probe/Ev.vue")
    const unclassified = rels(r).filter((x: any) => !x.metadata?.evidenceClass)
    console.log(`  edges=${rels(r).length} without evidenceClass=${unclassified.length}`)
    for (const x of rels(r)) {
      console.log(`    ${String(x.type).padEnd(11)} ${String(x.source).padEnd(8)}->${String(x.target).padEnd(14)} ev=${x.metadata?.evidenceClass} conf=${x.confidence}`)
    }
  }

  console.log("\n=== Q4.5  imports: does a .vue import keep its FILE identity? ===")
  {
    const r = await vue(`<template><p/></template>
<script>
import Child from './Child.vue'
import { helper } from './util'
export default { components: { Child } }
</script>`, "/tmp/probe/Im.vue")
    for (const i of r.imports ?? []) {
      console.log(`    IMP ${JSON.stringify({ source: i.source, imported: i.imported, alias: i.alias, line: i.range?.startLine, module: (i as any).module, type: (i as any).type })}`)
    }
  }

  console.log("\n=== Q4.6  a .vue file that is NOT an SFC (the polyglot / misroute question) ===")
  {
    const r = await vue(`const a = 1;\nfunction f() { return 2 }\n`, "/tmp/probe/NotSfc.vue")
    console.log(`  symbols: ${JSON.stringify(names(r))}`)
    console.log(`  rels: ${JSON.stringify(rels(r).map((x: any) => `${x.type}:${x.source}->${x.target}`))}`)
    console.log(`  metadata.framework=${r.metadata?.framework} patterns=${JSON.stringify(r.metadata?.patterns)}`)
  }
  {
    const r = await vue(`<html><body><script>const a=1</script></body></html>`, "/tmp/probe/Html.vue")
    console.log(`  html-in-.vue: symbols=${JSON.stringify(names(r))} rels=${rels(r).length}`)
  }

  console.log("\n=== Q4.7  empty / degenerate SFCs ===")
  for (const [label, src] of [
    ["no script", "<template><p/></template>"],
    ["empty script", "<template><p/></template>\n<script></script>"],
    ["whitespace script", "<template><p/></template>\n<script>\n\n   \n</script>"],
    ["script only", "<script>\nexport default { name: 'W' }\n</script>"],
    ["template only, no name", "<template><p/></template>"],
    ["two default exports", "<script>export default {name:'A'}\nexport default {name:'B'}</script>"],
    ["empty file", ""],
  ] as const) {
    const r = await vue(src, "/tmp/probe/E.vue")
    console.log(`  ${label.padEnd(24)} symbols=${JSON.stringify(names(r))} rels=${rels(r).length} errors=${(r.errors ?? []).length} complexity=${r.metadata?.complexity}`)
  }

  console.log("\n=== Q4.8  does a symbol ever carry a name the file does not write? (phantom probe) ===")
  {
    // The Options component name comes from `name: 'X'`; the SFC class name comes
    // from the FILE. If a file is named Foo.vue and declares name: 'Bar', BOTH
    // class symbols exist. Are both reachable as edge sources/targets?
    const r = await vue(`<template><p/></template>
<script>
export default { name: 'ActualName', props: { p: String } }
</script>`, "/tmp/probe/WidgetFile.vue")
    const classes = (r.symbols ?? []).filter((s: any) => s.kind === "class")
    console.log(`  file=WidgetFile.vue  name option=ActualName`)
    console.log(`  class symbols: ${JSON.stringify(classes.map((s: any) => s.name))}`)
    const srcs = new Set(rels(r).map((x: any) => x.source))
    const tgts = new Set(rels(r).map((x: any) => x.target))
    for (const c of classes) console.log(`    ${c.name}: ever a source=${srcs.has(c.name)} ever a target=${tgts.has(c.name)}`)
  }

  report()
}
main()
