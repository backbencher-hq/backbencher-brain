// F12 residuals: what is still unanswerable, and is each class cleanly fixable?
import * as fs from "fs"
import * as path from "path"
import { vue, rels, names } from "./harness"

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

async function main() {
  const { ASTEngine } = await import(path.resolve(import.meta.dirname ?? ".", "../../../..", "src/ast/engine.ts"))
  const files = [...under(`${CORPUS}/element-plus`, 2000), ...under(`${CORPUS}/vue-element-admin`, 2000)]
  const shown: Record<string, number> = {}
  const ex: Record<string, string> = {}
  for (const f of files) {
    const s = fs.readFileSync(f, "utf8")
    let r: any
    try { r = await ASTEngine.parseFile(f, s) } catch { continue }
    const propSyms = (r.symbols ?? []).filter((x: any) => x.metadata?.isProp).length
    const propEdge = rels(r).filter((x: any) => x.metadata?.isPropContract).length
    const emitSyms = (r.symbols ?? []).filter((x: any) => x.metadata?.isEmit).length
    const emitEdge = rels(r).filter((x: any) => x.metadata?.isEmitContract).length
    const tag = (k: string) => { shown[k] = (shown[k] ?? 0) + 1; if (!ex[k]) ex[k] = path.relative(CORPUS, f) }
    if (/\bdefineProps\s*</.test(s) && !/defineProps\s*<\s*\{/.test(s) && propSyms + propEdge === 0) tag("R1 defineProps<Named> still unanswerable")
    if (/\bdefineEmits\s*</.test(s) && !/defineEmits\s*<\s*\{/.test(s) && emitSyms + emitEdge === 0) tag("R2 defineEmits<Named> still unanswerable")
    if (/\bdefineEmits\s*\(/.test(s) && !/defineEmits\s*\(\s*[[{]/.test(s) && emitSyms + emitEdge === 0) tag("R3 defineEmits(binding) still unanswerable")
    if (/^\s*props\s*:/m.test(s) && propSyms + propEdge === 0) tag("R4 Options props: unanswerable")
    if (/^\s*emits\s*:/m.test(s) && emitSyms + emitEdge === 0) tag("R5 Options emits: unanswerable")
    if (/^\s*props\s*:/m.test(s) && propSyms > 0 && propEdge === 0) tag("R6 Options props: partly answered (some keys missed)")
    if (/\bdefineProps\s*<\s*\{/.test(s) && propSyms + propEdge === 0) tag("R7 defineProps<{inline}> unanswerable")
    if (/\bdefineEmits\s*\(\s*\[/.test(s) && emitSyms + emitEdge === 0) tag("R8 defineEmits([inline]) unanswerable")
  }
  console.log("=== F12 residuals, by class ===")
  for (const k of Object.keys(shown).sort()) console.log(`  ${String(shown[k]).padStart(4)} file(s)  ${k.padEnd(44)} e.g. ${ex[k]}`)

  console.log("\n=== the specific SHAPES, minimized ===")
  for (const [label, body] of [
    ["R1a type_arguments is an intersection", `type A = { a: string }\nconst p = defineProps<A & { b: number }>()`],
    ["R1b type_arguments is a union", `type A = { a: string }\ntype B = { b: number }\nconst p = defineProps<A | B>()`],
    ["R1c type_arguments is nested generic", `import type { X } from './c'\nconst p = defineProps<Pick<X, 'a'>>()`],
    ["R1d the macro is a member call", `const p = Vue.defineProps<Named>()`],
    ["R4a Options props: a variable", `import { d } from './c'\nexport default { name: 'W', props: d }`],
    ["R4b Options props: a same-file variable", `const d = { a: String }\nexport default { name: 'W', props: d }`],
    ["R4c Options props: a factory call", `export default { name: 'W', props: () => ({ a: String }) }`],
    ["R5a Options emits: a variable", `import { d } from './c'\nexport default { name: 'W', emits: d }`],
    ["R6  Options props: mixed", `export default { name: 'W', props: { a: String }, ...spread }`],
  ] as const) {
    const r = await vue(`<template><p/></template>\n<script>\n${body}\n</script>`, "/tmp/probe/R.vue")
    const p = (r.symbols ?? []).filter((x: any) => x.metadata?.isProp).map((x: any) => x.name)
    const e = (r.symbols ?? []).filter((x: any) => x.metadata?.isEmit).map((x: any) => x.name)
    const pe = rels(r).filter((x: any) => x.metadata?.isPropContract).map((x: any) => x.target)
    const ee = rels(r).filter((x: any) => x.metadata?.isEmitContract).map((x: any) => x.target)
    console.log(`  ${label.padEnd(38)} props=${JSON.stringify(p)}${pe.length ? " +edge" + JSON.stringify(pe) : ""} emits=${JSON.stringify(e)}${ee.length ? " +edge" + JSON.stringify(ee) : ""}`)
  }
}
main()
