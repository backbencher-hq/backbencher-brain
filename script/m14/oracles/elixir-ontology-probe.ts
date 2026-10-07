/**
 * ELIXIR_EXPORTS — ontology probe, part 1: what the LANGUAGE has.
 *
 * This tool asks one question of the pinned grammar and the real corpus, and it
 * asks it of the TREE, never of source text. Every count below is produced by
 * walking `web-tree-sitter` nodes: no regular expression appears in this file,
 * and every name test is a char-code / prefix comparison or a `Set` lookup.
 *
 * It exists because the ontology contract (docs/analyzers/ONTOLOGY-WORKSTREAM.md
 * §"RULED") requires a measurement before any ruling: absence without a
 * measurement is a defect, and so is presence without one. Four of the ten
 * relationship types were silent for elixir at handover (extends, uses, exports,
 * overrides) and the workstream's founding failure — `overrides` ruled on prose
 * for a whole wave — is exactly what this instrument is the answer to.
 *
 * The probes, and the type each one would justify:
 *
 *   probe                construct sought        type it would feed
 *   -------------------- ------------------------ ----------------------------------
 *   heritage node types  a type-level subtype node `extends`
 *   heritage clauses     `defmodule X < Y`         `extends`
 *   defoverridable       Kernel.defoverridable     `overrides`
 *   use                  Kernel.use / mixin        `uses`
 *   import               Kernel.import             imports[] channel
 *   export surface       public def/defmacro/...   `exports`
 *
 * CLI: npx tsx script/m14/oracles/elixir-ontology-probe.ts [--repo=elixir]
 */
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = process.env.BB_LANE_ROOT ?? path.resolve(process.cwd())
const CORPUS = process.env.BB_CORPUS ?? "$HOME/fixtures/repositories"
const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3)
const REPOS = (arg("repo") ?? "elixir").split(",").filter(Boolean)

/** node types / fields whose NAME would denote a type-level subtype/supertype
 *  relation. Compared with `indexOf`, never with a pattern. */
const HERITAGE_WORDS = ["extend", "inherit", "superclass", "subclass", "super_type", "ancestor", "implements_clause"]
function namesHeritage(name: string): string | null {
  const lower = name.toLowerCase()
  for (const w of HERITAGE_WORDS) if (lower.indexOf(w) !== -1) return w
  return null
}

/** Definition forms and their PUBLIC-ness, from Kernel's own docs: `def`,
 *  `defmacro`, `defguard`, `defdelegate` and `defexception` publish; `defp`,
 *  `defmacrop`, `defguardp` do not. Kept as literal Sets — no pattern matching. */
const PUBLIC_DEFS = new Set(["def", "defmacro", "defguard", "defdelegate", "defexception"])
const PRIVATE_DEFS = new Set(["defp", "defmacrop", "defguardp"])
const DEF_FORMS = new Set([...PUBLIC_DEFS, ...PRIVATE_DEFS])

function walkFiles(dir: string, out: string[] = []): string[] {
  let ents: fs.Dirent[]
  try { ents = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of ents) {
    if ([".git", "_build", "deps", "node_modules"].indexOf(e.name) !== -1) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walkFiles(p, out)
    else if (e.name.endsWith(".ex") || e.name.endsWith(".exs")) out.push(p)
  }
  return out
}

/** Deterministic sample: sort, then take every stride-th file. A function of the
 *  file list alone, so two runs at the same NFILES are the same file set. */
function pick(files: string[], n: number): string[] {
  const sorted = [...files].sort()
  if (n <= 0 || n >= sorted.length) return sorted
  const step = sorted.length / n
  const out: string[] = []
  for (let i = 0; i < n; i++) out.push(sorted[Math.floor(i * step)]!)
  return [...new Set(out)]
}

interface Counter { [k: string]: number }
function bump(c: Counter, k: string, by = 1) { c[k] = (c[k] ?? 0) + by }

