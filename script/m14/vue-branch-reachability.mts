/**
 * VUE — IS A ZERO-EMISSION LABEL A DEAD BRANCH, OR A BRANCH THE CORPUS NEVER
 * REACHED?
 *
 * JOB 1 question 2 is "fires?", and its whole point is that source derivation
 * cannot answer it: a predicate that never matches is indistinguishable, in the
 * source, from one that does. So for each label this lane does not emit on the
 * corpus, the question has to be settled by EXERCISING the branch — which means
 * writing the construct the label needs and asking production `parseFile` whether
 * the row comes out. Two outcomes, and they must not be confused:
 *
 *   REACHES   the row appears. The zero is a property of the corpus, so the ruling
 *             is "the construct does not occur here", which is falsifiable by a
 *             corpus that does contain it.
 *   DEAD      no row. The branch cannot fire on any input, which is a defect and
 *             the kind that every fixture can pass straight through.
 *
 * Written to a temp dir and parsed through the PRODUCTION entry, so the answer
 * includes every seam (the engine's SFC pre-parse, the lang dispatch, the
 * delegate, the noise filter, the worker boundary) rather than stopping at
 * `analyze()` the way a fixture does.
 *
 * The SFCs are deliberately the shapes the corpus does NOT contain: a class with
 * an `implements` clause in a `lang="ts"` block (0 in 1,411 corpus files, against
 * 2 `extends_clause` in the same probe — the control that makes the zero
 * informative), and an Options-API component whose `mixins` base is another SFC
 * (0 of 12 corpus bases). The second is the `overrides` reachability question: if
 * the analyzer emits nothing even when the base IS an SFC, the gap is the
 * analyzer's and not merely the corpus's.
 *
 * CLI: npx tsx script/m14/vue-branch-reachability.mts [--out f.json]
 */
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import * as path from "path"
import { parseFile } from "../../src/ast/pool-worker"

function argOf(flag: string, dflt?: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : dflt
}
const OUT = argOf("--out")
const dir = mkdtempSync(path.join(tmpdir(), "bb-vue-reach-"))
mkdirSync(path.join(dir, "src"), { recursive: true })

/**
 * `expectRows` is what makes this an instrument rather than a printout. A case
 * that SHOULD fire and does not is a DEFECT; a case that should NOT fire and does
 * not is a RULING holding. Without the field the probe cannot tell the two apart,
 * and "DEAD" would read as a finding where it is a decision — the inline
 * `mixins: [{ … }]` case is exactly that: Vue merges an inline options object, the
 * F1 ruling publishes its members as the component's own, so there is no base to
 * name and inventing one would fabricate an endpoint nothing resolves.
 */
type Case = { name: string; label: string; file: string; text: string; expect: string; expectRows: "some" | "none" }
const cases: Case[] = [
  {
    name: "implements-clause-in-a-ts-block",
    label: "implements",
    file: "ImplementsProbe.vue",
    text: `<template><div /></template>
<script lang="ts">
interface Shape { area(): number }
export default class Thing extends Object implements Shape {
  area(): number { return 1 }
}
</script>
`,
    expect: "a class with an `implements` clause in a lang=ts script block",
    expectRows: "some",
  },
  {
    name: "extends-clause-in-a-ts-block",
    label: "extends",
    file: "ExtendsProbe.vue",
    text: `<template><div /></template>
<script lang="ts">
class Base { greet(): string { return "hi" } }
export default class Child extends Base {
  greet(): string { return "yo" }
}
</script>
`,
    expect: "a class with an `extends` clause AND a same-named member — the class shape of an override",
    expectRows: "some",
  },
  {
    name: "options-mixin-whose-base-is-another-sfc",
    label: "overrides",
    file: "UsesSfcMixin.vue",
    text: `<template><div /></template>
<script>
import SfcBase from './SfcBase.vue'
export default {
  name: 'UsesSfcMixin',
  mixins: [SfcBase],
  methods: {
    shared() { return 1 }
  }
}
</script>
`,
    expect: "an Options component whose mixin base IS a .vue SFC that declares the same member — MUST stay silent: the base is another file and this lane does no I/O",
    expectRows: "none",
  },
  {
    name: "class-member-with-the-override-keyword",
    label: "overrides",
    file: "OverrideKeyword.vue",
    text: `<template><div /></template>
<script lang="ts">
class Base { greet(): string { return "hi" } }
export default class Child extends Base {
  override greet(): string { return "yo" }
}
</script>
`,
    expect: "a class member carrying TypeScript's `override` keyword — the delegate's own gate (real-typescript-analyzer.ts:695 `isOverride`)",
    expectRows: "some",
  },
  {
    name: "interface-heritage-member",
    label: "overrides",
    file: "InterfaceHeritage.vue",
    text: `<template><div /></template>
<script lang="ts">
interface Base { greet(): string }
interface Child extends Base { greet(): string }
export default class Impl implements Child {
  greet(): string { return "yo" }
}
</script>
`,
    expect: "an interface-heritage member declaration — the delegate's second overrides gate (real-typescript-analyzer.ts:5236)",
    expectRows: "some",
  },
  {
    name: "options-mixin-base-declared-in-the-same-block",
    label: "overrides",
    file: "LocalMixin.vue",
    text: `<template><div /></template>
<script>
const sharedMixin = {
  methods: { shared() { return 0 } }
}
export default {
  name: 'LocalMixin',
  mixins: [sharedMixin],
  methods: {
    shared() { return 1 }
  }
}
</script>
`,
    expect: "a mixin base declared as a const IN THE SAME <script> block — the one merge shape an SFC parse can see without leaving the tree",
    expectRows: "some",
  },
  {
    name: "options-mixin-lifecycle-hook-collision",
    label: "overrides",
    file: "LocalMixinHook.vue",
    text: `<template><div /></template>
<script>
const lifecycleMixin = {
  mounted() {},
  beforeDestroy() {}
}
export default {
  name: 'LocalMixinHook',
  mixins: [lifecycleMixin],
  mounted() {},
  beforeDestroy() {}
}
</script>
`,
    expect: "two LIFECYCLE HOOKS declared by both sides — a `method_definition` of the options object, not a `pair` key, which is where the first version of the reader was blind",
    expectRows: "some",
  },
  {
    name: "options-mixin-inline-object-base",
    label: "overrides",
    file: "InlineMixin.vue",
    text: `<template><div /></template>
<script>
export default {
  name: 'InlineMixin',
  mixins: [{ methods: { only() { return 0 } } }],
  methods: {
    only() { return 1 }
  }
}
</script>
`,
    expect: "an INLINE options object as the mixins element — MUST stay silent under the F1 ruling (the inline object's members ARE this component's members, so there is no base to name; inventing one would fabricate an endpoint)",
    expectRows: "none",
  },
  {
    name: "options-mixin-no-collision-is-not-an-override",
    label: "overrides",
    file: "NoCollision.vue",
    text: `<template><div /></template>
<script>
const otherMixin = {
  methods: { unrelated() { return 0 } }
}
export default {
  name: 'NoCollision',
  mixins: [otherMixin],
  methods: {
    mine() { return 1 }
  }
}
</script>
`,
    expect: "a merge with NO member in common — must emit ZERO overrides rows (the javascript lane's closed-world rule: an in-file base that declares no same-named member is PROOF of non-override)",
    expectRows: "none",
  },
  {
    name: "the-sfc-mixin-base-itself",
    label: "instantiates",
    file: "SfcBase.vue",
    text: `<template><div /></template>
<script>
export default {
  name: 'SfcBase',
  methods: {
    shared() { return 0 }
  }
}
</script>
`,
    expect: "a template-less SFC as a CONTROL: it must emit no `instantiates`, because there is no tag to read",
    expectRows: "none",
  },
]

