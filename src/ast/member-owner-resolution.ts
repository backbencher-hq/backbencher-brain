/**
 * Member resolution through the RECEIVER'S OWNER, and through that owner's ancestors.
 *
 * ## Why this exists
 *
 * Every strategy in `storeResults`' resolution block resolves a target BY NAME:
 * `_res_qname` (exact qualified name) and `_res_name_unique` (the name is unique project-wide),
 * plus a dotted-name fallback. That is the right rule when a name identifies the thing — and it is
 * simply unavailable for a member, because a member name is not identifying: `render` is a method on
 * many classes at once and `_res_name_unique` therefore declines every one of them. The php lane's
 * whole-population census measured the consequence: of 350,368 edges, **169,156 (48.3%)** resolve to
 * more than one declaration, and it priced which of them are closable by a rule rather than a
 * preference:
 *
 *   - **24,223 endpoints (14.3%)** resolve by walking the enclosing class's ANCESTORS. A member
 *     read written in a subclass whose ancestor declares it is not a guess about which of N
 *     same-named declarations was meant; it is PHP's own method resolution.
 *   - **2,756 more (1.6%)** are resolved by the owner channel directly — the receiver's class
 *     declares the member, so the candidate set narrows to exactly one.
 *   - The rest are a type-inference wall (`metadata`, `value`, `result`, … member reads off
 *     receivers whose type nothing knows) or PREFERENCES that would REPLACE a resolution rather
 *     than narrow one, which this pass deliberately does not implement. See
 *     `validation/m14/fixtures/php/reason-census.mts` for the ladder and its stated order.
 *
 * The signal this reads is the analyzer's own: a member-position edge carries `metadata.owner` ONLY
 * when the receiver really is the enclosing class or a named scope (`$this->m()`, `self::m()`,
 * `static::m()`, `parent::m()`, `C::m()`). `$obj->m()` and `$this->svc->m()` carry NO owner, on
 * purpose, because the receiver's type is not knowable from one file — so this pass cannot act on
 * them, and that silence is the analyzer's decision rather than this pass's omission.
 *
 * ## The rule, and what it refuses to do
 *
 * For each unresolved `calls`/`uses` row that carries an owner:
 *
 *   1. the owner's NAME must identify exactly ONE class-like symbol. Two classes called `Child` in
 *      different namespaces make the owner channel a guess, and the pass declines rather than picks;
 *   2. the candidates are the members that name the target whose `owner_symbol_id` is that symbol;
 *      the type's KIND filter is applied first (`calls` → callable kinds, `uses` → member kinds), so
 *      a `uses` against a name a class carries as both a method and a property stays unresolved;
 *   3. exactly one candidate resolves. Zero candidates fall through to the ancestors; two or more
 *      decline, because "which one" is not something this pass is allowed to decide;
 *   4. the ANCESTOR walk uses `brain_symbol.super_types`, which the analyzers publish and this pass
 *      reads as the class's own statement of its heritage. A parent name that is ambiguous, or that
 *      names no symbol in this project, ends that branch — a class whose parent is outside the
 *      population stays unresolved rather than being resolved to a stranger. Traits are absent from
 *      `super_types` by the publishing analyzers' decision, which makes the ancestor count a LOWER
 *      bound;
 *   5. it never touches a row that already has a `target_symbol_id`, never re-points one, never
 *      changes a confidence, and never creates or deletes an edge. The worst case is a row left
 *      exactly as it was.
 *
 * ## Degradation
 *
 * `super_types` is NULL for every symbol written before it was published (and for every heritage the
 * analyzer cannot resolve), `owner_symbol_id` is NULL for file-level declarations, and `metadata.owner`
 * is absent on every edge whose receiver is not the enclosing class. With no hierarchy, no members or
 * no owners there is simply nothing to walk, and the pass changes nothing — the pre-existing
 * name-only behaviour, which is the correct fallback.
 */

/** Kinds a class-like declaration can be, for the owner lookup. */
const CLASS_LIKE = ["class", "interface", "trait", "enum"] as const

/**
 * The kind filter, MIRRORED from `validation/m14/fixtures/php/reason-census.mts`'s `FILTER_KINDS`
 * rather than re-derived, because that table is what the 24,223 + 2,756 were priced with: a pass
 * whose filter differed from the price would move a DIFFERENT number than the one the lane
 * published, and the difference would look like a measurement.
 *
 * A `calls` target must be callable; a `uses` target may be any member the language publishes as a
 * member symbol. Both lists are deliberately the census's, including `constructor` in `calls` and
 * `variable` in `uses`.
 */
const FILTER_KINDS: Record<string, Set<string>> = {
  calls: new Set(["function", "method", "constructor"]),
  uses: new Set(["function", "method", "property", "constant", "enum_member", "variable"]),
}

