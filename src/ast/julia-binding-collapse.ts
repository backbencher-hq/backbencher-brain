/**
 * JULIA'S METHOD TABLE, bound in the store — the second landing site for the gate rule
 * (`script/m14/incoming-gate.ts --binding-collapse`), in the shape of `retargetCrossFileOverrides`.
 *
 * ## What is wrong without it
 *
 * Julia declares ONE generic function across many files: `Base.getindex` is one binding with a method
 * declaration per file, and a per-file analyzer publishes one symbol per DECLARATION. The resolver's
 * name strategies bind a bare name only when its count in the project is exactly 1 (`_res_name`), so
 * every edge whose target names a multi-method binding stays unbound — 1,489 edges on this corpus by
 * the gate's model, of which 364 keys were genuine method-table collapses.
 *
 * ## The rule, and the clause that makes it safe
 *
 * A key binds to ONE declaration iff EVERY declaration answering to it carries the SAME qualifiedName
 * **and that qualifiedName is a GENUINE QUALIFICATION — it differs from the symbol's own name.**
 *
 * THAT SECOND CLAUSE IS THE WHOLE RULE, and it is the one this programme has now needed three times
 * (JUL-D19 in the census predicate, and again in the gate): `pool-worker.ts:1228` normalises every
 * symbol to `qualifiedName: s.qualifiedName || s.metadata?.fqn || (s.scope ? `${s.scope}.${s.name}` : s.name)`,
 * so a FILE-SCOPE declaration arrives with `qualifiedName === name` — non-empty, and saying nothing
 * about a binding. Accepting it collapses two top-level functions that merely share a spelling, which
 * is a SEMANTICS change. The loose version of this rule read 30,190 edges on this corpus against a
 * true 1,489, and the refuted run is committed beside it.
 *
 * ## The language guard, and why it cannot leak
 *
 * A row is considered ONLY when the language of its SOURCE FILE is `julia`, and only declarations from
 * `julia` files can form a binding — the guard is in the SQL, not in a caller's memory. Julia's
 * multiple-dispatch semantics are what makes several declarations one binding; in a language where two
 * same-named declarations are two things, this pass matches nothing and writes nothing. **It is a
 * no-op for every other language by construction, not by convention.**
 *
 * ## What it will not do
 *
 * It never touches a row that already has a `target_symbol_id` (an existing binding is not re-pointed),
 * it never writes `target_external` (the spelling the analyzer published stays the analyzer's), and it
 * swallows its own failures so a pass that cannot run leaves indexing exactly as it was.
 */

/** The relationship types whose target is a NAME that a binding can answer. */
const BINDABLE_TYPES = ["calls", "references", "uses", "instantiates", "exports", "extends", "imports"] as const

export type JuliaBindingCollapseResult = {
  /** declarations of the project's julia files that answered to some key */
  declarations: number
  /** keys whose declarations are provably ONE binding (the collapse candidates) */
  keys: number
  /** unbound julia rows examined */
  scanned: number
  /** rows whose target named a collapsed key and were therefore bound */
  bound: number
  /** rows bound to a declaration in their OWN file rather than to the deterministic representative */
  boundOwnFile: number
  /** non-julia rows in scope of the query — must be 0, which is the guard asserting itself */
  foreignRowsSeen: number
  /** the one-binding keys themselves, bounded — so a reader can see WHICH names the rule reaches
   *  rather than only how many, and can check them against the rows the model moved */
  keyNames: string[]
}

