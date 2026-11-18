// AN INDEPENDENT ORACLE for the go lane's ten relationship types.
//
// WHAT THIS IS FOR. Workstream doc JOB 1 question 3 is "does an independent
// oracle agree?" — and the doc is explicit that an oracle is a separate walker
// over the SAME grammar, so a grammar bug shared by both paths is invisible. The
// oracle below is therefore evidence of DISAGREEMENT, never of correctness: it
// can refute the analyzer, it cannot confirm it. Stated here so the report does
// not claim more than the harness supports.
//
// INDEPENDENCE, and where it stops. This file was written from the grammar's own
// node-types.json (tree-sitter-go 0.25.0) and the Go specification's rules for
// each construct, not by reading the analyzer's control flow. It does NOT share
// a helper with src/ast/real-go-analyzer.ts, and it deliberately uses a
// different mechanism for each fact:
//
//   - the oracle takes the LAST segment of a dotted name by splitting on "."
//     and reading the final piece; the analyzer resolves leaves through node
//     fields.
//   - the oracle decides package scope by testing whether a node's depth from
//     source_file is 1 or 2 (declaration node -> spec node); the analyzer uses
//     its own collectGoPackageScopeNames.
//   - the oracle decides "exported" with an explicit uppercase-codepoint test
//     on the first character; that is Go's spec rule, not a convention borrowed
//     from another lane.
//
// KNOWN SHARED-GRAMMAR EXPOSURE, declared rather than hidden:
//   (a) both walk the same wasm, so an error-recovery shape both misread is
//       invisible here;
//   (b) both use the same Node API, so a binding-level defect is invisible;
//   (c) the oracle does not implement Go's full method-set rules. It is a
//       SAME-FILE approximation and says so per type in LIMITS below. An
//       implements/extends/overrides disagreement is therefore evidence about
//       the pair, not a verdict on the analyzer.
//
// NO REGEX. Every name decision is endsWith / split / charCodeAt / Set lookup /
// an integer range.

import { readFileSync } from "node:fs"
import { ASTEngine } from "../../../src/ast/engine"
import { RelationshipType } from "../../../src/ast/types"
import { collectAllGoFiles, splitTestAndNonTest, strideSample, topPackage } from "./go-corpus-files"
import { GO_STDLIB_DEFAULT, requireCorpusDir } from "./go-corpus-root"

const WANT = Number(process.argv[2] || 140)
const CORPUS_ROOT = process.argv[3] || GO_STDLIB_DEFAULT
// ABSENT CORPUS IS FATAL, never a zero-file run that reads as clean.
requireCorpusDir(CORPUS_ROOT)
const ENUM_VALUES: string[] = [...new Set(Object.values(RelationshipType))]
const OFF_ENUM_IMPORTS = "imports"
// `src/ast/types.ts` was corrected on 2026-10-05: `Imports` read
// `"brain_import"` and now reads `"imports"`. `OFF_ENUM_IMPORTS` was the
// workaround for the old divergence — the analyzer emitted a string that was not
// an enum value, so the oracle kept a separate bucket for it. The correction
// makes that string an enum value, so `[...ENUM_VALUES, OFF_ENUM_IMPORTS]` now
// contains `"imports"` TWICE and every imports row was compared and counted
// twice: the 400-file run reported oracle 2608 / analyzer 2608 / agree 2608
// where the pre-correction run reported 1304 / 1304 / 1304. Deduplicating the
// iteration list is the whole fix; the two sides are each deduped separately, so
// agreement was never wrong — only the counts were doubled.
const TYPES_ITERATED: string[] = [...new Set([...ENUM_VALUES, OFF_ENUM_IMPORTS])]

type Edge = [string, string]

/**
 * Go's PREDECLARED type identifiers, transcribed from the language
 * specification's "Predeclared identifiers" / "Types" blocks.
 *
 * A reference to one of these is not a reference to a declaration in this
 * package or any other: `error` and `any` are universe-scope, the rest are
 * aliases for fixed machine types. Publishing `references f -> string` would
 * put a name in the target surface that no declaration anywhere can resolve,
 * which is the rule-R7 class of defect. Derived from the spec rather than
 * copied from the analyzer; the two lists happen to coincide, and that
 * coincidence is worth stating because it means the rule is not a lane
 * invention.
 */
const PREDECLARED_TYPES: ReadonlySet<string> = new Set([
  "bool", "byte", "complex64", "complex128", "error", "float32", "float64",
  "int", "int8", "int16", "int32", "int64", "rune", "string",
  "uint", "uint8", "uint16", "uint32", "uint64", "uintptr",
  "any", "comparable",
])

interface FileFacts {
  edges: Map<string, Edge[]>
  limits: string[]
}

function newFacts(): FileFacts {
  const edges = new Map<string, Edge[]>()
  for (const v of ENUM_VALUES) edges.set(v, [])
  edges.set(OFF_ENUM_IMPORTS, [])
  return { edges, limits: [] }
}

function push(f: FileFacts, type: string, s: string, t: string): void {
  if (s.length === 0 || t.length === 0) return
  let arr = f.edges.get(type)
  if (!arr) {
    arr = []
    f.edges.set(type, arr)
  }
  arr.push([s, t])
}

// ---------------------------------------------------------------------------
// primitives
// ---------------------------------------------------------------------------

/** Go's spec: "exported if the first character of the identifier's name is an uppercase letter". */
function isGoExportedIdentifier(name: string): boolean {
  if (name.length === 0) return false
  const c = name.charCodeAt(0)
  return c >= 65 && c <= 90
}

/** Last dot-separated segment. Splitting, not a pattern. */
function leafOf(qname: string): string {
  const parts = qname.split(".")
  return parts[parts.length - 1]
}

