/**
 * GROOVY LANE ORACLE — the independent second opinion for the four relationship
 * types the shared differential never audits for this lane.
 *
 * ## WHY THIS FILE EXISTS
 *
 * `script/m60/rel-type-coverage-gate.ts` CHECK 1 (DERIVATION), measured against
 * this lane's bytes at commit e73c3e58e:
 *
 *     groovy   2 un-audited: ["contains","references"]
 *
 * A DERIVATION finding is the honesty contract's "stored and compared against
 * nothing": the edge ships, a bug in it ships with it, and no instrument is
 * watching. On this corpus `contains` is 27,238 edges over 2,486 files and
 * `references` is 10,845 over 2,373 — the two largest unaudited surfaces the
 * lane has. `imports` and `exports` are here for the same reason plus one more:
 * they were the two types the handover called silent, and the census found
 * `exports` reaching no channel at all while `imports` reached only
 * `ParseResult.imports`, which no consumer reads back into the graph.
 *
 * ## WHAT INDEPENDENCE THIS ORACLE HAS, AND WHAT IT DOES NOT
 *
 * It has a separate walker and a separate implementation. For a `contains`
 * owner the oracle derives the enclosing type by descending the tree and
 * tracking the nearest type-declaration node; the analyzer maintains a scope
 * stack mutated by per-node handlers with push/exit bookkeeping. For an import
 * target the oracle DESCENDS the `scoped_identifier` spine and concatenates the
 * `identifier` leaves; the analyzer asks `findChild(node, scoped_identifier |
 * identifier)` and takes its text. For visibility the oracle reads the
 * `modifiers` child as a set of child node types; the analyzer runs
 * `extractModifiers` over a joined string. Two implementations of one rule
 * disagree when either is wrong.
 *
 * It does NOT have an independent grammar. Both sides load the same
 * `wasm/tree-sitter-groovy.wasm`, so a bug IN the grammar — a production that
 * fails to match, a field that is never populated — is invisible here exactly
 * as it is to the shared differential. That limit is the harness's declared
 * limitation (workstream Part 1 q3) and it is stated in the artifact rather
 * than papered over.
 *
 * ## WHAT IS DERIVED, FROM WHICH RULE
 *
 *   contains   ownership: a member belongs to the nearest enclosing type
 *              declaration (or anonymous class body). Groovy has no module, so
 *              the owner is a TYPE, never a package.
 *   references import_based half — the MENTION of an imported module.
 *              declared_type / instanceof / cast / method_reference /
 *              return_type halves — a named type in a DECLARATION position.
 *   imports    one dependency per `import_declaration`, sourced at the file's
 *              package (the lane's `(script)` sentinel when it has none),
 *              because that is the source bb_graph's file-level dependency
 *              query can resolve to the file.
 *   exports    one publication per TOP-LEVEL type declaration, sourced at the
 *              package. Groovy has no module and no `exports` clause: measured
 *              over the corpus, 0 of 266 node types contain "export" and the
 *              grammar's file-scope anonymous-token vocabulary is empty.
 *
 * ## NORMALISATION, AND WHY EACH STEP IS NEEDED
 *
 * An oracle that "normalises" a difference it has not first established reports
 * a disagreement that does not exist, which is the fastest way to get an oracle
 * switched off. Every normalisation below is a post-pass the analyzer performs
 * AFTER the walk, read out of `src/ast/real-groovy-analyzer.ts`:
 *
 *   N1 importMentionSource  the `references` half of an import is re-sourced
 *                           from the package to the file's PRIMARY TYPE (the
 *                           first owner-less Class/Interface/Enum), because an
 *                           import precedes the type declaration in the file.
 *                           The `imports` half is NOT re-sourced, by design:
 *                           its consumer keys on the FILE.
 *   N2 constructorName      a constructor symbol is named the literal
 *                           "constructor", not after its class (G4; java/kotlin/
 *                           scala parity, and the lane's own truth file).
 *   N3 lineAnchor           an edge carries the line of the node that NAMES the
 *                           thing, not the line of the enclosing construct.
 *   N4 visibilityTier       a non-public top-level type publishes at 0.6 with a
 *                           reasonCode; the oracle derives the same tier from
 *                           the `modifiers` child.
 *   N5 anonymousClass       `new Foo() { … }` synthesises an `anonymous_Foo`
 *                           Class whose body's members hang off it, so the
 *                           oracle reconstructs the same synthetic name from
 *                           the constructed type.
 *
 * ## NO REGEX
 *
 * Tree walk over `node.type`, field names and named children; every
 * classification is a node-type comparison or a character walk; file population
 * by `git ls-files` + `detectLanguageFromPath`, exactly as the census derives
 * it, so the oracle and the census cannot disagree about which files exist.
 *
 * ## USAGE
 *   npx tsx script/m14/lanes/groovy-ontology-oracle.ts
 *   LANE_NFILES=200 npx tsx script/m14/lanes/groovy-ontology-oracle.ts
 */
