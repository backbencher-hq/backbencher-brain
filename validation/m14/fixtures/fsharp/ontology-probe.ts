/**
 * F# ONTOLOGY PROBE — the two instruments the workstream names, for the types this
 * lane does not emit.
 *
 * The ontology workstream is explicit that a text regex is the WRONG instrument, and
 * it gives the two that are right:
 *
 *   A: GRAMMAR INVENTORY — enumerate every node type the grammar actually produces
 *      across the corpus and show none expresses the construct. Positive evidence of
 *      absence, and a fact about the grammar rather than about a failed search.
 *   B: PARSE-TREE COUNT — for a construct the language CAN express, count it on the
 *      tree, where a string literal or a comment cannot fake it.
 *
 * Both run here over the WHOLE admitted corpus (6,619 files), not the 400-file census
 * draw, so a ruling or a GAP rests on the full population.
 *
 * STREAMING IS A MEASURED REQUIREMENT, not a style choice. The first version read all
 * 6,619 admitted bodies into one array before walking any of them — up to 512 KB each,
 * so ~1.6 GB of source plus every parse tree — and was OOM-killed on a 15 GB box with
 * other lanes resident. It produced three lines of output and no measurement, which is
 * the failure mode this project cares most about: an instrument that dies silently and
 * is mistaken for an instrument that found nothing. So the walk holds ONE file at a
 * time, and `walked` / `skipped` are reported as numbers.
 *
 * READ-ONLY. Writes nothing unless BB_FSHARP_PROBE_JSON names a file.
 *
 *   npx tsx validation/m14/fixtures/fsharp/ontology-probe.ts
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const LANG = "fsharp"

/** Metadata only. The body is read at walk time and dropped immediately after. */
function admitted(): { rel: string; abs: string }[] {
  const out: { rel: string; abs: string }[] = []
  for (const e of readdirSync(CR).sort()) {
    const dir = path.join(CR, e)
    try {
      if (!statSync(dir).isDirectory()) continue
      execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
    } catch { continue }
    let tracked: string[]
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
        encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
      }).split("\0").filter(Boolean)
    } catch { continue }
    for (const rel of tracked) {
      const abs = path.join(dir, rel)
      let size: number
      try { size = statSync(abs).size } catch { continue }
      if (size > 512 * 1024) continue
      if (detectLanguageFromPath(abs) !== LANG) continue
      out.push({ rel: `${e}/${rel}`, abs })
    }
  }
  return out
}

const files = admitted()
console.log(`fsharp ontology probe`)
console.log(`corpus: ${files.length} admitted files (whole population, not a draw)\n`)

const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-fsharp.wasm"))))

// ---------------------------------------------------------------- INSTRUMENT A
// Every node type the grammar actually produces, over the whole corpus. This is the
// evidence that decides whether a construct EXISTS in the language at all.
const inventory = new Map<string, number>()
const fileHasNode = new Map<string, Set<string>>()
/**
 * The walk is ITERATIVE, and that is a measured requirement rather than a style choice:
 * a recursive `walk(n)` overflows the JS stack on at least one corpus file. The
 * production analyzer hit the same wall independently — the 400-file census logged
 *
 *     [WARN] analyzer timeout, returning basic parse result
 *     {"filePath":"…/tests/fsharp/typecheck/overloads/neg_interface_generics.fsx",
 *      "error":"Maximum call stack size exceeded"}
 *
 * — so a recursive probe would have died on the file the analyzer itself already
 * reports, and dying on it would have been a silent hole in the census rather than a
 * counted one. `walkSkipped` is reported at the end for the same reason: silence is
 * guilt, and a file that is not walked must be a number, not a gap.
 */
const walkSkipped: { file: string; error: string }[] = []
let walked = 0
for (const f of files) {
  let text: string
  try { text = readFileSync(f.abs, "utf8") } catch { walkSkipped.push({ file: f.rel, error: "unreadable" }); continue }
  let t: any
  try { t = parser.parse(text) } catch (e: any) { walkSkipped.push({ file: f.rel, error: String(e?.message ?? e) }); continue }
  if (!t) { walkSkipped.push({ file: f.rel, error: "parse returned no tree" }); continue }
  try {
    const seen = new Set<string>()
    const stack: any[] = [t.rootNode]
    while (stack.length > 0) {
      const n = stack.pop()
      inventory.set(n.type, (inventory.get(n.type) ?? 0) + 1)
      if (!seen.has(n.type)) {
        seen.add(n.type)
        let s = fileHasNode.get(n.type)
        if (!s) { s = new Set(); fileHasNode.set(n.type, s) }
        s.add(f.rel)
      }
      for (let i = 0; i < n.childCount; i++) stack.push(n.child(i))
    }
    walked++
  } catch (e: any) {
    walkSkipped.push({ file: f.rel, error: String(e?.message ?? e) })
  }
  t.delete?.()
}
console.log(`instrument A walked ${walked}/${files.length} files; ${walkSkipped.length} skipped`)
for (const s of walkSkipped.slice(0, 5)) console.log(`  skipped ${s.file}: ${s.error}`)
const sortedInv = [...inventory.entries()].sort((a, b) => b[1] - a[1])
console.log(`INSTRUMENT A — grammar inventory`)
console.log(`${sortedInv.length} distinct node types produced across ${walked} files:\n`)
for (const [ty, n] of sortedInv) {
  console.log(`  ${ty.padEnd(30)} ${String(n).padStart(10)}  in ${String(fileHasNode.get(ty)?.size ?? 0).padStart(5)} files`)
}

