import type { Node } from "web-tree-sitter"
import { ASTEngine } from "./engine"

interface CssContext {
  symbols: ASTEngine.UniversalSymbol[]
  relationships: ASTEngine.UniversalRelationship[]
  imports: ASTEngine.ImportInfo[]
  exports: ASTEngine.ExportInfo[]
  errors: ASTEngine.ParseError[]
  content: string
  keyframeNames: Record<string, boolean>
  mixinNames: Record<string, boolean>
  frameworks: Record<string, boolean>
  patterns: Record<string, boolean>
  /**
   * Whether the stylesheet carries a parse error anywhere. The grammar signals a
   * construct it could not read by emitting an ERROR for that construct's head
   * and re-parsing the remainder as a SIBLING, so the damaged region is only
   * identifiable relative to an error — which is what this flag records. Set
   * once, before the walk, so the test costs nothing per node.
   */
  fileHasParseError: boolean
  /**
   * selector name -> the properties it declares. See `recordDeclaredProperty`:
   * a CSS property name is a token in a declaration, not a graph node, so this
   * rides the symbol payload rather than a relationship to a name that does not
   * exist in the graph.
   */
  declaredProperties: Record<string, string[]>
  /** Distinct media-scope names already published as symbols, and where first seen. */
  mediaScopes: Record<string, boolean>
  mediaScopeFirstRange: Record<string, ASTEngine.UniversalSymbol["range"]>
  /**
   * Selector-chain edges, held until every symbol is known. A `contains` edge is
   * a claim about two graph nodes, and a chain leaf is not a node — see the
   * ruling at the emission site.
   */
  deferredChainEdges: { from: string; to: string; rule: string }[]
  /** raw selector group -> the chain leaves it is composed of. */
  selectorChains: Record<string, string[]>
  /** emitted vs withheld selector-chain edges, for the F6/F9 pins. */
  chainEdgeTally?: { emitted: number; withheld: number }
}

interface StackFrame {
  node: Node
  media: string
  layer: string
  container: string
  /**
   * A `@scope` prelude — `@scope (.a) to (.b) { … }`. It is a SELECTOR, not a
   * media condition, so it gets its own frame field rather than being folded
   * into `media` (which would misname it) or dropped (which is what happened:
   * `scope_statement` had no case at all, so rules inside a `@scope` were
   * attributed to whatever scope happened to enclose them).
   */
  scope: string
  currentSelector: string
}

// ============================================================================
// PURE-STRING HELPERS (regex-free)
// ============================================================================

// Strip ALL quote characters from a string (multi-quote values like
// `url("theme.css")` inner text). Pure-String scan.
function stripAllQuotes(text: string): string {
  let out = ""
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c !== '"' && c !== "'") out += c
  }
  return out
}

// Unwrap `url(...)` / `url("...")` into the inner value. Pure-String.
function unwrapUrl(text: string): string {
  if (text.startsWith("url(") && text.endsWith(")")) {
    return stripAllQuotes(text.slice(4, -1).trim())
  }
  return stripAllQuotes(text)
}

// Replace every `&` in a nesting selector with the parent selector.
// Pure-String scan (the grammar exposes nesting as a `nesting_selector`
// node, but the resolved text needs this substitution).
function replaceAll(text: string, needle: string, replacement: string): string {
  let out = ""
  let i = 0
  while (i < text.length) {
    if (text.startsWith(needle, i)) {
      out += replacement
      i += needle.length
    } else {
      out += text[i]
      i++
    }
  }
  return out
}

// Collapse every run of whitespace to a single space and trim. A symbol name
// must be single-line and deterministic: an at-rule prelude can wrap across
// lines in real stylesheets, and two spellings of the same name would be two
// graph nodes. Pure-String.
function collapseWhitespace(text: string): string {
  let out = ""
  let pendingSpace = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    const isWs = c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f"
    if (isWs) {
      if (out.length > 0) pendingSpace = true
      continue
    }
    if (pendingSpace) {
      out += " "
      pendingSpace = false
    }
    out += c
  }
  return out
}

// Universal reset selector: `*` or `*::before`/`*::after`/`*::selection`.
// Pure-String check (the M11 contract suppresses these as boilerplate).
function isResetSelector(text: string): boolean {
  if (text === "*") return true
  if (text.startsWith("*::")) {
    const rest = text.slice(3)
    if (rest.length === 0) return false
    for (let i = 0; i < rest.length; i++) {
      const c = rest[i]
      if (!((c >= "a" && c <= "z") || c === "-")) return false
    }
    return true
  }
  return false
}

// Class-name framework heuristics (pure-String; the old analyzer used regex).
function isTailwindClass(cls: string): boolean {
  if (cls.startsWith("tw-")) return true
  for (const p of ["sm:", "md:", "lg:", "xl:", "2xl:", "hover:", "focus:", "dark:"]) {
    if (cls.startsWith(p)) return true
  }
  return false
}

function isBootstrapClass(cls: string): boolean {
  if (cls === "container" || cls === "btn-primary" || cls === "navbar-expand") return true
  // col-(sm|md|lg|xl)-<digits>
  for (const size of ["sm-", "md-", "lg-", "xl-"]) {
    if (cls.startsWith(`col-${size}`)) {
      const rest = cls.slice(`col-${size}`.length)
      if (rest.length > 0) {
        let allDigits = true
        for (let i = 0; i < rest.length; i++) {
          const c = rest[i]
          if (!(c >= "0" && c <= "9")) { allDigits = false; break }
        }
        if (allDigits) return true
      }
    }
  }
  return false
}

function isBulmaClass(cls: string): boolean {
  for (const p of ["is-", "has-"]) {
    if (cls.startsWith(p)) {
      const rest = cls.slice(p.length)
      if (
        rest === "primary" || rest === "info" || rest === "success" ||
        rest === "warning" || rest === "danger" || rest === "text-centered"
      ) return true
    }
  }
  return false
}

function isFoundationClass(cls: string): boolean {
  if (cls === "foundation") return true
  for (const p of ["small-", "medium-", "large-"]) {
    if (cls.startsWith(p)) {
      const rest = cls.slice(p.length)
      if (rest.length === 0) return false
      let allDigits = true
      for (let i = 0; i < rest.length; i++) {
        const c = rest[i]
        if (!(c >= "0" && c <= "9")) { allDigits = false; break }
      }
      if (allDigits) return true
    }
  }
  return false
}

