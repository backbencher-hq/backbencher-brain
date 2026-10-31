/**
 * AST analyzer for Visual Basic for Applications (VBA).
 *
 * The parser is the MIT-licensed tree-sitter-vba grammar vendored under
 * grammars/tree-sitter-vba. This analyzer deliberately reads node types and
 * named fields only; VBA is case-insensitive, so names are indexed with a
 * folded key while preserving their source spelling in emitted rows.
 */
import { ASTEngine } from "./engine"
import type { Node } from "web-tree-sitter"

const { SymbolKind, RelationshipType } = ASTEngine

type Declaration = {
  node: Node
  name: Node
  kind: ASTEngine.SymbolKind
}

const DECLARATIONS: ReadonlyMap<string, ASTEngine.SymbolKind> = new Map([
  ["sub_declaration", SymbolKind.Method],
  ["conditional_sub_declaration", SymbolKind.Method],
  ["function_declaration", SymbolKind.Function],
  ["conditional_function_declaration", SymbolKind.Function],
  ["property_get_declaration", SymbolKind.Property],
  ["property_let_declaration", SymbolKind.Property],
  ["property_set_declaration", SymbolKind.Property],
  ["conditional_property_declaration", SymbolKind.Property],
  ["type_declaration", SymbolKind.Type],
  ["enum_declaration", SymbolKind.Enum],
  ["enum_member", SymbolKind.EnumMember],
  ["type_member", SymbolKind.Variable],
  ["event_declaration", SymbolKind.Event],
  // There is no `declare_statement` in this grammar: the name is absent from all 418
  // node-type ids, and the live declare productions are the Function and Sub forms
  // below. The dead literal was removed after the pinned inventory was measured — a
  // node type the grammar does not have makes a branch that can never match, and the
  // grammar-conformance audit cannot see it because the name exists nowhere at all.
  ["declare_function_statement", SymbolKind.Function],
  ["declare_sub_statement", SymbolKind.Method],
  ["const_declaration", SymbolKind.Constant],
  ["variable_declaration", SymbolKind.Variable],
])

const BODY_NODES = new Set([
  "sub_declaration", "function_declaration", "property_get_declaration",
  "property_let_declaration", "property_set_declaration",
  "declare_function_statement", "declare_sub_statement",
  "conditional_sub_declaration", "conditional_function_declaration",
  "conditional_property_declaration",
])

const TYPE_NODES = new Set(["type_declaration", "enum_declaration"])

export class RealVbaAnalyzer implements ASTEngine.LanguageAnalyzer {
  private symbols: ASTEngine.UniversalSymbol[] = []
  private relationships: ASTEngine.UniversalRelationship[] = []
  private imports: ASTEngine.ImportInfo[] = []
  private declarations = new Map<string, ASTEngine.UniversalSymbol>()
  private owner: ASTEngine.UniversalSymbol[] = []
  private callableNames = new Set<string>()
  private variableNames = new Set<string>()
  private emitted = new Set<string>()
  private nodeSymbols = new Map<number, ASTEngine.UniversalSymbol>()
  private source = ""

  analyze(
    rootNode: Node,
    content: string,
    _filePath: string,
    _context?: ASTEngine.AnalyzeContext,
  ): Omit<ASTEngine.ParseResult, "language" | "metadata"> & { metadata?: Partial<ASTEngine.FileMetadata> } {
    this.reset(content)
    const declarations: Declaration[] = []
    this.collectDeclarations(rootNode, declarations)
    for (const declaration of declarations) this.publishDeclaration(declaration)
    this.walk(rootNode)
    this.dedupe()
    this.stampEvidence()
    return {
      symbols: this.symbols,
      relationships: this.relationships,
      imports: this.imports,
      metadata: {
        analysisVersion: "m1-vba-1",
        hasTypeInference: false,
        hasFrameworkIntelligence: false,
        vbaGaps: {
          extends: "VBA has no class inheritance syntax",
          overrides: "VBA has no override modifier",
          renders: "VBA grammar has no component-rendering construct",
          mixes_in: "VBA grammar has no mixin construct",
          part_of: "VBA grammar has no partial declaration construct",
        },
        linesOfCode: this.lineCount(content),
      },
    }
  }

  private reset(content: string): void {
    this.symbols = []
    this.relationships = []
    this.imports = []
    this.declarations.clear()
    this.owner = []
    this.callableNames.clear()
    this.variableNames.clear()
    this.emitted.clear()
    this.nodeSymbols.clear()
    this.source = content
  }

