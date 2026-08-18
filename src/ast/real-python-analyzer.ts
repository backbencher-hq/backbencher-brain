// Real Python Intelligence Engine
// AST analysis for Python — pure Tree-sitter extraction, no regex fallbacks.
// M12.27 rewrite: scripting-family contract (JS/TS precedent) — module-level
// symbols ownerless (Python has no module declaration), class → member
// contains, leaf-target calls with a Python builtin filter, uppercase-head
// calls → instantiates, extends from the base-class argument list, imports
// as `imports module -> path:item`, exports from __all__, overrides via the
// harness companion index.

import type { Node } from "web-tree-sitter"
import { ASTEngine } from "./engine"

interface PythonScope {
  node: Node
  name: string
  kind: ASTEngine.SymbolKind
}

interface PythonContext {
  content: string
  filePath: string
  symbols: ASTEngine.UniversalSymbol[]
  relationships: ASTEngine.UniversalRelationship[]
  imports: ASTEngine.ImportInfo[]
  exports: ASTEngine.ExportInfo[]
  errors: ASTEngine.ParseError[]
  frameworks: Record<string, boolean>
  patterns: Record<string, boolean>
  // O(1) call-source/declaration lookups
  functionSymbolIndex: Record<string, number>
  // O(1) instantiates check: names of in-file declared classes/enums
  declaredTypes: Set<string>
  seenRels: Set<string>
  currentModule: string | undefined
  currentClass: string | undefined
  currentFunction: string | undefined
  moduleName: string
}

// Python builtins — never legitimate in-file call targets.
const PYTHON_BUILTINS = new Set([
  "abs", "all", "any", "ascii", "bin", "bool", "breakpoint", "bytearray", "bytes",
  "callable", "chr", "classmethod", "compile", "complex", "delattr", "dict",
  "dir", "divmod", "enumerate", "eval", "exec", "filter", "float", "format",
  "frozenset", "getattr", "globals", "hasattr", "hash", "help", "hex", "id",
  "input", "int", "isinstance", "issubclass", "iter", "len", "list", "locals",
  "map", "max", "memoryview", "min", "next", "object", "oct", "open", "ord",
  "pow", "print", "property", "range", "repr", "reversed", "round", "set",
  "setattr", "slice", "sorted", "staticmethod", "str", "sum", "super", "tuple",
  "type", "vars", "zip", "__import__",
])

const DENYLISTED_SYMBOL_NAMES = new Set([
  "self", "cls", "this", "super", "None", "True", "False",
])

