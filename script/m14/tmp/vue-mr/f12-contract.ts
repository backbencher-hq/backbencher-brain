// F12 — THE CONTRACT LOST IN ITS STANDARD FORM. defineProps<NamedProps>() and
// defineProps(propsDef) — the two shapes a real component library writes —
// extract nothing, while the inline forms the fixtures pin extract everything.
import * as fs from "fs"
import * as path from "path"
import { vue, syms, names } from "./harness"

const CORPUS = "/home/ishaq2321/bb_tests/repositories"

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
  console.log("=== F12.1  the four defineProps shapes, minimized ===")
  const cases: Array<[string, string, string?]> = [
    ["A inline type literal (the pinned fixture shape)", `const p = defineProps<{ modelValue: string; size?: number }>()`],
    ["B NAMED type argument (what element-plus writes)", `const p = defineProps<AffixProps>()`],
    ["C named type, interface declared in the SAME file", `interface AffixProps { type: string; offset: number }\nconst p = defineProps<AffixProps>()`],
    ["D named type via a type alias in the same file", `type AffixProps = { type: string; offset: number }\nconst p = defineProps<AffixProps>()`],
    ["E named type INTERSECTION", `type A = { a: string }\nconst p = defineProps<A & { b: number }>()`],
    ["F runtime object literal", `const p = defineProps({ modelValue: { type: String, default: '' } })`],
    ["G runtime array", `const p = defineProps(['a', 'b'])`],
    ["H variable reference (props imported from a sibling .ts)", `import { affixProps } from '../src/affix'\nconst p = defineProps(affixProps)`],
    ["I variable reference declared in the same file", `const defs = { a: String, b: Number }\nconst p = defineProps(defs)`],
    ["J withDefaults wrapping a named type", `const p = withDefaults(defineProps<AffixProps>(), { offset: 0 })`],
  ]
  for (const [label, body] of cases) {
    const r = await vue(`<template><p/></template>\n<script setup lang="ts">\n${body}\n</script>`, "/tmp/probe/F12.vue")
    const props = (r.symbols ?? []).filter((x: any) => x.metadata?.isProp).map((x: any) => x.name)
    console.log(`  ${props.length ? "OK  " : "LOSS"} ${label.padEnd(52)} props=${JSON.stringify(props)}`)
  }

  console.log("\n=== F12.2  the same for defineEmits ===")
  for (const [label, body] of [
    ["A inline call-signature type", `const e = defineEmits<{ (e: 'change'): void }>()`],
    ["B NAMED type argument", `const e = defineEmits<AffixEmits>()`],
    ["C named type declared in the same file", `type AffixEmits = { (e: 'change'): void }\nconst e = defineEmits<AffixEmits>()`],
    ["D runtime array", `const e = defineEmits(['change', 'close'])`],
    ["E runtime object", `const e = defineEmits({ change: (v: string) => true })`],
    ["F variable reference", `import { affixEmits } from '../src/affix'\nconst e = defineEmits(affixEmits)`],
  ] as const) {
    const r = await vue(`<template><p/></template>\n<script setup lang="ts">\n${body}\n</script>`, "/tmp/probe/F12b.vue")
    const emits = (r.symbols ?? []).filter((x: any) => x.metadata?.isEmit).map((x: any) => x.name)
    console.log(`  ${emits.length ? "OK  " : "LOSS"} ${label.padEnd(52)} emits=${JSON.stringify(emits)}`)
  }

  console.log("\n=== F12.3  is the named type RESOLVABLE? does the corpus declare or import it? ===")
  {
    const f = `${CORPUS}/element-plus/packages/components/affix/src/affix.vue`
    const s = fs.readFileSync(f, "utf8")
    console.log(`  ${path.relative(CORPUS, f)}:`)
    for (const l of s.split("\n").slice(0, 30)) if (/import|defineProps|withDefaults|interface|type /.test(l)) console.log(`    ${l.trim()}`)
    const imp = /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+['"]([^'"]+)['"]/.exec(s)
    console.log(`  → the props type is ${imp ? `IMPORTED from ${imp[2]}` : "declared in-file"}`)
    if (imp) {
      const target = path.resolve(path.dirname(f), imp[2])
      for (const ext of [".ts", ".tsx", "/index.ts", ".d.ts"]) {
        const cand = target + ext
        if (fs.existsSync(cand)) {
          console.log(`  → ${path.relative(CORPUS, cand)} EXISTS:`)
          const t = fs.readFileSync(cand, "utf8")
          const i = t.indexOf("AffixProps")
          for (const l of t.split("\n").slice(Math.max(0, t.slice(0, i).split("\n").length - 12), t.slice(0, i).split("\n").length + 12)) console.log(`      ${l}`)
          break
        }
      }
    }
  }

  console.log("\n=== F12.4  corpus reachability, precisely ===")
  const { ASTEngine } = await import(path.resolve(import.meta.dirname ?? ".", "../../../..", "src/ast/engine.ts"))
  const files = [...under(`${CORPUS}/element-plus`, 2000), ...under(`${CORPUS}/vue-element-admin`, 2000), ...under(`${CORPUS}/vue-core`, 200)]
  const buckets: Record<string, { n: number; miss: number }> = {}
  const add = (k: string, miss: boolean) => { const e = buckets[k] ?? { n: 0, miss: 0 }; e.n++; if (miss) e.miss++; buckets[k] = e }
  for (const f of files) {
    const s = fs.readFileSync(f, "utf8")
    let r: any
    try { r = await ASTEngine.parseFile(f, s) } catch { continue }
    const nProps = (r.symbols ?? []).filter((x: any) => x.metadata?.isProp).length
    const nEmits = (r.symbols ?? []).filter((x: any) => x.metadata?.isEmit).length
    if (/\bdefineProps\s*</.test(s)) {
      const named = !/defineProps\s*<\s*\{/.test(s)
      add(named ? "defineProps<NAMED>()" : "defineProps<{ inline }>()", nProps === 0)
    }
    if (/\bdefineProps\s*\(/.test(s)) {
      const lit = /defineProps\s*\(\s*[[{]/.test(s)
      add(lit ? "defineProps({ inline })" : "defineProps(variable)", nProps === 0)
    }
    if (/\bdefineEmits\s*</.test(s)) {
      const named = !/defineEmits\s*<\s*\{/.test(s)
      add(named ? "defineEmits<NAMED>()" : "defineEmits<{ inline }>()", nEmits === 0)
    }
    if (/\bdefineEmits\s*\(/.test(s)) {
      const lit = /defineEmits\s*\(\s*[[{]/.test(s)
      add(lit ? "defineEmits([ inline ])" : "defineEmits(variable)", nEmits === 0)
    }
    // Options prop/emits whose keys the analyzer misses
    if (/^\s*props\s*:/m.test(s)) {
      const m = /^\s*props\s*:\s*([\[{])/.exec(s)
      add(m ? `props: ${m[1] === "[" ? "array" : "object"}` : "props: <other>", nProps === 0)
    }
  }
  console.log(`  shape                            written  contract LOST`)
  for (const [k, v] of Object.entries(buckets).sort((a, b) => b[1].n - a[1].n)) {
    console.log(`  ${k.padEnd(32)} ${String(v.n).padStart(6)}  ${String(v.miss).padStart(6)}  (${((v.miss / v.n) * 100).toFixed(0)}%)`)
  }
}
main()