  private collectDeclarations(node: Node, out: Declaration[]): void {
    const kind = DECLARATIONS.get(node.type)
    if (kind) {
      const name = node.childForFieldName("name") ?? this.firstIdentifier(node)
      if (name) out.push({ node, name, kind })
    }
    for (const child of this.children(node)) this.collectDeclarations(child, out)
  }

  private publishDeclaration(declaration: Declaration): void {
    const name = declaration.name.text.trim()
    if (!name) return
    const symbol: ASTEngine.UniversalSymbol = {
      name,
      qualifiedName: name,
      kind: declaration.kind,
      range: this.range(declaration.node),
      visibility: this.visibility(declaration.node),
      isStatic: this.hasText(declaration.node, "static"),
      parameters: this.parameters(declaration.node),
      returnType: this.typeName(declaration.node),
      metadata: {
        grammarNode: declaration.node.type,
        language: "vba",
        ...(this.hasNodeType(declaration.node, "with_events_modifier") ? { withEvents: true } : {}),
      },
    }
    this.symbols.push(symbol)
    this.nodeSymbols.set(declaration.node.startIndex, symbol)
    const key = this.fold(name)
    if (!this.declarations.has(key)) this.declarations.set(key, symbol)
    if (BODY_NODES.has(declaration.node.type)) this.callableNames.add(key)
    if (declaration.kind === SymbolKind.Variable || declaration.kind === SymbolKind.Constant) {
      this.variableNames.add(key)
    }
  }

  private walk(node: Node, current?: ASTEngine.UniversalSymbol): void {
    const declaration = this.symbolForNode(node)
    const ownsChildren = declaration !== undefined &&
      (BODY_NODES.has(node.type) || TYPE_NODES.has(node.type))
    const active = ownsChildren ? declaration : current
    if (declaration && current && declaration !== current) {
      const nameNode = node.childForFieldName("name") ?? this.firstIdentifier(node) ?? node
      this.emit(RelationshipType.Contains, current.name, declaration.name, nameNode, 1)
      const ownerName = current.qualifiedName ?? current.name
      const symbol = this.nodeSymbols.get(node.startIndex)
      if (symbol) {
        symbol.ownerName = ownerName
        symbol.ownerKind = current.kind
        symbol.qualifiedName = `${ownerName}.${symbol.name}`
      }
    }
    if (declaration && declaration.visibility === "public" && !current) {
      this.emit(RelationshipType.Exports, "root", declaration.name, node, 1)
    }
    if (ownsChildren) this.owner.push(declaration!)

    if (node.type === "attribute_statement") this.emitAttribute(node, active)
    else if (node.type === "call_statement" || node.type === "call_expression") {
      this.emitCall(node, active)
    } else if (node.type === "raise_event_statement") {
      this.emitEventRaise(node, active)
    } else if (node.type === "new_expression") {
      this.emitInstantiation(node, active)
    } else if (node.type === "with_statement") {
      this.emitWithReceiver(node, active)
    } else if (node.type === "on_error_statement") {
      this.emitControlFlowRead(node.childForFieldName("target"), active, "on_error")
    } else if (node.type === "redim_statement") {
      this.emitControlFlowRead(node.childForFieldName("name") ?? this.firstIdentifier(node), active, "redim")
    } else if (node.type === "for_statement" || node.type === "for_each_statement") {
      this.emitLoopFields(node, active)
    } else if (node.type === "select_statement") {
      this.emitControlFlowRead(node.childForFieldName("value"), active, "select_value")
    } else if (node.type === "case_clause") {
      this.emitControlFlowRead(this.firstIdentifier(node), active, "case_value")
    // `member_expression` is a grammar SUPERTYPE (common/define-grammar.js), and
    // tree-sitter does not produce supertype nodes in trees — the concrete nodes are
    // qualified_member_expression (read here) and implicit_member_expression (read by
    // the call branch). Naming the supertype in a type comparison is a dead branch that
    // the grammar audit cannot catch, because the name exists among the wasm's ids.
    } else if (node.type === "qualified_member_expression") {
      this.emitMemberReceiver(node, active)
    } else if (node.type === "implements_statement") {
      this.emitNamed(RelationshipType.Implements, active, node.childForFieldName("name") ?? this.firstIdentifier(node), 0.9)
    } else if (node.type === "declare_function_statement" || node.type === "declare_sub_statement") {
      this.emitDeclareImport(node)
    } else if (node.type === "assignment_statement" || node.type === "set_statement") {
      this.emitReads(node.childForFieldName("right"), active)
    } else if (node.type === "as_type_clause" || node.type === "type_expression") {
      if (node.parent?.type === "implements_statement") {
        for (const child of this.children(node)) this.walk(child, active)
        return
      }
      const type = this.firstIdentifier(node)
      if (type) this.emitNamed(RelationshipType.References, active, type, 0.6)
    } else if (node.type === "identifier") {
      this.emitIdentifierRead(node, active)
    }

    for (const child of this.children(node)) this.walk(child, active)
    if (ownsChildren) this.owner.pop()
  }