export class RealPythonAnalyzer implements ASTEngine.LanguageAnalyzer {
  analyze(rootNode: Node, content: string, filePath: string): ASTEngine.ParseResult {
    // Regex-free module-name derivation: last path segment minus its final
    // extension (pure char scan — the extension is after the LAST dot).
    const base = filePath.split("/").pop() || "module"
    const dotIndex = base.lastIndexOf(".")
    const moduleName = dotIndex > 0 ? base.slice(0, dotIndex) : base
    const ctx: PythonContext = {
      content,
      filePath,
      symbols: [],
      relationships: [],
      imports: [],
      exports: [],
      errors: [],
      frameworks: {},
      patterns: {},
      functionSymbolIndex: {},
      declaredTypes: new Set(),
      seenRels: new Set(),
      currentModule: moduleName,
      currentClass: undefined,
      currentFunction: undefined,
      moduleName,
    }

    let cyclomaticComplexity = 1

    // Iterative stack traversal (no recursion, no call-stack explosions).
    // Each frame carries the node plus scope bookkeeping so class/function
    // nesting is tracked exactly (siblings never inherit a parent scope).
    const stack: {
      node: Node
      isExit?: boolean
      // Exit frames ALWAYS restore both scopes (may restore to undefined).
      setClass?: string
      setFunc?: string
    }[] = [{ node: rootNode }]

    while (stack.length > 0) {
      const { node, isExit, setClass, setFunc } = stack.pop()!

      if (isExit) {
        ctx.currentClass = setClass
        ctx.currentFunction = setFunc
        continue
      }

      if (node.isMissing) continue

      if (node.hasError) {
        if (node.type === "ERROR") {
          ctx.errors.push({
            message: `Syntax ${node.type} detected. The Brain Engine is bypassing this broken node.`,
            range: this.nodeToRange(node),
            severity: "warning",
          })
        }
      }

      // --- Complexity: the grammar's emitted decision points ---
      if (
        node.type === "if_statement" || node.type === "elif_clause" ||
        node.type === "for_statement" || node.type === "while_statement" ||
        node.type === "match_statement" || node.type === "case_clause" ||
        node.type === "try_statement" || node.type === "except_clause" ||
        node.type === "with_statement" || node.type === "conditional_expression"
      ) {
        cyclomaticComplexity++
      } else if (node.type === "boolean_operator") {
        // `and`/`or` are anonymous operator tokens at child index 1.
        for (let i = 0; i < node.childCount; i++) {
          const c = node.child(i)
          if (c && (c.type === "and" || c.type === "or")) {
            cyclomaticComplexity++
            break
          }
        }
      }

      // --- Pattern tracking (metadata only, never synthetic symbols) ---
      if (node.type === "list_comprehension" || node.type === "set_comprehension" ||
          node.type === "dictionary_comprehension" || node.type === "generator_expression") {
        ctx.patterns["Comprehensions"] = true
      }
      if (node.type === "lambda") ctx.patterns["Lambdas"] = true
      if (node.type === "yield") ctx.patterns["Generators"] = true
      if (node.type === "await") ctx.patterns["Async"] = true
      if (node.type === "assert_statement") ctx.patterns["Assertions"] = true

      switch (node.type) {
        case "class_definition": {
          const nameNode = this.findChildByType(node, "identifier")
          if (nameNode && nameNode.text && !DENYLISTED_SYMBOL_NAMES.has(nameNode.text)) {
            this.extractClass(node, ctx)
            const prevClass = ctx.currentClass
            const prevFunc = ctx.currentFunction
            ctx.currentClass = nameNode.text
            ctx.currentFunction = undefined
            stack.push({
              node,
              isExit: true,
              setClass: prevClass,
              setFunc: prevFunc,
            })
          }
          break
        }
        case "function_definition": {
          // NOTE: this grammar emits `function_definition` for async defs too
          // (an anonymous `async` token is child 0) — `async_function_definition`
          // never appears. Async-ness is detected via the token scan below.
          const nameNode = this.findChildByType(node, "identifier")
          if (nameNode && nameNode.text && !DENYLISTED_SYMBOL_NAMES.has(nameNode.text)) {
            // Nested function inside another function body: scoped noise —
            // NOT a symbol, and its body's calls attribute to the enclosing
            // function (JS-family contract: locals/params/lambda-params are
            // not symbols; inner bodies keep the outer call source).
            if (ctx.currentFunction) break
            if (ctx.currentClass) {
              this.extractMethod(node, ctx.currentClass, ctx)
            } else {
              this.extractFunction(node, ctx)
            }
            const prevFunc = ctx.currentFunction
            ctx.currentFunction = nameNode.text
            stack.push({
              node,
              isExit: true,
              setClass: ctx.currentClass,
              setFunc: prevFunc,
            })
          }
          break
        }
        case "import_statement":
        case "import_from_statement": {
          this.extractImport(node, ctx)
          break
        }
        case "assignment":
        case "augmented_assignment":
        case "named_expression": {
          this.extractAssignment(node, ctx)
          break
        }
        case "call": {
          this.processCall(node, ctx)
          break
        }
        case "type_alias_statement": {
          this.extractTypeAlias(node, ctx)
          break
        }
        case "decorated_definition": {
          // The decorator nodes are metadata on the wrapped class/function;
          // the class/function node itself is visited as a child normally.
          ctx.patterns["Decorators"] = true
          break
        }
        case "except_clause": {
          // Exception types in except clauses are references to exception
          // classes; keep as a pattern only (no relationship noise).
          ctx.patterns["Exception Handling"] = true
          break
        }
      }

      // Push children in reverse order to maintain document-order traversal.
      for (let i = node.namedChildCount - 1; i >= 0; i--) {
        const child = node.namedChild(i)
        if (child) stack.push({ node: child })
      }
    }

    // Post-loop: contains for class → member ownership (module-level symbols
    // are ownerless — Python has no module declaration, JS-family contract).
    for (const s of ctx.symbols) {
      const owner = s.ownerName
      if (owner && owner !== s.name) {
        this.pushRel(ctx, owner, s.name, ASTEngine.RelationshipType.Contains, 1.0, {})
      }
    }

    // Overrides: Derived.method -> Base.method when the base declares the
    // same-name method (in-file or via the cross-file companion index).
    this.extractOverrideRelationships(ctx)

    const detectedFrameworks: string[] = []
    for (const k in ctx.frameworks) detectedFrameworks.push(k)
    const detectedPatterns: string[] = []
    for (const p in ctx.patterns) detectedPatterns.push(p)

    return {
      language: "python",
      symbols: ctx.symbols,
      relationships: ctx.relationships,
      imports: ctx.imports,
      exports: ctx.exports,
      errors: ctx.errors,
      metadata: {
        complexity: cyclomaticComplexity,
        linesOfCode: content.split("\n").length,
        cyclomaticComplexity,
        framework: detectedFrameworks[0],
        patterns: detectedPatterns,
        detectedFrameworks,
        frameworkPatterns: detectedFrameworks.map((f) => ({
          framework: f,
          patterns: [{ type: "usage", detected: true, description: `${f} usage detected` }],
        })),
        hasTypeInference: true,
        hasFrameworkIntelligence: true,
        analysisVersion: "3.1.0-python-m12.27",
      },
    }
  }

