#!/usr/bin/env bun
/**
 * CLEAN lane — THE FILE CLAIM'S CANDIDATE SPELLINGS, PRICED.
 *
 * The lane's `imports` edges are `Module:item`, and the file claim the analyzer attaches is
 * `importProjectFile` with candidates `Module/Sub.icl` / `Module/Sub.dcl` — ROOT-relative.
 * The shared guard ALSO folds the target against the importing file's own directory, but the
 * extra candidates are used VERBATIM, so a module declared at `src/languageServer/Config.dcl`
 * (which the importing file's own directory carries) is never reached and the edge reads
 * unresolved even though the project has the file.
 *
 * This prices three candidate sets against the SAME admitted file list the arbiter uses:
 *   A  as-shipped      root-relative `Module/Sub.{icl,dcl}`
 *   B  + own dir       `<dir of the importing file>/Module/Sub.{icl,dcl}`
 *   C  + anywhere      any admitted file whose basename is `Sub.{icl,dcl}` (project-wide)
 *
 * and, for each, the STRICT half: does the candidate file actually DECLARE the module (a symbol
 * named `Module`, or a module symbol whose name is the leaf)? A candidate that merely exists is
 * what the arbiter verifies; the strict column is what makes the claim TRUE rather than plausible.
 *
 * Usage: bun validation/m14/fixtures/clean/import-claim-pricing.mts [--json <out>]
 */
import * as fs from "node:fs"
import * as path from "node:path"
import { execFileSync } from "node:child_process"
import { parseFile } from "../../../../src/ast/pool-worker"

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3)
const CORPUS = arg("corpus") ?? process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const JSON_OUT = arg("json")

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
    files.push({ abs, repo: repoRoot, rel })
  }
}

/** repo -> rel paths of admitted files */
const admitted = new Map<string, Set<string>>()
/** repo -> rel paths of files that DECLARE a given name (module symbol or any symbol) */
const declFiles = new Map<string, Map<string, Set<string>>>()
const byRepoBasename = new Map<string, Map<string, string[]>>()   // repo -> basename -> rels
let parsed = 0

for (const f of files) {
  let a = admitted.get(f.repo); if (!a) admitted.set(f.repo, (a = new Set())); a.add(f.rel)
  let bb = byRepoBasename.get(f.repo); if (!bb) byRepoBasename.set(f.repo, (bb = new Map()))
  const base = f.rel.slice(f.rel.lastIndexOf("/") + 1)
  const l = bb.get(base); if (l) l.push(f.rel); else bb.set(base, [f.rel])
  let df = declFiles.get(f.repo); if (!df) declFiles.set(f.repo, (df = new Map()))
  let r: any
  try { r = await parseFile(f.abs, f.repo, { projectRoot: f.repo } as any) } catch { continue }
  if (!r) continue
  parsed++
  for (const s of r.symbols ?? []) {
    const name = String(s?.name ?? ""); if (!name) continue
    const kind = String(s?.kind ?? "")
    // the module symbol is what an import names; keep those apart from ordinary members
    for (const key of [name, String(s?.qualifiedName ?? "")].filter(Boolean)) {
      let set = df.get(key); if (!set) df.set(key, (set = new Set()))
      set.add(f.rel)
      if (kind === "module") { let ms = df.get(`\u0000module:${key}`); if (!ms) df.set(`\u0000module:${key}`, (ms = new Set())); ms.add(f.rel) }
    }
  }
}

type Edge = { file: FileRec; src: string; tgt: string; module: string; line: number | null }
const edges: Edge[] = []
for (const f of files) {
  let r: any
  try { r = await parseFile(f.abs, f.repo, { projectRoot: f.repo } as any) } catch { continue }
  if (!r) continue
  for (const rel of r.relationships ?? []) {
    if (String(rel?.type ?? rel?.relationshipType ?? "") !== "imports") continue
    const md = (rel?.metadata ?? {}) as Record<string, any>
    const tgt = String(rel?.target ?? "")
    const module = typeof md.module === "string" && md.module.length > 0 ? md.module : tgt.split(":")[0]
    if (!module) continue
    const line = Number(rel?.line_number ?? 0) || null
    const existing = edges.find((e) => e.file.abs === f.abs && e.tgt === tgt && e.line === line)
    if (!existing) edges.push({ file: f, src: String(rel?.source ?? ""), tgt, module, line })
  }
}

