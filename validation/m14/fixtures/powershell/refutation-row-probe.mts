/**
 * POWERSHELL — WHAT EXACTLY IS A REFUTED ROW?
 *
 * The incoming gate reports `extFAIL` as a NUMBER per lane. This probe answers it per ROW, using the
 * gate's OWN rule (`externalClaimOf` + `classifyEdge` from `script/m14/incoming-rule.ts`, imported
 * rather than copied, because a copy of a counting rule is a second rule) over the WHOLE admitted
 * population, with the PROJECT-WIDE key space the gate builds.
 *
 * It exists because the lane's other census (`claim-refutation-census.mts`) asks a DIFFERENT question:
 * that one verifies the analyzer's `externalTarget` reading with a PER-FILE key space, which is the
 * right question for "is the analyzer's own reading true in this file" and the wrong one for
 * "what will the gate count against the lane". A row can be refuted project-wide and clean per-file.
 *
 *   whole         the admitted population (the gate's discovery: git checkout, `git ls-files`, the
 *                 lane's extensions, the 1 MB cap);
 *   --files a,b   a bounded run over named repo-relative paths, for a probe;
 *   --out FILE    the JSON.
 *
 * Every row it prints carries the CLAIM KIND the arbiter read and the metadata keys the analyzer
 * published, so the fix for each shape is decided from the row rather than guessed from the total.
 */
