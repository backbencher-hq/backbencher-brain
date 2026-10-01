// ER3 wave — the Erlang dual-lens ORACLE.
//
// An INDEPENDENT derivation of every symbol and every relationship the analyzer
// claims, written from the language contract and the pinned grammar's measured
// shapes — not from the analyzer's code. `script/m14/differential.ts` is a
// shared file another lane is editing, and its `deriveErlangEdges` is a mirror
// of the PRE-ER3 analyzer (it still uses the two-atom DFS-order remote read and
// the clause-head-only pattern test), so it cannot serve as this wave's second
// lens.
//
// The two implementations differ in ALGORITHM, not just in spelling, because a
// mirror only proves the code ran:
//   analyzer  pattern test   ancestor climb per node  (isPatternPosition)
//   oracle    pattern test   downward span marking    (markPatternSpans)
//   analyzer  remote read    direct child of `remote` vs atom inside remote_module
//   oracle    remote read    named-child index scan + the two spans must be siblings
//   analyzer  clause merge   fun_decl identity + file-wide clause tally
//   oracle    clause merge   ordered scan of top-level forms, run-length by identity
//   analyzer  type refs      one walk per declaration, span-containment skip
//   oracle    type refs      per-type walk with an explicit skip-span list
//
// Usage: bun run script/m14/tmp/erlang-oracle.ts <file.erl> [...]
import type { Node } from "web-tree-sitter"

export interface OracleEdge {
  type: string
  source: string
  target: string
  line: number
  context?: string
  arity?: number
}

export interface OracleSymbol {
  name: string
  kind: string
  ownerName?: string
  arity?: number
  clauseCount?: number
  isCallback?: boolean
  isOpaque?: boolean
  isMacro?: boolean
  line: number
}

export interface OracleFile {
  moduleName: string
  symbols: OracleSymbol[]
  edges: OracleEdge[]
  /** Every node type the walk entered, for the coverage cross-check. */
  typesSeen: Set<string>
  /**
   * Remote calls whose module is a macro — ER-D35, no derivable callee. Counted
   * rather than emitted, so the class is reported instead of silently becoming
   * a zero (measured: 922 across the 4,326-file corpus, all in one file).
   */
  macroModuleRemotes: number
  /** Whole-file grammar damage: no fun_decl and no module attribute at the top. */
  grammarDamaged?: boolean
  topLevelErrorNodes?: number
}

const TYPE_SCOPE = new Set([
  "spec", "callback", "type_alias", "opaque", "nominal", "type_sig", "fun_type_sig",
  "ann_type", "ann_var", "field_type", "fun_type", "range_type", "var_args",
  "type_name", "type_guards", "pipe",
])
const ARM = new Set(["cr_clause", "if_clause", "catch_clause", "receive_after"])
const COMPREHENSION = new Set(["list_comprehension", "binary_comprehension", "map_comprehension"])
const SPAWN = new Set(["spawn", "spawn_link", "spawn_monitor"])
const MATCH_OPS = new Set(["=", "?=", "<-", "<:=", "<="])
const OTP = new Set(["gen_server", "gen_statem", "gen_event", "supervisor", "application"])

const kids = (n: any): any[] => {
  const r: any[] = []
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c) r.push(c)
  }
  return r
}
const childByType = (n: any, t: string): any => {
  for (const c of kids(n)) if (c.type === t) return c
  return undefined
}
const atomIn = (n: any | undefined): any => (n ? childByType(n, "atom") : undefined)
const digits = (t: string | undefined): number => {
  if (!t) return 0
  let s = ""
  for (const ch of t) if (ch >= "0" && ch <= "9") s += ch
  return s.length ? parseInt(s, 10) : 0
}
const argCount = (args: any): number => kids(args).filter((c: any) => c.type !== "comment").length
const line1 = (n: any): number => n.startPosition.row + 1
const stripHash = (t: string): string => (t.startsWith("#") ? t.slice(1) : t)

interface Spec {
  params: string[]
  ret?: string
}

/**
 * Downward span marking for pattern positions. For every node that begins a
 * pattern context (a clause head, a match's left side, a generator's left side)
 * the WHOLE subtree is marked, recursively — which is why a nested record inside
 * a head pattern is a pattern too, and why a record inside a match's RIGHT side
 * is not. Membership is then an O(1) span containment test at use time.
 */
