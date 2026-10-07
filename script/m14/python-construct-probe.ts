/**
 * PYTHON CONSTRUCT PROBE — instrument B for the two types that did not fire.
 *
 * The ontology gate's founding incident is that `overrides` was ruled absent for
 * bash on a PROSE justification while the construct sat on the tree, and
 * nothing disagreed because nothing was there to disagree with. So a ruling has
 * to carry a MEASUREMENT, and the measurement for "does this language have this
 * construct" has to be one a string in a comment cannot fake.
 *
 * Two instruments, and which one applies is decided by the question:
 *
 *   A. GRAMMAR INVENTORY — positive evidence of absence for a type that would
 *      need a node type the grammar never emits. It enumerates every node type
 *      the grammar PRODUCES over the corpus. Used for `implements`.
 *   B. PARSE-TREE SEMANTIC COUNT — for a construct the language can express but
 *      this corpus may not use. It walks the tree and counts the node shape.
 *      Used for `exports` (`__all__`) and for every interface-declaring header
 *      `implements` could key on.
 *
 * NO REGEX. Every predicate is `node.type ===` or a character scan.
 *
 * Usage: bun run script/m14/python-construct-probe.ts --roots a,b [--stdlib]
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { ASTEngine, getParser } from "../../src/ast/engine"
import type { Node } from "web-tree-sitter"

const argv = process.argv.slice(2)
const argOf = (f: string): string | undefined => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined }
const USE_STDLIB = argv.includes("--stdlib")
const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const REPO_FILTER = argOf("--repo")
const MAX_BYTES = 1024 * 1024

const roots: Array<{ label: string; dir: string }> = []
if (USE_STDLIB) {
  // CPython's own standard library: real python code at scale, and the
  // reference implementation for every stdlib construct the analyzer keys on.
  const dir = argOf("--stdlib-dir") ?? "/usr/lib/python3.10"
  try { if (statSync(dir).isDirectory()) roots.push({ label: "cpython-stdlib", dir }) } catch {}
}
for (const r of (argOf("--roots") ?? "").split(",").filter(Boolean)) {
  const abs = path.isAbsolute(r) ? r : path.join(CR, r)
  roots.push({ label: path.basename(abs), dir: abs })
}
if (!roots.length) { console.error("no roots"); process.exit(1) }

const filesOf = (dir: string): string[] => {
  const out: string[] = []
  const walk = (d: string, depth: number) => {
    if (depth > 8 || out.length > 20000) return
    let ents: import("node:fs").Dirent[]
    try { ents = readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of ents) {
      if (e.name === "test" || e.name === "tests" || e.name === "lib2to3" || e.name === "idlelib") continue
      const p = path.join(d, e.name)
      if (e.isDirectory()) { walk(p, depth + 1); continue }
      if (!(e.name.endsWith(".py") || e.name.endsWith(".pyi"))) continue
      try { if (statSync(p).size > MAX_BYTES) continue } catch { continue }
      out.push(p)
    }
  }
  walk(dir, 0)
  return out
}

// ---- the constructs under measurement -------------------------------------
//
// `exports` fires from a MODULE-SCOPE `__all__` assignment whose value is a
// `list` or a `tuple` literal. The probe counts every shape it finds, split by
// scope and by RHS type, so a zero in the analyzer's output can be attributed
// to the construct being absent rather than to the filter being wrong.
type DunderAllHit = { scope: string; rhs: string; items: number; file: string; line: number }

// `implements` could key on any of these header shapes. Each is counted
// separately because they are different claims and a ruling has to say which.
type IfaceHit = {
  shape: "base-ABC" | "base-Protocol" | "metaclass-ABCMeta" | "decorator-abstractmethod" | "base-TypedDict" | "base-Enum" | "base-other"
  file: string
  line: number
  text: string
}

const nodeTypesSeen = new Set<string>()
let filesParsed = 0
let filesFailed = 0
const dunderAll: DunderAllHit[] = []
const iface: IfaceHit[] = []
const classHeaders = new Map<string, number>()
const parseErrorFiles: string[] = []

/** The leaf a static name expression carries, and nothing when it carries none. */
const staticLeaf = (n: Node | null): string | undefined => {
  if (!n) return undefined
  if (n.type === "identifier") return n.text
  if (n.type === "dotted_name" || n.type === "attribute") return n.namedChild(n.namedChildCount - 1)?.text
  if (n.type === "subscript") return staticLeaf(n.namedChild(0))
  return undefined
}
const isQualified = (n: Node | null): boolean => {
  if (!n) return false
  if (n.type === "dotted_name" || n.type === "attribute") return true
  if (n.type === "subscript") { const f = n.namedChild(0); return !!f && (f.type === "dotted_name" || f.type === "attribute") }
  return false
}