// What the three un-emitted types would need the grammar to HAVE.
console.log(`\nINSTRUMENT A — node types each un-emitted type would require, checked against the inventory:`)
const WOULD_MEAN: Record<string, string[]> = {
  // An import is a name-binding or resource directive. F# spells `open X` as import_decl,
  // `open type X` as the SAME node with an `type` token, an aliased module as
  // module_abbrev, and `#r`/`#load`/`#I` as fsi_directive_decl.
  imports: ["import_decl", "module_abbrev", "fsi_directive_decl", "open_statement", "open_decl", "using_statement"],
  // An export LIST (`module M (a, b)`) is the haskell shape. F# has no such syntax, so the
  // question is whether the GRAMMAR can express an export DECLARATION at all. The candidate
  // names are listed so the check is a measurement and not an assertion; `access_modifier`
  // is listed as the ADJACENT construct that does exist, because `internal`/`private` is the
  // only surface restriction F# has and it is a modifier on a declaration, not an export.
  exports: ["export_list", "module_export", "export_spec", "export_declaration", "export_stmt", "exported_item"],
  // A `uses` edge needs a construct that names a type or member WITHOUT calling, inheriting,
  // implementing or declaring it. `attribute` is the candidate: `[<Struct>]` applies a type as
  // a marker without invoking it. `access_modifier` is listed as the adjacent construct that
  // exists and is deliberately NOT an export declaration.
  uses: ["attribute", "attributes", "interface_implementation", "type_attribute", "access_modifier"],
  // The adjacency report: constructs that DO exist and are already read by the lane, so a
  // reader can see what was excluded from the exports ruling rather than take it on trust.
  adjacent_to_exports: ["access_modifier", "module_val_declaration", "type_definition"],
}
for (const [t, wants] of Object.entries(WOULD_MEAN)) {
  const present = wants.filter((w) => inventory.has(w))
  const absent = wants.filter((w) => !inventory.has(w))
  console.log(`  ${t.padEnd(20)} PRESENT: ${present.length ? present.join(", ") : "(none)"}`)
  console.log(`  ${"".padEnd(20)} ABSENT:  ${absent.join(", ")}`)
}

/**
 * PASS 2 — the `exports` ruling's overturn condition, WIDENED so it is a search rather
 * than a list somebody chose.
 *
 * Pass 1's ruling named six candidate node types and found all six absent. That is only as
 * strong as the six, so this asks the INVENTORY the open question instead: which node types
 * the grammar produces at all whose name mentions an export surface — `export`, `visib`,
 * `surface`, `signature`, `open`, `access`? A non-empty answer would overturn the ruling
 * without anybody having to guess a name in advance, and an empty one is positive evidence
 * over the same 353-node inventory rather than over a hand-written list.
 */
console.log(`\nINSTRUMENT A (pass 2) — the exports ruling re-derived as a SEARCH over the inventory:`)
const SURFACE_WORDS = ["export", "visib", "surface", "signature", "access", "open", "restrict", "intern"]
const surfaceHits: { node: string; occurrences: number; files: number }[] = []
for (const [ty, n] of sortedInv) {
  const lower = ty.toLowerCase()
  const word = SURFACE_WORDS.find((w) => lower.includes(w))
  if (word) surfaceHits.push({ node: ty, occurrences: n, files: fileHasNode.get(ty)?.size ?? 0 })
}
for (const h of surfaceHits) {
  const isExportDeclaration = /export/.test(h.node)
  console.log(`  ${h.node.padEnd(30)} ${String(h.occurrences).padStart(9)}  in ${String(h.files).padStart(5)} files  (matched "${SURFACE_WORDS.find((w) => h.node.toLowerCase().includes(w))}")${isExportDeclaration ? "  <-- EXPORT SURFACE" : ""}`)
}
console.log(`  node types matching an export-surface word: ${surfaceHits.length}; of those, an export DECLARATION: ${surfaceHits.filter((h) => /export/.test(h.node)).length}`)
console.log(`  every node type the grammar can produce whose name contains "export": ${[...inventory.keys()].filter((k) => k.toLowerCase().includes("export")).join(", ") || "(none)"}`)

