// R.5 — the CONTROL rows: `defineProps()`/`defineEmits()`/`props:` are the
// analyzer's own headline contract, and the corpus says 20-25% of the files that
// write them extract nothing. Find out which shape is missed.
import * as fs from "fs"
import * as path from "path"
import { vue, syms, names } from "./harness"

const CORPUS = "/home/ishaq2321/bb_tests/repositories"

function under(root: string, limit: number) {
  const out: string[] = []
  const walk = (d: string) => {
    if (out.length >= limit) return
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (out.length >= limit) return
      if (e.name === ".git" || e.name === "node_modules" || e.name === "dist") continue
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name.endsWith(".vue")) out.push(p)
    }
  }
  walk(root)
  return out.sort()
}

/** Classify the shape of a defineProps()/defineEmits() occurrence in the source. */
function shape(s: string, macro: string): string {
  const re = new RegExp(`\\b${macro}\\s*(<|\\()`, "g")
  const shapes = new Set<string>()
  let m: RegExpExecArray | null
  while ((m = re.exec(s))) {
    const c = s[m.index + macro.length + m[0].length - macro.length]
    void c
    if (m[1] === "<") shapes.add("generic type-literal")
    else {
      // what follows the paren?
      const rest = s.slice(m.index, m.index + 400)
      if (/^\s*\(\s*\{/.test(rest)) shapes.add("object literal (runtime)")
      else if (/^\s*\(\s*\[/.test(rest)) shapes.add("array literal (runtime)")
      else if (/^\s*\(\s*[A-Za-z_$]/.test(rest)) shapes.add("a variable reference")
      else if (/^\s*\(\s*\)/.test(rest)) shapes.add("no argument")
      else shapes.add("other: " + JSON.stringify(rest.slice(0, 40)))
    }
  }
  return [...shapes].join(" + ") || "(absent)"
}

async function main() {
  const { ASTEngine } = await import(path.resolve(import.meta.dirname ?? ".", "../../../..", "src/ast/engine.ts"))
  const files = [...under(`${CORPUS}/element-plus`, 2000), ...under(`${CORPUS}/vue-element-admin`, 2000), ...under(`${CORPUS}/vue-core`, 200)]
  const srcs = files.map((f) => [f, fs.readFileSync(f, "utf8")] as const)

  console.log("=== R.5.1  defineProps(): shape vs extracted ===")
  const byShape = new Map<string, { n: number; miss: number; ex: string[] }>()
  for (const [f, s] of srcs) {
    if (!/\bdefineProps\s*[<(:]/.test(s)) continue
    let r: any
    try { r = await ASTEngine.parseFile(f, s) } catch { continue }
    const nProps = (r.symbols ?? []).filter((x: any) => x.metadata?.isProp).length
    const sh = shape(s, "defineProps")
    const e = byShape.get(sh) ?? { n: 0, miss: 0, ex: [] }
    e.n++
    if (nProps === 0) { e.miss++; if (e.ex.length < 2) e.ex.push(`${path.relative(CORPUS, f)} (declares: ${JSON.stringify((/defineProps\s*(<[^;]{0,120}|\(\s*\{[\s\S]{0,120})/.exec(s)?.[1] ?? "").replace(/\s+/g, " ").slice(0, 90))})`) }
    byShape.set(sh, e)
  }
  for (const [sh, e] of [...byShape.entries()].sort((a, b) => b[1].n - a[1].n)) {
    console.log(`  ${String(e.n).padStart(4)} file(s), ${String(e.miss).padStart(4)} with NO prop symbol   shape: ${sh}`)
    for (const x of e.ex) console.log(`        ${x}`)
  }

  console.log("\n=== R.5.2  defineEmits(): shape vs extracted ===")
  const byShape2 = new Map<string, { n: number; miss: number; ex: string[] }>()
  for (const [f, s] of srcs) {
    if (!/\bdefineEmits\s*[<(:]/.test(s)) continue
    let r: any
    try { r = await ASTEngine.parseFile(f, s) } catch { continue }
    const n = (r.symbols ?? []).filter((x: any) => x.metadata?.isEmit).length
    const sh = shape(s, "defineEmits")
    const e = byShape2.get(sh) ?? { n: 0, miss: 0, ex: [] }
    e.n++
    if (n === 0) { e.miss++; if (e.ex.length < 2) e.ex.push(`${path.relative(CORPUS, f)} (declares: ${JSON.stringify((/defineEmits\s*(<[^;]{0,140}|\(\s*\{[\s\S]{0,140}|\(\s*\[[\s\S]{0,140})/.exec(s)?.[1] ?? "").replace(/\s+/g, " ").slice(0, 100))})`) }
    byShape2.set(sh, e)
  }
  for (const [sh, e] of [...byShape2.entries()].sort((a, b) => b[1].n - a[1].n)) {
    console.log(`  ${String(e.n).padStart(4)} file(s), ${String(e.miss).padStart(4)} with NO event symbol   shape: ${sh}`)
    for (const x of e.ex) console.log(`        ${x}`)
  }

  console.log("\n=== R.5.3  Options `props:` / `emits:` that extract nothing — which shape? ===")
  for (const opt of ["props", "emits"]) {
    const rows = new Map<string, { n: number; miss: number; ex: string[] }>()
    for (const [f, s] of srcs) {
      const m = new RegExp(`^\\s*${opt}\\s*:\\s*(\\[[\\s\\S]{0,120}?\\]|\\{[\\s\\S]{0,200}?\\n\\s*\\})`, "m").exec(s)
      if (!m) continue
      let r: any
      try { r = await ASTEngine.parseFile(f, s) } catch { continue }
      const key = opt === "props" ? "isProp" : "isEmit"
      const n = (r.symbols ?? []).filter((x: any) => x.metadata?.[key]).length
      const sh = m[1].trim().startsWith("[") ? "array form" : "object form"
      const e = rows.get(sh) ?? { n: 0, miss: 0, ex: [] }
      e.n++
      if (n === 0) { e.miss++; if (e.ex.length < 3) e.ex.push(`${path.relative(CORPUS, f)} (${JSON.stringify(m[1].replace(/\s+/g, " ").slice(0, 110))})`) }
      rows.set(sh, e)
    }
    for (const [sh, e] of rows) {
      console.log(`  ${opt} ${sh}: ${e.n} file(s), ${e.miss} with no symbol`)
      for (const x of e.ex) console.log(`        ${x}`)
    }
  }

  console.log("\n=== R.5.4  minimized: the shapes that extract nothing ===")
  for (const [label, body] of [
    ["defineProps object literal (nested prop options)", `const p = defineProps({ modelValue: { type: String, default: '' }, size: { type: Number, default: 1 } })`],
    ["defineProps object literal, shorthand", `const p = defineProps({ modelValue: String })`],
    ["defineProps array", `const p = defineProps(['a', 'b'])`],
    ["defineProps generic", `const p = defineProps<{ modelValue: string }>()`],
    ["defineProps variable", `const p = defineProps(propsDef)`],
    ["defineEmits object literal", `const e = defineEmits({ change: (v: string) => true, close: () => true })`],
    ["defineEmits array", `const e = defineEmits(['change', 'close'])`],
    ["defineEmits generic", `const e = defineEmits<{ (e: 'change'): void }>()`],
    ["defineProps with a spread", `const p = defineProps({ ...base, size: Number })`],
    ["defineProps withWithDefaults", `const p = withDefaults(defineProps<{ a?: number }>(), { a: 1 })`],
    ["Options props array", `export default { props: ['a', 'b'] }`],
    ["Options props object nested", `export default { props: { a: { type: String, default: 'x' } } }`],
    ["Options props object shorthand", `export default { props: { a: String } }`],
    ["Options emits array", `export default { emits: ['a', 'b'] }`],
    ["Options emits object", `export default { emits: { a: null, b: (v) => true } }`],
  ] as const) {
    const r = await vue(`<template><p/></template>\n<script setup lang="ts">\n${body}\n</script>`, "/tmp/probe/DP.vue")
    const props = (r.symbols ?? []).filter((x: any) => x.metadata?.isProp).map((x: any) => x.name)
    const emits = (r.symbols ?? []).filter((x: any) => x.metadata?.isEmit).map((x: any) => x.name)
    console.log(`  ${label.padEnd(52)} props=${JSON.stringify(props)} emits=${JSON.stringify(emits)}`)
  }
}
main()
