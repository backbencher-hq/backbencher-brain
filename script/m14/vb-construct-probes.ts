/**
 * VB CONSTRUCT PROBES — the corpus measurements behind the three SILENT types.
 *
 * ## Why two instruments and not one
 *
 * `firing-check-v2.mjs` reports `uses`, `exports` and `instantiates` as silent for
 * this lane. Silence is not a verdict: it says the analyzer has no construction
 * site for them, which is a fact about the CODE and says nothing about the
 * LANGUAGE. The ontology-coverage gate's own header records what happens next --
 * for `overrides` in bash, a prose ruling plus an absent oracle left the
 * differential green for a whole wave, because "nothing agrees with nothing".
 *
 * So each silent type gets the instrument its QUESTION needs:
 *
 *   A: GRAMMAR INVENTORY — does the language have a node type that would express
 *      the construct? Enumerating every node type the grammar actually PRODUCES
 *      across the whole corpus is positive evidence of absence. Nothing to find is
 *      not the same as not looking.
 *
 *   B: PARSE-TREE SEMANTIC COUNT — the language CAN express it, so a shape test
 *      would find it, or a grammar inventory is silent by construction. Counted on
 *      the tree, where a string literal or an embedded snippet cannot fake it.
 *
 * The workstream also records that a text probe already produced two false
 * positives once: a search for `extends` matched "class voice" inside a telnet
 * IAC word list in a string, and a search for `instantiates` matched "new Map("
 * inside a heredoc. That is why NOTHING here reads source text as a pattern.
 * Every probe is a node-type test, a field read, or a child-count.
 *
 * ## The probes, one per question
 *
 *   instantiates  B  the construct is `object_creation_expression` /
 *                    `array_creation_expression` / a `New` inside an
 *                    `invocation_expression`. Counted, with the constructed name,
 *                    so a GAP verdict is not a guess.
 *   uses          B  a member READ is a `member_access_expression` whose `name`
 *                    is not the callee of an enclosing invocation and is not the
 *                    left of an assignment; plus a bare identifier that the file
 *                    itself declares as a member. Counted.
 *   exports       A  every node type the grammar produces is enumerated and
 *                    searched for an export-bearing name. Plus B, because a
 *                    grammar cannot see a CONVENTION: the probe also counts
 *                    declarations whose only claim to being "published" is the
 *                    `Public` modifier, since a visibility modifier is not an
 *                    export list and would be a fabricated edge.
 *
 * ## Population
 *
 * Derived by walking the corpus directory. Every count prints against it.
 */

import { readdirSync, statSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { getParser } from "../../src/ast/engine"

const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const REPO = process.env.VB_CORPUS ?? "roslyn-vb"
const DIR = join(CORPUS_ROOT, REPO)
const LIMIT = Number(process.env.VB_NFILES ?? 0)

function hasSuffix(s: string, suffix: string): boolean {
  return s.length >= suffix.length && s.lastIndexOf(suffix) === s.length - suffix.length
}
function fold(s: string): string {
  let out = ""
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    out += (c >= 65 && c <= 90) ? String.fromCharCode(c + 32) : s.charAt(i)
  }
  return out
}
function containsWord(haystack: string, needle: string): boolean {
  const h = fold(haystack); const n = needle
  let from = 0
  for (;;) {
    const at = h.indexOf(n, from)
    if (at < 0) return false
    const before = at > 0 ? h.charCodeAt(at - 1) : 32
    const afterAt = at + n.length
    const after = afterAt < h.length ? h.charCodeAt(afterAt) : 32
    const isWord = (c: number) => (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || (c >= 48 && c <= 57) || c === 95
    if (!isWord(before) && !isWord(after)) return true
    from = at + 1
  }
}

function derivePopulation(dir: string, ext: string, want: number): string[] {
  const out: string[] = []
  const walk = (d: string, depth: number): void => {
    if (out.length >= want || depth > 24) return
    let ents: import("node:fs").Dirent[]
    try { ents = readdirSync(d, { withFileTypes: true }) } catch { return }
    ents.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const e of ents) {
      if (out.length >= want) return
      if (e.name === "node_modules" || e.name === ".git") continue
      const p = join(d, e.name)
      if (e.isDirectory()) { walk(p, depth + 1); continue }
      if (!hasSuffix(e.name, ext)) continue
      try { if (statSync(p).isFile()) out.push(p) } catch {}
    }
  }
  walk(dir, 0)
  return out
}