const dirOf = (rel: string) => { const i = rel.lastIndexOf("/"); return i < 0 ? "" : rel.slice(0, i + 1) }
const modPath = (m: string) => m.split(".").join("/")

const tally = { A: 0, B: 0, C: 0, strictA: 0, strictB: 0, strictC: 0, none: 0 }
const perRepo = new Map<string, { A: number; B: number; C: number }>()
const examples: Record<string, string[]> = { A: [], B: [], C: [], none: [] }

for (const e of edges) {
  const repo = e.file.repo
  const adm = admitted.get(repo) ?? new Set()
  const df = declFiles.get(repo) ?? new Map()
  const bb = byRepoBasename.get(repo) ?? new Map()
  const mp = modPath(e.module)
  const leaf = e.module.split(".").pop()!
  const candA = [`${mp}.icl`, `${mp}.dcl`]
  const candB = [...candA, `${dirOf(e.file.rel)}${mp}.icl`, `${dirOf(e.file.rel)}${mp}.dcl`]
  // does the candidate file DECLARE the module? (module kind first, then any symbol of that name)
  // STRICT: the candidate file must DECLARE this module — the module symbol's own name is the
  // FULL dotted module name (`Util.SimpleTCPServer`), so testing the leaf alone was wrong for
  // every dotted import and is fixed here.
  const declares = (rel: string) =>
    (df.get(`\u0000module:${e.module}`)?.has(rel) ?? false) ||
    (df.get(`\u0000module:${leaf}`)?.has(rel) ?? false) ||
    (df.get(e.module)?.has(rel) ?? false)
  const hitA = candA.find((c) => adm.has(c))
  const hitB = candB.find((c) => adm.has(c))
  const cOnly = [...(bb.get(`${leaf}.icl`) ?? []), ...(bb.get(`${leaf}.dcl`) ?? [])]
  const candC = [...candB, ...cOnly]
  const cUnique = cOnly.length <= 1
  const hitC = candC.find((c) => adm.has(c))
  if (hitA) { tally.A++; if (declares(hitA)) tally.strictA++ } else if (hitB) { tally.B++; if (declares(hitB!)) tally.strictB++ } else if (hitC) { tally.C++; if (declares(hitC)) tally.strictC++; if (!cUnique) (tally as any).cAmbiguous = ((tally as any).cAmbiguous ?? 0) + 1 } else { tally.none++ }
  const rec = perRepo.get(repo) ?? { A: 0, B: 0, C: 0 }
  if (hitA) rec.A++; else if (hitB) rec.B++; else if (hitC) rec.C++
  perRepo.set(repo, rec)
  const key = hitA ? "A" : hitB ? "B" : hitC ? "C" : "none"
  if (examples[key].length < 12) {
    examples[key].push(
      `${e.file.rel}:${e.line ?? "?"} tgt=${e.tgt} candidate=${hitA ?? hitB ?? hitC ?? "-"}` +
      (key !== "none" ? ` declaresModule=${declares((hitA ?? hitB ?? hitC)!)}` : ""),
    )
  }
}

console.log(`CLEAN import-claim pricing — ${parsed} parsed, ${edges.length} import edges over ${files.length} admitted files`)
console.log(`A as-shipped (root-relative)   : verified ${tally.A}   of which the candidate DECLARES the module: ${tally.strictA}`)
console.log(`B + importing file's own dir   : verified ${tally.B}   of which the candidate DECLARES the module: ${tally.strictB}`)
console.log(`C + anywhere in the project    : verified ${tally.C}   of which the candidate DECLARES the module: ${tally.strictC}`)
console.log(`neither                        : ${tally.none}`)
console.log(`of C, basename NOT unique in project (a wrong-file risk): ${(tally as any).cAmbiguous ?? 0}`)
console.log(`edges total                    : ${tally.A + tally.B + tally.C + tally.none}`)
console.log()
console.log("per repo (A / B / C newly-verified):")
for (const [repo, v] of perRepo) console.log(`  ${path.basename(repo).padEnd(18)} A=${v.A} B=${v.B} C=${v.C}`)
console.log()
for (const k of ["A", "B", "C", "none"] as const) {
  console.log(`── ${k} examples`)
  for (const x of examples[k]) console.log(`    ${x}`)
}
if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify({ tally, perRepo: Object.fromEntries([...perRepo].map(([k, v]) => [path.basename(k), v])), examples }, null, 2))
