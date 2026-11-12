/** Bind written PHP class types by canonical namespace identity after name resolution. */
export interface PhpTypeResolutionResult {
  scanned: number
  changed: number
  changedSourceIds: string[]
  changedTargetIds: string[]
}

export function reconcilePhpTypeTargets(rawDb: any, projectId: string): PhpTypeResolutionResult {
  const types = new Map<string, Array<{ id: string; file: string; kind: string }>>()
  for (const row of rawDb.prepare(`
    SELECT s.id, s.file_id, s.symbol_type, s.annotations
    FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id
    WHERE s.project_id = ? AND f.language = 'php' AND s.symbol_type IN ('class','interface','trait','enum')
  `).all(projectId)) {
    let name: unknown
    try { name = JSON.parse(row.annotations ?? "{}").fqn } catch { continue }
    if (typeof name !== "string" || !name) continue
    const key = name.replace(/^\\/, "").toLowerCase()
    const list = types.get(key) ?? []
    list.push({ id: row.id, file: row.file_id, kind: row.symbol_type })
    types.set(key, list)
  }
  const sources = new Set<string>()
  const targets = new Set<string>()
  const stats: PhpTypeResolutionResult = { scanned: 0, changed: 0, changedSourceIds: [], changedTargetIds: [] }
  const rows = rawDb.prepare(`
    SELECT r.id, r.metadata, r.relationship_type, r.target_symbol_id, r.is_cross_file,
      r.is_cross_language, r.bridge_mechanism,
      r.source_symbol_id, source.symbol_type AS source_kind, sf.id AS source_file
    FROM brain_relationship r LEFT JOIN brain_symbol source ON source.id = r.source_symbol_id
    LEFT JOIN brain_file sf ON sf.id = COALESCE(source.file_id, ? || ':' || r.source_external)
    WHERE r.project_id = ? AND r.metadata IS NOT NULL
      AND r.relationship_type IN ('extends','implements','mixes_in','instantiates','references','imports')
      AND r.metadata LIKE '%"phpTypeReference":true%'
  `).all(projectId, projectId)
  const update = rawDb.prepare(`
    UPDATE brain_relationship SET target_symbol_id = ?, is_cross_file = ?, is_cross_language = 0,
      bridge_mechanism = NULL, time_updated = strftime('%s','now') * 1000 WHERE id = ?
  `)
  rawDb.transaction(() => {
    for (const row of rows) {
      let metadata: Record<string, unknown>
      try { metadata = JSON.parse(row.metadata) } catch { continue }
      if (!metadata || metadata.phpSpecific !== true || metadata.phpTypeReference !== true) continue
      stats.scanned++
      const identity = typeof metadata.targetIdentity === "string" ? metadata.targetIdentity : ""
      const declarations = types.get(identity)
      const candidate = metadata.lateStaticBinding !== true && declarations?.length === 1 ? declarations[0] : undefined
      const validKind = candidate && (
        row.relationship_type === 'instantiates' ? candidate.kind === 'class'
          : row.relationship_type === 'implements' ? candidate.kind === 'interface'
          : row.relationship_type === 'mixes_in' ? candidate.kind === 'trait'
          : row.relationship_type === 'extends' ? candidate.kind === row.source_kind
          : true
      )
      const selfHeritage = (row.relationship_type === 'extends' || row.relationship_type === 'implements') && candidate?.id === row.source_symbol_id
      const target = validKind && !selfHeritage ? candidate : undefined
      const targetId = target?.id ?? null
      const crossFile = target && row.source_file && target.file !== row.source_file ? 1 : 0
      if (row.target_symbol_id === targetId && row.is_cross_file === crossFile && row.is_cross_language === 0 && row.bridge_mechanism === null) continue
      update.run(targetId, crossFile, row.id)
      if (row.source_symbol_id) sources.add(row.source_symbol_id)
      if (row.target_symbol_id) targets.add(row.target_symbol_id)
      if (targetId) targets.add(targetId)
      stats.changed++
    }
  })()
  stats.changedSourceIds = [...sources]
  stats.changedTargetIds = [...targets]
  return stats
}
