// VERIFY_PY10 — `implements` construct probe for PYTHON.
//
// THE QUESTION. The one relationship type python's production path never emits is
// `implements`. The workstream's rule is that a gap is decided by whether the
// LANGUAGE has the construct, measured — never by prose. So this file counts, on
// the parse tree of every code-bearing corpus file, each shape python has that
// could carry an interface-conformance fact, and reports which of them occur.
//
// A probe that matches a SHAPE rather than a ROLE produces a number and the number
// is worth nothing (the gate's own record of the two regex false positives, and of
// the JSON `$ref` probe that reported 2,651 hits of which the examples were
// filenames in a `files` array). So every row below records the ROLE that makes a
// hit a conformance claim, not merely the token shape:
//
//   A. PROTOCOL SUBCLASS        a class whose base list names `Protocol`
//                               (or `Protocol[T]`, `Generic`-wrapped). Nominal
//                               declaration of an interface.
//   B. ABC SUBCLASS             a class whose base list names `ABC`, `ABCMeta`,
//                               `object`-with-abstractmethod-marker... measured
//                               as: base leaf in {ABC, ABCMeta}.
//   C. EXPLICIT REGISTRATION    `<callable>.register(<ClassName>)` — abc's
//                               virtual-subclass registration, the only python
//                               construct that names conformance with NO
//                               inheritance edge at all.
//   D. STRUCTURAL CONFORMANCE   a parameter annotated with a name that is declared
//                               as a Protocol class IN THE SAME FILE — the class
//                               handed to that parameter structurally satisfies it.
//                               This is python's distinctive form and the only one
//                               `extends` cannot carry.
//   E. zope INTERFACE           `@implementer(Iface)` / `@implementer(Iface1, ...)`.
//   F. RUNTIME ISINSTANCE OF A
//      FILE-LOCAL PROTOCOL     `isinstance(x, P)` where P is a Protocol declared in
//                              this file. The checker that documents conformance.
//
// INSTRUMENT. B:parse-tree-count. Every hit is read off `node.type`, named
// children and `childForFieldName` — never off source text. A string literal or a
// comment cannot produce a hit, which is the property the regex probes lacked.
//
// NO REGEX (workstream rule 1): string equality and char scans only.
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import type { Node } from "web-tree-sitter"

const REPO = process.env.BB_REPO || "/tmp/opencode/wt/VERIFY_PY10"
const CORPUS = process.env.BB_CORPUS || "$HOME/fixtures/repositories"
const LIMIT = Number(process.env.BB_LIMIT || 0) // 0 = the whole population
const EXTS = [".py", ".pyi"]
const SKIP_DIRS = new Set([
  "node_modules", ".git", "target", "build", "dist", ".tox", "vendor",
  "__pycache__", ".mypy_cache", ".venv", "venv", "htmlcov", ".eggs",
])
const SIGNAL = ["def ", "class ", "import ", "@", "lambda "]

function derivePopulation(): string[] {
  const out: string[] = []
  const walk = (d: string, depth: number): void => {
    if (depth > 24) return
    let ents
    try { ents = readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of ents) {
      const p = join(d, e.name)
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(p, depth + 1)
        continue
      }
      let isPy = false
      for (const x of EXTS) if (e.name.endsWith(x)) { isPy = true; break }
      if (!isPy) continue
      let st
      try { st = statSync(p) } catch { continue }
      if (!st.isFile() || st.size >= 400_000) continue
      let content = ""
      try { content = readFileSync(p, "utf8") } catch { continue }
      let bearing = false
      for (const s of SIGNAL) if (content.includes(s)) { bearing = true; break }
      if (bearing) out.push(p)
    }
  }
  walk(CORPUS, 0)
  out.sort()
  return LIMIT > 0 ? out.slice(0, LIMIT) : out
}

// ---------------------------------------------------------------------------

