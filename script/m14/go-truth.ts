// GO LANE — the two truth derivations differential does not carry: `exports` and `overrides`.
//
// WHY THIS FILE EXISTS. The go analyzer emits TEN relationship labels; the differential compares
// EIGHT (base extends/implements/instantiates/calls + references/contains/uses/imports). The two
// emitted-but-unmeasured labels are:
//   exports    — every package-scope exported identifier (`go_exported_identifier`, source = the
//                package name, target = the capitalized name), 2,396 rows at the accepted cap-400
//                draw scale and growing with the population;
//   overrides  — Go's METHOD-PROMOTION SHADOWING (`go_method_promotion_shadowing`): an outer type's
//                method that shadows a method promoted from an embedded type. The shared harness
//                excluded go from `overrides` on the strength of the *stale* GO41 note "the go
//                analyzer emits zero of them"; the cap-400 arm measured 2 rows, so the rationale is
//                false at current HEAD and the label needs an oracle (or a corrected ruling).
//
// Each derivation is written FROM THE GRAMMAR, independently of the analyzer — the family rule. The
// contract harness `script/m14/go-oracle-contract.ts` measures agreement with the analyzer over a
// deterministic population sample BEFORE the Lead wires them into `differential.ts`.
import type { Node } from "web-tree-sitter"

export type GoTruthEdge = { label: string; from: string; target: string; line: number }

/** Field/child helpers (tree-sitter-go names). */
function namedChildren(n: Node): Node[] {
  const out: Node[] = []
  for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) out.push(c) }
  return out
}
function firstChildOfType(n: Node, type: string): Node | null {
  for (const c of namedChildren(n)) if (c.type === type) return c
  return null
}
function field(n: Node, name: string): Node | null {
  return n.childForFieldName ? n.childForFieldName(name) : null
}
function text(n: Node | null): string { return n ? (n.text ?? "") : "" }
/** Go's export rule is "first character is an upper-case letter"; ASCII covers this corpus. */
function isExportedGoName(name: string): boolean {
  if (!name) return false
  const c = name.charCodeAt(0)
  return c >= 65 && c <= 90
}
function walk(root: Node, visit: (n: Node) => void): void {
  const stack: Node[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    visit(n)
    const kids = namedChildren(n)
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]!)
  }
}
/** The declared name(s) of a var/const spec: `x := …` has one; `a, b = …` has an identifier_list. */
function specNames(spec: Node): Node[] {
  const names: Node[] = []
  for (const c of namedChildren(spec)) {
    if (c.type === "identifier") { names.push(c); continue }
    if (c.type === "identifier_list") { for (const x of namedChildren(c)) if (x.type === "identifier") names.push(x); continue }
    // the first non-identifier child starts the type/value side
    if (names.length > 0) break
  }
  return names
}
/** The package clause's name. */
export function goPackageName(root: Node): string {
  let name = ""
  walk(root, (n) => {
    if (name) return
    if (n.type === "package_clause") {
      const id = firstChildOfType(n, "package_identifier") ?? firstChildOfType(n, "identifier")
      if (id) name = text(id)
    }
  })
  return name
}

/**
 * TRUTH for `exports` — the package's exported identifier surface.
 *
 * The analyzer's export pass (`go_exported_identifier`) publishes, per file, one edge
 * `package → Name` for each PACKAGE-SCOPE declaration whose name is exported: top-level funcs,
 * types (incl. aliases), vars and consts. Methods are NOT package-scope names in Go (they are
 * reached through their receiver type), so they are not exports; they are covered by `contains`
 * and `overrides`.
 */
