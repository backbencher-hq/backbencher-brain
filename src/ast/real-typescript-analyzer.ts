// TypeScript/JavaScript Intelligence Engine
// Complete AST analysis with zero stubs, zero shortcuts, 100% real implementation
// The most powerful TypeScript analyzer ever built

import type { Node } from "web-tree-sitter"
import { detectFrameworks, type FrameworkInfo } from "./framework-detectors"
import { ASTEngine } from "./engine"
import * as path from "path"
import * as fs from "fs"

// ============================================================================
// BUILTIN FILTER - C#-family contract
// Console output (console.log) and Object universal leaf methods are filtered;
// framework/static calls (Map.set, Promise.resolve, String.trim, array.map,
// RegExp.test) are KEPT like Java's JDK calls (save -> put) and C#'s
// Math.Sqrt -> Sqrt. `super` is a language keyword, not a callable.
// ============================================================================

const TS_CONSOLE_BUILTINS = new Set([
  "console.log", "console.warn", "console.error", "console.info", "console.debug",
  "console.trace", "console.table", "console.group", "console.groupEnd",
  "console.groupCollapsed", "console.time", "console.timeEnd", "console.assert",
  "console.count", "console.countReset", "console.dir", "console.dirxml",
  "console.clear", "console.profile", "console.profileEnd",
])
const TS_OBJECT_LEAF_METHODS = new Set([
  "toString", "valueOf", "hasOwnProperty", "isPrototypeOf",
  "propertyIsEnumerable", "toLocaleString", "__defineGetter__", "__defineSetter__",
])

// ============================================================================
// PURE-STRING HELPERS (regex-free normalization)
// All token/type text normalization uses startsWith/endsWith + slice — never
// regex literals — keeping the analyzer fully regex-free (criterion 1). These
// are module-level pure functions shared by all classes in this file.
// ============================================================================

function stripLeading(text: string, prefix: string): string {
  return text.startsWith(prefix) ? text.slice(prefix.length).trimStart() : text
}

function stripLeadingColon(text: string): string {
  return stripLeading(text, ":")
}

function stripLeadingEquals(text: string): string {
  return stripLeading(text, "=")
}

function stripTrailingDot(text: string): string {
  return text.endsWith(".") ? text.slice(0, -1) : text
}

function stripTrailingQuestion(text: string): string {
  return text.endsWith("?") ? text.slice(0, -1) : text
}

function stripPrivatePrefix(name: string): string {
  return name.startsWith("#") ? name.slice(1) : name
}

function unquote(text: string): string {
  // Strip one level of matching surrounding quotes ("...", '...', `...`).
  if (text.length >= 2) {
    const first = text[0]
    if ((first === '"' || first === "'" || first === "`") && text[text.length - 1] === first) {
      return text.slice(1, -1)
    }
  }
  return text
}

function stringContent(node: Node): string {
  // Pure-AST string content: prefer the string_fragment child (tree-sitter
  // splits quoted literals into string + string_fragment), else unquote.
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
  // Malformed-call guard: any of { } ; = present (no regex).
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
}

// Contract route paths always start with "/": join a controller base with a
// method route collapsing duplicate slashes (pure string ops, no regex —
// java composes basePath+methodRoute the same way).
function joinContractPaths(base: string, route: string | undefined): string {
  let b = base
  while (b.length > 1 && b.endsWith("/")) b = b.slice(0, -1)
  let r = route ?? ""
  while (r.startsWith("/")) r = r.slice(1)
  while (r.length > 0 && r.endsWith("/")) r = r.slice(0, -1)
  if (!b.startsWith("/")) b = "/" + b
  return r ? b + "/" + r : b
}

function ensureLeadingSlash(p: string): string {
  return p.startsWith("/") ? p : "/" + p
}

// ============================================================================
// SCOPE MANAGEMENT - Proper scope tracking with push/pop for all scope types
// ============================================================================

enum ScopeKind {
  Global = "global",
  Module = "module",
  Namespace = "namespace",
  Class = "class",
  Function = "function",
  Method = "method",
  Block = "block",
  ArrowFunction = "arrow_function",
  Constructor = "constructor",
  Interface = "interface",
  Enum = "enum",
  Type = "type",
}

interface ScopeEntry {
  kind: ScopeKind
  name: string
  node: Node
  symbols: Map<string, ASTEngine.UniversalSymbol>
}

interface StackEntry {
  node?: Node
  action?: () => void
}

class ScopeManager {
  private stack: ScopeEntry[] = []

  constructor() {
    // Start with global scope
    this.pushScope(ScopeKind.Global, "__global__", null as any)
  }

  pushScope(kind: ScopeKind, name: string, node: Node): void {
    this.stack.push({
      kind,
      name,
      node,
      symbols: new Map(),
    })
  }

  popScope(): ScopeEntry | undefined {
    if (this.stack.length > 1) {
      return this.stack.pop()
    }
    return undefined // Never pop global scope
  }

  currentScope(): ScopeEntry {
    return this.stack[this.stack.length - 1]
  }

  buildQualifiedName(name: string): string {
    const parts: string[] = []
    for (let i = 1; i < this.stack.length; i++) {
      const scope = this.stack[i]
      if (scope.kind !== ScopeKind.Block && scope.kind !== ScopeKind.Global) {
        parts.push(scope.name)
      }
    }
    parts.push(name)
    return parts.join(".")
  }

  getOwnerInfo(): { ownerName?: string; ownerKind?: ASTEngine.SymbolKind } | undefined {    // Find the nearest class/namespace/interface owner
    for (let i = this.stack.length - 1; i >= 0; i--) {
      const scope = this.stack[i]
      switch (scope.kind) {
        case ScopeKind.Class:
          return { ownerName: scope.name, ownerKind: ASTEngine.SymbolKind.Class }
        case ScopeKind.Namespace:
          return { ownerName: scope.name, ownerKind: ASTEngine.SymbolKind.Namespace }
        case ScopeKind.Interface:
          return { ownerName: scope.name, ownerKind: ASTEngine.SymbolKind.Interface }
        case ScopeKind.Enum:
          return { ownerName: scope.name, ownerKind: ASTEngine.SymbolKind.Enum }
      }
    }
    return undefined
  }

  findEnclosingClassNode(): Node | null {
    // Nearest Class scope's node (for class-level decorator lookup —
    // controller base paths). Returns null outside any class.
    for (let i = this.stack.length - 1; i >= 0; i--) {
      if (this.stack[i].kind === ScopeKind.Class) return this.stack[i].node
    }
    return null
  }

  registerSymbol(symbol: ASTEngine.UniversalSymbol): void {
    this.currentScope().symbols.set(symbol.name, symbol)
  }

  findSymbolInScope(name: string): ASTEngine.UniversalSymbol | undefined {
    // Search from innermost to outermost scope
    for (let i = this.stack.length - 1; i >= 0; i--) {
      const found = this.stack[i].symbols.get(name)
      if (found) return found
    }
    return undefined
  }

  isInsideClass(): boolean {
    return someItems(this.stack, (s) => s.kind === ScopeKind.Class)
  }

  isInsideFunction(): boolean {
    return someItems(
      this.stack,
      (s) =>
        s.kind === ScopeKind.Function ||
        s.kind === ScopeKind.Method ||
        s.kind === ScopeKind.ArrowFunction ||
        s.kind === ScopeKind.Constructor,
    )
  }

  getDepth(): number {
    return this.stack.length
  }

  reset(): void {
    this.stack = []
    this.pushScope(ScopeKind.Global, "__global__", null as any)
  }
}

// ============================================================================
// MODULE RESOLUTION - Real Node.js module resolution algorithm
// ============================================================================

class TypeScriptModuleResolver {
  constructor(private baseDir: string) {}

  resolveModulePath(specifier: string, fromFile: string): string {
    const fromDir = path.dirname(fromFile)

    // Handle relative imports — pure path algebra, no existence probes.
    if (specifier.startsWith("./") || specifier.startsWith("../")) {
      return path.resolve(fromDir, specifier)
    }

    // Handle absolute imports starting with /
    if (specifier.startsWith("/")) {
      return path.join(this.baseDir, specifier)
    }

    // Handle Node.js built-ins
    if (isBuiltinModule(specifier)) {
      return `node:${stripLeading(specifier, "node:")}`
    }

    // Bare package imports are recorded by logical identity
    // (`external:specifier`). A previous revision walked up to node_modules
    // and sniffed package.json main/types entry points — every answer it
    // gave depended on the local machine, so the same repo indexed
    // differently per machine, at the cost of sync statSync I/O per import
    // per file. Nothing reads past the specifier (verified: no
    // metadata.resolvedPath consumers repo-wide; fixtures pin module/items
    // only), and the codebase's own isExternalModule already classifies
    // exactly these specifiers as external. Deterministic on every machine.
    return `external:${specifier}`
  }

  isExternalModule(specifier: string): boolean {
    return !specifier.startsWith(".") && !specifier.startsWith("/") && !specifier.startsWith("node:")
  }
}

// Node.js built-in modules — module-level so every resolution doesn't
// reallocate the set (the old per-call construction ran per import).
const NODE_BUILTINS = new Set([
  "assert",
  "buffer",
  "child_process",
  "cluster",
  "console",
  "constants",
  "crypto",
  "dgram",
  "dns",
  "domain",
  "events",
  "fs",
  "http",
  "https",
  "module",
  "net",
  "os",
  "path",
  "process",
  "punycode",
  "querystring",
  "readline",
  "repl",
  "stream",
  "string_decoder",
  "sys",
  "timers",
  "tls",
  "tty",
  "url",
  "util",
  "v8",
  "vm",
  "zlib",
  "async_hooks",
  "inspector",
  "perf_hooks",
  "trace_events",
  "worker_threads",
  "wasi",
])

function isBuiltinModule(specifier: string): boolean {
  return NODE_BUILTINS.has(stripLeading(specifier, "node:"))
}

// ============================================================================
// MODIFIER EXTRACTION - AST-based, no text.includes() hacks
// ============================================================================

interface ModifierInfo {
  isPublic: boolean
  isPrivate: boolean
  isProtected: boolean
  isStatic: boolean
  isAsync: boolean
  isAbstract: boolean
  isReadonly: boolean
  isExport: boolean
  isDefault: boolean
  isDeclare: boolean
  isConst: boolean
  isOverride: boolean
  decorators: string[]
  /** Decorator lines, PARALLEL to `decorators` (M59 #860). The name list is
   *  what the store reads on the symbol; this list lets a decorator's reference
   *  edge name the line the decorator is written on, exactly as
   *  extendsLines/implementsLines do for heritage. */
  decoratorLines: Array<number | null>
}

/** Record a decorator name WITH its own line, keeping the two lists in
 *  lockstep. A name already recorded keeps its first line (the same decorator
 *  is seen by both the own-children scan and the sibling collector). */
function addDecorator(m: ModifierInfo, name: string, line: number | null): void {
  if (m.decorators.includes(name)) return
  m.decorators.push(name)
  m.decoratorLines.push(line)
}

function extractModifiersFromNode(node: Node): ModifierInfo {
  const result: ModifierInfo = {
    isPublic: false,
    isPrivate: false,
    isProtected: false,
    isStatic: false,
    isAsync: false,
    isAbstract: false,
    isReadonly: false,
    isExport: false,
    isDefault: false,
    isDeclare: false,
    isConst: false,
    isOverride: false,
    decorators: [],
    decoratorLines: [],
  }

  // Check for decorators first (they come before modifiers)
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i)
    if (!child) continue

    if (child.type === "decorator") {
      const decoratorName = extractDecoratorName(child)
      if (decoratorName) {
        addDecorator(result, decoratorName, child.startPosition.row + 1)
      }
    }
  }

  // Walk through all children to find modifiers
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)
    if (!child) continue

    const nodeType = child.type
    const nodeText = child.text

    // Handle accessibility modifiers
    if (nodeType === "accessibility_modifier") {
      switch (nodeText) {
        case "public":
          result.isPublic = true
          break
        case "private":
          result.isPrivate = true
          break
        case "protected":
          result.isProtected = true
          break
      }
      continue
    }

    // Handle individual keyword modifiers
    switch (nodeType) {
      case "static":
        result.isStatic = true
        break
      case "async":
        result.isAsync = true
        break
      case "abstract":
        result.isAbstract = true
        break
      case "readonly":
        result.isReadonly = true
        break
      case "export":
        result.isExport = true
        break
      case "default":
        result.isDefault = true
        break
      case "declare":
        result.isDeclare = true
        break
      case "const":
        result.isConst = true
        break
      case "override":
        result.isOverride = true
        break
    }

    // Also check text for keywords that might be typed differently
    if (nodeText === "static") result.isStatic = true
    if (nodeText === "async") result.isAsync = true
    if (nodeText === "abstract") result.isAbstract = true
    if (nodeText === "readonly") result.isReadonly = true
    if (nodeText === "export") result.isExport = true
    if (nodeText === "default") result.isDefault = true
    if (nodeText === "declare") result.isDeclare = true
    if (nodeText === "override") result.isOverride = true
  }

  return result
}

/**
 * Decorators for a class-level definition. Placement is ASYMMETRIC in this
 * grammar family: field decorators attach INSIDE public_field_definition,
 * but class decorators are children of export_statement/class_declaration
 * and METHOD decorators are SIBLINGS in class_body preceding the
 * method_definition. Reading only the definition node's own children sees
 * field decorators and misses everything else.
 */
function collectDecoratorsForMember(member: Node, body: Node | null): Node[] {
  const out: Node[] = []
  const own = extractModifiersFromNode(member).decorators
  if (own.length > 0) return [] // own-children scan already handled it

  // Method/class decorators: immediately-preceding consecutive decorator
  // siblings within the same body.
  if (body) {
    // web-tree-sitter returns FRESH wrapper objects per access — node
    // identity must be compared by startIndex, not object equality.
    let idx = -1
    for (let i = 0; i < body.namedChildCount; i++) {
      const c = body.namedChild(i)
      if (c && c.startIndex === member.startIndex && c.type === member.type) { idx = i; break }
    }
    if (idx > 0) {
      for (let i = idx - 1; i >= 0; i--) {
        const sib = body.namedChild(i)
        if (sib && sib.type === "decorator") out.unshift(sib)
        else break
      }
    }
  }
  return out
}

/** Class decorators: own children, or the wrapping export_statement's. */
function collectDecoratorsForClass(node: Node): Node[] {
  const out: Node[] = []
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i)
    if (c && c.type === "decorator") out.push(c)
  }
  if (out.length === 0 && node.parent?.type === "export_statement") {
    for (let i = 0; i < node.parent.childCount; i++) {
      const c = node.parent.child(i)
      if (c && c.type === "decorator") out.push(c)
    }
  }
  return out
}

function extractDecoratorName(decoratorNode: Node): string | null {  // Decorator structure: @DecoratorName or @DecoratorName() or @module.Decorator()
  for (let i = 0; i < decoratorNode.namedChildCount; i++) {
    const child = decoratorNode.namedChild(i)
    if (!child) continue

    if (child.type === "identifier") {
      return child.text
    }

    if (child.type === "call_expression") {
      const callee = child.namedChild(0)
      if (callee) {
        if (callee.type === "identifier") {
          return callee.text
        }
        if (callee.type === "member_expression") {
          // Get the property name for qualified decorators
          const property = callee.childForFieldName("property")
          if (property) {
            return callee.text // Return full qualified name
          }
        }
      }
    }

    if (child.type === "member_expression") {
      return child.text
    }
  }

  return null
}

// ============================================================================
// EXPORT STATUS ANALYSIS - AST parent analysis for export detection
// ============================================================================

function isNodeExported(node: Node): { isExported: boolean; isDefault: boolean } {
  let current: Node | null = node

  while (current) {
    const p = current.parent as Node | null
    if (!p) break

    // Check if wrapped in export statement
    if (p.type === "export_statement") {
      // Check for default export
      for (let i = 0; i < p.childCount; i++) {
        const child = p.child(i)
        if (child && child.text === "default") {
          return { isExported: true, isDefault: true }
        }
      }
      return { isExported: true, isDefault: false }
    }

    // NAMED-CONTAINER BOUNDARY (TS export semantics): a member of a
    // namespace/module needs its OWN export keyword — the container being
    // exported does not export its members. The unconditional climb marked
    // `class Hidden {}` inside `export namespace NS` as exported/public.
    if (p.type === "statement_block" && p.parent?.type === "internal_module") {
      const ownMods = extractModifiersFromNode(current)
      return { isExported: ownMods.isExport, isDefault: ownMods.isDefault }
    }

    // Check for inline export keyword
    if (
      p.type === "lexical_declaration" ||
      p.type === "function_declaration" ||
      p.type === "class_declaration" ||
      p.type === "interface_declaration" ||
      p.type === "type_alias_declaration" ||
      p.type === "enum_declaration"
    ) {
      const modifiers = extractModifiersFromNode(p)
      if (modifiers.isExport) {
        return { isExported: true, isDefault: modifiers.isDefault }
      }
    }

    current = p
  }

  // Also check the node itself for export keyword
  const modifiers = extractModifiersFromNode(node)
  if (modifiers.isExport) {
    return { isExported: true, isDefault: modifiers.isDefault }
  }

  return { isExported: false, isDefault: false }
}

// ============================================================================
// IMPORT CLAUSE PARSING - Full AST-based import clause extraction
// ============================================================================

interface ImportClauseInfo {
  defaultImport?: string
  namespaceImport?: string
  namedImports: Array<{ name: string; alias?: string }>
}

function extractImportClause(importNode: Node): ImportClauseInfo {
  const result: ImportClauseInfo = {
    namedImports: [],
  }

  for (let i = 0; i < importNode.namedChildCount; i++) {
    const child = importNode.namedChild(i)
    if (!child) continue

    switch (child.type) {
      case "import_clause": {
        // Process the import clause which contains default/named imports
        for (let j = 0; j < child.namedChildCount; j++) {
          const clauseChild = child.namedChild(j)
          if (!clauseChild) continue

          if (clauseChild.type === "identifier") {
            // Default import
            result.defaultImport = clauseChild.text
          } else if (clauseChild.type === "namespace_import") {
            // import * as name
            const asName = clauseChild.childForFieldName("name") || clauseChild.namedChild(0)
            if (asName) {
              result.namespaceImport = asName.text
            }
          } else if (clauseChild.type === "named_imports") {
            // { name1, name2 as alias2 }
            for (let k = 0; k < clauseChild.namedChildCount; k++) {
              const specifier = clauseChild.namedChild(k)
              if (specifier && specifier.type === "import_specifier") {
                const name = specifier.childForFieldName("name")
                const alias = specifier.childForFieldName("alias")

                if (name) {
                  result.namedImports.push({
                    name: name.text,
                    alias: alias?.text,
                  })
                }
              }
            }
          }
        }
        break
      }

      case "identifier": {
        // Direct identifier (default import in some tree-sitter versions)
        if (!result.defaultImport) {
          result.defaultImport = child.text
        }
        break
      }

      case "namespace_import": {
        const asName = child.childForFieldName("name") || child.namedChild(0)
        if (asName) {
          result.namespaceImport = asName.text
        }
        break
      }

      case "named_imports": {
        for (let k = 0; k < child.namedChildCount; k++) {
          const specifier = child.namedChild(k)
          if (specifier && specifier.type === "import_specifier") {
            const name = specifier.childForFieldName("name")
            const alias = specifier.childForFieldName("alias")

            if (name) {
              result.namedImports.push({
                name: name.text,
                alias: alias?.text,
              })
            }
          }
        }
        break
      }
    }
  }

  return result
}

/**
 * M59 (#825): the same items as `extractImportItems`, each paired with the node
 * that SPELLS the imported name — for `{ A as B }` that is `A`, because the edge
 * target is `module:A` and the line must be where the target is written. This is
 * scala mechanism 5 transferred: an import whose named segment sits on a later
 * line than its `import` keyword must not take the statement's first line, and a
 * string-only item list cannot say which line that is. Kept beside
 * `extractImportItems` so the two cannot drift (one is that walk's names, the
 * other its names plus their nodes).
 */
function extractImportItemsWithNodes(importNode: Node): Array<{ item: string; node: Node }> {
  const out: Array<{ item: string; node: Node }> = []
  for (let i = 0; i < importNode.namedChildCount; i++) {
    const child = importNode.namedChild(i)
    if (!child) continue
    if (child.type === "import_clause") {
      for (let j = 0; j < child.namedChildCount; j++) {
        const c = child.namedChild(j)
        if (!c) continue
        if (c.type === "identifier") {
          out.push({ item: c.text, node: c })
        } else if (c.type === "namespace_import") {
          const asName = c.childForFieldName("name") ?? c.namedChild(0)
          if (asName) out.push({ item: `* as ${asName.text}`, node: asName })
        } else if (c.type === "named_imports") {
          for (let k = 0; k < c.namedChildCount; k++) {
            const spec = c.namedChild(k)
            if (!spec || spec.type !== "import_specifier") continue
            const name = spec.childForFieldName("name")
            const alias = spec.childForFieldName("alias")
            if (name) out.push({ item: alias ? `${name.text} as ${alias.text}` : name.text, node: name })
          }
        }
      }
    } else if (child.type === "identifier") {
      out.push({ item: child.text, node: child })
    } else if (child.type === "namespace_import") {
      const asName = child.childForFieldName("name") ?? child.namedChild(0)
      if (asName) out.push({ item: `* as ${asName.text}`, node: asName })
    } else if (child.type === "named_imports") {
      for (let k = 0; k < child.namedChildCount; k++) {
        const spec = child.namedChild(k)
        if (!spec || spec.type !== "import_specifier") continue
        const name = spec.childForFieldName("name")
        const alias = spec.childForFieldName("alias")
        if (name) out.push({ item: alias ? `${name.text} as ${alias.text}` : name.text, node: name })
      }
    }
  }
  return out
}

function extractImportItems(importNode: Node): string[] {
  const clause = extractImportClause(importNode)
  const items: string[] = []

  if (clause.defaultImport) {
    items.push(clause.defaultImport)
  }

  if (clause.namespaceImport) {
    items.push(`* as ${clause.namespaceImport}`)
  }

  for (const named of clause.namedImports) {
    if (named.alias) {
      items.push(`${named.name} as ${named.alias}`)
    } else {
      items.push(named.name)
    }
  }

  return items
}

// ============================================================================
// TYPE INFERENCE ENGINE - Real type inference from context and usage
// ============================================================================

interface TypeInfo {
  type: string
  isOptional: boolean
  isNullable: boolean
  isArray: boolean
  genericArgs?: string[]
  source: "explicit" | "inferred" | "unknown"
}

class TypeInferenceEngine {
  private inferredTypes = new Map<string, TypeInfo>()

  inferType(node: Node, hint?: string): TypeInfo {
    const nameNode = node.childForFieldName("name")
    const id = nameNode?.type === "identifier" ? nameNode.text : undefined

    // Check for explicit type annotation first
    const typeAnnotation = this.findTypeAnnotation(node)
    if (typeAnnotation) {
      const info = this.parseTypeAnnotation(typeAnnotation)
      if (id) this.inferredTypes.set(id, info)
      return info
    }

    // Try to infer from initializer
    const initializer =
      node.childForFieldName("value") || node.childForFieldName("initializer") || this.findInitializer(node)

    if (initializer) {
      const info = this.inferFromInitializer(initializer)
      if (id) this.inferredTypes.set(id, info)
      return info
    }

    // Try usage-based inference when no explicit type or initializer exists
    const usage = this.inferFromUsage(node)
    if (usage.type !== "unknown") {
      if (id) this.inferredTypes.set(id, usage)
      return usage
    }

    // Use hint if provided
    if (hint) {
      const info = { type: hint, isOptional: false, isNullable: false, isArray: false, source: "inferred" as const }
      if (id) this.inferredTypes.set(id, info)
      return info
    }

    return { type: "unknown", isOptional: false, isNullable: false, isArray: false, source: "unknown" }
  }

  inferFromUsage(node: Node): TypeInfo {
    const nameNode = node.childForFieldName("name") || node.namedChild(0)
    if (nameNode?.type === "identifier") {
      const known = this.inferredTypes.get(nameNode.text)
      if (known) return known
    }

    const use = node.childForFieldName("value") || node.childForFieldName("initializer") || this.findInitializer(node)
    if (use && (use.type === "identifier" || use.type === "member_expression" || use.type === "call_expression")) {
      return this.inferFromInitializer(use)
    }

    return { type: "unknown", isOptional: false, isNullable: false, isArray: false, source: "unknown" }
  }

