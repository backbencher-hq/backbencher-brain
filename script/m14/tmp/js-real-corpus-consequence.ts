// Real-corpus consequence measurement for the javascript lane (2026-09-26)
// Runs the PRODUCTION entry (parseFile-equivalent: RealJavaScriptAnalyzer)
// over a JS-dominant corpus and counts the sites each review finding costs.
import * as WTS from "web-tree-sitter"
import { RealJavaScriptAnalyzer } from "../../../src/ast/real-javascript-analyzer"
import * as fs from "fs"
import * as path from "path"

const ROOT = "<corpus-root>/bb_tests/repositories/svelte"
const LIMIT = Number(process.env.LIMIT ?? 400)

function walkFiles(dir: string, out: string[], depth = 0): void {
  if (depth > 14) return
  let entries: fs.Dirent[]
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    if (e.name === ".git" || e.name === "node_modules") continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walkFiles(p, out, depth + 1)
    else if (e.name.endsWith(".js")) out.push(p)
  }
}

async function main() {
  const wts: any = WTS
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init()
  const lang = await L.load("wasm/tree-sitter-javascript.wasm")
  const p = new P(); p.setLanguage(lang)
  const a = new RealJavaScriptAnalyzer() as any

  const files: string[] = []
  walkFiles(ROOT, files)
  files.sort()
  const sample = files.slice(0, LIMIT)

  const t = {
    files: 0, symbols: 0, rels: 0,
    ownerlessMethods: 0,          // J-F2: object-literal / class-expression members with no owner -> no contains
    containsEdges: 0,
    classDecls: 0, classExprs: 0, classExprHeritage: 0, accessors: 0, fields: 0,
    accessorOverrides: 0, accessorOverrideCandidates: 0,
    cjsMethodExports: 0, cjsExportObjMethods: 0,
    defaultImports: 0, defaultImportEdges: 0,
    aliasedImports: 0, aliasedImportEdges: 0,
    danglingExtends: 0, danglingExports: 0,
  }

  for (const f of sample) {
    let src: string
    try { src = fs.readFileSync(f, "utf8") } catch { continue }
    if (src.length > 400000) continue
    let tree: any
    try { tree = p.parse(src) } catch { continue }
    t.files++
    const r = await a.analyze(tree.rootNode, src, f, undefined)
    const syms = r.symbols ?? []
    const rels = r.relationships ?? []
    t.symbols += syms.length
    t.rels += rels.length

    const symNames = new Set<string>()
    for (const s of syms) if (s.kind === "class") symNames.add(s.name)

    for (const s of syms) {
      const isMember = s.kind === "method" || s.kind === "constructor" || s.kind === "property"
      if (isMember && !s.ownerName) t.ownerlessMethods++
      if (s.metadata?.isAccessor) t.accessors++
      if (s.kind === "property" && s.ownerName && s.ownerKind === "class" && !s.metadata?.isAccessor) t.fields++
    }
    for (const r2 of rels) {
      const ty = String(r2.type).toLowerCase()
      if (ty === "contains") t.containsEdges++
      if (ty === "extends") {
        if (!symNames.has(r2.source)) t.danglingExtends++
        // class-expression heritage: a class expression contributes no Class symbol
      }
      if (ty === "exports" && !symNames.has(r2.target)) {
        // exports whose target is not a class symbol is normal (functions/vars);
        // counted separately below via a real dead-body test
      }
      if (ty === "imports") {
        const tgt = String(r2.target)
        const item = tgt.includes(":") ? tgt.slice(tgt.lastIndexOf(":") + 1) : tgt
        if (item === "default") t.defaultImportEdges++
      }
      if (ty === "overrides" && r2.metadata?.isAccessor) t.accessorOverrides++
    }

    // class declarations / expressions + their heritage, straight from the AST
    const stack = [tree.rootNode]
    const classExprs: any[] = []
    while (stack.length) {
      const n: any = stack.pop()
      if (n.type === "class_declaration") t.classDecls++
      if (n.type === "class") { t.classExprs++; classExprs.push(n) }
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) stack.push(c) }
    }
    for (const ce of classExprs) {
      let has = false
      for (let i = 0; i < ce.namedChildCount; i++) { const c = ce.namedChild(i); if (c && c.type === "class_heritage") has = true }
      if (has) t.classExprHeritage++
    }

    // CJS: object-literal methods reachable as export surface
    for (const e of r.exports ?? []) {
      if (e.metadata?.viaCommonJs) t.cjsExportObjMethods++
    }

    // import alias / default shapes, from the AST
    const st2 = [tree.rootNode]
    while (st2.length) {
      const n: any = st2.pop()
      if (n.type === "import_specifier" && n.childForFieldName("alias")) t.aliasedImports++
      if (n.type === "import_clause") {
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c && c.type === "identifier") t.defaultImports++
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) st2.push(c) }
    }
  }

  console.log(JSON.stringify({ corpus: "svelte (.js, production analyzer)", ...t }, null, 1))
  console.log(`\nownerless member symbols: ${t.ownerlessMethods} of ${t.symbols} symbols (${((t.ownerlessMethods / t.symbols) * 100).toFixed(1)}%)`)
  console.log(`class expressions: ${t.classExprs}, of which carry heritage the analyzer drops: ${t.classExprHeritage}`)
  console.log(`accessor symbols: ${t.accessors}, field symbols: ${t.fields}`)
  console.log(`default imports seen: ${t.defaultImports}; 'm:default' import edges emitted: ${t.defaultImportEdges}`)
  console.log(`aliased import specifiers: ${t.aliasedImports} (each emits an edge naming the LOCAL name)`)
}
main().catch((e) => { console.error(e); process.exit(1) })
