/**
 * SWIFT TRUTH for `contains`, `exports` and `imports` — the three labels this
 * lane emitted and the m14 differential compared against nothing.
 *
 * WHY THIS MODULE EXISTS. `validation/m60/rel-type-coverage-baseline.json`
 * recorded swift as `4 un-audited: ["contains","exports","imports","overrides"]`:
 * the analyzer constructed all four, the differential's compared-label allowlist
 * admitted none of them, so those edges were stored and compared against nothing
 * — invisible, which is the one state a differential exists to end. This module
 * is the TRUTH side for three of the four; wiring it into `differential.ts` and
 * naming the labels in the same allowlist are the two halves of one change
 * (truth with no allowance reads as MISSING — the #910 shape; an allowance with
 * no truth reports every emitted edge as fabrication — the G7 shape).
 *
 * `overrides` is NOT here, and the reason is structural rather than an omission:
 * its target is resolved ACROSS FILES through the companion index the analyzer
 * builds, which a single-file tree walker does not have. It is audited by
 * `script/m14/swift-overrides-premise-probe.ts`, which measures the premise
 * (that the corpus contains the construct at all) rather than pretending to
 * derive the edge.
 *
 * THE INDEPENDENCE CLAIM, stated exactly. The walk below shares no code with
 * `src/ast/real-swift-analyzer.ts` — it imports no analyzer module and calls none
 * of its helpers — and its rules are written from Swift's own declaration
 * semantics: ownership is LEXICAL (the nearest enclosing declaration owns the
 * member), a BODY is not a container, the module interface is file scope, and a
 * re-export is `@_exported import` / `public import`. It was validated against
 * the analyzer by `script/m14/swift-uncovered-oracle.ts` over a 1,256-file draw
 * and agrees edge-for-edge in BOTH directions on the 1,012 files both readers see
 * identically (`contains` 17,445/17,445, `exports` 2,167/2,167, `imports`
 * 2,108/2,108) — and reaching that agreement is how five of the oracle's own
 * instrument defects were found and fixed (one-sided normalisation, body scope
 * read as type scope, invisible file-scope properties, generic/sugar extension
 * targets bound to the wrong name, a hard-coded operator token list). Those
 * defects and their measurements are recorded in `docs/analyzers/swift.md`.
 *
 * The oracle and the differential now consume THIS walker rather than two
 * copies of it, which is a deliberate trade: the oracle keeps its job (auditing
 * the ANALYZER against a tree reading), and gives up the claim that it is also a
 * second opinion on the differential's truth. Two copies would have been two
 * things to drift, and the drift would be invisible — both are unverified
 * against anything but each other.
 *
 * THE SHARED LIMIT travels with it: this is a reading of the SAME pinned
 * tree-sitter-swift grammar the analyzer parses with, so a grammar bug present in
 * both paths is invisible here — exactly the limit the differential's own
 * oracle carries for every other lane.
 */

const EXPORT_LEVELS = new Set(["public", "open", "package"])
/** The scope-kind tokens Swift's import grammar admits (`import struct Foo.Bar`). */
const IMPORT_SCOPE_KINDS = new Set(["struct", "class", "enum", "func", "var", "let", "typealias", "protocol", "actor", "macro"])
/** A raw-representable enum's stdlib raw-value type — never an adopted protocol. */
const ENUM_RAW = new Set([
  "String", "Character", "Int", "Int8", "Int16", "Int32", "Int64",
  "UInt", "UInt8", "UInt16", "UInt32", "UInt64", "Float", "Float32", "Float64", "Double",
])

/** The labels this walker can derive — the audited set it justifies. */
export const SWIFT_ORACLE_LABELS = ["contains", "exports", "imports"] as const

/** One truth row in the differential's row shape. */
export interface SwiftTruthRow {
  label: "contains" | "exports" | "imports"
  from: string
  target: string
}

