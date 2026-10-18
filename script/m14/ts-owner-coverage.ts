/**
 * TS OWNER-COVERAGE — how much of this lane's `calls` surface carries the STORE channel's receiver
 * evidence, counted by evidence class.
 *
 * ## The question this answers
 *
 * `src/ast/member-owner-resolution.ts` resolves a `calls`/`uses` row inside the receiver's OWNER
 * only when the row carries `metadata.owner`; the analyzer now states that owner from four
 * syntactic forms and records which one (`metadata.ownerEvidence` ∈ assignment|annotation|param|
 * this). "The wall is being crossed" is a claim about a POPULATION, so the answer has to be a
 * count over a derived population, not an example. This is that instrument.
 *
 * ## Population rule (the honesty contract's)
 *
 * The file set is DERIVED per run from the corpus the same way `incoming-gate.ts` derives its own:
 * every git checkout under `$BB_CORPUS_ROOT`, `git ls-files`, extension admitted, size cap, then
 * the same deterministic stride. The population is PRINTED with its size, the stride and the repo
 * count, so a sample can never be read as the corpus. `--repo=<name>` restricts to one project and
 * the output says so — a whole project is the honest unit for a receiver question, a stride is a
 * triage sample.
 *
 * ## What it does NOT measure
 *
 * It does not resolve anything: an owner-carrying row is not a resolved row, and this instrument
 * never reports a resolution. Whether the store then finds the member is
 * `script/m14/incoming-gate.ts`'s question once the arbiter models the channel. A row with an owner
 * whose class declares no such member is counted as owner-carrying here and the store will DECLINE
 * it — that cost belongs to the gate's number, not to this denominator.
 *
 * Usage:
 *   BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/ts-owner-coverage.ts [--max-files 50] [--repo name] [--json out.json] [--per-repo]
 */
import { execFileSync } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../src/ast/pool-worker"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { buildOwnerProjectPools, ownerChannelVerdict, type OwnerSymbolRecord } from "./owner-channel"

const CR = process.env.BB_CORPUS_ROOT ?? path.join(process.cwd(), ".corpus")
const SIZE_CAP = 1024 * 1024
const argv = process.argv.slice(2)
const argOf = (flag: string): string | null => {
  const i = argv.indexOf(flag)
  return i >= 0 ? (argv[i + 1] ?? null) : null
}
const maxFiles = Number(argOf("--max-files") ?? 50)
const onlyRepo = argOf("--repo")
const jsonOut = argOf("--json")
const perRepo = argv.includes("--per-repo")

/** Same admission rule the fleet gate uses for this lane: extension match, size cap, present file. */
function discover(): { files: string[]; admitted: number; repos: number; overCap: number; absent: number } {
  const found: string[] = []
  const repos = new Set<string>()
  let overCap = 0
  let absent = 0
  let entries: string[]
  try {
    entries = fs.readdirSync(CR)
  } catch {
    return { files: [], admitted: 0, repos: 0, overCap, absent }
  }
  for (const name of entries.sort()) {
    if (onlyRepo && name !== onlyRepo) continue
    const dir = path.join(CR, name)
    try {
      if (!fs.statSync(dir).isDirectory()) continue
    } catch {
      continue
    }
    try {
      execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
    } catch {
      continue
    }
    let tracked: string[]
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
        .split("\0")
        .filter(Boolean)
    } catch {
      continue
    }
    for (const rel of tracked) {
      const low = rel.toLowerCase()
      if (!low.endsWith(".ts")) continue
      if (detectLanguageFromPath(rel) !== "typescript") continue
      const abs = path.join(dir, rel)
      try {
        const size = fs.statSync(abs).size
        if (size > SIZE_CAP) {
          overCap++
          continue
        }
      } catch {
        absent++
        continue
      }
      found.push(abs)
      repos.add(name)
    }
  }
  found.sort()
  return { files: found, admitted: found.length, repos: repos.size, overCap, absent }
}

