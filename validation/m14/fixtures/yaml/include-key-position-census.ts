// INCLUDE-KEY POSITION CENSUS (yaml) — where every include-shaped edge actually comes from.
//
// WHY IT EXISTS. `include` is in `FILE_IMPORT_KEYS` for ansible's and pyyaml-include's sake, and the
// same spelling is used by several config formats as a FILTER LIST rather than a file import
// (Azure Pipelines' `trigger.branches.include`, semgrep's `paths.include`). The Azure case was
// measured and guarded (ROUND 7); this instrument answers the general question — WHICH KEY, AT WHICH
// POSITION, emitted each edge — so a remaining false edge class is found by counting rather than by
// reading one file and generalising.
//
// The source path of the edge IS the emitting site (`<document>.trigger.branches.include`), so the
// parent leaf is read off the edge with no extra instrumentation in the analyzer.
//
//   npx tsx validation/m14/fixtures/yaml/include-key-position-census.ts   (whole corpus)
//
const REPO = process.env.BB_REPO || "/home/ishaq2321/mcp/backbencher-brain"
const { parseFile } = await import(`${REPO}/src/ast/pool-worker.ts`)
const { externalClaimOf } = await import(`${REPO}/script/m14/incoming-rule.ts`)
import { execFileSync } from "node:child_process"
import { statSync, readdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const OUT = process.env.BB_OUT ?? `${REPO}/validation/m14/fixtures/yaml/include-key-position-yaml-whole-corpus.txt`
const SIZE_CAP = 1024 * 1024
const EXTS = [".yaml", ".yml"]

const perRepo = new Map<string, { root: string; files: string[] }>()
let totalFiles = 0
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
  if (files.length > 0) { files.sort(); perRepo.set(name, { root: dir, files }); totalFiles += files.length }
}

const shapeOf = (t: string): string => {
  if (/[*?]/.test(t) && !/[{}]/.test(t)) return "glob"
  if (/[{}$]/.test(t)) return "template"
  if (/\s/.test(t)) return "whitespace"
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(t)) return "uri-scheme"
  if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t)) return "free-form"
  if (t.includes("/")) return "path-like"
  if (t.includes(".")) return "dotted"
  return "bare-identifier"
}

/** parentLeaf -> shape -> claim -> tally, with samples. */
const cells = new Map<string, { n: number; outcome: Map<string, number>; samples: string[]; repos: Set<string> }>()
let edges = 0
const bump = (parent: string, shape: string, claim: string, file: string, repo: string, target: string): void => {
  const k = `${parent}\0${shape}\0${claim}`
  const b = cells.get(k) ?? { n: 0, outcome: new Map(), samples: [], repos: new Set() }
  b.n++
  if (b.samples.length < 4) b.samples.push(`${target}  @ ${file}`)
  b.repos.add(repo)
  cells.set(k, b)
}

let parsed = 0
for (const [repo, { root, files }] of perRepo) {
  for (const abs of files) {
    let r: any
    try { r = await parseFile(abs, root, { projectRoot: root }) } catch { continue }
    if (!r) continue
    parsed++
    const rel = abs.slice(root.length + 1).split("\\").join("/")
    for (const e of r.relationships ?? []) {
      if (String(e.type) !== "imports") continue
      if (String(e.metadata?.relationshipType ?? "") !== "yaml_keyword_include") continue
      edges++
      const src = String(e.source ?? "")
      // THE PARENT CHAIN, not the leaf: the selector containers this instrument exists to find are
      // ANCESTORS (`targets.<t>.sources.include`, `enums.as-int.include`), so the leaf alone names
      // the wrong thing. `chain` keeps the last three segments of the emitting path.
      const segs = src.split(".")
      const parent = segs.slice(Math.max(0, segs.length - 3)).join(".") || "(document)"
      const tgt = String(e.target ?? "")
      const claim = externalClaimOf(e)
      const kind = claim === null ? "(none)" : claim.kind
      bump(parent, shapeOf(tgt), kind, rel, repo, tgt)
    }
  }
  if (perRepo.size > 0 && parsed % 3000 < files.length) process.stderr.write(`  ${parsed} files parsed\n`)
}

const lines: string[] = []
const w = (s: unknown, n: number): string => (String(s) + " ".repeat(n)).slice(0, n)
lines.push(`include-key position census — ${edges} yaml_keyword_include edges over ${parsed} parsed files / ${totalFiles} admitted`)
lines.push(`the KEY THAT EMITTED the edge is the last segment of the edge's source path\n`)
lines.push(`${w("emitting key", 22)} ${w("shape", 15)} ${w("claim", 14)} ${w("edges", 7)} repos`)
lines.push("-".repeat(84))
const rows = [...cells.entries()].sort((a, b) => b[1].n - a[1].n)
const byKey = new Map<string, number>()
for (const [k, b] of rows) {
  const [parent, shape, claim] = k.split("\0")
  byKey.set(parent, (byKey.get(parent) ?? 0) + b.n)
  lines.push(`${w(parent, 22)} ${w(shape, 15)} ${w(claim, 14)} ${w(b.n, 7)} ${b.repos.size}`)
  for (const s of b.samples) lines.push(`        ${s}`)
}
lines.push("-".repeat(84))
lines.push(`\n=== BY EMITTING KEY (every shape and claim summed) ===`)
for (const [k, n] of [...byKey.entries()].sort((a, b) => b[1] - a[1])) lines.push(`  ${w(k, 22)} ${w(n, 7)}`)
const text = lines.join("\n")
console.log(text)
writeFileSync(OUT, text + "\n")
console.log(`\nwrote ${OUT}`)
