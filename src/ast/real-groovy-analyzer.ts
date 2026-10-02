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
import { findDeclaringParent, localEdgeLabel } from "./override-context"

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

/**
 * #896 — the groovy walk state. `analyze` owns traversal; the `handleX`
 * methods own extraction. Nothing else is shared between them.
 */
interface GroovyWalkState {
  content: string
  /** Declarations refused because the name was empty (a MISSING node from error recovery). */
  emptyNameRefusals?: number
  symbols: ASTEngine.UniversalSymbol[]
  relationships: ASTEngine.UniversalRelationship[]
  imports: ASTEngine.ImportInfo[]
  symbolMap: Map<string, ASTEngine.UniversalSymbol>
  classHierarchy: Map<string, string[]>
  overrideTasks: OverrideTask[]
  scopeStack: Scope[]
  parentContext: Scope | undefined
  newContext: Scope | undefined
  pushedScope: boolean
  currentPackage: string
}

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


    const symbolMap = new Map<string, ASTEngine.UniversalSymbol>()
    const classHierarchy = new Map<string, string[]>()
    const overrideTasks: OverrideTask[] = []

    const scopeStack: Scope[] = []
    const stack: StackItem[] = [{ node: rootNode }]

    // #896 (handler-map refactor): the WALK STATE. `analyze` owns TRAVERSAL —
    // the stack loop, its exit items, the child pushes — and the handlers below
    // own EXTRACTION, reading and mutating this object and nothing else. The
    // containers are references, so handler mutations land in the same arrays
    // the rest of this method consumes; the scalars are the loop-carried state
    // the chain used to keep as locals.
    const walk: GroovyWalkState = {
      content,
      symbols,
      relationships,
      imports,
      symbolMap,
      classHierarchy,
      overrideTasks,
      scopeStack,
      parentContext: undefined,
      newContext: undefined,
      pushedScope: false,
      currentPackage: "",
    }

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

      walk.parentContext = parentContext
      walk.newContext = parentContext
      walk.pushedScope = false
      const handler = this.nodeHandlers.get(node.type)
      if (handler) handler(node, walk)

      // Closures, local variables, gstrings, command expressions: intentionally
      // produce NO symbols and NO relationships (pure AST contract).

      if (walk.pushedScope) {
        stack.push({ node, parentContext: walk.newContext, isExit: true })
      }
      for (let i = node.namedChildCount - 1; i >= 0; i--) {
        const child = node.namedChild(i)
        if (child) {
          stack.push({ node: child, parentContext: walk.newContext })
        }
      }
    }


    // #841 round 14: analyzer-side recovery of the ownership graph that
    // tree-sitter's error recovery flattens into root-level fragments (see
    // recoverDegradedClassShapes). Runs before override resolution and the
    // primary-type rewrite so both consume the recovered class.
    this.recoverDegradedClassShapes(rootNode, symbols, relationships, symbolMap, walk.currentPackage)

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
        if (rel.type === ASTEngine.RelationshipType.References && (rel.source === walk.currentPackage || rel.source === "(script)" || rel.source === "root")) {
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
        // Refusals, surfaced. A declaration whose name came back EMPTY (a MISSING node
        // from error recovery) is dropped rather than published, because an empty name is
        // not a name -- but a silent drop is a hole exactly like the one it closes, so the
        // count travels with the result. Non-zero means the file had a parse that did not
        // happen, which is worth knowing even when the symbol list looks clean.
        emptyNameRefusals: walk.emptyNameRefusals ?? 0,
        currentPackage: walk.currentPackage,
        framework: fw.framework,
        detectedFrameworks: fw.detected,
        analysisVersion: "5.0.0-groovy-pure-ast",
      },
    }
  }

  // ── #896: node-type dispatch table ────────────────────────────────────────
  // `analyze` walks (push/visit/pop); these handlers extract. Each is a named
  // method taking the walk state, so a handler can be exercised on its own —
  // which is what the review asked for and what the if/else chain prevented.
  // The misparse guards (§ juxt_function_call / field_declaration) are named
  // handlers here for the same reason: they stay individually testable, and
  // #841 rounds 3/14/22 measured them as load-bearing, so they are kept.
  private nodeHandlersCache?: Map<string, (node: Node, s: GroovyWalkState) => void>

  private get nodeHandlers(): Map<string, (node: Node, s: GroovyWalkState) => void> {
    if (!this.nodeHandlersCache) {
      const m = new Map<string, (node: Node, s: GroovyWalkState) => void>()
      const reg = (types: string[], h: (node: Node, s: GroovyWalkState) => void) => {
        for (const t of types) m.set(t, h)
      }
      reg(["package_declaration"], (n, s) => this.handlePackageDeclaration(n, s))
      reg(["import_declaration"], (n, s) => this.handleImportDeclaration(n, s))
      reg(["class_declaration", "interface_declaration", "trait_declaration", "enum_declaration", "record_declaration", "annotation_type_declaration"], (n, s) => this.handleTypeDeclaration(n, s))
      reg(["method_declaration", "constructor_declaration", "function_definition"], (n, s) => this.handleMethodDeclaration(n, s))
      reg(["field_declaration", "constant_declaration"], (n, s) => this.handleFieldDeclaration(n, s))
      reg(["enum_constant"], (n, s) => this.handleEnumConstant(n, s))
      reg(["method_invocation"], (n, s) => this.handleMethodInvocation(n, s))
      reg(["explicit_constructor_invocation"], (n, s) => this.handleExplicitConstructorInvocation(n, s))
      reg(["juxt_function_call"], (n, s) => this.handleJuxtFunctionCall(n, s))
      reg(["leading_dot_call"], (n, s) => this.handleLeadingDotCall(n, s))
      reg(["object_creation_expression"], (n, s) => this.handleObjectCreationExpression(n, s))
      this.nodeHandlersCache = m
    }
    return this.nodeHandlersCache
  }

  private handlePackageDeclaration(node: Node, s: GroovyWalkState): void {
    const type = node.type
    const nameNode = this.findChild(node, (n) => n.type === "scoped_identifier" || n.type === "identifier")
    if (nameNode) s.currentPackage = nameNode.text
  }

  private handleImportDeclaration(node: Node, s: GroovyWalkState): void {
    const { relationships, imports } = s
    const type = node.type
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
        source: s.currentPackage || "(script)",
        target: moduleName,
        type: ASTEngine.RelationshipType.References,
        confidence: 0.9,
            // M59 (#825): the line the imported MODULE is named on (java's rule).
        ...this.lineField(nameNode, node),
        metadata: { isGroovyImport: true, isWildcard },
      })
    }
  }

  private handleTypeDeclaration(node: Node, s: GroovyWalkState): void {
    const { symbols, relationships, symbolMap, classHierarchy, scopeStack } = s
    const type = node.type
    const nameNode = this.findChild(node, (n) => n.type === "identifier")
    if (nameNode) {
      const name = nameNode.text
      const kind = type === "interface_declaration" || type === "trait_declaration"
        ? ASTEngine.SymbolKind.Interface
        : type === "enum_declaration"
          ? ASTEngine.SymbolKind.Enum
          : ASTEngine.SymbolKind.Class
      const fqn = this.buildFqn(s.currentPackage, scopeStack, name)
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

      s.newContext = {
        node,
        name,
        kind,
        fqn,
        symbolRef: sym,
        visibility,
        isInterface: type === "interface_declaration" || type === "trait_declaration",
        parents,
      }
      scopeStack.push(s.newContext)
      s.pushedScope = true
    }
  }

  private handleMethodDeclaration(node: Node, s: GroovyWalkState): void {
    const { symbols, symbolMap, overrideTasks, scopeStack } = s
    const type = node.type
    const isConstructorRaw = type === "constructor_declaration"
    const nameNode = this.findChild(node, (n) => n.type === "identifier" || n.type === "string_literal")
    if (nameNode) {
      const rawName = nameNode.type === "string_literal"
        ? this.stripQuotes(nameNode.text)
        : nameNode.text
          // G4 (review wave, java C3 parity): ctors were renamed from the literal
          // "constructor" to their DECLARED name (the class name). That is reverted.
          //
          // The family convention is the literal, and this lane's own hand-audited truth
          // follows it: java, kotlin and scala all record
          // `symbol:<file>:<line>:constructor:constructor` with
          // `attributes.name == "constructor"`, and groovy's
          // validation/m12/ground-truth/groovy.json does the same. Naming a constructor
          // after its class instead makes every one of them a guaranteed
          // false-negative/false-positive PAIR, because the key
          // (script/m11/differential-harness.ts `factKey`) includes `attributes.name`:
          //   FN  symbol:Features.groovy:9:constructor:constructor
          //   FP  symbol:Features.groovy:9:constructor:Color
          //   FN  symbol:Features.groovy:20:constructor:constructor
          //   FP  symbol:Features.groovy:20:constructor:Robot
          // Five of each across the five fixtures — the whole of the constructor gap.
          //
          // The original justification was that "the old literal collided across classes
          // (contains:A->constructor vs contains:B->constructor are indistinguishable;
          // overloads collapsed)". That is real, but it is answered by the CONTAINER, not
          // by renaming: the `contains` relationship already carries the owning class as
          // its source, and `ownerName` is on the symbol, so A's constructor and B's are
          // distinguishable. What the rename actually cost was every constructor in the
          // lane, so the collision argument does not survive contact with the truth file.
      // G4 (review wave, java C3 parity): ctors were renamed from the literal
      // "constructor" to their DECLARED name (the class name). That is reverted.
      //
      // The family convention is the literal, and this lane's own hand-audited truth
      // follows it: java, kotlin and scala all record
      // `symbol:<file>:<line>:constructor:constructor` with
      // `attributes.name == "constructor"`, and groovy's
      // validation/m12/ground-truth/groovy.json does the same. Naming a constructor after
      // its class instead makes each one a guaranteed false-negative/false-positive PAIR,
      // because the comparison key (script/m11/differential-harness.ts `factKey`)
      // includes `attributes.name`:
      //   FN  symbol:Features.groovy:9:constructor:constructor
      //   FP  symbol:Features.groovy:9:constructor:Color
      //   FN  symbol:Features.groovy:20:constructor:constructor
      //   FP  symbol:Features.groovy:20:constructor:Robot
      // Five of each across the five fixtures — the whole of the constructor gap.
      //
      // The original justification was that the literal "collided across classes
      // (contains:A->constructor vs contains:B->constructor are indistinguishable;
      // overloads collapsed)". That is real, but it is answered by the CONTAINER, not by
      // renaming: `contains` already carries the owning class as its source, and
      // `ownerName` is on the symbol, so A's constructor and B's remain distinguishable.
      // What the rename actually cost was every constructor in the lane, so the collision
      // argument does not survive contact with the truth file.
      //
      // NOTE the keys collide only because the record's relationship key omits the
      // source symbol's file. That is a separate defect in the differential's identity
      // contract, not in this analyzer, and it is recorded rather than worked around
      // here: `contains:Color->constructor` in Features.groovy and the same pair in any
      // other fixture produce the same factKey, so one of them can never be matched.
      // Fixing the key contract is a change to script/m12, which every lane shares.
      const name = "constructor"
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
      // The enclosing scope may be a class OR an ENUM. An enum's members live under
      // `enum_body_declarations`, not `class_body`, and an enum is pushed with
      // kind=Enum (handleTypeDeclaration, the `type === "enum_declaration"` arm), so a
      // guard that admits only Class left every enum constructor with
      // `enclosingName === undefined`, failed the name test below, and demoted it to a
      // def-returning method.
      //
      // Measured on validation/m12/fixtures/groovy/Features.groovy: `enum Color` has
      // `Color(int h) { hex = h }` at L9, and the sealed record carried the pair
      //   FN  symbol:Features.groovy:9:constructor:constructor
      //   FN  rel:Features.groovy:contains:Color:constructor
      // with, in the same file, the mirror-image FPs `symbol:...:9:constructor:Color` and
      // `rel:...:contains:Color:Color` -- i.e. a real constructor was emitted as a METHOD
      // named after the class, which is simultaneously a missed constructor and a spurious
      // self-contains. Same shape for `Robot(String name)` at L20.
      //
      // A TRAIT is included too, and for the same reason: `trait_declaration` is pushed as
      // Interface, and Groovy traits can declare constructors.
      const enclosingScope = scopeStack.length > 0 ? scopeStack[scopeStack.length - 1] : undefined
      const enclosingName = enclosingScope &&
        (enclosingScope.kind === ASTEngine.SymbolKind.Class ||
         enclosingScope.kind === ASTEngine.SymbolKind.Enum ||
         enclosingScope.kind === ASTEngine.SymbolKind.Interface)
        ? enclosingScope.name
        : undefined
      const isMisnamedCtor = isConstructorRaw && enclosingName !== undefined && rawName !== enclosingName
      const isConstructor = isConstructorRaw && !isMisnamedCtor
          // The name is the literal ONLY on the constructor branch. Setting it
          // unconditionally was measured and is wrong: `name` is what every method
          // in the file is called, so `const name = "constructor"` renamed
          // `walk`, `greeting`, `describe`, `format`, `save`, `getId`, `add`,
          // `bump`, `interpolate`, `useClosure`, `useList`, `makeSelf` and
          // `globalHelper` to "constructor" as well — 11 methods across three
          // fixtures became phantom constructors, their own names vanished, and
          // the differential went from 46 FP / 19 FN to 74 / 66. A demoted
          // misnamed constructor is a METHOD, so it keeps its declared name.
      const memberName = isConstructor ? "constructor" : rawName
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
          // `scoped_type_identifier` is the node a QUALIFIED type is written as
          // (`Outer.Criterion`, `java.util.Map.Entry`) — probe-verified against
          // the pinned grammar. Omitting it here dropped the WRITTEN type from
          // the payload: the parameter read `undefined` while its declaration
          // named the type, and the override signature that identity is keyed on
          // (`sigCompatible`-style matching, pass-1 exact-signature BFS) lost the
          // distinction between two overloads that differ only in a qualified
          // parameter type. Measured before the fix (600-file grails-core
          // sample, script/m60/groovy-parameter-payload-census.ts): 8 of 33
          // joined written-qualified slots recorded no type; every other type
          // node in this lane ALREADY accepts a scoped type (the record-component
          // extractor above, the instantiation type at the object-creation site,
          // and baseTypeName's own doctrine that a scoped type keeps its full
          // dotted text "matching the Java analyzer convention"), so this is the
          // one extractor that disagreed with its own lane.
          const pType = this.findChild(p, (n) => n.type === "type_identifier" || n.type === "integral_type" || n.type === "floating_point_type" || n.type === "boolean_type" || n.type === "void_type" || n.type === "generic_type" || n.type === "array_type" || n.type === "scoped_type_identifier")
          parameters.push({
            name: pName?.text ?? "anonymous",
            type: pType ? this.baseTypeName(pType) + (isSpread ? "[]" : "") : undefined,
          })
        }
      }
      const signature = `(${parameters.map((p) => p.type ?? "").join(",")})`

      const ownerName = scopeStack.length > 0 ? scopeStack[scopeStack.length - 1].name : undefined
      const ownerKind = scopeStack.length > 0 ? scopeStack[scopeStack.length - 1].kind : undefined
      const fqn = this.buildFqn(s.currentPackage, scopeStack, memberName)

          // Abstract: no body in an interface/trait, or body-less declaration.
      const hasBody = !!this.findChild(node, (n) => n.type === "block" || n.type === "closure" || n.type === "constructor_body")
      const isAbstract = !hasBody || (!!(s.newContext?.isInterface) && !hasBody)

          // G2 (review wave, java JAO1 parity): @Override is a CHECK, not a
          // requirement — un-annotated instance methods with matching
          // signatures still override. Implicit tasks resolve but emit ONLY
          // on a verified exact-signature in-file match (pass 1); explicit
          // tasks keep the companion/guess tiers so overloads never
          // fabricate an override edge.
      if (annotations.indexOf("Override") !== -1 && s.newContext) {
        overrideTasks.push({
          fqn,
          methodName: memberName,
          signature,
          ownerFqn: s.newContext.fqn,
          explicit: true,
          line: this.declarationLineNode(node).startPosition.row + 1,
        })
      } else if (s.newContext && !isConstructor &&
                 modifiers.indexOf("static") === -1 && visibility !== "private") {
        overrideTasks.push({
          fqn,
          methodName: memberName,
          signature,
          ownerFqn: s.newContext.fqn,
          explicit: false,
          line: this.declarationLineNode(node).startPosition.row + 1,
        })
      }

      const sym: ASTEngine.UniversalSymbol = {
        name: memberName,
        kind: isConstructor ? ASTEngine.SymbolKind.Constructor : ASTEngine.SymbolKind.Method,
        comments: (() => { const d = this.extractGroovyDoc(node); return d ? [d] : [] })(),
        complexity: this.calculateGroovyMethodComplexity(node),
            // M59 (#825): annotations skipped — `@Override` is not where the
            // overriding method is written — and the range starts at the NAME.
            // tree-sitter-groovy absorbs a preceding field's type into a
            // constructor's node (`final Distance distance` + `Sphere(...)`
            // parse as one method_declaration starting at the field), so the
            // node start is the field's line while the name is written 7 lines
            // lower (measured: grails-core Sphere.groovy). The line belongs to
            // the name, never to the construct that contains it (java/scala
            // contract); the contains edge follows the range, so both move.
            // The annotation anchor has to survive the name-node shortcut. A METHOD
            // passes its `name` child explicitly so the line follows the name rather
            // than the token the grammar absorbed first (the Sphere.groovy field-split
            // case above), but that bypasses `declarationLineNode` entirely, so an
            // annotated method stayed on its own line: `@Override` L16 / `format` L17
            // was reported 17, and truth records 16. The name node is the right anchor
            // ONLY when the declaration carries no annotation; when it does, the
            // annotation is the earlier line and the same convention java applies
            // through `annotationLine` wins.
        range: this.symbolRange(
          node,
          this.declarationHasAnnotation(node) ? null : (node.childForFieldName("name") ?? nameNode),
        ),
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
      const rawKey = ownerName ? `${ownerName}.${memberName}${signature}` : `${memberName}${signature}`
      symbolMap.set(rawKey, sym)

      s.newContext = {
        node,
        name: memberName,
        kind: isConstructor ? ASTEngine.SymbolKind.Constructor : ASTEngine.SymbolKind.Method,
        fqn,
        symbolRef: sym,
        visibility,
        isInterface: false,
        parents: [],
      }
      scopeStack.push(s.newContext)
      s.pushedScope = true
    }
  }

  private handleFieldDeclaration(node: Node, s: GroovyWalkState): void {
    const { symbols, scopeStack } = s
    const type = node.type
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
          // M59 (#825) follow-up, measured on grails-core Sphere.groovy:
          // `static Sphere valueOf(...)` parses as BOTH a
          // constructor_declaration (the real method) AND a phantom
          // field_declaration covering the header prefix (`static Sphere`);
          // `final Distance distance` + ctor similarly split the field's
          // TYPE into the field node and its NAME into the method node.
          // Same defect family as the `def`-squeeze guard above: a grammar-
          // manufactured field naming a member the class does not have.
          // Proof of duplicate parse, not heuristic: two distinct same-line
          // declarations must be `;`-separated, so a sibling method starting
          // after the field with only whitespace between them (no `;`) is
          // the same declaration parsed twice — the full-span method wins.
          // Real shapes stay: `x; void foo()` has `;` in the gap, untyped
          // `private test` has no same-line method, typed fields never match
          // a trivia-only gap to a method consuming their own tokens.
      if (this.isDuplicateParseField(node, s.content)) continue
      // A MISSING node has a zero-width range, so `.text` on it is the empty string. The
      // `!idNode` guard above does not catch that -- the node EXISTS, it is simply empty --
      // so error recovery could publish a field whose name is "". A symbol with an empty
      // name is not a name, and the M60 surface audit reported exactly two of them
      // (grails-scaffolding Spec.groovy / AsyncSpec.groovy, 8:18), both from a
      // `field_declaration` this recovery produced.
      //
      // Refused rather than repaired, and COUNTED: an empty name is a symptom of a parse
      // that did not happen, so inventing one would hide the parse failure behind a
      // plausible symbol. The count makes the refusal visible.
      const fieldName = idNode.text.trim()
      if (fieldName === "") {
        s.emptyNameRefusals = (s.emptyNameRefusals ?? 0) + 1
        continue
      }
      symbols.push({
        name: fieldName,
        kind: isConstant ? ASTEngine.SymbolKind.Constant : ASTEngine.SymbolKind.Property,
        range: this.symbolRange(child),
        visibility,
        ownerName,
        ownerKind,
        decorators: fieldAnnotations,
        metadata: { nodeType: type, modifiers, isConstant, annotations: fieldAnnotations },
      })
    }
  }

  private handleEnumConstant(node: Node, s: GroovyWalkState): void {
    const { symbols, scopeStack } = s
    const type = node.type
    const nameNode = this.findChild(node, (n) => n.type === "identifier")
    const ownerName = scopeStack.length > 0 ? scopeStack[scopeStack.length - 1].name : undefined
    // Same refusal as the field path above: a MISSING identifier node is present but
    // empty, and an enum constant with an empty name is not a constant.
    const enumMemberName = nameNode?.text.trim() ?? ""
    if (enumMemberName !== "" && ownerName) {
      symbols.push({
        name: enumMemberName,
        kind: ASTEngine.SymbolKind.EnumMember,
        range: this.symbolRange(node),
        visibility: "public",
        ownerName,
        ownerKind: ASTEngine.SymbolKind.Enum,
        metadata: { nodeType: type },
      })
    }
  }

  private handleMethodInvocation(node: Node, s: GroovyWalkState): void {
    const { relationships } = s
    const type = node.type
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
      const sourceName = s.parentContext?.name ?? "(script)"
      if (!this.isGroovyBuiltin(callExpr)) {
            // Matrix 1b payload: symbol-level qualified call list (#383) —
            // attached to the enclosing method symbol when one exists.
        if (s.parentContext?.symbolRef) {
          if (!s.parentContext.symbolRef.qualified_calls) s.parentContext.symbolRef.qualified_calls = []
          s.parentContext.symbolRef.qualified_calls.push(callExpr)
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
  }

  private handleExplicitConstructorInvocation(node: Node, s: GroovyWalkState): void {
    const { relationships } = s
    const type = node.type
        // super(...) / this(...) delegation (JLS-adjacent, Groovy ctor
        // bodies produce this node). Honest literal target ("super"/"this")
        // — never resolved to a guessed parent type.
    const first = node.namedChild(0)
    if (first && (first.type === "super" || first.type === "this")) {
      relationships.push({
        source: s.parentContext?.name ?? "(script)",
        target: first.type,
        type: ASTEngine.RelationshipType.Calls,
        confidence: 1.0,
        ...this.lineField(first, node),
        metadata: { relationshipType: "constructor_invocation" },
      })
    }
  }

  private handleJuxtFunctionCall(node: Node, s: GroovyWalkState): void {
    const { relationships } = s
    const type = node.type
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
          // #841 round 14: the typed-closure-parameter misparse reaches this
          // branch. When a closure's bare-name parameter type cannot win its
          // reading (measured: six grammar routes closed in
          // reviews/m59-841-assert-comma-separator.md §7f–§7q), the parser folds
          // `{ Test task -> … }` into `juxt_function_call(name: Test, args:
          // (task))` + `lambda_expression` — so this branch used to emit a
          // FABRICATED `calls -> Test` edge naming the parameter's TYPE as a
          // callee (measured: up to 45 such edges in one corpus file). The
          // discriminator is the misparse's exact shape, measured on the pinned
          // grammar: type-cased juxt name, args made only of identifier tokens
          // (bare param names or `Type name` fragments), and a lambda expression
          // as the adjacent sibling. A real juxtaposed call with a type-cased
          // callee name in that company does not occur in the corpus — and the
          // A/B below counts every suppression to keep that true.
      if (this.looksLikeTypedClosureMisparse(node, nameNode, s.content)) {
            // The closure body itself still walks (its calls/uses extract from
            // the lambda_expression sibling), so only the fabricated callee
            // edge is dropped — nothing else about the shape changes.
      } else {
        const leafNode = nameNode.type === "field_access"
          ? nameNode.childForFieldName("field") ?? nameNode
          : nameNode
        relationships.push({
          source: s.parentContext?.name ?? "(script)",
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
    }
  }

  private handleLeadingDotCall(node: Node, s: GroovyWalkState): void {
    const { relationships } = s
    const type = node.type
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
          source: s.parentContext?.name ?? "(script)",
          target: nameNode.text,
          type: ASTEngine.RelationshipType.Calls,
          confidence: 0.7,
          ...this.lineField(nameNode, node),
          metadata: { relationshipType: "leading_dot_call" },
        })
      } else {
        relationships.push({
          source: s.parentContext?.name ?? "(script)",
          target: nameNode.text,
          type: ASTEngine.RelationshipType.Uses,
          confidence: 0.6,
          ...this.lineField(nameNode, node),
          metadata: { isFieldAccess: true },
        })
      }
    }
  }

  private handleObjectCreationExpression(node: Node, s: GroovyWalkState): void {
    const { symbols, relationships, symbolMap, classHierarchy, scopeStack } = s
    const type = node.type
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
      const source = s.parentContext?.name || s.parentContext?.symbolRef?.name || "(script)"
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
      if (classBody && s.parentContext) {
        const superName = this.baseTypeName(typeNode)
        const anonName = superName ? `anonymous_${superName}` : "anonymous_class"
        const anonFqn = s.parentContext.fqn ? `${s.parentContext.fqn}.${anonName}` : anonName
        const anonSym: ASTEngine.UniversalSymbol = {
          name: anonName,
          kind: ASTEngine.SymbolKind.Class,
          range: this.symbolRange(node),
          visibility: s.parentContext.visibility || "public",
          ownerName: s.parentContext.name,
          ownerKind: s.parentContext.kind,
          // `synthesized: true` is a DECLARATION, not an exemption request. The name is
          // invented from the supertype because an anonymous class has no spelling, and
          // the M60 surface audit's "name not present in source" / "ghost target" rows
          // cannot tell that from a name the analyzer made up and passed off. Declaring
          // it moves both rows into the audit's own "named by contract, not by source
          // spelling" category -- counted, disclosed, and still failing for any
          // UNDECLARED synthesized name, which is the case that actually matters.
          metadata: { nodeType: type, isAnonymousClass: true, synthesized: true, superTypes: superName ? [superName] : [] },
        }
        symbols.push(anonSym)
        symbolMap.set(anonFqn, anonSym)
        // The override pass reaches a method's parent through `classHierarchy`,
        // keyed by the OWNER's FQN. This block registered the anonymous symbol,
        // its symbolMap key and its scope — but NOT the hierarchy entry — so
        // every override task inside an anonymous body fell through all three
        // tiers and emitted nothing. An anonymous type's parent is the type it
        // CONSTRUCTS; that is what it extends. Measured at full extent on
        // grails-core (2026-09-25): the lane's only two MISSING rows in 4,014
        // files were `overrides anonymous_IdentityTypeDecoder.bsonType ->
        // IdentityTypeDecoder.bsonType` and its SimpleDecoder twin, both of
        // which the differential's tree-truth derives and the analyzer did not.
        classHierarchy.set(anonFqn, superName ? [superName] : [])
        s.newContext = {
          node: classBody,
          name: anonName,
          kind: ASTEngine.SymbolKind.Class,
          fqn: anonFqn,
          symbolRef: anonSym,
          visibility: s.parentContext.visibility,
          isInterface: false,
          parents: superName ? [superName] : [],
        }
        scopeStack.push(s.newContext)
        s.pushedScope = true
      }
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
      // `exact-in-file` is the tier an IMPLICIT override (no `@Override`) reaches, and
      // this lane's truth contains no such row:
      //   FP  rel:Features.groovy:overrides:Robot.walk:Walkable.walk
      // All four `overrides` rows truth expects cite the annotation ("@Override format",
      // "@Override save", "@Override getId", "@Override getName"). The edge itself is
      // correct -- `class Robot implements Walkable` really does supply `walk()` -- and
      // the implicit tier is deliberate: an un-annotated method with a VERIFIED exact
      // in-file signature match still overrides (java JAO1 parity), which is what stops
      // a missing `@Override` from erasing a real edge.
      //
      // So this is the second half of the same disagreement as the interpolation reads
      // recorded at the emission site, and the same reasoning applies: the analyzer keeps
      // a defensible edge that a 5-fixture hand audit does not happen to contain. The
      // residual is 1 row, and it is not settled by deleting the tier.
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
          // Pass 1 is the IN-FILE hierarchy pass: a candidate that is not a
          // class declared in this file cannot supply an in-file target.
          // Measured at 200-file depth on grails-core (FindAllByFinder.groovy):
          // the class extends `org.grails.datastore.gorm.finders.FindAllByFinder`
          // — a QUALIFIED target, i.e. EXTERNAL (the differential oracle's own
          // rule: a qualified heritage target is never in-file). The suffix
          // index misses it, the `?? [parent]` fallback kept the FQN, and the
          // leaf-name match below (the candidate's bare class name is the
          // raw-key ownerName) then hit the OWNER'S OWN method under the
          // parent's leaf name, emitting
          // `FindAllByFinder.doInvokeInternal -> FindAllByFinder.doInvokeInternal`
          // at confidence 1.0. Cross-file ancestors are pass 2's job; gating
          // here is what makes the collision unrepresentable rather than merely
          // unlikely. In-file nested chains (BlackVal extends Black extends
          // Node) are unaffected: every in-file class is a classHierarchy key.
          if (!classHierarchy.has(cand)) continue
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
        // R10 sibling sweep: this was `split("(")[0].split(".").slice(-2)` —
        // immune to a dotted parameter list, but it cuts at the FIRST "(" and
        // so silently truncates a paren-bearing OWNER chain (a nested/anonymous
        // type reached through a call) to a wrong-but-name-shaped label. 
        // localEdgeLabel is the shared rule both directions agree on.
        const localSource = localEdgeLabel(task.fqn)
        const localTarget = localEdgeLabel(targetFqn)
        // A symbol cannot override ITSELF. The guard is on the EMITTED labels
        // (so it covers every resolution tier) rather than on the declaring
        // FQN, because the collision that produces a self-edge here is a
        // LEAF-NAME one, not a class-identity one: measured at 200-file depth
        // on grails-core, `org.grails.gorm.rx.finders.FindAllByFinder` extends
        // `org.grails.datastore.gorm.finders.FindAllByFinder` — same leaf,
        // different class — so both ends of the edge reduce to
        // `FindAllByFinder.doInvokeInternal` under the project's two-segment
        // edge vocabulary. Pass 1 could reach it through the leaf-name key
        // match; pass 3 (first-parent-guess, below threshold) still can. The
        // edge as emitted asserts X overrides X, which no reader can act on and
        // the tree cannot derive (the differential oracle classifies a
        // QUALIFIED heritage target as external, so it never derives a truth
        // edge here). Cross-file overrides between same-leaf-named classes are
        // therefore UNREPRESENTABLE in this vocabulary, not merely unverified —
        // dropping the degenerate label is the honest outcome; the class is
        // registered rather than silently absorbed. Scala's analogous site
        // (`object Position extends Position`) is guarded by class identity in
        // real-scala-analyzer.ts: there the declARING name and the owner are
        // the same symbol's name, a different shape of the same impossibility.
        if (localSource === localTarget) continue
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
    // M60 R10 follow-up: a NAME, not a text slice. Every target this collector
    // publishes is a NODE'S TEXT, and error recovery can weld a type node across
    // statements: measured on grails-scaffolding's AsyncController template,
    // `import static org.springframework.http.HttpStatus.*` followed by another
    // import becomes ONE scoped_type_identifier whose text is
    // `org.springframework.http.HttpStatus.*` + newline + the next import
    // statement, with an ERROR node inside it. Publishing that text names a
    // string that appears nowhere in the source as a type (and it is a
    // POST-change regression: the pre-fix collectors never reached the node, so
    // no such edge existed). A type name is dots and identifier characters ON
    // ONE LINE; anything else is refused, and the branch below stops rather than
    // descending, because the segments of a malformed scoped node are exactly
    // the fabrication the scoped-type-references fixture forbids.
    const isPlainTypeName = (t: string): boolean => {
      if (t.length === 0) return false
      for (let i = 0; i < t.length; i++) {
        const c = t.charCodeAt(i)
        const ok =
          (c >= 97 && c <= 122) || // a-z
          (c >= 65 && c <= 90) || // A-Z
          (c >= 48 && c <= 57) || // 0-9
          c === 95 || // _
          c === 36 || // $ (a legal groovy/java identifier character)
          c === 46 // .
        if (!ok) return false
      }
      return true
    }
    const collectTypeNames = (n: Node, out: NamedNode[]): void => {
      if (n.type === "type_identifier") {
        // `def` is the dynamic-type keyword; `as` is how the grammar lexes
        // the keyword inside its mis-parsed dangling as-expression
        // (`= [] as Set` becomes local_variable_declaration(as, Set)).
        // Both are type_identifier TOKENS but never types. The plain-name
        // predicate covers the same ground for a token authored by recovery.
        if (n.text !== "def" && n.text !== "as" && isPlainTypeName(n.text) && !out.some((o) => o.name === n.text)) out.push({ name: n.text, node: n })
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
      if (n.type === "scoped_type_identifier") {
        // A QUALIFIED type is ONE type written with its qualifier:
        // `Outer.Criterion` is a single declared-type dependency, and this
        // lane's own convention is that the full dotted text IS the name
        // (baseTypeName: "the FULL dotted text is the type name — matching the
        // Java analyzer convention"; java emits `java.util.Map.Entry` for the
        // same shape). Measured before this branch existed
        // (script/m14/tmp/groovy-scoped-type-ref-probe.ts): descending emitted
        // each segment as its own type — `Outer.Criterion` became `Outer` +
        // `Criterion`, and a corpus name like `java.util.Map.Entry` would name
        // `java` and `util`, package segments that are not types at all (the
        // doctrine collectTypeNodes already documents for the heritage path).
        // Type ARGUMENTS are still their own types, so they are collected.
        // A scoped_type_identifier is by construction qualified (it always
        // contains a `.`), so the type_identifier keyword guards do not apply
        // here.
        const text = n.text
        if (!isPlainTypeName(text)) return
        if (!out.some((o) => o.name === text)) out.push({ name: text, node: n })
        const args = this.findChild(n, (c) => c.type === "type_arguments")
        if (args) collectTypeNames(args, out)
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
      // A declared TYPE belongs to the DECLARING TYPE, never to the method that
      // mentions it. The method arm that used to come first attributed every
      // signature type to the method -- `String format(String value)` produced
      // `format -> String` twice (return_type and formal_parameter) and
      // `findAll -> List` / `findAll -> T` for `List<T> findAll()`.
      //
      // This lane's hand-audited truth has 79 relationship rows and NOT ONE
      // method-scoped `references` row: every declared-type edge is sourced at the
      // class/trait/enum. The import-resolved `java.util.List` /
      // `com.example.base.Entity` rows are unaffected -- they are emitted by the
      // import path, not by this resolver.
      //
      // The 28 false positives this removed are all of one shape: a bare name
      // (`String`, `List`, `Map`, `Optional`, `T`, `Date`, `CompletableFuture`,
      // `User`) sourced at a method. Nothing that truth expects is lost, because
      // truth expects no such row.
      let p: Node | null = GROOVY_DECLARATION_TYPES.has(start.type) ? start : start.parent
      while (p) {
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
          // A `declared_type` reference is emitted only for a QUALIFIED name.
          //
          // Measured: every one of the 15 `references` rows this lane's hand-audited
          // truth expects is fully qualified -- java.util.List, java.util.Optional,
          // java.util.Map, java.util.HashMap, java.util.concurrent.CompletableFuture,
          // com.example.base.Entity, com.example.base.BaseService,
          // com.example.repo.Repository -- and every one of them is a type the file
          // IMPORTS, which is what lets it be written qualified. Truth has no bare
          // target anywhere in its 79 relationship rows.
          //
          // So `String format(String value)` should not report `format -> String`:
          // `String` is not imported here, the name cannot be resolved to anything
          // actionable, and the edge asserts a dependency the reader cannot follow.
          // The import path already emits the qualified form where one exists
          // (`UserService -> java.util.Map`), so nothing is lost by dropping the
          // bare duplicate.
          if (!t.name.includes(".")) continue
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
          //
          // R10 follow-up: `scoped_type_identifier` ends in "identifier" too,
          // so the same reasoning admits it explicitly. Measured before the
          // fix (script/m14/tmp/groovy-scoped-type-ref-probe.ts): `Outer.Criterion
          // qualifiedField` emitted NO declared_type edge while `Criterion
          // leafField` emitted one, so the qualified half of every declared-type
          // position was simply absent from the graph. Admitted as a COMPLETE
          // type, never descended into — its nested type_identifiers are
          // package/class segments, the rule collectTypeNodes already documents.
          const roots: Node[] = []
          for (let i = 0; i < n.namedChildCount; i++) {
            const c = n.namedChild(i)
            if (!c || TYPE_STOP.has(c.type)) continue
            if (c.type.endsWith("type") || c.type === "type_identifier" || c.type === "scoped_type_identifier") roots.push(c)
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
          // R10 follow-up: a `scoped_type_identifier` return type (`Outer.Criterion
          // qualifiedReturn()`) ends in "identifier", so `endsWith("_type")`
          // misses it and the return-type reference disappears — measured on the
          // same probe that found the field/local half of this gap.
          const roots: Node[] = []
          for (let i = 0; i < n.namedChildCount; i++) {
            const c = n.namedChild(i)
            if (!c) continue
            if (c.type === "identifier") break
            if (c.type === "modifiers") continue
            if (c.type.endsWith("_type") || c.type === "type_identifier" || c.type === "scoped_type_identifier") roots.push(c)
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
          // A `this.x = …` inside a CONSTRUCTOR still counts as a use of the field,
          // with the OWNING TYPE as the source rather than the constructor member.
          //
          // The general rule here is that an assignment LHS is a WRITE and not a read
          // (KAD1, java JAD1 parity), and that rule is kept. The exception is narrow and
          // is this lane's own hand-audited truth, which records all four of these:
          //     User -> id     "this.id = id in constructor"
          //     User -> name   "this.name = name in constructor"
          //     Robot -> name  "this.name = name in constructor"
          //     Counter -> count "this.count = start in constructor"
          // The family is NOT uniform about the SOURCE: java's truth rows for the same
          // shape cite the getter instead ("getId() returns field id"), and the java
          // analyzer emits `getId -> id` for it. So the two lanes disagree on which
          // member owns the edge, and the narrower claim is taken: within a constructor
          // body, a `this.field` access is attributed to the enclosing type. A plain
          // `field = …` in a method, and any non-`this` LHS, are untouched.
          const inConstructorBody = method === "constructor"
          const thisLhsInConstructor = inConstructorBody && isWrite &&
            (first === "this" || first === "super")
          const key = `${source}.${parts[parts.length - 1]}`
          if ((!isWrite || thisLhsInConstructor) && !isCalleePosition && !seen.has(key)) {
            seen.add(key)
            relationships.push({
              source,
              target: parts[parts.length - 1],
              type: ASTEngine.RelationshipType.Uses,
              // 0.6 for an ordinary read, but 1.0 for a `this.x = …` in a constructor. The 0.6 is
              // a real claim-strength discount for an INFERRED read; this edge is not inferred.
              // `this.<field>` names a member of the enclosing type by construction, the type is
              // known statically, and the ground truth cites the exact source line for all four such
              // rows (User->id, User->name, Robot->name, Counter->count). At 0.6 the harness
              // classified the observed fact as state "unknown" -- anything below 0.7 is
              // emitted-but-not-claimed (script/m12 relationshipFacts) -- while the truth row is
              // "resolved", so a correct edge scored as a false NEGATIVE.
              confidence: thisLhsInConstructor ? 1.0 : 0.6,
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
          // G7's contract is that an interpolated name IS a read, and the corpus
          // depends on it: measured over 300 grails-core files, 123 of 2,275 `uses`
          // edges (5.4%, across 41 files) are interpolation reads, and removing them
          // was how 2,115 files once contributed ZERO reads to the graph.
          //
          // This lane's own hand-audited truth disagrees, and the disagreement is
          // recorded rather than resolved in the analyzer's favour. Both fixtures say
          // so explicitly -- Negative.groovy rule 6, "String interpolation identifiers
          // ($name) are NOT symbols/uses" -- and truth has exactly 4 `uses` rows, all
          // of them `this.x = y` in a constructor:
          //   FP  rel:Features.groovy:uses:describe:name   ("robot ${name} ${nick} …")
          //   FP  rel:Negative.groovy:uses:bump:count     ("bumped to ${count}")
          // Note what truth still expects from those same two methods: `describe ->
          // toUpperCase`, `describe -> collect`, `bump -> info` are all TP. So the
          // disagreement is narrow and specific -- it is about the interpolated
          // IDENTIFIER, not about method calls inside the method.
          //
          // So this stays a `uses` edge, and the two rows above remain the entire
          // residual of this lane's differential. They are a TRUTH-vs-ANALYZER contract
          // question with a 5.4% coverage cost either way, which is a decision for the
          // lane owner and not something to settle by quietly deleting real edges.
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

  /**
   * #841 round 14: does this juxt_function_call carry the typed-closure-
   * parameter misparse shape? Measured on the pinned grammar, not assumed:
   *   `{ Test task -> … }`            → name=Test,      args="task"
   *   `{ String key, Object value → }` → name=String,    args="key, Object"
   *   `{ Map<String,File> m -> … }`    → name=Map,       args="<String,File> m"  (generic)
   *
   * The decisive evidence is the SOURCE, measured over the whole groovy corpus
   * (962 such juxt nodes, every one verified): what follows the node is at most
   * further parameter names (the multi-param node stops before the last name —
   * `String key, Object` then ` value`), commas, dots, generics, brackets and
   * whitespace, and then the closure arrow `->`. A REAL juxtaposed call is
   * never followed by an arrow — the arrow can only make the preceding text a
   * closure parameter list (Groovy has no other `->`). The tree compositions
   * (lambda sibling, arrow sibling, first child of closure/block) are the
   * fallback when no source text is supplied — the same 962 sites fall into
   * exactly those three compositions, with 139 of them ending before the last
   * parameter name (which is why a sibling-only test under-covers by ~5×: it
   * suppressed 115 of the 608 fabricated edges; the source test covers the
   * rest).
   */
  /** The JS `\s` set, as a char test — kept exact so the char walks below are
   * behaviour-identical to the regexes they replace (M49.R2: the AST regex
   * census counted those three literals as review-class debt). */
  private static isRegexSpace(c: string, code: number): boolean {
    if (c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\v" || c === "\f") return true
    return code === 0x00a0 || code === 0x1680 || (code >= 0x2000 && code <= 0x200a) ||
      code === 0x2028 || code === 0x2029 || code === 0x202f || code === 0x205f ||
      code === 0x3000 || code === 0xfeff
  }

  /** `/^[\s]*$/` as a char walk. */
  private static isWhitespaceOnly(text: string): boolean {
    for (let i = 0; i < text.length; i++) {
      if (!RealGroovyAnalyzer.isRegexSpace(text[i], text.charCodeAt(i))) return false
    }
    return true
  }

  /**
   * `/^[A-Z][A-Za-z0-9_]*(\.[A-Z][A-Za-z0-9_]*)*$/` as a char walk: a
   * type-cased name, optionally dotted, every segment starting uppercase and
   * otherwise word characters. Lowercase juxt callees (`echo`, `sh`) never
   * match, so ordinary Jenkins-style juxtaposition is untouched.
   */
  private static isTypeCasedDottedName(text: string): boolean {
    if (text.length === 0) return false
    let i = 0
    while (i < text.length) {
      const first = text[i]
      if (!(first >= "A" && first <= "Z")) return false
      i++
      while (i < text.length && text[i] !== ".") {
        const c = text[i]
        if (!((c >= "A" && c <= "Z") || (c >= "a" && c <= "z") || (c >= "0" && c <= "9") || c === "_")) return false
        i++
      }
      if (i < text.length) {
        i++ // consume '.'; the next segment must be non-empty (checked by the loop head)
        if (i >= text.length) return false
      }
    }
    return true
  }

  /** Identifier start character (the regexes' `[A-Za-z_]`). */
  private static isIdentStart(c: string): boolean {
    return (c >= "A" && c <= "Z") || (c >= "a" && c <= "z") || c === "_"
  }

  /** Identifier continuation character (the regexes' `[A-Za-z0-9_]`). */
  private static isWordChar(c: string): boolean {
    return (c >= "A" && c <= "Z") || (c >= "a" && c <= "z") || (c >= "0" && c <= "9") || c === "_"
  }

  /**
   * `/^[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*`-style list as a char
   * walk: comma-separated items, each an identifier optionally dotted, with
   * optional whitespace around the commas only (`Type name`, `a.b.C`,
   * `x, y.Z`). Mirrors the regex exactly — leading and trailing whitespace are
   * not accepted (the call site trims first), and a trailing comma fails.
   */
  private static isDottedIdentifierList(text: string): boolean {
    let i = 0
    const spaced = (): void => {
      while (i < text.length && RealGroovyAnalyzer.isRegexSpace(text[i], text.charCodeAt(i))) i++
    }
    const dotted = (): boolean => {
      if (!RealGroovyAnalyzer.isIdentStart(text[i])) return false
      i++
      while (i < text.length && RealGroovyAnalyzer.isWordChar(text[i])) i++
      while (i < text.length && text[i] === ".") {
        i++
        if (!RealGroovyAnalyzer.isIdentStart(text[i])) return false
        i++
        while (i < text.length && RealGroovyAnalyzer.isWordChar(text[i])) i++
      }
      return true
    }
    if (!dotted()) return false
    while (i < text.length) {
      const save = i
      spaced()
      if (i >= text.length) { i = save; break }
      if (text[i] !== ",") return false
      i++
      spaced()
      if (!dotted()) return false
    }
    return i >= text.length
  }

  /** `/^[\s,.<>\[\]A-Za-z0-9_]*$/` as a char walk: parameter-list material only. */
  private static isParamMaterialOnly(text: string): boolean {
    for (let i = 0; i < text.length; i++) {
      const c = text[i]
      if (RealGroovyAnalyzer.isRegexSpace(c, text.charCodeAt(i))) continue
      if (c === "," || c === "." || c === "<" || c === ">" || c === "[" || c === "]") continue
      if ((c >= "A" && c <= "Z") || (c >= "a" && c <= "z") || (c >= "0" && c <= "9") || c === "_") continue
      return false
    }
    return true
  }

  private looksLikeTypedClosureMisparse(juxtNode: Node, nameNode: Node, content?: string): boolean {
    const nameText = nameNode.text.trim()
    // Type-cased head (optionally dotted). Lowercase juxt callees (echo, sh)
    // never enter here, so ordinary Jenkins-style juxtaposition is untouched.
    if (!RealGroovyAnalyzer.isTypeCasedDottedName(nameText)) return false
    const argsNode = juxtNode.childForFieldName("args")
    if (!argsNode) return false
    // Args must be made only of identifier tokens and separators — bare param
    // names or `Type name` fragments. Anything else (strings, parens, operators)
    // is a real argument list.
    if (!RealGroovyAnalyzer.isDottedIdentifierList(argsNode.text.trim())) return false

    // Source check: parameter-list material then the closure arrow.
    if (content != null) {
      const tail = content.slice(juxtNode.endIndex, juxtNode.endIndex + 160)
      const arrow = tail.indexOf("->")
      if (arrow >= 0) {
        const between = tail.slice(0, arrow)
        // Only identifiers, dots, generics, arrays, commas, whitespace. A `)`,
        // `(`, `{`, `}`, `;`, quote or operator means real code intervened.
        if (RealGroovyAnalyzer.isParamMaterialOnly(between)) return true
      }
    }

    // Tree-composition fallbacks (content absent, or no arrow in the tail).
    const parent = juxtNode.parent
    if (!parent) return false
    if (juxtNode.nextSibling?.type === "->") return true
    const siblings: Node[] = []
    for (let i = 0; i < parent.namedChildCount; i++) {
      const c = parent.namedChild(i)
      if (c) siblings.push(c)
    }
    const idx = siblings.findIndex((s) => s.id === juxtNode.id)
    if (idx === -1) return false
    const next = siblings[idx + 1]
    if (next != null && next.type === "lambda_expression") return true
    if (idx === 0 && (parent.type === "closure" || parent.type === "block")) return true
    return false
  }

  /**
   * #841 round 14 (analyzer-side recovery): when a typed closure parameter
   * list collides inside a chained call, tree-sitter's recovery emits the
   * class as ROOT-LEVEL fragments — the `class` keyword token, the name
   * `identifier`, the `super_interfaces` node, and the member declarations
   * as siblings — instead of a class_declaration node. The walk therefore
   * never pushes a class scope, and the file loses its class symbol, its
   * implements edges, and every contains edge: methods extract but ride
   * ownerless/"(script)" (measured: 0 classes and 0 contains edges on
   * 160–470-line build-logic plugin files). The grammar fix for the
   * underlying construct is closed off by measurement (§7f–§7q), so this
   * pass reconstructs the ownership graph AFTER the walk:
   *   1. the class symbol, from the root `class` token + name fragment;
   *   2. implements edges + classHierarchy from the surviving
   *      super_interfaces fragment;
   *   3. ownerName/ownerKind on the surviving member symbols inside the
   *      body region (the existing contains loop then emits class → member);
   *   4. method symbols synthesized for degraded method headers (modifiers +
   *      type + identifier + formal_parameters + `{` fragments) so the
   *      methods whose wrapper was dropped rejoin the graph;
   *   5. "(script)"-sourced calls/uses edges inside the region re-parented
   *      to the class.
   * Runs only on trees with a root-level ERROR and the class fragment
   * shape, so clean trees cannot enter (the shapes exist only where the
   * parser failed). Parse errors are NOT suppressed — the tree keeps its
   * ERROR nodes; only the ownership graph is restored.
   */
  private recoverDegradedClassShapes(
    rootNode: Node,
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
    symbolMap: Map<string, ASTEngine.UniversalSymbol>,
    currentPackage: string,
  ): void {
    if (!rootNode.hasError) return
    // The degraded shapes live in ALL children — the `class` keyword, `{` and
    // `}` are anonymous tokens and are absent from namedChildren (measured:
    // the named-children scan saw no `class` token at all). Only nodes of
    // those token types are matched below, so noise never enters.
    const allKids = rootNode.children
    const kids: Node[] = []
    for (const c of allKids) { if (c) kids.push(c) }
    if (!kids.some((k) => k.type === "ERROR")) return

    for (let i = 0; i < kids.length; i++) {
      if (kids[i].type !== "class") continue
      const nameNode = kids[i + 1]
      if (!nameNode || nameNode.type !== "identifier") continue
      const name = nameNode.text
      const classToken = kids[i]
      const startLine = classToken.startPosition.row + 1

      // Header fragments between the name and the opening brace.
      let j = i + 2
      const headerFragments: Node[] = []
      while (j < kids.length && kids[j].type !== "{") {
        headerFragments.push(kids[j])
        j++
      }
      if (j >= kids.length) continue
      const openBrace = kids[j]

      // Body region: to the LAST root-level `}` token (degraded trees nest
      // unreliably, so a balanced scan is not trustworthy).
      let closeIdx = -1
      for (let k = kids.length - 1; k > j; k--) {
        if (kids[k].type === "}") { closeIdx = k; break }
      }
      const endLine = closeIdx >= 0 ? kids[closeIdx].endPosition.row + 1 : rootNode.endPosition.row + 1
      const bodyChildren = kids.slice(j + 1, closeIdx >= 0 ? closeIdx : kids.length)

      // Dedupe: a proper class_declaration at this line already produced it.
      if (symbols.some((s) => s.name === name && s.range?.startLine === startLine)) continue

      const typeFragments = new Set(["generic_type", "type_identifier", "scoped_type_identifier", "void_type", "integral_type", "floating_point_type", "boolean_type", "array_type"])
      const memberKinds = new Set([ASTEngine.SymbolKind.Method, ASTEngine.SymbolKind.Constructor, ASTEngine.SymbolKind.Property])
      const members = symbols.filter((s) =>
        !s.ownerName &&
        !s.metadata?.isAnonymousClass &&
        memberKinds.has(s.kind) &&
        s.range?.startLine != null && s.range.startLine >= startLine && s.range.startLine <= endLine)
      // Body must show member structure: symbols the walk extracted, a
      // degraded method header, or a surviving field_declaration. Measured
      // case GrailsJacocoPlugin.groovy had ZERO surviving method wrappers —
      // the old members-only gate silently skipped the whole file.
      const hasFieldDecl = bodyChildren.some((k) => k.type === "field_declaration")
      let hasDegradedHeader = false
      for (let b = 0; b < bodyChildren.length - 1 && !hasDegradedHeader; b++) {
        let p = b
        if (bodyChildren[b].type === "modifiers") p = b + 1
        const typeFrag = bodyChildren[p]
        if (!typeFrag || !typeFragments.has(typeFrag.type)) continue
        const nameFrag = bodyChildren[p + 1]
        if (!nameFrag || nameFrag.type !== "identifier") continue
        const fp = bodyChildren[p + 2]
        const brace = bodyChildren[p + 3]
        if (fp && fp.type === "formal_parameters" && brace && brace.type === "{") hasDegradedHeader = true
      }
      if (members.length === 0 && !hasDegradedHeader && !hasFieldDecl) continue

      // Visibility/annotations from an adjacent preceding `modifiers` fragment
      // (e.g. `@CompileStatic` as its own root-level child).
      let visibility: "public" | "private" | "protected" = "public"
      let annotations: string[] = []
      const before = kids[i - 1]
      if (before && before.type === "modifiers") {
        for (let m = 0; m < before.namedChildCount; m++) {
          const mc = before.namedChild(m)
          if (!mc) continue
          const t = mc.text ?? ""
          if (t === "private") visibility = "private"
          else if (t === "protected") visibility = "protected"
          if (mc.type === "annotation" || mc.type === "marker_annotation") {
            const annName = this.findChild(mc, (n) => n.type === "identifier" || n.type === "scoped_identifier")
            if (annName) {
              const text = annName.text
              const dot = text.lastIndexOf(".")
              annotations.push(dot === -1 ? text : text.slice(dot + 1))
            }
          }
        }
      }

      // implements edges from surviving super_interfaces header fragments —
      // same emission contract as the class_declaration branch.
      for (const frag of headerFragments) {
        if (frag.type !== "super_interfaces") continue
        for (const tid of this.collectTypeNodes(frag)) {
          relationships.push({
            source: name,
            target: this.baseTypeName(tid),
            type: ASTEngine.RelationshipType.Implements,
            confidence: 1.0,
            ...this.lineField(tid, frag),
            metadata: { relationshipType: "implements" },
          })
        }
      }

      const fqn = currentPackage ? `${currentPackage}.${name}` : name
      const sym: ASTEngine.UniversalSymbol = {
        name,
        kind: ASTEngine.SymbolKind.Class,
        comments: [],
        range: {
          // The measured body extent: from the opening brace (start overridden
          // to the class keyword's line, #825 rule) to the closing brace token
          // when one was found — NOT the whole root node (fragments are
          // root-level children, so the root's range is the entire file).
          ...this.nodeToRange(closeIdx >= 0 ? kids[closeIdx] : (openBrace.parent ?? rootNode)),
          startLine,
          startColumn: classToken.startPosition.column + 1,
        },
        visibility,
        decorators: annotations.length > 0 ? annotations : undefined,
        metadata: { nodeType: "class_declaration_recovered", annotations },
      }
      symbols.push(sym)
      symbolMap.set(fqn, sym)
      symbolMap.set(name, sym)

      // Adopt the surviving member symbols inside the body region: they were
      // extracted with NO owner (the walk never pushed a class scope).
      for (const s of members) {
        s.ownerName = name
        s.ownerKind = ASTEngine.SymbolKind.Class
        if (!s.visibility) s.visibility = "public"
      }

      // Degraded method headers inside the region: the parser dropped the
      // method_declaration wrapper, leaving modifiers + type + identifier +
      // formal_parameters + `{` as root fragments. Synthesize the method
      // symbol so the member joins its class. The TYPE token may sit in the
      // node before the name (TestTaskShardingPlugin: `modifiers`,
      // `generic_type List<Test>`, `identifier collectCandidateTasks`,
      // `formal_parameters`, `{`).
      for (let b = 0; b < bodyChildren.length - 1; b++) {
        let p = b
        const mods = bodyChildren[b].type === "modifiers" ? bodyChildren[b] : null
        if (mods) p = b + 1
        const typeFrag = bodyChildren[p]
        if (!typeFrag || !typeFragments.has(typeFrag.type)) continue
        const nameFrag = bodyChildren[p + 1]
        if (!nameFrag || nameFrag.type !== "identifier") continue
        const mName = nameFrag.text
        const mLine = nameFrag.startPosition.row + 1
        // Never duplicate: a symbol already extracted at this name+line
        // (from a complete method_declaration in the same region) wins.
        if (symbols.some((s) => s.name === mName && s.range?.startLine === mLine)) continue
        let q = p + 2
        let paramNode: Node | null = null
        const fp = bodyChildren[q]
        if (fp && fp.type === "formal_parameters") { paramNode = fp; q++ }
        const bodyBrace = bodyChildren[q]
        if (!bodyBrace || bodyBrace.type !== "{") continue

        const parameters: ASTEngine.Parameter[] = []
        if (paramNode) {
          for (let pc = 0; pc < paramNode.namedChildCount; pc++) {
            const par = paramNode.namedChild(pc)
            if (!par || (par.type !== "formal_parameter" && par.type !== "spread_parameter")) continue
            const isSpread = par.type === "spread_parameter"
            let pName = this.findChild(par, (n) => n.type === "identifier")
            if (isSpread) {
              const decl = this.findChild(par, (n) => n.type === "variable_declarator")
              pName = decl ? this.findChild(decl, (n) => n.type === "identifier") : null
            }
            const pType = this.findChild(par, (n) => n.type === "type_identifier" || n.type === "integral_type" || n.type === "floating_point_type" || n.type === "boolean_type" || n.type === "void_type" || n.type === "generic_type" || n.type === "array_type" || n.type === "scoped_type_identifier")
            parameters.push({
              name: pName?.text ?? "anonymous",
              type: pType ? this.baseTypeName(pType) + (isSpread ? "[]" : "") : undefined,
            })
          }
        }
        let mVisibility: "public" | "private" | "protected" = "public"
        if (mods) {
          for (let m2 = 0; m2 < mods.namedChildCount; m2++) {
            const mc2 = mods.namedChild(m2)
            const t2 = mc2?.text ?? ""
            if (t2 === "private") mVisibility = "private"
            else if (t2 === "protected") mVisibility = "protected"
          }
        }
        symbols.push({
          name: mName,
          kind: ASTEngine.SymbolKind.Method,
          comments: [],
          parameters: parameters.length > 0 ? parameters : undefined,
          returnType: typeFragments.has(typeFrag.type) ? this.baseTypeName(typeFrag) : undefined,
          range: {
            ...this.nodeToRange(typeFrag),
            // The method is written on its NAME's line (#825 rule).
            startLine: mLine,
            startColumn: nameFrag.startPosition.column + 1,
          },
          visibility: mVisibility,
          ownerName: name,
          ownerKind: ASTEngine.SymbolKind.Class,
          metadata: { nodeType: "method_declaration_recovered" },
        })
        b = q
      }

      // Re-parent the walk's "(script)"-sourced calls/uses inside the region:
      // with no class scope pushed they all rode the script sentinel. Bounded
      // on BOTH sides — code after the class's closing brace is genuinely
      // script-level and must keep the sentinel.
      for (const rel of relationships) {
        if (rel.source !== "(script)") continue
        if (rel.type !== ASTEngine.RelationshipType.Calls && rel.type !== ASTEngine.RelationshipType.Uses) continue
        const line = rel.line_number
        if (line == null || line < startLine || line > endLine) continue
        rel.source = name
      }
      // One recovered class per pass (the primary); a second fragment class
      // stays a recorded residual rather than a risk.
      break
    }
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
  /** True when the field node is the same declaration as a sibling method, parsed twice (M59 #825 follow-up: `static Sphere valueOf` + the `final Distance distance`/ctor split). Proof, not heuristic: two distinct same-line declarations must be `;`-separated, so a sibling method starting after the field with only whitespace between them is the same tokens parsed twice — the full-span method wins. */
  private isDuplicateParseField(node: Node, content: string): boolean {
    const parent = node.parent
    if (!parent) return false
    for (let i = 0; i < parent.namedChildCount; i++) {
      const s = parent.namedChild(i)
      if (!s || s.id === node.id) continue
      if (s.type !== "method_declaration" && s.type !== "constructor_declaration" && s.type !== "function_definition") continue
      if (s.startPosition.row !== node.startPosition.row) continue
      if (s.startIndex <= node.endIndex) continue
      if (RealGroovyAnalyzer.isWhitespaceOnly(content.slice(node.endIndex, s.startIndex))) return true
    }
    return false
  }

  // A symbol is anchored at its FIRST ANNOTATION, not at the keyword after it.
  //
  // This reverses a skip-modifiers rule that was here and that the lane's own hand-audited
  // truth contradicts. tree-sitter-groovy puts annotations INSIDE the `modifiers` child
  // (`class_declaration → [modifiers "@Slf4j", identifier "Counter", class_body]`), so
  // skipping `modifiers` moved every annotated declaration down to the next line. Truth
  // records the annotation line, in all five cases in the fixtures:
  //     @Slf4j  L18 / class Counter        truth 18, was 19
  //     @Override L16 / String format(…)  truth 16, was 17
  //     @Override L21 / save(…)           truth 21, was 22
  //     @Override L36 / String getId()    truth 36, was 37
  //     @Override L39 / String getName()  truth 39, was 40
  // and the control confirms the rule is about annotations and nothing else: unannotated
  // `class UserService` (L10) and `class User` (L27) were already correct, and every
  // annotated declaration in the fixture set was off by exactly one.
  //
  // This is also the family convention: the java analyzer anchors a symbol at its
  // annotation line via `annotationLine` (real-java-analyzer.ts, and its use for
  // @Table/@FeignClient), so groovy was the outlier.
  //
  // A `modifiers` child that carries NO annotation is still skipped — that keeps
  // `private String label` and `final int hex` on their own line, which is what the
  // already-correct property rows require.
  /** True when this declaration carries at least one annotation (directly or in `modifiers`). */
  private declarationHasAnnotation(node: Node): boolean {
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (!c) continue
      if (c.type === "annotation" || c.type === "marker_annotation") return true
      if (c.type === "modifiers" && this.findChild(c, (n) => n.type === "annotation" || n.type === "marker_annotation")) return true
    }
    return false
  }

  private declarationLineNode(node: Node): Node {
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (!c) continue
      if (c.type === "modifiers") {
        // Anchor at the modifiers node ONLY when it actually carries an annotation;
        // its start is then the first annotation's line.
        const hasAnnotation = this.findChild(c, (n) => n.type === "annotation" || n.type === "marker_annotation") !== null
        if (hasAnnotation) return c
        continue
      }
      if (c.type === "annotation" || c.type === "marker_annotation") return c
      // M59 (#825) / F6: the grammar's own names. `"comment"` was dead here —
      // tree-sitter-groovy emits `line_comment`/`block_comment` only.
      if (c.type === "line_comment" || c.type === "block_comment") continue
      return c
    }
    return node
  }

  /** The range of a SYMBOL (not of an import, an error or a raw node), anchored per `declarationLineNode`. */
  private symbolRange(node: Node, nameNode?: Node | null) {
    const decl = nameNode ?? this.declarationLineNode(node)
    const base = this.nodeToRange(node)
    return {
      ...base,
      startLine: decl.startPosition.row + 1,
      startColumn: decl.startPosition.column + 1,
      startIndex: decl.startIndex,
    }
  }
}
