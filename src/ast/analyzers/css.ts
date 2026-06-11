// @ts-nocheck — Ported from backbencher. Kept structurally identical for sync.
import type { Node } from "web-tree-sitter"
import { UniversalSymbol, SymbolKind, RelationshipType, ParseResult, ImportInfo, ExportInfo, ParseError, FileMetadata, UniversalRelationship, Parameter, LanguageAnalyzer } from "../types.js"

interface CssContext {
  symbols: UniversalSymbol[]
  relationships: UniversalRelationship[]
  imports: ImportInfo[]
  exports: ExportInfo[]
  errors: ParseError[]
  content: string
  keyframeNames: Record<string, boolean>
  mixinNames: Record<string, boolean>
  frameworks: Record<string, boolean>
  patterns: Record<string, boolean>
}

interface StackFrame {
  node: Node
  media: string
  layer: string
  container: string
  currentSelector: string
}

export class RealCssAnalyzer implements LanguageAnalyzer {
  analyze(rootNode: Node, content: string, filePath: string): ParseResult {
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
    }

    const stack: StackFrame[] = [{ node: rootNode, media: "", layer: "", container: "", currentSelector: "" }]

    while (stack.length > 0) {
      const { node, media, layer, container, currentSelector } = stack.pop()!

      if (node.hasError || node.isMissing || node.type === "ERROR") {
        ctx.errors.push({
          message: `Syntax ERROR detected. The Brain Engine is bypassing this broken node.`,
          range: this.nodeToRange(node),
          severity: `warning`,
        })
      }

      let nextMedia = media
      let nextLayer = layer
      let nextContainer = container
      let nextSelector = currentSelector

      switch (node.type) {
        case "rule_set":
          nextSelector = this.processRuleSet(node, media, layer, container, currentSelector, ctx) || nextSelector
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
        case "include_statement":
        case "mixin_statement":
        case "postcss_statement": {
          const scopeUpdate = this.processAtRule(node, currentSelector, ctx)
          if (scopeUpdate.layer) nextLayer = scopeUpdate.layer
          if (scopeUpdate.container) nextContainer = scopeUpdate.container
          break
        }
        case "declaration": {
          // CSS custom property: --name: value
          const propNode = node.childForFieldName("property") || this.v2FindChild(node, "property_name")
          if (propNode && propNode.text.startsWith("--")) {
            ctx.symbols.push({
              name: propNode.text,
              kind: SymbolKind.Variable,
              range: this.nodeToRange(node),
              scope: currentSelector || "root",
              visibility: "public",
              metadata: { isCustomProperty: true, cssSpecific: true },
            })
          }
          this.processDeclaration(node, currentSelector, ctx)
          break
        }
          break
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
            currentSelector: nextSelector,
          })
        }
      }
    }

    // SCSS mixin/include extracted via AST (mixin_statement / include_statement in processAtRule)
    if (false && (filePath.endsWith(".scss") || filePath.endsWith(".sass"))) {
      const getScope = (content: string, index: number) => {
        let depth = 0
        for (let i = index; i >= 0; i--) {
          if (content[i] === "}") depth--
          else if (content[i] === "{") {
            depth++
            if (depth > 0) {
              let j = i - 1
              while (j >= 0 && /[\s]/.test(content[j])) j--
              let start = j
              while (start >= 0 && !/[}{;]/.test(content[start])) start--
              let sel = content.substring(start + 1, j + 1).trim()
              sel = sel.split(/\r?\n/).pop()?.trim() || ""
              if (sel.startsWith("//")) sel = sel.replace(/^\/\/\s*/, "")
              return sel || "SCSS_FILE_SCOPE"
            }
          }
        }
        return "SCSS_FILE_SCOPE"
      }

      const mixinRegex = /@mixin\s+([\w-]+)/g
      let match
      while ((match = mixinRegex.exec(content)) !== null) {
        const name = match[1]
        if (!ctx.symbols.some((s) => s.name === `@mixin ${name}`)) {
          const lines = content.slice(0, match.index).split("\n")
          const startLine = lines.length
          ctx.symbols.push({
            name: `@mixin ${name}`,
            kind: SymbolKind.Function,
            range: {
              startLine,
              startColumn: 1,
              endLine: startLine,
              endColumn: match[0].length,
              startIndex: match.index,
              endIndex: match.index + match[0].length,
            },
            scope: "",
            visibility: "public",
            metadata: { isAtRule: true, atKeyword: "@mixin", fromRegexFallback: true },
          })
        }
      }

      const includeRegex = /@include\s+([\w-]+)/g
      while ((match = includeRegex.exec(content)) !== null) {
        const name = match[1]
        const scope = getScope(content, match.index)
        ctx.relationships.push({
          source: scope,
          target: `@mixin ${name}`,
          type: RelationshipType.Uses,
          metadata: { cssSpecific: true, isMixinRef: true, fromRegexFallback: true },
        })
      }
    }

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

  private determineSelectorKind(
    hasId: boolean,
    hasClass: boolean,
    hasTag: boolean,
    hasPseudoClass: boolean,
    hasPseudoElement: boolean,
    hasAttribute: boolean,
    isComplex: boolean,
  ): SymbolKind {
    if (hasPseudoElement && !hasClass && !hasId && !hasTag) return SymbolKind.Property
    if (hasPseudoClass && !hasClass && !hasId && !hasTag && !hasAttribute) return SymbolKind.Property
    if (hasId && !hasClass && !hasTag && !hasPseudoClass && !hasPseudoElement && !hasAttribute)
      return SymbolKind.Interface
    if (hasTag && !hasClass && !hasId && !hasPseudoClass && !hasPseudoElement && !hasAttribute)
      return SymbolKind.Type
    if (hasAttribute && !hasClass && !hasId && !hasTag && !hasPseudoClass && !hasPseudoElement)
      return SymbolKind.Property
    if (hasClass && !hasId && !hasTag && !hasPseudoClass && !hasPseudoElement && !hasAttribute && !isComplex)
      return SymbolKind.Class
    return SymbolKind.Class
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
    parentSelector: string,
    ctx: CssContext,
  ): string | null {
    const selectorsNode = this.findChild(node, (c) => c?.type === "selectors")
    if (!selectorsNode) return null

    const rawParts = selectorsNode.text.split(",")
    const rawSelectors: string[] = []
    for (let i = 0; i < rawParts.length; i++) {
      rawSelectors.push(rawParts[i].trim())
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
            resolvedSelectors.push(r.replace(/&/g, p))
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
          chain.push(n.text)
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
        for (let i = 0; i < chain.length - 1; i++) {
          ctx.relationships.push({
            source: chain[i],
            target: chain[i + 1],
            type: RelationshipType.Contains,
            metadata: { cssSpecific: true, isSelectorChain: true },
          })
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
        type: RelationshipType.Contains,
        metadata: { cssSpecific: true, isMediaScope: true },
      })
    }
    if (layer) {
      ctx.relationships.push({
        source: layer,
        target: selectorText,
        type: RelationshipType.Contains,
        metadata: { cssSpecific: true, isLayerScope: true },
      })
    }
    if (container) {
      ctx.relationships.push({
        source: container,
        target: selectorText,
        type: RelationshipType.Contains,
        metadata: { cssSpecific: true, isContainerScope: true },
      })
    }
    if (parentSelector) {
      ctx.relationships.push({
        source: parentSelector,
        target: selectorText,
        type: RelationshipType.Contains,
        metadata: { cssSpecific: true, isNestedSelector: true },
      })
    }

    return selectorText
  }

  private processImport(node: Node, ctx: CssContext) {
    const stringNode = this.findChild(node, (c) => c?.type === "string_value" || c?.type === "call_expression")
    if (stringNode) {
      const moduleName = stringNode.text.replace(/["']/g, "").replace(/^url\((.*)\)$/, "$1")
      ctx.imports.push({
        module: moduleName,
        source: moduleName,
        imported: ["*"],
        isTypeOnly: false,
        range: this.nodeToRange(node),
      })
      if (moduleName.indexOf("tailwind") !== -1) ctx.frameworks["Tailwind CSS"] = true
      if (moduleName.indexOf("bootstrap") !== -1) ctx.frameworks["Bootstrap"] = true
      if (moduleName.indexOf("bulma") !== -1) ctx.frameworks["Bulma"] = true
      if (moduleName.indexOf("foundation") !== -1) ctx.frameworks["Foundation"] = true
    }
  }

  private processMedia(node: Node, ctx: CssContext): string | null {
    const queryNode = this.findChild(
      node,
      (c) =>
        c &&
        (c.type === "media_query_list" ||
          c.type === "keyword_query" ||
          c.type === "binary_query" ||
          c.type === "feature_query" ||
          c.type === "parenthesized_query"),
    )
    if (queryNode) {
      const mediaName = `@media ${queryNode.text}`
      ctx.symbols.push({
        name: mediaName,
        kind: SymbolKind.Interface,
        range: this.nodeToRange(node),
        scope: "",
        visibility: "public",
        metadata: { isMedia: true },
      })
      ctx.patterns["Responsive Design (Media Queries)"] = true
      return mediaName
    }
    return null
  }

  private processKeyframes(node: Node, ctx: CssContext) {
    const nameNode = this.findChild(
      node,
      (c) => c && (c.type === "keyframes_name" || c.type === "identifier" || c.type === "string_value"),
    )
    if (nameNode) {
      const name = nameNode.text.replace(/['"]/g, "")
      ctx.symbols.push({
        name: name,
        kind: SymbolKind.Function,
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
    const queryNode = this.findChild(node, (c) => c && c.type !== "at_keyword" && c.type !== "block")
    if (queryNode) {
      ctx.symbols.push({
        name: `@supports ${queryNode.text.trim()}`,
        kind: SymbolKind.Interface,
        range: this.nodeToRange(node),
        scope: "",
        visibility: "public",
        metadata: { isSupports: true },
      })
      ctx.patterns["Feature Queries (@supports)"] = true
    }
  }

  private processAtRule(node: Node, currentSelector: string, ctx: CssContext): { layer?: string; container?: string } {
    const atKeywordNode = this.findChild(node, (c) => c?.type === "at_keyword")

    let keyword = atKeywordNode ? atKeywordNode.text : ""
    if (node.type === "mixin_statement") keyword = "@mixin"
    if (node.type === "include_statement") keyword = "@include"

    if (!keyword) return {}

    let namePart = ""

    if (
      keyword === "@layer" ||
      keyword === "@container" ||
      keyword === "@tailwind" ||
      keyword === "@apply" ||
      keyword === "@theme" ||
      keyword === "@config" ||
      keyword === "@mixin" ||
      keyword === "@include" ||
      keyword === "@forward" ||
      keyword === "@use"
    ) {
      const identifiers: Node[] = []
      for (let i = 0; i < node.childCount; i++) {
        const c = node.child(i)
        if (
          c !== null &&
          (c.type === "identifier" ||
            c.type === "string_value" ||
            c.type === "call_expression" ||
            c.type === "keyword_query")
        ) {
          identifiers.push(c)
        }
      }
      const texts: string[] = []
      for (let i = 0; i < identifiers.length; i++) {
        let nodeToText = identifiers[i]
        if (nodeToText.type === "call_expression") {
          const identChild = this.findChild(
            nodeToText,
            (child) => child?.type === "identifier" || child?.type === "function_name",
          )
          if (identChild) {
            texts.push(identChild.text)
          } else {
            texts.push(nodeToText.text.split("(")[0])
          }
        } else {
          texts.push(nodeToText.text)
        }
      }
      namePart = texts.join(" ")
      const ruleName = `${keyword}${namePart ? " " + namePart : ""}`

      ctx.symbols.push({
        name: ruleName,
        kind: keyword === "@mixin" ? SymbolKind.Function : SymbolKind.Module,
        range: this.nodeToRange(node),
        scope: keyword === "@include" ? currentSelector : "",
        visibility: "public",
        metadata: { isAtRule: true, atKeyword: keyword },
      })

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
        ctx.relationships.push({
          source: currentSelector,
          target: `@mixin ${namePart}`,
          type: RelationshipType.Uses,
          metadata: { cssSpecific: true, isMixinRef: true },
        })
      }

      return {
        layer: keyword === "@layer" ? ruleName : undefined,
        container: keyword === "@container" ? ruleName : undefined,
      }
    }
    return {}
  }

  private processDeclaration(node: Node, currentSelector: string, ctx: CssContext) {
    // Create Uses relationship between selector and property
    if (currentSelector) {
      const propNode = node.childForFieldName("property") || this.v2FindChild(node, "property_name")
      if (propNode) {
        ctx.relationships.push({
          source: currentSelector,
          target: propNode.text,
          type: RelationshipType.Uses,
          confidence: 0.9,
          metadata: { cssSpecific: true, isStyleRule: true },
        })
      }
    }
    const propNode = this.findChild(node, (c) => c?.type === "property_name" || c?.type === "variable_name")
    if (!propNode) return

    const propName = propNode.text

    if (propName === "composes") {
      ctx.patterns["CSS Modules (composes)"] = true
      ctx.frameworks["CSS Modules"] = true
      const valueNodes: Node[] = []
      for (let i = 0; i < node.childCount; i++) {
        const c = node.child(i)
        if (c !== null && c.type !== "property_name" && c.type !== ":") {
          valueNodes.push(c)
        }
      }
      for (let i = 0; i < valueNodes.length; i++) {
        const val = valueNodes[i]
        ctx.relationships.push({
          source: currentSelector,
          target: val.text.trim(),
          type: RelationshipType.Uses,
          metadata: { cssSpecific: true, isComposition: true },
        })
      }
    }

    if (propName.startsWith("--") || propName.startsWith("$") || propName.startsWith("@")) {
      ctx.symbols.push({
        name: propName,
        kind: SymbolKind.Variable,
        range: this.nodeToRange(node),
        scope: currentSelector,
        visibility: "public",
        metadata: { isCustomProperty: true },
      })
      if (propName.startsWith("--")) ctx.patterns["CSS Custom Properties"] = true
      if (propName.startsWith("$")) ctx.frameworks["SCSS/SASS"] = true
      if (propName.startsWith("@")) ctx.frameworks["LESS"] = true
    }

    if ((propName === "animation" || propName === "animation-name") && currentSelector) {
      const valStack = [node]
      while (valStack.length > 0) {
        const n = valStack.pop()!
        if (n.type === "plain_value" || n.type === "identifier" || n.type === "string_value") {
          const text = n.text.trim().replace(/['"]/g, "")
          if (ctx.keyframeNames[text]) {
            ctx.relationships.push({
              source: currentSelector,
              target: text,
              type: RelationshipType.Uses,
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
              type: RelationshipType.Uses,
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
    const selectors: UniversalSymbol[] = []
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
        if (cls.match(/^(sm|md|lg|xl|2xl|hover|focus|dark):/) || cls.match(/^tw-/)) tailwindScore += 5
        if (cls.match(/^(col-(sm|md|lg|xl)-\d+|btn-primary|navbar-expand|container)/)) bootstrapScore += 5
        if (cls.startsWith("Mui")) muiScore += 5
        if (cls.startsWith("v-btn") || cls.startsWith("v-card") || cls.startsWith("v-col")) vuetifyScore += 5
        if (cls.match(/^(is-|has-)(primary|info|success|warning|danger|text-centered)/)) bulmaScore += 5
        if (cls.match(/^(small|medium|large)-\d+$/) || cls === "foundation") foundationScore += 5
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

    const selectors: UniversalSymbol[] = []
    for (let i = 0; i < ctx.symbols.length; i++) {
      if (ctx.symbols[i].metadata?.isSelector) selectors.push(ctx.symbols[i])
    }

    const complexSelectors: UniversalSymbol[] = []
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