export class RealCssAnalyzer implements ASTEngine.LanguageAnalyzer {
  analyze(rootNode: Node, content: string, filePath: string): ASTEngine.ParseResult {
    // The importing stylesheet's own name, for `@import` edges. Pure-String, and
    // the LAST path segment: `a/b/theme.css` imports as `theme.css`, which is how
    // the module is written in the import itself and how the store spells a file.
    const segs = filePath.split(/[\\/]/)
    this.importerName = segs[segs.length - 1] || filePath || "stylesheet"

    const ctx: CssContext = {
      symbols: [],
      relationships: [],
      imports: [],
      exports: [],
      errors: [],
      content,
      keyframeNames: {},
      mixinNames: {},
      frameworks: {},
      patterns: {},
      fileHasParseError: rootNode.hasError === true,
      declaredProperties: {},
      mediaScopes: {},
      mediaScopeFirstRange: {},
      deferredChainEdges: [],
      selectorChains: {},
    }

    // D5 (2026-09-26). The keyframe-name set was filled DURING the walk, so an
    // `animation:` reference only resolved if the `@keyframes` block appeared
    // EARLIER IN THE FILE. Measured: `.x { animation: fade 1s }` followed by
    // `@keyframes fade { … }` emitted no reference edge at all, while the same
    // two blocks in the opposite order did. CSS has no such ordering rule — a
    // stylesheet is not order-dependent for name resolution, and in practice an
    // `@keyframes` is often shared from a block far below its first use.
    //
    // So the names are collected in a PRE-PASS over the tree, which makes the
    // walk order-independent by construction rather than by a heuristic.
    this.collectKeyframeNames(rootNode, ctx)

    const stack: StackFrame[] = [{ node: rootNode, media: "", layer: "", container: "", scope: "", currentSelector: "" }]

    while (stack.length > 0) {
      const { node, media, layer, container, scope, currentSelector } = stack.pop()!

      // Record every parse error the tree reports, and NEVER claim otherwise.
      //
      // A previous version of this block recorded the error and then walked
      // straight into the broken region, while its message claimed "The Brain
      // Engine is bypassing this broken node" — a `doc-channel` defect, the
      // message describing behaviour the code did not have.
      //
      // A second version made the message true by skipping the subtree of any
      // node that IS an error, and that was WORSE, not better. The pinned
      // grammar does not enumerate every `property_name` it will meet
      // (`text-align` is enough), so a real stylesheet shatters into THOUSANDS of
      // ERROR/MISSING nodes — grails-core's `docs-core/.../main.css` produces
      // 3,418 of them, and the first spans the ENTIRE 1,217-line file. Skipping
      // error subtrees deleted 883 of that file's 964 lost output lines, i.e. the
      // whole file, including the rules the grammar had read perfectly well.
      //
      // The suppression was also never necessary. Inside a real ERROR node the
      // children are tokens the switch does not match — for the
      // `startColorStr =` case an `identifier` and an `=` — so the walk emits
      // nothing from them regardless. What actually needed suppressing was two
      // shapes of RECOVERED rule, and those are suppressed where they are
      // recognised, by `isRecoveryDebris` and `isKeyframeStepSelector` below,
      // against a CSS invariant rather than against a node's error flag.
      if (this.isErrorNode(node)) {
        ctx.errors.push({
          message: `Syntax ERROR: the grammar could not read this token.`,
          range: this.nodeToRange(node),
          severity: `warning`,
        })
      } else if (node.hasError) {
        // Contains a broken descendant but is itself well-formed — the common
        // case, and the one that must keep its declarations.
        ctx.errors.push({
          message: `Syntax ERROR detected inside this rule; the rule itself is extracted.`,
          range: this.nodeToRange(node),
          severity: `warning`,
        })
      }

      let nextMedia = media
      let nextLayer = layer
      let nextContainer = container
      let nextScope = scope
      let nextSelector = currentSelector

      switch (node.type) {
        case "rule_set":
          nextSelector = this.processRuleSet(node, media, layer, container, scope, currentSelector, ctx) || nextSelector
          break
        case "import_statement":
          this.processImport(node, ctx)
          break
        case "media_statement": {
          const newMedia = this.processMedia(node, ctx)
          if (newMedia) {
            nextMedia = media ? `${media} and ${newMedia.replace("@media ", "")}` : newMedia
          }
          break
        }
        case "keyframes_statement":
          this.processKeyframes(node, ctx)
          break
        case "supports_statement":
          this.processSupports(node, ctx)
          break
        case "at_rule":
        case "postcss_statement":
        case "namespace_statement":
        case "scope_statement":
        case "charset_statement": {
          // M14 F1 debt repaid 2026-09-26. `include_statement` and
          // `mixin_statement` were registered dead literals: the pinned
          // tree-sitter-css wasm enumerates 151 node types and neither is among
          // them (measured, script/m14/tmp/css-grammar-repayment.ts). The CSS
          // grammar has no SCSS productions at all, so `@mixin card { }` and
          // `.a { @include card; }` arrive as `at_rule` with an `at_keyword`
          // child, and the `at_rule` case above already handles both — verified
          // live: the mixin symbol, the `@include` symbol and the
          // `uses .a -> "@mixin card"` edge all resolve. The two cases were
          // therefore REDUNDANT, not load-bearing, and deleting them is
          // behaviour-preserving (the corpus edge-set digest over 457 files is
          // byte-identical: script/m14/tmp/css-edge-digest.ts).
          const scopeUpdate = this.processAtRule(node, currentSelector, ctx)
          if (scopeUpdate.layer) nextLayer = scopeUpdate.layer
          if (scopeUpdate.container) nextContainer = scopeUpdate.container
          if (scopeUpdate.scope) nextScope = scopeUpdate.scope
          break
        }
        case "declaration": {
          // CSS custom properties are handled inside processDeclaration —
          // pushing them here too created duplicate --var symbols.
          this.processDeclaration(node, currentSelector, ctx)
          break
        }
        case "call_expression":
          this.processCallExpression(node, currentSelector, ctx)
          break
      }

      for (let i = node.namedChildCount - 1; i >= 0; i--) {
        const child = node.namedChild(i)
        if (child) {
          stack.push({
            node: child,
            media: nextMedia,
            layer: nextLayer,
            container: nextContainer,
            scope: nextScope,
            currentSelector: nextSelector,
          })
        }
      }
    }

    // The deferred selector-chain edges are resolved HERE, once every symbol the
    // analyzer will publish is known — which is the only point at which "does
    // this name name a node?" has an answer. An edge whose both ends resolve is
    // emitted; an edge whose end is a chain LEAF is not, because the leaf is a
    // component of a selector rather than a declared thing, and the composition
    // is already carried by the rule's name and by `selectorChain` metadata.
    //
    // Resolution uses the SAME rules parallel-indexer uses to bind a
    // relationship to a symbol at insert time, so "resolves" here means what it
    // means there — a name that would be stored as `target_external` is a name
    // that resolves to nothing.
    {
      const names = new Set<string>()
      for (const sym of ctx.symbols) {
        names.add(sym.name)
        if (sym.scope) names.add(`${sym.scope}.${sym.name}`)
      }
      const leafOf = (n: string): string => {
        const segs = n.replace(/:\d+$/, "").split(":").filter((x) => x.length > 0)
        const last = segs[segs.length - 1] ?? ""
        const dots = last.split(".")
        return dots[dots.length - 1]
      }
      const resolves = (n: string): boolean => {
        if (!n) return false
        if (names.has(n)) return true
        const l = leafOf(n)
        if (names.has(l)) return true
        for (const nm of names) {
          if (n.endsWith(`:${nm}`)) return true
          if (n.endsWith(`.${nm}`)) return true
        }
        return false
      }
      let emitted = 0
      let withheld = 0
      const seen = new Set<string>()
      for (const e of ctx.deferredChainEdges) {
        const key = `${e.from}\u001f${e.to}`
        if (seen.has(key)) continue
        seen.add(key)
        if (resolves(e.from) && resolves(e.to)) {
          emitted++
          ctx.relationships.push({
            source: e.from,
            target: e.to,
            type: ASTEngine.RelationshipType.Contains,
            metadata: { cssSpecific: true, isSelectorChain: true },
          })
        } else {
          withheld++
        }
      }
      ctx.chainEdgeTally = { emitted, withheld }
    }

    // The declared-property map is keyed by the CURRENT selector a declaration
    // was seen under, which for a nested rule is the RESOLVED selector text —
    // the same string the symbol is named. It is attached here, after the walk,
    // because a declaration can precede its rule's symbol in the walk order.
    //
    // A selector that resolved to several comma-separated names (`.a, .b { … }`)
    // has the property recorded under the joined text, so the lookup has to try
    // the joined name AND each comma part. The metadata is attached to every
    // symbol it can be attributed to, and omitted where it cannot — an honest
    // absence rather than a copy on the wrong node.
    const attachDeclared = (sym: { name: string; metadata?: Record<string, unknown> }): void => {
      const direct = ctx.declaredProperties[sym.name]
      const parts = sym.name.split(",").map((x) => x.trim()).filter(Boolean)
      const merged: string[] = []
      const push = (list: string[] | undefined): void => {
        if (!list) return
        for (const p of list) if (merged.indexOf(p) === -1) merged.push(p)
      }
      push(direct)
      for (const part of parts) push(ctx.declaredProperties[part])
      if (merged.length === 0) return
      if (!sym.metadata) sym.metadata = {}
      sym.metadata.declaresProperties = merged
      sym.metadata.declaredPropertyCount = merged.length
    }
    const attachChain = (sym: { name: string; metadata?: Record<string, unknown> }): void => {
      const direct = ctx.selectorChains[sym.name]
      const parts = sym.name.split(",").map((x) => x.trim()).filter(Boolean)
      const merged: string[] = []
      const push = (list: string[] | undefined): void => {
        if (!list) return
        for (const p of list) if (merged.indexOf(p) === -1) merged.push(p)
      }
      push(direct)
      for (const part of parts) push(ctx.selectorChains[part])
      if (merged.length < 2) return
      if (!sym.metadata) sym.metadata = {}
      sym.metadata.selectorChain = merged
    }
    for (const s2 of ctx.symbols) attachChain(s2)
    for (const s of ctx.symbols) attachDeclared(s)

    for (const s of ctx.symbols) { if (!s.scope || s.scope === "") { ctx.exports.push({ name: s.name, kind: s.kind, range: s.range, visibility: s.visibility || "public" }) } }
    this.detectFrameworksFromClasses(ctx)

    const frameworks: string[] = []
    for (const f in ctx.frameworks) frameworks.push(f)

    const patterns: string[] = []
    for (const p in ctx.patterns) patterns.push(p)

    const metrics = this.calculateMetrics(ctx)

    const frameworkPatterns: {
      framework: string
      patterns: { type: string; detected: boolean; description: string }[]
    }[] = []
    for (let i = 0; i < frameworks.length; i++) {
      frameworkPatterns.push({
        framework: frameworks[i],
        patterns: [{ type: "usage", detected: true, description: `${frameworks[i]} usage detected` }],
      })
    }

    return {
      language: "css",
      symbols: ctx.symbols,
      relationships: ctx.relationships,
      imports: ctx.imports,
      exports: ctx.exports,
      errors: ctx.errors,
      metadata: {
        complexity: ctx.symbols.length,
        linesOfCode: content.split("\n").length,
        cyclomaticComplexity: 1,
        framework: frameworks[0] || "Standard CSS",
        patterns,
        detectedFrameworks: frameworks,
        frameworkPatterns,
        architecturalInsights: this.generateInsights(ctx, frameworks),
        architecturalScore: metrics.score,
        codeQuality: metrics.quality,
        hasTypeInference: false,
        hasFrameworkIntelligence: true,
        maintainabilityScore: metrics.maintainability,
        performanceScore: metrics.performance,
        analysisVersion: "8.0.0-infallible-brain-math-strict",
      },
    }
  }

