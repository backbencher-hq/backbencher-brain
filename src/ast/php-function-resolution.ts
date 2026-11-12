/** Resolve PHP function syntax against function declarations, never same-named methods. */
export function reconcilePhpFunctionTargets(rawDb: any, projectId: string): {
  scanned: number; changed: number; changedSourceIds: string[]; changedTargetIds: string[]
} {
  const functions = new Map<string, Array<{ id: string; file: string }>>()
  for (const row of rawDb.prepare(`
    SELECT s.id, s.file_id, s.qualified_name, s.annotations
    FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id
    WHERE s.project_id = ? AND f.language = 'php' AND s.symbol_type = 'function'
  `).all(projectId)) {
    let identity = row.qualified_name
    try { identity = JSON.parse(row.annotations ?? "{}").fqn ?? identity } catch { /* use transported FQN */ }
    if (typeof identity !== "string" || !identity) continue
    const key = identity.replace(/^\\/, "").toLowerCase()
    const list = functions.get(key) ?? []
    list.push({ id: row.id, file: row.file_id })
    functions.set(key, list)
  }
  const rows = rawDb.prepare(`
    SELECT r.id, r.metadata, r.target_symbol_id, r.is_cross_file, r.is_cross_language,
      r.bridge_mechanism, r.source_symbol_id, sf.id AS source_file
    FROM brain_relationship r LEFT JOIN brain_symbol source ON source.id = r.source_symbol_id
    LEFT JOIN brain_file sf ON sf.id = COALESCE(source.file_id, ? || ':' || r.source_external)
    WHERE r.project_id = ? AND r.relationship_type IN ('calls','uses','imports')
      AND r.metadata LIKE '%"phpFunctionReference":true%'
  `).all(projectId, projectId)
  const sources = new Set<string>()
  const targets = new Set<string>()
  let scanned = 0
  let changed = 0
  const update = rawDb.prepare(`UPDATE brain_relationship SET target_symbol_id = ?, is_cross_file = ?,
    is_cross_language = 0, bridge_mechanism = NULL, time_updated = strftime('%s','now') * 1000 WHERE id = ?`)
  rawDb.transaction(() => {
    for (const row of rows) {
      let metadata: any
      try { metadata = JSON.parse(row.metadata) } catch { continue }
      if (metadata?.phpSpecific !== true || metadata.phpFunctionReference !== true || !Array.isArray(metadata.functionCandidates)) continue
      scanned++
      let target: { id: string; file: string } | undefined
      for (const identity of metadata.functionCandidates) {
        if (typeof identity !== 'string') continue
        const declarations = functions.get(identity)
        if (!declarations) continue
        // Ambiguous names cannot fall through to a lower-priority global declaration.
        if (declarations.length === 1) target = declarations[0]
        break
      }
      const targetId = target?.id ?? null
      const crossFile = target && row.source_file && target.file !== row.source_file ? 1 : 0
      if (row.target_symbol_id === targetId && row.is_cross_file === crossFile && row.is_cross_language === 0 && row.bridge_mechanism === null) continue
      update.run(targetId, crossFile, row.id)
      if (row.source_symbol_id) sources.add(row.source_symbol_id)
      if (row.target_symbol_id) targets.add(row.target_symbol_id)
      if (targetId) targets.add(targetId)
      changed++
    }
  })()
  return { scanned, changed, changedSourceIds: [...sources], changedTargetIds: [...targets] }
}
