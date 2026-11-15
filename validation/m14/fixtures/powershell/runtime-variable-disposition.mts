/**
 * POWERSHELL — W9: THE RUNTIME-VARIABLE PATH RESOLUTION, AND THE PER-ROW DISPOSITION OF EVERY ROW.
 *
 * ## THE QUESTION
 *
 * A path that begins with a RUNTIME VARIABLE — `$PSScriptRoot\..\..\X.psm1` — is resolved at RUN
 * TIME, against a directory the project does not know. The gate's project facts are REPO-RELATIVE
 * (`pathTargetInProject`, `script/m14/incoming-rule.ts:1388` compares a target against the admitted
 * file list), so such a path is not in the admitted list and cannot be, and the arbiter's answer is
 * `externalUnverified` — which is a THIRD answer, neither TRUE nor FALSE.
 *
 * **THE GATE KNOWS BOTH HALVES OF WHAT IT NEEDS: the row's OWN SOURCE FILE (so its directory, so
 * `$PSScriptRoot`) and the PROJECT'S ADMITTED FILE LIST.** This instrument does the resolution the
 * gate would do, and then asks the ARBITER'S OWN FUNCTION about the result — `pathTargetInProject`,
 * imported, never copied, because a copy of a counting rule is a second rule.
 *
 * ## WHAT IT REPORTS, PER ROW — A RESOLUTION OR A NAMED REASON
 *
 *   RESOLVED · PROJECT FILE   the resolved path IS in the repo's admitted file list, so the
 *                              externality claim is FALSE — the arbiter's case 1 REFUTES it, and
 *                              the row's wall is VISIBLE instead of invisible.
 *   NAMED REASON              the row cannot be resolved, and WHY — one of:
 *                              · the variable is not the source file's own directory (`$ProjectRoot`,
 *                                `$testdrive`, `$env:…`), so the path is not derivable from the file;
 *                              · the resolved path escapes the project root;
 *                              · the resolved path is not in the admitted list, and THE PROJECT
 *                                CANNOT TELL AN EXTERNAL MODULE FROM A DANGLING PATH — the arbiter's
 *                                own case 2, which is a REFUSAL and is recorded, never silence.
 *
 * ## THE SCOPE
 *
 *   --root PATH   the corpus root (default: the farm, `$PWD/.corpus`);
 *   --other-root PATH  a second root, to measure the SAME rows against a DIFFERENT corpus — because
 *                     a path is not a population, and the fleet's c lane measured the default root
 *                     at 23,237 files against the farm's 7,435 (3.13x);
 *   --out FILE    write the JSON;
 *   --files a,b   a bounded probe (a PROBE, not a population, and the report says which it was).
 */
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"
import { pathTargetInProject, type ProjectFacts } from "../../../../script/m14/incoming-rule"

const ADMITTED = ["ps1", "psm1", "psd1"]
const SIZE_CAP = 1024 * 1024

const argv = process.argv.slice(2)
const argOf = (name: string): string | null => {
  const i = argv.indexOf(name)
  return i >= 0 ? (argv[i + 1] ?? null) : null
}
const OUT = argOf("--out")
const NAMED = argOf("--files")
const OTHER_ROOT = argOf("--other-root")
const FARM = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/mcp/backbencher-brain/.corpus"
const ROOT = argOf("--root") ?? FARM

/** THE ADMITTED FILES OF ONE REPO, repo-relative — the arbiter's suffix match needs this spelling. */
function admittedFilesOf(repo: string, root: string): Set<string> {
  const out = new Set<string>()
  let tracked: string
  try {
    tracked = execFileSync("git", ["-C", path.join(root, repo), "ls-files"], {
      encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
    })
  } catch {
    return out
  }
  for (const rel of tracked.split("\n")) {
    if (!rel) continue
    const low = rel.toLowerCase()
    if (!ADMITTED.some((e) => low.endsWith(`.${e}`))) continue
    const abs = path.join(root, repo, rel)
    try {
      if (!existsSync(abs)) continue
      const st = execFileSync("stat", ["-c", "%s", abs], { encoding: "utf8" })
      if (Number(st.trim()) > SIZE_CAP) continue
      out.add(rel.split(path.sep).join("/"))
    } catch {
      /* absent from the working tree — the gate counts these as `absent` and excludes them */
    }
  }
  return out
}

