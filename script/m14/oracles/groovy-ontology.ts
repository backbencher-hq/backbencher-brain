/**
 * The GROOVY `contains` / `references` / `imports` / `exports` oracle — an
 * independent derivation of four labels the differential never audited.
 *
 * ## Why this file exists
 *
 * `validation/m60/rel-type-coverage-baseline.json` records, measured against this
 * commit:
 *
 *   DERIVATION|groovy|emits `contains`   but the differential audits
 *       ["calls","extends","implements","instantiates","overrides","uses"]
 *   DERIVATION|groovy|emits `references` but the differential audits (the same six)
 *
 * "Stored and compared against nothing." The differential's own output says so in
 * its own words when a label is in the comparison set with no truth: "every one of
 * its edges lands in unexplained (a confident fabrication) or heuristic (declared
 * suspicion). Neither is coverage." `imports` and `exports` join the list the moment
 * the analyzer starts emitting them, and this file is what makes them non-empty.
 *
 * ## What independence this oracle has, and what it does not
 *
 * It has a separate walker, separate node accessors and separate name rules. Where
 * the analyzer reads ONE `scoped_identifier` child and takes its `.text`, this file
 * rebuilds the name by DESCENDING the dotted spine and collecting the `identifier`
 * leaves, then re-joining them; where the analyzer resolves ownership through a
 * `scopeStack` pushed during a single traversal, this file resolves it by walking
 * `node.parent` and asking "is any ancestor a type declaration?". Two implementations
 * of one rule disagree when either is wrong.
 *
 * It does NOT have an independent grammar. Both sides load `wasm/tree-sitter-groovy.wasm`,
 * so a bug IN the grammar — a node type that never matches, a field never populated —
 * is invisible here exactly as it is to the differential. That is the L3 ceiling in
 * `docs/M14-HONESTY-CONTRACT.md` §2 and it is recorded rather than papered over.
 *
 * ## The rules, one per label, with the language clause each comes from
 *
 *   contains    owner -> owned member, for every member whose OWNER is a type this
 *               file declares. The owner is the nearest enclosing type declaration
 *               reached by `parent`; a member with no enclosing type has no owner
 *               and no edge. Identity is `owner -> member NAME`, which is what the
 *               analyzer's vocabulary can express (the differential-harness key does
 *               not carry the owner symbol's file).
 *
 *   references  TWO distinct populations share this label in Groovy and the oracle
 *               derives both, because the analyzer emits both:
 *                 (a) IMPORT mentions — one row per `import_declaration`, target the
 *                     dotted name as written (the `scoped_identifier` spine);
 *                 (b) DECLARED-TYPE mentions — the qualified type names in
 *                     declaration positions: fields, formal parameters, return types,
 *                     `throws`, `catch` types, `instanceof` patterns, `as` coercions
 *                     and C-style casts.
 *               A BARE type name is NOT derived: the analyzer emits declared-type
 *               references only for a name containing a `.` (measured rule, pinned by
 *               the `scoped-type-references` fixture), and the oracle must not be able
 *               to disagree with itself about which half it is checking.
 *
 *   imports     one dependency per `import_declaration` (Groovy docs, "Import
 *               statements": single-type, on-demand type, static member, static
 *               on-demand, plus the `as` alias). The alias is the LOCAL name and is
 *               not part of the dependency, the same doctrine the TypeScript oracle
 *               states for `import { b as c }`: `c` is what THIS file calls it, the
 *               dotted path is what the exporting side calls it, and dropping the
 *               alias is what lets the two files join.
 *
 *   exports     the importable units this file publishes. Groovy has no `export`
 *               keyword, so this is NOT derived from a directive; it is the M49
 *               converged family doctrine ("exports = importable units: top-level
 *               types and top-level functions"), which is the same rule the analyzer's
 *               own `ExportInfo` list already implements and which `groovy/trait-exports`
 *               and `groovy/anon-exports` pin. A Groovy top-level type is published by
 *               being in a NAMED package: the compiler writes `<pkg>/<Name>.class` and
 *               `import <pkg>.<Name>` resolves to it. A type in the default package is
 *               NOT derived — Groovy gives it no importable name — and a top-level type
 *               whose visibility is not public is NOT derived, for the reason java's
 *               JLS 7.6 gate gives (measured: 6 non-public top-level types in the
 *               pinned corpus).
 */

