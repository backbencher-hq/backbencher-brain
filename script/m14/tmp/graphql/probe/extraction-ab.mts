/**
 * GraphQL EXTRACTION A/B — the SAME analyzer run under the vendored grammar and
 * under a candidate grammar, over every file in the corpus, and every single
 * delta adjudicated.
 *
 * A grammar swap changes what the analyzer can see. Reporting "+N symbols" is
 * not proof; the proof is that every added and every removed fact is named and
 * explained. This probe emits:
 *   - per-file symbol/relationship counts under both grammars
 *   - the ADDED facts, grouped by (kind|role) so a class of new truth is visible
 *   - the REMOVED facts, grouped the same way
 *   - a per-file sample of each, with the source line, for adjudication
 *
 *   tsx extraction-ab.mts [dir ...]
 */
import * as fs from "fs"
import * as path from "path"
import { HERE, ROOT } from "../paths.mts"

const wts: any = await import(path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.js"))
const ParserClass = wts.Parser ?? wts.default ?? wts
const Language = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const A_WASM = process.env.GQL_WASM ?? path.join(ROOT, "wasm/tree-sitter-graphql.wasm")
const B_WASM = process.env.GQL_CANDIDATE ?? path.join(HERE, "grammar-rebuild/tree-sitter-graphql-ported.wasm")
const A_LABEL = process.env.GQL_LABEL_A ?? "A"
const B_LABEL = process.env.GQL_LABEL_B ?? "B"

const langV: any = await Language.load(fs.readFileSync(A_WASM))
const langC: any = await Language.load(fs.readFileSync(B_WASM))
// A is the wired grammar, B is the comparison grammar. The names are roles, not
// history: the same probe is used to compare the wired grammar against the one
// it replaced, and against the unpatched upstream.
const pV = new ParserClass()
pV.setLanguage(langV)
const pC = new ParserClass()
pC.setLanguage(langC)

// The analyzer module is imported ONCE; the grammar is chosen by which tree is
// handed to it, so both sides run byte-identical analyzer code.
const mod: any = await import(path.join(ROOT, "src/ast/real-graphql-analyzer.ts"))
const Klass = mod.RealGraphqlAnalyzer

const EXTS = [".graphql", ".graphqls", ".gql"]
const walk = (d: string, out: string[] = [], depth = 0): string[] => {
  if (depth > 14) return out
  let es: fs.Dirent[]
  try {
    es = fs.readdirSync(d, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of es) {
    if (e.name === ".git" || e.name === "node_modules" || e.name === "dist" || e.name === "build") continue
    const p = path.join(d, e.name)
    if (e.isDirectory()) walk(p, out, depth + 1)
    else if (EXTS.includes(path.extname(e.name).toLowerCase())) out.push(p)
  }
  return out
}
const roots = process.argv.slice(2).filter((a) => !a.startsWith("-"))
const files = [...new Set(roots.flatMap((r) => (fs.existsSync(r) ? walk(r) : [])))].sort()

interface Run {
  symbols: Set<string>
  rels: Set<string>
  symList: any[]
  relList: any[]
  grammarError: boolean
  grammarErrorNodes: number
  crash?: string
}
function run(parser: any, src: string): Run {
  const tree = parser.parse(src)
  let grammarErrorNodes = 0
  {
    const st: any[] = [tree.rootNode]
    while (st.length) {
      const n = st.pop()
      if (n.type === "ERROR" || n.isError || n.isMissing) grammarErrorNodes++
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i)
        if (c) st.push(c)
      }
    }
  }
  let res: any
  try {
    res = new Klass().analyze(tree.rootNode, src, "x.graphql")
  } catch (e: any) {
    return { symbols: new Set(), rels: new Set(), symList: [], relList: [], grammarError: tree.rootNode.hasError, grammarErrorNodes, crash: String(e?.message ?? e) }
  }
  return {
    symbols: new Set(res.symbols.map((s: any) => `${s.kind}|${s.name}|${s.range.startLine}`)),
    rels: new Set(res.relationships.map((r: any) => `${r.type}|${r.source}|${r.target}`)),
    symList: res.symbols,
    relList: res.relationships,
    grammarError: tree.rootNode.hasError,
    grammarErrorNodes,
  }
}

const addedSym = new Map<string, number>()
const removedSym = new Map<string, number>()
const addedRel = new Map<string, number>()
const removedRel = new Map<string, number>()
const perFile: any[] = []
let changedFiles = 0
let vErrFiles = 0
let cErrFiles = 0
let vErrNodes = 0
let cErrNodes = 0
let vSym = 0
let cSym = 0
let vRel = 0
let cRel = 0
let crashes = 0

const relRoleOf = (list: any[], key: string) => list.find((r) => `${r.type}|${r.source}|${r.target}` === key)?.metadata?.relationshipRole ?? "-"
const symKindOf = (list: any[], key: string) => list.find((s) => `${s.kind}|${s.name}|${s.range.startLine}` === key)?.kind ?? "?"

