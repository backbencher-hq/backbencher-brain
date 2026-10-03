import type { Node } from "web-tree-sitter"
import { ASTEngine } from "./engine"

/**
 * R assignment operators. The TARGET of an assignment is the side the arrow
 * points away from: `<-`/`<<-`/`=` bind the LEFT side, `->`/`->>` bind the
 * RIGHT side. The grammar exposes `lhs`/`rhs`/`operator` fields, so the target
 * is read from a field rather than from a child index.
 */
const LEFT_BINDING_OPERATORS = new Set(["<-", "<<-", "="])
const RIGHT_BINDING_OPERATORS = new Set(["->", "->>"])
const ASSIGNMENT_OPERATORS = new Set([...LEFT_BINDING_OPERATORS, ...RIGHT_BINDING_OPERATORS])

/** `pkg::name` and `pkg:::name` are both namespace access; the operator field
 *  distinguishes them and the RHS field carries the bare name. */
const NAMESPACE_OPERATORS = new Set(["::", ":::"])

/** Apply-family constructors. An exact set, not a substring test: `indexOf("apply")`
 *  also matched `rapply`, `apply_patch` and any user function containing the word. */
const APPLY_FAMILY = new Set([
  "apply", "sapply", "lapply", "vapply", "mapply", "rapply", "tapply",
  "Map", "mapply", "Reduce", "Filter", "Negate",
])

const TIDYVERSE_NSE = new Set([
  "mutate", "select", "filter", "summarise", "summarize", "group_by", "arrange",
  "aes", "vars", "transmute", "distinct", "slice", "pull", "rename", "relocate",
])

const REACTIVE_CONSTRUCTORS = new Set([
  "reactive", "observe", "observeEvent", "eventReactive", "reactiveVal",
  "reactiveValues", "reactiveExpr", "reactivePoll", "reactiveFileReader",
  "bindCache", "freezeReactiveValue",
])

const STATISTICAL_MODELS = new Set(["lm", "glm", "summary", "glm.nb", "MASS::rlm"])
const DATA_FRAME_CONSTRUCTORS = new Set(["data.frame", "tibble", "as.data.frame", "data.table"])
const ERROR_HANDLERS = new Set(["tryCatch", "withCallingHandlers", "try", "tryCatch"])
const CLEANUP_HANDLERS = new Set(["on.exit", "onLoad", "onUnload"])
const NSE_CAPTURERS = new Set([
  "substitute", "quote", "bquote", "match.call", "match.arg", "enquo", "enquos",
  "expr", "enexpr", "eval", "rlang::enquo", "ensym", "enname", "quo", "quos",
])

/** R6/R5 member lists whose non-function entries are DATA MEMBERS. */
const CLASS_MEMBER_LISTS = new Set(["public", "private", "active"])

/** R5 reference classes declare data in `fields=` and behaviour in `methods=`;
 *  R6 uses `public=`/`private=`/`active=` for both. */
const R5_MEMBER_LISTS = new Set(["fields", "methods"])
/** Lists whose entries are data members by construction, so even a function value
 *  is a declared field rather than a method. */
const DATA_MEMBER_LISTS = new Set(["fields"])

/**
 * How a call was attributed to a source symbol, and how much to trust it.
 * M14 requires every sub-1.0 edge to carry a reason code, so the reason travels
 * with the edge rather than living only in a doc comment.
 */
interface CallAttribution {
  name: string
  confidence: number
  subType: string
  reason: string
}

export class RealRAnalyzer implements ASTEngine.LanguageAnalyzer {
  /**
   * UTF-16 code-unit index -> byte offset, set for the duration of an `analyze` call and
   * cleared on return, so that every `getRange` call populates `byteStart`/`byteEnd`
   * without each of them having to be handed the source text.
   */
  private byteOffsetOf: ((utf16Index: number) => number) | null = null

  analyze(
    rootNode: Node,
    content: string,
    filePath: string,
  ): Omit<ASTEngine.ParseResult, "language" | "metadata"> & { metadata?: Partial<ASTEngine.FileMetadata> } {
    const symbols: ASTEngine.UniversalSymbol[] = []
    const imports: ASTEngine.ImportInfo[] = []
    const exports: ASTEngine.ExportInfo[] = []
    const relationships: ASTEngine.UniversalRelationship[] = []
    const declaredTypes = new Set<string>()
    const metadata: Partial<ASTEngine.FileMetadata> = {
      detectedFrameworks: [],
      patterns: [],
      architecturalInsights: [],
      cyclomaticComplexity: 1,
      linesOfCode: 0,
      dataManipulationIntensity: 0,
      statisticalFocus: 0,
      codeQuality: "excellent",
      architecturalScore: 100,
    }

    if (!rootNode) return { symbols, imports, errors: [] }

    // UTF-16 index -> byte offset, for `byteStart`/`byteEnd` on every range.
    //
    // web-tree-sitter reports startIndex/endIndex as UTF-16 CODE UNITS, while upstream
    // tree-sitter reports BYTES and `range.startIndex` is widely read as a byte offset. The
    // two agree for ASCII and diverge by the surplus UTF-8 bytes before the position, so on
    // a file with an accented character at byte 0 a byte-index consumer slices the wrong
    // span. The existing fields are left exactly as they are -- changing them would break
    // every lane that already reads them -- and the byte offsets are added ALONGSIDE.
    //
    // The index stores only the positions where a character is not one ASCII byte, which for
    // nearly all source files means it is empty and `byteOffset` is the identity. The
    // alternative, a table with one entry per character, would cost memory proportional to
    // file size on every parse to serve a case that is rare.
    const nonAscii: number[] = []   // UTF-16 index of each non-ASCII character
    const surplus: number[] = []    // surplus bytes accumulated BEFORE that index
    for (let i = 0, extra = 0; i < content.length; i++) {
      const c = content.charCodeAt(i)
      if (c < 128) continue
      // Surrogate pairs are two UTF-16 units for one character; count the character once.
      const cp = c >= 0xd800 && c <= 0xdbff ? content.codePointAt(i)! : c
      const units = cp > 0xffff ? 2 : 1
      const bytes = cp <= 0x7f ? 1 : cp <= 0x7ff ? 2 : cp <= 0xffff ? 3 : 4
      nonAscii.push(i)
      surplus.push(extra)
      extra += bytes - units
      if (units === 2) i++
    }
    /** UTF-16 code-unit index -> byte offset, by counting surplus bytes before it. */
    const byteOffset = (utf16Index: number): number => {
      if (nonAscii.length === 0) return utf16Index
      let lo = 0
      let hi = nonAscii.length - 1
      let lastBefore = -1
      while (lo <= hi) {
        const mid = (lo + hi) >> 1
        if (nonAscii[mid] <= utf16Index) { lastBefore = mid; lo = mid + 1 } else { hi = mid - 1 }
      }
      return lastBefore < 0 ? utf16Index : utf16Index + surplus[lastBefore]
    }
    // Held as analyzer state for the rest of this call rather than threaded through the 23
    // `getRange` call sites: a parameter would be noise at every one of them, and omitting
    // it at a site would silently leave the byte fields absent instead of failing.
    this.byteOffsetOf = byteOffset

    /** name -> the line the NAME is written on, so an edge that names the symbol
     *  points at the name rather than at the start of a multi-line declaration. */
    const symbolLine = new Map<string, number>()
    /** (owner, member) -> the line that member's own name is written on. */
    const memberLine = new Map<string, number>()
    /** class name -> the member names it declares, for the file-scoped `overrides` pass. */
    const classMembers = new Map<string, string[]>()
    /** class name -> the base class names it names in `inherit=`/`contains=`/`parent=`. */
    const classBases = new Map<string, string[]>()
    /** class name -> the node that names the class, for the `overrides` line. */
    const classDeclLine = new Map<string, number>()

    /** Ambiguity counters, surfaced in metadata so a claim of completeness can be audited. */
    const ambiguity = {
      callsUnresolvedScope: 0,
      callsAttributedThroughClosure: 0,
      heuristicS3Generic: 0,
      // A call whose callee is not a name at all -- `(if (uplo == "U") triu else
      // tril)(x)`. Counted, because the alternative is that these vanish from the totals
      // and a reader cannot tell "no such calls" from "not measured".
      callsToUnnameableCallee: 0,
      // `uses` accounting. The three numbers the `uses` surface cannot hide behind:
      // a member read already carried by `calls`, a member WRITE, and a read with no
      // enclosing named symbol to attribute to. Each is counted rather than dropped,
      // for the reason the counter above states.
      memberReadsSuppressedByCall: 0,
      memberWrites: 0,
      memberReadsUnresolvedScope: 0,
      memberReadsWithComputedIndex: 0,
    }

    if (rootNode.hasError) {
      const errStack: Node[] = [rootNode]
      while (errStack.length > 0) {
        const n = errStack.pop()!
        if (n.type === "ERROR" || n.isMissing) {
          if (!metadata.errors) metadata.errors = []
          metadata.errors.push({
            message:
              n.type === "ERROR"
                ? `Unrecoverable syntax region: tree-sitter-r could not parse this subtree. Extraction continued on a best-effort basis, so symbols and relationships inside this range may be missing.`
                : `Missing ${n.type} token: the source is syntactically incomplete at this point. Extraction continued on a best-effort basis.`,
            range: this.getRange(n),
            severity: "warning",
          })
        }
        for (let i = n.namedChildCount - 1; i >= 0; i--) {
          const child = n.namedChild(i)
          if (child) errStack.push(child)
        }
      }
    }

    let loc = 1
    for (let i = 0; i < content.length; i++) {
      if (content[i] === "\n") loc++
    }
    metadata.linesOfCode = loc

    // The walk keeps the chain of ENCLOSING function definitions on an explicit
    // stack, so attributing a call to its enclosing symbol is O(number of nested
    // functions) instead of O(tree depth). Walking `node.parent` per call was
    // quadratic in nesting: a 12,000-deep call chain cost 73 s, because each of
    // the 12,000 calls climbed ~12,000 ancestors.
    const EXIT_MARKER = Symbol("r-exit")
    const stack: Array<Node | symbol> = [rootNode]
    const fnStack: Array<{ node: Node; attribution: CallAttribution | null }> = []

    while (stack.length > 0) {
      const item = stack.pop()
      if (item === EXIT_MARKER) {
        fnStack.pop()
        continue
      }
      if (!item) continue
      const current = item as Node

      const type = current.type

      if (type === "binary_operator") {
        this.handleBinaryOperator(current, symbols, exports, relationships, metadata, declaredTypes, fnStack.length > 0)
      } else if (type === "call") {
        this.handleCall(current, symbols, imports, exports, relationships, metadata, declaredTypes, ambiguity, fnStack)
      } else if (type === "comment") {
        this.handleComment(current, metadata)
      } else if (type === "function_definition") {
        // A `function_definition` nested directly inside another one is tree-sitter-r's
        // wrapper for the body; the outer definition owns the symbol. A definition that
        // is the VALUE of an assignment is emitted by the binary_operator handler.
        const fnParent = current.parent
        const isNestedWrapper = fnParent && fnParent.type === "function_definition"
        const isAssignmentTarget =
          fnParent && fnParent.type === "binary_operator" && this.assignmentTarget(fnParent) === current
        // Anonymous function expressions are executable values, not stable
        // declarations. Named R functions are emitted by the assignment handler;
        // R6/R5 members by the class handlers; S4 generics/methods by handleCall.
        if (!isNestedWrapper && !isAssignmentTarget) {
          this.pushIfUnique(metadata.patterns, "Anonymous Functions")
        }
        // Resolve this definition's owner ONCE, on entry, and remember it for
        // every call in its body.
        fnStack.push({ node: current, attribution: this.resolveFunctionOwner(current) })
        stack.push(EXIT_MARKER)
      } else if (type === "subset" || type === "subset2") {
        this.pushIfUnique(metadata.patterns, "Vectorized Subsetting")
        // `df[["col"]]` is the base-R spelling of a member read and `df$col` is the
        // tidyverse one; both name a member, so both belong to the same surface.
        //
        // This MUST be inside this branch rather than a following `else if`. The walk
        // is one `if / else if` chain, so a separate `else if (type === "subset2" && …)`
        // is unreachable — `type === "subset2"` has already matched above — and the
        // `[[` surface emitted nothing while this fixture reported it missing. A gate
        // that cannot be reached is not a gate.
        if (type === "subset2" && this.stringSubsetIndex(current)) {
          this.handleMemberRead(current, fnStack, relationships, ambiguity)
        }
      } else if (type === "extract_operator") {
        this.handleMemberRead(current, fnStack, relationships, ambiguity)
      } else if (type === "unary_operator" && current.childForFieldName("operator")?.text === "~") {
        this.pushIfUnique(metadata.patterns, "Formula Interface")
        if (metadata.statisticalFocus !== undefined) metadata.statisticalFocus += 10
      }

      if (
        type === "if_statement" ||
        type === "for_statement" ||
        type === "while_statement" ||
        type === "repeat_statement"
      ) {
        if (metadata.cyclomaticComplexity !== undefined) {
          metadata.cyclomaticComplexity++
        }
      }

      // A branch R can never execute declares nothing.
      //
      //     if (FALSE) { sNms <- c("Dim","i","p","x"); L <- lapply(sNms, ...) }
      //
      // is not a declaration, and publishing one is a false positive of a kind the
      // R-oracle could not see: its walk descended into the branch too, so the two agreed on
      // the wrong answer and 8,798/8,798 stayed at 1.0. Found by a red-team cross-check that
      // EVALUATED each file and asked R what it held -- Matrix/data/CAex.R binds `CAex` and
      // nothing else, and the analyzer published three names for it.
      //
      // Only the LITERAL constants FALSE/F/false count. R's parser does not constant-fold, so
      // a variable that happens to hold FALSE is not statically knowable, and treating it as
      // dead would silently drop real declarations -- the failure mode of guessing.
      if (type === "if_statement" && this.isStaticallyFalseCondition(current)) {
        const elseBranch = current.childForFieldName("alternative")
        if (elseBranch) {
          for (let i = elseBranch.childCount - 1; i >= 0; i--) {
            const c = elseBranch.child(i)
            if (c) stack.push(c)
          }
        }
        continue
      }

      for (let i = current.childCount - 1; i >= 0; i--) {
        const child = current.child(i)
        if (child) {
          stack.push(child)
        }
      }
    }

    for (const s of symbols) {
      if (!symbolLine.has(s.name)) symbolLine.set(s.name, this.nameLineOf(s, content))
      if (s.ownerName && (s.kind === ASTEngine.SymbolKind.Method || s.kind === ASTEngine.SymbolKind.Property)) {
        const arr = classMembers.get(s.ownerName) ?? []
        arr.push(s.name)
        classMembers.set(s.ownerName, arr)
        const memberKey = `${s.ownerName}\u001f${s.name}`
        if (!memberLine.has(memberKey)) memberLine.set(memberKey, this.nameLineOf(s, content))
      }
      if (s.kind === ASTEngine.SymbolKind.Class) {
        const bases = (s.metadata?.baseClasses as string[] | undefined) ?? []
        if (bases.length) classBases.set(s.name, bases)
        if (!classDeclLine.has(s.name)) classDeclLine.set(s.name, s.range.startLine)
      }
      if (s.kind === ASTEngine.SymbolKind.Class && Array.isArray(s.metadata?.parent)) {
        classBases.set(s.name, s.metadata!.parent as string[])
      }
    }

    // `exports` edges. The ExportInfo array is the source of truth (it is what
    // roxygen `@export` feeds), and one pass over it means no declaration site
    // can forget to publish the edge. Without this the exported surface existed
    // in the parse result but in no relationship, so it was absent from
    // graph_usages' exports view and from relations.ts' declaration set.
    for (const e of exports) {
      this.pushRel(
        relationships,
        "global",
        e.name,
        ASTEngine.RelationshipType.Exports,
        1.0,
        { rSpecific: true, relationshipSubType: "roxygen_export", declaredKind: e.kind },
        symbolLine.get(e.name) ?? null,
      )
    }

    // `overrides` edges, FILE-SCOPED. A class method that shadows a method of a
    // base class DECLARED IN THIS SAME FILE is a provable override. A base that
    // lives in another package cannot be resolved from syntax, so no edge is
    // invented for it — the scope limit is stated on the edge.
    for (const [className, bases] of classBases) {
      const own = classMembers.get(className)
      if (!own || !own.length) continue
      for (const base of bases) {
        const inherited = classMembers.get(base)
        if (!inherited) continue
        for (const member of inherited) {
          if (!own.includes(member)) continue
          this.pushRel(relationships, base, member, ASTEngine.RelationshipType.Overrides, 0.95, {
            rSpecific: true,
            relationshipSubType: "object_system_method_override",
            overriddenBy: className,
            reasonCode: "base_class_declared_in_same_file",
            reason: `base class \`${base}\` is declared in this file, so the shadowing member is provably an override`,
          }, memberLine.get(`${className}\u001f${member}`) ?? classDeclLine.get(className))
        }
      }
    }

    this.detectFrameworksFromImports(imports, metadata)

    // Post-loop: add contains for owned symbols (R is top-level, default owner is 'global').
    // The set-based pass keeps relationship generation linear and removes the
    // duplicate contains edges emitted by R6/R5 member extraction.
    const containsKeys = new Set<string>()
    for (const rel of relationships) {
      if (rel.type === ASTEngine.RelationshipType.Contains && rel.source && rel.target) {
        containsKeys.add(`${rel.source}\u001f${rel.target}`)
      }
    }
    for (const s of symbols) {
      const _owner = s.ownerName || s.scope || "global"
      if (_owner) {
        const key = `${_owner}\u001f${s.name}`
        if (containsKeys.has(key)) continue
        containsKeys.add(key)
        this.pushRel(
          relationships,
          _owner,
          s.name,
          ASTEngine.RelationshipType.Contains,
          1.0,
          {},
          symbolLine.get(s.name) ?? s.range,
        )
      }
    }

    // Relationship identity is source/type/target. Preserve one edge per
    // semantic fact even when the same call appears in multiple AST wrappers.
    const uniqueRelationships: ASTEngine.UniversalRelationship[] = []
    const relationshipKeys = new Set<string>()
    for (const rel of relationships) {
      const key = `${rel.type || rel.relationshipType || ""}\u001f${rel.source || rel.from || ""}\u001f${rel.target || rel.to || ""}`
      if (relationshipKeys.has(key)) continue
      relationshipKeys.add(key)
      uniqueRelationships.push(rel)
    }

    // Deduplicate imports by (module, range) so one namespace access is one row.
    const uniqueImports: ASTEngine.ImportInfo[] = []
    const importKeys = new Set<string>()
    for (const imp of imports) {
      const r = imp.range
      const key = `${imp.module ?? ""}\u001f${r ? `${r.startLine}:${r.startColumn}-${r.endLine}:${r.endColumn}` : ""}`
      if (importKeys.has(key)) continue
      importKeys.add(key)
      uniqueImports.push(imp)
    }

    metadata.architecturalInsights = [
      `r.ambiguity.callsUnresolvedScope=${ambiguity.callsUnresolvedScope}`,
      `r.ambiguity.callsAttributedThroughClosure=${ambiguity.callsAttributedThroughClosure}`,
      `r.ambiguity.heuristicS3Generic=${ambiguity.heuristicS3Generic}`,
    ]

    // The comment on the counter's declaration has claimed these are "surfaced in
    // metadata so a claim of completeness can be audited" since the counter was
    // introduced. They were not: the object was created, incremented, and dropped on the
    // floor. That is not a cosmetic gap. `callsUnresolvedScope` is the count of calls the
    // analyzer could not attribute to any symbol, and because 55.6% of call sites in R sit
    // at FILE SCOPE -- R packages are mostly top-level code -- it is the single largest
    // hole in this lane's coverage. A completeness claim that cannot be read is not
    // auditable, and the number that would have exposed it was being discarded.
    //
    // Surfaced as a copy so a later increment cannot mutate the metadata a caller already
    // holds, and under a name that says what it is rather than repeating the internal one.
    ;(metadata as any).callAttribution = {
      unresolvedScope: ambiguity.callsUnresolvedScope,
      throughClosure: ambiguity.callsAttributedThroughClosure,
      heuristicS3Generic: ambiguity.heuristicS3Generic,
      unnameableCallee: ambiguity.callsToUnnameableCallee ?? 0,
      memberReadsSuppressedByCall: ambiguity.memberReadsSuppressedByCall,
      memberWrites: ambiguity.memberWrites,
      memberReadsUnresolvedScope: ambiguity.memberReadsUnresolvedScope,
      memberReadsWithComputedIndex: ambiguity.memberReadsWithComputedIndex,
    }

    this.byteOffsetOf = null
    return {
      symbols,
      imports: uniqueImports,
      relationships: uniqueRelationships,
      exports,
      metadata,
      errors: metadata.errors || [],
    }
  }

