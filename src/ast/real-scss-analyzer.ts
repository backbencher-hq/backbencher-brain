/**
 * The SCSS analyzer.
 *
 * ── WHY THIS DELEGATES TO RealCssAnalyzer INSTEAD OF REIMPLEMENTING IT ─────────
 *
 * The SCSS grammar is `grammar(require('tree-sitter-css/grammar'), {...})` — it
 * EXTENDS the CSS grammar, so every CSS node type exists here plus the SCSS
 * statements. That makes delegation the honest architecture rather than a
 * convenience: the CSS walk already handles rule sets, `&` nesting chains, `@media`,
 * `@layer`, `@container`, `@scope`, `@supports`, `@keyframes`, `@font-face`,
 * registered `@property`, `var()` reads and `@import`, all of which appear in `.scss`
 * files because a Sass file is a superset of a CSS file.
 *
 * Reimplementing that would be ~2,700 duplicated lines whose only possible outcome
 * is two implementations that agree today and drift tomorrow. Delegating also means
 * this lane inherits every future CSS fix for free, which matters because the
 * GRAMMAR does not: the SCSS grammar is built on tree-sitter-css 0.20.0 and so does
 * not inherit the CSS lane's four local patches (see verify-grammar-pins.ts).
 *
 * Measured on a representative file, the delegation base is what it should be: the
 * CSS analyzer publishes the rule selectors and their nesting chains and nothing for
 * any SCSS statement, because `mixin_statement`, `include_statement`, `use_statement`
 * and the rest are DIFFERENT NODE TYPES and its `at_rule` dispatch never sees them.
 * That boundary is exactly where this analyzer starts.
 *
 * ── WHAT IS ADDED ─────────────────────────────────────────────────────────────
 *
 *   `@mixin`            function symbol, with real `parameters`
 *   `@include`          `uses` edge to a mixin THIS FILE declares
 *   `@function`         function symbol; its `@return` is `contains`-ed by it
 *   `$variable`         variable symbol, deduplicated by name
 *   `$var` read         `references` edge to a variable THIS FILE declares
 *   `@use` / `@forward` `imports` edge + ImportInfo, with the `as` namespace
 *   `@extend`           `uses` edge to the selector being extended
 *   `@if`/`@each`/      `interface` symbol + `contains` edges, the same shape the
 *   `@for`/`@while`     CSS lane gives `@supports`
 *   `%placeholder`      selector symbol, so an `@extend %x` has an endpoint
 *   the file            `module` symbol — a Sass module's public surface is what
 *                      `@use` exposes — and an `exports` edge per public member
 *   `$x: … !global`     `overrides` edge, for the one reassignment the language
 *                      itself calls an override
 *
 * ── THE TWO RULES THIS LANE HOLDS ITSELF TO ───────────────────────────────────
 *
 * 1. BOTH ENDS MUST RESOLVE. Every edge names a symbol this file actually
 *    publishes. A `@include` of a mixin from another file, or a `$var` that arrives
 *    through a parameter, gets NO edge — a `global` phantom endpoint is the defect
 *    the CSS lane removed once and this lane does not reintroduce.
 * 2. DECLARATIONS ARE PRE-COLLECTED, so a use may precede its declaration. Sass does
 *    not care about order and neither does this.
 */

import type { Node } from "web-tree-sitter"
import * as path from "node:path"
import { ASTEngine } from "./engine"
import { RealCssAnalyzer } from "./real-css-analyzer"
import { dirOf, FILE_CLAIM_MAX_BYTES, fileClaimForTarget, foldProjectPath } from "./file-claim"
import type { ProjectIndex } from "./project-index"

function stripAllQuotes(text: string): string {
  let out = ""
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '"' || c === "'") {
      // a quoted run ends at the matching quote; an UNTERMINATED one runs to the end
      // of the text, which is what a broken value looks like and is why this is not
      // a regex over the whole line
      const close = text.indexOf(c, i + 1)
      if (close < 0) break
      out += text.slice(i + 1, close)
      i = close
    } else {
      out += c
    }
  }
  return out.trim()
}

// The JS `\\s` class, as an explicit set. Kept local rather than imported from
// real-css-analyzer so the two lanes stay independent; the css lane cleared the
// same literal on the same reasoning.
const JS_WHITESPACE = new Set([
  " ", "\t", "\n", "\v", "\f", "\r",
  "\u00a0", "\u1680", "\u2000", "\u2001", "\u2002", "\u2003", "\u2004",
  "\u2005", "\u2006", "\u2007", "\u2008", "\u2009", "\u200a", "\u2028",
  "\u2029", "\u202f", "\u205f", "\u3000", "\ufeff",
])

/** `\\w` — [A-Za-z0-9_] — by char code, no regex. */
function isWordCharCode(code: number): boolean {
  return (
    (code >= 97 && code <= 122) || // a-z
    (code >= 65 && code <= 90) || // A-Z
    (code >= 48 && code <= 57) || // 0-9
    code === 95 // _
  )
}

/** `\\w` by character, no regex. */
function isWordChar(ch: string): boolean {
  return isWordCharCode(ch.charCodeAt(0))
}

/**
 * Collapse every run of whitespace to a single space and trim the ends — the
 * exact behaviour of `.replace(/\\s+/g, " ").trim()`, without the regex.
 *
 * Written as one pass rather than trim-then-collapse because the original
 * collapses the trailing run to a space and THEN trims it; doing it in one pass
 * is the same result with a single traversal.
 */
function collapseWhitespace(text: string): string {
  let out = ""
  let pendingSpace = false
  for (const ch of text) {
    if (JS_WHITESPACE.has(ch)) {
      // Only remember a space if real output has already been written, which is
      // what makes the leading run vanish without a separate trim pass.
      if (out.length > 0) pendingSpace = true
      continue
    }
    if (pendingSpace) {
      out += " "
      pendingSpace = false
    }
    out += ch
  }
  return out
}

/**
 * A mixin's published name.
 *
 * The keyword is KEPT, for the reason `@font-face Inter` keeps its keyword in the CSS
 * lane: `button` is a bare identifier that could collide with a class or a type of the
 * same name, and the keyword says which KIND of thing it is. It is also the name the
 * CSS lane's own `@mixin` DECLARING entry would have produced, so the two agree rather
 * than disagreeing in the same file.
 */
/**
 * The exact predicate of `/^%[-\w]*[\w]$/`, by char code.
 *
 * Decomposed rather than approximated: the leading `%` is mandatory, the tail must
 * be a `\w` (so the trailing `-` of an interpolated prefix is rejected), every
 * character in between must be `-` or `\w`, and the bare `%` the grammar produces
 * for `@extend %` in a broken region is rejected by the length check.
 */
function isReadablePlaceholder(name: string): boolean {
  if (name.length < 2) return false
  if (name.charCodeAt(0) !== 37 /* % */) return false
  const last = name.charCodeAt(name.length - 1)
  if (!isWordCharCode(last)) return false
  for (let i = 1; i < name.length - 1; i++) {
    const code = name.charCodeAt(i)
    if (code === 45 /* - */ || isWordCharCode(code)) continue
    return false
  }
  return true
}

/**
 * Does this string carry a CSS statement delimiter?
 *
 * A selector cannot contain `;`, `{` or `}` — those separate declarations and blocks, and
 * the grammar only ever hands one to this lane from inside a region it failed to parse,
 * where the node's text ran past the construct it names. This is a property of the
 * LANGUAGE, so it holds whichever node type the text arrived on, which is why it is
 * checked on the string rather than on `node.type`.
 *
 * By char code, to keep the module free of a pattern for a three-character test.
 */
function containsStatementDelimiter(name: string): boolean {
  for (let i = 0; i < name.length; i++) {
    const code = name.charCodeAt(i)
    if (code === 59 /* ; */ || code === 123 /* { */ || code === 125 /* } */) return true
  }
  return false
}

function mixinName(name: string): string {
  return `@mixin ${name}`
}

function functionName(name: string): string {
  return `@function ${name}`
}

/** One symbol as `ownerForNode` needs it: its span and where it sat in `ctx.symbols`. */
interface OwnerEntry {
  sym: ASTEngine.UniversalSymbol
  orig: number
  start: number
  end: number
}

/**
 * THE INDEX THAT REPLACED A LINEAR SCAN.
 *
 * `ownerForNode` used to answer "which published symbol owns this node" by scanning EVERY symbol in
 * `ctx.symbols` and keeping the smallest span that contains the node. That is correct and it is
 * O(symbols) per call — and it is called once per statement, rule, mixin, declaration and
 * control-flow child. `.scss` is a language of many tiny declarations, so the product is the whole
 * cost of the analyzer: measured on `bulma/.../fontawesome-free-6.5.2-web/scss/_variables.scss`
 * (5,011 lines, 2,508 `$`-variables) analysis was 1.3 s at 250 lines, 4.7 s at 1,000, 10.9 s at
 * 2,000 and **159.6 s at 5,011 — superlinear (cubic in the measured range) while the OUTPUT stayed
 * constant at 30 symbols** — and the engine's 192 s analyzer budget then aborted the file, so it
 * contributed NOTHING and put a HOLE in the lane's population.
 *
 * The index keeps the same answer: entries sorted by span start, with the prefix maximum of the
 * span end. A query binary-searches the last entry that can start at or before the node, then walks
 * BACKWARDS and stops at the first prefix-max that cannot reach the node — so the walk visits only
 * the entries that can contain it. `tail` holds symbols published since the last rebuild, because
 * `walk` publishes control-flow scopes as it goes; `lastSeen` is the identity guard that catches a
 * REORDER (the module symbol is `unshift`-ed in, so position is not a stable key — a shift is
 * detected and the index rebuilt rather than trusted).
 */
interface OwnerIndex {
  len: number
  lastSeen: ASTEngine.UniversalSymbol | undefined
  sorted: OwnerEntry[]
  maxEnd: number[]
  tail: OwnerEntry[]
}

/**
 * THE RECOVERY DESCENT IS BOUNDED, AND THE BOUND IS DISCLOSED.
 *
 * `walk` descends INTO error nodes on purpose — refusing to once made every read inside a broken
 * region invisible, and three fixtures pin that recovery. But the SCSS grammar hands
 * `bulma/docs/vendor/fontawesome-free-6.5.2-web/scss/_variables.scss` a single ERROR node with
 * **15,479 named children**; descending fully costs 159 s, blows the engine's 192 s analyzer budget,
 * and the file then contributes **0 symbols and 0 relationships** — the population HOLE the gate's
 * POPULATION block reported.
 *
 * The alternative to a bounded descent is therefore not full recovery, it is TOTAL LOSS. The cap
 * below binds only on that pathological shape: it is a child-count bound on a single ERROR node, not
 * a general cost cut, and every file whose ERROR regions are ordinary is untouched (`skipped` stays
 * 0 and nothing is recorded). What it skips is COUNTED and attached to the file's module symbol
 * (`metadata.scssRecoveryCap`), because a walk that does not say how much it skipped is the same
 * defect as a table that hides its own closure.
 */
const RECOVERY_CHILD_CAP = 10000