for (const f of files) {
  const src = fs.readFileSync(f, "utf8")
  const a = run(pV, src)
  const b = run(pC, src)
  if (a.crash || b.crash) crashes++
  if (a.grammarError) vErrFiles++
  if (b.grammarError) cErrFiles++
  vErrNodes += a.grammarErrorNodes
  cErrNodes += b.grammarErrorNodes
  vSym += a.symbols.size
  cSym += b.symbols.size
  vRel += a.rels.size
  cRel += b.rels.size

  const addSym = [...b.symbols].filter((k) => !a.symbols.has(k))
  const delSym = [...a.symbols].filter((k) => !b.symbols.has(k))
  const addRel = [...b.rels].filter((k) => !a.rels.has(k))
  const delRel = [...a.rels].filter((k) => !b.rels.has(k))
  for (const k of addSym) addedSym.set(k, (addedSym.get(k) ?? 0) + 1)
  for (const k of delSym) removedSym.set(k, (removedSym.get(k) ?? 0) + 1)
  for (const k of addRel) addedRel.set(k, (addedRel.get(k) ?? 0) + 1)
  for (const k of delRel) removedRel.set(k, (removedRel.get(k) ?? 0) + 1)
  if (addSym.length || delSym.length || addRel.length || delRel.length || a.grammarError !== b.grammarError) changedFiles++

  perFile.push({
    file: f,
    a: { label: A_LABEL, symbols: a.symbols.size, rels: a.rels.size, grammarError: a.grammarError, grammarErrorNodes: a.grammarErrorNodes },
    b: { label: B_LABEL, symbols: b.symbols.size, rels: b.rels.size, grammarError: b.grammarError, grammarErrorNodes: b.grammarErrorNodes },
    addedSymbols: addSym.length,
    removedSymbols: delSym.length,
    addedRels: addRel.length,
    removedRels: delRel.length,
    // a bounded sample per direction, with the class label, for adjudication
    sampleAdded: addSym.slice(0, 12).map((k) => `${symKindOf(b.symList, k)} ${k}`).concat(addRel.slice(0, 12).map((k) => `${relRoleOf(b.relList, k)} ${k}`)),
    sampleRemoved: delSym.slice(0, 12).map((k) => `${symKindOf(a.symList, k)} ${k}`).concat(delRel.slice(0, 12).map((k) => `${relRoleOf(a.relList, k)} ${k}`)),
  })
}

const hist = (m: Map<string, number>) => {
  const out: Record<string, number> = {}
  for (const [k, n] of m) {
    const cls = k.startsWith("uses") || k.startsWith("contains") || k.startsWith("implements") ? k.split("|").slice(0, 1).join("|") + "|" + k.split("|").slice(1, 2).join("|") : k.split("|")[0]
    out[cls] = (out[cls] ?? 0) + n
  }
  return out
}

console.log(`files=${files.length} changedFiles=${changedFiles} crashes=${crashes}`)
console.log(`A=${A_LABEL} (${path.basename(A_WASM)}) : symbols=${vSym} rels=${vRel} errorFiles=${vErrFiles} errorNodes=${vErrNodes}`)
console.log(`B=${B_LABEL} (${path.basename(B_WASM)}) : symbols=${cSym} rels=${cRel} errorFiles=${cErrFiles} errorNodes=${cErrNodes}`)
console.log(`B relative to A : symbols ${cSym - vSym >= 0 ? "+" : ""}${cSym - vSym}   rels ${cRel - vRel >= 0 ? "+" : ""}${cRel - vRel}   errorFiles ${cErrFiles - vErrFiles >= 0 ? "+" : ""}${cErrFiles - vErrFiles}   errorNodes ${cErrNodes - vErrNodes >= 0 ? "+" : ""}${cErrNodes - vErrNodes}`)
console.log(`\nADDED symbol kinds:   ${JSON.stringify(hist(addedSym))}`)
console.log(`REMOVED symbol kinds: ${JSON.stringify(hist(removedSym))}`)
console.log(`ADDED rel classes:    ${JSON.stringify(hist(addedRel))}`)
console.log(`REMOVED rel classes:  ${JSON.stringify(hist(removedRel))}`)

const noisy = perFile.filter((p) => p.removedSymbols || p.removedRels)
if (noisy.length) {
  console.log(`\n=== files where B LOSES facts relative to A (${noisy.length}) — each needs an adjudication ===`)
  for (const p of noisy) {
    console.log(`  ${p.file}\n     A sym=${p.a.symbols} rel=${p.a.rels} errNodes=${p.a.grammarErrorNodes} | B sym=${p.b.symbols} rel=${p.b.rels} errNodes=${p.b.grammarErrorNodes}`)
    for (const s of p.sampleRemoved) console.log(`       - ${s}`)
  }
}
const gained = perFile.filter((p) => p.addedSymbols || p.addedRels)
console.log(`\n=== files where B GAINS facts relative to A (${gained.length}) ===`)
for (const p of gained) {
  console.log(`  ${p.file}\n     A sym=${p.a.symbols} rel=${p.a.rels} errNodes=${p.a.grammarErrorNodes} | B sym=${p.b.symbols} rel=${p.b.rels} errNodes=${p.b.grammarErrorNodes}`)
  for (const s of p.sampleAdded) console.log(`       + ${s}`)
}

fs.mkdirSync(path.join(HERE, "out"), { recursive: true })
fs.writeFileSync(
  path.join(HERE, "out/extraction-ab.json"),
  JSON.stringify({ aWasm: A_WASM, bWasm: B_WASM, aLabel: A_LABEL, bLabel: B_LABEL, files: files.length, changedFiles, crashes, a: { label: A_LABEL, wasm: A_WASM, symbols: vSym, rels: vRel, errorFiles: vErrFiles, errorNodes: vErrNodes }, b: { label: B_LABEL, wasm: B_WASM, symbols: cSym, rels: cRel, errorFiles: cErrFiles, errorNodes: cErrNodes }, addedSymbolKinds: hist(addedSym), removedSymbolKinds: hist(removedSym), addedRelClasses: hist(addedRel), removedRelClasses: hist(removedRel), perFile }, null, 2),
)
