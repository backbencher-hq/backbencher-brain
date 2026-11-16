// REACHABILITY — how many of the restored corpus's real .vue files each finding
// actually touches. A defect that no corpus file writes is a fixture-only claim;
// one that 40% of the corpus writes is a different animal.
import * as fs from "fs"
import * as path from "path"

const CORPUS = "<corpus-root>/bb_tests/repositories"

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
  console.log(`corpus: ${files.length} .vue files (element-plus + vue-element-admin + vue-core)`)
  const srcs = files.map((f) => [f, fs.readFileSync(f, "utf8")] as const)

  // --- static construct census: does the corpus WRITE the construct at all? ---
  const constructs: Array<[string, RegExp]> = [
    ["F1  Options `extends:`", /^\s*extends\s*:/m],
    ["F1  Options `mixins:`", /^\s*mixins\s*:/m],
    ["F2  `provide(`", /\bprovide\s*\(/],
    ["F2  `inject:` option", /^\s*inject\s*:/m],
    ["F2  `inject(`", /\binject\s*\(/],
    ["F3  `withDefaults(`", /\bwithDefaults\s*\(/],
    ["F4  `defineOptions(`", /\bdefineOptions\s*\(/],
    ["F5  `setup(`", /\bsetup\s*\(/],
    ["F6  computed key in a pair", /[{,]\s*\[[A-Za-z_$][\w$]*\s*]\s*:/],
    ["F6  index signature", /\[[A-Za-z_$][\w$]*\s*:\s*[A-Za-z_$][\w$]*\]\s*:/],
    ["F7  `lang=\"ts\"` script", /<script[^>]*\blang\s*=\s*["']tsx?["']/],
    ["F8  `name:` option that differs from the file stem", /^\s*name\s*:\s*['"`]/m],
    ["F9  namespaced/prefixed tag", /<[a-z][a-z0-9]*:[a-z]/i],
    ["F9  dotted component tag", /<[A-Z][\w$]*(?:\.[\w$]+)+\b/],
    ["F10 object literal in a template expression", /[:@][\w-]+=["'{]/],
    ["-- control: props:", /^\s*props\s*:/m],
    ["-- control: emits:", /^\s*emits\s*:/m],
    ["-- control: methods:", /^\s*methods\s*:/m],
    ["-- control: computed:", /^\s*computed\s*:/m],
  ]
  console.log("\n=== R.1  does any real corpus file WRITE the construct? ===")
  for (const [label, re] of constructs) {
    let n = 0
    const where: string[] = []
    for (const [f, s] of srcs) {
      if (re.test(s)) { n++; if (where.length < 2) where.push(path.relative(CORPUS, f)) }
    }
    console.log(`  ${n > 0 ? "WRITTEN" : "absent "}  ${String(n).padStart(4)} file(s)  ${label.padEnd(44)} ${where.join(", ")}`)
  }

  // --- analyzer-side reachability: which findings actually CHANGE the output? ---
  console.log("\n=== R.2  analyzer-side reachability (measured, not inferred) ===")
  const stats: Record<string, number> = {}
  const bump = (k: string) => { stats[k] = (stats[k] ?? 0) + 1 }
  const samples: Record<string, string[]> = {}
  const note = (k: string, f: string) => { (samples[k] ??= []); if (samples[k].length < 3) samples[k].push(path.relative(CORPUS, f)) }

  for (const [f, s] of srcs) {
    let r: any
    try { r = await ASTEngine.parseFile(f, s) } catch { continue }
    const syms: any[] = r.symbols ?? []
    const rels: any[] = r.relationships ?? []
    const byName = new Map<string, any[]>()
    for (const sy of syms) { if (!byName.has(sy.name)) byName.set(sy.name, []); byName.get(sy.name)!.push(sy) }

    // F6: a symbol whose name is a raw computed key or an index signature
    for (const sy of syms) {
      if (/^\[.*\]$/.test(String(sy.name)) || sy.metadata?.isIndexSignature) { bump("F6 raw computed key / index signature as a symbol"); note("F6", f) }
    }
    // F2: a `provide(` call that is never a call edge (the macro filter or a plain name)
    if (/\bprovide\s*\(/.test(s)) {
      const hasProvideSym = syms.some((sy) => ["theme", "locale", "updateModelValue", "onClose", "onFinish"].includes(sy.name))
      void hasProvideSym
      const callsProvide = rels.some((x) => String(x.target) === "provide")
      if (!callsProvide && s.includes("provide(")) { bump("F2a provide( written but NO calls edge"); note("F2a", f) }
    }
    // F2b: provide/inject keys that never become symbols
    const pm = /provide\(\s*['"][\w.-]+['"]\s*,\s*\{([\s\S]{0,400}?)\}\s*\)/.exec(s)
    if (pm) {
      const keys = [...pm[1].matchAll(/^\s{2,}([A-Za-z_$][\w$]*)\s*[(:,]/gm)].map((m) => m[1])
      const missing = keys.filter((k) => !(byName.get(k)?.length))
      if (keys.length && missing.length === keys.length) { bump("F2b provide(obj) members are all ownerless, none is a component contract symbol"); note("F2b", f) }
    }
    // F3: withDefaults present, no default recorded
    if (/\bwithDefaults\s*\(/.test(s)) {
      const props = syms.filter((sy) => sy.metadata?.isProp)
      const withDefault = props.filter((p) => p.metadata?.defaultValue !== undefined)
      if (props.length && withDefault.length === 0) { bump("F3 withDefaults() present, NO prop carries a default"); note("F3", f) }
    }
    // F4: defineOptions name
    const don = /defineOptions\s*\(\s*\{[\s\S]{0,200}?name\s*:\s*['"]([\w-]+)['"]/.exec(s)
    if (don) {
      const stem = path.basename(f).replace(/\.vue$/, "")
      const classes = syms.filter((sy) => sy.kind === "class").map((sy) => sy.name)
      if (!classes.includes(don[1])) { bump("F4 defineOptions({name}) does not name the component"); note("F4", f) }
    }
    // F5: setup( in an Options default export
    if (/export\s+default\s*\{[\s\S]{0,2000}?\bsetup\s*\(/.test(s) && !byName.get("setup")?.length) {
      bump("F5 setup() in the Options API, not a symbol"); note("F5", f)
    }
    // F1: Options extends/mixins with no extends edge
    if (/^\s*extends\s*:/m.test(s) && !rels.some((x) => String(x.type) === "extends")) { bump("F1 Options `extends:` with no extends edge"); note("F1", f) }
    if (/^\s*mixins\s*:/m.test(s) && !rels.some((x) => String(x.type) === "extends" || String(x.type) === "implements")) {
      bump("F1b Options `mixins:` with no inheritance edge"); note("F1b", f)
    }
    // F8: two Class symbols for one component, with disjoint edge sets
    const classes = syms.filter((sy) => sy.kind === "class")
    if (classes.length > 1) {
      const srcsSet = new Set(rels.map((x) => x.source))
      const withOwn = classes.filter((c) => rels.some((x) => String(x.type) === "contains" && x.source === c.name))
      if (classes.length === 2 && withOwn.length === 1) { bump("F8 two Class symbols, only one owns members (the other carries script edges)"); note("F8", f) }
    }
    // F9: a namespaced tag emitted as a component usage
    for (const rel of rels) {
      if (String(rel.type) === "instantiates" && /^[a-z][a-z0-9]*:[a-z]/i.test(String(rel.target))) {
        bump("F9a a namespaced builtin tag emitted as a component usage"); note("F9a", f)
      }
    }
    // F10: object literal in a template expression with an unquoted key naming a member
    for (const rel of rels) {
      if (String(rel.type) === "uses" && (rel.metadata as any)?.isTemplateExpression) {
        const t = String(rel.target)
        const re = new RegExp(`[{,]\\s*${t.replace(/[$]/g, "\\$")}\\s*:`, "m")
        if (re.test(s)) { bump("F10 an unquoted object-literal key in a template expression reads as a member"); note("F10", f) }
      }
    }
    // F7: lang=ts but hasTypeInference false
    if (/<script[^>]*\blang\s*=\s*["']tsx?["']/.test(s) && r.metadata?.hasTypeInference === false) {
      bump("F7 lang=ts SFC, hasTypeInference=false"); note("F7", f)
    }
    // F11: a keyword-target edge
    const KEY = new Set(["implements", "extends", "class", "return", "function", "const", "import", "export", "default", "from", "type", "interface", "key", "string", "if", "for", "while"])
    for (const rel of rels) {
      if (KEY.has(String(rel.target))) { bump("F11 an edge whose target is a language keyword"); note("F11", f) }
    }
  }
  console.log(`  measured over ${srcs.length} files`)
  for (const [k, v] of Object.entries(stats).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(v).padStart(4)} file(s)  ${k}`)
    if (samples[k]) console.log(`              e.g. ${samples[k].join(", ")}`)
  }
  const untouched = srcs.length - new Set(Object.values(samples).flat()).size
  console.log(`  distinct files touched by at least one finding: ${new Set(Object.values(samples).flat()).size} of ${srcs.length} (${((new Set(Object.values(samples).flat()).size / srcs.length) * 100).toFixed(1)}%)`)
  void untouched
}
main()