const { getParser } = await import(`${REPO}/src/ast/engine.ts`)
const { RealPythonAnalyzer } = await import(`${REPO}/src/ast/real-python-analyzer.ts`)
const parser = await getParser("python")
const analyzer = new RealPythonAnalyzer()
// Files whose interface-shaped sites this run also runs the PRODUCTION analyzer over,
// so the ruling can be checked rather than asserted. Derived from the rows below at
// runtime, never hand-listed.
const adjudicate = new Set<string>()
// Does an in-file CLASS with all of P's members get an `implements` edge? No rule can
// produce one without it, but the count that decides it is 0 of 0 and a reader is
// entitled to see why.
let protoDecls = 0
let protoDeclsWithOtherClass = 0
let completeImpls = 0
/** How big is the protocol's member set? This is the whole character of the 224:
 *  a protocol demanding one dunder every class already has is "satisfied" by every
 *  class in the file, so member-set coverage alone is not evidence of conformance. */
const implsByPSize = new Map<number, number>()
const implExamples: string[] = []

const namedChildOfType = (n: Node, type: string): Node | null => {
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c && c.type === type) return c
  }
  return null
}

/** The static name a base-list entry carries, on the same allowlist the analyzer uses. */
function baseLeaf(node: Node): string | undefined {
  if (node.type === "identifier") return node.text
  if (node.type === "subscript") {
    const first = node.namedChild(0)
    return first ? baseLeaf(first) : undefined
  }
  if (node.type === "attribute") {
    const last = node.namedChild(node.namedChildCount - 1)
    return last ? last.text : undefined
  }
  return undefined
}

/** The static name a call's callee carries (identifier / attribute leaf only). */
function calleeLeaf(node: Node | null): string | undefined {
  if (!node) return undefined
  if (node.type === "identifier") return node.text
  if (node.type === "attribute") {
    const last = node.namedChild(node.namedChildCount - 1)
    return last ? last.text : undefined
  }
  return undefined
}

function dottedCallee(node: Node | null): string {
  if (!node) return ""
  if (node.type === "identifier") return node.text
  if (node.type === "attribute") {
    const obj = node.namedChild(0)
    const leaf = node.namedChild(node.namedChildCount - 1)
    return `${dottedCallee(obj)}.${leaf ? leaf.text : ""}`
  }
  return ""
}

const PROTOCOL_LEAVES = new Set(["Protocol"])
const ABC_LEAVES = new Set(["ABC", "ABCMeta"])

interface Hits { n: number; files: Set<string>; examples: string[] }
const rows: Record<string, Hits> = {}
/** receiver-leaf histogram for `.register(` — printed so the role filter is auditable */
const regReceiver = new Map<string, number>()
/** D is deduped on (file, line, protocol name): the `type` NODE and the assignment's
 *  `type` FIELD are two descriptions of one annotation, and counting both is how a
 *  12-hit row becomes a 6-hit row the reader can reason about. */
const dSeen = new Set<string>()
/** per-file class tables, kept so the adjudication pass can re-derive the SAME sites
 *  on the same tree instead of re-guessing them from a second walk. */
const tables = new Map<string, { root: Node; bases: Map<string, string[]>; ifaces: Set<string> }>()
const bump = (row: string, file: string, line: number, what: string): void => {
  const h = rows[row] ?? { n: 0, files: new Set<string>(), examples: [] }
  h.n++
  h.files.add(file)
  if (h.examples.length < 6) h.examples.push(`${file}:${line} ${what}`)
  rows[row] = h
}

/** class_name -> base leaves, and the set of classes that ARE protocols in this file. */
function classTable(root: Node): { bases: Map<string, string[]>; protocols: Set<string>; declared: Set<string> } {
  const bases = new Map<string, string[]>()
  const protocols = new Set<string>()
  const declared = new Set<string>()
  const visit = (n: Node): void => {
    if (n.type === "class_definition") {
      const name = namedChildOfType(n, "identifier")?.text
      if (name) {
        declared.add(name)
        const args = namedChildOfType(n, "argument_list")
        const leaves: string[] = []
        if (args) {
          for (let i = 0; i < args.namedChildCount; i++) {
            const a = args.namedChild(i)
            if (!a || a.type === "keyword_argument") continue
            const leaf = baseLeaf(a)
            if (leaf) leaves.push(leaf)
          }
        }
        bases.set(name, leaves)
        for (const l of leaves) if (PROTOCOL_LEAVES.has(l)) protocols.add(name)
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) visit(c)
    }
  }
  visit(root)
  return { bases, protocols, declared }
}

