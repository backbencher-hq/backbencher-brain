import type { Node } from "web-tree-sitter"
import { ASTEngine } from "./engine"

/**
 * Z11 (deep review, 2026-09-28) — the KIND of a container-scope `const`, decided
 * by the grammar's node type rather than by the shape of the name alone.
 *
 * The previous dispatch had one value test (`integer`/`float`/`string`/
 * `boolean`/`character`/`builtin_type` → Constant) and then fell through to
 * "an upper-case name is a Type alias". Two measured classes came out of that,
 * over the three pinned corpora (3,839 files, `script/m14/tmp/zigw-kinds.ts`):
 *
 *   - a VALUE expression with an upper-case name became a `Type`:
 *     `binary_expression` 838, `unary_expression` 39,
 *     `null_coercion_expression` 18, `anonymous_struct_initializer` 22,
 *     `index_expression` 4, `catch_expression` 4, `block` 9, plus
 *     `multiline_string`/`error_type` — `pub const DockSpace = 1 << 10;` is a
 *     Constant, not a Type;
 *   - a TYPE alias became a value: `builtin_type` 440 (160 of them upper-case),
 *     `pointer_type` 55, `nullable_type` 31, `array_type` 10 — `const Pos =
 *     c_long;` is a Type, not a Constant.
 *
 * The rule below is the honest one: a node type that CAN be a type makes the
 * declaration a Type; a node type that CANNOT be a type makes it a value; and
 * only the genuinely two-sided forms (`identifier`, `field_expression`,
 * `call_expression`, `if_expression`, `switch_expression`,
 * `struct_initializer`, `parenthesized_expression`, `builtin_function`) keep the
 * name heuristic, which is also the pinned `pub const B = A` contract.
 */
const ZIG_TYPE_RHS = new Set([
  "builtin_type", "pointer_type", "slice_type", "array_type", "nullable_type",
  "error_union_type", "anyframe_type", "opaque_declaration", "function_signature",
])

/** The container-declaration node types. A container is only a CONTAINER when it
 *  is a declaration's right-hand side; the same node in an expression position
 *  is anonymous and can own nothing (see the ANONYMOUS CONTAINER branch). */
const ANONYMOUS_CONTAINER_NODES = new Set([
  "struct_declaration", "union_declaration", "enum_declaration",
  "error_set_declaration", "opaque_declaration",
])

/** Node types the pinned lexer produces for an enum member's NAME when that
 *  name happens to spell a Zig primitive type or keyword literal. Zig has no
 *  reserved words, so `pub const Feature = enum { bool, clamps }` and
 *  `pub const SimpleValue = enum { undefined, null, true, ... }` are ordinary
 *  declarations whose names the lexer classifies by what they MEAN rather than
 *  by their grammatical role. Every entry is measured — see the container_field
 *  name site for the census that produced these four and the enum gate that
 *  keeps the same token refused where it IS a type (a tuple struct's element). */
const ENUM_MEMBER_NAME_NODE_TYPES: ReadonlySet<string> = new Set([
  "builtin_type", "boolean", "null", "undefined",
])

const ZIG_VALUE_RHS = new Set([
  "integer", "float", "string", "multiline_string", "boolean", "character",
  "binary_expression", "unary_expression", "null_coercion_expression",
  "index_expression", "catch_expression", "block", "initializer_list",
  "range_expression", "assignment_expression", "error_type",
  "anonymous_struct_initializer", "dereference_expression",
])

/**
 * The type names a declared-type reference must never carry: Zig's builtin
 * types, `anytype`/`comptime_*`/`noreturn`/`type`, the C ABI types, and the two
 * keywords that spell a type context (`error`, `test`).
 *
 * EXPORTED because the differential oracle (Z14) needs the same vocabulary and
 * must not re-type it: a second copy is a second answer to "is this a type
 * name", and two copies that cancel out of every count is how a self-agreeing
 * edge survives a year of gates (the #916 lesson, applied to zig). The oracle
 * still derives every POSITION and every LEAF from the tree on its own.
 */
/** Z57: the names this file declares at FILE SCOPE, derived from the tree and
 *  memoised per root. Function-LOCALS are excluded on purpose: a local does not
 *  shadow a builtin type, only a file-scope declaration is visible to a type
 *  annotation written elsewhere in the file. */
const ZIG_FILE_SCOPE_NAMES = new WeakMap<object, Set<string>>()
export function zigFileScopeNames(root: Node): Set<string> {
  const cached = ZIG_FILE_SCOPE_NAMES.get(root as unknown as object)
  if (cached) return cached
  const BARRIERS = new Set([
    "function_declaration", "test_declaration", "block", "if_statement", "if_expression",
    "for_statement", "for_expression", "while_statement", "while_expression",
    "switch_statement", "switch_expression", "catch_expression", "defer_statement",
    "expression_statement", "comptime_statement", "errdefer_statement",
  ])
  const out = new Set<string>()
  const stack: Node[] = [root]
  let guard = 0
  while (stack.length > 0 && guard++ < 400000) {
    const n = stack.pop()!
    if (n.type === "variable_declaration" || n.type === "function_declaration" || n.type === "container_field") {
      const c0 = n.namedChildCount > 0 ? n.namedChild(0) : null
      // `field_identifier` was here for one commit and the F1 grammar audit caught it
      // on the next run: it is NOT a node type in the pinned grammar (Z45), so the
      // disjunct is dead -- and I had reintroduced the very leftover Z45 removed, in
      // the very gate that reports such leftovers. A dead disjunct reads like coverage
      // of a case that cannot occur, which is why the audit exists and why it runs.
      if (c0 && c0.type === "identifier") {
        let q: Node | null = n.parent
        let fileScope = true
        let hops = 0
        while (q && hops++ < 40) { if (BARRIERS.has(q.type)) { fileScope = false; break } q = q.parent }
        if (fileScope) out.add(stripZigQuoting(c0.text))
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) stack.push(c) }
  }
  ZIG_FILE_SCOPE_NAMES.set(root as unknown as object, out)
  return out
}

/**
 * Z66 — the local name an `@import` BINDS, which is a different fact from the
 * module path the import NAMES, and which this analyzer was discarding.
 *
 * ## The defect
 *
 * `const std = @import("std");` is the commonest binding form in Zig. The
 * `imports`/`references` twins of `collectZigImportSites` record the MODULE PATH
 * (`std`) with source `(global)`; nothing recorded WHICH LOCAL NAME it was
 * assigned to. Every read through that alias therefore reached the edge layer as a
 * bare leaf — `std.mem.Allocator` published `uses -> Allocator`, `std.debug.print`
 * published `calls -> print` — so an external module member and a same-named
 * local declaration became the SAME edge target. Measured by
 * `validation/m14/fixtures/zig/alias-receiver-probe.ts` over 300 corpus files and
 * production `parseFile`: of 18,612 distinct (`uses`|`calls`|`references`)
 * (source, target) pairs, 3,688 (20%) name the leaf of a dotted path rooted at an
 * `@import` of a bare module path, and 1,009 of those carry a leaf that some
 * declaration in the window publishes — so they resolve today, to the wrong
 * declaration, and `brain_relationship`'s `misattached` measure cannot see them
 * because it only fires when the attached symbol's name DIFFERS from the leaf.
 *
 * ## The two refusals, both deliberate
 *
 *  - A name bound by `@import` somewhere in the file AND bound to a NON-import
 *    right-hand side somewhere in the file is DELETED from the map. A shadowed
 *    alias means `std.foo` need not be a module member at all, and this analyzer
 *    does not model which binding wins at which site; refusing to qualify is the
 *    only answer that cannot publish a path the source does not contain.
 *  - A module path that is RELATIVE, absolute, or carries a separator or a `.zig`
 *    / `.zon` suffix is recorded as `external: false` and never qualified. `const c
 *    = @import("c.zig")` names a file in this project; qualifying its reads would
 *    replace a leaf that binds today with a path nothing in the index publishes.
 */
type ZigImportAlias = { module: string; external: boolean }

const ZIG_IMPORT_ALIASES = new WeakMap<object, Map<string, ZigImportAlias>>()

export function zigImportAliases(root: Node): Map<string, ZigImportAlias> {
  const cached = ZIG_IMPORT_ALIASES.get(root as unknown as object)
  if (cached) return cached
  const imports = new Map<string, ZigImportAlias>()
  /** names this file also binds to something that is not an import — the refuse set */
  const shadowed = new Set<string>()
  const stack: Node[] = [root]
  let guard = 0
  while (stack.length > 0 && guard++ < 400000) {
    const n = stack.pop()!
    if (n.type === "variable_declaration") {
      const kids = zigNamedChildren(n)
      const nameNode = kids.length > 0 && kids[0]!.type === "identifier" ? kids[0]! : null
      const rhs = kids.length > 0 ? kids[kids.length - 1]! : null
      const bound = nameNode ? stripZigQuoting(nameNode.text) : ""
      if (bound) {
        const lit = zigImportModuleLiteral(rhs)
        if (lit) imports.set(bound, { module: lit.module, external: zigModuleIsExternal(lit.module) })
        else shadowed.add(bound)
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) stack.push(c) }
  }
  for (const s of shadowed) imports.delete(s)
  ZIG_IMPORT_ALIASES.set(root as unknown as object, imports)
  return imports
}

/** A bare module path names something outside the project by construction; a
 *  path with a separator or a file suffix names a file in it. */
function zigModuleIsExternal(modulePath: string): boolean {
  if (modulePath.startsWith(".") || modulePath.startsWith("/")) return false
  if (modulePath.includes("/") || modulePath.includes("\\")) return false
  if (modulePath.endsWith(".zig") || modulePath.endsWith(".zon")) return false
  return true
}

/** The string module path of an `@import`/`@cImport` right-hand side, with the
 *  literal node itself, or null. ONE copy of this walk: `collectZigImportSites`
 *  and `zigImportAliases` both read it, because two copies of "how do I spell the
 *  path" is two answers. The NODE is returned because it is the only place the
 *  literal is, and the `imports` edge's site line is the literal's line. */
function zigImportModuleLiteral(rhs: Node | null): { module: string; node: Node } | null {
  if (!rhs) return null
  const host = rhs.type === "call_expression" || rhs.type === "builtin_function" ? rhs : null
  if (!host) return null
  let isImport = false
  for (let i = 0; i < host.namedChildCount; i++) {
    const c = host.namedChild(i)
    if (c && (c.type === "builtin_identifier" || c.type === "identifier")) {
      const t = String(c.text ?? "")
      if (t === "@import" || t === "@cImport" || t === "import") { isImport = true; break }
    }
  }
  if (!isImport) return null
  const firstString = (h: Node | null): Node | null => {
    if (!h) return null
    for (let i = 0; i < h.namedChildCount; i++) {
      const c = h.namedChild(i)
      if (c && (c.type === "string" || c.type === "string_content")) return c
    }
    return null
  }
  let args: Node | null = null
  for (let i = 0; i < host.namedChildCount; i++) {
    const c = host.namedChild(i)
    if (c && c.type === "arguments") { args = c; break }
  }
  let strNode = firstString(host) ?? firstString(args)
  if (strNode && strNode.type === "string") {
    for (let i = 0; i < strNode.namedChildCount; i++) {
      const sc = strNode.namedChild(i)
      if (sc && sc.type === "string_content") { strNode = sc; break }
    }
  }
  if (!strNode) return null
  let out = String(strNode.text ?? "")
  if (
    (out.startsWith('"') && out.endsWith('"')) ||
    (out.startsWith("'") && out.endsWith("'"))
  ) out = out.substring(1, out.length - 1)
  return out.length > 0 ? { module: out, node: strNode } : null
}

/** A module-level child reader, so the exported alias builder above can walk a
 *  tree without an analyzer instance. */
function zigNamedChildren(n: Node): Node[] {
  const out: Node[] = []
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c) out.push(c)
  }
  return out
}

export const ZIG_DECLARED_TYPE_BUILTINS: ReadonlySet<string> = new Set([
  "void", "bool", "f16", "f32", "f64", "f80", "f128", "c_longdouble",
  "i8", "i16", "i32", "i64", "i128", "isize", "u8", "u16", "u32", "u64", "u128", "usize",
  "anytype", "comptime_int", "comptime_float", "noreturn", "type", "anyerror",
  "c_char", "c_short", "c_int", "c_long", "c_longlong", "c_uint", "c_ulong", "c_ulonglong", "c_void",
  "error", "test",
])

/**
 * REAL ZIG ANALYZER v6.0 — declaration-site-only extraction.
 *
 * Grounded in the verified tree-sitter-zig AST shape:
 *   - Top-level and container-level `variable_declaration` nodes carry the
 *     container kinds: `const X = struct {...}`, `enum {...}`, `union(enum) {...}`,
 *     `error{...}`, or plain constants/type aliases.
 *   - `container_field` nodes are struct/union members (→ Property) or enum
 *     members (→ EnumMember).
 *   - `function_declaration` nodes are Methods inside containers, Functions at
 *     file scope.
 *   - Control-flow, type-annotation, call, block, and field-access nodes are
 *     EXECUTION ARTIFACTS, not declaration sites — they never become symbols.
 */
/**
 * M60 (#924, zig half): quoting syntax is not part of an identifier's NAME.
 * `fn @"weird function name"() i32` declares the identifier
 * `weird function name`; `@"…"` is zig's escape for a name that cannot be spelled
 * plainly. The grammar puts BOTH tokens inside one `identifier` node (a `@"` token
 * plus a string), so the node's text carries the sigil and the name is its CONTENT —
 * the same rule the swift and kotlin halves apply to their backticks, measured the
 * same way: before the fix the census's own samples publish `@"zls env"`, `@"fn"`
 * and `@"weird function name"` as a function name, a `calls` target and a `uses`
 * target (script/m14/tmp/c924-name-surface-probe.ts). An unterminated `@"` is
 * malformed source, not a name: it is kept verbatim.
 */
export function stripZigQuoting(text: string): string {
  if (!text.includes('@"')) return text
  let out = ""
  let i = 0
  while (i < text.length) {
    if (text.charCodeAt(i) === 64 && text[i + 1] === '"') {
      const close = text.indexOf('"', i + 2)
      if (close === -1) {
        out += text.slice(i)
        break
      }
      out += text.slice(i + 2, close)
      i = close + 1
    } else {
      out += text[i]
      i++
    }
  }
  return out
}

/**
 * A symbol as the walk carries it, plus the ONE internal field this analyzer
 * needs and the projection must never publish.
 *
 * `zigOwnerPath` is the container's ABSOLUTE dotted path — the same string the
 * shared projection builds as that container's `qualifiedName`. It is read only
 * to spell a member's own owner; `pool-worker.ts:926-946` copies an explicit
 * field list, so an extra key here is invisible to everything downstream.
 */
type ZigWalkSymbol = ASTEngine.UniversalSymbol & { zigOwnerPath?: string }

/**
 * The owner's ABSOLUTE dotted path, falling back to its bare name for a
 * file-scope container — where the two are the same string, which is why this
 * is a no-op for every top-level container and its members.
 *
 * ## Why the path, and not the bare name (Z-p22)
 *
 * `scope`/`ownerName` were `container.name`, and the projection spells a symbol
 * `scope ? scope + "." + name : name` (pool-worker.ts:930). A container
 * therefore published its ABSOLUTE name and its members published a RELATIVE
 * one, so the two halves of one nesting landed in two coordinate systems:
 *
 * ```zig
 * pub const IOSurface = struct {      // ghostty/pkg/macos/iosurface/iosurface.zig:10
 *     pub const Error = error{         // container -> qn `IOSurface.Error`
 *         InvalidOperation,            // member    -> qn `Error.InvalidOperation`
 * ```
 *
 * The member is then unreachable from the only spelling that identifies its
 * container, and the `contains` edge names a source that is not a published
 * qualified name at all. Measured over the 3,834-file draw before this change:
 * **15,686 of 80,876 `contains` edges (19.4%)** were not composition-resolvable
 * (owner-path-probe.ts), in 529 files. Carrying the absolute path makes the
 * edge's source a published `qualifiedName` and makes `source + "." + target`
 * the member's own published spelling, which is the walk the graph performs.
 *
 * Components are stripped at CONSTRUCTION rather than left to
 * `canonicalizePublishedNames`, because that pass strips `ownerName` but not
 * `scope` — a raw `@"my type"` component would leave the container spelling
 * `my type` and the member `@"my type".field`, the same split this change
 * removes.
 */
function ownerPathOf(container: ZigWalkSymbol | null): string | undefined {
  if (!container) return undefined
  return container.zigOwnerPath ?? container.name
}

/**
 * A member's own PUBLISHED spelling — `scope ? scope + "." + name : name`, the
 * exact expression the shared projection applies when it fills `qualifiedName`
 * (`pool-worker.ts:997`), with `scope` being this symbol's `ownerName`
 * (`mkSymbol`: `scope: ownerName ?? undefined`).
 *
 * ## Why ONE function and not the expression repeated
 *
 * Because this analyzer has already paid for getting it wrong. Z-p22 fixed the
 * SOURCE half of a `contains` edge — the owner path — and left the TARGET half
 * spelling a bare member name, so the two halves of one edge lived in two
 * coordinate systems and the target matched no published `qualified_name` at all.
 * M60 cause A fixed the target half, and the `contains` endpoint alias table in
 * `annotateTargetScope` then had to be taught the same spelling or the three
 * `meta.targetScope: file-local` fixtures read `file-external` — three sites
 * disagreeing about one string.
 *
 * So the expression lives here, once, and both the emitter and the alias table
 * call it. A site that needs it a third time should call this rather than
 * re-derive it, because the failure mode is silent: the edge still emits, it just
 * resolves to nothing, which reads as a corpus fact rather than a spelling bug.
 *
 * NOTE this is called BEFORE `canonicalizePublishedNames` runs, so `name` may
 * still carry `@"…"` quoting while `ownerName` is already stripped (it is built
 * per component). That is deliberate and it is what keeps the two sites equal:
 * the emitter and the alias table run at the same point in the pipeline, so both
 * see the same spelling and agree. The later stripping pass then rewrites both
 * sides identically.
 */
function publishedSpelling(s: { name?: string | null; ownerName?: string | null }): string {
  const name = String(s.name ?? "")
  const owner = s.ownerName
  return owner ? `${owner}.${name}` : name
}

