// F12.5 — the ground-truth form of the finding. Not "the analyzer emitted no
// symbol" but "the corpus file imports a props declaration with N named props
// and the analyzer's output names zero of them".
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

/** Prop names declared by an element-plus `xxxProps` object, read from source. */
function propsFromSibling(vueFile: string, macro: "defineProps" | "defineEmits"): string[] {
  const s = fs.readFileSync(vueFile, "utf8")
  const call = new RegExp(`\\b${macro}\\s*[(<]\\s*([A-Za-z_$][\\w$]*)`).exec(s)
  if (!call) return []
  const local = call[1]
  // find the import that binds `local`
  const imp = new RegExp(`import\\s+(?:type\\s+)?\\{([^}]*)\\}\\s+from\\s+['"]([^'"]+)['"]`).exec(s)
  if (!imp || !imp[1].split(",").map((x) => x.trim()).includes(local)) return []
  const target = path.resolve(path.dirname(vueFile), imp[2])
  let text: string | null = null
  for (const ext of [".ts", ".tsx", "/index.ts", ".d.ts"]) {
    if (fs.existsSync(target + ext)) { text = fs.readFileSync(target + ext, "utf8"); break }
  }
  if (!text) return []
  if (macro === "defineEmits") {
    // `export const xxxEmits = ['a','b'] as const`  or  an object of handlers
    const arr = new RegExp(`${local}\\s*(?::[^=]+)?=\\s*\\[([\\s\\S]{0,900}?)\\]`).exec(text)
    if (arr) return [...arr[1].matchAll(/['"]([\w:-]+)['"]/g)].map((m) => m[1])
    const obj = new RegExp(`${local}[\\s\\S]{0,80}?=\\s*\\{([\\s\\S]{0,1200}?)\\n\\}`).exec(text)
    if (obj) return [...obj[1].matchAll(/^\s{2}([A-Za-z_$][\w$]*)\s*[(:]/gm)].map((m) => m[1])
    return []
  }
  const obj = new RegExp(`${local}[\\s\\S]{0,120}?=\\s*\\{([\\s\\S]{0,3000}?)\\n\\} as const`).exec(text)
  if (obj) return [...obj[1].matchAll(/^\s{2}([A-Za-z_$][\w$]*)\s*[?:]/gm)].map((m) => m[1])
  const obj2 = new RegExp(`${local}\\s*(?::[^=]+)?=\\s*\\{([\\s\\S]{0,3000}?)\\n\\}`).exec(text)
  if (obj2) return [...obj2[1].matchAll(/^\s{2}([A-Za-z_$][\w$]*)\s*[?:]/gm)].map((m) => m[1])
  return []
}

async function main() {
  const { ASTEngine } = await import(path.resolve(import.meta.dirname ?? ".", "../../../..", "src/ast/engine.ts"))
  const files = under(`${CORPUS}/element-plus`, 2000)
  let audited = 0, propRows = 0, propFound = 0, propMissing = 0
  let emitRows = 0, emitFound = 0, emitMissing = 0
  const ex: string[] = []
  for (const f of files) {
    const s = fs.readFileSync(f, "utf8")
    if (!/defineProps\s*[(<]\s*[A-Za-z_$]/.test(s) && !/defineEmits\s*[(<]\s*[A-Za-z_$]/.test(s)) continue
    const declaredProps = propsFromSibling(f, "defineProps")
    const declaredEmits = propsFromSibling(f, "defineEmits")
    if (!declaredProps.length && !declaredEmits.length) continue
    audited++
    let r: any
    try { r = await ASTEngine.parseFile(f, s) } catch { continue }
    const gotProps = new Set((r.symbols ?? []).filter((x: any) => x.metadata?.isProp).map((x: any) => x.name))
    const gotEmits = new Set((r.symbols ?? []).filter((x: any) => x.metadata?.isEmit).map((x: any) => x.name))
    if (declaredProps.length) {
      propRows += declaredProps.length
      const hit = declaredProps.filter((p) => gotProps.has(p)).length
      propFound += hit; propMissing += declaredProps.length - hit
      if (hit === 0 && ex.length < 4) ex.push(`${path.relative(CORPUS, f)}\n      declares ${declaredProps.length} prop(s): ${declaredProps.slice(0, 8).join(", ")}\n      analyzer emitted ${gotProps.size} prop symbol(s): ${JSON.stringify([...gotProps].slice(0, 8))}`)
    }
    if (declaredEmits.length) {
      emitRows += declaredEmits.length
      const hit = declaredEmits.filter((p) => gotEmits.has(p)).length
      emitFound += hit; emitMissing += declaredEmits.length - hit
    }
  }
  console.log(`=== F12.5  GROUND TRUTH: props/emits declared in the sibling module, as the analyzer reports them ===`)
  console.log(`  files audited (macro names a declaration this tool can read from its sibling module): ${audited}`)
  console.log(`  PROPS:  ${propRows} declared across those files; analyzer names ${propFound} (${((propFound / Math.max(propRows, 1)) * 100).toFixed(1)}%), MISSING ${propMissing}`)
  console.log(`  EMITS:  ${emitRows} declared across those files; analyzer names ${emitFound} (${((emitFound / Math.max(emitRows, 1)) * 100).toFixed(1)}%), MISSING ${emitMissing}`)
  console.log("\n  worked examples:")
  for (const e of ex) console.log(`    ${e}`)

  console.log("\n=== F12.6  does the TS analyzer find the same declarations? (the reference lane, on the same .ts file) ===")
  {
    const v = `${CORPUS}/element-plus/packages/components/affix/src/affix.vue`
    const r = await ASTEngine.parseFile(v, fs.readFileSync(v, "utf8"))
    console.log(`  affix.vue symbols: ${(r.symbols ?? []).map((x: any) => `${x.name}:${x.kind}`).join(" ")}`)
    const tsFile = `${CORPUS}/element-plus/packages/components/affix/src/affix.ts`
    if (fs.existsSync(tsFile)) {
      const t = await ASTEngine.parseFile(tsFile, fs.readFileSync(tsFile, "utf8"))
      console.log(`  affix.ts  symbols: ${(t.symbols ?? []).map((x: any) => `${x.name}:${x.kind}`).join(" ")}`)
    } else {
      console.log(`  (affix.ts not at that path)`)
      const dir = path.dirname(v)
      console.log(`  siblings: ${fs.readdirSync(dir).join(" ")}`)
    }
  }
}
main()