const all = derivePopulation(DIR, ".vb", Number.MAX_SAFE_INTEGER)
const files = LIMIT > 0 ? all.slice(0, LIMIT) : all

console.log("=".repeat(92))
console.log("VB CONSTRUCT PROBES — the measurements behind uses / exports / instantiates")
console.log(`population DERIVED by directory walk: ${all.length} .vb files on disk`)
console.log(`population MEASURED this run:        ${files.length}`)
console.log(`parser: getParser("vb") — the pinned tree-sitter-vbnet wasm, production path`)
console.log("=".repeat(92) + "\n")

const parser = await getParser("vb")

// ---------------------------------------------------------------------------
// Instrument A — the grammar's real vocabulary, observed across the whole corpus
// ---------------------------------------------------------------------------

const nodeTypeCounts = new Map<string, number>()
const typeFiles = new Map<string, Set<string>>()
const anonymousTokens = new Map<string, number>()

// ---------------------------------------------------------------------------
// Instrument B — semantic counts on the tree
// ---------------------------------------------------------------------------

type B = { n: number; files: Set<string>; examples: string[] }

const bObjectCreation = mkB()
const bArrayCreation = mkB()
const bMemberRead = mkB()
const bBareMemberRead = mkB()
const bTupleReturn = mkB()
const bExportNamedNode = mkB()
const bPublicModifierDecls = mkB()
const bErroredFiles: B = mkB()
function mkB(): B { return { n: 0, files: new Set<string>(), examples: [] } }
function hit(b: B, rel: string, text: string): void {
  b.n++
  b.files.add(rel)
  if (b.examples.length < 5) b.examples.push(text)
}

/** the last identifier leaf at or under n, skipping a type_argument_list */
function calleeLeaf(n: any, depth = 0): any {
  if (depth > 64) return null
  if (n.type === "type_argument_list") return null
  if (n.type === "identifier") return n
  for (let i = n.childCount - 1; i >= 0; i--) {
    const c = n.child(i)
    if (!c) continue
    const r = calleeLeaf(c, depth + 1)
    if (r) return r
  }
  return null
}
function declaredMemberNames(root: any): Set<string> {
  const names = new Set<string>()
  const DECL = new Set(["method_declaration", "property_declaration", "field_declaration", "event_declaration", "interface_method_declaration", "interface_property_declaration", "interface_event_declaration", "constructor_declaration"])
  // iterative for the same stack reason the two walkers below are
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    if (DECL.has(n.type)) {
      const nm = n.childForFieldName("name")
      if (nm) names.add(String(nm.text))
      else {
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c && (c.type === "identifier" || c.type === "simple_name")) { names.add(String(c.text)); break }
        }
      }
    }
    if (n.type === "variable_declarator") { const nm = n.childForFieldName("name"); if (nm) names.add(String(nm.text)) }
    for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) stack.push(c) }
  }
  return names
}

