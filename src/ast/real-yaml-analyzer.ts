import type { Node } from "web-tree-sitter"
import { ASTEngine } from "./engine"

interface YamlContext {
  tree: { rootNode: Node }
  content: string
  filePath: string
  symbols: ASTEngine.UniversalSymbol[]
  imports: ASTEngine.ImportInfo[]
  relationships: ASTEngine.UniversalRelationship[]
  exports: ASTEngine.ExportInfo[]
  metadata: Partial<ASTEngine.FileMetadata>
}

export class RealYamlAnalyzer implements ASTEngine.LanguageAnalyzer {
  public analyze(
    rootNode: Node,
    content: string,
    filePath: string,
  ): Omit<ASTEngine.ParseResult, "language" | "metadata"> & { metadata: Partial<ASTEngine.FileMetadata> } {
    const ctx: YamlContext = {
      tree: { rootNode },
      content,
      filePath,
      symbols: [],
      imports: [],
      relationships: [],
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
    }

    if (rootNode.hasError) {
      const errStack: Node[] = [rootNode]
      while (errStack.length > 0) {
        const n = errStack.pop()!
        if (n.type === "ERROR" || n.isMissing) {
          if (!ctx.metadata.errors) ctx.metadata.errors = []
          ctx.metadata.errors.push({
            message: `Syntax ${n.type} detected. The Brain Engine is bypassing this broken node.`,
            range: {
              startLine: n.startPosition.row + 1, startColumn: n.startPosition.column + 1,
              endLine: n.endPosition.row + 1, endColumn: n.endPosition.column + 1,
              startIndex: n.startIndex, endIndex: n.endIndex,
            },
            severity: "warning",
          })
        }
        for (let i = n.namedChildCount - 1; i >= 0; i--) {
          const child = n.namedChild(i)
          if (child) errStack.push(child)
        }
      }
    }

    const MAX_DEPTH = 25
    const MAX_SYMBOLS_PER_FILE = 50000

    const stack: { node: Node; parentSymbol: ASTEngine.UniversalSymbol | null; depth: number }[] = [
      { node: rootNode, parentSymbol: null, depth: 0 },
    ]

    let docCount = 0

    while (stack.length > 0) {
      const { node: curr, parentSymbol, depth } = stack.pop()!
      let newParentSymbol = parentSymbol

      if (depth > MAX_DEPTH) continue

      ctx.metadata.configurationComplexity! += 1

      if (ctx.symbols.length >= MAX_SYMBOLS_PER_FILE) {
        if (!ctx.metadata.patterns!.includes("Large YAML File")) {
          ctx.metadata.patterns!.push("Large YAML File")
        }
        continue
      }

      if (curr.type === "document") {
        docCount++
        if (docCount > 1 && !ctx.metadata.patterns!.includes("Multi-document YAML")) {
          ctx.metadata.patterns!.push("Multi-document YAML")
        }
        const docName = `document_${docCount}`
        newParentSymbol = this.createSymbol(docName, ASTEngine.SymbolKind.Module, curr, parentSymbol, ctx)
      } else if (curr.type === "block_mapping_pair" || curr.type === "flow_mapping_pair") {
        newParentSymbol = this.handleMappingPair(curr, ctx, parentSymbol)
      } else if (curr.type === "block_sequence_item" || curr.type === "flow_sequence_item") {
        const itemSymbol = this.createSymbol("item", ASTEngine.SymbolKind.Variable, curr, parentSymbol, ctx, {
          isYamlSequenceItem: true,
        })
        newParentSymbol = itemSymbol
      } else if (curr.type === "anchor" || curr.type === "anchor_node" || curr.type === "anchor_name") {
        this.handleAnchor(curr, ctx, parentSymbol)
      } else if (curr.type === "alias" || curr.type === "alias_node" || curr.type === "alias_name") {
        this.handleAlias(curr, ctx, parentSymbol)
      }

      // Template variables like ${DATABASE_URL}
      if (
        curr.type === "string_scalar" ||
        curr.type === "double_quote_scalar" ||
        curr.type === "single_quote_scalar" ||
        curr.type === "plain_scalar"
      ) {
        if (curr.text.includes("${") || curr.text.includes("$")) {
          if (!ctx.metadata.patterns!.includes("Template Variables")) {
            ctx.metadata.patterns!.push("Template Variables")
          }
          if (
            curr.text.toLowerCase().includes("secret") ||
            curr.text.toLowerCase().includes("password") ||
            curr.text.toLowerCase().includes("key")
          ) {
            ctx.metadata.securityScore! -= 10
          }
        }
      }

      for (let i = curr.childCount - 1; i >= 0; i--) {
        const child = curr.child(i)
        if (child) stack.push({ node: child, parentSymbol: newParentSymbol, depth: depth + 1 })
      }
    }

    this.detectFrameworks(ctx)

    // Post-loop: add contains for parent→child key hierarchy (YAML is inherently hierarchical)
    for (const s of ctx.symbols) {
      const _owner = s.ownerName || s.scope
      if (_owner) {
        ctx.relationships.push({
          type: ASTEngine.RelationshipType.Contains,
          source: _owner,
          target: s.name,
          isExternal: false,
          weight: 1,
          metadata: {},
        })
      }
    }

    return {
      symbols: ctx.symbols,
      relationships: ctx.relationships,
      imports: ctx.imports,
      exports: ctx.exports,
      metadata: ctx.metadata,
    }
  }

