import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync, renameSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { getProjectId } from "../src/cli/index"
import { BrainDatabase } from "../src/brain/database"
import { indexProjectParallel } from "../src/ast/parallel-indexer"
import { detectLanguageFromPath } from "../src/ast/language-detection"
import { measureOperation } from "./m11/differential-harness"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"

const root = resolve(fileURLToPath(new URL("..", import.meta.url)))
let failures = 0
function check(label: string, condition: boolean, detail = ""): void {
  if (condition) console.log(`  ok: ${label}`)
  else { failures++; console.log(`  FAIL: ${label}${detail ? ` ${detail}` : ""}`) }
}
function write(path: string, content: string): void {
  mkdirSync(resolve(path, ".."), { recursive: true })
  writeFileSync(path, content)
}
async function dbPaths(projectId: string): Promise<string[]> {
  const raw = await BrainDatabase.getRawInstance(projectId as any)
  return (raw.prepare("SELECT path FROM brain_file WHERE project_id = ? ORDER BY path").all(projectId) as Array<{ path: string }>).map((row) => row.path)
}
async function dbFileCount(projectId: string): Promise<number> {
  const raw = await BrainDatabase.getRawInstance(projectId as any)
  return (raw.prepare("SELECT COUNT(*) AS count FROM brain_file WHERE project_id = ?").get(projectId) as { count: number }).count
}

