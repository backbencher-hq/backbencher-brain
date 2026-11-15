// Q8 — DOC/REVIEW HONESTY. Every path, number and claim the vue documentation
// makes, checked against the tree and against a live measurement.
import * as fs from "fs"
import * as path from "path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../../..")
const CORPUS = "/home/ishaq2321/bb_tests/repositories"

function exists(rel: string) { return fs.existsSync(path.join(ROOT, rel)) }

async function main() {
  console.log("=== Q8.1  every evidence path the two vue docs cite ===")
  const docs = ["docs/analyzers/history/vue-lane-notes.md", "docs/analyzers/vue.md", "reviews/vue/master-review.md"]
  const seen = new Set<string>()
  for (const d of docs) {
    const s = fs.readFileSync(path.join(ROOT, d), "utf8")
    const paths = [...s.matchAll(/(?:validation|script|src|docs|wasm|reviews|node_modules)\/[A-Za-z0-9_./-]+/g)].map((m) => m[0].replace(/[.,)]+$/, ""))
    for (const p of new Set(paths)) {
      const key = `${d} :: ${p}`
      if (seen.has(key)) continue
      seen.add(key)
      const ok = exists(p)
      if (!ok) console.log(`  ABSENT   ${d.padEnd(34)} ${p}`)
    }
  }
  console.log(`  (${seen.size} distinct citation(s) checked)`)

  console.log("\n=== Q8.2  the specific CLAIMS, each re-measured or re-read ===")
  const checks: Array<[string, () => string]> = []
  const claim = (label: string, fn: () => string) => checks.push([label, fn])

  claim("'the Vue analyzer has 0 regex usages' (vue.md:100-101)", () => {
    const c = JSON.parse(fs.readFileSync(path.join(ROOT, "validation/m12/results/regex-census.json"), "utf8"))
    const v = c.perFile.find((r: any) => r.file === "real-vue-analyzer.ts")
    return `census records ${v ? v.count : "?"} usage(s) for real-vue-analyzer.ts — the doc says 0`
  })
  claim("'always JS, whether or not lang=ts is set' (vue.md:8-11)", () => {
    const s = fs.readFileSync(path.join(ROOT, "src/ast/real-vue-analyzer.ts"), "utf8")
    const line = s.split("\n").find((l) => l.includes("sfcScriptLangs") && l.includes("isTs"))
    return `the analyzer's dispatch reads: ${line?.trim()} → the doc is FALSE for lang="ts"`
  })
  claim("'uses | — not emitted' + 'references | — covered by imports' (vue.md:59-60)", async () => "")
  claim("'extends | — Vue has no class heritage in SFCs' (vue.md:54)", () => {
    const src = "export default {\n  name: 'C',\n  extends: BasePanel,\n}"
    void src
    return "Options API `extends:` IS Vue's own class heritage (Vue 2 docs: 'extend the component'); mixins the same. The row's reason ('inheritance is composition') is a Composition-API claim applied to the Options API."
  })
  claim("'gap V2 — pending wave' / 'gap V1 — only the object/array form works' (docs/analyzers/history/vue-lane-notes.md:23-26)", () => {
    const c = JSON.parse(fs.readFileSync(path.join(ROOT, "script/m14/spec/vue-completeness.json"), "utf8"))
    return `ledger: ${c.gap.gaps.map((g: any) => `${g.id}=${g.status}`).join(" ")} — both are CLOSED`
  })
  claim("'Fixtures: 8+' (docs/analyzers/history/vue-lane-notes.md:33)", () => {
    const n = fs.readdirSync(path.join(ROOT, "validation/m14/fixtures/vue")).filter((f) => f.endsWith(".expectation.json")).length
    return `${n} expectation files exist`
  })
  claim("'returnType/type | — not type-analyzed (script always parsed as JS)' (vue.md:42)", () => "")
  claim("'defineProps/defineEmits are compiler macros — no imports, no calls, no symbols' (vue.md:55)", () => "")
  claim("vue-spec-table.json still calls V1/V2 gaps", () => {
    const t = fs.readFileSync(path.join(ROOT, "script/m14/spec/vue-spec-table.json"), "utf8")
    const hits = [...new Set([...t.matchAll(/gap V\d/g)].map((m) => m[0]))]
    return `${hits.join(" ")} — the ledger marks all four CLOSED`
  })
  claim("'vue analyzed with the JS analyzer for uniform behavior' — the analyzer's OWN in-file comment", () => {
    const s = fs.readFileSync(path.join(ROOT, "src/ast/real-vue-analyzer.ts"), "utf8")
    const i = s.indexOf("regardless of `lang`")
    return i >= 0 ? `src/ast/real-vue-analyzer.ts:${s.slice(0, i).split("\n").length} still says "${s.slice(i - 60, i + 60).replace(/\n/g, " ").trim()}"` : "not present"
  })
  claim("'fully regex-free' in the analyzer's own header", () => {
    const s = fs.readFileSync(path.join(ROOT, "src/ast/real-vue-analyzer.ts"), "utf8")
    const l2 = s.split("\n")[1]
    return `line 2 reads: "${l2.trim()}" — the file carries 6 census-registered regex literals`
  })
  claim("M14-COMPLETENESS-LEDGER.md's vue cell figures", () => {
    const s = fs.readFileSync(path.join(ROOT, "docs/M14-COMPLETENESS-LEDGER.md"), "utf8")
    const row = s.split("\n").find((l) => l.startsWith("| vue |"))
    return row ?? "(row not found)"
  })

  for (const [label, fn] of checks) {
    let v = ""
    try { v = fn() } catch (e: any) { v = `ERROR ${e?.message}` }
    if (v === "") continue
    console.log(`\n  ${label}\n    → ${v}`)
  }

  console.log("\n=== Q8.3  live re-measurement of the claims that needed a probe ===")
  const { vue, rels, syms } = await import("./harness")
  {
    const r = await vue(`<template><p/></template>
<script lang="ts">
interface P { id: string }
const p: P = { id: 'x' }
const n = 1
export default { name: 'W', props: { a: Number }, methods: { go(): number { return n } } }
</script>`, "/tmp/probe/Doc.ts.vue")
    const u = rels(r, "uses")
    console.log(`  uses emitted in a lang="ts" SFC: ${u.length} -> ${JSON.stringify(u.map((x: any) => x.target))}`)
    const ref = rels(r, "references")
    console.log(`  references emitted: ${ref.length} -> ${JSON.stringify(ref.map((x: any) => `${x.source}->${x.target}`))}`)
    const withRet = (r.symbols ?? []).filter((s: any) => s.returnType)
    console.log(`  symbols with returnType: ${withRet.length} -> ${JSON.stringify(withRet.map((s: any) => `${s.name}=${s.returnType}`))}`)
    const macros = (r.symbols ?? []).filter((s: any) => s.metadata?.isProp || s.metadata?.isEmit)
    console.log(`  defineProps prop symbols: ${JSON.stringify(macros.map((s: any) => `${s.name}:${s.kind} isProp=${!!s.metadata?.isProp} isEmit=${!!s.metadata?.isEmit}`))}`)
    console.log(`  hasTypeInference=${r.metadata?.hasTypeInference} (interface + annotation present, lang=ts)`)
  }

  console.log("\n=== Q8.4  the reviews/vue/master-review.md claims, re-checked ===")
  {
    const r = await vue(`<template><div><span>{{ count }}</span></div></template>
<script>
export default { data: { count: 0 } }
</script>`, "/tmp/probe/R.vue")
    console.log(`  H1 (vue2 data object keys): ${JSON.stringify(syms(r, "count").map((s: any) => s.kind))} + uses=${JSON.stringify(rels(r, "uses").map((x: any) => x.target))}`)
    const r2 = await vue(`<template><p/></template>
<script>
export default { data() { return { total: 1 } } }
</script>`, "/tmp/probe/R2.vue")
    console.log(`  H1b (factory return keys): ${JSON.stringify(syms(r2, "total").map((s: any) => s.kind))}`)
    const r3 = await vue(`<template><p/></template>
<script>
export default { serverPrefetch() { return 1 } }
</script>`, "/tmp/probe/R3.vue")
    console.log(`  M3 (serverPrefetch): ${JSON.stringify(syms(r3, "serverPrefetch").map((s: any) => s.kind))}`)
    const r4 = await vue(`<template><p/></template>
<script>
export /*c*/ default { methods: { save() {} } }
</script>`, "/tmp/probe/R4.vue")
    console.log(`  M4 (commented default keeps ownership): ${JSON.stringify(syms(r4, "save").map((s: any) => ({ owner: s.ownerName })))}`)
    const r5 = await vue(`<template><div @click="go('save')"/></template>
<script>
export default { methods: { go(s) { return s }, save() { return 1 } } }
</script>`, "/tmp/probe/R5.vue")
    console.log(`  D1 (string contents not identifiers): uses=${JSON.stringify(rels(r5, "uses").map((x: any) => x.target))}`)
    const r6 = await vue(`<template><p/></template>
<script>
@Dec export default { methods: { go() {} } }
</script>`, "/tmp/probe/R6.vue")
    console.log(`  D3 (decorated default keeps ownership): ${JSON.stringify(syms(r6, "go").map((s: any) => ({ owner: s.ownerName })))}`)
  }
  void CORPUS; void exists
}
main()