export class RealZigAnalyzer implements ASTEngine.LanguageAnalyzer {
  public analyze(rootNode: Node, content: string, filePath: string): ASTEngine.ParseResult {
    const symbols: ASTEngine.UniversalSymbol[] = []
    const relationships: ASTEngine.UniversalRelationship[] = []
    const imports: ASTEngine.ImportInfo[] = []
    const exports: ASTEngine.ExportInfo[] = []
    const errors: ASTEngine.ParseError[] = []

    // Walk context: node + the nearest enclosing declaration context.
    // Context is null (file scope), a container symbol (struct/enum/union), or
    // a function symbol (whose body must not produce declaration symbols).
    // `anonContainer` marks a subtree that sits inside a container declaration
    // reached as an EXPRESSION (an `if`/`switch` branch, a struct literal in a
    // prune). Such a container has no name, so it can own nothing: see the
    // ANONYMOUS CONTAINER branch below.
    const walkStack: { node: Node; container: ZigWalkSymbol | null; inFunction: boolean; anonContainer: boolean }[] = [
      { node: rootNode, container: null, inFunction: false, anonContainer: false },
    ]

    /** The name the FILE gives its own container, if it gives one. Computed once,
     *  before the walk, because it is a property of the file rather than of any
     *  node the walk visits — and read here so the `container_field` branch can
     *  attribute a file-level field to it. */
    const fileContainerName = this.zigThisBindingName(rootNode)

    while (walkStack.length > 0) {
      const item = walkStack.pop()!
      const { node, container, inFunction, anonContainer } = item
      const type = node.type
      const nodeText = this.nodeText(node)

      // ─── CONTAINER / CONSTANT DECLARATION: const X = ... ───
      if (type === "variable_declaration") {
        // Inside a function body, or inside an anonymous container: locals are
        // execution artifacts / unnamed members — skip either way (the import
        // fact below is recorded in both).
        if (inFunction || anonContainer) {
          // Z9 (extreme review): a function-local @import is still a real
          // import fact (calls in function bodies are captured too, so
          // dropping the import was inconsistent) — record it exactly like
          // the top-level branch, without minting a local symbol.
          const lchildren = this.getAllNamedChildren(node)
          const lrhs = lchildren[lchildren.length - 1]
          const lrhsType = lrhs?.type || ""
          const lbuiltin =
            lrhsType === "call_expression" || lrhsType === "builtin_function"
              ? this.anyChild(lrhs, (n) => n.type === "builtin_identifier")
              : null
          if (lbuiltin && (lbuiltin.text === "@import" || lbuiltin.text === "@cImport")) {
            const largs = this.anyChild(lrhs, (n) => n.type === "arguments")
            const lstr = largs ? this.anyChild(largs, (n) => n.type === "string" || n.type === "string_content") : null
            if (lstr) {
              let ltarget = lstr.text
              if (
                (ltarget.startsWith('"') && ltarget.endsWith('"')) ||
                (ltarget.startsWith("'") && ltarget.endsWith("'"))
              ) {
                ltarget = ltarget.substring(1, ltarget.length - 1)
              }
              imports.push({
                module: ltarget,
                isDefaultImport: false,
                range: this.nodeRange(node),
                metadata: { zigImport: true, builtin: lbuiltin.text },
              })
              relationships.push({
                source: "(global)",
                target: ltarget,
                type: ASTEngine.RelationshipType.References,
                confidence: 1.0,
                // M59.A7 (#825): an import dependency occurs where its TARGET is
                // written — the path literal, not the declaration statement.
                ...(this.nodeLine(lstr) ? { line_number: this.nodeLine(lstr)! } : {}),
                metadata: { relationshipType: "zig_import", isImport: true },
              })
            }
          }
          // Z22 (deep review, found by the OWNERSHIP verifier): a CONTAINER
          // declared inside an executable body is a LOCAL type, and the walk
          // handed its declarations to the ENCLOSING container. A local type has
          // no file-scope identity, so its members cannot be attributed to
          // anything: `const Callback = struct { pub fn callback(…) void }`
          // inside a method of `Blob` published `callback` as a Method OWNED BY
          // `Blob`, plus a `contains Blob -> callback` edge — fabricated ownership
          // on a class the differential CANNOT see, because its coverage match is
          // `label + target` and ignores the source, so an edge that keeps its
          // member name and changes owner still reads as covered. The ownership
          // verifier (script/m14/tmp/zigw-ownership.ts) found it in 150 files,
          // which is how a class with no gate got one.
          //
          // The contract is the sibling rulings': a container with no stable
          // identity owns nothing, so its declarations are not symbols — and the
          // reads, calls and imports inside it are untouched, because those walks
          // are separate.
          const localKids = this.getAllNamedChildren(node)
          const localRhs = localKids[localKids.length - 1]
          this.pushChildren(
            node,
            walkStack,
            container,
            inFunction,
            anonContainer || (!!localRhs && ANONYMOUS_CONTAINER_NODES.has(localRhs.type)),
          )
          continue
        }

        const identNode = this.anyChild(node, (n) => n.type === "identifier")
        const varName = identNode ? identNode.text : ""
        if (!varName || varName.length > 80) {
          this.pushChildren(node, walkStack, container, inFunction, anonContainer)
          continue
        }
        // Z8 (extreme review): the blank identifier is not a declaration —
        // `var _ = 1;` minted a `_` Variable symbol (GO5 class).
        if (varName === "_") {
          this.pushChildren(node, walkStack, container, inFunction, anonContainer)
          continue
        }

        const isExported = this.hasToken(node, "pub") || this.hasToken(node, "export")
        const children = this.getAllNamedChildren(node)
        const rhs = children[children.length - 1]
        const rhsType = rhs?.type || ""
        const rhsText = rhs ? this.nodeText(rhs) : ""

        // @import / @cImport: an import, not a symbol. (ZGD4 note: the REAL
        // usingnamespace form is the declaration `usingnamespace @import(...);`
        // handled by its own branch below — probe-verified 2026-09-04. An
        // assignment-RHS usingnamespace is not valid Zig; the grammar
        // error-recovers it into a call_expression with an ERROR child.)
        const builtin =
          rhsType === "call_expression" || rhsType === "builtin_function"
            ? this.anyChild(rhs, (n) => n.type === "builtin_identifier")
            : null
        if (builtin && (builtin.text === "@import" || builtin.text === "@cImport")) {
            const argsNode = this.anyChild(rhs, (n) => n.type === "arguments")
            const strNode = argsNode ? this.anyChild(argsNode, (n) => n.type === "string" || n.type === "string_content") : null
            if (strNode) {
              let importTarget = strNode.text
              if (
                (importTarget.startsWith('"') && importTarget.endsWith('"')) ||
                (importTarget.startsWith("'") && importTarget.endsWith("'"))
              ) {
                importTarget = importTarget.substring(1, importTarget.length - 1)
              }
              // Z53: an EMPTY module path names nothing, so the `imports` record and
              // its `references` twin would both be edges into a name no consumer can
              // resolve. `zig/test/cases/compile_errors/invalid_identifiers.zig` has
              // `@import("")` and `@import("\x00")`, and the second produced
              // `references (global) -> ` with an empty target — the only empty target
              // in 3,839 files, and the last unexplained row the full-corpus run
              // found. Suppressed rather than published: the file is deliberately
              // invalid, but an unresolvable edge is not a fact about anything.
              if (!importTarget) {
                this.pushChildren(node, walkStack, container, inFunction, anonContainer)
                continue
              }
              imports.push({
                module: importTarget,
                isDefaultImport: false,
                range: this.nodeRange(node),
                metadata: { zigImport: true, builtin: builtin.text },
              })
              // Family-standard import reference (c wave: an @import is a
              // first-class graph fact, pinned via meta.isImport). The target
              // is the module path literal (@import("std") -> "std"), which
              // resolves like c's #include dependency edge — not a phantom
              // symbol edge. classifyEvidenceTier marks non-declared_type
              // references as `import_based`.
              relationships.push({
                source: "(global)",
                target: importTarget,
                type: ASTEngine.RelationshipType.References,
                confidence: 1.0,
                // M59.A7 (#825): the line of the module path as written.
                ...(this.nodeLine(strNode) ? { line_number: this.nodeLine(strNode)! } : {}),
                metadata: { relationshipType: "zig_import", isImport: true },
              })
            }
            // Z35: this branch used to swallow the BINDING, and the rule it
            // actually implemented was "an @import binding is a symbol only when
            // the right-hand side is LONGER than the import itself" —
            // `const std = @import("std")` published no symbol while
            // `const longer = @import("std").ArrayList` published one, in the same
            // file. That is not a rule any language has, and it cost three things:
            // the module's namespace was missing its most common declaration
            // (1,458 bindings in 400 corpus files), a `pub const X = @import(...)`
            // re-export named a binding the index could not resolve (the fixture
            // runner's export invariant caught it), and the binding was invisible
            // while the import EDGE was published for every one of them. The fix is the
            // REMOVAL of an early
            // exit: at file or container scope the walk falls through to the same
            // const/var handling every other declaration gets, so kind, visibility
            // and owner are decided in ONE place. Inside a function body the exit
            // stays (Z9, and the family's LocalsAreNotSymbols rule).
            if (inFunction) {
              this.pushChildren(node, walkStack, container, inFunction, anonContainer)
              continue
            }
          }

        // `const` vs `var` (anonymous tokens, probe-verified): a mutable
        // global `var` is a Variable, not a Constant (deep-review finding
        // 2026-08-29 — previously every global was labeled constant).
        const isVar = this.hasToken(node, "var")
        let kind: ASTEngine.SymbolKind = isVar ? ASTEngine.SymbolKind.Variable : ASTEngine.SymbolKind.Constant
        // Z12 (deep review): `opaque {}` is a CONTAINER in Zig — it has no
        // fields, but it declares functions and constants. Treating it as an
        // ordinary value left every one of those declarations at file scope
        // with no owner: 123 opaque containers in the three pinned corpora, and
        // their `pub fn` members came out as free Functions with no `contains`
        // edge and no `scope`. `opaque_declaration` is not a container the
        // walk knows, so `newContainer` stayed null all the way down.
        const isContainer =
          rhsType === "struct_declaration" ||
          rhsType === "enum_declaration" ||
          rhsType === "union_declaration" ||
          rhsType === "error_set_declaration" ||
          rhsType === "opaque_declaration"

        if (rhsType === "struct_declaration") kind = ASTEngine.SymbolKind.Struct
        else if (rhsType === "enum_declaration") kind = ASTEngine.SymbolKind.Enum
        else if (rhsType === "union_declaration") kind = ASTEngine.SymbolKind.Union
        else if (rhsType === "error_set_declaration") kind = ASTEngine.SymbolKind.Enum
        // An opaque type is a nominal type with no visible members. The shared
        // SymbolKind has no Opaque member, and adding one is a cross-lane
        // contract change, so it is published as `Type` — which is what the
        // upper-case rule already produced for all 123 corpus sites, and is
        // true: `const Handle = opaque {}` names a type.
        else if (rhsType === "opaque_declaration") kind = ASTEngine.SymbolKind.Type
        else if (ZIG_TYPE_RHS.has(rhsType)) {
          // Z11: the RHS IS a type node (`const Pos = c_long;`, `const Buf =
          // []const u8;`, `const T = fn () void;`) whatever the name's case.
          // The old value-literal list carried `builtin_type` here, which is
          // how 440 type aliases were published as value constants.
          kind = ASTEngine.SymbolKind.Type
        } else if (ZIG_VALUE_RHS.has(rhsType) || (rhsType === "labeled_type_expression" && this.isLabeledBlockValue(rhs))) {
          // Z11: the RHS is a value expression, so an upper-case name does not
          // make it a type alias — no Zig type is a bit-shift, a negation, a
          // null-coercion, an index, a catch or a labeled block. The two-sided
          // forms below keep the name heuristic, which is the pinned
          // `pub const B = A` contract (ZGD kind dispatch ordering).
          if (!isVar) kind = ASTEngine.SymbolKind.Constant
        } else if (rhsType === "struct_initializer" && !this.isTypeValuedInitializer(rhs)) {
          // Z11b: `const NAMES = [_]u8{ 1, 2, 3 };` and `const S = Point{}`
          // are VALUES whatever the name's case. The one initializer that is a
          // type is an array/slice OF TYPES — `pub const Implements =
          // [_]type{gtk.Scrollable};` — which is what `isTypeValuedInitializer`
          // tests, because the grammar gives the element type as a child.
          if (!isVar) kind = ASTEngine.SymbolKind.Constant
        } else if (varName[0] === varName[0].toUpperCase() && varName[0] !== varName[0].toLowerCase()) {
          kind = ASTEngine.SymbolKind.Type
        }

        const sym: ASTEngine.UniversalSymbol = {
          name: varName,
          kind,
          visibility: isExported ? "public" : "private",
          range: this.nodeRange(node),
          scope: ownerPathOf(container),
          ownerName: ownerPathOf(container),
          ownerKind: container?.kind,
          metadata: {
            zigDeclaration: kind,
            ...(rhsType === "error_set_declaration" ? { zigErrorSet: true } : {}),
            // Z35: a NAMESPACE IMPORT BINDING is a distinct fact from any other
            // const, and a consumer asking "which names in this file are modules"
            // cannot ask without it. It is also what makes the regression
            // reconstructible by a MARKER rather than by a list of names.
            ...(this.isZigImportBinding(rhs) ? { zigImportBinding: true } : {}),
          },
        }
        symbols.push(sym)
        // Z20 (deep review): an export must name an IMPORTABLE unit — a
        // file-scope name an importer can bind. A `pub const` INSIDE a container
        // is reached as `Container.member`, which is the `contains` edge's job:
        // publishing it as an export named `member` invents a binding no
        // importer can use, and it tripped the fixture runner's export invariant
        // as soon as an opaque container started owning its declarations. The
        // `pub` fact survives as the member's `visibility: "public"`.
        // Z33: the export carries its RANGE so the `exports` relationship can be
        // attributed to the line the name is written on (M59.A7/M60). The interface
        // has always had the optional field; nothing populated it.
        if (isExported && !container) exports.push({ name: varName, kind, range: this.nodeRange(node) })

        // Container members belong to the new container symbol.
        //
        // Z-p22: a container records its OWN absolute path, which is what a
        // member's `ownerName`/`scope` are spelled from (`ownerPathOf`). It is
        // computed only for a container, so the 100k+ non-container declarations
        // pay nothing, and `stripZigQuoting` runs per component so the path
        // agrees with the STRIPPED name the projection builds the container's own
        // `qualifiedName` from.
        if (isContainer) {
          const own = stripZigQuoting(varName)
          const parentPath = ownerPathOf(container)
          ;(sym as ZigWalkSymbol).zigOwnerPath = parentPath ? `${parentPath}.${own}` : own
        }
        const newContainer = isContainer ? sym : container
        this.pushChildren(node, walkStack, newContainer, inFunction, anonContainer)
        continue
      }

      // ─── TEST / COMPTIME BLOCKS: executable bodies, not declaration scope ───
      // ZGD3 (zig wave, M37 #600): test_declaration and comptime_declaration
      // contain block bodies whose `var` locals are EXECUTION artifacts. The
      // walk previously fell through with inFunction=false, so every test
      // body leaked file-scope Variable symbols (probe: `test "t1" { var
      // local_counter ... }` emitted variable:local_counter). Reusing the
      // inFunction flag marks the body as executable scope: no declaration
      // symbols, while calls/uses emission (analyzeZigCodeRelationships) is
      // unaffected — it tracks function_declaration only and emits these
      // sites with source "(global)" (ZIG.D.2 contract).
      //
      // Z19 (deep review): this named the two ENCLOSING nodes, which is why the
      // rule had a hole — a LABELED BLOCK is a body reached by a different path
      // (`const V = cvalue: { const key_fields = …; break :cvalue v; };`) and
      // its comptime locals were published as file-scope symbols: measured on 400
      // corpus files, 70 symbols inside 35 container-scope block-shaped
      // declarations, including `key_fields`, `names`, `types`, `action`,
      // `attrs`, `total`, `index` — every one of them a local of a block, by the
      // analyzer's own definition. The structural rule is the honest one and it
      // subsumes this branch: a `block` in tree-sitter-zig IS a `{ … }` body —
      // it is never a type and never a declaration scope — so marking the block
      // itself covers test blocks, comptime blocks, labeled blocks, and the
      // `comptime_expression` form alike. Kept as an explicit branch because a
      // test/comptime block's OTHER children (a test NAME) are not inside the
      // block and must still be walked.
      if (type === "test_declaration" || type === "comptime_declaration") {
        this.pushChildren(node, walkStack, container, true, anonContainer)
        continue
      }

      // ─── USINGNAMESPACE DECLARATION (ZGD4, zig wave M37 #600) ───
      // `usingnamespace @import("x.zig");` is a first-class import fact the
      // walk previously dropped entirely (probe-verified 2026-09-04: no
      // import record, no references edge). The @import sits in a
      // builtin_function child — same shape as the plain-import branch.
      if (type === "using_namespace_declaration") {
        const bf = this.anyChild(node, (n) => n.type === "builtin_function")
        const bi = bf ? this.anyChild(bf, (n) => n.type === "builtin_identifier") : null
        if (bf && bi && (bi.text === "@import" || bi.text === "@cImport")) {
          const argsNode = this.anyChild(bf, (n) => n.type === "arguments")
          const strNode = argsNode ? this.anyChild(argsNode, (n) => n.type === "string" || n.type === "string_content") : null
          if (strNode) {
            let importTarget = strNode.text
            if (
              (importTarget.startsWith('"') && importTarget.endsWith('"')) ||
              (importTarget.startsWith("'") && importTarget.endsWith("'"))
            ) {
              importTarget = importTarget.substring(1, importTarget.length - 1)
            }
            // Z53, second site: same guard as the plain @import branch above.
            if (!importTarget) {
              relationships.push({
                source: "(global)",
                target: "@import",
                type: ASTEngine.RelationshipType.References,
                confidence: 1.0,
                metadata: { relationshipType: "zig_import", isImport: true, emptyImportPath: true },
              })
              // `continue`, not `return`: this sits inside analyze()'s walk loop, so a
              // bare `return` exited analyze() with `undefined` and every caller got a
              // missing ParseResult. The intent is only "do not also record an import
              // whose module path is unresolvable" -- i.e. finish this node and move on.
              continue
            }
            imports.push({
              module: importTarget,
              isDefaultImport: false,
              range: this.nodeRange(node),
              metadata: { zigImport: true, builtin: bi.text, usingnamespace: true },
            })
            relationships.push({
              source: "(global)",
              target: importTarget,
              type: ASTEngine.RelationshipType.References,
              confidence: 1.0,
              // M59.A7 (#825): the module path as written.
              ...(this.nodeLine(strNode) ? { line_number: this.nodeLine(strNode)! } : {}),
              metadata: { relationshipType: "zig_import", isImport: true },
            })
          }
        }
        this.pushChildren(node, walkStack, container, inFunction, anonContainer)
        continue
      }

      // ─── FUNCTION DECLARATION: pub fn name(...) ───
      //
      // Z26 (wave 3, 2026-09-29): a `function_signature` is a function-pointer
      // TYPE, not a function — this grammar gives it no `declarator` field at
      // all (measured: `f: *const fn (a: u8) callconv(.c) ComparisonResult`
      // parses as container_field > pointer_type > function_signature with
      // children parameters / calling_convention / identifier). Minting a symbol
      // from it published a METHOD named after whatever identifier happened to
      // be first under the node: `contains MutableArray -> ComparisonResult`
      // (the RETURN TYPE) and `contains Options -> apprt` (a segment of
      // `*apprt.ClipboardRequest`, from a field whose type is a function
      // pointer). Two fabrications of methods that do not exist, on a class that
      // is 16.6% of everything this analyzer emits. Found by the new `contains`
      // gate — and NOT by the ownership verifier, whose derivation took
      // `firstIdent(function_signature)` and therefore agreed with the bug: a
      // mirror that reproduces the defect it is meant to convict is self-
      // agreeing, which is the reason this truth was written from the grammar
      // rather than from the analyzer's own name-picking.
      //
      // The signature's CHILDREN are still walked: a function type's parameters
      // and its return type are declared-type facts (the `references` collection
      // at the bottom of this walk reads them on purpose).
      if (type === "function_signature") {
        this.pushChildren(node, walkStack, container, inFunction, anonContainer)
        continue
      }
      if (type === "function_declaration") {
        // Z28, the function half: this grammar has NO `declarator` field on a
        // function_declaration (measured: `function_declaration [fields: type]`
        // and its first NAMED child is always the name), so the name is read
        // POSITIONALLY and the deep `anyChild` search that Z26 exploited is gone
        // from the common path. The fallback stays for a grammar variant that
        // reorders it, and the 100-char cap stays as the stated guard it is.
        const firstNamed = node.namedChildCount > 0 ? node.namedChild(0) : null
        const identNode =
          firstNamed && firstNamed.type === "identifier"
            ? firstNamed
            : this.anyChild(node, (n) => n.type === "identifier")
        const fnName = identNode ? identNode.text : ""
        const isExported = this.hasToken(node, "pub") || this.hasToken(node, "export")
        const isInline = this.hasToken(node, "inline")

        // Methods of an ANONYMOUS struct returned by a generic function
        // (`fn GenericStack(...) type { return struct { fn push(...) } }`) have
        // no named container — they must not become file-scope functions.
        const isAnonymousContainerMember = anonContainer || (!container && inFunction)

        // Z46: the blank-identifier refusal belongs to BINDINGS, not to declared
        // names, and it was applied to both. `const _ = 1;` is a discard and must
        // mint nothing (Z8/GO5, still enforced in the variable branch above) --
        // but `pub fn _(msgid: [*:0]const u8) …` is a REAL, callable
        // declaration: the gettext convention, and the entire i18n entry point of
        // ghostty. Excluding it here left the analyzer publishing
        // `calls (global) -> _` for a function it had declined to declare, which
        // is a dangling edge: a call into a name the index will never resolve.
        //
        // One occurrence in 3,839 corpus files, and worth fixing anyway, because
        // the cost of the rule is not one missing symbol but an edge that points
        // at nothing. Reads of `_` stay suppressed by the bare-read guard
        // (`name !== "_"`), so `_ = expr` remains a discard assignment and not a
        // read -- the two positions are now decided separately, which is the
        // whole of the fix.
        if (fnName && fnName.length < 100 && !isAnonymousContainerMember) {
          const params: ASTEngine.Parameter[] = []
          const paramsNode = this.anyChild(node, (n) => n.type === "parameters")
          if (paramsNode) {
            for (let i = 0; i < paramsNode.namedChildCount; i++) {
              const child = paramsNode.namedChild(i)
              if (!child || child.type !== "parameter") continue
              // Z17c (deep review): the same five-node-type list as the field
              // case, and the same gap — `fn f(w: io.Writer)`, `fn f(g: MyList(u8))`
              // and `fn f(b: [4]u8)` published a parameter with NO type, which is
              // what hover and call-hierarchy signatures read. The grammar hands
              // it over as the `type` field; a fn-TYPE parameter (`fn (u8) void`)
              // has one too, and one with neither (a recovered shape) publishes
              // no type rather than a guessed one.
              const pNameNode = this.namedFieldOf(child, "name") ?? this.anyChild(child, (n) => n.type === "identifier")
              const pTypeNode = this.typeFieldOf(child)
              if (pNameNode) {
                params.push({
                  name: pNameNode.text,
                  type: pTypeNode ? this.nodeText(pTypeNode) : undefined,
                })
              }
            }
          }

          // Inside a struct/union/enum/error-set/opaque container → method;
          // else free function. Z12: the previous test was
          // `container.kind !== Type`, which was a proxy for "a type alias has
          // no body" — but an OPAQUE container is published as `Type` (no
          // Opaque member in the shared SymbolKind) and does have
          // declarations, so every opaque member came out a free Function with
          // no owner. Ownership is now the test, and it is the honest one.
          const isMethod = container !== null
          const sym: ASTEngine.UniversalSymbol = {
            name: fnName,
            kind: isMethod ? ASTEngine.SymbolKind.Method : ASTEngine.SymbolKind.Function,
            visibility: isExported ? "public" : "private",
            range: this.nodeRange(node),
            scope: ownerPathOf(container),
            parameters: params,
            ownerName: ownerPathOf(container),
            ownerKind: container?.kind,
            // Per-symbol cyclomatic complexity (family standard — go/c/rust
            // emit symbol.complexity; zig did NOT, so completeness section C
            // was impossible). Added zig wave 2026-08-29.
            complexity: this.zigBodyComplexity(node),
            metadata: {
              zigFunction: true,
              inline: isInline,
              paramCount: params.length,
              // #612 store-phase: DECLARATION vs DEFINITION. Measured against
              // this grammar (tree dump, 2026-09-25): `extern fn run_engine()
              // c_int;` and `pub fn call_it() c_int { … }` BOTH parse as
              // `function_declaration`, and the grammar hands the difference
              // over as a FIELD — 35,692 of the corpus's 37,129 functions carry
              // a `body` child under the `body` field name, the rest declare
              // nothing. So the discriminator is read off the field, with the
              // node-type test kept as the fallback for a grammar variant that
              // does not name it. Without the flag an `extern` declaration
              // competed on equal footing with the definition implementing it in
              // another file.
              ...(this.functionBody(node) === null ? { isDeclaration: true } : {}),
            },
          }
          symbols.push(sym)
          if (isExported && !isMethod) exports.push({ name: fnName, kind: ASTEngine.SymbolKind.Function, range: this.nodeRange(node) })
        }
        // Function body: execution artifacts only — no declaration symbols.
        this.pushChildren(node, walkStack, container, true, anonContainer)
        continue
      }

      // ─── ANONYMOUS CONTAINER IN AN EXPRESSION POSITION ───
      // A container declaration is only recognised as a container when it is the
      // RIGHT HAND SIDE of a `const`/`var`. The SAME node reached as an
      // EXPRESSION — the branch of an `if`/`switch`
      // (`pub const T = if (c) A else struct { pub inline fn init(…) }`), a
      // struct literal in a prune (`(struct { inline fn assert(…) void {…} }).assert`),
      // a struct type inside a `nullable_type`/`array_type` — established no
      // container at all, so its declarations were published as members of
      // whatever container happened to enclose them.
      //
      // Two measured classes, over 900 corpus files (693 expression-position
      // containers, 412 symbols inside them):
      //   (a) FALSE OWNERSHIP: the fields of a union variant's payload struct
      //       were published as members of the UNION
      //       (`property libc owner=Value` for a field of `native`'s struct).
      //   (b) IDENTITY COLLISION: where two variants declare the same field, the
      //       two distinct declarations were published under ONE identity —
      //       `ghostty/pkg/apple-sdk/build.zig` publishes `property libc` TWICE
      //       with the same (owner, name), at lines 19 and 25. The fixture
      //       runner's RSD3 rule says that shape must yield distinct ids.
      //
      // The fix is the contract the analyzer ALREADY states for the sibling
      // shape (a struct returned by a generic function): a container with no
      // stable identity can own nothing, so none of its declarations is a
      // symbol. Imports, calls and reads inside it are unaffected — those walks
      // are separate and still see every site.
      if (ANONYMOUS_CONTAINER_NODES.has(type)) {
        const parent = node.parent
        const isDeclRhs =
          !!parent &&
          parent.type === "variable_declaration" &&
          parent.namedChildCount > 0 &&
          parent.namedChild(parent.namedChildCount - 1)?.id === node.id
        if (!isDeclRhs) {
          this.pushChildren(node, walkStack, container, inFunction, true)
          continue
        }
      }

      // ─── CONTAINER FIELD: struct/union member or enum member ───
      // Requires a NAMED container: fields of an anonymous struct returned by
      // a generic function (`fn GenericStack(...) type { return struct {...} }`)
      // have no stable container identity and must NOT become file-scope
      // symbols (C negative contract: anonymous containers are not named).
      if (type === "container_field") {
        // ─── A FIELD OF THE FILE ITSELF (`@This()`) ───
        // Zig lets a FILE be a struct. `const OpenURI = @This();` followed by
        // bare fields makes the file's top level the body of that struct, and
        // the grammar states that structurally: the fields arrive as
        // `container_field` whose DIRECT parent is `source_file`, not as a
        // child of any `container_declaration`. Pinned-wasm probe,
        // ghostty/src/apprt/gtk/portal/OpenURI.zig:20 — the ancestors read
        // `container_field < source_file`, and the file's own tree declares
        // `app`, `dbus`, `mutex`, `entries`, `cleanup_timer`, `alive`.
        //
        // The `!container` skip below did not reach this shape, and the
        // negative contract it cites does not either. That contract is about a
        // field inside an ANONYMOUS struct — one returned from a generic
        // function, `fn GenericStack(...) type { return struct {...} }` — whose
        // owner has no stable identity. A file-level field's owner is the FILE:
        // it has a path, and in 401 of the 411 corpus files that declare one it
        // has a name too, bound by `const X = @This()`. Measured over the
        // published 3,834-file draw (filecontainer-census.ts): 411 files carry
        // at least one, 3,324 fields in all, and 2,892 of those names were
        // published NOWHERE in their own file — so every read of one was an
        // unresolvable `uses` edge naming a declaration the parser had in hand.
        //
        // The owner is asserted ONLY when the file names it. `anonContainer` is
        // not consulted: a file-level field is by construction not inside an
        // anonymous container, and requiring `node.parent` to be `source_file`
        // is the stronger statement — it cannot be true of a field that some
        // enclosing struct owns.
        if (!container && !anonContainer && node.parent?.type === "source_file") {
          this.zigFileLevelField(node, fileContainerName, symbols)
          this.pushChildren(node, walkStack, container, inFunction, anonContainer)
          continue
        }
        if (!container || anonContainer) {
          this.pushChildren(node, walkStack, container, inFunction, anonContainer)
          continue
        }
        // Z28: the name comes from the grammar's own `name` FIELD, and the
        // length cap stops being a filter. The old `anyChild(identifier)` +
        // `length < 50` pair dropped 14 REAL field declarations out of 27,004 in
        // 1,200 corpus files (0.05%) — `supports_workspace_did_change_configuration_
        // dynamic_registration` (74 chars, an LSP capability flag) and the aro
        // `__builtin_amdgcn_wmma_*` shims (50-52 chars). A length test is not a
        // junk filter; it is a length test, and a declaration that exists in the
        // source was simply absent from the index. Measured over the same corpus:
        // 0 field names reach 100 characters, so the cap is now 200 and exists to
        // catch a grammar variant handing over something that is not a name —
        // stated as that, rather than as a filter that quietly loses 0.05%.
        // The `name` field is only a NAME when it is an identifier: an unnamed
        // field hands over a TYPE there (measured: `extern struct` members in
        // zls/src/analyser/InternPool.zig whose `name` field is a `builtin_type`
        // — `usize`, `isize`, `c_short`, `c_int` — and the first version of this
        // change published all four as fields NAMED after their own type, 31
        // fabricated `contains` edges in one file). An unnamed field has no name
        // to publish, and a symbol named `usize` is a fabrication, so the field
        // is read only when it is an identifier and the search is the fallback.
        // `field_identifier` was removed here rather than waived: the grammar audit
        // validated it against the real tree-sitter-zig wasm and the grammar declares
        // no such node, so that half of the condition could never be true and the
        // `identifier` half is the only one that ever ran. A second spelling of a node
        // that does not exist is a guess that reads as a fallback.
        const nameField = node.childForFieldName?.("name")
        // Z45: the `field_identifier` disjunct was DEAD. This grammar has no such
        // node type -- a field's name is an `identifier` (probe-verified against
        // the pinned wasm by zigw-dead-branches.ts), and the name of this very
        // check is the kind of leftover that reads like coverage of a case that
        // cannot occur. It was found by the F1 grammar audit, which flags a type
        // literal in a comparison that the grammar does not declare, and which had
        // been reporting `zig FAIL unknown=2` while the doc and the closure both
        // claimed 0 unknown. The live disjunct is the first one, so removing the
        // dead one changes no output -- which is the point: it was never load
        // bearing, only misleading.
        //
        // Z-p20, and it is the GATE that the refusal above was missing. That
        // refusal was right about `zls/src/analyser/InternPool.zig` -- a
        // `builtin_type` name field there is a TUPLE struct's element type, and
        // publishing it as a field name fabricates a declaration. It was wrong as
        // a blanket rule, because Zig also lets an enum member be NAMED with a
        // primitive type name: `pub const Feature = enum { bool, clamps }`
        // (zig/lib/std/Target/xtensa.zig:8), `BlockType.f64 = 0x7C`
        // (zig/lib/std/wasm.zig:663), `Key.f16` (ghostty/src/input/key.zig:263).
        // Measured over the 3,834-file draw `sha256:2f3545f9`: 468 sites carry a
        // `builtin_type` name field, of which 122 sit in an ENUM and all 122 were
        // ABSENT from parseFile's output -- `Feature.clamps` published beside an
        // unpublished `Feature.bool`, same enum, same container, the only
        // difference being how the lexer spelled the name. Enum bodies have no
        // positional form, so a bare token there is a member NAME by the language's
        // own rules. Structs and unions DO have one, which is why the same token in
        // `struct { usize, bool }` (ghostty/src/simd/base64.zig:197) is an element
        // type and stays refused: that is 332 of the 468, and naming them would
        // repeat the 31 fabrications this comment already records.
        //
        // The four node types are the census's, not a judgement: over the same
        // draw, 162 bound non-local enum members carry a name field the lexer
        // spelled as something other than an `identifier` — `builtin_type` 116
        // (Feature.bool, BlockType.f64, Key.f16), `boolean` 28 (Redraw.true,
        // Redraw.false), `null` 14 (OptRef.null, SimpleValue.null) and
        // `undefined` 4 (SimpleValue.undefined). Every one of those texts is a
        // legal identifier in Zig declaration position, which the corpus
        // demonstrates by compiling. A node type absent from this set is absent BY
        // MEASUREMENT, so adding one needs a census row rather than an intuition.
        const isEnumMember = container?.kind === ASTEngine.SymbolKind.Enum
        const enumPrimitiveName =
          isEnumMember && nameField && ENUM_MEMBER_NAME_NODE_TYPES.has(nameField.type)
            ? nameField
            : null
        const nameNode =
          nameField && nameField.type === "identifier"
            ? nameField
            : (enumPrimitiveName ?? this.anyChild(node, (n) => n.type === "identifier"))
        const fieldName = nameNode ? nameNode.text : ""
        if (fieldName && fieldName !== "_" && fieldName.length < 200) {
          // Z17b (deep review): the field's declared type used to be found by
          // asking for one of five node types, so the most common kinds of
          // declaration in Zig published NO type at all — `size: Size`,
          // `buf: [4]u8`, `map: MyList(u8)`, `w: std.mem.Allocator`. The
          // grammar hands the type over as the `type` FIELD, and the nim lane
          // (the most recent) publishes a property's type the same way, so this
          // is a family completeness gap rather than a zig quirk. An enum member
          // has no type field, so it correctly stays undefined.
          const typeField = this.typeFieldOf(node)
          symbols.push({
            name: fieldName,
            kind: isEnumMember ? ASTEngine.SymbolKind.EnumMember : ASTEngine.SymbolKind.Property,
            visibility: "public",
            range: this.nodeRange(node),
            scope: ownerPathOf(container),
            ownerName: ownerPathOf(container),
            ownerKind: container?.kind,
            returnType: typeField ? this.nodeText(typeField) : undefined,
            metadata: { zigField: true, ...(isEnumMember ? { zigEnumMember: true } : {}) },
          })
        }
        this.pushChildren(node, walkStack, container, inFunction, anonContainer)
        continue
      }

      // ─── ERROR SET MEMBERS: error{ InvalidPoint, OutOfMemory } ───
      // Only identifiers that are DIRECT children of the error_set node are
      // members; the declaring variable's LHS identifier is not one.
      if (type === "identifier" && container && container.metadata?.zigErrorSet && node.parent?.type === "error_set_declaration") {
        const identText = node.text
        if (identText && identText.length < 50) {
          symbols.push({
            name: identText,
            kind: ASTEngine.SymbolKind.EnumMember,
            visibility: "public",
            range: this.nodeRange(node),
            scope: ownerPathOf(container),
            ownerName: ownerPathOf(container),
            ownerKind: container.kind,
            metadata: { zigErrorSetMember: true },
          })
        }
        continue
      }

      // (No relationship for switch_expression — `switch` is a keyword, not a
      // symbol; a `references -> switch` edge would be a phantom that never
      // resolves. Control flow is an execution artifact, family contract.)

      // ─── ERROR REPORTING ───
      // Per ERROR/MISSING node, not per hasError-bearing ancestor: the old
      // `node.hasError ||` arm fired once for EVERY node on the spine above a
      // single real error — the root spans the whole file, so one parse error
      // cascaded into 163 pipeline rows on aro/Attribute.zig (the #897
      // cross-check caught it: tree walk found the file's nodes, pipeline
      // reported 163). A MISSING node carries hasError too but its type is
      // the expected token, so the isMissing arm keeps that reporting.
      if (node.type === "ERROR" || node.isMissing) {
        const snippet = nodeText.substring(0, 50)
        errors.push({
          message: `Zig syntax error: ${snippet}`,
          range: {
            // Z2 (zig review): 1-based columns like every other range in
            // this file (nodeRange +1s) — the raw 0-based columns leaked
            // through here (svelte-wave class).
            startLine: node.startPosition.row + 1,
            startColumn: node.startPosition.column + 1,
            endLine: node.endPosition.row + 1,
            endColumn: node.endPosition.column + 1,
            startIndex: node.startIndex,
            endIndex: node.endIndex,
          },
          severity: "error",
        })
      }

      // ─── PUSH CHILDREN (default: preserve container/function context) ───
      // Z19 (deep review): a `block` is an EXECUTABLE BODY wherever it appears.
      // In tree-sitter-zig `{ … }` is a statement/expression body and never a
      // type and never a declaration scope, so its `var`/`const` declarations
      // are execution artifacts by the analyzer's own contract (ZGD3) — the
      // rule belongs on the block, not on the two node types that usually wrap
      // one. See the Z19 note on the test/comptime branch for the measurement.
      this.pushChildren(node, walkStack, container, inFunction || type === "block", anonContainer)
    }    // Contains relationships for owned symbols
    for (const s of symbols) {
      if (s.ownerName) {
        relationships.push({
          source: s.ownerName,
          // M60 cause A — the target is the member's own PUBLISHED SPELLING, which
          // is what Z-p22 above already established for the SOURCE and this edge
          // never followed on the target half.
          //
          // The projection spells a symbol `scope ? scope + "." + name : name`
          // (pool-worker.ts:997) and `scope` is this symbol's `ownerName`
          // (see `mkSymbol`'s `scope: ownerName ?? undefined`). So the string this
          // edge targets IS the member's published `qualified_name`, and the store
          // resolves it on its FIRST strategy: `target_external = qualified_name`
          // is an exact JOIN (parallel-indexer.ts:4483-4495, `_res_qname` PRIMARY
          // KEY), which binds one declaration by construction.
          //
          // A BARE member name reaches only strategy 2, which fires
          // `_res_name.cnt = 1` — the name must be unique across the WHOLE project
          // (parallel-indexer.ts:4506). No container member name ever is: the
          // fleet's own corpus declares `init`, `deinit`, `assert` and `release`
          // in dozens of files each. So the bare target was not merely imprecise,
          // it was the one spelling guaranteed to fail the only strategy that
          // could have carried it.
          //
          // MEASURED, 600-file stride sample, production `parseFile`, incoming-gate
          // (which counts ambiguity by DECLARATION and indexes name + qualifiedName
          // aliases): `contains` 13,690 edges — 8,993 resolved, 4,697 AMBIGUOUS,
          // 0 unresolved. That 4,697 was the largest single ambiguous bucket in the
          // lane, 24.6% of the 19,084 total. Priced over the FULL population first
          // (3,834 files, 80,876 contains edges, `contains-qualify-control.ts`):
          // FIX 31,800 / RISK 5 / LOST 797 / NEUTRAL 48,274 — i.e. +31,800 edges
          // that resolve to exactly one declaration against 5 that stop doing so.
          //
          // The name SURFACE is untouched: `symbols.push({ name: s.name })` still
          // publishes the bare member, so hover, navigation and every expectation
          // file that reads `name` are unaffected. Only the edge endpoint changes.
          // `source` still carries the owner, so containment survives independently
          // of the target — the two halves are redundant by design, and this makes
          // them agree.
          target: publishedSpelling(s),
          type: ASTEngine.RelationshipType.Contains,
          confidence: 1.0,
          // M59.A7 (#825): a containment edge has no call site, but it has a
          // navigable one — the member's own declaration line. Omitted, never
          // written as 0, when the symbol carries no range (#820).
          ...(s.range?.startLine ? { line_number: s.range.startLine } : {}),
          // Z44: a reason code, so every class in this analyzer answers the same
          // question — "why does this edge exist?" — the same way. `contains` is
          // built from the SYMBOL TABLE at the end of the walk rather than at the
          // member's site, which is why it carried an EMPTY metadata object and
          // was invisible to any consumer that reads the reason. It is the
          // largest class in the corpus (261 of the 300-file draw) and it was the
          // one that said nothing. `zigField`/`zigEnumMember` are already on the
          // SYMBOL; here the reason is that the edge is ownership.
          metadata: { relationshipType: "zig_ownership" },
        })
      }
    }

    // Call and field-access relationships (family contract, added zig wave
    // 2026-08-29). A call_expression emits a `calls` edge to the callee LEAF
    // name (identifier `helper` -> helper; field_expression callee
    // `list.append`/`std.math.abs` -> append/abs). A field_expression that is
    // NOT the direct callee of a call emits a `uses` edge to its field leaf
    // (list.items.len -> len, list.allocator -> allocator, list.items ->
    // items). Source = the enclosing function/method name; struct-local
    // field reads are attributed to the method body that reads them. The
    // analyzer previously emitted NO calls/uses relationships at all — a
    // 30 KB std source with 56 call sites produced zero edges.
    this.analyzeZigCodeRelationships(rootNode, relationships, symbols)

    // Z30: the `imports` twin. An import names a MODULE, not a symbol: 176 of the
    // 394 distinct module targets in 400 corpus files contain a path separator
    // (`../build/gresource.zig`), which no zig declaration name can hold. 16 lanes
    // emit the type and the graph engine, the brain's evidence enrichment and the
    // MCP handler all read it, so a lane without it has no import graph rather than
    // a sparser one. The `references` twin STAYS — it is the edge this lane's
    // declared-type/reference truth derives — so this ADDS a class rather than
    // reclassifying one. Both carry the path literal's line (M60.A7).
    this.collectZigImportSites(rootNode, imports, relationships)

    // Z32: `instantiates` — the type ZIG.D.1 ruled out, on the premise that
    // generics are "monomorphized without a runtime type dispatch the analyzer can
    // attribute statically". The first half is true and the conclusion is not: a
    // generic type application is the most STATICALLY READABLE instantiation there
    // is, because `fn … type` is a declaration in the file. Measured over 400
    // corpus files: 34 in-file type-returning functions, 82 application sites, and
    // 101 constructions of an in-file type — the second class being exactly what
    // ZIG.GAP.3 has wanted, and the family's mechanism for it is this very type
    // (c/cpp with `isConstructor`, clojure, clean). Contract as those lanes write
    // it: source is the enclosing symbol or `(global)`, the target must be a type
    // DECLARED IN THIS FILE (so the edge is proven, not inferred — hence
    // confidence 1.0 and `isExternalTarget: false`), and the line is the HEAD
    // node's, the type name's own line.
    this.analyzeZigInstantiation(rootNode, relationships)

    // Z33: `exports` — the type the relationship census caught unclassified. Zig's
    // `pub` IS the language's public API surface (1,465 exported declarations in
    // 391 of 400 corpus files), recorded in `res.exports` and published as NO
    // relationship, so `bb_graph --type exports` returned nothing for this lane
    // while returning an API surface for 16 others. Generated FROM the export list,
    // so the two surfaces cannot drift.
    this.emitZigExportEdges(relationships, exports)

    // Z3 (zig review): bare-identifier value reads. The analyzer emitted NO
    // bare-identifier edges at all (`return MAX` produced zero relationships)
    // while const reads, call args, index operands and return expressions
    // all read file-visible values. C-family discipline with a lexical
    // scope stack (params + block/payload/short bindings shadow) and
    // resolvability required (file-scope const/var/fn/enum-members only).
    this.analyzeZigBareIdentifierUses(rootNode, relationships, symbols)

    // Z52: the two `uses` passes dedupe INDEPENDENTLY -- `emittedUses` in
    // analyzeZigCodeRelationships keyed `${source}->${field}`, and a separate
    // `emitted` in analyzeZigBareIdentifierUses keyed `${src}::uses::${name}` -- so
    // a name derivable BOTH ways is published TWICE at the same line with
    // conflicting metadata: `zig_field_access` @ 0.75 and `identifier_usage` @ 1.0.
    //
    // `zig/test/standalone/dep_mutually_recursive/test.zig:5` publishes
    // `uses main -> foo` twice for one syntactic occurrence, because `foo` is both a
    // field-expression leaf and a name that resolves to a file-scope value. 16 such
    // rows at full-corpus extent (3,839 files), in 7 files -- a number a 200-file
    // draw never reaches, which is the whole argument for having run it.
    //
    // A consumer cannot resolve that edge: two rows, one relationship, two
    // confidences, no rule for which wins. Resolved once, here, after both passes:
    // one `uses` edge per (source, target), keeping the HIGHER confidence -- which
    // is also the more accurate, since `identifier_usage` @ 1.0 means the name
    // RESOLVES to a file-scope value (a fact) while `zig_field_access` @ 0.75 is the
    // inference that the leaf is a member. The winner keeps its reason code, so the
    // edge still says which derivation it came from.
    {
      const bestUses = new Map<string, ASTEngine.UniversalRelationship>()
      const order: ASTEngine.UniversalRelationship[] = []
      for (const r of relationships) {
        if (r.type !== ASTEngine.RelationshipType.Uses) { order.push(r); continue }
        const key = `${r.source}|${r.target}`
        const prior = bestUses.get(key)
        if (!prior) {
          bestUses.set(key, r)
          order.push(r)
        } else if ((r.confidence ?? 0) > (prior.confidence ?? 0)) {
          order[order.indexOf(prior)] = r
          bestUses.set(key, r)
        }
      }
      relationships.length = 0
      relationships.push(...order)
    }

    // Declared-type reference graph (family standard — mirrors go/c/rust):
    // parameter types, return types, struct/union field types emit a
    // `references` edge to their leaf type name (builtin types excluded). A
    // `const HashMap = std.StringHashMap(usize)` type alias does NOT emit a
    // reference — the RHS is a generic type application, not a declared-type
    // dependency (analyzer-verified zig wave 2026-08-29).
    this.extractZigDeclaredTypeRefs(rootNode, relationships)

    // #419-D evidence-tier classification for every emitted relationship
    // (family rules — go/rust/c/cpp all classify; zig did NOT).
    this.classifyEvidenceTier(relationships)

    // Z65: TARGET SCOPE — what a reverse walk can bind this edge to.
    this.annotateTargetScope(symbols, relationships)

    // No References edge for imports (imports stay in the imports array) and
    // no generic `exports module -> X` edge — `module` is not a symbol, so the
    // edge would never resolve (Java-family contract; the exports array and
    // the `pub` visibility metadata carry the export fact).
    //
    // Z1 (zig review): `complexity` was the synthetic symbols.length
    // heuristic beside per-symbol real complexities — the removed-
    // everywhere-else disease. Both fields report the real file-level
    // cyclomatic number (family contract, go parity).
    // M60 (#924, zig half): the published name surface — quoting syntax is not
    // part of a name.
    this.canonicalizePublishedNames(symbols, relationships, exports)

    const fileComplexity = this.zigBodyComplexity(rootNode)
    return {
      language: "zig",
      symbols,
      relationships,
      imports,
      exports,
      errors,
      metadata: {
        complexity: fileComplexity,
        cyclomaticComplexity: fileComplexity,
        linesOfCode: content.split("\n").length,
        patterns: [],
        framework: "Zig",
        hasFrameworkIntelligence: true,
        hasTypeInference: true,
      },
    }
  }