/**
 * FIXPOINT over the class table: a class is an INTERFACE if it inherits, directly or
 * transitively, from `Protocol` / `ABC` / `ABCMeta`. This is what decides whether an
 * `implements` edge has an endpoint this analyzer can actually NAME — the whole
 * question of whether `implements` is a gap or a ruling turns on it.
 */
function interfaceClasses(bases: Map<string, string[]>): Set<string> {
  const isIface = new Set<string>()
  let changed = true
  while (changed) {
    changed = false
    for (const [name, leaves] of bases) {
      if (isIface.has(name)) continue
      for (const l of leaves) {
        if (PROTOCOL_LEAVES.has(l) || ABC_LEAVES.has(l) || isIface.has(l)) {
          isIface.add(name)
          changed = true
          break
        }
      }
    }
  }
  return isIface
}

function decoratorLeaves(def: Node): string[] {
  const out: string[] = []
  const parent = def.parent
  if (!parent || parent.type !== "decorated_definition") return out
  for (let i = 0; i < parent.namedChildCount; i++) {
    const c = parent.namedChild(i)
    if (!c || c.type !== "decorator") continue
    const inner = c.namedChild(0)
    if (!inner) continue
    if (inner.type === "call") out.push(`${dottedCallee(inner.namedChild(0))}`)
    else out.push(`${dottedCallee(inner)}`)
  }
  return out
}

