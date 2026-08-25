// Svelte Intelligence Engine
// M12.13 rewrite: C#-family contract, pure-AST, fully regex-free.
//   - Two-layer parse: (1) tree-sitter-svelte gives the SFC skeleton — the
//     component root, template component usages, event-directive handlers,
//     and the <script> blocks whose bodies are `raw_text` nodes with exact
//     byte offsets; (2) each script body is parsed with
//     tree-sitter-javascript/typescript (engine pre-parse, see
//     ASTEngine.parseFile → context.sfcScriptTrees) and extracted via the
//     JS/TS family analyzer, with ranges offset back to SFC lines.
//   - Symbols: component (name = file module, Class); script bindings via the
//     JS contract (no locals/params); Svelte props (export let → Property,
//     $props() destructure → Property); reactive declarations ($: target →
//     Variable); rune/`$` reactive vars via the JS contract.
//     Template elements/attributes/directives are NEVER symbols.
//   - Relationships: template component usages → instantiates (leaf tag
//     names, HTML/Svelte builtins filtered); on: event directives → calls
//     (leaf handler identifier from the expression); script imports/calls/
//     exports via the JS contract; compiler macros/rune calls ($state,
//     $derived, $effect, $props, $inspect, $bindable, $host, $render)
//     filtered; contains from ownerName.
//
// Svelte 5 runes ($state/$derived/$effect/$props) are compiler macros — the
// vars they initialize are first-class symbols, the rune CALLS are not.

import type { Node, Tree } from "web-tree-sitter"
import * as path from "path"
import { ASTEngine } from "./engine"
import { RealJavaScriptAnalyzer } from "./real-javascript-analyzer"
import { RealTypeScriptAnalyzer } from "./real-typescript-analyzer"

// ============================================================================
// BUILTIN TAG FILTERS — template component-usage detection
// ============================================================================

const HTML_BUILTIN_TAGS = new Set([
  "a", "abbr", "address", "area", "article", "aside", "audio", "b", "base", "bdi", "bdo",
  "blockquote", "body", "br", "button", "canvas", "caption", "cite", "code", "col",
  "colgroup", "data", "datalist", "dd", "del", "details", "dfn", "dialog", "div", "dl",
  "dt", "em", "embed", "fieldset", "figcaption", "figure", "footer", "form", "h1", "h2",
  "h3", "h4", "h5", "h6", "head", "header", "hgroup", "hr", "html", "i", "iframe", "img",
  "input", "ins", "kbd", "label", "legend", "li", "link", "main", "map", "mark", "menu",
  "meta", "meter", "nav", "noscript", "object", "ol", "optgroup", "option", "output", "p",
  "picture", "pre", "progress", "q", "rp", "rt", "ruby", "s", "samp", "script", "search",
  "section", "select", "slot", "small", "source", "span", "strong", "style", "sub",
  "summary", "sup", "table", "tbody", "td", "template", "textarea", "tfoot", "th", "thead",
  "time", "title", "tr", "track", "u", "ul", "var", "video", "wbr",
  // SVG
  "svg", "path", "g", "rect", "circle", "ellipse", "line", "polyline", "polygon",
  "text", "tspan", "use", "defs", "linearGradient", "radialGradient", "stop", "mask",
  "pattern", "marker", "view", "symbol", "clipPath",
])

const SVELTE_BUILTIN_TAGS = new Set([
  "slot", "svelte:component", "svelte:self", "svelte:element", "svelte:window",
  "svelte:document", "svelte:body", "svelte:head", "svelte:options", "svelte:fragment",
  "svelte:boundary",
])

// Svelte compiler macros / runes — calls to these are never relationships.
const SVELTE_RUNES = new Set([
  "$state", "$state.raw", "$state.snapshot", "$derived", "$derived.by",
  "$effect", "$effect.pre", "$effect.tracking", "$effect.root", "$effect.untracked",
  "$props", "$props.id", "$props.is_safe", "$bindable", "$host", "$inspect",
  "$inspect.trace", "$render", "$props",
])

// ============================================================================
// PURE-STRING HELPERS (regex-free)
// ============================================================================

