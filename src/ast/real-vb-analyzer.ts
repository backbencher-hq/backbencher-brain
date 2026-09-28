/**
 * RealVbAnalyzer — Visual Basic .NET, on a vendored and repaired
 * tree-sitter-vbnet grammar.
 *
 * WHY THIS FILE IS NEW RATHER THAN A REPAIR. VB.NET had no analyzer and no
 * grammar at all. `.vb` was a routed extension and `vb` a declared language, but
 * `engine.ts` routed it to `__generic__`, so a .vb file was "analysed" by a regex
 * generic pass that cannot see a Class, a Function, an Implements clause or a
 * call site — and reported as covered rather than refused. See
 * `grammars/tree-sitter-vbnet/PIN.md` for the grammar side and
 * `reviews/vb/master-review.md` for the lane.
 *
 * THE RULES THIS FILE FOLLOWS, and they are the project's, not mine:
 *
 *  1. AST ONLY, ZERO REGEX. Every classification below is a node-type test, a
 *     field read, or a character-code scan with the equivalence argued inline.
 *     A regex on parser output re-parses text the grammar already classified and
 *     drifts the moment the grammar moves; the M12 census exists because
 *     regex-driven analyzers published phantom edges. `fixtures` runs the M49.R2
 *     census over `src/ast` on every build, so a new regex here is a red build.
 *
 *  2. EVERY RELATIONSHIP CARRIES ITS SITE LINE (M59.A7 / #825). 1-based, on the
 *     node that NAMES the thing, per site rather than per set — so a call that
 *     spans three lines is stamped with the line its callee name is written on.
 *     Navigation is the product; an edge with no line cannot be followed to.
 *     `line_number` is set on every `relationships.push` in this file, and
 *     `nodeNamingToken` is what makes a wrapped qualified name stamp the line of
 *     its last segment's leaf rather than the line the name starts on.
 *
 *  3. NO UNKNOWN SYMBOLS. A symbol is emitted with a kind the product can use
 *     and a name it read off a name-bearing node. Where the grammar has no node
 *     for something, that is a `gap` in the spec and a disclosed counter here —
 *     never a fabricated symbol with an invented name.
 *
 *  4. THE GRAMMAR'S REAL VOCABULARY. Node-type names and field names below were
 *     read out of the wired wasm's enumerable surface through web-tree-sitter
 *     (449 ids / 165 named / 54 fields, pinned in `validation/m14/grammar-pins.json`),
 *     not out of the grammar author's documentation. LUA-00 was exactly this
 *     defect: four invented grammar fields, and the analyzer was written against
 *     a grammar that had none of them.
 */

import { ASTEngine } from "./engine"
import type { Node } from "web-tree-sitter"

const { SymbolKind, RelationshipType } = ASTEngine

/** The metadata key the family's completeness section-B pin reads for an import. */
const IS_IMPORT = "isImport"
/** The metadata key that marks a dependency edge as import-based. */
const INCLUDE_DEPENDENCY = "include_dependency"

export class RealVbAnalyzer implements ASTEngine.LanguageAnalyzer {
  // Populated per analyze() call. The engine constructs one analyzer and reuses
  // it across files, so nothing here may survive a call — see reset().
  private symbols: ASTEngine.UniversalSymbol[] = []
  private relationships: ASTEngine.UniversalRelationship[] = []
  private imports: ASTEngine.ImportInfo[] = []
  /** name -> the FIRST symbol declared under that name. */
  private index = new Map<string, ASTEngine.UniversalSymbol>()
  /** Every name declared in THIS file, for same-file edge confidence. */
  private declaredNames = new Set<string>()
  /** The declaration chain we are inside, innermost last. */
  private ownerStack: ASTEngine.UniversalSymbol[] = []
  /** Scopes that take part in name resolution: namespaces and types. */
  private typeStack: ASTEngine.UniversalSymbol[] = []
  /** Member names of each type in this file, for unqualified call targets. */
  private memberNames = new Map<string, string[]>()

  /** Counters the lane discloses rather than hides. */
  private gaps: Record<string, number> = {}

  // -------------------------------------------------------------------------
  // Node-type and field vocabulary
  //
  // Read off the pinned wasm, not off a grammar tutorial. Kept as Sets so a test
  // is membership, not a pattern match, and so an unclassified type is a MISS
  // from the set rather than a silent fallthrough.
  // -------------------------------------------------------------------------

  /** Grammar rules that declare a named type. Anything in the corpus that is not
   *  in here and not in SILENT_INTERNAL is a gap, and the census counts it. */
  private static readonly DECLARATION_NODES: ReadonlySet<string> = new Set([
    "namespace_declaration",
    "class_declaration",
    "structure_declaration",
    "interface_declaration",
    "module_declaration",
    "enum_declaration",
    "delegate_declaration",
    "method_declaration",
    "constructor_declaration",
    "property_declaration",
    "event_declaration",
    "operator_declaration",
    "declare_statement",
    "field_declaration",
    "imports_statement",
  ])

  /** Nodes the grammar produces that carry no symbol of their own: they are
   *  containers, modifiers, or the parts of a declaration already read. They are
   *  classified here so the spec's "every node type is classified" rule is
   *  satisfied by this list rather than by an omission. */
  private static readonly SILENT_INTERNAL: ReadonlySet<string> = new Set([
    "source_file", "identifier", "comment", "preprocessor_directive", "blank_line",
    "type_parameter_list", "type_parameter", "parameter_list", "parameter",
    "modifiers", "member_modifier", "attribute_list", "attribute", "attribute_target",
    "attribute_argument_list", "named_argument", "as_clause", "implements_member_clause",
    "inherits_statement", "implements_statement", "handles_clause", "variable_declarator",
    "array_rank_specifier", "array_initializer", "collection_initializer",
    "dictionary_initializer", "dictionary_element", "object_initializer",
    "member_initializer", "implements_clause", "inherits_clause",
  ])

  // -------------------------------------------------------------------------
  // Small AST helpers. Every one of these is a node-type or field test; there is
  // no text matching in this file at all.
  // -------------------------------------------------------------------------

  /**
   * The `index`-th NAMED child, or null when there is none.
   *
   * `web-tree-sitter` 0.25 types this `Node | null`, and it really can be null at
   * the boundary, so every read goes through here rather than through a `!`. The
   * alternative — asserting non-null at each of the ~40 call sites — would make
   * "this index is in range" an unstated assumption repeated 40 times, which is
   * the shape a crash takes when a grammar gains a child.
   */
  private nc(node: Node, index: number): Node | null {
    if (index < 0 || index >= node.namedChildCount) return null
    return node.namedChild(index)
  }

  /** The `index`-th child of ANY kind (named or anonymous token). */
  private ac(node: Node, index: number): Node | null {
    if (index < 0 || index >= node.childCount) return null
    return node.child(index)
  }