function scanFile(root: Node, label: string): void {
  const { bases, protocols, declared } = classTable(root)
  const ifaces = interfaceClasses(bases)
  tables.set(label, { root, bases, ifaces })

  const visit = (n: Node): void => {
    // A. / B. nominal base declarations
    if (n.type === "class_definition") {
      const name = namedChildOfType(n, "identifier")?.text ?? "?"
      for (const leaf of bases.get(name) ?? []) {
        if (PROTOCOL_LEAVES.has(leaf)) {
          bump("A: class X(Protocol...)", label, n.startPosition.row + 1, `class ${name}(${leaf})`)
        }
        if (ABC_LEAVES.has(leaf)) {
          bump("B: class X(ABC/ABCMeta)", label, n.startPosition.row + 1, `class ${name}(${leaf})`)
        }
        // G. THE ROW THE WHOLE VERDICT TURNS ON. A base entry that names a class
        // declared IN THIS FILE as an interface. Both endpoints are then symbols this
        // file publishes, so `implements` would have a nameable source AND target and
        // would carry a fact `extends` cannot: that the supertype is a CONTRACT and
        // not an implementation. Non-zero here = gap. Zero here = the only reachable
        // `implements` is the name-convention row H, and a name convention is not a
        // construct (the JSON `$ref` ruling's whole argument).
        if (ifaces.has(leaf)) {
          bump("G: base names a FILE-LOCAL interface", label, n.startPosition.row + 1, `class ${name}(${leaf}) [${leaf} is file-local interface]`)
          adjudicate.add(label)
        }
        if (PROTOCOL_LEAVES.has(leaf) || ABC_LEAVES.has(leaf)) {
          bump("H: base NAME is Protocol/ABC/ABCMeta (convention)", label, n.startPosition.row + 1, `class ${name}(${leaf})`)
          adjudicate.add(label)
        }

      }
      // E. zope @implementer(...)
      for (const d of decoratorLeaves(n)) {
        const dot = d.lastIndexOf(".")
        const leaf = dot >= 0 ? d.slice(dot + 1) : d
        if (leaf === "implementer") {
          bump("E: @implementer(...)", label, n.startPosition.row + 1, `class ${name} @${d}`)
        }
      }
    }

    if (n.type === "function_definition") {
      const name = namedChildOfType(n, "identifier")?.text ?? "?"
      for (const d of decoratorLeaves(n)) {
        const dot = d.lastIndexOf(".")
        const leaf = dot >= 0 ? d.slice(dot + 1) : d
        if (leaf === "implementer") {
          bump("E: @implementer(...)", label, n.startPosition.row + 1, `def ${name} @${d}`)
        }
      }
    }

    // C. explicit registration / F. runtime isinstance / D. structural conformance
    if (n.type === "call") {
      const fn = n.namedChild(0)
      const leaf = calleeLeaf(fn)
      if (leaf === "register" && fn?.type === "attribute") {
        const owner = calleeLeaf(fn.namedChild(0))
        const args = n.childForFieldName("arguments")
        const arg0 = args ? args.namedChild(0) : null
        if (arg0) {
          const argLeaf = calleeLeaf(arg0)
          const spelled = arg0.type === "identifier" ? arg0.text : (argLeaf ?? arg0.type)
          // ROW C IS THE SHAPE-VERSUS-ROLE TRAP, HIT ONCE IN THIS VERY PROBE.
          // The first version of this row counted every `<x>.register(y)` call and
          // reported 15 hits — of which the first example was
          // `atexit.register(ClearRegisteredBenchmarks)`, which registers a
          // process-exit HOOK and conforms to nothing. That is precisely the defect
          // the gate header records for the JSON `$ref` probe: a probe that matches
          // a SHAPE rather than a ROLE produces a number and the number is worth
          // nothing. So the receiver leaf is tallied by name and the STRICT role
          // count (receiver leaf is an ABC namespace) is reported separately, with
          // the full receiver histogram beside it so a reader can adjudicate every
          // site rather than trust the filter.
          regReceiver.set(owner ?? "(none)", (regReceiver.get(owner ?? "(none)") ?? 0) + 1)
          if (owner !== undefined && (owner === "ABC" || owner === "ABCMeta")) {
            bump("C: ABC.register(X) — virtual subclass", label, n.startPosition.row + 1, `${owner}.register(${spelled})`)
            adjudicate.add(label)
          } else {
            bump("C2: <other>.register(X) — role NOT conformance", label, n.startPosition.row + 1, `${owner}.register(${spelled})`)
          }
        }
      }
      if ((leaf === "isinstance" || leaf === "issubclass") && fn?.type === "identifier") {
        const args = n.childForFieldName("arguments")
        if (args && args.namedChildCount >= 2) {
          const second = args.namedChild(1)
          const target = second.type === "tuple" ? null : calleeLeaf(second)
          if (target && protocols.has(target)) {
            bump("F: isinstance(x, file-local Protocol)", label, n.startPosition.row + 1, `${leaf}(..., ${target})`)
            adjudicate.add(label)
          }
          if (second.type === "tuple") {
            for (let i = 0; i < second.namedChildCount; i++) {
              const t = calleeLeaf(second.namedChild(i))
              if (t && protocols.has(t)) {
                bump("F: isinstance(x, file-local Protocol)", label, n.startPosition.row + 1, `${leaf}(..., ${t})`)
                adjudicate.add(label)
              }
            }
          }
        }
      }
    }

    // D. structural conformance: an annotation naming a Protocol declared in THIS file
    if (n.type === "type") {
      const names: string[] = []
      const collect = (x: Node): void => {
        if (x.type === "identifier") { names.push(x.text); return }
        for (let i = 0; i < x.namedChildCount; i++) {
          const c = x.namedChild(i)
          if (c) collect(c)
        }
      }
      collect(n)
      for (const nm of names) {
        if (!protocols.has(nm)) continue
        const dk = `${label}\u0000${n.startPosition.row + 1}\u0000${nm}`
        if (dSeen.has(dk)) continue
        dSeen.add(dk)
        bump("D: annotation names a file-local Protocol", label, n.startPosition.row + 1, `annotation -> ${nm}`)
        adjudicate.add(label)
      }
    }
    // A class-body / module-level annotation too (`x: MyProto = ...`)
    if (n.type === "assignment" || n.type === "typed_parameter" || n.type === "default_parameter" ||
        n.type === "typed_default_parameter") {
      const t = n.childForFieldName("type")
      if (t) {
        const names: string[] = []
        const collect = (x: Node): void => {
          if (x.type === "identifier") { names.push(x.text); return }
          for (let i = 0; i < x.namedChildCount; i++) {
            const c = x.namedChild(i)
            if (c) collect(c)
          }
        }
        collect(t)
        for (const nm of names) {
          if (!protocols.has(nm)) continue
          const dk = `${label}\u0000${t.startPosition.row + 1}\u0000${nm}`
          if (dSeen.has(dk)) continue
          dSeen.add(dk)
          bump("D: annotation names a file-local Protocol", label, n.startPosition.row + 1, `type field -> ${nm}`)
          adjudicate.add(label)
        }
      }
    }

    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) visit(c)
    }
  }
  visit(root)

  // Control: how many classes at all, and how many files carry any class. Without
  // this the denominators below are unreadable — a hit count of 4 is 0.1% or 40%
  // depending on which population it is taken over.
  // PROTOCOL MEMBER SET vs CANDIDATE CLASS MEMBER SET. The one python construct that
  // `extends` cannot express is STRUCTURAL conformance — `class C` satisfying
  // `Protocol P` with no base entry at all — and it needs two facts: P's members, and
  // a C that has them all. Both are derivable in a single file. So the count that
  // decides the verdict is: how many (P, C) pairs in one file, C not inheriting P,
  // where C declares every name P declares?
  {
    const membersOf = new Map<string, Set<string>>()
    const baseOf = new Map<string, string[]>()
    const cv2 = (n: Node, owner: string | null): void => {
      if (n.type === "class_definition") {
        const nm = namedChildOfType(n, "identifier")?.text
        if (nm) {
          const ms = new Set<string>()
          const body = namedChildOfType(n, "block")
          if (body) {
            for (let i = 0; i < body.namedChildCount; i++) {
              const st = body.namedChild(i)
              if (!st) continue
              if (st.type === "function_definition") {
                const fn = namedChildOfType(st, "identifier")?.text
                if (fn) ms.add(fn)
              } else if (st.type === "expression_statement") {
                const asg = st.namedChild(0)
                if (asg && asg.type === "assignment") {
                  const lhs = asg.namedChild(0)
                  if (lhs && lhs.type === "identifier") ms.add(lhs.text)
                }
              } else if (st.type === "decorated_definition") {
                const inner = st.namedChild(st.namedChildCount - 1)
                if (inner && inner.type === "function_definition") {
                  const fn = namedChildOfType(inner, "identifier")?.text
                  if (fn) ms.add(fn)
                }
              }
            }
          }
          membersOf.set(nm, ms)
          baseOf.set(nm, bases.get(nm) ?? [])
          if (protocols.has(nm)) {
            protoDecls++
            if (declared.size > 1) protoDeclsWithOtherClass++
          }
          for (let i = 0; i < n.namedChildCount; i++) {
            const c = n.namedChild(i)
            if (c) cv2(c, nm)
          }
          return
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) cv2(c, owner)
      }
    }
    cv2(root, null)
    for (const p of protocols) {
      const need = membersOf.get(p)
      if (!need || need.size === 0) continue
      for (const c of declared) {
        if (c === p) continue
        const b = baseOf.get(c) ?? []
        if (b.includes(p)) continue          // nominal — `extends` already carries it
        const have = membersOf.get(c)
        if (!have) continue
        let all = true
        for (const nm of need) if (!have.has(nm)) { all = false; break }
        if (all) {
          completeImpls++
          const sz = need.size
          implsByPSize.set(sz, (implsByPSize.get(sz) ?? 0) + 1)
          if (implExamples.length < 10) implExamples.push(`${label}: ${c} covers ${p} (${sz} member(s): ${[...need].join(", ")})`)
        }
      }
    }
  }

  let classCount = 0
  const cv = (n: Node): void => {
    if (n.type === "class_definition") classCount++
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) cv(c)
    }
  }
  cv(root)
  bump("CTRL: class declarations (denominator)", label, 0, `${classCount} in this file`)
  if (declared.size > 0) bump("CTRL: files with >=1 class", label, 0, `${declared.size} classes`)
}

