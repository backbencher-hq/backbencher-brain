/**
 * The VB TRUTH ORACLE — LANE-OWNED, and independent of the analyzer it audits.
 *
 * ## Why this file exists at all
 *
 * `script/m60/rel-type-coverage-gate.ts` CHECK 1 reports, for vb:
 *
 *     vb   4 un-audited: ["calls","contains","imports","references"]
 *
 * A DERIVATION finding is a type the analyzer EMITS and the differential never
 * audits — stored and compared against nothing. The lane's own doc records the
 * consequence it had: the M14.0.F5 claim of "100% covered, 0 unexplained" was true
 * and invisible to the fact that a whole class of call edges was missing, because
 * the oracle that was supposed to notice had been removed from
 * `script/m14/differential.ts`. That removal is a fact about this repo:
 *
 *     $ git show HEAD:script/m14/differential.ts | grep -c 'lang === "vb"'
 *     0
 *
 * while at b0c1d19ce ("fix(vb): every F5 red row adjudicated") it is 2, and that
 * commit IS an ancestor of HEAD. The oracle was lost during the 2026-10-01
 * reflog-archive recovery, and `verify-oracle-coverage.ts` does not notice: it
 * reports only lanes that have a compared set or an oracle block, and vb now has
 * neither, so it is absent from a 36-language table whose VERDICT is PASS.
 *
 * So this oracle is the lane's own, beside the other lane oracles
 * (`ruby-truth.ts`, `nim-truth-oracle.ts`, `fsharp-truth-oracle.ts`) rather than in
 * the shared file, for the reason `differential.ts`'s own header records: it is
 * edited by several lanes at once, and every line a lane keeps out of a shared file
 * is a line that cannot conflict.
 *
 * ## INDEPENDENCE, and the limit of it
 *
 * The oracle walks the SAME parse tree with the SAME grammar. That is the harness's
 * declared limitation and it is stated here rather than papered over: a grammar bug
 * shared by both paths is invisible, because neither of them can see it. What this
 * oracle CAN disagree with is the analyzer's DECISIONS — which node it treats as
 * the callee, which name it reduces to, which shape it reads a field from, whether
 * it publishes an edge at all — and those are exactly the decisions that produced
 * every defect this lane has found.
 *
 * The rules below are written from the LANGUAGE and from the tree, and they call no
 * function from `real-vb-analyzer.ts`. An oracle that calls the thing it audits
 * cannot disagree with it, and a gate that cannot fail is worse than no gate.
 *
 * ## The rules, one per label
 *
 *   contains    owner -> member, for every declaration inside another
 *   calls       a call site: the callee is the LAST identifier leaf; a call WITH
 *               arguments is an `array_access_expression` in this grammar
 *   uses        a member read that is neither a callee nor an assignment LHS
 *   references  a type name in a DECLARATION's signature (`as_clause`), never in
 *               a body — the family's contract, and the analyzer's, is that a
 *               local is not a project-symbol-table member
 *   extends     a name in an `inherits_statement` or `inherits_member_clause`
 *   implements  a name in an `implements_statement` / `implements_member_clause`
 *   imports     every name an `imports_statement` names
 *   overrides   a member carrying the `Overrides` modifier
 *   instantiates  a construction: `object_creation_expression`,
 *               `array_creation_expression`, or a `New` inside an invocation
 *
 * Every derivation is a node-type test, a field read or a child-position read. No
 * text matching, and no regex, anywhere in this file.
 */

// ---------------------------------------------------------------------------
// node helpers — no regex, no text patterns
// ---------------------------------------------------------------------------

function kids(n: any): any[] {
  const out: any[] = []
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c) out.push(c)
  }
  return out
}
function nc(n: any, i: number): any {
  if (i < 0 || i >= n.namedChildCount) return null
  return n.namedChild(i)
}
function childrenOfType(n: any, type: string): any[] {
  const out: any[] = []
  for (const c of kids(n)) if (c.type === type) out.push(c)
  return out
}
function text(n: any): string {
  if (!n) return ""
  return String(n.text ?? "").trim()
}

