// F12.7 — the ground truth, read the way the corpus actually writes it:
// `import type { AffixProps } from './affix'` + `defineProps<AffixProps>()`.
// The declaration lives in the sibling module; the component's own graph says
// nothing about it.
import * as fs from "fs"
import * as path from "path"

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

function resolveSibling(vueFile: string, spec: string): string | null {
  const base = path.resolve(path.dirname(vueFile), spec)
  for (const ext of ["", ".ts", ".tsx", ".d.ts", "/index.ts", ".js"]) {
    if (fs.existsSync(base + ext) && fs.statSync(base + ext).isFile()) return base + ext
  }
  return null
}

async function main() {
  const { ASTEngine } = await import(path.resolve(import.meta.dirname ?? ".", "../../../..", "src/ast/engine.ts"))
  const files = under(`${CORPUS}/element-plus`, 2000)

  console.log("=== F12.7.1  every `defineProps<Named>()`: is the named type declared, and where? ===")
  let named = 0, typeLocal = 0, typeImported = 0, typeUnresolved = 0
  const ex: string[] = []
  for (const f of files) {
    const s = fs.readFileSync(f, "utf8")
    const m = /defineProps\s*<\s*([A-Za-z_$][\w$]*)\s*>/.exec(s)
    if (!m) continue
    named++
    const t = m[1]
    // declared in this same file?
    if (new RegExp(`(interface|type)\\s+${t}\\b`).test(s)) { typeLocal++; continue }
    // imported from a sibling?
    let resolved = false
    for (const im of s.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+['"]([^'"]+)['"]/g)) {
      if (im[1].split(",").map((x) => x.trim().replace(/^type\s+/, "")).includes(t)) {
        const r = resolveSibling(f, im[2])
        if (r && new RegExp(`(interface|type)\\s+${t}\\b`).test(fs.readFileSync(r, "utf8"))) {
          typeImported++
          resolved = true
          if (ex.length < 3) ex.push(`${path.relative(CORPUS, f)}\n      defineProps<${t}>(); ${t} is declared in ${path.relative(CORPUS, r)}`)
          break
        }
      }
    }
    if (!resolved && !new RegExp(`(interface|type)\\s+${t}\\b`).test(s)) typeUnresolved++
  }
  console.log(`  defineProps<Named>() sites: ${named}`)
  console.log(`    the named type is declared IN THE SAME FILE:  ${typeLocal}`)
  console.log(`    the named type is IMPORTED from a sibling:   ${typeImported}   <-- every one of these is resolvable on disk`)
  console.log(`    the named type cannot be found:               ${typeUnresolved}`)
  for (const e of ex) console.log(`    e.g. ${e}`)

  console.log("\n=== F12.7.2  same for defineEmits(variable) ===")
  let dv = 0, dvLocal = 0, dvImported = 0, dvUnresolved = 0
  for (const f of files) {
    const s = fs.readFileSync(f, "utf8")
    const m = /defineEmits\s*\(\s*([A-Za-z_$][\w$]*)\s*\)/.exec(s)
    if (!m) continue
    dv++
    const t = m[1]
    if (new RegExp(`(const|let|var)\\s+${t}\\b`).test(s)) { dvLocal++; continue }
    let resolved = false
    for (const im of s.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+['"]([^'"]+)['"]/g)) {
      if (im[1].split(",").map((x) => x.trim()).includes(t)) {
        const r = resolveSibling(f, im[2])
        if (r) { dvImported++; resolved = true; break }
      }
    }
    if (!resolved) dvUnresolved++
  }
  console.log(`  defineEmits(variable) sites: ${dv}`)
  console.log(`    declared IN THE SAME FILE:  ${dvLocal}`)
  console.log(`    IMPORTED from a sibling:    ${dvImported}   <-- resolvable on disk`)
  console.log(`    cannot be found:            ${dvUnresolved}`)

  console.log("\n=== F12.7.3  THE HEADLINE, in one table: one real component, end to end ===")
  {
    const f = `${CORPUS}/element-plus/packages/components/affix/src/affix.vue`
    const ts = `${CORPUS}/element-plus/packages/components/affix/src/affix.ts`
    const r = await ASTEngine.parseFile(f, fs.readFileSync(f, "utf8"))
    const props = (r.symbols ?? []).filter((x: any) => x.metadata?.isProp)
    const emits = (r.symbols ?? []).filter((x: any) => x.metadata?.isEmit)
    console.log(`  affix.vue`)
    console.log(`    prop symbols:  ${props.length}  ${JSON.stringify(props.map((p: any) => p.name))}`)
    console.log(`    emit symbols:  ${emits.length}  ${JSON.stringify(emits.map((p: any) => p.name))}`)
    const r2 = await ASTEngine.parseFile(ts, fs.readFileSync(ts, "utf8"))
    const ifc = (r2.symbols ?? []).find((x: any) => x.name === "AffixProps")
    console.log(`  affix.ts (the module affix.vue imports its contract from)`)
    console.log(`    AffixProps members: ${JSON.stringify((r2.symbols ?? []).filter((x: any) => x.ownerName === "AffixProps").map((x: any) => x.name))}`)
    console.log(`    affixEmits: ${JSON.stringify((r2.symbols ?? []).filter((x: any) => String(x.name).includes("affixEmits")).map((x: any) => x.name + ":" + x.kind))}`)
    const imports = (r.imports ?? []).filter((i: any) => String(i.module).includes("affix"))
    console.log(`  the ONLY link between them: import edges ${JSON.stringify(imports.map((i: any) => `${i.module}[${(i.items ?? []).join(",")}]`))}`)
    console.log(`  is there an edge from the component to any prop name? ${JSON.stringify((r.relationships ?? []).filter((x: any) => ["zIndex", "offset", "teleported", "appendTo", "position", "target"].includes(String(x.target))).map((x: any) => `${x.type}->${x.target}`))}`)
    void ifc
  }
}
main()