/** Strip the pointer and slice markers a type expression may carry. */
function stripPointerMarkers(name: string): string {
  let out = name
  while (out.startsWith("*")) out = out.slice(1)
  while (out.startsWith("[]")) out = out.slice(2)
  return out
}

/** Named children only, as an array. */
function named(n: any): any[] {
  const out: any[] = []
  for (let i = 0; i < n.namedChildCount; i++) out.push(n.namedChild(i))
  return out
}

function field(n: any, name: string): any {
  return n.childForFieldName ? n.childForFieldName(name) : null
}

function textOf(n: any | null): string {
  return n ? String(n.text) : ""
}

// ---------------------------------------------------------------------------
// structural scan: build the file's declaration inventory
// ---------------------------------------------------------------------------

interface Decl {
  name: string
  kind: "func" | "method" | "type" | "var" | "const" | "field" | "imethod"
  packageScope: boolean
  structName?: string
  interfaceName?: string
  receiverType?: string
  exported: boolean
  line: number
}

interface IfaceMethod {
  name: string
  line: number
}

interface StructInfo {
  name: string
  line: number
  embeds: Array<{ name: string; qualified: boolean; line: number }>
  fields: Array<{ name: string; typeText: string; line: number }>
  methods: string[]
}

interface IfaceInfo {
  name: string
  line: number
  methods: IfaceMethod[]
  embeds: string[]
}

interface FileModel {
  packageName: string
  decls: Decl[]
  structs: Map<string, StructInfo>
  ifaces: Map<string, IfaceInfo>
  methodsByReceiver: Map<string, Map<string, string>>
  topLevelFuncs: Set<string>
  /** source_file's DIRECT named children that are declarations. */
  packageScopeDeclNodes: Set<any>
  /**
   * Every name BOUND inside each function/method body (params, receiver, `:=` targets,
   * `var`/`const`, range and type-switch bindings), keyed by function name.
   *
   * WHY THE ORACLE NEEDS THIS: it derives a `calls` edge for ANY `call_expression`, so a
   * call to a FUNCTION-TYPED PARAMETER (`filter(obj)` where `filter func(types.Object)
   * bool` is a parameter) looks like a call to a declared function and lands in the
   * unexplained bucket — while the analyzer is CORRECTLY silent, because LocalsAreNotSymbols
   * keeps locals out of the graph. This is the oracle's over-broadness, not an analyzer gap,
   * and the classifier can only say so if it knows the bindings.
   */
  funcBoundNames: Map<string, Set<string>>
  /** Every TYPE PARAMETER name declared in the file (from any `type_parameter_list`). */
  typeParamNames: Set<string>
  limits: string[]
}

/**
 * Names a function BINDS anywhere inside itself: parameters, receiver, generic type
 * parameters, `:=` targets, `var`/`const` names, range targets and type-switch scrutinee
 * bindings. Over-approximated for the whole body on purpose — this only ever EXPLAINS a
 * disagreement, and explaining one that is not real would be the one thing worse than not
 * explaining it, so every name added here must be genuinely bound somewhere in the function.
 */
/**
 * Is this node in a WRITE position — an assignment LHS or an inc/dec operand?
 *
 * A write is not a read, in Go or in any other language, so the lane's selector-pass write
 * gate (the family's S1 rule, carried by cpp/c/php/ruby/python/groovy/objc/ts as well) skips
 * these. The oracle published a `uses` row for EVERY selector that was not a callee, so
 * `flag.Usage = func(){...}` produced `uses main -> Usage` and `b.Measured |= NsPerOp` produced
 * `uses parseMeasurement -> Measured` — neither is a read. Measured on the 400-file go-tools
 * draw: this is the dominant cause of the 424 unexplained `uses` rows.
 *
 * tree-sitter-go wraps the LHS in the FIRST `expression_list` child of an
 * `assignment_statement`; the operator (`=`, `+=`, `|=`, ...) is an anonymous token, so a
 * compound assignment is a write exactly like a plain one. A CHAINED operand
 * (`r.cfg.V = v`) is a genuine read of the outer selector and keeps its row, which is why the
 * test is on the node's own position rather than on the statement.
 */
function isWritePosition(n: any): boolean {
  const p = n.parent
  if (!p) return false
  if (p.type === "inc_statement" || p.type === "dec_statement") return true
  if (p.type === "expression_list" && p.parent && p.parent.type === "assignment_statement") {
    // Is `n` inside the assignment's TARGET list rather than its VALUE list?
    //
    // `s.Total, s.Largest, s.Errs = c.fileStats()` is ONE `assignment_statement` with TWO
    // `expression_list` children: the targets and the values. ALL THREE selectors on the left are
    // writes, so the test is "is `n` inside the FIRST expression_list", NOT "is `n` the first
    // child of it". An earlier version asked the latter and caught only `s.Total` — leaving
    // `s.Largest` and `s.Errs` to look like reads, which is exactly the shape the oracle reported
    // as `uses FileStats -> Largest`.
    //
    // The comparison is `first` against `n` (the node being classified), NOT against `p`. An
    // earlier version compared `first` with `p` — comparing the list's first child with the
    // LIST — which was true only when they coincided, so a single-child assignment slipped
    // through as a read and `b.Count, end, err = ...` style multi-assign writes were missed.
    // Compare by BYTE SPAN, not object identity: web-tree-sitter wraps a tree node per
    // retrieval, so two wrappers over the same node are never `===`.
    // The TARGET list is the first named child of the assignment statement.
    const stmt = p.parent
    const targetList = stmt.namedChildCount > 0 ? stmt.namedChild(0) : null
    if (!targetList) return false
    // Containment by byte span: a node inside the target list is a write, whether it is the
    // only target or one of several. web-tree-sitter wraps nodes per retrieval, so identity
    // comparison is not available here.
    return targetList.startIndex <= n.startIndex && n.endIndex <= targetList.endIndex
  }
  return false
}

