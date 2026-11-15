/**
 * VB EDGE DUMP — every edge the analyzer emits over the admitted population, one per line, in a
 * deterministic order, so two revisions can be compared edge by edge rather than by totals.
 *
 * WHY IT EXISTS. `VB-FIX.md` claims "every pre-existing edge is byte-identical except N". A total
 * that does not move does not prove the members did not: this makes the claim a DIFF instead of an
 * argument, and the diff names every line that moved.
 *
 * READ-ONLY. Run from the repo root:
 *   bun run validation/m14/fixtures/vb/tools/vb-edge-dump.ts > <out>
 */
const fs = await import("node:fs")
const path = await import("node:path")
const ROOT = path.resolve(import.meta.dir, "..", "..", "..", "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const { parseFile } = await import(path.join(ROOT, "src/ast/pool-worker"))

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
for (const f of files) {
  const r: any = await parseFile(f, repoOf(f), { projectRoot: repoOf(f) } as any)
  for (const rel of (r.relationships ?? []) as any[]) {
    const md = { ...((rel?.metadata ?? {}) as Record<string, any>) }
    // key ORDER is normalised so the dump compares content, not insertion order
    const keys = Object.keys(md).sort()
    const body = keys.map((k) => `${k}=${JSON.stringify(md[k])}`).join(",")
    console.log(`${f.replace(CR + "/", "")}\t${rel.type}\t${rel.source}\t${rel.target}\t${rel.line_number}\t${rel.confidence}\t${body}`)
    n++
  }
  for (const s of (r.symbols ?? []) as any[]) {
    const md = { ...((s?.metadata ?? {}) as Record<string, any>) }
    const body = Object.keys(md).sort().map((k) => `${k}=${JSON.stringify(md[k])}`).join(",")
    console.log(`SYMBOL\t${f.replace(CR + "/", "")}\t${s.kind}\t${s.name}\t${s.qualifiedName ?? ""}\t${s.range?.startLine ?? ""}\t${body}`)
  }
}
console.error(`edges=${n}`)
