// Pure-AST Groovy analyzer — M12 per-analyzer perfection contract.
//
// Emits exactly the M12 differential contract (mirroring the Java family):
//   Symbols: class, interface (trait/interface), enum, enum_member, method,
//            constructor, property. NO namespace/import/variable symbols and
//            NO synthetic members (getters/setters, `log`, closure `it`).
//   Relationships: contains, extends, implements, calls, instantiates,
//            overrides (qualified Owner.method -> Parent.method), uses
//            (field access), references (imports -> full module paths).
//
// Grammar notes (patched amaanq grammar, see grammars/tree-sitter-groovy/):
//   * formal params may be untyped  (def foo(a, b = 2))
//   * method/constructor bodies may be single-expression closures
//   * Spock test methods use string names  (def "addition works"())
//   * trait_declaration (extends/implements), enum bodies without `;`
//   * safe-nav ?. spread *. elvis ?: `[:]` empty map, `as` casts

import type { Node } from "web-tree-sitter"
import { ASTEngine } from "./engine"
import { findDeclaringParent } from "./override-context"

interface Scope {
  node: Node
  name: string
  kind: ASTEngine.SymbolKind
  fqn: string
  symbolRef?: ASTEngine.UniversalSymbol
  visibility: "public" | "private" | "protected" | undefined
  isInterface: boolean
  parents: string[]
}

interface OverrideTask {
  fqn: string
  methodName: string
  signature: string
  ownerFqn: string
}

interface StackItem {
  node: Node
  parentContext?: Scope
  isExit?: boolean
}

const GROOVY_BUILTINS = new Set([
  // Groovy language builtins
  "println", "print", "printf", "sprintf",
  "assert", "sleep", "synchronized",
  // JVM Object methods
  "toString", "hashCode", "equals", "getClass", "notify", "notifyAll",
  "wait", "clone", "finalize",
  // Common java.* entry points
  "System.out.println", "System.out.print", "System.out.printf",
  "System.err.println", "System.err.print",
  "System.exit", "System.gc", "System.currentTimeMillis", "System.nanoTime",
  "System.getProperty", "System.getenv", "System.identityHashCode",
  "System.arraycopy", "System.lineSeparator",
])

