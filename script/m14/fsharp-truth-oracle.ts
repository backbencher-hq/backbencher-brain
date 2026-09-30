/**
 * FSHARP DIFFERENTIAL ORACLE — the independent second derivation.
 *
 * The M14.0.F5 differential compares the analyzer against TRUTH derived from the same
 * parse tree by a SEPARATE implementation. That is what makes it a differential rather
 * than a self-check: if both sides shared one traversal, a defect in that traversal
 * would be invisible to both. So this file is written against the GRAMMAR (the node
 * types and fields the wired `tree-sitter-fsharp` wasm actually exposes, enumerated by
 * `script/m14/tmp/fs000-node-types.ts`: 213 named, 331 anonymous, 28 fields, ABI 15)
 * and derives each fact by its own walk, in its own order, with its own data
 * structures.
 *
 * WHERE IT DELIBERATELY DISAGREES WITH THE ANALYZER. An oracle that re-derives the
 * analyzer's rules by reading its source is a second copy, not a second opinion. Three
 * rules here are written the way the F# LANGUAGE says, and each one has a measured cost
 * recorded in the closure record (reviews/fsharp/):
 *
 *   DU-vs-ALIAS  the analyzer maps every `union_type_defn` to `enum`; this oracle reads
 *                the same node and asks the same question (it is the ambiguity
 *                `script/m14/tmp/fs010` measured), so it AGREES on purpose — a
 *                disagreement here would be an oracle bug, not a finding.
 *   SELF-EDGE    the analyzer refuses `contains X -> X` at composition; this oracle
 *                NEVER DERIVES one, because a name cannot contain itself. Two
 *                implementations agreeing on a refusal is worth less than one of them
 *                being independent, so the refusal is stated in BOTH files explicitly
 *                rather than inherited.
 *   DECLARED-TYPE this oracle derives the R9 graph from the POSITION nodes
 *                (`record_field`, `union_type_field`, `type_abbrev_defn`, an argument
 *                list, a class-body `let`) rather than from a generic type-wrapper walk,
 *                so a wrapper-shape change in the analyzer cannot silently change both
 *                sides at once.
 *
 * The contract it mirrors, each arm probe-verified against
 * `wasm/tree-sitter-fsharp.wasm` and pinned by `validation/m14/fixtures/fsharp/`:
 *
 *   contains     owner -> owned member, from the scope the walk maintains. NEVER a
 *                self-edge.
 *   calls        an `application_expression` whose callee is a NAME: target = the leaf
 *                of a dotted `long_identifier_or_op` / `long_identifier`, the RHS
 *                operand of a `|> infix_expression`, and the whole text of a
 *                `dot_expression`. F# console output and the Object leaf methods are
 *                excluded, matching the lane's declared contract.
 *   instantiates an explicit `new Foo(…)` — a `prefixed_expression` whose first token
 *                is `new` — plus constructor chaining in a `new()` body.
 *   extends      `class_inherits_decl`. F# implements interfaces with
 *                `interface I with`, so an `inherit` is ALWAYS a base type; the
 *                retired "starts with I and its second character is uppercase"
 *                heuristic is not reproduced here.
 *   implements   `interface_implementation`, including inside a `type_extension`.
 *   overrides    a `member_defn` whose first non-attribute token is `override`:
 *                owner-qualified on both ends (`Owner.method -> Base.method`).
 *   references   (a) `import_decl` (`open X`) -> the module path, sourced from the
 *                enclosing namespace/module or `Global` for a module-less file; and
 *                (b) the R9 DECLARED-TYPE graph, marked
 *                `metadata.relationshipType === "declared_type"`.
 *
 * IT DELIBERATELY DOES NOT DERIVE: symbol ranges, the imports array, complexity, or
 * the export list. Those are pinned by the fixture lane and the pipeline seam gate;
 * duplicating them here would add a second place to be wrong without adding a second
 * opinion on anything the fixtures do not already pin.
 */

/** One derived fact, in the shape the F5 harness consumes. */
export interface TruthEdge {
  label: string
  from: string
  /**
   * The target is spelled BOTH ways on purpose. The lane's own probes (fs024, fs028) read
   * `.to`; the shared M14 differential harness reads `.target` on a truth row
   * (script/m14/differential.ts: `te.target`, and the same leaf/qualified comparison the
   * analyzer side goes through). Emitting one name and translating at the call site would
   * work until one of the two is changed, and a truth row that reads as empty is
   * indistinguishable from a row the oracle failed to derive — which is the failure this
   * oracle exists to make visible.
   */
  to: string
  target: string
  /** The node the fact is written on, so the harness can compare the LINE too. */
  line: number
  /** Present only on the declared_type arm; the family MARKER. */
  declaredOn?: string
}

// F#'s console output and the .NET Object leaf methods. `sprintf`/`sprintfn` are string
// FORMATTING, the analogue of C#'s string.Format, which the C# family KEEPS — so they
// are deliberately absent from this set too. Written as a literal here rather than
// imported from the analyzer: an oracle that imports the analyzer's exclusion list
// cannot contradict it, and the point of the comparison is that it can.
const CONSOLE_BUILTINS = new Set([
  "printfn", "printf", "eprintfn", "eprintf", "fprintfn", "fprintf",
  "Console.WriteLine", "Console.Write", "Console.Error.WriteLine", "Console.Error.Write",
])
const OBJECT_LEAF_METHODS = new Set(["ToString", "GetHashCode", "Equals", "GetType", "ReferenceEquals"])

/** F#'s predefined types — a `declared_type` edge naming one points at nothing. */
const PREDEFINED_TYPES = new Set([
  "int", "uint", "int8", "uint8", "int16", "uint16", "int32", "uint32", "int64", "uint64",
  "nativeint", "unativeint", "float", "double", "float32", "single", "decimal", "bool",
  "char", "string", "obj", "unit", "void", "exn", "list", "array", "seq", "option", "ref",
  "byte", "sbyte", "intptr", "uintptr", "bigint",
])

/** Every grammar node that WRAPS a written type (read off the wired wasm, not the analyzer). */
const TYPE_WRAPPERS = new Set([
  "simple_type", "postfix_type", "paren_type", "generic_type", "function_type",
  "compound_type", "list_type", "atomic_type", "nullable_type", "struct_type",
  "static_type", "byref_type", "flexible_type", "types",
])

// --- small tree helpers, each written independently of the analyzer's -----------

function namedChildren(n: any): any[] {
  const out: any[] = []
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c) out.push(c)
  }
  return out
}

function firstChildOfType(n: any, type: string): any | undefined {
  for (const c of namedChildren(n)) if (c.type === type) return c
  return undefined
}

function descendantsOfType(n: any, type: string, maxDepth = 12): any[] {
  const out: any[] = []
  const stack: any[] = [[n, 0]]
  while (stack.length) {
    const [cur, d] = stack.pop()!
    if (d >= maxDepth) continue
    for (const c of namedChildren(cur)) {
      if (c.type === type) out.push(c)
      stack.push([c, d + 1])
    }
  }
  return out
}