const disc = discover()
const total = disc.admitted
let files = disc.files
if (maxFiles > 0 && total > maxFiles) {
  const stride = Math.max(1, Math.floor(total / maxFiles))
  const picked: string[] = []
  for (let i = 0; i < disc.files.length && picked.length < maxFiles; i += stride) picked.push(disc.files[i]!)
  files = picked
}

type ResolutionTally = { carried: number; resolved: number; declined: number; reasons: Record<string, number> }
type Tally = {
  calls: number
  memberCalls: number
  owner: number
  byEvidence: Record<string, number>
  ownerWithoutEvidence: number
  uses: number
  usesWithOwner: number
  /** D7: per-evidence RESOLUTION of the owner rows, computed with the PRODUCTION rule
   *  (`ownerChannelVerdict` from script/m14/owner-channel.ts) over pools built from THIS run's own
   *  symbols. This is what lets each receiver-typing class report resolved/declined separately
   *  instead of only "carried". It is a MODEL of the channel, not the gate's number: the gate prints
   *  one aggregate block, and this instrument's pools come from the same analyzer output the rows do. */
  resolution: Record<string, ResolutionTally>
}
const emptyTally = (): Tally => ({
  calls: 0, memberCalls: 0, owner: 0, byEvidence: {}, ownerWithoutEvidence: 0, uses: 0, usesWithOwner: 0, resolution: {},
})
const totalTally = emptyTally()
const perRepoTally = new Map<string, Tally>()
const parseFailures: string[] = []

const CLASSLIKE_KINDS = new Set(["class", "interface", "enum", "namespace", "module", "internal_module", "record", "struct", "trait", "abstract_class"])
const recordsByRepo = new Map<string, OwnerSymbolRecord[]>()
const ownerRows: { evidence: string; target: string; owner: string; fileRel: string; line: number | null }[] = []
for (const file of files) {
  const rel = file.startsWith(CR) ? file.slice(CR.length + 1) : file
  const repoName = rel.split(path.sep)[0]!
  const repoRoot = path.join(CR, repoName)
  let r: any
  try {
    r = await parseFile(file, repoRoot)
  } catch (e: any) {
    parseFailures.push(`${rel}: ${e?.message ?? e}`)
    continue
  }
  if (r?.fallback === true) parseFailures.push(`${rel}: fallback`)
  // Owner-channel model inputs: class-like declarations and members (the only symbol classes the
  // pools consume), from the SAME parse the rows come from.
  {
    const repoRecords = recordsByRepo.get(repoName) ?? []
    recordsByRepo.set(repoName, repoRecords)
    for (const sym of r?.symbols ?? []) {
      const kind = String(sym?.kind ?? "")
      const name = String(sym?.name ?? "")
      if (!name) continue
      const ownerName = typeof sym?.ownerName === "string" && sym.ownerName.length > 0 ? sym.ownerName : null
      if (!CLASSLIKE_KINDS.has(kind) && !ownerName) continue
      // ParseResult symbols carry TOP-LEVEL startLine/endLine (no `range` object): using `range`
      // here left every record at line 0 and the owner-identity rule fell back to by-name for every
      // row — the model then read ownerAbsent/ownerAmbiguous far more than the production rule does.
      const superTypes = [
        ...((sym as any)?.metadata?.extends ?? []),
        ...((sym as any)?.metadata?.implements ?? []),
      ].map((x: any) => String(x))
      repoRecords.push({
        file: rel,
        name,
        kind,
        line: Number(sym?.startLine ?? 0),
        endLine: Number(sym?.endLine ?? sym?.startLine ?? 0),
        ownerName,
        superTypes,
      })
    }
  }
  const tally = perRepoTally.get(repoName) ?? emptyTally()
  for (const edge of r?.relationships ?? []) {
    const label = String(edge?.type ?? "")
    const md: any = edge?.metadata ?? {}
    if (label === "calls") {
      tally.calls++
      if (String(md.calleeExpression ?? "").includes(".")) tally.memberCalls++
      if (typeof md.owner === "string" && md.owner.length > 0) {
        tally.owner++
        const evidence = typeof md.ownerEvidence === "string" && md.ownerEvidence.length > 0 ? md.ownerEvidence : "(unrecorded)"
        tally.byEvidence[evidence] = (tally.byEvidence[evidence] ?? 0) + 1
        if (evidence === "(unrecorded)") tally.ownerWithoutEvidence++
        ownerRows.push({
          evidence,
          target: String(edge?.target ?? ""),
          owner: String(md.owner),
          fileRel: rel,
          line: Number.isFinite(Number(edge?.line_number)) ? Number(edge.line_number) : (Number(md.line ?? NaN) || null),
        })
      }
    } else if (label === "uses") {
      tally.uses++
      if (typeof md.owner === "string" && md.owner.length > 0) tally.usesWithOwner++
    }
  }
  perRepoTally.set(repoName, tally)
}
// ── D7 PER-CLASS RESOLUTION: the production owner rule over this run's own pools ──────────────
// Declined rows fall back to the name model in production; here they are counted as declined so a
// class whose owners do not resolve is visible instead of being folded into "carried".
for (const row of ownerRows) {
  const repoName = row.fileRel.split(path.sep)[0] ?? ""
  const repoRecords = recordsByRepo.get(repoName)
  if (!repoRecords) continue
  const pools = buildOwnerProjectPools(repoRecords)
  const verdict = ownerChannelVerdict(pools, { type: "calls", target: row.target, owner: row.owner, srcFile: row.fileRel, line: row.line })
  const tally = perRepoTally.get(repoName)
  if (!tally) continue
  const rt = tally.resolution[row.evidence] ?? (tally.resolution[row.evidence] = { carried: 0, resolved: 0, declined: 0, reasons: {} })
  rt.carried++
  if (verdict.outcome === "resolved") rt.resolved++
  else {
    rt.declined++
    rt.reasons[verdict.reason] = (rt.reasons[verdict.reason] ?? 0) + 1
  }
}

