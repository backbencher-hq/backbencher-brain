/**
 * WHY THE 6 (then 2) `extends` ROWS ARE UNEXPLAINED — lane-owned, no regex.
 *
 * The differential reports `unexplained-by-label: extends=N` for vue on
 * vue-element-admin and the count MOVES between runs (6, then 2) because the
 * lane samples a rotating file set. So the number alone cannot be diagnosed; the
 * rows can. This reproduces the analyzer's side through production parseFile and
 * prints every `extends` row with its file, so the question "which base does the
 * oracle not derive" has an answer that is a file and a name.
 */
import { readFileSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../src/ast/pool-worker"

const DIR = process.env.BB_REPO_DIR ?? "$HOME/fixtures/repositories/vue-element-admin"
const files = process.argv.slice(2)
const rows: string[] = []
for (const rel of files) {
  const abs = path.join(DIR, rel)
  let src: string
  try { src = readFileSync(abs, "utf8") } catch { continue }
  let r: any
  try { r = await parseFile(abs, path.dirname(abs)) } catch { continue }
  for (const x of r?.relationships ?? []) {
    if (String(x.type ?? x.relationshipType) !== "extends") continue
    rows.push(`${rel}  ${x.source} -> ${x.target}  conf=${x.confidence}  meta=${JSON.stringify(x.metadata ?? {})}`)
  }
}
console.log(rows.join("\n") || "(no extends rows in this file set)")
