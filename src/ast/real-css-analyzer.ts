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
  /** family name -> declared by an `@font-face` in THIS file. Pre-collected. */
  fontFaceNames: Record<string, boolean>
  /** counter-style name -> declared by a `@counter-style` in THIS file. Pre-collected. */
  counterStyleNames: Record<string, boolean>
  /** custom-media name (`--x`) -> the `@custom-media` in THIS file that declares it. */
  customMediaNames: Record<string, boolean>
  /** font family -> declared by a `@font-feature-values` in THIS file. */
  fontFeatureValuesNames: Record<string, boolean>
  /** `@layer` names already published, so the ORDERING form cannot duplicate them. */
  layerNames: Record<string, boolean>
  /** namespace prefix -> the published `@namespace` symbol that declares it. */
  namespacePrefixes: Record<string, string>
  /** the order an `@layer a, b, c;` statement declares. A fact about the file. */
  layerOrder: string[]
  mixinNames: Record<string, boolean>
  frameworks: Record<string, boolean>
  patterns: Record<string, boolean>
  /**
   * The LIVE declaration of a `@keyframes` name: the at-keyword it was last declared
   * under, and the line it is on. "Live" rather than "first" because CSS Animations L1
   * §3 makes the LAST declaration of a name the one that runs — so the third
   * `@keyframes spin` in a file replaces the SECOND, not the first, and an edge that
   * claimed otherwise would point at a block that was already dead.
   *
   * The KEYWORD is kept beside the line because it is the whole discriminator. CSS
   * has no `vendor/standard` distinction anywhere else in its grammar, and an
   * `@-webkit-keyframes` block is not a redeclaration of the `@keyframes` block beside
   * it: they are two animations and the user agent picks the one it implements.
   * Measured over the whole admitted corpus (1,114 files, 61 repos): 146 adjacent
   * same-name declarations, of which **142 are a vendor-prefixed pair** and **4 are
   * genuine redefinitions**. Emitting for the 142 would have been a fabrication over
   * 97.3% of the type; emitting for none of the 4 would have been a ruling of `0`
   * where the count is 4.
   */
  keyframeLive: Record<string, { keyword: string; line: number }>
  /** The live `@property --x` registration's line. Same last-wins rule. */
  propertyLive: Record<string, number>
  /**
   * The `--x` assignments seen so far in the CURRENT declaration block, for `overrides`.
   *
   * Keyed by property name, scoped to one `rule_set` / `keyframe_block` — see
   * `customPropBlockKey` for why the scope is per block and not per file.
   */
  customPropInBlock: Record<string, { line: number; important: boolean }>
  /**
   * Which declaration block `customPropInBlock` describes: the enclosing
   * `rule_set` / `keyframe_block`'s start offset, or `""` before one is seen.
   *
   * Per FILE would be wrong, and this is the reason the field exists. `:root { --x: 1 }`
   * then `.dark { --x: 2 }` assigns `--x` twice in one file, but the two declarations
   * do NOT replace one another — they apply to different elements, and the cascade picks
   * between them per element. Emitting `overrides` there would claim the second kills the
   * first, which is false. Two declarations in the SAME block have one origin, one
   * specificity, one layer and one importance, so there the later one does replace the
   * earlier one outright (CSS Cascade 5 §6.1, "The last declaration in document order
   * wins"), which is the shape `recordKeyframesOverride` already implements for
   * `@keyframes`. So the block, not the file, is the unit.
   */
  customPropBlockKey: string
  /** Emitted `overrides` edges, keyed `name\u0000line`, so a third declaration of one
   * name emits one edge per supersession rather than one per occurrence. */
  overrideEdges: Record<string, boolean>
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
  /**
   * A published at-rule SCOPE symbol, by name — the handle `widenScopeSymbol` needs.
   *
   * This replaces a `mediaScopeFirstRange` map that was written at one site and read at
   * none, which is the dead-state shape the F1 audits exist to find. The reason a scope
   * symbol needs a handle at all is `widenScopeSymbol`'s, which is the defect below.
   */
  scopeSymbol: Record<string, ASTEngine.UniversalSymbol>
  /**
   * Selector-chain edges, held until every symbol is known. A `contains` edge is
   * a claim about two graph nodes, and a chain leaf is not a node — see the
   * ruling at the emission site.
   */
  deferredChainEdges: { from: string; to: string; rule: string; line?: number }[]
  /** raw selector group -> the chain leaves it is composed of. */
  selectorChains: Record<string, string[]>
  /** emitted vs withheld selector-chain edges, for the F6/F9 pins. */
  chainEdgeTally?: { emitted: number; withheld: number }
  /** Accumulated selector cost and the deepest nesting reached, for the file metric. */
  fileSelectorComplexity?: number
  fileNestingDepth?: number
  fileMaxSelectorComplexity?: number
}

interface StackFrame {
  node: Node
  media: string
  /**
   * An `@supports` condition. Its own frame field, for the same reason `scope` has
   * one: folding it into `media` would MISNAME the edge (`@supports (display:grid)`
   * is a feature query, not a media condition), and dropping it is what happened —
   * 16 `@supports` scopes published, 0 `contains` edges.
   */
  supports: string
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
//
// ZERO REGEX, and that is a mechanical property rather than a preference. A regex over
// node text cannot tell a construct from its own mention: it matches inside a comment,
// inside a string literal, inside a `url()`, and it silently changes meaning on the
// next grammar version. Every helper below replaced one, and in every case the
// information was either IN THE NODE — in which case the node is read instead — or was
// a token boundary, which is a character test and nothing more. `script/m12/
// verify-regex-census.ts` is the arbiter and it prints every row.
//
// The set below is exactly what JS `\s` matches, not the ASCII five, because a
// replacement that quietly stops matching a code point is a behaviour change wearing a
// cleanup's commit message. It is the SAME set the class's own `isSpace` used, so
// there is now one definition of "whitespace" in this file rather than two.
//
// THREE helpers this file does NOT have, and why. `stripSigil` (drop a literal sigil
// and the whitespace after it), `stripLeadingToken` (drop a sigil and the
// non-whitespace run after it) and `stripTrailingSemicolon` were each written to
// replace one anchored pattern, and each was DELETED before this commit: the three
// call sites turned out to have the boundary in the TREE — `at_keyword`/`@namespace`
// as one child, `;` and `block` as another — so the string peel was strictly worse than
// reading `startIndex`/`endIndex` off nodes the parser had already located. See
// `atRulePrelude` and `collectNamespacePrefixes`. Recording it because "a helper I
// wrote and then deleted" and "a helper I never needed" look identical in a diff, and
// only the first is worth a reader's five seconds.

/** Every code point JS `\s` matches: ASCII six, \v, NBSP, the U+2000 block, the
 *  line/paragraph separators, and the BOM. */
const JS_WHITESPACE = new Set([
  " ", "\t", "\n", "\v", "\f", "\r",
  " ", " ", " ", " ", " ", " ", " ", " ",
  " ", " ", " ", " ", " ", " ", " ", " ",
  " ", "　", "﻿",
])

function isWhitespaceChar(c: string): boolean {
  return JS_WHITESPACE.has(c)
}

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
/**
 * The leading `--ident` of a `@custom-media` prelude, or `""`.
 *
 * `--narrow (max-width: 400px)` -> `--narrow`. The condition is the declaration's
 * VALUE; the name is the referable part, and it is the name `@media (--narrow)`
 * resolves against. Deliberately not a node-type match: the grammar has no
 * `custom_media` node, so a type-shaped rule would have nothing to match and would
 * silently keep returning `""`.
 */
function leadingCustomIdent(prelude: string): string {
  const t = prelude.trim()
  if (t.length < 2 || t.charAt(0) !== "-" || t.charAt(1) !== "-") return ""
  let i = 2
  while (i < t.length && isCustomIdentChar(t.charAt(i))) i++
  return t.slice(0, i)
}

/**
 * One code point of a CSS `<custom-ident>` continuation, or false.
 *
 * CSS Syntax 3 §3.2: an ident code point is a letter, a non-ASCII code point, a digit,
 * a hyphen, or an underscore. The non-ASCII and escape arms are not enumerated here
 * because the only caller reads a name this grammar already lexed as a single
 * `keyword_query` token, and an escape inside one arrives as `escape_sequence` text.
 */
function isCustomIdentChar(c: string): boolean {
  return (
    (c >= "a" && c <= "z") ||
    (c >= "A" && c <= "Z") ||
    (c >= "0" && c <= "9") ||
    c === "-" ||
    c === "_"
  )
}

/**
 * Drop a trailing `:<digits>` occurrence suffix, or return `text` unchanged.
 *
 * The suffix a bundler writes to keep two same-named rules distinct: `btn:12`. It is
 * removed only when the digits run to the end of the string AND a `:` introduces them,
 * so `a:1b`, `123` and `a:` are all returned untouched.
 */
function stripOccurrenceSuffix(name: string): string {
  let i = name.length
  while (i > 0) {
    const c = name.charAt(i - 1)
    if (c < "0" || c > "9") break
    i--
  }
  if (i === name.length) return name
  if (i === 0 || name.charAt(i - 1) !== ":") return name
  return name.slice(0, i - 1)
}

/**
 * The LAST `/`- or `\`-separated segment of a path, or the path itself.
 *
 * `lastPathSegment("a/b/theme.css")` -> `"theme.css"`. This is how the store spells a
 * file, and how the module is written in the import itself. A trailing separator yields
 * `""`, and the caller substitutes the whole path — the same substitution the
 * `split`-and-take-the-last-element form it replaced made.
 */
function lastPathSegment(p: string): string {
  let cut = -1
  for (let i = 0; i < p.length; i++) {
    const c = p.charAt(i)
    if (c === "/" || c === "\\") cut = i
  }
  return cut >= 0 ? p.slice(cut + 1) : p
}

/**
 * The first whitespace-delimited token of `text`, or `""`.
 *
 * `firstToken("sass:math as math")` -> `"sass:math"`. The one caller passes text that
 * has already been through `collapseWhitespace`, which trims, so the empty-field case a
 * raw `split` on leading whitespace would produce cannot arise there — and returning
 * `""` for it rather than the whole string is the honest answer anyway: a whitespace
 * run is not a module name.
 */
function firstToken(text: string): string {
  let i = 0
  while (i < text.length && isWhitespaceChar(text.charAt(i))) i++
  const start = i
  while (i < text.length && !isWhitespaceChar(text.charAt(i))) i++
  return text.slice(start, i)
}

/**
 * Whether a `selectors` node's text is a SELECTOR rather than mis-spanned block
 * content.
 *
 * A `;` is never part of a selector. A `{` is part of one only when it opens an
 * INTERPOLATION — SCSS spells `#{$x}` with braces — so a blanket brace test would throw
 * away every interpolated selector, which in a real Sass corpus is most of them.
 * Measured: the blanket version cost 231 truth rows and produced 237 unexplained edges.
 * Any other `{` is a block, and a selector containing a block is not a selector.
 *
 * Defined HERE rather than imported from the differential harness, on purpose: the
 * analyzer must not depend on a test file in order to know what a selector is. The same
 * predicate exists in `differential.ts` because an oracle that shares code with the
 * thing it checks is not an independent check — two implementations of one rule is the
 * price of independence, and it is worth paying in a predicate this small.
 */
function looksLikeSelectorText(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === ";") return false
    if (c === "{" && text.charAt(i - 1) !== "#") return false
  }
  return text.trim().length > 0
}

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

/**
 * Does this selector text contain a NESTING `&`?
 *
 * Escape-aware, and it has to be: the corpora carry Tailwind arbitrary values whose
 * class names contain an escaped ampersand — `.\[\&_p\]\:leading-relaxed` — and
 * `\&` is a legitimate CSS escape that belongs in the name. A plain `indexOf("&")`
 * would call 101 real Tailwind class names unresolvable and suppress every one of
 * them, which is the same class of over-correction as the dead `\s` floor.
 */
function hasNestingAmp(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "&") continue
    // count the backslashes immediately before it: an ODD run escapes the `&`
    let bs = 0
    for (let k = i - 1; k >= 0 && text[k] === "\\"; k--) bs++
    if (bs % 2 === 0) return true
  }
  return false
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

/**
 * At-rules that are STRUCTURAL SCOPES: their bodies are attributed to them and they get
 * `contains` edges, so a second block of the same name has to widen the one published
 * symbol (see `widenScopeSymbol`). `@font-face`, `@property`, `@counter-style`,
 * `@custom-media`, `@font-feature-values` and `@mixin` are DECLARATIONS, not scopes —
 * widening one of those would assert that two declarations of a thing share a location,
 * which is a different claim and is not made.
 */
const STRUCTURAL_SCOPE_AT_RULES = new Set(["@layer", "@container", "@scope"])

