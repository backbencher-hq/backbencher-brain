/**
 * SCALA ORACLE — the second opinion for the `exports` label.
 *
 * ## Why this file exists
 *
 * `script/m60/rel-type-coverage-gate.ts` CHECK 1 (DERIVATION), run against this
 * branch after the label shipped:
 *
 *     DERIVATION|scala|emits `exports` but the differential audits
 *       ["calls","contains","extends","implements","instantiates","overrides",
 *        "references","uses"] — the type is stored and compared against nothing
 *
 * "stored and compared against nothing" is the exact phrase the workstream uses
 * for the debt this pays down, and it is the same structural gap
 * `ontology-coverage-gate.ts`'s header records for bash's `overrides`: the
 * analyzer omitted the type, so nothing disagreed with it.
 *
 * ## Lane ownership, and what is still needed in a MASTER-owned file
 *
 * `script/m14/go-truth.ts` and `script/m14/ruby-truth.ts` are the precedents: a
 * lane whose oracle is not derivable from the shared file owns its own module,
 * and `readOwnOracleLabels` in `rel-type-coverage-gate.ts` reads
 * `script/m14/<lang>-truth.ts` for exactly that case. `SCALA_ORACLE_LABELS` below
 * is what that gate reads.
 *
 * STILL NEEDED IN `script/m14/differential.ts` (MASTER-owned, deliberately NOT
 * done here, two edits):
 *
 *   1. `import { deriveScalaExportsTruth } from "./scala-truth"` beside the
 *      zig/clojure/ruby truth imports (differential.ts:48-49, :738).
 *   2. In the `lang === "scala"` truth block (differential.ts:22560-22580, where
 *      the `uses`/`contains`/`references` oracles were added as M60 S1/S2/S4):
 *      `for (const t of deriveScalaExportsTruth(root, file)) truth.push(t)`, and
 *      `...(lang === "scala" ? ["exports"] : [])` in the compared-label filter
 *      (differential.ts:23153).
 *
 * Until both land, the gate reads the label set from HERE while the differential
 * still drops the edges — which is precisely the "silence instead of agreement"
 * the ontology gate exists to prevent. That is why the derivation below is also
 * runnable on its own (see `scala-exports-agreement.ts` in this directory), which
 * is what produced the measured agreement quoted in
 * `docs/analyzers/real-scala-analyzer.md`: it does not depend on the shared
 * filter being edited.
 *
 * ## WHAT INDEPENDENCE THIS DERIVATION HAS, AND WHAT IT DOES NOT
 *
 * The derivation never reads the analyzer's `ExportInfo[]`, its symbol table, or
 * its metadata. It walks the parse tree for the module (top-level `package_clause`
 * paths joined with "."), reads visibility off `modifiers` children, and takes
 * declared names from the `name` FIELD of each definition — a different input and
 * a different implementation of the same specification.
 *
 * It does NOT have an independent grammar. Both sides load the same
 * `tree-sitter-scala.wasm`, so a bug IN the grammar — a node type that never
 * matches, a field that is never populated — is invisible here exactly as it is
 * to the differential. That is the limit the honesty contract's L3 definition
 * states, and it is recorded rather than papered over.
 *
 * ## THE RULE BEING DERIVED
 *
 * Scala's public surface, in two parts:
 *
 *   IMPLICIT  every public TOP-LEVEL declaration is exported from its package.
 *             No keyword states this; it is visibility plus placement. "Top
 *             level" means: a direct child of the compilation unit, or a direct
 *             child of a top-level `package … { … }` body, or of a
 *             `package object … { … }` body (a Scala 2 package object's members
 *             ARE package-level API, and this lane publishes no symbol for the
 *             package object itself, so its members carry no owner).
 *
 *   EXPLICIT  a Scala 3 `export` clause introduces names: the leaf of a plain
 *             path, each selector, the name BOUND HERE for `X => Y`, and the
 *             base type of `given Ordering[Int]`. `export m.*` and `export m.given`
 *             re-export a SET the clause does not name, so nothing is derived for
 *             them — deriving per-member rows would be fabrication, and a MISSING
 *             per-member row would be a permanent false alarm of the same kind.
 *
 * A qualified `private[pkg]` is NOT public: it is visible inside a package, and
 * this lane models it as `package` visibility, which is excluded from the surface
 * (the same decision the analyzer's `getVisibility` makes). A `private` or
 * `protected` top-level declaration is excluded for the same reason.
 *
 * A `type` alias is not derived. It is a legal public name, but the analyzer's
 * export surface has never carried one (the lane's `handleTypeAlias` publishes a
 * symbol and no export entry), so deriving it would report a permanent MISSING
 * for every type alias — a fact about the lane's surface definition, not about
 * the language. Measured size of that excluded surface: `type_definition` at the
 * top level is counted by `script/m14/tmp/scala-export-construct-census.mts`.
 */

