/**
 * ZIG WAVE 2 PROBE — the REMAINING questions, one pass, incremental output.
 *
 *   1. labeled_type_expression: a labeled BLOCK (a value, `break :L v`) and a
 *      labeled TYPE (`L: T { return v; }`) are the SAME node type, so the kind
 *      dispatch cannot tell them apart by node type. Counted here by the shape
 *      that distinguishes them.
 *   2. Z20 constructions: `Point{ … }` in a value position with no type
 *      annotation — the family alternative is `instantiates`, which ZIG.D.1
 *      rules out for Zig. Counted so the limitation is a number.
 *   3. executable-body leaks: symbols minted inside a container-scope
 *      declaration's RHS block (ZGD3's rule applied to the path ZGD3 missed).
 *   4. opaque members: how many declarations an opaque type fails to own (Z12).
 *   5. the full kind table AFTER the Z11/Z12/Z16 fixes, so the delta is measured
 *      from the code that ships rather than from the pre-fix run.
 */
import * as fs from "fs"
import { init, zigFiles, parser, analyzer } from "./zigw-harness"

const LIMIT = Number(process.argv[2] ?? 1500)
const SKIP_INFN = new Set(["function_declaration", "test_declaration", "comptime_declaration", "block", "function_signature"])
const log = (s: string) => { console.log(s) }