export interface SwiftTruth {
  /** `${container}\u0000${member}` — owned by a TYPE. */
  contains: Set<string>
  /** `${moduleLeaf}\u0000${exportedName}` — a name in the module interface. */
  exports: Set<string>
  /** `root\u0000${moduleName}` — a module the file depends on. */
  imports: Set<string>
  /** every name the tree declares, for corroborating an EXTRA endpoint. */
  declaredNames: Set<string>
  /** file-scope names, for the exports uniqueness check. */
  fileScopeNames: string[]
  /**
   * Declarations whose lexical owner is a BODY — a function, an initializer,
   * `deinit`, `subscript`, an accessor or a closure — rather than a type, so
   * sites that must NOT mint `contains <body-owner> -> <name>`. Counted, not
   * emitted: a body is not a container. It was 355 over the 1,256-file draw when
   * only nested types in function bodies were in it; 25,918 once locals in every
   * body are counted, because a local in a `deinit`/accessor body is exactly the
   * site the rule covers.
   */
  functionOwnedContainsExcluded: number
}

function firstChildOfType(n: any, type: string): any | null {
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c && c.type === type) return c
  }
  return null
}
function hasAnon(n: any, token: string): boolean {
  for (let i = 0; i < n.childCount; i++) {
    const c = n.child(i)
    if (c && !c.isNamed && c.type === token) return true
  }
  return false
}
/** The declaration's access level, read from its own `visibility_modifier` child. */
function accessLevel(n: any): string {
  const mods = firstChildOfType(n, "modifiers")
  if (mods) {
    for (let i = 0; i < mods.namedChildCount; i++) {
      const m = mods.namedChild(i)
      if (!m || m.type !== "visibility_modifier") continue
      const t = m.text
      if (EXPORT_LEVELS.has(t) || t === "private" || t === "fileprivate" || t === "internal") return t
    }
  }
  return "internal"
}
/** The base `type_identifier` under a `user_type` — an extension names its
 *  EXTENDED type, which is the base name and never a generic ARGUMENT.
 *
 *  `extension Sequence<UInt8>` puts BOTH identifiers under one `user_type`
 *  (`type_identifier Sequence` + `type_arguments <UInt8>`), so "the last
 *  type_identifier in the subtree" named the extension `UInt8` — measured as a
 *  phantom MISSING `UInt8 -> write` beside an EXTRA `Sequence -> write` for
 *  swift-nio/Sources/NIOFS/Convenience.swift. `type_arguments` subtrees are
 *  skipped; among what remains the LAST identifier is taken, which is the leaf
 *  of a dotted target (`extension Outer.Inner` extends Inner) and the only
 *  identifier of a generic one. */
function baseTypeIdentifier(ut: any): any | null {
  let found: any | null = null
  const stack: Array<{ n: any; inArgs: boolean }> = [{ n: ut, inArgs: false }]
  while (stack.length > 0) {
    const { n: cur, inArgs } = stack.pop()!
    if (!inArgs && cur.type === "type_identifier") { found = cur; continue }
    for (let i = cur.namedChildCount - 1; i >= 0; i--) {
      const c = cur.namedChild(i)
      if (c) stack.push({ n: c, inArgs: inArgs || c.type === "type_arguments" })
    }
  }
  return found
}

/** The first `type_identifier` in pre-order under a type node. */
function firstTypeIdentifierPreorder(n: any): any | null {
  const stack = [n]
  while (stack.length > 0) {
    const cur = stack.pop()
    if (cur.type === "type_identifier") return cur
    for (let i = cur.namedChildCount - 1; i >= 0; i--) {
      const c = cur.namedChild(i)
      if (c) stack.push(c)
    }
  }
  return null
}

/** The EXTENDED type of an extension declaration — its own `user_type`, never a
 *  `type_identifier` from anywhere in the subtree. The first version searched the
 *  whole declaration for the last `type_identifier`, so
 *  `extension Array where Element == Measurement { func f(_ d: String) }` came
 *  out named `String`: 5,543 spurious EXTRA `contains` edges on clean files, the
 *  probe being wrong about the language rather than the analyzer. */