// ---------------------------------------------------------------------------

const files = derivePopulation()
console.log(`VERIFY_PY10 — implements construct probe (python)`)
console.log(`corpus=${CORPUS}`)
console.log(`population: ${files.length} code-bearing .py/.pyi files (derived by readdir, no hand-written list)`)
if (LIMIT > 0) console.log(`  LIMIT=${LIMIT} applied — a PREFIX of the sorted population, so this is a sample not the whole`)

// INSTRUMENT A — the grammar's own vocabulary, observed across the whole population.
// This is the instrument that answers "does this language HAVE a construct at all",
// and for `implements` the question is whether the grammar can express a supertype
// entry that is an interface rather than a class. Enumerating every node type the
// grammar actually emits is positive evidence either way: a list containing no
// interface/implementation clause node of any kind is a fact about the language, not a
// failure to find something.
const nodeTypes = new Map<string, number>()
const NODE_TYPES_THAT_WOULD_MEAN_IT = [
  "implements_clause", "extends_clause", "superclass", "interface_declaration",
  "interface_body", "interface_implementation", "object_creation_expression",
  "new_expression", "constructor_invocation",
]

let parsed = 0
let failed = 0
for (const f of files) {
  let content = ""
  try { content = readFileSync(f, "utf8") } catch { failed++; continue }
  try {
    const pr = await parser.parse(content, f)
    const iv = (n: Node): void => {
      nodeTypes.set(n.type, (nodeTypes.get(n.type) ?? 0) + 1)
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) iv(c)
      }
    }
    iv(pr.rootNode)
    scanFile(pr.rootNode, relative(CORPUS, f))
    parsed++
  } catch { failed++ }
}

