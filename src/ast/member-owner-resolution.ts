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
 * For each `calls`/`uses` row that carries an owner:
 *
 *   1. PHP's canonical `ownerIdentity` must identify exactly one declaration, with case-insensitive
 *      class lookup and no leaf fallback. Legacy owner names must identify exactly one class-like
 *      symbol unless the source's own owner supplies the identity;
 *   2. the candidates are the members that name the target whose `owner_symbol_id` is that symbol;
 *      the type's KIND filter is applied first (`calls` → callable kinds, `uses` → member kinds), so
 *      a `uses` against a name a class carries as both a method and a property stays unresolved;
 *   3. exactly one candidate resolves. Zero candidates fall through to the ancestors. TWO OR MORE
 *      candidates of the SAME KIND are one member published more than once (python's annotation
 *      beside its instance assignment, or `@overload` stubs beside the implementation), so they
 *      resolve too, to the smallest id. Two or more candidates of DIFFERENT KINDS decline, because
 *      "which one" between a method and a property is not something this pass is allowed to decide;
 *   4. the ANCESTOR walk uses PHP's canonical `superTypeIdentities` when present, otherwise
 *      `brain_symbol.super_types`, which the analyzers publish and this pass
 *      reads as the class's own statement of its heritage. A parent name that is ambiguous, or that
 *      names no symbol in this project, ends that branch — a class whose parent is outside the
 *      population stays unresolved rather than being resolved to a stranger. Traits are absent from
 *      `super_types` by the publishing analyzers' decision, which makes the ancestor count a LOWER
 *      bound;
 *   5. the default mode fills unresolved rows. Reconciliation also checks bound rows and writes
 *      only changed targets, including withdrawing a binding the receiver cannot support. Neither
 *      mode changes confidence or creates edges.
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
import { createPhpMemberResolver } from "./php-member-dispatch"

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
const PHP_MEMBER_KINDS = {
  callable: new Set(["method"]),
  property: new Set(["property"]),
  constant: new Set(["constant", "enum_member"]),
}

/** Ancestors are walked breadth-first; the M60 override retarget measured depth 14 on scala. */
const MAX_DEPTH = 16

