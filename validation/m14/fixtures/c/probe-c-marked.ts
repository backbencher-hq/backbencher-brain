/**
 * PROBE — the edges the ISO C library claim answers, exactly as the analyzer publishes them.
 *
 * Read-only. Parses the gate's own `.c` stride population, keeps every `calls` edge that carries
 * `metadata.isExternal`, writes them as TSV, and reports:
 *   * how many edges / distinct targets / distinct repos,
 *   * the top targets with counts,
 *   * for each distinct (repo, target): whether the SAME repository declares that name in an
 *     admitted `.c` file of the run (that is the false-positive class the claim must not have —
 *     a project's OWN function sharing a library spelling).
 *
 * Usage: bun run validation/m14/fixtures/c/probe-c-marked.ts [maxFiles] [outPath]
 */
import { execFileSync } from "node:child_process"
import { readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SIZE_CAP = 1_000_000
const MAX = Number(process.argv[2] ?? 400)
const OUT = process.argv[3] ?? "validation/m14/fixtures/c/measurements/marked-c-edges.tsv"

const found: string[] = []
for (const name of readdirSync(CR).sort()) {
  const dir = path.join(CR, name)
  try { if (!statSync(dir).isDirectory()) continue } catch { continue }
  try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    if (!/\.c$/i.test(rel)) continue
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > SIZE_CAP) continue } catch { continue }
    found.push(abs)
  }
}
const total = found.length
let files = found
if (MAX > 0 && total > MAX) {
  const stride = Math.max(1, Math.floor(total / MAX))
  const picked: string[] = []
  for (let i = 0; i < found.length && picked.length < MAX; i += stride) picked.push(found[i])
  files = picked
}
const repoOf = (f: string): string => path.join(CR, path.relative(CR, f).split(path.sep)[0])
const rel = (f: string) => path.relative(CR, f)

const decl = new Map<string, Map<string, number>>()   // repo -> name -> count (in the run)
const rows: string[] = []
const targets = new Map<string, number>()
const byRepo = new Map<string, number>()
let edges = 0
for (const f of files) {
  let r: any
  try { r = await parseFile(f, repoOf(f), { projectRoot: repoOf(f) } as any) } catch { continue }
  if (!r) continue
  const repo = repoOf(f)
  let d = decl.get(repo)
  if (!d) decl.set(repo, (d = new Map()))
  for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
    const n = String(s?.name ?? "")
    if (n) d.set(n, (d.get(n) ?? 0) + 1)
  }
  for (const x of Array.isArray(r.relationships) ? r.relationships : []) {
    const md = (x as any)?.metadata ?? {}
    if (md.isExternal !== true) continue
    if (String(x.type) !== "calls") continue
    const tgt = String(x.target ?? "")
    edges++
    targets.set(tgt, (targets.get(tgt) ?? 0) + 1)
    byRepo.set(repo, (byRepo.get(repo) ?? 0) + 1)
    rows.push([rel(f), String(x.line_number ?? 0), tgt, repo, String(md.relationshipType ?? "")].join("\t"))
  }
}
writeFileSync(OUT, rows.join("\n") + "\n")

// THE FALSE-POSITIVE CLASS: a marked target that the SAME repository's run DOES declare. The gate
// cannot see this (a claim is unread where decls > 0), so it is measured here rather than assumed.
const conflicts: string[] = []
const distinct = new Set<string>()
for (const row of rows) {
  const [, , tgt, repo] = row.split("\t")
  const key = `${repo}\t${tgt}`
  if (distinct.has(key)) continue
  distinct.add(key)
  const n = decl.get(repo)?.get(tgt) ?? 0
  if (n > 0) conflicts.push(`${key} -> ${n} declaration(s) in the run`)
}

console.log(`population: ${files.length} of ${total} .c files`)
console.log(`marked calls edges: ${edges}  distinct targets: ${targets.size}  repos: ${byRepo.size}`)
console.log(`\nTOP MARKED TARGETS`)
for (const [t, n] of [...targets].sort((a, b) => b[1] - a[1]).slice(0, 40)) console.log(`  ${String(n).padStart(6)}  ${t}`)
console.log(`\nMARKED EDGES BY REPO`)
for (const [r, n] of [...byRepo].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(6)}  ${r}`)
console.log(`\nCONFLICTS — a marked (repo,target) the same repo's ADMITTED .c files declare: ${conflicts.length} of ${distinct.size}`)
for (const c of conflicts.slice(0, 40)) console.log(`  ${c}`)
console.log(`\nTSV: ${OUT}`)
console.log(`FIRST 20 MARKED EDGES (file:line target)`)
for (const row of rows.slice(0, 20)) {
  const [f, line, tgt] = row.split("\t")
  console.log(`  ${f}:${line} -> ${tgt}`)
}