async function main() {
  const wts: any = await import("web-tree-sitter")
  const ParserClass = wts.Parser ?? wts.default ?? wts
  const Language = wts.Language ?? wts.default?.Language
  const coreWasm = path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm")
  await ParserClass.init({ locateFile: () => coreWasm })

  // --- the grammar oracle, read out of the PINNED wasm (L2 precondition) ----
  const grammar = await Language.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-elixir.wasm")))
  const nodeTypes: string[] = []
  const fields: string[] = []
  for (let i = 0; i < grammar.nodeTypeCount; i++) {
    const n = grammar.nodeTypeForId(i)
    if (n != null) nodeTypes.push(n)
  }
  for (let i = 0; i <= grammar.fieldCount; i++) {
    const f = grammar.fieldNameForId(i)
    if (f) fields.push(f)
  }
  const heritageTypes = nodeTypes.map((n) => [n, namesHeritage(n)] as const).filter((p) => p[1] !== null)
  const heritageFields = fields.map((n) => [n, namesHeritage(n)] as const).filter((p) => p[1] !== null)
  console.log(`grammar: wasm/tree-sitter-elixir.wasm  nodeTypeCount=${nodeTypes.length} fieldCount=${fields.length}`)
  console.log(`heritage-named node types: ${heritageTypes.length === 0 ? "NONE" : heritageTypes.map((p) => `${p[0]}(${p[1]})`).join(" ")}`)
  console.log(`heritage-named fields:     ${heritageFields.length === 0 ? "NONE" : heritageFields.map((p) => `${p[0]}(${p[1]})`).join(" ")}`)

  const parser = new ParserClass()
  parser.setLanguage(grammar)

  // --- SELF-TEST: every probe must be able to report NON-ZERO ----------------
  // A census that reports 0 is only evidence if the same code path reports > 0
  // on a snippet that DOES carry the construct. This is the Rust defect recorded
  // in ONTOLOGY-PROGRESS.md ("a census that reported 0 files for every type"),
  // and the elixir heritage probe is exactly the shape that could hide it: the
  // first version of `overridableForm` read `namedChild(0)` — the `identifier`
  // that names the macro — and reported "empty" for all 26 real sites.
  if (process.argv.includes("--selftest")) {
    const cases: { label: string; src: string; probe: (root: any) => number }[] = [
      { label: "heritage clause <", src: "defmodule Child < Parent do\nend\n", probe: (r) => heritageClauseCount(r) },
      { label: "defoverridable keywords", src: "defmodule M do\n  def f(a, b), do: :ok\n  defoverridable f: 2\nend\n", probe: (r) => defoverridableCount(r) },
      { label: "defoverridable module", src: "defmodule M do\n  defoverridable Other.Mod\nend\n", probe: (r) => defoverridableCount(r) },
      { label: "use", src: "defmodule M do\n  use GenServer\nend\n", probe: (r) => directiveCount(r, "use") },
      { label: "import", src: "defmodule M do\n  import Enum, only: [map: 2]\nend\n", probe: (r) => directiveCount(r, "import") },
      { label: "exportable def", src: "defmodule M do\n  def f(a), do: a\n  defp g(a), do: a\nend\n", probe: (r) => defFormCount(r) },
    ]
    console.log("\n--- self-test: does each probe report non-zero on a snippet that HAS the construct?")
    let allOk = true
    for (const c of cases) {
      const t = parser.parse(c.src)
      const n = c.probe(t.rootNode)
      const ok = n > 0
      if (!ok) allOk = false
      console.log(`  ${ok ? "OK  " : "FAIL"} ${c.label.padEnd(26)} probe=${n}${t.rootNode.hasError ? "  (parse had an ERROR node)" : ""}`)
    }
    console.log(`self-test ${allOk ? "PASS" : "FAIL"} — a FAIL means the 0s below are meaningless`)
    if (!allOk) process.exit(1)
  }

  for (const repo of REPOS) {
    const dir = path.join(CORPUS, repo)
    const files = pick(walkFiles(dir), Number(process.env.NFILES ?? 0))
    if (!files.length) { console.log(`\n${repo}: NO FILES under ${dir}`); continue }

    const tally: Record<string, Counter> = {
      heritageNodes: {}, heritageClauses: {}, defoverridable: {}, use: {}, import: {}, alias: {}, require: {},
      exportableDefs: {}, privateDefs: {}, defstruct: {}, defprotocol: {}, defimpl: {}, behaviour: {},
    }
    const filesWith: Record<string, Set<string>> = {
      defoverridable: new Set(), use: new Set(), import: new Set(), exportableDefs: new Set(),
      heritageNodes: new Set(), heritageClauses: new Set(), defimpl: new Set(), defprotocol: new Set(),
    }
    const samples: Record<string, string[]> = { defoverridable: [], use: [], import: [], heritageClauses: [], heritageNodes: [] }
    let errorFiles = 0, parsed = 0

    for (const f of files) {
      const src = fs.readFileSync(f, "utf8")
      let tree: any
      try { tree = parser.parse(src) } catch { errorFiles++; continue }
      const root = tree.rootNode
      if (root.hasError) errorFiles++
      parsed++
      const rel = path.relative(dir, f)

      // Iterative walk — one cursor-like stack, no recursion depth risk.
      const stack: any[] = [root]
      while (stack.length > 0) {
        const n = stack.pop()!
        const hit = namesHeritage(n.type)
        if (hit) {
          bump(tally.heritageNodes, `${n.type} :: ${hit}`)
          filesWith.heritageNodes!.add(rel)
          if (samples.heritageNodes!.length < 6) samples.heritageNodes!.push(`${rel}:${n.startPosition.row + 1} ${n.type}`)
        }
        if (n.type === "call") {
          const idNode = firstIdentifier(n)
          const id = idNode ? idNode.text : ""
          if (id === "defmodule") {
            // A heritage clause would be a `<` (or `extends`) binary operator
            // in the module head's arguments. Count the `<` operator nodes there.
            for (const lt of ltOperatorsInModuleHead(n)) {
              bump(tally.heritageClauses, lt)
              filesWith.heritageClauses!.add(rel)
              if (samples.heritageClauses!.length < 6) samples.heritageClauses!.push(`${rel}:${lt}`)
            }
          }
          if (id === "defoverridable") {
            const form = overridableForm(n)
            bump(tally.defoverridable, form)
            filesWith.defoverridable!.add(rel)
            if (samples.defoverridable!.length < 10) samples.defoverridable!.push(`${rel}:${n.startPosition.row + 1} ${form}`)
          } else if (id === "use") { bump(tally.use, "use"); filesWith.use!.add(rel); if (samples.use!.length < 5) samples.use!.push(`${rel}:${n.startPosition.row + 1}`) }
          else if (id === "import") { bump(tally.import, "import"); filesWith.import!.add(rel); if (samples.import!.length < 5) samples.import!.push(`${rel}:${n.startPosition.row + 1}`) }
          else if (id === "alias") bump(tally.alias, "alias")
          else if (id === "require") bump(tally.require, "require")
          else if (id === "defstruct") bump(tally.defstruct, "defstruct")
          else if (id === "defprotocol") { bump(tally.defprotocol, "defprotocol"); filesWith.defprotocol!.add(rel) }
          else if (id === "defimpl") { bump(tally.defimpl, "defimpl"); filesWith.defimpl!.add(rel) }
          else if (PUBLIC_DEFS.has(id)) bump(tally.exportableDefs, id)
          else if (PRIVATE_DEFS.has(id)) bump(tally.privateDefs, id)
        }
        if (n.type === "unary_operator" && n.child(0) && n.child(0).text === "@") {
          const v = n.child(1)
          if (v && v.type === "call") {
            const a = firstIdentifier(v)
            if (a && (a.text === "behaviour" || a.text === "behavior")) bump(tally.behaviour, a.text)
          }
        }
        for (let i = n.namedChildCount - 1; i >= 0; i--) { const c = n.namedChild(i); if (c) stack.push(c) }
      }
    }

    console.log(`\n=== corpus ${repo}: ${parsed} files parsed (${files.length} sampled), ${errorFiles} with a parse error`)
    for (const key of ["heritageNodes", "heritageClauses", "defoverridable", "use", "import", "alias", "require", "exportableDefs", "privateDefs", "defstruct", "defprotocol", "defimpl", "behaviour"]) {
      const counts = tally[key]
      const total = Object.values(counts).reduce((a, b) => a + b, 0)
      const nf = filesWith[key] ? (filesWith[key] as Set<string>).size : "-"
      console.log(`  ${key.padEnd(16)} total=${String(total).padStart(5)}  files=${String(nf).padStart(4)}  ${JSON.stringify(counts)}`)
    }
    for (const key of ["heritageNodes", "heritageClauses", "defoverridable", "use", "import"]) {
      if (samples[key]!.length) console.log(`  samples ${key}: ${samples[key]!.join("  ")}`)
    }
  }
}

