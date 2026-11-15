// JD3 closure check — classify EVERY remaining ownerless member on a production
// corpus. A member is legitimately ownerless only when its container has no
// nameable binding; anything else is still an analyzer gap.
// (2026-09-26)
import * as WTS from "web-tree-sitter"
import { RealJavaScriptAnalyzer } from "../../../src/ast/real-javascript-analyzer"
import * as fs from "fs"
import * as path from "path"

const ROOT = "/home/ishaq2321/bb_tests/repositories/svelte"
const LIMIT = Number(process.env.LIMIT ?? 400)

function walkFiles(dir: string, out: string[], depth = 0): void {
  if (depth > 14) return
  let es: fs.Dirent[]
  try { es = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of es) {
    if (e.name === ".git" || e.name === "node_modules") continue
    const q = path.join(dir, e.name)
    if (e.isDirectory()) walkFiles(q, out, depth + 1)
    else if (e.name.endsWith(".js")) out.push(q)
  }
}

/** Why is this member ownerless? Read the AST, not the analyzer's own logic. */
function classify(memberLine: number, symbols: any[]): string {
  const sym = symbols.find((s: any) => s.range?.startLine === memberLine && (s.kind === "method" || s.kind === "property" || s.kind === "constructor"))
  if (!sym) return "unclassified (no symbol at that line)"
  if (sym.metadata?.isPrototypeMethod) return "prototype-assigned (owner IS set separately)"
  return "ownerless"
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
  walkFiles(ROOT, files); files.sort()
  const sample = files.slice(0, LIMIT)

  const shapes = new Map<string, { n: number; ex: string }>()
  let total = 0, symbols = 0, withOwner = 0, nameableButOwnerless = 0

  for (const f of sample) {
    let src: string
    try { src = fs.readFileSync(f, "utf8") } catch { continue }
    if (src.length > 400000) continue
    let tree: any
    try { tree = p.parse(src) } catch { continue }
    const r = await a.analyze(tree.rootNode, src, f, undefined)
    const syms = r.symbols ?? []
    symbols += syms.length
    for (const s of syms) {
      const isMember = s.kind === "method" || s.kind === "property" || s.kind === "constructor"
      if (!isMember) continue
      if (s.ownerName) { withOwner++; continue }
      total++
      // Independently decide nameability from the AST at the member's own span.
      const shape = astContainerShape(tree.rootNode, s.range.startIndex)
      const cur = shapes.get(shape) ?? { n: 0, ex: `${path.basename(f)}:${s.range.startLine} ${s.name}` }
      cur.n++
      shapes.set(shape, cur)
      if (shape.includes("NAMED")) nameableButOwnerless++
    }
  }

  console.log(`files=${sample.length} symbols=${symbols} membersWithOwner=${withOwner} ownerless=${total}`)
  console.log(`ownerless share of ALL symbols: ${((total / symbols) * 100).toFixed(1)}%`)
  console.log(`\nownerless by CONTAINER SHAPE (read from the AST, not the analyzer):`)
  for (const [k, v] of [...shapes.entries()].sort((x, y) => y[1].n - x[1].n)) {
    const flag = k.includes("NAMED") ? "  <-- STILL AN ANALYZER GAP" : "  (legitimately unnameable)"
    console.log(`  ${String(v.n).padStart(4)}  ${k}${flag}`)
    console.log(`          e.g. ${v.ex}`)
  }
  console.log(`\nnameable containers that are still ownerless: ${nameableButOwnerless}`)
  console.log(nameableButOwnerless === 0
    ? "JD3 CLOSED: every remaining ownerless member sits in a container the language does not name."
    : `${nameableButOwnerless} member(s) still need an owner.`)
}

/** Structural container shape for the member starting at `startIndex`. */
function astContainerShape(root: any, startIndex: number): string {
  let found: any = null
  const st = [root]
  while (st.length) {
    const n: any = st.pop()
    if (n.startIndex === startIndex && (n.type === "method_definition" || n.type === "field_definition")) { found = n; break }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) st.push(c) }
  }
  if (!found) return "member node not found"
  let p: any = found.parent
  while (p) {
    if (p.type === "class_declaration") return "class_declaration (NAMED container)"
    if (p.type === "class") {
      if (p.childForFieldName("name")) return "named class expression (NAMED container)"
      let q: any = p.parent
      while (q) {
        if (q.type === "variable_declarator" || q.type === "assignment_expression") return "class expression bound to a name (NAMED container)"
        if (q.type === "pair" || q.type === "object" || q.type === "export_statement" || q.type === "expression_statement") { q = q.parent; continue }
        return "anonymous class expression, unbound (call argument / array / return)"
      }
      return "anonymous class expression, unbound"
    }
    if (p.type === "object") {
      let q: any = p.parent
      while (q) {
        if (q.type === "variable_declarator") {
          const nm = q.childForFieldName("name")
          return nm && nm.type === "identifier" ? "object literal bound to a const/let (NAMED container)" : "object literal, destructuring target"
        }
        if (q.type === "pair" || q.type === "object" || q.type === "return_statement" || q.type === "expression_statement" || q.type === "assignment_expression") { q = q.parent; continue }
        return "object literal as a CALL ARGUMENT (unnamed)"
      }
      return "object literal, unbound"
    }
    if (p.type === "function_declaration" || p.type === "function_expression" || p.type === "arrow_function" ||
        p.type === "generator_function_declaration" || p.type === "method_definition" || p.type === "function") {
      return "inside a function body with no binding (unnamed)"
    }
    p = p.parent
  }
  return "no container found"
}
main().catch((e) => { console.error(e); process.exit(1) })