  // ========================================================================
  // EXTRACTION METHODS
  // ========================================================================

  private extractClass(node: Node, ctx: PythonContext) {
    const nameNode = this.findChildByType(node, "identifier")
    if (!nameNode?.text) return
    const className = nameNode.text

    const docstring = this.extractDocstring(node)
    const baseClasses: string[] = []
    let isEnum = false

    const argsNode = this.findChildByType(node, "argument_list")
    if (argsNode) {
      for (let i = 0; i < argsNode.namedChildCount; i++) {
        const arg = argsNode.namedChild(i)
        if (!arg) continue
        // Base class leaf: `Generic[T]` → `Generic`, dotted `a.b` → `b`.
        const baseLeaf = this.baseClassLeaf(arg)
        if (!baseLeaf) continue
        baseClasses.push(baseLeaf)
        if (baseLeaf === "Enum") isEnum = true
        this.pushRel(ctx, className, baseLeaf, ASTEngine.RelationshipType.Extends, 1.0, {
          pythonSpecific: true,
        })
      }
    }

    const decorators = this.extractDecorators(node, ctx, className)

    const kind = isEnum ? ASTEngine.SymbolKind.Enum : ASTEngine.SymbolKind.Class
    ctx.symbols.push({
      name: className,
      kind,
      range: this.nodeToRange(node),
      visibility: "public",
      decorators,
      docstring,
      comments: docstring ? [docstring] : [],
      metadata: {
        pythonSpecific: true,
        baseClasses,
        isEnum,
      },
    })
    ctx.functionSymbolIndex[`::${className}`] = ctx.symbols.length - 1
    ctx.declaredTypes.add(className)

    // Enum members: assignments with constant values inside the class body.
    if (isEnum) {
      const bodyNode = this.findChildByType(node, "block")
      if (bodyNode) {
        for (let i = 0; i < bodyNode.namedChildCount; i++) {
          const stmt = bodyNode.namedChild(i)
          if (!stmt || stmt.type !== "expression_statement") continue
          const assign = stmt.namedChild(0)
          if (!assign || assign.type !== "assignment") continue
          const left = assign.namedChild(0)
          const right = assign.namedChild(assign.namedChildCount - 1)
          if (!left || left.type !== "identifier") continue
          // Only constant-value members (not function-valued or tuple forms).
          if (right && (right.type === "string" || right.type === "integer" ||
              right.type === "float" || right.type === "true" || right.type === "false" ||
              right.type === "none" || right.type === "identifier")) {
            ctx.symbols.push({
              name: left.text,
              kind: ASTEngine.SymbolKind.EnumMember,
              range: this.nodeToRange(left),
              ownerName: className,
              ownerKind: ASTEngine.SymbolKind.Enum,
              visibility: "public",
              metadata: { pythonSpecific: true, isEnumMember: true },
            })
          }
        }
      }
    }
  }