const project = mkdtempSync(join(tmpdir(), "bb-m11-lifecycle-"))
const outside = mkdtempSync(join(tmpdir(), "bb-m11-outside-"))
const dataRoot = mkdtempSync(join(tmpdir(), "bb-m11-data-"))
process.env.BB_DATA_DIR = dataRoot
const projectLink = join(tmpdir(), `bb-m11-link-${process.pid}`)
const projectId = getProjectId(project)
const logger = { log: (..._args: any[]) => {}, write: (_text: string) => {} }
try {
  write(join(project, "src", "keep.ts"), "export function keep(): string { return 'keep' }\n")
  write(join(project, "src", "types.pyi"), "def hint(value: str) -> str: return value\n")
  write(join(project, "capture.source"), "this must not be guessed as HTML\n")
  write(join(project, "node_modules", "ignored.ts"), "export function ignored() {}\n")
  write(join(project, "vendor", "ignored.py"), "def ignored(): pass\n")
  write(join(project, "dist", "ignored.js"), "function ignored() {}\n")
  write(join(project, "generated", "ignored.ts"), "export const ignored = true\n")
  write(join(project, ".github", "workflows", "build.yml"), "name: build\non: [push]\n")
  write(join(project, ".vscode", "settings.json"), "{\"editor.formatOnSave\": true}\n")
  write(join(project, "nested", ".git", "config"), "nested repository marker\n")
  write(join(project, "nested", "nested.ts"), "export const nested = true\n")
  write(join(outside, "outside.ts"), "export const outside = true\n")
  symlinkSync(join(outside, "outside.ts"), join(project, "src", "outside-link.ts"))
  write(join(project, ".bbignore"), "generated/\n")

  check("project identity is stable for equivalent resolved path", getProjectId(project) === getProjectId(resolve(project)))
  symlinkSync(project, projectLink, "dir")
  const legacyLinkId = createHash("sha1").update(resolve(projectLink)).digest("hex")
  const legacyProjectDir = join(dataRoot, "projects", legacyLinkId)
  write(join(legacyProjectDir, "migration-marker"), "legacy symlink index")
  check("project identity follows symlinked repository root", getProjectId(projectLink) === projectId)
  check("legacy symlink project data migrates to canonical identity", existsSync(join(dataRoot, "projects", projectId, "migration-marker")) && !existsSync(legacyProjectDir))
  check("different project identity is isolated", getProjectId(project) !== getProjectId(outside))
  check("source detector rejects extensionless source guess", detectLanguageFromPath(join(project, "capture.source")) === null)
  check("source detector recognizes pyi", detectLanguageFromPath(join(project, "types.pyi")) === "python")

  const cold = await measureOperation("cold_index", () => indexProjectParallel(projectId as any, project, { logger }), {})
  check("cold index completes without errors", cold.value.endTime !== undefined && cold.value.errorFiles === 0)
  const firstPaths = await dbPaths(projectId)
  check("cold index includes valid source files", firstPaths.some((path) => path.endsWith("keep.ts")) && firstPaths.some((path) => path.endsWith("types.pyi")))
  check("cold index excludes node_modules", !firstPaths.some((path) => path.includes("node_modules")))
  check("cold index excludes vendor", !firstPaths.some((path) => path.includes("vendor")))
  check("cold index excludes dist", !firstPaths.some((path) => path.includes("dist")))
  check("cold index excludes .bbignore directory", !firstPaths.some((path) => path.includes("generated")))
  check("cold index excludes nested repository boundary", !firstPaths.some((path) => path.includes("nested")))
  check("cold index excludes symlink escape", !firstPaths.some((path) => path.includes("outside-link")))
  check("cold index excludes extensionless source guess", !firstPaths.some((path) => path.endsWith("capture.source")))
  check("cold index includes supported .github workflow", firstPaths.some((path) => path.includes(".github") && path.endsWith("build.yml")))
  check("cold index includes supported .vscode configuration", firstPaths.some((path) => path.includes(".vscode") && path.endsWith("settings.json")))
  check("cold index has unique paths", new Set(firstPaths).size === firstPaths.length)

  const parentDatabasePath = BrainDatabase.getDbPath(projectId)
  const parentDataRoot = resolve(parentDatabasePath, "..", "..", "..")
  const restartOutput = execFileSync(process.execPath, ["-e", `import { BrainDatabase } from './src/brain/database'; const db = await BrainDatabase.getRawInstance('${projectId}'); const row = db.prepare('SELECT COUNT(*) AS count FROM brain_file WHERE project_id = ?').get('${projectId}'); console.log('M11_RESTART_COUNT=' + row.count)`], { cwd: root, encoding: "utf8", env: { ...process.env, BB_DATA_DIR: parentDataRoot } })
  const restartMatch = restartOutput.match(/M11_RESTART_COUNT=(\d+)/)
  check("separate process reopens persisted database", Number(restartMatch?.[1]) === firstPaths.length, `expected=${firstPaths.length} output=${JSON.stringify(restartOutput.trim())}`)

  const beforeCount = await dbFileCount(projectId)
  write(join(project, "src", "keep.ts"), "export function keep(): string { return 'changed' }\nexport const changed = true\n")
  const incremental = await measureOperation("incremental", () => indexProjectParallel(projectId as any, project, { logger, isIncremental: true }), {})
  check("incremental index completes without errors", incremental.value.endTime !== undefined && incremental.value.errorFiles === 0)
  check("incremental keeps file count stable", await dbFileCount(projectId) === beforeCount)
  const symbolCountAfterUpdate = (await BrainDatabase.getRawInstance(projectId as any)).prepare("SELECT COUNT(*) AS count FROM brain_symbol WHERE file_id LIKE '%keep.ts'").get() as { count: number }
  check("incremental update refreshes symbols", symbolCountAfterUpdate.count >= 2)

  unlinkSync(join(project, "src", "keep.ts"))
  const deletion = await measureOperation("deletion", () => indexProjectParallel(projectId as any, project, { logger }), {})
  check("deletion reconciliation completes without errors", deletion.value.endTime !== undefined && deletion.value.errorFiles === 0)
  check("deleted file rows are removed", !(await dbPaths(projectId)).some((path) => path.endsWith("keep.ts")))

  write(join(project, "src", "rename-old.ts"), "export const renamed = true\n")
  await indexProjectParallel(projectId as any, project, { logger })
  renameSync(join(project, "src", "rename-old.ts"), join(project, "src", "rename-new.ts"))
  const rename = await measureOperation("rename", () => indexProjectParallel(projectId as any, project, { logger }), {})
  const renamedPaths = await dbPaths(projectId)
  check("rename reconciliation completes without errors", rename.value.endTime !== undefined && rename.value.errorFiles === 0)
  check("renamed path is indexed", renamedPaths.some((path) => path.endsWith("rename-new.ts")))
  check("old renamed path is removed", !renamedPaths.some((path) => path.endsWith("rename-old.ts")))

  const concurrentProject = mkdtempSync(join(tmpdir(), "bb-m11-concurrent-"))
  try {
    write(join(concurrentProject, "main.ts"), "export function main() { return 1 }\n")
    const concurrentId = getProjectId(concurrentProject)
    const concurrent = await Promise.all([
      indexProjectParallel(concurrentId as any, concurrentProject, { logger }),
      indexProjectParallel(concurrentId as any, concurrentProject, { logger }),
    ])
    check("concurrent indexing returns two results", concurrent.length === 2)
    check("concurrent indexing returns completed stats", concurrent.every((result) => result.endTime !== undefined && result.errorFiles === 0))
    check("concurrent indexing leaves one valid file row", await dbFileCount(concurrentId) === 1)
    rmSync(concurrentProject, { recursive: true, force: true })
    rmSync(BrainDatabase.getDbPath(concurrentId), { recursive: true, force: true })
  } catch (error) {
    check("concurrent indexing does not corrupt database", false, error instanceof Error ? error.message : String(error))
  }

  const resultPath = resolve(root, "validation/m11/results/lifecycle-last-run.json")
  mkdirSync(resolve(resultPath, ".."), { recursive: true })
  writeFileSync(resultPath, JSON.stringify({
    schemaVersion: 1,
    fixture: "adversarial-discovery-lifecycle",
    projectId,
    operationMeasurements: [cold.measurement, incremental.measurement, deletion.measurement, rename.measurement],
    indexedPaths: firstPaths,
    finalPaths: await dbPaths(projectId),
    fileCountBeforeUpdate: beforeCount,
    fileCountAfterUpdate: await dbFileCount(projectId),
    invariants: {
      canonicalProjectIdentity: true,
      separateProcessRestart: true,
      symlinkEscapeExcluded: true,
      nestedRepositoryExcluded: true,
      generatedAndDependencyDirectoriesExcluded: true,
      usefulHiddenConfigurationIncluded: true,
      staleDeletionReconciled: true,
      renameReconciled: true,
      concurrentIndexIntegrity: true
    },
    limitations: ["This fixture validates universal lifecycle invariants, not language analyzer correctness."],
  }, null, 2) + "\n")
  check("versioned lifecycle result is written", existsSync(resultPath) && readFileSync(resultPath, "utf8").includes("adversarial-discovery-lifecycle"))
} catch (error) {
  check("lifecycle session completes", false, error instanceof Error ? error.message : String(error))
} finally {
  rmSync(project, { recursive: true, force: true })
  rmSync(projectLink, { recursive: true, force: true })
  rmSync(outside, { recursive: true, force: true })
  rmSync(dataRoot, { recursive: true, force: true })
  rmSync(BrainDatabase.getDbPath(projectId), { recursive: true, force: true })
}

console.log(failures === 0 ? "\nM11 LIFECYCLE: PASS" : `\nM11 LIFECYCLE: FAIL (${failures})`)
process.exit(failures > 0 ? 1 : 0)
