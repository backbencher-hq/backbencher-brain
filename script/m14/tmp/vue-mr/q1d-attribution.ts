// Q1d — attribution: is the `uses -> implements` keyword edge the VUE seam's or
// inherited from the JS sub-analyzer? And is the split component identity real?
import { plain, vue, rels, syms } from "./harness"

async function main() {
  const implSrc = "export class Impl implements Service {\n  run() { return 1 }\n}\n"
  console.log("=== Q1d.1  identical script body, three hosts ===")
  for (const [label, file, src] of [
    ["as .ts", "/tmp/probe/a.ts", implSrc],
    ["as .js", "/tmp/probe/a.js", implSrc],
    ["as .vue <script>", "/tmp/probe/A.vue", `<template><p/></template>\n<script>\n${implSrc}</script>`],
    ["as .vue <script lang=ts>", "/tmp/probe/A.vue", `<template><p/></template>\n<script lang="ts">\n${implSrc}</script>`],
  ] as const) {
    const r = await plain(src, file)
    const kw = rels(r).filter((x: any) => ["implements", "extends", "class", "return"].includes(String(x.target)))
    console.log(`  ${label.padEnd(28)} all-targets=${JSON.stringify(rels(r).map((x: any) => `${x.type}:${x.source}->${x.target}`))}`)
    console.log(`  ${" ".repeat(28)} keyword-targets=${JSON.stringify(kw.map((x: any) => `${x.type}:${x.source}->${x.target}`))}`)
  }

  console.log("\n=== Q1d.2  the split component identity: does a graph query have one answer? ===")
  {
    const src = [
      "<template><p>{{ label }}</p></template>",        // 1
      "<script>",                                       // 2
      "import { mapState } from 'vuex'",                // 3
      "export default {",                               // 4
      "  name: 'MyWidget',",                            // 5
      "  props: { label: String },",                    // 6
      "  computed: { upper() { return this.label } },",  // 7
      "}",                                              // 8
      "</script>",                                      // 9
    ].join("\n")
    const r = await vue(src, "/tmp/probe/Host.vue")
    const classes = (r.symbols ?? []).filter((s: any) => s.kind === "class")
    console.log(`  file-derived module name: "Host";  name: option: "MyWidget"`)
    console.log(`  class symbols: ${JSON.stringify(classes.map((s: any) => ({ name: s.name, md: s.metadata })))}`)
    console.log(`  ALL relationships:`)
    for (const rel of r.relationships ?? []) {
      console.log(`    ${String(rel.type).padEnd(11)} ${String(rel.source).padEnd(10)} -> ${String(rel.target).padEnd(14)} line=${(rel as any).line_number}`)
    }
    const sources = new Set((r.relationships ?? []).map((r2: any) => r2.source))
    console.log(`  distinct edge SOURCES: ${JSON.stringify([...sources])}`)
    console.log(`  class symbol names:     ${JSON.stringify(classes.map((c: any) => c.name))}`)
    const orphans = [...sources].filter((s) => !classes.some((c: any) => c.name === s))
    console.log(`  sources with no class symbol: ${JSON.stringify(orphans)}`)
  }

  console.log("\n=== Q1d.3  is the SFC class symbol (whole-file) ever the target of an edge? ===")
  {
    const src = [
      "<template><p/></template>",   // 1
      "<script>",                    // 2
      "export default { name: 'W' }",// 3
      "</script>",                   // 4
    ].join("\n")
    const r = await vue(src, "/tmp/probe/Host2.vue")
    const t = new Set((r.relationships ?? []).map((x: any) => String(x.target)))
    const classes = (r.symbols ?? []).filter((s: any) => s.kind === "class").map((s: any) => s.name)
    console.log(`  class symbols: ${JSON.stringify(classes)}`)
    console.log(`  ever an edge TARGET? ${JSON.stringify(classes.map((c: string) => `${c}:${t.has(c)}`))}`)
  }
}
main()
