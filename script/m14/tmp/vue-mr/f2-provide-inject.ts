// F2 design: what do provide/inject actually look like in the corpus, and what
// does the analyzer do with each shape today? Decide the emission from the
// census, not from the syntax I can imagine.
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

/** The literal shape of a `key: value` option's value. */
function shapeOf(v: string): string {
  const t = v.trim()
  if (!t) return "empty"
  if (/^\(/.test(t)) return "method/arrow property"
  if (/^\[/.test(t)) return "array literal"
  if (/^\{/.test(t)) return "object literal"
  if (/^['"`]/.test(t)) return "string literal"
  if (/^[A-Za-z_$]/.test(t)) return "identifier / call"
  return "other"
}

async function main() {
  const files = [...under(`${CORPUS}/element-plus`, 2000), ...under(`${CORPUS}/vue-element-admin`, 2000), ...under(`${CORPUS}/vue-core`, 200)]
  const shapes: Record<string, number> = {}
  const ex: Record<string, string> = {}
  for (const f of files) {
    const s = fs.readFileSync(f, "utf8")
    for (const m of s.matchAll(/^\s*(provide|inject)\s*:\s*(.+)$/gm)) {
      const k = `${m[1]}: option ${shapeOf(m[2])}`
      shapes[k] = (shapes[k] ?? 0) + 1
      if (!ex[k]) ex[k] = `${path.relative(CORPUS, f)} — ${m[0].trim().slice(0, 70)}`
    }
    for (const m of s.matchAll(/\b(provide|inject)\s*\(([^)]{0,90})\)/g)) {
      const args = m[2].trim()
      const k = `${m[1]}: call, ${args.split(",").length} arg(s) (${args.startsWith("'") || args.startsWith('"') || args.startsWith("`") ? "string key" : /^[A-Za-z_$]/.test(args) ? "identifier key" : "expr key"})`
      shapes[k] = (shapes[k] ?? 0) + 1
      if (!ex[k]) ex[k] = `${path.relative(CORPUS, f)} — ${m[0].slice(0, 80)}`
    }
  }
  console.log("=== F2.1  the shapes the corpus writes ===")
  for (const [k, v] of Object.entries(shapes).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(v).padStart(4)}  ${k.padEnd(52)} ${ex[k]}`)
  }

  console.log("\n=== F2.2  what the analyzer does with each, minimized ===")
  const cases: Array<[string, string]> = [
    ["Options provide() { return {...} }", `export default { name: 'P', provide() { return { theme: this.theme, locale: 'en' } } }`],
    ["Options provide: { … } property", `export default { name: 'P', provide: { theme: () => this.theme } }`],
    ["Options provide: someDef (variable)", `const defs = { theme: 1 }\nexport default { name: 'P', provide: defs }`],
    ["Options inject: ['a','b']", `export default { name: 'C', inject: ['theme', 'locale'] }`],
    ["Options inject: { a: {…} }", `export default { name: 'C', inject: { theme: { default: 'dark' }, locale: { from: 'l', default: 'en' } } }`],
    ["script-setup provide(key, {obj})", `import { provide } from 'vue'\nconst theme = 1\nprovide('theme', theme)\nprovide('api', { save() { return 1 }, load() { return 2 } })`],
    ["script-setup inject(key)", `import { inject } from 'vue'\nconst theme = inject('theme')`],
    ["script-setup inject(key, default)", `import { inject } from 'vue'\nconst theme = inject('theme', 'dark')`],
  ]
  for (const [label, body] of cases) {
    const r = await vue(`<template><p/></template>\n<script>\n${body}\n</script>`, "/tmp/probe/P.vue")
    const syms = (r.symbols ?? []).filter((s: any) => s.kind === "property" || s.kind === "method" || s.kind === "constant")
    const owned = syms.filter((s: any) => s.ownerName)
    console.log(`\n  ${label}`)
    console.log(`    symbols: ${JSON.stringify(names(r))}`)
    console.log(`    owned by the component: ${JSON.stringify(owned.map((s: any) => `${s.name}:${s.kind}`))}`)
    console.log(`    provide/inject call edges: ${JSON.stringify(rels(r, "calls").filter((x: any) => ["provide", "inject"].includes(String(x.target))).map((x: any) => `${x.source}->${x.target}`))}`)
  }
}
main()