  /**
   * True when the node IS the parse failure, rather than merely containing one.
   *
   * `Node.hasError` is true for a node with a broken descendant too, so using it
   * as a suppression test would discard declarations that are perfectly well
   * formed. A MISSING node is a token the parser inserted where the source had
   * none, which is equally not a declaration.
   */
  private isErrorNode(node: Node): boolean {
    return node.type === "ERROR" || node.isMissing === true
  }

  /**
   * True when a `selectors` node can only be error-recovery debris.
   *
   * A stylesheet-level selector is never a bare string. The one way a `rule_set`
   * gets a `string_value` in selector position is the grammar abandoning a
   * construct's head (emitting an ERROR for it) and re-parsing the remainder as
   * a sibling rule — measured on `@keyframes "fade" { … }`, whose fabricated
   * output was three symbols whose names carried literal quote characters.
   *
   * The `selectors` node is examined for ANY real selector form; if it has one,
   * this is a genuine rule and nothing is suppressed. A genuine CSS selector can
   * contain a string only inside `[attr="value"]`, and there the string sits
   * under an `attribute_selector`, never as a selector of its own.
   */
  /**
   * The leading `@keyword` of an at-rule's own text, or `""`.
   *
   * Pure-String, bounded to the characters CSS actually allows in an at-keyword
   * (`@`, then letters/digits/`-`/`_`), so it cannot run past the keyword into a
   * prelude. Returns `""` when the text does not start with `@`, which is the
   * honest answer for a node that is not an at-rule at all.
   */
  private leadingAtKeyword(text: string): string {
    if (text.charAt(0) !== "@") return ""
    let i = 1
    while (i < text.length) {
      const c = text[i]
      const ok =
        (c >= "a" && c <= "z") ||
        (c >= "A" && c <= "Z") ||
        (c >= "0" && c <= "9") ||
        c === "-" ||
        c === "_"
      if (!ok) break
      i++
    }
    return i > 1 ? text.slice(0, i) : ""
  }

