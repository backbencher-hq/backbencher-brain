// Vue Intelligence Engine
// M12.12 rewrite: C#-family contract, pure-AST, fully regex-free.
//   - Two-layer parse: (1) tree-sitter-vue gives the SFC skeleton — the
//     component root, template component usages, and the <script> block whose
//     body is a `raw_text` node with exact byte offsets; (2) the script body
//     is parsed with tree-sitter-javascript/typescript (engine pre-parse, see
//     ASTEngine.parseFile → context.sfcScriptTrees[0]) and extracted via the
//     JS/TS family analyzers, with ranges offset back to SFC lines.
//   - Symbols: component (name = file module, Class), script bindings via the
//     JS/TS contract (no locals/params), Options API declarations owned by the
//     component (methods → Method, computed → Property, data → Method,
//     props → Property, emits → Event, lifecycle hooks → Method).
//     Template elements/attributes/directives are NEVER symbols.
//   - Relationships: template component usages → instantiates (leaf tag
//     names, HTML/Vue builtins filtered); script imports/calls/extends/
//     overrides via the JS/TS contract; compiler macros (defineProps,
//     defineEmits, defineExpose, withDefaults) filtered; contains from
//     ownerName.

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

const VUE_BUILTIN_TAGS = new Set([
  "component", "transition", "transition-group", "keep-alive", "teleport", "suspense",
  "fragment",
])

const VUE_COMPILER_MACROS = new Set([
  "defineProps", "defineEmits", "defineExpose", "withDefaults", "defineModel",
  "defineSlots", "defineOptions",
])

// ============================================================================
// PURE-STRING HELPERS (regex-free)
// ============================================================================

function unquote(text: string): string {
  if (text.length >= 2) {
    const first = text[0]
    if ((first === '"' || first === "'") && text[text.length - 1] === first) {
      return text.slice(1, -1)
    }
  }
  return text
}

// ============================================================================
// ANALYZER
// ============================================================================

