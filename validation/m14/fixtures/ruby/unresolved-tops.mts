/**
 * RUBY LANE — are the top UNRESOLVED `calls` targets declared in files the 400-file SAMPLE
 * does not contain?
 *
 * This is Step 2's question for bucket 1, asked the only way it can be answered: a name that
 * the sampled key space cannot answer, but that the SAME PROJECT declares in a file outside
 * the stride sample, is a POPULATION artifact — the analyzer published the right spelling and
 * the run had no budget to see the declaration. A name nothing in the project declares is the
 * genuinely-external class.
 *
 * The declaration test is a NAME-LEVEL spelling scan (`def <name>` / `def self.<name>` in a
 * tracked `.rb` file of the same repo), deliberately NOT a second AST analyzer: it is used to
 * CLASSIFY, not to resolve, and it is quoted as a spelling count rather than as a resolution.
 *
 * Usage: bun run validation/m14/fixtures/ruby/unresolved-tops.mts [topN]
 */
import { execFileSync } from "node:child_process"
import { readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SIZE_CAP = 1024 * 1024
const MAX_FILES = Number(process.env.BB_MAX ?? 400)
const TOP = Number(process.argv[2] ?? 12)

function discover(): { files: string[]; total: number } {
  const found: string[] = []
  for (const name of readdirSync(CR).sort()) {
    const dir = path.join(CR, name)
    try { if (!statSync(dir).isDirectory()) continue } catch { continue }
    try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
    let tracked: string[] = []
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
    } catch { continue }
    for (const rel of tracked) {
      if (!rel.toLowerCase().endsWith(".rb")) continue
      const abs = path.join(dir, rel)
      try { if (statSync(abs).size > SIZE_CAP) continue } catch { continue }
      found.push(abs)
    }
  }
  found.sort()
  const total = found.length
  if (total <= MAX_FILES) return { files: found, total }
  const stride = Math.max(1, Math.floor(total / MAX_FILES))
  const picked: string[] = []
  for (let i = 0; i < found.length && picked.length < MAX_FILES; i += stride) picked.push(found[i])
  return { files: picked, total }
}


/** Does `src` declare `name` with a token boundary — `def name` / `def self.name`? */
function declaresName(src: string, name: string): boolean {
  for (const prefix of [`def ${name}`, `def self.${name}`]) {
    let i = src.indexOf(prefix)
    while (i >= 0) {
      const after = src.charCodeAt(i + prefix.length)
      // end of file, whitespace, `(`, `;` or a comment — anything that is not a name character
      const isNameChar =
        (after >= 65 && after <= 90) || (after >= 97 && after <= 122) ||
        (after >= 48 && after <= 57) || after === 95 || after === 33 || after === 63
      if (Number.isNaN(after) || !isNameChar) return true
      i = src.indexOf(prefix, i + 1)
    }
  }
  return false
}

const repoOf = (f: string) => path.join(CR, (f.startsWith(CR) ? f.slice(CR.length + 1) : f).split(path.sep)[0])

const main = async () => {
  const { files, total } = discover()
  const sampled = new Set(files)
  console.log(`sample: ${files.length} of ${total} .rb files`)

  // key space: name + qualifiedName alias, per PROJECT (the gate's model)
  const decl = new Map<string, Map<string, number>>()
  const edges: { repo: string; file: string; target: string }[] = []
  for (const f of files) {
    const repo = repoOf(f)
    const parsed: any = await parseFile(f, repo, { projectRoot: repo } as any)
    const m = decl.get(repo) ?? new Map<string, number>()
    decl.set(repo, m)
    for (const s of Array.isArray(parsed?.symbols) ? parsed.symbols : []) {
      const name = String(s?.name ?? "")
      if (!name) continue
      m.set(name, (m.get(name) ?? 0) + 1)
      const q = String(s?.qualifiedName ?? "")
      if (q && q !== name) m.set(q, (m.get(q) ?? 0) + 1)
    }
    for (const r of Array.isArray(parsed?.relationships) ? parsed.relationships : []) {
      if (String(r?.type ?? "") !== "calls") continue
      const t = String(r?.target ?? "")
      if (t) edges.push({ repo, file: f, target: t })
    }
  }

  const unres = new Map<string, { n: number; repos: Set<string> }>()
  for (const e of edges) {
    if ((decl.get(e.repo)?.get(e.target) ?? 0) > 0) continue
    const r = unres.get(e.target) ?? { n: 0, repos: new Set<string>() }
    r.n++
    r.repos.add(e.repo)
    unres.set(e.target, r)
  }
  const top = [...unres].sort((a, b) => b[1].n - a[1].n).slice(0, TOP)
  console.log(`unresolved calls edges: ${[...unres.values()].reduce((s, r) => s + r.n, 0)} · distinct targets: ${unres.size}`)
  console.log(`\ntop ${TOP} unresolved targets, and whether the SAME PROJECT declares them elsewhere:`)
  for (const [name, r] of top) {
    let elsewhere = 0
    const repos = [...r.repos]
    for (const repo of repos) {
      // tracked .rb files of this repo that the sample does NOT contain, searched for the spelling
      const dir = repo
      let tracked: string[] = []
      try {
        tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
      } catch { continue }
      for (const rel of tracked) {
        if (!rel.toLowerCase().endsWith(".rb")) continue
        const abs = path.join(dir, rel)
        if (sampled.has(abs)) continue
        try {
          const src = require("node:fs").readFileSync(abs, "utf8") as string
          // A BOUNDARY, not a substring: `def items` is not a declaration of `it`.
          // (`String.includes` matched it, `map` inside `mapping`, `size` inside `sizes` —
          // measured on the first cut of this probe, which reported four false YES rows.)
          if (declaresName(src, name)) { elsewhere++; break }
        } catch { /* unreadable */ }
      }
    }
    console.log(`  ${String(r.n).padStart(5)}  ${name.padEnd(24)} declared in an UNSAMPLED file of the same project: ${elsewhere > 0 ? "YES" : "no"}`)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
