// @ts-nocheck — Ported from backbencher. Kept structurally identical for sync.
import type { Node } from "web-tree-sitter"
import { UniversalSymbol, SymbolKind, RelationshipType, ParseResult, ImportInfo, ExportInfo, ParseError, FileMetadata, UniversalRelationship, Parameter, LanguageAnalyzer } from "../types.js"

const SEMANTIC_ELEMENTS: Record<string, boolean> = {
  "header": true,
  "nav": true,
  "main": true,
  "section": true,
  "article": true,
  "aside": true,
  "footer": true,
  "h1": true,
  "h2": true,
  "h3": true,
  "h4": true,
  "h5": true,
  "h6": true,
  "figure": true,
  "figcaption": true,
  "time": true,
  "data": true,
  "mark": true,
  "details": true,
  "summary": true,
  "dialog": true,
  "meter": true,
  "progress": true
}

const INTERACTIVE_ELEMENTS: Record<string, boolean> = {
  "button": true,
  "input": true,
  "select": true,
  "textarea": true,
  "a": true,
  "details": true,
  "summary": true,
  "dialog": true,
  "menu": true
}

const FORM_ELEMENTS: Record<string, boolean> = {
  "form": true,
  "input": true,
  "select": true,
  "textarea": true,
  "button": true,
  "fieldset": true,
  "legend": true,
  "label": true,
  "datalist": true,
  "optgroup": true,
  "option": true,
  "output": true,
  "meter": true,
  "progress": true
}