  private emitAttribute(node: Node, source?: ASTEngine.UniversalSymbol): void {
    const target = node.childForFieldName("name") ?? this.firstIdentifier(node)
    if (!target) return
    this.emit(RelationshipType.Decorates, source?.name ?? "root", target.text, target, 0.8, {
      attributeName: target.text,
      attributeForm: "attribute_statement",
    })
  }

  /**
   * `Declare Function ... Lib "<library>"` / `Declare Sub ... Lib "<library>"` is how VBA
   * binds a procedure that lives outside the project (a system DLL or a COM export). The
   * fleet's `imports` names a unit's dependency on an external unit, so the row is
   * root -> LIBRARY rather than root -> procedure: the procedure is declared HERE — it is
   * a symbol of this module — while the LIBRARY is the external unit this module depends
   * on. The target is the library text with its string delimiters removed, because a
   * quoted target is not symbol-shaped; the written spelling rides in metadata, together
   * with the exported alias and PtrSafe when present. Confidence is 1: the dependency is
   * written in a live node and needs no resolution to be a fact about this file.
   */
  private emitDeclareImport(node: Node): void {
    const library = node.childForFieldName("library")
    const target = library ? this.unquote(library.text) : ""
    if (!library || !target) return
    const name = node.childForFieldName("name") ?? this.firstIdentifier(node)
    const alias = node.childForFieldName("alias")
    this.emit(RelationshipType.Imports, "root", target, library, 1, {
      importForm: "declare-lib",
      libraryName: target,
      declaration: node.type,
      ...(name ? { procedure: name.text } : {}),
      ...(alias ? { alias: this.unquote(alias.text) } : {}),
      ...(this.children(node).some((child) => child.type === "ptrsafe_modifier") ? { ptrSafe: true } : {}),
    })
  }

  /**
   * The grammar carries the library and alias as string literals; a dependency target is
   * a NAME, so the delimiters are removed. Done without a regex deliberately: this
   * analyzer stays regex-free, and a two-character trim needs none.
   */
  private unquote(text: string): string {
    let value = text.trim()
    if (value.startsWith('"')) value = value.slice(1)
    if (value.endsWith('"')) value = value.slice(0, -1)
    return value.trim()
  }

  private emitCall(node: Node, source?: ASTEngine.UniversalSymbol): void {
    const callee = node.childForFieldName("callee") ?? node.childForFieldName("function")
    const target = callee ? this.lastIdentifier(callee) : this.firstIdentifier(node)
    if (!target || this.fold(target.text) === "new") return
    const receiver = callee?.childForFieldName("receiver")
    const withReceiver = this.withReceiverFor(node)
    this.emit(RelationshipType.Calls, source?.name ?? "root", target.text, target, this.confidence(target.text), {
      qualified: callee?.text,
      ...(receiver ? { receiver: receiver.text } : {}),
      ...(callee?.type === "implicit_member_expression" ? { implicitMember: true } : {}),
      ...(withReceiver ? { withReceiver: withReceiver.text } : {}),
    })
  }

  private emitWithReceiver(node: Node, source?: ASTEngine.UniversalSymbol): void {
    const receiver = node.childForFieldName("value")
    if (!receiver) return
    this.emit(RelationshipType.Uses, source?.name ?? "root", receiver.text, receiver, this.confidence(receiver.text), {
      construct: "with_receiver",
    })
  }

  private emitControlFlowRead(node: Node | null, source: ASTEngine.UniversalSymbol | undefined, construct: string): void {
    if (!node) return
    const target = node.type === "identifier" ? node : this.firstIdentifier(node)
    if (!target) return
    this.emit(RelationshipType.Uses, source?.name ?? "root", target.text, target, this.confidence(target.text), { construct })
  }