// THE TOTAL IS RECOMPUTED FROM THE PER-REPO TALLIES, not accumulated inside the file loop.
// The first version added `tally` (a PER-REPO CUMULATIVE) to the total after EVERY file, so a
// repository with N sampled files contributed its running sum N times — measured on the cap-50
// stride before the fix: calls read 2752 where the 50 files hold 2497 relationships in total, a
// count LARGER than the whole population it is a part of. The reconciliation is printed below.
for (const t of perRepoTally.values()) {
  for (const k of Object.keys(t) as (keyof Tally)[]) {
    if (k === "byEvidence" || k === "resolution") continue
    ;(totalTally as any)[k] += (t as any)[k]
  }
  for (const [evidence, n] of Object.entries(t.byEvidence)) {
    totalTally.byEvidence[evidence] = (totalTally.byEvidence[evidence] ?? 0) + n
  }
  for (const [evidence, rt] of Object.entries(t.resolution)) {
    const into = totalTally.resolution[evidence] ?? (totalTally.resolution[evidence] = { carried: 0, resolved: 0, declined: 0, reasons: {} })
    into.carried += rt.carried
    into.resolved += rt.resolved
    into.declined += rt.declined
    for (const [reason, n] of Object.entries(rt.reasons)) into.reasons[reason] = (into.reasons[reason] ?? 0) + n
  }
}

const pct = (n: number, d: number) => (d === 0 ? "n/a" : `${((100 * n) / d).toFixed(1)}%`)
const report = {
  language: "typescript",
  population: {
    files_parsed: files.length,
    admitted: total,
    repos: disc.repos,
    stride: maxFiles > 0 && total > maxFiles ? Math.max(1, Math.floor(total / maxFiles)) : 1,
    repo_filter: onlyRepo ?? null,
    over_cap: disc.overCap,
    absent: disc.absent,
    parse_failures: parseFailures.length,
  },
  calls: totalTally.calls,
  member_calls: totalTally.memberCalls,
  owner_carrying: totalTally.owner,
  owner_share_of_all_calls: pct(totalTally.owner, totalTally.calls),
  owner_share_of_member_calls: pct(totalTally.owner, totalTally.memberCalls),
  by_evidence: totalTally.byEvidence,
  resolution_by_evidence: totalTally.resolution,
  owner_without_evidence: totalTally.ownerWithoutEvidence,
  uses: totalTally.uses,
  uses_with_owner: totalTally.usesWithOwner,
}

