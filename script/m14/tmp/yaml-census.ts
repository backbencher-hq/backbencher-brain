// YAML lane baseline census (M37 dual-lens dimension 1/3/5/8, M14.0.F8).
//
// WHAT. One pass that measures, from the REAL wired grammar and the REAL analyzer:
//   1. the grammar's full enumerable surface (named types, anonymous tokens, fields)
//   2. every node type that OCCURS across five pinned real corpora, with counts
//   3. which occurring types the analyzer has a literal for (F8 classification input)
//   4. real symbol/relationship emission: kinds, name shapes, owner coverage
//   5. line-number carriage on relationships (M60 R6 / dimension 8)
//   6. grammar-error + crash census
//
// WHY A PROBE AND NOT A CLAIM. Nothing here is evidence until the numbers are read
// and the readings are adjudicated; the probe exists so the next reader can re-run
// exactly this and get exactly these numbers.
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
const CORPUS_ROOT = "<corpus-root>/bb_tests/repositories"
const CORPUS: Array<{ name: string; dir: string; limit: number }> = [
  { name: "grails-core", dir: "grails-core", limit: 300 },
  { name: "docker", dir: "docker", limit: 250 },
  { name: "ansible", dir: "ansible", limit: 300 },
  { name: "kubernetes", dir: "kubernetes", limit: 300 },
  { name: "terraform", dir: "terraform", limit: 60 },
]