import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import { readFileSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"
import { classifyEdge, externalClaimOf, isMarkedExternal, type ProjectFacts } from "../../../../script/m14/incoming-rule"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const ADMITTED = ["ps1", "psm1", "psd1"]
const SIZE_CAP = 1024 * 1024

const argv = process.argv.slice(2)
const outIdx = argv.indexOf("--out")
const OUT = outIdx >= 0 ? argv[outIdx + 1] : null
const filesIdx = argv.indexOf("--files")
const NAMED = filesIdx >= 0 ? (argv[filesIdx + 1] ?? "").split(",").map((s) => s.trim()).filter(Boolean) : null

function admittedFilesOf(repo: string): Set<string> {
  const out = new Set<string>()
  let tracked: string
  try {
    tracked = execFileSync("git", ["-C", path.join(CR, repo), "ls-files"], {
      encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
    })
  } catch {
    return out
  }
  for (const rel of tracked.split("\n")) {
    if (!rel) continue
    const low = rel.toLowerCase()
    if (!ADMITTED.some((e) => low.endsWith(`.${e}`))) continue
    const abs = path.join(CR, repo, rel)
    try {
      const st = execFileSync("stat", ["-c", "%s", abs], { encoding: "utf8" })
      if (Number(st.trim()) > SIZE_CAP) continue
      out.add(rel.split(path.sep).join("/"))
    } catch {
      /* absent from the working tree — the gate excludes these */
    }
  }
  return out
}

type Row = {
  repo: string; file: string; line: number; type: string; target: string
  claim: string; arbiterCanSee: boolean; via: string; keys: string[]
  indemnity: Record<string, unknown>
}

const allTargets: Array<[string, string]> = []
if (NAMED) {
  for (const s of NAMED) {
    const i = s.indexOf("/")
    if (i > 0) allTargets.push([s.slice(0, i), s.slice(i + 1)])
  }
} else {
  const repos = execFileSync("ls", [CR], { encoding: "utf8" }).split("\n").filter(Boolean).sort()
  for (const repo of repos) {
    let tracked: string
    try {
      tracked = execFileSync("git", ["-C", path.join(CR, repo), "ls-files"], {
        encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
      })
    } catch {
      continue
    }
    for (const rel of tracked.split("\n")) {
      const low = rel.toLowerCase()
      if (rel && ADMITTED.some((e) => low.endsWith(`.${e}`))) allTargets.push([repo, rel])
    }
  }
}

type Parsed = { symbols: Array<{ name?: string; kind?: string }>; relationships: Array<Record<string, unknown>> }
const parsedByRepo = new Map<string, Map<string, Parsed>>()
const failures: string[] = []
let parsed = 0

for (const [repo, rel] of allTargets) {
  const abs = path.join(CR, repo, rel)
  if (!existsSync(abs)) continue
  const repoMap = parsedByRepo.get(repo) ?? new Map<string, Parsed>()
  parsedByRepo.set(repo, repoMap)
  try {
    const res: any = await parseFile(abs, path.join(CR, repo))
    repoMap.set(rel, { symbols: res.symbols ?? [], relationships: res.relationships ?? [] })
    parsed++
  } catch (e) {
    failures.push(`${repo}/${rel}: ${String(e)}`)
  }
}

const refuted: Row[] = []
const tally = { rows: 0, claims: 0, refutedByKind: {} as Record<string, number> }

for (const [repo, files] of parsedByRepo) {
  const facts: ProjectFacts = { packages: new Set<string>(), files: admittedFilesOf(repo), sdkLib: false }
  const declCount = new Map<string, number>()
  const kinds = new Map<string, Set<string>>()
  for (const p of files.values()) {
    for (const s of p.symbols) {
      const n = String(s.name ?? "")
      if (!n) continue
      declCount.set(n, (declCount.get(n) ?? 0) + 1)
      const k = String(s.kind ?? "")
      const set = kinds.get(n) ?? new Set<string>()
      if (k) set.add(k)
      kinds.set(n, set)
    }
  }
  for (const [rel, p] of files) {
    for (const r of p.relationships) {
      tally.rows++
      const md = (r.metadata ?? {}) as Record<string, unknown>
      const claim = externalClaimOf(r)
      if (claim === null) continue
      tally.claims++
      const target = String(r.target ?? "")
      if (!target) continue
      const out = classifyEdge(declCount, kinds, target, claim, facts, undefined, undefined, undefined, rel)
      if (out.outcome !== "externalRefuted") continue
      const kindText = claim.kind
      tally.refutedByKind[kindText] = (tally.refutedByKind[kindText] ?? 0) + 1
      refuted.push({
        repo, file: rel, line: Number(r.line_number ?? 0), type: String(r.type ?? ""), target,
        claim: kindText,
        arbiterCanSee: isMarkedExternal(md),
        via: String(md.externalVia ?? "-"),
        keys: Object.keys(md).sort(),
        indemnity: {
          externalTarget: md.externalTarget, isExternalTarget: md.isExternalTarget,
          languageNamespace: md.languageNamespace, sourcePathClaim: md.sourcePathClaim,
          ownerMemberAbsent: md.ownerMemberAbsent, dotNetNew: md.dotNetNew,
          noDeclarationInFile: md.noDeclarationInFile, staticMemberCall: md.staticMemberCall,
        },
      })
    }
  }
}

console.log(`probe: ${NAMED ? "NAMED files" : "WHOLE admitted population"} · root ${CR}`)
console.log(`files parsed: ${parsed} · parse failures: ${failures.length}`)
console.log(`rows: ${tally.rows} · rows carrying a claim the arbiter reads: ${tally.claims}`)
console.log(`REFUTED: ${refuted.length}`)
for (const [k, n] of Object.entries(tally.refutedByKind).sort((a, b) => b[1] - a[1])) {
  console.log(`  by claim kind  ${k}: ${n}`)
}
for (const r of refuted) {
  console.log(`  REFUTED ${r.repo}/${r.file}:${r.line} ${r.type} -> ${JSON.stringify(r.target)}` +
    ` claim=${r.claim} via=${r.via} canSee=${r.arbiterCanSee}`)
  console.log(`      md=${JSON.stringify(r.indemnity)}`)
}
if (OUT) {
  writeFileSync(OUT, JSON.stringify({ root: CR, scope: NAMED ? "named" : "whole", parsed, failures, tally, refuted }, null, 1))
  console.log(`\nwrote ${OUT}`)
}
