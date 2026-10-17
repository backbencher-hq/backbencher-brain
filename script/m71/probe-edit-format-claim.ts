// script/m71/probe-edit-format-claim.ts — REVIEW PROBE for bb_edit (not a gate).
//
// `executeEdit` returns `formatted: request.format !== false`. tryAutoFormat
// silently resolves when no formatter is mapped for the extension, or when the
// formatter binary is missing/fails/times out (the exec callback ignores the
// error and the exit status). So `formatted: true` may be a claim about the
// REQUEST rather than about the file. Measured here on a .rb file, for which
// tryAutoFormat has no mapping at all — no formatter can possibly have run.
//
// Run: npx tsx script/m71/probe-edit-format-claim.ts

import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../src/cli/index"
import { BrainDatabase } from "../../src/brain/database"
import { executeEdit } from "../../src/intelligence/edit/edit-engine"

const root = mkdtempSync(path.join(tmpdir(), "bb-review-format-"))
const projectId = getProjectId(root)
try {
  writeFileSync(path.join(root, "a.rb"), "def   target\n    1\nend\n")
  const result = await executeEdit(root, projectId, { mode: "write", filePath: "a.rb", content: "def   target\n      2\nend\n" })
  console.log(`formatted field = ${result.formatted}`)
  console.log(`file on disk    = ${JSON.stringify(readFileSync(path.join(root, "a.rb"), "utf8"))}`)
  console.log("(.rb has no tryAutoFormat mapping — no formatter can have run; compare the two lines)")
} finally {
  rmSync(root, { recursive: true, force: true })
  rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true })
}
