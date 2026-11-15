// Fresh-process CLI-door call: `bb tool bb_security --dir <dir> --args <json>`
// through the SOURCE entry (tsx src/cli/index.ts), so a stale dist cannot be
// mistaken for the working tree.
import { spawnSync } from "node:child_process"
import path from "node:path"

const dir = process.argv[2]!
const args = process.argv[3] ?? "{}"
const dataDir = process.argv[4]!
const root = path.resolve(import.meta.dirname ?? ".", "../../../..")
const res = spawnSync(path.join(root, "node_modules", ".bin", "tsx"), [path.join(root, "src", "cli", "index.ts"), "tool", "bb_security", "--dir", dir, "--args", args], {
  cwd: root, encoding: "utf8", timeout: 180_000,
  env: { ...process.env, BB_DATA_DIR: dataDir, BB_NO_AUTO_REFRESH: "1" },
})
console.log(JSON.stringify({ exit: res.status, stdout: (res.stdout ?? "").slice(0, 800), stderr: (res.stderr ?? "").slice(0, 800) }))
