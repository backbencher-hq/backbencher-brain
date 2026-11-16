// #919: DISJOINT class census over the two cpp corpora, from the baseline dump.
// A macro-headed body can be reached two ways in the tree:
//   paired   — a `function_definition` whose declarator is the macro heading
//              (the `CAPTURE(0)` shape): the function exists, its body is inside.
//   unpaired — the heading is an `expression_statement` and the body is a
//              file-scope sibling block: the body is inside NO function.
// Measured per class: file-scope (`global`-sourced) edge mass inside the body and
// symbols published with no owner.
//   bun script/m14/tmp/c919-prefix.ts
import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"
const ROOT = "<corpus-root>/mcp/backbencher-brain"
const CORPUS = "<corpus-root>/bb_tests/repositories"
const before = JSON.parse(readFileSync("/tmp/c919-before.json", "utf8"))
const { macroDeclaredBody, RealCppAnalyzer } = await import(path.join(ROOT, "src", "ast", "real-cpp-analyzer.ts"))
const pred: any = new RealCppAnalyzer()
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const lang = await L.load(readFileSync(path.join(ROOT, "wasm/tree-sitter-cpp.wasm")))
const parser = new P(); parser.setLanguage(lang)

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

const isCp2 = (n: any) => {
  if (!n || n.type !== "function_definition") return false
  const det = pred.getFunctionDetails(n)
  return !!(det && !det.isDestructor && !String(det.name).startsWith("operator") && pred.isMacroFunctionShape(n, det.name) && n.childForFieldName("body"))
}
type Row = { bodies: number; files: number; globalRels: number; kinds: Record<string, number>; orphan: number }
const mk = (): Row => ({ bodies: 0, files: 0, globalRels: 0, kinds: {}, orphan: 0 })
const out: Record<string, Row> = { paired: mk(), unpaired: mk() }
for (const f of files) {
  let src: string
  try { src = readFileSync(f, "utf8") } catch { continue }
  const rel = path.relative(CORPUS, f)
  const dump = before[rel]
  if (!dump) continue
  const root = parser.parse(src).rootNode
  const st: any[] = [root]
  const spans: Array<[number, number, "paired" | "unpaired"]> = []
  while (st.length) {
    const n = st.pop()!
    if (isCp2(n)) {
      spans.push([n.startPosition.row + 1, n.endPosition.row + 1, "paired"])
    } else if (macroDeclaredBody(n)) {
      const parent = n.parent
      const prev = n.previousNamedSibling
      const paired = (parent && isCp2(parent)) || (prev && isCp2(prev))
      spans.push([n.startPosition.row + 1, n.endPosition.row + 1, paired ? "paired" : "unpaired"])
    }
    for (let i = 0; i < n.childCount; i++) st.push(n.child(i))
  }
  if (spans.length === 0) continue
  for (const kind of ["paired", "unpaired"] as const) {
    const mine = spans.filter(([a, b, k]) => k === kind)
    if (mine.length === 0) continue
    out[kind].bodies += mine.length
    out[kind].files += 1
    for (const [a, b] of mine) {
      for (const r of dump.rels as string[]) {
        const p = r.split("|")
        const line = Number(p[p.length - 1])
        if (line < a || line > b) continue
        if (p[1] !== "global") continue
        out[kind].globalRels++
        out[kind].kinds[p[0]] = (out[kind].kinds[p[0]] ?? 0) + 1
      }
      for (const s of dump.symbols as string[]) {
        const p = s.split("|")
        const line = Number(p[p.length - 1])
        if (line < a || line > b) continue
        if (p[2] === "") out[kind].orphan++
      }
    }
  }
}
for (const [k, v] of Object.entries(out)) {
  const kinds = Object.entries(v.kinds).sort((a, b) => b[1] - a[1]).map(([a, b]) => `${a} ${b}`).join(", ")
  console.log(`${k}: bodies=${v.bodies} in ${v.files} files | file-scope edges inside the bodies=${v.globalRels} (${kinds}) | ownerless symbols inside=${v.orphan}`)
}