import { execFileSync } from "node:child_process"
import { readFileSync, statSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../src/ast/language-detection"
import { getParser } from "../../../src/ast/engine"
import { RealGroovyAnalyzer } from "../../../src/ast/real-groovy-analyzer"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const REPO_DIR = process.env.LANE_REPO ?? "groovy"
const WANT = Number(process.env.LANE_NFILES ?? 0)
const CONC = Number(process.env.LANE_CONC ?? 6)
const OUT = process.env.LANE_OUT

const TYPES = ["contains", "references", "imports", "exports"] as const
type Type = (typeof TYPES)[number]

// ── population, DERIVED the same way the census derives it ────────────────────
const root = path.join(CR, REPO_DIR)
const all: string[] = []
try {
  const tracked = execFileSync("git", ["-C", root, "ls-files", "-z"], {
    encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
  }).split("\0").filter(Boolean)
  for (const rel of tracked) {
    const abs = path.join(root, rel)
    try {
      if (statSync(abs).size > 512 * 1024) continue
      if (detectLanguageFromPath(abs, readFileSync(abs, "utf8")) !== "groovy") continue
    } catch { continue }
    all.push(abs)
  }
} catch { /* an absent corpus must read as an absent population, never as zero edges */ }
all.sort()
// `LANE_ONLY` narrows to paths ending in a suffix, so a disagreement printed
// above can be re-run on the ONE file that produced it. It is a filter on the
// derived population, never a hand-listed file set.
const ONLY = process.env.LANE_ONLY ?? ""
const narrowed = ONLY ? all.filter((f) => f.endsWith(ONLY)) : all
const files = WANT > 0 ? narrowed.slice(0, WANT) : narrowed

const TYPE_DECL = new Set([
  "class_declaration", "interface_declaration", "trait_declaration",
  "enum_declaration", "record_declaration", "annotation_type_declaration",
])
/** Callables only. A field/constant/enum member is a declaration with its OWN
 *  name shape (a `variable_declarator` list, or an identifier with no `name`
 *  field), and lumping it in here made the member branch find no name, emit
 *  nothing, and silently swallow every field and enum member in the corpus:
 *  272 of the oracle's 272 `contains` false positives on the first run were
 *  that one wrong list. Each declaration shape gets its own branch. */
const MEMBER_DECL = new Set([
  "method_declaration", "constructor_declaration", "function_definition",
])

/** Rebuild a dotted name by DESCENDING the identifier spine. Deliberately not
 *  `node.text` and not a single child lookup: the analyzer reads one
 *  `scoped_identifier` child and takes its text, so a grammar that stopped
 *  nesting identifiers would break one path and not the other. */
function dottedSpine(n: any): string {
  if (!n) return ""
  if (n.type === "identifier") return String(n.text)
  if (n.type === "scoped_identifier") {
    const parts: string[] = []
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c && (c.type === "identifier" || c.type === "scoped_identifier")) parts.push(dottedSpine(c))
    }
    return parts.filter(Boolean).join(".")
  }
  return ""
}