export class RealCssAnalyzer implements ASTEngine.LanguageAnalyzer {
  analyze(rootNode: Node, content: string, filePath: string): ASTEngine.ParseResult {
    // The importing stylesheet's own name, for `@import` edges. Pure-String, and
    // the LAST path segment: `a/b/theme.css` imports as `theme.css`, which is how
    // the module is written in the import itself and how the store spells a file.
    const lastSegment = lastPathSegment(filePath)
    this.importerName = lastSegment || filePath || "stylesheet"

    const ctx: CssContext = {
      symbols: [],
      relationships: [],
      imports: [],
      exports: [],
      errors: [],
      content,
      keyframeNames: {},
      fontFaceNames: {},
    counterStyleNames: {},
    customMediaNames: {},
    fontFeatureValuesNames: {},
      layerNames: {},
      namespacePrefixes: {},
      layerOrder: [],
      mixinNames: {},
      keyframeLive: {},
      propertyLive: {},
      customPropInBlock: {},
      customPropBlockKey: "",
      overrideEdges: {},
      frameworks: {},
      patterns: {},
      fileHasParseError: rootNode.hasError === true,
      declaredProperties: {},
      mediaScopes: {},
      scopeSymbol: {},
      deferredChainEdges: [],
      selectorChains: {},
      fileSelectorComplexity: 0,
      fileNestingDepth: 0,
      fileMaxSelectorComplexity: 0,
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
    this.collectFontFaceNames(rootNode, ctx)
    this.collectCustomDefinitionNames(rootNode, ctx)
    this.collectNamespacePrefixes(rootNode, ctx)

    const stack: StackFrame[] = [{ node: rootNode, media: "", supports: "", layer: "", container: "", scope: "", currentSelector: "" }]

    while (stack.length > 0) {
      const { node, media, supports, layer, container, scope, currentSelector } = stack.pop()!

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
      // `@supports` is a CONDITIONAL SCOPE exactly like `@media`, and the walk
      // already carries one variable per scope kind. It was missing here, so
      // `processSupports` published the scope symbol and nothing ever attributed a
      // rule to it: measured 16 `@supports` scope symbols published across the
      // corpora and **0** `contains` edges, while `@media` emits 2,921, `@layer`
      // 7,601 and `@container` 11. The corpus rotation is what exposed it — this
      // construct had not been in a previous 60-file draw.
      let nextSupports = supports
      let nextLayer = layer
      let nextContainer = container
      let nextScope = scope
      let nextSelector = currentSelector

      switch (node.type) {
        case "rule_set":
          nextSelector = this.processRuleSet(node, media, supports, layer, container, scope, currentSelector, ctx) || nextSelector
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
        case "supports_statement": {
          const newSupports = this.processSupports(node, ctx)
          if (newSupports) nextSupports = newSupports
          break
        }
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
            supports: nextSupports,
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
        const segs = stripOccurrenceSuffix(n).split(":").filter((x) => x.length > 0)
        const last = segs[segs.length - 1] ?? ""
        const dots = last.split(".")
        return dots[dots.length - 1]
      }
      // A SCOPED name resolves through its SUFFIX: svelte writes the rule as
      // `.a.svelte-xyz` and publishes `a`, so `.a.svelte-xyz` is a real endpoint
      // even though it is not itself a symbol.
      //
      // This was the lane's only super-linear path, and it was invisible to every
      // correctness gate because it is invisible to SMALL inputs. Measured with
      // script/m14/tmp/css-scaling.ts, holding the selector shape fixed and
      // varying only the rule count:
      //
      //   rules   ms/rule   x prev        rules   ms/rule   x prev
      //      250     0.265                250     0.221
      //      500     0.385   1.45x        500     0.171   0.77x
      //     1000     0.442   1.15x       1000     0.149   0.87x
      //     2000     1.218   2.76x       2000     0.184   1.24x
      //     4000     2.914   2.39x       4000     0.154   0.83x
      //     8000     5.485   1.88x       8000     0.145   0.95x
      //   `.a .b` (descendant)          `.a` (single class)
      //
      // The right column is flat, which is what linear looks like. The left one is
      // not: 43.9 SECONDS for a 254 KB file of 8,000 rules, and the corpus cannot
      // see it because no corpus file is anywhere near that size. The cause is the
      // loop this replaced — a FULL SCAN of every published name, per deferred
      // edge, per direction, after two O(1) lookups had already missed. Deferred
      // edges are O(rules), so that is O(n^2).
      //
      // `resolves` is only reached for chains, which is why exactly one of the four
      // measured shapes was quadratic and the other three were flat: a single-class
      // rule, a comma group and a functional pseudo all produce no chain edges.
      //
      // Same answer, O(length of n): the original asked "does n end with `:`+name
      // or `.`+name for ANY name", which is "does some `:`-or-`.` boundary in n
      // have a published name after it" — so walk n's own boundaries and do one
      // hash lookup each. Selector names are short, so this is linear in practice
      // and the semantics are identical.
      const resolves = (n: string): boolean => {
        if (!n) return false
        if (names.has(n)) return true
        const l = leafOf(n)
        if (names.has(l)) return true
        for (let i = 0; i < n.length; i++) {
          const c = n[i]
          if (c !== ":" && c !== ".") continue
          const tail = n.slice(i + 1)
          if (tail.length > 0 && names.has(tail)) return true
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
            line_number: e.line,
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
    // ONE SYMBOL PER IDENTITY, and a repeated selector is ONE identity.
    //
    // The fixture harness caught this as `export invariant violated: duplicate
    // export name(s) [".btn"]` — my own fixture, which used the same selector twice
    // because that is what real stylesheets do. Measured across the corpora it is not
    // an edge case: **166 of 454 files (36.6%) publish a duplicate symbol name**,
    // 2,654 distinct duplicated names, and the worst file publishes the same selector
    // TWELVE times. Every `contains` / `uses` / `references` edge naming one of those
    // is therefore AMBIGUOUS — a consumer asking "what applies to `div.svelte-xyz`"
    // gets twelve indistinguishable nodes, and no edge says which.
    //
    // Merging is the semantically correct fix rather than a dedupe of convenience,
    // because in CSS a selector is a MATCH PATTERN, not a declaration. Two rules
    // written `.a { … }` are not two declarations of a thing named `.a`; they are
    // two rules that the same selector matches, and the selector is the identity.
    // So the graph node is the selector, and the rules are occurrences of it.
    //
    // Identity is (kind, name, scope) — not name alone — because a nested rule's
    // scope is part of what it resolves to. Two nested rules with the same resolved
    // name under the same parent ARE the same node and do merge.
    //
    // Metadata is MERGED rather than dropped: the union of the properties declared
    // across the occurrences, the union of class names, the max specificity, and the
    // OR of the boolean shape flags. Taking the first occurrence's metadata instead
    // would silently drop what the other rules declare, which is the same class of
    // loss as discarding an edge.
    {
      const byIdentity = new Map<string, ASTEngine.UniversalSymbol>()
      const merged: ASTEngine.UniversalSymbol[] = []
      for (const sym of ctx.symbols) {
        // IDENTITY IS (kind, RESOLVED NAME). The scope is provenance, not identity.
        //
        // Two cases forced this, both measured:
        //
        //  - a custom property: `--bg-1` under `:root` and again under `.dark` is the
        //    SAME property and the cascade picks a winner. It is a registry entry —
        //    the same line as the ruling that a custom property is a THING while
        //    `color` is a keyword.
        //
        //  - a nested selector: `div.svelte-xyz { &.x { … } }` resolves to
        //    `div.svelte-xyz.x`, which is the SAME selector as a top-level
        //    `div.svelte-xyz.x` a few lines away. They match the same elements, so
        //    they are one node. This is already the lane's own chain rule — "the
        //    rule's own NAME is the resolved chain" — applied to identity.
        //
        // Keeping scope in the key left 9 corpus files (2.0%) still publishing a
        // duplicate name, 281 duplicated names, worst 2x, every one of them this
        // case. An edge naming one of those is ambiguous, and an ambiguous endpoint is
        // the failure the export invariant exists to convict.
        const key = `${sym.kind}\u0000${sym.name}`
        const first = byIdentity.get(key)
        if (!first) {
          byIdentity.set(key, sym)
          merged.push(sym)
          continue
        }
        const a = (first.metadata ?? {}) as Record<string, any>
        const b = (sym.metadata ?? {}) as Record<string, any>
        const out: Record<string, any> = { ...a }
        for (const [k, v] of Object.entries(b)) {
          const cur = out[k]
          if (Array.isArray(v) && Array.isArray(cur)) {
            // union, order-preserving
            for (const item of v) if (!cur.includes(item)) cur.push(item)
          } else if (typeof v === "boolean" && typeof cur === "boolean") {
            out[k] = cur || v
          } else if (typeof v === "number" && typeof cur === "number" && (k.includes("specificity") || k.includes("omplexity"))) {
            out[k] = Math.max(cur, v)
          } else if (cur === undefined) {
            out[k] = v
          }
        }
        first.metadata = out
        // the merged node spans every occurrence, and says how many there were
        const firstLine = first.range?.startLine ?? 0
        const lastLine = sym.range?.endLine ?? firstLine
        if (lastLine > (first.range?.endLine ?? 0)) {
          first.range = { ...(first.range as any), endLine: lastLine }
        }
        const occ = (first.metadata.occurrences as number | undefined) ?? 1
        first.metadata.occurrences = occ + 1
        // the scopes it was written under, so the provenance of a merged node is not
        // lost — `scope` keeps the first, `scopes` keeps them all
        const prevScopes = (first.metadata.scopes as string[] | undefined)
          ?? (first.scope ? [first.scope] : [])
        if (sym.scope && !prevScopes.includes(sym.scope)) prevScopes.push(sym.scope)
        if (prevScopes.length > 1) first.metadata.scopes = prevScopes
        if (firstLine > 0) first.metadata.firstLine = Math.min(first.metadata.firstLine ?? firstLine, firstLine)
      }
      ctx.symbols = merged
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

    // EVIDENCE TIER, in ONE pass rather than at the ~13 push sites.
    //
    // Every other relationship in this codebase records WHY it exists — 78
    // `structural`, 60 `usage_contextual`, 27 `import_based` across the analyzers —
    // and CSS recorded none, so every edge this lane emits was unranked evidence.
    // M14 F3 section D asks a lane's fixtures to pin at least two distinct
    // evidenceClass values, and it could not be satisfied honestly for CSS: a
    // fixture cannot pin a field the analyzer never sets.
    //
    // Done as a single keyed pass rather than 13 edits, because 13 edits is a
    // count that can be miscounted: a new push site added later would silently
    // skip the tier and the lane would drift back to unranked with nothing
    // failing. A pass keyed by relationship TYPE is total by construction.
    //
    // The tiers are the house mapping (real-bash-analyzer.ts:225), NOT a CSS-local
    // vocabulary. Inventing a lane's own tier names is the set-drift problem CC1
    // exists to prevent, so the three values are the ones the rest of the codebase
    // already means by them:
    //
    //   structural       both endpoints are nodes in THIS file's tree and the link
    //                    is the grammar's own structure. Every `contains` is this:
    //                    a scope wraps a rule, a rule declares a custom property,
    //                    a chain joins two selectors that both resolve here.
    //   usage_contextual the link is established by a NAME in a value position and
    //                    resolved by matching, not by tree structure. `uses` is
    //                    this: `animation: spin` names a @keyframes the file
    //                    declares, and the edge exists because those two texts
    //                    agree.
    //   import_based     the endpoint is asserted by reference to something
    //                    OUTSIDE this tree. `imports` obviously. `references` is
    //                    the CSS case worth spelling out: `var(--x)` reads a
    //                    custom property that may be declared in another
    //                    stylesheet entirely, so the edge asserts a dependency on
    //                    a NAME, not on a node this parse saw. That is the weaker
    //                    claim, and `import_based` is the codebase's existing word
    //                    for it — the property really is imported from somewhere.
    const evidenceClassFor = (type: ASTEngine.RelationshipType): string => {
      if (type === ASTEngine.RelationshipType.Imports || type === ASTEngine.RelationshipType.References) return "import_based"
      if (type === ASTEngine.RelationshipType.Uses) return "usage_contextual"
      return "structural"
    }
    //
    // A relationship with no `type` is not classifiable, and it is NOT given a
    // default tier: `structural` would be a claim about an edge whose kind nobody
    // stated. Measured, this branch is dead on real code — 0 of 1,384 css
    // relationships across svelte + grails-core lack a type — so the guard exists
    // for the TYPE, not for a live case. If it ever fires the edge stays unranked
    // and visible rather than quietly plausible, and a fixture pinning a tier on
    // it will fail.
    let unrankable = 0
    for (const rel of ctx.relationships) {
      const md = (rel.metadata ?? {}) as Record<string, unknown>
      if (typeof md.evidenceClass === "string" && md.evidenceClass.length > 0) continue
      if (rel.type == null) { unrankable++; continue }
      rel.metadata = { evidenceClass: evidenceClassFor(rel.type), ...md }
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
        // NB: the cascade order is NOT recorded here. `parseFile` rebuilds file
        // metadata as a fresh literal of specific keys (engine.ts:1572 — its own
        // comment says an omitted key is "computed and DISCARDED — silently"), so a
        // key added at the analyzer would never reach a consumer, and a key that
        // looks present but is always dropped is worse than an absent one. The order
        // rides each layer SYMBOL as `layerIndex`, which is passed through.
        // 0 on every real corpus file; present so a non-zero value is a number
        // someone can go and look at rather than a branch nobody can observe.
        cssUnrankedRelationships: unrankable,
        // M60 R6 / CC1. This was a literal 1, and because
        // `pool-worker.ts` computes `complexity: s.complexity ||
        // s.metadata?.complexity || 1`, every CSS symbol in the store claimed a
        // complexity of exactly 1 — measured 9,338 of 9,338, 100%. A CC1 check
        // that asserts `complexity >= 1` is therefore satisfied vacuously for
        // this lane: it cannot distinguish a one-line reset from a deeply nested
        // selector, because both answer 1.
        //
        // The number is now MEASURED, and it is the thing a CSS author actually
        // finds hard: how much selector machinery a single rule carries. See
        // `selectorComplexity` for the terms and why each is there.
        cyclomaticComplexity: metrics.complexity,
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
  /**
   * The 1-based line of a node — the M59 convention, matching the symbol
   * `line_start` base the LSP reads with `line - 1`.
   *
   * M59.A7 / #825. The rule this lane follows is one sentence: **the line belongs
   * to the NAME, never to the construct that contains it.** Every call site below
   * passes the node the NAME is written on, not the node that encloses it:
   *
   *   a `contains` scope edge      -> the rule's `selectors` node, not the
   *                                   `rule_set` (which opens on the same line
   *                                   here, but not for a nested rule under a
   *                                   multi-line selector)
   *   a custom-property `contains` -> the `property_name` node, not the
   *                                   `declaration` (a declaration can carry a
   *                                   leading comment or a newline before the
   *                                   name)
   *   an `animation` reference     -> the VALUE node naming the keyframes, not
   *                                   the `animation` property (the referenced
   *                                   name is written on the value's line, and a
   *                                   shorthand puts several there)
   *   a `var()` reference          -> the ARGUMENT node, not the
   *                                   `call_expression` (whose start is the
   *                                   receiver's position)
   *   a `composes` edge            -> the composed name's value node
   *   an `imports` edge            -> the module NAME node, not the `@import`
   *                                   keyword (the target is written after it,
   *                                   and can be on a later line)
   *   a mixin reference            -> the `@include` at-rule's own line
   *   a selector-chain edge        -> the `selectors` node the chain is read
   *                                   from
   *
   * Where a line genuinely cannot be derived the field is ABSENT, never 0 and
   * never the enclosing symbol's line: `absent` is the honest value and 0 is a
   * lie a reader cannot detect. There are no such cases in this lane — every
   * relationship CSS emits is between two names that are written in the file —
   * and the exceptions list in docs/analyzers/real-css-analyzer.md records that
   * as a measured fact rather than an assumption.
   */
  private lineOf(node: Node | null | undefined): number | undefined {
    if (!node) return undefined
    return node.startPosition.row + 1
  }

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

  /**
   * Exactly the code points JS `\s` matches, as a set.
   *
   * This exists so the whitespace tests in `queryComplexity` are not regexes. The
   * M12 regex census drives that count DOWN, and five of the nine regexes this lane
   * carried were added by the complexity work two commits ago — `queryComplexity`
   * testing `/\s/` once per CHARACTER of every query, which is both a census
   * regression and slower than a set lookup. The full set is listed rather than the
   * ASCII five so the replacement is not a NARROWING: `\s` also matches \v, NBSP,
   * the U+2000 block, the line/paragraph separators and the BOM, and a predicate
   * that quietly stops matching a code point is a behaviour change wearing a
   * cleanup's commit message.
   */
  private static readonly JS_SPACE = JS_WHITESPACE

  private isSpace(c: string | undefined): boolean {
    return c !== undefined && RealCssAnalyzer.JS_SPACE.has(c)
  }


  /**
   * Complexity of a media/supports/container QUERY, in the same spirit as the
   * selector metric: 1, plus one for each boolean operator that joins or negates a
   * condition. `@media print` is 1 (no decision), while
   * `@supports (a:1) and (b:2) and (c:3)` is 3 and `not (a)` is 2.
   *
   * WHY THIS EXISTS. Complexity was measured for SELECTOR symbols only, and
   * `pool-worker.ts` computes `complexity: s.complexity || s.metadata?.complexity
   * || 1` — so every other kind's absent value became a FABRICATED 1 in the store.
   * Measured on the corpus, that was 6,486 of 27,322 css symbols (24%): 4,664
   * `variable`, 1,378 `interface` (@supports), 350 `module` (@media/@layer/
   * @container) and 94 `function` (keyframes). A `@supports` scope with a
   * 20-condition query read identically to `.plain { color: red }`, which is the
   * same defect as the hardcoded 1, one level narrower and therefore easier to
   * miss.
   */
  private queryComplexity(text: string): number {
    if (!text) return 1
    // Only TOP-LEVEL joins count: an `and`/`or` inside a nested parenthesis is part
    // of that sub-condition's own cost, and counting it twice would make a nested
    // query look worse than a flat one of the same size.
    let depth = 0
    let ops = 0
    const src = text
    for (let i = 0; i < src.length; i++) {
      const c = src[i]
      if (c === "(") { depth++; continue }
      if (c === ")") { depth--; continue }
      if (depth !== 0) continue
      if (c === "a" && src.startsWith("and", i) && this.isSpace(src[i - 1])) { ops++; i += 2; continue }
      if (c === "o" && src.startsWith("or", i) && this.isSpace(src[i - 1])) { ops++; i += 1; continue }
      if (c === "n" && src.startsWith("not", i) && this.isSpace(src[i - 1])) { ops++; i += 2; continue }
    }
    return 1 + ops
  }

  /** `keyframe_block` children of a `keyframes_statement` — one per animation stop. */
  private countKeyframeStops(node: Node): number {
    let n = 0
    const walk = (x: Node) => {
      if (x.type === "keyframe_block") n++
      for (let i = 0; i < x.childCount; i++) { const c = x.child(i); if (c) walk(c) }
    }
    walk(node)
    return n
  }

  /**
   * A custom property's complexity: 1, plus one for each `var(--other)` it reads.
   * A `--brand: #06c` is 1; a theming token composing five others is 6, and that
   * composition chain is the review cost. This is the last css symbol kind that
   * had no measured value — with it, all 27,322 corpus symbols carry one, and the
   * `|| 1` fallback in `pool-worker.ts` stops fabricating a quarter of the lane.
   */
  private customPropertyComplexity(decl: Node): number {
    let reads = 0
    for (let i = 0; i < decl.childCount; i++) {
      const child = decl.child(i)
      if (!child) continue
      for (let j = 0; j < child.childCount; j++) {
        const leaf = child.child(j)
        if (leaf && this.countsVarRead(leaf.text)) reads++
      }
    }
    return 1 + reads
  }

  /**
   * Does this text contain a `var(` immediately followed by a custom-property name?
   * Replaces `/var\(\s*--/` with a scan rather than narrowing it: the whitespace
   * between `(` and `--` is skipped with the same `\s` set, so `var( --x)` still
   * counts exactly as it did.
   */
  private countsVarRead(text: string): boolean {
    for (let i = 0; i + 3 < text.length; i++) {
      if (text[i] !== "v" || text[i + 1] !== "a" || text[i + 2] !== "r" || text[i + 3] !== "(") continue
      let k = i + 4
      while (k < text.length && this.isSpace(text[k])) k++
      if (text[k] === "-" && text[k + 1] === "-") return true
    }
    return false
  }

  /**
   * The at-rule's OWN descriptors: `declaration` children of its DIRECT block, one
   * level only.
   *
   * One level, deliberately. The first version walked the whole subtree and
   * produced complexity 2,917 for Tailwind's `@layer utilities`, which wraps
   * essentially the whole stylesheet — so the number was "declarations in
   * everything nested under here", which is a file size, not a complexity, and it
   * double-counted every selector that already carries its own. `@layer utilities`
   * is honestly 1: its contents are accounted by the rules inside it.
   *
   * This is what makes the descriptor reading correct where it applies:
   * `@property --x` with `syntax`/`inherits`/`initial-value` is 4, `@font-face`
   * with a descriptor set is its count + 1, and `@mixin` with one declaration is 2.
   */
  private countDescriptors(node: Node): number {
    let n = 0
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (!child || child.type !== "block") continue
      for (let j = 0; j < child.childCount; j++) {
        const d = child.child(j)
        if (d && d.type === "declaration") n++
      }
      break
    }
    return n
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
    supports: string,
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

    //
    // A `selectors` node whose text is not a SELECTOR publishes nothing.
    //
    // Grammar recovery can give the node a text range that covers DECLARATIONS, and it
    // does so WITHOUT an ERROR ancestor. Measured on
    // `element-plus/packages/theme-chalk/src/input-number.scss`, where one `selectors`
    // node's text was
    //
    //   `.#{$namespace}-input__wrapper padding-left: #{map.get(…)};\n  padding-right: …`
    //
    // and the lane published it as a symbol name — a "selector" containing braces,
    // colons and semicolons, which nothing can reference and no consumer splitting on
    // commas can use. It reached the differential as an UNEXPLAINED edge, i.e. a
    // fabrication.
    //
    // The test rejects a `;` outright and a `{` that is not part of an INTERPOLATION:
    // in SCSS `#{$x}` is spelled with braces, so a blanket brace test throws away every
    // interpolated selector — which in the element-plus corpus is most of them. The
    // first version made exactly that mistake and the truth fell from 594 rows to 363
    // with 237 edges unexplained, which is the signature of a truth that got SMALLER,
    // and the only honest reading of that is that the truth is wrong.
    if (!looksLikeSelectorText(selectorsNode.text)) return null
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
    if (keptSelectors.length === 0) {
      return null
    }
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

    // A `&` WITH NO PARENT cannot be resolved. That happens when the enclosing rule
    // published nothing — measured case: `* { &:hover .class { … } }`, where `*` is
    // a universal reset and is suppressed by CSS-D5, so the nested rule had no parent
    // and kept its raw text. The lane then published a symbol literally named
    // `&:hover .class.svelte-xyz`: a name containing `&`, which is not a selector
    // anything can reference. M60 R7's placeholder-literal class, reached from the
    // other direction.
    //
    // A rule whose name cannot be resolved is not addressable, so it publishes
    // nothing — the same suppression as its parent, applied one level down. That
    // makes "no published name in this lane contains a nesting `&`" a structural
    // property rather than a hope.
    for (const r of rawSelectors) {
      if (!parentSelector && hasNestingAmp(r)) return null
    }

    const resolvedSelectors: string[] = []
    for (let i = 0; i < parentSelectors.length; i++) {
      const p = parentSelectors[i]
      for (let j = 0; j < rawSelectors.length; j++) {
        const r = rawSelectors[j]
        if (p) {
          if (hasNestingAmp(r)) {
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
    // A comma group's cost is its most expensive member, not the sum: `.a, .b` is
    // no harder to read than `.a`. MAX mirrors how `maxSpecificity` aggregates
    // the same group, so the two numbers describe the same thing.
    let groupComplexity = 0

    const selectorNodes = selectorsNode.namedChildren
    for (let j = 0; j < selectorNodes.length; j++) {
      const selNode = selectorNodes[j]
      let specId = 0
      let specClass = 0
      let specTag = 0

      const chain: string[] = []
      // Selector complexity, accumulated over the whole selector group. Each term
      // is something a CSS author pays for at review time, and each is counted
      // where it is seen rather than inferred from the text:
      //   chain steps   a descendant/child/sibling combinator
      //   pseudo        a pseudo-class or pseudo-element
      //   attribute     an attribute selector
      //   nesting depth a `&`-composed nested rule (below)
      // The base is 1, not 0. A selector always costs something to read, and more
      // concretely the codebase's own contract is `complexity >= 1` — the CC1
      // systems and OO checks both assert it, and `pool-worker.ts` computes
      // `complexity: s.complexity || s.metadata?.complexity || 1`.
      //
      // Starting at 0 produced a value that was wrong twice over: the analyzer's
      // metadata said 0 for `.plain { color: red }` while the worker's `||` fallback
      // turned the same symbol into 1 in the store. Two truths for one number, and
      // the visible one violated the `>= 1` convention every other lane meets. A
      // metric that disagrees with the contract it is checked against is not a
      // stricter metric, it is an unmeasurable one.
      let selectorComplexity = 1
      let nestingDepth = 0
      // M59.A7: each chain LEAF's own line. The rule "the line belongs to the
      // name" means `contains #toc -> a` is named by the `a`, not by the rule's
      // `selectors` node — and in a multi-line selector group those are different
      // lines. Measured: taking the group's line made 7 of 7 chain edges
      // INCONSISTENT on go-tools' article.css, because `a` is written on the
      // group's third line.
      const chainLines: Record<string, number | undefined> = {}

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
          selectorComplexity += 1
        }
        if (n.type === "pseudo_class_selector") {
          hasPseudoClass = true
          specClass += 1
          isUtility = false
          selectorComplexity += 1
          // A functional pseudo-class (`:not(...)`, `:is(...)`, `:where(...)`,
          // `:has(...)`) carries a SELECTOR inside it, so its own contents are
          // part of the cost. Counted from the arguments node, which is what holds
          // them, rather than by matching the function name.
          //
          // The node is called `arguments`, NOT `pseudo_class_arguments`: the
          // grammar ALIASES the latter to the former
          // (`optional(alias($.pseudo_class_arguments, $.arguments))`,
          // grammar.js:231), so the pre-alias name appears in no parse tree at all
          // and this term was DEAD — every functional pseudo in the corpus was
          // scored as a plain pseudo, one step cheap. The fixture lane caught it:
          // `li:not(.skip)` came back 2 where the contract says 3. A metric whose
          // own distinguishing term can never fire is a metric that cannot tell
          // `:hover` from `:where(.a .b .c)`, which is the distinction it existed
          // to draw.
          if (this.findChild(n, (c) => c?.type === "arguments") !== null) selectorComplexity += 1
        }
        if (n.type === "pseudo_element_selector") {
          hasPseudoElement = true
          specTag += 1
          isUtility = false
          selectorComplexity += 1
        }
        if (n.type === "attribute_selector") {
          hasAttributeSelector = true
          specClass += 1
          isUtility = false
          selectorComplexity += 1
          // D7 (2026-09-26). Every other chain form pushes itself — id, tag,
          // class, universal — and the attribute form did not, so `.a [href]`
          // emitted NO chain edge while `.a .b`, `.a #b` and `.a *` all did. The
          // omission was silent: the selector symbol and its `uses` edges were
          // unaffected, so only the chain edge was missing, and only for
          // attribute selectors. The attribute NAME is pushed rather than the
          // full `[href^=x]` text, because the name is the part that identifies
          // the step — the same reason `class_name` is pushed as `.name`.
          const attrName = this.findChild(n, (c) => c?.type === "attribute_name")
          const attrKey = attrName ? attrName.text : n.text
          chain.push(attrKey)
          chainLines[attrKey] = this.lineOf(n) ?? chainLines[attrKey]
        }
        if (n.type === "id_selector") {
          hasIdSelector = true
          specId += 1
          isUtility = false
          chain.push(n.text)
          chainLines[n.text] = this.lineOf(n) ?? chainLines[n.text]
        }
        if (n.type === "tag_name") {
          hasTagSelector = true
          specTag += 1
          if (n.text !== "*") isUtility = false
          chain.push(n.text)
          chainLines[n.text] = this.lineOf(n) ?? chainLines[n.text]
        }
        if (n.type === "class_name") {
          specClass += 1
          classNames.push(n.text)
          // Chain identities must match symbol names: class_name nodes carry
          // the bare identifier (`card`) but the selector symbol is named
          // with its `.` prefix (`.card`). Emit the prefixed form so the
          // contains edge source/target resolve to real symbols.
          chain.push(`.${n.text}`)
          chainLines[`.${n.text}`] = this.lineOf(n) ?? chainLines[`.${n.text}`]
        }
        if (n.type === "universal_selector") {
          specTag += 1
          chain.push(n.text)
          chainLines[n.text] = this.lineOf(n) ?? chainLines[n.text]
        }

        if (n.text.indexOf(":local") !== -1 || n.text.indexOf(":global") !== -1) {
          isCssModule = true
        }

        for (let i = n.namedChildCount - 1; i >= 0; i--) {
          const child = n.namedChild(i)
          if (child) selStack.push(child)
        }
      }

      // Nesting: a selector composed from a parent is harder to reason about than
      // the same selector written flat, because the author must hold the parent's
      // context to know what it matches. Counted once per enclosing rule.
      if (parentSelector) nestingDepth += 1
      if (selectorComplexity > groupComplexity) groupComplexity = selectorComplexity
      if (selectorComplexity > 0) ctx.fileSelectorComplexity = (ctx.fileSelectorComplexity ?? 0) + selectorComplexity
      if (nestingDepth > 0) ctx.fileNestingDepth = Math.max(ctx.fileNestingDepth ?? 0, nestingDepth)
      if (selectorComplexity > nestingDepth) ctx.fileMaxSelectorComplexity = Math.max(ctx.fileMaxSelectorComplexity ?? 0, selectorComplexity)

      if (specId > maxSpecificity[0]) maxSpecificity = [specId, specClass, specTag]
      else if (specId === maxSpecificity[0] && specClass > maxSpecificity[1])
        maxSpecificity = [specId, specClass, specTag]
      else if (specId === maxSpecificity[0] && specClass === maxSpecificity[1] && specTag > maxSpecificity[2])
        maxSpecificity = [specId, specClass, specTag]

      // A SELECTOR THAT USES A DECLARED NAMESPACE PREFIX references that
      // declaration. `svg|a` can only be resolved given `@namespace svg url(…)`, so
      // the dependency is real and the graph was silent about it: the prefix was
      // published as a `module` symbol, the selector as a `type` symbol, and nothing
      // connected them.
      //
      // The omission audit marked this PARTIAL rather than missing, because the
      // corpus carries it once (svelte's supports-namespace sample) — which is
      // exactly the shape of defect a small count hides.
      if (selectorText) {
        const bar = selectorText.indexOf("|")
        if (bar > 0) {
          const prefix = selectorText.slice(0, bar).trim()
          const declared = ctx.namespacePrefixes[prefix]
          if (declared) {
            ctx.relationships.push({
              source: selectorText,
              target: declared,
              type: ASTEngine.RelationshipType.References,
              // the name on this edge is the DECLARATION, which is written on the
              // `@namespace` line — not the selector's own line
              line_number: this.lineOf(selectorsNode),
              metadata: { cssSpecific: true, isNamespaceRef: true },
            })
          }
        }
      }

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
          // The edge `from -> to` is named by `to`, so the line is `to`'s.
          ctx.deferredChainEdges.push({
            from: chain[i],
            to: chain[i + 1],
            rule: rawSelectors.join(", "),
            line: chainLines[chain[i + 1]] ?? this.lineOf(selectorsNode),
          })
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
      // `complexity` is a REQUIRED field of the Symbol contract (engine.ts:389) and
      // the store reads it directly (`complexity: meta.complexity || 0`, engine.ts
      // :1573). CSS carried the number in `metadata` only, so the contract field was
      // never populated and both the store and pool-worker's `||` fallbacks invented
      // a value. One number, one field.
      complexity: groupComplexity + (parentSelector ? ctx.fileNestingDepth ?? 0 : 0),
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
        // Nesting depth is added to the selector's own complexity (set on the
        // symbol above) rather than inside the walk, because `nestingDepth` is a
        // property of the RULE, and the walk counts complexity per selector within
        // the group.
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

    // M59.A7: every one of these five edges is named by the rule's SELECTOR, so
    // all five take the `selectors` node's line. The scope source's own line
    // would be a different line for a nested rule, and the `rule_set`'s line
    // would be the same as the selector's here — but the SELECTOR is the name,
    // and taking the name is the rule that survives a formatting change.
    const selectorLine = this.lineOf(selectorsNode)
    //
    // …and that claim is TRUE only when the name is actually written on that line,
    // which it is not for a NESTED rule. `selectorText` is the RESOLVED name: a
    // nested rule composes to parent + own (`th` under `table … tr:nth-child(odd)`
    // resolves to `table … tr:nth-child(odd) th`), so its line writes only `th`.
    // The five scope edges below claimed the line regardless, and asserted a name
    // the line does not contain.
    //
    // This is not new behaviour being invented here — it is the lane's OWN rule,
    // applied one edge too few. The nested-selector edge below already compared
    // the written text with the composed name and dropped the line when they
    // differed; testing for `&` is not enough, because an implicit descendant
    // (`.a { .b { … } }`, no `&` at all) composes too. The scope edges were the
    // same case with the test missing, which is why they were the last ones to
    // fail: nothing in pure CSS nests the way SCSS does, so the CSS corpus rarely
    // reaches them, and the 40-file M59 sample read 86/86 on the strength of that
    // rarity. The SCSS lane, whose entire corpus nests, exposed all 10 at once.
    //
    // So the test is hoisted here and both families consume one answer. A name the
    // line does not write gets NO line, which is the same choice the nested edge
    // already made and for the same stated reason: never checkable rather than
    // silently unaccused, and never a claim that accuses a correct edge.
    const asWritten = selectorsNode.text.trim()
    const composedName = collapseWhitespace(asWritten) !== selectorText
    const nameLine = composedName ? {} : { line_number: selectorLine }
    const nameProvenance = composedName ? { isSynthesizedName: true, asWrittenSelector: asWritten } : {}
    if (media) {
      ctx.relationships.push({
        source: media,
        target: selectorText,
        type: ASTEngine.RelationshipType.Contains,
        ...nameLine,
        metadata: { cssSpecific: true, isMediaScope: true, ...nameProvenance },
      })
    }
    // `@supports` is a conditional scope: the same shape as `@media`, so the same
    // `contains` edge, named by the rule's selector. Emitted with its own metadata
    // class so a consumer can tell a feature-query scope from a media condition
    // without re-parsing the name.
    if (supports) {
      ctx.relationships.push({
        source: supports,
        target: selectorText,
        type: ASTEngine.RelationshipType.Contains,
        ...nameLine,
        metadata: { cssSpecific: true, isSupportsScope: true, ...nameProvenance },
      })
    }
    if (layer) {
      ctx.relationships.push({
        source: layer,
        target: selectorText,
        type: ASTEngine.RelationshipType.Contains,
        ...nameLine,
        metadata: { cssSpecific: true, isLayerScope: true, ...nameProvenance },
      })
    }
    if (container) {
      ctx.relationships.push({
        source: container,
        target: selectorText,
        type: ASTEngine.RelationshipType.Contains,
        ...nameLine,
        metadata: { cssSpecific: true, isContainerScope: true, ...nameProvenance },
      })
    }
    if (scope) {
      ctx.relationships.push({
        source: scope,
        target: selectorText,
        type: ASTEngine.RelationshipType.Contains,
        ...nameLine,
        metadata: { cssSpecific: true, isScopeScope: true, ...nameProvenance },
      })
    }
    if (parentSelector) {
      // M59.A7, and the third state is the answer. A CSS-nested rule writes `&`,
      // not its resolved name: the source says `& .item` where the symbol is
      // `.nav .item`. The resolved name is therefore SYNTHESISED — it is written
      // on no line of the file — and the precedent is explicit that a claim of a
      // line for a synthesized name is "a definite defect, not an uncheckable
      // claim". So the line is OMITTED, and the as-written selector is kept in
      // metadata so a reader can find the site.
      //
      // Measured: with a line claimed here, 96 of 96 nested-selector edges were
      // INCONSISTENT against the source text — not because the line was nearly
      // right, but because the name it named is not in the file at all.
      //
      // A nested rule that does NOT use `&` (`.a { .b { … } }`) is a different
      // case: there the resolved name IS written, and it keeps its line.
      // The name is synthesized unless the RESOLVED text and the AS-WRITTEN text
      // are the same string. Testing for `&` is not enough: an implicit
      // descendant (`.a { .b { … } }`, no `&` at all) also resolves to a composed
      // name (`.a .b`) that is written nowhere, and it accounted for the 67
      // INCONSISTENT edges left after the `&` test. The exact test is whether the
      // two texts coincide — cheap, and it keeps a real line in the one case
      // where the name genuinely is written.
      //
      // That test, and the two answers it drives, are the ones hoisted above as
      // `asWritten` / `composedName` / `nameLine` / `nameProvenance`: this edge and
      // the five scope edges ask the same question of the same two strings, so they
      // read one answer rather than each re-deriving it. Two copies of a
      // correctness rule is one copy waiting for the other to be edited.
      ctx.relationships.push({
        source: parentSelector,
        target: selectorText,
        type: ASTEngine.RelationshipType.Contains,
        ...nameLine,
        metadata: {
          cssSpecific: true,
          isNestedSelector: true,
          ...nameProvenance,
        },
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
        // M59.A7: the name on this edge is the MODULE, so the line is the
        // `string_value` / `call_expression` node — which can be on a LATER line
        // than the `@import` keyword, and is for the multi-line form where the
        // url() wraps its argument. Taking the statement's line would be the
        // enclosing construct, not the name.
        line_number: this.lineOf(stringNode),
        confidence: 1.0,
        metadata: { isCssImport: true, importSource: this.importerName },
      })
      if (moduleName.indexOf("tailwind") !== -1) ctx.frameworks["Tailwind CSS"] = true
      if (moduleName.indexOf("bootstrap") !== -1) ctx.frameworks["Bootstrap"] = true
      if (moduleName.indexOf("bulma") !== -1) ctx.frameworks["Bulma"] = true
      if (moduleName.indexOf("foundation") !== -1) ctx.frameworks["Foundation"] = true
    }
  }

  /**
   * Every custom-media name a media query REFERENCES, in source order.
   *
   * Custom Media Queries L1: `@media (--narrow)` evaluates a `@custom-media`
   * declaration, wherever in the query list it appears and however the query is
   * composed. The grammar marks the reference exactly — a `keyword_query` directly
   * under a `parenthesized_query`, spelled `--name` — so this reads that shape rather
   * than recognising a spelling, which is why `@media screen and (--narrow)`,
   * `@media not (--c)` and `@media (--a), (--b)` are all covered.
   *
   * The discriminator is the `--` prefix and NOT the node type alone, because
   * `keyword_query` is the grammar's node for a bare media type too: `screen` in
   * `@media screen` and `print` in `@media print and (color)` are the same node type
   * and neither is a custom-media reference.
   *
   * A `parenthesized_query` holding a `feature_query` — `(min-width: 400px)` — has no
   * `keyword_query` child at all, so it contributes nothing, which is the correct
   * answer without a special case.
   */
  private customMediaRefsIn(queryNode: Node): string[] {
    const out: string[] = []
    const stack: Node[] = [queryNode]
    while (stack.length > 0) {
      const n = stack.pop() as Node
      const isRefSite = n.type === "parenthesized_query" || n === queryNode
      if (isRefSite) {
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (!c || c.type !== "keyword_query") continue
          const name = leadingCustomIdent(c.text)
          // `leadingCustomIdent` answers "" for a keyword_query that is not a `--`
          // name, which is the media-type case, so nothing else has to test the prefix.
          if (name.length > 0 && out.indexOf(name) === -1) out.push(name)
        }
      }
      // Children are pushed in reverse so `pop` visits them in source order.
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const c = n.namedChild(i)
        if (c) stack.push(c)
      }
    }
    return out
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
      //
      // AND THE DEDUP IS NOT ENOUGH ON ITS OWN — that is a pass-2 finding, and it is
      // the reason the `else` branch exists. One symbol per name is right; one symbol
      // per name carrying only the FIRST block's range is not, because every rule of
      // every LATER block then gets a `contains` edge whose source endpoint sits
      // somewhere the rule is not. Measured over the whole admitted corpus
      // (`validation/m14/census/css-boundary-probe.ts`, probe P2): **7,257 of 25,181**
      // `isMediaScope` containment edges had a contained rule OUTSIDE the source
      // symbol's line range — 28.8% of the type. Worked example,
      // `bootstrap/dist/css/bootstrap-grid.css`: the edge
      // `"@media (min-width: 576px)" contains ".col-sm"` carries `.col-sm`'s line, L284,
      // while the symbol it names is recorded at L22-L26 — 258 lines earlier, and a
      // 5-line block. So the edge is true (` .col-sm` IS inside a `@media
      // (min-width: 576px)`) and its endpoint is at the wrong place, which is what makes
      // `bb_impact` on that scope name report the wrong rule set.
      //
      // `@supports` and `@container` do not have this defect and never had it: they
      // publish a symbol per OCCURRENCE, and the identity merge at the end of `analyze`
      // folds same-named ones and takes the maximum `endLine`. `@media` and `@layer`
      // deduplicate BEFORE publishing, so the merge never sees a second copy. The fix
      // is therefore to widen the one published symbol across its later blocks, which is
      // the same convention the merge already uses, applied where the merge cannot reach.
      if (!ctx.mediaScopes[mediaName]) {
        ctx.mediaScopes[mediaName] = true
        const published: ASTEngine.UniversalSymbol = {
          name: mediaName,
          kind: ASTEngine.SymbolKind.Module,
          range: this.nodeToRange(node),
          scope: "",
          visibility: "public",
          complexity: this.queryComplexity(collapseWhitespace(queryNode.text)),
          metadata: {
            isMediaScope: true,
            mediaCondition: collapseWhitespace(queryNode.text),
            scopeBlocks: 1,
          },
        }
        ctx.symbols.push(published)
        ctx.scopeSymbol[mediaName] = published

        // `@media (--narrow)` is a REFERENCE to the `@custom-media --narrow`
        // declaration, exactly as `var(--brand)` is a reference to a
        // registration or an `animation:` to a `@keyframes`. Without this the
        // scope existed and the declaration existed and nothing joined them, so
        // the graph could not answer "which media scopes depend on this custom
        // media query" — the question both halves exist to answer.
        //
        // Only idents THIS FILE declares become edges, for the reason the
        // animation and font-family edges give: a `@media (--x)` may legitimately
        // come from another stylesheet, and inventing an endpoint for it is the
        // `global` phantom this lane removed once.
        //
        // READ OFF THE TREE, and the node is exact where the text was not. The
        // previous version took the query's whole text, peeled one leading `(` and
        // one trailing `)`, and asked whether what was left began with `--`. That
        // answers only `@media (--x)`: in `@media screen and (--x)` nothing is
        // peeled at the front, the string starts with `s`, and the reference is
        // LOST — even though the grammar hands it over as a `keyword_query` inside
        // a `parenthesized_query`, unambiguously. It also lost the comma form,
        // `@media (--a), (--b)`, where one scope genuinely depends on two
        // declarations. Measured: 0 occurrences of the construct in the admitted
        // corpus, so this widens a branch no corpus number can speak about and the
        // fixture `custom-media-in-every-query-shape` is the only evidence for it.
        // That is stated because "0 in the corpus" is what a broken probe and a
        // working branch both report.
        for (const declared of this.customMediaRefsIn(queryNode)) {
          if (!ctx.customMediaNames[declared]) continue
          ctx.relationships.push({
            source: mediaName,
            target: declared,
            type: ASTEngine.RelationshipType.References,
            // the NAME is the condition's own line, the same rule as the
            // font-family edge: the reference is the condition, not the statement
            line_number: this.lineOf(queryNode),
            metadata: { cssSpecific: true, isCustomMediaRef: true },
          })
        }
      } else {
        // The SAME query, a later block. The scope is one node, so its extent has to
        // cover every block it is the scope of — see the comment on the `if`.
        this.widenScopeSymbol(ctx.scopeSymbol[mediaName], node)
      }
      return mediaName
    }
    return null
  }

  /**
   * Extend an already-published at-rule SCOPE symbol so its recorded extent covers a
   * further block of the same scope.
   *
   * ## What was wrong, and how it was found
   *
   * `@media` and `@layer` publish ONE symbol per name, at the FIRST block, and the
   * identity merge at the end of `analyze` never sees a second copy to fold. So a file
   * with `@media (min-width: 576px)` three times has one symbol for it, recorded at the
   * first block, and every rule of the second and third blocks receives a `contains`
   * edge pointing at that first block. The edge is TRUE — the rule is inside a block of
   * that query — and its endpoint is somewhere the rule is not.
   *
   * Measured over the whole admitted corpus: 7,257 of 25,181 `isMediaScope` edges
   * (28.8%) and 40 of 505 `isLayerScope` edges (7.9%) carried a contained rule outside
   * the source symbol's line range. Worked example, `bootstrap-grid.css`: the edge for
   * `.col-sm` is at L284 and the symbol is recorded at L22-L26.
   *
   * A pass-1 probe reported this as 0 violations. That number was VACUOUS — the probe
   * read the extent as `symbol.range.start.line`, and `parseFile` returns no `range`
   * object at all (it flattens to top-level `startLine` / `endLine`), so every lookup
   * missed. The non-zero figure is from the corrected probe, and the correction is
   * recorded in `validation/m14/census/css-boundary-probe.ts` because a broken probe
   * reporting zero is indistinguishable from a correct probe reporting zero.
   *
   * ## Why widening is the right repair and not publishing a second symbol
   *
   * Two symbols with one name is the identity collision this dedup exists to prevent —
   * an edge naming one of them is ambiguous, and an ambiguous endpoint is the failure
   * the export invariant convicts. And the NAME is the only identity a consumer has
   * here: `pool-worker.ts` forwards a narrow allowlist of `metadata` keys and
   * `isMediaScope` / `mediaCondition` are not on it, so 2,804 of 3,084 at-rule scope
   * symbols arrive from `parseFile` with NO metadata at all (measured, same probe). A
   * consumer cannot tell two `@media` nodes apart except by the name, so the name's
   * extent has to be the union of its blocks. `@supports` and `@container` already get
   * exactly this from the identity merge.
   *
   * ## Only `endLine` moves, and the gap it leaves is stated
   *
   * The identity merge widens `endLine` only, and this does the same, so the byte span
   * (`startIndex`/`endIndex`) still describes the FIRST block while the line extent
   * describes all of them. A range is therefore not contiguous for a scope with
   * several blocks. That is the lane's existing convention rather than a new one, and
   * it is recorded here because a consumer that assumes contiguity will be wrong for
   * exactly the multi-block scopes this method exists to describe. `scopeBlocks` counts
   * the blocks — and is itself dropped at the production boundary, for the reason above,
   * so it is available to a fixture and not to a store consumer.
   */
  private widenScopeSymbol(sym: ASTEngine.UniversalSymbol | undefined, block: Node): void {
    if (!sym || !sym.range) return
    const r = this.nodeToRange(block)
    if (r.endLine <= (sym.range.endLine ?? 0)) return
    sym.range = { ...sym.range, endLine: r.endLine }
    const md = (sym.metadata ?? {}) as Record<string, unknown>
    const n = typeof md.scopeBlocks === "number" ? md.scopeBlocks : 1
    sym.metadata = { ...md, scopeBlocks: n + 1 }
  }

  /**
   * Every `@keyframes` name in the file, collected before the main walk so that
   * an `animation:` reference resolves regardless of where the block sits.
   */
  /**
   * The published name of an `@font-face` declaration. Used by BOTH the symbol push
   * and the `uses` edge, because when they were written separately the edge named
   * the bare family while the symbol carried the keyword — a dangling endpoint, the
   * same defect fixed for `@property` one commit earlier, in the other direction.
   * One expression is the only way two names cannot drift apart.
   */
  /**
   * The leading `--ident` of an at-rule prelude, or `""`.
   *
   * Written against the DECLARED name rather than a node type on purpose: the
   * grammar has no `custom_media` node at all (all three of these at-rules are a
   * bare `at_rule`), so there is nothing type-shaped to key on, and CSS itself says
   * a custom media query name is a `<custom-ident>` followed by a condition.
   */
  private atRulePrelude(node: Node, keyword: string): string {
    // THE PRELUDE IS THE TEXT BETWEEN TWO NODES, and both are in the tree.
    //
    // It used to be recovered by string surgery on `node.text`: `indexOf(keyword) +
    // keyword.length` for the start, `indexOf(block.text)` for the end, and — for the
    // block-less form — a pair of anchored patterns to peel `@keyword` and `;` off. All
    // three are gone, and the reason is not tidiness. `indexOf(block.text)` searches
    // from offset 0 of the NODE's text, so a prelude that happens to CONTAIN the block's
    // own text truncated at the wrong place: `@media screen { }` is fine, but a
    // `@supports` prelude that spells a brace, or any at-rule whose block text occurs
    // earlier in its own prelude, produced a prelude truncated mid-word. The grammar
    // already knows where the keyword ends and where the block or the `;` begins, and
    // a position the parser computed beats a substring search for it.
    const kwNode =
      this.findChild(node, (c) => c?.type === "at_keyword") ??
      // `@namespace` and `@media` carry their keyword as an ANONYMOUS child whose type
      // IS the keyword text, so the named-node lookup misses them.
      this.findChild(node, (c) => c?.type === keyword)
    const block = this.findChild(node, (c) => c?.type === "block")
    const semi = this.findChild(node, (c) => c?.type === ";")
    const start = kwNode ? kwNode.endIndex - node.startIndex : keyword.length
    // A block-less at-rule is terminated by `;`. With neither a block nor a `;` the
    // node is malformed and the whole text after the keyword is the best available
    // answer, which is what the old `;\s*$` peel degraded to as well.
    const terminator = block ?? semi
    const end = terminator ? terminator.startIndex - node.startIndex : node.text.length
    if (end <= start) return ""
    return collapseWhitespace(node.text.slice(start, end))
  }

  /**
   * The family of the `@font-face` block a declaration sits in, or `undefined`.
   *
   * Walks UP from the declaration to its enclosing `@font-face` and reads that
   * block's own `font-family` declaration — the same two-step the symbol push does,
   * and deliberately so: CSS binds a `font-feature-settings` value to the family of
   * the `@font-face` it appears in, so the edge target cannot be derived from the
   * value alone.
   */
  private fontFamilyOf(decl: Node): string | undefined {
    let n: Node | null = decl
    while (n) {
      if (n.type === "at_rule") {
        const kw = this.findChild(n, (c) => c?.type === "at_keyword")
        if (kw && kw.text.trim().toLowerCase() === "@font-face") {
          const block = this.findChild(n, (c) => c?.type === "block")
          const family = block
            ? this.findDescendant(block, (d) => {
                if (d.type !== "declaration") return false
                const prop = this.findChild(d, (g) => g?.type === "property_name")
                return prop !== null && prop.text === "font-family"
              })
            : null
          if (family) {
            const value = this.findChild(family, (c) => c?.type === "plain_value" || c?.type === "string_value")
            if (value) return stripAllQuotes(value.text)
          }
          return undefined
        }
      }
      n = n.parent
    }
    return undefined
  }

  private fontFaceSymbolName(family: string): string {
    return `@font-face ${family}`
  }

  /**
   * Namespace prefixes declared by `@namespace`, collected before the walk for the
   * same order-independence reason as keyframes and font faces: a selector may use a
   * prefix before the `@namespace` that declares it, and CSS does not care.
   *
   * The value is the PUBLISHED symbol name, so the edge and the symbol cannot name
   * different things — the same single-expression discipline as `@font-face`.
   */
  private collectNamespacePrefixes(root: Node, ctx: CssContext): void {
    const stack: Node[] = [root]
    while (stack.length > 0) {
      const n = stack.pop() as Node
      if (this.isErrorNode(n)) continue
      if (n.type === "namespace_statement") {
        const nameNode = this.findChild(n, (c) => c?.type === "namespace_name")
        if (nameNode) {
          const prefix = nameNode.text.trim()
          // the published name is the keyword plus the whole prelude, which is what
          // the symbol push below builds. The prelude is the text BETWEEN the
          // `@namespace` token and the `;`, and the grammar has both as children, so
          // it is read off the tree rather than peeled off the string.
          const kwNode = this.findChild(n, (c) => c?.type === "@namespace")
          const semi = this.findChild(n, (c) => c?.type === ";")
          const start = kwNode ? kwNode.endIndex - n.startIndex : "@namespace".length
          const end = semi ? semi.startIndex - n.startIndex : n.text.length
          const prelude = end <= start ? "" : collapseWhitespace(n.text.slice(start, end))
          if (prefix && prelude) ctx.namespacePrefixes[prefix] = `@namespace ${prelude}`
        }
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const c = n.namedChild(i)
        if (c) stack.push(c)
      }
    }
  }

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

  /**
   * Families declared by an `@font-face` in this file, collected BEFORE the walk for
   * the same reason `collectKeyframeNames` runs first: a rule may use a family
   * before the `@font-face` that declares it, and CSS does not care about order, so
   * an edge that resolved during the walk would depend on where the author happened
   * to put the declaration.
   */
  /**
   * `@counter-style`, `@custom-media` and `@font-feature-values` are the last three
   * at-rules that DECLARE a named, referable thing, and until now all three were
   * dropped on the floor: the analyzer published no symbol for them, so a
   * `list-style: thumbs` had nothing to point at and a `@media (--narrow)` named
   * itself by raw text. That is the `@font-face` / `@property` defect class a
   * second time — and it survived because NO CORPUS FILE USES ANY OF THE THREE, so
   * they were classified NO OCCURRENCE and recorded as "not a defect". That is the
   * cost of that label: it means the corpus cannot speak about them, not that they
   * work. Three of three turned out to be broken.
   *
   * Pre-collected for the same order-independence reason as keyframes and font
   * faces: CSS does not care whether a use precedes its declaration.
   */
  private collectCustomDefinitionNames(root: Node, ctx: CssContext): void {
    const stack: Node[] = [root]
    while (stack.length > 0) {
      const n = stack.pop() as Node
      if (this.isErrorNode(n)) continue
      if (n.type === "at_rule") {
        const kwNode = this.findChild(n, (c) => c?.type === "at_keyword")
        const keyword = kwNode ? kwNode.text.trim().toLowerCase() : ""
        const prelude = this.atRulePrelude(n, keyword)
        if (keyword === "@counter-style" && prelude) ctx.counterStyleNames[prelude] = true
        // `@custom-media --narrow (max-width: 400px)` declares `--narrow`; the
        // condition is the VALUE of the declaration, not part of its name, so the
        // prelude is sliced to its leading custom-ident. The published symbol uses
        // the same slice, so the two cannot name different things.
        else if (keyword === "@custom-media") {
          const name = leadingCustomIdent(prelude)
          if (name) ctx.customMediaNames[name] = true
        } else if (keyword === "@font-feature-values" && prelude) {
          ctx.fontFeatureValuesNames[prelude] = true
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) stack.push(c)
      }
    }
  }

  private collectFontFaceNames(root: Node, ctx: CssContext): void {
    const stack: Node[] = [root]
    while (stack.length > 0) {
      const n = stack.pop() as Node
      if (this.isErrorNode(n)) continue
      if (n.type === "at_rule") {
        const kw = this.findChild(n, (c) => c?.type === "at_keyword")
        if (kw && kw.text.trim() === "@font-face") {
          // The declaration lives inside the `block` child, so finding it is a
          // DESCENDANT search. The first version looked for a `property_name`
          // among the at-rule's DIRECT children, which finds nothing for the same
          // reason the symbol-naming code above says it must not — `@font-face` has
          // an empty prelude and everything it declares is inside the block.
          const block = this.findChild(n, (c) => c?.type === "block")
          const decl = block ? this.findDescendant(block, (d) => {
            if (d.type !== "declaration") return false
            const prop = this.findChild(d, (g) => g?.type === "property_name")
            return prop !== null && prop.text.trim().toLowerCase() === "font-family"
          }) : null
          if (decl) {
            const value = this.findChild(decl, (c) => c?.type === "string_value" || c?.type === "plain_value" || c?.type === "identifier")
            if (value) ctx.fontFaceNames[stripAllQuotes(value.text.trim())] = true
          }
        }
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
    if (!nameNode) return
    const name = stripAllQuotes(nameNode.text)
    ctx.symbols.push({
      name: name,
      kind: ASTEngine.SymbolKind.Function,
      range: this.nodeToRange(node),
      scope: "",
      visibility: "public",
      complexity: 1 + this.countKeyframeStops(node),
      metadata: {
        isKeyframes: true,
        // (the stop-count complexity is set on the symbol above)
      },
    })
    ctx.keyframeNames[name] = true
    ctx.patterns["CSS Animations"] = true
    // The at-keyword this block was written under. The grammar's
    // `keyframes_statement` opens with the ANONYMOUS `@keyframes` token OR with an
    // `at_keyword` aliased from /@[-a-z]+keyframes/ (grammar.js:114-121), so the
    // vendor prefix exists only on the `at_keyword` child and the default is the
    // unprefixed keyword. Read from the tree rather than from the node text so a
    // second spelling of the same prefix cannot split into two answers.
    const keywordNode = this.findChild(node, (c) => c?.type === "at_keyword")
    const keyword = keywordNode ? keywordNode.text.trim().toLowerCase() : "@keyframes"
    this.recordKeyframesOverride(ctx, name, keyword, this.lineOf(node))
  }

  /**
   * M14 ONTOLOGY, `overrides` — CSS's only inheritance-like construct, and the one the
   * lane was silently omitting.
   *
   * ## What the construct is
   *
   * CSS Animations L1 §3: "If multiple `@keyframes` rules with the same name are
   * declared, the last one wins." The Properties & Values API says the same for a
   * re-registered `@property --x`. So a second declaration of a name REPLACES the
   * first, wholly — the earlier block becomes dead code. This is the same shape the
   * gate's own header records for bash's 174 redefinition events, and the reason the
   * differential could not find it here: `deriveCssEdges` derives `contains`, `uses`,
   * `references` and `imports`, and both walkers said nothing about `overrides`.
   *
   * ## What the corpus says, and the number that changed the design
   *
   * `validation/m14/census/css-overrides-split.ts` over the whole admitted corpus
   * (1,114 files, 61 repos) found **146 second declarations of an already-declared
   * `@keyframes` name in one file** — and **142 of them are a vendor-prefixed pair**,
   * overwhelmingly Font Awesome's `@-webkit-keyframes fa-spin` / `@keyframes fa-spin`.
   * A prefixed pair is not a redeclaration: two animations, selected by support. An
   * `overrides` edge for each would have been a fabrication over 97.3% of the type, on
   * the strength of an aggregate count.
   *
   * The remaining **4** are the real thing: `hasura-engine/frontend/libs/console/
   * legacy-ce/src/lib/components/Services/ApiExplorer/GraphiQLWrapper/GraphiQL.css`
   * (`@keyframes rotation` at L1534 and again at L2214) and three in
   * `vue-element-admin/src/assets/custom-theme/index.css` (`v-modal-in`, `v-modal-out`,
   * `progress`). Four occurrences in 1,114 files is a thin census and it is reported as
   * one — but "four" is not "none", and a ruling of `overrides` that said the construct
   * does not occur would be false by exactly those four.
   *
   * THE AGGREGATE ALSO NEEDS A CORRECTION, and the correction is about the instrument
   * rather than the language. The first version of the split probe bucketed a whole
   * NAME-GROUP by whether the group mentioned more than one keyword, so `v-modal-in`
   * — spelled three times, once prefixed and twice not — was filed under
   * "cross-keyword" on the strength of its first pair and its genuine redefinition was
   * never counted. It reported 1 where the truth is 4. The rule that decides this is
   * adjacency, because CSS Animations L1 §3 makes the LAST declaration the live one, so
   * a declaration is compared against the one it replaces and not against its whole
   * group. `validation/m14/census/css-overrides-split.ts` now counts adjacent pairs and
   * agrees with the production census at 4.
   *
   * `@property` re-registration is counted at **0** occurrences, because the corpus
   * cannot speak about it. It is implemented anyway and pinned by a fixture, which is
   * this lane's standing answer to a construct the corpus does not exercise (see the
   * `@counter-style` / `@custom-media` / `@font-feature-values` note in
   * `collectCustomDefinitionNames`): a measured zero means the corpus is silent, not
   * that the branch is wrong.
   *
   * ## Why `source === target`, stated rather than hidden
   *
   * The overriding declaration and the overridden one have the SAME NAME, and this
   * lane publishes ONE symbol per name — the merge at the end of `analyze` is keyed
   * `(kind, name)` and deliberately so, because "a selector is a MATCH PATTERN, not a
   * declaration" and the same reasoning makes two `@keyframes spin` blocks two
   * occurrences of one node. So the edge's two ends are the same string, and what
   * distinguishes them is the SITE: `line_number` is the superseding declaration's
   * line and `metadata.supersedesLine` is the declaration it kills.
   *
   * That is the shape `real-markdown-analyzer.ts:142` already guards for rather than
   * forbids — `if (source === target && !distinctSites) return`, whose own comment is
   * "The two ends name DIFFERENT sites even when they spell the same string". The two
   * declarations here are two blocks of source text on two lines, so they are two
   * sites by any reading, and `distinctSites: true` is recorded in the metadata
   * rather than left for a reader to infer.
   *
   * The line is also load-bearing for STORAGE, not only for meaning: a relationship's
   * store key is (source, type, target, line) — M59 #822, which markdown's own
   * comment records — so an edge without the superseding line would collide with any
   * other `spin -> spin` edge in the file and `INSERT OR IGNORE` would keep one.
   *
   * ## Confidence
   *
   * 1.0. This is not a name-match guess: both ends are read from two `@keyframes`
   * nodes, the equality test is on the tree's own keyframes-name node, and the
   * keyword discriminator is the tree's own `at_keyword`. There is no inference in it
   * to be uncertain about.
   */
  private recordKeyframesOverride(
    ctx: CssContext,
    name: string,
    keyword: string,
    line: number | undefined,
  ): void {
    if (!name || !line) return
    const live = ctx.keyframeLive[name]
    if (live === undefined) {
      ctx.keyframeLive[name] = { keyword, line }
      return
    }
    // A DIFFERENT KEYWORD is a different animation, not a redeclaration of this one.
    // This is 142 of the 146 same-name second declarations in the corpus, and the
    // reason the discriminator is carried at all.
    if (live.keyword === keyword) {
      this.emitOverride(ctx, name, line, live.line, {
        isKeyframesRedefinition: true,
        atKeyword: keyword,
      })
    }
    // Either way the block just read becomes the live one, so a third declaration
    // supersedes the second rather than the first.
    ctx.keyframeLive[name] = { keyword, line }
  }

  /**
   * `@property --x` written twice is the same last-wins replacement
   * (`recordKeyframesOverride`'s rule, from the Properties & Values API rather than
   * from CSS Animations). Measured at 0 occurrences over 1,114 corpus files, which is
   * a fact about the corpus and not about the construct — so it is pinned by a fixture
   * instead of being dropped for want of evidence.
   */
  private recordPropertyOverride(ctx: CssContext, name: string, line: number | undefined): void {
    if (!name || !line) return
    const prior = ctx.propertyLive[name]
    if (prior !== undefined) {
      this.emitOverride(ctx, name, line, prior, { isPropertyReregistration: true })
    }
    ctx.propertyLive[name] = line
  }

  /**
   * M14 ONTOLOGY PASS 2, `overrides` — a `--custom-property` assigned TWICE inside ONE
   * declaration block. Found by the pass-2 adversarial probe, not by reading: see
   * `validation/m14/census/css-boundary-probe.ts` (Q3), which counts the shape on the
   * parse tree of the whole admitted corpus.
   *
   * ## Why this is the same construct `@keyframes` already gets
   *
   * Two declarations of one property inside one block share origin, context, layer,
   * specificity and importance, so nothing about them distinguishes them except their
   * position, and CSS Cascade 5 §6.1 resolves that: "The last declaration in document
   * order wins." CSS Variables 1 §2 adds that custom properties are not special here —
   * "Custom properties are ordinary properties, so they can be declared on any element,
   * are resolved with the normal inheritance and cascade rules." So the second
   * assignment REPLACES the first outright and the first is dead, which is exactly what
   * `recordKeyframesOverride` asserts for a second `@keyframes` of one name.
   *
   * The corpus shape is Bulma's minified bundles, where `:root { --bulma-light-l: 90%;
   * … ; --bulma-light-l: 96%; … }` writes the same token twice inside one block.
   *
   * ## The block boundary is load-bearing, and narrower than it looks
   *
   * Only declarations in the SAME block produce an edge. `:root { --x: 1 }` followed by
   * `.dark { --x: 2 }` assigns `--x` twice in one FILE and is NOT an override: the two
   * apply to different elements and the cascade chooses between them per element, so an
   * edge claiming the second kills the first would be false. The block is therefore the
   * unit, tracked by `customPropBlockKey`, and the corpus's much larger
   * cross-block-assignment shape (which the same probe counts) is deliberately not
   * emitted. The rule is stated here because the boundary is the whole content of the
   * claim: "the last one wins" is only unconditional inside one block.
   *
   * ## `!important` is respected
   *
   * `--x: 1 !important; --x: 2;` does NOT replace — the important declaration wins and
   * the later one loses. Cascade 5 §6.1 sorts importance above document order, so the
   * two are not interchangeable and an edge between them would be backwards. Only a pair
   * of EQUAL importance is emitted, which is the only case where "later wins" is the
   * whole rule. Measured on the corpus: every occurrence is an equal-importance pair, so
   * this guard costs nothing there and is recorded because a guard that costs nothing is
   * indistinguishable from a guard that was never needed.
   */
  private recordCustomPropertyOverride(node: Node, name: string, ctx: CssContext): void {
    const line = this.lineOf(node)
    if (!name || !line) return
    // The enclosing declaration block. A `rule_set` and a `keyframe_block` are the two
    // node types that ARE a declaration list; `@media`/`@supports`/`@layer` bodies are
    // `rule_set`s and are visited on their own, so walking up to the nearest of the two
    // is what makes "same block" mean "same block" rather than "same subtree".
    let block: Node | null = node.parent
    let key = `decl@${node.startIndex}`
    while (block) {
      if (block.type === "rule_set" || block.type === "keyframe_block") {
        key = `${block.type}@${block.startIndex}`
        break
      }
      block = block.parent
    }
    if (ctx.customPropBlockKey !== key) {
      ctx.customPropBlockKey = key
      ctx.customPropInBlock = {}
    }
    const important = node.text.indexOf("!important") !== -1
    const prior = ctx.customPropInBlock[name]
    if (prior && prior.important === important) {
      this.emitOverride(ctx, name, line, prior.line, {
        isCustomPropertyRedefinition: true,
        blockSelector: key,
      })
    }
    ctx.customPropInBlock[name] = { line, important }
  }

  private emitOverride(
    ctx: CssContext,
    name: string,
    laterLine: number,
    priorLine: number,
    extra: Record<string, unknown>,
  ): void {
    const key = `${name}\u0000${laterLine}`
    if (ctx.overrideEdges[key]) return
    ctx.overrideEdges[key] = true
    ctx.relationships.push({
      source: name,
      target: name,
      type: ASTEngine.RelationshipType.Overrides,
      // M59.A7: the name on this edge is the `@keyframes` name, and it is written on
      // BOTH lines — the superseding one first, because that is the declaration the
      // edge is about and the one a reader navigates to.
      line_number: laterLine,
      confidence: 1.0,
      metadata: {
        cssSpecific: true,
        isOverride: true,
        redefinition: true,
        // The declaration this one kills. Carried explicitly so a consumer does not
        // have to diff the file to find out WHICH earlier block died.
        supersedesLine: priorLine,
        // See the header: the two ends are two SITES, not one name twice.
        distinctSites: true,
        ...extra,
      },
    })
  }

  private processSupports(node: Node, ctx: CssContext): string | null {
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
        complexity: this.queryComplexity(condition),
        metadata: {
          isSupports: true,
          supportsCondition: condition,
        },
      })
      ctx.patterns["Feature Queries (@supports)"] = true
      // RETURNED so the walk can attribute the rules inside to this scope. It used
      // to return nothing, which is the whole defect: the scope symbol was
      // published and nothing could ever point at it.
      return `@supports ${condition}`
    }
    return null
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
    // would be a name with no referent. Nothing in CSS can NAME any of the three
    // — no `var()`, no `@layer` that points at one, no query that resolves it — so
    // a `contains` edge sourced from one would have to name a node that cannot
    // exist. The rules inside them are still symbolized; what is dropped is the
    // attribution.
    //
    // The ruling is CSS-D9 in script/m14/spec/css-completeness.json. It is NOT a
    // per-type entry in that file's `internal_silent` list, and cannot be: these
    // three are not node types in this grammar. `@starting-style` reaches the
    // analyzer as a generic `at_keyword` under `at_rule`, so enumerating the
    // grammar's 151 ids never produces them. An earlier version of this comment
    // pointed at a "recorded as silent with that reason" entry that did not
    // exist, which is the kind of citation that quietly rots.
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
      // the three that were silently dropped: each DECLARES a named, referable
      // thing, so each belongs here. Measured, not assumed — a probe of all three
      // returned zero symbols before this line and the fixtures pin them now.
      "@counter-style", "@custom-media", "@font-feature-values",
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
          // the published name comes from ONE expression, shared with the `uses`
          // edge, so the symbol and the edge can never name different things
          void namePartOverride
        }
      }

      const afterKeyword = node.text.slice(keyword.length)
      const braceAt = afterKeyword.indexOf("{")
      const semiAt = afterKeyword.indexOf(";")
      let cut = afterKeyword.length
      if (braceAt !== -1) cut = braceAt
      if (semiAt !== -1 && semiAt < cut) cut = semiAt
      const namePart = namePartOverride || stripAllQuotes(collapseWhitespace(afterKeyword.slice(0, cut)))
      const ruleName =
        keyword === "@font-face" && namePart ? this.fontFaceSymbolName(namePart) : `${keyword}${namePart ? " " + namePart : ""}`

      // A CONSUMING at-rule gets NO symbol. `@apply flex` is an instruction to a
      // Tailwind build, not a declaration; `@theme` is a block whose custom
      // properties are already published in their own right; `@config` names a
      // file; `@include` is a USE, and the `uses` edge below is the fact.
      // The ORDERING form of `@layer` — `@layer reset, base, components;`, no block.
      //
      // It used to publish ONE symbol named after the whole statement text
      // (`@layer reset, base, components`), which is the placeholder-literal name
      // M60 R7 exists to forbid: nothing can reference that string, so it is a name
      // with no referent — and it DUPLICATED the individually declared layers, so a
      // file carried both `@layer base` and `@layer base, special` for the same
      // layer. Found by the omission audit, and the corpus has the form for real
      // (`@layer theme, base, components, utilities;`).
      //
      // The layers are the symbols — named exactly as the block form names them, so
      // the statement and the declaration agree — and the ORDER is a fact about the
      // file rather than an edge, because it has no container to source from. It
      // rides file metadata instead, which is where a whole-file fact belongs.
      if (keyword === "@layer" && !this.findChild(node, (c) => c?.type === "block")) {
        const names = namePart
          .split(",")
          .map((x) => x.trim())
          .filter((x) => x.length > 0)
        for (const nm of names) {
          ctx.layerOrder.push(nm)
          if (ctx.layerNames[nm]) continue
          ctx.layerNames[nm] = true
          ctx.symbols.push({
            name: `${keyword} ${nm}`,
            kind: ASTEngine.SymbolKind.Module,
            range: this.nodeToRange(node),
            scope: "",
            visibility: "public",
            complexity: 1,
            metadata: {
              isAtRule: true,
              atKeyword: keyword,
              isLayerOrdering: true,
              // The cascade position this statement gives the layer. Per-SYMBOL
              // rather than per-file, and that is not a style choice: `parseFile`
              // rebuilds the file metadata as a fresh literal listing specific keys
              // (engine.ts:1572, whose own comment records that anything it omits is
              // "computed and DISCARDED — silently"), so a file-level key added here
              // would never reach a consumer. Symbol metadata is passed through, and
              // the position is a property of the LAYER anyway.
              layerIndex: ctx.layerOrder.length - 1,
            },
          })
        }
        return {}
      }

      if (DECLARING.has(keyword)) {
        // A REGISTERED custom property is published under the PROPERTY'S OWN NAME.
        //
        // The omission audit (script/m14/tmp/css-omission-audit.ts) found the
        // defect this fixes: `var(--brand)` emits `references body -> --brand`, and
        // the only symbol for `--brand` in the file was `@property --brand`. So the
        // read pointed at a name nothing published — a DANGLING endpoint, in a lane
        // whose whole chain-resolution rule is that both ends must resolve. 273
        // registered properties in 3 corpus files, every read of them dangling.
        //
        // `--brand` is also the right name on its own terms: it is a namespaced CSS
        // name that cannot collide with a class, a type or a scope, and a
        // registration and a rule-level `--brand: …` declare the SAME thing, so
        // publishing them under one name is the point rather than a hazard.
        //
        // `@font-face` KEEPS its keyword prefix (`@font-face Inter`), and the
        // asymmetry is deliberate: a font family is a bare identifier that could
        // collide with a class or a type of the same name, so the keyword says which
        // KIND of thing it is. A `--x` name needs no such help.
        //
        // `@custom-media` is the same shape as `@property`: a namespaced `--x` name
        // plus a value, where only the name is referable. `@property --brand
        // { syntax: … }` drops the keyword and the block; `@custom-media --narrow
        // (max-width: 400px)` drops the keyword and the CONDITION. Both publish the
        // bare ident, so the declaration and the `@media (--narrow)` that uses it
        // meet on one name.
        const publishedName =
          keyword === "@property"
            ? namePart || ruleName
            : keyword === "@custom-media"
              ? // `namePart` is the PRELUDE; `ruleName` is the keyword plus the
                // prelude, so slicing the latter matches nothing and the first
                // version published `@custom-media --narrow (max-width: 400px)` —
                // a name the `@media (--narrow)` can never resolve against.
                leadingCustomIdent(namePart) || ruleName
              : ruleName
        if (keyword === "@layer" && namePart) {
          if (ctx.layerNames[namePart]) {
            // The ORDERING statement got here first (`@layer a, b;` precedes the
            // blocks, which is the normal order), so the existing symbol's range
            // points at the statement. The BLOCK is where the layer's content is, so
            // the range is corrected to it and the symbol marked as having one — one
            // symbol per layer, located where its rules are.
            const existing = ctx.symbols.find((sy) => sy.name === `${keyword} ${namePart}`)
            if (existing) {
              const em = (existing.metadata ?? {}) as Record<string, unknown>
              const blockRange = this.nodeToRange(node)
              if (em.hasLayerBlock !== true) {
                // The FIRST block: the symbol moves onto it, because the ordering
                // statement it replaces declares the layer's ORDER and the block holds
                // its content. That is the pre-existing rule and it is kept.
                existing.range = blockRange
                existing.metadata = { ...em, hasLayerBlock: true, scopeBlocks: 1 }
              } else {
                // A SECOND block of a layer that already had one. The extent has to be
                // the UNION of the blocks, not the latest one — and the reason is that
                // `@layer base` is written four times in
                // `phoenix/installer/templates/phx_static/default.css` (L39, L2294,
                // L2301, L2306). Replacing the range with the last block left every rule
                // of the FIRST block with a `contains` edge pointing at a symbol recorded
                // 2,400 lines below it: `html, :host` at L46, `body` at L55, `hr` at L58,
                // `abbr:where([title])` at L63 and 36 more. Measured before this change:
                // 40 of 505 `isLayerScope` containment edges carried a contained rule
                // outside the source symbol's line range, and 0 of 505 for `@supports`
                // and `@container` — which publish a symbol per OCCURRENCE and are folded
                // by the identity merge instead of deduplicated before publishing.
                existing.range = {
                  ...(existing.range as ASTEngine.UniversalSymbol["range"]),
                  endLine: Math.max(existing.range?.endLine ?? 0, blockRange.endLine),
                }
                const n = typeof em.scopeBlocks === "number" ? em.scopeBlocks : 1
                existing.metadata = { ...em, scopeBlocks: n + 1 }
              }
              ctx.scopeSymbol[`${keyword} ${namePart}`] = existing
            }
            // The SYMBOL is a duplicate — but the SCOPE is not. Returning `{}` here
            // (the first version) silently dropped the layer from the returned
            // scope, so the rules inside the block were attributed to no layer and
            // every `contains` edge for them disappeared: 5 symbols and ZERO
            // relationships. The dedup is about publishing a name once, not about
            // pretending the layer does not exist.
            return { layer: `${keyword} ${namePart}` }
          }
          ctx.layerNames[namePart] = true
        }
        const atRuleSymbol: ASTEngine.UniversalSymbol = {
          name: publishedName,
          // A declared `@font-face` and a registered `@property` are both
          // declarations of a named thing, which is what `variable` means in this
          // ontology; `@mixin` is a callable, so `function`; the rest are
          // structural scopes, which is `module`.
          kind:
            keyword === "@mixin"
              ? ASTEngine.SymbolKind.Function
              : keyword === "@font-face" || keyword === "@property" ||
                  keyword === "@counter-style" || keyword === "@custom-media" ||
                  keyword === "@font-feature-values"
                ? ASTEngine.SymbolKind.Variable
                : ASTEngine.SymbolKind.Module,
          range: this.nodeToRange(node),
          scope: "",
          visibility: "public",
          complexity: 1 + this.countDescriptors(node),
          metadata: {
            isAtRule: true,
            atKeyword: keyword,
            // the keyword is dropped from a `@property` symbol's NAME, so it is
            // recorded here — the declaration is still identifiable as a
            // registration rather than a rule-level declaration
            ...(keyword === "@property" ? { isPropertyRegistration: true } : {}),
            // the three late additions carry which construct declared them, because
            // a `@custom-media` symbol is a BARE `--x` name — identical in shape to
            // a registered `@property` symbol and to a rule-level custom property,
            // so without this the three declarations are indistinguishable in the
            // graph
            ...(keyword === "@counter-style"
              ? { isCounterStyleDeclaration: true }
              : {}),
            ...(keyword === "@custom-media" ? { isCustomMediaDeclaration: true } : {}),
            ...(keyword === "@font-feature-values"
              ? { isFontFeatureValuesDeclaration: true }
              : {}),
            // (the descriptor-count complexity is set on the symbol above)
          },
        }
        ctx.symbols.push(atRuleSymbol)
        // The handle `widenScopeSymbol` needs. Only the STRUCTURAL at-rules are scope
        // symbols with containment edges; a `@font-face` or `@property` is a
        // declaration, and widening one of those would be a different claim.
        if (STRUCTURAL_SCOPE_AT_RULES.has(keyword)) ctx.scopeSymbol[publishedName] = atRuleSymbol

        // `@property --x` twice is a RE-REGISTRATION and the second replaces the first
        // (Properties & Values API). Recorded against `publishedName`, which for a
        // `@property` is the BARE `--x` and not `@property --x` — the same name a
        // `var(--x)` read meets and the name the symbol above is published under, so
        // the edge and the symbol cannot name different things.
        //
        // Inside the DECLARING block rather than beside the mixin bookkeeping below,
        // because `publishedName` is scoped to it and hoisting the name outward would
        // have put a second spelling of it in the file.
        if (keyword === "@property") {
          this.recordPropertyOverride(ctx, publishedName, this.lineOf(node))
        }
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
          // M59.A7: the referenced mixin name is written in the `@include`
          // prelude, on the at-rule's own line. (The relation stays `uses` — a
          // mixin reference is a USE. An edit here briefly changed it to
          // `contains` on the theory that the mixin is "contained" in the rule;
          // that is a different claim and a wrong one, and it is reverted.)
          line_number: this.lineOf(node),
          metadata: { cssSpecific: true, isMixinRef: true, isDeclaredLocally: ctx.mixinNames[namePart] === true },
        })
      }

      if ((keyword === "@use" || keyword === "@forward") && namePart) {
        // A Sass module import, which is what `@import` is for CSS: a
        // compile-time dependency on another file.
        ctx.relationships.push({
          source: this.importerName,
          target: stripAllQuotes(firstToken(namePart)),
          type: ASTEngine.RelationshipType.Imports,
          // M59.A7: the module name is the at-rule's prelude, on its own line.
          line_number: this.lineOf(node),
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
          // M59.A7: the name is the composed class, so the line is the VALUE
          // node it is written on — not the `composes` property, which is a
          // different name on the same declaration.
          line_number: this.lineOf(val),
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
        complexity: this.customPropertyComplexity(node),
        metadata: {
          isCustomProperty: true,
          // (the var()-read complexity is set on the symbol above)
        },
      })
// contains for the custom property scoped to its selector — emitted
      // here (not by the post-loop) to avoid double-emission with nested
      // selector contains.
      if (currentSelector) {
        ctx.relationships.push({
          source: currentSelector,
          target: propName,
          type: ASTEngine.RelationshipType.Contains,
          // M59.A7: the name is the custom property, so the line is its
          // `property_name` node — NOT the `declaration`, which can open on
          // an earlier line (a leading comment inside the block, or a declaration
          // written across lines).
          line_number: this.lineOf(propNode),
          confidence: 1.0,
          metadata: { cssSpecific: true, isCustomPropertyScope: true },
        })
      }
      this.recordCustomPropertyOverride(node, propName, ctx)
      // Reached only by `--`, so the pattern test needs no prefix guard.
      ctx.patterns["CSS Custom Properties"] = true
    }

    // A `font-family` that names a family this file DECLARES with `@font-face` is
    // a USE of that declaration — the exact analogue of `animation: spin` naming a
    // `@keyframes spin`, which has been emitted since the order-dependence fix.
    //
    // Found by the omission audit: 135 corpus files declare a `font-family` and 21
    // declare an `@font-face`, 344 family symbols were published, and NOTHING
    // connected a rule that uses a family to the declaration that provides it. So
    // the graph could answer "which rules use Inter" and "where is Inter declared"
    // but not "which rule uses the Inter this file declares" — the one question
    // both halves exist to answer. The asymmetry was historical: the animation path
    // was built, this one never was.
    //
    // Only families the file DECLARES become edges, for the same reason animations
    // only name declared keyframes: a `font-family` may legitimately come from
    // another stylesheet, and inventing an endpoint for it is the `global` phantom
    // this lane removed once.
    // `list-style: thumbs` / `list-style-type: thumbs` is a USE of the
    // `@counter-style thumbs` this file declares — the same shape as
    // `animation: spin` naming a `@keyframes spin`, and for the same reason it
    // was missing: the construct had no corpus file, so it was never measured.
    //
    // `list-style` is a SHORTHAND, so the name can appear under either the
    // shorthand or the longhand; both are checked because a file that spells it
    // one way and another the other way is the normal case, not the exotic one.
    if ((propName === "list-style" || propName === "list-style-type") && currentSelector) {
      const nameStack = [node]
      while (nameStack.length > 0) {
        const n = nameStack.pop()!
        if (n.type === "plain_value" || n.type === "identifier" || n.type === "string_value") {
          const style = n.text.trim()
          if (style.length > 0 && ctx.counterStyleNames[style]) {
            ctx.relationships.push({
              source: currentSelector,
              target: `@counter-style ${style}`,
              type: ASTEngine.RelationshipType.Uses,
              line_number: this.lineOf(n),
              metadata: { cssSpecific: true, isCounterStyleRef: true },
            })
          }
        }
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c) nameStack.push(c)
        }
      }
    }