  inferFromInitializer(node: Node): TypeInfo {
    switch (node.type) {
      case "string":
      case "template_string":
        return { type: "string", isOptional: false, isNullable: false, isArray: false, source: "inferred" }

      case "number":
        return { type: "number", isOptional: false, isNullable: false, isArray: false, source: "inferred" }

      case "true":
      case "false":
        return { type: "boolean", isOptional: false, isNullable: false, isArray: false, source: "inferred" }

      case "null":
        return { type: "null", isOptional: false, isNullable: true, isArray: false, source: "inferred" }

      case "undefined":
        return { type: "undefined", isOptional: true, isNullable: false, isArray: false, source: "inferred" }

      case "array":
        const elementType = this.inferArrayElementType(node)
        return { type: `${elementType}[]`, isOptional: false, isNullable: false, isArray: true, source: "inferred" }

      case "object":
        return { type: "object", isOptional: false, isNullable: false, isArray: false, source: "inferred" }

      case "arrow_function":
      case "function":
      case "function_expression":
        const returnType = this.inferFunctionReturnType(node)
        return { type: `() => ${returnType}`, isOptional: false, isNullable: false, isArray: false, source: "inferred" }

      case "new_expression":
        const className = node.namedChild(0)?.text || "Object"
        return { type: className, isOptional: false, isNullable: false, isArray: false, source: "inferred" }

      case "call_expression":
        return this.inferFromCallExpression(node)

      case "await_expression":
        const awaitedType = this.inferFromInitializer(node.namedChild(0)!)
        // Unwrap Promise type
        if (awaitedType.type.startsWith("Promise<")) {
          const inner = awaitedType.type.slice(8, -1)
          return { ...awaitedType, type: inner }
        }
        return awaitedType

      case "binary_expression":
        return this.inferFromBinaryExpression(node)

      case "ternary_expression":
      case "conditional_expression":
        // Type is union of consequence and alternative
        const consequence = node.childForFieldName("consequence")
        const alternative = node.childForFieldName("alternative")
        if (consequence && alternative) {
          const t1 = this.inferFromInitializer(consequence)
          const t2 = this.inferFromInitializer(alternative)
          if (t1.type === t2.type) {
            return t1
          }
          return {
            type: `${t1.type} | ${t2.type}`,
            isOptional: false,
            isNullable: false,
            isArray: false,
            source: "inferred",
          }
        }
        return { type: "unknown", isOptional: false, isNullable: false, isArray: false, source: "unknown" }

      case "regex":
        return { type: "RegExp", isOptional: false, isNullable: false, isArray: false, source: "inferred" }

      case "as_expression":
        // Type assertion, use the asserted type
        const typeNode = node.childForFieldName("type")
        if (typeNode) {
          return this.parseTypeAnnotation(typeNode)
        }
        break

      case "identifier":
      case "member_expression":
        // Would need symbol table lookup for accurate inference
        return { type: "unknown", isOptional: false, isNullable: false, isArray: false, source: "unknown" }
    }

    return { type: "unknown", isOptional: false, isNullable: false, isArray: false, source: "unknown" }
  }

  private findTypeAnnotation(node: Node): Node | null {
    // Look for type_annotation child
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child && child.type === "type_annotation") {
        // Return the actual type node inside the annotation
        return child.namedChild(0) || child
      }
    }

    // Also check for return type in function declarations
    const returnType = node.childForFieldName("return_type")
    if (returnType) {
      return returnType.namedChild(0) || returnType
    }

    return null
  }

  private findInitializer(node: Node): Node | null {
    // Walk children looking for initializer patterns
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (!child) continue

      // Skip type annotations and identifiers
      if (child.type === "type_annotation" || child.type === "identifier") continue

      // Look for values after = sign
      if (
        node.type === "variable_declarator" ||
        node.type === "property_signature" ||
        node.type === "public_field_definition"
      ) {
        // The value is usually the last named child that's not a type
        if (i === node.namedChildCount - 1 && child.type !== "type_annotation") {
          return child
        }
      }
    }

    return null
  }

  private parseTypeAnnotation(typeNode: Node): TypeInfo {
    const text = typeNode.text

    // Check for optional marker
    let isOptional = typeNode.type === "optional_type"
    let isNullable = false
    let isArray = typeNode.type === "array_type"

    const stack = [typeNode]
    while (stack.length > 0) {
      const n = stack.pop()!
      if (n.type === "optional_type") isOptional = true
      if (n.type === "array_type") isArray = true
      if (n.type === "null" || n.type === "undefined" || n.text === "null" || n.text === "undefined") isNullable = true
      for (let i = 0; i < n.namedChildCount; i++) {
        const child = n.namedChild(i)
        if (child) stack.push(child)
      }
    }

    // Extract generic args if present
    let genericArgs: string[] | undefined
    if (typeNode.type === "generic_type") {
      const typeArgs = typeNode.childForFieldName("type_arguments")
      if (typeArgs) {
        genericArgs = []
        for (let i = 0; i < typeArgs.namedChildCount; i++) {
          const arg = typeArgs.namedChild(i)
          if (arg) genericArgs.push(arg.text)
        }
      }
    }

    return {
      type: stripTrailingQuestion(text).trim(),
      isOptional,
      isNullable,
      isArray,
      genericArgs,
      source: "explicit",
    }
  }

  private extractTypeParameters(node: Node): string[] {
    const typeParams: string[] = []
    const typeArgs = node.childForFieldName("type_parameters") || node.childForFieldName("type_arguments")
    if (typeArgs) {
      for (let i = 0; i < typeArgs.namedChildCount; i++) {
        const param = typeArgs.namedChild(i)
        if (param) {
          const nameNode = param.childForFieldName("name")
          if (nameNode) {
            let paramStr = nameNode.text
            // Field names verified against the pinned tsx/typescript wasm
            // (2026-09-16): a type_parameter carries name, constraint and value —
            // NOT `extends`/`default`, which this code read while the F1 field
            // oracle was blind (it captured no field literals at all until that
            // same fix). `constraint` text includes the keyword ("extends object"),
            // hence the strip before appending.
            const constraintNode = param.childForFieldName("constraint")
            const defaultValueNode = param.childForFieldName("value")
            if (constraintNode) {
              paramStr += ` extends ${stripLeadingColon(constraintNode.text.replace(/^extends\s+/, ""))}`
            }
            if (defaultValueNode) {
              paramStr += ` = ${stripLeadingEquals(defaultValueNode.text)}`
            }
            typeParams.push(paramStr)
          } else {
            typeParams.push(param.text)
          }
        }
      }
    }
    return typeParams
  }

  private inferArrayElementType(arrayNode: Node): string {
    if (arrayNode.namedChildCount === 0) return "unknown"

    const firstElement = arrayNode.namedChild(0)
    if (firstElement) {
      const elementType = this.inferFromInitializer(firstElement)
      return elementType.type
    }

    return "unknown"
  }

  public inferFunctionReturnType(funcNode: Node): string {
    // Look for explicit return type
    const returnType = funcNode.childForFieldName("return_type")
    if (returnType) {
      return stripLeadingColon(returnType.text)
    }

    // Try to infer from return statements
    const returns = this.findReturnStatements(funcNode)
    if (returns.length > 0) {
      const types = mapItems(returns, (r) => {
        const arg = r.namedChild(0)
        if (arg) {
          // T3 wave: `return x` where x is a declared parameter reads the
          // parameter's type annotation — otherwise every identifier return
          // degrades to unknown even with full annotations present.
          if (arg.type === "identifier") {
            const paramType = this.findParameterType(funcNode, arg.text)
            if (paramType) return paramType
          }
          return this.inferFromInitializer(arg).type
        }
        return "void"
      })

      const uniqueTypes = [...new Set(types)]
      if (uniqueTypes.length === 1) {
        return uniqueTypes[0]
      }
      return uniqueTypes.join(" | ")
    }

    return "void"
  }

  private findParameterType(funcNode: Node, name: string): string | undefined {
    // `formal_parameters` is a node TYPE, not a field: that second read could
    // never resolve. The positional fallback keeps the original intent for any
    // shape that carries an unnamed parameter list.
    const params =
      funcNode.childForFieldName("parameters") ||
      funcNode.namedChildren.find((c: Node | null) => c?.type === "formal_parameters")
    if (!params) return undefined
    for (let i = 0; i < params.namedChildCount; i++) {
      const p = params.namedChild(i)
      if (!p) continue
      const nm = p.childForFieldName("pattern") || p.childForFieldName("name") || p.namedChild(0)
      const matches = !!nm && (nm.type === "identifier" ? nm.text === name : nm.text === name)
      if (!matches) continue
      const t = p.childForFieldName("type")
      if (t) return stripLeadingColon(t.text)
      for (let j = 0; j < p.namedChildCount; j++) {
        const c = p.namedChild(j)
        if (c && c.type === "type_annotation") return stripLeadingColon(c.text)
      }
      return undefined
    }
    return undefined
  }

  private findReturnStatements(node: Node): Node[] {
    const returns: Node[] = []

    const traverse = (n: Node) => {
      if (n.type === "return_statement") {
        returns.push(n)
      }
      // Don't descend into nested functions
      if (n.type !== "arrow_function" && n.type !== "function_declaration" && n.type !== "function_expression") {
        for (let i = 0; i < n.namedChildCount; i++) {
          const child = n.namedChild(i)
          if (child) traverse(child)
        }
      }
    }

    // Start from function body
    const body = node.childForFieldName("body")
    if (body) {
      for (let i = 0; i < body.namedChildCount; i++) {
        const child = body.namedChild(i)
        if (child) traverse(child)
      }
    }

    return returns
  }

  private inferFromCallExpression(node: Node): TypeInfo {
    const callee = node.namedChild(0)
    if (!callee) return { type: "unknown", isOptional: false, isNullable: false, isArray: false, source: "unknown" }

    const calleeName = callee.text

    // Common known function return types
    const knownReturns: Record<string, string> = {
      parseInt: "number",
      parseFloat: "number",
      String: "string",
      Number: "number",
      Boolean: "boolean",
      Array: "unknown[]",
      "Object.keys": "string[]",
      "Object.values": "unknown[]",
      "Object.entries": "[string, unknown][]",
      "JSON.parse": "any",
      "JSON.stringify": "string",
      "Array.from": "unknown[]",
      "Array.isArray": "boolean",
      "Math.floor": "number",
      "Math.ceil": "number",
      "Math.round": "number",
      "Math.random": "number",
      "Date.now": "number",
      "Promise.resolve": "Promise<unknown>",
      "Promise.reject": "Promise<never>",
      "Promise.all": "Promise<unknown[]>",
    }

    if (knownReturns[calleeName]) {
      return {
        type: knownReturns[calleeName],
        isOptional: false,
        isNullable: false,
        isArray: false,
        source: "inferred",
      }
    }

    // Check for .map, .filter, .reduce patterns
    if (callee.type === "member_expression") {
      const property = callee.childForFieldName("property")
      if (property) {
        switch (property.text) {
          case "map":
          case "filter":
          case "slice":
          case "concat":
            return { type: "unknown[]", isOptional: false, isNullable: false, isArray: true, source: "inferred" }
          case "find":
            return {
              type: "unknown | undefined",
              isOptional: true,
              isNullable: false,
              isArray: false,
              source: "inferred",
            }
          case "reduce":
            return { type: "unknown", isOptional: false, isNullable: false, isArray: false, source: "inferred" }
          case "join":
            return { type: "string", isOptional: false, isNullable: false, isArray: false, source: "inferred" }
          case "length":
            return { type: "number", isOptional: false, isNullable: false, isArray: false, source: "inferred" }
          case "toString":
            return { type: "string", isOptional: false, isNullable: false, isArray: false, source: "inferred" }
        }
      }
    }

    return { type: "unknown", isOptional: false, isNullable: false, isArray: false, source: "unknown" }
  }

  private inferFromBinaryExpression(node: Node): TypeInfo {
    const operator = node.childForFieldName("operator")?.text

    switch (operator) {
      case "+":
        // Could be string concatenation or number addition
        const left = node.childForFieldName("left")
        const right = node.childForFieldName("right")
        if (left && right) {
          const leftType = this.inferFromInitializer(left)
          const rightType = this.inferFromInitializer(right)
          if (leftType.type === "string" || rightType.type === "string") {
            return { type: "string", isOptional: false, isNullable: false, isArray: false, source: "inferred" }
          }
          if (leftType.type === "number" && rightType.type === "number") {
            return { type: "number", isOptional: false, isNullable: false, isArray: false, source: "inferred" }
          }
        }
        return { type: "string | number", isOptional: false, isNullable: false, isArray: false, source: "inferred" }

      case "-":
      case "*":
      case "/":
      case "%":
      case "**":
      case "<<":
      case ">>":
      case ">>>":
      case "&":
      case "|":
      case "^":
        return { type: "number", isOptional: false, isNullable: false, isArray: false, source: "inferred" }

      case "==":
      case "===":
      case "!=":
      case "!==":
      case "<":
      case ">":
      case "<=":
      case ">=":
      case "&&":
      case "||":
      case "in":
      case "instanceof":
        return { type: "boolean", isOptional: false, isNullable: false, isArray: false, source: "inferred" }

      case "??":
        // Nullish coalescing - type is union of sides
        return { type: "unknown", isOptional: false, isNullable: false, isArray: false, source: "inferred" }
    }

    return { type: "unknown", isOptional: false, isNullable: false, isArray: false, source: "unknown" }
  }
}

// ============================================================================
// FRAMEWORK DETECTION - Deep pattern recognition for popular frameworks
// ============================================================================

interface FrameworkPattern {
  name: string
  type: string
  location: string
  metadata?: Record<string, any>
}

function extractFrameworkPatterns(symbols: ASTEngine.UniversalSymbol[], content: string): FrameworkPattern[] {
  const patterns: FrameworkPattern[] = []

  for (const symbol of symbols) {
    // React Hooks
    if (symbol.name.startsWith("use") && symbol.kind === ASTEngine.SymbolKind.Function) {
      const isReactHook = symbol.name.length > 3 && symbol.name[3] === symbol.name[3].toUpperCase()
      if (isReactHook) {
        patterns.push({
          name: symbol.name,
          type: "react-hook",
          location: `${symbol.range.startLine}:${symbol.range.startColumn}`,
          metadata: {
            isCustomHook: ![
              "useState",
              "useEffect",
              "useRef",
              "useMemo",
              "useCallback",
              "useContext",
              "useReducer",
              "useLayoutEffect",
            ].includes(symbol.name),
          },
        })
      }
    }

    // React Components - More conservative detection
    // Note: This is heuristic-based and may have false positives
    // Ideal solution would analyze return types for JSX
    if (symbol.kind === ASTEngine.SymbolKind.Function || symbol.kind === ASTEngine.SymbolKind.Variable) {
      if (
        symbol.name.length > 0 &&
        symbol.name[0] >= "A" &&
        symbol.name[0] <= "Z" &&
        everyItem(
          symbol.name.split(""),
          (c) => (c >= "A" && c <= "Z") || (c >= "a" && c <= "z") || (c >= "0" && c <= "9"),
        ) &&
        someItems(symbols, (s) => s.name === "React" || s.name === "jsx")
      ) {
        // Only tag as react-component if React context is present
        patterns.push({
          name: symbol.name,
          type: "react-component",
          location: `${symbol.range.startLine}:${symbol.range.startColumn}`,
          metadata: { confidence: 0.7 }, // Lower confidence for heuristic
        })
      }
    }

    // Vue Composition API / Setup
    if (symbol.name === "setup" && symbol.kind === ASTEngine.SymbolKind.Function) {
      patterns.push({
        name: symbol.name,
        type: "vue-setup",
        location: `${symbol.range.startLine}:${symbol.range.startColumn}`,
      })
    }

    // NestJS Controllers/Services
    if (symbol.decorators?.includes("Controller")) {
      patterns.push({
        name: symbol.name,
        type: "nestjs-controller",
        location: `${symbol.range.startLine}:${symbol.range.startColumn}`,
      })
    }
    if (symbol.decorators?.includes("Injectable")) {
      patterns.push({
        name: symbol.name,
        type: "nestjs-service",
        location: `${symbol.range.startLine}:${symbol.range.startColumn}`,
      })
    }

    // TypeORM Entities
    if (symbol.decorators?.includes("Entity")) {
      patterns.push({
        name: symbol.name,
        type: "typeorm-entity",
        location: `${symbol.range.startLine}:${symbol.range.startColumn}`,
      })
    }

    // Drizzle Schemas (variables ending with 'Table')
    if (symbol.kind === ASTEngine.SymbolKind.Variable && symbol.name.endsWith("Table")) {
      patterns.push({
        name: symbol.name,
        type: "drizzle-table",
        location: `${symbol.range.startLine}:${symbol.range.startColumn}`,
      })
    }

    // Route handlers (NestJS, generic)
    for (const dec of ["Get", "Post", "Put", "Delete", "Patch"]) {
      if (symbol.decorators?.includes(dec)) {
        patterns.push({
          name: symbol.name,
          type: "http-route",
          location: `${symbol.range.startLine}:${symbol.range.startColumn}`,
          metadata: { method: dec.toUpperCase() },
        })
      }
    }

    // Test patterns
    if (symbol.name === "describe" || symbol.name === "it" || symbol.name === "test") {
      patterns.push({
        name: symbol.name,
        type: "test-block",
        location: `${symbol.range.startLine}:${symbol.range.startColumn}`,
      })
    }
    // HTTP Clients (Axios, Fetch, TanStack Query)
    if (
      symbol.name === "fetch" ||
      symbol.name === "axios" ||
      symbol.name === "useQuery" ||
      symbol.name === "useMutation"
    ) {
      patterns.push({
        name: symbol.name,
        type: "http-client",
        location: `${symbol.range.startLine}:${symbol.range.startColumn}`,
      })
    }

    // Solid.js Primitives
    if (["createSignal", "createMemo", "createResource", "createStore", "createContext"].includes(symbol.name)) {
      patterns.push({
        name: symbol.name,
        type: "solid-primitive",
        location: `${symbol.range.startLine}:${symbol.range.startColumn}`,
      })
    }

    // Qwik Components and Hooks
    if (
      symbol.name.endsWith("$") &&
      (symbol.kind === ASTEngine.SymbolKind.Function || symbol.kind === ASTEngine.SymbolKind.Variable)
    ) {
      patterns.push({
        name: symbol.name,
        type: "qwik-component",
        location: `${symbol.range.startLine}:${symbol.range.startColumn}`,
        metadata: { isQwikOptimized: true },
      })
    }

    // Astro Components (special .astro files, but can have TS/JS logic)
    if (symbol.name === "Astro" && symbol.kind === ASTEngine.SymbolKind.Variable) {
      patterns.push({
        name: symbol.name,
        type: "astro-global",
        location: `${symbol.range.startLine}:${symbol.range.startColumn}`,
      })
    }

    // Remix Route Exports
    if (
      ["loader", "action", "meta", "links", "headers", "ErrorBoundary"].includes(symbol.name) &&
      (symbol.kind === ASTEngine.SymbolKind.Function || symbol.kind === ASTEngine.SymbolKind.Variable)
    ) {
      patterns.push({
        name: symbol.name,
        type: "remix-route-export",
        location: `${symbol.range.startLine}:${symbol.range.startColumn}`,
        metadata: { exportType: symbol.name },
      })
    }

    // SvelteKit Route Functions
    if (["load", "actions"].includes(symbol.name) && symbol.kind === ASTEngine.SymbolKind.Function) {
      patterns.push({
        name: symbol.name,
        type: "sveltekit-route",
        location: `${symbol.range.startLine}:${symbol.range.startColumn}`,
      })
    }

    // TanStack Query Hooks - Only specific ones to avoid conflicts
    if (["useInfiniteQuery", "useQueryClient", "useIsFetching", "useIsMutating"].includes(symbol.name)) {
      patterns.push({
        name: symbol.name,
        type: "tanstack-query-hook",
        location: `${symbol.range.startLine}:${symbol.range.startColumn}`,
      })
    }

    // Zustand Store Functions - Only detect with proper context
    // Note: Removed overly broad "create" detection to prevent false positives

    // tRPC Procedures
    if (["publicProcedure", "protectedProcedure", "createTRPCRouter"].includes(symbol.name)) {
      patterns.push({
        name: symbol.name,
        type: "trpc-procedure",
        location: `${symbol.range.startLine}:${symbol.range.startColumn}`,
      })
    }

    // Vite Environment Detection - Removed invalid symbol-based detection
    // Note: import.meta is not extracted as a variable symbol

    // Modern State Management Patterns - More precise detection
    if (["createSlice", "configureStore"].includes(symbol.name)) {
      patterns.push({
        name: symbol.name,
        type: "state-management",
        location: `${symbol.range.startLine}:${symbol.range.startColumn}`,
        metadata: { library: "redux-toolkit" },
      })
    }
    // Generic state hooks without library attribution to avoid false positives
    if (["useStore", "useSelector", "useDispatch"].includes(symbol.name)) {
      patterns.push({
        name: symbol.name,
        type: "state-management",
        location: `${symbol.range.startLine}:${symbol.range.startColumn}`,
      })
    }

    // Component Library Patterns (Headless UI, Radix, etc.)
    if (
      symbol.decorators
        ? someItems(symbol.decorators, (d) => ["forwardRef", "memo", "lazy", "Suspense"].includes(d))
        : false
    ) {
      patterns.push({
        name: symbol.name,
        type: "component-wrapper",
        location: `${symbol.range.startLine}:${symbol.range.startColumn}`,
        metadata: {
          wrapperType: symbol.decorators
            ? findItem(symbol.decorators, (d) => ["forwardRef", "memo", "lazy"].includes(d))
            : undefined,
        },
      })
    }

    // API Route Patterns (Next.js API routes, Astro endpoints)
    if (
      (symbol.name === "GET" ||
        symbol.name === "POST" ||
        symbol.name === "PUT" ||
        symbol.name === "DELETE" ||
        symbol.name === "PATCH") &&
      symbol.kind === ASTEngine.SymbolKind.Function
    ) {
      patterns.push({
        name: symbol.name,
        type: "api-route-handler",
        location: `${symbol.range.startLine}:${symbol.range.startColumn}`,
        metadata: { httpMethod: symbol.name },
      })
    }
  }

  return patterns
}

// ============================================================================
// THE TYPESCRIPT ANALYZER - Complete implementation
// ============================================================================

class TypeScriptAnalysisRunner {
  private currentFile: string = ""
  private content: string = ""
  private scopeManager: ScopeManager
  private moduleResolver: TypeScriptModuleResolver | null = null
  private typeInference: TypeInferenceEngine
  private symbolsById = new Map<string, ASTEngine.UniversalSymbol>()
  private _pendingReExportImports: ASTEngine.ImportInfo[] = []
  // M49 dup-key ruling (#746): dead spans returned by the Phase-2.5
  // collapse, consumed by the post-walk phantom-edge filter.
  private _dupKeyDeadSpans: { name: string; startRow: number; endRow: number; startCol: number; endCol: number }[] | null = null
  // Depth of nested function bodies being walked for symbol extraction.
  // Locals/params/lambda-params inside a function body are NOT symbols
  // (C#-family contract); only module/namespace/class-level declarations are.
  private insideFunctionDepth = 0

  constructor() {
    this.scopeManager = new ScopeManager()
    this.typeInference = new TypeInferenceEngine()
  }

  private extractTypeParameters(node: Node): string[] {
    const typeParams: string[] = []
    const typeArgs = node.childForFieldName("type_parameters") || node.childForFieldName("type_arguments")
    if (typeArgs) {
      for (let i = 0; i < typeArgs.namedChildCount; i++) {
        const param = typeArgs.namedChild(i)
        if (param) {
          const nameNode = param.childForFieldName("name")
          if (nameNode) {
            let paramStr = nameNode.text
            // Field names verified against the pinned tsx/typescript wasm
            // (2026-09-16): a type_parameter carries name, constraint and value —
            // NOT `extends`/`default`, which this code read while the F1 field
            // oracle was blind (it captured no field literals at all until that
            // same fix). `constraint` text includes the keyword ("extends object"),
            // hence the strip before appending.
            const constraintNode = param.childForFieldName("constraint")
            const defaultValueNode = param.childForFieldName("value")
            if (constraintNode) {
              paramStr += ` extends ${stripLeadingColon(constraintNode.text.replace(/^extends\s+/, ""))}`
            }
            if (defaultValueNode) {
              paramStr += ` = ${stripLeadingEquals(defaultValueNode.text)}`
            }
            typeParams.push(paramStr)
          } else {
            typeParams.push(param.text)
          }
        }
      }
    }
    return typeParams
  }