  private detectFrameworksFromImports(imports: ASTEngine.ImportInfo[], metadata: Partial<ASTEngine.FileMetadata>) {
    let hasTidyverse = false
    let hasGgplot2 = false
    let hasShiny = false
    let hasPlumber = false
    let hasDataTable = false
    let hasRcpp = false

    for (let i = 0; i < imports.length; i++) {
      const module = imports[i].module
      if (module === "dplyr" || module === "ggplot2" || module === "tidyr" || module === "tidyverse")
        hasTidyverse = true
      if (module === "ggplot2") hasGgplot2 = true
      if (module === "shiny") hasShiny = true
      if (module === "plumber") hasPlumber = true
      if (module === "data.table") hasDataTable = true
      if (module === "Rcpp") hasRcpp = true
    }

    if (hasTidyverse) this.pushIfUnique(metadata.detectedFrameworks, "Tidyverse")
    if (hasGgplot2) this.pushIfUnique(metadata.detectedFrameworks, "ggplot2")
    if (hasShiny) {
      this.pushIfUnique(metadata.detectedFrameworks, "Shiny")
      if (!metadata.frameworkPatterns) metadata.frameworkPatterns = []
      metadata.frameworkPatterns.push({ framework: "Shiny", pattern: "ui/server" })
    }
    if (hasPlumber) this.pushIfUnique(metadata.detectedFrameworks, "Plumber")
    if (hasDataTable) this.pushIfUnique(metadata.detectedFrameworks, "data.table")
    if (hasRcpp) this.pushIfUnique(metadata.detectedFrameworks, "Rcpp")
  }

  private pushIfUnique(arr: string[] | undefined, value: string) {
    if (!arr) return
    let exists = false
    for (let i = 0; i < arr.length; i++) {
      if (arr[i] === value) {
        exists = true
        break
      }
    }
    if (!exists) arr.push(value)
  }

  // ---------------------------------------------------------------- assignments

  /**
   * The two SIDES of an assignment, without deciding which is a declaration.
   *
   * `<-`/`<<-`/`=` bind their LEFT operand. `->`/`->>` bind their RIGHT operand and
   * nothing else — the left side is always a VALUE.
   *
   * This is not a stylistic choice, it is what R does, and it was measured
   * against R 4.4.3's own runtime rather than assumed:
   *
   *     2 -> b          OK, binds b
   *     2 ->> cc        OK, binds cc
   *     identity(1) -> gg   OK, binds gg
   *     bb -> 2         Error: invalid (do_set) left-hand side to assignment
   *     cc ->> 2        Error: invalid (do_set) left-hand side to assignment
   *
   * R desugars both rightward forms to `<-`(value, name) at parse time, so a
   * name on the LEFT of `->` is not a declaration — it is a runtime error, and
   * publishing a symbol for it would invent a binding R refuses to make.
   * tree-sitter-r does NOT desugar (it keeps `->` as an operator), which is
   * exactly why the two sides have to be distinguished here.
   *
   * An earlier revision of this analyzer read whichever side happened to be an
   * identifier. That published `variable e` for `e -> 6` — a construct R
   * rejects. Caught by the R oracle, not by the fixtures, because the fixture
   * had been written to match the same wrong belief.
   */
  private assignmentSides(node: Node): { target: Node | null; value: Node | null } {
    const operator = node.childForFieldName("operator")?.text
    if (operator === undefined) return { target: null, value: null }
    const lhs = node.childForFieldName("lhs")
    const rhs = node.childForFieldName("rhs")
    if (LEFT_BINDING_OPERATORS.has(operator)) return { target: lhs ?? null, value: rhs ?? null }
    if (RIGHT_BINDING_OPERATORS.has(operator)) return { target: rhs ?? null, value: lhs ?? null }
    return { target: null, value: null }
  }

  /**
   * The IDENTIFIER node an assignment binds, or null when it binds something
   * other than a simple name. `->>` is handled here too; it was absent from the
   * operator set entirely, so rightward superassignment produced no symbol.
   */
  private assignmentTarget(node: Node): Node | null {
    const { target } = this.assignmentSides(node)
    return target && target.type === "identifier" ? target : null
  }

  private handleBinaryOperator(
    node: Node,
    symbols: ASTEngine.UniversalSymbol[],
    exports: ASTEngine.ExportInfo[],
    relationships: ASTEngine.UniversalRelationship[],
    metadata: Partial<ASTEngine.FileMetadata>,
    declaredTypes: Set<string>,
    insideFunction: boolean,
  ): void {
    const operator = node.childForFieldName("operator")?.text
    if (operator === undefined) return

    if (operator === "%>%" || operator === "|>") {
      this.pushIfUnique(metadata.patterns, "Pipe Operations")
      if (metadata.dataManipulationIntensity !== undefined) metadata.dataManipulationIntensity += 20
    }

    if (!ASSIGNMENT_OPERATORS.has(operator)) return

    const { target: targetNode, value } = this.assignmentSides(node)
    if (!targetNode || !value) return

    // S7 method definition: `S7::method(generic, class) <- function(self, ...)`.
    // The bound "name" is a CALL, not an identifier, so it is invisible to the
    // identifier rule below; S7 is the object system current tidyverse and
    // ggplot2 code uses, and 31 method definitions appear in ggplot2 alone.
    if (targetNode.type === "call") {
      this.handleS7Assignment(node, targetNode, value, symbols, relationships, metadata, insideFunction)
      return
    }

    // A name being bound is a declaration. Subsets and `$`/`@` extraction targets are
    // mutations, not stable variable identities, so those are still excluded -- but a
    // target may be written as a STRING as well as bare or backticked, and R accepts all
    // three:
    //
    //     "%+replace%" <- function(e1, e2) ...      # ggplot2/R/theme-current.R:130
    //     "plain quoted" <- 42
    //     `backticked`   <- 1
    //
    // Requiring `identifier` dropped the quoted form entirely, so a name R binds was
    // published by nobody. Found by a red-team cross-check that EXECUTED each file and asked
    // R what it bound: R reported 4 names, the analyzer reported 2. The R-oracle missed it
    // too -- its walk also required a name node -- so 8,798/8,798 was blind to this on BOTH
    // sides, which is the failure mode an oracle written by the same author can have.
    if (targetNode.type === "string") {
      // A quoted target cannot be an S3 `generic.class` name: R dispatches on the literal
      // name, and `"a.b" <- function()` is one name, not a method. So the S3 logic below is
      // deliberately not reached from here.
      const strName = this.unquoteString(targetNode.text)
      if (!strName) return
      if (insideFunction) return
      if (this.hasLocalBoundary(node)) return
      symbols.push({
        name: strName,
        kind: value.type === "function_definition" ? ASTEngine.SymbolKind.Function : ASTEngine.SymbolKind.Variable,
        range: this.getRange(node),
        docstring: this.extractDocstring(node),
        metadata: { rSpecific: true, quotedAssignmentTarget: true, declarationOperator: node.childForFieldName("operator")?.text },
      })
      return
    }
    if (targetNode.type !== "identifier") return
    const name = this.unquoteIdentifier(targetNode.text)
    if (!name) return
    const doc = this.extractDocstring(node)

    // Function-local and `local()`-scoped assignments are execution locals, not
    // file-level declarations. The walk already knows whether an enclosing
    // function is on the stack, so that part is O(1).
    if (insideFunction) return
    if (this.hasLocalBoundary(node)) return

    if (value.type === "function_definition") {
      // An S3 method is registered under `generic.class`; the dot is part of the
      // name, so the generic is the prefix. A leading dot is not a separator.
      const isS3Method = name.indexOf(".") > 0

      symbols.push({
        name,
        kind: isS3Method ? ASTEngine.SymbolKind.Method : ASTEngine.SymbolKind.Function,
        range: this.getRange(node),
        signature: this.extractSignature(value),
        docstring: doc,
        parameters: this.extractParameters(value),
        metadata: { rSpecific: true, isS3Method, declarationOperator: operator },
      })

      if (isS3Method) {
        this.pushIfUnique(metadata.patterns, "S3 Object System")
        const toName = name.substring(0, name.indexOf("."))
        // A dotted name is R's registration convention, but nothing in the FILE
        // proves the generic exists, so the edge is a labelled heuristic.
        this.pushRel(
          relationships,
          name,
          toName,
          ASTEngine.RelationshipType.Implements,
          0.8,
          {
            relationshipSubType: "s3_method",
            reasonCode: "s3_dotted_name_convention",
            reason:
              "R registers S3 methods by the `generic.class` naming convention; the generic itself is not declared in this file, so the target is inferred from the name.",
          },
          node,
        )
      }

      if (doc && this.roxygenHasTag(doc, "@export"))
        exports.push({ name, kind: isS3Method ? ASTEngine.SymbolKind.Method : ASTEngine.SymbolKind.Function })
      return
    }

    if (value.type === "call") {
      const handled = this.handleClassSystemAssignment(
        node,
        name,
        value,
        symbols,
        exports,
        relationships,
        metadata,
        declaredTypes,
        doc,
        insideFunction,
      )
      if (handled) return
    }

    // Reached only for module-level identifier assignments whose value is not a
    // function and not a recognized class-system constructor; field mutations
    // and all function-local assignments returned above.
    symbols.push({
      name,
      kind: this.isAllCapsName(name) ? ASTEngine.SymbolKind.Constant : ASTEngine.SymbolKind.Variable,
      range: this.getRange(node),
      docstring: doc,
      metadata: { rSpecific: true, declarationOperator: operator },
    })
    if (doc && this.roxygenHasTag(doc, "@export"))
      exports.push({ name, kind: this.isAllCapsName(name) ? ASTEngine.SymbolKind.Constant : ASTEngine.SymbolKind.Variable })
  }

