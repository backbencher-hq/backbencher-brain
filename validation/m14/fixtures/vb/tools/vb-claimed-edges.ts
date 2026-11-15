/**
 * VB CLAIMED EDGES — every edge this lane's built-in-type fix causes to ANSWER, with its site line.
 *
 * The hand-read sample in `VB-FIX.md` §5 is taken from this list. READ-ONLY: parses the admitted
 * population with production's `parseFile` and prints the edges carrying the `languageNamespace`
 * claim, one per line, so each can be opened in the source.
 *
 * Run from the repo root:  bun run validation/m14/fixtures/vb/tools/vb-claimed-edges.ts [maxRows]
 */
const fs = await import("node:fs")
const path = await import("node:path")
const ROOT = path.resolve(import.meta.dir, "..", "..", "..", "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const { parseFile } = await import(path.join(ROOT, "src/ast/pool-worker"))
const MAX = Number(process.argv[2] ?? 2000)

const files: string[] = []
function walk(d: string): void {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name)
    if (e.isDirectory()) { if (e.name === "node_modules" || e.name === ".git") continue; walk(p) }
    else if (e.name.toLowerCase().endsWith(".vb")) { try { if (fs.statSync(p).size <= 1048576) files.push(p) } catch { /* skip */ } }
  }
}
for (const repo of fs.readdirSync(CR)) {
  const p = path.join(CR, repo)
  let st: any; try { st = fs.statSync(p) } catch { continue }
  if (st.isDirectory()) walk(p)
}
files.sort()
const repoOf = (f: string): string => path.join(CR, f.slice(CR.length + 1).split(path.sep)[0])

let n = 0
const byRole = new Map<string, number>()
const byTarget = new Map<string, number>()
for (const f of files) {
  const r: any = await parseFile(f, repoOf(f), { projectRoot: repoOf(f) } as any)
  for (const rel of (r.relationships ?? []) as any[]) {
    const md = (rel?.metadata ?? {}) as Record<string, any>
    if (!Array.isArray(md.languageNamespace)) continue
    n++
    const role = String(md.role ?? "?")
    byRole.set(role, (byRole.get(role) ?? 0) + 1)
    byTarget.set(String(rel.target), (byTarget.get(String(rel.target)) ?? 0) + 1)
    if (n <= MAX) {
      console.log(`CLAIMED  ${f.replace(CR + "/", "")}:${rel.line_number}  ${rel.source} -> ${rel.target}  role=${role}  basis=${md.languageNamespaceBasis}  list=${(md.languageNamespace as string[]).length}`)
    }
  }
}
console.log(`\nclaimed edges: ${n}`)
console.log(`by role:   ${[...byRole.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(" · ")}`)
console.log(`by target: ${[...byTarget.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(" · ")}`)