/** The LAST identifier leaf at or under `n`, skipping a type-argument list. */
function lastNameLeaf(n: any, depth = 0): any {
  if (!n || depth > 64) return null
  if (n.type === "type_argument_list") return null
  if (n.type === "identifier") return n
  // `predefined_type` is a NAME too. Leaving it out is how this oracle came to
  // derive `references -> Main -> String()` for `Sub Main(args As String())`: an
  // `array_type` whose element is a `predefined_type` has no identifier leaf at all,
  // so the search found nothing and the oracle fell back to the whole node's text.
  // The analyzer's `namingToken` has an `array_type` branch for exactly this and
  // returned `String`, so the two disagreed on 34 rows per 200 files about whether
  // the target carried parens.
  if (n.type === "predefined_type") return n
  for (let i = n.childCount - 1; i >= 0; i--) {
    const c = n.child(i)
    if (!c) continue
    const r = lastNameLeaf(c, depth + 1)
    if (r) return r
  }
  return null
}

/**
 * THE CONSTRUCTED TYPE OF A QUALIFIED `New`. The grammar fragments `New System.Windows.Forms.Panel()`
 * into an `object_creation_expression` holding only `New System`, nested inside one
 * `member_access_expression` per dot and finally an `invocation_expression` (measured tree, DISMTools
 * `Panels/Get_Ops/Pkgs/GetPkgInfo.Designer.vb:25`). Reading the object_creation's own `type` field therefore
 * named the NAMESPACE (`instantiates InitializeComponent -> System`, 524 truth rows on one generated file)
 * while the analyzer publishes the full constructed type. Walk the enclosing chain to its outermost node and
 * take the LAST name leaf: that is the type the `New` actually constructs.
 */
function constructionTypeLeaf(n: any): any {
  const start = n
  let cur = n
  for (let i = 0; i < 64; i++) {
    const p = cur?.parent
    if (!p) break
    if ((p.type === "member_access_expression" || p.type === "with_member_access_expression") && p.namedChild(0)?.id === cur.id) { cur = p; continue }
    if (p.type === "invocation_expression" && p.childForFieldName?.("function")?.id === cur.id) { cur = p; continue }
    break
  }
  // NO CLIMB: the node's own `type` FIELD is the constructed type. `New Element(Element.Types.Psychic)`'s
  // object_creation node carries its ARGUMENT LIST, so a last-leaf scan of the node names the last identifier
  // in the ARGUMENT (`instantiates -> Psychic`) instead of the type — measured on P3D-Legacy's Confusion.vb.
  if (cur === start) {
    const ty = n.childForFieldName?.("type")
    if (ty) return lastNameLeaf(ty)
  }
  return lastNameLeaf(cur)
}

/** True when an invocation's function chain bottoms out in an `object_creation_expression` (a qualified `New`). */
function invocationConstructs(n: any): boolean {
  let cur = n
  for (let i = 0; i < 64; i++) {
    if (!cur) return false
    if (cur.type === "object_creation_expression") return true
    if (cur.type === "member_access_expression" || cur.type === "with_member_access_expression" || cur.type === "parenthesized_expression") { cur = cur.namedChild(0); continue }
    return false
  }
  return false
}

/** Node types that hold a NAME rather than an expression, so a member access in
 *  one of them is a qualified name and not a member READ.
 *
 *  MEASURED, because the first version of this oracle derived a `uses` edge for
 *  every segment of `Namespace Microsoft.CodeAnalysis.VisualBasic.AddOr...` — the
 *  grammar parses a namespace's trailing segments as `member_access_expression`,
 *  so the name of a namespace produced 53 `uses` rows per 40 files that the
 *  analyzer correctly does not publish. A name is not a read. */
const NAME_POSITION: ReadonlySet<string> = new Set([
  "namespace_declaration", "imports_statement", "inherits_statement", "implements_statement",
  "implements_member_clause", "inherits_member_clause", "as_clause", "class_declaration",
  "structure_declaration", "interface_declaration", "module_declaration", "enum_declaration",
  "delegate_declaration",
  // An attribute argument is a read made by the COMPILER, not by the enclosing
  // member: `<DiagnosticAnalyzer(LanguageNames.VisualBasic)>` is on the type but is
  // not that type reading a member. Without this row the oracle derived a `uses`
  // edge for every attribute argument in the corpus — 79 phantom rows in 60 files,
  // all of them reporting the analyzer as missing something.
  "attribute_list", "attribute", "attribute_target", "attribute_argument_list",
])