/** The declared visibility, read from the `modifiers` child's node types rather
 *  than from a modifier string. "" is the no-modifier case, which in GROOVY is
 *  `public` (Groovy has no package-private) — the opposite of java, where "" is
 *  package-private, and getting it backwards would invert the confidence tier
 *  on every single edge. */
function declaredVisibility(decl: any): string {
  for (let i = 0; i < decl.namedChildCount; i++) {
    const c = decl.namedChild(i)
    if (!c || c.type !== "modifiers") continue
    for (let j = 0; j < c.childCount; j++) {
      const m = c.child(j)
      if (!m) continue
      if (m.type === "public" || m.type === "private" || m.type === "protected") return m.type
    }
  }
  return ""
}

/** The base type name of a written type: the head identifier, generic arguments
 *  and array brackets removed. Built by walking, not by splitting text. */
function baseTypeName(n: any): string {
  if (!n) return ""
  if (n.type === "type_identifier") return String(n.text)
  if (n.type === "generic_type") {
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (!c) continue
      if (c.type === "type_identifier" || c.type === "scoped_type_identifier") return baseTypeName(c)
    }
    return ""
  }
  if (n.type === "scoped_type_identifier") {
    // The written form is `Outer.Inner`; the analyzer keeps the dotted text, so
    // the oracle does too.
    let out = ""
    const walk = (x: any): void => {
      if (x.type === "type_identifier") { if (out) out += "."; out += String(x.text); return }
      for (let i = 0; i < x.namedChildCount; i++) { const c = x.namedChild(i); if (c) walk(c) }
    }
    walk(n)
    return out
  }
  if (n.type === "array_type") {
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c && c.type !== "dimensions") return baseTypeName(c)
    }
    return ""
  }
  return ""
}

/** Strip a GString/Spock name's surrounding quotes by CHARACTER CODE. The
 *  analyzer does the same (`stripQuotes`), and a `/^"|"$/` regex would be the
 *  one regex in this file — which is the rule this lane runs under: a text
 *  pattern over source is how an analyzer lies. */
function stripQuotes(s: string): string {
  if (s.length >= 2) {
    const a = s.charCodeAt(0)
    const b = s.charCodeAt(s.length - 1)
    const isQuote = (c: number) => c === 34 || c === 39
    if (isQuote(a) && isQuote(b)) return s.slice(1, s.length - 1)
  }
  return s
}

function firstChildOfType(n: any, types: string[]): any {
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c && types.includes(c.type)) return c
  }
  return null
}
function firstField(n: any, field: string): any {
  try { return n?.childForFieldName?.(field) ?? null } catch { return null }
}
const row1 = (n: any) => n.startPosition.row + 1

/**
 * ONE meta shape for every row on both sides of the comparison.
 *
 * The analyzer's `metadata` is read as `relationshipType | reasonCode |
 * isWildcard`, with a missing key stringifying to "". The oracle used to build
 * a shorter shape per type, which made every `contains` row and every import
 * `references` row report as a META disagreement — an oracle disagreeing with
 * itself about punctuation, which is the failure mode that gets an oracle
 * switched off. A meta difference is only informative when both sides are
 * formatted by the same function.
 */
function metaOf(relType: string, reasonCode: string, isWildcard?: boolean): string {
  return `${relType}|${reasonCode}|${isWildcard === undefined ? "" : isWildcard ? "true" : "false"}`
}

type Row = { file: string; type: Type; key: string; line: number; conf: number; meta: string }

const oracle: Row[] = []
const observed: Row[] = []
let parseFail = 0
let analyzeFail = 0
let cursor = 0
/** The export surface a file HAS but refuses to publish, counted on both sides.
 *  It is not an edge, so it cannot be adjudicated as one: the oracle's first
 *  run pushed a synthetic `(no-package)` row and reported every package-less
 *  file as a false negative — an oracle reporting a disagreement about a
 *  channel that does not exist. */
let refusalTruth = 0
let refusalObserved = 0
const refusalDiff: string[] = []
/** Observed rows this oracle declares out of scope, by type. Printed beside the
 *  adjudicated counts so a narrowed comparison cannot read as a whole one. */
