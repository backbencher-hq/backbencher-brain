// Q1 — RELATIONSHIP COVERAGE. What vue emits, what it could emit, and what
// every relationship type the engine defines is doing in this lane.
import * as fs from "fs"
import * as path from "path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../../..")
const CORPUS_ROOT = "/home/ishaq2321/bb_tests/repositories"

function filesUnder(root: string, exts: string[], limit: number): string[] {
  const out: string[] = []
  const walk = (d: string) => {
    if (out.length >= limit) return
    let es: fs.Dirent[]
    try { es = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of es) {
      if (out.length >= limit) return
      if (e.name === ".git" || e.name === "node_modules" || e.name === "dist" || e.name === "playground") continue
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (exts.some((x) => e.name.endsWith(x))) out.push(p)
    }
  }
  walk(root)
  return out.sort()
}

async function main() {
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))

  console.log("=== Q1.1  the engine's RelationshipType enum, and which vue can emit ===")
  const enumSrc = fs.readFileSync(path.join(ROOT, "src/ast/engine.ts"), "utf8")
  const block = enumSrc.slice(enumSrc.indexOf("export enum RelationshipType"))
  const values = [...block.slice(0, block.indexOf("}")).matchAll(/=\s*"([a-z_]+)"/g)].map((m) => m[1])
  const distinct = [...new Set(values)]
  console.log(`  enum values (deduped): ${distinct.join(" ")}`)

  const vueSrc = fs.readFileSync(path.join(ROOT, "src/ast/real-vue-analyzer.ts"), "utf8")
  const vueEmits = [...vueSrc.matchAll(/RelationshipType\.(\w+)/g)].map((m) => m[1])
  const vueTypes = [...new Set(vueEmits.map((t) => {
    // the enum's alias values
    const m = new RegExp(`\\b${t}\\s*=\\s*"([a-z_]+)"`).exec(block)
    return m ? m[1] : t.toLowerCase()
  }))]
  console.log(`  vue analyzer constructs: ${[...new Set(vueEmits)].join(" ")}`)
  console.log(`  → value strings:        ${vueTypes.join(" ")}`)
  const neverConstructed = distinct.filter((v) => !vueTypes.includes(v))
  console.log(`  NEVER constructed by the vue analyzer: ${neverConstructed.join(" ")}`)

  console.log("\n=== Q1.2  what the JS/TS SUB-analyzers construct (the seam's inherited surface) ===")
  for (const f of ["real-javascript-analyzer.ts", "real-typescript-analyzer.ts"]) {
    const s = fs.readFileSync(path.join(ROOT, "src/ast", f), "utf8")
    const em = [...new Set([...s.matchAll(/RelationshipType\.(\w+)/g)].map((m) => m[1]))]
    console.log(`  ${f}: ${em.join(" ")}`)
  }

  console.log("\n=== Q1.3  measured label distribution over a real draw (element-plus, 400 files) ===")
  const files = filesUnder(path.join(CORPUS_ROOT, "element-plus"), [".vue"], 400)
  const labels = new Map<string, number>()
  const byLine = new Map<string, { noLine: number; line0: number }>()
  const withConf = new Map<string, number>()
  const noConf = new Map<string, number>()
  let edges = 0, symbols = 0
  const kindCount = new Map<string, number>()
  const metaKeys = new Map<string, number>()
  let parseErrFiles = 0
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8")
    let r: any
    try { r = await ASTEngine.parseFile(f, src) } catch { continue }
    if ((r.errors?.length ?? 0) > 0) parseErrFiles++
    for (const rel of r.relationships ?? []) {
      const t = String(rel.type ?? rel.relationshipType)
      labels.set(t, (labels.get(t) ?? 0) + 1)
      const b = byLine.get(t) ?? { noLine: 0, line0: 0 }
      if (typeof rel.line_number !== "number") b.noLine++
      else if (rel.line_number === 0) b.line0++
      byLine.set(t, b)
      const c = typeof rel.confidence === "number" ? rel.confidence : -1
      if (c < 0) noConf.set(t, (noConf.get(t) ?? 0) + 1)
      else withConf.set(t, (withConf.get(t) ?? 0) + 1)
      for (const k of Object.keys(rel.metadata ?? {})) metaKeys.set(k, (metaKeys.get(k) ?? 0) + 1)
      edges++
    }
    for (const s of r.symbols ?? []) {
      symbols++
      kindCount.set(s.kind, (kindCount.get(s.kind) ?? 0) + 1)
      for (const k of Object.keys(s.metadata ?? {})) metaKeys.set("SYM." + k, (metaKeys.get("SYM." + k) ?? 0) + 1)
    }
  }
  console.log(`  files=${files.length} edges=${edges} symbols=${symbols} filesWithParseErrors=${parseErrFiles}`)
  console.log("  label            count   noLine  line0  noConfidence")
  for (const [t, n] of [...labels.entries()].sort((a, b) => b[1] - a[1])) {
    const b = byLine.get(t)!
    console.log(`  ${t.padEnd(15)} ${String(n).padStart(6)}   ${String(b.noLine).padStart(5)}  ${String(b.line0).padStart(4)}  ${String(noConf.get(t) ?? 0).padStart(11)}`)
  }
  console.log("  kinds: " + [...kindCount.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(" "))
  console.log("  relationship metadata keys: " + [...metaKeys.entries()].filter(([k]) => !k.startsWith("SYM.")).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(" "))
  console.log("  symbol metadata keys: " + [...metaKeys.entries()].filter(([k]) => k.startsWith("SYM.")).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(" "))
}
main()