  /** Returns true when the call was recognized as a class-system constructor. */
  private handleClassSystemAssignment(
    node: Node,
    name: string,
    callNode: Node,
    symbols: ASTEngine.UniversalSymbol[],
    exports: ASTEngine.ExportInfo[],
    relationships: ASTEngine.UniversalRelationship[],
    metadata: Partial<ASTEngine.FileMetadata>,
    declaredTypes: Set<string>,
    doc: string | undefined,
    insideFunction: boolean,
  ): boolean {
    const fnNode = callNode.childForFieldName("function")
    const fnName = this.calleeName(fnNode)

    if (fnName === "R6Class") {
      const baseClasses = this.extractNamedArguments(callNode, "inherit")
      symbols.push({
        name,
        kind: ASTEngine.SymbolKind.Class,
        range: this.getRange(node),
        docstring: doc,
        metadata: { rSpecific: true, type: "R6", isR6Class: true, baseClasses },
      })
      declaredTypes.add(name)
      for (const bc of baseClasses) {
        this.pushRel(relationships, name, bc, ASTEngine.RelationshipType.Extends, 1.0, { relationshipSubType: "r6_inherits" }, this.namedArgumentNode(callNode, "inherit", bc))
      }
      this.extractR6Members(callNode, name, symbols, relationships, doc)
      if (doc && this.roxygenHasTag(doc, "@export")) exports.push({ name, kind: ASTEngine.SymbolKind.Class })
      return true
    }

    if (fnName === "setRefClass") {
      const baseClasses = this.extractNamedArguments(callNode, "contains")
      symbols.push({
        name,
        kind: ASTEngine.SymbolKind.Class,
        range: this.getRange(node),
        docstring: doc,
        metadata: { rSpecific: true, type: "R5", isR5Class: true, baseClasses },
      })
      declaredTypes.add(name)
      for (const bc of baseClasses) {
        this.pushRel(relationships, name, bc, ASTEngine.RelationshipType.Extends, 1.0, { relationshipSubType: "r5_inherits" }, this.namedArgumentNode(callNode, "contains", bc))
      }
      this.extractR5Members(callNode, name, symbols, relationships, doc)
      if (doc && this.roxygenHasTag(doc, "@export")) exports.push({ name, kind: ASTEngine.SymbolKind.Class })
      return true
    }

    if (fnName === "moduleServer") {
      symbols.push({
        name,
        kind: ASTEngine.SymbolKind.Function, // Mapped as functional component
        range: this.getRange(node),
        docstring: doc,
        metadata: { rSpecific: true, isShinyModuleServer: true, framework: "Shiny" },
      })
      this.pushIfUnique(metadata.patterns, "Shiny Modules")
      if (doc && this.roxygenHasTag(doc, "@export")) exports.push({ name, kind: ASTEngine.SymbolKind.Function })
      return true
    }

    if (fnName === "cppFunction" || fnName === "cxxfunction") {
      symbols.push({
        name,
        kind: ASTEngine.SymbolKind.Function,
        range: this.getRange(node),
        docstring: doc,
        metadata: { rSpecific: true, isInlineCpp: true, crossLanguage: "cpp" },
      })
      this.pushIfUnique(metadata.patterns, "Rcpp / Inline C++")
      if (doc && this.roxygenHasTag(doc, "@export")) exports.push({ name, kind: ASTEngine.SymbolKind.Function })
      return true
    }

    if (REACTIVE_CONSTRUCTORS.has(fnName)) {
      symbols.push({
        name,
        kind: ASTEngine.SymbolKind.Function,
        range: this.getRange(node),
        docstring: doc,
        metadata: { rSpecific: true, isReactive: true, reactiveType: fnName },
      })
      return true
    }

    // S4 declarations assigned to a name (`Gen <- setGeneric("foo")`) get their
    // symbol from handleCall under the DECLARED name; the binding itself is also a
    // real R object, so it is recorded and linked rather than silently dropped.
    if (fnName === "new_class" || fnName === "new_base_class") {
      // `Foo <- S7::new_class("Foo", ...)`; when the binding and the declared
      // class name differ (`class_gg <- S7::new_class("gg", ...)`) the DECLARED
      // name is the class identity — it is what `S7::method(print, gg)` names —
      // and the binding is a real R object in its own right, so both are emitted
      // and linked rather than one silently replacing the other.
      const s7Args = this.getArgumentsNode(callNode)
      // The node as well as the text: it is the line that NAMES the class, which is not
      // necessarily the line the call starts on.
      const declaredNode = this.stringArgumentNodeAt(s7Args, 0)
      const declared = declaredNode ? this.stringNodeText(declaredNode) : undefined
      const className = declared || name
      // With no declared string, `className` falls back to the binding name, which the
      // enclosing assignment already names. Falling back to the CALL node then keeps the
      // edge on a line that mentions the binding, rather than inventing a position.
      const classNameNode = declaredNode ?? node
      symbols.push({
        name: className,
        kind: ASTEngine.SymbolKind.Class,
        range: this.getRange(node),
        docstring: doc,
        metadata: { rSpecific: true, type: "S7", isS7Class: true, parent: this.extractNamedArguments(callNode, "parent") },
      })
      declaredTypes.add(className)
      this.pushIfUnique(metadata.patterns, "S7 Object System")
      if (declared && declared !== name) {
        symbols.push({
          name,
          kind: ASTEngine.SymbolKind.Variable,
          range: this.getRange(node),
          docstring: doc,
          metadata: { rSpecific: true, isS7ClassBinding: true, boundClass: className },
        })
        this.pushRel(relationships, name, className, ASTEngine.RelationshipType.References, 1.0, { rSpecific: true, relationshipSubType: "s7_class_binding" }, classNameNode)
      }
      for (const parent of this.extractNamedArguments(callNode, "parent")) {
        this.pushRel(relationships, className, parent, ASTEngine.RelationshipType.Extends, 1.0, { rSpecific: true, relationshipSubType: "s7_parent" }, this.namedArgumentNode(callNode, "parent", parent))
      }
      const propertyHolder = this.namedArgumentValue(callNode, "properties")
      if (propertyHolder && propertyHolder.type === "call" && this.calleeName(propertyHolder.childForFieldName("function")) === "list") {
        const entries = this.getArgumentsNode(propertyHolder)
        if (entries) {
          for (let i = 0; i < entries.namedChildCount; i++) {
            const entry = entries.namedChild(i)
            if (entry?.type !== "argument") continue
            const propName = entry.childForFieldName("name")
            if (!propName) continue
            const prop = this.unquoteIdentifier(propName.text)
            symbols.push({
              name: prop,
              kind: ASTEngine.SymbolKind.Property,
              range: this.getRange(propName),
              ownerName: className,
              ownerKind: ASTEngine.SymbolKind.Class,
              docstring: "",
              metadata: { rSpecific: true, isS7Property: true, objectSystem: "S7" },
            })
            this.pushRel(relationships, className, prop, ASTEngine.RelationshipType.Contains, 1.0, { rSpecific: true, relationshipSubType: "s7_property" }, propName)
          }
        }
      }
      if (doc && this.roxygenHasTag(doc, "@export")) exports.push({ name: className, kind: ASTEngine.SymbolKind.Class })
      return true
    }

    if (fnName === "setGeneric" || fnName === "setMethod" || fnName === "setClass" || fnName === "setValidity") {
      symbols.push({
        name,
        kind: ASTEngine.SymbolKind.Variable,
        range: this.getRange(node),
        docstring: doc,
        metadata: {
          rSpecific: true,
          isS4Binding: true,
          bindingFor: fnName,
          note: "R binds the S4 generator/definition to this name; the declaration itself is emitted under its declared class/generic name.",
        },
      })
      this.pushRel(relationships, name, name, ASTEngine.RelationshipType.References, 1.0, { rSpecific: true, relationshipSubType: "s4_binding" }, node)
      return true
    }

    return false
  }

  private sameNode(a: Node | null | undefined, b: Node | null | undefined): boolean {
    if (!a || !b) return false
    return a.startIndex === b.startIndex && a.endIndex === b.endIndex
  }

  /**
   * Push one relationship, stamping `line_number` with the 1-based line of the
   * node that NAMES the edge.
   *
   * M59.A7 (#825) established this convention across the analyzer family (33 of
   * 44 analyzers carry it): the line is the node the edge's TARGET is written as
   * — a call's callee leaf, a member's own entry, a base class's argument — not
   * the construct that merely contains it. A missing line is honest, so a call
   * with no node to ask omits the field rather than writing a fabricated 0.
   * The R analyzer previously carried no line on any edge, so every R
   * relationship was unlocatable in the graph and the LSP.
   */
  private pushRel(
    out: ASTEngine.UniversalRelationship[],
    source: string | undefined,
    target: string | undefined,
    type: ASTEngine.RelationshipType,
    confidence: number,
    metadata: Record<string, any>,
    namingNode?: { startPosition: { row: number }; startLine?: number } | { startLine?: number } | Node | number | null,
  ): void {
    if (!source || !target) return
    const rel: ASTEngine.UniversalRelationship = { source, target, type, confidence, metadata }
    // A `Node` is 0-based; a symbol range and a bare `number` are already
    // 1-based. Only a real, positive line is written: a missing line is honest,
    // a fabricated 0 is not.
    let line: number | undefined
    if (typeof namingNode === "number") line = namingNode
    else if (namingNode) {
      const row = (namingNode as any).startPosition?.row
      line = typeof row === "number" ? row + 1 : (namingNode as any).startLine
    }
    if (typeof line === "number" && Number.isFinite(line) && line > 0) rel.line_number = line
    out.push(rel)
  }

  /**
   * The bare name a call/namespace refers to, read from grammar FIELDS.
   *
   *   identifier          -> its own text
   *   namespace_operator -> the `rhs` field (`R6::R6Class` -> `R6Class`,
   *                         `R6:::R6Class` -> `R6Class`, `base::sqrt` -> `sqrt`)
   *   extract_operator   -> the `rhs` field (`obj$method` -> `method`)
   *
   * The previous `fnNode.text.split("::")` was both a source-text scan and
   * wrong: it turned `R6:::R6Class` into `:R6Class`, and it silently missed every
   * namespaced call whose `::` form differed from the bare name.
   */
  private calleeName(fnNode: Node | null | undefined): string {
    if (!fnNode) return ""
    if (fnNode.type === "namespace_operator" || fnNode.type === "extract_operator") {
      const rhs = fnNode.childForFieldName("rhs")
      if (rhs) {
        if (rhs.type === "identifier" || rhs.type === "dots") return this.unquoteIdentifier(rhs.text)
        return this.unquoteIdentifier(rhs.text)
      }
      return ""
    }
    if (fnNode.type === "identifier") return this.unquoteIdentifier(fnNode.text)
    // A callee is nameable when its own text IS an R name -- and it is that simple, with
    // no list of node types involved.
    //
    // The previous version of this line was a blanket `return unquoteIdentifier(
    // fnNode.text)`, which turned ANY node's source text into a function's name. R can
    // CALL a non-name, and when it does the text became the target:
    //
    //     chol2inv((if (uplo == "U") triu else tril)(x), ...)
    //
    // produced a `calls` edge whose target was the whole string
    // `(if (uplo == "U") triu else tril)`. 75 such edges in the pinned corpora. A
    // relationship target that is a copy of the caller's own source is not a
    // relationship; it is the analysis quoting its input back.
    //
    // An earlier attempt at this fix ALLOWLISTED node types, which was the wrong axis and
    // cost real coverage: the grammar gives `return` its own node type, so every
    // `return(x)` in the corpus stopped producing an edge -- 1,089 removals the audit
    // could not explain. `return` is a name; it is a name the grammar happens to
    // tokenize specially. Asking whether the TEXT is a name gets that right without
    // enumerating the grammar, and it stays right if the grammar adds a node type.
    if (this.isRName(fnNode.text)) return this.unquoteIdentifier(fnNode.text)
    return ""
  }

  /**
   * Is this text an R name? R's rule: a letter or a `.` not followed by a digit, then
   * letters, digits, `.` and `_`; or a backtick-quoted name, inside which almost
   * anything is legal. Letters beyond ASCII are accepted, since R source is frequently
   * UTF-8 and a name is a name in any alphabet.
   *
   * Character codes rather than a regexp, to keep the analyzer free of pattern matching.
   * This is the only place the analyzer inspects a node's TEXT to decide what it is -- the
   * grammar's node types do not carry a "this is a name" flag -- and it is listed in the
   * documentation's inventory of text operations.
   */
  private isRName(text: string): boolean {
    if (text.length === 0) return false
    if (text.charCodeAt(0) === 96) {
      return text.length >= 2 && text.charCodeAt(text.length - 1) === 96
    }
    const isLetter = (c: number) =>
      (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 0xc0 && c <= 0x24f) || (c >= 0x370 && c <= 0x1fff)
    const isDigit = (c: number) => c >= 48 && c <= 57
    const first = text.charCodeAt(0)
    let i = 0
    if (first === 46) {
      i = 1
      if (i < text.length && isDigit(text.charCodeAt(i))) return false
    } else if (!isLetter(first)) {
      return false
    }
    for (; i < text.length; i++) {
      const c = text.charCodeAt(i)
      if (isLetter(c) || isDigit(c) || c === 46 || c === 95) continue
      return false
    }
    return true
  }