  private detectFrameworks(ctx: YamlContext) {
    const symbolNames: string[] = []
    for (let i = 0; i < ctx.symbols.length; i++) {
      symbolNames.push(ctx.symbols[i].name)
    }
    const hasSymbol = (name: string) => {
      for (let i = 0; i < symbolNames.length; i++) {
        if (symbolNames[i] === name) return true
      }
      return false
    }

    if (ctx.filePath.includes("docker-compose") || (hasSymbol("services") && hasSymbol("version"))) {
      ctx.metadata.detectedFrameworks!.push("Docker Compose")
      ctx.metadata.devOpsMaturity! += 20
      ctx.metadata.architecturalInsights!.push("Containerized architecture detected")
    }
    if (ctx.filePath.includes("deployment.yaml") || (hasSymbol("apiVersion") && hasSymbol("kind"))) {
      ctx.metadata.detectedFrameworks!.push("Kubernetes")
      ctx.metadata.devOpsMaturity! += 30
      ctx.metadata.architecturalInsights!.push("Kubernetes orchestration detected")
    }
    if (ctx.filePath.includes(".github/workflows") || (hasSymbol("jobs") && hasSymbol("on"))) {
      ctx.metadata.detectedFrameworks!.push("GitHub Actions")
      ctx.metadata.devOpsMaturity! += 25
      ctx.metadata.architecturalInsights!.push("GitHub Actions CI/CD detected")
    }
    if (ctx.filePath.includes(".gitlab-ci") || hasSymbol("stages")) {
      ctx.metadata.detectedFrameworks!.push("GitLab CI")
      ctx.metadata.devOpsMaturity! += 25
      ctx.metadata.architecturalInsights!.push("GitLab CI/CD detected")
    }
    if (ctx.filePath.includes("playbook.yml") || (hasSymbol("tasks") && hasSymbol("hosts"))) {
      ctx.metadata.detectedFrameworks!.push("Ansible")
      ctx.metadata.devOpsMaturity! += 20
      ctx.metadata.architecturalInsights!.push("Ansible provisioning detected")
    }
    if (ctx.filePath.includes("application.yml") || (hasSymbol("spring") && hasSymbol("server"))) {
      ctx.metadata.detectedFrameworks!.push("Spring Boot")
      ctx.metadata.devOpsMaturity! += 10
      ctx.metadata.architecturalInsights!.push("Spring Boot configuration detected")
    }

    if (hasSymbol("depends_on")) {
      ctx.metadata.patterns!.push("Service Dependencies")
    }
  }

  private createSymbol(
    name: string,
    kind: ASTEngine.SymbolKind,
    node: Node,
    parent: ASTEngine.UniversalSymbol | null,
    ctx: YamlContext,
    meta: Record<string, any> = {},
  ): ASTEngine.UniversalSymbol {
    const symbol: ASTEngine.UniversalSymbol = {
      id: parent ? `${parent.id}.${name}` : name,
      name,
      qualifiedName: parent ? `${parent.id}.${name}` : name,
      ownerName: parent ? parent.name : undefined,
      ownerKind: parent ? parent.kind : undefined,
      kind,
      range: {
        startLine: node.startPosition.row + 1,
        startColumn: node.startPosition.column,
        endLine: node.endPosition.row + 1,
        endColumn: node.endPosition.column,
        startIndex: node.startIndex,
        endIndex: node.endIndex,
      },
      filePath: ctx.filePath,
      parentId: parent ? parent.id : undefined,
      metadata: meta,
    }
    ctx.symbols.push(symbol)
    return symbol
  }