export interface ScalaTruthEdge {
  label: string
  from: string
  target: string
}

/** The labels this lane's oracle can derive for scala. Read by
 *  `script/m60/rel-type-coverage-gate.ts` `readOwnOracleLabels`. */
export const SCALA_ORACLE_LABELS = [
  "calls",
  "contains",
  "extends",
  "exports",
  "implements",
  "instantiates",
  "overrides",
  "references",
  "uses",
] as const

/** Must match the analyzer's published sentinel — a module identity, not a
 *  symbol. Kept as a literal here so the oracle never imports the analyzer. */
const FILE_MODULE = "(file)"

/** Definitions that can stand at the top level of a Scala file. A declaration
 *  NESTED in one of these owns a member, not a surface entry, so the walker
 *  stops at them. */
const TYPE_DECLS = ["class_definition", "trait_definition", "object_definition", "enum_definition"]
/** `val_declaration` / `var_declaration` are the ABSTRACT forms (`val x: T` with no
 *  body) and are part of the surface exactly as the concrete ones are. */
const VALUE_DECLS = ["val_definition", "var_definition", "val_declaration", "var_declaration"]
const FN_DECLS = ["function_definition"]

function namedChildren(n: any): any[] {
  const out: any[] = []
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c) out.push(c)
  }
  return out
}

/** Backtick quoting is SYNTAX, not part of a name (the lane's M60/#924 rule). */
function unquote(name: string): string {
  if (!name.includes("`")) return name
  let out = ""
  let i = 0
  while (i < name.length) {
    if (name.charCodeAt(i) === 96) {
      const close = name.indexOf("`", i + 1)
      if (close === -1) {
        out += name.slice(i)
        break
      }
      out += name.slice(i + 1, close)
      i = close + 1
    } else {
      out += name[i]
      i++
    }
  }
  return out
}

/** The dotted path a `package_identifier` spells, read from its identifiers. */
function packagePathOf(clause: any): string {
  for (const c of namedChildren(clause)) {
    if (c.type !== "package_identifier") continue
    const segs: string[] = []
    const rec = (n: any): void => {
      if (n.type === "identifier") segs.push(n.text)
      for (const y of namedChildren(n)) rec(y)
    }
    rec(c)
    return unquote(segs.join("."))
  }
  return ""
}

/** The module a compilation unit belongs to: its top-level package clauses
 *  joined with "." — the CHAINED header this corpus writes 599 times in 600
 *  files. A nested clause is already written as its full path, so only top-level
 *  clauses are joined. No clause at all is the default package, where the
 *  compilation unit is the module. */
function scalaModuleName(root: any): string {
  const parts: string[] = []
  for (const c of namedChildren(root)) {
    if (c.type !== "package_clause") continue
    const p = packagePathOf(c)
    if (p.length > 0) parts.push(p)
  }
  return parts.length === 0 ? FILE_MODULE : parts.join(".")
}