export class RealVueAnalyzer implements ASTEngine.LanguageAnalyzer {
  analyze(
    rootNode: Node,
    content: string,
    filePath: string,
    context?: ASTEngine.AnalyzeContext
  ): ASTEngine.ParseResult & { metadata: Partial<ASTEngine.FileMetadata> } {
    const symbols: ASTEngine.UniversalSymbol[] = []
    const relationships: ASTEngine.UniversalRelationship[] = []
    const imports: ASTEngine.ImportInfo[] = []
    const exports: ASTEngine.ExportInfo[] = []
    const errors: ASTEngine.ParseError[] = []

    const patterns: Record<string, boolean> = {}
    const moduleName = path.basename(filePath, path.extname(filePath))
    patterns["Vue SFC"] = true

    // --- Error collection (vue grammar) --------------------------------------
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
      metadata: { isVueComponent: true, isSfc: true },
    })

    // --- 2. Template pass: component usages → instantiates --------------------
    // Walk the SFC tree; skip <script>/<style> subtrees; every non-builtin
    // element tag is a component usage (leaf tag name as written).
    const templateStack: Node[] = [rootNode]
    const seenUsages = new Set<string>()
    let templateDecisions = 0
    while (templateStack.length > 0) {
      const n = templateStack.pop()!
      const t = n.type
      if (t === "script_element" || t === "style_element") continue
      if (t === "directive_attribute") {
        // v-if / v-else-if / v-for / v-show are TEMPLATE DECISION POINTS —
        // they branch rendering exactly like if/loops in code.
        const dname = this.findChildByType(n, "directive_name")?.text
        if (dname === "v-if" || dname === "v-else-if" || dname === "v-for" || dname === "v-show") templateDecisions++
      }
      if (t === "element") {
        const tag = this.elementTagName(n)
        if (tag && !HTML_BUILTIN_TAGS.has(tag) && !VUE_BUILTIN_TAGS.has(tag) && !seenUsages.has(tag)) {
          seenUsages.add(tag)
          relationships.push({
            source: moduleName,
            target: tag,
            type: ASTEngine.RelationshipType.Instantiates,
            confidence: 0.95,
            metadata: { isComponentUsage: true },
          })
        }
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const child = n.namedChild(i)
        if (child) templateStack.push(child)
      }
    }

    // --- 3. Script pass: nested JS/TS parse (engine-provided trees) ------------
    // EVERY <script> block is processed (a plain block plus <script setup>
    // is THE standard Vue 3 layout — only [0] was read, silently dropping
    // the entire setup block), dispatched to the language analyzer matching
    // the block's lang attribute.
    const scriptTreeCount = context?.sfcScriptTrees?.length ?? 0
    const pushedComponentNames = new Set<string>([moduleName])
    let scriptCyclomaticSum = 0
    for (let bi = 0; bi < scriptTreeCount; bi++) {
      const scriptTree: Tree = context!.sfcScriptTrees![bi]
      const scriptStartLine: number = context!.sfcScriptLines![bi]
      const scriptStartColumn: number = context!.sfcScriptCols![bi] ?? 0
      const isTs = context?.sfcScriptLangs?.[bi] === "ts"
      {
      const scriptContent = scriptTree.rootNode?.text ?? ""
      const lineOffset = scriptStartLine - 1
      const colOffset = scriptStartColumn
      const defaultExport = this.findExportDefault(scriptTree.rootNode)
      // defineComponent({...}) wraps the options object in a call_expression;
      // descend to the first object node anywhere under the export statement
      // so both `export default {...}` and `export default defineComponent(
      // {...})` forms resolve (previously only the bare form worked).
      const defaultObject = defaultExport ? this.findDescendantObject(defaultExport) : undefined
      if (defaultObject) patterns["Options API"] = true
      else patterns["Composition API"] = true
      // The script body is extracted via the JS-family contract (M12.10)
      // regardless of `lang` — the JS grammar tolerates TS type annotations
      // (verified: zero ERROR nodes on lang=ts fixtures) and, unlike the TS
      // analyzer, resolves method_definition scopes inside the Options-API
      // default-export object (calls source from the method name, not module).
      // TS-only declarations (interface/type) are not extracted as symbols.
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

      scriptCyclomaticSum += Math.max(0, ((sub.metadata as any)?.cyclomaticComplexity ?? 1) - 1)

      // 3a. Options API declarations (component-owned). The component
      // identity comes from the `name:` option when present, else the
      // file-derived module name — parity with class-based frameworks where
      // the component type itself is a first-class symbol (#383 payload
      // family / cross-language consistency).
      if (defaultObject) {
        let componentName = moduleName
        const namePair = defaultObject.namedChildren.find(
          (c: any) => c.type === "pair" && c.childForFieldName("key")?.text === "name",
        )
        if (namePair) {
          const v = namePair.childForFieldName("value")
          if (v) componentName = v.text.replace(/['"]/g, "")
        }
        // DEDUPE: the SFC skeleton already pushed a Class symbol for
        // moduleName — pushing again without a `name:` option produced TWO
        // identical component Class symbols.
        if (!pushedComponentNames.has(componentName)) {
          pushedComponentNames.add(componentName)
          symbols.push({
            name: componentName,
            kind: ASTEngine.SymbolKind.Class,
            range: this.offsetRange(this.nodeToRange(defaultObject), lineOffset, colOffset),
            visibility: "public",
            metadata: { nodeType: "vue_options_component", isOptionsComponent: true },
          })
        }
        this.extractOptionsApi(defaultObject, componentName, symbols, patterns, lineOffset, colOffset)
      }

      // 3b. Merge JS analyzer output, offset to SFC lines, filter:
      //     - symbols inside the default-export object (re-emitted above)
      //     - compiler-macro call rels (defineProps etc.)
      const defaultStart = defaultObject ? defaultObject.startIndex : -1
      const defaultEnd = defaultObject ? defaultObject.endIndex : -1

      for (const s of sub.symbols ?? []) {
        if (defaultStart !== -1 && (s.range.startIndex ?? 0) >= defaultStart && (s.range.endIndex ?? 0) <= defaultEnd) continue
        s.range.startLine += lineOffset
        s.range.endLine += lineOffset
        if (s.range.startLine === 1 + lineOffset) s.range.startColumn += colOffset
        symbols.push(s)
      }
      for (const r of sub.relationships ?? []) {
        const tgt = (r.target ?? "") as string
        if (VUE_COMPILER_MACROS.has(tgt)) continue
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
      }
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
      framework: "Vue",
      patterns: [{ type: "usage", detected: true, description: p }],
    }))

    this.classifyEvidenceTier(relationships)

    return {
      language: "vue",
      symbols,
      relationships,
      imports,
      exports,
      errors,
      metadata: {
        // Real cyclomatic complexity: script-block decisions (per JS/TS
        // contract) plus template decision directives (v-if/v-for/v-show).
        // Was hardcoded 1 / the synthetic symbols+relationships heuristic.
        complexity: 1 + scriptCyclomaticSum + templateDecisions,
        linesOfCode: content.split("\n").length,
        cyclomaticComplexity: 1 + scriptCyclomaticSum + templateDecisions,
        framework: "Vue",
        patterns: detectedPatterns,
        detectedFrameworks: ["Vue"],
        frameworkPatterns,
        architecturalInsights: [],
        architecturalScore,
        codeQuality: errors.length === 0 ? "Excellent" : "Fair",
        hasTypeInference: false,
        hasFrameworkIntelligence: true,
        analysisVersion: "5.0.0-m12.12-family-contract",
      },
    }
  }

  // ============================================================================
  // OPTIONS API EXTRACTION
  // ============================================================================

  private extractOptionsApi(
    objectNode: Node,
    componentName: string,
    symbols: ASTEngine.UniversalSymbol[],
    patterns: Record<string, boolean>,
    lineOffset: number,
    colOffset: number,
  ): void {
    const memberName = (n: Node): string | undefined => {
      const key = n.childForFieldName("key")
      if (key) return key.text
      const name = n.childForFieldName("name")
      if (name) return name.text
      return this.findChildByType(n, "property_identifier")?.text
    }

    for (let i = 0; i < objectNode.namedChildCount; i++) {
      const child = objectNode.namedChild(i)
      if (!child) continue
      if (child.type !== "pair" && child.type !== "method_definition") continue
      const key = memberName(child)
      if (!key) continue

      const value =
        child.type === "pair" ? child.childForFieldName("value") : undefined

      if (key === "methods" && value) {
        patterns["Options API"] = true
        this.emitObjectMembers(value, componentName, symbols, ASTEngine.SymbolKind.Method, "method", lineOffset, colOffset)
      } else if (key === "computed" && value) {
        patterns["Options API"] = true
        this.emitObjectMembers(value, componentName, symbols, ASTEngine.SymbolKind.Property, "computed", lineOffset, colOffset)
      } else if (key === "data") {
        // data() is the reactive-state factory
        symbols.push({
          name: "data",
          kind: ASTEngine.SymbolKind.Method,
          range: this.offsetRange(this.nodeToRange(child), lineOffset, colOffset),
          scope: componentName,
          ownerName: componentName,
          ownerKind: ASTEngine.SymbolKind.Class,
          visibility: "public",
          metadata: { isOptionsData: true },
        })
      } else if (key === "props") {
        // props: array of names OR object of prop declarations
        const names = this.propNames(value ?? child)
        for (const pn of names) {
          symbols.push({
            name: pn,
            kind: ASTEngine.SymbolKind.Property,
            range: this.offsetRange(this.nodeToRange(child), lineOffset, colOffset),
            scope: componentName,
            ownerName: componentName,
            ownerKind: ASTEngine.SymbolKind.Class,
            visibility: "public",
            metadata: { isProp: true },
          })
        }
      } else if (key === "emits") {
        const names = this.propNames(value ?? child)
        for (const en of names) {
          symbols.push({
            name: en,
            kind: ASTEngine.SymbolKind.Event,
            range: this.offsetRange(this.nodeToRange(child), lineOffset, colOffset),
            scope: componentName,
            ownerName: componentName,
            ownerKind: ASTEngine.SymbolKind.Class,
            visibility: "public",
            metadata: { isEmit: true },
          })
        }
      } else if (this.isLifecycleHook(key)) {
        symbols.push({
          name: key,
          kind: ASTEngine.SymbolKind.Method,
          range: this.offsetRange(this.nodeToRange(child), lineOffset, colOffset),
          scope: componentName,
          ownerName: componentName,
          ownerKind: ASTEngine.SymbolKind.Class,
          visibility: "public",
          metadata: { isLifecycleHook: true },
        })
      }
    }
  }

  private emitObjectMembers(
    valueNode: Node,
    componentName: string,
    symbols: ASTEngine.UniversalSymbol[],
    kind: ASTEngine.SymbolKind,
    meta: string,
    lineOffset: number,
    colOffset: number,
  ): void {
    const seen = new Set<string>()
    for (let i = 0; i < valueNode.namedChildCount; i++) {
      const child = valueNode.namedChild(i)
      if (!child) continue
      let name: string | undefined
      if (child.type === "method_definition" || child.type === "pair") {
        name = child.childForFieldName("name")?.text || child.childForFieldName("key")?.text
      } else if (child.type === "property_identifier") {
        name = child.text
      }
      if (!name || seen.has(name)) continue
      seen.add(name)
      symbols.push({
        name,
        kind,
        range: this.offsetRange(this.nodeToRange(child), lineOffset, colOffset),
        scope: componentName,
        ownerName: componentName,
        ownerKind: ASTEngine.SymbolKind.Class,
        visibility: "public",
        metadata: { [meta]: true },
      })
    }
  }

  private propNames(node: Node | undefined): string[] {
    // Shallow: props: ['a', 'b'] (array of strings) OR
    // props: { a: {...}, b: {...} } (object — direct pair keys only).
    if (!node) return []
    const out: string[] = []
    if (node.type === "array") {
      for (let i = 0; i < node.namedChildCount; i++) {
        const c = node.namedChild(i)
        if (c && c.type === "string") {
          const v = unquote(c.text)
          if (v) out.push(v)
        }
      }
    } else if (node.type === "object") {
      for (let i = 0; i < node.namedChildCount; i++) {
        const c = node.namedChild(i)
        if (c && c.type === "pair") {
          const key = c.childForFieldName("key")?.text
          if (key) out.push(key)
        }
      }
    }
    return out
  }

  private isLifecycleHook(key: string): boolean {
    return (
      key === "beforeCreate" || key === "created" || key === "beforeMount" ||
      key === "mounted" || key === "beforeUpdate" || key === "updated" ||
      key === "beforeUnmount" || key === "unmounted" || key === "activated" ||
      key === "deactivated" || key === "errorCaptured" || key === "renderTracked" ||
      key === "renderTriggered" || key === "watch" || key === "beforeDestroy" ||
      key === "destroyed"
    )
  }

  // ============================================================================
  // HELPERS
  // ============================================================================

  /**
   * M14 #299 - evidence-tier classification for EVERY emitted relationship.
   * Same rules as the JVM family. Vue template instantiates are
   * usage_contextual (component usage by tag name, not construction).
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
        // vue: template tag usages are component REFERENCES, not constructions
        md.evidenceClass = md.isComponentUsage ? "usage_contextual" : "structural"
        continue
      }
      md.evidenceClass = "usage_contextual"
    }
  }


  private findDescendantObject(root: Node): Node | undefined {
    const stack: Node[] = [root]
    while (stack.length > 0) {
      const n = stack.pop()!
      if (n.type === "object") return n
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const c = n.namedChild(i)
        if (c) stack.push(c)
      }
    }
    return undefined
  }

  private findExportDefault(root: Node): Node | null {
    const stack: Node[] = [root]
    while (stack.length > 0) {
      const n = stack.pop()!
      // Leading whitespace/newline inside <script> made the old
      // text.startsWith("export default") check MISS every SFC whose
      // script body began on the next line. Check structurally instead.
      if (n.type === "export_statement" && n.text.trimStart().startsWith("export default")) return n
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const c = n.namedChild(i)
        if (c) stack.push(c)
      }
    }
    return null
  }

  private elementTagName(element: Node): string | undefined {
    const tagNode = this.findChildByType(element, "start_tag") || this.findChildByType(element, "self_closing_tag")
    if (!tagNode) return undefined
    return this.findChildByType(tagNode, "tag_name")?.text
  }

  private offsetRange(
    range: ASTEngine.UniversalSymbol["range"],
    lineOffset: number,
    colOffset: number,
  ): ASTEngine.UniversalSymbol["range"] {
    const out = { ...range }
    out.startLine += lineOffset
    out.endLine += lineOffset
    if (range.startLine === 1) out.startColumn += colOffset
    return out
  }

  private findChildByType(node: Node, type: string): Node | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child && child.type === type) return child
    }
    return null
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