  private emitLoopFields(node: Node, source?: ASTEngine.UniversalSymbol): void {
    const variable = node.childForFieldName("variable")
    const collection = node.childForFieldName("collection")
    const start = node.childForFieldName("start")
    const end = node.childForFieldName("end")
    if (variable) this.emitControlFlowRead(variable, source, node.type === "for_each_statement" ? "foreach_binder" : "for_binder")
    if (collection) this.emitControlFlowRead(collection, source, "foreach_collection")
    if (start) this.emitControlFlowRead(start, source, "for_start")
    if (end) this.emitControlFlowRead(end, source, "for_end")
  }

  private emitMemberReceiver(node: Node, source?: ASTEngine.UniversalSymbol): void {
    if (!source || this.hasCallAncestor(node)) return
    const receiver = node.childForFieldName("receiver")
    if (!receiver || receiver.type !== "identifier") return
    this.emit(RelationshipType.Uses, source.name, receiver.text, receiver, this.confidence(receiver.text), {
      construct: "member_receiver",
      member: node.childForFieldName("member")?.text,
    })
  }

  private withReceiverFor(node: Node): Node | null {
    let parent = node.parent
    while (parent) {
      if (parent.type === "with_statement") {
        return parent.childForFieldName("value")
      }
      if (BODY_NODES.has(parent.type)) return null
      parent = parent.parent
    }
    return null
  }

  private emitInstantiation(node: Node, source?: ASTEngine.UniversalSymbol): void {
    const target = node.childForFieldName("type") ?? this.firstIdentifier(node)
    if (!target) return
    this.emit(RelationshipType.Instantiates, source?.name ?? "root", target.text, target, this.confidence(target.text))
  }

  private emitEventRaise(node: Node, source?: ASTEngine.UniversalSymbol): void {
    const event = node.childForFieldName("event") ?? this.firstIdentifier(node)
    if (!event) return
    this.emit(RelationshipType.Calls, source?.name ?? "root", event.text, event, this.confidence(event.text), {
      eventRaise: true,
    })
  }

  private emitReads(node: Node | null, source?: ASTEngine.UniversalSymbol): void {
    if (!node) return
    for (const child of this.children(node)) {
      // Member expressions only ever arrive as their concrete nodes — `member_expression`
      // is the grammar's supertype and is never produced in a tree (see the walk branch).
      if (child.type === "qualified_member_expression") {
        this.emitMemberReceiver(child, source)
        this.emitReads(child, source)
      } else if (child.type === "identifier") {
        this.emit(RelationshipType.Uses, source?.name ?? "root", child.text, child, this.confidence(child.text))
      } else {
        this.emitReads(child, source)
      }
    }
  }

  private emitIdentifierRead(node: Node, source?: ASTEngine.UniversalSymbol): void {
    const parent = node.parent
    if (!parent || !source) return
    if (parent.childForFieldName("name")?.id === node.id) return
    if (parent.type === "type_expression" || parent.type === "as_type_clause") return
    if (this.hasCallAncestor(node)) return
    if (parent.type === "new_expression") return
    if (parent.type === "variable_declarator" || parent.type === "const_declarator") return
    if (parent.type === "parameter") return
    const left = parent.childForFieldName("left")
    if (left?.id === node.id) return
    if (parent.type === "qualified_member_expression" && parent.childForFieldName("member")?.id !== node.id) return
    this.emit(RelationshipType.Uses, source.name, node.text, node, this.confidence(node.text))
  }

  private emitNamed(type: ASTEngine.RelationshipType, source: ASTEngine.UniversalSymbol | undefined, target: Node | null, confidence: number): void {
    if (target) this.emit(type, source?.name ?? "root", target.text, target, confidence)
  }

  private emit(
    type: ASTEngine.RelationshipType,
    source: string,
    target: string,
    node: Node,
    confidence: number,
    metadata: Record<string, unknown> = {},
  ): void {
    const key = `${source}\u0000${type}\u0000${target}\u0000${node.startPosition.row + 1}`
    if (this.emitted.has(key)) return
    this.emitted.add(key)
    this.relationships.push({
      source,
      target,
      type,
      confidence,
      line_number: node.startPosition.row + 1,
      metadata,
    })
  }

  private confidence(target: string): number {
    return this.declarations.has(this.fold(target)) ? 1 : 0.6
  }

