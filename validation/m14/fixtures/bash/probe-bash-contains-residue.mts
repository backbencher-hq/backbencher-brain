/**
 * THE SINGLE `contains` EDGE THE PROJECT KEY SPACE CANNOT ANSWER.
 *
 * At whole-corpus project scope every `contains` edge resolves except ONE (`probe-bash-incoming-split.mts
 * --nf 0`: `contains: PATH-SHAPED, NOT A SYMBOL ... e.g. this`). A containment edge is lexical — its
 * target is a name the same file declares — so one that names nothing in its own project is either a
 * declaration the analyzer published from a damaged region or an edge attributed to the wrong owner.
 * This prints it, with the file and the line, so the residue is a named defect rather than a count.
 *
 * Read-only. CLI: bun validation/m14/fixtures/bash/probe-bash-contains-residue.mts
 */
import { execFileSync } from "node:child_process"
import { readdirSync, statSync } from "node:fs"
import * as path from "node:path"

const REPO_ROOT = path.join(import.meta.dirname, "..", "..", "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const found: string[] = []
for (const name of readdirSync(CR).sort()) {
  const dir = path.join(CR, name)
  try {
    if (!statSync(dir).isDirectory()) continue
  } catch {
    continue
  }
  try {
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch {
    continue
  }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch {
    continue
  }
  for (const rel of tracked) {
    if (!rel.toLowerCase().endsWith(".sh")) continue
    const abs = path.join(dir, rel)
    try {
      if (statSync(abs).size <= 1024 * 1024) found.push(abs)
    } catch {
      /* absent */
    }
  }
}
found.sort()
const repoOf = (f: string): string => path.relative(CR, f).split(path.sep)[0]
const { parseFile } = await import(`${REPO_ROOT}/src/ast/pool-worker.ts`)

const spaces = new Map<string, Set<string>>()
const parsed: { f: string; repo: string; rels: any[] }[] = []
for (const f of found) {
  const repo = repoOf(f)
  let r: any
  try {
    r = await parseFile(f, repo, { projectRoot: repo } as any)
  } catch {
    continue
  }
  if (!r) continue
  let s = spaces.get(repo)
  if (!s) spaces.set(repo, (s = new Set()))
  for (const sym of Array.isArray(r.symbols) ? r.symbols : []) {
    const n = String(sym?.name ?? "")
    if (n) s.add(n)
    const q = String(sym?.qualifiedName ?? "")
    if (q) s.add(q)
  }
  parsed.push({ f, repo, rels: Array.isArray(r.relationships) ? r.relationships : [] })
}
let hits = 0
for (const p of parsed) {
  for (const rel of p.rels) {
    const t = String(rel?.type ?? rel?.relationshipType ?? "")
    if (t !== "contains") continue
    const tgt = String(rel?.target ?? "")
    if (!tgt) continue
    if (spaces.get(p.repo)?.has(tgt)) continue
    hits++
    console.log(`UNRESOLVED contains  ${p.f.replace(CR + "/", "")}:${rel?.line_number ?? "?"}  ${rel?.source} -[contains]-> ${JSON.stringify(tgt)}  meta=${JSON.stringify(rel?.metadata ?? {}).slice(0, 200)}`)
  }
}
console.log(`\nunresolved contains edges at whole-corpus project scope: ${hits}`)