const scopedOut: Record<string, number> = { references: 0 }

/**
 * N3, done the lane's way. M59/#825: an edge carries the line the thing is
 * NAMED on, and the lane's convention for "the line a declaration is written
 * on" is `declarationLineNode` — the first ANNOTATION when the declaration
 * carries one, and the name otherwise. Anchoring on the name unconditionally
 * disagrees with every annotated declaration, and annotated declarations are
 * most of a Groovy corpus (`@Override`, `@Test`, `@CompileStatic`), so this is
 * read here as a rule rather than discovered as a 65% line-disagreement rate.
 */
function declarationLine(decl: any, nameNode: any): number {
  for (let i = 0; i < decl.namedChildCount; i++) {
    const c = decl.namedChild(i)
    if (!c) continue
    if (c.type === "annotation" || c.type === "marker_annotation") return row1(c)
    if (c.type === "modifiers") {
      for (let j = 0; j < c.namedChildCount; j++) {
        const m = c.namedChild(j)
        if (m && (m.type === "annotation" || m.type === "marker_annotation")) return row1(m)
      }
    }
  }
  return nameNode ? row1(nameNode) : row1(decl)
}

/** The oracle's own scope model. The analyzer pushes a scope ONLY for a type
 *  declaration and for an anonymous class body — never for a method — so the
 *  owner of a `contains` edge is the nearest enclosing TYPE. Deriving it any
 *  other way would invent an owner the language does not have. */
