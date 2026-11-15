/**
 * ZIG WAVE 1 PROBE — the SYMBOL-KIND DISPATCH CENSUS (corpus-wide, fast).
 *
 * Recursive visit (no parent-chain climbs), so the whole 3,800-file corpus runs
 * in one pass. Measures the REAL DISTRIBUTION of the analyzer's two kind
 * inputs — the last-named-child node type and the first letter of the name —
 * joined to the kind the analyzer actually assigned, so every misclassification
 * class is a COUNT and not an opinion.
 *
 * Also records three structural classes the kind table cannot express:
 *   - fn-TYPE aliases: `const F = fn () void;` (function_signature under a
 *     variable_declaration) — a type, not a function declaration.
 *   - opaque containers: `const H = opaque { pub fn f() }` — the declaration
 *     body's members.
 *   - the write gate: assignment_expression LHS shapes.
 */
import * as fs from "fs"
import { init, zigFiles, parser, analyzer } from "./zigw-harness"

const SKIP_INFN = new Set(["function_declaration", "test_declaration", "comptime_declaration", "block", "function_signature"])

interface Cell {
  n: number
  kinds: Map<string, number>
  ex: string[]
}

async function main(): Promise<void> {
  await init()
  const files = zigFiles()
  const cells = new Map<string, Cell>()
  const cell = (k: string): Cell => {
    let c = cells.get(k)
    if (!c) { c = { n: 0, kinds: new Map(), ex: [] }; cells.set(k, c) }
    return c
  }
  const bump = (k: string, kind: string, ex: string) => {
    const c = cell(k)
    c.n++
    c.kinds.set(kind, (c.kinds.get(kind) ?? 0) + 1)
    if (c.ex.length < 3) c.ex.push(ex)
  }
  let fnTypeAlias = 0
  let fnTypeAliasEx: string[] = []
  let opaqueContainers = 0
  let opaqueMethods = 0
  let opaqueMethodsAsFunction = 0
  let opaqueEx: string[] = []
  let writeShapes = new Map<string, number>()
  let writeEx = new Map<string, string[]>()

  for (const f of files) {
    const src = fs.readFileSync(f, "utf8")
    const tree = parser().parse(src)
    const root = tree.rootNode
    const res: any = analyzer().analyze(root, src, f)
    const assigned = new Map<string, Set<string>>()
    for (const s of res.symbols as any[]) {
      const set = assigned.get(s.name) ?? new Set<string>()
      set.add(String(s.kind))
      assigned.set(s.name, set)
    }
    const where = (n: any) => `${f.split("/").slice(-2).join("/")}:${n.startPosition.row + 1}`

    const visit = (n: any, inFn: boolean): void => {
      const isDecl = n.type === "variable_declaration"
      if (isDecl && !inFn) {
        const kids: any[] = []
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c) kids.push(c)
        }
        if (kids.length > 0 && kids[0].type === "identifier" && kids[0].text !== "_") {
          const name = kids[0].text
          if (name.length <= 80) {
            const rhs = kids[kids.length - 1]
            const isVar = hasToken(n, "var")
            const upper = name[0] === name[0].toUpperCase() && name[0] !== name[0].toLowerCase()
            const kinds = [...(assigned.get(name) ?? new Set(["MISSING"]))].sort().join("+")
            const rhsText = n.text.replace(/\s+/g, " ").slice(0, 80)
            bump(`${rhs.type}|${upper ? "UPPER" : "lower"}|${isVar ? "var" : "const"}|${kinds}`, "k", `${where(n)}  ${rhsText}`)
            if (rhs.type === "builtin_function") {
              const bi = firstNamed(rhs, "builtin_identifier")
              bump(`BUILTIN|${bi ? bi.text : "?"}|${upper ? "UPPER" : "lower"}`, "k", `${where(n)}  ${rhsText}`)
            }
            if (rhs.type === "function_signature") {
              fnTypeAlias++
              if (fnTypeAliasEx.length < 6) fnTypeAliasEx.push(`${where(n)}  ${rhsText}`)
            }
            if (rhs.type === "opaque_declaration") {
              opaqueContainers++
              if (opaqueEx.length < 6) opaqueEx.push(`${where(n)}  ${rhsText.slice(0, 70)}`)
            }
          }
        }
      }
      if (n.type === "assignment_expression") {
        const left = n.childForFieldName ? n.childForFieldName("left") : null
        const op = n.childForFieldName ? n.childForFieldName("operator") : null
        const key = `${left ? left.type : "?"}<-${op ? op.type : "?"}`
        writeShapes.set(key, (writeShapes.get(key) ?? 0) + 1)
        const lst = writeEx.get(key) ?? []
        if (lst.length < 2) lst.push(`${where(n)}  ${n.text.replace(/\s+/g, " ").slice(0, 60)}`)
        writeEx.set(key, lst)
      }
      const childInFn = inFn || SKIP_INFN.has(n.type)
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) visit(c, childInFn)
      }
    }
    visit(root, false)

    for (const s of res.symbols as any[]) {
      if (s.ownerKind === "type" && (s.kind === "function" || s.kind === "method")) {
        opaqueMethods++
        if (s.kind === "function") opaqueMethodsAsFunction++
      }
    }
    tree.delete()
  }

  console.log(`files: ${files.length}  cells: ${cells.size}\n`)
  console.log("count   cell (rhsType|upper|decl|assignedKinds)")
  for (const [k, c] of [...cells.entries()].sort((a, b) => b[1].n - a[1].n)) {
    console.log(`${String(c.n).padStart(6)}   ${k}`)
  }
  console.log(`\n=== BUILTIN RHS breakdown ===`)
  for (const [k, c] of [...cells.entries()].filter(([k]) => k.startsWith("BUILTIN|")).sort((a, b) => b[1].n - a[1].n)) {
    console.log(`${String(c.n).padStart(6)}   ${k}`)
    for (const e of c.ex) console.log(`        ${e}`)
  }
  console.log(`\n=== fn-TYPE aliases (const F = fn (...) T) : ${fnTypeAlias} ===`)
  for (const e of fnTypeAliasEx) console.log(`   ${e}`)
  console.log(`\n=== opaque containers: ${opaqueContainers}; symbols with ownerKind=type: ${opaqueMethods} (of which kind=function: ${opaqueMethodsAsFunction}) ===`)
  for (const e of opaqueEx) console.log(`   ${e}`)
  console.log(`\n=== assignment_expression LHS<op shapes ===`)
  for (const [k, v] of [...writeShapes.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`${String(v).padStart(7)}   ${k}`)
    for (const e of writeEx.get(k) ?? []) console.log(`           ${e}`)
  }
}

function firstNamed(n: any, type: string): any {
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c && c.type === type) return c
  }
  return null
}

function hasToken(n: any, tok: string): boolean {
  for (let i = 0; i < n.childCount; i++) {
    const c = n.child(i)
    if (c && !c.isNamed && c.type === tok) return true
  }
  return false
}
void main()