/** Public, or not? `private` / `protected` / a QUALIFIED `private[pkg]` all mean
 *  the declaration is not part of the package's surface. Mirrors the spec rule
 *  the lane applies, read from the same modifier nodes.
 *
 *  The BARE form is the shape that caught this oracle out on its first run:
 *  `private def mkReifier(…)` is `modifiers > access_modifier` whose text is
 *  exactly `private` and whose `private` token is an ANONYMOUS child, so a rule
 *  that looked for a named `private` child — or that only tested the `[pkg]`
 *  form — read it as public and derived `scala.reflect -> mkReifier`, which the
 *  analyzer does not publish. The text of the modifier node decides, which is
 *  why this reads `m.text` and not a child type. */
function isPublicDecl(n: any): boolean {
  const isScopeWord = (t: string): boolean => t === "private" || t === "protected"
  const rejects = (m: any): boolean => {
    if (isScopeWord(m.type)) return true
    if (m.type === "access_modifier") {
      // bare `private` / `protected`, and the qualified `private[pkg]` form. The
      // TEXT decides: a bare `private def` is `modifiers > access_modifier` whose
      // text is exactly `private`, with the `private` token an ANONYMOUS child,
      // so a rule that looked for a named `private` child read it as public and
      // derived `scala.reflect -> mkReifier` for a declaration the analyzer does
      // not publish.
      const head = String(m.text ?? "").split("[")[0].trim()
      return isScopeWord(head)
    }
    return false
  }
  // ONLY THE MODIFIERS THAT QUALIFY THE DECLARATION ITSELF. A constructor's own
  // access modifier is a DIRECT child of the class_definition and sits AFTER the
  // name — `final class ArrayBufferView[A] private[mutable](underlying: …)` is
  // public with a private constructor, which is a different fact from a private
  // class, and a rule that read every direct child dropped a genuinely public
  // type from the surface (measured: ArrayBuffer.scala:364, 1 row on a 230-file
  // spread sample of the whole corpus).
  const mods = n.namedChildren.find((c: any) => c.type === "modifiers")
  if (mods) {
    for (const m of namedChildren(mods)) if (rejects(m)) return false
    return true
  }
  const nameNode = n.childForFieldName?.("name")
  for (let i = 0; i < n.childCount; i++) {
    const c = n.child(i)
    if (!c) continue
    if (nameNode && c.id === nameNode.id) break
    if (rejects(c)) return false
  }
  return true
}

/** The declared name of a definition.
 *
 *  Never `node.text`, which for a definition is the whole declaration. A `class`,
 *  `trait`, `object`, `enum`, `def` and `given` all carry a `name` FIELD, but a
 *  `val` / `var` does NOT — the grammar gives it a `pattern` field
 *  (`val Mode = …` -> `pattern->identifier`), which is exactly why the analyzer's
 *  `extractIdentifier` has a child-scanning fallback. An oracle that reads only
 *  the `name` field derives nothing for every val in the corpus: 14 UNEXPLAINED
 *  edges on 200 files, all of them `val X = scala.reflect…` aliases in
 *  `package.scala` files. */
function declaredName(n: any): string[] {
  if (n.type === "val_definition" || n.type === "var_definition") {
    const pattern = n.childForFieldName?.("pattern")
    if (!pattern) return []
    // `operator_identifier` is the pattern node for an operator-named val —
    // `val :: = scala.collection.immutable.::` (src/library/scala/package.scala
    // :78, and `val +:`, `val :+` beside it). An operator IS a name in Scala and
    // it is public API; reading only `identifier` derived nothing for the three
    // of them.
    if (pattern.type === "identifier" || pattern.type === "operator_identifier") {
      return [unquote(String(pattern.text))]
    }
    if (pattern.type === "identifiers") {
      // `val (a, b) = pair` — both names are declared, and both are surface.
      const out: string[] = []
      for (const c of namedChildren(pattern)) if (c.type === "identifier") out.push(unquote(String(c.text)))
      return out
    }
    // `val _ = compute` has no name: a wildcard declares nothing to export.
    return []
  }
  const named = n.childForFieldName?.("name")
  if (named && named.text) return [unquote(String(named.text))]
  return []
}

/** Top-level declarations of one scope: a compilation unit, a `package { … }`
 *  body, or a `package object … { … }` body. Nesting stops at any type or value
 *  declaration, so a member is never mistaken for a surface entry. */
