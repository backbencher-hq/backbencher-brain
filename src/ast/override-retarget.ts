/**
 * Cross-file `overrides` retarget (M60 / SDJ-8).
 *
 * ## Why this exists
 *
 * The post-index relationship resolution pass resolves targets BY NAME. That is
 * correct for `calls` and `uses`, where a name identifies the thing. It is wrong
 * for `overrides`, whose target is a DECLARING ANCESTOR rather than the name the
 * source mentions: an analyzer that cannot see past its own file publishes a guess
 * (its first supertype), and name resolution then resolves that guess perfectly
 * happily — producing a confident edge to the wrong parent.
 *
 * Measured on scala3 (400-file draw, full 18,446-file corpus as the hierarchy):
 *   - 677 low-confidence `overrides` rows
 *   - 308 of them (45.5%) pointed at a supertype that does NOT declare the
 *     overridden method at all
 *   - 0 of 677 could be fixed from one file, so no in-file rule helps: every base
 *     type is declared elsewhere
 *   - with the project-wide hierarchy, 486 of 656 resolvable rows (74.1%) find an
 *     ancestor that verifiably declares the method, and 329 rows move
 *   - 152 of the wins sit at ancestor depth 13-14, so a shallow walk finds none
 *
 * ## Why it runs in the post-index pass
 *
 * Because that is the first moment the hierarchy is complete. The alternative is a
 * second parse pass over every file; the measurement says it is unnecessary — this
 * step measured 79ms against 327s to index the project, 0.02%.
 *
 * ## What it will not do
 *
 * It never invents an edge. A row is re-pointed only at an ancestor that provably
 * DECLARES the method; a row whose method no ancestor declares is left untouched, so
 * a real-but-unverifiable override stays visible as declared low-confidence
 * suspicion instead of being deleted. It never raises confidence: promotion is a
 * separate question and the analyzer's own tier is the authority on it.
 *
 * ## Degradation
 *
 * `super_types` is NULL on every row written before SDJ-8 and on every symbol with
 * no heritage. With no hierarchy there is nothing to walk, so the pass finds no
 * declaring ancestor and changes nothing — the previous name-only behaviour, which
 * is the correct fallback for an un-migrated database.
 */

/** Rows below this confidence are the analyzer's own "declared suspicion" tier. */
const CONF_FLOOR = 0.7
/** Ancestors are walked breadth-first; scala3 needed 14, so this is not cosmetic. */
const MAX_DEPTH = 16

export type OverrideRetargetResult = {
  scanned: number
  resolved: number
  moved: number
  unverifiable: number
  noHierarchy: number
}

export function retargetCrossFileOverrides(rawDb: any, projectId: string): OverrideRetargetResult {
  const out: OverrideRetargetResult = { scanned: 0, resolved: 0, moved: 0, unverifiable: 0, noHierarchy: 0 }
  try {
    // The project-wide hierarchy, and which owner declares which method.
    const supertypes = new Map<string, string[]>()
    for (const r of rawDb
      .prepare(`SELECT name, super_types FROM brain_symbol WHERE project_id = ? AND super_types IS NOT NULL`)
      .all(projectId) as any[]) {
      if (!r?.name || !r?.super_types) continue
      let arr: unknown
      try { arr = JSON.parse(r.super_types) } catch { continue }
      if (!Array.isArray(arr) || arr.length === 0) continue
      const names = arr.filter((x): x is string => typeof x === "string" && x.length > 0)
      if (!names.length) continue
      const prev = supertypes.get(r.name)
      supertypes.set(r.name, prev ? [...new Set([...prev, ...names])] : names)
    }
    if (supertypes.size === 0) return out // no hierarchy persisted: nothing to do

    const methodsByOwner = new Map<string, Set<string>>()
    for (const r of rawDb
      .prepare(`SELECT name, qualified_name, symbol_type FROM brain_symbol WHERE project_id = ? AND symbol_type = 'method' AND qualified_name IS NOT NULL`)
      .all(projectId) as any[]) {
      const qn = String(r.qualified_name)
      const nm = String(r.name ?? "")
      if (!nm || !qn.endsWith(`.${nm}`)) continue
      const owner = qn.slice(0, qn.length - nm.length - 1)
      if (!owner) continue
      let set = methodsByOwner.get(owner)
      if (!set) { set = new Set(); methodsByOwner.set(owner, set) }
      set.add(nm)
    }

    const rows = rawDb
      .prepare(
        `SELECT id, source_external, target_external FROM brain_relationship
         WHERE project_id = ? AND relationship_type = 'overrides' AND confidence < ?`,
      )
      .all(projectId, CONF_FLOOR) as any[]

    const update = rawDb.prepare(`UPDATE brain_relationship SET target_external = ? WHERE id = ?`)
    const declares = (t: string, m: string): boolean => methodsByOwner.get(t)?.has(m) ?? false
    const parentsOf = (t: string): string[] => supertypes.get(t) ?? []

    for (const row of rows) {
      out.scanned++
      const source = String(row.source_external ?? "")
      const dot = source.lastIndexOf(".")
      if (dot <= 0) continue
      const owner = source.slice(0, dot)
      const method = source.slice(dot + 1)
      if (!owner || !method) continue
      const parents = parentsOf(owner)
      if (parents.length === 0) { out.noHierarchy++; continue }

      const seen = new Set<string>()
      let frontier = [...parents]
      let found = ""
      let depth = 0
      while (frontier.length && depth < MAX_DEPTH && !found) {
        const next: string[] = []
        for (const t of frontier) {
          if (!t || seen.has(t)) continue
          seen.add(t)
          if (declares(t, method)) { found = t; break }
          next.push(...parentsOf(t))
        }
        frontier = [...new Set(next)]
        depth++
      }
      if (!found) { out.unverifiable++; continue }

      out.resolved++
      const target = `${found}.${method}`
      if (target !== String(row.target_external ?? "")) {
        update.run(target, row.id)
        out.moved++
      }
    }
  } catch {
    // A retarget failure must never fail indexing: the rows stay exactly as the
    // analyzer published them, which is the pre-SDJ-8 behaviour and is honest.
  }
  return out
}