function oracleWalk(rootNode: any, file: string, pkg: string): number {
  // N1: the primary type is the FIRST owner-less type declaration. This lane
  // maps every type node type other than interface/trait/enum onto `Class`
  // (handleTypeDeclaration), so a record and an `@interface` ARE classes for
  // the purpose of "the first owner-less type" and the oracle must not skip
  // them: skipping them made 61 import mentions report as missing from files
  // whose first declaration is a record or an annotation type.
  const primaryType = (() => {
    for (let i = 0; i < rootNode.namedChildCount; i++) {
      const c = rootNode.namedChild(i)
      if (!c || !TYPE_DECL.has(c.type)) continue
      const nm = firstChildOfType(c, ["identifier"])
      if (nm) return String(nm.text)
    }
    return ""
  })()
  const mentionSource = primaryType || "(script)"
  const declaredExports: { name: string; vis: string; line: number }[] = []
  let noPackageExports = 0

  // Two passes: the first collects the file-level facts (package, primary type,
  // export surface) that the second pass needs, because an import precedes the
  // type declaration in the file and cannot know the primary type otherwise.
  ;(function prescan(n: any, depth: number): void {
    if (TYPE_DECL.has(n.type) && depth === 1) {
      const nm = firstChildOfType(n, ["identifier"])
      const name = nm ? String(nm.text) : ""
      if (name) declaredExports.push({ name, vis: declaredVisibility(n), line: row1(n) })
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) prescan(c, depth + 1) }
  })(rootNode, 0)

  // IDENTITY IS (file, label, source, target, LINE). The line is in the key
  // because two members of one class can share a name — two constructors are
  // both "constructor", two overloads share a name and differ in parameters —
  // and a key without it collapsed them into one row and then reported the
  // survivor's line as a location defect. That is how a disagreement about
  // IDENTITY wears the costume of a line defect.
  const seen = new Set<string>()
  const push = (type: Type, key: string, line: number, conf: number, meta: string): void => {
    const k = `${type}|${key}|${line}`
    if (seen.has(k)) return
    seen.add(k)
    oracle.push({ file, type, key: `${key}|${line}`, line, conf, meta })
  }

  for (const e of declaredExports) {
    if (!pkg) { noPackageExports++; continue }
    const isPublic = e.vis !== "private" && e.vis !== "protected"
    push("exports", `${pkg}|${e.name}`, e.line, isPublic ? 1.0 : 0.6,
      metaOf("groovy_exportable_unit", isPublic ? "" : "non_public_top_level_type"))
  }

  ;(function visit(n: any, owner: string): void {
    if (n.type === "import_declaration") {
      let isStatic = false, isWildcard = false
      for (let i = 0; i < n.childCount; i++) {
        const k = n.child(i)
        if (!k) continue
        if (k.type === "static") isStatic = true
        else if (k.type === "asterisk") isWildcard = true
      }
      let target = ""
      for (let j = 0; j < n.namedChildCount; j++) {
        const c = n.namedChild(j)
        if (c && (c.type === "scoped_identifier" || c.type === "identifier")) { target = dottedSpine(c); break }
      }
      if (target) {
        const line = row1(firstField(n, "path") ?? n)
        // The DEPENDENCY: sourced at the package, because the file-level
        // consumer resolves `source_external` to the file, not to a symbol.
        push("imports", `${pkg || "(script)"}|${target}`, line, 1.0,
          metaOf(isStatic ? "static_member_import" : isWildcard ? "type_on_demand_import" : "single_type_import", "", isWildcard))
        // The MENTION: re-sourced to the primary type (N1). Its meta shape
        // carries NO relationshipType — the import half labels itself, the
        // mention half carries `isGroovyImport` + `isWildcard` only, and an
        // oracle that invents a sub-label for it manufactures a META
        // disagreement on every row.
        push("references", `${mentionSource}|${target}`, line, 0.9, metaOf("", "", isWildcard))
      }
    }

    if (TYPE_DECL.has(n.type)) {
      const nm = firstChildOfType(n, ["identifier"])
      const name = nm ? String(nm.text) : owner
      if (nm) {
        const line = declarationLine(n, nm)
        if (owner) push("contains", `${owner}|${name}`, line, 1, metaOf("", ""))
      }
      // A record header's formal parameters are constructor-backed PROPERTIES
      // and are owned by the record (Groovy 4 records; java family parity).
      // Missing them was an ORACLE gap, not an analyzer edge: the analyzer
      // publishes them and the first run reported them as 100% EXTRA.
      if (n.type === "record_declaration") {
        const fp = firstChildOfType(n, ["formal_parameters"])
        if (fp) {
          for (let i = 0; i < fp.namedChildCount; i++) {
            const p = fp.namedChild(i)
            if (!p || p.type !== "formal_parameter") continue
            const pn = firstChildOfType(p, ["identifier"])
            if (pn && name) push("contains", `${name}|${String(pn.text)}`, row1(pn), 1, metaOf("", ""))
          }
        }
      }
      // Nested type declarations are OWNED, not exported: the export surface is
      // depth-1 only, which is what the oracle's prescan measured.
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) visit(c, name) }
      return
    }

    if (MEMBER_DECL.has(n.type)) {
      const nm = firstField(n, "name") ?? firstChildOfType(n, ["identifier", "string_literal"])
      // N2: a constructor is the literal "constructor" (G4 family parity) — and
      // ONLY when its name equals the class it is written in. This pinned
      // grammar parses a class-body `def method() {}` as a
      // `constructor_declaration` because Java's method header needs a type and
      // `def` is not one; the remainder then reads as a constructor whose name
      // is not the class's. Naming those "constructor" reported 272 real
      // members as fabricated on the first run and lost every method name in the
      // corpus. The rule is the language's, not the analyzer's: a constructor's
      // name MUST equal its class.
      const raw = nm ? stripQuotes(String(nm.text)) : ""
      const isCtor = n.type === "constructor_declaration" && raw !== "" && raw === owner
      const name = isCtor ? "constructor" : raw
      if (owner && name) push("contains", `${owner}|${name}`, declarationLine(n, nm), 1, metaOf("", ""))
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) visit(c, owner) }
      return
    }

    if (n.type === "field_declaration" || n.type === "constant_declaration") {
      // EVERY declarator, not the first: `int a, b` is two fields and therefore
      // two members. Reading only the first was an ORACLE defect that reported
      // the second as a fabricated edge on the first run.
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (!c || c.type !== "variable_declarator") continue
        const nm = c.childForFieldName?.("name") ?? firstChildOfType(c, ["identifier"])
        const name = nm ? String(nm.text).trim() : ""
        // `def` cannot be a field name — the grammar's def-squeeze artifact
        // (the analyzer refuses it for the same reason, #841 round 3).
        if (!name || name === "def") continue
        if (owner) push("contains", `${owner}|${name}`, row1(nm ?? c), 1, metaOf("", ""))
      }
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) visit(c, owner) }
      return
    }

    if (n.type === "enum_constant") {
      const nm = firstChildOfType(n, ["identifier"])
      if (owner && nm) push("contains", `${owner}|${String(nm.text)}`, declarationLine(n, nm), 1, metaOf("", ""))
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) visit(c, owner) }
      return
    }

    // N5: an anonymous class body is an owner in its own right, named
    // `anonymous_<constructed type>` — the analyzer synthesises that name and
    // hangs the body's members off it.
    if (n.type === "object_creation_expression") {
      const t = firstChildOfType(n, ["type_identifier", "generic_type", "scoped_type_identifier", "identifier"])
      const superName = baseTypeName(t)
      const anon = superName ? `anonymous_${superName}` : "anonymous_class"
      // The body is found by SEARCH, not by child position: this grammar puts
      // the anonymous `class_body` at depth 1 in some shapes and one level
      // deeper in others, and a position-keyed read silently skipped every
      // member of the ones it missed — 25 missing `contains` rows on the first
      // run, all of them members of an anonymous class.
      let body: any = null
      const find = (x: any): void => {
        if (body) return
        for (let i = 0; i < x.namedChildCount; i++) {
          const c = x.namedChild(i)
          if (!c) continue
          if (c.type === "class_body" && x === n) { body = c; return }
          find(c)
        }
      }
      find(n)
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c && c !== body) visit(c, owner)
      }
      if (body) for (let j = 0; j < body.namedChildCount; j++) { const k = body.namedChild(j); if (k) visit(k, anon) }
      return
    }

    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) visit(c, owner) }
  })(rootNode, "")
  return noPackageExports
}

