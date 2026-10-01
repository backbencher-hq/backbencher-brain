import type { Node } from "web-tree-sitter"
import path from "node:path"
import { ASTEngine } from "./engine"

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

// ============================================================================
// PURE-STRING HELPERS (regex-free)
// ============================================================================

// Unquote a quoted attribute value with pure-String ops (single or double
// quotes; the grammar sometimes exposes the raw quoted text when the value
// is empty and has no attribute_value child).
function unquote(text: string): string {
  if (text.length >= 2) {
    const first = text[0]
    if ((first === '"' || first === "'") && text[text.length - 1] === first) {
      return text.slice(1, -1)
    }
  }
  return text
}

// First whitespace-delimited token of a string (srcset candidate URL).
function firstToken(text: string): string {
  let start = -1
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c !== " " && c !== "\t" && c !== "\n" && c !== "\r" && c !== "\f") {
      start = i
      break
    }
  }
  if (start === -1) return ""
  let end = start
  while (end < text.length) {
    const c = text[end]
    if (c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f") break
    end++
  }
  return text.slice(start, end)
}

export class RealHtmlAnalyzer implements ASTEngine.LanguageAnalyzer {
  analyze(rootNode: Node, content: string, filePath: string): ASTEngine.ParseResult {
    const symbols: ASTEngine.UniversalSymbol[] = []
    const relationships: ASTEngine.UniversalRelationship[] = []
    const imports: ASTEngine.ImportInfo[] = []
    const exports: ASTEngine.ExportInfo[] = []
    const errors: ASTEngine.ParseError[] = []

    // --- Error collection (html grammar) --------------------------------------
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

    // Module-level source for file-scoped relationships (script/link/img at
    // the document root). Uses the file stem — stable across absolute paths.
    const moduleName = path.basename(filePath, path.extname(filePath)) || "document"

    // $O(1)$ Hash Maps for late binding (id -> symbol name)
    const idMap: Record<string, string> = {} // id -> mapped symbol name
    const deferredLinks: { source: string; targetId: string; type: ASTEngine.RelationshipType; metadata: any }[] = []

    // Single-pass DFS stack. parentId = the nearest ancestor element that
    // produced a symbol name (id or class); anonymous structural tags pass
    // their parent's identity through so containment chains skip noise.
    const stack: { node: Node; parentId?: string; parentTagName?: string }[] = [{ node: rootNode }]

    while (stack.length > 0) {
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

          // Trait Detection & Metrics (O(1) inside the pass)
          const isSemantic = this.isSemanticElement(currentTagName)
          const isInteractive = this.isInteractiveElement(currentTagName)
          const isForm = this.isFormElement(currentTagName)
          const rawId = attributes["id"] ?? ""
          const rawClass = attributes["class"] ?? attributes["className"] ?? ""
          const hasId = rawId.length > 0
          const hasClass = rawClass.length > 0

          if (isSemantic) semanticCount++
          if (isInteractive) interactiveCount++
          if (isForm) hasForm = true

          if (attributes["aria-label"] || attributes["role"]) ariaCount++
          if (attributes["ng-app"] || attributes["ng-controller"]) frameworks["AngularJS"] = true
          if (hasId) frameworks["Targeted/ID-Styling"] = true

          if (currentTagName.indexOf("-") !== -1 && currentTagName !== "annotation-xml") {
            frameworks["Web Components"] = true
            insights["Shadow DOM / Custom Elements utilized"] = true
          }

          let hasVue = false
          for (const key in attributes) {
            if (key.startsWith("v-") || key.startsWith("@") || key.startsWith(":")) hasVue = true
          }
          if (hasVue) frameworks["Vue.js"] = true

          // Symbol identity: an element is a symbol iff it carries an explicit
          // id or class. Named by the id, else the class attribute (the full
          // value, mirroring M11). Anonymous structural tags are noise — not
          // symbols, and they inherit their parent's identity for containment.
          let symName = ""
          if (hasId) symName = rawId
          else if (hasClass) symName = rawClass
          if (symName) {
            currentId = symName
            idMap[rawId] = symName
            symbols.push({
              name: symName,
              kind: ASTEngine.SymbolKind.Class,
              range,
              scope: "",
              visibility: "public",
              ownerName: parentId,
              ownerKind: parentId ? ASTEngine.SymbolKind.Class : undefined,
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
            })
          } else {
            // Anonymous element: keep the parent's identity so child symbols
            // chain to the nearest significant ancestor (no noise symbols).
            currentId = parentId || undefined
          }

          // Structural Relationship: containment to the nearest significant
          // ancestor (only between symbols — anonymous elements were skipped
          // above, so parentId is always a symbol name when set).
          if (parentId && currentId && currentId !== parentId) {
            relationships.push({
              source: parentId,
              target: currentId,
              type: ASTEngine.RelationshipType.Contains,
              confidence: 1.0,
              metadata: { htmlSpecific: true, isDOMHierarchy: true },
            })
          }

          // Resource relationships: external URLs are Uses; the page-level
          // module (file stem) is the fallback source for root-level
          // resources (script/link/img without an id/class parent).
          const executionSource = currentId || moduleName

          if (currentTagName === "img") {
            imgCount++
            if (attributes["alt"]) imgWithAltCount++
            const imgSrc = attributes["src"] ?? ""
            if (imgSrc.length > 0) {
              imports.push({ module: imgSrc, items: ["*"], isDefaultImport: true, isNamespaceImport: false, range, metadata: { isImage: true } })
              relationships.push({ source: executionSource, target: imgSrc, type: ASTEngine.RelationshipType.Uses, metadata: { htmlSpecific: true, resourceType: "img" } })
            }
            const srcsetRaw = attributes["srcset"] ?? ""
            if (srcsetRaw.length > 0) {
              // srcset: "url1 480w, url2 1080w" — each candidate URL is a
              // responsive image import (pure-String token scan, no regex).
              const srcset = srcsetRaw
              let i = 0
              while (i < srcset.length) {
                while (i < srcset.length && (srcset[i] === " " || srcset[i] === "," || srcset[i] === "\t" || srcset[i] === "\n")) i++
                if (i >= srcset.length) break
                const token = firstToken(srcset.slice(i))
                if (token) {
                  imports.push({ module: token, items: ["*"], isDefaultImport: true, isNamespaceImport: false, range, metadata: { isResponsiveImage: true } })
                  relationships.push({ source: executionSource, target: token, type: ASTEngine.RelationshipType.Uses, metadata: { htmlSpecific: true, resourceType: "img-srcset" } })
                }
                i += token.length
                while (i < srcset.length && srcset[i] !== ",") i++
              }
            }
          } else if (currentTagName === "iframe" && !attributes["loading"]) {
            iframeWithoutLoadingCount++
          } else if (currentTagName === "script") {
            const scriptSrc = attributes["src"] ?? ""
            if (scriptSrc.length > 0) {
              hasExternals = true
              imports.push({ module: scriptSrc, items: ["*"], isDefaultImport: true, isNamespaceImport: false, range, metadata: { isScript: true } })
              relationships.push({ source: executionSource, target: scriptSrc, type: ASTEngine.RelationshipType.Uses, metadata: { htmlSpecific: true, resourceType: "script" } })
            }
          } else if (currentTagName === "style") {
            // inline styles carry no external resource
          } else if (currentTagName === "link") {
            const linkHref = attributes["href"] ?? ""
            if (linkHref.length > 0) {
              hasExternals = true
              const isStylesheet = attributes["rel"] === "stylesheet"
              imports.push({ module: linkHref, items: ["*"], isDefaultImport: true, isNamespaceImport: false, range, metadata: { isStylesheet } })
              relationships.push({ source: executionSource, target: linkHref, type: ASTEngine.RelationshipType.Uses, metadata: { htmlSpecific: true, resourceType: isStylesheet ? "stylesheet" : "link" } })
            }
          } else if (currentTagName === "form") {
            const formAction = attributes["action"] ?? ""
            if (formAction.length > 0) {
              imports.push({ module: formAction, items: ["*"], isDefaultImport: true, isNamespaceImport: false, range, metadata: { isFormAction: true } })
              relationships.push({ source: executionSource, target: formAction, type: ASTEngine.RelationshipType.Calls, metadata: { htmlSpecific: true, isFormAction: true } })
            }
          } else if (currentTagName === "label" && attributes["for"]) {
            deferredLinks.push({ source: executionSource, targetId: attributes["for"], type: ASTEngine.RelationshipType.Uses, metadata: { htmlSpecific: true, isLabelAssociation: true } })
          } else if (currentTagName === "audio" || currentTagName === "video") {
            const mediaSrc = attributes["src"] ?? ""
            if (mediaSrc.length > 0) {
              imports.push({ module: mediaSrc, items: ["*"], isDefaultImport: true, isNamespaceImport: false, range, metadata: { isMedia: true } })
              relationships.push({ source: executionSource, target: mediaSrc, type: ASTEngine.RelationshipType.Uses, metadata: { htmlSpecific: true, resourceType: currentTagName } })
            }
          } else if (currentTagName === "source") {
            const sourceSrc = attributes["src"] ?? ""
            if (sourceSrc.length > 0 && (parentTagName === "picture" || parentTagName === "audio" || parentTagName === "video")) {
              imports.push({ module: sourceSrc, items: ["*"], isDefaultImport: true, isNamespaceImport: false, range, metadata: { isMediaSource: true } })
              relationships.push({ source: executionSource, target: sourceSrc, type: ASTEngine.RelationshipType.Uses, metadata: { htmlSpecific: true, resourceType: parentTagName, mediaQuery: attributes["media"] } })
            }          } else if (currentTagName === "a") {
            const href = attributes["href"] ?? ""
            if (href.length > 0) {
              if (href.startsWith("#") && href.length > 1) {
                deferredLinks.push({ source: executionSource, targetId: href.slice(1), type: ASTEngine.RelationshipType.Uses, metadata: { htmlSpecific: true, isInternalAnchor: true } })
              } else if (!href.startsWith("#") && !href.startsWith("javascript:")) {
                relationships.push({ source: executionSource, target: href, type: ASTEngine.RelationshipType.Uses, metadata: { htmlSpecific: true, isNavigation: true } })
              }
            }
          }
        }
      }

