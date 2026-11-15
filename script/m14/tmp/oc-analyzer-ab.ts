// The #743 instrument: a grammar rebuild is verified by diffing the ANALYZER's
// own output, edge by edge. A corpus differential cannot do this — its oracle
// walks the same tree, so "F5 cannot tell a removed phantom from a lost edge".
//
// Usage: bun script/m14/tmp/oc-analyzer-ab.ts <wasmA> <wasmB> [--all]
//
// Reports per-file identical/differing, the symbol and relationship deltas, and
// classifies every disappearance as PHANTOM (a macro/keyword name that was never
// a real declaration) or REAL LOSS. Exit is non-zero if a real loss occurs.
import * as fs from "fs"
import * as path from "path"
const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const REPOS = "/home/ishaq2321/bb_tests/repositories"

const args = process.argv.slice(2)
const wasmIn = args.filter((a) => !a.startsWith("--"))
const [wasmA, wasmB] = wasmIn
if (!wasmA || !wasmB) {
  console.error("usage: oc-analyzer-ab.ts <wasmA> <wasmB> [--all]")
  process.exit(2)
}

const wts: any = await import("web-tree-sitter")
const P: any = wts.Parser ?? wts.default ?? wts
const L: any = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const { detectLanguageFromPath } = await import(path.join(ROOT, "src/ast/language-detection"))
const ocmod: any = await import(path.join(ROOT, "src/ast/real-objective-c-analyzer"))

const langs: any[] = []
for (const w of [wasmA, wasmB]) langs.push(await L.load(fs.readFileSync(path.isAbsolute(w) ? w : path.join(ROOT, w))))
const analyzer = new ocmod.RealObjectiveCAnalyzer()

function walk(d: string, out: string[]) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name)
    if (e.isDirectory()) {
      if (e.name === ".git" || e.name === "Pods" || e.name.includes("xcodeproj")) continue
      walk(p, out)
    } else if (/\.(m|h)$/.test(e.name)) out.push(p)
  }
}

async function run(lang: any, src: string, file: string) {
  const p = new P()
  p.setLanguage(lang)
  const tree: any = p.parse(src)
  const res: any = await analyzer.analyze(tree.rootNode, src, file)
  const syms = (res.symbols ?? []).map((s: any) => `${s.kind}|${s.name}|${(s as any).line_number ?? ""}`)
  const rels = (res.relationships ?? []).map(
    (r: any) => `${r.type}|${r.source}|${r.target}|${(r as any).line_number ?? ""}`,
  )
  // Names that the tree binds as a method parameter or as a selector keyword
  // part. When a destroyed `@interface` leaked such a name as a file-scope
  // `variable`, recovering the interface moves the name into its real binding
  // and the phantom goes away — a fix, not a loss. Collected from the tree so
  // the classification is machine-derived, not hand-argued.
  const paramNames = new Set<string>()
  const collect = (n: any) => {
    // Any identifier inside a method declaration/definition is a selector
    // keyword part or a parameter — never a file-scope variable — so the whole
    // method node is the right scope to collect from.
    if (
      n.type === "method_declaration" ||
      n.type === "method_definition" ||
      n.type === "method_parameter" ||
      n.type === "parameter_declaration" ||
      n.type === "method_selector" ||
      n.type === "keyword_selector" ||
      n.type === "block_parameter"
    ) {
      const ids: string[] = []
      const grab = (m: any) => {
        if (m.type === "identifier" || m.type === "type_identifier") ids.push(m.text)
        for (const c of m.children) grab(c)
      }
      grab(n)
      for (const i of ids) paramNames.add(i)
    }
    for (const c of n.children) collect(c)
  }
  collect(tree.rootNode)
  return { syms, rels, paramNames, err: tree.rootNode.hasError as boolean }
}

const files: string[] = []
for (const repo of ["sdwebimage", "afnetworking"]) walk(path.join(REPOS, repo), files)
const routed: string[] = []
for (const f of files) {
  const src = fs.readFileSync(f, "utf8")
  if (detectLanguageFromPath(path.basename(f), src) === "objective-c") routed.push(f)
}