function markPatternSpans(root: any): { start: number; end: number }[] {
  const spans: { start: number; end: number }[] = []
  const markSubtree = (n: any) => {
    spans.push({ start: n.startIndex, end: n.endIndex })
    for (const c of kids(n)) markSubtree(c)
  }
  const inSpan = (n: any): boolean =>
    spans.some((s) => s.start <= n.startIndex && n.endIndex <= s.end)

  const visit = (n: any) => {
    const t = n.type
    if (t === "function_clause" || t === "fun_clause") {
      // Everything before the clause_body is the head — EXCEPT a guard, which
      // computes. Marking the guard subtree as pattern was a real oracle defect
      // the differential found against the analyzer: `D#decision.disc_nodes == []`
      // in a `when` clause is a member READ, and the oracle was dropping it.
      for (const c of n.children ?? []) {
        if (c.type === "clause_body") break
        if (c.type === "guard") continue
        if (c.isNamed) markSubtree(c)
      }
    } else if (t === "cr_clause") {
      // Same guard exclusion as a clause head: a `when` guard inside a case arm
      // computes. `U when U#decision.tid == Tid ->` is a member READ.
      for (const c of n.children ?? []) {
        if (c.type === "clause_body") break
        if (c.type === "guard") continue
        if (c.isNamed) markSubtree(c)
      }
    } else if (t === "match_expr" || t === "cond_match_expr" || t === "lc_or_zc_expr") {
      // The left side up to the boundary operator is a pattern. An `lc_or_zc_expr`
      // with NO operator is a comprehension FILTER, which computes: marking it
      // wholesale was the second half of the same defect class
      // (`[] =/= (Rs = State#state.resolvers)` in a filter is a read).
      // The `<-` lives inside a `generator` child, NOT directly under the
      // lc_or_zc_expr — resolving that wrapper is what makes a generator's
      // left side a pattern at all.
      const gen = t === "lc_or_zc_expr" ? childByType(n, "generator") || childByType(n, "map_generator") || childByType(n, "b_generator") : undefined
      const target = gen ?? n
      const ch = target.children ?? []
      const opIdx = ch.findIndex((c: any) => MATCH_OPS.has(c.type))
      if (opIdx < 0) {
        for (const c of kids(n)) visit(c)
        return
      }
      for (let i = 0; i < opIdx; i++) {
        if (ch[i].isNamed) markSubtree(ch[i])
      }
    }
    for (const c of kids(n)) visit(c)
  }
  visit(root)
  void inSpan
  return spans
}

