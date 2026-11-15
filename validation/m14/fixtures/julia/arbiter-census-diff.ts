/**
 * Why do the arbiter and the census disagree by 13 edges on the same 971 files?
 *
 *   arbiter (script/m14/ontology-coverage-gate.ts)   calls 86,867  uses 26,357  imports 1,501  references 36,146
 *   census (validation/m14/fixtures/julia/census.ts) calls 86,876  uses 26,359  imports 1,502  references 36,147
 *
 * Both call `parseFile(f.abs, f.dir)` and both apply the same `ALL_TYPES.includes(t)` filter, so the
 * difference is not the entry point and not the type filter. This harness runs the two loops' ONE
 * documented difference — the census skips `r.fallback` files and the arbiter does not — and reports
 * per-file counts from BOTH so the disagreeing files are named rather than inferred.
 *
 * READ-ONLY. Writes nothing.
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { execFileSync } from "node:child_process"
import path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"

const ALL_TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"]
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"

const files: { repo: string; dir: string; rel: string; abs: string; text: string }[] = []
for (const e of readdirSync(CR)) {
  const dir = path.join(CR, e)
  try { if (!statSync(dir).isDirectory()) continue; execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try { if (statSync(abs).size > 512 * 1024) continue; text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "julia") continue
    files.push({ repo: e, dir, rel, abs, text })
  }
}
console.log(`corpus: ${files.length} admitted files\n`)

// Sequential on purpose: this harness compares two COUNTING rules, and a worker pool would add
// concurrency as a third variable. Worker count was already ruled out — the census at
// BB_JULIA_WORKERS=8 reproduces its own 4-worker numbers exactly.
const tally = new Map<string, number>()
let fallbackFiles: string[] = []
let threw = 0
let totalRows = 0
for (const f of files) {
  let r: any
  try { r = await parseFile(f.abs, f.dir) } catch { threw++; continue }
  const rows = (r?.relationships ?? []) as any[]
  totalRows += rows.length
  if (r?.fallback) fallbackFiles.push(`${f.repo}/${f.rel}`)
  const n: Record<string, number> = {}
  for (const x of rows) {
    const t = String(x.type ?? x.relationshipType ?? "").toLowerCase()
    if (!ALL_TYPES.includes(t)) continue
    n[t] = (n[t] ?? 0) + 1
    tally.set(t, (tally.get(t) ?? 0) + 1)
  }
  const perFile = Object.entries(n).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(" ")
  if (perFile) console.log(`  ${f.repo}/${f.rel}: ${perFile}`)
}

console.log(`\nthrow: ${threw}   total relationship rows emitted: ${totalRows}`)
console.log(`files with r.fallback truthy: ${fallbackFiles.length}${fallbackFiles.length ? " -> " + fallbackFiles.join(", ") : ""}`)
console.log("\nper-type totals, arbiter's rule (no fallback skip):")
for (const t of ALL_TYPES) console.log(`  ${t.padEnd(14)}${(tally.get(t) ?? 0).toLocaleString()}`)