const parser = await getParser("python")

for (const root of roots) {
  const files = filesOf(root.dir)
  let n = 0
  for (const abs of files) {
    let text: string
    try { text = readFileSync(abs, "utf8") } catch { continue }
    let root_: Node | null = null
    try { root_ = (await parser.parse(text, abs)).rootNode; filesParsed++ } catch { filesFailed++; continue }
    if (!root_) { filesFailed++; continue }
    n++
    if (root_.hasError) parseErrorFiles.push(abs)
    // Walk: record every node TYPE (instrument A) and both constructs (B).
    const stack: Node[] = [root_]
    while (stack.length) {
      const node = stack.pop()!
      nodeTypesSeen.add(node.type)

      if (node.type === "assignment" || node.type === "augmented_assignment") {
        const left = node.namedChild(0)
        if (left && left.type === "identifier" && left.text === "__all__") {
          // Module scope = no enclosing def/class. Walk the parent chain
          // directly: a threaded counter would have to be balanced on entry
          // and exit for every def in the corpus.
          let scope = "module"
          for (let p: Node | null = node.parent; p; p = p.parent) {
            if (p.type === "function_definition") { scope = "function"; break }
            if (p.type === "class_definition") { scope = "class"; break }
          }
          const right = node.childForFieldName("right") ?? node.namedChild(node.namedChildCount - 1)
          let items = 0
          if (right && right.type === "list") for (let i = 0; i < right.namedChildCount; i++) if (right.namedChild(i)?.type === "string") items++
          if (right && right.type === "tuple") for (let i = 0; i < right.namedChildCount; i++) if (right.namedChild(i)?.type === "string") items++
          dunderAll.push({ scope, rhs: right?.type ?? "none", items, file: abs, line: node.startPosition.row + 1 })
        }
      }

      if (node.type === "class_definition") {
        const sup = node.childForFieldName("superclasses")
        let sawMeta = false
        let sawAbc = false
        let sawProto = false
        let sawTd = false
        let sawOther = false
        const leaves: string[] = []
        if (sup) {
          for (let i = 0; i < sup.namedChildCount; i++) {
            const b = sup.namedChild(i)
            if (!b) continue
            if (b.type === "keyword_argument") {
              const v = b.childForFieldName("value")
              if (v && staticLeaf(v) === "ABCMeta") sawMeta = true
              continue
            }
            const leaf = staticLeaf(b)
            if (!leaf) continue
            leaves.push(leaf)
            if (leaf === "ABC") sawAbc = true
            else if (leaf === "Protocol") sawProto = true
            else if (leaf === "TypedDict") sawTd = true
            else sawOther = true
          }
        }
        const clsName = node.namedChild(0)?.text ?? "?"
        const key = `${sawMeta}|${sawAbc}|${sawProto}|${sawTd}|${sawOther}`
        classHeaders.set(key, (classHeaders.get(key) ?? 0) + 1)
        const base = `${root.label}/${path.relative(root.dir, abs)}`
        if (sawMeta) iface.push({ shape: "metaclass-ABCMeta", file: base, line: node.startPosition.row + 1, text: clsName })
        if (sawAbc) iface.push({ shape: "base-ABC", file: base, line: node.startPosition.row + 1, text: `${clsName}(${leaves.join(",")})` })
        if (sawProto) iface.push({ shape: "base-Protocol", file: base, line: node.startPosition.row + 1, text: `${clsName}(${leaves.join(",")})` })
        if (sawTd) iface.push({ shape: "base-TypedDict", file: base, line: node.startPosition.row + 1, text: `${clsName}(${leaves.join(",")})` })
      }

      if (node.type === "decorator") {
        const inner = node.namedChild(0)
        if (inner) {
          const leaf = inner.type === "call" ? staticLeaf(inner.namedChild(0)) : staticLeaf(inner)
          if (leaf === "abstractmethod" || leaf === "abstractproperty" || leaf === "abstractclassmethod" || leaf === "abstractstaticmethod") {
            // only counts when it decorates a METHOD inside a class body
            let owner = "?"
            let inClass = false
            for (let p: Node | null = node.parent; p; p = p.parent) {
              if (p.type === "function_definition") { owner = node.namedChild(0)?.text ?? "?"; break }
              if (p.type === "class_definition") { inClass = true; break }
            }
            if (inClass && owner !== "?") {
              iface.push({ shape: "decorator-abstractmethod", file: `${root.label}/${path.relative(root.dir, abs)}`, line: node.startPosition.row + 1, text: owner })
            }
          }
        }
      }

      for (let i = 0; i < node.namedChildCount; i++) { const c = node.namedChild(i); if (c) stack.push(c) }
    }
  }
  console.log(`${root.label}: ${files.length} .py files, ${n} parsed`)
}

