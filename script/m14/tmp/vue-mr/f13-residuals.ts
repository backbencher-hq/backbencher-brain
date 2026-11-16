// F13 — the two residuals F12.4 left open: `props: <other>` (20 of 75 lost) and
// the 1-of-23 inline miss. Both may be the same root cause.
import * as fs from "fs"
import * as path from "path"
import { vue, names } from "./harness"

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

async function main() {
  const { ASTEngine } = await import(path.resolve(import.meta.dirname ?? ".", "../../../..", "src/ast/engine.ts"))
  const files = [...under(`${CORPUS}/element-plus`, 2000), ...under(`${CORPUS}/vue-element-admin`, 2000), ...under(`${CORPUS}/vue-core`, 200)]

  console.log("=== F13.1  `props:` that yields no symbol — the actual text ===")
  let shown = 0
  for (const f of files) {
    const s = fs.readFileSync(f, "utf8")
    const m = /^\s*props\s*:\s*(.)/m.exec(s)
    if (!m || m[1] === "[" || m[1] === "{") continue
    let r: any
    try { r = await ASTEngine.parseFile(f, s) } catch { continue }
    const n = (r.symbols ?? []).filter((x: any) => x.metadata?.isProp).length
    if (n > 0) continue
    const i = s.indexOf(m[0])
    console.log(`  ${path.relative(CORPUS, f)}  props starts with ${JSON.stringify(m[1])}`)
    for (const l of s.split("\n").slice(Math.max(0, s.slice(0, i).split("\n").length - 2), s.slice(0, i).split("\n").length + 6)) console.log(`      ${l}`)
    if (++shown >= 4) break
  }

  console.log("\n=== F13.2  minimized `props:` shapes ===")
  for (const [label, body] of [
    ["props: { a: { type: String } }", `export default { name: 'W', props: { a: { type: String } } }`],
    ["props: { ...spread, a: String }", `export default { name: 'W', props: { ...base, a: String } }`],
    ["props: [ 'a' ]", `export default { name: 'W', props: ['a'] }`],
    ["props: propDefs (a variable)", `const propDefs = { a: String }\nexport default { name: 'W', props: propDefs }`],
    ["props: { a: { required: true, validator: (v) => !!v } }", `export default { name: 'W', props: { a: { required: true, validator: (v) => !!v } } }`],
    ["props nested TWO deep", `export default { name: 'W', props: { a: { type: Object, default: () => ({ b: 1 }) } } }`],
    ["props with a numeric key", `export default { name: 'W', props: { 1: String } }`],
  ] as const) {
    const r = await vue(`<template><p/></template>\n<script>\n${body}\n</script>`, "/tmp/probe/F13.vue")
    const props = (r.symbols ?? []).filter((x: any) => x.metadata?.isProp).map((x: any) => x.name)
    console.log(`  ${props.length ? "OK  " : "LOSS"} ${label.padEnd(52)} ${JSON.stringify(props)}`)
  }

  console.log("\n=== F13.3  F12 totals, exactly ===")
  let f12 = 0, withContract = 0
  const detail: Record<string, number> = {}
  for (const f of files) {
    const s = fs.readFileSync(f, "utf8")
    const loss =
      (/defineProps\s*<\s*[A-Za-z_$]/.test(s)) ||
      (/defineProps\s*\(\s*[A-Za-z_$]/.test(s)) ||
      (/defineEmits\s*<\s*[A-Za-z_$]/.test(s)) ||
      (/defineEmits\s*\(\s*[A-Za-z_$]/.test(s))
    if (loss) { f12++; detail[path.basename(f)] = (detail[path.basename(f)] ?? 0) + 1 }
    if (/^\s*props\s*:/m.test(s) || /^\s*emits\s*:/m.test(s) || /\bdefineProps\s*[<(:]/.test(s) || /\bdefineEmits\s*[<(:]/.test(s)) withContract++
  }
  console.log(`  corpus: ${files.length} .vue files`)
  console.log(`  files that DECLARE a props/emits contract in some form: ${withContract} (${((withContract / files.length) * 100).toFixed(1)}%)`)
  console.log(`  files whose ENTIRE contract is lost (named/variable macro form): ${f12} (${((f12 / files.length) * 100).toFixed(1)}%)`)
  void names
}
main()
