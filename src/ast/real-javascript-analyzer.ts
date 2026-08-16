// JavaScript Intelligence Engine
// M12.10 rewrite: C#-family contract, pure-AST, fully regex-free.
//   - Symbols: no locals/params/lambda-params as symbols; classes, methods,
//     accessors -> property, fields, module-scope functions/constants,
//     constructor -> constructor, prototype methods.
//   - Relationships: leaf identities (calls: Distance -> Sqrt); contains from
//     ownerName; extends/implements, instantiates, imports/exports (ESM + CJS),
//     overrides; builtins filtered (console.*, Object leaf methods, super).
//   - ESM + CommonJS both first-class (import/export, require/module.exports).

import type { Node } from "web-tree-sitter"
import * as path from "path"
import { ASTEngine } from "./engine"

// ============================================================================
// BUILTIN FILTER — C#-family contract (mirrors TypeScript analyzer)
// ============================================================================

const JS_CONSOLE_BUILTINS = new Set([
  "console.log", "console.warn", "console.error", "console.info", "console.debug",
  "console.trace", "console.table", "console.group", "console.groupEnd",
  "console.groupCollapsed", "console.time", "console.timeEnd", "console.assert",
  "console.count", "console.countReset", "console.dir", "console.dirxml",
  "console.clear", "console.profile", "console.profileEnd",
])
const JS_OBJECT_LEAF_METHODS = new Set([
  "toString", "valueOf", "hasOwnProperty", "isPrototypeOf",
  "propertyIsEnumerable", "toLocaleString", "__defineGetter__", "__defineSetter__",
])

// ============================================================================
// PURE-STRING HELPERS (regex-free normalization)
// ============================================================================

function unquote(text: string): string {
  if (text.length >= 2) {
    const first = text[0]
    if ((first === '"' || first === "'" || first === "`") && text[text.length - 1] === first) {
      return text.slice(1, -1)
    }
  }
  return text
}

function stringContent(node: Node): string {
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i)
    if (c && c.type === "string_fragment") return c.text
  }
  return unquote(node.text)
}

function stripCommentMarkers(text: string): string {
  if (text.startsWith("//")) return text.slice(2).trimStart()
  if (text.startsWith("/*")) {
    const end = text.endsWith("*/") ? text.length - 2 : text.length
    return text.slice(2, end).trim()
  }
  return text.trim()
}

function hasBraceEquals(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === "{" || ch === "}" || ch === ";" || ch === "=") return true
  }
  return false
}

function stripWhitespace(text: string): string {
  let out = ""
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch !== " " && ch !== "\t" && ch !== "\n" && ch !== "\r") out += ch
  }
  return out
}  // ============================================================================
  // SCOPE MANAGEMENT — frames carry an immutable snapshot of the scope chain
  // (iterative DFS: children are processed later from the stack, so scope
  // state must travel with each frame, never a shared mutable stack).
  // ============================================================================

enum JSScopeKind {
  Global = "global",
  Module = "module",
  Class = "class",
  Function = "function",
}

interface JSScopeEntry {
  name: string
  kind: JSScopeKind
}

function scopeOwnerName(scopes: JSScopeEntry[]): string | undefined {
  for (let i = scopes.length - 1; i >= 0; i--) {
    if (scopes[i].kind === JSScopeKind.Class) return scopes[i].name
  }
  return undefined
}

function scopeString(scopes: JSScopeEntry[]): string {
  const parts: string[] = []
  for (let i = 1; i < scopes.length; i++) {
    const s = scopes[i]
    if (s.kind !== JSScopeKind.Global) parts.push(s.name)
  }
  return parts.join(".")
}


// ============================================================================
// ANALYZER
// ============================================================================

