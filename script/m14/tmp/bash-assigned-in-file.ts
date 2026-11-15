/**
 * READ-ONLY PROBE — does `isAssignedInFile` classify the reads honestly?
 *
 * The field is emitted on TRUE only, so this counts both directions and then
 * splits the negatives with the one piece of information a single-file analyzer
 * cannot have: whether the name is assigned in ANOTHER file of the same corpus.
 * That is the difference between "your project assigns this, over there" and
 * "nobody assigns this, the environment does" — the distinction a consumer
 * actually needs, and the one the per-file flag deliberately does not fake.
 *
 * Writes nothing.
 */
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../src/ast/language-detection"
import { parseFile } from "../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const REPOS = ["nvm", "rbenv", "ohmyzsh", "otp", "fsharp"]

type Row = { repo: string; file: string; target: string; assigned: boolean }
const rows: Row[] = []
const assignedByRepo = new Map<string, Set<string>>()
const shellDefined = new Set<string>(["BASH_SOURCE","PWD","OLDPWD","HOME","PATH","IFS","RANDOM","SECONDS","LINENO","PIPESTATUS","FUNCNAME","REPLY","OPTARG","OSTYPE","MACHTYPE","HOSTTYPE","UID","EUID","PPID","SHLVL","COLUMNS","LINES","PS1","PS2","PS3","PS4"])

for (const repo of REPOS) {
  const dir = path.join(CR, repo)
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }).trim().split("\n").filter(Boolean) } catch { continue }
  const perRepo = new Set<string>()
  assignedByRepo.set(repo, perRepo)
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try { text = readFileSync(abs, "utf8") } catch { continue }
    if (text.length > 512 * 1024) continue
    if (detectLanguageFromPath(abs, text) !== "bash") continue
    let r: any
    try { r = await parseFile(abs, dir) } catch { continue }
    for (const s of r.symbols ?? []) {
      const m = /^\w[\w:.-]*$/.test(s.name ?? "")
      if (m) perRepo.add(String(s.name))
    }
    for (const x of r.relationships ?? []) {
      const t = String(x.type ?? x.relationshipType ?? "")
      if (t.toLowerCase() !== "uses") continue
      rows.push({ repo, file: `${repo}/${rel}`, target: String(x.target ?? ""), assigned: (x.metadata as any)?.isAssignedInFile === true })
    }
  }
}

const total = rows.length
const assigned = rows.filter((r) => r.assigned)
const unassigned = rows.filter((r) => !r.assigned)
let crossFile = 0, shellOnly = 0, environment = 0
const envNames = new Map<string, number>()
for (const r of unassigned) {
  if (assignedByRepo.get(r.repo)?.has(r.target)) { crossFile++; continue }
  if (shellDefined.has(r.target)) { shellOnly++; continue }
  environment++
  envNames.set(r.target, (envNames.get(r.target) ?? 0) + 1)
}
// the contract: a field on TRUE only, so an absent field must count as false
let lying = 0
for (const r of rows) if (r.assigned && !assignedByRepo.get(r.repo)?.has(r.target)) lying++

console.log(`uses edges measured        ${total}`)
console.log(`  isAssignedInFile: true   ${assigned.length}  (${((100 * assigned.length) / total).toFixed(1)}%)`)
console.log(`  absent  -> means false  ${unassigned.length}  (${((100 * unassigned.length) / total).toFixed(1)}%)`)
console.log(`     of those, assigned in ANOTHER file of the repo: ${crossFile}`)
console.log(`     of those, a name the SHELL defines            : ${shellOnly}`)
console.log(`     of those, assigned NOWHERE in the corpus     : ${environment}  <- environment-supplied`)
console.log(`\ncontract check: edges claiming isAssignedInFile whose name is NOT a symbol in that file: ${lying}`)
console.log(`\ntop 12 environment-supplied names:`)
for (const [n, c] of [...envNames.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`  ${String(c).padStart(4)}  ${n}`)