let parsed = 0
let parseThrew = 0
for (const abs of files) {
  const rel = abs.slice(DIR.length + 1)
  let content: string
  try { content = readFileSync(abs, "utf8") } catch { continue }
  let tree: any
  try { tree = await parser.parse(content, abs); parsed++ } catch { parseThrew++; continue }
  const root = tree.rootNode
  const declared = declaredMemberNames(root)

  // --- Instrument A -------------------------------------------------------
  // ITERATIVE. The first version recursed per child and died with
  // "Maximum call stack size exceeded" on file 1,251 of 3,751 — roslyn-vb has
  // markup inside verbatim strings that nests deeper than the JS stack allows.
  // A census that dies on a deep tree reports nothing about the deep tree, which
  // is the same silent-loss failure the resumable walk exists to prevent.
  const stackA: any[] = [root]
  while (stackA.length > 0) {
    const n = stackA.pop()!
    nodeTypeCounts.set(n.type, (nodeTypeCounts.get(n.type) ?? 0) + 1)
    let fs = typeFiles.get(n.type)
    if (!fs) { fs = new Set<string>(); typeFiles.set(n.type, fs) }
    fs.add(rel)
    if (!n.isNamed) anonymousTokens.set(n.type, (anonymousTokens.get(n.type) ?? 0) + 1)
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i)
      if (c) stackA.push(c)
    }
  }

  // --- errored file census ------------------------------------------------
  if (root.hasError) {
    hit(bErroredFiles, rel, `${rel}: root=${root.type} rows ${root.startPosition.row + 1}-${root.endPosition.row + 1}`)
  }

  // --- Instrument B — also ITERATIVE, same reason.
  const stackB: any[] = [root]
  while (stackB.length > 0) {
    const n = stackB.pop()!
    if (n.type === "object_creation_expression") {
      const ty = n.childForFieldName("type")
      const leaf = ty ? calleeLeaf(ty) : null
      hit(bObjectCreation, rel, `${rel}:${n.startPosition.row + 1} object_creation_expression -> ${leaf ? leaf.text : "(no type leaf)"}`)
    }
    if (n.type === "array_creation_expression") {
      const ty = n.childForFieldName("type")
      const leaf = ty ? calleeLeaf(ty) : null
      hit(bArrayCreation, rel, `${rel}:${n.startPosition.row + 1} array_creation_expression -> ${leaf ? leaf.text : "(no type leaf)"}`)
    }
    if (n.type === "invocation_expression") {
      const fn = n.childForFieldName("function")
      if (fn && fn.type === "object_creation_expression") {
        const leaf = calleeLeaf(fn)
        hit(bObjectCreation, rel, `${rel}:${n.startPosition.row + 1} invocation(function: object_creation_expression) -> ${leaf ? leaf.text : "?"}`)
      }
    }
    // A TUPLE RETURN: `Return (A, B)`. Counted because this probe file found it to
    // be the trigger for the whole-corpus ERROR collapse, so the number matters.
    if (n.type === "return_statement") {
      let kid = null
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) { kid = c; break } }
      if (kid && kid.type === "parenthesized_expression") {
        let commas = 0
        for (let i = 0; i < kid.childCount; i++) { const c = kid.child(i); if (c && !c.isNamed && c.type === ",") commas++ }
        if (commas > 0) hit(bTupleReturn, rel, `${rel}:${n.startPosition.row + 1} Return (...) with ${commas} comma(s)`)
      }
    }
    // A MEMBER READ: member_access_expression / with_member_access_expression whose
    // accessed member is neither the callee of an enclosing invocation nor an
    // assignment LHS.
    //
    // GRAMMAR FACT MEASURED, not assumed: in this grammar a `member_access_expression`
    // has NO `name` field and NO `expression` field. Its children are positional --
    // `identifier`, the anonymous `.`, `identifier` -- so
    // `childForFieldName("name")` is `undefined` on every one of them and a probe
    // written against the C# shape returns 0 reads and looks like an absence of the
    // construct. The accessed member is the LAST identifier leaf, which is the same
    // `calleeLeaf` rule the analyzer's own call path uses, and the receiver is
    // everything to its left.
    if (n.type === "member_access_expression" || n.type === "with_member_access_expression") {
      const leaf = calleeLeaf(n)
      const nameText = leaf ? String(leaf.text) : ""
      if (nameText.length > 0 && !isCalleePosition(n) && !isAssignmentLhs(n)) {
        hit(bMemberRead, rel, `${rel}:${n.startPosition.row + 1} ${n.type} reads ${nameText}`)
      }
    }
    // A BARE IDENTIFIER READ that the file itself declares as a member. This is
    // the resolvability-required reading, the same contract go's GO1 and
    // csharp's CS-R1 hold: no declaration, no edge.
    if (n.type === "identifier") {
      const txt = String(n.text)
      if (declared.has(txt) && !isCalleePosition(n) && !isAssignmentLhs(n) && !isDeclarationPosition(n)) {
        hit(bBareMemberRead, rel, `${rel}:${n.startPosition.row + 1} bare identifier ${txt} names a member this file declares`)
      }
    }
    // A VISIBILITY MARKER: a declaration carrying a `Public` member_modifier. This
    // is the only thing in VB that even resembles "published", and it is a MODIFIER
    // already recorded on the symbol as `visibility` -- so it is counted to show
    // how much a visibility-as-exports reading would fabricate, not to derive edges.
    if (n.type === "member_modifier" && fold(String(n.text)) === "public") {
      hit(bPublicModifierDecls, rel, `${rel}:${n.startPosition.row + 1} member_modifier Public`)
    }
    // AN EXPORT-BEARING NODE: by name, on both named and anonymous nodes, because
    // `Export` would be a keyword token if VB had one.
    if (containsWord(n.type, "export")) {
      hit(bExportNamedNode, rel, `${rel}:${n.startPosition.row + 1} node type "${n.type}"`)
    }
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i)
      if (c) stackB.push(c)
    }
  }
  tree.delete?.()
  if ((parsed % 250) === 0) process.stderr.write(`  ...${parsed}/${files.length}\n`)
}

