// #919: the SECOND spelling — a macro-declared body the grammar reads as a
// `function_definition` (ALL-CAPS declarator name, untyped params: gtest's
// `TEST(suite, name) {…}`). CP2 already suppresses the symbol and pushes an
// ANONYMOUS scope (name ""), so the body's reads source to `global` — the same
// damage the expression_statement spelling had. Census: sites, and the
// relationships the analyzer still sources at `global` inside them.
//   bun script/m14/tmp/c919-cp2.ts
import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"
const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const CORPUS = "/home/ishaq2321/bb_tests/repositories"
const after = JSON.parse(readFileSync("/tmp/c919-after.json", "utf8"))
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const lang = await L.load(readFileSync(path.join(ROOT, "wasm/tree-sitter-cpp.wasm")))
const parser = new P(); parser.setLanguage(lang)

const allCaps = (s: string) => { let seen = false; for (const ch of s) { if (ch >= "a" && ch <= "z") return false; if (ch >= "A" && ch <= "Z") seen = true } return seen }
const hasType = (m: any): boolean => {
  let sawHard = false, sawTypeIdent = false, sawNameIdent = false
  const st: any[] = [m]
  while (st.length) {
    const x = st.pop()!
    if (["primitive_type", "sized_type_specifier", "template_type", "qualified_identifier", "typename_specifier", "decltype", "struct_specifier", "union_specifier", "enum_specifier"].includes(x.type)) return true
    if (x.type === "type_identifier") sawTypeIdent = true
    if (x.type === "identifier" || x.type === "field_identifier") sawNameIdent = true
    for (let k = 0; k < x.namedChildCount; k++) { const c = x.namedChild(k); if (c) st.push(c) }
  }
  return sawHard || (sawTypeIdent && sawNameIdent)
}

const files: string[] = []
for (const repo of ["fmt", "nlohmann-json"]) {
  const collect = (dir: string) => {
    let entries: any[] = []
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) collect(p)
      else if (/\.(cpp|cc|cxx|hpp|hh|h)$/.test(e.name)) files.push(p)
    }
  }
  collect(path.join(CORPUS, repo))
}

let sites = 0
let globalReads = 0
let leakedSyms = 0
const byFile = new Map<string, { sites: number; reads: number; syms: number }>()
const macroCount = new Map<string, number>()
for (const f of files) {
  let src: string
  try { src = readFileSync(f, "utf8") } catch { continue }
  const rel = path.relative(CORPUS, f)
  const root = parser.parse(src).rootNode
  const found: Array<{ line: number; end: number; macro: string }> = []
  const st: any[] = [root]
  while (st.length) {
    const n = st.pop()!
    if (n.type === "function_definition") {
      const decl = n.namedChild(0)
      let name: string | null = null
      if (decl) { let cur: any = decl; while (cur) { if (cur.type === "identifier" || cur.type === "field_identifier") { name = cur.text; break } cur = cur.childForFieldName?.("declarator") ?? cur.namedChild(0) } }
      const params = (decl?.namedChildren ?? []).find((c: any) => c.type === "parameter_list")
      if (name && allCaps(name) && params && params.namedChildCount > 0) {
        let typed = false
        for (let i = 0; i < params.namedChildCount; i++) { const p = params.namedChild(i); if (p && p.type !== "comment" && hasType(p)) typed = true }
        if (!typed) {
          found.push({ line: n.startPosition.row + 1, end: n.endPosition.row + 1, macro: name })
          sites++
          macroCount.set(name, (macroCount.get(name) ?? 0) + 1)
        }
      }
    }
    for (let i = 0; i < n.childCount; i++) st.push(n.child(i))
  }
  if (found.length === 0) continue
  const dump = after[rel] ?? {}
  let reads = 0, syms = 0
  for (const s of found) {
    reads += (dump.rels ?? []).filter((r: string) => {
      const i = r.lastIndexOf("|"), j = r.lastIndexOf("|", i - 1)
      const line = Number(r.slice(i + 1))
      return line >= s.line && line <= s.end && r.slice(0, r.indexOf("|")) === "uses" && r.slice(r.indexOf("|") + 1, j) === "global"
    }).length
    syms += (dump.symbols ?? []).filter((y: string) => {
      const line = Number(y.slice(y.lastIndexOf("|") + 1))
      const name = y.split("|")[1]
      return y.startsWith("variable|") && line >= s.line && line <= s.end
    }).length
  }
  globalReads += reads
  leakedSyms += syms
  byFile.set(rel, { sites: found.length, reads, syms })
}
console.log(`CP2-spelled macro bodies (function_definition): ${sites} in ${byFile.size} files`)
console.log(`  by macro: ${[...macroCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => `${k}×${v}`).join(", ")}`)
console.log(`  relationships still sourced at \`global\` inside those bodies: ${globalReads}`)
console.log(`  variable symbols still published inside those bodies: ${leakedSyms}`)
console.log("\nworst files:")
for (const [f, v] of [...byFile.entries()].sort((a, b) => b[1].reads - a[1].reads).slice(0, 10)) console.log(`  ${f}: bodies=${v.sites} globalReads=${v.reads} vars=${v.syms}`)
