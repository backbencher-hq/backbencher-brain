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
  explicit?: boolean
  // M59 (#825): the OVERRIDING declaration's own line (annotations skipped), so
  // an `@Override` method reports the method, not the annotation.
  line?: number
}

interface StackItem {
  node: Node
  parentContext?: Scope
  isExit?: boolean
}

/**
 * G7: parent node types that OWN an identifier inside a string interpolation,
 * because a different walk already emits it. `obj.prop` is emitted by the
 * `field_access` walk, `obj.method()` by the call walk, `Foo()` by the
 * instantiates walk and `xs[0]` by the `array_access` walk — so a bare-name
 * emitter must skip them or one access becomes two edges.
 */
const INTERPOLATION_OWNED_BY_MEMBER_WALK = new Set([
  "field_access",
  "method_invocation",
  "juxt_function_call",
  "array_access",
  "object_creation_expression",
])

const GROOVY_BUILTINS = new Set([  // Groovy language builtins
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

// Closed node-type alternation for declaration detection (R2 closure audit:
// the /^...$/ regex tested exact membership, nothing more).
const GROOVY_DECLARATION_TYPES = new Set([
  "method_declaration", "constructor_declaration", "function_definition",
  "class_declaration", "trait_declaration", "enum_declaration",
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
          // G5 (review wave): `static` and the wildcard marker are ANONYMOUS
          // children (probe-verified shape: import_declaration >
          // [import, static?, scoped_identifier, ., asterisk]). The old
          // named-children text scan never matched `static`, so every static
          // import was recorded non-static; and isNamespace (module suffix
          // test) permanently disagreed with isWildcard (raw-text test) on
          // `.*` imports because the module text never contains `.*`. Both
          // flags now derive from the same anonymous-token scan.
          let isStatic = false
          let isWildcard = false
          for (let i = 0; i < node.childCount; i++) {
            const c = node.child(i)
            if (!c) continue
            if (c.type === "static") isStatic = true
            else            // M49.S1 F1 finding: this pinned groovy grammar declares the
            // wildcard token as `asterisk` (probe s1-groovy-shape) — there
            // is no `wildcard_import` node type, so the old second disjunct
            // was dead code that could never fire.
            if (c.type === "asterisk") isWildcard = true
          }
          imports.push({
            module: moduleName,
            items: [],
            isDefault: false,
            range: this.nodeToRange(node),
            isNamespace: isWildcard,
            metadata: { isWildcard, isStatic },
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
            // M59 (#825): the line the imported MODULE is named on (java's rule).
            ...this.lineField(nameNode, node),
            metadata: { isGroovyImport: true, isWildcard },
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
                  // M59 (#825): the SUPERtype's own line, never the class header's.
                  ...this.lineField(sc, node),
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
                  // M59 (#825): each interface parent is named on its OWN line.
                  ...this.lineField(tid, node),
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
                  ...this.lineField(sc, node),
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
                // M59 (#825): each interface is named on its OWN line.
                ...this.lineField(tid, node),
                metadata: { relationshipType: "implements" },
              })
            }
          }

          const sym: ASTEngine.UniversalSymbol = {
            name,
            kind,
            comments: (() => { const d = this.extractGroovyDoc(node); return d ? [d] : [] })(),
            genericParameters: (() => { const tp = this.extractGroovyTypeParameters(node); return tp.length > 0 ? tp : undefined })(),
            // M59 (#825): annotations skipped — the class is written on its own line.
            range: this.symbolRange(node),
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
                    range: this.symbolRange(p),
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
        const isConstructorRaw = type === "constructor_declaration"
        const nameNode = this.findChild(node, (n) => n.type === "identifier" || n.type === "string_literal")
        if (nameNode) {
          const rawName = nameNode.type === "string_literal"
            ? this.stripQuotes(nameNode.text)
            : nameNode.text
          // G4 (review wave, java C3 parity): ctors keep their DECLARED name
          // (the class name). The old "constructor" literal collided across
          // classes (contains:A->constructor vs contains:B->constructor are
          // indistinguishable; overloads collapsed). Kind still says
          // Constructor; self-contains (A->A) matches the java/kotlin
          // reference behavior exactly.
          const name = rawName
          const modifiers = this.extractModifiers(node)
          const visibility = this.extractVisibility(node)
          const annotations = this.extractAnnotations(node)

          // #841 round 3 (def-method contract): a class-body method declared
          // `def name() {}` parses as constructor_declaration because Java's
          // method header requires a type and `def` is not one — the grammar
          // squeezes `def` into a separate bogus field and the remainder reads
          // as a constructor. A constructor's name MUST equal its class; when
          // it does not, this is a def-returning method, not a constructor
          // (emits kind=method on both wasms; the grammar-level fix regressed
          // `def x = …` fields and was reverted — see git history).
          const enclosingName = scopeStack.length > 0 && scopeStack[scopeStack.length - 1].kind === ASTEngine.SymbolKind.Class
            ? scopeStack[scopeStack.length - 1].name
            : undefined
          const isMisnamedCtor = isConstructorRaw && enclosingName !== undefined && rawName !== enclosingName
          const isConstructor = isConstructorRaw && !isMisnamedCtor
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

          // G2 (review wave, java JAO1 parity): @Override is a CHECK, not a
          // requirement — un-annotated instance methods with matching
          // signatures still override. Implicit tasks resolve but emit ONLY
          // on a verified exact-signature in-file match (pass 1); explicit
          // tasks keep the companion/guess tiers so overloads never
          // fabricate an override edge.
          if (annotations.indexOf("Override") !== -1 && newContext) {
            overrideTasks.push({
              fqn,
              methodName: name,
              signature,
              ownerFqn: newContext.fqn,
              explicit: true,
              line: this.declarationLineNode(node).startPosition.row + 1,
            })
          } else if (newContext && !isConstructor &&
                     modifiers.indexOf("static") === -1 && visibility !== "private") {
            overrideTasks.push({
              fqn,
              methodName: name,
              signature,
              ownerFqn: newContext.fqn,
              explicit: false,
              line: this.declarationLineNode(node).startPosition.row + 1,
            })
          }

          const sym: ASTEngine.UniversalSymbol = {
            name,
            kind: isConstructor ? ASTEngine.SymbolKind.Constructor : ASTEngine.SymbolKind.Method,
            comments: (() => { const d = this.extractGroovyDoc(node); return d ? [d] : [] })(),
            complexity: this.calculateGroovyMethodComplexity(node),
            // M59 (#825): annotations skipped — `@Override` is not where the
            // overriding method is written.
            range: this.symbolRange(node),
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
          // #841 round 3 (def-squeeze phantom): when a `def name() {}` method
          // is force-split, the grammar also manufactures a bogus field whose
          // declared "name" is literally the keyword `def` (the type token it
          // absorbed). No real Groovy field can be named `def` — reserved — so
          // such symbols are parse artifacts, never emitted. The same shape
          // legitimately carries the SQUEEZED METHOD's calls, which attribute
          // to the enclosing class context below.
          if (idNode.text === "def") continue
          symbols.push({
            name: idNode.text,
            kind: isConstant ? ASTEngine.SymbolKind.Constant : ASTEngine.SymbolKind.Property,
            range: this.symbolRange(child),
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
            range: this.symbolRange(node),
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
              // M59 (#825): the method NAME's line, not the receiver's — a
              // multi-line chain opens on the receiver (scala's measured defect).
              ...this.lineField(nameNode, node),
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
            ...this.lineField(first, node),
            metadata: { relationshipType: "constructor_invocation" },
          })
        }
      } else if (type === "juxt_function_call") {
        // Groovy juxtaposition call syntax: `echo "msg"` / `sh "cmd"` IS a
        // method call under Groovy semantics — Jenkins pipelines are built
        // on it. Grammar: juxt_function_call [name, args].
        //
        // #852: the family contract (java/kotlin/scala, and this analyzer's own
        // `method_invocation` branch) is that a `calls` edge targets the BARE
        // callee leaf. A dotted juxt name parses as `field_access`, so
        // `helper.build "x"` — and every chain continuation, since a continued
        // dotted call folds into a juxt call — used to store the whole dotted
        // text as the target, putting ONE method in the graph twice under two
        // names (`build` at its own line and `helper.build` at the
        // continuation). Measured: `helper.build(2)\n .configure(3)` emitted
        // `calls f -> helper.build` where the one-line `helper.build(2).configure(3)`
        // emits `calls f -> build`. The leaf's own line is used for the same
        // reason (#825): the name's line, not the spanning expression's.
        const nameNode = node.childForFieldName("name")
        if (nameNode && !this.isGroovyBuiltin(nameNode.text)) {
          const leafNode = nameNode.type === "field_access"
            ? nameNode.childForFieldName("field") ?? nameNode
            : nameNode
          relationships.push({
            source: parentContext?.name ?? "(script)",
            target: leafNode.text,
            type: ASTEngine.RelationshipType.Calls,
            confidence: 0.7,
            ...this.lineField(leafNode, node),
            // The callee expression AS WRITTEN (the sibling method_invocation
            // branch's payload) — kept so the dotted form is recoverable by a
            // consumer even though the edge itself names the bare leaf.
            metadata: { relationshipType: "juxt_call", groovyCallExpression: nameNode.text },
          })
        }
      } else if (type === "leading_dot_call") {
        // #841 round 3: Groovy 3 leading-dot chain continuation. When the
        // previous statement is complete the newline-terminated segment
        // becomes its own statement node (documented grammar tradeoff); the
        // call must still be analyzer-visible and attributed to the enclosing
        // scope, exactly like a same-line method_invocation.
        //
        // #851: a continuation segment is a CALL only when it carries an
        // argument list. Measured on the pinned grammar — `helper\n .build(1)`
        // parses as `leading_dot_call name: (identifier) arguments:
        // (argument_list …)`, while `this\n .label` parses with `name` and NO
        // arguments. The branch used to emit `calls` for both, so a multi-line
        // property access — an extremely common Groovy layout — fabricated a
        // call edge to a property name and lost the read entirely. The
        // paren-less form is a MEMBER READ, emitted in the exact shape
        // `collectFieldAccessUses` uses for the same-line `field_access`
        // (`obj.thing` -> `uses <owner> -> thing`), attributed to the enclosing
        // method because the continuation node does not carry its receiver
        // (GAD1: an unresolvable receiver attributes to the enclosing method).
        const nameNode = node.childForFieldName("name")
        if (nameNode && !this.isGroovyBuiltin(nameNode.text)) {
          const args = node.childForFieldName("arguments") ?? this.findChild(node, (n) => n.type === "argument_list")
          if (args) {
            relationships.push({
              source: parentContext?.name ?? "(script)",
              target: nameNode.text,
              type: ASTEngine.RelationshipType.Calls,
              confidence: 0.7,
              ...this.lineField(nameNode, node),
              metadata: { relationshipType: "leading_dot_call" },
            })
          } else {
            relationships.push({
              source: parentContext?.name ?? "(script)",
              target: nameNode.text,
              type: ASTEngine.RelationshipType.Uses,
              confidence: 0.6,
              ...this.lineField(nameNode, node),
              metadata: { isFieldAccess: true },
            })
          }
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
            // M59 (#825): the constructed TYPE's own line.
            ...this.lineField(typeNode, node),
            metadata: { relationshipType: "instantiates", isNew: true },
          })
          // M37.21 #610 (JD18 family lesson from java/scala, probe-verified
          // in groovy: run inside new Runnable() {...} attributed to Service
          // with no anonymous symbol): an anonymous inner class body
          // declares REAL members. Mirror the kotlin/java/scala family
          // convention: anonymous_<SuperName> Class symbol (noise name,
          // never leaks into the index) owned by the enclosing type, scope
          // pushed so the body's members attribute to the anonymous type
          // (contains anonymous_Runnable -> run).
          const classBody = this.findChild(node, (n) => n.type === "class_body")
          if (classBody && parentContext) {
            const superName = this.baseTypeName(typeNode)
            const anonName = superName ? `anonymous_${superName}` : "anonymous_class"
            const anonFqn = parentContext.fqn ? `${parentContext.fqn}.${anonName}` : anonName
            const anonSym: ASTEngine.UniversalSymbol = {
              name: anonName,
              kind: ASTEngine.SymbolKind.Class,
              range: this.symbolRange(node),
              visibility: parentContext.visibility || "public",
              ownerName: parentContext.name,
              ownerKind: parentContext.kind,
              metadata: { nodeType: type, isAnonymousClass: true, superTypes: superName ? [superName] : [] },
            }
            symbols.push(anonSym)
            symbolMap.set(anonFqn, anonSym)
            newContext = {
              node: classBody,
              name: anonName,
              kind: ASTEngine.SymbolKind.Class,
              fqn: anonFqn,
              symbolRef: anonSym,
              visibility: parentContext.visibility,
              isInterface: false,
              parents: superName ? [superName] : [],
            }
            scopeStack.push(newContext)
            pushedScope = true
          }
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
          // M59 (#825): the member's DECLARATION line, and the same line the
          // member's own range carries — a symbol and the edge naming it must
          // never disagree (java/scala contract). Never 0 (#820/#821).
          ...(s.range?.startLine ? { line_number: s.range.startLine } : {}),
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
      // G3 (member half REVERSED, M49 JVM-closure exports-family ruling —
      // java JAD3 reversal is the twin; see reviews/jvm-closure-audit.md):
      // exports = importable units — top-level types and top-level
      // functions only. Groovy imports types and static members, never
      // bare member names; membership rides Contains (Greeter->greet).
      // G7 (anon exclusion) is unaffected: anonymous classes are never
      // top-level, so the !s.ownerName guard excludes them structurally —
      // the explicit isAnonymousClass check stays as belt-and-braces.
      if (!s.metadata?.isAnonymousClass && !s.metadata?.isPhantom && !s.ownerName) {
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
    // PERF (review wave, java C11 parity): the suffix index is built ONCE per
    // file (O(C)) instead of per task (was O(T·C)); the BFS below uses an
    // index cursor instead of queue.shift() (O(1) vs O(N) per dequeue).
    let suffixIndex: Map<string, string[]> | null = null
    for (let ti = 0; ti < tasks.length; ti++) { const task = tasks[ti]
      let targetFqn: string | null = null
      // Confidence reflects EVIDENCE TIER (patterns.ts filters >= 0.7):
      // pass 1 exact in-file match, pass 2 project companion evidence,
      // pass 3 first-parent guess — guesses at 1.0 contaminated thresholded
      // analysis identically to verified overrides.
      let confidence = 1.0
      let reasonCode = "exact-in-file"

      // Pass 1: exact-signature BFS over the in-file hierarchy.
      // M37.21 #610 (JD19 family lesson from java): classHierarchy is FQN-
      // keyed but parents are bare leaf names, so hop-2+ looked up the map
      // with the bare name and missed — nested-class chains (BlackVal
      // extends Black extends Node) lost overrides through non-declaring
      // ancestors AND fell through to the pass-3 first-parent GUESS, which
      // fabricated wrong edges at 0.5 (BlackVal.val -> Black.val with Black
      // declaring no val). Suffix-resolve every bare parent to its FQN
      // candidate(s); symbolMap disambiguates same-named classes.
      // PERF (review wave): suffixIndex is hoisted above the task loop.
      if (!suffixIndex) {
        suffixIndex = new Map<string, string[]>()
        for (const fqn of classHierarchy.keys()) {
          const bare = fqn.slice(fqn.lastIndexOf(".") + 1)
          const arr = suffixIndex.get(bare)
          if (arr) arr.push(fqn)
          else suffixIndex.set(bare, [fqn])
        }
      }
      const queue: string[] = []
      const ownerH = classHierarchy.get(task.ownerFqn)
      if (ownerH) {
        for (let i = 0; i < ownerH.length; i++) queue.push(ownerH[i])
      }
      const seen: Set<string> = new Set()
      let head = 0
      while (head < queue.length && !targetFqn) {
        const parent = queue[head++]
        if (seen.has(parent)) continue
        seen.add(parent)
        const candidates = suffixIndex.get(parent) ?? [parent]
        for (const cand of candidates) {
          // Groovy symbolMap keys method symbols by the OWNER-NAME raw key
          // (Owner.method(sig)) — an FQN candidate (Outer.Black.val) has no
          // direct key. Match on the method's declaring-owner leaf: the
          // candidate's bare class name is the ownerName in the raw key.
          const ownerBare = cand.slice(cand.lastIndexOf(".") + 1)
          const potential = `${ownerBare}.${task.methodName}${task.signature}`
          if (symbolMap.has(potential)) {
            targetFqn = `${cand}.${task.methodName}${task.signature}`
            break
          }
        }
        if (targetFqn) break
        for (const cand of candidates) {
          const pH = classHierarchy.get(cand)
          if (pH) {
            for (let i = 0; i < pH.length; i++) queue.push(pH[i])
          }
        }
      }

      // Pass 2: declaring-parent via the project companion index (cross-file).
      // Explicit tasks only — an implicit task without an exact in-file
      // match is an overload until proven otherwise (java JAO1 parity).
      if (!targetFqn && task.explicit && companion && ownerH && ownerH.length > 0) {
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
      // Explicit tasks only (the @Override annotation asserts intent).
      if (!targetFqn && task.explicit && ownerH && ownerH.length > 0) {
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
          // M59 (#825): the overriding declaration's line — captured while the
          // node was in hand, not resolved later by name (namesakes collide).
          ...(task.line ? { line_number: task.line } : {}),
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

    // M59 (#825): collects the NAME TOGETHER WITH ITS NODE, so the reference
    // edge can carry the line the type is named on rather than the line the
    // enclosing declaration (or type expression) opened on.
    type NamedNode = { name: string; node: Node }
    const collectTypeNames = (n: Node, out: NamedNode[]): void => {
      if (n.type === "type_identifier") {
        // `def` is the dynamic-type keyword; `as` is how the grammar lexes
        // the keyword inside its mis-parsed dangling as-expression
        // (`= [] as Set` becomes local_variable_declaration(as, Set)).
        // Both are type_identifier TOKENS but never types.
        if (n.text !== "def" && n.text !== "as" && !out.some((o) => o.name === n.text)) out.push({ name: n.text, node: n })
        return
      }
      if (n.type === "record_pattern") {
        // The pattern's type is its FIRST named child (identifier):
        // `Point(int x, int y)` under instanceof or a switch case label.
        const t = n.namedChild(0)
        if (t && t.type === "identifier" && t.text !== "this" && !out.some((o) => o.name === t.text)) out.push({ name: t.text, node: t })
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
      // R2 (closure audit): closed type alternation as a Set — the regex
      // tested exact membership, nothing more.
      let p: Node | null = GROOVY_DECLARATION_TYPES.has(start.type) ? start : start.parent
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
        const names: NamedNode[] = []
        collectTypeNames(r, names)
        for (const t of names) {
          const key = `${source}|${t.name}|${kind}`
          if (emitted.has(key)) continue
          emitted.add(key)
          relationships.push({
            source,
            target: t.name,
            type: ASTEngine.RelationshipType.References,
            confidence: 0.95,
            // M59 (#825): the line the TYPE is named on. A wrapped generic
            // (`List<\n    Map<String, Int>>`) opens on an earlier line than its
            // arguments, so the enclosing type expression's line is wrong for
            // every nested name (scala's measured defect class).
            ...this.lineField(t.node, decl),
            metadata: { relationshipType: relType, declaredOn: decl.type },
          })
        }
      }
    }

    const walk = (n: Node): void => {
      switch (n.type) {
        case "binary_expression": {
          // Groovy `as` coercion — `o as String`, `[] as Set`,
          // `[mimeType] as MimeType[]`. Since the #742 grammar rebuild the
          // pinned grammar parses this CORRECTLY as
          // binary_expression(left, type) with the `as` operator; the cast
          // target is the `type` field. The pre-rebuild grammar mis-parsed it
          // as a local_variable_declaration whose "type" was the `as` keyword
          // (that branch is kept below only so an older wasm still emits);
          // this case is the real one now, and is what the as-cast fixture
          // asserts.
          const asType = n.childForFieldName("type")
          if (asType && n.childForFieldName("left")) {
            emit(n, [asType], "as_coercion", "cast_type")
            // Do not descend further for this node: the generic type-clause
            // scan below does not apply to expressions.
            const lt = n.childForFieldName("left")
            if (lt) walk(lt)
            break
          }
          for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) walk(c) }
          break
        }
        case "field_declaration":
        case "formal_parameter":
        case "local_variable_declaration": {
          // LEGACY (pre-#742-rebuild wasm only): `def y = o as String` used to
          // lex as local_variable_declaration(type_identifier("as"),
          // variable_declarator(String)). The rebuilt grammar parses the
          // coercion as binary_expression (case above), so this branch is
          // inert with the shipped wasm; kept for the older-build path.
          if (n.type === "local_variable_declaration") {
            let asKw: Node | null = null
            let asDecl: Node | null = null
            for (let i = 0; i < n.namedChildCount; i++) {
              const c = n.namedChild(i)
              if (!c) continue
              if ((c.type === "type_identifier" || c.type === "identifier") && c.text === "as") asKw = c
              else if (c.type === "variable_declarator") asDecl = c
            }
            if (asKw && asDecl) {
              const names: NamedNode[] = []
              const tstack: Node[] = [asDecl]
              while (tstack.length > 0) {
                const m = tstack.pop()!
                if (m.type === "type_identifier" || m.type === "identifier") {
                  if (m.text !== "as" && m.text !== "def" && !names.some((o) => o.name === m.text)) names.push({ name: m.text, node: m })
                } else {
                  for (let i = 0; i < m.namedChildCount; i++) {
                    const c = m.namedChild(i)
                    if (c) tstack.push(c)
                  }
                }
              }
              // Source is the ENCLOSING declaration (the method), matching
              // the C-cast branch.
              const source = resolveSource(n)
              for (const t of names) {
                const key = `${source}|${t.name}|as_cast`
                if (emitted.has(key)) continue
                emitted.add(key)
                relationships.push({
                  source,
                  target: t.name,
                  type: ASTEngine.RelationshipType.References,
                  confidence: 0.95,
                  ...this.lineField(t.node, n),
                  metadata: { relationshipType: "cast_type", declaredOn: "as_cast" },
                })
              }
              break
            }
          }
          // Type clause = direct children that are types (generic_type /
          // type_identifier / scoped), before any declarator begins.
          // R2 (closure audit): /type$/ subsumes the endsWith("_type")
          // clause, but NOT "type_identifier" (it ends in "identifier") —
          // that case stays explicit. ("prototype" matches either way, same
          // as before — the predicate is unchanged, only the spelling.)
          const roots: Node[] = []
          for (let i = 0; i < n.namedChildCount; i++) {
            const c = n.namedChild(i)
            if (!c || TYPE_STOP.has(c.type)) continue
            if (c.type.endsWith("type") || c.type === "type_identifier") roots.push(c)
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
        case "catch_formal_parameter": {
          // Multi-catch union (java JLS 14.20 parity, pinned by java's
          // overload-arity-varargs-multicatch fixture): the pinned grammar
          // nests BOTH exception types under one `catch_type` child
          // (`catch (IOException | SQLException e)` → catch_type with two
          // type_identifier children). collectTypeNames descends into the
          // union and emits a declared_type ref for EACH — the pre-fix walk
          // had no catch case at all, so multi-catch types (and plain
          // single-type catches) silently vanished from the type-usage
          // graph. The `e` identifier is not a type_identifier and is
          // skipped naturally.
          const catchType = this.findChild(n, (c) => c.type === "catch_type")
          if (catchType) emit(n, [catchType], "catch_formal_parameter", "declared_type")
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
                ...this.lineField(first, n),
                metadata: { relationshipType: "method_reference" },
              })
            }
          }
          break
        }
        case "juxt_function_call": {
          // `x as Type` parses as juxt_function_call(as, argument_list) on
          // some shapes (the common shape mis-parses as a phantom
          // local_variable_declaration instead — see the G1 branch above).
          // Uniform cast_type label either way.
          const first = n.namedChild(0)
          if (first && first.text === "as") {
            for (let i = 0; i < n.namedChildCount; i++) {
              const c = n.namedChild(i)
              if (c && c.type === "argument_list") emit(n, [c], "as_expression", "cast_type")
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

    // G7: the names the enclosing callable binds — parameters, local
    // declarators, catch parameters — plus `it` for any closure, because
    // Groovy closures take an implicit `it` whether or not they declare a
    // parameter list. Memoised per scope node: a file with many interpolations
    // re-asks for the same scope, and the answer cannot change mid-analyze.
    //
    // The climb deliberately passes THROUGH nested closures up to the method: a
    // `local` bound in the method body is still bound for an interpolation
    // inside a `{ -> "$local" }` nested in it, and stopping at the inner
    // closure would fabricate an edge for it.
    const boundCache = new Map<number, Set<string>>()
    const boundNamesOf = (scope: Node): Set<string> => {
      const cached = boundCache.get(scope.id)
      if (cached) return cached
      const out = new Set<string>()
      const push = (n: Node | null | undefined): void => {
        if (n && n.type === "identifier") out.add(n.text)
      }
      const work: Node[] = []
      for (let i = 0; i < scope.namedChildCount; i++) {
        const c = scope.namedChild(i)
        if (c) work.push(c)
      }
      while (work.length > 0) {
        const n = work.pop()!
        if (n.type === "formal_parameter" || n.type === "catch_formal_parameter") push(n.childForFieldName("name"))
        else if (n.type === "variable_declarator") push(n.childForFieldName("name"))
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c) work.push(c)
        }
      }
      if (scope.type === "closure") out.add("it")
      boundCache.set(scope.id, out)
      return out
    }
    // UNION across every enclosing scope, not the first one found: a closure
    // whose only binding is the implicit `it` still has a non-empty set, so
    // returning on the first non-empty scope would hide a `local` bound by the
    // method it sits inside. `.program` is collected too — a `def x` at script
    // level binds `x` for an interpolation in the same script.
    const locallyBoundNames = (n: Node): Set<string> => {
      const acc = new Set<string>()
      let p: Node | null = n.parent
      let guard = 0
      while (p && guard++ < 24) {
        if (
          p.type === "method_declaration" || p.type === "constructor_declaration" ||
          p.type === "function_definition" || p.type === "lambda_expression" ||
          p.type === "closure" || p.type === "program"
        ) {
          for (const t of boundNamesOf(p)) acc.add(t)
        }
        if (
          p.type === "class_declaration" || p.type === "interface_declaration" ||
          p.type === "trait_declaration" || p.type === "enum_declaration"
        ) break
        p = p.parent
      }
      return acc
    }

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
          // #852: a `field_access` in CALLEE position — the `name` of a
          // juxt_function_call, which is where a continued dotted chain lands —
          // is the callee, not a read. It used to leak the callee as a member
          // read (`uses f -> build` alongside `calls f -> build`), contradicting
          // the family rule that a callee is not a read; java/kotlin/scala all
          // suppress it, and so does this shape written on one line.
          const parentField = node.parent?.type === "juxt_function_call"
            ? node.parent.childForFieldName("name")
            : null
          const isCalleePosition = !!parentField
            && parentField.startIndex === node.startIndex
            && parentField.endIndex === node.endIndex
          const key = `${source}.${parts[parts.length - 1]}`
          if (!isWrite && !isCalleePosition && !seen.has(key)) {
            seen.add(key)
            relationships.push({
              source,
              target: parts[parts.length - 1],
              type: ASTEngine.RelationshipType.Uses,
              confidence: 0.6,
              // M59 (#825): the `field` field of the access node names the
              // member — measured populated in the pinned grammar
              // (`repo.items` -> [identifier, identifier], field=identifier),
              // so a multi-line receiver chain does not drag the read onto the
              // receiver's line.
              ...this.lineField(node.childForFieldName("field"), node),
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
              ...this.lineField(first, node),
              metadata: { isArrayAccess: true },
            })
          }
        }
      }
      // ── G7: interpolation reads ────────────────────────────────────────
      //
      // The pinned grammar did not model Groovy interpolation at all: Java's
      // `string_fragment` token swallowed `$` and `{` as opaque text, so
      // `${user.name}` produced NO read, `${obj.method()}` NO call, and the
      // nested-quote subset (`"${getenv("X")}"`) did not even parse. Measured on
      // grails-core: 2,115 of 7,701 groovy-surface files (27.5%) contain
      // interpolation, 13,830 sites, every one contributing 0 relationships.
      //
      // The grammar now produces a real `string_interpolation` (a `${…}`
      // expression) and an `interpolated_identifier` (the `$name` short form),
      // so the two node kinds are handled separately on purpose:
      //
      //  * `${obj.prop}` / `${obj.method()}` / `${f(x)}` are ordinary nodes now,
      //    and the field-access and call walks above already emit them — the
      //    family contract is that the SAME expression emits the SAME edges
      //    inside a string as outside it, so nothing is added for them here.
      //  * a BARE name (`$count`, `${count}`) is the part those walks cannot see
      //    — this analyzer has no bare-identifier read path at all — so it is
      //    emitted here, at dart's `isInterpolationRead` confidence and with
      //    the identifier's OWN line.
      if (node.type === "interpolated_identifier" || node.type === "string_interpolation") {
        const source = method ?? owner
        const candidates: Node[] = []
        if (node.type === "interpolated_identifier") {
          // G7 slashy half: the parent check keeps the double-quoted and slashy
          // families on ONE contract. In a double-quoted string this node's
          // parent is the `_string_literal` body (no walk owns it); in the
          // slashy form it can ALSO be the callee position of a juxtaposition
          // call — `/re/ args` — where the `juxt_function_call` branch already
          // emits `calls` for the whole slashy token. Reading the callee there
          // would put one node in the graph twice (the #852 defect class).
          const parentType = node.parent?.type ?? ""
          if (parentType === "juxt_function_call" || parentType === "field_access") continue
          candidates.push(node)
        } else {
          // COLLECT is bounded to this interpolation: a nested string's own
          // `$name` is an `interpolated_identifier` reached by the outer walk,
          // never re-collected here.
          const collect = (n: Node): void => {
            if (n.type === "identifier") {
              // Positions the member and call walks OWN: a receiver, a member
              // leaf, a callee. Emitting them here would double-emit `obj.prop`
              // as both a bare read and a field read.
              const pt = n.parent?.type ?? ""
              if (!INTERPOLATION_OWNED_BY_MEMBER_WALK.has(pt)) candidates.push(n)
              return
            }
            for (let i = 0; i < n.namedChildCount; i++) {
              const c = n.namedChild(i)
              if (c) collect(c)
            }
          }
          for (let i = 0; i < node.namedChildCount; i++) {
            const c = node.namedChild(i)
            if (c) collect(c)
          }
        }
        for (const n of candidates) {
          const name = n.text.startsWith("$") ? n.text.slice(1) : n.text
          if (!name || !source) continue
          // The family rule (dart documents it as "declaration-shaped names
          // still bind"; kotlin implements it as `isLocallyBound`): a use of a
          // name the CURRENT function binds locally is not graph-worthy. Without
          // this, `"${count}"` where `count` is a parameter fabricates a `uses`
          // edge to a name that has no symbol at all.
          //
          // G7 slashy boundary, measured before coding it: `/${className}.groovy/`
          // where `className` IS the method's parameter must emit NOTHING (the
          // name is bound), while the corpus shape it comes from —
          // GspTagSourceMacro writing `/${className}.groovy/` inside a scope
          // where `className` is free — must emit the read. The rule is the
          // binding test, not the string form: /…/ and "…" behave identically.
          if (locallyBoundNames(n).has(name)) continue
          const key = `interp:${source}.${name}`
          if (seen.has(key)) continue
          seen.add(key)
          relationships.push({
            source,
            target: name,
            type: ASTEngine.RelationshipType.Uses,
            confidence: 0.9,
            ...this.lineField(n, n),
            metadata: { isInterpolationRead: true },
          })
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
      // R2 (closure audit): unanchored /identifier|type_identifier/ matches
      // iff the type string contains "identifier" ("type_identifier" does
      // too) — includes() states the actual predicate.
      if (c.type.includes("identifier")) {
        out.push(c.text.trim())
      } else if (c.type === "type_parameter") {
        // descend into type_parameter to find its name child
        for (let j = 0; j < c.namedChildCount; j++) {
          const gc = c.namedChild(j)
          if (gc && gc.type.includes("identifier")) {
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

  /**
   * M59 (#825): the `line_number` field for a relationship, taken from the node
   * that NAMES the relationship's target — never from the construct that merely
   * contains it. Returns nothing at all when no node is available: #820/#821,
   * a stored 0 is a claim that the relationship occurs on line 0.
   */
  private lineField(nameNode: Node | null | undefined, fallback?: Node | null): { line_number?: number } {
    const n = nameNode ?? fallback
    return n ? { line_number: n.startPosition.row + 1 } : {}
  }

  /**
   * M59 (#825): the node whose start is the DECLARATION's own line.
   *
   * An annotation is a modifier — `@Service` decorates the class, it is not
   * where the class is written. Measured on the pinned grammar, not assumed:
   * `class_declaration` for `@Service\nclass Svc` has children
   * `[modifiers@5, identifier@6, class_body@6]`, so the class symbol's line was
   * the ANNOTATION line. Same shape and same rule as java's
   * `declarationLineNode` and scala's `declarationLineNode` — one rule for the
   * whole JVM family rather than three dialects of it.
   */
  private declarationLineNode(node: Node): Node {
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (!c) continue
      if (c.type === "modifiers" || c.type === "annotation" || c.type === "marker_annotation") continue
      // M59 (#825) / F6: the grammar's own names. `"comment"` was dead here —
      // tree-sitter-groovy emits `line_comment`/`block_comment` only.
      if (c.type === "line_comment" || c.type === "block_comment") continue
      return c
    }
    return node
  }

  /** The range of a SYMBOL (not of an import, an error or a raw node): annotations skipped. */
  private symbolRange(node: Node) {
    const decl = this.declarationLineNode(node)
    const base = this.nodeToRange(node)
    return {
      ...base,
      startLine: decl.startPosition.row + 1,
      startColumn: decl.startPosition.column + 1,
      startIndex: decl.startIndex,
    }
  }
}
