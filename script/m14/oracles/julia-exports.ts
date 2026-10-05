/**
 * The Julia `exports` oracle — LANE-OWNED.
 *
 * Beside the other julia oracles rather than in `differential.ts`, for the reason that shared file's
 * own header records: it is edited by several lanes at once, and every line a lane keeps out of a
 * shared file is a line that cannot conflict.
 *
 * ## Why this oracle exists
 *
 * `exports` was this lane's other DERIVATION finding, and it has the same history as `imports`: RULED
 * non-applicable on a prose argument, overturned by a corpus measurement, and since emitted on 2,859
 * edges with **no independent derivation behind any of them**.
 *
 * The two rulings being wrong is not the reason this oracle matters — being wrong twice is a
 * correction, and the correction is recorded in the lane doc. It matters because the reason BOTH were
 * wrong is that nothing independent ever said otherwise. `script/m14/differential.ts`'s F5 label
 * allowlist admits `imports` and `exports` for every language, so the harness compared **zero** julia
 * rows against zero truth rows and printed its "COMPARED WITH NO TRUTH" line — which is a correct
 * report of a comparison that did not happen. A type emitted and never compared reads exactly like a
 * type that is covered.
 *
 * ## The rule, from JULIA and not from the analyzer
 *
 * `export a, b` marks the BINDINGS `a` and `b` as part of the module's public interface. `public` is
 * Julia 1.11's spelling of the same act, minus the precompile hint. So the rule is:
 *
 *   Every BINDING NAME an `export_statement` or `public_statement` names is one edge, sourced at the
 *   module the statement appears in.
 *
 * What counts as a binding name, per the grammar shapes measured over the corpus by
 * `validation/m14/fixtures/julia/import-export-shapes.ts`:
 *
 *   `export f`        `identifier`         the name as written
 *   `export +`        `operator`           an operator is a binding and is exportable as one
 *   `export @foo`     `macro_identifier`   the binding is `foo`; the `@` is a sigil, not part of it
 *   `export a # note` `line_comment`       NOT a binding — see below
 *
 * The comment row is the reason this oracle exists in the shape it does. A `line_comment` is a NAMED
 * child of `export_statement`/`public_statement` — **66 of them across a 400-file draw**, because
 * julia's export lists are conventionally grouped and annotated, and `Graphs.jl/src/Graphs.jl` has
 * one `export` statement carrying 17. A reading that took the statement's text would publish
 * `# Interface` as an exported binding; a reading that took every named child without this row would
 * publish it too. Only `node.type` excludes it.
 *
 * ## HOW THIS DIFFERS FROM THE FUNCTION UNDER TEST
 *
 * `RealJuliaAnalyzer.exportableName()` is a FIRST-MATCH resolver: for each named child of the
 * statement it returns one string, and for a `tuple_expression`/`parenthesized_expression` it
 * recurses and returns the FIRST name it finds — so `export (a, b)` yields `a` and silently drops
 * `b`, which asserts less than julia does.
 *
 * This oracle is a SET derivation. `bindingNames()` enumerates every name a node contributes, and the
 * statement's truth is the union over all its children. The two can therefore disagree in both
 * directions — the oracle finding a name the analyzer dropped, and the analyzer finding one the oracle
 * did not — which is the property that makes it worth running. They also disagree on an unknown node
 * type by construction: the analyzer returns `""` and drops it, this one enumerates what it can and
 * the differential prints the residue rather than hiding it.
 *
 * No shared helper is called. The one rule both sides implement is Julia's own — a macro's binding
 * name has no sigil — because that is the language and not this codebase, and because a rule can only
 * be shared when it is the language's; an IMPLEMENTATION cannot be, or the oracle agrees by
 * construction and measures nothing.
 *
 * ## What this oracle deliberately does NOT claim
 *
 * **It does not check `ExportInfo[]`**, and it does not check the `isExported` symbol metadata. It
 * derives the exported-name SET per file and compares it against the `exports` EDGES. The payload
 * channel has its own instrument (`census.ts`'s construct reconciliation); claiming one oracle covered
 * both would be claiming a measurement nobody made.
 *
 * **It cannot check the KIND of the exported binding**, and neither can the edge. `export X` asserts
 * no kind, which the analyzer records as `declaresNothing: true` and which is the correct reading of
 * julia — so the 6.3% of `exports` edges whose target names more than one published symbol is a
 * limit of the RELATIONSHIP TYPE, not a defect in either derivation here. The lane doc carries the
 * count and names the schema change that would fix it.
 *
 * ## The limitation this oracle cannot cover, declared rather than implied
 *
 * It is a SECOND WALKER OVER THE SAME GRAMMAR. It can disagree with the analyzer when either is wrong;
 * it is BLIND when a construct is absent from both. Only measuring the language finds those.
 */

export type JuliaExportsEdge = { label: "exports"; from: string; target: string }

const kids = (n: any): any[] => {
  const out: any[] = []
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c) out.push(c)
  }
  return out
}

/**
 * Every binding name a node contributes, as a LIST — the difference from the function under test,
 * which returns at most one name and therefore drops the rest of a list.
 *
 * A node type absent from this function contributes NOTHING and is counted by the differential as
 * residue, so a grammar upgrade that introduces a new export shape shows up as a number rather than
 * as silence on both sides.
 */
