// Pure-AST C# analyzer — M12 per-analyzer perfection contract.
//
// Emits exactly the M12 differential contract (mirroring the Java family):
//   Symbols: namespace, class, interface, struct, record, enum, enum_member,
//            delegate, event, method, constructor, property. NO locals, NO
//            parameters, NO accessor scopes, NO synthetic members.
//   Relationships: contains, extends, implements, calls, instantiates,
//            overrides (qualified Owner.method -> Parent.method), uses
//            (field access), references (imports -> module paths).
//
// Grammar notes (tree-sitter-c-sharp v0.23.5, upgraded for M12.07):
//   * primary constructors (C# 12) parse cleanly (the previously wired
//     grammar failed on them)
//   * C# base lists have no keyword distinction (unlike Java's
//     extends/implements): the first entry may be a base class OR an
//     interface. Kind is resolved via the optional type-kind companion
//     (context.typeKinds, built by the harness pre-pass from the cross-file
//     symbol space — same machinery as the override companion); unknown
//     external types use the deterministic C# language rule: first base =
//     extends, remaining = implements.

import type { Node } from "web-tree-sitter"
import { ASTEngine } from "./engine"
import { findDeclaringParent } from "./override-context"

interface Scope {
  node: Node
  name: string // full name (namespace-qualified for types)
  rawName: string
  kind: ASTEngine.SymbolKind
  fqn: string
  symbolRef?: ASTEngine.UniversalSymbol
  visibility: "public" | "private" | "protected" | "internal" | undefined
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

const CSHARP_BUILTINS = new Set([
  // Console output — filtered (like Java's System.out.println)
  "Console.WriteLine", "Console.Write", "Console.WriteAsync",
  "Console.Error.WriteLine", "Console.Error.Write", "Console.Error.WriteAsync",
  "Console.Out.WriteLine", "Console.Out.Write", "Console.Out.WriteAsync",
  // System-level noise
  "Environment.Exit", "Environment.GetEnvironmentVariable",
  "Environment.GetEnvironmentVariables", "Environment.SetEnvironmentVariable",
  "GC.Collect", "GC.SuppressFinalize", "GC.WaitForPendingFinalizers",
  "Debug.WriteLine", "Debug.Write", "Debug.Print",
  "Trace.WriteLine", "Trace.Write",
  // Object methods (C# equivalent of Java's Object methods)
  "ToString", "GetHashCode", "Equals", "GetType", "ReferenceEquals",
])

export class RealCSharpAnalyzer implements ASTEngine.LanguageAnalyzer {
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
    // In-file declared type name -> kind. Built in a pre-pass so base-list
    // kind resolution works regardless of declaration order (C# allows a
    // class to implement an interface declared later in the same file).
    const typeKinds = new Map<string, string>()
    this.collectDeclaredTypeKinds(rootNode, typeKinds)

    const scopeStack: Scope[] = []
    // File-scoped namespaces (C# 10: `namespace A.B;`) apply to every type
    // declared after them in the file — the type declarations are SIBLINGS of
    // the namespace node, so the namespace scope is tracked here instead of
    // the scope stack (which only handles true lexical nesting).
    let fileScopedNamespace: Scope | undefined = undefined
    const stack: StackItem[] = [{ node: rootNode }]
    let cyclomaticComplexity = 1

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

      // Cyclomatic complexity
      const complexityNodes = new Set([
        "if_statement", "for_statement", "foreach_statement", "while_statement",
        "case_switch_label", "catch_declaration", "conditional_expression",
        "logical_and_expression", "logical_or_expression",
        // CSD2 (re-review 2026-09-04, probe): switch EXPRESSION arms are
        // decision points exactly like case labels — a 3-arm switch
        // expression measured complexity 1 (its legacy statement twin
        // counted every case_switch_label). 42 arms in the first 400 corpus
        // files were systematically undercounted.
        "switch_expression_arm",
      ])
      if (complexityNodes.has(type)) cyclomaticComplexity++

      // tree-sitter-c_sharp has no `using_static_directive` node type — `using
      // static X.Y` parses as a `using_directive` with a `name_modifier`/modifier
      // child (deep-review csharp #264). The old `using_static_directive` literal
      // was a dead branch (grammar drift) and is removed.
      if (type === "using_directive") {
        const nameNode =
          this.findChild(node, (n) => n.type === "identifier" || n.type === "qualified_name")
        if (nameNode) {
          // CSD7 (re-review 2026-09-04): alias usings (`using A = B.C;`) parse
          // with the alias identifier BEFORE the target qualified_name, so the
          // old first-identifier match captured the ALIAS as the module. Prefer
          // the qualified_name target; fall back to identifier (plain usings
          // have no qualified child only when they are a single identifier).
          // `global::X.Y` is captured raw (honest full path).
          const nameNode2 =
            this.findChild(node, (n) => n.type === "qualified_name") || nameNode
          const text = nameNode2.text
          const aliasMatch = /using\s+([\w.]+)\s*=/.exec(node.text)
          imports.push({
            module: text,
            source: text,
            imported: [],
            range: this.nodeToRange(node),
            isTypeOnly: false,
          })
          relationships.push({
            source: "root",
            target: text,
            type: ASTEngine.RelationshipType.References,
            confidence: 0.9,
            // isImport (family contract — c/go emit import deps with isImport)
            // lets the completeness section-B `imports` pin and the tier
            // classifier mark this import_based.
            metadata: {
              isUsingDirective: true,
              isImport: true,
              ...(aliasMatch ? { isUsingAlias: true, usingAlias: aliasMatch[1] } : {}),
            },
          })
        }
      }