// ---------------------------------------------------------------- INSTRUMENT B
// Parse-tree semantic counts, over the whole corpus.
type Count = { occurrences: number; files: number; examples: string[] }
/**
 * A first version counted `files` by "an example string I have not seen", which made the
 * column a count of DISTINCT SPELLINGS rather than a count of FILES: `import_decl`
 * reported "in 702 files" while the same node type appears in 2,540 files by
 * `fileHasNode`. Both numbers are real and they are different questions, so both are kept
 * and the file count is now taken from a per-key Set of file labels.
 */
const counts: Record<string, Count> = {}
const countFiles = new Map<string, Set<string>>()
const bump = (key: string, file: string, ex: string) => {
  const c = (counts[key] ??= { occurrences: 0, files: 0, examples: [] })
  c.occurrences++
  let fs = countFiles.get(key)
  if (!fs) { fs = new Set(); countFiles.set(key, fs) }
  if (!fs.has(file)) { fs.add(file); c.files = fs.size }
  if (!c.examples.includes(ex) && c.examples.length < 3) c.examples.push(ex)
}
const text = (n: any) => (n?.text ?? "").replace(/\s+/g, " ").trim()
const namedKids = (n: any) => { const o: any[] = []; for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) o.push(c) } return o }
const hasToken = (n: any, tok: string) => { for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c && !c.isNamed && c.type === tok) return true } return false }

/** An import DIRECTIVE: `open X`, `open type X`. The grammar's `import_decl` is BOTH. */
const isImportDirective = (n: any): string | null => {
  if (n.type === "import_decl") return text(namedKids(n)[0] ?? n)
  return null
}

/** An ALIASED MODULE: `module X = Y` — F#'s other import form, and the only one that names
 *  a path outside the compilation. */
const isModuleAlias = (n: any): string | null => {
  if (n.type !== "module_abbrev") return null
  const path = namedKids(n).filter((c: any) => c.type === "long_identifier" || c.type === "identifier").pop()
  return path ? text(path) : null
}

/**
 * A RESOURCE DIRECTIVE: `#r "…"` / `#load "…"` / `#I "…"`.
 *
 * The grammar's `fsi_directive_decl` covers six keywords, and only three of them name a
 * resource — `#time`, `#help` and `#quit` are REPL controls that touch nothing outside the
 * file. Counting all six would report an import the language never performs, so the keyword
 * is read off the tree (`#` + the keyword token) and the three non-resource forms are refused.
 */
const isResourceDirective = (n: any): string | null => {
  if (n.type !== "fsi_directive_decl") return null
  let keyword = ""
  for (let i = 0; i < n.childCount; i++) {
    const c = n.child(i)
    if (c && !c.isNamed) { keyword = c.text; break }
  }
  if (keyword !== "#r" && keyword !== "#load" && keyword !== "#I") return null
  const arg = namedKids(n)[0]
  if (!arg || (arg.type !== "string" && arg.type !== "verbatim_string")) return null
  return `${keyword} ${text(arg)}`
}

/**
 * An ATTRIBUTE APPLICATION — `[<Struct>]`, `[<Obsolete("x")>]`, `[<assembly: …>]`.
 *
 * This is the construct a `uses` edge is FOR: it names a type, applies it as a marker, and
 * never invokes it. `attribute` is `seq(optional(seq(field("target", identifier), ":")),
 * _object_construction)`, so the name is the type of the object construction — read from
 * the node, never matched against a string.
 */
const attributeApplication = (n: any): string | null => {
  if (n.type !== "attribute") return null
  const target = n.childForFieldName?.("target")
  const kids = namedKids(n).filter((c: any) => c !== target)
  const first = kids[0]
  if (!first) return null
  // the name-bearing node inside the attribute's type: walk the same wrapper chain the
  // declared-type pass walks, so both lanes agree on what a wrapper denotes
  let cur: any = first
  for (let guard = 0; guard < 8 && cur; guard++) {
    if (cur.type === "identifier") return `${target ? `${text(target)}:` : ""}${text(cur)}`
    if (cur.type === "long_identifier" || cur.type === "long_identifier_or_op") {
      let leaf: any = null
      for (let i = 0; i < cur.namedChildCount; i++) {
        const c = cur.namedChild(i)
        if (c && (c.type === "identifier" || c.type === "long_identifier")) leaf = c
      }
      const nm = text(leaf ?? cur)
      return nm ? `${target ? `${text(target)}:` : ""}${nm}` : null
    }
    let next: any = null
    for (let i = 0; i < cur.namedChildCount; i++) {
      const c = cur.namedChild(i)
      if (c && (c.type === "simple_type" || c.type === "static_type" || c.type === "postfix_type" ||
                c.type === "generic_type" || c.type === "paren_type" || c.type === "long_identifier" ||
                c.type === "identifier" || c.type === "long_identifier_or_op")) { next = c; break }
    }
    if (!next) return null
    cur = next
  }
  return null
}