console.log("TS OWNER-COVERAGE — the STORE's receiver channel (metadata.owner), counted by evidence class")
console.log(
  `population: ${files.length} parsed of ${total} admitted .ts file(s) across ${disc.repos} repo(s)` +
    ` · stride ${report.population.stride}${onlyRepo ? ` · REPO-FILTERED to ${onlyRepo} (not the corpus)` : ""}` +
    ` · over size cap ${disc.overCap} · absent ${disc.absent} · parse failures ${parseFailures.length}`,
)
if (maxFiles > 0 && total > maxFiles) {
  console.log(`SAMPLE, NOT POPULATION: ${files.length} of ${total} files. A stride truncates each project's file set, so per-repo shares are less stable than the whole-repo arm.`)
}
console.log("")
console.log(`calls edges                      ${totalTally.calls}`)
console.log(`  of which member calls          ${totalTally.memberCalls}   (callee contains a dot — the class the 54.1% wall was measured on)`) 
console.log(`  carrying metadata.owner        ${totalTally.owner}   (${report.owner_share_of_all_calls} of all calls · ${report.owner_share_of_member_calls} of member calls)`)
// THE EVIDENCE CLASSES THIS LANE PUBLISHES. The four original forms plus the eight D7
// receiver-typing classes (assignment now covers the post-declaration `x = new T()` flow as well as
// `const x = new T()`); a value outside this list is reported as UNRECOGNISED rather than silently
// folded into a known class, so a new or mistyped evidence string cannot hide inside the total.
const order = [
  "assignment", "annotation", "param", "this",
  "destructured", "element", "generic", "factory", "cast", "enum", "class-static",
  "(unrecorded)",
]
for (const k of order) {
  const n = totalTally.byEvidence[k] ?? 0
  if (n === 0 && k === "(unrecorded)") continue
  console.log(`    ownerEvidence=${k.padEnd(12)} ${String(n).padStart(6)}   (${pct(n, totalTally.owner)} of owner-carrying)`) 
}
for (const k of Object.keys(totalTally.byEvidence).sort()) {
  if (order.includes(k)) continue
  console.log(`    ownerEvidence=${k} (UNRECOGNISED) ${totalTally.byEvidence[k]}`)
}
console.log(`uses edges                       ${totalTally.uses}   · with metadata.owner ${totalTally.usesWithOwner} (the channel's uses half is not emitted by this lane yet)`)
if (Object.keys(totalTally.resolution).length > 0) {
  console.log("")
  console.log("PER-EVIDENCE RESOLUTION (production owner rule over this run's pools; declined = falls back to the name model):")
  for (const k of Object.keys(totalTally.resolution).sort()) {
    const rt = totalTally.resolution[k]!
    const top = Object.entries(rt.reasons).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([r, n]) => `${r} ${n}`).join(" · ")
    console.log(`    ${k.padEnd(12)} carried ${String(rt.carried).padStart(6)} · resolved ${String(rt.resolved).padStart(6)} (${pct(rt.resolved, rt.carried)}) · declined ${String(rt.declined).padStart(6)}${top ? `   [${top}]` : ""}`)
  }
}
if (perRepo) {
  console.log("\nper repo (repo-dependence is why this is never pooled into one 'coverage' claim):")
  for (const [repo, t] of [...perRepoTally.entries()].sort()) {
    console.log(
      `  ${repo.padEnd(28)} calls ${String(t.calls).padStart(6)} · member ${String(t.memberCalls).padStart(6)} · owner ${String(t.owner).padStart(5)} (${pct(t.owner, t.calls)})`,
    )
  }
}
if (parseFailures.length > 0) {
  console.log(`\nPARSE FAILURES (counted, not hidden): ${parseFailures.length}`)
  for (const f of parseFailures.slice(0, 10)) console.log(`  ${f}`)
}
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(report, null, 2))
