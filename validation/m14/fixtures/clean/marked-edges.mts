#!/usr/bin/env bun
/**
 * CLEAN lane — THE EDGES THE FIX ANSWERS, as a TSV, with the declaration each name actually has.
 *
 * The fix attaches `metadata.isStdlib: true` to `references` / `implements` edges whose bare target
 * is in `CLEAN_STD_ENV_NAMES`. This prints every marked edge with its site, and for each target the
 * declaration the CORPUS holds (project, file, line, kind) — which is the evidence a hand-read needs:
 * "the emitted target" beside "the declaration the code means".
 *
 * Usage: bun validation/m14/fixtures/clean/marked-edges.mts [--out <tsv>] [--samples N]
 */
import * as fs from "node:fs"
import * as path from "node:path"
import { execFileSync } from "node:child_process"
import { parseFile } from "../../../../src/ast/pool-worker"

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3)
const CORPUS = arg("corpus") ?? process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const OUT = arg("out") ?? "validation/m14/fixtures/clean/marked-edges.tsv"
const SAMPLES = Number(arg("samples") ?? "10")

type FileRec = { abs: string; repo: string; rel: string }
const files: FileRec[] = []
for (const entry of fs.readdirSync(CORPUS)) {
  const repoRoot = path.join(CORPUS, entry)
  try { if (!fs.statSync(repoRoot).isDirectory()) continue } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", repoRoot, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 1 << 28 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    if (!/\.(icl|dcl)$/.test(rel)) continue
    const abs = path.join(repoRoot, rel)
    try { if (fs.statSync(abs).size > 1024 * 1024) continue } catch { continue }
    files.push({ abs, repo: repoRoot, rel })
  }
}

/** name -> where the corpus declares it (project/file/line/kind), first few */
const declared = new Map<string, string[]>()
const rows: string[][] = []
let marked = 0
const projectDecl = new Map<string, Map<string, number>>()   // repo -> name -> count (from the first pass below)
const perFileUnderKey = new Map<string, string[]>()          // abs -> names, to test "declared in its own project"
const fileNames = new Map<string, string[]>()
for (const f of files) {
  let r: any
  try { r = await parseFile(f.abs, f.repo, { projectRoot: f.repo } as any) } catch { continue }
  if (!r) continue
  for (const s of r.symbols ?? []) {
    const n = String(s?.name ?? ""); if (!n) continue
    const line = Number((s as any)?.range?.startLine ?? (s as any)?.range?.start_line ?? (s as any)?.line_start ?? (s as any)?.lineStart ?? (s as any)?.startLine ?? (s as any)?.line ?? 0) || null
    const where = `${path.basename(f.repo)}/${f.rel}:${line ?? "?"}[${s?.kind ?? ""}]`
    const l = declared.get(n); if (l) { if (l.length < 4 && !l.includes(where)) l.push(where) } else declared.set(n, [where])
    const pn = fileNames.get(f.abs); if (pn) pn.push(n); else fileNames.set(f.abs, [n])
    let pd = projectDecl.get(f.repo); if (!pd) projectDecl.set(f.repo, (pd = new Map()))
    pd.set(n, (pd.get(n) ?? 0) + 1)
  }
  for (const rel of r.relationships ?? []) {
    const md = (rel?.metadata ?? {}) as Record<string, any>
    if (md.isStdlib !== true) continue
    marked++
    rows.push([
      String(rel?.type ?? ""),
      `${path.basename(f.repo)}/${f.rel}:${rel?.line_number ?? "?"}`,
      String(rel?.source ?? ""),
      String(rel?.target ?? ""),
      String(md.relationshipType ?? ""),
      String(md.isImportDependency ?? ""),
    ])
  }
}
fs.writeFileSync(OUT, ["type\tfile:line\tsource\ttarget\trelationshipType\tisImportDependency", ...rows.map((r) => r.join("\t"))].join("\n") + "\n")
console.log(`marked edges: ${marked}  (written to ${OUT})`)

// A SAMPLE ACROSS DISTINCT TARGETS, so a hand-read is not ten spellings of `String`.
// SAMPLE FRAME: the MOVED class only — a marked edge whose target the edge's own PROJECT does not
// declare, which is exactly the set the arbiter now verifies. The inert ones are excluded.
const moved = rows.filter((r) => {
  const repoRel = r[1]               // "<repo>/<rel>:<line>" — the repo is the first segment
  const repo = repoRel.slice(0, repoRel.indexOf("/"))
  const pd = [...projectDecl.entries()].find(([k]) => path.basename(k) === repo)?.[1]
  return ((pd?.get(r[3]) ?? 0) === 0)
})
console.log(`of the ${marked} marked, ${moved.length} are on edges whose own PROJECT does not declare the target (the moved class)`)
const byTarget = new Map<string, string[][]>()
for (const r of moved) { const l = byTarget.get(r[3]); if (l) l.push(r); else byTarget.set(r[3], [r]) }
const distinct = [...byTarget.keys()].sort()
const step = Math.max(1, Math.floor(distinct.length / SAMPLES))
console.log(`distinct targets marked: ${distinct.length}`)
console.log()
for (let i = 0; i < distinct.length && i / step < SAMPLES; i += step) {
  const t = distinct[i]
  const r = byTarget.get(t)![0]
  const decls = declared.get(t) ?? ["(declared NOWHERE in the corpus)"]
  console.log(`${t}`)
  console.log(`  edge   : ${r[0]}  ${r[1]}  src=${JSON.stringify(r[2])}  relType=${r[4]} importDep=${r[5]}  (${byTarget.get(t)!.length} marked edge(s) with this target)`)
  console.log(`  corpus : ${decls.join(" · ")}`)
}