export class RealGroovyAnalyzer implements ASTEngine.LanguageAnalyzer {
  analyze(
    rootNode: Node,
    content: string,
    filePath: string,
    context?: ASTEngine.AnalyzeContext,
  ): Omit<ASTEngine.ParseResult, "language" | "metadata"> & { metadata: Partial<ASTEngine.FileMetadata> } {
    const symbols: ASTEngine.UniversalSymbol[] = []
    const relationships: ASTEngine.UniversalRelationship[] = []
    const imports: ASTEngine.ImportInfo[] = []
    const exports: ASTEngine.ExportInfo[] = []
    const errors: ASTEngine.ParseError[] = []

    let currentPackage = ""

    const symbolMap = new Map<string, ASTEngine.UniversalSymbol>()
    const classHierarchy = new Map<string, string[]>()
    const overrideTasks: OverrideTask[] = []

    const scopeStack: Scope[] = []
    const stack: StackItem[] = [{ node: rootNode }]

    while (stack.length > 0) {
      const item = stack.pop()!
      const { node, parentContext, isExit } = item

      if (isExit) {
        if (parentContext) {
          if (scopeStack.length > 0 && scopeStack[scopeStack.length - 1] === parentContext) {
            scopeStack.pop()
          }
        }
        continue
      }

      if (node.isMissing || node.hasError) {
        if (node.type === "ERROR" || node.type === "MISSING") {
          errors.push({
            message: `Syntax ${node.type} detected.`,
            range: this.nodeToRange(node),
            severity: "warning",
          })
        }
      }

      let newContext = parentContext
      const type = node.type
      let pushedScope = false

      if (type === "package_declaration") {
        const nameNode = this.findChild(node, (n) => n.type === "scoped_identifier" || n.type === "identifier")
        if (nameNode) currentPackage = nameNode.text
      } else if (type === "import_declaration") {
        const nameNode = this.findChild(node, (n) => n.type === "scoped_identifier" || n.type === "identifier")
        if (nameNode) {
          const moduleName = nameNode.text
          const isStatic = this.hasDirectChildText(node, "static")
          imports.push({
            module: moduleName,
            items: [],
            isDefault: false,
            range: this.nodeToRange(node),
            isNamespace: moduleName.endsWith(".*"),
            metadata: { isWildcard: moduleName.endsWith(".*"), isStatic },
          })
          // DependsOn for imports — source rewritten to the file's primary
          // type after the walk (imports precede type declarations).
          relationships.push({
            source: currentPackage || "root",
            target: moduleName,
            type: ASTEngine.RelationshipType.References,
            confidence: 0.9,
            metadata: { isGroovyImport: true, isWildcard: moduleName.endsWith(".*") },
          })
        }
      } else if (
        type === "class_declaration" ||
        type === "interface_declaration" ||
        type === "trait_declaration" ||
        type === "enum_declaration"
      ) {
        const nameNode = this.findChild(node, (n) => n.type === "identifier")
        if (nameNode) {
          const name = nameNode.text
          const kind = type === "interface_declaration" || type === "trait_declaration"
            ? ASTEngine.SymbolKind.Interface
            : type === "enum_declaration"
              ? ASTEngine.SymbolKind.Enum
              : ASTEngine.SymbolKind.Class
          const fqn = this.buildFqn(currentPackage, scopeStack, name)
          const visibility = this.extractVisibility(node)

          const parents = this.extractInheritance(node, type)
          classHierarchy.set(fqn, parents)

          // extends (superclass / interface-extends)
          if (type === "class_declaration") {
            const superClass = this.findChild(node, (n) => n.type === "superclass")
            if (superClass) {
              const sc = this.findChild(superClass, (n) => n.type === "type_identifier" || n.type === "identifier" || n.type === "generic_type" || n.type === "scoped_type_identifier")
              if (sc) {
                relationships.push({
                  source: name,
                  target: this.baseTypeName(sc),
                  type: ASTEngine.RelationshipType.Extends,
                  confidence: 1.0,
                  metadata: { relationshipType: "extends" },
                })
              }
            }
          } else if (type === "interface_declaration") {
            const ext = this.findChild(node, (n) => n.type === "extends_interfaces")
            if (ext) {
              for (const tid of this.collectTypeNodes(ext)) {
                relationships.push({
                  source: name,
                  target: this.baseTypeName(tid),
                  type: ASTEngine.RelationshipType.Extends,
                  confidence: 1.0,
                  metadata: { relationshipType: "extends_interface" },
                })
              }
            }
          } else if (type === "trait_declaration") {
            const superClass = this.findChild(node, (n) => n.type === "superclass")
            if (superClass) {
              const sc = this.findChild(superClass, (n) => n.type === "type_identifier" || n.type === "identifier" || n.type === "generic_type" || n.type === "scoped_type_identifier")
              if (sc) {
                relationships.push({
                  source: name,
                  target: this.baseTypeName(sc),
                  type: ASTEngine.RelationshipType.Extends,
                  confidence: 1.0,
                  metadata: { relationshipType: "extends_trait" },
                })
              }
            }
          }

          // implements (super_interfaces — classes and traits)
          const superInterfaces = this.findChild(node, (n) => n.type === "super_interfaces")
          if (superInterfaces) {
            for (const tid of this.collectTypeNodes(superInterfaces)) {
              relationships.push({
                source: name,
                target: this.baseTypeName(tid),
                type: ASTEngine.RelationshipType.Implements,
                confidence: 1.0,
                metadata: { relationshipType: "implements" },
              })
            }
          }

          const sym: ASTEngine.UniversalSymbol = {
            name,
            kind,
            range: this.nodeToRange(node),
            visibility,
            ownerName: scopeStack.length > 0 ? scopeStack[scopeStack.length - 1].name : undefined,
            ownerKind: scopeStack.length > 0 ? scopeStack[scopeStack.length - 1].kind : undefined,
            metadata: { nodeType: type },
          }
          symbols.push(sym)
          symbolMap.set(fqn, sym)
          symbolMap.set(name, sym)

          newContext = {
            node,
            name,
            kind,
            fqn,
            symbolRef: sym,
            visibility,
            isInterface: type === "interface_declaration" || type === "trait_declaration",
            parents,
          }
          scopeStack.push(newContext)
          pushedScope = true
        }
      } else if (type === "method_declaration" || type === "constructor_declaration" || type === "function_definition") {
        const isConstructor = type === "constructor_declaration"
        const nameNode = this.findChild(node, (n) => n.type === "identifier" || n.type === "string_literal")
        if (nameNode) {
          const rawName = nameNode.type === "string_literal"
            ? this.stripQuotes(nameNode.text)
            : nameNode.text
          const name = isConstructor ? "constructor" : rawName
          const modifiers = this.extractModifiers(node)
          const visibility = this.extractVisibility(node)
          const annotations = this.extractAnnotations(node)

          const parameters: ASTEngine.Parameter[] = []
          const paramList = this.findChild(node, (n) => n.type === "formal_parameters")
          if (paramList) {
            for (let i = 0; i < paramList.namedChildCount; i++) {
              const p = paramList.namedChild(i)
              if (!p || (p.type !== "formal_parameter" && p.type !== "spread_parameter")) continue
              const pName = this.findChild(p, (n) => n.type === "identifier")
              const pType = this.findChild(p, (n) => n.type === "type_identifier" || n.type === "integral_type" || n.type === "floating_point_type" || n.type === "boolean_type" || n.type === "void_type" || n.type === "generic_type" || n.type === "array_type")
              parameters.push({
                name: pName?.text ?? "anonymous",
                type: pType ? this.baseTypeName(pType) : undefined,
              })
            }
          }
          const signature = `(${parameters.map((p) => p.type ?? "").join(",")})`

          const ownerName = scopeStack.length > 0 ? scopeStack[scopeStack.length - 1].name : undefined
          const ownerKind = scopeStack.length > 0 ? scopeStack[scopeStack.length - 1].kind : undefined
          const fqn = this.buildFqn(currentPackage, scopeStack, name)

          // Abstract: no body in an interface/trait, or body-less declaration.
          const hasBody = !!this.findChild(node, (n) => n.type === "block" || n.type === "closure" || n.type === "constructor_body")
          const isAbstract = !hasBody || (!!(newContext?.isInterface) && !hasBody)

          if (annotations.indexOf("Override") !== -1 && newContext) {
            overrideTasks.push({
              fqn,
              methodName: name,
              signature,
              ownerFqn: newContext.fqn,
            })
          }

          const sym: ASTEngine.UniversalSymbol = {
            name,
            kind: isConstructor ? ASTEngine.SymbolKind.Constructor : ASTEngine.SymbolKind.Method,
            range: this.nodeToRange(node),
            visibility,
            parameters,
            ownerName,
            ownerKind,
            metadata: { nodeType: type, modifiers, annotations, isAbstract },
          }
          symbols.push(sym)
          symbolMap.set(fqn, sym)
          // Raw `Owner.method(signature)` key so the override BFS (which walks
          // raw parent names) can match in-file declarations.
          const rawKey = ownerName ? `${ownerName}.${name}${signature}` : `${name}${signature}`
          symbolMap.set(rawKey, sym)

          newContext = {
            node,
            name,
            kind: isConstructor ? ASTEngine.SymbolKind.Constructor : ASTEngine.SymbolKind.Method,
            fqn,
            symbolRef: sym,
            visibility,
            isInterface: false,
            parents: [],
          }
          scopeStack.push(newContext)
          pushedScope = true
        }
      } else if (type === "field_declaration" || type === "constant_declaration") {
        const modifiers = this.extractModifiers(node)
        const visibility = this.extractVisibility(node)
        const isStatic = modifiers.indexOf("static") !== -1
        const isConstant = modifiers.indexOf("final") !== -1 && isStatic
        const ownerName = scopeStack.length > 0 ? scopeStack[scopeStack.length - 1].name : undefined
        const ownerKind = scopeStack.length > 0 ? scopeStack[scopeStack.length - 1].kind : undefined

        for (let i = 0; i < node.namedChildCount; i++) {
          const child = node.namedChild(i)
          if (child?.type !== "variable_declarator") continue
          const idNode = this.findChild(child, (n) => n.type === "identifier")
          if (!idNode || !ownerName) continue
          symbols.push({
            name: idNode.text,
            kind: isConstant ? ASTEngine.SymbolKind.Constant : ASTEngine.SymbolKind.Property,
            range: this.nodeToRange(child),
            visibility,
            ownerName,
            ownerKind,
            metadata: { nodeType: type, modifiers, isConstant },
          })
        }
      } else if (type === "enum_constant") {
        const nameNode = this.findChild(node, (n) => n.type === "identifier")
        const ownerName = scopeStack.length > 0 ? scopeStack[scopeStack.length - 1].name : undefined
        if (nameNode && ownerName) {
          symbols.push({
            name: nameNode.text,
            kind: ASTEngine.SymbolKind.EnumMember,
            range: this.nodeToRange(node),
            visibility: "public",
            ownerName,
            ownerKind: ASTEngine.SymbolKind.Enum,
            metadata: { nodeType: type },
          })
        }
      } else if (type === "method_invocation") {
        const nameNode = node.childForFieldName("name")
        if (nameNode) {
          const methodName = nameNode.text
          const objectNode = node.childForFieldName("object")
          const callExpr = objectNode ? `${objectNode.text}.${methodName}` : methodName
          // Script-level invocations (Jenkins-pipeline style: no enclosing
          // class/method) are attributed to the "(script)" sentinel so the
          // call graph of script files is not silently empty. Design
          // decision recorded in wave M14.1.
          const sourceName = parentContext?.name ?? "(script)"
          if (!this.isGroovyBuiltin(callExpr)) {
            relationships.push({
              source: sourceName,
              target: methodName,
              type: ASTEngine.RelationshipType.Calls,
              confidence: 0.7,
              metadata: { groovyCallExpression: callExpr },
            })
          }
        }
      } else if (type === "juxt_function_call") {
        // Groovy juxtaposition call syntax: `echo "msg"` / `sh "cmd"` IS a
        // method call under Groovy semantics — Jenkins pipelines are built
        // on it. Grammar: juxt_function_call [name, args].
        const nameNode = node.childForFieldName("name")
        if (nameNode && !this.isGroovyBuiltin(nameNode.text)) {
          relationships.push({
            source: parentContext?.name ?? "(script)",
            target: nameNode.text,
            type: ASTEngine.RelationshipType.Calls,
            confidence: 0.7,
            metadata: { relationshipType: "juxt_call" },
          })
        }
      } else if (type === "object_creation_expression") {
        // new Foo(...) → Instantiates. Type is a type_identifier for plain
        // types, a generic_type for generic constructions, and a
        // scoped_type_identifier for qualified/inner-class constructions
        // (new java.util.ArrayList(), new Outer.Builder()) — dropping any of
        // these silently loses real dependency edges.
        const typeNode = this.findChild(node, (n) => n.type === "type_identifier" || n.type === "generic_type" || n.type === "scoped_type_identifier" || n.type === "identifier")
        if (typeNode) {
          const source = parentContext?.name || parentContext?.symbolRef?.name || "global"
          relationships.push({
            source,
            target: this.baseTypeName(typeNode),
            type: ASTEngine.RelationshipType.Instantiates,
            confidence: 0.95,
            metadata: { relationshipType: "instantiates", isNew: true },
          })
        }
      }
      // Closures, local variables, gstrings, command expressions: intentionally
      // produce NO symbols and NO relationships (pure AST contract).

      if (pushedScope) {
        stack.push({ node, parentContext: newContext, isExit: true })
      }
      for (let i = node.namedChildCount - 1; i >= 0; i--) {
        const child = node.namedChild(i)
        if (child) {
          stack.push({ node: child, parentContext: newContext })
        }
      }
    }

    this.resolveOverrides(overrideTasks, classHierarchy, symbolMap, relationships, context?.overrideCompanion)

    // Rewrite import-reference sources from the package name to the file's
    // primary type (first top-level type declared).
    const primaryType = symbols.find((s) => {
      if (s.ownerName || s.scope) return false
      return s.kind === ASTEngine.SymbolKind.Class ||
             s.kind === ASTEngine.SymbolKind.Interface ||
             s.kind === ASTEngine.SymbolKind.Enum
    })
    if (primaryType) {
      for (const rel of relationships) {
        if (rel.type === ASTEngine.RelationshipType.References && (rel.source === currentPackage || rel.source === "root")) {
          rel.source = primaryType.name
        }
      }
    }

    // Contains relationships: owner → owned symbols
    for (const s of symbols) {
      const _owner = s.ownerName || s.scope
      if (_owner) {
        relationships.push({
          source: _owner,
          target: s.name,
          type: ASTEngine.RelationshipType.Contains,
          confidence: 1.0,
          metadata: { isContained: true },
        })
      }
    }

    // Uses relationships for field accesses (this.x, obj.x — incl. ?. and *.)
    this.collectFieldAccessUses(rootNode, relationships, symbols)

    for (let i = 0; i < symbols.length; i++) {
      const s = symbols[i]
      if (s.visibility === "public" && (!s.ownerName || s.ownerKind === ASTEngine.SymbolKind.Class)) {
        exports.push({ name: s.name, kind: s.kind, range: s.range, visibility: s.visibility })
      }
    }
    return {
      symbols,
      relationships,
      imports,
      exports,
      errors,
      metadata: {
        complexity: symbols.length + relationships.length,
        linesOfCode: content.split("\n").length,
        currentPackage,
        analysisVersion: "5.0.0-groovy-pure-ast",
      },
    }
  }