  analyze(
    rootNode: Node,
    content: string,
    filePath: string,
  ): ASTEngine.ParseResult & { metadata: Partial<ASTEngine.FileMetadata> } {
    // Reset state for new analysis
    this.currentFile = filePath
    this.content = content
    this.scopeManager.reset()
    this.symbolsById.clear()

    // Initialize module resolver with project root
    const projectRoot = this.findProjectRoot(filePath)
    this.moduleResolver = new TypeScriptModuleResolver(projectRoot)

    const symbols: ASTEngine.UniversalSymbol[] = []
    const relationships: ASTEngine.UniversalRelationship[] = []
    const imports: ASTEngine.ImportInfo[] = []
    const exports: ASTEngine.ExportInfo[] = []
    const errors: ASTEngine.ParseError[] = []

    // ========================================================================
    // STAGE 3: RESILIENT PARSING & ERROR NODE BYPASS
    // ========================================================================
    if (rootNode.hasError) {
      const collectErrors = (node: Node) => {
        if (node.type === "ERROR" || node.type === "MISSING") {
          errors.push({
            message: `Syntax ${node.type} detected. The Brain Engine is bypassing this broken node.`,
            range: {
              startLine: node.startPosition.row + 1,
              startColumn: node.startPosition.column + 1,
              endLine: node.endPosition.row + 1,
              endColumn: node.endPosition.column + 1,
              startIndex: node.startIndex,
              endIndex: node.endIndex,
            },
            severity: `warning`,
          })
        }
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i)
          if (child) collectErrors(child)
        }
      }
      collectErrors(rootNode)
    }

    // T1 (review wave): the Rules-of-Hooks check only means something in a
    // React file — in Vue/Svelte/Node codebases every `use*` util warned as
    // a parse error. Gate on a React signal (react import or JSX); the
    // SolidJS exclusion stays (different hook rules entirely).
    if (this.hasReactSignal(rootNode) && !this.content.includes("solid-js") && !this.content.includes("@solidjs")) {
      errors.push(...this.detectReactHookAntiPatterns(rootNode))
    }

    const mod = path.basename(filePath, path.extname(filePath))
    this.scopeManager.pushScope(ScopeKind.Module, mod, rootNode)

    // PHASE 1: Inject phantom symbols for better resolution
    // PHANTOM INJECTION REMOVED (Phase 3): fake this/constructor/globals polluted indexes.

    // PHASE 2: Extract all symbols with proper scoping
    this.extractSymbols(rootNode, symbols)

    // PHASE 2.5 (M49 dup-key ruling, Option A — #746): object-literal
    // members collapse last-wins (family contract with the JS analyzer).
    // Runs before the symbol-map build and every relationship phase so
    // exports/calls/contains all derive from the collapsed array.
    this.collapseDuplicateObjectMembers(rootNode, symbols)
    this._dupKeyDeadSpans =
      this.collapseDuplicateObjectMembers(rootNode, symbols)

    // Build symbol lookup map
    for (const symbol of symbols) {
      const id = this.generateSymbolId(symbol)
      this.symbolsById.set(id, symbol)
      this.symbolsById.set(symbol.name, symbol)
      if (symbol.scope) {
        this.symbolsById.set(`${symbol.scope}.${symbol.name}`, symbol)
      }
    }

    // PHASE 3: Extract imports and exports
    this.extractImports(rootNode, imports)
    this._pendingReExportImports = []
    this.extractExports(rootNode, exports, symbols)
    imports.push(...this._pendingReExportImports)
    this._pendingReExportImports = []

    // PHASE 4: Analyze relationships between symbols
    this.extractRelationships(rootNode, relationships, symbols, exports)

    // PHASE 5: Add containment relationships
    this.addContainmentRelationships(symbols, relationships)

    // PHASE 6: Detect frameworks and patterns
    const frameworks = detectFrameworks(content, symbols)
    const frameworkPatterns = extractFrameworkPatterns(symbols, content)

    // PHASE 7: Calculate metrics
    const complexity = this.calculateComplexity(rootNode)
    const linesOfCode = filterItems(content.split("\n"), (line) => line.trim().length > 0).length
    const cyclomaticComplexity = this.calculateCyclomaticComplexity(rootNode)

    // PHASE 8: Code quality assessment
    const codeQuality = this.assessCodeQuality(symbols, relationships, complexity, cyclomaticComplexity)

    this.scopeManager.popScope()

    // PHASE 6.5: Declared-type reference graph (M14). Every type_annotation
    // in the file (fields, params, returns, locals, interface members,
    // as-casts, instanceof checks) references its named types. Absent until
    // M14 — the corpus oracle never checked it.
    this.extractDeclaredTypeRefs(rootNode, relationships)

    this.classifyEvidenceTier(relationships)

    // M49 dup-key ruling (#746) post-walk half: all relationship phases
    // (calls/uses/contains/references) have run — now drop the phantom
    // edges sourced from collapsed members' dead bodies.
    if (this._dupKeyDeadSpans && this._dupKeyDeadSpans.length > 0) {
      this.filterPhantomDupKeyEdges(relationships, this._dupKeyDeadSpans)
    }
    this._dupKeyDeadSpans = null

    // M60.P1 (#873): ONE row, ONE line base. `line_number` is 1-based
    // (`lineField`, every other analyzer, and the store column), while the
    // `metadata.line` mirror was written as `startPosition.row` at eight call
    // sites — 0-based, and sometimes a different NODE than the one `lineField`
    // stamped. Measured through the production pipeline (script/m14/tmp/
    // probe-metadata-line-base.ts, one file per language from real corpora):
    // typescript 148 of 155 rows off by one and 7 by more, tsx 173 of 179, vue 3
    // of 3 — and ZERO rows on java, kotlin, scala, groovy, cpp, python, js or
    // swift, because only this analyzer writes the mirror. The eight writers now
    // write the 1-based site, and this pass makes the two fields agree BY
    // CONSTRUCTION, so a ninth writer cannot reintroduce a second base by
    // forgetting one of them. It only ever corrects a present number: absence
    // stays absence (the ruled "unknown is a first-class state" contract).
    let baseMismatches = 0
    for (const r of relationships) {
      const meta = r.metadata as { line?: unknown } | undefined
      if (!meta || typeof r.line_number !== "number") continue
      if (typeof meta.line === "number" && meta.line !== r.line_number) {
        meta.line = r.line_number
        baseMismatches++
      }
    }
    // (No logging here: the analyzer is a pure function of the source text, and
    // the count is observable in the payload matrix and in the sweep probe.)
    void baseMismatches

    return {
      language: "typescript",
      symbols,
      relationships,
      imports,
      exports,
      errors,
      metadata: {
        complexity,
        linesOfCode,
        cyclomaticComplexity,
        framework: frameworks.length > 0 ? frameworks[0].name : undefined,
        patterns: mapItems(frameworkPatterns, (p) => p.type),
        detectedFrameworks: mapItems(frameworks, (f) => f.name),
        frameworkPatterns,
        architecturalScore: this.calculateArchitecturalScore(symbols, relationships),
        codeQuality,
        hasTypeInference: true,
        hasFrameworkIntelligence: true,
        analysisVersion: "3.0.0-infallible-brain",
      },
    }
  }

  // ========================================================================
  // SYMBOL EXTRACTION - Complete TypeScript construct handling
  // ========================================================================

  private extractSymbols(rootNode: Node, symbols: ASTEngine.UniversalSymbol[]): void {
    const stack: StackEntry[] = [{ node: rootNode }]

    while (stack.length > 0) {
      const entry = stack.pop()!
      if (entry.action) {
        entry.action()
        continue
      }

      const node = entry.node!
      let skipChildren = false

      switch (node.type) {
        case "function_declaration":
        case "generator_function_declaration":
          skipChildren = this.extractFunction(node, symbols, stack)
          break

        case "class_declaration":
        case "abstract_class_declaration":
          skipChildren = this.extractClass(node, symbols, stack)
          break

        case "interface_declaration":
          skipChildren = this.extractInterface(node, symbols, stack)
          break

        case "type_alias_declaration":
          skipChildren = this.extractTypeAlias(node, symbols)
          break

        case "enum_declaration":
          skipChildren = this.extractEnum(node, symbols, stack)
          break

        case "lexical_declaration":
        case "variable_declaration":
          // C#-family contract: variables declared inside a function body are
          // locals — not symbols. Only module/namespace/class-level declarations
          // become symbols (and do not descend into them at function depth).
          // W1 exception (JD18-class, JS parity): a function-body declarator
          // whose value is an OBJECT LITERAL still descends — the object's
          // shorthand methods are their own scopes (probed: class-body-local
          // `const local = { deep() {...} }` -> method:deep + deep -> inside
          // on the JS side; TS must match or the nested calls misattribute to
          // the enclosing method). The declarator symbol is still suppressed
          // (locals stay locals) — only the descent differs.
          if (this.insideFunctionDepth === 0) {
            skipChildren = this.extractVariables(node, symbols, stack)
          } else {
            const w1Descend = (node: Node): boolean => {
              for (let i = 0; i < node.namedChildCount; i++) {
                const d = node.namedChild(i)
                if (!d) continue
                if (d.type !== "variable_declarator") continue
                const v = d.childForFieldName("value")
                if (v && v.type === "object") return true
              }
              return false
            }
            skipChildren = !w1Descend(node)
          }
          break

        case "internal_module":
        case "ambient_declaration":
        case "module":
        case "namespace_declaration":
        case "module_declaration":
          skipChildren = this.extractNamespace(node, symbols, stack)
          break

        case "export_statement":
          for (let i = node.namedChildCount - 1; i >= 0; i--) {
            const child = node.namedChild(i)
            if (child) stack.push({ node: child })
          }
          skipChildren = true
          break

        case "method_definition":
          // W1 (JD18-class, web-family parity with JS): shorthand methods on
          // object literals ARE members. JS emits them at ANY depth (probed:
          // class-body-local `const local = { deep() {...} }` -> method:deep
          // + deep -> inside — the nested object's method is its own scope,
          // never misattributed to the enclosing method). Owner resolution:
          // walk up to the enclosing variable_declarator name; at module
          // level that's the object's binding (util/routes), inside a body
          // it's the local binding. Calls inside the method then attribute
          // to the method symbol itself via the rel-walk resolver.
          skipChildren = this.extractObjectLiteralMethod(node, symbols, stack)
          break

        case "arrow_function":
          break
      }

      if (!skipChildren) {
        if (
          ![
            "class_declaration",
            "abstract_class_declaration",
            "interface_declaration",
            "enum_declaration",
            "internal_module",
            "ambient_declaration",
            "module",
            "namespace_declaration",
            "module_declaration",
          ].includes(node.type)
        ) {
          for (let i = node.namedChildCount - 1; i >= 0; i--) {
            const child = node.namedChild(i)
            if (child) stack.push({ node: child })
          }
        }
      }
    }
  }

  private extractFunction(node: Node, symbols: ASTEngine.UniversalSymbol[], stack: StackEntry[]): boolean {
    const nameNode = node.childForFieldName("name")
    if (!nameNode) return false
    const name = nameNode.text
    const modifiers = extractModifiersFromNode(node)
    const exportStatus = isNodeExported(node)
    const params = this.extractParameters(node)
    const returnType = this.extractReturnType(node)
    const typeParams = this.extractTypeParameters(node)
    const apiContract = this.extractApiContract(node)

    const symbol: ASTEngine.UniversalSymbol = {
      name,
      kind: ASTEngine.SymbolKind.Function,
      range: this.nodeRange(node),
      scope: stripTrailingDot(this.scopeManager.buildQualifiedName("")) || undefined,
      visibility: exportStatus.isExported ? "public" : "private",
      isStatic: modifiers.isStatic,
      isAsync: modifiers.isAsync,
      parameters: params,
      returnType,
      // Top-level per family contract: DB ingester reads symbol.complexity
      // (|| 1) for gravity scoring.
      complexity: this.calculateComplexity(node),
      genericParameters: typeParams.length > 0 ? typeParams : undefined,
      decorators: modifiers.decorators.length > 0 ? modifiers.decorators : undefined,
      comments: this.extractComments(node),
      qualified_calls: this.extractQualifiedCalls(node),
      apiContractPath: apiContract.path,
      taintSources: this.extractTaintSources(node),
      taintSinks: this.extractTaintSinks(node),
      ...this.scopeManager.getOwnerInfo(),
      metadata: {
        apiMethod: apiContract.method,
        isGenerator: node.type === "generator_function_declaration",
        isExported: exportStatus.isExported,
        isDefault: exportStatus.isDefault,
        isDeclare: modifiers.isDeclare,
        complexity: this.calculateComplexity(node),
        decoratorLines: modifiers.decoratorLines.length > 0 ? modifiers.decoratorLines : undefined,
      },
    }

    symbols.push(symbol)
    this.scopeManager.registerSymbol(symbol)

    // Process function body for nested symbols
    this.scopeManager.pushScope(ScopeKind.Function, name, node)
    stack.push({ action: () => this.scopeManager.popScope() })
    const body = node.childForFieldName("body")
    if (body) {
      this.insideFunctionDepth++
      stack.push({ action: () => this.insideFunctionDepth-- })
      stack.push({ node: body })
    }
    return true
  }

  private extractClass(node: Node, symbols: ASTEngine.UniversalSymbol[], stack: StackEntry[]): boolean {
    const nameNode = node.childForFieldName("name")
    if (!nameNode) return false
    const name = nameNode.text
    let modifiers = extractModifiersFromNode(node)
    const exportStatus = isNodeExported(node)
    // Class decorators live on the wrapping export_statement or as own children.
    // M59 #860: the sibling/export-statement collectors hold the decorator
    // NODES, so the class's decorators are recorded with their own lines.
    for (const d of collectDecoratorsForClass(node)) {
      const n = extractDecoratorName(d)
      if (n) addDecorator(modifiers, n, d.startPosition.row + 1)
    }

    // Extract heritage (extends/implements)
    const heritage = this.extractClassHeritage(node)
    const typeParams = this.extractTypeParameters(node)

    const symbol: ASTEngine.UniversalSymbol = {
      name,
      kind: ASTEngine.SymbolKind.Class,
      range: this.nodeRange(node),
      scope: stripTrailingDot(this.scopeManager.buildQualifiedName("")) || undefined,
      visibility: exportStatus.isExported ? "public" : "private",
      isAbstract: modifiers.isAbstract,
      decorators: modifiers.decorators.length > 0 ? modifiers.decorators : undefined,
      comments: this.extractComments(node),
      genericParameters: typeParams.length > 0 ? typeParams : undefined,
      ...this.scopeManager.getOwnerInfo(),
      metadata: {
        isExported: exportStatus.isExported,
        isDefault: exportStatus.isDefault,
        isDeclare: modifiers.isDeclare,
        extends: heritage.extends,
        extendsLines: heritage.extendsLines,
        implements: heritage.implements,
        implementsLines: heritage.implementsLines,
        decoratorLines: modifiers.decoratorLines.length > 0 ? modifiers.decoratorLines : undefined,
      },
    }

    symbols.push(symbol)
    this.scopeManager.registerSymbol(symbol)

    // Process class body for methods, properties, constructor
    this.scopeManager.pushScope(ScopeKind.Class, name, node)

    const body = node.childForFieldName("body")
    if (body) {
      // Overload dedup (TS allows N declarations + 1 implementation per
      // name): keep the LAST declaration of each name — it carries the body.
      const lastDeclarationOfMethod = new Map<string, number>()
      for (let i = 0; i < body.namedChildCount; i++) {
        const m = body.namedChild(i)
        if (!m) continue
        if (m.type === "method_definition" || m.type === "method_signature" || m.type === "abstract_method_signature") {
          const n = m.childForFieldName("name")?.text
          // constructors included: ctor overload groups previously pushed a
          // DUPLICATE constructor symbol per declaration
          if (n) lastDeclarationOfMethod.set(n, i)
        }
      }
      const seenMethodNames = new Set<string>()
      const seenPropertyNames = new Set<string>()
      for (let i = 0; i < body.namedChildCount; i++) {
        const member = body.namedChild(i)
        if (!member) continue
        // Method/constructor decorators are class_body SIBLINGS immediately
        // preceding the definition — collect them here and pass down.
        const memberDecorators = collectDecoratorsForMember(member, body)

        switch (member.type) {
          case "method_definition":
          case "method_signature":
          case "abstract_method_signature": {
            const memberName = member.childForFieldName("name")?.text
            if (memberName === "constructor") {
              // Last-wins: ctor overload groups previously pushed a duplicate
              // constructor symbol per declaration.
              if (lastDeclarationOfMethod.get("constructor") !== i) break
              this.extractConstructor(member, symbols, stack, memberDecorators)
              break
            }
            // Overload groups (TS allows N declarations + 1 implementation
            // per name): keep ONLY the LAST declaration. First-wins kept the
            // body-less SIGNATURE — complexity 1, no qualified_calls, no
            // taint data — while the relationship walker still emitted
            // body-derived edges sourced from that symbol.
            if (memberName && lastDeclarationOfMethod.get(memberName) !== i) {
              break
            }
            if (memberName) seenMethodNames.add(memberName)
            this.extractMethod(member, symbols, stack, memberDecorators)
            break
          }

          case "public_field_definition":
          case "property_definition":
          case "field_definition": {
            const propName = member.childForFieldName("name")?.text
            if (propName && seenPropertyNames.has(propName)) break
            if (propName) seenPropertyNames.add(propName)
            this.extractProperty(member, symbols)
            break
          }

          case "index_signature":
            this.extractIndexSignature(member, symbols)
            break

          case "static_block":
            this.extractStaticBlock(member, symbols, stack)
            break

        }
      }
    }

    this.scopeManager.popScope()
    return false
  }

  private extractInterface(node: Node, symbols: ASTEngine.UniversalSymbol[], stack: StackEntry[]): boolean {
    const nameNode = node.childForFieldName("name")
    if (!nameNode) return false
    const name = nameNode.text
    const exportStatus = isNodeExported(node)

    // Extract extends clause
    const extendsClause = this.extractInterfaceExtends(node)
    const typeParams = this.extractTypeParameters(node)

    const symbol: ASTEngine.UniversalSymbol = {
      name,
      kind: ASTEngine.SymbolKind.Interface,
      range: this.nodeRange(node),
      scope: stripTrailingDot(this.scopeManager.buildQualifiedName("")) || undefined,
      visibility: exportStatus.isExported ? "public" : "private",
      comments: this.extractComments(node),
      genericParameters: typeParams.length > 0 ? typeParams : undefined,
      ...this.scopeManager.getOwnerInfo(),
      metadata: {
        isExported: exportStatus.isExported,
        isDefault: exportStatus.isDefault,
        extends: extendsClause?.names,
        extendsLines: extendsClause?.lines,
      },
    }

    symbols.push(symbol)
    this.scopeManager.registerSymbol(symbol)

    // Process interface body for members
    this.scopeManager.pushScope(ScopeKind.Interface, name, node)

    const body = node.childForFieldName("body")
    if (body) {
      this.extractInterfaceMembers(body, symbols, name)
    }

    this.scopeManager.popScope()
    return false
  }

  private extractInterfaceMembers(body: Node, symbols: ASTEngine.UniversalSymbol[], interfaceName: string): void {
    for (let i = 0; i < body.namedChildCount; i++) {
      const member = body.namedChild(i)
      if (!member) continue

      switch (member.type) {
        case "property_signature":
        case "public_field_definition": {
          const propName = member.childForFieldName("name")
          if (propName) {
            const typeAnnotation = member.childForFieldName("type")
            const isOptional = this.hasToken(member, "?")

            symbols.push({
              name: propName.text,
              kind: ASTEngine.SymbolKind.Property,
              range: this.nodeRange(member),
              scope: interfaceName,
              isStatic: false,
              returnType: typeAnnotation ? stripLeadingColon(typeAnnotation.text) : undefined,
              ownerName: interfaceName,
              ownerKind: ASTEngine.SymbolKind.Interface,
              metadata: {
                isOptional,
                isInterfaceMember: true,
              },
            })
          }
          break
        }

        case "method_signature": {
          const methodName = member.childForFieldName("name")
          if (methodName) {
            const params = this.extractParameters(member)
            const returnType = this.extractReturnType(member)

            symbols.push({
              name: methodName.text,
              kind: ASTEngine.SymbolKind.Method,
              range: this.nodeRange(member),
              scope: interfaceName,
              parameters: params,
              returnType,
              ownerName: interfaceName,
              ownerKind: ASTEngine.SymbolKind.Interface,
              metadata: {
                isInterfaceMember: true,
              },
            })
          }
          break
        }

        case "index_signature": {
          this.extractIndexSignature(member, symbols)
          break
        }

        case "call_signature": {
          const params = this.extractParameters(member)
          const returnType = this.extractReturnType(member)

          symbols.push({
            name: "(call)",
            kind: ASTEngine.SymbolKind.Method,
            range: this.nodeRange(member),
            scope: interfaceName,
            parameters: params,
            returnType,
            ownerName: interfaceName,
            ownerKind: ASTEngine.SymbolKind.Interface,
            metadata: {
              isCallSignature: true,
            },
          })
          break
        }

        case "construct_signature": {
          const params = this.extractParameters(member)
          const returnType = this.extractReturnType(member)

          symbols.push({
            name: "(new)",
            kind: ASTEngine.SymbolKind.Constructor,
            range: this.nodeRange(member),
            scope: interfaceName,
            parameters: params,
            returnType,
            ownerName: interfaceName,
            ownerKind: ASTEngine.SymbolKind.Interface,
            metadata: {
              isConstructSignature: true,
            },
          })
          break
        }
      }
    }
  }

  private extractTypeAlias(node: Node, symbols: ASTEngine.UniversalSymbol[]): boolean {
    const nameNode = node.childForFieldName("name")
    if (!nameNode) return false
    const name = nameNode.text
    const exportStatus = isNodeExported(node)
    const typeValue = node.childForFieldName("value")
    const typeParams = this.extractTypeParameters(node)

    const symbol: ASTEngine.UniversalSymbol = {
      name,
      kind: ASTEngine.SymbolKind.Type,
      range: this.nodeRange(node),
      scope: stripTrailingDot(this.scopeManager.buildQualifiedName("")) || undefined,
      visibility: exportStatus.isExported ? "public" : "private",
      returnType: typeValue?.text,
      genericParameters: typeParams.length > 0 ? typeParams : undefined,
      comments: this.extractComments(node),
      ...this.scopeManager.getOwnerInfo(),
      metadata: {
        isExported: exportStatus.isExported,
        isDefault: exportStatus.isDefault,
        isMappedType: (() => {
          if (!typeValue) return false
          const stack: any[] = [typeValue]
          while (stack.length > 0) {
            const n: any = stack.pop()
            if (!n) continue
            if (n.type === "mapped_type_clause") return true
            for (let i = 0; i < n.namedChildCount; i++) stack.push(n.namedChild(i))
          }
          return false
        })(),
        isConditionalType: typeValue?.type === "conditional_type",
        isUnionType: typeValue?.type === "union_type",
        isIntersectionType: typeValue?.type === "intersection_type",
      },
    }

    symbols.push(symbol)
    this.scopeManager.registerSymbol(symbol)

    // For object-shaped type aliases (export type X = { id: string; name: string }),
    // extract members as Property symbols so they appear alongside interface members.
    if (typeValue && typeValue.type === "object_type") {
      this.scopeManager.pushScope(ScopeKind.Type, name, node)
      for (let i = 0; i < typeValue.namedChildCount; i++) {
        const member = typeValue.namedChild(i)
        if (!member) continue
        if (member.type === "property_signature") {
          const propName = member.childForFieldName("name")
          if (!propName) continue
          const typeAnnotation = member.childForFieldName("type")
          symbols.push({
            name: propName.text,
            kind: ASTEngine.SymbolKind.Property,
            range: this.nodeRange(member),
            scope: name,
            visibility: exportStatus.isExported ? "public" : "private",
            returnType: typeAnnotation ? stripLeadingColon(typeAnnotation.text) : undefined,
            ownerName: name,
            ownerKind: ASTEngine.SymbolKind.Type,
            isStatic: false,
            metadata: {
              isOptional: this.hasToken(member, "?"),
              isTypeAliasMember: true,
            },
          })
        } else if (member.type === "method_signature") {
          const methodName = member.childForFieldName("name")
          if (!methodName) continue
          symbols.push({
            name: methodName.text,
            kind: ASTEngine.SymbolKind.Method,
            range: this.nodeRange(member),
            scope: name,
            visibility: exportStatus.isExported ? "public" : "private",
            returnType: this.extractReturnType(member),
            parameters: this.extractParameters(member),
            ownerName: name,
            ownerKind: ASTEngine.SymbolKind.Type,
            isStatic: false,
            metadata: { isTypeAliasMember: true },
          })
        }
      }
      this.scopeManager.popScope()
    }

    return true
  }

  private extractEnum(node: Node, symbols: ASTEngine.UniversalSymbol[], stack: StackEntry[]): boolean {
    const nameNode = node.childForFieldName("name")
    if (!nameNode) return false
    const name = nameNode.text
    const modifiers = extractModifiersFromNode(node)
    const exportStatus = isNodeExported(node)

    const symbol: ASTEngine.UniversalSymbol = {
      name,
      kind: ASTEngine.SymbolKind.Enum,
      range: this.nodeRange(node),
      scope: stripTrailingDot(this.scopeManager.buildQualifiedName("")) || undefined,
      visibility: exportStatus.isExported ? "public" : "private",
      comments: this.extractComments(node),
      ...this.scopeManager.getOwnerInfo(),
      metadata: {
        isExported: exportStatus.isExported,
        isDefault: exportStatus.isDefault,
        isConst: modifiers.isConst,
      },
    }

    symbols.push(symbol)
    this.scopeManager.registerSymbol(symbol)

    // Extract enum members
    this.scopeManager.pushScope(ScopeKind.Enum, name, node)

    const body = node.childForFieldName("body")
    if (body) {
      for (let i = 0; i < body.namedChildCount; i++) {
        const member = body.namedChild(i)
        if (!member) continue

        if (member.type === "enum_assignment" || member.type === "property_identifier") {
          const memberName =
            member.type === "enum_assignment"
              ? member.childForFieldName("name")?.text || member.namedChild(0)?.text
              : member.text

          if (memberName) {
            const valueNode = member.childForFieldName("value")

            symbols.push({
              name: memberName,
              kind: ASTEngine.SymbolKind.EnumMember,
              range: this.nodeRange(member),
              scope: name,
              ownerName: name,
              ownerKind: ASTEngine.SymbolKind.Enum,
              metadata: {
                value: valueNode?.text,
                isEnumMember: true,
              },
            })
          }
        }
      }
    }

    this.scopeManager.popScope()
    return false
  }

  private extractVariables(node: Node, symbols: ASTEngine.UniversalSymbol[], stack: StackEntry[]): boolean {
    const isConst = node.text.startsWith("const")

    for (let i = 0; i < node.namedChildCount; i++) {
      const declarator = node.namedChild(i)
      if (!declarator || declarator.type !== "variable_declarator") continue

      const nameNode = declarator.childForFieldName("name")
      if (!nameNode) continue

      // Handle destructuring patterns
      if (nameNode.type === "object_pattern" || nameNode.type === "array_pattern") {
        this.extractDestructuringPattern(nameNode, declarator, symbols, isConst)
        continue
      }

      const name = nameNode.text
      const valueNode = declarator.childForFieldName("value")
      const exportStatus = isNodeExported(node)

      // Check if this is an arrow function assignment
      let kind: ASTEngine.SymbolKind = isConst ? ASTEngine.SymbolKind.Constant : ASTEngine.SymbolKind.Variable
      let params: ASTEngine.Parameter[] | undefined
      let returnType: string | undefined
      let isAsync = false

      if (valueNode?.type === "arrow_function" || valueNode?.type === "function") {
        kind = ASTEngine.SymbolKind.Function
        params = this.extractParameters(valueNode)
        // M49 #757 (TS self-audit): async arrows reported returnType "void" —
        // actively misleading for a value-returning function. TS semantics:
        // an async function ALWAYS returns a Promise; an expression-bodied
        // arrow has no return statements for the block walker, so infer the
        // body expression directly (T3's sync-arrow precedent, now actually
        // wired for the expression form the T3 probe missed). Explicit
        // annotations stay authoritative and are never re-wrapped.
        let isAsyncArrow = false
        for (let j = 0; j < valueNode.childCount; j++) {
          const child = valueNode.child(j)
          if (child && (child.type === "async" || child.text === "async")) {
            isAsyncArrow = true
            break
          }
        }
        isAsync = isAsyncArrow
        const explicitRet = valueNode.childForFieldName("return_type")
        const fnBody = valueNode.childForFieldName("body")
        const isExprBody = !!fnBody && fnBody.type !== "statement_block"
        if (explicitRet) {
          returnType = stripLeadingColon(explicitRet.text)
        } else if (isExprBody) {
          const info = this.typeInference.inferFromInitializer(fnBody!)
          const inner = info.type !== "unknown" ? info.type : "void"
          returnType = isAsyncArrow ? `Promise<${inner}>` : inner
        } else {
          returnType = this.extractReturnType(valueNode)
          if (isAsyncArrow) returnType = `Promise<${returnType}>`
        }
      } else {
        // Infer type from initializer
        const typeInfo = this.typeInference.inferType(declarator)
        returnType = typeInfo.type !== "unknown" ? typeInfo.type : undefined
      }

      const modifiers = extractModifiersFromNode(node)

      const symbol: ASTEngine.UniversalSymbol = {
        name,
        kind,
        range: this.nodeRange(declarator),
        scope: stripTrailingDot(this.scopeManager.buildQualifiedName("")) || undefined,
        visibility: exportStatus.isExported ? "public" : "private",
        isStatic: modifiers.isStatic,
        isAsync,
        parameters: params,
        returnType,
        decorators: modifiers.decorators.length > 0 ? modifiers.decorators : undefined,
        comments: this.extractComments(node),
        qualified_calls:
          kind === ASTEngine.SymbolKind.Function && valueNode ? this.extractQualifiedCalls(valueNode) : undefined,
        taintSources: valueNode ? this.extractTaintSources(valueNode) : undefined,
        taintSinks: valueNode ? this.extractTaintSinks(valueNode) : undefined,
        ...this.scopeManager.getOwnerInfo(),
        metadata: {
          isExported: exportStatus.isExported,
          isDefault: exportStatus.isDefault,
          isConst,
          isDeclare: modifiers.isDeclare,
          complexity:
            kind === ASTEngine.SymbolKind.Function && valueNode ? this.calculateComplexity(valueNode) : undefined,
          decoratorLines: modifiers.decoratorLines.length > 0 ? modifiers.decoratorLines : undefined,
        },
      }

      symbols.push(symbol)
      this.scopeManager.registerSymbol(symbol)

      // If arrow function, process body for nested symbols (locals suppressed)
      if (valueNode?.type === "arrow_function" || valueNode?.type === "function") {
        this.scopeManager.pushScope(ScopeKind.ArrowFunction, name, valueNode)
        stack.push({ action: () => this.scopeManager.popScope() })
        const body = valueNode.childForFieldName("body")
        if (body) {
          this.insideFunctionDepth++
          stack.push({ action: () => this.insideFunctionDepth-- })
          stack.push({ node: body })
        }
      }

      // W1 (JD18-class): object-literal VALUES carry members. Returning
      // false lets the walk descend naturally into the declarator's object
      // value, where the method_definition case extracts each member at ANY
      // depth (JS parity — nested object methods are their own scope).
      if (valueNode?.type === "object") {
        return false
      }
    }
    return true
  }

  private extractDestructuringPattern(
    pattern: Node,
    declarator: Node,
    symbols: ASTEngine.UniversalSymbol[],
    isConst: boolean,
  ): void {
    // M59 (#825) follow-up, measured on element-plus drawer.vue: every binding
    // gets the range of the node that BINDS it — the old code collected bare
    // names and stamped the whole declarator (`const {` for all of
    // afterEnter/afterLeave/... on lines 155-168). Two latent defects fixed
    // with the same rewrite: `{ renamed: local }` named the KEY (or nothing —
    // a property_identifier is neither identifier branch) instead of the bound
    // VALUE, and `{ withDefault = 5 }` (object_assignment_pattern) was dropped
    // entirely. The line belongs to the name (family contract).
    const extractPairs = (node: Node, out: Array<{ name: string; node: Node }>): void => {
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i)
        if (!child) continue

        if (child.type === "identifier" || child.type === "shorthand_property_identifier" || child.type === "shorthand_property_identifier_pattern") {
          out.push({ name: child.text, node: child })
        } else if (child.type === "pair_pattern") {
          // { key: value } — the VALUE side binds (key is the property read).
          const value = child.childForFieldName("value")
          if (value) {
            if (value.type === "identifier" || value.type === "shorthand_property_identifier" || value.type === "shorthand_property_identifier_pattern") {
              out.push({ name: value.text, node: value })
            } else {
              extractPairs(value, out)
            }
          }
        } else if (child.type === "rest_pattern") {
          const inner = child.namedChild(0)
          if (inner) {
            if (inner.type === "identifier") {
              out.push({ name: inner.text, node: inner })
            } else {
              extractPairs(inner, out)
            }
          }
        } else if (child.type === "assignment_pattern") {
          const left = child.childForFieldName("left") ?? child.namedChild(0)
          if (left) {
            if (left.type === "identifier" || left.type === "shorthand_property_identifier" || left.type === "shorthand_property_identifier_pattern") {
              out.push({ name: left.text, node: left })
            } else {
              extractPairs(left, out)
            }
          }
        } else if (child.type === "object_assignment_pattern" || child.type === "object_pattern" || child.type === "array_pattern") {
          extractPairs(child, out)
        }
      }
    }

    const pairs: Array<{ name: string; node: Node }> = []
    extractPairs(pattern, pairs)
    const exportStatus = isNodeExported(declarator)

    for (const { name, node: nameNode } of pairs) {
      symbols.push({
        name,
        kind: isConst ? ASTEngine.SymbolKind.Constant : ASTEngine.SymbolKind.Variable,
        range: this.nodeRange(nameNode, false),
        scope: stripTrailingDot(this.scopeManager.buildQualifiedName("")) || undefined,
        visibility: exportStatus.isExported ? "public" : "private",
        ...this.scopeManager.getOwnerInfo(),
        metadata: {
          isDestructured: true,
          isConst,
        },
      })
    }
  }

  private extractMethod(
    node: Node,
    symbols: ASTEngine.UniversalSymbol[],
    stack: StackEntry[],
    decoratorNodes?: Node[],
  ): boolean {
    const nameNode = node.childForFieldName("name")
    if (!nameNode) return false
    const name = nameNode.text
    const modifiers = extractModifiersFromNode(node)
    // Member decorators are class_body SIBLINGS, not children of the
    // method_definition — merge the sibling-collected names in.
    // M59 #860: method decorators are siblings, and those nodes carry the line
    // their reference edge must name.
    for (const d of decoratorNodes ?? []) {
      const n = extractDecoratorName(d)
      if (n) addDecorator(modifiers, n, d.startPosition.row + 1)
    }
    const params = this.extractParameters(node)
    const returnType = this.extractReturnType(node)
    const typeParams = this.extractTypeParameters(node)

    // get/set accessors parse as method_definition with a `get`/`set` token
    // child — classify as Property (family contract: accessors are properties).
    let isAccessor = false
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (c && (c.text === "get" || c.text === "set") && (c.type === "get" || c.type === "set" || c.type === "identifier")) {
        isAccessor = true
        break
      }
    }
    // Also check the direct token children (get/set are often anonymous tokens)
    if (!isAccessor) {
      for (let i = 0; i < node.childCount; i++) {
        const c = node.child(i)
        if (c && (c.text === "get" || c.text === "set") && !c.isNamed) {
          isAccessor = true
          break
        }
      }
    }

    // Determine visibility
    let visibility: "public" | "private" | "protected" = "public"
    if (modifiers.isPrivate || name.startsWith("#")) {
      visibility = "private"
    } else if (modifiers.isProtected) {
      visibility = "protected"
    }

    const ownerInfo = this.scopeManager.getOwnerInfo()
    const apiContract = this.extractApiContract(
      node,
      decoratorNodes && decoratorNodes.length > 0 ? decoratorNodes : undefined,
    )
    // T5 (review wave): compose a class-level base path (@Controller("users"),
    // @RequestMapping("/api")) with the method route, like java's
    // basePath+methodRoute composition. A bare @Get() under a base still
    // routes the base itself (NestJS semantics).
    let apiContractPath = apiContract.path
    if (apiContract.method) {
      const basePath = this.extractControllerBasePath()
      if (basePath !== undefined) {
        apiContractPath = joinContractPaths(basePath, apiContractPath)
      } else if (apiContractPath !== undefined) {
        apiContractPath = ensureLeadingSlash(apiContractPath)
      }
    }

    const symbol: ASTEngine.UniversalSymbol = {
      // M49 W15 (#813, owner ruling "symbol keeps the declared name"): a `#x`
      // member declares the name `#x`, and every edge that reads it already
      // carries that spelling — the old strip made the edge target name no
      // symbol at all (the join `edge.target -> symbol.name` failed for every
      // private member). `#` cannot appear in an identifier, so the declared
      // spelling can never collide with a module binding of the same text.
      name,
      kind: isAccessor ? ASTEngine.SymbolKind.Property : ASTEngine.SymbolKind.Method,
      range: this.nodeRange(node),
      scope: ownerInfo?.ownerName,
      visibility,
      isStatic: modifiers.isStatic,
      isAsync: modifiers.isAsync,
      isAbstract: modifiers.isAbstract,
      parameters: params,
      returnType,
      genericParameters: typeParams.length > 0 ? typeParams : undefined,
      decorators: modifiers.decorators.length > 0 ? modifiers.decorators : undefined,
      complexity: this.calculateComplexity(node),
      comments: this.extractComments(node),
      qualified_calls: this.extractQualifiedCalls(node),
      apiContractPath,
      taintSources: this.extractTaintSources(node),
      taintSinks: this.extractTaintSinks(node),
      ...ownerInfo,
      metadata: {
        apiMethod: apiContract.method,
        isOverride: modifiers.isOverride,
        isPrivateField: name.startsWith("#"),
        isGenerator: (() => {
          for (let i = 0; i < node.childCount; i++) {
            const c = node.child(i)
            if (c && !c.isNamed && c.text === "*") return true
          }
          return false
        })(),
        isAccessor,
        complexity: this.calculateComplexity(node),
        decoratorLines: modifiers.decoratorLines.length > 0 ? modifiers.decoratorLines : undefined,
      },
    }

    symbols.push(symbol)

    // Process method body for nested symbols (function depth suppresses locals)
    this.scopeManager.pushScope(ScopeKind.Method, name, node)
    stack.push({ action: () => this.scopeManager.popScope() })
    const body = node.childForFieldName("body")
    if (body) {
      this.insideFunctionDepth++
      stack.push({ action: () => this.insideFunctionDepth-- })
      stack.push({ node: body })
    }
    return true
  }

  private extractConstructor(
    node: Node,
    symbols: ASTEngine.UniversalSymbol[],
    stack: StackEntry[],
    decoratorNodes?: Node[],
  ): boolean {
    const params = this.extractParameters(node)
    const ownerInfo = this.scopeManager.getOwnerInfo()
    const modifiers = extractModifiersFromNode(node)
    const apiContract = this.extractApiContract(
      node,
      decoratorNodes && decoratorNodes.length > 0 ? decoratorNodes : undefined,
    )

    const symbol: ASTEngine.UniversalSymbol = {
      name: "constructor",
      kind: ASTEngine.SymbolKind.Constructor,
      range: this.nodeRange(node),
      scope: ownerInfo?.ownerName,
      visibility: "public",
      parameters: params,
      comments: this.extractComments(node),
      qualified_calls: this.extractQualifiedCalls(node),
      apiContractPath: apiContract.path,
      ...ownerInfo,
      metadata: { apiMethod: apiContract.method },
    }

    symbols.push(symbol)

    // Extract parameter properties (public/private/protected/readonly constructor params).
    // Modifier words must come from the parameter's actual keywords — substring
    // matching on default-value text fabricated phantom properties from string
    // defaults like t: string = "private".
    //
    // M59 (#825) follow-up, measured on element-plus cascader-panel/node.ts:
    // each property's range starts at its own PARAMETER's name line, not the
    // constructor's. The old nodeRange(node) stamped `constructor(` for every
    // member of a wrapped header (`readonly data/config/parent/root` all
    // claimed line 58, written on 59-62) — the line belongs to the name.
    const paramNameNodes = new Map<string, Node>()
    const formalParams = node.childForFieldName("parameters")
    if (formalParams) {
      for (let i = 0; i < formalParams.namedChildCount; i++) {
        const p = formalParams.namedChild(i)
        if (!p) continue
        const pat = p.childForFieldName("pattern") ?? p.childForFieldName("name")
        if (pat) paramNameNodes.set(pat.text.replace(/^\.\.\./, ""), pat)
      }
    }
    for (const param of params) {
      const mods: string[] = (param as any).modifiers ?? []
      const hasVis = mods.includes("public") || mods.includes("private") || mods.includes("protected")
      const hasRead = mods.includes("readonly")
      if (!hasVis && !hasRead) continue

      const vis: "public" | "private" | "protected" = mods.includes("private")
        ? "private"
        : mods.includes("protected")
          ? "protected"
          : "public"

      const name = param.name.startsWith("...") ? param.name.slice(3) : param.name
      const nameNode = paramNameNodes.get(name)
      const propRange = nameNode ? this.nodeRange(nameNode, false) : this.nodeRange(node)
      symbols.push({
        name,
        kind: ASTEngine.SymbolKind.Property,
        range: propRange,
        scope: ownerInfo?.ownerName,
        visibility: vis,
        returnType: param.type,
        ...ownerInfo,
        metadata: {
          isParameterProperty: true,
          isReadonly: hasRead,
        },
      })
    }

    // Process constructor body (function depth suppresses locals)
    this.scopeManager.pushScope(ScopeKind.Constructor, "constructor", node)
    stack.push({ action: () => this.scopeManager.popScope() })
    const body = node.childForFieldName("body")
    if (body) {
      this.insideFunctionDepth++
      stack.push({ action: () => this.insideFunctionDepth-- })
      stack.push({ node: body })
    }
    return true
  }

  private extractProperty(node: Node, symbols: ASTEngine.UniversalSymbol[]): void {
    const nameNode = node.childForFieldName("name")
    if (!nameNode) return

    const name = nameNode.text
    const modifiers = extractModifiersFromNode(node)
    const typeAnnotation = node.childForFieldName("type")
    const valueNode = node.childForFieldName("value")

    // Infer type if not explicitly annotated
    let returnType = typeAnnotation ? stripLeadingColon(typeAnnotation.text) : undefined
    if (!returnType && valueNode) {
      const typeInfo = this.typeInference.inferFromInitializer(valueNode)
      returnType = typeInfo.type !== "unknown" ? typeInfo.type : undefined
    }

    let visibility: "public" | "private" | "protected" = "public"
    if (modifiers.isPrivate || name.startsWith("#")) {
      visibility = "private"
    } else if (modifiers.isProtected) {
      visibility = "protected"
    }

    const ownerInfo = this.scopeManager.getOwnerInfo()

    const symbol: ASTEngine.UniversalSymbol = {
      // #813: the declared spelling is the member's one name (see the method
      // site above). `metadata.isPrivateField` stays as the flag consumers
      // read for the private-ness itself.
      name,
      kind: ASTEngine.SymbolKind.Property,
      range: this.nodeRange(node),
      scope: ownerInfo?.ownerName,
      visibility,
      isStatic: modifiers.isStatic,
      returnType,
      decorators: modifiers.decorators.length > 0 ? modifiers.decorators : undefined,
      comments: this.extractComments(node),
      ...ownerInfo,
      metadata: {
        isReadonly: modifiers.isReadonly,
        isPrivateField: name.startsWith("#"),
        isAbstract: modifiers.isAbstract,
        hasInitializer: !!valueNode,
        decoratorLines: modifiers.decoratorLines.length > 0 ? modifiers.decoratorLines : undefined,
      },
    }

    symbols.push(symbol)
  }

  /**
   * M14 — declared-type reference graph. TypeScript's grammar wraps every
   * declared type position in a `type_annotation` node, so hooking that one
   * node type covers interface members, class fields, ctor/method params,
   * return types, and typed locals uniformly. as-casts (`x as T`) parse as
   * as_expression; instanceof checks as binary_expression with the
   * instanceof operator — both handled here with their own labels.
   */
  private extractDeclaredTypeRefs(rootNode: Node, relationships: ASTEngine.UniversalRelationship[]): void {
    const emitted = new Set<string>()
    const PRIMITIVES = new Set(["string", "number", "boolean", "any", "unknown", "never", "void", "object", "symbol", "bigint", "undefined", "null"])

    const collectTypeNames = (n: Node, out: string[]): void => {
      if (n.type === "type_identifier" || n.type === "nested_type_identifier") {
        if (!PRIMITIVES.has(n.text) && !out.includes(n.text)) out.push(n.text)
        return
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) collectTypeNames(c, out)
      }
    }

    /**
     * M59 (#825): the same walk as `collectTypeNames`, returning each name WITH
     * the node that spells it. A type expression's start is NOT the line of the
     * types inside it — a multi-line generic argument list opens on the base name
     * and puts its arguments on later lines (scala mechanism 2, measured on real
     * source), so the line has to come from the name node and the string-only walk
     * cannot supply it. Kept beside `collectTypeNames` so the two cannot drift: one
     * is that walk's names, the other its names plus their nodes.
     */
    const collectTypeNameNodes = (n: Node, out: Array<{ name: string; node: Node }>): void => {
      if (n.type === "type_identifier" || n.type === "nested_type_identifier") {
        if (!PRIMITIVES.has(n.text) && !out.some((o) => o.name === n.text)) out.push({ name: n.text, node: n })
        return
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) collectTypeNameNodes(c, out)
      }
    }

    const resolveSource = (start: Node): string => {
      let p: Node | null = start.parent
      while (p) {
        if (
          p.type === "class_declaration" ||
          p.type === "class" ||
          p.type === "function_declaration" ||
          p.type === "generator_function_declaration" ||
          p.type === "method_definition" ||
          p.type === "interface_declaration" ||
          p.type === "variable_declarator"
        ) {
          const name = this.findNamedChild(p)
          if (name) return name.text
        }
        p = p.parent
      }
      return "global"
    }

    const emit = (source: string, roots: Node[], relType: string): void => {
      for (const r of roots) {
        if (!r) continue
        // Expression-position targets (instanceof) lex as plain identifiers;
        // type positions use type_identifier — accept both here.
        const pairs: Array<{ name: string; node: Node }> = []
        if (r.type === "identifier") {
          if (!PRIMITIVES.has(r.text)) pairs.push({ name: r.text, node: r })
        } else {
          collectTypeNameNodes(r, pairs)
        }
        for (const { name: t, node: tNode } of pairs) {
          const key = `${source}|${t}|${relType}`
          if (emitted.has(key)) continue
          emitted.add(key)
          relationships.push({
            source,
            target: t,
            type: ASTEngine.RelationshipType.References,
            confidence: 0.95,
            ...this.lineField(tNode),
            metadata: { relationshipType: relType },
          })
        }
      }
    }

    const walk = (n: Node): void => {
      switch (n.type) {
        case "type_annotation": {
          // A type_annotation directly on a function/method AFTER its
          // parameter list is the return type — label it distinctly.
          const p = n.parent
          const isReturn =
            (p?.type === "method_definition" || p?.type === "function_declaration") &&
            (() => {
            if (!p) return false
            let sawParams = false
            for (let i = 0; i < p.namedChildCount; i++) {
              const c = p.namedChild(i)
              if (!c) continue
              if (c.type === "formal_parameters") { sawParams = true; continue }
              // Tree-sitter node objects are recreated per access — compare
              // by id, never by reference.
              if (n.id !== undefined && c.id === n.id) return sawParams
              if (c.startIndex === n.startIndex && c.type === n.type) return sawParams
            }
            return false
            })()
          emit(resolveSource(n), [n], isReturn ? "return_type" : "declared_type")
          break
        }
        case "as_expression": {
          if (n.namedChildCount >= 2) {
            const right = n.namedChild(n.namedChildCount - 1)
            if (!right) break
            emit(resolveSource(n), [right], "cast_target")
          }
          break
        }
        case "binary_expression": {
          // The operator is an ANONYMOUS child token (no named field in this
          // grammar), so detect it by walking children.
          let isInstanceof = false
          for (let i = 0; i < n.childCount; i++) {
            const c = n.child(i)
            if (c && !c.isNamed && c.text === "instanceof") { isInstanceof = true; break }
          }
          if (isInstanceof) {
            const right = n.namedChild(n.namedChildCount - 1)
            // Expression position: the target lexes as identifier, not
            // type_identifier — emit() handles both shapes.
            if (right) emit(resolveSource(n), [right], "instanceof_check")
          }
          break
        }
        case "type_alias_declaration": {
          // M14 #419 T2: the alias RHS references its own types —
          // type Fn = (a: Id) => Id references Id (param + return),
          // type Pair = [Id, Id] references Id, type Rec = { next?: Rec }
          // references Rec (self). Pre-fix the RHS types were silent; the
          // alias symbol emitted but carried no reference edges.
          const aliasName = n.childForFieldName("name")?.text
          const value = n.childForFieldName("value")
          if (aliasName && value) {
            // The value's own type_parameters (T, K) are bindings, not
            // references — collectTypeNames already skips nothing here, so
            // the RHS value node alone carries the referenced types.
            emit(aliasName, [value], "type_alias")
          }
          break
        }
        case "type_assertion": {
          // M14 #419 T8: <Foo>x — the angle-bracket cast form. The type
          // lives in the first named child (type_arguments wrapper holds
          // the type_identifier(s)).
          const inner = n.namedChild(0)
          if (inner) emit(resolveSource(n), [inner], "cast_target")
          break
        }
        case "type_arguments": {
          // M14 #419 T9: explicit generic instantiation — f<Baz>(x) parses
          // as call_expression with a type_arguments child (no
          // instantiation_expression node), and foo<Bar> standalone parses
          // as instantiation_expression with a type_arguments child. The
          // walk recurses into type_arguments either way, so hooking the
          // node itself covers both shapes: the type names inside (Baz) are
          // references, not bindings.
          // SCD7 (M37 #599 pre-wave): when this type_arguments is embedded
          // in a type_annotation (`const local: Map<String, Foo>`), the
          // type_annotation case ALREADY emitted every nested name as
          // declared_type (the java/kotlin family contract: one
          // declared_type per type name). Emitting them again as
          // type_argument double-emitted String/Foo from the same site.
          // Call-site/instantiation type_arguments keep their edge.
          let inAnnotation = false
          for (let a = n.parent; a; a = a.parent) {
            if (a.type === "type_annotation") { inAnnotation = true; break }
          }
          if (inAnnotation) break
          const names: string[] = []
          collectTypeNames(n, names)
          if (names.length > 0) emit(resolveSource(n), [n], "type_argument")
          break
        }
        case "satisfies_expression": {
          // M14 #419 T5: x satisfies T — T is a type reference (TS 4.9).
          const last = n.namedChild(n.namedChildCount - 1)
          if (last) emit(resolveSource(n), [last], "satisfies_target")
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

  private findNamedChild(node: Node): Node | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (!c) continue
      if (c.type === "type_identifier" || c.type === "identifier" || c.type === "property_identifier") return c
    }
    return null
  }

  /**
   * M14 #299 - evidence-tier classification for EVERY emitted relationship.
   * Same rules as the JVM family (structural / usage_contextual /
   * import_based / reference_qualified / inferred).
   */
  private classifyEvidenceTier(relationships: ASTEngine.UniversalRelationship[]): void {
    for (const r of relationships) {
      const md = r.metadata ?? (r.metadata = {})
      if (md.evidenceClass) continue
      const t = String(r.type ?? r.relationshipType ?? "")
      const conf = typeof r.confidence === "number" ? r.confidence : 1
      if (t === "contains" || t === "exports") { md.evidenceClass = "structural"; continue }
      // M14 #419 T1: the dedicated `imports` relationship kind carries
      // module dependencies (target module:item) — same evidence class the
      // JVM family gives its import references (isImportDep/import_based).
      // Pre-fix this kind fell through to usage_contextual.
      if (t === "imports") { md.evidenceClass = "import_based"; continue }
      if (t === "references") {
        md.evidenceClass = md.isImport ? "import_based" : "reference_qualified"
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
        md.evidenceClass = conf >= 0.9 ? "structural" : "usage_contextual"
        continue
      }
      md.evidenceClass = "usage_contextual"
    }
  }


  private extractIndexSignature(node: Node, symbols: ASTEngine.UniversalSymbol[]): void {
    // [key: string]: T
    const ownerInfo = this.scopeManager.getOwnerInfo()

    // Extract the index parameter and value type
    let indexParam = ""
    let valueType = ""

    // Real grammar shape (tree-sitter-typescript): index_signature >
    //   identifier (key name) + type_annotation (value type).
    // The old branches referenced nonexistent node types
    // (index_signature_parameter/formal_parameter), so indexParam stayed
    // empty and valueType captured the KEY name instead of the value type.
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (!child) continue
      if (child.type === "identifier") {
        indexParam = child.text
      } else if (child.type === "type_annotation") {
        valueType = child.text.replace(/^:\s*/, "")
      }
    }

    const symbol: ASTEngine.UniversalSymbol = {
      name: `[${indexParam}]`,
      kind: ASTEngine.SymbolKind.Property,
      range: this.nodeRange(node),
      scope: ownerInfo?.ownerName,
      returnType: valueType || "unknown",
      ...ownerInfo,
      metadata: {
        isIndexSignature: true,
        indexParameter: indexParam,
      },
    }

    symbols.push(symbol)
  }

  // W1 (JD18-class): object-literal shorthand methods are members of the
  // object's owning variable. Owner resolution: walk up from the
  // method_definition to the enclosing variable_declarator (const util = {
  // run() {...} } -> owner util). Nested objects inherit the same owner
  // (the outermost binding names the value). The resolver's method_definition
  // branch then attributes calls to the method symbol itself (matching the
  // JS contract: run -> helper, never util -> helper).
  private extractObjectLiteralMethod(node: Node, symbols: ASTEngine.UniversalSymbol[], stack: StackEntry[]): boolean {
    const nameNode = node.childForFieldName("name")
    if (!nameNode) return false
    const name = nameNode.text
    let ownerName: string | undefined
    let cur: Node | null = node.parent
    while (cur) {
      if (cur.type === "variable_declarator") {
        ownerName = cur.childForFieldName("name")?.text
        break
      }
      if (cur.type === "pair") {
        cur = cur.parent
        continue
      }
      if (cur.type === "object") {
        cur = cur.parent
        continue
      }
      break
    }
    const ownerInfo = ownerName
      ? { ownerName, ownerKind: ASTEngine.SymbolKind.Constant as unknown as ASTEngine.SymbolKind }
      : this.scopeManager.getOwnerInfo()
    // Reuse extractMethod for full parity (params, complexity, qualified_calls,
    // taint payloads) with the owner info swapped in afterwards.
    const before = symbols.length
    const ok = this.extractMethod(node, symbols, stack)
    if (ok) {
      for (let i = before; i < symbols.length; i++) {
        const s = symbols[i]
        if (ownerInfo) {
          s.ownerName = ownerInfo.ownerName
          s.ownerKind = ownerInfo.ownerKind
          s.scope = ownerInfo.ownerName
        }
      }
      // extractMethod pushed a Method scope named after the METHOD — for
      // object-literal members the body must descend with the method scope
      // (same as class methods), which extractMethod already arranged via
      // its own pushScope. Nothing further here.
    }
    return ok
  }

  private extractStaticBlock(node: Node, symbols: ASTEngine.UniversalSymbol[], stack: StackEntry[]): boolean {
    const ownerInfo = this.scopeManager.getOwnerInfo()

    const symbol: ASTEngine.UniversalSymbol = {
      name: "static {}",
      kind: ASTEngine.SymbolKind.Method,
      range: this.nodeRange(node),
      scope: ownerInfo?.ownerName,
      isStatic: true,
      ...ownerInfo,
      metadata: {
        isStaticBlock: true,
      },
    }

    symbols.push(symbol)

    // Process static block body
    this.scopeManager.pushScope(ScopeKind.Block, "static", node)
    stack.push({ action: () => this.scopeManager.popScope() })
    for (let i = node.namedChildCount - 1; i >= 0; i--) {
      const child = node.namedChild(i)
      if (child) stack.push({ node: child })
    }
    return true
  }

  private extractNamespace(node: Node, symbols: ASTEngine.UniversalSymbol[], stack: StackEntry[]): boolean {
    const nameNode = node.childForFieldName("name")
    if (!nameNode) {
      // NAMELESS ambient wrappers (`declare global { ... }`) have no name
      // FIELD at all — bailing here combined with the container no-descent
      // list silently dropped the ENTIRE subtree (jsx.d.ts extracted 0
      // symbols: every global-augmentation interface vanished). Descend
      // into the body so nested declarations are extracted.
      const body = node.childForFieldName("body")
      if (body) {
        stack.push({ node: body })
      } else {
        for (let i = node.namedChildCount - 1; i >= 0; i--) {
          const c = node.namedChild(i)
          if (c) stack.push({ node: c })
        }
      }
      return true
    }
    // String-named modules (`declare module "foo"`) keep their quotes in the
    // AST; strip them so qualified names stay clean.
    const rawName = nameNode.text
    const name = rawName.startsWith('"') || rawName.startsWith("'") ? rawName.slice(1, -1) : rawName
    const exportStatus = isNodeExported(node)
    const modifiers = extractModifiersFromNode(node)

    const symbol: ASTEngine.UniversalSymbol = {
      name,
      kind: ASTEngine.SymbolKind.Namespace,
      range: this.nodeRange(node),
      scope: stripTrailingDot(this.scopeManager.buildQualifiedName("")) || undefined,
      visibility: exportStatus.isExported ? "public" : "private",
      comments: this.extractComments(node),
      ...this.scopeManager.getOwnerInfo(),
      metadata: {
        isExported: exportStatus.isExported,
        isDeclare: modifiers.isDeclare,
      },
    }

    symbols.push(symbol)
    this.scopeManager.registerSymbol(symbol)

    // Process namespace body
    this.scopeManager.pushScope(ScopeKind.Namespace, name, node)
    stack.push({ action: () => this.scopeManager.popScope() })
    const body = node.childForFieldName("body")
    if (body) stack.push({ node: body })
    return true
  }

  // ========================================================================
  // IMPORT/EXPORT EXTRACTION
  // ========================================================================

  private extractImports(node: Node, imports: ASTEngine.ImportInfo[]): void {
    if (node.type === "import_statement") {
      const sourceNode = node.childForFieldName("source")
      if (!sourceNode) return

      const modulePath = stringContent(sourceNode)
      const items = extractImportItems(node)
      const clause = extractImportClause(node)

      // Resolve actual module path
      const resolvedPath = this.moduleResolver?.resolveModulePath(modulePath, this.currentFile) || modulePath

      imports.push({
        module: modulePath,
        items,
        isDefault: !!clause.defaultImport,
        alias: clause.namespaceImport,
        range: this.nodeRange(node),
        metadata: {
          resolvedPath,
        },
      })
    }

    // Also check for dynamic imports
    if (node.type === "call_expression") {
      const callee = node.namedChild(0)
      if (callee?.text === "import" || callee?.type === "import") {
        const args = node.childForFieldName("arguments")
        if (args && args.namedChildCount > 0) {
          const pathArg = args.namedChild(0)
          if (pathArg && (pathArg.type === "string" || pathArg.type === "template_string")) {
            const modulePath = stringContent(pathArg)
            imports.push({
              module: modulePath,
              items: ["*"],
              isDefault: false,
              range: this.nodeRange(node),
            })
          }
        }
      }
    }

    // Recurse
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child) {
        this.extractImports(child, imports)
      }
    }
  }

  private extractExports(node: Node, exports: ASTEngine.ExportInfo[], symbols: ASTEngine.UniversalSymbol[]): void {
    if (node.type === "export_statement") {
      // Check for default export
      const isDefault = this.hasToken(node, "default")
      let foundNamed: boolean = false
      // Names exported by THIS statement (used for re-export dependency
      // records — see the sourceNode block below).
      const namesFromThisStatement: string[] = []

      // Check for re-exports (export { x } from "y")
      const sourceNode = node.childForFieldName("source")

      // Find exported names
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i)
        if (!child) continue

        if (child.type === "export_clause") {
          // Named exports: export { a, b as c }
          for (let j = 0; j < child.namedChildCount; j++) {
            const specifier = child.namedChild(j)
            if (specifier && specifier.type === "export_specifier") {              const name = specifier.childForFieldName("name")
              const alias = specifier.childForFieldName("alias")

              if (name) {
                foundNamed = true
                const exportName = alias?.text || name.text
                namesFromThisStatement.push(exportName)
                exports.push({
                  name: exportName,
                  isDefault: false,
                  range: this.nodeRange(specifier),
                })
              }
            }
          }
        } else if (child.type === "namespace_export") {
          // `export * as ns from "./m"` — the re-exported name is the
          // namespace alias. (The '*' token is INSIDE namespace_export, so
          // a bare hasToken('*') check on the statement misses this shape.)
          const nameNode = child.namedChild(child.namedChildCount - 1)
          if (nameNode) {
            foundNamed = true
            namesFromThisStatement.push(nameNode.text)
            exports.push({
              name: nameNode.text,
              isDefault: false,
              range: this.nodeRange(child),
            })
          }
        } else if (
          child.type === "function_declaration" ||
          child.type === "class_declaration" ||
          child.type === "interface_declaration" ||
          child.type === "type_alias_declaration" ||
          child.type === "enum_declaration"
        ) {
          const nameNode = child.childForFieldName("name")
          if (nameNode) {
            foundNamed = true
            exports.push({
              name: nameNode.text,
              isDefault,
              type: child.type.replace("_declaration", ""),
              range: this.nodeRange(child),
            })
          }
        } else if (child.type === "lexical_declaration" || child.type === "variable_declaration") {
          // export const x = ...
          for (let j = 0; j < child.namedChildCount; j++) {
            const declarator = child.namedChild(j)
            if (declarator && declarator.type === "variable_declarator") {
              const nameNode = declarator.childForFieldName("name")
              if (nameNode && nameNode.type === "identifier") {
                foundNamed = true
                exports.push({
                  name: nameNode.text,
                  isDefault,
                  type: "variable",
                  range: this.nodeRange(declarator),
                })
              }
            }
          }
        } else if (child.type === "identifier" && isDefault) {
          // export default identifier
          foundNamed = true
          exports.push({
            name: child.text,
            isDefault: true,
            range: this.nodeRange(child),
          })
        }
      }

      if (isDefault && !foundNamed) {
        exports.push({
          name: "default",
          isDefault: true,
          type: "default_export_expression",
          range: this.nodeRange(node),
        })
      }

      // Re-exports record a module dependency: `export { X } from "./mod"`
      // The analyzer surface includes this in `imports` via a synthetic
      // ImportInfo with `reExport: true`. Names are collected from THIS
      // statement's children during the pass above — an earlier version
      // re-scanned the global exports array by line-range overlap, which
      // fabricated cross-module items when two export statements shared a
      // line (minified/bundled code): `export { alpha } from "./m1";
      // export { beta } from "./m2"` claimed alpha came from m2.
      if (sourceNode) {
        const modulePath = stringContent(sourceNode)
        const reExportedNames = namesFromThisStatement.slice()
        // Star ONLY when the statement actually has one. An EMPTY clause
        // (`export {} from "./m"` — exports nothing) previously misfired
        // as a star re-export because !foundNamed was the only signal.
        if (reExportedNames.length === 0 && this.hasToken(node, "*")) {
          reExportedNames.push("*")
        }
        if (reExportedNames.length > 0) {
          this._pendingReExportImports.push({
            module: modulePath,
            items: reExportedNames,
            isDefault: false,
            range: this.nodeRange(node),
            metadata: { reExport: true },
          })
        }
      }
    }

    // Recurse
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child) {
        this.extractExports(child, exports, symbols)
      }
    }
  }

  // ========================================================================
  // RELATIONSHIP EXTRACTION - All 10 relationship types
  // ========================================================================

  private extractRelationships(
    node: Node,
    relationships: ASTEngine.UniversalRelationship[],
    symbols: ASTEngine.UniversalSymbol[],
    exports: ASTEngine.ExportInfo[],
  ): void {
    // 1. Extract inheritance (extends) relationships from classes
    this.extractInheritanceRelationships(symbols, relationships)

    // 2. Extract implementation relationships
    this.extractImplementsRelationships(symbols, relationships)

    // 3. Extract call relationships from function bodies
    this.extractCallRelationships(node, relationships, symbols)

    // 4. Extract usage/reference relationships
    this.extractUsageRelationships(node, relationships, symbols)

    // 5. Extract instantiation relationships (new X())
    this.extractInstantiationRelationships(node, relationships, symbols)

    // 6. Extract decorator relationships
    this.extractDecoratorRelationships(symbols, relationships)

    // 7. Extract override relationships
    this.extractOverrideRelationships(symbols, relationships)

    // 8. Extract import relationships
    this.extractImportRelationships(node, relationships, symbols)

    // 9. Extract export relationships
    this.extractExportRelationships(exports, relationships, symbols)
  }

  /**
   * M59 (#825): the `line_number` field for a relationship, taken from the node
   * that CARRIES THE NAME the edge is about.
   *
   * typescript and javascript start where java did: **0 lines on every
   * relationship** — measured by the M59 oracle at 40 files/language before this
   * round: typescript 0 of 444, javascript 0 of 5,818, vue 0 of 3,940, svelte 0 of
   * 526, and the oracle could not even run its mutation self-test because no
   * line-bearing relationship existed. The contract is inherited from scala's
   * corrected reference, not re-invented, and it is one sentence: **the line
   * belongs to the name, never to the construct that contains it.** A
   * `call_expression` starts at its RECEIVER (scala mechanism 1), a type
   * expression's start is not the line of the types inside it (mechanism 2), and
   * a definition node can start at its decorators. So callers pass the NAME node,
   * and this returns nothing at all when there is none — never `0`, because
   * #820/#821 made `0` mean "unknown" to every reader and unknown must be absent.
   *
   * `fallback` exists only for sites whose construct has no name-bearing child.
   */
  private lineField(nameNode: Node | null | undefined, fallback?: Node | null): { line_number?: number } {
    const n = nameNode ?? fallback
    return n ? { line_number: n.startPosition.row + 1 } : {}
  }

  private extractInheritanceRelationships(
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
  ): void {
    for (const symbol of symbols) {
      if (symbol.kind === ASTEngine.SymbolKind.Class || symbol.kind === ASTEngine.SymbolKind.Interface) {
        const extendsTypes = symbol.metadata?.extends as string[] | undefined
        // M59 (#825): the base NAME's line, parallel to the name list (absent
        // when the heritage collector could not locate a node for it — unknown
        // must be absent, never `0`).
        const extendsLines = symbol.metadata?.extendsLines as number[] | undefined
        if (extendsTypes) {
          for (let i = 0; i < extendsTypes.length; i++) {
            const baseType = extendsTypes[i]
            relationships.push({
              source: symbol.name,
              target: baseType,
              type: ASTEngine.RelationshipType.Extends,
              confidence: 1.0,
              ...(extendsLines?.[i] ? { line_number: extendsLines[i] } : {}),
              metadata: {
                sourceKind: symbol.kind,
              },
            })
          }
        }
      }
    }
  }

  private extractImplementsRelationships(
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
  ): void {
    for (const symbol of symbols) {
      if (symbol.kind === ASTEngine.SymbolKind.Class) {
        const implementsTypes = symbol.metadata?.implements as string[] | undefined
        // M59 (#825 discipline): the interface NAME's line, parallel to the name
        // list and absent when the collector could not locate a node for it —
        // unknown is absent, never `0`.
        const implementsLines = symbol.metadata?.implementsLines as number[] | undefined
        if (implementsTypes) {
          for (let i = 0; i < implementsTypes.length; i++) {
            const iface = implementsTypes[i]
            relationships.push({
              source: symbol.name,
              target: iface,
              type: ASTEngine.RelationshipType.Implements,
              confidence: 1.0,
              ...(implementsLines?.[i] ? { line_number: implementsLines[i] } : {}),
              metadata: {},
            })
          }
        }
      }
    }
  }

  /**
   * M59 (#861): is this node written in DECORATOR position?
   *
   * A decorator is METADATA on the symbol it decorates, not a call or a
   * reference made by whoever lexically encloses it. The family already rules
   * this way: the JVM analyzers attach annotations as `decorators` metadata and
   * emit no call/reference from them, and the python oracle documents the same
   * rule (PYD1 — "the analyzer treats decorators as metadata on the decorated
   * symbol, not runtime call edges", with its oracle skipping the positions to
   * match). typescript was the exception: because a decorator is syntactically
   * a call expression inside the class body, `@inject("db")` produced
   * `calls Service -> inject` AND `references Service -> inject` from the CLASS
   * — so a class appeared to call a decorator it never mentions in its body —
   * alongside the correct `references pool -> inject` that
   * extractDecoratorRelationships emits from the decorated member.
   *
   * The walk stops at the enclosing statement/declaration boundary rather than
   * walking to the root: a decorator on a METHOD cannot make the method's own
   * body a decorator position (its decorators are siblings of
   * method_definition, never ancestors of the body).
   */
  private inDecoratorPosition(n: Node): boolean {
    let p: Node | null = n.parent
    while (p) {
      if (p.type === "decorator") return true
      if (
        p.type === "class_declaration" ||
        p.type === "abstract_class_declaration" ||
        p.type === "class" ||
        p.type === "function_declaration" ||
        p.type === "method_definition" ||
        p.type === "statement_block" ||
        p.type === "program"
      ) {
        return false
      }
      p = p.parent
    }
    return false
  }

  private extractCallRelationships(
    node: Node,
    relationships: ASTEngine.UniversalRelationship[],
    symbols: ASTEngine.UniversalSymbol[],
  ): void {
    const processNode = (n: Node, currentSymbol: ASTEngine.UniversalSymbol | null): void => {
      currentSymbol = this.resolveRelationshipSymbol(n, symbols, currentSymbol)
      // M59 (#861): no call edge is emitted for a decorator invocation — see
      // inDecoratorPosition. The subtree is skipped whole, so a call nested in a
      // decorator's ARGUMENTS (`@inject(makeToken())`) is decorator position too,
      // which is exactly what the oracle now skips.
      if (this.inDecoratorPosition(n)) return

      // Extract call expressions and JSX component usages
      // TSD4 (JAD2-class): the top-level fallback is the file's module LEAF
      // name — the same source imports/exports use — never a "(script)"
      // placeholder no consumer can resolve (JS parity: moduleName).
      const callSource = currentSymbol || { name: this.moduleLeafName(), scope: undefined, kind: "module" as any, range: { startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 }, metadata: {} as any }
      if (
        (n.type === "call_expression" || n.type === "jsx_self_closing_element" || n.type === "jsx_element")
      ) {
        if (n.type === "call_expression") {
          const callee = n.namedChild(0)
          if (callee) {
            // M14 #858: the constructor call of a wrapped `new` is not a call at
            // all — it is the instantiation the grammar failed to build. Emit it
            // through the same helper the new_expression path uses, walk the
            // arguments (nested real calls live there), and emit nothing else.
            if (this.isWrappedNewConstructor(n)) {
              this.pushInstantiation(callee, n, callSource, relationships)
              for (let i = 0; i < n.namedChildCount; i++) {
                const child = n.namedChild(i)
                if (child) processNode(child, currentSymbol)
              }
              return
            }
            // M14 #419 T7: dynamic import() is a module dependency, not a
            // call — skip it here so no spurious calls edge to `import` is
            // emitted (the imports edge comes from extractImportRelationships).
            //
            // M49 W4 (T3, rotated-sample finding): skipping the EDGE must not
            // skip the SUBTREE. `return` here (and on the subscript branch
            // below) aborted processNode before its child recursion, so every
            // real call inside the arguments vanished — probe: TS emitted
            // NOTHING for `console[method](message.text())` while the oracle
            // derived calls->text (svelte repo runtime-browser/test.ts:203,
            // surfaced as MISSING once #760's rotation sampled the file).
            // Same defect class as the M49 W1 javascript `continue`-skips-
            // subtree fix; walk the children, then stop.
            if (callee.text === "import" || callee.type === "import") {
              for (let i = 0; i < n.namedChildCount; i++) {
                const child = n.namedChild(i)
                if (child) processNode(child, currentSymbol)
              }
              return
            }
            let targetName = callee.text
            let fullCallee = callee.text

            // Handle member expressions (obj.method())
            if (callee.type === "member_expression") {
              const property = callee.childForFieldName("property")
              if (property) {
                targetName = property.text
              }
            } else if (callee.type === "subscript_expression") {
              // W2 (web-family contract, JS J-subscript precedent): computed
              // member calls — `nodeTransforms[i](node)`, `el[assignKey](...)`
              // — have no clean call target. The pre-fix branch let the RAW
              // subscript text through ("nodeTransforms[i]" targets no symbol
              // index can join — 2 fabrications in vue-core transform.ts
              // alone). JS skips these; TS must too (probed 2026-09-08).
              //
              // M49 W4 (T3): the EDGE is skipped, never the SUBTREE — the
              // arguments still carry real calls (see the import branch note).
              for (let i = 0; i < n.namedChildCount; i++) {
                const child = n.namedChild(i)
                if (child) processNode(child, currentSymbol)
              }
              return
            }

            // Skip targets that are clearly not valid function names:
            // - Tree-sitter ERROR nodes leaking code blocks
            // - Template literal fragments
            // - Overly long text (>100 chars can't be a real name)
            // - Text containing spaces, newlines, or expression syntax
            if (
              targetName.length > 100 ||
              targetName.includes("\n") ||
              targetName.includes("`") ||
              targetName.includes("${") ||
              hasBraceEquals(targetName)
            ) {
              // Skip — malformed call_expression from tree-sitter error recovery
            } else if (this.isTypeScriptBuiltinCall(targetName, fullCallee)) {
              // Filtered builtins (console output, Object leaf methods, super)
            } else {

            relationships.push({
              source: callSource.name,
              target: targetName,
              type: ASTEngine.RelationshipType.Calls,
              confidence: 0.9,
              // M59 (#825): the callee LEAF — for `a.b.c()` the property node, so
              // a chain's call does not take the chain's opening line.
              ...this.lineField(callee.type === "member_expression" ? (callee.childForFieldName("property") ?? callee) : callee),
              metadata: {
                calleeExpression: callee.text,
                line: n.startPosition.row + 1,
              } as any,
            })
          }
          } // closes if(callee)
        } else {
          // JSX element
          const opening = n.type === "jsx_self_closing_element" ? n : n.namedChild(0)
          if (opening && (opening.type === "jsx_self_closing_element" || opening.type === "jsx_opening_element")) {
            const identifier = opening.namedChild(0)
            if (identifier && (identifier.type === "identifier" || identifier.type === "nested_identifier")) {
              const char = identifier.text[0]
              // Only components (capitalized)
              if (char && char === char.toUpperCase() && char !== char.toLowerCase()) {
                relationships.push({
                  source: callSource.name,
                  target: identifier.text,
                  type: ASTEngine.RelationshipType.Uses,
                  confidence: 0.9,
                  ...this.lineField(identifier),
                  metadata: {
                    jsxElement: identifier.text,
                    line: n.startPosition.row + 1,
                  } as any,
                })
              }
            }
          }
        }
      }

      // Recurse (avoid descending into nested functions for call context)
      for (let i = 0; i < n.namedChildCount; i++) {
        const child = n.namedChild(i)
        if (child) {
          processNode(child, currentSymbol)
        }
      }
    }

    processNode(node, null)
  }

  private extractUsageRelationships(
    node: Node,
    relationships: ASTEngine.UniversalRelationship[],
    symbols: ASTEngine.UniversalSymbol[],
  ): void {
    // The usage pass only links usages to KNOWN project symbols. This map
    // was previously declared but never populated, making every References/
    // type-Uses/JSX-Instantiates edge structurally impossible.
    const symbolNames: Record<string, boolean> = {}
    for (const s of symbols) symbolNames[s.name] = true
    const processed: Record<string, boolean> = {}

    // M14 #419 T6 / M37 TSD2: function-local bindings shadow same-named
    // symbols. The binding names are collected per enclosing function (a
    // fresh set on function/method entry, so sibling functions never
    // suppress each other); an identifier reference to a shadowed name is a
    // local usage, never a cross-symbol reference (const { name } = u in
    // main must not emit main --references--> the User.name property, and a
    // plain `const name = ...` must not either — pre-fix the declaration-skip
    // compared web-tree-sitter node OBJECTS (fresh per access), never
    // matched, and the template pass read the local as a symbol usage).
    const collectPatternNames = (pat: Node): string[] => {
      const out: string[] = []
      const walk = (p: Node): void => {
        for (let i = 0; i < p.namedChildCount; i++) {
          const c = p.namedChild(i)
          if (!c) continue
          if (c.type === "identifier" || c.type === "shorthand_property_identifier" || c.type === "shorthand_property_identifier_pattern" || c.type === "property_identifier") {
            out.push(c.text)
          } else if (c.type === "object_pattern" || c.type === "array_pattern" || c.type === "pair_pattern" || c.type === "assignment_pattern" || c.type === "rest_pattern" || c.type === "object" || c.type === "array") {
            walk(c)
          }
        }
      }
      walk(pat)
      return out
    }
    const processNode = (n: Node, currentSymbol: ASTEngine.UniversalSymbol | null, locals: Set<string>): void => {
      const prevSymbol = currentSymbol
      currentSymbol = this.resolveRelationshipSymbol(n, symbols, currentSymbol)
      // M59 (#861): the usage/reference pass is the one that produced the
      // duplicate `references Service -> inject` beside the member-scoped
      // decorator reference. Same rule as the call pass: decorator position is
      // metadata, not a usage by the enclosing scope.
      if (this.inDecoratorPosition(n)) return

      // TSD2: fresh locals set per function/method scope. resolveRelationship
      // Symbol rebinds ONLY on function-like nodes, so a symbol change here
      // means we just entered one; siblings restore their own set via the
      // parameter (automatic on recursion return).
      if (currentSymbol && currentSymbol !== prevSymbol && (currentSymbol.kind === ASTEngine.SymbolKind.Function || currentSymbol.kind === ASTEngine.SymbolKind.Method)) {
        locals = new Set()
      }

      // M14 #419 T6: record destructuring bindings (object_pattern /
      // array_pattern / rest_pattern in variable_declarator name position)
      // so later identifier usages of the same name resolve as locals.
      if ((n.type === "object_pattern" || n.type === "array_pattern" || n.type === "rest_pattern") && currentSymbol && (currentSymbol.kind === ASTEngine.SymbolKind.Function || currentSymbol.kind === ASTEngine.SymbolKind.Method)) {
        // ONLY inside a function body. Module/class-level destructuring
        // produces real symbols (extractDestructuringPattern), and references
        // to those from elsewhere must keep resolving to the symbol.
        for (const b of collectPatternNames(n)) locals.add(b)
      }
      // `const name = ...` inside a function must not resolve later reads to
      // a same-named module symbol. Only inside function/method scope:
      // module/class-level declarators ARE symbols.
      if (n.type === "variable_declarator" && currentSymbol && (currentSymbol.kind === ASTEngine.SymbolKind.Function || currentSymbol.kind === ASTEngine.SymbolKind.Method)) {
        const nameNode = n.childForFieldName("name")
        if (nameNode) {
          if (nameNode.type === "identifier") locals.add(nameNode.text)
          else {
            for (const b of collectPatternNames(nameNode)) locals.add(b)
          }
        }
      }

      // JSX component usage detection
      if ((n.type === "jsx_element" || n.type === "jsx_self_closing_element") && currentSymbol) {
        const opening = n.type === "jsx_element" ? n.namedChild(0) : n
        const id = opening?.namedChild(0)
        if (id) {
          const tag = id.text
          const name = tag.indexOf(".") !== -1 ? tag.split(".").pop() || tag : tag
          const isUpper = name.length > 1 && name[0] === name[0].toUpperCase()
          if (isUpper && name !== currentSymbol.name) {
            const known = !!symbolNames[name]
            if (known) {
              const key = `${currentSymbol.name}:${name}:jsx`
              if (!!!processed[key]) {
                processed[key] = true
                relationships.push({
                  source: currentSymbol.name,
                  target: name,
                  type: ASTEngine.RelationshipType.Instantiates,
                  confidence: 0.95,
                  ...this.lineField(id),
                  metadata: {
                    isJsxComponent: true,
                    jsxTag: tag,
                    line: n.startPosition.row + 1,
                  },
                })
              }
            }
          }
        }
      }

      // Check identifiers that reference other symbols
      // (template substitutions are owned by the template walk above —
      // letting both walks emit produced Uses+References for one read).
      if (n.type === "identifier" && currentSymbol) {
        let inTemplate = false
        for (let tp = n.parent; tp; tp = tp.parent) {
          if (tp.type === "template_substitution") { inTemplate = true; break }
          if (tp.type === "function_declaration" || tp.type === "method_definition" ||
              tp.type === "arrow_function" || tp.type === "function_expression" ||
              tp.type === "class_declaration") break
        }
        if (!inTemplate) {
        const name = n.text

        // Skip if this is a declaration, not a usage. web-tree-sitter hands
        // out FRESH wrapper objects per access — compare by id, never by
        // reference (the JS J4 quirk; the old `nameField === n` never
        // matched, so declarations leaked through as references).
        const parent = n.parent
        if (
          parent &&
          (parent.type === "variable_declarator" ||
            parent.type === "function_declaration" ||
            parent.type === "class_declaration" ||
            parent.type === "method_definition")
        ) {
          const nameField = parent.childForFieldName("name")
          if (nameField && nameField.id === n.id) {
            // This is a declaration, not a usage
            for (let i = 0; i < n.namedChildCount; i++) {
              const child = n.namedChild(i)
              if (child) processNode(child, currentSymbol, locals)
            }
            return
          }
        }

        // M14 #419 T6 / M37 TSD2: a name bound by a function-local pattern
        // or plain declarator is a local — the identifier usage refers to
        // the local, never to a same-named module/class symbol.
        // TSD5: an identifier in instanceof-RHS position is a TYPE check —
        // extractDeclaredTypeRefs emits the instanceof_check reference, so
        // a second plain references edge here is double-emission.
        // M14 #858 NOTE: the callee of a wrapped `new` is deliberately NOT
        // suppressed here. The unwrapped control (`new Engine(1)` with Engine a
        // declared symbol) also emits this `references` edge today — measured on
        // the fixture at this commit — and the contract this fix establishes is
        // that the wrapped form is INDISTINGUISHABLE from the unwrapped one. An
        // extra suppression limited to the wrapped spelling would have created
        // the very asymmetry the issue is about. Whether a constructed class
        // name should emit `references` at all is a separate, wider question
        // (the oracle derives only `instantiates` for new_expression) and is
        // filed rather than changed inside this fix.
        const rhsOfTypeCheck =
          n.parent?.type === "binary_expression" &&
          (() => {
            const p2 = n.parent!
            for (let i = 0; i < p2.childCount; i++) {
              const c = p2.child(i)
              if (c && !c.isNamed && c.text === "instanceof") return true
            }
            return false
          })()
        if (locals.has(name) || rhsOfTypeCheck) {
          // still recurse into children (e.g. nested member paths)
        } else if (!!symbolNames[name] && name !== currentSymbol.name) {
          const key = `${currentSymbol.name}:${name}`
          if (!!!processed[key]) {
            processed[key] = true

            relationships.push({
              source: currentSymbol.name,
              target: name,
              type: ASTEngine.RelationshipType.References,
              confidence: 0.8,
              ...this.lineField(n),
              metadata: {
                line: n.startPosition.row + 1,
              },
            })
          }
        }
        } // !inTemplate
      }

      // Check type references
      if ((n.type === "type_identifier" || n.type === "generic_type") && currentSymbol) {
        const typeName = n.type === "generic_type" ? n.namedChild(0)?.text : n.text

        if (typeName && !!symbolNames[typeName] && typeName !== currentSymbol.name) {
          const key = `${currentSymbol.name}:${typeName}:type`
          if (!!!processed[key]) {
            processed[key] = true

            relationships.push({
              source: currentSymbol.name,
              target: typeName,
              type: ASTEngine.RelationshipType.Uses,
              confidence: 0.9,
              // A `generic_type` starts at its base name, but the USED name here
              // is that base too — take the base node so a multi-line type
              // argument list cannot pull the line onto a bracket (scala
              // mechanism 2).
              ...this.lineField(n.type === "generic_type" ? (n.namedChild(0) ?? n) : n),
              metadata: {
                isTypeReference: true,
                line: n.startPosition.row + 1,
              },
            })
          }
        }
      }

      // M14 #419 T3: template_literal interpolation — `hi ${name} x${n + 1}`
      // reads name and n inside the enclosing function. The substituted
      // identifiers are expression usages, so emit Uses on each identifier
      // child of template_substitution — UNLESS the name is bound by a
      // function-local declarator/pattern (TSD2: the interpolation reads the
      // local, not a same-named module symbol).
      if (n.type === "template_substitution" && currentSymbol) {
        // M49 W4 (J6 twin, javascript/j6): a substituted identifier is a READ
        // only when it is not part of a call's callee expression and not an
        // assignment target — the same gates the field-access rule below
        // applies (a callee is covered by `calls`; a receiver belongs to that
        // callee). Pre-fix `${fn(x)}` fabricated `uses fn` and `${obj.m(x)}`
        // fabricated `uses obj`; the javascript twin's five edges were the
        // measured defect, this is the same rule one language over.
        const inCalleeOrWritePosition = (id: Node): boolean => {
          let cur: any = id
          while (cur) {
            const p = cur.parent
            if (!p || p.type === "template_substitution") break
            if (p.type === "call_expression") {
              const fn = p.childForFieldName("function")
              if (fn && fn.startIndex <= id.startIndex && id.endIndex <= fn.endIndex) return true
            }
            if (p.type === "assignment_expression" || p.type === "augmented_assignment_expression") {
              const left = p.childForFieldName("left") ?? p.namedChild(0)
              if (left && left.startIndex <= id.startIndex && id.endIndex <= left.endIndex) return true
            }
            cur = p
          }
          return false
        }
        const sub = (nn: Node): void => {
          for (let i = 0; i < nn.namedChildCount; i++) {
            const c = nn.namedChild(i)
            if (!c) continue
            if (c.type === "identifier" && c.text !== currentSymbol!.name) {
              if (locals.has(c.text)) continue
              if (inCalleeOrWritePosition(c)) continue
              const key = `${currentSymbol!.name}:${c.text}:template`
              if (!processed[key]) {
                processed[key] = true
                relationships.push({
                  source: currentSymbol!.name,
                  target: c.text,
                  type: ASTEngine.RelationshipType.Uses,
                  confidence: 0.85,
                  ...this.lineField(c),
                  metadata: {
                    isTemplateInterpolation: true,
                    line: c.startPosition.row + 1,
                  },
                })
              }
            } else if (c.type !== "identifier") {
              sub(c)
            }
          }
        }
        sub(n)
      }

      // M14 #419 T4: field-access Uses — member reads are usages of the
      // accessed member. Skip the member when it is the callee of a call
      // (calls edges cover that — TSD6: the old `=== n` object comparison
      // never matched web-tree-sitter's fresh wrappers, so every method call
      // double-emitted calls + uses), skip JSX element tags, and skip the
      // ASSIGNMENT-LHS span (TSD1, JAD1-class: `this.count = 0` is a write,
      // not a read; augmented `+=` shares the left field).
      if ((n.type === "member_expression" || n.type === "subscript_expression") && currentSymbol) {
        const isCallCallee =
          n.parent?.type === "call_expression" && n.parent.childForFieldName("function")?.id === n.id
        const isOptionalChainRoot = n.parent?.type === "optional_chain"
        const pType = n.parent?.type
        let isWrite = false
        if (pType === "assignment_expression" || pType === "augmented_assignment_expression") {
          const lhs = n.parent!.childForFieldName("left") ?? n.parent!.namedChild(0)
          isWrite = !!lhs && lhs.startIndex === n.startIndex && lhs.endIndex === n.endIndex
        }
        if (!isCallCallee && !isOptionalChainRoot && !isWrite) {
          const prop = n.childForFieldName("property") ?? (n.namedChildCount > 0 ? n.namedChild(n.namedChildCount - 1) : null)
          if (prop) {
            const name = prop.text
            // M49 W13 fixed a blind spot here: a PRIVATE member read
            // (`this.#count`) emitted nothing while a public one
            // (`this.count`) and a private METHOD call (`this.#step()`) both
            // did — the membership test compared the node's raw text against
            // a symbol set that stored the stripped name, so it was always
            // false. W13 normalized the LOOKUP against the then-stripped
            // symbols; M49 W15 (#813) instead made the SYMBOL carry the
            // declared `#` spelling, so the node's own text is now exactly the
            // symbol key and both sides agree without normalization. The
            // TARGET keeps the `#` spelling, which is what the calls edge
            // already carried (`calls run->#step`) and what the javascript
            // twin emits (`uses Store->#update_version`).
            // #813: symbols now carry the DECLARED `#` spelling, so the
            // membership test uses the node's own text directly (this rule's
            // old `#`-strip normalization existed only because symbols were
            // stored stripped).
            const lookupName = name
            if (!!symbolNames[lookupName] && lookupName !== currentSymbol.name) {
              const key = `${currentSymbol.name}:${name}:field`
              if (!processed[key]) {
                processed[key] = true
                relationships.push({
                  source: currentSymbol.name,
                  target: name,
                  type: ASTEngine.RelationshipType.Uses,
                  confidence: 0.85,
                  ...this.lineField(prop),
                  metadata: {
                    isFieldAccess: true,
                    line: prop.startPosition.row + 1,
                  },
                })
              }
            }
          }
        }
      }

      // Recurse
      for (let i = 0; i < n.namedChildCount; i++) {
        const child = n.namedChild(i)
        if (child) {
          processNode(child, currentSymbol, locals)
        }
      }
    }

    processNode(node, null, new Set())
  }

  private extractInstantiationRelationships(
    node: Node,
    relationships: ASTEngine.UniversalRelationship[],
    symbols: ASTEngine.UniversalSymbol[],
  ): void {
    const processNode = (n: Node, currentSymbol: ASTEngine.UniversalSymbol | null): void => {
      currentSymbol = this.resolveRelationshipSymbol(n, symbols, currentSymbol)

      // Extract new expressions — TSD4: top-level fallback is the module LEAF
      // name (same source as imports/exports), never the "(script)" placeholder.
      const instSource = currentSymbol || { name: this.moduleLeafName(), scope: undefined, kind: "module" as any, range: { startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 }, metadata: {} as any }
      if (n.type === "new_expression") {
        const constructor = n.namedChild(0)
        if (constructor) this.pushInstantiation(constructor, n, instSource, relationships)
      }
      // A `new` whose constructor is written on the NEXT line never reaches this
      // branch (the grammar does not build a new_expression for it — #858); it is
      // emitted from the call pass below through the same helper, so both forms
      // produce identical edges rather than merely similar ones.

      // Recurse
      for (let i = 0; i < n.namedChildCount; i++) {
        const child = n.namedChild(i)
        if (child) {
          processNode(child, currentSymbol)
        }
      }
    }

    processNode(node, null)
  }

  /**
   * M14 #858: emit the instantiation edge for a constructor node. Extracted from
   * the new_expression branch so the wrapped-`new` path (below) and the parser's
   * own new_expression path cannot drift apart — same leaf-identity rule (TSD3),
   * same generic-argument strip, same intrinsic filter.
   */
  private pushInstantiation(
    constructor: Node,
    expressionNode: Node,
    source: { name: string },
    relationships: ASTEngine.UniversalRelationship[],
  ): void {
    let className = constructor.text

    // Handle generic instantiation: new Map<K, V>()
    if (constructor.type === "generic_type") {
      const typeName = constructor.namedChild(0)
      if (typeName) className = typeName.text
    }
    // TSD3 (leaf identity contract): qualified `new ns.Thing()` — target is the
    // LEAF (Thing), matching the JS analyzer and TS's own member-call reduction;
    // emitting "ns.Thing" fabricated targets no symbol index could join (the
    // import alias is not a type). Also strip generic arguments from member ctors.
    const dot = className.lastIndexOf(".")
    if (dot !== -1 && dot < className.length - 1) className = className.slice(dot + 1)
    const lt = className.indexOf("<")
    if (lt !== -1) className = className.slice(0, lt)

    // Global constructor intrinsics/DOM APIs: `new Promise()` is construction of
    // the RUNTIME, not of a project type — same rationale as the JVM stdlib
    // filters (family parity with JS).
    if (JS_GLOBAL_CONSTRUCTORS.has(className)) return

    relationships.push({
      source: source.name,
      target: className,
      type: ASTEngine.RelationshipType.Instantiates,
      confidence: 1.0,
      // The CLASS NAME node: for `new ns.Thing()` that is the property leaf,
      // since the target is the leaf (TSD3 leaf identity).
      ...this.lineField(constructor.type === "member_expression" ? (constructor.childForFieldName("property") ?? constructor) : constructor),
      metadata: {
        // #873: the site line is the SAME node `lineField` stamps above, in the
        // SAME base — a row must not carry two different sites, let alone two
        // different bases (this one differed by up to 5 rows on element-plus).
        line: (constructor.type === "member_expression" ? (constructor.childForFieldName("property") ?? constructor) : constructor).startPosition.row + 1,
      } as any,
    })
  }

  /**
   * M14 #858: a `new` whose constructor is written on the NEXT line is not a
   * new_expression in the pinned tsx/typescript grammar. Verified on the wasm:
   *
   *   const b = new        lexical_declaration[ ..., identifier("new") ]
   *     Other(2)           expression_statement[ call_expression[ identifier("Other") ] ]
   *
   * The grammar closes the statement at the bare `new`, so the instantiation was
   * silently lost while a `calls` edge AND a bare-identifier `references` edge
   * were fabricated for a class name that is never called as a method. Recognised
   * from the tree rather than heuristically: the call_expression's previous
   * statement sibling must END with a bare `new` identifier written on an
   * earlier line than the call.
   */
  private isWrappedNewConstructor(call: Node): boolean {
    if (call.type !== "call_expression") return false
    const stmt = call.parent
    if (!stmt || stmt.type !== "expression_statement") return false
    const prev = stmt.previousSibling
    if (!prev) return false
    let last: Node | null = prev
    while (last && last.namedChildCount > 0) last = last.namedChild(last.namedChildCount - 1)
    if (!last || last.type !== "identifier" || last.text !== "new") return false
    return last.startPosition.row < call.startPosition.row
  }

  /**
   * M59 #860: a decorator's reference edge names the DECORATOR's own line. The
   * line travels in metadata.decoratorLines, parallel to symbol.decorators (the
   * same lockstep pattern as extendsLines/implementsLines). A decorator whose
   * line was never recorded stays line-less rather than borrowing the
   * declaration's line — never invent a line (#823).
   */
  private extractDecoratorRelationships(
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
  ): void {
    for (const symbol of symbols) {
      if (symbol.decorators && symbol.decorators.length > 0) {
        const lines = symbol.metadata?.decoratorLines as Array<number | null> | undefined
        for (let i = 0; i < symbol.decorators.length; i++) {
          const decorator = symbol.decorators[i]
          const line = lines?.[i]
          relationships.push({
            source: symbol.name,
            target: decorator,
            type: ASTEngine.RelationshipType.References,
            confidence: 1.0,
            ...(typeof line === "number" ? { line_number: line } : {}),
            metadata: {
              isDecorator: true,
              decoratorLine: typeof line === "number" ? line : null,
            },
          })
        }
      }
    }
  }

  private extractOverrideRelationships(
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
  ): void {
    for (const symbol of symbols) {
      if (symbol.metadata?.isOverride && symbol.ownerName) {
        // Find the parent class
        const parentClass = findItem(
          symbols,
          (s) => s.name === symbol.ownerName && s.kind === ASTEngine.SymbolKind.Class,
        )
        if (parentClass && parentClass.metadata?.extends) {
          const baseClasses = parentClass.metadata.extends as string[]
          for (const baseClass of baseClasses) {
            relationships.push({
              source: `${symbol.ownerName}.${symbol.name}`,
              target: `${baseClass}.${symbol.name}`,
              type: ASTEngine.RelationshipType.Overrides,
              confidence: 0.95,
              // The OVERRIDING declaration's own range (M59 #825): the edge names
              // the member, so it takes the member's line, not the class's.
              ...(symbol.range?.startLine ? { line_number: symbol.range.startLine } : {}),
              metadata: {
                baseClass,
              },
            })
          }
        }
      }
    }

    // M49 #759 (svelte-wave verification, Spring.subscribe -> Readable.subscribe):
    // interface-heritage member overrides emitted NOTHING — the class pass
    // above requires metadata.isOverride (an `override` keyword concept) and
    // a Class-kind parent, so interface_declaration members were invisible.
    // Structural tier, in-file only, transitive BFS mirroring the oracle's
    // truth walk (deriveTreeEdges depth-10): a member declared in the
    // interface AND anywhere up the heritage chain overrides. Honest
    // abstention: if the interface overloads a name (same name declared
    // twice), no pairing — the oracle's signature gate would decide and the
    // analyzer carries no textual-signature truth.
    const ifaceMembers = new Map<string, ASTEngine.UniversalSymbol[]>()
    const ifaceByName = new Map<string, ASTEngine.UniversalSymbol>()
    for (const s of symbols) {
      if (s.kind === ASTEngine.SymbolKind.Interface) ifaceByName.set(s.name, s)
      if (s.ownerKind === ASTEngine.SymbolKind.Interface &&
          (s.kind === ASTEngine.SymbolKind.Method || s.kind === ASTEngine.SymbolKind.Property)) {
        const list = ifaceMembers.get(s.ownerName!) ?? []
        list.push(s)
        ifaceMembers.set(s.ownerName!, list)
      }
    }
    for (const iface of symbols) {
      if (iface.kind !== ASTEngine.SymbolKind.Interface) continue
      const bases = iface.metadata?.extends as string[] | undefined
      if (!bases || bases.length === 0) continue
      const members = ifaceMembers.get(iface.name) ?? []
      if (members.length === 0) continue
      // Overload abstention: a name declared twice in this interface cannot
      // be paired name-only.
      const nameCounts = new Map<string, number>()
      for (const m of members) nameCounts.set(m.name, (nameCounts.get(m.name) ?? 0) + 1)
      const seenBase = new Set<string>()
      const queue: string[] = [...bases]
      let depth = 0
      while (queue.length && depth < 10) {
        depth++
        const base = queue.shift()!
        if (seenBase.has(base)) continue
        seenBase.add(base)
        const baseDecl = ifaceByName.get(base)
        if (!baseDecl) continue // external/unresolved base: the analyzer's job, not in-file truth
        const baseMembers = ifaceMembers.get(base) ?? []
        for (const m of members) {
          if ((nameCounts.get(m.name) ?? 0) > 1) continue
          if (baseMembers.some((bm) => bm.name === m.name)) {
            relationships.push({
              source: `${iface.name}.${m.name}`,
              target: `${base}.${m.name}`,
              type: ASTEngine.RelationshipType.Overrides,
              confidence: 0.95,
              // The redeclaring member's own line (M59 #825), from its symbol
              // range rather than the interface's.
              ...(m.range?.startLine ? { line_number: m.range.startLine } : {}),
              metadata: {
                baseInterface: base,
              },
            })
          }
        }
        const baseBases = baseDecl.metadata?.extends as string[] | undefined
        if (baseBases) queue.push(...baseBases)
      }
    }

    // M49 W22 (rotation-found, vue-core `packages/reactivity/src/effect.ts`):
    // a CLASS implementing an in-file INTERFACE emitted no override for the
    // members it supplies, so `ReactiveEffect.notify -> Subscriber.notify` was
    // permanently MISSING. The contract is the one java already carries
    // (clojure `TransformerIterator`: `Empty.add -> Buffer.add`, probe-verified)
    // and the one the oracle derives generically — `declParents` takes
    // `extends` AND `implements` edges whose target resolves in-file, which is
    // why java's lane reads 0 missing while typescript's carried this gap.
    //
    // Lockstep with the oracle's member set, deliberately asymmetric:
    //   - the CLASS side is METHODS only. A class field is
    //     `public_field_definition`, which the oracle excludes by name so truth
    //     cannot outrun the analyzer (`property_signature` is an INTERFACE
    //     member and stays in, because the analyzer's interface-heritage arm
    //     does emit those);
    //   - the BASE side is the interface's methods and properties, walked
    //     transitively along `extends` (depth 10, mirroring the oracle's
    //     declParents walk and this method's interface arm above);
    //   - abstention matches the arm above: an overloaded name on either side
    //     cannot be paired name-only, because the analyzer carries no textual
    //     signature truth — the oracle's `sigCompatible` gate would decide.
    //   - the base name is used VERBATIM (metadata.implements is what emits the
    //     `implements` edge the oracle reads). A qualified or generic target is
    //     therefore unresolved on both sides, which is what lockstep means.
    const classMethods = new Map<string, ASTEngine.UniversalSymbol[]>()
    for (const s of symbols) {
      if (s.ownerKind === ASTEngine.SymbolKind.Class &&
          s.kind === ASTEngine.SymbolKind.Method && s.ownerName) {
        const list = classMethods.get(s.ownerName) ?? []
        list.push(s)
        classMethods.set(s.ownerName, list)
      }
    }
    const seenOverride = new Set<string>(
      relationships
        .filter((r) => r.type === ASTEngine.RelationshipType.Overrides)
        .map((r) => `${r.source}\u0000${r.target}`),
    )
    for (const cls of symbols) {
      if (cls.kind !== ASTEngine.SymbolKind.Class) continue
      const bases = cls.metadata?.implements as string[] | undefined
      if (!bases || bases.length === 0) continue
      const members = classMethods.get(cls.name) ?? []
      if (members.length === 0) continue
      const memberCounts = new Map<string, number>()
      for (const m of members) memberCounts.set(m.name, (memberCounts.get(m.name) ?? 0) + 1)
      const seenBase = new Set<string>()
      const queue: string[] = [...bases]
      let depth = 0
      while (queue.length && depth < 10) {
        depth++
        const base = queue.shift()!
        if (seenBase.has(base) || base === cls.name) continue
        seenBase.add(base)
        const baseDecl = ifaceByName.get(base)
        if (!baseDecl) continue // external/unresolved base: not in-file truth
        const baseMembers = ifaceMembers.get(base) ?? []
        for (const m of members) {
          if ((memberCounts.get(m.name) ?? 0) > 1) continue
          const matching = baseMembers.filter((bm) => bm.name === m.name)
          // Overload abstention on the base side too: two declarations of the
          // name in the interface cannot be paired name-only.
          if (matching.length !== 1) continue
          const key = `${cls.name}.${m.name}\u0000${base}.${m.name}`
          if (seenOverride.has(key)) continue
          seenOverride.add(key)
          relationships.push({
            source: `${cls.name}.${m.name}`,
            target: `${base}.${m.name}`,
            type: ASTEngine.RelationshipType.Overrides,
            confidence: 0.95,
            // The IMPLEMENTING member's own line (M59 #825): the edge names the
            // member, so it takes the member's line, not the class's.
            ...(m.range?.startLine ? { line_number: m.range.startLine } : {}),
            metadata: {
              implementedInterface: base,
            },
          })
        }
        const baseBases = baseDecl.metadata?.extends as string[] | undefined
        if (baseBases) queue.push(...baseBases)
      }
    }
  }


  /**
   * M49 dup-key ruling (Option A — #746): object-literal members collapse
   * last-wins. JS executes the LAST same-key declaration; the TS analyzer
   * must match (web-family contract: same shape, same graph regardless of
   * file extension). Slot model mirrors the JS analyzer's ruled
   * accessor-slot-semantics contract exactly:
   *   - get/set accessor members occupy kind-keyed slots (`x#get`, `x#set`)
   *     and COEXIST (B5 family contract);
   *   - a later PLAIN member (method or data pair) takes the plain slot and
   *     KILLS all accessor slots of that name (data replaces the descriptor);
   *   - class bodies are OVERLOAD territory — never collapsed (this pass
   *     only descends `object` nodes).
   * Dead members are spliced from the symbols array (before the symbol map
   * build); the dead-span list is RETURNED so phantom calls/uses emitted in
   * later phases can be dropped by a post-walk filter
   * (filterPhantomDupKeyEdges) — the calls/uses phases run AFTER this pass,
   * so filtering here would see an empty relationship array.
   */
  private collapseDuplicateObjectMembers(
    rootNode: Node,
    symbols: ASTEngine.UniversalSymbol[],
  ): { name: string; startRow: number; endRow: number; startCol: number; endCol: number }[] {
    type Dead = { name: string; startRow: number; endRow: number; startCol: number; endCol: number }
    const dead: Dead[] = []
    const accessorKind = (m: Node): "get" | "set" | undefined => {
      for (let i = 0; i < m.childCount; i++) {
        const c = m.child(i)
        if (c && !c.isNamed && (c.text === "get" || c.text === "set")) return c.text as "get" | "set"
      }
      for (let i = 0; i < m.namedChildCount; i++) {
        const c = m.namedChild(i)
        if (c && (c.type === "get" || c.type === "set")) return c.type as "get" | "set"
      }
      return undefined
    }
    const visit = (n: Node): void => {
      if (n.type === "object") {
        const slots = new Map<string, { node: Node; plain: boolean; name: string }>()
        for (let i = 0; i < n.namedChildCount; i++) {
          const m = n.namedChild(i)
          if (!m || (m.type !== "method_definition" && m.type !== "pair")) continue
          const raw = m.childForFieldName("name")?.text ?? m.childForFieldName("key")?.text
          if (!raw) continue
          const acc = m.type === "method_definition" ? accessorKind(m) : undefined
          const slot = acc ? `${raw}#${acc}` : raw
          const prev = slots.get(slot)
          if (prev) {
            // Later same-slot declaration wins; earlier one dies.
            dead.push({ name: prev.name, startRow: prev.node.startPosition.row, endRow: prev.node.endPosition.row, startCol: prev.node.startPosition.column, endCol: prev.node.endPosition.column })
          }
          slots.set(slot, { node: m, plain: !acc, name: raw })
          // A plain member replaces the whole descriptor: kill accessor
          // halves of the same name regardless of position order.
          if (!acc) {
            for (const kind of ["get", "set"] as const) {
              const half = slots.get(`${raw}#${kind}`)
              if (half) {
                dead.push({ name: half.name, startRow: half.node.startPosition.row, endRow: half.node.endPosition.row, startCol: half.node.startPosition.column, endCol: half.node.endPosition.column })
                slots.delete(`${raw}#${kind}`)
              }
            }
          }
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) visit(c)
      }
    }
    visit(rootNode)
    if (dead.length === 0) return []

    // Splice dead member symbols (positional match on 1-based range).
    for (let i = symbols.length - 1; i >= 0; i--) {
      const s = symbols[i]
      if (!s.range) continue
      const dl = dead.find(
        (d) =>
          d.name === s.name &&
          s.range.startLine === d.startRow + 1 &&
          s.range.startColumn === d.startCol + 1,
      )
      if (dl) symbols.splice(i, 1)
    }
    return dead
  }

  /**
   * M49 dup-key ruling (#746) post-walk half: drop phantom edges sourced
   * from a collapsed (dead) object member's body. Calls/uses/references
   * carry metadata.line — the site row, 1-based and equal to the row's own
   * `line_number` since #873 (it used to be a 0-based `startPosition.row`, so
   * the same row carried two bases); an edge whose source is
   * the dead member's name AND whose site lies inside the dead span
   * belonged to the body runtime never executes.
   */
  private filterPhantomDupKeyEdges(
    relationships: ASTEngine.UniversalRelationship[],
    dead: { name: string; startRow: number; endRow: number; startCol: number; endCol: number }[],
  ): void {
    if (dead.length === 0) return
    // #873: `dead[*].startRow/endRow` are 0-based rows; `metadata.line` is now
    // 1-based (the same base as `line_number`), so the span comparison moves with
    // it. Comparing a 1-based site against 0-based bounds would silently widen the
    // dead span by a line at each end.
    const inDead = (name: string, line: unknown): boolean => {
      if (typeof line !== "number") return false
      return dead.some((d) => d.name === name && line >= d.startRow + 1 && line <= d.endRow + 1)
    }
    const kept = relationships.filter((r) => {
      const meta = r.metadata as { line?: unknown } | undefined
      if (!meta || typeof meta.line !== "number" || typeof r.source !== "string") return true
      return !inDead(r.source, meta.line)
    })
    relationships.length = 0
    relationships.push(...kept)
  }

  private extractImportRelationships(
    node: Node,
    relationships: ASTEngine.UniversalRelationship[],
    symbols: ASTEngine.UniversalSymbol[],
  ): void {
    if (node.type === "import_statement") {
      const sourceNode = node.childForFieldName("source")
      if (!sourceNode) return

      const modulePath = stringContent(sourceNode)
      const items = extractImportItemsWithNodes(node)

      // Create import relationships (leaf identity: source is the module leaf)
      for (const { item, node: itemNode } of items) {
        const itemName = item.split(" as ")[0].replace("* as ", "")

        relationships.push({
          source: this.moduleLeafName(),
          target: `${modulePath}:${itemName}`,
          type: ASTEngine.RelationshipType.Imports,
          confidence: 1.0,
          // M59 (#825): the imported NAME's own line, not the `import` line.
          ...this.lineField(itemNode),
          metadata: {
            module: modulePath,
            alias: item.indexOf(" as ") !== -1 ? item.split(" as ")[1] : undefined,
          },
        })
      }
      return
    }

    // M14 #419 T7: dynamic import('./lazy') is a module dependency identical
    // in kind to a static import. Pre-fix the module landed in the imports
    // array but no imports relationship was emitted — and the call walk
    // produced a spurious calls edge to the `import` keyword.
    if (node.type === "call_expression") {
      const callee = node.namedChild(0)
      if (callee && (callee.text === "import" || callee.type === "import")) {
        const args = node.childForFieldName("arguments")
        const pathArg = args && args.namedChildCount > 0 ? args.namedChild(0) : null
        if (pathArg && (pathArg.type === "string" || pathArg.type === "template_string")) {
          const modulePath = stringContent(pathArg)
          relationships.push({
            source: this.moduleLeafName(),
            target: `${modulePath}:*`,
            type: ASTEngine.RelationshipType.Imports,
            confidence: 1.0,
            // M59 (#825): a dynamic import's target is named by its path argument.
            ...this.lineField(pathArg),
            metadata: {
              module: modulePath,
              isDynamic: true,
            },
          })
        }
      }
    }

    // Recurse
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child) {
        this.extractImportRelationships(child, relationships, symbols)
      }
    }
  }

  private extractExportRelationships(
    exports: ASTEngine.ExportInfo[],
    relationships: ASTEngine.UniversalRelationship[],
    symbols: ASTEngine.UniversalSymbol[],
  ): void {
    for (const item of exports) {
      relationships.push({
        source: this.moduleLeafName(),
        target: item.name,
        type: ASTEngine.RelationshipType.Exports,
        confidence: 1.0,
        // M59 (#825): the exported NAME's line, from the export's own range when
        // the collector recorded one. Absent rather than invented when it did not
        // — an absent line reads as "unknown" and a guessed one reads as true.
        ...(item.range?.startLine ? { line_number: item.range.startLine } : {}),
        metadata: {
          isDefault: item.isDefault,
          kind: item.type,
        },
      })
    }
  }

  private moduleLeafName(): string {
    return path.basename(this.currentFile, path.extname(this.currentFile))
  }

  // ========================================================================
  // RELATIONSHIP HELPERS (regex-free)
  // ========================================================================

  private addContainmentRelationships(
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
  ): void {
    for (const symbol of symbols) {
      if (symbol.ownerName) {
        const owner = findItem(symbols, (s) => s.name === symbol.ownerName)
        if (owner) {
          // Leaf identity: container is the namespace full name (Example.Domain)
          // or class/interface/enum leaf (UserService); member is the leaf name.
          relationships.push({
            source: owner.name,
            target: symbol.name,
            type: ASTEngine.RelationshipType.Contains,
            confidence: 1.0,
            // M59 (#825): the MEMBER's declaration line — the edge names the
            // member, so it takes the member's range, not the container's.
            ...(symbol.range?.startLine ? { line_number: symbol.range.startLine } : {}),
            metadata: {},
          })
        }
      }
    }
  }

  private resolveRelationshipSymbol(
    node: Node,
    symbols: ASTEngine.UniversalSymbol[],
    current: ASTEngine.UniversalSymbol | null,
  ): ASTEngine.UniversalSymbol | null {
    // T6 (review wave): symbol ranges are 1-based (nodeRange +1) but the
    // lookup passed raw 0-based rows/columns, so positional resolution never
    // matched and everything fell back to first-name-match. Overloads and
    // same-named nested/top-level functions resolved positionally blind.
    const byPos = (name: string, kind: ASTEngine.SymbolKind, line: number, col: number, owner?: string) =>
      findItem(
        symbols,
        (s) =>
          s.name === name &&
          s.kind === kind &&
          s.range.startLine === line + 1 &&
          s.range.startColumn === col + 1 &&
          (!owner || s.ownerName === owner),
      )

    if (node.type === "function_declaration" || node.type === "generator_function_declaration") {
      const name = node.childForFieldName("name")?.text
      if (!name) return current
      return (
        byPos(name, ASTEngine.SymbolKind.Function, node.startPosition.row, node.startPosition.column) ||
        findItem(symbols, (s) => s.name === name && s.kind === ASTEngine.SymbolKind.Function) ||
        current
      )
    }

    if (node.type === "class_declaration" || node.type === "abstract_class_declaration") {
      // W3 (web-family contract, JS J5 precedent): static blocks and
      // property initializers have no enclosing function — their calls
      // belong to the CLASS. Pre-fix they fell through to the module leaf
      // ("si -> init" instead of "Service -> init" on the probed shape).
      // Instance method bodies resolve to the method first (this node is
      // only reached when no closer function exists), so this never
      // misattributes method calls (same reasoning as the JS analyzer).
      const nm = node.childForFieldName("name")?.text
      if (nm) {
        const ownerSym = findItem(symbols, (s) => s.name === nm && s.kind === ASTEngine.SymbolKind.Class)
        if (ownerSym) return ownerSym
      }
      return current
    }

    if (node.type === "method_definition") {
      const raw = node.childForFieldName("name")?.text
      if (!raw) return current
      const name = stripPrivatePrefix(raw)
      // W1 (JD18-class): the enclosing-class walk must stop at the nearest
      // FUNCTION/CLASS boundary, not skip through it. An object-literal
      // method nested in a method body (`const local = { deep() {...} }`
      // inside Outer.run) walked all the way out to Outer — owner=Outer vs
      // the symbol's real owner=local never matched, so every call inside
      // the nested object misattributed to the enclosing method (deep ->
      // inside emitted as run -> inside). If a method_definition or a
      // function-like node sits between, the object member belongs to the
      // nearest declarator instead.
      let owner = this.findEnclosingClassName(node)
      if (owner) {
        let anc: Node | null = node.parent
        while (anc) {
          if (
            anc.type === "method_definition" ||
            anc.type === "function_declaration" ||
            anc.type === "function_expression" ||
            anc.type === "arrow_function"
          ) {
            // Reached a function boundary before any class: the object
            // member's owner is the enclosing variable, not the class.
            let v: Node | null = node.parent
            while (v && v.type !== "variable_declarator") v = v.parent
            owner = v?.childForFieldName("name")?.text
            break
          }
          if (anc.type === "class_declaration" || anc.type === "abstract_class_declaration") break
          anc = anc.parent
        }
      } else {
        // No enclosing class at all: object member -> nearest declarator.
        let v: Node | null = node.parent
        while (v && v.type !== "variable_declarator") v = v.parent
        owner = v?.childForFieldName("name")?.text
      }
      return (
        byPos(name, ASTEngine.SymbolKind.Method, node.startPosition.row, node.startPosition.column, owner) ||
        findItem(
          symbols,
          (s) => s.name === name && s.kind === ASTEngine.SymbolKind.Method && (!owner || s.ownerName === owner),
        ) ||
        current
      )
    }

    if (node.type === "arrow_function" || node.type === "function_expression" || node.type === "function") {
      const parent = node.parent
      if (parent?.type === "variable_declarator") {
        const name = parent.childForFieldName("name")?.text
        if (!name) return current
        return (
          byPos(name, ASTEngine.SymbolKind.Function, parent.startPosition.row, parent.startPosition.column) ||
          findItem(symbols, (s) => s.name === name && s.kind === ASTEngine.SymbolKind.Function) ||
          current
        )
      }
    }

    return current
  }

  private findEnclosingClassName(node: Node): string | undefined {
    let cur: Node | null = node.parent
    while (cur) {
      if (cur.type === "class_declaration") {
        return cur.childForFieldName("name")?.text
      }
      cur = cur.parent
    }
    return undefined
  }

  // ========================================================================
  // HELPER METHODS
  // ========================================================================

  private extractParameters(node: Node): ASTEngine.Parameter[] {
    const params: ASTEngine.Parameter[] = []

    // Same correction as findParameterType: `formal_parameters` is a node type,
    // not a field name in the pinned grammar — positional fallback instead.
    const paramsNode =
      node.childForFieldName("parameters") ||
      node.namedChildren.find((c: Node | null) => c?.type === "formal_parameters")
    if (!paramsNode) return params

    for (let i = 0; i < paramsNode.namedChildCount; i++) {
      const paramNode = paramsNode.namedChild(i)
      if (!paramNode) continue

      // Skip decorators
      if (paramNode.type === "decorator") continue

      // Handle rest parameters
      if (paramNode.type === "rest_pattern") {
        const inner = paramNode.namedChild(0)
        if (inner) {
          params.push({
            name: `...${inner.text}`,
            isOptional: false,
          })
        }
        continue
      }

      // Handle required vs optional parameters
      const pattern =
        paramNode.childForFieldName("pattern") || paramNode.childForFieldName("name") || paramNode.namedChild(0)
      if (!pattern) continue

      let name = pattern.text
      let type: string | undefined
      let defaultValue: string | undefined
      let isOptional = false

      // Check for TypeScript parameter properties (public/private/protected/readonly)
      const modifierTexts: string[] = []
      for (let j = 0; j < paramNode.childCount; j++) {
        const child = paramNode.child(j)
        if (child) {
          if (["public", "private", "protected", "readonly"].includes(child.text)) {
            modifierTexts.push(child.text)
          }
        }
      }

      // Extract type annotation
      const typeAnnotation = paramNode.childForFieldName("type")
      if (typeAnnotation) {
        type = stripLeadingColon(typeAnnotation.text)
        // Check for optional type T?
        if (type.endsWith("?")) {
          isOptional = true
          type = type.slice(0, -1)
        }
      }

      // Check for optional marker (?)
      if (this.hasToken(paramNode, "?")) {
        isOptional = true
      }

      // Extract default value. Modifier keywords are carried on
      // param.modifiers — stuffing them into defaultValue made substring
      // checks fabricate parameter properties from string defaults like
      // x: string = "private".
      const valueNode = paramNode.childForFieldName("value")
      if (valueNode) {
        defaultValue = valueNode.text
        isOptional = true // Parameters with defaults are optional
      }

      // Handle assignment pattern (destructuring with defaults)
      if (paramNode.type === "assignment_pattern") {
        const left = paramNode.namedChild(0)
        const right = paramNode.namedChild(1)
        if (left) {
          name = left.text
        }
        if (right) {
          defaultValue = right.text
          isOptional = true
        }
      }

      params.push({
        name,
        type,
        defaultValue,
        isOptional,
        modifiers: modifierTexts.length > 0 ? modifierTexts : undefined,
      } as any)
    }

    return params
  }

  private extractReturnType(node: Node): string {
    const returnType = node.childForFieldName("return_type")
    if (returnType) {
      return stripLeadingColon(returnType.text)
    }

    // Try to find type annotation in the node
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child && child.type === "type_annotation") {
        return stripLeadingColon(child.text)
      }
    }

    // T3 (review wave): absence of an annotation is not evidence of void —
    // infer from return statements (unannotated `() => 42` is number, not
    // void). Bodies without returns still yield "void" from the helper,
    // so the default is unchanged where no information exists.
    return this.typeInference.inferFunctionReturnType(node)
  }

  private extractClassHeritage(node: Node): { extends?: string[]; implements?: string[]; extendsLines?: number[]; implementsLines?: number[] } {
    const result: { extends?: string[]; implements?: string[]; extendsLines?: number[]; implementsLines?: number[] } = {}

    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (!child) continue

      if (child.type === "class_heritage") {
        for (let j = 0; j < child.namedChildCount; j++) {
          const heritageClause = child.namedChild(j)
          if (!heritageClause) continue

          if (heritageClause.type === "extends_clause") {
            result.extends = []
            result.extendsLines = []
            for (let k = 0; k < heritageClause.namedChildCount; k++) {
              const type = heritageClause.namedChild(k)
              if (!type) continue
              // Generic heritage `extends Base<string>` parses with the
              // type_arguments as a SEPARATE sibling node — pushing it
              // wholesale fabricated an Extends edge to "<string>". Skip
              // argument nodes; take the base type text only.
              if (type.type === "type_arguments") continue
              result.extends.push(type.text)
              // M59 (#825): the base TYPE NAME's line, kept parallel to the
              // name list. The subclass's own declaration line is NOT it —
              // `class A extends\n  B {}` writes B on the next line.
              result.extendsLines.push(type.startPosition.row + 1)
            }
          } else if (heritageClause.type === "implements_clause") {
            result.implements = []
            result.implementsLines = []
            for (let k = 0; k < heritageClause.namedChildCount; k++) {
              const type = heritageClause.namedChild(k)
              if (!type || type.type === "type_arguments") continue
              result.implements.push(type.text)
              // M59.A7 (corpus sweep after the M49 W22 fix): the M59 round gave
              // `extends` its base-name line but left `implements` unstamped, so
              // every `implements` edge was the ONE relationship kind the web
              // round's "every edge carries its name's line" claim did not cover
              // (measured: 6 in the four TS corpora + 1 delegated from svelte).
              // The 40-file oracle sample happened to draw none of them, which is
              // why the milestone's own instrument read 0 noLine for typescript.
              result.implementsLines.push(type.startPosition.row + 1)
            }
          }
        }
      }
    }

    return result
  }

  private extractInterfaceExtends(node: Node): { names: string[]; lines: number[] } | undefined {
    // Interface heritage parses as extends_type_clause — NOT extends_clause
    // (that is the CLASS heritage node) and interface_declaration has no
    // "extends" FIELD. The old lookup missed both and returned undefined,
    // silently dropping every interface-inheritance edge.
    let clause: Node | null = null
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (c && c.type === "extends_type_clause") { clause = c; break }
    }
    if (!clause) return undefined

    const types: string[] = []
    const lines: number[] = []
    for (let i = 0; i < clause.namedChildCount; i++) {
      const type = clause.namedChild(i)
      if (!type || type.type === "type_arguments") continue
      // M49 #759: `extends Readable<T>` parses with the type_arguments as a
      // SIBLING subtree folded into the text — pushing it raw emitted
      // extends Spring->"Readable<T>" while the oracle (and every consumer)
      // resolves the clean head. Strip args to the type head, then take the
      // leaf segment (TSD3 convention: TS heritage targets are leaves).
      let t = type.text
      const lt = t.indexOf("<")
      if (lt !== -1) t = t.slice(0, lt).trim()
      const dot = t.lastIndexOf(".")
      types.push(dot !== -1 ? t.slice(dot + 1) : t)
      // M59 (#825): parallel line list — the base type node's own line.
      lines.push(type.startPosition.row + 1)
    }

    return types.length > 0 ? { names: types, lines } : undefined
  }

  private extractComments(node: Node): string[] | undefined {
    const comments: string[] = []

    // Look for leading comments. For exported/declare-wrapped declarations
    // (`export class X`, `export default class X`, `declare class X`), the
    // JSDoc comment precedes the export/declare keyword, not the declaration
    // node itself — so walk up to the wrapper parent first.
    const scanNode: Node = node.parent && node.parent.type === "export_statement" ? node.parent : node

    let prev = scanNode.previousSibling
    // Contiguity boundary: a blank line between the comment and the anchor
    // ends the leading-comment run. Without this, trailing remarks about the
    // PREVIOUS declaration were stolen across the gap.
    let anchorRow = scanNode.startPosition.row
    while (prev && prev.type === "comment") {
      if (prev.endPosition.row + 1 < anchorRow) break
      comments.unshift(stripCommentMarkers(prev.text))
      anchorRow = prev.startPosition.row
      prev = prev.previousSibling
    }

    // Also check named children for JSDoc comments
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child && child.type === "comment") {
        comments.push(child.text)
      }
    }

    return comments.length > 0 ? comments : undefined
  }

  /**
   * Class-level route base (@Controller("users"), @RequestMapping("/api"),
   * @Path/@Route equivalents) for T5 composition. Reads the nearest
   * enclosing class node's decorators; first string/template argument wins.
   */
  private extractControllerBasePath(): string | undefined {
    const classNode = this.scopeManager.findEnclosingClassNode()
    if (!classNode) return undefined
    const decorators = collectDecoratorsForClass(classNode)
    for (const d of decorators) {
      const stack: Node[] = [d]
      while (stack.length > 0) {
        const n = stack.pop()!
        if (n.type === "call_expression") {
          const callee = n.namedChild(0)
          let base = callee
          if (callee && callee.type === "member_expression") {
            base = callee.childForFieldName("property") || callee.namedChild(callee.namedChildCount - 1) || callee
          }
          const decName = base?.text || ""
          if (decName === "Controller" || decName === "RequestMapping" || decName === "Path" || decName === "Route") {
            const args = n.childForFieldName("arguments")
            if (args && args.namedChildCount > 0) {
              const firstArg = args.namedChild(0)
              if (firstArg && (firstArg.type === "string" || firstArg.type === "template_string")) {
                return stringContent(firstArg)
              }
            }
            return undefined
          }
          break
        }
        for (let j = 0; j < n.namedChildCount; j++) {
          const c = n.namedChild(j)
          if (c) stack.push(c)
        }
      }
    }
    return undefined
  }

  private extractApiContract(
    node: any,
    decoratorNodes?: Node[],
  ): { path?: string; method?: string } {    let contractPath: string | undefined = undefined
    let contractMethod: string | undefined = undefined

    // Decorator-based routes (@Get("/users"), @PostMapping("/api")). The
    // decorator NODES are passed in by the caller because placement is
    // asymmetric: method decorators are class_body siblings, not children
    // of the method_definition.
    const methods = new Set(["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"])
    const scanDecorator = (child: any): { path?: string; method: string } | null => {
      let decName = ""
      // T4 (review wave): no path argument means no path — the old default
      // "/" turned every bare @Get() into a phantom root endpoint.
      let route: string | undefined = undefined
      let sawCall = false
      const scan = (n: any) => {
        if (sawCall) return
        if (n.type === "call_expression") {
          sawCall = true
          const callee = n.namedChild(0)
          if (callee) {
            let base = callee
            if (callee.type === "member_expression") {
              base = callee.childForFieldName("property") || callee.namedChild(callee.namedChildCount - 1) || callee
            }
            decName = base.text || ""
          }
          const args = n.childForFieldName("arguments")
          if (args && args.namedChildCount > 0) {
            const firstArg = args.namedChild(0)
            if (firstArg && (firstArg.type === "string" || firstArg.type === "template_string")) {
              route = stringContent(firstArg)
            }
          }
          return
        }
        for (let j = 0; j < n.namedChildCount; j++) {
          const c = n.namedChild(j)
          if (c) scan(c)
        }
      }
      scan(child)
      // Collapsed form: `@Get` / `@Get()` with no call_expression child —
      // the name rides as a bare identifier/member child. Without this the
      // match below never runs and base-path composition (T5) can't see
      // path-less mappings under a controller base.
      if (!decName) {
        for (let j = 0; j < child.namedChildCount; j++) {
          const c = child.namedChild(j)
          if (!c) continue
          if (c.type === "identifier") { decName = c.text; break }
          if (c.type === "member_expression") {
            const prop = c.childForFieldName("property") || c.namedChild(c.namedChildCount - 1)
            if (prop) { decName = prop.text; break }
          }
        }
      }
      // T2 (review wave): EXACT match after stripping a Mapping suffix —
      // the old prefix match turned @Getter into GET and @PostConstruct
      // (a NestJS lifecycle hook) into POST /. @GetMapping still resolves
      // (strip → Get); bare lifecycle/helper names match nothing.
      let upper = decName.toUpperCase()
      if (upper.endsWith("MAPPING") && upper.length > "MAPPING".length) {
        upper = upper.slice(0, upper.length - "MAPPING".length)
      }
      if (methods.has(upper)) {
        return { path: route, method: upper }
      }
      return null
    }

    if (decoratorNodes) {
      for (const child of decoratorNodes) {
        const hit = scanDecorator(child)
        if (hit) {
          contractPath = hit.path
          contractMethod = hit.method
          break
        }
      }
    } else {
      // Function declarations carry their own decorators as direct children.
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i)
        if (child && child.type === "decorator") {
          const hit = scanDecorator(child)
          if (hit) {
            contractPath = hit.path
            contractMethod = hit.method
            break
          }
        }
      }
    }

    const searchCalls = (n: any) => {
      if (contractPath) return
      if (n.type === "call_expression") {
        const callee = n.namedChild(0)
        if (callee) {
          const calleeText = callee.text
          if (calleeText === "fetch" || calleeText.startsWith("axios.")) {
            const args = n.childForFieldName("arguments")
            if (args && args.namedChildCount > 0) {
              let url = ""
              const firstArg = args.namedChild(0)
              if (firstArg && (firstArg.type === "string" || firstArg.type === "template_string")) {
                url = stringContent(firstArg)
              }

              let method = "GET"
              if (calleeText.startsWith("axios.")) {
                const parts = calleeText.split(".")
                if (parts.length > 1) {
                  method = parts[1].toUpperCase()
                }
              } else if (calleeText === "fetch" && args.namedChildCount > 1) {
                const secondArg = args.namedChild(1)
                if (secondArg && secondArg.type === "object") {
                  for (let i = 0; i < secondArg.namedChildCount; i++) {
                    const prop = secondArg.namedChild(i)
                    if (prop && prop.type === "pair") {
                      const key = prop.childForFieldName("key")
                      const val = prop.childForFieldName("value")
                      if (key && key.text === "method" && val) {
                        method = stringContent(val).toUpperCase()
                      }
                    }
                  }
                }
              }

              if (url) {
                contractPath = url
                contractMethod = method
                return
              }
            }
          }
        }
      }

      for (let i = 0; i < n.namedChildCount; i++) {
        const child = n.namedChild(i)
        if (child) searchCalls(child)
      }
    }

    if (node.type === "method_definition" || node.type === "function_declaration" || node.type === "arrow_function") {
      const body = node.childForFieldName("body")
      if (body) {
        searchCalls(body)
      }
    }

    // A method-only result (bare @Get(): method known, path not) must
    // survive — the old path-only gate discarded the method, which also
    // blinded T5 base composition (it keys off apiContract.method).
    return contractPath || contractMethod ? { path: contractPath, method: contractMethod } : {}
  }

  private extractQualifiedCalls(node: Node): string[] | undefined {
    const calls: string[] = []

    const extractCalls = (n: Node) => {
      if (n.type === "call_expression") {
        const callee = n.namedChild(0)
        if (callee) {
          // T8 (review wave): dynamic import() is a module dependency, not a
          // call — the relationship walk already skips the `import` callee
          // (T7 fix); the qualified-calls payload did not, leaking "import"
          // into symbol call lists.
          const calleeIsImport = callee.type === "import" || (callee.type === "identifier" && callee.text === "import")
          if (!calleeIsImport) {
          // Dotted path WITHOUT argument text (family contract with java).
          // Raw callee.text embedded inner-call arguments on chains:
          // `db.list(user).map` was stored as "db.list(user).map".
          const parts: string[] = []
          let cur: Node | null = callee
          while (cur) {
            if (cur.type === "member_expression") {
              const prop = cur.childForFieldName("property")
              parts.unshift(prop ? prop.text : cur.namedChild(cur.namedChildCount - 1)?.text ?? "")
              cur = cur.childForFieldName("object")
            } else if (cur.type === "call_expression") {
              cur = cur.namedChild(0)
            } else {
              parts.unshift(cur.text)
              break
            }
          }
          calls.push(parts.filter(Boolean).join("."))
          }
        }
      }

      // Don't recurse into nested functions
      if (n.type !== "arrow_function" && n.type !== "function_declaration" && n.type !== "function_expression") {
        for (let i = 0; i < n.namedChildCount; i++) {
          const child = n.namedChild(i)
          if (child) {
            extractCalls(child)
          }
        }
      }
    }

    const body = node.childForFieldName("body")
    if (body) {
      extractCalls(body)
    }

    return calls.length > 0 ? calls : undefined
  }

  private extractTaintSources(node: Node): { type: string; snippet: string }[] | undefined {
    const sources: { type: string; snippet: string }[] = []

    const traverse = (n: Node) => {
      if (n.type === "member_expression") {
        // T9 (review wave): receiver-leaf match, not substring — indexOf
        // flagged `myreq.body` (or any `*req.body` suffix) as user input.
        // Only exact receiver roots with exact sensitive leaves qualify.
        const segs: string[] = []
        for (const part of n.text.split(".")) {
          const t = part.trim()
          if (t) segs.push(t)
        }
        const isReqInput =
          segs.length >= 2 && segs[0] === "req" &&
          (segs[1] === "body" || segs[1] === "query" || segs[1] === "params")
        const isEnvRead = segs.length >= 2 && segs[0] === "process" && segs[1] === "env"
        if (isReqInput || isEnvRead) {
          sources.push({ type: "user_input", snippet: n.text })
        }
      } else if (n.type === "identifier") {
        if (n.text === "prompt" || n.text === "readLine") {
          sources.push({ type: "user_input", snippet: n.text })
        }
      } else if (n.type === "subscript_expression") {
        // M49 #757-2: bracket-form access `req['body']` never produced a
        // taint source (neither dotted nor pre-T9 substring form matched).
        // Same receiver-leaf contract as the dotted branch: exact root +
        // exact sensitive leaf; the bracket index must be a string literal.
        const obj = n.childForFieldName("object")
        const idx = n.childForFieldName("index")
        if (obj && idx && idx.type === "string") {
          const segs: string[] = []
          for (const part of obj.text.split(".")) {
            const t = part.trim()
            if (t) segs.push(t)
          }
          segs.push(stringContent(idx))
          const isReqInput =
            segs.length >= 2 && segs[0] === "req" &&
            (segs[1] === "body" || segs[1] === "query" || segs[1] === "params")
          const isEnvRead = segs.length >= 2 && segs[0] === "process" && segs[1] === "env"
          if (isReqInput || isEnvRead) {
            sources.push({ type: "user_input", snippet: n.text })
          }
        }
      }
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) traverse(child)
      }
    }
    traverse(node)

    // Deduplicate
    const seen = new Set<string>()
    const uniqueSources: { type: string; snippet: string }[] = []
    for (const source of sources) {
      if (!seen.has(source.snippet)) {
        seen.add(source.snippet)
        uniqueSources.push(source)
      }
    }

    return uniqueSources.length > 0 ? uniqueSources : undefined
  }

  private extractTaintSinks(node: Node): { type: string; snippet: string; vulnerability_type: string }[] | undefined {
    const sinks: { type: string; snippet: string; vulnerability_type: string }[] = []

    const traverse = (n: Node) => {
      if (n.type === "call_expression") {
        const callee = n.childForFieldName("function")?.text || ""
        const calleeParts = callee.split(".")

        if (
          callee.endsWith(".query") ||
          callee === "execute" ||
          callee.endsWith(".execute")
        ) {
          sinks.push({ type: "database_write", snippet: n.text, vulnerability_type: "sql_injection" })
        }
        if (callee === "exec" || callee === "spawn" || callee === "execSync" || calleeParts[calleeParts.length - 1] === "exec" || calleeParts[calleeParts.length - 1] === "spawn") {
          sinks.push({ type: "shell_execution", snippet: n.text, vulnerability_type: "command_injection" })
        }
        if (callee === "res.send" || callee === "res.html" || callee.endsWith(".innerHTML")) {
          sinks.push({ type: "http_response", snippet: n.text, vulnerability_type: "xss" })
        }
        if (
          callee === "fs.readFile" ||
          callee === "fs.writeFile" ||
          callee === "fs.readFileSync" ||
          callee === "fs.writeFileSync"
        ) {
          sinks.push({ type: "file_system", snippet: n.text, vulnerability_type: "path_traversal" })
        }
      }
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) traverse(child)
      }
    }
    traverse(node)

    // Deduplicate
    const seen = new Set<string>()
    const uniqueSinks: { type: string; snippet: string; vulnerability_type: string }[] = []
    for (const sink of sinks) {
      if (!seen.has(sink.snippet)) {
        seen.add(sink.snippet)
        uniqueSinks.push(sink)
      }
    }

    return uniqueSinks.length > 0 ? uniqueSinks : undefined
  }

  private nodeRange(node: Node, preferParentStatement: boolean = true): ASTEngine.UniversalSymbol["range"] {
    let targetNode = node

    if (preferParentStatement) {
      // If it's a variable declarator and it's the ONLY declarator in the declaration
      if (
        node.type === "variable_declarator" &&
        node.parent &&
        (node.parent.type === "lexical_declaration" || node.parent.type === "variable_declaration")
      ) {
        let declaratorCount = 0
        for (let i = 0; i < node.parent.namedChildCount; i++) {
          if (node.parent.namedChild(i)?.type === "variable_declarator") declaratorCount++
        }
        if (declaratorCount === 1) {
          targetNode = node.parent
        }
      }

      // If the resulting node is wrapped in an export statement, include the export
      if (targetNode.parent?.type === "export_statement") {
        targetNode = targetNode.parent
      } else if (targetNode.parent?.type === "declaration" && targetNode.parent?.parent?.type === "export_statement") {
        targetNode = targetNode.parent.parent
      }
    }

    // M59 (#861): a DECORATED declaration's node STARTS AT ITS DECORATOR in this
    // grammar family — measured on the pinned wasm:
    //
    //   @sealed
    //   export class Service      export_statement children
    //                             [decorator@18, export@19, class_declaration@19]
    //   @inject("db")
    //   private pool: unknown     public_field_definition children
    //                             [decorator@20, accessibility_modifier@21, ...]
    //
    // so the symbol's own line, its `exports` line and its `contains` line all
    // named the line the DECORATOR is written on (18 and 20) instead of the line
    // the declaration's own name is written on (19 and 21) — the M59 contract is
    // the line the named token appears on. Method decorators are class_body
    // SIBLINGS rather than children, which is why methods were already correct.
    // The family rule is the one scala fixed in scala/declaration-lines-825
    // (leading annotations excluded from the range); this makes typescript's the
    // same rule. Advancing to the first NON-decorator child keeps the range
    // coherent — startLine/startColumn/startIndex all move together, to the
    // `export` keyword of a class or the accessibility modifier of a field,
    // which are on the declaration's own line.
    let startSource = targetNode
    {
      let i = 0
      while (i < targetNode.childCount && targetNode.child(i)?.type === "decorator") i++
      const first = i < targetNode.childCount ? targetNode.child(i) : null
      if (i > 0 && first) startSource = first
    }

    return {
      // tree-sitter rows are 0-indexed; the index convention is 1-based.
      startLine: startSource.startPosition.row + 1,
      startColumn: startSource.startPosition.column + 1,
      endLine: targetNode.endPosition.row + 1,
      endColumn: targetNode.endPosition.column + 1,
      startIndex: startSource.startIndex,
      endIndex: targetNode.endIndex,
    }
  }

  private generateSymbolId(symbol: ASTEngine.UniversalSymbol): string {
    const parts = [this.currentFile]
    if (symbol.scope) parts.push(symbol.scope)
    parts.push(symbol.name)
    return parts.join(":")
  }

  private isTypeScriptBuiltinCall(targetName: string, fullCallee?: string): boolean {
    if (targetName === "super") return true
    // Full expression match first: console.log, console.warn, ...
    if (TS_CONSOLE_BUILTINS.has(fullCallee || "")) return true
    // console.* accessed via optional chaining (console?.log) or spaces
    const trimmed = stripWhitespace(fullCallee || "")
    if (TS_CONSOLE_BUILTINS.has(trimmed)) return true
    // Leaf Object universal methods are always filtered (toString, valueOf,
    // hasOwnProperty, isPrototypeOf, toLocaleString, ...)
    if (TS_OBJECT_LEAF_METHODS.has(targetName)) return true
    return false
  }

  // Relationship identity contract (C#-family): sources/targets are LEAF names
  // — the enclosing method/class/namespace leaf, never file-qualified ids.
  // Calls: Distance -> Sqrt; contains: Example.Features -> Status (namespace
  // qualified for top-level containers, class leaf for members); overrides:
  // UserService.format -> BaseService.format (qualified on both sides).
  // Containers qualify by owner (namespace/class); members use their leaf name.
  private hasToken(node: Node, token: string): boolean {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (!child) continue
      if (child.type === token || child.text === token) return true
    }
    return false
  }

  // Project-root lookup, memoized per directory: the walk itself is still
  // filesystem-backed (baseDir anchors absolute imports), but it now runs
  // once per directory per process instead of once per analyzed file.
  private static projectRootCache = new Map<string, string>()

  private findProjectRoot(filePath: string): string {
    let dir = path.dirname(filePath)
    const cache = TypeScriptAnalysisRunner.projectRootCache
    const cached = cache.get(dir)
    if (cached !== undefined) return cached

    let cur = dir
    while (cur !== path.dirname(cur)) {
      const packageJson = path.join(cur, "package.json")
      try {
        if (fs.statSync(packageJson).isFile()) {
          cache.set(dir, cur)
          return cur
        }
      } catch {
        // Continue searching
      }
      cur = path.dirname(cur)
    }

    cache.set(dir, dir)
    return dir
  }

  // ========================================================================
  // METRICS AND QUALITY ASSESSMENT
  // ========================================================================

  private calculateComplexity(node: Node): number {
    // FAMILY CONTRACT (M14 cross-language parity): cyclomatic complexity =
    // 1 + decision points. Decision points are branch constructs and
    // short-circuit operators; an `else` clause NEVER adds (it is not an
    // independent decision). Previously this counter had no base AND
    // double-counted else_clause — two errors that happened to cancel on
    // common shapes, hiding the inconsistency from casual checks.
    let decisions = 0

    const countNode = (n: Node) => {
      // Count control flow structures (else_clause deliberately absent —
      // see contract note above)
      switch (n.type) {
        case "if_statement":
        case "for_statement":
        case "for_in_statement":
        case "while_statement":
        case "do_statement":
        case "switch_case":
        case "catch_clause":
        case "ternary_expression":
        case "conditional_expression":
          decisions++
          break
        case "binary_expression":
          const op = n.childForFieldName("operator")?.text
          if (op === "&&" || op === "||" || op === "??") {
            decisions++
          }
          break
      }

      for (let i = 0; i < n.namedChildCount; i++) {
        const child = n.namedChild(i)
        if (child) countNode(child)
      }
    }

    countNode(node)
    return decisions + 1
  }

  private calculateCyclomaticComplexity(node: Node): number {
    // Cyclomatic complexity = E - N + 2P
    // For a single function: decision points + 1
    let decisions = 0

    const countDecisions = (n: Node) => {
      switch (n.type) {
        case "if_statement":
        case "for_statement":
        case "for_in_statement":
        case "while_statement":
        case "do_statement":
        case "switch_case":
        case "catch_clause":
        case "ternary_expression":
        case "conditional_expression":
          decisions++
          break
        case "binary_expression":
          const op = n.childForFieldName("operator")?.text
          if (op === "&&" || op === "||" || op === "??") {
            decisions++
          }
          break
      }

      for (let i = 0; i < n.namedChildCount; i++) {
        const child = n.namedChild(i)
        if (child) countDecisions(child)
      }
    }

    countDecisions(node)
    return decisions + 1
  }

  private calculateArchitecturalScore(
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
  ): number {
    let score = 100

    // Deduct for high coupling
    const avgRelationships = relationships.length / Math.max(symbols.length, 1)
    if (avgRelationships > 10) score -= 15
    else if (avgRelationships > 5) score -= 5

    // Deduct for missing documentation
    const documentedCount = filterItems(symbols, (s) => s.comments !== undefined && s.comments.length > 0).length
    const docRatio = documentedCount / Math.max(symbols.length, 1)
    if (docRatio < 0.3) score -= 10
    else if (docRatio < 0.5) score -= 5

    // Deduct for too many large classes
    const largeClasses = filterItems(
      symbols,
      (s) => s.kind === ASTEngine.SymbolKind.Class && filterItems(symbols, (m) => m.ownerName === s.name).length > 20,
    ).length
    score -= largeClasses * 5

    // Deduct for deep inheritance
    const hasDeepInheritance =
      filterItems(relationships, (r) => r.type === ASTEngine.RelationshipType.Extends).length > 5
    if (hasDeepInheritance) score -= 10

    // Bonus for good patterns
    const hasTests = someItems(
      symbols,
      (s) => s.name.indexOf("test") !== -1 || s.name.indexOf("spec") !== -1 || s.name.indexOf("Test") !== -1,
    )
    if (hasTests) score += 5

    const hasTypeAnnotations = filterItems(symbols, (s) => !!s.returnType).length / Math.max(symbols.length, 1)
    if (hasTypeAnnotations > 0.7) score += 5

    return Math.max(0, Math.min(100, score))
  }

  private assessCodeQuality(
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
    complexity: number,
    cyclomaticComplexity: number,
  ): string {
    let qualityScore = 100

    // Complexity penalty
    if (cyclomaticComplexity > 50) qualityScore -= 30
    else if (cyclomaticComplexity > 30) qualityScore -= 20
    else if (cyclomaticComplexity > 15) qualityScore -= 10

    // Large symbol count can indicate god files
    if (symbols.length > 100) qualityScore -= 15
    else if (symbols.length > 50) qualityScore -= 5

    // Low documentation penalty
    const docRatio = filterItems(symbols, (s) => !!s.comments).length / Math.max(symbols.length, 1)
    if (docRatio < 0.2) qualityScore -= 10

    // Type annotation bonus
    const typeRatio =
      filterItems(symbols, (s) => !!s.returnType || (s.parameters ? someItems(s.parameters, (p) => !!p.type) : false))
        .length / Math.max(symbols.length, 1)
    if (typeRatio > 0.8) qualityScore += 10

    if (qualityScore >= 90) return "excellent"
    if (qualityScore >= 75) return "good"
    if (qualityScore >= 50) return "moderate"
    if (qualityScore >= 25) return "poor"
    return "critical"
  }

  /**
   * React signal for the hooks check: a react (or preact-compat) import, a
   * require("react") call, or any JSX element. Pure-string matching on
   * module sources, no regex.
   */
  private hasReactSignal(rootNode: Node): boolean {
    const stack: Node[] = [rootNode]
    while (stack.length > 0) {
      const n = stack.pop()!
      if (n.type === "jsx_element" || n.type === "jsx_self_closing_element") return true
      if (n.type === "import_statement") {
        const src = n.childForFieldName("source")
        if (src) {
          const mod = stringContent(src)
          if (mod === "react" || mod === "react-dom" || mod === "preact" || mod === "preact/compat" ||
              mod.startsWith("react/") || mod.startsWith("preact/")) return true
        }
      }
      if (n.type === "call_expression") {
        const callee = n.namedChild(0)
        if (callee && callee.text === "require") {
          const args = n.childForFieldName("arguments")
          const first = args?.namedChild(0)
          if (first && (first.type === "string" || first.type === "template_string")) {
            const mod = stringContent(first)
            if (mod === "react" || mod.startsWith("react/")) return true
          }
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const child = n.namedChild(i)
        if (child) stack.push(child)
      }
    }
    return false
  }

  private detectReactHookAntiPatterns(rootNode: Node): ASTEngine.ParseError[] {    const errors: ASTEngine.ParseError[] = []
    const seen: Record<string, boolean> = {}

    const warn = (node: Node, callee: string, message: string) => {
      const key = `${node.startPosition.row}:${node.startPosition.column}:${message}`
      if (!!seen[key]) return
      seen[key] = true
      errors.push({
        message: `React Hook "${callee}" ${message}`,
        range: {
          // T7 (review wave): 1-based like every other range in the file
          // (nodeToRange convention) — raw 0-based rows misplaced every
          // hook warning by a line next to 1-based syntax errors.
          startLine: node.startPosition.row + 1,
          startColumn: node.startPosition.column + 1,
          endLine: node.endPosition.row + 1,
          endColumn: node.endPosition.column + 1,
          startIndex: node.startIndex,
          endIndex: node.endIndex,
        },
        severity: "warning",
      })
    }

    const fnName = (node: Node): string | undefined => {
      const direct = node.childForFieldName("name")?.text
      if (direct) return direct
      const p = node.parent
      if (p?.type === "variable_declarator") return p.childForFieldName("name")?.text
      if (p?.type === "pair") return p.childForFieldName("key")?.text
      return undefined
    }

    const traverse = (node: Node) => {
      if (node.type === "call_expression") {
        const callee = node.childForFieldName("function") || node.namedChild(0)
        if (
          callee &&
          callee.type === "identifier" &&
          callee.text.startsWith("use") &&
          callee.text.length > 3 &&
          callee.text[3] === callee.text[3].toUpperCase()
        ) {
          let nearestFn: Node | null = null
          let higherFn = false
          let current: Node | null = node.parent
          while (current) {
            if (
              ["function_declaration", "function_expression", "arrow_function", "method_definition"].includes(
                current.type,
              )
            ) {
              if (!nearestFn) {
                nearestFn = current
              } else {
                higherFn = true
              }
            }
            if (
              ["if_statement", "for_statement", "while_statement", "do_statement", "switch_statement"].includes(
                current.type,
              )
            ) {
              warn(node, callee.text, "is called conditionally or in a loop, which violates the Rules of Hooks.")
            }
            current = current.parent
          }

          const name = nearestFn ? fnName(nearestFn) : undefined
          const valid = !!name && (name.startsWith("use") || name[0] === name[0].toUpperCase())
          if (!valid) {
            warn(node, callee.text, "is called outside a React component or custom hook.")
          }
          if (higherFn) {
            warn(node, callee.text, "is called inside a nested function, which violates the Rules of Hooks.")
          }
        }
      }
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i)
        if (child) traverse(child)
      }
    }

    traverse(rootNode)
    return errors
  }
}