      // Continue DFS Traversal without mapping full children arrays into memory
      const children = node.namedChildren
      for (let i = children.length - 1; i >= 0; i--) {
        const child = children[i]
        if (child) {
          stack.push({ node: child, parentId: currentId, parentTagName: currentTagName })
        }
      }
    }

    // Deferred Link Resolution (O(L) where L = labels/anchors, near instant)
    for (let i = 0; i < deferredLinks.length; i++) {
      const link = deferredLinks[i]
      const resolvedTarget = idMap[link.targetId]
      if (resolvedTarget) {
        relationships.push({ source: link.source, target: resolvedTarget, type: link.type, metadata: link.metadata })
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

  // Optimized attribute extraction without Array.filter. The grammar exposes
  // attribute values as `quoted_attribute_value > attribute_value` nodes whose
  // text is already unquoted — no regex quote-stripping needed.
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
                // quoted_attribute_value > attribute_value: the inner node is
                // the unquoted value; for unquoted attributes attribute_value
                // is the direct child. Empty values may lack the inner node,
                // so fall back to a pure-String unquote of the quoted text.
                const inner = this.findChildByType(attrChild, "attribute_value")
                attrValue = inner ? inner.text : unquote(attrChild.text)
              }
            }
            if (attrName) attrs[attrName] = attrValue
          }
        }
      }
    }
    return attrs
  }

  private findChildByType(node: Node, type: string): Node | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (c && c.type === type) return c
    }
    return null
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