  private resolveOverrides(
    tasks: OverrideTask[],
    classHierarchy: Map<string, string[]>,
    symbolMap: Map<string, ASTEngine.UniversalSymbol>,
    relationships: ASTEngine.UniversalRelationship[],
    companion?: Map<string, Set<string>>,
  ) {
    for (let ti = 0; ti < tasks.length; ti++) { const task = tasks[ti]
      let targetFqn: string | null = null

      // Pass 1: exact-signature BFS over the in-file hierarchy.
      const queue: string[] = []
      const ownerH = classHierarchy.get(task.ownerFqn)
      if (ownerH) {
        for (let i = 0; i < ownerH.length; i++) queue.push(ownerH[i])
      }
      const seen: Set<string> = new Set()
      while (queue.length > 0) {
        const parent = queue.shift()!
        if (seen.has(parent)) continue
        seen.add(parent)
        const potential = `${parent}.${task.methodName}${task.signature}`
        if (symbolMap.has(potential)) {
          targetFqn = potential
          break
        }
        const pH = classHierarchy.get(parent)
        if (pH) {
          for (let i = 0; i < pH.length; i++) queue.push(pH[i])
        }
      }

      // Pass 2: declaring-parent via the project companion index (cross-file).
      if (!targetFqn && companion && ownerH && ownerH.length > 0) {
        const declaring = findDeclaringParent(
          task.methodName,
          ownerH,
          companion,
          (t) => classHierarchy.get(t) ?? [],
        )
        if (declaring) targetFqn = `${declaring}.${task.methodName}${task.signature}`
      }

      // Pass 3: deterministic per-file fallback — first hierarchy parent.
      if (!targetFqn && ownerH && ownerH.length > 0) {
        targetFqn = `${ownerH[0]}.${task.methodName}${task.signature}`
      }

      if (targetFqn) {
        const localSource = task.fqn.split("(")[0].split(".").slice(-2).join(".")
        const localTarget = targetFqn.split("(")[0].split(".").slice(-2).join(".")
        relationships.push({
          source: localSource,
          target: localTarget,
          type: ASTEngine.RelationshipType.Overrides,
          confidence: 1.0,
          metadata: { relationshipType: "method_override", isGroovyOverride: true },
        })
      }
    }
  }

