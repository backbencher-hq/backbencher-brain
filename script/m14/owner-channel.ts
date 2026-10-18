/**
 * THE OWNER CHANNEL'S MODEL — the arbiter's copy of the rule `member-owner-resolution.ts` runs in
 * production, over the gate's in-memory key space.
 *
 * ## Why this file exists
 *
 * `claimOwnerCarryingTargets` (src/ast/member-owner-resolution.ts) is authoritative over every
 * `calls`/`uses` row that carries `metadata.owner`: it WITHDRAWS the name-based binding, re-binds
 * from the receiver's class through a kind-filtered member lookup and an ancestor walk over
 * `brain_symbol.super_types`, and a row it declines stays NULL. It runs in BOTH resolution paths
 * (`parallel-indexer.ts` ~:5219 and ~:6095). The incoming gate — the instrument every verdict in
 * this programme rests on — did not model a line of it, which that module's own header records:
 * "the incoming gate cannot see it (it does not model this pass at all)".
 *
 * The measurement error therefore runs in BOTH directions, and both are worth naming because one
 * of them is not obvious:
 *   - rows the store owner-RESOLVED read `ambiguous`/`unresolved` here — the gate says a row does
 *     not resolve when production does resolve it;
 *   - rows the store WITHDREW and then DECLINED would read `resolved` here if the name happened to
 *     be unique — the gate would credit a binding production deliberately removed (`$this->m()` on
 *     a receiver whose class does not declare `m` and whose ancestors do not either is an honest
 *     NULL in the store, not a name-resolution).
 *
 * So this module re-derives the pass's DECISION from the same inputs the gate already parses, and
 * the gate reports the owner channel's verdict for those rows instead of the name count.
 *
 * ## The rule, mirrored clause by clause (each cites the pass; a change there must land here)
 *
 *   1. OWNER IDENTITY. When the receiver is the class the source itself belongs to
 *      (`self`/`cls`/`this`), the pass uses the source's own `owner_symbol_id` — an identity, so a
 *      name collision elsewhere cannot make it ambiguous (rule 0). Otherwise the owner NAME must
 *      identify exactly ONE class-like symbol (`CLASS_LIKE = class|interface|trait|enum`); zero or
 *      several and the channel declines rather than guesses.
 *   2. CANDIDATE MEMBERS, kind-filtered by the relationship type (`FILTER_KINDS`: calls ->
 *      function|method|constructor; uses -> function|method|property|constant|enum_member|
 *      variable). Exactly one candidate resolves. Several of ONE kind are the SAME member published
 *      twice (python's class-body annotation beside the instance assignment; `@overload` stubs
 *      beside the implementation) and resolve; several of DIFFERENT kinds decline, because choosing
 *      between a method and a property is a guess.
 *   3. A QUALIFIED target (`Owner.member`) may only bind in the owner it NAMES — never through the
 *      ancestor walk, which would trade an honest NULL for a wrong edge.
 *   4. NOTHING IN THE OWNER ITSELF -> the ancestor chain: breadth-first over `super_types`, a parent
 *      name resolved whole and then by its last `\` segment, each lookup required unique, depth 16.
 *      Exactly one candidate across the WHOLE union resolves; zero decline; more decline.
 *
 * ## The one declared approximation
 *
 * Rule 0 identity. The pass reads the SOURCE symbol's `owner_symbol_id`; an edge reaching the gate
 * does not carry its source symbol. This model takes the INNERMOST class-like declaration of the
 * edge's own file whose extent covers the edge's line and whose name equals the owner name — which
 * is the same identity in the ordinary `self.m()` shape (the call sits inside the class), and can
 * differ only when the source's owner is not the class enclosing that line. When no covering class
 * matches, it falls through to the name lookup, exactly as the pass's `else` branch does. On that
 * path the model is never more forgiving than the pass.
 */

export const OWNER_CLASS_LIKE: ReadonlySet<string> = new Set(["class", "interface", "trait", "enum"])

/** Mirrored from `member-owner-resolution.ts` FILTER_KINDS — the census the php lane priced the
 *  pass with. A pass whose filter differed from its price would move a different number than the
 *  one published, and the difference would look like a measurement. */
export const OWNER_FILTER_KINDS: Record<string, ReadonlySet<string>> = {
  calls: new Set(["function", "method", "constructor"]),
  uses: new Set(["function", "method", "property", "constant", "enum_member", "variable"]),
}

const MAX_DEPTH = 16

