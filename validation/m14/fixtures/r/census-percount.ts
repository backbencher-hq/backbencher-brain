/**
 * PER-FILE SYMBOL AND EDGE COUNTS through production `parseFile`, one line per file.
 *
 * Two censuses of the same corpus that disagree on the total are a question about a
 * FILE, not about the total, so this prints the per-file rows the totals are summed
 * from and can be diffed between two analyzer revisions. It exists because the first
 * A/B of this lane reported +29 symbols and +89 `calls` edges for a change that adds
 * one relationship type and creates no symbol -- a number that cannot be explained by
 * reading the diff, and therefore has to be located before it is reported.
 *
 * USAGE: npx tsx validation/m14/fixtures/r/census-percount.ts [--repo NAME ...]
 */
import { execFileSync } from "node:child_process"
import { readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const argv = process.argv.slice(2)
const repos = argv.reduce<string[]>((a, v, i) => (v === "--repo" ? [...a, argv[i + 1]] : a), [])

const files: string[] = []
for (const e of readdirSync(CR).sort()) {
  if (repos.length && !repos.includes(e)) continue
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    try {
      if (statSync(abs).size > 512 * 1024) continue
      if (detectLanguageFromPath(abs) === "r") files.push(abs)
    } catch { continue }
  }
}
files.sort()
let i = 0
const rows: string[] = []
const worker = async () => {
  for (;;) {
    const k = i++
    if (k >= files.length) return
    const f = files[k]
    try {
      const r: any = await parseFile(f, path.dirname(f))
      const byType: Record<string, number> = {}
      for (const rel of r.relationships ?? []) {
        const t = String(rel.type ?? rel.relationshipType ?? "")
        byType[t] = (byType[t] ?? 0) + 1
      }
      rows.push(`${f.replace(CR + "/", "")} sym=${(r.symbols ?? []).length} rel=${(r.relationships ?? []).length} ${Object.keys(byType).sort().map((k2) => `${k2}=${byType[k2]}`).join(",")}`)
    } catch (e: any) {
      rows.push(`${f.replace(CR + "/", "")} ERROR ${String(e?.message ?? e).slice(0, 60)}`)
    }
  }
}
await Promise.all(Array.from({ length: 4 }, () => worker()))
rows.sort()
for (const r of rows) console.log(r)
