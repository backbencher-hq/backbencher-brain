/**
 * GO-FIX — the ten hand-read edges. Prints the first ten `imports` edges that the landed `isStdlib`
 * claim causes the gate to verify, in deterministic file order, with the SOURCE LINE of the import
 * spec so the reader can open the file and see what the edge means. Read-only.
 *
 * RUN: bun run validation/m14/fixtures/go/probe-b-edges.ts
 */
import { execFileSync } from "node:child_process"
import { readdirSync, readFileSync, statSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SIZE_CAP = 1024 * 1024
const files: string[] = []
for (const name of readdirSync(CR).sort()) {
  const dir = path.join(CR, name)
  try { if (!statSync(dir).isDirectory()) continue } catch { continue }
  try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[] = []
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    if (!rel.toLowerCase().endsWith(".go")) continue
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > SIZE_CAP) continue } catch { continue }
    files.push(abs)
  }
}
files.sort()
const stride = Math.max(1, Math.floor(files.length / 400))
const sample: string[] = []
for (let i = 0; i < files.length && sample.length < 400; i += stride) sample.push(files[i])

let shown = 0
for (const f of sample) {
  if (shown >= 10) break
  const repo = path.join(CR, f.slice(CR.length + 1).split(path.sep)[0])
  const r: any = await parseFile(f, repo, { projectRoot: repo } as any)
  const lines = (r?.rawContent ?? readFileSync(f, "utf8")).split("\n")
  for (const rel of r?.relationships ?? []) {
    if (String(rel?.type) !== "imports") continue
    if (rel?.metadata?.isStdlib !== true) continue
    if (shown >= 10) break
    shown++
    const rel_path = path.relative(CR, f)
    const line = Number(rel?.line_number ?? 0)
    console.log(`${shown}. ${rel_path}:${line}`)
    console.log(`   edge:     imports ${rel.source} -> "${rel.target}"  (metadata.isStdlib=true)`)
    console.log(`   source:   ${JSON.stringify(lines[line - 1] ?? "")}`)
  }
}