function bindingNames(n: any, out: string[]): void {
  const t = n.type
  if (t === "identifier") {
    const s = String(n.text ?? "").trim()
    if (s) out.push(s)
    return
  }
  if (t === "operator") {
    const s = String(n.text ?? "").trim()
    if (s) out.push(s)
    return
  }
  if (t === "macro_identifier") {
    // Julia's own rule: `export @foo` exports the binding named `foo`. The `@` is sigil syntax and is
    // not part of the binding, so an edge targeting `@foo` names nothing a consumer can resolve.
    // Implemented here rather than shared with the analyzer's `stripSigil`, for the reason the file
    // header gives: a shared implementation makes the oracle agree by construction.
    let s = String(n.text ?? "").trim()
    while (s.startsWith("@")) s = s.slice(1)
    if (s) out.push(s)
    return
  }
  if (t === "scoped_identifier") {
    // Not valid julia (`export A.B` is a syntax error — a module cannot export another module's
    // binding), and the corpus census finds none. Recorded so that IF the corpus ever contains one,
    // the oracle names its final segment — the binding actually exported — rather than the whole
    // path, and the differential can say which reading it took.
    const segs = kids(n).filter((c: any) => c.type === "identifier")
    const s = String((segs.length ? segs[segs.length - 1] : n).text ?? "").trim()
    if (s) out.push(s)
    return
  }
  // Anything that can hold names, enumerate rather than take the first: `export (a, b)` in julia is
  // a parse the first-match resolver drops `b` from, and a differential that cannot see that
  // difference cannot report it.
  if (t === "tuple_expression" || t === "parenthesized_expression" || t === "bracketed_expression") {
    for (const c of kids(n)) bindingNames(c, out)
  }
  // `line_comment`, `ERROR` and anything else contribute nothing. Falling through with no push IS the
  // rule for those, and it is the rule the shape census measured 66 times.
}

/**
 * The enclosing scope, for the edge SOURCE — the module an export belongs to.
 *
 * `export` at file top level is legal julia and marks the file's implicit `Main` module; the graph
 * addresses file scope as `root`. That is a graph convention rather than a derivation, restated here
 * so the oracle can name a source.
 */
function enclosingModuleName(n: any): string {
  let cur = n.parent ?? null
  for (let i = 0; i < 24 && cur; i++) {
    if (cur.type === "module_definition" || cur.type === "module" || cur.type === "baremodule") {
      const first = kids(cur)[0]
      const name = first ? String(first.text ?? "").trim() : ""
      if (name) return name
    }
    cur = cur.parent ?? null
  }
  return "root"
}

/**
 * Is this statement an export at all?
 *
 * `public` and `export` are CONTEXTUAL KEYWORDS in julia — keywords only when a name list follows —
 * so `public = expr` declares a local variable named `public`. The production grammar gives that a
 * `public_statement` node anyway, and both sides here refuse it, so this is the ONE rule the two
 * derivations share and it is worth being explicit about why sharing it does not make the oracle
 * circular: it is a rule about the PARSER'S OUTPUT rather than a rule about julia's module grammar.
 * The thing under test — which bindings a real export statement names, and where its edge is sourced
 * — is derived independently on either side, and sharing a parser guard is not the same as sharing a
 * derivation. Both sides would have to be wrong about julia's export semantics for the differential
 * to agree on anything this guard does not already decide.
 *
 * The discriminator is measured, not chosen: over the whole admitted corpus 49 of 3,570
 * import/export statements carry an ERROR descendant, and in the two misparses
 * (`Documenter.jl/src/expander_pipeline.jl:632`, `julia/stdlib/REPL/src/docview.jl:408`) the FIRST
 * NAMED child is the ERROR — there is no name list, because there is no export. In the two GENUINE
 * `public` statements that also carry an ERROR
 * (`julia/stdlib/REPL/test/replcompletions.jl:21`, `Flux.jl/src/Flux.jl:55`) the first named child is
 * a real `identifier`, so refusing on "first named child is an ERROR" keeps the ~115 names they carry
 * and drops the 3 fabricated ones.
 *
 * It is deliberately NOT "contains an ERROR anywhere": 45 of those 49 are IMPORT statements carrying
 * legitimate julia the grammar cannot fully parse, and the imports oracle must not refuse them.
 */
function isRealExportStatement(stmt: any): boolean {
  const first = kids(stmt)[0]
  return !(first && first.type === "ERROR")
}

/**
 * `exports` truth for one tree.
 *
 * One edge per (scope, binding) pair, deduped: `export a, a` names one binding and a module exports a
 * name once however many methods it has — which is also why the lane doc counts 22 same-kind
 * duplicate `exports` edges as not a collision.
 */
export function deriveJuliaExportsTruth(root: any): JuliaExportsEdge[] {
  const edges: JuliaExportsEdge[] = []
  const seen = new Set<string>()
  const scopeCache = new Map<number, string>()

  const scopeOf = (n: any): string => {
    const cached = scopeCache.get(n.id)
    if (cached !== undefined) return cached
    const s = enclosingModuleName(n)
    scopeCache.set(n.id, s)
    return s
  }

  const visit = (n: any): void => {
    if ((n.type === "export_statement" || n.type === "public_statement") && isRealExportStatement(n)) {
      const from = scopeOf(n)
      const names: string[] = []
      for (const child of kids(n)) bindingNames(child, names)
      for (const name of names) {
        const key = `${from}|${name}`
        if (seen.has(key)) continue
        seen.add(key)
        edges.push({ label: "exports", from, target: name })
      }
    }
    for (const c of kids(n)) visit(c)
  }

  visit(root)
  return edges
}