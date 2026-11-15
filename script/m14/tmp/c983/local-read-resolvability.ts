/**
 * #983 — can the target of a local/param read edge RESOLVE?
 *
 * #983 recorded that `uses` resolves against FILE SCOPE ONLY: a read of a
 * function parameter or a function-local variable produces no edge. Its
 * sub-decision 1 asks whether params and locals SHOULD be referenced, and
 * treats the answer as a matter of taste ("semantically yes — low risk").
 *
 * It is not a matter of taste, and this instrument is what shows why. A
 * relationship target must name something a consumer can resolve
 * (c.md:1410, "the target must be something a consumer can
 * resolve" — the ruling that removed `exports -> KERNEL_EXPORT` and
 * `instantiates -> malloc`). So the question is not "should we add an edge" but
 * "what would the edge POINT AT". If 99% of those names have no published
 * symbol, the proposed edges are dangling, which this project ranks worse than
 * a missing edge (real-java-analyzer.ts:2320, "the false-edge class the ruling
 * ranks worse than a missing edge").
 *
 * MEASUREMENT, 300 corpus files (curl, libgit2, redis, zig), 1,472 functions:
 *
 *   distinct param/local names READ inside a body:  7,552
 *     93.51%  no symbol of that name exists anywhere in the file
 *      6.18%  the name also belongs to a `property` (a struct member, in some
 *             OTHER type — naming it would be a mis-attribution)
 *      0.23%  a `struct`, likewise unrelated
 *      0.03%  a `property` and a `type`
 *      0.05%  RESOLVABLE:  4 names, of which 3 are a same-named file-scope
 *             binding that the local SHADOWS — precisely the mis-attribution
 *             CGD15 exists to prevent — and 1 is a `variable` symbol that
 *             should not have been published at all (see truncation below)
 *
 * So the residue is not a feature waiting to be switched on. It is the
 * dangling-edge class the ontology already refuses, plus the shadowing class
 * the family already gates.
 *
 * TWO PROBES WERE WRONG FIRST, and both were wrong in the same direction —
 * over-counting the resolvable set:
 *
 *   1. A FILE-WIDE set of body-bound names. That made `uses global ->
 *      writeOffset` (curl/src/tool_writeout.c:428, a function name used as a
 *      value in a static table initializer) count as "a read of a local named
 *      writeOffset" merely because some other function in that file binds that
 *      name. 21 spurious `RESOLVABLE(function)` rows. The bound set must be
 *      PER FUNCTION, which is the scope CGD15 actually applies at.
 *
 *   2. Within that, walking the whole `declarator` rather than the
 *      `parameter_list` — which picks up the function's OWN name
 *      (`function_declarator > identifier`). That made
 *      `DEBUGASSERT(wovar->writefunc == writeTime)` (tool_writeout.c:53) inside
 *      `writeTime` look like a read of a parameter called `writeTime`. This is
 *      the trap `real-c-analyzer.ts:2941` records for the same reason: a
 *      declarator walk that does not stop at the parameter list loses the
 *      function's name into the params payload.
 *
 * Both corrections are in the collector below, and the per-function bound set
 * is what makes the 4-row residue trustworthy.
 */
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..", "..", "..", "..")
const wts: any = await import("web-tree-sitter")
const ParserClass = wts.Parser ?? wts.default ?? wts
const Language = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const grammar = await Language.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-c.wasm")))
const parser = new ParserClass()
parser.setLanguage(grammar)
const { RealCAnalyzer } = await import(path.join(ROOT, "src/ast/real-c-analyzer.ts"))
const analyzer = new RealCAnalyzer()

const CORPUS = "/home/sano/ishaq/bb_tests/repositories"

function arg(name: string, dflt: string): string {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt
}
const LIMIT = Number(arg("max-files", "300"))

function collectC(dir: string, out: string[], cap: number): string[] {
  if (out.length >= cap) return out
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    if (out.length >= cap) return out
    if (e.name === ".git" || e.name === "node_modules") continue
    const full = path.join(dir, e.name)
    if (e.isDirectory()) collectC(full, out, cap)
    else if (e.name.endsWith(".c") || e.name.endsWith(".h")) out.push(full)
  }
  return out
}

const files: string[] = []
for (const repo of ["curl", "libgit2", "redis", "zig"]) collectC(path.join(CORPUS, repo), files, LIMIT)

/** The symbol kinds a `uses` target may legitimately resolve to. */
const RESOLVABLE = new Set(["variable", "constant", "macro", "function"])

const leftmostIdentifier = (node: any): string | null => {
  if (!node) return null
  if (node.type === "identifier") return node.text
  for (let i = 0; i < node.namedChildCount; i++) {
    const found = leftmostIdentifier(node.namedChild(i))
    if (found) return found
  }
  return null
}

const findNode = (node: any, type: string): any => {
  if (!node) return null
  if (node.type === type) return node
  for (let i = 0; i < node.namedChildCount; i++) {
    const found = findNode(node.namedChild(i), type)
    if (found) return found
  }
  return null
}