function isIdentifier(text: string): boolean {
  if (text.length === 0) return false
  const first = text[0]
  if (!((first >= "a" && first <= "z") || (first >= "A" && first <= "Z") || first === "_" || first === "$")) return false
  for (let i = 1; i < text.length; i++) {
    const c = text[i]
    if (!((c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9") || c === "_" || c === "$")) return false
  }
  return true
}

// ============================================================================
// ANALYZER
// ============================================================================

export class RealSvelteAnalyzer implements ASTEngine.LanguageAnalyzer {
  analyze(
    rootNode: Node,
    content: string,
    filePath: string,
    context?: ASTEngine.AnalyzeContext,
  ): ASTEngine.ParseResult & { metadata: Partial<ASTEngine.FileMetadata> } {
    const symbols: ASTEngine.UniversalSymbol[] = []
    const relationships: ASTEngine.UniversalRelationship[] = []
    const imports: ASTEngine.ImportInfo[] = []
    const exports: ASTEngine.ExportInfo[] = []
    const errors: ASTEngine.ParseError[] = []

    const patterns: Record<string, boolean> = {}
    const moduleName = path.basename(filePath, path.extname(filePath))
    patterns["Svelte SFC"] = true

    // --- Error collection (svelte grammar) -----------------------------------
    if (rootNode.hasError) {
      const errStack: Node[] = [rootNode]
      while (errStack.length > 0) {
        const n = errStack.pop()!
        if (n.type === "ERROR" || n.isMissing) {
          errors.push({
            message: `Syntax ${n.type} detected. The Brain Engine is bypassing this broken node.`,
            range: this.nodeToRange(n),
            severity: "warning",
          })
        }
        for (let i = n.namedChildCount - 1; i >= 0; i--) {
          const child = n.namedChild(i)
          if (child) errStack.push(child)
        }
      }
    }

    // --- 1. Component symbol ---------------------------------------------------
    symbols.push({
      name: moduleName,
      kind: ASTEngine.SymbolKind.Class,
      range: this.nodeToRange(rootNode),
      scope: "",
      visibility: "public",
      metadata: { isSvelteComponent: true, isSfc: true },
    })

    // --- 2. Template pass: component usages → instantiates; on: → calls ------
    // Walk the SFC tree; skip <script>/<style> subtrees; every non-builtin
    // element tag is a component usage (leaf tag name as written). on: event
    // directives produce a call to the leaf handler identifier in the
    // expression value.
    const templateStack: Node[] = [rootNode]
    const seenUsages = new Set<string>()
    let templateDecisions = 0
    while (templateStack.length > 0) {
      const n = templateStack.pop()!
      const t = n.type
      if (t === "script_element" || t === "style_element") continue
      // {#snippet name(params)} — reusable template functions; the name is
      // a component-owned Method, and {@render name(...)} calls it.
      if (t === "snippet_statement") {
        const nm = this.findDescendant(n, (c) => c.type === "snippet_name")
        if (nm && !seenUsages.has("snippet:" + nm.text)) {
          seenUsages.add("snippet:" + nm.text)
          symbols.push({
            name: nm.text,
            kind: ASTEngine.SymbolKind.Method,
            range: this.nodeToRange(n),
            scope: moduleName,
            ownerName: moduleName,
            ownerKind: ASTEngine.SymbolKind.Class,
            visibility: "public",
            metadata: { isSnippet: true },
          })
        }
      }
      if (t === "render_tag") {
        // render_tag content is OPAQUE TEXT in this grammar (no child
        // nodes) - the snippet name is scanned from the raw tag text.
        const text = n.text.replace("{@render", "").trim()
        let end = 0
        while (end < text.length && (isIdentifier(text.slice(0, end + 1)))) end++
        const targetName = text.slice(0, end)
        const target = targetName ? { text: targetName } : undefined
        if (target && isIdentifier(target.text)) {
          relationships.push({
            source: moduleName,
            target: target.text,
            type: ASTEngine.RelationshipType.Calls,
            confidence: 0.9,
            metadata: { context: "Svelte {@render} tag" },
          })
        }
      }
      // Template DECISION constructs: {#if}/{:else if} branches, {#each}
      // loops, {#await} branches — they branch rendering like code.
      if (
        t === "if_statement" || t === "else_if_block" ||
        t === "each_statement" || t === "await_statement"
      ) {
        templateDecisions++
      }
      if (t === "element" || t === "self_closing_tag") {
        const tag = this.elementTagName(n)
        if (tag && !HTML_BUILTIN_TAGS.has(tag) && !SVELTE_BUILTIN_TAGS.has(tag) && !seenUsages.has(tag)) {
          seenUsages.add(tag)
          relationships.push({
            source: moduleName,
            target: tag,
            type: ASTEngine.RelationshipType.Instantiates,
            confidence: 0.95,
            metadata: { isComponentUsage: true },
          })
        }
        // on: directives — the handler is the first call-target identifier or
        // bare-identifier leaf of the expression value (`on:click={inc}` →
        // inc; `on:click={() => bump()}` → bump; `on:greet={greet}` → greet).
        // NOTE: the svelte grammar exposes template expressions as opaque
        // raw_text_expr leaves (no AST structure), so the handler leaf is
        // extracted with pure-String scanning — the documented fallback for
        // constructs the grammar cannot express. Arrow-param/`=>`/property
        // expressions with no call target and no bare identifier emit nothing.
        const startTag = this.findChildByType(n, "start_tag") || this.findChildByType(n, "self_closing_tag")
        if (startTag) {
          for (let i = 0; i < startTag.namedChildCount; i++) {
            const attr = startTag.namedChild(i)
            if (!attr || attr.type !== "attribute") continue
            const attrName = this.attributeName(attr)
            if (!attrName || !attrName.startsWith("on:")) continue
            const handler = this.onHandlerLeaf(attr)
            if (handler && handler !== moduleName) {
              relationships.push({
                source: moduleName,
                target: handler,
                type: ASTEngine.RelationshipType.Calls,
                confidence: 0.85,
                metadata: { context: `Svelte event directive ${attrName}` },
              })
            }
          }
        }
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const child = n.namedChild(i)
        if (child) templateStack.push(child)
      }
    }

    // --- 3. Script pass: nested JS/TS parse (engine-provided trees) -----------
    // Multiple <script> blocks are allowed (context="module" + instance);
    // each is parsed independently and offset back to SFC lines.
    const scriptTrees: Tree[] = context?.sfcScriptTrees ?? []
    const scriptLines: number[] = context?.sfcScriptLines ?? []
    const scriptCols: number[] = context?.sfcScriptCols ?? []
    let scriptDecisions = 0
    for (let bi = 0; bi < scriptTrees.length; bi++) {
      const scriptTree = scriptTrees[bi]
      const scriptStartLine = scriptLines[bi]
      const scriptStartColumn = scriptCols[bi]
      if (!scriptTree || scriptStartLine === undefined) continue
      const scriptContent = scriptTree.rootNode?.text ?? ""
      const lineOffset = scriptStartLine - 1
      const colOffset = scriptStartColumn ?? 0
      // Dispatch by the block's lang attribute — lang="ts" blocks were run
      // through the JS analyzer even though the engine pre-parses them with
      // the TS grammar, silently dropping TS-only declarations.
      const isTs = context?.sfcScriptLangs?.[bi] === "ts"

      let sub: ASTEngine.ParseResult
      try {
        sub = isTs
          ? new RealTypeScriptAnalyzer().analyze(scriptTree.rootNode, scriptContent, filePath)
          : new RealJavaScriptAnalyzer().analyze(scriptTree.rootNode, scriptContent, filePath, context)
      } catch (e: any) {
        sub = { symbols: [], relationships: [], imports: [], exports: [], errors: [], metadata: {} } as any
        errors.push({
          message: `script sub-parse failed: ${e?.message?.slice(0, 120)}`,
          range: { startLine: scriptStartLine, startColumn: 0, endLine: scriptStartLine, endColumn: 0 },
          severity: "warning",
        })
      }

      // 3a. Svelte-specific symbols from the script tree: $props() destructure
      //     → Property; $: reactive declaration targets → Variable.
      this.extractSvelteDeclarations(scriptTree.rootNode, moduleName, symbols, lineOffset, colOffset)

      // Block-kind: context="module" exports are MODULE API, never
      // component props. Only instance-block export-let/const bindings are
      // the component's public prop surface.
      const isModuleBlock = this.isModuleContextBlock(rootNode, bi)

      // 3b. Merge JS analyzer output, offset to SFC lines, filter rune calls.
      for (const s of sub.symbols ?? []) {
        s.range.startLine += lineOffset
        s.range.endLine += lineOffset
        if (s.range.startLine === 1 + lineOffset) s.range.startColumn += colOffset
        // Svelte prop: `export let x` — JS analyzer reports Variable + export;
        // reclassify as Property (the component's public prop API). Exported
        // bindings (export let/const/function/class) are component-owned
        // (contains + owner) like Vue props.
        if (!isModuleBlock && this.isExported(sub.exports ?? [], s.name)) {
          const wasVariable = s.kind === ASTEngine.SymbolKind.Variable
          if (wasVariable) {
            s.kind = ASTEngine.SymbolKind.Property
            // annotate ONLY actual props - a false isSvelteProp key on
            // every exported binding polluted the payload
            s.metadata = { ...(s.metadata ?? {}), isSvelteProp: true }
          }
          s.ownerName = moduleName
          s.ownerKind = ASTEngine.SymbolKind.Class
          s.scope = moduleName
        }
        symbols.push(s)
      }
      const moduleExportNames = new Set(
        isModuleBlock ? (sub.exports ?? []).map((e) => e.name) : [],
      )
      for (const r of sub.relationships ?? []) {
        const tgt = (r.target ?? "") as string
        if (SVELTE_RUNES.has(tgt)) continue
        // module-block exports are module API, not component members
        if (r.type === ASTEngine.RelationshipType.Contains && isModuleBlock && moduleExportNames.has(tgt)) continue
        // Dotted runes ($derived.by, $effect.root, $props.id): the JS
        // call-target extractor keeps the LAST segment ('by', 'root',
        // 'id'), so the exact-name filter above never fired for them.
        // The full callee expression is preserved in metadata - any call
        // whose callee starts with '$' IS a rune.
        const callee = (r.metadata?.calleeExpression ?? "") as string
        if ((callee && callee.startsWith("$")) || (r.source === "(script)" && SVELTE_RUNES.has(tgt))) continue
        relationships.push(r)
      }
      for (const i of sub.imports ?? []) {
        if (i.range) {
          i.range.startLine += lineOffset
          i.range.endLine += lineOffset
        }
        imports.push(i)
      }
      for (const e of sub.exports ?? []) exports.push(e)
      for (const er of sub.errors ?? []) errors.push(er)
      scriptDecisions += Math.max(0, ((sub.metadata as any)?.cyclomaticComplexity ?? 1) - 1)
    }

    // --- 4. contains from ownerName -------------------------------------------
    for (const s of symbols) {
      if (s.ownerName) {
        relationships.push({
          source: s.ownerName,
          target: s.name,
          type: ASTEngine.RelationshipType.Contains,
          confidence: 1.0,
          metadata: {},
        })
      }
    }

    // --- Metadata ---------------------------------------------------------------
    const architecturalScore = Math.min(100, Math.max(0, 100 - errors.length * 5))
    const detectedPatterns = Object.keys(patterns)
    const frameworkPatterns = detectedPatterns.map((p) => ({
      framework: "Svelte",
      patterns: [{ type: "usage", detected: true, description: p }],
    }))

    // DEDUPE: sub-analyzers emit their own contains edges; combined with
    // the ownerName-based pass above, identical triples appeared twice.
    const relSeen = new Set<string>()
    const uniqueRelationships: ASTEngine.UniversalRelationship[] = []
    for (const r of relationships) {
      const key = `${String(r.type)}|${String(r.source)}|${String(r.target)}`
      if (relSeen.has(key)) continue
      relSeen.add(key)
      uniqueRelationships.push(r)
    }
    relationships.length = 0
    relationships.push(...uniqueRelationships)

    // Evidence tiers on EVERY edge (#419-D) — same rules as the Vue/JVM family.
    this.classifyEvidenceTier(relationships)
    const cyclomaticComplexity = 1 + templateDecisions + scriptDecisions

    return {
      language: "svelte",
      symbols,
      relationships,
      imports,
      exports,
      errors,
      metadata: {
        // Real cyclomatic complexity: script decisions + template decision
        // blocks. Was the synthetic symbols+relationships heuristic with a
        // hardcoded cyclomatic of 1 (fourth analyzer with this disease).
        complexity: cyclomaticComplexity,
        linesOfCode: content.split("\n").length,
        cyclomaticComplexity,
        framework: "Svelte",
        patterns: detectedPatterns,
        detectedFrameworks: ["Svelte"],
        frameworkPatterns,
        architecturalInsights: [],
        architecturalScore,
        hasFrameworkIntelligence: true,
        hasTypeInference: false,
      },
    }
  }

  // ============================================================================
  // SVELTE-SPECIFIC DECLARATION EXTRACTION
  // ============================================================================

  private extractSvelteDeclarations(
    root: Node,
    componentName: string,
    symbols: ASTEngine.UniversalSymbol[],
    lineOffset: number,
    colOffset: number,
  ): void {
    const stack: Node[] = [root]
    while (stack.length > 0) {
      const n = stack.pop()!
      // $props() destructure → Property symbols (`let { a, b } = $props()`)
      if (n.type === "call_expression") {
        const callee = n.childForFieldName?.("function") ?? n.namedChild(0)
        if (callee && (callee.text === "$props" || callee.text === "$props()")) {
          const declarator = this.findAncestor(n, (p) => p.type === "variable_declarator")
          if (declarator) {
            const pattern = declarator.childForFieldName?.("name") ?? this.findChildByType(declarator, "object_pattern")
            if (pattern && pattern.type === "object_pattern") {
              for (let i = 0; i < pattern.namedChildCount; i++) {
                const pn = pattern.namedChild(i)
                if (!pn) continue
                let name: string | undefined
                if (pn.type === "shorthand_property_identifier_pattern") name = pn.text
                else if (pn.type === "object_assignment_pattern") {
                  name = pn.namedChild(0)?.text
                } else if (pn.type === "pair_pattern") {
                  name = pn.childForFieldName?.("key")?.text
                }
                if (!name) continue
                symbols.push({
                  name,
                  kind: ASTEngine.SymbolKind.Property,
                  range: this.offsetRange(this.nodeToRange(declarator), lineOffset, colOffset),
                  scope: componentName,
                  ownerName: componentName,
                  ownerKind: ASTEngine.SymbolKind.Class,
                  visibility: "public",
                  metadata: { isSvelteProp: true, fromRunes: true },
                })
              }
            }
          }
        }
      }
      // $: reactive declaration → Variable (`$: doubled = expr`)
      if (n.type === "labeled_statement") {
        const label = n.namedChild(0)
        if (label && label.text === "$") {
          const assignment = this.findDescendant(n, (c) => c.type === "assignment_expression")
          if (assignment) {
            const left = assignment.childForFieldName?.("left") ?? assignment.namedChild(0)
            if (left && left.type === "identifier") {
              symbols.push({
                name: left.text,
                kind: ASTEngine.SymbolKind.Variable,
                range: this.offsetRange(this.nodeToRange(assignment), lineOffset, colOffset),
                scope: componentName,
                ownerName: componentName,
                ownerKind: ASTEngine.SymbolKind.Class,
                visibility: "public",
                metadata: { isReactiveDeclaration: true },
              })
            }
          }
        }
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const c = n.namedChild(i)
        if (c) stack.push(c)
      }
    }
  }

  /**
   * Is the bi-th <script> block marked context="module"? Module-block
   * exports are module-level API - they must NOT become component props.
   */
  private isModuleContextBlock(rootNode: Node, index: number): boolean {
    // Document-order scan - a LIFO stack walk visits later siblings first,
    // which INVERTED the block indices (module block treated as instance).
    const blocks: Node[] = []
    const walk = (n: Node): void => {
      if (n.type === "script_element") {
        blocks.push(n)
        return
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) walk(c)
      }
    }
    walk(rootNode)
    const block = blocks[index]
    if (!block) return false
    const startTag = this.findChildByType(block, "start_tag")
    return !!startTag && /context=["']module["']/.test(startTag.text)
  }

  private isExported(exportInfos: ASTEngine.ExportInfo[], name: string): boolean {
    for (const e of exportInfos) {
      if (e.name === name && !e.isDefault) return true
    }
    return false
  }

  private onHandlerLeaf(attr: Node): string | undefined {
    // The maintained grammar (v0.6.0, Svelte 5) wraps attribute expression
    // values as `attribute > expression > svelte_raw_text`; older grammars
    // used `expr_attribute_value > raw_text_expr`. Handle both shapes.
    // Pinned wasm shape: attribute > expression (older grammars used
    // expr_attribute_value — dead here per grammar audit).
    const value = this.findChildByType(attr, "expression")
    if (!value) return undefined
    // The svelte grammar exposes template expressions as an opaque
    // raw_text_expr/svelte_raw_text leaf — the handler text must be scanned
    // with pure-String ops (the documented fallback for constructs the
    // grammar can't express).
    let text = ""
    const stack: Node[] = [value]
    while (stack.length > 0) {
      const m = stack.pop()!
      if (m.type === "svelte_raw_text") { text = m.text; break }
      for (let i = m.namedChildCount - 1; i >= 0; i--) {
        const c = m.namedChild(i)
        if (c) stack.push(c)
      }
    }
    if (!text) return undefined
    // 1. First identifier immediately followed by `(` = call target
    //    (`() => bump()` → bump; `() => onSelect(title)` → onSelect).
    // 2. Else, if the whole text is a bare identifier → that identifier
    //    (`nextPage` → nextPage).
    // 3. Else (arrow params, property access, etc.) → nothing.
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]
      if ((ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_" || ch === "$") {
        let end = i
        while (end < text.length) {
          const c = text[end]
          if ((c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9") || c === "_" || c === "$") end++
          else break
        }
        const ident = text.slice(i, end)
        if (end < text.length && text[end] === "(") return ident
        // not a call target — move past this identifier
        i = end
      }
    }
    // Bare-identifier check
    if (isIdentifier(text)) return text
    // Dotted member leaf: `on:click={box.open}` binds the method reference -
    // the CALLABLE LEAF is the last segment. (Previously emitted nothing.)
    const parts = text.split(".")
    if (parts.length > 1 && parts.every((p) => isIdentifier(p))) {
      return parts[parts.length - 1]
    }
    return undefined
  }

  /**
   * #419-D - evidence-tier classification for EVERY emitted relationship.
   * Same rules as the Vue/JVM family. Template instantiates are
   * usage_contextual (component usage by tag name).
   */
  private classifyEvidenceTier(relationships: ASTEngine.UniversalRelationship[]): void {
    for (const r of relationships) {
      const md = r.metadata ?? (r.metadata = {})
      if (md.evidenceClass) continue
      const t = String(r.type ?? r.relationshipType ?? "")
      const conf = typeof r.confidence === "number" ? r.confidence : 1
      if (t === "contains" || t === "exports") { md.evidenceClass = "structural"; continue }
      if (t === "references") {
        md.evidenceClass = md.isImport ? "import_based" : "reference_qualified"
        continue
      }
      if (t === "extends" || t === "implements" || t === "overrides") {
        md.evidenceClass = conf >= 1 ? "structural" : conf >= 0.85 ? "usage_contextual" : "inferred"
        continue
      }
      if (t === "instantiates") {
        md.evidenceClass = md.isComponentUsage ? "usage_contextual" : "structural"
        continue
      }
      md.evidenceClass = "usage_contextual"
    }
  }

  private findAncestor(node: Node, predicate: (n: Node) => boolean): Node | null {
    let current = node.parent
    while (current) {
      if (predicate(current)) return current
      current = current.parent
    }
    return null
  }

  private findDescendant(node: Node, predicate: (n: Node) => boolean): Node | null {
    const stack: Node[] = [node]
    while (stack.length > 0) {
      const n = stack.pop()!
      if (n !== node && predicate(n)) return n
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const c = n.namedChild(i)
        if (c) stack.push(c)
      }
    }
    return null
  }

  private elementTagName(el: Node): string | undefined {
    // element > start_tag/self_closing_tag > tag_name (for regular elements
    // the tag_name is nested inside the start_tag, not a direct child)
    const startTag = this.findChildByType(el, "start_tag") || this.findChildByType(el, "self_closing_tag")
    if (startTag) {
      const tag = this.findChildByType(startTag, "tag_name")
      if (tag) return tag.text
    }
    const direct = this.findChildByType(el, "tag_name")
    return direct ? direct.text : undefined
  }

  private attributeName(attr: Node): string {
    const name = this.findChildByType(attr, "attribute_name")
    return name ? name.text : ""
  }

  private offsetRange(
    range: ASTEngine.UniversalSymbol["range"],
    lineOffset: number,
    colOffset: number,
  ): ASTEngine.UniversalSymbol["range"] {
    return {
      startLine: range.startLine + lineOffset,
      endLine: range.endLine + lineOffset,
      startColumn: range.startLine === 1 ? range.startColumn + colOffset : range.startColumn,
      endColumn: range.startLine === 1 ? range.endColumn + colOffset : range.endColumn,
      startIndex: range.startIndex,
      endIndex: range.endIndex,
    }
  }

  private findChildByType(node: Node, type: string): Node | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (c && c.type === type) return c
    }
    return null
  }

  private nodeToRange(node: Node): ASTEngine.UniversalSymbol["range"] {
    return {
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      // Columns are 1-based everywhere else in the codebase (+1); this
      // analyzer silently emitted 0-based columns.
      startColumn: node.startPosition.column + 1,
      endColumn: node.endPosition.column + 1,
      startIndex: node.startIndex,
      endIndex: node.endIndex,
    }
  }
}