/** What the gate must collect per symbol for this model. Deliberately compact: only class-like
 *  declarations (owner identity + heritage), symbols carrying an owner (members), and symbols with
 *  a heritage payload are kept, so a whole-corpus run does not pay a record per parsed symbol. */
export type OwnerSymbolRecord = {
  file: string
  name: string
  kind: string
  line: number
  endLine: number
  ownerName: string | null
  superTypes: string[]
}

export type OwnerProjectPools = {
  /** class-like name -> its declarations in this project (the pass's `byName`) */
  classLikeByName: Map<string, OwnerSymbolRecord[]>
  /** file -> class-like name -> declarations, for rule-0 identity and member linking */
  classLikeByFileAndName: Map<string, Map<string, OwnerSymbolRecord[]>>
  /** owner identity key -> member name -> candidates (the pass's `membersByOwner`) */
  membersByOwnerKey: Map<string, Map<string, { key: string; kind: string }[]>>
  /** class-like identity key -> heritage names (the pass reads `brain_symbol.super_types`) */
  superTypesByKey: Map<string, string[]>
}

export const EMPTY_OWNER_POOLS: OwnerProjectPools = {
  classLikeByName: new Map(),
  classLikeByFileAndName: new Map(),
  membersByOwnerKey: new Map(),
  superTypesByKey: new Map(),
}

const ownerKeyOf = (r: OwnerSymbolRecord): string => `${r.file}\u0000${r.name}\u0000${r.line}`
const coversLine = (r: OwnerSymbolRecord, line: number | null): boolean =>
  line !== null && line >= r.line && line <= r.endLine
const leafAfterBackslash = (s: string): string => (s.includes("\\") ? s.slice(s.lastIndexOf("\\") + 1) : s)

export function buildOwnerProjectPools(records: OwnerSymbolRecord[]): OwnerProjectPools {
  const pools: OwnerProjectPools = {
    classLikeByName: new Map(),
    classLikeByFileAndName: new Map(),
    membersByOwnerKey: new Map(),
    superTypesByKey: new Map(),
  }
  // PASS 1 — class-like declarations, and their heritage statements.
  for (const r of records) {
    if (!OWNER_CLASS_LIKE.has(r.kind)) continue
    const key = ownerKeyOf(r)
    const byName = pools.classLikeByName.get(r.name) ?? (pools.classLikeByName.set(r.name, []), pools.classLikeByName.get(r.name)!)
    byName.push(r)
    let byFile = pools.classLikeByFileAndName.get(r.file)
    if (!byFile) pools.classLikeByFileAndName.set(r.file, (byFile = new Map()))
    const inFile = byFile.get(r.name) ?? (byFile.set(r.name, []), byFile.get(r.name)!)
    inFile.push(r)
    if (r.superTypes.length > 0) pools.superTypesByKey.set(key, r.superTypes)
  }
  // PASS 2 — members, linked to the declaration that OWNS them. The store's link is
  // `owner_symbol_id`, which the indexer derives from the member's own `ownerName`/`scope` and the
  // enclosing same-named declaration in the SAME file (innermost covering candidate). The exact
  // spelling is tried first, then the leaf after `:`/`.`, the same order the indexer's containment
  // rule uses for qualified owner spellings.
  for (const r of records) {
    if (!r.ownerName) continue
    const byFile = pools.classLikeByFileAndName.get(r.file)
    if (!byFile) continue
    const leaf = String(r.ownerName).split(/[:.]/).filter(Boolean).pop() ?? String(r.ownerName)
    const candidates = [
      ...(byFile.get(r.ownerName) ?? []),
      ...(leaf !== r.ownerName ? byFile.get(leaf) ?? [] : []),
    ].filter((c) => coversLine(c, r.line))
    if (candidates.length === 0) continue
    // INNERMOST wins, as in the indexer's enclosure rule: a nested class's member belongs to the
    // nested class, not to the outer one that also covers the line.
    candidates.sort((a, b) => b.line - a.line)
    const owner = candidates[0]!
    const ownerKey = ownerKeyOf(owner)
    let byMember = pools.membersByOwnerKey.get(ownerKey)
    if (!byMember) pools.membersByOwnerKey.set(ownerKey, (byMember = new Map()))
    const list = byMember.get(r.name) ?? (byMember.set(r.name, []), byMember.get(r.name)!)
    list.push({ key: ownerKeyOf(r), kind: r.kind })
  }
  return pools
}

export type OwnerChannelOutcome = "resolved" | "declined"