/**
 * Is this node (or the member-access chain above it) the CALLEE of an invocation?
 *
 * `obj.M()` is `invocation_expression(function: member_access_expression)`, and
 * `obj.M().N()` is an `array_access_expression` around the invocation in this
 * grammar — measured, because the provider file's own tree shows a
 * `member_access_expression` whose parent is `array_access_expression` for the
 * `_options(key).VisualBasicCodeStyleOptions.PreferredModifierOrder` shape. So
 * the climb has to pass through `array_access_expression` too, or every chained
 * call's leading segments read as uses.
 */
function isCalleePosition(n: any): boolean {
  let a: any = n
  for (let i = 0; a && i < 12; i++) {
    const p = a.parent
    if (!p) return false
    if (p.type === "member_access_expression" || p.type === "with_member_access_expression" ||
        p.type === "array_access_expression" || p.type === "parenthesized_expression") {
      a = p
      continue
    }
    if (p.type === "invocation_expression") {
      const fn = p.childForFieldName("function")
      if (fn && fn.id === a.id) return true
      return false
    }
    return false
  }
  return false
}
function isAssignmentLhs(n: any): boolean {
  let a = n.parent
  for (let i = 0; a && i < 6; i++) {
    if (a.type === "member_access_expression" || a.type === "with_member_access_expression" || a.type === "identifier") a = a.parent
    else break
  }
  if (a && (a.type === "assignment_expression" || a.type === "assignment_statement")) {
    const l = a.childForFieldName("left") ?? a.childForFieldName("target")
    if (l && l.startIndex <= n.startIndex && l.endIndex >= n.endIndex) return true
  }
  return false
}
function isDeclarationPosition(n: any): boolean {
  let a: any = n.parent
  for (let i = 0; a && i < 6; i++) {
    if (a.type === "method_declaration" || a.type === "property_declaration" ||
        a.type === "field_declaration" || a.type === "event_declaration" ||
        a.type === "interface_method_declaration" || a.type === "interface_property_declaration" ||
        a.type === "constructor_declaration" || a.type === "variable_declarator" ||
        a.type === "parameter" || a.type === "enum_member_declaration") {
      const nm = a.childForFieldName("name")
      if (nm && nm.startIndex === n.startIndex && nm.endIndex === n.endIndex) return true
      if (a.type === "variable_declarator" && a.startIndex === n.startIndex) return true
      return false
    }
    if (a.type === "as_clause" || a.type === "inherits_statement" || a.type === "implements_statement" ||
        a.type === "implements_member_clause" || a.type === "inherits_member_clause") return true
    a = a.parent
  }
  return false
}