  /**
   * Calls + Uses (family contract, zig wave 2026-08-29).
   * Walks the tree tracking the enclosing function/method name; a
   * call_expression whose callee is an identifier or a field_expression emits
   * a `calls` edge to the callee LEAF (Rust/Go contract — shared callee
   * `self.repository.add` -> `add`); a field_expression that is NOT a call
   * callee emits a `uses` edge to its field leaf. Builtin calls (@import,
   * @intCast, ...) are compile-time intrinsics, NOT user symbols — skipped.
   */
  /**
   * Z59 — does this analyzer publish a SYMBOL for `fnNode`, so that naming it as
   * an edge SOURCE resolves?
   *
   * ## The defect this answers
   *
   * A `function_declaration` can be a MEMBER of a container the analyzer
   * deliberately publishes nothing for: a container written inside a function or
   * test body, a container with no name (`fn GenericStack(…) type { return
   * struct { fn push(…) } }`), or a container nested in an anonymous one. That is
   * the Z22 / C-negative contract and it is correct — such a type has no
   * file-scope identity.
   *
   * The three edge passes each took the nearest `function_declaration` /
   * `test_declaration` identifier as the source name WITHOUT asking whether a
   * symbol was published for it. So 5.05% of `calls` + `uses` + `instantiates`
   * edges over the full corpus (11,332 of 224,599) carried a source naming a
   * declaration the index does not hold: a caller that resolves to nothing.
   * Measured by `validation/m14/fixtures/zig/dangling-source-census.ts`, whose
   * residual class is 0, so this is the whole population and not a sample of it.
   *
   * ## The rule
   *
   * A function is published when it has NO container ancestor (a top-level `fn`),
   * or when its nearest container ancestor is bound to an identifier at FILE
   * SCOPE. Named is not sufficient: `const S = struct { … }` inside a test body is
   * a named LOCAL container and is not published either.
   *
   * `test_declaration` is answered separately by the callers: a named test is a
   * scope with a name (Z39) and NO symbol is published for one, so that class is
   * still dangling and is declared as a limitation rather than silently reverted.
   */
  private zigFunctionScopeIsPublished(fnNode: Node): boolean {
    let cur: Node | null = fnNode.parent
    while (cur) {
      if (ANONYMOUS_CONTAINER_NODES.has(cur.type)) {
        const binding = cur.parent
        if (!binding || binding.type !== "variable_declaration") return false
        let named = false
        for (let i = 0; i < binding.namedChildCount; i++) {
          const c = binding.namedChild(i)
          if (c && c.type === "identifier") { named = true; break }
        }
        if (!named) return false
        // Named AND at file scope: no executable scope and no other container
        // between the binding and the root.
        let up: Node | null = binding.parent
        while (up) {
          if (
            up.type === "function_declaration" ||
            up.type === "test_declaration" ||
            up.type === "comptime_declaration"
          ) return false
          if (ANONYMOUS_CONTAINER_NODES.has(up.type)) return false
          up = up.parent
        }
        return true
      }
      cur = cur.parent
    }
    return true
  }