const tally = new Map<string, number>()
const resolvableRows: string[] = []
let functions = 0
let filesParsed = 0
let paramReads = 0
let localReads = 0
let reads = 0

for (const file of files) {
  let src: string
  try {
    src = fs.readFileSync(file, "utf8")
  } catch {
    continue
  }
  if (src.length > 400_000) continue
  let root: any
  try {
    root = parser.parse(src).rootNode
  } catch {
    continue
  }
  filesParsed++
  let result: any
  try {
    result = analyzer.analyze(root, src, file)
  } catch {
    continue
  }
  const kindsByName = new Map<string, string[]>()
  for (const s of result.symbols ?? []) {
    const name = String(s.name)
    if (!kindsByName.has(name)) kindsByName.set(name, [])
    kindsByName.get(name)!.push(String(s.kind))
  }

  const stack: any[] = [root]
  while (stack.length > 0) {
    const node = stack.pop()
    if (!node) continue
    if (node.type === "function_definition") {
      functions++
      // PER FUNCTION. A file-wide bound set over-counts by attributing a
      // file-scope read of a name to a local of an unrelated function.
      const params = new Set<string>()
      const locals = new Set<string>()

      // Only the parameter_list. Walking the whole declarator also picks up the
      // function's OWN name, which reads as a self-referential parameter.
      const collectParams = (n: any): void => {
        if (!n) return
        if (n.type === "identifier") {
          params.add(n.text)
          return
        }
        if (n.type === "parameter_declaration") {
          const id = leftmostIdentifier(n.childForFieldName("declarator"))
          if (id) params.add(id)
          return
        }
        if (n.type === "variadic_parameter") return
        if (n.type !== "parameter_list" && n.type !== "function_declarator" && n.type !== "parenthesized_declarator") return
        for (let i = 0; i < n.namedChildCount; i++) collectParams(n.namedChild(i))
      }
      const paramList = findNode(node.childForFieldName("declarator"), "parameter_list")
      if (paramList) collectParams(paramList)

      const collectLocals = (n: any): void => {
        if (!n) return
        if (n.type === "declaration") {
          for (let i = 0; i < n.namedChildCount; i++) {
            const c = n.namedChild(i)
            if (c && (c.type.endsWith("declarator") || c.type === "identifier")) {
              const id = leftmostIdentifier(c)
              if (id) locals.add(id)
            }
          }
        }
        for (let i = 0; i < n.namedChildCount; i++) collectLocals(n.namedChild(i))
      }
      const body = node.childForFieldName("body")
      if (body) collectLocals(body)

      // Reads inside this body that are not declaration positions.
      const readStack: any[] = body ? [body] : []
      const seen = new Set<string>()
      while (readStack.length > 0) {
        const m = readStack.pop()
        if (!m) continue
        if (m.type === "identifier") {
          const inDeclaration =
            m.parent?.type === "declaration" ||
            m.parent?.type === "parameter_declaration" ||
            (m.parent?.type?.endsWith?.("declarator") ?? false)
          const isParam = params.has(m.text)
          const isLocal = !isParam && locals.has(m.text)
          if (!inDeclaration && (isParam || isLocal) && !seen.has(m.text)) {
            seen.add(m.text)
            reads++
            if (isParam) paramReads++
            else localReads++
            const kinds = kindsByName.get(m.text)
            if (!kinds) {
              const k = "no symbol of that name exists in the file"
              tally.set(k, (tally.get(k) ?? 0) + 1)
            } else {
              const resolvable = [...new Set(kinds)].filter((k) => RESOLVABLE.has(k))
              if (resolvable.length > 0) {
                const k = `RESOLVABLE (${resolvable.join("/")})`
                tally.set(k, (tally.get(k) ?? 0) + 1)
                if (resolvableRows.length < 30) {
                  resolvableRows.push(
                    `${isParam ? "param" : "local"} ${m.text} -> ${resolvable.join("/")}  ${path.relative(CORPUS, file)}:${m.startPosition.row + 1}`,
                  )
                }
              } else {
                const k = `name collides with an unrelated ${[...new Set(kinds)].join("/")}`
                tally.set(k, (tally.get(k) ?? 0) + 1)
              }
            }
          }
        }
        for (let i = 0; i < m.namedChildCount; i++) {
          const c = m.namedChild(i)
          if (c) readStack.push(c)
        }
      }
    }
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (c) stack.push(c)
    }
  }
}

const resolvable = [...tally.entries()].filter(([k]) => k.startsWith("RESOLVABLE")).reduce((a, [, v]) => a + v, 0)

console.log(`files=${filesParsed} functions=${functions}`)
console.log(`distinct param/local names READ inside a body: ${reads}  (params ${paramReads}, locals ${localReads})`)
for (const [k, v] of [...tally.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(v).padStart(6)}  ${((100 * v) / reads).toFixed(2).padStart(6)}%  ${k}`)
}
console.log(`\nRESOLVABLE: ${resolvable} of ${reads} = ${((100 * resolvable) / reads).toFixed(2)}%`)
for (const r of resolvableRows) console.log("  " + r)
