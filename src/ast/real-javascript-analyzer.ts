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
// Global constructor intrinsics/DOM APIs: `new Promise()` is construction
// of the RUNTIME, not of a project type — instantiates edges to these are
// noise (same rationale as the JVM stdlib filters).
const JS_GLOBAL_CONSTRUCTORS = new Set([
  "Promise", "Date", "Map", "Set", "WeakMap", "WeakSet", "Symbol", "Proxy",
  "Error", "TypeError", "RangeError", "SyntaxError", "URIError", "EvalError",
  "AggregateError", "RegExp", "Array", "Object", "Function", "Boolean",
  "Number", "String", "BigInt", "ArrayBuffer", "SharedArrayBuffer",
  "DataView", "Int8Array", "Uint8Array", "Uint8ClampedArray", "Int16Array",
  "Uint16Array", "Int32Array", "Uint32Array", "Float32Array", "Float64Array",
  "BigInt64Array", "BigUint64Array", "WeakRef", "FinalizationRegistry",
  "AbortController", "FormData", "Blob", "File", "URL", "URLSearchParams",
  "Headers", "Request", "Response", "Intl", "Image", "Worker", "SharedWorker",
  "CustomEvent", "Event", "MouseEvent", "KeyboardEvent", "ResizeObserver",
  "MutationObserver", "IntersectionObserver", "PerformanceObserver",
  "FileReader", "XMLHttpRequest", "WebSocket", "TextEncoder", "TextDecoder",
  "DOMParser", "Notification", "BroadcastChannel", "MessageChannel",
  "FocusEvent", "InputEvent", "PointerEvent", "TouchEvent", "DragEvent", "ErrorEvent", "UIEvent", "StorageEvent", "PromiseRejectionEvent", "HashChangeEvent", "PageTransitionEvent", "PopStateEvent", "ProgressEvent", "SpeechSynthesisEvent", "AnimationEvent", "TransitionEvent", "ClipboardEvent", "WheelEvent", "CompositionEvent", "BeforeUnloadEvent",
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

      // FAMILY CONTRACT (M14 cross-language parity): 1 + decision points;
      // decision points include branch constructs AND short-circuit
      // operators; an else never adds.
      if (
        node.type === "if_statement" ||
        node.type === "for_statement" ||
        node.type === "for_in_statement" ||
        node.type === "while_statement" ||
        node.type === "do_statement" ||
        node.type === "catch_clause" ||
        node.type === "switch_case" ||
        node.type === "ternary_expression"
      ) {
        cyclomaticComplexity++
      } else if (node.type === "binary_expression") {
        const op = node.childForFieldName("operator")?.text
        if (op === "&&" || op === "||" || op === "??") cyclomaticComplexity++
      }

      switch (node.type) {
        case "class_declaration": {
          const name = node.childForFieldName("name")?.text
          if (name) {
            const comments = this.collectComments(node)
            const decorators = this.collectOwnDecorators(node)
            symbols.push({
              name,
              kind: ASTEngine.SymbolKind.Class,
              range: this.nodeToRange(node),
              scope: scopeString(scopeStack),
              visibility: "public",
              decorators: decorators.length > 0 ? decorators : undefined,
              comments,
              metadata: { isClass: true },
            })
            scopeStack.push({ name, kind: JSScopeKind.Class })
            nextInClassBody = true

            // extends heritage. The base may be a bare identifier OR a
            // member_expression (`extends Lib.Base`) — matching only
            // identifier silently dropped every qualified heritage edge.
            const heritage = this.findChildByType(node, "class_heritage")
            if (heritage) {
              const base = this.findChildByType(heritage, "identifier") ?? this.findChildByType(heritage, "member_expression")
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
            const isConstructor = name === "constructor"
            const dedupKey = `${owner ?? "module"}:${name.startsWith("#") ? name.slice(1) : name}`
            const isAccessor = this.hasToken(node, "get") || this.hasToken(node, "set")
            const kind = isConstructor
              ? ASTEngine.SymbolKind.Constructor
              : isAccessor
                ? ASTEngine.SymbolKind.Property
                : ASTEngine.SymbolKind.Method
            const isStatic = this.hasToken(node, "static")
            const isAsync = this.hasToken(node, "async")
            const isGenerator = this.hasToken(node, "*")
            const isPrivateMethod = name.startsWith("#")
            const cleanName = isPrivateMethod ? name.slice(1) : name
            if (!seenMethods.has(dedupKey)) {
              seenMethods.add(dedupKey)
              const params = this.extractParameters(node.childForFieldName("parameters"))
              const comments = this.collectComments(node)
              // Decorators are OWN children of method_definition in the JS
              // grammar (unlike TS where method decorators are class_body
              // siblings).
              const decorators = this.collectOwnDecorators(node)
              symbols.push({
                name: cleanName,
                kind,
                range: this.nodeToRange(node),
                scope: scopeString(scopeStack),
                ownerName: owner,
                ownerKind: owner ? ASTEngine.SymbolKind.Class : undefined,
                // '#' members are class-private regardless of other tokens.
                visibility: isPrivateMethod ? "private" : "public",
                isStatic,
                parameters: params,
                decorators: decorators.length > 0 ? decorators : undefined,
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
              } else if (obj && obj.type === "member_expression" && propText && (objText === "module.exports" || objText.startsWith("module.exports.") || objText === "exports" || objText.startsWith("exports."))) {
                // DEEP property assignment: `module.exports.sub = ...` /
                // `exports.group.item = 1` — every segment below the base
                // belongs to the module's public surface. Only ONE level
                // below the base was recognized before; deeper chains were
                // silently dropped.
                patterns["CommonJS Exports"] = true
                const afterBase =
                  objText === "module.exports" ? [] :
                  objText === "exports" ? [] :
                  objText.replace(/^module\.exports\./, "").replace(/^exports\./, "").split(".")
                const exportName = [...afterBase, propText].join(".")
                exports.push({ name: exportName, isDefault: false, range: this.nodeToRange(prop!) })
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
                    // The LOCAL BINDING is the alias when present (`{ a as b }` binds b).
                    const n = this.findChildByType(spec, "identifier")
                    const alias = spec.childForFieldName("alias")
                    const item = alias ?? n
                    if (item) items.push(item.text)
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
          // Re-export dependency: `export * from "./barrel"` /
          // `export { x } from "./mod"`. Barrel files are ubiquitous in JS
          // ecosystems; without this their module edges were invisible.
          const exportSource = node.childForFieldName("source")
          if (exportSource) {
            const modPath = stringContent(exportSource)
            // Named clauses carry their names (`export { a, b } from "./m"`);
            // a bare star records "*".
            const clauseNames: string[] = []
            const clause2 = this.findChildByType(node, "export_clause")
            if (clause2) {
              for (let i = 0; i < clause2.namedChildCount; i++) {
                const spec = clause2.namedChild(i)
                if (spec && spec.type === "export_specifier") {
                  const alias = spec.childForFieldName("alias")
                  const nm = alias ?? spec.childForFieldName("name")
                  if (nm) clauseNames.push(nm.text)
                }
              }
            }
            const starOnly = !clause2 && this.hasToken(node, "*")
            imports.push({
              module: modPath,
              items: starOnly ? ["*"] : clauseNames,
              isDefault: false,
              range: this.nodeToRange(node),
              metadata: { reExport: true },
            })
            relationships.push({
              source: moduleName,
              target: `${modPath}:*`,
              type: ASTEngine.RelationshipType.Imports,
              confidence: 1.0,
              metadata: { isReExport: true },
            })
            patterns["ES6 ReExports"] = true
          }
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

    // --- Symbol payload: qualified_calls (family contract #383) --------------
    // Dotted call paths WITHOUT argument text, attached to the enclosing
    // function/method symbol — parity with TS/Java/Groovy/Kotlin/Scala.
    {
      const bySource = new Map<string, string[]>()
      const qcResolve = (n: Node, current: string | null): string | null => {
        const fnName = n.childForFieldName?.("name")?.text
        if (
          (n.type === "function_declaration" || n.type === "generator_function_declaration" ||
            n.type === "method_definition") &&
          fnName
        ) return fnName
        if (n.type === "variable_declarator") {
          const nameNode = n.childForFieldName("name")
          const valueNode = n.childForFieldName("value")
          if (nameNode && valueNode && (valueNode.type === "arrow_function" || valueNode.type === "function_expression")) {
            return nameNode.text
          }
        }
        // X.prototype.m = function () {} — calls inside the body belong to m
        // (same rule as extractCallRelationships; missing here left prototype
        // methods with empty qualified_calls).
        if (n.type === "assignment_expression") {
          const left = n.childForFieldName("left")
          const right = n.childForFieldName("right")
          if (left && right && (right.type === "function_expression" || right.type === "arrow_function") && left.type === "member_expression") {
            const obj = left.childForFieldName("object")
            const prop = left.childForFieldName("property")
            if (obj && obj.type === "member_expression" && prop) {
              const protoProp = obj.childForFieldName("property")
              if (protoProp && protoProp.text === "prototype") return prop.text
            }
          }
        }
        return current
      }
      const qcWalk = (n: Node, current: string | null): void => {
        current = qcResolve(n, current)
        if (n.type === "call_expression") {
          const fn = n.childForFieldName("function")
          if (fn && !(fn.type === "identifier" && fn.text === "require")) {
            // dotted path without argument text
            const parts: string[] = []
            let cur: Node | null = fn
            while (cur) {
              if (cur.type === "member_expression") {
                const prop2 = cur.childForFieldName("property")
                parts.unshift(prop2 ? prop2.text : cur.namedChild(cur.namedChildCount - 1)?.text ?? "")
                cur = cur.childForFieldName("object")
              } else if (cur.type === "call_expression") {
                cur = cur.namedChild(0)
              } else {
                parts.unshift(cur.text)
                break
              }
            }
            const path = parts.filter(Boolean).join(".")
            if (current && path) {
              const list = bySource.get(current) ?? []
              list.push(path)
              bySource.set(current, list)
            }
          }
        }
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c) qcWalk(c, current)
        }
      }
      qcWalk(rootNode, null)
      for (const sym of symbols) {
        const list = bySource.get(sym.name)
        if (list && list.length > 0) sym.qualified_calls = [...new Set(list)]
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

    // Field-access uses (parity with java/groovy/kotlin collectors).
    this.collectFieldAccessUses(rootNode, relationships)

    // Declared/checked type references (M14): JavaScript has no type
    // annotations, but instanceof checks reference a type by name — the one
    // unambiguous type-usage signal the grammar carries.
    this.extractInstanceofRefs(rootNode, relationships)

    this.classifyEvidenceTier(relationships)

    return {
      language: "javascript",
      symbols,
      relationships,
      imports,
      exports,
      errors,
      metadata: {
        // Real cyclomatic complexity — was the synthetic heuristic
        // symbols.length + relationships.length, which is not a complexity
        // metric at all (same defect previously fixed on groovy/scala).
        complexity: cyclomaticComplexity,
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
          if (ctorName && !JS_GLOBAL_CONSTRUCTORS.has(ctorName)) {
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

  /** Decorator names from a node's OWN children (JS grammar placement). */
  private collectOwnDecorators(node: Node): string[] {
    const out: string[] = []
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (!c || c.type !== "decorator") continue
      // decorator text without arguments: @observable -> observable;
      // @computed({x}) -> computed. First named child of a decorated call
      // is the callee expression.
      let nameText = c.text
      const inner = c.namedChild(0)
      if (inner && (inner.type === "call_expression" || inner.type === "member_expression" || inner.type === "identifier")) {
        nameText = inner.text.split("(")[0]
      }
      out.push(nameText.replace(/^@/, ""))
    }
    return out
  }

  private hasToken(node: Node, token: string): boolean {
    // Anonymous-token check ONLY. Matching child.text also matched the
    // method's own NAME identifier — a plain `get() {}` / `set(v) {}`
    // method was classified as an accessor Property, and `async()` carried
    // isAsync=true. Keywords/operators here are anonymous tokens whose
    // type equals their text ('get', 'set', 'static', 'async', '*').
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (!child || child.isNamed) continue
      if (child.type === token) return true
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
        n.type === "for_in_statement" || n.type === "do_statement" ||
        n.type === "while_statement" || n.type === "catch_clause" ||
        n.type === "switch_case" || n.type === "ternary_expression"
      ) {
        c++
      } else if (n.type === "binary_expression") {
        // Short-circuit operators are decision points (family contract).
        const op = n.childForFieldName("operator")?.text
        if (op === "&&" || op === "||" || op === "??") c++
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
    // Contiguity boundary: a blank line between the comment run and the
    // anchor ends the walk. Without this, trailing remarks about the
    // PREVIOUS declaration were stolen across the gap (X1, fixed on TS).
    let anchorRow = scanNode.startPosition.row
    while (sibling) {
      if (sibling.type === "comment") {
        if (sibling.endPosition.row + 1 < anchorRow) break
        comments.unshift(stripCommentMarkers(sibling.text))
        anchorRow = sibling.startPosition.row
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
        child.type === "class_declaration" || child.type === "function_expression" ||
        child.type === "arrow_function" || child.type === "class"
      ) {
        // ANONYMOUS default declarations (`export default function () {}`)
        // have no name node — previously dropped entirely, losing the
        // module's main export. Record under the family sentinel "default".
        const n = child.childForFieldName("name")
        exports.push({ name: n?.text ?? "default", isDefault, range: this.nodeToRange(child) })
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

  /**
   * Field-access uses: member_expression nodes emit root-anchored Uses edges
   * @0.6 with isFieldAccess marker - parity with java/groovy/kotlin
   * collectors. Nested member_expressions mean each chain segment appears as
   * a target (anti-skip guarantee); optional chains (?.) are
   * member_expression nodes with optional_chain tokens in this grammar.
   */
  /**
   * M14 — instanceof type references. `x instanceof T` is JavaScript's only
   * unambiguous named-type usage; emitted as References from the enclosing
   * function/class. The right operand lexes as identifier (expression
   * position), so no type_identifier filtering applies.
   */
  private extractInstanceofRefs(rootNode: Node, relationships: ASTEngine.UniversalRelationship[]): void {
    const emitted = new Set<string>()
    const resolveSource = (start: Node): string => {
      let p: Node | null = start.parent
      while (p) {
        if (
          p.type === "class_declaration" ||
          p.type === "function_declaration" ||
          p.type === "generator_function_declaration" ||
          p.type === "method_definition"
        ) {
          for (let i = 0; i < p.namedChildCount; i++) {
            const c = p.namedChild(i)
            if (!c) continue
            if (c.type === "identifier" || c.type === "property_identifier") return c.text
          }
        }
        p = p.parent
      }
      return "global"
    }
    const walk = (n: Node): void => {
      if (n.type === "binary_expression") {
        let isInstanceof = false
        for (let i = 0; i < n.childCount; i++) {
          const c = n.child(i)
          if (c && !c.isNamed && c.text === "instanceof") { isInstanceof = true; break }
        }
        if (isInstanceof && n.namedChildCount >= 2) {
          const right = n.namedChild(n.namedChildCount - 1)
          if (right) {
            const source = resolveSource(n)
            const key = `${source}|${right.text}`
            if (!emitted.has(key)) {
              emitted.add(key)
              relationships.push({
                source,
                target: right.text,
                type: ASTEngine.RelationshipType.References,
                confidence: 0.95,
                metadata: { relationshipType: "instanceof_check" },
              })
            }
          }
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
  ) {
    const stack: { node: Node; owner: string | null }[] = [{ node: rootNode, owner: null }]
    const seen = new Set<string>()
    while (stack.length > 0) {
      const item = stack.pop()!
      const node: Node = item.node
      const owner = item.owner

      if (
        node.type === "class_declaration" ||
        node.type === "class" ||
        node.type === "function_declaration"
      ) {
        const nameNode =
          node.childForFieldName?.("name") ?? node.namedChildren.find((c: any) => c.type === "identifier")
        const nextOwner = nameNode ? nameNode.text : owner
        for (let i = node.namedChildCount - 1; i >= 0; i--) {
          const child = node.namedChild(i)
          if (child) stack.push({ node: child, owner: nextOwner })
        }
        continue
      }

      if (node.type === "member_expression") {
        const parts: string[] = []
        let cur: Node | null | undefined = node
        // flatten nested member_expression chain into segments
        while (cur && cur.type === "member_expression") {
          const prop = cur.childForFieldName("property")
          if (prop) parts.unshift(prop.text)
          cur = cur.childForFieldName("object")
        }
        const head = cur ? cur.text : ""
        if (head && parts.length >= 1) {
          for (const seg of parts) {
            const source = head === "this" || head === "super" ? owner ?? head : head
            const key = `${source}.${seg}`
            if (!seen.has(key)) {
              seen.add(key)
              relationships.push({
                source,
                target: seg,
                type: ASTEngine.RelationshipType.Uses,
                confidence: 0.6,
                metadata: { isFieldAccess: true },
              })
            }
          }
        }
      }
      for (let i = node.namedChildCount - 1; i >= 0; i--) {
        const child = node.namedChild(i)
        if (child) stack.push({ node: child, owner })
      }
    }
  }

  /**
   * M14 #299 - evidence-tier classification for EVERY emitted relationship.
   * Same rules as the JVM/TS family. JS calls are usage_contextual,
   * field_access uses are usage_contextual, imports are import_based.
   */
  private classifyEvidenceTier(relationships: ASTEngine.UniversalRelationship[]): void {
    for (const r of relationships) {
      const md = r.metadata ?? (r.metadata = {})
      if (md.evidenceClass) continue
      const t = String(r.type ?? r.relationshipType ?? "")
      const conf = typeof r.confidence === "number" ? r.confidence : 1
      if (t === "contains" || t === "exports") { md.evidenceClass = "structural"; continue }
      if (t === "references") {
        md.evidenceClass = md.isImport ? "import_based" : "reference_qualified"
        continue
      }
      if (t === "extends" || t === "implements" || t === "overrides") {
        md.evidenceClass = conf >= 1 ? "structural" : conf >= 0.85 ? "usage_contextual" : "inferred"
        continue
      }
      if (t === "instantiates") {
        md.evidenceClass = conf >= 0.9 ? "structural" : "usage_contextual"
        continue
      }
      md.evidenceClass = "usage_contextual"
    }
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