  private extractFunction(node: Node, ctx: PythonContext) {
    const nameNode = this.findChildByType(node, "identifier")
    if (!nameNode?.text) return
    const funcName = nameNode.text

    const docstring = this.extractDocstring(node)
    const parameters = this.extractParameters(node)
    const returnType = this.extractReturnType(node)
    const decorators = this.extractDecorators(node, ctx, funcName)
    const isAsync = this.isAsyncFunction(node)

    let hasTypeHints = returnType !== undefined
    if (!hasTypeHints) {
      for (const p of parameters) {
        if (p.type !== undefined) { hasTypeHints = true; break }
      }
    }

    ctx.symbols.push({
      name: funcName,
      kind: ASTEngine.SymbolKind.Function,
      range: this.nodeToRange(node),
      visibility: this.pythonVisibility(funcName),
      isAsync,
      docstring,
      comments: docstring ? [docstring] : [],
      parameters,
      returnType,
      decorators,
      metadata: {
        pythonSpecific: true,
        hasDocstring: !!docstring,
        hasTypeHints,
        isAsync,
      },
    })
    ctx.functionSymbolIndex[`${ctx.currentClass || ""}::${funcName}`] = ctx.symbols.length - 1
  }

  private extractMethod(node: Node, className: string, ctx: PythonContext) {
    const nameNode = this.findChildByType(node, "identifier")
    if (!nameNode?.text) return
    const methodName = nameNode.text

    const docstring = this.extractDocstring(node)
    const parameters = this.extractParameters(node)
    const returnType = this.extractReturnType(node)
    const decorators = this.extractDecorators(node, ctx, methodName)
    const isAsync = this.isAsyncFunction(node)

    if (methodName.startsWith("__") && methodName.endsWith("__")) {
      ctx.patterns["Dunder (Magic) Methods"] = true
      if (methodName === "__enter__" || methodName === "__exit__") ctx.patterns["Context Manager"] = true
      if (methodName === "__iter__" || methodName === "__next__") ctx.patterns["Iterator Pattern"] = true
    }

    let hasTypeHints = returnType !== undefined
    if (!hasTypeHints) {
      for (const p of parameters) {
        if (p.type !== undefined) { hasTypeHints = true; break }
      }
    }

    let isStatic = false
    let isClassMethod = false
    let isAbstract = false
    for (const d of decorators) {
      if (d === "staticmethod") isStatic = true
      if (d === "classmethod") isClassMethod = true
      if (d === "abstractmethod") isAbstract = true
    }

    ctx.symbols.push({
      name: methodName,
      kind: ASTEngine.SymbolKind.Method,
      range: this.nodeToRange(node),
      ownerName: className,
      ownerKind: ASTEngine.SymbolKind.Class,
      visibility: this.pythonVisibility(methodName),
      isAsync,
      isStatic,
      isAbstract,
      docstring,
      comments: docstring ? [docstring] : [],
      parameters,
      returnType,
      decorators,
      metadata: {
        pythonSpecific: true,
        hasTypeHints,
        isClassMethod,
        isAbstract,
        isAsync,
      },
    })
    ctx.functionSymbolIndex[`${className}::${methodName}`] = ctx.symbols.length - 1
  }