function extensionTargetName(n: any): string | null {
  const ut = firstChildOfType(n, "user_type")
  if (ut) return baseTypeIdentifier(ut)?.text ?? null
  // A SUGAR target — `extension [WeightedStack]`, `extension ParameterList?`,
  // `extension [K: V]`, `extension (A, B)`. The grammar wraps it in a container
  // type node (`array_type`, `optional_type`, …), so there is no DIRECT
  // `type_identifier` child and the old fallback returned null: the extension
  // never bound and every member fell to FILE SCOPE. Measured as the exports
  // MISSING column of the second run — `AggregateStacks -> netAllocations`
  // (extension [WeightedStack], AggregateStacks.swift:115),
  // `ServerTrustEvaluation -> evaluate` (extension [ServerTrustEvaluating],
  // ServerTrustEvaluation.swift:452) and `Declarations -> bridged` (extension
  // ParameterList? / BridgedParameterList? / GenericParameterList? / Expr? /
  // TrailingWhereClause?, Declarations.swift 459-487).
  //
  // The name is the FIRST type_identifier (pre-order) of the first named child
  // after the `extension` token — the base the compound is built from. Children
  // that are not the target (`modifiers`, `type_constraints`, the `class_body`
  // itself, an inheritance specifier) are skipped, so a parameter's type can
  // never name the extension.
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (!c) continue
    if (c.type === "modifiers" || c.type === "attribute" || c.type === "type_constraints" || c.type === "class_body" || c.type === "inheritance_specifier") continue
    const first = firstTypeIdentifierPreorder(c)
    if (first) return first.text
  }
  return null
}

/**
 * A scope MARKER for a body that has no declaration owner (a file-scope
 * property's accessor, a closure in a module-level initializer). Never an
 * endpoint — it only keeps the walk from classifying the body's locals as
 * module-scope declarations.
 */
const BODY_OWNER = "\u0000body"
/**
 * Bodies whose contents are LOCALS, not members: a computed property's
 * getter/setter, a willSet/didSet block, a closure literal. `init`/`deinit`/
 * `subscript` bodies are handled in the walk beside this because `init` also
 * publishes the family's `constructor` member.
 */
const ACCESSOR_BODIES = new Set([
  "computed_property", "computed_getter", "computed_setter",
  "willset_didset_block", "willset_clause", "didset_clause", "lambda_literal",
])

/** The file's leaf name, extension stripped — the module-level SOURCE spelling
 *  the export contract pins (typescript's moduleLeafName() convention), derived
 *  here from the path alone so this walker never imports analyzer code. */
export function moduleLeaf(filePath: string): string {
  let start = 0
  for (let i = filePath.length - 1; i >= 0; i--) {
    if (filePath[i] === "/") { start = i + 1; break }
  }
  let end = filePath.length
  for (let i = start; i < filePath.length; i++) {
    if (filePath[i] === ".") { end = i; break }
  }
  return filePath.slice(start, end)
}

/** `@_exported` — the attribute's NAME is its first named child's text. */
function hasExportedAttribute(n: any): boolean {
  const stack: any[] = [n]
  while (stack.length > 0) {
    const x = stack.pop()
    if (x.type === "attribute" && x.namedChildCount > 0 && x.namedChild(0).text === "_exported") return true
    for (let i = x.namedChildCount - 1; i >= 0; i--) {
      const c = x.namedChild(i)
      if (c) stack.push(c)
    }
  }
  return false
}

/**
 * Derive the expected edge set for one file, from the tree alone.
 *
 * Declaration kinds the walk reads — the same set the analyzer's symbol contract
 * lists, written out here independently:
 *   protocol_declaration                                 -> a type
 *   class_declaration [class|struct|enum|extension|actor] -> a type
 *   function_declaration | protocol_function_declaration  -> a member
 *   init_declaration                                      -> a member named `constructor`
 *   property_declaration | protocol_property_declaration  -> one member per `pattern`
 *   enum_entry                                            -> a member, in an ENUM body only
 *   typealias_declaration | associatedtype_declaration     -> a type
 * Ownership is LEXICAL: the nearest enclosing declaration is the container,
 * which is what `ownerName = parent.name` means when the walk pushes a frame.
 * `deinit_declaration`/`subscript_declaration` are not declarations the family
 * materializes, so they are not members here.
 */