// A disappearance is only a LOSS if the name is gone from the file entirely.
// Otherwise it is one of the three benign classes the #743 cpp half named:
//   PHANTOM          — a keyword or macro name that was never a declaration
//                      (`variable|void`, `variable|NS_ASSUME_NONNULL_END`)
//   KIND CORRECTION  — the name survives under its right kind
//                      (`variable|maxBufferCount` -> `property|maxBufferCount`)
//   DUPLICATE        — the same kind|name survives at another line
const C_KEYWORDS = new Set([
  "void", "int", "char", "long", "short", "float", "double", "signed", "unsigned", "const", "struct",
  "union", "enum", "typedef", "static", "extern", "auto", "register", "volatile", "inline", "sizeof",
  "return", "if", "else", "for", "while", "do", "switch", "case", "default", "break", "continue", "goto",
  "and", "or", "not", "true", "false", "nil", "Nil", "self", "super", "id", "SEL", "IMP", "BOOL",
])
const MACROISH = /^(NS_|UIKIT_|FOUNDATION_|API_|[A-Z][A-Z0-9_]{2,})/
const perFile: any[] = []
let identical = 0
const allLostSyms: string[] = []
const allGainedSyms: string[] = []
const allLostRels: string[] = []
const allGainedRels: string[] = []
const cls = { phantom: [] as string[], kind: [] as string[], dup: [] as string[], param: [] as string[], real: [] as string[] }
const relCls = { kind: [] as string[], dup: [] as string[], real: [] as string[] }
let symA = 0
let symB = 0
let relA = 0
let relB = 0
for (const f of routed) {
  const src = fs.readFileSync(f, "utf8")
  const a = await run(langs[0], src, f)
  const b = await run(langs[1], src, f)
  symA += a.syms.length
  symB += b.syms.length
  relA += a.rels.length
  relB += b.rels.length
  const setA = new Set(a.syms)
  const setB = new Set(b.syms)
  const lostSyms = [...setA].filter((s) => !setB.has(s))
  const gainedSyms = [...setB].filter((s) => !setA.has(s))
  const setRA = new Set(a.rels)
  const setRB = new Set(b.rels)
  const lostRels = [...setRA].filter((r) => !setRB.has(r))
  const gainedRels = [...setRB].filter((r) => !setRA.has(r))

  // name -> kinds seen in B (for kind-correction detection)
  const kindsB = new Map<string, Set<string>>()
  for (const s of b.syms) {
    const [k, n] = s.split("|")
    if (!kindsB.has(n)) kindsB.set(n, new Set())
    kindsB.get(n)!.add(k)
  }
  const kindOfB = (rel: string) => new Set(b.rels.map((r) => r.split("|")[0]))
  const relTypesB = kindOfB("")
  const tail = (s: string) => s.split("|").slice(1).join("|")
  for (const s of lostSyms) {
    const [k, n] = s.split("|")
    const where = `  <- ${path.basename(f)}`
    if (kindsB.has(n) && !kindsB.get(n)!.has(k)) cls.kind.push(`${k}|${n} -> ${[...kindsB.get(n)!].join(",")}${where}`)
    else if (kindsB.has(n)) cls.dup.push(`${s}${where}`)
    else if (C_KEYWORDS.has(n) || MACROISH.test(n)) cls.phantom.push(`${s}${where}`)
    else if (b.paramNames.has(n)) cls.param.push(`${s}${where}`)
    else cls.real.push(`${s}${where}`)
  }
  for (const r of lostRels) {
    if (relTypesB.has(r.split("|")[0])) relCls.dup.push(r)
    else relCls.real.push(r)
  }
  if (!lostSyms.length && !gainedSyms.length && !lostRels.length && !gainedRels.length) {
    identical++
  } else {
    perFile.push({ f: f.replace(REPOS + "/", ""), a, b, lostSyms, gainedSyms, lostRels, gainedRels })
    allLostSyms.push(...lostSyms.map((s) => `${s}  <- ${path.basename(f)}`))
    allGainedSyms.push(...gainedSyms.map((s) => `${s}  <- ${path.basename(f)}`))
    allLostRels.push(...lostRels)
    allGainedRels.push(...gainedRels)
  }
  void tail
}

const realLosses = cls.real
console.log(`A = ${wasmA}\nB = ${wasmB}\n`)
console.log(`files=${routed.length}  analyzer-output-identical=${identical}  changed=${perFile.length}`)
console.log(`symbols:      A=${symA} -> B=${symB}   (-${allLostSyms.length} / +${allGainedSyms.length})`)
console.log(`relationships: A=${relA} -> B=${relB}   (-${allLostRels.length} / +${allGainedRels.length})`)
console.log(`\nsymbol disappearances classified:`)
console.log(`   phantom (keyword/macro)   ${cls.phantom.length}`)
console.log(`   kind correction           ${cls.kind.length}`)
console.log(`   duplicate collapse        ${cls.dup.length}`)
console.log(`   parameter/selector phantom ${cls.param.length}`)
console.log(`   REAL LOSSES               ${cls.real.length}`)
for (const s of cls.param.slice(0, 12)) console.log(`   param ${s}`)
console.log(`relationship disappearances: duplicate/kind ${relCls.dup.length}   REAL LOSSES ${relCls.real.length}`)
for (const s of cls.kind.slice(0, 12)) console.log(`   kind  ${s}`)
for (const s of cls.real.slice(0, 30)) console.log(`   LOST  ${s}`)
for (const s of relCls.real.slice(0, 20)) console.log(`   LOSTREL  ${s}`)
console.log(`\n-- disappeared symbols (phantom candidates) --`)
for (const s of allLostSyms.slice(0, 20)) console.log(`   -  ${s}`)
console.log(`-- new symbols --`)
for (const s of allGainedSyms.slice(0, 20)) console.log(`   +  ${s}`)
console.log(`-- relationship deltas --`)
for (const s of allLostRels.slice(0, 12)) console.log(`   -  ${s}`)
for (const s of allGainedRels.slice(0, 12)) console.log(`   +  ${s}`)
if (args.includes("--all")) {
  console.log(`\n-- per-file --`)
  for (const p of perFile) {
    console.log(
      `  ${p.f}  syms ${p.a.syms.length}->${p.b.syms.length} rels ${p.a.rels.length}->${p.b.rels.length}  ` +
        `err ${p.a.err}->${p.b.err}\n      -syms ${JSON.stringify(p.lostSyms)}\n      +syms ${JSON.stringify(p.gainedSyms)}`,
    )
  }
}
process.exit(realLosses.length > 0 ? 1 : 0)
