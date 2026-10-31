/**
 * AST analyzer for MATLAB.
 *
 * The implementation is deliberately Tree-sitter-only. MATLAB has ambiguous
 * call/index syntax, so unresolved call targets remain calls with inferred
 * confidence instead of being guessed into declarations.
 *
 * TWO FACTS ABOUT THE LANGUAGE SHAPE THIS FILE, because neither is a grammar node:
 *   - A `+pkg/` FOLDER is MATLAB's namespace, and a file is its own module. The path the
 *     engine hands the analyzer is where `part_of` (a declaration is part of its package)
 *     and `exports` (the file exports its primary declaration) come from.
 *   - `classdef X < Y & Z` has ONE inheritance edge (the first base) and treats every later
 *     base as additional superclass conformance, which is what `implements` spells here.
 *     Each base is one `property_name` node, so a dotted base is one target.
 */
import { ASTEngine } from "./engine"
import type { Node } from "web-tree-sitter"

const { SymbolKind, RelationshipType } = ASTEngine

type Decl = { node: Node; name: Node; kind: ASTEngine.SymbolKind }

const DECLARATIONS: ReadonlyMap<string, ASTEngine.SymbolKind> = new Map([
  ["function_definition", SymbolKind.Function],
  ["class_definition", SymbolKind.Class],
  ["property", SymbolKind.Property],
  ["enum", SymbolKind.EnumMember],
])

export class RealMatlabAnalyzer implements ASTEngine.LanguageAnalyzer {
  private symbols: ASTEngine.UniversalSymbol[] = []
  private relationships: ASTEngine.UniversalRelationship[] = []
  private declarations = new Map<string, ASTEngine.UniversalSymbol>()
  private nodeSymbols = new Map<number, ASTEngine.UniversalSymbol>()
  private emitted = new Set<string>()
  /** Class names declared in THIS file, folded -> as written. Object construction is a
   *  same-file fact here, and so is the extra-superclass half of `&`. */
  private classNames = new Map<string, string>()
  /** The file's `+pkg/` package and its module name, derived from the path. MATLAB has no
   *  textual namespace or module construct: `+pkg/` FOLDERS are the namespace mechanism, so
   *  the path the engine hands the analyzer is the only place that fact exists. */
  private moduleName = ""
  private packageName = ""

  analyze(rootNode: Node, _content: string, filePath: string, context?: ASTEngine.AnalyzeContext): Omit<ASTEngine.ParseResult, "language" | "metadata"> {
    this.symbols = []
    this.relationships = []
    this.declarations.clear()
    this.nodeSymbols.clear()
    this.emitted.clear()
    this.classNames.clear()
    this.packageName = this.packageFromPath(filePath)
    this.moduleName = this.moduleNameFromPath(filePath, this.packageName)

    const declarations: Decl[] = []
    this.collectDeclarations(rootNode, declarations)
    for (const declaration of declarations) this.publish(declaration)
    this.walk(rootNode)
    this.emitFileScopeRelationships(declarations, context)
    return {
      symbols: this.symbols,
      relationships: this.relationships,
      imports: [],
      metadata: {
        analysisVersion: "m1-matlab-2",
        hasTypeInference: false,
        hasFrameworkIntelligence: false,
        matlabGaps: {
          packageNamespace: "`+pkg/` namespace membership is a FOLDER fact, derived from the file path; the grammar has no namespace or module node",
          overrides: "an override is a method-name shadow of a base member; a base outside this file is visible only through the companion index, and an unverifiable base publishes no row",
          overloads: "Function/index ambiguity is retained as inferred calls",
          scripts: "Script-local variables have no declaration construct in the grammar",
        },
        linesOfCode: this.lineCount(_content),
      },
    }
  }