export function deriveGoExportsTruth(root: Node): GoTruthEdge[] {
  const pkg = goPackageName(root)
  const out: GoTruthEdge[] = []
  const seen = new Set<string>()
  if (!pkg) return out
  const push = (name: string, line: number): void => {
    if (!isExportedGoName(name)) return
    const key = `${pkg}->${name}`
    if (seen.has(key)) return
    seen.add(key)
    out.push({ label: "exports", from: pkg, target: name, line })
  }
  // PACKAGE SCOPE = the source_file's DIRECT children, and nothing else. The first
  // version walked the whole tree and over-derived function-local types
  // (`type Alias Intention` inside MarshalJSON, `type FakeMain struct{…}` inside a test)
  // and a block-scoped `const` — 4 rows the analyzer correctly does not export
  // (`exports-package-scope` fixture pins exactly this rule).
  //
  // THE LANE'S DECLARED CONTRACT IS NARROWER THAN GO'S FULL SURFACE, on purpose: a
  // package-scope exported VAR is not carried (`exports-contract.go` FORBIDS it — a
  // `type Foo struct{}; var Foo = …` name collision cannot share a name-keyed export
  // slot under the F3 invariant), and methods are members (they ride `contains`). This
  // oracle derives the surface the EDGE claims: exported package-scope funcs, types
  // (incl. aliases) and consts. The omitted var surface is priced separately by
  // `deriveGoExportedVarsTruth` and recorded as a declared wall, never silently.
  const top = namedChildren(root)
  for (const n of top) {
    if (n.type === "function_declaration") {
      const name = text(field(n, "name"))
      if (name) push(name, n.startPosition.row + 1)
      continue
    }
    if (n.type === "type_declaration") {
      for (const c of namedChildren(n)) {
        if (c.type !== "type_spec" && c.type !== "type_alias") continue
        const name = text(field(c, "name"))
        if (name) push(name, c.startPosition.row + 1)
      }
      continue
    }
    if (n.type === "const_declaration") {
      for (const c of namedChildren(n)) {
        if (c.type !== "const_spec") continue
        for (const nm of specNames(c)) {
          const name = text(nm)
          if (name) push(name, c.startPosition.row + 1)
        }
      }
    }
  }
  return out
}

/**
 * The DELIBERATE export-surface gap, priced: exported PACKAGE-SCOPE VARIABLES. The `exports`
 * edge does not carry them by contract (fixture `exports-contract.go` forbids the case), so this
 * derivation exists only for the wall ledger and the whole-population count — it is NOT wired into
 * the differential. Same package-scope rule as above, vars only.
 */
export function deriveGoExportedVarsTruth(root: Node): GoTruthEdge[] {
  const pkg = goPackageName(root)
  const out: GoTruthEdge[] = []
  if (!pkg) return out
  for (const n of namedChildren(root)) {
    if (n.type !== "var_declaration") continue
    for (const c of namedChildren(n)) {
      if (c.type !== "var_spec") continue
      for (const nm of specNames(c)) {
        const name = text(nm)
        if (isExportedGoName(name)) out.push({ label: "exports", from: pkg, target: name, line: c.startPosition.row + 1 })
      }
    }
  }
  return out
}

/**
 * TRUTH for `overrides` — Go's METHOD-PROMOTION SHADOWING.
 *
 * Both endpoints are member identities (`Type.Method`). An edge exists when, WITHIN THIS FILE:
 *   · `Outer` declares a method `M`, and
 *   · `Outer` embeds (directly or transitively, depth ≤ 4) a type `Embedder` that declares its own
 *     method `M` in the same file.
 * A type may embed several types; Go's selector rule makes the SHALLOWEST promotion the one being
 * shadowed, so the recorded depth is the shallowest (a diamond yields ONE edge per pair, not one
 * per path). Cross-file embeddings/methods are invisible to a per-file truth — residual rows are
 * named in the contract report rather than guessed.
 */