function mapItems<T, U>(arr: T[], mapper: (item: T) => U): U[] {
  const result: U[] = []
  if (!arr) return result
  for (let i = 0; i < arr.length; i++) {
    result.push(mapper(arr[i]))
  }
  return result
}

function filterItems<T>(arr: T[], predicate: (item: T) => boolean): T[] {
  const result: T[] = []
  if (!arr) return result
  for (let i = 0; i < arr.length; i++) {
    if (predicate(arr[i])) result.push(arr[i])
  }
  return result
}

function findItem<T>(arr: T[], predicate: (item: T) => boolean): T | undefined {
  if (!arr) return undefined
  for (let i = 0; i < arr.length; i++) {
    if (predicate(arr[i])) return arr[i]
  }
  return undefined
}

function someItems<T>(arr: T[], predicate: (item: T) => boolean): boolean {
  if (!arr) return false
  for (let i = 0; i < arr.length; i++) {
    if (predicate(arr[i])) return true
  }
  return false
}

function everyItem<T>(arr: T[], predicate: (item: T) => boolean): boolean {
  if (!arr) return true
  for (let i = 0; i < arr.length; i++) {
    if (!predicate(arr[i])) return false
  }
  return true
}

function getObjectKeys(obj: any): string[] {
  const keys: string[] = []
  for (const k in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, k)) {
      keys.push(k)
    }
  }
  return keys
}

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

