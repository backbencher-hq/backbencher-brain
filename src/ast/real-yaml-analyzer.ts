import type { Node } from "web-tree-sitter"
import { ASTEngine } from "./engine"

interface YamlContext {
  filePath: string
  content: string
  symbols: ASTEngine.UniversalSymbol[]
  relationships: ASTEngine.UniversalRelationship[]
  imports: ASTEngine.ImportInfo[]
  exports: ASTEngine.ExportInfo[]
  metadata: Partial<ASTEngine.FileMetadata>
  anchors: Map<string, ASTEngine.UniversalSymbol>
  anchorKeys: Set<string>
  aliases: { source: string; target: string; node: Node; merge: boolean }[]
  symbolNames: Set<string>
  relationshipKeys: Set<string>
  visitedNodes: number
  documentCount: number
  maxDepth: number
}

interface VisitContext {
  parent: ASTEngine.UniversalSymbol | null
  parentPath: string
  depth: number
  sequenceItem?: boolean
  sequenceIndex?: number
}

const MAPPING_TYPES = new Set(["block_mapping", "flow_mapping"])
const MAPPING_PAIR_TYPES = new Set(["block_mapping_pair", "flow_pair"])
const SEQUENCE_TYPES = new Set(["block_sequence", "flow_sequence"])
const WRAPPER_TYPES = new Set(["block_node", "flow_node"])
const SCALAR_TYPES = new Set([
  "string_scalar", "plain_scalar", "single_quote_scalar", "double_quote_scalar",
  "integer_scalar", "float_scalar", "boolean_scalar", "null_scalar", "block_scalar",
])

/**
 * YAML analyzer backed exclusively by the vendored tree-sitter-yaml AST.
 *
 * YAML is a data language rather than a declaration language. The contract is
 * consequently structural: mapping keys become properties, object-valued keys
 * become class-like containers, sequence-valued keys become variables, and
 * anonymous scalar values remain metadata rather than phantom symbols. Every
 * identity is a qualified path, with `[index]` segments for sequence items.
 */
export class RealYamlAnalyzer implements ASTEngine.LanguageAnalyzer {
  public analyze(
    rootNode: Node,
    content: string,
    filePath: string,
  ): Omit<ASTEngine.ParseResult, "language" | "metadata"> & { metadata: Partial<ASTEngine.FileMetadata> } {
    const ctx: YamlContext = {
      filePath,
      content,
      symbols: [],
      relationships: [],
      imports: [],
      exports: [],
      metadata: {
        detectedFrameworks: [],
        patterns: [],
        architecturalInsights: [],
        devOpsMaturity: 0,
        securityScore: 100,
        hasFrameworkIntelligence: true,
        configurationComplexity: 0,
      },
      anchors: new Map(),
      anchorKeys: new Set(),
      aliases: [],
      symbolNames: new Set(),
      relationshipKeys: new Set(),
      visitedNodes: 0,
      documentCount: 0,
      maxDepth: 0,
    }

    // Parse errors are collected once by ASTEngine. Keeping that ownership in
    // one place avoids duplicate warnings for the same ERROR/MISSING node.
    this.visit(rootNode, { parent: null, parentPath: "", depth: 0 }, ctx)
    this.resolveAliases(ctx)
    this.detectFrameworks(ctx)

    ctx.metadata.configurationComplexity = ctx.visitedNodes
    ctx.metadata.maxDepth = ctx.maxDepth
    ctx.metadata.documentCount = ctx.documentCount
    ctx.metadata.symbolCount = ctx.symbols.length
    ctx.metadata.relationshipCount = ctx.relationships.length

    return {
      symbols: ctx.symbols,
      relationships: ctx.relationships,
      imports: ctx.imports,
      exports: ctx.exports,
      metadata: ctx.metadata,
    }
  }

