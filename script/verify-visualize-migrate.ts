import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../src/cli/index"
import { indexProjectParallel } from "../src/ast/parallel-indexer"
import { BrainDatabase } from "../src/brain/database"
import { visualizeProject, formatVisualization } from "../src/intelligence/visualization/visualization-engine"
import { generateMigrationPlans, formatMigrationPlans } from "../src/intelligence/migration/migration-engine"

let failures = 0
function check(label: string, condition: boolean, detail = ""): void { if (condition) console.log(`  ok: ${label}`); else { failures++; console.log(`  FAIL: ${label}${detail ? ` ${detail}` : ""}`) } }

const root = mkdtempSync(path.join(tmpdir(), "bb-visualize-migrate-"))
mkdirSync(path.join(root, "src", "api"), { recursive: true })
writeFileSync(path.join(root, "src", "api", "service.ts"), `export function first(): string { return second() }\nexport function second(): string { return "ok" }\n`)
writeFileSync(path.join(root, "src", "main.ts"), `import { first } from "./api/service"\nexport function main(): string { return first() }\n`)
const projectId = getProjectId(root)
try {
  await indexProjectParallel(projectId, root, {})
  const project = await visualizeProject(projectId, { scope: "project", maxNodes: 1, maxLinks: 1, format: "json" })
  check("visualization reports explicit truncation", project.truncation.truncated)
  check("visualization provenance uses canonical engine", project.provenance.source === "canonical-graph-engine")
  check("visualization has no dangling links", project.links.every((link) => project.nodes.some((node) => node.id === link.source) && project.nodes.some((node) => node.id === link.target)))
  const moduleGraph = await visualizeProject(projectId, { scope: "module", target: "src/api", maxNodes: 20, format: "json" })
  check("module scope filters files", moduleGraph.nodes.every((node) => node.filePath.includes("src/api")))
  const json = JSON.parse(formatVisualization(moduleGraph))
  const html = formatVisualization({ ...moduleGraph, format: "html" })
  check("JSON graph counts are internally consistent", json.nodes.length === moduleGraph.nodes.length && json.links.length === moduleGraph.links.length)
  check("HTML graph embeds same counts", html.includes(JSON.stringify(moduleGraph.nodes)) && html.includes(JSON.stringify(moduleGraph.links)))

  const raw = await BrainDatabase.getRawInstance(projectId)
  const first = raw.prepare("SELECT name FROM brain_symbol WHERE project_id=? AND name='first' LIMIT 1").get(projectId) as any
  const second = raw.prepare("SELECT name FROM brain_symbol WHERE project_id=? AND name='second' LIMIT 1").get(projectId) as any
  const migrations = await generateMigrationPlans(projectId, { symbolNames: [first?.name ?? "first", second?.name ?? "second", "missingSymbol"], targetLanguage: "rust" })
  check("migration returns supported plans", migrations.plans.length >= 1)
  check("migration preserves requested unsupported symbols", migrations.unsupported.some((item) => item.symbolName === "missingSymbol"))
  check("migration exposes dependency order", migrations.dependencyOrder.length >= 1)
  check("migration exposes methodology", migrations.methodology.baseHours >= migrations.plans.length * 4)
  check("migration JSON is structured", formatMigrationPlans(migrations, "json").includes('"unsupported"'))
  check("migration text exposes truncation", formatMigrationPlans(migrations).includes("truncated:"))
} catch (error) { check("visualize/migrate fixture", false, error instanceof Error ? error.stack ?? error.message : String(error)) }
finally { rmSync(root, { recursive: true, force: true }); rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true }) }
console.log(failures === 0 ? "\nVISUALIZE/MIGRATE: PASS" : `\nVISUALIZE/MIGRATE: ${failures} FAILURES`)
process.exit(failures > 0 ? 1 : 0)