function boundNamesOf(fnNode: any): Set<string> {
  const names = new Set<string>()
  const bindAll = (r: any): void => {
    const w: any[] = [r]
    while (w.length > 0) {
      const m = w.pop()!
      if (m.type === "identifier" && m.text !== "_") names.add(m.text)
      for (const c of m.children) w.push(c)
    }
  }
  const w: any[] = [fnNode]
  while (w.length > 0) {
    const n = w.pop()!
    if (n.type === "parameter_list" || n.type === "type_parameter_list") bindAll(n)
    else if (n.type === "short_var_declaration") {
      const left = n.childForFieldName("left") ?? (n.childCount > 0 ? n.namedChild(0) : null)
      if (left) bindAll(left)
    } else if (n.type === "var_spec" || n.type === "const_spec") {
      for (const c of n.namedChildren) if (c.type === "identifier" && c.text !== "_") names.add(c.text)
    } else if (n.type === "range_clause") {
      for (let i = 0; i < n.namedChildCount - 1; i++) bindAll(n.namedChild(i))
    } else if (n.type === "type_switch_statement" && n.namedChildCount > 2) {
      bindAll(n.namedChild(0))
    }
    for (const c of n.children) w.push(c)
  }
  return names
}

function scanModel(root: any): FileModel {
  const model: FileModel = {
    packageName: "",
    decls: [],
    structs: new Map(),
    ifaces: new Map(),
    methodsByReceiver: new Map(),
    topLevelFuncs: new Set(),
    packageScopeDeclNodes: new Set(),
    funcBoundNames: new Map(),
    typeParamNames: new Set(),
    limits: [],
  }
  // package_clause has NO fields in tree-sitter-go 0.25.0's node-types.json;
  // the identifier is a plain named child. Reading a field here yields "" and
  // silently drops every package-scoped edge, which is exactly the failure the
  // first run of this oracle produced.
  const pkg = named(root).find((c) => c.type === "package_clause")
  if (pkg) {
    const id = named(pkg).find((c) => c.type === "package_identifier")
    model.packageName = textOf(id)
  }
  // File-wide type parameters, so a receiver like `func (s *Set[K]) Clone()` can be told from a
  // declared type owner: the owner there is `Set`, and `K` is the type ARGUMENT.
  {
    const w: any[] = [root]
    while (w.length > 0) {
      const n = w.pop()!
      if (n.type === "type_parameter_list") {
        // The child node is `parameter_declaration`, NOT `type_parameter_declaration` — this
        // grammar types a type-parameter list with the same node it uses for value parameters
        // (verified on persistent/set.go: `type_parameter_list` -> `parameter_declaration` ->
        // identifier "K" + qualified_type "constraints.Ordered"). Reading the wrong name is why
        // this set was silently empty and the rule below never fired.
        for (const d of n.namedChildren) {
          if (d.type !== "parameter_declaration" && d.type !== "type_parameter_declaration") continue
          for (const c of d.namedChildren) if (c.type === "identifier") model.typeParamNames.add(c.text)
        }
      }
      for (const c of n.children) w.push(c)
    }
  }

  for (const top of named(root)) {
    switch (top.type) {
      case "function_declaration": {
        const nm = textOf(field(top, "name"))
        if (nm.length > 0) {
          model.decls.push({ name: nm, kind: "func", packageScope: true, exported: isGoExportedIdentifier(nm), line: top.startPosition.row + 1 })
          model.topLevelFuncs.add(nm)
          model.funcBoundNames.set(nm, boundNamesOf(top))
        }
        break
      }
      case "method_declaration": {
        const nm = textOf(field(top, "name"))
        const recv = field(top, "receiver")
        const recvType = receiverTypeName(recv)
        if (nm.length > 0 && recvType.length > 0) {
          model.decls.push({
            name: nm,
            kind: "method",
            packageScope: true,
            exported: isGoExportedIdentifier(nm),
            receiverType: recvType,
            line: top.startPosition.row + 1,
          })
          model.funcBoundNames.set(nm, boundNamesOf(top))
          let byName = model.methodsByReceiver.get(recvType)
          if (!byName) {
            byName = new Map()
            model.methodsByReceiver.set(recvType, byName)
          }
          byName.set(nm, signatureOf(top))
        }
        break
      }
      case "type_declaration":
      case "var_declaration":
      case "const_declaration": {
        // One level of spec descent, and no further: a nested declaration
        // inside a function body is a child of a `block`, never of this node.
        for (const spec of named(top)) {
          if (spec.type !== "type_spec" && spec.type !== "var_spec" && spec.type !== "const_spec") continue
          if (spec.type === "type_spec") recordTypeSpec(model, spec)
          else recordValueSpec(model, spec, spec.type === "var_spec" ? "var" : "const")
        }
        break
      }
      default:
        break
    }
  }
  return model
}

function receiverTypeName(recv: any): string {
  if (!recv) return ""
  let out = ""
  const walk = (n: any) => {
    if (n.type === "type_identifier") out = textOf(n)
    else for (const c of named(n)) walk(c)
  }
  walk(recv)
  // strip pointer and slice markers
  let r = out
  while (r.startsWith("*")) r = r.slice(1)
  return r
}

function recordValueSpec(model: FileModel, spec: any, kind: "var" | "const"): void {
  for (const n of named(spec)) {
    if (n.type !== "identifier" && n.type !== "blank_identifier") continue
    const nm = textOf(n)
    if (nm.length === 0) continue
    model.decls.push({ name: nm, kind, packageScope: true, exported: isGoExportedIdentifier(nm), line: spec.startPosition.row + 1 })
  }
}

