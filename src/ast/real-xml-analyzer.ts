import type { Node } from "web-tree-sitter"
import { ASTEngine } from "./engine"

/**
 * XML analyzer backed exclusively by the vendored tree-sitter-xml AST.
 *
 * The grammar exposes XML as a `document` containing `element` nodes. Element
 * names and attributes are direct children of `STag` or `EmptyElemTag`; DTD
 * declarations live below `prolog/doctypedecl`; processing instructions are
 * `PI` nodes. No source-text search is used for declaration extraction.
 */
export class RealXmlAnalyzer implements ASTEngine.LanguageAnalyzer {
  public analyze(rootNode: Node, content: string, _filePath: string): ASTEngine.ParseResult {
    const symbols: ASTEngine.UniversalSymbol[] = []
    const relationships: ASTEngine.UniversalRelationship[] = []
    const imports: ASTEngine.ImportInfo[] = []
    const errors: ASTEngine.ParseError[] = []
    const seenRelationships = new Set<string>()

    const addRelationship = (
      source: string,
      target: string,
      type: ASTEngine.RelationshipType,
      metadata: Record<string, any>,
      node?: Node,
    ) => {
      if (!source || !target) return
      const key = `${source}\u0000${type}\u0000${target}`
      if (seenRelationships.has(key)) return
      seenRelationships.add(key)
      relationships.push({
        source,
        target,
        type,
        confidence: 1,
        line_number: node ? node.startPosition.row + 1 : undefined,
        metadata,
      })
    }

    // Syntax errors are collected centrally by ASTEngine so the tree-level
    // warning is emitted exactly once; this analyzer never duplicates it.

    type WorkItem = { node: Node; ownerName?: string; dtdName?: string }
    const work: WorkItem[] = [{ node: rootNode }]

    while (work.length > 0) {
      const { node, ownerName, dtdName } = work.pop()!
      if (node.isMissing) continue

      if (node.type === "element") {
        const tagNode = this.findDirectChild(node, "STag") || this.findDirectChild(node, "EmptyElemTag")
        const nameNode = tagNode ? this.findDirectChild(tagNode, "Name") : null
        const name = nameNode?.text.trim()
        if (name) {
          const elementSymbol: ASTEngine.UniversalSymbol = {
            name,
            kind: ASTEngine.SymbolKind.Class,
            range: this.nodeToRange(node),
            visibility: "public",
            ownerName,
            ownerKind: ownerName ? ASTEngine.SymbolKind.Class : undefined,
            qualifiedName: ownerName ? `${ownerName}.${name}` : name,
            metadata: {
              nodeType: "element",
              isXmlElement: true,
              tagName: name,
              isSchemaConstruct: this.isSchemaConstruct(name),
            },
          }
          symbols.push(elementSymbol)

          if (ownerName) {
            addRelationship(ownerName, name, ASTEngine.RelationshipType.Contains, { role: "xml_element" }, node)
          }

          if (tagNode) {
            for (let i = 0; i < tagNode.namedChildCount; i++) {
              const child = tagNode.namedChild(i)
              if (!child || child.type !== "Attribute") continue
              this.extractAttribute(
                child,
                name,
                symbols,
                addRelationship,
              )
            }
          }

          for (let i = node.namedChildCount - 1; i >= 0; i--) {
            const child = node.namedChild(i)
            if (child && child !== tagNode) work.push({ node: child, ownerName: name, dtdName })
          }
          continue
        }
      }

      if (node.type === "doctypedecl") {
        const nameNode = this.findDirectChild(node, "Name")
        const name = nameNode?.text.trim()
        const currentDtdName = name || dtdName
        if (name) {
          symbols.push({
            name,
            kind: ASTEngine.SymbolKind.Type,
            range: this.nodeToRange(node),
            visibility: "public",
            metadata: { nodeType: node.type, isDoctype: true, dtdName: name },
          })
        }

        const externalId = this.findDirectChild(node, "ExternalID")
        if (externalId && currentDtdName) {
          const literal = this.findDirectChild(externalId, "SystemLiteral") || this.findDirectChild(externalId, "PubidLiteral")
          const path = literal ? this.unquote(literal.text) : ""
          if (path) {
            imports.push({
              module: path,
              path,
              importType: "xml-doctype",
              range: this.nodeToRange(externalId),
              metadata: { isDoctypeExternalId: true },
            })
            addRelationship(currentDtdName, path, ASTEngine.RelationshipType.Imports, { role: "doctype_external_id" }, externalId)
          }
        }

        for (let i = node.namedChildCount - 1; i >= 0; i--) {
          const child = node.namedChild(i)
          if (child && child !== nameNode && child !== externalId) work.push({ node: child, ownerName, dtdName: currentDtdName })
        }
        continue
      }

      if (node.type === "elementdecl") {
        const nameNode = this.findDirectChild(node, "Name")
        const name = nameNode?.text.trim()
        if (name) {
          symbols.push({
            name,
            kind: ASTEngine.SymbolKind.Type,
            range: this.nodeToRange(node),
            visibility: "public",
            ownerName: dtdName,
            ownerKind: dtdName ? ASTEngine.SymbolKind.Type : undefined,
            metadata: { nodeType: node.type, isDtdElementDeclaration: true, dtdName },
          })
          if (dtdName) addRelationship(dtdName, name, ASTEngine.RelationshipType.Contains, { role: "dtd_element_declaration" }, node)
        }
      }

      if (node.type === "AttlistDecl") {
        const elementName = this.findDirectChild(node, "Name")?.text.trim()
        if (elementName) {
          for (let i = 0; i < node.namedChildCount; i++) {
            const attDef = node.namedChild(i)
            if (!attDef || attDef.type !== "AttDef") continue
            const attrName = this.findDirectChild(attDef, "Name")?.text.trim()
            if (!attrName) continue
            const defaultDecl = this.findDirectChild(attDef, "DefaultDecl")
            const attrType = attDef.namedChildCount > 0
              ? this.findFirstNamedChild(attDef, new Set(["StringType", "TokenizedType", "Enumeration", "NotationType"]))
              : null
            symbols.push({
              name: attrName,
              kind: ASTEngine.SymbolKind.Property,
              range: this.nodeToRange(attDef),
              visibility: "public",
              ownerName: elementName,
              ownerKind: ASTEngine.SymbolKind.Type,
              metadata: {
                nodeType: "AttDef",
                isDtdAttributeDeclaration: true,
                dtdElement: elementName,
                attributeType: attrType?.text,
                defaultDeclaration: defaultDecl?.text,
              },
            })
            addRelationship(elementName, attrName, ASTEngine.RelationshipType.Contains, { role: "dtd_attribute_declaration" }, attDef)
          }
        }
      }

      if (node.type === "PI") {
        const targetNode = this.findDirectChild(node, "PITarget") || this.findDirectChild(node, "Name")
        const target = targetNode?.text.trim()
        if (target && target.toLowerCase() !== "xml") {
          symbols.push({
            name: target,
            kind: ASTEngine.SymbolKind.Module,
            range: this.nodeToRange(node),
            visibility: "public",
            ownerName,
            ownerKind: ownerName ? ASTEngine.SymbolKind.Class : undefined,
            metadata: { nodeType: node.type, isProcessingInstruction: true, target },
          })
          if (ownerName) addRelationship(ownerName, target, ASTEngine.RelationshipType.Contains, { role: "processing_instruction" }, node)
        }
      }

      for (let i = node.namedChildCount - 1; i >= 0; i--) {
        const child = node.namedChild(i)
        if (child) work.push({ node: child, ownerName, dtdName })
      }
    }

    return {
      language: "xml",
      symbols,
      relationships,
      imports,
      exports: [],
      errors,
      metadata: {
        complexity: symbols.length + relationships.length,
        linesOfCode: content.split("\n").length,
        cyclomaticComplexity: 1,
        patterns: [],
        framework: "XML",
      },
    }
  }

