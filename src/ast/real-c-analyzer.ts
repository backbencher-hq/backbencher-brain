// @ts-nocheck — Ported from backbencher.
function inArray(arr: any[], val: any): boolean {
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] === val) return true
  }
  return false
}

function stringIncludes(str: string, val: string): boolean {
  return str.indexOf(val) !== -1
}

import type { Node } from "web-tree-sitter"
import { UniversalSymbol, SymbolKind, RelationshipType, ParseResult, ImportInfo, ExportInfo, ParseError, FileMetadata, UniversalRelationship, Parameter, LanguageAnalyzer } from "./types.js"

// Pre-allocated lookup arrays — avoids per-node allocation overhead
const MALLOC_FUNCTIONS = ["malloc", "calloc", "realloc", "kmalloc", "vmalloc"]
const FREE_FUNCTIONS = ["free", "kfree", "vfree"]
const UNSAFE_STRINGS = ["strcpy", "sprintf", "gets"]
const SAFE_STRINGS = ["strncpy", "snprintf"]
const EXPORT_MACROS = ["EXPORT_SYMBOL", "EXPORT_SYMBOL_GPL"]
const FORMAT_FUNCTIONS = ["printf", "fprintf", "sprintf", "snprintf", "scanf", "fscanf", "sscanf", "syslog", "dprintf"]
const DANGEROUS_FUNCTIONS = ["system", "popen", "execve", "execvp", "execl", "execlp"]
const SIGNAL_FUNCTIONS = ["signal", "sigaction", "sigprocmask", "sigemptyset", "sigfillset", "sigaddset", "sigdelset", "sigwait", "sigpending", "sigsuspend"]
const ASM_KEYWORDS = ["__asm__", "__asm", "asm", "__volatile__"]
const COMPLEXITY_NODES = ["if_statement", "for_statement", "while_statement", "do_statement", "case_statement", "conditional_expression"]
const DECLARATION_NODES = ["declaration", "parameter_declaration", "field_declaration", "init_declarator", "function_declarator", "pointer_declarator", "array_declarator", "type_definition", "enumerator", "preproc_def", "preproc_function_def"]
const STRUCT_TYPE_NODES = ["primitive_type", "type_identifier", "sized_type_specifier", "struct_specifier", "enum_specifier", "union_specifier"]
const DECLARATOR_NODES = ["init_declarator", "identifier", "pointer_declarator", "array_declarator", "function_declarator"]
const TYPE_NODES = ["struct_specifier", "union_specifier", "enum_specifier"]

enum ScopeKind {
  Global = "global",
  Function = "function",
  Block = "block",
  Struct = "struct",
  Union = "union",
}

interface ScopeEntry {
  kind: ScopeKind
  name: string
  node: Node
}

class CScopeManager {
  private stack: ScopeEntry[] = []

  constructor() {
    this.pushScope(ScopeKind.Global, "global", null as any)
  }

  pushScope(kind: ScopeKind, name: string, node: Node): void {
    this.stack.push({ kind, name, node })
  }

  popScope(): ScopeEntry | undefined {
    if (this.stack.length > 1) {
      return this.stack.pop()
    }
    return undefined
  }

  currentScope(): ScopeEntry {
    return this.stack[this.stack.length - 1]
  }

  getScopeName(): string {
    const parts = []
    for (let i = 1; i < this.stack.length; i++) {
      parts.push(this.stack[i].name)
    }
    return parts.length > 0 ? parts.join(".") : "global"
  }

  getCurrentFunctionName(): string | null {
    for (let i = this.stack.length - 1; i >= 0; i--) {
      if (this.stack[i].kind === ScopeKind.Function) return this.stack[i].name
    }
    return null
  }
}