export function deriveSwiftTruth(root: any, moduleSource: string): SwiftTruth {
  const contains = new Set<string>()
  const exports = new Set<string>()
  const imports = new Set<string>()
  const declaredNames = new Set<string>()
  const fileScopeNames: string[] = []
  let functionOwnedContainsExcluded = 0

  // `owner` null = file scope. The container is the nearest enclosing
  // DECLARATION (a type or a function); `ownerIsType` says which, because a
  // property binding is a member of a TYPE and a local of a function.
  const walk = (n: any, owner: string | null, ownerIsType: boolean, ownerIsEnum: boolean, insideFunction: boolean) => {
    const t = n.type

    if (t === "import_declaration") {
      // The spelled path is the first identifier child; the MODULE is its first
      // dotted segment (Swift's own rule — a submodule or a scoped declaration
      // hangs off the module).
      let spelled = ""
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i)
        if (c && (c.type === "simple_identifier" || c.type === "type_identifier" || c.type === "identifier")) { spelled = c.text; break }
      }
      if (spelled) {
        const moduleName = spelled.split(".")[0]
        if (moduleName) imports.add(`root\u0000${moduleName}`)
        // `public import M` (SE-0409) and `@_exported import M` re-publish M, and
        // the edge names the module PATH as spelled (`Mixed.Submodule` stays whole).
        if (accessLevel(n) === "public" || hasExportedAttribute(n)) exports.add(`${moduleSource}\u0000${spelled}`)
      }
      return // an import declares nothing
    }

    let childOwner = owner
    let childOwnerIsType = ownerIsType
    let childOwnerIsEnum = ownerIsEnum
    let nextInsideFunction = insideFunction

    if (t === "protocol_declaration" || t === "class_declaration") {
      const isExtension = t === "class_declaration" && hasAnon(n, "extension")
      const name = isExtension
        ? extensionTargetName(n)
        : (firstChildOfType(n, "type_identifier")?.text ?? firstChildOfType(n, "user_type")?.text ?? null)
      if (name) {
        declaredNames.add(name)
        if (owner === null) {
          fileScopeNames.push(name)
          // API surface: a FILE-SCOPE declaration in the module interface, sourced
          // at the file's leaf name. Membership, not indentation. An extension is
          // excluded because its symbol is named after the EXTENDED type, which is
          // declared elsewhere (or is a stdlib type this file never declares).
          if (!isExtension && EXPORT_LEVELS.has(accessLevel(n))) exports.add(`${moduleSource}\u0000${name}`)
        } else if (ownerIsType) {
          contains.add(`${owner}\u0000${name}`)
        } else {
          functionOwnedContainsExcluded++
        }
        childOwner = name
        childOwnerIsType = true
        childOwnerIsEnum = t === "class_declaration" && hasAnon(n, "enum")
      } else if (isExtension) {
        // An extension whose target the walk could not name still OWNS its
        // members: `extension <unresolvable> { … }` must never demote them to
        // module declarations. (Before this branch existed, each such member
        // became a truth-side EXPORT sourced at the file's leaf name.)
        childOwner = BODY_OWNER
        childOwnerIsType = false
        childOwnerIsEnum = false
      }
      nextInsideFunction = false
    } else if (t === "function_declaration" || t === "protocol_function_declaration") {
      // A function is a declaration wherever it appears. Nested inside another
      // function it is a LOCAL: it is named, ranged and addressable, but it is
      // not a MEMBER of the enclosing function, so no `contains` edge names the
      // function as its container — the site is counted
      // (`functionOwnedContainsExcluded`) rather than asserted away. A body is
      // not a container, in every spelling.
      const nameNode = firstChildOfType(n, "simple_identifier") || firstChildOfType(n, "identifier")
      const op = nameNode ? null : operatorName(n)
      const name = nameNode ? nameNode.text : op
      if (name) {
        declaredNames.add(name)
        if (owner !== null && ownerIsType) {
          contains.add(`${owner}\u0000${name}`)
        } else if (owner !== null) {
          // A function nested in a function body: not a member of anything.
          functionOwnedContainsExcluded++
        } else {
          fileScopeNames.push(name)
          if (EXPORT_LEVELS.has(accessLevel(n))) exports.add(`${moduleSource}\u0000${name}`)
        }
      }
      if (name) { childOwner = name; childOwnerIsType = false }
      nextInsideFunction = true
    } else if (t === "init_declaration" || t === "deinit_declaration" || t === "subscript_declaration") {
      // The family's constructor name for a Swift initializer (Java/C# naming);
      // `deinit` and `subscript` are not declarations the family materializes.
      if (t === "init_declaration") {
        if (owner !== null && ownerIsType) contains.add(`${owner}\u0000constructor`)
        else if (owner !== null) functionOwnedContainsExcluded++
      }
      // A BODY IS NOT A CONTAINER. `var attr` inside `init` was a truth-side
      // member until this line existed: the walk kept the enclosing TYPE as the
      // scope while descending through the body, so every local became
      // `Lock -> attr` and the MISSING column accused the analyzer of omitting
      // members it correctly refuses to mint. Measured sites on the draw:
      // lock.swift `Lock -> attr`/`attrDestroyErr`, ByteBuffer-conversions
      // `String -> buffer` (x3), Array+FileSystem `Array -> byteBuffer`,
      // FileRegion `FileRegion -> eof`, FileHandle `NIOFileHandle -> fd`/`fl`.
      childOwner = owner ?? BODY_OWNER
      childOwnerIsType = false
      childOwnerIsEnum = false
      nextInsideFunction = true
    } else if (ACCESSOR_BODIES.has(t)) {
      // Computed-property getters/setters, willSet/didSet and closure literals
      // are the same shape as an init body: their contents are locals. (A
      // file-scope property's accessor has no owner at all, hence BODY_OWNER.)
      childOwner = owner ?? BODY_OWNER
      childOwnerIsType = false
      childOwnerIsEnum = false
      nextInsideFunction = true
    } else if (t === "property_declaration" || t === "protocol_property_declaration") {
      // One `pattern` per binding: `var a = 1, b = 2` is two declarations.
      const names: string[] = []
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c && c.type === "pattern") {
          const id = firstChildOfType(c, "simple_identifier") || firstChildOfType(c, "identifier") || firstNamed(c)
          if (id) names.push(id.text)
        }
      }
      if (names.length === 0) {
        const id = firstChildOfType(n, "simple_identifier") || firstChildOfType(n, "identifier")
        if (id) names.push(id.text)
      }
      for (const name of names) {
        if (owner !== null && ownerIsType) {
          declaredNames.add(name)
          contains.add(`${owner}\u0000${name}`)
        } else if (owner !== null) {
          // A LOCAL — in a function, an init/deinit/subscript body, an accessor
          // or a closure. Not a member of anything, so it is counted rather than
          // emitted.
          functionOwnedContainsExcluded++
        } else {
          // FILE-SCOPE: a declaration of the module. The pre-fix walk read
          // properties only when `ownerIsType`, so a file-scope `public let` —
          // `public let benchmarks = [...]` in every benchmark file,
          // SIL/ApplySite.swift's `public let isFullApplySite` — was invisible to
          // the truth model while the analyzer published it; that single omission
          // is most of the exports EXTRA column (~250 of 275).
          declaredNames.add(name)
          fileScopeNames.push(name)
          if (EXPORT_LEVELS.has(accessLevel(n))) exports.add(`${moduleSource}\u0000${name}`)
        }
      }
    } else if (t === "enum_entry") {
      // A member of an ENUM body only. A `case` in a switch statement is not an
      // enum member, and `ownerIsEnum` is false there because a switch is not a
      // type declaration.
      if (ownerIsEnum && owner !== null && !insideFunction) {
        let nameNode: any | null = null
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (!c || c.type === "modifiers" || c.type === "attribute") continue
          nameNode = c
          if (c.type === "simple_identifier" || c.type === "identifier") break
        }
        const name = nameNode ? nameNode.text : null
        if (name && name !== "case") {
          declaredNames.add(name)
          contains.add(`${owner}\u0000${name}`)
        }
      }
    } else if (t === "typealias_declaration" || t === "associatedtype_declaration") {
      const nameNode = firstChildOfType(n, "type_identifier")
      const name = nameNode ? nameNode.text : null
      if (name) {
        declaredNames.add(name)
        if (owner !== null && ownerIsType) contains.add(`${owner}\u0000${name}`)
        else if (owner !== null) functionOwnedContainsExcluded++
        else {
          fileScopeNames.push(name)
          if (EXPORT_LEVELS.has(accessLevel(n))) exports.add(`${moduleSource}\u0000${name}`)
        }
      }
    }

    for (let i = n.namedChildCount - 1; i >= 0; i--) {
      const c = n.namedChild(i)
      if (c) walk(c, childOwner, childOwnerIsType, childOwnerIsEnum, nextInsideFunction)
    }
  }

  function firstNamed(n: any): any | null {
    return n.namedChildCount > 0 ? n.namedChild(0) : null
  }
  /**
   * `static func < (l:r:)` — the name is the token immediately after `func`.
   *
   * The grammar reads reserved operator tokens ANONYMOUSLY (`==`, `+`, `<`,
   * `===`) and falls back to a NAMED `custom_operator` node for sequences with no
   * reserved token (`!==`, `~=`) — checked on the pinned wasm with
   * script/m14/tmp/swift-token-shapes.ts. The first version of this walk carried
   * a hard-coded list of operator spellings, so every token outside it was read
   * as NAMELESS: `func ===`/`func !==`/`func ~=` at file scope never entered the
   * truth set, while the analyzer published them — that is the whole
   * `exports IUnknown+Identity -> ===` EXTRA, and the mirrored MISSING rows for
   * names containing tokens the list lacked. The token after `func` IS the name
   * whenever it is not a normal identifier and not a paren.
   */
  function operatorName(n: any): string | null {
    let sawFunc = false
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i)
      if (!c) continue
      if (!c.isNamed && c.type === "func") { sawFunc = true; continue }
      if (!sawFunc) continue
      if (c.isNamed && (c.type === "simple_identifier" || c.type === "identifier")) return null
      if (c.isNamed && c.type === "custom_operator") return c.text
      if (!c.isNamed && c.type !== "(" && c.type !== ")" && c.type !== "{") return c.text
      return null
    }
    return null
  }

  walk(root, null, false, false, false)
  return { contains, exports, imports, declaredNames, fileScopeNames, functionOwnedContainsExcluded }
}