function firstIdentifier(call: any): any {
  return firstChildOfType(call, "identifier")
}

function firstChildOfType(n: any, type: string): any {
  for (let i = 0; i < n.childCount; i++) {
    const c = n.child(i)
    if (c && c.type === type) return c
  }
  return null
}

/** --- the probe bodies, exposed so the self-test can call the SAME functions
 *  the corpus walk calls. A self-test against a copy is not a self-test. --- */
function eachNode(root: any, fn: (n: any) => void) {
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    fn(n)
    for (let i = n.namedChildCount - 1; i >= 0; i--) { const c = n.namedChild(i); if (c) stack.push(c) }
  }
}
function heritageClauseCount(root: any): number {
  let count = 0
  eachNode(root, (n) => {
    if (n.type !== "call") return
    const id = firstIdentifier(n)
    if (id && id.text === "defmodule") count += ltOperatorsInModuleHead(n).length
  })
  return count
}
function defoverridableCount(root: any): number {
  let count = 0
  eachNode(root, (n) => {
    if (n.type !== "call") return
    const id = firstIdentifier(n)
    if (id && id.text === "defoverridable") count++
  })
  return count
}
function directiveCount(root: any, name: string): number {
  let count = 0
  eachNode(root, (n) => {
    if (n.type !== "call") return
    const id = firstIdentifier(n)
    if (id && id.text === name) count++
  })
  return count
}
function defFormCount(root: any): number {
  let count = 0
  eachNode(root, (n) => {
    if (n.type !== "call") return
    const id = firstIdentifier(n)
    if (id && PUBLIC_DEFS.has(id.text)) count++
  })
  return count
}

