// Q1b — the Options-API half of the vue surface, measured on vue-element-admin
// (Vue 2, Options-API-dominant) and cross-checked against element-plus
// (Vue 3, script-setup-dominant). The two corpora stress different halves of
// the same analyzer, so one draw cannot speak for the lane.
import * as fs from "fs"
import * as path from "path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../../..")
const CORPUS_ROOT = "<corpus-root>/bb_tests/repositories"

function filesUnder(root: string, exts: string[], limit: number): string[] {
  const out: string[] = []
  const walk = (d: string) => {
    if (out.length >= limit) return
    let es: fs.Dirent[]
    try { es = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of es) {
      if (out.length >= limit) return
      if (e.name === ".git" || e.name === "node_modules" || e.name === "dist") continue
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (exts.some((x) => e.name.endsWith(x))) out.push(p)
    }
  }
  walk(root)
  return out.sort()
}

async function run(label: string, files: string[]) {
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  const labels = new Map<string, number>()
  const kinds = new Map<string, number>()
  const symMeta = new Map<string, number>()
  const ownerKinds = new Map<string, number>()
  let edges = 0, symbols = 0, parseErrFiles = 0
  const noOwner: any[] = []
  const payload = { withParams: 0, withReturn: 0, withQualifiedCalls: 0, withComplexity: 0, methodSyms: 0, fnSyms: 0 }
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8")
    let r: any
    try { r = await ASTEngine.parseFile(f, src) } catch { continue }
    if ((r.errors?.length ?? 0) > 0) parseErrFiles++
    for (const rel of r.relationships ?? []) {
      const t = String(rel.type ?? rel.relationshipType)
      labels.set(t, (labels.get(t) ?? 0) + 1)
      edges++
    }
    for (const s of r.symbols ?? []) {
      symbols++
      kinds.set(s.kind, (kinds.get(s.kind) ?? 0) + 1)
      for (const k of Object.keys(s.metadata ?? {})) symMeta.set(k, (symMeta.get(k) ?? 0) + 1)
      if (s.ownerName) ownerKinds.set(s.ownerKind ?? "?", (ownerKinds.get(s.ownerKind ?? "?") ?? 0) + 1)
      else if (s.kind === "method" || s.kind === "property" || s.kind === "event") noOwner.push({ f: path.relative(CORPUS_ROOT, f), n: s.name, k: s.kind, line: s.range?.startLine })
      if (s.kind === "method" || s.kind === "function") payload.methodSyms++
      if (Array.isArray(s.parameters) && s.parameters.length) payload.withParams++
      if (s.returnType) payload.withReturn++
      if (Array.isArray(s.qualified_calls) && s.qualified_calls.length) payload.withQualifiedCalls++
      if (typeof s.complexity === "number") payload.withComplexity++
    }
  }
  console.log(`\n--- ${label}: ${files.length} file(s), ${edges} edge(s), ${symbols} symbol(s), ${parseErrFiles} file(s) with parse errors`)
  console.log(`  labels: ${[...labels.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(" ") || "(none)"}`)
  console.log(`  kinds:  ${[...kinds.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(" ")}`)
  console.log(`  symbol metadata: ${[...symMeta.entries()].filter(([k]) => /^(isProp|isEmit|isDataKey|isWatcher|isLifecycleHook|isOptionsData|isScriptSetup|isOptionsComponent|isVueComponent|isSfc)$/.test(k)).map(([k, v]) => `${k}=${v}`).join(" ")}`)
  console.log(`  payload: params=${payload.withParams} returnType=${payload.withReturn} qualifiedCalls=${payload.withQualifiedCalls} complexity=${payload.withComplexity} (of ${payload.methodSyms} method/function symbols)`)
  console.log(`  member symbols with NO ownerName: ${noOwner.length}`)
  for (const n of noOwner.slice(0, 10)) console.log(`      ${n.k} ${n.n} @${n.line}  ${n.f}`)
  return { labels, kinds, noOwner }
}

async function main() {
  await run("vue-element-admin (Vue 2, Options API)", filesUnder(path.join(CORPUS_ROOT, "vue-element-admin"), [".vue"], 200))
  await run("element-plus (Vue 3, script setup)", filesUnder(path.join(CORPUS_ROOT, "element-plus"), [".vue"], 200))
  await run("vue-core", filesUnder(path.join(CORPUS_ROOT, "vue-core"), [".vue"], 50))

  // Does the corpus actually exercise Options-API inheritance (`extends:`) and
  // lifecycle hooks? The analyzer has branches for them; if no corpus file
  // writes them, the branch is unpinned by the corpus and only the fixtures
  // speak for it.
  console.log("\n=== Q1b.2  corpus coverage of the analyzer's Options-API branches ===")
  const probes: Array<[string, string]> = [
    ["extends: {", "options extends (inheritance base)"],
    ["extends: [", "options extends (array form)"],
    ["mixins: [", "mixins"],
    ["beforeCreate", "beforeCreate hook"],
    ["beforeMount", "beforeMount hook"],
    ["serverPrefetch", "serverPrefetch hook"],
    ["errorCaptured", "errorCaptured hook"],
    ["watch: {", "watch option"],
    ["computed: {", "computed option"],
    ["provide(", "provide()"],
    ["inject(", "inject()"],
    ["defineModel", "defineModel macro"],
    ["defineExpose", "defineExpose macro"],
    ["withDefaults", "withDefaults macro"],
    ["defineSlots", "defineSlots macro"],
    ["defineOptions", "defineOptions macro"],
    ["useSlots", "useSlots()"],
    ["useAttrs", "useAttrs()"],
    ["defineStore", "pinia defineStore"],
    ["<style scoped", "scoped style block"],
    ["<style module", "css module style block"],
    ["v-html", "v-html directive"],
    ["v-text", "v-text directive"],
    ["v-once", "v-once"],
    ["v-pre", "v-pre"],
    ["v-memo", "v-memo"],
    ["useTemplateRef", "useTemplateRef()"],
    ["defineAsyncComponent", "defineAsyncComponent"],
    ["shallowRef", "shallowRef"],
    ["toRef", "toRef"],
    ["reactive(", "reactive()"],
    ["Teleport", "<Teleport>"],
    ["Suspense", "<Suspense>"],
    ["<component :is", "dynamic <component :is>"],
    ["slot-scope", "slot-scope attribute"],
    ["v-slot", "v-slot attribute"],
    ["custom-class", "vue/custom-class (vue2)"],
    ["functional: true", "functional component"],
    ["render(h)", "render() function"],
    ["this.$", "this.$ instance access"],
    ["lang=\"pug\"", "pug template lang"],
    ["lang=\"scss\"", "scss style lang"],
  ]
  const roots = ["vue-element-admin", "element-plus", "vue-core"]
  for (const [needle, what] of probes) {
    const hits: string[] = []
    for (const r of roots) {
      const files = filesUnder(path.join(CORPUS_ROOT, r), [".vue"], 2000)
      let n = 0
      for (const f of files) { try { if (fs.readFileSync(f, "utf8").includes(needle)) n++ } catch {} }
      if (n > 0) hits.push(`${r}=${n}`)
    }
    const mark = hits.length ? "covered " : "ABSENT  "
    console.log(`  ${mark} ${what.padEnd(40)} ${needle.padEnd(26)} ${hits.join(" ") || "— no file in any corpus writes it"}`)
  }
}
main()