/**
 * The truth rows in the differential's shape, one per derived edge.
 *
 * The `\u0000` key in each set is the pair separator, not part of either name:
 * a Swift identifier can contain any Unicode scalar except a null, so the split
 * is exact where a textual separator could collide with a member name.
 *
 * TWO SPELLINGS ARE RECONCILED HERE, and the reason is the harness's, not the
 * language's. The differential matches on `label + normTarget(target)`, and
 * `normTarget` is the target's LAST SEGMENT with type arguments stripped — it
 * cannot reconcile the two places where the analyzer and a plain reading of the
 * tree name the SAME declaration differently:
 *
 *   `` `continue` ``  a backtick-quoted declaration (legal Swift, common in the
 *                     stdlib and in `NIOTypedHTTPServerUpgraderStateMachine`'s
 *                     `InputClosedAction`). The analyzer strips the quoting
 *                     (`stripNameQuoting`); the tree spells it with backticks.
 *                     Measured as 2 clean-file MISSING rows on the 60-file
 *                     swift-nio draw before this: `InputClosedAction -> `continue``
 *                     and `FileDescriptor -> `open``.
 *   `operator ==`     an operator overload. The analyzer labels it
 *                     `operator <token>` (a `func ==` has no identifier, so the
 *                     name comes from the anonymous token); the tree gives the
 *                     bare token. Measured as a `contains WrongTypeError ->
 *                     operator ==` unexplained row beside a MISSING
 *                     `-> ==` before this.
 *
 * The oracle applies the IDENTICAL reconciliation on both sides in its own
 * comparison (`normalize()`), which is why its counts never moved: rows are
 * emitted here in the analyzer's naming convention, and the raw tree spelling
 * stays visible in the walker's own sets. That is also why the oracle's
 * `truthRawSpellingChanged` counter — the size of its reconciliation — is the
 * published measure of how much this mapping absorbs.
 */
export function swiftTruthRows(truth: SwiftTruth): SwiftTruthRow[] {
  const rows: SwiftTruthRow[] = []
  for (const label of SWIFT_ORACLE_LABELS) {
    for (const key of truth[label]) {
      const i = key.indexOf("\u0000")
      if (i < 0) continue
      rows.push({ label, from: key.slice(0, i), target: comparisonSpelling(key.slice(i + 1)) })
    }
  }
  return rows
}

/** A Swift identifier: a letter or underscore followed by letters, digits or
 *  underscores. Anything else at a declaration's name position is an operator,
 *  or a backtick-quoted identifier, and both are re-spelled to the analyzer's
 *  convention by the caller above. */
const SWIFT_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/
export function comparisonSpelling(name: string): string {
  const unquoted = name.replace(/`/g, "")
  if (SWIFT_IDENTIFIER.test(unquoted)) return unquoted
  // `constructor` and other family names are identifiers and were handled above.
  return unquoted.length > 0 ? `operator ${unquoted}` : unquoted
}