/** Is this node inside a NAME rather than inside an expression? */
function inNamePosition(n: any): boolean {
  let a: any = n
  for (let i = 0; a !== null && a !== undefined && i < 6; i++) {
    const p = a.parent
    if (!p) return false
    if (NAME_POSITION.has(p.type)) return true
    // `member_access_expression` and `named_argument` are in the climb because a
    // QUALIFIED name is NESTED. `Traits.Features.CodeActionsFoo` inside
    // `<Trait(...)>` is an attribute argument whose RECEIVER is another member
    // access, so a climb that stopped at the first non-name parent derived a `uses`
    // row for `Features` in every test class's trait attribute — 57 phantom rows per
    // 200 files. And `IDEDiagnosticIds.X` inside `MyBase.New(id:=IDEDiagnosticIds.X)`
    // is a genuine read that must NOT be excluded, which is why `named_argument`
    // belongs on the CLIMB and not in the name-position set.
    if (p.type === "identifier" || p.type === "simple_name" || p.type === "qualified_name" ||
        p.type === "global_qualified_name" || p.type === "generic_name" || p.type === "name_colon" ||
        p.type === "member_access_expression" || p.type === "named_argument") { a = p; continue }
    return false
  }
  return false
}

const NAME_TYPES: ReadonlySet<string> = new Set([
  "identifier", "simple_name", "qualified_name", "global_qualified_name", "generic_name",
])