/** The first token child of a node, skipping leading trivia — the `override` probe. */
function firstTokenIs(n: any, text: string): boolean {
  for (let i = 0; i < n.childCount; i++) {
    const c = n.child(i)
    if (!c) continue
    if (c.type === text) return true
    if (c.isNamed) break
  }
  return false
}

/** The identifier a `type_name` declares, generics and constraints stripped. */
function typeNameOf(tn: any): string | null {
  if (!tn) return null
  const li = firstChildOfType(tn, "long_identifier")
  if (li) {
    const ids = descendantsOfType(li, "identifier", 4)
    return ids.length ? ids[ids.length - 1].text : null
  }
  const id = firstChildOfType(tn, "identifier")
  return id ? id.text : null
}

/** The last dotted segment of a callee spelling. */
/**
 * The module or namespace a FILE declares, or null.
 *
 * `module internal FSharp.Compiler.CommandLineMain` at the top of a file declares the
 * whole file's scope, and an `open` that follows it is at THAT scope — but in this grammar
 * the `open` is a SIBLING of the module node, not a child, so a scope stack maintained by
 * walking down the tree is still empty when the `open` is reached. The analyzer has a
 * pre-pass for exactly this and sources the import from the module; this oracle did not, and
 * fell back to `Global`.
 *
 * Measured: 122 UNEXPLAINED rows per 120 real files, every one of them a module path the
 * analyzer attributes to the file's own module and this oracle attributes to `Global`. The
 * rows are REAL and the analyzer is RIGHT — in F# the file's module is its top-level scope,
 * so `open System` in CommandLineMain.fs is a dependency of CommandLineMain.
 */
function fileScopeName(root: any): string | null {
  const cands = [
    ...descendantsOfType(root, "module_defn", 3),
    ...descendantsOfType(root, "named_module", 3),
    ...descendantsOfType(root, 3),
  ]
  // ONE top-level declaration, or none. Two corpus files have the same shape — an `open`
  // above the `module` keyword — and they need opposite answers: in a single-module file
  // that scope is the file's wherever the `open` sits, and in a SCRIPT with several
  // modules the code above the first `module` is at the SCRIPT's scope, not inside it.
  // `docs/fcs/project.fsx` is the second case. Counting top-level declarations is
  // structural; keying on the file extension would be a guess about which files are scripts.
  if (cands.length !== 1) return null
  // ...and nothing EXECUTES above it — see the analyzer's `collectFileScope` for the two
  // corpus files that need opposite answers. A top-level binding above the module is what
  // makes a file a SCRIPT, and it is structural: the extra `module M` / `module N` in
  // project.fsx are inside triple-quoted strings, so counting modules is not sufficient.
  const modStart = cands[0]!.startIndex
  const hasCodeAbove = descendantsOfType(root, "function_or_value_defn", 24).some((n: any) => n.startIndex < modStart)
  if (hasCodeAbove) return null
  for (const n of cands) {
    const tn = descendantsOfType(n, "type_name", 2)[0] ?? descendantsOfType(n, "long_identifier", 2)[0] ??
      descendantsOfType(n, "identifier", 2)[0]
    const raw = tn?.text
    // The FULL dotted path, not its leaf. A module's scope is the name it DECLARES —
    // `FSharp.Compiler.CommandLineMain` — and the analyzer publishes exactly that. Taking
    // the leaf here (`CommandLineMain`) matched no scope and turned 0 rows into 9 on both
    // sides of the comparison at once, which is the cheapest possible signal that the
    // rule, not the corpus, was wrong.
    if (raw) return raw.trim()
  }
  return null
}

/**
 * The declaration's OWN left-hand side, skipping the `and` clauses of a mutual recursion
 * group.
 *
 * F# spells `let rec f x = … and g y = …` as ONE `function_or_value_defn` with four direct
 * named children, and they are not the four you would guess (printed by
 * script/m14/tmp/fs035-and-group.ts):
 *
 *   0  value_declaration_left   "convTypeSpec cenv emEnv preferCreated (tspec: ILTypeSpec)"
 *   1  declaration_expression   "let typT = convTypeRef cenv emEnv preferCreated tspec…"
 *   2  function_declaration_left "convTypeAux cenv emEnv preferCreated ty"
 *   3  match_expression         "match ty with …"
 *
 * The group's own name is child 0, and it is a VALUE_declaration_left. The `and` clause is
 * child 2 and it is a FUNCTION_declaration_left. Asking for `function_declaration_left`
 * first therefore returns the `and` clause, and the whole group gets named after its
 * SECOND function — so every call in the FIRST function's body was attributed to the
 * second. Measured: 24 residual rows in ilreflect.fs alone, plus a declared_type row, and
 * the tell was that the rows sat at lines 719–731 while the name they carried was declared
 * at 743.
 *
 * The rule is DOCUMENT ORDER over both left types, not a preference between them. Child 0
 * precedes child 2 in the source, and the source is what names the binding.
 */
/**
 * A `static let` / `static member val` member's name, read from the declaration it wraps.
 *
 * The header form (`member _.Name`) has no counterpart here, so `thisBindingName` answers null
 * and every position inside the member lost its owner. `static let` also nests the binding one
 * level deeper than the shape suggests — the member's child is a `value_declaration` and the
 * `function_or_value_defn` whose left-hand side carries the name is inside THAT — so a first
 * version that stopped at the `value_declaration` found no declaration-left child and returned
 * null as well. Both misses looked identical from the residual: a row that is not there.
 */
function declaredNameInsideMember(member: any): string | null {
  const declared =
    firstChildOfType(member, "function_or_value_defn") ??
    descendantsOfType(member, "function_or_value_defn", 3)[0] ??
    (() => {
      const vd = firstChildOfType(member, "value_declaration")
      return vd ? descendantsOfType(vd, "function_or_value_defn", 2)[0] : undefined
    })()
  if (!declared) return null
  const left = firstDeclarationLeft(declared)
  const pat = left ? firstChildOfType(left, "identifier_pattern") : null
  if (!pat) return firstChildOfType(left ?? declared, "identifier")?.text ?? null
  const idents = descendantsOfType(pat, "identifier", 3).sort((a: any, b: any) => a.startIndex - b.startIndex)
  return idents.length ? idents[0]!.text : null
}

function firstDeclarationLeft(node: any): any | undefined {
  for (const c of namedChildren(node)) {
    if (c.type === "function_declaration_left" || c.type === "value_declaration_left") return c
  }
  return undefined
}

