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
            metadata: { isWildcard: node.text.indexOf(".*") !== -1, isStatic },
          })
          // DependsOn for imports — source rewritten to the file's primary
          // type after the walk (imports precede type declarations). GAD2:
          // script files with no class keep the "(script)" sentinel (the old
          // "root" was a third phantom node).
          relationships.push({
            source: currentPackage || "(script)",
            target: moduleName,
            type: ASTEngine.RelationshipType.References,
            confidence: 0.9,
            metadata: { isGroovyImport: true, isWildcard: node.text.indexOf(".*") !== -1 },
          })
        }
      } else if (
        type === "class_declaration" ||
        type === "interface_declaration" ||
        type === "trait_declaration" ||
        type === "enum_declaration" ||
        type === "record_declaration" ||
        type === "annotation_type_declaration"
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
          // Class/trait/enum annotations: previously only methods carried
          // them, so Spring/Grails service classes had no annotation data.
          const classAnnotations = this.extractAnnotations(node)

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
            comments: (() => { const d = this.extractGroovyDoc(node); return d ? [d] : [] })(),
            genericParameters: (() => { const tp = this.extractGroovyTypeParameters(node); return tp.length > 0 ? tp : undefined })(),
            range: this.nodeToRange(node),
            visibility,
            decorators: classAnnotations,
            ownerName: scopeStack.length > 0 ? scopeStack[scopeStack.length - 1].name : undefined,
            ownerKind: scopeStack.length > 0 ? scopeStack[scopeStack.length - 1].kind : undefined,
            metadata: { nodeType: type, annotations: classAnnotations, isRecord: type === "record_declaration" },
          }
          symbols.push(sym)
          symbolMap.set(fqn, sym)
          symbolMap.set(name, sym)

          if (type === "record_declaration") {
            // Record components are constructor-backed properties (Groovy 4
            // records, mirroring the java analyzer): each formal_parameter of
            // the record header becomes a public Property symbol.
            const fp = this.findChild(node, (n) => n.type === "formal_parameters")
            if (fp) {
              for (let i = 0; i < fp.namedChildCount; i++) {
                const p = fp.namedChild(i)
                if (!p || p.type !== "formal_parameter") continue
                const pName = this.findChild(p, (n) => n.type === "identifier")
                const pType = this.findChild(p, (n) => n.type === "type_identifier" || n.type === "integral_type" || n.type === "floating_point_type" || n.type === "boolean_type" || n.type === "generic_type" || n.type === "array_type" || n.type === "scoped_type_identifier")
                if (pName) {
                  symbols.push({
                    name: pName.text,
                    kind: ASTEngine.SymbolKind.Property,
                    range: this.nodeToRange(p),
                    returnType: pType ? this.baseTypeName(pType) : undefined,
                    visibility: "public",
                    ownerName: name,
                    ownerKind: kind,
                    metadata: { nodeType: "record_component" },
                  })
                }
              }
            }
          }

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
              const isSpread = p.type === "spread_parameter"
              // Varargs: the grammar has no named fields; the name lives in
              // the trailing variable_declarator (JVM erasure: type + "[]").
              let pName = this.findChild(p, (n) => n.type === "identifier")
              if (isSpread) {
                const decl = this.findChild(p, (n) => n.type === "variable_declarator")
                pName = decl ? this.findChild(decl, (n) => n.type === "identifier") : null
              }
              const pType = this.findChild(p, (n) => n.type === "type_identifier" || n.type === "integral_type" || n.type === "floating_point_type" || n.type === "boolean_type" || n.type === "void_type" || n.type === "generic_type" || n.type === "array_type")
              parameters.push({
                name: pName?.text ?? "anonymous",
                type: pType ? this.baseTypeName(pType) + (isSpread ? "[]" : "") : undefined,
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
            comments: (() => { const d = this.extractGroovyDoc(node); return d ? [d] : [] })(),
            complexity: this.calculateGroovyMethodComplexity(node),
            range: this.nodeToRange(node),
            visibility,
            genericParameters: (() => { const tp = this.extractGroovyTypeParameters(node); return tp.length > 0 ? tp : undefined })(),
            parameters,
            decorators: annotations,
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
        // Field annotations (@Column on fields = THE GORM/JPA idiom) were
        // never extracted — classes and methods carried decorators, fields
        // did not.
        const fieldAnnotations = this.extractAnnotations(node)
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
            decorators: fieldAnnotations,
            metadata: { nodeType: type, modifiers, isConstant, annotations: fieldAnnotations },
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
          // Dotted path WITHOUT argument text (family contract with java).
          // Raw object text embedded inner-call arguments on chains:
          // `db.list(user).collect` was stored as "db.list(user).collect".
          const callExpr = this.buildGroovyQualifiedCall(objectNode, methodName)
          // Script-level invocations (Jenkins-pipeline style: no enclosing
          // class/method) are attributed to the "(script)" sentinel so the
          // call graph of script files is not silently empty. Design
          // decision recorded in wave M14.1.
          const sourceName = parentContext?.name ?? "(script)"
          if (!this.isGroovyBuiltin(callExpr)) {
            // Matrix 1b payload: symbol-level qualified call list (#383) —
            // attached to the enclosing method symbol when one exists.
            if (parentContext?.symbolRef) {
              if (!parentContext.symbolRef.qualified_calls) parentContext.symbolRef.qualified_calls = []
              parentContext.symbolRef.qualified_calls.push(callExpr)
            }
            relationships.push({
              source: sourceName,
              target: methodName,
              type: ASTEngine.RelationshipType.Calls,
              confidence: 0.7,
              metadata: { groovyCallExpression: callExpr },
            })
          }
        }
      } else if (type === "explicit_constructor_invocation") {
        // super(...) / this(...) delegation (JLS-adjacent, Groovy ctor
        // bodies produce this node). Honest literal target ("super"/"this")
        // — never resolved to a guessed parent type.
        const first = node.namedChild(0)
        if (first && (first.type === "super" || first.type === "this")) {
          relationships.push({
            source: parentContext?.name ?? "(script)",
            target: first.type,
            type: ASTEngine.RelationshipType.Calls,
            confidence: 1.0,
            metadata: { relationshipType: "constructor_invocation" },
          })
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
          // GAD2 (M37 #599): script-level files used THREE different
          // sentinels — calls "(script)", instantiates "global", import refs
          // "root". One graph node per file is the contract (M14.1's
          // "(script)" design decision); unified here and in resolveSource
          // below. Class-level files are unaffected (parentContext set).
          const source = parentContext?.name || parentContext?.symbolRef?.name || "(script)"
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
        // GAD2: the emit-side sentinel is "(script)" now; "root" kept so
        // pre-existing callers of this rewrite path stay covered.
        if (rel.type === ASTEngine.RelationshipType.References && (rel.source === currentPackage || rel.source === "(script)" || rel.source === "root")) {
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

    // Declared-type reference graph (M14): fields, params, locals, throws,
    // instanceof targets, as-casts, return types. Absent until M14 because
    // the corpus oracle never checked it. `def` is a type_identifier token
    // in this grammar but is not a type — excluded by name.
    this.collectDeclaredTypeRefs(rootNode, relationships)

    const fw = this.detectGroovyFrameworks(content, symbols, imports)

    for (let i = 0; i < symbols.length; i++) {
      const s = symbols[i]
      if (s.visibility === "public" && (!s.ownerName || s.ownerKind === ASTEngine.SymbolKind.Class)) {
        exports.push({ name: s.name, kind: s.kind, range: s.range, visibility: s.visibility })
      }
    }
    this.classifyEvidenceTier(relationships)

    return {
      symbols,
      relationships,
      imports,
      exports,
      errors,
      metadata: {
        // Real cyclomatic complexity — was the synthetic heuristic
        // symbols.length + relationships.length, which is not a complexity
        // metric at all (same defect class previously fixed on scala).
        complexity: this.calculateGroovyMethodComplexity(rootNode),
        cyclomaticComplexity: this.calculateGroovyMethodComplexity(rootNode),
        linesOfCode: content.split("\n").length,
        currentPackage,
        framework: fw.framework,
        detectedFrameworks: fw.detected,
        analysisVersion: "5.0.0-groovy-pure-ast",
      },
    }
  }

  /**
   * Framework detection from imports + annotation short names. The mapping is
   * MEASURED against the grails-core corpus (top imported packages):
   * the "grails" / "org.grails" / "org.apache.grails", "spock.lang" and
   * "org.springframework" import families dominate real Groovy code.
   * result.framework flows to
   * brain_file.framework_type which patterns/rules.ts ranks on — Groovy
   * files previously got NULL there, hiding Grails projects from pattern
   * analysis. Primary selection follows a fixed priority so the same file
   * always yields the same primary.
   */
  /**
   * M14 #299 - evidence-tier classification for EVERY emitted relationship.
   * Tiers: structural (grammar clauses, conf 1.0) | usage_contextual (calls,
   * field access, companion-apply idioms) | import_based | reference_qualified
   * | inferred (sub-1.0 resolutions). Applied centrally at end of analyze()
   * so no emission site can forget it.
   */
  protected classifyEvidenceTier(relationships: ASTEngine.UniversalRelationship[]): void {
    for (const r of relationships) {
      const md = r.metadata ?? (r.metadata = {})
      if (md.evidenceClass) continue
      const t = String(r.type ?? r.relationshipType ?? "")
      const conf = typeof r.confidence === "number" ? r.confidence : 1
      if (t === "contains" || t === "exports") { md.evidenceClass = "structural"; continue }
      if (t === "references") {
        md.evidenceClass = (md.isGroovyImport || md.isImport) ? "import_based" : "reference_qualified"
        continue
      }
      if (t === "extends" || t === "implements") {
        md.evidenceClass = conf >= 1 ? "structural" : "inferred"
        continue
      }
      if (t === "overrides") {
        md.evidenceClass = conf >= 1 ? "structural" : conf >= 0.85 ? "usage_contextual" : "inferred"
        continue
      }
      if (t === "instantiates") {
        md.evidenceClass = md.isNew || conf >= 0.9 ? "structural" : "usage_contextual"
        continue
      }
      md.evidenceClass = "usage_contextual"
    }
  }


  private detectGroovyFrameworks(
    content: string,
    symbols: ASTEngine.UniversalSymbol[],
    imports: ASTEngine.ImportInfo[],
  ): { framework: string | undefined; detected: string[] } {
    const frameworks = new Set<string>()
    for (let i = 0; i < imports.length; i++) {
      const mod = imports[i].module || ""
      if (mod.startsWith("grails.") || mod.startsWith("org.grails.") || mod.startsWith("org.apache.grails.")) frameworks.add("grails")
      else if (mod.startsWith("org.springframework.")) frameworks.add("spring")
      else if (mod.startsWith("spock.lang.")) frameworks.add("spock")
      else if (mod.startsWith("javax.persistence.") || mod.startsWith("jakarta.persistence.")) frameworks.add("jpa")
      else if (mod.startsWith("org.hibernate.")) frameworks.add("hibernate")
      else if (mod.startsWith("org.junit.") || mod.startsWith("org.spockframework.")) frameworks.add("junit")
    }
    // Annotation-driven detection (short names): FQ annotations without
    // imports are common in generated/conflict-heavy code. Deliberately
    // limited to the UNAMBIGUOUS spring family: bare "@Entity" would
    // mislabel GORM entities (grails.gorm.annotation.Entity dominates
    // real Groovy code) as JPA - entity detection stays import-based.
    for (let i = 0; i < symbols.length; i++) {
      const anns: string[] = symbols[i].metadata?.annotations ?? []
      for (let j = 0; j < anns.length; j++) {
        const a = anns[j]
        if (a === "Service" || a === "RestController" || a === "Controller" || a === "Repository" || a === "Component") frameworks.add("spring")
      }
    }
    for (const priority of ["grails", "spring", "hibernate", "jpa", "spock", "junit"]) {
      if (frameworks.has(priority)) return { framework: priority, detected: [...frameworks] }
    }
    return { framework: undefined, detected: [...frameworks] }
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
      // Confidence reflects EVIDENCE TIER (patterns.ts filters >= 0.7):
      // pass 1 exact in-file match, pass 2 project companion evidence,
      // pass 3 first-parent guess — guesses at 1.0 contaminated thresholded
      // analysis identically to verified overrides.
      let confidence = 1.0
      let reasonCode = "exact-in-file"

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
        if (declaring) {
          targetFqn = `${declaring}.${task.methodName}${task.signature}`
          confidence = 0.85
          reasonCode = "companion-index"
        }
      }

      // Pass 3: deterministic per-file fallback — first hierarchy parent.
      if (!targetFqn && ownerH && ownerH.length > 0) {
        targetFqn = `${ownerH[0]}.${task.methodName}${task.signature}`
        // Below the patterns.ts default threshold (0.7): visible in raw
        // output, never contaminating thresholded analysis.
        confidence = 0.5
        reasonCode = "first-parent-guess"
      }

      if (targetFqn) {
        const localSource = task.fqn.split("(")[0].split(".").slice(-2).join(".")
        const localTarget = targetFqn.split("(")[0].split(".").slice(-2).join(".")
        relationships.push({
          source: localSource,
          target: localTarget,
          type: ASTEngine.RelationshipType.Overrides,
          confidence,
          metadata: { relationshipType: "method_override", isGroovyOverride: true, reasonCode },
        })
      }
    }
  }

  /**
   * Declared-type reference graph (M14). References edges from the enclosing
   * method/class to every named type in a declaration position. Collection
   * descends but stops at value boundaries (variable_declarator values,
   * closures, blocks) so initializer contents are never mistaken for the
   * declared type clause.
   */
  private collectDeclaredTypeRefs(rootNode: Node, relationships: ASTEngine.UniversalRelationship[]): void {
    const emitted = new Set<string>()
    const TYPE_STOP = new Set(["variable_declarator", "closure", "block", "closure_expression"])

    const collectTypeNames = (n: Node, out: string[]): void => {
      if (n.type === "type_identifier") {
        // `def` is the dynamic-type keyword; `as` is how the grammar lexes
        // the keyword inside its mis-parsed dangling as-expression
        // (`= [] as Set` becomes local_variable_declaration(as, Set)).
        // Both are type_identifier TOKENS but never types.
        if (n.text !== "def" && n.text !== "as" && !out.includes(n.text)) out.push(n.text)
        return
      }
      if (n.type === "record_pattern") {
        // The pattern's type is its FIRST named child (identifier):
        // `Point(int x, int y)` under instanceof or a switch case label.
        const t = n.namedChild(0)
        if (t && t.type === "identifier" && t.text !== "this" && !out.includes(t.text)) out.push(t.text)
        return
      }
      if (n.type === "type_arguments") {
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c) collectTypeNames(c, out)
        }
        return
      }
      if (TYPE_STOP.has(n.type)) return
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) collectTypeNames(c, out)
      }
    }

    const resolveSource = (start: Node): string => {
      // KAD6 sweep (M37 #597): include the start node when it IS the
      // declaration. The method_declaration case emits its own return type
      // through this resolver, which seeded at `.parent` — so `String
      // greet()` inside `class Foo` attributed String to Foo (or Global at
      // top level) instead of greet. Same bug kotlin's KAD6.
      let p: Node | null =
        /^(method_declaration|constructor_declaration|function_definition|class_declaration|trait_declaration|enum_declaration)$/.test(start.type)
          ? start
          : start.parent
      while (p) {
        if (p.type === "method_declaration" || p.type === "constructor_declaration" || p.type === "function_definition") {
          const name = this.findChild(p, (c) => c.type === "identifier")
          if (name) return name.text
        }
        if (p.type === "class_declaration" || p.type === "trait_declaration" || p.type === "enum_declaration") {
          const name = this.findChild(p, (c) => c.type === "identifier")
          if (name) return name.text
        }
        p = p.parent
      }
      // GAD2: "(script)" — the same sentinel the calls walk uses; the old
      // "global" split one script file's graph across two phantom nodes.
      return "(script)"
    }

    const emit = (decl: Node, roots: Node[], kind: string, relType = "declared_type"): void => {
      const source = resolveSource(decl)
      for (const r of roots) {
        const names: string[] = []
        collectTypeNames(r, names)
        for (const t of names) {
          const key = `${source}|${t}|${kind}`
          if (emitted.has(key)) continue
          emitted.add(key)
          relationships.push({
            source,
            target: t,
            type: ASTEngine.RelationshipType.References,
            confidence: 0.95,
            metadata: { relationshipType: relType, declaredOn: decl.type },
          })
        }
      }
    }

    const walk = (n: Node): void => {
      switch (n.type) {
        case "field_declaration":
        case "formal_parameter":
        case "local_variable_declaration": {
          // Type clause = direct children that are types (generic_type /
          // type_identifier / scoped), before any declarator begins.
          const roots: Node[] = []
          for (let i = 0; i < n.namedChildCount; i++) {
            const c = n.namedChild(i)
            if (!c || TYPE_STOP.has(c.type)) continue
            if (/type$/.test(c.type) || c.type.endsWith("_type") || c.type === "type_identifier") roots.push(c)
          }
          if (roots.length) emit(n, roots, n.type)
          break
        }
        case "throws": {
          const kids: Node[] = []
          for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) kids.push(c) }
          emit(n, kids, "throws", "throws_type")
          break
        }
        case "instanceof_expression": {
          // The pattern type is any type-position child: a type_identifier
          // (`o instanceof String s`), a scoped/generic type, or a
          // record_pattern (`o instanceof Point(int x, int y)`). Emit from
          // every child — plain identifiers carry no type names.
          for (let i = 0; i < n.namedChildCount; i++) {
            const c = n.namedChild(i)
            if (c) emit(n, [c], n.type, "instanceof_expression")
          }
          break
        }
        case "cast_expression": {
          // (String) o — the cast type is the first named child.
          const first = n.namedChild(0)
          if (first) emit(n, [first], n.type, "cast_type")
          break
        }
        case "switch_label": {
          // case Point(int x, int y) -> / : — patterns under switch labels.
          for (let i = 0; i < n.namedChildCount; i++) {
            const c = n.namedChild(i)
            if (c && c.type === "pattern") emit(n, [c], "switch_pattern", "case_pattern")
          }
          break
        }
        case "method_reference": {
          // Foo::bar — the receiver type is the first named child. `this` is
          // not a type reference.
          const first = n.namedChild(0)
          if (first && first.type === "identifier" && first.text !== "this") {
            const source = resolveSource(n)
            const key = `${source}|${first.text}|method_reference`
            if (!emitted.has(key)) {
              emitted.add(key)
              relationships.push({
                source,
                target: first.text,
                type: ASTEngine.RelationshipType.References,
                confidence: 0.9,
                metadata: { relationshipType: "method_reference" },
              })
            }
          }
          break
        }
        case "juxt_function_call": {
          // `x as Type` parses as juxt_function_call(as, argument_list).
          const first = n.namedChild(0)
          if (first && first.text === "as") {
            for (let i = 0; i < n.namedChildCount; i++) {
              const c = n.namedChild(i)
              if (c && c.type === "argument_list") emit(n, [c], "as_expression")
            }
          }
          break
        }
        case "method_declaration": {
          // Return type: leading type children before the name identifier;
          // `def` return type is correctly skipped by collectTypeNames.
          // GAD5 (M37 #599): `modifiers` (public/static/annotations) precedes
          // the type — the old `else break` stopped there, so `public String
          // greet()` / `static void main` lost their return-type ref (probe-
          // verified). Non-type, non-modifier children still terminate.
          const roots: Node[] = []
          for (let i = 0; i < n.namedChildCount; i++) {
            const c = n.namedChild(i)
            if (!c) continue
            if (c.type === "identifier") break
            if (c.type === "modifiers") continue
            if (c.type.endsWith("_type") || c.type === "type_identifier") roots.push(c)
            else break
          }
          if (roots.length) emit(n, roots, "return_type", "return_type")
          break
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) walk(c)
      }
    }
    walk(rootNode)
  }

  private collectFieldAccessUses(
    rootNode: Node,
    relationships: ASTEngine.UniversalRelationship[],
    symbols: ASTEngine.UniversalSymbol[],
  ) {
    // GAD1 (M37 #599, JAD2 contract): reads must attribute to the enclosing
    // METHOD like the calls walk does — the pre-fix walk had three owners in
    // one body (field read -> receiver variable, array read -> class, call
    // -> method). this/super keep the TYPE owner (self-read precedent);
    // any other receiver resolves method-first.
    const stack: { node: Node; owner: string | null; method: string | null }[] = [
      { node: rootNode, owner: null, method: null },
    ]
    const seen = new Set<string>()
    while (stack.length > 0) {
      const item = stack.pop()!
      const { node, owner, method } = item

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
          if (child) stack.push({ node: child, owner: nextOwner, method })
        }
        continue
      }
      // GAD1: method/constructor bodies rebind the read-owner (constructor
      // bodies attribute to the "constructor" symbol, java family parity).
      let nextMethod = method
      if (
        node.type === "method_declaration" ||
        node.type === "constructor_declaration" ||
        node.type === "function_definition"
      ) {
        const nameNode = this.findChild(node, (n) => n.type === "identifier")
        nextMethod = node.type === "constructor_declaration" ? "constructor" : nameNode?.text ?? method
      }

      if (node.type === "field_access") {
        // Handle ?. and *. operators: p?.x / list*.name
        const parts = node.text.split(".").map((p) => (p.endsWith("?") || p.endsWith("*")) ? p.slice(0, -1) : p)
        if (parts.length >= 2) {
          const first = parts[0]
          // GAD1 (JAD2): non-this receivers attribute to the enclosing
          // method; this/super keep the type owner.
          const readOwner = method ?? owner
          const source = first === "this" || first === "super" ? (owner ?? first) : readOwner ?? first
          // KAD1 sweep (M37 #597): assignment-LHS span is a WRITE — the
          // exact-LHS gate (java JAD1/TS TSD1/JSD1 contract); chained-write
          // inner segments stay reads.
          const pType = node.parent?.type
          let isWrite = false
          if (pType === "assignment_expression") {
            const lhs = node.parent!.namedChild(0)
            isWrite = !!lhs && lhs.startIndex === node.startIndex && lhs.endIndex === node.endIndex
          }
          const key = `${source}.${parts[parts.length - 1]}`
          if (!isWrite && !seen.has(key)) {
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

      if (node.type === "array_access") {
        // KAD1 sweep (M37 #597): READS are uses of the array expression
        // (G1); the assignment-LHS span (`xs[0] = 5`, `xs[1] += 2` — both
        // parse as assignment_expression with the LHS as first named child,
        // probe-verified) is a WRITE and must NOT emit (java JAD1 / kotlin
        // KAD1 contract — the pre-fix "reads/writes are uses" ruling
        // predated the write-gate family contract and this fixture pinned
        // it; the pin is re-authored to the corrected contract).
        const parent = node.parent
        const lhs = parent && parent.type === "assignment_expression" ? parent.namedChild(0) : null
        const isWrite = !!lhs && lhs.startIndex === node.startIndex && lhs.endIndex === node.endIndex
        const first = node.namedChild(0)
        if (!isWrite && first && first.type === "identifier") {
          // GAD1 (JAD2): method ?? owner, matching the field-read owner.
          const source = method ?? owner ?? first.text
          const key = `arr:${source}.${first.text}`
          if (!seen.has(key)) {
            seen.add(key)
            relationships.push({
              source,
              target: first.text,
              type: ASTEngine.RelationshipType.Uses,
              confidence: 0.6,
              metadata: { isArrayAccess: true },
            })
          }
        }
      }
      for (let i = node.namedChildCount - 1; i >= 0; i--) {
        const child = node.namedChild(i)
        if (child) stack.push({ node: child, owner, method: nextMethod })
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

  /**
   * Groovydoc extraction: block_comment starting with '/**' immediately
   * preceding the declaration. Previously groovy symbols carried NO
   * comments (M14 #383).
   */
  /**
   * Per-method cyclomatic complexity (1 + decision points) - java/kotlin
   * parity (M14 #301 prerequisite). Previously always absent.
   */
  private buildGroovyQualifiedCall(objectNode: Node | null, methodName: string): string {
    if (!objectNode) return methodName
    if (objectNode.type === "method_invocation") {
      const innerName = objectNode.childForFieldName("name")
      const innerObject = objectNode.childForFieldName("object")
      const base = this.buildGroovyQualifiedCall(innerObject, innerName?.text ?? "")
      return `${base}.${methodName}`
    }
    return `${objectNode.text}.${methodName}`
  }

  private calculateGroovyMethodComplexity(node: Node): number {
    let complexity = 1
    const stack: Node[] = [node]
    while (stack.length > 0) {
      const n = stack.pop()!
      if (
        n.type === "if_statement" ||
        n.type === "for_statement" ||
        n.type === "enhanced_for_statement" || // for-in loops parsed as this, not for_statement
        n.type === "while_statement" ||
        n.type === "do_statement" || // do-while (NOT "do_while")
        n.type === "switch_block_statement_group" || // per-case granularity (family contract)
        n.type === "catch_clause" || // NOT "catch_block"
        n.type === "ternary_expression"
      ) {
        complexity++
      } else if (n.type === "binary_expression") {
        const op = n.childForFieldName("operator")?.text
        // Short-circuit operators and elvis are decision points. The previous
        // `n.type === "&&"/"||"` cases matched NODE TYPES that don't exist in
        // this grammar (operators live inside binary_expression as an
        // operator field) — dead cases, so &&/||/??: never counted.
        if (op === "&&" || op === "||" || op === "?:") complexity++
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const child = n.namedChild(i)
        if (child) stack.push(child)
      }
    }
    return complexity
  }

  private extractGroovyDoc(node: Node): string | undefined {
    // KAD2 twin (M37 #597 sweep): dead `sibling === node` stop leaked the
    // first GroovyDoc in the file onto every doc-less declaration.
    // Span-locate + backward scan, strict adjacency (kotlin KAD2 contract).
    const parent = node.parent
    if (!parent) return undefined
    let selfIdx = -1
    for (let i = 0; i < parent.namedChildCount; i++) {
      const c = parent.namedChild(i)
      if (c && c.startIndex === node.startIndex && c.endIndex === node.endIndex) { selfIdx = i; break }
    }
    for (let i = selfIdx - 1; i >= 0; i--) {
      const sibling = parent.namedChild(i)
      if (!sibling) continue
      if (sibling.type === "block_comment" && sibling.text.startsWith("/**")) return sibling.text
      break
    }
    return undefined
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
      // GAD6 (M37 #599): modifier KEYWORDS (private/static/final/public…)
      // are ANONYMOUS children of the modifiers node (probe-verified:
      // child type IS the keyword). The old named-children-only loop
      // returned [] for every keyword-only declaration, breaking
      // isStatic/isConstant/visibility — which is what pushed visibility
      // extraction onto the raw-text hack (GAD3) in the first place.
      // Annotations stay named children and are handled by
      // extractAnnotations, so they are not re-collected here.
      for (let i = 0; i < modifiers.childCount; i++) {
        const c = modifiers.child(i)
        if (!c || !c.isNamed) {
          if (c) mods.push(c.text)
          continue
        }
        if (c.type === "annotation" || c.type === "marker_annotation") continue
        mods.push(c.text)
      }
    }
    return mods
  }

  /**
   * Generic type-parameter extraction from type_parameters nodes.
   * Previously groovy symbols carried NO generic information (#383 fix).
   */
  private extractGroovyTypeParameters(node: Node): string[] {
    const tpNode = node.namedChildren.find((c: any) => c.type === "type_parameters")
    if (!tpNode) return []
    const out: string[] = []
    for (let i = 0; i < tpNode.namedChildCount; i++) {
      const c = tpNode.namedChild(i)
      if (!c) continue
      if (/identifier|type_identifier/.test(c.type)) {
        out.push(c.text.trim())
      } else if (c.type === "type_parameter") {
        // descend into type_parameter to find its name child
        for (let j = 0; j < c.namedChildCount; j++) {
          const gc = c.namedChild(j)
          if (gc && /identifier|type_identifier/.test(gc.type)) {
            out.push(gc.text.trim())
            break
          }
        }
      }
    }
    return out
  }

  private extractVisibility(node: Node): "public" | "private" | "protected" | undefined {
    // GAD3 (M37 #599, KAD4 class): visibility was ALSO read from raw
    // node.text substrings — `def leak() { return "this is private data" }
    // (zero modifiers) fabricated `private` from the string literal, and
    // the leading `if (/^(\s*)(private...)/)` branch was a dead no-op.
    // AST-only now: the grammar's modifiers child carries the keywords
    // (probe-verified both shapes). Groovy default visibility is public.
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
          // Name child is identifier OR scoped_identifier (fully-qualified
          // forms). The short name is the last dotted segment — first-
          // identifier extraction returned null for FQ annotations and
          // silently dropped them (same JVM-family defect as Java F2/K2).
          const nameNode = this.findChild(c, (n) => n.type === "identifier" || n.type === "scoped_identifier")
          if (nameNode) {
            const text = nameNode.text
            const dot = text.lastIndexOf(".")
            anns.push(dot === -1 ? text : text.slice(dot + 1))
          }
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
      // 1-based columns, consistent with java/kotlin/scala (M14 consistency gate)
      startColumn: node.startPosition.column + 1,
      endLine: node.endPosition.row + 1,
      endColumn: node.endPosition.column + 1,
      startIndex: node.startIndex,
      endIndex: node.endIndex,
    }
  }
}
