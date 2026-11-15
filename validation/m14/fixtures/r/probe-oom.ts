/**
 * R LANE — the `memory access out of bounds` files.
 *
 * Every production census of this lane logged one or two
 *   [BB-PARSE-ERR] r | <file> | memory access out of bounds
 * and WHICH files logged it CHANGED between two runs over the identical corpus. That
 * is worth a probe rather than a footnote: a count that moves between runs of the same
 * code on the same files cannot be quoted without saying so.
 *
 * Two questions, measured here:
 *   1. how many corpus files reproduce it, and how often;
 *   2. what `parseFile` RETURNS for such a file — a real result with fewer symbols, or
 *      an empty one, or a throw. Those three are very different facts for a census.
 *
 * USAGE: npx tsx validation/m14/fixtures/r/probe-oom.ts [--repo NAME] [--repeat N]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const argv = process.argv.slice(2)
const argOf = (f: string) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined }
const REPEAT = Number(argOf("--repeat") ?? 3)
const repoFilter = argOf("--repo")

const files: string[] = []
for (const e of readdirSync(CR).sort()) {
  if (repoFilter && e !== repoFilter) continue
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > 512 * 1024) continue } catch { continue }
    if (detectLanguageFromPath(abs) === "r") files.push(abs)
  }
}
files.sort()
console.log(`probe-oom — ${files.length} R files in ${CR}${repoFilter ? ` (repo ${repoFilter})` : ""}; ${REPEAT} pass(es) each`)

type Row = { file: string; passes: number; symbols: number[]; rels: number[]; threw: number; empty: number }
const rows: Row[] = []
let i = 0
const worker = async () => {
  for (;;) {
    const k = i++
    if (k >= files.length * REPEAT) return
    const f = files[k % files.length]
    const pass = Math.floor(k / files.length)
    void pass
    let row = rows.find((r) => r.file === f)
    if (!row) { row = { file: f, passes: 0, symbols: [], rels: [], threw: 0, empty: 0 }; rows.push(row) }
    try {
      const r: any = await parseFile(f, path.dirname(f))
      row.passes++
      row.symbols.push((r.symbols ?? []).length)
      row.rels.push((r.relationships ?? []).length)
      if ((r.symbols ?? []).length === 0) row.empty++
    } catch {
      row.passes++
      row.threw++
    }
  }
}
await Promise.all(Array.from({ length: 4 }, () => worker()))
rows.sort((a, b) => (a.file < b.file ? -1 : 1))

const unstable = rows.filter((r) => new Set(r.symbols).size > 1 || new Set(r.rels).size > 1)
const empty = rows.filter((r) => r.empty > 0)
const threw = rows.filter((r) => r.threw > 0)
console.log(`files whose SYMBOL or RELATIONSHIP count differed between passes of the SAME file with the SAME analyzer: ${unstable.length}`)
for (const r of unstable.slice(0, 20)) console.log(`    ${r.file.replace(CR + "/", "")} symbols=${r.symbols.join("/")} rels=${r.rels.join("/")}`)
console.log(`files parseFile returned ZERO symbols for on at least one pass: ${empty.length}`)
for (const r of empty.slice(0, 20)) console.log(`    ${r.file.replace(CR + "/", "")} symbols=${r.symbols.join("/")}`)
console.log(`files parseFile THREW for on at least one pass: ${threw.length}`)
for (const r of threw.slice(0, 20)) console.log(`    ${r.file.replace(CR + "/", "")} threw=${r.threw}/${r.passes}`)
