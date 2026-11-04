// JavaScript Intelligence Engine — Author: Muhammad Ishaq Khan
// What this file is: the pure-AST analyzer for JavaScript (extensions js/jsx/mjs/cjs,
// routed by src/ast/language-detection.ts). It produces symbols, imports, exports and
// the relationships the graph engine stores; it is regex-free and never reads text
// where the tree has a node. Grammar: tree-sitter-javascript 0.23.1 (WASM loaded by
// engine.ts), plus the JSX nodes it carries. ESM and CommonJS are both first-class.
// Relationship types covered: calls, uses, imports, exports, extends, instantiates, renders
// (JSX component usage — canonical vocabulary, 2026-10-18), decorates (the decorator edge,
// same vocabulary landing; it REPLACED the per-decorator `references` row),
// overrides, contains, references (now `instanceof` only). `implements` is RULED OUT — JavaScript
// has no implements clause (six instruments; docs §"What was RULED").
// EXTERNAL CLAIMS are published, never merged into resolution: the closed CITED platform
// vocabulary (`js-builtin-prototypes.ts`) proves a bare host global, a member whose receiver
// chain root is one, and a host base/`instanceof` type (`metadata.isExternalTarget` +
// `externalReason` + `externalClaimReason`); the module-namespace claim on `imports` fires ONLY
// on a complete project index and fails closed otherwise. Node/test-runner globals and imported
// bindings are NOT claimed — they are counted as open classes in
// validation/m14/verification/JAVASCRIPT-RESOLUTION-CLASSIFICATION.md, not guessed.
// The receiver-type channel is `metadata.owner` (the store's existing member-owner resolution) +
// `metadata.ownerEvidence` in {new, assignment, this, jsdoc, class-static, this-alias}; a wrong owner
// is worse than none.
// The emission table, confidence tiers and every count live in docs/analyzers/javascript.md.
// Where its scripts and validations live: script/m14/spec/javascript-completeness.json
// (ontology ledger), validation/m14/fixtures/javascript/** (83 fixtures + expectations,
// run by script/m14/run-fixtures.ts --lang javascript), validation/m14/verification/
// JAVASCRIPT-STATE.md, JAVASCRIPT-RESIDUAL.md and JAVASCRIPT-RESOLUTION-CLASSIFICATION.md,
// and the gates
// script/m14/incoming-gate.ts, verify-js-binding-resolution.ts, verify-js-import-seam.ts,
// verify-js-source-attribution.ts, verify-doc-truth-emissions.ts.
// EDIT THESE TOO: the doc, the spec, the fixtures. This analyzer is the DELEGATE HOST
// for vue and svelte (real-vue-analyzer.ts and real-svelte-analyzer.ts call it for
// their <script> blocks), so a shared-emission change must re-run THEIR fixtures too;
// shared store paths (pool-worker.ts, parallel-indexer.ts) own resolution, not this file.

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

/**
 * Does `text` spell a plain JavaScript identifier — `[A-Za-z_$][A-Za-z0-9_$]*` — written as a
 * char scan rather than a regex (this file carries none, and the no-regex gate is structural).
 * The claim pass refuses everything else: a dotted, path-like or fragment target is either
 * looked up by its owner (refutable) or unreachable to the arbiter's verifier.
 */
function isPlainJsIdentifier(text: string): boolean {
  if (text.length === 0) return false
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    const isLetter = (c >= 65 && c <= 90) || (c >= 97 && c <= 122)
    const isDigit = c >= 48 && c <= 57
    const isStart = isLetter || c === 95 || c === 36
    if (i === 0) { if (!isStart) return false; continue }
    if (!isStart && !isDigit) return false
  }
  return true
}

/** The length of the LEADING identifier of `text` (`location.hash` -> 8, `(el).x` -> 0). */
function jsIdentifierPrefixEnd(text: string): number {
  let end = 0
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    const isLetter = (c >= 65 && c <= 90) || (c >= 97 && c <= 122)
    const isDigit = c >= 48 && c <= 57
    const isStart = isLetter || c === 95 || c === 36
    if (end === 0 ? !isStart : !(isStart || isDigit)) break
    end = i + 1
  }
  return end
}

/**
 * THE PROJECT'S OWN FILE SPACE, as a module predicate — the analyzer-side half of the
 * `context.projectIndex` capability, and a FAIL-CLOSED gate:
 *
 *   project-local  the specifier's ROOT is a directory or file stem the index records, or a
 *                  multi-segment specifier's tail names an indexed file. NO claim, whatever the
 *                  specifier looks like: a `__mocks__/fs-extra.js` (a Jest mock of a REAL external
 *                  package) puts "fs-extra" in the project's directory names, and a bare claim
 *                  would then read as a statement the project can refute — the gate returns
 *                  `externalUnverified` (`ext?`), which blocks a pass.
 *   third-party    NO indexed file carries the root and no tail matches. The ONLY state in which
 *                  this lane may claim externality, and only when the index is complete: a
 *                  fragment that says "no such file" is not the project saying it.
 *   unknown        a matching tail exists but the root does not line up; neither claimed nor
 *                  resolved (a wrong resolution is worse than an unresolved row).
 *
 * RELATIVE/ABSOLUTE SPECIFIERS ARE NEVER ASKED (the caller filters them): they name this project
 * by the grammar, and a file claim that misses is REFUTED against the lane.
 *
 * CACHED ON THE INDEX OBJECT (WeakMap key = ProjectIndex): the predicate's sets cost one pass over
 * the project's file list and the index is one object per run; a per-file rebuild would be O(files)
 * per file.
 */
const JS_MODULE_LOCALITY_CACHE = new WeakMap<object, (spec: string) => "project-local" | "third-party" | "unknown">()

function jsProjectModuleLocalityOf(index: { modules?: Set<string> }): (spec: string) => "project-local" | "third-party" | "unknown" {
  const cached = JS_MODULE_LOCALITY_CACHE.get(index as object)
  if (cached) return cached
  const modules = index.modules ?? new Set<string>()
  const paths: string[] = []
  const stems = new Set<string>()
  const dirs = new Set<string>()
  // EVERY path segment, not only the last directory: a monorepo's files live under
  // `.../svelte/packages/svelte/...`, so the package name "svelte" IS a project-owned directory
  // even though it is never a file's immediate directory. A module root matching ANY segment is
  // treated as project-owned and gets NO claim — under-claiming is the safe direction here.
  const allSegments = new Set<string>()
  for (const raw of modules) {
    const m = String(raw).split("\\").join("/")
    if (m.length === 0) continue
    paths.push(m)
    const slash = m.lastIndexOf("/")
    const base = slash >= 0 ? m.slice(slash + 1) : m
    const dot = base.lastIndexOf(".")
    if (dot > 0) {
      const stem = base.slice(0, dot)
      if (stem.length > 0) stems.add(stem)
    }
    if (slash > 0) {
      const dir = m.slice(0, slash)
      const d = dir.lastIndexOf("/")
      dirs.add(d >= 0 ? dir.slice(d + 1) : dir)
    }
    for (const seg of m.split("/")) if (seg.length > 0) allSegments.add(seg)
  }
  const JS_EXTS = [".js", ".jsx", ".mjs", ".cjs", ".json"]
  const tailNamesIndexedFile = (spec: string): boolean => {
    for (const p of paths) {
      if (p.endsWith(`/${spec}`) || p === spec) return true
      for (const ext of JS_EXTS) {
        if (p.endsWith(`/${spec}${ext}`)) return true
      }
    }
    return false
  }
  /** Strip a `?query` / `#hash` suffix with a char scan (this file carries no regex literal). */
  const stripQueryAndHash = (text: string): string => {
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]
      if (ch === "?" || ch === "#") return text.slice(0, i)
    }
    return text
  }
  const predicate = (spec: string): "project-local" | "third-party" | "unknown" => {
    const clean = stripQueryAndHash(spec.trim())
    if (clean.length === 0) return "unknown"
    const segments = clean.split("/")
    const root = segments[0]
    // A SCOPED PACKAGE'S ROOT IS ITS SCOPE (`@scope/pkg`): the scope alone names no project file,
    // so the scope is only project-owned when the FULL scoped package name matches a directory.
    const rootOf = root.startsWith("@") && segments.length >= 2 ? `${root}/${segments[1]}` : root
    const rootOfOwn = root.startsWith("@") ? root : rootOf
    if (
      stems.has(rootOf) || dirs.has(rootOf) || dirs.has(rootOfOwn) || stems.has(rootOfOwn) ||
      allSegments.has(rootOf) || allSegments.has(rootOfOwn)
    ) return "project-local"
    if (segments.length > 1 && tailNamesIndexedFile(clean)) return "project-local"
    return "third-party"
  }
  JS_MODULE_LOCALITY_CACHE.set(index as object, predicate)
  return predicate
}

/**
 * IS THIS CALL TARGET A NAME — the shape a declaration can bind?
 *
 * A `calls` TARGET is read by the graph as a symbol NAME, so a target that is SOURCE TEXT is not a
 * name: `(fn)`, `(0, helper.other)`, `(cond ? a : b)`, `define()`, `"text"`, `[]`. The guard this
 * replaces tested TOKEN MEMBERSHIP (a length, a newline, a backtick, `${`, a brace or an `=`) as a
 * PROXY for "this leaf is error-recovery garbage" — and a parenthesised or conditional callee
 * contains none of those tokens, so the callee's own SOURCE TEXT was published in the target field
 * (fixture `javascript/non-name-callee-refused`, which pins exactly this).
 *
 * THE `#` CLAUSE IS LOAD-BEARING, and the fixture says why: 123 svelte rows are private-method
 * calls (`this.#tick()`), and a name test without the `#` clause would have deleted 123 real edges
 * to remove 31 source-text ones. So a private name is a name.
 *
 * UNICODE-AWARE, because a declaration may legitimately be named in a non-ASCII script, and the
 * arbiter's own plain-identifier test (charter §21.41's own-file tie-break) uses the same shape:
 * a target that is not a plain identifier cannot name a declaration, so binding it would fabricate
 * a resolution.
 *
 * ⇒⇒⇒ AND THIS TEST IS NOW READ OFF THE GRAMMAR RATHER THAN RE-DECIDED FROM THE TEXT ✓✓ (2026-10-22).
 *
 * WHAT IT REPLACED, AND WHY THE REPLACEMENT IS STRICTLY BETTER ✓✓: it used to be
 * `/^#?[\p{L}\p{Nl}_$][\p{L}\p{Nl}\p{Nd}\p{Mn}\p{Mc}\p{Pc}_$]*$/u` — ECMAScript's own
 * `IdentifierName`, spelled out in Unicode property classes ✓✓. It was CORRECT, and it was the last
 * regex in this analyzer's resolution path, which the owner's sixth criterion forbids ✓✓.
 *
 * ⇒⇒⇒ AND THE HONEST ANSWER WAS NOT TO REWRITE THE UNICODE CLASSES BY HAND ✓✓. A hand-written
 * version needs a range table for `\p{L}`, `\p{Nl}`, `\p{Nd}`, `\p{Mn}`, `\p{Mc}` and `\p{Pc}` —
 * **a second table that diverges from Unicode's**, which is the fleet's own recurring defect ✓✓.
 *
 * ⇒⇒⇒ ⇒⇒⇒ **THE ANALYSIS WAS ALREADY DONE, BY THE GRAMMAR.** Every callee arrives as a tree-sitter
 * node whose TYPE the parser had already decided ✓✓: an `identifier` IS a valid IdentifierName, a
 * `property_identifier` is one, and a `private_property_identifier` is the `#` clause ✓✓. The
 * analyzer was re-deciding, from a STRING, a question the parser had answered with MORE information
 * ✓✓. ⇒ **READ THE NODE TYPE ✓✓.**
 *
 * ⇒⇒⇒ WHAT THIS CATCHES THAT THE REGEX COULD NOT ✓✓: a source-text callee can never arrive wearing
 * an identifier node type ✓✓, so the class the fixture `javascript/non-name-callee-refused` pins is
 * refused by STRUCTURE rather than by spelling ✓✓. The cheap text guards that remain
 * (`length > 100`, newline, backtick, `${`, braces) stay beside it for error-recovered text ✓✓.
 */
const NAME_NODE_TYPES = new Set(["identifier", "property_identifier", "private_property_identifier"])

