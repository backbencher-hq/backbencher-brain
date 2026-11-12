/**
 * Reconcile PHP's implicit class-method overrides against stored declaration
 * identities. Runs after generic name resolution, including incremental repair.
 * An exact declaring ancestor is stronger than a name-only companion; it still
 * does not prove PHP signature compatibility, so output remains inferred.
 */
import { phpSignatureShapeCompatible, type PhpSignatureShape } from "./php-signature-shape"
import { phpClassSubtype, phpSignatureVariance } from "./php-signature-variance"
import { createPhpMemberResolver } from "./php-member-dispatch"
type PhpType = { id: string; file: string; identity: string; parent?: string; name: string; hasTraits: boolean }
type PhpMethod = {
  id: string; owner: string; file: string; name: string; visibility: string;
  static: boolean; final: boolean; line: number; shape?: PhpSignatureShape
}
type DesiredOverride = { id: string; source: PhpMethod; target: PhpMethod; spelling: string; metadata: string }

export interface PhpOverrideResolutionResult {
  methods: number
  candidates: number
  insertedOrUpdated: number
  withdrawn: number
  changedSourceIds: string[]
  changedTargetIds: string[]
}

const objectMetadata = (raw: unknown): Record<string, unknown> => {
  try {
    const value = JSON.parse(String(raw ?? "{}"))
    return value && typeof value === "object" && !Array.isArray(value) ? value : {}
  } catch { return {} }
}

/** PHP inserts trait-relative self/parent types into the consuming class scope. */
function composeSignature(shape: PhpSignatureShape | undefined, owner: PhpType | undefined): PhpSignatureShape | undefined {
  if (!shape || !owner) return shape
  const type = (value: string[][] | undefined): string[][] | undefined => {
    if (!value) return undefined
    const result: string[][] = []
    for (const intersection of value) {
      const mapped: string[] = []
      for (const atom of intersection) {
        const identity = atom === 'class:@trait:self' ? owner.identity : atom === 'class:@trait:parent' ? owner.parent : undefined
        if (atom.startsWith('class:@trait:') && !identity) return undefined
        mapped.push(identity ? `class:${identity}` : atom)
      }
      result.push(mapped)
    }
    return result
  }
  return {...shape, parameters: shape.parameters.map(parameter => ({...parameter, type: type(parameter.type)})), returnType: type(shape.returnType)}
}