  private visit(node: Node, visitContext: VisitContext, ctx: YamlContext): void {
    const stack: { node: Node; context: VisitContext }[] = [{ node, context: visitContext }]

    while (stack.length > 0) {
      const item = stack.pop()!
      const curr = item.node
      const current = item.context
      if (curr.isMissing) continue
      ctx.visitedNodes++
      if (current.depth > ctx.maxDepth) ctx.maxDepth = current.depth

      if (current.sequenceItem) {
        this.visitSequenceItem(curr, curr, { ...current, sequenceItem: false }, ctx, stack)
        continue
      }

      if (curr.type === "stream") {
        this.pushChildren(stack, curr, current)
        continue
      }

      if (curr.type === "document") {
        const documentName = this.documentName(ctx.filePath, ctx.documentCount + 1)
        ctx.documentCount++
        if (ctx.documentCount > 1) this.addPattern(ctx, "Multi-document YAML")
        const document = this.createSymbol(
          documentName,
          ASTEngine.SymbolKind.Module,
          curr,
          current.parent,
          current.parentPath,
          ctx,
          { yamlSpecific: true, nodeType: "document", documentIndex: ctx.documentCount },
          current.parent ? undefined : documentName,
        )
        this.pushChildren(stack, curr, {
          parent: document,
          parentPath: document.qualifiedName || document.id || document.name,
          depth: current.depth + 1,
        })
        continue
      }

      if (WRAPPER_TYPES.has(curr.type)) {
        this.pushChildren(stack, curr, current)
        continue
      }

      if (MAPPING_TYPES.has(curr.type)) {
        this.pushMappingChildren(stack, curr, current)
        continue
      }

      if (MAPPING_PAIR_TYPES.has(curr.type)) {
        this.visitMappingPair(curr, current, ctx, stack)
        continue
      }

      if (SEQUENCE_TYPES.has(curr.type)) {
        this.visitSequence(curr, current, ctx, stack)
        continue
      }

      if (curr.type === "block_sequence_item") {
        const child = this.firstNamedChild(curr)
        if (child) {
          this.visitSequenceItem(child, curr, current, ctx, stack)
        }
        continue
      }

      if (curr.type === "anchor") {
        this.visitAnchor(curr, current, ctx, stack)
        continue
      }

      if (curr.type === "alias") {
        this.visitAlias(curr, current, ctx)
        continue
      }

      if (SCALAR_TYPES.has(curr.type)) {
        this.observeScalar(curr, current, ctx)
        continue
      }

      // Keep the traversal total for grammar extensions (tags, directives,
      // comments, and future node types) without treating them as declarations.
      this.pushChildren(stack, curr, current)
    }
  }

  private visitMappingPair(
    node: Node,
    current: VisitContext,
    ctx: YamlContext,
    stack: { node: Node; context: VisitContext }[],
  ): void {
    const keyNode = this.mappingKeyNode(node)
    if (!keyNode) return
    const key = this.scalarText(keyNode)
    if (!key) return

    const valueNode = node.childForFieldName("value") || this.mappingValueNode(node)
    const valueType = valueNode ? this.valueType(valueNode) : "null"
    const isMerge = key === "<<"
    const path = this.childPath(current.parentPath, key)
    const symbolKind = valueType === "object"
      ? ASTEngine.SymbolKind.Class
      : valueType === "array"
        ? ASTEngine.SymbolKind.Variable
        : ASTEngine.SymbolKind.Property

    const symbol = this.createSymbol(
      key,
      symbolKind,
      keyNode,
      current.parent,
      current.parentPath,
      ctx,
      {
        yamlSpecific: true,
        nodeType: node.type,
        valueType,
        fullPath: path,
        isObject: valueType === "object",
        isArray: valueType === "array",
        isMergeKey: isMerge,
        isAlias: valueType === "alias",
        scalarType: valueType === "string" || valueType === "integer" || valueType === "float" || valueType === "boolean" || valueType === "null"
          ? valueType
          : undefined,
      },
      path,
    )

    if (this.isReferenceKey(key, valueNode)) {
      const ref = valueNode ? this.referenceText(valueNode) : ""
      if (ref) {
        ctx.relationships.push({
          source: path,
          target: ref,
          type: ASTEngine.RelationshipType.References,
          confidence: 1,
          metadata: { relationshipType: "yaml_reference", isExternal: !ref.startsWith("#/") },
        })
      }
    }

    if (valueNode) {
      stack.push({
        node: valueNode,
        context: {
          parent: symbol,
          parentPath: path,
          depth: current.depth + 1,
        },
      })
    }
  }