export type MemberOwnerResolutionResult = {
  /** Unresolved `calls`/`uses` rows carrying an owner — the pass's whole input. */
  scanned: number
  /** Resolved because the owner itself declares the member. */
  ownerResolved: number
  /**
   * Of `ownerResolved`, the number that resolved over a SET of same-kind candidates that are the
   * SAME member published more than once (python's `x: T` annotation beside `self.x = ...`, or a
   * run of `@overload` stubs beside the implementation). Split out because it is a different fact
   * from "the class declares the member exactly once", and folding it in would hide how much of
   * the owner channel is answering a duplicate rather than a unique declaration.
   */
  sameKindDuplicateResolved: number
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
  /** Reconciliation only: rows whose stored target actually changed. */
  reconciledChanges?: number
  /** PHP member syntax whose receiver supplies no declaration identity. */
  unknownReceiverWithdrawn?: number
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
        `UPDATE brain_relationship SET target_symbol_id = NULL, is_cross_file = 0
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

export function resolveMemberTargetsByOwner(rawDb: any, projectId: string, opts: { reconcile?: boolean } = {}): MemberOwnerResolutionResult {
  const out: MemberOwnerResolutionResult = {
    scanned: 0,
    ownerResolved: 0,
    sameKindDuplicateResolved: 0,
    inheritedResolved: 0,
    resolved: 0,
    ownerNotInPopulation: 0,
    ownerAmbiguous: 0,
    notDeclared: 0,
    ambiguousInChain: 0,
  }
  try {
    // A method/property spelling on an untyped receiver cannot identify a
    // declaration, even when the project has only one same-named candidate.
    // Retain the edge and spelling, but withdraw any generic name binding.
    const unknown = rawDb.prepare(`
      SELECT id, metadata FROM brain_relationship WHERE project_id = ?
        AND relationship_type IN ('calls','uses') AND target_symbol_id IS NOT NULL
        AND (metadata LIKE '%"phpMemberReference":true%' OR metadata LIKE '%"typescriptUnresolvedReceiver":true%')
    `).all(projectId) as Array<{ id: string; metadata: string }>
    let unknownWithdrawn = 0
    const withdrawUnknown = rawDb.prepare(`UPDATE brain_relationship
      SET target_symbol_id = NULL, is_cross_file = 0, is_cross_language = 0, bridge_mechanism = NULL
      WHERE id = ?`)
    for (const row of unknown) {
      let metadata: Record<string, unknown>
      try { metadata = JSON.parse(row.metadata) } catch { continue }
      const unknownPhp = metadata.phpSpecific === true && metadata.phpMemberReference === true &&
        !(typeof metadata.ownerIdentity === "string" && metadata.ownerIdentity.length > 0)
      if (!unknownPhp && metadata.typescriptUnresolvedReceiver !== true) continue
      withdrawUnknown.run(row.id)
      unknownWithdrawn++
    }
    out.unknownReceiverWithdrawn = unknownWithdrawn
    if (opts.reconcile) out.reconciledChanges = unknownWithdrawn
    // ---- the class-like symbols, by name, with their own heritage statement ------------------
    const byName = new Map<string, string[]>()
    const phpByIdentity = new Map<string, string[]>()
    const phpClassIds = new Set<string>()
    const canonicalHeritageIds = new Set<string>()
    const superTypesById = new Map<string, string[]>()
    const classLikeIds = new Set<string>()
    for (const row of rawDb
      .prepare(
        `SELECT id, name, qualified_name, super_types, annotations FROM brain_symbol
          WHERE project_id = ? AND symbol_type IN (${CLASS_LIKE.map(() => "?").join(", ")})`,
      )
      .all(projectId, ...CLASS_LIKE) as any[]) {
      const id = String(row?.id ?? "")
      const name = String(row?.name ?? "")
      if (!id || !name) continue
      classLikeIds.add(id)
      const list = byName.get(name) ?? (byName.set(name, []), byName.get(name)!)
      list.push(id)
      let heritage = row.super_types
      try {
        const metadata = JSON.parse(String(row.annotations ?? "{}"))
        if (metadata.phpSpecific === true) {
          phpClassIds.add(id)
          const identity = String(metadata.fqn ?? row.qualified_name ?? name).replace(/^\\/, "").toLowerCase()
          const declarations = phpByIdentity.get(identity) ?? []
          declarations.push(id)
          phpByIdentity.set(identity, declarations)
          if (Array.isArray(metadata.superTypeIdentities)) {
            canonicalHeritageIds.add(id)
            heritage = JSON.stringify(metadata.superTypeIdentities)
          }
        }
      } catch { /* Legacy symbols keep their stored hierarchy. */ }
      if (heritage) {
        try {
          const parsed = JSON.parse(heritage)
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
      // PHP methods are case insensitive; properties and constants retain case.
      if (phpClassIds.has(owner) && row.symbol_type === "method" && name !== name.toLowerCase()) {
        const folded = name.toLowerCase()
        const methods = byMember.get(folded) ?? []
        methods.push({ id, kind: "method" })
        byMember.set(folded, methods)
      }
    }

    /**
     * A parent NAME from `super_types` resolved to a symbol id, or null. A qualified spelling is
     * tried whole first and then by its last segment, because an analyzer's heritage payload may
     * carry either; EITHER lookup must be unique, so an ambiguous parent ends its branch instead of
     * being guessed at. Canonical PHP identities use the complete name only;
     * a missing qualified class must never resolve to a different namespace's leaf.
     */
    const parentByName = (name: string, canonical = false): string | null => {
      if (canonical) {
        const ids = phpByIdentity.get(name.replace(/^\\/, "").toLowerCase())
        return ids?.length === 1 ? ids[0]! : null
      }
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
      let frontier = (superTypesById.get(id) ?? []).map(name => parentByName(name, canonicalHeritageIds.has(id))).filter((x): x is string => !!x)
      let depth = 0
      while (frontier.length && depth < MAX_DEPTH) {
        const next: string[] = []
        for (const pid of frontier) {
          if (pid === id || seen.has(pid)) continue
          seen.add(pid)
          outIds.push(pid)
          for (const pname of superTypesById.get(pid) ?? []) {
            const gp = parentByName(pname, canonicalHeritageIds.has(pid))
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
        `SELECT r.id, r.relationship_type, r.target_symbol_id, r.target_external, r.metadata,
                s.owner_symbol_id AS source_owner_id, so.name AS source_owner_name
           FROM brain_relationship r
           LEFT JOIN brain_symbol s ON s.id = r.source_symbol_id
           LEFT JOIN brain_symbol so ON so.id = s.owner_symbol_id
          WHERE r.project_id = ? ${opts.reconcile ? "" : "AND r.target_symbol_id IS NULL"}
            AND r.relationship_type IN ('calls','uses')
            AND r.metadata IS NOT NULL AND r.metadata LIKE '%"owner":%'
            AND r.target_external IS NOT NULL AND r.target_external != ''`,
      )
      .all(projectId) as any[]

    const update = rawDb.prepare(
      `UPDATE brain_relationship
          SET target_symbol_id = ?,
              is_cross_file = CASE WHEN (SELECT file_id FROM brain_symbol WHERE id = ?)
                                   != (SELECT file_id FROM brain_symbol WHERE id = brain_relationship.source_symbol_id)
                                   THEN 1 ELSE 0 END
        WHERE id = ? ${opts.reconcile ? "" : "AND target_symbol_id IS NULL"}`,
    )
    const consideredResolved = new Set<string>()
    const phpMember = createPhpMemberResolver(rawDb, projectId)
    const resolvedRows = new Set<string>()
    let reconciledChanges = unknownWithdrawn
    const bind = (row: any, target: string): void => {
      resolvedRows.add(String(row.id))
      if (opts.reconcile && row.target_symbol_id === target) return
      update.run(target, target, row.id)
      reconciledChanges++
    }

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
      if (opts.reconcile && row.target_symbol_id) consideredResolved.add(String(row.id))
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
      const identity = typeof metadata.ownerIdentity === "string" ? metadata.ownerIdentity : ""
      if (metadata.phpSpecific === true && identity) {
        const ids = phpByIdentity.get(identity.replace(/^\\/, "").toLowerCase())
        if (!ids?.length) { out.ownerNotInPopulation++; continue }
        if (ids.length !== 1) { out.ownerAmbiguous++; continue }
        ownerId = ids[0]!
      } else if (srcOwnerId && srcOwnerId !== "" && classLikeIds.has(srcOwnerId) && String(row.source_owner_name ?? "") === owner) {
        ownerId = srcOwnerId
      } else {
        const ownerIds = byName.get(owner)
        if (!ownerIds || ownerIds.length === 0) { out.ownerNotInPopulation++; continue }
        // Rule 1: a name that identifies two classes makes the owner channel a guess.
        if (ownerIds.length > 1) { out.ownerAmbiguous++; continue }
        ownerId = ownerIds[0]!
      }

      // THE TARGET MAY BE OWNER-QUALIFIED (`Owner.member`), and the lookup below is keyed by the
      // member's BARE name. PHP member names cannot contain a dot — a method, property or class
      // constant is identifier-shaped (`$this->m()`, `self::CONST`, `C::$prop`) — so the leaf after
      // the LAST dot is the member name and nothing is lost by taking it. (That is a fact about PHP
      // and not about targets in general: a dotted target in another language may be a path, which
      // is why this derivation lives here and is not applied to every lane.)
      //
      // WITHOUT THIS THE PASS DECLINED EVERY QUALIFIED ROW, and that was measured rather than
      // reasoned: `qualifyProvenMemberTargets` (real-php-analyzer.ts) now emits `Owner.member` where
      // the file proves the member, `claimOwnerCarryingTargets` withdraws every owner-carrying row
      // from the insert-time rank, and a lookup for a member literally named `Owner.member` finds
      // nothing — so five pins in validation/m14/fixtures/php/owner-resolution-gate.mts went red with
      // the row left NULL, a resolution withdrawn and not replaced.
      //
      // A QUALIFIED TARGET MAY ONLY BIND IN THE OWNER IT NAMES. `Owner.member` asserts that THIS
      // owner declares the member, so the ancestor rule is NOT consulted for it: falling through
      // would bind a leaf some ancestor happens to share, trading a NULL for a WRONG edge that the
      // incoming gate cannot see (it does not model this pass at all). A qualified target whose owner
      // does not declare the member therefore stays NULL and is counted with the other not-declared
      // rows.
      const rawTarget = String(row.target_external)
      const dot = rawTarget.lastIndexOf(".")
      const qualified = dot > 0
      const target = qualified ? rawTarget.slice(dot + 1) : rawTarget
      const allowed = metadata.phpSpecific === true
        ? (row.relationship_type === "calls" || metadata.isTearOff === true ? PHP_MEMBER_KINDS.callable
          : metadata.isConstFetch === true ? PHP_MEMBER_KINDS.constant
          : metadata.isMemberRead === true ? PHP_MEMBER_KINDS.property
          : FILTER_KINDS[String(row.relationship_type)])
        : FILTER_KINDS[String(row.relationship_type)]
      if (metadata.phpSpecific === true && phpClassIds.has(ownerId)) {
        const kind = row.relationship_type === "calls" || metadata.isTearOff === true ? "method"
          : metadata.isConstFetch === true ? "constant" : metadata.isMemberRead === true ? "property" : undefined
        if (kind) {
          const result = phpMember(ownerId, target, kind)
          if (result.status === "found") {
            bind(row, result.member.id)
            if (result.member.owner === ownerId) out.ownerResolved++
            else out.inheritedResolved++
            out.resolved++
          } else if (result.status === "unknown") out.ambiguousInChain++
          else out.notDeclared++
          continue
        }
      }
      const membersOf = (id: string): { id: string; kind: string }[] => {
        const members = membersByOwner.get(id)
        const candidates = [...(members?.get(target) ?? [])]
        if (phpClassIds.has(id) && target !== target.toLowerCase()) {
          for (const method of members?.get(target.toLowerCase()) ?? []) {
            if (method.kind === "method" && !candidates.some(candidate => candidate.id === method.id)) candidates.push(method)
          }
        }
        return candidates.filter((m) => !allowed || allowed.has(m.kind))
      }

      const direct = membersOf(ownerId)
      if (direct.length === 1) {
        bind(row, direct[0]!.id)
        out.ownerResolved++
        out.resolved++
        continue
      }
      if (direct.length > 1) {
        // SAME-KIND candidates are ONE member, and the rule is a fact about the CANDIDATES rather
        // than about a language. A language can publish two symbols for a single member — python's
        // `x: T` (class-body annotation, PEP 526) beside `self.x = ...` (instance assignment) is
        // the measured shape, and a run of `@overload` stubs beside the implementation is the
        // other — and when every candidate shares the owner's identity, the member name AND the
        // kind, "which one" is not a choice between different declarations: they are the same
        // member. Binding to any of them lands the edge on that member, so the pass resolves
        // rather than declines, choosing the SMALLEST id as TEXT so the answer is stable across
        // runs and resumable indexing.
        //
        // A candidate set with MORE THAN ONE KIND still DECLINES: a `uses` against a name a class
        // carries as both a method and a property is a real ambiguity (two different members of
        // one name), and picking between KINDS is exactly the guess this pass exists to refuse.
        // php cannot reach the same-kind branch for a single class (it forbids two properties or
        // two methods of one name) and python's whole admitted corpus reaches it on ~1,700 rows,
        // which is why this is stated as a rule about the candidates and not as a language switch.
        const kinds = new Set(direct.map((m) => m.kind))
        if (kinds.size === 1) {
          let pick = direct[0]!
          for (const m of direct) if (m.id < pick.id) pick = m
          bind(row, pick.id)
          out.sameKindDuplicateResolved++
          out.ownerResolved++
          out.resolved++
          continue
        }
        out.ambiguousInChain++
        continue
      }
      if (qualified) { out.notDeclared++; continue }

      // Rule 2: nothing in the owner itself — the member is inherited or foreign. BARE targets only:
      // a qualified one has already been answered above, or declined.
      const chain = ancestorsOf(ownerId)
      if (chain.length === 0) { out.notDeclared++; continue }
      const inherited = new Map<string, { id: string; kind: string }>()
      for (const ancId of chain) for (const m of membersOf(ancId)) inherited.set(m.id, m)
      if (inherited.size === 1) {
        const only = [...inherited.values()][0]!
        bind(row, only.id)
        out.inheritedResolved++
        out.resolved++
      } else if (inherited.size === 0) {
        out.notDeclared++
      } else {
        out.ambiguousInChain++
      }
    }
    if (opts.reconcile) {
      const clear = rawDb.prepare("UPDATE brain_relationship SET target_symbol_id = NULL, is_cross_file = 0 WHERE id = ?")
      for (const id of consideredResolved) {
        if (resolvedRows.has(id)) continue
        clear.run(id)
        reconciledChanges++
      }
      out.reconciledChanges = reconciledChanges
    }
  } catch {
    // Keep successful decisions if a later lookup fails. Unprocessed rows keep
    // their prior binding; this best-effort pass does not roll earlier writes back.
  }
  return out
}