interface ScssContext {
  symbols: ASTEngine.UniversalSymbol[]
  relationships: ASTEngine.UniversalRelationship[]
  imports: ASTEngine.ImportInfo[]
  exports: ASTEngine.ExportInfo[]
  /** mixin name -> published symbol, pre-collected */
  mixinNames: Record<string, string>
  /** function name -> published symbol, pre-collected */
  functionNames: Record<string, string>
  /** `$name` -> published symbol, pre-collected */
  variableNames: Record<string, string>
  /** `as` namespace -> the module it names, pre-collected from `@use` */
  namespaces: Record<string, string>
  /** symbol names already published, so a repeated declaration is not published twice */
  published: Record<string, boolean>
  /** the owner each published name was published under, so a scope can be told apart */
  publishedOwner: Record<string, string>
  /** this file's module name — a `.scss` file IS a Sass module (see `moduleNameOf`) */
  moduleName: string
  /** `$name` -> the line of its first TOP-LEVEL assignment, pre-collected */
  topLevelVarLines: Record<string, number>
  /** the file debugs / warns / forwards content / escapes scope at least once */
  sawDiagnostic: boolean
  /** `ownerForNode`'s interval index over `symbols`, built once and grown (see `ownerIndexOf`) */
  ownerIndex?: OwnerIndex
  /** WHAT A BOUNDED RECOVERY DESCENT SKIPPED — per file, counted, disclosed on the module symbol.
   *  Absent means no ERROR node ever exceeded the cap, which is every file but the pathological one. */
  recoveryCap?: { cap: number; errorNodes: number; errorChildren: number; visited: number; skipped: number }
  sawContent: boolean
  sawAtRoot: boolean
  /** Cross-file project index for resolving @use/@forward imports */
  projectIndex?: ProjectIndex
}

/**
 * A SCOPE-INTRODUCING node, for the two questions that are about SCOPE rather than
 * about syntax: "is this declaration a module member?" and "is this assignment a
 * shadow or a mutation?".
 *
 * `@media` is deliberately NOT here. Sass gives a media query no new scope for
 * variables — `@media { $x: 1 }` at the root level assigns the root `$x` — so a
 * declaration inside one is still a module-level assignment. A mixin, a function, a
 * rule body and each control-flow block all do introduce one.
 */
const SCOPE_NODES = new Set([
  "rule_set",
  "mixin_statement",
  "function_statement",
  "if_statement",
  "each_statement",
  "for_statement",
  "while_statement",
])

function hasScopeAncestor(node: Node): boolean {
  for (let p = node.parent; p; p = p.parent) if (SCOPE_NODES.has(p.type)) return true
  return false
}

/**
 * Sass's PRIVATE-MEMBER rule, and the reason `exports` is not simply "every top-level
 * declaration".
 *
 * A name beginning `-` or `_` is private to its module: `@use`ing the module does NOT
 * expose it. Measured over 4,394 admitted corpus files: 30 top-level `$` assignments
 * carry such a name and are therefore members of their file but not of its public
 * surface. Exporting them would claim a contract the language does not offer, so the
 * check is on the SYMBOL's own text and never on a pattern over the file — a private
 * mixin is `@mixin _button`, and `@mixin` in the source says nothing either way.
 */
function isPrivateSassName(published: string): boolean {
  const bare = published.startsWith("$")
    ? published.slice(1)
    : published.startsWith("@mixin ")
      ? published.slice("@mixin ".length)
      : published.startsWith("@function ")
        ? published.slice("@function ".length)
        : published
  return bare.startsWith("-") || bare.startsWith("_")
}

export class RealScssAnalyzer implements ASTEngine.LanguageAnalyzer {
  analyze(rootNode: Node, content: string, filePath: string, context?: ASTEngine.AnalyzeContext): ASTEngine.ParseResult {
    // The CSS subset. Its `errors` are KEPT: they were verified to be honest — the
    // analyzer reported 6 errors on a synthetic `@each $k, $v in (a: 1)` and the
    // grammar really does put 4 ERROR nodes there (a map literal in the list, a form
    // that occurs ZERO times in the corpus). Discarding a truthful error list because
    // the delegating analyzer is a different language would be a small sabotage of the
    // lane's own reporting.
    const base = new RealCssAnalyzer().analyze(rootNode, content, filePath)

    const ctx: ScssContext = {
      symbols: base.symbols ?? [],
      relationships: base.relationships ?? [],
      imports: base.imports ?? [],
      exports: base.exports ?? [],
      mixinNames: {},
      functionNames: {},
      variableNames: {},
      namespaces: {},
      published: {},
      publishedOwner: {},
      moduleName: this.moduleNameOf(filePath),
      topLevelVarLines: {},
      sawDiagnostic: false,
      sawContent: false,
      sawAtRoot: false,
      projectIndex: context?.projectIndex,
    }
    // The file IS a Sass module, and it is published FIRST so that a member's owner can
    // name it. Sass has no separate "module file": `@use './theme'` loads ANY stylesheet
    // and exposes its top-level variables, mixins and functions, which is why a
    // stylesheet's public surface is a graph fact rather than a naming convention.
    //
    // The name is the file's own basename WITH the extension, for the reason the bash
    // lane gives for its script symbol (BD2): it is deterministic (no machine path, so
    // the index fingerprint is stable), it cannot collide with a selector or a variable
    // (a class selector is `.btn`, a variable is `$x`, a mixin is `@mixin btn`, and no
    // Sass selector can be `name.scss` because a bare type selector has no dot), and it
    // is not something `isIndexArtifactName` rejects.
    // THE BASE NOW PUBLISHES THIS FILE'S STYLESHEET AS A MODULE — the css lane's file-scoped
    // identity, which is what qualifies every target in this lane as `<file>::<name>` — and this
    // analyzer used to unshift a SECOND one beside it. TWO MODULE SYMBOLS WITH THE SAME NAME IS A
    // DEFECT, NOT A SPELLING CHOICE: it doubled every module row, and the scss fixtures caught it
    // (`expected 1 symbol(s) named … kind=module; got 2`). The base's symbol is ADOPTED and enriched
    // with the Sass vocabulary `emitModuleExports` reads, so there is exactly one module row per
    // stylesheet with the fields this lane's consumers need.
    const baseModule = ctx.symbols.find(
      (s) => s.kind === ASTEngine.SymbolKind.Module && s.name === ctx.moduleName,
    )
    if (baseModule) {
      baseModule.metadata = {
        ...(baseModule.metadata ?? {}),
        isScssModule: true,
        scssModuleName: ctx.moduleName,
        scssModulePath: filePath,
      }
    } else {
      ctx.symbols.unshift({
        name: ctx.moduleName,
        kind: ASTEngine.SymbolKind.Module,
        range: this.nodeToRange(rootNode),
        scope: "",
        visibility: "public",
        complexity: 1,
        metadata: { cssSpecific: true, isScssModule: true, scssModuleName: ctx.moduleName, scssModulePath: filePath },
      })
    }
    for (const s of ctx.symbols) ctx.published[s.name] = true

    this.collectDeclarations(rootNode, ctx)
    this.walk(rootNode, ctx)
    // THE DISCLOSURE, AND THE CHANNEL IS MEASURED RATHER THAN ASSUMED. It was first attached to the
    // file's module symbol on the reasoning that "analyzer-internal tallies do not survive
    // `parseFile`; a symbol's metadata does" — and that reasoning was WRONG: `parseFile` strips
    // symbol metadata COMPLETELY (measured: `[...new Set(symbols.flatMap(s => Object.keys(s.metadata)))]`
    // is `[]` on this very file). What does survive is RELATIONSHIP metadata — that is the channel
    // the fleet's own markers ride (`isExternalTarget` reaches the gate through it). So the tally
    // rides the file's first relationship, and a file with no relationships records nothing because
    // there is nothing to attach it to.
    if (ctx.recoveryCap && ctx.relationships.length > 0) {
      ctx.relationships[0].metadata = { ...(ctx.relationships[0].metadata ?? {}), scssRecoveryCap: ctx.recoveryCap }
    }
    this.emitModuleExports(ctx)

    // ------------------------------------------------------------- THE FILE CLAIM
    //
    // A SASS SPECIFIER NAMES A FILE, AND ITS SPELLING IS NOT THE FILE'S NAME. `@use "partials/base"`
    // resolves to `partials/_base.scss` — the extension is usually absent and a partial's file is
    // underscore-prefixed — so this is the one lane whose candidate arithmetic CANNOT be the shared
    // path fold, and it is supplied here rather than pushed into the guard.
    //
    // MEASURED BEFORE EMITTING (`imports-claim-pricing.mts`, stride sample of 200 files per repo,
    // 1,591 of 4,433 files): of 891 unresolved import edges, **754 name a file the population
    // carries** (84.6%) and the cross-tab is EXACT in both directions — **0 would be refuted**.
    //
    // `.SASS` IS NOT AN ADMITTED EXTENSION HERE, AND THAT IS THE ROUTER'S FACT, NOT A PREFERENCE:
    // `src/ast/language-detection.ts` maps `sass` to the language `sass`, so a `.sass` file is
    // outside this lane's population. Pricing candidates by shape alone refuted **24** scss edges
    // exactly here (`_all.sass`), and the admitted-extension clause inside the guard is what takes
    // that to zero. Candidates of that spelling are not even generated below, so the guard's clause
    // has nothing to refuse.
    const claimRoot = typeof context?.projectRoot === "string" && context.projectRoot.length > 0 ? context.projectRoot : null
    if (claimRoot !== null) {
      const fileRel = path.relative(path.resolve(claimRoot), filePath).split(path.sep).join("/")
      const baseDir = dirOf(fileRel)
      for (const r of ctx.relationships) {
        if (r.type !== ASTEngine.RelationshipType.Imports) continue
        const md = r.metadata as Record<string, unknown> | undefined
        if (!md || typeof md.importProjectFile === "string") continue
        const written = String(r.target ?? "").trim()
        if (written.length === 0) continue
        // THE SASS SPELLINGS, as PROJECT-RELATIVE candidates: the guard folds the specifier itself
        // and takes these as already folded, so both bases are computed here.
        const cut = written.lastIndexOf("/")
        const dirPart = cut < 0 ? "" : written.slice(0, cut + 1)
        const leaf = cut < 0 ? written : written.slice(cut + 1)
        const spellings = new Set<string>([`${written}.scss`, `${written}/_index.scss`, `${written}/index.scss`])
        if (leaf.length > 0 && !leaf.startsWith("_")) {
          spellings.add(`${dirPart}_${leaf}.scss`)
          spellings.add(`${dirPart}_${leaf}/_index.scss`)
        }
        const extra: string[] = []
        for (const sp of spellings) {
          for (const cand of [foldProjectPath(baseDir, sp), foldProjectPath("", sp)]) {
            if (cand !== null && !extra.includes(cand)) extra.push(cand)
          }
        }
        const claim = fileClaimForTarget({
          projectRoot: claimRoot,
          filePath,
          written,
          admittedExtensions: ["scss"],
          // THE POPULATION'S SIZE CAP, passed because this lane HAS over-cap files (4 for graphql,
          // 2 for scss on the gate's own population line). A claim about one of them would be
          // REFUTED, and nothing in the row would say why.
          maxFileSizeBytes: FILE_CLAIM_MAX_BYTES,
          extraCandidates: extra,
        })
        if (claim === null) continue
        md.importProjectFile = claim
      }
    }

    return {
      ...base,
      symbols: ctx.symbols,
      relationships: ctx.relationships,
      imports: ctx.imports,
      exports: ctx.exports,
      metadata: {
        ...(base.metadata ?? {}),
        scssDialect: true,
        scssMixins: Object.keys(ctx.mixinNames).length,
        scssFunctions: Object.keys(ctx.functionNames).length,
        scssVariables: Object.keys(ctx.variableNames).length,
        scssModuleName: ctx.moduleName,
        scssFrameworks: ["SCSS/SASS"],
        ...(ctx.sawDiagnostic ? { scssHasDiagnostics: true } : {}),
        ...(ctx.sawContent ? { scssForwardsContent: true } : {}),
        ...(ctx.sawAtRoot ? { scssEscapesScope: true } : {}),
      },
    }
  }