/** An `member _ : IFoo with …` constraint. ITERATIVE for the reason above. */
const interfaceConstrainedMember = (n: any): string | null => {
  if (n.type !== "member_signature" && n.type !== "member_defn") return null
  // the constraint is a TYPE_WRAPPER written directly under the member
  const wrappers = ["simple_type", "static_type", "postfix_type", "generic_type", "paren_type"]
  const found: any[] = []
  const stack: any[] = [[n, 0]]
  while (stack.length > 0) {
    const [x, d] = stack.pop()!
    if (d > 4) continue
    for (const c of namedKids(x)) {
      if (wrappers.includes(c.type)) found.push(c)
      else stack.push([c, d + 1])
    }
  }
  if (!found.length) return null
  if (!n.text.includes(" with ")) return null
  // `member _.P : int with get, set` is a PROPERTY with an explicit accessor list, and
  // it has the same shape as `member _ : IFoo with member …` — an inline interface
  // implementation. The two were counted together (1,339 occurrences), and the examples
  // the first version printed were `string`, `seq<ArgInfo>`, `LexBuffer<'char>`: plain
  // types, i.e. mostly properties. The grammar separates them: an accessor list is
  // `property_accessor` nodes, so a member carrying one is not an interface
  // implementation and is reported under its own key rather than in this one.
  let accessors = 0
  {
    const stack: any[] = [n]
    while (stack.length > 0) {
      const x = stack.pop()
      if (x.type === "property_accessor") accessors++
      for (const c of namedKids(x)) stack.push(c)
    }
  }
  if (accessors > 0) return null
  return found.map((w) => text(w)).join(", ")
}

/**
 * A module/namespace that DECLARES at least one member.
 *
 * This is NOT an export declaration and is reported as the adjacency number, not as a
 * probe result: in F# `module M` makes everything in M importable implicitly, so the
 * COUNT of such scopes is what an `exports` edge would enumerate — which is precisely why
 * an `exports` edge would carry nothing `contains` does not already carry.
 */
const scopeWithMembers = (n: any): string | null => {
  if (n.type !== "namespace" && n.type !== "named_module" && n.type !== "module_defn") return null
  let members = 0
  const stack: any[] = [n]
  while (stack.length > 0) {
    const x = stack.pop()
    if (x.type === "function_or_value_defn" || x.type === "member_defn" || x.type === "type_definition" ||
        x.type === "additional_constr_defn" || x.type === "module_val_declaration" || x.type === "exception_definition") members++
    for (const c of namedKids(x)) stack.push(c)
  }
  if (!members) return null
  return `${text(namedKids(n)[0] ?? n)} (${members} member decls)`
}

/**
 * An OPERATOR DECLARATION — `let (+) a b = …`, `let (>>=) a b = …`.
 *
 * TWO WRONG VERSIONS OF THIS PROBE, both instructive.
 *
 * The first looked for a `long_identifier_or_op` under the declaration's left, on the
 * reasoning that the grammar writes an operator name in that node. It does not: a
 * `long_identifier_or_op` is the node for a dotted NAME, so the probe caught every
 * ordinary binding and reported 84,148 "operator declarations", every printed example a
 * plain identifier (`fsprojPath`, `args`, `items`).
 *
 * The second refused backtick-quoted names by looking for a backtick in the text. It
 * correctly caught the backtick case — the grammar writes ``` ``type`` ``` as one
 * `identifier` token — but it removed the filter that was doing the work and the count
 * rose again.
 *
 * The grammar has a node for exactly this and it was the third reading: an operator
 * binding's name is an `op_identifier` child of the declaration's left, verified by
 * reading the tree for all four spellings —
 *
 *     let (+) a b = …   (function_declaration_left (op_identifier) (argument_patterns …))
 *     let f x = …      (function_declaration_left (identifier)      (argument_patterns …))
 *     let ``type`` x = …  (value_declaration_left (identifier_pattern (long_identifier_or_op (identifier))))
 *     let (|Even|Odd|) n = … (function_declaration_left (active_pattern (active_pattern_op_name) …))
 *
 * — so the discriminator asks for `op_identifier` and nothing else. No text test.
 */