function surfaceDeclarations(scope: any): any[] {
  const out: any[] = []
  for (const c of namedChildren(scope)) {
    if (TYPE_DECLS.indexOf(c.type) !== -1) { out.push(c); continue }
    if (VALUE_DECLS.indexOf(c.type) !== -1) { out.push(c); continue }
    if (FN_DECLS.indexOf(c.type) !== -1) { out.push(c); continue }
    if (c.type === "given_definition") { out.push(c); continue }
    if (c.type === "package_clause") {
      // `package a.b { … }` — the body's declarations are top level, and the
      // body is a `block`, NOT a `template_body`: measured on the braced form
      // (test/sbt-test/source-dependencies/qualified-access/A.scala, `package a
      // { package b { object A } }`), reading only `template_body` found no
      // surface at all in such a file.
      for (const b of namedChildren(c)) {
        if (b.type === "block" || b.type === "template_body") out.push(...surfaceDeclarations(b))
      }
      continue
    }
    if (c.type === "package_object") {
      // A Scala 2 package object's members are package-level API.
      for (const b of namedChildren(c)) {
        if (b.type === "block" || b.type === "template_body") out.push(...surfaceDeclarations(b))
      }
      continue
    }
  }
  return out
}

/** The names one `export` clause introduces, or none when it re-exports a set. */
function exportClauseTargets(n: any): string[] {
  const out: string[] = []
  const path: string[] = []
  let wildcard = false
  let sawSelectors = false
  for (const c of namedChildren(n)) {
    if (c.type === "identifier") { path.push(c.text); continue }
    if (c.type === "namespace_wildcard") { wildcard = true; continue }
    if (c.type !== "namespace_selectors") continue
    sawSelectors = true
    for (const s of namedChildren(c)) {
      if (s.type === "identifier") { out.push(unquote(s.text)); continue }
      if (s.type === "arrow_renamed_identifier") {
        let last: string | null = null
        for (const id of namedChildren(s)) if (id.type === "identifier") last = id.text
        if (last) out.push(unquote(last))
        continue
      }
      if (s.type === "type_identifier") { out.push(unquote(s.text)); continue }
      if (s.type === "generic_type") {
        // `given Ordering[Int]` — descend to the head type and take its base name
        const head = namedChildren(s)[0]
        if (head && head.type === "type_identifier") out.push(unquote(head.text))
        else if (head && head.type === "stable_type_identifier") {
          const leaf = namedChildren(namedChildren(head).slice(-1)[0] ?? head).filter((x: any) => x.type === "type_identifier")
          if (leaf.length > 0) out.push(unquote(String(leaf[leaf.length - 1].text)))
        }
      }
    }
  }
  if (out.length === 0 && !wildcard && !sawSelectors && path.length > 0) {
    out.push(unquote(path[path.length - 1]))
  }
  return out
}

/**
 * The `exports` truth rows for one compilation unit.
 *
 * Deduplicated on (module, name): a module exports a NAME once, however many
 * declarations or clauses introduce it.
 */
export function deriveScalaExportsTruth(root: any): ScalaTruthEdge[] {
  const moduleName = scalaModuleName(root)
  const seen = new Set<string>()
  const rows: ScalaTruthEdge[] = []
  const add = (name: string): void => {
    if (name.length === 0) return
    const k = `${moduleName} ${name}`
    if (seen.has(k)) return
    seen.add(k)
    rows.push({ label: "exports", from: moduleName, target: name })
  }
  for (const decl of surfaceDeclarations(root)) {
    if (!isPublicDecl(decl)) continue
    // An anonymous given has no name to export; a named one is public API, and
    // `declaredName` returns [] for the anonymous shape either way.
    for (const n of declaredName(decl)) add(n)
  }
  const walk = (n: any): void => {
    if (n.type === "export_declaration") for (const t of exportClauseTargets(n)) add(t)
    for (const c of namedChildren(n)) walk(c)
  }
  walk(root)
  return rows
}