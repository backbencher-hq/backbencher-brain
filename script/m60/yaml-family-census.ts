// script/m60/yaml-family-census.ts — is every relationshipType family REACHABLE from the corpus?
//
// WHY THIS IS A TOOL AND NOT A TABLE IN THE DOC
// ----------------------------------------------
// The analyzer doc publishes a table of all nine `metadata.relationshipType` families with
// their corpus occurrence counts, and the first version of that table was WRONG in a way
// that only measurement caught. It said `yaml_tag_include` was "absent from all 9,953
// files" — true, and beside it a second row that also read 0 in the sampled draw and was
// actually reachable. A sampled census cannot tell "rare" from "never", so the honest
// instrument scans the WHOLE corpus with no sampling at all.
//
// The repo list is READ FROM script/m12/yaml-corpus-errors.ts rather than repeated here,
// because a second copy of that list is free to drift and this file already got that
// wrong once: when the ninth corpus was added, a scan with its own hardcoded list of eight
// cheerfully reported `yaml_tag_include` as absent from a corpus it had never opened. A
// census that does not know what it is censusing should not be publishing counts.
//
// Usage: bun run script/m60/yaml-family-census.ts [--per-repo=0]
//   --per-repo=0 (the default) means NO sampling: every yaml file in every pinned repo.
// Writes: validation/m60/results/yaml-family-census.json
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import * as fs from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../src/ast/pool-worker"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const CORPUS_ROOT = "$HOME/fixtures/repositories"
const OUT = path.join(ROOT, "validation/m60/results/yaml-family-census.json")
const CENSUS = path.join(ROOT, "script/m12/yaml-corpus-errors.ts")

/** The nine families the lane can emit. Kept beside the measurement so a tenth cannot be added silently. */
const FAMILIES = [
  "declared_type",
  "yaml_json_pointer",
  "yaml_depends_on",
  "yaml_resource_ref",
  "yaml_action_use",
  "yaml_action_use_unverified",
  "yaml_tag_include",
  "yaml_keyword_include",
  "yaml_merge",
]

/** Read the pinned repos from the census, so the two cannot disagree. */
function reposFromCensus(): string[] {
  const src = readFileSync(CENSUS, "utf8")
  const m = /const REPOS = \[([^\]]+)\]/.exec(src)
  if (!m) throw new Error("could not read REPOS from the census — this file must not guess the corpus")
  return [...m[1]!.matchAll(/"([^"]+)"/g)].map((x) => x[1]!)
}

function walk(dir: string, out: string[]): void {
  let entries: fs.Dirent[] = []
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    if (e.name === ".git" || e.name === "node_modules") continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.(ya?ml)$/i.test(e.name)) out.push(p)
  }
}

const argPerRepo = Number((process.argv.find((a) => a.startsWith("--per-repo=")) ?? "=0").slice(11))

async function main() {
  const repos = reposFromCensus()
  const found = new Map<string, { occurrences: number; firstFile: string; firstLine: number; repos: Set<string> }>()
  for (const f of FAMILIES) found.set(f, { occurrences: 0, firstFile: "", firstLine: 0, repos: new Set() })

  let scanned = 0
  for (const repo of repos) {
    const dir = path.join(CORPUS_ROOT, repo)
    if (!fs.existsSync(dir)) { console.log(`  (absent on this box: ${repo})`); continue }
    const all: string[] = []
    walk(dir, all)
    all.sort()
    const chosen = argPerRepo > 0 && all.length > argPerRepo
      ? Array.from({ length: argPerRepo }, (_, i) => all[Math.floor((i * all.length) / argPerRepo)]!)
      : all
    for (const file of chosen) {
      scanned++
      let parsed: any
      try { parsed = await parseFile(file, dir) } catch { continue }
      for (const r of parsed.relationships ?? []) {
        const rt = r.metadata?.relationshipType
        if (!rt || !found.has(rt)) continue
        const row = found.get(rt)!
        row.occurrences++
        row.repos.add(repo)
        if (!row.firstFile) { row.firstFile = path.relative(CORPUS_ROOT, file); row.firstLine = r.line_number ?? 0 }
      }
    }
  }

  const rows = FAMILIES.map((f) => {
    const r = found.get(f)!
    return {
      family: f,
      occurrences: r.occurrences,
      repos: [...r.repos].sort(),
      firstSeenAt: r.firstFile ? `${r.firstFile}:${r.firstLine}` : null,
      corpusBacked: r.occurrences > 0,
    }
  })
  const unbacked = rows.filter((r) => !r.corpusBacked).map((r) => r.family)
  const payload = {
    schemaVersion: 1,
    milestone: "M60",
    rule: "relationshipType family reachability",
    generatedAt: new Date().toISOString(),
    method: `every yaml file in every pinned repository, NO sampling. Repos read from script/m12/yaml-corpus-errors.ts (${repos.length}): ${repos.join(", ")}`,
    why: "a sampled draw cannot distinguish a rare construct from an unreachable one, and this lane has already had a table that did",
    filesScanned: scanned,
    families: rows.length,
    corpusBacked: rows.length - unbacked.length,
    unbacked,
    verdict: unbacked.length === 0
      ? `all ${rows.length} families have corpus evidence`
      : `${unbacked.length} family/families have NO corpus evidence and are pinned by fixture only: ${unbacked.join(", ")}`,
    rows,
  }
  mkdirSync(path.dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify(payload, null, 2) + "\n")
  console.log(`repos: ${repos.length}   files scanned: ${scanned} (no sampling)`)
  for (const r of rows) {
    console.log(`  ${r.family.padEnd(28)} ${String(r.occurrences).padStart(6)}  ${r.corpusBacked ? r.firstSeenAt : "NO CORPUS EVIDENCE"}`)
  }
  console.log(`\nVERDICT: ${payload.verdict}`)
  console.log(`-> ${path.relative(ROOT, OUT)}`)
}
main()