const operatorDefinition = (n: any): string | null => {
  if (n.type !== "function_or_value_defn" && n.type !== "member_defn") return null
  const left = namedKids(n).find((c: any) => c.type === "function_declaration_left" || c.type === "value_declaration_left")
  if (!left) return null
  const op = namedKids(left).find((c: any) => c.type === "op_identifier")
  if (!op) return null
  const nm = text(op)
  return nm ? `${nm}  (${text(left).slice(0, 60)})` : null
}

/** A `base.X` access — the inherited member a derived type names without declaring it. */
const baseAccess = (n: any): string | null => {
  if (n.type !== "dot_expression") return null
  const lhs = namedKids(n)[0]
  if (!lhs) return null
  if (lhs.type === "long_identifier_or_op" && text(lhs) === "base") return text(n)
  if (lhs.type === "base_expression") return text(n)
  return null
}

const PROBES: [string, (n: any) => string | null][] = [
  ["imports: import_decl (`open X` / `open type X`)", isImportDirective],
  ["imports: module_abbrev (`module X = Y`)", isModuleAlias],
  ["imports: fsi_directive_decl `#r`/`#load`/`#I` (resource directives only)", isResourceDirective],
  ["exports-ADJACENCY: namespace/module declaring >=1 member (NOT an export declaration)", scopeWithMembers],
  ["uses: attribute application (`[<Struct>]`, `[<assembly: X>]`)", attributeApplication],
  ["implements-candidate: member with an interface constraint (`member _ : I`)", interfaceConstrainedMember],
  ["uses-candidate: operator definition (`let (+) a b`)", operatorDefinition],
  ["uses-candidate: `base.X` member access", baseAccess],
]

let bWalked = 0
for (const f of files) {
  let text_: string
  try { text_ = readFileSync(f.abs, "utf8") } catch { walkSkipped.push({ file: f.rel, error: "unreadable (pass B)" }); continue }
  let t: any
  try { t = parser.parse(text_) } catch (e: any) { walkSkipped.push({ file: f.rel, error: String(e?.message ?? e) }); continue }
  if (!t) { walkSkipped.push({ file: f.rel, error: "parse returned no tree (pass B)" }); continue }
  try {
    const stack: any[] = [t.rootNode]
    while (stack.length > 0) {
      const n = stack.pop()
      for (const [key, fn] of PROBES) {
        let ex: string | null = null
        try { ex = fn(n) } catch { ex = null }
        if (ex) bump(key, f.rel, ex)
      }
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) stack.push(c) }
    }
    bWalked++
  } catch (e: any) {
    walkSkipped.push({ file: f.rel, error: String(e?.message ?? e) })
  }
  t.delete?.()
}

console.log(`\nINSTRUMENT B — parse-tree semantic counts (whole corpus, ${files.length} files, ${bWalked} walked)`)
console.log("-".repeat(112))
for (const [key] of PROBES) {
  const c = counts[key]
  if (!c) { console.log(`  ${key.padEnd(76)} 0 occurrences`); continue }
  console.log(`  ${key.padEnd(76)} ${String(c.occurrences).padStart(7)} in ${String(c.files).padStart(5)} files`)
  for (const ex of c.examples.slice(0, 3)) console.log(`      e.g. ${ex.slice(0, 100)}`)
}

// ================================================================ PASS 2: ADVERSARIAL
//
// The pass-1 probes above ask whether a construct EXISTS. These ask the opposite question
// of the types this lane already emits, and they are the shape §2c of the workstream calls
// for when it says to do the six questions "adversarially": for each type, find a case
// where the label is WRONG. Each probe is a population, not a verdict — the verdict comes
// from cross-checking the population against the edges production `parseFile` actually
// emits, which is the CONFIRM phase at the bottom of this file.

/**
 * The pipe operators, and WHICH SIDE carries the callee. Mirrors
 * `PIPELINE_CALLEE_SIDE` in src/ast/real-fsharp-analyzer.ts — the probe and the rule must
 * agree on the language or the probe measures a different thing than the analyzer reads.
 * The composition operators are deliberately absent; they are counted by the
 * `composition-op` probe below so the exclusion is visible.
 */
const PIPE_OPS = new Map<string, "left" | "right">([
  ["|>", "right"], ["|>>", "right"], [">>=", "right"], ["<|", "left"], ["<<", "left"],
])
const COMPOSITION_OPS = new Set([">>", ">>>", ">=>", "<<<"])