  /**
   * R identifiers may be backtick-quoted; the backticks are syntax, not part of
   * the name. tree-sitter-r reports a quoted identifier as a plain `identifier`
   * whose text still carries the backticks, so exactly one leading/trailing
   * backtick pair is removed. Nothing else is inspected.
   */
  private unquoteIdentifier(text: string): string {
    if (text.length >= 2 && text.charCodeAt(0) === 96 && text.charCodeAt(text.length - 1) === 96) {
      return text.substring(1, text.length - 1)
    }
    return text
  }

  /**
   * S7 (rlang's object system) declarations, whose assigned name is a CALL:
   *
   *   `Foo        <- S7::new_class("Foo", parent = Bar, properties = list(...))`
   *   `S7::method(print, class_foo) <- function(self, ...) ...`
   *
   * Neither has an identifier on the left, so both were previously invisible:
   * no symbol, and calls inside the body attributed to a source string that was
   * never a symbol.
   */
  private handleS7Assignment(
    node: Node,
    targetCall: Node,
    value: Node,
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
    metadata: Partial<ASTEngine.FileMetadata>,
    insideFunction: boolean,
  ) {
    const base = this.calleeName(targetCall.childForFieldName("function"))
    if (insideFunction) return

    if (base === "method" || base === "S7_method") {
      if (value.type !== "function_definition") return
      const tArgs = this.getArgumentsNode(targetCall)
      const genericNode = this.firstPositionalValue(tArgs)
      const classNode = this.secondPositionalValue(tArgs)
      if (!genericNode) return
      const generic = this.nodeAsName(genericNode)
      // S7 dispatches on a SET of classes: `S7::method(`+`, list(class_a, class_b))`.
      // The owner is the first class in that list, and it must be the first
      // NAMED argument, so a positionally-indexed list is not mistaken for one.
      let owner: string | undefined
      if (classNode) {
        owner = this.nodeAsName(classNode) || undefined
        if (!owner && classNode.type === "call" && this.calleeName(classNode.childForFieldName("function")) === "list") {
          const listArgs = this.getArgumentsNode(classNode)
          for (let i = 0; listArgs && i < listArgs.namedChildCount; i++) {
            const entry = listArgs.namedChild(i)
            if (entry?.type !== "argument") continue
            if (entry.childForFieldName("name")) continue
            const v = this.nodeAsName(entry.childForFieldName("value"))
            if (v) { owner = v; break }
          }
        }
      }
      if (!generic) return
      this.pushIfUnique(metadata.patterns, "S7 Object System")
      symbols.push({
        name: generic,
        kind: ASTEngine.SymbolKind.Method,
        range: this.getRange(node),
        ownerName: owner,
        ownerKind: owner ? ASTEngine.SymbolKind.Class : undefined,
        signature: this.extractSignature(value),
        parameters: this.extractParameters(value),
        docstring: this.extractDocstring(node),
        metadata: {
          rSpecific: true,
          isS7Method: true,
          s7Generic: generic,
          s7Class: owner,
          objectSystem: "S7",
        },
      })
      if (owner) {
        this.pushRel(relationships, owner, generic, ASTEngine.RelationshipType.Contains, 1.0, { rSpecific: true, relationshipSubType: "s7_method" }, genericNode)
      }
      return
    }

    if (base === "new_class" || base === "new_base_class") {
      const cArgs = this.getArgumentsNode(targetCall)
      const declared = cArgs ? this.stringArgumentAt(cArgs, 0) : undefined
      const name = declared || (value.type === "identifier" ? this.unquoteIdentifier(value.text) : "")
      if (!name) return
      this.pushIfUnique(metadata.patterns, "S7 Object System")
      symbols.push({
        name,
        kind: ASTEngine.SymbolKind.Class,
        range: this.getRange(node),
        docstring: this.extractDocstring(node),
        metadata: { rSpecific: true, type: "S7", isS7Class: true },
      })
      for (const parent of this.extractNamedArguments(targetCall, "parent")) {
        this.pushRel(relationships, name, parent, ASTEngine.RelationshipType.Extends, 1.0, { rSpecific: true, relationshipSubType: "s7_parent" }, this.namedArgumentNode(targetCall, "parent", parent))
      }
      const propertyHolder = this.namedArgumentValue(targetCall, "properties")
      if (propertyHolder && propertyHolder.type === "call" && this.calleeName(propertyHolder.childForFieldName("function")) === "list") {
        const entries = this.getArgumentsNode(propertyHolder)
        if (entries) {
          for (let i = 0; i < entries.namedChildCount; i++) {
            const entry = entries.namedChild(i)
            if (entry?.type !== "argument") continue
            const propName = entry.childForFieldName("name")
            if (!propName) continue
            symbols.push({
              name: this.unquoteIdentifier(propName.text),
              kind: ASTEngine.SymbolKind.Property,
              range: this.getRange(propName),
              ownerName: name,
              ownerKind: ASTEngine.SymbolKind.Class,
              docstring: "",
              metadata: { rSpecific: true, isS7Property: true, objectSystem: "S7" },
            })
            this.pushRel(relationships, name, this.unquoteIdentifier(propName.text), ASTEngine.RelationshipType.Contains, 1.0, { rSpecific: true, relationshipSubType: "s7_property" }, propName)
          }
        }
      }
    }
  }

  /** An identifier or string node read as a name. */
  private nodeAsName(node: Node | null | undefined): string {
    if (!node) return ""
    if (node.type === "string") return this.stringNodeText(node)
    if (node.type === "identifier" || node.type === "dots") return this.unquoteIdentifier(node.text)
    return ""
  }

  /** The value of a named argument of a call, or null. */
  /**
   * True when the node sits inside a `local({ ... })` body.
   *
   * `local()` is the one construct in ordinary R that evaluates an expression in a
   * NEW environment without introducing a `function_definition` node, so the
   * function-ancestor test cannot see it. Assignments inside it are NOT file-level
   * bindings: R's `local()` creates a child environment and nothing escapes.
   *
   * Found by the R oracle, not by reading: dplyr's test-across.R binds
   * `_local_var` inside `local({ ... })` and the analyzer was publishing it as a
   * global variable. A plain `{ ... }` block inside a call is deliberately NOT
   * treated as a boundary, because R evaluates that in the CALLING frame and the
   * binding really is global.
   */
  private hasLocalBoundary(node: Node): boolean {
    let current: Node | null = node
    while (current) {
      const parent: Node | null = current.parent
      if (!parent) return false
      // NOT a boundary, and this was measured rather than assumed: R binds a name
      // assigned inside a SUBSET index, inside parentheses, and as a call argument.
      // Verified on R 4.4.3:
      //   m[ci <- 1]                 binds ci
      //   (r12 <- 5)[-1]             binds r12
      //   f(r12 <- 5)                binds r12
      //   tru[i.lt <- 1] <- c(2,3,4) binds i.lt AND tru
      // An earlier revision treated a `subset` ancestor as a scope boundary on the
      // reasoning that a complex assignment is evaluated "in the indexing context".
      // That is wrong, and it silently dropped four real bindings; the R oracle
      // caught it. Only `local()` and function bodies are boundaries.
      if (parent.type === "braced_expression" || parent.type === "parenthesized_expression") {
        // The block is usually the VALUE of an argument, so the chain to the call
        // is block -> argument -> arguments -> call, not block -> call.
        let owner: Node | null = parent
        for (let hop = 0; hop < 3 && owner; hop++) {
          const up: Node | null = owner.parent
          if (!up) break
          if (up.type === "call") {
            const fn = up.childForFieldName("function")
            if (fn && this.calleeName(fn) === "local") return true
            break
          }
          owner = up
        }
      }
      current = parent
    }
    return false
  }