  /** The stylesheet's own module name: its basename, extension included. */
  private moduleNameOf(filePath: string): string {
    const normalized = filePath.split("\\").join("/")
    const base = normalized.slice(normalized.lastIndexOf("/") + 1)
    return base.length > 0 ? base : "module.scss"
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private lineOf(node: Node | null | undefined): number | undefined {
    return node ? node.startPosition.row + 1 : undefined
  }

  private isErrorNode(node: Node): boolean {
    return node.type === "ERROR" || node.isMissing === true
  }

  private findChild(node: Node, predicate: (n: Node) => boolean): Node | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (c && predicate(c)) return c
    }
    return null
  }

  private findDescendant(node: Node, predicate: (n: Node) => boolean): Node | null {
    const queue: Node[] = [node]
    while (queue.length > 0) {
      const n = queue.shift() as Node
      if (predicate(n)) return n
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) queue.push(c)
      }
    }
    return null
  }

  /**
   * The byte offset where an `@extend` statement's own selector stops.
   *
   * That is the first `;` at or after the statement starts, because `;` terminates the
   * declaration the `@extend` belongs to and everything past it is the next declaration. A
   * statement with no `;` is bounded by its own end.
   *
   * Returned as an OFFSET rather than used as a string test on the target, so a legitimate
   * `@extend` whose target happens to contain `;`-adjacent punctuation is judged by position
   * in the source and not by a shape.
   */
  private extendTargetBound(node: Node): number {
    const semi = String(node.text ?? "").indexOf(";")
    return semi < 0 ? node.endIndex : node.startIndex + semi
  }

  /**
   * Every strict descendant matching `predicate`, in tree order.
   *
   * Needed where `findDescendant`'s breadth-first FIRST match is the wrong node: on a
   * broken `@extend` the first match is a `class_selector` spanning the rest of the region
   * and the real referent is a `placeholder` nested inside it (see `extendedSelectorName`).
   * Depth-first, so the innermost usable node is preferred over a shallower one.
   */
  private descendants(node: Node, predicate: (n: Node) => boolean): Node[] {
    const out: Node[] = []
    const stack: Node[] = [node]
    while (stack.length > 0) {
      const n = stack.pop() as Node
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const c = n.namedChild(i)
        if (!c) continue
        if (predicate(c)) out.push(c)
        stack.push(c)
      }
    }
    return out
  }

  private nodeToRange(node: Node): ASTEngine.UniversalSymbol["range"] {
    return {
      startLine: node.startPosition.row + 1,
      startColumn: node.startPosition.column,
      endLine: node.endPosition.row + 1,
      endColumn: node.endPosition.column,
      startIndex: node.startIndex,
      endIndex: node.endIndex,
    }
  }

  private childForField(node: Node, field: string): Node | null {
    return node.childForFieldName(field)
  }

  /**
   * The innermost PUBLISHED symbol whose range contains `node` — i.e. the rule,
   * mixin or function this statement sits inside.
   *
   * WHY A RANGE LOOKUP AND NOT A TRACKED VARIABLE. The first version threaded an
   * `owner` argument through the walk, the way the CSS analyzer threads
   * `currentSelector`, and it produced three fabrications in one file:
   *
   *     uses  button -> @mixin button     (source was the mixin NAME)
   *     uses  .btn -> .btn                 (source was its own target)
   *     references  color: $brand; -> $brand   (source was raw declaration text)
   *
   * All three have a source that is not an entity. The reason is that a tracked
   * variable only advances for the node types the walker recognises, and a `rule_set`
   * carrying an `@include` is not one of them — so inside any ordinary rule the owner
   * was empty and each edge fell back to something adjacent.
   *
   * Looking the owner up by RANGE fixes all three at once and, more importantly, makes
   * the edge name the SAME symbol the CSS lane published for that rule. Recomputing a
   * selector name here would be a second implementation of the CSS lane's naming —
   * including its `&`-chain resolution — and two implementations of a naming rule is
   * how a graph ends up with `.card` on one side of an edge and `div .card` on the
   * other. Innermost wins, so a declaration inside a rule inside a mixin is owned by the
   * rule, and a statement directly in a mixin body is owned by the mixin.
   */
  private ownerForNode(node: Node, ctx: ScssContext): string {
    const start = node.startIndex
    const idx = this.ownerIndexOf(ctx)
    // THE CHOICE IS HELD IN AN OBJECT, deliberately: `consider` runs inside a closure, and a
    // closure assignment to a `let` does not invalidate its narrowing — TypeScript keeps the `null`
    // from the initializer and the truthy branch collapses to `never` (`TS2339: Property 'name'
    // does not exist on type 'never'`). Mutating a PROPERTY has no such narrowing, so the state
    // lives in `pick` and the variable the compiler tracks is never reassigned in a closure.
    const pick: { entry: OwnerEntry | null; span: number; orig: number } = {
      entry: null,
      span: Number.POSITIVE_INFINITY,
      orig: Number.POSITIVE_INFINITY,
    }
    // IDENTICAL CHOICE RULE, one pass over the entries that can contain the node instead of over
    // every symbol: smallest span wins, and a tie goes to the symbol published FIRST (the original
    // scan used a strict `<`, so an equal span never displaced an earlier symbol — reproduced here
    // with `orig`, not left to the sort order).
    const consider = (e: OwnerEntry): void => {
      if (start < e.start || start >= e.end) return
      const span = e.end - e.start
      if (span < pick.span || (span === pick.span && e.orig < pick.orig)) {
        pick.span = span
        pick.entry = e
        pick.orig = e.orig
      }
    }
    // the last entry that can start at or before the node
    let lo = 0
    let hi = idx.sorted.length - 1
    let j = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (idx.sorted[mid].start <= start) { j = mid; lo = mid + 1 } else hi = mid - 1
    }
    for (let i = j; i >= 0; i--) {
      // no entry at or before i can end after the node, so none of them contains it
      if (idx.maxEnd[i] <= start) break
      consider(idx.sorted[i])
    }
    for (const e of idx.tail) consider(e)
    return pick.entry ? pick.entry.sym.name : ""
  }

  /**
   * Build (or grow) the interval index `ownerForNode` reads. Rebuilds happen when the un-indexed
   * tail grows past 32 entries, and whenever the identity guard sees the array reordered — so the
   * index can only ever be a faster spelling of the scan it replaced.
   */
  private ownerIndexOf(ctx: ScssContext): OwnerIndex {
    const symbols = ctx.symbols
    let idx = ctx.ownerIndex
    if (!idx || (idx.len > 0 && (idx.len > symbols.length || symbols[idx.len - 1] !== idx.lastSeen))) {
      idx = ctx.ownerIndex = { len: 0, lastSeen: undefined, sorted: [], maxEnd: [], tail: [] }
    }
    if (symbols.length === idx.len) return idx
    for (let i = idx.len; i < symbols.length; i++) {
      const sym = symbols[i]
      if (sym.metadata?.isScssModule) continue
      const r = sym.range
      if (!r || typeof r.startIndex !== "number" || typeof r.endIndex !== "number") continue
      idx.tail.push({ sym, orig: i, start: r.startIndex, end: r.endIndex })
    }
    idx.len = symbols.length
    idx.lastSeen = symbols[symbols.length - 1]
    if (idx.tail.length > 32) {
      idx.sorted = idx.sorted.concat(idx.tail).sort((a, b) => a.start - b.start || a.orig - b.orig)
      idx.tail = []
      idx.maxEnd = new Array(idx.sorted.length)
      let m = Number.NEGATIVE_INFINITY
      for (let i = 0; i < idx.sorted.length; i++) {
        if (idx.sorted[i].end > m) m = idx.sorted[i].end
        idx.maxEnd[i] = m
      }
    }
    return idx
  }

  /** The old linear scan, kept so the equivalence harness can compare against it (never used in the
   *  analysis path). Any difference between this and `ownerForNode` is a regression. */
  private ownerForNodeLinear(node: Node, ctx: ScssContext): string {
    const start = node.startIndex
    let best: ASTEngine.UniversalSymbol | null = null
    let bestSpan = Number.POSITIVE_INFINITY
    for (const sym of ctx.symbols) {
      // The file's own module symbol spans the WHOLE file, so it would win every
      // lookup by being the only candidate for a statement at the top level — and it is
      // skipped on purpose. A module is not a lexical scope: making it the owner would
      // re-source every top-level statement onto a file-level name, which is a
      // different edge from the one the lane emitted before this symbol existed. The
      // module is the source of `exports` and `overrides`, where "the file offered this"
      // is exactly the claim; it is not the owner of a rule, a mixin or a declaration.
      if (sym.metadata?.isScssModule) continue
      const r = sym.range
      if (!r || typeof r.startIndex !== "number" || typeof r.endIndex !== "number") continue
      // the symbol's own declaration node should not own itself
      if (start < r.startIndex || start >= r.endIndex) continue
      const span = r.endIndex - r.startIndex
      if (span < bestSpan) {
        bestSpan = span
        best = sym
      }
    }
    return best ? best.name : ""
  }

  /**
   * A declaration is published ONCE per name. `$brand: #f00` in three places is one
   * variable that is assigned three times, and the CSS lane's identity ruling —
   * `(kind, resolved name)`, scope retained as provenance — applies unchanged: a
   * symbol that exists twice with one name is the identity collision this project has
   * been removing all along, and `.scss` is full of re-assignments.
   */
  private publishOnce(ctx: ScssContext, symbol: ASTEngine.UniversalSymbol, owner = ""): boolean {
    const key = `${symbol.kind} ${symbol.name}`
    if (!ctx.published[key]) {
      ctx.published[key] = true
      ctx.publishedOwner[key] = owner
      ctx.symbols.push(symbol)
      return true
    }
    // SAME name, DIFFERENT scope. For a `$variable` the scope key is empty, so every
    // assignment of one name collapses to one symbol — which is the ruling, and is
    // right because a Sass variable is one thing assigned in several places.
    //
    // For a control-flow scope the key carries the owner AND the line, and the
    // difference matters. Two `@each $size in (large, small)` in two nesting contexts
    // iterate the same values and are nonetheless two constructs at two places in the
    // file. Measured on
    // `element-plus/packages/theme-chalk/src/checkbox.scss`: TWO `each_statement`s
    // (L76 and L266) with identical text, collapsed into one — so the second published
    // nothing, its rules published nothing, and every `$var` read inside it had no
    // owner and emitted no edge. The differential caught it as 7 MISSING rows that were
    // the ANALYZER losing information, not the truth being wrong.
    //
    // The LINE is in the key because the owner alone was not enough there: both loops
    // sat inside `@include` content blocks whose rules are unnameable `&` templates,
    // so nothing was published around either and both owners were empty. Position is
    // what distinguishes two constructs that are textually and contextually identical.
    //
    // The disambiguated name follows the convention the dart lane already uses
    // (`root.child` / `root.child#2`): the first occurrence keeps the plain name and a
    // collision in a different scope gets `#2`, `#3`, … A repeat in the SAME scope is
    // still a duplicate and is still dropped.
    if (ctx.publishedOwner[key] === owner) return false
    let n = 2
    while (ctx.published[`${key}#${n}`]) n++
    const disambiguated = { ...symbol, name: `${symbol.name}#${n}` }
    ctx.published[`${key}#${n}`] = true
    ctx.publishedOwner[`${key}#${n}`] = owner
    ctx.symbols.push(disambiguated)
    return true
  }

    // ── the module's public surface: `exports` ─────────────────────────────────

  /**
   * A Sass module exports its top-level variables, mixins and functions, and nothing
   * else — that is precisely what `@use 'this-file'` binds. An assignment inside a rule,
   * a mixin, a function or a control-flow block is LOCAL and is not part of the surface.
   *
   * Measured over 4,394 admitted corpus files: 3,315 top-level `$` assignments naming
   * 2,501 distinct variables, 30 of them private by the `-`/`_` rule, plus 308 mixin and
   * 77 function declarations — so this emits roughly one edge per distinct public member
   * of every stylesheet, which is the module-system pair with `imports`.
   *
   * BOTH ends resolve by construction: the source is this file's own module symbol and
   * the target is a symbol this file publishes. That is the whole reason to model a
   * module's surface as EDGES rather than as a convention: `@use 'a', 'b'` binds
   * members from two files and nothing else in the graph can say which file offered a
   * name.
   */
  private emitModuleExports(ctx: ScssContext): void {
    const published = new Set<string>()
    for (const sym of ctx.symbols) {
      if (sym.metadata?.isScssModule) continue
      if (sym.kind !== ASTEngine.SymbolKind.Variable && sym.kind !== ASTEngine.SymbolKind.Function) continue
      // a control-flow scope is an `interface` and a mixin/function is a `function`; the
      // only `function`-kind symbols this lane publishes are `@mixin`/`@function`
      // declarations, and only those carry one of these markers
      const isCallable = sym.kind === ASTEngine.SymbolKind.Function
      if (isCallable ? !sym.metadata?.scssCallable : !sym.metadata?.isScssVariable) continue
      // scoped symbols carry the owner they were published under; a module member has
      // none. This is the same test the fixture harness's export invariant uses, so the
      // two cannot disagree about what a module member is.
      if (sym.scope) continue
      const name = sym.name
      if (published.has(name)) continue
      if (isPrivateSassName(name)) {
        published.add(name)
        continue
      }
      published.add(name)
      ctx.relationships.push({
        source: ctx.moduleName,
        target: name,
        type: ASTEngine.RelationshipType.Exports,
        line_number: sym.range?.startLine ?? 1,
        confidence: 1.0,
        metadata: {
          evidenceClass: "structural",
          cssSpecific: true,
          isScssModuleMember: true,
          scssModule: ctx.moduleName,
        },
      })
      ctx.exports.push({
        name,
        kind: sym.kind,
        range: sym.range,
        visibility: "public",
        metadata: { via: "sass-module-top-level", scssModule: ctx.moduleName },
      })
    }
  }

  // ── `overrides`: the one reassignment Sass itself calls an override ─────────

  /**
   * `$x: … !global` where `$x` was already assigned at this file's top level.
   *
   * This is the narrowest honest `overrides` in the language and every part of it is
   * measured, because the wide readings are wrong:
   *
   *   * A SECOND `@mixin x` / `@function x`: 0 occurrences across 4,394 admitted files.
   *     The branch exists and cannot fire on this corpus, which is a fact about the
   *     corpus and not a claim that the construct does not exist.
   *   * A plain same-scope reassignment: 203 occurrences, of which 171 READ the variable
   *     they assign (`$_args: append($_args, …)` in bootstrap's `_functions.scss` is the
   *     shape) — an accumulator mutating one binding, which is not the replacement of a
   *     declaration and would be a fabricated edge. The other 32 are a `$x: 1; … $x: 2`
   *     pair, which the lane's own identity ruling already collapses into ONE symbol, so
   *     an edge between the two assignments would be a self-edge.
   *   * `!global`: 7 occurrences, and it is the only one of the three that means what
   *     `overrides` means. `!global` is the flag that reaches PAST the enclosing scope
   *     and reassigns the binding outside it, so the prior declaration is replaced and
   *     the two are different things. bootstrap's `_box-shadow.test.scss` is the model:
   *     `$enable-shadows: false !global;` … `$enable-shadows: true !global;` … and a
   *     final restore, three overrides of one module-level variable.
   *
   * The prior assignment must be a TOP-LEVEL one. `!global` beside a name that only
   * exists inside another mixin CREATES a global rather than replacing one, and the 14
   * `!global` assignments in element-plus that fail this test are exactly that.
   *
   * The edge runs from the scope that performs the assignment to the variable it
   * replaces, with `overridesLine` carrying the replaced declaration's line, so a
   * consumer does not have to infer it. `source` falls back to the module symbol for an
   * assignment at the file's top level, which is the only case with no enclosing scope.
   */
  private emitGlobalOverride(node: Node, name: string, ctx: ScssContext): void {
    if (!this.hasVisibilityFlag(node, "global")) return
    const line = this.lineOf(node) ?? 0
    const prior = ctx.topLevelVarLines[name]
    // `prior < line`, not merely `prior !== undefined`: the FIRST assignment is itself
    // in `topLevelVarLines`, and without the ordering test it would emit an edge saying
    // a declaration overrides itself.
    if (prior === undefined || prior >= line) return
    const owner = this.ownerForNode(node, ctx) || ctx.moduleName
    if (!owner) return
    ctx.relationships.push({
      source: owner,
      target: name,
      type: ASTEngine.RelationshipType.Overrides,
      line_number: line,
      confidence: 1.0,
      metadata: {
        evidenceClass: "structural",
        cssSpecific: true,
        isScssGlobalOverride: true,
        overridesLine: prior,
        scssFlagGlobal: true,
      },
    })
  }

  // ── pass 1: declarations, so a use may precede its declaration ─────────────

  private collectDeclarations(root: Node, ctx: ScssContext): void {
    const stack: Node[] = [root]
    while (stack.length > 0) {
      const n = stack.pop() as Node
      if (this.isErrorNode(n)) continue
      if (n.type === "mixin_statement") {
        const name = this.childForField(n, "name") ?? this.findChild(n, (c) => c.type === "identifier")
        if (name) ctx.mixinNames[stripAllQuotes(name.text)] = mixinName(stripAllQuotes(name.text))
      } else if (n.type === "function_statement") {
        const name = this.childForField(n, "name") ?? this.findChild(n, (c) => c.type === "identifier")
        if (name) ctx.functionNames[stripAllQuotes(name.text)] = functionName(stripAllQuotes(name.text))
      } else if (n.type === "property_name" && n.text.startsWith("$") && n.parent?.type === "declaration") {
        // A variable is DECLARED by its declaration's left-hand side, and in this grammar
        // the left-hand side is always a `property_name` node. Measured over the corpus:
        // 14,216 declarations, `property_name` first in 14,216 of them and `variable` in
        // ZERO — so no shape exists in which a `variable` node is an assignment's target,
        // and reading declarations off `property_name` is not a preference but the only
        // reading the grammar supports.
        //
        // This used to key on `variable` nodes behind
        // `findDescendant(n, d => d.type === "declaration") === null -> continue`. A
        // `variable` is a LEAF, so that guard held for every one of them and the branch
        // was dead. `variableNames` was really being filled by pass 2's
        // `processScssDeclaration`, which meant the map was built DURING the walk and a
        // read resolved only if its declaration came earlier in the file. The
        // differential's oracle builds its `variables` set in a full pre-pass, so the two
        // disagreed on forward references, and agreed on this corpus only because Sass
        // requires declaration before use almost everywhere. Keying off `property_name`
        // makes the analyzer order-independent, which is what the oracle already was.
        ctx.variableNames[n.text] = n.text
      } else if (n.type === "use_statement") {
        const module = this.findChild(n, (c) => c.type === "string_value")
        const ns = this.findChild(n, (c) => c.type === "plain_value" || c.type === "identifier")
        if (module && ns) ctx.namespaces[stripAllQuotes(ns.text)] = stripAllQuotes(module.text)
      }
      if (n.type === "declaration" && !hasScopeAncestor(n)) {
        // Where each module-level `$var` is FIRST assigned, pre-collected so the
        // `overrides` edge does not depend on the walk reaching the assignment before
        // the reassignment — the lane's rule 2, which exists because Sass does not care
        // about order. The FIRST line is the one an override replaces.
        const prop = this.findChild(n, (c) => c.type === "property_name")
        const name = prop ? prop.text : ""
        if (name.startsWith("$")) {
          const line = n.startPosition.row + 1
          // the MINIMUM line, not the first one this DFS happened to reach: the walk
          // pops a stack, so "first visited" is not "first written"
          const seen = ctx.topLevelVarLines[name]
          if (seen === undefined || line < seen) ctx.topLevelVarLines[name] = line
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) stack.push(c)
      }
    }
  }

  // ── pass 2: the SCSS statements ────────────────────────────────────────────

  /**
   * @param recovered TRUE when this node sits inside a region the grammar could not read.
   *   Threaded rather than recomputed because the read/call scan keeps its OWN notion of
   *   recovery — it descends into errors on its own — and the two must agree. A claim the
   *   outer walk reached by descending into a broken region and then handed to the inner
   *   scan is recovered even though the inner scan arrived by a clean path, so the two are
   *   OR'd, and that is what makes `scssRecoveredFromError` trustworthy rather than
   *   merely present.
   */
  private walk(node: Node, ctx: ScssContext, recovered = false, limit = Number.POSITIVE_INFINITY): void {
    // THE BOUND IS ON THE NODE'S SHAPE, NOT ON ITS LABEL. It was first written inside the
    // `isErrorNode(child)` branch — and it never bound: instrumenting `namedChild(i)` for i > 2000
    // showed 9,438 calls arriving through `walk` itself, because this node is reached by the ORDINARY
    // recursion, not by the error branch. A bound that depends on a predicate is a bound that can
    // miss the shape it was written for; a child count cannot. Only a node wider than
    // `RECOVERY_CHILD_CAP` is affected, which is the pathological shape and nothing else.
    if (limit === Number.POSITIVE_INFINITY && node.namedChildCount > RECOVERY_CHILD_CAP) {
      const tally = (ctx.recoveryCap ??= { cap: RECOVERY_CHILD_CAP, errorNodes: 0, errorChildren: 0, visited: 0, skipped: 0 })
      tally.errorNodes++
      tally.errorChildren += node.namedChildCount
      tally.visited += RECOVERY_CHILD_CAP
      tally.skipped += node.namedChildCount - RECOVERY_CHILD_CAP
      limit = RECOVERY_CHILD_CAP
    }
    for (let i = 0; i < node.namedChildCount && i < limit; i++) {
      const child = node.namedChild(i)
      if (!child) continue
      // DESCEND THROUGH ERROR — and this is the fix the whole investigation turned on.
      //
      // The outer walk used to `continue` on an error node, so no `declaration` inside a
      // broken region was ever VISITED and the read/call scan was never handed one.
      // Recovering inside that scan while refusing to reach it from here is fixing the
      // wrong level: the inner descent is dead code for every node the outer walk never
      // delivers.
      //
      // `form-item.scss` is the proof and the reason it was worth the trouble: 359 error
      // spans, 19 `rule_set` nodes of which 1 is publishable, and `rule_set` nodes whose
      // "selectors" node actually contains DECLARATION text — which the analyzer
      // correctly refuses, since a selector that reads `margin-bottom: #{map.get(…)}` is
      // not a selector. The reads behind that were simply absent. In this instance the
      // surviving defect turned out to be deeper still (see the `isOwnLhs` note above),
      // which is worth recording: the traversal bug was real and worth fixing, and it
      // was not the one causing the MISSING rows it looked like it was causing.
      if (this.isErrorNode(child)) {
        this.processRecoveredExtend(child, ctx)
        this.walk(child, ctx, true)
        continue
      }

      // `@content` has NO node type in this grammar. The rule list is
      // at_root/charset/debug/each/error/extend/for/forward/function/if/import/
      // include/keyframes/media/mixin/namespace/postcss/return/supports/use/warn/
      // while — no `content_statement` — and the construct parses as a bare
      // `at_rule > at_keyword`. The switch below therefore had a case for a type that
      // cannot occur, so `scssForwardsContent` was set by nothing, ever.
      //
      // Found by F1 the moment the lane was registered, which is the gate's whole
      // purpose: a type literal that names nothing is how an extractor silently stops
      // matching, and reading the code does not reveal it because the name is
      // plausible. Matched on the KEYWORD, which is what the tree actually offers.
      if (child.type === "at_rule") {
        const kw = this.findChild(child, (c) => c.type === "at_keyword")
        const keyword = kw ? kw.text.trim().toLowerCase() : ""
        if (keyword === "@content") ctx.sawContent = true
        if (keyword === "@at-root") ctx.sawAtRoot = true
      }

      switch (child.type) {
        case "use_statement":
        case "forward_statement":
          this.processModuleStatement(child, ctx)
          break
        case "mixin_statement":
        case "function_statement":
          this.processCallable(child, ctx)
          break
        case "extend_statement":
          this.processExtend(child, ctx)
          break
        case "at_root_statement":
        case "debug_statement":
        case "warn_statement":
        case "error_statement":
          // Real statements with no entity of their own. Recorded as flags on the
          // file rather than published as symbols, because a `@warn` is not a thing a
          // file DEFINES, and a symbol for one would be a name with no referent — the
          // placeholder-literal anti-pattern (M60 R7). The flags are what let a
          // consumer see that a stylesheet debugs, forwards content, or escapes scope.
          // `@content` is handled above, by keyword, because it has no node type.
          if (child.type === "at_root_statement") ctx.sawAtRoot = true
          else ctx.sawDiagnostic = true
          break
        case "declaration":
          this.processScssDeclaration(child, ctx)
          // the READS inside this declaration, found by descendant walk so a `$var`
          // nested in a `calc()`, a map, or an interpolated selector is found too
          this.emitVariableReadEdges(child, ctx, recovered)
          break
        // A `$var` is also read in an `@include`'s ARGUMENT list and in a control
        // flow's condition or iterable, and those are reads like any other:
        // `@include button($brand, 8px)` reads `$brand`. The first version only
        // looked inside `declaration`, so an argument read produced no edge and the
        // variable looked write-only in the graph.
        case "if_statement":
        case "each_statement":
        case "for_statement":
        case "while_statement":
          this.processControlFlow(child, ctx, this.ownerForNode(child, ctx))
          this.emitVariableReadEdges(child, ctx, recovered)
          break
        case "include_statement":
          this.processInclude(child, ctx)
          this.emitVariableReadEdges(child, ctx, recovered)
          break
        // `@return` and an `@use … with (…)` configuration are the two remaining
        // places a `$var` can be READ outside a declaration's value, and both were
        // silent. The `return_statement` case was removed when the self-edge was
        // fixed — the edge went, the read scan went with it because the two shared a
        // case — and nothing replaced it.
        //
        // Measured: `element-plus/packages/theme-chalk/src/color/index.scss` reads
        // `$red`, `$green` and `$blue` in a `@return rgb2hex(rgb($red, $green, $blue))`
        // at L19, and the differential reported them MISSING. A function's own body
        // variables were unreadable in the graph: the function published them, and
        // nothing recorded that it consumed them.
        case "return_statement":
        case "use_statement":
        case "forward_statement":
          this.emitVariableReadEdges(child, ctx, recovered)
          break
        default:
          break
      }

      // Ownership is resolved per statement by RANGE (see `ownerForNode`), not
      // threaded: the walk recurses into every child regardless of type, so a rule, a
      // mixin body and an `@if` block all reach their contents without this function
      // having to know they exist.
      this.walk(child, ctx, recovered)
    }
  }

  private ownerNameOf(node: Node): string {
    const name = this.childForField(node, "name") ?? this.findChild(node, (c) => c.type === "identifier")
    if (!name) return ""
    const raw = stripAllQuotes(name.text)
    return node.type === "function_statement" ? functionName(raw) : mixinName(raw)
  }

  // ── `@use` / `@forward` ─────────────────────────────────────────────────────

  /**
   * An `imports` edge, which is the ontology's type for exactly this — the same one
   * the CSS lane uses for `@import` and for Sass `@use`/`@forward`.
   *
   * The `as` namespace is recorded on the ImportInfo because it is the part a
   * consumer cannot recover from the module path: `@use 'sass:map' as map` and
   * `@use 'sass:map' as m` are the same import and different graphs.
   */
  private processModuleStatement(node: Node, ctx: ScssContext): void {
    const moduleNode = this.findChild(node, (c) => c.type === "string_value")
    if (!moduleNode) return
    const module = stripAllQuotes(moduleNode.text)
    const nsNode = this.findChild(node, (c) => c.type === "plain_value" || c.type === "identifier")
    const namespace = nsNode ? stripAllQuotes(nsNode.text) : undefined

    // The namespace is published for EVERY `@use … as <ns>`, with no exception for
    // built-in `sass:` modules. The first version excluded `sass:` on the reasoning
    // that a built-in is "not the file's own" — and then the fixture asked for `map`
    // and was right to: `@use 'sass:map' as map` binds the name `map` in THIS file
    // exactly as `@use './theme' as theme` does, and a rule that treats the two
    // differently has a rule nobody wrote down. The part that is genuinely different
    // is `as *`, which binds no name and therefore publishes nothing — there is no
    // name to publish, and a symbol for the keyword `*` would be a name with no
    // referent.
    //
    // A namespaced CALL, `map.merge($a, $b)`, is a use of this namespace, and the
    // lookup is by a namespace THIS FILE declares, for the reason every other use
    // edge in this project gives: a `@use` may come from another stylesheet, and
    // inventing an endpoint for it is the phantom the CSS lane removed once.
    if (namespace) {
      ctx.symbols.push({
        name: namespace,
        kind: ASTEngine.SymbolKind.Namespace,
        range: this.nodeToRange(node),
        scope: "",
        visibility: "public",
        complexity: 1,
        metadata: { isAtRule: true, isScssModuleNamespace: true, scssModule: module, atKeyword: `@${node.type.replace("_statement", "")}` },
      })
    }

    ctx.imports.push({
      module,
      isNamespaceImport: true,
      alias: namespace,
      path: module,
      range: this.nodeToRange(node),
      metadata: {
        scssModuleType: node.type,
        ...(namespace ? { scssNamespace: namespace } : {}),
      },
    })

    // CROSS-FILE RESOLUTION: if we have a projectIndex, resolve the imported module's exports
    // and create exports edges from this file's module to the imported module's public members
    if (ctx.projectIndex && namespace) {
      this.resolveModuleImports(ctx, namespace, module)
    }
  }

  /**
   * Resolve an imported module's public members from the project index and create
   * exports edges from this file's module to those members.
   * This allows `@use 'other' as ns` to make `ns.$var`, `ns.mixin()`, `ns.function()` resolvable.
   */
  private resolveModuleImports(ctx: ScssContext, namespace: string, modulePath: string): void {
    if (!ctx.projectIndex) return

    // The projectIndex has typeMembers mapping module names to their exported members
    // For SCSS, the module name in the index is the file's basename (e.g., "theme.scss")
    // We need to find which type in the index corresponds to the imported module path
    const index = ctx.projectIndex

    // Try to find the module in the index by matching the module path
    // The module path could be relative ('./theme'), absolute, or namespaced ('sass:map')
    let targetTypeName: string | undefined

    // First, try exact match on symbolNames (the index records all declared names)
    for (const typeName of index.typeMembers.keys()) {
      // The module's public surface is what @use exposes
      // Check if this typeName corresponds to the imported module
      if (typeName === modulePath || typeName.endsWith("/" + modulePath) || typeName.endsWith("\\" + modulePath)) {
        targetTypeName = typeName
        break
      }
      // For built-in sass: modules, they won't be in the project index
      if (modulePath.startsWith("sass:")) return
    }

    if (!targetTypeName) return

    // Get the closed members for this module (includes inherited members)
    const closedMembers = (index as any).__closedMembers?.get(targetTypeName)
    if (!closedMembers) return

    // For each exported member, create an exports edge from this file's module
    // to the member, qualified by the namespace
    for (const memberName of closedMembers) {
      // The namespace-qualified name is what @use 'mod' as ns makes available
      const qualifiedName = `${namespace}.${memberName}`
      
      // Emit an exports edge: this file's module exports the qualified member
      ctx.relationships.push({
        source: ctx.moduleName,
        target: qualifiedName,
        type: ASTEngine.RelationshipType.Exports,
        line_number: 0, // import statement line
        confidence: 1.0,
        metadata: {
          evidenceClass: "structural",
          cssSpecific: true,
          isScssModuleMember: true,
          scssModule: ctx.moduleName,
          scssNamespace: namespace,
          scssImportedFrom: modulePath,
        },
      })

      // Also emit the member as a symbol so it can be referenced
      ctx.symbols.push({
        name: qualifiedName,
        kind: ASTEngine.SymbolKind.Variable, // conservative; actual kind varies
        range: { startLine: 1, startColumn: 0, endLine: 1, endColumn: 0, startIndex: 0, endIndex: 0 },
        scope: "",
        visibility: "public",
        complexity: 1,
        metadata: {
          isScssVariable: true,
          scssVariableName: qualifiedName,
          scssNamespace: namespace,
          scssImportedFrom: modulePath,
        },
      })
    }
  }

  // ── `@mixin` / `@function` ──────────────────────────────────────────────────

  private processCallable(node: Node, ctx: ScssContext): void {
    const raw = node.type === "function_statement" ? this.childForField(node, "name") : this.childForField(node, "name")
    const nameNode = raw ?? this.findChild(node, (c) => c.type === "identifier")
    if (!nameNode) return
    const bare = stripAllQuotes(nameNode.text)
    const published = node.type === "function_statement" ? functionName(bare) : mixinName(bare)

    const parameters = this.readParameters(node)
    this.publishOnce(ctx, {
      name: published,
      kind: ASTEngine.SymbolKind.Function,
      range: this.nodeToRange(node),
      scope: "",
      visibility: "public",
      // one step for the declaration, one per parameter, one for the body
      complexity: 1 + parameters.length + (this.findChild(node, (c) => c.type === "block") ? 1 : 0),
      ...(parameters.length > 0 ? { parameters } : {}),
      metadata: {
        isAtRule: true,
        atKeyword: node.type === "function_statement" ? "@function" : "@mixin",
        scssCallable: true,
        ...(node.type === "function_statement" ? { isScssFunction: true } : { isScssMixin: true }),
        parameterCount: parameters.length,
        // whether the body returns a value — see the `@return` note above for why
        // this is a flag and not an edge
        ...(this.findDescendant(node, (n) => n.type === "return_statement") ? { scssReturns: true } : {}),
      },
    })
  }

  /**
   * A mixin's or function's parameters, read from the `parameter` nodes.
   *
   * `defaultValue` is taken from the `default` FIELD rather than by slicing text, so
   * a parameter whose default is itself an expression keeps the expression rather than
   * a truncation of it.
   */
  // typed NON-optional on purpose: `UniversalSymbol["parameters"]` is
  // `Parameter[] | undefined`, so returning it made every `.length` below a
  // possible-undefined error and the fix would have been three `!` assertions. The
  // empty case is a real empty list, not an absent one.
  private readParameters(node: Node): ASTEngine.Parameter[] {
    const paramsNode = this.findChild(node, (c) => c.type === "parameters")
    if (!paramsNode) return []
    const out: ASTEngine.Parameter[] = []
    for (let i = 0; i < paramsNode.namedChildCount; i++) {
      const p = paramsNode.namedChild(i)
      if (!p || p.type !== "parameter") continue
      const varNode = this.findChild(p, (c) => c.type === "variable")
      if (!varNode) continue
      const dflt = this.childForField(p, "default")
      out.push({
        name: stripAllQuotes(varNode.text),
        ...(dflt ? { defaultValue: stripAllQuotes(dflt.text) } : {}),
      })
    }
    return out
  }

  // ── `@include` ──────────────────────────────────────────────────────────────

  private processInclude(node: Node, ctx: ScssContext): void {
    const nameNode = this.findChild(node, (c) => c.type === "identifier" || c.type === "plain_value")
    if (!nameNode) return
    const bare = stripAllQuotes(nameNode.text)
    // A NAMESPACED include, `@include map.get($k)`, resolves through the namespace
    // declared by `@use … as`. Both halves are pre-collected, so the order of the
    // `@use` and the `@include` does not matter.
    const [maybeNs, maybeName] = bare.includes(".") ? bare.split(".") : [undefined, bare]
    const target =
      maybeNs && ctx.namespaces[maybeNs]
        ? ctx.mixinNames[maybeName] ?? ctx.functionNames[maybeName]
        : ctx.mixinNames[bare] ?? ctx.functionNames[bare]
    if (!target) return
    const owner = this.ownerForNode(node, ctx)
    if (!owner) return
    // `calls`, not `uses`. The lane already resolved the callee to a mixin or function
    // THIS FILE DECLARES — `target` is `@mixin name` or `@function name` and nothing else
    // gets here — so this is a resolved invocation, and the ontology's rule for a
    // resolved invocation is the one the lua lane states (`real-lua-analyzer.md:647`):
    // "a member that is called is not merely read". `uses` was the neighbour, and it is
    // the same label `@extend` carried until the change measured in `emitExtend`.
    ctx.relationships.push({
      source: owner,
      target,
      type: ASTEngine.RelationshipType.Calls,
      // M59.A7: the name is the mixin's own line, which is the VALUE's line for a
      // namespaced call and the statement's line otherwise. The value is the more
      // specific of the two and survives reformatting better.
      line_number: this.lineOf(nameNode),
      metadata: { evidenceClass: "usage_contextual", cssSpecific: true, isScssInclude: true },
    })
  }

  // ── `@return`: a FACT ABOUT A FUNCTION, NOT AN EDGE ─────────────────────────
  //
  // There is deliberately no `@return` handling here. The first version emitted
  // `contains` from the function to ITSELF, which is a self-edge: it makes a
  // relationship count look like evidence while connecting nothing, and `contains`
  // between a thing and itself is not a claim any consumer can use.
  //
  // A `@return` names no entity. It says the function produces a value, which is a
  // property of the function, so it is recorded as one — see `scssReturns` on the
  // function symbol in `processCallable`, which is where it belongs.

  // ── `@extend` ───────────────────────────────────────────────────────────────

  private processExtend(node: Node, ctx: ScssContext): void {
    this.emitExtend(node, node, node, ctx, false)
  }

  /**
   * The `@extend` INSIDE A RULE BODY, which is 63 of the 99 `@extend` statements in the
   * corpus and every one of them was invisible.
   *
   * This is a grammar fact and it is worth stating exactly, because it is not a defect
   * in the analyzer's walk. The `extend_statement` RULE is written for a top-level
   * `@extend`; nested inside a `block` the same text parses as
   *
   *     block > ERROR > "@extend", placeholder, ";", ERROR("or", ":", …)
   *
   * — so the statement's own node type never appears, the keyword survives only as an
   * ANONYMOUS token, and the walk (which visits named children) never sees either.
   * Measured: 125 `@extend` tokens across 4,394 admitted files and only 36
   * `extend_statement` nodes, so 89 of them — 71% — are in the recovered shape and 63 of
   * the 99 real `@extend`s (`.card { @extend %badge; }`, which is where a BEM codebase
   * puts nearly all of them) were producing no edge at all.
   *
   * The recognition is by the KEYWORD, not by shape: the first non-whitespace child is
   * the anonymous token `@extend`. Checking for "an ERROR with a selector in it" would
   * fire on every broken declaration, and checking node types would check for the type
   * that is absent.
   *
   * The edge is marked `scssRecoveredFromError` because it is read out of a region the
   * grammar gave up on, and the rest of this lane marks recovered claims the same way
   * (see `emitVariableReadEdges`). Both ends still resolve: the owner is a rule this
   * file publishes and the target is a selector this file publishes.
   */
  private processRecoveredExtend(node: Node, ctx: ScssContext): void {
    if (!this.isErrorNode(node)) return
    let keywordSeen = false
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i)
      if (!c) continue
      if (c.type === "@extend") {
        keywordSeen = true
        break
      }
      if (!c.isNamed || c.type === "comment") continue
      // a NAMED child before the keyword: this error node is a different broken thing
      return
    }
    if (!keywordSeen) return
    // The ERROR node spans the broken region (often past the rule end).
    // Find the rule ancestor so ownerForNode can locate the containing rule.
    let ruleAncestor: Node | null = null
    for (let p = node.parent; p; p = p.parent) {
      if (p.type === "rule_set") { ruleAncestor = p; break }
    }
    // Use a child of the rule (first declaration or the rule itself) for owner lookup,
    // and the @extend keyword node for the line number.
    const ownerNode = ruleAncestor ?? node
    const lineNode = node // the ERROR node has the @extend keyword position
    // extendedSelectorName needs the ERROR node (which contains the placeholder),
    // but ownerForNode needs a node inside the rule. Pass both.
    this.emitExtend(node, ownerNode, lineNode, ctx, true)
  }

  private emitExtend(
    targetNode: Node,  // the node to pass to extendedSelectorName (contains the placeholder)
    ownerNode: Node,   // the node to pass to ownerForNode (inside the rule)
    lineNode: Node,    // the node for line number (the @extend keyword position)
    ctx: ScssContext,
    recovered: boolean
  ): void {
    const found = this.extendedSelectorName(targetNode)
    if (!found) return
    const target = found.name
    const owner = this.ownerForNode(ownerNode, ctx)
    if (!owner) return
    // `extends`, not `uses`. `@extend` IS Sass's inheritance: the extending selector
    // takes on the extended selector's declarations, and the ontology has a type for
    // exactly that. `uses` is the neighbour that loses the meaning — with the edge
    // labelled `uses`, a consumer cannot tell an inheritance edge from a variable read,
    // which is the whole question `@extend` exists to answer.
    //
    // MEASURED COST, and it is a cost rather than a free correction. Relabelling this
    // edge and the `@include` edge below moves the lane's differential from
    // `covered=1558 (96.5%) MISSING=56` to `covered=1514 (93.8%) MISSING=100` on the
    // canonical 149-file element-plus sample. The 44 new MISSING rows are the ORACLE's
    // mislabelling, not a recall loss: `script/m14/differential.ts`'s `deriveScssEdges`
    // pushes `uses` for both constructs, so the truth rows now have no analyzer row to
    // match. `unexplained` is UNCHANGED at 13 across both runs, because the scss
    // compared-label allowlist filters the ANALYZER side, so a relabelled edge is
    // dropped from the comparison rather than counted as a fabrication. The oracle
    // change is a §8 report-to-supervisor item and is specified in
    // docs/analyzers/real-scss-analyzer.md; it is not applied here because
    // script/m14/differential.ts is shared machinery.
    ctx.relationships.push({
      source: owner,
      target,
      type: ASTEngine.RelationshipType.Extends,
      line_number: this.lineOf(lineNode),
      metadata: {
        evidenceClass: "structural",
        cssSpecific: true,
        isScssExtend: true,
        ...(recovered ? { scssRecoveredFromError: true, scssExtendShape: "recovered" } : {}),
        // The TARGET was read out of a node the grammar built across a damaged region, not
        // off the selector the statement names. That is a different claim from the statement
        // having been recovered, and the lane already marks the statement, so it marks this
        // too rather than letting a consumer read a repaired edge as a clean one. It is not
        // a confidence reduction: the referent is a `placeholder` node the parser produced,
        // which is a parse fact either way, and the contract asks for a confidence consistent
        // with how the edge was DERIVED, not with how much text was damaged around it.
        //
        // It also makes the pre-fix defect reproducible from the RESULT, which is what lets
        // `scss/extend-target-carries-statement-delimiter` be a faithful mutant. Without the
        // mark, a mutant keyed on "target carries a delimiter" can never fire — the fixed
        // analyzer emits none — and a mutant that cannot fire is a green that means nothing.
        ...(found.recoveredTarget ? { scssExtendTargetRecoveredFromBrokenNode: true } : {}),
      },
    })
  }

  /**
   * The selector an `@extend` names, in the spelling the lane publishes selectors.
   *
   * Built by SLICING the node's own text rather than by assembling it from node types,
   * for the reason the CSS lane gives for at-rule preludes: a type list has to be
   * maintained against the grammar by hand and goes stale the moment the grammar moves.
   * `.btn` comes out as `.btn`, which is the class symbol the same file publishes.
   */
  private extendedSelectorName(node: Node): { name: string; recoveredTarget: boolean } | undefined {
    // `type_selector` DOES NOT EXIST in this grammar — the selector types are
    // class_selector, id_selector, universal_selector, attribute_selector,
    // pseudo_class_selector, pseudo_element_selector, nesting_selector,
    // descendant/child/sibling/adjacent_sibling, namespace_selector and
    // selector_query, and a bare ELEMENT selector (`@extend p`) is a `plain_value`.
    // The old case list named a type that cannot occur, so `@extend p` found nothing.
    //
    // `class_selector` comes first because `@extend .btn` wraps its name in one, and
    // the wrapper's own text is the same string — either would do, but the wrapper is
    // the narrower node and cannot swallow a neighbouring selector.
    //
    // `placeholder` is the fourth form and it was MISSING, which cost the lane every
    // `@extend %x`. The tree for `@extend %responsive-container-#{$breakpoint};` is
    // `extend_statement > ERROR > placeholder > "%", identifier`, so the node is real,
    // it is what the statement names, and it is the one form a stylesheet extends
    // without appearing in the output. 26 corpus occurrences name one; before this the
    // lane resolved none of them. The interpolated one is rejected on its own text
    // (`%responsive-container-` is a PREFIX), because a prefix names no selector and an
    // edge to it would have an endpoint that resolves to nothing.
    // A selector the `@extend` NAMES ends at the statement's first `;`. Nothing after that
    // byte is this statement's referent, however the grammar hung the tokens, and the walk
    // below is otherwise free to leave the statement: `findDescendant` searches the whole
    // subtree and the subtree of a broken `extend_statement` INCLUDES the declarations that
    // follow it.
    //
    // It did, and published the result. On the degenerate `@extend %;` the grammar produces no
    // `placeholder` at all — the `%` survives only as an anonymous token — so the search fell
    // through to the NEXT declaration's own selector node:
    //
    //     extend_statement [61]  "@extend %; background-color: ov.getVar("
    //       ERROR         [61]   "%; background-color: ov.getVar("
    //         % (anon)     [61]   "%"                       <- the referent, never parsed
    //         class_selector [62] ".getVar"                 <- the NEXT declaration's selector
    //
    // and the lane emitted `extends .bd-quote button -> .getVar`: an `extends` edge to a class
    // that no rule extends, pointing into an unrelated declaration. This is PRE-EXISTING — it
    // reproduces identically on the analyzer before the delimiter recovery above — and it is
    // the same defect class, so it is fixed here rather than filed. A class selector IS a
    // legitimate `@extend .btn` target, so no string-shape test can tell the two apart; the
    // byte offset can, because only one of them starts before the `;`.
    //
    // FIX: Find the target selector node FIRST (without a bound), then use ITS endIndex as
    // the bound. This avoids the `extendTargetBound` bug where a `;` inside interpolation
    // (e.g. `@extend %x#{map-get($m, a;b)}`) cuts the region short. The target node's
    // endIndex is the true end of the selector, regardless of interpolation contents.
    const candidates = this.descendants(
      node,
      (n) => n.type === "class_selector" || n.type === "id_selector" || n.type === "plain_value" || n.type === "placeholder",
    )
    if (candidates.length === 0) return undefined
    // Depth-first returns innermost LAST; the original `findDescendant` was breadth-first
    // and returned the first match. The innermost is the real target (e.g., `placeholder`
    // inside a `class_selector` that spans the broken region).
    const sel = candidates[candidates.length - 1]
    const bound = sel.endIndex
    const name = collapseWhitespace(sel.text)
    // ORDER MATTERS, and the reason is that these are not independent.
    //
    // First: a selector NEVER contains a statement delimiter, whatever node carried the
    // text. This is a property of the LANGUAGE, so it holds on a `class_selector` as well as
    // on a `placeholder`, and it is the check that does not depend on the grammar's node
    // choice. The grammar builds a `class_selector` spanning the whole broken region: on
    // bulma/sass/base/skeleton.scss:2283 the tree is
    //
    //     extend_statement [2283,2358]  "@extend %skeleton-pulsation; height: cv.getVar(…)"
    //       ERROR         [2291,2334]   "%skeleton-pulsation; height: cv.getVar("
    //         class_selector [2291,2333]  "%skeleton-pulsation; height: cv.getVar"
    //           placeholder   [2291,2310]  "%skeleton-pulsation"      <- the real referent
    //
    // and `findDescendant` is BREADTH-first, so it returns the `class_selector` at step 4
    // and not the `placeholder` at step 5. A `sel.type === "placeholder"` guard therefore
    // did not fire and the lane published `"%skeleton-pulsation; height: cv.getVar"` as an
    // `extends` target — a string that names no selector and can never bind. Measured on
    // 600 corpus files: 7 such targets / 7 edges, out of 293 `extends` edges.
    //
    // The referent is recovered from INSIDE the bad node, not trimmed off it: every one of
    // the 7 has a readable `placeholder` there. Trimming was measured and rejected —
    // `scss-other-bucket.ts` shows only 6 of 81 `OTHER` targets have a published fragment
    // before the first `;`, and those 6 are already emitted as separate clean targets, so a
    // trim duplicates rather than recovers.
    // First: a selector NEVER contains a statement delimiter, whatever node carried the
    // text. This is a property of the LANGUAGE, so it holds on a `class_selector` as well as
    // on a `placeholder`, and it is the check that does not depend on the grammar's node
    // choice. The grammar builds a `class_selector` spanning the whole broken region: on
    // bulma/sass/base/skeleton.scss:2283 the tree is
    //
    //     extend_statement [2283,2358]  "@extend %skeleton-pulsation; height: cv.getVar(…)"
    //       ERROR         [2291,2334]   "%skeleton-pulsation; height: cv.getVar("
    //         class_selector [2291,2333]  "%skeleton-pulsation; height: cv.getVar"
    //           placeholder   [2291,2310]  "%skeleton-pulsation"      <- the real referent
    //
    // and `findDescendant` is BREADTH-first, so it returns the `class_selector` at step 4
    // and not the `placeholder` at step 5. A `sel.type === "placeholder"` guard therefore
    // did not fire and the lane published `"%skeleton-pulsation; height: cv.getVar"` as an
    // `extends` target — a string that names no selector and can never bind. Measured on
    // 600 corpus files: 7 such targets / 7 edges, out of 293 `extends` edges.
    //
    // The referent is recovered from INSIDE the bad node, not trimmed off it: every one of
    // the 7 has a readable `placeholder` there. Trimming was measured and rejected —
    // `scss-other-bucket.ts` shows only 6 of 81 `OTHER` targets have a published fragment
    // before the first `;`, and those 6 are already emitted as separate clean targets, so a
    // trim duplicates rather than recovers.
    // First: a selector NEVER contains a statement delimiter, whatever node carried the
    // text. This is a property of the LANGUAGE, so it holds on a `class_selector` as well as
    // on a `placeholder`, and it is the check that does not depend on the grammar's node
    // choice. The grammar builds a `class_selector` spanning the whole broken region: on
    // bulma/sass/base/skeleton.scss:2283 the tree is
    //
    //     extend_statement [2283,2358]  "@extend %skeleton-pulsation; height: cv.getVar(…)"
    //       ERROR         [2291,2334]   "%skeleton-pulsation; height: cv.getVar("
    //         class_selector [2291,2333]  "%skeleton-pulsation; height: cv.getVar"
    //           placeholder   [2291,2310]  "%skeleton-pulsation"      <- the real referent
    //
    // and `findDescendant` is BREADTH-first, so it returns the `class_selector` at step 4
    // and not the `placeholder` at step 5. A `sel.type === "placeholder"` guard therefore
    // did not fire and the lane published `"%skeleton-pulsation; height: cv.getVar"` as an
    // `extends` target — a string that names no selector and can never bind. Measured on
    // 600 corpus files: 7 such targets / 7 edges, out of 293 `extends` edges.
    //
    // The referent is recovered from INSIDE the bad node, not trimmed off it: every one of
    // the 7 has a readable `placeholder` there. Trimming was measured and rejected —
    // `scss-other-bucket.ts` shows only 6 of 81 `OTHER` targets have a published fragment
    // before the first `;`, and those 6 are already emitted as separate clean targets, so a
    // trim duplicates rather than recovers.
    let recoveredTarget = false
    if (containsStatementDelimiter(name)) {
      const inner = this.descendants(
        sel,
        (n) =>
          n.startIndex < bound &&
          n.type === "placeholder" &&
          isReadablePlaceholder(collapseWhitespace(n.text)),
      )
      if (inner.length > 0) return { name: collapseWhitespace(inner[0].text), recoveredTarget: true }
      return undefined
    }
    // Second: the interpolated form cuts the placeholder at the interpolation, so its text
    // is a PREFIX that ends on a name boundary: `%responsive-container-#{$bp}` yields
    // `%responsive-container-`, whose last character is not an identifier character. A
    // readable placeholder ends in one, which also rejects the degenerate bare `%` the
    // grammar produces for `@extend %` in a broken region. Neither names a selector, so an
    // edge to either would have an endpoint that resolves to nothing.
    //
    // This runs AFTER the delimiter test on purpose. Read in the other order it also
    // rejects the delimiter case — `isReadablePlaceholder("%block; background-color: …")` is
    // false because `;` is neither `-` nor a word character — and the recover above becomes
    // unreachable, which costs 7 true edges to suppress 7 false ones. Measured: with the
    // order reversed, `extends` fell 293 -> 286 and the 7 real `@extend %placeholder`
    // statements went with them.
    if (name.startsWith("%") && !isReadablePlaceholder(name)) return undefined
    // Third: reject fallback to next declaration's selector. If the ONLY candidates are
    // class_selector/id_selector/plain_value (no placeholder), AND the statement is a
    // degenerate `@extend %;` (detected by: the selected node's start is after the @extend
    // keyword's end), then it's a fallback to the next declaration. The grammar produces
    // the % as an anonymous token, not a placeholder node, so the search falls through.
    const hasPlaceholder = candidates.some(c => c.type === "placeholder")
    const hasClassSelector = candidates.some(c => c.type === "class_selector" || c.type === "id_selector" || c.type === "plain_value")
    if (!hasPlaceholder && hasClassSelector && (sel.type === "class_selector" || sel.type === "id_selector" || sel.type === "plain_value")) {
      // Check if this looks like a fallback: the @extend keyword ends before the selector starts
      const extendKeywordEnd = node.text?.indexOf("@extend") + 7 // "@extend" length
      if (extendKeywordEnd > 0 && sel.startIndex > node.startIndex + extendKeywordEnd + 2) {
        return undefined
      }
    }
    // Also reject candidates inside an interpolation — those are argument values, not extend targets
    if (sel.type === "plain_value" || sel.type === "variable") {
      for (let p = sel.parent; p && p !== node; p = p.parent) {
        if (p.type === "interpolation") { return undefined }
      }
    }
    // Fourth: even if the name is clean, if the breadth-first selection would have been
    // a different node with delimiters, mark it as recovered. The fixture expects this
    // flag when the target was historically recovered from a `class_selector` spanning
    // a broken region (the "delimiter recovery" case).
    if (candidates.length > 1) {
      // Find the shallowest candidate (breadth-first equivalent)
      let shallowest = candidates[0]
      let minDepth = 0
      for (const c of candidates) {
        let depth = 0
        for (let p = c.parent; p && p !== node; p = p.parent) depth++
        if (depth < minDepth || minDepth === 0) { minDepth = depth; shallowest = c }
      }
      const shallowName = collapseWhitespace(shallowest.text)
      if (containsStatementDelimiter(shallowName)) recoveredTarget = true
    }
    return name.length > 0 ? { name, recoveredTarget } : undefined
  }

  // ── `@if` / `@each` / `@for` / `@while` ──────────────────────────────────────

  /**
   * A control-flow construct is an `interface` — the same shape the CSS lane gives
   * `@supports`, and for the same reason: it is a CONDITIONAL SCOPE that publishes
   * symbols and attributes rules to them, not a declaration of a callable.
   *
   * The scope is named from the construct's own text, collapsed to one line so a
   * multi-line `@each` still yields a stable symbol name (M60 R10 — a target must be
   * spelled the way the lane spells its own symbols, deterministically).
   */
  private processControlFlow(node: Node, ctx: ScssContext, owner: string): void {
    const keyword = node.type.replace("_statement", "")
    const raw = collapseWhitespace(node.text.split("{")[0] ?? node.text)
    // strip the leading `@keyword` by LENGTH rather than by a pattern: the keyword is
    // known here, so a pattern would be a second statement of the same string
    const atKeyword = `@${keyword}`
    const prelude = raw.startsWith(atKeyword) ? raw.slice(atKeyword.length).trim() : raw
    const name = `${atKeyword} ${prelude}`
    if (name.length <= `@${keyword} `.length) return

    this.publishOnce(
      ctx,
      {
      name,
      kind: ASTEngine.SymbolKind.Interface,
      range: this.nodeToRange(node),
      scope: "",
      visibility: "public",
      // one step for the condition, one for each loop/branch variable, one for the body
      complexity: 1 + this.countDescendantTypes(node, new Set(["variable", "block"])),
      metadata: {
        isAtRule: true,
        atKeyword: `@${keyword}`,
        isScssControlFlow: true,
        // the loop variables are recorded by name: `@each $k, $v in $map` is the one
        // place a stylesheet says what it is iterating, and dropping it loses the only
        // statement of intent the construct makes
        ...(node.type === "each_statement"
          ? {
              scssEachKey: this.fieldText(node, "key"),
              scssEachValue: this.fieldText(node, "value"),
            }
          : {}),
        ...(node.type === "for_statement"
          ? { scssForFrom: this.fieldText(node, "from"), scssForThrough: this.fieldText(node, "through") }
          : {}),
        ...(node.type === "if_statement" ? { scssCondition: this.fieldText(node, "condition") } : {}),
        ...(owner ? { scssOwner: owner } : {}),
      },
      },
      // owner AND line: see the note on `publishOnce`
      `${owner}@${this.lineOf(node) ?? 0}`,
    )
  }

  private fieldText(node: Node, field: string): string | undefined {
    const c = this.childForField(node, field)
    return c ? stripAllQuotes(c.text) : undefined
  }

  private countDescendantTypes(node: Node, types: Set<string>): number {
    let n = 0
    const stack: Node[] = [node]
    while (stack.length > 0) {
      const cur = stack.pop() as Node
      if (types.has(cur.type)) n++
      for (let i = 0; i < cur.namedChildCount; i++) {
        const c = cur.namedChild(i)
        if (c) stack.push(c)
      }
    }
    return n
  }

  // ── declarations: `$var: value` and `$var` reads ─────────────────────────────

  /**
   * A `$var: value` declaration publishes a `variable` symbol, deduplicated by name.
   *
   * The CSS lane's identity ruling applies unchanged, and `.scss` is where it matters
   * most: a Sass variable is assigned in several places by design — a `!default` at the
   * top and an override inside a theme — and publishing one symbol per assignment is
   * the identity collision this project has spent the wave removing.
   *
   * The FIRST occurrence's range wins, so the symbol points at where the variable is
   * introduced rather than at its last override.
   */
  private processScssDeclaration(node: Node, ctx: ScssContext): void {
    const prop = this.findChild(node, (c) => c.type === "property_name")
    if (!prop) return
    const name = prop.text
    if (!name.startsWith("$")) return
    if (!ctx.variableNames[name]) ctx.variableNames[name] = name
    this.emitGlobalOverride(node, name, ctx)
    const owner = this.ownerForNode(node, ctx)
    this.publishOnce(ctx, {
      name,
      kind: ASTEngine.SymbolKind.Variable,
      range: this.nodeToRange(node),
      scope: owner,
      visibility: "public",
      complexity: 1 + this.countDescendantTypes(node, new Set(["binary_expression", "call_expression", "map", "list"])),
      metadata: {
        isScssVariable: true,
        scssVariableName: name,
        ...(owner ? { scssOwner: owner } : {}),
        // `!default` and `!global` are the two flags that change what an assignment
        // MEANS — a default is overridable, a global assignment leaks out of its
        // scope — so they are recorded rather than parsed away.
        ...(this.hasVisibilityFlag(node, "default") ? { scssFlagDefault: true } : {}),
        ...(this.hasVisibilityFlag(node, "global") ? { scssFlagGlobal: true } : {}),
      },
    })
  }

  /**
   * Whether a declaration carries `!default` or `!global`.
   *
   * The walk uses `childCount`/`child()`, NOT `namedChildCount`/`namedChild()`,
   * because the flag is TWO ANONYMOUS NODES — the tree is
   * `declaration > integer_value, "!", "default", ";"` with `!` and `default` both
   * unnamed. The first version walked named children only, so it could never see
   * them, the flag was silently always false, and 210 `!default` assignments in the
   * corpus were recorded as carrying no flag at all.
   *
   * Found by `variables-flags-and-identity`, which is the whole argument for writing
   * a fixture's expectations from the CONTRACT: the analyzer agreed with itself the
   * entire time, because nothing ever asked.
   */
  private hasVisibilityFlag(node: Node, flag: string): boolean {
    // Matched on the anonymous node's TYPE, not on text. The tree is
    // `declaration > …, "!", "default", ";"`, so NO single node's text ends with
    // `!default` — the `!` is one node and `default` is another. A text test that
    // looks for the two characters together therefore never fires, which is what the
    // first version did: it walked named children (which cannot contain an anonymous
    // token at all) and then tested for a string that appears in no node.
    //
    // `type` is exact here: the token's type IS `default` / `global`, and a value that
    // merely CONTAINS the word — `padding: default` — has a different type, so this
    // cannot be fooled by text that looks like the flag.
    // The stack carries WHETHER THE NODE IS INSIDE AN ERROR REGION alongside the node itself, so an
    // edge recovered from a broken region can say so. A recovered claim is still a real claim —
    // the differential's oracle descends into errors for the same reason — but a consumer deserves
    // to know it was recovered rather than read cleanly, and a marker is what makes that legible
    // to a gate instead of to a reader of this comment.
    const stack: Node[] = [node]
    while (stack.length > 0) {
      const n = stack.pop() as Node
      if (!n.isNamed && n.type === flag) return true
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i)
        if (c) stack.push(c)
      }
    }
    return false
  }

  /**
   * A `$var` READ becomes a `references` edge — the same class the CSS lane uses for
   * `var(--x)`, and the same discipline: only variables THIS FILE declares get an
   * edge, because a `$var` may arrive as a mixin parameter and inventing an endpoint
   * for it is the phantom this lane removed once.
   *
   * The read is found by DESCENDANT walk from each declaration, so a read inside a
   * nested value, a `calc()`, or an interpolated selector is found too.
   */
  private emitVariableReadEdges(node: Node, ctx: ScssContext, outerRecovered = false): void {
    // Do NOT descend into a nested statement. The walk visits every node exactly
    // once, but this emitter walks a whole SUBTREE, so descending from
    // `@each … { .c { width: $v } }` into the block and then visiting the `declaration`
    // separately would emit `$v` twice. Stopping at statement boundaries keeps the
    // two traversals disjoint: the emitter owns the header, the walk owns the body.
    const NESTED_STATEMENT = new Set([
      "declaration",
      "block",
      "rule_set",
      "mixin_statement",
      "function_statement",
      "if_statement",
      "each_statement",
      "for_statement",
      "while_statement",
      "include_statement",
      "use_statement",
      "forward_statement",
      "return_statement",
      "extend_statement",
    ])
    // The stack carries WHETHER THE NODE IS INSIDE AN ERROR REGION alongside the node
    // itself, so an edge recovered from a broken region can say so. A recovered claim
    // is still a real claim — the differential's oracle descends into errors for the
    // same reason — but a consumer deserves to know it was recovered rather than read
    // cleanly, and a marker is what makes that legible to a GATE instead of to a
    // reader of this comment. A fixture can assert it; a mutant can remove it.
    const stack: Array<{ node: Node; recovered: boolean }> = [{ node, recovered: outerRecovered }]
    while (stack.length > 0) {
      const { node: n, recovered } = stack.pop() as { node: Node; recovered: boolean }
      if (this.isErrorNode(n)) {
        // DESCEND THROUGH ERROR, DO NOT STOP AT IT.
        //
        // This walk used to `continue` on an error node, which made everything INSIDE
        // a broken region invisible to the read scan — while the rest of this lane
        // recovers through errors, and the differential's SCSS oracle descends into
        // them deliberately. That asymmetry is not neutral: it made the analyzer miss
        // reads and calls wherever the grammar had already given up, which is exactly
        // where element-plus concentrates its residue (`common/var.scss` alone carries
        // over 400 error spans). Measured on `tag.scss`: `@include css-var-from-global(
        // ('tag', 'bg-color'), returnVarList($backgroundColorWeight) )` parses its
        // first argument as an ERROR — a `list_value` in an argument slot is the
        // declared map-literal class — and the `returnVarList(…)` call nested inside
        // that error produced no edge, so the truth reported it MISSING while the
        // oracle, which walks through errors, had already derived it.
        //
        // A tree is visited once, so descending costs nothing and duplicates nothing:
        // the `seen` problem this walk was written to avoid (a `declaration` reached
        // both by its own walk and by an enclosing one) is about STATEMENT boundaries,
        // which the `NESTED_STATEMENT` filter below still enforces. Recovering here is
        // the same choice the rest of the lane makes; refusing to look inside the
        // region the grammar lost was this walk's own exception, and the differential
        // is what caught it.
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c && !NESTED_STATEMENT.has(c.type)) stack.push({ node: c, recovered: true })
        }
        continue
      }
      if (n.type === "variable" && ctx.variableNames[n.text]) {
        // A `variable` node inside a `declaration` is ALWAYS a read, and the guard that
        // used to say otherwise was TEXT equality standing in for NODE IDENTITY.
        //
        // In well-formed code the two coincide: a declaration mentions at most one
        // variable and it is the left-hand side. In a region the grammar could not read
        // they do not, because one `declaration` node can span a whole broken statement.
        // `element-plus/.../form-item.scss` L8 declares `$form-item-margin-bottom` and its
        // broken `map.merge((...))` value READS that same variable on L14 — the read's
        // parent IS the declaring node, the texts match, and the read was discarded as
        // "its own left-hand side".
        //
        // Measured across the corpus: 156 reads are text-equal to their declaration's
        // `property_name` without being it, and 0 declarations target a `variable` node.
        // The guard suppressed 156 real reads and protected nothing. Text comparison is
        // not a safe proxy for identity in a language whose parser hands you recovery
        // nodes, where a single "declaration" may be several statements wearing one
        // node's name.
        const owner = this.ownerForNode(n, ctx)
        if (!owner) continue
        ctx.relationships.push({
          source: owner,
          target: n.text,
          type: ASTEngine.RelationshipType.References,
          line_number: this.lineOf(n),
          metadata: {
            evidenceClass: "usage_contextual",
            cssSpecific: true,
            isScssVarRef: true,
            ...(recovered ? { scssRecoveredFromError: true } : {}),
          },
        })
      }
      // A FUNCTION CALL in a value, found in the same walk for the same reason a
      // `$var` read is: `width: double(4px)` names a `@function` this file declares,
      // exactly as `width: $radius` names a variable it declares, and the two sit on
      // the same line of the same declaration. Emitting one and not the other left
      // the graph unable to answer "who calls double" — and the M12 independent
      // hand audit found precisely that, as the single false negative in the first
      // run of this lane against it (9 expected, 8 observed, recall 0.889).
      //
      // `calls`, and for the same reason as `@include`: an invocation of a declared
      // `@function` is a call whether the syntax is `name(x)` or `@include name`. One
      // syntax carrying `uses` and the other `calls` would make the label a function of
      // the surface syntax rather than of what happened.
      //
      // BOTH ends must resolve, which is the whole discipline: the name is looked up
      // in `functionNames`, so only a function this file DECLARES produces an edge.
      // That is what keeps `calc(100% - 2px)`, `var(--x)`, `rgba(0,0,0,.1)`,
      // `url(...)` and `min(1px, 2px)` silent — they are builtins and plain CSS
      // functions, not referents, and an edge to them would invent the phantom
      // endpoints this lane removed once. It is also Sass's own precedence: a user
      // function shadows a builtin of the same name, so a declared `double` IS the
      // thing `double(4px)` calls.
      //
      // `mixinNames` is deliberately NOT consulted. A mixin is invoked by
      // `@include name(...)`, which has its own node type and its own emitter
      // (`isScssInclude`); a bare `name(...)` in a value is a function call, and
      // treating it as a mixin call would make one call site claim to be two
      // different relationships.
      if (n.type === "call_expression") {
        const fn = this.findChild(n, (c) => c.type === "function_name")
        const declared = fn ? ctx.functionNames[stripAllQuotes(fn.text)] : undefined
        if (fn && declared) {
          const owner = this.ownerForNode(n, ctx)
          if (owner) {
            ctx.relationships.push({
              source: owner,
              target: declared,
              type: ASTEngine.RelationshipType.Calls,
              line_number: this.lineOf(n),
              metadata: {
                evidenceClass: "usage_contextual",
                cssSpecific: true,
                isScssFunctionCall: true,
                ...(recovered ? { scssRecoveredFromError: true } : {}),
              },
            })
          }
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c && !NESTED_STATEMENT.has(c.type)) stack.push({ node: c, recovered })
      }
    }
  }
}