/** A COMPOSITION operator: builds a function, calls neither. Never a `calls` edge. */
const compositionOp = (n: any): string | null => {
  if (n.type !== "infix_expression") return null
  for (let i = 0; i < n.childCount; i++) {
    const c = n.child(i)
    if (c && c.type === "infix_op" && COMPOSITION_OPS.has(c.text)) return `${c.text}  |${text(n).replace(/\s+/g, " ").slice(0, 50)}|`
  }
  return null
}

/** ITERATIVE ancestor search: `n.parent` up to the root, with a type predicate. */
const hasAncestor = (n: any, type: string): boolean => {
  let cur: any = n.parent
  while (cur) {
    if (cur.type === type) return true
    cur = cur.parent
  }
  return false
}
const hasAncestorAmong = (n: any, types: string[]): string | undefined => {
  let cur: any = n.parent
  while (cur) {
    if (types.includes(cur.type)) return cur.type
    cur = cur.parent
  }
  return undefined
}

/**
 * A1. `override` used to IMPLEMENT AN INTERFACE MEMBER — `interface I with override this.M()`.
 *
 * F# has no separate keyword for an interface member: `override` is what implements one,
 * exactly as in C#. So the token alone does not mean "overrides a base-class member", and
 * the lane's rule reads the token alone. The population is the members where the two are
 * distinguishable, which is why the discriminator is the `interface_implementation`
 * ANCESTOR rather than the token.
 */
const overrideInInterfaceImpl = (n: any): string | null => {
  if (n.type !== "member_defn") return null
  if (!hasToken(n, "override")) return null
  if (!hasAncestor(n, "interface_implementation")) return null
  const mop = namedKids(n).find((c: any) => c.type === "method_or_prop_defn")
  const nm = mop ? text(namedKids(mop)[0] ?? mop) : text(n)
  return `${nm.slice(0, 48)}   |${text(n).split("\n")[0]!.slice(0, 60)}`
}

/** A1-control. The same token with NO interface ancestor: a real base-class override. */
const overrideOutsideInterfaceImpl = (n: any): string | null => {
  if (n.type !== "member_defn") return null
  if (!hasToken(n, "override")) return null
  if (hasAncestor(n, "interface_implementation")) return null
  return text(n).split("\n")[0]!.slice(0, 60)
}

/**
 * A2. An `override` member whose enclosing type declares NO BASE — so the lane's
 * `baseTypes.get(owner)` is `undefined` and the emitted target is the member's OWN name.
 *
 * This is the measurement that decides whether A1 produces a self-targeted edge: with no
 * `inherit`, `overrides Owner.M -> M`, an edge asserting that a member overrides itself.
 */
const overrideWithNoBaseType = (n: any): string | null => {
  if (n.type !== "member_defn") return null
  if (!hasToken(n, "override")) return null
  const td = (() => {
    let cur: any = n.parent
    let found: any = undefined
    while (cur) {
      if (cur.type === "type_definition") found = cur
      cur = cur.parent
    }
    return found
  })()
  if (!td) return null
  let hasInherit = false
  const stack: any[] = [td]
  while (stack.length > 0) {
    const x = stack.pop()
    if (x.type === "class_inherits_decl") hasInherit = true
    for (const c of namedKids(x)) stack.push(c)
  }
  return hasInherit ? null : text(n).split("\n")[0]!.slice(0, 60)
}

/**
 * A3. A NAMED interface declaration — `type IFoo = interface IBar with … end`.
 *
 * This is F#'s ordinary way to write an interface that EXTENDS another, and the pinned
 * grammar does not read it: the `interface` keyword lands in an ERROR node, the interface
 * NAME is taken as a `union_type_case` of the interface itself, and the rest of the body
 * becomes a second ERROR. Three consequences for this lane, all measured below:
 *   * the type is classified from `union_type_defn`, so it is published as an ENUM;
 *   * the base interface name is published as an ENUM MEMBER of the interface;
 *   * NO `implements` edge exists for it, and the members inside the ERROR are not walked
 *     at all (the walk discloses a recovery region and does not descend).
 * The control below is the BARE interface form (`type KFoo = interface … end`), which the
 * grammar does read, so the two counts answer different questions and both are reported.
 */
const namedInterfaceDeclaration = (n: any): string | null => {
  if (n.type !== "union_type_defn") return null
  const tn = namedKids(n).find((c: any) => c.type === "type_name")
  const name = tn ? text(tn) : "?"
  // the swallowed shape: an ERROR carrying an `interface` keyword inside this union
  let swallowed: string | null = null
  const stack: any[] = [n]
  while (stack.length > 0) {
    const x = stack.pop()
    if (x.type === "ERROR" && hasToken(x, "interface")) { swallowed = name; break }
    for (const c of namedKids(x)) stack.push(c)
  }
  return swallowed ? `${swallowed}  (union_type_case + ERROR interface)` : null
}