  private analyzeZigCodeRelationships(
    rootNode: Node,
    relationships: ASTEngine.UniversalRelationship[],
    symbols: ASTEngine.UniversalSymbol[],
  ): void {
    const emittedCalls = new Set<string>()
    const emittedUses = new Set<string>()
    // Z66: the names this file binds by importing a module, read ONCE per file
    // (memoised on the root) rather than per edge site.
    const importAliases = zigImportAliases(rootNode)
    const stack: { node: Node; fn: string | null; inFn: boolean }[] = [{ node: rootNode, fn: null, inFn: false }]
    while (stack.length > 0) {
      const { node: n, fn, inFn } = stack.pop()!
      let nextFn = fn
      let nextInFn = inFn
      // Z39: a named `test` is a SCOPE with a name, and the attribution here skipped
      // it, so every call and read inside `test ParagraphStyle { const p = try
      // ParagraphStyle.create(...); defer p.release(); }` was attributed to
      // `(global)` — a file-scope source for work that is plainly inside one named
      // block. Found by the source-keyed gate (zigw-uses-calls.ts), which is the
      // only instrument that looks at this axis: the shared matcher discards the
      // source, so three such rows in 200 files were invisible, and the class is not
      // three rows, it is every read and call in every named test in the corpus.
      if (n.type === "function_declaration" || n.type === "test_declaration") {
        const nameNode = this.anyChild(n, (c) => c.type === "identifier")
        if (nameNode) {
          nextInFn = true
          // Z59: only a function the analyzer PUBLISHES may be named as a source.
          // An unpublished one (a member of a local or anonymous container) leaves
          // `nextFn` pointing at the nearest published scope further out, so the
          // walk keeps looking instead of naming a declaration that resolves to
          // nothing.
          if (n.type === "test_declaration" || this.zigFunctionScopeIsPublished(n)) {
            nextFn = nameNode.text
          }
        }
      }
      if (n.type === "call_expression") {
        const leafNode = this.zigCalleeLeafNode(n)
        const leaf = leafNode?.text
        // NOTE (zig wave, 2026-08-29): NO `leaf !== nextFn` guard here. A
        // same-named method called from within that method (IconDir.
        // writeResData calling entry.writeResData; initComptime calling
        // initComptime) is a REAL call edge, and the differential oracle
        // derives it without any name-guard. Dropping the guard restores
        // analyzer<->oracle parity (the old guard silently lost 5 edges on
        // the upstream corpus). Self-recursion (f -> f) is likewise a
        // legitimate edge and is kept.
        if (leaf) {
          // Top-level / comptime / test-block initializers (`const assert =
          // std.debug.assert;`, `test {...}`) are real call sites outside any
          // function body (go family contract: package-scope calls emit with
          // source "global").
          const source = nextInFn && nextFn ? nextFn : "(global)"
          // Z66: a call THROUGH an external import alias names the module member,
          // not a same-named local function. `std.debug.print` -> `calls ->
          // std.debug.print`, with the receiver in metadata. The bare leaf stays
          // the target for every other call, which is the shared callee-leaf
          // contract (rust/go) and is not weakened.
          const calleeExpr = n.namedChildCount > 0 ? n.namedChild(0) : null
          const ext = this.zigExternalReceiverPath(
            calleeExpr?.type === "field_expression" ? calleeExpr : undefined,
            importAliases,
          )
          const target = ext ? ext.target : leaf
          const k = `${source}->${target}`
          if (!emittedCalls.has(k)) {
            emittedCalls.add(k)
            relationships.push({
              source,
              target,
              type: ASTEngine.RelationshipType.Calls,
              confidence: 0.85,
              // M59.A7 (#825): the callee LEAF as written — the name-bearing
              // node, not the call expression (which a receiver can precede).
              ...(this.nodeLine(leafNode) ? { line_number: this.nodeLine(leafNode)! } : {}),
              metadata: {
                relationshipType: "zig_function_call",
                callExpression: n.text.slice(0, 60),
                ...(ext ? { zigExternalRef: true, zigImportAlias: ext.alias, zigImportModule: ext.module } : {}),
              },
            })
          }
        }
      }
      if (n.type === "field_expression" && !this.isCallCallee(n)) {
        const fieldNode = this.zigFieldLeafNode(n)
        const field = fieldNode?.text
        const notBuiltinAccess =
          this.anyChild(n, (c) => c.type === "identifier") !== null
        // ZGD1 (zig wave, M37 #600 — standing-rule write-gate class): an
        // assignment LHS is a WRITE, never a read. Zig assignments parse as
        // variable_declaration (probe-verified: `self.count = 5;` and
        // `self.count += 1;` are both variable_declaration nodes, LHS = first
        // named child) — gate only that LHS span, so the RHS of
        // `self.a = self.b` stays a genuine read.
        // Z15 (deep review): the gate tested the NODE and not the OPERATOR, so
        // it also swallowed the read of a COMPOUND assignment. `self.count += 1`
        // reads `self.count` and writes it; `while (i < n) : (i += 1)` is the
        // canonical read-modify-write in Zig. A plain `=` is a pure write, so
        // the operator is the discriminator the grammar already provides
        // (`variable_declaration` has 43,949 `type` fields and the `=` is an
        // anonymous token of its own type, distinct from `+=`).
        const isAssignLhs = this.isWriteLhs(n)
        // ZGD5 (same wave): `.bad` enum literals and `.{...}` init fields
        // parse as field_expression with a SINGLE named child — no base, so
        // they are not member accesses. `return .bad` emitted a phantom
        // `uses f->bad` (probe-verified).
        const isEnumLiteral = n.namedChildCount < 2
        // ZGD5b: a qualified TYPE ANNOTATION (`fn f() foo.Bar`, `w: io.Writer`)
        // is a namespace-qualified type reference — a declared-type fact, not
        // a runtime member READ. Type positions are direct children of the
        // declaration nodes (probe-verified); the declared-type graph already
        // carries the fact. `uses` stays reserved for runtime reads
        // (`return self.count`).
        const p = n.parent
        // Z38: the type-position test looked only at the DIRECT parent, so it could
        // not see a DOTTED type path. In this grammar `std.Build.LazyPath` is a
        // chain of `field_expression` nodes, so every SEGMENT of a qualified type in
        // a signature had a `field_expression` parent and none of them was
        // recognised as a type position — each one was published as a `uses` READ
        // of a type name, attributed to the function whose signature it appears in.
        // Measured by the source-keyed gate: 645 rows over 200 corpus files, and at
        // name level they are invisible, because the target is a real type name and
        // the row agrees with the name-level check. It also DUPLICATED the
        // declared-type class, which already publishes `references (declared-type) ->
        // Build` for the same text.
        //
        // The fix walks the path: a field_expression is in a type position when ANY
        // ancestor — through the dotted chain only, stopping at anything that could
        // make it a value — is a parameter, a container field, or a function\u0027s
        // declared return type. The walk is deliberately bounded by the value
        // contexts the analyzer already knows (call, block, assignment,
        // declaration-with-value, struct literal), because a type path that reaches
        // one of those is a VALUE read whatever its base looks like.
        const isTypePosition = (() => {
          const VALUE_BOUNDARY = new Set([
            "call_expression", "block", "block_expression", "arguments",
            "assignment_expression", "assignment_statement",
            "compound_assignment_statement", "struct_initializer",
            "anonymous_struct_initializer", "initializer_list",
            "composite_literal", "variable_declaration", "return_expression",
            "if_expression", "switch_expression", "while_expression", "for_expression",
          ])
          let cur: Node | null = p
          let hops = 0
          while (cur && hops < 8) {
            if (
              cur.type === "parameter" || cur.type === "container_field" ||
              cur.type === "function_declaration" || cur.type === "function_signature"
            ) return true
            if (VALUE_BOUNDARY.has(cur.type)) return false
            cur = cur.parent
            hops++
          }
          return false
        })()
        if (field && notBuiltinAccess && !isAssignLhs && !isEnumLiteral && !isTypePosition) {
          const source = nextInFn && nextFn ? nextFn : "(global)"
          // Z66: as for `calls`, a read whose receiver is an external import alias
          // names the module member. `std.mem.Allocator` -> `uses ->
          // std.mem.Allocator`. `notBuiltinAccess` already refuses a receiver the
          // grammar calls a builtin; this refuses the opposite mistake — a
          // receiver that IS a local module alias keeps its bare leaf, because
          // `c.zig`'s members are published under their own names.
          const ext = this.zigExternalReceiverPath(n, importAliases)
          const target = ext ? ext.target : field
          const k = `${source}->${target}`
          if (!emittedUses.has(k)) {
            emittedUses.add(k)
            relationships.push({
              source,
              target,
              type: ASTEngine.RelationshipType.Uses,
              confidence: 0.75,
              // M59.A7 (#825): the field LEAF as written.
              ...(this.nodeLine(fieldNode) ? { line_number: this.nodeLine(fieldNode)! } : {}),
              metadata: {
                relationshipType: "zig_field_access",
                fieldAccessExpression: n.text.slice(0, 60),
                ...(ext ? { zigExternalRef: true, zigImportAlias: ext.alias, zigImportModule: ext.module } : {}),
              },
            })
          }
        }
      }
      // Z24 (pass 24): `@field(S, "x")` reads the member `x` of `S` by name-as-text. The
      // read is the same fact `S.x` states, so it is a `uses` edge at the same confidence —
      // what the analyzer does NOT know is that the symbol the graph will bind `x` to is
      // `S`'s own member, which is exactly the inference `zig_field_access` already makes,
      // and that is why this is 0.75 and not 1.0. `@hasDecl` is deliberately absent; see
      // `zigReflectionFieldName` for the reason and the measured population.
      //
      // The dedup key is `emittedUses`' own `${source}->${field}` on purpose: Z52's
      // post-pass already collapses one `uses` edge per (source, target) keeping the higher
      // confidence, so a file that both reads `p.x` and reflects on it publishes ONE edge.
      // A separate key would have published the same target twice with two reason codes,
      // which is the defect Z52 was written to remove.
      const reflectedName = this.zigReflectionFieldName(n)
      if (reflectedName) {
        const source = nextInFn && nextFn ? nextFn : "(global)"
        const k = `${source}->${reflectedName.text}`
        if (!emittedUses.has(k)) {
          emittedUses.add(k)
          relationships.push({
            source,
            target: reflectedName.text,
            type: ASTEngine.RelationshipType.Uses,
            confidence: 0.75,
            // M59.A7 (#825): the line of the NAME, matching `zig_field_access`.
            ...(this.nodeLine(reflectedName) ? { line_number: this.nodeLine(reflectedName)! } : {}),
            metadata: {
              relationshipType: "zig_field_reflection",
              reflectedMember: reflectedName.text,
            },
          })
        }
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const c = n.namedChild(i)
        if (c) stack.push({ node: c, fn: nextFn, inFn: nextInFn })
      }
    }
  }