  private extractImport(node: Node, ctx: PythonContext) {
    if (node.type === "import_statement") {
      // `import os, sys` / `import numpy as np` — namespace imports.
      for (let i = 0; i < node.namedChildCount; i++) {
        const name = node.namedChild(i)
        if (!name || !(name.type === "dotted_name" || name.type === "aliased_import")) continue
        let moduleName = name.text
        let alias: string | undefined
        if (name.type === "aliased_import") {
          const modNode = name.childForFieldName("name") || name.namedChild(0)
          const aliasNode = name.childForFieldName("alias") || name.namedChild(1)
          if (modNode) moduleName = modNode.text
          if (aliasNode) alias = aliasNode.text
        }
        ctx.imports.push({
          module: moduleName,
          alias,
          items: ["*"],
          isDefaultImport: false,
          isNamespaceImport: true,
          isNamespace: true,
          range: this.nodeToRange(node),
          metadata: { pythonSpecific: true, isAliased: name.type === "aliased_import" },
        })
        this.pushRel(ctx, ctx.moduleName, `${moduleName}:*`, ASTEngine.RelationshipType.Imports, 1.0, {
          pythonSpecific: true,
        })
      }
    } else if (node.type === "import_from_statement") {
      // `from .models import User, Role, format_name as fmt`
      // module = relative_import or dotted_name (first named child before import)
      let moduleName = ""
      let seenImport = false
      for (let i = 0; i < node.namedChildCount; i++) {
        const c = node.namedChild(i)
        if (!c) continue
        if (c.type === "import" || c.text === "import") { seenImport = true; continue }
        if (c.type === "relative_import" || c.type === "dotted_name") {
          if (!seenImport && !moduleName) moduleName = c.text
        }
      }

      const items: string[] = []
      for (let i = 0; i < node.namedChildCount; i++) {
        const c = node.namedChild(i)
        if (!c) continue
        if (c.type === "dotted_name" || c.type === "identifier") {
          if (c.text !== moduleName) items.push(c.text)
        } else if (c.type === "aliased_import") {
          const itemNameNode = c.childForFieldName("name") || c.namedChild(0)
          if (itemNameNode) items.push(itemNameNode.text)
        } else if (c.type === "wildcard_import") {
          items.push("*")
        }
      }

      ctx.imports.push({
        module: moduleName || "<unknown>",
        items,
        isDefaultImport: false,
        isNamespaceImport: false,
        isNamespace: true,
        range: this.nodeToRange(node),
      })
      for (const item of items) {
        this.pushRel(ctx, ctx.moduleName, `${moduleName}:${item === "*" ? "*" : item}`, ASTEngine.RelationshipType.Imports, 1.0, {
          pythonSpecific: true,
        })
      }
    }
  }

