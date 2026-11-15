/**
 * CLASSIFY THE 68 — the part of r-lane's SUFFIX ceiling this lane's ancestor arm does not reach.
 *
 * r-lane's `probe-imports-split` counts an import CARRIED if ANY of three arms hits: the path is
 * ROOT-RELATIVE, FILE-RELATIVE, or a SUFFIX of an admitted file's path ("any admitted file whose path
 * ends with `/<import>`"). This lane now reaches the first two plus every ANCESTOR DIRECTORY of the
 * importing file as an import root, and the gate verifies 993 claims against a 1,061 ceiling.
 *
 * The 68 are therefore exactly the imports whose only admitted match is NOT under any ancestor of the
 * importing file. This probe names them, counts their shapes, and states whether a per-file analyzer
 * can reach them at all — because a boundary needs a reason and an unclassified remainder is a gap.
 *
 *   npx tsx validation/m14/fixtures/protobuf/tools/suffix-gap-classify.mts
 */
import { execFileSync } from "node:child_process"
import { readdirSync, statSync } from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve(new URL("../../../../../", import.meta.url).pathname)
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SIZE_CAP = 1024 * 1024
const { parseFile } = await import(path.join(ROOT, "src/ast/pool-worker.ts"))
const { dirOf } = await import(path.join(ROOT, "src/ast/file-claim.ts"))

const isFile = (p: string): boolean => { try { return statSync(p).isFile() } catch { return false } }

let edges = 0, mine = 0, suffixOnly = 0, neither = 0, multiMatch = 0, singleMatch = 0
const multiExamples: string[] = []
let gapUnderAncestor = 0, gapElsewhere = 0
const examples: string[] = []
const matchedFiles = new Map<string, number>()
const importingDirs = new Map<string, number>()

for (const name of readdirSync(CR).sort()) {
  const repo = path.join(CR, name)
  try { if (!statSync(repo).isDirectory()) continue } catch { continue }
  try { execFileSync("git", ["-C", repo, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", repo, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  const admitted: string[] = []
  const protos: string[] = []
  for (const rel of tracked) {
    if (!rel.toLowerCase().endsWith(".proto")) continue
    const abs = path.join(repo, rel)
    try { if (statSync(abs).size > SIZE_CAP) continue } catch { continue }
    admitted.push(rel.split("/").join("/"))
    protos.push(abs)
  }
  if (protos.length === 0) continue
  protos.sort()
  const admittedSet = new Set(admitted)
  for (const abs of protos) {
    const rel = path.relative(repo, abs).split(path.sep).join("/")
    let res: any
    try { res = await parseFile(abs, repo, { projectRoot: repo } as any) } catch { continue }
    for (const r of res.relationships ?? []) {
      if (String(r.type) !== "imports") continue
      const written = String(r.target ?? "").trim()
      if (written.length === 0) continue
      edges++
      // THIS LANE'S ARM: file-relative, root-relative, then every ancestor directory as import root.
      const cands: string[] = []
      const fileDir = dirOf(rel).replace(/\/$/, "")
      if (fileDir.length > 0) cands.push(`${fileDir}/${written}`)
      cands.push(written)
      let d = fileDir
      while (d.length > 0) { cands.push(`${d}/${written}`); d = dirOf(d).replace(/\/$/, "") }
      const mineHit = cands.find((c) => admittedSet.has(c) && isFile(path.join(repo, c))) ?? null
      // r-LANE'S SUFFIX: any admitted file whose path ends with `/<import>`.
      const allSuffix = admitted.filter((a) => a.endsWith(`/${written}`))
      const suffixHit = allSuffix[0] ?? null
      if (allSuffix.length > 1) { multiMatch++; if (multiExamples.length < 8) multiExamples.push(`${written}  ->  ${allSuffix.join("  |  ")}`) }
      if (allSuffix.length === 1) singleMatch++
      if (mineHit !== null) { mine++; continue }
      if (suffixHit === null) { neither++; continue }
      suffixOnly++
      // Is the suffix match under an ancestor of the importing file?
      const underAncestor = cands.some((c) => c === suffixHit)
      if (underAncestor) gapUnderAncestor++; else gapElsewhere++
      matchedFiles.set(suffixHit, (matchedFiles.get(suffixHit) ?? 0) + 1)
      importingDirs.set(dirOf(rel), (importingDirs.get(dirOf(rel)) ?? 0) + 1)
      if (examples.length < 14) examples.push(`${written.padEnd(44)} -> ${suffixHit}   (imported by ${rel})`)
    }
  }
}

console.log(`protobuf SUFFIX-gap classification — whole admitted population`)
console.log(`  imports edges                                   ${edges}`)
console.log(`  claimed by THIS lane's arm                      ${mine}`)
console.log(`  reachable ONLY by r-lane's SUFFIX arm (the gap) ${suffixOnly}`)
console.log(`  reachable by NEITHER (the ruled residue)        ${neither}`)
console.log(`\n  of the gap: under an ancestor the arm already tried ${gapUnderAncestor} · elsewhere entirely ${gapElsewhere}`)
console.log(`\n  A SUFFIX RULE MUST SOMETIMES CHOOSE: edges with exactly ONE admitted match ${singleMatch} · with MORE THAN ONE ${multiMatch}`)
for (const e of multiExamples) console.log(`    MULTI ${e}`)
console.log(`\ndistinct admitted files that answer the gap (top 10):`)
for (const [f, n] of [...matchedFiles].sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log(`  ${f}  ×${n}`)
console.log(`\nexamples:`)
for (const e of examples) console.log(`  ${e}`)