console.log(`\nINSTRUMENT A — grammar node-type inventory over the same ${parsed} files`)
console.log(`  distinct node types the tree-sitter-python grammar actually emitted: ${nodeTypes.size}`)
const present = NODE_TYPES_THAT_WOULD_MEAN_IT.filter((n) => nodeTypes.has(n))
console.log(`  probed for ${NODE_TYPES_THAT_WOULD_MEAN_IT.length} node types that would express a supertype/interface clause or a constructor:`)
console.log(`  present: ${present.length ? present.join(", ") : "NONE"}`)
console.log(`  the supertype construct python HAS, and it has exactly one node type:`)
for (const n of ["class_definition", "argument_list", "superclasses", "identifier", "type_alias_statement", "decorated_definition"]) {
  console.log(`    ${n.padEnd(24)} ${nodeTypes.get(n) ?? 0}`)
}

console.log(`parsed ${parsed}/${files.length}, failed ${failed}\n`)
const order = [
  "CTRL: class declarations (denominator)",
  "CTRL: files with >=1 class",
  "A: class X(Protocol...)",
  "B: class X(ABC/ABCMeta)",
  "G: base names a FILE-LOCAL interface",
  "H: base NAME is Protocol/ABC/ABCMeta (convention)",
  "C: ABC.register(X) — virtual subclass",
  "C2: <other>.register(X) — role NOT conformance",
  "D: annotation names a file-local Protocol",
  "E: @implementer(...)",
  "F: isinstance(x, file-local Protocol)",
]
for (const k of order) {
  const h = rows[k]
  if (!h) { console.log(`${k.padEnd(48)} 0 occurrences, 0 files`); continue }
  console.log(`${k.padEnd(48)} ${String(h.n).padStart(6)} occurrences in ${String(h.files.size).padStart(4)} files`)
  for (const e of h.examples) console.log(`      ${e}`)
}
// ---------------------------------------------------------------- adjudication
//
// The ruling "implements is RULED because `extends` already carries every site" is
// only worth anything if it is CHECKED against the production analyzer rather than
// argued. So every file this probe found an interface-shaped site in is re-run through
// getParser -> parse -> analyze, and the interface-shaped sites are looked up in what
// the analyzer ACTUALLY emitted.
console.log(`\nADJUDICATION — the production analyzer over the ${adjudicate.size} files this probe found an interface-shaped site in`)
let adjParsed = 0
const siteTotals = new Map<string, number>()
const siteAlready = new Map<string, number>()
const siteExamples: string[] = []
for (const label of [...adjudicate].sort()) {
  const abs = join(CORPUS, label)
  let content = ""
  try { content = readFileSync(abs, "utf8") } catch { continue }
  let res
  try {
    const pr = await parser.parse(content, abs)
    res = analyzer.analyze(pr.rootNode, content, abs)
  } catch { continue }
  adjParsed++
  const emitted = new Set<string>()
  for (const r of res.relationships || []) {
    const t = r.relationshipType ?? r.type
    if (t) emitted.add(`${t}\u0000${r.source}\u0000${r.target}`)
  }
  // Re-derive the sites on the SAME tree the probe used and ask: is each one already
  // a published edge?
  const { root: r0, bases: b0, ifaces: i0 } = tables.get(label)!
  const re = (n: Node, inClass: string | null): void => {
    if (n.type === "class_definition") {
      const nm = namedChildOfType(n, "identifier")?.text ?? "?"
      for (const leaf of b0.get(nm) ?? []) {
        if (!i0.has(leaf) && !PROTOCOL_LEAVES.has(leaf) && !ABC_LEAVES.has(leaf)) continue
        const row = i0.has(leaf) ? "G file-local-interface base" : "H interface-NAME base"
        siteTotals.set(row, (siteTotals.get(row) ?? 0) + 1)
        if (emitted.has(`extends\u0000${nm}\u0000${leaf}`)) {
          siteAlready.set(row, (siteAlready.get(row) ?? 0) + 1)
        } else if (siteExamples.length < 12) {
          siteExamples.push(`${label}: ${nm}(${leaf}) NOT published as extends`)
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) re(c, nm)
      }
      return
    }
    if (n.type === "call") {
      const fn = n.namedChild(0)
      const lf = calleeLeaf(fn)
      if (lf === "register" && fn?.type === "attribute") {
        const owner = calleeLeaf(fn.namedChild(0))
        if (owner === "ABC" || owner === "ABCMeta") {
          siteTotals.set("C ABC.register(X)", (siteTotals.get("C ABC.register(X)") ?? 0) + 1)
        }
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) re(c, inClass)
    }
  }
  re(r0, null)
}
console.log(`  parsed ${adjParsed}/${adjudicate.size}`)
for (const [k, v] of [...siteTotals.entries()].sort()) {
  const already = siteAlready.get(k)
  console.log(`  ${k.padEnd(32)} ${String(v).padStart(4)} sites, already published as an extends edge: ${already === undefined ? "n/a (not a base-list site)" : already}`)
}
for (const e of siteExamples) console.log(`      MISSING: ${e}`)

console.log(`\nSTRUCTURAL CONFORMANCE (the one python construct extends cannot carry)`)
console.log(`  file-local Protocol declarations          : ${protoDecls}`)
console.log(`  ...in files declaring another class too     : ${protoDeclsWithOtherClass}`)
console.log(`  (P, C) pairs in ONE file, C not inheriting P, C declaring every name P declares: ${completeImpls}`)
console.log(`  those pairs by the SIZE OF P's member set (0 = vacuous, P asks for nothing):`)
for (const [k, v] of [...implsByPSize.entries()].sort((a, b) => a[0] - b[0])) console.log(`    |members(P)| = ${String(k).padStart(2)} : ${v} pairs`)
for (const e of implExamples) console.log(`      ${e}`)

console.log(`\n.register() RECEIVER-LEAF HISTOGRAM (the role filter, auditable):`)
for (const [k, v] of [...regReceiver.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(28)} ${v}`)
console.log(`\nRows A..F are the constructs that could carry an interface-conformance fact in python.`)
console.log(`A count of 0 on a row is a POSITIVE measurement of absence: it was counted on the`)
console.log(`parse tree, so a string literal or a comment cannot have produced it.`)