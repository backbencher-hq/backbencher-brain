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
import { treeContainsNodeType } from "./node-walk"

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

/**
 * The node that SPELLS the last segment of an assignment target, for both
 * shapes the grammar produces: `a.b` is a `member_expression` (field
 * `property`) and `a["b"]` / `a[0]` is a `subscript_expression` (field
 * `index`). The pre-fix CJS branch read `property` unconditionally, so a
 * computed final segment was invisible. Returns null when the target is not a
 * member/subscript at all.
 */
function writtenSegment(prop: Node | null, lhs: Node): Node | null {
  if (prop) return prop
  if (lhs.type === "subscript_expression") return lhs.childForFieldName("index")
  return null
}

/** The NAME a written segment spells — a quoted index reads as its contents. */
function segmentName(node: Node): string {
  return node.type === "string" ? stringContent(node) : node.text
}

function hasBraceEquals(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === "{" || ch === "}" || ch === ";" || ch === "=") return true
  }
  return false
}

/**
 * M49 #868: the decorator's NAME, from a `decorator` node's own text.
 * `@observable` -> observable; `@computed({x})` -> computed;
 * `@lib.inject("db")` -> lib.inject (the callee expression, arguments
 * stripped). Previously inlined in the own-child collector; shared now that
 * three call sites need it (class, method, field) and they must agree on the
 * spelling the reference edge carries.
 */
function jsDecoratorName(decorator: Node): string {
  const inner = decorator.namedChild(0)
  const nameText =
    inner && (inner.type === "call_expression" || inner.type === "member_expression" || inner.type === "identifier")
      ? inner.type === "call_expression"
        ? (inner.childForFieldName("function")?.text ?? inner.text.split("(")[0])
        : inner.text.split("(")[0]
      : decorator.text
  return stripLeadingAt(nameText) || stripLeadingAt(decorator.text)
}

/**
 * `/^@/` as a prefix check (M49.R2: the AST regex census counted the literal
 * as review-class debt; a single-character prefix needs no regex).
 */
function stripLeadingAt(text: string): string {
  return text.startsWith("@") ? text.slice(1) : text
}

function stripWhitespace(text: string): string {
  let out = ""
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch !== " " && ch !== "\t" && ch !== "\n" && ch !== "\r") out += ch
  }
  return out
}