export function oracleAnalyze(root: any, _filePath: string): OracleFile {
  const typesSeen = new Set<string>()
  const symbols: OracleSymbol[] = []
  const edges: OracleEdge[] = []
  const seen = new Set<string>()
  const push = (type: string, source: string, target: string, line: number, context?: string, arity?: number) => {
    if (!source || !target) return
    const k = `${type}|${source}|${target}|${line}|${arity ?? ""}`
    if (seen.has(k)) return
    seen.add(k)
    edges.push({ type, source, target, line, context, arity })
  }

  // ---------------- pass 1: declarations ----------------
  // ER-D32, adjudicated from the 400-file draw: an .erl file may declare NO
  // -module at all — OTP ships such include fragments (lib/syntax_tools/
  // examples/merl/basic_test.erl has its -module line COMMENTED OUT because
  // the file is textually included into another module). The oracle originally
  // left moduleName empty, and its `contains` loop then dropped every member,
  // losing four real function definitions and disagreeing with the analyzer
  // (which owns them by the file path — the only identity the file has). The
  // file path is the fallback owner on BOTH sides; inventing a module name from
  // the filename would fabricate a module that does not exist.
  let macroModuleRemotes = 0
  let moduleName = _filePath
  // The declaration forms, read exactly as the analyzer reads them: source_file's
  // named children with any conditional-compilation or grammar-ERROR container
  // spliced in. A malformed `-record #r{…}` hoists the whole file into one
  // ERROR node, so a top-level-only read misses every declaration.
  const forms: any[] = []
  const formStack: any[] = [...kids(root)].reverse()
  const DESCEND = new Set(["pp_if", "pp_ifdef", "pp_ifndef", "pp_else", "pp_elif", "pp_endif", "ERROR"])
  while (formStack.length > 0) {
    const n = formStack.pop()!
    if (!n.isNamed) continue
    if (DESCEND.has(n.type)) {
      for (let i = kids(n).length - 1; i >= 0; i--) formStack.push(kids(n)[i])
      continue
    }
    forms.push(n)
  }
  const topLevel: any[] = forms.filter((c: any) => c.type === "fun_decl")

  // GRAMMAR DAMAGE, WHOLE FILE. Some Erlang files are not Erlang to the grammar:
  // wx's `api_gen` sources are code-GENERATION TEMPLATES whose body is markup
  // (`<<EXPORT:SortItems sortItems/2 SortItems:EXPORT>>`), and OTP's abstract-format
  // `-record #r{...}` is likewise unparseable. When that happens the top level comes
  // back as a run of ERROR nodes with loose `call`/`atom`/`ann_type` fragments
  // between them — 32 ERRORs at the top of wxListCtrl.erl, and not one
  // `fun_decl` anywhere in the file.
  //
  // Deriving edges from those fragments is fabrication: the lines and the nesting
  // are whatever the error recovery happened to produce, so a `calls` edge recovered
  // from a fragment points at a structure the source does not have. The analyzer
  // emits nothing for such a file and says why (its error count); the oracle now
  // refuses too, and the file is COUNTED rather than quietly half-derivable.
  //
  // The guard is deliberately narrow. The first version fired on "no fun_decl and
  // no module_attribute", which wrongly silenced `epp_SUITE_data/mac2.erl` — a
  // legitimate file whose whole content is four `-ifndef`/`-define` blocks, with no
  // functions and no `-module` at all. Silence there was a loss, not a ruling. The
  // guard now fires only when there is NO recoverable declaration of any kind:
  // no function, no module, no macro, no record, no type, no import/export.
  const DECLARATION_FORMS = new Set([
    "fun_decl",
    "module_attribute",
    "pp_define",
    "record_decl",
    "type_alias",
    "opaque",
    "nominal",
    "import_attribute",
    "export_attribute",
    "export_type_attribute",
  ])
  const hasAnyDeclaration = forms.some((f: any) => DECLARATION_FORMS.has(f.type))
  if (topLevel.length === 0 && !hasAnyDeclaration) {
    const errCount = forms.filter((f: any) => f.type === "ERROR").length
    return {
      moduleName: _filePath,
      symbols,
      edges,
      typesSeen,
      macroModuleRemotes: 0,
      grammarDamaged: true,
      topLevelErrorNodes: errCount,
    }
  }
  const fnTable = new Map<string, { name: string; arity: number; clauseNode: any; macroHead: boolean }>()
  const clauseCount = new Map<string, number>()
  const declaredNames = new Set<string>()
  const specs = new Map<string, Spec>()
  const recordNames = new Set<string>()

  // The module name must be known BEFORE the function table is built: a
  // `?MODULE() -> …` head expands to the module's own name, so reading it later
  // silently dropped those functions (the oracle then disagreed with the
  // analyzer on a `contains` edge the analyzer was right to emit).
  // ER-D34, in step with the analyzer: a module can NAME ITSELF THROUGH A MACRO.
  // Common Test suites do it by convention — otp/lib/kernel/test/file_SUITE.erl is
  // `-module(?FILE_SUITE).` — and the attribute's child is a macro_call_expr whose
  // name is a `var`, never an `atom`. Reading only the atom finds no module at all.
  // Only a macro whose body is a BARE ATOM is expandable without the preprocessor;
  // anything else stays unknown, because guessing a module name fabricates one.
  const macroAtoms = new Map<string, string>()
  for (const f of forms) {
    if (f.type !== "pp_define") continue
    const lhs = childByType(f, "macro_lhs")
    const nm = lhs ? childByType(lhs, "var") || childByType(lhs, "atom") : undefined
    if (!nm?.text) continue
    for (const c of kids(f)) {
      if (c.type === "atom" && c.text) { macroAtoms.set(nm.text, c.text); break }
    }
  }
  const moduleNameFromMacro = (attr: any): string | undefined => {
    const macro = childByType(attr, "macro_call_expr") || childByType(attr, "macro_expr")
    if (!macro) return undefined
    const nm = childByType(macro, "var") || childByType(macro, "atom")
    return nm?.text ? macroAtoms.get(nm.text) : undefined
  }
  for (const top of forms) {
    if (top.type !== "module_attribute") continue
    const a = childByType(top, "atom")
    if (a?.text) { moduleName = a.text; break }
    const viaMacro = moduleNameFromMacro(top)
    if (viaMacro) { moduleName = viaMacro; break }
  }

  for (const fd of topLevel) {
    const clauses = kids(fd).filter((c: any) => c.type === "function_clause")
    if (clauses.length === 0) continue
    const head = clauses[0]
    let name: string | undefined
    let macroHead = false
    const direct = childByType(head, "atom") || childByType(head, "var")
    if (direct?.text) name = direct.text
    else {
      // `?MODULE() -> ...` expands to this module's own name (ER-D25); any other
      // macro head needs preprocessor expansion and is NOT resolvable.
      const macro = childByType(head, "macro_call_expr")
      const mn = macro ? childByType(macro, "var") || childByType(macro, "atom") : undefined
      if (mn?.text === "MODULE" && moduleName && moduleName !== _filePath) {
        name = moduleName
        macroHead = true
      }
    }
    if (!name) continue
    const arity = argCount(childByType(head, "expr_args"))
    const key = `${name}/${arity}`
    if (!fnTable.has(key)) fnTable.set(key, { name, arity, clauseNode: head, macroHead })
    declaredNames.add(name)
    clauseCount.set(key, (clauseCount.get(key) ?? 0) + clauses.length)
  }

  const declScan = (n: any) => {
    const t = n.type
    if (t === "module_attribute" && moduleName === _filePath) {
      const a = childByType(n, "atom")
      if (a?.text) moduleName = a.text
    } else if (t === "spec") {
      const a = childByType(n, "atom")
      const sig = childByType(n, "type_sig")
      if (a?.text && sig) {
        specs.set(`${a.text}/${argCount(childByType(sig, "expr_args"))}`, {
          params: kids(childByType(sig, "expr_args")).map((c: any) => c.text),
          ret: sigReturn(sig),
        })
      }
    } else if (t === "record_decl") {
      const a = childByType(n, "atom")
      if (a?.text) recordNames.add(a.text)
    }
    for (const c of kids(n)) declScan(c)
  }
  declScan(root)

  const patternSpans = markPatternSpans(root)
  const isPattern = (n: any): boolean =>
    patternSpans.some((s) => s.start <= n.startIndex && n.endIndex <= s.end)

  // ---------------- pass 2: declarations as symbols ----------------
  for (const n of forms) {
    const t = n.type
    if (t === "module_attribute") {
      const a = childByType(n, "atom")
      // ER-D34: named by what the macro EXPANDS TO, never by the macro's own name.
      // Naming the module symbol `FILE_SUITE` would put a macro name where every
      // consumer of a module symbol looks for a compiled module.
      const viaMacro = a?.text ? undefined : moduleNameFromMacro(n)
      const nm = a?.text ?? viaMacro
      if (nm) symbols.push({ name: nm, kind: "module", line: line1(a ?? n) })
    } else if (t === "record_decl") {
      const a = childByType(n, "atom")
      if (!a?.text) continue
      for (const f of kids(n).filter((c: any) => c.type === "record_field")) {
        const fa = childByType(f, "atom")
        if (fa?.text) symbols.push({ name: fa.text, kind: "property", ownerName: a.text, line: line1(fa) })
      }
      symbols.push({ name: a.text, kind: "struct", ownerName: moduleName, line: line1(a) })
    } else if (t === "pp_define") {
      const lhs = childByType(n, "macro_lhs")
      const v = lhs ? childByType(lhs, "var") || childByType(lhs, "atom") : undefined
      if (v?.text) symbols.push({ name: v.text, kind: "constant", ownerName: moduleName, isMacro: true, line: line1(v) })
    } else if (t === "type_alias" || t === "opaque" || t === "nominal") {
      const tn = childByType(n, "type_name")
      const a = tn ? childByType(tn, "atom") : childByType(n, "atom")
      if (a?.text) {
        symbols.push({
          name: a.text,
          kind: "type",
          ownerName: moduleName,
          isOpaque: t === "opaque",
          arity: tn ? argCount(childByType(tn, "var_args")) : 0,
          line: line1(a),
        })
      }
    } else if (t === "callback") {
      const a = childByType(n, "atom")
      const sig = childByType(n, "type_sig")
      if (a?.text) {
        const arity = argCount(childByType(sig, "expr_args"))
        if (fnTable.has(`${a.text}/${arity}`)) continue
        symbols.push({ name: a.text, kind: "method", ownerName: moduleName, arity, isCallback: true, line: line1(a) })
      }
    }
  }
  for (const [key, f] of fnTable) {
    const sym: OracleSymbol = {
      name: f.name,
      kind: "function",
      ownerName: moduleName,
      arity: f.arity,
      clauseCount: clauseCount.get(key) ?? 1,
      line: line1(f.clauseNode),
    }
    if (f.macroHead) sym.isMacro = false
    symbols.push(sym)
  }
  // ownership
  for (const s of symbols) {
    if (!s.ownerName) continue
    push("contains", s.ownerName, s.name, s.line)
  }

  // ---------------- pass 3: edges ----------------
  const env = { source: moduleName, type: false, macro: false }
  const visit = (n: any) => {
    typesSeen.add(n.type)
    const t = n.type
    const savedSource = env.source
    const savedType = env.type
    const savedMacro = env.macro

    if (TYPE_SCOPE.has(t)) env.type = true
    if (t === "pp_define") {
      env.macro = true
      const lhs = childByType(n, "macro_lhs")
      const v = lhs ? childByType(lhs, "var") || childByType(lhs, "atom") : undefined
      if (v?.text) env.source = v.text
    } else if (t === "record_decl") {
      const a = childByType(n, "atom")
      if (a?.text) env.source = a.text
    } else if (t === "type_alias" || t === "opaque" || t === "nominal") {
      const tn = childByType(n, "type_name")
      const a = tn ? childByType(tn, "atom") : childByType(n, "atom")
      if (a?.text) env.source = a.text
    } else if (t === "callback") {
      const a = childByType(n, "atom")
      if (a?.text) env.source = a.text
    } else if (t === "spec") {
      const a = childByType(n, "atom")
      if (a?.text) env.source = a.text
    } else if (t === "fun_decl") {
      const clauses = kids(n).filter((c: any) => c.type === "function_clause")
      const head = clauses[0]
      let name = moduleName
      if (head) {
        const direct = childByType(head, "atom") || childByType(head, "var")
        if (direct?.text) name = direct.text
        else {
          const macro = childByType(head, "macro_call_expr")
          const mn = macro ? childByType(macro, "var") || childByType(macro, "atom") : undefined
          if (mn?.text === "MODULE" && moduleName) name = moduleName
        }
      }
      env.source = name
    }

    switch (t) {
      case "behaviour_attribute": {
        const b = childByType(n, "atom")
        if (b?.text) push("implements", moduleName, b.text, line1(b), "behaviour")
        break
      }
      case "pp_include":
      case "pp_include_lib": {
        const s = childByType(n, "string")
        if (s) push("references", moduleName, stripQuotes(s.text), line1(s), t === "pp_include" ? "include" : "include_lib")
        break
      }
      case "import_attribute": {
        const m = childByType(n, "atom")
        if (m?.text) push("references", moduleName, m.text, line1(m), "module import")
        break
      }
      case "call":
        visitCall(n)
        break
      case "record_expr": {
        const rn = childByType(n, "record_name")
        const a = atomIn(rn)
        if (a?.text) {
          if (env.type) push("references", env.source, a.text, line1(a), "record type reference")
          else if (!isPattern(n)) push("instantiates", env.source, a.text, line1(a), "record construction")
        }
        break
      }
      case "record_field_expr":
      case "record_index_expr": {
        if (env.type || isPattern(n)) break
        const ra = atomIn(childByType(n, "record_name"))
        if (ra?.text) push("uses", env.source, ra.text, line1(ra), "record member read")
        const fa = atomIn(childByType(n, "record_field_name"))
        if (fa?.text) push("uses", env.source, fa.text, line1(fa), "record member read")
        break
      }
      case "record_update_expr": {
        if (env.type || isPattern(n)) break
        const ra = atomIn(childByType(n, "record_name"))
        if (ra?.text) push("uses", env.source, ra.text, line1(ra), "record field update")
        for (const f of kids(n).filter((c: any) => c.type === "record_field")) {
          const fa = childByType(f, "atom")
          if (fa?.text) push("uses", env.source, fa.text, line1(fa), "record field update")
        }
        break
      }
      case "macro_call_expr": {
        const mn = childByType(n, "var") || childByType(n, "atom")
        if (mn?.text) push("references", env.source, mn.text, line1(mn), "macro use")
        break
      }
      case "internal_fun": {
        if (env.type || env.macro) break
        const a = childByType(n, "atom")
        if (a?.text) {
          push("references", env.source, a.text, line1(a), "fun value reference", arityOf(childByType(n, "arity")))
        }
        break
      }
      case "external_fun": {
        if (env.type || env.macro) break
        const a = childByType(n, "atom")
        const m = childByType(n, "module")
        const ma = atomIn(m)
        const mm = m ? childByType(m, "macro_call_expr") : undefined
        if (a?.text && ma?.text) push("references", env.source, `${ma.text}:${a.text}`, line1(a), "fun value reference", arityOf(childByType(n, "arity")))
        // ER-D35 on the FUN-VALUE path, which the call path had already been given:
        // only `?MODULE:f/1` names this file's module. `?I:split/2` in
        // diameter_dbg.erl, where `?I` is `-define(I, diameter_info)`, names a
        // module this analyzer does not expand — substituting the enclosing module
        // reports `diameter_dbg:split`, a fun value that appears nowhere in the
        // source. Counted, never invented, exactly like the call path.
        else if (a?.text && mm) {
          const mmName = (childByType(mm, "var") || childByType(mm, "atom"))?.text
          if (mmName === "MODULE" && moduleName && moduleName !== _filePath) {
            push("references", env.source, `${moduleName}:${a.text}`, line1(a), "fun value reference", arityOf(childByType(n, "arity")))
          } else {
            macroModuleRemotes++
          }
        }
        break
      }
      default:
        break
    }

    // type references: every atom / applied call head inside a type declaration
    if (env.type && (t === "type_alias" || t === "opaque" || t === "nominal" || t === "callback" || t === "spec" || t === "field_type")) {
      // The declaration's OWN name is not a reference to itself. For -type /
      // -opaque / -nominal it sits in a `type_name`; for -callback and -spec it
      // is a direct atom child. Skipping the wrong one produced 30+ self edges
      // (`references|all|all`), which the differential caught.
      const skip =
        t === "type_alias" || t === "opaque" || t === "nominal"
          ? childByType(n, "type_name")
          : t === "callback" || t === "spec"
            ? childByType(n, "atom")
            : undefined
      collectTypeRefs(n, skip, env.source, push)
    }

    for (const c of kids(n)) visit(c)
    env.source = savedSource
    env.type = savedType
    env.macro = savedMacro
  }

  function arityOf(a: any): number {
    if (!a) return 0
    return digits(childByType(a, "integer")?.text)
  }

  function visitCall(n: any) {
    if (env.type || env.macro) return
    const callee = kids(n)[0]
    if (!callee) return
    if (callee.type === "atom" && SPAWN.has(callee.text)) return
    const arity = argCount(childByType(n, "expr_args"))
    const remote = childByType(n, "remote")
    if (remote) {
      const rm = childByType(remote, "remote_module")
      const ma = atomIn(rm)
      const mm = rm ? childByType(rm, "macro_call_expr") : undefined
      const fa = childByType(remote, "atom")
      if (!fa?.text) return
      if (ma?.text) push("calls", env.source, `${ma.text}:${fa.text}`, line1(fa), "remote", arity)
      // ER-D35: a remote call whose MODULE is a macro (`?FILE_MODULE:read_file_info(X)`)
      // names no resolvable callee — ER-D23's subclass, and the oracle's own
      // earlier behaviour was the worse of the two options: it substituted the
      // ENCLOSING module, inventing a call into the file's own module (or, before
      // ER-D34, into a file path). That is a fabrication, not a derivation, and
      // the full-corpus draw counted 922 of them as MISSING. Deriving nothing is
      // the honest answer; the count is reported so the class stays visible
      // instead of vanishing into a zero.
      else if (mm) {
        // ER-D25 keeps the `?MODULE` case: it IS this file's module, so the call
        // resolves exactly like a module-qualified one. Only a DIFFERENT macro in
        // module position is ER-D35.
        const mmName = (() => {
          const v = childByType(mm, "var")
          const a2 = childByType(mm, "atom")
          return (v ?? a2)?.text
        })()
        if (mmName === "MODULE" && moduleName && moduleName !== _filePath) {
          push("calls", env.source, `${moduleName}:${fa.text}`, line1(fa), "remote", arity)
        } else {
          macroModuleRemotes++
        }
      }
      return
    }
    if (callee.type === "atom" && callee.text && declaredNames.has(callee.text)) {
      push("calls", env.source, callee.text, line1(callee), "local", arity)
    }
  }

  function collectTypeRefs(n: any, skip: any, from: string, emit: typeof push) {
    // A `record_name` inside a type is the record's own edge; the record_expr
    // handler emits it, so this walk must not also claim it.
    if (n.isNamed && n.type === "record_name") return
    // ER-D36, in step with the analyzer: a type dependency is an APPLIED name.
    // In Erlang type syntax a bare unquoted atom is the ATOM LITERAL of that name
    // (you must write `foo()` to apply a type), and a record/map FIELD NAME is a
    // declaration. So the walk enters `call` heads only — which also covers a
    // record type's field names (`#state{q :: [job()]}`: `q` is a declaration,
    // `job()` is applied) and a map type's keys (`#{id := job_id()}`).
    if (n.isNamed && n.type === "call") {
      // A qualified type keeps its module (ER-D31): `missing_mod:referenced_type`
      // is ONE type name, not the leaf and not the module.
      let nameNode: any
      if (n.type === "call") {
        const remote = childByType(n, "remote")
        if (remote) {
          const rm = childByType(remote, "remote_module")
          const ma = rm ? childByType(rm, "atom") : undefined
          const fa = childByType(remote, "atom")
          if (ma?.text && fa?.text) {
            const inSkip = skip && skip.startIndex <= ma.startIndex && fa.endIndex <= skip.endIndex
            if (!inSkip) emit("references", from, `${ma.text}:${fa.text}`, line1(fa), "type reference")
          }
          // The `remote`'s own atoms are the two halves of the name just
          // emitted, not two more type names: recursing into them re-introduced
          // the split the qualification exists to prevent.
          for (const c of kids(n)) {
            if (c.type === "remote" || c.type === "remote_module") continue
            collectTypeRefs(c, skip, from, emit)
          }
          return
        }
        nameNode = kids(n)[0]
      }
      const inSkip = skip && nameNode && skip.startIndex <= nameNode.startIndex && nameNode.endIndex <= skip.endIndex
      if (nameNode?.text && !inSkip) emit("references", from, nameNode.text, line1(nameNode), "type reference")
    }
    for (const c of kids(n)) collectTypeRefs(c, skip, from, emit)
  }

  visit(root)
  void recordNames
  void ARM
  void COMPREHENSION
  void OTP
  void specs
  return { moduleName, symbols, edges, typesSeen, macroModuleRemotes }
}

function sigReturn(sig: any): string | undefined {
  const ch = sig.children ?? []
  const i = ch.findIndex((c: any) => c.type === "->")
  if (i < 0) return undefined
  const t = sig.text.slice(ch[i].endIndex - sig.startIndex).trim()
  return t.length ? t : undefined
}

function stripQuotes(text: string): string {
  let out = ""
  for (const ch of text) if (ch !== '"' && ch !== "'") out += ch
  return out
}
