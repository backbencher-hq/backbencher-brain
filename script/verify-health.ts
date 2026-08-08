import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../src/cli/index"
import { indexProjectParallel } from "../src/ast/parallel-indexer"
import { BrainDatabase } from "../src/brain/database"
import { formatUnifiedHealth, getUnifiedHealth } from "../src/intelligence/health/health-provider"

let failures = 0
function check(label: string, condition: boolean, detail = ""): void {
  if (condition) console.log(`  ok: ${label}`)
  else { failures++; console.log(`  FAIL: ${label}${detail ? ` ${detail}` : ""}`) }
}

const root = mkdtempSync(path.join(tmpdir(), "bb-health-"))
mkdirSync(path.join(root, "src"), { recursive: true })
writeFileSync(path.join(root, "src", "one.ts"), "export function one(): number { return 1 }\n")
writeFileSync(path.join(root, "src", "two.ts"), "export function two(): number { return one() }\n")
const projectId = getProjectId(root)

try {
  await indexProjectParallel(projectId, root, {})
  const sampled = await getUnifiedHealth(projectId, root, { freshness: "sampled", sampleSize: 1 })
  const complete = await getUnifiedHealth(projectId, root, { freshness: "complete" })
  check("sampled health reports sampled mode", sampled.freshness.mode === "sampled")
  check("sample size is bounded", sampled.freshness.checked <= 1, JSON.stringify(sampled.freshness))
  check("complete health reports complete mode", complete.freshness.mode === "complete")
  check("complete health checks indexed files", complete.freshness.checked === complete.freshness.total)
  check("unified report includes imports and syntax errors", typeof complete.counts.imports === "number" && typeof complete.counts.syntaxErrors === "number")
  check("formatted report includes core sections", /files=\d+ symbols=\d+ relationships=\d+ imports=\d+/.test(formatUnifiedHealth(complete)) && formatUnifiedHealth(complete).includes("freshness:"))

  const refreshed = await getUnifiedHealth(projectId, root, { refresh: true, wait: true })
  check("refresh is observable", refreshed.refresh.requested && refreshed.refresh.completed, JSON.stringify(refreshed.refresh))
  check("refresh reports processed files", (refreshed.refresh.processedFiles ?? 0) > 0, JSON.stringify(refreshed.refresh))
  check("refresh preserves project counts", refreshed.counts.files === complete.counts.files)
} catch (error) {
  check("health fixture", false, error instanceof Error ? error.stack ?? error.message : String(error))
} finally {
  rmSync(root, { recursive: true, force: true })
  rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true })
}

console.log(failures === 0 ? "\nHEALTH VERIFICATION: PASS" : `\nHEALTH VERIFICATION: ${failures} FAILURES`)
process.exit(failures > 0 ? 1 : 0)
