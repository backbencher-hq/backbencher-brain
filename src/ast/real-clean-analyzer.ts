import type { Node } from "web-tree-sitter"
import { ASTEngine } from "./engine"

// =============================================================================
// Clean language analyzer — `tree-sitter-clean.wasm`, pinned v1.2.7.
//
// THE MEASURED SURFACE THIS FILE IS BUILT AGAINST
// ------------------------------------------------
// Every rule below is stated over a census of the PINNED grammar run across the
// whole Clean universe on this machine: 320 files (`clean-stdlib` 74, `Prelude`
// 42, `Clyde` 109, `eastwood` 65, `cloogle.org` 12, plus this repo's own 8
// validation fixtures), 331,079 AST nodes, 185 distinct node types, 135 of them
// NAMED. Numbers in comments are census numbers and the census is re-runnable
// (`script/m14/clean-census.mts`).
//
// WHAT THE PREVIOUS 864-LINE VERSION NAMED: 35 of those 135 named types. The 100
// it did not name cover 81,531 sites — the whole generic/type-class-generic
// machinery, every macro, the class-context constraints, the record-field
// access graph, the selective-import item lists, the where-locals, and every
// type reference in the corpus. The four largest single losses, each measured:
//
//   * `macro_definition`      583 sites — a Clean module-level macro
//                              (`NSWindowCloseButton :== 0`) published NOTHING,
//                              and every application inside a macro body
//                              attributed to whatever frame was open.
//   * `local_binding`       1,911 sites — a where/with/let binder, holding 1,361
//                              function definitions, 449 local signatures and 11
//                              operator definitions. The old walk set
//                              `currentFunction = undefined` for the whole
//                              block (the M11.11 "closure boundary"), so all
//                              4,107 applications inside where blocks attributed
//                              to nothing. The haskell lane solved exactly this
//                              construct with scoped local identity
//                              (`owner.local`) and publishes its locals; Clean
//                              did not.
//   * `instance_declaration`  741 sites — 253 of them, across 54 files, have NO
//                              direct `constructor` child (`instance Array {} a`
//                              carries `array_type` + `type_variable` in the
//                              `argument` FIELD), so the old
//                              `findChild(node, n => n.type === "constructor")`
//                              returned null, the instance was skipped whole, and
//                              with it its Class symbol, its `implements` edge,
//                              its member scope and all 1,009 members' ownership.
//   * `class_context`         474 sites — `| Eq a, Ord a`. The old analyzer named
//                              the node type nowhere (spec gap CL-G3), so every
//                              class constraint in the corpus published nothing;
//                              469 of the 474 name a class that does exist.
//
// A DEAD BRANCH, AND THE FORM IT WAS TESTING
// -------------------------------------------
// `head.type === "qualified_identifier"` appears in the old `extractApplication`
// and it can never fire on real code: over the 320-file universe the pinned
// grammar emits `qualified_identifier` exactly TWICE, and both are in this repo's
// own synthetic fixtures (`validation/m12/fixtures/clean/Service.icl:29`
// `M.lookup`, `validation/m14/fixtures/clean/expression-shapes.icl:51`
// `M.lookupOne`). The qualified form real Clean code uses is
// `single_quoted_name` — 233 sites in the corpus, 87 of them in application-head
// position — and the old analyzer named the node type nowhere. So the lane's only
// qualified-name coverage was a form no Clean codebase contains, while the form
// every Clean codebase uses had no coverage at all. Both are handled now.
//
// ZERO REGEX
// ----------
// No regular expression appears in this file. Every name, every operator and
// every type head is read from an AST node's `text` or from its grammar field.
// Where a name needs normalizing (`(==)` → `==`) the class methods
// `startsWith`/`endsWith`/`slice` are used, which is the M49.R2 ruling already
// written into this lane's `unparenthesize`.
//
// EDGE DISCIPLINE
// ---------------
// Every edge is emitted only against a target this file can name: a callable,
// type, class, generic, data constructor or record field that a declaration in
// this file introduces. That is the FP-family rule the lane has always applied
// to `calls` — an application head that is a local variable or a StdEnv name
// emits no edge — extended uniformly to every edge kind, and it is what keeps
// precision at 1.0 in the M12 differential.
//
// The rule is also what makes the SEMANTIC of each edge provable, not guessed.
// Three edge kinds survive an external target because their MEANING does not
// depend on what the target is: a `references` edge in a typed position is a type
// reference whatever the type is, an `implements` edge is an instance whatever
// the class is, and a `calls` edge to a source-spelled qualified name
// (`'Data.Map'.get`) is that call. One kind does not survive it: an uppercase
// applied name that this file declares as nothing could be a data constructor
// (19.3% of the measured population) or a Clean uppercase FUNCTION, a definition
// MACRO, a type, or a class (the rest), and asserting a construction on a 19.3%
// reading is exactly the confidently-wrong edge this rule exists to prevent. So
// that branch emits nothing. The visible cost — 1,026 edges on this corpus — is
// the price of an ontology a reader can trust, and it is the same price the lane
// has always paid on `calls`.
// =============================================================================

/** The scope name used for a `where` / `with` / `let` local block. */
const LOCAL_SCOPE_NAME = "local"

/**
 * The reserved name for a parameter whose pattern binds no target (`_`, or a
 * destructuring pattern such as `(a, b)`). A name is required by the store's
 * parameter row, and inventing one would collide across overloads, so the
 * placeholder is a constant and `isOptional` marks it.
 */
const OPTIONAL_PARAM_NAME = "_"

interface Scope {
  node: Node
  name: string
  kind: ASTEngine.SymbolKind
  /** Lexically-visible local binders when this scope is a local block. */
  locals?: Map<string, string>
  /** A callable frame owns the edge attribution for its body. */
  isFrame?: boolean
}

// Scoped local identity (the haskell lane's rule, real-haskell-analyzer.ts:15-30,
// adopted because the construct is the same one). A where/with/let binder is NOT
// a module symbol, but its edges must be distinguishable from a module-level
// callable of the same name, so a local carries the lexical identity
// `${owner}.${name}` and target resolution walks the scope stack — a local is
// therefore only ever a target from inside its own scope.
interface LocalScopes {
  /** callable node id -> scoped identity (a bare name at module level). */
  callableScoped: Map<number, string>
  /** where/with/let block node id -> the binders it declares. */
  blockLocals: Map<number, Map<string, string>>
  /** callable node id -> the locals visible across that callable's whole RHS. */
  frameLocals: Map<number, Map<string, string>>
}

/** One type reference found inside a type expression, with its own node. */
interface TypeRef {
  name: string
  node: Node
}

/** One `type_signature`, read off the AST into the form the walk consumes. */
interface SignatureInfo {
  node: Node
  /** The RESULT type: `type_function`'s third child, the one after `arrow`. */
  returnType?: string
  /** DOMAIN argument types, in order, from the `type_application` spine. */
  paramTypes: string[]
  /** Type variables this signature binds — generic parameters, not references. */
  genericVars: Set<string>
  /** Every type the signature's type expressions mention, with its node. */
  typeRefs: TypeRef[]
  /** Class names in `| C a, D b`. */
  contextClasses: string[]
  /** The `special` types declared in the signature's special block. */
  specialTypes: string[]
  /** `f = code { … }` — an inline ABC/FFI body on the signature. */
  hasCodeBody: boolean
  /** A fixity written on the signature itself (`swap infixl 9 :: …`). */
  fixity?: { associativity?: string; precedence?: string }
}

/** One import item inside a `from M import …` list. */
interface ImportItem {
  name: string
  module: string
  kind: "name" | "instance" | "class" | "qualified"
  line: number
  /** Set when a `(..)` / `{field}` subset marker follows this name. */
  opens?: "record" | "constructor"
}

/** An operator fixity declaration, collected then attached to its operator. */
interface FixityRecord {
  name: string
  associativity?: string
  precedence?: string
  line?: number
}

interface CleanContext {
  symbols: ASTEngine.UniversalSymbol[]
  relationships: ASTEngine.UniversalRelationship[]
  imports: ASTEngine.ImportInfo[]
  exports: ASTEngine.ExportInfo[]
  errors: ASTEngine.ParseError[]
  patterns: Record<string, boolean>
  fixities: FixityRecord[]
  /** Every callable/macro/type name the file declares, so a call resolves even
   *  to a LATER-defined function (Clean forward references are pervasive). */
  declaredFunctions: Set<string>
  /** See `declarationKey`. -> symbol index, for the declaration merge and the
   *  multi-clause merge. */
  functionSymbolIndex: Record<string, number>
  /** See `declarationKey`. -> the signature that declares it. */
  signatures: Map<string, SignatureInfo>
  /** Lexical local identity (see LocalScopes). */
  localScopes: LocalScopes
  /** Module aliases from `import … as X`, so a `constructor X` in a type
   *  position can be told apart from a type named `X`. */
  importAliases: Set<string>
  /** Type names this file declares: synonyms, class names, instance targets,
   *  generics and the constructors of its ADTs. */
  declaredTypeNames: Set<string>
  /**
   * The subset of `declaredTypeNames` a `type_definition` introduces. Needed
   * SEPARATELY because that set also holds constructors, classes, macros and
   * record fields, and because Clean's coercion `(T x)` is an application whose
   * head is a `type_definition`'s name — the analyzer can say "this is a
   * coercion" and should, because the alternative is filing a known construct
   * inside a count that means "unclassifiable".
   */
  declaredTypeDefNames: Set<string>
  /** Record field names, for `field_access` / `update_field` resolution. */
  declaredFieldNames: Set<string>
  /** Data-constructor names, for `instantiates` / `pattern_match` targets. */
  declaredConstructors: Set<string>
  /**
   * Class (interface) and generic names. Needed separately from
   * `declaredTypeNames` because Clean lets a CLASS be applied to arguments —
   * implicit dictionary passing makes `C x` a call of `C`'s class method, not a
   * construction. Measured: 77 sites on `Clyde/Cocoa/layout.icl` alone, where
   * `NSLayoutXAxisAnchor view` calls the `instance NSLayoutAnchor a` method.
   */
  declaredClassNames: Set<string>
  /** Module name set by the header. */
  currentModule: string | undefined
  /** Scoped identity -> index of the symbol that owns that frame, so an
   *  expression-level fact can be recorded ON the symbol and not only as an edge. */
  frameSymbolIndex: Map<string, number>
  /** Scoped identity of the innermost open callable frame. */
  currentFrame: string | undefined
  /** Whether that frame is a where/with/let local. */
  currentFrameIsLocal: boolean
  seenRels: Set<string>
  /** File-level decision points, for `metadata.complexity`. */
  fileComplexity: number
  /**
   * Sites where an uppercase applied name declared NOWHERE in this file was
   * declined an `instantiates` edge, with the names involved.
   *
   * The count is emitted so the divergence from the M14.0.F5 oracle is VISIBLE in
   * the analyzer's own output and not only in a side instrument: that oracle
   * derives an `instantiates` from every `constructor`-headed application, and
   * over this corpus only 19.30% of those names are a data constructor anywhere —
   * 425 are a Clean uppercase FUNCTION, 205 a definition MACRO, 129 a type, 4 a
   * class, and 167 are declared in no corpus file at all. The lane would be
   * asserting 80.7% wrong edges to satisfy a check, so the check is red and the
   * disagreement is recorded instead. See reviews/clean/m14-0-clean-completeness.md
   * §"the F5 divergence", and the gate below re-derives the 19.30% from the
   * corpus so the claim cannot rot.
   */
  declinedInstantiations: { count: number; names: string[] }
  /**
   * Applications whose head is a TYPE this file declares: Clean's coercion. Kept
   * out of `declinedInstantiations` because the analyzer KNOWS what these are, and
   * a published honesty count that mixes "known" with "cannot tell" is not
   * honest about how much it does not know.
   */
  typeCoercions: { count: number; names: string[] }
  /**
   * Imported OPERATOR items. A Clean operator cannot be written as
   * `<module>:<item>` — every one contains a colon and the shared resolver splits
   * that form on the LAST colon — so these emit no `imports` edge. Counted so the
   * dependency stays visible.
   */
  operatorImports: { count: number; names: string[] }
  /**
   * Foreign Code Imports — `import code from "ctty.o"`, `import code from
   * library "CleanSerial_library"`.
   *
   * These name OBJECT FILES and LIBRARIES, not a Clean module: there is no
   * module to bind, and the thing being bound is a linker input. An `imports`
   * edge with an empty target would resolve to nothing, so none is emitted —
   * but "no edge" is a decision, and a decision that is not counted is
   * indistinguishable from a gap. Counted here so the 30 corpus files that
   * carry one are visible in the published metadata.
   */
  foreignCodeImports: { count: number; objects: string[] }
  /** Locals whose enclosing frame was lost to a parse-ERROR region; see `localOwner`. */
  detachedLocals: number
  /** Scoped frame identity -> decision points counted inside it. */
  frameComplexity: Map<string, number>
}

/**
 * The identity a declaration merges on.
 *
 * It must carry BOTH the enclosing frame and the enclosing OWNER, because Clean
 * has two independent nesting dimensions and either alone collides:
 *
 *   * frame alone: a class member `serialize` and an instance member `serialize`
 *     both sit at frame `undefined` (a class pushes a scope, not a frame), so
 *     the instance's definition merged into the class's Method and the instance
 *     lost its member. Measured on `Service.icl` before the fix.
 *   * owner alone: `f`'s where-local `g` and a module-level `g` share an owner
 *     only if the local's owner is its FRAME — which is exactly what makes a
 *     local distinguishable from a module callable of the same name.
 *
 * So the key is `${frameIdentity}|${ownerIdentity}::${name}`, and both passes
 * that build one use this single function.
 */
function declarationKey(frame: string | undefined, owner: string | undefined, name: string): string {
  return `${frame ?? ""}|${owner ?? ""}::${name}`
}

/** What a handler asks the walk to do about attribution frames. */
interface FrameSpec {
  /** The bare name the frame attributes to. */
  name: string
  kind: ASTEngine.SymbolKind
  isLocal: boolean
  /**
   * The `declarationKey` the frame's symbol is indexed under.
   *
   * It travels with the frame because the walk EXTENDS `currentFrame` before it
   * needs the key, and the key is built from the frame BEFORE the extension. The
   * first implementation rebuilt it at that point, got a different string, and
   * every `qualified_calls` write silently missed its symbol — 17 qualified
   * `calls` edges with an empty column. The publisher is the only place that
   * knows the pre-extension frame, so it hands the key over.
   */
  key: string
}

/**
 * Inner text of `(x)`, or null when the parens hold a PATTERN, not a name.
 *
 * M49.R2 (wave 2026-09-25): the two literals this used to carry — `/^\(|\)$/g`
 * and `/[,{}]/` — are character predicates on AST node text, which the policy's
 * "char-scan second" rule covers. Equivalence proof, edge cases included:
 *   strip  the two anchors each remove at most one leading `(` and one trailing
 *          `)`, independently of one another and in either order, so doing one
 *          then testing the other is the same function as `startsWith`/`endsWith`
 *          + `slice` on the already-stripped value.
 *   test   `/[,{}]/` is a three-character membership; `includes` on a 3-char set is
 *          the same predicate without the engine (and without the `lastIndex`
 *          state a `g` literal carries, which this call never relied on).
 */
function unparenthesizeText(text: string): string | null {
  let body = text
  if (body.startsWith("(")) body = body.slice(1)
  if (body.endsWith(")")) body = body.slice(0, -1)
  const inner = body.trim()
  if (!inner) return null
  if (inner.includes(",") || inner.includes("{") || inner.includes("}")) return null
  return inner
}

/** Drop one pair of surrounding double quotes from a STRING node's text.
 *
 *  The same shape as `unparenthesizeText` above, and for the same reason: a
 *  `string` leaf's `text` is the source text, quotes included, and a published
 *  NAME is the name. It is guarded on the quote being both first and last, so a
 *  node that is not a quoted literal is returned unchanged rather than mangled,
 *  and only ONE pair is removed — a string whose CONTENT starts or ends with a
 *  quote is still delimited correctly, because the delimiters are the outermost
 *  pair and this loop stops at the first match. */
function unquoteText(text: string): string {
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) return text.slice(1, -1)
  return text
}

/**
 * Words the grammar treats as RESERVED at a declaration head. A declaration
 * whose name is one of these is parse damage, not a declaration.
 *
 * This exists because tree-sitter's recovery will re-lex a keyword as an
 * identifier when the construct it belongs to has already failed. The corpus
 * case is `ObjectIO Examples/hanoi/Hanoi.icl`, where lines 213 and 225 each
 * open a nested `where` inside an already-damaged instance body, and the parse
 * produced `function_declaration` nodes literally NAMED `where`. The lane then
 * published a `function` symbol called `where` owned by the module, and the
 * `x = nr*XOffs` on the next line — where `XOffs` is a `::`-defined synonym
 * used as a value — was read as an ADT constructor applied to that fabricated
 * function, emitting `instantiates -> where -> XOffs`. The honesty gate caught
 * it as `instantiates.targetIsAMacro`; the FABRICATION is upstream of that, and
 * a symbol named after a keyword can never be right, so it is declined here
 * rather than published and diagnosed downstream.
 *
 * The list is the grammar's own alphabetic anonymous tokens (the 32 literal
 * words in `node-types.json`), MINUS four that are context-reserved rather than
 * reserved: `E`, `apply`, `inline` and `library` can each be an ordinary
 * identifier where the grammar does not need the keyword, and declining a real
 * symbol is worse than carrying a rare fabricated one. `library` is the FCI
 * item keyword this lane's own grammar wave added.
 */
const RESERVED_DECLARATION_NAMES = new Set([
  "as", "case", "class", "code", "definition", "derive", "else", "export",
  "foreign", "from", "generic", "if", "implementation", "import", "in",
  "infix", "infixl", "infixr", "instance", "let", "module", "of", "qualified",
  "special", "system", "then", "where", "with",
])

/** A declared name that is a reserved word is damage; see the set above. */
function isReservedDeclarationName(name: string | null | undefined): boolean {
  return name !== null && name !== undefined && RESERVED_DECLARATION_NAMES.has(name)
}

/** The operator leaf node types an import item list or a constraint can carry.
 *  Every one of them is a LEAF whose `text` IS the operator, so the whole family
 *  needs no character test. */
const OPERATOR_LEAF_TYPES = new Set([
  "operator",
  "operator_add",
  "operator_and",
  "operator_compare",
  "operator_cons",
  "operator_cons_strict",
  "operator_dot",
  "operator_exp",
  "operator_mul",
  "operator_or",
  "operator_pipe",
  "monad_bind",
  "backtick_operator",
  "uniqueness_star",
  "parenthesized_operator",
])