  /**
   * Z3: bare-identifier value reads (`return MAX`, `g(D)`, `m[k]` keys,
   * return operands). Every bare `identifier` naming a file-visible VALUE
   * (file-scope const/var/fn/enum-member) is a Uses edge, with:
   * - a lexical scope stack: function params bind at entry; block locals
   *   (variable_declaration names), payload captures (`|x|`), for/if/while
   *   payloads bind in walk order (reads before any binding still resolve
   *   outward — C-family flow discipline);
   * - declaration positions never read (first-identifier rule for
   *   variable_declaration; entity names; composite-literal keys are
   *   field_identifier-typed and auto-skip; labels/package/import paths/
   *   blank `_` excluded);
   * - call callees (span-matched; the calls branch owns them), member
   *   leaves (field path owns them; objects stay readable), qualified
   *   non-leaves, assignment LHS writes, test/comptime-exempt contexts all
   *   excluded;
   * - resolvability required: unknown names (std/dot-imported/external,
   *   macro-template `$x`) stay silent — no junk edges.
   */
  /**
   * M60 (#924, zig half): canonicalize the PUBLISHED name surface.
   *
   * Zig builds its symbols inline (no factory), so the strip lands here, at the
   * publish boundary — after every analysis pass, so nothing internal ever sees a
   * canonical spelling mid-walk (the bare-use inventory and the shadowing frames
   * are keyed on the SOURCE's own spellings and stay consistent with the tree),
   * and before the result leaves the analyzer.
   */
  /** Z35: is this right-hand side a module import? The two shapes the import
   *  branches recognise, in one place so three sites cannot disagree. */
  private isZigImportBinding(rhs: Node | null): boolean {
    if (!rhs) return false
    const host = rhs.type === "call_expression" || rhs.type === "builtin_function" ? rhs : null
    if (!host) return false
    for (let i = 0; i < host.namedChildCount; i++) {
      const c = host.namedChild(i)
      if (c && (c.type === "builtin_identifier" || c.type === "identifier")) {
        const t = String(c.text ?? "")
        return t === "@import" || t === "@cImport" || t === "import"
      }
    }
    return false
  }

  /**
   * Z30: every `@import("path")` / `@cImport(…)` SITE, whether or not the import
   * is the whole right-hand side.
   *
   * The three shape branches each ask "is the RHS exactly an @import?", so
   * `const v = @import("build.zig.zon").version;` (a .zon manifest read),
   * `const c = @import("c.zig").c;` (a module's C bindings) and
   * `try @import("apple_sdk").addPaths(b, lib);` (a call ON a module, not even a
   * declaration) fell through all of them: no fact, no edge, no symbol — 460 of
   * 1,918 sites, 24% of the class. It is a SITE PASS rather than a fourth shape
   * test, which is the lesson of this wave written down: a rule that enumerates
   * the shapes it has seen keeps losing the one it has not.
   *
   * Measured shape: `builtin_function[builtin_identifier, arguments]`, the path in
   * `arguments[string[string_content]]`. `@cImport({ @cInclude(…) })` nests its
   * include strings and has no module path of its own, so it records the fact and
   * publishes no edge — the same asymmetry the shape branches have.
   *
   * Dedupe key `(line, target)` against what the branches already pushed, so a
   * site they handled is not recorded twice.
   */
  private collectZigImportSites(
    rootNode: Node,
    imports: ASTEngine.ImportInfo[],
    relationships: ASTEngine.UniversalRelationship[],
  ): void {
    const stack: Node[] = [rootNode]
    const seenFacts = new Set<string>()
    for (const f of imports) seenFacts.add(`${f.range?.startLine ?? 0}|${f.module ?? ""}`)
    // TWO dedupe sets, one per TYPE. Keying both on "any isImport edge" was wrong
    // in a way only the fixture could see: the shape branches publish a
    // `references` twin, so every site they handled looked already-seen and the
    // pass skipped it — including its `imports` twin, which is the edge the whole
    // class exists for. Dedupe is per LABEL, exactly as the F5 matcher compares.
    const seenRefEdges = new Set<string>()
    const seenImportEdges = new Set<string>()
    for (const r of relationships) {
      if ((r.metadata as any)?.isImport && typeof r.line_number === "number") {
        const k = `${r.line_number}|${r.target}`
        if (r.type === ASTEngine.RelationshipType.Imports) seenImportEdges.add(k)
        else seenRefEdges.add(k)
      }
    }
    while (stack.length > 0) {
      const n = stack.pop()!
      if (n.type === "builtin_function" || n.type === "call_expression") {
        let id: Node | null = null
        if (n.type === "builtin_function") {
          for (let i = 0; i < n.namedChildCount; i++) {
            const c = n.namedChild(i)
            if (c && (c.type === "builtin_identifier" || c.type === "identifier")) { id = c; break }
          }
        } else {
          id = n.namedChildCount > 0 ? n.namedChild(0) : null
        }
        const text = String(id?.text ?? "")
        if (text === "@import" || text === "@cImport" || text === "import") {
          // Z66: ONE reader for "what path does this @import spell", shared with
          // `zigImportAliases`. The line anchor stays the STRING node, because that
          // is the site an `imports` edge must point at, and the string node is the
          // only place the literal is.
          const lit = zigImportModuleLiteral(n)
          if (lit) {
            const target = lit.module
            const line = this.nodeLine(lit.node) ?? 0
            const isUsingNamespace = n.parent?.type === "using_namespace_declaration"
            if (target && line > 0) {
              const k = `${line}|${target}`
              if (!seenFacts.has(k)) {
                seenFacts.add(k)
                imports.push({
                  module: target,
                  isDefaultImport: false,
                  range: this.nodeRange(n),
                  metadata: { zigImport: true, builtin: text, ...(isUsingNamespace ? { usingnamespace: true } : {}) },
                })
              }
              if (!seenImportEdges.has(k)) {
                seenImportEdges.add(k)
                relationships.push({
                  source: "(global)",
                  target,
                  type: ASTEngine.RelationshipType.Imports,
                  confidence: 0.9,
                  line_number: line,
                  metadata: { relationshipType: "zig_import", isImport: true, zigImportDep: true },
                })
              }
              if (!seenRefEdges.has(k)) {
                seenRefEdges.add(k)
                relationships.push({
                  source: "(global)",
                  target,
                  type: ASTEngine.RelationshipType.References,
                  confidence: 1.0,
                  line_number: line,
                  metadata: { relationshipType: "zig_import", isImport: true },
                })
              }
            }
          }
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) stack.push(c)
      }
    }
  }

  /**
   * Z32: `instantiates` for the two statically derivable classes — a call to an
   * in-file `fn … type`, and a construction of an in-file type (`TypeName{ … }`,
   * bare or QUALIFIED: `Color.C{ .r = 1 }`). The inventory is the tree's own
   * declarations, so the class needs no inference. `.{ … }` is an
   * anonymous_struct_initializer with no name and instantiates nothing (Z21).
   */
  private analyzeZigInstantiation(rootNode: Node, relationships: ASTEngine.UniversalRelationship[]): void {
    const typeNames = new Set<string>()
    const typeFns = new Set<string>()
    const inventory = (n: Node): void => {
      if (n.type === "function_declaration" || n.type === "function_signature") {
        const t = n.childForFieldName?.("type")
        if (t && (t.type === "builtin_type" || t.type === "identifier") && String(t.text) === "type") {
          for (let i = 0; i < n.namedChildCount; i++) {
            const c = n.namedChild(i)
            if (c && c.type === "identifier") { typeFns.add(String(c.text)); break }
          }
        }
      }
      if (n.type === "struct_declaration" || n.type === "enum_declaration" || n.type === "union_declaration" || n.type === "opaque_declaration") {
        const p = n.parent
        // Bound once: the guard below narrows on `p0?.type`, but TypeScript cannot carry that
        // narrowing through to a second `p.namedChild(0)` call, so calling it again on the next
        // line left `Object is possibly 'null'`. One binding is both the fix and cheaper.
        const p0 = p?.namedChild(0)
        if (p && p.type === "variable_declaration" && p.namedChildCount > 0 && p0?.type === "identifier") {
          typeNames.add(String(p0.text))
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) inventory(c)
      }
    }
    inventory(rootNode)
    if (typeNames.size === 0 && typeFns.size === 0) return
    const seen = new Set<string>()
    const enclosingName = (n: Node): string => {
      let cur: Node | null = n.parent
      while (cur) {
        if (cur.type === "function_declaration" || cur.type === "test_declaration") {
          for (let i = 0; i < cur.namedChildCount; i++) {
            const c = cur.namedChild(i)
            if (c && c.type === "identifier") {
              // Z59: same rule as the call/read pass, so an `instantiates` source
              // cannot disagree with a `calls` source on the same enclosing scope.
              if (cur.type === "test_declaration" || this.zigFunctionScopeIsPublished(cur)) {
                return String(c.text)
              }
              break
            }
          }
        }
        cur = cur.parent
      }
      return "(global)"
    }
    const push = (source: string, target: string, line: number, md: Record<string, unknown>): void => {
      if (!target || line <= 0) return
      const k = `${source}|${target}|${line}`
      if (seen.has(k)) return
      seen.add(k)
      relationships.push({
        source,
        target,
        type: ASTEngine.RelationshipType.Instantiates,
        confidence: 1.0,
        line_number: line,
        metadata: { relationshipType: "zig_instantiation", zigSpecific: true, isExternalTarget: false, ...md },
      })
    }
    const sites = (n: Node): void => {
      if (n.type === "call_expression") {
        const callee = n.namedChildCount > 0 ? n.namedChild(0) : null
        if (callee && callee.type === "identifier" && typeFns.has(String(callee.text))) {
          push(enclosingName(n), String(callee.text), this.nodeLine(callee) ?? 0, { isGenericTypeApplication: true })
        }
      }
      // `struct_literal` removed for the same reason as `field_identifier` above:
      // the pinned zig grammar declares no such node, so the second disjunct was
      // dead. `struct_initializer` is the real spelling.
      if (n.type === "struct_initializer") {
        const first = n.namedChildCount > 0 ? n.namedChild(0) : null
        if (first) {
          const raw = String(first.text ?? "")
          const nm = raw.includes(".") ? raw.slice(raw.lastIndexOf(".") + 1) : raw
          if (first.type !== "call_expression" && typeNames.has(nm)) {
            push(enclosingName(n), nm, this.nodeLine(first) ?? 0, { isConstructorApplication: true })
          }
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) sites(c)
      }
    }
    sites(rootNode)
  }

  /**
   * Z33: one `exports` relationship per exported declaration, GENERATED FROM the
   * export list so the array and the edges cannot drift — which is the failure the
   * `imports` twins already paid for once, when they were added to three shapes and
   * not the fourth and only a bidirectional gate caught it.
   *
   * Source is `(file)`, not `(global)`: the exporting entity is the compilation
   * unit, and `(global)` is this lane's marker for the EXPRESSION scope that reads
   * and imports are attributed to. Keeping them apart lets a consumer group an API
   * surface without guessing which convention a row used. The line is omitted —
   * never written as 0 — when a declaration carries none (#820).
   */
  private emitZigExportEdges(
    relationships: ASTEngine.UniversalRelationship[],
    exports: ASTEngine.ExportInfo[],
  ): void {
    const seen = new Set<string>()
    for (const e of exports) {
      const name = String(e.name ?? "")
      if (!name) continue
      const line = e.range?.startLine ?? 0
      const k = `${name}|${line}`
      if (seen.has(k)) continue
      seen.add(k)
      relationships.push({
        source: "(file)",
        target: name,
        type: ASTEngine.RelationshipType.Exports,
        confidence: 1.0,
        ...(line > 0 ? { line_number: line } : {}),
        metadata: { relationshipType: "zig_export", zigExport: true, exportKind: String(e.kind ?? "") },
      })
    }
  }

  private canonicalizePublishedNames(
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
    exports: ASTEngine.ExportInfo[],
  ): void {
    for (const s of symbols) {
      if (typeof s.name === "string") s.name = stripZigQuoting(s.name)
      if (typeof s.ownerName === "string") s.ownerName = stripZigQuoting(s.ownerName)
      if (typeof s.id === "string") s.id = stripZigQuoting(s.id)
      // Z31: the TYPE-bearing payload was left out of this pass, so one declared
      // type was published two ways in one result — `references (declared-type) ->
      // weird type` (an EDGE, stripped) beside `returnType: @"weird type"` (a symbol
      // FIELD, not). A consumer matching a declared type against a published name
      // or an edge target cannot resolve a quoted type at all, which is the class
      // Z18 fixed on the edge side. The class is small in the wild (0 of 8,273
      // symbols over 400 corpus files carry a quoted payload type) and that is
      // exactly why a SYNTHETIC fixture is the instrument for it: a corpus census
      // reads 0 and the defect is still live. Complete or it is a partial fix
      // wearing a complete fix's name, hence the five surfaces.
      if (typeof (s as any).returnType === "string") (s as any).returnType = stripZigQuoting((s as any).returnType)
      for (const p of (s as any).parameters ?? []) {
        if (typeof p?.type === "string") p.type = stripZigQuoting(p.type)
        if (typeof p?.name === "string") p.name = stripZigQuoting(p.name)
      }
      for (const key of ["genericParameters", "decorators", "comments"] as const) {
        const arr = (s as any)[key]
        if (Array.isArray(arr)) (s as any)[key] = arr.map((v: any) => (typeof v === "string" ? stripZigQuoting(v) : v))
      }
    }
    for (const r of relationships) {
      if (typeof r.source === "string") r.source = stripZigQuoting(r.source)
      if (typeof r.target === "string") r.target = stripZigQuoting(r.target)
    }
    for (const e of exports) {
      if (typeof e.name === "string") e.name = stripZigQuoting(e.name)
    }
  }

