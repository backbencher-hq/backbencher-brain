// script/m60/framework-surface-census.ts — the "framework trigger surface" census.
//
// Owner standard (2026-09-22, reviews/m60-oo-family-plan.md §3, C7): a framework
// capability claim must be backed by a trigger surface that actually fires. The
// published family contract (recorded in real-csharp-analyzer.ts's CONV-CS-2
// header, java-sibling) is three metadata keys:
//
//     framework            the deterministic PRIMARY pick, or absent
//     detectedFrameworks   ALWAYS an array, [] when none
//     frameworkPatterns    per-framework patterns, aligned with detectedFrameworks
//
// and a capability boolean (`hasFrameworkIntelligence`) that is a CLAIM about the
// surface. The class this census measures is every way that contract can be
// published false, measured on the analyzers' own sources:
//
//   dead-surface        a trigger surface that is READ into the published keys and
//                       written NOWHERE — so the published array is empty forever
//                       while the analyzer still claims the capability. (python #747)
//   append-write        a name written through `.push`/`.unshift`/`+=` on an
//                       accumulator, so N trigger hits become N identical entries.
//   deduped-write       a name written through `.add`/`.set` — the safe shape.
//   replace-write       the accumulator is assigned/refilled wholesale.
//   name-divergence     two framework-name literals in ONE analyzer where one is a
//                       strict substring of the other ("Rails" vs "Ruby on Rails")
//                       — one framework, two names, so both can be published.
//   dominated-trigger   a trigger guarded on a literal that is a MEMBER of a set an
//                       EARLIER guard already returned on — reachable in no
//                       execution. (ruby #749: `before_action` is in
//                       RAILS_MACRO_METHODS, whose branch returns, and the push that
//                       would record it sits after that return.)
//   unjustified-claim   `hasFrameworkIntelligence: true` in an analyzer whose
//                       trigger surface is dead.
//   missing-contract-key an analyzer publishes a framework surface but omits one of
//                       the three contract keys.
//   unclassified        anything else — reported, never silently dropped.
//
// WHY A CENSUS AND NOT A GREP
// ---------------------------
// The obvious grep is `detectedFrameworks` and it is wrong in both directions: it
// misses python (whose dead surface is `ctx.frameworks`, a DIFFERENT field name)
// and it convicts a comment that merely names the key. R7 already paid for the
// loose version — #873 reported 8 analyzers when 2 were real, because a key was
// read out of a nearby colon that belonged to a ternary (see the R6/R7 headers).
// So classification here is by SYNTACTIC POSITION in a real parse: the literal's
// parent node and field, and the write operator actually applied to the
// accumulator. Prose in a comment is not a string node, so it cannot be counted.
//
// The contract key names are declared below rather than guessed: they are READ FROM
// the contract (the three metadata keys above, and the capability key). Everything
// else — which bindings are surfaces, which writes dedupe, which guards dominate —
// is derived from the file's own AST, with no per-language name list and no
// per-framework name list anywhere in this file.
//
// BOUNDARIES, DISCLOSED
// ---------------------
//   * Sources scanned: `src/ast/real-*-analyzer.ts`, parsed as TypeScript. A file
//     that does not parse is REPORTED (`parseErrors`) and contributes zero sites.
//   * The dead-surface rule is ONE HOP: from a binding published under a contract
//     key, to the member reads on the right-hand side of statements that write that
//     binding. A trigger surface reached through two or more hops is not claimed
//     here — the count of bindings examined is reported so the scope is visible.
//   * The dominated-trigger rule resolves set membership from a same-file
//     `new Set([...])` / array literal binding, and a guard counts as dominating
//     only when the terminator is an unconditional statement of the guard's own
//     block (a `return` inside a nested `if` does not dominate).
//   * This is the STATIC half. The runtime half — the emitted metadata obeys the
//     contract (deduped, primary pick consistent, patterns aligned, claim justified)
//     on a real file — is a separate instrument and is recorded as outstanding in
//     the register (`runtimeOwed`), never implied by this census being green.
//
// Run: bun script/m60/framework-surface-census.ts [--emit]
//   default: print the census summary + self-tests
//   --emit:  write validation/m60/results/framework-surfaces.json
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs"
import path from "node:path"
import * as WTS from "web-tree-sitter"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const AST_DIR = path.join(ROOT, "src/ast")
const WASM_DIR = path.join(ROOT, "wasm")
const OUT = path.join(ROOT, "validation/m60/results/framework-surfaces.json")

/** The published family contract: the metadata keys every framework-aware analyzer emits. */
const CONTRACT_KEYS = new Set(["framework", "detectedFrameworks", "frameworkPatterns"])
/** The capability booleans: a CLAIM about the surface, so a false one is a lie with a name. */
const CAPABILITY_KEYS = new Set(["hasFrameworkIntelligence"])

/** Accumulator methods that CANNOT dedupe — N hits become N entries. */
const APPEND_OPS = new Set(["push", "unshift", "concat"])
/** Accumulator methods that dedupe by construction. */
const DEDUPE_OPS = new Set(["add", "set"])
/** Statements that end the current path. */
const TERMINATORS = new Set(["return_statement", "throw_statement", "continue_statement", "break_statement"])

export type SurfaceShape =
  | "dead-surface"
  | "append-write"
  | "deduped-guard"
  | "deduped-write"
  | "replace-write"
  | "name-divergence"
  | "dominated-trigger"
  | "unjustified-claim"
  | "missing-contract-key"
  | "unclassified"

export type SurfaceVerdict = "violation" | "safe" | "reported"

/** Function/class bodies: a guard inside one cannot dominate, or protect, code outside it. */
const FN_SCOPE = new Set([
  "arrow_function", "function_declaration", "function_expression", "function",
  "generator_function", "generator_function_declaration", "method_definition",
  "class_declaration", "class_body", "abstract_class_declaration",
])

/** Walk a subtree, pruning nested function bodies. */
function walkNoFn(node: any, cb: (n: any) => void): void {
  cb(node)
  for (const c of node.children ?? []) {
    if (FN_SCOPE.has(c.type)) continue
    walkNoFn(c, cb)
  }
}

export interface SurfaceSite {
  file: string
  lang: string
  line: number
  shape: SurfaceShape
  /** What the site is ABOUT — the accumulator, the name pair, the missing key. */
  key: string | null
  /** Whitespace-collapsed source of the enclosing statement — the register key. */
  statement: string
  verdict: SurfaceVerdict
}

export interface SurfaceCensus {
  files: number
  occurrences: number
  parseErrors: string[]
  byShape: Record<string, number>
  byVerdict: Record<string, number>
  byLanguage: Record<string, { violations: number; safe: number; reported: number; publishesContract: boolean }>
  /**
   * Analyzer files that NAME a framework-contract key while publishing none the classifier
   * can read. Not a verdict about their behaviour — a statement that they cannot be
   * adjudicated, which the gate treats as a refusal rather than a pass.
   */
  unexamined: string[]
  /** How many contract-key bindings the one-hop dead-surface rule actually examined. */
  bindingsExamined: number
  sites: SurfaceSite[]
}

const langOf = (file: string) => file.replace(/^real-/, "").replace(/-analyzer\.ts$/, "")

function walk(node: any, cb: (n: any) => void): void {
  cb(node)
  for (const child of node.children ?? []) walk(child, cb)
}