  private symbolForNode(node: Node): ASTEngine.UniversalSymbol | undefined {
    return this.nodeSymbols.get(node.startIndex)
  }

  private hasCallAncestor(node: Node): boolean {
    let parent = node.parent
    while (parent) {
      if (parent.type === "call_statement" || parent.type === "call_expression") {
        const callee = parent.childForFieldName("callee") ?? parent.childForFieldName("function")
        return !!callee && callee.startIndex <= node.startIndex && callee.endIndex >= node.endIndex
      }
      if (parent.type === "block" || BODY_NODES.has(parent.type)) return false
      parent = parent.parent
    }
    return false
  }

  private firstIdentifier(node: Node): Node | null {
    for (const child of this.children(node)) {
      if (child.type === "identifier") return child
      const nested = this.firstIdentifier(child)
      if (nested) return nested
    }
    return null
  }

  private lastIdentifier(node: Node): Node | null {
    if (node.type === "identifier") return node
    const children = this.children(node)
    for (let i = children.length - 1; i >= 0; i--) {
      const child = children[i]
      if (child.type === "identifier") return child
      const nested = this.lastIdentifier(child)
      if (nested) return nested
    }
    return null
  }

  private typeName(node: Node): string | undefined {
    const type = node.childForFieldName("type")
    return this.typeText(type)
  }

  private typeText(node: Node | null): string | undefined {
    if (!node) return undefined
    if (node.type === "as_type_clause") {
      return this.typeText(node.childForFieldName("type"))
    }
    const text = node.text.trim()
    return text.length > 0 ? text : undefined
  }

  private parameters(node: Node): ASTEngine.Parameter[] | undefined {
    const list = node.childForFieldName("parameters")
    if (!list) return undefined
    return this.children(list)
      .filter((p) => p.type === "parameter")
      .map((p) => ({
        name: (p.childForFieldName("name") ?? this.firstIdentifier(p))?.text ?? "",
        type: this.typeText(p.childForFieldName("type")),
        isOptional: this.children(p).some((c) => c.type === "optional_modifier"),
        passingMode: this.children(p).find((c) => c.type === "byref_modifier" || c.type === "byval_modifier")?.type.replace("_modifier", ""),
        isParamArray: this.children(p).some((c) => c.type === "paramarray_modifier"),
        defaultValue: p.childForFieldName("default_value")?.childForFieldName("value")?.text,
      }))
      .filter((p) => p.name.length > 0)
  }

  private visibility(node: Node): string {
    const value = node.childForFieldName("visibility")?.text.toLowerCase()
    return value === "public" || value === "private" || value === "friend" ? value : "private"
  }

  private hasText(node: Node, text: string): boolean {
    return this.children(node).some((child) => child.text.toLowerCase() === text)
  }

  private hasNodeType(node: Node, type: string): boolean {
    if (node.type === type) return true
    return this.children(node).some((child) => this.hasNodeType(child, type))
  }

  private fold(value: string): string {
    return value.toLowerCase()
  }

  private lineCount(value: string): number {
    let lines = 1
    for (let index = 0; index < value.length; index += 1) {
      if (value[index] === "\n") lines += 1
    }
    return lines
  }

  private children(node: Node): Node[] {
    return node.namedChildren.filter((child): child is Node => child !== null)
  }

  private range(node: Node): ASTEngine.UniversalSymbol["range"] {
    return {
      startLine: node.startPosition.row + 1,
      startColumn: node.startPosition.column,
      endLine: node.endPosition.row + 1,
      endColumn: node.endPosition.column,
      startIndex: node.startIndex,
      endIndex: node.endIndex,
    }
  }

  private dedupe(): void {
    const seen = new Set<string>()
    this.relationships = this.relationships.filter((relationship) => {
      const key = `${relationship.source}\u0000${relationship.type}\u0000${relationship.target}\u0000${relationship.line_number}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }

  private stampEvidence(): void {
    for (const relationship of this.relationships) {
      const confidence = relationship.confidence ?? 1
      relationship.metadata = {
        evidenceClass: confidence < 0.7
          ? "inferred"
          : relationship.type === RelationshipType.Imports
            ? "import_based"
            : relationship.type === RelationshipType.References || relationship.type === RelationshipType.Uses
              ? "usage_contextual"
              : "structural",
        ...relationship.metadata,
      }
    }
  }
}
