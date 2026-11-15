// #919: measure the CURRENT damage of the macro-call-heading class through the
// production entry, EXACT spans (the sites are found from the tree here, so the
// body span is the body node's own, never a heuristic window):
//   (a) declarations inside a body that the analyzer published as FILE-SCOPE
//       symbols (the #917 evidence shape: body locals leaking), and
//   (b) relationships sourced at `global` inside the body.
//   bun script/m14/tmp/c919-damage.ts [repo ...]
import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"
const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const CORPUS = "/home/ishaq2321/bb_tests/repositories"
const REPOS = process.argv.slice(2).length ? process.argv.slice(2) : ["fmt", "nlohmann-json"]

const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const lang = await L.load(readFileSync(path.join(ROOT, "wasm/tree-sitter-cpp.wasm")))
const parser = new P(); parser.setLanguage(lang)
const { parseFile } = await import(path.join(ROOT, "src", "ast", "engine.ts"))

const MAX = Number(process.env.BB_MAX ?? 400)
const files: string[] = []
for (const repo of REPOS) {
  const collect = (dir: string) => {
    if (files.length >= MAX) return
    let entries: any[] = []
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (files.length >= MAX) return
      const p = path.join(dir, e.name)
      if (e.isDirectory()) collect(p)
      else if (/\.(cpp|cc|cxx|hpp|hh|h)$/.test(e.name)) files.push(p)
    }
  }
  collect(path.join(CORPUS, repo))
}

type Site = { file: string; line: number; macro: string; bodyStart: number; bodyEnd: number }
const sites: Site[] = []
const srcCache = new Map<string, string>()
const treeCache = new Map<string, any>()
for (const f of files) {
  let src: string
  try { src = readFileSync(f, "utf8") } catch { continue }
  srcCache.set(f, src)
  const root = parser.parse(src).rootNode
  treeCache.set(f, root)
  const st: any[] = [root]
  while (st.length) {
    const n = st.pop()!
    if (n.type === "expression_statement") {
      let missing = false
      for (let i = 0; i < n.childCount; i++) if (n.child(i)?.isMissing) missing = true
      const first = n.namedChild(0)
      const nx = n.nextSibling
      if (missing && first?.type === "call_expression" && first.childForFieldName("function")?.type === "identifier" && nx?.type === "compound_statement") {
        sites.push({
          file: path.relative(CORPUS, f),
          line: n.startPosition.row + 1,
          macro: first.text.slice(0, 46),
          bodyStart: nx.startPosition.row + 1,
          bodyEnd: nx.endPosition.row + 1,
        })
      }
    }
    for (let i = 0; i < n.childCount; i++) st.push(n.child(i))
  }
}

const byFile = new Map<string, Site[]>()
for (const s of sites) {
  if (!byFile.has(s.file)) byFile.set(s.file, [])
  byFile.get(s.file)!.push(s)
}

let leaked = 0
let globalReads = 0
let bodiesWithReads = 0
let symsInBody = 0
const rows: string[] = []
for (const [rel, list] of byFile) {
  const abs = path.join(CORPUS, rel)
  const res: any = await parseFile(abs, srcCache.get(abs) ?? readFileSync(abs, "utf8"), { language: "cpp" })
  const syms: any[] = res.symbols ?? []
  const rels: any[] = res.relationships ?? []
  let leak = 0
  let gr = 0
  let withReads = 0
  let inBodySyms = 0
  for (const s of list) {
    const inBody = syms.filter((y: any) => y.range?.startLine >= s.bodyStart && y.range?.startLine <= s.bodyEnd)
    inBodySyms += inBody.length
    leak += inBody.filter((y: any) => !y.ownerName && !y.ownerKind && (y.scope === "global" || !y.scope)).length
    const g = rels.filter((r: any) => r.line_number >= s.bodyStart && r.line_number <= s.bodyEnd && r.source === "global")
    gr += g.length
    if (g.length > 0) withReads++
  }
  leaked += leak
  globalReads += gr
  bodiesWithReads += withReads
  symsInBody += inBodySyms
  if (leak > 0 || gr > 0) rows.push(`${rel}: sites=${list.length} fileScopeSymsInBody=${leak}/${inBodySyms} globalReads=${gr}`)
}
console.log(`files=${byFile.size} sites=${sites.length} (span-exact bodies)`)
console.log(`bodies carrying reads sourced at \`global\`: ${bodiesWithReads}`)
console.log(`relationships sourced at \`global\` inside the bodies: ${globalReads}`)
console.log(`file-scope symbols declared inside the bodies: ${leaked} (of ${symsInBody} symbols in those spans)`)
console.log("\nworst files:")
for (const r of rows.sort((a, b) => Number(b.split("globalReads=")[1]) - Number(a.split("globalReads=")[1])).slice(0, 14)) console.log("  " + r)