const results: Array<Record<string, unknown>> = []
for (const c of cases) {
  const abs = path.join(dir, "src", c.file)
  writeFileSync(abs, c.text)
  let rows: Array<Record<string, unknown>> = []
  let symbols = 0
  let parseError: string | null = null
  try {
    const r: any = await parseFile(abs, dir)
    symbols = (r.symbols ?? []).length
    rows = (r.relationships ?? [])
      .filter((x: any) => String(x.type ?? x.relationshipType ?? "") === c.label)
      .map((x: any) => ({ source: x.source, target: x.target, confidence: x.confidence, metadata: x.metadata ?? {} }))
  } catch (e: any) {
    parseError = String(e?.message ?? e).slice(0, 160)
  }
  const fired = rows.length > 0
  const verdict = parseError ? "PARSE-ERROR" : fired ? "REACHES" : "DEAD"
  const asExpected = parseError ? false : c.expectRows === "some" ? fired : !fired
  results.push({
    case: c.name,
    label: c.label,
    constructs: c.expect,
    expectRows: c.expectRows,
    verdict,
    asExpected,
    rowsEmitted: rows.length,
    symbols,
    rows,
    parseError,
  })
  console.log(`${asExpected ? "ok  " : "MISS"} ${c.label.padEnd(13)} ${c.name.padEnd(46)} ${verdict} (${rows.length} rows, expected ${c.expectRows})`)
  for (const r of rows) console.log(`      ${JSON.stringify(r)}`)
}
try { rmSync(dir, { recursive: true, force: true }) } catch { }

const out: Record<string, unknown> = {
  schemaVersion: 1,
  at: new Date().toISOString(),
  instrument: "production ASTEngine.parseFile via src/ast/pool-worker, on freshly written SFCs in a temp dir",
  note: "a DEAD verdict means the branch cannot fire on ANY input, which is a defect; a REACHES verdict means the corpus zero is a corpus fact",
  cases: results,
}
const misses = results.filter((r) => !r.asExpected)
console.log("\n" + JSON.stringify(results.map((r) => ({ case: r.case, label: r.label, expectRows: r.expectRows, verdict: r.verdict, rowsEmitted: r.rowsEmitted, asExpected: r.asExpected })), null, 1))
console.log(`\n${results.length - misses.length} of ${results.length} cases as expected; ${misses.length} missed`)
if (misses.length) { console.log("MISSED:"); for (const m of misses) console.log(`   ${m.case} — expected ${m.expectRows}, got ${m.verdict}`) }
out.summary = { cases: results.length, asExpected: results.filter((r) => r.asExpected).length, missed: misses.length }
if (misses.length) process.exitCode = 1
if (OUT) { writeFileSync(OUT, JSON.stringify(out, null, 2)); console.log(`\nevidence: ${OUT}`) }