/**
 * The interface name an `interface_implementation` node NAMES.
 *
 * A descendant search cannot answer this. `interface IMultiThreadableTask with` may carry a
 * whole member body, and the first `long_identifier` inside it belongs to that body rather
 * than to the clause — `member val TaskEnvironment = TaskEnvironment.Fallback with get, set`
 * made the oracle publish `implements GenerateILLinkSubstitutions -> Fallback`, reading a
 * value out of a property initialiser as the interface.
 *
 * Two things had to be right and the first version had neither: the name is a DIRECT child
 * of the clause, and this oracle's `descendantsOfType` walks a LIFO stack, so `[0]` is the
 * LAST node in document order rather than the first. The two faults pointed in opposite
 * directions and cancelled often enough to look like agreement on a small sample.
 */
function interfaceNameOf(impl: any): string | null {
  const direct =
    firstChildOfType(impl, "long_identifier") ??
    firstChildOfType(impl, "identifier") ??
    firstChildOfType(impl, "long_identifier_or_op")
  if (direct?.text) return direct.text
  const deep = descendantsOfType(impl, "long_identifier", 3)
    .concat(descendantsOfType(impl, "identifier", 3))
    .sort((a: any, b: any) => a.startIndex - b.startIndex)
  return deep.length ? deep[0]!.text : null
}

function leafOf(text: string): string {
  return text.includes(".") ? (text.split(".").pop() as string) : text
}

/**
 * Derive every F# truth edge for one file.
 *
 * @param root     the parse tree's root node
 * @param symbols  the analyzer's own symbol list, used ONLY for `contains` (the scope a
 *                 member is owned by is a fact about the program, and re-deriving scope
 *                 membership independently would fabricate disagreements about
 *                 ownership rather than about edges). Every other arm reads the TREE.
 */