// ---------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------

console.log(`files parsed ${parsed}   parse threw ${parseThrew}\n`)

console.log("INSTRUMENT A — GRAMMAR INVENTORY")
console.log(`distinct NAMED node types the grammar produced over the corpus: ${[...nodeTypeCounts.keys()].filter((t) => t.length > 0).length}`)
console.log(`distinct ANONYMOUS token types:                                  ${anonymousTokens.size}`)
const sortedTypes = [...nodeTypeCounts.entries()].sort((a, b) => b[1] - a[1])
console.log(`\ntop 40 by occurrence:`)
for (const [t, n] of sortedTypes.slice(0, 40)) console.log(`  ${String(n).padStart(9)}  ${t}`)
console.log("\nnode types whose NAME contains \"export\":")
const exportNamed = [...nodeTypeCounts.keys()].filter((t) => containsWord(t, "export"))
console.log(exportNamed.length === 0 ? "  (none)" : exportNamed.map((t) => `  ${t}  x${nodeTypeCounts.get(t)}`).join("\n"))
console.log("\nanonymous token types whose NAME contains \"export\":")
const exportAnon = [...anonymousTokens.keys()].filter((t) => containsWord(t, "export"))
console.log(exportAnon.length === 0 ? "  (none)" : exportAnon.map((t) => `  ${t}  x${anonymousTokens.get(t)}`).join("\n"))
console.log("\nnode/token types containing \"module\" (the nearest VB shape to a unit of export):")
for (const t of [...nodeTypeCounts.keys()].filter((k) => containsWord(k, "module")).sort()) {
  console.log(`  ${t}  named x${nodeTypeCounts.get(t)}  in ${typeFiles.get(t)?.size ?? 0} files`)
}
console.log("")

console.log("INSTRUMENT B — PARSE-TREE SEMANTIC COUNTS")
function report(b: B, label: string, unit: string): void {
  console.log(`\n${label}`)
  console.log(`  ${b.n.toLocaleString()} ${unit} across ${b.files.size} files`)
  for (const e of b.examples) console.log(`    e.g. ${e}`)
}
report(bObjectCreation, "object_creation_expression (+ New inside an invocation_expression)", "construction sites")
report(bArrayCreation, "array_creation_expression (New T(args) with arguments)", "construction sites")
report(bMemberRead, "member_access_expression / with_member_access_expression that is a READ", "member reads")
report(bBareMemberRead, "bare identifier that names a member THIS FILE declares", "bare reads")
report(bTupleReturn, "return_statement whose expression is a parenthesised COMMA list", "tuple returns")
report(bExportNamedNode, "nodes whose type names an export", "export-shaped nodes")
report(bPublicModifierDecls, "member_modifier `Public` (the only visibility marker)", "Public modifiers")
report(bErroredFiles, "files whose parse contains an ERROR node", "errored files")

console.log("\nVERDICT INPUTS")
console.log(`  instantiates: ${bObjectCreation.n + bArrayCreation.n} construction sites on the tree → the construct EXISTS.`)
console.log(`  uses:         ${bMemberRead.n} member reads + ${bBareMemberRead.n} resolvable bare reads on the tree → the construct EXISTS.`)
console.log(`  exports:      ${bExportNamedNode.n} export-shaped nodes, and ${nodeTypeCounts.size} distinct node types with no export-bearing name among them.`)
console.log(`                 ${bPublicModifierDecls.n} Public modifiers exist and are a MODIFIER, not an export list.`)
console.log(`\nDONE. Population DERIVED: ${all.length} .vb files on disk; parsed this run: ${parsed}.`)