/** Every pattern node whose subtree is pattern territory, not expression. */
const PATTERN_NODE_TYPES = new Set([
  "constructor_pattern",
  "list_pattern",
  "tuple_pattern",
  "record_pattern",
  "paren_pattern",
  "unboxed_pattern",
  "cons_pattern",
  "strict_binding_pattern",
  "record_update_pattern",
])

/** The definition node types that own an attribution frame. */
/**
 * Node types that carry a uniqueness CONSTRAINT rather than a type, so an enclosing
 * `array_type` / `uniqueness_type` is a constraint and not a type. `{!}` and `{#}`
 * parse to these and nothing else; `{32#.a}` parses to a `number` PLUS a
 * `dotted_type`, and the `dotted_type` is what makes it a type.
 */
const CONSTRAINT_MARKER_TYPES = new Set([
  "number",
  "integer",
  "float",
  "uniqueness_star",
  "uniqueness_constraints",
])

const CALLABLE_NODE_TYPES = new Set([
  "function_declaration",
  "operator_definition",
  "generic_case_definition",
  "macro_definition",
])

/** The comment node types, in both Clean spellings. */
const COMMENT_TYPES = new Set(["line_comment", "block_comment"])

/** The decision-point node types, for file and per-symbol complexity. */
const DECISION_NODE_TYPES = new Set([
  "case_expression",
  "case_alternative",
  "guard_equation",
  "guard",
  "if_expression",
  "comprehension_qualifier",
  "binary_expression",
])

export class RealCleanAnalyzer implements ASTEngine.LanguageAnalyzer {
  analyze(rootNode: Node, fileContent: string, filePath: string): ASTEngine.ParseResult {
    const ctx: CleanContext = {
      symbols: [],
      relationships: [],
      imports: [],
      exports: [],
      errors: [],
      patterns: {},
      fixities: [],
      declaredFunctions: new Set(),
      functionSymbolIndex: Object.create(null),
      signatures: new Map(),
      localScopes: { callableScoped: new Map(), blockLocals: new Map(), frameLocals: new Map() },
      importAliases: new Set(),
      declaredTypeNames: new Set(),
      declaredTypeDefNames: new Set(),
      declaredFieldNames: new Set(),
      declaredConstructors: new Set(),
      declaredClassNames: new Set(),
      frameSymbolIndex: new Map(),
      currentModule: undefined,
      currentFrame: undefined,
      currentFrameIsLocal: false,
      seenRels: new Set(),
      fileComplexity: 1,
      declinedInstantiations: { count: 0, names: [] },
      typeCoercions: { count: 0, names: [] },
      operatorImports: { count: 0, names: [] },
      foreignCodeImports: { count: 0, objects: [] },
      detachedLocals: 0,
      frameComplexity: new Map(),
    }
    const scopeStack: Scope[] = []
    const stack: StackEntry[] = [{ node: rootNode }]

    // ==========================================================================
    // PASS 1 — the name tables the walk needs. Linear sub-passes over the same
    // tree; none of them emits, so a name is available everywhere regardless of
    // source order.
    // ==========================================================================
    this.collectNames(rootNode, ctx)

    // ==========================================================================
    // PASS 2 — the walk. An explicit stack (the corpus is 331k nodes and a
    // recursive walk risks a deep stack on a long guard chain); enter/exit
    // markers carry the attribution state.
    // ==========================================================================
    while (stack.length > 0) {
      const entry = stack.pop()!

      if (entry.isExit) {
        // ONLY an entry that OPENED a frame may restore one. A scope-only exit
        // (module, type, class, instance, where/with/let block) must leave the
        // frame alone.
        //
        // The first implementation restored unconditionally, and because
        // `restoreFrame` is `undefined` for a scope-only entry that assigned
        // `ctx.currentFrame = undefined` on every scope exit. It went unnoticed
        // because a `where_block` is usually the LAST child of its callable, so
        // nothing after it needed the frame; a `with_block` in the middle of a
        // guard chain does, and measured on Clyde/cleantools/Pm/PmDriver.icl the
        // 8 `with`-block binders after one at line 688 published with
        // `ownerName` undefined — a member without an owner, the exact thing the
        // lane's "members without ownerName = 0" invariant forbids.
        if (entry.restoresFrame) {
          // The frame's decision-point count, taken as the frame closes.
          if (ctx.currentFrame !== undefined) {
            const idx = ctx.frameSymbolIndex.get(ctx.currentFrame)
            if (idx !== undefined) {
              const sym = ctx.symbols[idx]
              sym.complexity = Math.max(sym.complexity ?? 1, ctx.frameComplexity.get(ctx.currentFrame) ?? 1)
            }
          }
          ctx.currentFrame = entry.restoreFrame
          ctx.currentFrameIsLocal = entry.restoreLocal === true
        }
        if (scopeStack.length > 0 && scopeStack[scopeStack.length - 1].node === entry.node) scopeStack.pop()
        continue
      }

      const node = entry.node
      if (node.isMissing) continue

      // Parse errors. The pinned grammar's error recovery is honest here: a
      // damaged region becomes an `ERROR` node and everything outside it still
      // parses, so reporting the ERROR node's own span is the truthful report
      // (lane-formula dimension 6 — damage is not loss).
      if (node.type === "ERROR") {
        ctx.errors.push({
          message: "Syntax Error",
          range: {
            startLine: node.startPosition.row + 1,
            startColumn: node.startPosition.column,
            endLine: node.endPosition.row + 1,
            endColumn: node.endPosition.column,
            startIndex: node.startIndex,
            endIndex: node.endIndex,
          },
          severity: "error",
        })
      }

      if (DECISION_NODE_TYPES.has(node.type)) {
        ctx.fileComplexity++
        if (ctx.currentFrame !== undefined) {
          ctx.frameComplexity.set(ctx.currentFrame, (ctx.frameComplexity.get(ctx.currentFrame) ?? 1) + 1)
        }
      }

      const currentScope = scopeStack.length > 0 ? scopeStack[scopeStack.length - 1] : undefined
      // DAMAGE, not loss. A declaration the pinned grammar could not read survives
      // as an `ERROR` subtree, and whatever is inside it is reached with NO enclosing
      // `where_block` scope — so a callable in there looks module-level and used to
      // be published `visibility: "public"`, which put a parse artifact into the
      // module's EXPORT surface. Measured on the 2,179-file corpus:
      // `clean-libraries/Examples/GEC/APLAS.icl`'s local `check` (and its three
      // clauses) and `fromDynStr` were both exported by a module that never declared
      // them. The symbols are KEPT — the code exists and the lane formula says damage
      // is not loss — but they are flagged and excluded from the export surface,
      // because "this module exports `check`" is a claim about its API and the parse
      // cannot support one.
      const inErrorRegion = entry.inError === true || node.type === "ERROR"
      let frame: FrameSpec | null = null
      let openedScope = false

      switch (node.type) {
        case "module_declaration":
          openedScope = this.enterModule(node, ctx, scopeStack)
          break
        case "type_definition":
          openedScope = this.processTypeDefinition(node, ctx, scopeStack)
          break
        case "class_declaration":
          openedScope = this.processClass(node, ctx, scopeStack)
          break
        case "instance_declaration":
          openedScope = this.processInstance(node, ctx, scopeStack)
          break
        case "generic_declaration":
          this.processGenericDeclaration(node, ctx, currentScope)
          break
        case "derive_declaration":
          this.processDeriveDeclaration(node, ctx)
          break
        case "function_declaration":
        case "operator_definition":
        case "generic_case_definition":
          frame = this.processCallableNode(node, ctx, currentScope, inErrorRegion)
          break
        case "macro_definition":
          frame = this.processMacro(node, ctx, currentScope)
          break
        case "foreign_export":
          this.processForeignExport(node, ctx, currentScope)
          break
        case "fixity_declaration":
          this.processFixityDeclaration(node, ctx)
          break
        case "type_signature":
          this.processTypeSignature(node, ctx, currentScope, inErrorRegion)
          break
        case "where_block":
        case "with_block":
        case "let_expression":
          scopeStack.push({
            node,
            name: LOCAL_SCOPE_NAME,
            kind: ASTEngine.SymbolKind.Namespace,
            locals: ctx.localScopes.blockLocals.get(node.id),
          })
          openedScope = true
          break
        case "special_block":
          this.processSpecialBlock(node, ctx)
          break
        case "application":
          this.extractApplication(node, ctx, scopeStack)
          break
        case "field_access":
          this.emitFieldUse(node, ctx, "field_read")
          break
        case "record_update":
          this.extractRecordUpdate(node, ctx)
          break
        case "record_expression":
          this.extractRecordExpression(node, ctx)
          break
        case "constructor_pattern":
          this.extractConstructorPattern(node, ctx)
          break
        case "lambda_expression":
          ctx.patterns["Higher-Order Functions"] = true
          break
        case "list_comprehension":
        case "array_comprehension":
          ctx.patterns["List Comprehensions"] = true
          break
        case "case_expression":
        case "case_alternative":
          ctx.patterns["Pattern Matching"] = true
          break
        case "code_expression":
          ctx.patterns["Inline Machine Code"] = true
          break
        case "unboxed_expression":
        case "unboxed_pattern":
        case "uniqueness_type":
        case "uniqueness_star":
          ctx.patterns["Uniqueness Types"] = true
          break
        case "type_definition_body":
          ctx.patterns["Algebraic Data Types"] = true
          break
        case "record_definition":
          ctx.patterns["Record Types"] = true
          break
        case "record_update_pattern":
        case "update_field":
          ctx.patterns["Record Updates"] = true
          break
        case "monad_bind":
          ctx.patterns["Do Notation"] = true
          break
        case "range_operator":
          ctx.patterns["Range Expressions"] = true
          break
        default:
          break
      }

      if (frame) {
        const previousFrame = ctx.currentFrame
        const previousLocal = ctx.currentFrameIsLocal
        ctx.currentFrame = previousFrame === undefined ? frame.name : `${previousFrame}.${frame.name}`
        ctx.currentFrameIsLocal = frame.isLocal
        // The frame's own symbol, so an expression-level fact can be recorded ON
        // the symbol and not only as an edge. The key comes from the publisher.
        const frameIdx = ctx.functionSymbolIndex[frame.key]
        if (frameIdx !== undefined) ctx.frameSymbolIndex.set(ctx.currentFrame, frameIdx)
        scopeStack.push({
          node,
          name: frame.name,
          kind: frame.kind,
          locals: ctx.localScopes.frameLocals.get(node.id),
          isFrame: true,
        })
        stack.push({ node, isExit: true, restoresFrame: true, restoreFrame: previousFrame, restoreLocal: previousLocal })
      } else if (openedScope) {
        stack.push({ node, isExit: true })
      }

      for (let i = node.namedChildCount - 1; i >= 0; i--) {
        const child = node.namedChild(i)
        if (child) stack.push({ node: child, inError: inErrorRegion })
      }
    }

    // ==========================================================================
    // PASS 3 — closure.
    // ==========================================================================
    this.attachFixities(ctx)
    this.emitContainsEdges(ctx)
    this.emitExports(ctx)
    this.classifyEvidenceTier(ctx)

    const patterns: string[] = []
    for (const p in ctx.patterns) patterns.push(p)

    return {
      language: "clean",
      symbols: ctx.symbols,
      relationships: ctx.relationships,
      imports: ctx.imports,
      exports: ctx.exports,
      errors: ctx.errors,
      metadata: {
        complexity: ctx.fileComplexity,
        linesOfCode: fileContent.split("\n").length,
        cyclomaticComplexity: ctx.fileComplexity,
        patterns,
        hasTypeInference: true,
        analysisVersion: "12.0.0-clean-ast-complete",
        // The price of the in-file resolution rule, stated in the output rather
        // than inferred from a diff. See the field's declaration for the
        // measurement behind it.
        declinedInstantiations: ctx.declinedInstantiations.count,
        declinedInstantiationNames: ctx.declinedInstantiations.names,
        // Applying a declared type: a coercion, counted apart from the declines
        // because the construct is known rather than unclassifiable.
        typeCoercions: ctx.typeCoercions.count,
        typeCoercionNames: ctx.typeCoercions.names,
        // Imported operators: a real dependency the shared `<module>:<item>` edge
        // form cannot express, so it is counted rather than emitted unresolvable.
        operatorImports: ctx.operatorImports.count,
        operatorImportNames: ctx.operatorImports.names,
        // Foreign code imports: a real dependency the `<module>:<item>` edge form
        // cannot express, because a linker input is not a module.
        foreignCodeImports: ctx.foreignCodeImports.count,
        foreignCodeObjects: ctx.foreignCodeImports.objects,
        // Locals whose enclosing function the pinned grammar could not read, so the
        // module owns them instead of a frame that does not exist.
        detachedLocals: ctx.detachedLocals,
      },
    }
  }

  // ============================================================================
  // PASS 1 — name tables
  // ============================================================================

  /**
   * Imports, including the SELECTIVE item list.
   *
   * The old version pushed `items: []` unconditionally. Measured over the
   * corpus: 367 of the 1,332 `import_declaration`s are `from M import …` with an
   * item list — 943 items across 20 distinct item node types (`constructor` 541,
   * `identifier` 188, `range_operator` 59, `parenthesized_operator` 45,
   * `operator_compare` 30, `operator` 17, `record_subset` 11,
   * `class_method_name` 10, `constructor_subset` 7, …). Every one of those names
   * was invisible to the product: the import edge had to be `<module>:*` when the
   * file actually said exactly which symbols it wanted, which is the difference
   * between an edge that resolves and one that never can (see
   * src/ast/import-resolution.ts — a target must be in the exporting file's
   * export surface before it may be joined).
   */
  private collectImport(n: Node, ctx: CleanContext, edgeSource: string, importEdges: Set<string>): void {
    {
      {
        const moduleNodes = this.fields(n, "module")
        const aliasNode = n.childForFieldName("alias")
        const alias = aliasNode ? this.assembleModuleName(aliasNode) : undefined
        let isQualified = false
        for (let i = 0; i < n.childCount; i++) {
          const c = n.child(i)
          if (c && !c.isNamed && c.type === "qualified") { isQualified = true; break }
        }
        if (alias) ctx.importAliases.add(alias)

        const items = this.importItems(n, moduleNodes)
        for (const it of items) {
          // An OPERATOR item cannot be written as `<module>:<item>`.
          //
          // The item is the shared edge form and `import-resolution.ts` splits it
          // on the LAST colon (`:232` — "a specifier may itself contain one"),
          // which is right for a file path and wrong for a Clean operator, because
          // EVERY Clean operator contains a colon. `from UtilStrictLists import
          // StrictListToList, :: List, :!, IsEmptyList` produced the target
          // `UtilStrictLists::!`, and the resolver read module `UtilStrictLists::`
          // and item `` — an edge that names a module which does not exist and an
          // item that is empty. The 2,179-file corpus has 10 of these across 4
          // files, and the honesty gate found every one.
          //
          // Parenthesising does not rescue it either: `(:!)` would split correctly
          // but would not match the exporting module's export surface, where the
          // operator is normalised to the BARE `:!`. So the two conventions cannot
          // both hold, and the lane's rule is the tie-breaker: do not emit an edge
          // that provably cannot resolve. The dependency is real, so it is counted
          // and published rather than dropped.
          if (it.name.includes(":")) {
            ctx.operatorImports.count++
            if (ctx.operatorImports.names.length < 25 && !ctx.operatorImports.names.includes(it.name)) {
              ctx.operatorImports.names.push(it.name)
            }
            continue
          }
          const key = `${edgeSource}|${it.module}:${it.name}|${it.line}`
          if (importEdges.has(key)) continue
          importEdges.add(key)
          this.pushRel(
            ctx,
            edgeSource,
            `${it.module}:${it.name}`,
            ASTEngine.RelationshipType.Imports,
            1.0,
            {
              cleanSpecific: true,
              module: it.module,
              itemKind: it.kind,
              isInstanceImport: it.kind === "instance",
              isClassImport: it.kind === "class",
            },
            it.line,
          )
        }

        for (const modNode of moduleNodes) {
          if (!modNode) continue
          const modName = this.assembleModuleName(modNode)
          const mine = items.filter((it) => it.module === modName)
          // An import binds a NAME once. `class zero(zero)` names the class `zero`
          // and then its METHOD list, and both spellings are the same symbol, so
          // the list is deduped in source order — a repeated entry is not a second
          // binding and would emit a duplicate `<module>:<item>` edge.
          const seenItem = new Set<string>()
          const unique = mine.filter((it) => {
            if (seenItem.has(it.name)) return false
            seenItem.add(it.name)
            return true
          })
          ctx.imports.push({
            module: modName,
            source: modName,
            items: unique.map((it) => it.name),
            isTypeOnly: false,
            range: this.nodeToRange(n),
            metadata: {
              cleanSpecific: true,
              isQualified,
              alias,
              isSelective: mine.length > 0,
              itemKinds: mine.map((it) => it.kind),
              // Which imported names are opened as a SUBSET (`::T(..)`,
              // `::T{field}`). Recorded because the subset marker is not a name
              // and so has no edge of its own, and "this import binds all of T's
              // constructors" is a fact the product can use.
              openItems: unique.filter((it) => it.opens).map((it) => `${it.name}${it.opens === "record" ? "{}" : "(..)"}`),
            },
          })
          // The importer depends on the imported module. Kept alongside the
          // per-item `imports` edge because the two answer different questions:
          // this one is "which modules does this file read", the `imports` edges
          // are "which named symbols does it bind", and only the second can be
          // joined to a symbol in another file.
          this.pushRel(
            ctx,
            ctx.currentModule || "",
            modName,
            ASTEngine.RelationshipType.References,
            1.0,
            { cleanSpecific: true, isImportDependency: true },
            this.lineOf(modNode),
          )
          if (modName.indexOf("StdEnv") !== -1) ctx.patterns["Standard Environment"] = true
          // A whole-module import names no single symbol, so it takes the
          // `<module>:*` wildcard the TypeScript lane uses for a namespace import
          // and that the resolver documents as legitimately unresolved rather
          // than guessing a node.
          if (mine.length === 0) {
            const key = `${edgeSource}|${modName}:*`
            if (!importEdges.has(key)) {
              importEdges.add(key)
              this.pushRel(
                ctx,
                edgeSource,
                `${modName}:*`,
                ASTEngine.RelationshipType.Imports,
                1.0,
                { cleanSpecific: true, module: modName, isWildcard: true },
                this.lineOf(modNode),
              )
            }
          }
        }
      }
    }
  }

