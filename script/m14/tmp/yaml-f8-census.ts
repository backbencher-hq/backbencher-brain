// F8 input for the YAML completeness spec: for every node type the grammar declares,
// one row carrying (a) is it in node-types.json, (b) is it in the wired wasm,
// (c) how often it occurs across the eight pinned corpora, (d) does the analyzer name
// it, and (e) which analyzer literal/site names it.
//
// This is the blind-spot detector's data. An UNCLASSIFIED type is an unmeasured hole;
// a type the analyzer names but the grammar lacks is a dead branch. Both are printed.
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
const CORPUS_ROOT = "<corpus-root>/bb_tests/repositories"
const REPOS = ["grails-core", "docker", "ansible", "kubernetes", "terraform", "openapi-spec", "helm", "gh-cli"]
const PER_REPO = Number(process.env.YAML_F8_PER_REPO ?? 250)

function walk(dir: string, out: string[], depth = 0): void {
  if (depth > 14) return
  let entries: fs.Dirent[] = []
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    if (e.name === ".git" || e.name === "node_modules") continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out, depth + 1)
    else if (/\.(ya?ml)$/i.test(e.name)) out.push(p)
  }
}

async function main() {
  const wts: any = await import("web-tree-sitter")
  const ParserClass = wts.Parser ?? wts.default ?? wts
  const Language = wts.Language ?? wts.default?.Language
  await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const grammar = await Language.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-yaml.wasm")))
  const parser = new ParserClass()
  parser.setLanguage(grammar)

  // (a)+(b)
  const nodeTypesJson = JSON.parse(fs.readFileSync(path.join(ROOT, "grammars/tree-sitter-yaml/src/node-types.json"), "utf8"))
  const declaredNamed = new Set<string>(nodeTypesJson.filter((t: any) => t.named).map((t: any) => t.type))
  const declaredAnon = new Set<string>(nodeTypesJson.filter((t: any) => !t.named).map((t: any) => t.type))
  const wasmNamed = new Set<string>()
  const wasmAnon = new Set<string>()
  for (let i = 0; i < grammar.nodeTypeCount; i++) {
    const t = grammar.nodeTypeForId(i)
    if (grammar.nodeTypeIsNamed(i)) wasmNamed.add(t)
    else wasmAnon.add(t)
  }
  const wasmFields: string[] = []
  for (let i = 1; i <= grammar.fieldCount; i++) wasmFields.push(grammar.fieldNameForId(i))

  // (c) corpus occurrence
  const occ = new Map<string, number>()
  const perRepo = new Map<string, Map<string, number>>()
  let filesScanned = 0
  for (const r of REPOS) {
    const files: string[] = []
    walk(path.join(CORPUS_ROOT, r), files)
    files.sort()
    const repoOcc = new Map<string, number>()
    let n = 0
    for (const f of files) {
      if (n >= PER_REPO) break
      let content: string
      try { content = fs.readFileSync(f, "utf8") } catch { continue }
      if (content.length > 4_000_000) continue
      n++
      filesScanned++
      const t = parser.parse(content)
      if (!t?.rootNode) continue
      const st: any[] = [t.rootNode]
      while (st.length) {
        const nd = st.pop()
        occ.set(nd.type, (occ.get(nd.type) ?? 0) + 1)
        repoOcc.set(nd.type, (repoOcc.get(nd.type) ?? 0) + 1)
        for (let i = 0; i < nd.childCount; i++) { const c = nd.child(i); if (c) st.push(c) }
      }
    }
    perRepo.set(r, repoOcc)
  }

  // (d)+(e) analyzer literals, extracted the same way the grammar auditor does
  const src = fs.readFileSync(path.join(ROOT, "src/ast/real-yaml-analyzer.ts"), "utf8")
  const lines = src.split("\n")
  const literals = new Map<string, string[]>()
  lines.forEach((line, i) => {
    for (const m of line.matchAll(/"([a-z_][a-z0-9_]*)"/g)) {
      const lit = m[1]!
      if (!literals.has(lit)) literals.set(lit, [])
      literals.get(lit)!.push(`${i + 1}:${line.trim().slice(0, 96)}`)
    }
  })
  const isAnalyzerLit = (t: string) => [...literals.entries()].filter(([k]) => k === t)

  const rows: any[] = []
  const allNamed = new Set([...declaredNamed, ...wasmNamed])
  for (const t of [...allNamed].sort()) {
    const inNodeTypes = declaredNamed.has(t)
    const inWasm = wasmNamed.has(t)
    const sites = isAnalyzerLit(t)
    rows.push({
      type: t,
      kind: "named",
      inNodeTypesJson: inNodeTypes,
      inWasm,
      corpusOccurrences: occ.get(t) ?? 0,
      repos: [...perRepo.entries()].filter(([, m]) => (m.get(t) ?? 0) > 0).map(([r]) => r),
      analyzerNamesIt: sites.length > 0,
      analyzerSites: sites.flat().slice(0, 3),
    })
  }
  const allAnon = new Set([...declaredAnon, ...wasmAnon])
  for (const t of [...allAnon].sort()) {
    const sites = isAnalyzerLit(t)
    rows.push({
      type: t,
      kind: "anonymous",
      inNodeTypesJson: declaredAnon.has(t),
      inWasm: wasmAnon.has(t),
      corpusOccurrences: occ.get(t) ?? 0,
      repos: [...perRepo.entries()].filter(([, m]) => (m.get(t) ?? 0) > 0).map(([r]) => r),
      analyzerNamesIt: sites.length > 0,
      analyzerSites: sites.flat().slice(0, 2),
    })
  }

  console.log(JSON.stringify({
    at: new Date().toISOString(),
    method: "grammar surface from web-tree-sitter Language API over wasm/tree-sitter-yaml.wasm; declared set from grammars/tree-sitter-yaml/src/node-types.json; corpus occurrence by full walk of every named AND anonymous child over a per-repo slice of eight pinned repos; analyzer literals by string-literal scan of src/ast/real-yaml-analyzer.ts",
    repos: REPOS,
    perRepoLimit: PER_REPO,
    filesScanned,
    vocabulary: { ids: grammar.nodeTypeCount, namedUnique: wasmNamed.size, anonUnique: wasmAnon.size, fields: wasmFields },
    counts: {
      namedTotal: allNamed.size,
      namedInNodeTypesOnly: [...allNamed].filter((t) => declaredNamed.has(t) && !wasmNamed.has(t)).length,
      namedInWasmOnly: [...allNamed].filter((t) => wasmNamed.has(t) && !declaredNamed.has(t)).length,
      namedObserved: [...allNamed].filter((t) => (occ.get(t) ?? 0) > 0).length,
      namedNeverObserved: [...allNamed].filter((t) => (occ.get(t) ?? 0) === 0).length,
      namedAnalyzerNames: [...allNamed].filter((t) => isAnalyzerLit(t).length > 0).length,
      namedUnnamedAndUnobserved: [...allNamed].filter((t) => isAnalyzerLit(t).length === 0 && (occ.get(t) ?? 0) === 0).length,
      anonTotal: allAnon.size,
      anonObserved: [...allAnon].filter((t) => (occ.get(t) ?? 0) > 0).length,
    },
    rows,
  }, null, 1))
}
main()