export interface GroovyOntologyRow {
  label: "contains" | "references" | "imports" | "exports"
  source: string
  target: string
}

const TYPE_DECLARATIONS = new Set([
  "class_declaration", "interface_declaration", "trait_declaration",
  "enum_declaration", "record_declaration", "annotation_type_declaration",
])

const DECLARATION_TYPES = new Set([
  "method_declaration", "constructor_declaration", "function_definition",
  "field_declaration", "constant_declaration", "enum_constant",
])

/** A name is a dotted type name: identifier characters and dots on one line. */
function isDottedName(text: string): boolean {
  if (text.length === 0) return false
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    const ok =
      (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || (c >= 48 && c <= 57) ||
      c === 95 /* _ */ || c === 36 /* $ */ || c === 46 /* . */
    if (!ok) return false
  }
  return true
}

/**
 * The dotted name of an import's target, rebuilt by DESCENDING the spine.
 *
 * `scoped_identifier(a, ".", scoped_identifier(b, ".", c))` — or, in the pinned
 * grammar, the flat `scoped_identifier` whose `.text` is the whole path. Both shapes
 * occur, so this accepts either: it collects the `identifier` leaves and rejoins them
 * with `.`, which yields the same string for a flat node and is the only way to get
 * the right answer for a nested one.
 */
function dottedSpine(node: any): string | undefined {
  const leaves: string[] = []
  const stack: any[] = [node]
  while (stack.length > 0) {
    const n = stack.pop()!
    if (n.type === "identifier") { leaves.unshift(n.text); continue }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
  if (leaves.length === 0) return undefined
  const joined = leaves.join(".")
  return isDottedName(joined) ? joined : undefined
}

/** The `package` this compilation unit declares, or "". */
export function groovyPackage(root: any): string {
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    if (n.type === "package_declaration") {
      const id = n.namedChildren?.find((c: any) => c && (c.type === "scoped_identifier" || c.type === "identifier"))
      if (id) {
        const spine = dottedSpine(id)
        if (spine) return spine
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) stack.push(c) }
  }
  return ""
}

/** The enclosing type declaration's simple name, or undefined. */
function enclosingTypeName(n: any): string | undefined {
  let p = n.parent
  let guard = 0
  while (p && guard++ < 64) {
    if (TYPE_DECLARATIONS.has(p.type)) {
      for (let i = 0; i < p.namedChildCount; i++) {
        const c = p.namedChild(i)
        if (c && c.type === "identifier") return c.text
      }
      return undefined
    }
    p = p.parent
  }
  return undefined
}

/** True when no type declaration encloses `n` — a top-level (script-level) unit. */
function isTopLevel(n: any): boolean {
  let p = n.parent
  let guard = 0
  while (p && guard++ < 64) {
    if (TYPE_DECLARATIONS.has(p.type)) return false
    p = p.parent
  }
  return true
}

/** Written visibility on a declaration: "public" | "private" | "protected" | undefined. */
function writtenVisibility(node: any): string | undefined {
  const mods = node.namedChildren?.find((c: any) => c && c.type === "modifiers")
  if (!mods) return undefined
  const text = String(mods.text ?? "")
  if (text.includes("private")) return "private"
  if (text.includes("protected")) return "protected"
  if (text.includes("public")) return "public"
  return undefined
}