/** Ancestors are walked breadth-first; the M60 override retarget measured depth 14 on scala. */
const MAX_DEPTH = 16

export type MemberOwnerResolutionResult = {
  /** Unresolved `calls`/`uses` rows carrying an owner — the pass's whole input. */
  scanned: number
  /** Resolved because the owner itself declares the member. */
  ownerResolved: number
  /** Resolved because exactly one resolvable ancestor declares the member. */
  inheritedResolved: number
  /** Resolved in total (the two above). */
  resolved: number
  /** The owner name names no class-like symbol in this project. */
  ownerNotInPopulation: number
  /** The owner name names MORE than one symbol — the channel is a guess, so it declines. */
  ownerAmbiguous: number
  /** The owner and no resolvable ancestor declares the name in the kinds the type can point at. */
  notDeclared: number
  /** More than one declaration in the owner+ancestor chain: declined, never picked between. */
  ambiguousInChain: number
}

/**
 * The owner channel's CLAIM over the rows that state their own receiver.
 *
 * ## The defect this closes
 *
 * `storeResults`' `resolveTargetStmt` attaches a bare member name to the nearest same-named symbol
 * and otherwise to the LEXICOGRAPHICALLY SMALLEST id — `${projectId}:${relativePath}:${name}:${line}`,
 * compared as TEXT. A member name is not identifying (`act` is a method on many classes at once), so
 * for a member read whose own file does not declare the name the winner is whichever declaration
 * sorts first. The row is then stored RESOLVED, and nothing about it says the choice was arbitrary.
 *
 * That is the shape that makes an agent hallucinate rather than abstain: `SubWidget::run` calling
 * `$this->act()` with the graph answering `ZetaStore::act` is not an unresolved edge, it is a
 * confident false statement about which method the call reaches — and the honest answers are both
 * available (PHP's own lookup says the declared ancestor; where nothing declares it, the answer is
 * "not known").
 *
 * ## What it does
 *
 * A relation carrying `metadata.owner` is one whose receiver the ANALYZER could name (`$this->`,
 * `self::`, `static::`, `parent::`, `C::`), which is exactly the input `resolveMemberTargetsByOwner`
 * implements a rule for. So those rows are WITHDRAWN from the name-based binding and re-resolved by
 * the owner channel: the pass is authoritative for them, and a row it declines is left NULL rather
 * than handed back to the ranking.
 *
 * The withdrawal is not cosmetic: the pass only ever fills a NULL, so without it the ranking's wrong
 * answer would simply survive. Both halves are in one function on purpose — a caller that withdrew
 * and then failed to re-resolve would silently delete every owner-carrying binding in the project.
 *
 * Measured on php's whole admitted population (5,094 files, 350,368 edges) by
 * `validation/m14/fixtures/php/store-resolution-census.mts`, which builds this exact configuration as
 * its phase B: 40,699 rows owner-resolved by the ranking become **45,166**, and 5,964 of the 6,114
 * rows the ranking had bound elsewhere move to a declaration the receiver's own chain holds. The
 * trade it does make is stated rather than hidden: a row the ranking happened to get right and the
 * pass declines becomes an honest NULL instead of a lucky guess.
 *
 * ## Scope, by the DATA and not by a language switch
 *
 * The predicate is the presence of a receiver on the relation, not the file's language, because that
 * is what makes the pass applicable. php is the only lane publishing the key today (`withMemberOwner`
 * in `real-php-analyzer.ts`), so the blast radius is php today and widens automatically for any lane
 * that later publishes the same fact. A project with no owner-carrying rows costs one indexed
 * prefilter query and nothing else.
 *
 * It never creates or deletes an edge and never touches a row of another relationship type: `calls`
 * and `uses` are the pass's input, so they are the only types withdrawn, and a row that is withdrawn
 * is re-bound or left NULL by the same pass that would have been handed it anyway.
 */
