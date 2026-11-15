/**
 * OWNER-EMISSION CENSUS — how many python `calls`/`uses` rows carry the owner channel, SPLIT BY
 * EVIDENCE CLASS, on the gate's own cap-50 stripe population.
 *
 * WHY IT EXISTS. The Lead's instruction for the owner-channel extension is to report coverage by
 * evidence class (`self` / `annotation` / `assignment`), never a resolution claim: the arbiter's
 * model of the channel (`member-owner-resolution.ts`) is production-authoritative but the
 * incoming gate does not yet MODEL it, so a resolution gain cannot be quoted from this instrument.
 * This counts what the ANALYZER pubslihes — `metadata.owner` rows and the evidence that set them —
 * and, beside it, the two dispatch classes those rows are meant to reach
 * (`dispatch-on-parameter` / `dispatch-on-receiver`, the 320 / 731 cap-50 rows from
 * PYTHON-RESOLUTION-CLASSIFICATION.md).
 *
 * POPULATION IS DISCOVERED, never a hand-written list: same corpus root, same git-tracked walk,
 * same size cap, same stride rule the gate uses. `--max 50` is TRIAGE and the header says so;
 * no number here is a population statement.
 *
 * Usage: bun run validation/m14/fixtures/python/owner-emission-census.mts [--max 50]
 */
import { execFileSync } from "node:child_process"
import { readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SIZE_CAP = 1024 * 1024
const argv = process.argv.slice(2)
const argOf = (flag: string): string | undefined => {
  const i = argv.indexOf(flag)
  return i >= 0 ? argv[i + 1] : undefined
}
const MAX = Number(argOf("--max") ?? "50")
const EXT = ["py", "pyi", "pyw"]

function discover(): { files: string[]; total: number; repos: number } {
  const found: string[] = []
  const repos = new Set<string>()
  for (const name of readdirSync(CR).sort()) {
    const dir = path.join(CR, name)
    try {
      if (!statSync(dir).isDirectory()) continue
      execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
    } catch { continue }
    let tracked: string[]
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
        .split("\0").filter(Boolean)
    } catch { continue }
    for (const rel of tracked) {
      const lower = rel.toLowerCase()
      if (!EXT.some((e) => lower.endsWith(`.${e}`))) continue
      const abs = path.join(dir, rel)
      try { if (statSync(abs).size > SIZE_CAP) continue } catch { continue }
      found.push(abs)
      repos.add(name)
    }
  }
  found.sort()
  const total = found.length
  if (MAX <= 0 || total <= MAX) return { files: found, total, repos: repos.size }
  const stride = Math.max(1, Math.floor(total / MAX))
  const picked: string[] = []
  for (let i = 0; i < found.length && picked.length < MAX; i += stride) picked.push(found[i])
  return { files: picked, total, repos: repos.size }
}
const repoOf = (f: string): string => path.join(CR, (f.startsWith(CR) ? f.slice(CR.length + 1) : f).split(path.sep)[0]!)

const { files, total, repos } = discover()
type Tally = { edges: number; owner: number; byEvidence: Map<string, number> }
const mk = (): Tally => ({ edges: 0, owner: 0, byEvidence: new Map() })
const perType = new Map<string, Tally>()
const dispatch = new Map<string, { edges: number; owner: number }>()
let parsed = 0
let failed = 0
for (const f of files) {
  let r: any
  try { r = await parseFile(f, repoOf(f), { projectRoot: repoOf(f) } as any); parsed++ } catch { failed++; continue }
  if (!r) { failed++; continue }
  for (const rel of Array.isArray(r.relationships) ? r.relationships : []) {
    const type = String(rel?.type ?? rel?.relationshipType ?? "")
    if (type !== "calls" && type !== "uses") continue
    const md = (rel?.metadata ?? {}) as Record<string, any>
    const t = perType.get(type) ?? mk()
    perType.set(type, t)
    t.edges++
    if (typeof md.owner === "string" && md.owner.length > 0) {
      t.owner++
      const ev = String(md.ownerEvidence ?? "untagged")
      t.byEvidence.set(ev, (t.byEvidence.get(ev) ?? 0) + 1)
    }
    const reason = String(md.reasonCode ?? "none")
    if (reason === "dispatch-on-parameter" || reason === "dispatch-on-receiver" || reason === "member-read" || reason.startsWith("dispatch-")) {
      const d = dispatch.get(reason) ?? { edges: 0, owner: 0 }
      d.edges++
      if (typeof md.owner === "string" && md.owner.length > 0) d.owner++
      dispatch.set(reason, d)
    }
  }
}

const w = (s: string | number, n: number) => (String(s) + " ".repeat(n)).slice(0, n)
console.log(`owner-emission census — ${files.length} of ${total} files (${repos} repos), ext=${EXT.join(",")}, max=${MAX || "whole"}`)
console.log(`parsed ${parsed} · failed ${failed}${MAX > 0 ? "  [TRIAGE SAMPLE — not a population statement]" : "  [whole admitted population]"}`)
console.log(`COVERAGE IS WHAT THE ANALYZER PUBLISHES; this instrument does not model the arbiter's owner rule and makes NO resolution claim.\n`)
console.log(`${w("type", 8)}${w("edges", 9)}${w("owner", 9)}${w("coverage", 10)}${w("self", 8)}${w("annotation", 12)}${w("assignment", 12)}`)
for (const type of ["calls", "uses"]) {
  const t = perType.get(type) ?? mk()
  const g = (k: string) => t.byEvidence.get(k) ?? 0
  console.log(`${w(type, 8)}${w(t.edges, 9)}${w(t.owner, 9)}${w(((t.owner / Math.max(1, t.edges)) * 100).toFixed(1) + "%", 10)}${w(g("self"), 8)}${w(g("annotation"), 12)}${w(g("assignment"), 12)}`)
}
console.log(`\n== THE DISPATCH CLASSES THE CHANNEL IS MEANT TO REACH ==`)
console.log(`${w("reasonCode", 26)}${w("edges", 9)}${w("owner", 9)}${w("coverage", 10)}`)
for (const [reason, d] of [...dispatch.entries()].sort((a, b) => b[1].edges - a[1].edges)) {
  console.log(`${w(reason, 26)}${w(d.edges, 9)}${w(d.owner, 9)}${w(((d.owner / Math.max(1, d.edges)) * 100).toFixed(1) + "%", 10)}`)
}
