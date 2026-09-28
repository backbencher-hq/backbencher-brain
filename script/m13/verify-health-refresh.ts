// script/m13/verify-health-refresh.ts — M13.32 (H4).
//
// Refresh/force must never report success on failure:
//   1. an injected refresh failure (project DB directory deleted) surfaces as
//      REFRESH_FAILED with completed=false — never as a passing report,
//   2. force=true verifiably reindexes BEFORE reporting (a file created after
//      the initial index is present in the force-refreshed report),
//   3. wait=false returns the pre-refresh snapshot marked started (pending) —
//      never presented as complete.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { getUnifiedHealth, formatUnifiedHealth } from "../../src/intelligence/health/health-provider"
import { Harness } from "./harness"

const harness = new Harness({
  issue: "M13.32",
  code: "H4",
  tool: "bb_health",
  title: "bb_health: refresh/force failure injection",
  layers: ["unit", "integration"],
  decisions: {
    failureInjection: "deleting the project DB directory makes the refresh worker fail deterministically — REFRESH_FAILED + completed=false must surface, never a passing report",
    force: "force=true wipes and fully reindexes BEFORE reporting; a file created after the initial index must appear in the force-refreshed counts",
    waitFalse: "wait=false returns the pre-refresh snapshot marked started (pending); the formatter must never label it completed (or misleadingly failed)",
  },
  limitations: [
    "Failure injection relies on the filesystem (deleting the DB dir); it is deterministic in this harness.",
  ],
})

const root = mkdtempSync(path.join(tmpdir(), "bb-health-refresh-"))
const projectId = getProjectId(root)
mkdirSync(path.join(root, "src"), { recursive: true })
writeFileSync(path.join(root, "src", "a.ts"), "export function alpha(): number { return 1 }\n")
await indexProjectParallel(projectId, root, {})

// ── 1. force=true verifiably reindexes before reporting ───────────────────
{
  const before = await getUnifiedHealth(projectId, root, {})
  const filesBefore = before.counts.files
  // Create a new file + symbol AFTER the initial index.
  writeFileSync(path.join(root, "src", "c.ts"), "export function charlie(): number { return 3 }\n")
  const snapshot = await getUnifiedHealth(projectId, root, {})
  harness.check("force: pre-force snapshot does NOT include the new file (honest)", snapshot.counts.files === filesBefore, `snapshot=${snapshot.counts.files} before=${filesBefore}`)
  const forced = await getUnifiedHealth(projectId, root, { force: true, wait: true })
  harness.check("force: reindex completed", forced.refresh.completed === true && forced.refresh.force === true, `completed=${forced.refresh.completed}`)
  harness.check("force: new file is indexed before reporting", forced.counts.files === filesBefore + 1, `forced=${forced.counts.files} expected=${filesBefore + 1}`)
}

// ── 2. wait=false never presents an incomplete refresh as complete ────────
{
  const report = await getUnifiedHealth(projectId, root, { refresh: true, wait: false })
  harness.check("wait=false: snapshot is returned immediately (completed=false)", report.refresh.completed === false && report.refresh.wait === false, `completed=${report.refresh.completed}`)
  harness.check("wait=false: REFRESH_STARTED warning is present", report.warnings.some((w) => w.code === "REFRESH_STARTED"), JSON.stringify(report.warnings.map((w) => w.code)))
  const out = formatUnifiedHealth(report)
  harness.negative("wait=false: formatted report never claims completed", !out.includes("refresh: completed"), out.slice(0, 140))
  harness.negative("wait=false: formatted report does not mislabel it failed", !out.includes("refresh: failed"), out.slice(0, 140))
  harness.check("wait=false: formatted report labels it started (pending)", out.includes("started (pending)"), out.slice(0, 140))
}

// ── 3. Injected refresh failure surfaces as an error, not a passing report ─
// (own fixture, run LAST: deleting the DB dir leaves the process's cached DB
// handle unusable, so this must not share a project with the other cases)
{
  const failRoot = mkdtempSync(path.join(tmpdir(), "bb-health-refresh-fail-"))
  const failProjectId = getProjectId(failRoot)
  mkdirSync(path.join(failRoot, "src"), { recursive: true })
  writeFileSync(path.join(failRoot, "src", "a.ts"), "export function alpha(): number { return 1 }\n")
  await indexProjectParallel(failProjectId, failRoot, {})
  const dbDir = path.dirname(BrainDatabase.getDbPath(failProjectId))
  rmSync(dbDir, { recursive: true, force: true })
  const report = await getUnifiedHealth(failProjectId, failRoot, { refresh: true, wait: true })
  const failed = report.warnings.find((w) => w.code === "REFRESH_FAILED")
  harness.negative("failure: injected refresh failure surfaces as REFRESH_FAILED", !!failed && failed.severity === "error", failed?.message?.slice(0, 120) ?? "no warning")
  harness.negative("failure: refresh is NOT reported complete", report.refresh.completed === false, `completed=${report.refresh.completed}`)
  const out = formatUnifiedHealth(report)
  harness.negative("failure: formatted report never claims completed", !out.includes("refresh: completed"), out.slice(0, 140))
  harness.check("failure: formatted report labels the refresh failed", out.includes("refresh: failed"), out.slice(0, 140))
  rmSync(failRoot, { recursive: true, force: true })
}

rmSync(root, { recursive: true, force: true })
harness.emit()