export function reconcilePhpProjectOverrides(rawDb: any, projectId: string): PhpOverrideResolutionResult {
  const stats: PhpOverrideResolutionResult = { methods: 0, candidates: 0, insertedOrUpdated: 0, withdrawn: 0, changedSourceIds: [], changedTargetIds: [] }
  const changedSources = new Set<string>()
  const changedTargets = new Set<string>()
  const hierarchy = new Map<string, string[][]>()
  for (const row of rawDb.prepare(`SELECT s.annotations FROM brain_symbol s JOIN brain_file f ON f.id=s.file_id
    WHERE s.project_id=? AND f.language='php' AND s.symbol_type IN ('class','interface','enum')`).all(projectId)) {
    const metadata = objectMetadata(row.annotations)
    if (typeof metadata.fqn !== "string") continue
    const identity = metadata.fqn.toLowerCase()
    const declarations = hierarchy.get(identity) ?? []
    declarations.push(Array.isArray(metadata.superTypeIdentities) ? metadata.superTypeIdentities : [])
    hierarchy.set(identity, declarations)
  }
  const variance = (child: PhpMethod, parent: PhpMethod) => phpSignatureVariance(child.shape, parent.shape, child.name,
    (sub, sup) => phpClassSubtype(hierarchy, sub, sup))
  const classesById = new Map<string, PhpType>()
  const classesByIdentity = new Map<string, PhpType[]>()
  for (const row of rawDb.prepare(`
    SELECT s.id, s.file_id, s.name, s.annotations
    FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id
    WHERE s.project_id = ? AND f.language = 'php' AND s.symbol_type = 'class'
  `).all(projectId)) {
    const metadata = objectMetadata(row.annotations)
    if (typeof metadata.fqn !== "string" || !metadata.fqn) continue
    const identity = metadata.fqn.replace(/^\\/, "").toLowerCase()
    const type: PhpType = {
      id: row.id, file: row.file_id, name: metadata.fqn, identity,
      parent: typeof metadata.baseIdentity === "string" ? metadata.baseIdentity : undefined,
      hasTraits: Array.isArray(metadata.phpTraits) && metadata.phpTraits.length > 0,
    }
    classesById.set(type.id, type)
    const declarations = classesByIdentity.get(identity) ?? []
    declarations.push(type)
    classesByIdentity.set(identity, declarations)
  }
  const methods: PhpMethod[] = []
  const methodsById = new Map<string, PhpMethod>()
  const membersByOwner = new Map<string, Map<string, PhpMethod[]>>()
  for (const row of rawDb.prepare(`
    SELECT s.id, s.owner_symbol_id, s.file_id, s.name, s.visibility,
      s.is_static, s.line_start, s.annotations
    FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id
    WHERE s.project_id = ? AND f.language = 'php' AND s.symbol_type = 'method'
  `).all(projectId)) {
    const method: PhpMethod = {
      id: row.id, owner: row.owner_symbol_id, file: row.file_id, name: row.name,
      visibility: row.visibility ?? "public", static: row.is_static === 1,
      final: objectMetadata(row.annotations).isFinal === true, line: row.line_start,
      shape: objectMetadata(row.annotations).phpSignatureShape as PhpSignatureShape | undefined,
    }
    methodsById.set(method.id, method)
    if (!classesById.has(row.owner_symbol_id)) continue
    methods.push(method)
    const members = membersByOwner.get(method.owner) ?? new Map<string, PhpMethod[]>()
    const key = method.name.toLowerCase()
    const declarations = members.get(key) ?? []
    declarations.push(method)
    members.set(key, declarations)
    membersByOwner.set(method.owner, members)
  }
  stats.methods = methods.length
  const cycleCache = new Map<string, boolean>()
  const cyclicAncestry = (owner: PhpType): boolean => {
    const seen = new Set<string>()
    let type: PhpType | undefined = owner
    let cyclic = false
    while (type) {
      const known = cycleCache.get(type.id)
      if (known !== undefined) { cyclic = known; break }
      if (seen.has(type.id)) { cyclic = true; break }
      seen.add(type.id)
      const declarations: PhpType[] | undefined = type.parent ? classesByIdentity.get(type.parent) : undefined
      type = declarations?.length === 1 ? declarations[0] : undefined
    }
    for (const id of seen) cycleCache.set(id, cyclic)
    return cyclic
  }
  const cyclicTypes = new Set([...classesById.values()].filter(cyclicAncestry).map(type => type.id))
  const desired = new Map<string, DesiredOverride>()
  const resolveMember = createPhpMemberResolver(rawDb, projectId)
  for (const method of methods) {
    const owner = classesById.get(method.owner)!
    if (cyclicTypes.has(owner.id)) continue
    if (classesByIdentity.get(owner.identity)?.length !== 1) continue
    if (membersByOwner.get(owner.id)?.get(method.name.toLowerCase())?.length !== 1) continue
    if (method.name.toLowerCase() === "__construct") {
      let contractParent = owner.parent
      const seenContracts = new Set<string>()
      let incompatibleContract = false
      while (contractParent && !seenContracts.has(contractParent)) {
        seenContracts.add(contractParent)
        const declarations = classesByIdentity.get(contractParent)
        if (declarations?.length !== 1) break
        const ancestor = declarations[0]!
        let contracts = membersByOwner.get(ancestor.id)?.get("__construct") ?? []
        if (!contracts.length && ancestor.hasTraits) {
          const composed = resolveMember(ancestor.id, "__construct", "method")
          if (composed.status === "unknown") { incompatibleContract = true; break }
          if (composed.status === "found") {
            const declaration = methodsById.get(composed.member.id)
            if (declaration) contracts = [{ ...declaration, shape: composeSignature(declaration.shape,
              classesById.get(composed.member.contextOwner ?? declaration.owner)) }]
          }
        }
        if (contracts.some(contract => contract.shape?.abstract &&
            (!phpSignatureShapeCompatible(method.shape, contract.shape, method.name) || variance(method, contract) === false))) {
          incompatibleContract = true
          break
        }
        contractParent = ancestor.parent
      }
      if (incompatibleContract) continue
    }
    let parent = owner.parent
    const visited = new Set([owner.identity])
    while (parent && !visited.has(parent)) {
      visited.add(parent)
      const declarations = classesByIdentity.get(parent)
      if (declarations?.length !== 1) break
      const ancestor = declarations[0]!
      const matching = membersByOwner.get(ancestor.id)?.get(method.name.toLowerCase()) ?? []
      if (matching.length > 1) break
      let target = matching[0]
      let composedOwner: PhpType | undefined
      let traitComposition = false
      if (!target && ancestor.hasTraits) {
        const composed = resolveMember(ancestor.id, method.name, "method")
        if (composed.status !== "found") break
        const declaration = methodsById.get(composed.member.id)
        if (!declaration) break
        target = { ...declaration, visibility: composed.member.visibility }
        composedOwner = classesById.get(composed.member.contextOwner ?? declaration.owner)
        traitComposition = !!composed.member.contextOwner && composed.member.contextOwner !== declaration.owner
        if (traitComposition) target.shape = composeSignature(target.shape, composedOwner)
      }
      if (target && target.visibility !== "private") {
        // Reject declaration modifiers before calling-shape and bounded variance checks.
        const visibilityRank = (visibility: string) => visibility === "private" ? 0 : visibility === "protected" ? 1 : 2
        if (target.final || target.static !== method.static || visibilityRank(method.visibility) < visibilityRank(target.visibility)) break
        if (!phpSignatureShapeCompatible(method.shape, target.shape, method.name)) break
        const typeCompatibility = variance(method, target)
        if (typeCompatibility === false) break
        const id = `${projectId}:php-override:${method.id}`
        desired.set(id, {
          id, source: method, target, spelling: `${composedOwner?.name ?? ancestor.name}.${traitComposition ? method.name : target.name}`,
          metadata: JSON.stringify({
            phpSpecific: true, phpOverrideDerived: true, isOverride: true,
            evidenceClass: "inferred", reasonCode: "project-declaration-hierarchy",
            declaringTypeIdentity: composedOwner?.identity ?? ancestor.identity, signatureCompatibility: typeCompatibility === true ? "checked" : "unchecked",
            ...(traitComposition ? { traitComposition: true, declarationMethod: target.name } : {}),
            signatureShapeChecked: !!method.shape && !!target.shape,
          }),
        })
        break
      }
      parent = ancestor.parent
    }
  }
  stats.candidates = desired.size
  const existing = rawDb.prepare(`
    SELECT r.id, r.source_symbol_id, r.target_symbol_id, r.target_external,
      r.confidence, r.line_number, r.is_cross_file, r.metadata
    FROM brain_relationship r
    JOIN brain_symbol s ON s.id = r.source_symbol_id
    JOIN brain_file f ON f.id = s.file_id
    WHERE r.project_id = ? AND r.relationship_type = 'overrides' AND f.language = 'php'
  `).all(projectId)
  const byId = new Map<string, any>(existing.map((row: any) => [row.id, row]))
  const upsert = rawDb.prepare(`
    INSERT INTO brain_relationship (
      id, project_id, source_symbol_id, target_symbol_id, target_external,
      relationship_type, confidence, line_number, is_cross_file, is_cross_language, metadata
    ) VALUES (?, ?, ?, ?, ?, 'overrides', 0.85, ?, ?, 0, ?)
    ON CONFLICT(id) DO UPDATE SET source_symbol_id = excluded.source_symbol_id,
      target_symbol_id = excluded.target_symbol_id, target_external = excluded.target_external,
      confidence = excluded.confidence, line_number = excluded.line_number,
      is_cross_file = excluded.is_cross_file, is_cross_language = 0,
      metadata = excluded.metadata, time_updated = strftime('%s','now') * 1000
  `)
  const withdraw = rawDb.prepare("DELETE FROM brain_relationship WHERE project_id = ? AND id = ?")
  rawDb.transaction(() => {
    for (const edge of desired.values()) {
      const old = byId.get(edge.id)
      const crossFile = edge.source.file === edge.target.file ? 0 : 1
      const oldMetadata = objectMetadata(old?.metadata)
      const ownMetadata = objectMetadata(edge.metadata)
      if (old && old.source_symbol_id === edge.source.id && old.target_symbol_id === edge.target.id &&
          old.target_external === edge.spelling && old.confidence === 0.85 && old.line_number === edge.source.line &&
          old.is_cross_file === crossFile && Object.entries(ownMetadata).every(([key, value]) => oldMetadata[key] === value)) continue
      upsert.run(edge.id, projectId, edge.source.id, edge.target.id, edge.spelling, edge.source.line, crossFile, edge.metadata)
      changedSources.add(edge.source.id)
      changedTargets.add(edge.target.id)
      if (old?.target_symbol_id) changedTargets.add(old.target_symbol_id)
      stats.insertedOrUpdated++
    }
    // The canonical project pass owns PHP class override facts, including local
    // analyzer guesses. Rebuild their meaning after any hierarchy change instead
    // of retaining stale destinations or duplicate per-file/project edges.
    for (const row of existing) {
      if (desired.has(row.id)) continue
      withdraw.run(projectId, row.id)
      changedSources.add(row.source_symbol_id)
      if (row.target_symbol_id) changedTargets.add(row.target_symbol_id)
      stats.withdrawn++
    }
  })()
  stats.changedSourceIds = [...changedSources]
  stats.changedTargetIds = [...changedTargets]
  return stats
}