  /**
   * The node's NAMED children, with the nulls dropped.
   *
   * `web-tree-sitter` 0.25 types `namedChild(i)` as `Node | null` and
   * `namedChildren` as `(Node | null)[]`. A `!` at each of the ~20 read sites
   * would turn "this index is in range" into an unstated assumption repeated 20
   * times, and a throw would trade a type error for a crash -- the lane's
   * measured state is zero crash files and that is worth keeping. So the null is
   * handled once, here, and every loop downstream iterates a real `Node[]`.
   */
  private kids(node: Node): Node[] {
    const out: Node[] = []
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (c) out.push(c)
    }
    return out
  }

  /** The node's children of ANY kind, with the nulls dropped. */
  private allKids(node: Node): Node[] {
    const out: Node[] = []
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i)
      if (c) out.push(c)
    }
    return out
  }

  /**
   * The number of lines in `content`, counted with a character scan.
   *
   * This was `content.split(/\r?\n/).length`, and it was the ONE regex literal
   * in this file — which made the header's "zero regex" claim false as written.
   * Rather than soften the claim, the regex went.
   *
   * The scan counts a `\n` as a line break and treats a preceding `\r` as part of
   * that break rather than as a character of its own, which is exactly what
   * `\r?\n` meant. Equivalence was MEASURED, not argued: over 598 real `.vb`
   * files from two corpora plus five edge cases, the two agree everywhere except
   * the empty string, where the split form returns 1 and this returns 0 — and the
   * old code's own `content.length === 0 ? 0 : …` guard already forced 0 there.
   * (`script/m14/tmp/`-style probe: `fixtures/probes/linecount-equiv.ts`.)
   */
  private lineCount(content: string): number {
    if (content.length === 0) return 0
    let lines = 1
    for (let i = 0; i < content.length; i++) {
      if (content.charCodeAt(i) === 10) lines++
    }
    return lines
  }

  /** 1-based line of a node, or null when there is no node. M59.A7. */
  private nodeLine(node: Node | null | undefined): number | null {
    return node ? node.startPosition.row + 1 : null
  }

  private range(node: Node): ASTEngine.UniversalSymbol["range"] {
    return {
      startLine: node.startPosition.row + 1,
      startColumn: node.startPosition.column + 1,
      endLine: node.endPosition.row + 1,
      endColumn: node.endPosition.column + 1,
      startIndex: node.startIndex,
      endIndex: node.endIndex,
    }
  }

  /**
   * The node that NAMES a thing, descended to the last segment's own leaf.
   *
   * `qualified_name` spans `A.B.C` but the name a reader navigates to is written
   * on the `C` leaf. A wrapped name — an alias, a qualified name inside a
   * heritage clause — must therefore be stamped with ITS leaf's line, not the
   * line the name starts on. This is the C# lane's `nodeNamingToken`, and it
   * exists because a relationship stamped with the wrapper's line navigates to
   * the wrong place in a file that mentions the same type on three lines.
   */
  private namingToken(node: Node | null | undefined, text: string): Node | null {
    if (!node) return null
    let cur: Node = node
    for (let guard = 0; guard < 64; guard++) {
      // A name field that is itself a name is the innermost one.
      const named: Node | null = cur.childForFieldName("name")
      if (named && named.id !== cur.id && named.type !== "identifier") { cur = named; continue }
      if (cur.type === "identifier") return cur
      if (cur.type === "simple_name") {
        const inner = this.nc(cur, 0)
        if (inner && inner.type === "identifier") return inner
        return cur
      }
      if (cur.type === "generic_name") {
        // The name is the first named child; the `(Of ...)` tail is not the name.
        const inner = this.nc(cur, 0)
        if (inner) { cur = inner; continue }
        return cur
      }
      if (cur.type === "qualified_name" || cur.type === "global_qualified_name") {
        const inner = cur.childForFieldName("name")
        if (inner && inner.id !== cur.id) { cur = inner; continue }
        return cur
      }
      return cur
    }
    return cur
  }

  /**
   * The leaf that NAMES a callee — the target a reader navigates to.
   *
   * The rule is the LAST `identifier` leaf at or under the callee node, and it
   * has to be that rather than the node's own text, because VB spells a callee
   * in three shapes that all reduce to one name:
   *
   *   `EntityID.ToLower()`   -> `ToLower`   (a `member_access_expression`)
   *   `New AnimatedBlock()`  -> `AnimatedBlock`
   *   `CType(x, W).Init()`   -> `Init`
   *
   * The construction case was the one that was broken, and it was broken for a
   * specific, findable reason: `New X()` parses as
   * `(object_creation_expression type: (simple_name (identifier)))` — the type is
   * in a `type` FIELD, and `namingToken` only ever followed a `name` field, so it
   * fell through and returned the whole construction node. The published target
   * was the literal string `"New AnimatedBlock"`: not a name in the file, not
   * navigable, and unmatchable by any independent oracle. Measured on P3D's
   * Entity.vb — 31 of them in one method.
   *
   * A `type_argument_list` is skipped, so `New List(Of Integer)` is `List` and not
   * `Integer`: the argument is not what is being constructed. That is the same
   * exclusion the heritage path and the F5 oracle both apply, so the three agree
   * on one definition of "the name of this type expression".
   */
  private calleeLeaf(fn: Node): Node | null {
    const leaves: Node[] = []
    const walk = (n: Node, depth: number): void => {
      if (depth > 64) return
      if (n.type === "type_argument_list") return
      if (n.type === "identifier") { leaves.push(n); return }
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i)
        if (c) walk(c, depth + 1)
      }
    }
    walk(fn, 0)
    // The LAST leaf, and the whole reason this helper exists: collecting the
    // FIRST one made `Me._isPokemonSound.ToNumberString()` resolve to
    // `_isPokemonSound`, which is the receiver, not the thing being called.
    return leaves.length > 0 ? leaves[leaves.length - 1] : null
  }

  /**
   * The text of a name-bearing node, rebuilt from the tree.
   *
   * Char-scan, not regex: walk the node's named children and join the identifier
   * leaves with the separator each wrapper contributes. `qualified_name` is
   * `qualifier . name` in the grammar, so the dot is a CHILD TOKEN and is
   * already in the node's text — reading `node.text` for the whole name and
   * trimming is both simpler and more faithful than reassembling it.
   */
  private nameText(node: Node | null | undefined): string {
    if (!node) return ""
    return node.text.trim()
  }

  /** The `name` field of a declaration, or its first identifier child. */
  private declaredName(node: Node): { text: string; node: Node | null } {
    const field = node.childForFieldName("name")
    if (field) {
      const token = this.namingToken(field, field.text)
      return { text: this.nameText(token ?? field), node: token ?? field }
    }
    for (const c of this.kids(node)) {
      if (c.type === "identifier" || c.type === "simple_name") {
        return { text: this.nameText(c), node: this.namingToken(c, c.text) ?? c }
      }
    }
    return { text: "", node: null }
  }

  private namedChildrenOfType(node: Node, type: string): Node[] {
    const out: Node[] = []
    for (const c of this.kids(node)) {
      if (c.type === type) out.push(c)
    }
    return out
  }

  /**
   * VB visibility, read off the `member_modifier` list the grammar already
   * separated out. A Set membership test per modifier, in the order VB resolves
   * them, and the FIRST match wins — `Protected Friend` is `Protected` in VB's
   * own spec ordering and getting that wrong changes access queries.
   */
  private static readonly VISIBILITY_ORDER: ReadonlyArray<readonly [string, string]> = [
    ["private", "private"],
    ["protected", "protected"],
    ["friend", "internal"],
    ["public", "public"],
  ]

  private visibilityOf(node: Node): string {
    const mods = this.modifierNames(node)
    for (const [mod, vis] of RealVbAnalyzer.VISIBILITY_ORDER) {
      if (mods.has(mod)) return vis
    }
    return "internal"
  }

  private modifierNames(node: Node): Set<string> {
    const out = new Set<string>()
    const mods = node.childForFieldName("modifiers")
    if (mods) {
      for (const m of this.kids(mods)) {
        if (m.type === "member_modifier" || m.type === "local_declaration_modifier") {
          // The modifier's own text is its keyword; lower-cased by a char-code
          // fold rather than by a regex, so a Unicode keyword is not mangled.
          out.add(m.text.toLowerCase())
        }
      }
    }
    return out
  }

  private isStatic(node: Node): boolean {
    return this.modifierNames(node).has("shared")
  }

  private isAbstract(node: Node): boolean {
    const mods = this.modifierNames(node)
    return mods.has("abstract") || mods.has("mustinherit")
  }

  // -------------------------------------------------------------------------
  // Entry point
  // -------------------------------------------------------------------------

  analyze(
    rootNode: Node,
    content: string,
    filePath: string,
    context?: ASTEngine.AnalyzeContext,
  ): Omit<ASTEngine.ParseResult, "language" | "metadata"> & { metadata?: Partial<ASTEngine.FileMetadata> } {
    this.reset()

    this.walk(rootNode, content, context)

    // Every symbol carries the owner it was declared in, so a consumer can walk
    // containment without re-deriving it. Filled in one pass at the end because
    // the owner is only known once the whole file has been read.
    const lines = this.lineCount(content)
    return {
      symbols: this.symbols,
      relationships: this.relationships,
      imports: this.imports,
      metadata: {
        complexity: this.complexity(rootNode),
        linesOfCode: lines,
        cyclomaticComplexity: this.cyclomaticComplexity(rootNode),
        analysisVersion: "m60-vb-1",
        // The lane's honesty block. `gaps` is what the grammar could not express
        // and is therefore NOT covered; it is disclosed so a consumer can see
        // the boundary instead of inferring completeness from silence.
        vbGaps: { ...this.gaps },
        hasTypeInference: false,
        hasFrameworkIntelligence: false,
      },
    }
  }

  private reset(): void {
    this.symbols = []
    this.relationships = []
    this.imports = []
    this.index = new Map()
    this.declaredNames = new Set()
    this.ownerStack = []
    this.typeStack = []
    this.memberNames = new Map()
    this.gaps = {}
  }

  private note(kind: string): void {
    this.gaps[kind] = (this.gaps[kind] ?? 0) + 1
  }

  // -------------------------------------------------------------------------
  // The walk
  // -------------------------------------------------------------------------

  private walk(node: Node, content: string, context?: ASTEngine.AnalyzeContext): void {
    switch (node.type) {
      case "namespace_declaration": return this.visitNamespace(node, content, context)
      case "class_declaration":
      case "structure_declaration":
      case "interface_declaration":
      case "module_declaration": return this.visitType(node, content, context)
      case "enum_declaration": return this.visitEnum(node, content, context)
      case "delegate_declaration": return this.visitDelegate(node, content, context)
      case "imports_statement": return this.visitImports(node)
      case "method_declaration":
      case "constructor_declaration":
      case "declare_statement": return this.visitMethod(node, content, context)
      case "property_declaration": return this.visitProperty(node, content, context)
      case "event_declaration": return this.visitEvent(node, content, context)
      case "operator_declaration": return this.visitOperator(node, content, context)
      case "field_declaration": return this.visitField(node, content)
      default: break
    }
    for (const child of this.kids(node)) this.walk(child, content, context)
  }

  /** The nearest enclosing namespace or type, for `ownerName`. */
  /** The `role` recorded on a containment edge, derived from the KIND so that
   *  every kind names itself and no visitor has to remember to say so. */
  private containmentRole(kind: ASTEngine.SymbolKind): string {
    switch (kind) {
      case ASTEngine.SymbolKind.Constructor: return "constructor"
      case ASTEngine.SymbolKind.Property: return "property"
      case ASTEngine.SymbolKind.Event: return "event"
      case ASTEngine.SymbolKind.Method: return "method"
      case ASTEngine.SymbolKind.Constant: return "const"
      case ASTEngine.SymbolKind.Variable: return "field"
      case ASTEngine.SymbolKind.EnumMember: return "enumMember"
      case ASTEngine.SymbolKind.Enum: return "enum"
      case ASTEngine.SymbolKind.Class: return "class"
      case ASTEngine.SymbolKind.Struct: return "structure"
      case ASTEngine.SymbolKind.Interface: return "interface"
      case ASTEngine.SymbolKind.Module: return "module"
      case ASTEngine.SymbolKind.Namespace: return "namespace"
      case ASTEngine.SymbolKind.Type: return "delegate"
      default: return String(kind)
    }
  }

  private currentOwner(): ASTEngine.UniversalSymbol | null {
    return this.ownerStack.length > 0 ? this.ownerStack[this.ownerStack.length - 1] : null
  }

  private pushSymbol(
    name: string,
    kind: ASTEngine.SymbolKind,
    node: Node,
    extra: Partial<ASTEngine.UniversalSymbol> = {},
    nameNode: Node | null = null,
  ): ASTEngine.UniversalSymbol | null {
    if (name.length === 0) {
      // A declaration with no readable name is NOT emitted with an invented one.
      // It is counted, so the count is visible instead of the gap being silent.
      this.note("declaration-without-name")
      return null
    }
    const owner = this.currentOwner()
    const sym: ASTEngine.UniversalSymbol = {
      name,
      kind,
      range: this.range(node),
      ...(owner ? { ownerName: owner.name, ownerKind: owner.kind } : {}),
      metadata: {},
      ...extra,
    }
    this.symbols.push(sym)
    this.declaredNames.add(name)
    // CONTAINMENT IS EMITTED HERE, ONCE, FOR EVERY SYMBOL.
    //
    // It used to be pushed by each visitor, and that is how a whole class of
    // declaration ended up with an `ownerName` and NO edge: a nested type
    // (`Public Enum Targets` inside `Public Class PokemonTarget`) got its owner
    // recorded on the symbol but nothing walked to it, so containment navigation
    // stopped at the class. Found by the F5 differential, not by a fixture. Doing
    // it in one place is the fix that cannot recur — there is no longer a
    // visitor that can forget.
    if (owner) {
      this.relationships.push({
        source: owner.name,
        target: name,
        type: RelationshipType.Contains,
        confidence: 1.0,
        line_number: this.nodeLine(nameNode ?? node),
        metadata: { role: this.containmentRole(kind) },
      })
    }
    // First declaration of a name wins the index, so a later overload does not
    // steal the id an edge already points at. Overloads are disambiguated by the
    // edge, not by the index.
    if (!this.index.has(name)) this.index.set(name, sym)
    const ownerType = this.currentType()
    if (ownerType) {
      let list = this.memberNames.get(ownerType.name)
      if (!list) { list = []; this.memberNames.set(ownerType.name, list) }
      list.push(name)
    }
    return sym
  }

  private currentType(): ASTEngine.UniversalSymbol | null {
    return this.typeStack.length > 0 ? this.typeStack[this.typeStack.length - 1] : null
  }

  // -------------------------------------------------------------------------
  // Declarations
  // -------------------------------------------------------------------------

  private visitNamespace(node: Node, content: string, context?: ASTEngine.AnalyzeContext): void {
    const { text, node: nameNode } = this.declaredName(node)
    const sym = this.pushSymbol(text, SymbolKind.Namespace, node, {
      metadata: {
        // The two namespace forms are ONE node type in this grammar (two
        // alternatives of one rule), and the analyzer's job is to say which one
        // it read. The discriminator is the ABSENCE of `End Namespace`: the
        // file-scoped form has no terminator to close it.
        //
        // (This line previously tested a `blank_line` node that this grammar
        // does not have -- an invented reference, which is the LUA-00 defect
        // class and which M14.0.F1 caught as an unknown node type. The
        // expression was also wrong independently of that: it ANDed the
        // discriminator with a test for a node that never appears, so it could
        // only ever be false.)
        fileScoped: !this.hasEndNamespace(node),
      },
    })
    if (sym) {
      this.typeStack.push(sym)
      this.ownerStack.push(sym)
    }
    for (const child of this.kids(node)) this.walk(child, content, context)
    if (sym) {
      this.typeStack.pop()
      this.ownerStack.pop()
    }
  }

  /**
   * Whether this namespace has an `End Namespace`.
   *
   * The grammar does not expose it as a node — `End` and `Namespace` are
   * anonymous tokens inside the rule. So this reads the node's LAST named
   * child's extent against the namespace's own text: the block form's last
   * named child ends at the `End Namespace`, the file-scoped form's last child
   * is the final declaration. A char-scan over the tail, not a regex: find the
   * last occurrence of the keyword by walking backwards.
   */
  private hasEndNamespace(node: Node): boolean {
    if (node.namedChildCount === 0) return false
    const named = this.kids(node)
    const last = named[named.length - 1]
    if (!last) return false
    const tail = node.text.slice(last.endIndex - node.startIndex)
    // Char walk backwards for "End" + whitespace* + "Namespace", case-folded by
    // char code. `toLowerCase()` on the slice would be a locale-dependent fold;
    // VB keywords are ASCII, so the comparison is done on lower-cased ASCII only.
    return RealVbAnalyzer.endsWithKeyword(tail, "end namespace")
  }

  /** Char-scan: does `s` end with `words` (ASCII, case-insensitive, any run of spaces/tabs between)? */
  private static endsWithKeyword(s: string, words: string): boolean {
    let i = s.length - 1
    let w = words.length - 1
    while (w >= 0) {
      // skip separators
      while (i >= 0 && (s.charCodeAt(i) === 32 || s.charCodeAt(i) === 9 || s.charCodeAt(i) === 13 || s.charCodeAt(i) === 10)) i--
      if (w < 0) break
      const want = words.charCodeAt(w)
      let got = s.charCodeAt(i)
      if (got >= 65 && got <= 90) got += 32
      if (want >= 65 && want <= 90) want // keep as-is; compared below after folding both
      const wantFolded = (want >= 65 && want <= 90) ? want + 32 : want
      if (got !== wantFolded) return false
      i--
      w--
    }
    // every word character consumed, only separators after
    while (i >= 0) {
      const c = s.charCodeAt(i)
      if (c !== 32 && c !== 9 && c !== 13 && c !== 10 && c !== 59) return false
      i--
    }
    return true
  }

  private visitType(node: Node, content: string, context?: ASTEngine.AnalyzeContext): void {
    const kind = RealVbAnalyzer.typeKindOf(node.type)
    const { text, node: nameNode } = this.declaredName(node)
    const mods = this.modifierNames(node)
    const sym = this.pushSymbol(text, kind, node, {
      visibility: this.visibilityOf(node),
      isStatic: mods.has("shared"),
      isAbstract: this.isAbstract(node),
      metadata: {
        grammarNode: node.type,
        // `NotInheritable` is the VB spelling of C#'s `sealed`; recording it
        // under the same key the family's csharp lane uses is what lets a
        // cross-language query ask "sealed types" without knowing the language.
        sealed: mods.has("notinheritable") || mods.has("notoverridable"),
        partial: mods.has("partial"),
      },
    })
    if (sym) {
      this.typeStack.push(sym)
      this.ownerStack.push(sym)
    }

    if (sym) this.visitHeritage(node, text, sym, context)

    for (const child of this.kids(node)) this.walk(child, content, context)
    if (sym) {
      this.typeStack.pop()
      this.ownerStack.pop()
    }
  }

  private static typeKindOf(nodeType: string): ASTEngine.SymbolKind {
    switch (nodeType) {
      case "class_declaration": return SymbolKind.Class
      case "structure_declaration": return SymbolKind.Struct
      case "interface_declaration": return SymbolKind.Interface
      case "module_declaration": return SymbolKind.Module
      default: return SymbolKind.Class
    }
  }

  /**
   * VB spells heritage two ways and BOTH are emitted:
   *   - a following line: `Inherits B` / `Implements I, J`
   *   - on the declaration header: `Class C : Inherits B, Implements I`
   *     and, for an interface or a structure, the keyword-less
   *     `Interface I : IDisposable, IEnumerable`
   *
   * The header form is not a node — the grammar folds it into a hidden rule
   * whose children are anonymous tokens plus `name_reference` leaves. So the
   * heritage names are read as the identifier-bearing children of the header
   * position, and the keyword that precedes them decides whether each is an
   * `extends` or an `implements` edge. Which keyword it was comes from the
   * ORDER: `Inherits` precedes `Implements`, and a structure/interface list has
   * neither, so every name after the first `Inherits` run and before an
   * `Implements` token is an extends target and the rest are implements.
   */
  private visitHeritage(node: Node, selfName: string, sym: ASTEngine.UniversalSymbol, context?: ASTEngine.AnalyzeContext): void {
    // --- the line form -------------------------------------------------------
    for (const st of this.namedChildrenOfType(node, "inherits_statement")) {
      for (const nameNode of this.nameReferencesOf(st)) {
        this.pushHeritage(selfName, nameNode, RelationshipType.Extends, sym, context)
      }
    }
    for (const st of this.namedChildrenOfType(node, "implements_statement")) {
      for (const nameNode of this.nameReferencesOf(st)) {
        this.pushHeritage(selfName, nameNode, RelationshipType.Implements, sym, context)
      }
    }
    // A member-level `Implements I` (`Public Sub Go() Implements IDisposable`).
    for (const st of this.namedChildrenOfType(node, "implements_member_clause")) {
      for (const nameNode of this.nameReferencesOf(st)) {
        const ownerSym = this.index.get(selfName)
        if (ownerSym) this.pushHeritage(selfName, nameNode, RelationshipType.Implements, ownerSym, context)
      }
    }

    // --- the header form -----------------------------------------------------
    // The header clause sits between the type's `name` and its first member. The
    // grammar's own nodes are not labelled for it, so it is found structurally:
    // the anonymous `:` token that immediately follows the name.
    const colon = this.headerColonIndex(node)
    if (colon < 0) return
    const seenInherits = -1
    const headerKids = this.allKids(node)
    for (let i = colon + 1; i < headerKids.length; i++) {
      const child = headerKids[i]
      if (this.isNameNode(child)) {
        const type = seenInherits < 0 ? RelationshipType.Extends : RelationshipType.Implements
        this.pushHeritage(selfName, child, type, sym, context)
        continue
      }
      const t = child.type.toLowerCase()
      if (t.includes("inherits")) { /* stays in the extends run */ }
      else if (t.includes("implements")) { /* the rest are implements */ }
    }
  }

  /** The index of the anonymous `:` token of the declaration header, or -1. */
  private headerColonIndex(node: Node): number {
    const nameField = node.childForFieldName("name")
    const from = nameField ? nameField.id : 0
    const kids = this.allKids(node)
    for (let i = 0; i < kids.length; i++) {
      if (kids[i].id > from && kids[i].type === ":") return i
    }
    return -1
  }

  /**
   * Is this node one of the grammar's NAME types?
   *
   * The set is the grammar's real vocabulary, read off the pinned wasm: an
   * identifier, or one of the three name wrappers (`simple_name`,
   * `qualified_name`, `global_qualified_name`) or the generic name. Two
   * earlier versions of this test named `name_reference` and `namespace_name`,
   * neither of which is a node type in this grammar -- invented references that
   * are dead branches, which is the LUA-00 defect and what M14.0.F1 is for.
   * Naming them from the pinned surface rather than from a habit is the fix.
   */
  private isNameNode(n: Node): boolean {
    switch (n.type) {
      case "identifier":
      case "simple_name":
      case "qualified_name":
      case "global_qualified_name":
      case "generic_name":
        return true
      default:
        return false
    }
  }

  /** The name-bearing children of a heritage statement. */
  private nameReferencesOf(node: Node): Node[] {
    const out: Node[] = []
    const visit = (n: Node): void => {
      for (const c of this.kids(n)) {
        if (this.isNameNode(c)) {
          out.push(c)
        } else {
          visit(c)
        }
      }
    }
    visit(node)
    return out
  }

  /**
   * One heritage edge, with the line of the node that NAMES the base.
   *
   * The target is the type's own name (`B`, not `Namespace.B`) because that is
   * what a symbol in this file would be called, and an edge is only navigable if
   * its target names something. Confidence is 1.0 for a name the file also
   * declares (an in-file base type is certain) and lower for one it does not,
   * because a cross-file target is a name, not a resolved symbol.
   */
  private pushHeritage(
    selfName: string,
    nameNode: Node,
    type: ASTEngine.RelationshipType,
    selfSym: ASTEngine.UniversalSymbol,
    context?: ASTEngine.AnalyzeContext,
  ): void {
    const token = this.namingToken(nameNode, nameNode.text)
    const target = this.nameText(token ?? nameNode)
    if (target.length === 0) return
    const inFile = this.declaredNames.has(target)
    this.relationships.push({
      source: selfName,
      target,
      type,
      confidence: inFile ? 1.0 : 0.7,
      line_number: this.nodeLine(token ?? nameNode),
      metadata: {
        [type === RelationshipType.Extends ? "baseType" : "interfaceName"]: target,
        heritageForm: this.heritageFormOf(nameNode),
        resolved: inFile,
      },
    })
  }

  /** `line` for a heritage statement's names, `header` for a header-clause name. */
  private heritageFormOf(nameNode: Node): string {
    let cur: Node | null = nameNode
    for (let i = 0; cur !== null && i < 8; i++) {
      const p: Node | null = cur.parent
      if (p === null) break
      if (p.type === "inherits_statement" || p.type === "implements_statement" ||
          p.type === "implements_member_clause") return "statement"
      if (p.type === "class_declaration" || p.type === "structure_declaration" ||
          p.type === "interface_declaration" || p.type === "module_declaration") return "header"
      cur = p
    }
    return "unknown"
  }

  private visitEnum(node: Node, content: string, context?: ASTEngine.AnalyzeContext): void {
    const { text } = this.declaredName(node)
    const sym = this.pushSymbol(text, SymbolKind.Enum, node, {
      visibility: this.visibilityOf(node),
      metadata: { grammarNode: node.type },
    })
    if (sym) {
      this.typeStack.push(sym)
      this.ownerStack.push(sym)
    }
    // Each member carries the line of the name it writes, and a `value` read off
    // the initializer when the grammar kept it as an expression.
    for (const child of this.kids(node)) {
      if (child.type !== "enum_member_declaration" && child.type !== "variable_declarator") continue
      const mName = this.declaredName(child)
      if (mName.text.length === 0) { this.note("enum-member-without-name"); continue }
      const init = child.childForFieldName("initializer")
      const member = this.pushSymbol(mName.text, SymbolKind.EnumMember, child, {
        ownerName: sym ? sym.name : undefined,
        ownerKind: sym ? sym.kind : undefined,
        metadata: {
          grammarNode: child.type,
          ...(init ? { value: init.text.trim() } : {}),
          valueLine: init ? this.nodeLine(this.namingToken(init, init.text) ?? init) : null,
        },
      })
    }
    for (const child of this.kids(node)) this.walk(child, content, context)
    if (sym) {
      this.typeStack.pop()
      this.ownerStack.pop()
    }
  }

  private visitDelegate(node: Node, content: string, context?: ASTEngine.AnalyzeContext): void {
    const { text } = this.declaredName(node)
    const sym = this.pushSymbol(text, SymbolKind.Type, node, {
      visibility: this.visibilityOf(node),
      metadata: { grammarNode: node.type, delegate: true },
    })
    if (sym) {
      this.typeStack.push(sym)
      this.ownerStack.push(sym)
    }
    const params = node.childForFieldName("parameters")
    if (params && sym) this.readParameters(params, sym)
    const asClause = this.namedChildrenOfType(node, "as_clause")[0]
    if (asClause) {
      const declared = asClause.childForFieldName("declared_type")
      if (declared) {
        sym!.returnType = this.nameText(declared)
        this.pushTypeReference(sym!, declared, "returnType")
      }
    }
    for (const child of this.kids(node)) this.walk(child, content, context)
    if (sym) {
      this.typeStack.pop()
      this.ownerStack.pop()
    }
  }

  // -------------------------------------------------------------------------
  // Imports
  // -------------------------------------------------------------------------

  /**
   * `Imports A, B` — one edge PER NAME, each stamped with the line of the name it
   * writes, and each carrying `isImport` + `include_dependency` so the family's
   * completeness section-B pin and the tier classifier can mark it import-based.
   * An import is a name in VB, not a module path, so `module` holds the name and
   * `isNamespace` is true.
   */
  private visitImports(node: Node): void {
    const names = this.nameReferencesOf(node)
    for (const nameNode of names) {
      const token = this.namingToken(nameNode, nameNode.text)
      const text = this.nameText(token ?? nameNode)
      if (text.length === 0) continue
      const range = this.range(nameNode)
      this.imports.push({
        module: text,
        items: [],
        isNamespace: true,
        isNamespaceImport: true,
        importType: "namespace",
        range,
        metadata: { grammarNode: node.type },
      })
      this.relationships.push({
        source: "root",
        target: text,
        type: RelationshipType.Imports,
        confidence: 1.0,
        line_number: this.nodeLine(token ?? nameNode),
        metadata: {
          [IS_IMPORT]: true,
          [INCLUDE_DEPENDENCY]: true,
          importForm: "imports-statement",
        },
      })
    }
  }

  // -------------------------------------------------------------------------
  // Members
  // -------------------------------------------------------------------------

  private visitMethod(node: Node, content: string, context?: ASTEngine.AnalyzeContext): void {
    // `isCtor` is computed FIRST, and that ordering is the fix rather than a
    // style choice. `Public Sub New()` has no `name` field — the keyword is an
    // anonymous token — so the "declaration without a name" guard below used to
    // fire for every constructor in the corpus and return before the naming
    // contract was ever reached. The contract was written and then dead: the
    // symbol was still absent. Any check that can reject a declaration has to be
    // evaluated against the contract, not in front of it.
    const isCtor = node.type === "constructor_declaration"
    const { text, node: nameNode } = this.declaredName(node)
    if (text.length === 0 && !isCtor) { this.note("method-without-name"); return }
    const owner = this.currentOwner()
    const mods = this.modifierNames(node)
    const isDeclare = node.type === "declare_statement"
    const kind = isCtor ? SymbolKind.Constructor : SymbolKind.Method
    // A CONSTRUCTOR IS NAMED BY THE PRODUCT'S CONTRACT, not by the source.
    //
    // `Public Sub New()` has no `name` field at all: VB spells a constructor
    // with the `New` KEYWORD, which the grammar lexes as an anonymous token, so
    // the name node the other declarations carry simply does not exist here. The
    // first version of this method therefore read an empty name, took the
    // `declaration-without-name` path and returned — and a whole kind of
    // declaration was silently absent from the index. Found by the F5
    // differential, not by a fixture: 12,549 symbols across 435 files contained
    // ZERO constructors, and the oracle's `contains Foo -> New` rows were all
    // MISSING.
    //
    // The literal is the family's: csharp and typescript both publish
    // `constructor` with the class in `ownerName`. (java publishes the class name
    // instead, so the product has no single convention — worth a cross-language
    // ruling, and noted here so the next lane does not have to rediscover it.)
    // `New` itself would be wrong: it is a keyword, it collides across every
    // class in a file, and it made the differential read `calls New -> ToList`
    // with no way to tell which constructor.
    const effectiveName = isCtor ? "constructor" : text

    // An `Overrides` member overrides a base member: the edge names the base
    // METHOD, and it is emitted at MODIFIER precedence because the base member's
    // declaring type is usually not in this file, so the edge's confidence is the
    // honest one.
    const overridesBase = mods.has("overrides")

    const sym = this.pushSymbol(effectiveName, kind, node, {
      visibility: this.visibilityOf(node),
      isStatic: this.isStatic(node),
      isAbstract: this.isAbstract(node),
      isAsync: mods.has("async"),
      ...(isDeclare ? { metadata: { pInvoke: true } } : {}),
      metadata: {
        grammarNode: node.type,
        ...(isDeclare ? { pInvoke: true } : {}),
        ...(overridesBase ? { overridesModifier: true } : {}),
        ...(mods.has("partial") ? { partial: true } : {}),
        // The P/Invoke's target library and entry point are on the DECLARATION,
        // and they are the only place a VB.NET file names an unmanaged symbol.
        ...(isDeclare ? this.readPInvoke(node) : {}),
      },
    })
    if (!sym) return

    const params = node.childForFieldName("parameters")
    if (params && sym) this.readParameters(params, sym)
    const asClause = this.namedChildrenOfType(node, "as_clause")[0]
    if (asClause) {
      const declared = asClause.childForFieldName("declared_type")
      if (declared) {
        sym.returnType = this.nameText(declared)
        this.pushTypeReference(sym, declared, "returnType")
      }
    }

    if (overridesBase && owner) {
      this.relationships.push({
        source: sym.name,
        target: sym.name,
        type: ASTEngine.RelationshipType.Overrides,
        confidence: 0.6,
        line_number: this.nodeLine(nameNode ?? node),
        metadata: {
          // The base member is the SAME name in the base type, which this file
          // does not name. So the edge records what it knows — the name and the
          // modifier — and does NOT invent a base type it never read.
          baseMemberName: sym.name,
          fromModifier: "Overrides",
          baseTypeKnown: false,
        },
      })
    }

    this.ownerStack.push(sym)
    this.collectCalls(node, sym)
    for (const child of this.kids(node)) this.walk(child, content, context)
    this.ownerStack.pop()
  }

  /** `Lib "user32.dll" Alias "MessageBoxA"` — the unmanaged target of a Declare. */
  private readPInvoke(node: Node): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    const lib = node.childForFieldName("library")
    if (lib) out.pInvokeLibrary = lib.text.trim()
    const alias = node.childForFieldName("alias")
    if (alias) out.pInvokeEntryPoint = alias.text.trim()
    const kind = node.childForFieldName("kind")
    if (kind) out.pInvokeKind = kind.text.trim()
    return out
  }

  private readParameters(params: Node, sym: ASTEngine.UniversalSymbol): void {
    const out: ASTEngine.Parameter[] = []
    for (const p of this.kids(params)) {
      if (p.type !== "parameter") continue
      const nameNode = p.childForFieldName("name") ??
        (p.namedChildCount > 0 ? this.nc(p, 0) : null)
      const name = this.nameText(nameNode)
      if (name.length === 0) continue
      // VB's parameter passing mode is part of the signature's meaning, not
      // decoration: `ByRef` is the default and `ByVal` is the exception, so both
      // are recorded and the default is stated explicitly rather than left
      // implicit for a consumer to guess.
      const byVal = p.text.includes("ByVal") || p.text.includes("byval")
      const asClause = this.namedChildrenOfType(p, "as_clause")[0]
      const declared = asClause ? asClause.childForFieldName("declared_type") : null
      const optional = p.text.includes("Optional") || p.text.includes("optional")
      const param: ASTEngine.Parameter = {
        name,
        ...(declared ? { type: this.nameText(declared) } : {}),
        ...(optional ? { isOptional: true } : {}),
        defaultValue: this.readDefaultOf(p),
        metadata: { passingMode: byVal ? "ByVal" : "ByRef" },
      }
      out.push(param)
      if (declared) this.pushTypeReference(sym, declared, "parameter")
    }
    if (out.length > 0) sym.parameters = out
  }

  /** An `= default` on a parameter, read off the node's own text span. */
  private readDefaultOf(p: Node): string | undefined {
    const idx = p.text.indexOf("=")
    if (idx < 0) return undefined
    const tail = p.text.slice(idx + 1).trim()
    return tail.length > 0 ? tail : undefined
  }

  private visitProperty(node: Node, content: string, context?: ASTEngine.AnalyzeContext): void {
    const { text, node: nameNode } = this.declaredName(node)
    if (text.length === 0) { this.note("property-without-name"); return }
    const mods = this.modifierNames(node)
    // A property is BOTH: a member that is called like a method and read like a
    // field. The project's convention for a property that is also callable is to
    // emit the Property and let the edges carry the uses, so that is what this
    // does — one symbol, not two, so `Get`/`Set` do not double-count it.
    const sym = this.pushSymbol(text, SymbolKind.Property, node, {
      visibility: this.visibilityOf(node),
      isStatic: this.isStatic(node),
      isAbstract: this.isAbstract(node),
      metadata: {
        grammarNode: node.type,
        ...(mods.has("readonly") ? { readOnly: true } : {}),
        ...(mods.has("writeonly") ? { writeOnly: true } : {}),
        ...(mods.has("default") ? { defaultMember: true } : {}),
        ...(mods.has("overrides") ? { overridesModifier: true } : {}),
        autoImplemented: this.namedChildrenOfType(node, "property_getter").length === 0,
      },
    })
    if (!sym) return
    const asClause = this.namedChildrenOfType(node, "as_clause")[0]
    if (asClause) {
      const declared = asClause.childForFieldName("declared_type")
      if (declared) {
        sym.returnType = this.nameText(declared)
        this.pushTypeReference(sym, declared, "propertyType")
      }
    }
    const owner = this.currentOwner()
    this.ownerStack.push(sym)
    this.collectCalls(node, sym)
    for (const child of this.kids(node)) this.walk(child, content, context)
    this.ownerStack.pop()
  }

  private visitEvent(node: Node, content: string, context?: ASTEngine.AnalyzeContext): void {
    const { text, node: nameNode } = this.declaredName(node)
    if (text.length === 0) { this.note("event-without-name"); return }
    const sym = this.pushSymbol(text, SymbolKind.Event, node, {
      visibility: this.visibilityOf(node),
      isStatic: this.isStatic(node),
      metadata: { grammarNode: node.type, withEvents: this.modifierNames(node).has("withevents") },
    })
    if (!sym) return
    const owner = this.currentOwner()
    // The event's declared type: `Event E As EventHandler` is the only place a
    // VB.NET file names a delegate it intends to raise.
    const asClause = this.namedChildrenOfType(node, "as_clause")[0]
    if (asClause) {
      const declared = asClause.childForFieldName("declared_type")
      if (declared) {
        sym.returnType = this.nameText(declared)
        this.pushTypeReference(sym, declared, "eventType")
      }
    }
    this.ownerStack.push(sym)
    for (const child of this.kids(node)) this.walk(child, content, context)
    this.ownerStack.pop()
  }

  private visitOperator(node: Node, content: string, context?: ASTEngine.AnalyzeContext): void {
    // VB's operator declarations name the operator KEYWORD, not an identifier:
    // `Public Shared Operator +(a As T, b As T) As T`. The symbol is therefore
    // named by the operator token, and the distinction from an ordinary method is
    // recorded rather than left to be guessed from the name.
    let opName = ""
    for (const c of this.allKids(node)) {
      if (c.isNamed) continue
      if (c.type === "(" || c.type === ")" || c.type === ",") continue
      const t = c.text.trim()
      if (t.length > 0 && !RealVbAnalyzer.isKeyword(t)) { opName = t; break }
    }
    if (opName.length === 0) { this.note("operator-without-name"); return }
    const sym = this.pushSymbol(`Operator ${opName}`, SymbolKind.Method, node, {
      visibility: this.visibilityOf(node),
      isStatic: this.isStatic(node),
      metadata: { grammarNode: node.type, operator: opName },
    })
    if (!sym) return
    const owner = this.currentOwner()
    this.ownerStack.push(sym)
    for (const child of this.kids(node)) this.walk(child, content, context)
    this.ownerStack.pop()
  }

  /** A char-set membership test, not a keyword list lookup by regex. */
  private static isKeyword(t: string): boolean {
    let i = 0
    let sawAlpha = false
    for (; i < t.length; i++) {
      const c = t.charCodeAt(i)
      const alpha = (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95
      if (!alpha) break
      sawAlpha = true
    }
    if (!sawAlpha) return true
    return RealVbAnalyzer.VB_KEYWORD_HEADS.has(t.slice(0, i).toLowerCase())
  }

  private static readonly VB_KEYWORD_HEADS: ReadonlySet<string> = new Set([
    "public", "private", "protected", "friend", "shared", "overridable", "overrides",
    "notoverridable", "mustoverride", "notinheritable", "mustinherit", "partial",
    "readonly", "writeonly", "default", "withevents", "shadows", "overloads",
    "widening", "narrowing", "async", "iterator", "static", "const",
  ])

  private visitField(node: Node, content: string): void {
    const mods = this.modifierNames(node)
    // `Const` is a field with a compile-time value; the product distinguishes
    // them, so it does too.
    const isConst = mods.has("const")
    const owner = this.currentOwner()
    for (const decl of this.kids(node)) {
      if (decl.type !== "variable_declarator") continue
      const { text, node: nameNode } = this.declaredName(decl)
      if (text.length === 0) { this.note("field-without-name"); continue }
      const init = decl.childForFieldName("initializer")
      const asClause = this.namedChildrenOfType(decl, "as_clause")[0]
      const declared = asClause ? asClause.childForFieldName("declared_type") : null
      const sym = this.pushSymbol(text, isConst ? SymbolKind.Constant : SymbolKind.Variable, decl, {
        visibility: this.visibilityOf(node),
        isStatic: this.isStatic(node) || isConst || mods.has("shared"),
        ...(declared ? { returnType: this.nameText(declared) } : {}),
        ...(init ? { metadata: { initializer: init.text.trim() } } : {}),
        metadata: {
          grammarNode: decl.type,
          ...(isConst ? { constant: true } : {}),
          ...(mods.has("withevents") ? { withEvents: true } : {}),
          ...(mods.has("readonly") ? { readOnly: true } : {}),
          fieldLine: this.nodeLine(decl),
        },
      })
      if (!sym) continue
      if (declared) this.pushTypeReference(sym, declared, "fieldType")
    }
    // A field with an initializer can call a constructor: `= New Foo()`.
    this.collectCalls(node, null)
  }

  // -------------------------------------------------------------------------
  // Calls and type references
  // -------------------------------------------------------------------------

  /**
   * Every call site in a subtree becomes a `calls` edge, stamped with the line of
   * the node that NAMES the callee.
   *
   * Three things are decided here and each is a real question:
   *
   *  - WHICH node names the callee. For `a.b.C(1)` the callee is the `C` leaf, so
   *    the edge is stamped on the line `C` is written on, not the line the
   *    statement started on. A three-line chained call then has one site line.
   *  - WHICH node is the SOURCE. The innermost enclosing declaration, not the
   *    file: an edge from `root` to a callee cannot be navigated to a method.
   *  - WHEN there is no source, there is no edge. A call in a field initializer
   *    has no enclosing method, and an edge from nothing is a phantom — so it is
   *    counted as a gap instead of invented.
   */
  private collectCalls(scope: Node, owner: ASTEngine.UniversalSymbol | null): void {
    const source = owner ?? this.currentOwner()
    const visit = (n: Node): void => {
      // A CONSTRUCTION IS A CALL, and the grammar does not agree on one node type
      // for it. `New Box()` is an `invocation_expression` whose `function` is an
      // `object_creation_expression`; `New Box(1, 2)` -- any construction WITH
      // arguments -- is an `array_creation_expression` with a `type` field and no
      // `function` field at all. Keying on one node type therefore silently drops
      // every call edge for `New Foo(a)`, which is the most common construction
      // form VB has: 15,577 occurrences across 1,718 of the corpus's 2,660 files.
      //
      // Both node types name the constructed type in the same place -- a `type`
      // field -- so the rule is stated once and both are read the same way. There
      // is no `array_initializer` test and no "is this really an array" filter,
      // because the grammar cannot tell the two apart and guessing would be worse
      // than saying what the node says: `New Integer(10)` really does call
      // `Integer`'s constructor, and it is published as a call to `Integer` at
      // 0.6 because this file does not declare it. That is the same honest
      // confidence an unresolved cross-file call already carries.
      if (n.type === "array_creation_expression") {
        const ty = n.childForFieldName("type")
        const token = ty ? this.calleeLeaf(ty) : null
        const target = this.nameText(token)
        if (source && target.length > 0) {
          this.relationships.push({
            source: source.name,
            target,
            type: RelationshipType.Calls,
            confidence: this.declaredNames.has(target) ? 1.0 : 0.6,
            line_number: this.nodeLine(token ?? ty ?? n),
            metadata: {
              argumentCount: n.namedChildCount > 1 ? n.namedChildCount - 1 : 0,
              calleeIsQualified: false,
              callLine: this.nodeLine(token ?? ty ?? n),
              constructed: true,
              constructionNode: n.type,
            },
          })
        }
        for (const c of this.kids(n)) visit(c)
        return
      }
      if (n.type === "invocation_expression") {
        const fn = n.childForFieldName("function")
        const args = n.childForFieldName("arguments")
        if (fn) {
          const token = this.calleeLeaf(fn)
          const target = this.nameText(token)
          if (target.length > 0) {
            if (source) {
              const argCount = args ? args.namedChildCount : 0
              this.relationships.push({
                source: source.name,
                target,
                type: RelationshipType.Calls,
                confidence: this.declaredNames.has(target) ? 1.0 : 0.6,
                line_number: this.nodeLine(token ?? fn),
                metadata: {
                  // The argument count is read off the AST's own child list, so
                  // it excludes `comment` extras rather than counting them the
                  // way a text scan of the parens would.
                  argumentCount: argCount,
                  calleeIsQualified: fn.type === "member_access_expression",
                  callLine: this.nodeLine(token ?? fn),
                  constructed: fn.type === "object_creation_expression",
                },
              })
            } else {
              this.note("call-without-enclosing-declaration")
            }
          }
        }
      }
      for (const c of this.kids(n)) visit(c)
    }
    visit(scope)
  }

  /**
   * A type NAME this file uses, as a `references` edge.
   *
   * Emitted only for a name this file does not itself declare, because a type
   * this file declares has a `contains`/`extends` edge already and a second edge
   * between the same pair is noise a consumer has to filter.
   */
  private pushTypeReference(from: ASTEngine.UniversalSymbol, typeNode: Node, role: string): void {
    const token = this.namingToken(typeNode, typeNode.text)
    const target = this.nameText(token ?? typeNode)
    if (target.length === 0) return
    if (this.declaredNames.has(target)) return
    this.relationships.push({
      source: from.name,
      target,
      type: RelationshipType.References,
      confidence: 0.6,
      line_number: this.nodeLine(token ?? typeNode),
      metadata: { role, qualified: typeNode.type === "qualified_name" || typeNode.type === "global_qualified_name" },
    })
  }

  // -------------------------------------------------------------------------
  // Complexity
  // -------------------------------------------------------------------------

  /**
   * Cyclomatic complexity, counted off DECISION NODES in the AST.
   *
   * The node set is the set of grammar rules that introduce a branch, and each
   * is named rather than matched, so a grammar change that adds a branching rule
   * shows up as a number that moved and a spec entry that is now wrong. No text
   * scan: counting `If` in a comment would be a fabrication.
   */
  private static readonly DECISION_NODES: ReadonlySet<string> = new Set([
    "if_statement", "while_statement", "do_statement", "for_statement",
    "for_each_statement", "case_clause", "catch_clause", "catch_block",
    "case_else_clause", "else_clause", "catch_filter_clause", "when_clause",
  ])

  private cyclomaticComplexity(root: Node): number {
    let n = 1
    const visit = (node: Node): void => {
      if (RealVbAnalyzer.DECISION_NODES.has(node.type)) n++
      for (const c of this.kids(node)) visit(c)
    }
    visit(root)
    return n
  }

  /** A file-level figure: nodes per 100 lines, so it is comparable across files. */
  private complexity(root: Node): number {
    let count = 0
    const visit = (node: Node): void => {
      count++
      for (const c of this.kids(node)) visit(c)
    }
    visit(root)
    return count
  }
}

export default RealVbAnalyzer