  private collectDeclarations(node: Node, out: Decl[]): void {
    const kind = DECLARATIONS.get(node.type)
    if (kind) {
      const name = node.childForFieldName("name") ?? this.firstIdentifier(node)
      if (name) {
        let declarationKind = kind
        if (kind === SymbolKind.Function && node.parent?.type === "methods") declarationKind = SymbolKind.Method
        if (kind === SymbolKind.Function && this.enclosingClassName(node) === name.text) {
          declarationKind = SymbolKind.Constructor
        }
        out.push({ node, name, kind: declarationKind })
      }
    }
    if (node.type === "events") {
      for (const child of node.namedChildren) {
        if (child?.type === "identifier") out.push({ node: child, name: child, kind: SymbolKind.Event })
      }
    }
    for (const child of node.namedChildren) if (child) this.collectDeclarations(child, out)
  }

  private publish(declaration: Decl): void {
    const name = declaration.name.text
    if (!name) return
    const symbol: ASTEngine.UniversalSymbol = {
      name,
      qualifiedName: name,
      kind: declaration.kind,
      range: this.range(declaration.node),
      visibility: this.visibility(declaration.node),
      parameters: this.parameters(declaration.node),
      metadata: {
        language: "matlab",
        grammarNode: declaration.node.type,
        ...(this.attributes(declaration.node).length > 0
          ? { attributes: this.attributes(declaration.node) } : {}),
      },
    }
    this.symbols.push(symbol)
    this.nodeSymbols.set(declaration.node.startIndex, symbol)
    if (!this.declarations.has(this.fold(name))) this.declarations.set(this.fold(name), symbol)
    if (declaration.kind === SymbolKind.Class) this.classNames.set(this.fold(name), name)
  }

  private walk(node: Node, owner?: ASTEngine.UniversalSymbol): void {
    const declaration = this.nodeSymbols.get(node.startIndex)
    const active = declaration ?? owner
    if (declaration && owner && declaration !== owner) {
      const name = node.childForFieldName("name") ?? this.firstIdentifier(node)
      if (name) {
        this.emit(RelationshipType.Contains, owner.name, declaration.name, name, 1)
        declaration.ownerName = owner.qualifiedName ?? owner.name
        declaration.ownerKind = owner.kind
        declaration.qualifiedName = `${declaration.ownerName}.${declaration.name}`
      }
    }
    if (declaration?.kind === SymbolKind.Class) {
      // `classdef X < Y & Z`: the FIRST base is inheritance (X IS-A Y); every following base
      // is conformance to an additional superclass, which is `implements` territory rather than
      // a second inheritance clause. Each base is ONE `property_name` node, so a dotted base
      // (`matlab.mixin.Copyable`) stays one target instead of being split into its segments.
      const supers = node.namedChildren.find((child) => child?.type === "superclasses") ?? null
      const bases = supers ? supers.namedChildren.filter((child): child is Node => !!child && child.type === "property_name") : []
      bases.forEach((base, index) => {
        const target = this.dottedText(base)
        if (target === "") return
        if (index === 0) {
          this.emit(RelationshipType.Extends, declaration.name, target, base, this.confidence(target))
        } else {
          this.emit(RelationshipType.Implements, declaration.name, target, base, this.confidence(target), { construct: "additional_superclass" })
        }
      })
    }
    if (node.type === "function_call") {
      const target = node.childForFieldName("name") ?? this.firstIdentifier(node)
      if (target) this.emitCallee(node, target, active?.name ?? "root")
    } else if (node.type === "field_expression") {
      const object = node.childForFieldName("object")
      const field = node.childForFieldName("field")
      if (object && field && active) {
        this.emit(RelationshipType.Uses, active.name, object.text, object, this.confidence(object.text), { construct: "field_receiver", field: field.text })
        this.emit(RelationshipType.Uses, active.name, field.text, field, this.confidence(field.text), { construct: "field_member", receiver: object.text })
      }
    } else if (node.type === "command") {
      this.emitImportCommand(node, active)
    } else if (node.type === "handle_operator" || node.type === "metaclass_operator") {
      // A name CAPTURED rather than invoked: `@fn` is a function handle and `?Name` is a
      // metaclass object. Neither is a call site, so both are `references` and the identifier
      // they carry is not additionally published as a plain `uses` read.
      const target = this.dottedText(node)
      if (this.isIdentifierPath(target)) {
        const construct = node.type === "handle_operator" ? "function_handle" : "metaclass_object"
        this.emit(RelationshipType.References, active?.name ?? "root", target, node, this.confidence(target), { construct })
      }
    } else if (node.type === "superclass") {
      // `method@SuperClass(obj)` — a qualified call into a superclass's method namespace. The
      // superclass named here is REFERENCED, not instantiated, by this call site.
      const target = this.dottedText(node)
      if (this.isIdentifierPath(target)) {
        this.emit(RelationshipType.References, active?.name ?? "root", target, node, this.confidence(target), { construct: "superclass_method_call" })
      }
    } else if (node.type === "assignment") {
      this.emitReads(node.childForFieldName("right"), active)
    } else if (node.type === "identifier") {
      this.emitIdentifierRead(node, active)
    }
    for (const child of node.namedChildren) if (child) this.walk(child, active)
  }