async function worker(): Promise<void> {
  const parser = await getParser("groovy")
  for (;;) {
    const i = cursor++
    if (i >= files.length) return
    const f = files[i]
    const L = path.relative(root, f)
    let content: string, rootNode: any
    try {
      content = readFileSync(f, "utf8")
      const pr = await parser.parse(content, f)
      rootNode = pr.rootNode
    } catch { parseFail++; continue }

    // ---- ORACLE: independent walk first, so it cannot inherit the analyzer's bug
    let pkg = ""
    {
      const walk = (n: any): void => {
        if (n.type === "package_declaration") {
          for (let j = 0; j < n.namedChildCount; j++) {
            const c = n.namedChild(j)
            if (c && (c.type === "scoped_identifier" || c.type === "identifier")) { pkg = dottedSpine(c) || String(c.text); return }
          }
        }
        for (let k = 0; k < n.namedChildCount; k++) { const c = n.namedChild(k); if (c) walk(c) }
      }
      walk(rootNode)
    }
    const refusals = oracleWalk(rootNode, L, pkg)

    // ---- OBSERVED: the production analyzer
    let res: any
    try { res = new RealGroovyAnalyzer().analyze(rootNode, content, f) } catch { analyzeFail++; continue }
    refusalTruth += refusals
    const observedRefusals = Number((res.metadata as any)?.exportsWithNoPackage ?? 0)
    refusalObserved += observedRefusals
    if (observedRefusals !== refusals && refusalDiff.length < 8) refusalDiff.push(`${L} oracle ${refusals} analyzer ${observedRefusals}`)
    for (const r of res.relationships ?? []) {
      const t = String(r.type ?? r.relationshipType ?? "") as Type
      if (!TYPES.includes(t)) continue
      const md = r.metadata ?? {}
      // SCOPE, DECLARED NOT HIDDEN. This oracle derives the IMPORT half of
      // `references` — the mention an import declaration makes. The type's other
      // halves (declared_type, instanceof_expression, cast_type,
      // method_reference, return_type) come from `collectDeclaredTypeRefs`, a
      // second collector with its own TYPE_STOP boundary set, and are NOT
      // derived here: counting them as false positives would be an oracle
      // measuring its own coverage gap and calling it a defect, which is the
      // mirror image of the failure this file exists to prevent. The excluded
      // count is printed beside the compared count.
      if (t === "references" && !md.isGroovyImport) { scopedOut.references++; continue }
      observed.push({
        file: L, type: t, line: Number(r.line_number ?? 0),
        conf: typeof r.confidence === "number" ? r.confidence : 1,
        key: `${r.source}|${r.target}|${Number(r.line_number ?? 0)}`,
        meta: String(md.relationshipType ?? "") + "|" + String(md.reasonCode ?? "") + "|" + String(md.isWildcard ?? ""),
      })
    }
  }
}