export class RealJavaScriptAnalyzer implements ASTEngine.LanguageAnalyzer {
  analyze(
    rootNode: Node,
    content: string,
    filePath: string,
    context?: ASTEngine.AnalyzeContext
  ): ASTEngine.ParseResult & { metadata: Partial<ASTEngine.FileMetadata> } {
    const symbols: ASTEngine.UniversalSymbol[] = []
    const relationships: ASTEngine.UniversalRelationship[] = []
    const imports: ASTEngine.ImportInfo[] = []
    const exports: ASTEngine.ExportInfo[] = []
    const errors: ASTEngine.ParseError[] = []

    const frameworks: Record<string, boolean> = { JavaScript: true }
    const patterns: Record<string, boolean> = {}
    const scopes: JSScopeEntry[] = [{ name: "__global__", kind: JSScopeKind.Global }]

    const moduleName = path.basename(filePath, path.extname(filePath))

    // --- Error collection --------------------------------------------------
    if (rootNode.hasError) {
      const errStack: Node[] = [rootNode]
      while (errStack.length > 0) {
        const n = errStack.pop()!
        if (n.type === "ERROR" || n.isMissing) {
          errors.push({
            message: `Syntax ${n.type} detected. The Brain Engine is bypassing this broken node.`,
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

    // --- Symbol + CJS/ESM extraction (single iterative traversal) ----------
    interface Frame {
      node: Node
      scopes: JSScopeEntry[]
      inClassBody: boolean
      functionDepth: number
    }

    const stack: Frame[] = [{ node: rootNode, scopes, inClassBody: false, functionDepth: 0 }]
    let cyclomaticComplexity = 1
    const seenMethods = new Set<string>() // owner:name — overload/duplicate dedup

    while (stack.length > 0) {
      const { node, scopes: frameScopes, inClassBody, functionDepth } = stack.pop()!
      const scopeStack = [...frameScopes]
      let nextInClassBody = inClassBody
      let nextFunctionDepth = functionDepth

      if (
        node.type === "if_statement" ||
        node.type === "for_statement" ||
        node.type === "while_statement" ||
        node.type === "catch_clause" ||
        node.type === "switch_case" ||
        node.type === "ternary_expression"
      ) {
        cyclomaticComplexity++
      }

      switch (node.type) {
        case "class_declaration": {
          const name = node.childForFieldName("name")?.text
          if (name) {
            const comments = this.collectComments(node)
            symbols.push({
              name,
              kind: ASTEngine.SymbolKind.Class,
              range: this.nodeToRange(node),
              scope: scopeString(scopeStack),
              visibility: "public",
              comments,
              metadata: { isClass: true },
            })
            scopeStack.push({ name, kind: JSScopeKind.Class })
            nextInClassBody = true

            // extends heritage
            const heritage = this.findChildByType(node, "class_heritage")
            if (heritage) {
              const base = this.findChildByType(heritage, "identifier")
              if (base) {
                relationships.push({
                  source: name,
                  target: base.text,
                  type: ASTEngine.RelationshipType.Extends,
                  confidence: 1.0,
                  metadata: {},
                })
              }
            }
          }
          break
        }

        case "method_definition": {
          const name = node.childForFieldName("name")?.text
          if (name) {
            const owner = scopeOwnerName(scopeStack)
            const dedupKey = `${owner ?? "module"}:${name}`
            const isConstructor = name === "constructor"
            const isAccessor = this.hasToken(node, "get") || this.hasToken(node, "set")
            const kind = isConstructor
              ? ASTEngine.SymbolKind.Constructor
              : isAccessor
                ? ASTEngine.SymbolKind.Property
                : ASTEngine.SymbolKind.Method
            const isStatic = this.hasToken(node, "static")
            const isAsync = this.hasToken(node, "async")
            const isGenerator = this.hasToken(node, "*")
            if (!seenMethods.has(dedupKey)) {
              seenMethods.add(dedupKey)
              const params = this.extractParameters(node.childForFieldName("parameters"))
              const comments = this.collectComments(node)
              symbols.push({
                name,
                kind,
                range: this.nodeToRange(node),
                scope: scopeString(scopeStack),
                ownerName: owner,
                ownerKind: owner ? ASTEngine.SymbolKind.Class : undefined,
                visibility: isStatic ? "public" : "public",
                isStatic,
                parameters: params,
                comments,
                complexity: this.methodComplexity(node),
                metadata: { isAccessor, isAsync, isGenerator },
              })
            }
            scopeStack.push({ name, kind: JSScopeKind.Function })
            nextFunctionDepth = functionDepth + 1
            nextInClassBody = false
          }
          break
        }

        case "field_definition": {
          const prop = node.childForFieldName("property")
          if (prop) {
            const name = prop.text.startsWith("#") ? prop.text.slice(1) : prop.text
            const owner = scopeOwnerName(scopeStack)
            symbols.push({
              name,
              kind: ASTEngine.SymbolKind.Property,
              range: this.nodeToRange(node),
              scope: scopeString(scopeStack),
              ownerName: owner,
              ownerKind: owner ? ASTEngine.SymbolKind.Class : undefined,
              visibility: "public",
              metadata: { isPrivate: prop.type === "private_property_identifier" },
            })
          }
          break
        }

        case "function_declaration":
        case "generator_function_declaration": {
          const name = node.childForFieldName("name")?.text
          if (name) {
            const comments = this.collectComments(node)
            const params = this.extractParameters(node.childForFieldName("parameters"))
            const isAsync = this.hasToken(node, "async")
            symbols.push({
              name,
              kind: ASTEngine.SymbolKind.Function,
              range: this.nodeToRange(node),
              scope: scopeString(scopeStack),
              visibility: "public",
              parameters: params,
              comments,
              complexity: this.methodComplexity(node),
              metadata: {
                isGenerator: node.type === "generator_function_declaration",
                isAsync,
              },
            })
            scopeStack.push({ name, kind: JSScopeKind.Function })
            nextFunctionDepth = functionDepth + 1
          }
          break
        }

        case "variable_declarator": {
          const nameNode = node.childForFieldName("name")
          const valueNode = node.childForFieldName("value")
          const name = nameNode && nameNode.type === "identifier" ? nameNode.text : undefined
          const isFunctionValue = !!valueNode && (valueNode.type === "arrow_function" || valueNode.type === "function_expression")
          const isRequireBinding = !!valueNode && valueNode.type === "call_expression" &&
            valueNode.childForFieldName("function")?.text === "require"

          // CJS require bindings are imports, never symbols (family contract)
          if (name && isRequireBinding) {
            break
          }

          if (name && functionDepth === 0 && !inClassBody) {
            // Module-scope only: function-valued -> Function, const -> Constant,
            // let/var -> Variable. Locals/params/lambda params are NEVER symbols.
            if (isFunctionValue) {
              const comments = this.collectComments(node)
              const params = this.extractParameters(valueNode.childForFieldName("parameters"))
              const isAsync = this.hasToken(valueNode, "async")
              symbols.push({
                name,
                kind: ASTEngine.SymbolKind.Function,
                range: this.nodeToRange(node),
                scope: scopeString(scopeStack),
                visibility: "public",
                parameters: params,
                comments,
                complexity: this.methodComplexity(valueNode),
                metadata: { isArrowFunction: valueNode.type === "arrow_function", isAsync },
              })
              scopeStack.push({ name, kind: JSScopeKind.Function })
              nextFunctionDepth = functionDepth + 1
            } else {
              const isConst = this.isConstDeclarator(node)
              symbols.push({
                name,
                kind: isConst ? ASTEngine.SymbolKind.Constant : ASTEngine.SymbolKind.Variable,
                range: this.nodeToRange(node),
                scope: scopeString(scopeStack),
                visibility: "public",
                metadata: { isConst },
              })
            }
          } else if (isFunctionValue) {
            // Local function-valued variable: no symbol, but provides call scope
            scopeStack.push({ name: name ?? "anonymous", kind: JSScopeKind.Function })
            nextFunctionDepth = functionDepth + 1
          }
          break
        }

        case "function_expression":
        case "arrow_function": {
          // Anonymous function expressions/arrows: no symbol; push scope only
          // when they are NOT already covered by a variable_declarator parent.
          const parent = node.parent
          if (parent && parent.type !== "variable_declarator") {
            const nm = `anonymous_function_${node.startIndex}`
            scopeStack.push({ name: nm, kind: JSScopeKind.Function })
            nextFunctionDepth = functionDepth + 1
          }
          break
        }

        case "assignment_expression": {
          // CommonJS exports + prototype method assignment
          const left = node.childForFieldName("left")
          const right = node.childForFieldName("right")
          if (left && right) {
            if (left.type === "member_expression") {
              const obj = left.childForFieldName("object")
              const prop = left.childForFieldName("property")
              const objText = obj ? obj.text : ""
              const propText = prop ? prop.text : ""

              if (objText === "module" && propText === "exports") {
                patterns["CommonJS Exports"] = true
                this.collectModuleExports(right, exports, node, true)
              } else if (objText === "exports") {
                patterns["CommonJS Exports"] = true
                if (propText && prop) exports.push({ name: propText, isDefault: false, range: this.nodeToRange(prop) })
              }

              // Prototype method assignment: X.prototype.method = function () {}
              const isFunctionRight = right.type === "function_expression" || right.type === "arrow_function"
              if (isFunctionRight && obj && obj.type === "member_expression") {
                const protoObj = obj.childForFieldName("object")
                const protoProp = obj.childForFieldName("property")
                if (protoProp && protoProp.text === "prototype" && protoObj && propText) {
                  patterns["Prototype Inheritance"] = true
                  const className = protoObj.text
                  const methodName = propText
                  const dedupKey = `${className}:${methodName}`
                  if (!seenMethods.has(dedupKey)) {
                    seenMethods.add(dedupKey)
                    const params = this.extractParameters(right.childForFieldName("parameters"))
                    symbols.push({
                      name: methodName,
                      kind: ASTEngine.SymbolKind.Method,
                      range: this.nodeToRange(right),
                      scope: className,
                      ownerName: className,
                      ownerKind: ASTEngine.SymbolKind.Class,
                      visibility: "public",
                      parameters: params,
                      complexity: this.methodComplexity(right),
                      metadata: { isPrototypeMethod: true, prototypeOwner: className },
                    })
                    // contains comes from addContainmentRelationships via
                    // ownerName — no duplicate push here.
                    scopeStack.push({ name: methodName, kind: JSScopeKind.Function })
                    nextFunctionDepth = functionDepth + 1
                  }
                }
              }
            }
          }
          break
        }

        case "call_expression": {
          // CommonJS require() -> import
          const fn = node.childForFieldName("function")
          if (fn && fn.type === "identifier" && fn.text === "require") {
            const args = node.childForFieldName("arguments")
            if (args && args.namedChildCount > 0) {
              const arg = args.namedChild(0)
              if (arg && (arg.type === "string" || arg.type === "template_string")) {
                const reqPath = stringContent(arg)
                imports.push({
                  module: reqPath,
                  items: ["*"],
                  isDefault: true,
                  range: this.nodeToRange(node),
                  metadata: { type: "require" },
                })
                patterns["CommonJS Imports"] = true
                relationships.push({
                  source: moduleName,
                  target: `${reqPath}:*`,
                  type: ASTEngine.RelationshipType.Imports,
                  confidence: 1.0,
                  metadata: { isRequire: true },
                })
              }
            }
          }
          break
        }

        case "import_statement": {
          patterns["ES6 Imports"] = true
          const srcNode = node.childForFieldName("source")
          const srcPath = srcNode ? stringContent(srcNode) : ""
          const items: string[] = []
          const clause = this.findChildByType(node, "import_clause")
          if (clause) {
            for (let i = 0; i < clause.namedChildCount; i++) {
              const c = clause.namedChild(i)
              if (!c) continue
              if (c.type === "identifier") {
                items.push(c.text) // default import
              } else if (c.type === "named_imports") {
                for (let j = 0; j < c.namedChildCount; j++) {
                  const spec = c.namedChild(j)
                  if (spec && spec.type === "import_specifier") {
                    const n = this.findChildByType(spec, "identifier")
                    if (n) items.push(n.text)
                  }
                }
              } else if (c.type === "namespace_import") {
                items.push("*")
              }
            }
          }
          if (srcPath) {
            imports.push({
              module: srcPath,
              items,
              isDefault: items.length === 1 && items[0] !== "*" ? false : true,
              range: this.nodeToRange(node),
              metadata: { type: "import" },
            })
            for (const item of items) {
              relationships.push({
                source: moduleName,
                target: `${srcPath}:${item === "*" ? "*" : item.split(" as ")[0]}`,
                type: ASTEngine.RelationshipType.Imports,
                confidence: 1.0,
                metadata: {},
              })
            }
          }
          break
        }

        case "export_statement": {
          patterns["ES6 Exports"] = true
          this.collectExportStatement(node, exports)
          break
        }
      }

      // Recurse children
      for (let i = node.namedChildCount - 1; i >= 0; i--) {
        const child = node.namedChild(i)
        if (child) {
          stack.push({ node: child, scopes: scopeStack, inClassBody: nextInClassBody, functionDepth: nextFunctionDepth })
        }
      }

    }

    // --- Relationship passes -------------------------------------------------
    this.addContainmentRelationships(symbols, relationships)
    this.extractOverrideRelationships(symbols, relationships, context?.overrideCompanion)
    this.extractCallRelationships(rootNode, symbols, relationships, moduleName)
    this.extractExportRelationships(exports, relationships, moduleName)

    // --- Metadata ------------------------------------------------------------
    const architecturalScore = Math.min(100, Math.max(0, 100 - errors.length * 5))
    const detectedPatterns = Object.keys(patterns)
    const detectedFrameworks = Object.keys(frameworks)
    if (this.detectsJsx(rootNode)) {
      detectedFrameworks.push("React")
      detectedPatterns.push("JSX Components")
    }
    const frameworkPatterns = detectedPatterns.map((p) => ({
      framework: "JavaScript",
      patterns: [{ type: "usage", detected: true, description: p }],
    }))

    return {
      language: "javascript",
      symbols,
      relationships,
      imports,
      exports,
      errors,
      metadata: {
        complexity: symbols.length + relationships.length,
        linesOfCode: content.split("\n").length,
        cyclomaticComplexity,
        framework: detectedFrameworks.length > 1 ? detectedFrameworks[1] : detectedFrameworks[0],
        patterns: detectedPatterns,
        detectedFrameworks,
        frameworkPatterns,
        architecturalInsights: [],
        architecturalScore,
        codeQuality: errors.length === 0 ? "Excellent" : "Fair",
        hasTypeInference: false,
        hasFrameworkIntelligence: true,
        analysisVersion: "3.1.0-m12.10-family-contract",
      },
    }
  }

  // ============================================================================
  // RELATIONSHIP PASSES
  // ============================================================================

  private addContainmentRelationships(
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
  ): void {
    for (const symbol of symbols) {
      if (symbol.ownerName) {
        relationships.push({
          source: symbol.ownerName,
          target: symbol.name,
          type: ASTEngine.RelationshipType.Contains,
          confidence: 1.0,
          metadata: {},
        })
      }
    }
  }

  private extractOverrideRelationships(
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
    overrideCompanion?: Map<string, Set<string>>,
  ): void {
    // For each method with a base class (extends), if the base class declares
    // a same-name method (in-file OR via the cross-file companion index built
    // by the harness pre-pass), emit Derived.method -> Base.method.
    const byName = new Map<string, ASTEngine.UniversalSymbol[]>()
    for (const s of symbols) {
      const list = byName.get(s.name) ?? []
      list.push(s)
      byName.set(s.name, list)
    }
    const baseByClass = new Map<string, string>()
    for (const r of relationships) {
      if (r.type === ASTEngine.RelationshipType.Extends && r.source && r.target) {
        baseByClass.set(r.source, r.target)
      }
    }
    const baseDeclares = (base: string, method: string): boolean => {
      const inFile = byName.get(method)?.some((bm) => bm.ownerName === base) ?? false
      if (inFile) return true
      const companion = overrideCompanion?.get(base)
      return !!companion && companion.has(method)
    }
    for (const s of symbols) {
      if ((s.kind === ASTEngine.SymbolKind.Method || s.kind === ASTEngine.SymbolKind.Constructor) && s.ownerName) {
        const base = baseByClass.get(s.ownerName)
        if (!base) continue
        if (!baseDeclares(base, s.name)) continue
        relationships.push({
          source: `${s.ownerName}.${s.name}`,
          target: `${base}.${s.name}`,
          type: ASTEngine.RelationshipType.Overrides,
          confidence: 0.95,
          metadata: {},
        })
      }
    }
  }

  private extractCallRelationships(
    node: Node,
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
    moduleName: string,
  ): void {
    const resolveCurrent = (n: Node, current: string | null): string | null => {
      // Current call source = enclosing function/method leaf name
      const fnName = n.childForFieldName?.("name")?.text
      if (
        (n.type === "function_declaration" || n.type === "generator_function_declaration" ||
          n.type === "method_definition" || n.type === "function_expression") &&
        fnName
      ) {
        return fnName
      }
      if (n.type === "variable_declarator") {
        const nameNode = n.childForFieldName("name")
        const valueNode = n.childForFieldName("value")
        if (nameNode && nameNode.type === "identifier" &&
          valueNode && (valueNode.type === "arrow_function" || valueNode.type === "function_expression")) {
          return nameNode.text
        }
      }
      if (n.type === "assignment_expression") {
        // X.prototype.method = function () {} — calls inside source to `method`
        const left = n.childForFieldName("left")
        const right = n.childForFieldName("right")
        if (left && right &&
          (right.type === "function_expression" || right.type === "arrow_function") &&
          left.type === "member_expression") {
          const obj = left.childForFieldName("object")
          const prop = left.childForFieldName("property")
          if (obj && obj.type === "member_expression") {
            const protoProp = obj.childForFieldName("property")
            if (protoProp && protoProp.text === "prototype" && prop) {
              return prop.text
            }
          }
        }
      }
      return current
    }

    const processNode = (n: Node, current: string | null): void => {
      current = resolveCurrent(n, current)
      const callSource = current || moduleName

      if (n.type === "call_expression") {
        const fn = n.childForFieldName("function")
        if (fn && !(fn.type === "identifier" && fn.text === "require")) {
          let targetName = fn.text
          let fullCallee = fn.text
          let skip = false
          if (fn.type === "member_expression") {
            const prop = fn.childForFieldName("property")
            if (prop) targetName = prop.text
          } else if (fn.type === "subscript_expression") {
            // Computed/dynamic member calls (o[key](), o["literal"]()) are
            // not clean call targets — skip (family contract)
            skip = true
          }
          if (skip) {
            // computed/dynamic call — filtered
          } else if (
            targetName.length > 100 ||
            targetName.includes("\n") ||
            targetName.includes("`") ||
            targetName.includes("${") ||
            hasBraceEquals(targetName)
          ) {
            // malformed call from error recovery — skip
          } else if (this.isJSBuiltinCall(targetName, fullCallee)) {
            // filtered builtins
          } else {
            relationships.push({
              source: callSource,
              target: targetName,
              type: ASTEngine.RelationshipType.Calls,
              confidence: 0.9,
              metadata: { calleeExpression: fullCallee },
            })
          }
        }
      } else if (n.type === "new_expression") {
        const ctor = n.childForFieldName("constructor")
        if (ctor) {
          let ctorName = ""
          if (ctor.type === "identifier") ctorName = ctor.text
          else if (ctor.type === "member_expression") {
            const prop = ctor.childForFieldName("property")
            ctorName = prop ? prop.text : ctor.text
          }
          if (ctorName) {
            relationships.push({
              source: callSource,
              target: ctorName,
              type: ASTEngine.RelationshipType.Instantiates,
              confidence: 0.95,
              metadata: {},
            })
          }
        }
      }

      for (let i = 0; i < n.namedChildCount; i++) {
        const child = n.namedChild(i)
        if (child) processNode(child, current)
      }
    }

    processNode(node, null)
  }

  private extractExportRelationships(
    exports: ASTEngine.ExportInfo[],
    relationships: ASTEngine.UniversalRelationship[],
    moduleName: string,
  ): void {
    for (const item of exports) {
      relationships.push({
        source: moduleName,
        target: item.name,
        type: ASTEngine.RelationshipType.Exports,
        confidence: 1.0,
        metadata: { isDefault: item.isDefault },
      })
    }
  }

  // ============================================================================
  // HELPERS
  // ============================================================================

  private isJSBuiltinCall(targetName: string, fullCallee?: string): boolean {
    if (targetName === "super") return true
    if (JS_CONSOLE_BUILTINS.has(fullCallee || "")) return true
    const trimmed = stripWhitespace(fullCallee || "")
    if (JS_CONSOLE_BUILTINS.has(trimmed)) return true
    if (JS_OBJECT_LEAF_METHODS.has(targetName)) return true
    return false
  }

  private hasToken(node: Node, token: string): boolean {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (!child) continue
      if (child.type === token || child.text === token) return true
    }
    return false
  }

  private isConstDeclarator(node: Node): boolean {
    const parent = node.parent
    if (parent && (parent.type === "lexical_declaration" || parent.type === "variable_declaration")) {
      const kind = parent.childForFieldName("kind")
      if (kind) return kind.text === "const"
    }
    return false
  }

  private extractParameters(paramsNode: Node | null): ASTEngine.Parameter[] {
    if (!paramsNode) return []
    const out: ASTEngine.Parameter[] = []
    for (let i = 0; i < paramsNode.namedChildCount; i++) {
      const p = paramsNode.namedChild(i)
      if (!p) continue
      if (p.type === "identifier") {
        out.push({ name: p.text })
      } else if (p.type === "assignment_pattern") {
        const left = p.childForFieldName("left")
        if (left && left.type === "identifier") out.push({ name: left.text })
      } else if (p.type === "object_pattern" || p.type === "array_pattern") {
        // Destructured parameters are intentionally NOT symbols (family
        // contract); record them as a single parameter entry so the parameter
        // list is complete.
        out.push({ name: p.text.slice(0, 60) })
      } else if (p.type === "rest_pattern") {
        const inner = this.findChildByType(p, "identifier")
        out.push({ name: inner ? inner.text : "..." })
      }
    }
    return out
  }

  private methodComplexity(node: Node): number {
    let c = 1
    const stack: Node[] = [node]
    while (stack.length) {
      const n = stack.pop()!
      if (
        n.type === "if_statement" || n.type === "for_statement" ||
        n.type === "while_statement" || n.type === "catch_clause" ||
        n.type === "switch_case" || n.type === "ternary_expression"
      ) {
        c++
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const child = n.namedChild(i)
        if (child) stack.push(child)
      }
    }
    return c
  }

  private collectComments(node: Node): string[] | undefined {
    const comments: string[] = []
    // For exported declarations (`export class X`, `export const x = ...`), the
    // comment precedes the `export` keyword, not the declaration node — walk up
    // to the wrapper parent first (mirrors the TypeScript analyzer fix).
    const scanNode: Node = node.parent && node.parent.type === "export_statement" ? node.parent : node
    let sibling = scanNode.previousSibling
    while (sibling) {
      if (sibling.type === "comment") {
        comments.unshift(stripCommentMarkers(sibling.text))
        sibling = sibling.previousSibling
      } else {
        break
      }
    }
    return comments.length > 0 ? comments : undefined
  }

  private collectModuleExports(
    right: Node,
    exports: ASTEngine.ExportInfo[],
    node: Node,
    isDefault: boolean,
  ): void {
    if (right.type === "object") {
      for (let i = 0; i < right.namedChildCount; i++) {
        const c = right.namedChild(i)
        if (!c) continue
        if (c.type === "shorthand_property_identifier" || c.type === "identifier") {
          exports.push({ name: c.text, isDefault: false, range: this.nodeToRange(c) })
        } else if (c.type === "pair") {
          const key = c.childForFieldName("key")
          if (key && (key.type === "property_identifier" || key.type === "identifier")) {
            exports.push({ name: key.text, isDefault: false, range: this.nodeToRange(key) })
          }
        }
      }
    } else if (right.type === "identifier") {
      exports.push({ name: right.text, isDefault, range: this.nodeToRange(right) })
    } else if (right.type === "function_expression" || right.type === "arrow_function" || right.type === "class_declaration" || right.type === "class") {
      const nm = right.type === "class_declaration" || right.type === "class"
        ? right.childForFieldName("name")?.text
        : undefined
      exports.push({ name: nm ?? "default", isDefault, range: this.nodeToRange(right) })
    }
  }

  private collectExportStatement(node: Node, exports: ASTEngine.ExportInfo[]): void {
    let isDefault = false
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (!child) continue
      if (child.type === "default") {
        isDefault = true
      } else if (child.type === "identifier") {
        exports.push({ name: child.text, isDefault, range: this.nodeToRange(child) })
      } else if (child.type === "export_clause") {
        for (let j = 0; j < child.namedChildCount; j++) {
          const spec = child.namedChild(j)
          if (spec && spec.type === "export_specifier") {
            const n = this.findChildByType(spec, "identifier")
            if (n) exports.push({ name: n.text, isDefault: false, range: this.nodeToRange(n) })
          }
        }
      } else if (
        child.type === "function_declaration" || child.type === "generator_function_declaration" ||
        child.type === "class_declaration"
      ) {
        const n = child.childForFieldName("name")
        if (n) exports.push({ name: n.text, isDefault, range: this.nodeToRange(n) })
      } else if (child.type === "lexical_declaration" || child.type === "variable_declaration") {
        for (let j = 0; j < child.namedChildCount; j++) {
          const decl = child.namedChild(j)
          if (decl && decl.type === "variable_declarator") {
            const nm = decl.childForFieldName("name")
            if (nm && nm.type === "identifier") {
              exports.push({ name: nm.text, isDefault, range: this.nodeToRange(nm) })
            }
          }
        }
      }
    }
  }

  private findChildByType(node: Node, type: string): Node | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child && child.type === type) return child
    }
    return null
  }

  private detectsJsx(rootNode: Node): boolean {
    const stack: Node[] = [rootNode]
    let maxIters = 500
    while (stack.length > 0 && maxIters-- > 0) {
      const node = stack.pop()!
      if (node.type === "jsx_element" || node.type === "jsx_self_closing_element") return true
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i)
        if (child) stack.push(child)
      }
    }
    return false
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
