/**
 * RUBY LANE — a deterministic sample of the edges this fix TOUCHES, for hand-reading.
 *
 * The fix routes `first-parent-guess` onto the declared-cause channel; it does not resolve an
 * edge, so the honest hand-check is not "did the target land on the right row" but "is the
 * STATED CAUSE true for this edge" — i.e. is the base it names really a name this run could
 * not reach, and is the declaration the code MEANS the one the source writes.
 *
 * READ-ONLY. Same population discovery as the incoming gate (`incoming-gate.ts:323-415`,
 * cap 400), same call (`parseFile(f, repoOf(f), { projectRoot: repoOf(f) })`, `:918`).
 *
 * Usage: bun run validation/m14/fixtures/ruby/guess-samples.mts [N]
 */
import { execFileSync } from "node:child_process"
import { readdirSync, readFileSync, statSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SIZE_CAP = 1024 * 1024
const MAX_FILES = Number(process.env.BB_MAX ?? 400)
const WANT = Number(process.argv[2] ?? 10)

function discover(): string[] {
  const found: string[] = []
  for (const name of readdirSync(CR).sort()) {
    const dir = path.join(CR, name)
    try { if (!statSync(dir).isDirectory()) continue } catch { continue }
    try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
    let tracked: string[] = []
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
    } catch { continue }
    for (const rel of tracked) {
      if (!rel.toLowerCase().endsWith(".rb")) continue
      const abs = path.join(dir, rel)
      try { if (statSync(abs).size > SIZE_CAP) continue } catch { continue }
      found.push(abs)
    }
  }
  found.sort()
  if (found.length <= MAX_FILES) return found
  const stride = Math.max(1, Math.floor(found.length / MAX_FILES))
  const picked: string[] = []
  for (let i = 0; i < found.length && picked.length < MAX_FILES; i += stride) picked.push(found[i])
  return picked
}

const repoOf = (f: string) => path.join(CR, (f.startsWith(CR) ? f.slice(CR.length + 1) : f).split(path.sep)[0])

const main = async () => {
  const files = discover()
  const rows: { rel: string; line: number; target: string; base: string; claimed: boolean; baseIsOwner: boolean; src: string }[] = []
  for (const f of files) {
    const repo = repoOf(f)
    const parsed: any = await parseFile(f, repo, { projectRoot: repo } as any)
    const lines = readFileSync(f, "utf8").split("\n")
    for (const r of Array.isArray(parsed?.relationships) ? parsed.relationships : []) {
      if (String(r?.type ?? "") !== "overrides") continue
      const md: any = r.metadata ?? {}
      if (md.reasonCode !== "first-parent-guess") continue
      const target = String(r?.target ?? "")
      const base = target.slice(0, target.lastIndexOf("."))
      const source = String(r?.source ?? "")
      const owner = source.slice(0, source.lastIndexOf("."))
      const line = Number(r?.line_number ?? 0) || 0
      rows.push({
        rel: path.relative(CR, f), line, target, base,
        claimed: typeof md.baseBeyondRunScope === "string",
        baseIsOwner: base === owner,
        src: lines[line - 1] ?? "",
      })
    }
  }
  rows.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : a.line - b.line))
  console.log(`first-parent-guess overrides edges in this population: ${rows.length}`)
  console.log(`  of them, baseBeyondRunScope CLAIMED: ${rows.filter((r) => r.claimed).length}` +
    ` · SILENT (base === the class's own leaf, the self-collision guard): ${rows.filter((r) => !r.claimed).length}`)
  console.log(`  silent rows that are NOT the self-collision case (a guard defect if any): ${rows.filter((r) => !r.claimed && !r.baseIsOwner).length}`)
  // deterministic stride through the CLAIMED rows, so the sample is not the first N alphabetically
  const perRepo = new Map<string, number>()
  for (const r of rows) { const k = r.rel.split("/")[0]; perRepo.set(k, (perRepo.get(k) ?? 0) + 1) }
  console.log(`  by repo: ${[...perRepo].map(([k, n]) => `${k} ${n}`).join(" · ")}`)
  const ONLY = process.env.BB_REPO
  const claimed = rows.filter((r) => r.claimed && (!ONLY || r.rel.startsWith(ONLY + "/")))
  const step = Math.max(1, Math.floor(claimed.length / WANT))
  console.log(`\n${WANT} hand-read candidates (stride ${step} through the claimed rows):`)
  for (let i = 0, n = 0; i < claimed.length && n < WANT; i += step, n++) {
    const r = claimed[i]
    console.log(`\n[${n + 1}] ${r.rel}:${r.line}`)
    console.log(`    emitted target : ${r.target}   (base written = ${r.base})`)
    console.log(`    source line    : ${r.src.trim()}`)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