async function main(): Promise<void> {
  await init()
  const files = zigFiles(["zig", "zls", "ghostty"], LIMIT)
  log(`files: ${files.length}`)
  let labeledBlock = 0, labeledType = 0, labeledUnknown = 0
  const labeledEx: string[] = []
  let constructions = 0
  const ctorEx: string[] = []
  let rhsBlocks = 0
  const leaked = new Map<string, { n: number; ex: string[] }>()
  let opaqueContainers = 0, opaqueMembers = 0, opaqueMembersOwned = 0
  const cells = new Map<string, number>()

  for (let fi = 0; fi < files.length; fi++) {
    const f = files[fi]!
    const src = fs.readFileSync(f, "utf8")
    const tree = parser().parse(src)
    const res: any = analyzer().analyze(tree.rootNode, src, f)
    const syms = res.symbols as any[]
    const assigned = new Map<string, Set<string>>()
    for (const s of syms) {
      const set = assigned.get(s.name) ?? new Set<string>()
      set.add(String(s.kind))
      assigned.set(s.name, set)
    }
    const where = (n: any) => `${f.split("/").slice(-2).join("/")}:${n.startPosition.row + 1}`
    const bump = (m: Map<string, { n: number; ex: string[] }>, k: string, ex: string) => {
      const d = m.get(k)
      if (d) { d.n++; if (d.ex.length < 3) d.ex.push(ex) }
      else m.set(k, { n: 1, ex: [ex] })
    }
    const visit = (n: any, inFn: boolean): void => {
      if (n.type === "struct_initializer" || n.type === "anonymous_struct_initializer") {
        const first = n.namedChildCount > 0 ? n.namedChild(0) : null
        if (first && first.type === "identifier" && first.text[0] === first.text[0]?.toUpperCase() && first.text[0] !== first.text[0]?.toLowerCase()) {
          const set = assigned.get(first.text)
          if (set && (set.has("struct") || set.has("enum") || set.has("union") || set.has("type"))) {
            constructions++
            if (ctorEx.length < 6) ctorEx.push(`${where(n)}  ${n.text.replace(/\s+/g, " ").slice(0, 70)}`)
          }
        }
      }
      if (n.type === "variable_declaration" && !inFn) {
        const kids: any[] = []
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c) kids.push(c)
        }
        if (kids.length > 0 && kids[0].type === "identifier" && kids[0].text !== "_" && kids[0].text.length <= 80) {
          const name = kids[0].text
          const rhs = kids[kids.length - 1]
          let isVar = false
          for (let i = 0; i < n.childCount; i++) {
            const c = n.child(i)
            if (c && !c.isNamed && c.type === "var") isVar = true
          }
          const upper = name[0] === name[0].toUpperCase() && name[0] !== name[0].toLowerCase()
          const kinds = [...(assigned.get(name) ?? new Set(["MISSING"]))].sort().join("+")
          cells.set(`${rhs.type}|${upper ? "UPPER" : "lower"}|${isVar ? "var" : "const"}|${kinds}`, (cells.get(`${rhs.type}|${upper ? "UPPER" : "lower"}|${isVar ? "var" : "const"}|${kinds}`) ?? 0) + 1)
          if (rhs.type === "labeled_type_expression") {
            let hasBreak = false, hasReturn = false
            const st: any[] = [rhs]
            while (st.length > 0) {
              const m = st.pop()!
              if (m.type === "break_label") hasBreak = true
              if (m.type === "return_expression") hasReturn = true
              for (let i = 0; i < m.namedChildCount; i++) {
                const c = m.namedChild(i)
                if (c) st.push(c)
              }
            }
            if (hasBreak && !hasReturn) labeledBlock++
            else if (hasReturn) labeledType++
            else labeledUnknown++
            if (labeledEx.length < 8) labeledEx.push(`${where(n)} break=${hasBreak} return=${hasReturn} kind=${kinds}  ${n.text.replace(/\s+/g, " ").slice(0, 60)}`)
          }
          if (rhs.type === "opaque_declaration") {
            opaqueContainers++
            for (const s of syms) {
              const ln = s.range?.startLine ?? 0
              if (ln > n.startPosition.row + 1 && ln <= n.endPosition.row + 1) {
                opaqueMembers++
                if (s.ownerName === name) opaqueMembersOwned++
              }
            }
          }
          if (rhs.type === "block" || rhs.type === "labeled_type_expression" || rhs.type === "switch_expression" || rhs.type === "if_expression") {
            rhsBlocks++
            for (const s of syms) {
              const ln = s.range?.startLine ?? 0
              if (ln > n.startPosition.row + 1 && ln <= n.endPosition.row + 1) {
                bump(leaked, `${rhs.type}|${s.kind}|owned=${s.ownerName ? "yes" : "no"}`, `${f.split("/").slice(-2).join("/")}:${ln} ${s.name}`)
              }
            }
          }
        }
      }
      const childInFn = inFn || SKIP_INFN.has(n.type)
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) visit(c, childInFn)
      }
    }
    visit(tree.rootNode, false)
    tree.delete()
    if (fi % 250 === 0) log(`  ...${fi}/${files.length}`)
  }

  log(`\n=== 1. labeled_type_expression on a container-scope RHS ===`)
  log(`   labeled BLOCK (break, no return) = a VALUE: ${labeledBlock}`)
  log(`   labeled TYPE  (returns)          = a TYPE:   ${labeledType}`)
  log(`   neither                          : ${labeledUnknown}`)
  for (const e of labeledEx) log(`   ${e}`)
  log(`\n=== 2. Z20 constructions of a resolvable type: ${constructions} ===`)
  for (const e of ctorEx) log(`   ${e}`)
  log(`\n=== 3. symbols minted inside a container-scope RHS block (${rhsBlocks} such declarations) ===`)
  for (const [k, v] of [...leaked.entries()].sort((a, b) => b[1].n - a[1].n)) {
    log(`\n${String(v.n).padStart(6)}  ${k}`)
    for (const e of v.ex) log(`        ${e}`)
  }
  log(`\n=== 4. opaque containers ${opaqueContainers}; members ${opaqueMembers}; owned ${opaqueMembersOwned} ===`)
  log(`\n=== 5. kind table AFTER the fixes (top 60) ===`)
  for (const [k, v] of [...cells.entries()].sort((a, b) => b[1] - a[1]).slice(0, 60)) log(`${String(v).padStart(6)}   ${k}`)
}
void main()