function walk(dir: string, out: string[], depth = 0): void {
  if (depth > 14) return
  let entries: fs.Dirent[] = []
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
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

  // ---- 1. grammar enumerable surface -------------------------------------
  const named: string[] = []
  const anon: string[] = []
  const fields: string[] = []
  const total = grammar.nodeTypeCount
  for (let i = 0; i < total; i++) {
    const t = grammar.nodeTypeForId(i)
    if (grammar.nodeTypeIsNamed(i)) named.push(t)
    else anon.push(t)
  }
  for (let i = 1; i <= grammar.fieldCount; i++) fields.push(grammar.fieldNameForId(i))
  console.log("=== 1. GRAMMAR SURFACE (wasm/tree-sitter-yaml.wasm) ===")
  console.log(`nodeTypeCount=${total} namedUnique=${new Set(named).size} anonUnique=${new Set(anon).size} fieldCount=${grammar.fieldCount}`)
  console.log("NAMED:", JSON.stringify([...new Set(named)].sort()))
  console.log("ANON :", JSON.stringify([...new Set(anon)].sort()))
  console.log("FIELDS:", JSON.stringify(fields.sort()))

  // ---- analyzer literals (for the handled/occurred join) -----------------
  const mod: any = await import(path.join(ROOT, "src/ast/real-yaml-analyzer.ts"))
  const analyzer = new mod.RealYamlAnalyzer()

  // ---- 2..6 per-corpus walk ---------------------------------------------
  const corpusReport: any[] = []
  const occurring = new Map<string, number>()
  const unclassified: Map<string, string[]> = new Map()
  let grandFiles = 0, grandSymbols = 0, grandRels = 0, grandErrFiles = 0, grandErrNodes = 0, crashes: string[] = []
  const kinds = new Map<string, number>()
  const relTypes = new Map<string, number>()
  let relWithLine = 0, relTotal = 0
  let emptyNames = 0, unknownNames = 0, noOwner = 0, membersTotal = 0
  const metaKeys = new Map<string, number>()

  for (const c of CORPUS) {
    const files: string[] = []
    walk(path.join(CORPUS_ROOT, c.dir), files)
    files.sort()
    const chosen = files.slice(0, c.limit)
    const parser = new ParserClass()
    parser.setLanguage(grammar)
    let files2 = 0, syms = 0, rels = 0, errFiles = 0, errNodes = 0, rwl = 0, rt = 0
    let sEmpty = 0, sUnknown = 0, sNoOwner = 0, sMembers = 0
    for (const f of chosen) {
      let content: string
      try {
        content = fs.readFileSync(f, "utf8")
      } catch {
        continue
      }
      let tree: any
      try {
        tree = parser.parse(content)
      } catch (e: any) {
        crashes.push(`${f}: parse ${e?.message}`)
        continue
      }
      if (!tree?.rootNode) {
        crashes.push(`${f}: no root`)
        continue
      }
      // node-type census
      const stack = [tree.rootNode]
      let fileErr = 0
      while (stack.length) {
        const n = stack.pop()!
        if (n.type === "ERROR" || n.isMissing) {
          fileErr++
          errNodes++
          if (n.type === "ERROR") occurring.set("ERROR", (occurring.get("ERROR") ?? 0) + 1)
          continue
        }
        occurring.set(n.type, (occurring.get(n.type) ?? 0) + 1)
        for (let i = 0; i < n.namedChildCount; i++) {
          const ch = n.namedChild(i)
          if (ch) stack.push(ch)
        }
      }
      if (fileErr > 0) errFiles++
      let res: any
      try {
        res = await analyzer.analyze(tree.rootNode, content, f)
      } catch (e: any) {
        crashes.push(`${f}: analyze ${e?.message}`)
        continue
      }
      files2++
      const S = res.symbols ?? []
      const R = res.relationships ?? []
      syms += S.length
      rels += R.length
      for (const s of S) {
        kinds.set(String(s.kind), (kinds.get(String(s.kind)) ?? 0) + 1)
        if (!s.name || s.name.trim() === "") sEmpty++
        if (s.name === "unknown" || s.name === "<unknown>") sUnknown++
        if (s.ownerKind && !s.ownerName) sNoOwner++
        if (s.ownerName) sMembers++
        for (const k of Object.keys(s.metadata ?? {})) metaKeys.set(k, (metaKeys.get(k) ?? 0) + 1)
      }
      for (const r of R) {
        relTypes.set(String(r.type), (relTypes.get(String(r.type)) ?? 0) + 1)
        rt++
        if (typeof (r as any).line_number === "number" || typeof (r as any).line === "number" || typeof ((r as any).metadata ?? {}).line === "number") rwl++
      }
      sEmpty = sEmpty; sUnknown = sUnknown; sNoOwner = sNoOwner; sMembers = sMembers
      emptyNames += 0
    }
    grandFiles += files2
    grandSymbols += syms
    grandRels += rels
    grandErrFiles += errFiles
    relWithLine += rwl
    relTotal += rt
    noOwner += sNoOwner
    membersTotal += sMembers
    corpusReport.push({ corpus: c.name, files: files2, symbols: syms, relationships: rels, errorFiles: errFiles, errorNodes: errNodes, relWithLine: rwl, relTotal: rt })
  }

  console.log("\n=== 2. CORPUS CENSUS ===")
  for (const r of corpusReport) console.log(JSON.stringify(r))
  console.log(`TOTAL files=${grandFiles} symbols=${grandSymbols} relationships=${grandRels} errorFiles=${grandErrFiles} errorNodes=${grandErrNodes} crashes=${crashes.length}`)

  console.log("\n=== 3. OCCURRING NODE TYPES (corpus) ===")
  const occ = [...occurring.entries()].sort((a, b) => b[1] - a[1])
  for (const [t, n] of occ) console.log(`${String(n).padStart(8)}  ${t}`)

  console.log("\n=== 4. SYMBOL KINDS ===")
  for (const [k, n] of [...kinds.entries()].sort((a, b) => b[1] - a[1])) console.log(`${String(n).padStart(8)}  ${k}`)

  console.log("\n=== 5. RELATIONSHIP TYPES ===")
  for (const [k, n] of [...relTypes.entries()].sort((a, b) => b[1] - a[1])) console.log(`${String(n).padStart(8)}  ${k}`)

  console.log("\n=== 6. LINE CARRIAGE ===")
  console.log(`relationships with a line field: ${relWithLine}/${relTotal}`)

  console.log("\n=== 7. METADATA KEYS ON SYMBOLS ===")
  for (const [k, n] of [...metaKeys.entries()].sort((a, b) => b[1] - a[1])) console.log(`${String(n).padStart(8)}  ${k}`)

  console.log("\n=== 8. CRASHES ===")
  for (const c of crashes.slice(0, 20)) console.log(c)
  console.log(`total crashes=${crashes.length}`)
}
main()