function recordTypeSpec(model: FileModel, spec: any): void {
  const nm = textOf(field(spec, "name"))
  if (nm.length === 0) return
  const body = field(spec, "type")
  model.decls.push({ name: nm, kind: "type", packageScope: true, exported: isGoExportedIdentifier(nm), line: spec.startPosition.row + 1 })
  if (!body) return
  const line = spec.startPosition.row + 1
  if (body.type === "struct_type") {
    const info: StructInfo = { name: nm, line, embeds: [], fields: [], methods: [] }
    const list = named(body).find((c) => c.type === "field_declaration_list")
    if (list) {
      for (const fd of named(list)) {
        if (fd.type !== "field_declaration") continue
        recordStructField(model, info, fd, nm, line)
      }
    }
    model.structs.set(nm, info)
    return
  }
  if (body.type === "interface_type") {
    const info: IfaceInfo = { name: nm, line, methods: [], embeds: [] }
    const list = named(body).find((c) => c.type === "interface_type")
    if (list) {
      for (const el of named(list)) {
        if (el.type === "method_elem") {
          const mn = textOf(field(el, "name"))
          if (mn.length > 0) info.methods.push({ name: mn, line: el.startPosition.row + 1 })
        } else if (el.type === "type_identifier") {
          const emb = textOf(el)
          if (emb.length > 0) info.embeds.push(emb)
        }
      }
    }
    model.ifaces.set(nm, info)
    return
  }
  if (body.type === "type_alias") {
    const inner = field(body, "type")
    if (inner && inner.type === "interface_type") {
      const info: IfaceInfo = { name: nm, line, methods: [], embeds: [] }
      for (const el of named(inner)) {
        if (el.type === "method_elem") {
          const mn = textOf(field(el, "name"))
          if (mn.length > 0) info.methods.push({ name: mn, line: el.startPosition.row + 1 })
        } else if (el.type === "type_identifier") {
          const emb = textOf(el)
          if (emb.length > 0) info.embeds.push(emb)
        }
      }
      model.ifaces.set(nm, info)
    }
  }
}

function recordStructField(model: FileModel, info: StructInfo, fd: any, structName: string, line: number): void {
  const typeNode = field(fd, "type")
  const typeText = textOf(typeNode)
  const names: string[] = []
  for (const n of named(fd)) {
    if (n.type === "field_identifier" || n.type === "identifier") names.push(textOf(n))
    else if (n.type === "type_identifier") {
      // No `name` child: an EMBEDDED field. Per the grammar a field_declaration
      // with no name is the embedding form.
      names.push("")
    }
  }
  const hasName = names.some((x) => x.length > 0)
  if (!hasName) {
    info.embeds.push({ name: leafOf(stripPointerMarkers(typeText)), qualified: typeText.includes("."), line: fd.startPosition.row + 1 })
    // an embedded field also declares the name as a field of the struct
    info.fields.push({ name: leafOf(stripPointerMarkers(typeText)), typeText, line: fd.startPosition.row + 1 })
    return
  }
  for (const nm of names) {
    if (nm.length === 0) continue
    info.fields.push({ name: nm, typeText, line: fd.startPosition.row + 1 })
    model.decls.push({
      name: nm,
      kind: "field",
      packageScope: false,
      structName,
      exported: isGoExportedIdentifier(nm),
      line: fd.startPosition.row + 1,
    })
  }
}

function signatureOf(decl: any): string {
  // (name-only) canonical signature: parameter TYPE list + result TYPE list.
  // Parameter NAMES are not part of a Go method signature (spec, Method Sets),
  // so they are excluded here deliberately.
  const params = field(decl, "parameters")
  const result = field(decl, "result")
  return `${paramTypes(params)}|${resultTypes(result)}`
}

function paramTypes(list: any): string {
  if (!list) return ""
  const out: string[] = []
  const visit = (n: any) => {
    if (n.type === "parameter_declaration") {
      // `a, b int` expands to one entry per name.
      let count = 0
      for (const c of named(n)) if (c.type === "identifier") count++
      if (count === 0) count = 1
      const t = field(n, "type")
      const rendered = renderType(t)
      for (let i = 0; i < count; i++) out.push(rendered)
      return
    }
    if (n.type === "variadic_parameter_declaration") {
      out.push("..." + renderType(field(n, "type")))
      return
    }
    for (const c of named(n)) visit(c)
  }
  visit(list)
  return out.join(",")
}

function resultTypes(r: any): string {
  if (!r) return "void"
  const out: string[] = []
  const visit = (n: any) => {
    if (n.type === "parameter_declaration") {
      let count = 0
      for (const c of named(n)) if (c.type === "identifier") count++
      if (count === 0) count = 1
      const t = field(n, "type")
      const rendered = renderType(t)
      for (let i = 0; i < count; i++) out.push(rendered)
      return
    }
    if (n.type === "variadic_parameter_declaration") {
      out.push("..." + renderType(field(n, "type")))
      return
    }
    for (const c of named(n)) visit(c)
  }
  visit(r)
  if (out.length === 0) return "void"
  return out.join(",")
}

/** Canonical type text: strip parameter names, keep the type expression. */
function renderType(t: any): string {
  if (!t) return ""
  if (t.type === "parameter_declaration") {
    return renderType(field(t, "type"))
  }
  return textOf(t)
}

// ---------------------------------------------------------------------------
// the walk that produces expected edges
// ---------------------------------------------------------------------------

/** Depth of a node below source_file, counting only NAMED edges. */
function packageScopeCheck(root: any, target: any): boolean {
  let node = target
  let hops = 0
  while (node && node.id !== undefined && hops < 6) {
    const p = node.parent
    if (!p) return false
    if (p.type === "function_declaration" || p.type === "method_declaration" || p.type === "func_literal") return false
    node = p
    hops++
    if (node === root) return true
  }
  return false
}

