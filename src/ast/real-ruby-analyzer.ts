import type { Node } from "web-tree-sitter"
import { ASTEngine } from "./engine"

// ============================================================================
// RUBY BUILTINS — filtered from call relationships (same contract as JS/Python)
// ============================================================================
const RUBY_BUILTINS = new Set([
  // Kernel / top-level
  "puts", "print", "p", "pp", "p$", "print_flush", "putc",
  "raise", "fail", "exit", "exit!", "abort", "warn",
  "gets", "readline", "readlines", "rand", "srand",
  "sleep", "loop", "require", "require_relative", "load",
  "autoload", "eval", "binding", "local_variables",
  "global_variables", "global_variable_get", "global_variable_set",
  "caller", "caller_locations", "trace_var", "untrace_var",
  "method", "public_method", "private_method", "protected_method",
  "instance_method", "public_instance_method", "private_instance_method",
  "respond_to", "respond_to?", "class", "superclass",
  "Object", "Kernel", "BasicObject", "NilClass", "TrueClass", "FalseClass",
  "Integer", "Float", "String", "Array", "Hash", "Symbol", "Regexp", "Range",
  "IO", "File", "Dir", "Process", "Signal", "GC", "ObjectSpace",
  "Marshal", "Thread", "Fiber", "Random", "SecureRandom",
  "Time", "Date", "DateTime", "Math",
  "Comparable", "Enumerable", "Errno",
  // Ruby dunders / special methods
  "super", "method_missing", "respond_to_missing?", "initialize_copy",
  "initialize_dup", "initialize_clone", "send", "__send__",
  "freeze", "frozen?", "dup", "clone", "taint", "untaint", "trust", "untrust",
  "hash", "eql?", "equal?", "object_id", "instance_of?", "kind_of?", "is_a?",
  "nil?", "instance_variable_defined?", "instance_variables",
  "instance_variable_get", "instance_variable_set",
  "class_variables", "class_variable_defined?", "class_variable_get", "class_variable_set",
  "const_defined?", "const_get", "const_set", "const_defined?",
  "method_defined?", "private_method_defined?", "protected_method_defined?",
  "singleton_method", "define_singleton_method",
  "to_s", "to_i", "to_f", "to_a", "to_h", "to_proc", "inspect", "display",
  "extend", "include", "prepend",
  // Rails macros (emit properties, not call edges)
  "has_many", "belongs_to", "has_one", "has_and_belongs_to_many",
  "scope", "default_scope",
  "validates", "validate", "validates_with", "validates_each",
  "before_action", "after_action", "before_filter", "after_filter",
  "before_validation", "after_validation",
  "before_save", "after_save", "before_create", "after_create",
  "before_update", "after_update", "before_destroy", "after_destroy",
  "before_commit", "after_commit", "after_rollback",
  "attr_reader", "attr_writer", "attr_accessor",
  "alias_method", "remove_method", "undef_method",
  "delegate", "delegate_missing_to",
  "event", "transition", "state_machine",
  "module_function", "using",
  "ruby2_keywords", "no_touching",
])

// Rails-specific call targets (emit as property/use edges, not call edges)
const RAILS_MACRO_METHODS = new Set([
  "has_many", "belongs_to", "has_one", "has_and_belongs_to_many",
  "scope", "default_scope",
  "validates", "validate", "validates_with", "validates_each",
  "attr_reader", "attr_writer", "attr_accessor",
  "alias_method", "remove_method", "undef_method",
  "delegate", "delegate_missing_to",
  "event", "transition",
  "before_action", "after_action",
  "before_validation", "after_validation",
  "before_save", "after_save", "before_create", "after_create",
  "before_update", "after_update", "before_destroy", "after_destroy",
  "before_commit", "after_commit", "after_rollback",
  "define_method",
  "module_function",
])