  private collectFieldAccessUses(
    rootNode: Node,
    relationships: ASTEngine.UniversalRelationship[],
    symbols: ASTEngine.UniversalSymbol[],
  ) {
    const stack: { node: Node; owner: string | null }[] = [{ node: rootNode, owner: null }]
    const seen = new Set<string>()
    while (stack.length > 0) {
      const item = stack.pop()!
      const { node, owner } = item

      if (
        node.type === "class_declaration" ||
        node.type === "interface_declaration" ||
        node.type === "trait_declaration" ||
        node.type === "enum_declaration"
      ) {
        const nameNode = this.findChild(node, (n) => n.type === "identifier")
        const nextOwner = nameNode ? nameNode.text : owner
        for (let i = node.namedChildCount - 1; i >= 0; i--) {
          const child = node.namedChild(i)
          if (child) stack.push({ node: child, owner: nextOwner })
        }
        continue
      }

      if (node.type === "field_access") {
        // Handle ?. and *. operators: p?.x / list*.name
        const parts = node.text.split(".").map((p) => (p.endsWith("?") || p.endsWith("*")) ? p.slice(0, -1) : p)
        if (parts.length >= 2) {
          const first = parts[0]
          const source = first === "this" || first === "super" ? (owner ?? first) : first
          const key = `${source}.${parts[parts.length - 1]}`
          if (!seen.has(key)) {
            seen.add(key)
            relationships.push({
              source,
              target: parts[parts.length - 1],
              type: ASTEngine.RelationshipType.Uses,
              confidence: 0.6,
              metadata: { isFieldAccess: true },
            })
          }
        }
      }
      for (let i = node.namedChildCount - 1; i >= 0; i--) {
        const child = node.namedChild(i)
        if (child) stack.push({ node: child, owner })
      }
    }
  }