        if (type === "namespace_declaration") {
        // CSD10 (re-review 2026-09-04, fixture-probe): a NEW namespace scope
        // must replace a surviving file-scoped one (the CSD1 push has no exit
        // item, so it would outlive its own file-section in multi-namespace
        // files), otherwise `namespace A; ... namespace B { class T }` nests
        // to A.B.T. Runs ONLY at namespace nodes — never at siblings.
        if (fileScopedNamespace) {
          const fi = scopeStack.indexOf(fileScopedNamespace)
          if (fi >= 0) scopeStack.splice(fi, 1)
          fileScopedNamespace = undefined
        }
        const rawName = this.extractNamespaceName(node)
        const fullName = this.buildFullName(scopeStack, rawName)
        symbols.push({
          name: rawName,
          kind: ASTEngine.SymbolKind.Namespace,
          range: this.nodeToRange(node),
          visibility: "public",
          metadata: { isCSharpNamespace: true, fullName },
        })
        newContext = {
          node,
          name: rawName,
          rawName,
          kind: ASTEngine.SymbolKind.Namespace,
          fqn: fullName,
          visibility: "public",
          isInterface: false,
          parents: [],
        }
        scopeStack.push(newContext)
        pushedScope = true
      } else if (type === "file_scoped_namespace_declaration") {
        // CSD10: same replacement rule when a SECOND file-scoped section
        // starts (multi-section files).
        if (fileScopedNamespace) {
          const fi = scopeStack.indexOf(fileScopedNamespace)
          if (fi >= 0) scopeStack.splice(fi, 1)
          fileScopedNamespace = undefined
        }
        const rawName = this.extractNamespaceName(node)
        const fullName = this.buildFullName(scopeStack, rawName)
        symbols.push({
          name: rawName,
          kind: ASTEngine.SymbolKind.Namespace,
          range: this.nodeToRange(node),
          visibility: "public",
          metadata: { isCSharpNamespace: true, fullName, isFileScoped: true },
        })
        // File-scoped namespace: applies to all following sibling declarations.
        fileScopedNamespace = {
          node,
          name: rawName,
          rawName,
          kind: ASTEngine.SymbolKind.Namespace,
          fqn: fullName,
          visibility: "public",
          isInterface: false,
          parents: [],
        }
        // CSD1 (re-review 2026-09-04, probe on real powershell file-scoped
        // file): the scope was tracked ONLY in the side variable and never
        // pushed, so buildFullName produced BARE type fullNames (and the
        // oracle/harness cross-file companions keyed by fullName desynced
        // from block-namespace files in the same corpus). Push the scope
        // WITHOUT an exit item: a file-scoped namespace has no closing
        // brace — its scope must survive its own subtree exit and cover the
        // SIBLING type declarations that follow it in the file (an exit item
        // pops it before the siblings are visited; probe-verified).
        newContext = fileScopedNamespace
        scopeStack.push(newContext)
        pushedScope = false
      } else if (
        type === "class_declaration" ||
        type === "struct_declaration" ||
        type === "interface_declaration" ||
        type === "record_declaration" ||
        type === "record_struct_declaration"
      ) {
        let rawName = node.childForFieldName("name")?.text || this.childText(node, "identifier") || "anonymous"

        const fullName = this.buildFullName(scopeStack, rawName)
        const isInterface = type === "interface_declaration"
        const kind = isInterface
          ? ASTEngine.SymbolKind.Interface
          : stringIncludes(type, "struct")
            ? ASTEngine.SymbolKind.Struct
            : ASTEngine.SymbolKind.Class

        const visibility = this.extractVisibility(node)
        typeKinds.set(rawName, kind)
        // The owner of a top-level type: a file-scoped namespace if one is in
        // effect (its scope is lexical-file-wide, not a tree ancestor), else
        // the enclosing block namespace (a true tree ancestor).
        const ownerScope =
          parentContext?.kind === ASTEngine.SymbolKind.Namespace
            ? parentContext
            : fileScopedNamespace && !parentContext
              ? fileScopedNamespace
              : undefined

        // Base list: C# has no keyword distinction. Resolve each base type's
        // kind: in-file declarations first, then the cross-file type-kind
        // companion; unknown external types use the deterministic language
        // rule (first base = extends, rest = implements; interfaces: all
        // bases are extends).
        const parents: string[] = []
        const baseList = this.findChild(node, "base_list")
        if (baseList) {
          const baseTypes: string[] = []
          for (let i = 0; i < baseList.namedChildCount; i++) {
            const baseType = baseList.namedChild(i)
            if (!baseType) continue
            // CSD9 (re-review 2026-09-04, fixture-probe): two primary-base
            // shapes carry ARGUMENT LISTS that fabricated garbage targets:
            // records parse as primary_constructor_base_type (type name is
            // the identifier child); CLASSES with primary bases parse as a
            // bare identifier FOLLOWED BY a sibling argument_list inside the
            // base_list (the argument_list is not a base type — skip it).
            if (baseType.type === "primary_constructor_base_type") {
              const tn = this.findChild(baseType, (n) => n.type === "identifier" || n.type === "generic_name")
              if (tn) baseTypes.push(this.cleanTypeName(tn.text))
              continue
            }
            if (baseType.type === "argument_list") continue
            baseTypes.push(this.cleanTypeName(baseType.text))
          }
          if (isInterface) {
            // All base types of an interface are extended interfaces.
            for (const b of baseTypes) {
              parents.push(b)
              relationships.push({
                source: fullName,
                target: b,
                type: ASTEngine.RelationshipType.Extends,
                confidence: 1.0,
                metadata: { isInterfaceBase: true },
              })
            }
          } else {
            const crossFileKinds = context?.typeKinds as Map<string, string> | undefined
            for (let i = 0; i < baseTypes.length; i++) {
              const b = baseTypes[i]
              parents.push(b)
              // Resolve the declared kind: exact in-file name, then exact
              // cross-file companion name, then qualified-name leaf (a nested
              // type like BaseService.Entity is keyed by its leaf Entity in
              // both the in-file map and the companion).
              const dotIdx = b.lastIndexOf(".")
              const leaf = dotIdx > 0 ? b.slice(dotIdx + 1) : b
              const declaredKind =
                typeKinds.get(b) || crossFileKinds?.get(b) ||
                typeKinds.get(leaf) || crossFileKinds?.get(leaf)
              // Unknown externals follow the deterministic C# rule: the base
              // class, if any, is listed first and the rest are interfaces.
              const isImplements = declaredKind === ASTEngine.SymbolKind.Interface || (i > 0 && !declaredKind)
              relationships.push({
                source: fullName,
                target: b,
                type: isImplements ? ASTEngine.RelationshipType.Implements : ASTEngine.RelationshipType.Extends,
                confidence: 1.0,
                metadata: { isImplements },
              })
            }
          }
        }
        classHierarchy.set(fullName, parents)

        // Generic type parameters (no symbols — suppressed like Java)
        const typeParamsNode = this.findChild(node, "type_parameter_list")
        const genericTypes: string[] = []
        if (typeParamsNode) {
          for (let i = 0; i < typeParamsNode.namedChildCount; i++) {
            const child = typeParamsNode.namedChild(i)
            if (child) genericTypes.push(child.text)
          }
        }

        // Record positional properties (Roslyn: record params are properties)
        const isRecord = stringIncludes(type, "record")
        const paramList = this.findChild(node, "parameter_list")
        if (isRecord && paramList) {
          for (let i = 0; i < paramList.namedChildCount; i++) {
            const p = paramList.namedChild(i)
            if (p && p.type === "parameter") {
              const pName = p.childForFieldName("name")?.text || this.childText(p, "identifier") || "anonymous"
              const pType = this.extractTypeString(p)
              symbols.push({
                name: pName,
                kind: ASTEngine.SymbolKind.Property,
                range: this.nodeToRange(p),
                visibility: "public",
                ownerName: rawName,
                ownerKind: kind,
                metadata: { hasGet: true, hasInit: true, dataType: pType, isRecordProperty: true },
              })
            }
          }
        }

        const sym: ASTEngine.UniversalSymbol = {
          name: rawName,
          kind,
          range: this.nodeToRange(node),
          visibility,
          ownerName: ownerScope ? ownerScope.rawName : parentContext?.rawName,
          ownerKind: ownerScope ? ownerScope.kind : parentContext?.kind,
          decorators: this.extractAttributes(node),
          metadata: {
            isCSharpType: true,
            isStruct: kind === ASTEngine.SymbolKind.Struct,
            isValueType: kind === ASTEngine.SymbolKind.Struct,
            isRecord,
            genericTypes: genericTypes.length > 0 ? genericTypes : undefined,
            fullName,
            isInterface,
          },
        }
        symbols.push(sym)
        if (!parentContext || parentContext.kind === ASTEngine.SymbolKind.Namespace) {
          exports.push({ name: sym.name, kind: sym.kind, range: sym.range, visibility: visibility || "public" })
        }
        newContext = {
          node,
          name: fullName,
          rawName,
          kind,
          fqn: fullName,
          visibility,
          symbolRef: sym,
          isInterface,
          parents,
        }
        scopeStack.push(newContext)
        pushedScope = true
      } else if (type === "enum_declaration") {
        const rawName = node.childForFieldName("name")?.text || this.childText(node, "identifier") || "anonymous"
        const fullName = this.buildFullName(scopeStack, rawName)
        const visibility = this.extractVisibility(node)
        typeKinds.set(rawName, ASTEngine.SymbolKind.Enum)
        const ownerScope =
          parentContext?.kind === ASTEngine.SymbolKind.Namespace
            ? parentContext
            : fileScopedNamespace && !parentContext
              ? fileScopedNamespace
              : undefined

        let baseType: string | undefined
        const baseList = this.findChild(node, "base_list")
        if (baseList) baseType = baseList.namedChild(0)?.text

        symbols.push({
          name: rawName,
          kind: ASTEngine.SymbolKind.Enum,
          range: this.nodeToRange(node),
          visibility,
          ownerName: ownerScope ? ownerScope.rawName : parentContext?.rawName,
          ownerKind: ownerScope ? ownerScope.kind : parentContext?.kind,
          decorators: this.extractAttributes(node),
          metadata: { isEnum: true, baseType, fullName },
        })
        if (!parentContext || parentContext.kind === ASTEngine.SymbolKind.Namespace) {
          exports.push({ name: rawName, kind: ASTEngine.SymbolKind.Enum, range: this.nodeToRange(node), visibility: visibility || "public" })
        }
        newContext = {
          node,
          name: rawName,
          rawName,
          kind: ASTEngine.SymbolKind.Enum,
          fqn: fullName,
          visibility,
          isInterface: false,
          parents: [],
        }
        scopeStack.push(newContext)
        pushedScope = true
      } else if (type === "enum_member_declaration") {
        const name = node.childForFieldName("name")?.text || this.childText(node, "identifier") || "anonymous"
        symbols.push({
          name,
          kind: ASTEngine.SymbolKind.EnumMember,
          range: this.nodeToRange(node),
          visibility: "public",
          ownerName: parentContext?.rawName,
          ownerKind: parentContext?.kind,
          metadata: {},
        })
      } else if (type === "delegate_declaration") {
        const name = node.childForFieldName("name")?.text || this.childText(node, "identifier") || "anonymous"
        const returnType = node.childForFieldName("type")?.text || "void"
        const parameters: ASTEngine.Parameter[] = []
        const paramList = this.findChild(node, "parameter_list")
        if (paramList) {
          for (let i = 0; i < paramList.namedChildCount; i++) {
            const parameter = paramList.namedChild(i)
            if (parameter?.type !== "parameter") continue
            const parameterName = parameter.childForFieldName("name")?.text || "anonymous"
            parameters.push({ name: parameterName, type: parameter.childForFieldName("type")?.text })
          }
        }
        const visibility = this.extractVisibility(node)
        const ownerScope =
          parentContext?.kind === ASTEngine.SymbolKind.Namespace
            ? parentContext
            : fileScopedNamespace && !parentContext
              ? fileScopedNamespace
              : undefined
        symbols.push({
          name,
          kind: ASTEngine.SymbolKind.Delegate,
          range: this.nodeToRange(node),
          visibility,
          ownerName: ownerScope ? ownerScope.rawName : parentContext?.rawName,
          ownerKind: ownerScope ? ownerScope.kind : parentContext?.kind,
          parameters,
          returnType,
          decorators: this.extractAttributes(node),
          metadata: { isDelegate: true, returnType },
        })
      } else if (type === "event_field_declaration") {
        const varDecl = this.findChild(node, "variable_declaration")
        const visibility = this.extractVisibility(node)
        if (varDecl) {
          for (let i = 0; i < varDecl.namedChildCount; i++) {
            const child = varDecl.namedChild(i)
            if (child && child.type === "variable_declarator") {
              const name = this.childText(child, "identifier") || "anonymous"
              symbols.push({
                name,
                kind: ASTEngine.SymbolKind.Event,
                range: this.nodeToRange(node),
                visibility,
                ownerName: parentContext?.rawName,
                ownerKind: parentContext?.kind,
                decorators: this.extractAttributes(node),
                metadata: { isEvent: true },
              })
            }
          }
        }
      } else if (type === "operator_declaration" || type === "conversion_operator_declaration") {
        // CSD3 (re-review 2026-09-04): every overload collapsed into a symbol
        // literally named "operator" — `operator +` and `operator ==` were
        // indistinguishable (haskell/ruby name operators by identity). The
        // operator token is an ANONYMOUS grammar child, so it is extracted
        // from the declaration text. Conversion ops are named by their
        // implicit/explicit target type. Per-symbol complexity added (was
        // always missing here).
        const opText = node.text
        const convMatch = /\boperator\s+(implicit|explicit)\s+([\w.<>]+)/.exec(opText)
        const opMatch = convMatch ? null : /\boperator\s+(checked\s+)?([^\s(]+)/.exec(opText)
        const opName = convMatch
          ? `${convMatch[1]} ${convMatch[2]}`
          : opMatch
            ? `operator ${opMatch[1] ? `${opMatch[1].trim()} ` : ""}${opMatch[2]}`
            : "operator"
        const visibility = this.extractVisibility(node)
        symbols.push({
          name: opName,
          kind: ASTEngine.SymbolKind.Method,
          range: this.nodeToRange(node),
          visibility,
          ownerName: parentContext?.rawName,
          ownerKind: parentContext?.kind,
          complexity: this.calculateCyclomaticComplexity(node),
          metadata: { isOperatorOverload: true, isConversionOperator: type === "conversion_operator_declaration" },
        })
      } else if (type === "event_declaration") {
        // CSD5 (re-review 2026-09-04, probe): accessor-form event declarations
        // (`event EventHandler Ready { add {...} remove {...} }`) emitted NO
        // symbol — only event_field_declaration was handled. The name is the
        // grammar `name` field; the type is the qualified/generic type child.
        const nameNode = node.childForFieldName("name")
        const name = nameNode?.text || this.childText(node, "identifier") || "anonymous"
        const typeNode = this.findChild(
          node,
          (n) => n.type === "qualified_name" || ((n.type === "identifier" || n.type === "generic_name") && n.id !== nameNode?.id),
        )
        symbols.push({
          name,
          kind: ASTEngine.SymbolKind.Event,
          range: this.nodeToRange(node),
          visibility: this.extractVisibility(node),
          ownerName: parentContext?.rawName,
          ownerKind: parentContext?.kind,
          decorators: this.extractAttributes(node),
          metadata: { isEvent: true, isAccessorForm: true, dataType: typeNode?.text },
        })
      } else if (type === "constructor_initializer") {
        // CSD8 (re-review 2026-09-04, probe: 120 corpus occurrences):
        // `public Sub() : base(42) { }` / `: this()` — a real constructor-to-
        // constructor call that was never emitted. Attribute to the enclosing
        // constructor (its scope is active when the initializer is visited).
        // `: base(42)` vs `: this()` — node text STARTS with the colon, so
        // the discriminator is the first identifier after it.
        const target = /:\s*base\s*\(/.test(node.text) ? "base" : "this"
        if (parentContext?.name) {
          relationships.push({
            source: parentContext.name === "constructor" ? parentContext.rawName || "constructor" : parentContext.name,
            target,
            type: ASTEngine.RelationshipType.Calls,
            confidence: 0.95,
            metadata: { isConstructorInitializer: true },
          })
        }
      } else if (
        type === "method_declaration" ||
        type === "constructor_declaration" ||
        type === "destructor_declaration"
      ) {
        let name =
          node.childForFieldName("name")?.text ||
          this.childText(node, "identifier") ||
          (type === "constructor_declaration" ? parentContext?.rawName : "anonymous") ||
          "anonymous"

        if (type === "constructor_declaration") name = "constructor"
        if (type === "destructor_declaration") name = "Finalize"

        const visibility = this.extractVisibility(node)
        const returnType =
          type === "constructor_declaration" || type === "destructor_declaration"
            ? "void"
            : node.childForFieldName("type")?.text || this.extractTypeString(node) || "void"

        const parameters: ASTEngine.Parameter[] = []
        let isExtensionMethod = false
        let sigParams = ""
        const paramList = this.findChild(node, "parameter_list")
        if (paramList) {
          for (let i = 0; i < paramList.namedChildCount; i++) {
            const p = paramList.namedChild(i)
            if (p && p.type === "parameter") {
              const pName = p.childForFieldName("name")?.text || this.childText(p, "identifier") || "anonymous"
              const pType = p.childForFieldName("type")?.text || this.extractTypeString(p) || "unknown"
              if (p.text.startsWith("this ")) isExtensionMethod = true
              parameters.push({ name: pName, type: pType })
              if (sigParams.length > 0) sigParams += ","
              sigParams += pType
            }
          }
        }
        const signature = `(${sigParams})`

        const ownerFqn = parentContext ? parentContext.fqn : ""
        const fqn = parentContext ? `${ownerFqn}.${name}${signature}` : `${name}${signature}`
        const localOwnerPrefix = parentContext ? `${parentContext.rawName}.${name}${signature}` : `${name}${signature}`

        const sym: ASTEngine.UniversalSymbol = {
          name,
          kind: type === "constructor_declaration" ? ASTEngine.SymbolKind.Constructor : ASTEngine.SymbolKind.Method,
          range: this.nodeToRange(node),
          visibility,
          ownerName: parentContext?.rawName,
          ownerKind: parentContext?.kind,
          parameters,
          returnType,
          decorators: this.extractAttributes(node),
          // Per-symbol cyclomatic complexity (family contract — JVM/rust/go/c
          // all emit symbol.complexity; csharp only had file-level complexity, so
          // the completeness section-C payload pin was impossible. Added csharp
          // #264 wave, same counter as the file-level one).
          complexity: this.calculateCyclomaticComplexity(node),
          metadata: {
            returnType,
            isExtensionMethod,
            isVirtual: this.hasModifier(node, "virtual"),
            isOverride: this.hasModifier(node, "override"),
            isAbstract: this.hasModifier(node, "abstract"),
            isStatic: this.hasModifier(node, "static"),
          },
        }
        symbols.push(sym)
        symbolMap.set(fqn, sym)
        symbolMap.set(localOwnerPrefix, sym)

        if (this.hasModifier(node, "override")) {
          overrideTasks.push({
            fqn: localOwnerPrefix,
            methodName: name,
            signature,
            ownerFqn,
          })
        }

        newContext = {
          node,
          name,
          rawName: name,
          kind: type === "constructor_declaration" ? ASTEngine.SymbolKind.Constructor : ASTEngine.SymbolKind.Method,
          fqn: ownerFqn,
          visibility,
          symbolRef: sym,
          isInterface: parentContext?.isInterface ?? false,
          parents: [],
        }
        scopeStack.push(newContext)
        pushedScope = true
      } else if (type === "invocation_expression") {
        const callExpr = this.buildCSharpCallExpression(node)
        // Call sites live in method bodies AND constructor/property/indexer
        // bodies (csharp #264 Station-6: calls inside a constructor like
        // `this._list.Add(...)` were silently dropped because the guard
        // required the enclosing symbol to be a Method — the differential
        // oracle surfaced `Add`/`AddRange`/`DeepClone` as MISSING).
        const enclosingKind = parentContext?.kind
        const isCallSite =
          enclosingKind === ASTEngine.SymbolKind.Method ||
          enclosingKind === ASTEngine.SymbolKind.Constructor ||
          enclosingKind === ASTEngine.SymbolKind.Property ||
          // Class-body expression contexts (field/type-member initializers and
          // attribute arguments) — csharp #264 Station-6: calls like
          // `Thread.AllocateDataSlot()`, `PSTraceSource.GetTracer(...)`,
          // `DependencyProperty.Register(...)` in static field initializers
          // live at class scope, so the enclosing context is the Class/Struct/
          // Interface, not a method. Previously dropped, the differential
          // oracle surfaced them ALL as MISSING (it derives every
          // invocation_expression leaf from `(expr)`).
          enclosingKind === ASTEngine.SymbolKind.Class ||
          enclosingKind === ASTEngine.SymbolKind.Struct ||
          enclosingKind === ASTEngine.SymbolKind.Interface
        if (callExpr && parentContext?.name && isCallSite) {
          // Strip generic type arguments so a generic call `x?.Get<T>(...)` /
          // `Foo.Gen<T>(...)` resolves to its clean leaf `Get` / `Gen` before
          // hygiene (the raw callExpr leaf carries `<T>`).
          const target = String(callExpr.split(".").pop() || callExpr).split("<")[0]
          // Call-target hygiene (csharp #264 Station-6 differential surfaced
          // fabricated Calls to non-method callee shapes): `if (...)` parses as
          // an invocation_expression in the tree-sitter grammar but is a
          // statement, and unsafe vtable dispatch chains slot a bare pointer
          // index as the callee (`... 2 ...))(...)`), element accesses
          // (`handlers[handler](...)`) and argument fragments surface as junk
          // targets too. Only a clean identifier is a real call target.
          const isCSharpKeyword = /^(if|for|foreach|while|do|switch|case|else|return|throw|using|new|delegate|in|is|as|sizeof|fixed|lock|checked|unchecked|params|ref|out|base|this|get|set)$/.test(target)
          if (!isCSharpKeyword && /^[A-Za-z_][A-Za-z0-9_]*$/.test(target) && !this.isCSharpBuiltin(callExpr)) {
            relationships.push({
              source: parentContext.rawName,
              target,
              type: ASTEngine.RelationshipType.Calls,
              confidence: 0.9,
              metadata: { csharpCallExpression: callExpr },
            })
          }
        }
      } else if (type === "object_creation_expression") {
        const typeNode = this.findChild(node, (n) =>
          n.type === "identifier" || n.type === "generic_name" || n.type === "qualified_name" || n.type === "predefined_type",
        )
        if (typeNode) {
          const source = parentContext?.rawName || "global"
          relationships.push({
            source,
            target: this.cleanTypeName(typeNode.text),
            type: ASTEngine.RelationshipType.Instantiates,
            confidence: 0.95,
            metadata: { isNew: true },
          })
        }
      } else if (type === "implicit_object_creation_expression") {
        // Target-typed `new()` — the type comes from the enclosing
        // variable_declarator (pure AST resolution).
        const declaredType = this.resolveImplicitNewType(node)
        if (declaredType) {
          const source = parentContext?.rawName || "global"
          relationships.push({
            source,
            target: declaredType,
            type: ASTEngine.RelationshipType.Instantiates,
            confidence: 0.95,
            metadata: { isNew: true, isImplicit: true },
          })
        }
      } else if (type === "property_declaration" || type === "indexer_declaration") {
        const name = type === "indexer_declaration" ? "this" : node.childForFieldName("name")?.text || this.childText(node, "identifier") || "anonymous"
        const dataType = this.extractTypeString(node)
        const visibility = this.extractVisibility(node)

        let hasGet = false
        let hasSet = false
        let hasInit = false
        let isAutoProperty = false
        const accessorList = this.findChild(node, "accessor_list")
        if (accessorList) {
          isAutoProperty = true
          for (let i = 0; i < accessorList.namedChildCount; i++) {
            const acc = accessorList.namedChild(i)
            if (acc && acc.type === "accessor_declaration") {
              const accText = acc.text
              if (stringIncludes(accText, "get")) hasGet = true
              if (stringIncludes(accText, "set")) hasSet = true
              if (stringIncludes(accText, "init")) hasInit = true
              if (this.findChild(acc, "block") || this.findChild(acc, "arrow_expression_clause")) {
                isAutoProperty = false
              }
            }
          }
        } else if (this.findChild(node, "arrow_expression_clause")) {
          hasGet = true
        }

        symbols.push({
          name,
          kind: ASTEngine.SymbolKind.Property,
          range: this.nodeToRange(node),
          visibility,
          ownerName: parentContext?.rawName,
          ownerKind: parentContext?.kind,
          decorators: this.extractAttributes(node),
          complexity: this.calculateCyclomaticComplexity(node),
          metadata: { hasGet, hasSet, hasInit, isAutoProperty, dataType },
        })
        // Push a property/indexer scope so calls inside a getter/setter/accessor
        // body attribute to the property (csharp #264 Station-6: setter bodies
        // like `this.NotifyPropertyChanged(...)` were dropped because the
        // enclosing context stayed at the class — the differential surfaced
        // NotifyPropertyChanged/InvalidateValidationResult as MISSING).
        newContext = {
          node,
          name,
          rawName: name,
          kind: ASTEngine.SymbolKind.Property,
          fqn: parentContext ? `${parentContext.fqn}.${name}` : name,
          visibility,
          symbolRef: symbols[symbols.length - 1],
          isInterface: parentContext?.isInterface ?? false,
          parents: [],
        }
        scopeStack.push(newContext)
        pushedScope = true
      } else if (type === "field_declaration") {
        const dataType = this.extractTypeString(node)
        const varDecl = this.findChild(node, "variable_declaration")
        const visibility = this.extractVisibility(node)
        if (varDecl) {
          for (let i = 0; i < varDecl.namedChildCount; i++) {
            const child = varDecl.namedChild(i)
            if (child && child.type === "variable_declarator") {
              const name = this.childText(child, "identifier") || "anonymous"
              symbols.push({
                name,
                kind: ASTEngine.SymbolKind.Property,
                range: this.nodeToRange(node),
                visibility,
                ownerName: parentContext?.rawName,
                ownerKind: parentContext?.kind,
                decorators: this.extractAttributes(node),
                metadata: { dataType, isField: true },
              })
            }
          }
        }
      }

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

    // Override resolution: exact-signature BFS first (in-file), then the
    // cross-file companion (interface-over-superclass), then deterministic
    // first-parent fallback. Mirrors Java/Kotlin/Scala/Groovy semantics.
    this.resolveOverrides(overrideTasks, classHierarchy, symbolMap, relationships, context?.overrideCompanion)

    // Rewrite using-directive reference sources from "root" to the file's
    // primary type (first top-level type declared). Top-level types live
    // inside a namespace (block or file-scoped), so the owner may be a
    // namespace — never a class/interface/enum/struct.
    const primaryType = symbols.find((s) => {
      if (s.kind === ASTEngine.SymbolKind.Namespace) return false
      if (s.ownerKind && s.ownerKind !== ASTEngine.SymbolKind.Namespace) return false
      return s.kind === ASTEngine.SymbolKind.Class ||
             s.kind === ASTEngine.SymbolKind.Interface ||
             s.kind === ASTEngine.SymbolKind.Enum ||
             s.kind === ASTEngine.SymbolKind.Struct ||
             s.kind === ASTEngine.SymbolKind.Delegate
    })
    if (primaryType) {
      for (const rel of relationships) {
        if (rel.type === ASTEngine.RelationshipType.References && rel.source === "root") {
          rel.source = primaryType.name
        }
      }
    }

    // Contains: owner -> owned members via ownerName (top-level declarations
    // inside a namespace have the namespace as owner).
    for (const s of symbols) {
      const _owner = s.ownerName || s.scope
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

    // Field-access Uses pass (csharp #264 wave). The M12 contract declares
    // `uses (field access)` but it was never emitted — a genuine Station-3
    // gap. Mirrors the go/rust family: member_access_expression on a field
    // (not in call-callee position) emits `uses containingFn -> field`.
    this.analyzeFieldAccessUses(rootNode, relationships, symbols)

    this.classifyEvidenceTier(relationships)

    return {
      symbols,
      relationships,
      imports,
      exports,
      errors,
      metadata: {
        cyclomaticComplexity,
        complexity: cyclomaticComplexity,
        linesOfCode: content.split("\n").length,
        hasTypeInference: true,
        analysisVersion: "4.1.0-pure-ast-m12",
      },
    }
  }

  /**
   * Evidence-tier classification (family contract — mirrors JVM/rust/zig; M14
   * section D requires >=2 distinct evidenceClass values). Same rules as the
   * JVM family: structural (grammar clauses, conf 1.0) | usage_contextual
   * (calls, field access) | import_based (using-directive dependencies) |
   * reference_qualified (type references) | inferred (confidence < 1 edges).
   */
  private classifyEvidenceTier(relationships: ASTEngine.UniversalRelationship[]): void {
    for (const r of relationships) {
      const type = r.type ?? r.relationshipType ?? ""
      const md: any = r.metadata ?? {}
      if (type === "contains") { md.evidenceClass = "structural"; continue }
      if (type === "references") {
        md.evidenceClass = (md.isUsingDirective || md.isImport) ? "import_based" : "reference_qualified"
        continue
      }
      if (type === "imports") { md.evidenceClass = "import_based"; continue }
      if (type === "calls" || type === "uses") {
        md.evidenceClass = (r.confidence ?? 0) >= 0.85 ? "usage_contextual" : "inferred"
        continue
      }
      if (type === "instantiates" || type === "extends" || type === "implements") {
        md.evidenceClass = (r.confidence ?? 0) >= 0.9 ? "structural" : "inferred"
        continue
      }
      if (type === "overrides") { md.evidenceClass = "structural"; continue }
      md.evidenceClass = "usage_contextual"
    }
  }

  /**
   * Per-symbol cyclomatic complexity (family contract — csharp #264 wave).
   * Same node set as the file-level counter above so per-symbol and
   * file-level agree; base complexity 1.
   */
  private calculateCyclomaticComplexity(node: Node): number {
    let complexity = 1
    const complexityNodes = new Set([
      "if_statement", "for_statement", "foreach_statement", "while_statement",
      "case_switch_label", "catch_declaration", "conditional_expression",
      "logical_and_expression", "logical_or_expression",
      // CSD2: keep per-symbol in sync with the file-level counter above.
      "switch_expression_arm",
    ])
    const stack = [node]
    while (stack.length > 0) {
      const n = stack.pop()!
      if (complexityNodes.has(n.type)) complexity++
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const c = n.namedChild(i)
        if (c) stack.push(c)
      }
    }
    return complexity
  }

  /** Pre-pass: record every type declaration's kind for in-file base-list resolution. */
  private collectDeclaredTypeKinds(rootNode: Node, typeKinds: Map<string, string>): void {
    const stack: Node[] = [rootNode]
    while (stack.length > 0) {
      const n = stack.pop()!
      const t = n.type
      if (
        t === "class_declaration" || t === "struct_declaration" ||
        t === "interface_declaration" || t === "record_declaration" ||
        t === "record_struct_declaration" || t === "enum_declaration"
      ) {
        const name = n.childForFieldName("name")?.text || this.childText(n, "identifier")
        if (name) {
          const kind = t === "interface_declaration"
            ? ASTEngine.SymbolKind.Interface
            : t === "enum_declaration"
              ? ASTEngine.SymbolKind.Enum
              : stringIncludes(t, "struct")
                ? ASTEngine.SymbolKind.Struct
                : ASTEngine.SymbolKind.Class
          typeKinds.set(name, kind)
        }
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const child = n.namedChild(i)
        if (child) stack.push(child)
      }
    }
  }

  private resolveOverrides(
    tasks: OverrideTask[],
    classHierarchy: Map<string, string[]>,
    symbolMap: Map<string, ASTEngine.UniversalSymbol>,
    relationships: ASTEngine.UniversalRelationship[],
    companion?: Map<string, Set<string>>,
  ) {
    for (const task of tasks) {
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

        const potentialTargetFqn = `${parent}.${task.methodName}${task.signature}`
        if (symbolMap.has(potentialTargetFqn)) {
          targetFqn = potentialTargetFqn
          break
        }
        const pH = classHierarchy.get(parent)
        if (pH) {
          for (let i = 0; i < pH.length; i++) queue.push(pH[i])
        }
      }

      // Pass 2: cross-file companion declaring-parent resolution.
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
          metadata: { relationshipType: "method_override", isCSharpOverride: true },
        })
      }
    }
  }

  /**
   * Field-access Uses pass (csharp #264 wave, Station 3). Emits `uses
   * containingFn -> field` for member_access_expression on a field (e.g.
   * `this.Name`, `obj.Radius`) that is NOT the callee of a call. Mirror of the
   * go/rust selector-uses family contract. Call-callee member accesses are
   * skipped (calls analysis emits the leaf-target calls edge instead).
   */
  private analyzeFieldAccessUses(
    rootNode: Node,
    relationships: ASTEngine.UniversalRelationship[],
    symbols: ASTEngine.UniversalSymbol[],
  ): void {
    // Dedup against calls edges (member_access in call-callee position).
    const emittedCalls = new Set<string>()
    for (const r of relationships) {
      if ((r.type || r.relationshipType || "") === ASTEngine.RelationshipType.Calls) {
        emittedCalls.add(`${r.source}->${r.target}`)
      }
    }
    const stack: Node[] = [rootNode]
    const seen = new Set<string>()
    while (stack.length > 0) {
      const node = stack.pop()!
      if (node.type === "member_access_expression" || node.type === "member_binding_expression") {
        // Skip when the selectoing member_access is the callee of a call
        // expression (call-callee position). CSD4 (re-review 2026-09-04):
        // null-conditional calls `x?.M()` host the member binding inside a
        // conditional_access_expression that is itself the call's function —
        // that 2-level shape must be skipped too, or `?.M()` emits a bogus
        // uses edge for the METHOD name.
        let isCallee = false
        const parent = node.parent
        if (parent && parent.type === "invocation_expression") {
          const fn = parent.childForFieldName("function")
          if (fn === node) isCallee = true
        } else if (parent && parent.type === "conditional_access_expression") {
          const gp = parent.parent
          if (gp && gp.type === "invocation_expression" && gp.childForFieldName("function") === parent) isCallee = true
        }
        if (!isCallee) {
          const field = node.childForFieldName("name")
          const expr = node.childForFieldName("expression")
          // CSD4: member_binding_expression (`.Count`) has NO expression field
          // — the binding itself is the member selection; its receiver lives
          // in the parent conditional_access_expression. Require expr only for
          // the member_access form, or `?.Count` reads never emit.
          if (field && (expr || node.type === "member_binding_expression")) {
            const containing = this.findContainingCSharpFunction(node)
            const src = containing || "global"
            const tgt = field.text
            const key = `${src}.${tgt}`
            if (!seen.has(key) && !emittedCalls.has(`${src}->${tgt}`)) {
              seen.add(key)
              relationships.push({
                source: src,
                target: tgt,
                type: ASTEngine.RelationshipType.Uses,
                confidence: 0.7,
                metadata: { relationshipType: "csharp_field_access", fieldAccess: key },
              })
            }
          }
        }
      }
      for (let i = node.namedChildCount - 1; i >= 0; i--) {
        const child = node.namedChild(i)
        if (child) stack.push(child)
      }
    }
  }

  /** Find the nearest enclosing method/constructor/property symbol name. */
  private findContainingCSharpFunction(node: Node): string | null {
    let cur: Node | null = node.parent
    while (cur) {
      if (
        cur.type === "method_declaration" || cur.type === "constructor_declaration" ||
        cur.type === "destructor_declaration"
      ) {
        const name =
          cur.childForFieldName("name")?.text ||
          this.childText(cur, "identifier") ||
          (cur.type === "constructor_declaration" ? "constructor" : "anonymous")
        if (cur.type === "constructor_declaration") return "constructor"
        if (cur.type === "destructor_declaration") return "Finalize"
        return name
      }
      if (cur.type === "property_declaration" || cur.type === "indexer_declaration") {
        return cur.type === "indexer_declaration" ? "this" : cur.childForFieldName("name")?.text || this.childText(cur, "identifier") || "anonymous"
      }
      cur = cur.parent
    }
    return null
  }

  private buildCSharpCallExpression(node: Node): string | null {
    const func = node.childForFieldName("function") || this.findChild(node, (n) => n.type === "identifier" || n.type === "generic_name" || n.type === "member_access_expression")
    if (!func) return null
    if (func.type === "member_access_expression") {
      const nameNode = func.childForFieldName("name")
      const exprNode = func.childForFieldName("expression")
      if (!nameNode) return null
      const leaf = nameNode.type === "generic_name" ? nameNode.childForFieldName("name")?.text || nameNode.text.split("<")[0] : nameNode.text
      if (exprNode) {
        const expr = this.cleanTypeName(exprNode.text)
        return `${expr}.${leaf}`
      }
      return leaf
    }
    if (func.type === "generic_name") {
      return func.childForFieldName("name")?.text || func.text.split("<")[0]
    }
    return func.text
  }

  private resolveImplicitNewType(node: Node): string | null {
    // `= new()` inside a variable_declarator: type from the declaration.
    let cur: Node | null = node.parent
    while (cur) {
      if (cur.type === "variable_declarator") {
        const parentDecl = cur.parent
        if (parentDecl && parentDecl.type === "variable_declaration") {
          const typeNode = this.findChild(parentDecl, (n) =>
            n.type === "generic_name" || n.type === "identifier" || n.type === "qualified_name" || n.type === "predefined_type" || n.type === "nullable_type" || n.type === "array_type",
          )
          if (typeNode) return this.cleanTypeName(typeNode.text)
        }
        return null
      }
      if (cur.type === "field_declaration") return null
      if (cur.type === "property_declaration") {
        const typeNode = this.findChild(cur, (n) =>
          n.type === "generic_name" || n.type === "identifier" || n.type === "qualified_name" || n.type === "predefined_type" || n.type === "nullable_type",
        )
        if (typeNode) return this.cleanTypeName(typeNode.text)
        return null
      }
      cur = cur.parent
    }
    return null
  }

  private isCSharpBuiltin(call: string): boolean {
    if (CSHARP_BUILTINS.has(call)) return true
    // Leaf Object methods (toString-style calls without qualification)
    const leaf = call.split(".").pop() || call
    if (leaf === "ToString" || leaf === "GetHashCode" || leaf === "Equals" || leaf === "GetType" || leaf === "ReferenceEquals") return true
    // System.* roots are external framework calls — kept (like Java's JDK
    // calls). Only the explicit builtin list is filtered.
    return false
  }

  private extractVisibility(node: Node): "public" | "private" | "protected" | "internal" | undefined {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child && child.type === "modifier") {
        const text = child.text
        if (text === "public") return "public"
        if (text === "private") return "private"
        if (text === "protected") return "protected"
        if (text === "internal") return "internal"
      }
    }
    return undefined
  }

  private hasModifier(node: Node, modifier: string): boolean {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child && child.type === "modifier" && child.text === modifier) return true
    }
    return false
  }

  private extractNamespaceName(node: Node): string {
    // file-scoped: `namespace A.B;` → qualified_name; block: `namespace A.B {`
    const nameNode = this.findChild(node, (n) => n.type === "qualified_name" || n.type === "identifier")
    return nameNode ? nameNode.text : "anonymous"
  }

  private cleanTypeName(text: string): string {
    // Strip generic arguments and nullable/array suffixes for identity.
    const lt = text.indexOf("<")
    const base = lt > 0 ? text.slice(0, lt) : text
    const q = base.indexOf("?")
    return (q > 0 ? base.slice(0, q) : base).trim()
  }

  private buildFullName(scopeStack: { rawName: string }[], name: string): string {
    if (scopeStack.length === 0) return name
    let res = ""
    for (let i = 0; i < scopeStack.length; i++) {
      res += scopeStack[i].rawName + "."
    }
    return res + name
  }

  private extractTypeString(node: Node): string | undefined {
    const typeNodes = [
      "predefined_type", "type_identifier", "identifier", "generic_name",
      "array_type", "nullable_type", "tuple_type", "implicit_type",
    ]
    for (let idx = 0; idx < typeNodes.length; idx++) {
      const t = typeNodes[idx]
      const found = this.findChild(node, (n) => n.type === t)
      if (found) return found.text
    }
    return undefined
  }

  private extractAttributes(node: Node): string[] {
    const attrs: string[] = []
    const attrLists = this.findAllChildren(node, "attribute_list")
    for (let idx = 0; idx < attrLists.length; idx++) {
      const list = attrLists[idx]
      for (let i = 0; i < list.namedChildCount; i++) {
        const attr = list.namedChild(i)
        if (attr && attr.type === "attribute") {
          const nameNode = this.findChild(attr, (n) => n.type === "identifier" || n.type === "qualified_name")
          if (nameNode) attrs.push(nameNode.text)
        }
      }
    }
    return attrs
  }

  private nodeToRange(node: Node) {
    return {
      startLine: node.startPosition.row + 1,
      startColumn: node.startPosition.column + 1,
      endLine: node.endPosition.row + 1,
      endColumn: node.endPosition.column + 1,
      startIndex: node.startIndex,
      endIndex: node.endIndex,
    }
  }

  private findChild(node: Node, type: string | ((n: Node) => boolean)): Node | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (!child) continue
      if (typeof type === "string" ? child.type === type : type(child)) return child
    }
    return null
  }

  private findAllChildren(node: Node, type: string): Node[] {
    const res: Node[] = []
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child && child.type === type) res.push(child)
    }
    return res
  }

  private childText(node: Node, type: string): string | null {
    const child = this.findChild(node, type)
    return child ? child.text : null
  }
}

function stringIncludes(str: string, val: string): boolean {
  return str.indexOf(val) !== -1
}
