/**
 * VUE'S `isComponentUsage` — A FILE-SCOPED CAUSE WEARING A TAG.
 *
 * The marker table names it: 937 unresolved of 982 `isComponentUsage` edges on the 400-file stride. The
 * emission site (`real-vue-analyzer.ts:264-290`) shows the target is THE TAG AS WRITTEN with
 * `instantiates` — so `<my-button/>` targets `my-button`, while the project carries `MyButton.vue`.
 *
 * A tag that names a component FILE is exactly what the shared file claim verifies: "this target names
 * a file of the project". This prices that ceiling on a bounded sample, with vue's own arithmetic
 * (kebab-case and PascalCase spellings of the same stem), and reports the residue shapes.
 *
 * LABEL: BOUNDED SAMPLE (per-repo stride), because the population row for this lane is a lease run.
 * A file-scoped quantity measured on a stride is a LOWER BOUND by construction — the gate's own note
 * carries the pair (0.4% sampled against 46.8% whole-corpus) — so this is a floor, not the ceiling.
 *
 *   npx tsx validation/m14/fixtures/protobuf/tools/vue-component-usage-ceiling.mts --files=200
 */
import { execFileSync } from "node:child_process"
import { readdirSync, statSync } from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve(new URL("../../../../../", import.meta.url).pathname)
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SIZE_CAP = 1024 * 1024
const N = Number((process.argv.find((a) => a.startsWith("--files=")) ?? "--files=200").split("=")[1])
const { parseFile } = await import(path.join(ROOT, "src/ast/pool-worker.ts"))

const kebab = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase()
const pascal = (s: string) => s.split(/[-_]/).map((w) => w.length === 0 ? w : w[0].toUpperCase() + w.slice(1)).join("")

let files = 0, population = 0, usageEdges = 0, verify = 0, unverifiable = 0
const stemsByRepo = new Map<string, Set<string>>()
const residue = new Map<string, number>()

for (const name of readdirSync(CR).sort()) {
  const repo = path.join(CR, name)
  try { if (!statSync(repo).isDirectory()) continue } catch { continue }
  try { execFileSync("git", ["-C", repo, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", repo, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  const wanted: string[] = []
  const stems = new Set<string>()
  for (const rel of tracked) {
    if (!rel.toLowerCase().endsWith(".vue")) continue
    const abs = path.join(repo, rel)
    try { if (statSync(abs).size > SIZE_CAP) continue } catch { continue }
    const base = rel.slice(rel.lastIndexOf("/") + 1, rel.length - 4)
    stems.add(base)             // exact stem
    stems.add(kebab(base))      // kebab spelling
    stems.add(pascal(base))     // Pascal spelling
    wanted.push(abs)
  }
  if (wanted.length === 0) continue
  population += wanted.length
  stemsByRepo.set(repo, stems)
  wanted.sort()
  let pick = wanted
  if (N > 0 && pick.length > N) {
    const stride = pick.length / N
    const sel: string[] = []
    for (let i = 0; i < N; i++) sel.push(pick[Math.floor(i * stride)])
    pick = [...new Set(sel)].sort()
  }
  for (const abs of pick) {
    files++
    let res: any
    try { res = await parseFile(abs, repo, { projectRoot: repo } as any) } catch { continue }
    for (const r of res.relationships ?? []) {
      const md = (r.metadata ?? {}) as any
      if (md.isComponentUsage !== true) continue
      usageEdges++
      const t = String(r.target ?? "")
      if (stems.has(t) || stems.has(kebab(t)) || stems.has(pascal(t))) verify++
      else { unverifiable++; residue.set(t, (residue.get(t) ?? 0) + 1) }
    }
  }
}
const pct = (n: number) => usageEdges > 0 ? `${((100 * n) / usageEdges).toFixed(1)}%` : "-"
console.log(`vue isComponentUsage ceiling — SAMPLE ${files}/${population} .vue files, ${usageEdges} usage edges`)
console.log(`  a component FILE with a matching stem exists -> a claim could VERIFY: ${verify} (${pct(verify)})`)
console.log(`  no matching stem                            -> residue: ${unverifiable} (${pct(unverifiable)})`)
console.log(`\ntop residue tags:`)
console.log("  " + [...residue].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, v]) => `${k}×${v}`).join("  "))
