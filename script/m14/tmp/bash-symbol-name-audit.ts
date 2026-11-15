/**
 * READ-ONLY PROBE — what would a shell-identifier rule on declared NAMES cost?
 *
 * The universe sweep found the analyzer emitting `exports`/`contains` for
 * `PWD/collection_root_sys` — a PATH FRAGMENT, because the grammar truncates
 * `export A=$PWD/x:$PWD/y` at the first colon and leaves the tail as a bare
 * `word` sibling, which the export handler then read as a second exported name.
 *
 * The obvious fix is to require a declared name to be a shell identifier. Before
 * applying that, measure what it would REJECT across the whole universe: a rule
 * that quietly drops real declarations is worse than the bug it fixes. So every
 * symbol name the analyzer emits is bucketed by why it fails the rule, and the
 * rejects are sampled.
 *
 * Writes nothing.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../src/ast/language-detection"
import { parseFile } from "../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/

const repos: { name: string; dir: string }[] = []
for (const e of readdirSync(CR)) {
  const dir = path.join(CR, e)
  try { if (!statSync(dir).isDirectory()) continue } catch { continue }
  try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  repos.push({ name: e, dir })
}

let idx = 0
const jobs: { repo: string; dir: string; abs: string }[] = []
for (const r of repos) {
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", r.dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(r.dir, rel)
    let text: string
    try { if (statSync(abs).size > 512 * 1024) continue; text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "bash") continue
    jobs.push({ repo: r.name, dir: r.dir, abs })
  }
}

let total = 0
const kinds = new Map<string, { n: number; ex: string[] }>()
const add = (k: string, file: string, name: string) => {
  total++
  const g = kinds.get(k) ?? { n: 0, ex: [] }
  g.n++
  if (g.ex.length < 6) g.ex.push(`${JSON.stringify(name)}  (${file})`)
  kinds.set(k, g)
}

async function worker() {
  while (true) {
    const i = idx++
    if (i >= jobs.length) return
    const j = jobs[i]
    let r: any
    try { r = await parseFile(j.abs, j.dir) } catch { continue }
    for (const s of r.symbols ?? []) {
      const n = String(s.name ?? "")
      if (n.length === 0) { add("empty", `${j.repo}/${path.basename(j.abs)}`, n); continue }
      if (IDENT.test(n)) continue
      // why does it fail?
      if (n.includes("/")) add("contains a SLASH — a path, not an identifier", `${j.repo}/${path.basename(j.abs)}`, n)
      else if (n.includes("$")) add("contains a DOLLAR — an expansion, not an identifier", `${j.repo}/${path.basename(j.abs)}`, n)
      else if (n.includes("{")) add("contains a BRACE — expansion or artifact", `${j.repo}/${path.basename(j.abs)}`, n)
      else if (n.includes("=")) add("contains an EQUALS", `${j.repo}/${path.basename(j.abs)}`, n)
      else if (n.includes(" ")) add("contains a SPACE", `${j.repo}/${path.basename(j.abs)}`, n)
      else if (n.includes("\\")) add("contains a BACKSLASH", `${j.repo}/${path.basename(j.abs)}`, n)
      else if (/^[0-9]/.test(n)) add("starts with a DIGIT", `${j.repo}/${path.basename(j.abs)}`, n)
      else add("other non-identifier (hyphen, dot, quote…)", `${j.repo}/${path.basename(j.abs)}`, n)
    }
  }
}
await Promise.all(Array.from({ length: 8 }, () => worker()))

console.log(`\nsymbol names that are NOT shell identifiers: ${total}  (of every symbol the analyzer emits across ${jobs.length} admitted files)`)
for (const [k, g] of [...kinds.entries()].sort((a, b) => b[1].n - a[1].n)) {
  console.log(`\n  ${g.n.toString().padStart(5)}  ${k}`)
  for (const e of g.ex) console.log(`          ${e}`)
}