// J3 (review wave): span containment against superseded duplicate bodies.
// A node is dead when it sits inside a dead span (self or any ancestor).
//
// PERF (2026-09-30, measured): the ancestor walk runs BEFORE the span loop can
// reject, so with an empty `spans` list this walked to the ROOT of the tree and
// returned false — for every node of the file. `qcWalk` calls it once per node,
// and on minified input that is 1,165,905 nodes at a mean depth of 25.9 (max 75),
// so ~30 MILLION parent hops whose every answer was `false`. CPU-profiled on
// `aspnetcore/.../RoutingSandbox/wwwroot/full.render.js` (1.89 MB, 84 lines, one
// line 310,647 chars): this function was **44.6% of all samples**, and the
// analyzer took 357s against the parser's 4.8s — 75x the parse, which is the
// signature of a per-node tree walk rather than of a hard parse.
//
// The empty-list short-circuit below is EXACTLY equivalent: with no spans there is
// nothing to be inside, so the answer is false for every node, and the walk cannot
// change that. It is the whole fix for the common case, which is the common case
// because dead spans only exist when a duplicate method body was superseded.
function isNodeInDeadSpans(spans: { s: number; e: number }[], n: Node): boolean {
  if (spans.length === 0) return false
  let p: Node | null = n
  while (p) {
    for (const d of spans) {
      if (d.s <= p.startIndex && p.endIndex <= d.e) return true
    }
    p = p.parent
  }
  return false
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

/**
 * The OWNER of a member whose container is not a class scope.
 *
 * `scopeOwnerName` reports CLASS scopes only, and only `class_declaration` pushes
 * one, so every member of an OBJECT LITERAL and every member of a CLASS
 * EXPRESSION came out ownerless — and `addContainmentRelationships` gates on
 * `ownerName`, so those members produced NO containment edge at all. Measured
 * (M60 review JD3): 308 of 2,833 symbols (10.9%) on a 400-file production
 * sample. It first became VISIBLE only when the differential started auditing
 * `contains` (M60 review JD14): 68 MISSING rows on the svelte corpus's 60-file
 * draw, every one an object-literal or class-expression member.
 *
 * The rule is the language's, not the analyzer's: a member belongs to whatever
 * encloses it. A class expression is owned by its own name, or failing that by
 * the binding it is assigned to (`const K = class { … }`); an object literal by
 * the binding it is assigned to (`const api = { run() {} }`). A member that
 * reaches a FUNCTION boundary first has no declarator to name and stays
 * ownerless — which is honest, because nothing in the language names it.
 */
/**
 * The NAME a value expression is bound to, looking upward through the
 * transparent wrappers that can sit between a value and its binding.
 *
 * `const K = class {…}` binds through a `variable_declarator`; `K = class {…}`
 * binds through an `assignment_expression`. Anything else — a call argument, a
 * `return`, an array element, a `pair` value that is itself an object — names
 * nothing, and the answer is `undefined` rather than a guess. Measured on the
 * svelte corpus: 183 of 204 remaining ownerless members are this case (correct
 * silence) and 20 were the assignment form (a real gap, now closed).
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
    if (q.type === "pair" || q.type === "object" || q.type === "return_statement" ||
        q.type === "expression_statement" || q.type === "export_statement") {
      q = q.parent
      continue
    }
    return undefined
  }
  return undefined
}

function containerOwnerName(n: Node): string | undefined {
  let p: Node | null = n.parent
  while (p) {
    if (p.type === "class_declaration") return p.childForFieldName("name")?.text
    if (p.type === "class") {
      // A class EXPRESSION: its own declared name wins, else the binding it is
      // assigned to — by declarator OR by plain assignment. The assignment form
      // is not a corner case: it is how a custom-element base is written
      // (svelte `packages/svelte/src/internal/client/dom/elements/
      // custom-element.js`: `SvelteElement = class extends HTMLElement { … }`),
      // and omitting it left 20 members ownerless on a 400-file production draw
      // even after the declarator form was handled.
      const own = p.childForFieldName("name")?.text
      if (own) return own
      return bindingNameAbove(p)
    }
    if (p.type === "object") {
      // An object literal: owned by the binding it initialises. A literal that
      // is a call argument, a return value, or an array element has no binding
      // to name and stays ownerless — which is correct, not a gap.
      return bindingNameAbove(p)
    }
    // A function boundary ends the search: nothing inside a function body is
    // a module-level member of anything.
    if (p.type === "function_declaration" || p.type === "function_expression" ||
        p.type === "arrow_function" || p.type === "generator_function_declaration" ||
        p.type === "method_definition" || p.type === "function") return undefined
    p = p.parent
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
  /**
   * Whether the file currently being analyzed contains any `decorator` node.
   * Set once per `analyze` call; see the pre-pass at its assignment for the
   * measurement that made it worth having.
   */
  private hasAnyDecoratorNode = false

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

    // PERF (2026-09-30, measured): does this tree contain ANY `decorator` node?
    //
    // `inDecoratorPosition` answers true only when some ancestor is a decorator,
    // so a tree with no decorator node can only ever answer false — and it was
    // walking the ancestor chain to the enclosing boundary to discover that, once
    // per node. On the same minified file as the `isNodeInDeadSpans` fix, the tree
    // has **0 decorator nodes** across 1,165,905 nodes at mean depth 25.9, and this
    // predicate was **15.0% of all CPU samples** on top of that function's 44.6%.
    //
    // One pre-pass with an early exit settles it, and it is exactly equivalent:
    // the predicate's own logic is unchanged for files that do have decorators.
    this.hasAnyDecoratorNode = treeContainsNodeType(rootNode, "decorator")

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
    // owner:name -> symbol index — overload/duplicate dedup, LAST wins (J3).
    // Superseded body spans: the FIRST body was already descended (stack
    // discipline), so its nested symbols are pruned and its calls/uses
    // skipped by span checks in the relationship passes below.
    const seenMethodIdx = new Map<string, number>()
    const deadSpans: { s: number; e: number }[] = []
    // B5 cross-kind zombies: accessor symbols killed by a data-member
    // replacement are removed AFTER the walk — a mid-walk splice would
    // shift every later seenMethodIdx index and corrupt J3 last-wins.
    const b5Zombies: number[] = []
    // JD6: which relationship row came from which node, for the edges pushed
    // DURING the walk. The two post-walk relationship passes already re-check
    // `isNodeInDeadSpans`, but the edges pushed inline during the walk — the
    // heritage, CJS-export, import and decorator rows — never did, so a symbol
    // removed as dead kept its edges and the graph gained rows whose source or
    // target is not in the index. Recorded by position rather than matched by
    // name, because two symbols can share a name and only one of them be dead.
    const relSpans: Array<{ idx: number; s: number; e: number }> = []

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

      const relMark = relationships.length
      switch (node.type) {
        case "class_declaration": {
          const name = node.childForFieldName("name")?.text
          if (name) {
            const comments = this.collectComments(node)
            const dec = this.collectClassDecoratorDetails(node)
            const decorators = dec.names
            symbols.push({
              name,
              kind: ASTEngine.SymbolKind.Class,
              range: this.nodeToRange(node),
              scope: scopeString(scopeStack),
              visibility: "public",
              decorators: decorators.length > 0 ? decorators : undefined,
              comments,
              metadata: {
                isClass: true,
                // M49 #868: parallel to `decorators`, so a decorator's
                // reference edge can name the line the decorator is written
                // on (the M59 #860 contract the typescript twin already has).
                ...(dec.lines.length > 0 ? { decoratorLines: dec.lines } : {}),
              },
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
                  ...this.lineField(base),
                  metadata: {},
                })
              }
            }
          }
          break
        }

        case "class": {
          // M60 / JD4: a CLASS EXPRESSION. There was no case for it at all, so
          // `const K = class extends Base { … }` produced no extends edge, no
          // Class symbol, and left every member ownerless — the whole
          // declaration form was invisible. Heritage is what this adds here; the
          // Class symbol and the member owner are JD3's (the member owner is
          // already handled via containerOwnerName, and the class symbol itself
          // is deliberately still not emitted, because
          // javascript/class-expression-member-identity expects the bound
          // variable to remain the symbol).
          //
          // The differential's heritage walk (differential.ts) was missing the
          // same shape, so both sides were blind and the lane reported
          // agreement. The oracle moved with this change — otherwise an edge
          // emitted here would register as a fabrication.
          const ownName = node.childForFieldName("name")?.text ?? bindingNameAbove(node)
          const heritage = this.findChildByType(node, "class_heritage")
          // An anonymous class expression with NO BINDING (`runIt(class extends
          // Base {})`) names nothing, so it gets NO edge at all. The first cut of
          // this pushed `source: ownName ?? ""` and produced an edge from the
          // empty string — a dangling row whose source is not a symbol, which is
          // the same defect class as JD6. Silence is the honest answer; the
          // base is still reachable through the class_heritage in the AST.
          if (heritage && ownName) {
            const base = this.findChildByType(heritage, "identifier") ?? this.findChildByType(heritage, "member_expression")
            if (base) {
              relationships.push({
                source: ownName,
                target: base.text,
                type: ASTEngine.RelationshipType.Extends,
                confidence: 1.0,
                ...this.lineField(base),
                metadata: {},
              })
            }
          }
          // NOTE: no Class scope is pushed here. Ownership of a class
          // expression's members already comes from containerOwnerName (JD3), and
          // pushing a scope would additionally set `ownerKind = Class`, which
          // re-keys `qualified_calls` to `Owner::method` — a behaviour change
          // javascript/class-expression-member-identity deliberately pins against.
          // This case adds the EDGE only.
          break
        }

        case "method_definition": {
          const name = node.childForFieldName("name")?.text
          if (name) {
          // ownerKind stays Class ONLY for a real class scope: the
          // qualified_calls key (and the J1 owner-qualification it depends on)
          // keys on `ownerKind === Class`, so a container owner must not
          // promote an object-literal member into the owner-qualified form.
          const classOwner = scopeOwnerName(scopeStack)
          const owner = classOwner ?? containerOwnerName(node)
          const isConstructor = name === "constructor"
          const isAccessor = this.hasToken(node, "get") || this.hasToken(node, "set")
          // B5 (M49 #758, self-audit wave): get/set on the SAME name are
          // DISTINCT descriptor slots (Object.getOwnPropertyDescriptor
          // returns {get, set} — both survive; the J3 last-wins pin below
          // targets true duplicates, and the pre-fix owner:name key ate the
          // pair, deadSpanned the getter's body, and dropped its calls).
          // Runtime slot semantics kept honest: a DATA member replaces the
          // whole slot (`get x` then `x()` → x is data), while accessors
          // MERGE (get+set coexist). Keys: plain for data, :get/:set for
          // accessors; the cross-kind checks below implement replace-on-val.
          const kindSlot = isAccessor ? (this.hasToken(node, "get") ? ":get" : ":set") : ""
          // M49 W2 (#769): the CONTAINER is part of a member's identity.
          // `scopeOwnerName` only knows CLASS scopes, so every object-literal
          // member of the module previously shared one key (`module:<name>`):
          // the second `init()`/`default()` of a SIBLING object literal
          // replaced the first, dead-spanning its body and dropping its calls.
          // Lane-visible on vue-element-admin MarkdownEditor (two prop-default
          // factories -> truth derived random/toFixed, the analyzer neither).
          // The containing object literal's span is its identity; duplicates
          // INSIDE one object still collapse last-wins (J3 + the dup-key
          // Option A ruling) because they share the same key.
          // M49 W13: a CLASS EXPRESSION has no declared name, and only
          // `class_declaration` pushes a Class scope, so `scopeOwnerName`
          // returned undefined for every member of every anonymous class
          // expression and they ALL shared the key `module:<name>`: the
          // second class expression's `constructor` replaced the first's,
          // dead-spanning its body and dropping its edges. Measured on the
          // svelte corpus: `custom-element.js` defines TWO class expressions
          // (`SvelteElement = class extends HTMLElement`, and `Class = class
          // extends SvelteElement` inside `create_custom_element`), each with
          // a `constructor`, so `this.attachShadow(shadow_root_init)` in the
          // first vanished — the second javascript-lane MISSING edge W12's
          // 400-file measurement registered. The containing class's span is
          // its identity, exactly as W2 (#769) did for object literals;
          // duplicates INSIDE one class still collapse last-wins (J3).
          const parentType = node.parent?.type
          // The CONTAINER SPAN is the member's identity, and it must be
          // preferred over the owner's NAME.
          //
          // M60 review JD3 taught this the hard way. This used to read
          // `owner ?? obj@span`, which was safe only while object-literal
          // members were OWNERLESS (W2 #769 introduced the span precisely
          // because `scopeOwnerName` could not name them). Giving those members
          // an owner — so they finally emit a `contains` edge — made `owner`
          // defined and short-circuited the span away, so two NESTED literals
          // under one binding collided again:
          //   const cfg = { alpha: { init(){} }, beta: { init(){} } }
          // both resolved to `cfg:init`, the second replaced the first, and the
          // first's symbol and its `calls` edge were dead-spanned —
          // re-breaking the exact defect javascript/sibling-object-member-
          // identity exists to hold shut. A name is coarser than a span: two
          // containers can share an owner and never share a span.
          const containerKey =
            parentType === "object"
              ? `obj@${node.parent!.startIndex}`
              : parentType === "class_body"
                ? `cls@${node.parent!.startIndex}`
                : owner
          // M49 W15 (#813): the dedup key uses the DECLARED name. A class may
          // legitimately declare both `x` and `#x` as distinct members, so
          // stripping `#` here made two different members share one slot (the
          // last declaration would have dead-spanned the first). The key is
          // internal, but "one member, one name" has to hold at this layer too
          // or the graph-visible name cannot be the declared one.
          const dedupKey = `${containerKey ?? "module"}:${name}${kindSlot}`
            const kind = isConstructor
              ? ASTEngine.SymbolKind.Constructor
              : isAccessor
                ? ASTEngine.SymbolKind.Property
                : ASTEngine.SymbolKind.Method
            const isStatic = this.hasToken(node, "static")
            const isAsync = this.hasToken(node, "async")
            const isGenerator = this.hasToken(node, "*")
            const isPrivateMethod = name.startsWith("#")
            // J3 (review wave): LAST declaration wins — first-wins kept the
            // dead redeclaration while the runtime (and the TS analyzer)
            // use the last body. Replace in place so scope push/pop stay
            // balanced; prototype assignments share the key (a prototype
            // assignment genuinely overwrites the class method).
            let seenIdx = seenMethodIdx.get(dedupKey)
            let seenKey: string | undefined = seenIdx === undefined ? undefined : dedupKey
            if (seenIdx === undefined) {
              // B5 cross-kind resolution (M49 #758): a data member and an
              // accessor share the runtime descriptor slot. Data kills the
              // whole slot (find either accessor half); an accessor takes
              // over a data member's slot.
              if (kindSlot === "") {
                for (const opp of [":get", ":set"]) {
                  const k2 = dedupKey + opp
                  const i2 = seenMethodIdx.get(k2)
                  if (i2 !== undefined) { seenIdx = i2; seenKey = k2; break }
                }
              } else {
                const k2 = dedupKey.slice(0, dedupKey.length - kindSlot.length)
                const i2 = seenMethodIdx.get(k2)
                if (i2 !== undefined) { seenIdx = i2; seenKey = k2 }
              }
            }
            {
              const params = this.extractParameters(node.childForFieldName("parameters"))
              const comments = this.collectComments(node)
              // Decorators are OWN children of method_definition in the JS
              // grammar (unlike TS where method decorators are class_body
              // siblings).
              const dec = this.collectOwnDecoratorDetails(node)
              const decorators = dec.names
            var methodSymbol: ASTEngine.UniversalSymbol = {
              // #813: the declared spelling IS the member's name (every edge
              // that reads it carries the `#`; see the TS site's note).
              name,
              kind,
              range: this.nodeToRange(node),
              scope: scopeString(scopeStack),
              ownerName: owner,
              ownerKind: classOwner ? ASTEngine.SymbolKind.Class : undefined,
              // '#' members are class-private regardless of other tokens.
              visibility: isPrivateMethod ? "private" : "public",
              isStatic,
              parameters: params,
              decorators: decorators.length > 0 ? decorators : undefined,
              comments,
              complexity: this.methodComplexity(node),
              metadata: {
                isAccessor,
                isAsync,
                isGenerator,
                ...((kindSlot ? { accessorKind: kindSlot === ":get" ? "get" : "set" } : {}) as Record<string, unknown>),
                // M49 #868: the decorator's own line, parallel to
                // `decorators` (same lockstep as the typescript twin).
                ...(dec.lines.length > 0 ? { decoratorLines: dec.lines } : {}),
              },
            }
            }
            if (seenIdx === undefined) {
              seenMethodIdx.set(dedupKey, symbols.length)
              symbols.push(methodSymbol)
            } else {
              const oldRange = symbols[seenIdx].range
              if (oldRange && oldRange.startIndex !== undefined && oldRange.endIndex !== undefined) deadSpans.push({ s: oldRange.startIndex, e: oldRange.endIndex })
              // B5: a data member kills BOTH accessor halves of the slot —
              // the replaced half via seenKey below, any sibling half here
              // (zombied for post-walk removal + deadSpanned so its body's
              // nested symbols/calls die with it).
              // M49 W2 (#769): the sibling half is identified by the exact
              // SLOT KEY (`<container>:<name>:get` / `:set`), not by an
              // owner+name text match — the text match also caught same-named
              // accessors of OTHER object literals, whose bodies then died.
              if (kindSlot === "") {
                const otherKey = seenKey === dedupKey + ":get" ? dedupKey + ":set" : seenKey === dedupKey + ":set" ? dedupKey + ":get" : undefined
                const otherIdx = otherKey !== undefined ? seenMethodIdx.get(otherKey) : undefined
                if (otherIdx !== undefined && otherIdx !== seenIdx) {
                  const rj = symbols[otherIdx]?.range
                  if (rj && rj.startIndex !== undefined && rj.endIndex !== undefined) deadSpans.push({ s: rj.startIndex, e: rj.endIndex })
                  b5Zombies.push(otherIdx)
                }
              }
              symbols[seenIdx] = methodSymbol
              // Re-key: the incoming slot owns future lookups; the old key
              // dies (a stale bare key would wrongly route the next accessor
              // into replace- instead of merge-semantics).
              if (seenKey) seenMethodIdx.delete(seenKey)
              seenMethodIdx.set(dedupKey, seenIdx)
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
            // #813: keep the declared `#` spelling.
            const name = prop.text
            const classOwner = scopeOwnerName(scopeStack)
            const owner = classOwner ?? containerOwnerName(node)
            // M49 #868: a FIELD decorator was dropped entirely — the class and
            // method paths called the collector, this one never did, so
            // `@inject("db") pool = 1` attached nothing to `pool` while the
            // identical shape in typescript yielded `decorators=["inject"]`.
            // The JS grammar nests the decorator INSIDE field_definition
            // (probe: `field_definition children=[decorator@6,
            // property_identifier@7, =@7, number@7]`), so the own-child
            // collector is the right reader here.
            const dec = this.collectOwnDecoratorDetails(node)
            symbols.push({
              name,
              kind: ASTEngine.SymbolKind.Property,
              range: this.nodeToRange(node),
              scope: scopeString(scopeStack),
              ownerName: owner,
              ownerKind: classOwner ? ASTEngine.SymbolKind.Class : undefined,
              // J9 (review wave, TS parity): `#x` fields are class-private —
              // the old hardcoded "public" contradicted metadata.isPrivate
              // on the same symbol.
              visibility: prop.type === "private_property_identifier" ? "private" : "public",
              decorators: dec.names.length > 0 ? dec.names : undefined,
              metadata: {
                isPrivate: prop.type === "private_property_identifier",
                ...(dec.lines.length > 0 ? { decoratorLines: dec.lines } : {}),
              },
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
          } else if (nameNode && (nameNode.type === "object_pattern" || nameNode.type === "array_pattern") && functionDepth === 0 && !inClassBody) {
            // M14 #419 J7: module-level destructured bindings ARE symbols —
            // const { a } = obj / const [b] = arr bind real module-scope
            // names (TS parity, probe-verified). Pre-fix they emitted
            // nothing. Locals/params/lambda params stay non-symbols.
            const isConst = this.isConstDeclarator(node)
            const pairs = this.collectPatternPairs(nameNode)
            for (const bound of pairs) {
              symbols.push({
                name: bound.name,
                kind: isConst ? ASTEngine.SymbolKind.Constant : ASTEngine.SymbolKind.Variable,
                // M59 (#825): each binding ranges at its own NAME, not the
                // whole declarator (a wrapped binding list stamped `const {`
                // for every member — measured on element-plus drawer.vue).
                range: this.nodeToRange(bound.node),
                scope: scopeString(scopeStack),
                visibility: "public",
                metadata: { isConst, isDestructured: true },
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
            // J-rebind (review wave): wholesale `exports = { a: 1 }`
            // rebinds the module surface — the old member-only shape test
            // missed it entirely (left is a bare identifier here).
            if (left.type === "identifier" && left.text === "exports") {
              patterns["CommonJS Exports"] = true
              this.collectModuleExports(right, exports, node, false)
            }
            // `a.b` is a member_expression, `a["b"]` is a subscript_expression —
            // both write the same surface, so the gate admits both. Every branch
            // below still tests the shape it needs (the prototype branch keeps
            // its own `obj.type === "member_expression"` requirement).
            if (left.type === "member_expression" || left.type === "subscript_expression") {
              const obj = left.childForFieldName("object")
              const prop = left.childForFieldName("property")
              const objText = obj ? obj.text : ""
              const propText = prop ? prop.text : ""

              if (objText === "module" && propText === "exports") {
                patterns["CommonJS Exports"] = true
                this.collectModuleExports(right, exports, node, true)
              } else if (obj && writtenSegment(prop, left)) {
                // DEEP property assignment: `module.exports.sub = ...` /
                // `exports.group.item = 1` — every segment below the base
                // belongs to the module's public surface. Only ONE level
                // below the base was recognized before; deeper chains were
                // silently dropped.
                //
                // The chain is read STRUCTURALLY (cjsSurfacePath), not by
                // re-parsing `obj.text` with the two regexes this site used to
                // carry (the pair registered in validation/m49/regex-debt-
                // register.json, both justified "no AST path" — a path this
                // file already used 1,300 lines below for the same node type).
                // Measured cost of the text form: it fabricated malformed
                // export names on minified input (`lodash.min.js` ->
                // "(ie.exports=we)._") and on a computed base
                // (`module["exports"].a.b` -> `module["exports"].a.b`).
                const surface = this.cjsSurfacePath(obj)
                if (surface) {
                  patterns["CommonJS Exports"] = true
                  const seg = writtenSegment(prop, left)!
                  const exportName = [...surface, segmentName(seg)].join(".")
                  exports.push({ name: exportName, isDefault: false, range: this.nodeToRange(seg), metadata: { viaCommonJs: true } })
                }
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
                  // J3: same last-wins map as class methods — a prototype
                  // assignment overwrites at runtime.
                  {
                    const params = this.extractParameters(right.childForFieldName("parameters"))
                    var protoSymbol: ASTEngine.UniversalSymbol = {
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
                    }
                  }
                  const protoIdx = seenMethodIdx.get(dedupKey)
                  if (protoIdx === undefined) {
                    seenMethodIdx.set(dedupKey, symbols.length)
                    symbols.push(protoSymbol)
                    // contains comes from addContainmentRelationships via
                    // ownerName — no duplicate push here.
                  } else {
                    const oldRange = symbols[protoIdx].range
                    if (oldRange && oldRange.startIndex !== undefined && oldRange.endIndex !== undefined) deadSpans.push({ s: oldRange.startIndex, e: oldRange.endIndex })
                    symbols[protoIdx] = protoSymbol
                  }
                  scopeStack.push({ name: methodName, kind: JSScopeKind.Function })
                  nextFunctionDepth = functionDepth + 1
                }
              }
            }
          }
          break
        }

        case "call_expression": {
          // CommonJS require() -> import AND dynamic import() -> import.
          // Both are module dependencies, never calls (the extractCall
          // pass skips the `import` callee the same way it skips require).
          const fn = node.childForFieldName("function")
          // `import` lexes as its own node type (keyword), not identifier
          // (the TS T7 quirk, verified by probe).
          const isImportCall = !!fn && (fn.type === "import" || (fn.type === "identifier" && fn.text === "import"))
          if (fn && ((fn.type === "identifier" && fn.text === "require") || isImportCall)) {
            const args = node.childForFieldName("arguments")
            if (args && args.namedChildCount > 0) {
              const arg = args.namedChild(0)
              if (arg && (arg.type === "string" || arg.type === "template_string")) {
                const reqPath = stringContent(arg)
                const isDynamic = isImportCall
                // J4 (review wave): `const { a } = require("m")` binds names
                // (not default); only a bare-identifier binding is the
                // default export. The old hardcoded true flagged everything.
                let requireIsDefault = true
                if (!isDynamic) {
                  let vp: Node | null = node.parent
                  while (vp && vp.type !== "variable_declarator" && vp.type !== "lexical_declaration" &&
                         vp.type !== "variable_declaration" && vp.type !== "export_statement" &&
                         vp.type !== "expression_statement" && vp.type !== "program") {
                    vp = vp.parent
                  }
                  if (vp && vp.type === "variable_declarator") {
                    const bindName = vp.childForFieldName("name")
                    requireIsDefault = !!bindName && bindName.type === "identifier"
                  } else {
                    requireIsDefault = false
                  }
                }
                imports.push({
                  module: reqPath,
                  items: ["*"],
                  isDefault: requireIsDefault,
                  range: this.nodeToRange(node),
                  metadata: { type: isDynamic ? "dynamic-import" : "require" },
                })
                patterns[isDynamic ? "Dynamic Imports" : "CommonJS Imports"] = true
                relationships.push({
                  source: moduleName,
                  target: `${reqPath}:*`,
                  type: ASTEngine.RelationshipType.Imports,
                  // JD-J12 (M60, 2026-09-27): a `*` target names NO SYMBOL.
                  //
                  // `require("m")` and `import("m")` are module-level: the
                  // source declares that the module is loaded, not which member
                  // is taken from it. Publishing `<module>:*` at 1.0 states a
                  // certainty the file does not contain — and this is the ONLY
                  // shape a CJS require ever takes, so for an ES5 corpus it is
                  // the whole import class.
                  //
                  // Measured on the two javascript corpora at 300 files: 310
                  // edges carry a `*` leaf and **every one is at confidence
                  // 1.0** — 233 of 1,606 in svelte, and 77 of 77 in lodash
                  // (whose entire import surface is `require`). No named-leaf
                  // import edge exists there at all.
                  //
                  // This is the same defect shape as java's inferred JPA table
                  // name (`mapped_table`, fixed earlier in this review): an
                  // inference published at maximum confidence. The edge is KEPT
                  // — the module dependency is real and worth recording — but it
                  // is marked and demoted below the 0.7 fabrication threshold,
                  // so it is declared suspicion rather than a counted
                  // relationship, and a consumer can filter on `unresolved`.
                  confidence: 0.6,
                  // The module path argument is the name this edge is about.
                  ...this.lineField(arg),
                  metadata: { isRequire: !isDynamic, isDynamicImport: isDynamic, unresolved: true },
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
          // M59 (#825): each item keeps the node that SPELLS it. The edge target
          // is `<module>:<item>`, so the line must be the item's — an
          // `import {\n  a,\n  b,\n} from "m"` writes a and b on their own lines,
          // and the statement's first line would be a claim about a line they are
          // not on. A string-only list cannot say which line that is.
          // M60 / JD2b: each item also carries the name AS THE MODULE DECLARES
          // IT, beside the local binding. The edge `target` keeps spelling the
          // LOCAL binding, because `javascript/import-edges` pins
          // `./m2:c` and `javascript/import-alias-binding` pins items `["beta"]`
          // — both deliberate, with the rationale "the alias is the local
          // binding". The resolver, however, needs the DECLARED name: given
          // `./m2:c` it cannot know that `c` came from `a`, so every aliased
          // and every default import stayed unresolvable. Recording the declared
          // name as metadata is purely ADDITIVE — no pinned string changes — and
          // it is a fact the analyzer already has in hand. For a default import
          // the declared name is the literal `default`, which is what lets the
          // resolver find the module's default export by its isDefault flag.
          const items: Array<{ text: string; node: Node; declared: string; kind: "default" | "named" | "namespace" }> = []
          const clause = this.findChildByType(node, "import_clause")
          // J4 (review wave): isDefault follows the clause shape — a direct
          // identifier child IS the default import. The old items-count
          // heuristic flagged `import A` false and side-effect imports true.
          let hasDefaultImport = false
          if (clause) {
            for (let i = 0; i < clause.namedChildCount; i++) {
              const c = clause.namedChild(i)
              if (!c) continue
              if (c.type === "identifier") {
                // default import: the local binding is `c`, the module declares `default`
                items.push({ text: c.text, node: c, declared: "default", kind: "default" })
                hasDefaultImport = true
              } else if (c.type === "named_imports") {
                for (let j = 0; j < c.namedChildCount; j++) {
                  const spec = c.namedChild(j)
                  if (spec && spec.type === "import_specifier") {
                    // The LOCAL BINDING is the alias when present (`{ a as b }` binds b).
                    const n = this.findChildByType(spec, "identifier")
                    const alias = spec.childForFieldName("alias")
                    const item = alias ?? n
                    if (item) {
                      items.push({ text: item.text, node: item, declared: (n?.text ?? item.text), kind: "named" })
                    }
                    }
                }
              } else if (c.type === "namespace_import") {
                // A namespace import binds a NAME (`import * as ns`) — that name
                // is what the caller writes, so it is the line-bearing node; a
                // bare `import *` (side-effect-free star, no binding) has none.
                const nsName = c.childForFieldName("name") ?? c.namedChild(0)
                // A namespace has no single declared name to point at — the whole
                // module is the target — so `declared` stays "*" and the resolver
                // declines it, exactly as before.
                items.push({ text: "*", node: nsName ?? c, declared: "*", kind: "namespace" })
              }
            }
          }
          if (srcPath) {
            imports.push({
              module: srcPath,
              items: items.map((i) => i.text),
              isDefault: hasDefaultImport,
              range: this.nodeToRange(node),
              metadata: { type: "import" },
            })
            for (const item of items) {
              // JD-J12 (M60, 2026-09-27): `import * as ns from "m"` binds a
              // NAMESPACE, not a symbol — the `*` leaf names no member, and the
              // local binding `ns` is a namespace object, not a declaration in
              // the target module. JD2b deliberately left namespace imports
              // unresolved (there is nothing to resolve TO), which is right; what
              // was wrong was pairing that honest refusal with confidence 1.0.
              // A named import keeps 1.0 — its local binding IS written in the
              // file, and the two importing fixtures pin exactly that.
              const isNamespaceItem = item.text === "*"
              relationships.push({
                source: moduleName,
                // UNCHANGED, and deliberately so: the local binding, which is
                // what the two importing fixtures pin.
                target: `${srcPath}:${isNamespaceItem ? "*" : item.text.split(" as ")[0]}`,
                type: ASTEngine.RelationshipType.Imports,
                confidence: isNamespaceItem ? 0.6 : 1.0,
                ...this.lineField(item.node),
                // JD2b, additive: what the MODULE declares, so the resolver can
                // reach the right symbol for an aliased or default import. The
                // edge target above is untouched.
                metadata: {
                  declaredName: item.declared,
                  declaredKind: item.kind,
                  ...(isNamespaceItem ? { unresolved: true } : {}),
                },
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
              // JD-J12 (M60, 2026-09-27): a clause-less re-export (`export * from
              // "m"`) names the MODULE and no member of it — `*` again. The
              // comment below is right that the written name is the path
              // argument, but a module path is not a symbol, so 1.0 overstated
              // it the same way it overstated `require` and the namespace import.
              // Kept, marked, and demoted: the re-export dependency is real.
              confidence: 0.6,
              // A re-export with no clause names the MODULE, so the written name
              // is the module-path argument itself.
              ...this.lineField(exportSource),
              metadata: { isReExport: true, unresolved: true },
            })
            patterns["ES6 ReExports"] = true
          }
          break
        }
      }

      // JD6: tag every row this node pushed, so the dead-span filter below can
      // drop the ones that came from a superseded body.
      for (let i = relMark; i < relationships.length; i++) {
        relSpans.push({ idx: i, s: node.startIndex, e: node.endIndex })
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
    // J1 (review wave): keys are owner-qualified (Owner::method) — bare
    // method names merged call lists across classes (U.save + O.save shared
    // one union payload). Object-literal members keep bare keys, matching
    // their ownerKind-Constant symbols.
    // J3 + B5 in ONE index-stable removal pass.
    //
    // These were two sequential splices. The deadSpans rule ran FIRST and shifted
    // every later index down by one per removal, while `b5Zombies` holds INDICES
    // captured during the walk — so the second splice acted on a stale index space
    // and removed a live, unrelated symbol while leaving the killed accessor half
    // in place. Measured (review JD1, `class A { m(){class K{}} m(){} get x(){}
    // set x(v){} x(){} keep(){} }`): `keep` was deleted from the index and the
    // B5 invariant the accessor rule exists to enforce was violated.
    //
    // Both rules are now DECIDED against the original index space and applied in a
    // single splice, so neither can perturb the other's indices. The dead-span rule
    // keeps its strict-sub-span test (a replacement occupies its own span exactly,
    // so an exact match is the live symbol, not a casualty).
    {
      const deadIdx = new Set<number>(b5Zombies)
      if (deadSpans.length > 0) {
        for (let i = 0; i < symbols.length; i++) {
          const r = symbols[i].range
          if (!r || r.startIndex === undefined || r.endIndex === undefined) continue
          for (const d of deadSpans) {
            if (d.s <= r.startIndex && r.endIndex <= d.e && (d.s !== r.startIndex || r.endIndex !== d.e)) {
              deadIdx.add(i)
              break
            }
          }
        }
      }
      if (deadIdx.size > 0) {
        for (let i = symbols.length - 1; i >= 0; i--) if (deadIdx.has(i)) symbols.splice(i, 1)
      }
    }
    // JD6: drop the walk-time edges whose node sat inside a dead span. Applied
    // AFTER the symbol removals above, and only where a dead span actually
    // exists — measured prevalence on 400 production files is 0, so this is an
    // integrity guard rather than a common path, and it must stay inert when
    // nothing was superseded.
    if (deadSpans.length > 0 && relSpans.length > 0) {
      const drop = new Set<number>()
      for (const r of relSpans) {
        for (const d of deadSpans) {
          if (d.s <= r.s && r.e <= d.e) { drop.add(r.idx); break }
        }
      }
      if (drop.size > 0) {
        for (let i = relationships.length - 1; i >= 0; i--) if (drop.has(i)) relationships.splice(i, 1)
      }
    }

    {
      const bySource = new Map<string, string[]>()
      const qcOwnerOf = (n: Node): string | undefined => {
        // Direct class member: nearest enclosing class with no intervening
        // declarator/object boundary (W1 object-literal members belong to
        // their declarator, not any outer class).
        let p: Node | null = n.parent
        while (p) {
          if (p.type === "class_declaration") return p.childForFieldName("name")?.text
          if (p.type === "variable_declarator" || p.type === "object" || p.type === "pair" ||
              p.type === "function_declaration" || p.type === "function_expression" || p.type === "arrow_function") return undefined
          p = p.parent
        }
        return undefined
      }
      const qcResolve = (n: Node, current: string | null): string | null => {
        const fnName = n.childForFieldName?.("name")?.text
        if (
          (n.type === "function_declaration" || n.type === "generator_function_declaration" ||
            n.type === "method_definition") &&
          fnName
        ) {
          const owner = n.type === "method_definition" ? qcOwnerOf(n) : undefined
          return owner ? `${owner}::${fnName}` : fnName
        }
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
              if (protoProp && protoProp.text === "prototype") {
                const owner = obj.childForFieldName("object")?.text
                return owner ? `${owner}::${prop.text}` : prop.text
              }
            }
          }
        }
        return current
      }
      const qcWalk = (n: Node, current: string | null): void => {
        // J3: never attribute calls from inside a superseded duplicate body.
        if (isNodeInDeadSpans(deadSpans, n)) return
        current = qcResolve(n, current)
        if (n.type === "call_expression") {
          const fn = n.childForFieldName("function")
          // Dynamic import() is a module dependency, never a call (TS T8
          // analog — the relationship walk already skips both shapes; the
          // payload walk only skipped require).
          const isImportCallee = !!fn && (fn.type === "import" || (fn.type === "identifier" && fn.text === "import"))
          if (fn && !(fn.type === "identifier" && fn.text === "require") && !isImportCallee) {
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
        // Owner-qualified lookup mirrors the keys above: class-owned methods
        // resolve Owner::method, everything else the bare name.
        const key = sym.ownerName && sym.ownerKind === ASTEngine.SymbolKind.Class
          ? `${sym.ownerName}::${sym.name}`
          : sym.name
        const list = bySource.get(key)
        if (list && list.length > 0) sym.qualified_calls = [...new Set(list)]
      }
    }

    // --- Relationship passes -------------------------------------------------
    this.addContainmentRelationships(symbols, relationships)
    this.extractOverrideRelationships(symbols, relationships, context?.overrideCompanion)
    this.extractCallRelationships(rootNode, symbols, relationships, moduleName, deadSpans)
    // JD6: an export written inside a superseded duplicate body is not part of
    // the module's surface. `extractExportRelationships` runs after the walk and
    // turns the `exports` array into rows, so the filter belongs here — on the
    // entries — rather than on relSpans, which only covers rows pushed DURING
    // the walk. The entry's own range is the name-bearing node, so an entry
    // inside a dead span is a dead export.
    if (deadSpans.length > 0 && exports.length > 0) {
      for (let i = exports.length - 1; i >= 0; i--) {
        const r = exports[i].range
        if (r && r.startIndex !== undefined && r.endIndex !== undefined) {
          for (const d of deadSpans) {
            if (d.s <= r.startIndex && r.endIndex <= d.e) { exports.splice(i, 1); break }
          }
        }
      }
    }
    this.extractExportRelationships(exports, relationships, moduleName)
    // M49 #868: decorators are metadata on the symbol they decorate, so their
    // only edge is a reference FROM that symbol, at the decorator's own line.
    this.extractDecoratorRelationships(symbols, relationships)

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
    this.collectFieldAccessUses(rootNode, relationships, moduleName, deadSpans)

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
          // The MEMBER's declaration line — the edge names the member.
          ...(symbol.range?.startLine ? { line_number: symbol.range.startLine } : {}),
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
    for (const s of symbols) {
      if ((s.kind === ASTEngine.SymbolKind.Method || s.kind === ASTEngine.SymbolKind.Constructor) && s.ownerName) {
        // B4 (M49 #758, self-audit wave): STATIC methods never virtually
        // dispatch — `static create()` in a subclass SHADOWS the base static,
        // it does not override it (no prototype-chain link between the two;
        // the pre-fix rule fabricated Sub.create->Base.create at 0.95 for
        // every static/same-name pair). Instance methods only.
        if (s.isStatic) continue
        const base = baseByClass.get(s.ownerName)
        if (!base) continue
        // J2: constructors never override (no virtual dispatch on `new`);
        // methods pair only against base METHODS (never fields).
        const isCtor = s.kind === ASTEngine.SymbolKind.Constructor || s.name === "constructor"
        const inFileDeclares = !isCtor && (byName.get(s.name)?.some((bm) => bm.ownerName === base && bm.kind === ASTEngine.SymbolKind.Method) ?? false)
        if (inFileDeclares || (!isCtor && overrideCompanion?.get(base)?.has(s.name))) {
          relationships.push({
            source: `${s.ownerName}.${s.name}`,
            target: `${base}.${s.name}`,
            type: ASTEngine.RelationshipType.Overrides,
            confidence: 0.95,
            // The OVERRIDING member's own line, not the class's.
            ...(s.range?.startLine ? { line_number: s.range.startLine } : {}),
            metadata: { reasonCode: "verified-in-file" },
          })
        } else if (!isCtor && !overrideCompanion?.has(base)) {
          // Pass 3 guess — but ONLY for bases outside this file. An in-file
          // base that declares no same-named method is PROOF of non-override
          // (closed world), not an unknown: guessing there fabricated
          // Sub.foo->Base.foo for field/method collisions the verifier
          // above just rejected.
          // `!isCtor` is implied by this branch's own guard (`else if (!isCtor && ...)`),
          // so the conjunct was a no-op condition (M60 review JD10/F7).
          const baseInFile = symbols.some((s) => s.name === base && s.kind === ASTEngine.SymbolKind.Class)
          if (baseInFile) continue
          // Pass 3 (family parity with java/groovy resolveOverrides): the
          // base is not declared in this file and the companion index gave
          // no opinion (it is never populated in production — see M37.10).
          // Emit the deterministic first-parent guess BELOW the patterns.ts
          // threshold (0.7): visible in raw output, counted as heuristic
          // (honest suspicion) by the differential. Pre-M37.10 this edge was
          // silently dropped for every externally-declared base.
          relationships.push({
            source: `${s.ownerName}.${s.name}`,
            target: `${base}.${s.name}`,
            type: ASTEngine.RelationshipType.Overrides,
            confidence: 0.5,
            ...(s.range?.startLine ? { line_number: s.range.startLine } : {}),
            metadata: { reasonCode: "first-parent-guess" },
          })
        }
      }
    }
  }

  private extractCallRelationships(
    node: Node,
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
    moduleName: string,
    deadSpans: { s: number; e: number }[] = [],
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
      if (n.type === "class_declaration") {
        // M14 #419 J5: static blocks and field initializers have no
        // enclosing function — their calls belong to the CLASS (kotlin K7
        // init-attribution analog). Instance method bodies resolve to the
        // method first (this node is only reached when no closer function
        // exists), so this never misattributes method calls.
        const nm = n.childForFieldName("name")?.text
        if (nm) return nm
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
      // J3: superseded duplicate bodies contribute no edges.
      if (isNodeInDeadSpans(deadSpans, n)) return
      // M49 #868: no call edge from decorator position — the decorator's name
      // is a reference from the symbol it decorates (extractDecoratorRelationships),
      // not a call by whoever lexically encloses it. The subtree is skipped
      // whole, so a call nested in a decorator's ARGUMENTS (`@inject(make())`)
      // is decorator position too — the web-family rule the typescript twin
      // already applies.
      if (this.inDecoratorPosition(n)) return
      current = resolveCurrent(n, current)
      const callSource = current || moduleName

      if (n.type === "call_expression") {
        const fn = n.childForFieldName("function")
        // `import` lexes as a keyword node type (TS T7 quirk) — skip both
        // shapes so dynamic import() never emits a spurious calls edge.
        const isImportCallee = !!fn && (fn.type === "import" || (fn.type === "identifier" && fn.text === "import"))
        if (fn && !((fn.type === "identifier" && fn.text === "require") || isImportCallee)) {
          let targetName = fn.text
          let fullCallee = fn.text
          let skip = false
          if (fn.type === "member_expression") {
            const prop = fn.childForFieldName("property")
            if (prop) targetName = prop.text
          } else if (fn.type === "subscript_expression") {
            // Computed/dynamic member calls (o[key](...), o["key"]()) are
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
              // The callee LEAF — for `a.b.c()` the property node, so a chain's
              // call does not take the chain's opening line.
              ...this.lineField(fn.type === "member_expression" ? (fn.childForFieldName("property") ?? fn) : fn),
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
              // The CLASS NAME node: for `new ns.Thing()` the property leaf,
              // since the target is the leaf (TSD3 leaf identity).
              ...this.lineField(ctor.type === "member_expression" ? (ctor.childForFieldName("property") ?? ctor) : ctor),
              metadata: {},
            })
          }
        }
      } else if (n.type === "jsx_element" || n.type === "jsx_self_closing_element") {
        // M14 #419 J8: JSX component usage. JSX is native to the JS
        // grammar (unlike TS where it lives in the tsx dialect). Capitalized
        // components (<Button/>) emit Uses with jsxElement metadata; lowercase
        // intrinsics (div, span) and member components (A.B) do not — the TS
        // family contract, probe-verified.
        const opening = n.type === "jsx_self_closing_element" ? n : n.namedChild(0)
        if (opening && (opening.type === "jsx_self_closing_element" || opening.type === "jsx_opening_element")) {
          const identifier = opening.namedChild(0)
          if (identifier && identifier.type === "identifier") {
            const char = identifier.text[0]
            if (char && char === char.toUpperCase() && char !== char.toLowerCase()) {
              relationships.push({
                source: callSource,
                target: identifier.text,
                type: ASTEngine.RelationshipType.Uses,
                confidence: 0.9,
                ...this.lineField(identifier),
                metadata: { jsxElement: identifier.text },
              })
            }
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
    for (const item of exports) {        relationships.push({
          source: moduleName,
          target: item.name,
          type: ASTEngine.RelationshipType.Exports,
          confidence: 1.0,
          // The exported NAME's own line, from the export's range when the
          // collector recorded one. Absent rather than invented when it did not.
          ...(item.range?.startLine ? { line_number: item.range.startLine } : {}),
          metadata: { isDefault: item.isDefault },
        })
    }
  }

  // ============================================================================
  // HELPERS
  // ============================================================================

  /**
   * The CJS public-surface path BENEATH the base, read structurally.
   *
   * `module.exports.a.b = 1` -> ["a","b"]; `exports.g.x = 1` -> ["g","x"];
   * `exports.tag = 1` -> [] (an empty array, which is truthy — the caller
   * relies on that to tell "CJS surface" from "not CJS surface").
   *
   * Returns null when the chain is not a module surface (`svc.limit = 1`, whose
   * obj is a plain identifier) or when a segment is not statically nameable
   * (`module[expr].a = 1`, `(freeModule.exports = lodash)._ = 1`). An unnameable
   * segment yields NO export rather than a fabricated one — the defect class the
   * regex policy exists to prevent, measured on minified lodash where the text
   * form emitted the literal export name "(ie.exports=we)._".
   */
  private cjsSurfacePath(obj: Node): string[] | null {
    const segs: string[] = []
    let cur: Node | null = obj
    while (cur && (cur.type === "member_expression" || cur.type === "subscript_expression")) {
      if (cur.type === "subscript_expression") {
        const idx = cur.childForFieldName("index")
        if (!idx) return null
        // A string or numeric literal is nameable; any other expression is not.
        if (idx.type !== "string" && idx.type !== "number") return null
        segs.unshift(stringContent(idx))
      } else {
        const prop = cur.childForFieldName("property")
        if (!prop) return null
        segs.unshift(prop.text)
      }
      cur = cur.childForFieldName("object")
    }
    if (!cur) return null
    // Anything still chain-shaped here means the walk did not bottom out on the
    // receiver, so the path is not trustworthy.
    if (cur.type === "member_expression" || cur.type === "subscript_expression") return null
    // The receiver must be the BARE identifier `module` or `exports`. A
    // parenthesised or assigned receiver (`(freeModule.exports = lodash)._`) is a
    // different node type and is declined here rather than string-matched.
    if (cur.type !== "identifier") return null
    if (cur.text === "module") return segs[0] === "exports" ? segs.slice(1) : null
    if (cur.text === "exports") return segs
    return null
  }

  private isJSBuiltinCall(targetName: string, fullCallee?: string): boolean {
    if (targetName === "super") return true
    if (JS_CONSOLE_BUILTINS.has(fullCallee || "")) return true
    const trimmed = stripWhitespace(fullCallee || "")
    if (JS_CONSOLE_BUILTINS.has(trimmed)) return true
    if (JS_OBJECT_LEAF_METHODS.has(targetName)) return true
    return false
  }

  /**
   * M49 #868: the JS twin of the typescript analyzer's `decoratorLines`. The
   * name list is what the store reads on the symbol; the PARALLEL line list
   * lets the decorator's reference edge name the line the decorator is
   * written on. A name already recorded keeps its FIRST position, so the two
   * lists stay in lockstep by construction.
   */
  private collectOwnDecoratorDetails(node: Node): { names: string[]; lines: Array<number | null> } {
    const names: string[] = []
    const lines: Array<number | null> = []
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (!c || c.type !== "decorator") continue
      const name = jsDecoratorName(c)
      if (name.length === 0 || names.includes(name)) continue
      names.push(name)
      lines.push(c.startPosition.row + 1)
    }
    return { names, lines }
  }

  /**
   * M49 #868 — is this node written in DECORATOR position?
   *
   * A decorator is METADATA on the symbol it decorates, not a call or a read
   * made by whoever lexically encloses it. The family already rules this way
   * (typescript: `inDecoratorPosition`, real-typescript-analyzer.ts; the JVM
   * analyzers attach annotations as metadata and emit no edge; the python
   * oracle documents PYD1). javascript was the exception: a class-body
   * `@inject("db")` is syntactically a call expression, so the walk attributed
   * it to the enclosing CLASS — `calls Service -> inject` beside the
   * member-scoped edge that should carry it — and the bare-read pass turned
   * every decorator name into a `uses` edge from the decorated symbol.
   *
   * The walk stops at the enclosing statement/declaration boundary rather than
   * walking to the root: a decorator on a METHOD cannot make the method's own
   * body a decorator position (its decorators are siblings, never ancestors of
   * the body).
   */
  private inDecoratorPosition(n: Node): boolean {
    // PERF: no decorator node in this file means no decorator ANCESTOR either, so
    // the walk below can only return false. Exactly equivalent, and it is the
    // answer for every file that does not use decorator syntax.
    if (!this.hasAnyDecoratorNode) return false
    let p: Node | null = n.parent
    while (p) {
      if (p.type === "decorator") return true
      if (
        p.type === "class_declaration" ||
        p.type === "class" ||
        p.type === "function_declaration" ||
        p.type === "generator_function_declaration" ||
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

  /**
   * M49 #868 — CLASS decorators, which the JS grammar places in TWO spots:
   * own children of `class_declaration`, or own children of the WRAPPING
   * `export_statement` when the class is exported (probe:
   * `export_statement children=[decorator@2, export@3, class_declaration@3]`).
   * The own-child reader alone therefore dropped every decorator on an
   * exported class — `@sealed export class A {}` produced no decorators on `A`
   * and no reference edge at all, while the typescript twin's
   * `collectDecoratorsForClass` already checks the export_statement.
   */
  private collectClassDecoratorDetails(node: Node): { names: string[]; lines: Array<number | null> } {
    const own = this.collectOwnDecoratorDetails(node)
    const wrapping = node.parent?.type === "export_statement"
      ? this.collectOwnDecoratorDetails(node.parent)
      : { names: [], lines: [] as Array<number | null> }
    if (wrapping.names.length === 0) return own
    const names = [...own.names]
    const lines = [...own.lines]
    for (let i = 0; i < wrapping.names.length; i++) {
      if (names.includes(wrapping.names[i])) continue
      names.push(wrapping.names[i])
      lines.push(wrapping.lines[i])
    }
    return { names, lines }
  }

  /**
   * M49 #868: a decorator is metadata on the symbol it decorates, so its name
   * is reachable as a REFERENCE from that symbol (the typescript twin's
   * `extractDecoratorRelationships`, and the shape the M59 #860 fixture pins
   * there). Emitted for every decorated symbol, with the decorator's OWN line:
   * a decorator whose line was never recorded stays line-less rather than
   * borrowing the declaration's line (never invent a line, #823).
   */
  private extractDecoratorRelationships(
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
  ): void {
    for (const symbol of symbols) {
      if (!symbol.decorators || symbol.decorators.length === 0) continue
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

  /**
   * M59 (#825) follow-up: the destructuring walk carries the binding NODE so each
   * destructured symbol ranges at its own NAME
   * instead of the whole declarator (`const {` for a wrapped binding list).
   * Names and nodes stay in lockstep by construction (single walk).
   */
  private collectPatternPairs(pattern: Node): Array<{ name: string; node: Node }> {
    const out: Array<{ name: string; node: Node }> = []
    const walk = (n: Node): void => {
      switch (n.type) {
        case "shorthand_property_identifier":
        case "shorthand_property_identifier_pattern":
        case "identifier":
          out.push({ name: n.text, node: n })
          break
        case "pair_pattern": {
          // { key: value } — the VALUE side binds (key is the property read)
          const value = n.childForFieldName("value")
          if (value) walk(value)
          break
        }
        case "assignment_pattern":
        case "object_assignment_pattern": {
          // { a = 1 } / [a = 1] — the LEFT side binds
          const left = n.childForFieldName("left")
          if (left) walk(left)
          break
        }
        case "rest_pattern": {
          for (let i = 0; i < n.namedChildCount; i++) {
            const c = n.namedChild(i)
            if (c) walk(c)
          }
          break
        }
        default:
          // object_pattern / array_pattern / nested patterns — recurse
          for (let i = 0; i < n.namedChildCount; i++) {
            const c = n.namedChild(i)
            if (c) walk(c)
          }
      }
    }
    walk(pattern)
    return out
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
        // J8 (review wave, TS parity): destructured-with-default
        // (`function f({a, b} = {})`) — the left side is a pattern, not an
        // identifier. Record it like a bare destructured parameter so the
        // position is not silently lost.
        else if (left && (left.type === "object_pattern" || left.type === "array_pattern")) {
          out.push({ name: p.text.slice(0, 60) })
        }
      } else if (p.type === "object_pattern" || p.type === "array_pattern") {
        // Destructured parameters are intentionally NOT symbols (family
        // contract); record them as a single parameter entry so the parameter
        // list is complete (TS parity — J8: dropping them silently lost
        // parameter positions).
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
          exports.push({ name: c.text, isDefault: false, range: this.nodeToRange(c), metadata: { viaCommonJs: true } })
        } else if (c.type === "pair") {
          const key = c.childForFieldName("key")
          if (key && (key.type === "property_identifier" || key.type === "identifier")) {
            exports.push({ name: key.text, isDefault: false, range: this.nodeToRange(key), metadata: { viaCommonJs: true } })
          }
        } else if (c.type === "method_definition") {
          // A SHORTHAND METHOD is the dominant modern CJS export form
          // (`module.exports = { run() { … } }`) and the grammar spells it as a
          // `method_definition`, not a `pair` — so the three branches above all
          // missed it and the module's main export surface came out EMPTY.
          // Measured before the fix: `module.exports = { run(){…}, plain: 1 }`
          // exported only `plain`; `exports = { run(){} }` exported nothing.
          // (M60 review JD5. No fixture covered a method in a CJS export
          // object — the three CJS fixtures use identifier/`pair` keys only.)
          const nm = c.childForFieldName("name")
          if (nm) exports.push({ name: nm.text, isDefault: false, range: this.nodeToRange(nm), metadata: { viaCommonJs: true } })
        }
        // `spread_element` (`...rest`) and a computed key (`[key]`) name no
        // statically knowable export, so they are declined rather than guessed —
        // the object-spread case is recorded as a standing gap, not a defect.
      }
    } else if (right.type === "identifier") {
      exports.push({ name: right.text, isDefault, range: this.nodeToRange(right), metadata: { viaCommonJs: true } })
    } else if (right.type === "function_expression" || right.type === "arrow_function" || right.type === "class_declaration" || right.type === "class") {
      const nm = right.type === "class_declaration" || right.type === "class"
        ? right.childForFieldName("name")?.text
        : undefined
      exports.push({ name: nm ?? "default", isDefault, range: this.nodeToRange(right), metadata: { viaCommonJs: true } })
    }
    // M49 exports invariant: the CJS surface is a NAME SET.
    //
    // Two corrections to what this comment used to say (M60 review JD9). It did
    // NOT dedupe "the entries this call contributed" — the scan covers the whole
    // `exports` array, so an earlier statement's duplicate is removed too. And it
    // does NOT keep the first occurrence: iterating from the end while filling
    // `seen` means the LAST occurrence is the survivor and earlier ones are
    // spliced. Keeping the last is right for CJS (the final assignment is the
    // effective export), but it means the surviving entry's `range` — and so the
    // `exports` edge's line_number — names the last write, not the first.
    // Measured: `module.exports.a = 1` then `module.exports = { a: 2 }` -> the
    // surviving `a` carries line 2.
    {
      const seen = new Set<string>()
      for (let i = exports.length - 1; i >= 0; i--) {
        if (seen.has(exports[i].name)) exports.splice(i, 1)
        else seen.add(exports[i].name)
      }
    }
  }

  private collectExportStatement(node: Node, exports: ASTEngine.ExportInfo[]): void {
    // `default` is an ANONYMOUS token (probe-verified) — the old named-child
    // scan never saw it, so isDefault was always false: every default export
    // was misflagged AND the J5 fallback below could never fire.
    let isDefault = false
    for (let i = 0; i < node.childCount; i++) {
      const t = node.child(i)
      if (t && !t.isNamed && t.text === "default") { isDefault = true; break }
    }
    let foundNamed = false
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (!child) continue
      if (child.type === "identifier") {
        foundNamed = true
        exports.push({ name: child.text, isDefault, range: this.nodeToRange(child) })
      } else if (child.type === "export_clause") {
        for (let j = 0; j < child.namedChildCount; j++) {
          const spec = child.namedChild(j)
          if (spec && spec.type === "export_specifier") {
            // J6 (review wave, TS parity): the PUBLIC name is the alias when
            // present (`export { a as b }` exports b) — first-identifier
            // lookup recorded the local name importers can't use.
            const exportName = spec.childForFieldName("alias")?.text ?? spec.childForFieldName("name")?.text ?? this.findChildByType(spec, "identifier")?.text
            // B8 (M49 #758, self-audit wave): `export { x as default }` is a
            // DEFAULT export — the alias IS the literal "default" keyword
            // and the emitted row must say so (pre-fix: name "default",
            // isDefault:false — the public binding name was lost AND the
            // default flag wrong, while `export default y` worked).
            const aliasNode = spec.childForFieldName("alias")
            const isAsDefault = !!aliasNode && aliasNode.text === "default"
            if (exportName) {
              foundNamed = true
              exports.push({
                name: isAsDefault ? "default" : exportName,
                isDefault: isAsDefault,
                range: this.nodeToRange(spec),
                metadata: isAsDefault ? { viaAliasDefault: true, localName: spec.childForFieldName("name")?.text } : undefined,
              })
            }
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
        //
        // JD-J14 (M60, 2026-09-27): a NAMED default declaration's export name is
        // `default`, never the declaration's own name. ECMAScript exports
        // `export default function fragment(){}` UNDER THE NAME `default`;
        // `fragment` is a local binding that importers cannot reach, and nothing
        // named `fragment` is exported at all. Publishing `fragment` therefore
        // invented a public name that does not exist — and because the local name
        // IS what a default importer writes (`import fragment from "./fragment.js"`
        // publishes the leaf `fragment`), the two errors cancelled in the corpus
        // and the lane read clean. The failure only appears when a consumer asks
        // the question a graph tool asks: does this module export `fragment`? It
        // does not, and the analyzer said it did.
        //
        // Measured on svelte: 8 rows in one 300-file audit where the target's
        // exports are (for example) `[fragment]` while the importer is a DEFAULT
        // import of that module — `export default function fragment()` published
        // as `fragment` instead of `default`. The local name is kept in metadata
        // so nothing is lost, exactly as `export { x as default }` already does
        // with `localName`.
        const n = child.childForFieldName("name")
        foundNamed = true
        exports.push({
          name: isDefault ? "default" : n?.text ?? "default",
          isDefault,
          range: this.nodeToRange(child),
          ...(isDefault && n?.text ? { metadata: { viaDefaultDeclaration: true, localName: n.text } } : {}),
        })
      } else if (child.type === "lexical_declaration" || child.type === "variable_declaration") {
        for (let j = 0; j < child.namedChildCount; j++) {
          const decl = child.namedChild(j)
          if (decl && decl.type === "variable_declarator") {
            const nm = decl.childForFieldName("name")
            if (nm && nm.type === "identifier") {
              foundNamed = true
              exports.push({ name: nm.text, isDefault, range: this.nodeToRange(nm) })
            }
          }
        }
      }
    }
    // J5 (review wave, TS parity): default-exported EXPRESSIONS
    // (`export default { a: 1 }`, `export default foo()`) match no branch
    // above — record the module's main export under "default" instead of
    // dropping it silently.
    if (isDefault && !foundNamed) {
      exports.push({ name: "default", isDefault: true, range: this.nodeToRange(node) })
    }
    // M49 exports invariant: an ES module has AT MOST ONE default binding —
    // `export default fn; export default class` in one file dedupes to one
    // `default` export entry (the second was a fabricated duplicate; both
    // decl sites are still walked/symbolized normally).
    {
      let sawDefault = false
      for (let i = exports.length - 1; i >= 0; i--) {
        if (exports[i].name !== "default") continue
        if (sawDefault) exports.splice(i, 1)
        else sawDefault = true
      }
    }
    // M49 exports invariant (whole-array pass): a module's export list is a
    // NAME SET — CJS deep paths (`exports.tag` twice), rebinds, and ESM
    // clauses all collapse to one entry per public name.
    //
    // LAST occurrence wins its range, not the first (M60 review JD9) — the
    // reverse iteration fills `seen` from the end. For a module surface that is
    // the correct semantic; the previous comment asserted the opposite.
    {
      const seenNames = new Set<string>()
      for (let i = exports.length - 1; i >= 0; i--) {
        if (seenNames.has(exports[i].name)) exports.splice(i, 1)
        else seenNames.add(exports[i].name)
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
    // J10 (review wave): the old 500-iteration cap combined with
    // forward-order pushes (popped in reverse) to miss JSX early in large
    // files — React detection silently dropped past ~300 lines. The walk is
    // linear like every other pass here; no cap.
    const stack: Node[] = [rootNode]
    while (stack.length > 0) {
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
          p.type === "method_definition" ||
          // M14 #419 J6: top-level const r = x instanceof T attributes the
          // reference to r (the enclosing declaration), never the global
          // placeholder (TS same-wave fix).
          p.type === "variable_declarator"
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
                ...this.lineField(right),
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
    moduleName: string,
    // JD6: this pass had no dead-span guard, so reads inside a superseded
    // duplicate body still emitted `uses` rows after the symbol they belonged to
    // was removed. Its sibling extractCallRelationships has had the guard all
    // along; this closes the asymmetry.
    deadSpans: { s: number; e: number }[] = [],
  ) {
    // Walk with an enclosing-class scope (this/super receivers) and an
    // enclosing-FUNCTION scope for member-read attribution. M37 JSD2 (JAD2
    // class, java wave): reads sourced to the receiver VARIABLE (`cfg.limit`
    // -> cfg) put edges from non-symbol nodes into the graph — the calls
    // walk attributes `cfg.helper()` to the enclosing FUNCTION, so the uses
    // walk must agree (two walks, one owner; java/php/python family rule).
    // this/super keep the TYPE owner (a self-read is a read of the type's
    // member — the swift/java precedent), any other receiver resolves to
    // the enclosing function; at top level, the module leaf name.
    const stack: { node: Node; owner: string | null; method: string | null; module: string }[] = [
      { node: rootNode, owner: null, method: null, module: moduleName },
    ]
    const seen = new Set<string>()
    while (stack.length > 0) {
      const item = stack.pop()!
      const node: Node = item.node
      const owner = item.owner
      const method = item.method

      // M49 #868: a decorator's name is not a READ by the decorated symbol —
      // it is a reference (extractDecoratorRelationships). Pre-fix every
      // decorator produced a bare-read `uses` edge from the enclosing
      // declaration, which the typescript twin does not emit. Subtree skipped
      // whole (arguments included), matching the calls walk above.
      if (this.inDecoratorPosition(node)) continue
      // JD6: no reads from inside a superseded duplicate body.
      if (deadSpans.length > 0 && isNodeInDeadSpans(deadSpans, node)) continue

      if (
        node.type === "class_declaration" ||
        node.type === "class"
      ) {
        const nameNode =
          node.childForFieldName?.("name") ?? node.namedChildren.find((c: any) => c.type === "identifier")
        const nextOwner = nameNode ? nameNode.text : owner
        // Class bodies clear the method scope (java JAD2 frame model:
        // owner = enclosing TYPE for this/super reads; method = enclosing
        // FUNCTION for everything else).
        for (let i = node.namedChildCount - 1; i >= 0; i--) {
          const child = node.namedChild(i)
          if (child) stack.push({ node: child, owner: nextOwner, method: null, module: moduleName })
        }
        continue
      }

      // JSD2: function-like nodes rebind the METHOD read-owner but keep the
      // TYPE owner (this.items in a method still reads Cart's member).
      let nextMethod = method
      let nextOwner = owner
      if (
        node.type === "function_declaration" ||
        node.type === "generator_function_declaration" ||
        node.type === "method_definition"
      ) {
        const nameNode = node.childForFieldName?.("name")
        if (nameNode) nextMethod = nameNode.text
      } else if (node.type === "variable_declarator") {
        // Module/any-scope `const h = () => {...}` — reads inside source to
        // h (the calls-walk variable_declarator rule).
        const v = node.childForFieldName("value")
        const nm = node.childForFieldName("name")?.text
        if (v && nm && (v.type === "arrow_function" || v.type === "function_expression")) nextMethod = nm
      } else if (node.type === "arrow_function" || node.type === "function_expression") {
        // X.prototype.m = function () {} — reads inside source to m
        // (mirrors the calls walk's assignment_expression rule).
        const parent = node.parent
        if (parent?.type === "assignment_expression") {
          const left = parent.childForFieldName("left")
          const obj = left?.childForFieldName("object")
          const prop = left?.childForFieldName("property")
          if (obj?.type === "member_expression" && obj.childForFieldName("property")?.text === "prototype" && prop) {
            nextMethod = prop.text
            nextOwner = obj.childForFieldName("object")?.text ?? owner
          }
        }
      }

      if (node.type === "member_expression") {
        // M14 #419 J4: a member_expression in call-callee position emits the
        // Calls edge only — the Uses edge is a double-emission (family
        // contract, TS/kotlin/scala). Skip the callee here; calls covers it.
        // web-tree-sitter returns FRESH wrapper objects per access — compare
        // by id, never by reference (the TS analyzer's documented quirk).
        const isCallCallee =
          node.parent?.type === "call_expression" &&
          node.parent.childForFieldName("function")?.id === node.id
        // X1 (RULED 2026-09-27): a call's callee chain is skipped ENTIRELY below, on
        // the J4 assumption that "calls covers it". That is true for a BARE callee —
        // `fn(x)` has `calls fn`, so suppressing `uses fn` is right and is what the
        // bare-read pass's `isCallee` gate does. It is FALSE for a MEMBER callee: the
        // `calls` edge names only the LEAF (`title.toUpperCase()` -> `calls
        // toUpperCase`), so the chain's ROOT is named by nothing at all.
        //
        // Measured consequence before this fix, on the analyzer's own output:
        // `title.toUpperCase()`, `value.trim()` and `items.slice().sort()` all
        // published NO `uses` edge for the receiver, while `title.length` (a property
        // access, not a call) published `title` and `fn(title)` (a call ARGUMENT)
        // published `title`. The defect was invisible to the fixture and mutant lanes
        // because no fixture asserted the receiver, and invisible to the differential
        // because the ORACLE carried the identical rule — the shared-premise shape.
        //
        // ONLY THE ROOT IS EMITTED, never the leaf: the leaf is what the `calls` edge
        // names, and publishing it here would be the double-emission J4 exists to
        // prevent. `this`/`super` are excluded because they are keywords, not symbols,
        // which matches the non-callee branch's rule for the same reason. The same
        // `seen` key dedupes, so a root already published by the non-callee branch
        // (`a.b.c()` publishes `a` twice today) is emitted once.
        if (isCallCallee) {
          let root: Node | null | undefined = node.childForFieldName("object")
          while (root && root.type === "member_expression") root = root.childForFieldName("object")
          const head = root && root.type === "identifier" ? root.text : ""
          if (head && head !== "this" && head !== "super") {
            const recvSource = method ?? owner ?? moduleName
            const recvKey = `${recvSource}.#${head}`
            if (!seen.has(recvKey)) {
              seen.add(recvKey)
              relationships.push({
                source: recvSource,
                target: head,
                type: ASTEngine.RelationshipType.Uses,
                confidence: 0.6,
                ...this.lineField(root!),
                metadata: { isFieldAccess: true, bareRead: true, callReceiver: true },
              })
            }
          }
        }
        if (!isCallCallee) {
          // M59 (#825): each segment keeps the node that writes it, so the
          // segment's OWN line is available (a chain can wrap: `a\n  .b\n  .c`).
          const parts: Array<{ seg: string; node: Node }> = []
          let cur: Node | null | undefined = node
          // flatten nested member_expression chain into segments
          while (cur && cur.type === "member_expression") {
            const prop = cur.childForFieldName("property")
            if (prop) parts.unshift({ seg: prop.text, node: prop })
            cur = cur.childForFieldName("object")
          }
          const head = cur ? cur.text : ""
          if (head && parts.length >= 1) {
            // JSD1 (JAD1 class, java wave): the assignment-LHS span is a
            // WRITE, not a read — `store.count = 0` emitted a bogus uses
            // edge for count, and `module.exports.tag = 1` emitted
            // uses module -> exports/uses module -> tag (CJS deep exports
            // are the same write). Gated by exact LHS span match, so the
            // inner segments of a chained write (obj.a.b = v -> read of a)
            // stay reads (java chained-write precedent).
            const pType = node.parent?.type
            let isWrite = false
            if (pType === "assignment_expression" || pType === "augmented_assignment_expression") {
              const lhs = node.parent!.childForFieldName("left") ?? node.parent!.namedChild(0)
              isWrite = !!lhs && lhs.startIndex === node.startIndex && lhs.endIndex === node.endIndex
            }
            // M49 W1 (#768): a write LHS suppresses only THIS node's own
            // emission — the subtree MUST still be walked. The pre-fix
            // `continue` skipped the child-push at the loop tail, so every
            // read nested inside a member-chain assignment was lost: call
            // arguments (`document.getElementById(x).style.display = v`
            // dropped the read of x) and intermediate segments (`.style`).
            // The comment claimed inner segments stayed reads; the code did
            // the opposite. Uncovered by any fixture until the #760 cold-pool
            // rotation surfaced it on grails-core/lodash.
            if (!isWrite) {
              // M49 #744 (web fix wave, java #739 family contract): the chain
              // ROOT identifier is a read too — `config.inner.deeper.leaf`
              // emitted uses inner/deeper/leaf but dropped `config`, the
              // identifier the read actually starts from. Emit it with the
              // same owner/source rules as the segments (this/super excluded:
              // they are keywords, not symbols).
                // M49 W1 (#768): the head is a read only when it IS an
                // identifier. A call-rooted chain (`document.getElementById(x)
                // .style = v`) has an expression for a head — emitting its raw
                // TEXT fabricated a garbage target (`uses -> document.getElement
                // ById(x)`), a non-symbol in the graph. The call itself already
                // carries the calls edge.
                if (head && head !== "this" && head !== "super" && cur?.type === "identifier") {
                  const rootSource = method ?? owner ?? moduleName
                const rootKey = `${rootSource}.#${head}`
                if (!seen.has(rootKey)) {
                  seen.add(rootKey)
                  relationships.push({
                    source: rootSource,
                    target: head,
                    type: ASTEngine.RelationshipType.Uses,
                    confidence: 0.6,
                    // The root identifier's own line (the chain may open on a
                    // line the segments do not share).
                    ...this.lineField(cur),
                    metadata: { isFieldAccess: true, chainRoot: true },
                  })
                }
              }
              for (const { seg, node: segNode } of parts) {
                // M49 W15 #814 (owner rule: converge on METHOD source). JSD2
                // used to source `this.x`/`super.x` to the enclosing TYPE
                // (citing a java/swift precedent that no longer holds — both
                // moved in this same ruling). The source is now the enclosing
                // METHOD for every receiver, which is what the analyzer
                // ALREADY did for a bare member read in the same body: probe
                // `class Store { count = 0; bare(){ return count }
                // dotted(){ return this.count } }` emitted `bare -> count`
                // next to `Store -> count` — two sources for one member, one
                // class. Outside a class there is no method either, so fall
                // back to the owner, then the module.
                const source = method ?? owner ?? moduleName
                // M49 W13: a PRIVATE segment's natural key (`${source}.` +
                // `#x`) is byte-identical to the bare-read/chain-root key of
                // the plain identifier `x` (`${source}.#` + `x`), so a bare
                // read of the imported binding `update_version` (set.js:52
                // `#update_version = update_version || -1`) claimed the key
                // and the real private read `this.#update_version` (set.js:88)
                // was dropped as a duplicate — the first javascript-lane
                // MISSING edge W12's 400-file measurement registered. `#` can
                // never appear inside an identifier, so a `#`-marked
                // namespace is disjoint from every bare/root/segment key.
                const key = seg.startsWith("#") ? `${source}.$private${seg}` : `${source}.${seg}`
                if (!seen.has(key)) {
                  seen.add(key)
                  relationships.push({
                    source,
                    target: seg,
                    type: ASTEngine.RelationshipType.Uses,
                    confidence: 0.6,
                    ...this.lineField(segNode),
                    metadata: { isFieldAccess: true },
                  })
                }
              }
            }
          }
        }
      }

      // M49 #744 (web fix wave): BARE identifier reads — `return config;`,
      // `if (flag)`, argument positions. Pre-fix only member_expression
      // chains were scanned, so every plain identifier read was invisible
      // (java #739/CONV-J-1 family class). Gates mirror the chain rule:
      // not a call callee (calls covers it), not an assignment LHS (write,
      // JSD1), not a declaration's own name node (the declarator walk owns
      // those), not this/super (JSD2), and not shorthand object keys
      // ({value} pairs — the KEY is a definition site, not a read).
      if (node.type === "identifier") {
        const txt = node.text
        if (txt !== "this" && txt !== "super" && txt !== "undefined" && txt !== "arguments") {
          const p7 = node.parent
          const calleeFn = p7?.type === "call_expression" ? p7.childForFieldName("function") : null
          const isCallee = !!calleeFn && calleeFn.id === node.id
          let isWrite2 = false
          if (p7?.type === "assignment_expression" || p7?.type === "augmented_assignment_expression") {
            const lhs2 = p7.childForFieldName("left") ?? p7.namedChild(0)
            isWrite2 = !!lhs2 && lhs2.id === node.id
          }
          const isDeclName = (p7?.type === "variable_declarator" && p7.childForFieldName("name")?.id === node.id) ||
            p7?.type === "function_declaration" || p7?.type === "function_expression" ||
            p7?.type === "generator_function_declaration" || p7?.type === "generator_function" ||
            p7?.type === "method_definition" ||
            p7?.type === "class_declaration" || p7?.type === "class"
          const isPropKey = (p7?.type === "pair" || p7?.type === "pair_pattern") && p7.childForFieldName("key")?.id === node.id
          const isMemberPart = p7?.type === "member_expression"
          // F6 audit: `property_signature` is a TypeScript-only node (this
          // analyzer is loaded with the tree-sitter-javascript grammar, whose
          // 259 types do not include it — probe-verified), so the old
          // disjunct could never be true. `property_identifier` is the JS
          // object/class member-name node.
          const isPropName = p7?.type === "property_identifier"
          // JSX element names (J8 contract: capitalized components emit the
          // jsxElement Uses from the dedicated walk; lowercase intrinsics
          // must NOT surface as bare identifier reads — the jsx-usage
          // fixture forbids uses App->div/span). An identifier whose parent
          // is a JSX element node is a tag name, never a symbol read.
          const isJsxName = p7?.type.startsWith("jsx_") ?? false
          const isLabel = p7?.type === "labeled_statement"
          const isShorthandProp = p7?.type === "shorthand_property_identifier"
          // M49 W1 (#768 binding-site wave): a BINDING site is a DEFINITION,
          // never a read. The #744 bare-read walk listed declaration NAMES as
          // the only definition positions, so every other binding position
          // fabricated a `uses @0.6` edge: import bindings (`import Comp from`),
          // parameters (`function f(a)` / `(a, b) =>` / `a =>`), catch params,
          // destructuring targets (`{a: c}`, `[...rest]`) and export aliases
          // (`export { a as b }` — target `b` is not even a symbol).
          // Grammar shapes measured on the pinned wasm, not guessed.
          const isImportBinding = p7?.type === "import_clause" || p7?.type === "import_specifier" || p7?.type === "namespace_import"
          const isParamBinding = p7?.type === "formal_parameters" || p7?.type === "arrow_function" || p7?.type === "catch_clause"
          const isPatternBinding =
            p7?.type === "rest_pattern" || p7?.type === "array_pattern" || p7?.type === "pair_pattern" ||
            // `a = 1` in a pattern: the LEFT is the binding, the RIGHT is a
            // genuine read (`function f(a = b)` must still read b).
            (p7?.type === "assignment_pattern" && (p7.childForFieldName("left") ?? p7.namedChild(0))?.id === node.id)
          const isExportSpecifier = p7?.type === "export_specifier"
          const isBindingSite = isImportBinding || isParamBinding || isPatternBinding || isExportSpecifier
          if (!isCallee && !isWrite2 && !isDeclName && !isPropKey && !isMemberPart && !isPropName && !isLabel && !isShorthandProp && !isJsxName && !isBindingSite) {
            const bSource = method ?? owner ?? moduleName
            const bKey = `${bSource}.#${txt}`
            if (!seen.has(bKey)) {
              seen.add(bKey)
              relationships.push({
                source: bSource,
                target: txt,
                type: ASTEngine.RelationshipType.Uses,
                confidence: 0.6,
                ...this.lineField(node),
                metadata: { isFieldAccess: true, bareRead: true },
              })
            }
          }
        }
      }

      // M14 #419 J3: template-literal interpolation — `hi ${name}` reads
      // name inside the enclosing function (TS T3 / kotlin K4 / scala G4
      // analog). Emit Uses on the substituted identifiers.
      //
      // M49 W4 (J6): a substituted identifier is a READ only when it is not
      // part of a call's callee expression and not an assignment target — the
      // same gates the bare-read and chain rules apply (a callee is covered by
      // the `calls` edge; a receiver of a call is part of that callee).
      // Pre-fix this walk emitted Uses for EVERY identifier in the subtree, so
      // `${fn(x)}` fabricated `uses fn` and `${obj.m(x)}` fabricated
      // `uses obj` — 5 corpus edges (benchmarking/utils.js,
      // transform-template/template.js) that the F5 truth rightly refused,
      // surfacing as unexplained fabrication once #760's rotation sampled
      // those files.
      if (node.type === "template_substitution") {
        const inCalleeOrWritePosition = (n: Node): boolean => {
          let cur: any = n
          while (cur) {
            const p = cur.parent
            if (!p || p.type === "template_substitution") break
            if (p.type === "call_expression") {
              const fn = p.childForFieldName("function")
              if (fn && fn.startIndex <= n.startIndex && n.endIndex <= fn.endIndex) return true
            }
            if (p.type === "assignment_expression" || p.type === "augmented_assignment_expression") {
              const left = p.childForFieldName("left") ?? p.namedChild(0)
              if (left && left.startIndex <= n.startIndex && n.endIndex <= left.endIndex) return true
            }
            cur = p
          }
          return false
        }
        const sub = (n: Node): void => {
          for (let i = 0; i < n.namedChildCount; i++) {
            const c = n.namedChild(i)
            if (!c) continue
            if (c.type === "identifier") {
              if (inCalleeOrWritePosition(c)) continue
              // JSD2: template reads attribute to the enclosing function
              // (the calls-walk owner), never the receiver/type placeholder.
              const src2 = method ?? owner ?? moduleName
              const key = `${src2}.${c.text}`
              if (!seen.has(key)) {
                seen.add(key)
                // M49 W4 (J6): mark the BARE-READ key too — the generic rule
                // (added by #744) re-emitted the same read at 0.6 with
                // isFieldAccess metadata, so one interpolated read produced
                // two Uses edges. First emitter wins: this rule carries the
                // documented isTemplateInterpolation contract.
                seen.add(`${src2}.#${c.text}`)
                relationships.push({
                  source: src2,
                  target: c.text,
                  type: ASTEngine.RelationshipType.Uses,
                  confidence: 0.85,
                  ...this.lineField(c),
                  metadata: { isTemplateInterpolation: true },
                })
              }
            } else if (c.type !== "identifier") {
              sub(c)
            }
          }
        }
        sub(node)
      }
      for (let i = node.namedChildCount - 1; i >= 0; i--) {
        const child = node.namedChild(i)
        if (child) stack.push({ node: child, owner: nextOwner, method: nextMethod, module: moduleName })
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
      // `type` is the only field this analyzer writes; engine.ts:302 keeps
      // `relationshipType` as a legacy alias no lane emits (M60 review JD13).
      const t = String(r.type ?? "")
      const conf = typeof r.confidence === "number" ? r.confidence : 1
      if (t === "contains" || t === "exports") { md.evidenceClass = "structural"; continue }
      // M14 #419 J1: the dedicated `imports` kind (ES6, CJS require, dynamic
      // import, re-exports) carries module dependencies — import_based, the
      // TS T1 / JVM K8 finding. Pre-fix this kind fell to usage_contextual.
      if (t === "imports") { md.evidenceClass = "import_based"; continue }
      if (t === "references") {
        // `references` in this lane is decorator metadata and an `instanceof`
        // check — never an import, so there is no import_based case to test.
        // (The family template tests `md.isImport`, which no javascript edge ever
        // sets; M60 review JD12. Same dead read in java/vue/svelte/typescript.)
        md.evidenceClass = "reference_qualified"
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


  /**
   * M59 (#825): the `line_number` for a relationship, taken from the node that
   * SPELLS the name the edge is about.
   *
   * javascript is the largest silent lane in the product: measured by the M59
   * oracle before this round, **0 of 5,818 relationships on a 40-file sample
   * carried a line** (vue 0/3,940 and svelte 0/526, both of which delegate their
   * script block to this analyzer — so one defect blanked three lanes). The
   * contract is inherited, not re-invented: **the line belongs to the name, never
   * to the construct that contains it.** A `call_expression` starts at its
   * RECEIVER (`a.b.c()` opens on `a`, not on `c`), a `new_expression` on its
   * `new` token, an `import_statement` on `import` even when its named specifiers
   * sit three lines below, and a class body's children open at their decorators.
   * Callers therefore pass the NAME node and this returns nothing when there is
   * none — never `0`, because `0` reads as "unknown" and unknown must be absent.
   */
  private lineField(nameNode: Node | null | undefined, fallback?: Node | null): { line_number?: number } {
    const n = nameNode ?? fallback
    return n ? { line_number: n.startPosition.row + 1 } : {}
  }

  private nodeToRange(node: Node): ASTEngine.UniversalSymbol["range"] {
    // M59 (#861): a DECORATED declaration's node STARTS AT ITS DECORATOR in the
    // pinned javascript grammar — measured:
    //
    //   @sealed
    //   class Service {           class_declaration children
    //                             [decorator@4, class@5, identifier@5, class_body@5]
    //     @inject("db")
    //     pool = 1                field_definition children
    //                             [decorator@6, property_identifier@7, ...]
    //     @sealed
    //     method() {}             method_definition children
    //                             [decorator@9, property_identifier@10, ...]
    //
    // (note this grammar nests decorators INSIDE the member; the typescript one
    // puts a method decorator in class_body as a sibling), so the symbol's own
    // line and every edge derived from it (`contains`, `exports`) named the line
    // the DECORATOR is written on. The M59 contract is the line the named token
    // is written on, and the family rule is the one scala fixed in
    // scala/declaration-lines-825: leading annotations are excluded from the
    // range. Advancing to the first non-decorator child keeps the range coherent
    // — startLine/startColumn/startIndex move together, to the `class` keyword or
    // the member's own name.
    let startSource = node
    {
      let i = 0
      while (i < node.childCount && node.child(i)?.type === "decorator") i++
      const first = i < node.childCount ? node.child(i) : null
      if (i > 0 && first) startSource = first
    }
    return {
      startLine: startSource.startPosition.row + 1,
      startColumn: startSource.startPosition.column + 1,
      endLine: node.endPosition.row + 1,
      endColumn: node.endPosition.column + 1,
      startIndex: startSource.startIndex,
      endIndex: node.endIndex,
    }
  }
}
