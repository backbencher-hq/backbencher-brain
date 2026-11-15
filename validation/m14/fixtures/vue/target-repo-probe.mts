/**
 * WHERE DOES AN UNRESOLVED instantiates TARGET LIVE? — a bounded probe for the doability question.
 *
 * For the top unresolved `instantiates` targets at a given cap, this prints the REPOSITORY each
 * edge was emitted in and that repository's declaration count for the target, so "the component
 * is declared in the repo but outside the admitted population" is separated from "nothing in the
 * repo declares it" — two different verdicts that one unresolved count cannot tell apart.
 *
 * CLI: bun run validation/m14/fixtures/vue/target-repo-probe.mts [--max 1155] [--top 12]
 */
import { execFileSync } from "node:child_process"
import { readdirSync, statSync } from "node:fs"
import * as path from "path"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const argOf = (f: string, d: string) => { const i = process.argv.indexOf(f); return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : d }
const MAX = Number(argOf("--max", "1155"))
const TOP = Number(argOf("--top", "12"))

const found: string[] = []
for (const name of readdirSync(CR).sort()) {
  const dir = path.join(CR, name)
  try { if (!statSync(dir).isDirectory()) continue } catch { continue }
  try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  for (const r of tracked) {
    if (!r.toLowerCase().endsWith(".vue")) continue
    const abs = path.join(dir, r)
    try { if (statSync(abs).size > 1024 * 1024) continue } catch { continue }
    found.push(abs)
  }
}
found.sort()
let files = found
if (MAX > 0 && found.length > MAX) {
  const stride = Math.max(1, Math.floor(found.length / MAX))
  const picked: string[] = []
  for (let i = 0; i < found.length && picked.length < MAX; i += stride) picked.push(found[i])
  files = picked
}
const repoOf = (f: string) => path.join(CR, path.relative(CR, f).split(path.sep)[0])
const decl = new Map<string, Map<string, number>>()
const unresInst = new Map<string, { repo: string; file: string; line: number | null }[]>()
for (const f of files) {
  const repo = repoOf(f)
  let d = decl.get(repo); if (!d) decl.set(repo, (d = new Map()))
  let r: any
  try { r = await parseFile(f, repo, { projectRoot: repo } as any) } catch { continue }
  if (!r) continue
  for (const s of r.symbols ?? []) { const n = String(s?.name ?? ""); if (n) d.set(n, (d.get(n) ?? 0) + 1); const q = String(s?.qualifiedName ?? ""); if (q && q !== n) d.set(q, (d.get(q) ?? 0) + 1) }
  for (const rel of r.relationships ?? []) {
    if (String(rel?.type ?? "") !== "instantiates") continue
    const t = String(rel?.target ?? "")
    const line = Number(rel?.line_number ?? rel?.line ?? 0) || null
    if (!unresInst.has(t)) unresInst.set(t, [])
    unresInst.get(t)!.push({ repo, file: path.relative(CR, f), line })
  }
}
const topTargets = [...unresInst.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, TOP)
console.log(`population ${files.length} .vue files (cap ${MAX}) · distinct instantiates targets ${unresInst.size}`)
for (const [t, edges] of topTargets) {
  const repos = new Map<string, number>()
  for (const e of edges) repos.set(e.repo, (repos.get(e.repo) ?? 0) + 1)
  const counts = [...repos.keys()].map((r) => `${path.basename(r)}: decl=${decl.get(r)?.get(t) ?? 0} of ${edges.filter((e) => e.repo === r).length} edge(s)`).join(" · ")
  console.log(`  ${t.padEnd(22)} edges=${String(edges.length).padStart(4)}  ${counts}`)
  for (const e of edges.slice(0, 3)) console.log(`        ${e.file}:${e.line ?? "?"}`)
}