/** `imports`: one dependency per import declaration. */
export function deriveGroovyImportsTruth(root: any): GroovyOntologyRow[] {
  const out: GroovyOntologyRow[] = []
  const pkg = groovyPackage(root)
  const stack: any[] = [root]
  const seen = new Set<string>()
  while (stack.length > 0) {
    const n = stack.pop()!
    if (n.type === "import_declaration") {
      const mod = n.namedChildren?.find((c: any) => c && (c.type === "scoped_identifier" || c.type === "identifier"))
      const target = mod ? dottedSpine(mod) : undefined
      // The source is the importing compilation unit. A package is the unit that
      // declares the dependency and is the join key against an `exports` row
      // (`source + "." + target` is the dotted name an importer writes); a file with
      // no package declaration is sourced at "(script)", the same sentinel the
      // analyzer's calls walk uses.
      const source = pkg || "(script)"
      if (target) {
        const key = `${source}->${target}`
        if (!seen.has(key)) { seen.add(key); out.push({ label: "imports", source, target }) }
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) stack.push(c) }
  }
  return out
}

/** `exports`: the importable units this file publishes. */
export function deriveGroovyExportsTruth(root: any): GroovyOntologyRow[] {
  const out: GroovyOntologyRow[] = []
  const pkg = groovyPackage(root)
  // No package declaration ⇒ every type in the file is in the default package, and a
  // default-package type has no importable name, so there is nothing to publish.
  if (!pkg) return out
  const stack: any[] = [root]
  const seen = new Set<string>()
  while (stack.length > 0) {
    const n = stack.pop()!
    if (isTopLevel(n)) {
      let name: string | undefined
      if (TYPE_DECLARATIONS.has(n.type)) {
        if (writtenVisibility(n) === undefined || writtenVisibility(n) === "public") {
          const id = n.namedChildren?.find((c: any) => c && c.type === "identifier")
          if (id) name = id.text
        }
      } else if (n.type === "method_declaration" || n.type === "function_definition") {
        const id = n.namedChildren?.find((c: any) => c && c.type === "identifier")
        if (id) name = id.text
      }
      if (name) {
        const key = `${pkg}->${name}`
        if (!seen.has(key)) { seen.add(key); out.push({ label: "exports", source: pkg, target: name }) }
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) stack.push(c) }
  }
  return out
}