export class RealHtmlAnalyzer implements LanguageAnalyzer {
  analyze(rootNode: Node, content: string, filePath: string): ParseResult {
    const symbols: UniversalSymbol[] = []
    const relationships: UniversalRelationship[] = []
    const imports: ImportInfo[] = []
    const exports: ExportInfo[] = []
    const errors: ParseError[] = []

    // Metrics & Architectural Insights State
    let semanticCount = 0
    let interactiveCount = 0
    let ariaCount = 0
    let imgCount = 0
    let imgWithAltCount = 0
    let iframeWithoutLoadingCount = 0
    let totalElements = 0
    let hasForm = false
    let hasExternals = false
    const frameworks: Record<string, boolean> = { "HTML5": true }
    const insights: Record<string, boolean> = {}

    // $O(1)$ Hash Maps for late binding
    const idMap: Record<string, string> = {} // id -> mapped Node ID
    const deferredLinks: { source: string; targetId: string; type: RelationshipType; metadata: any }[] = []

    // Single-pass DFS stack
    const stack: { node: Node; parentId?: string; parentTagName?: string }[] = [{ node: rootNode }]

    let elementCounter = 0

    // Gather errors initially if present
    // Removed unreachable debugging code

    const tMain = Date.now(); let iters = 0; while (stack.length > 0) {
      // No-op: removed TUI-polluting log
      const { node, parentId, parentTagName } = stack.pop()!

      let currentId = parentId
      let currentTagName = parentTagName

      if (node.type === "element" || node.type === "script_element" || node.type === "style_element") {
        totalElements++
        const tagNameNode = this.getElementTagName(node)

        if (tagNameNode) {
          currentTagName = tagNameNode.text.toLowerCase()
          const attributes = this.extractElementAttributes(node)
          const range = this.nodeToRange(node)

          // 3. Trait Detection & Metrics ($O(1)$ directly inside the pass)
          const isSemantic = this.isSemanticElement(currentTagName)
          const isInteractive = this.isInteractiveElement(currentTagName)
          const isForm = this.isFormElement(currentTagName)
          const hasId = !!attributes["id"]
          const hasClass = !!attributes["class"] || !!attributes["className"]

          if (isSemantic) semanticCount++
          if (isInteractive) interactiveCount++
          if (isForm) hasForm = true

          if (attributes["aria-label"] || attributes["role"]) ariaCount++
          if (attributes["ng-app"] || attributes["ng-controller"]) frameworks["AngularJS"] = true
          if (attributes["id"]) frameworks["Targeted/ID-Styling"] = true

          if (currentTagName.indexOf("-") !== -1 && currentTagName !== "annotation-xml") {
            frameworks["Web Components"] = true
            insights["Shadow DOM / Custom Elements utilized"] = true
          }

          let hasVue = false
          for (const key in attributes) {
            if (key.startsWith("v-") || key.startsWith("@") || key.startsWith(":")) hasVue = true
          }
          if (hasVue) frameworks["Vue.js"] = true

          currentId = attributes["id"] || `${currentTagName}_${elementCounter++}`

          // Map standard ID for late-binding passes
          if (hasId) {
            idMap[attributes["id"]] = currentId
          }

          // 1. Symbol Registration (All elements extracted)
          const symbol: UniversalSymbol = {
            name: currentId,
            kind: SymbolKind.Class,
            range,
            scope: "",
            visibility: "public",
            ownerName: parentId,
            ownerKind: parentId ? SymbolKind.Class : undefined,
            metadata: {
              tagName: currentTagName,
              attributes,
              htmlSpecific: true,
              isSemantic,
              isInteractive,
              isForm,
              isId: hasId,
              isClass: hasClass,
            },
          }
          symbols.push(symbol)

          // Extract individual classes as symbols to satisfy tests
          const classStr = attributes["class"] || attributes["className"]
          if (classStr) {
            const classNamesParts = classStr.split(/\s+/)
            const classNames: string[] = []
            for (let i = 0; i < classNamesParts.length; i++) {
                if (classNamesParts[i]) classNames.push(classNamesParts[i])
            }
            for (let i = 0; i < classNames.length; i++) {
              const cn = classNames[i]
              symbols.push({
                name: cn,
                kind: SymbolKind.Variable,
                range,
                scope: "",
                visibility: "public",
                ownerName: currentId,
                metadata: { htmlSpecific: true, isClass: true },
              })
            }
          }

          // 2. Structural Relationship (Topology mapped to nearest significant ancestor)
          if (parentId) {
            relationships.push({
              source: parentId,
              target: currentId,
              type: RelationshipType.Contains,
              metadata: { htmlSpecific: true, isDOMHierarchy: true },
            })
          }

          // Specific Element Rules (Extract relationships regardless of whether the element itself is a Symbol)
          const executionSource = currentId || filePath // Fallback to file if no parent

          if (currentTagName === "img") {
            imgCount++
            if (attributes["alt"]) imgWithAltCount++
            if (attributes["srcset"]) {
              const candidates = attributes["srcset"].split(",");
              for (var _ci = 0; _ci < candidates.length; _ci++) {
                var srcUrl = candidates[_ci].trim().split(/\s+/)[0];
                if (srcUrl) { imports.push({ module: srcUrl, items: ["*"], isDefaultImport: true, isNamespaceImport: false, range, metadata: { isResponsiveImage: true } }); }
              }
            }
          } else if (currentTagName === "iframe" && !attributes["loading"]) {
            iframeWithoutLoadingCount++
          } else if (currentTagName === "script") {
            if (attributes["src"]) {
              hasExternals = true
              imports.push({
                module: attributes["src"],
                items: ["*"],
                isDefaultImport: true,
                isNamespaceImport: false,
                range,
                metadata: { isScript: true },
              })
              relationships.push({
                source: executionSource,
                target: attributes["src"],
                type: RelationshipType.Uses,
                metadata: { htmlSpecific: true, resourceType: "script" },
              })
            } else {
              // Brain Injection Hook: Inline Script content mapped for JS parser pass
              symbols[symbols.length - 1].metadata!.embeddedScriptContent = true
            }
          } else if (currentTagName === "style") {
            symbols[symbols.length - 1].metadata!.embeddedStyleContent = true
          } else if (currentTagName === "link" && attributes["href"]) {
            hasExternals = true
            const isStylesheet = attributes["rel"] === "stylesheet"
            imports.push({
              module: attributes["href"],
              items: ["*"],
              isDefaultImport: true,
              isNamespaceImport: false,
              range,
              metadata: { isStylesheet },
            })
            relationships.push({
              source: executionSource,
              target: attributes["href"],
              type: RelationshipType.Uses,
              metadata: { htmlSpecific: true, resourceType: isStylesheet ? "stylesheet" : "link" },
            })
          } else if (currentTagName === "form" && attributes["action"]) {
            imports.push({
              module: attributes["action"],
              items: ["*"],
              isDefaultImport: true,
              isNamespaceImport: false,
              range,
              metadata: { isFormAction: true },
            })
            relationships.push({
              source: executionSource,
              target: attributes["action"],
              type: RelationshipType.Calls,
              metadata: { htmlSpecific: true, isFormAction: true },
            })
          } else if (currentTagName === "label" && attributes["for"]) {
            deferredLinks.push({
              source: executionSource,
              targetId: attributes["for"],
              type: RelationshipType.Uses,
              metadata: { htmlSpecific: true, isLabelAssociation: true },
            })
          } else if (currentTagName === "audio" || currentTagName === "video") {
            if (attributes["src"]) {
              imports.push({ module: attributes["src"], items: ["*"], isDefaultImport: true, isNamespaceImport: false, range, metadata: { isMedia: true } })
              relationships.push({ source: executionSource, target: attributes["src"], type: RelationshipType.Uses, metadata: { htmlSpecific: true, resourceType: currentTagName } })
            }
          } else if (currentTagName === "source" && attributes["src"]) {
            if (parentTagName === "picture" || parentTagName === "audio" || parentTagName === "video") {
              imports.push({ module: attributes["src"], items: ["*"], isDefaultImport: true, isNamespaceImport: false, range, metadata: { isMediaSource: true } })
              relationships.push({ source: executionSource, target: attributes["src"], type: RelationshipType.Uses, metadata: { htmlSpecific: true, resourceType: parentTagName, mediaQuery: attributes["media"] } })
            }
          } else if (currentTagName === "a" && attributes["href"]) {
            if (attributes["href"].startsWith("#") && attributes["href"].length > 1) {
              deferredLinks.push({
                source: executionSource,
                targetId: attributes["href"].substring(1),
                type: RelationshipType.Uses,
                metadata: { htmlSpecific: true, isInternalAnchor: true },
              })
            } else if (!attributes["href"].startsWith("#") && !attributes["href"].startsWith("javascript:")) {
              relationships.push({
                source: executionSource,
                target: attributes["href"],
                type: RelationshipType.Uses,
                metadata: { htmlSpecific: true, isNavigation: true },
              })
            }
          }
        }
      }

      // Continue DFS Traversal without mapping full children arrays into memory
      const children = node.namedChildren; for (let i = children.length - 1; i >= 0; i--) {
        const child = children[i]
        if (child) {
          stack.push({ node: child, parentId: currentId, parentTagName: currentTagName })
        }
      }
    }

    // Deferred Link Resolution ($O(L)$ where L = labels/anchors, near instant)
    for (let i = 0; i < deferredLinks.length; i++) {
      const link = deferredLinks[i]
      const resolvedTarget = idMap[link.targetId]
      if (resolvedTarget) {
        relationships.push({
          source: link.source,
          target: resolvedTarget,
          type: link.type,
          metadata: link.metadata,
        })
      }
    }

    // Single-pass Metric Compilation
    let semanticScore = 50
    let accessibilityScore = 50
    let performanceScore = 80

    if (totalElements > 0) {
      if (semanticCount / totalElements > 0.1) semanticScore += 30
      if (semanticCount / totalElements > 0.2) semanticScore += 20
    }
    if (imgCount > 0) accessibilityScore += (imgWithAltCount / imgCount) * 30
    else accessibilityScore += 20
    if (ariaCount > 0) accessibilityScore += 20

    performanceScore -= iframeWithoutLoadingCount * 20

    const architecturalScore = Math.round((semanticScore + accessibilityScore + performanceScore) / 3)

    if (semanticCount > 0) insights["Well-structured semantic document"] = true
    if (ariaCount > 0) insights["Commitment to accessibility detected"] = true
    if (hasExternals) {
      insights["External resources linked"] = true
      let hasExternalScript = false
      let hasExternalStyle = false
      for (let i = 0; i < imports.length; i++) {
          if (imports[i].metadata?.isScript) hasExternalScript = true
          if (imports[i].metadata?.isStylesheet) hasExternalStyle = true
      }
      if (hasExternalScript) insights["External interactivity linked"] = true
      if (hasExternalStyle) insights["External styling linked"] = true
    }
    if (hasForm) insights["Contains user input forms"] = true

    const patterns: string[] = []
    if (hasForm) patterns.push("Form Controls Usage")
    if (semanticCount > 0) patterns.push("Semantic HTML5 Structure")
    if (ariaCount > 0) patterns.push("ARIA Accessibility Enhancements")
    
    const detectedFrameworks: string[] = []
    for (const f in frameworks) detectedFrameworks.push(f)
    
    const architecturalInsights: string[] = []
    for (const insight in insights) architecturalInsights.push(insight)

    for (var _hi = 0; _hi < symbols.length; _hi++) { var hs = symbols[_hi]; if (!hs.metadata?.isClass) { exports.push({ name: hs.name, kind: hs.kind, range: hs.range, visibility: "public" }); } }
    return {
      language: "html",
      symbols,
      relationships,
      imports,
      exports,
      errors,
      metadata: {
        complexity: symbols.length,
        linesOfCode: content.split("\n").length,
        cyclomaticComplexity: 1,
        framework: "HTML5",
        patterns,
        detectedFrameworks,
        frameworkPatterns: [],
        architecturalInsights,
        architecturalScore,
        codeQuality: architecturalScore > 80 ? "Excellent" : architecturalScore > 60 ? "Good" : "Fair",
        hasTypeInference: false,
        hasFrameworkIntelligence: true,
        accessibilityScore: Math.min(100, accessibilityScore),
        semanticScore: Math.min(100, semanticScore),
        performanceScore: Math.min(100, performanceScore),
        analysisVersion: "4.0.1-html-perfect-pass",
      },
    }
  }