  /** First descendant satisfying `predicate`, breadth-first. */
  private findDescendant(node: Node, predicate: (n: Node) => boolean): Node | null {
    const queue: Node[] = [node]
    while (queue.length > 0) {
      const n = queue.shift() as Node
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (!c) continue
        if (predicate(c)) return c
        queue.push(c)
      }
    }
    return null
  }

  private isKeyframeStepSelector(selectorsNode: Node): boolean {
    const t = selectorsNode.text.trim()
    return t === "from" || t === "to"
  }

  private isRecoveryDebris(selectorsNode: Node): boolean {
    let hasString = false
    let hasRealSelector = false
    for (let i = 0; i < selectorsNode.namedChildCount; i++) {
      const c = selectorsNode.namedChild(i)
      if (!c) continue
      const t = c.type
      if (t === "string_value") { hasString = true; continue }
      if (
        t === "class_selector" ||
        t === "id_selector" ||
        t === "tag_name" ||
        t === "universal_selector" ||
        t === "pseudo_class_selector" ||
        t === "pseudo_element_selector" ||
        t === "attribute_selector" ||
        t === "nesting_selector" ||
        t === "namespace_selector" ||
        t === "child_selector" ||
        t === "descendant_selector" ||
        t === "sibling_selector" ||
        t === "adjacent_sibling_selector"
      ) {
        hasRealSelector = true
        continue
      }
      // A `class_name`/`id_name` leaf can only appear under its `*_selector`
      // wrapper, which is counted above; anything else is a combinator wrapper
      // already listed. Unlisted named types are treated as real, so a future
      // selector form cannot be silently suppressed by omission.
      hasRealSelector = true
    }
    return hasString && !hasRealSelector
  }

  /** The importing stylesheet's name; set per `analyze` run. */
  private importerName = "stylesheet"

  private determineSelectorKind(
    hasId: boolean,
    hasClass: boolean,
    hasTag: boolean,
    hasPseudoClass: boolean,
    hasPseudoElement: boolean,
    hasAttribute: boolean,
    isComplex: boolean,
  ): ASTEngine.SymbolKind {
    if (hasPseudoElement && !hasClass && !hasId && !hasTag) return ASTEngine.SymbolKind.Property
    if (hasPseudoClass && !hasClass && !hasId && !hasTag && !hasAttribute) return ASTEngine.SymbolKind.Property
    if (hasId && !hasClass && !hasTag && !hasPseudoClass && !hasPseudoElement && !hasAttribute)
      return ASTEngine.SymbolKind.Interface
    if (hasTag && !hasClass && !hasId && !hasPseudoClass && !hasPseudoElement && !hasAttribute)
      return ASTEngine.SymbolKind.Type
    if (hasAttribute && !hasClass && !hasId && !hasTag && !hasPseudoClass && !hasPseudoElement)
      return ASTEngine.SymbolKind.Property
    if (hasClass && !hasId && !hasTag && !hasPseudoClass && !hasPseudoElement && !hasAttribute && !isComplex)
      return ASTEngine.SymbolKind.Class
    return ASTEngine.SymbolKind.Class
  }

  private findChild(node: Node, predicate: (child: Node) => boolean): Node | null {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (child && predicate(child)) return child
    }
    return null
  }

  private filterChildren(node: Node, predicate: (child: Node) => boolean): Node[] {
    const res: Node[] = []
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (child && predicate(child)) res.push(child)
    }
    return res
  }

  private processRuleSet(
    node: Node,
    media: string,
    layer: string,
    container: string,
    scope: string,
    parentSelector: string,
    ctx: CssContext,
  ): string | null {
    const selectorsNode = this.findChild(node, (c) => c?.type === "selectors")
    if (!selectorsNode) return null

    // Recovery debris is not a rule. When the pinned grammar cannot read a
    // construct it emits an ERROR node for the construct's HEAD and re-parses
    // the remainder as a sibling of that ERROR — so the fabricated nodes are
    // perfectly well-formed and no subtree suppression can reach them. The
    // measured case is `@keyframes "fade" { from {…} to {…} }` (a quoted
    // keyframes name, which the grammar cannot represent):
    //
    //   stylesheet [hasError]
    //     ERROR      "@keyframes"          <- the head the grammar gave up on
    //     rule_set   "\"fade\" { from {…} to {…} }"   <- a SIBLING, not a child
    //       selectors -> string_value "\"fade\""
    //       block     -> rule_set "from {…}", rule_set "to {…}"
    //
    // which produced three symbols with quote characters baked into the name —
    // `class:"\"fade\""`, `type:"\"fade\" from"`, `type:"\"fade\" to"` — none of
    // which is a name written on a valid line of the file, plus a `contains`
    // edge between them. Two of the three were `from`/`to` KEYFRAME steps, which
    // the M12 ground truth explicitly declares to be structural noise and NOT
    // symbols, so this contradicted the lane's own declared contract.
    //
    // The discriminator is a CSS invariant, not a name shape: a stylesheet-level
    // selector is never a bare string. A `rule_set` whose `selectors` hold a
    // `string_value` and none of the real selector forms can only be debris.
    // (The grammar does admit `string_value` in its `_selector` choice, so this
    // cannot be read off the node types alone — it is a property of what a
    // selector may legally be.)
    if (this.isRecoveryDebris(selectorsNode)) {
      ctx.errors.push({
        message: `Syntax ERROR: this selector is not a valid CSS rule (the grammar could not read the construct it belongs to), so nothing is extracted from it.`,
        range: this.nodeToRange(node),
        severity: `warning`,
      })
      return null
    }

    // The same recovery also re-parses a keyframe's `from`/`to` STEPS as
    // top-level rules whose selector is the bare tag `from` / `to`. That is why
    // the quoted-keyframes probe still yielded two symbols after the debris rule
    // above: their selectors are `tag_name`, so they are well-formed rules by
    // that test. The observable signal is the ERROR SIBLING — the grammar gave
    // up on the construct's head in the same stylesheet.
    //
    // `from`/`to` are suppressed only in a stylesheet that HAS a parse error,
    // because that is the only situation in which the grammar can have produced
    // them this way. A real `from { }` element selector in a clean stylesheet is
    // still extracted. The cost of the rule is measured over the corpus rather
    // than assumed (see the edge-set digest).
    if (ctx.fileHasParseError && this.isKeyframeStepSelector(selectorsNode)) {
      ctx.errors.push({
        message: `Syntax ERROR: a keyframe step was re-parsed as a rule by error recovery, so it is not extracted as a selector.`,
        range: this.nodeToRange(node),
        severity: `warning`,
      })
      return null
    }

    const rawParts = selectorsNode.text.split(",")
    const rawSelectors: string[] = []
    for (let i = 0; i < rawParts.length; i++) {
      rawSelectors.push(rawParts[i].trim())
    }

    // Universal reset rules (*, *::before, *::after) are boilerplate that
    // carries no semantic symbol — suppress them to keep output clean.
    //
    // D8 (2026-09-26). The test was "is EVERY selector in the group a reset
    // selector", so a MIXED group survived whole: `*, .real { … }` produced one
    // symbol named `*, .real` — a fabricated identity that names the universal
    // reset AND a real class in one string, so neither the reset's suppression
    // nor `.real`'s own identity was expressed. The group is now SPLIT: the
    // reset selectors are dropped and the real ones are kept under their own
    // names, which is what a comma group means.
    const keptSelectors: string[] = []
    for (let i = 0; i < rawSelectors.length; i++) {
      if (!isResetSelector(rawSelectors[i])) keptSelectors.push(rawSelectors[i])
    }
    if (keptSelectors.length === 0) return null
    if (keptSelectors.length !== rawSelectors.length) {
      rawSelectors.length = 0
      for (let i = 0; i < keptSelectors.length; i++) rawSelectors.push(keptSelectors[i])
    }

    let parentSelectors: string[] = [""]
    if (parentSelector) {
      const pParts = parentSelector.split(",")
      parentSelectors = []
      for (let i = 0; i < pParts.length; i++) {
        parentSelectors.push(pParts[i].trim())
      }
    }

    const resolvedSelectors: string[] = []
    for (let i = 0; i < parentSelectors.length; i++) {
      const p = parentSelectors[i]
      for (let j = 0; j < rawSelectors.length; j++) {
        const r = rawSelectors[j]
        if (p) {
          if (r.indexOf("&") !== -1) {
            resolvedSelectors.push(replaceAll(r, "&", p))
          } else {
            resolvedSelectors.push(`${p} ${r}`)
          }
        } else {
          resolvedSelectors.push(r)
        }
      }
    }
    const selectorText = resolvedSelectors.join(", ")

    let isComplex = false
    let hasPseudoClass = false
    let hasPseudoElement = false
    let isUtility = true
    let isCssModule = false
    const classNames: string[] = []
    let hasIdSelector = false
    let hasTagSelector = false
    let hasAttributeSelector = false

    let maxSpecificity = [0, 0, 0]

    const selectorNodes = selectorsNode.namedChildren
    for (let j = 0; j < selectorNodes.length; j++) {
      const selNode = selectorNodes[j]
      let specId = 0
      let specClass = 0
      let specTag = 0

      const chain: string[] = []

      const selStack = [selNode]
      while (selStack.length > 0) {
        const n = selStack.pop()!

        if (
          n.type === "child_selector" ||
          n.type === "sibling_selector" ||
          n.type === "adjacent_sibling_selector" ||
          n.type === "descendant_selector"
        ) {
          isComplex = true
          isUtility = false
        }
        if (n.type === "pseudo_class_selector") {
          hasPseudoClass = true
          specClass += 1
          isUtility = false
        }
        if (n.type === "pseudo_element_selector") {
          hasPseudoElement = true
          specTag += 1
          isUtility = false
        }
        if (n.type === "attribute_selector") {
          hasAttributeSelector = true
          specClass += 1
          isUtility = false
          // D7 (2026-09-26). Every other chain form pushes itself — id, tag,
          // class, universal — and the attribute form did not, so `.a [href]`
          // emitted NO chain edge while `.a .b`, `.a #b` and `.a *` all did. The
          // omission was silent: the selector symbol and its `uses` edges were
          // unaffected, so only the chain edge was missing, and only for
          // attribute selectors. The attribute NAME is pushed rather than the
          // full `[href^=x]` text, because the name is the part that identifies
          // the step — the same reason `class_name` is pushed as `.name`.
          const attrName = this.findChild(n, (c) => c?.type === "attribute_name")
          chain.push(attrName ? attrName.text : n.text)
        }
        if (n.type === "id_selector") {
          hasIdSelector = true
          specId += 1
          isUtility = false
          chain.push(n.text)
        }
        if (n.type === "tag_name") {
          hasTagSelector = true
          specTag += 1
          if (n.text !== "*") isUtility = false
          chain.push(n.text)
        }
        if (n.type === "class_name") {
          specClass += 1
          classNames.push(n.text)
          // Chain identities must match symbol names: class_name nodes carry
          // the bare identifier (`card`) but the selector symbol is named
          // with its `.` prefix (`.card`). Emit the prefixed form so the
          // contains edge source/target resolve to real symbols.
          chain.push(`.${n.text}`)
        }
        if (n.type === "universal_selector") {
          specTag += 1
          chain.push(n.text)
        }

        if (n.text.indexOf(":local") !== -1 || n.text.indexOf(":global") !== -1) {
          isCssModule = true
        }

        for (let i = n.namedChildCount - 1; i >= 0; i--) {
          const child = n.namedChild(i)
          if (child) selStack.push(child)
        }
      }

      if (specId > maxSpecificity[0]) maxSpecificity = [specId, specClass, specTag]
      else if (specId === maxSpecificity[0] && specClass > maxSpecificity[1])
        maxSpecificity = [specId, specClass, specTag]
      else if (specId === maxSpecificity[0] && specClass === maxSpecificity[1] && specTag > maxSpecificity[2])
        maxSpecificity = [specId, specClass, specTag]

      if (isComplex && chain.length >= 2) {
        // RULING (2026-09-26). A selector chain is DEFERRED, not emitted blind.
        //
        // `contains .nav -> a` for `.nav a` asserts containment between two
        // things the analyzer does not publish: the rule is ONE symbol named
        // `.nav a`, and neither `.nav` nor `a` is a symbol unless it happens to
        // be its own rule elsewhere in the file. Measured over 3 corpora: 14,188
        // chain edges, of which 2,664 (18.8%) resolve at both ends — and those
        // resolve only ACCIDENTALLY, when a chain leaf is also a whole selector
        // somewhere else. The shapes that do not resolve are the common ones:
        // `.nav -> a` 468, `.where -> .svelte-xyz` 432, `a -> .hover` 398,
        // `ul -> li` 229.
        //
        // No respelling can fix this: the edge names two things that are not
        // nodes. Publishing them would create a symbol per element-type
        // occurrence per selector, none of which is a declaration. So the chain
        // is what it is — a COMPOSITION of the rule's selector — and it rides the
        // rule's payload as `selectorChain`, while the `contains` edges are
        // emitted only for the chains where both leaves ARE published symbols.
        // The composition is not lost by ceasing to be a fabricated edge: the
        // rule's own NAME is the resolved chain.
        for (let i = 0; i < chain.length - 1; i++) {
          ctx.deferredChainEdges.push({ from: chain[i], to: chain[i + 1], rule: rawSelectors.join(", ") })
        }
        for (let i = 0; i < chain.length; i++) {
          if (chain[i].length === 0) continue
          ctx.selectorChains[rawSelectors.join(", ")] = ctx.selectorChains[rawSelectors.join(", ")] ?? []
          const list = ctx.selectorChains[rawSelectors.join(", ")]
          if (list.indexOf(chain[i]) === -1) list.push(chain[i])
        }
      }
    }

    if (classNames.length !== 1 || isComplex || hasPseudoClass || hasPseudoElement || parentSelector) {
      isUtility = false
    }

    const selectorKind = this.determineSelectorKind(
      hasIdSelector,
      classNames.length > 0,
      hasTagSelector,
      hasPseudoClass,
      hasPseudoElement,
      hasAttributeSelector,
      isComplex,
    )

    // D4 (2026-09-26). A nested rule whose resolved selector is IDENTICAL to its
    // parent is not a new selector. The case is a bare `&`:
    // `.a { & { color: red } }` — a real CSS construct that adds declarations to
    // the parent's own context. Resolving `&` to `.a` and then emitting a symbol
    // for it produced TWO symbols both named `.a`, one scoped `.a` inside the
    // other, which is a duplicate identity: the store keys on name, so one of
    // them is unreachable and the `contains .a -> .a` self-edge is a
    // relationship between a thing and itself.
    //
    // The declarations are already attributed to the same `currentSelector` by
    // the walk, so nothing is lost by not emitting a second symbol — the rule
    // still contributes its `uses` edges. The return value is the parent's own
    // name, so any further nesting resolves against it unchanged.
    if (parentSelector && selectorText === parentSelector) {
      return null
    }

    ctx.symbols.push({
      name: selectorText,
      kind: selectorKind,
      range: this.nodeToRange(node),
      scope: parentSelector,
      visibility: "public",
      metadata: {
        isSelector: true,
        isUtility,
        isComplex,
        hasPseudoClass,
        hasPseudoElement,
        isCssModule,
        classNames,
        specificity: maxSpecificity,
        cssSpecific: true,
        selectorComposition: {
          hasId: hasIdSelector,
          hasClass: classNames.length > 0,
          hasTag: hasTagSelector,
          hasPseudoClass,
          hasPseudoElement,
          hasAttribute: hasAttributeSelector,
        },
      },
    })

    if (isComplex) ctx.patterns["Complex Selectors"] = true
    if (isUtility) ctx.patterns["Utility-First Classes"] = true
    if (hasPseudoClass) ctx.patterns["Pseudo-classes"] = true
    if (hasPseudoElement) ctx.patterns["Pseudo-elements"] = true
    if (isCssModule) {
      ctx.patterns["CSS Modules (:local/:global)"] = true
      ctx.frameworks["CSS Modules"] = true
    }

    if (media) {
      ctx.relationships.push({
        source: media,
        target: selectorText,
        type: ASTEngine.RelationshipType.Contains,
        metadata: { cssSpecific: true, isMediaScope: true },
      })
    }
    if (layer) {
      ctx.relationships.push({
        source: layer,
        target: selectorText,
        type: ASTEngine.RelationshipType.Contains,
        metadata: { cssSpecific: true, isLayerScope: true },
      })
    }
    if (container) {
      ctx.relationships.push({
        source: container,
        target: selectorText,
        type: ASTEngine.RelationshipType.Contains,
        metadata: { cssSpecific: true, isContainerScope: true },
      })
    }
    if (scope) {
      ctx.relationships.push({
        source: scope,
        target: selectorText,
        type: ASTEngine.RelationshipType.Contains,
        metadata: { cssSpecific: true, isScopeScope: true },
      })
    }
    if (parentSelector) {
      ctx.relationships.push({
        source: parentSelector,
        target: selectorText,
        type: ASTEngine.RelationshipType.Contains,
        metadata: { cssSpecific: true, isNestedSelector: true },
      })
    }

    return selectorText
  }

  private processImport(node: Node, ctx: CssContext) {
    const stringNode = this.findChild(node, (c) => c?.type === "string_value" || c?.type === "call_expression")
    if (stringNode) {
      const moduleName = unwrapUrl(stringNode.text)
      ctx.imports.push({
        module: moduleName,
        source: moduleName,
        imported: ["*"],
        isTypeOnly: false,
        range: this.nodeToRange(node),
      })
      // `@import` is the one CSS edge that is genuinely an IMPORT, and the
      // ontology has a type for it. It was emitted as `references` from the
      // literal string `"global"` — a magic source that names no symbol in any
      // stylesheet (M60 R7: no placeholder literals in name-bearing fields), so
      // every import edge in the corpus was unjoinable at BOTH ends.
      //
      // The source is now the importing stylesheet's own name, which is what an
      // import is FROM. The store records an edge whose source is not a symbol in
      // the file as `source_external` — the same handling every other language's
      // top-level cross-file import gets — so the edge is honest rather than
      // dangling by construction.
      ctx.relationships.push({
        source: this.importerName,
        target: moduleName,
        type: ASTEngine.RelationshipType.Imports,
        confidence: 1.0,
        metadata: { isCssImport: true, importSource: this.importerName },
      })
      if (moduleName.indexOf("tailwind") !== -1) ctx.frameworks["Tailwind CSS"] = true
      if (moduleName.indexOf("bootstrap") !== -1) ctx.frameworks["Bootstrap"] = true
      if (moduleName.indexOf("bulma") !== -1) ctx.frameworks["Bulma"] = true
      if (moduleName.indexOf("foundation") !== -1) ctx.frameworks["Foundation"] = true
    }
  }

  private processMedia(node: Node, ctx: CssContext): string | null {
    // M14 F1 debt repaid 2026-09-26, and it carried a real defect with it.
    //
    // The union used to read `{media_query_list, keyword_query, binary_query,
    // feature_query, parenthesized_query}`. `media_query_list` is NOT a node
    // type the pinned grammar has (it was a registered dead literal), and the
    // two types the grammar DOES use for a media query's outermost form were
    // missing from the list. Measured against the pinned wasm:
    //
    //   @media (max-width: 700px)   -> feature_query         worked before
    //   @media print                -> keyword_query         worked before
    //   @media (400px <= width <= 700px) -> binary_query     GRAMMAR ERROR (not this union's problem)
    //   @media not print            -> unary_query           SILENTLY SCOPE-LOST before
    //   @media selector(.a)         -> selector_query        SILENTLY SCOPE-LOST before
    //
    // A lost scope is not a cosmetic miss: the `contains` edge from the media
    // scope to the rule inside it was never emitted, AND the
    // `Responsive Design (Media Queries)` pattern was never set, so the file's
    // own reporting changed. Adding the two live names and dropping the dead one
    // is what makes `@media not …` and `@media selector(…)` scope at all.
    const queryNode = this.findChild(
      node,
      (c) =>
        c &&
        (c.type === "keyword_query" ||
          c.type === "binary_query" ||
          c.type === "feature_query" ||
          c.type === "parenthesized_query" ||
          c.type === "unary_query" ||
          c.type === "selector_query"),
    )
    if (queryNode) {
      const mediaName = `@media ${collapseWhitespace(queryNode.text)}`
      ctx.patterns["Responsive Design (Media Queries)"] = true
      // RULING (2026-09-26). The comment this replaces read "a media query is a
      // structural scope, not a symbol — it is NOT emitted as a standalone
      // symbol", and that decision is what made 5,115 relationships carry a
      // source that exists nowhere in the graph: `@media (max-width: 768px)`
      // scoped its rules through a NAME with no symbol behind it, so every
      // media containment edge was unjoinable at query.
      //
      // It was also inconsistent with the lane's own treatment of the identical
      // construct: `@layer base` and `@container (min-width: 400px)` are both
      // structural scopes and both ARE emitted as `module` symbols with
      // containment edges. A media query is the same kind of thing and is now
      // treated the same way.
      //
      // Deduplicated by name: the same condition appearing twice in a file is the
      // SAME scope, and emitting two symbols with one name would be the identity
      // collision this wave exists to remove (the defect that gave every
      // `@container` the bare name `@container`).
      if (!ctx.mediaScopes[mediaName]) {
        ctx.mediaScopes[mediaName] = true
        ctx.symbols.push({
          name: mediaName,
          kind: ASTEngine.SymbolKind.Module,
          range: this.nodeToRange(node),
          scope: "",
          visibility: "public",
          metadata: { isMediaScope: true, mediaCondition: collapseWhitespace(queryNode.text) },
        })
        ctx.mediaScopeFirstRange[mediaName] = this.nodeToRange(node)
      }
      return mediaName
    }
    return null
  }

  /**
   * Every `@keyframes` name in the file, collected before the main walk so that
   * an `animation:` reference resolves regardless of where the block sits.
   */
  private collectKeyframeNames(root: Node, ctx: CssContext): void {
    const stack: Node[] = [root]
    while (stack.length > 0) {
      const n = stack.pop() as Node
      if (this.isErrorNode(n)) continue
      if (n.type === "keyframes_statement") {
        const nameNode = this.findChild(
          n,
          (c) => c && (c.type === "keyframes_name" || c.type === "identifier" || c.type === "string_value"),
        )
        if (nameNode) ctx.keyframeNames[stripAllQuotes(nameNode.text)] = true
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const c = n.namedChild(i)
        if (c) stack.push(c)
      }
    }
  }

  private processKeyframes(node: Node, ctx: CssContext) {
    const nameNode = this.findChild(
      node,
      (c) => c && (c.type === "keyframes_name" || c.type === "identifier" || c.type === "string_value"),
    )
    if (nameNode) {
      const name = stripAllQuotes(nameNode.text)
      ctx.symbols.push({
        name: name,
        kind: ASTEngine.SymbolKind.Function,
        range: this.nodeToRange(node),
        scope: "",
        visibility: "public",
        metadata: { isKeyframes: true },
      })
      ctx.keyframeNames[name] = true
      ctx.patterns["CSS Animations"] = true
    }
  }

  private processSupports(node: Node, ctx: CssContext) {
    // The predicate used to be `c.type !== "at_keyword" && c.type !== "block"`,
    // on the belief that `supports_statement` carries an `at_keyword` child. It
    // does NOT: the pinned grammar's shape is
    //
    //   supports_statement
    //     ├── "@supports"   (ANONYMOUS — not an at_keyword node)
    //     ├── feature_query / parenthesized_query / …
    //     └── block
    //
    // so the exclusion list never matched the keyword and the predicate selected
    // the ANONYMOUS `"@supports"` token. Every `@supports` in every stylesheet in
    // the world was therefore named `@supports @supports` — 157 identical
    // `interface` symbols in a 148-file sample — and the query CONDITION, which is
    // the entire semantic content, was never read at all. That is a
    // placeholder-literal name (M60 R7) and an identity collision both.
    //
    // The condition is now taken from the query node itself, and the name carries
    // it, so two different `@supports` blocks in one file are two different
    // symbols.
    const queryNode = this.findChild(
      node,
      (c) =>
        c &&
        c.type !== "block" &&
        c.type !== "at_keyword" &&
        c.type !== "@supports" &&
        c.text.trim() !== "@supports",
    )
    if (queryNode) {
      const condition = queryNode.text.trim()
      ctx.symbols.push({
        name: `@supports ${condition}`,
        kind: ASTEngine.SymbolKind.Interface,
        range: this.nodeToRange(node),
        scope: "",
        visibility: "public",
        metadata: { isSupports: true, supportsCondition: condition },
      })
      ctx.patterns["Feature Queries (@supports)"] = true
    }
  }

  private processAtRule(node: Node, currentSelector: string, ctx: CssContext): { layer?: string; container?: string; scope?: string } {
    const atKeywordNode = this.findChild(node, (c) => c?.type === "at_keyword")

    // M14 F1 debt repaid 2026-09-26. The two `node.type === "mixin_statement"`
    // / `"include_statement"` overrides that used to sit here were DEAD: neither
    // type is enumerated by the pinned wasm, and an SCSS `@mixin` reaches this
    // function as an `at_rule` whose `at_keyword` child already reads `@mixin`
    // (and `@include` likewise). The keyword is therefore taken from the tree and
    // never from the node type — which is also the only spelling that can be
    // right, since a node type is not a keyword.
    // The keyword is read from the `at_keyword` child when there is one, and
    // from the node's OWN leading token when there is not — because the grammar
    // does not use an `at_keyword` node everywhere. Measured on the pinned wasm:
    // `at_rule` (`@layer`, `@container`, `@font-face`, `@apply`, …) has one, and
    // `namespace_statement`, `scope_statement` and `supports_statement` carry an
    // ANONYMOUS `@namespace` / `@scope` / `@supports` token instead. Reading only
    // the child silently dropped all three, which is the same root cause that
    // named every `@supports` "@supports @supports".
    let keyword = atKeywordNode ? atKeywordNode.text : ""
    if (!keyword) keyword = this.leadingAtKeyword(node.text)

    if (!keyword) return {}

    let namePart = ""

    // D6 (2026-09-26). Four at-rules that NAME something were producing nothing
    // at all, because the whitelist below did not mention them:
    //
    //   @font-face   names a font family and its sources. A stylesheet's declared
    //                font faces are part of its public surface and were invisible.
    //   @property    REGISTERS a custom property, with `syntax`, `inherits` and
    //                `initial-value` descriptors. It is a declaration site, and
    //                the descriptors are exactly the kind of fact a graph carries.
    //   @namespace   maps a prefix to a URL — a reference, dropped entirely.
    //   @scope       a scoping construct with no case at all, and unlike @media
    //                it has no fallback path, so rules inside it were attributed
    //                to the wrong scope.
    //
    // `@page`, `@starting-style` and `@position-try` are deliberately NOT added:
    // they scope nothing that a `contains` edge can name (a page box, a
    // transition entry condition, a fallback position), so a symbol for them
    // would be a name with no referent. They are recorded as silent in
    // script/m14/spec/css-completeness.json with that reason.
    // D10 (2026-09-26). The whitelist below conflated two different things: an
    // at-rule that DECLARES a named entity, and an at-rule CONSUMED BY A BUILD
    // TOOL. Measured, the second kind was 71 fabricated `module` symbols in a
    // 148-file sample — `@apply flex` became a symbol named after a Tailwind
    // utility, `@theme` a symbol named after its own keyword, `@config` likewise.
    // None of them declares anything: they are instructions to a compiler, and a
    // symbol with no declaration behind it is a name with no referent.
    //
    // DECLARING (published as symbols):
    //   @layer      a named cascade layer
    //   @container  a named container-query scope
    //   @scope      a DOM-scoping prelude
    //   @font-face  a font family           (D6)
    //   @property   a custom-property registration (D6)
    //   @namespace  a prefix -> URL mapping (D6)
    //   @mixin      an SCSS mixin
    // CONSUMING (no symbol; recorded as a pattern, or as an import):
    //   @tailwind   a Tailwind directive
    //   @apply      applies utilities; the utilities are named in its prelude and
    //               are not entities this stylesheet defines
    //   @theme      a Tailwind theme BLOCK — the custom properties inside it are
    //               already emitted as variable symbols in their own right
    //   @config     a Tailwind config path
    //   @include    USES a mixin; the fact is the `uses` edge below, not a symbol
    //   @use/@forward  Sass module imports, emitted as `imports` like @import
    const DECLARING = new Set([
      "@layer", "@container", "@scope", "@font-face", "@property", "@namespace", "@mixin",
    ])
    const CONSUMING = new Set(["@tailwind", "@apply", "@theme", "@config", "@include", "@use", "@forward"])

    if (DECLARING.has(keyword) || CONSUMING.has(keyword)) {
      // Set for `@font-face`, whose prelude is empty and whose declared name
      // lives in its block; declared first so its use below is in scope.
      let namePartOverride = ""

      // The name is the keyword plus the at-rule's OWN PRELUDE — the source text
      // between the keyword and the at-rule's block or terminating `;`.
      //
      // This replaces a list of child node types (`identifier`, `string_value`,
      // `call_expression`, `keyword_query`) which was a type-list that had to be
      // maintained against the grammar by hand, and which was WRONG for the one
      // at-rule whose condition is its whole meaning: a container query's
      // condition is a `feature_query`, which was not in the list, so
      // `@container (min-width: 400px)` produced the bare name `@container` — the
      // condition discarded — and two `@container` blocks in one file produced two
      // IDENTICALLY named symbols, with both blocks' `contains` edges pointing at
      // the same string. `@container style(--x: 1)` was worse still: it took the
      // bare keyword `style` as the name.
      //
      // The bound is the at-rule production itself — `at-keyword prelude? (block
      // | ';')` — so the prelude ends at the first `{` or `;`, whichever comes
      // first. An earlier attempt bounded it by the `block` CHILD's start index
      // and overran whenever the block was not a direct child (error recovery
      // nests it), swallowing the block into the name:
      //   `@container (min-width: 900px) { .b { color: blue; } }`
      // and leaving a trailing `;` on the statement forms (`@include card;`).
      // Slicing the node's own text cannot fall behind a grammar change, because
      // it never names a node type. Whitespace is collapsed so a multi-line
      // prelude still yields a single-line, stable symbol name (M60 R10 — a target
      // must be spelled the way the lane spells its own symbols, and that
      // spelling has to be deterministic).
      // `@font-face` has an EMPTY prelude — the thing it declares is inside its
      // block — so a keyword-plus-prelude name would be the bare placeholder
      // `@font-face`, which is a name with no referent and one per stylesheet
      // (M60 R7). The name is the family it declares, read from the block's own
      // `font-family` declaration.
      if (keyword === "@font-face") {
        // The declaration lives inside the `block` child, so this is a DESCENDANT
        // search — a direct-child search finds nothing, which is why the first
        // attempt left the name as the bare `@font-face`.
        const block = this.findChild(node, (c) => c?.type === "block")
        const family = block ? this.findDescendant(block, (n) => {
          if (n.type !== "declaration") return false
          const prop = this.findChild(n, (g) => g?.type === "property_name")
          return prop !== null && prop.text === "font-family"
        }) : null
        if (family) {
          const value = this.findChild(family, (c) => c?.type === "plain_value" || c?.type === "string_value")
          if (value) namePartOverride = collapseWhitespace(stripAllQuotes(value.text))
        }
      }

      const afterKeyword = node.text.slice(keyword.length)
      const braceAt = afterKeyword.indexOf("{")
      const semiAt = afterKeyword.indexOf(";")
      let cut = afterKeyword.length
      if (braceAt !== -1) cut = braceAt
      if (semiAt !== -1 && semiAt < cut) cut = semiAt
      const namePart = namePartOverride || stripAllQuotes(collapseWhitespace(afterKeyword.slice(0, cut)))
      const ruleName = `${keyword}${namePart ? " " + namePart : ""}`

      // A CONSUMING at-rule gets NO symbol. `@apply flex` is an instruction to a
      // Tailwind build, not a declaration; `@theme` is a block whose custom
      // properties are already published in their own right; `@config` names a
      // file; `@include` is a USE, and the `uses` edge below is the fact.
      if (DECLARING.has(keyword)) {
        ctx.symbols.push({
          name: ruleName,
          // A declared `@font-face` and a registered `@property` are both
          // declarations of a named thing, which is what `variable` means in this
          // ontology; `@mixin` is a callable, so `function`; the rest are
          // structural scopes, which is `module`.
          kind:
            keyword === "@mixin"
              ? ASTEngine.SymbolKind.Function
              : keyword === "@font-face" || keyword === "@property"
                ? ASTEngine.SymbolKind.Variable
                : ASTEngine.SymbolKind.Module,
          range: this.nodeToRange(node),
          scope: "",
          visibility: "public",
          metadata: { isAtRule: true, atKeyword: keyword },
        })
      }

      if (keyword === "@layer") ctx.patterns["Cascade Layers (@layer)"] = true
      if (keyword === "@container") ctx.patterns["Container Queries (@container)"] = true
      if (keyword === "@tailwind" || keyword === "@apply" || keyword === "@theme" || keyword === "@config")
        ctx.frameworks["Tailwind CSS"] = true
      if (keyword === "@mixin" || keyword === "@include" || keyword === "@forward" || keyword === "@use") {
        ctx.frameworks["SCSS/SASS"] = true
        ctx.patterns["CSS Preprocessor Macros"] = true
      }

      if (keyword === "@mixin" && namePart) ctx.mixinNames[namePart] = true

      if (keyword === "@include" && currentSelector && namePart) {
        // The mixin reference resolves to the `@mixin` symbol when the mixin is
        // declared in this file. It is emitted unconditionally rather than
        // gated on `mixinNames`, because an `@include` of a mixin declared
        // elsewhere is a real reference to something this file does not define —
        // the same honest external reference a `var(--x)` to another
        // stylesheet's custom property is.
        ctx.relationships.push({
          source: currentSelector,
          target: `@mixin ${namePart}`,
          type: ASTEngine.RelationshipType.Uses,
          metadata: { cssSpecific: true, isMixinRef: true, isDeclaredLocally: ctx.mixinNames[namePart] === true },
        })
      }

      if ((keyword === "@use" || keyword === "@forward") && namePart) {
        // A Sass module import, which is what `@import` is for CSS: a
        // compile-time dependency on another file.
        ctx.relationships.push({
          source: this.importerName,
          target: stripAllQuotes(namePart.split(/\s+/)[0] ?? namePart),
          type: ASTEngine.RelationshipType.Imports,
          confidence: 1.0,
          metadata: { isCssImport: true, isSassModuleImport: true, importSource: this.importerName },
        })
      }

      return {
        layer: keyword === "@layer" ? ruleName : undefined,
        container: keyword === "@container" ? ruleName : undefined,
        // A `@scope` prelude is a SELECTOR (`(.a) to (.b)`), not a condition, so
        // it cannot reuse the media field's name. It is reported as its own
        // scope so a rule inside it is attributable to the scope that contains
        // it, which is the whole point of the construct.
        scope: keyword === "@scope" ? ruleName : undefined,
      }
    }
    return {}
  }

  /**
   * Every property a selector declares, recorded on the SELECTOR SYMBOL rather
   * than emitted as a relationship to the property name.
   *
   * RULING (2026-09-26, measured — script/m14/tmp/css-ontology-census.ts, 457
   * files / 13 corpora). This used to emit `uses <selector> -> <property>` for
   * every declaration, and the class table says what that cost:
   *
   *   uses   34,727 edges   2,073 resolve at both ends    6.0%
   *          of which 32,654 have a RESOLVABLE SOURCE and an unresolvable target,
   *          and 0 have an unresolvable source
   *
   * The class is homogeneous: the source is always a selector (always a
   * published symbol) and the target is always a CSS property name — `color`,
   * `margin`, `font-family` — which the analyzer never publishes as a symbol and
   * never will, because a property name is a token in a declaration, not an
   * entity a stylesheet defines. So 32,654 of 59,940 relationships (54%) were
   * edges to a name that exists nowhere in the graph: stored as
   * `target_external`, unjoinable at query, and then discarded outright by
   * pool-worker's CSS branch of `filterNoiseRelationships`, which keeps
   * `contains` only. The information was paid for twice and delivered neither
   * time.
   *
   * A relationship is a claim about two graph nodes. `declaresProperties` is the
   * right shape for "this rule sets these properties" — it rides the symbol
   * payload, which M60 P1 treats as a first-class channel (produced by the
   * analyzer, preserved by the store, reachable at query, truthful at the tool).
   *
   * The relationships that DO survive in this handler are the ones whose target
   * is a real node: a custom property, a `@keyframes` name, a `@mixin`. Those
   * are untouched.
   */
  private recordDeclaredProperty(currentSelector: string, property: string, ctx: CssContext): void {
    if (!currentSelector) return
    ctx.declaredProperties[currentSelector] = ctx.declaredProperties[currentSelector] ?? []
    const list = ctx.declaredProperties[currentSelector]
    if (list.indexOf(property) === -1) list.push(property)
  }

  private processDeclaration(node: Node, currentSelector: string, ctx: CssContext) {
    // Positional lookup only: the pinned tree-sitter-css wasm exposes
    // fieldCount=0 (probe: childForFieldName("property") is UNDEFINED on
    // `color: red`), so a field call here would be provably dead code. F1's
    // field audit now fails on any field literal a grammar cannot resolve.
    const declPropNode = this.findChild(node, (c: Node) => c.type === "property_name")
    if (declPropNode) this.recordDeclaredProperty(currentSelector, declPropNode.text, ctx)
    // M14 F1 debt repaid 2026-09-26. `variable_name` was a registered dead
    // literal: the pinned grammar enumerates 151 node types and has no such
    // node. The disjunct is dropped rather than left where it can never match.
    const propNode = this.findChild(node, (c) => c?.type === "property_name")
    if (!propNode) return

    const propName = propNode.text

    if (propName === "composes") {
      ctx.patterns["CSS Modules (composes)"] = true
      ctx.frameworks["CSS Modules"] = true
      // D9 (2026-09-26). The value collection took every child that is not
      // `property_name` and not `:`, which INCLUDED the anonymous `;` — so
      // `.a { composes: b; }` emitted `uses .a -> "b"` and `uses .a -> ";"`. A
      // semicolon is punctuation, not a name, and it was a fabricated edge in
      // every CSS-Modules stylesheet in the corpus. The filter is now NAMED
      // children only, which is what a value is.
      for (let i = 0; i < node.namedChildCount; i++) {
        const val = node.namedChild(i)
        if (!val || val.type === "property_name") continue
        const target = collapseWhitespace(val.text)
        if (!target) continue
        ctx.relationships.push({
          source: currentSelector,
          target,
          type: ASTEngine.RelationshipType.Uses,
          metadata: { cssSpecific: true, isComposition: true },
        })
      }
    }

    // M14 F1 debt repaid 2026-09-26. The `$` (SCSS) and `@` (LESS) prefixes
    // were DEAD VALUE-POSITION branches — a class the F1 type-literal audit
    // cannot see, which is why they survived the register. Measured against the
    // pinned wasm: `$primary: #fff` and `@primary: #fff` each produce ERROR
    // nodes and ZERO `property_name` nodes, at top level and inside a rule, in
    // both declaration and value position. So no text beginning `$` or `@` can
    // ever reach this predicate, and the two framework signals it set were
    // unreachable: `SCSS/SASS` is in fact detected — but from the `at_rule`
    // path (`@mixin`/`@include`/`@use`/`@forward`), and LESS was never detected
    // by anything. Only `--` is reachable, so only `--` is tested.
    if (propName.startsWith("--")) {
      ctx.symbols.push({
        name: propName,
        kind: ASTEngine.SymbolKind.Variable,
        range: this.nodeToRange(node),
        scope: currentSelector,
        visibility: "public",
        metadata: { isCustomProperty: true },
      })
      // contains for the custom property scoped to its selector — emitted
      // here (not by the post-loop) to avoid double-emission with nested
      // selector contains.
      if (currentSelector) {
        ctx.relationships.push({
          source: currentSelector,
          target: propName,
          type: ASTEngine.RelationshipType.Contains,
          confidence: 1.0,
          metadata: { cssSpecific: true, isCustomPropertyScope: true },
        })
      }
      // Reached only by `--`, so the pattern test needs no prefix guard.
      ctx.patterns["CSS Custom Properties"] = true
    }

    if ((propName === "animation" || propName === "animation-name") && currentSelector) {
      const valStack = [node]
      while (valStack.length > 0) {
        const n = valStack.pop()!
        if (n.type === "plain_value" || n.type === "identifier" || n.type === "string_value") {
          const text = stripAllQuotes(n.text.trim())
          if (ctx.keyframeNames[text]) {
            ctx.relationships.push({
              source: currentSelector,
              target: text,
              type: ASTEngine.RelationshipType.Uses,
              metadata: { cssSpecific: true, isAnimationRef: true },
            })
          }
        }
        for (let i = n.namedChildCount - 1; i >= 0; i--) {
          const child = n.namedChild(i)
          if (child) valStack.push(child)
        }
      }
    }

    if (node.text.indexOf("!important") !== -1) {
      ctx.patterns["Uses !important"] = true
    }
  }

  private processCallExpression(node: Node, currentSelector: string, ctx: CssContext) {
    const fnNameNode = this.findChild(node, (c) => c?.type === "function_name" || c?.type === "identifier")
    if (!fnNameNode) return

    if (fnNameNode.text === "var" && currentSelector) {
      const argsNode = this.findChild(node, (c) => c?.type === "arguments")
      if (argsNode) {
        const argStack = [argsNode]
        while (argStack.length > 0) {
          const n = argStack.pop()!
          if (n.namedChildCount === 0 && n.text.trim().startsWith("--")) {
            ctx.relationships.push({
              source: currentSelector,
              target: n.text.trim(),
              type: ASTEngine.RelationshipType.References,
              metadata: { cssSpecific: true, isVariableRef: true },
            })
            ctx.patterns["CSS Custom Properties"] = true
          }
          for (let i = n.namedChildCount - 1; i >= 0; i--) {
            const child = n.namedChild(i)
            if (child) argStack.push(child)
          }
        }
      }
    }
  }

  private detectFrameworksFromClasses(ctx: CssContext) {
    const selectors: ASTEngine.UniversalSymbol[] = []
    for (let i = 0; i < ctx.symbols.length; i++) {
      if (ctx.symbols[i].metadata?.isSelector) selectors.push(ctx.symbols[i])
    }

    let tailwindScore = 0
    let bootstrapScore = 0
    let muiScore = 0
    let vuetifyScore = 0
    let bulmaScore = 0
    let foundationScore = 0

    for (let i = 0; i < selectors.length; i++) {
      const s = selectors[i]
      const classNames = (s.metadata?.classNames as string[]) || []
      for (let j = 0; j < classNames.length; j++) {
        const cls = classNames[j]
        if (isTailwindClass(cls)) tailwindScore += 5
        if (isBootstrapClass(cls)) bootstrapScore += 5
        if (cls.startsWith("Mui")) muiScore += 5
        if (cls.startsWith("v-btn") || cls.startsWith("v-card") || cls.startsWith("v-col")) vuetifyScore += 5
        if (isBulmaClass(cls)) bulmaScore += 5
        if (isFoundationClass(cls)) foundationScore += 5
      }
    }

    if (tailwindScore > 10) ctx.frameworks["Tailwind CSS"] = true
    if (bootstrapScore > 0) ctx.frameworks["Bootstrap / Grid System"] = true
    if (muiScore > 5) ctx.frameworks["Material UI (MUI)"] = true
    if (vuetifyScore > 5) ctx.frameworks["Vuetify"] = true
    if (bulmaScore > 10) ctx.frameworks["Bulma"] = true
    if (foundationScore > 10) ctx.frameworks["Foundation"] = true
  }

  private calculateMetrics(ctx: CssContext) {
    let maintainability = 100
    let performance = 100

    const selectors: ASTEngine.UniversalSymbol[] = []
    for (let i = 0; i < ctx.symbols.length; i++) {
      if (ctx.symbols[i].metadata?.isSelector) selectors.push(ctx.symbols[i])
    }

    const complexSelectors: ASTEngine.UniversalSymbol[] = []
    for (let i = 0; i < selectors.length; i++) {
      if (selectors[i].metadata?.isComplex) complexSelectors.push(selectors[i])
    }

    if (selectors.length > 0) {
      const complexRatio = complexSelectors.length / selectors.length
      if (complexRatio > 0.3) {
        maintainability -= 20
        performance -= 10
      }
    }

    if (ctx.patterns["Uses !important"]) {
      maintainability -= 25
    }

    const score = Math.round((maintainability + performance) / 2)

    return {
      score: Math.min(100, Math.max(0, score)),
      maintainability: Math.min(100, Math.max(0, maintainability)),
      performance: Math.min(100, Math.max(0, performance)),
      quality: score >= 80 ? "Excellent" : score >= 60 ? "Good" : "Fair",
    }
  }

  private generateInsights(ctx: CssContext, frameworks: string[]): string[] {
    const insights: string[] = []

    let hasTailwind = false
    let hasBootstrap = false
    let hasCSSModules = false
    let hasSCSS = false

    for (let i = 0; i < frameworks.length; i++) {
      if (frameworks[i] === "Tailwind CSS") hasTailwind = true
      if (frameworks[i] === "Bootstrap" || frameworks[i] === "Bootstrap / Grid System") hasBootstrap = true
      if (frameworks[i] === "CSS Modules") hasCSSModules = true
      if (frameworks[i] === "SCSS/SASS") hasSCSS = true
    }

    if (hasTailwind) insights.push("Utilizes Tailwind utility paradigms")
    if (hasBootstrap) insights.push("Utilizes Bootstrap grid and component paradigms")
    if (hasCSSModules) insights.push("Utilizes isolated CSS Modules for component styling")
    if (hasSCSS) insights.push("Leverages SCSS/SASS preprocessor macros and mixins")

    if (ctx.patterns["Complex Selectors"]) insights.push("Deep nesting/complex specificity detected")
    if (ctx.patterns["Responsive Design (Media Queries)"]) insights.push("Implements responsive viewports")
    if (ctx.patterns["CSS Custom Properties"]) insights.push("Leverages native CSS variables for theming")
    if (ctx.patterns["Cascade Layers (@layer)"]) insights.push("Uses Cascade Layers for architectural isolation")
    if (ctx.patterns["Container Queries (@container)"]) insights.push("Implements component-driven Container Queries")
    return insights
  }

  private nodeToRange(node: Node): ASTEngine.UniversalSymbol["range"] {
    return {
      startLine: node.startPosition.row + 1,
      startColumn: node.startPosition.column + 1,
      endLine: node.endPosition.row + 1,
      endColumn: node.endPosition.column + 1,
      startIndex: node.startIndex,
      endIndex: node.endIndex,
    }
  }
}