// ============================================================================
// MAIN ANALYZER
// ============================================================================
export class RealRubyAnalyzer implements ASTEngine.LanguageAnalyzer {
  public analyze(
    rootNode: Node,
    content: string,
    filePath: string,
    context?: ASTEngine.AnalyzeContext,
  ): Omit<ASTEngine.ParseResult, "language" | "metadata"> & { metadata?: Partial<ASTEngine.FileMetadata> } {
    const symbols: ASTEngine.UniversalSymbol[] = []
    const imports: ASTEngine.ImportInfo[] = []
    const exports: ASTEngine.ExportInfo[] = []
    const relationships: ASTEngine.UniversalRelationship[] = []

    const metadata: Partial<ASTEngine.FileMetadata> = {
      detectedFrameworks: [],
      frameworkPatterns: [],
      cyclomaticComplexity: 1,
      linesOfCode: 0,
    }

    if (!rootNode) return { symbols, imports, errors: [] }

    // --- Error collection ---
    if (rootNode.hasError) {
      const errStack: Node[] = [rootNode]
      while (errStack.length > 0) {
        const n = errStack.pop()!
        if (n.type === "ERROR" || n.isMissing) {
          if (!metadata.errors) metadata.errors = []
          metadata.errors.push({
            message: `Syntax ${n.type} detected.`,
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

    // --- Line count ---
    let loc = 1
    for (let i = 0; i < content.length; i++) {
      if (content[i] === "\n") loc++
    }
    metadata.linesOfCode = loc

    // ========================================================================
    // EXTRACTIVE WALK — iterative stack, single pass
    // ========================================================================
    // Scope tracking: modules/classes → owner chain
    // Visibility tracking: private/protected state markers
    // Call source: the nearest enclosing method/function name
    const visibilityOverrides = new Map<string, string>()
    const stack: {
      node: Node
      owner: string | undefined
      ownerKind: string | undefined
      visibility: string
      isSingleton: boolean
    }[] = [{
      node: rootNode,
      owner: undefined,
      ownerKind: undefined,
      visibility: "public",
      isSingleton: false,
    }]

    while (stack.length > 0) {
      const frame = stack.pop()!
      const { node, owner, ownerKind, visibility, isSingleton } = frame
      const type = node.type

      // --- Class ---
      if (type === "class") {
        const nameNode = node.childForFieldName("name")
        if (!nameNode) continue
        const name = nameNode.text

        const superClass = this.extractSuperclass(node)
        const isRailsModel = this.isRailsModelName(superClass)
        const isRailsController = this.isRailsControllerName(superClass)

        if (isRailsModel || isRailsController) {
          metadata.detectedFrameworks!.push("Ruby on Rails")
        }

        const sym: ASTEngine.UniversalSymbol = {
          name,
          kind: ASTEngine.SymbolKind.Class,
          range: this.nodeToRange(node),
          ownerName: owner,
          metadata: { superClass, isRailsModel, isRailsController },
        }
        symbols.push(sym)
        // extends relationship
        if (superClass) {
          const leaf = this.leafName(superClass)
          relationships.push({
            source: name,
            target: leaf,
            type: ASTEngine.RelationshipType.Extends,
            confidence: 1.0,
            metadata: {},
          })
        }

        // Walk the body in source order. Visibility is lexical in Ruby, so
        // capture it on each frame rather than using mutable global state.
        const body = this.findChild(node, "body_statement")
        if (body) {
          const bodyFrames: typeof stack = []
          let bodyVisibility = "public"
          for (let i = 0; i < body.namedChildCount; i++) {
            const child = body.namedChild(i)
            if (!child) continue
            bodyFrames.push({
              node: child,
              owner: name,
              ownerKind: "class",
              visibility: bodyVisibility,
              isSingleton: false,
            })
            if (this.isNoArgumentVisibilityMarker(child)) {
              bodyVisibility = child.text
            }
          }
          for (let i = bodyFrames.length - 1; i >= 0; i--) stack.push(bodyFrames[i])
        }
        continue
      }

      // --- Module ---
      if (type === "module") {
        const nameNode = node.childForFieldName("name")
        if (!nameNode) continue
        const name = nameNode.text

        const sym: ASTEngine.UniversalSymbol = {
          name,
          kind: ASTEngine.SymbolKind.Module,
          range: this.nodeToRange(node),
          ownerName: owner,
          metadata: {},
        }
        symbols.push(sym)
        const body = this.findChild(node, "body_statement")
        if (body) {
          const bodyFrames: typeof stack = []
          let bodyVisibility = "public"
          for (let i = 0; i < body.namedChildCount; i++) {
            const child = body.namedChild(i)
            if (!child) continue
            bodyFrames.push({
              node: child,
              owner: name,
              ownerKind: "module",
              visibility: bodyVisibility,
              isSingleton: false,
            })
            if (this.isNoArgumentVisibilityMarker(child)) {
              bodyVisibility = child.text
            }
          }
          for (let i = bodyFrames.length - 1; i >= 0; i--) stack.push(bodyFrames[i])
        }
        continue
      }

      // --- Method ---
      if (type === "method") {
        const nameNode = node.childForFieldName("name")
        if (!nameNode) continue
        const name = nameNode.text

        const params = this.extractParameters(node)
        const isTopLevel = !owner

        const sym: ASTEngine.UniversalSymbol = {
          name,
          kind: isTopLevel ? ASTEngine.SymbolKind.Function : ASTEngine.SymbolKind.Method,
          range: this.nodeToRange(node),
          ownerName: owner,
          parameters: params,
          visibility: visibility as any,
          isStatic: isSingleton || undefined,
          metadata: isSingleton ? { isSingleton: true } : {},
        }
        symbols.push(sym)

        const enclosingMethod = name

        // Walk body
        const body = this.findChild(node, "body_statement")
        if (body) {
          this.walkBody(body, symbols, relationships, imports, metadata,
            owner, ownerKind, enclosingMethod, visibilityOverrides)
        }

        continue
      }

      // --- Singleton class (class << self) ---
      // Its methods belong to the enclosing class and are static/singleton
      // methods, even though the grammar represents them as ordinary `method`
      // nodes inside a `singleton_class` container.
      if (type === "singleton_class") {
        const body = this.findChild(node, "body_statement")
        if (body) {
          const bodyFrames: typeof stack = []
          let bodyVisibility = "public"
          for (let i = 0; i < body.namedChildCount; i++) {
            const child = body.namedChild(i)
            if (!child) continue
            bodyFrames.push({
              node: child,
              owner,
              ownerKind: "class",
              visibility: bodyVisibility,
              isSingleton: true,
            })
            if (this.isNoArgumentVisibilityMarker(child)) bodyVisibility = child.text
          }
          for (let i = bodyFrames.length - 1; i >= 0; i--) stack.push(bodyFrames[i])
        }
        continue
      }

      // --- Singleton method (def self.foo) ---
      if (type === "singleton_method") {
        const nameNode = node.childForFieldName("name")
        if (!nameNode) continue
        const name = nameNode.text

        const params = this.extractParameters(node)
        const isTopLevel = !owner

        const sym: ASTEngine.UniversalSymbol = {
          name,
          kind: isTopLevel ? ASTEngine.SymbolKind.Function : ASTEngine.SymbolKind.Method,
          range: this.nodeToRange(node),
          ownerName: owner,
          parameters: params,
          visibility: visibility as any,
          isStatic: true,
          metadata: { isSingleton: true },
        }
        symbols.push(sym)

        const body = this.findChild(node, "body_statement")
        if (body) {
          this.walkBody(body, symbols, relationships, imports, metadata,
            owner, ownerKind, name, visibilityOverrides)
        }

        continue
      }

      // --- Visibility markers (private, protected, public) ---
      // Ruby's grammar represents these bare keywords as named identifiers.
      if (type === "identifier") {
        const text = node.text
        if (text === "private" || text === "protected" || text === "public") {
          continue
        }
      }

      // --- Calls in top-level/module/class bodies ---
      // Method bodies are consumed by walkBody above, so this handles only
      // declaration-time calls such as require/include/attr_reader.
      if (type === "call") {
        this.processCall(node, symbols, relationships, imports, metadata,
          owner, undefined, visibilityOverrides)
        continue
      }

      // --- Program/top-level statements ---
      // The root `program` node has no owner; forward its named children into
      // the same iterative traversal so top-level modules/classes are visited.
      if (type === "program") {
        for (let i = node.namedChildCount - 1; i >= 0; i--) {
          const child = node.namedChild(i)
          if (child) stack.push({ node: child, owner, ownerKind, visibility, isSingleton: false })
        }
        continue
      }

      // --- Assignment at module/class level (constants, instance vars) ---
      if (type === "assignment" && owner) {
        const left = node.childForFieldName("left")
        if (left) {
          const leftType = left.type
          if (leftType === "constant") {
            symbols.push({
              name: left.text,
              kind: ASTEngine.SymbolKind.Constant,
              range: this.nodeToRange(node),
              ownerName: owner,
              visibility: visibility as any,
              metadata: { variableType: "constant" },
            })
          }
          // Instance/class/global variables at class level: skip (noise)
        }
      }
    }

    // Apply symbol-list visibility directives in one linear pass. Keeping the
    // directive map separate avoids an O(symbols) scan for every `private :x`.
    for (const symbol of symbols) {
      if (!symbol.ownerName) continue
      const override = visibilityOverrides.get(`${symbol.ownerName}\u0000${symbol.name}`)
      if (override) symbol.visibility = override as any
    }

    // --- Override relationships ---
    // Ruby permits implicit overrides; use local declarations first, then the
    // project companion index supplied by the production/differential caller.
    const baseByClass = new Map<string, string>()
    for (const s of symbols) {
      if (s.kind === ASTEngine.SymbolKind.Class && s.metadata?.superClass) {
        baseByClass.set(s.name, this.leafName(String(s.metadata.superClass)))
      }
    }
    const methodsByOwner = new Map<string, Set<string>>()
    for (const s of symbols) {
      if (s.kind !== ASTEngine.SymbolKind.Method || !s.ownerName) continue
      let names = methodsByOwner.get(s.ownerName)
      if (!names) {
        names = new Set<string>()
        methodsByOwner.set(s.ownerName, names)
      }
      names.add(s.name)
    }
    for (const s of symbols) {
      if (s.kind !== ASTEngine.SymbolKind.Method || !s.ownerName) continue
      const base = baseByClass.get(s.ownerName)
      if (!base) continue
      const baseMethods = methodsByOwner.get(base) ?? context?.overrideCompanion?.get(base)
      if (baseMethods?.has(s.name)) {
        relationships.push({
          source: `${s.ownerName}.${s.name}`,
          target: `${base}.${s.name}`,
          type: ASTEngine.RelationshipType.Overrides,
          confidence: 0.95,
          metadata: { isOverride: true },
        })
      }
    }

    // --- Contains relationships (from ownerName on symbols) ---
    for (const s of symbols) {
      const _owner = s.ownerName
      if (_owner) {
        relationships.push({
          source: _owner,
          target: s.name,
          type: ASTEngine.RelationshipType.Contains,
          confidence: 1.0,
          metadata: {},
        })
      }
    }

    return {
      symbols,
      imports,
      relationships,
      exports,
      metadata,
      errors: metadata.errors || [],
    }
  }

  // ========================================================================
  // BODY WALKER — processes statements inside a method/function body
  // Handles: calls, require/require_relative, include/extend/prepend,
  //          attr_*, define_method, alias_method, etc.
  // ========================================================================
  private walkBody(
    node: Node,
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
    imports: ASTEngine.ImportInfo[],
    metadata: Partial<ASTEngine.FileMetadata>,
    owner: string | undefined,
    ownerKind: string | undefined,
    enclosingMethod: string | undefined,
    visibilityOverrides: Map<string, string>,
  ): void {
    // Iterative DFS
    const stack: Node[] = [node]
    while (stack.length > 0) {
      const n = stack.pop()!
      const type = n.type

      // --- Call (all Ruby calls: method(), obj.method(), command-style) ---
      if (type === "call") {
        this.processCall(n, symbols, relationships, imports, metadata,
          owner, enclosingMethod, visibilityOverrides)
      }

      // --- Complexity counting ---
      if (type === "if" || type === "unless" || type === "while" ||
          type === "until" || type === "case" || type === "rescue" ||
          type === "elsif") {
        if (metadata.cyclomaticComplexity !== undefined) {
          metadata.cyclomaticComplexity++
        }
      }

      // Recurse into children
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const child = n.namedChild(i)
        if (child) stack.push(child)
      }
    }
  }

  // ========================================================================
  // CALL PROCESSOR — resolves a single `call` node
  // ========================================================================
  private processCall(
    node: Node,
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
    imports: ASTEngine.ImportInfo[],
    metadata: Partial<ASTEngine.FileMetadata>,
    owner: string | undefined,
    enclosingMethod: string | undefined,
    visibilityOverrides: Map<string, string>,
  ): void {
    const methodNode = node.childForFieldName("method")
    if (!methodNode) return
    const methodName = methodNode.text
    if (!methodName) return

    // --- Extract receiver (identifier before the method name) ---
    let receiver: string | undefined
    let receiverLeaf: string | undefined
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child && child.id === methodNode.id) break
      if (child && (child.type === "identifier" || child.type === "constant" || child.type === "scope_resolution")) {
        receiver = child.text
        receiverLeaf = this.leafName(child.text)
      }
    }

    // --- Visibility directives ---
    // `private`/`protected`/`public` are declarations, not call edges. The
    // symbol-list form (`private :helper`) changes already-declared methods;
    // the bare form is captured lexically when class frames are built.
    if (methodName === "private" || methodName === "protected" || methodName === "public") {
      const args = this.findChild(node, "argument_list")
      if (args && owner && args.namedChildCount > 0) {
        for (let i = 0; i < args.namedChildCount; i++) {
          const arg = args.namedChild(i)
          if (!arg || arg.type !== "simple_symbol") continue
          const targetName = this.stripSymbolColon(arg.text)
          visibilityOverrides.set(`${owner}\u0000${targetName}`, methodName)
        }
      }
      return
    }

    // --- require / require_relative / load ---
    if (methodName === "require" || methodName === "require_relative" || methodName === "load") {
      const args = this.findChild(node, "argument_list")
      if (args) {
        for (let i = 0; i < args.childCount; i++) {
          const arg = args.child(i)
          if (arg && arg.type === "string") {
            const cleanText = this.stripQuotes(arg.text)
            imports.push({
              module: cleanText,
              names: [],
              range: this.nodeToRange(node),
              isWildcard: true,
              metadata: { requireMethod: methodName },
            })
            relationships.push({
              source: "root",
              target: cleanText,
              type: ASTEngine.RelationshipType.References,
              confidence: 0.9,
              metadata: { requireMethod: methodName },
            })
          }
        }
      }
      return
    }

    // --- include / extend / prepend (mixin relationships) ---
    if (methodName === "include" || methodName === "extend" || methodName === "prepend") {
      const relType = methodName === "extend"
        ? ASTEngine.RelationshipType.Extends
        : ASTEngine.RelationshipType.Implements
      const args = this.findChild(node, "argument_list")
      if (args) {
        for (let i = 0; i < args.namedChildCount; i++) {
          const arg = args.namedChild(i)
          if (arg && (arg.type === "constant" || arg.type === "identifier" || arg.type === "scope_resolution")) {
            const target = this.leafName(arg.text)
            relationships.push({
              source: owner || "unknown",
              target,
              type: relType,
              confidence: 1.0,
              metadata: { mixinType: methodName },
            })
          }
        }
      }
      return
    }

    // --- attr_reader / attr_writer / attr_accessor ---
    if (methodName === "attr_reader" || methodName === "attr_writer" || methodName === "attr_accessor") {
      const args = this.findChild(node, "argument_list")
      if (args) {
        for (let i = 0; i < args.namedChildCount; i++) {
          const arg = args.namedChild(i)
          if (arg && (arg.type === "simple_symbol")) {
            let propName = this.stripSymbolColon(arg.text)
            symbols.push({
              name: propName,
              kind: ASTEngine.SymbolKind.Property,
              range: this.nodeToRange(node),
              ownerName: owner,
              visibility: "public" as any,
              metadata: { accessorType: methodName },
            })
          }
        }
      }
      return
    }

    // --- define_method ---
    if (methodName === "define_method") {
      const args = this.findChild(node, "argument_list")
      if (args) {
        for (let i = 0; i < args.namedChildCount; i++) {
          const arg = args.namedChild(i)
          if (arg && (arg.type === "simple_symbol" || arg.type === "string")) {
            let name = this.stripSymbolColon(arg.text)
            if (arg.type === "string") name = this.stripQuotes(arg.text)
            symbols.push({
              name,
              kind: ASTEngine.SymbolKind.Method,
              range: this.nodeToRange(node),
              ownerName: owner,
              visibility: "public" as any,
              metadata: { isDynamicMethod: true },
            })
            break
          }
        }
      }
      return
    }

    // --- alias_method ---
    if (methodName === "alias_method") {
      const args = this.findChild(node, "argument_list")
      if (args) {
        const names: string[] = []
        for (let i = 0; i < args.namedChildCount && names.length < 2; i++) {
          const arg = args.namedChild(i)
          if (arg && (arg.type === "simple_symbol")) {
            names.push(this.stripSymbolColon(arg.text))
          }
        }
        if (names.length === 2) {
          relationships.push({
            source: owner || "unknown",
            target: names[0],
            type: ASTEngine.RelationshipType.Calls,
            confidence: 0.9,
            metadata: { aliasedTo: names[1] },
          })
        }
      }
      return
    }

    // --- has_many / belongs_to / has_one / has_and_belongs_to_many ---
    if (RAILS_MACRO_METHODS.has(methodName)) {
      if (["has_many", "belongs_to", "has_one", "has_and_belongs_to_many"].includes(methodName)) {
        const args = this.findChild(node, "argument_list")
        if (args) {
          for (let i = 0; i < args.namedChildCount; i++) {
            const arg = args.namedChild(i)
            if (arg && (arg.type === "simple_symbol" || arg.type === "string" || arg.type === "identifier")) {
              let name = this.stripSymbolColon(arg.text)
              if (arg.type === "string") name = this.stripQuotes(arg.text)
              symbols.push({
                name,
                kind: ASTEngine.SymbolKind.Property,
                range: this.nodeToRange(node),
                ownerName: owner,
                visibility: "public" as any,
                metadata: { associationType: methodName },
              })
              relationships.push({
                source: owner || "unknown",
                target: name,
                type: ASTEngine.RelationshipType.Uses,
                confidence: 0.8,
                metadata: { activerecordMacro: methodName },
              })
            }
          }
        }
      } else if (methodName === "scope" || methodName === "default_scope") {
        const args = this.findChild(node, "argument_list")
        if (args && args.namedChildCount > 0) {
          const firstArg = args.namedChild(0)
          if (firstArg && (firstArg.type === "simple_symbol")) {
            const scopeName = this.stripSymbolColon(firstArg.text)
            symbols.push({
              name: scopeName,
              kind: ASTEngine.SymbolKind.Method,
              range: this.nodeToRange(node),
              ownerName: owner,
              visibility: "public" as any,
              metadata: { scopeType: methodName },
            })
          }
        }
      }
      // All RAILS_MACRO_METHODS: no call relationship emitted
      return
    }

    // --- Framework detection ---
    if (methodName === "redirect_to" || methodName === "render") {
      metadata.detectedFrameworks!.push("Ruby on Rails")
    }
    if (methodName === "before_action" || methodName === "after_action") {
      metadata.frameworkPatterns!.push({ framework: "Rails", patterns: ["Callbacks"] })
    }

    // --- Skip builtins ---
    if (RUBY_BUILTINS.has(methodName)) return

    // --- String interpolation: self.class inside #{...} → skip ---
    if (methodName === "class" && receiver === "self") return

    const source = enclosingMethod || owner || "Global"

    // `Class.new(...)` is a constructor expression, not an ordinary call.
    // A bare `new(...)` inside a class method constructs the owning class.
    if (methodName === "new") {
      const target = receiverLeaf || (!receiver ? owner : undefined)
      const firstChar = target?.charCodeAt(0) ?? 0
      if (target && (!receiverLeaf || (firstChar >= 65 && firstChar <= 90))) {
        relationships.push({
          source,
          target,
          fromSymbol: source,
          toSymbol: target,
          type: ASTEngine.RelationshipType.Instantiates,
          confidence: 0.9,
          metadata: {},
        })
        return
      }
    }

    // --- Regular call relationship ---
    const qualified = receiver ? `${receiver}.${methodName}` : methodName
    relationships.push({
      source,
      target: methodName,
      fromSymbol: source,
      toSymbol: qualified,
      type: ASTEngine.RelationshipType.Calls,
      confidence: 0.9,
      metadata: {},
    })
  }

  // ========================================================================
  // HELPERS
  // ========================================================================

  /** Extract superclass from class node — pure char scan, no regex */
  private extractSuperclass(node: Node): string | undefined {
    const superNode = this.findChild(node, "superclass")
    if (!superNode) return undefined

    const text = superNode.text
    // Skip leading '<' and whitespace
    let start = 0
    while (start < text.length && (text[start] === "<" || text[start] === " " || text[start] === "\t")) {
      start++
    }
    return start < text.length ? text.substring(start) : undefined
  }

  /** Extract parameters from method node */
  private extractParameters(node: Node): ASTEngine.Parameter[] | undefined {
    const params = this.findChild(node, "method_parameters") ||
                   this.findChild(node, "parameters")
    if (!params) return undefined

    const result: ASTEngine.Parameter[] = []
    for (let i = 0; i < params.namedChildCount; i++) {
      const child = params.namedChild(i)
      if (!child) continue
      const childType = child.type
      if (childType === "identifier") {
        result.push({ name: child.text })
      } else if (childType === "optional_parameter") {
        const name = child.childForFieldName("name")
        if (name) result.push({ name: name.text })
      } else if (childType === "keyword_parameter" || childType === "keyword_rest") {
        const name = child.childForFieldName("name")
        if (name) result.push({ name: name.text })
      } else if (childType === "splat_parameter" || childType === "hash_splat_parameter") {
        const name = child.childForFieldName("name")
        if (name) result.push({ name: name.text })
      } else if (childType === "block_parameter" || childType === "block_var") {
        // &block — skip
      } else if (childType === "destructured_parameter") {
        // |a, b| — extract sub-identifiers
        for (let j = 0; j < child.namedChildCount; j++) {
          const sub = child.namedChild(j)
          if (sub && sub.type === "identifier") {
            result.push({ name: sub.text })
          }
        }
      }
    }
    return result.length > 0 ? result : undefined
  }

  /** Return true for a bare visibility directive that affects following methods. */
  private isNoArgumentVisibilityMarker(node: Node): boolean {
    if (node.type === "identifier") {
      return node.text === "private" || node.text === "protected" || node.text === "public"
    }
    if (node.type !== "call") return false
    const method = node.childForFieldName("method")
    if (!method || (method.text !== "private" && method.text !== "protected" && method.text !== "public")) return false
    const args = this.findChild(node, "argument_list")
    return !args || args.namedChildCount === 0
  }

  private findChild(node: Node, type: string): Node | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child && child.type === type) return child
    }
    return null
  }

  /** Strip leading ': ' from symbol text — pure char scan */
  private stripSymbolColon(text: string): string {
    let start = 0
    while (start < text.length && text[start] === ":") start++
    return start < text.length ? text.substring(start) : text
  }

  /** Strip surrounding quotes — pure char scan */
  private stripQuotes(text: string): string {
    if (text.length >= 2) {
      const first = text.charCodeAt(0)
      const last = text.charCodeAt(text.length - 1)
      if ((first === 34 && last === 34) || (first === 39 && last === 39)) {
        return text.substring(1, text.length - 1)
      }
    }
    return text
  }

  /** Extract the leaf name from a possibly-qualified name like A::B */
  private leafName(name: string): string {
    const idx = name.lastIndexOf("::")
    return idx >= 0 ? name.substring(idx + 2) : name
  }

  private isRailsModelName(superClass: string | undefined): boolean {
    if (!superClass) return false
    const leaf = this.leafName(superClass)
    return leaf === "Base" && superClass.includes("ActiveRecord") || leaf === "ApplicationRecord"
  }

  private isRailsControllerName(superClass: string | undefined): boolean {
    if (!superClass) return false
    const leaf = this.leafName(superClass)
    return leaf === "Base" && superClass.includes("ActionController") || leaf === "ApplicationController"
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
