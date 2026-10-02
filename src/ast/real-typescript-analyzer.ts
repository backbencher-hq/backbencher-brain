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


/** Strip a literal prefix. NO trimming — the exact `^prefix` behaviour, so it
 *  replaces `/^\.\.\./` on a rest-parameter pattern (`...args` -> `args`) with
 *  the leading space of a hypothetical `"... args"` preserved, exactly as the
 *  regex preserved it. */
function stripPrefix(text: string, prefix: string): string {
  return text.startsWith(prefix) ? text.slice(prefix.length) : text
}

/** Every character JS `\s` matches, spelled out. Carrying the set keeps
 *  `stripLeadingKeyword` provably identical to the `/^keyword\s+/` replace it
 *  replaces: an ASCII-only test would diverge on the Unicode spaces (`\s`
 *  matches U+00A0 and friends; `" " !== "\s"`). */
const WHITESPACE_CHARS =
  "\f\n\r\t\v                  　﻿"

/** Strip a leading keyword plus the whitespace after it.
 *  Pure string code, the exact `/^keyword\s+/` behaviour: the keyword must be
 *  followed by AT LEAST ONE whitespace character (so a bare `extends`, which
 *  the regex leaves alone, is left alone too), and a word that merely starts
 *  with the keyword (`extendsFoo`) is never cut. */
function stripLeadingKeyword(text: string, keyword: string): string {
  if (!text.startsWith(keyword)) return text
  let i = keyword.length
  if (i >= text.length || WHITESPACE_CHARS.indexOf(text[i]) === -1) return text
  while (i < text.length && WHITESPACE_CHARS.indexOf(text[i]) !== -1) i++
  return text.slice(i)
}

/** Generic type parameters of a declaration, as strings.
 *  `T`, `T extends object`, `T = string`, `T extends A = B`.
 *
 *  ONE implementation for the whole file: it existed three times (the
 *  TypeInferenceEngine copy and the RealTypeScriptAnalyzer copy had ZERO call
 *  sites — only the runner's was live), and the two dead copies were why the
 *  same `/^extends\s+/` regex appeared three times in the regex register.
 *
 *  Field names verified against the pinned tsx/typescript wasm (2026-09-16): a
 *  type_parameter carries name, constraint and value — NOT `extends`/`default`,
 *  which the pre-fix code read while the F1 field oracle was blind. `constraint`
 *  text includes the keyword ("extends object"), hence the strip. */
function extractTypeParametersOf(node: Node): string[] {
  const typeParams: string[] = []
  const typeArgs = node.childForFieldName("type_parameters") || node.childForFieldName("type_arguments")
  if (!typeArgs) return typeParams
  for (let i = 0; i < typeArgs.namedChildCount; i++) {
    const param = typeArgs.namedChild(i)
    if (!param) continue
    const nameNode = param.childForFieldName("name")
    if (!nameNode) {
      typeParams.push(param.text)
      continue
    }
    let paramStr = nameNode.text
    const constraintNode = param.childForFieldName("constraint")
    const defaultValueNode = param.childForFieldName("value")
    if (constraintNode) {
      paramStr += ` extends ${stripLeadingColon(stripLeadingKeyword(constraintNode.text, "extends"))}`
    }
    if (defaultValueNode) {
      paramStr += ` = ${stripLeadingEquals(defaultValueNode.text)}`
    }
    typeParams.push(paramStr)
  }
  return typeParams
}

/**
 * The NAME a value expression is bound to, looking upward through the wrappers
 * that can sit between a value and its binding. PORTED from the javascript twin
 * (`bindingNameAbove`, real-javascript-analyzer.ts:211) so the two analyzers
 * answer one question the same way: `const K = class {…}` binds through a
 * `variable_declarator`, `K = class {…}` through an `assignment_expression`,
 * and anything else — a call argument, a `return`, an array element — names
 * nothing, so the answer is `undefined` rather than a guess. That "rather than a
 * guess" is load-bearing: the twin measured 183 of 204 remaining ownerless
 * members on the svelte corpus as exactly this correct-silence case, and 20 as
 * the assignment form, which was a real gap.
 */
function bindingNameAbove(value: Node): string | undefined {
  let q: Node | null = value.parent
  while (q) {
    if (q.type === "variable_declarator") {
      const nm = q.childForFieldName("name")
      return nm && nm.type === "identifier" ? nm.text : undefined
    }
    if (q.type === "assignment_expression") {
      const l = q.childForFieldName("left")
      return l && l.type === "identifier" ? l.text : undefined
    }
    if (
      q.type === "pair" || q.type === "object" || q.type === "class" || q.type === "class_body" ||
      q.type === "return_statement" || q.type === "expression_statement" || q.type === "export_statement"
    ) {
      q = q.parent
      continue
    }
    return undefined
  }
  return undefined
}

/**
 * The owner a member's container names, PORTED from the javascript twin
 * (`containerOwnerName`, real-javascript-analyzer.ts:232).
 *
 * The class-EXPRESSION arm is what this analyzer was missing: `const A = class
 * Inner { m() {} }` produced NO member at all, because the variable path
 * suppressed descent for every non-`object` initializer, and the javascript
 * twin — which descends — emitted `method:m`. The oracle derives nothing for
 * the shape either, so no differential could ever have flagged it; the twin was
 * the only reference that could. A class expression's own declared name wins
 * (`class Inner`), else the binding it is initialised or assigned to; a
 * function boundary ends the search, because nothing inside a function body is
 * a module-level member of anything.
 */
/**
 * `get` / `set` are ANONYMOUS token children of a `method_definition` — not
 * named children — so a named-child walk never sees them. Verified against the
 * pinned typescript grammar: in `{ get size(){}, set size(v){} }` both members
 * are `method_definition` and each carries one anonymous `get`/`set` token.
 */
function accessorKindOf(node: Node): "get" | "set" | undefined {
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i)
    if (c && (c.type === "get" || c.type === "set")) return c.type
  }
  return undefined
}

function containerOwnerName(n: Node): string | undefined {
  let p: Node | null = n.parent
  while (p) {
    if (p.type === "class_declaration" || p.type === "abstract_class_declaration") {
      return p.childForFieldName("name")?.text
    }
    if (p.type === "class") {
      const own = p.childForFieldName("name")?.text
      if (own) return own
      return bindingNameAbove(p)
    }
    if (p.type === "object") {
      return bindingNameAbove(p)
    }
    if (
      p.type === "function_declaration" || p.type === "function_expression" ||
      p.type === "arrow_function" || p.type === "generator_function_declaration" ||
      p.type === "method_definition" || p.type === "function"
    ) {
      return undefined
    }
    p = p.parent
  }
  return undefined
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

  /**
   * R10: the owner of a DECLARATION, decided LEXICALLY.
   *
   * `getOwnerInfo()` alone answers the wrong question for a declaration nested
   * in a function body: it walks to the nearest class/namespace/interface/enum
   * scope and SKIPS function scopes, so `class K { go() { function inner(){} } }`
   * resolved `inner`'s owner to `K` and emitted `contains K->inner` — the graph
   * claiming the class has a member it does not have. The same false edge
   * appeared for a type alias and an interface declared in a method body, and for
   * a function declared inside a namespace function.
   *
   * It cannot be fixed in the scope stack, because that stack ACCUMULATES: the
   * class member loop extracts each member synchronously, so while member 2 is
   * being resolved, member 1's Method scope is still on top. A guard there —
   * "a function scope means local" — was tried and measured, and it stripped REAL
   * members, because member 2 legitimately resolves through member 1's leftover
   * scope to the class. The scope stack is a resource stack, not a faithful
   * lexical stack, so the question is asked of the TREE instead.
   *
   * A declaration belongs to the nearest enclosing BODY container; if any
   * function body sits between it and that container, it is a local of that
   * function and owns nothing. All five shapes measured:
   *
   *   class K { a(){} b(){} }                 -> b's parent is class_body  : member
   *   class K { go() { function inner(){} } }  -> inner meets `go` first    : local
   *   function f() { class C {} }              -> C meets `f` first         : local
   *   namespace N { export function f() {} }   -> f meets no function       : member
   *   function f() { class C { m(){} } }       -> m meets class_body first  : member
   */
  getOwnerInfoForDeclaration(node: any): { ownerName?: string; ownerKind?: ASTEngine.SymbolKind } | undefined {
    for (let p = node?.parent; p; p = p.parent) {
      const t = p.type
      if (
        t === "function_declaration" || t === "generator_function_declaration" ||
        t === "function_signature" || t === "function_expression" ||
        t === "arrow_function" || t === "method_definition" || t === "function"
      ) return undefined
      if (t === "class_body" || t === "interface_body" || t === "enum_body") break
    }
    return this.getOwnerInfo()
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
    // (`external:specifier`) — reached only when `isBuiltinModule` says the
    // specifier is not a Node runtime module. A previous revision walked up
    // to node_modules and sniffed package.json main/types entry points —
    // every answer it gave depended on the local machine, so the same repo
    // indexed differently per machine, at the cost of sync statSync I/O per
    // import per file. Nothing reads past the specifier (verified: no
    // metadata.resolvedPath consumers repo-wide; fixtures pin module/items
    // only). Deterministic on every machine.
    return `external:${specifier}`
  }

}

