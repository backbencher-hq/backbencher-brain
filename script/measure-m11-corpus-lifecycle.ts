import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { getProjectId } from "../src/cli/index"
import { BrainDatabase } from "../src/brain/database"
import { indexProjectParallel } from "../src/ast/parallel-indexer"
import { measureOperation } from "./m11/differential-harness"

const root = resolve(fileURLToPath(new URL("..", import.meta.url)))
const manifest = JSON.parse(readFileSync(resolve(root, "validation/m11/corpus-manifest.json"), "utf8")) as any
const repository = manifest.repositories.find((item: any) => item.id === "rake")
if (!repository?.evidenceEligible) throw new Error("rake corpus entry must be clean and evidence eligible")
const projectId = getProjectId(repository.path)
const logger = { log: (..._args: any[]) => {}, write: (_text: string) => {} }

const cold = await measureOperation("cold_index", () => indexProjectParallel(projectId as any, repository.path, { logger }), {
  files: repository.trackedFiles,
  databasePath: BrainDatabase.getDbPath(projectId),
})
const raw = await BrainDatabase.getRawInstance(projectId as any)
const indexedFiles = (raw.prepare("SELECT COUNT(*) AS count FROM brain_file WHERE project_id = ?").get(projectId) as { count: number }).count
const symbols = (raw.prepare("SELECT COUNT(*) AS count FROM brain_symbol WHERE project_id = ?").get(projectId) as { count: number }).count
const relationships = (raw.prepare("SELECT COUNT(*) AS count FROM brain_relationship WHERE project_id = ?").get(projectId) as { count: number }).count
const coldSeconds = cold.measurement.wallTimeMs / 1000
cold.measurement.files = cold.value.processedFiles
cold.measurement.symbols = symbols
cold.measurement.relationships = relationships
cold.measurement.filesPerSecond = coldSeconds > 0 ? cold.value.processedFiles / coldSeconds : null
cold.measurement.symbolsPerSecond = coldSeconds > 0 ? symbols / coldSeconds : null
cold.measurement.relationshipsPerSecond = coldSeconds > 0 ? relationships / coldSeconds : null

const warm = await measureOperation("warm_index", () => indexProjectParallel(projectId as any, repository.path, { logger }), {
  files: indexedFiles,
  symbols,
  relationships,
  databasePath: BrainDatabase.getDbPath(projectId),
})

const output = {
  schemaVersion: 1,
  repository: repository.id,
  revision: repository.revision,
  path: repository.path,
  evidenceEligible: repository.evidenceEligible,
  trackedFiles: repository.trackedFiles,
  indexedFiles,
  symbols,
  relationships,
  cold: cold.measurement,
  warm: warm.measurement,
  coldStats: cold.value,
  warmStats: warm.value,
  limitations: [
    "Rake is a small real-repository scale probe; it is not representative of large-corpus throughput.",
    "Language extraction precision is evaluated in later language-specific issues.",
  ],
}
const outputPath = resolve(root, "validation/m11/results/rake-lifecycle-baseline.json")
mkdirSync(dirname(outputPath), { recursive: true })
writeFileSync(outputPath, JSON.stringify(output, null, 2) + "\n")
console.log(JSON.stringify({ repository: repository.id, indexedFiles, symbols, relationships, coldMs: cold.measurement.wallTimeMs, warmMs: warm.measurement.wallTimeMs }, null, 2))

rmSync(dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true })