  private analyzeZigBareIdentifierUses(
    rootNode: Node,
    relationships: ASTEngine.UniversalRelationship[],
    symbols: ASTEngine.UniversalSymbol[],
  ): void {
    const fileValues = new Set<string>()
    // Enum members live in one global error/value namespace in Zig
    // (`error.Bad` reads the variant regardless of which set declared it),
    // so they resolve by name even when owned.
    const enumMemberNames = new Set<string>()
    for (const s of symbols) {
      if (s.kind === ASTEngine.SymbolKind.EnumMember) enumMemberNames.add(s.name)
      if (
        !s.ownerName &&
        (s.kind === ASTEngine.SymbolKind.Constant ||
          s.kind === ASTEngine.SymbolKind.Variable ||
          s.kind === ASTEngine.SymbolKind.Function ||
          s.kind === ASTEngine.SymbolKind.EnumMember)
      ) {
        fileValues.add(s.name)
      }
    }
    const emitted = new Set<string>()
    interface ScopeFrame {
      names: Set<string>
      fnName: string | null
    }
    const scopeStack: ScopeFrame[] = []
    const isShadowed = (name: string): boolean => {
      for (let i = scopeStack.length - 1; i >= 0; i--) {
        if (scopeStack[i].names.has(name)) return true
      }
      return false
    }
    // NOTE (M49 W9, registered defect — NOT fixed here): this walk binds EVERY
    // identifier in the node's subtree, so a name that appears only in a
    // parameter's TYPE becomes a binding and shadows the real file-level value
    // for the whole function. Probe-verified: in
    //     const FLAG = 1;
    //     fn typeField(s: struct { FLAG: u8 }) void { _ = FLAG; }
    // the genuine read `_ = FLAG` emits ZERO `uses` edges, and `w: io.Writer`
    // likewise swallows reads of a global named `io`. The correct model is
    // "a binding is a declared NAME, not a subtree" (first identifier child of
    // a `parameter`; the direct identifier children of a `payload`). A fix was
    // written and measured against the zls corpus, but it must land together
    // with the zig ORACLE in script/m14/differential.ts (the oracle derives the
    // signature-region reads this fix suppresses — measured 5 MISSING), and
    // that oracle is another wave's in-flight work, so the fix is held rather
    // than half-landed. Registered in reviews/m49-w9-fixture-coverage-
    // adjudication.md + validation/m49/ledger.json (W9).
    // Z7 (extreme review): a parameter's binding is its declared NAME, not
    // its subtree. The entry pre-walk used to bind every identifier under a
    // parameter node, so a name appearing only in a parameter's TYPE (or
    // default value position) shadowed the real file-level value for the
    // whole function (`s: struct { Flag: u8 }` swallowed `_ = Flag`;
    // `x: T` swallowed the comptime type use; `x: u32 = Def` swallowed the
    // default-value read). Probe-pinned on synthetics; both sides.
    const bindParamName = (node: Node, frame: ScopeFrame): void => {
      for (let i = 0; i < node.namedChildCount; i++) {
        const c = node.namedChild(i)
        if (c && c.type === "identifier") {
          if (c.text !== "_") frame.names.add(c.text)
          return
        }
      }
      // Defensive fallback (every valid parameter has a name): first
      // identifier anywhere under the node.
      const any = this.anyChild(node, (c) => c.type === "identifier")
      if (any && any.text !== "_") frame.names.add(any.text)
    }
    const bindIdentifiersUnder = (node: Node, frame: ScopeFrame): void => {
      const walk: Node[] = [node]
      while (walk.length > 0) {
        const m = walk.pop()!
        // Never descend into nested executable/code bodies for bindings —
        // their names belong to inner scopes (collected when visited), and
        // never into call/composite arguments (those read).
        //
        // F6 audit: this list named `composite_literal` / `func_literal` —
        // rust/go vocabulary that cannot occur in tree-sitter-zig, so neither
        // stop could ever fire. They are removed; the live stops
        // (`call_expression`, `block`, `block_expression`) are unchanged, so
        // this is a pure dead-code removal.
        if (
          m !== node &&
          (m.type === "call_expression" || m.type === "block" ||
            m.type === "block_expression")
        ) {
          continue
        }
        if (m.type === "identifier" && m.text !== "_") frame.names.add(m.text)
        for (let i = m.namedChildCount - 1; i >= 0; i--) {
          const c = m.namedChild(i)
          if (c) walk.push(c)
        }
      }
    }
    // A defining occurrence never reads: the first identifier child of a
    // variable_declaration (`const MAX = ..`, `x = ..` LHS) or of an entity
    // item (fn/struct/enum/mod/type names).
    const isDefiningOccurrence = (node: Node): boolean => {
      const p = node.parent
      if (!p) return false
      if (p.type === "variable_declaration" || p.type === "assignment_expression") {
        // Z15 (deep review): a COMPOUND assignment is not a definition, it is a
        // read-modify-write — `counter += 1` reads the global `counter` before
        // writing it, and `while (i < n) : (i += 1)` is Zig's own idiom for it.
        // The old test suppressed the read of every compound assignment, so a
        // global written with `+=` was invisible to the read graph. Plain `=`
        // stays a definition (a declaration binds, an assignment writes).
        //
        // Z29 (wave 3, 2026-09-29): the LHS test is NODE IDENTITY with the first
        // named child, the same rule `isWriteLhs` below already used — so the two
        // sites in this file now agree instead of one being right. "The first
        // named child of type `identifier`" is not the LHS when the LHS is a
        // field expression: in `exe.stack_size = stack_size` (zig/build.zig:727)
        // the first IDENTIFIER child is the VALUE, so the test declared the read
        // to be a definition and the analyzer published no `uses -> stack_size`
        // at all — a real read of a file-scope constant, lost. One row in 1,200
        // files, found only because the truth exists: a LOSS is invisible to any
        // count of what was published.
        if (!this.isPlainAssignment(p)) return false
        const lhs = p.namedChildCount > 0 ? p.namedChild(0) : null
        return !!lhs && lhs.id === node.id
      }
      // Error sets declare EVERY direct member (`error{ A, B }`) — unlike
      // single-name items, there is no first-only rule here.
      if (p.type === "error_set_declaration" && node.type === "identifier") return true
      // F6 audit: `struct_item` / `enum_item` / `union_item` / `type_item` /
      // `mod_item` / `package_clause` are rust/go node names — none exists in
      // tree-sitter-zig, so those six disjuncts could never fire, and the
      // sibling `type_identifier` / `field_identifier` child checks could never
      // match either (zig spells every one of these `identifier`). The real
      // zig declaring forms are all covered without them: a `const X = struct
      // {...}` / `const T = u32` name is an `identifier` child of
      // `variable_declaration` (handled above); container members are
      // `container_field`; error-set members are handled above; fn/test names
      // are `function_declaration` / `test_declaration`.
      if (
        p.type === "function_declaration" || p.type === "test_declaration" ||
        p.type === "container_field" || p.type === "error_set_declaration"
      ) {
        for (let i = 0; i < p.namedChildCount; i++) {
          const c = p.namedChild(i)
          if (c && c.type === "identifier") {
            return c.startIndex === node.startIndex && c.endIndex === node.endIndex
          }
        }
      }
      return false
    }
    const isCallCallee = (node: Node): boolean => {
      // The callee is namedChild(0) of the call (identifier, field or
      // generic/builtin wrapper): anything under it is the callee subtree.
      let top: Node = node
      let p: Node | null = node.parent
      while (p && p.type !== "call_expression" && p.type !== "block" && p.type !== "function_declaration") {
        top = p
        p = p.parent
      }
      if (!p || p.type !== "call_expression") return false
      const first = p.namedChildCount > 0 ? p.namedChild(0) : null
      return !!first && top.startIndex >= first.startIndex && top.endIndex <= first.endIndex
    }
    const stack: Array<{ node: Node; exit: boolean; pushed: boolean }> = [{ node: rootNode, exit: false, pushed: false }]
    while (stack.length > 0) {
      const { node, exit, pushed } = stack.pop()!
      if (exit) {
        if (pushed) scopeStack.pop()
        continue
      }
      const t = node.type
      let pushedScope = false
      if (t === "function_declaration" || t === "test_declaration") {
        // Z39, second site: the bare-read pass built its `fnName` frame for
        // `function_declaration` only, so a read inside a named TEST was
        // attributed to `(global)` here too. Both passes now agree on what a named
        // scope is, which is the point — two spellings of one rule is how Z24/Z25/
        // Z29 happened.
        // Parameters bind at entry (identifiers in parameter nodes; type
        // positions are type_identifier-typed and auto-skip).
        const frame: ScopeFrame = { names: new Set<string>(), fnName: null }
        const params: Node[] = [node]
        while (params.length > 0) {
          const m = params.pop()!
          if (m.type !== "function_declaration" || m === node) {
            if (m.type === "parameter") bindParamName(m, frame)
            for (let i = m.namedChildCount - 1; i >= 0; i--) {
              const c = m.namedChild(i)
              // Do not descend into the body here (it gets its own scope
              // frames as the walk continues); do not cross nested items.
              if (c && c.type !== "block" && c.type !== "block_expression" && c.type !== "function_declaration") params.push(c)
            }
          }
        }
        const nm = this.anyChild(node, (c) => c.type === "identifier")
        // Z59: `fnName: null` on an UNPUBLISHED function is the fix, not an
        // omission — the read's source is read off the stack by scanning outward
        // for the first non-null `fnName`, so a null here makes the read fall
        // back to the nearest published scope exactly as the other two passes do.
        frame.fnName =
          nm && (node.type === "test_declaration" || this.zigFunctionScopeIsPublished(node))
            ? nm.text
            : null
        scopeStack.push(frame)
        pushedScope = true
      } else if (t === "block" || t === "block_expression") {
        scopeStack.push({ names: new Set<string>(), fnName: null })
        pushedScope = true
      } else if (t === "switch_case") {
        // Z6 (extreme review): payload captures are scoped to their own
        // switch arm — binding them into the enclosing block/function frame
        // leaked the capture past the arm (a post-switch genuine read of a
        // same-named file value was swallowed) and left file-scope switches
        // with no frame at all (a global capture name emitted a junk bare
        // read). The case frame is empty at entry so arm PATTERNS (walked
        // before the payload binds) still resolve outward; the payload
        // binds into this frame and the arm body reads it; the frame pops
        // at case exit. if/while/for/catch payloads keep the enclosing
        // binding (their else/continuation arms share the construct — a
        // documented single-pass boundary, see Z10).
        scopeStack.push({ names: new Set<string>(), fnName: null })
        pushedScope = true
      } else if (t === "payload") {
        // Capture bindings (`|x|`, `|*x|`, `|a, b|`) bind in the current
        // (innermost) scope.
        const top = scopeStack.length > 0 ? scopeStack[scopeStack.length - 1] : null
        if (top) bindIdentifiersUnder(node, top)
      } else if (t === "variable_declaration") {
        // LHS/first-identifier bindings (order-independent within the
        // statement: bind at the declaration node before descending, so no
        // read can leak through ordering). C6: ONLY `var`/`const`
        // declarations bind — a plain assignment (`g = v`, same node type
        // per ZGD1) WRITES a global; binding it would swallow later genuine
        // reads of that global.
        const top = scopeStack.length > 0 ? scopeStack[scopeStack.length - 1] : null
        if (top && (this.hasToken(node, "var") || this.hasToken(node, "const"))) {
          for (let i = 0; i < node.namedChildCount; i++) {
            const c = node.namedChild(i)
            if (!c) continue
            if (c.type === "identifier") {
              if (c.text !== "_") top.names.add(c.text)
              break
            }
            break
          }
        }
      } else if (t === "identifier") {
        const name = node.text
        const p = node.parent
        // Error-type leaf rule (mirrors the zig oracle rod for rod): an
        // enum member resolves BY NAME only as the leaf of an `error.X`
        // occurrence that is a VALUE position — a parameter's error type,
        // or a container field's error type, is a declared-type fact, not
        // a read. Bare enum-member names never resolve in Zig (`red` alone
        // is invalid; switch patterns are enum literals), so without this
        // gate every same-named type/field identifier would emit junk.
        let inError = false
        if (p && p.type === "error_type" && p.namedChildCount > 0) {
          const last = p.namedChild(p.namedChildCount - 1)
          if (last && last.startIndex === node.startIndex && last.endIndex === node.endIndex) {
            let q: Node | null = p.parent
            let typePos = false
            while (q) {
              if (q.type === "parameter" || q.type === "container_field") { typePos = true; break }
              if (
                q.type === "variable_declaration" || q.type === "arguments" ||
                q.type === "return_expression" || q.type === "call_expression" ||
                q.type === "function_declaration" || q.type === "block" ||
                q.type === "block_expression"
              ) break
              q = q.parent
            }
            if (!typePos) inError = true
          }
        }
        if (
          name && name !== "_" && !name.startsWith("$") &&
          !isDefiningOccurrence(node) &&
          !isCallCallee(node) &&
          !(p && p.type === "field_expression") &&
          // F6 audit: the former `label_name` / `continue_label` disjuncts are
          // rust vocabulary — tree-sitter-zig labels are `block_label` /
          // `break_label` (both live here) and a `continue :outer` label is an
          // anonymous token with no identifier child to suppress.
          !((p && p.type === "labeled_statement") ||
            (p && p.type === "block_label") || (p && p.type === "break_label")) &&
          !isShadowed(name) &&
          (fileValues.has(name) || (inError && enumMemberNames.has(name)))
        ) {
          let fnName: string | null = null
          for (let i = scopeStack.length - 1; i >= 0; i--) {
            if (scopeStack[i].fnName) {
              fnName = scopeStack[i].fnName
              break
            }
          }
          const src = fnName ?? "(global)"
          const key = `${src}::uses::${name}`
          if (!emitted.has(key)) {
            emitted.add(key)
            relationships.push({
              source: src,
              target: name,
              type: ASTEngine.RelationshipType.Uses,
              confidence: 1.0,
              // M59.A7 (#825): the read occurs on the identifier's own line.
              ...(this.nodeLine(node) ? { line_number: this.nodeLine(node)! } : {}),
              metadata: { relationshipType: "identifier_usage", nodeType: node.type },
            })
          }
        }
      }
      stack.push({ node, exit: true, pushed: pushedScope })
      for (let i = node.namedChildCount - 1; i >= 0; i--) {
        const child = node.namedChild(i)
        if (child) stack.push({ node: child, exit: false, pushed: false })
      }
    }
  }

  // F6 audit — REMOVED: `hasZigQualifiedAncestor`. Its only `true` return was
  // `cur.type === "qualified_type"`, and tree-sitter-zig has no such node (a
  // qualified type `std.mem.Allocator` is a nested `field_expression`,
  // probe-verified), so the function returned false for every input and the
  // `!this.hasZigQualifiedAncestor(node)` guard it fed was a no-op. Its
  // boundary names were equally dead (`field_declaration`, `composite_literal`,
  // `assignment_statement` are rust/go names; zig uses `container_field`,
  // `struct_initializer`, `variable_declaration`). The intended suppression of
  // type-position reads is already done by the direct `field_expression`
  // parent check at the call site; re-pointing this at `field_expression`
  // would have dropped genuine receiver reads instead.

  /** Builtin @-prefixed calls and generic type applications are not user
   *  call targets. Returns the leaf name for a real user call site, else
   *  undefined. */
  private zigCalleeLeafNode(call: Node): Node | undefined {
    const callee = call.namedChildCount > 0 ? call.namedChild(0) : null
    if (!callee) return undefined
    if (callee.type === "identifier") {
      // ZGD4: `usingnamespace` is a builtin keyword-like import operator, not
      // a user symbol — `pub const io = usingnamespace @import("io.zig")`
      // fabricated a `calls -> usingnamespace` edge (probe-verified).
      if (callee.text === "usingnamespace") return undefined
      // Skip builtin intrinsics (@foo).
      return callee
    }
    if (callee.type === "field_expression") {
      return this.zigFieldLeafNode(callee)
    }
    // call_expression whose callee is a builtin_function / generic_identifier
    // / pointer_wrapped — not a plain user call.
    return undefined
  }

  // Z17 (deep review) — REMOVED as dead: `zigCalleeLeaf` and `zigFieldLeaf`,
  // the string-returning wrappers around the two `*Node` accessors below. Every
  // call site uses the NODE form, because every emitted edge needs the site line
  // (M59.A7 #825); the string forms had no caller. `zigTypeLeaf` (the same
  // wrapper for the type leaf) went the same way, and `nameLine` — a helper for
  // the C/C++ lanes' attribute-line-base rule, never called here, so the zig lane
  // has no `#920` line rule to claim. Dead code in a review wave is a claim
  // about a contract that is not implemented, and four of them were sitting in
  // the file.

  /** The name-bearing field LEAF of a field_expression (`std.math.abs` ->
   *  `abs`, `list.items` -> `items`) — the node whose text is the edge's target
   *  and whose line is the edge's site (M59.A7 #825). */
  private zigFieldLeafNode(expr: Node): Node | undefined {
    const last = expr.namedChildCount > 0 ? expr.namedChild(expr.namedChildCount - 1) : null
    if (last && last.type === "identifier") return last
    return undefined
  }

  /** True when this field_expression is the direct callee of a call_expression
   *  (list.append in `list.append()`) — then the calls edge is the fact, not
   *  a uses edge. Also skips builtin access `std.foo`. */
  private isCallCallee(expr: Node): boolean {
    const p = expr.parent
    return !!p && p.type === "call_expression"
  }

  /**
   * Z66 — the dotted path a read's receiver spells, when the receiver is an
   * EXTERNAL `@import` alias, else null. The path is written out of the tree,
   * segment by segment, so it is a parse fact and not a guess.
   *
   * `std.mem.Allocator` reaches the edge layer as the leaf `Allocator` alone; this
   * walks up the `field_expression` chain to the root identifier and, if that root
   * is a name this file binds by importing a BARE module path, returns
   * `std.mem.Allocator`. A chain that breaks anywhere — a call result receiver
   * (`std.io.getStdOut().writer()`), an anonymous enum literal (`.bad`, one named
   * child and no base), a computed base — returns null and the edge stays as it
   * was, because a path this analyzer cannot spell out of the tree is a path it
   * must not publish.
   *
   * The name is emitted in place of the leaf and the receiver is recorded in
   * metadata, so the edge says which module it names (`zigImportAlias`,
   * `zigImportModule`) and a consumer can EXCLUDE it from its own unresolved count
   * with a declared reason instead of inferring one. That is the whole of the
   * `imports`-module-path defect's cost: `diagnose-incoming` reads 404 / 1,024 /
   * 2,585 unresolved targets for zig with 0 module-wildcard shaped, because the
   * target was the leaf, so nothing about the edge said `std`.
   */
  private zigExternalReceiverPath(
    expr: Node | undefined,
    aliases: Map<string, ZigImportAlias>,
  ): { target: string; alias: string; module: string } | null {
    if (!expr || expr.type !== "field_expression" || aliases.size === 0) return null
    // An anonymous enum literal (`.bad`) is a field_expression with ONE named child
    // and no base. It is not a member access and has no receiver to qualify.
    if (expr.namedChildCount < 2) return null
    // The nesting is DOWNWARD: `a.b.c` is field(base = field(base = a, b), c). So the
    // walk is a descent through the bases from the node the EDGE is about, collecting
    // each field in written order.
    //
    // It must start at the edge's own field_expression, not at the outermost one. The
    // walk visits every `field_expression` in a chain, and `std.debug.assert` produces
    // a `uses` edge for the INNER `std.debug` as well as the `calls` edge for the
    // whole thing; starting at the outermost gave the inner read the longer path
    // `std.debug.assert`, which names an access this file did not make at that node.
    const segments: string[] = []
    let node: Node = expr
    let root = ""
    let depth = 0
    while (depth++ < 64) {
      const fieldNode = node.namedChild(node.namedChildCount - 1)
      if (!fieldNode || fieldNode.type !== "identifier") return null
      segments.push(stripZigQuoting(String(fieldNode.text ?? "")))
      const base = node.namedChild(0)
      if (!base) return null
      if (base.type === "identifier") { root = stripZigQuoting(String(base.text ?? "")); break }
      // a call result receiver (`std.io.getStdOut().writer()`) is not a name, and a
      // computed base is not a path: both are refused rather than guessed at
      if (base.type !== "field_expression") return null
      node = base
    }
    if (root === "") return null
    const hit = aliases.get(root)
    if (!hit || !hit.external) return null
    segments.reverse()
    return { target: `${root}.${segments.join(".")}`, alias: root, module: hit.module }
  }

  /**
   * The field_expression a leaf NAME belongs to, when the leaf is the LAST named
   * child of one — i.e. when the leaf really is the final segment of that access
   * rather than an identifier found somewhere under it. The declared-type pass reads
   * leaves by a breadth-first walk (Z19), so for an unnamed fn-TYPE parameter the leaf
   * can be a BASE segment; qualifying from there would name a path the annotation
   * does not end at, so that case is refused instead.
   */
  private zigTrailingFieldExpr(leaf: Node | undefined): Node | undefined {
    if (!leaf) return undefined
    const parent = leaf.parent
    if (!parent || parent.type !== "field_expression") return undefined
    if (parent.namedChild(parent.namedChildCount - 1)?.id !== leaf.id) return undefined
    return parent
  }