export function claimOwnerCarryingTargets(
  rawDb: any,
  projectId: string,
): MemberOwnerResolutionResult & { withdrawn: number } {
  const withdrawnIds: string[] = []
  try {
    // The LIKE is a PREFILTER that the index can answer cheaply; the test is the parsed key below.
    // It cannot match `ownerKind` (whose key text is `"ownerKind":`), and a literal `"owner":`
    // inside some other metadata string is still rejected by the parse.
    const candidates = rawDb
      .prepare(
        `SELECT id, metadata FROM brain_relationship
          WHERE project_id = ? AND relationship_type IN ('calls','uses')
            AND target_symbol_id IS NOT NULL AND metadata IS NOT NULL AND metadata LIKE '%"owner":%'`,
      )
      .all(projectId) as any[]
    for (const r of candidates) {
      let owner = ""
      try {
        const parsed = JSON.parse(String(r?.metadata ?? "{}"))
        if (parsed && typeof parsed === "object" && typeof (parsed as any).owner === "string") {
          owner = (parsed as any).owner
        }
      } catch {
        // Unparseable metadata is not a receiver: the row keeps the binding it has.
      }
      if (!owner) continue
      withdrawnIds.push(String(r.id))
    }
    if (withdrawnIds.length > 0) {
      const clear = rawDb.prepare(
        `UPDATE brain_relationship SET target_symbol_id = NULL
          WHERE id = ? AND target_symbol_id IS NOT NULL`,
      )
      for (const id of withdrawnIds) clear.run(id)
    }
  } catch {
    // A withdrawal that throws mid-way leaves the rows it already cleared unresolved, and the pass
    // below is exactly the recovery for that — it re-binds them from the receiver. It is NOT true
    // that a failure leaves everything as it was, and saying so would be the kind of comment that
    // stops the next reader from checking.
  }
  const out = resolveMemberTargetsByOwner(rawDb, projectId)
  return { ...out, withdrawn: withdrawnIds.length }
}