/** `(expr)` — skip parentheses so a guarded literal is found inside them. */
function unwrap(node: any): any {
  let n = node
  while (n && (n.type === "parenthesized_expression" || n.type === "as_expression")) n = n.namedChild(0)
  return n
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim()

/** The nearest statement-shaped ancestor, INCLUDED — so the register key carries the subject. */
const BOUNDARY = /statement|declarator|declaration|pair|field_definition|property_signature|jsx_attribute/
function enclosingStatementNode(node: any): any {
  let anc = unwrap(node) ?? node
  while (anc.parent && !BOUNDARY.test(anc.parent.type)) anc = anc.parent
  if (anc.parent && BOUNDARY.test(anc.parent.type)) anc = anc.parent
  return anc
}
function enclosingStatement(node: any): string {
  return norm(enclosingStatementNode(node).text).slice(0, 200)
}

/** Nodes that END a statement scope: a read outside one of these is a different statement. */
const BLOCK_SCOPE = new Set(["statement_block", "program", "class_body", "declaration_list", "switch_body", "object", "arguments", "array"])
/**
 * The WIDEST statement that still contains `node` without crossing a block boundary.
 *
 * Needed because the read that feeds a write is often the ENCLOSING control structure,
 * not the write statement: in `for (const k in ctx.frameworks) detectedFrameworks.push(k)`
 * the surface read is the loop's iterable, so the narrowest boundary (`enclosingStatement`,)
 * returns just the `push` and sees no upstream surface at all. Deliberately still bounded
 * — it stops at the block, so a surface touched a statement away is not claimed.
 */
function statementScope(node: any): any {
  let anc = node
  while (anc.parent && !BLOCK_SCOPE.has(anc.parent.type)) anc = anc.parent
  return anc
}

/** A property access: `obj.prop` — returns [objectText, propertyText] or null. */
function member(node: any): { obj: any; objText: string; prop: string } | null {
  const n = unwrap(node)
  if (!n || n.type !== "member_expression") return null
  const obj = n.childForFieldName("object")
  const prop = n.childForFieldName("property")
  if (!obj || !prop) return null
  return { obj, objText: norm(obj.text), prop: prop.text }
}

/** Is this node the callee of a call? */
function calleeOf(node: any): any | null {
  const p = node.parent
  if (p && p.type === "call_expression" && p.childForFieldName("function")?.id === node.id) return p
  return null
}

/** String literals directly inside a node's subtree (arguments, initializers). */
function directStringArgs(callArgs: any): string[] {
  const out: string[] = []
  if (!callArgs) return out
  for (const child of callArgs.namedChildren ?? []) {
    const c = unwrap(child)
    if (c && c.type === "string") out.push(c.text.replace(/^["'`]|["'`]$/g, ""))
  }
  return out
}

/** Same-file constant containers: `const X = new Set([...])` and `const X = [...]`. */
function collectContainers(root: any): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  walk(root, (n: any) => {
    if (n.type !== "variable_declarator") return
    const name = n.childForFieldName("name")?.text
    const value = unwrap(n.childForFieldName("value"))
    if (!name || !value) return
    let members: any = null
    if (value.type === "new_expression") {
      const ctor = value.childForFieldName("constructor")?.text
      if (ctor !== "Set" && ctor !== "Map" && ctor !== "Array") return
      members = value.childForFieldName("arguments")?.namedChild(0)
    } else if (value.type === "array") {
      members = value
    } else if (value.type === "call_expression") {
      // `X = Object.freeze([...])` / `new Set(...)` chained helpers resolve to their first array arg.
      const args = value.childForFieldName("arguments")?.namedChild(0)
      if (unwrap(args)?.type !== "array") return
      members = unwrap(args)
    } else {
      return
    }
    if (!members || members.type !== "array") return
    const s = new Set<string>()
    for (const el of members.namedChildren ?? []) {
      const e = unwrap(el)
      if (e && e.type === "string") s.add(e.text.replace(/^["'`]|["'`]$/g, ""))
    }
    if (s.size > 0) out.set(name, s)
  })
  return out
}

/** `metadata.detectedFrameworks!` and `metadata.detectedFrameworks` are one surface. */
const cleanPath = (s: string) => s.trim().replace(/!+$/, "").trim()

/**
 * The bindings/access paths a file publishes framework data under.
 *
 * TWO surface forms exist in this repo, and a census that models only one of them
 * misses real defects (measured, not assumed):
 *
 *  A. a LOCAL accumulator — `const detectedFrameworks = new Set()`, published as
 *     `detectedFrameworks: [...detectedFrameworks]` (objc, php) or by shorthand (python).
 *  B. a HOLDER MEMBER — `const metadata = { detectedFrameworks: [], frameworkPatterns: [] }`
 *     whose members are written as `metadata.detectedFrameworks!.push(...)` (ruby).
 *     Before this was modelled, ruby's accumulator writes were invisible to the census
 *     — the analyzer with the worst instance of the defect contributed no sites at all.
 *
 * Only the COLLECTION keys (`detectedFrameworks`, `frameworkPatterns`) declare a surface;
 * the scalar `framework` key publishes a pick and is never an accumulator.
 */
interface SurfaceInfo {
  /** normalized access paths holding framework data: `frameworks`, `metadata.detectedFrameworks` */
  refs: Set<string>
  publishesContract: boolean
  publishedKeys: Set<string>
  /** the metadata objects, so the file-level block reads the SAME scope */
  meta: MetadataModel
  /**
   * Local aliases of a surface: `const detected = (metadata.detectedFrameworks ??= [])`.
   * Without these, a write through the alias is invisible, and — worse — a GUARDED write
   * through one reads as an unguarded bare push. That is not hypothetical: it is exactly
   * what the ruby fix exposed, where a deduping push was reported as the duplication class.
   */
  aliases: Map<string, string>
}
const COLLECTION_KEYS = new Set(["detectedFrameworks", "frameworkPatterns"])

/**
 * The METADATA objects — and only those — where contract keys are published.
 *
 * Scoping this was not optional: counting a contract key anywhere in the file made
 * ruby look compliant, because its `frameworkPatterns.push({ framework: "Rails", ... })`
 * contains a `framework:` pair — inside a PATTERN object, not the metadata. The runtime
 * probe measured ruby's `metadata.framework` as undefined, so the census was
 * disagreeing with the analyzer's actual output and the analyzer was right about the
 * census being wrong. Publication is now read from the metadata object, or from
 * `metadata.<key> = ...` assignments to the holder it is bound to.
 */
export interface MetadataModel {
  /** identifiers bound to a metadata object: `const metadata: Partial<FileMetadata> = {...}` */
  holders: Set<string>
  /** the object literals themselves (a `metadata: {...}` inline, or a holder's initialiser) */
  literals: any[]
}

function collectMetadata(root: any): MetadataModel {
  const holders = new Set<string>()
  const literals: any[] = []
  walk(root, (n: any) => {
    if (n.type === "pair") {
      const k = unwrap(n.childForFieldName("key"))?.text?.replace(/^["'`]|["'`]$/g, "")
      if (k !== "metadata") return
      const v = unwrap(n.childForFieldName("value"))
      if (v && v.type === "object") literals.push(v)
      return
    }
    if (n.type !== "variable_declarator") return
    const name = n.childForFieldName("name")?.text
    const v = unwrap(n.childForFieldName("value"))
    if (!name || !v || !/^meta(data)?$/i.test(name)) return
    if (v.type === "object") { holders.add(name); literals.push(v); return }
    // `const metadata = Object.assign({...}, {errors: []})` and helper-call forms.
    if (v.type === "call_expression") {
      for (const a of v.childForFieldName("arguments")?.namedChildren ?? []) {
        const av = unwrap(a)
        if (av && av.type === "object") { holders.add(name); literals.push(av) }
      }
    }
  })
  return { holders, literals }
}

/** The keys a file PUBLISHES on its metadata: literal keys, shorthand, and `m.key = ...`. */
function publishedKeysOf(root: any, meta: MetadataModel): Set<string> {
  const keys = new Set<string>()
  const take = (k: string | null) => { if (k && CONTRACT_KEYS.has(k)) keys.add(k) }
  for (const lit of meta.literals) {
    for (const p of lit.namedChildren ?? []) {
      if (p.type === "pair") take(unwrap(p.childForFieldName("key"))?.text?.replace(/^["'`]|["'`]$/g, "") ?? null)
      if (p.type === "shorthand_property_identifier" || p.type === "shorthand_property_identifier_pattern") take(p.text)
    }
  }
  walk(root, (n: any) => {
    // `metadata.framework = x` publishes; so does `metadata.detectedFrameworks ??= []`.
    // The augmented form was missed at first, which made a fix that publishes the
    // primary pick through `??=` still read as a missing contract key.
    if (n.type !== "assignment_expression" && n.type !== "augmented_assignment_expression") return
    const m = member(n.childForFieldName("left"))
    if (!m) return
    if (meta.holders.has(cleanPath(m.objText))) take(m.prop)
  })
  return keys
}

/**
 * Is this append guarded by an absence test on the same accumulator and the same value?
 *
 * `if (!detected.includes(name)) detected.push(name)` cannot write a duplicate, and the
 * census must say so or it reports a shape that is no longer the defect. Bounded to the
 * nearest enclosing `if` inside the same function, and to a test that names BOTH the
 * accumulator and the pushed value, so an unrelated guard elsewhere cannot launder a
 * bare push into a safe shape.
 */
function isGuardedAppend(write: any, names: string[]): boolean {
  if (write.node.type !== "call_expression") return false
  const fn = member(write.node.childForFieldName("function"))
  if (!fn || (fn.prop !== "push" && fn.prop !== "unshift")) return false
  const arg = write.node.childForFieldName("arguments")?.namedChild(0)
  if (!arg) return false
  const argText = norm(unwrap(arg)?.text ?? "")
  if (!argText) return false
  // Bounded to the nearest enclosing `if` inside the same function or block — a guard
  // outside the block that contains the write does not protect it.
  let anc = write.node
  while (anc.parent) {
    if (FN_SCOPE.has(anc.parent.type) || anc.parent.type === "statement_block") break
    anc = anc.parent
    if (anc.type !== "if_statement") continue
    const cond = norm(unwrap(anc.childForFieldName("condition"))?.text ?? "")
    const testsThisPair = names.some(
      (n) => cond.includes(`${n}.includes(${argText})`) || cond.includes(`${n}.indexOf(${argText})`) || cond.includes(`${n}.has(${argText})`),
    )
    // An absence test over a predicate — `if (!patterns.some((p) => p.framework === name))`
    // — dedupes just as surely as `.includes`, and the argument is inside the predicate
    // rather than beside the receiver, so the pair test above cannot see it.
    const testsAbsence = names.some((n) => cond.includes(`!${n}.some(`) || cond.includes(`!${n}.every(`))
    if (!testsThisPair && !testsAbsence) continue
    if (cond.includes("!") || cond.includes("=== -1") || cond.includes("< 0") || cond.includes("== null")) return true
  }
  return false
}

/**
 * The surface a published expression READS, by shape — deliberately shallow and
 * non-recursive into call arguments.
 *
 * Every widening here has been paid for by a false accusation, measured:
 *   * collecting identifiers inside `framework: node.type` accused `node.type` of
 *     being a dead surface in go/java/kotlin;
 *   * collecting identifiers inside CALL ARGUMENTS did the same through
 *     `detectedFrameworks: this.detectGoFrameworks(symbols, relationships)` — which
 *     made `symbols` a "surface", so every `symbols.push({...})` in the file became an
 *     append-write and every member in its object literal a dead surface (16 in go,
 *     14 in kotlin). The published value is a surface only where it IS one:
 *     `X`, `[...X]`, `X[0]`, `X.map(...)`, or a ternary over those.
 */
function publishedRefsFromValue(v: any, out: Set<string>, locals?: Map<string, any>, depth = 0): void {
  if (!v) return
  switch (v.type) {
    case "identifier": {
      out.add(v.text)
      // ONE hop through a local binding, and through the SAME shape rules — this is the
      // published value's derivation, not a sweep of the initializer's identifiers. The
      // distinction was measured the hard way: a blanket identifier pass over local
      // initializers produced 54 violations from 21 (groovy 9, kotlin 16, typescript 9)
      // by convicting `pName.text`, `ASTEngine.SymbolKind` and `parameters.length` —
      // member reads and property labels, not accumulators. Recursing here reaches
      // `const detectedFrameworks = [...frameworks]` (objective-c, and every repaired
      // lane's shape) and nothing else.
      if (locals && depth === 0) {
        const init = locals.get(v.text)
        if (init) publishedRefsFromValue(init, out, locals, depth + 1)
      }
      return
    }
    case "non_null_expression":
      return publishedRefsFromValue(unwrap(v), out, locals, depth)
    case "spread_element":
      return publishedRefsFromValue(unwrap(v.namedChild(0)), out, locals, depth)
    case "array":
      for (const el of v.namedChildren ?? []) publishedRefsFromValue(unwrap(el), out, locals, depth)
      return
    case "subscript_expression":
      return publishedRefsFromValue(unwrap(v.childForFieldName("object")), out, locals, depth)
    case "member_expression": {
      const obj = unwrap(v.childForFieldName("object"))
      if (obj && obj.type === "identifier") out.add(obj.text)
      return
    }
    case "ternary_expression":
      publishedRefsFromValue(unwrap(v.childForFieldName("consequence")), out, locals, depth)
      return publishedRefsFromValue(unwrap(v.childForFieldName("alternative")), out, locals, depth)
    case "call_expression": {
      // `detectedFrameworks.map(...)` — the RECEIVER is the surface; the arguments are not.
      const fn = v.childForFieldName("function")
      const m = member(fn)
      const recv = m ? unwrap(m.obj) : unwrap(fn)
      if (recv && recv.type === "identifier") out.add(recv.text)
      return
    }
    default:
      return
  }
}

function collectSurface(root: any): SurfaceInfo {
  const refs = new Set<string>()
  const publishedKeys = new Set<string>()

  // The local bindings a published identifier may be derived from. `const detectedFrameworks
  // = [...frameworks]` publishes the LOCAL while the walker writes the SET, and without
  // this the accumulator of the lane that was just repaired stops being a surface at all —
  // measured: it is exactly what CONV-OC-1 did to objective-c, and the self-test written
  // for it ("locals feeding an inline metadata literal keep the keys AND the surface")
  // failed on the classifier before the hop below existed.
  const localInits = new Map<string, any>()
  walk(root, (n: any) => {
    if (n.type !== "variable_declarator") return
    const name = n.childForFieldName("name")?.text
    const v = n.childForFieldName("value")
    if (name && v && !localInits.has(name)) localInits.set(name, unwrap(v))
  })

  // A. holder form: `const metadata = { detectedFrameworks: [], frameworkPatterns: [] }`
  walk(root, (n: any) => {
    if (n.type !== "variable_declarator") return
    const name = n.childForFieldName("name")?.text
    const value = unwrap(n.childForFieldName("value"))
    if (!name || !value || value.type !== "object") return
    for (const p of value.namedChildren ?? []) {
      if (p.type !== "pair") continue
      const k = unwrap(p.childForFieldName("key"))?.text?.replace(/^["'`]|["'`]$/g, "")
      if (!k || !COLLECTION_KEYS.has(k)) continue
      refs.add(`${name}.${k}`)
    }
  })

  // B. published form: the identifier(s) the contract keys are published FROM, read from
  // the METADATA OBJECT only (see collectMetadata for why the unscoped version was wrong).
  const meta = collectMetadata(root)
  for (const lit of meta.literals) {
    for (const p of lit.namedChildren ?? []) {
      let k: string | null = null
      if (p.type === "pair") k = unwrap(p.childForFieldName("key"))?.text?.replace(/^["'`]|["'`]$/g, "") ?? null
      if (p.type === "shorthand_property_identifier" || p.type === "shorthand_property_identifier_pattern") k = p.text
      if (k) publishedKeys.add(k)
      if (!k || !COLLECTION_KEYS.has(k)) continue
      if (p.type === "pair") {
        publishedRefsFromValue(unwrap(p.childForFieldName("value")), refs, localInits)
      } else {
        // Shorthand (`detectedFrameworks,`) publishes the local itself, so the hop has to
        // happen HERE as well — this is objective-c's and python's publication shape, and
        // without it the fixed ancestor of the hop below would have been invisible.
        refs.add(k)
        const init = localInits.get(k)
        if (init) publishedRefsFromValue(init, refs, localInits, 1)
      }
    }
  }

  // C. alias bindings — a local that IS a surface.
  const aliases = new Map<string, string>()
  walk(root, (n: any) => {
    if (n.type !== "variable_declarator") return
    const name = n.childForFieldName("name")?.text
    const v = n.childForFieldName("value")
    if (!name || !v) return
    let inner = unwrap(v)
    if (inner && (inner.type === "assignment_expression" || inner.type === "augmented_assignment_expression")) {
      inner = unwrap(inner.childForFieldName("left"))
    }
    const m = member(inner)
    if (!m) return
    const path = cleanPath(`${m.objText}.${m.prop}`)
    if (refs.has(path)) aliases.set(name, path)
  })

  return { refs, publishesContract: [...publishedKeys].some((k) => CONTRACT_KEYS.has(k)), publishedKeys, meta, aliases }
}

/** The surface a receiver text refers to — directly, or through a local alias. */
function refOf(objText: string, aliases: Map<string, string>): string {
  const t = cleanPath(objText)
  return aliases.get(t) ?? t
}

/** Every write into a surface ref, as the node that performs it. */
function writesInto(root: any, ref: string, aliases: Map<string, string>): any[] {
  const out: any[] = []
  walk(root, (n: any) => {
    if (n.type === "call_expression") {
      const fn = member(n.childForFieldName("function"))
      if (fn && refOf(fn.objText, aliases) === ref && (APPEND_OPS.has(fn.prop) || DEDUPE_OPS.has(fn.prop))) out.push(n)
      return
    }
    if (n.type === "assignment_expression" || n.type === "augmented_assignment_expression") {
      const m = member(n.childForFieldName("left"))
      if (m && refOf(`${m.objText}.${m.prop}`, aliases) === ref) out.push(n)
    }
  })
  return out
}

/** The write operator applied by a write node. */
function writeOpOf(node: any, ref: string, aliases: Map<string, string>): "append" | "dedupe" | "replace" | null {
  if (node.type === "call_expression") {
    const fn = member(node.childForFieldName("function"))
    if (!fn || refOf(fn.objText, aliases) !== ref) return null
    if (APPEND_OPS.has(fn.prop)) return "append"
    if (DEDUPE_OPS.has(fn.prop)) return "dedupe"
    return null
  }
  if (node.type === "augmented_assignment_expression") {
    // `??= []` fills an absent accumulator, it does not accumulate: an initialiser cannot
    // write a duplicate. Only `+=` appends. Treating every augmented assignment as an
    // append made `(metadata.detectedFrameworks ??= [])` read as the duplication class.
    const op = (node.children ?? []).find((c: any) => !c.isNamed)?.text
    return op === "+=" ? "append" : "replace"
  }
  if (node.type === "assignment_expression") return "replace"
  return null
}

const LOOPS = new Set(["for_in_statement", "for_of_statement", "for_statement", "while_statement", "do_statement"])
/**
 * The nearest enclosing LOOP's source expression, without crossing a block boundary.
 *
 * A write's upstream surface is usually the loop it is iterating:
 * `for (const k in ctx.frameworks) detectedFrameworks.push(k)` has no member read in
 * its arguments at all, because the read is the ITERABLE. A census that only scanned
 * arguments could not see python's defect — the self-test proved it.
 */
function loopSourceOf(node: any): any | null {
  let anc = node
  while (anc.parent && !BLOCK_SCOPE.has(anc.parent.type)) {
    anc = anc.parent
    if (LOOPS.has(anc.type)) return anc.childForFieldName("right") ?? anc.childForFieldName("condition") ?? null
  }
  return null
}

/** Every `X.field` access in the file, split into reads and writes. */
function memberAccesses(root: any): { read: any[]; written: Set<string>; writtenIds: Set<number> } {
  const read: any[] = []
  const written = new Set<string>()
  const writtenIds = new Set<number>()
  const note = (m: { objText: string; prop: string; node?: any } | null, node?: any) => {
    if (!m) return
    written.add(`${m.objText}.${m.prop}`)
    if (node) writtenIds.add(node.id)
  }
  walk(root, (n: any) => {
    // An assignment writes every member inside its LEFT side, which is how
    // `ctx.frameworks["Django"] = true` (a subscript write) is recognised — the
    // member itself is nested one level down and the earlier version missed it.
    if (n.type === "assignment_expression" || n.type === "augmented_assignment_expression") {
      const left = n.childForFieldName("left")
      if (left) walk(left, (m: any) => note(member(m), m))
      return
    }
    // `A.b.push(...)` — the RECEIVER is the write target, not the receiver's parent.
    if (n.type === "call_expression") {
      const fn = member(n.childForFieldName("function"))
      if (!fn || !(APPEND_OPS.has(fn.prop) || DEDUPE_OPS.has(fn.prop))) return
      const recv = member(fn.obj)
      if (recv) note(recv, fn.obj)
    }
  })
  walk(root, (n: any) => {
    if (!member(n)) return
    if (writtenIds.has(n.id)) return
    // A member that is the OBJECT of an accumulating call is the write target too,
    // even when the outer call's target is an identifier (`arr.push(x)` on `this.arr`).
    const p = n.parent
    if (p && p.type === "member_expression") {
      const outer = member(p)
      if (outer && (APPEND_OPS.has(outer.prop) || DEDUPE_OPS.has(outer.prop))) {
        written.add(`${member(n)!.objText}.${member(n)!.prop}`)
        writtenIds.add(n.id)
        return
      }
    }
    if (calleeOf(n)) return
    read.push(n)
  })
  return { read, written, writtenIds }
}

/** Guards that terminate: [setName, testedIdent, condText, node] for each early return. */
function dominatingGuards(body: any): { set: string; ident: string; cond: string }[] {
  const out: { set: string; ident: string; cond: string }[] = []
  for (const st of body.namedChildren ?? []) {
    if (st.type !== "if_statement") continue
    const cons = unwrap(st.childForFieldName("consequence"))
    if (!cons) continue
    const endsUnconditionally = (node: any): boolean => {
      const blk = node.type === "statement_block" ? node : null
      const stmts: any[] = blk ? blk.namedChildren ?? [] : [node]
      for (const s of stmts) if (TERMINATORS.has(s.type)) return true
      return false
    }
    if (!endsUnconditionally(cons)) continue
    const cond = unwrap(st.childForFieldName("condition"))
    if (!cond) continue
    const condText = norm(cond.text)
    walk(cond, (c: any) => {
      if (c.type !== "call_expression") return
      const fn = member(c.childForFieldName("function"))
      if (!fn || fn.prop !== "has") return
      const arg = c.childForFieldName("arguments")?.namedChild(0)
      const a = unwrap(arg)
      if (fn.obj.type === "identifier" && a && a.type === "identifier") out.push({ set: fn.objText, ident: a.text, cond: condText })
    })
  }
  return out
}

export interface FileScan {
  sites: SurfaceSite[]
  bindingsExamined: number
  /**
   * The contract keys this file PUBLISHES on its metadata (from the metadata object, or
   * from `metadata.<key> = ...`). Exposed because "this lane is clean" and "this lane is
   * not being examined" are the same number of sites, and the difference has to be
   * checkable: the first version of the objective-c fix wrapped the metadata literal in an
   * IIFE, which dropped the lane from adjudication entirely while every count stayed at
   * zero. An audit can now compare this against the key names the file mentions.
   */
  publishedContractKeys: string[]
}

/** Scan one analyzer source. Exported so the self-tests can drive it. */
export function scanFile(parser: any, file: string, src: string): { scan: FileScan; parseError: boolean } {
  const tree = parser.parse(src)
  if (!tree || tree.rootNode.hasError) return { scan: { sites: [], bindingsExamined: 0, publishedContractKeys: [] }, parseError: true }
  const root = tree.rootNode
  const lang = langOf(file)
  const sites: SurfaceSite[] = []
  const add = (node: any, shape: SurfaceShape, verdict: SurfaceVerdict, key: string | null) =>
    sites.push({ file, lang, line: node.startPosition.row + 1, shape, key, statement: enclosingStatement(node), verdict })

  const surface = collectSurface(root)
  const accesses = memberAccesses(root)
  const containers = collectContainers(root)
  const allWrites: { ref: string; node: any; op: "append" | "dedupe" | "replace" }[] = []
  for (const ref of surface.refs) {
    for (const w of writesInto(root, ref, surface.aliases)) {
      const op = writeOpOf(w, ref, surface.aliases)
      if (op) allWrites.push({ ref, node: w, op })
    }
  }

  // ---- dead-surface: the LOOP ITERABLE (or write argument) a write reads, when
  // that member is written nowhere in the file. `accesses.read` alone was far too
  // wide: it convicted every member that happened to sit in the same statement, so
  // the first run accused `node.type` and `needle.length` of being surfaces.
  const deadMembers = new Set<string>()
  for (const w of allWrites) {
    const sources: any[] = []
    const loopSrc = loopSourceOf(w.node)
    if (loopSrc) sources.push(loopSrc)
    const args = w.node.type === "call_expression" ? w.node.childForFieldName("arguments") : w.node.childForFieldName("right")
    if (args) sources.push(args)
    for (const src of sources) {
      walk(src, (m: any) => {
        const mm = member(m)
        if (!mm) return
        if (mm.obj.type !== "identifier") return
        const key = `${mm.objText}.${mm.prop}`
        if (cleanPath(key) === w.ref) return
        if (accesses.written.has(key)) return
        if (deadMembers.has(key)) return
        deadMembers.add(key)
        add(m, "dead-surface", "violation", key)
      })
    }
  }

  // ---- accumulator writes: append vs deduped vs replace ----
  // `append-write` is REPORTED rather than convicted, and that distinction is the
  // honest one: `.push` cannot dedupe, but whether it ever WRITES a duplicate depends
  // on multiplicity — N hits of the same trigger. json pushes nine DISTINCT framework
  // names in straight line (duplication impossible), while ruby pushes one name from a
  // walker invoked per class (measured: five identical entries on a five-model file).
  // The static shape is a reported risk; the runtime half measures the multiplicity.
  for (const w of allWrites) {
    if (w.op === "append") {
      const names = [w.ref, ...[...surface.aliases].filter(([, r]) => r === w.ref).map(([n]) => n)]
      const guarded = isGuardedAppend(w, names)
      add(w.node, guarded ? "deduped-guard" : "append-write", guarded ? "safe" : "reported", w.ref)
      continue
    }
    add(w.node, w.op === "dedupe" ? "deduped-write" : "replace-write", "safe", w.ref)
  }

  // ---- framework-name literals: divergence (one framework, two names) ----
  const names: { name: string; node: any }[] = []
  for (const w of allWrites) {
    if (w.node.type !== "call_expression") continue
    for (const s of directStringArgs(w.node.childForFieldName("arguments"))) names.push({ name: s, node: w.node })
  }
  walk(root, (n: any) => {
    if (n.type !== "pair") return
    const k = unwrap(n.childForFieldName("key"))?.text?.replace(/^["'`]|["'`]$/g, "")
    if (k !== "framework") return
    const v = unwrap(n.childForFieldName("value"))
    if (v && v.type === "string") names.push({ name: v.text.replace(/^["'`]|["'`]$/g, ""), node: n })
  })
  const seenPairs = new Set<string>()
  for (const a of names) {
    for (const b of names) {
      if (a.name === b.name || a.name.length >= b.name.length) continue
      if (!b.name.includes(a.name)) continue
      const key = `${a.name} ⊂ ${b.name}`
      if (seenPairs.has(key)) continue
      seenPairs.add(key)
      add(a.node, "name-divergence", "violation", key)
    }
  }

  // ---- dominated-trigger: a guard on a member of a set an earlier guard returned on ----
  //
  // TWO corrections here, both forced by reading the accused code rather than trusting
  // the predicate, and both recorded because the first version was wrong in ways that
  // would have put false findings in the register:
  //
  //  1. FUNCTION BOUNDARIES ARE PRUNED. The first version walked later statements
  //     DEEPLY, so a guard in an enclosing function convicted an `if` inside a closure
  //     that is not dominated at all (bash's `emit` arrow, 3 sites). A nested function
  //     may run before the guard, so it can never be dominated by it.
  //  2. THE COMPARISON MUST BE THE GUARD'S OWN IDENTIFIER. The first version matched the
  //     literal anywhere in the later condition, so csharp's
  //     `if (CSHARP_BUILTINS.has(call)) return true` convicted
  //     `if (leaf === "ToString" || ...)` — a DIFFERENT variable (`leaf` is derived from
  //     `call` by a split/pop). 5 false sites. The implication only holds for the
  //     identifier the guard actually tested.
  /** `IDENT === "lit"` / `"lit" === IDENT` in a condition, with the identifier named. */
  const literalComparisons = (cond: any): { ident: string; lit: string }[] => {
    const out: { ident: string; lit: string }[] = []
    walk(cond, (n: any) => {
      if (n.type !== "binary_expression") return
      const op = n.childForFieldName("operator")?.text
      if (op !== "===" && op !== "==") return
      const l = unwrap(n.childForFieldName("left"))
      const r = unwrap(n.childForFieldName("right"))
      const ident = l && l.type === "identifier" ? l.text : r && r.type === "identifier" ? r.text : null
      const str = l && l.type === "string" ? l.text : r && r.type === "string" ? r.text : null
      if (ident && str) out.push({ ident, lit: str.replace(/^["'`]|["'`]$/g, "") })
    })
    return out
  }
  /** A dominated statement that WRITES a framework surface is a detection that can
   *  never fire (the defect); one that merely re-tests is dead control flow (reported). */
  const writeSurfaceIn = (node: any): string | null => {
    let found: string | null = null
    walkNoFn(node, (c: any) => {
      if (found || c.type !== "call_expression") return
      const fn = member(c.childForFieldName("function"))
      if (!fn || !(APPEND_OPS.has(fn.prop) || DEDUPE_OPS.has(fn.prop))) return
      const ref = cleanPath(fn.objText)
      if (surface.refs.has(ref)) found = ref
    })
    return found
  }
  walk(root, (n: any) => {
    const body =
      n.type === "statement_block" ? n : n.type === "arrow_function" && n.childForFieldName("body")?.type === "statement_block" ? n.childForFieldName("body") : null
    if (!body) return
    const guards = dominatingGuards(body)
    if (!guards.length) return
    let seen = false
    for (const st of body.namedChildren ?? []) {
      // Everything strictly after the first early-return guard is dominated.
      if (!seen) {
        if (guards.some((g) => norm(st.text).includes(g.cond))) seen = true
        continue
      }
      walkNoFn(st, (c: any) => {
        if (c.type !== "if_statement") return
        const cond = unwrap(c.childForFieldName("condition"))
        if (!cond) return
        const condText = norm(cond.text)
        const comps = literalComparisons(cond)
        const ref = writeSurfaceIn(st)
        for (const g of guards) {
          const members = containers.get(g.set)
          if (members) {
            for (const cmp of comps) {
              if (cmp.ident !== g.ident) continue
              if (!members.has(cmp.lit)) continue
              add(c, "dominated-trigger", ref ? "violation" : "reported", `${g.set}.has(${g.ident}) ⟹ ${g.ident} === ${JSON.stringify(cmp.lit)}${ref ? ` (writes ${ref})` : ""}`)
            }
          }
          // The identical condition re-tested after a terminating guard.
          if (condText === g.cond && g.ident && condText.includes(g.ident)) {
            add(c, "dominated-trigger", ref ? "violation" : "reported", `${g.ident}: repeated condition${ref ? ` (writes ${ref})` : ""}`)
          }
        }
      })
    }
  })

  // ---- unjustified-claim + missing-contract-key (file-level) ----
  // SCOPE, deliberately narrow. The three-key contract is about framework DETECTION,
  // so it binds an analyzer that runs a surface — one that publishes a collection
  // (detectedFrameworks / frameworkPatterns), makes a capability claim, or writes an
  // accumulator. A format analyzer that emits a scalar `framework: "YAML"` label
  // runs no surface and is NOT in scope. Without this the census convicted ~20
  // analyzers for omitting keys they never claimed — which is the failure mode R7's
  // own header records (#873 reported 8 analyzers when 2 were real).
  const publishedKeys = publishedKeysOf(root, surface.meta)
  const claims: any[] = []
  for (const lit of surface.meta.literals) {
    for (const p of lit.namedChildren ?? []) {
      if (p.type !== "pair") continue
      const k = unwrap(p.childForFieldName("key"))?.text?.replace(/^["'`]|["'`]$/g, "")
      if (k && CAPABILITY_KEYS.has(k) && unwrap(p.childForFieldName("value"))?.text === "true") claims.push(p)
    }
  }
  walk(root, (n: any) => {
    if (n.type !== "assignment_expression") return
    const m = member(n.childForFieldName("left"))
    if (!m || !surface.meta.holders.has(cleanPath(m.objText))) return
    if (CAPABILITY_KEYS.has(m.prop) && unwrap(n.childForFieldName("right"))?.text === "true") claims.push(n)
  })
  // IN SCOPE = the file CLAIMS the collection contract (or the capability). A file that
  // publishes only a scalar `framework: "Zig"` label runs no detection surface and is
  // out of scope, even if it builds an array internally: it never claimed the keys.
  const inScope = publishedKeys.has("detectedFrameworks") || publishedKeys.has("frameworkPatterns") || claims.length > 0

  if (inScope) {
    if (deadMembers.size && claims.length) {
      for (const c of claims) add(c, "unjustified-claim", "violation", [...deadMembers].join(","))
    }
    for (const k of CONTRACT_KEYS) {
      if (publishedKeys.has(k)) continue
      sites.push({
        file,
        lang,
        line: 1,
        shape: "missing-contract-key",
        key: `${k} (published: ${[...publishedKeys].sort().join(", ") || "none"})`,
        statement: `metadata omits the contract key ${k}`,
        verdict: "violation",
      })
    }
  }

  // One site per (line, shape, key): two guards can imply the same dominated statement,
  // and a register holding the same finding twice is noise, not evidence.
  const deduped = new Map<string, SurfaceSite>()
  for (const s of sites) deduped.set(`${s.line}\u0000${s.shape}\u0000${s.key}`, s)
  return {
    scan: {
      sites: [...deduped.values()],
      bindingsExamined: surface.refs.size,
      publishedContractKeys: [...publishedKeysOf(root, surface.meta)].sort(),
    },
    parseError: false,
  }
}

async function makeParser(): Promise<any> {
  const wts: any = WTS
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const language = await L.load(readFileSync(path.join(WASM_DIR, "tree-sitter-typescript.wasm")))
  const parser = new P()
  parser.setLanguage(language)
  return parser
}

export async function census(root: string = ROOT, parser?: any): Promise<SurfaceCensus> {
  const p = parser ?? (await makeParser())
  const dir = path.join(root, "src/ast")
  const files = readdirSync(dir).filter((f) => /^real-.*-analyzer\.ts$/.test(f)).sort()
  const sites: SurfaceSite[] = []
  const parseErrors: string[] = []
  const unexamined: string[] = []
  let bindingsExamined = 0
  for (const f of files) {
    const src = readFileSync(path.join(dir, f), "utf8")
    const r = scanFile(p, f, src)
    if (r.parseError) { parseErrors.push(f); continue }
    sites.push(...r.scan.sites)
    bindingsExamined += r.scan.bindingsExamined
    // A file that NAMES a contract key but publishes none the classifier can read is not
    // "clean", it is NOT EXAMINED — both print zero violations, and that is how a lane
    // goes blind without anyone noticing. Measured, not hypothetical: an earlier version
    // of the objective-c fix wrapped the metadata literal in an IIFE, and
    // `collectMetadata` recognises a metadata VALUE only as an object literal, so the
    // lane dropped out of adjudication entirely. R8 refuses to adjudicate while this list
    // is non-empty (below), which converts a silent blind spot into a loud one.
    //
    // The key-name test here is TEXT-level on purpose: it is the COHORT SELECTOR (which
    // files merit examination), not a verdict. Every verdict stays structural, which is
    // what keeps ruby's `frameworkPatterns.push({ framework: "Rails" })` from being read
    // as publication.
    if (!r.scan.publishedContractKeys.length && /detectedFrameworks|frameworkPatterns|hasFrameworkIntelligence/.test(src)) {
      unexamined.push(f)
    }
  }
  const byShape: Record<string, number> = {}
  const byVerdict: Record<string, number> = {}
  const byLanguage: Record<string, { violations: number; safe: number; reported: number; publishesContract: boolean }> = {}
  for (const s of sites) {
    byShape[s.shape] = (byShape[s.shape] ?? 0) + 1
    byVerdict[s.verdict] = (byVerdict[s.verdict] ?? 0) + 1
    const row = (byLanguage[s.lang] ??= { violations: 0, safe: 0, reported: 0, publishesContract: false })
    if (s.verdict === "violation") row.violations++
    else if (s.verdict === "safe") row.safe++
    else row.reported++
    if (s.shape !== "unclassified") row.publishesContract = true
  }
  return { files: files.length, occurrences: sites.length, parseErrors, unexamined, byShape, byVerdict, byLanguage, bindingsExamined, sites }
}

// ============================================================================
// Self-tests: the classifier must discriminate, or its census means nothing.
// ============================================================================
// Each case is a real analyzer shape. `expect` lists the shapes the scan MUST
// return for that source, in any order — and a case that returns an extra shape
// fails, so a predicate that fires on everything is caught here rather than in a
// register nobody can read.
const SELF_TESTS: { name: string; src: string; expect: SurfaceShape[]; expectKeys?: string[] }[] = [
  // --- dead surface (python #747's shape) ---
  {
    name: "a surface read into a contract key and never written is dead",
    src: `function a(ctx: any) {\n  const detectedFrameworks: string[] = []\n  for (const k in ctx.frameworks) detectedFrameworks.push(k)\n  return { metadata: { framework: detectedFrameworks[0], detectedFrameworks, frameworkPatterns: [] } }\n}`,
    expect: ["dead-surface", "append-write"],
  },
  {
    name: "the same surface with ONE write is live, not dead",
    src: `function a(ctx: any) {\n  const detectedFrameworks: string[] = []\n  ctx.frameworks["Django"] = true\n  for (const k in ctx.frameworks) detectedFrameworks.push(k)\n  return { metadata: { framework: detectedFrameworks[0], detectedFrameworks, frameworkPatterns: [] } }\n}`,
    expect: ["append-write"],
  },
  // --- the holder form (ruby #749's shape: a `metadata` object whose members are pushed) ---
  {
    name: "a holder object's member is the surface, and its pushes are append-writes",
    src: `function a() {\n  const metadata: any = { detectedFrameworks: [], frameworkPatterns: [], framework: undefined }\n  metadata.detectedFrameworks!.push("Ruby on Rails")\n  metadata.detectedFrameworks!.push("Ruby on Rails")\n  return { metadata }\n}`,
    expect: ["append-write", "append-write"],
  },
  {
    name: "a holder object's member is written through the non-null assertion, one surface",
    src: `function a() {\n  const metadata: any = { detectedFrameworks: [], frameworkPatterns: [], framework: undefined }\n  metadata.detectedFrameworks!.push("Ruby on Rails")\n  metadata.frameworkPatterns!.push({ framework: "Rails", patterns: ["Callbacks"] })\n  return { metadata }\n}`,
    expect: ["append-write", "append-write", "name-divergence"],
  },
  // --- accumulator discipline ---
  {
    name: "a Set write dedupes and is safe",
    src: `function a() {\n  const detectedFrameworks = new Set<string>()\n  detectedFrameworks.add("Laravel")\n  return { metadata: { framework: [...detectedFrameworks][0], detectedFrameworks: [...detectedFrameworks], frameworkPatterns: [] } }\n}`,
    expect: ["deduped-write"],
    expectKeys: ["detectedFrameworks", "framework", "frameworkPatterns"],
  },
  {
    // The shape that made a lane go blind: `collectMetadata` recognises a metadata VALUE
    // only as an object literal, so an IIFE (or any helper call) publishes keys the
    // classifier cannot read. The sites are empty either way — which is the whole problem
    // — so the pin is on the KEYS, and the census-level `unexamined` list turns the empty
    // result into a refusal to adjudicate instead of a clean row.
    name: "an IIFE-wrapped metadata literal publishes no readable contract key",
    src: `function a() {\n  const frameworks = new Set<string>()\n  frameworks.add("UIKit")\n  return { metadata: (() => ({ detectedFrameworks: [...frameworks], framework: [...frameworks][0], frameworkPatterns: [] }))() }\n}`,
    expect: [],
    expectKeys: [],
  },
  {
    // The same publication through the shape every repaired lane uses: locals feeding an
    // INLINE literal. The keys are read, and the accumulator stays visible through the
    // spread, so the Set's write is still classified.
    name: "locals feeding an inline metadata literal keep the keys AND the surface",
    src: `function a() {\n  const frameworks = new Set<string>()\n  frameworks.add("UIKit")\n  const detectedFrameworks: string[] = [...frameworks]\n  detectedFrameworks.sort((x, y) => (x < y ? -1 : 1))\n  return { metadata: { detectedFrameworks, framework: detectedFrameworks[0], frameworkPatterns: detectedFrameworks.map((f) => ({ framework: f, patterns: [] })) } }\n}`,
    expect: ["deduped-write"],
    expectKeys: ["detectedFrameworks", "framework", "frameworkPatterns"],
  },
  {
    name: "an array push is the duplication class",
    src: `function a() {\n  const detectedFrameworks: string[] = []\n  detectedFrameworks.push("Ruby on Rails")\n  return { metadata: { framework: detectedFrameworks[0], detectedFrameworks, frameworkPatterns: [] } }\n}`,
    expect: ["append-write"],
  },
  {
    name: "a push guarded by an absence test on the same value cannot duplicate",
    src: `function a() {\n  const detectedFrameworks: string[] = []\n  const name = "Ruby on Rails"\n  if (!detectedFrameworks.includes(name)) detectedFrameworks.push(name)\n  return { metadata: { framework: detectedFrameworks[0], detectedFrameworks, frameworkPatterns: [] } }\n}`,
    expect: ["deduped-guard"],
  },
  {
    name: "a guard on a DIFFERENT value does not launder the push",
    src: `function a() {\n  const detectedFrameworks: string[] = []\n  const other = "x"\n  if (!detectedFrameworks.includes(other)) detectedFrameworks.push("Ruby on Rails")\n  return { metadata: { framework: detectedFrameworks[0], detectedFrameworks, frameworkPatterns: [] } }\n}`,
    expect: ["append-write"],
  },
  {
    name: "a write through a local alias of the surface is the surface's write",
    src: `function a() {\n  const metadata: any = { detectedFrameworks: [], frameworkPatterns: [], framework: undefined }\n  const detected = metadata.detectedFrameworks\n  detected.push("Ruby on Rails")\n  return { metadata }\n}`,
    expect: ["append-write"],
  },
  {
    name: "a write through an alias, guarded on that alias, is deduped",
    src: `function a() {\n  const metadata: any = { detectedFrameworks: [], frameworkPatterns: [], framework: undefined }\n  const detected = metadata.detectedFrameworks\n  const name = "Ruby on Rails"\n  if (!detected.includes(name)) detected.push(name)\n  return { metadata }\n}`,
    expect: ["deduped-guard"],
  },
  {
    name: "an absence test over a predicate is a dedupe guard",
    src: `function a() {\n  const metadata: any = { detectedFrameworks: [], frameworkPatterns: [], framework: undefined }\n  const patterns = metadata.frameworkPatterns\n  if (!patterns.some((p: any) => p.framework === "Rails")) patterns.push({ framework: "Rails" })\n  return { metadata }\n}`,
    expect: ["deduped-guard"],
  },
  {
    name: "a holder member assigned through ??= publishes the key",
    src: `function a(metadata: any) {\n  metadata.framework ??= "Django"\n  metadata.detectedFrameworks = ["Django"]\n  metadata.frameworkPatterns = []\n  return { metadata }\n}`,
    expect: [],
  },
  // --- name divergence ---
  {
    name: "one framework under two names is a divergence",
    src: `function a() {\n  const detectedFrameworks: string[] = []\n  detectedFrameworks.push("Ruby on Rails")\n  const frameworkPatterns = [{ framework: "Rails", patterns: ["Callbacks"] }]\n  return { metadata: { framework: detectedFrameworks[0], detectedFrameworks, frameworkPatterns } }\n}`,
    expect: ["append-write", "name-divergence"],
  },
  {
    name: "two unrelated framework names are NOT a divergence",
    src: `function a() {\n  const detectedFrameworks: string[] = []\n  detectedFrameworks.push("Symfony")\n  detectedFrameworks.push("Laravel")\n  return { metadata: { framework: detectedFrameworks[0], detectedFrameworks, frameworkPatterns: [] } }\n}`,
    expect: ["append-write", "append-write"],
  },
  // --- dominated trigger (ruby #749's shape) ---
  {
    name: "a guard on a set member an earlier guard returned on is dominated",
    src: `const MACROS = new Set(["before_action", "has_many"])\nfunction a(methodName: string) {\n  if (MACROS.has(methodName)) {\n    return\n  }\n  if (methodName === "before_action") {\n    detect()\n  }\n}`,
    expect: ["dominated-trigger"],
  },
  {
    name: "a guard on a NON-member is not dominated",
    src: `const MACROS = new Set(["before_action", "has_many"])\nfunction a(methodName: string) {\n  if (MACROS.has(methodName)) {\n    return\n  }\n  if (methodName === "render") {\n    detect()\n  }\n}`,
    expect: [],
  },
  {
    name: "a guard tested BEFORE the early return is not dominated",
    src: `const MACROS = new Set(["before_action"])\nfunction a(methodName: string) {\n  if (methodName === "before_action") {\n    detect()\n  }\n  if (MACROS.has(methodName)) {\n    return\n  }\n}`,
    expect: [],
  },
  {
    name: "a return nested in an if does not dominate",
    src: `const MACROS = new Set(["before_action"])\nfunction a(methodName: string, flag: boolean) {\n  if (MACROS.has(methodName)) {\n    if (flag) {\n      return\n    }\n  }\n  if (methodName === "before_action") {\n    detect()\n  }\n}`,
    expect: [],
  },
  // --- claim + contract keys ---
  {
    name: "a capability claim over a dead surface is unjustified",
    src: `function a(ctx: any) {\n  const detectedFrameworks: string[] = []\n  for (const k in ctx.frameworks) detectedFrameworks.push(k)\n  return { metadata: { framework: detectedFrameworks[0], detectedFrameworks, frameworkPatterns: [], hasFrameworkIntelligence: true } }\n}`,
    expect: ["dead-surface", "append-write", "unjustified-claim"],
  },
  {
    name: "a capability claim over a live surface is justified",
    src: `function a(ctx: any) {\n  const detectedFrameworks = new Set<string>()\n  detectedFrameworks.add("Django")\n  return { metadata: { framework: [...detectedFrameworks][0], detectedFrameworks: [...detectedFrameworks], frameworkPatterns: [], hasFrameworkIntelligence: true } }\n}`,
    expect: ["deduped-write"],
  },
  {
    name: "omitting the primary pick is a missing contract key",
    src: `function a() {\n  const detectedFrameworks = new Set<string>()\n  detectedFrameworks.add("Django")\n  return { metadata: { detectedFrameworks: [...detectedFrameworks], frameworkPatterns: [] } }\n}`,
    expect: ["deduped-write", "missing-contract-key"],
  },
  {
    name: "a file with no framework surface at all is not a site",
    src: `function a() {\n  const symbols: any[] = []\n  return { symbols }\n}`,
    expect: [],
  },
  {
    name: "prose in a comment is not a site",
    src: `// detectedFrameworks is always an array, and framework is the primary pick\nfunction a() {\n  return { metadata: {} }\n}`,
    expect: [],
  },
]

export interface SelfTestResult { cases: number; failures: string[] }

export function selfTest(parser: any): SelfTestResult {
  const failures: string[] = []
  for (const t of SELF_TESTS) {
    const { scan, parseError } = scanFile(parser, "self-test.ts", t.src)
    if (parseError) { failures.push(`${t.name}: probe did not parse`); continue }
    const got = scan.sites.map((s) => s.shape).sort()
    const want = [...t.expect].sort()
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      failures.push(`${t.name}: expected [${want.join(", ")}], got [${got.join(", ")}]`)
    }
    // The binding half: a case may also pin WHICH contract keys the classifier read, so
    // "this file is clean" cannot come from "this file was never examined".
    if (t.expectKeys) {
      const keys = scan.publishedContractKeys
      const wanted = [...t.expectKeys].sort()
      if (JSON.stringify(keys) !== JSON.stringify(wanted)) {
        failures.push(`${t.name}: expected published keys [${wanted.join(", ")}], got [${keys.join(", ")}]`)
      }
    }
  }
  return { cases: SELF_TESTS.length, failures }
}

async function main() {
  const parser = await makeParser()
  const c = await census(ROOT, parser)
  const st = selfTest(parser)
  const violations = c.sites.filter((s) => s.verdict === "violation")
  console.log(`framework-surface census: ${c.occurrences} site(s) in ${c.files} analyzers; ${violations.length} violation(s); ${c.bindingsExamined} contract binding(s) examined`)
  console.log(`  byShape:   ${JSON.stringify(c.byShape)}`)
  console.log(`  byVerdict: ${JSON.stringify(c.byVerdict)}`)
  for (const [lang, v] of Object.entries(c.byLanguage).sort()) {
    if (v.violations) console.log(`  ${lang}: violations=${v.violations} safe=${v.safe}`)
  }
  console.log("  --- violations ---")
  for (const s of violations) console.log(`    ${s.file}:${s.line} ${s.shape} [${s.key}] ${s.statement.slice(0, 110)}`)
  if (c.parseErrors.length) console.log(`  parseErrors: ${c.parseErrors.join(", ")}`)
  console.log(`  self-tests: ${st.cases - st.failures.length}/${st.cases} passed`)
  for (const f of st.failures) console.log(`    FAIL: ${f}`)
  if (process.argv.includes("--emit")) {
    mkdirSync(path.dirname(OUT), { recursive: true })
    writeFileSync(
      OUT,
      JSON.stringify(
        {
          gate: "M60.R8",
          at: new Date().toISOString(),
          method:
            "tree-sitter walk over src/ast/real-*-analyzer.ts. The family contract's metadata keys are declared (framework, detectedFrameworks, frameworkPatterns) and the capability key (hasFrameworkIntelligence); every other determination is structural — which bindings a file publishes under a contract key, which member reads feed them (one hop), which write operator is applied to an accumulator, which same-file constant containers exist, which guards terminate, and which name literals write a framework. Comments are not string nodes, so prose cannot be counted; `unclassified` is a reported shape, never a silent drop.",
          files: c.files,
          occurrences: c.occurrences,
          violations: violations.length,
          bindingsExamined: c.bindingsExamined,
          parseErrors: c.parseErrors,
          unexamined: c.unexamined,
          byShape: c.byShape,
          byVerdict: c.byVerdict,
          byLanguage: c.byLanguage,
          scope: "a file is IN SCOPE when it publishes detectedFrameworks or frameworkPatterns, or makes a capability claim; a framework-only scalar label is out of scope. `unexamined` lists files that name a contract key while publishing none the classifier can read — the gate refuses to adjudicate on those rather than reading them as clean",
          selfTests: { cases: st.cases, passed: st.cases - st.failures.length, failures: st.failures },
          sites: c.sites,
        },
        null,
        2,
      ) + "\n",
    )
    console.log(`  -> ${path.relative(ROOT, OUT)}`)
  }
  if (st.failures.length) process.exit(2)
}

if (process.argv[1] && path.basename(process.argv[1]) === "framework-surface-census.ts") {
  main()
}