export class RealCAnalyzer implements LanguageAnalyzer {
  analyze(rootNode: Node, content: string, filePath: string): ParseResult {
    // 1. ISOLATED STATE (Thread-Safe)
    const symbols: UniversalSymbol[] = []
    const relationships: UniversalRelationship[] = []
    const imports: ImportInfo[] = []
    const errors: ParseError[] = []
    const scopeManager = new CScopeManager()
    const emittedUseRelationships = new Set<string>()
    const functionLocals = new Map<string, Set<string>>()

    const structs: Record<string, any[]> = {}
    const globalVars: Record<string, boolean> = {}
    const unions: Record<string, any[]> = {}
    const enums: Record<string, boolean> = {}
    const patterns: Record<string, boolean> = {}

    // Track current active function for localized metadata updates
    let activeFunctionSymbol: UniversalSymbol | null = null

    // 2. METRICS TRACKED IN-PASS
    let cyclomaticComplexity = 1
    let mallocCount = 0
    let freeCount = 0
    let hasUnsafeStrings = false
    let hasSafeStrings = false
    let isKernelExport = false
    let hasGotoStatements = false
    let hasVolatileQualifier = false
    let hasRestrictQualifier = false
    let hasInlineAsm = false
    let hasSignalHandlers = false
    let hasSetjmpLongjmp = false
    let hasAtomicTypes = false
    let hasVariableFormatString = false  // printf(user_input) security risk
    let hasDangerousCalls = false        // system(), popen(), exec*()

    // ABI heuristics: default to LP64, adjust with architecture hints and platform headers
    let is64Bit = this.inferIs64Bit(content, filePath)
    let isLLP64 = this.inferIsLLP64(content)

    // 3. THE TRUE SINGLE-PASS UNIFIED WALK
    const stack: { node: Node; isConditional: boolean; isExit: boolean; pushedScope: boolean }[] = [
      { node: rootNode, isConditional: false, isExit: false, pushedScope: false },
    ]

    while (stack.length > 0) {
      const { node, isConditional, isExit, pushedScope } = stack.pop()!

      if (!node) continue

      if (isExit) {
        // --- Scope Management (Leave) ---
        if (pushedScope) {
          if (scopeManager.currentScope().kind === ScopeKind.Function) {
            activeFunctionSymbol = null
          }
          scopeManager.popScope()
        }
        continue
      }

      let willPushScope = false

      // --- Scope Management (Enter) ---
      switch (node.type) {
        case "function_definition": {
          const nameNode = this.getIdentifierFromDeclarator(node.childForFieldName("declarator"))
          if (nameNode && nameNode.text.trim()) {
            scopeManager.pushScope(ScopeKind.Function, nameNode.text, node)
            willPushScope = true
            activeFunctionSymbol = this.extractFunction(
              node,
              content,
              symbols,
              scopeManager.getScopeName(),
              isConditional,
            )
            const locals = new Set<string>()
            if (activeFunctionSymbol?.parameters) {
              for (let i = 0; i < activeFunctionSymbol.parameters.length; i++) {
                const p = activeFunctionSymbol.parameters[i]
                if (p && p.name && p.name !== "...") locals.add(p.name)
              }
            }
            functionLocals.set(nameNode.text, locals)
          }
          break
        }
        case "compound_statement":
          if (scopeManager.currentScope().node !== node.parent) {
            scopeManager.pushScope(ScopeKind.Block, `block_${node.startIndex}`, node)
            willPushScope = true
          }
          break
        case "struct_specifier": {
          const nameNode = node.childForFieldName("name")
    let structName = "anonymous_struct"
    if (nameNode && nameNode.text.trim()) {
      structName = nameNode.text
    } else if (node.parent && node.parent.type === "type_definition") {
      const declNode = this.getIdentifierFromDeclarator(node.parent.childForFieldName("declarator"))
      if (declNode && declNode.text.trim()) structName = declNode.text.trim()
    }
          scopeManager.pushScope(ScopeKind.Struct, structName, node)
          willPushScope = true
          this.extractStruct(
            node,
            symbols,
            structs,
            unions,
            is64Bit,
            isLLP64,
            scopeManager.getScopeName(),
            isConditional,
          )
          break
        }
        case "union_specifier": {
          const nameNode = node.childForFieldName("name")
    let unionName = "anonymous_union"
    if (nameNode && nameNode.text.trim()) {
      unionName = nameNode.text
    } else if (node.parent && node.parent.type === "type_definition") {
      const declNode = this.getIdentifierFromDeclarator(node.parent.childForFieldName("declarator"))
      if (declNode && declNode.text.trim()) unionName = declNode.text.trim()
    }
          scopeManager.pushScope(ScopeKind.Union, unionName, node)
          willPushScope = true
          this.extractUnion(node, symbols, unions, scopeManager.getScopeName(), isConditional)
          break
        }
        case "enum_specifier":
          this.extractEnum(node, symbols, enums, scopeManager.getScopeName(), isConditional)
          break
        case "declaration":
          {
            const currentFunction = scopeManager.getCurrentFunctionName()
            if (currentFunction) {
              const locals = functionLocals.get(currentFunction) || new Set<string>()
              const declared = this.collectDeclaredIdentifiers(node)
              for (let i = 0; i < declared.length; i++) {
                locals.add(declared[i])
              }
              functionLocals.set(currentFunction, locals)
            }
          }
          this.extractDeclaration(
            node,
            symbols,
            globalVars,
            scopeManager.getScopeName(),
            scopeManager.currentScope().kind === ScopeKind.Global,
            isConditional,
          )
          break
        case "type_definition":
          this.extractTypedef(node, symbols, structs, scopeManager.getScopeName(), isConditional)
          break
        case "preproc_def":
        case "preproc_function_def":
          patterns["Preprocessor Macros"] = true
          this.extractMacro(node, symbols, isConditional)
          break
        case "preproc_include":
          this.extractInclude(node, imports, (path) => {
            if (stringIncludes(path, "windows.h")) {
              isLLP64 = true
              is64Bit = true
            }
            if (stringIncludes(path, "sys/types.h") || stringIncludes(path, "stddef.h")) {
              // keep existing architecture assumption; these headers are cross-platform
              is64Bit = is64Bit
            }
          })
          // depends: #include creates a compile-time dependency on the header
          const includePath = this.getIncludePath(node)
          if (includePath) {
            relationships.push({
              source: scopeManager.getScopeName(),
              target: includePath,
              type: RelationshipType.References,
              confidence: 1.0,
              metadata: { relationshipType: "include_dependency", isSystem: includePath.startsWith("<") },
            })
          }
          break
      }

      stack.push({ node, isConditional, isExit: true, pushedScope: willPushScope })

      // --- Error Tracking ---
      if (node.type === "ERROR" || node.isMissing) {
        errors.push({
          message: "Syntax Error/Missing Node bypassed - Recovering AST Bounds",
          range: this.nodeToRange(node),
          severity: "warning",
        })
      }

      // --- In-Pass Metrics & Graph Detection ---
      if (
        inArray(COMPLEXITY_NODES, node.type)
      ) {
        cyclomaticComplexity++
      } else if (node.type === "goto_statement") {
        cyclomaticComplexity++
        hasGotoStatements = true
      } else if (node.type === "labeled_statement") {
        cyclomaticComplexity++ // each label is a potential jump target
      } else if (node.type === "type_qualifier") {
        if (node.text === "volatile") hasVolatileQualifier = true
        if (node.text === "restrict" || node.text === "__restrict") hasRestrictQualifier = true
        if (node.text === "_Atomic") hasAtomicTypes = true
      } else if (node.type === "gnu_asm_expression" || node.type === "asm_expression") {
        hasInlineAsm = true
        patterns["Inline Assembly"] = true
      } else if (node.type === "binary_expression") {
        const op = node.childForFieldName("operator")
        if (op && (op.text === "&&" || op.text === "||")) cyclomaticComplexity++
      } else if (node.type === "call_expression") {
        const fnNode = node.childForFieldName("function")
        if (fnNode) {
          let target = fnNode.text
          let isFuncPtr = false

          if (fnNode.type === "field_expression") {
            const field = fnNode.childForFieldName("field")
            if (field) target = field.text
            isFuncPtr = true
          } else if (fnNode.type === "parenthesized_expression") {
            isFuncPtr = true // simplified, we just assume paren is func ptr
          }

          if (target && target.trim() !== "") {
            relationships.push({
              source: scopeManager.getScopeName(),
              target: target,
              type: RelationshipType.Calls,
              confidence: 1.0,
              metadata: { relationshipType: "c_function_call", isFunctionPointer: isFuncPtr },
            })

            // Single pass security tracking
            if (inArray(MALLOC_FUNCTIONS, target)) {
              mallocCount++
              patterns["Dynamic Memory Management"] = true
              if (activeFunctionSymbol && activeFunctionSymbol.metadata) {
                activeFunctionSymbol.metadata.usesMalloc = true
              }
              // instantiates: malloc/calloc allocate new memory objects — treat as instantiation
              relationships.push({
                source: scopeManager.getScopeName(),
                target: target,
                type: RelationshipType.Instantiates,
                confidence: 0.9,
                metadata: { relationshipType: "memory_allocation", allocator: target },
              })
            } else if (inArray(FREE_FUNCTIONS, target)) {
              freeCount++
            } else if (inArray(UNSAFE_STRINGS, target)) {
              hasUnsafeStrings = true
            } else if (inArray(SAFE_STRINGS, target)) {
              hasSafeStrings = true
            } else if (inArray(EXPORT_MACROS, target)) {
              isKernelExport = true
              const arg = node.childForFieldName("arguments")?.namedChild(0)
              if (arg && arg.text.trim()) {
                relationships.push({
                  source: arg.text,
                  target: "KERNEL_EXPORT",
                  type: RelationshipType.Exports,
                  confidence: 1.0,
                  metadata: { relationshipType: "linux_kernel_export", exportMacro: target },
                })
              }
            } else if (inArray(FORMAT_FUNCTIONS, target)) {
              // Format string security: detect variable format arg (e.g., printf(user_input))
              const args = node.childForFieldName("arguments")
              if (args) {
                const firstArg = args.namedChild(0)
                if (firstArg && firstArg.type === "string_literal") {
                  patterns["Formatted I/O"] = true
                } else if (firstArg && firstArg.type !== "string_literal") {
                  hasVariableFormatString = true
                  patterns["Format String Vulnerability Risk"] = true
                }
              }
            } else if (inArray(DANGEROUS_FUNCTIONS, target)) {
              hasDangerousCalls = true
              patterns["Shell Command Execution Risk"] = true
            } else if (inArray(SIGNAL_FUNCTIONS, target)) {
              hasSignalHandlers = true
              patterns["Signal Handling"] = true
            } else if (target === "setjmp" || target === "longjmp" || target === "sigsetjmp" || target === "siglongjmp") {
              hasSetjmpLongjmp = true
              patterns["Non-Local Jumps"] = true
            }
          }
        }
      } else if (node.type === "field_expression") {
        // struct->field or struct.field access → References + field_access metadata
        const field = node.childForFieldName("field")
        const obj = node.childForFieldName("argument") || node.namedChild(0)
        if (field && field.text.trim()) {
          const sourceScope = scopeManager.getScopeName()
          const relKey = `${sourceScope}::uses::${field.text}`
          if (!emittedUseRelationships.has(relKey)) {
            emittedUseRelationships.add(relKey)
            relationships.push({
              source: sourceScope,
              target: field.text,
              type: RelationshipType.Uses,
              confidence: 0.9,
              metadata: { relationshipType: "field_access", accessedFrom: obj?.text },
            })
            // references: field access implies a reference to the struct member
            relationships.push({
              source: sourceScope,
              target: field.text,
              type: RelationshipType.References,
              confidence: 0.85,
              metadata: { relationshipType: "field_access", accessedFrom: obj?.text },
            })
          }
        }
      } else if (node.type === "init_declarator") {
        // Variable init from function return: Type *p = create_thing()
        const declName = this.getIdentifierFromDeclarator(node)
        const value = node.childForFieldName("value")
        if (declName && value && value.type === "call_expression") {
          const fnNode = value.childForFieldName("function")
          if (fnNode && fnNode.text.trim()) {
            relationships.push({
              source: declName.text,
              target: fnNode.text,
              type: RelationshipType.Uses,
              confidence: 0.85,
              metadata: { relationshipType: "init_from_call", callTarget: fnNode.text },
            })
          }
        }
      } else if (
        inArray(
          [
            "identifier",
            "field_identifier",
            "type_identifier",
            "struct_specifier",
            "union_specifier",
            "enum_specifier",
          ],
          node.type,
        )
      ) {
        let text = node.text
        if (inArray(["struct_specifier", "union_specifier", "enum_specifier"], node.type)) {
          const nameNode = node.childForFieldName("name")
          if (nameNode) text = nameNode.text
        }
        const sourceScope = scopeManager.getScopeName()
        const currentFunction = scopeManager.getCurrentFunctionName()
        const locals = currentFunction ? functionLocals.get(currentFunction) : undefined

        if (
          text &&
          text.trim() !== "" &&
          sourceScope !== "" &&
          !this.isDeclarationLikeIdentifier(node) &&
          !(locals && locals.has(text)) &&
          this.isResolvableUseTarget(text, node.type, symbols, globalVars, structs, unions, enums)
        ) {
          const relKey = `${sourceScope}::uses::${text}`
          if (!emittedUseRelationships.has(relKey)) {
            emittedUseRelationships.add(relKey)
            relationships.push({
              source: sourceScope,
              target: text,
              type: RelationshipType.Uses,
              confidence: 1.0,
              metadata: { relationshipType: node.type },
            })
            // references: general identifier usage → also a reference
            relationships.push({
              source: sourceScope,
              target: text,
              type: RelationshipType.References,
              confidence: 0.8,
              metadata: { relationshipType: "identifier_reference", nodeType: node.type },
            })
          }
        }
      }

      // --- Recurse ---
      for (let i = node.namedChildCount - 1; i >= 0; i--) {
        const child = node.namedChild(i)
        if (child) {
          const isCond =
            isConditional ||
            inArray(["preproc_ifdef", "preproc_if", "preproc_elif", "preproc_else"], child.parent?.type || "")
          stack.push({ node: child, isConditional: isCond, isExit: false, pushedScope: false })
        }
      }
    }

    // Patterns
    if (
      (function (o) {
        for (let k in o) return true
        return false
      })(structs)
    )
      patterns["Structured Data Types"] = true
    if (
      (function (o) {
        for (let k in o) return true
        return false
      })(unions)
    )
      patterns["Memory-Efficient Unions"] = true
    if (
      (function (o) {
        for (let k in o) return true
        return false
      })(enums)
    )
      patterns["Enumerated Constants"] = true

    // Frameworks & Phantoms
    const frameworks = this.detectCFrameworks(imports)
    this.injectPhantomSymbols(symbols, frameworks)

    // 4. METRIC CALCULATION
    let security = 50
    let maintainability = 50

    if (mallocCount > 0 && freeCount > 0) {
      if (mallocCount === freeCount) security += 25
      else security += 10
    }

    if (hasUnsafeStrings) security -= 30
    if (hasSafeStrings) security += 15
    if (hasGotoStatements) maintainability -= 10
    if (hasVolatileQualifier) patterns["Hardware-Aware Code"] = true
    if (hasRestrictQualifier) patterns["Strict Aliasing Optimization"] = true
    if (hasInlineAsm) { security -= 15; maintainability -= 10 }
    if (hasSignalHandlers) patterns["Signal-Driven Architecture"] = true
    if (hasSetjmpLongjmp) { security -= 20; patterns["Non-Local Control Flow"] = true }
    if (hasVariableFormatString) security -= 25
    if (hasDangerousCalls) security -= 20
    if (hasAtomicTypes) patterns["Lock-Free Concurrency"] = true

    if (cyclomaticComplexity > 15) maintainability -= 20
    if (cyclomaticComplexity > 50) maintainability -= 30

    const score = Math.round((security + maintainability) / 2)
    const patternsArray = (function (o) {
      const arr: string[] = []
      for (let k in o) arr.push(k)
      return arr
    })(patterns)

    const insights: any[] = []

    // Post-loop: add contains for owned symbols (struct→field, union→field, enum→constant)
    for (const s of symbols) {
      const _owner = s.ownerName || s.scope
      if (_owner) {
        relationships.push({
          source: _owner,
          target: s.name,
          type: RelationshipType.Contains,
          confidence: 1.0,
          metadata: {},
        })
      }
    }

    return {
      language: "c",
      symbols,
      relationships,
      imports,
      exports: symbols.filter((s) => s.visibility === "public" && (s.kind === SymbolKind.Function || s.kind === SymbolKind.Variable)).map((s) => ({
        name: s.name,
        type: s.kind,
        range: s.range,
        isType: false,
      })),
      errors,
      metadata: {
        complexity: symbols.length + relationships.length,
        linesOfCode: content.split("\n").length,
        cyclomaticComplexity,
        framework: frameworks[0] || "Standard C",
        patterns: patternsArray,
        detectedFrameworks: frameworks,
        frameworkPatterns: [{ framework: frameworks[0] || "C", patterns: patternsArray }],
        architecturalInsights: insights,
        architecturalScore: Math.min(100, Math.max(0, score)),
        codeQuality: score >= 80 ? "Excellent" : score >= 60 ? "Good" : "Fair",
        hasTypeInference: false,
        hasFrameworkIntelligence: true,
        memorySafetyScore: Math.min(100, Math.max(0, security)),
        performanceScore: Math.min(100, Math.max(0, maintainability)),
        portabilityScore: 75,
        analysisVersion: "5.0-c-native-ast-pure-single-pass",
      },
    }
  }

