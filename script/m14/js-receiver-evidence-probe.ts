// JAVASCRIPT RECEIVER-EVIDENCE PROBE — sizes the syntactic receiver-typing evidence classes that are
// NOT yet implemented, BEFORE a site is wired. The untyped-receiver wall (143,370 census rows) is
// closable only by evidence that is a static PROOF, not a guess; this probe counts the candidate
// classes over the admitted population so the implementation order is measured, not assumed.
//
// Classes counted (each is a property of the SOURCE, no inference):
//   A class-static     `Service.create()` — the receiver identifier names a class DECLARATION at
//                      PROGRAM scope in the same file (its members are published symbols, so the
//                      owner channel can use it).
//   B this-alias       `const self = this` inside a class method — `self.m()` therefore has the
//                      enclosing class as its receiver type (same proof class as `this.m()`, which
//                      is already implemented; the alias is merely spelled differently).
//   C instanceof       `if (x instanceof Foo) { x.m() }` — the call sits inside the branch that
//                      PROVES x's type; and the early-return form
//                      `if (!(x instanceof Foo)) return; x.m()` (call after the guard).
//   D param-default-new `function f(x = new Foo()) { x.m() }` — the parameter's default proves the
//                      type on the path where it is not passed.
//
// USAGE
//   export BB_CORPUS_ROOT=$PWD/.corpus
//   bun run script/m14/js-receiver-evidence-probe.ts --sample=200
// It is a MEASUREMENT: prints counts and per-file existence, writes nothing, exits 0 unless the
// corpus is missing. Counts are CANDIDATE SITES (occurrences), not gate yield — the gate yield is
// measured after an evidence class is wired, by the before/after arm pair.
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { getParser } from "../../src/ast/engine"

const CR = process.env.BB_CORPUS_ROOT ?? path.join(process.cwd(), ".corpus")
const SAMPLE = Number(process.argv.find((a) => a.startsWith("--sample="))?.slice("--sample=".length) ?? 200)
const EXTENSIONS = ["js", "jsx", "mjs", "cjs"]
const SIZE_CAP = 1024 * 1024

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    const abs = path.join(dir, name)
    let st
    try { st = statSync(abs) } catch { continue }
    if (st.isDirectory()) { walk(abs, out); continue }
    const dot = name.lastIndexOf(".")
    if (dot < 0) continue
    if (!EXTENSIONS.includes(name.slice(dot + 1).toLowerCase())) continue
    if (st.size > SIZE_CAP) continue
    out.push(abs)
  }
}
const all: string[] = []
try { walk(CR, all) } catch {
  console.error(`js-receiver-evidence-probe: corpus not found at ${CR} (set BB_CORPUS_ROOT)`)
  process.exit(2)
}
all.sort()
const stride = Math.max(1, Math.floor(all.length / SAMPLE))
const files: string[] = []
for (let i = 0; i < all.length && files.length < SAMPLE; i += stride) files.push(all[i])

type Counts = { files: number; A: number; Afiles: number; B: number; Bfiles: number; C1: number; C2: number; Cfiles: number; D: number; Dfiles: number }
const counts: Counts = { files: 0, A: 0, Afiles: 0, B: 0, Bfiles: 0, C1: 0, C2: 0, Cfiles: 0, D: 0, Dfiles: 0 }
const examples: Record<string, string[]> = { A: [], B: [], C: [], D: [] }