/** `contains`: owner -> member, for every member owned by a type this file declares. */
export function deriveGroovyContainsTruth(root: any): GroovyOntologyRow[] {
  const out: GroovyOntologyRow[] = []
  const stack: any[] = [root]
  const seen = new Set<string>()
  while (stack.length > 0) {
    const n = stack.pop()!
    if (DECLARATION_TYPES.has(n.type)) {
      const owner = enclosingTypeName(n)
      let member: string | undefined
      if (n.type === "enum_constant") {
        const id = n.namedChildren?.find((c: any) => c && c.type === "identifier")
        if (id) member = id.text
      } else if (n.type === "field_declaration" || n.type === "constant_declaration") {
        // A field declaration may declare SEVERAL variables; each is its own member.
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (!c || c.type !== "variable_declarator") continue
          for (let j = 0; j < c.namedChildCount; j++) {
            const id = c.namedChild(j)
            if (id && id.type === "identifier" && owner) {
              const key = `${owner}->${id.text}`
              if (!seen.has(key)) { seen.add(key); out.push({ label: "contains", source: owner, target: id.text }) }
            }
          }
        }
      } else {
        const id = n.namedChildren?.find((c: any) => c && (c.type === "identifier" || c.type === "string_literal"))
        if (id) {
          // The family convention for a constructor's member name is the literal
          // `constructor`, and groovy's own hand-audited truth records it (the
          // G4 note in real-groovy-analyzer.ts: java, kotlin, scala and groovy all
          // record `contains:A->constructor`).
          member = n.type === "constructor_declaration" ? "constructor" : id.text.replace(/^["']|["']$/g, "")
        }
      }
      if (owner && member) {
        const key = `${owner}->${member}`
        if (!seen.has(key)) { seen.add(key); out.push({ label: "contains", source: owner, target: member }) }
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) stack.push(c) }
  }
  return out
}

/**
 * `references`: the import mentions plus the DECLARED-TYPE mentions.
 *
 * The declared-type arm descends declaration positions and stops at value boundaries
 * (`variable_declarator` values, closures, blocks), because an initializer's contents
 * are not the declaration's type clause. Only QUALIFIED names are derived — a bare
 * `String` is not a reference to anything an importer can resolve, and the analyzer's
 * own rule for this lane emits a declared-type row only for a name containing a `.`.
 */
export function deriveGroovyReferencesTruth(root: any): GroovyOntologyRow[] {
  const out: GroovyOntologyRow[] = []
  const seen = new Set<string>()
  const pkg = groovyPackage(root)
  const add = (label: "references", source: string, target: string): void => {
    const key = `${source}->${target}`
    if (seen.has(key)) return
    seen.add(key)
    out.push({ label, source, target })
  }

  // (a) import mentions
  for (const row of deriveGroovyImportsTruth(root)) add("references", row.source, row.target)

  // (b) declared-type mentions, sourced at the enclosing TYPE (never the method that
  // mentions it — the same rule the analyzer's `resolveSource` states, and the rule
  // the lane's hand-audited truth follows: not one of its 79 relationship rows is
  // sourced at a method).
  const TYPE_STOP = new Set(["variable_declarator", "closure", "block", "lambda_expression"])
  const collect = (n: any, acc: string[]): void => {
    if (n.type === "type_identifier") {
      if (n.text !== "def" && n.text !== "as" && isDottedName(n.text)) acc.push(n.text)
      return
    }
    if (n.type === "scoped_type_identifier") {
      if (isDottedName(n.text)) acc.push(n.text)
      return
    }
    if (TYPE_STOP.has(n.type)) return
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) collect(c, acc) }
  }

  const walk = (n: any): void => {
    const isDeclPos =
      n.type === "field_declaration" || n.type === "constant_declaration" ||
      n.type === "formal_parameter" || n.type === "local_variable_declaration" ||
      n.type === "method_declaration" || n.type === "throws" ||
      n.type === "catch_formal_parameter" || n.type === "instanceof_expression" ||
      n.type === "cast_expression"
    if (isDeclPos) {
      const source = enclosingTypeName(n) ?? (pkg || "(script)")
      const acc: string[] = []
      if (n.type === "method_declaration") {
        // Only the RETURN type: the leading type children before the name.
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (!c) continue
          if (c.type === "identifier") break
          if (c.type === "modifiers") continue
          if (c.type.endsWith("_type") || c.type === "type_identifier" || c.type === "scoped_type_identifier") collect(c, acc)
          else break
        }
      } else if (n.type === "cast_expression" || n.type === "instanceof_expression" || n.type === "catch_formal_parameter" || n.type === "throws") {
        collect(n.namedChild(0), acc)
      } else {
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (!c || TYPE_STOP.has(c.type)) continue
          if (c.type.endsWith("type") || c.type === "type_identifier" || c.type === "scoped_type_identifier") collect(c, acc)
        }
      }
      for (const t of acc) if (t.includes(".")) add("references", source, t)
    }
    // `as` coercion: `o as java.util.List` is a binary_expression with a `type` field.
    if (n.type === "binary_expression") {
      const asType = n.childForFieldName?.("type")
      if (asType && n.childForFieldName?.("left") && isDottedName(String(asType.text ?? ""))) {
        const source = enclosingTypeName(n) ?? (pkg || "(script)")
        add("references", source, asType.text)
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) walk(c) }
  }
  walk(root)
  return out
}

export function deriveGroovyOntologyTruth(root: any): GroovyOntologyRow[] {
  return [
    ...deriveGroovyContainsTruth(root),
    ...deriveGroovyReferencesTruth(root),
    ...deriveGroovyImportsTruth(root),
    ...deriveGroovyExportsTruth(root),
  ]
}