    // `font-feature-settings: "nice"` inside a `@font-face` for `Font One` is a
    // USE of the `@font-feature-values Font One` block that defines the feature.
    // It is the last of the three dropped at-rules to get its use edge.
    //
    // The family comes from the ENCLOSING `@font-face`, because that is where CSS
    // binds the feature name: a feature setting only means anything against the
    // family it is declared for. Without the family the edge would have to target
    // the bare feature name, which nothing publishes.
    if (propName === "font-feature-settings") {
      const enclosing = this.fontFamilyOf(node)
      // Deliberately NOT `&& currentSelector`: a `@font-face` block has no
      // selector, so the first version guarded on one and never fired — the same
      // guard that is right for `list-style` and wrong here, because the entity
      // that uses a feature is the FACE DECLARATION, not a rule.
      //
      // Also deliberately NOT extended to a rule-level
      // `.x { font-feature-settings: "nice" }`, which is legal CSS. Which family's
      // feature that names depends on the cascade — the family `font-family`
      // resolves to for that element — and guessing it would invent an endpoint
      // for a relationship this lane cannot actually see. A missing edge that is
      // declared beats a wrong edge that is not.
      if (enclosing && ctx.fontFeatureValuesNames[enclosing]) {
        const valueStack = [node]
        while (valueStack.length > 0) {
          const n = valueStack.pop()!
          if (n.type === "string_value" || n.type === "plain_value") {
            ctx.relationships.push({
              source: this.fontFaceSymbolName(enclosing),
              target: `@font-feature-values ${enclosing}`,
              type: ASTEngine.RelationshipType.Uses,
              line_number: this.lineOf(n),
              metadata: { cssSpecific: true, isFontFeatureValuesRef: true },
            })
          }
          for (let i = 0; i < n.namedChildCount; i++) {
            const c = n.namedChild(i)
            if (c) valueStack.push(c)
          }
        }
      }
    }