function isNameNode(node: any): boolean {
  return !!node && NAME_NODE_TYPES.has(String(node.type ?? ""))
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
      // A class EXPRESSION is owned by the BINDING it is assigned to — by
      // declarator OR by plain assignment. The assignment form is not a corner
      // case: it is how a custom-element base is written (svelte
      // `packages/svelte/src/internal/client/dom/elements/custom-element.js`:
      // `SvelteElement = class extends HTMLElement { … }`), and omitting it left
      // 20 members ownerless on a 400-file production draw even after the
      // declarator form was handled.
      //
      // X11 (2026-09-28): this used to prefer the class expression's OWN declared
      // name over its binding, and that produced a DANGLING owner. Measured:
      // `const D = class Inner { m(){} }` published `contains Inner->m` while the
      // symbol table held only `D:constant` and `m:method` — `Inner` was named by
      // no symbol anywhere in the file, so the containment edge pointed at a name
      // the graph does not contain. The anonymous form was already right
      // (`const E = class { m(){} }` -> `contains E->m`), which is what made this
      // a defect and not a design choice: the same construct gave two answers
      // depending on whether the author happened to name the expression.
      //
      // The binding is the right owner, and not only because it is a symbol. The
      // lane's own ruling (javascript-completeness design_decision 30) holds that
      // a class expression deliberately emits NO Class symbol, because it is a
      // VALUE expression and the binding that holds it is its identity. So the
      // own-name preference contradicted the ruling as well as the graph: the
      // ruling says the binding is the identity, and the edge named the one thing
      // the ruling says is not emitted.
      //
      // With no binding at all — `runIt(class Inner { m(){} })` — the member stays
      // ownerless, which is the same honest silence the object-literal branch
      // below already takes. `Inner` would name nothing there either.
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

/**
 * IS THIS MODULE SPECIFIER EXTERNAL? The receiver-position claim is EXTERNAL-ONLY: relative (`./x`,
 * `../x`), absolute (`/x`) and workspace (`workspace:*`) specifiers name PROJECT-INTERNAL modules whose
 * members are project-resolvable, so a claim there would launder a resolvable edge. Bare package names,
 * scoped packages and node builtins are external — they have no project file to resolve into.
 */
function isExternalSpecifier(specifier: string): boolean {
  if (specifier.length === 0) return false
  if (specifier.startsWith(".") || specifier.startsWith("/")) return false
  const low = specifier.toLowerCase()
  if (low.startsWith("workspace:") || low.startsWith("file:") || low.startsWith("link:")) return false
  // ★ NO REGEX (owner's DONE criterion, 2026-10-23): a Windows drive prefix is three positions —
  // a letter, a colon, then a separator. The LENGTH guard is the case a hand-written version gets
  // wrong: a two-character string must be false, and the old pattern required the third character.
  if (specifier.length >= 3) {
    const c0 = specifier.charCodeAt(0)
    const isLetter = (c0 >= 65 && c0 <= 90) || (c0 >= 97 && c0 <= 122)
    const s1 = specifier[1]
    const s2 = specifier[2]
    if (isLetter && s1 === ":" && (s2 === "\\" || s2 === "/")) return false // windows absolute path
  }
  return true
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

import { BINDING_SEP } from "./types"
import { isJsBuiltin, jsBuiltinHasMember, hostGlobalCitation, memberChainClaim } from "./js-builtin-prototypes"
import { runtimeGlobalCitation, runtimeGlobalReason } from "./js-runtime-globals"

/**
 * THE FILE-LEVEL ACTOR — the source spelling for an edge whose actor is the FILE,
 * not a symbol: a re-export's dependency row.
 *
 * `"(file)"` is the family's already-declared sentinel for "this FILE, as a unit"
 * (rust `RUST_FILE_SOURCE`, scala `FILE_MODULE`, kotlin, zig, graphql and nim spell
 * it the same way and pair it with `metadata.fileLevel: true`). This lane spelled
 * the actor `moduleName` (the basename), and the store resolves a source BY NAME
 * against the file's own symbol table — so a module-scope row and a function-scope
 * row named like the module are spelled identically, and 155 of the first 250
 * admitted files declare a symbol whose name EQUALS their module basename
 * (measured in the lost lineage this constant was recovered from).
 *
 * PRE-SCOPE, stated: this constant is used by the RE-EXPORT and EXPORT rows only in
 * this round, because their fixtures (`reexport-forms`, `star-reexport`, `cjs-export-methods`)
 * are the ones that pin the sentinel. The other file-level sites (plain/dynamic imports,
 * top-level calls/instantiates, field-access uses, instanceof refs) still spell `moduleName`.
 *
 * ATTEMPTED AND REVERTED IN ITERATION 2, with the measurement recorded here so the next
 * attempt does not rediscover it: adopting the sentinel at those five sites changed 22,139
 * of 42,637 rows' SOURCE spelling on the 400-file stride (calls 15,610 · uses 4,746 ·
 * imports 1,399 · instantiates 358 · references 13) and every fixture was re-baselinable —
 * but it DID NOT preserve the row population. It surfaced **17 additional rows on the draw**
 * (42,637 → 42,654), because the field-access/callee dedupe key is `${source}.${seg}`: with
 * the basename as source, `source="a.b", seg="c"` and `source="a", seg="b.c"` collide on the
 * key `a.b.c` and one row is silently dropped; `(file)` cannot collide that way, so the
 * dropped DISTINCT rows reappear. On the arbiter that is **+11 edges (54,582 → 54,593) and
 * `uses` arbitraryTwin 3,943 → 3,945**, which trips the lane's standing rule ("if
 * arbitraryTwin rises, REVERT") — so the change was reverted whole, fixtures included. The
 * rate is unchanged (16.03% either way: the 2 new file-crossing rows are among the 11 newly
 * surfaced ones, and no pre-existing edge changed class) — but the rule is absolute and the
 * decision belongs to the owner. THE PATH TO LAND IT: make the dedupe key unambiguous
 * (`${source}\u0000${seg}`, or key on the owning symbol's identity), THEN adopt the sentinel.
 * That ordering preserves the population and the axis while recovering the 17 facts.
 *
 * `(` and `)` cannot appear in a JavaScript identifier, so no declaration can be
 * named `(file)` and the store's name lookup cannot attach one of these rows to a
 * symbol by accident. The terminal pass at the end of `analyze` tags every row
 * carrying this source with `metadata.fileLevel` + `metadata.scopeName`, which is
 * what the store's existing branch (parallel-indexer, M60/#910) reads to record
 * the project-relative path as `source_external`.
 */
const FILE_LEVEL_SOURCE = "(file)"

/**
 * A RECEIVER TYPE THIS FILE STATES, and the EVIDENCE CLASS that stated it — published on the
 * edge as `metadata.owner` (the channel the store ALREADY reads: `member-owner-resolution.ts`'s
 * `claimOwnerCarryingTargets` + `resolveMemberTargetsByOwner`, called from both resolution paths
 * in parallel-indexer) plus `metadata.ownerEvidence`.
 *
 * JavaScript has no type syntax, so an owner may only be recorded from a form that genuinely
 * states the type. The evidence vocabulary is the four forms the arbiter's model knows:
 *
 *   new         `const c = new Widget()`                    — the initialiser
 *   assignment  `this.x = new Widget()`, `x = new W()`, and a class field `x = new W()`
 *   this        `this.m()` — the enclosing class DECLARATION is the receiver type (positional)
 *   jsdoc       `/** @type {Widget} *\/ const c = ...`, a `@param {Widget} c` in scope, or a
 *               constructor parameter assignment `this.c = c` where `c` carries `@param {Widget}`
 *
 * A wrong owner is worse than none: the store WITHDRAWS the name binding for an owner-carrying
 * row and then declines when the owner does not identify exactly one class-like symbol, so every
 * form here is one the syntax PROVES rather than a guess from a name.
 */
type ReceiverType = { type: string; evidence: ReceiverEvidence }

/**
 * A POSITIONAL LEXICAL SCOPE — the model the LOCAL-BINDING claim needs (contract:
 * validation/m14/verification/JAVASCRIPT-LOCAL-BINDING-CONTRACT.md). Ranges are NODE OFFSETS, not
 * lines: a binding claim must be resolved at the exact site, and minified one-line files make a
 * line-based answer a guess. `published` is the load-bearing flag: the PROGRAM scope's bindings are
 * published SYMBOLS (module-scope declarations), so a name resolving there must NOT be claimed as a
 * binding (the family contract: never claim a name that is a real in-file declaration at the site);
 * function/block/catch scopes hold unpublishable bindings, which ARE claimable.
 */
type BindingScope = {
  kind: "program" | "function" | "block" | "catch"
  startIndex: number
  endIndex: number
  published: boolean
  parent: BindingScope | null
  names: Set<string>
  /**
   * R2 (charter §21.41) — THE DECLARATION'S OWN OFFSET for each name this scope declares.
   *
   * A scope holds each name at most once (the model's own `names` is a Set, and JavaScript's own
   * rules make a second declaration in the same scope the SAME binding: `var` hoists to the
   * function scope, a parameter and a `var` of the same name are one binding, and a second `let`
   * in one block is a syntax error). So the scope's identity plus the declaration's offset IS the
   * declaration's identity: two reads of ONE declaration share it, two reads of TWO declarations
   * do not.
   *
   * This is the dart lane's R2 shape (the innermost enclosing scope that declares the name, plus
   * that declaration's own position), computed from the scope model this lane ALREADY builds — no
   * new pass and no new AST walk.
   */
  decls: Map<string, number>
}

type BindingModel = {
  scopes: BindingScope[]
  /** every binding name in the file — used by the claim pass's REFUSALS (a file that binds a name never gets an external claim) */
  allNames: Set<string>
  /** import / require bindings: the imported-binding SEAM class, NEVER claimed as local bindings */
  moduleBindings: Set<string>
  /**
   * LOCAL NAME -> MODULE SPECIFIER AS WRITTEN for every import / require binding whose specifier is
   * a LITERAL (this is the EVIDENCE the imported-binding claim carries; a dynamic specifier has no
   * entry, so its binding can never be claimed — the contract's never-claim (c)).
   */
  moduleBindingSpecs: Map<string, string>
  /**
   * PROGRAM-scope class DECLARATIONS — the only class-like names whose members are PUBLISHED
   * symbols, so the only ones a static-class receiver may name. Class EXPRESSIONS are excluded on
   * purpose (their class is not a symbol this family publishes; naming one would hand the owner
   * channel an owner it cannot verify).
   */
  publishedClasses: Set<string>
  /**
   * R2 (charter §21.41) — THE NAMES THIS FILE DECLARES IN MORE THAN ONE SCOPE.
   *
   * Only these names can be the two reads of TWO DIFFERENT declarations that a name-only dedup
   * key would collapse, so only these names pay for the scope-identity lookup. Every other name
   * keeps the payload-pollution dedup key byte for byte, and the change is confined to the class
   * where the scope carries the fact.
   */
  multiScopeNames: Set<string>
}
type ReceiverEvidence = "new" | "assignment" | "this" | "jsdoc" | "class-static" | "this-alias"

export class RealJavaScriptAnalyzer implements ASTEngine.LanguageAnalyzer {
  /**
   * Whether the file currently being analyzed contains any `decorator` node.
   * Set once per `analyze` call; see the pre-pass at its assignment for the
   * measurement that made it worth having.
   */
  private hasAnyDecoratorNode = false

  /**
   * The positional lexical scope model for the file currently being analyzed (built once per
   * `analyze`, before the relationship extraction passes, so every emission site can resolve its
   * own node position exactly). Null outside an `analyze` call.
   */
  private bindingModel: BindingModel | null = null

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
                const boundBase = base.type === "identifier" ? this.localBindingTarget(base, base.text, name) : null
                const importedBase = boundBase ? null : (base.type === "identifier" ? this.importedBindingFor(base, base.text) : null)
                relationships.push({
                  source: name,
                  target: boundBase ?? base.text,
                  type: ASTEngine.RelationshipType.Extends,
                  confidence: 1.0,
                  ...this.lineField(base),
                  metadata: boundBase ? { localBinding: true } : (importedBase ? { importedBinding: importedBase } : {}),
                })
              } else {
                // M14 / R3 — a CALL-shaped heritage (`extends Base.extend(M)` or
                // `extends MixinFn(Base)`). The base's identifier is a GRANDCHILD of the
                // call_expression, so the lookup above found nothing and the class published
                // no edge at all. The base and the mixins are read from the call's SHAPE.
                const rows = this.callShapedHeritageRows(heritage, name)
                if (rows.base) {
                  relationships.push({
                    source: name,
                    target: rows.base.target,
                    type: ASTEngine.RelationshipType.Extends,
                    confidence: 1.0,
                    ...this.lineField(rows.base.node),
                    metadata: rows.base.metadata,
                  })
                }
                for (const mix of rows.mixins) {
                  relationships.push({
                    source: name,
                    target: mix.target,
                    type: ASTEngine.RelationshipType.MixesIn,
                    confidence: 1.0,
                    ...this.lineField(mix.node),
                    metadata: { ...mix.metadata, isMixin: true },
                  })
                }
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
              const boundBaseExpr = base.type === "identifier" ? this.localBindingTarget(base, base.text, ownName) : null
              const importedBaseExpr = boundBaseExpr ? null : (base.type === "identifier" ? this.importedBindingFor(base, base.text) : null)
              relationships.push({
                source: ownName,
                target: boundBaseExpr ?? base.text,
                type: ASTEngine.RelationshipType.Extends,
                confidence: 1.0,
                ...this.lineField(base),
                metadata: boundBaseExpr ? { localBinding: true } : (importedBaseExpr ? { importedBinding: importedBaseExpr } : {}),
              })
            } else {
              // M14 / R3 — the same CALL-shaped heritage the class declaration handles.
              const rows = this.callShapedHeritageRows(heritage, ownName)
              if (rows.base) {
                relationships.push({
                  source: ownName,
                  target: rows.base.target,
                  type: ASTEngine.RelationshipType.Extends,
                  confidence: 1.0,
                  ...this.lineField(rows.base.node),
                  metadata: rows.base.metadata,
                })
              }
              for (const mix of rows.mixins) {
                relationships.push({
                  source: ownName,
                  target: mix.target,
                  type: ASTEngine.RelationshipType.MixesIn,
                  confidence: 1.0,
                  ...this.lineField(mix.node),
                  metadata: { ...mix.metadata, isMixin: true },
                })
              }
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
          //
          // M60/JD3-CLOSURE (2026-10-03): an OBJECT LITERAL's member belongs to
          // the literal, and never to the class that lexically encloses it. The
          // order below used to consult `scopeOwnerName` FIRST, and that is a
          // class-scope lookup, so it answered for every object literal nested
          // inside a class body too:
          //
          //   class C { m() { const api = { run() {}, stop() {} }; return api } }
          //
          // published `contains C -> run` and `contains C -> stop`, discarding a
          // binding the file writes in plain sight — and at MODULE scope the very
          // same literal published `contains api -> run`, so one construct gave
          // two answers depending on where it was written. The differential's
          // oracle already declines these rows: its `contains` rule asks whether
          // the container is NAMEABLE, and a `new Proxy({}, { get(){}, has(){} })`
          // argument is not, so the 2 rows it published for
          // `svelte/src/legacy/legacy-client.js` registered as UNEXPLAINED
          // fabrications at confidence 1.0 rather than as the mis-attribution they
          // are. JD3's closure note claimed `containerOwnerName` superseded
          // `scopeOwnerName`; it superseded it only where no class scope existed.
          //
          // So the literal case is decided FIRST and the class scope is not a
          // fallback for it: a literal with no binding has no owner, which is
          // the honest silence the module-scope path already took.
          const inObjectLiteral = node.parent?.type === "object"
          const classOwner = inObjectLiteral ? undefined : scopeOwnerName(scopeStack)
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
          // X10 (2026-09-28): `generator_function` belongs in this list. Measured: `const f = function() {}` published f:function and `const h = () => {}` published h:function, while `const g = function*() {}` published g:constant. One language rule — "a const bound to a function value is a Function" — answered two ways by shape, and the grammar's name for a generator expression is `generator_function`, which none of the three function-value checks in this file listed. Found by probing a form the construct census had DECLARED but never probed, which is the blind spot that gap was: the disposition existed, so the form looked covered.
          const isFunctionValue = !!valueNode && (valueNode.type === "arrow_function" || valueNode.type === "function_expression" || valueNode.type === "generator_function")
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
              this.collectModuleExports(right, exports, node, false, "exports")
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
                this.collectModuleExports(right, exports, node, true, "module-exports")
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
                  exports.push({
                    name: exportName, isDefault: false, range: this.nodeToRange(seg),
                    metadata: { viaCommonJs: true, cjsForm: "deep-member-assignment" },
                  })
                }
              }

              // Prototype method assignment: X.prototype.method = function () {}
              const isFunctionRight = right.type === "function_expression" || right.type === "arrow_function" || right.type === "generator_function"
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
                  metadata: {
                    // THE EVIDENCE KEY for the arbiter's import facts: the module specifier as written.
                    // The ES-import rows already carried `module`; the require/import() rows did not, and
                    // the first arbiter smoke measured the cost exactly: SIX importedBinding claims were
                    // REFUTED because their evidence edge had no `module` to key file->specifier->bindings
                    // with (every one of the six was a require() binding: fs, path, an absolute pg path,
                    // ../utils/logger, ../../services/...). The claim's `specifier` and this field must be
                    // the SAME spelling — both come from stringContent() on the written argument.
                    module: reqPath,
                    isRequire: !isDynamic,
                    isDynamicImport: isDynamic,
                    unresolved: true,
                    // THE EVIDENCE the imported-binding claim is verified against: the local names this
                    // module load binds IN THIS FILE (a destructured `const { a } = require("m")` binds a,
                    // a bare `const fs = require("m")` binds fs). Dynamic specifiers are refused earlier,
                    // so they reach no claim — the contract's never-claim (c).
                    importedBindings: (() => {
                      // The declarator this module load initialises, walking up from the CALL node —
                      // independent of the requireIsDefault branch above (whose `vp` is block-scoped).
                      let owner: Node | null = node.parent
                      while (owner && owner.type !== "variable_declarator" && owner.type !== "lexical_declaration" &&
                             owner.type !== "variable_declaration" && owner.type !== "export_statement" &&
                             owner.type !== "expression_statement" && owner.type !== "program") {
                        owner = owner.parent
                      }
                      const bindName = owner && owner.type === "variable_declarator"
                        ? owner.childForFieldName("name")
                        : null
                      return bindName ? this.collectPatternPairs(bindName).map((pair) => pair.name) : []
                    })(),
                  },
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
              const jsItemName = item.text.split(" as ")[0]
        // THE BARE ITEM NAME, FOR A LOCAL MODULE ONLY. THREE lanes emit `<module>:<item>` — this one,
        // javascript and python — and a
        // colon makes the target path-like to the gate's `pathLikeTarget` AND is refused by
        // `_i13_pick`'s own predicate (`instr(target_external,':') = 0`, parallel-indexer.ts:4484)
        // — two independent refusals, measured: `imports` resolved 0 with 0 ambiguous in every lane.
        // The edge's target is the SYMBOL it refers to; the module is already in `metadata.module`.
        //
        // NOT JAVA, and the count was corrected here after being written wrong: `real-java-analyzer.ts`
        // emits `target: moduleName` with no colon at all (`:600`, `:658`), and `grails-core` measures
        // 0 colon edges across 1,942 java files — java's `imports` zero has a different cause and must
        // not be priced with this change.
        //
        // LOCAL ONLY, and the restriction is the difference between a fix and a defect: measured on
        // the recorded ceiling, 432 (ts) + 276 (js) + 5 (py) EXTERNAL items would resolve to a
        // project-local symbol that merely SHARES THE NAME — a false binding, not a fix. A relative
        // (`./`, `../`) or absolute specifier is local by the grammar of the source itself; anything
        // else keeps its current spelling untouched, which is what makes the external half provably
        // unmoved.
              // ONE FORM KEEPS THE MODULE-QUALIFIED SPELLING: a DEFAULT import.
              // Its local binding (`Def` in `import Def from "./lib"`) names no
              // declaration — the module exports `default` — so the bare name
              // pass can only leave it unresolved or attach it to an unrelated
              // same-named symbol. The module-aware resolver is the honest route
              // (`declaredKind: "default"` -> the target module's default export,
              // recovered through the export row's `localName`), and it reads
              // `<module>:<item>` rows only. MEASURED on the two-file probe: with
              // the default row spelled `./lib.js:Def`, `resolveImportTargets`
              // binds it to `Main` (the declared default) — 1 scanned, 1 resolved.
              const bareLocalItem = item.kind === "named" && !isNamespaceItem && jsItemName !== "" && (srcPath.startsWith(".") || srcPath.startsWith("/"))
              // THE SYMBOL THE EDGE REFERS TO, for a LOCAL named specifier: the
              // DECLARED name, not the local binding. `import { draw as render }`
              // refers to `draw`; `render` is a name in THIS file. The target is
              // read by the store's name pass, so spelling the local binding
              // there attaches the row to whatever declaration shares that name —
              // MEASURED on a two-file project (a fixture with `draw as render`
              // beside `class Widget { render() {} }`): the import row bound to
              // `Widget.render` in the target's own file, a wrong binding of the
              // exact class the m40 gate calls "the decoy". Nothing is lost by the
              // re-spelling: `metadata.declaredName` still carries the source
              // name and `imports[]` still carries the local binding the file
              // writes. A DEFAULT import keeps the local binding as its target
              // (`default` is in the symbol denylist and names no declaration);
              // a NAMESPACE import keeps `<module>:*` (no member is named).
              const localNamedTarget = item.kind === "named" ? (item.declared || jsItemName) : jsItemName
              relationships.push({
                source: moduleName,
                // FOR A LOCAL MODULE the target is the symbol the edge refers to;
                // for an external one it stays `<specifier>:<local binding>`,
                // which is what the importing fixtures pin.
                target: bareLocalItem ? localNamedTarget : `${srcPath}:${isNamespaceItem ? "*" : jsItemName}`,
                type: ASTEngine.RelationshipType.Imports,
                confidence: isNamespaceItem ? 0.6 : 1.0,
                ...this.lineField(item.node),
                // JD2b, additive: what the MODULE declares, so the resolver can
                // reach the right symbol for an aliased or default import. The
                // edge target above is untouched.
                metadata: {
                  // THE MODULE, NOW THAT IT IS NO LONGER GLUED INTO THE TARGET. TypeScript's site
                  // already carried `module`; this one did not, so a bare item name here would have
                  // LOST the module half rather than moved it — and an item name with no module is
                  // unresolvable by construction (which module's `readJson`?).
                  module: srcPath,
                  declaredName: item.declared,
                  declaredKind: item.kind,
                  // THE LOCAL NAME THIS IMPORT BINDS — the evidence for the imported-binding claim.
                  // Default/named: the item's local spelling (alias when present); namespace: the
                  // local `ns` identifier the clause writes (the item's text is `*`).
                  importedBindings: isNamespaceItem
                    ? (String(item.node?.text ?? "") ? [String(item.node.text)] : [])
                    : (item.text ? [item.text] : []),
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
            // Named clauses carry the members they re-export. The two
            // spellings in a specifier are DIFFERENT facts: `name` is the member
            // in the SOURCE module (what the specifier resolves to), `alias` is
            // the name THIS module exports it under (`export { readFile as read }
            // from "fs"` re-exports `readFile`). JSD45/JSD46: the old code kept
            // only `alias ?? name` for the `imports[]` payload and published ONE
            // `path:*` row for the whole statement, so the member names were
            // discarded — 713 named re-export statements carrying 790 written
            // member names across the corpora became a module-level dependency
            // with no member, at 0.6, while `import { a } from './m'` already
            // yielded `m:a` at 1.0. Same member, same module path, first-class in
            // one direction and thrown away in the other.
            const namedSpecs: { member: string; exportedAs: string; node: Node }[] = []
            const clauseNames: string[] = []
            const clause2 = this.findChildByType(node, "export_clause")
            if (clause2) {
              for (let i = 0; i < clause2.namedChildCount; i++) {
                const spec = clause2.namedChild(i)
                if (spec && spec.type === "export_specifier") {
                  const nameNode = spec.childForFieldName("name") ?? spec.namedChild(0)
                  const alias = spec.childForFieldName("alias")
                  // A module namespace name may itself be a STRING (`export {
                  // "a-b" as c } from "m"`, ES2022 arbitrary module namespace
                  // names), whose `.text` carries the quotes — `stringContent` is
                  // the same unquoting the module path uses.
                  const member = nameNode
                    ? (nameNode.type === "string" ? stringContent(nameNode) : String(nameNode.text ?? ""))
                    : ""
                  if (nameNode && member) {
                    // UNCHANGED for the `imports[]` payload: the exported
                    // spelling, which is what the two barrel fixtures pin
                    // (`alias || name`).
                    namedSpecs.push({ member, exportedAs: alias ? String(alias.text) : member, node: nameNode })
                    clauseNames.push(alias ? String(alias.text) : member)
                  }
                }
              }
            }
            const starOnly = !clause2 && this.hasToken(node, "*")
            // THE TWO STAR FORMS ARE DIFFERENT FACTS, and until now they emitted
            // byte-identical records. `export * from "./m"` REDISTRIBUTES every
            // member of `./m`; `export * as ns from "./m"` binds ONE name in this
            // file and redistributes nothing. The grammar marks them apart with a
            // NAMED `namespace_export` child (`"* as ns"`), so this is a tree
            // fact rather than a text guess — and it is also why `starOnly` is
            // FALSE for the namespace form: the `*` is inside that named node,
            // not a direct token. A resolver reading a star edge as a
            // redistribution would otherwise invent, for a consumer of this file,
            // every member of `./m` the language does not export from it.
            const namespaceExport = this.findChildByType(node, "namespace_export")
            const namespaceAlias = namespaceExport
              ? String(namespaceExport.childForFieldName("name") ?? namespaceExport.namedChild(0)?.text ?? "")
              : ""
            imports.push({
              module: modPath,
              items: starOnly ? ["*"] : clauseNames,
              isDefault: false,
              range: this.nodeToRange(node),
              metadata: { reExport: true },
            })
            if (namedSpecs.length) {
              for (const spec of namedSpecs) {
                relationships.push({
                  source: FILE_LEVEL_SOURCE,
                  // The MEMBER in the source module — not the alias this module
                  // exports it under, which is what an `exports` edge is about.
                  target: `${modPath}:${spec.member}`,
                  type: ASTEngine.RelationshipType.Imports,
                  // 1.0 for the same reason a named import keeps 1.0: the member
                  // name is WRITTEN in this file, and ESM fixes its meaning (the
                  // source module must export `member`), so this is a stated
                  // dependency and not an inference. `export *` / `export * as ns`
                  // keep 0.6 and `unresolved` — they write no member name.
                  confidence: 1.0,
                  // The specifier's OWN line: a clause is a list, and the name the
                  // edge is about is written on its own line.
                  ...this.lineField(spec.node),
                  metadata: {
                    isReExport: true,
                    declaredName: spec.member,
                    declaredKind: "named",
                    // A re-export binds NO local name in this file (never-claim (d): a different
                    // surface). The key is published on EVERY imports edge so the arbiter never has
                    // to distinguish "no bindings" from "this row forgot the evidence".
                    importedBindings: [],
                    ...(spec.exportedAs !== spec.member ? { exportedAs: spec.exportedAs } : {}),
                  },
                })
              }
            } else {
              relationships.push({
                source: FILE_LEVEL_SOURCE,
                target: `${modPath}:*`,
                type: ASTEngine.RelationshipType.Imports,
                // JD-J12 (M60, 2026-09-27): a clause-less re-export (`export *
                // from "m"`) names the MODULE and no member of it — `*` again. A
                // module path is not a symbol, so 1.0 overstated it the same way
                // it overstated `require` and the namespace import. Kept, marked,
                // and demoted: the re-export dependency is real.
                confidence: 0.6,
                // A re-export with no clause names the MODULE, so the written
                // name is the module-path argument itself.
                ...this.lineField(exportSource),
                // `starForm` is the discriminator, and it is the one piece of
                // evidence a resolver needs to tell a REDISTRIBUTION from a
                // namespace binding: only `all` may be followed for a name this
                // file does not publish.
                metadata: {
                  isReExport: true,
                  unresolved: true,
                  starForm: namespaceAlias ? "namespace" : "all",
                  // A clause-less re-export binds NO local name (never-claim (d)). Published on every
                  // imports edge so the arbiter never has to distinguish "no bindings" from "missing
                  // evidence".
                  importedBindings: [],
                  ...(namespaceAlias ? { namespaceName: namespaceAlias } : {}),
                },
              })
            }
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
          if (nameNode && valueNode && (valueNode.type === "arrow_function" || valueNode.type === "function_expression" || valueNode.type === "generator_function")) {
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
    // THE POSITIONAL SCOPE MODEL, built once before any relationship pass: the local-binding claim
    // resolves each emission SITE by node offset (never by line — minified files are one line).
    this.bindingModel = this.collectBindingModel(rootNode)
    this.addContainmentRelationships(symbols, relationships)
    this.extractOverrideRelationships(symbols, relationships, context?.overrideCompanion)
    // ONE COLLECTION PER FILE: both walks consume the same receiver-type map, so a member call
    // and a member read can never disagree about which type the file states for a receiver.
    const receiverTypes = this.collectLocalReceiverTypes(rootNode)
    this.extractCallRelationships(rootNode, symbols, relationships, moduleName, receiverTypes, deadSpans)
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
    // An export is by definition the MODULE's surface — the file is the actor.
    // See FILE_LEVEL_SOURCE for why the spelling is the sentinel and not the
    // basename: the store resolves a source BY NAME, and a module basename is a
    // legal JavaScript identifier this ecosystem itself uses
    // (`visitors/Attribute.js` declaring `function Attribute`).
    // The FILE-LOCAL declaration set is what the export-surface claim must respect: a CJS property
    // whose name THIS FILE declares is a name the name model can resolve honestly, so the claim is
    // suppressed there (arbiter rule: a project declaration answering the name REFUTES the claim; the
    // same-file case is knowable in the analyzer and must not be emitted at all).
    this.extractExportRelationships(
      exports,
      relationships,
      FILE_LEVEL_SOURCE,
      new Set(symbols.map((sym) => String(sym?.name ?? "")).filter((n) => n.length > 0)),
    )
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
    this.collectFieldAccessUses(rootNode, relationships, moduleName, receiverTypes, deadSpans)

    // Declared/checked type references (M14): JavaScript has no type
    // annotations, but instanceof checks reference a type by name — the one
    // unambiguous type-usage signal the grammar carries.
    this.extractInstanceofRefs(rootNode, relationships, moduleName)

    // R7, RUNTIME half — measured on 13,202 admitted corpus files: 2,037 rows
    // (0.57% of 356,490) carried an EMPTY source or target. Every one came from
    // tree-sitter's ERROR RECOVERY producing a zero-length node:
    //
    //   uses  <- ""   a bare read of an `identifier` node whose text is "",
    //                 which is what the grammar hands back for TypeScript syntax
    //                 in a `.js` file (`var xs2: typeof moduleA[] = [moduleA]`,
    //                 `public bar(x: string[]): void;`)                    1,934
    //   uses  <- ""   a member-chain SEGMENT whose property node is missing
    //                 (`throw undefined.`, `super.`, `new A2().`)              87
    //   uses  <- ""   a `template_substitution` with an empty `${ }`             5
    //   uses  "" -> x an EMPTY SOURCE: the source expression read
    //                 `method ?? owner ?? moduleName`, and `??` falls through only
    //                 null/undefined, so a zero-length `method` won           7
    //   calls <- ""   a callee node the recovery left empty (`new A2().()`)      3
    //   exports <- "" a CJS surface path segment that is empty (`exports. = 1`) 1
    //
    // An edge whose endpoint is the empty string names nothing. It cannot be
    // resolved, hovered, or followed by any consumer, and every such consumer
    // that counts names gets a row for a name no file contains — which is the
    // whole of standing rule R7. The differential's TRUTH side already applies
    // exactly this guard (`script/m14/differential.ts`, M60/SDJ-17: "an edge with
    // an empty endpoint names nothing — it cannot be resolved, hovered or
    // followed"), so before this the comparison was ASYMMETRIC: the truth could
    // not assert an unnameable edge and the analyzer could publish one.
    //
    // It is a TERMINAL guard rather than a check per emission site on purpose.
    // Nineteen sites push edges and a twentieth added tomorrow would be the one
    // that forgets, and the census that found these 2,037 rows is a separate
    // program that must be re-run to notice. One place cannot be forgotten.
    //
    // The number is not a corpus artefact to be waved away: on `svelte` (3,447
    // real JavaScript files, 0 parse errors) and `lodash` (51 files, 0 parse
    // errors) the same measurement is 0 and 0. It fires only where the input is
    // not JavaScript, and dropping the row is right there too — the row is a
    // statement about the grammar's error recovery, not about the program.
    //
    // ── A FILE-LEVEL ROW SAYS SO ─────────────────────────────────────────────
    //
    // Every row sourced at `FILE_LEVEL_SOURCE` has the MODULE as its actor.
    // `fileLevel` is the store's existing contract for exactly that (M60/#910: it
    // rewrites `source_external` to the project-relative path — a NODE a consumer
    // can follow — rather than a bare basename that may or may not be a
    // declaration in this file). Applied HERE, terminally, for the same reason the
    // endpoint guard below is: the re-export sites are three today and a fourth
    // added tomorrow is the one that forgets. `scopeName` keeps the module's own
    // name, which the store's branch otherwise takes from the source spelling.
    // It runs BEFORE the endpoint guard so a row reaching it with the sentinel is
    // judged on its real endpoints, not on a placeholder.
    for (const r of relationships) {
      if (r.source !== FILE_LEVEL_SOURCE) continue
      r.metadata = { ...(r.metadata ?? {}), fileLevel: true, scopeName: moduleName }
    }
    for (let i = relationships.length - 1; i >= 0; i--) {
      const r = relationships[i]
      if (!r.source || !r.target) relationships.splice(i, 1)
    }

    // EXTERNAL CLAIMS — the ADDITIVE half of resolution: it rewrites no target, adds no edge, and
    // moves no edge out of `unresolved` on its own authority. See markExternalClaims.
    this.markExternalClaims(rootNode, relationships, symbols, context)

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
    const overrideSeen = new Set<string>()
    for (const s of symbols) {
      // J10: an ACCESSOR pair is a prototype member like any other, so a subclass
      // accessor DOES shadow the base accessor. Accessors are kinded `property`
      // (a declared contract other lanes and fixtures read) and merely carry
      // `metadata.isAccessor` — so widening `overrides` does NOT change kinds.
      const isAccessorMember = s.kind === ASTEngine.SymbolKind.Property && s.metadata?.isAccessor === true
      if ((s.kind === ASTEngine.SymbolKind.Method || s.kind === ASTEngine.SymbolKind.Constructor || isAccessorMember) && s.ownerName) {
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
        const inFileDeclares = !isCtor && (byName.get(s.name)?.some((bm) => bm.ownerName === base && (bm.kind === ASTEngine.SymbolKind.Method || (bm.kind === ASTEngine.SymbolKind.Property && bm.metadata?.isAccessor === true))) ?? false)
        if (inFileDeclares || (!isCtor && overrideCompanion?.get(base)?.has(s.name))) {
          // J10: `get x()` and `set x()` shadow the SAME base slot, so the pair
          // yields ONE edge. Without this the accessor pair double-counted.
          const ovKey = `${s.ownerName}.${s.name}->${base}.${s.name}`
          if (overrideSeen.has(ovKey)) continue
          overrideSeen.add(ovKey)
          relationships.push({
            source: `${s.ownerName}.${s.name}`,
          // THE TARGET IS THE MEMBER NAME, NOT `Owner.member`: the resolver binds against
          // DECLARATIONS, and a declaration is named by its leaf. Measured: 100% of this lane's
          // overrides targets are dotted, 100% have their leaf declared in the edge's own file, and
          // 100% classify unresolved — a naming problem, not a mechanism problem. `localEdgeName`
          // derives the leaf AFTER the paren deletion `localEdgeLabel` performs, so a dotted
          // parameter list cannot be cut into a non-name (see its doc).
            target: s.name,
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
          // J9 (2026-09-30): a `#private` NAME IS NEVER A PROTOTYPE MEMBER, so it
          // cannot override anything — and this branch's whole premise is that the
          // base is UNKNOWN, not that the member is. 0.5 is the right tier for a
          // true edge with a guessed base; it is the wrong tier for an edge that is
          // false by the language's own definition, because "the base is unknown"
          // says nothing about whether the name could be a member of ANY base.
          //
          // In JavaScript a `#name` is class-scoped: it is installed on each
          // INSTANCE at construction and is not on the prototype at all, so no
          // subclass can shadow it and no base can declare it. Measured over the
          // full 3,369-file corpus, this branch produced 50 override edges naming a
          // builtin base, of which SIX were private names that the language says
          // cannot be members of anything:
          //
          //   URLSearchParams.#update_url   Map.#read_all   Map.#source
          //   Set.#init   Set.#source        Date.#init      (6 edges)
          //
          // So the guard is not a tightening of a heuristic, it is the removal of
          // rows that the language rules out. It is deliberately narrow: nothing
          // else about this branch changes, and the remaining 0.5 rows stay,
          // because for THOSE the base genuinely is unknown and the suspicion is
          // honest — see J9 in script/m14/spec/javascript-completeness.json for the
          // full classification of the 48 distinct names this branch produces.
          if (s.name.startsWith("#")) continue
          // J9 (2026-09-30): the guess is now CHECKED against the base's actual
          // prototype chain rather than emitted on a name match alone.
          //
          // Measured over the full 3,369-file corpus with this check applied: 37 of
          // the 44 emitted override rows are confirmed members of the base they name,
          // and 7 are not — `connectedCallback`, `disconnectedCallback` and
          // `attributeChangedCallback` (hooks the browser INVOKES on a custom element,
          // not members of `HTMLElement`), `$$g_p` (a class field), `[REPLACE]` (a
          // template marker that merely looks like a computed key), and `toJSON` on
          // `Error` and `URL`.
          //
          // That ratio is what decided J9 part 2. Suppressing the whole first-parent
          // guess would have removed 37 CORRECT rows to delete 7 wrong ones, so the
          // guess stays and only the provably-absent names go. The decision rests on a
          // measurement rather than on how suspicious 0.5 feels — and it was only
          // available BECAUSE the oracle was built first, so the analyzer's guess
          // could be measured against something instead of argued about.
          //
          // A base this module does not know is NOT rejected: an unknown base keeps the
          // 0.5 guess, because declining to speak about a base we cannot resolve is
          // the honest position and the guess is declared as a guess.
          if (isJsBuiltin(base) && !jsBuiltinHasMember(base, s.name)) continue
          // Pass 3 (family parity with java/groovy resolveOverrides): the
          // base is not declared in this file and the companion index gave
          // no opinion (it is never populated in production — see M37.10).
          // Emit the deterministic first-parent guess BELOW the patterns.ts
          // threshold (0.7): visible in raw output, counted as heuristic
          // (honest suspicion) by the differential. Pre-M37.10 this edge was
          // silently dropped for every externally-declared base.
          //
          // J10: the same get/set collapse the verified branch applies. Without
          // it here the accessor pair emitted TWO rows for one override — the first
          // attempt at this fix deduplicated only the in-file branch and doubled
          // every accessor guess. It showed up as `SvelteURL.hash` at BOTH line 77
          // (get) and line 81 (set): the accessor pair is what made it visible.
          const guessKey = `${s.ownerName}.${s.name}->${base}.${s.name}`
          if (overrideSeen.has(guessKey)) continue
          overrideSeen.add(guessKey)
          relationships.push({
            source: `${s.ownerName}.${s.name}`,
          // THE TARGET IS THE MEMBER NAME, NOT `Owner.member`: the resolver binds against
          // DECLARATIONS, and a declaration is named by its leaf. Measured: 100% of this lane's
          // overrides targets are dotted, 100% have their leaf declared in the edge's own file, and
          // 100% classify unresolved — a naming problem, not a mechanism problem. `localEdgeName`
          // derives the leaf AFTER the paren deletion `localEdgeLabel` performs, so a dotted
          // parameter list cannot be cut into a non-name (see its doc).
            target: s.name,
            type: ASTEngine.RelationshipType.Overrides,
            confidence: 0.5,
            ...(s.range?.startLine ? { line_number: s.range.startLine } : {}),
            metadata: { reasonCode: "first-parent-guess" },
          })
        }
      }
    }
  }

  /**
   * RECEIVER TYPES for a member call on a LOCAL variable — the JavaScript twin of
   * the TypeScript pass (`collectLocalReceiverTypes` there, where the three-file
   * measurement and the reasoning live).
   *
   * JavaScript states a receiver's type in exactly one syntactic form: an
   * initialiser. `const c = new Foo()` is the whole rule here; there are no type
   * annotations to read, which is why this map is smaller than the TS one rather
   * than narrower by choice. A name declared with two different constructors in
   * one file is dropped: shadowing makes the file-level answer a guess, and a
   * wrong owner rewrites a binding that is currently right.
   */
  private collectLocalReceiverTypes(root: Node): Map<string, ReceiverType> {
    const types = new Map<string, ReceiverType>()
    const conflicted = new Set<string>()
    const record = (name: string, type: string, evidence: ReceiverEvidence): void => {
      if (name.length === 0 || type.length === 0) return
      const previous = types.get(name)
      if (previous === undefined) {
        if (!conflicted.has(name)) types.set(name, { type, evidence })
      } else if (previous.type !== type) {
        // TWO TYPES FOR ONE NAME IN ONE FILE: shadowing makes the file-level answer a guess,
        // and a wrong owner rewrites a binding that is currently right — drop, never pick.
        types.delete(name)
        conflicted.add(name)
      }
    }
    /** the CONSTRUCTOR LEAF a `new` expression names (`new Foo()`, `new ns.Foo()`). */
    const newCtorLeaf = (value: Node | null | undefined): string | null => {
      if (!value || value.type !== "new_expression") return null
      const ctor = value.childForFieldName("constructor") ?? value.namedChild(0)
      if (ctor?.type === "identifier") return ctor.text
      if (ctor?.type === "member_expression") return ctor.childForFieldName("property")?.text ?? null
      return null
    }
    /** the JSDoc COMMENT directly preceding a declaration, when there is one. */
    const precedingDoc = (node: Node): string | null => {
      let stmt: Node = node
      while (stmt.parent && stmt.parent.type !== "program" && stmt.parent.type !== "statement_block" &&
             stmt.parent.type !== "class_body" && stmt.parent.type !== "switch_body") {
        stmt = stmt.parent
      }
      const prev = stmt.previousSibling
      if (!prev || prev.type !== "comment") return null
      const text = prev.text
      return text.startsWith("/**") ? text : null
    }
    /** the `@type {C}` a preceding JSDoc comment states, parsed as text — no regex. */
    const jsdocTypeOf = (node: Node): string | null => {
      const text = precedingDoc(node)
      if (text === null) return null
      const at = text.indexOf("@type")
      if (at < 0) return null
      const open = text.indexOf("{", at + 5)
      if (open < 0) return null
      const close = text.indexOf("}", open + 1)
      if (close < 0) return null
      const inner = text.slice(open + 1, close).trim()
      return isPlainJsIdentifier(inner) ? inner : null
    }
    /** every `@param {C} name` a JSDoc block states, parsed as text — no regex, no tag guessing. */
    const jsdocParamsOf = (node: Node): Map<string, string> => {
      const out = new Map<string, string>()
      const text = precedingDoc(node)
      if (text === null) return out
      let from = 0
      for (;;) {
        const at = text.indexOf("@param", from)
        if (at < 0) break
        from = at + 6
        const open = text.indexOf("{", from)
        if (open < 0) break
        const close = text.indexOf("}", open + 1)
        if (close < 0) break
        const type = text.slice(open + 1, close).trim()
        let i = close + 1
        while (i < text.length && (text[i] === " " || text[i] === "\t")) i++
        let end = i
        while (end < text.length) {
          const ch = text[end]
          if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "-" || ch === "*" || ch === "/") break
          end++
        }
        const name = text.slice(i, end)
        if (isPlainJsIdentifier(type) && isPlainJsIdentifier(name)) out.set(name, type)
        from = close + 1
      }
      return out
    }
    // THE JSDOC PARAM SCOPES, collected BEFORE the receiver walk: a `@param {C} x` types `x`
    // only inside the function it documents, so the map is looked up by the CALL LINE and never
    // applied file-wide (the per-file version would type another function's same-named local —
    // python measured that class wrong and fixed it with scopes).
    const paramScopes: Array<{ startLine: number; endLine: number; types: Map<string, string> }> = []
    {
      const st: Node[] = [root]
      while (st.length > 0) {
        const n = st.pop()!
        if (n.type === "function_declaration" || n.type === "function_expression" ||
            n.type === "generator_function_declaration" || n.type === "generator_function" ||
            n.type === "arrow_function" || n.type === "method_definition") {
          const types = jsdocParamsOf(n)
          if (types.size > 0) {
            paramScopes.push({ startLine: n.startPosition.row + 1, endLine: n.endPosition.row + 1, types })
          }
        }
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c) st.push(c)
        }
      }
    }
    const jsdocParamTypeAt = (line: number, name: string): string | null => {
      let best: { startLine: number; endLine: number; types: Map<string, string> } | null = null
      for (const scope of paramScopes) {
        if (line < scope.startLine || line > scope.endLine) continue
        if (!scope.types.has(name)) continue
        // innermost wins: ranges nest, so the widest span that contains the line is the outer
        // function — the LAST match by span length is the tightest one
        if (best === null || (scope.endLine - scope.startLine) < (best.endLine - best.startLine)) best = scope
      }
      return best === null ? null : best.types.get(name) ?? null
    }
    const stack: Node[] = [root]
    while (stack.length) {
      const n = stack.pop()!
      if (n.type === "variable_declarator") {
        const nameNode = n.childForFieldName("name")
        const value = n.childForFieldName("value")
        if (nameNode && nameNode.type === "identifier") {
          const ctor = newCtorLeaf(value)
          if (ctor !== null) record(nameNode.text, ctor, "new")
          else {
            const docType = jsdocTypeOf(n)
            if (docType !== null) record(nameNode.text, docType, "jsdoc")
          }
        }
      } else if (n.type === "field_definition") {
        // CLASS FIELD INITIALISED WITH `new` — `class C { svc = new Service() }` states the
        // type of `this.svc` exactly as the constructor assignment does.
        const prop = n.childForFieldName("property")
        const value = n.childForFieldName("value")
        const ctor = newCtorLeaf(value)
        if (prop?.type === "property_identifier" && ctor !== null) {
          record(`this.${prop.text}`, ctor, "assignment")
          // also readable unqualified inside instance methods in some styles; keep the
          // this.-key only — an unqualified use is a bare local read, not a proven receiver.
        }
      } else if (n.type === "assignment_expression") {
        // CONSTRUCTOR ASSIGNMENT — `this.x = new C()` (and `x = new C()` for an already
        // declared local). The receiver key is the spelling the CALL will use: `this.x`
        // for a `this.`-rooted member, the bare name otherwise.
        const left = n.childForFieldName("left")
        const right = n.childForFieldName("right")
        const ctor = newCtorLeaf(right)
        const line = n.startPosition.row + 1
        if (left && ctor !== null) {
          if (left.type === "identifier") record(left.text, ctor, "assignment")
          else if (left.type === "member_expression") {
            const obj = left.childForFieldName("object")
            const prop = left.childForFieldName("property")
            if (obj?.type === "this" && prop?.type === "property_identifier") {
              record(`this.${prop.text}`, ctor, "assignment")
            }
          }
        } else if (left && right && left.type === "member_expression" && right.type === "identifier") {
          // CONSTRUCTOR PARAMETER — `this.dep = dep` where `dep` is typed by a JSDoc `@param`
          // in scope: the assignment carries the parameter's stated type onto `this.dep`.
          const obj = left.childForFieldName("object")
          const prop = left.childForFieldName("property")
          if (obj?.type === "this" && prop?.type === "property_identifier") {
            const paramType = jsdocParamTypeAt(line, right.text)
            if (paramType !== null) record(`this.${prop.text}`, paramType, "jsdoc")
          }
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const child = n.namedChild(i)
        if (child) stack.push(child)
      }
    }
    return types
  }

  /**
   * THE CLASS `this` IS BOUND TO AT A CALL SITE — `null` when the call's `this` is not a
   * class instance (a plain function's dynamic `this`, or no class at all).
   *
   * PURE SYNTAX, no inference: an arrow function does not rebind `this`, so it is stepped
   * through; a `method_definition`'s own class is found by the same walk (the class ancestor
   * is ABOVE it), and a nested `function` expression/declaration rebinds `this`, so the walk
   * stops there and answers null. A static method or static block answers the CLASS, which is
   * what a class-like owner symbol is for.
   */
  private enclosingThisClass(n: Node): string | null {
    let p: Node | null = n.parent
    while (p) {
      // ONLY a class DECLARATION: it is the shape that publishes a class-like symbol for the
      // owner channel to bind inside. A class expression's class is not a symbol this family
      // publishes (JD4), so naming it here would hand the store an owner it cannot verify.
      if (p.type === "class_declaration") return p.childForFieldName("name")?.text ?? null
      if (p.type === "function_declaration" || p.type === "function_expression" ||
          p.type === "generator_function_declaration" || p.type === "generator_function") return null
      p = p.parent
    }
    return null
  }

  private extractCallRelationships(
    node: Node,
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
    moduleName: string,
    receiverTypes: Map<string, ReceiverType>,
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
          // ⇒⇒⇒ THE NODE THE NAME CAME FROM ✓✓ — read its TYPE instead of re-deciding the word ✓✓.
          // A bare callee is its own name node; a member callee's name is its PROPERTY node ✓✓, which
          // is what carries the `#` of a private method (`this.#tick` ⇒ `private_property_identifier`)
          // ✓✓. Anything else keeps `fn` and fails the node test, which is the refusal ✓✓.
          let nameNode: any = fn
          if (fn.type === "member_expression") {
            const prop = fn.childForFieldName("property")
            if (prop) {
              targetName = prop.text
              nameNode = prop
            }
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
            hasBraceEquals(targetName) ||
            !isNameNode(nameNode)
          ) {
            // malformed call from error recovery, or a callee that is SOURCE TEXT rather than a name
            // — `(fn)`, `(0, helper.other)`, `(cond ? a : b)` (fixture
            // `javascript/non-name-callee-refused`). A `calls` TARGET is read by the graph as a
            // symbol name, and a name test is the only rule that tells "not a name" from "a
            // garbage leaf": the token-membership proxy this replaces could not see a
            // parenthesised callee, and 31 svelte `calls` rows and 550 ts-corpus rows carried
            // source text because of it.
          } else if (this.isJSBuiltinCall(targetName, fullCallee)) {
            // filtered builtins
          } else {
            // LOCAL-BINDING claim (contract: JAVASCRIPT-LOCAL-BINDING-CONTRACT.md): a BARE callee
            // that the file binds lexically is published with the family separator spelling, so the
            // arbiter verifies the spelling (`bindOK`) instead of binding the bare name to an
            // unrelated same-named declaration. A member callee (`a.b()`) is never a binding here.
            const boundCallee = fn.type === "identifier"
              ? this.localBindingTarget(fn, targetName, callSource)
              : null
            const importedCallee = boundCallee ? null : (fn.type === "identifier" ? this.importedBindingFor(fn, targetName) : null)
            /**
             * RECEIVER-POSITION evidence (contract: JAVASCRIPT-RECEIVER-POSITION-CLAIM-CONTRACT.md).
             * For a MEMBER call whose receiver chain is PURE (object-of-member all the way, no computed
             * subscript, no call in between) and whose ROOT identifier is a file import binding, the row
             * proves "this member target is accessed on import binding B from specifier S". The
             * imported-binding evidence (imports rows' metadata.importedBindings + metadata.module) is
             * what an arbiter would verify the claim against; this marker is that claim's evidence.
             *
             * REFUSED: a bare callee (that is the importedBinding class itself), a chain through a CALL
             * result (`ns.make().go()` — the receiver is the call result, not the namespace), a computed
             * subscript (`ns[key]()` — dynamic), and a root that is not an import binding (locals,
             * parameters, `this`, project symbols).
             */
            let receiverImport: { specifier: string; binding: string } | null = null
            if (!boundCallee && !importedCallee && fn.type === "member_expression") {
              let recvRoot: Node | null = fn.childForFieldName("object")
              while (recvRoot && recvRoot.type === "member_expression") recvRoot = recvRoot.childForFieldName("object")
              if (recvRoot?.type === "identifier") {
                const candidate = this.importedBindingFor(recvRoot, recvRoot.text)
                // EXTERNAL-ONLY (Lead decision): a relative/absolute/workspace receiver is a
                // PROJECT-INTERNAL import — the member is project-resolvable and claiming it would launder
                // a resolvable edge, so those rows stay declared and need index resolution (the same rule
                // the imported-binding emission already follows).
                if (candidate && isExternalSpecifier(candidate.specifier)) receiverImport = candidate
              }
              if (receiverImport && receiverImport.binding === targetName) receiverImport = null
            }
            relationships.push({
              source: callSource,
              target: boundCallee ?? targetName,
              type: ASTEngine.RelationshipType.Calls,
              confidence: 0.9,
              // The callee LEAF — for `a.b.c()` the property node, so a chain's
              // call does not take the chain's opening line.
              ...this.lineField(fn.type === "member_expression" ? (fn.childForFieldName("property") ?? fn) : fn),
              metadata: {
                calleeExpression: fullCallee,
                ...(boundCallee ? { localBinding: true } : {}),
                ...(importedCallee ? { importedBinding: importedCallee } : {}),
                ...(receiverImport ? {
                  receiverImport: receiverImport,
                  receiverImportSpecifier: receiverImport.specifier,
                  receiverImportBinding: receiverImport.binding,
                } : {}),
                // The receiver's stated type, on the store's EXISTING channel: `metadata.owner`
                // is what `member-owner-resolution.ts` (claimOwnerCarryingTargets +
                // resolveMemberTargetsByOwner) reads on BOTH production resolution paths — it
                // re-resolves the row inside that class, which is what stops `c.run()` binding
                // to another file's same-named method. `ownerEvidence` says WHICH syntactic
                // proof produced the owner ({new, assignment, this, jsdoc, class-static,
                // this-alias}) so coverage is a
                // countable number per evidence class rather than one asserted figure. NO new
                // channel is introduced: a wrong owner is worse than none, because the store
                // withdraws the name binding for an owner-carrying row and then declines.
                ...(fn.type === "member_expression" ? (() => {
                  const object = fn.childForFieldName("object")
                  if (!object) return {}
                  let recv: ReceiverType | undefined
                  if (object.type === "identifier") {
                    recv = receiverTypes.get(object.text) ??
                      this.staticClassReceiver(object, object.text) ??
                      this.thisAliasOwnerAt(object, object.text) ??
                      undefined
                  } else if (object.type === "this") {
                    // `this.m()` — `this` is the enclosing class DECLARATION's instance by
                    // POSITION. Only a class body binds it, and only a DECLARATION names a
                    // symbol the owner channel can verify; a plain function's `this` is dynamic,
                    // and a class EXPRESSION's class is not a symbol this family publishes, so
                    // both get nothing rather than a guess.
                    const cls = this.enclosingThisClass(fn)
                    if (cls) recv = { type: cls, evidence: "this" }
                  } else if (object.type === "member_expression") {
                    // `this.x.m()` — the constructor-assignment key is spelled exactly so.
                    const inner = object.childForFieldName("object")
                    const prop = object.childForFieldName("property")
                    if (inner?.type === "this" && prop) recv = receiverTypes.get(`this.${prop.text}`)
                  }
                  return recv ? { owner: recv.type, ownerEvidence: recv.evidence } : {}
                })() : {}),
              },
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
            const boundCtor = ctor.type === "identifier"
              ? this.localBindingTarget(ctor, ctorName, callSource)
              : null
            const importedCtor = boundCtor ? null : (ctor.type === "identifier" ? this.importedBindingFor(ctor, ctorName) : null)
            relationships.push({
              source: callSource,
              target: boundCtor ?? ctorName,
              type: ASTEngine.RelationshipType.Instantiates,
              confidence: 0.95,
              // The CLASS NAME node: for `new ns.Thing()` the property leaf,
              // since the target is the leaf (TSD3 leaf identity).
              ...this.lineField(ctor.type === "member_expression" ? (ctor.childForFieldName("property") ?? ctor) : ctor),
              metadata: boundCtor ? { localBinding: true } : (importedCtor ? { importedBinding: importedCtor } : {}),
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
              // 2026-10-18 (canonical vocabulary, types.ts): a JSX component usage is a
              // RENDER, not a generic read. The row used to be `uses` because no canonical
              // value existed; `RelationshipType.Renders` now does, and the relabel is 1:1 —
              // same source (the enclosing symbol), same target (the tag name), same line,
              // same jsxElement metadata. One row per ELEMENT: a paired `<Panel>…</Panel>` is
              // handled once, at the jsx_element, never once per opening/closing tag; a
              // lowercase intrinsic (`div`, `span`), a fragment (`<></>`, which has no
              // identifier child at all) and a member component (`<A.B/>`, whose name is a
              // member_expression) still emit NOTHING — the name rule is unchanged.
              const boundJsx = this.localBindingTarget(identifier, identifier.text, callSource)
              const importedJsx = boundJsx ? null : this.importedBindingFor(identifier, identifier.text)
              relationships.push({
                source: callSource,
                target: boundJsx ?? identifier.text,
                type: ASTEngine.RelationshipType.Renders,
                confidence: 0.9,
                ...this.lineField(identifier),
                metadata: {
                  jsxElement: identifier.text,
                  ...(boundJsx ? { localBinding: true } : {}),
                  ...(importedJsx ? { importedBinding: importedJsx } : {}),
                },
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
    // The MODULE-SCOPE ACTOR: an export is by definition the module's surface,
    // so this pass takes no other source (see FILE_LEVEL_SOURCE).
    moduleActor: string,
    /**
     * NAMES THIS FILE DECLARES (its emitted symbol names). The CJS export-surface claim exists only
     * where NO declaration answers the name — a project declaration refutes it in the arbiter, and the
     * FILE-local half of that test is knowable here. Measured before the guard: the arbiter smoke
     * REFUTED 7 exportSurface claims (proxicall `createWalletObligationsService`, `OPEN_*_STATUSES`)
     * because those files declare the very function/constant they also write on `module.exports`;
     * suppressing the marker lets the name model resolve the row (resolved 400 -> 407).
     */
    declaredNames: Set<string>,
  ): void {
    /**
     * THE CJS FORMS A PROPERTY CLAIM MAY USE. These are the forms that assert a PROPERTY on the module's
     * export object (object-literal members and deep writes). The value-rebind forms
     * (`exports-binding`, `exports-expression`, `module-exports-binding`, `module-exports-expression`)
     * describe the VALUE a surface is replaced with, not a property name, so they are NOT claimable.
     */
    const CJS_PROPERTY_CLAIM_FORMS = new Set<string>([
      "module-exports-object",
      "exports-object",
      "deep-member-assignment",
    ])
    for (const item of exports) {
      // ---- EXPORTS CLAIM EVIDENCE (contract: validation/m14/verification/JAVASCRIPT-EXPORTS-CLAIM-CONTRACT.md)
      // Additive markers that let an arbiter verify a claim from THIS row's own evidence. The target is
      // NEVER changed: `default` stays `default` (an ECMAScript public name) and a CJS property stays
      // the property name. The nested object is the canonical evidence; the flat mirrors exist because
      // the fixture runner pins SCALARS/ARRAYS only, so a nested object alone cannot be red-pinned.
      const isCjs = item.metadata?.viaCommonJs === true
      const localName = typeof item.metadata?.localName === "string" ? String(item.metadata.localName) : ""
      const defaultForm = isCjs
        ? ""
        : item.metadata?.viaDefaultDeclaration === true ? "named-declaration"
        : item.metadata?.viaAliasDefault === true ? "export-alias"
        : item.metadata?.viaDefaultExpression === true ? "expression"
        : item.metadata?.viaAnonymousDefaultExpression === true ? "anonymous"
        : "anonymous"
      const claimMarkers: Record<string, unknown> = {}
      if (item.isDefault && !isCjs) {
        claimMarkers.defaultExportForm = defaultForm
        if (localName) claimMarkers.defaultExportLocalName = localName
        claimMarkers.defaultExport = { form: defaultForm, ...(localName ? { localName } : {}) }
      } else if (isCjs && !item.isDefault && !declaredNames.has(item.name) && CJS_PROPERTY_CLAIM_FORMS.has(String(item.metadata?.cjsForm ?? ""))) {
        // THE FILE-LOCAL DECLARATION GUARD: no marker when THIS FILE declares the name — the row keeps
        // its bare property spelling so the name model may resolve it, and the arbiter never receives a
        // claim it would refute.
        //
        // THE FORM GUARD (added after the final arm's ONE refuted row): only GENUINE EXPORT-OBJECT
        // PROPERTY forms are claimable. `exports = <identifier>` / `exports = function(){}` are VALUE
        // REBINDS — they do not put a property named after the value on the module's export object, so a
        // moduleExports claim there asserts something false. Measured instance: require.js:908
        // (`exports = factory`) emitted moduleExports {property:"factory", form:"exports-binding"} and the
        // arbiter (whose allowed set is the five DOCUMENTED forms, not the implementation's
        // surface×kind product) REFUTED it — the one bindFAIL in the final arm. Value-rebind rows are
        // emitted as plain exports rows and are not claims.
        const cjsForm = String(item.metadata?.cjsForm ?? "module-exports-unknown")
        claimMarkers.moduleExportsProperty = item.name
        claimMarkers.moduleExportsForm = cjsForm
        claimMarkers.moduleExports = { property: item.name, form: cjsForm }
      }
      relationships.push({
          source: moduleActor,
          target: item.name,
          type: ASTEngine.RelationshipType.Exports,
          confidence: 1.0,
          // The exported NAME's own line, from the export's range when the
          // collector recorded one. Absent rather than invented when it did not.
          ...(item.range?.startLine ? { line_number: item.range.startLine } : {}),
          // THE RECORD'S OWN metadata is carried through, not replaced by
          // `{isDefault}`. JSD53's ruling: JD-J14 decided a NAMED default
          // declaration is exported under `default` (ECMAScript) and kept the
          // declaration's own name in `metadata.localName` "so nothing is lost"
          // — and this line then dropped it, so the loss was total. The row's
          // target `default` matches no symbol (it is in the symbol denylist),
          // so `import Def from "./m"` could not resolve for any module with a
          // named default export, and `script/m40/verify-import-resolution.ts`
          // JD2.4 has been red since. `loadImportInputs` reads exactly this
          // `localName` (src/ast/import-resolution.ts) to recover the
          // declaration in the row's own file. Additive: `isDefault` stays, and
          // the engine's own evidenceClass/fileLevel are added later.
          metadata: { isDefault: item.isDefault, ...(item.metadata ?? {}), ...claimMarkers },
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
        // 2026-10-18 (canonical vocabulary, types.ts): the decorator's edge is its own
        // canonical relation, `decorates` — source the DECORATED declaration, target the
        // decorator name leaf (`jsDecoratorName` spelling), line the DECORATOR's own line.
        // It replaces the `references` row this site used to emit: one row per decorator,
        // never one for a decorator's ARGUMENTS (`@inject(make())` names `inject`, not
        // `make`, and the call/read walks already refuse decorator position whole — see
        // `inDecoratorPosition`), and no second references/calls row at the same site.
        relationships.push({
          source: symbol.name,
          target: decorator,
          type: ASTEngine.RelationshipType.Decorates,
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
          // R7, runtime half, SYMBOL side. A zero-length `identifier` — which is
          // what the grammar hands back for a RESERVED WORD used as a binding,
          // since ECMAScript has no such declaration — used to be pushed as a
          // symbol named `""`. Measured: 32 symbols named `""` over 115,356 on
          // the 13,202-file corpus, every one a module-scope destructuring in a
          // TypeScript baseline that binds `while` / `return` / `this` /
          // `continue` / `if` / `debugger`. `svelte` (6,228 symbols) and `lodash`
          // (899) both measure 0, so this fires only where the input is not
          // JavaScript — but a symbol whose name is the empty string is a row
          // every consumer can match and no file contains, which is the whole of
          // R7. A binding with no writable name is not a binding.
          if (n.text) out.push({ name: n.text, node: n })
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
    /**
     * THE CJS SURFACE FORM — recorded as evidence for the exports claim, never used to change a
     * target. `module-exports` = `module.exports = …`; `exports` = the wholesale rebind
     * `exports = …`. The member/value shape is appended by this function so the evidence says both
     * which surface was written and what kind of value the row came from.
     */
    surface: "module-exports" | "exports",
  ): void {
    const form = (kind: "object" | "binding" | "expression"): string => `${surface}-${kind}`
    if (right.type === "object") {
      for (let i = 0; i < right.namedChildCount; i++) {
        const c = right.namedChild(i)
        if (!c) continue
        if (c.type === "shorthand_property_identifier" || c.type === "identifier") {
          exports.push({ name: c.text, isDefault: false, range: this.nodeToRange(c), metadata: { viaCommonJs: true, cjsForm: form("object") } })
        } else if (c.type === "pair") {
          const key = c.childForFieldName("key")
          if (key && (key.type === "property_identifier" || key.type === "identifier")) {
            exports.push({ name: key.text, isDefault: false, range: this.nodeToRange(key), metadata: { viaCommonJs: true, cjsForm: form("object") } })
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
          if (nm) exports.push({ name: nm.text, isDefault: false, range: this.nodeToRange(nm), metadata: { viaCommonJs: true, cjsForm: form("object") } })
        }
        // `spread_element` (`...rest`) and a computed key (`[key]`) name no
        // statically knowable export, so they are declined rather than guessed —
        // the object-spread case is recorded as a standing gap, not a defect.
      }
    } else if (right.type === "identifier") {
      exports.push({ name: right.text, isDefault, range: this.nodeToRange(right), metadata: { viaCommonJs: true, cjsForm: form("binding") } })
    } else if (right.type === "function_expression" || right.type === "arrow_function" || right.type === "class_declaration" || right.type === "class") {
      const nm = right.type === "class_declaration" || right.type === "class"
        ? right.childForFieldName("name")?.text
        : undefined
      exports.push({ name: nm ?? "default", isDefault, range: this.nodeToRange(right), metadata: { viaCommonJs: true, cjsForm: form("expression") } })
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
      if (child.type === "identifier" && !isDefault) {
        // `export default <identifier>` reaches the fallback below: the module exports `default`,
        // and the identifier's name is the LOCAL BINDING the default value refers to — EVIDENCE,
        // never a public name. Publishing it here fabricated an export the module does not have
        // (found while writing the exports-claim contract; the differential oracle mirrors the same
        // branch and is being corrected by the Lead, so both instruments stop sharing the premise).
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
      const valueNode = node.childForFieldName("value")
      const isIdentifierValue = valueNode?.type === "identifier"
      exports.push({
        name: "default", isDefault: true, range: this.nodeToRange(node),
        // EVIDENCE for the exports claim: the statement form, and — when the defaulted expression IS
        // a plain identifier — the local binding it names (`export default foo`). An anonymous
        // expression (literal, object, call, anonymous function) states no local name and says so
        // rather than inventing one.
        metadata: isIdentifierValue
          ? { viaDefaultExpression: true, localName: valueNode!.text }
          : { viaAnonymousDefaultExpression: true },
      })
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

  /**
   * M14 / R3 — THE CALL-SHAPED CLASS HERITAGE. A class's supertype may be a CALL, and there are
   * TWO shapes of it, and they put the base and the mixin in OPPOSITE positions:
   *
   *   (A) `class X extends Base.extend(M1, M2)` — a MEMBER call. The RECEIVER names the BASE and
   *       the ARGUMENTS name the MIXINS composed into X's supertype chain. This is the Ember /
   *       Backbone class-extension idiom, and it is the shape the corpus overwhelmingly has.
   *   (B) `class X extends MixinFn(Base)` — a plain FUNCTION call. The CALLEE names the MIXIN and
   *       the ARGUMENT names the BASE. This is the TypeScript/Redwood mixin-factory idiom, where
   *       `MixinFn(Base)` evaluates to a class that extends Base.
   *
   * WHY THE SHAPE, NOT A NAME, DECIDES: C2 forbids a naming convention as the discriminator.
   * `Route.extend(M)` and `_.extend(obj, props)` are the same member-call shape, and only the
   * callee's SHAPE (member vs plain) tells the two apart structurally. The discriminator here is
   * the node shape of the heritage's own expression — `member_expression` versus `identifier` —
   * and the role of each operand follows from that shape. It is not "the method is called extend".
   *
   * WHY IT MATTERS: `findChildByType` scans the DIRECT named children of the node it is given, and
   * a call-shaped heritage's single direct named child is the `call_expression` — so the base's
   * `identifier` and `member_expression` are GRANDCHILDREN of it. Before this, every call-shaped
   * heritage published NO edge at all: neither the base nor the mixin. Measured over the admitted
   * population by `script/m14/javascript-heritage-census.ts`: 76 call-shaped clauses, of which the
   * analyzer's own lookup pair found 0.
   *
   * WHAT IT DELIBERATELY DOES NOT DO: it does not look inside the call for a base, so it never
   * claims a base that the call computes rather than names — the 11 arguments that are themselves
   * calls (`SortableFactory([...])`) contribute a mixin FACTORY, and this publishes the factory's
   * own name only when the argument names something.
   */
  private callShapedHeritage(heritage: Node): { base: Node | null; mixins: Node[]; shape: "member" | "function" } | null {
    const call = this.findChildByType(heritage, "call_expression")
    if (!call) return null
    const callee = call.childForFieldName("function")
    if (!callee) return null
    const args = this.findChildByType(call, "arguments")
    const argNodes: Node[] = []
    if (args) {
      for (let i = 0; i < args.namedChildCount; i++) {
        const a = args.namedChild(i)
        if (a) argNodes.push(a)
      }
    }
    if (callee.type === "member_expression") {
      // (A) `Base.extend(M...)` — the RECEIVER is the base, the arguments are the mixins.
      const receiver = callee.childForFieldName("object")
      return { base: receiver ?? null, mixins: argNodes, shape: "member" }
    }
    if (callee.type === "identifier") {
      // (B) `MixinFn(Base)` — the CALLEE is the mixin, and the argument names the base.
      return { base: argNodes[0] ?? null, mixins: [callee], shape: "function" }
    }
    return null
  }

  /**
   * M14 / R3 — the relationship rows a call-shaped heritage publishes. The base becomes an
   * `extends` edge and each mixin becomes a `mixes_in` edge, with the same binding resolution the
   * identifier form already uses, so the rows are resolvable on exactly the same terms.
   */
  private callShapedHeritageRows(
    heritage: Node,
    source: string,
  ): { base: { target: string; node: Node; metadata: Record<string, unknown> } | null; mixins: { target: string; node: Node; metadata: Record<string, unknown> }[] } {
    const shape = this.callShapedHeritage(heritage)
    const out = { base: null as { target: string; node: Node; metadata: Record<string, unknown> } | null, mixins: [] as { target: string; node: Node; metadata: Record<string, unknown> }[] }
    if (!shape) return out

    const resolve = (node: Node | null): { target: string; node: Node; metadata: Record<string, unknown> } | null => {
      if (!node) return null
      if (node.type === "identifier") {
        const bound = this.localBindingTarget(node, node.text, source)
        const imported = bound ? null : this.importedBindingFor(node, node.text)
        return {
          target: bound ?? node.text,
          node,
          metadata: bound ? { localBinding: true } : imported ? { importedBinding: imported } : {},
        }
      }
      if (node.type === "member_expression") {
        // A QUALIFIED base keeps its DOTTED spelling (the JSD19 contract the plain
        // `extends Lib.Base` form already honours), so the whole member expression's text
        // is the target — never just its property segment.
        return { target: node.text, node, metadata: {} }
      }
      return null
    }

    const base = resolve(shape.base)
    if (base) out.base = base
    for (const m of shape.mixins) {
      const r = resolve(m)
      if (r) out.mixins.push(r)
    }
    return out
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
  private extractInstanceofRefs(rootNode: Node, relationships: ASTEngine.UniversalRelationship[], moduleName: string): void {
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
            // `||` and not `??`: an error-recovered declaration can carry a
            // zero-length identifier as its name, and `??` would treat that
            // empty string as a found source and publish an edge FROM it.
            if ((c.type === "identifier" || c.type === "property_identifier") && c.text) return c.text
          }
        }
        p = p.parent
      }
      // R7: this used to `return "global"`, and the literal named a symbol no
      // file in the corpus contains — measured firing on REAL JavaScript, not
      // only on recovery residue: 14 rows across lodash's 51 ES5 files and 1 on
      // svelte. The lane's own convention for "this read belongs to the module"
      // The lane's own convention for "this read belongs to the module" is
      // `method || owner || moduleName`, and every other emitter here already
      // uses it (`extractExportRelationships` sources `exports` at
      // `moduleName`; the `uses` walk falls back to `moduleName` last). `||`
      // rather than `??` so a zero-length recovered name cannot win. The
      // differential matches label+target only, so this changes no compared
      // number — and the ORACLE carries the identical `let source = "global"`
      // (`script/m14/differential.ts`, deriveJavaScriptEdges), which is why the
      // shared source never showed up as a disagreement. Reported, not fixed:
      // that file is the master's.
      return moduleName
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
              const boundRef = right.type === "identifier" ? this.localBindingTarget(right, right.text, source) : null
              const importedRef = boundRef ? null : (right.type === "identifier" ? this.importedBindingFor(right, right.text) : null)
              relationships.push({
                source,
                target: boundRef ?? right.text,
                type: ASTEngine.RelationshipType.References,
                confidence: 0.95,
                ...this.lineField(right),
                metadata: {
                  relationshipType: "instanceof_check",
                  ...(boundRef ? { localBinding: true } : {}),
                  ...(importedRef ? { importedBinding: importedRef } : {}),
                },
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
    // The file's stated receiver types (one collection per file, shared with the calls walk):
    // a member READ can carry the same `metadata.owner` a member CALL does.
    receiverTypes: Map<string, ReceiverType>,
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
            const recvSource = method || owner || moduleName
            // R2 (charter §21.41) — the DECLARATION's scope identity joins the dedup key ONLY for
            // a local-binding row, so two reads of two different declarations that share a name are
            // two rows, while every other row keeps the payload-pollution key byte for byte.
            const recvScopeId = this.localBindingScopeId(root, head)
            const recvBaseKey = `${recvSource}.#${head}`
            const recvKey = recvScopeId ? `${recvBaseKey}|${recvScopeId}` : recvBaseKey
            if (!seen.has(recvKey)) {
              seen.add(recvKey)
              // THE BASE KEY IS CLAIMED AS WELL — AND THIS IS THE SECOND HALF OF THE CONFINEMENT.
              // `seen` is ONE set for the whole file, shared by every emission site, and the
              // payload-pollution key is `${source}.#${name}` — so a site that stops claiming the
              // BASE key RELEASES every other site's row for that (callable, name) pair. The scoped
              // key is a DIFFERENT string, so the other site's row is no longer suppressed by this
              // one, and the fix would silently publish rows it never promised to touch: a member
              // segment or a plain read whose name collides with a local binding in the same
              // callable. The whole-population arm measured the leak: 346 such rows, of which 119
              // RESOLVED and 224 became ARBITRARY TWINS — new rows that carry no claim, which is
              // the opposite of what the fix is for. Claiming the base key as well leaves every
              // other site's occupancy EXACTLY as it was, so the fix's footprint is the recovered
              // local-binding reads and nothing else.
              seen.add(recvBaseKey)
              const boundRecv = this.localBindingTarget(root, head, recvSource)
              const importedRecv = boundRecv ? null : this.importedBindingFor(root, head)
              relationships.push({
                source: recvSource,
                target: boundRecv ?? head,
                type: ASTEngine.RelationshipType.Uses,
                confidence: 0.6,
                ...this.lineField(root!),
                metadata: {
                  isFieldAccess: true, bareRead: true, callReceiver: true,
                  ...(boundRecv ? { localBinding: true } : {}),
                  ...(recvScopeId ? { localBindingScope: recvScopeId } : {}),
                  ...(importedRecv ? { importedBinding: importedRecv } : {}),
                },
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
                  const rootSource = method || owner || moduleName
                // R2 (charter §21.41) — the DECLARATION's scope identity joins the dedup key ONLY
                // for a local-binding row (see the call-receiver site for the full statement).
                const rootScopeId = this.localBindingScopeId(cur, head)
                const rootBaseKey = `${rootSource}.#${head}`
                const rootKey = rootScopeId ? `${rootBaseKey}|${rootScopeId}` : rootBaseKey
                if (!seen.has(rootKey)) {
                  seen.add(rootKey)
                  // THE BASE KEY IS CLAIMED AS WELL — see the call-receiver site for the whole
                  // statement: `seen` is shared by every site, so a site that stops claiming the
                  // base key releases every other site's row for that (callable, name) pair.
                  seen.add(rootBaseKey)
                  // The chain ROOT is a read of the identifier — a local binding when the file
                  // binds it lexically (same claim contract as the bare-read site below).
                  const boundRoot = cur?.type === "identifier" ? this.localBindingTarget(cur, head, rootSource) : null
                  const importedRoot = boundRoot ? null : (cur?.type === "identifier" ? this.importedBindingFor(cur, head) : null)
                  relationships.push({
                    source: rootSource,
                    target: boundRoot ?? head,
                    type: ASTEngine.RelationshipType.Uses,
                    confidence: 0.6,
                    // The root identifier's own line (the chain may open on a
                    // line the segments do not share).
                    ...this.lineField(cur),
                    metadata: {
                      isFieldAccess: true, chainRoot: true,
                      ...(boundRoot ? { localBinding: true } : {}),
                      ...(rootScopeId ? { localBindingScope: rootScopeId } : {}),
                      ...(importedRoot ? { importedBinding: importedRoot } : {}),
                    },
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
                const source = method || owner || moduleName
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
                  // THE RECEIVER TYPE OF A MEMBER READ, when the file STATES it. The same
                  // `metadata.owner` channel the store reads for member calls
                  // (member-owner-resolution.ts) applies to uses rows, so a segment whose
                  // receiver is a typed local (`const c = new Widget(); c.name` -> owner Widget)
                  // or `this` inside a class declaration (`this.Path` -> owner <class>) carries
                  // the owner and the evidence that produced it. NOTHING is attached otherwise:
                  // a wrong owner is worse than none, because the store withdraws the name
                  // binding for an owner-carrying row and then declines.
                  const recvOwner = (() => {
                    if (cur?.type === "identifier" && head) {
                      return receiverTypes.get(head) ??
                        this.staticClassReceiver(cur, head) ??
                        this.thisAliasOwnerAt(cur, head) ??
                        undefined
                    }
                    if (cur?.type === "this") {
                      const cls = this.enclosingThisClass(node)
                      return cls ? { type: cls, evidence: "this" as ReceiverEvidence } : undefined
                    }
                    return undefined
                  })()
                  relationships.push({
                    source,
                    target: seg,
                    type: ASTEngine.RelationshipType.Uses,
                    confidence: 0.6,
                    ...this.lineField(segNode),
                    // `receiverRoot` is the chain's FIRST identifier when it IS an identifier
                    // (`location.hash.substring` -> `location`), and empty for a call-rooted chain
                    // (`$(el).removeClass` -> ""). It is published so the terminal claim pass can ask
                    // memberChainClaim the question the rule is defined on — the RECEIVER ROOT — without
                    // re-deriving the chain from text. Additive; consumers that do not read it are unaffected.
                    metadata: {
                      isFieldAccess: true,
                      ...(cur?.type === "identifier" && head ? { receiverRoot: head } : {}),
                      ...(recvOwner ? { owner: recvOwner.type, ownerEvidence: recvOwner.evidence } : {}),
                    },
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
            const bSource = method || owner || moduleName
            // R2 (charter §21.41) — THE DECLARATION'S SCOPE IDENTITY JOINS THE DEDUP KEY, AND ONLY
            // FOR A LOCAL-BINDING ROW.
            //
            // The payload-pollution dedup key is `${source}.#${name}`: the SOURCE and the NAME, never
            // the DECLARATION. So two reads of TWO DIFFERENT declarations that share a name in one
            // callable spell IDENTICALLY, and the second read was DROPPED — a lost fact, not a wrong
            // one (the dart lane measured the same loss on its own population, 1,246 rows on
            // dart-http). The scope identity is the innermost scope that DECLARES the name at the
            // read's position, plus that declaration's own offset: two reads of ONE declaration
            // share it, two reads of TWO declarations do not.
            //
            // The join is confined on purpose:
            //   · `localBindingScopeId` answers null for a name the file declares in only ONE scope
            //     (the base key already separates it), for a read that resolves to the PROGRAM scope
            //     (a published symbol — not a local-binding row), and for a name that is not bound at
            //     the site at all. Every one of those keeps the payload-pollution key byte for byte;
            //   · the `calls` sites do not use this dedup at all and already publish one row per
            //     read site, so nothing there changes.
            const bScopeId = this.localBindingScopeId(node, txt)
            const bBaseKey = `${bSource}.#${txt}`
            const bKey = bScopeId ? `${bBaseKey}|${bScopeId}` : bBaseKey
            if (!seen.has(bKey)) {
              seen.add(bKey)
              // THE BASE KEY IS CLAIMED AS WELL — see the call-receiver site for the whole
              // statement: `seen` is shared by every site, so a site that stops claiming the
              // base key releases every other site's row for that (callable, name) pair.
              seen.add(bBaseKey)
              const boundRead = this.localBindingTarget(node, txt, bSource)
              const importedRead = boundRead ? null : this.importedBindingFor(node, txt)
              relationships.push({
                source: bSource,
                target: boundRead ?? txt,
                type: ASTEngine.RelationshipType.Uses,
                confidence: 0.6,
                ...this.lineField(node),
                metadata: {
                  isFieldAccess: true, bareRead: true,
                  ...(boundRead ? { localBinding: true } : {}),
                  ...(bScopeId ? { localBindingScope: bScopeId } : {}),
                  ...(importedRead ? { importedBinding: importedRead } : {}),
                },
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
              const src2 = method || owner || moduleName
              const key = `${src2}.${c.text}`
              if (!seen.has(key)) {
                seen.add(key)
                // M49 W4 (J6): mark the BARE-READ key too — the generic rule
                // (added by #744) re-emitted the same read at 0.6 with
                // isFieldAccess metadata, so one interpolated read produced
                // two Uses edges. First emitter wins: this rule carries the
                // documented isTemplateInterpolation contract.
                seen.add(`${src2}.#${c.text}`)
                const boundTmpl = this.localBindingTarget(c, c.text, src2)
                const importedTmpl = boundTmpl ? null : this.importedBindingFor(c, c.text)
                relationships.push({
                  source: src2,
                  target: boundTmpl ?? c.text,
                  type: ASTEngine.RelationshipType.Uses,
                  confidence: 0.85,
                  ...this.lineField(c),
                  metadata: {
                    isTemplateInterpolation: true,
                    ...(boundTmpl ? { localBinding: true } : {}),
                    ...(importedTmpl ? { importedBinding: importedTmpl } : {}),
                  },
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
   * BUILD THE POSITIONAL LEXICAL SCOPE MODEL — one walk of the tree, ranges in node offsets.
   *
   * THE RULES ARE THE LANGUAGE'S, not an approximation:
   *   · scopes: program, every function form (declaration / expression / generator / arrow /
   *     method / constructor / static block), blocks (`statement_block`, `switch_body`), loop
   *     headers (`for`/`for_in`/`for_of`), catch clauses;
   *   · `var` HOISTS to the nearest function-or-program scope; `let`/`const` bind in the current
   *     block; parameters bind in the function scope; a catch parameter binds in its catch scope;
   *     a function or class DECLARATION binds in its enclosing scope;
   *   · a later same-scope redeclaration keeps one name (a Set), and an inner binding shadows an
   *     outer one because resolution walks the scope chain from the innermost containing scope;
   *   · import bindings and `require(...)` / `import(...)` declarators are recorded in
   *     `moduleBindings` and are NEVER local-binding claims — they are the imported-binding seam;
   *   · destructured/rest/default parameter and declarator patterns bind their VALUE sides
   *     (`collectPatternPairs`, the same reader the symbol walk uses).
   */
  private collectBindingModel(rootNode: Node): BindingModel {
    const scopes: BindingScope[] = []
    const allNames = new Set<string>()
    const moduleBindings = new Set<string>()
    const moduleBindingSpecs = new Map<string, string>()
    const publishedClasses = new Set<string>()
    const program: BindingScope = {
      kind: "program", startIndex: rootNode.startIndex, endIndex: rootNode.endIndex,
      published: true, parent: null, names: new Set(), decls: new Map(),
    }
    scopes.push(program)
    const addName = (scope: BindingScope, name: string, declNode?: Node | null): void => {
      if (!name) return
      scope.names.add(name)
      // R2 — the DECLARATION's own offset, so two reads of two different declarations that share
      // a name can be told apart. `declNode` is the declaration's own identifier node when the
      // call site has it; the scope's own start is the fallback (a scope holds a name once).
      if (!scope.decls.has(name)) scope.decls.set(name, declNode?.startIndex ?? scope.startIndex)
      allNames.add(name)
    }
    const newScope = (node: Node, kind: BindingScope["kind"], parent: BindingScope, published: boolean): BindingScope => {
      const scope: BindingScope = { kind, startIndex: node.startIndex, endIndex: node.endIndex, published, parent, names: new Set(), decls: new Map() }
      scopes.push(scope)
      return scope
    }
    /** nearest function/program scope — the target of `var` hoisting */
    const hoistTarget = (scope: BindingScope): BindingScope => {
      let cur: BindingScope = scope
      while (cur.kind !== "function" && cur.kind !== "program" && cur.parent) cur = cur.parent
      return cur
    }
    const addParams = (fnNode: Node, fnScope: BindingScope): void => {
      const paramsNode = fnNode.childForFieldName("parameters")
      if (paramsNode) {
        for (let i = 0; i < paramsNode.namedChildCount; i++) {
          const param = paramsNode.namedChild(i)
          if (!param) continue
          for (const pair of this.collectPatternPairs(param)) addName(fnScope, pair.name, pair.node)
        }
      }
      // Arrow single-parameter form: `x => ...` has a `parameter` field, not `parameters`.
      const single = fnNode.childForFieldName("parameter")
      if (single) for (const pair of this.collectPatternPairs(single)) addName(fnScope, pair.name, pair.node)
    }
    /** import bindings: default / named (alias = local binding) / namespace, all module-scope. */
    const addImportBindings = (importNode: Node): void => {
      const clause = this.findChildByType(importNode, "import_clause")
      if (!clause) return
      const sourceNode = importNode.childForFieldName("source")
      const specifier = sourceNode ? stringContent(sourceNode) : ""
      const add = (name: string, declNode?: Node | null): void => {
        if (!name) return
        addName(program, name, declNode)
        moduleBindings.add(name)
        // THE CLAIM'S EVIDENCE: only a LITERAL specifier can be verified by the run's import rows.
        if (specifier) moduleBindingSpecs.set(name, specifier)
      }
      for (let i = 0; i < clause.namedChildCount; i++) {
        const c = clause.namedChild(i)
        if (!c) continue
        if (c.type === "identifier") add(c.text, c)
        else if (c.type === "namespace_import") {
          const nm = c.childForFieldName("name") ?? c.namedChild(0)
          if (nm) add(nm.text, nm)
        } else if (c.type === "named_imports") {
          for (let j = 0; j < c.namedChildCount; j++) {
            const spec = c.namedChild(j)
            if (!spec || spec.type !== "import_specifier") continue
            const alias = spec.childForFieldName("alias")
            const nm = spec.childForFieldName("name") ?? spec.namedChild(0)
            const local = alias ?? nm
            if (local) add(local.text, local)
          }
        }
      }
    }
    /** is this declarator's value a module load (`require(...)` / `import(...)`)? */
    const isModuleLoad = (value: Node | null): boolean => {
      if (!value || value.type !== "call_expression") return false
      const fn = value.childForFieldName("function")
      if (!fn) return false
      return fn.type === "import" || (fn.type === "identifier" && (fn.text === "require" || fn.text === "import"))
    }
    /** the LITERAL module specifier a module-load call writes, or "" for a dynamic one. */
    const moduleLoadSpecifier = (value: Node | null): string => {
      if (!value || value.type !== "call_expression") return ""
      const args = value.childForFieldName("arguments")
      const arg = args?.namedChild(0)
      if (!arg) return ""
      if (arg.type !== "string" && arg.type !== "template_string") return ""
      return stringContent(arg)
    }
    const walk = (n: Node, scope: BindingScope): void => {
      const t = n.type
      if (t === "function_declaration" || t === "generator_function_declaration") {
        const nm = n.childForFieldName("name")
        if (nm) addName(scope, nm.text, nm)
        const fnScope = newScope(n, "function", scope, false)
        addParams(n, fnScope)
        for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) walk(c, fnScope) }
        return
      }
      if (t === "function_expression" || t === "generator_function") {
        const fnScope = newScope(n, "function", scope, false)
        const nm = n.childForFieldName("name")
        if (nm) addName(fnScope, nm.text, nm)  // a NAMED function expression binds inside itself
        addParams(n, fnScope)
        for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) walk(c, fnScope) }
        return
      }
      if (t === "arrow_function" || t === "method_definition" || t === "class_static_block") {
        const fnScope = newScope(n, "function", scope, false)
        if (t !== "class_static_block") addParams(n, fnScope)
        for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) walk(c, fnScope) }
        return
      }
      if (t === "import_statement") {
        addImportBindings(n)
        // an import statement can wrap an export_statement? no; still descend for safety
        for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) walk(c, scope) }
        return
      }
      if (t === "variable_declarator") {
        const nameNode = n.childForFieldName("name")
        const value = n.childForFieldName("value")
        const parent = n.parent
        const kindNode = parent?.childForFieldName?.("kind")
        const isVar = parent?.type === "variable_declaration" || (kindNode !== undefined && kindNode !== null && kindNode.text === "var")
        const target = isVar ? hoistTarget(scope) : scope
        const moduleBound = isModuleLoad(value)
        const moduleSpec = moduleBound ? moduleLoadSpecifier(value) : ""
        if (nameNode) {
          for (const pair of this.collectPatternPairs(nameNode)) {
            addName(target, pair.name, pair.node)
            if (moduleBound) {
              moduleBindings.add(pair.name)
              if (moduleSpec) moduleBindingSpecs.set(pair.name, moduleSpec)
            }
          }
        }
        for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) walk(c, scope) }
        return
      }
      if (t === "catch_clause") {
        const catchScope = newScope(n, "catch", scope, false)
        const param = n.childForFieldName("parameter")
        if (param) for (const pair of this.collectPatternPairs(param)) addName(catchScope, pair.name, pair.node)
        for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) walk(c, catchScope) }
        return
      }
      if (t === "class_declaration") {
        const nm = n.childForFieldName("name")
        if (nm) {
          addName(scope, nm.text, nm)
          if (scope.published) publishedClasses.add(nm.text)
        }
        for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) walk(c, scope) }
        return
      }
      if (t === "statement_block" || t === "switch_body") {
        const blockScope = newScope(n, "block", scope, false)
        for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) walk(c, blockScope) }
        return
      }
      if (t === "for_statement" || t === "for_in_statement") {
        const loopScope = newScope(n, "block", scope, false)
        for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) walk(c, loopScope) }
        return
      }
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) walk(c, scope) }
    }
    walk(rootNode, program)
    // R2 — THE NAMES DECLARED IN MORE THAN ONE SCOPE. Only these names can be the two reads of
    // TWO DIFFERENT declarations that a name-only dedup key would collapse, so only these names
    // pay for the scope-identity lookup; every other name keeps the payload-pollution dedup key
    // byte for byte. One pass over the scopes, counting the scopes that declare each name.
    const declScopeCounts = new Map<string, number>()
    for (const s of scopes) {
      for (const n of s.names) declScopeCounts.set(n, (declScopeCounts.get(n) ?? 0) + 1)
    }
    const multiScopeNames = new Set<string>()
    for (const [n, count] of declScopeCounts) if (count > 1) multiScopeNames.add(n)
    return { scopes, allNames, moduleBindings, moduleBindingSpecs, publishedClasses, multiScopeNames }
  }

  /**
   * THE LOCAL-BINDING SPELLING for the site, or `null` when the name at this node is not a
   * claimable local binding. Returns `${source}${BINDING_SEP}${name}` exactly as the family
   * contract specifies (php/dart/java/fsharp/haskell): the arbiter verifies the SPELLING (a
   * declaration name can never contain the separator), the row lands in the gate's `bindOK`
   * column, and it is never merged into `resolved`.
   *
   * REFUSALS, each one a false statement the claim must not make:
   *   · the file loads the name from a module (`import` / `require` / dynamic `import()`) — that is
   *     the imported-binding seam class, not a local binding;
   *   · the name resolves to the PROGRAM scope — module-scope declarations are PUBLISHED SYMBOLS,
   *     so the edge can resolve normally and a binding claim would deny a real declaration;
   *   · no lexical binding answers the name at this node's position (the read is of something the
   *     file does not bind — host global, import through another route, or a genuine gap);
   *   · the name would be the empty string or is one of the keywords the language never binds.
   */
  private localBindingTarget(node: Node | null | undefined, name: string, source: string | null | undefined): string | null {
    const model = this.bindingModel
    if (!model || !node || !name || !source) return null
    // THE ONE SHARED TEST (see `isLocalBindingName`): a name the file binds FROM A MODULE is the
    // imported-binding class, never a local binding (its claim is evidence-verified and its target
    // stays bare — `import`, `require()` and a DYNAMIC `require(expr)`, which has no evidence entry
    // and therefore can never be claimed); `this` / `super` / `arguments` / `undefined` are not
    // names a declaration can bind; and ONLY a lexical (unpublishable) binding is a LOCAL-binding
    // claim, because program-scope names are published symbols whose edges may resolve normally.
    if (!this.isLocalBindingName(node, name)) return null
    return `${source}${BINDING_SEP}${name}`
  }

  /**
   * STATIC CLASS RECEIVER — `Service.create()` where the receiver identifier is a PROGRAM-scope
   * class DECLARATION in this file. That class's members ARE published symbols, so the owner channel
   * can resolve the member inside it; the proof is positional (the identifier must still resolve to
   * the program scope at THIS site — a parameter or local shadowing the class name is not the class,
   * and gets nothing). Evidence class `class-static`.
   */
  private staticClassReceiver(node: Node | null | undefined, name: string): ReceiverType | null {
    const model = this.bindingModel
    if (!model || !node || !name) return null
    if (!model.publishedClasses.has(name)) return null
    return this.resolveBindingKind(model, node.startIndex, name) === "published"
      ? { type: name, evidence: "class-static" }
      : null
  }

  /**
   * THIS-ALIAS RECEIVER — `const self = this` in the SAME function body as the site, with `this`
   * provably the enclosing class DECLARATION's instance. Resolved POSITIONALLY, never through the
   * file map: a file map leaked an alias across sibling functions in the fixture (a plain
   * function's `const self = this` is dynamic `this`, yet it inherited the class recorded by
   * another function's alias of the same name) — the leak produced a wrong owner, which is worse
   * than none. Refusals: a plain function/generator is dynamic `this` (nothing); an arrow is
   * lexical `this` but the alias would have to be declared in an enclosing body, so this helper
   * under-claims rather than reach across (nothing); a class expression is not a published symbol.
   */
  private thisAliasOwnerAt(node: Node | null | undefined, name: string): ReceiverType | null {
    if (!node || !name) return null
    const isFunctionForm = (t: string): boolean =>
      t === "function_declaration" || t === "function_expression" ||
      t === "generator_function_declaration" || t === "generator_function" ||
      t === "arrow_function" || t === "method_definition" || t === "class_static_block"
    // nearest enclosing function form; a class boundary above it means there is no `this` proof
    let fn: Node | null = null
    for (let p: Node | null = node; p; p = p.parent) {
      if (isFunctionForm(p.type)) { fn = p; break }
      if (p.type === "class_declaration" || p.type === "class") return null
    }
    if (!fn) return null
    // dynamic-this forms and lexical arrows are refused (see the doc above)
    if (fn.type !== "method_definition" && fn.type !== "class_static_block") return null
    // the class that owns this method/static block — only a class DECLARATION publishes members
    let cls: string | null = null
    for (let p: Node | null = fn.parent; p; p = p.parent) {
      if (p.type === "class_declaration") { cls = p.childForFieldName("name")?.text ?? null; break }
      if (p.type === "class") return null
      if (p.type === "function_declaration" || p.type === "function_expression" ||
          p.type === "generator_function_declaration" || p.type === "generator_function") return null
    }
    if (!cls) return null
    // the alias must be declared in THIS function body (nested function bodies are not ours)
    const stack: Node[] = [fn]
    while (stack.length > 0) {
      const n = stack.pop()!
      if (n !== fn && isFunctionForm(n.type)) continue
      if (n.type === "variable_declarator") {
        const id = n.childForFieldName("name")
        const value = n.childForFieldName("value")
        if (id && id.type === "identifier" && id.text === name && value && value.type === "this") {
          return { type: cls, evidence: "this-alias" }
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) stack.push(c) }
    }
    return null
  }

  /** innermost scope containing `index`, then the scope chain — "published" | "lexical" | null. */
  private resolveBindingKind(model: BindingModel, index: number, name: string): "published" | "lexical" | null {
    const scope = this.resolveBindingScope(model, index, name)
    if (!scope) return null
    return scope.published ? "published" : "lexical"
  }

  /**
   * R2 (charter §21.41) — THE SCOPE THAT DECLARES `name` AT `index`: the innermost scope that
   * contains the position, then the scope chain, exactly the resolution `resolveBindingKind` uses
   * — but it returns the SCOPE, not the kind, because the scope is what carries the declaration's
   * identity.
   */
  private resolveBindingScope(model: BindingModel, index: number, name: string): BindingScope | null {
    let best: BindingScope | null = null
    for (const scope of model.scopes) {
      if (index < scope.startIndex || index > scope.endIndex) continue
      if (best === null || (scope.endIndex - scope.startIndex) < (best.endIndex - best.startIndex)) best = scope
    }
    let cur: BindingScope | null = best
    while (cur) {
      if (cur.names.has(name)) return cur
      cur = cur.parent
    }
    return null
  }

  /**
   * R2 (charter §21.41) — THE DECLARATION'S SCOPE IDENTITY for a read of `name` at `node`, or null.
   *
   * The identity is the innermost scope that DECLARES the name at this position, plus that
   * declaration's own offset — the dart lane's shape. Two reads of ONE declaration share it; two
   * reads of TWO declarations do not. It joins the DEDUP KEY only, and only for a row whose
   * identity is the occurrence (a local-binding row), so the payload-pollution dedup stays byte for
   * byte for every other row.
   *
   * `null` in three cases, and every one of them keeps the old key:
   *   · the name is declared in only ONE scope in the file — the base key already separates it;
   *   · the read resolves to the PROGRAM scope — a published symbol, not a local-binding row, and
   *     a claim there would deny a real declaration;
   *   · the name is not bound at this site at all.
   */
  private localBindingScopeId(node: Node | null | undefined, name: string): string | null {
    const model = this.bindingModel
    if (!model || !node || !name) return null
    if (!model.multiScopeNames.has(name)) return null
    // THE SCOPE IDENTITY JOINS THE DEDUP KEY ONLY FOR A ROW THAT IS A LOCAL-BINDING ROW, AND THAT IS
    // THE SAME TEST THAT DECIDES THE TARGET'S SPELLING — `isLocalBindingName`, shared with
    // `localBindingTarget`. WITHOUT THIS THE FIX OVER-REACHES, AND THE WHOLE-POPULATION ARM
    // MEASURED IT: a read whose name is ALSO A MODULE BINDING in this file (and shadowed by a local
    // in an inner scope) resolves to the local's scope, so it got a scope id, so the dedup key
    // changed, so the row was published — with a BARE target and NO claim at all (the analyzer
    // declines to spell a module-binding name as a local binding, and the imported-binding claim
    // declines it too, because a local shadows the import at this site). The arbiter then bound
    // that bare name to whatever same-named declaration the project has: the DECOY class. The arm
    // measured 1,463 such rows, of which 958 RESOLVED and 543 became arbitrary twins — new rows
    // that no claim covers, which is the opposite of what the fix is for.
    if (!this.isLocalBindingName(node, name)) return null
    const scope = this.resolveBindingScope(model, node.startIndex, name)
    if (!scope || scope.published) return null
    return `${scope.startIndex}:${scope.decls.get(name) ?? scope.startIndex}`
  }

  /**
   * IS THIS READ A LOCAL-BINDING ROW? — the ONE test both the TARGET's spelling and the DEDUP KEY's
   * scope identity must agree on.
   *
   * The refusals, each a false statement the row must not make:
   *   · `this` / `super` / `arguments` / `undefined` are not names a declaration can bind;
   *   · a name the file binds FROM A MODULE is the imported-binding class, never a local binding
   *     (its claim is evidence-verified and its target stays bare);
   *   · a name that resolves to the PROGRAM scope is a published symbol, not a local binding — a
   *     claim there would deny a real declaration.
   */
  private isLocalBindingName(node: Node | null | undefined, name: string): boolean {
    const model = this.bindingModel
    if (!model || !node || !name) return false
    if (name === "this" || name === "super" || name === "arguments" || name === "undefined") return false
    if (model.moduleBindings.has(name)) return false
    return this.resolveBindingKind(model, node.startIndex, name) === "lexical"
  }

  /**
   * IMPORTED-BINDING CLAIM — the EVIDENCE-VERIFIED claim kind (Lead contract, 2026-10-18). Returns
   * `{ specifier, binding }` when the name IS the imported binding at THIS site, so the caller can
   * publish `metadata.importedBinding` and keep the target spelling BARE (no BINDING_SEP — the
   * arbiter verifies this claim against the run's own import rows, not a spelling).
   *
   * REFUSALS, each a false statement the claim must not make:
   *   · the name has no import evidence in this file (no literal specifier: a name the PROJECT
   *     declares, a name with no import at all, or a DYNAMIC `require(expr)` — never-claim (a)/(c));
   *   · a LOCAL binding shadows the import at this site (the positional scope check): the target is
   *     the shadow, not the import;
   *   · the site is a namespace MEMBER access — the caller only asks this for a target that IS the
   *     binding (bare callee / bare read / chain root), never a member segment (never-claim (b));
   *   · re-export rows never reach here (never-claim (d): different surface).
   */
  private importedBindingFor(node: Node | null | undefined, name: string): { specifier: string; binding: string } | null {
    const model = this.bindingModel
    if (!model || !node || !name) return null
    const specifier = model.moduleBindingSpecs.get(name)
    if (specifier === undefined) return null
    if (this.resolveBindingKind(model, node.startIndex, name) !== "published") return null
    return { specifier, binding: name }
  }

  /**
   * JS EXTERNAL CLAIMS — mark the edges whose target is a platform name the FILE cannot declare,
   * using the CLOSED CITED vocabulary in `js-builtin-prototypes.ts` and nothing else.
   *
   * WHY THIS PASS EXISTS. The lane's unresolved `calls`/`uses` mass is dominated by names no
   * repository can declare: `document.getElementById`, `window.addEventListener`,
   * `location.hash.substring`, `JSON.stringify`, `setTimeout`. Before this pass the analyzer
   * published those rows with NO claim at all, so they read exactly like a name the project
   * failed to bind. The claim fixes the READ, not the binding — it never picks a declaration,
   * so it cannot raise `arbitraryTwin`, `bindFAIL` or `extFAIL` for a DOTLESS target (the
   * arbiter looks a dotless target up by its own spelling and can only reach a refutation on a
   * target that names a declaration — which is why this pass NEVER rewrites a target, and why
   * it refuses every non-identifier target; a dotted target is looked up by its OWNER, which a
   * project may well publish).
   *
   * THE TWO PROOFS, both readable from the syntax with NO type inference:
   *
   *   bare name is a cited host global           `setTimeout(...)`      -> claim, cites ECMA-262 §19.2
   *   receiver ROOT is a cited host global       `document.getElementById` -> claim, cites WHATWG HTML §7.3
   *   receiver root is a LOCAL                    `x.substring(...)`    -> NO CLAIM (x may be a project object)
   *   name/receiver root the FILE DECLARES        `class Map {}; Map.x()` -> NO CLAIM (the declaration outranks the table)
   *
   * The vocabulary is `HOST_GLOBALS` (57 cited entries) + `memberChainClaim` in
   * `js-builtin-prototypes.ts` — the same module the differential's oracle imports, so the two
   * sides cannot drift into two copies of one rule. A name NOT in that list gets NO claim: a
   * heuristic ("looks like a DOM name") would be the closed-list lie this fleet keeps catching.
   *
   * THE IMPORT CLASS is claimed too, and it is a DIFFERENT claim kind on purpose: an `imports`
   * row spells `<module>:<item>`, so the claim is about the MODULE (a namespace, not a
   * declaration). The arbiter's `moduleNamespace` claim verifies the module ROOT against the
   * project's own file/directory names and FAILS CLOSED when the root is project-owned, so a
   * workspace package that names a real project directory cannot be laundered. A relative or
   * absolute specifier is NEVER claimed: it names a FILE in this project, and a file claim that
   * misses is REFUTED against the lane — this per-file analyzer is not given the project's file
   * list, so those rows stay unclaimed rather than risk a false external statement.
   *
   * WHAT IT DELIBERATELY DOES NOT CLAIM, and the counts are the next measurement: Node runtime
   * globals (`process`, `Buffer`, `module`, `require`), test-runner globals (`describe`, `it`,
   * `test`, `expect`, `assert`) and imported bindings from external packages are OUTSIDE the
   * cited list. They stay unresolved until each gets its own cited vocabulary; they are named in
   * `validation/m14/verification/JAVASCRIPT-RESOLUTION-CLASSIFICATION.md` with their measured
   * counts rather than smuggled into this table.
   *
   * The claim's own words are published twice: `externalReason` (the machine bucket the arbiter
   * reads) and `externalClaimReason` (the full citation a human audits). `externalReceiver`
   * names the receiver root when the proof is the MEMBER rule, so a reader can re-run the rule
   * from the edge itself.
   */
  private markExternalClaims(
    rootNode: Node,
    relationships: ASTEngine.UniversalRelationship[],
    symbols: ASTEngine.UniversalSymbol[],
    context?: ASTEngine.AnalyzeContext,
  ): number {
    const declaredHere = new Set<string>()
    for (const s of symbols) if (s.name) declaredHere.add(String(s.name))
    const bound = this.bindingModel ? this.bindingModel.allNames : this.collectBoundNames(rootNode)
    let marked = 0
    for (const r of relationships) {
      const label = String(r.type ?? "")
      const target = String(r.target ?? "")
      if (target.length === 0) continue
      const md = (r.metadata ?? (r.metadata = {})) as Record<string, unknown>
      if (md.isExternalTarget === true) continue
      // THE PLAIN-IDENTIFIER RULE IS PER CLAIM CLASS, not global. For the dotless-target claims
      // (calls/uses/extends/references) a dotted target is looked up by its OWNER by the arbiter
      // and a project may publish that owner — a claim there is refutable — while a path or a
      // fragment is refused as unreachable. An `imports` target is `<module>:<item>` BY
      // CONSTRUCTION, so it can never satisfy that rule and the module-namespace claim (a
      // different kind, verified against the project's file/dir names) is the one that applies.
      if (label !== "imports" && !isPlainJsIdentifier(target)) continue
      if (declaredHere.has(target)) continue

      let reason: string | null = null
      let citation: string | null = null
      let receiver: string | null = null

      if (label === "calls") {
        const callee = String(md.calleeExpression ?? "")
        if (callee.length > 0 && callee === target) {
          if (!bound.has(target)) {
            citation = hostGlobalCitation(target)
            if (citation !== null) reason = "host-global-bare"
            else {
              // THE SECOND CLOSED LIST: the RUNTIME (Node host) and TEST-RUNNER globals, cited in
              // js-runtime-globals.ts. Only a BARE name is claimed — a member of these globals
              // (`jest.fn()`, `process.argv.slice`) names a leaf a project may genuinely declare.
              citation = runtimeGlobalCitation(target)
              if (citation !== null) reason = runtimeGlobalReason(target)
            }
          }
        } else if (callee.length > 0 && callee.endsWith(`.${target}`)) {
          // The receiver CHAIN's root, which is what memberChainClaim is defined on:
          // `location.hash.substring` -> root `location` (a cited Window member).
          const recvChain = callee.slice(0, callee.length - target.length - 1)
          const rootEnd = jsIdentifierPrefixEnd(recvChain)
          const root = recvChain.slice(0, rootEnd)
          if (root.length > 0 && isPlainJsIdentifier(root) && !bound.has(root) && !declaredHere.has(root)) {
            citation = memberChainClaim(root, target)
            if (citation !== null) { reason = "host-global-member"; receiver = root }
          }
        }
      } else if (label === "uses") {
        const isBareRead = md.bareRead === true || md.chainRoot === true || md.callReceiver === true || md.isTemplateInterpolation === true
        if (isBareRead) {
          if (!bound.has(target)) {
            citation = hostGlobalCitation(target)
            if (citation !== null) reason = "host-global-bare"
            else {
              citation = runtimeGlobalCitation(target)
              if (citation !== null) reason = runtimeGlobalReason(target)
            }
          }
        } else if (md.isFieldAccess === true) {
          const root = String(md.receiverRoot ?? "")
          if (root.length > 0 && isPlainJsIdentifier(root) && !bound.has(root) && !declaredHere.has(root)) {
            citation = memberChainClaim(root, target)
            if (citation !== null) { reason = "host-global-member"; receiver = root }
          }
        }
      } else if (label === "imports") {
        // THE MODULE-NAMESPACE CLAIM — the arbiter's mechanism for a language whose import
        // spelling names a MODULE and an ITEM (`pathlib:Path`, `xml.sax.handler:ContentHandler`,
        // and every `javascript` import row). The claim is exactly what the spelling states:
        // the SPECIFIER is not a project-relative path, so the module it names is outside this
        // project. The arbiter verifies the module ROOT against the project's own file and
        // directory names and, when the root IS project-owned, returns `externalUnverified`
        // (fail-closed `ext?`) rather than a refutation — so a workspace package that names a
        // real project directory can never be laundered into `extOK`.
        //
        // ONLY A NON-PATH SPECIFIER IS CLAIMED. A relative/absolute specifier names a FILE in
        // this project, and the file question needs the project's admitted file list, which
        // this per-file analyzer is not given (and a file claim that misses is REFUTED, i.e.
        // counted against the lane) — those rows stay unclaimed and are counted in
        // JAVASCRIPT-RESOLUTION-CLASSIFICATION.md.
        const at = target.lastIndexOf(":")
        if (at > 0) {
          const spec = target.slice(0, at)
          const item = target.slice(at + 1)
          const isRelative = spec.startsWith(".") || spec.startsWith("/")
          const isScheme = spec.includes("://")
          const isPathish = spec.includes("\\") || spec.length === 0 || item.length === 0
          // FAIL-CLOSED, like the python twin's `applyProjectIndexFacts`: externality of a MODULE
          // is not readable from one file. A complete project index is the project saying "no
          // module of mine answers to this specifier"; a sampled or absent index is a fragment,
          // and a fragment that says "no such file" says nothing. Without the index the lane
          // claims NOTHING here — that is why the cap-50 index-less gate can never show these
          // edges in `extOK`, and why the claim's measurable arm is `incoming-gate … 0 --index`.
          const index = context?.projectIndex
          if (!isRelative && !isScheme && !isPathish && index !== undefined && index.complete === true) {
            const verdict = jsProjectModuleLocalityOf(index)(spec)
            if (verdict === "third-party") {
              reason = "module-namespace"
              citation = `import specifier \`${spec}\` names no module of this project (complete project index; ${item === "*" ? "namespace import" : `item ${item}`})`
              receiver = spec
            }
          }
        }
      } else if (label === "extends" || label === "references" || label === "instantiates") {
        // A BASE, an `instanceof` type or a constructed class that is a cited host/runtime class
        // (`extends Error`, `x instanceof Date`, `new Buffer`). The name is the target itself, so
        // the bare proof applies.
        if (!bound.has(target) && label !== "instantiates" ) {
          citation = hostGlobalCitation(target)
          if (citation !== null) reason = label === "extends" ? "host-global-base" : "host-global-type"
        }
        if (citation === null && !bound.has(target)) {
          citation = runtimeGlobalCitation(target)
          if (citation !== null) reason = runtimeGlobalReason(target)
        }
      }
      if (reason === null || citation === null) continue
      md.isExternalTarget = true
      md.externalReason = reason
      md.externalClaimReason = citation
      if (receiver !== null) md.externalReceiver = receiver
      // THE FIELD THE ARBITER VERIFIES A module-namespace CLAIM WITH: the module (or receiver
      // root) the claim is about. `externalClaimOf` reads it as `externalSpecifier` and routes
      // the claim to `moduleNamespace`, whose check is the module ROOT against the project's
      // own file/directory names — the only check this claim can honestly be given.
      if (reason === "module-namespace" && receiver !== null) md.externalSpecifier = receiver
      marked++
    }
    return marked
  }

  /**
   * EVERY NAME THIS FILE BINDS — the negative control of the claim pass, and deliberately
   * over-collecting: a name collected here that is not really a binding can only REFUSE a
   * claim, never make one, so the conservative direction is the safe direction.
   *
   * The positions are the grammar's own definition positions, matched by the same node-type
   * tests the bare-read walk applies (`isImportBinding` / `isParamBinding` / `isPatternBinding`
   * / declaration names), read from the IDENTIFIER's parent rather than re-walking each
   * construct — one pass, no shape re-derived.
   */
  private collectBoundNames(rootNode: Node): Set<string> {
    const out = new Set<string>()
    const stack: Node[] = [rootNode]
    while (stack.length > 0) {
      const n = stack.pop()!
      if (n.type === "identifier") {
        const p = n.parent
        if (p) {
          const isDeclName =
            (p.type === "variable_declarator" && p.childForFieldName("name")?.id === n.id) ||
            (p.type === "function_declaration" && p.childForFieldName("name")?.id === n.id) ||
            (p.type === "generator_function_declaration" && p.childForFieldName("name")?.id === n.id) ||
            (p.type === "class_declaration" && p.childForFieldName("name")?.id === n.id) ||
            (p.type === "function_expression" && p.childForFieldName("name")?.id === n.id) ||
            (p.type === "method_definition" && p.childForFieldName("name")?.id === n.id)
          const isBindingPosition =
            p.type === "formal_parameters" ||
            p.type === "import_clause" || p.type === "import_specifier" || p.type === "namespace_import" ||
            p.type === "catch_clause" ||
            p.type === "object_pattern" || p.type === "array_pattern" || p.type === "rest_pattern" ||
            p.type === "shorthand_property_identifier_pattern" ||
            (p.type === "pair_pattern") ||
            (p.type === "assignment_pattern" && (p.childForFieldName("left") ?? p.namedChild(0))?.id === n.id) ||
            (p.type === "arrow_function" && p.childForFieldName("parameter")?.id === n.id)
          if (isDeclName || isBindingPosition) out.add(n.text)
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) stack.push(c)
      }
    }
    return out
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