export type OwnerChannelVerdict = {
  outcome: OwnerChannelOutcome
  /** which clause decided it — carried so a report can price the channel by mechanism instead of
   *  printing one number that hides whether it was the owner, a duplicate, or an ancestor. */
  reason:
    | "direct"
    | "sameKindDuplicate"
    | "inherited"
    | "ownerAbsent"
    | "ownerAmbiguous"
    | "noMember"
    | "kindAmbiguous"
    | "qualifiedNotDirect"
    | "chainAmbiguous"
    | "notApplicable"
}

/**
 * The pass's decision for ONE edge. `type` must be `calls` or `uses` (the only rows the store
 * channel touches); anything else is `notApplicable` and the caller must fall back to the name model.
 */
export function ownerChannelVerdict(
  pools: OwnerProjectPools,
  edge: { type: string; target: string; owner: string; srcFile: string; line: number | null },
): OwnerChannelVerdict {
  const allowed = OWNER_FILTER_KINDS[edge.type]
  if (!allowed) return { outcome: "declined", reason: "notApplicable" }

  // ---- OWNER IDENTITY -------------------------------------------------------------------------
  // Rule 0 approximation: the innermost class-like declaration in the edge's own file whose extent
  // covers the edge line and whose name is the owner name.
  let ownerKey: string | null = null
  const inFile = pools.classLikeByFileAndName.get(edge.srcFile)?.get(edge.owner) ?? []
  const covering = inFile.filter((c) => coversLine(c, edge.line))
  if (covering.length > 0) {
    covering.sort((a, b) => b.line - a.line)
    ownerKey = ownerKeyOf(covering[0]!)
  } else {
    const byName = pools.classLikeByName.get(edge.owner)
    if (!byName || byName.length === 0) return { outcome: "declined", reason: "ownerAbsent" }
    if (byName.length > 1) return { outcome: "declined", reason: "ownerAmbiguous" }
    ownerKey = ownerKeyOf(byName[0]!)
  }

  // ---- TARGET / CANDIDATES --------------------------------------------------------------------
  const raw = edge.target
  const dot = raw.lastIndexOf(".")
  const qualified = dot > 0
  const memberName = qualified ? raw.slice(dot + 1) : raw
  const candidatesOf = (key: string): { key: string; kind: string }[] =>
    (pools.membersByOwnerKey.get(key)?.get(memberName) ?? []).filter((m) => allowed.has(m.kind))

  const direct = candidatesOf(ownerKey)
  if (direct.length === 1) return { outcome: "resolved", reason: "direct" }
  if (direct.length > 1) {
    const kinds = new Set(direct.map((m) => m.kind))
    if (kinds.size === 1) return { outcome: "resolved", reason: "sameKindDuplicate" }
    return { outcome: "declined", reason: "kindAmbiguous" }
  }
  if (qualified) return { outcome: "declined", reason: "qualifiedNotDirect" }

  // ---- THE ANCESTOR CHAIN ---------------------------------------------------------------------
  const parentByKey = (name: string): string | null => {
    const leaf = leafAfterBackslash(name)
    for (const key of name === leaf ? [name] : [name, leaf]) {
      const list = pools.classLikeByName.get(key)
      if (list && list.length === 1) return ownerKeyOf(list[0]!)
    }
    return null
  }
  const seen = new Set<string>([ownerKey])
  const chain: string[] = []
  let frontier = (pools.superTypesByKey.get(ownerKey) ?? []).map(parentByKey).filter((x): x is string => x !== null)
  let depth = 0
  while (frontier.length > 0 && depth < MAX_DEPTH) {
    const next: string[] = []
    for (const pid of frontier) {
      if (seen.has(pid)) continue
      seen.add(pid)
      chain.push(pid)
      for (const pname of pools.superTypesByKey.get(pid) ?? []) {
        const gp = parentByKey(pname)
        if (gp && !seen.has(gp)) next.push(gp)
      }
    }
    frontier = next
    depth++
  }
  if (chain.length === 0) return { outcome: "declined", reason: "noMember" }
  const inherited = new Map<string, { key: string; kind: string }>()
  for (const anc of chain) for (const m of candidatesOf(anc)) inherited.set(m.key, m)
  if (inherited.size === 1) return { outcome: "resolved", reason: "inherited" }
  if (inherited.size === 0) return { outcome: "declined", reason: "noMember" }
  return { outcome: "declined", reason: "chainAmbiguous" }
}
