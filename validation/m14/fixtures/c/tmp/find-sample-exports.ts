import { execFileSync } from "node:child_process"
import { readdirSync, statSync, readFileSync } from "node:fs"
import * as path from "node:path"
const ROOT = path.resolve(import.meta.dirname, "../../../../..")
const CR = path.join(ROOT, ".corpus")
const found: string[] = []
const repos = new Set<string>()
for (const name of readdirSync(CR).sort()) {
  const dir = path.join(CR, name)
  try { if (!statSync(dir).isDirectory()) continue; execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[] = []
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked) { if (!rel.toLowerCase().endsWith(".c")) continue; const abs = path.join(dir, rel); try { if (statSync(abs).size > 1024 * 1024) continue } catch { continue } found.push(abs); repos.add(name) }
}
found.sort()
const stride = Math.max(1, Math.floor(found.length / 50))
const picked: string[] = []
for (let i = 0; i < found.length && picked.length < 50; i += stride) picked.push(found[i])
for (const f of picked) {
  const src = readFileSync(f, "utf8")
  if (src.includes("__declspec(dllexport)") || src.includes("__attribute__") || src.includes("EXPORT_SYMBOL")) {
    console.log(path.relative(CR, f))
  }
}