  private extractAssignment(node: Node, ctx: PythonContext) {
    const left = node.namedChild(0)
    if (!left || left.type !== "identifier") return
    const name = left.text

    // __all__ → the explicit export contract.
    if (name === "__all__") {
      const right = node.namedChild(node.namedChildCount - 1)
      if (right && right.type === "list") {
        for (let i = 0; i < right.namedChildCount; i++) {
          const child = right.namedChild(i)
          if (child && child.type === "string") {
            const exportName = this.unquote(child)
            if (exportName) {
              ctx.exports.push({ name: exportName, type: "list_item" })
              this.pushRel(ctx, ctx.moduleName, exportName, ASTEngine.RelationshipType.Exports, 1.0, {
                pythonSpecific: true,
              })
            }
          }
        }
      }
      return
    }

    // Inside a method: self.x = ... → Property (instance attribute).
    if (ctx.currentClass && ctx.currentFunction) {
      const parent = left.parent
      if (parent && parent.type === "attribute") {
        const obj = parent.namedChild(0)
        if (obj && (obj.text === "self" || obj.text === "cls")) {
          ctx.symbols.push({
            name,
            kind: ASTEngine.SymbolKind.Property,
            range: this.nodeToRange(left),
            ownerName: ctx.currentClass,
            ownerKind: ASTEngine.SymbolKind.Class,
            visibility: this.pythonVisibility(name),
            metadata: { pythonSpecific: true, isInstanceAttribute: true },
          })
        }
      }
      return
    }

    // Inside a function body: locals are NOT symbols (universal
    // scripting-family contract).
    if (ctx.currentFunction) return

    // Inside a class body (not a method): class variable → Property. Enum
    // bodies are skipped — their constant assignments are already emitted as
    // EnumMember symbols by extractClass.
    if (ctx.currentClass) {
      const classSymbol = ctx.symbols[ctx.functionSymbolIndex[`::${ctx.currentClass}`]]
      if (classSymbol?.kind === ASTEngine.SymbolKind.Enum) return
      ctx.symbols.push({
        name,
        kind: ASTEngine.SymbolKind.Property,
        range: this.nodeToRange(left),
        ownerName: ctx.currentClass,
        ownerKind: ASTEngine.SymbolKind.Class,
        visibility: "public",
        metadata: { pythonSpecific: true, isClassVariable: true },
      })
      return
    }

    // Module-level assignment → Variable.
    ctx.symbols.push({
      name,
      kind: ASTEngine.SymbolKind.Variable,
      range: this.nodeToRange(left),
      visibility: this.pythonVisibility(name),
      metadata: { pythonSpecific: true, isModuleVariable: true },
    })
  }

  private extractTypeAlias(node: Node, ctx: PythonContext) {
    // PEP 695: `type Alias = ...` — left child is the alias name.
    const left = node.namedChild(0)
    if (left) {
      ctx.symbols.push({
        name: left.text,
        kind: ASTEngine.SymbolKind.Type,
        range: this.nodeToRange(node),
        visibility: "public",
        metadata: { pythonSpecific: true, isTypeAlias: true },
      })
    }
  }

  private processCall(node: Node, ctx: PythonContext) {
    const caller = ctx.currentFunction || ctx.currentClass || ctx.moduleName
    if (!caller || caller === "module") return

    // Decorator calls (@dataclass(...)) are metadata on the decorated
    // symbol, not runtime call edges.
    let p = node.parent
    while (p) {
      if (p.type === "decorator") return
      if (p.type === "function_definition" || p.type === "class_definition" || p.type === "module") break
      p = p.parent
    }

    const funcChild = node.namedChild(0)
    if (!funcChild) return

    const fullCallee = funcChild.text
    const targetName = this.callLeafName(funcChild)
    if (!targetName) return
    if (PYTHON_BUILTINS.has(targetName)) return
    if (targetName.startsWith("__") && targetName.endsWith("__")) return // dunder: not a user call

    // Uppercase head → instantiation (Python has no `new` keyword), but only
    // when the target is a class declared in-file (imported classes like
    // TypeVar are external — no in-file target to instantiate).
    const firstChar = targetName[0]
    const isUppercase = firstChar === firstChar.toUpperCase() && firstChar !== firstChar.toLowerCase()
    if (isUppercase) {
      // O(1): declaredTypes holds exactly the in-file class/enum names.
      if (ctx.declaredTypes.has(targetName)) {
        this.pushRel(ctx, caller, targetName, ASTEngine.RelationshipType.Instantiates, 0.9, {
          pythonSpecific: true,
          qualified: fullCallee,
        })
      }
      return
    }

    this.pushRel(ctx, caller, targetName, ASTEngine.RelationshipType.Calls, 0.9, {
      pythonSpecific: true,
      qualified: fullCallee,
    })
  }

  // ========================================================================
  // OVERRIDES (harness companion contract, mirrors JS analyzer)
  // ========================================================================