  private isGroovyBuiltin(call: string): boolean {
    if (GROOVY_BUILTINS.has(call)) return true
    // Prefix-based stdlib filtering: first segment identifies the class/package.
    const firstDot = call.indexOf(".")
    const root = firstDot > 0 ? call.slice(0, firstDot) : call
    const STDLIB_ROOTS = new Set([
      "System", "String", "Integer", "Long", "Double", "Float", "Boolean",
      "Byte", "Short", "Character", "Math", "StrictMath", "Object", "Class",
      "Thread", "Runnable", "Runtime", "Process", "ProcessBuilder",
      "Throwable", "Error", "Exception", "StackTraceElement",
      "Enum", "Void", "Compiler", "Package",
      "ArrayList", "LinkedList", "HashMap", "HashSet", "TreeMap", "TreeSet",
      "LinkedHashMap", "LinkedHashSet", "ArrayDeque", "PriorityQueue",
      "Collections", "Arrays", "Objects", "Optional", "Comparator",
      "List", "Map", "Set", "Collection", "Iterator", "Iterable",
      "Calendar", "Date", "UUID", "Locale", "Currency",
      "File", "Path", "Paths", "Files",
      "BigDecimal", "BigInteger", "AtomicInteger", "AtomicLong",
      "StringBuilder", "StringBuffer", "Pattern", "Matcher", "Random",
      "Logger", "Level", "OutputStream", "InputStream", "Reader", "Writer",
      "URL", "URI", "Socket", "ServerSocket",
    ])
    if (STDLIB_ROOTS.has(root)) return true
    return false
  }

