/** SIZE — how many `calls` edges carry `targetResolution: "local-binding"`, and who owns them? */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const LIMIT = Number(process.argv[2] ?? "400")

const found: string[] = []
for (const name of readdirSync(CR).sort()) {
  const dir = path.join(CR, name)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    if (!rel.endsWith(".fs")) continue
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > 1024 * 1024) continue } catch { continue }
    found.push(abs)
  }
}
found.sort()
const stride = Math.max(1, Math.floor(found.length / LIMIT))
const draw: string[] = []
for (let i = 0; i < found.length && draw.length < LIMIT; i += stride) draw.push(found[i])

const byRes = new Map<string, number>()
const examples: string[] = []
let localBinding = 0
let calls = 0
for (const f of draw) {
  let r: any
  try { r = await parseFile(f, path.basename(path.dirname(path.dirname(f)))) } catch { continue }
  for (const e of r.relationships ?? []) {
    if (String(e.type) !== "calls") continue
    calls++
    const res = String(e.metadata?.targetResolution ?? "(none)")
    byRes.set(res, (byRes.get(res) ?? 0) + 1)
    if (res === "local-binding") {
      localBinding++
      if (examples.length < 10) examples.push(`${e.source} -> ${e.target}   [${path.relative(CR, f)}]`)
    }
  }
}
console.log(`population: ${found.length} .fs files; draw ${draw.length} by even stride ${stride}`)
console.log(`calls edges in draw: ${calls}`)
console.log(`calls edges with targetResolution="local-binding": ${localBinding}`)
console.log(`  => corpus-scale estimate: ${Math.round((localBinding / draw.length) * found.length)}`)
console.log("")
console.log("by targetResolution:")
for (const [k, v] of [...byRes.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(7)}  ${k}`)
console.log("")
console.log("examples of the class the binding claim would re-spell:")
for (const e of examples) console.log(`  ${e}`)
process.exit(0)
