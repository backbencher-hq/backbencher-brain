// Q2d — chase the two real rows the phantom census produced, and the one
// contains-edge ghost.
import * as fs from "fs"
import * as path from "path"
import { vue, rels, syms, names } from "./harness"

const CORPUS = "<corpus-root>/bb_tests/repositories"

async function main() {
  console.log("=== Q2d.1  the `[key]` phantom, minimized ===")
  const f = `${CORPUS}/element-plus/packages/components/date-picker-panel/src/date-picker-com/panel-date-pick.vue`
  const lines = fs.readFileSync(f, "utf8").split("\n")
  console.log("  source around line 846:")
  for (let i = 838; i < 858; i++) console.log(`    ${i + 1}: ${lines[i]}`)

  const r = await vue(fs.readFileSync(f, "utf8"), f)
  const ph = (r.symbols ?? []).filter((s: any) => String(s.name).startsWith("["))
  console.log(`  bracket-named symbols: ${JSON.stringify(ph.map((s: any) => ({ name: s.name, kind: s.kind, owner: s.ownerName, L: s.range?.startLine, md: s.metadata })))}`)

  console.log("\n  --- minimized reproductions ---")
  for (const [label, body] of [
    ["computed key in `methods`", `export default { methods: { [dyn]() { return 1 }, save() { return 2 } } }`],
    ["computed key in `computed`", `export default { computed: { [dyn]() { return 1 }, plain() { return 2 } } }`],
    ["computed key in `watch`", `export default { watch: { [dyn]() {}, plain() {} } }`],
    ["string key in `computed`", `export default { computed: { "save-data"() { return 1 } } }`],
    ["computed key in data", `export default { data: () => ({ [dyn]: 1, plain: 2 }) }`],
    ["computed key in props", `export default { props: { [dyn]: Number, plain: String } }`],
    ["spread into methods", `export default { methods: { ...mixins, save() {} } }`],
    ["async computed key", `export default { methods: { async [dyn]() {} } }`],
    ["generator computed key", `export default { methods: { *[dyn]() {} } }`],
  ] as const) {
    const rr = await vue(`<template><p/></template>\n<script>\n${body}\n</script>`, "/tmp/probe/K.vue")
    const bad = (rr.symbols ?? []).filter((s: any) => String(s.name).startsWith("[") || String(s.name).startsWith('"'))
    console.log(`  ${label.padEnd(28)} symbols=${JSON.stringify(names(rr))}${bad.length ? `   <-- RAW KEY SURFACED` : ""}`)
  }

  console.log("\n=== Q2d.2  the ONE contains-edge ghost ===")
  const { ASTEngine } = await import(path.resolve(import.meta.dirname ?? ".", "../../../..", "src/ast/engine.ts"))
  const under = (root: string, limit: number) => {
    const out: string[] = []
    const walk = (d: string) => {
      if (out.length >= limit) return
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.name === ".git" || e.name === "node_modules" || e.name === "dist") continue
        const p = path.join(d, e.name)
        if (e.isDirectory()) walk(p)
        else if (e.name.endsWith(".vue")) out.push(p)
      }
    }
    walk(root)
    return out.sort()
  }
  const files = [...under(`${CORPUS}/element-plus`, 400), ...under(`${CORPUS}/vue-element-admin`, 200)]
  for (const file of files) {
    const src = fs.readFileSync(file, "utf8")
    let r: any
    try { r = await ASTEngine.parseFile(file, src) } catch { continue }
    for (const rel of r.relationships ?? []) {
      if (String(rel.type) !== "contains") continue
      const t = String(rel.target)
      if (t && !src.includes(t)) {
        console.log(`  ${path.relative(CORPUS, file)}: contains ${rel.source} -> "${t}" @${(rel as any).line_number}`)
        const ls = src.split("\n")
        for (let i = Math.max(0, (rel.line_number ?? 1) - 3); i < Math.min(ls.length, (rel.line_number ?? 1) + 2); i++) console.log(`    ${i + 1}: ${ls[i]}`)
      }
    }
  }

  console.log("\n=== Q2d.3  the ownerless `$el` property ===")
  {
    const f2 = `${CORPUS}/element-plus/packages/components/cascader-panel/src/menu.vue`
    const l2 = fs.readFileSync(f2, "utf8").split("\n")
    console.log("  source around 233:")
    for (let i = 225; i < 242; i++) console.log(`    ${i + 1}: ${l2[i]}`)
    const r2 = await vue(fs.readFileSync(f2, "utf8"), f2)
    console.log(`  $el symbol: ${JSON.stringify(syms(r2, "$el").map((s: any) => ({ kind: s.kind, owner: s.ownerName, md: s.metadata })))}`)
  }
}
main()