/** A3-control. `interface_implementation` inside a CLASS body — read, and an `implements` edge. */
const interfaceImplInClassBody = (n: any): string | null => {
  if (n.type !== "interface_implementation") return null
  if (!hasAncestor(n, "anon_type_defn")) return null
  const t = namedKids(n).find((c: any) => c.type === "simple_type")
  return t ? text(t).slice(0, 60) : text(n).slice(0, 60)
}

/** A3-control-2. `interface_type_defn` — the BARE interface form, read by the grammar. */
const bareInterfaceDefinition = (n: any): string | null => {
  if (n.type !== "interface_type_defn") return null
  const tn = namedKids(n).find((c: any) => c.type === "type_name")
  return tn ? text(tn) : text(n).slice(0, 50)
}

/**
 * A4. An `application_expression` whose callee is ONE character long.
 *
 * The `calls` rule is gated on `fnName.length > 1`, which cannot tell a one-letter FUNCTION
 * (`let f x = …; f y`) from a one-character fragment, so a real call to a real published
 * symbol is dropped with no edge anywhere. The corpus's F# is full of `f`, `g`, `s`, `x`.
 * This is instrument B counting the population the gate refuses.
 */
const oneCharCallee = (n: any): string | null => {
  if (n.type !== "application_expression") return null
  const fn = namedKids(n)[0]
  if (!fn) return null
  const nm = text(fn)
  return nm.length === 1 ? `${nm}  |${text(n).slice(0, 50)}` : null
}

/**
 * A5. A file-level `import_decl` / `attribute` with no enclosing module, namespace or type:
 * exactly the population the lane sources to the literal string `Global`.
 *
 * `Global` is not a symbol — no file declares it — so an edge sourced there has an endpoint
 * that binds to nothing, and it is not the literal `unknown` either, so ledger rule R7 does
 * not catch it.
 */
const fileLevelDirective = (n: any): string | null => {
  if (n.type !== "import_decl" && n.type !== "attribute") return null
  if (hasAncestorAmong(n, ["module_defn", "named_module", "namespace", "type_definition", "object_expression"]))
    return null
  return `${n.type} ${text(n).slice(0, 50)}`
}

/**
 * A6. A BARE PIPELINE — `infix_expression` carrying a pipe `infix_op` token.
 *
 * The lane's doc claimed pipe `a |> List.map` reads as `map`, and it read one only when the
 * pipeline sat in CALLEE position (`f (x |> g)`). The shape F# is actually written in — a
 * `let` whose BODY is the pipeline — is an `infix_expression` that is not the first child of an
 * `application_expression`, and nothing descended into it for a callee. This probe splits the
 * population by exactly that fact, which is the discriminator the analyzer's own branch uses.
 *
 * The operator matters and is read off the `infix_op` TOKEN. The composition operators
 * (`>>` `>>>` `>=>` `<<<`) are counted separately because they build a function and call
 * neither: an edge from them would be a fabrication, so they are excluded from the label and
 * this probe reports them so the exclusion is visible rather than assumed.
 */
const pipelineInfix = (n: any): string | null => {
  if (n.type !== "infix_expression") return null
  let op = ""
  for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c && c.type === "infix_op") { op = c.text; break } }
  if (!PIPE_OPS.has(op)) return null
  const names = namedKids(n).filter(
    (c: any) => c.type === "long_identifier" || c.type === "identifier" || c.type === "long_identifier_or_op" || c.type === "dot_expression",
  )
  const side = PIPE_OPS.get(op)!
  const callee = side === "right" ? names[names.length - 1] : names[0]
  const tag = callee ? `callee=${text(callee).slice(0, 30)}` : "callee=NONE(lambda or literal)"
  const where = n.parent && n.parent.type === "application_expression" ? "READ-in-callee-position" : "DROPPED-bare"
  return `${op.padEnd(4)} ${where.padEnd(22)} ${tag}`
}

const ADVERSARIAL: [string, (n: any) => string | null][] = [
  ["A1 overrides-WRONG-LABEL: `override` implementing an INTERFACE member", overrideInInterfaceImpl],
  ["A1-control: `override` with no interface ancestor (a real base override)", overrideOutsideInterfaceImpl],
  ["A2 overrides-FABRICATED-TARGET: `override` in a type with NO base type", overrideWithNoBaseType],
  ["A3 implements-MISSED: named interface decl `type I = interface J with` mis-parsed", namedInterfaceDeclaration],
  ["A3-control: interface_implementation inside a CLASS body (read -> implements)", interfaceImplInClassBody],
  ["A3-control-2: bare `type I = interface ... end` (interface_type_defn)", bareInterfaceDefinition],
  ["A4 calls-DROPPED: application_expression with a ONE-character callee", oneCharCallee],
  ["A5 Global-SOURCE: file-level import_decl/attribute (no enclosing scope)", fileLevelDirective],
  ["A6 calls-DROPPED: a BARE pipeline (`infix_expression` + a pipe `infix_op`)", pipelineInfix],
  ["A6-control: a COMPOSITION operator (`>>` `>>>` `>=>` `<<<`) — calls neither", compositionOp],
]