const t0 = Date.now()
await Promise.all(Array.from({ length: CONC }, () => worker()))
const ms = Date.now() - t0

// ── adjudicate ────────────────────────────────────────────────────────────────
/** A coarse shape for a diff row, so 272 disagreements print as three shapes
 *  with two examples each instead of 272 lines that hide the class. Shapes are
 *  node-level facts about the label — never text patterns. */
function shape(type: Type, key: string, meta: string): string {
  const parts = key.split("|")
  const src = parts[0] ?? ""
  const tgt = parts[1] ?? ""
  const dotted = (v: string) => v.indexOf(".") !== -1
  if (type === "contains") return `src=${dotted(src) ? "dotted" : "bare"} tgt=${dotted(tgt) ? "dotted" : "bare"}`
  if (type === "references") return `src=${dotted(src) ? "dotted" : "bare"} wildcard=${meta.endsWith("true")}`
  if (type === "imports") return `form=${meta.split("|")[0]}`
  return `tier=${meta.split("|")[1] === "" ? "public" : "non-public"}`
}

function adjudicate(type: Type) {
  const truth = new Map<string, Row>()
  for (const r of oracle) if (r.type === type) truth.set(`${r.file}|${r.key}`, r)
  const obs = new Map<string, Row>()
  for (const r of observed) if (r.type === type) obs.set(`${r.file}|${r.key}`, r)
  let tp = 0, fp = 0, fn = 0, lineAgree = 0, confAgree = 0
  const buckets = new Map<string, { n: number; ex: string[] }>()
  const note = (sh: string, row: string): void => {
    const b = buckets.get(sh) ?? { n: 0, ex: [] }
    b.n++
    if (b.ex.length < 2) b.ex.push(row)
    buckets.set(sh, b)
  }
  const arrow = (k: string) => k.slice(k.indexOf("|") + 1).replaceAll("|", " @L").replace(" @L", " -> ").replace(" @L", " @L")
  for (const [k, t] of truth) {
    const o = obs.get(k)
    if (!o) { fn++; note("MISSING " + shape(type, k, t.meta), `${t.file} ${arrow(k)} oracleLine=${t.line} ${t.meta}`); continue }
    tp++
    if (o.line === t.line) lineAgree++
    else note("LINE " + shape(type, k, t.meta), `${t.file} ${arrow(k)} oracle=${t.line} analyzer=${o.line}`)
    if (o.conf === t.conf) confAgree++
    if (o.meta !== t.meta) note("META " + shape(type, k, t.meta), `${t.file} ${arrow(k)} oracle[${t.meta}] analyzer[${o.meta}]`)
  }
  for (const [k, o] of obs) {
    if (truth.has(k)) continue
    fp++
    note("EXTRA " + shape(type, k, o.meta), `${o.file} ${arrow(k)} analyzerLine=${o.line} conf=${o.conf} ${o.meta}`)
  }
  const diff: string[] = []
  for (const [sh, b] of [...buckets.entries()].sort((a, b2) => b2[1].n - a[1].n)) {
    diff.push(`${String(b.n).padStart(6)}  ${sh}`)
    for (const e of b.ex) diff.push(`          e.g. ${e}`)
  }
  const precision = tp + fp === 0 ? 0 : tp / (tp + fp)
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn)
  return { truth: truth.size, emitted: obs.size, tp, fp, fn, lineAgree, confAgree, precision, recall, diff }
}