export function deriveGoOverridesTruth(root: Node): GoTruthEdge[] {
  const out: GoTruthEdge[] = []
  const seen = new Set<string>()
  const methodsByType = new Map<string, Set<string>>() // receiver type -> method names in this file
  const embeddedOf = new Map<string, string[]>() // type -> directly embedded type names in this file
  const receiverNameOf = (m: Node): string => {
    // method_declaration receiver is a parameter_list: `(r T)` / `(r *T)` / `(r T[P])`
    const recv = field(m, "receiver")
    if (!recv) return ""
    const param = firstChildOfType(recv, "parameter_declaration")
    if (!param) return ""
    const t = field(param, "type") ?? param.namedChild(param.namedChildCount - 1)
    const base = goTypeBaseName(t)
    return base
  }
  const goTypeBaseName = (t: Node | null): string => {
    if (!t) return ""
    if (t.type === "type_identifier") return text(t)
    if (t.type === "pointer_type") return goTypeBaseName(firstChildOfType(t, "type_identifier"))
    if (t.type === "generic_type") return goTypeBaseName(firstChildOfType(t, "type_identifier"))
    // fall back: first type_identifier descendant
    let found = ""
    walk(t, (n) => { if (!found && n.type === "type_identifier") found = text(n) })
    return found
  }
  walk(root, (n) => {
    if (n.type === "method_declaration") {
      const name = text(field(n, "name"))
      const recv = receiverNameOf(n)
      if (name && recv) {
        const set = methodsByType.get(recv) ?? new Set<string>()
        set.add(name)
        methodsByType.set(recv, set)
      }
      return
    }
    if (n.type === "type_declaration") {
      for (const c of namedChildren(n)) {
        if (c.type !== "type_spec" && c.type !== "type_alias") continue
        const tname = text(field(c, "name"))
        if (!tname) continue
        const structType = firstChildOfType(c, "struct_type")
        if (!structType) continue
        const fieldList = firstChildOfType(structType, "field_declaration_list")
        if (!fieldList) continue
        const embedded: string[] = []
        for (const f of namedChildren(fieldList)) {
          if (f.type !== "field_declaration") continue
          // an embedded field has NO name — only a type (e.g. `Base` / `*Base` / `pkg.Base`)
          if (field(f, "name")) continue
          const t = field(f, "type") ?? f.namedChild(f.namedChildCount - 1)
          const base = goTypeBaseName(t)
          if (base && base !== tname) embedded.push(base)
        }
        if (embedded.length > 0) embeddedOf.set(tname, embedded)
      }
    }
  })
  for (const [outer, ownMethods] of methodsByType) {
    for (const m of ownMethods) {
      // shallowest promotion of M onto `outer` through this file's embedding graph
      const best = new Map<string, number>() // embedder -> depth
      const promoted = (tname: string, depth: number, visiting: Set<string>): void => {
        if (depth > 4 || visiting.has(tname)) return
        visiting.add(tname)
        for (const et of embeddedOf.get(tname) ?? []) {
          if (et !== outer && methodsByType.get(et)?.has(m)) {
            const prior = best.get(et)
            if (prior === undefined || depth + 1 < prior) best.set(et, depth + 1)
          }
          promoted(et, depth + 1, visiting)
        }
        visiting.delete(tname)
      }
      promoted(outer, 0, new Set())
      for (const [embedder, depth] of best) {
        void depth
        const key = `${outer}.${m}->${embedder}.${m}`
        if (seen.has(key)) continue
        seen.add(key)
        out.push({ label: "overrides", from: `${outer}.${m}`, target: `${embedder}.${m}`, line: 0 })
      }
    }
  }
  return out
}

/**
 * TRUTH for `renders` — Go's render host is the TEMPLATE EXECUTION, and the rendered
 * component must be a PUBLISHED symbol.
 *
 * Written FROM THE GRAMMAR, independently of the analyzer (the family rule; the contract
 * harness `script/m14/go-oracle-contract.ts` measures agreement before wiring):
 *
 *   1. THE RENDER HOST FILTER IS THE IMPORT. The file must import `html/template`, and the
 *      qualifier is that import's OWN local name (an unaliased import binds `template`; an
 *      alias binds the alias). `text/template` is the measured IMPOSTOR class — 151 corpus
 *      files, almost all code generators — and it cannot be admitted through an alias
 *      because the qualifier is resolved to the html/template binding, not to the spelling
 *      "template". A dot-imported (`import . "html/template"`) constructor cannot be
 *      qualified, so it derives NOTHING: the construct is unprovable, and an unprovable
 *      render is not published as a row.
 *
 *   2. THE RENDERED COMPONENT MUST BE A PUBLISHED SYMBOL: a PACKAGE-LEVEL `var` whose
 *      initializer constructs a template through that qualifier (`Must`, `New`, `ParseFiles`,
 *      `ParseGlob`, `ParseFS`; `Parse` is a METHOD, not a constructor). Locals, parameters,
 *      struct fields, call results and name strings can never enter the set, because only
 *      package-level var initialisers are collected and only IDENTIFIER operands are
 *      matched — the MUST-NOT classes are excluded by CONSTRUCTION here, not by a filter.
 *
 *   3. THE RENDER SITE is `<component>.(Execute|ExecuteTemplate)(...)` inside a
 *      function/method body; the source is that enclosing symbol. One edge per
 *      (source, target) — the relation is "this symbol renders that template", and a body
 *      that executes the same template twice is one fact (the lane's per-set convention).
 *      The LINE is the OPERAND's line: the rendered symbol's own name at the call site
 *      (M59.A7), which differs from the Execute token's line when the selector wraps.
 *
 * Cross-file execution derives nothing: a per-file truth cannot prove that a bare identifier
 * from another file of the package is a template, and the limitation is named rather than
 * guessed around.
 */