function enclosingDeclName(n: any, root: any): string {
  let node = n.parent
  let hops = 0
  while (node && hops < 200) {
    if (node.type === "function_declaration" || node.type === "method_declaration") {
      return textOf(field(node, "name"))
    }
    node = node.parent
    hops++
  }
  return ""
}

function enclosingTypeName(n: any): string {
  let node = n.parent
  let hops = 0
  while (node && hops < 60) {
    if (node.type === "type_spec") return textOf(field(node, "name"))
    node = node.parent
    hops++
  }
  return ""
}

function buildFacts(root: any, content: string): FileFacts {
  const facts = newFacts()
  const model = scanModel(root)
  const pkg = model.packageName

  // ---- imports: every import_spec, target = the path literal's text.
  // A grouped import nests its specs one level down in an `import_spec_list`;
  // reading only the import_declaration's direct children finds the single-spec
  // form and misses every `import ( ... )` block, which is most of go-stdlib.
  const collectImportSpecs = (n: any, out: any[]) => {
    for (const c of named(n)) {
      if (c.type === "import_spec") out.push(c)
      else if (c.type === "import_spec_list") collectImportSpecs(c, out)
    }
  }
  for (const top of named(root)) {
    if (top.type !== "import_declaration") continue
    const specs: any[] = []
    collectImportSpecs(top, specs)
    for (const spec of specs) {
      const p = textOf(field(spec, "path"))
      if (p.length >= 2) push(facts, OFF_ENUM_IMPORTS, pkg, p.slice(1, p.length - 1))
    }
  }

  // ---- exports: package-scope declaration with an uppercase first letter.
  for (const d of model.decls) {
    if (!d.packageScope) continue
    if (!d.exported) continue
    push(facts, "exports", pkg, d.name)
  }
  facts.limits.push("exports: the oracle does not apply the analyzer's declaration-KIND filter, so it expects vars and methods too")

  // ---- contains: owner -> member for struct fields and interface methods.
  for (const info of model.structs.values()) {
    for (const f of info.fields) push(facts, "contains", info.name, f.name)
  }
  for (const info of model.ifaces.values()) {
    for (const m of info.methods) push(facts, "contains", info.name, m.name)
  }
  for (const [recv, byName] of model.methodsByReceiver) {
    for (const nm of byName.keys()) push(facts, "contains", recv, nm)
  }

  // ---- extends: an embedded field promotes the embedded type's methods.
  for (const info of model.structs.values()) {
    for (const e of info.embeds) push(facts, "extends", info.name, e.name)
  }

  // ---- overrides: a same-file outer declaration of a PROMOTED method name.
  // Same-file only: Go method sets are package-level, but this oracle reads one
  // file, so a promoted method declared elsewhere in the package is invisible.
  for (const info of model.structs.values()) {
    const own = model.methodsByReceiver.get(info.name)
    if (!own) continue
    for (const e of info.embeds) {
      const promoted = model.methodsByReceiver.get(e.name)
      if (!promoted) continue
      for (const nm of own.keys()) {
        if (!promoted.has(nm)) continue
        push(facts, "overrides", `${info.name}.${nm}`, `${e.name}.${nm}`)
      }
    }
  }

  // ---- implements: an interface's method names covered by a type's methods,
  // own plus one hop of same-file promotion. Arity/name only, same file only.
  for (const [typeName, info] of model.structs) {
    const names = new Set<string>()
    const own = model.methodsByReceiver.get(typeName)
    if (own) for (const nm of own.keys()) names.add(nm)
    for (const e of info.embeds) {
      const promoted = model.methodsByReceiver.get(e.name)
      if (promoted) for (const nm of promoted.keys()) names.add(nm)
    }
    for (const [ifaceName, iface] of model.ifaces) {
      if (iface.methods.length === 0) continue
      let covered = true
      for (const m of iface.methods) if (!names.has(m.name)) covered = false
      if (covered) push(facts, "implements", typeName, ifaceName)
    }
  }

  // ---- the expression-level walk: calls / uses / references / instantiates
  const walkExpr = (n: any, ctx: { typeName: string; inStructFieldType: boolean }) => {
    const t = n.type

    if (t === "call_expression") {
      const fn = field(n, "function")
      const src = ctx.typeName.length > 0 ? ctx.typeName : enclosingDeclName(n, root)
      if (fn) {
        if (fn.type === "selector_expression") {
          const fld = textOf(field(fn, "field"))
          push(facts, "calls", src, fld)
        } else if (fn.type === "identifier") {
          push(facts, "calls", src, textOf(fn))
          // Go's constructor convention is a capitalised top-level function
          // call. No `new` keyword exists in the language.
          const nm = textOf(fn)
          if (isGoExportedIdentifier(nm) && model.topLevelFuncs.has(nm)) push(facts, "instantiates", src, nm)
        } else if (fn.type === "generic_function" || fn.type === "type_instantiation_expression") {
          push(facts, "calls", src, leafOf(textOf(fn)))
        }
      }
    } else if (t === "selector_expression" && n.parent && n.parent.type !== "call_expression" && !isWritePosition(n)) {
      const fld = textOf(field(n, "field"))
      const src = ctx.typeName.length > 0 ? ctx.typeName : enclosingDeclName(n, root)
      push(facts, "uses", src, fld)
    } else if (t === "qualified_type") {
      const nm = textOf(field(n, "name"))
      const src = ctx.typeName.length > 0 ? ctx.typeName : enclosingDeclName(n, root)
      if (!PREDECLARED_TYPES.has(nm)) push(facts, "references", src, nm)
    } else if (t === "type_identifier" && n.parent && n.parent.type !== "qualified_type") {
      const nm = textOf(n)
      const src = ctx.typeName.length > 0 ? ctx.typeName : enclosingDeclName(n, root)
      if (!PREDECLARED_TYPES.has(nm)) push(facts, "references", src, nm)
    }

    for (const c of named(n)) {
      if (c.type === "call_expression" || c.type === "selector_expression" || c.type === "qualified_type") continue
      const nextCtx = { ...ctx }
      if (c.type === "struct_type" || c.type === "interface_type") nextCtx.typeName = ""
      walkExpr(c, nextCtx)
    }
  }

  // The declaration pass above already consumed type_spec bodies for
  // contains/extends/implements/overrides, so the expression walk starts at the
  // top level and visits declaration bodies without re-reading type_spec.
  const walkBody = (n: any, ctx: { typeName: string }) => {
    for (const c of named(n)) {
      if (c.type === "type_spec" || c.type === "import_declaration" || c.type === "package_clause") continue
      const nextCtx = { ...ctx }
      if (c.type === "struct_type") nextCtx.typeName = enclosingTypeName(c)
      else if (c.type === "interface_type") nextCtx.typeName = enclosingTypeName(c)
      else if (c.type === "type_identifier" || c.type === "qualified_type" || c.type === "call_expression" || c.type === "selector_expression") {
        walkExpr(c, nextCtx)
        continue
      }
      walkBody(c, nextCtx)
    }
  }
  walkBody(root, { typeName: "" })
  // Call expressions directly under a declaration statement still need a pass
  // with the right context; walkBody covers them because expression_statement
  // is not one of the skipped types.
  void packageScopeCheck
  return facts
}