  // Optimized cursors over array allocations
  private getElementTagName(node: Node): Node | null {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (child?.type === "start_tag" || child?.type === "self_closing_tag") {
        for (let j = 0; j < child.childCount; j++) {
          const grandChild = child.child(j)
          if (grandChild?.type === "tag_name") return grandChild
        }
      }
    }
    return null
  }

  // Optimized attribute extractions without Array.filter
  private extractElementAttributes(node: Node): Record<string, string> {
    const attrs: Record<string, string> = {}
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (child?.type === "start_tag" || child?.type === "self_closing_tag") {
        for (let j = 0; j < child.childCount; j++) {
          const grandChild = child.child(j)
          if (grandChild?.type === "attribute") {
            let attrName = ""
            let attrValue = ""
            for (let k = 0; k < grandChild.childCount; k++) {
              const attrChild = grandChild.child(k)
              if (attrChild?.type === "attribute_name") attrName = attrChild.text
              else if (attrChild?.type === "quoted_attribute_value" || attrChild?.type === "attribute_value") {
                attrValue = attrChild.text.replace(/^["']|["']$/g, "")
              }
            }
            if (attrName) attrs[attrName] = attrValue
          }
        }
      }
    }
    return attrs
  }

  private isSemanticElement(tagName: string): boolean {
    return !!SEMANTIC_ELEMENTS[tagName]
  }

  private isInteractiveElement(tagName: string): boolean {
    return !!INTERACTIVE_ELEMENTS[tagName]
  }

  private isFormElement(tagName: string): boolean {
    return !!FORM_ELEMENTS[tagName]
  }

  private nodeToRange(node: Node): UniversalSymbol["range"] {
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