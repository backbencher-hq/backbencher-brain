/**
 * WHICH EDGES A RECEIVER-TYPING CHANGE ACTUALLY MOVES — one row per `calls`/`uses` edge, so two
 * runs of this file across two analyzer states can be DIFFED edge by edge instead of argued about.
 *
 * The gate states the totals; this states the ROWS. Each row is keyed by
 * `file|line|type|member` — the site and the leaf — and carries the target the analyzer published
 * for it, so a diff answers "which edges changed, and from what to what" and a sampled row can be
 * opened in the source and read. That is the difference between a count that moved and an edge that
 * was decided.
 *
 * Population: the gate's own rule (tracked, present, `.dart`, <= 1 MB, sorted, stride), so a run at
 * `--sample=400` covers the same files as `incoming-gate.ts dart dart 400`.
 *
 * Usage:
 *   bun run validation/m14/fixtures/dart/receiver-fix-diff.ts --sample=150 --out=validation/m14/fixtures/dart/_diff-a.jsonl
 */
import { execFileSync } from "node:child_process"
import { readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SIZE_CAP = 1024 * 1024
const argv = process.argv.slice(2)
const SAMPLE = Number((argv.find((a) => a.startsWith("--sample=")) ?? "--sample=150").slice("--sample=".length))
const OUT = (argv.find((a) => a.startsWith("--out=")) ?? "").slice("--out=".length)
if (!OUT) {
  console.error("usage: receiver-fix-diff.ts --sample=N --out=<path.jsonl>")
  process.exit(2)
}

function repos(): string[] {
  const out: string[] = []
  for (const name of readdirSync(CR).sort()) {
    const dir = path.join(CR, name)
    try { if (!statSync(dir).isDirectory()) continue } catch { continue }
    try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
    out.push(name)
  }
  return out
}
function admit(dir: string): string[] {
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch { return [] }
  const files: string[] = []
  for (const rel of tracked) {
    const base = rel.slice(rel.lastIndexOf("/") + 1).toLowerCase()
    if (!rel.toLowerCase().endsWith(".dart") && !(base === "dart" && detectLanguageFromPath(rel) === "dart")) continue
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > SIZE_CAP) continue } catch { continue }
    files.push(abs)
  }
  return files
}

const repoList = repos()
const allFiles: string[] = []
for (const r of repoList) allFiles.push(...admit(path.join(CR, r)))
allFiles.sort()
const stride = Math.max(1, Math.floor(allFiles.length / SAMPLE))
const picked: string[] = []
for (let i = 0; i < allFiles.length && picked.length < SAMPLE; i += stride) picked.push(allFiles[i])
console.log(`population: ${allFiles.length} admitted .dart files · sample: ${picked.length} (stride ${stride})`)

const rows: string[] = []
let parseFailed = 0
for (const f of picked) {
  const repo = repoList.find((r) => f.startsWith(path.join(CR, r) + path.sep)) ?? ""
  const root = path.join(CR, repo)
  let r: any
  try { r = await parseFile(f, root) } catch { parseFailed++; continue }
  if (!r?.success) { parseFailed++; continue }
  const rel = path.relative(CR, f)
  for (const e of r.relationships ?? []) {
    const t = String(e.type)
    if (t !== "calls" && t !== "uses") continue
    const target = String(e.target).replace(/\u0000/g, "<SEP>")
    const leaf = target.includes(".") ? target.slice(target.lastIndexOf(".") + 1) : target
    rows.push(JSON.stringify({
      file: rel,
      line: e.line_number ?? null,
      type: t,
      member: leaf,
      target,
      source: String(e.source ?? ""),
      meta: Object.keys(e.metadata ?? {}).sort().join("+"),
      cause: (e.metadata ?? {}).receiverCause ?? null,
      claim: (e.metadata ?? {}).baseBeyondRunScope ?? null,
    }))
  }
}
writeFileSync(OUT, rows.join("\n") + "\n")
console.log(`wrote ${rows.length} edge row(s) to ${OUT} · ${parseFailed} parse failure(s)`)
