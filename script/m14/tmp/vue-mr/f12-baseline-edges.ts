// F12 fix design: what does the seam ALREADY emit for the named forms, so the
// new emission is an addition and not a duplicate.
import { vue, rels, names } from "./harness"

async function main() {
  const cases: Array<[string, string]> = [
    ["imported type argument", `
import type { RemoteProps } from './remote-contract'
import { remoteEmits } from './remote-contract'
const p = defineProps<RemoteProps>()
const e = defineEmits(remoteEmits)`],
    ["local type argument", `
interface LocalProps { localA: string }
const p = defineProps<LocalProps>()`],
    ["local binding", `
const boundProps = { boundA: String }
const p = defineProps(boundProps)`],
    ["inline (works today)", `const p = defineProps<{ inlineA: string }>()`],
  ]
  for (const [label, body] of cases) {
    const r = await vue(`<template><p/></template>\n<script setup lang="ts">${body}\n</script>`, "/tmp/probe/D.vue")
    console.log(`\n--- ${label}`)
    console.log(`  symbols: ${JSON.stringify(names(r))}`)
    console.log(`  edges:`)
    for (const rel of rels(r)) {
      console.log(`    ${String(rel.type).padEnd(11)} ${String(rel.source).padEnd(6)} -> ${String(rel.target).padEnd(16)} line=${(rel as any).line_number} md=${JSON.stringify(rel.metadata)}`)
    }
  }
}
main()
