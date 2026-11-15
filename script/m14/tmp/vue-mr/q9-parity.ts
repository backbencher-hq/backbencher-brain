// Q9 — PARITY WITH THE REFERENCE LANE. The typescript analyzer is the family's
// first reference implementation (M14-COMPLETENESS-LEDGER: "first web-family
// reference implementation"). This file derives, from BOTH analyzers' own
// sources, the feature inventory each implements, and then measures the
// difference on equivalent inputs.
import * as fs from "fs"
import * as path from "path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../../..")
const SRC = path.join(ROOT, "src/ast")

function read(name: string) { return fs.readFileSync(path.join(SRC, name), "utf8") }

async function main() {
  const ts = read("real-typescript-analyzer.ts")
  const vue = read("real-vue-analyzer.ts")
  const js = read("real-javascript-analyzer.ts")
  const svelte = read("real-svelte-analyzer.ts")
  const lines = (s: string) => s.split("\n").length

  console.log("=== Q9.1  SIZE ===")
  for (const [n, s] of [["typescript", ts], ["vue", vue], ["javascript", js], ["svelte", svelte]] as const) {
    console.log(`  ${n.padEnd(12)} ${String(lines(s)).padStart(6)} lines  ${String((s.length / 1024).toFixed(0)).padStart(4)} KB`)
  }

  console.log("\n=== Q9.2  CAPABILITY INVENTORY, derived from each analyzer's own source ===")
  const caps: Array<[string, RegExp]> = [
    ["decorator metadata", /decorators|decoratorLine/i],
    ["comments payload", /comments\s*[:=]/],
    ["taint sources", /taintSources/],
    ["taint sinks", /taintSinks/],
    ["api contract", /apiContract/],
    ["framework surface (routes etc.)", /frameworkSurface|isFramework|apiMethod/],
    ["generic parameters", /genericParameters|typeParameters/],
    ["type alias / type refs", /isTypeAliasMember|TypeReference|declaredType/],
    ["interface members", /isInterfaceMember/],
    ["union / intersection / mapped types", /isUnionType|isIntersectionType|isMappedType|isConditionalType/],
    ["abstract / static / async flags", /isAbstract|isStatic|isAsync/],
    ["optional markers", /isOptional/],
    ["accessors", /isAccessor/],
    ["index signatures", /isIndexSignature|indexParameter/],
    ["private fields", /isPrivateField/],
    ["class fields", /isFieldAccess|class_field/],
    ["evidence tiers", /evidenceClass/],
    ["synthesized-name declaration", /synthesized/],
    ["exported flag", /isExported/],
    ["const binding flag", /isConst/],
    ["generator", /isGenerator/],
    ["destructuring", /isDestructured/],
    ["ambient declare", /isDeclare/],
    ["references edges", /RelationshipType\.References/],
    ["calls edges", /RelationshipType\.Calls/],
    ["imports edges", /RelationshipType\.Imports/],
    ["exports edges", /RelationshipType\.Exports/],
    ["contains edges", /RelationshipType\.Contains/],
    ["uses edges", /RelationshipType\.Uses/],
    ["instantiates edges", /RelationshipType\.Instantiates/],
    ["extends edges", /RelationshipType\.Extends/],
    ["implements edges", /RelationshipType\.Implements/],
    ["overrides edges", /RelationshipType\.Overrides/],
    ["security/taint analysis", /sql_injection|xss|TaintAnalyzer|runTaint/],
    ["unused-symbol analysis", /unused|declarationCount|isDeclarationFileUnused/],
    ["documented-spec annexes in-file", /SPEC|spec-table|SPEC_TABLE/],
    ["hasTypeInference computed", /hasTypeInference\s*[:=]\s*(?!false)/],
  ]
  console.log("  capability".padEnd(42) + "typescript  vue     svelte   javascript")
  for (const [name, re] of caps) {
    const m = (s: string) => (re.test(s) ? "  yes   " : "  —     ")
    console.log(`  ${name.padEnd(42)}${m(ts)}${m(vue)}  ${m(svelte)}`)
  }

  console.log("\n=== Q9.3  What each analyzer's SYMBOL payload can carry (fields set anywhere) ===")
  const fields = ["isAbstract", "isStatic", "isAsync", "decorators", "comments", "genericParameters",
    "parameters", "returnType", "complexity", "qualified_calls", "apiContractPath", "taintSources",
    "taintSinks", "ownerName", "ownerKind", "scope", "visibility", "isOverride", "isAccessor",
    "isOptional", "isConst", "isExported", "isDeclare", "isGenerator", "isDestructured", "isReadonly"]
  const setIn = (s: string, f: string) => new RegExp(`(^|[^\\w.])${f}\\s*:`, "m").test(s) || new RegExp(`\\.${f}\\s*=`).test(s) || new RegExp(`\\b${f}\\s*[,}]`, "m").test(s)
  console.log("  field".padEnd(22) + "typescript  vue")
  for (const f of fields) {
    console.log(`  ${f.padEnd(22)}${setIn(ts, f) ? "  yes   " : "  —     "}${setIn(vue, f) ? "  yes   " : "  —     "}`)
  }

  console.log("\n=== Q9.4  metadata keys each analyzer can emit, measured over the corpus ===")
  const CORPUS = "/home/ishaq2321/bb_tests/repositories"
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  const collect = async (files: string[], label: string) => {
    const symMeta = new Map<string, number>()
    const relMeta = new Map<string, number>()
    const symFields = new Set<string>()
    let n = 0
    for (const f of files) {
      let src: string
      try { src = fs.readFileSync(f, "utf8") } catch { continue }
      let r: any
      try { r = await ASTEngine.parseFile(f, src) } catch { continue }
      n++
      for (const s of r.symbols ?? []) {
        for (const k of Object.keys(s)) symFields.add(k)
        for (const k of Object.keys(s.metadata ?? {})) symMeta.set(k, (symMeta.get(k) ?? 0) + 1)
      }
      for (const rel of r.relationships ?? []) {
        for (const k of Object.keys(rel.metadata ?? {})) relMeta.set(k, (relMeta.get(k) ?? 0) + 1)
      }
    }
    console.log(`\n  --- ${label} (${n} files)`)
    console.log(`  symbol fields present (${symFields.size}): ${[...symFields].sort().join(" ")}`)
    console.log(`  symbol metadata keys (${symMeta.size}): ${[...symMeta.keys()].sort().join(" ")}`)
    console.log(`  relationship metadata keys (${relMeta.size}): ${[...relMeta.keys()].sort().join(" ")}`)
    return { symFields: [...symFields].sort(), symMeta: [...symMeta.keys()].sort(), relMeta: [...relMeta.keys()].sort() }
  }
  const under = (root: string, exts: string[], limit: number) => {
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
  const tsRes = await collect(under(`${CORPUS}/element-plus`, [".ts", ".tsx"], 200), "typescript (element-plus)")
  const vueRes = await collect([...under(`${CORPUS}/element-plus`, [".vue"], 200), ...under(`${CORPUS}/vue-element-admin`, [".vue"], 131)], "vue (element-plus + vue-element-admin)")

  console.log("\n  === IN TYPESCRIPT BUT NOT VUE ===")
  for (const k of tsRes.symFields) if (!vueRes.symFields.includes(k)) console.log(`    field      ${k}`)
  for (const k of tsRes.symMeta) if (!vueRes.symMeta.includes(k)) console.log(`    symMeta    ${k}`)
  for (const k of tsRes.relMeta) if (!vueRes.relMeta.includes(k)) console.log(`    relMeta    ${k}`)
  console.log("  === IN VUE BUT NOT TYPESCRIPT ===")
  for (const k of vueRes.symFields) if (!tsRes.symFields.includes(k)) console.log(`    field      ${k}`)
  for (const k of vueRes.symMeta) if (!tsRes.symMeta.includes(k)) console.log(`    symMeta    ${k}`)
  for (const k of vueRes.relMeta) if (!tsRes.relMeta.includes(k)) console.log(`    relMeta    ${k}`)
}
main()
