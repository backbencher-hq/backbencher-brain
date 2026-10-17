// script/m71/probe-format-real-formatter.ts — REVIEW PROBE for bb_edit (not a gate).
//
// The E7 gate verifies every formatter branch with a FAKE local node_modules/.bin/prettier,
// which is deterministic but does not prove the engine can drive a REAL formatter. This probe
// runs the measured path against a genuine prettier installed in a throwaway directory:
// the reviewed project's `node_modules` is a symlink to it, so the engine's resolver
// (`nearest node_modules/.bin walking up from the file`) finds the real binary and argv is
// handed to it unchanged.
//
// Run: npx tsx script/m71/probe-format-real-formatter.ts /path/to/dir/with/node_modules

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../src/cli/index"
import { BrainDatabase } from "../../src/brain/database"
import { executeEdit } from "../../src/intelligence/edit/edit-engine"

const realModules = process.argv[2]
if (!realModules || !existsSync(path.join(realModules, "node_modules", ".bin", "prettier"))) {
  console.log(`SKIP: no real prettier at ${realModules ?? "<no argument>"}/node_modules/.bin/prettier`)
  process.exit(0)
}

const root = mkdtempSync(path.join(tmpdir(), "bb-probe-real-format-"))
const projectId = getProjectId(root)
try {
  symlinkSync(path.join(realModules, "node_modules"), path.join(root, "node_modules"))
  // Deliberately unformatted: plenty of spaces, no semicolon. A real prettier must rewrite it.
  writeFileSync(path.join(root, "a.ts"), "const   x=1\nexport { x }\n")
  const result = await executeEdit(root, projectId, { mode: "write", filePath: "a.ts", content: "const   answer=42\nexport { answer }\n" })
  console.log(`formatted field  = ${result.formatted}`)
  console.log(`formatting entry = ${JSON.stringify(result.formatting)}`)
  console.log(`warnings         = ${JSON.stringify(result.warnings ?? [])}`)
  console.log(`file on disk     = ${JSON.stringify(readFileSync(path.join(root, "a.ts"), "utf8"))}`)
  console.log("(a real prettier rewrote the splice: `const   answer=42` must come back normalised)")
} finally {
  rmSync(root, { recursive: true, force: true })
  rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true })
}