/** Every name-bearing child, descending through wrappers that carry none. */
function nameNodes(n: any): any[] {
  const out: any[] = []
  const stack: any[] = [n]
  while (stack.length > 0) {
    const cur = stack.pop()!
    for (const c of kids(cur)) {
      if (NAME_TYPES.has(c.type)) out.push(c)
      else stack.push(c)
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// the declaration model the oracle builds, from the tree alone
// ---------------------------------------------------------------------------

export type TruthRow = {
  label: string
  from: string
  target: string
  line: number
}

const TYPE_DECLS: ReadonlySet<string> = new Set([
  "class_declaration", "structure_declaration", "interface_declaration", "module_declaration",
])
const MEMBER_DECLS: ReadonlySet<string> = new Set([
  "method_declaration", "constructor_declaration", "property_declaration", "event_declaration",
  "interface_method_declaration", "interface_property_declaration", "interface_event_declaration",
  "operator_declaration",
])

export type FileTruth = {
  rows: TruthRow[]
  /** names this file declares, for resolvability */
  declared: Set<string>
  /** gaps the oracle itself declines to derive, counted rather than guessed */
  declined: Record<string, number>
}

function declaredNameOf(n: any): string {
  const field = n.childForFieldName?.("name")
  if (field) return text(lastNameLeaf(field) ?? field)
  for (const c of kids(n)) {
    if (c.type === "identifier" || c.type === "simple_name") return text(lastNameLeaf(c) ?? c)
  }
  return ""
}

/**
 * The whole derivation for one file.
 *
 * `ctx` is threaded rather than kept in module state so the oracle is re-entrant
 * and two files cannot bleed into one another — the TSD6/mirror-oracle failure the
 * erlang lane recorded, where an oracle that shares state reports agreement it did
 * not measure.
 */
export function deriveVbTruth(root: any): FileTruth {
  const rows: TruthRow[] = []
  const declared = new Set<string>()
  const declined: Record<string, number> = {}
  const bump = (k: string): void => { declined[k] = (declined[k] ?? 0) + 1 }

  // ---- pass 1: declarations, and the containment hierarchy --------------
  // A declaration's OWNER is read by climbing to the nearest enclosing type or
  // namespace node, which is what the analyzer's ownerStack emulates. Doing it by
  // climbing rather than by threading state is the point: two implementations of
  // the same rule that share an implementation are not two implementations.
  type DeclRec = { name: string; kind: string; node: any; owner: string | null }
  const decls: DeclRec[] = []

  const walkDecls = (n: any): void => {
    let owner: string | null = null
    let p = n.parent
    for (let i = 0; p !== null && p !== undefined && i < 24; i++) {
      if (TYPE_DECLS.has(p.type) || p.type === "namespace_declaration" || p.type === "enum_declaration") {
        owner = declaredNameOf(p)
        if (owner.length > 0) break
        owner = null
      }
      p = p.parent
    }
    if (n.type === "namespace_declaration") {
      const nm = declaredNameOf(n)
      if (nm.length > 0) { decls.push({ name: nm, kind: "namespace", node: n, owner: null }); declared.add(nm) }
    } else if (TYPE_DECLS.has(n.type)) {
      const nm = declaredNameOf(n)
      if (nm.length > 0) { decls.push({ name: nm, kind: "type", node: n, owner }); declared.add(nm) }
    } else if (n.type === "enum_declaration") {
      const nm = declaredNameOf(n)
      if (nm.length > 0) { decls.push({ name: nm, kind: "enum", node: n, owner }); declared.add(nm) }
    } else if (n.type === "operator_declaration") {
      // MUST come before the MEMBER_DECLS branch, because `operator_declaration` is
      // in MEMBER_DECLS and has NO `name` field — so the member branch caught it
      // first, `declaredNameOf` returned "", and both operators in
      // VisualBasicAnalyzerOptionsProvider.vb were absent from the truth entirely
      // while the analyzer published `contains ... -> operator`. The first version
      // of this oracle therefore reported the analyzer's operator containment as
      // UNEXPLAINED, which was the oracle's bug and not a fabricated edge.
      decls.push({ name: "operator", kind: "member", node: n, owner })
      declared.add("operator")
    } else if (MEMBER_DECLS.has(n.type)) {
      // A CONSTRUCTOR IS NAMED BY THE CONTRACT, not by the source: `Public Sub New()`
      // has no `name` field because `New` is an anonymous token.
      const nm = n.type === "constructor_declaration" ? "constructor" : declaredNameOf(n)
      if (nm.length > 0) { decls.push({ name: nm, kind: "member", node: n, owner }); declared.add(nm) }
    } else if (n.type === "delegate_declaration") {
      const nm = declaredNameOf(n)
      if (nm.length > 0) { decls.push({ name: nm, kind: "type", node: n, owner }); declared.add(nm) }
    } else if (n.type === "declare_statement") {
      const nm = declaredNameOf(n)
      if (nm.length > 0) { decls.push({ name: nm, kind: "member", node: n, owner }); declared.add(nm) }
    } else if (n.type === "field_declaration") {
      for (const d of childrenOfType(n, "variable_declarator")) {
        const nm = declaredNameOf(d)
        if (nm.length > 0) { decls.push({ name: nm, kind: "field", node: d, owner }); declared.add(nm) }
      }
    } else if (n.type === "enum_member_declaration") {
      const nm = declaredNameOf(n)
      if (nm.length > 0) { decls.push({ name: nm, kind: "enumMember", node: n, owner }); declared.add(nm) }
    }
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i)
      if (c) walkDecls(c)
    }
  }
  walkDecls(root)

  for (const d of decls) {
    if (d.owner !== null && d.owner.length > 0 && d.owner !== d.name) {
      rows.push({ label: "contains", from: d.owner, target: d.name, line: d.node.startPosition.row + 1 })
    }
  }

  // ---- modifiers, read by NODE TYPE ------------------------------------
  // `member_modifier` is the grammar's own node for a modifier, and the field is
  // emitted once per modifier, so counting nodes is the only reliable read.
  const hasModifier = (n: any, want: string): boolean => {
    let found = false
    const stack: any[] = [n]
    while (stack.length > 0) {
      const cur = stack.pop()!
      if (cur.type === "member_modifier") {
        const t = String(cur.text ?? "").toLowerCase()
        if (t === want) { found = true; break }
      }
      if (cur.type === "class_declaration" || cur.type === "structure_declaration" ||
          cur.type === "interface_declaration" || cur.type === "module_declaration") break
      for (const c of kids(cur)) stack.push(c)
    }
    return found
  }

  // ---- heritage ---------------------------------------------------------
  const heritage = (owner: string, clauses: string[], label: string, full: boolean): void => {
    for (const d of decls) {
      if (d.name !== owner) continue
      for (const cl of clauses) {
        for (const st of childrenOfType(d.node, cl)) {
          for (const nm of nameNodes(st)) {
            // A member-level heritage name is kept WHOLE: `IThing.Refresh` is only
            // identified by its interface, and last-segment reduction would publish
            // `implements Refresh -> Refresh`, a self-edge that answers nothing.
            const t = full ? text(nm) : text(lastNameLeaf(nm) ?? nm)
            if (t.length > 0 && t !== owner) {
              rows.push({ label, from: owner, target: t, line: nm.startPosition.row + 1 })
            }
          }
        }
      }
    }
  }
  for (const d of decls) {
    heritage(d.name, ["inherits_statement"], "extends", false)
    heritage(d.name, ["inherits_member_clause"], "extends", false)
    heritage(d.name, ["implements_statement"], "implements", false)
    heritage(d.name, ["implements_member_clause"], "implements", true)
  }

  // ---- overrides --------------------------------------------------------
  for (const d of decls) {
    if (d.kind !== "member") continue
    if (!hasModifier(d.node, "overrides")) continue
    const base = decls.find((x) => x.kind === "type" && x.name === d.owner)
    const baseType = base ? (rows.find((r) => r.label === "extends" && r.from === d.owner)?.target ?? undefined) : undefined
    rows.push({
      label: "overrides",
      from: d.name,
      target: baseType ? `${baseType}.${d.name}` : d.name,
      line: d.node.startPosition.row + 1,
    })
  }

  // ---- imports ----------------------------------------------------------
  const importStack: any[] = [root]
  while (importStack.length > 0) {
    const n = importStack.pop()!
    if (n.type === "imports_statement") {
      for (const nm of nameNodes(n)) {
        const leaf = lastNameLeaf(nm)
        const t = text(leaf ?? nm)
        if (t.length > 0) rows.push({ label: "imports", from: "root", target: t, line: (leaf ?? nm).startPosition.row + 1 })
      }
    }
    for (const c of kids(n)) importStack.push(c)
  }

  // ---- signature type references ---------------------------------------
  // A `references` edge is a TYPE NAME in a DECLARATION's signature. The oracle
  // deliberately does NOT walk bodies: `Dim x As Pokemon` inside a method is a
  // local, and locals are not project-symbol-table members. That restriction is
  // the same one the analyzer holds, and it is stated in both so a future change to
  // either is visible as a disagreement rather than as a quiet widening.
  for (const d of decls) {
    // A declaration with NO RESOLVABLE OWNER still gets its signature read. The
    // first version skipped those declarations, on the reasoning that a row whose
    // source has no owner is not navigable — and that reasoning is wrong: the SOURCE
    // of a `references` row is the member, the member is published, and the edge
    // says "this member names that type". Skipping made the oracle report the
    // analyzer's rows UNEXPLAINED (3 per 60 files, in files the grammar collapsed),
    // which would have been the oracle accusing the analyzer of fabricating edges it
    // is in fact publishing correctly. The count is kept so the size of the
    // grammar defect's blast radius on this label stays visible.
    if (d.owner === null) bump("signature-of-ownerless-declaration")
    // THE SIGNATURE, AND ONLY THE SIGNATURE. `walkSig` descends through the node
    // types a signature is MADE OF and refuses to descend into anything else, so
    // it cannot reach a member declaration nested in a type or a `Dim x As T` local
    // in a body. The first version of this oracle walked `d.node` to a depth limit
    // and therefore attributed a TYPE's members' parameters to the TYPE, which
    // showed up as 195 missing `references` rows and was entirely the oracle's
    // error rather than the analyzer's.
    const SIG_TYPES: ReadonlySet<string> = new Set([
      "modifiers", "member_modifier", "local_declaration_modifier",
      "parameter_list", "parameter", "as_clause",
      "attribute_list", "attribute", "attribute_target", "attribute_argument_list", "named_argument",
      "type_parameter_list", "type_parameter",
      "variable_declarator", "array_rank_specifier", "array_initializer",
      "inherits_statement", "implements_statement", "inherits_member_clause", "implements_member_clause",
    ])
    const walkSig = (n: any, depth: number): void => {
      if (depth > 12) return
      if (n.type === "as_clause") {
        const dt = n.childForFieldName?.("declared_type")
        if (dt) {
          // A TUPLE IS NOT A TYPE NAME. `As (A, B, C)` and
          // `As Function(x As X, y As Y)` are both `tuple_type`, and there is no
          // single name an edge could target — so neither side derives a
          // `references` row for one, and the count of how often that suppressed a
          // row is reported rather than left to be inferred.
          if (dt.type === "tuple_type") { bump("tuple-type-has-no-single-name"); return }
          const leaf = lastNameLeaf(dt)
          const t = text(leaf ?? dt)
          if (t.length > 0 && !declared.has(t)) {
            rows.push({ label: "references", from: d.name, target: t, line: (leaf ?? dt).startPosition.row + 1 })
          }
        }
        return
      }
      if (depth > 0 && !SIG_TYPES.has(n.type)) return
      for (const c of kids(n)) walkSig(c, depth + 1)
    }
    walkSig(d.node, 0)
  }

  // ---- body edges: calls / instantiates / uses --------------------------
  //
  // Source is the nearest enclosing DECLARED member — read by climbing, which is
  // what makes this an independent implementation of the same rule rather than the
  // analyzer's own stack.
  /**
   * The declaration a site belongs to — by CLIMBING, which is what makes this an
   * independent implementation of the same rule rather than the analyzer's own
   * stack — and, crucially, the declaration node that CONTAINS the site.
   *
   * The containment test is not a formality. When the grammar's recovery splits a
   * declaration, the part after the split becomes a SIBLING of the declaration
   * rather than a child of it: UseCompoundAssignment/Utilities.vb's
   * `ImmutableArray.Create((A,B,C), (D,E,F), ...)` initializer leaves a
   * `field_declaration` spanning rows 9-12 with rows 12-19 in ERROR siblings beside
   * it. An analyzer that walks bodies from each declaration therefore cannot reach
   * rows 12-19, and an oracle that does reach them would report every one as a
   * missing edge — which would be the oracle claiming the analyzer fabricated a
   * defect it cannot fix. So the oracle declines a site whose declaration does not
   * span it, and COUNTS the decline.
   */
  const enclosingMemberName = (n: any): string | null => {
    let p = n.parent
    for (let i = 0; p !== null && p !== undefined && i < 40; i++) {
      if (MEMBER_DECLS.has(p.type)) {
        if (p.startIndex > n.startIndex || p.endIndex < n.endIndex) { bump("body-in-recovery-sibling"); return null }
        if (p.type === "constructor_declaration") return "constructor"
        // An operator is named by the CONTRACT literal, for the same reason a
        // constructor is: `Operator +` has no `name` field, so there is nothing to
        // read. Without this row the oracle declined every call inside an operator
        // and the analyzer's `calls -> operator -> VisualBasicAnalyzerOptionsProvider`
        // read as three unexplained edges.
        if (p.type === "operator_declaration") return "operator"
        const nm = declaredNameOf(p)
        return nm.length > 0 ? nm : null
      }
      if (TYPE_DECLS.has(p.type) || p.type === "enum_declaration") {
        if (p.startIndex > n.startIndex || p.endIndex < n.endIndex) { bump("body-in-recovery-sibling"); return null }
        return declaredNameOf(p) || null
      }
      p = p.parent
    }
    return null
  }

  const isCallee = (n: any): boolean => {
    let a: any = n
    for (let i = 0; a !== null && a !== undefined && i < 12; i++) {
      const p = a.parent
      if (!p) return false
      // A VB CALL WITH PARENTHESES CAN PARSE AS AN ARRAY ACCESS. Measured shape (P3D-Legacy,
      // `P3D/Pokemon/Attacks/Psychic/Confusion.vb:70`,
      // `BattleScreen.Battle.InflictConfusion(Not own, own, ...)`):
      //   expression_statement -> array_access_expression
      //                             member_access_expression(BattleScreen.Battle.InflictConfusion)
      //                             unary_expression(Not own) ...
      // The callee branch below already treats the call-shaped array access as a call (declared callable OR
      // the whole statement), but THIS guard only recognised `invocation_expression`, so the member access
      // leaf ALSO produced a `uses` row for the same site. The analyzer publishes one `calls` row; the
      // oracle published `calls` + `uses`, and the extra row read as MISSING on every draw. Same predicate as
      // the callee branch, applied here so the two branches cannot disagree about what a callee is.
      if (p.type === "array_access_expression") {
        const callee = p.namedChild(0)
        if (callee && callee.id === a.id) {
          const leaf = lastNameLeaf(a)
          const t = text(leaf)
          const viaStatement = !!p.parent && p.parent.type === "expression_statement" && p.parent.namedChildCount === 1
          if (viaStatement || (t.length > 0 && callables.has(t))) return true
        }
        a = p
        continue
      }
      if (p.type === "member_access_expression" || p.type === "with_member_access_expression") {
        // THE RECEIVER OF A CHAIN IS A READ, NOT A CALLEE. For `BattleScreen.Battle.InflictConfusion(...)` the
        // analyzer publishes `uses -> Battle` for the receiver `BattleScreen.Battle` (the property is READ to
        // obtain the object whose Sub is then invoked) and one `calls -> InflictConfusion` for the final
        // segment. This guard used to climb the whole chain and mark EVERY member a callee, so the oracle
        // derived no `uses -> Battle` row and the analyzer's row read as unexplained (measured: `uses->Battle`
        // in Confusion.vb, `uses->SpriteBatch` in TextQueryObject.vb). A member access is the callee only when
        // it is the LAST segment of the chain (the field, not the receiver).
        const receiver = p.namedChild(0)
        if (receiver && receiver.id === a.id) return false
        a = p
        continue
      }
      if (p.type === "parenthesized_expression") { a = p; continue }
      if (p.type === "invocation_expression") {
        const fn = p.childForFieldName?.("function")
        return !!fn && fn.id === a.id
      }
      return false
    }
    return false
  }
  const isLhsWrite = (n: any): boolean => {
    let a: any = n.parent
    for (let i = 0; a !== null && a !== undefined && i < 6; i++) {
      if (a.type === "member_access_expression" || a.type === "with_member_access_expression" ||
          a.type === "identifier" || a.type === "array_access_expression") { a = a.parent; continue }
      break
    }
    if (!a) return false
    if (a.type !== "assignment_expression" && a.type !== "assignment_statement") return false
    const l = a.childForFieldName?.("left") ?? a.childForFieldName?.("target")
    return !!l && l.startIndex <= n.startIndex && l.endIndex >= n.endIndex
  }

  // The two call signals, derived here from the declaration model the oracle
  // built, rather than from the analyzer's `callablesInFile` set.
  const callables = new Set<string>()
  const arrayValued = new Set<string>()
  const variables = new Set<string>()
  for (const d of decls) {
    // CALLABLE means "something this file declares can be CALLED": a method, a
    // property, a constructor or an operator. A FIELD is deliberately NOT callable
    // here even though VB lets a delegate field be invoked — the field's declared
    // type would have to be read to know it is one, and guessing would be
    // fabrication. A field goes in `variables` instead, which is what keeps a
    // statement-level `arr(0)` out of the call set.
    if (d.kind === "member") callables.add(d.name)
    if (d.kind === "field") variables.add(d.name)
    for (const cl of childrenOfType(d.node, "as_clause")) {
      const dt = cl.childForFieldName?.("declared_type")
      if (!dt) continue
      const stack: any[] = [dt]
      while (stack.length > 0) {
        const cur = stack.pop()!
        if (cur.type === "array_type") { arrayValued.add(d.name); break }
        for (const c of kids(cur)) stack.push(c)
      }
    }
  }

  const usesSeen = new Map<string, number>()
  const bodyStack: any[] = [root]
  while (bodyStack.length > 0) {
    const n = bodyStack.pop()!
    const src = enclosingMemberName(n)
    if (n.type === "invocation_expression") {
      const fn = n.childForFieldName?.("function")
      const leaf = lastNameLeaf(fn)
      const t = text(leaf)
      if (fn && t.length > 0) {
        // `New X(...)` is a construction, not a call: the lane's contract gives it exactly one label,
        // `instantiates` (below). The invocation branch used to publish `calls` for the same site as well,
        // which the fixtures forbid and the differential charged as MISSING.
        // A qualified `New` arrives as an invocation whose function is a member-access chain over an
        // object_creation (see constructionTypeLeaf). It is a construction, so it gets exactly one label,
        // `instantiates` — published by the object_creation branch below, with the FULL constructed type.
        const isConstruction = fn.type === "object_creation_expression" || invocationConstructs(fn)
        if (src && !isConstruction) rows.push({ label: "calls", from: src, target: t, line: (leaf ?? fn).startPosition.row + 1 })
        else if (!src) bump("call-without-enclosing-member")
        if (fn.type === "object_creation_expression") {
          const tyLeaf = lastNameLeaf(fn.childForFieldName?.("type") ?? fn)
          const it = text(tyLeaf)
          if (src && it.length > 0) {
            rows.push({ label: "instantiates", from: src, target: it, line: (tyLeaf ?? fn).startPosition.row + 1 })
          }
        }
      }
    } else if (n.type === "object_creation_expression" || n.type === "array_creation_expression") {
      // The FULL constructed type, walked through the enclosing dotted chain (measured grammar shape).
      const leaf = constructionTypeLeaf(n)
      const t = text(leaf)
      if (t.length > 0) {
        if (src) {
          // ONE LABEL, NOT TWO. A construction is `instantiates` and NOTHING ELSE — the lane's own fixture
          // contract states it (`vb/declaration-shapes`: expected `instantiates Build -> Box` at line 55
          // AND forbidden `calls Build -> Box`, "ONE LABEL, NOT TWO ... a construction is `instantiates` and
          // nothing else"). This oracle also derived `calls`, which read as MISSING on every draw (measured
          // on the restored P3D-Legacy corpus: `calls->Element`, `calls->Rectangle`, `calls->TextQueryObject`,
          // `calls->Color`, `calls->Vector2`, `calls->MySettings` — all `New X(...)` sites). The truth side
          // must obey the same declared contract the fixtures enforce, not a private second reading.
          rows.push({ label: "instantiates", from: src, target: t, line: (leaf ?? n).startPosition.row + 1 })
        } else bump("construction-without-enclosing-member")
      }
    } else if (n.type === "array_access_expression") {
      // The callee is the FIRST named child, not the last identifier leaf under the
      // node: `ImmutableArray.Create(BC36556)` ends in an ARGUMENT, and a
      // last-leaf reading publishes `calls -> BC36556`. Derived here from the node's
      // own children rather than from the analyzer's helper, because sharing the
      // helper would make the oracle agree with a bug by construction.
      const callee = nc(n, 0)
      const leaf = lastNameLeaf(callee)
      const t = text(leaf)
      if (t.length > 0) {
        const viaDeclaration = callables.has(t) && !arrayValued.has(t)
        const parent = n.parent
        const viaStatement = !!parent && parent.type === "expression_statement" && parent.namedChildCount === 1
        if (viaDeclaration || viaStatement) {
          if (src) rows.push({ label: "calls", from: src, target: t, line: (leaf ?? n).startPosition.row + 1 })
          else bump("call-without-enclosing-member")
        } else {
          bump("index-or-call-ambiguous")
        }
      }
      void callee
    } else if (n.type === "member_access_expression" || n.type === "with_member_access_expression") {
      const leaf = lastNameLeaf(n)
      const t = text(leaf)
      if (src && t.length > 0 && !isCallee(n) && !isLhsWrite(n) && !inNamePosition(n)) {
        // The dedup keeps the EARLIEST site line, for the same reason the analyzer's
        // does: "first visited" is a property of the traversal and this oracle's is a
        // stack, so keeping the first site would put the two sides on different
        // lines for the same edge and make the comparison about traversal order
        // rather than about the decision. The MINIMUM is a property of the file.
        const key = `${src}->${t}`
        const line = (leaf ?? n).startPosition.row + 1
        const prior = usesSeen.get(key)
        if (prior === undefined) { usesSeen.set(key, line); rows.push({ label: "uses", from: src, target: t, line }) }
        else if (line < prior) {
          usesSeen.set(key, line)
          const row = rows.find((r) => r.label === "uses" && r.from === src && r.target === t)
          if (row) row.line = line
        }
      }
    }
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i)
      if (c) bodyStack.push(c)
    }
  }

  return { rows, declared, declined }
}

/** The labels this oracle derives. Read by the lane's own runner, not the shared gate. */
export const VB_ORACLE_LABELS: readonly string[] = [
  "calls", "uses", "contains", "imports", "references", "extends", "implements", "overrides", "instantiates",
]