  private emitReads(node: Node | null, owner?: ASTEngine.UniversalSymbol): void {
    if (!node) return
    if (node.type === "function_call") {
      const target = node.childForFieldName("name") ?? this.firstIdentifier(node)
      if (target) this.emitCallee(node, target, owner?.name ?? "root")
      return
    }
    if (node.type === "field_expression") {
      const object = node.childForFieldName("object")
      const field = node.childForFieldName("field")
      if (object && field && owner) {
        this.emit(RelationshipType.Uses, owner.name, object.text, object, this.confidence(object.text), { construct: "field_receiver", field: field.text })
        this.emit(RelationshipType.Uses, owner.name, field.text, field, this.confidence(field.text), { construct: "field_member", receiver: object.text })
      }
      return
    }
    for (const child of node.namedChildren) if (child) this.emitReads(child, owner)
  }

  private emitIdentifierRead(node: Node, owner?: ASTEngine.UniversalSymbol): void {
    if (!owner || this.isDeclarationName(node)) return
    const parent = node.parent
    if (!parent || parent.type === "function_arguments") return
    if (parent.type === "superclasses" || parent.parent?.type === "superclasses") return
    // The identifiers inside `@name`, `?Name` and `method@SuperClass` are already published by
    // the reference handler, with a stronger label than a plain value read.
    if (parent.type === "handle_operator" || parent.type === "metaclass_operator" || parent.type === "superclass") return
    if (this.isClassMetadata(node)) return
    if (parent.type === "assignment" && parent.childForFieldName("left")?.startIndex === node.startIndex) return
    if (parent.type === "function_call" && parent.childForFieldName("name")?.startIndex === node.startIndex) return
    if (parent.type === "field_expression") return
    this.emit(RelationshipType.Uses, owner.name, node.text, node, this.confidence(node.text))
  }

  private isDeclarationName(node: Node): boolean {
    if (!node.parent) return false
    if (node.parent.type === "events") return true
    if (node.parent.type === "enum") return true
    return ["function_definition", "class_definition", "property"].includes(node.parent.type) &&
      node.parent.childForFieldName("name")?.startIndex === node.startIndex
  }

  private isClassMetadata(node: Node): boolean {
    let parent = node.parent
    while (parent) {
      if (parent.type === "attributes" || parent.type === "attribute") return true
      if (["function_definition", "class_definition", "property", "events", "enum"].includes(parent.type)) return false
      parent = parent.parent
    }
    return false
  }

  private attributes(node: Node): string[] {
    const sources = [node, node.parent].filter((candidate): candidate is Node => !!candidate)
    return sources.flatMap((source) => {
      const attributes = source.namedChildren.find((child) => child?.type === "attributes")
      if (!attributes) return []
      return attributes.namedChildren
        .filter((child): child is Node => !!child && child.type === "attribute")
        .map((attribute) => attribute.text)
    })
  }

