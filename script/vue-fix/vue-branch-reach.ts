/**
 * VUE BRANCH REACHABILITY PROBE — lane-owned, no regex.
 *
 * The question is not "does the analyzer contain a branch" (source derivation
 * answers that) but "does that branch ever fire" (it cannot). For the two
 * types at 0/0/0 across 1,151 corpus files, this writes inputs the LANGUAGE
 * accepts but the corpus never contains, and runs them through PRODUCTION
 * parseFile. A branch that fires here is LIVE-but-unexercised: the corpus
 * cannot prove or disprove it and the type is GAP, not RULED. A branch that
 * stays silent on input the grammar accepts is DEAD: the gap is the analyzer's.
 */
import { mkdirSync, writeFileSync } from "node:fs"
import { parseFile } from "../../src/ast/pool-worker"

const DIR = "/tmp/opencode/vueprobe/cases"

const CASES: Record<string, string> = {
  "implements-ts-class": `<template><div/></template>
<script lang="ts">
interface Renderable { draw(): void }
abstract class Widget implements Renderable {
  draw(): void {}
}
export default { name: "W" }
</script>
`,

  "overrides-inline-mixin": `<template><div/></template>
<script>
const base = { methods: { go() { return 0 }, spare() { return 1 } } }
export default {
  name: "InlineBase",
  mixins: [base],
  methods: { go() { return 1 } },
}
</script>
`,

  "overrides-inline-extends-object": `<template><div/></template>
<script>
export default {
  name: "InlineExtends",
  extends: { methods: { go() { return 0 } } },
  methods: { go() { return 1 } },
}
</script>
`,

  "extends-ts-class-superclass": `<template><div/></template>
<script lang="ts">
class Panel { go() { return 0 } }
export default class Widget extends Panel { go() { return 1 } }
</script>
`,

  "overrides-ts-class-member": `<template><div/></template>
<script lang="ts">
class Panel { go() { return 0 } }
export default class Widget extends Panel { go() { return 1 } }
</script>
`,

  "overrides-lifecycle-mixin": `<template><div/></template>
<script>
const m = { mounted() {} }
export default { name: "L", mixins: [m], mounted() {} }
</script>
`,
}

// Write every case to disk FIRST, so parseFile (the production entry, which
// stats the path and reads it) sees a real corpus rather than a promise.
mkdirSync(DIR, { recursive: true })
for (const [name, src] of Object.entries(CASES)) writeFileSync(`${DIR}/${name}.vue`, src)

for (const [name, src] of Object.entries(CASES)) {
  const p = `${DIR}/${name}.vue`
  let r: any
  try { r = await parseFile(p, DIR) } catch (e) { console.log(`${name.padEnd(32)} THREW ${String(e).slice(0, 70)}`); continue }
  const rels = r?.relationships ?? []
  const byType = new Map<string, number>()
  for (const x of rels) {
    const t = String(x.type ?? x.relationshipType ?? "")
    byType.set(t, (byType.get(t) ?? 0) + 1)
  }
  const interesting = [...byType.entries()].filter(([t]) =>
    t === "implements" || t === "overrides" || t === "extends" || t === "contains" || t === "exports")
  console.log(`${name.padEnd(32)} ${JSON.stringify(Object.fromEntries(interesting))}   (all: ${[...byType.entries()].map(([t, n]) => `${t}:${n}`).join(" ") || "none"})`)
  for (const x of rels) {
    const t = String(x.type ?? x.relationshipType ?? "")
    if (t === "implements" || t === "overrides" || t === "extends") {
      console.log(`      ${t}: ${x.source} -> ${x.target}  conf=${x.confidence} meta=${JSON.stringify(x.metadata ?? {}).slice(0, 110)}`)
    }
  }
}
