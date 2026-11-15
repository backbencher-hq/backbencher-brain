/**
 * YAML'S CHECK, APPLIED TO scss: what would the `extOK` claims look like if the LOCAL OBJECT existed?
 *
 * THE MECHANISM, found by reading the emitting site (`real-css-analyzer.ts`, CSS-D16): a `var(--x)`
 * read whose property THE FILE does not declare is marked `isExternalTarget: true`. The arbiter then
 * verifies that marker as an `owner` claim IN THE PROJECT'S SCOPE:
 *
 *     declCount.get(target) > 0 ? externalRefuted : externalVerified
 *
 * So the claim is sound exactly where NO file of the project declares the property — and a
 * VERIFIED column cannot report the difference, because `extFAIL` is 0 whenever the claim is true
 * and the bar counts refutations rather than verifications that should not have been verifications.
 *
 * This runs WHOLE-POPULATION key spaces for the largest scss repos (not a stride sample: the sample
 * truncates each project's symbol table, which biases `extOK` UP for the same reason the gate says it
 * biases `resolved` up), and splits every marked read three ways:
 *
 *   declared in ANOTHER file of the same project -> THE MARKER IS FALSE AS A POPULATION CLAIM
 *                                                   (and the gate CANNOT see it: `classifyEdge`
 *                                                   checks an `owner` claim only when the target has
 *                                                   ZERO declarations, so with a declaration present
 *                                                   the edge falls through to `resolved`)
 *   declared in its OWN file                    -> the marker's own precondition was violated
 *   declared nowhere in the project             -> the claim is SOUND
 *
 *   npx tsx validation/m14/fixtures/toml/tools/scss-extq-local-object.mts [--repos=3]
 */
import { execFileSync } from "node:child_process"
import { readdirSync, statSync } from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve(new URL("../../../../../", import.meta.url).pathname)
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SIZE_CAP = 1024 * 1024
const REPOS = Number((process.argv.find((a) => a.startsWith("--repos=")) ?? "--repos=3").split("=")[1])
const { parseFile } = await import(path.join(ROOT, "src/ast/pool-worker.ts"))

type Repo = { dir: string; files: string[] }
const repos: Repo[] = []
for (const name of readdirSync(CR).sort()) {
  const dir = path.join(CR, name)
  try { if (!statSync(dir).isDirectory()) continue } catch { continue }
  try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch { continue }
  const files: string[] = []
  for (const rel of tracked) {
    if (rel.slice(rel.lastIndexOf(".") + 1).toLowerCase() !== "scss") continue
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > SIZE_CAP) continue } catch { continue }
    files.push(abs)
  }
  files.sort()
  if (files.length > 0) repos.push({ dir, files })
}
repos.sort((a, b) => b.files.length - a.files.length)

let totalMarked = 0, wouldRefute = 0, ownFile = 0, sound = 0
const refuteExamples: string[] = []
const ownExamples: string[] = []

for (const { dir, files } of repos.slice(0, REPOS)) {
  // ONE PROJECT, WHOLE POPULATION — every admitted `.scss` file, so the key space is the one the
  // gate would use at maxFiles 0.
  const declFiles = new Map<string, Set<string>>()
  const parsed: { rel: string; rels: any[] }[] = []
  for (const abs of files) {
    const rel = path.relative(dir, abs).split(path.sep).join("/")
    let res: any
    try { res = await parseFile(abs, dir, { projectRoot: dir } as any) } catch { continue }
    parsed.push({ rel, rels: res.relationships ?? [] })
    for (const s of res.symbols ?? []) {
      const n = String(s.name ?? "")
      if (!n.startsWith("--")) continue
      const set = declFiles.get(n) ?? new Set<string>()
      set.add(rel)
      declFiles.set(n, set)
    }
  }
  let repoMarked = 0
  for (const { rel, rels } of parsed) {
    for (const r of rels) {
      if (String(r.type ?? "") !== "references") continue
      const md = (r.metadata ?? {}) as Record<string, unknown>
      if (md.isExternalTarget !== true) continue
      const tgt = String(r.target ?? "")
      if (!tgt.startsWith("--")) continue
      totalMarked++
      repoMarked++
      const owners = declFiles.get(tgt)
      if (owners === undefined) { sound++; continue }
      const elsewhere = [...owners].filter((f) => f !== rel)
      if (elsewhere.length > 0) {
        wouldRefute++
        if (refuteExamples.length < 10) refuteExamples.push(`${tgt.padEnd(28)} declared in ${elsewhere[0]}  (marked in ${rel})`)
      } else {
        ownFile++
        if (ownExamples.length < 6) ownExamples.push(`${tgt.padEnd(28)} declared in the edge's OWN file  (${rel})`)
      }
    }
  }
  console.log(`${path.basename(dir).padEnd(28)} ${String(files.length).padStart(5)} .scss files   marked var() reads: ${repoMarked}`)
}

console.log(`\nWHOLE-POPULATION key spaces for the ${Math.min(REPOS, repos.length)} largest scss repos`)
console.log(`  marked reads total                 : ${totalMarked}`)
console.log(`  declared in ANOTHER file of the project (false as a POPULATION claim; lands in `resolved`): ${wouldRefute}`)
console.log(`  declared in the edge's OWN file (marker precondition violated): ${ownFile}`)
console.log(`  declared NOWHERE in the project (claim SOUND): ${sound}`)
console.log(`\nfalse-as-a-population-claim examples (the local object DOES exist):`)
for (const e of refuteExamples) console.log(`  ${e}`)
if (refuteExamples.length === 0) console.log(`  none`)
console.log(`\nown-file examples:`)
for (const e of ownExamples) console.log(`  ${e}`)
if (ownExamples.length === 0) console.log(`  none`)
