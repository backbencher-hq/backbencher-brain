/**
 * JULIA SUPERTYPE-OPERAND SHAPES, AND DECLARATIONS IN A TYPE POSITION — the two counts behind two
 * analyzer rules that were changed on 2026-10-28.
 *
 * WHY THIS EXISTS. The direct oracle disagreed with the analyzer on `julia/test/typegroup.jl` in 11
 * rows, and every one of them was a NAME the analyzer had derived out of an EXPRESSION: a
 * statement block used as a supertype, a ternary, a call, an interpolation, a `where` chain — and a
 * declaration nested inside a type head or a field's type. A rule that refuses those shapes is only
 * honest if the refusal is measured, because a shape that occurs 1,300 times cannot be refused and
 * one that occurs 11 times can. So this instrument counts both, over the SAME admitted population
 * and the SAME vendored grammar the analyzer uses, and the two rules cite it:
 *
 *   - `src/ast/real-julia-analyzer.ts` `supertypeName` — a supertype operand must NAME a type.
 *   - `src/ast/real-julia-analyzer.ts` — a declaration in a TYPE POSITION is nobody's member.
 *
 * WHAT IT MEASURES.
 *   1. Every `<:` in a type head (`struct`/`abstract type`/`primitive type`), classified by the node
 *      type of its RIGHT operand, with up to five examples each. `paren(x)` names the wrapper and
 *      the first named child, because `(Tuple{T} where T)` and `(global g; …; Any)` are both
 *      parenthesised and only one of them names a type.
 *   2. Every SELF-SUPERTYPE (`struct Foo <: Foo`) with its file and line.
 *   3. Every DECLARATION inside a type position: inside a `type_head`, or inside the TYPE operand of
 *      a struct's field declaration (`x::T`, `x::T = v`, `const x::T`). An earlier draft marked every
 *      `typed_expression`, which counted 10 functions and 4 modules inside a SIGNATURE's default
 *      argument and inflated the number the rule would have been justified by.
 *
 * READ-ONLY except `--json <path>`, which is how the committed artifact is written.
 *
 *   npx tsx validation/m14/fixtures/julia/supertype-shapes-census.ts --json validation/m14/measurements/julia-supertype-shapes.json
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const lang = await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-julia.wasm")))

const files: { repo: string; rel: string; abs: string }[] = []
for (const e of readdirSync(CR)) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch { continue }
  let tracked: string[] = []
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    try {
      if (statSync(abs).size > 512 * 1024) continue
      const text = readFileSync(abs, "utf8")
      if (detectLanguageFromPath(abs, text) !== "julia") continue
    } catch { continue }
    files.push({ repo: e, rel, abs })
  }
}

const TYPE_DEFS = new Set(["struct_definition", "abstract_definition", "primitive_definition"])
const DECLS = new Set(["struct_definition", "abstract_definition", "primitive_definition", "function_definition", "macro_definition", "module_definition"])
const NAME_SHAPES = new Set(["identifier", "field_expression", "parametrized_type_expression", "macro_identifier"])

const kids = (n: any): any[] => {
  const out: any[] = []
  for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) out.push(c) }
  return out
}
const operands = (n: any) => {
  const ks = kids(n).filter((c: any) => c.type !== "operator")
  return { op: (kids(n).find((c: any) => c.type === "operator")?.text ?? "").trim(), left: ks[0] ?? null, right: ks[ks.length - 1] ?? null }
}

const shapes = new Map<string, { n: number; examples: string[] }>()
const addShape = (k: string, ex: string) => {
  const r = shapes.get(k) ?? { n: 0, examples: [] }
  r.n++
  if (r.examples.length < 5) r.examples.push(ex)
  shapes.set(k, r)
}
const nested = new Map<string, { n: number; examples: string[] }>()
const addNested = (k: string, ex: string) => {
  const r = nested.get(k) ?? { n: 0, examples: [] }
  r.n++
  if (r.examples.length < 8) r.examples.push(ex)
  nested.set(k, r)
}
const selfSub: { file: string; line: number; text: string }[] = []

let parsed = 0, failed = 0
for (const f of files) {
  const parser = new WSP()
  parser.setLanguage(lang)
  let tree: any
  try { tree = parser.parse(readFileSync(f.abs, "utf8")) } catch { failed++; continue }
  if (!tree) { failed++; continue }
  parsed++
  const key = `${f.repo}/${f.rel}`
  const walk = (n: any, inTypeHead: boolean, inFieldType: boolean) => {
    if (TYPE_DEFS.has(n.type)) {
      const head = kids(n).find((c: any) => c.type === "type_head")
      if (head) {
        // a `<:` at the head's top level, not inside a parameter list
        const scan = (x: any, depth: number) => {
          if (x.type === "curly_expression") return
          if (x.type === "binary_expression") {
            const { op, left, right } = operands(x)
            if ((op === "<:" || op === ">:")) {
              const r = right
              shapes.get("") ?? null
              if (r) {
                const nm = r.type === "parenthesized_expression" ? `paren(${kids(r)[0]?.type ?? "empty"})` : r.type
                addShape(nm, `${key}:${n.startPosition.row + 1}  ${x.text.split("\n")[0]!.slice(0, 100)}`)
                if (left && right && left.text.trim() === right.text.trim()) {
                  selfSub.push({ file: key, line: n.startPosition.row + 1, text: x.text.split("\n")[0]!.slice(0, 120) })
                }
              }
            }
          }
          for (const c of kids(x)) scan(c, depth + 1)
        }
        scan(head, 0)
      }
    }
    if (DECLS.has(n.type)) {
      if (inTypeHead) addNested(`in type head: ${n.type}`, `${key}:${n.startPosition.row + 1}`)
      else if (inFieldType) addNested(`in field type: ${n.type}`, `${key}:${n.startPosition.row + 1}`)
    }
    const isStruct = n.type === "struct_definition"
    for (const c of kids(n)) {
      const nextHead = inTypeHead || c.type === "type_head"
      // A FIELD's TYPE is only a type position when the typed expression is a DECLARATION in a
      // struct body. An earlier draft marked every typed_expression, which counted 10 functions and
      // 4 modules living inside a SIGNATURE's default argument — neither is a type position, and the
      // inflated number would have been the measurement behind a rule.
      if (isStruct && (c.type === "typed_expression" || c.type === "assignment" || c.type === "const_statement")) {
        const lhs = c.type === "typed_expression" ? c : kids(c)[0]
        const typeNode = lhs?.type === "typed_expression" ? kids(lhs)[1] : null
        if (typeNode) {
          if (DECLS.has(typeNode.type)) addNested(`in field type: ${typeNode.type}`, `${key}:${typeNode.startPosition.row + 1}`)
          walk(typeNode, nextHead, true)
          continue
        }
      }
      walk(c, nextHead, inFieldType)
    }
  }
  walk(tree.rootNode, false, false)
  tree.delete?.()
  parser.delete?.()
}

const out = {
  language: "julia",
  population: { admitted: files.length, parsed, failed },
  supertypeOperandShapes: Object.fromEntries([...shapes.entries()].sort((a, b) => b[1].n - a[1].n)),
  declarationsNestedInTypePositions: Object.fromEntries([...nested.entries()].sort((a, b) => b[1].n - a[1].n)),
  selfSubtypeSites: selfSub,
}
console.log(JSON.stringify(out, null, 2))
const i = process.argv.indexOf("--json")
if (i >= 0) writeFileSync(process.argv[i + 1]!, JSON.stringify(out, null, 2) + "\n")