// Files worth confirming against production `parseFile`, per adversarial probe.
const confirmCandidates = new Map<string, string[]>()
for (const [key] of ADVERSARIAL) confirmCandidates.set(key, [])
for (const f of files) {
  let text_: string
  try { text_ = readFileSync(f.abs, "utf8") } catch { continue }
  let t: any
  try { t = parser.parse(text_) } catch { continue }
  if (!t) continue
  try {
    const stack: any[] = [t.rootNode]
    while (stack.length > 0) {
      const n = stack.pop()
      for (const [key, fn] of ADVERSARIAL) {
        let ex: string | null = null
        try { ex = fn(n) } catch { ex = null }
        if (ex) {
          bump(key, f.rel, ex)
          const bag = confirmCandidates.get(key)!
          if (bag.length < 6 && !bag.includes(f.rel)) bag.push(f.rel)
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) stack.push(c) }
    }
  } catch { /* a tree that throws here is already counted in walkSkipped */ }
  t.delete?.()
}

console.log(`\nINSTRUMENT B (pass 2) — ADVERSARIAL populations for the types this lane emits`)
console.log("-".repeat(112))
for (const [key] of ADVERSARIAL) {
  const c = counts[key]
  if (!c) { console.log(`  ${key.padEnd(76)} 0 occurrences`); continue }
  console.log(`  ${key.padEnd(76)} ${String(c.occurrences).padStart(7)} in ${String(c.files).padStart(5)} files`)
  for (const ex of c.examples.slice(0, 3)) console.log(`      e.g. ${ex.slice(0, 100)}`)
}

// ---------------------------------------------------------------- CONFIRM via parseFile
// A population is not a defect. What makes A1/A2 a defect is the EDGE, so the probe drives
// production `parseFile` — not `analyze()` — over a bounded set of the files each probe hit
// and prints the relationships that actually come out, labelled per type.
console.log(`\nCONFIRM — production parseFile on up to 6 files per adversarial probe (bounded, stated)`)
const { parseFile } = await import("../../../../src/ast/pool-worker")
const byRel = new Map<string, string>()
for (const f of files) byRel.set(f.rel, f.abs)
const confirmRows: Record<string, { files: string; label: string; source: string; target: string; line?: number }[]> = {}
for (const [key, rels] of confirmCandidates) {
  const rows: { files: string; label: string; source: string; target: string; line?: number }[] = []
  confirmRows[key] = rows
  for (const rel of rels) {
    const abs = byRel.get(rel)
    if (!abs) continue
    let r: any
    try { r = await parseFile(abs, path.dirname(abs)) } catch { continue }
    for (const x of r?.relationships ?? []) {
      const label = String(x?.type ?? "")
      if (label !== "overrides" && label !== "implements" && label !== "imports" && label !== "uses" && label !== "calls") continue
      if (rows.length >= 24) break
      rows.push({ files: rel, label, source: String(x?.source ?? ""), target: String(x?.target ?? ""), line: x?.line_number })
    }
  }
  console.log(`\n  ${key}`)
  for (const row of rows.slice(0, 10)) {
    console.log(`    ${row.label.padEnd(12)} ${String(row.source).slice(0, 34).padEnd(34)} -> ${String(row.target).slice(0, 40).padEnd(40)} ${row.files.split("/").slice(-1)[0]}:${row.line ?? "?"}`)
  }
}

if (process.env.BB_FSHARP_PROBE_JSON) {
  writeFileSync(process.env.BB_FSHARP_PROBE_JSON, JSON.stringify({
    admitted: files.length,
    instrumentAWalked: walked,
    instrumentBWalked: bWalked,
    walkSkipped: walkSkipped.slice(0, 50),
    walkSkippedTotal: walkSkipped.length,
    grammarInventory: Object.fromEntries(sortedInv),
    nodeFileCounts: Object.fromEntries([...fileHasNode.entries()].map(([k, v]) => [k, v.size])),
    parseTreeCounts: counts,
    adversarialConfirm: confirmRows,
  }, null, 2))
  console.log(`\njson: ${process.env.BB_FSHARP_PROBE_JSON}`)
}