  private extractOverrideRelationships(ctx: PythonContext) {
    const byName = new Map<string, ASTEngine.UniversalSymbol[]>()
    for (const s of ctx.symbols) {
      const list = byName.get(s.name) ?? []
      list.push(s)
      byName.set(s.name, list)
    }
    // First (leftmost) base class is the primary inheritance target — with
    // multiple bases, overrides resolve against the first (Python MRO).
    const baseByClass = new Map<string, string>()
    for (const r of ctx.relationships) {
      if (r.type === ASTEngine.RelationshipType.Extends && r.source && r.target) {
        if (!baseByClass.has(r.source)) baseByClass.set(r.source, r.target)
      }
    }
    const overrideCompanion = (ctx as any)._overrideCompanion as Map<string, Set<string>> | undefined
    const baseDeclares = (base: string, method: string): boolean => {
      const inFile = byName.get(method)?.some((bm) => bm.ownerName === base) ?? false
      if (inFile) return true
      const companion = overrideCompanion?.get(base)
      return !!companion && companion.has(method)
    }
    for (const s of ctx.symbols) {
      if (s.kind === ASTEngine.SymbolKind.Method && s.ownerName) {
        const base = baseByClass.get(s.ownerName)
        if (!base) continue
        if (!baseDeclares(base, s.name)) continue
        this.pushRel(ctx, `${s.ownerName}.${s.name}`, `${base}.${s.name}`, ASTEngine.RelationshipType.Overrides, 0.95, {})
      }
    }
  }

  // ========================================================================
  // CORE UTILITIES (regex-free)
  // ========================================================================

  private pushRel(
    ctx: PythonContext,
    source: string,
    target: string,
    type: ASTEngine.RelationshipType,
    confidence: number,
    metadata: Record<string, any>,
  ) {
    if (!source || !target) return
    const key = `${type}\u001f${source}\u001f${target}`
    if (ctx.seenRels.has(key)) return
    ctx.seenRels.add(key)
    ctx.relationships.push({
      source,
      target,
      fromSymbol: source,
      toSymbol: target,
      type,
      relationshipType: type,
      confidence,
      metadata,
    })
  }

  private baseClassLeaf(node: Node): string | undefined {
    // identifier → text; subscript `Generic[T]` → first named child leaf;
    // attribute `a.b` → last named child leaf.
    if (node.type === "identifier") return node.text
    if (node.type === "subscript") {
      const first = node.namedChild(0)
      return first ? this.baseClassLeaf(first) : undefined
    }
    if (node.type === "attribute") {
      const last = node.namedChild(node.namedChildCount - 1)
      return last ? last.text : undefined
    }
    // Generic[T] may wrap in a generic_type or dotted_name — descend to leaf.
    const first = node.namedChild(0)
    if (first) return this.baseClassLeaf(first)
    return undefined
  }

  private callLeafName(node: Node): string | undefined {
    if (node.type === "identifier") return node.text
    if (node.type === "attribute") {
      const last = node.namedChild(node.namedChildCount - 1)
      return last ? last.text : undefined
    }
    if (node.type === "call") {
      const fn = node.namedChild(0)
      return fn ? this.callLeafName(fn) : undefined
    }
    if (node.type === "string") return undefined
    const first = node.namedChild(0)
    return first ? this.callLeafName(first) : undefined
  }

  private extractDecorators(node: Node, ctx: PythonContext, ownerName: string): string[] {
    const out: string[] = []
    const parent = node.parent
    if (parent && parent.type === "decorated_definition") {
      for (let i = 0; i < parent.namedChildCount; i++) {
        const c = parent.namedChild(i)
        if (c && c.type === "decorator") {
          const name = this.decoratorName(c)
          if (name) {
            out.push(name)
            if (name === "dataclass") ctx.patterns["Dataclasses"] = true
            if (name === "staticmethod" || name === "classmethod") ctx.patterns["Static/Class Methods"] = true
            if (name === "property") ctx.patterns["Properties (Getters/Setters)"] = true
          }
        }
      }
    }
    return out
  }