  /**
   * Declared-type reference graph (family standard — go/c/rust M14). Collects
   * the leaf names of parameter types, return types, and struct/union/enum/
   * error-set field types, emitting `references` edges. Builtins and the bare
   * `void`/`!void` wrappers are excluded; generic type applications on a var
   * RHS (std.StringHashMap(usize)) are NOT declared-type deps.
   */
  private extractZigDeclaredTypeRefs(
    rootNode: Node,
    relationships: ASTEngine.UniversalRelationship[],
  ): void {
    const emitted = new Set<string>()
    // Z66: same alias map as the two code-relationship passes, and the same rule —
    // a declared type written through an external import alias names the module's
    // type. `var gpa: std.heap.GeneralPurposeAllocator` -> `references ->
    // std.heap.GeneralPurposeAllocator`, which is the ONLY spelling of that type
    // anywhere in the corpus and is exactly what a consumer needs to exclude an
    // external dependency by a rule rather than by a guess.
    const importAliases = zigImportAliases(rootNode)
    // `site` is the type node the leaf name was read from — M59.A7 (#825) wants
    // the reference line of the NAME, not of the enclosing declaration.
    const push = (leaf: string, site?: Node) => {
      if (!leaf) return
      // Z18 (deep review): the receiver here is a TYPE LEAF, and a leaf is
      // always an `identifier` node's text — so the three text surgeries this
      // line used to carry could only ever have fired on a QUOTED identifier,
      // where they CORRUPT a legitimate name: `@"zig lib"` was published as
      // `@"ziglib"`, `@"weird function name"` as `@"weirdfunctionname"`, and
      // `@"Responds to foo(): %@"` as `@"Respondstofoo():%@"`. Measured over
      // the three pinned corpora: 1,916 of the 34,132 quoted identifiers have a
      // character in the junk class (`!`, `*`, whitespace, `[`, `]`, `{`, `}`),
      // and on a plain identifier — `[A-Za-z_][A-Za-z0-9_]*`, no `<or>`, no
      // `=` — all three are provable no-ops. So removing them is a fix, not a
      // cleanup, and the source spelling is what the rest of the analyzer
      // already publishes (symbol names, `uses` field leaves, call leaves), so
      // the graph stays internally consistent.
      // Zero-regex: the two remaining tests are a Set membership and a
      // character-code range.
      const head = leaf
      // Z57: a builtin-looking NAME that this file DECLARES is not a builtin
      // reference. `zig/test/behavior/basic.zig` does `const @"u8" = u16;` and then
      // `const c: @"u8" = 300;` — a user type alias whose name happens to be a
      // builtin — and `zls/.../Interner.zig` declares `f80`. Both were invisible to
      // the graph.
      //
      // The bug was SPELLING, not declaration: the quoted `@"u8"` slipped past the
      // name filter while the plainly-spelled `f80` did not, so whether a user's own
      // type reached the declared-type graph depended on whether they had quoted it.
      // That is the same name-keyed blindness as #963 and the quoting family — a rule
      // that cannot see that a name is locally declared — and it is fixed the same
      // way, on both sides of the comparison, or the two will simply disagree.
      if (!head || (ZIG_DECLARED_TYPE_BUILTINS.has(head) && !zigFileScopeNames(rootNode).has(head))) return
      // ≡ /^\d/ — first char is 0-9 (rejects `123abc`-style heads). A quoted
      // identifier starts with `@`, so it is exempt by construction.
      const c0 = head.charCodeAt(0)
      if (c0 >= 48 && c0 <= 57) return
      const ext = this.zigExternalReceiverPath(this.zigTrailingFieldExpr(site), importAliases)
      const target = ext ? ext.target : head
      if (!emitted.has(target)) {
        emitted.add(target)
        relationships.push({
          source: "(declared-type)",
          target,
          type: ASTEngine.RelationshipType.References,
          confidence: 0.9,
          // M59.A7 (#825): the type as written at this site.
          ...(this.nodeLine(site) ? { line_number: this.nodeLine(site)! } : {}),
          metadata: {
            relationshipType: "declared_type",
            ...(ext ? { zigExternalRef: true, zigImportAlias: ext.alias, zigImportModule: ext.module } : {}),
          },
        })
      }
    }
    const stack: Node[] = [rootNode]
    while (stack.length > 0) {
      const n = stack.pop()!
      if (n.type === "function_declaration" || n.type === "function_signature") {
        const paramsNode = this.anyChild(n, (c) => c.type === "parameters")
        if (paramsNode) {
          for (let i = 0; i < paramsNode.namedChildCount; i++) {
            const param = paramsNode.namedChild(i)
            if (param?.type !== "parameter") continue
            const tNode = this.zigTypeLeafNode(param)
            if (tNode) push(tNode.text, tNode)
          }
        }
        // Z19 (deep review): the return type is read off the grammar's `type`
        // FIELD — the corpus census measured 37,129 of 37,129 function
        // declarations carrying one, and 0 of the type nodes carrying a field
        // of that name (so preferring it can never take the wrong side of a
        // `!`). The old list of accepted node types was a guess that silently
        // dropped every return type it did not name: `array_type`
        // (`fn f() [4]Widget`), `error_type` (`fn f() error{Boom}!void`),
        // `anyframe_type`, `labeled_type_expression`. The node-type test is
        // kept as the fallback for a grammar variant that does not name it.
        const retNode = this.typeFieldOf(n) ?? this.zigFallbackReturnType(n)
        const retLeafNode = retNode ? this.leafOfTypeNode(retNode) : undefined
        if (retLeafNode) push(retLeafNode.text, retLeafNode)
      }
      if (n.type === "container_field") {
        // struct/union field type. Z13: an ENUM member is the same node type
        // with no `type` field and a value instead — `zigTypeLeafNode` returns
        // undefined for it, so a member's default (`size: Size = .byte`, or a
        // bare `normal = 0`) is never mistaken for a type.
        const tNode = this.zigTypeLeafNode(n)
        if (tNode) push(tNode.text, tNode)
      }
      // Z16 (deep review): the LOCAL annotation is the fourth family position
      // (`var x: MyType = ...`) and the collector covered three of the four —
      // field, parameter, return. `variable_declaration` carries a `type` field
      // 43,949 times in the pinned corpora. The `emitted` set keeps the
      // overlap with the other positions from becoming a second edge.
      if (n.type === "variable_declaration") {
        const tField = this.typeFieldOf(n)
        if (tField) {
          const leaf = this.leafOfTypeNode(tField)
          if (leaf) push(leaf.text, leaf)
        }
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const c = n.namedChild(i)
        if (c) stack.push(c)
      }
    }
  }

  /**
   * The history this replaced, kept because the field-based version is only
   * better if the field is really there (deep-review fixes, 2026-08-29):
   *   (1) builtin_type nodes were dropped because they shadowed the real leaf —
   *       `map: *std.StringHashMap(usize)` returned `usize`. Z13 keeps that
   *       exclusion (it is a value filter, in `push`) and fixes the cause: the
   *       leaf is read from the `type` FIELD, so a generic ARGUMENT can no
   *       longer be the answer because it is no longer in scope.
   *   (2) the first identifier was dropped as the declared name. Z13 drops the
   *       whole guess — the field is the name's sibling, not its predecessor.
   *   (3) enum members yielded undefined, and still do: a `container_field`
   *       with no `type` field IS the enum member, which is now the test
   *       instead of a consequence.
   */

  /**
   * True when a `struct_initializer` initializes an array/slice OF TYPES —
   * `pub const Implements = [_]type{ gtk.Scrollable };` — so the declaration is
   * a type, not a value. Measured on the pinned corpora: every one of the 32
   * upper-case `struct_initializer` declarations is of this form, while the
   * 467 lower-case ones are ordinary values (`[_]u8{ 1, 2, 3 }`, `Point{}`), and
   * the element type is a direct child (`array_type` / `slice_type` carrying the
   * `type`, `comptime_int` or `comptime_float` builtin).
   */
  private isTypeValuedInitializer(init: Node): boolean {
    for (let i = 0; i < init.namedChildCount; i++) {
      const c = init.namedChild(i)
      if (!c) continue
      if (c.type !== "array_type" && c.type !== "slice_type") continue
      for (let j = 0; j < c.namedChildCount; j++) {
        const e = c.namedChild(j)
        if (e && (e.type === "builtin_type") && (e.text === "type" || e.text === "comptime_int" || e.text === "comptime_float")) return true
      }
    }
    return false
  }