  private visibility(node: Node): ASTEngine.UniversalSymbol["visibility"] {
    const attributes = this.attributes(node).map((attribute) => attribute.toLowerCase())
    if (attributes.some((attribute) => attribute.includes("private"))) return "private"
    if (attributes.some((attribute) => attribute.includes("protected"))) return "protected"
    return "public"
  }

  private parameters(node: Node): ASTEngine.Parameter[] | undefined {
    const args = node.namedChildren.find((child) => child?.type === "function_arguments") ?? null
    if (!args) return undefined
    return args.namedChildren.flatMap((child) =>
      child && child.type === "identifier" ? [{ name: child.text }] : [])
  }

  private identifiers(node: Node | null): Node[] {
    if (!node) return []
    if (node.type === "identifier") return [node]
    return node.namedChildren.flatMap((child) => child ? this.identifiers(child) : [])
  }

  private firstIdentifier(node: Node): Node | null {
    return this.identifiers(node)[0] ?? null
  }

  private enclosingClassName(node: Node): string | null {
    let parent = node.parent
    while (parent) {
      if (parent.type === "class_definition") {
        const name = parent.childForFieldName("name") ?? this.firstIdentifier(parent)
        return name?.text ?? null
      }
      parent = parent.parent
    }
    return null
  }

  private emitCallee(_call: Node, target: Node, source: string): void {
    // Object construction in MATLAB is the class name applied to arguments — the grammar cannot
    // tell it apart from a function call. A callee naming a class declared in THIS file is
    // construction, and it is published as `instantiates` instead of a plain call: the same call
    // site cannot carry both labels.
    const name = target.type === "identifier" ? target.text : ""
    if (name !== "" && this.classNames.has(this.fold(name))) {
      this.emit(RelationshipType.Instantiates, source, name, target, this.confidence(name), { construct: "class_constructor_call" })
      return
    }
    this.emit(RelationshipType.Calls, source, target.text, target, this.confidence(target.text))
  }

  /**
   * `import` is a COMMAND statement, not a call: the grammar gives it `command_name` +
   * `command_argument` external tokens. Only the `import` command is a name-resolution
   * directive; every other command (`clear all`, `hold on`, …) is left alone here because a
   * command is not a module import.
   *
   * The argument is published only when it is a SYMBOL-SHAPED path: `mypkg.f` (qualified
   * name), `mypkg` (bare name) and `mypkg.*` (the package, which is what the wildcard makes
   * reachable — the raw `mypkg.*` spelling is a wildcard, never a symbol, so it is never the
   * target). A header path such as `<Foundation/Foundation.h>` is not identifier-shaped and
   * publishes nothing.
   */
  private emitImportCommand(node: Node, owner?: ASTEngine.UniversalSymbol): void {
    const nameNode = node.namedChildren.find((child) => child?.type === "command_name") ?? null
    if ((nameNode?.text ?? "").trim() !== "import") return
    const source = owner?.name ?? "root"
    for (const child of node.namedChildren) {
      if (!child || child.type !== "command_argument") continue
      const argument = child.text.trim()
      if (argument.length === 0) continue
      const wildcard = argument.endsWith(".*")
      const target = wildcard ? argument.slice(0, argument.length - 2) : argument
      if (!this.isIdentifierPath(target)) continue
      let importForm = "name"
      if (wildcard) importForm = "package_wildcard"
      else if (target.includes(".")) importForm = "qualified_name"
      this.emit(RelationshipType.Imports, source, target, child, this.confidence(target), { importForm })
    }
  }

  /** File-scoped facts that need the whole declaration list: overrides, exports and the
   *  folder-namespace `part_of`. */
  private emitFileScopeRelationships(declarations: Decl[], context?: ASTEngine.AnalyzeContext): void {
    this.emitOverrides(declarations, context)
    this.emitModuleMembership(declarations)
  }

