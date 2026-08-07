import { BrainDatabase } from "../../brain/database"
import type { ProjectID } from "../../project/schema"
import type { ProjectStats } from "../contracts"

type AggregateRow = {
  files: number | null
  linesOfCode: number | null
  avgFileSize: number | null
  symbols: number | null
  avgComplexity: number | null
  relationships: number | null
}

export async function getProjectStats(projectId: ProjectID): Promise<ProjectStats> {
  const raw = await BrainDatabase.getRawInstance(projectId)
  const row = raw.prepare(`
    SELECT
      (SELECT COUNT(*) FROM brain_file WHERE project_id = ?) AS files,
      (SELECT COALESCE(SUM(line_count), 0) FROM brain_file WHERE project_id = ?) AS linesOfCode,
      (SELECT COALESCE(AVG(size_bytes), 0) FROM brain_file WHERE project_id = ?) AS avgFileSize,
      (SELECT COUNT(*) FROM brain_symbol WHERE project_id = ?) AS symbols,
      (SELECT COALESCE(AVG(complexity), 0) FROM brain_symbol WHERE project_id = ?) AS avgComplexity,
      (SELECT COUNT(*) FROM brain_relationship WHERE project_id = ?) AS relationships
  `).get(projectId, projectId, projectId, projectId, projectId, projectId) as AggregateRow

  return {
    files: Number(row.files ?? 0),
    linesOfCode: Number(row.linesOfCode ?? 0),
    avgFileSize: Number(row.avgFileSize ?? 0),
    symbols: Number(row.symbols ?? 0),
    avgComplexity: Number(row.avgComplexity ?? 0),
    relationships: Number(row.relationships ?? 0),
    projectId,
  }
}