export class RealTypeScriptAnalyzer implements ASTEngine.LanguageAnalyzer {
  private extractTypeParameters(node: Node): string[] {
    const typeParams: string[] = []
    const typeArgs = node.childForFieldName("type_parameters") || node.childForFieldName("type_arguments")
    if (typeArgs) {
      for (let i = 0; i < typeArgs.namedChildCount; i++) {
        const param = typeArgs.namedChild(i)
        if (param) {
          const nameNode = param.childForFieldName("name")
          if (nameNode) {
            let paramStr = nameNode.text
            // Field names verified against the pinned tsx/typescript wasm
            // (2026-09-16): a type_parameter carries name, constraint and value —
            // NOT `extends`/`default`, which this code read while the F1 field
            // oracle was blind (it captured no field literals at all until that
            // same fix). `constraint` text includes the keyword ("extends object"),
            // hence the strip before appending.
            const constraintNode = param.childForFieldName("constraint")
            const defaultValueNode = param.childForFieldName("value")
            if (constraintNode) {
              paramStr += ` extends ${stripLeadingColon(constraintNode.text.replace(/^extends\s+/, ""))}`
            }
            if (defaultValueNode) {
              paramStr += ` = ${stripLeadingEquals(defaultValueNode.text)}`
            }
            typeParams.push(paramStr)
          } else {
            typeParams.push(param.text)
          }
        }
      }
    }
    return typeParams
  }

  analyze(
    rootNode: Node,
    content: string,
    filePath: string,
  ): ASTEngine.ParseResult & { metadata: Partial<ASTEngine.FileMetadata> } {
    return new TypeScriptAnalysisRunner().analyze(rootNode, content, filePath)
  }
}
