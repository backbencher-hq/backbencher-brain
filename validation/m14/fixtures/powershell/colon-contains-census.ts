// COLON-CONTAINS CENSUS (powershell) — what `140be2f01` removed from this lane's STORE.
//
// THE DEFECT, exactly (src/ast/parallel-indexer.ts):
//   * the dedup SET is built with BOTH ends leaf-reduced: `containsPairs.add(`${srcLeaf} ${tgtLeaf}`)`
//     using `X.replace(/^.*:([^:]+):?\d*$/, "$1")` on each side (:3660-3668);
//   * the LOOKUP before the fix reduced only the OWNER and probed the child RAW:
//     `containsPairs.has(`${ownerLeaf} ${symbol.name}`)`.
// For a child whose NAME contains a colon, `raw !== leaf`, so the guard MISSED on exactly the pairs
// the set existed to suppress — and the synthesizer wrote a second `contains` row for a pair the
// analyzer had already emitted.
//
// SO THE PRE-FIX BLAST RADIUS FOR A LANE IS COMPUTABLE FROM THE ANALYZER'S OWN OUTPUT:
//   = the number of emitted `contains` edges whose TARGET name contains a colon
//     (each one was a pair the fixed guard now suppresses, and the old guard did not).
// The store side is then validated separately (`colon-contains-store-probe.ts`): with the fix, those
// pairs appear ONCE and no (source,target) pair is duplicated.
//
//   npx tsx validation/m14/fixtures/powershell/colon-contains-census.ts
import { execFileSync } from "node:child_process"
import { readdirSync, statSync } from "node:fs"
import { join } from "node:path"

const REPO = process.env.BB_REPO || "/home/ishaq2321/mcp/backbencher-brain"
const { parseFile } = await import(`${REPO}/src/ast/pool-worker.ts`)

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SIZE_CAP = 1024 * 1024
const EXTS = [".ps1"]
const LEAF = /^.*:([^:]+):?\d*$/

const perRepo = new Map<string, { root: string; files: string[] }>()
for (const name of readdirSync(CR).sort()) {
  const dir = join(CR, name)
  try { if (!statSync(dir).isDirectory()) continue } catch { continue }
  try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  const files: string[] = []
  for (const rel of tracked) {
    if (!EXTS.some((e) => rel.toLowerCase().endsWith(e))) continue
    const abs = join(dir, rel)
    try { if (statSync(abs).size > SIZE_CAP) continue } catch { continue }
    files.push(abs)
  }
  if (files.length) perRepo.set(name, { root: dir, files })
}

let files = 0, failed = 0, containsEdges = 0, colonTargets = 0, colonRawDiffers = 0, colonSources = 0
const examples: string[] = []
const byRepo = new Map<string, number>()
for (const [repo, { root, files: list }] of perRepo) {
  for (const abs of list) {
    let r: any
    try { r = await parseFile(abs, root, { projectRoot: root }) } catch { failed++; continue }
    if (!r) { failed++; continue }
    files++
    for (const e of r.relationships ?? []) {
      if (String(e.type) !== "contains") continue
      containsEdges++
      const target = String(e.target ?? "")
      if (!target.includes(":")) continue
      colonTargets++
      const leaf = target.replace(LEAF, "$1")
      if (leaf !== target) {
        colonRawDiffers++
        byRepo.set(repo, (byRepo.get(repo) ?? 0) + 1)
        if (examples.length < 10) examples.push(`    ${target}  (leaf "${leaf}")  @ ${abs.slice(root.length + 1)}`)
      }
    }
    if (String((r.symbols ?? []).find?.((s: any) => String(s.name).includes(":"))?.name ?? "").includes(":")) colonSources++
  }
}

console.log(`population: ${files} .ps1 files parsed across ${perRepo.size} repos (${failed} failed)`)
console.log(`emitted 'contains' edges: ${containsEdges}`)
console.log(`  whose TARGET name contains a colon: ${colonTargets}`)
console.log(`  ...and whose leaf differs from the raw name (the guard MISSED these): ${colonRawDiffers}`)
console.log(`\nTHE PRE-FIX BLAST RADIUS for powershell = ${colonRawDiffers} pair(s) that would have been written TWICE.`)
for (const [repo, n] of [...byRepo.entries()].sort((a, b) => b[1] - a[1])) console.log(`    ${repo}: ${n}`)
if (examples.length) { console.log("examples:"); for (const x of examples) console.log(x) }
console.log(`\nNOTE: this is the ANALYZER side, which the indexer fix does not change. The store side —`)
console.log(`whether those pairs now appear ONCE — is colon-contains-store-probe.ts.`)
