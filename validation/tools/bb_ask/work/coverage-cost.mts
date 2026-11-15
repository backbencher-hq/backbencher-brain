// Author: Muhammad Ishaq Khan
// Measures the two coverage predicates content-search can use on a giant corpus: the
// current one (length(source_text) > 0, which must read the body payload) and a cheap
// serial-type predicate (IS NOT NULL, resolved from the row header). The difference is
// the cold-cache tail the lexical fallback pays on every answer.
import { getProjectId } from "../../../../src/util/project-id"
import { BrainDatabase } from "../../../../src/brain/database"
const pid = getProjectId("/home/ishaq2321/mcp/backbencher-brain")
const raw = await BrainDatabase.getRawInstance(pid, { readonly: true })
const base = "SELECT COUNT(*) AS symbols, SUM(CASE WHEN source_text IS NOT NULL"
for (const [label, predicate] of [["length>0", " AND length(source_text) > 0"], ["is-not-null", ""]] as const) {
  const t0 = performance.now()
  const row = raw.prepare(base + predicate + " THEN 1 ELSE 0 END) AS withBody FROM brain_symbol WHERE project_id = ? AND COALESCE(line_start,0) > 0 AND name NOT LIKE '/%/%'").get(pid) as any
  console.log(label, Math.round((performance.now()-t0)*10)/10 + "ms", JSON.stringify(row))
}
