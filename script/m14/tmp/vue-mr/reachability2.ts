// REACHABILITY (2) — the findings whose reachability is "the analyzer has no
// branch for a construct the corpus writes". For those, corpus file count IS the
// reachability, once the probe has proved the construct is not extracted.
import * as fs from "fs"
import * as path from "path"

const CORPUS = "/home/ishaq2321/bb_tests/repositories"

function under(root: string, limit: number) {
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
      else if (e.name.endsWith(".vue")) out.push(p)
    }
  }
  walk(root)
  return out.sort()
}

async function main() {
  const { ASTEngine } = await import(path.resolve(import.meta.dirname ?? ".", "../../../..", "src/ast/engine.ts"))
  const files = [...under(`${CORPUS}/element-plus`, 2000), ...under(`${CORPUS}/vue-element-admin`, 2000), ...under(`${CORPUS}/vue-core`, 200)]
  const srcs = files.map((f) => [f, fs.readFileSync(f, "utf8")] as const)
  const touch = new Set<string>()

  console.log("=== R.3  the no-branch findings: written by the corpus AND not extracted ===")
  const cases: Array<[string, (s: string) => boolean, (syms: any[], rels: any[]) => boolean]> = [
    ["F2  provide() call", (s) => /\bprovide\s*\(/.test(s), (sy, rl) => !rl.some((x) => String(x.target) === "provide")],
    ["F2  inject() call", (s) => /\binject\s*\(/.test(s), (sy, rl) => !rl.some((x) => String(x.target) === "inject")],
    ["F2  inject: option", (s) => /^\s*inject\s*:/m.test(s), () => true],
    ["F2  provide: option", (s) => /^\s*provide\s*:/m.test(s), () => true],
    ["F3  withDefaults()", (s) => /\bwithDefaults\s*\(/.test(s),
      (sy) => sy.filter((x) => x.metadata?.isProp).every((x) => x.metadata?.defaultValue === undefined)],
    ["F3  Options prop with default:", (s) => /^\s*props\s*:/m.test(s) && /default\s*:/.test(s),
      (sy) => sy.filter((x) => x.metadata?.isProp).every((x) => x.metadata?.defaultValue === undefined)],
    ["F4  defineOptions()", (s) => /\bdefineOptions\s*\(/.test(s), () => true],
    ["F4  defineExpose()", (s) => /\bdefineExpose\s*\(/.test(s), () => true],
    ["F5  setup() in an Options default export", (s) => /export\s+default\s*\{[\s\S]*?\n\s*setup\s*[:(]/.test(s), () => true],
    ["F5  setup() anywhere", (s) => /\bsetup\s*[:(]/.test(s), () => true],
    ["F9  defineModel()", (s) => /\bdefineModel\s*\(/.test(s), () => true],
    ["F9  defineSlots()", (s) => /\bdefineSlots\s*[<(:]/.test(s), () => true],
    ["-- control: defineProps()", (s) => /\bdefineProps\s*[<(:]/.test(s), (sy) => sy.filter((x) => x.metadata?.isProp).length === 0],
    ["-- control: defineEmits()", (s) => /\bdefineEmits\s*[<(:]/.test(s), (sy) => sy.filter((x) => x.metadata?.isEmit).length === 0],
    ["-- control: props: option", (s) => /^\s*props\s*:/m.test(s), (sy) => sy.filter((x) => x.metadata?.isProp).length === 0],
    ["-- control: emits: option", (s) => /^\s*emits\s*:/m.test(s), (sy) => sy.filter((x) => x.metadata?.isEmit).length === 0],
  ]
  for (const [label, written, notExtracted] of cases) {
    let n = 0
    const ex: string[] = []
    for (const [f, s] of srcs) {
      if (!written(s)) continue
      let r: any
      try { r = await ASTEngine.parseFile(f, s) } catch { continue }
      if (notExtracted(r.symbols ?? [], r.relationships ?? [])) { n++; touch.add(f); if (ex.length < 2) ex.push(path.relative(CORPUS, f)) }
    }
    const w = srcs.filter(([, s]) => written(s)).length
    console.log(`  ${String(w).padStart(4)} written / ${String(n).padStart(4)} not extracted   ${label.padEnd(42)} ${ex.join(", ")}`)
  }

  console.log(`\n  distinct corpus files where at least one of the above fires: ${touch.size} of ${srcs.length} (${((touch.size / srcs.length) * 100).toFixed(1)}%)`)

  console.log("\n=== R.4  totals, all findings combined ===")
  // recompute the earlier families' touch set
  const KEY = new Set(["implements", "extends", "class", "return", "function", "const", "import", "export", "default", "from", "type", "interface", "key", "string", "if", "for", "while"])
  const all = new Set(touch)
  const c: Record<string, number> = {}
  for (const [f, s] of srcs) {
    let r: any
    try { r = await ASTEngine.parseFile(f, s) } catch { continue }
    const sy: any[] = r.symbols ?? [], rl: any[] = r.relationships ?? []
    const byName = new Set(sy.map((x) => x.name))
    if (/<script[^>]*\blang\s*=\s*["']tsx?["']/.test(s) && r.metadata?.hasTypeInference === false) { c.F7 = (c.F7 ?? 0) + 1; all.add(f) }
    for (const rel of rl) {
      if (String(rel.type) === "uses" && (rel.metadata as any)?.isTemplateExpression) {
        const re = new RegExp(`[{,]\\s*${String(rel.target).replace(/[$]/g, "\\$")}\\s*:`)
        if (re.test(s)) { c.F10 = (c.F10 ?? 0) + 1; all.add(f) }
      }
      if (KEY.has(String(rel.target))) { c.F11 = (c.F11 ?? 0) + 1; all.add(f) }
      if (String(rel.type) === "instantiates" && /^[a-z][a-z0-9]*:[a-z]/i.test(String(rel.target))) { c.F9a = (c.F9a ?? 0) + 1; all.add(f) }
    }
    for (const x of sy) if (/^\[.*\]$/.test(String(x.name)) || x.metadata?.isIndexSignature) { c.F6 = (c.F6 ?? 0) + 1; all.add(f) }
    const classes = sy.filter((x) => x.kind === "class")
    if (classes.length === 2 && rl.some((x) => String(x.type) === "contains" && x.source === classes[1].name)) { c.F8 = (c.F8 ?? 0) + 1; all.add(f) }
    const don = /defineOptions\s*\(\s*\{[\s\S]{0,200}?name\s*:\s*['"]([\w-]+)['"]/.exec(s)
    if (don && !classes.some((c2) => c2.name === don[1])) { c.F4 = (c.F4 ?? 0) + 1; all.add(f) }
    if (/^\s*mixins\s*:/m.test(s)) { c.F1b = (c.F1b ?? 0) + 1; all.add(f) }
    void byName
  }
  for (const [k, v] of Object.entries(c).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(5)} file(s)  ${k}`)
  console.log(`\n  ALL FINDINGS: ${all.size} of ${srcs.length} corpus .vue files (${((all.size / srcs.length) * 100).toFixed(1)}%) carry at least one`)
}
main()