  private decoratorName(decorator: Node): string | undefined {
    // decorator: "@" + (call | identifier | attribute | subscript)
    const inner = decorator.namedChild(0)
    if (!inner) return undefined
    if (inner.type === "call") {
      const fn = inner.namedChild(0)
      return fn ? this.callLeafName(fn) : undefined
    }
    if (inner.type === "identifier") return inner.text
    if (inner.type === "attribute") {
      const last = inner.namedChild(inner.namedChildCount - 1)
      return last ? last.text : undefined
    }
    return inner.text.split(".")[0].split("(")[0]
  }

  private isAsyncFunction(node: Node): boolean {
    // This grammar emits `function_definition` for async defs too — an
    // anonymous `async` token is the first child.
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i)
      if (c && c.type === "async") return true
    }
    return false
  }

  private findChildByType(node: Node, type: string): Node | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child && child.type === type) return child
    }
    return null
  }

  private extractParameters(node: Node): ASTEngine.Parameter[] {
    const paramsList = this.findChildByType(node, "parameters")
    if (!paramsList) return []
    const params: ASTEngine.Parameter[] = []
    for (let i = 0; i < paramsList.namedChildCount; i++) {
      const p = paramsList.namedChild(i)
      if (!p) continue
      if (p.type === "identifier") {
        params.push({ name: p.text })
      } else if (p.type === "list_splat_pattern") {
        const inner = this.findChildByType(p, "identifier")
        if (inner) params.push({ name: `*${inner.text}`, isVariadic: true })
      } else if (p.type === "dictionary_splat_pattern") {
        const inner = this.findChildByType(p, "identifier")
        if (inner) params.push({ name: `**${inner.text}`, isVariadic: true })
      } else if (p.type === "typed_parameter") {
        const nameNode = this.findChildByType(p, "identifier")
        const typeNode = this.findChildByType(p, "type")
        if (nameNode) params.push({ name: nameNode.text, type: typeNode ? typeNode.text : undefined })
      } else if (p.type === "default_parameter" || p.type === "typed_default_parameter") {
        const nameNode = this.findChildByType(p, "identifier")
        const typeNode = this.findChildByType(p, "type")
        if (nameNode) params.push({ name: nameNode.text, type: typeNode ? typeNode.text : undefined, isOptional: true })
      }
    }
    return params
  }

  private extractReturnType(node: Node): string | undefined {
    const typeNode = this.findChildByType(node, "type")
    return typeNode ? typeNode.text : undefined
  }

  private extractDocstring(node: Node): string | undefined {
    const body = this.findChildByType(node, "block")
    if (body && body.namedChildCount > 0) {
      const firstStmt = body.namedChild(0)
      if (firstStmt && firstStmt.type === "expression_statement") {
        const strNode = firstStmt.namedChild(0)
        if (strNode && strNode.type === "string") {
          return this.unquote(strNode)
        }
      }
    }
    return undefined
  }

  // Regex-free string literal unquoting: prefers the grammar's
  // string_content child; falls back to a first/last-char scan.
  private unquote(node: Node): string {
    const content = this.findChildByType(node, "string_content")
    if (content) return content.text
    const text = node.text.trim()
    if (text.length >= 6) {
      const triple = text.slice(0, 3)
      if ((triple === '"""' || triple === "'''") && text.endsWith(triple)) {
        return text.slice(3, -3).trim()
      }
    }
    if (text.length >= 2) {
      const first = text[0]
      if ((first === '"' || first === "'") && text[text.length - 1] === first) {
        return text.slice(1, -1)
      }
    }
    return text
  }

  private pythonVisibility(name: string): string {
    if (name.startsWith("__") && !name.endsWith("__")) return "private"
    if (name.startsWith("_")) return "protected"
    return "public"
  }

  private nodeToRange(node: Node): ASTEngine.UniversalSymbol["range"] {
    const target = node.parent?.type === "decorated_definition" ? node.parent : node
    return {
      startLine: target.startPosition.row + 1,
      startColumn: target.startPosition.column + 1,
      endLine: target.endPosition.row + 1,
      endColumn: target.endPosition.column + 1,
      startIndex: target.startIndex,
      endIndex: target.endIndex,
    }
  }
}