  // --- O(1) Extractor Helpers ---

  private findChild(node: Node, predicate: (child: Node) => boolean): Node | null {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (child && predicate(child)) return child
    }
    return null
  }

  private getIncludePath(node: Node): string | null {
    let pathNode = node.childForFieldName("path")
    if (!pathNode) {
      pathNode = this.findChild(node, (c) => c?.type === "string_literal" || c?.type === "system_lib_string") || null
    }
    return pathNode ? pathNode.text.replace(/[<>"]/g, "") : null
  }

  private extractInclude(node: Node, imports: ImportInfo[], onPath: (path: string) => void) {
    let pathNode = node.childForFieldName("path")
    if (!pathNode) {
      pathNode = this.findChild(node, (c) => c?.type === "string_literal" || c?.type === "system_lib_string") || null
    }
    if (pathNode && pathNode.text.trim()) {
      const rawPath = pathNode.text
      const isSystem = rawPath[0] === "<"
      onPath(rawPath)
      imports.push({
        module: rawPath.replace(/[<>"]/g, ""),
        items: ["*"],
        range: this.nodeToRange(node),
        metadata: { isSystemInclude: isSystem },
      })
    }
  }

  private extractFunction(
    node: Node,
    content: string,
    symbols: UniversalSymbol[],
    scope: string,
    isConditional: boolean,
  ): UniversalSymbol | null {
    const declaratorNode = node.childForFieldName("declarator")
    const nameNode = this.getIdentifierFromDeclarator(declaratorNode)
    if (!nameNode) return null

    const isStatic = this.hasStorageClass(node, "static")
    const isInline = this.hasStorageClass(node, "inline")
    let usesPointers = this.isPointerType(declaratorNode)

    let returnTypeNode =
      node.childForFieldName("type") ||
      this.findChild(node, (c) =>
        inArray(
          [
            "primitive_type",
            "type_identifier",
            "sized_type_specifier",
            "struct_specifier",
            "enum_specifier",
            "union_specifier",
          ],
          c?.type || "",
        ),
      )

    const parameters: Parameter[] = []

    // Deeper parameter scan without crashing loops
    let pList = this.findFirstChildOfType(declaratorNode, "parameter_list")

    if (pList) {
      for (let i = 0; i < pList.namedChildCount; i++) {
        const paramNode = pList.namedChild(i)
        if (paramNode && (paramNode.type === "parameter_declaration" || paramNode.type === "variadic_parameter")) {
          if (paramNode.type === "variadic_parameter") {
            parameters.push({ name: "...", type: "variadic", modifiers: [] })
            continue
          }
          const typeNode = paramNode.childForFieldName("type")
          const pDeclNode = this.getIdentifierFromDeclarator(paramNode.childForFieldName("declarator"))
          let paramType = typeNode ? typeNode.text : "any"
          const isFuncPtr = paramNode.text.includes("(*") || paramNode.text.includes("(^") || !!this.findFirstChildOfType(paramNode.childForFieldName("declarator"), "function_declarator")
          if (isFuncPtr) paramType = "function_pointer"
          
          parameters.push({
            name: pDeclNode ? pDeclNode.text : "unknown",
            type: paramType,
          })
          if (this.isPointerType(paramNode.childForFieldName("declarator"))) {
            usesPointers = true
          }
        }
      }
    }

    const symbol: UniversalSymbol = {
      name: nameNode.text,
      kind: SymbolKind.Function,
      range: this.recoverFunctionRange(node, content),
      scope: "global",
      visibility: isStatic ? "private" : "public",
      isStatic,
      returnType: returnTypeNode ? returnTypeNode.text : "any",
      parameters,
      metadata: { cSpecific: true, usesPointers, isInline, isConditional },
    }

    symbols.push(symbol)
    return symbol
  }

  private extractStruct(
    node: Node,
    symbols: UniversalSymbol[],
    structs: Record<string, any[]>,
    unions: Record<string, any[]>,
    is64Bit: boolean,
    isLLP64: boolean,
    scope: string,
    isConditional: boolean,
  ) {
    const nameNode = node.childForFieldName("name")
    let structName = "anonymous_struct"
    if (nameNode && nameNode.text.trim()) {
      structName = nameNode.text
    } else if (node.parent && node.parent.type === "type_definition") {
      const declNode = this.getIdentifierFromDeclarator(node.parent.childForFieldName("declarator"))
      if (declNode && declNode.text.trim()) structName = declNode.text.trim()
    }
    const isPacked = this.isPacked(node)

    const fields: any[] = []
    const bodyList = node.childForFieldName("body")
    if (bodyList) {
      for (let i = 0; i < bodyList.namedChildCount; i++) {
        const field = bodyList.namedChild(i)
        if (field && field.type === "field_declaration") {
          let typeNode =
            field.childForFieldName("type") ||
            this.findChild(field, (c) =>
              inArray(
                [
                  "primitive_type",
                  "type_identifier",
                  "sized_type_specifier",
                  "struct_specifier",
                  "enum_specifier",
                  "union_specifier",
                ],
                c?.type || "",
              ),
            )

          for (let j = 0; j < field.childCount; j++) {
            const rawDecl = field.child(j)
            if (
              rawDecl &&
              !inArray(
                [
                  "primitive_type",
                  "type_identifier",
                  ";",
                  "type_qualifier",
                  "storage_class_specifier",
                  "sized_type_specifier",
                  "struct_specifier",
                  "union_specifier",
                  "enum_specifier",
                  ",",
                  "bitfield_clause",
                ],
                rawDecl.type,
              )
            ) {
              let arraySize = 1
              let isPointer = this.isPointerType(rawDecl)
              let declNode: Node | null = rawDecl

              while (declNode && declNode.type !== "field_identifier" && declNode.type !== "identifier") {
                if (declNode.type === "array_declarator") {
                  const sizeNode =
                    declNode.childForFieldName("size") || this.findChild(declNode, (c) => c?.type === "number_literal")
                  if (sizeNode && !isNaN(parseInt(sizeNode.text))) arraySize *= parseInt(sizeNode.text)
                }
                declNode = declNode.childForFieldName("declarator") || declNode.namedChild(0)
              }

              if (declNode && declNode.text.trim()) {
                fields.push({ name: declNode.text, type: typeNode ? typeNode.text : "unknown", arraySize, isPointer })
                symbols.push({
                  name: declNode.text,
                  kind: SymbolKind.Property,
                  range: this.nodeToRange(rawDecl),
                  scope: structName,
                  ownerName: structName,
                  ownerKind: SymbolKind.Type,
                  visibility: "public",
                  metadata: { isStructField: true, cSpecific: true, isConditional },
                })
              }
            }
          }
        }
      }
    }

    if (structName !== "anonymous_struct") {
      structs[structName] = fields
    }

    symbols.push({
      name: structName,
      kind: SymbolKind.Type,
      range: this.nodeToRange(node),
      scope: scope,
      visibility: "public",
      metadata: {
        isStruct: true,
        cSpecific: true,
        isPacked,
        isConditional,
        memorySize: this.calculateMemorySize(fields, isPacked, structs, unions, is64Bit, isLLP64),
        alignment: this.calculateAlignment(fields, structs, unions, is64Bit, isLLP64),
      },
    })
  }

  private extractUnion(
    node: Node,
    symbols: UniversalSymbol[],
    unions: Record<string, any[]>,
    scope: string,
    isConditional: boolean,
  ) {
    const nameNode = node.childForFieldName("name")
    let unionName = "anonymous_union"
    if (nameNode && nameNode.text.trim()) {
      unionName = nameNode.text
    } else if (node.parent && node.parent.type === "type_definition") {
      const declNode = this.getIdentifierFromDeclarator(node.parent.childForFieldName("declarator"))
      if (declNode && declNode.text.trim()) unionName = declNode.text.trim()
    }

    const fields: any[] = []
    const bodyList = node.childForFieldName("body")
    if (bodyList) {
      for (let i = 0; i < bodyList.namedChildCount; i++) {
        const field = bodyList.namedChild(i)
        if (field && field.type === "field_declaration") {
          let typeNode =
            field.childForFieldName("type") ||
            this.findChild(field, (c) =>
              inArray(
                [
                  "primitive_type",
                  "type_identifier",
                  "sized_type_specifier",
                  "struct_specifier",
                  "enum_specifier",
                  "union_specifier",
                ],
                c?.type || "",
              ),
            )

          for (let j = 0; j < field.childCount; j++) {
            const rawDecl = field.child(j)
            if (
              rawDecl &&
              !inArray(
                [
                  "primitive_type",
                  "type_identifier",
                  ";",
                  "type_qualifier",
                  "storage_class_specifier",
                  "sized_type_specifier",
                  "struct_specifier",
                  "union_specifier",
                  "enum_specifier",
                  ",",
                  "bitfield_clause",
                ],
                rawDecl.type,
              )
            ) {
              let arraySize = 1
              let isPointer = this.isPointerType(rawDecl)
              let declNode: any = rawDecl

              while (declNode && declNode.type !== "field_identifier" && declNode.type !== "identifier") {
                if (declNode.type === "array_declarator") {
                  const sizeNode =
                    declNode.childForFieldName("size") ||
                    this.findChild(declNode, (c: any) => c?.type === "number_literal")
                  if (sizeNode && !isNaN(parseInt(sizeNode.text))) arraySize *= parseInt(sizeNode.text)
                }
                declNode = declNode.childForFieldName("declarator") || declNode.namedChild(0)
              }

              if (declNode && declNode.text.trim()) {
                fields.push({ name: declNode.text, type: typeNode ? typeNode.text : "unknown", arraySize, isPointer })
                symbols.push({
                  name: declNode.text,
                  kind: SymbolKind.Property,
                  range: this.nodeToRange(rawDecl),
                  scope: unionName,
                  ownerName: unionName,
                  ownerKind: SymbolKind.Type,
                  visibility: "public",
                  metadata: { isUnionField: true, cSpecific: true, isConditional },
                })
              }
            }
          }
        }
      }
    }

    if (unionName !== "anonymous_union") {
      unions[unionName] = fields
    }

    symbols.push({
      name: unionName,
      kind: SymbolKind.Type,
      range: this.nodeToRange(node),
      scope: scope,
      visibility: "public",
      metadata: { isUnion: true, cSpecific: true, isConditional },
    })
  }

  private extractEnum(
    node: Node,
    symbols: UniversalSymbol[],
    enums: Record<string, boolean>,
    scope: string,
    isConditional: boolean,
  ) {
    const nameNode = node.childForFieldName("name")
    const enumName = nameNode && nameNode.text.trim() ? nameNode.text : "anonymous_enum"
    enums[enumName] = true

    const values: string[] = []
    let hasExplicitValues = false
    let isFlagEnum = false

    let listNode = node.childForFieldName("body") || this.findFirstChildOfType(node, "enumerator_list")

    if (listNode) {
      for (let i = 0; i < listNode.namedChildCount; i++) {
        const enumerator = listNode.namedChild(i)
        if (enumerator && enumerator.type === "enumerator") {
          const enumNameNode = enumerator.childForFieldName("name") || enumerator.namedChild(0)

          if (enumNameNode && enumNameNode.text.trim()) {
            values.push(enumNameNode.text)

            const valueNode = enumerator.childForFieldName("value")
            if (valueNode) {
              hasExplicitValues = true
              if (
                this.findFirstChildOfType(
                  valueNode,
                  "binary_expression",
                  (n) => n.childForFieldName("operator")?.text === "<<",
                )
              ) {
                isFlagEnum = true
              }
            }

            symbols.push({
              name: enumNameNode.text,
              kind: SymbolKind.EnumMember,
              range: this.nodeToRange(enumerator),
              scope: enumName,
              ownerName: enumName,
              ownerKind: SymbolKind.Enum,
              visibility: "public",
              metadata: { isEnumValue: true, cSpecific: true, isConditional },
            })
          }
        }
      }
    }

    symbols.push({
      name: enumName,
      kind: SymbolKind.Enum,
      range: this.nodeToRange(node),
      scope: scope,
      visibility: "public",
      metadata: { isEnum: true, cSpecific: true, values, hasExplicitValues, isFlagEnum, isConditional },
    })
  }

  private extractDeclaration(
    node: Node,
    symbols: UniversalSymbol[],
    globalVars: Record<string, boolean>,
    scope: string,
    isGlobal: boolean,
    isConditional: boolean,
  ) {
    const isStatic = this.hasStorageClass(node, "static")

    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (
        child &&
        inArray(
          ["init_declarator", "identifier", "pointer_declarator", "array_declarator", "function_declarator"],
          child.type,
        )
      ) {
        let isFuncType = false
        let c: Node | null = child
        while (c) {
          if (c.type === "function_declarator") {
            isFuncType = true
            const innerDecl = c?.childForFieldName("declarator")
            if (innerDecl && innerDecl.type === "parenthesized_declarator") {
              isFuncType = false // function pointer
            }
            break
          }
          c = c?.childForFieldName("declarator") || (c.namedChildCount > 0 ? c.namedChild(0) : null)
        }
        let declNode = this.getIdentifierFromDeclarator(child)

        if (declNode && declNode.text.trim()) {
          if (isFuncType) {
            symbols.push({
              name: declNode.text,
              kind: SymbolKind.Function,
              range: this.nodeToRange(node),
              scope: isGlobal ? "global" : scope,
              visibility: "public",
              metadata: { isDeclaration: true, cSpecific: true, isConditional },
            })
          } else {
            if (isGlobal) globalVars[declNode.text] = true
            symbols.push({
              name: declNode.text,
              kind: SymbolKind.Variable,
              range: this.nodeToRange(child),
              scope: isGlobal ? "global" : scope,
              visibility: isStatic ? "private" : "public",
              metadata: { isVariable: true, cSpecific: true, isGlobal, isConditional },
            })
          }
        }
      }
    }
  }

  private extractTypedef(
    node: Node,
    symbols: UniversalSymbol[],
    structs: Record<string, any[]>,
    scope: string,
    isConditional: boolean,
  ) {
    const identNode = this.getIdentifierFromDeclarator(node.childForFieldName("declarator"))
    if (identNode && identNode.text.trim()) {
      symbols.push({
        name: identNode.text,
        kind: SymbolKind.Type,
        range: this.nodeToRange(node),
        scope: scope,
        visibility: "public",
        metadata: { isTypedef: true, cSpecific: true, isConditional },
      })
    }
  }

  private extractMacro(node: Node, symbols: UniversalSymbol[], isConditional: boolean) {
    const nameNode = node.childForFieldName("name")
    if (nameNode && nameNode.text.trim()) {
      const isFunctionLikeMacro = node.type === "preproc_function_def"
      const parameters: Parameter[] = []

      if (isFunctionLikeMacro) {
        const paramsNode = node.childForFieldName("parameters") || this.findFirstChildOfType(node, "preproc_params")
        if (paramsNode) {
          for (let i = 0; i < paramsNode.childCount; i++) {
            const param = paramsNode.child(i)
            if (param && param.isNamed) {
              parameters.push({ name: param.text, type: "any" })
            } else if (param && (param.type === "..." || param.text === "...")) {
              parameters.push({ name: "...", type: "variadic", modifiers: [] })
            }
          }
        }
      }

      symbols.push({
        name: nameNode.text,
        kind: isFunctionLikeMacro ? SymbolKind.Function : SymbolKind.Constant,
        range: this.nodeToRange(node),
        scope: "global",
        visibility: "public",
        parameters: isFunctionLikeMacro ? parameters : undefined,
        metadata: { isMacro: true, isFunctionLikeMacro, cSpecific: true, isConditional },
      })
    }
  }

  // --- Shallow Memory Math ---
  private calculateMemorySize(
    fields: any[],
    isPacked: boolean,
    structs: Record<string, any[]>,
    unions: Record<string, any[]>,
    is64Bit: boolean,
    isLLP64: boolean,
    isUnion: boolean = false,
  ): number {
    let currentOffset = 0
    let maxAlign = 1
    let maxSize = 0
    const ptrSize = is64Bit ? 8 : 4
    const longSize = is64Bit && !isLLP64 ? 8 : 4

    for (let i = 0; i < fields.length; i++) {
      const field = fields[i]
      const type = field.type
      let fieldSize = 4
      let align = 4

      if (field.isPointer) {
        fieldSize = ptrSize
        align = ptrSize
      } else if (inArray(["char", "int8_t", "uint8_t", "bool"], type)) {
        fieldSize = 1
        align = 1
      } else if (inArray(["short", "int16_t", "uint16_t"], type)) {
        fieldSize = 2
        align = 2
      } else if (inArray(["long"], type)) {
        fieldSize = longSize
        align = longSize
      } else if (inArray(["double", "int64_t", "uint64_t", "size_t", "ssize_t"], type)) {
        fieldSize = 8
        align = 8
      } else if (structs[type]) {
        fieldSize = this.calculateMemorySize(structs[type], false, structs, unions, is64Bit, isLLP64, false)
        align = this.calculateAlignment(structs[type], structs, unions, is64Bit, isLLP64)
      } else if (unions[type]) {
        fieldSize = this.calculateMemorySize(unions[type], false, structs, unions, is64Bit, isLLP64, true)
        align = this.calculateAlignment(unions[type], structs, unions, is64Bit, isLLP64)
      }

      if (isPacked) align = 1
      maxAlign = Math.max(maxAlign, align)

      const totalFieldSize = fieldSize * (field.arraySize || 1)
      if (isUnion) {
        maxSize = Math.max(maxSize, totalFieldSize)
      } else {
        const padding = (align - (currentOffset % align)) % align
        currentOffset += padding + totalFieldSize
      }
    }

    if (isUnion) {
      currentOffset = maxSize
    }

    if (!isPacked && maxAlign > 1) {
      currentOffset += (maxAlign - (currentOffset % maxAlign)) % maxAlign
    }
    return currentOffset
  }

  private calculateAlignment(
    fields: any[],
    structs: Record<string, any[]>,
    unions: Record<string, any[]>,
    is64Bit: boolean,
    isLLP64: boolean,
  ): number {
    let align = 1
    for (let i = 0; i < fields.length; i++) {
      const field = fields[i]
      if (field.isPointer || inArray(["size_t", "ssize_t"], field.type)) align = Math.max(align, is64Bit ? 8 : 4)
      else if (field.type === "long") align = Math.max(align, is64Bit && !isLLP64 ? 8 : 4)
      else if (inArray(["double", "int64_t", "uint64_t"], field.type)) align = Math.max(align, 8)
      else if (inArray(["int", "float", "int32_t", "uint32_t"], field.type)) align = Math.max(align, 4)
      else if (inArray(["short", "int16_t", "uint16_t"], field.type)) align = Math.max(align, 2)
      else if (structs[field.type])
        align = Math.max(align, this.calculateAlignment(structs[field.type], structs, unions, is64Bit, isLLP64))
      else if (unions[field.type])
        align = Math.max(align, this.calculateAlignment(unions[field.type], structs, unions, is64Bit, isLLP64))
    }
    return align
  }

  // --- Safe Shallow Helpers ---

  private getIdentifierFromDeclarator(node: Node | null): Node | null {
    let current = node
    while (current && !inArray(["identifier", "field_identifier", "type_identifier"], current.type)) {
      current = current.childForFieldName("declarator") || current.namedChild(0)
    }
    return current
  }

  private collectDeclaredIdentifiers(node: Node): string[] {
    const namesObj: Record<string, boolean> = {}
    const stack: Node[] = [node]
    while (stack.length > 0) {
      const curr = stack.pop()
      if (!curr) continue

      if (
        inArray(
          ["init_declarator", "identifier", "pointer_declarator", "array_declarator", "function_declarator"],
          curr.type,
        )
      ) {
        const decl = this.getIdentifierFromDeclarator(curr)
        if (decl && decl.text.trim()) namesObj[decl.text] = true
      }

      for (let i = curr.namedChildCount - 1; i >= 0; i--) {
        const child = curr.namedChild(i)
        if (child) stack.push(child)
      }
    }

    const names: string[] = []
    for (const k in namesObj) names.push(k)
    return names
  }

  private isDeclarationLikeIdentifier(node: Node): boolean {
    const p = node.parent
    if (!p) return false
    return inArray(
      [
        "declaration",
        "parameter_declaration",
        "field_declaration",
        "init_declarator",
        "function_declarator",
        "pointer_declarator",
        "array_declarator",
        "type_definition",
        "enumerator",
        "preproc_def",
        "preproc_function_def",
      ],
      p.type,
    )
  }

  private isResolvableUseTarget(
    name: string,
    nodeType: string,
    symbols: UniversalSymbol[],
    globalVars: Record<string, boolean>,
    structs: Record<string, any[]>,
    unions: Record<string, any[]>,
    enums: Record<string, boolean>,
  ): boolean {
    if (!name || !name.trim()) return false
    if (inArray(["NULL", "true", "false", "..."], name)) return false

    if (inArray(["type_identifier", "struct_specifier", "union_specifier", "enum_specifier"], nodeType)) return true
    if (globalVars[name] || structs[name] || unions[name] || enums[name]) return true

    for (let i = 0; i < symbols.length; i++) {
      const s = symbols[i]
      if (!s || s.name !== name) continue
      if (
        s.scope === "global" ||
        s.kind === SymbolKind.Type ||
        s.kind === SymbolKind.Enum ||
        s.kind === SymbolKind.Function ||
        s.kind === SymbolKind.Constant
      ) {
        return true
      }
    }
    return false
  }

  private inferIs64Bit(content: string, filePath: string): boolean {
    const hints64 = ["__LP64__", "_LP64", "__x86_64__", "__aarch64__", "__ppc64__", "__s390x__"]
    for (let i = 0; i < hints64.length; i++) {
      if (stringIncludes(content, hints64[i])) return true
    }

    const hints32 = ["__ILP32__", "__i386__", "__arm__", "__mips__"]
    for (let i = 0; i < hints32.length; i++) {
      if (stringIncludes(content, hints32[i])) return false
    }

    if (stringIncludes(content, "_WIN64")) return true
    if (stringIncludes(content, "_WIN32")) return false
    if (stringIncludes(filePath, "x86_64") || stringIncludes(filePath, "aarch64")) return true
    if (stringIncludes(filePath, "i386") || stringIncludes(filePath, "armv7")) return false

    return true
  }

  private inferIsLLP64(content: string): boolean {
    return stringIncludes(content, "_WIN64") || stringIncludes(content, "windows.h")
  }

  private recoverFunctionRange(node: Node, content: string): UniversalSymbol["range"] {
    const base = this.nodeToRange(node)
    const body = node.childForFieldName("body")

    let openBraceIdx = -1
    if (body) {
      openBraceIdx = content.indexOf("{", body.startIndex)
    }

    if (openBraceIdx < 0) {
      const declarator = node.childForFieldName("declarator")
      const searchFrom = declarator ? declarator.endIndex : node.startIndex
      openBraceIdx = content.indexOf("{", searchFrom)
      if (openBraceIdx < 0 || openBraceIdx > node.startIndex + 32768) return base
    }

    let depth = 0
    let inLineComment = false
    let inBlockComment = false
    let inSingleQuote = false
    let inDoubleQuote = false
    let escaped = false

    for (let i = openBraceIdx; i < content.length; i++) {
      const ch = content[i]
      const next = i + 1 < content.length ? content[i + 1] : ""

      if (inLineComment) {
        if (ch === "\n") inLineComment = false
        continue
      }
      if (inBlockComment) {
        if (ch === "*" && next === "/") {
          inBlockComment = false
          i++
        }
        continue
      }

      if (inSingleQuote) {
        if (escaped) {
          escaped = false
        } else if (ch === "\\") {
          escaped = true
        } else if (ch === "'") {
          inSingleQuote = false
        }
        continue
      }

      if (inDoubleQuote) {
        if (escaped) {
          escaped = false
        } else if (ch === "\\") {
          escaped = true
        } else if (ch === '"') {
          inDoubleQuote = false
        }
        continue
      }

      if (ch === "/" && next === "/") {
        inLineComment = true
        i++
        continue
      }
      if (ch === "/" && next === "*") {
        inBlockComment = true
        i++
        continue
      }
      if (ch === "'") {
        inSingleQuote = true
        continue
      }
      if (ch === '"') {
        inDoubleQuote = true
        continue
      }

      if (ch === "{") depth++
      else if (ch === "}") {
        depth--
        if (depth === 0) {
          const endIndex = i + 1
          const pos = this.indexToLineColumn(content, endIndex)
          return {
            startLine: base.startLine,
            startColumn: base.startColumn,
            endLine: pos.line,
            endColumn: pos.column,
            startIndex: base.startIndex,
            endIndex,
          }
        }
      }
    }

    return base
  }

  private indexToLineColumn(content: string, index: number): { line: number; column: number } {
    let line = 1
    let column = 1
    const max = Math.min(index, content.length)
    for (let i = 0; i < max; i++) {
      if (content[i] === "\n") {
        line++
        column = 1
      } else {
        column++
      }
    }
    return { line, column }
  }

  private isPointerType(node: Node | null): boolean {
    let current = node
    while (current) {
      if (current.type === "pointer_declarator") return true
      current = current.childForFieldName("declarator") || (current.namedChildCount > 0 ? current.namedChild(0) : null)
    }
    return false
  }

  private hasStorageClass(node: Node, className: string): boolean {
    return !!this.findChild(node, (c) => c?.type === "storage_class_specifier" && c.text === className)
  }

  private isPacked(node: Node): boolean {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (!child) continue
      if (child.type === "attribute_specifier" || child.type === "attribute") {
        if (stringIncludes(child.text, "packed")) return true
      }
    }
    return false
  }

  private findFirstChildOfType(node: Node | null, type: string, condition?: (n: Node) => boolean): Node | null {
    if (!node) return null
    const stack: Node[] = [node]
    while (stack.length > 0) {
      const current = stack.pop()!
      if (current.type === type && (!condition || condition(current))) return current
      for (let i = current.namedChildCount - 1; i >= 0; i--) {
        const child = current.namedChild(i)
        if (child) stack.push(child)
      }
    }
    return null
  }

  private detectCFrameworks(imports: ImportInfo[]): string[] {
    const frameworks: Record<string, boolean> = {}
    for (let idx = 0; idx < imports.length; idx++) {
      const i = imports[idx]
      const m = i.module
      if (!m) continue
      if (stringIncludes(m, "stdio.h") || stringIncludes(m, "stdlib.h")) frameworks["Standard C Library"] = true
      if (stringIncludes(m, "unistd.h") || stringIncludes(m, "pthread.h")) frameworks["POSIX"] = true
      if (stringIncludes(m, "windows.h")) frameworks["Windows API"] = true
      if (m.startsWith("gtk/")) frameworks["GTK"] = true
      if (stringIncludes(m, "glib.h")) frameworks["GLib"] = true
      if (m.startsWith("SDL")) frameworks["SDL"] = true
      if (stringIncludes(m, "linux/module.h")) frameworks["linux_kernel"] = true
      if (stringIncludes(m, "FreeRTOS.h")) frameworks["freertos"] = true
    }
    const arr: string[] = []
    for (const f in frameworks) arr.push(f)
    return arr
  }

  private injectPhantomSymbols(symbols: UniversalSymbol[], frameworks: string[]): void {
    if (!inArray(frameworks, "GLib") && !inArray(frameworks, "GTK")) return

    const types: UniversalSymbol[] = []
    for (let i = 0; i < symbols.length; i++) {
      if (symbols[i].kind === SymbolKind.Type && symbols[i].name.endsWith("Class")) {
        types.push(symbols[i])
      }
    }
    for (let idx = 0; idx < types.length; idx++) {
      const symbol = types[idx]
      symbols.push({
        name: `${symbol.name.replace("Class", "").toLowerCase()}_get_type`,
        kind: SymbolKind.Function,
        scope: "global",
        visibility: "public",
        range: symbol.range,
        parameters: [],
        returnType: "GType",
        metadata: { isPhantom: true },
      })
    }
  }

  private nodeToRange(node: Node): UniversalSymbol["range"] {
    const startRow =
      node && node.startPosition && typeof node.startPosition.row === "number" ? node.startPosition.row : 0
    const startCol =
      node && node.startPosition && typeof node.startPosition.column === "number" ? node.startPosition.column : 0
    const endRow =
      node && node.endPosition && typeof node.endPosition.row === "number" ? node.endPosition.row : startRow
    const endCol =
      node && node.endPosition && typeof node.endPosition.column === "number" ? node.endPosition.column : startCol
    const startIndex = node && typeof node.startIndex === "number" ? node.startIndex : 0
    const endIndex = node && typeof node.endIndex === "number" ? node.endIndex : startIndex

    return {
      startLine: startRow + 1,
      startColumn: startCol + 1,
      endLine: endRow + 1,
      endColumn: endCol + 1,
      startIndex,
      endIndex,
    }
  }
}