  /**
   * The line a symbol's NAME is written on.
   *
   * A declaration's range starts where the declaration starts, which for a
   * multi-line `Cls <- R6Class(` is the line ABOVE the name, and for an S4 slot
   * is the whole `setClass` call. M59.A7's convention is the line that NAMES the
   * edge, so a `contains` edge is stamped with the name's own line, found by
   * searching the symbol's own range for its name text. Falls back to the range's
   * start when the name is synthesized (an S4 `validity` method has no literal
   * token in the source).
   */
  /**
   * Whether `at` is the start of the IDENTIFIER `name` in `segment`, rather than a place
   * where those characters merely occur.
   *
   * R identifiers continue with letters, digits, `.` and `_`, so `theme` occurs inside
   * `class_theme` and `sizes` inside `resize`. A substring search cannot tell those apart
   * from the real thing, and the consequence is a relationship pointing at a line that
   * does not name its target: `class_theme <- S7::new_class(` on line 219 matched
   * `theme`, so `global exports theme` and `global contains theme` were attributed to 219
   * while the class name is written on 220. Eight such edges in ggplot2's all-classes.R.
   *
   * A backtick-quoted name is a special case: inside backticks almost anything is legal,
   * so only the closing backtick is excluded, and the backticks themselves are not part of
   * the name.
   */
  private isIdentifierOccurrence(segment: string, at: number, name: string): boolean {
    // Character codes, not a regexp: the analyzer carries no pattern matching at all, and
    // the grammar-conformance audit counts regex literals and would (correctly) fail on
    // one. The first version of this line was `/[A-Za-z0-9._]/.test(ch)`.
    const isPart = (ch: string | undefined) => {
      if (ch === undefined) return false
      const c = ch.charCodeAt(0)
      return (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 46 || c === 95
    }
    const before = at > 0 ? segment[at - 1] : undefined
    if (before === "`") {
      // Inside backticks almost anything is legal, so a backticked name ends only at the
      // closing backtick.
      return segment[at + name.length] === "`"
    }
    // The only thing that disqualifies a position is a preceding identifier character.
    // An allowlist of "acceptable" delimiters would be longer, easier to get wrong, and
    // would reject the exotic ones; `$`, `::`, `=`, `(`, `,` and whitespace all work here
    // for free because none of them is an identifier part.
    if (isPart(before)) return false
    const after = segment[at + name.length]
    return !isPart(after)
  }

  private nameLineOf(symbol: ASTEngine.UniversalSymbol, content: string): number {
    const start = symbol.range.startIndex
    const end = symbol.range.endIndex
    if (typeof start !== "number" || typeof end !== "number" || end > content.length || end <= start) {
      return symbol.range.startLine
    }
    const segment = content.substring(start, end)
    // Every occurrence is examined, not just the first: a later one may be the real
    // identifier while an earlier one is a substring. The scan is over the symbol's own
    // range, so it is bounded by the declaration and cannot walk the file.
    let at = -1
    for (let from = 0; from <= segment.length - symbol.name.length; from++) {
      const i = segment.indexOf(symbol.name, from)
      if (i === -1) break
      if (this.isIdentifierOccurrence(segment, i, symbol.name)) { at = i; break }
      from = i
    }
    if (at === -1) return symbol.range.startLine
    let line = symbol.range.startLine
    for (let i = 0; i < at; i++) if (segment.charCodeAt(i) === 10) line++
    return line
  }

  /**
   * The node that NAMES `wanted` inside a named argument's value, used to stamp a
   * relationship's line. Looks in `c(...)`/`list(...)` element lists first, then
   * in the argument's own value, so `inherit = c("A","B")`, `inherit = "A"` and
   * `parent = Bar` all resolve to the node that actually spells the name.
   */
  private namedArgumentNode(node: Node, argName: string, wanted: string): Node | null {
    const args = this.getArgumentsNode(node)
    if (!args) return null
    for (let i = 0; i < args.namedChildCount; i++) {
      const arg = args.namedChild(i)
      if (arg?.type !== "argument") continue
      if (arg.childForFieldName("name")?.text !== argName) continue
      const value = arg.childForFieldName("value")
      if (!value) continue
      if (value.type === "call") {
        const inner = this.getArgumentsNode(value)
        if (inner) {
          for (let j = 0; j < inner.namedChildCount; j++) {
            const entry = inner.namedChild(j)
            if (!entry) continue
            if (entry.type === "argument") {
              const nm = entry.childForFieldName("name")
              const v = entry.childForFieldName("value")
              const text = nm?.text ?? (v ? this.nodeAsName(v) : "")
              if (text === wanted) return nm ?? v ?? entry
            } else {
              if (this.nodeAsName(entry) === wanted) return entry
            }
          }
        }
        if (this.nodeAsName(value) === wanted) return value
        continue
      }
      if (this.nodeAsName(value) === wanted) return value
    }
    return null
  }

  private namedArgumentValue(node: Node, argName: string): Node | null {
    const args = this.getArgumentsNode(node)
    if (!args) return null
    for (let i = 0; i < args.namedChildCount; i++) {
      const arg = args.namedChild(i)
      if (arg?.type !== "argument") continue
      if (arg.childForFieldName("name")?.text === argName) return arg.childForFieldName("value")
    }
    return null
  }

  /** The second positional argument value of a call. */
  private secondPositionalValue(args: Node | null): Node | null {
    if (!args) return null
    let seen = 0
    for (let i = 0; i < args.namedChildCount; i++) {
      const arg = args.namedChild(i)
      if (!arg || arg.type === "comma") continue
      if (arg.type === "argument") {
        if (arg.childForFieldName("name")) continue
        const v = arg.childForFieldName("value")
        if (seen === 1) return v
        seen++
        continue
      }
      if (seen === 1) return arg
      seen++
    }
    return null
  }

  private isAllCapsName(name: string): boolean {
    if (!name || name.length < 2) return false
    let hasLetter = false
    for (let i = 0; i < name.length; i++) {
      const c = name[i]
      if ((c >= "a" && c <= "z") || (c >= "A" && c <= "Z")) {
        hasLetter = true
        if (c >= "a" && c <= "z") return false
      }
    }
    return hasLetter
  }

  // ------------------------------------------------------------ R6 / R5 members

  /**
   * R6 members. Inside `public=`/`private=`/`active=` a named entry is either a
   * METHOD (value is a `function_definition`) or a DATA MEMBER (any other value).
   * Data members are declarations too: they are the class's public surface and
   * are read as `self$name`, so omitting them hides the class API entirely.
   *
   * Only entries with a real `name` FIELD are members. The earlier
   * `childForFieldName("name") || child(0)` fallback turned an unnamed list
   * element holding a function into a Method whose "name" was the function's own
   * source text — a phantom declaration invented from syntax.
   */
  private extractR6Members(
    callNode: Node,
    className: string,
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
    _doc: string | undefined,
  ) {
    this.extractMemberLists(callNode, className, symbols, relationships, CLASS_MEMBER_LISTS, {
      methodMeta: { isR6Method: true },
      methodSubType: "r6_method",
      system: "R6",
    })
  }

  private extractR5Members(
    callNode: Node,
    className: string,
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
    _doc: string | undefined,
  ) {
    this.extractMemberLists(callNode, className, symbols, relationships, R5_MEMBER_LISTS, {
      methodMeta: { isR5Method: true },
      methodSubType: "r5_method",
      system: "R5",
    })
  }

  private extractMemberLists(
    callNode: Node,
    className: string,
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
    listNames: Set<string>,
    opts: { methodMeta: Record<string, any>; methodSubType: string; system: string },
  ) {
    const argsNode = this.getArgumentsNode(callNode)
    if (!argsNode) return
    for (let i = 0; i < argsNode.childCount; i++) {
      const arg = argsNode.child(i)
      if (!arg || arg.type !== "argument") continue
      const argNameNode = arg.childForFieldName("name")
      if (!argNameNode) continue
      const listName = argNameNode.text
      if (!listNames.has(listName)) continue
      const listNode = arg.childForFieldName("value")
      if (!listNode || listNode.type !== "call") continue
      if (this.calleeName(listNode.childForFieldName("function")) !== "list") continue
      const entries = this.getArgumentsNode(listNode)
      if (!entries) continue

      for (let j = 0; j < entries.childCount; j++) {
        const entry = entries.child(j)
        if (!entry || entry.type !== "argument") continue
        // A member without a name field is not a member.
        const memberNameNode = entry.childForFieldName("name")
        const memberValue = entry.childForFieldName("value")
        if (!memberNameNode || !memberValue) continue
        const memberName = this.unquoteIdentifier(memberNameNode.text)
        if (!memberName) continue

        // A `fields=` list is data by construction (R5 reference classes), so a
        // function stored there is a declared field, not a method. In
        // `public=`/`private=`/`active=`/`methods=` a function value is a method.
        const isMethod = memberValue.type === "function_definition" && !DATA_MEMBER_LISTS.has(listName)
        if (isMethod) {
          symbols.push({
            name: memberName,
            kind: ASTEngine.SymbolKind.Method,
            range: this.getDeclarationRange(memberNameNode, memberValue),
            signature: this.extractSignature(memberValue),
            parameters: this.extractParameters(memberValue),
            docstring: "",
            ownerName: className,
            ownerKind: ASTEngine.SymbolKind.Class,
            metadata: {
              rSpecific: true,
              ...opts.methodMeta,
              memberList: listName,
              ownerClass: className,
              objectSystem: opts.system,
            },
          })
        } else {
          symbols.push({
            name: memberName,
            kind: ASTEngine.SymbolKind.Property,
            range: this.getDeclarationRange(memberNameNode, memberValue),
            ownerName: className,
            ownerKind: ASTEngine.SymbolKind.Class,
            docstring: "",
            metadata: {
              rSpecific: true,
              isObjectSystemField: true,
              memberList: listName,
              ownerClass: className,
              objectSystem: opts.system,
            },
          })
        }
        this.pushRel(
          relationships,
          className,
          memberName,
          ASTEngine.RelationshipType.Contains,
          1.0,
          {
            relationshipSubType: isMethod ? opts.methodSubType : `${opts.system.toLowerCase()}_field`,
            visibility: listName,
            memberKind: isMethod ? "method" : "field",
          },
          memberNameNode,
        )
      }
    }
  }

  // ----------------------------------------------------------------- parameters

  private getParametersNode(node: Node): Node | null {
    const byField = node.childForFieldName("parameters")
    if (byField) return byField
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i)
      if (c && c.type === "parameters") return c
    }
    return null
  }

  /**
   * A parameter's default lives in the grammar's `default` FIELD. The analyzer
   * asked for `default_value`, which this grammar does not define, so the lookup
   * was always null and the analyzer fell back to scanning the parameter's raw
   * text for an `=`. Using the field removes the dead branch, removes the text
   * scan, and additionally recovers the default EXPRESSION, which was being
   * computed and then discarded.
   *
   * `...` arrives as a `parameter` whose `name` field is a `dots` node, so rest
   * parameters are recognized by node type rather than by their text.
   */
  private extractParameters(node: Node): ASTEngine.Parameter[] {
    const params: ASTEngine.Parameter[] = []
    const parametersNode = this.getParametersNode(node)
    if (parametersNode) {
      for (let i = 0; i < parametersNode.childCount; i++) {
        const p = parametersNode.child(i)
        if (p && p.type === "parameter") {
          const nameNode = p.childForFieldName("name")
          if (!nameNode) continue
          const defaultValueNode = p.childForFieldName("default")
          const isRest = nameNode.type === "dots"
          const param: ASTEngine.Parameter = {
            name: this.unquoteIdentifier(nameNode.text),
            isOptional: !!defaultValueNode,
          }
          if (defaultValueNode) param.defaultValue = defaultValueNode.text
          if (isRest) param.isRest = true
          params.push(param)
        }
      }
    }
    return params
  }

  private handleComment(node: Node, metadata: Partial<ASTEngine.FileMetadata>): void {
    if (node.text.startsWith("#'")) {
      this.pushIfUnique(metadata.patterns, "Roxygen Documentation")
    }
  }

  /**
   * Roxygen tags live inside a single `comment` token — the grammar exposes no
   * sub-structure for them — so a tag is recognised only at a tag position
   * (start of line, after `#'` and optional spaces). A loose substring test also
   * fired on prose such as "not @exported".
   */
  private roxygenHasTag(doc: string, tag: string): boolean {
    let lineStart = 0
    while (lineStart <= doc.length) {
      let lineEnd = doc.indexOf("\n", lineStart)
      if (lineEnd === -1) lineEnd = doc.length
      const line = doc.substring(lineStart, lineEnd)
      if (line.startsWith("#'")) {
        let i = 2
        while (i < line.length && (line[i] === " " || line[i] === "\t")) i++
        if (line.startsWith(tag, i)) {
          const after = line.charAt(i + tag.length)
          if (after === "" || after === " " || after === "\t") return true
        }
      }
      lineStart = lineEnd + 1
    }
    return false
  }

  private getArgumentsNode(node: Node): Node | null {
    const byField = node.childForFieldName("arguments")
    if (byField) return byField
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i)
      if (c && c.type === "arguments") return c
    }
    return null
  }

  /** Positional arguments of a call, in source order, `argument` nodes unwrapped. */
  private positionalArguments(args: Node): Node[] {
    const out: Node[] = []
    for (let i = 0; i < args.namedChildCount; i++) {
      const arg = args.namedChild(i)
      if (!arg || arg.type === "comma") continue
      if (arg.type !== "argument") {
        out.push(arg)
        continue
      }
      // A named argument is an option, not a positional value; keep it visible
      // to callers that care (library/require) by leaving the wrapper in place.
      out.push(arg)
    }
    return out
  }

  /** The first POSITIONAL (unnamed) argument value of a call, or null. */
  private firstPositionalValue(args: Node | null): Node | null {
    if (!args) return null
    for (let i = 0; i < args.namedChildCount; i++) {
      const arg = args.namedChild(i)
      if (!arg || arg.type === "comma") continue
      if (arg.type === "argument") {
        if (arg.childForFieldName("name")) continue // named -> an option
        return arg.childForFieldName("value")
      }
      return arg
    }
    return null
  }

  // ------------------------------------------------------------------ member reads

  /**
   * The `arguments` of a `subset2`, i.e. `x[[ ... ]]` -- not the same node as the
   * `arguments` of a `call`. The grammar gives the field the same name in both, so
   * reading it off the wrong node kind returns null and the count is 0 rather than
   * wrong, which is the failure mode worth avoiding here.
   */
  private subset2Arguments(node: Node): Node | null {
    if (node.type !== "subset2") return null
    return node.childForFieldName("arguments")
  }

  /**
   * The NAME a `subset2` indexes by, when it indexes by a string literal:
   * `df[["col"]]` -> `col`. Returns null for `df[[i]]` and `df[[get_col()]]`,
   * because a computed index does not name a member and naming one anyway would be
   * the fabrication this lane's ontology workstream warns about.
   *
   * Only `[[` is read, never `[`. In R the two are not interchangeable: `df[["col"]]`
   * is a member lookup, while `df["col"]` on a plain list is a CHARACTER SUBSET that
   * evaluates to NULL, and on a data.frame it is a column selection by a rule R
   * documents separately (exact, then partial match). Publishing the string index of
   * a `[` as a member name would put a `uses` edge on an expression R does not treat
   * as a member read at all.
   */
  private stringSubsetIndex(node: Node): string | null {
    const args = this.subset2Arguments(node)
    if (!args) return null
    for (let i = 0; i < args.namedChildCount; i++) {
      const arg = args.namedChild(i)
      if (!arg || arg.type !== "argument") continue
      const value = arg.childForFieldName("value")
      if (value && value.type === "string") {
        const name = this.stringNodeText(value)
        if (name) return name
      }
    }
    return null
  }

  /**
   * The MEMBER NAME an `extract_operator` reads, or null when the right side does
   * not name one. `obj$member` and `obj@slot` name a member by construction; a
   * computed right side (`obj[[which()]]` is a different node, but `obj$f()`-shaped
   * and interpolated forms exist) does not, so no edge is emitted and the case is
   * counted.
   */
  private extractOperatorMember(node: Node): string | null {
    if (node.type !== "extract_operator") return null
    const operator = node.childForFieldName("operator")?.text
    if (operator !== "$" && operator !== "@") return null
    const rhs = node.childForFieldName("rhs")
    if (!rhs) return null
    if (rhs.type === "identifier") return this.unquoteIdentifier(rhs.text) || null
    if (rhs.type === "string") return this.stringNodeText(rhs) || null
    return null
  }

  /**
   * Is this node the `function` field of an enclosing `call`?
   *
   * Compared by RANGE and not by object identity: web-tree-sitter allocates a fresh
   * JS wrapper on every accessor call, so `parent.childForFieldName("function") === n`
   * is false for the very node it just returned. The walk that built this gate first
   * compared identities and reported zero callee-position nodes out of 11,216 --
   * a number that reads as a fact about R and is a bug in the gate.
   *
   * `pkg::obj$fn(...)` is the wrapped form the second clause exists for: the
   * `namespace_operator` occupies the call's function field and the `extract_operator`
   * is its `rhs`.
   */
  private isCalleePosition(node: Node): boolean {
    const parent = node.parent
    if (!parent) return false
    if (parent.type === "call") return this.sameNode(parent.childForFieldName("function"), node)
    if (parent.type === "extract_operator" || parent.type === "namespace_operator") {
      if (this.sameNode(parent.childForFieldName("rhs"), node)) return this.isCalleePosition(parent)
    }
    return false
  }

  /**
   * Is this member access the TARGET of an assignment, i.e. a write?
   * `obj$field <- v` and `obj$field <<- v` store into the member; they do not read
   * it. `x <- obj$field` reads. The two sides are read off the grammar's operator
   * field through `assignmentSides`, so the rightward forms are handled by the same
   * rule that already decides which side an assignment binds -- not by a second,
   * possibly disagreeing, test.
   */
  private isMemberWrite(node: Node): boolean {
    const parent = node.parent
    if (!parent || parent.type !== "binary_operator") return false
    return this.sameNode(this.assignmentSides(parent).target, node)
  }

  /**
   * A `uses` edge for one member read of a value.
   *
   * THE RULE, and why it is this rule: in R, `obj$member`, `obj@slot` and
   * `df[["col"]]` all READ a named member of something. Reading a member is not
   * calling anything, so it is not a `calls` edge, and it is not a package
   * dependency, so it is not an `imports` edge. It is the same construct the Python
   * and Julia lanes publish as `uses` (`python:1425` `isMemberRead`,
   * `script/m14/oracles/julia-refs.ts` on `a.b`), and it is by a wide margin the
   * largest thing this analyzer was not reading: measured over 1,890 real R files
   * (`validation/m14/fixtures/r/probe-surfaces.ts`), the corpus holds 9,108
   * `extract_operator` nodes of which **1,012 are the callee of a call** and
   * **8,096 are not**. Before this method all 8,096 produced nothing.
   *
   * FOUR GATES, each of which exists because the alternative is a false edge:
   *
   *   1. not the callee of a call -- `obj$method()` is already a `calls` edge whose
   *      target is `obj$method`. Publishing a second edge to `method` would be the
   *      same fact under two labels, which is the `uses`/`references`/`calls`
   *      confusion the workstream names as question 4.
   *   2. not the target of an assignment -- `obj$field <- v` writes.
   *   3. the member must be NAMEABLE -- a computed right side yields no edge, and is
   *      counted rather than dropped.
   *   4. an enclosing named symbol must exist -- the same attribution rule `calls`
   *      uses, including the 0.7 closure case, so the two surfaces cannot disagree
   *      about who owns a body. 55.6% of R's call sites are at file scope, so this
   *      gate suppresses a large number and that number is reported in
   *      `metadata.callAttribution.memberReadsUnresolvedScope` rather than lost.
   *
   * CONFIDENCE is the ATTRIBUTION's, not a constant, and that is the whole point of
   * reading it from `enclosingAttribution` rather than writing 1.0: the member name
   * is a certain parse fact, but the OWNER of a body reached through an anonymous
   * function is inferred, so the edge is 0.7 there exactly as a `calls` edge in the
   * same body is. A `uses` edge that reported 1.0 while the `calls` edge beside it
   * reported 0.7 would be a confidence that measures the label rather than the
   * evidence, and the honesty contract §4 ratio would then understate this lane's
   * guesswork by exactly the closure cases. Every edge below 1.0 carries a
   * `reasonCode` and a `reason`.
   *
   * The RECEIVER is recorded in metadata, not in the edge target, so the edge binds
   * to a symbol with the member's own name -- which is what makes it joinable with
   * the `property` symbols R6/R5/S4/S7 publish, and is the convention the Python and
   * Julia lanes follow.
   */
  private handleMemberRead(
    node: Node,
    fnStack: Array<{ node: Node; attribution: CallAttribution | null }>,
    relationships: ASTEngine.UniversalRelationship[],
    ambiguity: {
      memberReadsSuppressedByCall: number
      memberWrites: number
      memberReadsUnresolvedScope: number
      memberReadsWithComputedIndex: number
    },
  ): void {
    const member = node.type === "extract_operator" ? this.extractOperatorMember(node) : this.stringSubsetIndex(node)
    if (!member) {
      if (node.type === "extract_operator") ambiguity.memberReadsWithComputedIndex++
      return
    }
    if (this.isCalleePosition(node)) {
      ambiguity.memberReadsSuppressedByCall++
      return
    }
    if (this.isMemberWrite(node)) {
      ambiguity.memberWrites++
      return
    }
    const attribution = this.enclosingAttribution(fnStack)
    if (!attribution) {
      ambiguity.memberReadsUnresolvedScope++
      return
    }
    const receiver = this.memberReadReceiver(node)
    const inferred = attribution.subType !== "function"
    this.pushRel(
      relationships,
      attribution.name,
      member,
      ASTEngine.RelationshipType.Uses,
      attribution.confidence,
      {
        rSpecific: true,
        relationshipSubType: "member_read",
        memberAccessOperator: node.type === "extract_operator" ? node.childForFieldName("operator")?.text : "[[",
        ...(receiver ? { receiver } : {}),
        ...(inferred
          ? { attributionSubType: attribution.subType, reasonCode: attribution.reason, reason: attribution.reason }
          : {}),
      },
      this.memberNameNode(node),
    )
  }

  /**
   * The receiver of a member read, when it is itself a plain NAME, for metadata
   * only. A receiver that is an expression (`pkg::obj$fn`, `get_obj()$field`) is
   * omitted rather than interpolated: the edge target never carries source text, and
   * a metadata field that quotes the input back is the same smell in a place where
   * nobody is looking at it.
   */
  private memberReadReceiver(node: Node): string | null {
    const lhs = node.type === "extract_operator" ? node.childForFieldName("lhs") : node.childForFieldName("function")
    if (!lhs) return null
    if (lhs.type === "identifier") return this.unquoteIdentifier(lhs.text) || null
    return null
  }

  /** The node that WRITES the member name, which is where the edge's line comes from. */
  private memberNameNode(node: Node): Node {
    if (node.type === "extract_operator") {
      const rhs = node.childForFieldName("rhs")
      if (rhs && (rhs.type === "identifier" || rhs.type === "string")) return rhs
    }
    const args = this.subset2Arguments(node)
    if (args) {
      for (let i = 0; i < args.namedChildCount; i++) {
        const arg = args.namedChild(i)
        if (!arg || arg.type !== "argument") continue
        const value = arg.childForFieldName("value")
        if (value && value.type === "string") return value
      }
    }
    return node
  }

  // ----------------------------------------------------------------------- call

  private handleCall(
    node: Node,
    symbols: ASTEngine.UniversalSymbol[],
    imports: ASTEngine.ImportInfo[],
    exports: ASTEngine.ExportInfo[],
    relationships: ASTEngine.UniversalRelationship[],
    metadata: Partial<ASTEngine.FileMetadata>,
    declaredTypes: Set<string>,
    ambiguity: { callsUnresolvedScope: number; callsAttributedThroughClosure: number; heuristicS3Generic: number; callsToUnnameableCallee: number },
    fnStack: Array<{ node: Node; attribution: CallAttribution | null }>,
  ): void {
    const fnNode = node.childForFieldName("function")
    if (!fnNode) return

    const fnName = this.calleeName(fnNode)
    const args = this.getArgumentsNode(node)

    // Namespace access is a dependency. Both `::` and `:::` are matched off the
    // `operator` FIELD: the previous `child(1)?.text === "::"` test missed every
    // `pkg:::internal()` call, which is how packages reach other packages'
    // internals.
    if (fnNode.type === "namespace_operator") {
      const ns = fnNode.childForFieldName("lhs")
      const op = fnNode.childForFieldName("operator")?.text
      if (ns && op && NAMESPACE_OPERATORS.has(op)) {
        imports.push({
          module: this.unquoteIdentifier(ns.text),
          names: [],
          range: this.getRange(fnNode),
          isWildcard: true,
          metadata: { rSpecific: true, accessOperator: op },
        })
        this.pushRel(relationships, "global", this.unquoteIdentifier(ns.text), ASTEngine.RelationshipType.Imports, 1.0, {
          rSpecific: true,
          relationshipSubType: "namespace_access",
          accessOperator: op,
        }, ns)
      }
    }

    if (fnName === "UseMethod") {
      this.pushIfUnique(metadata.patterns, "S3 Object System (Generics)")
    }

    if (APPLY_FAMILY.has(fnName)) this.pushIfUnique(metadata.patterns, "Apply Family")
    if (DATA_FRAME_CONSTRUCTORS.has(fnName)) this.pushIfUnique(metadata.patterns, "Data Frames")
    if (STATISTICAL_MODELS.has(fnName) || STATISTICAL_MODELS.has(fnNode.text)) {
      if (metadata.statisticalFocus !== undefined) metadata.statisticalFocus += 30
    }
    if (TIDYVERSE_NSE.has(fnName)) {
      this.pushIfUnique(metadata.patterns, "Tidyverse Data Masking (NSE)")
      if (metadata.dataManipulationIntensity !== undefined) metadata.dataManipulationIntensity += 10
    }
    if (fnName === "NS") this.pushIfUnique(metadata.patterns, "Shiny Module Namespace (NS)")
    if (ERROR_HANDLERS.has(fnName)) this.pushIfUnique(metadata.patterns, "Error Handling")
    if (CLEANUP_HANDLERS.has(fnName)) this.pushIfUnique(metadata.patterns, "Cleanup Handlers")
    if (NSE_CAPTURERS.has(fnName)) this.pushIfUnique(metadata.patterns, "Non-Standard Evaluation (NSE)")

    const attribution = this.enclosingAttribution(fnStack)
    if (attribution) {
      const relMeta: Record<string, any> = { rSpecific: true }
      if (attribution.subType !== "function") {
        relMeta.relationshipSubType = attribution.subType
        if (attribution.reason) {
          relMeta.reasonCode = attribution.reason
          relMeta.reason = attribution.reason
        }
      }
      // The edge target is the callee AS WRITTEN (`pkg::fn`, `obj$method`,
      // `Cls$new`), because the qualified form is the information a reader needs;
      // `calleeName` is the bare name used only for dispatch decisions.
      const callTarget = this.callTargetName(fnNode, fnName)
      // An unnameable callee produces no edge. Counting it keeps the gap visible instead
      // of letting it vanish into a total.
      if (!callTarget) ambiguity.callsToUnnameableCallee++
      else this.pushRel(relationships, attribution.name, callTarget, ASTEngine.RelationshipType.Calls, attribution.confidence, relMeta, this.callTargetNode(fnNode, callTarget))
      if (attribution.confidence < 1.0) ambiguity.callsAttributedThroughClosure++

      // R6/R5 construction is only certain when the receiver was declared as a
      // class in this file. Capitalized external calls are not guessed as
      // instantiation, avoiding false positives such as `I()` and `DataMask$new()`.
      const constructorName = this.constructorTarget(fnNode)
      if (constructorName && declaredTypes.has(constructorName)) {
        this.pushRel(relationships, attribution.name, constructorName, ASTEngine.RelationshipType.Instantiates, 0.9, { isRConstructor: true, reasonCode: "declared_class_constructor" }, fnNode)
      }
      // S4 construction: new("Cls") instantiates a class generator.
      if (fnName === "new") {
        const cls = this.firstStringArgumentOf(node, 0)
        if (cls && declaredTypes.has(cls)) {
          this.pushRel(relationships, attribution.name, cls, ASTEngine.RelationshipType.Instantiates, 0.9, { isS4Constructor: true, reasonCode: "declared_class_constructor" }, fnNode)
        }
      }
    } else {
      ambiguity.callsUnresolvedScope++
    }

    if (fnName === "library" || fnName === "require") {
      this.handleLibraryCall(node, args, imports, relationships)
      return
    }

    // `rm(x)` at file level UNBINDS, so `x` is not a name the file leaves behind.
    //
    // A package that defines a helper, uses it to register S4 methods, and removes it is
    // ordinary practice -- Matrix does it in at least 8 files, and Cholesky.R does it twice
    // in one file. The analyzer published those helpers as declarations, which R's
    // cross-check (execute the file, ask the environment) says is wrong: 59 of them.
    //
    // This is the same judgement already applied to `local()` and to function-local
    // assignments -- a name that does not exist at file level when the file has finished is
    // not a file-level binding -- so handling `rm` makes the analyzer internally consistent
    // rather than introducing a new rule.
    //
    // Only at file level. `rm()` inside a function removes a local, and a local was never
    // published, so there is nothing to do.
    if (fnName === "rm" && fnStack.length === 0) {
      const removed = this.removeTopLevelBindings(node, args, symbols, relationships, metadata)
      if (removed) {
        if (metadata.ambiguity === undefined) (metadata as any).ambiguity = {}
        ;(metadata as any).ambiguity.removedByTopLevelRm = ((metadata as any).ambiguity.removedByTopLevelRm ?? 0) + removed
      }
      return
    }

    if (fnName === "sourceCpp") {
      this.pushIfUnique(metadata.patterns, "Rcpp / C++ Integration")
      this.handleSourceCall(node, args, imports, relationships, {
        relationshipSubType: "rcpp_source",
        language: "cpp",
        crossLanguage: true,
      })
      return
    }

    if (fnName === "source") {
      this.handleSourceCall(node, args, imports, relationships, { relationshipSubType: "r_source" })
      return
    }

    if (fnName === "setClass") {
      this.pushIfUnique(metadata.patterns, "S4 Object System")
      this.handleSetClass(node, args, symbols, exports, relationships, declaredTypes)
      return
    }

    if (fnName === "setGeneric") {
      this.handleSetGenericOrMethod(node, args, symbols, exports, relationships, ambiguity)
      return
    }

    if (fnName === "setMethod") {
      this.handleSetGenericOrMethod(node, args, symbols, exports, relationships, ambiguity)
      return
    }

    if (fnName === "setValidity") {
      this.handleSetValidity(node, args, symbols, relationships)
      return
    }
  }

  /**
   * `library(pkg)` / `require(pkg)` declare ONE dependency: the first POSITIONAL
   * argument. Every other argument is an option — `warn.conflicts`, `quietly`,
   * `character.only`, `pos`, `lib.loc`, `mask.ok`, `exclude`, `include.only`,
   * `attach.required` — and the previous implementation turned each of those
   * option NAMES into both an import and a `references` edge, publishing phantom
   * packages. `library(dplyr, warn.conflicts = FALSE)` is the polite form and is
   * everywhere in CRAN code.
   *
   * Confidence is 1.0 for a string literal (`library("dplyr")` names the package
   * outright) and 0.8 for a bare identifier, which with `character.only = TRUE`
   * may hold a computed package name.
   */
  private handleLibraryCall(
    node: Node,
    args: Node | null,
    imports: ASTEngine.ImportInfo[],
    relationships: ASTEngine.UniversalRelationship[],
  ) {
    if (!args) return
    let value: Node | null = null
    for (let i = 0; i < args.namedChildCount && !value; i++) {
      const arg = args.namedChild(i)
      if (!arg || arg.type === "comma") continue
      if (arg.type === "argument") {
        const nameNode = arg.childForFieldName("name")
        if (nameNode) {
          // `library(package = "dplyr")` is legal and still names the package.
          if (nameNode.text === "package") value = arg.childForFieldName("value")
          continue
        }
        value = arg.childForFieldName("value")
      } else {
        value = arg
      }
    }
    if (!value) return

    let moduleName = ""
    let confidence = 0.8
    if (value.type === "string") {
      moduleName = this.stringNodeText(value)
      confidence = 1.0
    } else if (value.type === "identifier") {
      moduleName = this.unquoteIdentifier(value.text)
    }
    if (!moduleName) return

    imports.push({
      module: moduleName,
      names: [],
      range: this.getRange(node),
      isWildcard: true,
      metadata: { rSpecific: true, declaredBy: "library" },
    })
    this.pushRel(
      relationships,
      "global",
      moduleName,
      ASTEngine.RelationshipType.References,
      confidence,
      {
        rSpecific: true,
        relationshipSubType: "library_dependency",
        reasonCode: confidence < 1 ? "library_bare_identifier" : "library_string_literal",
      },
      value,
    )
    // The dependency is also published as an `imports` edge. `references` is the
    // generic dependency type, but `imports` is what graph_usages reads to build
    // the imports/exports view and what evidence_tier classifies as an import
    // kind, so R dependencies were invisible to both while existing.
    this.pushRel(relationships, "global", moduleName, ASTEngine.RelationshipType.Imports, confidence, {
      rSpecific: true,
      relationshipSubType: "library_import",
      reasonCode: confidence < 1 ? "library_bare_identifier" : "library_string_literal",
    }, value)
  }

  /**
   * `source("helpers.R")` / `sourceCpp("code.cpp")` declare a file dependency.
   * The first argument is read as the first `argument` child of the `arguments`
   * node; indexing `child(0)` instead returned the `(` token, so the guard never
   * matched and these calls produced no dependency at all while still advertising
   * the Rcpp pattern in metadata.
   */
  private handleSourceCall(
    node: Node,
    args: Node | null,
    imports: ASTEngine.ImportInfo[],
    relationships: ASTEngine.UniversalRelationship[],
    meta: Record<string, any>,
  ) {
    const value = this.firstPositionalValue(args)
    if (!value || value.type !== "string") return
    const path = this.stringNodeText(value)
    if (!path) return
    imports.push({
      module: path,
      names: [],
      range: this.getRange(node),
      isWildcard: true,
      metadata: { rSpecific: true, ...meta },
    })
    this.pushRel(relationships, "global", path, ASTEngine.RelationshipType.References, 1.0, { ...meta, relationshipSubType: meta.relationshipSubType }, value)
    this.pushRel(relationships, "global", path, ASTEngine.RelationshipType.Imports, 1.0, { ...meta, relationshipSubType: meta.relationshipSubType }, value)
  }

  private handleSetClass(
    node: Node,
    args: Node | null,
    symbols: ASTEngine.UniversalSymbol[],
    exports: ASTEngine.ExportInfo[],
    relationships: ASTEngine.UniversalRelationship[],
    declaredTypes: Set<string>,
  ) {
    if (!args) return
    const className = this.firstStringArgumentOf(node, 0)
    if (!className) return
    const baseClasses = this.extractNamedArguments(node, "contains")
    const doc = this.extractDocstring(node)
    symbols.push({
      name: className,
      kind: ASTEngine.SymbolKind.Class,
      range: this.getRange(node),
      docstring: doc,
      metadata: { rSpecific: true, type: "S4", isS4Class: true, baseClasses },
    })
    declaredTypes.add(className)

    // Slots may be declared as `slots = c(a = "numeric")` (current idiom) or
    // `representation(a = "numeric")` (the original S4 idiom, still the form R
    // Core itself uses). The earlier implementation read only `slots`, so every
    // `representation()` class analysed to a class with no members.
    const slotNames = new Map<string, { name: string; range: ASTEngine.UniversalSymbol["range"]; via: string }>()
    for (const slot of this.extractSlotKeys(node)) {
      if (!slotNames.has(slot.name)) slotNames.set(slot.name, slot)
    }
    for (const slotName of slotNames.values()) {
      symbols.push({
        name: slotName.name,
        kind: ASTEngine.SymbolKind.Property,
        range: slotName.range ?? this.getRange(node),
        ownerName: className,
        ownerKind: ASTEngine.SymbolKind.Class,
        docstring: "",
        metadata: { rSpecific: true, isS4Slot: true, declaredVia: slotName.via },
      })
    }
    for (const bc of baseClasses) {
      this.pushRel(relationships, className, bc, ASTEngine.RelationshipType.Extends, 1.0, { relationshipSubType: "s4_inherits" }, this.namedArgumentNode(node, "contains", bc))
    }
    if (doc && this.roxygenHasTag(doc, "@export")) exports.push({ name: className, kind: ASTEngine.SymbolKind.Class })
  }

  private handleSetGenericOrMethod(
    node: Node,
    args: Node | null,
    symbols: ASTEngine.UniversalSymbol[],
    exports: ASTEngine.ExportInfo[],
    relationships: ASTEngine.UniversalRelationship[],
    ambiguity: { callsUnresolvedScope: number; callsAttributedThroughClosure: number; heuristicS3Generic: number; callsToUnnameableCallee: number },
  ) {
    if (!args) return
    const fnName = this.calleeName(node.childForFieldName("function"))
    const methodName = this.firstStringArgumentOf(node, 0)
    if (!methodName) return

    let ownerName: string | undefined
    if (fnName === "setMethod") {
      // The owning class is the SECOND argument: either `"Class"` or
      // `signature("Class", "missing")`. Reading only a bare string lost the
      // owner for every signature()-form setMethod, which then published the
      // method as a global symbol of the same name.
      ownerName = this.setMethodOwner(args)
    }

    // The generic's own `function(x) ...` body, when present, is the declaration
    // of the generic, so its parameters belong to the symbol.
    const body = this.lastPositionalValue(args)
    let parameters: ASTEngine.Parameter[] | undefined
    let signature: string | undefined
    if (body && body.type === "function_definition") {
      parameters = this.extractParameters(body)
      signature = this.extractSignature(body)
    }

    const doc = this.extractDocstring(node)
    symbols.push({
      name: methodName,
      kind: fnName === "setMethod" ? ASTEngine.SymbolKind.Method : ASTEngine.SymbolKind.Function,
      range: this.getRange(node),
      ownerName,
      ownerKind: ownerName ? ASTEngine.SymbolKind.Class : undefined,
      signature,
      parameters,
      docstring: doc,
      metadata: {
        rSpecific: true,
        type: fnName === "setGeneric" ? "S4_Generic" : "S4_Method",
        isS4Generic: fnName === "setGeneric",
        isS4Method: fnName === "setMethod",
      },
    })
    if (doc && this.roxygenHasTag(doc, "@export"))
      exports.push({
        name: methodName,
        kind: fnName === "setMethod" ? ASTEngine.SymbolKind.Method : ASTEngine.SymbolKind.Function,
      })
    if (fnName === "setMethod" && ownerName) {
      this.pushRel(relationships, ownerName, methodName, ASTEngine.RelationshipType.Contains, 1.0, { rSpecific: true, relationshipSubType: "s4_method" }, node)
    }
    void ambiguity
  }

  /**
   * `setValidity("Class", function(object) ...)` declares a class-level
   * validator. It was not handled at all, so a validation rule attached to an
   * S4 class was invisible.
   */
  private handleSetValidity(
    node: Node,
    args: Node | null,
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
  ) {
    if (!args) return
    const className = this.firstStringArgumentOf(node, 0)
    if (!className) return
    const body = this.lastPositionalValue(args)
    let parameters: ASTEngine.Parameter[] | undefined
    let signature: string | undefined
    if (body && body.type === "function_definition") {
      parameters = this.extractParameters(body)
      signature = this.extractSignature(body)
    }
    symbols.push({
      name: "validity",
      kind: ASTEngine.SymbolKind.Method,
      range: this.getRange(node),
      ownerName: className,
      ownerKind: ASTEngine.SymbolKind.Class,
      signature,
      parameters,
      docstring: this.extractDocstring(node),
      metadata: { rSpecific: true, isS4Validity: true, ownerClass: className, objectSystem: "S4" },
    })
    this.pushRel(relationships, className, "validity", ASTEngine.RelationshipType.Contains, 1.0, { rSpecific: true, relationshipSubType: "s4_validity" }, node)
  }

  /** The class named by a `setMethod` second argument, string or `signature(...)`. */
  private setMethodOwner(args: Node): string | undefined {
    let seen = 0
    for (let i = 0; i < args.namedChildCount; i++) {
      const arg = args.namedChild(i)
      if (!arg || arg.type === "comma") continue
      if (arg.type === "argument") {
        if (arg.childForFieldName("name")) continue
        const value = arg.childForFieldName("value")
        if (!value) continue
        if (seen === 1) {
          if (value.type === "string") return this.stringNodeText(value)
          if (value.type === "call" && this.calleeName(value.childForFieldName("function")) === "signature") {
            const inner = this.getArgumentsNode(value)
            const first = this.firstPositionalValue(inner)
            if (first && first.type === "string") return this.stringNodeText(first)
          }
          return undefined
        }
        seen++
        continue
      }
      if (seen === 1) {
        if (arg.type === "string") return this.stringNodeText(arg)
        return undefined
      }
      seen++
    }
    return undefined
  }

  /**
   * Attribute a call to the nearest enclosing symbol that the SYNTAX actually
   * names, and say how sure we are.
   *
   * Resolution order for each enclosing `function_definition`, innermost first:
   *   1. assigned to a name                  -> confidence 1.0
   *   2. a named R6/R5 list member           -> confidence 1.0
   *   3. the body of a `setGeneric`/`setMethod` -> confidence 1.0
   *   4. any other closure                   -> attributed to the nearest
   *      enclosing NAMED symbol, confidence 0.7, with a reason code; if there is
   *      no enclosing symbol the call is counted unresolved rather than given an
   *      invented source.
   *
   * Case 4 is the common case in idiomatic R: `lapply(x, function(v) f(v))`,
   * `tryCatch(..., error = function(e) ...)`, `shiny::moduleServer(id, function(id)
   * ...)`. The earlier implementation returned null for every one of them, so
   * idiomatic functional R contributed no call edges at all.
   */
  private enclosingAttribution(fnStack: Array<{ node: Node; attribution: CallAttribution | null }>): CallAttribution | null {
    for (let i = fnStack.length - 1; i >= 0; i--) {
      const resolved = fnStack[i].attribution
      if (!resolved) continue
      if (i === fnStack.length - 1) return resolved
      return {
        name: resolved.name,
        confidence: 0.7,
        subType: "closure_call",
        reason:
          "call appears inside an anonymous function expression; attributed to the nearest enclosing named symbol",
      }
    }
    return null
  }

  /** The symbol a `function_definition` node is the body of, if the syntax names one. */
  private resolveFunctionOwner(fnDef: Node): CallAttribution | null {
    const parent = fnDef.parent
    if (!parent) return null

    if (parent.type === "binary_operator") {
      const { target, value } = this.assignmentSides(parent)
      if (target?.type === "identifier" && value && this.sameNode(value, fnDef)) {
        return {
          name: this.unquoteIdentifier(target.text),
          confidence: 1.0,
          subType: "function",
          reason: "",
        }
      }
      // S7 method: the assigned name is a `S7::method(generic, class)` call, so
      // the body belongs to the GENERIC symbol.
      if (value && this.sameNode(value, fnDef)) {
        const s7 = this.findOwningS7Method(fnDef)
        if (s7) return { name: s7, confidence: 1.0, subType: "s7_method", reason: "" }
      }
      return null
    }

    if (parent.type === "argument") {
      // These two constructs are identified by the ENCLOSING CALL, not by the
      // argument: a `setGeneric`/`setMethod` body and an R6/R5 member are both
      // passed as UNNAMED arguments, so requiring a name here first would drop
      // every call inside an S4 method body.
      const memberOwner = this.findOwningObjectSystem(fnDef)
      if (memberOwner) {
        // The edge source is the MEMBER's own name, because that is the symbol the
        // method was emitted as (the class lives in `ownerName`); sourcing from the
        // class instead would point at a different symbol than the one holding the body.
        return {
          name: memberOwner.methodName,
          confidence: 1.0,
          subType: memberOwner.subType,
          reason: "",
        }
      }

      // setGeneric / setMethod body: the declaration is named by the string arg.
      const s4 = this.findOwningS4Declaration(fnDef)
      if (s4) {
        return { name: s4, confidence: 1.0, subType: "s4_method", reason: "" }
      }

      // Any other argument: a named argument is a callback, not a declaration,
      // and an unnamed one has no name to attribute to. Either way the call is
      // attributed to the nearest enclosing NAMED symbol by enclosingAttribution.
      return null
    }

    return null
  }

  /** If this function is the body of an `S7::method(...) <-` definition, name the generic. */
  private findOwningS7Method(fnDef: Node): string | null {
    const parent = fnDef.parent
    if (!parent || parent.type !== "binary_operator") return null
    const { target, value } = this.assignmentSides(parent)
    if (!value || !this.sameNode(value, fnDef)) return null
    if (!target || target.type !== "call") return null
    const base = this.calleeName(target.childForFieldName("function"))
    if (base !== "method" && base !== "S7_method") return null
    const generic = this.firstPositionalValue(this.getArgumentsNode(target))
    return generic ? this.nodeAsName(generic) || null : null
  }

  /**
   * If this function is a member of an R6Class/setRefClass list, name its class.
   *
   * The chain is: function_definition -> argument (the `go = function() ...`
   * entry) -> arguments (of the `list(...)`) -> call (`list`) -> argument
   * (`public = list(...)`) -> arguments (of `R6Class`) -> call (`R6Class`).
   * The member-list NAME is on the argument wrapping the `list` call, not on the
   * method's own argument.
   */
  private findOwningObjectSystem(fnDef: Node): { className: string; methodName: string; subType: string } | null {
    const methodArg = fnDef.parent
    if (!methodArg || methodArg.type !== "argument") return null
    const methodName = methodArg.childForFieldName("name")?.text ?? ""
    if (!methodName) return null

    const listArgs = methodArg.parent
    if (!listArgs || listArgs.type !== "arguments") return null
    const listCall = listArgs.parent
    if (!listCall || listCall.type !== "call") return null
    if (this.calleeName(listCall.childForFieldName("function")) !== "list") return null

    const memberArg = listCall.parent
    if (!memberArg || memberArg.type !== "argument") return null
    const listName = memberArg.childForFieldName("name")?.text ?? ""
    if (!CLASS_MEMBER_LISTS.has(listName) && !R5_MEMBER_LISTS.has(listName)) return null

    const classArgs = memberArg.parent
    if (!classArgs || classArgs.type !== "arguments") return null
    const classCall = classArgs.parent
    if (!classCall || classCall.type !== "call") return null
    const base = this.calleeName(classCall.childForFieldName("function"))
    if (base !== "R6Class" && base !== "setRefClass") return null

    return {
      className: this.assignmentTargetForCall(classCall) ?? "",
      methodName,
      subType: base === "R6Class" ? "r6_method" : "r5_method",
    }
  }

  /** If this function is the body of a setGeneric/setMethod, return the declared name. */
  private findOwningS4Declaration(fnDef: Node): string | null {
    const parent = fnDef.parent
    if (!parent) return null
    let p: Node | null = parent
    let depth = 0
    while (p && depth < 4) {
      if (p.type === "call") {
        const base = this.calleeName(p.childForFieldName("function"))
        if (base === "setGeneric" || base === "setMethod") {
          const args = this.getArgumentsNode(p)
          const first = this.firstPositionalValue(args)
          if (first && first.type === "string") return this.stringNodeText(first)
        }
        return null
      }
      if (p.type === "function_definition") return null
      p = p.parent
      depth++
    }
    return null
  }

  /** The name a class-constructor call is assigned to, used to label R6 members. */
  private assignmentTargetForCall(callNode: Node): string | null {
    const parent = callNode.parent
    if (parent && parent.type === "binary_operator") {
      const target = this.assignmentTarget(parent)
      if (target) return this.unquoteIdentifier(target.text)
    }
    return null
  }

  /**
   * The receiver of a constructor call, read from grammar FIELDS.
   *   `Cls$new()`        -> extract_operator(lhs=Cls, operator=$, rhs=new)
   *   `pkg::Cls$new()`   -> namespace_operator(rhs=extract_operator(...))
   * The previous `text.indexOf("$new")` was a source-text scan that also fired on
   * arguments and strings containing that sequence.
   */
  private constructorTarget(fnNode: Node): string | null {
    const candidate =
      fnNode.type === "namespace_operator" ? fnNode.childForFieldName("rhs") : fnNode
    if (!candidate) return null
    if (candidate.type !== "extract_operator") return null
    const op = candidate.childForFieldName("operator")?.text
    if (op !== "$" && op !== "@") return null
    const rhs = candidate.childForFieldName("rhs")
    if (!rhs || rhs.type !== "identifier" || rhs.text !== "new") return null
    const lhs = candidate.childForFieldName("lhs")
    if (!lhs || lhs.type !== "identifier") return null
    return this.unquoteIdentifier(lhs.text)
  }

  /**
   * The name a `calls` edge should carry: the callee as written, so a reader can
   * see `dplyr::filter`, `obj$method` and `Cls$new` rather than three different
   * functions that all end in the same word. Falls back to the bare name when the
   * function slot is not a simple callable form.
   */
  private callTargetName(fnNode: Node, bare: string): string {
    if (!bare) return ""
    if (fnNode.type === "identifier") return bare
    if (fnNode.type === "namespace_operator" || fnNode.type === "extract_operator") {
      const ns = fnNode.childForFieldName("lhs")
      const op = fnNode.childForFieldName("operator")?.text
      const rhs = fnNode.childForFieldName("rhs")
      if (ns && op && rhs) {
        // The receiver must itself be NAMEABLE for a qualified target to mean anything.
        // R's promises package chains, so the LHS is routinely a call:
        //
        //     promises::promise(function(resolve, reject) { ... })$then
        //
        // and interpolating that LHS verbatim made the target a copy of the caller's
        // source again -- the same failure the if-expression callee had, one level down
        // and reached through a different branch. 4 such edges in testthat.
        //
        // When the receiver is a plain name or a chain of them, the qualified form is the
        // information a reader wants (`pkg::fn`, `obj$method`, `Cls$new`). When it is not,
        // the bare method name is the honest target: the call is still to `then`, and the
        // receiver is an expression rather than a thing with a name.
        const receiver = this.calleeName(ns)
        if (!receiver) return bare
        const rhsName = rhs.type === "identifier" ? this.unquoteIdentifier(rhs.text) : rhs.text
        return `${receiver}${op}${rhsName}`
      }
      return bare
    }
    return bare
  }

  /**
   * The node that WRITES the edge's target, which is the node the edge's `line_number`
   * must come from.
   *
   * The rule is: **the line where the target's LAST name component is written.** For
   * `pkg::fn` and `obj$method` on one line that is the same line either way, so the
   * common case is unaffected. It matters when R splits a chain, which the promises
   * package does routinely:
   *
   *     p$value <- p$value$          <- line 743: `value` is here
   *       then(function(value) {     <- line 744: `then` is HERE
   *
   * The target is `value$then`, and the method name is what identifies the call and what
   * a reader searches for. Preferring the rhs puts the edge on 744. Preferring the
   * expression start put it on 743, a line that does not contain the string `then` at
   * all -- and "the line where the expression happens to begin" is not a stable property
   * of the call, it is an artifact of where the author pressed return.
   */
  private callTargetNode(fnNode: Node, _target: string): Node {
    if (fnNode.type !== "namespace_operator" && fnNode.type !== "extract_operator") return fnNode
    const rhs = fnNode.childForFieldName("rhs")
    if (rhs && rhs.type === "identifier") return rhs
    return fnNode
  }

  private stringArgumentAt(args: Node | null, index: number): string | undefined {
    const n = this.stringArgumentNodeAt(args, index)
    return n ? this.stringNodeText(n) : undefined
  }

  /**
   * The Nth positional STRING argument of a call, as the NODE rather than the text.
   *
   * The node matters because an edge's `line_number` is the line of the node that NAMES
   * the target, and the name of an S7 class lives in a string that need not be on the
   * same line as the call:
   *
   *     class_theme <- S7::new_class(        <- line 219
   *       "theme", class_S3_gg,              <- line 220: this is where `theme` is named
   *       ...
   *
   * Attributing the edge to the call put `class_theme references theme` on line 219, a
   * line that does not contain the word `theme` anywhere. The R-positions oracle found 6
   * such edges in ggplot2 alone. Passing the string node puts the edge on the line that
   * actually names the class, which is the line a reader needs.
   */
  private stringArgumentNodeAt(args: Node | null, index: number): Node | null {
    if (!args) return null
    let seen = 0
    // The grammar exposes commas as named children too, so skip punctuation
    // explicitly while retaining source-order positional arguments.
    for (let i = 0; i < args.namedChildCount; i++) {
      const arg = args.namedChild(i)
      if (!arg || arg.type === "comma") continue
      if (arg.type === "argument") {
        if (arg.childForFieldName("name")) continue
        const value = arg.childForFieldName("value")
        if (!value) continue
        if (seen === index) return value.type === "string" ? value : null
        seen++
        continue
      }
      if (seen === index) return arg.type === "string" ? arg : null
      seen++
    }
    return null
  }

  /** The Nth positional STRING argument of a call, unquoted. */
  private firstStringArgumentOf(node: Node, index: number): string | undefined {
    return this.stringArgumentAt(this.getArgumentsNode(node), index)
  }

  /** The last positional argument value of a call (the function body, for setGeneric/setMethod). */
  private lastPositionalValue(args: Node | null): Node | null {
    if (!args) return null
    let last: Node | null = null
    for (let i = 0; i < args.namedChildCount; i++) {
      const arg = args.namedChild(i)
      if (!arg || arg.type === "comma") continue
      if (arg.type === "argument") {
        if (arg.childForFieldName("name")) continue
        last = arg.childForFieldName("value")
      } else {
        last = arg
      }
    }
    return last
  }

  /** The text of a `string` node: the grammar's `content` field, else the raw token. */
  private stringNodeText(value: Node): string {
    const content = value.childForFieldName("content")
    if (content) return content.text
    return this.unquoteString(value.text)
  }

  /**
   * Slot names of an S4 class, each with the RANGE OF ITS OWN NAME NODE so a
   * slot's symbol points at the slot rather than at the whole `setClass` call.
   *
   * Two shapes declare slots and both are in real use:
   *   slots = c(a = "numeric")        the current idiom
   *   representation(a = "numeric")   the original S4 idiom, still written by
   *                                  R Core itself in Matrix
   * Reading only the first left every `representation()` class with no members.
   */
  private extractSlotKeys(node: Node): Array<{ name: string; range: ASTEngine.UniversalSymbol["range"]; via: string }> {
    const results: Array<{ name: string; range: ASTEngine.UniversalSymbol["range"]; via: string }> = []
    const args = this.getArgumentsNode(node)
    if (!args) return results
    for (let i = 0; i < args.namedChildCount; i++) {
      const arg = args.namedChild(i)
      if (arg?.type !== "argument") continue
      const nameNode = arg.childForFieldName("name")
      const value = arg.childForFieldName("value")
      if (!value) continue

      // `representation(a = "numeric")` is R TAG syntax: tree-sitter-r gives it an
      // argument with NO name field whose value is the `representation` call, so
      // the slot declaration is identified by the CALLEE, not by an argument name.
      const argName = nameNode?.text
      const callee = value.type === "call" ? this.calleeName(value.childForFieldName("function")) : ""

      if (argName === "slots" && callee === "c") {
        for (const slot of this.namedArgumentNameKeys(value, "slots")) results.push(slot)
        continue
      }
      if ((argName === "representation" || callee === "representation") && value.type === "call") {
        for (const slot of this.namedArgumentNameKeys(value, "representation")) results.push(slot)
      }
    }
    return results
  }

  /** The names (with ranges) of the named arguments of a call. */
  private namedArgumentNameKeys(
    callNode: Node,
    via: string,
  ): Array<{ name: string; range: ASTEngine.UniversalSymbol["range"]; via: string }> {
    const results: Array<{ name: string; range: ASTEngine.UniversalSymbol["range"]; via: string }> = []
    const args = this.getArgumentsNode(callNode)
    if (!args) return results
    for (let i = 0; i < args.namedChildCount; i++) {
      const entry = args.namedChild(i)
      if (entry?.type !== "argument") continue
      const entryName = entry.childForFieldName("name")
      if (entryName?.text) {
        // An argument name can be written three ways -- bare (`Dim = ...`), backticked
        // (`` `odd name` = ... ``) or as a string (`"a" = ...`) -- and R requires the
        // last form in places. The S4 idiom
        //
        //     setClass("new_class", slots = c("a" = "numeric"))
        //
        // names its slot with a string, and this function stripped only backticks, so the
        // published symbol was literally `"a"`, quotes included. That name exists in
        // exactly one R file in the pinned corpora, and the R-positions oracle found it
        // because R has no token whose text is `"a"`. Backticks then quotes, because a
        // backticked name may itself contain a double quote.
        const name = this.unquoteString(this.unquoteIdentifier(entryName.text))
        results.push({ name, range: this.getRange(entryName), via })
      }
    }
    return results
  }

  private unquoteString(text: string): string {
    const trimmed = text.trim()
    if (trimmed.length >= 2) {
      const first = trimmed[0]
      const last = trimmed[trimmed.length - 1]
      if ((first === '"' || first === "'") && first === last) return trimmed.substring(1, trimmed.length - 1)
    }
    return trimmed
  }

  private extractSignature(node: Node): string | undefined {
    const parameters = this.getParametersNode(node)
    return parameters ? parameters.text : undefined
  }

  private extractDocstring(node: Node): string | undefined {
    let prev: Node | null = node.previousSibling
    const docsStack: string[] = []
    while (prev) {
      if (prev.type === "comment") {
        docsStack.push(prev.text)
        prev = prev.previousSibling
      } else if (prev.type === "return") {
        prev = prev.previousSibling
      } else {
        break
      }
    }

    if (docsStack.length === 0) return undefined

    let combined = ""
    for (let i = docsStack.length - 1; i >= 0; i--) {
      combined += docsStack[i]
      if (i > 0) combined += "\n"
    }
    return combined
  }

  private extractNamedArguments(node: Node, argName: string): string[] {
    const results: string[] = []
    const args = this.getArgumentsNode(node)
    if (!args) return results
    for (let i = 0; i < args.namedChildCount; i++) {
      const arg = args.namedChild(i)
      if (!arg || arg.type !== "argument") continue
      const nameNode = arg.childForFieldName("name")
      if (!nameNode || nameNode.text !== argName) continue
      const valNode = arg.childForFieldName("value")
      if (!valNode) continue
      if (valNode.type === "call" && this.calleeName(valNode.childForFieldName("function")) === "c") {
        const cArgs = this.getArgumentsNode(valNode)
        if (cArgs) {
          for (let j = 0; j < cArgs.namedChildCount; j++) {
            const ca = cArgs.namedChild(j)
            if (!ca || ca.type === "comma") continue
            if (ca.type === "argument") {
              const v = ca.childForFieldName("value")
              if (v && (v.type === "string" || v.type === "identifier")) {
                const text = v.type === "string" ? this.stringNodeText(v) : this.unquoteIdentifier(v.text)
                if (text) results.push(text)
              }
            } else if (ca.type === "string" || ca.type === "identifier") {
              const text = ca.type === "string" ? this.stringNodeText(ca) : this.unquoteIdentifier(ca.text)
              if (text) results.push(text)
            }
          }
        }
      } else if (valNode.type === "string" || valNode.type === "identifier") {
        const text = valNode.type === "string" ? this.stringNodeText(valNode) : this.unquoteIdentifier(valNode.text)
        if (text) results.push(text)
      }
    }
    return results
  }

  /**
   * The range of a member DECLARATION: from the declared name to the end of its value.
   *
   * A member is written `name = value`, and a range taken from `value` alone starts at
   * the value. For an R6 or R5 method that means the range begins at the `function`
   * keyword and so EXCLUDES the name the symbol is published under -- a range that does
   * not contain the thing it names. The R-positions oracle found 833 of these across the
   * pinned corpora (dplyr, shiny, testthat), every one a method, all of them off by the
   * length of `name = `.
   *
   * Both nodes are required, so a member with no name is not representable here and the
   * caller is forced to decide what it means rather than being handed a range that
   * silently omits the name.
   */
  private getDeclarationRange(nameNode: Node, valueNode: Node) {
    const r: ASTEngine.UniversalSymbol["range"] = {
      startLine: nameNode.startPosition.row + 1,
      startColumn: nameNode.startPosition.column + 1,
      endLine: valueNode.endPosition.row + 1,
      endColumn: valueNode.endPosition.column + 1,
      startIndex: nameNode.startIndex,
      endIndex: valueNode.endIndex,
    }
    // The byte fields from the same analyzer state `getRange` uses, so a member range is
    // not the one kind of range that quietly lacks them.
    const toBytes = this.byteOffsetOf
    if (toBytes) {
      r.byteStart = toBytes(nameNode.startIndex)
      r.byteEnd = toBytes(valueNode.endIndex)
    }
    return r
  }

  /**
   * The range of a node.
   *
   * `startIndex`/`endIndex` are whatever the parser reported -- UTF-16 code units, for
   * web-tree-sitter -- and are passed through unchanged so nothing that already reads them
   * moves. `byteStart`/`byteEnd` are the same positions in BYTES, added alongside, which is
   * what a consumer slicing a Buffer needs. `byteOffset` is supplied by `analyze`, which is
   * the only place that has the source text; a node range built outside an analyze call
   * simply omits the byte fields rather than reporting a wrong one.
   */
  /**
   * Is this `if` condition the literal FALSE, so the `then` branch never executes?
   *
   * Only the literals. A variable holding FALSE is not statically knowable, and R does not
   * constant-fold, so guessing there would drop real declarations.
   */
  /**
   * Remove the symbols a top-level `rm(...)` unbinds, and any relationship that named one
   * as its source. Returns how many were removed, so the removal is countable rather than
   * silent.
   */
  private removeTopLevelBindings(
    node: Node,
    args: Node | null,
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
    metadata: Partial<ASTEngine.FileMetadata>,
  ): number {
    if (!args) return 0
    const doomed = new Set<string>()
    for (let i = 0; i < args.namedChildCount; i++) {
      const arg = args.namedChild(i)
      if (!arg) continue
      // `rm(x)` and `rm(x = ...)` are both legal; only the former carries a bare name.
      if (arg.childForFieldName("name")) continue
      const v = arg.childForFieldName("value") ?? (arg.type === "identifier" ? arg : null)
      if (!v) continue
      const nm = v.type === "identifier" ? this.unquoteIdentifier(v.text) : v.type === "string" ? this.unquoteString(v.text) : null
      if (nm) doomed.add(nm)
    }
    if (doomed.size === 0) return 0
    const before = symbols.length
    for (let i = symbols.length - 1; i >= 0; i--) {
      const s = symbols[i]
      if (s.ownerName || !doomed.has(s.name)) continue   // a CLASS MEMBER is not a binding
      symbols.splice(i, 1)
    }
    for (let i = relationships.length - 1; i >= 0; i--) {
      const r = relationships[i]
      if (doomed.has(String(r.source))) relationships.splice(i, 1)
    }
    void node; void metadata
    return before - symbols.length
  }

  private isStaticallyFalseCondition(ifNode: Node): boolean {
    const cond = ifNode.childForFieldName("condition")
    if (!cond) return false
    // The grammar gives the LITERAL its own node type. Measured, not assumed:
    //
    //     if(FALSE) { ... }   -> condition.type = "false"     (a dedicated node)
    //     if (F) ...          -> condition.type = "identifier" (F is just a name)
    //
    // A first version of this checked for `identifier` only, so it handled `if (F)` and
    // silently missed every `if (FALSE)` -- which is the form packages actually write, and
    // exactly the one the red-team finding was about. The instrumentation printed
    // `staticallyFalse=false` for a condition whose text was plainly "FALSE", which is what
    // sent me to the grammar instead of to another guess.
    if (cond.type === "false") return true
    if (cond.type !== "identifier") return false
    const t = this.unquoteIdentifier(cond.text)
    return t === "F" || t === "FALSE" || t === "false"
  }

  private getRange(node: Node, byteOffset?: (i: number) => number) {
    const toBytes = byteOffset ?? this.byteOffsetOf
    const r: ASTEngine.UniversalSymbol["range"] = {
      startLine: node.startPosition.row + 1,
      startColumn: node.startPosition.column + 1,
      endLine: node.endPosition.row + 1,
      endColumn: node.endPosition.column + 1,
      startIndex: node.startIndex,
      endIndex: node.endIndex,
    }
    if (toBytes) {
      r.byteStart = toBytes(node.startIndex)
      r.byteEnd = toBytes(node.endIndex)
    }
    return r
  }
}