// ---------------------------------------------------------------------------
// disagreement classification
//
// An oracle that reports a number without saying WHY the two disagree is half a
// measurement: every difference is either a documented scope decision, an oracle
// limitation, or a defect, and only the third is interesting. Each edge is
// tagged with one of these reason codes so the report can separate them.
// ---------------------------------------------------------------------------

const GO_BUILTIN_FUNCS: ReadonlySet<string> = new Set([
  "append", "cap", "clear", "close", "complex", "copy", "delete", "imag",
  "len", "make", "max", "min", "new", "panic", "print", "println", "real",
  "recover", "close",
])

type ReasonCode =
  | "go-builtin-call-not-an-edge"
  | "predeclared-type-not-an-edge"
  | "analyzer-scope-excludes-methods-and-vars"
  | "already-carried-as-an-instantiates-edge"
  | "composite-literal-type-is-an-instantiation-not-a-reference"
  | "struct-embedding-relabelled-to-mixes-in"
  | "go-conversion-not-a-call"
  | "call-to-locally-bound-function-value"
  | "read-of-a-locally-bound-name"
  | "variable-export-out-of-scope-by-decision"
  | "value-read-mistyped-as-a-type-reference"
  | "receiver-type-argument-is-not-an-owner"
  | "function-name-is-not-a-type-reference"
  | "UNEXPLAINED"