  private visitSequence(
    node: Node,
    current: VisitContext,
    ctx: YamlContext,
    stack: { node: Node; context: VisitContext }[],
  ): void {
    const children: Node[] = []
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child) children.push(child)
    }
    for (let i = children.length - 1; i >= 0; i--) {
      stack.push({
        node: children[i],
        context: { ...current, depth: current.depth + 1, sequenceItem: true, sequenceIndex: i },
      })
    }
    if (children.length > 0 && current.parent) {
      current.parent.metadata = {
        ...(current.parent.metadata || {}),
        itemCount: children.length,
      }
    }
  }

  private visitSequenceItem(
    node: Node,
    itemNode: Node,
    current: VisitContext,
    ctx: YamlContext,
    stack: { node: Node; context: VisitContext }[],
  ): void {
    const valueNode = node.type === "block_sequence_item" ? this.firstNamedChild(node) : node
    if (!valueNode) return
    const index = current.sequenceIndex ?? this.sequenceIndex(itemNode, current.parentPath, ctx)
    const itemPath = `${current.parentPath}[${index}]`
    const valueType = this.valueType(valueNode)

    if (valueType === "object" || valueType === "array") {
      const item = this.createSymbol(
        `item_${index}`,
        valueType === "object" ? ASTEngine.SymbolKind.Class : ASTEngine.SymbolKind.Variable,
        itemNode,
        current.parent,
        current.parentPath,
        ctx,
        {
          yamlSpecific: true,
          nodeType: itemNode.type,
          valueType,
          fullPath: itemPath,
          isArrayItem: true,
          arrayIndex: index,
        },
        itemPath,
      )
      stack.push({
        node: valueNode,
        context: { parent: item, parentPath: itemPath, depth: current.depth + 1 },
      })
      return
    }

    // Anonymous scalar sequence items are values, not declarations. We still
    // inspect them for template/security metadata through the AST node.
    stack.push({ node: valueNode, context: { ...current, depth: current.depth + 1 } })
  }

  private visitAnchor(
    node: Node,
    current: VisitContext,
    ctx: YamlContext,
    stack: { node: Node; context: VisitContext }[],
  ): void {
    const nameNode = this.findNamedChild(node, "anchor_name")
    const name = nameNode ? this.scalarText(nameNode) : ""
    if (name && current.parent) {
      const key = `${current.parent.qualifiedName || current.parent.id}#${name}`
      if (!ctx.anchorKeys.has(key)) {
        ctx.anchorKeys.add(key)
        const anchor = this.createSymbol(
          name,
          ASTEngine.SymbolKind.Constant,
          nameNode || node,
          current.parent,
          current.parentPath,
          ctx,
          { yamlSpecific: true, nodeType: "anchor", isAnchor: true, anchorName: name, fullPath: key },
          key,
        )
        // Resolve ordinary aliases by name after the complete stream has been
        // traversed. The first definition is deterministic for duplicate names.
        if (!ctx.anchors.has(name)) ctx.anchors.set(name, anchor)
        this.addPattern(ctx, "Anchors and Aliases")
      }
    }

    // The anchor_name token is represented by the constant above; recurse only
    // into the anchored value so it is not emitted twice.
    for (let i = node.namedChildCount - 1; i >= 0; i--) {
      const child = node.namedChild(i)
      if (child && child.type !== "anchor_name") {
        stack.push({ node: child, context: current })
      }
    }
  }

  private visitAlias(node: Node, current: VisitContext, ctx: YamlContext): void {
    const nameNode = this.findNamedChild(node, "alias_name")
    const target = nameNode ? this.scalarText(nameNode) : ""
    if (!target || !current.parent) return
    this.addPattern(ctx, "Anchors and Aliases")
    const merge = current.parent.metadata?.isMergeKey === true
    const source = merge
      ? current.parent.ownerName || current.parent.qualifiedName || current.parent.id || current.parent.name
      : current.parent.qualifiedName || current.parent.id || current.parent.name
    ctx.aliases.push({ source, target, node, merge })
  }

  private resolveAliases(ctx: YamlContext): void {
    const seen = new Set<string>()
    for (const alias of ctx.aliases) {
      const anchor = ctx.anchors.get(alias.target)
      const target = anchor?.qualifiedName || alias.target
      const type = alias.merge ? ASTEngine.RelationshipType.Extends : ASTEngine.RelationshipType.Uses
      const key = `${alias.source}\u0000${type}\u0000${target}`
      if (seen.has(key)) continue
      seen.add(key)
      ctx.relationships.push({
        source: alias.source,
        target,
        type,
        confidence: anchor ? 1 : 0.5,
        metadata: {
          relationshipType: alias.merge ? "yaml_merge" : "yaml_alias",
          aliasName: alias.target,
          unresolved: !anchor,
          isExternal: false,
        },
      })
      if (alias.merge) this.addPattern(ctx, "Configuration Inheritance")
    }
  }

  private createSymbol(
    name: string,
    kind: ASTEngine.SymbolKind,
    node: Node,
    parent: ASTEngine.UniversalSymbol | null,
    parentPath: string,
    ctx: YamlContext,
    metadata: Record<string, any>,
    qualifiedName?: string,
  ): ASTEngine.UniversalSymbol {
    const qualified = qualifiedName || (parentPath ? `${parentPath}.${name}` : name)
    const symbol: ASTEngine.UniversalSymbol = {
      id: qualified,
      name,
      kind,
      qualifiedName: qualified,
      ownerName: parent ? (parent.qualifiedName || parent.id || parent.name) : undefined,
      ownerKind: parent?.kind,
      scope: parent ? (parent.qualifiedName || parent.id || parent.name) : undefined,
      parentId: parent?.id,
      visibility: "public",
      range: this.nodeToRange(node),
      metadata,
    }
    ctx.symbols.push(symbol)
    ctx.symbolNames.add(name)

    if (parent) {
      this.addRelationship(ctx, parent.qualifiedName || parent.id || parent.name, qualified, ASTEngine.RelationshipType.Contains, {
        role: metadata.isAnchor ? "yaml_anchor" : metadata.isArrayItem ? "yaml_sequence_item" : "yaml_mapping_key",
        fullPath: qualified,
      })
    }
    return symbol
  }

  private addRelationship(
    ctx: YamlContext,
    source: string,
    target: string,
    type: ASTEngine.RelationshipType,
    metadata: Record<string, any>,
  ): void {
    const key = `${source}\u0000${type}\u0000${target}`
    if (ctx.relationshipKeys.has(key)) return
    ctx.relationshipKeys.add(key)
    ctx.relationships.push({ source, target, type, confidence: 1, metadata })
  }

  private detectFrameworks(ctx: YamlContext): void {
    const names = ctx.symbolNames
    const has = (name: string) => names.has(name)
    const path = ctx.filePath.toLowerCase()

    if (path.includes("docker-compose") || (has("services") && has("version"))) {
      this.addFramework(ctx, "Docker Compose", 20, "Containerized architecture detected")
    }
    if (path.endsWith("deployment.yaml") || path.endsWith("deployment.yml") || (has("apiVersion") && has("kind"))) {
      this.addFramework(ctx, "Kubernetes", 30, "Kubernetes orchestration detected")
    }
    if (path.includes(".github/workflows") || (has("jobs") && has("on"))) {
      this.addFramework(ctx, "GitHub Actions", 25, "GitHub Actions CI/CD detected")
    }
    if (path.includes(".gitlab-ci") || has("stages")) {
      this.addFramework(ctx, "GitLab CI", 25, "GitLab CI/CD detected")
    }
    if (path.endsWith("playbook.yml") || path.endsWith("playbook.yaml") || (has("tasks") && has("hosts"))) {
      this.addFramework(ctx, "Ansible", 20, "Ansible provisioning detected")
    }
    if (path.endsWith("application.yml") || path.endsWith("application.yaml") || (has("spring") && has("server"))) {
      this.addFramework(ctx, "Spring Boot", 10, "Spring Boot configuration detected")
    }
    if (has("depends_on")) this.addPattern(ctx, "Service Dependencies")
  }

  private addFramework(ctx: YamlContext, name: string, maturity: number, insight: string): void {
    if (!ctx.metadata.detectedFrameworks!.includes(name)) ctx.metadata.detectedFrameworks!.push(name)
    ctx.metadata.devOpsMaturity = (ctx.metadata.devOpsMaturity || 0) + maturity
    if (!ctx.metadata.architecturalInsights!.includes(insight)) ctx.metadata.architecturalInsights!.push(insight)
  }

  private observeScalar(node: Node, current: VisitContext, ctx: YamlContext): void {
    const text = this.scalarText(node)
    if (!text) return
    if (text.includes("$")) {
      this.addPattern(ctx, "Template Variables")
      const lower = `${text} ${current.parent?.name || ""}`.toLowerCase()
      if (lower.includes("secret") || lower.includes("password") || lower.includes("token") || lower.includes("key")) {
        ctx.metadata.securityScore = Math.max(0, (ctx.metadata.securityScore || 100) - 10)
      }
    }
  }

  private addPattern(ctx: YamlContext, pattern: string): void {
    if (!ctx.metadata.patterns!.includes(pattern)) ctx.metadata.patterns!.push(pattern)
  }

  private mappingKeyNode(node: Node): Node | null {
    const field = node.childForFieldName("key")
    if (field) return this.scalarNode(field)
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child && this.isScalarLike(child)) return this.scalarNode(child)
    }
    return null
  }

  private mappingValueNode(node: Node): Node | null {
    const field = node.childForFieldName("value")
    if (field) return field
    if (node.namedChildCount > 1) return node.namedChild(node.namedChildCount - 1)
    return null
  }

  private scalarNode(node: Node): Node {
    let current = node
    while (WRAPPER_TYPES.has(current.type) && current.namedChildCount > 0) {
      current = current.namedChild(0) || current
    }
    return current
  }

  private scalarText(node: Node): string {
    const scalar = this.scalarNode(node)
    const value = scalar.text.trim()
    if (value.length >= 2) {
      const first = value[0]
      const last = value[value.length - 1]
      if ((first === "\"" || first === "'") && first === last) return value.slice(1, -1)
    }
    return value
  }

  private valueType(node: Node | null): string {
    if (!node) return "null"
    if (MAPPING_TYPES.has(node.type)) return "object"
    if (SEQUENCE_TYPES.has(node.type)) return "array"
    if (node.type === "alias") return "alias"
    if (node.type === "anchor") {
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i)
        if (child && child.type !== "anchor_name") {
          const nested = this.valueType(child)
          if (nested !== "unknown") return nested
        }
      }
      return "anchor"
    }
    if (WRAPPER_TYPES.has(node.type)) {
      // A block_node commonly contains an anchor token followed by the actual
      // mapping/sequence. Prefer structural children so `key: &a\n  x: y`
      // is classified as an object rather than as the anchor token itself.
      for (let i = 0; i < node.namedChildCount; i++) {
        const nested = this.valueType(node.namedChild(i))
        if (nested === "object" || nested === "array") return nested
      }
      for (let i = 0; i < node.namedChildCount; i++) {
        const nested = this.valueType(node.namedChild(i))
        if (nested !== "unknown") return nested
      }
      return "null"
    }
    switch (node.type) {
      case "integer_scalar": return "integer"
      case "float_scalar": return "float"
      case "boolean_scalar": return "boolean"
      case "null_scalar": return "null"
      case "plain_scalar":
        // The YAML grammar wraps booleans, integers, floats, and nulls in a
        // plain_scalar node. Inspect its typed child before treating it as a
        // string; otherwise `enabled: true` is misclassified as text.
        for (let i = 0; i < node.namedChildCount; i++) {
          const nested = this.valueType(node.namedChild(i))
          if (nested !== "unknown") return nested
        }
        return "string"
      case "string_scalar":
      case "single_quote_scalar":
      case "double_quote_scalar":
      case "block_scalar":
      case "string": return "string"
      default:
        for (let i = 0; i < node.namedChildCount; i++) {
          const nested = this.valueType(node.namedChild(i))
          if (nested !== "unknown") return nested
        }
        return "unknown"
    }
  }

  private isScalarLike(node: Node): boolean {
    return SCALAR_TYPES.has(node.type) || WRAPPER_TYPES.has(node.type)
  }

  private firstNamedChild(node: Node): Node | null {
    return node.namedChildCount > 0 ? node.namedChild(0) : null
  }

  private findNamedChild(node: Node, type: string): Node | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child?.type === type) return child
    }
    return null
  }

  private pushChildren(
    stack: { node: Node; context: VisitContext }[],
    node: Node,
    context: VisitContext,
  ): void {
    for (let i = node.namedChildCount - 1; i >= 0; i--) {
      const child = node.namedChild(i)
      if (child) stack.push({ node: child, context: { ...context, depth: context.depth + 1 } })
    }
  }

  private pushMappingChildren(
    stack: { node: Node; context: VisitContext }[],
    node: Node,
    context: VisitContext,
  ): void {
    for (let i = node.namedChildCount - 1; i >= 0; i--) {
      const child = node.namedChild(i)
      if (child && MAPPING_PAIR_TYPES.has(child.type)) {
        stack.push({ node: child, context: { ...context, depth: context.depth + 1 } })
      }
    }
  }

  private sequenceIndex(itemNode: Node, parentPath: string, ctx: YamlContext): number {
    // The grammar's sequence-item nodes have exact positions but no index
    // field. Count sibling sequence items through the parent AST node once;
    // this is bounded to one sequence and avoids scanning symbols/relationships.
    const parent = itemNode.parent
    if (!parent) return 0
    let index = 0
    for (let i = 0; i < parent.namedChildCount; i++) {
      const sibling = parent.namedChild(i)
      if (sibling === itemNode) return index
      if (sibling?.type === "block_sequence_item" || sibling?.type === "flow_node") index++
    }
    void parentPath
    void ctx
    return index
  }

  private isReferenceKey(key: string, value: Node | null): boolean {
    if (key === "$ref") return true
    return !!value && this.valueType(value) === "string" && this.referenceText(value).startsWith("#/")
  }

  private referenceText(value: Node): string {
    return this.scalarText(value)
  }

  private childPath(parentPath: string, key: string): string {
    return parentPath ? `${parentPath}.${key}` : key
  }

  private documentName(filePath: string, documentIndex: number): string {
    const slash = filePath.lastIndexOf("/")
    const base = slash >= 0 ? filePath.slice(slash + 1) : filePath
    let stem = base
    if (stem.toLowerCase().endsWith(".yaml.template")) stem = stem.slice(0, -13)
    else if (stem.toLowerCase().endsWith(".yml.template")) stem = stem.slice(0, -12)
    else if (stem.toLowerCase().endsWith(".yaml")) stem = stem.slice(0, -5)
    else if (stem.toLowerCase().endsWith(".yml")) stem = stem.slice(0, -4)
    stem = stem.trim() || "document"
    return documentIndex === 1 ? stem : `${stem}#${documentIndex}`
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
