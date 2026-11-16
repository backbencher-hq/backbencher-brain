// F12 AFTER THE FIX — the right question is not "are there prop SYMBOLS" but
// "is the component's contract ANSWERABLE from the component", which the
// two-shape fix satisfies either by component-owned symbols (a same-file
// binding) or by a contract edge to the declaration that carries the members.
import * as fs from "fs"
import * as path from "path"
import { vue, rels, names } from "./harness"

const CORPUS = "<corpus-root>/bb_tests/repositories"

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

/** Is the contract answerable, by EITHER shape? */
function contractAnswer(r: any, which: "prop" | "emit"): "symbols" | "edge" | "none" {
  const meta = which === "prop" ? "isProp" : "isEmit"
  const cMeta = which === "prop" ? "isPropContract" : "isEmitContract"
  const n = (r.symbols ?? []).filter((s: any) => s.metadata?.[meta]).length
  if (n > 0) return "symbols"
  const e = rels(r).filter((x: any) => x.metadata?.[cMeta]).length
  if (e > 0) return "edge"
  return "none"
}

async function main() {
  console.log("=== F12.AFTER.1  the shapes, minimized, by ANSWERABILITY ===")
  const cases: Array<[string, string]> = [
    ["A defineProps<{ inline }>()", `const p = defineProps<{ modelValue: string; size?: number }>()`],
    ["B defineProps<Named>() (imported)", `import type { RemoteProps } from './c'\nconst p = defineProps<RemoteProps>()`],
    ["C defineProps<Named>() (same file)", `interface LocalProps { localA: string; localB: number }\nconst p = defineProps<LocalProps>()`],
    ["D defineProps<Named> (type alias, same file)", `type LocalProps = { localA: string }\nconst p = defineProps<LocalProps>()`],
    ["E defineProps<Named & { b: number }>", `type A = { a: string }\nconst p = defineProps<A & { b: number }>()`],
    ["F defineProps({ inline })", `const p = defineProps({ modelValue: { type: String, default: '' } })`],
    ["G defineProps([ inline ])", `const p = defineProps(['a', 'b'])`],
    ["H defineProps(binding imported)", `import { d } from './c'\nconst p = defineProps(d)`],
    ["I defineProps(binding, same file)", `const defs = { a: String, b: Number }\nconst p = defineProps(defs)`],
    ["J withDefaults(defineProps<Named>(), …)", `const p = withDefaults(defineProps<RemoteProps>(), { o: 0 })`],
    ["K withDefaults(defineProps<{inline}>(), …)", `const p = withDefaults(defineProps<{ a?: number }>(), { a: 1 })`],
  ]
  for (const [label, body] of cases) {
    const r = await vue(`<template><p/></template>\n<script setup lang="ts">\n${body}\n</script>`, "/tmp/probe/A.vue")
    const a = contractAnswer(r, "prop")
    const edges = rels(r).filter((x: any) => x.metadata?.isPropContract).map((x: any) => x.target)
    console.log(`  ${a === "none" ? "LOSS " : "OK   "} ${label.padEnd(42)} via ${a.padEnd(8)} ${JSON.stringify(edges)}`)
  }
  console.log("\n  --- defineEmits ---")
  for (const [label, body] of [
    ["A defineEmits<{ inline }>()", `const e = defineEmits<{ (e: 'change'): void }>()`],
    ["B defineEmits<Named>() (imported)", `import type { R } from './c'\nconst e = defineEmits<R>()`],
    ["C defineEmits<Named>() (same file)", `type R = { (e: 'change'): void }\nconst e = defineEmits<R>()`],
    ["D defineEmits([ inline ])", `const e = defineEmits(['change', 'close'])`],
    ["E defineEmits({ inline })", `const e = defineEmits({ change: (v: string) => true })`],
    ["F defineEmits(binding imported)", `import { d } from './c'\nconst e = defineEmits(d)`],
    ["G defineEmits(binding, same file)", `const d = ['change', 'close']\nconst e = defineEmits(d)`],
  ] as const) {
    const r = await vue(`<template><p/></template>\n<script setup lang="ts">\n${body}\n</script>`, "/tmp/probe/A2.vue")
    const a = contractAnswer(r, "emit")
    const edges = rels(r).filter((x: any) => x.metadata?.isEmitContract).map((x: any) => x.target)
    console.log(`  ${a === "none" ? "LOSS " : "OK   "} ${label.padEnd(42)} via ${a.padEnd(8)} ${JSON.stringify(edges)}`)
  }

  console.log("\n=== F12.AFTER.2  the corpus, by answerability ===")
  const { ASTEngine } = await import(path.resolve(import.meta.dirname ?? ".", "../../../..", "src/ast/engine.ts"))
  const files = [...under(`${CORPUS}/element-plus`, 2000), ...under(`${CORPUS}/vue-element-admin`, 2000), ...under(`${CORPUS}/vue-core`, 200)]
  const rows: Record<string, { n: number; sym: number; edge: number; none: number }> = {}
  for (const f of files) {
    const s = fs.readFileSync(f, "utf8")
    const shapes: string[] = []
    if (/\bdefineProps\s*</.test(s)) shapes.push(/defineProps\s*<\s*\{/.test(s) ? "defineProps<{inline}>" : "defineProps<Named>")
    if (/\bdefineProps\s*\(/.test(s)) shapes.push(/defineProps\s*\(\s*[[{]/.test(s) ? "defineProps({inline})" : "defineProps(binding)")
    if (/\bdefineEmits\s*</.test(s)) shapes.push(/defineEmits\s*<\s*\{/.test(s) ? "defineEmits<{inline}>" : "defineEmits<Named>")
    if (/\bdefineEmits\s*\(/.test(s)) shapes.push(/defineEmits\s*\(\s*[[{]/.test(s) ? "defineEmits([inline])" : "defineEmits(binding)")
    if (/^\s*props\s*:/m.test(s)) shapes.push("props: option")
    if (/^\s*emits\s*:/m.test(s)) shapes.push("emits: option")
    if (!shapes.length) continue
    let r: any
    try { r = await ASTEngine.parseFile(f, s) } catch { continue }
    for (const sh of shapes) {
      const which = /prop/i.test(sh) ? "prop" : "emit"
      const a = contractAnswer(r, which as any)
      const e = rows[sh] ?? { n: 0, sym: 0, edge: 0, none: 0 }
      e.n++
      if (a === "symbols") e.sym++
      else if (a === "edge") e.edge++
      else e.none++
      rows[sh] = e
    }
  }
  console.log(`  shape                        files   via symbols   via edge   UNANSWERABLE`)
  let tot = 0, answered = 0
  for (const [k, v] of Object.entries(rows).sort((a, b) => b[1].n - a[1].n)) {
    tot += v.n; answered += v.n - v.none
    console.log(`  ${k.padEnd(26)} ${String(v.n).padStart(6)} ${String(v.sym).padStart(13)} ${String(v.edge).padStart(10)} ${String(v.none).padStart(13)}`)
  }
  console.log(`\n  TOTAL: ${answered} of ${tot} contract declarations now answerable (${((answered / Math.max(tot, 1)) * 100).toFixed(1)}%)`)
  void names
}
main()