const byScope = new Map<string, number>()
for (const d of dunderAll) byScope.set(`${d.scope}/${d.rhs}`, (byScope.get(`${d.scope}/${d.rhs}`) ?? 0) + 1)
const byShape = new Map<string, number>()
for (const i of iface) byShape.set(i.shape, (byShape.get(i.shape) ?? 0) + 1)

console.log(`\nfiles parsed ${filesParsed}, failed ${filesFailed}, with parse errors ${parseErrorFiles.length}`)
console.log(`\n== INSTRUMENT B1: module-scope __all__ (what \`exports\` keys on) ==`)
console.log(`  total __all__ assignments on the tree: ${dunderAll.length}`)
for (const [k, v] of [...byScope.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${w(k, 26)} ${v}`)
const moduleLiteral = dunderAll.filter((d) => d.scope === "module" && (d.rhs === "list" || d.rhs === "tuple"))
console.log(`  MODULE-scope list/tuple __all__ (the only shape that fires exports): ${moduleLiteral.length}`)
for (const d of moduleLiteral.slice(0, 10)) console.log(`     ${d.file}:${d.line} ${d.rhs} items=${d.items}`)

console.log(`\n== INSTRUMENT B2: interface-declaring class headers (what \`implements\` could key on) ==`)
for (const [k, v] of [...byShape.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${w(k, 26)} ${v}`)
for (const i of iface.slice(0, 20)) console.log(`     ${i.shape} ${i.file}:${i.line} ${i.text}`)

console.log(`\n== INSTRUMENT A: grammar inventory ==`)
console.log(`  distinct node types the grammar PRODUCED over this corpus: ${nodeTypesSeen.size}`)
const WOULD_MEAN_INTERFACE = ["implements_clause", "extends_clause", "superclass", "interface_declaration", "interface_body", "base_class_clause", "inheritance_specifier", "type_implements", "interface_type", "type_inheritance_clause", "class_heritage", "protocol_declaration"]
for (const t of WOULD_MEAN_INTERFACE) console.log(`  ${w(t, 26)} ${nodeTypesSeen.has(t) ? "PRESENT" : "absent"}`)
console.log(`  class_definition's base-list field: superclasses (ONE field, ONE argument_list) — see extractClass`)

function w(s: string, n: number): string { return (s + " ".repeat(n)).slice(0, n) }