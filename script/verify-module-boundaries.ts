import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../src/cli/index"
import { indexProjectParallel } from "../src/ast/parallel-indexer"
import { searchSymbols } from "../src/intelligence/search/symbol-search"
import { getProjectStats } from "../src/intelligence/analysis/project-stats"
import { createContractFixture } from "./fixtures/contract-fixture"

let failures = 0
function check(label: string, condition: boolean, detail = ""): void {
  if (condition) console.log(`  ok: ${label}`)
  else {
    failures++
    console.log(`  FAIL: ${label}${detail ? ` ${detail}` : ""}`)
  }
}

const root = mkdtempSync(path.join(tmpdir(), "bb-module-boundary-"))
const projectId = getProjectId(root)
try {
  createContractFixture(root)
  await indexProjectParallel(projectId, root, {})
  const results = await searchSymbols(projectId, "handleRequest", { maxResults: 5 })
  const stats = await getProjectStats(projectId)
  check("strict search module returns indexed symbol", results.some((result) => result.symbolName === "handleRequest"))
  check("strict search module returns freshness metadata", results.freshCount !== undefined && results.staleCount !== undefined)
  check("strict stats module returns project identity", stats.projectId === projectId)
  check("strict stats module returns positive indexed counts", stats.files > 0 && stats.symbols > 0)
  check("strict stats module returns numeric aggregates", Object.entries(stats).filter(([k]) => k !== "provenance").every(([, value]) => typeof value === "number" || typeof value === "string"))
} catch (error) {
  check("strict module boundary session", false, error instanceof Error ? error.message : String(error))
} finally {
  rmSync(root, { recursive: true, force: true })
  rmSync(path.dirname((await import("../src/brain/database")).BrainDatabase.getDbPath(projectId)), { recursive: true, force: true })
}

console.log(failures === 0 ? "\nMODULE BOUNDARIES: PASS" : `\nMODULE BOUNDARIES: ${failures} FAILURES`)
process.exit(failures > 0 ? 1 : 0)