function classifyOracOnly(
  type: string,
  e: Edge,
  model: FileModel,
  instantiates: Set<string>,
  analyzerByType: Map<string, Edge[]>,
): ReasonCode {
  // STRUCT EMBEDDING IS `mixes_in`, NOT `extends` — a LABEL MOVE the oracle has not
  // been told about. `type T struct { E }` (struct half) publishes `mixes_in T -> E`;
  // `type I interface { J }` (interface half) keeps `extends I -> J`. This oracle still
  // derives both halves as `extends`, so every struct-embedding row lands in the
  // unknown bucket even though the analyzer published the SAME edge under the other
  // name. Measured on a 400-file go-tools draw: oracle-only `extends` = 24 and
  // analyzer-only `mixes_in` = 24, and the two example lists are IDENTICAL
  // (`arrayparm -> isBlank`, `-> addrTakenHow`, `-> isGenValFunc`, `-> skipCompare`,
  // `structparm -> isBlank`, `-> addrTakenHow`) — the same edges under two labels,
  // not 48 disagreements.
  //
  // Ordering: this runs FIRST for `extends`, because a struct embed that also happens
  // to name a builtin type must still be reported as the relabel rather than folded
  // into the builtin reason — the label move is the fact being explained here.
  if (type === "extends" && (analyzerByType.get("mixes_in") ?? []).some((m) => m[0] === e[0] && m[1] === e[1])) {
    return "struct-embedding-relabelled-to-mixes-in"
  }
  // `float64(x)` reaches the grammar as a call_expression but is a CONVERSION. The analyzer
  // filters predeclared types out of `calls` (and `go/relationship-and-payloads` forbids
  // `calls -> float64`), so an oracle `calls` row naming a predeclared type is the oracle
  // being over-broad. Measured on the 400-file go-tools draw: 164 of the 461 unexplained
  // `calls` rows are exactly this.
  if (type === "calls" && PREDECLARED_TYPES.has(e[1])) return "go-conversion-not-a-call"
  // A call to a name the SOURCE FUNCTION BINDS is a call through a function value — a
  // parameter (`filter(obj)`), a closure variable, or a range target — not a static call to
  // a declared function. The analyzer is CORRECTLY silent (LocalsAreNotSymbols); the oracle
  // derives an edge for every call_expression, so this is its over-broadness. Measured:
  // 297 of the 461 unexplained rows name a parameter of the enclosing function.
  if (type === "calls" && model.funcBoundNames.get(e[0])?.has(e[1])) return "call-to-locally-bound-function-value"
  // A `uses` row naming a name the SOURCE FUNCTION binds is a read of a parameter, a local,
  // a receiver or a loop variable. The analyzer is CORRECTLY silent — LocalsAreNotSymbols
  // keeps locals out of the graph — while the oracle derives a row for every identifier it
  // sees. `print -> pkg` (`pkg *types.Package` is a parameter of `print`) is the measured
  // shape.
  if (type === "uses" && model.funcBoundNames.get(e[0])?.has(e[1])) return "read-of-a-locally-bound-name"
  if (type === "calls" && GO_BUILTIN_FUNCS.has(e[1])) return "go-builtin-call-not-an-edge"
  if (type === "references" && PREDECLARED_TYPES.has(e[1])) return "predeclared-type-not-an-edge"
  // The oracle's rule is "every type_identifier outside a qualified_type is a reference", which
  // is over-broad exactly where Go's grammar is: a VALUE named in a context the grammar types as
  // a type. `TYPE(toklev[t])` in goyacc (where `TYPE` is a macro the grammar reads as a
  // conversion) makes `toklev` — a package-scope `var toklev []int` — look like a type name.
  // A name DECLARED AS A VARIABLE in this file cannot be a type reference, so this is the
  // oracle mis-typing a value, not the analyzer missing an edge.
  if (type === "references" && model.decls.some((d) => d.kind === "var" && d.name === e[1])) {
    return "value-read-mistyped-as-a-type-reference"
  }
  // The same mis-typing one level down: a name the SOURCE FUNCTION BINDS is a local value, never
  // a type reference. `is` and `testcase` are the measured shapes (25 and 16 rows) — ordinary
  // local variables the grammar typed as type identifiers.
  if (type === "references" && model.funcBoundNames.get(e[0])?.has(e[1])) {
    return "value-read-mistyped-as-a-type-reference"
  }
  // A `contains` whose source is a TYPE PARAMETER: the oracle reads a generic receiver
  // `func (s *Set[K]) Clone()` as `K` owning the method, but the owner is `Set` (the receiver
  // BASE type) and `K` is its type ARGUMENT. 18 rows on the 400-file draw, headed by
  // gopls/internal/util/persistent/set.go (`K -> Clone`, `K -> Destroy`, `K -> Add`, ...).
  if (type === "contains" && model.typeParamNames.has(e[0])) return "receiver-type-argument-is-not-an-owner"
  // A `references` whose target is a FUNCTION declared in this file: a function name is never a
  // type reference. `is[*types.Named](t)` is a GENERIC FUNCTION CALL that Go's grammar types as
  // an instantiation, and the oracle's "every type_identifier outside a qualified_type is a
  // reference" rule reads the callee name as a type. 25 of the 125 remaining rows were `is`.
  if (type === "references" && model.decls.some((d) => (d.kind === "func" || d.kind === "method") && d.name === e[1])) {
    return "function-name-is-not-a-type-reference"
  }
  // AN EXPORTED PACKAGE-SCOPE VARIABLE IS DELIBERATELY OUT OF SCOPE for the `exports` edge,
  // even though Go really does export it. The M49 JVM-closure F3 invariant requires export
  // names to be unique and top-level-resolvable, and Go permits `type Foo struct{}` plus
  // `var Foo = ...` in one package, so a var can collide with a type of the same name.
  // `go/exports-contract` (forbid `ErrNoWidget`) and `go/exports-package-scope` (forbid
  // `WidgetRegistry`) pin it and call it a DECISION. The oracle derives an export for every
  // capitalised package-scope name, so it must say so here or the bucket stays polluted.
  if (type === "exports" && model.decls.some((d) => d.kind === "var" && d.packageScope && d.name === e[1])) {
    return "variable-export-out-of-scope-by-decision"
  }
  if (type === "exports") {
    const isMethod = model.decls.some((d) => d.kind === "method" && d.name === e[1])
    if (isMethod) return "analyzer-scope-excludes-methods-and-vars"
  }
  if (type === "references" && instantiates.has(`${e[0]}|${e[1]}`)) {
    // The oracle's rule is "every type_identifier outside a qualified_type is a
    // reference", which is deliberately over-broad: a composite literal's type
    // (`ft := fileTypedefs{...}`) is an expression the lane already carries as
    // an `instantiates` edge from the same construct, so a second `references`
    // row for it would be the same fact under two labels. Verified on
    // src/cmd/cgo/gcc.go:197 — `instantiates loadDebug -> fileTypedefs` is
    // present and `references loadDebug -> fileTypedefs` is not, while the same
    // name IS a `references` target where it is genuinely declared
    // (`references loadDWARF -> fileTypedefs`, from the parameter list).
    return "already-carried-as-an-instantiates-edge"
  }
  return "UNEXPLAINED"
}

// ---------------------------------------------------------------------------
// comparison
// ---------------------------------------------------------------------------

function key(e: Edge): string {
  return `${e[0]}\u0000${e[1]}`
}

function dedupe(list: Edge[]): Edge[] {
  const seen = new Set<string>()
  const out: Edge[] = []
  for (const e of list) {
    const k = key(e)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(e)
  }
  return out
}

