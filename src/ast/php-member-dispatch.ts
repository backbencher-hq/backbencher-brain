import type { PhpTraitUse } from "./php-trait-composition"

type Member = { id: string; owner: string; abstract: boolean; visibility: string; contextOwner?: string }
type Resolution = { status: "found"; member: Member } | { status: "absent" | "unknown" }
type Kind = "method" | "property" | "constant"
type Type = { id: string; kind: string; parent?: string; interfaces: string[]; traits?: PhpTraitUse[] }
const absent: Resolution = { status: "absent" }
const unknown: Resolution = { status: "unknown" }

/** Resolve static declaration destinations with PHP's class > traits > parent precedence. */
export function createPhpMemberResolver(db: any, projectId: string): (owner: string, name: string, kind: Kind) => Resolution {
  const types = new Map<string, Type>()
  const identities = new Map<string, Type[]>()
  const members = new Map<string, Member[]>()
  const key = (owner: string, name: string, kind: Kind) => JSON.stringify([owner, kind === "method" ? name.toLowerCase() : name, kind])
  for (const row of db.prepare(`SELECT s.id, s.symbol_type, s.annotations FROM brain_symbol s
    JOIN brain_file f ON f.id=s.file_id WHERE s.project_id=? AND f.language='php'
    AND s.symbol_type IN ('class','trait','enum','interface')`).all(projectId)) {
    let metadata: any
    try { metadata = JSON.parse(row.annotations ?? "{}") } catch { continue }
    if (typeof metadata.fqn !== "string") continue
    const type: Type = { id: row.id, kind: row.symbol_type, parent: metadata.baseIdentity, traits: metadata.phpTraits,
      interfaces: Array.isArray(metadata.superTypeIdentities) ? metadata.superTypeIdentities : [] }
    types.set(type.id, type)
    const identity = metadata.fqn.toLowerCase()
    identities.set(identity, [...(identities.get(identity) ?? []), type])
  }
  for (const row of db.prepare(`SELECT id, owner_symbol_id, name, symbol_type, is_abstract, visibility FROM brain_symbol
    WHERE project_id=? AND symbol_type IN ('method','property','constant','enum_member')`).all(projectId)) {
    if (!types.has(row.owner_symbol_id)) continue
    const kind = row.symbol_type === "enum_member" ? "constant" : row.symbol_type as Kind
    const k = key(row.owner_symbol_id, row.name, kind)
    members.set(k, [...(members.get(k) ?? []), { id: row.id, owner: row.owner_symbol_id, abstract: row.is_abstract === 1, visibility: row.visibility ?? "public" }])
  }
  const resolveIdentity = (identity: string): Type | undefined => {
    const matches = identities.get(identity)
    return matches?.length === 1 ? matches[0] : undefined
  }
  const choose = (values: Resolution[]): Resolution => {
    if (values.some(value => value.status === "unknown")) return unknown
    const concrete = new Map<string, Member>()
    const abstracts = new Map<string, Member>()
    for (const value of values) if (value.status === "found") {
      if (value.member.abstract) abstracts.set(value.member.id, value.member)
      else concrete.set(value.member.id, value.member)
    }
    if (concrete.size > 1) return unknown
    if (concrete.size === 1) return { status: "found", member: [...concrete.values()][0] }
    if (abstracts.size === 1) return { status: "found", member: [...abstracts.values()][0] }
    return abstracts.size ? unknown : absent
  }
  const lookup = (owner: string, name: string, kind: Kind, seen: Set<string>): Resolution => {
    const type = types.get(owner)
    if (!type || seen.has(owner) || seen.size >= 64) return unknown
    const next = new Set(seen).add(owner)
    const direct = members.get(key(owner, name, kind)) ?? []
    if (direct.length > 1) return unknown
    if (direct.length === 1) return { status: "found", member: direct[0] }
    if (type.kind === "interface") {
      const candidates = type.interfaces.map(identity => {
        const parent = resolveIdentity(identity)
        return parent?.kind === "interface" ? lookup(parent.id, name, kind, next) : unknown
      })
      return choose(candidates)
    }
    // Old indexed types have no composition evidence; do not guess through it.
    if (!Array.isArray(type.traits)) return unknown
    const imported: Resolution[] = []
    for (const group of type.traits) {
      if (!group.complete) return unknown
      const fromTrait = (identity: string, member: string): Resolution => {
        const trait = resolveIdentity(identity)
        return trait?.kind === "trait" ? lookup(trait.id, member, kind, next) : unknown
      }
      const original = (member: string): Resolution[] => {
        const excluded = new Set<string>()
        if (kind === "method") for (const rule of group.exclusions) if (rule.method === member) {
          if (!group.traits.includes(rule.trait) || fromTrait(rule.trait, member).status !== "found") return [unknown]
          for (const identity of rule.excluded) excluded.add(identity)
        }
        return group.traits.filter(identity => !excluded.has(identity)).map(identity => fromTrait(identity, member))
      }
      imported.push(...original(name))
      if (kind === "method") for (const alias of group.aliases) if (alias.alias === name) {
        // A qualified alias may deliberately expose an excluded implementation.
        let adapted: Resolution
        if (alias.trait) adapted = group.traits.includes(alias.trait) ? fromTrait(alias.trait, alias.method) : unknown
        // Unqualified aliases are ambiguous even when insteadof selects an original method.
        else adapted = choose(group.traits.map(identity => fromTrait(identity, alias.method)))
        if (adapted.status === "found" && alias.visibility) adapted = { status: "found", member: { ...adapted.member, visibility: alias.visibility } }
        imported.push(adapted)
      }
    }
    const composed = choose(imported)
    if (composed.status === "found" && composed.member.abstract) {
      if (type.kind === "trait") return composed
      // An abstract trait requirement does not replace a concrete inherited method.
      const parent = type.parent ? resolveIdentity(type.parent) : undefined
      const inherited = parent ? lookup(parent.id, name, kind, next) : type.parent ? unknown : absent
      if (inherited.status === "unknown") return unknown
      if (inherited.status === "found" && !inherited.member.abstract) return inherited
      return { status: "found", member: { ...composed.member, contextOwner: type.id } }
    }
    if (composed.status === "found" && kind !== "method" && type.parent) {
      // Trait/parent property and constant collisions changed in PHP 8.5.
      // Without a configured PHP version and compatibility check, abstain.
      const parent = resolveIdentity(type.parent)
      if (!parent || lookup(parent.id, name, kind, next).status !== "absent") return unknown
    }
    if (composed.status !== "absent") {
      return composed.status === "found" && type.kind !== "trait"
        ? { status: "found", member: { ...composed.member, contextOwner: type.id } } : composed
    }
    if (type.parent) {
      const parent = resolveIdentity(type.parent)
      const inherited = parent?.kind === "class" ? lookup(parent.id, name, kind, next) : unknown
      if (inherited.status !== "absent") return inherited
    }
    if (kind === "constant") return choose(type.interfaces.filter(identity => identity !== type.parent).map(identity => {
      const contract = resolveIdentity(identity)
      return contract?.kind === "interface" ? lookup(contract.id, name, kind, next) : unknown
    }))
    return absent
  }
  const cache = new Map<string, Resolution>()
  return (owner, name, kind) => {
    const k = key(owner, name, kind)
    const cached = cache.get(k)
    if (cached) return cached
    const result = lookup(owner, kind === "method" ? name.toLowerCase() : name, kind, new Set())
    cache.set(k, result)
    return result
  }
}