  /**
   * A `labeled_type_expression` that is really a labeled BLOCK — `const V =
   * cvalue: { … break :cvalue v; }` — yields a VALUE, whatever the name's case.
   *
   * The grammar has ONE node type for both Zig forms (3,900 occurrences in the
   * pinned corpora): `L: { … break :L v; }` is a labeled block and
   * `L: T { … return v; }` is a labeled type, and the two differ in the block
   * they carry — a block leaves by `break :label`, a type by `return`. Measured
   * over 400 corpus files: 9 of 9 labeled_type_expression right-hand sides
   * break and none returns, and the six with an upper-case name
   * (`pub const CValue = cvalue: { … }`, `pub const Key = key: { … }`) were
   * published as `Type` for what are comptime-computed struct values.
   */
  private isLabeledBlockValue(rhs: Node): boolean {
    if (rhs.type !== "labeled_type_expression") return false
    let hasBreak = false
    let hasReturn = false
    const stack: Node[] = [rhs]
    let guard = 0
    while (stack.length > 0 && guard++ < 500) {
      const n = stack.pop()!
      if (n.type === "break_label") hasBreak = true
      if (n.type === "return_expression") hasReturn = true
      if (hasReturn) return false
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const c = n.namedChild(i)
        if (c) stack.push(c)
      }
    }
    return hasBreak
  }

  /**
   * The identifier NODE that names a declaration's type, so a declared-type
   * reference can carry the line the type is written on (M59.A7 #825).
   *
   * Z13 (deep review, 2026-09-28) — this used to walk EVERY `identifier` under
   * the declaration node, drop the first (assumed to be the declared name) and
   * take the last. The grammar does not require that guess: it hands the type
   * over as a FIELD (`parameter.type` 78,895, `container_field.type` 49,424,
   * `variable_declaration.type` 43,949, `function_declaration.type` 37,129 in
   * the pinned corpora), and no TYPE node carries a field of that name, so
   * preferring it can never pick the wrong side of an `!` or a `.*`.
   *
   * The walk was wrong wherever a declaration has a DEFAULT VALUE: the value
   * contributes its own identifiers, and the LAST one won.
   *   `size: Size = .byte`   published `byte` — an enum member — and never `Size`
   *   `mode: Mode = .a`      published `a`
   *   `normal = @sizeOf(u8)` published `u8`
   * Measured over the three corpora, the sites where the emitted target changes
   * are dominated by exactly these shapes (`script/m14/tmp/zigw-decltype.ts`).
   *
   * With no `type` field the node is an ENUM MEMBER (`container_field` is the
   * same node type for `a: u8` and for `north` / `normal = 0`; only the former
   * has a type), and a member's value is not a type — so that case yields
   * `undefined` rather than falling back to the walk. The walk survives only
   * where nothing else exists: an already-extracted type node.
   */
  private zigTypeLeafNode(node: Node): Node | undefined {
    const typeField = this.typeFieldOf(node)
    if (typeField) return this.leafOfTypeNode(typeField)
    // No `type` field. For a container_field that IS the enum member (the same
    // node type as a typed field, distinguished only by the field), and for a
    // value-only `var x = 5` there is no type to name.
    if (node.type === "container_field") return undefined
    if (node.type === "variable_declaration") return undefined
    // A parameter with NO name is a fn-TYPE parameter (`fn (u8) void`,
    // `fn (MyType) void`): its single child is the type. A NAMED parameter
    // with no type field is a recovered shape — the grammar has no
    // default-parameter rule, so `fn f(mode: Mode = .a)` (not valid Zig) puts
    // the type inside an `assignment_expression` under a `range_expression` —
    // and there the type is the FIRST identifier after the name, never the
    // last, because a default value contributes identifiers after it.
    const nameField = this.namedFieldOf(node, "name")
    if (!nameField) return this.leafOfTypeNode(node)
    const stack: Node[] = []
    for (let i = node.namedChildCount - 1; i >= 0; i--) {
      const c = node.namedChild(i)
      if (c && c.id !== nameField.id) stack.push(c)
    }
    while (stack.length > 0) {
      const n = stack.pop()!
      if (n.type === "identifier") return n
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const c = n.namedChild(i)
        if (c) stack.push(c)
      }
    }
    return undefined
  }

  /** The `name` FIELD of a node, or null. `function_declaration` carries one
   *  37,126 times in the corpus, `container_field` 104,090, `parameter` 77,594
   *  (the 1,346 that do not are fn-TYPE parameters, which is what the
   *  name/no-name split above turns on). */
  private namedFieldOf(node: Node, field: string): Node | null {
    if (typeof (node as any).childForFieldName !== "function") return null
    return (node as any).childForFieldName(field) ?? null
  }

  /** The name a TYPE NODE carries, or `undefined` when it carries none.
   *
   *  - a container literal in a type position is ANONYMOUS (`fn f(s: struct {
   *    FLAG: u8 }) void`): it has fields, not a name, and the last identifier
   *    under it is a FIELD name — the shape that published
   *    `references (declared-type) -> FLAG` for a type that names nothing;
   *  - `!T` carries its dependency in the `ok` FIELD (21,353 in the corpus).
   *    The walk took the LAST identifier under the whole node, which is a
   *    member of the ERROR set: `fn f() error{A}!u32` published `-> A`, a
   *    phantom, and never `u32` (correctly, as a builtin);
   *  - an `error_type` is an unnamed set, for the same reason;
   *  - a `labeled_type_expression` (`const V = blk: { … break :blk v; }`) has
   *    no statically knowable name at all: its label and its value are both
   *    identifiers in the tree, and the last one is the VALUE, not a type.
   */
  private leafOfTypeNode(t: Node): Node | undefined {
    if (t.type === "identifier") return t
    switch (t.type) {
      case "struct_declaration":
      case "union_declaration":
      case "enum_declaration":
      case "error_set_declaration":
      case "error_type":
      case "labeled_type_expression":
        return undefined
      case "error_union_type": {
        const ok = this.namedFieldOf(t, "ok")
        return ok ? this.leafOfTypeNode(ok) : undefined
      }
      default:
        return this.leafIdentifierUnder(t)
    }
  }

  /** The `type` FIELD of a node, or null when the grammar does not name one.
   *  `childForFieldName` is guarded because a web-tree-sitter build without
   *  field access would otherwise throw on the first declaration. */
  private typeFieldOf(node: Node): Node | null {
    if (typeof (node as any).childForFieldName !== "function") return null
    return (node as any).childForFieldName("type") ?? null
  }

  /** The LAST `identifier` at or under `node` — the leaf of a qualified type
   *  (`std.mem.Allocator` → `Allocator`, `MyList(u32)` → `MyList`), the same
   *  rule the old walk applied, now scoped to the type. Guarded at 200 nodes,
   *  which the corpus census shows is far above the deepest real type
   *  (`parameter.type` trees are a handful of nodes). */
  private leafIdentifierUnder(node: Node): Node | undefined {
    if (node.type === "identifier") return node
    let found: Node | undefined
    let seen = 0
    const stack: Node[] = [node]
    while (stack.length > 0 && seen++ < 200) {
      const n = stack.pop()!
      if (n.type === "identifier") found = n
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const c = n.namedChild(i)
        if (c) stack.push(c)
      }
    }
    return found
  }

  /**
   * The return-type node of a function, WITHOUT the `type` field — the
   * fallback for a grammar variant that does not name it. Zig's return type is
   * the last child that is not the body and not the parameter list; a
   * `callconv(.C)` between them is not the return type, so the node-type list
   * that used to sit here is replaced by position.
   */
  private zigFallbackReturnType(fn: Node): Node | undefined {
    const kids = this.getAllNamedChildren(fn)
    for (let i = kids.length - 1; i >= 0; i--) {
      const c = kids[i]!
      if (c.type === "block" || c.type === "parameters" || c.type === "block_expression") continue
      if (i === 0 && c.type === "identifier") continue
      if (c.type === "calling_convention") continue
      return c
    }
    return undefined
  }

  /**
   * True when `node` is the left-hand side of a WRITE. Zig assignments parse as
   * `variable_declaration` with the LHS as the first named child, and the
   * OPERATOR is the discriminator: a plain `=` writes without reading, while
   * `+=`, `|=`, `*%=` and the rest read their left side as well (Z15).
   */
  private isWriteLhs(node: Node): boolean {
    const p = node.parent
    if (!p) return false
    if (p.type !== "variable_declaration" && p.type !== "assignment_expression") return false
    if (p.namedChildCount > 0 && p.namedChild(0)?.id !== node.id) return false
    return this.isPlainAssignment(p)
  }

  /** A plain `=` assignment: the operator is the anonymous token `=`, which is
   *  a node type of its own, distinct from `+=`/`-=`/`|=`/`<<=` (140 distinct
   *  anonymous token types in the corpus census). */
  private isPlainAssignment(node: Node): boolean {
    return this.hasToken(node, "=")
  }

  /** A function's body node, read off the grammar's `body` field, falling back
   *  to a `block` child for a grammar variant that does not name it. */
  private functionBody(fn: Node): Node | null {
    if (typeof (fn as any).childForFieldName === "function") {
      const b = (fn as any).childForFieldName("body")
      if (b) return b
      if (fn.namedChildCount > 0) {
        // A named field that resolved to null is authoritative: this function
        // has no body, which is the #612 DECLARATION case.
        return null
      }
      return null
    }
    return this.anyChild(fn, (c) => c.type === "block")
  }

  /**
   * M59.A7 (#825): the 1-based line of a syntax node, or `undefined` when the
   * node is absent. Never 0 — a missing site is OMITTED from the edge (the
   * #820 rule), so a reader can tell "no line" from "line 1".
   */
  private nodeLine(node: Node | null | undefined): number | undefined {
    if (!node || !node.startPosition || typeof node.startPosition.row !== "number") return undefined
    return node.startPosition.row + 1
  }

  /** Per-symbol cyclomatic complexity of a function/method body (family
   *  standard — go/c/rust all emit symbol.complexity; zig did NOT).
   *
   * Deep-review fixes (2026-08-29, final zig pass):
   *   (1) Expression forms if_expression / for_expression / while_expression
   *       are Zig's DOMINANT forms (`const a = if (c) 1 else 2;`) and were
   *       never counted — only the statement forms were. All six now count.
   *   (2) `else` in expression forms is an ANONYMOUS token inside the
   *       if_expression (probe-verified), not an else_clause — both are
   *       counted now (else_clause node OR hasToken "else").
   *   (3) binary_expression used a substring trap: `t.indexOf("and")`
   *       falsely matched identifiers (`x + standard + order` -> +2). The
   *       operator is an anonymous child token (`and`/`or`/`orelse`,
   *       probe-verified) — we now match the token type exactly. */
  private zigBodyComplexity(node: Node): number {
    let c = 1
    const stack: Node[] = [node]
    while (stack.length > 0) {
      const n = stack.pop()!
      if (
        n.type === "if_statement" ||
        n.type === "if_expression" ||
        n.type === "for_statement" ||
        n.type === "for_expression" ||
        n.type === "while_statement" ||
        n.type === "while_expression" ||
        n.type === "switch_expression" ||
        n.type === "else_clause" ||
        n.type === "catch_expression"
        // NOTE: NO `orelse_expression` literal — tree-sitter-zig models
        // `a orelse b` as a binary_expression (anonymous `orelse` token),
        // probe-verified 2026-08-29. orelse is counted via the operator
        // token check below.
      ) {
        c++
      }
      // `else` branch of an if/for/while EXPRESSION is an anonymous `else`
      // token (probe-verified: if_expression children include else(anon)).
      // else_clause (statement form) is already counted above.
      if (
        (n.type === "if_expression" || n.type === "for_expression" || n.type === "while_expression") &&
        this.hasToken(n, "else")
      ) {
        c++
      }
      if (n.type === "binary_expression") {
        // The operator is an anonymous child token (and/or/orelse/+ etc.) —
        // match the token TYPE, never substrings of the whole expression text
        // ("x + standard + order" must NOT count; "a and b" must).
        for (let i = 0; i < n.childCount; i++) {
          const op = n.child(i)
          if (op && !op.isNamed && (op.type === "and" || op.type === "or" || op.type === "orelse")) {
            c++
            break
          }
        }
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const c2 = n.namedChild(i)
        if (c2) stack.push(c2)
      }
    }
    return c
  }

  /** #419-D evidence-tier classification for every emitted relationship
   *  (family rules — rust/c/cpp/go all classify; zig did NOT). */
  private classifyEvidenceTier(relationships: ASTEngine.UniversalRelationship[]): void {
    for (const r of relationships) {
      const md = r.metadata ?? (r.metadata = {})
      if (md.evidenceClass) continue
      const t = String(r.type ?? "")
      const conf = typeof r.confidence === "number" ? r.confidence : 1
      if (t === "contains") { md.evidenceClass = "structural"; continue }
      if (t === "references") {
        md.evidenceClass = md.relationshipType === "declared_type" ? "reference_qualified" : "import_based"
        continue
      }
      if (t === "instantiates") {
        // Z36: this predicate read `md.confidence` and `md.isConstructor` — fields
        // this lane's edges never set, so it returned \"structural\" by ACCIDENT
        // rather than by decision. It now reads the EDGE's own confidence and the
        // marker the pass actually writes (`isConstructorApplication`), and a proven
        // in-file instantiation is structural while a guessed one would not be.
        md.evidenceClass = conf >= 0.9 && md.isExternalTarget === false ? "structural" : "inferred"
        continue
      }
      // Z36: `imports` and `exports` fell through to the default and were published
      // as `usage_contextual` — so a module DEPENDENCY and a published API name were
      // both reported as usage. The family rule is explicit in ~26 analyzers
      // (objc/c/clean/yaml all read `imports`/`exports`/`references` as
      // `import_based`), and it matters downstream: the MCP handler's tierFor
      // returns a STORED `evidenceClass` in preference to deriving one, so a wrong
      // stored value wins over the type it could have derived correctly. Found by
      // asking the question nothing was asking — does a NEW class survive the
      // pipeline? — not by any gate on this lane.
      if (t === "imports" || t === "exports") { md.evidenceClass = "import_based"; continue }
      md.evidenceClass = "usage_contextual"
    }
  }

  /**
   * Z65 — TARGET SCOPE: state, per edge, whether the target name is a symbol THIS
   * file publishes, and with which kind.
   *
   * WHY. A zig relationship carries six keys and both endpoints are NAME STRINGS.
   * `src/lsp/impact.ts` obtains inbound edges by scanning outgoing edges and
   * MATCHING TARGETS — no inbound edge is stored — so an edge's name is all a
   * reverse walk has, and a name two declarations share is attributed to one of
   * them by a rule nobody chose. Measured over the whole 3,834-file zig corpus
   * (draw `sha256:2f3545f9…`, production `parseFile`, 392,550 edges):
   * **265,887 edges (67.73%) name a target 2+ published symbols share**, and of
   * those **151,004 (56.79%) have a candidate in the edge's OWN file** — a tie a
   * per-file rule breaks soundly, because within one file the analyzer knows which
   * declaration it published.
   *
   * WHAT IT ADDS. `metadata.targetScope`, plus `targetKind` when the file
   * publishes exactly one kind under that name:
   *   `file-local`     the file publishes a symbol with this exact name. A
   *                    consumer resolves the edge to THAT symbol and needs no
   *                    cross-file guess.
   *   `file-external`  the file publishes none. The edge names something outside
   *                    it — a `std.*` declaration, a builtin, an import path — and
   *                    no per-file rule can say which. Stated, not guessed.
   *   `scope-marker`   the endpoint is one of the literal scope markers
   *                    (`(global)`, `(file)`, `(declared-type)`), which is a fact
   *                    about the edge's provenance and not a symbol name.
   *
   * It adds NO edge, removes NO edge, and changes NO count — it is a label on
   * edges that already exist, derived from this analyzer's own output rather than
   * from a guess about the rest of the repository. A consumer that ignores it
   * behaves exactly as before, which is why it cannot regress a budgeted lane.
   *
   * THE LIMIT, stated because it is the part that cannot be fixed here. This says
   * whether the target is IN this file, not whether it is the declaration the
   * author meant: `const Self = @This();` is a file-local name, and 240 edges
   * resolve against it, while `keepSymbol`'s UNIVERSAL denylist
   * (`src/ast/pool-worker.ts:449`, shared, §8) refuses to publish ANY symbol
   * named `Self` — so those edges are labelled `file-external` even though the
   * name is right there in the file. The denylist is the defect, and it is not
   * this lane's file.
   */
  private annotateTargetScope(
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
  ): void {
    const kindsByName = new Map<string, Set<string>>()
    for (const s of symbols) {
      const n = String(s.name ?? "")
      if (!n) continue
      // Indexed under BOTH spellings, and that is the store's own model rather
      // than a convenience: the resolver keeps a `qualified_name` table (strategy
      // 1, an exact JOIN) alongside a `name` table that only fires when the name
      // is unique across the project (strategy 2, `_res_name.cnt = 1`).
      // `incoming-gate.ts` aliases the same two keys for the same reason.
      //
      // The qualified alias is what keeps a `contains` target — which since M60
      // cause A spells the member's published name — labelled `file-local`. Without
      // it the three fixtures pinning `meta.targetScope: file-local` read
      // `file-external`, which is a claim about the file that was false: the
      // declaration is in the file, under the name the edge now names.
      //
      // The bare key is retained because every OTHER relationship type still emits
      // a bare target, so dropping it would relabel `calls`/`uses`/`references`.
      const addKey = (k: string): void => {
        const set = kindsByName.get(k) ?? new Set<string>()
        set.add(String(s.kind ?? ""))
        kindsByName.set(k, set)
      }
      addKey(n)
      const qualified = publishedSpelling(s)
      if (qualified !== n) addKey(qualified)
    }
    const MARKERS = new Set(["(global)", "(file)", "(declared-type)", "(import)", "(local)"])
    for (const r of relationships) {
      const md = r.metadata ?? (r.metadata = {})
      if (md.targetScope) continue
      const t = String(r.target ?? "")
      if (MARKERS.has(t)) { md.targetScope = "scope-marker"; continue }
      const kinds = kindsByName.get(t)
      if (!kinds) { md.targetScope = "file-external"; continue }
      md.targetScope = "file-local"
      // The kind only when it is unambiguous WITHIN the file: two kinds under one
      // name here is a real collision, and picking one would be a guess.
      if (kinds.size === 1) md.targetKind = [...kinds][0]
      else md.targetKindCount = kinds.size
    }
  }

  /** The `const X = @This();` binding of a file, or null when the file does not
   *  name its own container. Read off node types only: a direct
   *  `variable_declaration` child of the root whose value is a `builtin_function`
   *  carrying the `builtin_identifier` `@This`.
   *
   *  The NAME is `namedChild(0)` when that is an `identifier`, NOT
   *  `childForFieldName("name")`: this grammar declares no `name` field on
   *  `variable_declaration` — the walk reads a variable declaration's name the
   *  same way, and a probe that used the field lookup reported 0 bindings on a
   *  source that carries one. `container_field` DOES declare `name`, which is
   *  why `zigFileLevelField` can use the field.
   *
   *  Null is a real answer and not a fallback: 10 of the 411 corpus files that
   *  declare file-level fields never bind `@This()`, and for those the owner of
   *  those fields is not nameable from the file. */
  private zigThisBindingName(root: Node): string | null {
    for (let i = 0; i < root.namedChildCount; i++) {
      const decl = root.namedChild(i)
      if (!decl || decl.type !== "variable_declaration") continue
      for (let j = 0; j < decl.namedChildCount; j++) {
        const value = decl.namedChild(j)
        if (!value || value.type !== "builtin_function") continue
        const isThis = this.anyChild(value, (n) => n.type === "builtin_identifier" && n.text === "@This")
        if (!isThis) continue
        const name = decl.namedChildCount > 0 ? decl.namedChild(0) : null
        if (name && name.type === "identifier") return name.text
      }
    }
    return null
  }

  /** Publish one `container_field` whose direct parent is the file's root — a
   *  member of the struct the FILE is, per `zigThisBindingName`.
   *
   *  The kind is decided by the field's own `type` FIELD, which is this
   *  analyzer's discriminator between a struct field and an enum member
   *  (`:2180`): the grammar uses one node type for `a: u8` and for `north`, and
   *  only the former carries a type. A named container gets that answer from
   *  its kind instead; a file-level container has no published kind, because
   *  `const X = @This()` publishes `X` as a `Type` whether the body is a struct
   *  or an enum, so the field's own field is the only evidence there is.
   *
   *  The owner is set ONLY when the file names it. The 10 corpus files that
   *  declare file-level fields without a `@This()` binding publish the field
   *  with no owner: the declaration is real and its reads then resolve, while
   *  no `contains` edge is emitted for it, because that edge would need a
   *  source symbol and asserting one would be inventing the container's name.
   *
   *  The name guards are the SAME three the named-container branch applies, and
   *  they are load-bearing here rather than defensive: the corpus's three
   *  untyped file-level fields are all in `zig/test/cases/compile_errors/`
   *  (`file_level_tuple.zig` — a file-level tuple, which Zig rejects), and their
   *  text holds a TYPE where a name belongs (`u32`, `comptime u8 = 123`). A
   *  symbol named `u32` is a fabrication, so they are refused exactly as an
   *  unnamed `extern struct` member is. */
  private zigFileLevelField(
    node: Node,
    ownerName: string | null,
    symbols: ASTEngine.UniversalSymbol[],
  ): void {
    const nameField = this.namedFieldOf(node, "name")
    const nameNode =
      nameField && nameField.type === "identifier" ? nameField : this.anyChild(node, (n) => n.type === "identifier")
    const fieldName = nameNode ? nameNode.text : ""
    if (!fieldName || fieldName === "_" || fieldName.length >= 200) return
    const typeField = this.typeFieldOf(node)
    symbols.push({
      name: fieldName,
      kind: typeField ? ASTEngine.SymbolKind.Property : ASTEngine.SymbolKind.EnumMember,
      visibility: "public",
      range: this.nodeRange(node),
      scope: ownerName ?? undefined,
      ownerName: ownerName ?? undefined,
      ownerKind: ownerName ? ASTEngine.SymbolKind.Type : undefined,
      returnType: typeField ? this.nodeText(typeField) : undefined,
      metadata: {
        zigField: true,
        zigFileLevelField: true,
        ...(typeField ? {} : { zigEnumMember: true }),
      },
    })
  }

  private pushChildren(
    node: Node,
    walkStack: { node: Node; container: ZigWalkSymbol | null; inFunction: boolean; anonContainer: boolean }[],
    container: ZigWalkSymbol | null,
    inFunction: boolean,
    anonContainer: boolean,
  ): void {
    for (let i = node.namedChildCount - 1; i >= 0; i--) {
      const child = node.namedChild(i)
      if (child) walkStack.push({ node: child, container, inFunction, anonContainer })
    }
  }

  // ─── PURE HELPER FUNCTIONS ───

  private nodeRange(node: Node): ASTEngine.UniversalSymbol["range"] {
    // 1-based columns (family standard — go/rust/c/cpp all +1; caught by the
    // systems-family consistency gate M14.CC1, 2026-08-29: zig emitted raw
    // 0-based columns, failing startColumn >= 1).
    return {
      startLine: node.startPosition.row + 1,
      startColumn: node.startPosition.column + 1,
      endLine: node.endPosition.row + 1,
      endColumn: node.endPosition.column + 1,
      startIndex: node.startIndex,
      endIndex: node.endIndex,
    }
  }

  private nodeText(node: Node | null): string {
    if (!node) return ""
    return node.text
  }

  private anyChild(node: Node, predicate: (n: Node) => boolean): Node | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child && predicate(child)) return child
    }
    return null
  }

  /**
   * Z24 (pass 24): the DECLARATION NAME `@field` reads, when it is spelled as a string.
   *
   * ## The construct
   *
   * Zig can read a container's member by name-as-text rather than by identifier:
   *
   *     @field(p, "x")        // the field `x` of whatever `p` holds
   *     @field(Point, "z")    // the field `z` of the type `Point`
   *
   * Measured over the whole zig corpus (`validation/m14/fixtures/zig/reflection-builtin-probe.mts`,
   * 8 shards, 3,848/3,848 files, 0 parse traps): **779 `@field` and 210 `@hasDecl` call
   * sites over 242 files**, of which **206 name a declaration as a string**. Before this
   * pass the analyzer read none of them — `reflection-firing.mts` drove the production
   * `parseFile` over all 70 files carrying such a site and found **0** edges attributed to
   * a reflection reason code. The 52 sites whose line carried an edge naming the same
   * declaration decompose, by the analyzer's own reason codes, into `zig_field_access` 39,
   * `zig_function_call` 10, `zig_export` 3 and `identifier_usage` 1 — all different
   * constructs that share a line, since a relationship carries `line_number` and no range.
   *
   * Measured AFTER this pass, same instrument, same 70 files: **18 of the 22 named `@field`
   * sites are represented by a `zig_field_reflection` edge**, and 7 of those 18 have the edge
   * on their OWN line. The gap between 18 and 7 is Z52's post-pass, which collapses one `uses`
   * edge per (source, target) keeping the higher confidence: `zig/test/behavior/member_func.zig:77,78`
   * name `one` and `two`, the reflection edge for each is emitted, and the dot-access edge the
   * same file already published at lines 39 and 62 wins the tie at the same 0.75. The
   * site-level number alone would have read 7 and filed a working derivation as 11 misses.
   *
   * ## Why `@field` and NOT `@hasDecl`
   *
   * `@field(S, "a")` READS `S.a`: the corpus compiles, so `S` has that member and the code
   * consumes its value. That is exactly the claim the `zig_field_access` pass already makes
   * for `S.a` written with dots, so it is emitted as `uses` at the same confidence, with a
   * distinct reason code so the two derivations stay auditable apart.
   *
   * `@hasDecl(S, "a")` is an EXISTENCE TEST. Its whole purpose is to ask whether `a` is
   * there, and the surrounding code handles both answers (`if (@hasDecl(T, "opt")) … else
   * …`). A hard `uses`/`references` edge would assert a dependency the source deliberately
   * does not take, which is the fabrication this workstream exists to prevent, so it is NOT
   * emitted. Its measured population is published instead: 184 named sites, and 128 of the
   * 184 name a declaration this corpus does not publish at all (a foreign container, a type
   * parameter, a translate-c struct), so even a permissive reading would have produced 128
   * edges the graph cannot walk to.
   *
   * ## Why the name must be identifier-shaped
   *
   * `@field(anyerror, "Expected closing ]")` is a legal Zig read of an error-set member, and
   * Z18 already recorded what publishing such a text as a bare target does: it produced
   * targets like `@"ziglib"` for names that were legitimate. The same guard applies — a
   * `string_content` carrying a character outside `[A-Za-z0-9_]` is an error name, not a
   * member this file declares, and publishing it would add an edge whose target is junk.
   * Measured: **2 of the 22 named `@field` sites** carry a non-identifier-shaped name
   * (`zig/lib/std/fmt.zig:1550,1557`, both `"Expected closing ]"`) and **both are declined**.
   *
   * ## WHAT THE SHAPE GUARD DOES NOT DO, because a comment that claimed otherwise was wrong
   *
   * An earlier revision of this header read "3 of the 22 resolve to nothing and all 3 are
   * declined, which is what the arity measurement independently found". The two numbers are
   * 2 and 3 and they are not the same set. The third zero-resolving site is `NotFound` at
   * `zig/test/behavior/error.zig:897`, `@field(anyerror, "NotFound")`, and its name IS
   * identifier-shaped, so it is EMITTED — with `targetScope: file-external`, because nothing in
   * that 3,000-line file publishes `NotFound`. So the guard is not an error-set detector: it
   * declines error names containing punctuation and lets identifier-shaped error names
   * through. That is the intended behaviour and it is stated rather than papered over:
   *
   *   - `error.NotFound` IS a legitimate declaration name in Zig, so the edge states a TRUE
   *     dependency — on a name this particular file's corpus does not publish.
   *   - `anyerror` is a `builtin_type` node, not an `identifier`, so its member namespace is
   *     the inferred error set of the whole PROGRAM: unbounded, and bindable by no per-file
   *     rule.
   *   - Suppressing it instead would be inconsistent with the sibling pass, which publishes
   *     `@typeInfo(u8).Int` → `Int` under the same `file-external` label, and `Int` equally
   *     resolves to nothing in its own file. Dropping one unresolvable read and keeping the
   *     other would be a fit to a single test line, not a rule.
   *
   * So the honest count is: of the 7 `zig_field_reflection` edges the corpus produces, **6
   * carry a target published in their own file and exactly 1 does not**
   * (`zig/test/behavior/error.zig:897`), and it says so on the edge.
   *
   * No regex: the shape test is a Set of node types and the character test is a
   * character-code range, both the file's existing zero-regex discipline.
   */
  private zigReflectionFieldName(node: Node): Node | null {
    if (node.type !== "builtin_function") return null
    const bid = this.anyChild(node, (c) => c.type === "builtin_identifier")
    if (!bid || bid.text !== "@field") return null
    const args = this.anyChild(node, (c) => c.type === "arguments")
    if (!args) return null
    // The SECOND argument is the member name; the first is the container. A `@field` with
    // no string second argument names its member by a comptime VALUE, which is not a name
    // this pass can read — `@field(T, field_name)` where `field_name` is a comptime
    // variable is the majority shape in the corpus (757 of the 779 sites) and correctly
    // yields nothing here.
    let stringArg: Node | null = null
    let seen = 0
    for (let i = 0; i < args.namedChildCount; i++) {
      const a = args.namedChild(i)
      if (!a) continue
      seen++
      if (seen === 2 && a.type === "string") stringArg = a
    }
    if (!stringArg) return null
    const content = this.anyChild(stringArg, (c) => c.type === "string_content")
    if (!content) return null
    const text = content.text
    if (!text) return null
    // ≡ /^[A-Za-z_][A-Za-z0-9_]*$/ — first char is a letter or underscore, then letters,
    // digits and underscores. A member name that is not identifier-shaped is an error-set
    // member (see the Z24 header).
    const isStart = (c: number) =>
      (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95
    const isRest = (c: number) => isStart(c) || (c >= 48 && c <= 57)
    if (!isStart(text.charCodeAt(0))) return null
    for (let i = 1; i < text.length; i++) {
      if (!isRest(text.charCodeAt(i))) return null
    }
    return content
  }

  // The `pub`/`export`/`inline` modifiers are anonymous token children
  // (`variable_declaration [pub:"pub"] [const:"const"]`) — pure AST, never
  // source-text scanning.
  private hasToken(node: Node, token: string): boolean {
    const count = node.childCount
    for (let i = 0; i < count; i++) {
      const c = node.child(i)
      if (c && !c.isNamed && c.type === token) return true
    }
    return false
  }

  private getAllNamedChildren(node: Node): Node[] {
    const children: Node[] = []
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child) children.push(child)
    }
    return children
  }
}