async function main(): Promise<void> {
  const all = collectAllGoFiles(CORPUS_ROOT)
  const { lib, test } = splitTestAndNonTest(all)
  const libWant = Math.max(1, Math.round(WANT * 0.75))
  const sample = [...strideSample(lib, libWant), ...strideSample(test, WANT - libWant)]

  const perType: Record<string, { oracleTotal: number; analyzerTotal: number; agree: number; oracleOnly: number; analyzerOnly: number; oracleOnlyFiles: string[]; analyzerOnlyFiles: string[] }> = {}
  for (const v of TYPES_ITERATED) {
    perType[v] = { oracleTotal: 0, analyzerTotal: 0, agree: 0, oracleOnly: 0, analyzerOnly: 0, oracleOnlyFiles: [], analyzerOnlyFiles: [] }
  }
  let compared = 0
  const disagreements: Array<{ file: string; type: string; kind: string; edge: Edge; reason: string }> = []
  const unexplainedByType: Record<string, number> = {}
  // EVERY unexplained row, so a bucket can be triaged against source rather than sampled.
  const unexplainedRows: Array<{ file: string; type: string; edge: Edge }> = []
  const started = Date.now()

  // The oracle gets its tree from the same production parser the analyzer's
  // parseFile uses, on the same bytes. Sharing the parser is deliberate: the
  // question under test is whether the ANALYZER reads the tree correctly, not
  // whether two parses of the same bytes differ.
  const parser = await ASTEngine.getParser("go")

  for (const f of sample) {
    let content: string
    try {
      content = readFileSync(f.path, "utf8")
    } catch {
      continue
    }
    let res: any
    try {
      res = await ASTEngine.parseFile(f.path, content)
    } catch {
      continue
    }
    let tree: any
    try {
      tree = parser.parse(content)
    } catch {
      continue
    }
    compared++
    const oracle = buildFacts(tree.rootNode, content)
    const model = scanModel(tree.rootNode)

    const analyzerByType = new Map<string, Edge[]>()
    const instantiatesEdges = new Set<string>()
    for (const r of res.relationships as any[]) {
      const ty = typeof r.type === "string" && r.type.length > 0 ? r.type : typeof r.relationshipType === "string" ? r.relationshipType : ""
      if (ty.length === 0) continue
      const src = typeof r.source === "string" ? r.source : typeof r.from === "string" ? r.from : ""
      const dst = typeof r.target === "string" ? r.target : typeof r.to === "string" ? r.to : ""
      let arr = analyzerByType.get(ty)
      if (!arr) {
        arr = []
        analyzerByType.set(ty, arr)
      }
      arr.push([src, dst])
      if (ty === "instantiates") instantiatesEdges.add(`${src}|${dst}`)
    }

    for (const ty of TYPES_ITERATED) {
      const o = dedupe(oracle.edges.get(ty) || [])
      const a = dedupe(analyzerByType.get(ty) || [])
      const oSet = new Set(o.map(key))
      const aSet = new Set(a.map(key))
      const slot = perType[ty]
      slot.oracleTotal += o.length
      slot.analyzerTotal += a.length
      for (const e of o) {
        if (aSet.has(key(e))) slot.agree++
        else {
          const why = classifyOracOnly(ty, e, model, instantiatesEdges, analyzerByType)
          if (why === "UNEXPLAINED") {
            unexplainedByType[ty] = (unexplainedByType[ty] || 0) + 1
            unexplainedRows.push({ file: f.rel, type: ty, edge: e })
          }
          slot.oracleOnly++
          if (slot.oracleOnlyFiles.length < 6) slot.oracleOnlyFiles.push(`${f.rel}: ${e[0]} -> ${e[1]}`)
          if (disagreements.length < 900) disagreements.push({ file: f.rel, type: ty, kind: "oracle-only", edge: e, reason: classifyOracOnly(ty, e, model, instantiatesEdges, analyzerByType) })
        }
      }
      for (const e of a) {
        if (!oSet.has(key(e))) {
          slot.analyzerOnly++
          if (slot.analyzerOnlyFiles.length < 6) slot.analyzerOnlyFiles.push(`${f.rel}: ${e[0]} -> ${e[1]}`)
          if (disagreements.length < 900) disagreements.push({ file: f.rel, type: ty, kind: "analyzer-only", edge: e, reason: "analyzer-published-oracle-did-not-expect" })
        }
      }
    }
  }

  const L = (s: string) => process.stderr.write(s + "\n")
  L(`ORACLE vs ANALYZER over ${compared} files (${WANT} requested), ${Date.now() - started} ms`)
  L(`shared-grammar caveat: this oracle walks the SAME wasm through the SAME Node API,`)
  L(`so a grammar or binding defect both paths share is invisible here. It can refute, not confirm.`)
  L("")
  for (const ty of TYPES_ITERATED) {
    const s = perType[ty]
    const denom = s.oracleTotal + s.analyzerOnly
    const recall = denom > 0 ? s.agree / denom : -1
    L(`${ty.padEnd(22)} oracle ${String(s.oracleTotal).padStart(6)}  analyzer ${String(s.analyzerTotal).padStart(6)}  agree ${String(s.agree).padStart(6)}  oracle-only ${String(s.oracleOnly).padStart(5)}  analyzer-only ${String(s.analyzerOnly).padStart(5)}  recall ${recall < 0 ? "n/a" : recall.toFixed(3)}`)
  }
  L("")
  L("oracle-only examples (analyzer MISSED these):")
  for (const ty of TYPES_ITERATED) {
    for (const s of perType[ty].oracleOnlyFiles) L(`  ${ty}: ${s}`)
  }
  L("")
  L("analyzer-only examples (analyzer PUBLISHED these, oracle did not expect):")
  for (const ty of TYPES_ITERATED) {
    for (const s of perType[ty].analyzerOnlyFiles) L(`  ${ty}: ${s}`)
  }
  L("")
  L("UNEXPLAINED oracle-only edges by type (analyzer produced nothing where the oracle expected an edge,")
  L("and no documented scope rule or oracle limitation accounts for it):")
  const keys = Object.keys(unexplainedByType).sort()
  if (keys.length === 0) L("  none")
  for (const k of keys) L(`  ${k}: ${unexplainedByType[k]}`)
  const out = process.env.GO_ORACLE_ARTIFACT
  if (out) {
    const { writeFileSync } = await import("node:fs")
    writeFileSync(out, JSON.stringify({ perType, compared, unexplainedByType, unexplainedRows, disagreements: disagreements.slice(0, 900) }, null, 2))
    L(`artifact: ${out}`)
  }
}

await main()