const text = (n: any): string => (n ? String(n.text) : "")
function callText(node: any): string {
  return text(node).replace(/\s+/g, " ").slice(0, 80)
}
for (const abs of files) {
  let content: string
  try { content = readFileSync(abs, "utf8") } catch { continue }
  const parser: any = await getParser("javascript" as any)
  let tree: any
  try { tree = parser.parse(content) } catch { continue }
  const root = tree.rootNode
  counts.files++
  let hitA = false, hitB = false, hitC = false, hitD = false

  // program-scope class declarations (published symbols whose members the owner channel can use)
  const programClasses = new Set<string>()
  for (let i = 0; i < root.namedChildCount; i++) {
    const c = root.namedChild(i)
    if (c.type === "class_declaration" || (c.type === "export_statement" && c.namedChildCount > 0)) {
      const decl = c.type === "export_statement" ? c.namedChild(0) : c
      if (decl && decl.type === "class_declaration") {
        const nm = decl.childForFieldName("name")
        if (nm) programClasses.add(nm.text)
      }
    }
  }
  const ancestors = (n: any): any[] => { const out: any[] = []; let p = n.parent; while (p) { out.push(p); p = p.parent } return out }
  const inMethodOrClass = (n: any): any | null => {
    for (const a of ancestors(n)) if (a.type === "method_definition" || a.type === "class_body" || a.type === "class_declaration" || a.type === "class") return a
    return null
  }
  const classOfMethod = (n: any): string | null => {
    for (const a of ancestors(n)) {
      if (a.type === "class_declaration" || a.type === "class") {
        const nm = a.childForFieldName("name")
        return nm ? nm.text : "<anonymous>"
      }
    }
    return null
  }
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    // A — member call whose ROOT identifier is a program-scope class declaration
    if (n.type === "call_expression") {
      const fn = n.childForFieldName("function")
      if (fn && fn.type === "member_expression") {
        let base: any = fn.childForFieldName("object")
        let rootId: any = null
        while (base && base.type === "member_expression") { base = base.childForFieldName("object") }
        if (base && base.type === "identifier") rootId = base
        if (rootId && programClasses.has(rootId.text)) {
          counts.A++
          hitA = true
          if (examples.A.length < 3) examples.A.push(`${path.relative(CR, abs)}: ${callText(n)}`)
        }
        // C — call inside the branch that PROVES the receiver's type via instanceof
        if (rootId) {
          for (const a of ancestors(n)) {
            if (a.type === "function_declaration" || a.type === "method_definition" || a.type === "arrow_function") break
            if (a.type === "if_statement") {
              const cond = a.childForFieldName("condition")
              if (cond && cond.type === "binary_expression" && text(cond.childForFieldName("operator")) === "instanceof") {
                const left = cond.childForFieldName("left")
                const right = cond.childForFieldName("right")
                const cons = a.childForFieldName("consequence")
                const inside = cons && n.startIndex >= cons.startIndex && n.endIndex <= cons.endIndex
                if (left && left.type === "identifier" && left.text === rootId.text && right && inside) {
                  counts.C1++; hitC = true
                  if (examples.C.length < 3) examples.C.push(`${path.relative(CR, abs)}: narrowed ${callText(n)}`)
                }
              }
            }
          }
        }
      }
    }
    // B — `const self = this` inside a class method
    if (n.type === "variable_declarator") {
      const id = n.childForFieldName("name")
      const val = n.childForFieldName("value")
      if (id && id.type === "identifier" && val && val.type === "this" && inMethodOrClass(n)) {
        const cls = classOfMethod(n)
        if (cls) {
          counts.B++; hitB = true
          if (examples.B.length < 3) examples.B.push(`${path.relative(CR, abs)}: const ${id.text} = this (${cls})`)
        }
      }
      // D — parameter default `= new Foo()`: the binding is the parameter name of the enclosing fn
      if (val && val.type === "new_expression" && n.parent && n.parent.type === "assignment_pattern") {
        // handled below via the parameter pattern instead
      }
    }
    // D — assignment_pattern in formal parameters whose right is `new Foo()`
    if (n.type === "assignment_pattern") {
      const left = n.childForFieldName("left")
      const right = n.childForFieldName("right")
      if (left && left.type === "identifier" && right && right.type === "new_expression") {
        const encl = ancestors(n).find((a) => a.type === "formal_parameters" || a.type === "parameters")
        if (encl) {
          counts.D++; hitD = true
          if (examples.D.length < 3) examples.D.push(`${path.relative(CR, abs)}: ${left.text} = new …`)
        }
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) stack.push(c) }
  }
  if (hitA) counts.Afiles++
  if (hitB) counts.Bfiles++
  if (hitC) counts.Cfiles++
  if (hitD) counts.Dfiles++
  tree.delete?.()
}
const pct = (n: number) => (counts.files === 0 ? "0.0" : ((100 * n) / counts.files).toFixed(1))
console.log(JSON.stringify({
  probe: "js-receiver-evidence-probe",
  command: "bun run script/m14/js-receiver-evidence-probe.ts --sample=" + SAMPLE,
  population: { corpusFiles: all.length, sampled: files.length, parsed: counts.files },
  candidateSites: {
    A_class_static_member_call: { sites: counts.A, files: counts.Afiles, filesPct: pct(counts.Afiles) },
    B_this_alias_declarator: { sites: counts.B, files: counts.Bfiles, filesPct: pct(counts.Bfiles) },
    C_instanceof_narrowed_call: { sites: counts.C1, files: counts.Cfiles, filesPct: pct(counts.Cfiles) },
    D_param_default_new: { sites: counts.D, files: counts.Dfiles, filesPct: pct(counts.Dfiles) },
  },
  examples,
  note: "CANDIDATE SITES, not gate yield: a site becomes resolved only when the member is actually declared on the proven owner. Yield is measured by the before/after arm pair after wiring.",
}, null, 1))

// --- ANALYZE MODE (--analyze): run the production ANALYZER over the sample and count the owner
// evidence it actually emits per class. The AST-only counts above size the candidate sites; this
// counts the rows that carry the evidence after the analyzer's own refusals (shadowed class name,
// dynamic `this`, class expressions), which is the number the D7 row reports.
if (process.argv.includes("--analyze")) {
  const { RealJavaScriptAnalyzer } = await import("../../src/ast/real-javascript-analyzer")
  const analyzer = new (RealJavaScriptAnalyzer as any)()
  const byEvidence: Record<string, number> = {}
  const byLabel: Record<string, number> = {}
  let rowsWithOwner = 0, filesScanned = 0
  for (const abs of files) {
    let content: string
    try { content = readFileSync(abs, "utf8") } catch { continue }
    let result: any
    try {
      const parser: any = await getParser("javascript" as any)
      const tree = parser.parse(content)
      result = await analyzer.analyze(tree.rootNode, content, abs)
      tree.delete?.()
    } catch { continue }
    filesScanned++
    for (const rel of result.relationships ?? []) {
      const md = rel.metadata ?? {}
      const ev = md.ownerEvidence
      if (typeof ev === "string" && typeof md.owner === "string") {
        rowsWithOwner++
        byEvidence[ev] = (byEvidence[ev] ?? 0) + 1
        const label = String(rel.type ?? "")
        byLabel[label] = (byLabel[label] ?? 0) + 1
      }
    }
  }
  console.log(JSON.stringify({
    probe: "js-receiver-evidence-probe --analyze",
    command: "bun run script/m14/js-receiver-evidence-probe.ts --analyze --sample=" + SAMPLE,
    population: { sampled: files.length, analysed: filesScanned },
    ownerCarryingRows: rowsWithOwner,
    byEvidenceClass: byEvidence,
    byLabel,
    note: "Rows the analyzer ACTUALLY published with metadata.owner + ownerEvidence over the sample, after its own refusals. class-static counts the new static-class-receiver class; this-alias the positional const-self=this class.",
  }, null, 1))
}
