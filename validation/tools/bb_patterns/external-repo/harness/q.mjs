// bb_tests/bb_patterns/harness/q.mjs — direct SQL against a bb brain.db, with NO bb code in
// the path. Every corpus number in the bb_patterns review comes from here or
// from a direct engine call, never from a self-reporting engine statistic.
//
// The driver is better-sqlite3, which is what src/brain/database.ts resolves
// under Node. node:sqlite is deliberately NOT used: on Node 22 it is killed by
// the kernel the moment a database is opened (see harness/env.sh for the
// measured matrix), so a harness built on it fails with no output at all.
//
// usage: node q.mjs <projectId> "<sql>" [more sql ...]

import path from "node:path"
import { createRequire } from "node:module"

// better-sqlite3 is resolved out of the REPO's node_modules, not the harness's:
// the harness lives outside the project, so plain "better-sqlite3" resolves
// against bb_tests/ and throws ERR_MODULE_NOT_FOUND regardless of cwd.
const REPO = process.env.BB_REPO
if (!REPO) {
  console.error("q.mjs: set BB_REPO (source harness/env.sh)")
  process.exit(2)
}
const repoRequire = createRequire(path.join(REPO, "package.json"))
const Database = repoRequire("better-sqlite3")

const DATA = process.env.BB_DATA_DIR
if (!DATA) {
  console.error("q.mjs: set BB_DATA_DIR (source harness/env.sh)")
  process.exit(2)
}
const [projectId, ...sqls] = process.argv.slice(2)
if (!projectId || sqls.length === 0) {
  console.error("q.mjs: usage: q.mjs <projectId> <sql> [sql ...]")
  process.exit(2)
}
const db = new Database(path.join(DATA, "projects", projectId, "brain.db"), { readonly: true, fileMustExist: true })
for (const sql of sqls) {
  let rows
  try {
    rows = db.prepare(sql).all()
  } catch (error) {
    rows = [{ SQL_ERROR: String(error && error.message) }]
  }
  console.log(`\n### ${sql}`)
  console.log(JSON.stringify(rows, null, 1))
}
db.close()