export function deriveGoRendersTruth(root: Node): GoTruthEdge[] {
  const out: GoTruthEdge[] = []
  const unquote = (raw: string): string =>
    raw.length >= 2 && raw.charCodeAt(0) === 34 && raw.charCodeAt(raw.length - 1) === 34 ? raw.slice(1, -1) : raw

  // 1. THE RENDER HOST — the html/template import's own local name.
  let host = ""
  let dotImport = false
  walk(root, (n) => {
    if (n.type !== "import_spec") return
    if (unquote(text(field(n, "path"))) !== "html/template") return
    const alias = text(field(n, "name"))
    if (alias === "_") return
    if (alias === ".") { dotImport = true; return }
    host = alias || "template"
  })
  if (!host || dotImport) return out

  // 2. THE PUBLISHED COMPONENT SET — package-level `var` initialisers only.
  const CONSTRUCTORS = ["Must", "New", "ParseFiles", "ParseGlob", "ParseFS"]
  const hostCall = (n: Node): boolean => {
    if (n.type !== "call_expression") return false
    const fn = field(n, "function")
    if (!fn || fn.type !== "selector_expression") return false
    const op = field(fn, "operand")
    const fld = field(fn, "field")
    if (!op || op.type !== "identifier" || text(op) !== host) return false
    return CONSTRUCTORS.indexOf(text(fld)) !== -1
  }
  const containsConstruction = (n: Node, depth: number): boolean => {
    if (depth > 6) return false
    if (hostCall(n)) return true
    for (const c of namedChildren(n)) if (containsConstruction(c, depth + 1)) return true
    return false
  }
  const components = new Set<string>()
  for (const decl of namedChildren(root)) {
    if (decl.type !== "var_declaration") continue
    for (const spec of namedChildren(decl)) {
      if (spec.type !== "var_spec") continue
      const value = field(spec, "value")
      if (!value || !containsConstruction(value, 0)) continue
      for (const nm of specNames(spec)) {
        const name = text(nm)
        if (name.length > 0 && name !== "_") components.add(name)
      }
    }
  }
  if (components.size === 0) return out

  // 3. THE RENDER SITES — inside a function/method body, `<component>.Execute*`.
  const enclosingFunction = (n: Node): string => {
    let cur: Node | null = n.parent
    while (cur) {
      if (cur.type === "function_declaration" || cur.type === "method_declaration") return text(field(cur, "name"))
      cur = cur.parent
    }
    return ""
  }
  const seen = new Set<string>()
  walk(root, (n) => {
    if (n.type !== "call_expression") return
    const fn = field(n, "function")
    if (!fn || fn.type !== "selector_expression") return
    const op = field(fn, "operand")
    const method = text(field(fn, "field"))
    if (method !== "Execute" && method !== "ExecuteTemplate") return
    if (!op || op.type !== "identifier") return
    const target = text(op)
    if (!components.has(target)) return
    const from = enclosingFunction(n)
    if (!from) return
    const key = `${from}|${target}`
    if (seen.has(key)) return
    seen.add(key)
    out.push({ label: "renders", from, target, line: op.startPosition.row + 1 })
  })
  return out
}