export function resolveMemberTargetsByOwner(rawDb: any, projectId: string): MemberOwnerResolutionResult {
  const out: MemberOwnerResolutionResult = {
    scanned: 0,
    ownerResolved: 0,
    inheritedResolved: 0,
    resolved: 0,
    ownerNotInPopulation: 0,
    ownerAmbiguous: 0,
    notDeclared: 0,
    ambiguousInChain: 0,
  }
  try {
    // ---- the class-like symbols, by name, with their own heritage statement ------------------
    const byName = new Map<string, string[]>()
    const superTypesById = new Map<string, string[]>()
    const classLikeIds = new Set<string>()
    for (const row of rawDb
      .prepare(
        `SELECT id, name, super_types FROM brain_symbol
          WHERE project_id = ? AND symbol_type IN (${CLASS_LIKE.map(() => "?").join(", ")})`,
      )
      .all(projectId, ...CLASS_LIKE) as any[]) {
      const id = String(row?.id ?? "")
      const name = String(row?.name ?? "")
      if (!id || !name) continue
      classLikeIds.add(id)
      const list = byName.get(name) ?? (byName.set(name, []), byName.get(name)!)
      list.push(id)
      if (row?.super_types) {
        try {
          const parsed = JSON.parse(row.super_types)
          if (Array.isArray(parsed)) {
            const names = parsed.filter((x): x is string => typeof x === "string" && x.length > 0)
            if (names.length) superTypesById.set(id, names)
          }
        } catch {
          // A malformed payload is not a hierarchy: the symbol simply has no ancestors to walk.
        }
      }
    }
    if (byName.size === 0) return out

    // ---- members, keyed by the declaration that owns them -------------------------------------
    const membersByOwner = new Map<string, Map<string, { id: string; kind: string }[]>>()
    for (const row of rawDb
      .prepare(
        `SELECT id, name, symbol_type, owner_symbol_id FROM brain_symbol
          WHERE project_id = ? AND owner_symbol_id IS NOT NULL AND owner_symbol_id != ''`,
      )
      .all(projectId) as any[]) {
      const id = String(row?.id ?? "")
      const name = String(row?.name ?? "")
      const owner = String(row?.owner_symbol_id ?? "")
      if (!id || !name || !owner) continue
      let byMember = membersByOwner.get(owner)
      if (!byMember) { byMember = new Map(); membersByOwner.set(owner, byMember) }
      const list = byMember.get(name) ?? (byMember.set(name, []), byMember.get(name)!)
      list.push({ id, kind: String(row?.symbol_type ?? "") })
    }

    /**
     * A parent NAME from `super_types` resolved to a symbol id, or null. A qualified spelling is
     * tried whole first and then by its last segment, because an analyzer's heritage payload may
     * carry either; EITHER lookup must be unique, so an ambiguous parent ends its branch instead of
     * being guessed at.
     */
    const parentByName = (name: string): string | null => {
      const leaf = name.includes("\\") ? name.slice(name.lastIndexOf("\\") + 1) : name
      for (const key of name === leaf ? [name] : [name, leaf]) {
        const ids = byName.get(key)
        if (ids && ids.length === 1) return ids[0]!
      }
      return null
    }

    const ancestorCache = new Map<string, string[]>()
    const ancestorsOf = (id: string): string[] => {
      const hit = ancestorCache.get(id)
      if (hit) return hit
      const seen = new Set<string>()
      const outIds: string[] = []
      let frontier = (superTypesById.get(id) ?? []).map(parentByName).filter((x): x is string => !!x)
      let depth = 0
      while (frontier.length && depth < MAX_DEPTH) {
        const next: string[] = []
        for (const pid of frontier) {
          if (pid === id || seen.has(pid)) continue
          seen.add(pid)
          outIds.push(pid)
          for (const pname of superTypesById.get(pid) ?? []) {
            const gp = parentByName(pname)
            if (gp && gp !== id && !seen.has(gp)) next.push(gp)
          }
        }
        frontier = next
        depth++
      }
      ancestorCache.set(id, outIds)
      return outIds
    }

    // ---- the work -----------------------------------------------------------------------------
    const rows = rawDb
      .prepare(
        // The source's OWN owner is joined in, because it answers a question the owner NAME cannot:
        // when the receiver IS the enclosing declaration (`$this->m()`, `self::m()`, `static::m()`)
        // the store already knows that declaration by IDENTITY, and two classes called `Twin` in
        // different namespaces must not make the answer ambiguous. See the resolution below.
        `SELECT r.id, r.relationship_type, r.target_external, r.metadata,
                s.owner_symbol_id AS source_owner_id, so.name AS source_owner_name
           FROM brain_relationship r
           LEFT JOIN brain_symbol s ON s.id = r.source_symbol_id
           LEFT JOIN brain_symbol so ON so.id = s.owner_symbol_id
          WHERE r.project_id = ? AND r.target_symbol_id IS NULL
            AND r.relationship_type IN ('calls','uses')
            AND r.target_external IS NOT NULL AND r.target_external != ''`,
      )
      .all(projectId) as any[]

    const update = rawDb.prepare(
      `UPDATE brain_relationship
          SET target_symbol_id = ?,
              is_cross_file = CASE WHEN (SELECT file_id FROM brain_symbol WHERE id = ?)
                                   != (SELECT file_id FROM brain_symbol WHERE id = brain_relationship.source_symbol_id)
                                   THEN 1 ELSE 0 END
        WHERE id = ? AND target_symbol_id IS NULL`,
    )

    for (const row of rows) {
      const metadata = (() => {
        try {
          const parsed = JSON.parse(String(row?.metadata ?? "{}"))
          return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {}
        } catch {
          return {}
        }
      })()
      const owner = typeof metadata.owner === "string" ? metadata.owner : ""
      if (!owner) continue // no declared receiver: not this pass's input, by the analyzer's design
      out.scanned++

      // Rule 0, and it is asked before any name lookup: when the receiver's name IS the name of the
      // declaration the source belongs to, the receiver is that declaration — an identity the store
      // holds, so a name collision elsewhere in the project is irrelevant. `metadata.owner` is the
      // RECEIVER's class, not the source's, so the two are only interchangeable when the analyzer
      // published the same spelling for both (`$this->`/`self::`/`static::` — for `parent::` and
      // `C::` it publishes the BASE or the OTHER class, and those fall through to the name lookup,
      // which is exactly where an ambiguous spelling has to decline).
      let ownerId: string | null = null
      const srcOwnerId = String(row.source_owner_id ?? "")
      if (srcOwnerId && srcOwnerId !== "" && classLikeIds.has(srcOwnerId) && String(row.source_owner_name ?? "") === owner) {
        ownerId = srcOwnerId
      } else {
        const ownerIds = byName.get(owner)
        if (!ownerIds || ownerIds.length === 0) { out.ownerNotInPopulation++; continue }
        // Rule 1: a name that identifies two classes makes the owner channel a guess.
        if (ownerIds.length > 1) { out.ownerAmbiguous++; continue }
        ownerId = ownerIds[0]!
      }

      const target = String(row.target_external)
      const allowed = FILTER_KINDS[String(row.relationship_type)]
      const membersOf = (id: string): { id: string; kind: string }[] =>
        (membersByOwner.get(id)?.get(target) ?? []).filter((m) => !allowed || allowed.has(m.kind))

      const direct = membersOf(ownerId)
      if (direct.length === 1) {
        update.run(direct[0]!.id, direct[0]!.id, row.id)
        out.ownerResolved++
        out.resolved++
        continue
      }
      if (direct.length > 1) { out.ambiguousInChain++; continue }

      // Rule 2: nothing in the owner itself — the member is inherited or foreign.
      const chain = ancestorsOf(ownerId)
      if (chain.length === 0) { out.notDeclared++; continue }
      const inherited = new Map<string, { id: string; kind: string }>()
      for (const ancId of chain) for (const m of membersOf(ancId)) inherited.set(m.id, m)
      if (inherited.size === 1) {
        const only = [...inherited.values()][0]!
        update.run(only.id, only.id, row.id)
        out.inheritedResolved++
        out.resolved++
      } else if (inherited.size === 0) {
        out.notDeclared++
      } else {
        out.ambiguousInChain++
      }
    }
  } catch {
    // A resolution failure must never fail indexing: the rows stay exactly as the analyzer
    // published them, which is the pre-existing name-only behaviour and is honest.
  }
  return out
}
