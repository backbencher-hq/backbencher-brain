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

const WANT = Number(process.argv[2] || 140)
const CORPUS_ROOT = process.argv[3] || "$HOME/fixtures/repositories/go-stdlib"
const ENUM_VALUES: string[] = [...new Set(Object.values(RelationshipType))]
const OFF_ENUM_IMPORTS = "imports"

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
  limits: string[]
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

  for (const top of named(root)) {
    switch (top.type) {
      case "function_declaration": {
        const nm = textOf(field(top, "name"))
        if (nm.length > 0) {
          model.decls.push({ name: nm, kind: "func", packageScope: true, exported: isGoExportedIdentifier(nm), line: top.startPosition.row + 1 })
          model.topLevelFuncs.add(nm)
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
    } else if (t === "selector_expression" && n.parent && n.parent.type !== "call_expression") {
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
  | "UNEXPLAINED"

function classifyOracOnly(type: string, e: Edge, model: FileModel, instantiates: Set<string>): ReasonCode {
  if (type === "calls" && GO_BUILTIN_FUNCS.has(e[1])) return "go-builtin-call-not-an-edge"
  if (type === "references" && PREDECLARED_TYPES.has(e[1])) return "predeclared-type-not-an-edge"
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
  for (const v of [...ENUM_VALUES, OFF_ENUM_IMPORTS]) {
    perType[v] = { oracleTotal: 0, analyzerTotal: 0, agree: 0, oracleOnly: 0, analyzerOnly: 0, oracleOnlyFiles: [], analyzerOnlyFiles: [] }
  }
  let compared = 0
  const disagreements: Array<{ file: string; type: string; kind: string; edge: Edge; reason: string }> = []
  const unexplainedByType: Record<string, number> = {}
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

    for (const ty of [...ENUM_VALUES, OFF_ENUM_IMPORTS]) {
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
          if (classifyOracOnly(ty, e, model, instantiatesEdges) === "UNEXPLAINED") unexplainedByType[ty] = (unexplainedByType[ty] || 0) + 1
          slot.oracleOnly++
          if (slot.oracleOnlyFiles.length < 6) slot.oracleOnlyFiles.push(`${f.rel}: ${e[0]} -> ${e[1]}`)
          if (disagreements.length < 900) disagreements.push({ file: f.rel, type: ty, kind: "oracle-only", edge: e, reason: classifyOracOnly(ty, e, model, instantiatesEdges) })
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
  for (const ty of [...ENUM_VALUES, OFF_ENUM_IMPORTS]) {
    const s = perType[ty]
    const denom = s.oracleTotal + s.analyzerOnly
    const recall = denom > 0 ? s.agree / denom : -1
    L(`${(ty === OFF_ENUM_IMPORTS ? `${ty} (off-enum)` : ty).padEnd(22)} oracle ${String(s.oracleTotal).padStart(6)}  analyzer ${String(s.analyzerTotal).padStart(6)}  agree ${String(s.agree).padStart(6)}  oracle-only ${String(s.oracleOnly).padStart(5)}  analyzer-only ${String(s.analyzerOnly).padStart(5)}  recall ${recall < 0 ? "n/a" : recall.toFixed(3)}`)
  }
  L("")
  L("oracle-only examples (analyzer MISSED these):")
  for (const ty of [...ENUM_VALUES, OFF_ENUM_IMPORTS]) {
    for (const s of perType[ty].oracleOnlyFiles) L(`  ${ty}: ${s}`)
  }
  L("")
  L("analyzer-only examples (analyzer PUBLISHED these, oracle did not expect):")
  for (const ty of [...ENUM_VALUES, OFF_ENUM_IMPORTS]) {
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
    writeFileSync(out, JSON.stringify({ perType, compared, unexplainedByType, disagreements: disagreements.slice(0, 900) }, null, 2))
    L(`artifact: ${out}`)
  }
}

await main()