/** THE RUNTIME VARIABLE, IF THE TARGET BEGINS WITH ONE. PowerShell's own spelling is `$PSScriptRoot`. */
function runtimeVariableOf(target: string): { name: string; rest: string } | null {
  if (target.charCodeAt(0) !== 36 /* $ */) return null
  let i = 1
  while (i < target.length) {
    const c = target.charCodeAt(i)
    const isWord = (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95
    if (!isWord) break
    i++
  }
  if (i === 1) return null
  return { name: target.slice(1, i), rest: target.slice(i) }
}

/**
 * IS THE VARIABLE ASSIGNED IN THIS ROW'S OWN FILE? — THE ONE-FILE QUESTION.
 *
 * `$PSScriptRoot` is the file's own directory BY DEFINITION, so it is derivable. But a variable like
 * `$ProjectRoot` is very often ASSIGNED in the same file (`$ProjectRoot = Split-Path $PSScriptRoot`),
 * and an assignment is a ONE-FILE fact — which means the ANALYZER, not the gate, could answer it.
 * A variable that is never assigned in the file is something else: a built-in (`$PSHOME` is the
 * PowerShell installation directory) or a value the file receives, and neither is the project's.
 */
function assignedInFile(abs: string, variable: string): boolean {
  let text: string
  try {
    text = readFileSync(abs, "utf8")
  } catch {
    return false
  }
  const escaped = variable.replace(/[^A-Za-z0-9_]/g, "")
  const re = new RegExp(`\\$${escaped}\\s*=(?!=)`, "i")
  return re.test(text)
}

type Row = {
  repo: string
  file: string
  line: number
  type: string
  target: string
  variable: string
  resolved: string | null
  disposition: "RESOLVED" | "NAMED-REASON"
  reason: string | null
  arbiterVerdictNow: string
  arbiterVerdictResolved: string
  /** THE PATCHED ARBITER'S OWN ANSWER: `pathTargetInProject(facts, target, edgeFile)` — the call the
   *  W9 patch adds. Run against the UNPATCHED arbiter this reads the pre-patch answer, because the
   *  extra argument is ignored; run against the PATCHED arbiter it reads the patch's answer. So the
   *  SAME instrument measures the patch's effect, with no second rule and no copy. */
  arbiterVerdictPatched: string
  /** IS THE VARIABLE ASSIGNED IN THIS ROW'S OWN FILE? — a ONE-FILE question, and therefore the
   *  ANALYZER's question rather than the gate's. */
  assignedInOwnFile: boolean | null
}

async function populationOf(root: string): Promise<Array<[string, string]>> {
  const out: Array<[string, string]> = []
  if (NAMED) {
    for (const s of NAMED.split(",").map((x) => x.trim()).filter(Boolean)) {
      const i = s.indexOf("/")
      if (i > 0) out.push([s.slice(0, i), s.slice(i + 1)])
    }
    return out
  }
  const repos = execFileSync("ls", [root], { encoding: "utf8" }).split("\n").filter(Boolean).sort()
  for (const repo of repos) {
    let tracked: string
    try {
      tracked = execFileSync("git", ["-C", path.join(root, repo), "ls-files"], {
        encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
      })
    } catch {
      continue
    }
    for (const rel of tracked.split("\n")) {
      const low = rel.toLowerCase()
      if (rel && ADMITTED.some((e) => low.endsWith(`.${e}`))) out.push([repo, rel])
    }
  }
  return out
}

async function run(root: string): Promise<{ rows: Row[]; parsed: number; failures: number; files: number; repos: number }> {
  const targets = await populationOf(root)
  const factsByRepo = new Map<string, ProjectFacts>()
  const rows: Row[] = []
  let parsed = 0
  let failures = 0
  const reposSeen = new Set<string>()

  for (const [repo, rel] of targets) {
    const abs = path.join(root, repo, rel)
    if (!existsSync(abs)) continue
    reposSeen.add(repo)
    let facts = factsByRepo.get(repo)
    if (!facts) {
      facts = { packages: new Set<string>(), files: admittedFilesOf(repo, root), sdkLib: false }
      factsByRepo.set(repo, facts)
    }
    let res: Awaited<ReturnType<typeof parseFile>>
    try {
      res = await parseFile(abs, path.join(root, repo))
    } catch (e) {
      failures++
      process.stderr.write(`SHARD FAILURE ${repo}/${rel}: ${String(e)}\n`)
      continue
    }
    parsed++
    for (const r of res.relationships ?? []) {
      const target = String(r.target ?? "")
      if (!target) continue
      const rv = runtimeVariableOf(target)
      if (!rv) continue
      // A runtime variable that is NOT followed by a path separator is a NAME, not a path.
      const rest = rv.rest
      const isPathShape = rest.startsWith("/") || rest.startsWith("\\") || rest.startsWith(":")
      if (!isPathShape) continue

      const row: Row = {
        repo, file: rel, line: Number(r.line_number ?? 0), type: String(r.type ?? ""),
        target, variable: rv.name, resolved: null,
        disposition: "NAMED-REASON", reason: null,
        arbiterVerdictNow: "externalUnverified", arbiterVerdictResolved: "externalUnverified",
        arbiterVerdictPatched: "externalUnverified", assignedInOwnFile: null,
      }
      // THE ARBITER'S ANSWER TODAY: the target is a path and the admitted list is repo-relative, so
      // the target cannot be in it — the row is UNVERIFIABLE, and that is what the gate records.
      row.arbiterVerdictNow = pathTargetInProject(facts, target) ? "externalRefuted" : "externalUnverified"
      // THE PATCHED CALL — the third argument is the edge's own REPO-RELATIVE file, the spelling the
      // admitted list holds, and the argument the W9 patch adds to the arbiter.
      row.arbiterVerdictPatched = pathTargetInProject(facts, target, rel) ? "externalRefuted" : "externalUnverified"

      if (rv.name.toLowerCase() !== "psscriptroot") {
        row.assignedInOwnFile = assignedInFile(abs, rv.name)
        row.reason = row.assignedInOwnFile
          ? `the variable $${rv.name} is not the source file's own directory, BUT IT IS ASSIGNED IN THIS FILE, so the path is derivable by a ONE-FILE rule that the ANALYZER could answer`
          : `the variable $${rv.name} is not the source file's own directory and is NOT assigned in this file, so it is a BUILT-IN or a RECEIVED value (a built-in like $PSHOME is the PowerShell installation directory), and neither is the project's`
        rows.push(row)
        continue
      }
      // THE RESOLUTION: the source file's own directory, the remainder folded against it, and the
      // result as a REPO-RELATIVE path — the spelling the admitted list holds.
      const dir = path.posix.dirname(rel.split(path.sep).join("/"))
      const normalisedRest = rest.replace(/\\/g, "/").replace(/^:/, "")
      const joined = path.posix.normalize(path.posix.join(dir, normalisedRest))
      if (joined.startsWith("..")) {
        row.reason = "the resolved path escapes the project root, so it names nothing the project can own"
        rows.push(row)
        continue
      }
      row.resolved = joined
      // THE ARBITER'S OWN FUNCTION, on the RESOLVED path — never a copy of the rule.
      if (pathTargetInProject(facts, joined)) {
        row.disposition = "RESOLVED"
        row.reason = "the file IS in the project's admitted list, so the externality claim is FALSE and the arbiter's case 1 REFUTES it"
        row.arbiterVerdictResolved = "externalRefuted"
      } else {
        row.disposition = "NAMED-REASON"
        row.reason = "the resolved path is not in the project's admitted list, and THE PROJECT CANNOT TELL AN EXTERNAL MODULE FROM A DANGLING PATH — the arbiter's own case 2, which is a REFUSAL, recorded and never silence"
        row.arbiterVerdictResolved = "externalUnverified"
      }
      rows.push(row)
    }
  }
  return { rows, parsed, failures, files: targets.length, repos: reposSeen.size }
}

async function main(): Promise<void> {
  const mine = await run(ROOT)
  const other = OTHER_ROOT ? await run(OTHER_ROOT) : null

  const resolved = mine.rows.filter((r) => r.disposition === "RESOLVED")
  const named = mine.rows.filter((r) => r.disposition === "NAMED-REASON")
  const byReason = new Map<string, number>()
  for (const r of named) byReason.set(r.reason ?? "-", (byReason.get(r.reason ?? "-") ?? 0) + 1)

  console.log("=== W9: THE RUNTIME-VARIABLE PATH RESOLUTION — THE PER-ROW DISPOSITION ===")
  console.log(`  root            : ${ROOT}`)
  console.log(`  scope           : ${NAMED ? "NAMED files (a PROBE, not a population)" : "the WHOLE admitted population"}`)
  console.log(`  repos           : ${mine.repos}`)
  console.log(`  admitted files  : ${mine.files} discovered, ${mine.parsed} parsed, ${mine.failures} parse failures`)
  console.log(`  ROWS OF THIS SHAPE: ${mine.rows.length}`)
  console.log("")
  console.log(`  RESOLVED (the arbiter can now REFUTE the claim): ${resolved.length}`)
  console.log(`  NAMED REASON (the row cannot be resolved, and WHY): ${named.length}`)
  for (const [reason, n] of [...byReason.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(n).padStart(3)}  ${reason}`)
  }
  const notDerivable = mine.rows.filter((r) => r.reason !== null && r.reason.includes("not the source file's own directory"))
  const assigned = notDerivable.filter((r) => r.assignedInOwnFile === true)
  console.log("")
  console.log(`  OF THE ${notDerivable.length} NOT-DERIVABLE ROWS: ${assigned.length} name a variable that IS ASSIGNED IN THE ROW'S OWN FILE`)
  console.log(`    — a ONE-FILE question, so the ANALYZER (not the gate) could answer it — and ${notDerivable.length - assigned.length} name one that is not.`)
  const byVar = new Map<string, { n: number; assigned: number }>()
  for (const r of notDerivable) {
    const e = byVar.get(r.variable) ?? { n: 0, assigned: 0 }
    e.n++
    if (r.assignedInOwnFile) e.assigned++
    byVar.set(r.variable, e)
  }
  for (const [v, e] of [...byVar.entries()].sort((a, b) => b[1].n - a[1].n)) {
    console.log(`      $${v.padEnd(18)} ${String(e.n).padStart(2)} rows · ${e.assigned} assigned in their own file`)
  }
  console.log("")
  console.log("  THE ARBITER'S VERDICT ON THESE ROWS, BEFORE AND AFTER THE RESOLUTION:")
  const nowV = new Map<string, number>()
  const thenV = new Map<string, number>()
  for (const r of mine.rows) {
    nowV.set(r.arbiterVerdictNow, (nowV.get(r.arbiterVerdictNow) ?? 0) + 1)
    thenV.set(r.arbiterVerdictResolved, (thenV.get(r.arbiterVerdictResolved) ?? 0) + 1)
  }
  console.log(`    BEFORE: ${[...nowV.entries()].map(([k, v]) => `${k} ${v}`).join(" · ")}`)
  console.log(`    AFTER : ${[...thenV.entries()].map(([k, v]) => `${k} ${v}`).join(" · ")}`)
  const patchedV = new Map<string, number>()
  for (const r of mine.rows) patchedV.set(r.arbiterVerdictPatched, (patchedV.get(r.arbiterVerdictPatched) ?? 0) + 1)
  console.log(`    THE PATCHED ARBITER'S OWN ANSWER (pathTargetInProject(facts, target, edgeFile)): ${[...patchedV.entries()].map(([k, v]) => `${k} ${v}`).join(" · ")}`)
  console.log(`    — so the PATCH'S EFFECT, measured by the SAME instrument: ${mine.rows.length - (patchedV.get("externalUnverified") ?? 0)} of ${mine.rows.length} rows change verdict.`)
  console.log("")
  console.log("  THE ROWS:")
  for (const r of mine.rows) {
    const mark = r.disposition === "RESOLVED" ? "RESOLVED  " : "NAMED     "
    console.log(
      `    ${mark} ${r.repo}/${r.file}:${r.line}  ${r.type} -> ${JSON.stringify(r.target)}` +
      `\n              variable $${r.variable}  resolved=${r.resolved ?? "-"}` +
      `\n              ${r.reason ?? ""}`,
    )
  }
  if (other) {
    console.log("")
    console.log("=== THE SAME SHAPE AGAINST A DIFFERENT ROOT ===")
    console.log(`  other root      : ${OTHER_ROOT}`)
    console.log(`  admitted files  : ${other.files} discovered, ${other.parsed} parsed, ${other.failures} parse failures`)
    console.log(`  repos           : ${other.repos}`)
    console.log(`  ROWS OF THIS SHAPE: ${other.rows.length}`)
    const otherResolved = other.rows.filter((r) => r.disposition === "RESOLVED").length
    const otherNamed = other.rows.length - otherResolved
    console.log(`  RESOLVED: ${otherResolved} · NAMED REASON: ${otherNamed}`)
    const key = (r: Row): string => `${r.repo}|${r.file}|${r.line}|${r.type}|${r.target}`
    const mineKeys = new Set(mine.rows.map(key))
    const otherKeys = new Set(other.rows.map(key))
    let onlyMine = 0
    let onlyOther = 0
    for (const k of mineKeys) if (!otherKeys.has(k)) onlyMine++
    for (const k of otherKeys) if (!mineKeys.has(k)) onlyOther++
    console.log(`  THE SETS COMPARED AS A MULTISET ON (repo, relative path, line, type, target):`)
    console.log(`    only in the first root: ${onlyMine} · only in the second: ${onlyOther} · in both: ${[...mineKeys].filter((k) => otherKeys.has(k)).length}`)
  }
  if (OUT) {
    writeFileSync(OUT, JSON.stringify({
      root: ROOT, scope: NAMED ? "named" : "whole", repos: mine.repos, files: mine.files,
      parsed: mine.parsed, failures: mine.failures, rows: mine.rows,
    }, null, 1))
    console.log(`\nwrote ${OUT}`)
  }
}

await main()