  /**
   * A MATLAB override is a METHOD that redeclares a member of a superclass. MATLAB allows one
   * `classdef` per file, so the base is usually in ANOTHER file and the analyzer can only see
   * it through `context.overrideCompanion` (the same companion the other file-scoped analyzers
   * read). A base declared in THIS file is provable directly. An unverifiable base publishes
   * nothing: guessing would invent an override the file cannot show.
   */
  private emitOverrides(declarations: Decl[], context?: ASTEngine.AnalyzeContext): void {
    type ClassEntry = { display: string; node: Node; methods: Map<string, { name: string; node: Node }> }
    const classes = new Map<string, ClassEntry>()
    for (const declaration of declarations) {
      if (declaration.kind !== SymbolKind.Class) continue
      classes.set(this.fold(declaration.name.text), { display: declaration.name.text, node: declaration.node, methods: new Map() })
    }
    if (classes.size === 0) return
    for (const declaration of declarations) {
      if (declaration.kind !== SymbolKind.Method) continue
      const ownerName = this.enclosingClassName(declaration.node)
      const owner = ownerName ? classes.get(this.fold(ownerName)) : undefined
      if (!owner) continue
      owner.methods.set(this.fold(declaration.name.text), { name: declaration.name.text, node: declaration.node })
    }
    const companion = context?.overrideCompanion
    for (const entry of classes.values()) {
      const supers = entry.node.namedChildren.find((child) => child?.type === "superclasses") ?? null
      if (!supers) continue
      for (const base of supers.namedChildren) {
        if (!base || base.type !== "property_name") continue
        const baseName = this.dottedText(base)
        if (baseName === "") continue
        const sameFile = classes.get(this.fold(baseName))
        const baseMethods = sameFile
          ? new Set(sameFile.methods.keys())
          : this.companionMethodsFor(companion, baseName)
        if (baseMethods.size === 0) continue
        for (const method of entry.methods.values()) {
          if (!baseMethods.has(this.fold(method.name))) continue
          this.emit(RelationshipType.Overrides, entry.display, method.name, method.node, 1, {
            overridingMember: `${entry.display}.${method.name}`,
            overriddenMember: `${baseName}.${method.name}`,
            overriddenClass: baseName,
            reasonCode: sameFile ? "base_class_declared_in_same_file" : "companion_index",
          })
        }
      }
    }
  }

  /**
   * THE FILE IS MATLAB'S MODULE, and `+pkg/` FOLDERS are its namespace — neither fact has a
   * textual construct, so both are read from the path the engine hands the analyzer.
   *
   *   exports  the file exports its primary (first, top-level) declaration under the module's
   *            name. When the module and that declaration share one spelling — the ordinary
   *            `foo.m`/`foo` identity — the row would be X -> X and carries no information, so
   *            it is withheld rather than published as noise.
   *   part_of  a declaration in a `+pkg/` file is a part of that folder's package. The package
   *            is a folder-based namespace with no textual inclusion, which is why the row's
   *            `partRole` is `part` (this declaration is a part of the package).
   */
  private emitModuleMembership(declarations: Decl[]): void {
    const topLevel = declarations.filter((declaration) => this.isTopLevelDeclaration(declaration.node))
    if (topLevel.length === 0) return
    const primary = topLevel[0]
    if (this.moduleName !== "" && this.moduleName !== primary.name.text) {
      this.emit(RelationshipType.Exports, this.moduleName, primary.name.text, primary.name, 1, {
        exportForm: this.packageName !== "" ? "package_qualified_module" : "file_module",
      })
    }
    if (this.packageName === "") return
    for (const declaration of topLevel) {
      this.emit(RelationshipType.PartOf, declaration.name.text, this.packageName, declaration.name, 1, {
        partRole: "part",
        packagePath: this.packageName,
        construct: "package_folder_membership",
      })
    }
  }

  /** A declaration is top-level when no enclosing declaration owns it: a method of a class,
   *  a nested function and a local function are all owned, so none of them is exported. */
  private isTopLevelDeclaration(node: Node): boolean {
    let parent = node.parent
    while (parent) {
      if (parent.type === "function_definition" || parent.type === "class_definition") return false
      parent = parent.parent
    }
    return true
  }