  private extractAttribute(
    node: Node,
    ownerName: string,
    symbols: ASTEngine.UniversalSymbol[],
    addRelationship: (source: string, target: string, type: ASTEngine.RelationshipType, metadata: Record<string, any>, node?: Node) => void,
  ): void {
    const nameNode = this.findDirectChild(node, "Name")
    const valueNode = this.findDirectChild(node, "AttValue")
    const attributeName = nameNode?.text.trim()
    if (!attributeName) return

    const value = valueNode ? this.unquote(valueNode.text) : undefined
    const isNamespace = attributeName === "xmlns" || attributeName.startsWith("xmlns:")
    const namespacePrefix = attributeName === "xmlns" ? "default" : attributeName.slice("xmlns:".length)
    const name = isNamespace ? namespacePrefix : attributeName
    const kind = isNamespace ? ASTEngine.SymbolKind.Namespace : ASTEngine.SymbolKind.Property

    symbols.push({
      name,
      kind,
      range: this.nodeToRange(node),
      visibility: "public",
      ownerName,
      ownerKind: ASTEngine.SymbolKind.Class,
      metadata: {
        nodeType: node.type,
        isXmlAttribute: !isNamespace,
        isXmlNamespace: isNamespace,
        attributeName,
        value,
        namespacePrefix: isNamespace ? namespacePrefix : undefined,
        namespaceUri: isNamespace ? value : undefined,
      },
    })
    addRelationship(ownerName, name, ASTEngine.RelationshipType.Contains, {
      role: isNamespace ? "xml_namespace" : "xml_attribute",
      value,
    }, node)
  }

  private isSchemaConstruct(name: string): boolean {
    const separator = name.lastIndexOf(":")
    const localName = separator >= 0 ? name.slice(separator + 1) : name
    return localName === "schema" || localName === "element" || localName === "attribute" ||
      localName === "complexType" || localName === "simpleType" || localName === "sequence" || localName === "restriction"
  }

  private findDirectChild(node: Node, type: string): Node | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child?.type === type) return child
    }
    return null
  }

  private findFirstNamedChild(node: Node, types: Set<string>): Node | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child && types.has(child.type)) return child
    }
    return null
  }

  private unquote(text: string): string {
    if (text.length >= 2) {
      const first = text[0]
      const last = text[text.length - 1]
      if ((first === "\"" || first === "'") && first === last) return text.slice(1, -1)
    }
    return text
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