// Node.js built-in modules — module-level so every resolution doesn't
// reallocate the set (the old per-call construction ran per import).
//
// A PINNED contract, deliberately NOT `builtinModules` from node:module. That
// import would be shorter and self-maintaining, and it would also make
// classification depend on the Node version running the index: `node:sqlite`
// exists in the runtime's list and not in an older one's, so the same source
// would resolve differently on two machines — the exact machine-dependence the
// module resolver was rewritten to remove (no statSync, no node_modules
// sniffing, `external:` for bare packages). A fixed table plus the subpath-head
// rule below is the same answer on every machine and every Node version, which
// is worth more here than the maintenance saving. The table tracks Node >= 22
// (the `test` runner landed in 18; `sqlite`, `sea` and `diagnostics_channel`
// are the later additions).
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
  // Node >= 18: the test runner and the other late additions. A stale list is
  // the same defect as a missing subpath branch — the module is real, the
  // table just predates it.
  "test",
  "sqlite",
  "sea",
  "diagnostics_channel",
])

function isBuiltinModule(specifier: string): boolean {
  const bare = stripLeading(specifier, "node:")
  if (NODE_BUILTINS.has(bare)) return true
  // Node's own spec exposes most builtins under SUBPATH names: `node:fs/promises`,
  // `stream/promises`, `readline/promises`, `timers/promises`, `dns/promises`,
  // `util/types`, `assert/strict`, `path/posix`, `node:test/reporters`. A head
  // that is a builtin makes the whole specifier a RUNTIME module, never a
  // package. Without this branch every one of them fell through to
  // `external:…`, so the index reported a dependency on an npm package called
  // `fs/promises` (and `node:test`, `stream/promises`, …) in every modern
  // Node codebase — the exact misclassification the bare-name set could not see.
  const slash = bare.indexOf("/")
  if (slash <= 0) return false
  return NODE_BUILTINS.has(bare.slice(0, slash))
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

/**
 * The twin's J4 rule, ported: does this `require(...)` bind the module's DEFAULT
 * export? A bare-identifier binding (`const m = require("m")`) takes the default;
 * a destructuring binding (`const { a } = require("m")`) takes named members. The
 * javascript lane hardcoded `true` for every require and flagged everything as a
 * default import, so the rule is stated once here rather than copied twice.
 */
function requireBindsDefault(call: Node): boolean {
  let vp: Node | null = call.parent
  while (
    vp && vp.type !== "variable_declarator" && vp.type !== "lexical_declaration" &&
    vp.type !== "variable_declaration" && vp.type !== "export_statement" &&
    vp.type !== "expression_statement" && vp.type !== "program"
  ) {
    vp = vp.parent
  }
  if (vp && vp.type === "variable_declarator") {
    const bindName = vp.childForFieldName("name")
    return !!bindName && bindName.type === "identifier"
  }
  return false
}

/**
 * The module path an `import_statement` names, for BOTH shapes the grammar uses.
 *
 * `import { a } from "./m"` puts the path in a `source` FIELD of the statement,
 * while `import m = require("./m")` wraps it in an `import_require_clause` whose
 * string is an ordinary named child (probed: `import_statement >
 * import_require_clause > identifier, string`). Reading only the `source` field
 * silently skipped the whole TypeScript form of CommonJS require, so those files
 * reported no dependency at all.
 */
function importStatementSource(importNode: Node): Node | null {
  const direct = importNode.childForFieldName?.("source")
  if (direct) return direct
  for (let i = 0; i < (importNode.namedChildCount ?? 0); i++) {
    const c = importNode.namedChild(i)
    if (!c || c.type !== "import_require_clause") continue
    for (let j = 0; j < c.namedChildCount; j++) {
      const s = c.namedChild(j)
      if (s && s.type === "string") return s
    }
  }
  return null
}

/** True when this `import_statement` is the `import x = require(...)` form. */
function isImportRequireClause(importNode: Node): boolean {
  for (let i = 0; i < (importNode.namedChildCount ?? 0); i++) {
    const c = importNode.namedChild(i)
    if (c && c.type === "import_require_clause") return true
  }
  return false
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
  private _pendingReExportImports: ASTEngine.ImportInfo[] = []
  // M49 dup-key ruling (#746): dead spans returned by the Phase-2.5
  // collapse, consumed by the post-walk phantom-edge filter.
  private _dupKeyDeadSpans: { name: string; startRow: number; endRow: number; startCol: number; endCol: number }[] | null = null
  // Depth of nested function bodies being walked for symbol extraction.
  // Locals/params/lambda-params inside a function body are NOT symbols
  // (C#-family contract); only module/namespace/class-level declarations are.
  private insideFunctionDepth = 0
  /** Per-FILE facts every payload rule needs, gathered in ONE walk (the walk
   *  the React gate already paid for): JSX presence, a react/preact import, a
   *  solid-js import, and a child_process import. The sink rules need the last
   *  one to tell an imported `exec` from a project's own `exec`, and the solid
   *  flag replaces a whole-file `content.includes("solid-js")` text scan with
   *  an AST fact. */
  /** name -> every symbol declared with that name, in declaration order.
   *  R2b: the relationship passes resolve the enclosing symbol for every
   *  DECLARATION node, and each resolution used to be a linear scan of the
   *  whole symbol array (`findItem`) — O(declarations x symbols) per pass, run
   *  by two passes and by the qualified-calls post-pass. Bucketing by name
   *  keeps the scan inside one bucket, and iterating a bucket in declaration
   *  order preserves `findItem`'s first-match contract exactly, including the
   *  repeated-name case (two classes each declaring `save`). */
  private _symbolIndex: Map<string, ASTEngine.UniversalSymbol[]> | null = null
  private _fileSignals: { hasReact: boolean; importsChildProcess: boolean; solidJs: boolean } = {
    hasReact: false,
    importsChildProcess: false,
    solidJs: false,
  }
  // M3: `qualified_calls` is computed AFTER extraction, not during it. The
  // payload's owner resolution has to see the WHOLE symbol set: a nested
  // `function inner(){}` is pushed to `symbols` only after its enclosing
  // function finishes, so resolving mid-walk could not find it and the
  // callback's calls were charged to the outer symbol. The relationship passes
  // have always run after extraction for the same reason; this payload now
  // does too (the javascript twin likewise computes it in a later phase).
  private _pendingQualifiedCalls: Array<{ symbol: ASTEngine.UniversalSymbol; node: Node }> = []

  constructor() {
    this.scopeManager = new ScopeManager()
    this.typeInference = new TypeInferenceEngine()
  }

  /** Delegates to the module-level `extractTypeParametersOf` (one
   *  implementation, one place the generic-parameter contract can change). */
  private extractTypeParameters(node: Node): string[] {
    return extractTypeParametersOf(node)
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
    this._symbolIndex = null

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
    // R2c: ONE walk for imports AND the per-file signals, run BEFORE symbol
    // extraction. This scan used to be a second full traversal sitting next to
    // the imports walk, and it had to sit here (before the symbol passes)
    // because the taint sink rule reads `importsChildProcess` while building
    // payloads. The resolution is ordering, not a provisional list: the imports
    // walk is a pure tree read that needs no symbols, so running it first hands
    // the signals to everything downstream and the extra traversal is gone.
    // `imports` keeps the same content and the same order — the same walk over
    // the same tree — and the exports pass, which does need symbols, stays put.
    this._fileSignals = { hasReact: false, importsChildProcess: false, solidJs: false }
    this.scanImportsAndFileSignals(rootNode, imports)
    if (this._fileSignals.hasReact && !this._fileSignals.solidJs) {
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
    // ONE call: this ran the full-tree collapse TWICE per file and threw the
    // first result away — a whole redundant walk, and two equally authoritative
    // looking answers to "which one is the dead-span list?". The pass is
    // tree-derived, so the second call also re-derived the same spans to splice
    // symbols the first call had already spliced.
    this._dupKeyDeadSpans =
      this.collapseDuplicateObjectMembers(rootNode, symbols)

    // R2b: the name index every later resolution reads. Built HERE because it
    // must describe the post-collapse symbol set, and before the first reader
    // (the qualified-calls post-pass below).
    const byName = new Map<string, ASTEngine.UniversalSymbol[]>()
    for (const sym of symbols) {
      const bucket = byName.get(sym.name)
      if (bucket) bucket.push(sym)
      else byName.set(sym.name, [sym])
    }
    this._symbolIndex = byName

    // M3: fill `qualified_calls` now, with the complete symbol table in hand
    // (see the _pendingQualifiedCalls note). ONE map shared by every symbol's
    // walk, keyed by the SYMBOL (never by name — two classes may each declare
    // `save`), because a call inside a nested function or a callback is
    // charged to the symbol that owns it, not to the symbol whose body the
    // walk started from. That is the javascript twin's `bySource` contract
    // (real-javascript-analyzer.ts:1005 reads the payload out of the map).
    // A symbol the dup-key collapse removed is skipped — its payload died
    // with it.
    const qcByOwner = new Map<ASTEngine.UniversalSymbol, string[]>()
    for (const pending of this._pendingQualifiedCalls) {
      if (symbols.indexOf(pending.symbol) === -1) continue
      this.extractQualifiedCalls(pending.node, pending.symbol, symbols, qcByOwner)
    }
    for (const pending of this._pendingQualifiedCalls) {
      const list = qcByOwner.get(pending.symbol)
      if (list && list.length > 0) pending.symbol.qualified_calls = [...new Set(list)]
    }
    this._pendingQualifiedCalls = []

    // PHASE 3: Extract exports (imports were read before symbol extraction, so
    // the per-file signals were available to the payload rules)
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
    // ONE complexity walk feeds BOTH file-level metadata fields: they are the
    // same number by contract (1 + decision points — the M14 family rule), and
    // they used to be produced by two byte-identical implementations, i.e. two
    // full-tree walks per file whose answers could silently drift apart.
    const complexity = this.calculateComplexity(rootNode)
    // ALL lines, not the non-empty ones: `linesOfCode` is a cross-language
    // metric and the same source analyzed as .ts and as .js must not disagree.
    // This analyzer counted non-empty lines while the javascript twin counts
    // every line (`content.split("\n").length`), so one file reported two
    // different LOC values depending on its extension (measured: 6 vs 9 for the
    // same 7-line source with 2 blank lines). Both forms over-count a trailing
    // newline by one — a family-level nit, left alone here on purpose.
    const linesOfCode = content.split("\n").length
    const cyclomaticComplexity = complexity

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
        // A bodyless function DECLARATION is a different node type, and the
        // spec has carried `function_signature` as handled_verified since the
        // lane was declared conformant while the analyzer had no reference to
        // the type at all. It is what `declare function f(): void` parses to,
        // and an ambient module body is nothing but these — so every exported
        // function in a .d.ts was invisible: no symbol, no call edge, no
        // complexity, no api-contract row. The class and interface paths
        // already route `method_signature` and `abstract_method_signature` to
        // their extractors; this is the statement-level counterpart, and the
        // grammar distinction is only the absent body. extractFunction already
        // tolerates that (`if (body)`), and for a signature the api-contract
        // fields are exactly right: it IS a declaration of the API, with no
        // implementation to confuse them.
        case "function_signature":
          skipChildren = this.extractFunction(node, symbols, stack)
          break

        case "class_declaration":
        case "abstract_class_declaration":
          skipChildren = this.extractClass(node, symbols, stack)
          break

        // A NAMED class expression (`const K = class Inner { m(){} }`) is a class
        // DECLARATION named `Inner`: the name is written in the file, it is in
        // scope inside its own body, and `new Inner()` inside that body already
        // resolved to it. There was no `case "class"` at all, so the expression
        // was walked as a bare bag of members and LOST, measurably:
        //   * no `Inner` Class symbol — the class was invisible as a type;
        //   * therefore no `contains` edge either: the member extraction
        //     attributes `m` to owner `Inner`, and addContainmentRelationships
        //     drops an edge whose owner is not a symbol, so a named class
        //     expression contributed NO members to the hierarchy at all, while
        //     the javascript twin emitted a dangling `Inner->m` for the very
        //     same construct;
        //   * and `extends` / `implements` were lost with it, though heritage
        //     is clause structure the generic oracle derives.
        // Anonymous class expressions deliberately keep their existing path:
        // they have no name of their own, so their members belong to the binding
        // that holds the value (`const K = class { m(){} }` -> `K contains m`),
        // which resolves and is reachable.
        case "class":
          skipChildren = this.extractNamedClassExpression(node, symbols, stack)
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
        // A class — DECLARATION, or an EXPRESSION that carries a name — is
        // fully handled by extractClass, which walks its own body, so the generic
        // descent must not descend into it or every member is extracted TWICE.
        // That exclusion has always covered `class_declaration`; the class
        // EXPRESSION node type was missing from it, which is exactly why R1 had
        // to reach class-expression members through the descent instead. An
        // ANONYMOUS class expression is deliberately NOT excluded: it has no
        // name, so its members belong to the binding that holds the value and
        // the descent is what finds them.
        const classOwnsItsMembers = node.type === "class" && !!node.childForFieldName("name")
        if (
          !classOwnsItsMembers &&
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
    // An ambient declaration carries NO `declare` child of its own: the grammar
    // puts the keyword on a wrapping `ambient_declaration`, verified by ancestry
    // (`function_signature <- ambient_declaration <- [export_statement]`). So
    // `extractModifiersFromNode` cannot see it, and a bodyless declaration would
    // otherwise be indistinguishable from an implementation — which matters now
    // that these symbols exist: there is no body, and nothing to have measured.
    // Same reason `export` is not a child; that one is already covered by
    // isNodeExported, which walks ancestors.
    const isAmbientDeclaration = node.type === "function_signature" && node.parent?.type === "ambient_declaration"
    const exportStatus = isNodeExported(node)
    const params = this.extractParameters(node)
    const returnType = this.extractReturnType(node)
    const typeParams = this.extractTypeParameters(node)
    const apiContract = this.extractApiContract(node)
    // ONE complexity walk per symbol: the top-level field and the metadata
    // mirror are the same number by contract, and each call re-walked the whole
    // function subtree.
    const ownComplexity = this.calculateComplexity(node)

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
      complexity: ownComplexity,
      genericParameters: typeParams.length > 0 ? typeParams : undefined,
      decorators: modifiers.decorators.length > 0 ? modifiers.decorators : undefined,
      comments: this.extractComments(node),
      qualified_calls: undefined, // M3: filled in the post-extraction pass
      apiContractPath: apiContract.path,
      taintSources: this.extractTaintSources(node),
      taintSinks: this.extractTaintSinks(node),
      ...this.scopeManager.getOwnerInfoForDeclaration(node),
      metadata: {
        apiMethod: apiContract.method,
        isGenerator: node.type === "generator_function_declaration",
        isExported: exportStatus.isExported,
        isDefault: exportStatus.isDefault,
        // `|| isAmbientDeclaration`: a signature wrapped in ambient_declaration
        // IS a declaration even though the keyword is not its own child.
        isDeclare: modifiers.isDeclare || isAmbientDeclaration,
        complexity: ownComplexity,
        decoratorLines: modifiers.decoratorLines.length > 0 ? modifiers.decoratorLines : undefined,
      },
    }

    symbols.push(symbol)
    this.scopeManager.registerSymbol(symbol)
    this._pendingQualifiedCalls.push({ symbol, node })

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

  /**
   * A class EXPRESSION that carries a name is a class declaration, and routes to
   * the audited class extractor. An anonymous one keeps the existing path: its
   * members belong to the binding that holds the value, which already resolves.
   */
  private extractNamedClassExpression(node: Node, symbols: ASTEngine.UniversalSymbol[], stack: StackEntry[]): boolean {
    if (!node.childForFieldName("name")) return false
    return this.extractClass(node, symbols, stack)
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
      ...this.scopeManager.getOwnerInfoForDeclaration(node),
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
    // R10c: the pop must be DEFERRED onto the walk stack, not called here. A
    // member extractor pushes its OWN scope (a method pushes Method, a
    // constructor Constructor) and queues that member's body for later walking,
    // so an eager pop removed the INNERMOST scope — the method's — and the
    // method's own deferred pop then removed the class scope underneath it. The
    // class scope was therefore still on the stack while a method body was walked
    // and already gone by the time the next member was extracted, which is how a
    // function, type alias or interface declared INSIDE a method body came out as
    // a member of the class: `contains K->inner`, measured, and a false edge.
    // The five extractors that already deferred their pop (function, method,
    // constructor, static block, namespace) are the pattern being applied here.
    stack.push({ action: () => this.scopeManager.popScope() })

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
      ...this.scopeManager.getOwnerInfoForDeclaration(node),
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
    // R10c: the pop must be DEFERRED onto the walk stack, not called here. A
    // member extractor pushes its OWN scope (a method pushes Method, a
    // constructor Constructor) and queues that member's body for later walking,
    // so an eager pop removed the INNERMOST scope — the method's — and the
    // method's own deferred pop then removed the class scope underneath it. The
    // class scope was therefore still on the stack while a method body was walked
    // and already gone by the time the next member was extracted, which is how a
    // function, type alias or interface declared INSIDE a method body came out as
    // a member of the class: `contains K->inner`, measured, and a false edge.
    // The five extractors that already deferred their pop (function, method,
    // constructor, static block, namespace) are the pattern being applied here.
    stack.push({ action: () => this.scopeManager.popScope() })

    const body = node.childForFieldName("body")
    if (body) {
      this.extractInterfaceMembers(body, symbols, name)
    }

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
      ...this.scopeManager.getOwnerInfoForDeclaration(node),
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
      ...this.scopeManager.getOwnerInfoForDeclaration(node),
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
    // R10c: the pop must be DEFERRED onto the walk stack, not called here. A
    // member extractor pushes its OWN scope (a method pushes Method, a
    // constructor Constructor) and queues that member's body for later walking,
    // so an eager pop removed the INNERMOST scope — the method's — and the
    // method's own deferred pop then removed the class scope underneath it. The
    // class scope was therefore still on the stack while a method body was walked
    // and already gone by the time the next member was extracted, which is how a
    // function, type alias or interface declared INSIDE a method body came out as
    // a member of the class: `contains K->inner`, measured, and a false edge.
    // The five extractors that already deferred their pop (function, method,
    // constructor, static block, namespace) are the pattern being applied here.
    stack.push({ action: () => this.scopeManager.popScope() })

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
      // M5: an arrow/function-valued variable is a Function symbol, so it gets
      // the same API-contract extraction a `function` declaration gets. Without
      // it the dominant handler shape carried no contract at all: the analyzer
      // reported `/api/fn` for `function fnHandler(){ return fetch("/api/fn") }`
      // and nothing for the identical `const arrowHandler = () => fetch(...)` —
      // while `extractApiContract` already had an `arrow_function` branch, so
      // the intent was there and the caller was missing.
      const apiContract =
        valueNode?.type === "arrow_function" || valueNode?.type === "function"
          ? this.extractApiContract(valueNode)
          : { path: undefined, method: undefined }

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
        // M3: qualified_calls is filled by the post-extraction pass (see
        // _pendingQualifiedCalls) — only arrow/function-valued declarators are
        // enqueued, and a plain variable has no call paths of its own.
        apiContractPath: apiContract.path,
        taintSources: valueNode ? this.extractTaintSources(valueNode) : undefined,
        taintSinks: valueNode ? this.extractTaintSinks(valueNode) : undefined,
        ...this.scopeManager.getOwnerInfoForDeclaration(node),
        metadata: {
          apiMethod: apiContract.method,
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
      if (valueNode?.type === "arrow_function" || valueNode?.type === "function") {
        this._pendingQualifiedCalls.push({ symbol, node: valueNode })
      }

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
      // R1: a CLASS EXPRESSION value carries members too, and the javascript
      // twin has always descended into it — `const A = class Inner { m() {} }`
      // emitted `method:m` there and NOTHING here, because the `object` test
      // below was the only descent trigger. The whole body was lost with it: no
      // member symbol, no `contains` edge, and the calls inside `m` attributed
      // to the enclosing function instead. The oracle derives nothing for the
      // shape, so no differential could have flagged it; the twin was the only
      // available reference.
      if (valueNode?.type === "object" || valueNode?.type === "class") {
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
        // A destructured binding is a declaration too:  inside a
        // method is a local of that method, not a member of the class. The
        // lexical question is asked of the DECLARATOR, which is the node whose
        // ancestors describe where the binding is written.
        ...this.scopeManager.getOwnerInfoForDeclaration(declarator),
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

    const ownerInfo = this.scopeManager.getOwnerInfoForDeclaration(node)
    // ONE complexity walk per method: the top-level field and the metadata
    // mirror are the same number by contract.
    const ownComplexity = this.calculateComplexity(node)
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
      complexity: ownComplexity,
      comments: this.extractComments(node),
      qualified_calls: undefined, // M3: filled in the post-extraction pass
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
        complexity: ownComplexity,
        decoratorLines: modifiers.decoratorLines.length > 0 ? modifiers.decoratorLines : undefined,
      },
    }

    symbols.push(symbol)
    this._pendingQualifiedCalls.push({ symbol, node })

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
    const ownerInfo = this.scopeManager.getOwnerInfoForDeclaration(node)
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
      qualified_calls: undefined, // M3: filled in the post-extraction pass
      apiContractPath: apiContract.path,
      ...ownerInfo,
      metadata: { apiMethod: apiContract.method },
    }

    symbols.push(symbol)
    this._pendingQualifiedCalls.push({ symbol, node })

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
        if (pat) paramNameNodes.set(stripPrefix(pat.text, "..."), pat)
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

    const ownerInfo = this.scopeManager.getOwnerInfoForDeclaration(node)

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

    /**
     * The symbol that OWNS a type mention, or `null` when nothing does.
     *
     * This pass's walk list is deliberately the ORIGINAL, narrow one — a
     * function, method, class, interface or module-level declarator — and the
     * change here is only to the FALLBACK. It used to answer `"global"` when the
     * walk found no owner, which published edges whose source is not a symbol in
     * the file: `global` appeared as a source 185 times over 700 tracked files and
     * was never once a real symbol, so all of those edges dangled at the source
     * end.
     *
     * The tempting repair was to WIDEN the list so a type alias or enum would
     * claim its own mentions. That is wrong, and measured: every one of those
     * mentions is already emitted by the main reference pass under the correct
     * owner. `type AutoIndexState = { index: IndexDetection }` already produced
     * `AutoIndexState->IndexDetection`; what the fallback added was the SAME edge
     * a second time with `global` in the source column. Widening the list
     * therefore converted 212 wrong-source duplicates into 212 right-source
     * duplicates — the row count did not fall, it rose. Verified on
     * `auto-index.ts`, where `AutoIndexState->IndexDetection` went from one row to
     * two.
     *
     * So the fallback was never carrying information. Where no listed declaration
     * owns the mention, the honest answer is NO EDGE — which is what `null` means
     * and what `emit` now does. A fabricated source is not a weaker claim than
     * silence; it is a wrong one, and it was the only source in the graph that no
     * consumer could resolve.
     */
    const resolveSource = (start: Node): string | null => {
      let p: Node | null = start.parent
      while (p) {
        if (
          p.type === "class_declaration" ||
          p.type === "class" ||
          p.type === "abstract_class_declaration" ||
          p.type === "function_declaration" ||
          p.type === "generator_function_declaration" ||
          p.type === "method_definition" ||
          p.type === "interface_declaration" ||
          p.type === "type_alias_declaration" ||
          p.type === "enum_declaration" ||
          p.type === "internal_module" ||
          p.type === "module" ||
          p.type === "variable_declarator"
        ) {
          const name = this.findNamedChild(p)
          if (name) return name.text
        }
        p = p.parent
      }
      return null
    }

    /**
     * `references` rows already in the SHARED relationship array, so this pass
     * does not re-add a mention the main reference pass already recorded.
     *
     * Two passes cover type mentions — this one and the main pass — and they
     * overlap: `type AutoIndexState = { index: IndexDetection }` is emitted by
     * both. The main pass keeps its own per-key `processed` set and this pass its
     * own `emitted` set, and NEITHER can see the other, so an overlap used to
     * reach the graph twice. That duplication is invisible while both rows are
     * correct, which is why it survived; it only became visible when the source
     * differed and the two rows stopped agreeing.
     */
    const alreadyPublished = new Set<string>()
    for (const rel of relationships) {
      if (rel.type === ASTEngine.RelationshipType.References) alreadyPublished.add(`${rel.source}|${rel.target}`)
    }

    const emit = (source: string | null, roots: Node[], relType: string): void => {
      // No owning declaration means no edge. See `resolveSource`.
      if (source === null) return
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
          // A mention the main reference pass already published under this owner
          // is not published again here. See `alreadyPublished`.
          const published = `${source}|${t}`
          if (alreadyPublished.has(published)) continue
          emitted.add(key)
          alreadyPublished.add(published)
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
        // `reference_qualified` unconditionally: the JVM family's
        // `isImport` discriminator is never set on a relationship this
        // analyzer emits (its import edges are the dedicated `imports` kind,
        // classified above), so the true branch was unreachable.
        md.evidenceClass = "reference_qualified"
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
        valueType = stripLeadingColon(child.text)
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
        // The name `[key]` is INVENTED — the source writes `[key: string]`, and
        // `[key]` is not a member any caller can pass, which is why the Vue lane
        // suppresses the same shape on its own inline-type-literal path (VSD34).
        // Declaring it with the m60 surface audit's general mechanism keeps it out
        // of the "name not present in source" channel without an allowlist that
        // would have to enumerate every parameter name. Found via the Vue lane's
        // own audit, where it was the last of 125 findings.
        synthesized: true,
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

    // R7: a get/set pair is ONE property in TypeScript's type system, and the
    // CLASS path already rules that way — its body pre-pass keeps the last
    // declaration of each name. The object-literal path had no such pass, so
    // `{ get size(){}, set size(v){} }` produced TWO `size` symbols sharing one
    // owner, and therefore TWO identical `contains owner -> size` rows: a
    // duplicate symbol, a duplicate edge, and an ambiguous name for every
    // consumer that resolves a member by name. Measured: 1 duplicate row per
    // accessor pair, in both the TypeScript and JavaScript lanes.
    //
    // Keeping the LAST accessor mirrors the class rule exactly. Returning false
    // also leaves the walker to descend into the skipped accessor's body, so its
    // calls are still recorded — against the OWNER, which is what the class path
    // does today (a getter body calling `compute()` yields `calls C -> compute`),
    // so this loses no edge that the class path keeps.
    if (accessorKindOf(node) !== undefined) {
      const parent = node.parent
      if (parent) {
        for (let i = 0; i < parent.namedChildCount; i++) {
          const sib = parent.namedChild(i)
          if (!sib || sib.startIndex <= node.startIndex) continue
          if (accessorKindOf(sib) !== undefined && sib.childForFieldName("name")?.text === name) return false
        }
      }
    }
    // R1: the ownership rule is the twin's, ported verbatim
    // (`containerOwnerName`), so an object-literal member, a class-expression
    // member and a class-declaration member are resolved by ONE contract
    // instead of two hand-rolled walks that disagreed.
    const ownerName = containerOwnerName(node)
    // R10: an UNBOUND literal has no owner, and its members must not borrow the
    // enclosing one. This used to fall back to `getOwnerInfo()`, which is
    // invisible at module level (no scope to inherit) and wrong everywhere
    // else: `class K { go() { return { m(){} } } }` emitted `contains K->m`,
    // telling the graph that class K has a member `m` when `m` belongs to a
    // temporary object one of its methods returns. Measured across both twins
    // (typescript and javascript agree on the false edge, so this is a shared
    // defect, not a divergence) and in every enclosing-scope shape: a method
    // body, a static method, a nested callback, a namespace function.
    //
    // The bound case was always right and is untouched: `const o = { m(){} }`
    // inside a method gives `ownerName === "o"`, and `class K { go() { const o
    // = { m(){} } } }` already emitted no `K->m`. So the fallback was never
    // load-bearing for a literal that HAS a name; it only ever fired for the
    // nameless ones, which is exactly where it invented an owner.
    const ownerInfo = ownerName
      ? { ownerName, ownerKind: ASTEngine.SymbolKind.Constant as unknown as ASTEngine.SymbolKind }
      : undefined
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
        } else {
          // extractMethod seeds owner/scope from the enclosing scope; clear them
          // so a nameless literal's member is ownerless, which is what the
          // module-level case already produced.
          s.ownerName = undefined
          s.ownerKind = undefined
          s.scope = undefined
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

  /**
   * The file's imports, plus the three per-FILE facts the payload rules need —
   * in ONE walk (R2c).
   *
   * The signals used to come from a separate full traversal that had to run
   * before symbol extraction, because the taint sink rule asks whether the file
   * imports child_process while it is still building a symbol's payload. Since
   * the import walk needs no symbols, running it FIRST removes the second
   * traversal outright rather than deferring the question: every consumer below
   * reads the signals after this returns, and the `imports` array is unchanged
   * in content and order.
   */
  /** The three per-file facts, keyed on an import's module path. */
  private recordFileSignal(modulePath: string): void {
    if (
      modulePath === "react" || modulePath === "react-dom" || modulePath === "preact" ||
      modulePath === "preact/compat" || modulePath.startsWith("react/") || modulePath.startsWith("preact/")
    ) {
      this._fileSignals.hasReact = true
    }
    if (modulePath === "solid-js" || modulePath.startsWith("solid-js/") || modulePath.startsWith("@solidjs/")) {
      this._fileSignals.solidJs = true
    }
    if (modulePath === "child_process" || modulePath === "node:child_process") {
      this._fileSignals.importsChildProcess = true
    }
  }

  private scanImportsAndFileSignals(node: Node, imports: ASTEngine.ImportInfo[]): void {
        // `require("child_process")` and `await import("child_process")` are the
        // CommonJS and dynamic-import spellings of the same fact, and both hide it
        // in a CALL's argument: there is no import_statement and no
        // import_require_clause, so neither the imports walk nor the signal scan
        // that preceded it could see them. The consequence was a false NEGATIVE in
        // the taint sink rule — `const { execSync } = require("child_process")`
        // followed by a bare `execSync` produced no sink, because the rule's
        // evidence that a bare exec is Node's own never arrived. The callee must be
        // the bare `require` identifier or the `import` keyword; `foo.require(...)`
        // is somebody else's method and is deliberately excluded.
        if (node.type === "call_expression") {
          const callee = node.childForFieldName("function")
          if (callee && (callee.type === "import" || (callee.type === "identifier" && callee.text === "require"))) {
            const firstArg = node.childForFieldName("arguments")?.namedChild(0)
            if (firstArg && firstArg.type === "string") {
              this.recordFileSignal(stringContent(firstArg))
            }
          }
        }

    // JSX presence is the React signal the Rules-of-Hooks gate needs.
    if (node.type === "jsx_element" || node.type === "jsx_self_closing_element") {
      this._fileSignals.hasReact = true
    } else if (node.type === "import_require_clause") {
      // `import cp = require("child_process")` — here the node IS the module
      // string, which is why the old standalone scan read it separately.
      this.recordFileSignal(stringContent(node))
    }
    if (node.type === "import_statement") {
      const sourceNode = importStatementSource(node)
      if (!sourceNode) return

      const modulePath = stringContent(sourceNode)
      // `import m = require("./m")` IS a require: same edge shape, same default
      // rule, so it is recorded as one rather than as an ES import with no items.
      if (isImportRequireClause(node)) {
        const clauseNode = node.namedChildren.find((c: any) => c && c.type === "import_require_clause")
        const bindNode = clauseNode?.namedChildren?.find((c: any) => c && c.type === "identifier")
        imports.push({
          module: modulePath,
          items: ["*"],
          isDefault: !!bindNode,
          range: this.nodeRange(node),
          metadata: { type: "require" },
        })
        return
      }
      const items = extractImportItems(node)
      const clause = extractImportClause(node)
      this.recordFileSignal(modulePath)

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

    // Dynamic `import()` and CommonJS `require()` are BOTH module dependencies,
    // and the javascript twin records both. typescript recorded only the dynamic
    // form, so every `require` dependency in a TypeScript file was missing from
    // the module graph — silent, because nothing reported it: the file's imports
    // were simply short. Measured on the tracked corpus this is the second-largest
    // edge class, and `require` is how build shims, `.d.ts`-adjacent code and
    // older Node packages actually pull a dependency in. This repository's own
    // shims do it (`require("child_process")`, `require("bun:sqlite")`).
    if (node.type === "call_expression") {
      const callee = node.childForFieldName("function")
      const isImportCall = !!callee && (callee.type === "import" || (callee.type === "identifier" && callee.text === "import"))
      const isRequireCall = !!callee && callee.type === "identifier" && callee.text === "require"
      if (isImportCall || isRequireCall) {
        const args = node.childForFieldName("arguments")
        if (args && args.namedChildCount > 0) {
          const pathArg = args.namedChild(0)
          if (pathArg && (pathArg.type === "string" || pathArg.type === "template_string")) {
            const modulePath = stringContent(pathArg)
            imports.push({
              module: modulePath,
              items: ["*"],
              isDefault: isRequireCall ? requireBindsDefault(node) : false,
              range: this.nodeRange(node),
              ...(isRequireCall ? { metadata: { type: "require" } } : {}),
            })
          }
        }
      }
    }

    // Recurse
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child) {
        this.scanImportsAndFileSignals(child, imports)
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

    // 3. Extract call relationships (and, in the same walk, instantiations)
    this.extractCallRelationships(node, relationships, symbols)

    // 4. Extract usage/reference relationships
    this.extractUsageRelationships(node, relationships, symbols)

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
  /**
   * Is `node` a DECORATOR boundary? Used as the terminating condition of
   * `inDecoratorPosition`.
   *
   * PERF: this used to climb `.parent` from every node, and web-tree-sitter
   * implements `.parent` with a WASM DESCENDANT SEARCH (`ts_node_child_with_descendant`),
   * so the climb was O(depth) expensive calls per node and O(n x depth) per
   * traversal — measured at 5.2% of total wall clock on the vue lane's profile,
   * because a Vue SFC's TypeScript blocks go through this exact walk. The flag is
   * now THREADED down the recursion instead of recomputed: a decorator child sets
   * it true, any boundary sets it false, otherwise it is inherited. Same answer
   * (the decorator on a METHOD is a sibling of `method_definition`, never an
   * ancestor of the body), one boolean per node instead of a walk per node.
   */
  private isDecoratorBoundary(nodeType: string): boolean {
    return (
      nodeType === "class_declaration" ||
      nodeType === "abstract_class_declaration" ||
      nodeType === "class" ||
      nodeType === "function_declaration" ||
      nodeType === "method_definition" ||
      nodeType === "statement_block" ||
      nodeType === "program"
    )
  }

  /**
   * Whether `n` has a `decorator` ancestor with no intervening boundary.
   *
   * `ancestorInDecorator` is that same answer as already computed for `n`'s
   * parent by the traversal, so this is O(1). The `node.parent` climb remains as
   * the CORRECTNESS REFERENCE for callers outside a threaded walk; it is not on
   * the hot path any more.
   */
  /**
   * The decorator-position flag for a CHILD of `n`: a decorator opens the region,
   * a boundary closes it, anything else inherits. Pure and total, so the traversal
   * needs no ancestor bookkeeping beyond this one argument.
   */
  private nextDecoratorFlag(n: Node, inherited: boolean): boolean {
    if (n.type === "decorator") return true
    if (this.isDecoratorBoundary(n.type)) return false
    return inherited
  }

  private inDecoratorPosition(n: Node, ancestorInDecorator?: boolean): boolean {
    if (ancestorInDecorator !== undefined) return ancestorInDecorator
    let p: Node | null = n.parent
    while (p) {
      if (p.type === "decorator") return true
      if (this.isDecoratorBoundary(p.type)) return false
      p = p.parent
    }
    return false
  }

  /**
   * ONE walk for BOTH edge kinds that need only the enclosing symbol: `calls`
   * and `instantiates`. They were two full-tree traversals that each re-resolved
   * the enclosing symbol at every node (the same `resolveRelationshipSymbol`
   * call, the same module-leaf fallback) and differed only in what they emitted
   * — measured at 25-29% and 5-10% of analyze time respectively. The usage pass
   * stays separate: it carries a per-function `locals` scope, so folding it in
   * would mean carrying that state through a pass that does not want it.
   */
  private extractCallRelationships(
    node: Node,
    relationships: ASTEngine.UniversalRelationship[],
    symbols: ASTEngine.UniversalSymbol[],
  ): void {
    // PERF: `ancestorInDecorator` is threaded rather than recomputed per node.
    // See `inDecoratorPosition`: web-tree-sitter's `.parent` is a WASM descendant
    // search, so the old per-node climb was O(n x depth) of expensive calls and
    // profiled at 5.2% of the vue lane's wall clock.
    const processNode = (
      n: Node,
      currentSymbol: ASTEngine.UniversalSymbol | null,
      ancestorInDecorator = false,
    ): void => {
      currentSymbol = this.resolveRelationshipSymbol(n, symbols, currentSymbol)
      // M59 (#861): no call edge is emitted for a decorator invocation — see
      // inDecoratorPosition. The subtree is skipped whole, so a call nested in a
      // decorator's ARGUMENTS (`@inject(makeToken())`) is decorator position too,
      // which is exactly what the oracle now skips.
      if (this.inDecoratorPosition(n, ancestorInDecorator)) return

      // Extract call expressions, instantiations and JSX component usages
      // TSD4 (JAD2-class): the top-level fallback is the file's module LEAF
      // name — the same source imports/exports use — never a "(script)"
      // placeholder no consumer can resolve (JS parity: moduleName).
      const callSource = currentSymbol || { name: this.moduleLeafName(), scope: undefined, kind: "module" as any, range: { startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 }, metadata: {} as any }
      if (
        (n.type === "call_expression" || n.type === "new_expression" || n.type === "jsx_self_closing_element" || n.type === "jsx_element")
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
                if (child) processNode(child, currentSymbol, this.nextDecoratorFlag(n, ancestorInDecorator))
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
            // `require` is a module loader, not a call, exactly like `import`:
            // the twin skips both and emits a dependency edge instead. Pre-fix
            // typescript skipped only `import`, so `require("./m")` published
            // `calls -> require` — the file appearing to call a function named
            // `require`, which is not in the program — while the dependency it
            // actually names went unrecorded. The callee must be the BARE
            // identifier; `foo.require(...)` is somebody else's method.
            if (
              callee.text === "import" || callee.type === "import" ||
              (callee.type === "identifier" && callee.text === "require")
            ) {
              for (let i = 0; i < n.namedChildCount; i++) {
                const child = n.namedChild(i)
                if (child) processNode(child, currentSymbol, this.nextDecoratorFlag(n, ancestorInDecorator))
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
                if (child) processNode(child, currentSymbol, this.nextDecoratorFlag(n, ancestorInDecorator))
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
        } else if (n.type === "new_expression") {
          // Fused in from the former extractInstantiationRelationships: the
          // instantiation edge for a constructor the parser DID build. A `new`
          // whose constructor sits on the next line never reaches this branch
          // (the grammar does not build a new_expression for it — #858); it is
          // emitted above through the same helper, so both spellings produce
          // identical edges rather than merely similar ones.
          const constructor = n.namedChild(0)
          if (constructor) this.pushInstantiation(constructor, n, callSource, relationships)
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
          processNode(child, currentSymbol, this.nextDecoratorFlag(n, ancestorInDecorator))
        }
      }
    }

    processNode(node, null, false)
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
    /**
     * The names a symbol's PARAMETERS bind, read off the symbol's `parameters`
     * payload. That payload stringifies each binding as text — `a`, `{b}`,
     * `...rest` — so the identifier runs are pulled out with plain string
     * splitting rather than a pattern. Destructuring and rest parameters are
     * included because they bind names too.
     */
    const parameterNamesOf = (sym: ASTEngine.UniversalSymbol | null): Set<string> => {
      const out = new Set<string>()
      for (const prm of sym?.parameters ?? []) {
        const raw = typeof prm === "string" ? prm : ((prm as any)?.name ?? "")
        let token = ""
        for (let i = 0; i <= raw.length; i++) {
          const ch = raw[i] ?? ""
          const isWord = (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || (ch >= "0" && ch <= "9") || ch === "_" || ch === "$"
          if (isWord) token += ch
          else {
            if (token) out.add(token)
            token = ""
          }
        }
      }
      return out
    }
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
    const processNode = (n: Node, currentSymbol: ASTEngine.UniversalSymbol | null, locals: Set<string>, refShadowed: Set<string>): void => {
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
        refShadowed = new Set()
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

      // R13: a `for (const x of xs)` / `for (let k in o)` loop variable and a
      // `catch (e)` binding shadow a same-named file-level symbol, and the
      // reference pass resolved reads of them to that symbol — so a function
      // iterating a list of `file` published `references audit->file` against an
      // unrelated module-level `function file()`. Neither binding is reachable
      // through the `variable_declarator` handler above: tree-sitter places the
      // loop variable as a DIRECT child of `for_in_statement` (a for-of/for-in
      // head contains no `variable_declarator` node at all), and a catch binding
      // hangs off `catch_clause`.
      //
      // WHY THIS IS A SEPARATE SET and not `locals`: `locals` also gates the
      // `uses` edge, and a `uses` edge to a loop variable or catch binding is
      // wanted — the graph records `` `${e}` `` inside a catch as a use of
      // `e`, exactly as R12 keeps `greet -> name` for a parameter. Seeding
      // `locals` with these names removed 891 `uses` edges over 1200 files with
      // zero additions, which is the same over-suppression that mistake already
      // made once in R12. `refShadowed` is read by the `references` guard alone,
      // where the question is only "does this name resolve to a declaration here".
      if (currentSymbol && (currentSymbol.kind === ASTEngine.SymbolKind.Function || currentSymbol.kind === ASTEngine.SymbolKind.Method)) {
        if (n.type === "for_in_statement") {
          // The loop variable is the first named child: a bare `identifier`, or
          // a pattern node (patterns are already covered by the
          // object_pattern/array_pattern handler above, so only the bare form
          // is new here — which is why `for (const { a } of xs)` was already
          // right while `for (const file of xs)` was not).
          const lhs = n.namedChild(0)
          if (lhs && lhs.type === "identifier") refShadowed.add(lhs.text)
        }
        if (n.type === "catch_clause") {
          // The binding is the first named child ONLY when there is one; a bare
          // `catch { … }` has `statement_block` first and binds nothing,
          // and a read there genuinely does reach the outer declaration.
          const binding = n.namedChild(0)
          if (binding && binding.type === "identifier") refShadowed.add(binding.text)
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
              if (child) processNode(child, currentSymbol, locals, refShadowed)
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
        // A PARAMETER shadows every module- and class-level name for the whole
        // body of its function, and this pass resolves by NAME: with an
        // `interface Deps { root }` in the file, `function f(root) { return root
        // }` published `f->root`, recording the function as referencing an
        // interface property it never touches. Measured: 160 of 2,880 references
        // (5.6%) over 700 tracked files, led by `n`, `root`, `name`, `src`.
        //
        // The test belongs HERE and not in `locals`, because `locals` is also
        // what suppresses the `uses` edge — and a `uses` edge to a parameter is
        // wanted (interp-uses pins `greet -> name` for a template interpolation of
        // its own parameter). Seeding `locals` with parameters silenced those and
        // the fixture caught it. So: suppress the NAME-RESOLVED reference only.
        if (locals.has(name) || refShadowed.has(name) || parameterNamesOf(currentSymbol).has(name) || rhsOfTypeCheck) {
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
          processNode(child, currentSymbol, locals, refShadowed)
        }
      }
    }

    processNode(node, null, new Set(), new Set())
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
    // X8 (RULED 2026-09-27): construction candidates are NAMEABLE LEAVES only.
    //
    // Without this, an ANONYMOUS constructor publishes a span of SOURCE TEXT as a
    // name. Measured on this analyzer's own output: `new (e.constructor as any)(...)`
    // published `instantiates -> "constructor as any)"`, `new (getCtor())()` published
    // `"(getCtor())"`, and `new (class {})()` published `"(class {})"` — against a
    // correct `new Foo()` -> `Foo` control. A target that is source text names nothing
    // a consumer can navigate to, which is the unresolvable-identity class reached
    // through a malformed CONSTRUCT rather than a missing edge.
    //
    // This went unnoticed because the typescript ORACLE had the identical bug, so the
    // two agreed and the differential reported 100% — the same shared-premise shape as
    // the svelte reserved-namespace finding. Fixing the truth side is what exposed it;
    // see validation/m49/ledger.json SVELTE1/X8 and the D12-era commit.
    //
    // The list is the javascript twin's, which already carries this guard with the
    // comment "deriving their raw expression text fabricated unmatchable oracle edges
    // (lodash corpus)", plus `nested_identifier`, which the TypeScript grammar emits
    // for a qualified name and which excluding would suppress `new ns.Thing()`. Verified
    // by tree-walk over vue-core: the ONLY non-nameable constructor there is
    // `parenthesized_expression`.
    const NAMEABLE_CTOR = new Set([
      "identifier", "member_expression", "nested_identifier", "qualified_identifier",
      "generic_type", "template_type", "type_identifier", "type_descriptor", "primitive_type",
    ])
    if (!NAMEABLE_CTOR.has(constructor.type)) return

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

  /**
   * The first symbol with this name satisfying `pred`, in DECLARATION order —
   * `findItem`'s exact contract, answered from the name index when one exists
   * (R2b). One helper for all three call sites that used to be independent
   * linear scans over the whole symbol array: the enclosing-symbol resolver
   * (twice per declaration node, in two passes) and the override-keyword arm
   * (once per `override` member). Repeated names keep first-wins, which is the
   * contract rather than an accident: two classes each declaring `save()`
   * resolve to the same owner the array scan always chose.
   */
  private firstSymbolNamed(
    name: string,
    pred: (s: ASTEngine.UniversalSymbol) => boolean,
    symbols: ASTEngine.UniversalSymbol[],
  ): ASTEngine.UniversalSymbol | undefined {
    const bucket = this._symbolIndex?.get(name)
    if (bucket) {
      for (const s of bucket) if (pred(s)) return s
      return undefined
    }
    // No index (a caller outside the normal phase order): fall back to the
    // array, so resolution can never be WORSE than it was.
    return findItem(symbols, (s) => s.name === name && pred(s))
  }

  private extractOverrideRelationships(
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
  ): void {
    for (const symbol of symbols) {
      if (symbol.metadata?.isOverride && symbol.ownerName) {
        // Find the parent class
        const parentClass = this.firstSymbolNamed(
          symbol.ownerName,
          (s) => s.kind === ASTEngine.SymbolKind.Class,
          symbols,
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
    // M1: the same structural arm now walks a class's EXTENDS bases too, not
    // only its `implements`. `override` is OPTIONAL in TypeScript (it is only
    // required under `noImplicitOverride`), so the keyword arm above fires for
    // a minority of real overrides: `class Sub extends Base { run() {} }`
    // emitted nothing, while the identical member under `implements` paired.
    // The oracle already derives these as truth — `declParents` takes `extends`
    // AND `implements` edges whose target resolves in-file
    // (script/m14/differential.ts:12469) — so this was a live MISSING, proven
    // by running the oracle on the shape: truth `Sub.run -> Base.run`,
    // analyzer nothing.
    //
    // Lockstep rules, unchanged from the implements arm:
    //   - the CLASS side is METHODS only (a class field is
    //     `public_field_definition`, which the oracle excludes by name so truth
    //     cannot outrun the analyzer);
    //   - the BASE side is an interface's methods+properties, or a base CLASS's
    //     methods — the same member sets the oracle pools per declaration;
    //   - abstention: an overloaded name on either side cannot be paired
    //     name-only (no textual signature truth here; the oracle's
    //     `sigCompatible` gate would decide);
    //   - a base that resolves to no in-file declaration abstains, which is
    //     also how a QUALIFIED base (`extends ns.Base`) abstains — the oracle
    //     skips dotted declParents for the same reason;
    //   - a keyword-emitted edge is never duplicated (seenOverride is seeded
    //     from the edges already pushed).
    const classByName = new Map<string, ASTEngine.UniversalSymbol>()
    for (const s of symbols) {
      if (s.kind === ASTEngine.SymbolKind.Class) classByName.set(s.name, s)
    }
    for (const cls of symbols) {
      if (cls.kind !== ASTEngine.SymbolKind.Class) continue
      const implemented = (cls.metadata?.implements as string[] | undefined) ?? []
      const extended = (cls.metadata?.extends as string[] | undefined) ?? []
      const bases = [...implemented, ...extended]
      if (bases.length === 0) continue
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
        const ifaceDecl = ifaceByName.get(base)
        const classDecl = classByName.get(base)
        const baseDecl = ifaceDecl ?? classDecl
        if (!baseDecl) continue // external/unresolved base: not in-file truth
        const isInterfaceBase = ifaceDecl !== undefined && classDecl === undefined
        const baseMembers = isInterfaceBase ? (ifaceMembers.get(base) ?? []) : (classMethods.get(base) ?? [])
        for (const m of members) {
          if ((memberCounts.get(m.name) ?? 0) > 1) continue
          const matching = baseMembers.filter((bm) => bm.name === m.name)
          // Overload abstention on the base side too: two declarations of the
          // name in the base cannot be paired name-only.
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
            metadata: isInterfaceBase ? { implementedInterface: base } : { extendedClass: base },
          })
        }
        // transitive: an interface base continues along `extends`; a class base
        // along ITS extends/implements — the same links the oracle's declParents
        // pools for that declaration.
        const baseExtends = baseDecl.metadata?.extends as string[] | undefined
        if (baseExtends) queue.push(...baseExtends)
        const baseImplements = baseDecl.metadata?.implements as string[] | undefined
        if (baseImplements) queue.push(...baseImplements)
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
      const sourceNode = importStatementSource(node)
      if (!sourceNode) return

      const modulePath = stringContent(sourceNode)
      if (isImportRequireClause(node)) {
        const clauseNode = node.namedChildren.find((c: any) => c && c.type === "import_require_clause")
        const bindNode = clauseNode?.namedChildren?.find((c: any) => c && c.type === "identifier")
        relationships.push({
          source: this.moduleLeafName(),
          target: `${modulePath}:*`,
          type: ASTEngine.RelationshipType.Imports,
          confidence: 1.0,
          ...this.lineField(bindNode ?? sourceNode),
          metadata: { module: modulePath, isRequire: true, isDefault: !!bindNode },
        })
        return
      }
      const items = extractImportItemsWithNodes(node)

      // A SIDE-EFFECT-ONLY import — `import './style.css'` — has no clause and so
      // contributes no items, and the loop below emitted nothing for it. That is a
      // dependency the file plainly has: element-plus's every component does
      // `import '@element-plus/theme-chalk/src/<name>.scss'` and
      // `import '@element-plus/components/<name>/style'`, and none of them were in
      // the graph, so the style half of every component was invisible. Found by
      // the lane's new `imports` oracle, which derived 12 such rows against an
      // analyzer that published none on a 152-file draw while agreeing on 1,201 of
      // 1,201 named rows.
      //
      // The distinction is `import_clause` ABSENT, not "no items": `import {} from
      // "m"` names a module too, but it is an empty binding list rather than a
      // dependency on the module for its side effects, and only the absent clause
      // says the latter. The target is `*`, the same whole-module shape a namespace
      // import and a `require` publish, because nothing was asked for by name.
      const hasClause = node.namedChildren.some((c: any) => c && c.type === "import_clause")
      if (!hasClause) {
        relationships.push({
          source: this.moduleLeafName(),
          target: `${modulePath}:*`,
          type: ASTEngine.RelationshipType.Imports,
          confidence: 1.0,
          ...this.lineField(sourceNode),
          metadata: { module: modulePath, isSideEffectImport: true },
        })
        return
      }

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
      const callee = node.childForFieldName("function")
      // `require("m")` is a module dependency in the same sense as
      // `import("m")`, and the twin emits it. Pre-fix typescript emitted a
      // `calls → require` edge instead: the dependency was missing AND the
      // module loader was published as if the file called a function named
      // `require` — two wrong edges from one construct.
      const isDynamicImport = !!callee && (callee.text === "import" || callee.type === "import")
      const isRequireCall = !!callee && callee.type === "identifier" && callee.text === "require"
      if (isDynamicImport || isRequireCall) {
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
              // A `require` is a STATIC CommonJS dependency, not a dynamic import.
              // Labelling it `isDynamic` was wrong in the first cut of the require
              // port, which reused the dynamic branch wholesale — the edge was
              // right and its metadata claimed the module was loaded lazily.
              ...(isDynamicImport ? { isDynamic: true } : { isRequire: true, isDefault: requireBindsDefault(node) }),
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
      // M4: an ANONYMOUS default export (`export default function(){}`,
      // `export default 42`) has no binding name, so `default` names no symbol
      // in this or any other file. The ExportInfo row stays — "this module has
      // a default export" is true and worth storing — but the graph edge did
      // not: every `module -> default` edge was a target no index could join,
      // one per statement in a file that default-exports twice.
      if (item.name === "default" && item.type === "default_export_expression") continue
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
    // R2a: one name -> FIRST-declared-symbol index, built in a single pass.
    // This loop was O(n^2): a linear `findItem` per member that has an owner,
    // which is the one surviving half of the "no O(n^2] scans" claim the
    // analyzer doc used to make. `findItem` returned the FIRST name match, so
    // the index keeps the first occurrence per name and the resolution is
    // behaviour-identical — including for the repeated-name case (two classes
    // each with a `save()`), where first-wins is the contract, not an accident.
    const firstByName = new Map<string, ASTEngine.UniversalSymbol>()
    for (const s of symbols) {
      if (!firstByName.has(s.name)) firstByName.set(s.name, s)
    }
    for (const symbol of symbols) {
      if (symbol.ownerName) {
        const owner = firstByName.get(symbol.ownerName)
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
    // R2b: the shared indexed lookup (see firstSymbolNamed) — the scan is
    // shorter, the answer is identical.
    const firstMatchIn = (name: string, pred: (s: ASTEngine.UniversalSymbol) => boolean) =>
      this.firstSymbolNamed(name, pred, symbols)
    const byPos = (name: string, kind: ASTEngine.SymbolKind, line: number, col: number, owner?: string) =>
      firstMatchIn(
        name,
        (s) =>
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
        firstMatchIn(name, (s) => s.kind === ASTEngine.SymbolKind.Function) ||
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
        const ownerSym = firstMatchIn(nm, (s) => s.kind === ASTEngine.SymbolKind.Class)
        if (ownerSym) return ownerSym
      }
      return current
    }

    if (node.type === "method_definition") {
      const raw = node.childForFieldName("name")?.text
      if (!raw) return current
      const name = stripPrivatePrefix(raw)
      // R1: ONE owner rule for every member kind, the twin's
      // `containerOwnerName` — the same helper that named the SYMBOL now names
      // the EDGE's source, so the two can never disagree. That disagreement was
      // live and cost a whole class of edges: the old walk only recognised
      // `class_declaration`, so for `const A = class Inner { m() { helper() } }`
      // it fell through to the nearest `variable_declarator` and computed owner
      // `A` while the symbol's ownerName was `Inner`; the owner-scoped lookup
      // then matched nothing and every call inside `m` was emitted against the
      // MODULE leaf (`x -> helper`). The hand-rolled walk also had to
      // re-implement the function-boundary rule that W1 needed, in two places.
      const owner = containerOwnerName(node)
      return (
        byPos(name, ASTEngine.SymbolKind.Method, node.startPosition.row, node.startPosition.column, owner) ||
        firstMatchIn(
          name,
          (s) => s.kind === ASTEngine.SymbolKind.Method && (!owner || s.ownerName === owner),
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
          firstMatchIn(name, (s) => s.kind === ASTEngine.SymbolKind.Function) ||
          current
        )
      }
    }

    return current
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

  /** Dotted call paths made by `ownerName`'s body — the java convention
   *  (no argument text: `db.list(user).map` is stored as `db.list.map`).
   *
   *  M3: the walk now crosses nested-function boundaries and REBINDS on every
   *  function-like node through the SAME resolver the relationship pass uses
   *  (`resolveRelationshipSymbol`), which is what the javascript twin's
   *  `qcWalk` does. The old walk stopped at every nested function, so:
   *    - a callback's calls were missing from the payload while the graph
   *      carried the edge (`items.map(i => helper())` emitted `outer->helper`
   *      and listed only `items.map`) — payload and graph disagreed about the
   *      same call, and the two analyzers disagreed with each other
   *      (javascript listed `["items.map","helper"]` for the same source);
   *    - deleting the boundary alone would have been wrong the other way: a
   *      nested function that IS a symbol (a nested `function inner(){}` is
   *      extracted) would list its calls on BOTH symbols.
   *  Rebinding is what makes both correct. Decorator position needs no guard
   *  here: a decorator is a sibling of the definition it decorates, so it
   *  never appears inside the body subtree this walk starts from. */
  private extractQualifiedCalls(
    node: Node,
    owner: ASTEngine.UniversalSymbol,
    symbols: ASTEngine.UniversalSymbol[],
    out: Map<ASTEngine.UniversalSymbol, string[]>,
  ): void {
    const walk = (n: Node, currentOwner: ASTEngine.UniversalSymbol) => {
      // Same rebinding contract as extractCallRelationships: a function-like
      // node that resolves to a symbol owns the calls inside it; anything else
      // (a callback, a local arrow) keeps the enclosing symbol.
      const rebound = this.resolveRelationshipSymbol(n, symbols, null)
      const ownerSym = rebound ?? currentOwner

      if (n.type === "call_expression") {
        const callee = n.namedChild(0)
        if (callee) {
          // T8 (review wave): dynamic import() is a module dependency, not a
          // call — the relationship walk already skips the `import` callee
          // (T7 fix); the qualified-calls payload did not, leaking "import"
          // into symbol call lists.
          // `require` joins `import` here: both are module loaders, not calls.
          // The twin skips both, so a symbol's call list must not contain
          // "require" — it is a dependency edge, emitted above.
          const calleeIsImport = callee.type === "import" ||
            (callee.type === "identifier" && (callee.text === "import" || callee.text === "require"))
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
            const path = parts.filter(Boolean).join(".")
            if (path) {
              const list = out.get(ownerSym) ?? []
              list.push(path)
              out.set(ownerSym, list)
            }
          }
        }
      }

      for (let i = 0; i < n.namedChildCount; i++) {
        const child = n.namedChild(i)
        if (child) walk(child, ownerSym)
      }
    }

    const body = node.childForFieldName("body")
    if (body) walk(body, owner)
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

    // The sink rules are RECEIVER-based, matching the family contract: java
    // flags `stmt.executeQuery`, python flags `cursor.execute` — never a bare
    // `execute()`. The pre-fix rules matched a bare name or a bare LEAF, so
    // `re.exec(input)` (RegExp.prototype.exec — not a shell at all) and any
    // project-local `execute(q)` were reported as command_injection /
    // sql_injection. That is not a payload-only defect: parallel-indexer
    // multiplies every source by every sink in a symbol into
    // `brain_taint_flow`, and `bb_security` reports that table — so one
    // `req.body` read in a function that also called `.exec()` manufactured a
    // persisted command-injection finding. The source-side rules were already
    // receiver-leaf (TSD17); this aligns the sink side with them.
    const segmentsOf = (text: string): string[] => {
      const out: string[] = []
      for (const part of text.split(".")) {
        const t = part.trim()
        if (t) out.push(t)
      }
      return out
    }

    const traverse = (n: Node) => {
      if (n.type === "call_expression") {
        const calleeText = n.childForFieldName("function")?.text || ""
        const segs = segmentsOf(calleeText)
        const leaf = segs.length > 0 ? segs[segs.length - 1] : ""
        const hasReceiver = segs.length >= 2
        const receiver = hasReceiver ? segs[0] : ""

        // shell execution: a child_process-shaped RECEIVER plus an exec-family
        // LEAF, or a BARE exec-family name in a file that imports
        // child_process (that import is the evidence the name is Node's).
        if (
          (hasReceiver && TS_SHELL_RECEIVERS.has(receiver) && TS_SHELL_LEAVES.has(leaf)) ||
          (!hasReceiver && this._fileSignals.importsChildProcess && TS_SHELL_LEAVES.has(leaf))
        ) {
          sinks.push({ type: "shell_execution", snippet: n.text, vulnerability_type: "command_injection" })
        }
        // database write: a member call on a query/execute leaf — receiver-based,
        // exactly like the java/python family rules.
        if (hasReceiver && (leaf === "query" || leaf === "execute")) {
          sinks.push({ type: "database_write", snippet: n.text, vulnerability_type: "sql_injection" })
        }
        // http response: unchanged, already receiver-shaped.
        if (calleeText === "res.send" || calleeText === "res.html" || calleeText.endsWith(".innerHTML")) {
          sinks.push({ type: "http_response", snippet: n.text, vulnerability_type: "xss" })
        }
        // filesystem: unchanged, already receiver-shaped.
        if (
          calleeText === "fs.readFile" ||
          calleeText === "fs.writeFile" ||
          calleeText === "fs.readFileSync" ||
          calleeText === "fs.writeFileSync"
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

// Taint sink vocabulary (H1). Receivers and leaves are listed SEPARATELY so the
// rule can demand both: a shell sink needs a child_process-shaped RECEIVER and
// an exec-family LEAF, which is exactly what `RegExp.prototype.exec` and a
// project's own `spawn()` fail. Pure string sets — no regex, no text search.
const TS_SHELL_RECEIVERS = new Set([
  "child_process", "childProcess", "cp", "proc", "shell", "sh", "bash", "zsh", "execa",
])
const TS_SHELL_LEAVES = new Set([
  "exec", "execSync", "execFile", "execFileSync", "spawn", "spawnSync", "fork",
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

export class RealTypeScriptAnalyzer implements ASTEngine.LanguageAnalyzer {

  analyze(
    rootNode: Node,
    content: string,
    filePath: string,
  ): ASTEngine.ParseResult & { metadata: Partial<ASTEngine.FileMetadata> } {
    return new TypeScriptAnalysisRunner().analyze(rootNode, content, filePath)
  }
}
