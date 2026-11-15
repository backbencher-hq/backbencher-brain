import { acquireIndexLock, indexLockPath } from "../../../../src/ast/index-lock"
import { mkdirSync, writeFileSync, statSync } from "node:fs"
import path from "node:path"
const projectId = process.argv[2]
const mode = process.argv[3] ?? "malformed-fresh"
const lock = indexLockPath(projectId)
mkdirSync(path.dirname(lock), { recursive: true })
if (mode === "malformed-fresh") writeFileSync(lock, "{}")
if (mode === "missing-pid") writeFileSync(lock, JSON.stringify({ schemaVersion: 2, host: "pop-os", kind: "index" }))
const age = Date.now() - statSync(lock).mtimeMs
try {
  const h = await acquireIndexLock(projectId, { kind: "probe" })
  console.log(JSON.stringify({ mode, age, acquired: true, token: h.token }))
  await h.release()
} catch (e: any) {
  console.log(JSON.stringify({ mode, age, acquired: false, name: e?.name, message: e?.message }))
}