    if (propName === "font-family" && currentSelector) {
      const famStack = [node]
      while (famStack.length > 0) {
        const n = famStack.pop()!
        if (n.type === "plain_value" || n.type === "identifier" || n.type === "string_value") {
          const family = stripAllQuotes(n.text.trim())
          if (family.length > 0 && ctx.fontFaceNames[family]) {
            ctx.relationships.push({
              source: currentSelector,
              // The edge names the DECLARATION, which is the published symbol — not
              // the bare family, which nothing publishes. A resolvable endpoint, and
              // the same both-ends-must-resolve rule the chain edges follow.
              target: this.fontFaceSymbolName(family),
              type: ASTEngine.RelationshipType.Uses,
              // M59.A7, the same rule as the animation edge: the name is the FAMILY
              // as written in the value, so the line is the value's line — not the
              // `font-family` property's, and for a fallback list
              // (`"Inter", sans-serif`) the specific family that matched rather
              // than the first token on the line.
              line_number: this.lineOf(n),
              metadata: { cssSpecific: true, isFontFamilyRef: true },
            })
          }
        }
        for (let i = n.namedChildCount - 1; i >= 0; i--) {
          const child = n.namedChild(i)
          if (child) famStack.push(child)
        }
      }
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
              // M59.A7: the name is the KEYFRAMES name, which is written in the
              // VALUE — not the `animation` property, which is a different name
              // and, for the shorthand, shares its line with the duration and
              // easing. Taking the value node is what makes the edge point at the
              // line a reader would call the reference.
              line_number: this.lineOf(n),
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
              // M59.A7: the name is the custom property INSIDE `var()`, so the
              // line is that argument node. The `call_expression` starts at its
              // receiver's position, which for `calc(var(--x) * 2)` is the
              // `calc` — a different line whenever the value wraps.
              line_number: this.lineOf(n),
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

    // The file's cyclomatic complexity, measured rather than declared. It is the
    // deepest single selector's cost plus the stylesheet's deepest nesting, so a
    // flat reset sheet scores 1 and a four-level nest with functional pseudo-
    // classes scores high — which is the distinction the previous literal 1 could
    // not make, and the reason CC1's `complexity >= 1` was vacuous here.
    const complexity = Math.max(
      1,
      (ctx.fileMaxSelectorComplexity ?? 0) + (ctx.fileNestingDepth ?? 0),
    )

    return {
      complexity,
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