  /**
   * The item list of one import declaration, each item tagged by the keyword that
   * introduces it.
   *
   * All four keyword forms exist in the corpus and each names a DIFFERENT thing,
   * so the tag is load-bearing rather than cosmetic:
   *   `from M import ::NSApplication, sharedApplication` → `::` = public-only
   *   `from M import instance toString {#Char}`            → an INSTANCE
   *   `from M import class C a`                            → a CLASS
   *   `import M => qualified join`                          → a QUALIFIED name
   *   `from M import ::GeneralSt{..}`                      → an open record
   */
  private importItems(node: Node, moduleNodes: Node[]): ImportItem[] {
    const out: ImportItem[] = []
    let currentModule = moduleNodes.length > 0 && moduleNodes[0] ? this.assembleModuleName(moduleNodes[0]) : ""
    let keyword: ImportItem["kind"] = "name"
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i)
      if (!c) continue
      if (!c.isNamed) {
        if (c.type === "instance") keyword = "instance"
        else if (c.type === "class") keyword = "class"
        else if (c.type === "qualified") keyword = "qualified"
        else if (c.type === "::") keyword = "name"
        continue
      }
      // The `module` / `alias` fields are not items; a `module_name` among them
      // re-points the item stream at the module it introduces.
      let isModuleField = false
      for (let k = 0; k < node.childCount; k++) {
        const field = node.fieldNameForChild(k)
        if (field !== "module" && field !== "alias") continue
        const fc = node.child(k)
        if (fc && fc.startIndex === c.startIndex) { isModuleField = true; break }
      }
      if (isModuleField) {
        if (c.type === "module_name" && moduleNodes.some((m) => m.startIndex === c.startIndex)) {
          currentModule = this.assembleModuleName(c)
        }
        continue
      }
      // An OPEN SUBSET is a MARKER on the name before it, not a name of its own.
      // Measured on the real forms: `class Enum (..)` parses as `class`,
      // `constructor Enum`, `parenthesized_operator (..)`; `::DirError(..)` as
      // `::`, `constructor DirError`, `parenthesized_operator (..)`; and
      // `::FileInfo{pi_fileInfo}` as `::`, `constructor FileInfo`,
      // `record_subset {pi_fileInfo}`. Publishing the marker produced import
      // targets `StdClass:(..)` and `Directory:{..}` — strings that name no
      // symbol in any file and can never resolve, which is exactly the defect
      // the per-item edge exists to remove. The marker is now recorded on the
      // item it qualifies and emits no edge of its own.
      if (this.isOpenSubsetMarker(c)) {
        if (out.length > 0) {
          const last = out[out.length - 1]
          last.opens = c.type === "record_subset" ? "record" : "constructor"
        }
        continue
      }
      const described = this.describeImportItem(c, keyword)
      if (described) out.push({ ...described, module: currentModule })
    }
    return out
  }

  /**
   * Is this import-item child an OPEN-SUBSET MARKER rather than a name?
   *
   * `constructor_subset`, `record_subset`, and the `parenthesized_operator` the
   * grammar types for a `(..)` list — every one of which QUALIFIES the name in
   * front of it. All three are real corpus node types (7, 11 and — as the `(..)`
   * spelling — the bulk of the 512 `parenthesized_operator` sites).
   */
  private isOpenSubsetMarker(node: Node): boolean {
    if (node.type === "record_subset") return true
    if (node.type === "constructor_subset") {
      // `(..)` is a bare OPEN marker; `(Ok)` NAMES the constructor the subset is
      // restricted to, and that constructor is a real symbol in the exporting
      // module. Measured on the real forms: `class Enum (..)` and
      // `::DirError(..)` give an EMPTY `constructor_subset`, while
      // `:: MaybeError (Ok)` gives one holding `Ok`.
      return this.firstNamedChildOfType(node, "constructor") === null
    }
    // The `(..)` list after a class or constructor name.
    if (node.type === "parenthesized_operator") return true
    return false
  }

  /** Name + kind for one import-item node, or null when it names nothing. */
  private describeImportItem(node: Node, keyword: ImportItem["kind"]): Omit<ImportItem, "module"> | null {
    const line = this.lineOf(node)
    if (!line) return null
    switch (node.type) {
      case "identifier":
      case "constructor":
        return { name: node.text, kind: keyword === "name" ? "name" : keyword, line }
      case "constructor_subset": {
        // Reached only when the subset NAMES a constructor (`:: MaybeError (Ok)`);
        // the bare `(..)` form is a marker and is filtered before this call.
        const inner = this.firstNamedChildOfType(node, "constructor")
        return inner ? { name: inner.text, kind: keyword, line } : null
      }
      case "class_method_name": {
        // `class zero(zero)` names the CLASS `zero` and then its METHOD list;
        // the method is a real symbol in the exporting module, so it is an item
        // in its own right, and it dedupes against the class item when the two
        // spell the same name.
        const inner = node.namedChild(0)
        return { name: inner?.text ?? node.text, kind: keyword, line }
      }
      default:
        if (OPERATOR_LEAF_TYPES.has(node.type)) return { name: node.text, kind: keyword, line }
        return null
    }
  }

  /**
   * THE NAME-COLLECTION WALK. One traversal builds every table the emitting walk
   * needs: the module name, the imports and their item lists, the type signatures
   * keyed by declaration identity, the declared type / class / constructor /
   * field / callable name sets, and the lexical local scopes.
   *
   * It was four separate traversals (imports, signatures, declared names, local
   * scopes) plus a fifth for the module header, so the analyzer visited the
   * corpus's 331,079 nodes five times before emitting anything. All five need the
   * same two pieces of context — the enclosing FRAME identity and the enclosing
   * OWNER — so they share one walk and one tracker and the traversal count drops
   * from six (five names + one emit) to two.
   *
   * The tracker is the same rule the emitting walk uses, in the same order, so the
   * `declarationKey` a signature is stored under is the key the emitting walk
   * looks it up with. Both call `declarationKey`; neither spells the identity.
   */
  private collectNames(root: Node, ctx: CleanContext): void {
    // A file with no `module` header (3 of the 312 corpus files are include-only
    // stubs) still records its imports: `pushRel` refuses an empty source, so a
    // headerless file emits no edge rather than attributing one to a module name
    // that does not exist.
    const importEdges = new Set<string>()
    const visit = (n: Node, frameId: number, frame: string | undefined, owner: string | undefined): void => {
      let nextFrameId = frameId
      let nextFrame = frame
      let nextOwner = owner

      switch (n.type) {
        case "module_declaration": {
          const nameNode = n.childForFieldName("name")
          if (nameNode) {
            ctx.currentModule = this.assembleModuleName(nameNode)
            nextOwner = ctx.currentModule
          }
          break
        }
        case "import_declaration":
          this.collectImport(n, ctx, ctx.currentModule ?? "", importEdges)
          break
        case "foreign_code_import": {
          // A linker input, not a module: counted, not emitted as an `imports`
          // edge (see `foreignCodeImports`).
          //
          // The name is on the ITEM's `object` field, not this node's — each
          // item is `"a.o"` or `library "L"`, and the import is a bare sequence
          // of them — so reading `object` here silently yields nothing and the
          // counter would publish a count with no evidence behind it.
          ctx.foreignCodeImports.count++
          for (let i = 0; i < n.namedChildCount; i++) {
            const item = n.namedChild(i)
            if (!item || item.type !== "foreign_code_item") continue
            const obj = item.childForFieldName("object")
            const name = obj ? unquoteText(obj.text) : undefined
            if (name && ctx.foreignCodeImports.objects.length < 25 && !ctx.foreignCodeImports.objects.includes(name)) {
              ctx.foreignCodeImports.objects.push(name)
            }
          }
          break
        }
        case "type_definition": {
          const nm = n.childForFieldName("name")
          if (nm) { ctx.declaredTypeNames.add(nm.text); ctx.declaredTypeDefNames.add(nm.text) }
          const body = n.childForFieldName("body")
          if (body) this.addTypeMention(body.childForFieldName("rhs") ?? body, ctx)
          break
        }
        case "class_declaration": {
          const nm = n.childForFieldName("name")
          if (nm) { ctx.declaredTypeNames.add(nm.text); ctx.declaredClassNames.add(nm.text) }
          nextOwner = nm?.text ?? nextOwner
          break
        }
        case "generic_declaration": {
          const nm = n.childForFieldName("name")
          if (nm) { ctx.declaredTypeNames.add(nm.text); ctx.declaredClassNames.add(nm.text) }
          nextOwner = nm?.text ?? nextOwner
          break
        }
        case "instance_declaration":
          for (const a of this.fields(n, "argument")) this.addTypeMention(a, ctx)
          break
        case "generic_case_definition": {
          const nm = n.childForFieldName("name")
          if (nm) ctx.declaredFunctions.add(nm.text)
          break
        }
        case "macro_definition": {
          const name = this.normalizeParenthesized(n.childForFieldName("name"))
          if (name) { ctx.declaredFunctions.add(name); ctx.declaredTypeNames.add(name) }
          break
        }
        case "foreign_export": {
          const nm = n.childForFieldName("name")
          if (nm) ctx.declaredFunctions.add(nm.text)
          break
        }
        case "data_constructor": {
          const nm = n.childForFieldName("name")
          if (nm) { ctx.declaredConstructors.add(nm.text); ctx.declaredTypeNames.add(nm.text) }
          break
        }
        case "record_field": {
          const nm = n.childForFieldName("name")
          if (nm) { ctx.declaredFieldNames.add(nm.text); ctx.declaredTypeNames.add(nm.text) }
          const t = n.childForFieldName("type")
          if (t) this.addTypeMention(t, ctx)
          break
        }
        case "special_member": {
          const t = n.childForFieldName("type")
          if (t) this.addTypeMention(t, ctx)
          break
        }
        case "type_signature": {
          const name = this.declarationName(n)
          if (name) {
            ctx.declaredFunctions.add(name)
            const key = declarationKey(frame, owner, name)
            if (!ctx.signatures.has(key)) ctx.signatures.set(key, this.readSignature(n, ctx))
          }
          break
        }
        case "where_block":
        case "with_block":
        case "let_expression": {
          // A local block's binders are scoped to the enclosing FRAME, which is
          // what keeps `f`'s where-local `g` from colliding with a module-level
          // `g`. The binders are the block's own definition children.
          const map = this.localBlockLocals(n, ctx.localScopes, frame)
          if (map && map.size > 0) {
            ctx.localScopes.blockLocals.set(n.id, map)
            if (frameId >= 0) {
              const fm = ctx.localScopes.frameLocals.get(frameId) ?? new Map<string, string>()
              for (const [k, v] of map) fm.set(k, v)
              ctx.localScopes.frameLocals.set(frameId, fm)
            }
          }
          nextOwner = nextFrame
          break
        }
        default:
          break
      }

      // Every callable node is a frame, for the reason the emitting walk makes it
      // one: its binders and its body's attribution are its own.
      const callableName = this.callableDeclaredName(n)
      if (callableName !== undefined) {
        // Every callable name is a call target EXCEPT a type name: a `type_definition`
        // declares a type, and a `::` signature declares a name that may be either, so
        // the signature is admitted and the type declaration is not. That is the exact
        // union of what the two separate passes used to add, and dropping the
        // definition half of it cost 505 `calls` edges to where-locals on the first
        // merged run — the snapshot diff caught it.
        if (n.type !== "type_definition") ctx.declaredFunctions.add(callableName)
        const scoped = nextFrame !== undefined ? `${nextFrame}.${callableName}` : callableName
        ctx.localScopes.callableScoped.set(n.id, scoped)
        nextFrameId = n.id
        nextFrame = scoped
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) visit(c, nextFrameId, nextFrame, nextOwner)
      }
    }
    visit(root, -1, undefined, undefined)
  }

  /** The binders a where/with/let block declares, as name -> scoped identity. */
  private localBlockLocals(block: Node, out: LocalScopes, frameScoped: string | undefined): Map<string, string> | null {
    let map: Map<string, string> | null = null
    const consider = (defNode: Node): void => {
      const nm = this.callableDeclaredName(defNode)
      if (!nm) return
      const scoped = frameScoped !== undefined ? `${frameScoped}.${nm}` : nm
      out.callableScoped.set(defNode.id, scoped)
      if (!map) map = new Map<string, string>()
      map.set(nm, scoped)
    }
    for (let i = 0; i < block.namedChildCount; i++) {
      const c = block.namedChild(i)
      if (!c) continue
      // `record_binding` is the record-pattern member of a where/with block. It
      // sits beside `local_binding` rather than inside it because the grammar
      // keeps the record-pattern reading OUT of a `let`'s bindings (inside a
      // `let`, a brace is a `let_group` instead), so the two arrive as siblings
      // here and both are binders.
      if (c.type === "local_binding" || c.type === "record_binding") {
        const inner = c.namedChild(0)
        if (inner) consider(inner)
        continue
      }
      // `let_group` — `let { (C p) = gtk; q = r } in body` — is ONE node holding
      // a REPEATED `pattern` field, so there is no single namedChild(0) to
      // consider: every pattern in the group binds a name. Reading the field is
      // what keeps the group's values out of it; walking named children would
      // hand the right-hand sides to `callableDeclaredName`, which would treat a
      // value that happens to be a bare identifier as a binder.
      if (c.type === "let_group") {
        for (const pat of this.fields(c, "pattern")) consider(pat)
        continue
      }
      consider(c)
    }
    return map
  }

  /** Read one `type_signature` into a `SignatureInfo`. */
  private readSignature(node: Node, ctx: CleanContext): SignatureInfo {
    const info: SignatureInfo = {
      node,
      paramTypes: [],
      genericVars: new Set(),
      typeRefs: [],
      contextClasses: [],
      specialTypes: [],
      hasCodeBody: false,
    }
    const typeNode = node.childForFieldName("type")
    if (typeNode) this.readFunctionType(typeNode, info, ctx)
    const context = node.childForFieldName("context")
    if (context) this.readClassContext(context, info)
    const special = this.findChild(node, (n) => n.type === "special_block")
    if (special) {
      for (let i = 0; i < special.namedChildCount; i++) {
        const m = special.namedChild(i)
        if (!m || m.type !== "special_member") continue
        const t = m.childForFieldName("type")
        if (t) for (const ref of this.typeRefsIn(t, ctx)) info.specialTypes.push(ref.name)
      }
    }
    if (node.childForFieldName("body")) info.hasCodeBody = true
    // A fixity written ON the signature (`swap infixl 9 :: a a -> a`) rather than
    // as its own `fixity_declaration`. 93 corpus sites, on a `type_signature` 65×
    // and a `class_declaration` 28×, and the grammar exposes it as the `fixity`
    // FIELD — so the two spellings reach one handler and one attachment rule.
    const fixity = node.childForFieldName("fixity")
    if (fixity) {
      info.fixity = {
        associativity: fixity.namedChild(0)?.text,
        precedence: fixity.namedChild(1)?.text,
      }
    }
    return info
  }

  /**
   * `[domain, arrow, result]` from a `type_function`, or a bare type when the
   * signature is not a function type at all (`f :: Int`).
   */
  private readFunctionType(typeNode: Node, info: SignatureInfo, ctx: CleanContext): void {
    if (typeNode.type !== "type_function") {
      info.returnType = typeNode.text
      this.collectTypeRefs(typeNode, info, ctx, new Set())
      return
    }
    const domain = typeNode.child(0)
    const result = typeNode.child(2)
    if (result) {
      info.returnType = result.text
      this.collectTypeRefs(result, info, ctx, new Set())
    }
    if (!domain) return
    if (domain.type === "type_application") {
      for (let i = 0; i < domain.namedChildCount; i++) {
        const arg = domain.namedChild(i)
        if (!arg) continue
        info.paramTypes.push(arg.text)
        this.collectTypeRefs(arg, info, ctx, new Set())
      }
    } else {
      info.paramTypes.push(domain.text)
      this.collectTypeRefs(domain, info, ctx, new Set())
    }
  }

  /**
   * The class names a `|` context constrains on, split at the `,` CHILD nodes.
   * Measured: `class_context` is `|` followed by a flat comma-separated
   * constraint list — `| Enum, Ord, Num a` is ONE node with three named children
   * and two `,` tokens — so the split is a child walk, not a text split.
   *
   * A constraint that names no class publishes nothing and emits no edge: 5 of
   * the 474 contexts in the corpus are `*` (a `uniqueness_star` leaf — the
   * unboxedness constraint `| * , toInt a`), and 469 name a class that does.
   */
  private readClassContext(context: Node, info: SignatureInfo): void {
    let expectName = true
    for (let i = 0; i < context.childCount; i++) {
      const c = context.child(i)
      if (!c) continue
      if (!c.isNamed) {
        if (c.type === ",") expectName = true
        continue
      }
      if (!expectName) continue
      expectName = false
      const name = this.constraintName(c)
      if (name) info.contextClasses.push(name)
    }
  }

  /**
   * The class a single constraint names, or null when it names none. The
   * constraint node is a class name (`constructor` / `identifier`) or an operator
   * class (`operator_compare` for `==`, `operator_add` for `<+>`, …) — 287
   * constructors, 69 identifiers, 32 `operator_compare`, 10 `operator_add`, 2
   * `operator_mul`, 5 unnamed `*`.
   */
  private constraintName(c: Node): string | null {
    if (c.type === "constructor" || c.type === "identifier") return c.text
    if (OPERATOR_LEAF_TYPES.has(c.type)) return c.text
    return null
  }

  /**
   * Every TYPE NAME a type expression mentions, with type variables filtered out.
   * This is Clean's version of the TypeScript lane's `extractDeclaredTypeRefs`
   * (real-typescript-analyzer.ts:3144) and the single largest source of
   * relationships the lane did not have: 9,660 `strict_type` and 3,191
   * `type_application` sites over the corpus, every one of which names at least
   * one type.
   *
   * A `type_variable` is a BINDING, not a reference: `swap :: a a -> a` names no
   * type and binds two. That distinction is what makes `genericParameters`
   * correct and keeps `a` out of the reference graph.
   *
   * A module-qualified type is the one shape that needs context: `M.Map String
   * User` lexes as `constructor M`, `dotted_type .Map`, then the arguments, so
   * `M` is only a qualifier because it is a DECLARED IMPORT ALIAS of this file.
   * That is why `ctx` is in scope here: an alias set is a fact about the file,
   * and a qualifier is read from the alias set, not guessed from the spelling.
   */
  private collectTypeRefs(n: Node, info: SignatureInfo, ctx: CleanContext, bound: Set<string>): void {
    switch (n.type) {
      case "type_variable": {
        const inner = n.namedChild(0)
        if (inner?.text) {
          bound.add(inner.text)
          info.genericVars.add(inner.text)
        }
        return
      }
      case "unique_var_type": {
        // `u:List` — the variable is bound, the type after it is a reference.
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (!c) continue
          if (c.type === "type_variable") {
            const inner = c.namedChild(0)
            if (inner?.text) { bound.add(inner.text); info.genericVars.add(inner.text) }
          } else if (c.startIndex > n.startIndex) {
            this.collectTypeRefs(c, info, ctx, bound)
          }
        }
        return
      }
      case "constructor": {
        // The reference itself. A `type_variable` is the only type-position node
        // that is NOT a reference, and it is handled above.
        this.addTypeRef(info, n.text, n)
        return
      }
      case "single_quoted_name": {
        // A module-QUALIFIED type in signature position: `'Data.Error'.MaybeError`
        // inside `okOr :: !Bool !String -> 'Data.Error'.MaybeError String`. The
        // grammar types it `single_quoted_name` under `strict_type` (24 corpus
        // sites), `type_application` (9) and `type_function` (6), so the
        // expression-position handler never sees it and without this case the
        // reference is lost. The name is the quoted source with its quote
        // characters dropped, the same normalization the call site uses.
        const target = this.qualifiedTarget(n.text)
        if (target) this.addTypeRef(info, target, n)
        return
      }
      case "dotted_type": {
        // `.Int` / `.[!a!]` — Clean's hidden/derived type reference. The named
        // child is the base type; the leading `.` is a marker, not a qualifier
        // (measured: 1,142 `dotted_type` sites, and the 155 that sit inside a
        // `type_application` are ARGUMENTS — preceded by `constructor` 21×,
        // `type_variable` 37×, `strict_type` 8× — not head continuations).
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c) this.collectTypeRefs(c, info, ctx, bound)
        }
        return
      }
      case "type_paren":
      case "strict_type":
      case "uniqueness_type":
      case "list_type":
      case "array_type":
      case "tuple_type":
      case "question_type":
      case "builtin_question_type":
      case "type_application": {
        const head = n.namedChild(0)
        if (head && head.type === "constructor" && ctx.importAliases.has(head.text)) {
          const second = n.namedChild(1)
          if (second) {
            const leafText = second.type === "dotted_type" ? stripLeadingDot(second.text) : second.text
            if (leafText && second.type !== "type_variable") {
              this.addTypeRef(info, `${head.text}.${leafText}`, second)
            }
            for (let i = 2; i < n.namedChildCount; i++) {
              const c = n.namedChild(i)
              if (c) this.collectTypeRefs(c, info, ctx, bound)
            }
            return
          }
        }
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c) this.collectTypeRefs(c, info, ctx, bound)
        }
        return
      }
      default: {
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c) this.collectTypeRefs(c, info, ctx, bound)
        }
        return
      }
    }
  }

  private addTypeRef(info: SignatureInfo, name: string, node: Node): void {
    if (info.typeRefs.some((r) => r.name === name)) return
    info.typeRefs.push({ name, node })
  }

  /**
   * Every bare type name a type expression mentions, with the node that spells
   * it. One reader (`collectTypeRefs`) and one rule, so the field path and the
   * signature path cannot drift — the drift is exactly what FIX B measured.
   */
  private typeRefsIn(typeNode: Node, ctx: CleanContext): TypeRef[] {
    const info: SignatureInfo = {
      node: typeNode,
      paramTypes: [],
      genericVars: new Set(),
      typeRefs: [],
      contextClasses: [],
      specialTypes: [],
      hasCodeBody: false,
    }
    this.collectTypeRefs(typeNode, info, ctx, new Set())
    return info.typeRefs
  }

  /** Every constructor named anywhere inside a type expression. */
  private addTypeMention(n: Node, ctx: CleanContext): void {
    if (n.type === "type_variable") return
    if (n.type === "constructor") {
      ctx.declaredTypeNames.add(n.text)
      return
    }
    if (n.type === "dotted_type") {
      const inner = n.namedChild(0)
      if (inner?.type === "constructor") ctx.declaredTypeNames.add(inner.text)
      return
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) this.addTypeMention(c, ctx)
    }
  }

  /** The declared name of a callable node, or undefined when it declares none. */
  private callableDeclaredName(node: Node): string | undefined {
    // Declined HERE rather than at each caller, because this one function feeds
    // all three consumers that have to agree: symbol emission, the
    // "is this node a frame" test, and local-scope resolution. Guarding a
    // caller instead would let a fabricated `where` still count as a frame and
    // still absorb the scope of everything after it.
    const declared = this.rawCallableDeclaredName(node)
    return isReservedDeclarationName(declared) ? undefined : declared
  }

  private rawCallableDeclaredName(node: Node): string | undefined {
    switch (node.type) {
      case "function_declaration":
        return this.declaredName(node)?.text ?? undefined
      case "operator_definition":
        return this.operatorDefinitionName(node) ?? undefined
      case "generic_case_definition":
        return node.childForFieldName("name")?.text ?? undefined
      case "type_signature":
        return this.declarationName(node) ?? undefined
      case "macro_definition":
        return this.normalizeParenthesized(node.childForFieldName("name")) ?? undefined
      case "type_definition":
        return node.childForFieldName("name")?.text ?? undefined
      default:
        return undefined
    }
  }

  // ============================================================================
  // PASS 2 — declaration handlers
  // ============================================================================

  private enterModule(node: Node, ctx: CleanContext, scopeStack: Scope[]): boolean {
    const nameNode = node.childForFieldName("name")
    const name = nameNode ? this.assembleModuleName(nameNode) : ctx.currentModule
    if (!name) return false
    ctx.currentModule = name
    // `definition module` vs `implementation module` — a Clean module's two
    // halves. The grammar exposes the keyword as the first ANONYMOUS child, so it
    // is read off the child list, never off the node's text.
    let moduleKind = "module"
    const first = node.child(0)
    if (first && !first.isNamed && (first.type === "definition" || first.type === "implementation")) {
      moduleKind = first.type
    }
    ctx.symbols.push({
      name,
      kind: ASTEngine.SymbolKind.Module,
      range: this.nodeToRange(node),
      visibility: "public",
      metadata: { cleanSpecific: true, moduleKind },
    })
    scopeStack.push({ node, name, kind: ASTEngine.SymbolKind.Module })
    return true
  }

  /**
   * A type declaration. The pinned grammar has ONE node type for all six Clean
   * type forms, distinguished by the `type_definition_body.rhs` node type:
   * synonym (`:==`), abstract (no rhs), record (`= {…}`), ADT (`= C | D`),
   * enumerated (`= A | B`) and quantified ADT (`= E a | C !a`). Measured on the
   * 503 `type_definition_body` sites: 255 `data_constructors`, 114
   * `record_definition`, 49 `type_application`, 3 `tuple_type`, 6 `array_type`,
   * 3 `list_type`, 1 `type_paren`, 1 `unit_type` and 71 bare `constructor`
   * (synonym / enumerated).
   */
  private processTypeDefinition(node: Node, ctx: CleanContext, scopeStack: Scope[]): boolean {
    // The name comes from the `name` FIELD. The old version used
    // `findChild(node, n => n.type === "constructor")`, which reads the FIRST
    // constructor child; 5 `type_definition`s carry an `rhs` constructor as a
    // DIRECT child of the type_definition, so on those a first-constructor scan
    // can reach the RIGHT-HAND side. Measured 0 name mismatches over the corpus
    // today, which is exactly why the field was worth taking: the heuristic is
    // correct by luck on this corpus and wrong by construction.
    const nameNode = node.childForFieldName("name")
    if (!nameNode?.text) return false
    const name = nameNode.text
    const currentScope = scopeStack.length > 0 ? scopeStack[scopeStack.length - 1] : undefined
    const body = node.childForFieldName("body")
    const rhs = body ? (body.childForFieldName("rhs") ?? body) : node.childForFieldName("rhs")
    const form = this.typeForm(rhs)

    const genericParameters: string[] = []
    for (const p of this.fields(node, "parameter")) {
      const inner = p.namedChild(0)
      if (inner?.text) genericParameters.push(inner.text)
    }
    // Existential quantifiers (`= E a | C !a`).
    if (body) {
      for (const e of this.fields(body, "existential")) {
        const inner = e.namedChild(0)
        if (inner?.text) genericParameters.push(`!${inner.text}`)
      }
    }

    ctx.symbols.push({
      name,
      kind: ASTEngine.SymbolKind.Type,
      range: this.nodeToRange(node),
      scope: currentScope?.name,
      ownerName: currentScope?.name || ctx.currentModule,
      ownerKind: currentScope?.kind,
      visibility: "public",
      genericParameters: genericParameters.length > 0 ? genericParameters : undefined,
      metadata: { cleanSpecific: true, typeForm: form },
    })
    this.attachComments(ctx.symbols[ctx.symbols.length - 1], node)

    // The RHS types a synonym NAMES. A `data_constructors` rhs (ADT or
    // enumerated) and a `record_definition` rhs are excluded on purpose: their
    // members are `contains` edges and, for a record, each field emits its OWN
    // type reference with the field's identity and line. Emitting the aggregate
    // as well shipped the same fact twice under two different sources.
    if (rhs && rhs.type !== "data_constructors" && rhs.type !== "record_definition") {
      this.emitTypeRefs(rhs, name, "type_alias_rhs", ctx)
    }

    // ADT constructors.
    for (const cNode of this.dataConstructorsOf(rhs)) {
      const cName = cNode.childForFieldName("name")
      if (!cName?.text) continue
      ctx.symbols.push({
        name: cName.text,
        kind: ASTEngine.SymbolKind.Constructor,
        range: this.nodeToRange(cNode),
        scope: name,
        ownerName: name,
        ownerKind: ASTEngine.SymbolKind.Type,
        visibility: "public",
        metadata: { cleanSpecific: true, isADTConstructor: true },
      })
      this.attachComments(ctx.symbols[ctx.symbols.length - 1], cNode)
      // A constructor's argument types are references to the types it stores.
      for (const arg of this.fields(cNode, "argument")) {
        this.emitTypeRefs(arg, cName.text, "data_constructor_arg", ctx)
      }
    }

    // Record fields.
    const recordDef = rhs && rhs.type === "record_definition" ? rhs : body ? this.findChild(body, (n) => n.type === "record_definition") : null
    if (recordDef) {
      for (let i = 0; i < recordDef.namedChildCount; i++) {
        const rf = recordDef.namedChild(i)
        if (!rf || rf.type !== "record_field") continue
        const fieldId = rf.childForFieldName("name")
        if (!fieldId?.text) continue
        ctx.symbols.push({
          name: fieldId.text,
          kind: ASTEngine.SymbolKind.Property,
          range: this.nodeToRange(rf),
          scope: name,
          ownerName: name,
          ownerKind: ASTEngine.SymbolKind.Type,
          visibility: "public",
          metadata: { cleanSpecific: true, isRecordField: true },
        })
        this.attachComments(ctx.symbols[ctx.symbols.length - 1], rf)
        const ft = rf.childForFieldName("type")
        if (ft) this.emitTypeRefs(ft, fieldId.text, "record_field_type", ctx)
      }
    }

    scopeStack.push({ node, name, kind: ASTEngine.SymbolKind.Type })
    return true
  }

  /** The `data_constructor` children of a type's rhs, however it is nested. */
  private dataConstructorsOf(rhs: Node | null): Node[] {
    if (!rhs) return []
    if (rhs.type === "data_constructors") return this.filterChildren(rhs, (n) => n.type === "data_constructor")
    return this.filterChildren(rhs, (n) => n.type === "data_constructor")
  }

  /** Which of Clean's six type forms a `rhs` node type denotes. */
  private typeForm(rhs: Node | null): string {
    if (!rhs) return "abstract"
    switch (rhs.type) {
      case "data_constructors":
        return "adt"
      case "record_definition":
        return "record"
      case "constructor":
        return "enumerated"
      default:
        return "synonym"
    }
  }

  /**
   * A class declaration: `class C a | D a where …`.
   *
   * Two things the old version did not do. (1) It read the name with
   * `findChild(node, n => n.type === "class_name")` instead of the `name` field;
   * the field is exact and the scan is a guess. (2) It published members by
   * scanning `class_member` children for a `type_signature` and then `continue`d
   * on every `type_signature` in the walk — so a class member's `special` block
   * (90 sites) and inline `code` body (74 sites) were never visited, and a class
   * member that is a `function_declaration` rather than a signature published
   * nothing. Members now run through the same handlers as everything else, with
   * the class on the scope stack.
   */
  private processClass(node: Node, ctx: CleanContext, scopeStack: Scope[]): boolean {
    const nameNode = node.childForFieldName("name")
    if (!nameNode?.text) return false
    const name = nameNode.text
    const currentScope = scopeStack.length > 0 ? scopeStack[scopeStack.length - 1] : undefined
    const genericParameters: string[] = []
    for (const p of this.fields(node, "parameter")) {
      const inner = p.namedChild(0)
      if (inner?.text) genericParameters.push(inner.text)
    }
    ctx.symbols.push({
      name,
      kind: ASTEngine.SymbolKind.Interface,
      range: this.nodeToRange(node),
      scope: currentScope?.name,
      ownerName: currentScope?.name || ctx.currentModule,
      ownerKind: currentScope?.kind,
      visibility: "public",
      genericParameters: genericParameters.length > 0 ? genericParameters : undefined,
      metadata: { cleanSpecific: true, isTypeClass: true },
    })
    this.attachComments(ctx.symbols[ctx.symbols.length - 1], node)
    // The superclass context (`class Eq a | Ord a`) — spec gap CL-G3.
    const context = node.childForFieldName("context")
    if (context) this.emitContextRefs(context, name, "class_context", ctx)
    if (node.childForFieldName("type")) ctx.patterns["Algebraic Type Classes"] = true
    ctx.patterns["Type Classes"] = true
    scopeStack.push({ node, name, kind: ASTEngine.SymbolKind.Interface })
    return true
  }

  /**
   * An instance declaration: `instance C T where …`.
   *
   * THE 253-DEFECT. The old handler required a direct `constructor` child to name
   * the target type. Measured over the corpus the `argument` FIELD is 782
   * occurrences on 741 instances, and only 489 are a bare `constructor`; the other
   * 293 are `array_type` 127 (`instance Array {} a`), `list_type` 97
   * (`instance toString [a]`), `type_variable` 32, `type_paren` 16,
   * `question_type` 9, `tuple_type` 8 and `unit_type` 4. On those 253
   * declarations (51 files) the scan found nothing and the instance was skipped
   * whole — no Class symbol, no `implements` edge, no member scope, and every
   * `instance_member` inside it (1,009 members corpus-wide) left ownerless or
   * attributed to the module. The field is exact.
   *
   * Reading the field is not sufficient on its own, though: the argument list is
   * `constraint* Type`, so the TYPE is the LAST argument that names one, and a
   * bare uniqueness constraint names none. Taking the first argument named every
   * constrained instance after its constraint — `instance Array {#} Int` as
   * `{#} -> Array` — which is most of Clean's own StdEnv. See
   * `instanceTargetName`.
   */
  private processInstance(node: Node, ctx: CleanContext, scopeStack: Scope[]): boolean {
    const classNode = node.childForFieldName("name")
    if (!classNode?.text) return false
    const className = classNode.text
    const args = this.fields(node, "argument")
    const typeArgs = args.filter((a) => this.instanceTargetName(a) !== null)
    const targetNames: string[] = []
    for (const a of args) {
      const t = this.instanceTargetName(a)
      if (t) targetNames.push(t)
    }
    const targetType = typeArgs.length > 0 ? this.instanceTargetName(typeArgs[typeArgs.length - 1]) : null
    if (!targetType) return false
    const currentScope = scopeStack.length > 0 ? scopeStack[scopeStack.length - 1] : undefined

    // The universal impl-naming contract: the implementation is named by its
    // TARGET (Rust `impl User`, Elixir `defimpl`, Haskell
    // `instance Mergeable (Stream a)` → class `Stream`). An instance with more
    // than one target type (`instance Array {} a`, `instance C (a, b)`) records
    // the rest in metadata rather than fabricating sibling symbols — they are
    // arguments to ONE implementation, not several.
    //
    // A POLYMORPHIC instance publishes NO symbol. `instance Sized {!} a` is a real
    // instance declaration, but its target is the type VARIABLE `a`, and a symbol
    // named `a` collides head-on with the spec's rule that a type parameter is a
    // BINDING and never a symbol — the same rule that keeps a class's or generic's
    // `parameter` field out of the symbol table, and the one `declaration-forms`
    // pins as `forbidSymbols`. The instance still contributes its `implements` edge
    // below (that is the real dependency) and its class context, so nothing about
    // the declaration is lost; what is withheld is a symbol whose NAME would be a
    // lie. Found by the constrained-instance fixture this round added.
    const targetIsPolymorphic = typeArgs[typeArgs.length - 1]?.type === "type_variable"
    if (!targetIsPolymorphic) {
      ctx.symbols.push({
        name: targetType,
        kind: ASTEngine.SymbolKind.Class,
        range: this.nodeToRange(node),
        scope: currentScope?.name,
        ownerName: currentScope?.name || ctx.currentModule,
        ownerKind: currentScope?.kind,
        visibility: "public",
        metadata: {
          cleanSpecific: true,
          className,
          targetType,
          targetTypes: targetNames,
          isTypeClassInstance: true,
        },
      })
      this.attachComments(ctx.symbols[ctx.symbols.length - 1], node)
    }

    // The implements edge. Site line = the class NAME's line, the name-bearing
    // node for an implements edge (M59 #825 rule, kept from the old handler).
    this.pushRel(
      ctx,
      targetType,
      className,
      ASTEngine.RelationshipType.Implements,
      1.0,
      {
        cleanSpecific: true,
        isInstance: true,
        className,
        // Almost every class is imported (`instance Eq Int` names StdEnv's `Eq`),
        // so the flag records the normal case explicitly instead of leaving the
        // reader to infer it from a missing symbol.
        isExternalClass: !ctx.declaredTypeNames.has(className),
        // The instance's target is a type VARIABLE, so the instance is polymorphic:
        // it publishes no symbol (see above) and this flag says why the edge has no
        // symbol at its source.
        isPolymorphicInstance: targetIsPolymorphic || undefined,
      },
      this.lineOf(classNode),
    )
    // The target types after the first are arguments the class is applied to.
    for (let i = 1; i < args.length; i++) this.emitTypeRefs(args[i], targetType, "instance_target", ctx)

    const context = node.childForFieldName("context")
    if (context) this.emitContextRefs(context, targetType, "instance_context", ctx)
    if (node.childForFieldName("type")) ctx.patterns["Qualified Instances"] = true
    if (node.childForFieldName("body")) ctx.patterns["Inline Machine Code"] = true

    ctx.patterns["Type Classes"] = true
    // The frame's name must be something THIS FILE publishes, or every member
    // `contains` edge carries a source that resolves to nothing. Three cases, in the
    // order they can satisfy it:
    //
    //   1. the instance publishes a symbol, so the frame is that symbol's name;
    //   2. the instance is polymorphic (no symbol) but its CLASS is declared here,
    //      so the class owns the members;
    //   3. neither — the class is imported and the target is a variable
    //      (`instance uSeq [] a` in clean-libraries' Loes, where `uSeq` lives in
    //      StdEnv). Then the members are declared IN THIS FILE and the module is
    //      the nearest owner that exists.
    //
    // Case 3 was found by the honesty gate on the 2,179-file corpus: 25
    // `contains` edges across 3 files read `uSeq -> uCons`, `CollX -> Insert`,
    // `Seq -> Head` and siblings, every source a class declared in another file.
    // Attributing a member to an imported class is a real relationship the store
    // cannot make without cross-file state, and a `contains` edge that resolves to
    // nothing is worse than one that resolves to the file that really contains the
    // member.
    const frameOwner = !targetIsPolymorphic
      ? targetType
      : ctx.declaredClassNames.has(className)
        ? className
        : (ctx.currentModule ?? className)
    scopeStack.push({
      node,
      name: frameOwner,
      kind: ASTEngine.SymbolKind.Class,
    })
    return true
  }

  /**
   * The TYPE an `argument` names, or null when the argument is a bare UNIQUENESS
   * CONSTRAINT rather than a type.
   *
   * Clean's instance head is `instance Class constraint* Type`, and the grammar puts
   * a constraint that applies to the WHOLE instance in the same `argument` field as
   * the type, so the argument list is not all types:
   *
   *   instance Array {!} a         args = [ array_type({!}), type_variable(a) ]
   *   instance Array {#} Int       args = [ array_type({#}), constructor(Int) ]
   *   instance Array {#} {32#.a}  args = [ array_type({#}), array_type({32#.a}) ]
   *   instance == {#Char}          args = [ array_type({#Char}) ]  <- ONE arg, and
   *                                                                    it IS the type
   *
   * Taking the FIRST argument named every constrained instance after its
   * CONSTRAINT: `instance Array {#} Int` became `{#} -> Array`, and
   * `instance Array {32#} Int` became `32 -> Array` (the inner child of `{32#}`).
   * That is the misnamed `implements` edge and instance symbol behind every
   * constrained instance — the shape Clean's own StdEnv uses most, since `Array`
   * alone has six. Taking the LAST argument fixes the head but still returns `32`
   * for `{32#.a}`, because an `array_type` may hold a constraint LEVEL and a TYPE
   * together.
   *
   * So the walk is STRUCTURAL: inside a `type_paren` / `array_type` /
   * `uniqueness_type`, take the first named child that is not a constraint marker.
   * `{!}` and `{#}` have no such child and are therefore constraints (null);
   * `{#Char}` and `{32#.a}` have a `dotted_type` and are therefore types. The
   * earlier version of this comment claimed the same thing via a text test on
   * `{#…}`; the node shape says it outright, so there is no text inspection left.
   */
  private instanceTargetName(arg: Node): string | null {
    switch (arg.type) {
      case "constructor":
      case "type_application":
      case "type_function":
      case "tuple_type":
      case "list_type":
      case "dotted_type":
        return arg.text
      case "type_variable":
        return arg.namedChild(0)?.text ?? arg.text
      case "type_paren":
      case "array_type":
      case "uniqueness_type":
      case "unique_var_type": {
        for (let i = 0; i < arg.namedChildCount; i++) {
          const inner = arg.namedChild(i)
          if (!inner || CONSTRAINT_MARKER_TYPES.has(inner.type)) continue
          const name = this.instanceTargetName(inner)
          if (name) return name
        }
        return null
      }
      default:
        return arg.text
    }
  }

  /**
   * A Clean generic: `generic bimap a b | bimap b a :: .a -> .b`.
   *
   * A generic is a class over TYPES rather than values — Clean's type-level
   * dispatch, the machinery behind the "HACK: dictionaries for all generics"
   * comment in `StdGeneric.dcl`. It is therefore an `Interface` with generic
   * parameters, and the `| bimap b a` context is a requirement on the generic
   * itself, emitted as a `references` edge like any other context. 11
   * declarations corpus-wide.
   */
  private processGenericDeclaration(node: Node, ctx: CleanContext, currentScope: Scope | undefined): void {
    const nameNode = node.childForFieldName("name")
    if (!nameNode?.text) return
    const name = nameNode.text
    const genericParameters: string[] = []
    for (const p of this.fields(node, "parameter")) {
      const inner = p.namedChild(0)
      if (inner?.text) genericParameters.push(inner.text)
    }
    const contextArgs: string[] = []
    for (const p of this.fields(node, "context_arg")) {
      const inner = p.namedChild(0)
      if (inner?.text) contextArgs.push(inner.text)
    }
    const contextName = node.childForFieldName("context")?.text
    ctx.symbols.push({
      name,
      kind: ASTEngine.SymbolKind.Interface,
      range: this.nodeToRange(node),
      scope: currentScope?.name,
      ownerName: currentScope?.name || ctx.currentModule,
      ownerKind: currentScope?.kind,
      visibility: "public",
      genericParameters: genericParameters.length > 0 ? genericParameters : undefined,
      metadata: {
        cleanSpecific: true,
        isGeneric: true,
        genericContext: contextName,
        genericContextArgs: contextArgs,
        genericType: this.unnamedChildOfType(node, "type_function")?.text,
      },
    })
    this.attachComments(ctx.symbols[ctx.symbols.length - 1], node)
    // A self-referential generic context names no other entity, so it emits no
    // edge — a symbol cannot reference itself.
    if (contextName && contextName !== name) {
      this.pushRel(
        ctx,
        name,
        contextName,
        ASTEngine.RelationshipType.References,
        0.95,
        { cleanSpecific: true, relationshipType: "generic_context" },
        this.lineOf(node.childForFieldName("context")),
      )
    }
    ctx.patterns["Generics"] = true
  }

  /**
   * `derive bimap c` — the generic `bimap` is derived for the type `c`.
   *
   * The same shape as an instance: an implementation of a class at a type, so the
   * edge is `implements` from the derived type to the generic, with the generic's
   * own node as the name-bearing site line. 43 sites corpus-wide (all in
   * `StdGeneric.dcl`), and every one published nothing before: the
   * `derive_declaration` node type was named nowhere in the analyzer.
   */
  private processDeriveDeclaration(node: Node, ctx: CleanContext): void {
    const nameNode = node.childForFieldName("name")
    if (!nameNode?.text) return
    const genericName = nameNode.text
    // The derived TYPE is the declaration's other named child: a `type_variable`
    // for `derive bimap c`, a `constructor` for `derive bimap PAIR`, a
    // `parenthesized_operator` for `derive bimap (->)`.
    let target: Node | null = null
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (!c || c.startIndex === nameNode.startIndex) continue
      target = c
      break
    }
    if (!target) return
    // A `type_variable` is `identifier`-wrapped: `derive bimap c` names the
    // variable `c`, and the node's own text is the wrapper's. Every other shape
    // (a `constructor` for `derive bimap PAIR`, a `parenthesized_operator` for
    // `derive bimap (->)`) already spells its name in its own text.
    const targetName = target.type === "type_variable" ? (target.namedChild(0)?.text ?? target.text) : target.text
    if (!targetName) return
    this.pushRel(
      ctx,
      targetName,
      genericName,
      ASTEngine.RelationshipType.Implements,
      1.0,
      { cleanSpecific: true, isDerive: true, genericName },
      this.lineOf(nameNode),
    )
    ctx.patterns["Generics"] = true
  }

  /**
   * A callable definition: `function_declaration`, `operator_definition` or
   * `generic_case_definition`.
   *
   * The old code handled the first two and nothing else.
   * `generic_case_definition` (52 sites) is the third shape Clean uses to define a
   * callable — `bimap{|PAIR|} fx _ fy _ (PAIR x y) = …` — and the six `bimap{|…|}`
   * case equations are ONE function, so they merge into one symbol with the case
   * kinds recorded, exactly as multi-clause definitions merge.
   */
  /**
   * The owner of a `where`/`with`/`let` binder.
   *
   * Normally the enclosing FRAME, which is what makes a local's identity scoped and
   * its `contains` edge resolvable. But a local can be reached with no frame at all
   * when the pinned grammar could not read the function it belongs to: a
   * tuple-destructuring `where` binding — `(transition_nr, transition) =
   * SelectTransition 0 head …` — is not in the grammar, so it becomes an ERROR node
   * and everything after it inside that function sits inside the ERROR subtree,
   * detached from the `function_declaration` that would have opened the frame.
   *
   * Measured on the 2,179-file corpus: 7 such locals — `left` and `right` in
   * `ObjectIO/…/turing/tm.icl`, `key` and `keyIndex` in `Ed/EdKeyMapping.icl`,
   * `toolBoxFun` and `okWindowKeyboardAtt` in `ObjectIO/…/keyboardevent.icl`, and
   * `sp` in `Charlie.icl` — each found by the honesty gate as a symbol carrying an
   * `ownerKind` with no `ownerName`.
   *
   * Falling back to the MODULE is the honest answer rather than a fudge: the binder
   * really is declared in this file, and the module is the nearest owner that
   * EXISTS. A symbol with no owner resolves to nothing, and the file-level count
   * records that the enclosing function was lost to damage instead of pretending
   * the local is module-level by design.
   */
  private localOwner(ctx: CleanContext): string | undefined {
    if (ctx.currentFrame !== undefined) return ctx.currentFrame
    if (ctx.currentModule !== undefined) ctx.detachedLocals++
    return ctx.currentModule
  }

  private processCallableNode(
    node: Node,
    ctx: CleanContext,
    currentScope: Scope | undefined,
    inErrorRegion = false,
  ): FrameSpec | null {
    const name = this.callableDeclaredName(node)
    if (!name) return null
    const isOperator = node.type === "operator_definition" || node.type === "generic_case_definition"
    const isLocal = this.isLocalScope(currentScope)
    const kind = this.callableKind(currentScope, isLocal)
    const key = declarationKey(ctx.currentFrame, this.ownerIdentity(currentScope, ctx), name)
    const existingIdx = ctx.functionSymbolIndex[key]

    if (existingIdx !== undefined) {
      const existing = ctx.symbols[existingIdx]
      // Two different merges land here, and they must not be confused.
      //
      // (1) A DEFINITION supersedes a DECLARATION — a signature and the body
      //     that implements it are one entity, and the entity's extent is its
      //     body, so the start moves to the definition (`preludeOnly` is L8, not
      //     its L7 signature).
      //
      // (2) A SECOND CLAUSE does not supersede a first clause — the clauses are
      //     alternative definitions of one entity, so the start stays at the
      //     clause that BEGINS the function and only the END extends.
      //
      // Replacing the range unconditionally (the first implementation of this
      // rewrite) got (2) wrong, and the M12 differential caught it as a false
      // negative on `isBid`: `isBid Bid = True` / `isBid Ask = False` are two
      // `function_declaration` nodes, and last-write-wins on the keyed map
      // anchored the symbol at the SECOND one — on the line that does not start
      // the function. `isDeclaration` distinguishes the two cases exactly: it is
      // set on a signature-only row and deleted by the first definition.
      const fromDeclaration = existing.metadata?.isDeclaration === true
      if (fromDeclaration || !existing.range) {
        existing.range = this.nodeToRange(node)
      } else {
        const r = this.nodeToRange(node)
        const prevEnd = existing.range.endLine ?? r.startLine
        const prevEndIndex = existing.range.endIndex ?? node.startIndex
        existing.range = {
          ...existing.range,
          endLine: Math.max(prevEnd, r.endLine),
          endColumn: r.endLine > prevEnd ? r.endColumn : (existing.range.endColumn ?? r.endColumn),
          endIndex: Math.max(prevEndIndex, r.endIndex ?? prevEndIndex),
        }
      }
      delete existing.metadata?.isDeclaration
      if (existing.isAbstract) existing.isAbstract = false
      // Comments ACCUMULATE across the declaration and its definition rather than
      // the definition replacing the signature's. A `.dcl` writes the
      // documentation above the SIGNATURE and the definition follows, so a
      // replacing merge dropped it: the first implementation lost `total`'s
      // block comment entirely for exactly that reason. A definition that brings
      // its own leading comment still wins the `docstring`, because that is the
      // one written nearest the definition.
      this.mergeComments(existing, node)
      const md = existing.metadata ?? (existing.metadata = {})
      if (isOperator && !md.isOperatorDefinition) md.isOperatorDefinition = true
      if (node.type === "generic_case_definition") this.addCaseKind(md, node)
      this.joinParameters(existing, node, ctx, this.ownerIdentity(currentScope, ctx))
      return { name, kind, isLocal, key }
    }

    const md: Record<string, any> = { cleanSpecific: true }
    if (isOperator) md.isOperatorDefinition = true
    const scopedName = isLocal ? (ctx.currentFrame === undefined ? name : `${ctx.currentFrame}.${name}`) : undefined
    if (scopedName) {
      md.isLocalDefinition = true
      md.scopedName = scopedName
    }
    if (node.type === "generic_case_definition") this.addCaseKind(md, node)
    const sym: ASTEngine.UniversalSymbol = {
      name,
      kind,
      range: this.nodeToRange(node),
      scope: currentScope?.name,
      // The store's `qualified_name`, which is what relationship endpoints are
      // resolved against. A module-level symbol needs none: its name is already
      // unique in the file, and the store falls back to `name`.
      ...(scopedName ? { qualifiedName: scopedName } : {}),
      ownerName: isLocal ? this.localOwner(ctx) : currentScope?.name || ctx.currentModule,
      ownerKind: isLocal ? ASTEngine.SymbolKind.Function : currentScope?.kind,
      // A callable reached only through an ERROR region has no knowable scope, so it
      // is not part of the module's API and must not claim to be exported.
      visibility: isLocal || inErrorRegion ? "local" : "public",
      complexity: 1,
      metadata: md,
    }
    ctx.symbols.push(sym)
    ctx.functionSymbolIndex[key] = ctx.symbols.length - 1
    this.joinParameters(sym, node, ctx, this.ownerIdentity(currentScope, ctx))
    return { name, kind, isLocal, key }
  }

  private addCaseKind(md: Record<string, any>, node: Node): void {
    const kind = node.childForFieldName("kind")?.text
    if (!kind) return
    const kinds: string[] = md.caseKinds ?? (md.caseKinds = [])
    if (!kinds.includes(kind)) kinds.push(kind)
  }

  /**
   * A module-level macro: `NSWindowCloseButton :== 0`, `(FWI) f i :== fwritei i f`.
   *
   * 583 sites corpus-wide with the analyzer naming `macro_definition` nowhere, so
   * every one published nothing AND every application inside a macro body
   * attributed to whatever frame happened to be open. A macro is a
   * `SymbolKind.Macro` (the kind exists for exactly this: Rust `macro_rules!`) and
   * it is a frame, because a macro body is expanded at its use site and the calls
   * in it are the module's calls.
   */
  private processMacro(node: Node, ctx: CleanContext, currentScope: Scope | undefined): FrameSpec | null {
    const name = this.normalizeParenthesized(node.childForFieldName("name"))
    if (!name) return null
    if (isReservedDeclarationName(name)) return null
    const isLocal = this.isLocalScope(currentScope)
    const key = declarationKey(ctx.currentFrame, this.ownerIdentity(currentScope, ctx), name)
    if (ctx.functionSymbolIndex[key] === undefined) {
      const macroSym: ASTEngine.UniversalSymbol = {
        name,
        kind: ASTEngine.SymbolKind.Macro,
        range: this.nodeToRange(node),
        scope: currentScope?.name,
        ownerName: isLocal ? this.localOwner(ctx) : currentScope?.name || ctx.currentModule,
        ownerKind: isLocal ? ASTEngine.SymbolKind.Function : currentScope?.kind,
        visibility: isLocal ? "local" : "public",
        qualifiedName: isLocal ? (ctx.currentFrame === undefined ? name : `${ctx.currentFrame}.${name}`) : undefined,
        metadata: {
          cleanSpecific: true,
          isMacroDefinition: true,
          isLocalDefinition: isLocal || undefined,
          scopedName: isLocal ? (ctx.currentFrame === undefined ? name : `${ctx.currentFrame}.${name}`) : undefined,
        },
      }
      this.attachComments(macroSym, node)
      ctx.symbols.push(macroSym)
      ctx.functionSymbolIndex[key] = ctx.symbols.length - 1
    }
    ctx.patterns["Macros"] = true
    return { name, kind: ASTEngine.SymbolKind.Macro, isLocal, key }
  }

  /**
   * `foreign export f` — a C function re-exported under Clean's calling
   * convention. 41 sites corpus-wide, published nothing before. It is a real
   * callable and an explicit export, so it is a `Function` symbol flagged
   * `isForeignExport` and it enters the module's export surface.
   */
  private processForeignExport(node: Node, ctx: CleanContext, currentScope: Scope | undefined): void {
    const nameNode = node.childForFieldName("name")
    if (!nameNode?.text) return
    const name = nameNode.text
    ctx.patterns["Foreign Function Interface"] = true
    const line = this.lineOf(node)
    const key = declarationKey(ctx.currentFrame, currentScope?.name, name)
    // A `foreign export f` names the SAME entity as the signature and definition that
    // follow it, so it merges — and the flag rides the merged symbol. But the merge is
    // ORDER-SENSITIVE, and the first implementation was not: it returned early when a
    // symbol of that name already existed, so a `foreign export` appearing AFTER its
    // definition (legal in a `.dcl`, where the interface lists it separately) was
    // dropped whole and the function lost its FFI marker. The FFI SITE is also a
    // per-line fact like every other one the analyzer claims, and it was being lost:
    // the merged symbol is anchored at the definition, three lines below the
    // `foreign export` in the Clyde corpus, with no record that the export existed at
    // all. Both are recorded here.
    const existingIdx = ctx.functionSymbolIndex[key]
    if (existingIdx !== undefined) {
      const existing = ctx.symbols[existingIdx]
      const md = existing.metadata ?? (existing.metadata = {})
      md.isForeignExport = true
      if (typeof md.foreignExportLine !== "number") md.foreignExportLine = line
      return
    }
    ctx.symbols.push({
      name,
      kind: ASTEngine.SymbolKind.Function,
      range: this.nodeToRange(node),
      scope: currentScope?.name,
      ownerName: currentScope?.name || ctx.currentModule,
      ownerKind: currentScope?.kind,
      visibility: "public",
      metadata: { cleanSpecific: true, isForeignExport: true, foreignExportLine: line, isDeclaration: true },
    })
    this.attachComments(ctx.symbols[ctx.symbols.length - 1], node)
    ctx.functionSymbolIndex[key] = ctx.symbols.length - 1
  }

  /**
   * `($) infixr 9` — an operator fixity declaration. 17 sites corpus-wide,
   * published nothing before. A fixity names an OPERATOR that is declared
   * elsewhere (usually a macro or an `operator_definition`), so it emits no symbol
   * of its own: the fixity is attached to that operator's symbol by
   * `attachFixities`, and the record is kept on the file so a fixity on an
   * operator this file does not define stays visible instead of being dropped.
   */
  private processFixityDeclaration(node: Node, ctx: CleanContext): void {
    const opNode = node.childForFieldName("operator")
    if (!opNode) return
    const name = this.normalizeParenthesized(opNode)
    if (!name) return
    ctx.patterns["Operator Fixity Declarations"] = true
    ctx.fixities.push({
      name,
      associativity: node.childForFieldName("associativity")?.text,
      precedence: node.childForFieldName("precedence")?.text,
      line: this.lineOf(node),
    })
  }

  /** Apply the collected fixities to the operator symbols they name. */
  private attachFixities(ctx: CleanContext): void {
    if (ctx.fixities.length === 0) return
    for (const f of ctx.fixities) {
      for (const s of ctx.symbols) {
        if (s.name !== f.name) continue
        s.metadata = s.metadata ?? {}
        s.metadata.fixity = { associativity: f.associativity, precedence: f.precedence }
      }
    }
  }

  /**
   * Evidence tiers on EVERY relationship, and the lane's own provenance bit.
   *
   * M14 section D requires at least two distinct `evidenceClass` values pinned by
   * fixtures, and the family vocabulary is fixed: `structural`,
   * `usage_contextual`, `import_based`, `reference_qualified`, `inferred` (the
   * typescript and haskell classifiers are the precedents). Clean uses only those
   * five, so the values mean what they mean in every other lane.
   *
   * | kind | tier | why |
   * | --- | --- | --- |
   * | `contains`, `exports` | `structural` | both endpoints are names this file publishes, and the store's own resolution proves it |
   * | `imports` | `import_based` | the source spells the module and the item |
   * | `instantiates`, `uses` | `structural` | in-file by construction — the target must be a `data_constructor`, record field or local this file declares, or no edge is emitted |
   * | `implements` | `structural` in-file, `reference_qualified` external | an `instance C T` is a structural fact when `C` is declared here; when `C` is imported the edge names a class by reference, which is 322 of 782 corpus sites |
   * | `references` | `reference_qualified` | the family rule: a type reference names its type |
   * | `calls` | `usage_contextual`, or `reference_qualified` for a source-spelled qualified target | a call is usage evidence; a call to `'Data.Error'.Ok` or `M.lookup` is identified by the spelling in the source, not by a same-file binding |
   *
   * `evidenceClass` answers "how do we know this edge"; it cannot answer "could
   * this file have known the target at all", which is Clean's actual signature
   * property and the one the honesty gate measures. So `targetIsInFile` is
   * emitted alongside: `true` when the target resolves to a name this file
   * publishes (bare, `Owner.member`, or the leaf after the first `.` — the
   * store's own three strategies), `false` when the target is external by nature.
   * 7,777 of 9,568 corpus `references` and 322 of 782 `implements` are `false`,
   * and a consumer that wants only provable edges can now say so without
   * re-deriving it.
   */
  private classifyEvidenceTier(ctx: CleanContext): void {
    const names = new Set<string>(ctx.symbols.map((s) => s.name))
    const qNames = new Set<string>(ctx.symbols.map((s) => s.qualifiedName).filter(Boolean) as string[])
    const resolves = (name: string): boolean => {
      if (names.has(name) || qNames.has(name)) return true
      const dot = name.indexOf(".")
      return dot > 0 && (names.has(name.slice(dot + 1)) || qNames.has(name.slice(dot + 1)))
    }
    for (const r of ctx.relationships) {
      const md = r.metadata ?? (r.metadata = {})
      const t = String(r.type)
      const target = String(r.target)
      md.targetIsInFile = resolves(target)
      if (md.evidenceClass) continue
      switch (t) {
        case "contains":
        case "exports":
        case "instantiates":
        case "uses":
          md.evidenceClass = "structural"
          continue
        case "imports":
          md.evidenceClass = "import_based"
          continue
        case "references":
          md.evidenceClass = "reference_qualified"
          continue
        case "implements":
          md.evidenceClass = md.targetIsInFile ? "structural" : "reference_qualified"
          continue
        default:
          // `calls` and anything a later ruling adds. A qualified or quoted target
          // is identified by its SPELLING, which is the reference_qualified claim;
          // a bare in-file name is a usage of a known binding.
          // `includes`, not a regex: the single-quoted qualified form is `'Data.Error'.Ok`,
          // so a quote character in the target is the marker. A `/'/.test(target)` was
          // here first and it was the analyzer's ONLY regex literal — which is exactly
          // the kind of thing the zero-regex claim exists to prevent, and it is why the
          // claim is checked by the TypeScript scanner on every run rather than trusted.
          md.evidenceClass = target.includes(".") || target.includes("'") ? "reference_qualified" : "usage_contextual"
      }
    }
  }

  /**
   * A `type_signature` — Clean's declaration form, and where a function's
   * parameter types, result type, generic parameters, class context, special
   * types and inline code body all live. 3,611 of them published only a bare
   * Function symbol with no types at all before.
   *
   * The old handler published a symbol ONLY at module scope
   * (`scopeStack.length === 0`) and then `continue`d, which meant a class member's
   * signature got its Method from a separate scan inside `processClass`, an
   * instance member's signature published nothing at all (only its
   * `function_declaration` / `operator_definition` sibling did), and a where-local
   * signature was discarded. All three publish through this one handler now.
   */
  private processTypeSignature(node: Node, ctx: CleanContext, currentScope: Scope | undefined, inErrorRegion = false): void {
    const name = this.declarationName(node)
    if (!name) return
    const isLocal = this.isLocalScope(currentScope)
    const isMember =
      currentScope?.kind === ASTEngine.SymbolKind.Interface || currentScope?.kind === ASTEngine.SymbolKind.Class
    const key = declarationKey(ctx.currentFrame, this.ownerIdentity(currentScope, ctx), name)
    const info = ctx.signatures.get(key)
    const existingIdx = ctx.functionSymbolIndex[key]
    if (existingIdx !== undefined) {
      // A repeated signature is ONE entity: the first occurrence wins and the
      // second's type information is merged in, so a `.dcl` that declares `f :: T`
      // twice does not publish two symbols.
      if (info) this.applySignature(ctx.symbols[existingIdx], info, ctx, isLocal)
      return
    }
    const kind = this.callableKind(currentScope, isLocal)
    const sym: ASTEngine.UniversalSymbol = {
      name,
      kind,
      range: this.nodeToRange(node),
      scope: currentScope?.name,
      ...(isLocal ? { qualifiedName: ctx.currentFrame === undefined ? name : `${ctx.currentFrame}.${name}` } : {}),
      ownerName: isLocal ? this.localOwner(ctx) : currentScope?.name || ctx.currentModule,
      ownerKind: isLocal ? ASTEngine.SymbolKind.Function : currentScope?.kind,
      // A callable reached only through an ERROR region has no knowable scope, so it
      // is not part of the module's API and must not claim to be exported.
      visibility: isLocal || inErrorRegion ? "local" : "public",
      // A member whose only occurrence is a signature is an ABSTRACT member: the
      // class declares it and no instance in this file defines it.
      isAbstract: isMember ? true : undefined,
      metadata: {
        cleanSpecific: true,
        isDeclaration: true,
        isLocalDeclaration: isLocal || undefined,
      },
    }
    this.attachComments(sym, node)
    ctx.symbols.push(sym)
    ctx.functionSymbolIndex[key] = ctx.symbols.length - 1
    if (info) this.applySignature(sym, info, ctx, isLocal)
  }

  /** Copy a `SignatureInfo` onto the symbol it declares, and emit its edges. */
  private applySignature(sym: ASTEngine.UniversalSymbol, info: SignatureInfo, ctx: CleanContext, isLocal: boolean): void {
    const md = sym.metadata ?? (sym.metadata = {})
    if (info.returnType && !sym.returnType) sym.returnType = info.returnType
    if (info.genericVars.size > 0) {
      const existing = sym.genericParameters ?? []
      for (const g of info.genericVars) if (!existing.includes(g)) existing.push(g)
      sym.genericParameters = existing
    }
    if (md.typeSignature === undefined) md.typeSignature = info.node.text
    if (info.specialTypes.length > 0) {
      md.specialTypes = info.specialTypes
      ctx.patterns["Specialised Members"] = true
    }
    if (info.hasCodeBody) {
      md.hasInlineCodeBody = true
      ctx.patterns["Inline Machine Code"] = true
    }
    if (info.fixity) {
      md.fixity = info.fixity
      ctx.patterns["Operator Fixity Declarations"] = true
      // The record is also kept on the file so `fixity_declaration`'s pass can see
      // it: a fixity named on a signature and one written as its own declaration
      // must be able to collide, and they reach the attachment through one list.
      ctx.fixities.push({ name: sym.name, ...info.fixity, line: this.lineOf(info.node) })
    }
    // The edge source is the symbol's own identity: the scoped name for a local,
    // the bare name otherwise, so a local's edges can never land on a
    // module-level symbol of the same name.
    const source = isLocal ? (md.scopedName ?? sym.name) : sym.name
    if (info.contextClasses.length > 0) {
      md.classContext = info.contextClasses
      ctx.patterns["Class Contexts"] = true
      const line = this.lineOf(info.node.childForFieldName("context"))
      for (const c of info.contextClasses) {
        this.pushRel(ctx, source, c, ASTEngine.RelationshipType.References, 0.95, {
          cleanSpecific: true,
          relationshipType: "class_context",
        }, line)
      }
    }
    for (const ref of info.typeRefs) {
      this.pushRel(ctx, source, ref.name, ASTEngine.RelationshipType.References, 0.95, {
        cleanSpecific: true,
        relationshipType: "declared_type",
      }, this.lineOf(ref.node))
    }
    // Parameter types wait in metadata when the symbol has no definition yet
    // (no names to pair with); `joinParameters` pairs them when one arrives.
    md.paramTypes = info.paramTypes
  }

  /**
   * The `special` block of a signature: `special a=Int; a=Char`.
   *
   * 104 blocks / 507 members corpus-wide, published nothing before. A `special`
   * member does not declare a new NAME — the variable is the enclosing
   * declaration's own type parameter (`_from :: a -> .[a] | Enum, Ord a` with
   * `special a=Int` specialises `_from`) — so it publishes no symbol. What it does
   * declare is a set of TYPES the enclosing callable is specialised for, and
   * those are real `references` edges.
   */
  private processSpecialBlock(node: Node, ctx: CleanContext): void {
    const owner = this.relationshipSource(ctx) ?? this.enclosingDeclarationName(node)
    if (!owner) return
    ctx.patterns["Specialised Members"] = true
    for (let i = 0; i < node.namedChildCount; i++) {
      const m = node.namedChild(i)
      if (!m || m.type !== "special_member") continue
      const t = m.childForFieldName("type")
      if (!t) continue
      for (const ref of this.typeRefsIn(t, ctx)) {
        this.pushRel(ctx, owner, ref.name, ASTEngine.RelationshipType.References, 0.95, {
          cleanSpecific: true,
          relationshipType: "special_type",
        }, this.lineOf(ref.node))
      }
    }
  }

  /**
   * Join a `type_signature`'s parameter TYPES to the definition's parameter NAMES.
   *
   * This is the join that makes Clean parameter data real. A Clean signature
   * `comp3 :: !(.a -> .b) u:(.c -> .a) !(.d -> .c) -> u:(.d -> .b)` yields three
   * domain types; the definition `comp3 f g h` yields three names; pairing them
   * positionally is sound because a Clean function type's domain is a
   * left-nested `type_application` whose children are in parameter order, and a
   * definition's `pattern` fields are its parameters in order — including the
   * multi-guard shape `f x # g y = …`, where the guard equations share the
   * parameter list and the patterns are collected across all of them, first
   * occurrence winning.
   */
  private joinParameters(
    sym: ASTEngine.UniversalSymbol,
    defNode: Node,
    ctx: CleanContext,
    owner: string | undefined,
  ): void {
    // A multi-clause function RE-STATES its parameter list in every clause
    // (`headOrZero [x: _] = x` then `headOrZero [] = 0`), and each clause is its
    // own `function_declaration` node. The FIRST clause wins, for the same reason
    // the first clause's range and name win: they are one entity and the clauses
    // are alternative definitions of it. Re-deriving per clause appended a
    // parameter per clause, so a two-clause one-argument function published two.
    if (sym.parameters && sym.parameters.length > 0) return
    const key = declarationKey(ctx.currentFrame, owner, sym.name)
    const info = ctx.signatures.get(key)
    if (!info) return
    const params: ASTEngine.Parameter[] = []
    let i = 0
    for (const p of this.fields(defNode, "pattern")) {
      const name = this.patternParameterName(p)
      params.push({ name, type: info.paramTypes[i], isOptional: name === OPTIONAL_PARAM_NAME })
      i++
    }
    if (params.length > 0) sym.parameters = params
  }

  /**
   * The NAME a parameter pattern binds, or the placeholder for a pattern that
   * binds none.
   *
   * ONE `pattern` field is ONE parameter. That is the rule, and the first
   * implementation got it wrong in a way the fixture caught: it collected the
   * names bound INSIDE each pattern, so `addBid (Book bids asks) price` produced
   * three parameters (`bids`, `asks`, `price`) while the signature
   * `OrderBook Int -> OrderBook` has two domain types — a tuple pattern is one
   * parameter of a tuple type, not three parameters.
   *
   * A pattern that names its target (`identifier`, or `strict_binding_pattern`'s
   * `p=:t` left side) yields that name. A destructuring pattern
   * (`constructor_pattern`, `list_pattern`, `tuple_pattern`, `record_pattern`,
   * `unboxed_pattern`, `cons_pattern`, `wildcard`, `record_update_pattern`)
   * binds no single target, so the parameter is anonymous and is named by the
   * constant below rather than by inventing a name: the store keys a parameter by
   * name, so a fabricated one would collide across overloads, while a reserved
   * placeholder cannot.
   */
  private patternParameterName(pat: Node): string {
    switch (pat.type) {
      case "identifier":
        return pat.text
      case "strict_binding_pattern": {
        const first = pat.namedChild(0)
        if (first?.type === "identifier") return first.text
        return this.condensePattern(pat)
      }
      case "strict_pattern": {
        // `!hd` inside a list/tuple/cons pattern (Clyde/Clyde/Link.icl:264 spells
        // it `!hd` inside `[!hd, !h]`). The `!` is a strictness marker and the
        // identifier under it is the bound name.
        const first = pat.namedChild(0)
        return first?.type === "identifier" ? first.text : this.condensePattern(pat)
      }
      case "wildcard":
        return OPTIONAL_PARAM_NAME
      default:
        return this.condensePattern(pat)
    }
  }

  /**
   * A destructuring pattern as a one-line name. The pattern's own text is the
   * name the source gives that parameter slot, so it is used verbatim; only
   * NEWLINES and RUNS OF SPACES are folded, because a name that carries a
   * newline is not a name. Folding is a character operation (indexOf/slice over
   * the two whitespace characters), not a pattern match.
   */
  private condensePattern(pat: Node): string {
    const raw = pat.text
    let out = ""
    let pendingSpace = false
    for (let i = 0; i < raw.length; i++) {
      const code = raw.charCodeAt(i)
      const isSpace = code === 32 || code === 9 || code === 10 || code === 13
      if (isSpace) {
        pendingSpace = out.length > 0
        continue
      }
      if (pendingSpace) {
        out += " "
        pendingSpace = false
      }
      out += raw[i]
    }
    return out || OPTIONAL_PARAM_NAME
  }

  // ============================================================================
  // PASS 2 — expression-level extraction
  // ============================================================================

  /**
   * An application: the lane's call / instantiation / qualified-call surface.
   *
   * The pinned grammar makes an application LEFT-NESTED: `f a b c` is
   * `application(application(application(f, a), b), c)`, so only the INNERMOST
   * application carries the callee. Measured over 23,908 applications, the
   * `function` field is 13,102 `application` (the nest), 8,340 `identifier`, 2,045
   * `constructor`, 162 `field_access`, 78 `single_quoted_name`, 61
   * `unboxed_expression`, 25 `parenthesized_operator`, 25 `number`, 22 `string`,
   * 20 `paren_expression`, 14 `index_access`, and 15 across five more shapes. The
   * old handler recognised only `identifier` and `constructor` (plus the corpus-dead
   * `qualified_identifier`), so the 265 `field_access` / `single_quoted_name` /
   * `parenthesized_operator` heads produced no edge at all.
   */
  private extractApplication(node: Node, ctx: CleanContext, scopeStack: Scope[]): void {
    const head = node.childForFieldName("function")
    if (!head) return
    const owner = this.relationshipSource(ctx)
    if (!owner) return

    switch (head.type) {
      case "identifier": {
        const target = this.resolveCallableTarget(head.text, scopeStack, ctx)
        if (!target) return
        this.pushRel(ctx, owner, target, ASTEngine.RelationshipType.Calls, 0.9, {
          cleanSpecific: true,
          context: "local function call",
        }, this.lineOf(head))
        return
      }
      case "constructor": {
        // A constructor application in BODY position instantiates; one in
        // PATTERN position is a match, and is emitted as `uses` by
        // `extractConstructorPattern`.
        if (this.isPatternPosition(node)) return
        const name = head.text
        if (ctx.declaredConstructors.has(name)) {
          this.pushRel(ctx, owner, name, ASTEngine.RelationshipType.Instantiates, 1.0, {
            cleanSpecific: true,
            isConstructorApplication: true,
            // A `data_constructor` node in THIS file proves the target is a data
            // constructor, so this edge carries no inference at all.
            isExternalTarget: false,
          }, this.lineOf(head))
          return
        }
        // Clean allows an uppercase FUNCTION, and the grammar types it
        // `constructor` exactly as it types a data constructor. When this file
        // declares the name as a callable it IS a call, not a construction —
        // 939 corpus sites were mislabelled before this branch existed.
        if (ctx.declaredFunctions.has(name)) {
          const target = this.resolveCallableTarget(name, scopeStack, ctx)
          if (target) {
            this.pushRel(ctx, owner, target, ASTEngine.RelationshipType.Calls, 0.9, {
              cleanSpecific: true,
              context: "uppercase function application",
            }, this.lineOf(head))
          }
          return
        }
        // A CLASS applied to arguments is a call of its class method: Clean's
        // implicit dictionary passing makes `C x` the class method of `C` at `x`.
        // 77 sites on Clyde/Cocoa/layout.icl alone, all previously `instantiates`.
        if (ctx.declaredClassNames.has(name)) {
          this.pushRel(ctx, owner, name, ASTEngine.RelationshipType.Calls, 0.9, {
            cleanSpecific: true,
            context: "class method application",
            isClassMethodCall: true,
          }, this.lineOf(head))
          return
        }
        // A TYPE this file declares. `(User "x")` where `:: User = { … }` is
        // Clean's COERCION — the grammar types `type_definition.name` as a
        // `constructor` node, so this falls through every branch above.
        //
        // It emitted nothing before this branch and STILL emits nothing: the
        // discipline below already declines it. What the branch changes is the
        // ACCOUNTING, and that matters because `declinedInstantiations` is a
        // published honesty figure. Without it, 65 sites where the analyzer KNOWS
        // what the construct is were reported inside a count whose meaning is "a
        // name this file cannot classify" — so the number overstated the
        // uncertainty. With it, 65 read as known coercions and 984 as genuinely
        // unclassifiable, which is the truth.
        //
        // (An earlier draft of this comment claimed the branch prevented a
        // fabricated `calls` edge to a type. That was wrong: no such edge was ever
        // emitted, because the fall-through declined it. The `X :== expr` case that
        // looked like the counter-example is a MACRO — `X :== toInt` parses as a
        // `macro_definition` — and a macro application is a real call, which is why
        // it is handled by the `declaredFunctions` branch above and why the
        // differential lists it as cause I rather than a coercion.)
        if (ctx.declaredTypeDefNames.has(name)) {
          ctx.typeCoercions.count++
          if (ctx.typeCoercions.names.length < 25 && !ctx.typeCoercions.names.includes(name)) {
            ctx.typeCoercions.names.push(name)
          }
          return
        }
        // Declared NEITHER way: an imported uppercase name, and this file cannot
        // say what it is.
        //
        // The first implementation of this branch guessed "data constructor",
        // flagged the guess, and the flag measured how bad the guess was. A
        // corpus-wide index of declared data constructors, functions, macros,
        // types and classes (`script/m14/clean-external-precision.mts`) read the
        // 1,026 flagged edges against it:
        //
        //     target IS a declared data constructor   198   19.30%
        //     target is declared as a FUNCTION        425
        //     target is declared as a MACRO           205
        //     target is declared as a TYPE            129
        //     target is declared as a CLASS             4
        //     target is declared NOWHERE in the corpus 167
        //
        // A lower bound on the constructor reading — StdEnv is only partly in the
        // corpus, so real constructors like `Ok` read as undeclared — but 80.7% of
        // these edges are, on the corpus's own evidence, something else.
        //
        // So the branch emits NOTHING. This is the discipline the lane has always
        // applied to a `calls` head it cannot resolve, applied to `instantiates`
        // as well, and it is what makes the ontology provable: every remaining
        // `instantiates` edge is a construction this file's own `data_constructor`
        // node proves. The visible cost — 1,026 edges on this corpus — is the
        // price of a graph a reader can trust, and it is the same price the lane
        // has always paid on `calls`.
        //
        // The site is COUNTED so the cost is visible in this analyzer's own
        // output. A divergence that can only be seen by re-running a side
        // instrument is a divergence that goes unnoticed.
        ctx.declinedInstantiations.count++
        if (ctx.declinedInstantiations.names.length < 25 && !ctx.declinedInstantiations.names.includes(name)) {
          ctx.declinedInstantiations.names.push(name)
        }
        return
      }
      case "single_quoted_name":
      case "qualified_identifier": {
        // The qualified forms: `'Data.Map'.get` (the corpus form, 233 sites) and
        // `M.lookup` (the alias form, 2 sites, both in this repo's fixtures). The
        // target is the fully-qualified name the source spells, with the
        // leading quote removed so the name is the one a symbol would carry.
        const target = head.type === "single_quoted_name" ? this.qualifiedTarget(head.text) : head.text
        if (!target) return
        this.pushRel(ctx, owner, target, ASTEngine.RelationshipType.Calls, 0.9, {
          cleanSpecific: true,
          isQualifiedCall: true,
          qualifier: this.qualifierOf(head.text),
        }, this.lineOf(head))
        // `qualified_calls` is a declared store column (brain.sql.ts) holding the
        // raw qualified call strings as the source spells them. The edge above
        // carries the same fact for the graph; this is the symbol-level index
        // product search reads.
        if (ctx.currentFrame) {
          const idx = ctx.frameSymbolIndex.get(ctx.currentFrame)
          const sym = idx === undefined ? undefined : ctx.symbols[idx]
          if (sym) {
            const list = sym.qualified_calls ?? (sym.qualified_calls = [])
            if (!list.includes(target)) list.push(target)
          }
        }
        return
      }
      case "field_access": {
        // `obj.method x` — a method call on a record value. The METHOD name is the
        // field, and reading a field is a real dependency, so this emits the same
        // `uses` edge `extractFieldAccess` does. No `calls` edge is invented: the
        // receiver's type is not resolvable inside one file, so naming a callee
        // here would be a guess.
        this.emitFieldUse(head, ctx, "method_call")
        return
      }
      case "parenthesized_operator": {
        // `(++) a b` — a prefix use of an infix-capable operator. Resolved
        // against the declared names like any other callee, so a prefix operator
        // that no declaration in this file names emits nothing.
        const name = this.unparenthesize(head.text)
        if (!name) return
        if (ctx.declaredFunctions.has(name) || ctx.declaredTypeNames.has(name)) {
          this.pushRel(ctx, owner, name, ASTEngine.RelationshipType.Calls, 0.9, {
            cleanSpecific: true,
            context: "prefix operator application",
          }, this.lineOf(head))
        }
        return
      }
      default:
        // `unboxed_expression` (`?Just a` — a boxed/unboxed tagged build),
        // `number` / `string` / `char` (a foreign-function-interface tag in
        // callee position: `42 world`, `"\n" file`), `index_access`
        // (`status.[0] bitand`), `record_update`, `paren_expression`,
        // `list_expression`, `tuple_expression`, `lambda_expression`,
        // `list_comprehension`, `array_comprehension` — none of these names a
        // callable. They are the grammar lifting a tag or an infix operator into
        // the function field; classified in the spec (F8) rather than guessed at.
        return
    }
  }

  /**
   * `obj.field` — a record field read. 1,129 sites corpus-wide, published nothing
   * before. The `field` field carries the field NAME (1,058 `identifier`, 55
   * `constructor` — a field may be uppercase, as in `d.Diagnostic.severity` — and
   * 16 `single_quoted_name`).
   *
   * Emitted only when the name is a record field THIS FILE declares (the
   * FP-family rule, applied to property access as to calls): the receiver's type
   * is not resolvable inside one file, so an unguarded edge to a name that may be
   * a local variable would be a fabrication. `uses` is the type — a field read is
   * a use of the field, not a call of it.
   */
  private emitFieldUse(access: Node, ctx: CleanContext, label: string): void {
    const owner = this.relationshipSource(ctx)
    if (!owner) return
    const field = access.childForFieldName("field")
    if (!field) return
    const name = field.text
    if (!ctx.declaredFieldNames.has(name)) return
    this.pushRel(ctx, owner, name, ASTEngine.RelationshipType.Uses, 0.9, {
      cleanSpecific: true,
      relationshipType: label,
      isRecordField: true,
    }, this.lineOf(field))
  }

  /**
   * `{base & f = v, g = w}` — a record update. 469 sites, 793 `update_field`s.
   *
   * The `field` field points at an `update_field` and the `value` fields
   * interleave with it, so the field NAMES are read from the `update_field`
   * children (`field → identifier`) rather than by zipping two parallel field
   * lists. Measured: field count equals value count on all 469 (`f1v1` 288,
   * `f2v2` 90, `f3v3` 66, `f4v4` 14, `f5v5` 7, `f6v6` 2, `f11v11` 1,
   * `f12v12` 1), so a positional zip would work today, but the names are on the
   * nodes and reading them there is the construction that cannot break.
   */
  private extractRecordUpdate(node: Node, ctx: CleanContext): void {
    const owner = this.relationshipSource(ctx)
    if (!owner) return
    for (const f of this.fields(node, "field")) {
      const inner = f.childForFieldName("field") ?? f.namedChild(0)
      if (!inner) continue
      const name = inner.text
      if (!ctx.declaredFieldNames.has(name)) continue
      this.pushRel(ctx, owner, name, ASTEngine.RelationshipType.Uses, 0.9, {
        cleanSpecific: true,
        relationshipType: "record_field_update",
        isRecordField: true,
      }, this.lineOf(inner))
    }
  }

  /**
   * `{a = 1, b = 2}` — a record CONSTRUCTION. 399 sites, published nothing before.
   * Every field the literal sets is a `uses` of that field.
   */
  private extractRecordExpression(node: Node, ctx: CleanContext): void {
    const owner = this.relationshipSource(ctx)
    if (!owner) return
    for (const n of this.fields(node, "name")) {
      const name = n.text
      if (!ctx.declaredFieldNames.has(name)) continue
      this.pushRel(ctx, owner, name, ASTEngine.RelationshipType.Uses, 0.9, {
        cleanSpecific: true,
        relationshipType: "record_construction",
        isRecordField: true,
      }, this.lineOf(n))
    }
  }

  /**
   * `Just x` in PATTERN position — a match on a data constructor. 1,240 sites,
   * published nothing before.
   *
   * This is deliberately NOT an `instantiates`: `case x of Just y -> …` does not
   * build a `Just`, it depends on one. `uses` is the type, guarded by the same
   * in-file declaration rule as every other edge, and labelled so the graph can
   * tell a match from a read or a write.
   */
  private extractConstructorPattern(node: Node, ctx: CleanContext): void {
    const owner = this.relationshipSource(ctx)
    if (!owner) return
    for (const c of this.fields(node, "constructor")) {
      if (c.type !== "constructor") continue
      if (!ctx.declaredConstructors.has(c.text)) continue
      this.pushRel(ctx, owner, c.text, ASTEngine.RelationshipType.Uses, 0.9, {
        cleanSpecific: true,
        relationshipType: "pattern_match",
        isPatternMatch: true,
      }, this.lineOf(c))
    }
  }

  /**
   * Resolve a bare callee name to a target: the innermost visible LOCAL wins
   * (Clean scoping — a where-binder shadows the module binding for the whole RHS
   * of its callable), else the module-level declared set, else no edge.
   *
   * The walk order makes the local win correct without a second rule: a
   * `where_block` pushes its `locals` before the walk descends into the
   * definitions' bodies, and pops on exit, so an application in a guard equation
   * resolves against the block that encloses it.
   */
  private resolveCallableTarget(name: string, scopeStack: Scope[], ctx: CleanContext): string | undefined {
    for (let i = scopeStack.length - 1; i >= 0; i--) {
      const locals = scopeStack[i].locals
      if (locals === undefined) continue
      const hit = locals.get(name)
      if (hit !== undefined) return hit
    }
    return ctx.declaredFunctions.has(name) ? name : undefined
  }

  /**
   * The symbol an expression-level edge is attributed to: the innermost open
   * frame's scoped identity, or the module when no frame is open. An application
   * outside any callable (a module-level initialiser) is attributed to the
   * module, which is where its symbol lives.
   */
  private relationshipSource(ctx: CleanContext): string | undefined {
    return ctx.currentFrame ?? ctx.currentModule
  }

  /** The name of the nearest enclosing declaration, for a non-frame position. */
  private enclosingDeclarationName(node: Node): string | undefined {
    let p: Node | null = node.parent
    while (p) {
      if (CALLABLE_NODE_TYPES.has(p.type)) return this.callableDeclaredName(p)
      if (p.type === "class_declaration" || p.type === "instance_declaration" || p.type === "type_definition" || p.type === "generic_declaration") {
        return p.childForFieldName("name")?.text
      }
      p = p.parent
    }
    return undefined
  }

  /**
   * `'Data.Map'.get` → `Data.Map.get`.
   *
   * The quote in a Clean qualified name wraps the MODULE, not the whole name:
   * the corpus form is `'Data.Error'.Ok` — `'Data.Error'` quoted, `.Ok` not — and
   * the alias form is `M.lookup`, unquoted. The first implementation of this
   * function assumed a fully-quoted name (remove one leading `'`, require one
   * trailing `'`), so it returned null for every real corpus site: measured, the
   * 78 `single_quoted_name` application heads in the corpus produced ZERO
   * qualified `calls` edges while the branch looked live.
   *
   * The normalization is therefore "drop the quote characters", which is a
   * character filter, and a result with no characters left is not a name.
   */
  private qualifiedTarget(text: string): string | null {
    if (!text.startsWith("'")) return text || null
    let out = ""
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]
      if (ch !== "'") out += ch
    }
    return out || null
  }

  /** The qualifier (module or alias) part of a qualified name, for metadata. */
  private qualifierOf(text: string): string | undefined {
    const inner = this.qualifiedTarget(text)
    if (!inner) return undefined
    const dot = inner.indexOf(".")
    return dot > 0 ? inner.slice(0, dot) : undefined
  }

  // ============================================================================
  // PASS 3 — closure
  // ============================================================================

  /**
   * `contains` for owned symbols — module → members, type → constructors and
   * fields, class/instance → methods, local frame → its own definitions. The
   * CHILD's own naming line is the anchor that resolves the intended target among
   * same-named siblings (#921), and a self-named edge is skipped because a symbol
   * cannot contain itself.
   */
  private emitContainsEdges(ctx: CleanContext): void {
    for (const s of ctx.symbols) {
      const owner = s.ownerName
      if (owner && owner !== s.name) {
        this.pushRel(ctx, owner, s.name, ASTEngine.RelationshipType.Contains, 1.0, {}, s.range?.startLine)
      }
    }
  }

  /**
   * Exports: every symbol the MODULE owns, plus an explicit `foreign export`.
   * Clean has no export keyword — a `.dcl`'s definition list IS the interface and
   * everything in it is public by default.
   *
   * Class/instance members keep their owner (`<class>` / the instance target type),
   * so they are NOT exported: their membership rides the `contains` edge, exactly
   * as the haskell lane treats a class method. Where/with/let locals are NOT
   * exported (M11.11 §2: a local is a real symbol but not part of the module's
   * surface) — now that locals publish at all, that exclusion is load-bearing
   * rather than incidental, and it is stated here because it is the one place a
   * `visibility: "local"` symbol could otherwise leak into the module interface.
   *
   * Name-keyed first-wins dedupe: the exports-family invariant (run-fixtures.ts,
   * M49 JVM-closure audit) requires UNIQUE export names, because a duplicate
   * cannot identify its provider. Clean reaches the collision honestly —
   * `instance Eq ParseState where …` publishes its Class under the instance
   * TARGET type, so a file that both defines the type and implements an instance
   * for it offered `ParseState` twice (measured: 59 of 312 files before the
   * dedupe). Same dedupe as cpp/go/objc/clojure, keyed by bare name — a Clean
   * module exports a name, not a name+kind pair.
   */
  private emitExports(ctx: CleanContext): void {
    const EXPORTABLE_KINDS = new Set<ASTEngine.SymbolKind>([
      ASTEngine.SymbolKind.Function,
      ASTEngine.SymbolKind.Type,
      ASTEngine.SymbolKind.Interface,
      ASTEngine.SymbolKind.Class,
      ASTEngine.SymbolKind.Module,
      ASTEngine.SymbolKind.Constructor,
      ASTEngine.SymbolKind.Property,
      ASTEngine.SymbolKind.Macro,
    ])
    const seen = new Set<string>()
    const source = ctx.currentModule ?? ""
    for (const sym of ctx.symbols) {
      if (sym.name.startsWith("_")) continue
      if (!EXPORTABLE_KINDS.has(sym.kind)) continue
      if (sym.visibility === "local" || sym.metadata?.isLocalDefinition) continue
      if (seen.has(sym.name)) continue
      if (sym.ownerName !== ctx.currentModule && sym.ownerName !== undefined) continue
      seen.add(sym.name)
      ctx.exports.push({ name: sym.name, kind: sym.kind, range: sym.range, visibility: "public" })
      if (source) {
        this.pushRel(
          ctx,
          source,
          sym.name,
          ASTEngine.RelationshipType.Exports,
          1.0,
          { cleanSpecific: true },
          sym.range?.startLine,
        )
      }
    }
  }

  // ============================================================================
  // PASS 3 — plumbing
  // ============================================================================

  /**
   * Relationship emission, deduped by source|type|target|line identity.
   *
   * Dimension 8 / M59.O2: an edge carries the SITE LINE it happened on — 1-based,
   * on the name-bearing node, per-site and not per-set, because navigation is the
   * product. Two consequences, both deliberate:
   *   * the line is part of the DEDUPE KEY (the clojure lane's rule,
   *     real-clojure-analyzer.ts:1388): a function called from three lines is
   *     three edges at three lines, not one edge at whichever line the walk saw
   *     first. The store already keys its rows the same way
   *     (parallel-indexer.ts:4439), and for a `contains` edge the child's own
   *     naming line is what resolves the intended target among same-named
   *     siblings (#921);
   *   * a line that is not a positive integer is recorded as ABSENT, never as 0.
   *     M59.O2: the contract is "the site line or NULL" — a fabricated 0 reads as
   *     "line 0" to every reader downstream.
   */
  private pushRel(
    ctx: CleanContext,
    source: string,
    target: string,
    type: ASTEngine.RelationshipType,
    confidence: number,
    metadata: Record<string, any> = {},
    line?: number,
  ): void {
    if (!source || !target) return
    const hasLine = typeof line === "number" && Number.isInteger(line) && line > 0
    const key = `${source}|${type}|${target}|${hasLine ? line : ""}`
    if (ctx.seenRels.has(key)) return
    ctx.seenRels.add(key)
    ctx.relationships.push({
      source,
      target,
      type,
      confidence,
      metadata,
      ...(hasLine ? { line_number: line as number } : {}),
    })
  }

  /** 1-based line of a node, or undefined — never 0 (M59.O2). */
  private lineOf(node: Node | null | undefined): number | undefined {
    if (!node) return undefined
    const line = node.startPosition.row + 1
    return line > 0 ? line : undefined
  }

  // ============================================================================
  // PASS 2 — shared helpers
  // ============================================================================

  private isLocalScope(scope: Scope | undefined): boolean {
    return scope !== undefined && scope.kind === ASTEngine.SymbolKind.Namespace && scope.name === LOCAL_SCOPE_NAME
  }

  /**
   * The identity a declaration in `scope` merges under: the local's enclosing
   * FRAME when the scope is a where/with/let block (that is what keeps a local
   * from colliding with a module callable), otherwise the scope's own name.
   */
  private ownerIdentity(scope: Scope | undefined, ctx: CleanContext): string | undefined {
    if (this.isLocalScope(scope)) return ctx.currentFrame
    return scope?.name
  }

  /** A callable's kind from the scope it is declared in. */
  private callableKind(scope: Scope | undefined, isLocal: boolean): ASTEngine.SymbolKind {
    if (isLocal) return ASTEngine.SymbolKind.Function
    if (scope === undefined) return ASTEngine.SymbolKind.Function
    if (scope.kind === ASTEngine.SymbolKind.Interface || scope.kind === ASTEngine.SymbolKind.Class) {
      return ASTEngine.SymbolKind.Method
    }
    if (scope.kind === ASTEngine.SymbolKind.Type) return ASTEngine.SymbolKind.Property
    return ASTEngine.SymbolKind.Function
  }

  /** The `| C a, D b` constraints of a class or instance, as edges. */
  private emitContextRefs(context: Node, source: string, label: string, ctx: CleanContext): void {
    const info: SignatureInfo = {
      node: context,
      paramTypes: [],
      genericVars: new Set(),
      typeRefs: [],
      contextClasses: [],
      specialTypes: [],
      hasCodeBody: false,
    }
    this.readClassContext(context, info)
    if (info.contextClasses.length === 0) return
    ctx.patterns["Class Contexts"] = true
    for (const c of info.contextClasses) {
      this.pushRel(ctx, source, c, ASTEngine.RelationshipType.References, 0.95, {
        cleanSpecific: true,
        relationshipType: label,
      }, this.lineOf(context))
    }
  }

  /**
   * Type names mentioned by a type expression, as `references` edges — Clean's
   * `extractDeclaredTypeRefs` (the TypeScript lane's, at
   * real-typescript-analyzer.ts:3144). The line is the NAME's own line, not the
   * type expression's start, because a multi-line type puts its arguments on
   * later lines and the reader navigates to the name.
   */
  private emitTypeRefs(typeNode: Node, source: string, label: string, ctx: CleanContext): void {
    for (const ref of this.typeRefsIn(typeNode, ctx)) {
      this.pushRel(ctx, source, ref.name, ASTEngine.RelationshipType.References, 0.95, {
        cleanSpecific: true,
        relationshipType: label,
      }, this.lineOf(ref.node))
    }
  }

  /**
   * The declared name of a function/operator definition, read from the grammar's
   * FIELD.
   *
   * `findChild(node, n => n.type === "identifier")` returns the FIRST identifier
   * child, which is only the name while the name happens to be typed `identifier`.
   * An uppercase definition's name is typed `constructor` (Clean lets a constructor
   * be a function and the grammar says so), so the heuristic skipped over it and
   * published the first PARAMETER as the function name. Measured over this lane's
   * corpora, per grammar: pinned v1.2.4 — 4,607 declarations, 452 published a
   * parameter as the name, 252 dropped; v1.2.7 — 4,647 declarations, 447 published
   * a parameter, 244 dropped. The field is exact, so it is used when present and
   * the scan remains only as a fallback for a node with no field.
   */
  private declaredName(node: Node): Node | null {
    const byField = node.childForFieldName("name")
    if (byField?.text) return byField
    return this.findChild(node, (n) => n.type === "identifier" || n.type === "constructor")
  }

  /**
   * The name an `operator_definition` declares. Same normalization as
   * `declarationName`'s parenthesized branch, so a signature and its definition
   * land on ONE key and merge instead of producing two symbols.
   */
  private operatorDefinitionName(node: Node): string | null {
    const nameNode =
      node.childForFieldName("name") ??
      this.findChild(node, (n) => n.type === "parenthesized_operator" || n.type === "parenthesized_name")
    if (!nameNode?.text) return null
    return this.unparenthesize(nameNode.text)
  }

  /**
   * The name a `type_signature` DECLARES, normalized across the four shapes the
   * pinned grammar puts inside `signature_name`:
   *
   *   identifier              `f :: !Int -> Bool`
   *   constructor             `NSMakeSize :: !NSSize !NSSizeType -> NSSize*`
   *                           — Clean lets an uppercase name be a FUNCTION and the
   *                           grammar types it `constructor`
   *   parenthesized_operator  `(%.) infixl 9 :: ...` — the name is `%.`
   *   parenthesized_name      `(bitxor) :: !Int !Int -> Int` — the name is
   *                           `bitxor` (a prefix declaration of an infix-capable
   *                           name)
   *
   * A parenthesized shape carrying a comma or a brace is NOT a name: it is the
   * grammar's mis-shape for a PATTERN (`# (a,b,c) = expr;`), and publishing it
   * would fabricate a symbol no source declares. Measured over the corpus
   * (312 files, 148 of them `.dcl`): 2,753 module-level signature sites, of which
   * 1,021 names were published nowhere — 708 identifiers, 259 constructors, 45
   * operators, 9 parenthesized names.
   */
  private declarationName(node: Node): string | null {
    const sigName = node.childForFieldName("name") ?? this.findChild(node, (n) => n.type === "signature_name")
    if (!sigName) return null
    const kid = sigName.namedChildCount > 0 ? sigName.namedChild(0) : null
    if (!kid) return null
    if (kid.type === "identifier" || kid.type === "constructor") return kid.text
    if (kid.type === "parenthesized_operator" || kid.type === "parenthesized_name") {
      return this.unparenthesize(kid.text)
    }
    return null
  }

  private unparenthesize(text: string): string | null {
    return unparenthesizeText(text)
  }

  /**
   * The comments belonging to a declaration: the run of comment nodes that
   * IMMEDIATELY precede it, plus any comment inside it.
   *
   * Contiguity is the boundary. Without it a trailing remark about the PREVIOUS
   * declaration — the common case in Clean's `.dcl` files, where every interface
   * member is introduced by a comment — is stolen by the next one, and a `.dcl`
   * that documents twenty members would give all twenty the same text. So the
   * walk stops at the first comment with a blank line between it and the
   * declaration, which is the same rule the TypeScript lane uses
   * (real-typescript-analyzer.ts:5439).
   *
   * 3,062 comment nodes over the corpus (2,679 line, 383 block) reached no symbol
   * before this: the lane published a symbol's type, parameters and generics and
   * never its documentation, so `brain_symbol.docstring` was empty for every Clean
   * symbol in existence.
   */
  /**
   * Add a node's comments to a symbol that already has some.
   *
   * The order is signature-then-definition, which is the source order for the
   * `.dcl` house style (documentation above the signature, definition below), and
   * the DEFINITION's leading run takes the `docstring` when it has one.
   */
  private mergeComments(sym: ASTEngine.UniversalSymbol, node: Node): void {
    const before = sym.comments?.length ?? 0
    this.attachComments(sym, node)
    if ((sym.comments?.length ?? 0) === before) return
    if (this.leadingComments(node).length > 0 && !sym.docstring) sym.docstring = sym.comments?.[0]
  }

  private attachComments(sym: ASTEngine.UniversalSymbol, node: Node): void {
    const leading = this.leadingComments(node)
    const inner: string[] = []
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (!child || !COMMENT_TYPES.has(child.type)) continue
      const text = commentText(child.text)
      if (text && !leading.includes(text) && !inner.includes(text)) inner.push(text)
    }
    const trailing = this.trailingComments(node)
    const all = [...leading, ...trailing, ...inner]
    if (all.length === 0) return
    const existing = sym.comments ?? []
    const merged = [...existing]
    for (const c of all) if (!merged.includes(c)) merged.push(c)
    sym.comments = merged
    // Documentation is the LEADING run. A trailing or inner comment is a note
    // about this declaration's own line or its parts, not about the entity, so
    // promoting it to `docstring` would document the wrong thing.
    if (leading.length > 0 && !sym.docstring) sym.docstring = leading[0]
  }

  /**
   * The contiguous run of comment nodes IMMEDIATELY above a declaration, in
   * source order.
   *
   * Two boundaries, and the first implementation had only one:
   *
   *   * a BLANK LINE ends the run — otherwise a remark about the PREVIOUS
   *     declaration is stolen by the next one, and a `.dcl` that documents twenty
   *     members would give all twenty the same text;
   *   * a comment that begins ON the preceding declaration's own line is that
   *     declaration's TRAILING comment, not this one's documentation. Clean's
   *     grammar puts such a comment in the source-file child list right after the
   *     declaration it annotates, so it is the next declaration's
   *     `previousSibling` and the blank-line rule alone cannot exclude it. The
   *     measured damage: `initAppDelegate` was documented with
   *     "create the AppDelegate class", which is `createAppDelegate`'s comment.
   *     The barrier is the nearest preceding NON-comment sibling's end row; a
   *     comment starting at or above it belongs to that sibling.
   */
  private leadingComments(node: Node): string[] {
    const parent = node.parent
    if (!parent) return []
    const at = this.childIndexOf(parent, node)
    if (at < 0) return []
    // The BARRIER: the end row of the nearest preceding NON-comment sibling. A
    // comment starting at or above it belongs to that sibling — it is that
    // declaration's trailing `//`, which this grammar places in the parent child
    // list rather than inside the declaration.
    let barrierRow = -1
    for (let i = at - 1; i >= 0; i--) {
      const c = parent.child(i)
      if (!c || !c.isNamed) continue
      if (COMMENT_TYPES.has(c.type)) continue
      barrierRow = c.endPosition.row
      break
    }
    const out: string[] = []
    let anchorRow = node.startPosition.row
    for (let i = at - 1; i >= 0; i--) {
      const c = parent.child(i)
      if (!c || !c.isNamed || !COMMENT_TYPES.has(c.type)) break
      // A blank line between the comment and the declaration ends the run —
      // otherwise a remark about the PREVIOUS declaration is stolen by the next
      // one, and a `.dcl` that documents twenty members gives all twenty the
      // same text.
      if (c.endPosition.row + 1 < anchorRow) break
      if (c.startPosition.row <= barrierRow) break
      const text = commentText(c.text)
      if (text) out.unshift(text)
      anchorRow = c.startPosition.row
    }
    return out
  }

  /**
   * A TRAILING comment: the run of comment nodes that start on the declaration's
   * own END row.
   *
   * Clean's house style in every `.dcl` in this corpus is a remark at the end of
   * the signature line, and this grammar places it in the PARENT's child list
   * after the declaration — so it is also the next declaration's leading
   * neighbour, which is why the barrier in `leadingComments` exists.
   */
  private trailingComments(node: Node): string[] {
    const parent = node.parent
    if (!parent) return []
    const at = this.childIndexOf(parent, node)
    if (at < 0) return []
    const out: string[] = []
    for (let i = at + 1; i < parent.childCount; i++) {
      const c = parent.child(i)
      if (!c || !c.isNamed || !COMMENT_TYPES.has(c.type)) break
      if (c.startPosition.row !== node.endPosition.row) break
      const text = commentText(c.text)
      if (text && !out.includes(text)) out.push(text)
    }
    return out
  }

  /**
   * This node's index in its parent's child list, or -1.
   *
   * It is found by START INDEX rather than by identity because web-tree-sitter
   * recreates a Node object on every access — and the sibling ACCESSORS cannot be
   * used at all on this grammar: measured, `previousSibling` here returns the
   * previous NAMED NON-COMMENT sibling, skipping the very comment nodes this
   * method exists to find, so `total`'s leading block comment was unreachable
   * through it. Scanning the child list is the construction that works, and it is
   * the same one the rest of this file uses to find a node's neighbours.
   */
  private childIndexOf(parent: Node, child: Node): number {
    for (let i = 0; i < parent.childCount; i++) {
      const c = parent.child(i)
      if (c && c.startIndex === child.startIndex && c.endIndex === child.endIndex) return i
    }
    return -1
  }

  // ============================================================================
  // AST PLUMBING
  //
  // Everything here reads a node's own structure. No method inspects a node's
  // text to decide what it is: the grammar's FIELDS are the discriminator
  // everywhere, and the only text-level operations in the file are the four
  // positional ones already justified at their definitions (the unparenthesize
  // pair, the dot strip, the quote drop, the whitespace fold).
  // ============================================================================

  /**
   * `childrenForFieldName` with the null entries dropped.
   *
   * web-tree-sitter's `childrenForFieldName` is typed `(Node | null)[]` because
   * it walks the whole child list matching field ids. Every caller here wants the
   * real children, and a `for..of` over the raw array would need a non-null
   * assertion at each use. One filter, here, is both shorter and honest about the
   * shape.
   */
  private fields(node: Node, name: string): Node[] {
    const raw = node.childrenForFieldName(name)
    const out: Node[] = []
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i]
      if (c) out.push(c)
    }
    return out
  }

  private findChild(node: Node, predicate: (n: Node) => boolean): Node | null {
    const count = node.namedChildCount
    for (let i = 0; i < count; i++) {
      const child = node.namedChild(i)
      if (child && predicate(child)) return child
    }
    return null
  }

  private filterChildren(node: Node, predicate: (n: Node) => boolean): Node[] {
    const result: Node[] = []
    const count = node.namedChildCount
    for (let i = 0; i < count; i++) {
      const child = node.namedChild(i)
      if (child && predicate(child)) result.push(child)
    }
    return result
  }

  private firstNamedChildOfType(node: Node, type: string): Node | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (c && c.type === type) return c
    }
    return null
  }

  /** A child the grammar leaves UNFIELDED — `generic_declaration`'s `::` type. */
  private unnamedChildOfType(node: Node, type: string): Node | null {
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i)
      if (c && c.type === type) return c
    }
    return null
  }

  /**
   * A name node normalized for a parenthesized operator or name: `(==)` → `==`,
   * anything else → its own text.
   *
   * The parenthesized forms are how Clean spells an infix-capable name, and the
   * four shapes that carry a name (`constructor`, `identifier`,
   * `parenthesized_operator`, `parenthesized_name`) must all land on ONE key, or
   * a signature and its definition become two symbols.
   */
  private normalizeParenthesized(node: Node | null): string | null {
    if (!node?.text) return null
    if (node.type === "parenthesized_operator" || node.type === "parenthesized_name") {
      return this.unparenthesize(node.text)
    }
    return node.text
  }

  /** module_name children compose dotted names (Data.Map → Data + "." + Map). */
  private assembleModuleName(node: Node): string {
    let out = ""
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (!c) continue
      const leaf = c.type === "module_name" ? this.assembleModuleName(c) : c.text
      if (out) out += "."
      out += leaf
    }
    return out || node.text
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

  /**
   * Is this application in PATTERN territory?
   *
   * A constructor application is an `instantiates` in a body and a match in a
   * pattern, and the two are different edges. Pattern territory is:
   *   * any pattern-node subtree (`constructor_pattern`, `list_pattern`,
   *     `tuple_pattern`, `record_pattern`, `paren_pattern`, `unboxed_pattern`,
   *     `cons_pattern`, `strict_binding_pattern`, `record_update_pattern`);
   *   * a `case_alternative` head — the pattern before the `->`;
   *   * everything in a definition BEFORE its `body` FIELD (the head patterns).
   *
   * The pre-#884 form of the third rule scanned the children for one typed
   * `operator` with text `=`, which the pinned grammar cannot produce: a
   * definition's s-expression carries name/pattern…/body and NO `=` child at all
   * (measured three ways — the 1,576 `operator` nodes in the corpus have parents
   * `binary_expression` 829, `unary_expression` 99, `paren_pattern` 9,
   * `operator_definition` 5, `instance_class` 11 and never a
   * `function_declaration`, and no `operator` node's text is `=`). Expressed
   * against the field, the rule is live and means the same thing.
   */
  private isPatternPosition(node: Node): boolean {
    let cur: Node | null = node.parent
    while (cur) {
      if (PATTERN_NODE_TYPES.has(cur.type)) return true
      if (cur.type === "case_alternative") {
        const first = cur.namedChild(0)
        return (first !== null && first.startIndex === node.startIndex) || this.isBeforeArrow(cur, node)
      }
      if (CALLABLE_NODE_TYPES.has(cur.type)) return this.isBeforeBody(cur, node)
      if (
        cur.type === "type_definition" ||
        cur.type === "class_declaration" ||
        cur.type === "instance_declaration" ||
        cur.type === "type_signature"
      ) {
        return false
      }
      cur = cur.parent
    }
    return false
  }

  private isBeforeArrow(caseAlt: Node, node: Node): boolean {
    for (let i = 0; i < caseAlt.namedChildCount; i++) {
      const c = caseAlt.namedChild(i)
      if (!c) continue
      if (c.type === "arrow") return node.startIndex < c.startIndex
      if (c.startIndex === node.startIndex) return true
    }
    return false
  }

  /**
   * Pattern territory inside a definition is everything BEFORE its body FIELD. A
   * definition with no body field at all (a damaged parse) still has `pattern`
   * fields, and territory is everything before the LAST of them, so a constructor
   * application in a body-less node is not mistaken for a match.
   */
  private isBeforeBody(defNode: Node, node: Node): boolean {
    for (const b of this.fields(defNode, "body")) {
      if (node.startIndex < b.startIndex) return true
    }
    const patterns = this.fields(defNode, "pattern")
    if (patterns.length === 0) return false
    let last = -1
    for (const p of patterns) last = Math.max(last, p.endIndex)
    return node.startIndex < last
  }
}