  private extractInheritance(node: Node, type: string): string[] {
    const parents: string[] = []
    if (type === "class_declaration" || type === "trait_declaration") {
      const superClass = this.findChild(node, (n) => n.type === "superclass")
      if (superClass) {
        const sc = this.findChild(superClass, (n) => n.type === "type_identifier" || n.type === "identifier" || n.type === "generic_type" || n.type === "scoped_type_identifier")
        if (sc) parents.push(this.baseTypeName(sc))
      }
    } else if (type === "interface_declaration") {
      const ext = this.findChild(node, (n) => n.type === "extends_interfaces")
      if (ext) {
        for (const tid of this.collectTypeNodes(ext)) {
          parents.push(this.baseTypeName(tid))
        }
      }
    }
    const superInterfaces = this.findChild(node, (n) => n.type === "super_interfaces")
    if (superInterfaces) {
      for (const tid of this.collectTypeNodes(superInterfaces)) {
        parents.push(this.baseTypeName(tid))
      }
    }
    return parents
  }

  /** Collect type nodes within a type_list/super_interfaces/etc (DFS).
   * scoped_type_identifier is accepted AS a complete type and NOT descended
   * into — its nested type_identifiers are package/class segments, never
   * independent types (collecting them fabricated garbage edges). */
  private collectTypeNodes(node: Node): Node[] {
    const out: Node[] = []
    const stack: Node[] = [node]
    while (stack.length > 0) {
      const n = stack.pop()!
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (!c) continue
        if (c.type === "type_identifier" || c.type === "generic_type" || c.type === "scoped_type_identifier") {
          out.push(c)
        } else {
          stack.push(c)
        }
      }
    }
    return out
  }

  private stripQuotes(text: string): string {
    if (text.length >= 2) {
      const first = text[0]
      const last = text[text.length - 1]
      if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
        return text.slice(1, -1)
      }
    }
    return text
  }

  private baseTypeName(node: Node): string {
    if (node.type === "generic_type") {
      const id = this.findChild(node, (n) => n.type === "type_identifier" || n.type === "identifier")
      return id ? id.text : node.text
    }
    // scoped_type_identifier (dotted/qualified types): the FULL dotted text is
    // the type name — matching the Java analyzer convention. Never split into
    // segments; package segments are not types. Convention decided in M14.1.
    return node.text
  }

  private extractModifiers(node: Node): string[] {
    const mods: string[] = []
    const modifiers = this.findChild(node, (n) => n.type === "modifiers")
    if (modifiers) {
      for (let i = 0; i < modifiers.namedChildCount; i++) {
        const c = modifiers.namedChild(i)
        if (c && (c.type === "identifier" || c.isNamed)) mods.push(c.text)
      }
    }
    return mods
  }

  private extractVisibility(node: Node): "public" | "private" | "protected" | undefined {
    const mods = this.extractModifiers(node)
    if (mods.indexOf("private") !== -1) return "private"
    if (mods.indexOf("protected") !== -1) return "protected"
    return "public"
  }

  private extractAnnotations(node: Node): string[] {
    const anns: string[] = []
    const modifiers = this.findChild(node, (n) => n.type === "modifiers")
    if (modifiers) {
      for (let i = 0; i < modifiers.namedChildCount; i++) {
        const c = modifiers.namedChild(i)
        if (c && (c.type === "annotation" || c.type === "marker_annotation")) {
          const id = this.findChild(c, (n) => n.type === "identifier")
          if (id) anns.push(id.text)
        }
      }
    }
    return anns
  }

  private buildFqn(currentPackage: string, scopeStack: Scope[], name: string): string {
    if (scopeStack.length > 0) {
      return `${scopeStack[scopeStack.length - 1].fqn}.${name}`
    }
    return currentPackage ? `${currentPackage}.${name}` : name
  }

  private hasDirectChildText(node: Node, text: string): boolean {
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (c && c.text === text) return true
    }
    return false
  }

  private findChild(node: Node, predicate: (n: Node) => boolean): Node | null {
    const count = node.namedChildCount
    for (let i = 0; i < count; i++) {
      const child = node.namedChild(i)
      if (child && predicate(child)) return child
    }
    return null
  }

  private findAllChildren(node: Node, predicate: (n: Node) => boolean): Node[] {
    const out: Node[] = []
    const count = node.namedChildCount
    for (let i = 0; i < count; i++) {
      const child = node.namedChild(i)
      if (child && predicate(child)) out.push(child)
    }
    return out
  }

  private nodeToRange(node: Node) {
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