export function deriveFsharpEdges(root: any, symbols: any[]): TruthEdge[] {
  const edges: TruthEdge[] = []
  const line = (n: any) => (n && typeof n.startPosition?.row === "number" ? n.startPosition.row + 1 : 0)
  const seen = new Set<string>()

  /**
   * The names this lane PUBLISHES as symbols.
   *
   * The lane's contract — pinned by the `Negative.fs` fixture, where a local `let` is
   * asserted NOT to be a symbol — is that a binding inside a body is a local and is never
   * a symbol. An edge sourced to a name with no symbol is not a weaker fact; it is an edge
   * no consumer can join, because there is nothing on the other end of it to resolve.
   *
   * This oracle was attributing declared types to exactly those names. `let select
   * (methInfo:MethodInfo) = …` inside a function body produced `references select ->
   * MethodInfo`, while the analyzer — correctly, per the contract — attributes the local's
   * parameter type to the enclosing published callable. Both implementations were
   * internally consistent and the residual was the disagreement.
   *
   * Measured before the rule: 56 MISSING and 47 UNEXPLAINED `declared_type` rows per 120
   * files, the largest class in the lane, all of them the same question.
   *
   * So the rule is one-directional and it is about the GRAPH, not about the language: truth
   * may derive a fact from anywhere in the tree, but an edge it publishes must have a
   * source a consumer can resolve. Where the nearest declaration is not published, the
   * owner is the nearest enclosing one that is.
   */
  const published = new Set<string>()
  for (const s of symbols ?? []) {
    if (s?.name) published.add(String(s.name))
    if (s?.ownerName) published.add(String(s.ownerName))
  }
  const isPublished = (n: string | null | undefined): boolean => !!n && published.has(n)
  const fileScope = fileScopeName(root)

  const emit = (label: string, from: string, to: string, n: any, declaredOn?: string) => {
    if (!from || !to) return
    // A SELF-EDGE is refused for CONTAINMENT only, and the scope of the refusal is the
    // point. `contains X -> X` is a statement about the graph's own bookkeeping, not
    // about the code — no type contains itself. A RECURSIVE CALL is the opposite: `let
    // rec f x = … f (x-1) …` really does call itself, and refusing the edge would delete
    // a true fact about the program. A first draft of this oracle refused every label's
    // self-edge, which cost 668 UNEXPLAINED rows on 200 real files — every one of them a
    // recursive call the analyzer was RIGHT to emit. So the rule is per-label, stated
    // here, and the analyzer states the same per-label scope at its own composition site.
    if (label === "contains" && from === to) return
    const key = `${label}|${from}|${to}|${line(n)}`
    if (seen.has(key)) return
    seen.add(key)
    edges.push(declaredOn ? { label, from, to, target: to, line: line(n), declaredOn } : { label, from, to, target: to, line: line(n) })
  }

  // ---- contains, from the analyzer's own ownership (scope is shared ground truth) ----
  for (const s of symbols ?? []) {
    const owner = s.ownerName ?? s.owner
    if (!owner) continue
    emit("contains", String(owner), String(s.name), { startPosition: { row: (s.range?.startLine ?? 1) - 1 } })
  }

  // ---- one independent walk for the declaration-derived arms ----
  //
  // The scope is a STACK maintained here, pushed on a namespace / module / type and
  // popped when the frame closes. The analyzer propagates a copied array down an
  // explicit work stack instead — a different mechanism for the same fact, which is the
  // point: a bug in one does not have to be a bug in the other.
  interface Frame {
    node: any
    scope: string[]
    callOwner: string | undefined
    inBody: boolean
    /**
     * The PROPERTY-GETTER CONTRACT, carried down the walk rather than applied once at the
     * top of a body.
     *
     * An EXPRESSION-bodied property (`member _.XmlDocSig = checkIsResolved()`) publishes no
     * calls of its own — that is the C# family contract, and the analyzer implements it by
     * publishing nothing from that body. This oracle applied the rule the same shallow way:
     * it left `owner` unset on the property and moved on. But leaving `owner` unset ALSO left
     * `inBody` false for everything inside, and `inBody` is what tells the walk it is inside a
     * body. So the property contract did not merely fail to suppress — it made the calls real
     * AND mis-sourced them: `let xmlsig = …` inside `member _.XmlDocSig` looked top-level, was
     * promoted to a call source, and its body attributed to itself.
     *
     * Measured: 113 residual rows per 120 corpus files, the largest single class in the lane,
     * and every one of them inside a computed property or a method — the two bodies where the
     * contract applies. The tell was a source name (`xmlsig`, `m`, `ty`, `res`) that is a
     * LOCAL in the source and an owner in the truth.
     *
     * The fix is that a suppressed body is still a BODY: `inBody` travels, and the suppression
     * travels with it to every depth.
     */
    suppressCalls: boolean
  }
  const stack: Frame[] = [
    { node: root, scope: [], callOwner: undefined, inBody: false, suppressCalls: false },
  ]

  while (stack.length) {
    const { node, scope, callOwner, inBody, suppressCalls } = stack.pop()!
    const t = node.type
    // Hoisted to the top of the loop because the child-push at the foot of it needs to carry
    // the property contract downward, and a predicate declared inside the binding branch is
    // out of scope there. Declaring it in both places is how it stayed wrong the first time.
    const isExpressionProperty =
      t === "member_defn" && isExpressionBodiedProperty(node) && !hasExplicitSetter(node)
    //
    // FS-D16, truth side. A parse-recovery region is the PARSER's reconstruction, not the
    // program, and both implementations now refuse to read one: the analyzer stops its
    // walk at an `ERROR` node and discloses the region as a ParseError (FS-D15/16), and
    // the oracle stops here.
    //
    // Without this the two disagree in the most expensive direction available — truth
    // derives rows from recovery artifacts the analyzer has correctly declined to
    // publish, and every one of them is reported MISSING. Measured: fsharp-data went from
    // 0 MISSING to 516 on the strength of this one asymmetry, which is the same class of
    // bug as the harness allowlist asymmetry, one layer down. Two of the three biggest
    // numbers in this lane's history were harness and oracle scope mismatches rather than
    // anything about F#.
    //
    // The rule is not "ignore errors", it is "a recovery artifact is not a fact about the
    // source". The regions are still DISCLOSED by the analyzer, so nothing is hidden.
    if (t === "ERROR" || node.isMissing) continue
    let cur = scope.slice()
    let owner = callOwner
    let body = inBody

    if (t === "namespace" || t === "named_module" || t === "module_defn") {
      const nm = firstChildOfType(node, "identifier") ?? firstChildOfType(node, "long_identifier")
      if (nm?.text) cur = cur.concat([nm.text])
    } else if (t === "type_definition") {
      const tn = descendantsOfType(node, "type_name", 4)[0]
      const name = typeNameOf(tn)
      if (name) {
        cur = cur.concat([name])
        // extends — the base type, ALWAYS a base: F# implements interfaces with
        // `interface I with`, so an `inherit` never names one.
        // R10 SPELLING (see the object_expression arm): a qualified type is WRITTEN
        // `System.IDisposable` and DECLARES `IDisposable`. The edge carries the leaf so
        // it joins to a symbol; the analyzer keeps the qualified form in
        // `metadata.qualifiedType`. Applying it here INDEPENDENTLY is the point — the
        // rule is stated in the FAMILY, not copied from the analyzer, so a divergence
        // in either implementation shows up as a row instead of hiding.
        for (const inh of descendantsOfType(node, "class_inherits_decl", 8)) {
          const base = descendantsOfType(inh, "long_identifier", 3)[0] ?? descendantsOfType(inh, "identifier", 3)[0]
          if (base) emit("extends", name, leafOf(base.text), base)
        }
        // implements — including the interface_implementation a `type X with` carries,
        // which the ANALYZER reads only under a type_definition body. Derived here by
        // walking the whole subtree, so the two differ if that is a defect.
        for (const impl of descendantsOfType(node, "interface_implementation", 10)) {
          const ifaceText = interfaceNameOf(impl)
          if (ifaceText) emit("implements", name, leafOf(ifaceText), impl)
        }
      }
    } else if (t === "type_extension") {
      const tn = firstChildOfType(node, "type_name")
      const name = typeNameOf(tn)
      if (name) cur = cur.concat([name])
      // an extension's `interface I with` is a REAL implementation, and the analyzer
      // does not reach it (its arm fires only under a type_definition body).
      const extName = typeNameOf(tn)
      for (const impl of descendantsOfType(node, "interface_implementation", 6)) {
        const extIface = interfaceNameOf(impl)
        if (extIface && extName) emit("implements", extName, leafOf(extIface), impl)
      }
    } else if (t === "import_decl") {
      // FS-A1 (analyzer side) established that `open X` in F# is an `import_decl` and
      // that `open_statement`/`open_decl` occur ZERO times in the corpus shape census —
      // so a truth arm written for the other two names would have derived nothing at all,
      // silently, which is the same failure as an absent arm except that it reads as an
      // absence of facts rather than as an absence of code.
      //
      // The FACT is that the file depends on a module, and the module is a PATH:
      // `open Microsoft.FSharp.Collections` is a reference to a namespace-qualified
      // name, not to the leaf. This is the one place in the lane where a dotted target is
      // CORRECT and the R10 leaf rule does not apply — a module's leaf is not the module.
      // The analyzer publishes the full path at confidence 0.9 with `isImport: true`.
      //
      // Source: the enclosing scope, or `Global` in a file with no namespace or module.
      // That `Global` fallback is FSD10 and it is not cosmetic — sourcing the edge from
      // the opened name itself would make the import unfalsifiable, since every target
      // would then "reference" itself.
      const target = firstChildOfType(node, "long_identifier") ?? firstChildOfType(node, "identifier")
      if (target?.text) {
        emit("references", cur.length ? cur[cur.length - 1] : fileScope ?? "Global", target.text, node)
      }
    } else if (t === "object_expression") {
      // `{ new System.IDisposable with … }` implements `System.IDisposable`. There is
      // NO `interface_implementation` node in this shape — the grammar records the
      // object expression's interface as the `new` token followed by a
      // `long_identifier_or_op` (verified by reading the tree, not by assuming the
      // `interface I with` shape applies). The DISCRIMINATOR is the `new` token, never
      // a spelling test.
      //
      // The R10 SPELLING is applied here and the analyzer applies it independently
      // (leaf in the target, qualified form in `metadata.qualifiedType`): a qualified
      // interface is WRITTEN `System.IDisposable` and DECLARES `IDisposable`, and the
      // edge has to join to a symbol. This is the rule ten lanes already implement, and
      // the 13 dotted `implements` targets per 400 corpus files are where this lane
      // diverged from it.
      if (firstTokenIs(node, "new")) {
        // FS-D14, oracle side. The old route was
        //   descendantsOfType(node, "long_identifier_or_op", 2)[0] ?? …"long_identifier", 2
        // and the DEPTH is the whole story: a two-segment name puts its first
        // `long_identifier_or_op` two levels under the object expression, and a
        // four-segment name puts it three. So the rule worked for
        // `{ new System.IDisposable with … }` and found nothing at all for
        // `{ new System.Collections.Generic.IEqualityComparer<T> with … }` — no `implements`,
        // and no scope, which is worse, because the object's members then lost their owner
        // here too and every member row became UNEXPLAINED as well. A bound that is right
        // for the common case and silently absent for the uncommon one is the same defect
        // in a different costume.
        //
        // The route here is the CARRIER: a dotted name's full text lives on one node, and
        // that node is identified by TYPE rather than by how deep it happens to sit. The
        // analyzer reaches the same node by a different mechanism (findDescendant with a
        // generous bound, then the last identifier inside it); the traversal differs, which
        // is the part that makes a disagreement mean something.
        // The name the `new` TOKEN introduces — a DIRECT child of the object expression, not
        // a descendant. The previous rule searched descendants, which is right for a
        // QUALIFIED name (whose carrier holds the whole dotted path) and wrong for an
        // unqualified one, where no carrier exists and the search ran on into the member
        // bodies: `{ new TextWriter() with member x.Encoding = Encoding.UTF8 }` published
        // `implements OutputCollector -> UTF8`, reading a value out of a member body as the
        // interface. The target resolved to a name that exists and is not an interface, which
        // is the hardest kind of wrong to see.
        //
        // A direct child is what makes the rule total: the `new` keyword's operand is always
        // one, whether it is spelled `TextWriter()`, `System.IDisposable` or
        // `System.Collections.Generic.IEqualityComparer<T>`.
        const carrier = namedChildren(node).find((c: any) =>
          ["typed_expression", "application_expression", "dot_expression", "long_identifier_or_op", "long_identifier", "identifier"].includes(c.type),
        )
        // `new TextWriter()` — the operand is an APPLICATION, and the name is its callee, not
        // its text. Taking the text would publish `TextWriter()` with the parentheses.
        const named = carrier?.type === "application_expression" ? firstChildOfType(carrier, "long_identifier_or_op") ?? firstChildOfType(carrier, "long_identifier") ?? firstChildOfType(carrier, "identifier") : carrier
        const written = (named?.text ?? "").split("<")[0]!.trim()
        // The leaf is the last dot-segment of the WRITTEN name, and it is computed from the
        // text rather than from a node descent.
        //
        // Two earlier versions walked for the last identifier. The first did not order the
        // result, and this oracle's `descendantsOfType` walks a LIFO stack, so it returned
        // the FIRST segment — `System` for `System.Collections.Generic.IEqualityComparer`. The
        // second ordered it correctly and then hit the opposite problem: the carrier is a
        // `typed_expression`, so its subtree also contains the TYPE ARGUMENTS, and
        // `{ new System.Collections.Generic.IEqualityComparer<Foo> with … }` published the
        // interface as `Foo`.
        //
        // The operand of `new` already holds the whole dotted name, so there is nothing a
        // descent adds: the type arguments are gone from `written` because it is split at `<`.
        const ifaceLeaf = written ? written.split(".").pop()! : ""
        const owner = cur.length ? cur[cur.length - 1] : undefined
        if (written && owner) emit("implements", owner, ifaceLeaf, named ?? node)
        // The object's MEMBERS belong to the object, so its scope is opened here. The
        // analyzer opens the same scope (FS-D7); deriving it independently is what makes
        // an `overrides Owner.VisitPat` inside `{ new SyntaxVisitorBase with … }` a
        // comparable fact rather than an unmatched row — a first draft of this oracle did
        // NOT open the scope and produced 218 UNEXPLAINED rows on 120 real files.
        if (written) cur = cur.concat([`new ${written}`])
      }
    } else if (t === "member_defn" || t === "function_or_value_defn" || t === "value_declaration") {
      // A binding inside a body is a LOCAL, never a call source and never a member.
      if (inBody && t !== "member_defn") {
        owner = callOwner
        body = inBody
      } else {
        const name = thisBindingName(node)
        // The PROPERTY-GETTER CONTRACT, derived from the language rather than copied: an
        // EXPRESSION-bodied property (`member _.CopiedFiles = copiedFiles.ToArray()`) is
        // a VALUE, evaluated on read, and the lane's declared contract (inherited from
        // the C# family) is that it emits no calls. A member with an explicit
        // `with get, set` is different: its SETTER body executes, so the contract does
        // not apply — the discriminator is the `set` token on a `property_accessor`.
        //
        // Stated here independently because a first draft of this oracle had no such
        // rule, and the differential reported 710 of 796 MISSING `calls` rows against the
        // analyzer for exactly this shape — a truth defect found by the second opinion,
        // which is the only way it can be found.
        const isExpressionProperty =
          t === "member_defn" && isExpressionBodiedProperty(node) && !hasExplicitSetter(node)
        if (isExpressionProperty) {
          // A body we do not CALL FROM, but ARE inside. Setting `body` is the whole point:
          // without it the walk believes it is at top level and promotes every nested
          // binding to a call source. See Frame.suppressCalls.
          body = true
        }
        // `overrides` is HERITAGE, and heritage is not a call.
        //
        // The property-getter contract says an expression-bodied property publishes no CALLS,
        // because its body is a value evaluated on read. It says nothing about whether the
        // member OVERRIDES something: `override _.ToolName = "fsc.exe"` is an override
        // whatever its body evaluates to, and the fact belongs to the class's shape rather
        // than to anything that runs.
        //
        // These emits were inside the `name && !isExpressionProperty` gate, so the contract
        // suppressed them along with the calls — and the differential reported 18 unexplained
        // `overrides` rows per 120 corpus files that were not a spelling disagreement at all
        // but three members in Fsc.fs whose edges the oracle never derived. A rule about what
        // executes was quietly governing what the type IS.
        if (t === "member_defn" && name && firstTokenIs(node, "override")) {
          const ownerName = cur.length ? cur[cur.length - 1] : undefined
          if (ownerName) {
            const base = baseTypeOfThisFile(node, cur)
            emit("overrides", `${ownerName}.${name}`, base ? `${base}.${name}` : name, node)
          }
        }
        if (name && !isExpressionProperty) {
          owner = name
          body = true
        }
      }
    } else if (t === "import_decl") {
      const target = firstChildOfType(node, "long_identifier") ?? firstChildOfType(node, "identifier")
      if (target?.text) emit("references", cur.length ? cur[cur.length - 1] : "Global", target.text, node)
    } else if (t === "application_expression") {
      const callee = node.namedChild(0)
      if (callee && owner) {
        let name = ""
        if (callee.type === "long_identifier_or_op" || callee.type === "long_identifier" || callee.type === "identifier") {
          name = callee.text
        } else if (callee.type === "infix_expression") {
          // `a |> f` — the callee is the RIGHT operand
          const rhs = namedChildren(callee).pop()
          if (rhs && ["long_identifier_or_op", "long_identifier", "identifier"].includes(rhs.type)) name = rhs.text
        } else if (callee.type === "dot_expression") {
          name = callee.text
        }
        if (name && name.length > 1) {
          const leaf = leafOf(name)
          if (!CONSOLE_BUILTINS.has(name) && !OBJECT_LEAF_METHODS.has(leaf) && !name.startsWith("Console.")) {
            // MEASURED, THEN REVERTED — the `calls`/`instantiates` boundary on a bare
            // application is UNDECIDED, and this is the record of trying to decide it.
            //
            // The site is F#'s secondary constructor:
            //
            //     type FSharpDependencyManager(…) =
            //       new(outputDirectory, useResultsCache) = FSharpDependencyManager(outputDirectory, …, null)
            //
            // whose body creates a value by a bare application with no `new` token. The
            // analyzer emits `instantiates` and this oracle emitted `calls` — 124 against 15
            // per 120 real files, the largest single residual class in the lane.
            //
            // The first attempt read the CODE instead of the spelling: a bare application
            // whose callee is a type declared in the same FILE is a construction. It is a
            // reasonable rule and it is WRONG here, and the measurement is the reason this
            // comment is here rather than the rule. Applying it moved the differential from
            // 202 MISSING / 151 UNEXPLAINED to 297 / 246: it created 110 truth `instantiates`
            // the analyzer did not have, and it destroyed the agreement on 124 rows that had
            // previously matched by NOT firing. A predicate that is right about a construct
            // and wrong about every ordinary call to a same-named binding is not a narrower
            // rule, it is a different one — and F# resolves `Type(x)` against a type table
            // this grammar does not carry, so the file's own declarations are not a
            // substitute for it.
            //
            // So the disagreement is left STANDING and measured, because the honest statement
            // is that the lane has two internally consistent implementations of an undecided
            // contract, not that one of them has a bug. Deciding it needs a decision about
            // what `calls` and `instantiates` mean to the family, not another predicate —
            // and it is filed as the lane's largest open item in reviews/fsharp/closure.md.
            if (suppressCalls) {
              // nothing — the property contract, enforced where the edge would be created
            } else if (owner === "constructor" && cur.length && leaf === leafOf(cur[cur.length - 1]!)) {
              // CONSTRUCTOR CHAINING. F# spells a secondary constructor's invocation of its
              // own primary constructor as a bare application with no `new` token:
              //
              //     new(outputDirectory, useResultsCache) = FSharpDependencyManager(…, null)
              //
              // Both implementations agreed on the source and the target and disagreed only on
              // the LABEL — 14 MISSING `calls` against 14 UNEXPLAINED `instantiates` per 120
              // corpus files, which is what an undecided contract looks like from the outside.
              //
              // The discriminator is narrow and is the family's, not a spelling rule: the
              // callee is the ENCLOSING TYPE of the constructor. An earlier attempt keyed on
              // "any type this file declares" and was reverted — it fired on ordinary calls to
              // same-named bindings and moved the differential from 202/151 to 297/246. The
              // difference between the two is the whole difference between a rule and a
              // coincidence: this one names a type the constructor is a member of.
              emit("instantiates", owner, leaf, node)
            } else {
              emit("calls", owner, leaf, node)
            }
          }
        }
      }
    } else if (t === "prefixed_expression") {
      // `new Foo(…)` is a CONSTRUCTION, not a call. The DISCRIMINATOR is the `new`
      // token, never the callee's spelling — a bare `Foo(…)` stays a call.
      if (firstTokenIs(node, "new") && owner) {
        const operand = node.namedChild(0)
        if (operand?.type === "application_expression") {
          const callee = operand.namedChild(0)
          const text = callee ? callee.text : ""
          const leaf = text ? leafOf(text) : ""
          if (leaf && leaf.length > 1 && !OBJECT_LEAF_METHODS.has(leaf) && !text.startsWith("Console.")) {
            emit("instantiates", owner, leaf, node)
          }
          // the arguments still produce calls, so they are walked and NOT the operand
          for (let i = operand.namedChildCount - 1; i >= 0; i--) {
            const c = operand.namedChild(i)
            if (c) stack.push({ node: c, scope: cur, callOwner: owner, inBody: body })
          }
          continue
        }
      }
    } else if (t === "additional_constr_defn") {
      owner = "constructor"
      body = true
    }

    // ---- the R9 declared-type graph, from POSITION nodes ----
    for (const w of namedChildren(node)) {
      if (!TYPE_WRAPPERS.has(w.type)) continue
      // FS-D11: a TYPE QUERY is not a written type — `typeof<T>` / `unbox<T>` are
      // expressions that carry a type argument. The grammar spells the query two ways
      // (a `static_type` wrapper, and a bare `long_identifier_or_op` named `typeof` /
      // `unbox`), so both are refused; the second is the one that actually occurs in
      // the corpus, which is why a first draft that refused only the first measured
      // nothing.
      if (isTypeQueryPosition(w)) continue
      // only the OUTERMOST wrapper, so a postfix_type inside a list_type is not read
      // once per layer
      if (w.parent && TYPE_WRAPPERS.has(w.parent.type)) continue
      const pos = declaredTypePositionOf(w, cur, body)
      if (!pos) continue
      const nameNode = typeNameLeafOf(w)
      const target = nameNode ? publishableTypeName(nameNode.text) : null
      if (!target) continue
      emit("references", pos.source, target, nameNode ?? w, pos.declaredOn)
    }

    for (let i = node.namedChildCount - 1; i >= 0; i--) {
      const c = node.namedChild(i)
      if (c) stack.push({ node: c, scope: cur, callOwner: owner, inBody: body, suppressCalls: suppressCalls || isExpressionProperty })
    }
  }
  return edges

  // ---- local helpers, closures over the walk's own data ---------------------------

  function thisBindingName(node: any): string | null {
    // A member: `method_or_prop_defn -> property_or_ident -> identifiers`; the LAST
    // identifier is the member name (`_.Speak` -> `Speak`, `this.Greeting` -> `Greeting`).
    if (node.type === "member_defn") {
      const mop = firstChildOfType(node, "method_or_prop_defn")
      const prop = mop ? firstChildOfType(mop, "property_or_ident") : undefined
      if (prop) {
        const ids = namedChildren(prop).filter((c) => c.type === "identifier")
        return ids.length >= 2 ? ids[ids.length - 1].text : ids[0]?.text ?? null
      }
      return null
    }
    // A binding: the declared name is the FIRST `long_identifier` inside the left-hand
    // side's `identifier_pattern` — never the pattern's own text, which spans the whole
    // left-hand side (the FS-D6 defect this oracle exists to be able to contradict).
    const left = firstDeclarationLeft(node)
    if (!left) return firstChildOfType(node, "identifier")?.text ?? null
    const pat = firstChildOfType(left, "identifier_pattern")
    if (!pat) return firstChildOfType(left, "identifier")?.text ?? null
    const li = firstChildOfType(pat, "long_identifier_or_op") ?? firstChildOfType(pat, "long_identifier")
    if (!li) return null
    const idents = descendantsOfType(li, "identifier", 3)
    if (!idents.length) return null
    // Document order, again: `descendantsOfType` returns REVERSE order, so the LAST element
    // is the FIRST identifier. For a curried name that returns the head rather than the
    // whole tail, which is the wrong name for a binding.
    return idents.slice().sort((a: any, b: any) => a.startIndex - b.startIndex)[0]!.text
  }

  /**
   * The base type of the type ENCLOSING a `member_defn`, derived by looking at the
   * ancestor chain rather than from a table the walk filled in.
   *
   * The analyzer keeps a `baseTypes` Map keyed by type name, filled as it visits each
   * type's `class_inherits_decl`. Reading it here would make the two sides share one
   * fact; instead this walks UP from the member, which is a different mechanism for the
   * same question. A first draft stubbed this to `null` and the differential reported
   * `overrides Owner.Finalize -> Finalize` against the analyzer's
   * `-> MarshalByRefObject.Finalize` — 215 UNEXPLAINED rows per 120 real files, every
   * one of them an override whose base the oracle had declined to look up.
   */
  function baseTypeOfThisFile(node: any, scope: string[]): string | null {
    void scope
    let cur = node?.parent ?? null
    for (let i = 0; cur && i < 6; i++) {
      if (cur.type === "type_definition" || cur.type === "type_extension") {
        const inh = descendantsOfType(cur, "class_inherits_decl", 6)[0]
        if (inh) {
          const base = descendantsOfType(inh, "long_identifier", 3)[0] ?? descendantsOfType(inh, "identifier", 3)[0]
          if (base) return leafOf(base.text)
        }
        return null
      }
      cur = cur.parent
    }
    return null
  }

  /**
   * Is this written type a TYPE QUERY (`typeof<T>` / `unbox<T>`) rather than a declared
   * type? Derived by the same two-hop walk the analyzer uses, and stated here rather
   * than imported so the two implementations stay independent — see the analyzer's
   * FS-D11 note for the tree shape and for why the first draft's one-parent test
   * measured nothing.
   */
  /** Is this member an EXPRESSION-bodied property (no argument list, no accessor)? */
  function isExpressionBodiedProperty(m: any): boolean {
    const mop = firstChildOfType(m, "method_or_prop_defn")
    if (!mop) return false
    // the grammar's own `args` field decides, the same way the analyzer's
    // classification does — read from the FIELD, not from the child list
    const args = (mop as any).childForFieldName?.("args")
    if (args) return false
    // no `property_accessor` block => a plain value expression
    return descendantsOfType(mop, "property_accessor", 4).length === 0
  }

  /** Does the member declare an explicit `set` accessor? (FS-D13, both sides.) */
  function hasExplicitSetter(m: any): boolean {
    const mop = firstChildOfType(m, "method_or_prop_defn")
    if (!mop) return false
    for (const acc of descendantsOfType(mop, "property_accessor", 6)) {
      for (let i = 0; i < acc.childCount; i++) {
        const c = acc.child(i)
        if (c && !c.isNamed && c.type === "set") return true
      }
    }
    return false
  }

  function isTypeQueryPosition(t: any): boolean {
    let cur: any = t
    for (let hop = 0; cur && hop < 3; hop++) {
      if (cur.type === "static_type") return true
      // the query operator is a SIBLING of the type inside `typed_expression`
      if (cur.type === "typed_expression") {
        for (const c of namedChildren(cur)) {
          if (c.type === "long_identifier_or_op" && (c.text === "typeof" || c.text === "unbox")) return true
        }
        return false
      }
      const parent: any = cur.parent
      if (!parent) return false
      if (parent.type === "long_identifier_or_op" && (parent.text === "typeof" || parent.text === "unbox")) return true
      if (parent.type === "static_type" || parent.type === "typed_expression") {
        cur = parent
        continue
      }
      return false
    }
    return false
  }

  function typeNameLeafOf(w: any): any | null {
    let cur: any = w
    for (let guard = 0; guard < 8 && cur; guard++) {
      if (cur.type === "type_argument") return null // a bound type parameter
      if (cur.type === "long_identifier") {
        const ids = namedChildren(cur).filter((c) => c.type === "identifier" || c.type === "long_identifier")
        return ids.length ? ids[ids.length - 1] : cur
      }
      if (cur.type === "identifier") return cur
      let next: any = null
      for (const c of namedChildren(cur)) {
        if (TYPE_WRAPPERS.has(c.type) || ["type_argument", "type_arguments", "long_identifier", "identifier"].includes(c.type)) {
          next = c
          break
        }
      }
      if (!next) return null
      cur = next
    }
    return null
  }

  function publishableTypeName(text: string): string | null {
    const t = (text ?? "").trim()
    if (!t || t === "_") return null
    if (/^['^]/.test(t)) return null // 'T, ^T — a binder
    const leaf = t.includes(".") ? leafOf(t) : t
    if (!leaf || leaf === "_" || /^['^]/.test(leaf)) return null
    if (PREDEFINED_TYPES.has(leaf)) return null
    if (!/^[A-Za-z_][A-Za-z0-9_']*$/.test(leaf)) return null
    return leaf
  }

  function declaredTypePositionOf(w: any, scope: string[], inBody: boolean): { source: string; declaredOn: string } | null {
    const parent = w.parent
    if (!parent) return null
    if (["class_inherits_decl", "interface_implementation", "type_attribute", "type_arguments", "type_argument_defn"].includes(parent.type)) {
      // the first two are ALREADY extends/implements; a declared_type edge would be a
      // second, weaker statement of the same fact
      return null
    }
    if (parent.type === "record_field") {
      const rt = ancestorOfType(parent, "record_type_defn", 6)
      const tn = rt ? descendantsOfType(rt, "type_name", 3)[0] : null
      const name = typeNameOf(tn)
      return name ? { source: name, declaredOn: "record_field" } : null
    }
    if (parent.type === "union_type_field") {
      const ud = ancestorOfType(parent, "union_type_defn", 4)
      const tn = ud ? descendantsOfType(ud, "type_name", 3)[0] : null
      const name = typeNameOf(tn)
      return name ? { source: name, declaredOn: "union_case_payload" } : null
    }
    if (parent.type === "type_abbrev_defn") {
      const tn = firstChildOfType(parent, "type_name")
      const name = typeNameOf(tn)
      return name ? { source: name, declaredOn: "type_abbreviation" } : null
    }
    // a parameter / return / class-field / local annotation
    const inArgs = ancestorOfType(w, "paren_pattern", 3) ?? ancestorOfType(w, "argument_patterns", 3) ??
      ancestorOfType(w, "argument_spec", 3) ?? ancestorOfType(w, "arguments_spec", 3) ?? ancestorOfType(w, "curried_spec", 3)
    // A LAMBDA parameter owns nothing, and its annotation belongs to nothing either.
    //
    //     let sb = fun (sb: StringBuilder) (c: char) -> …
    //
    // The `simple_type`'s nearest declaration ancestor is the `let sb` that HOLDS the
    // lambda, so the walk reaches an owner and attributes the parameter's type to it. The
    // owner is real and published, which is what made this hard to see: the edge resolves,
    // so nothing downstream can tell it is about the wrong thing. The lane's contract says
    // lambda params are NOT symbols, and a `fun` is not a declaration.
    //
    // The analyzer refuses this position independently (FS-D18, this round) and the
    // differential is what surfaced it: the oracle derived `Execute -> StringBuilder` for a
    // lambda parameter inside `Execute`, and the analyzer emitted nothing. Two positions, one
    // rule — a `fun_expression` between the pattern and the declaration.
    if (ancestorOfType(parent, "fun_expression", 6)) return null
    // A SECONDARY CONSTRUCTOR owns its parameters' written types, and the lookup below could
    // not reach one. `parentIsDecl` knows `additional_constr_defn`, but the ANCESTOR fallback
    // chain did not — and a constructor's parameter is not its direct child, so the chain is
    // what runs, and it walked straight past. Measured in Symbols.fs: 12 rows
    // (`constructor -> CcuThunk`, `-> SymbolEnv`, `-> range`, `-> ArgReprInfo` and the rest)
    // that the analyzer published and this oracle could not account for.
    //
    // The source is the same `constructor` name both sides use, which is why the rows joined
    // on nothing: a missing row and a wrong name look identical in a key comparison.
    const ctor = parent.type === "additional_constr_defn" ? parent : ancestorOfType(parent, "additional_constr_defn", 14)
    if (ctor) return { source: "constructor", declaredOn: "parameter" }
    const decl = parentIsDecl(parent) ? parent : ancestorOfType(parent, "member_defn", 14) ?? ancestorOfType(parent, "function_or_value_defn", 14) ?? ancestorOfType(parent, "value_declaration", 14)
    if (!decl) return null
    if (decl.type === "member_defn") {
      // A `static let` in a module has no `method_or_prop_defn` header, so the header lookup
      // answers null and every position inside the member loses its owner:
      //
      //     static let reportConflictingWellKnownMetadata (log: TaskLoggingHelper) …
      //       member_defn -> value_declaration -> function_or_value_defn
      //
      // Two rows per file in MapSourceRoots.fs, and the same shape throughout the corpus: the
      // parameter types of every `static let` in every module, dropped silently. The member's
      // own declaration is the fallback, and it is a name the analyzer publishes — which is
      // the only property an edge source has to have.
      const name = thisBindingName(decl) ?? declaredNameInsideMember(decl)
      if (!name) return null
      return { source: name, declaredOn: inArgs ? "parameter" : "return_type" }
    }
    // A `let` in a CLASS BODY is F#'s private field, so it belongs to the TYPE — but a
    // `let` inside a member's BODY is a LOCAL, and a local's written type belongs to the
    // enclosing CALLABLE. Those two look identical from below ("there is a type above
    // me"), and asking only that question attributed every local annotation to the class.
    // It showed up as one UNEXPLAINED row and nothing else: the class already had a
    // `declared_type` edge to the same type from its own field, so the oracle's wrong
    // row collapsed onto the right one and the mistake was invisible except as a
    // surplus. The distinguishing question is whether a CALLABLE sits between the
    // declaration and the type, so that is what is asked.
    const cls = ancestorOfType(decl, "type_definition", 6)
    if (cls && !hasCallableBetween(decl, cls)) {
      const tn = descendantsOfType(cls, "type_name", 3)[0]
      const name = typeNameOf(tn)
      if (name) return { source: name, declaredOn: "class_field" }
    }
    // A LOCAL's written type belongs to the enclosing CALLABLE — the member it is
    // written inside — and not to the local. Two separate mistakes live here, and the
    // differential showed one at a time. The first attributed the row to the CLASS
    // (fixed above). The second, once the class was out of the way, took
    // `thisBindingName(decl)` on the local itself, which answers with the local's own
    // name. The owner is the nearest callable ABOVE the local. When there is no such
    // ancestor the binding is a top-level one — the module or script top level — and
    // it IS its own owner, which is the `annotated : Bar` case in the same fixture, so
    // falling through is what keeps that row alive.
    if (!inArgs) {
      const owner = nearestCallableAncestor(decl)
      if (owner) {
        const ownerName = thisBindingName(owner)
        if (ownerName && isPublished(ownerName)) return { source: ownerName, declaredOn: "local_annotation" }
        // the owner is itself a local, so keep climbing to a PUBLISHED one
        const outer = nearestPublishedCallable(owner)
        return outer ? { source: outer, declaredOn: "local_annotation" } : null
      }
    }
    const name = thisBindingName(decl)
    if (!name) return null
    if (isPublished(name)) return { source: name, declaredOn: inArgs ? "parameter" : "return_type" }
    // A local's own parameter/return type belongs to the nearest PUBLISHED callable above
    // it, for the reason on `published`: `let select (methInfo:MethodInfo) = …` is not a
    // symbol, so an edge sourced to `select` resolves to nothing.
    const outer = nearestPublishedCallable(decl)
    return outer ? { source: outer, declaredOn: inArgs ? "parameter" : "return_type" } : null
  }

  /** The nearest enclosing callable whose name the lane publishes as a symbol. */
  function nearestPublishedCallable(n: any): string | null {
    const callable = ["member_defn", "function_or_value_defn", "value_declaration", "additional_constr_defn"]
    let cur: any = n?.parent
    while (cur) {
      if (callable.includes(cur.type)) {
        const nm = thisBindingName(cur)
        if (nm && isPublished(nm)) return nm
      }
      cur = cur.parent
    }
    return null
  }

  /**
   * The nearest enclosing declaration that can own a local.
   *
   * Note the node list: a local `let` in a member's body is a `function_or_value_defn`
   * in this grammar, NOT a `value_declaration`, so a guard that tested only for the
   * latter silently did nothing and the fix looked applied while changing no output.
   * That is verified against the tree in script/m14/tmp/fs029-oracle-local.ts rather
   * than assumed — the guard was wrong once already, and the tree is the only thing
   * that settles it.
   */
  function nearestCallableAncestor(n: any): any | null {
    const callable = ["member_defn", "function_or_value_defn", "value_declaration", "additional_constr_defn"]
    let cur: any = n?.parent
    while (cur) {
      if (callable.includes(cur.type)) return cur
      cur = cur.parent
    }
    return null
  }

  /**
   * Is there a CALLABLE between `decl` and its enclosing type?
   *
   * This is the question that separates F#'s two `let`s inside a class. Directly in the
   * class body, a `let` IS the private field and its written type belongs to the type.
   * Inside a member's body, the same `let` is a LOCAL and its written type belongs to
   * the member. Both have a `type_definition` above them; only the second has a
   * callable in between, and only the second is a local.
   *
   * The node list is a LOCAL, not a module-level `const`, and that is a consequence of
   * the layout rather than a style preference: the helpers in this file sit AFTER
   * `deriveFsharpEdges`'s `return`, so a `const` among them is dead code that is never
   * initialized — a function declaration is hoisted and works, a `const` does not, and
   * the failure appears at the first call as a ReferenceError with no obvious cause.
   */
  function hasCallableBetween(decl: any, cls: any): boolean {
    const callable = ["member_defn", "function_or_value_defn", "value_declaration", "additional_constr_defn"]
    let cur: any = decl?.parent
    while (cur && cur !== cls) {
      if (callable.includes(cur.type)) return true
      cur = cur.parent
    }
    return false
  }

  function parentIsDecl(n: any): boolean {
    return ["member_defn", "function_or_value_defn", "value_declaration", "additional_constr_defn"].includes(n.type)
  }

  function ancestorOfType(n: any, type: string, maxDepth = 12): any | null {
    let cur = n?.parent ?? null
    for (let i = 0; cur && i < maxDepth; i++) {
      if (cur.type === type) return cur
      cur = cur.parent
    }
    return null
  }
}