/** One walk-stack entry. */
interface StackEntry {
  node: Node
  isExit?: boolean
  /** True only for an entry that opened a frame, and therefore may restore one. */
  restoresFrame?: boolean
  /** The frame identity to restore on exit. */
  restoreFrame?: string | undefined
  /** The frame-is-local flag to restore on exit. */
  restoreLocal?: boolean
  /** True when this entry is inside an `ERROR` node — see `inErrorRegion`. */
  inError?: boolean
}

/**
 * A comment's TEXT, with the markers removed. Clean has two comment forms and the
 * grammar types both as named nodes: `// …` (2,679 sites) and `/* … *\/`
 * (383 sites), and a documentation block is written `/*** … ***\/` (a block
 * comment whose opening run of stars is the marker, not content).
 *
 * Marker removal is positional — leading `/` runs and one trailing `*\/` — so it
 * needs no pattern. The result is what a reader sees, and it is the same string
 * the store's `docstring` column is meant to hold.
 */
function commentText(raw: string): string {
  let s = raw
  if (s.startsWith("/*")) {
    s = s.slice(2)
    while (s.startsWith("*")) s = s.slice(1)
    if (s.endsWith("*/")) s = s.slice(0, -2)
    return s.trim()
  }
  while (s.startsWith("/")) s = s.slice(1)
  return s.trim()
}

/** Drop a single leading `.` — the `dotted_type` marker, positionally. */
function stripLeadingDot(text: string): string {
  return text.startsWith(".") ? text.slice(1) : text
}
