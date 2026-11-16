/**
 * READ-ONLY PROBE — how much of JSON's "unresolvable edge" mass is INHERENT?
 *
 * A relationship endpoint must name a symbol, and the store resolves it by NAME.
 * Every other lane's language gives names that are unique enough to key on. JSON
 * does not: the format has KEYS and POSITION, and a key is unique only within its
 * object. So the question this answers is not "is the analyzer broken" but "how much
 * of the unresolvable mass is a property of the LANGUAGE rather than a defect".
 *
 * For every file: how many symbols share a name, and how many relationship
 * endpoints therefore cannot identify one symbol unambiguously.
 *
 * Writes nothing.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "path"
import { detectLanguageFromPath } from "../../../src/ast/language-detection"
import { parseFile } from "../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "<corpus-root>/bb_tests/repositories"
const REPOS = (process.env.BB_REPOS ?? "terraform,otp,ansible,clj-kondo,svelte,kubernetes").split(",").map((x) => x.trim()).filter(Boolean)

const jobs: { repo: string; dir: string; abs: string; rel: string }[] = []
for (const repo of REPOS) {
  const dir = path.join(CR, repo)
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try { if (statSync(abs).size > 512 * 1024) continue; text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "json") continue
    jobs.push({ repo, dir, abs, rel })
  }
}

let idx = 0
let filesWithDupNames = 0
let dupNameInstances = 0
let endpointsResolving = 0
let endpointsAmbiguous = 0
let endpointsUnknown = 0
let distinctNamesTotal = 0, symbolsTotal = 0
const worst: { file: string; dup: number; syms: number }[] = []
const byRepo = new Map<string, { files: number; dupFiles: number; amb: number; unk: number }>()

async function worker() {
  while (true) {
    const i = idx++
    if (i >= jobs.length) return
    const j = jobs[i]
    let r: any
    try { r = await parseFile(j.abs, j.dir) } catch { continue }
    const syms = r.symbols ?? []
    const rels = r.relationships ?? []
    if (syms.length === 0) continue
    const counts = new Map<string, number>()
    for (const s of syms) { const n = String(s.name ?? ""); counts.set(n, (counts.get(n) ?? 0) + 1) }
    let dupInstances = 0
    for (const [, c] of counts) if (c > 1) dupInstances += c
    distinctNamesTotal += counts.size
    symbolsTotal += syms.length
    const row = byRepo.get(j.repo) ?? { files: 0, dupFiles: 0, amb: 0, unk: 0 }
    row.files++
    if (dupInstances > 0) { filesWithDupNames++; dupNameInstances += dupInstances; row.dupFiles++ }
    for (const x of rels) {
      const src = String(x.source ?? x.from ?? "")
      const tgt = String(x.target ?? x.to ?? "")
      const cs = counts.get(src)
      if (cs === undefined) { endpointsUnknown++; row.unk++ }
      else if (cs > 1) { endpointsAmbiguous++; row.amb++ }
      else endpointsResolving++
    }
    if (dupInstances > 0 && worst.length < 8) worst.push({ file: `${j.repo}/${j.rel}`, dup: dupInstances, syms: syms.length })
    byRepo.set(j.repo, row)
  }
}
await Promise.all(Array.from({ length: 8 }, () => worker()))

const ends = endpointsResolving + endpointsAmbiguous + endpointsUnknown
console.log(`json name ambiguity — ${jobs.length} files`)
console.log(`  symbols ${symbolsTotal}   distinct names ${distinctNamesTotal}   collision mass ${symbolsTotal - distinctNamesTotal}`)
console.log(`  files where two symbols share a name: ${filesWithDupNames} (${((100 * filesWithDupNames) / jobs.length).toFixed(1)}%)`)
console.log(`  repeated-name instances: ${dupNameInstances}\n`)
console.log(`  relationship endpoints, total ${ends}`)
console.log(`    resolve to exactly ONE symbol : ${endpointsResolving} (${((100 * endpointsResolving) / ends).toFixed(2)}%)`)
console.log(`    AMBIGUOUS — name shared       : ${endpointsAmbiguous} (${((100 * endpointsAmbiguous) / ends).toFixed(2)}%)`)
console.log(`    UNKNOWN — no symbol by that name: ${endpointsUnknown} (${((100 * endpointsUnknown) / ends).toFixed(2)}%)`)
console.log(`\nper repository (ambiguous / unknown):`)
for (const [n, r] of byRepo) console.log(`  ${n.padEnd(12)} files=${String(r.files).padStart(4)} dupNameFiles=${String(r.dupFiles).padStart(4)} amb=${String(r.amb).padStart(7)} unk=${String(r.unk).padStart(7)}`)
console.log(`\nworst files by collision mass:`)
for (const w of worst.sort((a, b) => b.dup - a.dup).slice(0, 5)) console.log(`  ${String(w.dup).padStart(5)} repeated instances over ${w.syms} symbols  ${w.file}`)