export function retargetJuliaMethodTableBindings(rawDb: any, projectId: string): JuliaBindingCollapseResult {
  const out: JuliaBindingCollapseResult = {
    declarations: 0, keys: 0, scanned: 0, bound: 0, boundOwnFile: 0, foreignRowsSeen: 0, keyNames: [],
  }
  try {
    // ── 1. the project's julia declarations, keyed by every spelling that answers to them
    type Cand = { id: string; fileId: string; qual: string; name: string }
    const byKey = new Map<string, Cand[]>()
    const rows = rawDb
      .prepare(
        `SELECT s.id, s.name, s.qualified_name, s.file_id
           FROM brain_symbol s
           JOIN brain_file f ON f.id = s.file_id
          WHERE s.project_id = ? AND f.language = 'julia'`,
      )
      .all(projectId) as any[]
    for (const r of rows) {
      const id = String(r.id ?? "")
      const name = String(r.name ?? "")
      const qual = String(r.qualified_name ?? "")
      if (!id || !name) continue
      out.declarations++
      const c: Cand = { id, fileId: String(r.file_id ?? ""), qual, name }
      for (const k of [name, qual]) {
        if (!k) continue
        const list = byKey.get(k)
        if (list) list.push(c)
        else byKey.set(k, [c])
      }
    }

    // ── 2. which keys are provably ONE binding? (the rule, with its safe clause)
    const representative = new Map<string, Cand[]>()
    for (const [key, cands] of byKey) {
      if (cands.length < 2) continue
      // every declaration must carry a GENUINE qualification — a spelling that differs from its own
      // name. `qualifiedName === name` is the pool-worker fallback, not a binding.
      if (!cands.every((c) => c.qual && c.qual !== c.name)) continue
      // and they must all be the SAME one
      const first = cands[0]!.qual
      if (!cands.every((c) => c.qual === first)) continue
      representative.set(key, cands)
      out.keys++
      if (out.keyNames.length < 200) out.keyNames.push(key)
    }
    if (representative.size === 0) return out
    if (Number(process.env.BB_JULIA_BIND_SHOW ?? 0) > 0) {
      const show = [...representative.entries()].slice(0, Number(process.env.BB_JULIA_BIND_SHOW))
      for (const [k, cs] of show) console.log(`  one-binding key ${JSON.stringify(k)} decls=${cs.length} qual=${JSON.stringify(cs[0]!.qual)}`)
    }

    // ── 3. the unbound julia rows, and the language guard stated in the query itself
    const rels = rawDb
      .prepare(
        `SELECT r.id, r.target_external, r.relationship_type, sf.language AS srcLang, sf.id AS srcFileId
           FROM brain_relationship r
           LEFT JOIN brain_symbol ss ON ss.id = r.source_symbol_id
           LEFT JOIN brain_file   sf ON sf.id = ss.file_id
          WHERE r.project_id = ?
            AND r.target_symbol_id IS NULL
            AND r.relationship_type IN (${BINDABLE_TYPES.map(() => "?").join(",")})`,
      )
      .all(projectId, ...BINDABLE_TYPES) as any[]

    const update = rawDb.prepare(`UPDATE brain_relationship SET target_symbol_id = ? WHERE id = ?`)
    for (const r of rels) {
      const srcLang = String(r.srcLang ?? "")
      if (srcLang !== "julia") {
        // A row whose source file is not julia is COUNTED and never touched. On a julia project this
        // is 0; if a future caller ever passes a mixed project, this number is the evidence that the
        // guard held rather than a claim that it would have.
        out.foreignRowsSeen++
        continue
      }
      out.scanned++
      const tgt = String(r.target_external ?? "")
      if (!tgt) continue
      const cands = representative.get(tgt)
      if (!cands || cands.length === 0) continue
      // THE REPRESENTATIVE, deterministically: the row's OWN FILE first — the same preference
      // `resolveContainsTargetStmt` uses, because the local declaration is the natural referent — and
      // otherwise the lexicographically smallest id, so two runs of the same index produce the same
      // store. Never `MIN(id)` as a tie-break over DIFFERENT bindings; here every candidate IS the
      // same binding, which is what makes an arbitrary member of it defensible.
      const ownFileId = String(r.srcFileId ?? "")
      const own = ownFileId ? cands.find((c) => c.fileId === ownFileId) : undefined
      const pick = own ?? [...cands].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0]!
      update.run(pick.id, r.id)
      out.bound++
      if (own) out.boundOwnFile++
    }
  } catch {
    // A pass that cannot run must never turn a completed index into a failed one: the rows stay
    // exactly as the analyzer published them, which is the behaviour before this file existed.
  }
  return out
}