  private handleMappingPair(
    node: Node,
    ctx: YamlContext,
    parent: ASTEngine.UniversalSymbol | null,
  ): ASTEngine.UniversalSymbol | null {
    let keyNode = node.childForFieldName("key")
    if (!keyNode) {
      for (let i = 0; i < node.childCount; i++) {
        const c = node.child(i)
        if (
          c &&
          (c.type === "plain_scalar" ||
            c.type === "string_scalar" ||
            c.type === "double_quote_scalar" ||
            c.type === "single_quote_scalar")
        ) {
          keyNode = c
          break
        }
      }
    }
    if (!keyNode) return parent

    const symbol = this.createSymbol(keyNode.text, ASTEngine.SymbolKind.Property, keyNode, parent, ctx)

    // Check if the value has an anchor
    const valueNode = node.childForFieldName("value")
    if (valueNode) {
      this.scanForAnchors(valueNode, ctx, symbol)
      
      if (keyNode.text === "$ref") {
        // Strip quotes without regex
        let refValue = valueNode.text
        if ((refValue.startsWith('"') && refValue.endsWith('"')) || (refValue.startsWith("'") && refValue.endsWith("'"))) {
          refValue = refValue.substring(1, refValue.length - 1)
        }
        ctx.relationships.push({
          type: ASTEngine.RelationshipType.Uses,
          source: parent ? parent.id : symbol.id,
          target: refValue,
          targetExternal: refValue,
          isExternal: true,
          weight: 1,
          metadata: { isYamlRef: true }
        } as any);
        ctx.relationships.push({
          type: ASTEngine.RelationshipType.References,
          source: parent ? parent.id : symbol.id,
          target: refValue,
          isExternal: true,
          weight: 1,
          metadata: { isYamlRef: true }
        } as any);
      }

      if (keyNode.text === "<<") {
        if (!ctx.metadata.patterns!.includes("Configuration Inheritance")) {
          ctx.metadata.patterns!.push("Configuration Inheritance")
        }
        // YAML merge key <<: *base — extends relationship
        const valText = valueNode.text
        if (valText.startsWith("*")) {
          ctx.relationships.push({
            type: ASTEngine.RelationshipType.Extends,
            source: parent ? parent.id : symbol.id,
            target: valText.substring(1),
            isExternal: false,
            weight: 0.8,
            metadata: { yamlMerge: true }
          } as any);
        }
      }
    }

    return symbol
  }

  private scanForAnchors(node: Node, ctx: YamlContext, parent: ASTEngine.UniversalSymbol) {
    const queue: Node[] = [node]
    while (queue.length > 0) {
      const curr = queue.pop()!
      if (
        curr.type === "anchor" ||
        curr.type === "anchor_node" ||
        curr.type === "anchor_name" ||
        curr.type === "anchor_identifier"
      ) {
        this.handleAnchor(curr, ctx, parent)
      }
      for (let i = curr.childCount - 1; i >= 0; i--) {
        const child = curr.child(i)
        if (child) queue.push(child)
      }
    }
  }

  private handleAnchor(node: Node, ctx: YamlContext, parent: ASTEngine.UniversalSymbol | null) {
    const nameNode = node.childCount > 0 ? node.child(0) : node
    if (!nameNode) return
    this.createSymbol(nameNode.text, ASTEngine.SymbolKind.Constant, nameNode, parent, ctx, { isAnchor: true })
    if (!ctx.metadata.patterns!.includes("Anchors and Aliases")) {
      ctx.metadata.patterns!.push("Anchors and Aliases")
    }
  }

  private handleAlias(node: Node, ctx: YamlContext, parent: ASTEngine.UniversalSymbol | null) {
    if (!ctx.metadata.patterns!.includes("Anchors and Aliases")) {
      ctx.metadata.patterns!.push("Anchors and Aliases")
    }
    if (!parent) return
    const targetNode = node.childCount > 0 ? node.child(0) : node
    if (!targetNode) return

    ctx.relationships.push({
      type: ASTEngine.RelationshipType.Uses,
      source: parent.id,
      target: targetNode.text,
      isExternal: false, // Aliases resolve directly to internal document anchors
      weight: 1,
      metadata: { aliasReference: true },
    })
  }
}