console.log(`GROOVY LANE ORACLE (DERIV_EXPORTS_GROOVY3)`)
console.log(`corpus ${REPO_DIR}: ${all.length} tracked .groovy/.gradle files on disk (derived: git ls-files + detectLanguageFromPath), measuring ${files.length}, ${ms} ms, ${CONC} workers`)
console.log(`parse failures ${parseFail}   analyze failures ${analyzeFail}`)
console.log(`oracle rows:  ${TYPES.map((t) => `${t} ${oracle.filter((r) => r.type === t).length}`).join("  ")}`)
console.log(`analyzer rows: ${TYPES.map((t) => `${t} ${observed.filter((r) => r.type === t).length}`).join("  ")}`)
console.log(`\nINDEPENDENCE LIMIT: both walkers load the same tree-sitter-groovy wasm, so a bug IN THE GRAMMAR is invisible to this oracle exactly as it is to the shared differential. This measures implementation divergence, not grammar correctness.\n`)
console.log("type        truth   emitted      TP      FP      FN   precision    recall   line-agree  conf-agree")
console.log("-".repeat(116))
const summary: Record<string, unknown> = {}
for (const t of TYPES) {
  const r = adjudicate(t)
  summary[t] = r
  console.log(
    `${t.padEnd(11)} ${String(r.truth).padStart(5)} ${String(r.emitted).padStart(9)} ${String(r.tp).padStart(6)} ${String(r.fp).padStart(6)} ${String(r.fn).padStart(6)}   ${r.precision.toFixed(4)}    ${r.recall.toFixed(4)}   ${r.lineAgree}/${r.tp}        ${r.confAgree}/${r.tp}`,
  )
  for (const d of r.diff) console.log(`   ${d}`)
}
if (process.env.LANE_DUMP === "1") {
  console.log(`\n--- ORACLE ROWS (${oracle.length})`)
  for (const r of oracle) console.log(`  ${r.type.padEnd(11)} ${r.file} ${r.key.replace("|", " -> ")} L${r.line} conf=${r.conf} ${r.meta}`)
  console.log(`--- OBSERVED ROWS (${observed.length})`)
  for (const r of observed) console.log(`  ${r.type.padEnd(11)} ${r.file} ${r.key.replace("|", " -> ")} L${r.line} conf=${r.conf} ${r.meta}`)
}
console.log(`\nOUT OF SCOPE (declared, not hidden): observed \`references\` rows this oracle does not derive  ${scopedOut.references} (sub-labels declared_type / instanceof_expression / cast_type / method_reference / return_type)`)
console.log(`\nexport REFUSALS - package-less files whose exportable units the analyzer declines to publish; counted, not edged`)
console.log(`  oracle ${refusalTruth}   analyzer metadata.exportsWithNoPackage ${refusalObserved}   files in disagreement ${refusalTruth === refusalObserved ? 0 : refusalDiff.length}`)
for (const d of refusalDiff) console.log(`   ${d}`)
if (OUT) {
  const { writeFileSync } = await import("node:fs")
  writeFileSync(OUT, JSON.stringify({ schema: "groovy-lane-oracle/1", repo: REPO_DIR, filesOnDisk: all.length, measured: files.length, parseFail, analyzeFail, summary }, null, 2))
  console.log(`\nwrote ${OUT}`)
}
console.log(`\nDERIVATION DEBT FOR THIS LANE: \`contains\` and \`references\` are NOT in the shared`)
console.log(`differential's groovy audited set, which is why this oracle exists. Registering it`)
console.log(`needs a MASTER change: script/m60/rel-type-coverage-gate.ts reads a lane's own`)
console.log(`audited set from script/m14/<lang>-truth.ts when that file exports ORACLE_LABELS`)
console.log(`(rel-type-coverage-gate.ts readOwnOracleLabels, lines 186-201). script/m14/** is`)
console.log(`MASTER-owned, so this lane did not create it.`)