/** Every `<` operator token inside a defmodule head's own arguments (not its
 *  body): the only spelling Elixir could give a supertype clause if it had one. */
function ltOperatorsInModuleHead(node: any): string[] {
  const out: string[] = []
  const args = firstChildOfType(node, "arguments")
  if (!args) return out
  const stack: any[] = [args]
  let depth = 0
  while (stack.length > 0 && depth < 64) {
    const n = stack.pop()!
    depth++
    if (n.type === "do_block") continue
    if (n.type === "binary_operator") {
      const op = firstAnonymous(n)
      if (op && op.text === "<") out.push(`${node.startPosition.row + 1}:defmodule < ${op.text}`)
      else if (op && (op.text === "extends" || op.text === "<:")) out.push(`${node.startPosition.row + 1}:defmodule ${op.text}`)
    }
    for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) stack.push(c) }
  }
  return out
}

function firstAnonymous(n: any): any {
  for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c && !c.isNamed) return c }
  return null
}

/** Which SIDE of `defoverridable` was written: the keyword form (`f: 2`), a
 *  list of them (`[f: 2]`), the MODULE form (`defoverridable Other.Mod`), or
 *  something else. Read off node types, never off the argument text. */
function overridableForm(n: any): string {
  // The arguments child is FOUND BY TYPE. `namedChild(0)` is the `identifier`
  // that names the macro — measured: `namedChildCount 2` on the call and
  // `namedChild(0) -> identifier`, so an index-0 read walks the wrong subtree
  // and every form reads "empty". A census that reports 0 because it walked the
  // wrong node is the defect ONTOLOGY-PROGRESS records for Rust.
  const args = firstChildOfType(n, "arguments")
  if (!args) return "no-arguments"
  const inner = args.namedChildCount > 0 ? args.namedChild(0) : null
  if (!inner) return "empty"
  if (inner.type === "alias") return "module"
  if (inner.type === "keywords") return "keywords"
  if (inner.type === "list") {
    for (let i = 0; i < inner.namedChildCount; i++) { const c = inner.namedChild(i); if (c && c.type === "keywords") return "list-of-keywords" }
    return "list-other"
  }
  return `other:${inner.type}`
}

main().catch((e) => { console.error(String(e && e.stack ? e.stack : e)); process.exit(1) })