  private companionMethodsFor(companion: Map<string, Set<string>> | undefined, baseName: string): Set<string> {
    const folded = new Set<string>()
    if (!companion) return folded
    const leaf = baseName.includes(".") ? baseName.slice(baseName.lastIndexOf(".") + 1) : baseName
    for (const key of [baseName, leaf]) {
      const members = companion.get(key)
      if (!members) continue
      for (const member of members) folded.add(this.fold(member))
    }
    return folded
  }

  /** The dotted text of a `property_name` / `handle_operator` / `metaclass_operator` /
   *  `superclass` node — its identifiers joined with dots, so `pkg.f` is ONE target. */
  private dottedText(node: Node): string {
    return this.identifiers(node).map((identifier) => identifier.text).join(".")
  }

  /** Is `text` a dotted sequence of identifier segments? Character-class test only: a name may
   *  not be a path, a wildcard or a bracketed header. No regular expression is used anywhere in
   *  this analyzer. */
  private isIdentifierPath(text: string): boolean {
    if (text.length === 0) return false
    let start = 0
    for (let i = 0; i <= text.length; i++) {
      if (i !== text.length && text[i] !== ".") continue
      if (i === start) return false
      if (!this.isIdentifierSegment(text.slice(start, i))) return false
      start = i + 1
    }
    return true
  }

  private isIdentifierSegment(segment: string): boolean {
    if (segment.length === 0) return false
    const first = segment.charCodeAt(0)
    const firstOk = (first >= 65 && first <= 90) || (first >= 97 && first <= 122) || first === 95
    if (!firstOk) return false
    for (let i = 1; i < segment.length; i++) {
      const code = segment.charCodeAt(i)
      const ok = (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || (code >= 48 && code <= 57) || code === 95
      if (!ok) return false
    }
    return true
  }

  /** Path segments, split on both separators so the analyzer is host-independent. */
  private splitPath(filePath: string): string[] {
    const out: string[] = []
    let start = 0
    for (let i = 0; i <= filePath.length; i++) {
      if (i !== filePath.length && filePath[i] !== "/" && filePath[i] !== "\\") continue
      if (i > start) out.push(filePath.slice(start, i))
      start = i + 1
    }
    return out
  }

  /** The dotted package a file belongs to, from the `+pkg` FOLDER names in its path. A nested
   *  `+a/+b/f.m` is `a.b`, which is MATLAB's own package nesting rule. */
  private packageFromPath(filePath: string): string {
    const segments = this.splitPath(filePath)
    const names: string[] = []
    for (const segment of segments.slice(0, -1)) {
      if (segment.length > 1 && segment[0] === "+" && this.isIdentifierSegment(segment.slice(1))) {
        names.push(segment.slice(1))
      }
    }
    return names.join(".")
  }

  private moduleNameFromPath(filePath: string, packageName: string): string {
    const segments = this.splitPath(filePath)
    let base = segments.length > 0 ? segments[segments.length - 1] : ""
    if (base.length > 2 && base.slice(base.length - 2).toLowerCase() === ".m") base = base.slice(0, base.length - 2)
    if (base === "") return ""
    return packageName === "" ? base : `${packageName}.${base}`
  }

  private confidence(target: string): number {
    return this.declarations.has(this.fold(target)) ? 1 : 0.6
  }

  private emit(type: ASTEngine.RelationshipType, source: string, target: string, node: Node, confidence: number, metadata: Record<string, unknown> = {}): void {
    const key = `${source}\u0000${type}\u0000${target}\u0000${node.startPosition.row + 1}`
    if (this.emitted.has(key)) return
    this.emitted.add(key)
    this.relationships.push({
      source, target, type, confidence,
      line_number: node.startPosition.row + 1,
      metadata: { evidenceClass: confidence < 0.7 ? "inferred" : "structural", ...metadata },
    })
  }

  private fold(value: string): string { return value.toLowerCase() }

  private lineCount(value: string): number {
    let count = 1
    for (const character of value) if (character === "\n") count += 1
    return count
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
}
